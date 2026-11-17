/* ============================================================
 * tests/_bind_events_snapshot.mjs — bindEvents 的**运行时**行为快照采集器
 * ------------------------------------------------------------
 * 为什么需要它：R23-O2 要在 bindEvents()（690 行）体内切片，而 R22 立的规矩是
 *   「只搬不改」必须同时过 L1（逐字节）+ L3（运行时行为不变）。L3 对 DOM 型方法
 *   不能靠返回值 sha256 —— bindEvents 没有返回值，它干的事是"往 DOM 上挂监听器"。
 *   所以这里把它的**产出**定义成「事件挂载序列」：每挂一个监听器就记一条
 *   `元素路径::事件名`，顺序也记。切片前后这条序列必须逐条相同。
 *
 * 采集方式（诚实写明口径）：
 *   · document / currentView 用 Proxy 造替身：任何 querySelector 都返回一个"下一层替身"，
 *     路径字符串随选择器累加，因此序列里能看出"挂给了哪个选择器"；
 *   · querySelectorAll 返回空列表 → 依赖"遍历已有节点"的分支不会被执行，
 *     它的行为**不在本快照覆盖范围内**（快照只保证"挂载序列"这一面）；
 *   · 只调 bindEvents 一次，不派发任何事件 → 回调体是否被改坏，本快照看不见，
 *     那一层由 L1 逐字节证明兜着。
 *   · 计时器用真 setTimeout 跑完（有 test 环境 200ms 收尾），避免"晚到的 timers 抛错"
 *     被当成通过 —— 抛错会直接让进程非零退出。
 * ============================================================ */

const nop = () => {};

/** 通用替身：任何属性访问都返回一个"记录用的函数/对象"。 */
function stubObj(name) {
  return new Proxy(
    { __name: name },
    {
      get(t, prop) {
        if (typeof prop === 'symbol' || prop === 'then') return undefined;
        if (prop in t) return t[prop];
        return nop;
      },
      set() {
        return true;
      },
    }
  );
}

/** 造一个 DOM 替身；每次 querySelector 都把路径串接下去，用来给监听器定位。 */
function makeEl(path, sink) {
  const emptyList = {
    forEach() {},
    map() {
      return [];
    },
    filter() {
      return [];
    },
    length: 0,
    [Symbol.iterator]: function* () {},
  };
  return new Proxy(
    {},
    {
      get(_t, prop) {
        if (typeof prop === 'symbol' || prop === 'then') return undefined;
        switch (prop) {
          case 'addEventListener':
            return (type) => sink.push(path + '::' + type);
          case 'removeEventListener':
            return nop;
          case 'querySelector':
            return (sel) => makeEl(path + ' > ' + sel, sink);
          case 'querySelectorAll':
          case 'getElementsByClassName':
            return () => emptyList;
          case 'getElementById':
            return (id) => makeEl(path + ' #' + id, sink);
          case 'createElement':
            return (tag) => makeEl('el:' + tag, sink);
          case 'createTextNode':
            return () => makeEl('text', sink);
          case 'classList':
            return { add: nop, remove: nop, toggle: nop, contains: () => false };
          case 'dataset':
          case 'style':
            return {};
          case 'children':
            return [];
          case 'value':
          case 'textContent':
            return '';
          case 'scrollHeight':
          case 'offsetHeight':
          case 'clientHeight':
            return 1000;
          case 'getAttribute':
            return () => null;
          default:
            return undefined;
        }
      },
      set() {
        return true;
      },
    }
  );
}

/** 装好全局替身（幂等）。 */
export function installDomStub() {
  const sink = [];
  const doc = makeEl('document', sink);
  for (const [k, v] of [
    ['body', 'document.body'],
    ['head', 'document.head'],
    ['activeElement', 'activeElement'],
    ['documentElement', 'document.documentElement'],
  ]) {
    Object.defineProperty(doc, k, { get: () => makeEl(v, sink), configurable: true });
  }
  globalThis.document = doc;
  globalThis.window = globalThis;
  globalThis.Audio = function AudioStub() {
    return stubObj('Audio');
  };
  globalThis.Image = function ImageStub() {
    return stubObj('Image');
  };
  globalThis.localStorage = stubObj('localStorage');
  globalThis.Event = function EventStub(type, opts) {
    return Object.assign({ type }, opts);
  };
  globalThis.CustomEvent = globalThis.Event;
  globalThis.requestAnimationFrame = () => 0;
  globalThis.cancelAnimationFrame = nop;
  globalThis.getComputedStyle = () => stubObj('style');
  return sink;
}

/**
 * 真跑一次 bindEvents，返回「事件挂载序列」。
 * @param {Function} ChatView 已 import 的原型类
 * @returns {string[]} 形如 `document > .phone-view-current > #send-btn::click`
 */
export function captureBindEventsSnapshot(ChatView) {
  const sink = installDomStub();
  const app = {
    render: nop,
    wechatData: stubObj('wechatData'),
    phoneShell: stubObj('phoneShell'),
    currentView: 'chats',
  };
  const view = new ChatView(app);
  view.bindEvents();
  return sink.slice();
}
