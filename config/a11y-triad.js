/* ========================================================
 * config/a11y-triad.js — [R25-O7] 无障碍三档（字号 / 减弱动效 / 高对比）的**应用面**
 * --------------------------------------------------------
 * 【它要治的缺陷：三档写了，但从没写到界面上】
 *   `config/touch-readability-baseline.js` 早就有三轴设置与 `generateReadabilityStyle()`，
 *   可全仓只有两处引用它：`config/subsystem-orchestrator.js` 的 `auditReadability()` 与
 *   一条审计脚本。也就是说 —— **三档的值算得出来，CSS 变量却从没写到 documentElement 上**。
 *   于是「用户开了高对比」与「用户没开」在界面上完全一致：
 *   这不是功能缺失的错觉，是**应用面整层缺席**（本仓反复翻车的「模块在盘 ≠ 机制生效」同族）。
 *
 * 【本模块只做四件事】
 *   ① `A11Y_AXES`  —— 三轴的**闭集**（font / motion / contrast），每轴带标签、存储字段、
 *      CSS 载体（变量名或类名）与判定口径 —— 一处声明，界面/诊断/测试都读这一份；
 *   ② `readA11yTriad(storage)` —— 读真源并给出**四态**：
 *      `absent`（从没设置过）/ `stored`（读到且逐轴可接受）/ `invalid`（读到但有关键字被拒，
 *      逐条点名）/ `unreadable`（读不到 —— 与「全是默认值」必须不同形）；
 *   ③ `applyA11yTriad(doc, profile)` —— 把三轴写到 `documentElement`，回执带写入的变量与类；
 *      没有 document 时 `applied:false`（**不假装成功**）；
 *   ④ `a11yTriadFace(doc, storage)` —— **读回对拍**：把期望值与 `documentElement` 上
 *      实际的变量/类逐轴比，得出 `applied` / `partial` / `mismatch`。
 *      没有这一步，「应用了」永远只是调用方的口头声明（本仓「读数必须来自真源」）。
 *
 * 【为什么默认值不在这里重写一遍】
 *   默认值、夹取区间（0.85~1.3）、CSS 变量名都来自 `touch-readability-baseline.js`。
 *   本模块 import 它，而不是抄一份常量 —— 抄一份就会出现「改一处忘一处」，
 *   而那正是 R26-O5「默认值单一真源」要清的东西。本模块只补**可接受值的判定**与**应用/对拍**。
 *
 * 【依赖】只依赖 `touch-readability-baseline.js`（零 DOM 依赖的纯函数），不碰 storage 实现
 *   —— 读真源一律由调用方注入 `storage`（有 `get(key)` 即可）。
 * ============================================================ */
'use strict';

import {
    STORAGE_KEY,
    DEFAULT_READABILITY_SETTINGS,
    normalizeReadabilitySettings,
    generateReadabilityStyle
} from './touch-readability-baseline.js';

/** 三轴闭集：顺序即界面顺序（字号 → 动效 → 对比度：从最常调到最不常调）。 */
export const A11Y_AXES = Object.freeze([
    Object.freeze({
        id: 'font',
        field: 'fontScale',
        label: '字号',
        cssVar: '--phone-font-scale',
        kind: 'var',
        /* 三档读法：默认 1.0；≥1.15 记作「大」；<0.95 记作「小」。区间与 baseline 一致。 */
        bandOf: (v) => (v >= 1.15 ? 'large' : (v < 0.95 ? 'small' : 'normal'))
    }),
    Object.freeze({
        id: 'motion',
        field: 'reducedMotion',
        label: '减弱动效',
        className: 'reduced-motion',
        kind: 'class',
        /* 动效只有两档：减了 / 没减。注意这与 `config/motion.js` 的四档（auto/full/reduced/still）
         * 不是同一件事：那边是**运行时档位**（含自动跟随系统），这边是用户在本页显式打开的一档。 */
        bandOf: (v) => (v === true ? 'reduced' : 'full')
    }),
    Object.freeze({
        id: 'contrast',
        field: 'highContrast',
        label: '高对比',
        className: 'high-contrast',
        kind: 'class',
        bandOf: (v) => (v === true ? 'high' : 'normal')
    })
]);

/** 轴 id → 轴定义（避免每处都写 find）。 */
export const A11Y_AXIS_BY_ID = Object.freeze(
    A11Y_AXES.reduce((acc, a) => { acc[a.id] = a; return acc; }, Object.create(null))
);

/** 三轴状态闭集（**不许出现第五种**）。 */
export const A11Y_TRIAD_STATES = Object.freeze({
    stored: 'stored',
    absent: 'absent',
    invalid: 'invalid',
    unreadable: 'unreadable'
});

/**
 * 单轴「可接受值」判定。为什么要单独判而不是直接 `Boolean()`：
 *   `Boolean('no')` 是 `true` —— 把字符串 "no" 读成「已开启减弱动效」是最典型的
 *   「读不懂就当开了」的塌陷。这里只认显式形态，其余一律拒收并点名。
 * @returns {boolean} 该值是否可接受
 */
export function acceptsAxisValue(field, raw) {
    if (field === 'fontScale') {
        const n = Number(raw);
        return Number.isFinite(n) && n > 0;
    }
    /* 布尔三轴：只认 true/false 与它们的存储化写法（'true'/'false'/1/0）。 */
    return raw === true || raw === false || raw === 'true' || raw === 'false' || raw === 1 || raw === 0;
}

/** 逐轴读出「可接受的值」（不可接受的一律不采纳，交给 normalize 走默认）。 */
function pickAxis(raw, field) {
    if (!raw || typeof raw !== 'object') return { ok: true, value: undefined };
    if (!(field in raw)) return { ok: true, value: undefined };   /* 没写的轴不算非法 */
    const v = raw[field];
    if (v === null || v === undefined) return { ok: true, value: undefined };
    if (!acceptsAxisValue(field, v)) return { ok: false, value: undefined };
    return { ok: true, value: v };
}

/**
 * 读真源 → 四态 + 归一后的 profile + 被拒的轴名（`rejected`）。
 *
 * 为什么 `unreadable` 与 `absent` 必须分开：
 *   `absent` 是「这台手机从没设置过三档」——默认值是真的当前生效值；
 *   `unreadable` 是「这次读不到存储」——此时默认值只是**兜底猜测**，界面不能报成
 *   「当前为默认档」。两者文案与本仓纪律一致地不同形。
 *
 * @param {{get?:Function}} storage 只需 `get(key)`
 */
export function readA11yTriad(storage) {
    const emptyDefaults = () => ({ ...DEFAULT_READABILITY_SETTINGS });
    if (!storage || typeof storage.get !== 'function') {
        return { state: 'unreadable', reason: 'no-storage', profile: emptyDefaults(), raw: null, rejected: [] };
    }
    let raw;
    try {
        raw = storage.get(STORAGE_KEY);
    } catch (e) {
        return {
            state: 'unreadable', reason: 'read-threw',
            detail: String((e && e.message) || e || ''), profile: emptyDefaults(), raw: null, rejected: []
        };
    }
    if (raw === null || raw === undefined || raw === '') {
        return { state: 'absent', reason: 'never-set', profile: emptyDefaults(), raw: null, rejected: [] };
    }
    /* 存储里可能是字符串化的 JSON（本仓 storage 对对象有 stringify 的历史行为）。 */
    let obj = raw;
    if (typeof raw === 'string') {
        try { obj = JSON.parse(raw); } catch (_e) {
            return { state: 'invalid', reason: 'unparsable', profile: emptyDefaults(), raw: raw, rejected: ['*'] };
        }
    }
    if (!obj || typeof obj !== 'object') {
        return { state: 'invalid', reason: 'not-object', profile: emptyDefaults(), raw: raw, rejected: ['*'] };
    }
    const rejected = [];
    const picked = Object.create(null);
    for (const axis of A11Y_AXES) {
        const r = pickAxis(obj, axis.field);
        if (!r.ok) rejected.push(axis.field);
        else if (r.value !== undefined) picked[axis.field] = r.value;
    }
    /* 归一（夹取区间）仍走 baseline 的唯一真源；只把「可接受的轴」喂进去，
     *   被拒的轴让它落回默认 —— 而不是把非法值塞进 normalize 里被静默布尔化。 */
    const profile = normalizeReadabilitySettings({ ...emptyDefaults(), ...picked });
    return {
        state: rejected.length ? 'invalid' : 'stored',
        reason: rejected.length ? 'axis-rejected' : 'ok',
        profile, raw: obj, rejected
    };
}

/**
 * 把三轴写到 document 上（`documentElement` 的 style 与 class）。
 * 回执（receipt）逐轴列出**实际写入**的载体，便于诊断页把「写了什么」与「读回什么」对拍。
 *
 * @param {{documentElement?:{style?:any, classList?:any}|null}|null} doc
 * @param {object} profile 归一后的三轴值
 * @returns {{applied:boolean, reason?:string, vars:object, classes:string[], at:number}}
 */
export function applyA11yTriad(doc, profile) {
    const at = Date.now();
    const el = doc && doc.documentElement ? doc.documentElement : null;
    if (!el) return { applied: false, reason: 'no-document', vars: {}, classes: [], at };
    const style = generateReadabilityStyle(profile);
    const vars = {};
    try {
        const st = el.style;
        if (!st || typeof st.setProperty !== 'function') {
            return { applied: false, reason: 'no-style-sink', vars: {}, classes: [], at };
        }
        for (const k of Object.keys(style.cssVars)) {
            st.setProperty(k, style.cssVars[k]);
            vars[k] = style.cssVars[k];
        }
        /* 类名用「先删后加」：反复 apply 不会越加越多（幂等）。 */
        const cl = el.classList;
        if (cl && typeof cl.add === 'function' && typeof cl.remove === 'function') {
            for (const axis of A11Y_AXES) {
                if (axis.kind !== 'class') continue;
                /* 两轴各自的类互斥成对：开时加自己的，同时摘掉另一档（未来若要三档也只加一个）。 */
                try { cl.remove(axis.className); } catch (_e) { /* 摘不掉不算失败 */ }
            }
            for (const c of style.classList) {
                try { cl.add(c); } catch (_e) { /* 单个类失败不影响变量已写入 */ }
            }
        }
    } catch (e) {
        return { applied: false, reason: 'write-threw', detail: String((e && e.message) || e || ''), vars, classes: style.classList, at };
    }
    return { applied: true, vars, classes: style.classList.slice(), at };
}

/** 从 documentElement 读回某一轴的**实际**载体值（读不到给 null，不是 ''）。 */
function readBackAxis(el, axis) {
    if (!el) return null;
    try {
        if (axis.kind === 'var') {
            const v = el.style && typeof el.style.getPropertyValue === 'function'
                ? el.style.getPropertyValue(axis.cssVar) : '';
            return (typeof v === 'string' && v !== '') ? v : null;
        }
        const cl = el.classList;
        if (!cl || typeof cl.contains !== 'function') return null;
        return cl.contains(axis.className) ? 'on' : 'off';
    } catch (_e) { return null; }
}

/** 某一轴的期望载体值（与 `readBackAxis` 同坐标系，才对得起来）。 */
function expectedAxis(triad, axis) {
    if (axis.kind === 'var') {
        const style = generateReadabilityStyle(triad.profile);
        const v = style.cssVars[axis.cssVar];
        return (typeof v === 'string' && v !== '') ? v : null;
    }
    return triad.profile[axis.field] === true ? 'on' : 'off';
}

/**
 * 三轴**对拍面**：期望值（真源归一后） vs 实际值（documentElement 读回）。
 *
 * 每轴状态闭集：`applied`（读回与期望一致）/ `mismatch`（读回不一致 —— 被别的样式覆盖了）/
 * `unknown`（读不回来，例如无 document 或载体不支持）/ `unreadable`（真源读不到）。
 * 顶层汇总：全 applied → `applied`；全非 applied → `unapplied`；其余 → `partial`。
 */
export function a11yTriadFace(doc, storage) {
    const triad = readA11yTriad(storage);
    const el = doc && doc.documentElement ? doc.documentElement : null;
    const rows = A11Y_AXES.map((axis) => {
        const want = expectedAxis(triad, axis);
        const got = readBackAxis(el, axis);
        let status;
        if (triad.state === 'unreadable') status = 'unreadable';
        else if (got === null) status = 'unknown';
        else status = got === want ? 'applied' : 'mismatch';
        return {
            id: axis.id, label: axis.label,
            field: axis.field,
            value: triad.profile[axis.field],
            band: axis.bandOf(triad.profile[axis.field]),
            carrier: axis.kind === 'var' ? axis.cssVar : ('.' + axis.className),
            want, got, status
        };
    });
    const appliedCount = rows.filter((r) => r.status === 'applied').length;
    let state;
    if (triad.state === 'unreadable') state = 'unreadable';
    else if (appliedCount === rows.length) state = 'applied';
    else if (appliedCount === 0) state = 'unapplied';
    else state = 'partial';
    return { triad, rows, state, appliedCount, total: rows.length };
}

/** 三轴文案（诊断页与设置页共用；三态各自不同形）。 */
export function a11yTriadText(face) {
    if (!face || !face.triad) return '无障碍三档：读不到（没有面）— 这是「没这个读数」，不是「都是默认档」';
    const t = face.triad;
    if (t.state === 'unreadable') {
        return '无障碍三档：存储读不到（' + String(t.reason || '') + '）— 当前生效值**未知**，界面上的默认值只是兜底';
    }
    const head = t.state === 'absent'
        ? '无障碍三档：从没设置过（三轴均为默认）'
        : (t.state === 'invalid'
            ? ('无障碍三档：读到设置，但 ' + t.rejected.join('、') + ' 的值不合法已回退默认')
            : '无障碍三档：已设置');
    const parts = face.rows.map((r) => {
        const mark = r.status === 'applied' ? '✔' : (r.status === 'mismatch' ? '✘' : '?');
        return mark + r.label + '=' + String(r.band);
    });
    const tail = face.state === 'applied'
        ? '（三轴均已写入并读回一致）'
        : (face.state === 'unapplied'
            ? '（三轴都没读回一致 — 应用面没生效）'
            : ('（' + face.appliedCount + '/' + face.total + ' 轴读回一致，其余被覆盖或读不到）'));
    return head + '：' + parts.join(' · ') + tail;
}

export default {
    A11Y_AXES, A11Y_AXIS_BY_ID, A11Y_TRIAD_STATES,
    acceptsAxisValue, readA11yTriad, applyA11yTriad,
    a11yTriadFace, a11yTriadText
};
