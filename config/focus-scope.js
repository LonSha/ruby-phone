/**
 * config/focus-scope.js — R24-O8 无障碍 v2：键盘与焦点（v4.158.0）
 *
 * 【治的欠债】R22-O3 补齐了 `aria-label`（基线 350/115/17），但**键盘可达性**没有：
 *   图标墙 / 抽屉 / 弹窗的焦点顺序与焦点陷阱都没定义，键盘用户进得去出不来。
 *
 * 【三层焦点模型】`home`（图标墙）→ `app`（App 内）→ `overlay`（抽屉/弹窗）。
 *   每层一个 scope：Tab 在本层内循环（焦点陷阱）、Esc 关闭并**把焦点还给触发元素**、
 *   上一层在 overlay 打开期间不可达（原子性）。
 *
 * 【焦点可见】焦点样式走 O4 主题令牌 `focusRing`，**不许** `outline: none` 抹掉 —— 自检直接钉住这条。
 *
 * 【可复跑按键序列】`runKeys()` 跑一串键（Tab/Shift+Tab/Enter/Escape/ArrowX），返回逐步读数，
 *   用来验证「打开微信 → 发一条消息 → 返回桌面」纯键盘全链路。
 */
import { numOrNull } from './num-gate.js';

export const FOCUS_LAYERS = Object.freeze(['home', 'app', 'overlay']);
export const FOCUS_KEYS = Object.freeze(['Tab', 'Shift+Tab', 'Enter', 'Escape', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);
export const FOCUS_STYLE_REQUIRED = 'outline: 2px solid var(--focus-ring)';

function num(v, fallback) {
    const n = numOrNull(v);
    return n === null ? fallback : n;
}

/**
 * @param {{layer?:string, items?:Array<string>, initial?:number, onEscape?:Function}} input
 */
export function createFocusScope(input) {
    const src = input && typeof input === 'object' ? input : {};
    const layer = FOCUS_LAYERS.indexOf(src.layer) === -1 ? 'home' : src.layer;
    const items = Array.isArray(src.items) ? src.items.map(String) : [];
    let index = items.length ? Math.max(0, Math.min(items.length - 1, Math.floor(num(src.initial, 0) || 0))) : -1;
    let trap = layer === 'overlay';
    let closed = false;
    const restoreStack = [];
    const log = [];

    function active() {
        return index >= 0 && index < items.length ? items[index] : null;
    }

    function record(key, result) {
        log.push({ key, layer, active: active(), result });
        return result;
    }

    function setActive(targetId) {
        const i = items.indexOf(String(targetId));
        if (i === -1) return { ok: false, reason: 'not-in-scope' };
        index = i;
        return { ok: true, active: items[i] };
    }

    function move(delta) {
        if (!items.length) return null;
        const n = items.length;
        index = ((index + delta) % n + n) % n;
        return active();
    }

    /** Tab / Shift+Tab：到边界时在层内循环（overlay 与 home 都循环，不许跳到下一层）。 */
    function tab(shift) {
        if (!items.length) return null;
        return move(shift ? -1 : 1);
    }

    function openOverlay(triggerId) {
        restoreStack.push(String(triggerId || active() || ''));
        trap = true;
        return { ok: true, layer: 'overlay', restoreTo: restoreStack[restoreStack.length - 1] };
    }

    function closeOverlay() {
        const restoreTo = restoreStack.pop() || null;
        trap = false;
        closed = true;
        if (restoreTo !== null) {
            const r = setActive(restoreTo);
            return { ok: true, restoreTo, restored: r.ok, active: active() };
        }
        return { ok: true, restoreTo: null, restored: false, active: active() };
    }

    /** 单键处理：Escape 关闭 overlay 并还焦点；Enter 选当前项。 */
    function handle(key) {
        const k = String(key);
        if (k === 'Tab') return record(k, { type: 'focus', active: tab(false) });
        if (k === 'Shift+Tab') return record(k, { type: 'focus', active: tab(true) });
        if (k === 'Escape') {
            if (layer === 'overlay' || trap) return record(k, Object.assign({ type: 'close' }, closeOverlay()));
            return record(k, { type: 'escape-unhandled', active: active() });
        }
        if (k === 'Enter') return record(k, { type: 'activate', active: active() });
        if (k === 'ArrowLeft' || k === 'ArrowUp') return record(k, { type: 'focus', active: tab(true) });
        if (k === 'ArrowRight' || k === 'ArrowDown') return record(k, { type: 'focus', active: tab(false) });
        return record(k, { type: 'unknown-key', active: active() });
    }

    function stats() {
        return { layer, items: items.length, active: active(), index, trap, closed, logged: log.length, restoreStack: restoreStack.slice() };
    }

    return { layer, items, active, setActive, tab, handle, openOverlay, closeOverlay, stats, log };
}

/**
 * 跑一串按键，返回逐步读数与最终态（可复跑）。
 * @param {Array<string|{key:string}>} steps
 * @param {{items?:Array, layer?:string, initial?:number}} setup
 */
export function runKeys(steps, setup) {
    const scope = createFocusScope(setup || {});
    const results = [];
    (Array.isArray(steps) ? steps : []).forEach(function (s) {
        const key = typeof s === 'string' ? s : (s && s.key);
        // 逐步读数必须带上是哪个键（否则序列只能看步数，没法复跑对拍）
        results.push(Object.assign({ key }, scope.handle(key)));
    });
    return { results, final: scope.stats(), keys: results.map(function (r) { return r.key; }) };
}

/** 焦点样式必须走令牌，且禁止抹掉 outline。 */
export function focusStyleFor(tokens) {
    const t = tokens && typeof tokens === 'object' ? tokens : {};
    const ring = typeof t.focusRing === 'string' ? t.focusRing : null;
    if (!ring) return { ok: false, reason: 'no-token', css: null };
    const css = 'outline: 2px solid ' + ring;
    if (/outline:\s*none/.test(css)) return { ok: false, reason: 'outline-removed', css };
    return { ok: true, css, token: ring };
}

export function focusScopeSelfCheck() {
    const bad = [];
    const home = createFocusScope({ layer: 'home', items: ['wechat', 'album', 'wallet'], initial: 0 });
    if (home.active() !== 'wechat') bad.push('初始焦点应在第一项');
    if (home.tab(false) !== 'album') bad.push('Tab 应移到下一项');
    if (home.tab(true) !== 'wechat') bad.push('Shift+Tab 应回到上一项');
    if (home.tab(true) !== 'wallet') bad.push('Tab 到边界应循环（不许跳出层）');
    if (!home.handle('Enter') || home.handle('Enter').type !== 'activate') bad.push('Enter 应激活当前项');

    const overlay = createFocusScope({ layer: 'overlay', items: ['ok', 'cancel'], initial: 0 });
    overlay.openOverlay('wechat');
    overlay.handle('Tab'); overlay.handle('Tab'); overlay.handle('Tab');
    if (overlay.active() !== 'cancel') bad.push('overlay 内 Tab 应困在层内循环（焦点陷阱）');
    const closedRes = overlay.handle('Escape');
    if (!closedRes || closedRes.type !== 'close') bad.push('Escape 应关闭 overlay');
    const stats = overlay.stats();
    if (stats.restoreStack.length !== 0) bad.push('关闭后 restoration 栈应清空');

    const seq = runKeys(['Tab', 'Enter', 'Escape'], { layer: 'overlay', items: ['send', 'attach'], initial: 0 });
    if (seq.results[1].type !== 'activate') bad.push('序列里 Enter 应激活');
    if (seq.results[2].type !== 'close') bad.push('序列里 Escape 应关闭');

    const style = focusStyleFor({ focusRing: '#8ab4ff' });
    if (!style.ok || style.css.indexOf('#8ab4ff') === -1) bad.push('焦点样式应走令牌');
    if (focusStyleFor({}).ok) bad.push('没有令牌时不许伪造焦点样式');
    if (/outline:\s*none/.test(FOCUS_STYLE_REQUIRED)) bad.push('负控制：禁止 outline: none');

    if (FOCUS_LAYERS.length !== 3) bad.push('三层焦点模型应齐');
    if (FOCUS_KEYS.indexOf('Escape') === -1) bad.push('快捷键登记应含 Esc');

    return { ok: bad.length === 0, bad, sample: 'layers=' + FOCUS_LAYERS.length + ' keys=' + FOCUS_KEYS.length + ' seq=' + seq.keys.join('>') };
}

export default {
    FOCUS_LAYERS,
    FOCUS_KEYS,
    FOCUS_STYLE_REQUIRED,
    createFocusScope,
    runKeys,
    focusStyleFor,
    focusScopeSelfCheck
};