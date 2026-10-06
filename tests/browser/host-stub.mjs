/* ============================================================
 * tests/browser/host-stub.mjs — L4 浏览器层里的**最小宿主桩**
 * ------------------------------------------------------------
 * 为什么需要它，而不是把浏览器场景写成「独立小页面」：
 *   O1 要证明的东西里有一类是「入口存在，但被遮挡 / 宽度为零 / 按钮没绑定 /
 *   保存后重开丢失」。这几条的**主语都是真入口**——脱离真 `index.js` 与真
 *   `phone.css` 写出来的漂亮页面，证明不了任何一条。
 *   所以本桩只做一件事：把宿主（SillyTavern + jQuery + 一个挂载点）补到「真入口
 *   愿意启动」的最低限度，其余一切照旧跑真代码。
 *
 * 与 L2（tests/_runtime_host.mjs）的分工，别搞混：
 *   · L2 是**进程内**最小宿主，`querySelector` 一律返回 null、不排版；
 *   · 本桩是**真浏览器里**的宿主桩：DOM/CSS/布局/命中测试全部是真的，
 *     被替换的只有「宿主那侧的接口」（它本来就不在仓库里）。
 *   ⇒ L2 能答「模块内部状态对不对」，答不了「用户点得到吗」；
 *     本桩反过来。两者结论分报，不互相顶替。
 *
 * 本桩**刻意不实现**的东西（写在这里，免得后来者以为是漏了）：
 *   · 不实现 jQuery 的事件委托 —— `$(document).on(...)` 只登记不触发。
 *     仓库里用到它的四处全是「宿主消息区的 DOM 交互」，属宿主批次，
 *     独立浏览器里本来就没有那些 DOM；假装能触发才是伪造证据。
 *   · 不放行跨源 fetch —— 更新检查会去打 CDN，跨源请求会挂住预算。
 *     本桩把非本源的 fetch 直接拒绝并记账，读数里能看见「拒绝了几次」。
 * ============================================================ */

export function installBrowserHost(opts = {}) {
  const log = { jqOns: [], saveChatCalls: 0, fetchBlocked: [], fetchAllowed: 0 };

  /* ---------- 最小 jQuery ---------- */
  const nodeOf = (x) => (x && x.nodeType === 1 ? x : (x && x[0] && x[0].nodeType === 1 ? x[0] : null));

  function wrap(nodes) {
    const list = Array.from(nodes || []).filter(Boolean);
    const api = {
      length: list.length,
      each(fn) { list.forEach((n, i) => { try { fn.call(n, i, n); } catch (_e) { /* 单个节点失败不中断 */ } }); return api; },
      closest(sel) {
        const out = [];
        for (const n of list) {
          let cur = nodeOf(n);
          while (cur) { if (cur.matches && cur.matches(sel)) { out.push(cur); break; } cur = cur.parentElement; }
        }
        return wrap(out);
      },
      find(sel) {
        const out = [];
        for (const n of list) { if (n && n.querySelectorAll) out.push(...n.querySelectorAll(sel)); }
        return wrap(out);
      },
      hide() { for (const n of list) { if (n && n.style) n.style.display = 'none'; } return api; },
      show() { for (const n of list) { if (n && n.style) n.style.display = ''; } return api; },
      attr(name) { const n = list[0]; return n && n.getAttribute ? n.getAttribute(name) : undefined; },
      appendTo(target) {
        const t = typeof target === 'string' ? document.querySelector(target) : nodeOf(target);
        if (t) for (const n of list) t.appendChild(n);
        return api;
      },
      on(type, sel, fn) {
        log.jqOns.push({ type, sel: typeof sel === 'string' ? sel : (typeof sel === 'function' ? '(fn)' : null) });
        return api;
      },
      off() { return api; },
      append() { return api; },
      empty() { for (const n of list) { if (n) n.innerHTML = ''; } return api; },
      text() { return list[0] ? (list[0].textContent || '') : ''; },
      html() { return list[0] ? (list[0].innerHTML || '') : ''; },
      ready(fn) { try { fn(); } catch (_e) { /* 忽略 */ } return api; },
    };
    return api;
  }

  function $(arg) {
    if (arg === undefined || arg === null) return wrap([]);
    if (typeof arg === 'string') {
      const s = arg.trim();
      if (s.startsWith('<')) {
        // 造元素（仓库只用到 `$('<style ...>...</style>')` 这一形）
        const tpl = document.createElement('template');
        tpl.innerHTML = s;
        return wrap(tpl.content.children);
      }
      return wrap(document.querySelectorAll(s));
    }
    if (arg === document || arg === window) return wrap([arg]);
    if (arg.nodeType === 1) return wrap([arg]);
    if (Array.isArray(arg) || typeof arg.length === 'number') return wrap(arg);
    return wrap([]);
  }
  $.fn = {};
  window.$ = $;
  window.jQuery = $;

  /* ---------- 宿主上下文（SillyTavern.getContext() 的形状） ---------- */
  const chat = Array.isArray(opts.chat) ? opts.chat : [];
  const chatMetadata = { ...(opts.chatMetadata || {}) };
  const settings = opts.settings || {};
  const eventHandlers = new Map();
  const eventSource = {
    on(name, fn) { const a = eventHandlers.get(name) || []; a.push(fn); eventHandlers.set(name, a); return this; },
    once(name, fn) { return this.on(name, fn); },
    removeListener(name, fn) { const a = eventHandlers.get(name) || []; const i = a.indexOf(fn); if (i >= 0) a.splice(i, 1); return this; },
    emit(name, payload) { for (const fn of [...(eventHandlers.get(name) || [])]) { try { fn(payload); } catch (_e) { /* 忽略 */ } } },
    listenerCount(name) { return (eventHandlers.get(name) || []).length; },
    total() { let n = 0; for (const a of eventHandlers.values()) n += a.length; return n; },
  };

  const ctx = {
    chat,
    chatMetadata,
    chatId: opts.chatId || 'browser_chat_1',
    name1: opts.name1 || '用户',
    name2: opts.name2 || '角色',
    characters: opts.characters || {},
    eventSource,
    event_types: {
      APP_READY: 'app_ready',
      CHAT_CHANGED: 'chat_changed',
      CHAT_CREATED: 'chat_created',
      MESSAGE_RECEIVED: 'message_received',
      MESSAGE_SENT: 'message_sent',
      MESSAGE_DELETED: 'message_deleted',
      MESSAGE_EDITED: 'message_edited',
      MESSAGE_SWIPED: 'message_swiped',
      USER_MESSAGE_RENDERED: 'user_message_rendered',
      CHARACTER_MESSAGE_RENDERED: 'character_message_rendered',
      GENERATION_STARTED: 'generation_started',
      GENERATION_ENDED: 'generation_ended',
      GENERATE_BEFORE_COMBINE_PROMPTS: 'generate_before_combine_prompts',
      CHAT_COMPLETION_PROMPT_READY: 'chat_completion_prompt_ready',
      WORLD_INFO_ACTIVATED: 'world_info_activated',
    },
    extensionSettings: { st_virtual_phone: {} },
    SlashCommandParser: { addCommandObject() { return true; } },
    SlashCommand: { fromProps(o) { return o; } },
    saveChat: async () => { log.saveChatCalls += 1; },
    saveSettingsDebounced: () => {},
    saveMetadata: async () => {},
    getRequestHeaders: () => ({}),
  };

  window.getContext = () => ctx;
  window.SillyTavern = { getContext: () => ctx, libs: {}, eventSource, event_types: ctx.event_types };

  /* ---------- fetch 闸门：同源放行，跨源拒绝（并记账） ---------- */
  const rawFetch = window.fetch.bind(window);
  window.fetch = (input, init) => {
    const url = typeof input === 'string' ? input : (input && input.url) || '';
    const sameOrigin = url.startsWith('/') || url.startsWith(location.origin);
    if (!sameOrigin) {
      log.fetchBlocked.push(url.slice(0, 120));
      return Promise.reject(new TypeError('host-stub: cross-origin fetch blocked'));
    }
    log.fetchAllowed += 1;
    return rawFetch(input, init);
  };

  /* ---------- 宿主挂载点：真入口找的就是这两个 id ---------- */
  const holder = document.createElement('div');
  holder.id = 'top-settings-holder';
  document.body.appendChild(holder);

  return { log, ctx, eventSource, chat, chatMetadata, settings, holder };
}

/** 装完桩后等真入口把面板挂上来（轮询到就返回，超时如实报 false）。 */
export async function waitFor(predicate, { timeoutMs = 8000, stepMs = 50 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    let ok = false;
    try { ok = !!predicate(); } catch (_e) { ok = false; }
    if (ok) return true;
    await new Promise((r) => setTimeout(r, stepMs));
  }
  return false;
}
