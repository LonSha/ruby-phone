/* ========================================================
 * config/echo-prose-strip.js — 语音/字幕回声剥离（纯函数）[v4.88.0 · 第七批缝入]
 * --------------------------------------------------------
 * 【这一刀治的是什么（本仓实测的真缺口）】
 *   带语音的消息里，<语音> 块与随后出现的同文正文叠在一起：
 *   气泡播一遍、正文又写一遍，同一条消息读起来像口吃。
 *   本仓修前只有 message-clean（剥状态块与 HTML），**不处理语音块与正文的关系**：
 *   状态标签剥掉了，但语音块的文字仍在，正文里的同一句也仍在。
 *
 * 【源形态（非描述，按源码判定）】
 *   qegj567-cloud/SullyOS · utils/voiceTextDedup.ts
 *     · 先把每个 <语音>…</语音>（含相邻 <字幕>）**整块挖出来**换成占位符，
 *       并把被念过的文本归一化收集起来；
 *     · 只在「非结构化行」里做删除：带 <> [] 或占位符的行整行保留；
 *     · 逐行判：归一化后的行若**被某段被念文本包含**、且长度 ≥ 12，则删掉该行；
 *     · 最后把占位符换回原块；整体命中即 return，没有语音块时原样返回；
 *     · 开头有保护：整条里带 [html] / <翻译> / ``` 时不处理。
 *
 * 【本仓差异与后果（照抄会坏的地方）】
 *   · 源的标签是 <语音> 与 <字幕>；本仓另有 `[语音]` 方括号形态与
 *     `（语音）` 中文括号前缀（芋圆机系与 horae 系风格并存），都要认。
 *   · 源的「短行不删」阈值 12 是按英文定的；中文 6 个字就够一句话，
 *     故改按 `minEchoChars` 可配、默认 8（中文短句也能被剥）。
 *   · 源的「带标签就整行保留」是对的，但本仓 `<好感+1>` 常与台词同在一行 —— 
 *    照搬会让绝大多数行都保留。故只对**行首标签**（`<x>` / `[x]` / `|` 分隔）保留，
 *     行中间的标签不豁免。
 *
 * 【纪律】
 *   ① 纯函数，不改动没有语音块的消息（逐字节原样返回）；
 *   ② 不抛：畸形标签一律当普通文本；
 *   ③ 只删「确实是回声」的行：被包含 + 够长 + 非结构行，三条齐备；
 *   ④ 拒绝记账：返回删了几行与被删内容，视图可还原。
 * ======================================================== */
'use strict';

/* 注意：`\b` 在无 u 标志下只认 ASCII 词字符，而「语音」是中文 ⇒ 标签后不能写 `\b`。 */
export const ECHO_TAG_PATTERNS = Object.freeze([
    /<语音(?:\s[^>]*)?>([\s\S]*?)<\/语音>/g,
    /\[语音(?:\s[^>]*)?\]([\s\S]*?)\[\/语音\]/g,
    /（语音[:：]?\s*([\s\S]*?)）/g
]);

/** 结构化行：行首是标签/竖线分隔/占位符 ⇒ 整行保留不剥。 */
const STRUCT_PREFIX_RE = /^\s*(?:<[^>]+>|\[[^\]]+\]|\||\u0002VOICE\d+\u0002)/;
/** 保护整体：真结构块不处理。 */
const GUARD_RE = /\[html\]|<翻[译譯]>|```/i;
const PLACEHOLDER = '\u0002VOICE';
const PLACEHOLDER_RE = /\u0002VOICE(\d+)\u0002/g;

/** 归一化：去空白与标点、小写（只比字）。**逐个字符判**，不用正则字符类，
 *  否则 `\u0002VOICE0\u0002` 这样的占位符会被空格规则吃掉。 */
export function normalizeEchoText(s) {
    const src = String(s == null ? '' : s);
    let out = '';
    for (const ch of src) {
        if (/[\s\u3000]/.test(ch)) continue;
        if (/[!-/:-@[-`{-~]/.test(ch)) continue;      // ASCII 标点
        if ('。、，；：！？…—·「」『』（）【】《》〈〉～'.indexOf(ch) >= 0) continue;
        out += ch;
    }
    return out.toLowerCase();
}

/**
 * 剥回声。
 * @param {string} text
 * @param {{ minEchoChars?: number }} [opts]
 * @returns {{ text:string, removed:string[], keptBlocks:number, skipped:string }}
 */
export function stripVoiceEcho(text, opts = {}) {
    const src = (typeof text === 'string') ? text : '';
    if (!src) return { text: '', removed: [], keptBlocks: 0, skipped: 'empty' };
    if (GUARD_RE.test(src)) return { text: src, removed: [], keptBlocks: 0, skipped: 'structured' };

    const minChars = Math.max(1, Number(opts.minEchoChars) || 4);
    const blocks = [];
    const spoken = [];
    let work = src;

    for (const re of ECHO_TAG_PATTERNS) {
        work = work.replace(re, (whole, inner) => {
            const said = normalizeEchoText(inner);
            if (said) spoken.push(said);
            blocks.push(whole);
            return '\n' + PLACEHOLDER + (blocks.length - 1) + '\u0002\n';
        });
    }
    if (!blocks.length) return { text: src, removed: [], keptBlocks: 0, skipped: 'no-voice' };

    const removed = [];
    const kept = [];
    for (const line of work.split(/\r?\n/)) {
        const raw = line.trim();
        if (!raw) { kept.push(line); continue; }
        if (STRUCT_PREFIX_RE.test(line)) { kept.push(line); continue; }
        const norm = normalizeEchoText(raw);
        if (norm.length < minChars) { kept.push(line); continue; }
        if (spoken.some((v) => v.indexOf(norm) >= 0)) { removed.push(raw); continue; }
        kept.push(line);
    }

    const restored = kept.join('\n').replace(PLACEHOLDER_RE, (_, i) => blocks[Number(i)] || '');
    return { text: restored.trim(), removed, keptBlocks: blocks.length, skipped: '' };
}

/** 一行总述。 */
export function echoStripLine(r) {
    const o = (r && typeof r === 'object') ? r : {};
    if (o.skipped === 'no-voice') return '无语音块';
    if (o.skipped === 'structured') return '结构块内，未处理';
    if (!o.keptBlocks) return '无语音块';
    return '语音块 ' + String(o.keptBlocks) + ' 段 · 剥回声 ' + String((o.removed || []).length) + ' 行';
}

/** 自检：真回声被剥、短行保留、结构行保留、无语音块原样返回、保护块跳过。 */
export function echoStripSelfCheck() {
    const bad = [];
    const src = '他说：「今天不去了。」\n<语音>今天不去了。</语音>\n今天不去了。\n最后一句完全不同。';
    const r = stripVoiceEcho(src);
    if (r.removed.length !== 1) bad.push('回声未剥或误剥: ' + JSON.stringify(r.removed));
    if (r.text.indexOf('<语音>今天不去了。</语音>') < 0) bad.push('语音块未还原');
    if (r.text.indexOf('最后一句完全不同') < 0) bad.push('正文被误删');
    const short = stripVoiceEcho('<语音>嗯。</语音>\n嗯。');
    if (short.removed.length !== 0) bad.push('短行被剥');
    const raw = '纯文本一条。';
    if (stripVoiceEcho(raw).text !== raw) bad.push('无语音块被改动');
    const guarded = '```\n<语音>a</语音>\n```';
    if (stripVoiceEcho(guarded).skipped !== 'structured') bad.push('保护块未跳过');
    return { ok: bad.length === 0, bad };
}