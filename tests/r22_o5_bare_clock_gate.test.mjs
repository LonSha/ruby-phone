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
ok("台账：剩余裸钟 71 处（83 → 71，12 处已收口）", LEDGER.total === 71);
ok("台账：剩余全为 wall", LEDGER.counts.wall === 71 && LEDGER.counts.story === 0);

// 4. 白名单逐条带理由（理由为空等于没登记）
const noWhy = (WL.wall || []).filter((w) => !w.why || !String(w.why).trim());
ok("白名单每条都有理由", (WL.wall || []).length > 0 && noWhy.length === 0);
const wallLinesInLedger = new Set(LEDGER.sites.filter((s) => s.cls === "wall").map((s) => s.line));
ok("白名单覆盖台账每一个 wall 行", wallLinesInLedger.size === (WL.wall || []).length);

// 5. 12 处 story 真的走了统一出口（不是靠文档声称）
// 12 处由本项改入，另 2 处是 v21 就有的（合计 14）。不是恰好 12 —— 写清楚，别用总数冒充本期交付量。
const routed = (SRC.match(/storyNowWallFallback\(window\)\.ms/g) || []).length;
ok("chat-view 里统一钟出口 14 处（本期 12 + 既有 2）", routed === 14);

// 6. 台账与源码对得上：每个 wall 行号在源码里真的还有 Date.now()
const wallLines = LEDGER.sites.filter((s) => s.cls === "wall").map((s) => s.line);
const srcLines = SRC.split("\n");
const stale = wallLines.filter((ln) => !srcLines[ln - 1] || !srcLines[ln - 1].includes("Date.now()"));
ok("台账行号未过期（无幽灵站点）", stale.length === 0);

console.log(pass + " 通过, " + fail + " 失败");
process.exit(fail > 0 ? 1 : 0);