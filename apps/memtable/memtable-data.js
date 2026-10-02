/* ========================================================
 * memtable-data.js — [v3.49.0] 结构化记忆案头 · 纯函数内核
 *
 * 数据层：本文件（纯函数）  落盘与接线：memtable-app.js  视图：memtable-view.js
 *
 * ── 源与立场差（素材缝合第 3 层 · EPhone·xINOVO 记忆表格一族）
 *   源是 src_xinovo/js/modules/memory_table.js（3245 行 / 119 函数，IIFE 包裹）：
 *   一套「结构化长期记忆」机制 —— 模板（template）＞表格（table，keyValue / rows
 *   两型）＞字段（field，八型 text/longtext/number/enum/tags/progress/date/boolean）
 *   三级册子；每个聊天绑定若干模板、按模板落数据、按变更记历史快照（上限 20）、
 *   支持把聊天记录**贴给宿主 AI** 拿回 ''<memory_updates>'' XML 再就地应用。
 *   本件是**案头**：把那套机制读成**可校验、可解析、可落账的读数与计划**。
 *   根本立场差：**源是「发请求的那个人」，本件零网络、零 AI、零 DOM** ——
 *   更新包由用户从任何对话端**贴回来**，本件只负责把贴回来的东西
 *   归一、校验、解析成**逐条更新计划**（哪一模板 / 哪一表 / 哪一字段或哪一行 /
 *   旧值 / 新值 / 为什么收或不收），并产出台账与读数。
 *
 * ── 四块不缝（源的整套动作，本件一律不接）──────────────
 *   ① 不发请求、不拼提示词：源 buildTemplateDefinitionForPrompt 拼一大段
 *      systemPrompt 直打 AI；本件一句提示词都不产，只把**模板定义文本**
 *      归一成可复制的样子交给用户；
 *   ② 不用 DOMParser：源用宿主 DOMParser 解 XML；本仓数据层禁碰 DOM，
 *      本件的 XML 解析是**自写的逐字符状态机**，坏结构逐条报因；
 *   ③ 不写宿主数据库：源把模板与数据挂 db.memoryTableTemplates 与
 *      chat.memoryTables（Dexie 整块回写）；本件零数据库，落 PhoneStorage
 *      会话键（接线层的活，本文件不碰存储）；
 *   ④ 不画图表、不碰 canvas：源 drawSparkline 画历史曲线；本件只产
 *      **历史序列读数**（至多 12 个点），画不画是视图的事。
 *
 * ── 静默失效形态（本件守的，都不报错、不崩溃，只是结果不对）──
 *   · 字段类型认不出 **不许**当 text 之外还多报一笔（归一成 text 并记 why）；
 *   · 数值夹取 **不许**无声改数（夹了要报 clamped）；
 *   · enum 值不在册 **不许**静默回缺省（报 fallback）；
 *   · XML 坏结构 **不许**整段丢（逐条报因，能收的几条照收）；
 *   · 目标模板 / 表 / 行认不出 **不许**硬塞（报 unknown_*）；
 *   · 锁定字段与 aiEditable=false **不许**被更新包改写（报 blocked）；
 *   · fill_empty 策略下非空字段 **不许**被覆盖（报 kept）；
 *   · 历史超上限 **不许**静默挤掉（报 dropped）。
 *
 * ── 实现纪律 ──────────────────────────────────────────
 *   本件不许出现反引号模板串与正则字面量（本仓剥注释器是字符状态机、
 *   不解析正则），反斜杠与引号一律走 String.fromCharCode 拼装形；
 *   本件零网络、零 DOM、零存储、零定时器。
 * ======================================================== */
'use strict';
/* 行切分（CRLF / LF；裸 CR 按普通字符）。 */
function lineSplit(s) {
    const LF = String.fromCharCode(10);
    const CR = String.fromCharCode(13);
    const out = [];
    let cur = '';
    for (let i = 0; i < s.length; i++) {
        const ch = s.charAt(i);
        if (ch === LF) { out.push(cur); cur = ''; }
        else if (ch === CR && s.charAt(i + 1) === LF) { i++; out.push(cur); cur = ''; }
        else cur += ch;
    }
    out.push(cur);
    return out;
}
/* 列表分隔切分（半角逗号 / 全角逗号 / 顿号）。 */
const LIST_SEPS = [String.fromCharCode(44), String.fromCharCode(65292), String.fromCharCode(12289)];
function splitList(s) {
    const out = [];
    let cur = '';
    for (let i = 0; i < s.length; i++) {
        const ch = s.charAt(i);
        if (LIST_SEPS.indexOf(ch) >= 0) { out.push(cur); cur = ''; }
        else cur += ch;
    }
    out.push(cur);
    return out;
}
function isWs(ch) {
    return ch === ' ' || ch === String.fromCharCode(9) || ch === String.fromCharCode(10) || ch === String.fromCharCode(13);
}

/* ---------- 真源常量（单一出处；视图与接线层的键面一律取这里） ---------- */

/* 字段八型（源 normalizeFieldType 的 supported 表，原序）。 */
export const MT_FIELD_TYPES = Object.freeze([
    'text', 'longtext', 'number', 'enum', 'tags', 'progress', 'date', 'boolean'
]);
/* 表格两型（源 table.mode 判定，rows 之外一律 keyValue）。 */
export const MT_TABLE_MODES = Object.freeze(['keyValue', 'rows']);
/* 历史快照上限（源 MEMORY_TABLE_HISTORY_LIMIT）。 */
export const MT_HISTORY_LIMIT = 20;
/* 历史序列读数上限（源 getFieldHistorySeries 的 slice(-12)）。 */
export const MT_SERIES_MAX = 12;
/* 上下文消息上限（源 MEMORY_TABLE_MAX_CONTEXT_MESSAGES）。 */
export const MT_CONTEXT_MESSAGES_MAX = 60;
/* 更新策略两形（源 options.strategy；overwrite 为缺省）。 */
export const MT_STRATEGIES = Object.freeze(['overwrite', 'fill_empty']);
/* 行操作三形（源 row op：delete / add / update，缺省 update）。 */
export const MT_ROW_OPS = Object.freeze(['add', 'update', 'delete']);
/* 模板库 / 数据 / 台账三键的条数上限（本件自定，只报不截之外的护栏）。 */
export const MT_TEMPLATES_MAX = 200;
export const MT_LEDGER_MAX = 120;
export const MT_ROWS_PER_TABLE_MAX = 500;
export const MT_TEXT_MAX = 400000;

/* 收录失败因（数据层真源；接线层键面取这里，**不重列**）。 */
export const MT_INTAKE_WHYS = Object.freeze([
    'blank',            /* 什么都没贴 */
    'too_large',        /* 原文超上限（只报，不截） */
    'not_xml',          /* 贴进来的东西解不出任何 memory_update 结构 */
    'xml_broken',       /* XML 结构性损坏（标签不配平 / 引号不闭合 / 实体坏） */
    'no_updates',       /* 解出来了，但一条 memory_update 都没有 */
    'template_overflow' /* 模板库超上限（只报，不截） */
]);

/* 更新条逐条处置码（applyPlan 的每行结局；视图逐条画）。 */
export const MT_APPLY_CODES = Object.freeze([
    'set',          /* 收下：值改了 */
    'same',         /* 跳过：新旧值一样 */
    'blocked',      /* 拒收：字段锁定或 aiEditable=false */
    'kept',         /* 拒收：fill_empty 策略下旧值非空 */
    'unknown_template', /* 拒收：模板认不出 */
    'unknown_table',    /* 拒收：表认不出 */
    'unknown_field',    /* 拒收：字段认不出 */
    'unknown_row',      /* 拒收：行认不出（update/delete 给了不存在的 rowId） */
    'row_overflow',     /* 拒收：add 会超行上限 */
    'empty_add'         /* 拒收：add 行一个可收字段都没有 */
]);

/* ---------- 基础工具（纯函数，零依赖） ---------- */

export function isPlain(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
export function hasKey(obj, k) { return isPlain(obj) && Object.prototype.hasOwnProperty.call(obj, k); }
export function numOrNull(v) {
    const n = (typeof v === 'number') ? v : Number(v);
    return Number.isFinite(n) ? n : null;
}
export function listOf(v) { return Array.isArray(v) ? v : []; }
export function toStr(v) { return (typeof v === 'string') ? v : ''; }
export function clampNum(n, lo, hi) {
    let r = n;
    if (typeof lo === 'number' && Number.isFinite(lo)) r = Math.max(lo, r);
    if (typeof hi === 'number' && Number.isFinite(hi)) r = Math.min(hi, r);
    return r;
}
export function sameValue(a, b) {
    try { return JSON.stringify(a) === JSON.stringify(b); }
    catch (e) { return false; }
}
export function deepClone(v) {
    try { return JSON.parse(JSON.stringify(v)); }
    catch (e) { return null; }
}

/* 剪行表：只报不截的护栏之外的「最多留几条」，挤掉几条要报出来。 */
export function trimRows(list, cap) {
    const arr = listOf(list);
    const c = (typeof cap === 'number' && cap > 0) ? Math.floor(cap) : arr.length;
    if (arr.length <= c) return { rows: arr.slice(), dropped: 0 };
    return { rows: arr.slice(0, c), dropped: arr.length - c };
}

/* ---------- 归一：模板 / 表 / 字段（源 normalizeTemplate 一族） ---------- */

/* 字段类型归一：认不出归 text 并记 why（**不许**当没发生）。 */
export function fieldTypeOf(raw) {
    const s = toStr(raw).toLowerCase();
    for (let i = 0; i < MT_FIELD_TYPES.length; i++) {
        if (MT_FIELD_TYPES[i] === s) return { type: s, why: '' };
    }
    if (s === '') return { type: 'text', why: 'absent' };
    return { type: 'text', why: 'unknown_type' };
}

/* 类型缺省值（源 getDefaultValueByType）。 */
export function defaultByType(type) {
    if (type === 'number' || type === 'progress') return 0;
    if (type === 'boolean') return false;
    if (type === 'tags') return [];
    return '';
}

/* 字段值归一（源 normalizeFieldValue）：逐型来，改了形要报 note。 */
export function normalizeFieldValue(field, raw) {
    const f = isPlain(field) ? field : {};
    const t = fieldTypeOf(f.type).type;
    const out = { value: null, notes: [] };
    if (raw === undefined || raw === null) {
        out.value = defaultByType(t);
        out.notes.push('absent_to_default');
        return out;
    }
    if (t === 'number' || t === 'progress') {
        const n = numOrNull(raw);
        if (n === null) {
            out.value = (f.default !== undefined) ? normalizeFieldValue(f, f.default).value : defaultByType(t);
            out.notes.push('not_number');
            return out;
        }
        const clamped = clampNum(n, (typeof f.min === 'number' ? f.min : undefined), (typeof f.max === 'number' ? f.max : undefined));
        if (clamped !== n) out.notes.push('clamped');
        out.value = clamped;
        return out;
    }
    if (t === 'boolean') {
        if (typeof raw === 'boolean') { out.value = raw; return out; }
        const s = toStr(raw).trim().toLowerCase();
        const YES = ['true', '1', 'yes', '是', '开', '开启', 'on'];
        const NO = ['false', '0', 'no', '否', '关', '关闭', 'off'];
        for (let i = 0; i < YES.length; i++) if (YES[i] === s) { out.value = true; return out; }
        for (let j = 0; j < NO.length; j++) if (NO[j] === s) { out.value = false; return out; }
        out.value = false;
        out.notes.push('bool_guess');
        return out;
    }
    if (t === 'enum') {
        const v = toStr(raw).trim();
        const opts = listOf(f.options).map(function (o) { return toStr(o); });
        if (opts.length > 0 && opts.indexOf(v) < 0) {
            const dv = toStr(f.default);
            out.value = (dv !== '' && opts.indexOf(dv) >= 0) ? dv : opts[0];
            out.notes.push('fallback');
            return out;
        }
        out.value = v;
        return out;
    }
    if (t === 'tags') {
        if (Array.isArray(raw)) {
            out.value = raw.map(function (x) { return toStr(x).trim(); }).filter(Boolean);
            return out;
        }
        const parts = splitList(toStr(raw)).map(function (x) { return x.trim(); }).filter(Boolean);
        out.value = parts;
        if (toStr(raw).trim() !== '' && parts.length === 0) out.notes.push('tags_empty');
        return out;
    }
    if (t === 'date') { out.value = toStr(raw).trim(); return out; }
    out.value = toStr(raw);
    return out;
}

/* 字段缺省值（源 getFieldDefaultValue）。 */
export function fieldDefaultOf(field) {
    const f = isPlain(field) ? field : {};
    if (f.default !== undefined) return normalizeFieldValue(f, f.default).value;
    return defaultByType(fieldTypeOf(f.type).type);
}

/* 空值判定（源 isEmptyMemoryValue）：fill_empty 策略的门。 */
export function isEmptyValue(field, value) {
    const f = isPlain(field) ? field : {};
    const t = fieldTypeOf(f.type).type;
    const v = (value === undefined) ? fieldDefaultOf(f) : normalizeFieldValue(f, value).value;
    if (t === 'number' || t === 'progress') return v === 0 || v === '' || v === null;
    if (t === 'boolean') return v === false;
    if (t === 'tags') return !Array.isArray(v) || v.length === 0;
    return toStr(v).trim() === '';
}

/* 条件规则归一（源 normalizeConditionalRule + parseConditionalRulesText）。 */
export function normalizeRule(rule) {
    if (!isPlain(rule)) return null;
    return {
        op: toStr(rule.op) || '=',
        value: rule.value,
        color: toStr(rule.color)
    };
}
/* 字段归一（源 normalizeTemplate 里的 columns.map 段）。 */
export function normalizeField(raw, index) {
    const f = isPlain(raw) ? raw : {};
    const t = fieldTypeOf(f.type);
    const notes = [];
    if (t.why === 'unknown_type') notes.push('unknown_type');
    const out = {
        id: toStr(f.id) || ('memory_field_' + String(index + 1)),
        key: toStr(f.key).trim() || ('字段' + String(index + 1)),
        group: toStr(f.group).trim(),
        type: t.type,
        default: (f.default !== undefined) ? f.default : defaultByType(t.type),
        options: listOf(f.options).map(function (o) { return toStr(o); }),
        aiEditable: f.aiEditable !== false,
        aiHint: toStr(f.aiHint),
        displayFormat: toStr(f.displayFormat) || '{value}',
        conditionalRules: listOf(f.conditionalRules).map(normalizeRule).filter(Boolean)
    };
    if (typeof f.min === 'number') out.min = f.min;
    else if (t.type === 'progress') out.min = 0;
    if (typeof f.max === 'number') out.max = f.max;
    else if (t.type === 'progress') out.max = 100;
    return { field: out, notes: notes };
}

/* 表归一：两型之外归 keyValue 并记 note。 */
export function normalizeTable(raw, index) {
    const tb = isPlain(raw) ? raw : {};
    const notes = [];
    let mode = toStr(tb.mode);
    if (MT_TABLE_MODES.indexOf(mode) < 0) {
        if (mode !== '') notes.push('unknown_mode');
        mode = 'keyValue';
    }
    const cols = [];
    const rawCols = listOf(tb.columns);
    for (let i = 0; i < rawCols.length; i++) {
        const r = normalizeField(rawCols[i], i);
        cols.push(r.field);
        for (let k = 0; k < r.notes.length; k++) notes.push('field_' + String(i) + '_' + r.notes[k]);
    }
    if (cols.length === 0) {
        cols.push(normalizeField({ key: '字段1', type: 'text' }, 0).field);
        notes.push('no_columns');
    }
    return {
        table: {
            id: toStr(tb.id) || ('memory_table_' + String(index + 1)),
            name: toStr(tb.name).trim() || ('表格 ' + String(index + 1)),
            mode: mode,
            extractPrompt: toStr(tb.extractPrompt),
            columns: cols
        },
        notes: notes
    };
}

/* 模板归一（源 normalizeTemplate）：不是对象要报 why，不 throw。 */
export function normalizeTemplate(raw, index) {
    if (!isPlain(raw)) {
        return { template: null, notes: ['not_object'] };
    }
    const notes = [];
    const tables = [];
    const rawTables = listOf(raw.tables);
    for (let i = 0; i < rawTables.length; i++) {
        const r = normalizeTable(rawTables[i], i);
        tables.push(r.table);
        for (let k = 0; k < r.notes.length; k++) notes.push('table_' + String(i) + '_' + r.notes[k]);
    }
    if (tables.length === 0) notes.push('no_tables');
    return {
        template: {
            id: toStr(raw.id) || ('memory_tpl_' + String(index + 1)),
            name: toStr(raw.name).trim() || '未命名模板',
            description: toStr(raw.description),
            tables: tables
        },
        notes: notes
    };
}

/* 整库归一：贴进来的可以是一份数组或 {templates:[...]}，逐份来，坏的单列。 */
export function normalizeTemplateStore(raw) {
    const out = { templates: [], rejected: [], notes: [] };
    let arr = null;
    if (Array.isArray(raw)) arr = raw;
    else if (isPlain(raw) && Array.isArray(raw.templates)) arr = raw.templates;
    else {
        out.notes.push('store_shape');
        return out;
    }
    for (let i = 0; i < arr.length; i++) {
        const r = normalizeTemplate(arr[i], i);
        if (!r.template) {
            out.rejected.push({ index: i, why: 'not_object' });
            continue;
        }
        out.templates.push(r.template);
        for (let k = 0; k < r.notes.length; k++) out.notes.push('tpl_' + String(i) + '_' + r.notes[k]);
    }
    const cap = trimRows(out.templates, MT_TEMPLATES_MAX);
    out.templates = cap.rows;
    if (cap.dropped > 0) out.notes.push('template_overflow_' + String(cap.dropped));
    return out;
}

/* ---------- 行表（源 rows 一族） ---------- */

export function isRowsTable(table) {
    return !!table && table.mode === 'rows';
}

export function createEmptyRow(table, rowIndex) {
    const cells = {};
    const cols = listOf(table && table.columns);
    for (let i = 0; i < cols.length; i++) cells[cols[i].id] = fieldDefaultOf(cols[i]);
    return { id: 'memory_row_' + String(rowIndex + 1), cells: cells };
}

/* ---------- XML 解析（自写逐字符状态机；**不许**用 DOMParser） ----------
 * 只吃 ''<memory_updates><memory_update templateId=".." tableId="..">…</memory_update></memory_updates>''
 * 这一族结构；标签名与属性名只认 ASCII 字母数字下划线与连字符。
 * 坏结构**不许**整段丢：能解出的 update 照收，坏的按因逐条报。 */

/* 实体五个（XML 预定义）。数值实体也认。 */
function xmlUnescape(s) {
    const str = toStr(s);
    let out = '';
    let i = 0;
    while (i < str.length) {
        const c = str.charAt(i);
        if (c !== '&') { out += c; i++; continue; }
        const semi = str.indexOf(';', i);
        if (semi < 0) { out += c; i++; continue; }
        const body = str.slice(i + 1, semi);
        if (body === 'amp') { out += '&'; }
        else if (body === 'lt') { out += '<'; }
        else if (body === 'gt') { out += '>'; }
        else if (body === 'quot') { out += '"'; }
        else if (body === 'apos') { out += String.fromCharCode(39); }
        else if (body.charAt(0) === '#') {
            const hex = (body.charAt(1) === 'x' || body.charAt(1) === 'X');
            const n = parseInt(body.slice(hex ? 2 : 1), hex ? 16 : 10);
            if (Number.isFinite(n)) out += String.fromCodePoint(n);
            else { out += '&' + body + ';'; }
        } else {
            out += '&' + body + ';';
        }
        i = semi + 1;
    }
    return out;
}

/* 一个标签名合不合法。 */
function isNameChar(ch) {
    if (!ch) return false;
    const code = ch.charCodeAt(0);
    return (code >= 65 && code <= 90) || (code >= 97 && code <= 122) ||
           (code >= 48 && code <= 57) || ch === '_' || ch === '-' || ch === '.';
}

/* 解析一个开标签或自闭合标签的「名字 + 属性表」。
 * 入参是 ''<...>'' 内部（不含尖括号），返回 null 表示坏。 */
function parseTagInner(inner) {
    let i = 0;
    const n = inner.length;
    let selfClose = false;
    while (i < n && isNameChar(inner.charAt(i))) i++;
    if (i === 0) return null;
    const name = inner.slice(0, i);
    const attrs = {};
    while (i < n) {
        while (i < n && isWs(inner.charAt(i))) i++;
        if (i >= n) break;
        if (inner.charAt(i) === '/') {
            if (i === n - 1) { selfClose = true; i++; break; }
            return null;
        }
        let k = i;
        while (i < n && isNameChar(inner.charAt(i))) i++;
        if (i === k) return null;
        const attrName = inner.slice(k, i);
        while (i < n && isWs(inner.charAt(i))) i++;
        if (inner.charAt(i) !== '=') return null;
        i++;
        while (i < n && isWs(inner.charAt(i))) i++;
        const q = inner.charAt(i);
        if (q !== '"' && q !== String.fromCharCode(39)) return null;
        i++;
        const end = inner.indexOf(q, i);
        if (end < 0) return null;
        attrs[attrName] = xmlUnescape(inner.slice(i, end));
        i = end + 1;
    }
    return { name: name, attrs: attrs, selfClose: selfClose };
}

/* 把整段 XML 文本摊成一棵浅树：只认元素与文本，注释 / CDATA / 声明跳过。
 * 返回 { root, errors }；root 是 {name,attrs,children:[node|'#text'],text}
 * errors 是逐条 {pos, why} —— 坏的地方记一笔，但**能继续就继续**。 */
export function parseXml(rawText) {
    const src = toStr(rawText);
    const errors = [];
    const root = { name: '#root', attrs: {}, children: [] };
    const stack = [root];
    let i = 0;
    const n = src.length;
    function top() { return stack[stack.length - 1]; }
    function pushText(text) {
        if (!text) return;
        const t = xmlUnescape(text);
        if (t.trim() === '') return;
        const node = { name: '#text', text: t };
        top().children.push(node);
    }
    while (i < n) {
        const lt = src.indexOf('<', i);
        if (lt < 0) { pushText(src.slice(i)); break; }
        pushText(src.slice(i, lt));
        /* 注释 <!-- --> */
        if (src.slice(lt, lt + 4) === '<!--') {
            const end = src.indexOf('-->', lt + 4);
            if (end < 0) { errors.push({ pos: lt, why: 'comment_unclosed' }); break; }
            i = end + 3;
            continue;
        }
        /* CDATA <![CDATA[ ]]> */
        if (src.slice(lt, lt + 9) === '<![CDATA[') {
            const end = src.indexOf(']]>', lt + 9);
            if (end < 0) { errors.push({ pos: lt, why: 'cdata_unclosed' }); break; }
            const t = src.slice(lt + 9, end);
            if (t.trim() !== '') top().children.push({ name: '#text', text: t });
            i = end + 3;
            continue;
        }
        /* 声明 <? ?> 或 <!DOCTYPE> */
        if (src.charAt(lt + 1) === '?' || src.charAt(lt + 1) === '!') {
            const end = src.indexOf('>', lt + 1);
            if (end < 0) { errors.push({ pos: lt, why: 'decl_unclosed' }); break; }
            i = end + 1;
            continue;
        }
        const gt = src.indexOf('>', lt + 1);
        if (gt < 0) { errors.push({ pos: lt, why: 'tag_unclosed' }); break; }
        const inner = src.slice(lt + 1, gt);
        /* 闭标签 </name> */
        if (inner.charAt(0) === '/') {
            const name = inner.slice(1).trim();
            if (stack.length <= 1) {
                errors.push({ pos: lt, why: 'stray_close_' + name });
            } else if (top().name !== name) {
                errors.push({ pos: lt, why: 'mismatch_open_' + top().name + '_close_' + name });
                /* 宽容：弹到匹配处 */
                let k = stack.length - 1;
                while (k > 0 && stack[k].name !== name) k--;
                if (k > 0) stack.length = k;
            } else {
                stack.pop();
            }
            i = gt + 1;
            continue;
        }
        const tag = parseTagInner(inner);
        if (!tag) {
            errors.push({ pos: lt, why: 'tag_bad' });
            i = gt + 1;
            continue;
        }
        const node = { name: tag.name, attrs: tag.attrs, children: [] };
        top().children.push(node);
        if (!tag.selfClose) stack.push(node);
        i = gt + 1;
    }
    if (stack.length > 1) {
        errors.push({ pos: n, why: 'unclosed_' + top().name });
    }
    return { root: root, errors: errors };
}

/* 取一个元素下的直接文本（拼所有 #text 子节点）。 */
export function textOf(node) {
    if (!node || !Array.isArray(node.children)) return '';
    let out = '';
    for (let i = 0; i < node.children.length; i++) {
        const c = node.children[i];
        if (c && c.name === '#text') out += c.text;
    }
    return out.trim();
}
/* 取一个元素下叫 name 的直接子元素列表。 */
export function childrenNamed(node, name) {
    const out = [];
    if (!node || !Array.isArray(node.children)) return out;
    for (let i = 0; i < node.children.length; i++) {
        const c = node.children[i];
        if (c && c.name === name) out.push(c);
    }
    return out;
}

/* ---------- 更新包归一：从 XML 树到「逐条更新计划」 ----------
 * 这是源 applyMemoryUpdatesFromXml 的**读数化**：不就地改库，
 * 只把「打算改什么」摊成逐条计划（哪模板 / 哪表 / 哪字段或哪行 /
 * op / 旧值 / 新值 / 收或不收 / 为什么）。 */

/* 在模板库里找模板 / 表 / 字段。找不到回 null，**不许**硬塞。 */
export function findTemplate(store, templateId) {
    const arr = listOf(store);
    for (let i = 0; i < arr.length; i++) if (arr[i] && arr[i].id === templateId) return arr[i];
    return null;
}
export function findTable(template, tableId) {
    const arr = listOf(template && template.tables);
    for (let i = 0; i < arr.length; i++) if (arr[i] && arr[i].id === tableId) return arr[i];
    return null;
}
export function findField(table, fieldId) {
    const arr = listOf(table && table.columns);
    for (let i = 0; i < arr.length; i++) if (arr[i] && arr[i].id === fieldId) return arr[i];
    return null;
}
export function findRow(rows, rowId) {
    const arr = listOf(rows);
    for (let i = 0; i < arr.length; i++) if (arr[i] && arr[i].id === rowId) return arr[i];
    return null;
}

/* 把一个 <memory_update> 节点摊成计划条。
 * data 是当前库里这一模板的现存数据（{tableId: {fieldId:value} 或 {tableId:{__rows:[...]}}}）；
 * locked 是锁定表（{tableId: [fieldId,...]}）；
 * strategy 取 MT_STRATEGIES 之一。 */
export function planFromUpdateNode(template, updateNode, data, locked, strategy) {
    const plans = [];
    const tableId = toStr(updateNode && updateNode.attrs && updateNode.attrs.tableId);
    const table = findTable(template, tableId);
    if (!table) {
        plans.push({ code: 'unknown_table', templateId: template.id, tableId: tableId });
        return plans;
    }
    const strat = MT_STRATEGIES.indexOf(strategy) >= 0 ? strategy : 'overwrite';
    const tableData = isPlain(data) ? data[tableId] : undefined;
    const lockList = listOf(isPlain(locked) ? locked[tableId] : []);

    function gateField(field, oldValue) {
        if (!field) return 'unknown_field';
        if (field.aiEditable === false) return 'blocked';
        if (lockList.indexOf(field.id) >= 0) return 'blocked';
        if (strat === 'fill_empty' && !isEmptyValue(field, oldValue)) return 'kept';
        return '';
    }

    if (isRowsTable(table)) {
        const rows = Array.isArray(tableData && tableData.__rows) ? tableData.__rows : [];
        const rowNodes = childrenNamed(updateNode, 'row');
        for (let i = 0; i < rowNodes.length; i++) {
            const rn = rowNodes[i];
            const op = toStr(rn.attrs && rn.attrs.op).trim().toLowerCase() || 'update';
            const rowId = toStr(rn.attrs && rn.attrs.rowId);
            if (op === 'delete') {
                const row = rowId ? findRow(rows, rowId) : null;
                if (!row) { plans.push({ code: 'unknown_row', templateId: template.id, tableId: tableId, rowId: rowId, op: op }); continue; }
                const cols = listOf(table.columns);
                for (let c = 0; c < cols.length; c++) {
                    plans.push({ code: 'set', op: op, templateId: template.id, tableId: tableId, rowId: rowId, fieldId: cols[c].id, oldValue: row.cells[cols[c].id], newValue: '' });
                }
                continue;
            }
            const fieldNodes = childrenNamed(rn, 'field');
            if (op === 'add') {
                if (rows.length >= MT_ROWS_PER_TABLE_MAX) {
                    plans.push({ code: 'row_overflow', templateId: template.id, tableId: tableId, op: op });
                    continue;
                }
                const fresh = createEmptyRow(table, rows.length);
                let touched = 0;
                for (let fi = 0; fi < fieldNodes.length; fi++) {
                    const fn = fieldNodes[fi];
                    const fieldId = toStr(fn.attrs && fn.attrs.fieldId);
                    const field = findField(table, fieldId);
                    const g = gateField(field, fresh.cells[fieldId]);
                    if (g) { plans.push({ code: g, op: op, templateId: template.id, tableId: tableId, fieldId: fieldId }); continue; }
                    const nv = normalizeFieldValue(field, textOf(fn));
                    fresh.cells[field.id] = nv.value;
                    touched++;
                    plans.push({ code: 'set', op: op, templateId: template.id, tableId: tableId, rowId: fresh.id, fieldId: field.id, oldValue: '', newValue: nv.value, notes: nv.notes });
                }
                if (touched === 0) plans.push({ code: 'empty_add', templateId: template.id, tableId: tableId, op: op });
                continue;
            }
            /* update（缺省） */
            const row = rowId ? findRow(rows, rowId) : null;
            if (!row) { plans.push({ code: 'unknown_row', templateId: template.id, tableId: tableId, rowId: rowId, op: op }); continue; }
            for (let fi = 0; fi < fieldNodes.length; fi++) {
                const fn = fieldNodes[fi];
                const fieldId = toStr(fn.attrs && fn.attrs.fieldId);
                const field = findField(table, fieldId);
                const oldValue = row.cells[fieldId];
                const g = gateField(field, oldValue);
                if (g) { plans.push({ code: g, op: op, templateId: template.id, tableId: tableId, rowId: rowId, fieldId: fieldId, oldValue: oldValue }); continue; }
                const nv = normalizeFieldValue(field, textOf(fn));
                if (sameValue(oldValue, nv.value)) { plans.push({ code: 'same', op: op, templateId: template.id, tableId: tableId, rowId: rowId, fieldId: fieldId, oldValue: oldValue, newValue: nv.value }); continue; }
                plans.push({ code: 'set', op: op, templateId: template.id, tableId: tableId, rowId: rowId, fieldId: fieldId, oldValue: oldValue, newValue: nv.value, notes: nv.notes });
            }
        }
        return plans;
    }

    /* keyValue 表 */
    const kv = isPlain(tableData) ? tableData : {};
    const fieldNodes = childrenNamed(updateNode, 'field');
    for (let fi = 0; fi < fieldNodes.length; fi++) {
        const fn = fieldNodes[fi];
        const fieldId = toStr(fn.attrs && fn.attrs.fieldId);
        const field = findField(table, fieldId);
        const oldValue = hasKey(kv, fieldId) ? kv[fieldId] : (field ? fieldDefaultOf(field) : undefined);
        const g = gateField(field, oldValue);
        if (g) { plans.push({ code: g, templateId: template.id, tableId: tableId, fieldId: fieldId, oldValue: oldValue }); continue; }
        const nv = normalizeFieldValue(field, textOf(fn));
        if (sameValue(oldValue, nv.value)) { plans.push({ code: 'same', templateId: template.id, tableId: tableId, fieldId: fieldId, oldValue: oldValue, newValue: nv.value }); continue; }
        plans.push({ code: 'set', templateId: template.id, tableId: tableId, fieldId: fieldId, oldValue: oldValue, newValue: nv.value, notes: nv.notes });
    }
    return plans;
}

/* 把整段 XML 文本摊成整份计划（含解析期坏条与认不出的模板）。 */
export function planFromXml(rawText, store, dataByTemplate, lockedByTemplate, strategy) {
    const out = { plans: [], errors: [], updateCount: 0, intakeWhy: '' };
    const text = toStr(rawText);
    if (text.trim() === '') { out.intakeWhy = MT_INTAKE_WHYS[0]; return out; }
    if (text.length > MT_TEXT_MAX) { out.intakeWhy = MT_INTAKE_WHYS[1]; return out; }
    const parsed = parseXml(text);
    for (let e = 0; e < parsed.errors.length; e++) out.errors.push(parsed.errors[e]);
    /* 找 memory_updates 容器（可以包一层也可以直接是根下一串）。 */
    let containers = childrenNamed(parsed.root, 'memory_updates');
    if (containers.length === 0) containers = [parsed.root];
    let updates = [];
    for (let c = 0; c < containers.length; c++) {
        const us = childrenNamed(containers[c], 'memory_update');
        for (let u = 0; u < us.length; u++) updates.push(us[u]);
    }
    out.updateCount = updates.length;
    if (updates.length === 0) {
        out.intakeWhy = (parsed.errors.length > 0) ? MT_INTAKE_WHYS[3] : MT_INTAKE_WHYS[4];
        return out;
    }
    /* 坏结构 + 好更新共存：好条照收进计划（解析不整段丢），但整包仍标坏 ——
     * face 走 malformed、落库门拦住，用户修好包再落，不许半包坏档悄悄落进库。 */
    if (parsed.errors.length > 0) out.intakeWhy = MT_INTAKE_WHYS[3];
    for (let u = 0; u < updates.length; u++) {
        const un = updates[u];
        const templateId = toStr(un.attrs && un.attrs.templateId);
        const template = findTemplate(store, templateId);
        if (!template) {
            out.plans.push({ code: 'unknown_template', templateId: templateId });
            continue;
        }
        const data = isPlain(dataByTemplate) ? dataByTemplate[templateId] : undefined;
        const locked = isPlain(lockedByTemplate) ? lockedByTemplate[templateId] : undefined;
        const ps = planFromUpdateNode(template, un, data, locked, strategy);
        for (let p = 0; p < ps.length; p++) out.plans.push(ps[p]);
    }
    return out;
}

/* 把计划真的落进一份数据（返回新数据，不改入参）。
 * 只落 code==='set' 的条；返回 {data, changed}。 */
export function applyPlan(store, dataByTemplate, planResult) {
    const data = deepClone(isPlain(dataByTemplate) ? dataByTemplate : {}) || {};
    const plans = listOf(planResult && planResult.plans);
    const changed = [];
    for (let i = 0; i < plans.length; i++) {
        const p = plans[i];
        if (!p || p.code !== 'set') continue;
        const template = findTemplate(store, p.templateId);
        const table = template ? findTable(template, p.tableId) : null;
        if (!template || !table) continue;
        if (!isPlain(data[p.templateId])) data[p.templateId] = {};
        const bucket = data[p.templateId];
        if (isRowsTable(table)) {
            if (!isPlain(bucket[p.tableId]) || !Array.isArray(bucket[p.tableId].__rows)) {
                bucket[p.tableId] = { __rows: [] };
            }
            const rows = bucket[p.tableId].__rows;
            if (p.op === 'add') {
                const row = findRow(rows, p.rowId);
                if (row) row.cells[p.fieldId] = p.newValue;
                else {
                    const fresh = createEmptyRow(table, rows.length);
                    fresh.id = p.rowId;
                    fresh.cells[p.fieldId] = p.newValue;
                    rows.push(fresh);
                }
            } else if (p.op === 'delete') {
                const idx = rows.findIndex(function (r) { return r && r.id === p.rowId; });
                if (idx >= 0) rows.splice(idx, 1);
            } else {
                const row = findRow(rows, p.rowId);
                if (row) row.cells[p.fieldId] = p.newValue;
            }
        } else {
            if (!isPlain(bucket[p.tableId])) bucket[p.tableId] = {};
            bucket[p.tableId][p.fieldId] = p.newValue;
        }
        changed.push(p);
    }
    return { data: data, changed: changed };
}

/* ---------- 显示值（源 getFieldDisplayValue 一族的读数化） ---------- */
export function displayValue(field, value) {
    const f = isPlain(field) ? field : {};
    const t = fieldTypeOf(f.type).type;
    const v = (value === undefined) ? fieldDefaultOf(f) : value;
    if (v === undefined || v === null || v === '') return '';
    if (t === 'tags' && Array.isArray(v)) return v.join('、');
    if (t === 'boolean') return v ? '是' : '否';
    if (t === 'progress') {
        const n = numOrNull(v);
        return (n === null) ? '' : String(n);
    }
    if (Array.isArray(v)) return v.join(', ');
    return String(v);
}

/* ---------- 历史序列（源 getFieldHistorySeries 的读数化） ---------- */
export function fieldHistorySeries(history, templateId, tableId, fieldId, currentValue) {
    const entries = listOf(history).slice().reverse();
    const out = [];
    for (let i = 0; i < entries.length; i++) {
        const snap = entries[i] && entries[i].snapshot;
        const v = isPlain(snap) && isPlain(snap[templateId]) && isPlain(snap[templateId][tableId])
            ? snap[templateId][tableId][fieldId] : undefined;
        if (typeof v === 'number' && Number.isFinite(v)) out.push(v);
    }
    if (typeof currentValue === 'number' && Number.isFinite(currentValue)) out.push(currentValue);
    return out.slice(-MT_SERIES_MAX);
}

/* ---------- 历史台账（源 pushMemoryHistory 的读数化） ---------- */
export function pushHistory(history, snapshot, changedFields, source, atMs) {
    const list = listOf(history).slice();
    const fields = listOf(changedFields);
    if (fields.length === 0) return { history: list, dropped: 0, entry: null };
    const entry = {
        id: 'memory_history_' + String(atMs || 0) + '_' + String(list.length),
        timestamp: (typeof atMs === 'number' && atMs > 0) ? atMs : 0,
        source: toStr(source) || 'manual',
        snapshot: deepClone(snapshot) || {},
        changedCount: fields.length
    };
    list.unshift(entry);
    let dropped = 0;
    if (list.length > MT_HISTORY_LIMIT) {
        dropped = list.length - MT_HISTORY_LIMIT;
        list.length = MT_HISTORY_LIMIT;
    }
    return { history: list, dropped: dropped, entry: entry };
}

/* ---------- 模板定义文本（源 buildTemplateDefinitionForPrompt 的读数化） ----------
 * 本件**不拼提示词**：只把「这份模板长什么样、现在填到哪」
 * 归一成一段可复制文本，用户自己拿到任何对话端去用。 */
export function templateDefinitionText(store, dataByTemplate, lockedByTemplate) {
    const templates = listOf(store);
    const chunks = [];
    for (let i = 0; i < templates.length; i++) {
        const t = templates[i];
        if (!t) continue;
        const lines = [];
        lines.push('模板ID=' + t.id + ' 名称=' + t.name);
        if (t.description) lines.push('描述=' + t.description);
        const tables = listOf(t.tables);
        const tData = isPlain(dataByTemplate) ? dataByTemplate[t.id] : undefined;
        const tLocked = isPlain(lockedByTemplate) ? lockedByTemplate[t.id] : undefined;
        for (let k = 0; k < tables.length; k++) {
            const tb = tables[k];
            lines.push('  表格ID=' + tb.id + ' 名称=' + tb.name + ' 模式=' + (isRowsTable(tb) ? 'rows' : 'keyValue'));
            if (tb.extractPrompt) lines.push('  表格提取规则=' + tb.extractPrompt);
            const cols = listOf(tb.columns);
            const lockList = listOf(isPlain(tLocked) ? tLocked[tb.id] : []);
            const tbData = isPlain(tData) ? tData[tb.id] : undefined;
            for (let c = 0; c < cols.length; c++) {
                const f = cols[c];
                const locked = lockList.indexOf(f.id) >= 0;
                let current = '';
                if (isRowsTable(tb)) {
                    current = '见现有行';
                } else {
                    const v = isPlain(tbData) && hasKey(tbData, f.id) ? tbData[f.id] : fieldDefaultOf(f);
                    current = displayValue(f, v) || '空';
                }
                let line = '    字段ID=' + f.id + ' 字段名=' + f.key;
                if (f.group) line += ' 分组=' + f.group;
                line += ' 类型=' + f.type;
                if (f.options && f.options.length) line += ' 可选值=' + f.options.join('|');
                if (typeof f.min === 'number' || typeof f.max === 'number') {
                    line += ' 范围=' + (typeof f.min === 'number' ? String(f.min) : '') + '~' + (typeof f.max === 'number' ? String(f.max) : '');
                }
                line += ' 当前值=' + current + ' 锁定=' + (locked ? '是' : '否');
                lines.push(line);
            }
            if (isRowsTable(tb)) {
                const rows = (isPlain(tbData) && Array.isArray(tbData.__rows)) ? tbData.__rows : [];
                if (rows.length === 0) {
                    lines.push('  现有行=空');
                } else {
                    for (let r = 0; r < rows.length; r++) {
                        const cells = cols.map(function (f) {
                            return f.key + '=' + (displayValue(f, rows[r].cells[f.id]) || '空');
                        }).join(' ');
                        lines.push('  行ID=' + rows[r].id + ' 行号=' + String(r + 1) + ' ' + cells);
                    }
                }
            }
        }
        chunks.push(lines.join(String.fromCharCode(10)));
    }
    return chunks.join(String.fromCharCode(10) + String.fromCharCode(10));
}

/* ---------- 自动更新游标读数（源 getMemoryTableAutoUpdateCursorInfo 的读数化） ---------- */
export function autoUpdateCursorReadings(messageCount, cursorIndex, intervalRaw) {
    const total = (typeof messageCount === 'number' && messageCount >= 0) ? Math.floor(messageCount) : 0;
    const interval = Math.max(10, (typeof intervalRaw === 'number' && Number.isFinite(intervalRaw)) ? Math.floor(intervalRaw) : 100);
    const cursor = (typeof cursorIndex === 'number' && cursorIndex >= -1) ? Math.floor(cursorIndex) : -1;
    const nextStart = cursor + 1;
    const unsynced = Math.max(0, total - nextStart);
    const batches = Math.floor(unsynced / interval);
    return {
        interval: interval,
        cursorIndex: cursor,
        nextStartIndex: nextStart,
        unsyncedCount: unsynced,
        completedBatchCount: batches
    };
}

/* ---------- 读数面（本件的「我现在到底有多少东西」） ---------- */
export function readingsOf(store, dataByTemplate, lockedByTemplate, history) {
    const templates = listOf(store);
    let tableCount = 0;
    let fieldCount = 0;
    let rowsTableCount = 0;
    let rowCount = 0;
    let lockedCount = 0;
    const typeCounter = {};
    for (let i = 0; i < MT_FIELD_TYPES.length; i++) typeCounter[MT_FIELD_TYPES[i]] = 0;
    for (let i = 0; i < templates.length; i++) {
        const t = templates[i];
        const tables = listOf(t && t.tables);
        tableCount += tables.length;
        const tData = isPlain(dataByTemplate) ? dataByTemplate[t.id] : undefined;
        const tLocked = isPlain(lockedByTemplate) ? lockedByTemplate[t.id] : undefined;
        for (let k = 0; k < tables.length; k++) {
            const tb = tables[k];
            const cols = listOf(tb.columns);
            fieldCount += cols.length;
            for (let c = 0; c < cols.length; c++) {
                const ty = fieldTypeOf(cols[c].type).type;
                typeCounter[ty] = (typeCounter[ty] || 0) + 1;
            }
            if (isRowsTable(tb)) {
                rowsTableCount++;
                const tbData = isPlain(tData) ? tData[tb.id] : undefined;
                if (isPlain(tbData) && Array.isArray(tbData.__rows)) rowCount += tbData.__rows.length;
            }
            const lockList = listOf(isPlain(tLocked) ? tLocked[tb.id] : []);
            lockedCount += lockList.length;
        }
    }
    return {
        templates: templates.length,
        tables: tableCount,
        fields: fieldCount,
        rowsTables: rowsTableCount,
        rows: rowCount,
        locked: lockedCount,
        history: listOf(history).length,
        historyCap: MT_HISTORY_LIMIT,
        types: typeCounter
    };
}

/* 判定四态（本件收 XML 这扇门）。 */
export const MT_FACES = Object.freeze(['ok', 'empty', 'malformed', 'absent']);
export function faceOf(raw, planResult) {
    if (raw === undefined || raw === null) return 'absent';
    if (toStr(raw).trim() === '') return 'empty';
    const why = planResult && planResult.intakeWhy;
    if (why && why !== '') return 'malformed';
    return 'ok';
}

/* 上限读数（与仓内各件同形：余量 null 与 0 不同形）。 */
export function limitsOf(store, history) {
    const t = listOf(store).length;
    const h = listOf(history).length;
    return {
        templatesLeft: MT_TEMPLATES_MAX - t,
        historyLeft: MT_HISTORY_LIMIT - h,
        templatesCap: MT_TEMPLATES_MAX,
        rowsCap: MT_ROWS_PER_TABLE_MAX,
        textCap: MT_TEXT_MAX,
        seriesCap: MT_SERIES_MAX,
        contextCap: MT_CONTEXT_MESSAGES_MAX
    };
}

/* 导出面收口（本仓门禁：导出即消费）。 */
export function caps() {
    return {
        rowOps: MT_ROW_OPS,
        templates: MT_TEMPLATES_MAX,
        ledger: MT_LEDGER_MAX,
        rowsPerTable: MT_ROWS_PER_TABLE_MAX,
        text: MT_TEXT_MAX,
        series: MT_SERIES_MAX,
        context: MT_CONTEXT_MESSAGES_MAX,
        history: MT_HISTORY_LIMIT
    };
}
