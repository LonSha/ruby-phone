#!/usr/bin/env node
/* ============================================================
 * tests/audit/scan_bare_clocks.mjs —— 裸钟调用点提取与分类（R22-O5）
 * ------------------------------------------------------------
 * 【它解决什么】
 *   `apps/wechat/chat-view.js` 里有大量裸 `Date.now()`。计划要求逐处标成
 *   story（内容时间轴，必须走统一剧情钟出口）或 wall（渲染节奏，可保留 + 白名单写明理由）。
 *   此前只有「83」这一个总数，没有「哪 83 处、各是哪档」的机器读数 —— 于是这项永远无法验收。
 *
 * 【为什么从 R22-O2 起是「多文件」】
 *   R22-O2 把 showVideoCallInterface / showVoiceCallInterface 逐字节搬到了
 *   `apps/wechat/chat-call-core.js`，其中 8 处墙钟跟着搬走。探针若仍只扫 chat-view.js，
 *   这 8 处就变成「台账里有、源码里没有」的幽灵，或者更糟：从台账里悄悄消失、没人发现覆盖率掉了。
 *   所以 TARGETS 是**文件清单**，每个站点都带 `file`，白名单按 `file:line` 对账。
 *
 * 【分类器唯一实现不在本文件】
 *   分类规则在 `config/story-clock-classify.js`（纯函数，v4.157.0 已交付）。
 *   本文件只做**提取与取证**，调那个桥来分类。不复制规则，避免两套判据。
 *
 * 【取证口径（写清楚，免得以后拿它当挡箭牌）】
 *   - 每个站点记：文件、行号、该行原文、字段名（`timestamp: Date.now()` 的 timestamp）、
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

/** 扫描清单（顺序即输出顺序）。第一个是主文件：白名单里没写 file 的条目默认指它。 */
const TARGETS = ['apps/wechat/chat-view.js', 'apps/wechat/chat-call-core.js'];
const LEDGER = 'tests/audit/bare_clock_ledger.json';
const WHITELIST = 'tests/audit/bare_clock_whitelist.json';

const argv = process.argv.slice(2);
const JSON_MODE = argv.includes('--json');
const WRITE = argv.includes('--write');
const CHECK = argv.includes('--check');

const WALL_HINTS = ['debounce', 'throttle', 'raf', 'interval', 'timeout', 'anim', 'scroll', 'render'];
const KEY_RE = /([A-Za-z_$][\w$]*)\s*:\s*Date\.now\(\)/;
const CALL_RE = /Date\.now\(\)/g;

const missing = TARGETS.filter((rel) => !fs.existsSync(path.join(ROOT, rel)));
if (missing.length) {
    if (JSON_MODE) console.log(JSON.stringify({ ok: false, reason: 'missing target', missing }));
    else console.log(`[bare-clock] 拒判：找不到 ${missing.join(', ')}`);
    process.exit(2);
}

/** 向前找最近的函数/方法开口，尽力而为。 */
function enclosingFn(lines, idx) {
    for (let i = idx; i >= 0; i--) {
        const l = lines[i];
        let m = l.match(/\b(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/);
        if (m) return m[1];
        m = l.match(/^\s*(?:async\s+)?([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{\s*$/);
        if (m && m[1] !== 'if' && m[1] !== 'for' && m[1] !== 'while' && m[1] !== 'switch' && m[1] !== 'catch') return m[1];
    }
    return '(top-level)';
}

/** 扫一个文件，返回站点数组（每站点带 file）。 */
function scanFile(rel) {
    const lines = fs.readFileSync(path.join(ROOT, rel), 'utf8').split('\n');
    const out = [];
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
            out.push({
                file: rel,
                line: i + 1,
                col: col + 1,
                field: field || '(inline)',
                fn: enclosingFn(lines, i),
                near: near || '',
                cls: verdict.cls,
                reason: verdict.reason,
                text: line.trim().slice(0, 160)
            });
        }
    }
    return out;
}

const sites = TARGETS.flatMap((rel) => scanFile(rel));

const summary = classifySummary(sites.map((s) => ({ field: s.field === '(inline)' ? '' : s.field, context: s.near })));

/* 白名单：wall 档必须逐条有理由才算出账；story 档必须已改走统一剧情钟出口。
 * 收口判据用「该行是否出现 storyNow/wallNow」判断，不是靠人声称。
 * 对账键是 `file:line`；条目没写 file 时视为 TARGETS[0]（兼容 R22-O2 之前的条目）。 */
let whitelist = { schema: 'bare-clock-whitelist@1', wall: [], note: '' };
if (fs.existsSync(path.join(ROOT, WHITELIST))) {
    try { whitelist = JSON.parse(fs.readFileSync(path.join(ROOT, WHITELIST), 'utf8')); } catch { /* 保持空 */ }
}
const wlFile = (w) => w.file || TARGETS[0];
const key = (file, line) => file + ':' + line;
/* 人工裁决层：分类器判不了（unknown）的站点，由人逐条判进 wall / story，并把理由落盘。
 * 保留 autoCls 字段：台账必须能看出「机器原来怎么判、人改成什么」，否则人工裁决会变成第二个黑箱。 */
const wallByKey = new Map((whitelist.wall || []).map((w) => [key(wlFile(w), w.line), w.why]));
const storyByKey = new Map((whitelist.story || []).map((w) => [key(wlFile(w), w.line), w.why]));
for (const s of sites) {
    const k = key(s.file, s.line);
    s.autoCls = s.cls;
    if (storyByKey.has(k)) { s.cls = 'story'; s.via = 'human'; s.humanWhy = storyByKey.get(k); }
    else if (wallByKey.has(k)) { s.cls = 'wall'; s.via = 'human'; s.humanWhy = wallByKey.get(k); }
    else s.via = 'classifier';
}
const recount = { story: 0, wall: 0, unknown: 0 };
for (const s of sites) recount[s.cls]++;
const effSummary = { face: 'classified', counts: recount, total: sites.length };

for (const s of sites) {
    s.whitelistedWhy = s.cls === 'wall' ? (s.humanWhy || '分类器判 wall') : '';
    s.routed = /storyNow|wallNow/.test(s.text);
    if (s.cls === 'wall' && !s.whitelistedWhy) s.needs = 'wall-whitelist';
    else if (s.cls === 'story' && !s.routed) s.needs = 'story-route';
    else if (s.cls === 'unknown') s.needs = 'human-triage';
    else s.needs = '';
}

const byFile = {};
for (const s of sites) byFile[s.file] = (byFile[s.file] || 0) + 1;

const ledger = {
    schema: 'bare-clock-ledger@1',
    generatedFrom: TARGETS,
    total: sites.length,
    byFile,
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
    const perFile = Object.entries(byFile).map(([f, n]) => f.split('/').pop() + ' ' + n).join(' · ');
    console.log(`[bare-clock] ${TARGETS.join(' + ')} 共 ${ledger.total} 处裸钟（${perFile}）`);
    console.log(`[bare-clock] 分类：story ${effSummary.counts.story} / wall ${effSummary.counts.wall} / unknown ${effSummary.counts.unknown}`);
    console.log(`[bare-clock] 待收口：story 未走统一出口 ${ledger.pending.storyNotRouted} · wall 无白名单理由 ${ledger.pending.wallWithoutReason} · 需人判 ${ledger.pending.unknown}`);
    if (WRITE) console.log(`[bare-clock] 台账已写：${LEDGER}`);
}

if (CHECK) {
    const bad = ledger.pending.storyNotRouted + ledger.pending.wallWithoutReason + ledger.pending.unknown;
    process.exit(bad > 0 ? 1 : 0);
}
process.exit(0);