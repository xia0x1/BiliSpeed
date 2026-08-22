// BiliSpeed - 视频页面增强
(function() {
  'use strict';

  // 默认设置
  const DEFAULT_SETTINGS = {
    customSpeeds: [],
    arrowRightSpeed: 3.0,
    toggleSpeed: 3.0,
    speedStep: 0.5,
    keyToggleSpeed: 'a',
    keySpeedUp: 'x',
    keySpeedDown: 'z'
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
  let arrowRightPressTime = 0;
  let isLongPressTriggered = false;
  const SEEK_STEP = 5; // 快进步长（秒）

  // 初始化
  function init() {
    // 加载设置
    loadSettings(() => {
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
        hideRateToast();
      }
    } else if (newVideoElement) {
      videoElement = newVideoElement;
    } else {
      videoElement = null;
    }

    // 监听倍速变化事件（须在 videoElement 赋值后挂载），保证原生改动倍速后同步选中态
    if (videoElement) attachRateChangeListener();

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
      li.textContent = `${Number(speed.toFixed(2))}x`;

      // 复制原生菜单项的样式和类名
      const nativeItem = playbackRateList.querySelector('li:not([data-bili-enhancer-custom])');
      if (nativeItem) {
        // 复制类名（排除可能存在的激活状态类）
        li.className = nativeItem.className.replace(/\bbpx-player-ctrl-playbackrate-active\b/g, '');
        // 复制内联样式，但去掉颜色，避免内联色覆盖选中态的变色
        li.style.cssText = nativeItem.style.cssText;
        li.style.removeProperty('color');
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
    // 始终作用于当前页面最新的倍速菜单，避免操作已被B站重建的旧列表
    const liveList = document.querySelector('.bpx-player-ctrl-playbackrate ul');
    if (liveList) playbackRateList = liveList;
    if (!playbackRateList) return;

    // 优先从原生选中项读取选中色，保证与原生变蓝效果完全一致
    const nativeActive = playbackRateList.querySelector(
      'li:not([data-bili-enhancer-custom]).bpx-player-ctrl-playbackrate-active'
    );
    const nativeInactive = playbackRateList.querySelector(
      'li:not([data-bili-enhancer-custom]):not(.bpx-player-ctrl-playbackrate-active)'
    );
    let activeColor = '';
    if (nativeActive && nativeInactive) {
      const active = getComputedStyle(nativeActive).color;
      const inactive = getComputedStyle(nativeInactive).color;
      if (active && active !== inactive) activeColor = active;
    }
    if (!activeColor) {
      const anchor = playbackRateMenu || document.body;
      activeColor = getComputedStyle(anchor).getPropertyValue('--bpx-primary-color').trim() || '#00a1d6';
    }

    // 移除所有选中状态
    playbackRateList.querySelectorAll('li').forEach(li => {
      li.classList.remove('bpx-player-ctrl-playbackrate-active');
      if (li.hasAttribute('data-bili-enhancer-custom')) li.style.color = '';
    });

    // 找到对应的倍速项并添加选中状态
    const listItems = playbackRateList.querySelectorAll('li');
    for (const li of listItems) {
      const text = li.textContent.trim();
      const match = text.match(/[\d.]+/);
      if (match && Math.abs(parseFloat(match[0]) - speed) < 0.01) {
        li.classList.add('bpx-player-ctrl-playbackrate-active');
        // 自定义项同时写入选中色，确保像原生一样变色
        if (li.hasAttribute('data-bili-enhancer-custom')) li.style.color = activeColor;
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

  // 监听 video 的倍速变化（原生点击、官方快捷键等任何来源），同步菜单选中态
  let rateChangeTarget = null;

  function handleRateChange() {
    if (videoElement) updateSelectedSpeed(videoElement.playbackRate);
  }

  function attachRateChangeListener() {
    if (rateChangeTarget === videoElement) return;
    if (rateChangeTarget) {
      rateChangeTarget.removeEventListener('ratechange', handleRateChange);
    }
    rateChangeTarget = videoElement;
    videoElement.addEventListener('ratechange', handleRateChange);
  }

  // 长按倍速功能固定使用 → 键，不提供自定义
  const LONG_PRESS_KEY = 'ArrowRight';

  // 将物理按键代码转为主键字符串（基于 event.code，不受输入法/Shift 影响）
  function keyFromCode(code) {
    if (!code) return '';
    if (code.startsWith('Key')) return code.slice(3).toLowerCase();
    if (code.startsWith('Digit')) return code.slice(5);
    const codeKeyMap = {
      Space: 'space',
      BracketLeft: '[',
      BracketRight: ']',
      Semicolon: ';',
      Quote: "'",
      Comma: ',',
      Period: '.',
      Slash: '/',
      Backslash: '\\',
      Minus: '-',
      Equal: '='
      // ArrowRight/ArrowLeft/ArrowUp/ArrowDown/Escape/Enter 的 code 与显示名相同
    };
    return codeKeyMap[code] || code;
  }

  // 将键盘事件归一化为快捷键字符串，如 "z"、"ctrl+z"、"shift+x"、"ArrowRight"
  function shortcutFromEvent(event) {
    const key = keyFromCode(event.code);
    if (!key) return '';
    const modifiers = [];
    if (event.ctrlKey) modifiers.push('ctrl');
    if (event.altKey) modifiers.push('alt');
    if (event.shiftKey) modifiers.push('shift');
    return modifiers.length ? `${modifiers.join('+')}+${key}` : key;
  }

  // 判断键盘事件是否匹配快捷键设置（设置值由设置页录制生成，格式与此处归一化一致；'none' 表示停用）
  function matchesShortcut(event, shortcutStr) {
    if (!shortcutStr || shortcutStr === 'none') return false;
    return shortcutFromEvent(event) === shortcutStr;
  }

  // 正在输入框/富文本中打字时不触发快捷键
  function isTypingTarget(target) {
    if (!target) return false;
    const tag = target.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
  }

  // 倍速提示浮层（挂到播放器内部，全屏时也能显示）
  let rateToast = null;
  let rateToastTimer = null;

  // sticky 为 true 时持续显示（长按中），否则 800ms 后自动淡出
  function showRateToast(sticky = false) {
    if (!videoElement) return;
    const container = videoElement.closest('.bpx-player-video-area') || videoElement.parentElement;
    if (!container) return;

    if (!rateToast || !container.contains(rateToast)) {
      if (rateToast) rateToast.remove();
      rateToast = document.createElement('div');
      Object.assign(rateToast.style, {
        position: 'absolute',
        top: '4%',
        left: '50%',
        transform: 'translateX(-50%)',
        padding: '4px 28px',
        background: 'rgba(0,0,0,0.6)',
        color: '#fff',
        fontSize: '18px',
        fontWeight: 'bold',
        borderRadius: '4px',
        zIndex: '99999',
        pointerEvents: 'none',
        transition: 'opacity 0.3s'
      });
      container.appendChild(rateToast);
    }

    rateToast.textContent = `${Number(videoElement.playbackRate.toFixed(2))}x`;
    rateToast.style.opacity = '1';
    if (rateToastTimer) {
      clearTimeout(rateToastTimer);
      rateToastTimer = null;
    }
    if (!sticky) {
      rateToastTimer = setTimeout(() => {
        if (rateToast) rateToast.style.opacity = '0';
      }, 800);
    }
  }

  // 立即隐藏浮层
  function hideRateToast() {
    if (rateToastTimer) {
      clearTimeout(rateToastTimer);
      rateToastTimer = null;
    }
    if (rateToast) rateToast.style.opacity = '0';
  }

  // 步进调节倍速（delta 为正增加、为负减少）
  function stepPlaybackRate(delta) {
    const step = settings.speedStep || 0.5;
    const rate = Math.min(10, Math.max(0.1, Math.round((videoElement.playbackRate + delta * step) * 100) / 100));
    videoElement.playbackRate = rate;
    updateSelectedSpeed(rate);
    showRateToast();
  }

  // 处理键盘按下事件
  function handleKeyDown(event) {
    // 只在视频元素存在时处理
    if (!videoElement) return;

    // 输入框中打字时不触发快捷键
    if (isTypingTarget(event.target)) return;

    // 长按倍速（固定 → 键）
    if (matchesShortcut(event, LONG_PRESS_KEY)) {
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
            // 长按触发，应用自定义倍速，浮层持续显示直到松开
            isLongPressTriggered = true;
            videoElement.playbackRate = settings.arrowRightSpeed;
            updateSelectedSpeed(videoElement.playbackRate);
            showRateToast(true);
          }
        }, 300); // 300ms后应用倍速，模拟长按
      }
      return;
    }

    // 按住不放产生的重复按键不响应，避免倍速连续跳变
    if (event.repeat) return;

    // 增加倍速键
    if (matchesShortcut(event, settings.keySpeedUp)) {
      event.preventDefault();
      event.stopPropagation();
      stepPlaybackRate(1);
      return;
    }

    // 减少倍速键
    if (matchesShortcut(event, settings.keySpeedDown)) {
      event.preventDefault();
      event.stopPropagation();
      stepPlaybackRate(-1);
      return;
    }

    // 倍速切换键
    if (matchesShortcut(event, settings.keyToggleSpeed)) {
      event.preventDefault();
      event.stopPropagation();

      const targetSpeed = settings.toggleSpeed;
      const currentSpeed = videoElement.playbackRate;

      // 检查当前倍速是否已经是目标倍速
      if (Math.abs(currentSpeed - targetSpeed) < 0.005) {
        // 恢复到切换前的倍速
        videoElement.playbackRate = lastPlaybackRateBeforeToggle;
      } else {
        // 保存当前倍速，切换到目标倍速
        lastPlaybackRateBeforeToggle = currentSpeed;
        videoElement.playbackRate = targetSpeed;
      }

      updateSelectedSpeed(videoElement.playbackRate);
      showRateToast();
      return;
    }
  }

  // 处理键盘释放事件
  function handleKeyUp(event) {
    // 长按倍速键释放
    if (matchesShortcut(event, LONG_PRESS_KEY)) {
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

        // 长按已触发：恢复原始倍速，浮层直接隐藏（不显示恢复后的倍速）
        if (isLongPressTriggered && videoElement) {
          videoElement.playbackRate = originalPlaybackRate;
          updateSelectedSpeed(videoElement.playbackRate);
          hideRateToast();
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

    // 点击B站原生倍速菜单后强制同步选中态（兜底，防止自定义项选中色残留）
    document.addEventListener('click', (event) => {
      if (!videoElement) return;
      if (event.target?.closest?.('.bpx-player-ctrl-playbackrate')) {
        setTimeout(() => updateSelectedSpeed(videoElement.playbackRate), 0);
      }
    }, true);
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

  // 监听设置变化
  chrome.storage.onChanged.addListener((changes) => {
    if (changes.customSpeeds) {
      settings.customSpeeds = changes.customSpeeds.newValue;
      // 如果自定义倍速变化，重新注入
      reinjectCustomSpeeds();
    }

    if (changes.arrowRightSpeed) {
      settings.arrowRightSpeed = changes.arrowRightSpeed.newValue;
    }

    if (changes.toggleSpeed) {
      settings.toggleSpeed = changes.toggleSpeed.newValue;
    }

    if (changes.speedStep) {
      settings.speedStep = changes.speedStep.newValue;
    }

    // 快捷键位变化时更新本地引用即可
    for (const key of ['keyToggleSpeed', 'keySpeedUp', 'keySpeedDown']) {
      if (changes[key]) {
        settings[key] = changes[key].newValue;
      }
    }
  });

  // 页面加载完成后初始化
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();