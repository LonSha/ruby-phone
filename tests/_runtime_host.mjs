/* ============================================================
 * tests/_runtime_host.mjs — 零依赖最小宿主夹具（运行时冒烟层基础设施）[v2.82.0]
 * ------------------------------------------------------------
 * 为什么需要（`计划.txt` 的原话）：
 *   「新增一个浏览器运行时冒烟层，**不要直接把所有 UI 测试塞进 npm test**。
 *     可以保持仓库零依赖门禁不变，使用独立的 Playwright / 浏览器环境运行。」
 *
 * 本环境的**硬约束**（已实测，不猜）：
 *   · 仓库无 node_modules、无 playwright / puppeteer / jsdom（grep 零命中）；
 *   · 无网络（`npx --no-install playwright --version` → missing packages）。
 *   ⇒ 真·浏览器层在本仓库**不可运行**。诚实降级为：
 *     **进程内最小宿主夹具 + 加载真实模块** —— 不仿真浏览器，只提供模块真正
 *     用到的那几个宿主面（window / document / CustomEvent / MutationObserver /
 *     SillyTavern.getContext() / localStorage），并**登记每一次 addEventListener**，
 *     于是「重建 N 轮后监听器还剩几个」这类读数可以直接被断言。
 *
 * 本夹具**不声称**能替代浏览器：
 *   · 不渲染真实 DOM（querySelector 一律返回 null）；
 *   · 不执行 CSS/布局/命中测试；
 *   · 不覆盖「窄屏长文本深色主题溢出」这类需要真实排版的问题。
 *   可覆盖的与不可覆盖的边界写在 docs/runtime-verification-boundary.md。
 *
 * 用法（在 *.test.mjs 内）：
 *   const host = installRuntimeHost();
 *   host.document / host.window / host.storage
 *   host.listeners()            // [{ target, type }] 当前登记的全局监听器
 *   host.uninstall()
 * ============================================================ */

/** 造一个「什么都接得住」的 DOM 元素/对象替身，并登记 addEventListener。 */
function makeTarget(name, registry) {
  const el = {
    __hostName: name,
    addEventListener(type, handler, opts) {
      registry.push({ target: name, type, handler, opts });
    },
    removeEventListener(type, handler) {
      const i = registry.findIndex(
        (r) => r.target === name && r.type === type && r.handler === handler);
      if (i >= 0) registry.splice(i, 1);
    },
    dispatchEvent() { return true; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    closest() { return null; },
    contains() { return false; },
    appendChild(c) { return c; },
    append() {},
    prepend() {},
    insertBefore(c) { return c; },
    removeChild(c) { return c; },
    replaceChildren() {},
    remove() {},
    setAttribute() {},
    getAttribute() { return null; },
    removeAttribute() {},
    hasAttribute() { return false; },
    toggleAttribute() {},
    focus() {},
    blur() {},
    click() {},
    add() {},
    scrollIntoView() {},
    getBoundingClientRect() {
      return { width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0, x: 0, y: 0 };
    },
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    style: { setProperty() {}, removeProperty() {}, getPropertyValue() { return ''; } },
    dataset: {},
    innerHTML: '',
    textContent: '',
    value: '',
    children: [],
    childNodes: [],
    firstChild: null,
    parentNode: null,
    offsetWidth: 0,
    offsetHeight: 0,
    scrollTop: 0,
    scrollHeight: 0,
    clientWidth: 0,
    clientHeight: 0
  };
  return el;
}

/**
 * 安装最小宿主。
 * @param {{chatLength?:number, chatMetadata?:object, chatId?:string,
 *          settings?:object, storage?:object, saveChatFails?:number}} [opts]
 *   [v3.4.1 · P-5] `saveChatFails: N` —— 让**前 N 次** `saveChat()` 抛错（默认 0 ⇒ 行为与加它之前逐字一致）。
 *     为什么加它：`config/storage.js` 的 `_debouncedSaveChat` 有一整套「串行队列 + 四档退避重试
 *     （0/350/900/1800ms）+ 放弃」的逻辑，而它在 P-5 之前**从来没有被任何判据观察过** ——
 *     默认的 `saveChat: async () => {}` 永远成功，于是「重试了几次」「放弃后是什么状态」全是空白。
 *     实测确认：夹具**本来就可以**通过 `host.context.saveChat = …` 换掉（所以「夹具不可控」是条错记载），
 *     但把这件事做成显式入参，使「注入失败」成为一眼可读的一等用法，而不是各测试各写一遍替换。
 *   另暴露 `host.saveChatCalls()`：真实调用次数（含重试），判据据此断言而不是靠外部闭包。
 * @returns {object} 宿主句柄
 */
export function installRuntimeHost(opts = {}) {
  const prev = {
    window: globalThis.window,
    document: globalThis.document,
    CustomEvent: globalThis.CustomEvent,
    MutationObserver: globalThis.MutationObserver,
    SillyTavern: globalThis.SillyTavern,
    localStorage: globalThis.localStorage,
    Image: globalThis.Image,
    getComputedStyle: globalThis.getComputedStyle,
    requestAnimationFrame: globalThis.requestAnimationFrame,
    cancelAnimationFrame: globalThis.cancelAnimationFrame,
    navigator: globalThis.navigator
  };

  // 全局监听器登记表（host 层唯一「观测面」）
  const registry = [];
  const win = makeTarget('window', registry);
  win.visualViewport = makeTarget('visualViewport', registry);
  win.innerWidth = 390;
  win.innerHeight = 844;
  win.devicePixelRatio = 3;
  win.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  win.getComputedStyle = () => ({ getPropertyValue: () => '' });
  win.requestAnimationFrame = (fn) => setTimeout(fn, 0);
  win.cancelAnimationFrame = (id) => clearTimeout(id);

  const doc = makeTarget('document', registry);
  doc.head = makeTarget('head', registry);
  doc.body = makeTarget('body', registry);
  doc.documentElement = makeTarget('html', registry);
  doc.hidden = false;
  doc.visibilityState = 'visible';
  doc.createElement = () => makeTarget('element', registry);
  doc.createElementNS = () => makeTarget('element', registry);
  doc.createTextNode = () => ({ nodeValue: '' });
  doc.createDocumentFragment = () => makeTarget('fragment', registry);
  doc.getElementById = () => null;
  doc.querySelector = () => null;
  doc.querySelectorAll = () => [];
  doc.addEventListener = (type, handler, o) => registry.push({ target: 'document', type, handler, o });
  doc.removeEventListener = (type, handler) => {
    const i = registry.findIndex((r) => r.target === 'document' && r.type === type && r.handler === handler);
    if (i >= 0) registry.splice(i, 1);
  };

  // eventSource：记录 on/removeListener 次数与当前 handler 列表
  const handlers = new Map();  // eventName -> [handler]
  const eventSource = {
    onCount: 0,
    removeCount: 0,
    on(eventName, handler) {
      this.onCount += 1;
      const arr = handlers.get(eventName) || [];
      arr.push(handler);
      handlers.set(eventName, arr);
      return this;
    },
    removeListener(eventName, handler) {
      this.removeCount += 1;
      const arr = handlers.get(eventName) || [];
      const i = arr.indexOf(handler);
      if (i >= 0) arr.splice(i, 1);
      return this;
    },
    emit(eventName, payload) {
      for (const h of [...(handlers.get(eventName) || [])]) h(payload);
    },
    count(eventName) { return (handlers.get(eventName) || []).length; },
    total() { let n = 0; for (const a of handlers.values()) n += a.length; return n; },
    reset() { handlers.clear(); this.onCount = 0; this.removeCount = 0; }
  };

  const chat = new Array(Number(opts.chatLength) || 0).fill(null)
    .map((_, i) => ({ mes: `楼层 ${i}`, is_user: false, swipes: [`楼层 ${i}`], swipe_id: 0 }));
  const chatMetadata = { ...(opts.chatMetadata || {}) };
  const settings = opts.settings || {};

  /* [v3.4.1 · P-5] saveChat 失败注入：前 N 次抛错，第 N+1 次起成功。
   *   默认 saveChatFails=0 ⇒ 与加它之前逐字同行为（永远成功）。
   *   `_saveChatCalls` 记录真实调用次数（含重试），由 host.saveChatCalls() 读出。 */
  let _saveChatCalls = 0;
  const saveChatFails = Number(opts.saveChatFails) || 0;
  const ctx = {
    chat,
    chatMetadata,
    chatId: opts.chatId || 'chat_test_1',
    name1: '用户',
    name2: '角色',
    characters: {},
    eventSource,
    event_types: {
      MESSAGE_RECEIVED: 'message_received',
      USER_MESSAGE_RENDERED: 'user_message_rendered',
      CHARACTER_MESSAGE_RENDERED: 'character_message_rendered',
      MESSAGE_DELETED: 'message_deleted',
      MESSAGE_SWIPED: 'message_swiped',
      CHAT_CHANGED: 'chat_changed',
      GENERATION_STARTED: 'generation_started',
      GENERATE_BEFORE_COMBINE_PROMPTS: 'generate_before_combine_prompts',
      CHAT_COMPLETION_PROMPT_READY: 'chat_completion_prompt_ready',
      /* [v3.9.3] 世界书激活事件：消费侧（`config/worldbook-dryrun.js`）的
       *   降级兜底走它。默认只是登记了类型名，**不会自己发**（发了就等于伪造宿主行为）。 */
      WORLD_INFO_ACTIVATED: 'world_info_activated'
    },
    extensionSettings: { st_virtual_phone: {} },
    saveChat: async () => {
      _saveChatCalls += 1;
      if (_saveChatCalls <= saveChatFails) {
        throw new Error('injected-saveChat-failure#' + _saveChatCalls);
      }
    },
    saveSettingsDebounced: () => {},
    saveMetadata: async () => {}
  };

  /* [v3.9.3] 世界书干跑取数：把「宿主有没有这个接口」做成**显式入参**。
   *   不传 ⇒ 夹具**不挂** `getWorldInfoPrompt` ⇒ 消费侧读到 `unsupported`（真实态之一，
   *     正是要能覆盖的那一态；夹具默认假装接口存在会让这一态永远测不到）。
   *   传对象 ⇒ 当干跑返回值（每次深拷贝一份，防测试间共享同一对象被改）。
   *   传函数 ⇒ 当 `getWorldInfoPrompt` 本体（用来测抛错、测入参）。
   *   `worldInfoCalls()` 记真实调用与最近一次入参：判据据此断言，不靠外部闭包。 */
  const _wiCalls = [];
  const wiSrc = opts.worldInfo;
  if (wiSrc !== undefined && wiSrc !== null) {
    ctx.getWorldInfoPrompt = async (chatForWI, maxContext, isDryRun, scanData) => {
      _wiCalls.push({ chatForWI, maxContext, isDryRun, scanData });
      if (typeof wiSrc === 'function') return wiSrc(chatForWI, maxContext, isDryRun, scanData);
      return JSON.parse(JSON.stringify(wiSrc));
    };
  }

  const localStorageStub = {
    _m: new Map(),
    get length() { return this._m.size; },
    getItem(k) { return this._m.has(k) ? this._m.get(k) : null; },
    setItem(k, v) { this._m.set(String(k), String(v)); },
    removeItem(k) { this._m.delete(String(k)); },
    clear() { this._m.clear(); },
    key(i) { return [...this._m.keys()][i] ?? null; }
  };

  globalThis.window = win;
  globalThis.document = doc;
  globalThis.CustomEvent = class {
    constructor(type, init = {}) {
      this.type = type;
      this.detail = init.detail;
      this.bubbles = !!init.bubbles;
      this.cancelable = !!init.cancelable;
    }
  };
  globalThis.MutationObserver = class {
    constructor(cb) { this._cb = cb; }
    observe() {}
    disconnect() {}
    takeRecords() { return []; }
  };
  globalThis.Image = class { set src(_v) {} set onload(_v) {} };
  globalThis.getComputedStyle = () => ({
    getPropertyValue: () => '',
    width: '0px',
    height: '0px'
  });
  globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 0);
  globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
  globalThis.localStorage = localStorageStub;
  // Node 24 起 `globalThis.navigator` 是**只读 getter**（直接赋值抛
  //   TypeError: Cannot set property navigator ... which has only a getter）。
  //   夹具只提供最小面，用 defineProperty 覆盖并在 uninstall 时还原描述符。
  try {
    const desc = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
    if (!desc || desc.set || desc.writable) {
      globalThis.navigator = globalThis.navigator || { userAgent: 'node' };
    } else {
      Object.defineProperty(globalThis, 'navigator', {
        value: { userAgent: 'node', language: 'zh-CN', maxTouchPoints: 0 },
        configurable: true, writable: true, enumerable: false
      });
    }
  } catch (_e) { /* 拿不到就跳过：模块侧都用了 ?. 兜底 */ }
  globalThis.SillyTavern = {
    getContext: () => ctx,
    libs: {},
    getRequestHeaders: () => ({}),
    chat: ctx.chat,
    characters: {}
  };
  // 部分模块走 window.parent.SillyTavern / window.SillyTavern 兜底
  win.SillyTavern = globalThis.SillyTavern;
  win.parent = win;

  // 宿主单例槽位
  win.VirtualPhone = { storage: opts.storage || null };

  return {
    window: win,
    document: doc,
    context: ctx,
    eventSource,
    localStorage: localStorageStub,
    storage: opts.storage || null,
    /** [v3.4.1 · P-5] saveChat 的真实调用次数（含重试） */
    saveChatCalls: () => _saveChatCalls,
    /** [v3.9.3] 干跑取数的真实调用记录（入参含 `isDryRun` / `maxContext`） */
    worldInfoCalls: () => _wiCalls.slice(),
    /** 当前登记的全局监听器（window/document/visualViewport 上的） */
    listeners: () => registry.map((r) => ({ target: r.target, type: r.type })),
    listenerCount: () => registry.length,
    /** 反复重建时判「有没有沉淀」 */
    listenerReport: () => {
      const by = {};
      for (const r of registry) {
        const k = `${r.target}:${r.type}`;
        by[k] = (by[k] || 0) + 1;
      }
      return by;
    },
    uninstall() {
      for (const [k, v] of Object.entries(prev)) {
        if (k === 'navigator') {
          // navigator 在 Node 24 是只读 getter，不能用普通赋值还原
          try {
            Object.defineProperty(globalThis, 'navigator', {
              value: v, configurable: true, writable: true, enumerable: false
            });
          } catch (_e) { /* 忽略 */ }
          continue;
        }
        if (v === undefined) delete globalThis[k];
        else globalThis[k] = v;
      }
    }
  };
}

/**
 * 让测试文件可以按「同一进程内多次 import」复用模块而不串味：
 * 模块级状态（onceFlag 标记挂在 globalThis.__once_*、事件落账在模块闭包）需要复位。
 */
export function resetHostFlags() {
  if (typeof globalThis === 'object') {
    for (const k of Object.keys(globalThis)) {
      if (k.startsWith('__once_')) delete globalThis[k];
    }
  }
}
