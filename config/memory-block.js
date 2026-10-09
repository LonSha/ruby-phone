/* ========================================================
 *  RubyPhone · 结构化记忆块解析（A3）
 * ========================================================
 *
 * 【为什么有这个模块】
 *   现有记忆**全靠被动记**：`onMessageReceived` 把正文丢进桶里，靠后续检索捞回来。
 *   于是「我和你共同经历的事」这类**需要主动声明**的东西，从来没被声明过 ——
 *   它只是恰好躺在某条消息的某句话里，检索到了算运气好。
 *
 *   结构化块把这件事反过来：让模型在回复里用一个带标记的块，**明确地**说
 *   「这是我要记的」。解析器负责从正文里把这个块摘出来。
 *
 * 【为什么自己写而不用现成解析】
 *   上游 CMCC 的 cmcc 块有一份可抄的实现，但它绑了三样本仓没有的东西：
 *   MVU 变量树、TH 的运行时段、以及它自己的容错顺序。抄过来就等于把它的
 *   依赖也搬进来。本模块只保留**形状**（标记块 + 双格式），实现重写。
 *
 * 【双格式（必须都认，且要能判开）】
 *   ① JSON 形：   ```memo\n{"items":[{"kind":"event","text":"…"}]}\n```
 *   ② 行式形：   ```memo\nevent | 城西的老槐树下避雨\npromise | 答应周一带她去看海\n```
 *   两者的**答案不同形**（一个是结构，一个是行），若压成一种输出，
 *   「模型给的是哪种格式」这件事就再也读不出来 —— 而那正是排查
 *   「为什么这块没被记下」的第一个问题。
 *
 * 【四类容错（顺序即优先级，不可调换）】
 *   ① 标记块缺失 ⇒ 返回 `present:false`，**不是**「解析失败」：
 *      绝大多数回复里本来就没有这个块，把它报成失败会让诊断页永远在响。
 *   ② 块在但为空 ⇒ `present:true, empty:true`，与 ① 分开。
 *   ③ JSON 坏 ⇒ 先试**符号修复**（本仓已有 config/json-symbol-repair.js 的范式：
 *      全角引号 / 尾逗号 / 单引号），修不好再降级去试行式，行式也不成才报
 *      `malformed`（带原文片段，供人肉眼判）。
 *   ④ 行式坏行 ⇒ **只丢坏行，保留好行**，并把坏行原样放进 `badLines`。
 *      整块丢弃是错的：模型写对了三行、写坏一行，那三行是真信息。
 *
 * 【安全（这不是可选项）】
 *   解析出的文本会被写进世界书 / 记忆桶，故：
 *   · 单条长度上限 `MAX_ITEM_CHARS`（超长即截断并记 `truncated`）；
 *   · 单次条数上限 `MAX_ITEMS`（超出即丢并记 `dropped`）；
 *   · `kind` 白名单外的一律落 `other` 但**保留原文**（不静默改名）。
 *   三条都必须可观测 —— 静默截断是本仓点名过的错读数形态。
 * ============================================================ */

/** 标记块：```memo / ```cmcc / ```记忆 三种写法都认（用户手写时不会记得我用了哪个）。 */
const FENCE_RE = /```(?:memo|cmcc|记忆|memory)([^\n]*)\n([\s\S]*?)```/g;

export const MAX_ITEMS = 40;
export const MAX_ITEM_CHARS = 300;

/** kind 白名单。白名单外的**不丢**，落 `other` 并保留 `rawKind` —— 静默改名会让
 *  「模型发明了一个新类别」这件事永远浮现不出来。 */
export const MEMORY_KINDS = Object.freeze(['event', 'promise', 'fact', 'relation', 'preference', 'other']);

function clip(text, limit) {
    const s = String(text ?? '').trim();
    if (s.length <= limit) return { text: s, truncated: false };
    return { text: s.slice(0, limit), truncated: true };
}

/** 符号修复：JSON 里最常见的三种坏法（本仓 config/json-symbol-repair.js 的同族口径，
 *  此处内联最小实现 —— 依赖那个模块会把它的导出面全拖进来，而我们只要三个替换）。 */
export function repairSymbols(text) {
    let s = String(text ?? '');
    s = s.replace(/[\u201c\u201d]/g, '"').replace(/[\u2018\u2019]/g, "'");
    s = s.replace(/,\s*([}\]])/g, '$1');          // 尾逗号
    s = s.replace(/([{,]\s*)'([^']*)'(\s*:)/g, '$1"$2"$3');  // 单引号键
    s = s.replace(/:\s*'([^']*)'(\s*[,}])/g, ': "$1"$2');   // 单引号值
    return s;
}

/** 单条归一：把任意形状的一条变成 `{kind, text, rawKind?, truncated?}`，或 null（空条）。 */
function normalizeItem(raw) {
    if (raw === null || raw === undefined) return null;
    let kind = 'other';
    let text = '';
    let rawKind = null;
    if (typeof raw === 'string') {
        text = raw;
    } else if (typeof raw === 'object') {
        rawKind = String(raw.kind ?? raw.type ?? raw.category ?? '').trim().toLowerCase();
        kind = MEMORY_KINDS.includes(rawKind) ? rawKind : 'other';
        text = String(raw.text ?? raw.content ?? raw.value ?? raw.note ?? '');
    } else {
        text = String(raw);
    }
    if (!text.trim()) return null;
    const clipped = clip(text, MAX_ITEM_CHARS);
    const out = { kind: kind, text: clipped.text };
    if (rawKind && kind === 'other' && rawKind !== 'other') out.rawKind = rawKind;
    if (clipped.truncated) out.truncated = true;
    return out;
}

/** 行式一行：`kind | text`（分隔符认 | 与 ｜；无分隔符的行按 other 处理，不丢）。 */
function parseLine(line) {
    const s = String(line ?? '').trim();
    if (!s || s.startsWith('#') || s.startsWith('//')) return null;
    const m = /^([A-Za-z\u4e00-\u9fff_]+)\s*[|｜]\s*(.+)$/.exec(s);
    if (!m) return normalizeItem(s);
    return normalizeItem({ kind: m[1], text: m[2] });
}

/**
 * 解析正文里的记忆块。
 *
 * @param {string} text 模型回复原文（或任意文本）
 * @param {{source?:string}} options
 * @returns {{present:boolean, empty:boolean, format:'json'|'lines'|null, items:Array,
 *            badLines:string[], malformed:boolean, raw:string, notes:string[]}}
 */
export function parseMemoryBlock(text, options = {}) {
    const src = String(text ?? '');
    const notes = [];
    const out = {
        present: false, empty: false, format: null, items: [], badLines: [],
        malformed: false, raw: '', notes: notes
    };
    FENCE_RE.lastIndex = 0;
    const m = FENCE_RE.exec(src);
    if (!m) {
        /* ① 没有块 —— 这是**正常**情况，不是失败。 */
        notes.push('正文无结构化记忆块（正常：并非每条回复都需要记）');
        return out;
    }
    out.present = true;
    out.raw = String(m[2] ?? '');
    const body = out.raw.trim();
    if (!body) {
        out.empty = true;
        notes.push('块在场但为空');
        return out;
    }

    /* ② 先按 JSON 试（剥掉可能的语言标注行），坏则符号修复后再试。 */
    let json = null;
    const tryJson = (candidate) => {
        try { return JSON.parse(candidate); } catch (_e) { return null; }
    };
    const stripped = body.replace(/^[a-z]+\s*\n/i, (mm) => (/\{|\[/.test(body) ? '' : mm));
    json = tryJson(body) || tryJson(stripped) || tryJson(repairSymbols(body)) || tryJson(repairSymbols(stripped));
    if (json !== null) {
        out.format = 'json';
        const list = Array.isArray(json) ? json : (Array.isArray(json.items) ? json.items
            : (Array.isArray(json.memories) ? json.memories : [json]));
        for (const raw of list) {
            const item = normalizeItem(raw);
            if (item) out.items.push(item);
            if (out.items.length >= MAX_ITEMS) { notes.push('条数超上限 ' + MAX_ITEMS + '，其余丢弃'); break; }
        }
        if (!out.items.length) { out.empty = true; notes.push('JSON 解析成功但没得到可用的条'); }
        return out;
    }

    /* ③ 降级行式：坏行只丢它自己。 */
    out.format = 'lines';
    for (const line of body.split('\n')) {
        if (out.items.length >= MAX_ITEMS) { notes.push('条数超上限 ' + MAX_ITEMS + '，其余丢弃'); break; }
        const item = parseLine(line);
        if (item) out.items.push(item);
        else if (String(line).trim()) out.badLines.push(String(line));
    }
    if (!out.items.length) {
        out.malformed = true;
        notes.push('JSON 与行式都没解析出条（原文片段：' + body.slice(0, 80).replace(/\n/g, ' ') + '）');
    } else if (out.badLines.length) {
        notes.push('行式解析：丢弃坏行 ' + out.badLines.length + ' 条，保留好行 ' + out.items.length + ' 条');
    }
    return out;
}

/** 一行读数。present / empty / malformed 三态分列。 */
export function memoryBlockLine(result) {
    if (!result || typeof result !== 'object') return '记忆块：无读数';
    if (!result.present) return '记忆块：本回复无';
    if (result.empty) return '记忆块：在场但为空';
    if (result.malformed) return '记忆块：解析失败（原文片段见 notes）';
    const counts = {};
    for (const it of result.items) counts[it.kind] = (counts[it.kind] || 0) + 1;
    return '记忆块：' + result.format + ' · ' + result.items.length + ' 条（'
        + Object.keys(counts).map((k) => k + ':' + counts[k]).join(' ') + '）'
        + (result.badLines.length ? ' · 坏行 ' + result.badLines.length : '');
}

export default { MEMORY_KINDS, MAX_ITEMS, MAX_ITEM_CHARS, repairSymbols, parseMemoryBlock, memoryBlockLine };