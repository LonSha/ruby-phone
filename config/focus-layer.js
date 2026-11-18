/* ========================================================
 * config/focus-layer.js — [R25-O8] 焦点层栈与「焦点永不掉到被遮挡层」
 * --------------------------------------------------------
 * 【它要治的缺陷】
 *   手机里的「层」是叠出来的（桌面 → App → 弹窗 → 图片查看器）。但全仓没有一处
 *   记录「现在最上面是哪一层」，于是：
 *     · Tab 键会把焦点送到**下面那层**的按钮上（视觉上根本看不见）；
 *     · Esc 没有统一语义（有的层自己听、有的层不听、有的层听两遍关两层）。
 *   这不是「少了个快捷键」，是**层的次序从未被持有**。
 *
 * 【本模块只做四件事】
 *   ① 栈           —— `open/close/top/depth/names`：谁在上面只由这一个栈回答；
 *   ② Tab 循环     —— 在最上层内**首尾相接**（末个 Tab 回第一个，首个 Shift+Tab 回末个）；
 *   ③ Esc 语义     —— 只关**最上面那一层**（关闭一层 = 出栈一次，绝不一次关两层）；
 *   ④ 焦点复原     —— 关层后把焦点还给「开层前那一格」（它若已经不在文档里，如实 null，
 *                     不硬塞到 body 上假装复原成功）。
 *
 * 【为什么把 DOM 访问收成可注入的】
 *   判据要在无浏览器环境跑。所以 `listFocusable(root)` 与 `activeElement(doc)` 都可注入；
 *   默认实现走真 DOM。这不是为了测试方便，而是为了让「Tab 到底循环没循环」这件事
 *   能被**真断言**，而不是靠人眼看。
 *
 * 【三态】
 *   · `depth===0` ⇒ 没有层（`Esc` 该交给外壳的「返回上一层」）；
 *   · 有层但没有可聚焦元素 ⇒ `focused:null` + `reason:'no-focusable'`（不是「聚焦成功」）；
 *   · 没有 document ⇒ `unreadable`（不假装栈是空的）。
 * ============================================================ */
'use strict';

/** 默认可聚焦选择器（一处声明：视图与判据读同一份）。 */
export const FOCUSABLE_SELECTOR = [
    'a[href]',
    'button:not([disabled])',
    'input:not([disabled])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"])'
].join(',');

/** 默认实现：从真实 DOM 取可聚焦元素（保持文档顺序）。 */
function defaultListFocusable(root) {
    if (!root || typeof root.querySelectorAll !== 'function') return [];
    try {
        return Array.prototype.slice.call(root.querySelectorAll(FOCUSABLE_SELECTOR))
            .filter((el) => {
                /* 显式隐藏的元素不算可聚焦（`display:none` 的按钮被 Tab 到是最常见的「焦点消失」）。 */
                if (!el) return false;
                if (el.disabled === true) return false;
                if (el.getAttribute && el.getAttribute('aria-hidden') === 'true') return false;
                return true;
            });
    } catch (_e) { return []; }
}

function defaultActiveElement(doc) {
    try { return (doc && doc.activeElement) ? doc.activeElement : null; } catch (_e) { return null; }
}

/**
 * 建一个焦点层栈。
 * @param {{doc?:object, listFocusable?:Function, activeElement?:Function, now?:Function}} deps
 */
export function createFocusLayers(deps) {
    const o = (deps && typeof deps === 'object') ? deps : {};
    const doc = o.doc || null;
    const listFocusable = (typeof o.listFocusable === 'function') ? o.listFocusable : defaultListFocusable;
    const activeElement = (typeof o.activeElement === 'function') ? o.activeElement : defaultActiveElement;
    const now = (typeof o.now === 'function') ? o.now : () => Date.now();
    /* 「兜底作用域」：栈空时 Tab 仍需要一个边界（当前 App 的内容层）。
     *   它**不是一层**：不参与 depth、Esc 也不会去关它 —— 那属于外壳的「返回上一层」。 */
    const fallbackRoot = (typeof o.fallbackRoot === 'function') ? o.fallbackRoot : null;

    /** 栈：每个元素 { name, root, opener, at }。栈底是桌面，栈顶是最上层。 */
    const stack = [];

    function state() {
        if (!doc) {
            return { state: 'unreadable', reason: 'no-document', depth: 0, names: [], active: null };
        }
        const top = stack.length ? stack[stack.length - 1] : null;
        return {
            state: stack.length ? 'layered' : 'none',
            depth: stack.length,
            names: stack.map((l) => l.name),
            top: top ? top.name : null,
            active: top ? focusableIndexOf(top.root, activeElement(doc)) : null,
            at: now()
        };
    }

    /** 当前焦点在其所属层内的序号（-1 = 不在这一层的可聚焦集合里）。 */
    function focusableIndexOf(root, el) {
        if (!root || !el) return -1;
        const list = listFocusable(root) || [];
        for (let i = 0; i < list.length; i += 1) if (list[i] === el) return i;
        return -1;
    }

    /**
     * 开一层。
     * @returns {{opened:boolean, name:string, depth:number, focused:boolean, reason?:string}}
     */
    function open(name, root) {
        const n = String(name == null ? '' : name).trim() || ('layer-' + (stack.length + 1));
        const opener = activeElement(doc);
        stack.push({ name: n, root: root || null, opener, at: now() });
        const list = listFocusable(root);
        if (!list.length) {
            return { opened: true, name: n, depth: stack.length, focused: false, reason: 'no-focusable' };
        }
        try { list[0].focus(); } catch (_e) { return { opened: true, name: n, depth: stack.length, focused: false, reason: 'focus-threw' }; }
        return { opened: true, name: n, depth: stack.length, focused: true };
    }

    /**
     * 关一层（默认关最上面那层）。
     * @returns {{closed:boolean, name:string|null, depth:number, restored:boolean, reason?:string}}
     */
    function close(name) {
        if (!stack.length) return { closed: false, name: null, depth: 0, restored: false, reason: 'empty' };
        let idx = stack.length - 1;
        if (name != null) {
            const want = String(name);
            const found = stack.map((l) => l.name).lastIndexOf(want);
            if (found < 0) return { closed: false, name: want, depth: stack.length, restored: false, reason: 'not-found' };
            idx = found;
        }
        const [layer] = stack.splice(idx, 1);
        /* 焦点复原：只还给「仍在文档里的」那一格。不在就如实 null ——
         *   把焦点硬塞给 body 会让人以为「回到了原处」。 */
        const opener = layer && layer.opener ? layer.opener : null;
        const stillThere = !!(opener && (!doc || !doc.contains || doc.contains(opener) !== false));
        if (opener && stillThere && typeof opener.focus === 'function') {
            try { opener.focus(); } catch (_e) { return { closed: true, name: layer.name, depth: stack.length, restored: false, reason: 'focus-threw' }; }
            return { closed: true, name: layer.name, depth: stack.length, restored: true };
        }
        return { closed: true, name: layer.name, depth: stack.length, restored: false, reason: 'opener-gone' };
    }

    function top() { return stack.length ? stack[stack.length - 1] : null; }
    function depth() { return stack.length; }
    function names() { return stack.map((l) => l.name); }
    function clear() { stack.length = 0; return { cleared: true }; }

    /**
     * 处理一次按键（只关心 Tab / Escape）。
     * @param {{key?:string, shiftKey?:boolean, preventDefault?:Function}} evt
     * @returns {{handled:boolean, action?:string, from?:number, to?:number, closed?:string, reason?:string}}
     */
    function handleKey(evt) {
        const e = evt || {};
        let layer = top();
        let transient = false;
        if (!layer && fallbackRoot) {
            const fr = fallbackRoot();
            if (fr) { layer = { name: '@fallback', root: fr, transient: true }; transient = true; }
        }
        if (!layer) return { handled: false, reason: 'no-layer' };
        const list = listFocusable(layer.root) || [];
        if (!list.length) return { handled: false, reason: 'no-focusable' };
        if (e.key === 'Escape' || e.key === 'Esc') {
            /* 兜底作用域不是一层：Esc 交给调用方（外壳的返回上一层），不在这里「关」它。 */
            if (transient) return { handled: false, reason: 'fallback-scope' };
            const r = close(layer.name);
            if (typeof e.preventDefault === 'function') e.preventDefault();
            return { handled: true, action: 'escape', closed: r.name, depth: r.depth, reason: r.reason };
        }
        if (e.key === 'Tab') {
            const cur = focusableIndexOf(layer.root, activeElement(doc));
            const last = list.length - 1;
            let to;
            if (e.shiftKey === true) to = (cur <= 0) ? last : (cur - 1);
            else to = (cur < 0 || cur >= last) ? 0 : (cur + 1);
            try { list[to].focus(); } catch (_e) { return { handled: false, reason: 'focus-threw' }; }
            if (typeof e.preventDefault === 'function') e.preventDefault();
            return { handled: true, action: 'cycle', from: cur, to, length: list.length };
        }
        return { handled: false, reason: 'not-a-focus-key' };
    }

    return { open, close, top, depth, names, clear, handleKey, state };
}

export default { FOCUSABLE_SELECTOR, createFocusLayers };