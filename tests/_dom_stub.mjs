/* ============================================================
 * tests/_dom_stub.mjs — 弹层判据用的最小 DOM 替身 [v4.91.0]
 * ------------------------------------------------------------
 * 为什么需要：本仓零依赖（无 jsdom），而本版两件交付物（排除面弹层 / 条目设置面板）
 *   的**产物是 DOM**。`tests/_runtime_host.mjs` 的 querySelector 一律 null，
 *   连 `modal.querySelector('.phone-worldbook-perm-body')` 都拿不到，弹层根本画不下去。
 *
 * 本替身的口径（只做到「够判」为止，不假装浏览器）：
 *   · `createElement` 返回的节点记 className 与 innerHTML；
 *   · `querySelector(sel)` / `querySelectorAll(sel)` 共用**同一个按选择器字符串的桶**：
 *     同一个选择器反复取必须同一批对象 —— 弹层是「先 querySelectorAll 绑事件、
 *     再由判据 querySelector 点按钮」两趟走，若两趟各自造新节点，判据点的是没绑过
 *     事件的空壳，`await done` 就永远等不到（v1 替身正是这么挂死的）；
 *   · 命中数按 sel 里的 class / data-field / data-action 在**自己的 innerHTML** 里数；
 *     命中 0 也给稳定空壳（不是 null），断言「有没有调用到」靠 `calls` 记账；
 *   · 不解析 HTML、不做布局、不跑 CSS；命中测试与观感仍归真宿主（写进边界文档）。
 * ============================================================ */
function makeNode(tag, calls) {
    const buckets = new Map();
    const node = {
        tagName: String(tag || 'div').toUpperCase(),
        className: '',
        innerHTML: '',
        textContent: '',
        value: '',
        checked: false,
        hidden: false,
        disabled: false,
        type: '',
        dataset: {},
        children: [],
        _attrs: new Map(),
        appendChild(c) { node.children.push(c); return c; },
        append(...cs) { for (const c of cs) node.children.push(c); },
        prepend(c) { node.children.unshift(c); return c; },
        replaceChildren(...cs) { node.children = cs.slice(); calls.push('replaceChildren:' + node.className); },
        remove() { node._removed = true; calls.push('remove:' + node.className); },
        setAttribute(k, v) { node._attrs.set(k, String(v)); if (k === 'class') node.className = String(v); },
        getAttribute(k) { return node._attrs.has(k) ? node._attrs.get(k) : null; },
        removeAttribute(k) { node._attrs.delete(k); },
        hasAttribute(k) { return node._attrs.has(k); },
        addEventListener(type, handler) {
            calls.push('on:' + (node.className || node.tagName) + ':' + type);
            node._handlers = node._handlers || new Map();
            node._handlers.set(type, handler);
        },
        removeEventListener(type) { node._handlers?.delete(type); },
        /** 触发一次已登记的事件（判据据此点按钮，而不是直调内部函数）。 */
        fire(type, event = {}) {
            const h = node._handlers?.get(type);
            if (h) h(Object.assign({ key: '', preventDefault() {} }, event));
            return !!h;
        },
        focus() {},
        click() { node.fire('click'); },
        querySelector(sel) { return slot(sel)[0] || null; },
        querySelectorAll(sel) { return slot(sel).slice(); },
        get classList() { return node._classList || (node._classList = makeClassList(node)); },
        matches(sel) { return node.className.split(/\s+/).includes(String(sel).replace(/^\./, '')); }
    };
    /* 一个选择器 → 一批（按 innerHTML 里出现次数）稳定节点，跨调用复用。 */
    function slot(sel) {
        const key = String(sel);
        if (buckets.has(key)) return buckets.get(key);
        const cls = (key.match(/\.([A-Za-z0-9_-]+)/) || [])[1] || '';
        const fld = (key.match(/\[data-field="([^"]+)"\]/) || [])[1] || '';
        const act = (key.match(/\[data-action="([^"]+)"\]/) || [])[1] || '';
        const probe = cls ? cls : (fld ? 'data-field="' + fld + '"' : (act ? 'data-action="' + act + '"' : ''));
        let hits = 0;
        if (probe) {
            let at = 0;
            while (true) {
                const i = node.innerHTML.indexOf(probe, at);
                if (i < 0) break;
                hits += 1;
                at = i + probe.length;
            }
        }
        const made = [];
        for (let n = 0; n < Math.max(hits, 1); n += 1) {
            const child = makeNode('div', calls);
            child.className = cls || (fld ? 'field-' + fld : '');
            if (!hits) child._miss = true;
            made.push(child);
        }
        buckets.set(key, made);
        return made;
    }
    return node;
}
function makeClassList(node) {
    return {
        add(...cs) { node.className = [node.className, ...cs].filter(Boolean).join(' '); },
        remove(...cs) { const kill = new Set(cs); node.className = node.className.split(/\s+/).filter((c) => c && !kill.has(c)).join(' '); },
        contains(c) { return node.className.split(/\s+/).includes(c); },
        toggle(c, on) { if (on === undefined ? !this.contains(c) : on) this.add(c); else this.remove(c); }
    };
}
/**
 * 装一份 document 替身。返回 `{ document, calls, find, restore }`。
 *   与 `_runtime_host.mjs` 分开装（那个给模块级 window 面，这个给节点面）。
 */
export function installDomStub() {
    const calls = [];
    const all = [];
    const prev = globalThis.document;
    const body = makeNode('body', calls);
    const doc = {
        createElement(tag) { const n = makeNode(tag, calls); all.push(n); return n; },
        querySelector(sel) {
            const key = String(sel);
            if (key === '#phone-panel-content .phone-screen') return body;
            const found = all.find((n) => n.matches && n.matches(key));
            return found || null;
        },
        querySelectorAll() { return []; },
        addEventListener(type) { calls.push('doc:on:' + type); },
        removeEventListener(type) { calls.push('doc:off:' + type); },
        head: makeNode('head', calls),
        body
    };
    globalThis.document = doc;
    return {
        document: doc,
        calls,
        /** 按 class 找**活着的**节点（已 remove 的不算；多个取最后建的）。
         *  旧弹层关掉后仍留在 all 里，若 find 返回它，判据点到的就是已 settled 的闭包。 */
        find(cls) { return all.filter((n) => !n._removed && n.className.split(/\s+/).includes(cls)).pop() || null; },
        hasCall(token) { return calls.some((c) => String(c).includes(token)); },
        restore() { globalThis.document = prev; }
    };
}