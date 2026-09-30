/* ========================================================
 * regexfilter-data.js — [v3.26.0] 正则过滤器 App 纯函数内核
 *
 * 缝合自 EPhone·xINOVO（js/modules/regex_filter.js，432 行）的**规则引擎那一半**：
 *   预设（名称 + 规则数组 + 绑定角色）→ 逐条正则替换 → 预览 → 导出。
 *
 * 【缝什么、不缝什么 —— 三处「源有本仓不能有」】
 *   ① 持久化：源把预设挂在全局 `db.regexFilterPresets` 上并 `await saveData()` 落 IndexedDB。
 *      本仓没有 db / saveData —— 全书走 PhoneStorage（键前缀 `regexfilter_`），
 *      且本文件保持**纯函数**：状态进、状态出，落盘由 App 层负责。
 *   ② **自动改写消息**：源 `applyRegexFilter(content, charId)` 在渲染前就地改文本。
 *      本件**不缝这条自动改写**：本仓消息文本的既有唯一仲裁者是 `config/tag-filter.js`
 *      （生成前的标签级黑/白名单过滤）。若本件也去改同一段文本，同一块文本上就有两个
 *      改写者 —— 那正是本仓最贵的形态（不报错、只错结果），与存钱罐「不与微信零钱争」同规。
 *      ⇒ 本件定位为**正则工作台**：写规则 → 实时预览 → 导出成 SillyTavern 正则脚本。
 *      规则由**用户**拿去用，本件零自动改写（零碰消息、零碰角色会话数据）。
 *   ③ 角色下拉：源从 `db.characters` 拉人名。本仓没有 db.characters —— provider 由调用方
 *      注入（App 层从宿主上下文取），本文件只吃 `{ id, name }[]`。
 *
 * 【从源里取的三块真价值】
 *   · **外壳保护**（`splitWrapper`）：源认「[某某的消息：正文]」这类成对包裹，
 *     只对**内部正文**施加规则，不破坏系统外壳。本件保留并推广到「首尾成对的中括号」。
 *   · **无效规则不吞文本**：源遇 `new RegExp` 抛错时 `console.error` 后**跳过该条**
 *     （文本照旧往下走）—— 跳过是对的（不能因一条坏规则把整段吃掉），但**静默**是缺陷形态：
 *     预览里只是"少替换了一些"，界面上看不出哪条坏了。本件把坏规则升为**一等读数**
 *     （`errors[]` + 投影里的 `invalidCount`），界面显式报出来。
 *   · **导出/导入是 JSON 文本**：源用 Blob 下载 + FileReader 上传。本仓不碰这两个浏览器
 *     API —— 收敛成**纯字符串**（`toExportText` / `fromImportText`），由 App 层交给用户。
 *
 * 【与源的偏离（逐条写明）】
 *   1. 每条规则**现建现用**（源也是现场 `new RegExp(pattern,'g')`，但没写明为什么）。
 *      理由要写明：带 `g` 标志的正则对象**自带 lastIndex 状态** —— 同一个实例拿去
 *      `test()` / `exec()` 第二次会从上次命中的位置接着找，产生"同一段文本第一次命中、
 *      第二次不命中"的静默失效。本件把「每条现建」写成纪律并配判据（v3250 G1 同族的工具自证）。
 *   2. 预设数 / 每预设规则数 / 模式长度 / 名称长度均设上限（源无上限）：预设表随会话存档走，
 *      无界增长会顶到 chatMetadata 的体积上。
 *   3. 替换串**保留 replace 语义**（`$1` 捕获组、`$&` 整串命中）：这是正则替换的正当特性。
 *      与 v3250 G2 的口径不冲突 —— 那里说的是「**破坏注入**不得用 replace」（会静默变形），
 *      这里说的是「**用户写的规则**按 replace 语义执行」（是特性本身）。
 *   4. 源尾部的「清理多余空行」（`\n{3,}` → `\n\n`）改为**显式开关**（`tidy`，默认关）：
 *      它是对文本的隐式改写，默认开启会让"我只想看这条正则干了什么"失真。
 *
 * 本文件零依赖叶子模块（只引 num-gate），无副作用、不碰 DOM、不碰 window、不碰浏览器 API。
 * ======================================================== */
'use strict';
import { numOrNull } from '../../config/num-gate.js';

/** 归因三态。**值**是连字符形，视图文案表的键必须取这里的值（与 focus / piggy 同纪律）。 */
export const RGX_REASONS = Object.freeze({
    ready: 'ready',                     // 有预设
    empty: 'empty',                     // 存储可用，但还没建过预设
    storage_absent: 'storage-absent',   // 存储不可用（宿主没给或取数抛错）
});

/** 上限（见文件头「与源的偏离」第 2 条）。 */
export const RGX_LIMITS = Object.freeze({
    maxPresets: 40,
    maxRulesPerPreset: 60,
    maxPatternLen: 400,
    maxReplaceLen: 400,
    maxNameLen: 40,
});

export const DEFAULT_RGX_SETTINGS = Object.freeze({
    /** 预览时顺带清理连续空行（源的 `\n{3,}` → `\n\n`，本件改为显式开关，默认关）。 */
    tidy: false,
    /** 预览文本长度上限（只影响预览，不影响规则本身）。 */
    maxPreviewChars: 4000,
});

export function defaultRgxSettings() {
    return Object.freeze({ ...DEFAULT_RGX_SETTINGS });
}

function boundedInt(v, fallback, min, max) {
    const n = numOrNull(v);
    if (n === null) return fallback;
    return Math.min(max, Math.max(min, Math.round(n)));
}

/** 设置规范化：外部数据一律先过这里（读不出就如实回落默认，不把 NaN 混进运行时）。 */
export function normalizeRgxSettings(raw) {
    const d = DEFAULT_RGX_SETTINGS;
    const o = (raw && typeof raw === 'object') ? raw : {};
    return Object.freeze({
        tidy: o.tidy === true,
        maxPreviewChars: boundedInt(o.maxPreviewChars, d.maxPreviewChars, 200, 20000),
    });
}

/** 单条规则规范化：模式为空即判无效返回 null（由调用方丢弃）。 */
export function normalizeRule(raw) {
    const o = (raw && typeof raw === 'object') ? raw : {};
    const pattern = String(o.pattern === null || o.pattern === undefined ? '' : o.pattern).trim();
    if (!pattern) return null;
    const replace = String(o.replace === null || o.replace === undefined ? '' : o.replace);
    return {
        pattern: pattern.slice(0, RGX_LIMITS.maxPatternLen),
        replace: replace.slice(0, RGX_LIMITS.maxReplaceLen),
    };
}

/**
 * 编译一条规则。返回 `{ ok, regex, error }` —— **bad 规则必须有人知道**（见文件头）。
 * ★ 每次调用都**新建** RegExp 实例：绝不复用带 `g` 的对象（lastIndex 状态）。
 */
export function compileRule(rule) {
    const r = normalizeRule(rule);
    if (!r) return { ok: false, regex: null, error: '规则为空' };
    try {
        return { ok: true, regex: new RegExp(r.pattern, 'g'), error: '' };
    } catch (e) {
        return { ok: false, regex: null, error: String(e && e.message ? e.message : e) };
    }
}

/** 规则是否可编译（给投影/界面用）。 */
export function isRuleValid(rule) {
    return compileRule(rule).ok;
}

/** 预设规范化：无名称或无有效规则即返回 null。 */
export function normalizePreset(raw) {
    const o = (raw && typeof raw === 'object') ? raw : {};
    const name = String(o.name || '').trim().slice(0, RGX_LIMITS.maxNameLen);
    if (!name) return null;
    const rules = (Array.isArray(o.rules) ? o.rules : [])
        .map(normalizeRule).filter(Boolean).slice(0, RGX_LIMITS.maxRulesPerPreset);
    if (!rules.length) return null;
    const bound = Array.isArray(o.boundChars) ? o.boundChars : [];
    const boundChars = [...new Set(bound
        .map((x) => String(x === null || x === undefined ? '' : x).trim())
        .filter((x) => x && x !== '__proto__' && x !== 'constructor' && x !== 'prototype'))];
    return {
        id: (typeof o.id === 'string' && o.id) ? o.id : ('rf_' + Math.random().toString(36).slice(2, 9)),
        name,
        rules,
        boundChars,
        enabled: o.enabled !== false,
    };
}

/** 预设表规范化（去无效项、按上限截断）。 */
export function normalizePresets(raw) {
    const list = Array.isArray(raw) ? raw : [];
    return list.map(normalizePreset).filter(Boolean).slice(0, RGX_LIMITS.maxPresets);
}

/**
 * 外壳保护：把 `[某某的消息：正文]` 拆成 `{ prefix, body, suffix }`。
 * 只对 **body** 施加规则 —— 系统外壳（前缀与收尾方括号）原样保留。
 * 不成立时 prefix / suffix 为空串，body 是原文（此时规则作用于全文，与无外壳等价）。
 */
export function splitWrapper(text) {
    const s = String(text === null || text === undefined ? '' : text);
    const m = s.match(/^(\[[^\]\n]{0,120}[：:]\s*)([\s\S]+?)(\]\s*)$/);
    if (!m) return { prefix: '', body: s, suffix: '' };
    return { prefix: m[1], body: m[2], suffix: m[3] };
}

/** 连续空行清理（源的尾部行为，本件只作显式选项）。 */
export function tidyBlankLines(text) {
    return String(text === null || text === undefined ? '' : text).replace(/\n{3,}/g, '\n\n');
}

/**
 * 逐条应用规则。返回 `{ text, applied, errors }`。
 *   · applied = 真正跑过的规则条数（无效规则不计）；
 *   · errors  = 每条**编译失败**的规则 `{ pattern, message }`（源只 console.error，本件上报）。
 * 坏规则**跳过而不吞文本**：一条坏规则不得让整段文本消失。
 */
export function applyRulesToText(text, rules, options) {
    const src = String(text === null || text === undefined ? '' : text);
    const opts = (options && typeof options === 'object') ? options : {};
    const list = Array.isArray(rules) ? rules : [];
    const errors = [];
    let out = src;
    let applied = 0;
    for (const raw of list) {
        const norm = normalizeRule(raw);
        if (!norm) continue;
        const c = compileRule(norm);
        if (!c.ok) { errors.push({ pattern: norm.pattern, message: c.error }); continue; }
        out = out.replace(c.regex, norm.replace);
        applied += 1;
    }
    if (opts.tidy === true) out = tidyBlankLines(out);
    return { text: out, applied, errors };
}

/**
 * 按预设表应用（外壳保护 + 角色绑定过滤）。返回 `{ text, applied, errors, matchedPresets }`。
 * 绑定语义（源同）：预设的 `boundChars` 为空 ⇒ 对所有角色生效；非空 ⇒ 只对列在其中的角色生效。
 */
export function applyPresetsToText(text, presets, charId, options) {
    const list = normalizePresets(presets);
    const cid = String(charId === null || charId === undefined ? '' : charId);
    const wrap = splitWrapper(text);
    let body = wrap.body;
    let applied = 0;
    const errors = [];
    const matched = [];
    for (const p of list) {
        if (!p.enabled) continue;
        const bound = p.boundChars;
        const hit = bound.length === 0 || (cid && bound.includes(cid));
        if (!hit) continue;
        matched.push(p.id);
        const r = applyRulesToText(body, p.rules, options);
        body = r.text;
        applied += r.applied;
        for (const e of r.errors) errors.push({ preset: p.id, pattern: e.pattern, message: e.message });
    }
    return { text: wrap.prefix + body + wrap.suffix, applied, errors, matchedPresets: matched };
}

/**
 * 导出成 SillyTavern 正则脚本（每规则一条）。字段按 ST 正则扩展的实际结构给。
 * ★ 本件只**产出文本**，不写盘、不注入 ST（见文件头第 ② 条：零自动改写）。
 */
export function toStileRegexScripts(preset) {
    const p = normalizePreset(preset);
    if (!p) return [];
    return p.rules.map((r, i) => ({
        id: p.id + '_' + i,
        scriptName: p.name + (p.rules.length > 1 ? (' #' + (i + 1)) : ''),
        findRegex: '/' + r.pattern + '/g',
        replaceString: r.replace,
        trimStrings: [],
        placement: [1, 2],
        disabled: p.enabled === false,
        markdownOnly: false,
        promptOnly: false,
        runOnEdit: false,
        substituteRegex: 0,
        minDepth: null,
        maxDepth: null,
    }));
}

/** 预设表 → 可复制的 JSON 文本（导入端吃同形）。 */
export function toExportText(presets) {
    const list = normalizePresets(presets);
    return JSON.stringify({ kind: 'ruby-phone.regexfilter', schemaVersion: 1, presets: list }, null, 2);
}

/**
 * JSON 文本 → `{ presets, ok, reason }`。
 * 接受两种形态：本件导出物（`{ presets: [...] }`）与**裸数组**（用户手写的 `[{...}]`）。
 * 解析失败 / 形状不对一律如实返回 ok=false 与原因，**不抛**（调用方不写 try/catch）。
 */
export function fromImportText(text) {
    const s = String(text === null || text === undefined ? '' : text).trim();
    if (!s) return { presets: [], ok: false, reason: 'empty' };
    let data = null;
    try { data = JSON.parse(s); } catch (_e) { return { presets: [], ok: false, reason: 'bad-json' }; }
    const list = Array.isArray(data) ? data : (data && Array.isArray(data.presets) ? data.presets : null);
    if (!list) return { presets: [], ok: false, reason: 'bad-shape' };
    const presets = normalizePresets(list);
    if (!presets.length) return { presets: [], ok: false, reason: 'no-valid-preset' };
    return { presets, ok: true, reason: 'ok' };
}

/** 投影（读数）。坏规则**如实计数**，不静默吞掉。 */
export function projectRgx(presets) {
    const list = normalizePresets(presets);
    let ruleCount = 0;
    let invalidCount = 0;
    let enabledCount = 0;
    const charIds = new Set();
    for (const p of list) {
        if (p.enabled) enabledCount += 1;
        for (const r of p.rules) {
            ruleCount += 1;
            if (!isRuleValid(r)) invalidCount += 1;
        }
        for (const c of p.boundChars) charIds.add(c);
    }
    return {
        presetCount: list.length,
        enabledCount,
        ruleCount,
        invalidCount,
        boundCharCount: charIds.size,
        boundCharIds: [...charIds],
        hasAny: list.length > 0,
    };
}

/** 归因：先判能不能读，再判读到了什么（与 focus / piggy 同纪律）。 */
export function readRgxFace(probe) {
    if (!probe || probe.storageOk === false) return RGX_REASONS.storage_absent;
    if (probe.hasPresets !== true) return RGX_REASONS.empty;
    return RGX_REASONS.ready;
}