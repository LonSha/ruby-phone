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
 *   所以 TARGETS 是**文件清单**，每个站点都带 `file`。
 *
 * 【白名单对账键（R25-O2 改）】
 *   R22 起用 `file:line`。行号会随搬迁/接线整体平移，白名单只能靠人肉反推，
 *   而且旧条目靠「同一行重复登记 N 条」凑重复语义 —— 一平移就对不上账。
 *   现在键是 `file|行原文|所在函数`，按**多重集**比对（同一 key 登记 N 条才够盖 N 个站点），
 *   行号不参与对账。好处是平移免疫；代价是同一行代码被复制到新函数里时会计数不足 → 判未登记（这正是要的）。
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
 *   node tests/audit/scan_bare_clocks.mjs --check         # unknown 未裁决 / story 未收口 / 白名单死条目 → exit 1
 * 退出码：0=可接受 1=有未收口 2=拒判
 * ============================================================ */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifyClockSite, classifySummary } from '../../config/story-clock-classify.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');

/** 扫描清单（顺序即输出顺序）。第一个是主文件：白名单里没写 file 的条目默认指它。 */
const TARGETS = ['apps/wechat/chat-view.js', 'apps/wechat/chat-call-core.js', 'apps/wechat/chat-input-bind.js'];
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
 * 对账键：`file|行原文|所在函数`，多重集（R25-O2 起；行号不参与，理由见文件头与白名单 note）。
 * 条目没写 file 时视为 TARGETS[0]（兼容 R22-O2 之前的条目）。 */
let whitelist = { schema: 'bare-clock-whitelist@2', wall: [], note: '' };
if (fs.existsSync(path.join(ROOT, WHITELIST))) {
    try { whitelist = JSON.parse(fs.readFileSync(path.join(ROOT, WHITELIST), 'utf8')); } catch { /* 保持空 */ }
}
const wlFile = (w) => w.file || TARGETS[0];
const normText = (s) => String(s || '').replace(/\s+/g, ' ').trim();
const key = (file, text, fn) => wlFile({ file }) + '|' + normText(text) + '|' + String(fn || '');
/* 白名单死条目：登记了却对不上任何源码站点。不许静默丢掉 —— 那就是「以为登记了，其实早就没了」。 */
const staleWl = [];
function makePool(list) {
    const pool = new Map();
    for (const w of list || []) {
        if (!w.text) { staleWl.push({ file: wlFile(w), why: w.why || '', stale: 'legacy-no-text' }); continue; }
        const k = key(wlFile(w), w.text, w.fn);
        if (!pool.has(k)) pool.set(k, []);
        pool.get(k).push(w);
    }
    return {
        take(k) { const b = pool.get(k); return b && b.length ? b.shift() : null; },
        leftovers() {
            const out = [];
            for (const arr of pool.values()) for (const w of arr) out.push({ file: wlFile(w), text: w.text, fn: w.fn, why: w.why || '', stale: 'no-site' });
            return out;
        }
    };
}
/* 人工裁决层：分类器判不了（unknown）的站点，由人逐条判进 wall / story，并把理由落盘。
 * 保留 autoCls 字段：台账必须能看出「机器原来怎么判、人改成什么」，否则人工裁决会变成第二个黑箱。 */
const wallPool = makePool(whitelist.wall);
const storyPool = makePool(whitelist.story);
for (const s of sites) {
    const k = key(s.file, s.text, s.fn);
    s.autoCls = s.cls;
    const hitStory = storyPool.take(k);
    const hitWall = hitStory ? null : wallPool.take(k);
    if (hitStory) { s.cls = 'story'; s.via = 'human'; s.humanWhy = hitStory.why; }
    else if (hitWall) { s.cls = 'wall'; s.via = 'human'; s.humanWhy = hitWall.why; }
    else s.via = 'classifier';
}
staleWl.push(...wallPool.leftovers(), ...storyPool.leftovers());
const recount = { story: 0, wall: 0, unknown: 0 };
for (const s of sites) recount[s.cls]++;
const effSummary = { face: 'classified', counts: recount, total: sites.length };

for (const s of sites) {
    /* R25-O2 收紧：以前这里回退成「分类器判 wall」，于是「分类器自己判 wall 的站点」
     * 即使白名单里根本没登记，也会显示成有理由 —— 台账 pending.wallWithoutReason 因此能恒为 0。
     * 现在理由只能来自人登记；分类器给的只是 autoCls，不再冒充理由。 */
    s.whitelistedWhy = s.cls === 'wall' ? (s.humanWhy || '') : '';
    s.routed = /storyNow|wallNow/.test(s.text);
    if (s.cls === 'wall' && s.via !== 'human') s.needs = 'wall-whitelist';
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
        unknown: sites.filter((s) => s.needs === 'human-triage').length,
        whitelistStale: staleWl.length
    },
    /* 白名单死条目明细（正常为空数组）：登记在案、源码里已找不到对应站点的条目不静默丢弃。 */
    staleWhitelist: staleWl,
    sites
};

if (WRITE) fs.writeFileSync(path.join(ROOT, LEDGER), JSON.stringify(ledger, null, 2) + '\n');

if (JSON_MODE) console.log(JSON.stringify(ledger, null, 2));
else {
    const perFile = Object.entries(byFile).map(([f, n]) => f.split('/').pop() + ' ' + n).join(' · ');
    console.log(`[bare-clock] ${TARGETS.join(' + ')} 共 ${ledger.total} 处裸钟（${perFile}）`);
    console.log(`[bare-clock] 分类：story ${effSummary.counts.story} / wall ${effSummary.counts.wall} / unknown ${effSummary.counts.unknown}`);
    console.log(`[bare-clock] 待收口：story 未走统一出口 ${ledger.pending.storyNotRouted} · wall 无白名单理由 ${ledger.pending.wallWithoutReason} · 需人判 ${ledger.pending.unknown} · 白名单死条目 ${ledger.pending.whitelistStale}`);
    if (WRITE) console.log(`[bare-clock] 台账已写：${LEDGER}`);
}

if (CHECK) {
    const bad = ledger.pending.storyNotRouted + ledger.pending.wallWithoutReason + ledger.pending.unknown + ledger.pending.whitelistStale;
    process.exit(bad > 0 ? 1 : 0);
}
process.exit(0);