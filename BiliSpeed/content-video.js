// BiliSpeed - 视频页面增强
(function() {
  'use strict';

  // 默认设置
  const DEFAULT_SETTINGS = {
    customSpeeds: [],
    arrowRightSpeed: 3.0,
    enableAKeyToggle: true,
    separateAToggle: false,
    separateASpeed: 3.0
  };

  // 当前设置
  let settings = { ...DEFAULT_SETTINGS };
  let videoElement = null;
  let playbackRateMenu = null;
  let playbackRateList = null;
  let observer = null;

  // 键盘快捷键相关变量
  let arrowRightPressed = false;
  let arrowRightTimer = null;
  let originalPlaybackRate = 1.0;
  let lastPlaybackRateBeforeToggle = 1.0;
  let aKeyToggleSpeed = 3.0; // 根据设置计算
  let arrowRightPressTime = 0;
  let isLongPressTriggered = false;
  const SEEK_STEP = 5; // 快进步长（秒）

  // 初始化
  function init() {
    // 加载设置
    loadSettings(() => {
      // 更新键盘设置
      updateKeyboardSettings();

      // 设置键盘事件监听器
      setupKeyboardListeners();

      // 页面卸载时清理
      window.addEventListener('beforeunload', cleanupKeyboardListeners);

      // 开始观察DOM变化
      startObserver();

      // 尝试立即查找视频和倍速菜单
      tryFindVideoAndMenu();
    });
  }

  // 加载设置
  function loadSettings(callback) {
    chrome.storage.sync.get(DEFAULT_SETTINGS, (data) => {
      settings = data;
      if (callback) callback();
    });
  }

  // 查找视频元素和倍速菜单
  function tryFindVideoAndMenu() {
    // 查找视频元素
    const newVideoElement = document.querySelector('video');

    // 如果视频元素变化，重置状态
    if (newVideoElement && newVideoElement !== videoElement) {
      videoElement = newVideoElement;
      // 重置键盘相关状态
      originalPlaybackRate = videoElement.playbackRate;
      lastPlaybackRateBeforeToggle = videoElement.playbackRate;

      // 清理右箭头键状态（如果正在长按）
      if (arrowRightPressed) {
        arrowRightPressed = false;
        if (arrowRightTimer) {
          clearTimeout(arrowRightTimer);
          arrowRightTimer = null;
        }
      }
    } else if (newVideoElement) {
      videoElement = newVideoElement;
    } else {
      videoElement = null;
    }

    // 查找倍速菜单
    const rateBtn = document.querySelector('.bpx-player-ctrl-playbackrate');
    if (rateBtn) {
      playbackRateMenu = rateBtn;
      playbackRateList = rateBtn.querySelector('ul');
      if (playbackRateList) {
        injectCustomSpeeds();
      }
    }
  }

  // 启动DOM观察器
  function startObserver() {
    // 如果已经存在观察器，先断开
    if (observer) {
      observer.disconnect();
    }

    observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        // 检查新增的节点
        if (mutation.addedNodes.length > 0) {
          for (const node of mutation.addedNodes) {
            if (node.nodeType === Node.ELEMENT_NODE) {
              // 检查是否是视频元素
              if (node.tagName === 'VIDEO' || node.querySelector?.('video')) {
                tryFindVideoAndMenu();
              }

              // 检查是否是倍速按钮或列表
              if (node.classList?.contains('bpx-player-ctrl-playbackrate') ||
                  node.querySelector?.('.bpx-player-ctrl-playbackrate')) {
                const rateBtn = document.querySelector('.bpx-player-ctrl-playbackrate');
                if (rateBtn && rateBtn !== playbackRateMenu) {
                  playbackRateMenu = rateBtn;
                  playbackRateList = rateBtn.querySelector('ul');
                  if (playbackRateList) {
                    injectCustomSpeeds();
                  }
                }
              }

              // 检查倍速列表是否已存在
              if (node.tagName === 'UL' && node.parentElement?.classList?.contains('bpx-player-ctrl-playbackrate')) {
                playbackRateList = node;
                injectCustomSpeeds();
              }
            }
          }
        }
      }
    });

    // 开始观察整个文档
    observer.observe(document.body, {
      childList: true,
      subtree: true
    });
  }

  // 注入自定义倍速
  function injectCustomSpeeds() {
    if (!playbackRateList || settings.customSpeeds.length === 0) return;

    // 清除之前注入的自定义倍速（避免重复）
    const existingCustomItems = playbackRateList.querySelectorAll('[data-bili-enhancer-custom]');
    existingCustomItems.forEach(item => item.remove());

    // 获取现有的倍速值
    const existingSpeeds = Array.from(playbackRateList.querySelectorAll('li:not([data-bili-enhancer-custom])'))
      .map(li => {
        const text = li.textContent.trim();
        const match = text.match(/[\d.]+/);
        return match ? parseFloat(match[0]) : null;
      })
      .filter(speed => speed !== null);

    // 对自定义倍速进行排序（从快到慢）
    const sortedCustomSpeeds = [...settings.customSpeeds].sort((a, b) => b - a);

    // 注入自定义倍速
    for (const speed of sortedCustomSpeeds) {
      // 检查是否已存在（避免与原生倍速重复）
      if (existingSpeeds.includes(speed)) continue;

      // 创建自定义倍速项
      const li = document.createElement('li');
      li.setAttribute('data-bili-enhancer-custom', 'true');
      li.setAttribute('role', 'menuitem');
      li.setAttribute('tabindex', '-1');
      li.textContent = `${speed.toFixed(1)}x`;

      // 复制原生菜单项的样式和类名
      const nativeItem = playbackRateList.querySelector('li:not([data-bili-enhancer-custom])');
      if (nativeItem) {
        // 复制类名（排除可能存在的激活状态类）
        li.className = nativeItem.className.replace(/\bbpx-player-ctrl-playbackrate-active\b/g, '');
        // 复制内联样式
        li.style.cssText = nativeItem.style.cssText;
      }

      // 添加点击事件
      li.addEventListener('click', () => {
        if (videoElement) {
          videoElement.playbackRate = speed;
          // 更新选中状态
          updateSelectedSpeed(speed);
        }
      });

      // 插入到合适的位置（按速度从快到慢插入）
      let inserted = false;
      const listItems = Array.from(playbackRateList.children);
      for (let i = 0; i < listItems.length; i++) {
        const item = listItems[i];
        if (item.hasAttribute('data-bili-enhancer-custom')) continue;

        const itemSpeed = parseFloat(item.textContent);
        if (speed > itemSpeed) {
          playbackRateList.insertBefore(li, item);
          inserted = true;
          break;
        }
      }

      // 如果没有找到合适位置，添加到末尾
      if (!inserted) {
        playbackRateList.appendChild(li);
      }
    }

    // 更新选中状态
    if (videoElement) {
      updateSelectedSpeed(videoElement.playbackRate);
    }
  }

  // 更新选中状态的倍速
  function updateSelectedSpeed(speed) {
    if (!playbackRateList) return;

    // 移除所有选中状态
    playbackRateList.querySelectorAll('li').forEach(li => {
      li.classList.remove('bpx-player-ctrl-playbackrate-active');
    });

    // 找到对应的倍速项并添加选中状态
    const listItems = playbackRateList.querySelectorAll('li');
    for (const li of listItems) {
      const text = li.textContent.trim();
      const match = text.match(/[\d.]+/);
      if (match && Math.abs(parseFloat(match[0]) - speed) < 0.01) {
        li.classList.add('bpx-player-ctrl-playbackrate-active');
        break;
      }
    }
  }

  // 重新注入自定义倍速（当设置变化时）
  function reinjectCustomSpeeds() {
    if (playbackRateList) {
      injectCustomSpeeds();
    }
  }

  // 计算A键切换倍速值
  function calculateAKeyToggleSpeed() {
    if (settings.separateAToggle) {
      return settings.separateASpeed;
    } else {
      return settings.arrowRightSpeed;
    }
  }

  // 处理键盘按下事件
  function handleKeyDown(event) {
    // 只在视频元素存在时处理
    if (!videoElement) return;

    // 右箭头键处理
    if (event.key === 'ArrowRight' || event.code === 'ArrowRight' || event.keyCode === 39) {
      // 阻止原生行为，完全由我们处理
      event.preventDefault();
      event.stopPropagation();

      if (!arrowRightPressed) {
        arrowRightPressed = true;
        arrowRightPressTime = Date.now();
        isLongPressTriggered = false;
        originalPlaybackRate = videoElement.playbackRate;

        // 设置长按计时器
        arrowRightTimer = setTimeout(() => {
          if (arrowRightPressed && videoElement) {
            // 长按触发，应用自定义倍速
            isLongPressTriggered = true;
            videoElement.playbackRate = settings.arrowRightSpeed;
            updateSelectedSpeed(videoElement.playbackRate);
          }
        }, 300); // 300ms后应用倍速，模拟长按
      }
      return;
    }

    // A键处理（不区分大小写）
    if ((event.key === 'a' || event.key === 'A' || event.code === 'KeyA' || event.keyCode === 65) &&
        settings.enableAKeyToggle) {
      event.preventDefault();
      event.stopPropagation();

      const targetSpeed = calculateAKeyToggleSpeed();
      const currentSpeed = videoElement.playbackRate;

      // 检查当前倍速是否已经是目标倍速
      if (Math.abs(currentSpeed - targetSpeed) < 0.01) {
        // 恢复到切换前的倍速
        videoElement.playbackRate = lastPlaybackRateBeforeToggle;
      } else {
        // 保存当前倍速，切换到目标倍速
        lastPlaybackRateBeforeToggle = currentSpeed;
        videoElement.playbackRate = targetSpeed;
      }

      updateSelectedSpeed(videoElement.playbackRate);
      return;
    }
  }

  // 处理键盘释放事件
  function handleKeyUp(event) {
    // 右箭头键释放
    if (event.key === 'ArrowRight' || event.code === 'ArrowRight' || event.keyCode === 39) {
      event.preventDefault();
      event.stopPropagation();

      if (arrowRightPressed) {
        const pressDuration = Date.now() - arrowRightPressTime;
        arrowRightPressed = false;
        if (arrowRightTimer) {
          clearTimeout(arrowRightTimer);
          arrowRightTimer = null;
        }

        // 短按且长按未触发：执行快进
        if (pressDuration < 300 && !isLongPressTriggered && videoElement) {
          // 快进 SEEK_STEP 秒，但不超过视频总时长
          videoElement.currentTime = Math.min(videoElement.currentTime + SEEK_STEP, videoElement.duration);
          // 注意：快进不改变倍速，无需更新选中状态
        }

        // 长按已触发：恢复原始倍速
        if (isLongPressTriggered && videoElement) {
          videoElement.playbackRate = originalPlaybackRate;
          updateSelectedSpeed(videoElement.playbackRate);
        }

        // 重置长按触发标志
        isLongPressTriggered = false;
      }
      return;
    }
  }

  // 设置键盘事件监听器
  function setupKeyboardListeners() {
    document.addEventListener('keydown', handleKeyDown, true); // 捕获阶段
    document.addEventListener('keyup', handleKeyUp, true);
  }

  // 清理键盘事件监听器
  function cleanupKeyboardListeners() {
    document.removeEventListener('keydown', handleKeyDown, true);
    document.removeEventListener('keyup', handleKeyUp, true);

    // 清理计时器
    if (arrowRightTimer) {
      clearTimeout(arrowRightTimer);
      arrowRightTimer = null;
    }
    arrowRightPressed = false;
  }

  // 更新键盘相关设置
  function updateKeyboardSettings() {
    // 重新计算A键切换倍速
    aKeyToggleSpeed = calculateAKeyToggleSpeed();
  }

  // 监听设置变化
  chrome.storage.onChanged.addListener((changes) => {
    let needUpdateKeyboard = false;

    // 更新本地设置
    if (changes.customSpeeds) {
      settings.customSpeeds = changes.customSpeeds.newValue;
      // 如果自定义倍速变化，重新注入
      reinjectCustomSpeeds();
    }

    if (changes.arrowRightSpeed) {
      settings.arrowRightSpeed = changes.arrowRightSpeed.newValue;
      needUpdateKeyboard = true;
    }

    if (changes.enableAKeyToggle) {
      settings.enableAKeyToggle = changes.enableAKeyToggle.newValue;
      needUpdateKeyboard = true;
    }

    if (changes.separateAToggle) {
      settings.separateAToggle = changes.separateAToggle.newValue;
      needUpdateKeyboard = true;
    }

    if (changes.separateASpeed) {
      settings.separateASpeed = changes.separateASpeed.newValue;
      needUpdateKeyboard = true;
    }

    // 如果需要，更新键盘相关设置
    if (needUpdateKeyboard) {
      updateKeyboardSettings();
    }
  });

  // 页面加载完成后初始化
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();