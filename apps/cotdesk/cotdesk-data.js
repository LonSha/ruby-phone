/* ========================================================
 * cotdesk-data.js — [v3.46.0] 思维链案头 · 纯函数内核
 *
 * 数据层：本文件（纯函数）  落盘与接线：cotdesk-app.js  视图：cotdesk-view.js
 *
 * ── 源与立场差（素材缝合第 3 层第十件 · 思维链一族两片同族）
 *   源是**请求管线上的动手者**：自己按模型名猜预填策略、自己把条目
 *   splice 进消息数组、自己往请求体塞思考参数、自己从回复里抠出思考段
 *   并从正文里删掉、自己把整套配置写进宿主的大对象、自己直读界面元素。
 *   本件是**案头** —— 只把**一份条目册**收拾成可对账的账：
 *   条目 / 落点 / 接口 / 锁定 / 字数，产可复制的要求文本（requestText）。
 *   本件**不发请求、不改提示词、不抠正文**：它只回答
 *   「照这份册子配下去，会发生什么」。
 *
 * ── 四块不缝（源的整套能力，本件一律不接）──────────────
 *   ① 不改写宿主提示词：源自己拼系统提示与消息数组；
 *   ② 不发请求不塞参数：源写推理强度 / 思考预算 / 额外请求体；
 *   ③ 不抠正文：源按起止标记从回复里截出思考段并从正文里删掉；
 *   ④ 不读宿主界面元素：源满篇直读宿主元素。
 *
 * ── 四条偏离（逐条对着源的静默失效）──────────────────
 *   ① **位置不许塌平**：源里「首部」与「中段」的非系统条目都进同一个
 *      头部消息数组 —— 两个不同位置落成同一处，界面上看不出来；
 *   ② **策略不许猜**：源按模型名猜末尾预填策略，猜不出就默认助手预填
 *      （本件把「声明值 / 谁来决定」分开报）；
 *   ③ **参数不许静默丢**：源对认不出的接口把思考参数整块丢掉，
 *      界面上只写一句话（本件逐接口报会给哪些字段、认不认）；
 *   ④ **锁定不许两边不同形**：源的锁定既是数据字段又是界面禁令，
 *      而装载时还有一段**静默解锁**历史数据（把首末条目的锁定改成未锁）。
 *
 * ── 静默失效形态（本件守的，都不报错、不崩溃，只是结果不对）──
 *   · 条目册读不出来 **不许**读成「就是空的」（四态面分开）；
 *   · 位置认不出来 **不许**当成中段落下去；
 *   · 深度取不出来 **不许**读成 0 层；
 *   · 开关缺字段 **不许**替它读成真（源把缺字段读成真）；
 *   · 空条目册 **不许**静默换回默认条目（源在这里换）；
 *   · 正文超上限 **不许**静默截（只报）；
 *   · 台账挤掉旧记录 **不许**静默（报被挤掉几条）。
 *
 * ── 实现纪律 ──────────────────────────────────────────
 *   本件不许出现正则字面量、反斜杠与反引号，也不写裸的尖括号字面量：
 *   一切字符切分走 indexOf / slice / split，尖括号走拼装形。
 * ======================================================== */
'use strict';
const LT = String.fromCharCode(60);
const GT = String.fromCharCode(62);
const NL = String.fromCharCode(10);
const DQ = String.fromCharCode(34);
const SQ = String.fromCharCode(39);
const OPEN_TAG = LT + 'thinking' + GT;
const CLOSE_TAG = LT + '/' + 'thinking' + GT;
/* ══════════ 源清单（两片同族，本件取治理面） ══════════ */
export const CD_SOURCE_NOTE = 'EPhone·xintuk 思维链片（注入内核）与 UwU 思维链设置片（条目与预设管理）同族';
export const CD_SOURCE_FILES = Object.freeze([
    { key: 'tuk', file: 'src_xintuk/runtime/scripts/thought-chain/001.js', role: '注入内核：位置 / 角色 / 深度 / 预填策略 / 原生思考参数', bytes: 45035, lines: 864 },
    { key: 'uwu', file: 'ex_uwu/js/modules/cot_settings.js', role: '条目与预设管理：条目册 / 预设 / 锁定 / 导入导出', bytes: 50268, lines: 1129 }
]);
/* ══════════ 六套枚举（键面取真源） ══════════ */
export const CD_MODES = Object.freeze(['native_off', 'card', 'hybrid']);
export const CD_PROVIDERS = Object.freeze(['auto', 'gemini', 'claude', 'deepseek', 'openai', 'compatible']);
export const CD_POSITIONS = Object.freeze(['head', 'middle', 'before_history', 'in_chat', 'after_history', 'tail']);
export const CD_ROLES = Object.freeze(['system', 'user', 'assistant']);
export const CD_PREFILLS = Object.freeze(['auto', 'assistant', 'user', 'system', 'none']);
export const CD_EFFORTS = Object.freeze(['auto', 'minimal', 'low', 'medium', 'high', 'max']);
/* ══════════ 六张文案表（键面取真源值，不写标识符形） ══════════ */
export const CD_MODE_TEXT = Object.freeze({
    [CD_MODES[0]]: '关掉宿主自带的思考',
    [CD_MODES[1]]: '只用条目册里的条目',
    [CD_MODES[2]]: '两边都用'
});
export const CD_PROVIDER_TEXT = Object.freeze({
    [CD_PROVIDERS[0]]: '自动识别（本件按特征词判，判不出就说判不出）',
    [CD_PROVIDERS[1]]: 'Gemini',
    [CD_PROVIDERS[2]]: 'Claude / Anthropic 兼容',
    [CD_PROVIDERS[3]]: 'DeepSeek',
    [CD_PROVIDERS[4]]: 'OpenAI',
    [CD_PROVIDERS[5]]: '兼容接口'
});
export const CD_POSITION_TEXT = Object.freeze({
    [CD_POSITIONS[0]]: '首部',
    [CD_POSITIONS[1]]: '中段',
    [CD_POSITIONS[2]]: '历史之前',
    [CD_POSITIONS[3]]: '历史之内（按深度）',
    [CD_POSITIONS[4]]: '历史之后',
    [CD_POSITIONS[5]]: '末尾触发器'
});
export const CD_ROLE_TEXT = Object.freeze({
    [CD_ROLES[0]]: '系统',
    [CD_ROLES[1]]: '用户',
    [CD_ROLES[2]]: '助手'
});
export const CD_PREFILL_TEXT = Object.freeze({
    [CD_PREFILLS[0]]: '自动（源按模型名猜，本件不许猜）',
    [CD_PREFILLS[1]]: '末尾加一条助手消息',
    [CD_PREFILLS[2]]: '末尾加一条用户消息',
    [CD_PREFILLS[3]]: '并进系统提示',
    [CD_PREFILLS[4]]: '不加末尾触发'
});
export const CD_EFFORT_TEXT = Object.freeze({
    [CD_EFFORTS[0]]: '不动（保留接口默认值）',
    [CD_EFFORTS[1]]: '最小',
    [CD_EFFORTS[2]]: '低',
    [CD_EFFORTS[3]]: '中',
    [CD_EFFORTS[4]]: '高',
    [CD_EFFORTS[5]]: '最大'
});
/* ══════════ 六个落点（位置 × 角色 真值表的六个结果） ══════════ */
export const CD_SIDES = Object.freeze([
    { key: 'system', label: '并进系统提示', where: 'system' },
    { key: 'lead', label: '历史之前的一条消息', where: 'messages' },
    { key: 'history_in', label: '按深度插进历史', where: 'messages' },
    { key: 'history_after', label: '历史之后的一条消息', where: 'messages' },
    { key: 'prefill', label: '末尾触发器', where: 'tail' },
    { key: 'unknown', label: '落点认不出来', where: 'none' }
]);
/* ══════════ 接口特征词表（判不出就说判不出，不硬猜） ══════════ */
export const CD_HINTS = Object.freeze([
    { key: 'gemini', words: ['generativelanguage', 'gemini'] },
    { key: 'claude', words: ['anthropic', 'claude'] },
    { key: 'deepseek', words: ['deepseek'] },
    { key: 'openai', words: ['openai', 'gpt-', 'o1', 'o3', 'o4'] }
]);
/* ══════════ 原生思考字段表（本件只报意图，不真发请求） ══════════ */
export const CD_NATIVE_FIELDS = Object.freeze([
    { provider: 'openai', field: 'reasoning_effort', note: '推理强度' },
    { provider: 'deepseek', field: 'thinking.type', note: '开关型' },
    { provider: 'gemini', field: 'thinkingConfig', note: '级别或预算' },
    { provider: 'claude', field: 'thinking.type', note: '关闭型' }
]);
/* ══════════ 收册失败因（八键，逐项自成字面；**键面即真源**） ══════════ */
export const CD_INTAKE_WHYS = Object.freeze([
    'empty_input', 'too_long', 'empty', 'no_bracket', 'bad_json', 'no_items', 'empty_items', 'too_many'
]);
/* ══════════ 上限 ══════════ */
export const CD_ITEM_MAX = 24;
export const CD_ITEM_TEXT_MAX = 8000;
export const CD_NAME_MAX = 80;
export const CD_DEPTH_MAX = 999;
export const CD_TEXT_MAX = 60000;
export const CD_CHARS_MAX = 40000;
export const CD_LOG_MAX = 40;
export const CD_ROWS_SHOWN = 40;
/* ══════════ 小工具 ══════════ */
export function cleanText(v) {
    return (typeof v === 'string') ? v : '';
}
export function charCount(v) {
    return cleanText(v).length;
}
export function numOrNull(v) {
    if (typeof v === 'number') return isFinite(v) ? v : null;
    if (typeof v === 'string') {
        const s = v.trim();
        if (!s.length) return null;
        const n = Number(s);
        return isFinite(n) ? n : null;
    }
    return null;
}
export function intOrNull(v) {
    const n = numOrNull(v);
    if (n === null) return null;
    return Math.trunc(n);
}
export function isPlainObject(v) {
    return Boolean(v) && typeof v === 'object' && !Array.isArray(v);
}
/** 在枚举表里找下标（找不到回 -1，**不猜一个邻近值**）。 */
export function indexIn(list, key) {
    const s = cleanText(key);
    const arr = Array.isArray(list) ? list : [];
    for (let i = 0; i < arr.length; i++) {
        if (arr[i] === s) return i;
    }
    return -1;
}
/* ══════════ 条目归一（严格：缺字段不许替它编值） ══════════ */
export function normalizeItem(input, index) {
    const src = isPlainObject(input) ? input : {};
    const i = (typeof index === 'number' && index >= 0) ? Math.trunc(index) : 0;
    const rawName = cleanText(src.name);
    const content = cleanText(src.content);
    const posRaw = cleanText(src.position);
    const roleRaw = cleanText(src.role);
    const depthRaw = src.depth;
    const depthNum = intOrNull(depthRaw);
    const idRaw = cleanText(src.id);
    return {
        id: idRaw.length ? idRaw : ('cd_item_' + String(i + 1)),
        idGiven: idRaw.length > 0,
        name: rawName.slice(0, CD_NAME_MAX),
        nameOver: rawName.length > CD_NAME_MAX,
        position: posRaw,
        positionOk: indexIn(CD_POSITIONS, posRaw) >= 0,
        role: roleRaw,
        roleOk: indexIn(CD_ROLES, roleRaw) >= 0,
        depth: depthNum,
        depthRaw: depthRaw,
        depthOk: depthNum !== null,
        content: content,
        contentChars: content.length,
        contentOver: content.length > CD_ITEM_TEXT_MAX,
        enabled: src.enabled === true,
        enabledGiven: typeof src.enabled === 'boolean',
        locked: src.locked === true,
        lockedGiven: typeof src.locked === 'boolean',
        blank: rawName.length === 0 && content.length === 0
    };
}
/* ══════════ 落点面（位置 × 角色 → 六侧之一；塌平标记） ══════════ */
export function sideDef(key) {
    const s = cleanText(key);
    for (let i = 0; i < CD_SIDES.length; i++) {
        if (CD_SIDES[i].key === s) return CD_SIDES[i];
    }
    return CD_SIDES[CD_SIDES.length - 1];
}
export function positionFace(item) {
    const it = isPlainObject(item) ? item : {};
    const pos = cleanText(it.position);
    const role = cleanText(it.role);
    const known = indexIn(CD_POSITIONS, pos) >= 0;
    const roleKnown = indexIn(CD_ROLES, role) >= 0;
    let side = 'unknown';
    let flattened = false;
    let why = '';
    if (!known) {
        why = '位置不在六个已知值里';
    } else if (!roleKnown) {
        why = '角色不在三个已知值里';
    } else if (pos === CD_POSITIONS[0]) {
        if (role === CD_ROLES[0]) side = 'system';
        else { side = 'lead'; flattened = true; why = '源里首部与中段的非系统条目落在同一处'; }
    } else if (pos === CD_POSITIONS[1]) {
        if (role === CD_ROLES[0]) side = 'system';
        else { side = 'lead'; flattened = true; why = '源里首部与中段的非系统条目落在同一处'; }
    } else if (pos === CD_POSITIONS[2]) {
        side = 'lead';
    } else if (pos === CD_POSITIONS[3]) {
        side = 'history_in';
    } else if (pos === CD_POSITIONS[4]) {
        side = 'history_after';
    } else {
        side = 'prefill';
    }
    const def = sideDef(side);
    return {
        position: pos, role: role, known: known, roleKnown: roleKnown,
        side: side, sideLabel: def.label, where: def.where,
        flattened: flattened, why: why
    };
}
/* ══════════ 深度面（取不出来不许读成 0 层） ══════════ */
export function depthFace(raw, position) {
    const n = intOrNull(raw);
    const pos = cleanText(position);
    if (n === null) {
        return {
            value: null, raw: raw, blank: true, clamped: false, over: false,
            applies: (pos === CD_POSITIONS[3]),
            text: '--', why: '深度取不出来'
        };
    }
    const neg = n < 0;
    const over = n > CD_DEPTH_MAX;
    const v = neg ? 0 : (over ? CD_DEPTH_MAX : n);
    return {
        value: v, raw: raw, blank: false, clamped: (neg || over), over: over,
        applies: (pos === CD_POSITIONS[3]),
        text: String(v), why: neg ? '源会把负数钳到 0' : (over ? '源会把过大的深度钳到上限' : '')
    };
}
/* ══════════ 接口面（声明 / 特征词命中 / 判不出） ══════════ */
export function providerFace(declared, url, model) {
    const d = cleanText(declared);
    const u = cleanText(url).toLowerCase();
    const m = cleanText(model).toLowerCase();
    const declaredOk = indexIn(CD_PROVIDERS, d) >= 0;
    let provider = 'compatible';
    let source = 'none';
    let hit = '';
    if (d.length && d !== CD_PROVIDERS[0]) {
        provider = declaredOk ? d : 'compatible';
        source = declaredOk ? 'declared' : 'bad_declared';
    } else {
        for (let i = 0; i < CD_HINTS.length; i++) {
            const h = CD_HINTS[i];
            for (let j = 0; j < h.words.length; j++) {
                const w = h.words[j];
                if (u.indexOf(w) >= 0 || m.indexOf(w) >= 0) {
                    provider = h.key;
                    source = 'hinted';
                    hit = w;
                    break;
                }
            }
            if (source === 'hinted') break;
        }
    }
    const label = CD_PROVIDER_TEXT[provider] ? CD_PROVIDER_TEXT[provider] : provider;
    return {
        declared: d.length ? d : CD_PROVIDERS[0], declaredOk: declaredOk,
        provider: provider, source: source, hit: hit, label: label,
        certain: (source === 'declared' || source === 'hinted'),
        text: label + (source === 'hinted' ? ('（按特征词 ' + hit + ' 判出）')
            : (source === 'declared' ? '（册子上写明的）' : '（未命中任何特征词，按兼容接口算）'))
    };
}
/* ══════════ 预填面（声明 auto 就报「谁来决定」，不替它猜） ══════════ */
export function prefillFace(declared, mode) {
    const d = cleanText(declared);
    const m = cleanText(mode);
    const ok = indexIn(CD_PREFILLS, d) >= 0;
    const value = ok ? d : CD_PREFILLS[0];
    const needMode = (m === CD_MODES[0]);
    const joinsSystem = (value === CD_PREFILLS[3]);
    return {
        declared: d.length ? d : '(没写)', declaredOk: ok, value: value,
        isAuto: (value === CD_PREFILLS[0]), joinsSystem: joinsSystem,
        applies: !needMode,
        blocked: needMode,
        text: CD_PREFILL_TEXT[value] + (needMode ? '（当前模式不用条目册，这一项不生效）' : ''),
        why: (value === CD_PREFILLS[0]) ? '声明是自动：源在这里按模型名猜，本件只报「要谁来决定」，不替它猜' : ''
    };
}
/* ══════════ 原生思考面（逐接口报会给哪些字段、认不认） ══════════ */
export function nativeFace(provider, effort, mode) {
    const p = cleanText(provider);
    const e = cleanText(effort);
    const m = cleanText(mode);
    let field = '';
    let note = '';
    for (let i = 0; i < CD_NATIVE_FIELDS.length; i++) {
        if (CD_NATIVE_FIELDS[i].provider === p) {
            field = CD_NATIVE_FIELDS[i].field;
            note = CD_NATIVE_FIELDS[i].note;
            break;
        }
    }
    const supported = field.length > 0;
    const silent = !supported;
    const disabling = (m === CD_MODES[0]);
    const effortOk = indexIn(CD_EFFORTS, e) >= 0;
    const effortValue = effortOk ? e : CD_EFFORTS[0];
    const wants = disabling ? '关掉' : ((effortValue === CD_EFFORTS[0]) ? '不动' : ('设为 ' + effortValue));
    return {
        provider: p, field: field, note: note, supported: supported, silent: silent,
        disabling: disabling, effort: effortValue, wants: wants,
        text: supported
            ? ('会带上 ' + field + '（' + note + '）：意图 ' + wants)
            : ('这个接口不在四个已知字段里 —— 源在这里把思考参数整块丢掉，界面上只写一句话'),
        why: silent ? '认不出的接口不许静默丢参数' : ''
    };
}
/* ══════════ 锁定面（声明锁定 / 实际能不能动 / 首末位占没占） ══════════ */
export function lockFace(items) {
    const list = Array.isArray(items) ? items : [];
    const rows = [];
    let lockedCount = 0;
    let firstLocked = false;
    let lastLocked = false;
    for (let i = 0; i < list.length; i++) {
        const it = isPlainObject(list[i]) ? list[i] : {};
        const locked = it.locked === true;
        if (locked) lockedCount += 1;
        if (i === 0 && locked) firstLocked = true;
        if (i === list.length - 1 && locked) lastLocked = true;
        rows.push({
            index: i, id: cleanText(it.id), name: cleanText(it.name) || ('(第 ' + String(i + 1) + ' 条)'),
            locked: locked, movable: !locked,
            text: locked ? '声明锁定：不可改、不可删、不可挪' : '可动'
        });
    }
    return {
        rows: rows, total: rows.length, lockedCount: lockedCount,
        firstLocked: firstLocked, lastLocked: lastLocked,
        bothEnds: (firstLocked && lastLocked),
        movableCount: rows.length - lockedCount,
        why: '源把锁定同时当数据字段与界面禁令，装载时还有一段静默解锁：同一处两个语义都报出来'
    };
}
/* ══════════ 条目面（逐条对账） ══════════ */
export function itemFace(input, index) {
    const it = normalizeItem(input, index);
    const pos = positionFace(it);
    const dep = depthFace(it.depthRaw, it.position);
    const problems = [];
    const blank = it.blank;
    if (!blank && !it.positionOk) problems.push('位置认不出来');
    if (!blank && !it.roleOk) problems.push('角色认不出来');
    if (!blank && !it.contentChars) problems.push('正文是空的');
    if (it.contentOver) problems.push('正文超过上限（只报，不截）');
    if (!blank && !it.enabledGiven) problems.push('没有开关字段（本件按关算，源按开算）');
    if (!it.depthOk && pos.side === 'history_in') problems.push('按深度插入却没有可读的深度');
    if (pos.flattened) problems.push('落点被塌平到与首部同一处');
    return {
        index: (typeof index === 'number') ? Math.trunc(index) : 0,
        id: it.id, name: it.name || ('(第 ' + String((typeof index === 'number' ? index : 0) + 1) + ' 条)'),
        enabled: it.enabled, locked: it.locked, blank: it.blank,
        chars: it.contentChars, over: it.contentOver,
        position: it.position, role: it.role, depth: dep,
        side: pos.side, sideLabel: pos.sideLabel, where: pos.where,
        flattened: pos.flattened, problems: problems, problemText: problems.join('；'),
        ok: problems.length === 0
    };
}
export function itemSummary(rows) {
    const list = Array.isArray(rows) ? rows : [];
    const sides = {};
    for (let i = 0; i < CD_SIDES.length; i++) sides[CD_SIDES[i].key] = 0;
    let on = 0, off = 0, locked = 0, bad = 0, flat = 0, chars = 0;
    for (let i = 0; i < list.length; i++) {
        const r = list[i];
        if (r.enabled) on += 1; else off += 1;
        if (r.locked) locked += 1;
        if (!r.ok) bad += 1;
        if (r.flattened) flat += 1;
        chars += (typeof r.chars === 'number' ? r.chars : 0);
        if (sides[r.side] !== undefined) sides[r.side] += 1;
    }
    return {
        items: list.length, on: on, off: off, locked: locked, bad: bad,
        flattened: flat, chars: chars, charsOver: chars > CD_CHARS_MAX, sides: sides,
        empty: list.length === 0
    };
}
/* ══════════ 正文体检（只报数，不改写、不抠字） ══════════ */
export function textScan(text) {
    const s = cleanText(text);
    if (!s.length) {
        return { chars: 0, open: 0, close: 0, paired: 0, unpaired: 0, blank: true, text: '--' };
    }
    let from = 0;
    let open = 0;
    while (true) {
        const at = s.indexOf(OPEN_TAG, from);
        if (at < 0) break;
        open += 1;
        from = at + OPEN_TAG.length;
    }
    from = 0;
    let close = 0;
    while (true) {
        const at = s.indexOf(CLOSE_TAG, from);
        if (at < 0) break;
        close += 1;
        from = at + CLOSE_TAG.length;
    }
    const paired = Math.min(open, close);
    const unpaired = open + close - paired * 2;
    return {
        chars: s.length, open: open, close: close, paired: paired, unpaired: unpaired,
        blank: false,
        text: '起 ' + String(open) + ' 处 / 止 ' + String(close) + ' 处 / 成对 ' + String(paired) + ' 对 / 落单 ' + String(unpaired) + ' 处'
    };
}
/* ══════════ 贴回来的条目册浅解析（空册与没册不同形） ══════════ */
export function extractItems(text) {
    const s = cleanText(text);
    if (!s.length) return { ok: false, why: 'empty', list: [], total: 0 };
    if (s.indexOf('[') < 0 && s.indexOf('{') < 0) return { ok: false, why: 'no_bracket', list: [], total: 0 };
    let v = null;
    try { v = JSON.parse(s); }
    catch (e) { return { ok: false, why: 'bad_json', list: [], total: 0 }; }
    let list = null;
    if (Array.isArray(v)) list = v;
    else if (isPlainObject(v) && Array.isArray(v.items)) list = v.items;
    if (!list) return { ok: false, why: 'no_items', list: [], total: 0 };
    if (!list.length) return { ok: false, why: 'empty_items', list: [], total: 0 };
    return { ok: true, why: 'ok', list: list, total: list.length };
}
/* ══════════ 配置面（册子上写明的模式 / 接口 / 强度 / 预填） ══════════ */
export function configFace(text) {
    const s = cleanText(text);
    const blank = { mode: '', provider: '', nativeEffort: '', prefill: '', enabled: false, enabledGiven: false, scopes: '', given: false };
    if (!s.length) return Object.assign({}, blank, { why: 'empty' });
    let v = null;
    try { v = JSON.parse(s); }
    catch (e) { return Object.assign({}, blank, { why: 'bad_json' }); }
    if (Array.isArray(v)) return Object.assign({}, blank, { why: 'bare_list' });
    if (!isPlainObject(v)) return Object.assign({}, blank, { why: 'not_object' });
    let scopes = '';
    if (isPlainObject(v.scopes)) {
        const tags = [];
        if (v.scopes.chat === false) tags.push('对话不生效');
        else tags.push('对话生效');
        if (v.scopes.offline === false) tags.push('离线不生效');
        else tags.push('离线生效');
        scopes = tags.join(' / ');
    }
    return {
        mode: cleanText(v.mode), provider: cleanText(v.provider),
        nativeEffort: cleanText(v.nativeEffort), prefill: cleanText(v.prefillStrategy),
        enabled: v.enabled === true, enabledGiven: typeof v.enabled === 'boolean',
        scopes: scopes, given: true, why: 'ok'
    };
}
/* ══════════ 台账裁边（挤掉几条要报） ══════════ */
export function cdTrim(list, max) {
    const src = Array.isArray(list) ? list : [];
    const capInt = intOrNull(max);
    const cap = (capInt === null || capInt <= 0) ? CD_LOG_MAX : capInt;
    if (src.length <= cap) return { rows: src.slice(), dropped: 0 };
    const cut = src.length - cap;
    return { rows: src.slice(cut), dropped: cut };
}
/* ══════════ 余量面（取不出来画横线，不画 0） ══════════ */
export function gaugesOf(input) {
    const src = isPlainObject(input) ? input : {};
    const defs = [
        { key: 'items', label: '条目册', max: CD_ITEM_MAX },
        { key: 'chars', label: '册子字数', max: CD_CHARS_MAX },
        { key: 'logs', label: '动作台账', max: CD_LOG_MAX }
    ];
    const out = [];
    for (let i = 0; i < defs.length; i++) {
        const d = defs[i];
        const v = intOrNull(src[d.key]);
        out.push({
            key: d.key, label: d.label, value: v, max: d.max,
            over: (v !== null && v > d.max), blank: (v === null),
            pct: (v === null) ? 0 : Math.min(100, Math.round((v / d.max) * 100)),
            text: (v === null) ? '--' : (String(v) + ' / ' + String(d.max))
        });
    }
    return out;
}
export function gaugeText(cell) {
    if (!isPlainObject(cell)) return '--';
    if (cell.blank) return '--';
    return String(cell.value) + ' / ' + String(cell.max);
}
/* ══════════ 要求文本（本件唯一的产出物） ══════════ */
export function requestText(face, target, extra) {
    const f = isPlainObject(face) ? face : {};
    const t = cleanText(target);
    const e = cleanText(extra);
    const lines = [];
    lines.push('请照下面这份思维链条目册配，不要替我改提示词、也不要替我发请求。');
    lines.push('模式：' + cleanText(f.modeText || '——'));
    lines.push('接口：' + cleanText(f.providerText || '——'));
    lines.push('末尾预填：' + cleanText(f.prefillText || '——'));
    lines.push('原生思考：' + cleanText(f.nativeText || '——'));
    const rows = Array.isArray(f.rows) ? f.rows : [];
    if (rows.length) {
        lines.push('条目 ' + String(rows.length) + ' 条，逐条照抄位置 / 角色 / 深度 / 开关：');
        const shown = rows.slice(0, CD_ROWS_SHOWN);
        for (let i = 0; i < shown.length; i++) {
            lines.push('  ' + String(i + 1) + '. ' + cleanText(shown[i].name) + '（' + cleanText(shown[i].position) + ' / ' + cleanText(shown[i].role) + ' / 深度 ' + cleanText(shown[i].depthText) + '）');
        }
        if (rows.length > CD_ROWS_SHOWN) lines.push('  （还有 ' + String(rows.length - CD_ROWS_SHOWN) + ' 条同上）');
    } else {
        lines.push('条目：一份都没有（**这是空册，不是默认册**）。');
    }
    if (f.flat > 0) lines.push('注意：有 ' + String(f.flat) + ' 条落的落点会被塌平到与首部同一处，请确认是不是你要的。');
    if (f.unknown > 0) lines.push('注意：有 ' + String(f.unknown) + ' 条的落点认不出来，请先补位置与角色。');
    if (t) lines.push('目标：' + t);
    if (e) lines.push('追加要求：' + e);
    lines.push('逐条回报：落点（系统提示 / 历史前 / 历史内 / 历史后 / 末尾触发器）、深度是否被钳位、开关缺字段的两边读法、认不出的位置。');
    return lines.join(NL);
}
