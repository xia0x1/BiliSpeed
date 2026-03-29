// 默认设置
const DEFAULT_SETTINGS = {
  customSpeeds: [],
  arrowRightSpeed: 3.0,
  enableAKeyToggle: true,
  separateAToggle: false,
  separateASpeed: 3.0
};

// 扩展安装或更新时初始化设置
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.sync.get(DEFAULT_SETTINGS, (data) => {
    // 合并默认设置，确保所有字段都存在
    const mergedSettings = { ...DEFAULT_SETTINGS, ...data };
    chrome.storage.sync.set(mergedSettings);
  });
});

// 监听来自content script的消息
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'GET_SETTINGS') {
    chrome.storage.sync.get(DEFAULT_SETTINGS, sendResponse);
    return true; // 保持消息通道开放用于异步响应
  }
});

// 点击工具栏图标时打开选项页
chrome.action.onClicked.addListener(() => {
  chrome.runtime.openOptionsPage();
});