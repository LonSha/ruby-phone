#!/usr/bin/env node
/* ============================================================
 * tests/audit/scan_bare_clocks.mjs —— 裸钟调用点提取与分类（R22-O5）
 * ------------------------------------------------------------
 * 【它解决什么】
 *   `apps/wechat/chat-view.js` 里有大量裸 `Date.now()`。计划要求逐处标成
 *   story（内容时间轴，必须走统一剧情钟出口）或 wall（渲染节奏，可保留 + 白名单写明理由）。
 *   此前只有「83」这一个总数，没有「哪 83 处、各是哪档」的机器读数 —— 于是这项永远无法验收。
 *
 * 【分类器唯一实现不在本文件】
 *   分类规则在 `config/story-clock-classify.js`（纯函数，v4.157.0 已交付）。
 *   本文件只做**提取与取证**，调那个桥来分类。不复制规则，避免两套判据。
 *
 * 【取证口径（写清楚，免得以后拿它当挡箭牌）】
 *   - 每个站点记：行号、该行原文、字段名（`timestamp: Date.now()` 的 timestamp）、
 *     所在函数名（向前找最近的 function / 方法开口，尽力而为）、近邻上下文关键词。
 *   - `unknown` 不是「没问题」，是「机器判不了，要人来判」。台账里不许把它算进已完成。
 *
 * 用法：
 *   node tests/audit/scan_bare_clocks.mjs --write         # 重写 tests/audit/bare_clock_ledger.json
 *   node tests/audit/scan_bare_clocks.mjs                 # 只打印汇总
 *   node tests/audit/scan_bare_clocks.mjs --json          # 机读
 *   node tests/audit/scan_bare_clocks.mjs --check         # 有 unknown 未裁决 或 有 story 未收口 → exit 1
 * 退出码：0=可接受 1=有未收口 2=拒判
 * ============================================================ */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifyClockSite, classifySummary } from '../../config/story-clock-classify.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const TARGET = 'apps/wechat/chat-view.js';
const LEDGER = 'tests/audit/bare_clock_ledger.json';
const WHITELIST = 'tests/audit/bare_clock_whitelist.json';

const argv = process.argv.slice(2);
const JSON_MODE = argv.includes('--json');
const WRITE = argv.includes('--write');
const CHECK = argv.includes('--check');

const abs = path.join(ROOT, TARGET);
if (!fs.existsSync(abs)) {
    if (JSON_MODE) console.log(JSON.stringify({ ok: false, reason: 'missing target' }));
    else console.log(`[bare-clock] 拒判：找不到 ${TARGET}`);
    process.exit(2);
}

const src = fs.readFileSync(abs, 'utf8');
const lines = src.split('\n');

const WALL_HINTS = ['debounce', 'throttle', 'raf', 'interval', 'timeout', 'anim', 'scroll', 'render'];
const KEY_RE = /([A-Za-z_$][\w$]*)\s*:\s*Date\.now\(\)/;
const CALL_RE = /Date\.now\(\)/g;

/** 向前找最近的函数/方法开口，尽力而为。 */
function enclosingFn(idx) {
    for (let i = idx; i >= 0; i--) {
        const l = lines[i];
        let m = l.match(/\b(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/);
        if (m) return m[1];
        m = l.match(/^\s*(?:async\s+)?([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{\s*$/);
        if (m && m[1] !== 'if' && m[1] !== 'for' && m[1] !== 'while' && m[1] !== 'switch' && m[1] !== 'catch') return m[1];
    }
    return '(top-level)';
}

const sites = [];
for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.includes('Date.now()')) continue;
    CALL_RE.lastIndex = 0;
    let m;
    while ((m = CALL_RE.exec(line)) !== null) {
        const col = m.index;
        const keyMatch = line.match(KEY_RE);
        const field = keyMatch ? keyMatch[1] : '';
        const ctx = lines.slice(Math.max(0, i - 2), Math.min(lines.length, i + 3)).join(' ');
        const near = WALL_HINTS.filter((h) => ctx.toLowerCase().indexOf(h) >= 0).join(',');
        const verdict = classifyClockSite({ field, context: near });
        sites.push({
            line: i + 1,
            col: col + 1,
            field: field || '(inline)',
            fn: enclosingFn(i),
            near: near || '',
            cls: verdict.cls,
            reason: verdict.reason,
            text: line.trim().slice(0, 160)
        });
    }
}

const summary = classifySummary(sites.map((s) => ({ field: s.field === '(inline)' ? '' : s.field, context: s.near })));

/* 白名单：wall 档必须逐条有理由才算出账；story 档必须已改走统一剧情钟出口。
 * 收口判据用「该行是否出现 storyNow/wallNow」判断，不是靠人声称。 */
let whitelist = { schema: 'bare-clock-whitelist@1', wall: [], note: '' };
if (fs.existsSync(path.join(ROOT, WHITELIST))) {
    try { whitelist = JSON.parse(fs.readFileSync(path.join(ROOT, WHITELIST), 'utf8')); } catch { /* 保持空 */ }
}
/* 人工裁决层：分类器判不了（unknown）的站点，由人逐条判进 wall / story，并把理由落盘。
 * 保留 autoCls 字段：台账必须能看出「机器原来怎么判、人改成什么」，否则人工裁决会变成第二个黑箱。 */
const wallByLine = new Map((whitelist.wall || []).map((w) => [w.line, w.why]));
const storyByLine = new Map((whitelist.story || []).map((w) => [w.line, w.why]));
for (const s of sites) {
    s.autoCls = s.cls;
    if (storyByLine.has(s.line)) { s.cls = 'story'; s.via = 'human'; s.humanWhy = storyByLine.get(s.line); }
    else if (wallByLine.has(s.line)) { s.cls = 'wall'; s.via = 'human'; s.humanWhy = wallByLine.get(s.line); }
    else s.via = 'classifier';
}
const recount = { story: 0, wall: 0, unknown: 0 };
for (const s of sites) recount[s.cls]++;
const effSummary = { face: 'classified', counts: recount, total: sites.length };

for (const s of sites) {
    const k = `${s.line}:${s.col}`;
    s.whitelistedWhy = s.cls === 'wall' ? (s.humanWhy || '分类器判 wall') : '';
    s.routed = /storyNow|wallNow/.test(s.text);
    if (s.cls === 'wall' && !s.whitelistedWhy) s.needs = 'wall-whitelist';
    else if (s.cls === 'story' && !s.routed) s.needs = 'story-route';
    else if (s.cls === 'unknown') s.needs = 'human-triage';
    else s.needs = '';
}

const ledger = {
    schema: 'bare-clock-ledger@1',
    generatedFrom: TARGET,
    total: sites.length,
    counts: effSummary.counts,
    pending: {
        wallWithoutReason: sites.filter((s) => s.needs === 'wall-whitelist').length,
        storyNotRouted: sites.filter((s) => s.needs === 'story-route').length,
        unknown: sites.filter((s) => s.needs === 'human-triage').length
    },
    sites
};

if (WRITE) fs.writeFileSync(path.join(ROOT, LEDGER), JSON.stringify(ledger, null, 2) + '\n');

if (JSON_MODE) console.log(JSON.stringify(ledger, null, 2));
else {
    console.log(`[bare-clock] ${TARGET} 共 ${ledger.total} 处裸钟`);
    console.log(`[bare-clock] 分类：story ${effSummary.counts.story} / wall ${effSummary.counts.wall} / unknown ${effSummary.counts.unknown}`);
    console.log(`[bare-clock] 待收口：story 未走统一出口 ${ledger.pending.storyNotRouted} · wall 无白名单理由 ${ledger.pending.wallWithoutReason} · 需人判 ${ledger.pending.unknown}`);
    if (WRITE) console.log(`[bare-clock] 台账已写：${LEDGER}`);
}

if (CHECK) {
    const bad = ledger.pending.storyNotRouted + ledger.pending.wallWithoutReason + ledger.pending.unknown;
    process.exit(bad > 0 ? 1 : 0);
}
process.exit(0);