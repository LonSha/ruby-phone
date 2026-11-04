/* ========================================================
 * tests/_inline_action_harness.mjs — [v4.120.0 · 第十四期 R14-O5]
 * 「就地办」测试共用底座（迷你 DOM + 替身 + 造 App）
 * --------------------------------------------------------
 * 【为什么抽出来】v4.113.0 的 `system-v4114.test.mjs` 自带一套迷你 DOM（够判为止）。
 *   R14-O5 要在同一块交付物（消息动作条）上验「双击 / 刷新 / 源句漂 / 撤后重办」，
 *   若再抄第二份 DOM，两套选择器迟早会漂 —— 而两套漂了之后，
 *   「同一条判据在两份套件里结论不同」这种红点最难查（它不指向任何一处源码）。
 *   故本件是**唯一一份**：两边都从这里取。
 *
 * 【口径照旧：只做到「够判」为止，不假装浏览器】
 *   只实现用到的选择器（类 / id / [attr] / 后代 / 逗号或），命中走真实属性；
 *   布局、样式、伪元素一概不测（写进 docs/runtime-verification-boundary.md）。
 *
 * 【工厂为什么接 storyMs】两期套件用的固定剧情当下不同（v4114 用 2026-10-01 10:00），
 *   而「明天 / 周六」的换算结果直接取决于它。把时刻当参数传，比让两边共用同一个
 *   常量更安全：一改日期，两边一起漂而没人知道。
 * ======================================================== */
'use strict';
/**
 * 造一套测试底座。
 * @param {number} storyMs 固定剧情当下（本地时间构造：带 Z 会因时区漂）
 */
export function makeHarness(storyMs) {
    const T0 = Number(storyMs);

    function mkNode(tag) {
        const n = {
            tagName: String(tag || 'div').toUpperCase(),
            className: '',
            id: '',
            textContent: '',
            value: '',
            type: '',
            parentNode: null,
            children: [],
            _attrs: new Map(),
            _handlers: new Map(),
            appendChild(c) { c.parentNode = n; n.children.push(c); return c; },
            insertBefore(c, ref) {
                c.parentNode = n;
                const i = ref ? n.children.indexOf(ref) : -1;
                if (i < 0) n.children.push(c); else n.children.splice(i, 0, c);
                return c;
            },
            remove() {
                const p = n.parentNode;
                if (p) {
                    const i = p.children.indexOf(n);
                    if (i >= 0) p.children.splice(i, 1);
                    n.parentNode = null;
                }
            },
            setAttribute(k, v) {
                n._attrs.set(String(k), String(v));
                if (k === 'class') n.className = String(v);
                if (k === 'id') n.id = String(v);
            },
            getAttribute(k) { return n._attrs.has(String(k)) ? n._attrs.get(String(k)) : null; },
            removeAttribute(k) { n._attrs.delete(String(k)); },
            hasAttribute(k) { return n._attrs.has(String(k)); },
            addEventListener(t, h) {
                if (!n._handlers.has(t)) n._handlers.set(t, []);
                n._handlers.get(t).push(h);
            },
            removeEventListener(t, h) {
                const list = n._handlers.get(t) || [];
                const i = list.indexOf(h);
                if (i >= 0) list.splice(i, 1);
            },
            /** 该事件上**还活着**的监听器个数（D6 用它证「只绑一次」）。 */
            listenerCount(t) { return (n._handlers.get(t) || []).length; },
            fire(t, ev) {
                const e = Object.assign({ target: n, preventDefault() { } }, ev || {});
                for (const h of (n._handlers.get(t) || []).slice()) h(e);
                return e;
            },
            get nextSibling() {
                const p = n.parentNode;
                if (!p) return null;
                const i = p.children.indexOf(n);
                return (i >= 0 && i + 1 < p.children.length) ? p.children[i + 1] : null;
            },
            querySelector(sel) { const r = n.querySelectorAll(sel); return r.length ? r[0] : null; },
            querySelectorAll(sel) { return queryAll(n, sel); }
        };
        return n;
    }

    /** 选择器部件：`tag` / `.a` / `#x` / `[k]` / `[k="v"]`（够本件用，不追求通用）。 */
    const SIMPLE_RE = /^([a-zA-Z][\w-]*)?((?:[.#][\w-]+)*)((?:\[[^\]]+\])*)$/;

    function matchSimple(node, part) {
        const m = SIMPLE_RE.exec(String(part).trim());
        if (!m) return false;
        if (m[1] && node.tagName !== m[1].toUpperCase()) return false;
        const bits = m[2] ? m[2].match(/[.#][\w-]+/g) || [] : [];
        for (const b of bits) {
            if (b[0] === '.') {
                const cls = node.className ? String(node.className).split(/\s+/) : [];
                if (!cls.includes(b.slice(1))) return false;
            } else if (node.id !== b.slice(1)) return false;
        }
        const attrs = m[3] ? m[3].match(/\[[^\]]+\]/g) || [] : [];
        for (const a of attrs) {
            const inner = a.slice(1, -1);
            const eq = inner.indexOf('=');
            if (eq < 0) {
                if (!node.hasAttribute(inner.trim())) return false;
            } else {
                const k = inner.slice(0, eq).trim();
                let v = inner.slice(eq + 1).trim();
                if ((v[0] === '"' && v[v.length - 1] === '"') || (v[0] === "'" && v[v.length - 1] === "'")) v = v.slice(1, -1);
                if (node.getAttribute(k) !== v) return false;
            }
        }
        return true;
    }

    /** 后代组合 + 逗号或。 */
    function matchChain(node, chain) {
        const parts = String(chain).trim().split(/\s+/).filter(Boolean);
        if (!parts.length) return false;
        if (!matchSimple(node, parts[parts.length - 1])) return false;
        let i = parts.length - 2;
        let cur = node.parentNode;
        while (i >= 0) {
            let hit = false;
            while (cur) {
                if (matchSimple(cur, parts[i])) { hit = true; cur = cur.parentNode; break; }
                cur = cur.parentNode;
            }
            if (!hit) return false;
            i -= 1;
        }
        return true;
    }

    function matchAny(node, sel) {
        return String(sel).split(',').map((s) => s.trim()).filter(Boolean).some((s) => matchChain(node, s));
    }

    function walk(root, fn) {
        for (const c of root.children) { fn(c); walk(c, fn); }
    }

    function queryAll(root, sel) {
        const out = [];
        walk(root, (n) => { if (matchAny(n, sel)) out.push(n); });
        return out;
    }

    /** 装一份文档：`#chat-messages` 在 `.phone-view-current` 里，另有 `#chat-input`。 */
    function installDom() {
        const doc = mkNode('html');
        const head = mkNode('head');
        const body = mkNode('body');
        const view = mkNode('div');
        view.setAttribute('class', 'phone-view-current');
        const box = mkNode('div');
        box.setAttribute('id', 'chat-messages');
        const input = mkNode('input');
        input.setAttribute('id', 'chat-input');
        view.appendChild(box);
        view.appendChild(input);
        body.appendChild(view);
        doc.appendChild(head);
        doc.appendChild(body);
        doc.head = head;
        doc.body = body;
        doc.createElement = (t) => mkNode(t);
        doc.getElementById = (id) => queryAll(doc, '#' + String(id))[0] || null;
        doc.querySelector = (s) => { const r = queryAll(doc, s); return r.length ? r[0] : null; };
        doc.querySelectorAll = (s) => queryAll(doc, s);
        return { doc: doc, head: head, body: body, view: view, box: box, input: input };
    }

    /** 在装好的 DOM + 假宿主里跑一段（二者都要还原：本套件多次用）。 */
    function withDom(host, fn) {
        const prevDoc = globalThis.document;
        const prevWin = globalThis.window;
        const prevVp = globalThis.VirtualPhone;
        const d = installDom();
        const win = { document: d.doc, VirtualPhone: host || {}, setTimeout: setTimeout, requestAnimationFrame: (cb) => setTimeout(cb, 0) };
        globalThis.document = d.doc;
        globalThis.window = win;
        globalThis.VirtualPhone = win.VirtualPhone;
        try { return fn(d, win); } finally {
            if (prevDoc === undefined) delete globalThis.document; else globalThis.document = prevDoc;
            if (prevWin === undefined) delete globalThis.window; else globalThis.window = prevWin;
            if (prevVp === undefined) delete globalThis.VirtualPhone; else globalThis.VirtualPhone = prevVp;
        }
    }

    /** 存储替身（同步，与 PhoneStorage 的 read 面同形）。 */
    function mkStorage(init) {
        const store = new Map(Object.entries(init || {}));
        return {
            store: store,
            get: (k) => (store.has(k) ? store.get(k) : null),
            set: (k, v) => { store.set(k, v); return true; },
            remove: (k) => { store.delete(k); return true; }
        };
    }

    /**
     * 日历替身：既记账、又**真的存条目**。
     * --------------------------------------------------------
     * 【为什么要真存】R14-O5 的撤销判据是「按 memoId 删 + 跟现在的样子比有没有被改过」。
     *   只记入参的替身答不出 `getMemos()`，于是「条目已被人工改过」（modified-since）
     *   与「条目已经不在」（entry-missing）两种形态根本无处可判 —— 那两条判据会永远绿。
     *   故这里维护 entries：addMemo 真放进去、deleteMemo 真拿掉、getMemos 真读出来。
     *   `calls` / `deleted` 两个记账面**保持原样**（既有套件按这两口断言）。
     */
    function mkCalendar(opt) {
        const o = opt || {};
        const calls = [];
        const deleted = [];
        const entries = [];
        return {
            calls: calls,
            deleted: deleted,
            entries: entries,
            /** 真数据层的同一口：按 id 现找（撤销走的就是这条路）。 */
            getMemos() { return entries; },
            addMemo(input) {
                calls.push(input);
                if (o.reject === true) return null;
                const memo = Object.assign({}, input, { id: 'memo_' + calls.length });
                entries.push(memo);
                return memo;
            },
            deleteMemo(id) {
                deleted.push(id);
                if (o.deleteFails === true) return false;
                const i = entries.findIndex((m) => String(m.id) === String(id));
                if (i < 0) return false;
                entries.splice(i, 1);
                return true;
            }
        };
    }

    /** 造一条微信消息（默认是对方发的）。 */
    function mkMsg(id, content, extra) {
        return Object.assign({ id: id, content: content, from: 'them', storyAt: T0 }, extra || {});
    }

    /* ══════════ 造 App + 挂载（D 面用） ══════════ */

    /** 把消息行铺进容器（形状对齐 chat-view：`.chat-message[data-message-id]`）。 */
    function paintMessages(box, msgs) {
        for (const m of msgs) {
            const row = mkNode('div');
            row.setAttribute('class', 'chat-message message-left');
            row.setAttribute('data-message-id', String(m.id));
            box.appendChild(row);
        }
    }

    /** 假 App：只给动作条真正用到的那几口（currentChat / wechatData / storage）。 */
    function mkApp(opts) {
        const o = opts || {};
        const msgs = o.messages || [];
        const storage = o.storage || mkStorage({});
        return {
            currentChat: { id: 'c1', name: o.chatName || '阿莲' },
            storage: storage,
            wechatData: {
                getMessages: (cid) => (String(cid) === 'c1' ? msgs : [])
            }
        };
    }

    /** 裸宿主（VirtualPhone）：日历 / 剧情钟可选。 */
    function mkHost(opts) {
        const o = opts || {};
        const vp = {};
        if (o.calendar) vp.calendarApp = { calendarData: o.calendar };
        if (o.clock !== false) {
            /* 读数从 T0 **算出来**，不写死字面量：写死的话换一天就会「日期与时间戳不一致」，
             *   而那种不一致不会报错，只会让「明天」算到错的一天。 */
            const d = new Date(T0);
            const pad = (n) => String(n).padStart(2, '0');
            const date = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
            const time = pad(d.getHours()) + ':' + pad(d.getMinutes());
            vp.timeManager = { getCurrentStoryTime: () => ({ date: date, time: time, timestamp: T0 }) };
        }
        return vp;
    }

    return {
        T0: T0,
        mkNode: mkNode,
        installDom: installDom,
        withDom: withDom,
        mkStorage: mkStorage,
        mkCalendar: mkCalendar,
        mkMsg: mkMsg,
        paintMessages: paintMessages,
        mkApp: mkApp,
        mkHost: mkHost
    };
}
