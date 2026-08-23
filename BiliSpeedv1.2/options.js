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

// B站官方快捷键（自定义快捷键不可与其冲突）
const OFFICIAL_SHORTCUTS = [
  'q', 'w', 'e', 'r', 'g', 'space', 'ArrowRight', 'ArrowLeft', 'ArrowUp', 'ArrowDown',
  'm', 'f', 'Escape', 'd', 'Enter', 'shift+1', 'shift+2', '[', ']'
];

// 快捷键设置的显示名称
const KEY_SETTING_NAMES = {
  keyToggleSpeed: '倍速切换',
  keySpeedUp: '增加倍速',
  keySpeedDown: '减少倍速'
};

const KEY_SETTINGS = Object.keys(KEY_SETTING_NAMES);

// 直播自动最高画质的存储键（与 content-live.js 保持一致；
// 实验性功能，默认关闭）
const LIVE_HD_KEY = 'BLHD.enabled';

// DOM元素
let speedInput, addSpeedBtn, speedList, statusMessage;
let arrowRightSpeedInput, toggleSpeedInput, speedStepInput, resetDefaultsBtn;
let liveHdToggle;

// 快捷键录制状态
let recordingBtn = null; // 正在录制的按钮元素

// 恢复默认按钮的待确认状态
let resetArmed = false;
let resetArmTimer = null;

function disarmReset() {
  resetArmed = false;
  if (resetArmTimer) {
    clearTimeout(resetArmTimer);
    resetArmTimer = null;
  }
  resetDefaultsBtn.textContent = '恢复默认设置';
}

// 当前设置
let settings = { ...DEFAULT_SETTINGS };

// 初始化
document.addEventListener('DOMContentLoaded', () => {
  // 获取DOM元素
  speedInput = document.getElementById('speedInput');
  addSpeedBtn = document.getElementById('addSpeedBtn');
  speedList = document.getElementById('speedList');
  statusMessage = document.getElementById('statusMessage');
  arrowRightSpeedInput = document.getElementById('arrowRightSpeed');
  toggleSpeedInput = document.getElementById('toggleSpeed');
  speedStepInput = document.getElementById('speedStep');
  resetDefaultsBtn = document.getElementById('resetDefaultsBtn');
  liveHdToggle = document.getElementById('liveHdToggle');

  // 直播自动最高画质开关：改动即时保存，已打开的直播间实时响应
  liveHdToggle.addEventListener('change', () => {
    chrome.storage.sync.set({ [LIVE_HD_KEY]: liveHdToggle.checked }, () => {
      if (chrome.runtime.lastError) {
        showMessage('保存失败: ' + chrome.runtime.lastError.message, 'error');
      } else {
        showMessage('设置已保存', 'success');
      }
    });
  });

  // 快捷键录制按钮
  document.querySelectorAll('.key-recorder').forEach(btn => {
    btn.addEventListener('click', () => startRecording(btn));
  });
  document.addEventListener('keydown', handleRecordKeydown);
  document.addEventListener('click', (e) => {
    // 点击其他区域时取消录制
    if (recordingBtn && !recordingBtn.contains(e.target)) {
      cancelRecording();
    }
  });

  // 事件监听
  addSpeedBtn.addEventListener('click', addCustomSpeed);
  speedInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') addCustomSpeed();
  });
  arrowRightSpeedInput.addEventListener('change', saveSettings);
  toggleSpeedInput.addEventListener('change', saveSettings);
  speedStepInput.addEventListener('change', saveSettings);
  resetDefaultsBtn.addEventListener('click', () => {
    // 两步确认：首次点击进入待确认状态，再次点击才真正恢复
    if (!resetArmed) {
      resetArmed = true;
      resetDefaultsBtn.textContent = '确认恢复';
      if (resetArmTimer) clearTimeout(resetArmTimer);
      resetArmTimer = setTimeout(disarmReset, 3000);
      return;
    }
    disarmReset();
    resetToDefaults();
  });

  // 加载设置
  loadSettings();
});

// 加载设置
function loadSettings() {
  chrome.storage.sync.get(DEFAULT_SETTINGS, (data) => {
    settings = data;
    updateUI();
  });
  // 直播自动最高画质（实验性功能，默认关闭）
  chrome.storage.sync.get({ [LIVE_HD_KEY]: false }, (obj) => {
    liveHdToggle.checked = obj[LIVE_HD_KEY] === true;
  });
}

// 更新UI
function updateUI() {
  // 更新倍速列表
  renderSpeedList();

  // 更新数值设置
  if (arrowRightSpeedInput) {
    arrowRightSpeedInput.value = settings.arrowRightSpeed || 3.0;
  }
  if (toggleSpeedInput) {
    toggleSpeedInput.value = settings.toggleSpeed || 3.0;
  }
  if (speedStepInput) {
    speedStepInput.value = settings.speedStep || 0.5;
  }

  // 更新快捷键按钮显示
  document.querySelectorAll('.key-recorder').forEach(btn => {
    const key = btn.dataset.setting;
    btn.textContent = formatShortcutLabel(settings[key]);
  });
}

// 倍速显示格式与B站原生菜单一致：至少保留一位小数（3 → 3.0x，3.25 → 3.25x）
function formatSpeedLabel(speed) {
  const s = speed.toFixed(2);
  return (s.endsWith('0') ? s.slice(0, -1) : s) + 'x';
}

// 渲染倍速列表
function renderSpeedList() {
  if (settings.customSpeeds.length === 0) {
    speedList.innerHTML = '<div class="empty-state">暂无自定义倍速</div>';
    return;
  }

  // 排序（从快到慢）
  const sortedSpeeds = [...settings.customSpeeds].sort((a, b) => b - a);

  speedList.innerHTML = sortedSpeeds.map(speed => `
    <div class="speed-item">
      <span class="speed-value">${formatSpeedLabel(speed)}</span>
      <button class="btn btn-danger" data-speed="${speed}">删除</button>
    </div>
  `).join('');

  // 为删除按钮添加事件
  speedList.querySelectorAll('.btn-danger').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const speed = parseFloat(e.target.dataset.speed);
      removeCustomSpeed(speed);
    });
  });
}

// 添加自定义倍速
function addCustomSpeed() {
  const value = parseFloat(speedInput.value);

  // 验证
  if (isNaN(value)) {
    showMessage('请输入有效的数字', 'error');
    return;
  }

  if (value < 0.1 || value > 10) {
    showMessage('倍速值必须在 0.1 到 10.0 之间', 'error');
    return;
  }

  // 保留两位小数
  const speed = Math.round(value * 100) / 100;

  // 检查是否已存在
  if (settings.customSpeeds.includes(speed)) {
    showMessage('该倍速值已存在', 'error');
    return;
  }

  // 添加到列表
  settings.customSpeeds.push(speed);
  updateUI(); // 立即更新UI
  saveSettings();

  // 清空输入框
  speedInput.value = '';

  showMessage(`已添加倍速 ${formatSpeedLabel(speed)}`, 'success');
}

// 删除自定义倍速
function removeCustomSpeed(speed) {
  settings.customSpeeds = settings.customSpeeds.filter(s => s !== speed);
  updateUI(); // 立即更新UI
  saveSettings();
  showMessage(`已删除倍速 ${formatSpeedLabel(speed)}`, 'success');
}

// 保存设置
function saveSettings() {
  // 更新设置对象
  settings.arrowRightSpeed = parseFloat(arrowRightSpeedInput.value) || 3.0;
  settings.toggleSpeed = parseFloat(toggleSpeedInput.value) || 3.0;
  settings.speedStep = parseFloat(speedStepInput.value) || 0.5;

  // 验证范围
  if (settings.arrowRightSpeed < 0.1) settings.arrowRightSpeed = 0.1;
  if (settings.arrowRightSpeed > 10) settings.arrowRightSpeed = 10;
  if (settings.toggleSpeed < 0.1) settings.toggleSpeed = 0.1;
  if (settings.toggleSpeed > 10) settings.toggleSpeed = 10;
  if (settings.speedStep < 0.01) settings.speedStep = 0.01;
  if (settings.speedStep > 10) settings.speedStep = 10;

  // 保存到存储
  chrome.storage.sync.set(settings, () => {
    if (chrome.runtime.lastError) {
      showMessage('保存失败: ' + chrome.runtime.lastError.message, 'error');
    } else {
      showMessage('设置已保存', 'success');
    }
  });
}

// 恢复默认设置（保留自定义倍速）
function resetToDefaults() {
  const keptSpeeds = [...settings.customSpeeds];
  settings = { ...DEFAULT_SETTINGS, customSpeeds: keptSpeeds };
  updateUI();
  saveSettings();
  // 实验性功能一并恢复默认（关闭）
  liveHdToggle.checked = false;
  chrome.storage.sync.set({ [LIVE_HD_KEY]: false });
  showMessage('已恢复默认设置（自定义倍速已保留）', 'success');
}

// 将快捷键字符串转为显示文本，如 "ctrl+z" -> "Ctrl+Z"、"ArrowRight" -> "→"、"none" -> "无"
function formatShortcutLabel(shortcut) {
  if (!shortcut) return '未设置';
  if (shortcut === 'none') return '无';
  const displayNames = {
    'ArrowRight': '→', 'ArrowLeft': '←', 'ArrowUp': '↑', 'ArrowDown': '↓',
    'space': '空格', 'Escape': 'Esc'
  };
  return shortcut.split('+').map(part => {
    if (part === 'ctrl') return 'Ctrl';
    if (part === 'alt') return 'Alt';
    if (part === 'shift') return 'Shift';
    if (displayNames[part]) return displayNames[part];
    return part.length === 1 ? part.toUpperCase() : part;
  }).join('+');
}

// 将物理按键代码转为主键字符串（基于 event.code，不受输入法/Shift 影响，与 content-video.js 保持一致）
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
  };
  return codeKeyMap[code] || code;
}

// 将录制到的键盘事件归一化为快捷键字符串
function shortcutFromEvent(e) {
  const key = keyFromCode(e.code);
  if (!key) return '';
  const modifiers = [];
  if (e.ctrlKey) modifiers.push('ctrl');
  if (e.altKey) modifiers.push('alt');
  if (e.shiftKey) modifiers.push('shift');
  return modifiers.length ? `${modifiers.join('+')}+${key}` : key;
}

// 开始录制快捷键
function startRecording(btn) {
  if (recordingBtn === btn) return;
  if (recordingBtn) cancelRecording();
  recordingBtn = btn;
  btn.classList.add('recording');
  btn.textContent = '按下按键…';
}

// 取消录制
function cancelRecording() {
  if (!recordingBtn) return;
  recordingBtn.classList.remove('recording');
  recordingBtn.textContent = formatShortcutLabel(settings[recordingBtn.dataset.setting]);
  recordingBtn = null;
}

// 处理录制时的按键
function handleRecordKeydown(e) {
  if (!recordingBtn) return;
  e.preventDefault();
  e.stopPropagation();

  // Esc 取消录制
  if (e.key === 'Escape') {
    cancelRecording();
    return;
  }

  // 忽略单独按下修饰键
  if (['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) return;

  // 忽略不方便作为快捷键的键
  if (['Tab', 'Backspace', 'CapsLock'].includes(e.key)) {
    showMessage('该键不能设置为快捷键', 'error');
    cancelRecording();
    return;
  }

  const settingKey = recordingBtn.dataset.setting;

  // 按 Del 设为"无"，停用该功能的快捷键
  if (e.key === 'Delete') {
    settings[settingKey] = 'none';
    recordingBtn.classList.remove('recording');
    recordingBtn.textContent = '无';
    recordingBtn = null;
    saveSettings();
    showMessage('已停用该功能的快捷键', 'success');
    return;
  }

  const shortcut = shortcutFromEvent(e);

  // 校验是否与B站官方快捷键冲突
  if (OFFICIAL_SHORTCUTS.includes(shortcut)) {
    showMessage(`"${formatShortcutLabel(shortcut)}" 是B站官方快捷键，不能使用`, 'error');
    cancelRecording();
    return;
  }

  // 校验是否与其他功能的快捷键冲突（"无"允许多个功能同时设置）
  for (const otherKey of KEY_SETTINGS) {
    if (shortcut !== 'none' && otherKey !== settingKey && settings[otherKey] === shortcut) {
      showMessage(`该按键已被"${KEY_SETTING_NAMES[otherKey]}"功能使用`, 'error');
      cancelRecording();
      return;
    }
  }

  settings[settingKey] = shortcut;
  recordingBtn.classList.remove('recording');
  recordingBtn.textContent = formatShortcutLabel(shortcut);
  recordingBtn = null;
  saveSettings();
}

// 显示状态消息
function showMessage(text, type = 'success') {
  statusMessage.textContent = text;
  statusMessage.className = `status-message status-${type}`;

  // 3秒后隐藏
  setTimeout(() => {
    statusMessage.className = 'status-message';
  }, 3000);
}
