/**
 * Bilibili Live Auto HD — 进入直播间后自动选择最高画质
 *
 * 原理（基于 2026-08 对 live.bilibili.com Room Player 3.11.8 的实测）：
 *  - 直播间播放器控制栏由 Svelte 动态渲染，鼠标无交互时 DOM 不存在；
 *    派发合成 mousemove 实测可触发控制栏渲染，MutationObserver 兜底。
 *  - 点击控制栏的画质按钮(.quality-wrap)后渲染菜单面板(.panel)，
 *    画质项(.list-it)从上到下 = 从高到低，当前项带 .selected 类。
 *  - 注意：element.click() 那种孤立 click 事件打不开画质菜单（实测），
 *    必须派发完整的按下/抬起事件序列，见 simulateRealClick。
 *  - B 站所有类名带 svelte-哈希 后缀（随版本变化），
 *    因此选择器统一用 [class*="..."] 模糊匹配；菜单最后一项是
 *    "画质增强"开关（内含 .video-enhance），不是画质项，必须排除。
 *
 * 日志：所有输出带 [BLHD] 前缀，直播间页面按 F12 → Console 过滤 BLHD 查看。
 */
(() => {
  'use strict';

  // ========== 配置区：B 站改版时通常只需改这里 ==========
  const SELECTORS = {
    playerMount: '#live-player',                          // 播放器挂载点（等它出现再开始）
    qualityWrap: '[class*="quality-wrap"]',               // 控制栏里的画质按钮
    currentQualityText: '[class*="quality-wrap"] [class*="selected-qn"]', // 按钮上显示的当前画质
    panel: '[class*="quality-wrap"] [class*="panel"]',    // 点击按钮后弹出的菜单面板
    menuItem: '[class*="list-it"]',                       // 面板里的菜单项（画质 + 画质增强开关）
    enhanceToggle: '[class*="video-enhance"]',            // "画质增强"开关（要排除的项）
  };
  const STORAGE_KEY = 'BLHD.enabled';   // chrome.storage key，合并到其他扩展时避免冲突
  const LOG_PREFIX = '[BLHD]';
  const RETRY_MAX = 15;        // 整个流程最多重试次数（每次间隔 1s，覆盖播放器慢加载）
  const RETRY_INTERVAL_MS = 1000;
  const PANEL_WAIT_MS = 2000;  // 点击画质按钮后等菜单渲染
  const PANEL_STABILIZE_MS = 500; // 菜单渲染后等监听器/动画就绪再点击（太快会被吞掉）
  const SWITCH_VERIFY_MS = 3500; // 点击画质项后等切换生效
  const CONTROLBAR_WAIT_MS = 1500; // 派发合成事件后等控制栏渲染

  // ========== 日志 ==========
  const log = (...args) => console.log(LOG_PREFIX, new Date().toLocaleTimeString(), ...args);
  const warn = (...args) => console.warn(LOG_PREFIX, new Date().toLocaleTimeString(), ...args);

  // ========== 状态 ==========
  let enabled = true;            // 设置开关
  let currentRoomPath = '';      // 当前房间 pathname（SPA 切房间时变化）
  let entryDone = false;         // 本次进入房间是否已处理完（成功或确认失败）
  let attemptSeq = 0;            // 流程序号：pathname 变化时 +1，旧流程检测到过期自行退出
  let switching = false;         // 正在执行切换，防止 MutationObserver 重入
  let bodyObserver = null;       // 兜底：捕获控制栏出现
  let urlTimer = null;           // SPA 房间切换轮询

  // ========== 工具函数 ==========
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  /**
   * 处理两类页面：
   *  - /{数字}：普通直播间（顶层页面）
   *  - /blanc/{数字}：精简直播间（赛事/活动房间的播放器嵌在 blanc iframe 里，
   *    需 manifest 配置 all_frames 注入，控件结构与普通直播间完全一致）
   */
  const isRoomPage = () =>
    /^\/\d+\/?$/.test(location.pathname) || /^\/blanc\/\d+\/?$/.test(location.pathname);

  /** 轮询等待条件成立，超时返回 false */
  function waitUntil(cond, timeoutMs, intervalMs = 150) {
    return new Promise((resolve) => {
      const startedAt = Date.now();
      const timer = setInterval(() => {
        if (cond()) { clearInterval(timer); resolve(true); return; }
        if (Date.now() - startedAt > timeoutMs) { clearInterval(timer); resolve(false); }
      }, intervalMs);
    });
  }

  /** 轮询等待元素出现；finder 是选择器字符串或返回元素的函数；超时返回 null */
  function waitForElement(finder, timeoutMs, intervalMs = 150) {
    const find = typeof finder === 'function' ? finder : () => document.querySelector(finder);
    return waitUntil(() => find() != null, timeoutMs, intervalMs).then(() => find());
  }

  /** 取菜单面板里的画质项列表（从高到低），排除"画质增强"开关和空项 */
  function getQualityItems(panel) {
    return [...panel.querySelectorAll(SELECTORS.menuItem)].filter(
      (el) => el.textContent.trim() && !el.querySelector(SELECTORS.enhanceToggle)
    );
  }

  /**
   * 派发合成鼠标移动事件，触发 B 站播放器显示控制栏。
   * 未实测保证有效（浏览器安全策略无法预验），MutationObserver 是兜底路径。
   */
  function showControlBar() {
    const target = document.querySelector(SELECTORS.playerMount) || document.body;
    const rect = target.getBoundingClientRect();
    const opts = {
      bubbles: true,
      cancelable: true,
      clientX: rect.left + rect.width / 2,
      clientY: rect.top + rect.height / 2,
    };
    target.dispatchEvent(new MouseEvent('mousemove', opts));
    target.dispatchEvent(new PointerEvent('pointermove', opts));
  }

  /**
   * 派发接近真实用户的完整交互事件序列（hover + 按下 + 抬起 + 点击）。
   * 背景（实测）：element.click() 只派发孤立的 click 事件，打不开 B 站
   * 画质菜单——按钮监听的是按下类事件（mousedown/pointerdown）；
   * 因此对所有点击统一派发完整序列。
   */
  function simulateRealClick(el) {
    const rect = el.getBoundingClientRect();
    const base = {
      bubbles: true,
      cancelable: true,
      view: window,
      clientX: rect.left + rect.width / 2,
      clientY: rect.top + rect.height / 2,
    };
    const enter = { ...base, bubbles: false };          // enter 类事件不冒泡
    const ptr = { ...base, pointerId: 1, pointerType: 'mouse', isPrimary: true };
    const ptrEnter = { ...enter, pointerId: 1, pointerType: 'mouse', isPrimary: true };
    el.dispatchEvent(new PointerEvent('pointerover', ptr));
    el.dispatchEvent(new MouseEvent('mouseover', base));
    el.dispatchEvent(new PointerEvent('pointerenter', ptrEnter));
    el.dispatchEvent(new MouseEvent('mouseenter', enter));
    el.dispatchEvent(new PointerEvent('pointermove', ptr));
    el.dispatchEvent(new MouseEvent('mousemove', base));
    el.dispatchEvent(new PointerEvent('pointerdown', ptr));
    el.dispatchEvent(new MouseEvent('mousedown', base));
    el.dispatchEvent(new PointerEvent('pointerup', ptr));
    el.dispatchEvent(new MouseEvent('mouseup', base));
    el.dispatchEvent(new MouseEvent('click', base));
  }

  /**
   * 收起画质菜单面板。B 站点击画质项后面板不会自动关闭（实测：再点画质
   * 按钮、点击面板外空白都无效），唯一关闭方式是鼠标离开播放器区域——
   * 控制栏和面板随之隐藏。因此派发合成 leave 事件到播放器容器模拟离开。
   */
  async function dismissPanel() {
    if (!document.querySelector(SELECTORS.panel)) return; // 已经关闭
    const player = document.querySelector(SELECTORS.playerMount) || document.body;
    const rect = player.getBoundingClientRect();
    const leave = {
      bubbles: false, cancelable: true, view: window,
      clientX: rect.right + 60, clientY: rect.top - 60, // 播放器之外的坐标
    };
    const ptrLeave = { ...leave, pointerId: 1, pointerType: 'mouse', isPrimary: true };
    player.dispatchEvent(new PointerEvent('pointerleave', ptrLeave));
    player.dispatchEvent(new MouseEvent('mouseleave', leave));
    player.dispatchEvent(new PointerEvent('pointerout', { ...ptrLeave, bubbles: true }));
    player.dispatchEvent(new MouseEvent('mouseout', { ...leave, bubbles: true }));
    if (await waitUntil(() => !document.querySelector(SELECTORS.panel), 1500)) {
      log('已模拟鼠标离开，收起画质菜单');
      return;
    }
    warn('未能自动收起画质菜单（不影响功能，动一下鼠标即可隐藏）');
  }

  // ========== 核心：切换到最高画质 ==========
  /** 前提：画质按钮(.quality-wrap)已存在。返回 'success' | 'no-menu' | 'switch-failed' */
  async function switchToTopQuality() {
    // 控制栏可能在上一瞬间自动隐藏，重新获取；消失则让外层整轮重试
    const wrap = document.querySelector(SELECTORS.qualityWrap);
    if (!wrap) { log('控制栏已消失，稍后重试'); return 'no-menu'; }

    const currentTextEl = document.querySelector(SELECTORS.currentQualityText);
    log('控制栏已出现，当前画质:', currentTextEl ? currentTextEl.textContent.trim() : '未知');

    // 1. 打开画质菜单（可能已打开）
    let panel = document.querySelector(SELECTORS.panel);
    if (!panel) {
      simulateRealClick(wrap);
      log('已点击画质按钮(完整事件序列)，等待菜单渲染…');
      panel = await waitForElement(() => document.querySelector(SELECTORS.panel), PANEL_WAIT_MS);
      if (!panel) { warn('画质菜单未渲染出来'); return 'no-menu'; }
      await sleep(PANEL_STABILIZE_MS); // 刚渲染就点击会被 B 站播放器吞掉（实测）
    }

    // 2. 选最高画质（第一项）
    const items = getQualityItems(panel);
    if (items.length === 0) {
      warn('菜单里没有找到画质项（DOM 结构可能已变化）');
      await dismissPanel();
      return 'no-menu';
    }
    log('可选画质(从高到低):', items.map((el) => el.textContent.trim()).join(' | '));

    const top = items[0];
    if (top.classList.contains('selected')) {
      log('当前已是最高画质，无需切换:', top.textContent.trim());
      await dismissPanel();
      return 'success';
    }

    log('点击最高画质:', top.textContent.trim());
    // 目标短名：按钮上显示的是简称，如"1080P 原画（高帧率）"→"1080P 原画"
    const targetShortName = top.textContent.trim().replace(/（.*?）/, '').trim();
    simulateRealClick(top);

    // 3. 验证生效。两个成功条件（重新查询，Svelte 可能重建 DOM，不依赖旧引用）：
    //    a. 面板里第一项带 selected；
    //    b. 点击导致面板收起时，按钮文字已变成目标画质
    const verified = await waitForElement(() => {
      const p = document.querySelector(SELECTORS.panel);
      if (p) {
        const first = getQualityItems(p)[0];
        if (first && first.classList.contains('selected')) return first;
      }
      const cur = document.querySelector(SELECTORS.currentQualityText);
      if (cur && targetShortName && cur.textContent.trim().includes(targetShortName)) return cur;
      return null;
    }, SWITCH_VERIFY_MS);

    if (verified) {
      const nowText = document.querySelector(SELECTORS.currentQualityText);
      log('✅ 切换成功，当前画质:', nowText ? nowText.textContent.trim() : verified.textContent.trim());
      await dismissPanel();
      return 'success';
    }
    warn('❌ 本轮点击未见生效，稍后重试（可能点击太快被吞或该画质需要权限）');
    await dismissPanel();
    return 'switch-failed';
  }

  /**
   * 对当前房间执行完整流程（带重试）。seq 是启动时的 attemptSeq，
   * pathname 变化后 seq 过期，流程自行退出。
   */
  async function ensureTopQuality(seq) {
    for (let attempt = 1; attempt <= RETRY_MAX; attempt++) {
      if (seq !== attemptSeq) return; // 已进入其他房间，放弃本次流程

      // 活动房间外壳页可能动态插入 blanc iframe，发现后交由 iframe 实例处理
      if (window.top === window.self && document.querySelector('iframe[src*="/blanc/"]')) {
        log('检测到活动房间（播放器在 iframe 内），由 iframe 中的扩展实例处理');
        entryDone = true;
        return;
      }

      let wrap = document.querySelector(SELECTORS.qualityWrap);
      if (!wrap) {
        if (attempt === 1) log('等待播放器就绪…');
        showControlBar(); // 主动触发控制栏
        wrap = await waitForElement(SELECTORS.qualityWrap, CONTROLBAR_WAIT_MS);
        if (seq !== attemptSeq) return;
        if (!wrap) continue; // 合成事件可能无效，等下一轮或用户动鼠标（observer 兜底）
      }

      switching = true;
      let result;
      try {
        result = await switchToTopQuality();
      } finally {
        switching = false;
      }
      if (seq !== attemptSeq) return;

      if (result === 'success') { entryDone = true; return; }
      // 'no-menu' 或 'switch-failed'：稍后整轮重试（偶发失败如点击太快被吞，
      // 重试可恢复；真无权限时由 RETRY_MAX 上限兜底，不会死循环）
      await sleep(RETRY_INTERVAL_MS);
    }
    if (seq === attemptSeq) warn(`重试 ${RETRY_MAX} 次未成功，放弃（房间可能未开播或页面结构变化）`);
  }

  /** 每次进入房间（含 SPA 切换）时调用 */
  function onEnterRoom() {
    log('进入直播间:', location.pathname.replace(/\//g, ''));
    entryDone = false;
    ensureTopQuality(++attemptSeq);
  }

  // ========== 监听：SPA 房间切换 + 控制栏出现兜底 ==========
  function watchNavigation() {
    urlTimer = setInterval(() => {
      if (location.pathname === currentRoomPath) return;
      currentRoomPath = location.pathname;
      if (isRoomPage()) onEnterRoom();
    }, 500);
  }

  function startBodyObserver() {
    stopBodyObserver();
    bodyObserver = new MutationObserver(() => {
      if (!enabled || entryDone || switching) return;
      if (!document.querySelector(SELECTORS.qualityWrap)) return;
      // 控制栏出现了（用户动鼠标或合成事件生效），且本房间尚未处理完
      ensureTopQuality(++attemptSeq);
    });
    bodyObserver.observe(document.body, { childList: true, subtree: true });
  }
  function stopBodyObserver() {
    if (bodyObserver) { bodyObserver.disconnect(); bodyObserver = null; }
  }

  // ========== 设置实时生效 ==========
  function watchStorage() {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'sync' || !(STORAGE_KEY in changes)) return;
      enabled = changes[STORAGE_KEY].newValue === true;
      if (enabled) {
        log('设置变更：功能已开启，对当前房间生效');
        entryDone = false;
        startBodyObserver();
        ensureTopQuality(++attemptSeq);
      } else {
        log('设置变更：功能已关闭（已打开的直播间停止处理）');
        attemptSeq++; // 让进行中的流程退出
      }
    });
  }

  async function getEnabled() {
    try {
      const obj = await chrome.storage.sync.get({ [STORAGE_KEY]: false });
      return obj[STORAGE_KEY] === true;
    } catch (e) {
      warn('读取设置失败，按默认关闭处理:', e);
      return false;
    }
  }

  // ========== 入口 ==========
  async function main() {
    if (!isRoomPage()) return;
    // 赛事/活动房间：顶层页面只是外壳，播放器嵌在 /blanc/ iframe 里，
    // 画质逻辑由注入 iframe 的脚本实例（all_frames）处理，顶层实例跳过
    if (window.top === window.self && document.querySelector('iframe[src*="/blanc/"]')) {
      log('检测到活动房间（播放器在 iframe 内），由 iframe 中的扩展实例处理');
      return;
    }
    enabled = await getEnabled();
    if (!enabled) {
      log('功能已在扩展设置中关闭，不处理');
      watchStorage(); // 设置页打开后可实时生效
      return;
    }
    log('扩展已加载（功能开启）');
    currentRoomPath = location.pathname;
    watchNavigation();
    startBodyObserver();
    watchStorage();
    onEnterRoom();
  }

  main();
})();
