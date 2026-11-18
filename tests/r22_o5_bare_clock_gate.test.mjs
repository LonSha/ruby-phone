// R22-O5 裸钟收口门（判据本体）
// 它不重新实现分类规则，只读「唯一桥」+ 台账，并证自己会红。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifyClockSite, classifySummary, clockClassifySelfCheck } from '../config/story-clock-classify.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const LEDGER = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests/audit/bare_clock_ledger.json'), 'utf8'));
const WL = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests/audit/bare_clock_whitelist.json'), 'utf8'));
const SRC = fs.readFileSync(path.join(ROOT, 'apps/wechat/chat-view.js'), 'utf8');
/* R22-O2 起台账跨文件：两个通话方法搬到 chat-call-core.js，8 处墙钟跟着走。
 * 所以按站点自己的 file 取源码；文件读不到直接抛（fail-closed），不许拿 chat-view.js 顶上。 */
const SRC_BY_FILE = {};
for (const rel of new Set(LEDGER.sites.map((s) => s.file))) {
    SRC_BY_FILE[rel] = fs.readFileSync(path.join(ROOT, rel), 'utf8').split('\n');
}
const wlFile = (w) => w.file || 'apps/wechat/chat-view.js';

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) { pass++; console.log("✓ " + n); } else { fail++; console.log("✗ " + n); } };

// 1. 分类桥自检（规则只有一份，在 config/story-clock-classify.js）
const sc = clockClassifySelfCheck();
ok("分类桥自检通过", sc.ok);

// 2. 负控制：门真的会红 —— 分类器对无信号站点必须给 unknown
ok("负控制：无信号站点判 unknown", classifyClockSite({ field: "mystery" }).cls === "unknown");
const sum = classifySummary([{ field: "storyAt" }, { context: "scroll" }, { field: "?" }]);
ok("负控制：汇总能把三档分开数", sum.counts.story === 1 && sum.counts.wall === 1 && sum.counts.unknown === 1);

// 3. 台账三零：没有未裁决、没有未收口的 story、没有无理由的 wall
ok("台账：需人判 = 0", LEDGER.pending.unknown === 0);
ok("台账：story 未收口 = 0", LEDGER.pending.storyNotRouted === 0);
ok("台账：wall 无理由 = 0", LEDGER.pending.wallWithoutReason === 0);
/* [R25-O2 更新] 71 → 73：O2 接线给 chat-view.js 添了 2 处墙钟（滚动位置记账的「此刻」与
 * 120ms 节流判定）。它们是**新增**的裸钟，不是收口又开口 —— 所以总数改了，但必须写清楚来源，
 * 并让白名单真的登记这两处（否则下面 4 的多重集对账会红）。 */
ok("台账：剩余裸钟 73 处（83 → 71 → O2 新增 2 = 73）", LEDGER.total === 73);
ok("台账：剩余全为 wall", LEDGER.counts.wall === 73 && LEDGER.counts.story === 0);

// 4. 白名单逐条带理由（理由为空等于没登记）
const noWhy = (WL.wall || []).filter((w) => !w.why || !String(w.why).trim());
ok("白名单每条都有理由", (WL.wall || []).length > 0 && noWhy.length === 0);
/* 对账键从 `file:line` 改成 `文件|行原文|函数`（R25-O2）。为什么必须改：
 * 行号会随搬迁/接线整体平移，白名单只能靠人肉反推；而且旧条目靠「同一行登记 N 条」凑重复语义
 * （例如 5 条「点击抑制窗口」挤在 8358 那一行），一平移计数就和真实站点对不上。
 * 改键不是放水：变成多重集比对（同一 key 登记 N 条才够盖 N 个站点），
 * 把同一行代码复制进新函数会多出一个站点、白名单盖不住 → 照样红（见 4b 负控制）。 */
const normText = (x) => String(x || "").replace(/\s+/g, " ").trim();
const wlKey = (x) => wlFile(x) + "|" + normText(x.text) + "|" + String(x.fn || "");
function coverDiff(rows, wlRows) {
    const count = (arr) => { const m = new Map(); for (const x of arr) m.set(wlKey(x), (m.get(wlKey(x)) || 0) + 1); return m; };
    const L = count(rows), W = count(wlRows);
    const missing = [], extra = [];
    for (const [k, v] of L) { const got = W.get(k) || 0; if (got < v) missing.push({ key: k, need: v, got }); }
    for (const [k, v] of W) { const need = L.get(k) || 0; if (v > need) extra.push({ key: k, have: v, need }); }
    return { missing, extra, ok: missing.length === 0 && extra.length === 0 };
}
const wallRows = LEDGER.sites.filter((s) => s.cls === "wall");
const cover = coverDiff(wallRows, WL.wall || []);
ok("白名单覆盖台账每一个 wall 站点（文件|行原文|函数 多重集对账）", cover.ok);
// 4b. 负控制：伪造一处未登记的 wall 站点，对账必须红（否则这条判据是死的）
const fakeRow = { ...wallRows[0], text: wallRows[0].text + " /* 未登记 */" };
const fakeCover = coverDiff(wallRows.concat([fakeRow]), WL.wall || []);
ok("负控制：多出未登记 wall 站点时对账转红", !fakeCover.ok && fakeCover.missing.length === 1);
// 4c. 理由必须来自白名单，不许分类器自封（R25-O2 收紧：此前 pending.wallWithoutReason 可恒为 0）
ok("台账：每个 wall 站点都有人登记（via=human，不是分类器自封）", wallRows.every((s) => s.via === "human"));
// 4d. 白名单死条目：登记了却对不上源码，一律不许静默丢弃
ok("白名单无死条目（pending.whitelistStale = 0 且明细为空）", LEDGER.pending.whitelistStale === 0 && (LEDGER.staleWhitelist || []).length === 0);

// 5. 12 处 story 真的走了统一出口（不是靠文档声称）
// 12 处由本项改入，另 2 处是 v21 就有的（合计 14）。不是恰好 12 —— 写清楚，别用总数冒充本期交付量。
/* [R25-O1 第一刀后订正] 14 处里 2 处随 _parseIncomingCallMarker / _parseManualTimeAdvanceCommand
 * 搬进 apps/wechat/chat-text-core.js。判据要的仍是「这一处走的是同一个统一出口」，
 * 所以按文件分别钉死：view 12 + core 2 = 14。只把总数改成 12 才是放水。 */
const SRC_TEXT_CORE = fs.readFileSync(path.join(ROOT, 'apps/wechat/chat-text-core.js'), 'utf8');
const routedView = (SRC.match(/storyNowWallFallback\(window\)\.ms/g) || []).length;
const routedCore = (SRC_TEXT_CORE.match(/storyNowWallFallback\(window\)\.ms/g) || []).length;
ok("统一钟出口 14 处（chat-view 12 + chat-text-core 2；本期 12 + 既有 2 的结构未变）", routedView === 12 && routedCore === 2);

// 6. 台账与源码对得上：每个 wall 行号在源码里真的还有 Date.now()
const wallSites = LEDGER.sites.filter((s) => s.cls === "wall");
const stale = wallSites.filter((s) => {
    const lines = SRC_BY_FILE[s.file];
    return !lines || !lines[s.line - 1] || !lines[s.line - 1].includes("Date.now()");
});
ok("台账行号未过期（无幽灵站点，按站点自己的 file 校验）", stale.length === 0);

// 6b. 覆盖率不许静默缩水：跨文件读数必须自洽，且两个文件都得真被覆盖
const byFile = {};
for (const s of LEDGER.sites) byFile[s.file] = (byFile[s.file] || 0) + 1;
const sumByFile = Object.values(byFile).reduce((a, b) => a + b, 0);
ok("台账：跨文件读数自洽（byFile 相加 = total）", sumByFile === LEDGER.total && JSON.stringify(byFile) === JSON.stringify(LEDGER.byFile));
/* R23-O2 起第三把伞：bindEvents 体内两段（含各 1 处 450ms 防抖时间戳）搬到 chat-input-bind.js，
 * 所以 chat-view.js 63 → 61、新文件 2；**总数不变仍是 71** —— 切片只搬钟，不生产钟也不消钟。 */
/* [R25-O2] chat-view 61 → 63：多出的 2 处就是 O2 接线的记账/节流钟（见上面 total 段的说明）。 */
ok("台账：覆盖 chat-view.js / chat-call-core.js / chat-input-bind.js（63 + 8 + 2）", byFile["apps/wechat/chat-view.js"] === 63 && byFile["apps/wechat/chat-call-core.js"] === 8 && byFile["apps/wechat/chat-input-bind.js"] === 2);

console.log(pass + " 通过, " + fail + " 失败");
process.exit(fail > 0 ? 1 : 0);