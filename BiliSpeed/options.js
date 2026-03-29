// 默认设置
const DEFAULT_SETTINGS = {
  customSpeeds: [],
  arrowRightSpeed: 3.0,
  enableAKeyToggle: true,
  separateAToggle: false,
  separateASpeed: 3.0
};

// DOM元素
let speedInput, addSpeedBtn, speedList, statusMessage;
let arrowRightSpeedInput, enableAKeyToggleCheckbox, separateAToggleCheckbox;
let separateASpeedInput, separateAToggleContainer, separateASpeedContainer;

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
  enableAKeyToggleCheckbox = document.getElementById('enableAKeyToggle');
  separateAToggleCheckbox = document.getElementById('separateAToggle');
  separateASpeedInput = document.getElementById('separateASpeed');
  separateAToggleContainer = document.getElementById('separateAToggleContainer');
  separateASpeedContainer = document.getElementById('separateASpeedContainer');

  // 加载设置
  loadSettings();

  // 事件监听
  addSpeedBtn.addEventListener('click', addCustomSpeed);
  speedInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') addCustomSpeed();
  });

  // 新设置项的事件监听
  arrowRightSpeedInput.addEventListener('change', saveSettings);
  enableAKeyToggleCheckbox.addEventListener('change', () => {
    saveSettings();
    updateSeparateSettingsVisibility();
  });
  separateAToggleCheckbox.addEventListener('change', () => {
    saveSettings();
    updateSeparateSettingsVisibility();
  });
  separateASpeedInput.addEventListener('change', saveSettings);

  // 初始化分离设置显示状态
  updateSeparateSettingsVisibility();
});

// 加载设置
function loadSettings() {
  chrome.storage.sync.get(DEFAULT_SETTINGS, (data) => {
    settings = data;
    updateUI();
  });
}

// 更新UI
function updateUI() {
  // 更新倍速列表
  renderSpeedList();

  // 更新键盘快捷键设置
  if (arrowRightSpeedInput) {
    arrowRightSpeedInput.value = settings.arrowRightSpeed || 3.0;
  }
  if (enableAKeyToggleCheckbox) {
    enableAKeyToggleCheckbox.checked = settings.enableAKeyToggle !== false; // 默认true
  }
  if (separateAToggleCheckbox) {
    separateAToggleCheckbox.checked = !!settings.separateAToggle;
  }
  if (separateASpeedInput) {
    separateASpeedInput.value = settings.separateASpeed || 3.0;
  }

  // 更新分离设置显示状态
  updateSeparateSettingsVisibility();
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
      <span class="speed-value">${speed.toFixed(1)}x</span>
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

  // 保留一位小数
  const speed = Math.round(value * 10) / 10;

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

  showMessage(`已添加倍速 ${speed.toFixed(1)}x`, 'success');
}

// 删除自定义倍速
function removeCustomSpeed(speed) {
  settings.customSpeeds = settings.customSpeeds.filter(s => s !== speed);
  updateUI(); // 立即更新UI
  saveSettings();
  showMessage(`已删除倍速 ${speed.toFixed(1)}x`, 'success');
}

// 保存设置
function saveSettings() {
  // 更新设置对象
  settings.arrowRightSpeed = parseFloat(arrowRightSpeedInput.value) || 3.0;
  settings.enableAKeyToggle = enableAKeyToggleCheckbox.checked;
  settings.separateAToggle = separateAToggleCheckbox.checked;
  settings.separateASpeed = parseFloat(separateASpeedInput.value) || 3.0;

  // 验证范围
  if (settings.arrowRightSpeed < 0.1) settings.arrowRightSpeed = 0.1;
  if (settings.arrowRightSpeed > 10) settings.arrowRightSpeed = 10;
  if (settings.separateASpeed < 0.1) settings.separateASpeed = 0.1;
  if (settings.separateASpeed > 10) settings.separateASpeed = 10;

  // 保存到存储
  chrome.storage.sync.set(settings, () => {
    if (chrome.runtime.lastError) {
      showMessage('保存失败: ' + chrome.runtime.lastError.message, 'error');
    } else {
      showMessage('设置已保存', 'success');
    }
  });
}

// 更新分离设置显示状态
function updateSeparateSettingsVisibility() {
  // 只有当启用A键切换时才显示分离设置选项
  if (enableAKeyToggleCheckbox.checked) {
    separateAToggleContainer.style.display = 'flex';
    if (separateAToggleCheckbox.checked) {
      separateASpeedContainer.style.display = 'flex';
    } else {
      separateASpeedContainer.style.display = 'none';
    }
  } else {
    separateAToggleContainer.style.display = 'none';
    separateASpeedContainer.style.display = 'none';
  }
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