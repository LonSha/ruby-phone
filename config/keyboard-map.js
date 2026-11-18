/* ========================================================
 * config/keyboard-map.js — [R25-X7] 外接键盘快捷键的单一真源
 * --------------------------------------------------------
 * 【它要治的缺陷】
 *   全仓 `keydown` 只有一处（抽屉图标的回车触发），「返回 / 搜索 / 发送 / 切 App」
 *   四件事在桌面浏览器里**没有任何键位** —— 用户必须离开键盘去点鼠标。
 *   这既是可达性问题（R25-O8 的一条），也是桌面场景里的基本礼仪。
 *
 * 【本模块只做四件事】
 *   ① `SHORTCUT_ACTIONS` —— 四个动作的**闭集**（id / 人话 / 默认键位 / 允许的键形）；
 *   ② `comboOf(evt)`      —— 把一次键盘事件归一成**规范键串**（`ctrl+k` / `alt+3` / `escape`）。
 *      归一化只有一个实现：否则「同一个键」会在匹配处与展示处写成两种样子；
 *   ③ `readKeyBindings(storage)` —— 读用户改过的键位，给出四态：
 *      `stored` / `absent`（从没改过）/ `invalid`（有键位被拒，逐条点名）/ `unreadable`（读不到）；
 *   ④ `matchShortcut(combo, bindings)` —— 键串 → 动作 id。冲突时**谁都不触发**并如实报冲突，
 *      而不是按对象顺序挑一个（那会让「按了没反应」永远查不出来）。
 *
 * 【纪律】
 *   · 默认键位只在这里声明一次（设置页与测试都读这一份，不许各自抄）；
 *   · `escape` 是唯一允许不带修饰键的动作（它是系统级返回语义）；
 *   · 读不到 ≠ 用默认：`unreadable` 与 `absent` 在文案与返回面上必须不同形。
 * ============================================================ */
'use strict';

/** 四个动作的闭集。`allowed` 是**该动作允许的键形**（防止把「发送」改成 `a` 这种一碰就发）。 */
export const SHORTCUT_ACTIONS = Object.freeze([
    Object.freeze({
        id: 'back', label: '返回上一层', def: 'escape',
        allowed: ['escape', 'modifier-key']
    }),
    Object.freeze({
        id: 'home', label: '回桌面', def: 'alt+home',
        allowed: ['modifier-key']
    }),
    Object.freeze({
        id: 'search', label: '搜索', def: 'ctrl+k',
        allowed: ['modifier-key']
    }),
    Object.freeze({
        id: 'send', label: '发送当前输入', def: 'ctrl+enter',
        allowed: ['modifier-key']
    }),
    Object.freeze({
        id: 'switch-app', label: '切到第 N 个 App（1~9）', def: 'alt+digit',
        allowed: ['digit']
    })
]);

/** 动作 id → 定义。 */
export const SHORTCUT_BY_ID = Object.freeze(
    SHORTCUT_ACTIONS.reduce((acc, a) => { acc[a.id] = a; return acc; }, Object.create(null))
);

/** 用户改键位的存储键（`sys_` 前缀与本仓系统级设定同族）。 */
export const SHORTCUT_STORAGE_KEY = 'sys_keyboard_shortcuts';

/** 读取状态闭集。 */
export const BINDING_STATES = Object.freeze({
    stored: 'stored',
    absent: 'absent',
    invalid: 'invalid',
    unreadable: 'unreadable'
});

/** 修饰键修饰词（顺序固定：ctrl → alt → shift → meta，保证键串可比）。 */
const MODIFIER_ORDER = ['ctrl', 'alt', 'shift', 'meta'];

/**
 * 把一次键盘事件归一成规范键串。
 * 为什么不用 `evt.key` 单独作判据：按住 Shift 时 `key` 会变成大写或符号，
 * 而 `code` 在同一物理键上稳定。数字键取 `Digit3` 的尾位，便于「Alt+1~9」共用一条形。
 *
 * @param {{key?:string, code?:string, ctrlKey?:boolean, altKey?:boolean, shiftKey?:boolean, metaKey?:boolean}} evt
 * @returns {string} 形如 `ctrl+shift+k` / `alt+digit` / `escape`
 */
export function comboOf(evt) {
    const e = evt || {};
    const mods = [];
    if (e.ctrlKey === true) mods.push('ctrl');
    if (e.altKey === true) mods.push('alt');
    if (e.shiftKey === true) mods.push('shift');
    if (e.metaKey === true) mods.push('meta');
    const code = String(e.code || '');
    const key = String(e.key || '');
    let base = '';
    if (/^Digit[1-9]$/.test(code)) base = code.slice(5);
    else if (code === 'Escape' || key === 'Escape') base = 'escape';
    else if (code === 'Enter' || key === 'Enter') base = 'enter';
    else if (code === 'Home' || key === 'Home') base = 'home';
    else if (key && key.length === 1) base = key.toLowerCase();
    else if (code) base = code.toLowerCase();
    if (!base) return '';
    /* 单独的 Escape 不带修饰词；带修饰词的 Escape 视为普通组合（例如 ctrl+escape）。 */
    const ordered = MODIFIER_ORDER.filter((m) => mods.includes(m));
    return ordered.length ? (ordered.join('+') + '+' + base) : base;
}

/** 键串是否「带修饰键」（数字型动作允许只带 alt）。 */
function hasModifier(combo) {
    return /^(ctrl|alt|shift|meta)\+/.test(combo);
}

/**
 * 判断某个键串对某个动作是否**可接受**。
 * 这是「改键」唯一的口子：不合规的键位一律拒收并点名，不许静默写进去。
 */
export function acceptsCombo(actionId, combo) {
    const act = SHORTCUT_BY_ID[actionId];
    const c = String(combo || '');
    if (!act || !c) return false;
    /* 单独的 Esc 只给「返回」用（它是系统级语义，不带修饰键也正当）。 */
    if (c === 'escape') return act.allowed.includes('escape');
    /* 数字型动作的**声明形**就是 `alt+digit`（一个键位覆盖 1~9 槽）。 */
    if (c === 'alt+digit') return act.allowed.includes('digit');
    /* 其余动作一律必须带修饰键 —— 否则「发送」被改成 `a` 会一碰就发。 */
    if (!hasModifier(c)) return false;
    const base = c.split('+').pop();
    return base.length > 0 && !MODIFIER_ORDER.includes(base);
}

/** 默认键位表（从闭集派生，不另写一份）。 */
export function defaultBindings() {
    const out = Object.create(null);
    for (const a of SHORTCUT_ACTIONS) out[a.id] = a.def;
    return out;
}

/**
 * 读用户的键位覆盖。
 * @param {{get?:Function}} storage
 * @returns {{state:string, bindings:object, rejected:string[], reason?:string, raw?:*}}
 */
export function readKeyBindings(storage) {
    const base = defaultBindings();
    if (!storage || typeof storage.get !== 'function') {
        return { state: BINDING_STATES.unreadable, reason: 'no-storage', bindings: base, rejected: [] };
    }
    let raw;
    try {
        raw = storage.get(SHORTCUT_STORAGE_KEY);
    } catch (e) {
        return { state: BINDING_STATES.unreadable, reason: 'read-threw', detail: String((e && e.message) || e || ''), bindings: base, rejected: [] };
    }
    if (raw === null || raw === undefined || raw === '') {
        return { state: BINDING_STATES.absent, reason: 'never-set', bindings: base, rejected: [] };
    }
    let obj = raw;
    if (typeof raw === 'string') {
        try { obj = JSON.parse(raw); } catch (_e) {
            return { state: BINDING_STATES.invalid, reason: 'unparsable', bindings: base, rejected: ['*'], raw };
        }
    }
    if (!obj || typeof obj !== 'object') {
        return { state: BINDING_STATES.invalid, reason: 'not-object', bindings: base, rejected: ['*'], raw };
    }
    const rejected = [];
    const bindings = defaultBindings();
    for (const act of SHORTCUT_ACTIONS) {
        if (!(act.id in obj)) continue;
        const v = obj[act.id];
        if (typeof v !== 'string' || !acceptsCombo(act.id, v)) { rejected.push(act.id); continue; }
        bindings[act.id] = v;
    }
    /* 冲突：两个动作落到同一键串时**都不生效**（保留默认并点名），
     *   因为「按了没反应」比「按错了一个」更难查。 */
    const seen = new Map();
    for (const act of SHORTCUT_ACTIONS) {
        const c = bindings[act.id];
        if (seen.has(c)) {
            if (!rejected.includes(act.id)) rejected.push(act.id);
            bindings[act.id] = act.def;
        } else {
            seen.set(c, act.id);
        }
    }
    return {
        state: rejected.length ? BINDING_STATES.invalid : BINDING_STATES.stored,
        reason: rejected.length ? 'binding-rejected' : 'ok',
        bindings, rejected, raw: obj
    };
}

/**
 * 键串 → 动作。返回值带 `conflict`：同一键串被两个动作占用时如实报冲突而不是挑一个。
 * @param {string} combo `comboOf()` 的结果
 * @param {object} bindings `readKeyBindings().bindings`
 */
export function matchShortcut(combo, bindings) {
    const c = String(combo || '');
    if (!c) return null;
    const table = bindings && typeof bindings === 'object' ? bindings : defaultBindings();
    const hits = [];
    for (const act of SHORTCUT_ACTIONS) {
        const want = table[act.id];
        if (!want) continue;
        if (want === c) { hits.push(act.id); continue; }
        /* 数字型动作：声明形 `alt+digit` 匹配实按的 `alt+1`…`alt+9`。 */
        if (want === 'alt+digit' && /^alt\+[1-9]$/.test(c)) hits.push(act.id);
    }
    if (hits.length === 0) return null;
    if (hits.length > 1) return { action: null, conflict: hits.slice(), combo: c };
    const id = hits[0];
    /* 切 App 要回报「第几槽」：视图只需要槽位，App 名单由调用方决定（内核不认识 apps 表）。 */
    const slot = (id === 'switch-app') ? Number(c.split('+').pop()) : null;
    return { action: id, conflict: null, combo: c, slot };
}

/** 给设置页/诊断页用的行表（人话键名 + 当前键串）。 */
export function shortcutRows(bindings) {
    const table = bindings && typeof bindings === 'object' ? bindings : defaultBindings();
    return SHORTCUT_ACTIONS.map((a) => ({
        id: a.id, label: a.label,
        combo: table[a.id] || a.def,
        human: humanCombo(table[a.id] || a.def),
        isDefault: (table[a.id] || a.def) === a.def
    }));
}

/** 键串 → 人话（`ctrl+k` → `Ctrl + K`）。 */
export function humanCombo(combo) {
    const c = String(combo || '');
    if (!c) return '（未设置）';
    if (c === 'alt+digit') return 'Alt + 1~9';
    return c.split('+').map((p) => {
        if (p === 'ctrl') return 'Ctrl';
        if (p === 'alt') return 'Alt';
        if (p === 'shift') return 'Shift';
        if (p === 'meta') return 'Cmd';
        if (p === 'escape') return 'Esc';
        if (p === 'enter') return 'Enter';
        if (p === 'digit') return '1~9';
        return p.length === 1 ? p.toUpperCase() : p.charAt(0).toUpperCase() + p.slice(1);
    }).join(' + ');
}

/** 一行总述（设置页说明与诊断卡共用；四态不同形）。 */
export function shortcutText(face) {
    if (!face || !face.state) return '快捷键：读不到（没有面）';
    if (face.state === BINDING_STATES.unreadable) {
        return '快捷键：读不到设置（' + String(face.reason || '') + '）— 当前用的是内置默认键位，**不是**你改过的';
    }
    const head = face.state === BINDING_STATES.absent ? '快捷键：使用默认键位'
        : (face.state === BINDING_STATES.invalid
            ? ('快捷键：有键位被拒并已回退默认（' + face.rejected.join('、') + '）')
            : '快捷键：已自定义');
    const rows = shortcutRows(face.bindings);
    return head + '：' + rows.map((r) => r.label + '=' + r.human).join(' · ');
}

export default {
    SHORTCUT_ACTIONS, SHORTCUT_BY_ID, SHORTCUT_STORAGE_KEY, BINDING_STATES,
    comboOf, acceptsCombo, defaultBindings, readKeyBindings, matchShortcut,
    shortcutRows, humanCombo, shortcutText
};