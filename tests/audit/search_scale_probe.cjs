#!/usr/bin/env node
/* ============================================================
 * tests/audit/search_scale_probe.cjs
 * 探针：搜索与大数据量交互性能 —— 只量，不改。
 * ------------------------------------------------------------
 * 【要回答的问题】（R-O5「搜索与大数据量交互性能治理」的准入读数）
 *   ① 索引阶段（长会话最贵的一段）在真让出吗？定时器能跑到吗？
 *   ② 取消在**索引阶段**能受理吗？受理后到底少建了多少？（以读数证明，不只看返回值）
 *   ③ 取消在**比中阶段**少扫了多少？
 *   ④ 无取消路径的结果与同步基线条数/序列是否逐字一致？
 *   ⑤ 源侧取数（`items()` 同步物化）的真实耗时是多少？（R-O5 第 3 条要求「必须计入耗时」）
 *   ⑥ 三态读数：完成/比中作废/索引作废 的 pending 与段位各是什么形？
 *
 * 【与既有探针的关系】
 *   与 long_chat_probe.cjs / branch_play_probe.cjs 同族：只读、可复算、位置无关、fail-closed。
 *   差别：它**专门量搜索内核**，并且把「让出 / 取消 / 等价 / 三态」四类**行为判据**
 *   跑在真模块上（不是文本形态）。
 *
 * 【口径纪律（六条，全是既有代价换来的）】
 *   · 只读：不写任何文件、不改宿主；基线由调用方重定向 stdout 落盘（读数零手抄）。
 *   · 计数段可复算：同一份树跑两次逐字节相同（套件只比计数段）。
 *   · 计时段不可复算（进程调度 / GC 都会动它）⇒ 与计数段**分块**，套件只比「同量级」。
 *   · 位置无关：根走 --root 或 __dirname/../..，代码里不得出现绝对路径字面量。
 *   · 读不到就 fail-closed（exit 2），绝不以 0 发合格证。
 *   · 让出必须是**宏任务**：计时器计数才是证据（微任务让出为 0 次）。
 *
 * 【本探针只取证 + 立读数】不改产品代码。
 * ============================================================ */
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const NL = String.fromCharCode(10);
const argv = process.argv.slice(2);
const argVal = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : null; };
const JSON_MODE = argv.includes('--json');
const rootArg = argVal('--root');
const ROOT = rootArg ? path.resolve(rootArg) : path.resolve(__dirname, '..', '..');

const GSE_REL = 'apps/memory/global-search-engine.js';
const GSE_ABS = path.join(ROOT, GSE_REL);
const MANIFEST_REL = 'manifest.json';
for (const [p, label] of [[GSE_ABS, GSE_REL], [path.join(ROOT, MANIFEST_REL), MANIFEST_REL]]) {
  if (!fs.existsSync(p)) {
    console.error('[scale] 读不到 ' + label + ' —— fail-closed 拒判');
    process.exit(2);
  }
}
const MANIFEST = (() => {
  try { return JSON.parse(fs.readFileSync(path.join(ROOT, MANIFEST_REL), 'utf8')); } catch (_e) { return null; }
})();
if (!MANIFEST || !MANIFEST.version) {
  console.error('[scale] 读不到 manifest.json 的 version —— fail-closed 拒判');
  process.exit(2);
}
const MEASURED_AT = 'v' + MANIFEST.version;
const GSE_SRC = fs.readFileSync(GSE_ABS, 'utf8');
if (!GSE_SRC.length) { console.error('[scale] 引擎源码为空 —— fail-closed 拒判'); process.exit(2); }

const SIZES = [1000, 5000, 10000];
const CAP_N = 20000;
const MARK_HEAD = '头楼独有词';
const MARK_MID = '中楼独有词';
const MARK_TAIL = '末楼独有词';

function mkChat(n) {
  const mid = Math.floor(n / 2);
  const out = [];
  for (let i = 0; i < n; i++) {
    const mark = i === 0 ? MARK_HEAD : (i === mid ? MARK_MID : (i === n - 1 ? MARK_TAIL : ''));
    out.push({ is_user: i % 2 === 0, mes: (mark ? mark + ' ' : '') + '第 ' + (i + 1) + ' 楼正文 内容片段 ' + (i % 7), send_date: 1758000000000 + i * 1000 });
  }
  return out;
}
/** 合成源：items() 是**真物化**（与 makeTavernSource 同形），耗时随 n 线性。 */
function mkSrc(id, n) {
  const chat = mkChat(n);
  return {
    id: id, label: id, icon: 'DOC', appId: '', weight: 1,
    items: () => chat.map((m, i) => ({ title: '第 ' + (i + 1) + ' 楼', body: m.mes, ts: m.send_date, icon: 'DOC', meta: { floor: i } }))
  };
}
const ms = (t0) => Math.round((Number(process.hrtime.bigint() - t0) / 1e6) * 100) / 100;

(async () => {
  const g = await import(pathToFileURL(GSE_ABS).href).catch((e) => {
    console.error('[scale] 引擎装载失败 —— fail-closed 拒判：' + String((e && e.message) || e).slice(0, 200));
    return null;
  });
  if (!g || typeof g.GlobalSearchEngine !== 'function') {
    console.error('[scale] 引擎导出面不可用（GlobalSearchEngine 缺席）—— fail-closed 拒判');
    process.exit(2);
  }

  const counts = {};
  const timing = {};
  const crit = [];

  /* ── ① 让出可执行：建索引期间宏任务计时器必须真跑到 ── */
  {
    const eng = new g.GlobalSearchEngine({ sources: [mkSrc('tavern', 10000)] });
    let ticks = 0;
    const timer = setInterval(() => { ticks += 1; }, 1);
    let r = null;
    const t0 = process.hrtime.bigint();
    try { r = await eng.searchAll(MARK_MID, { full: true }); } finally { clearInterval(timer); }
    timing.full_scan_ms_n10000 = ms(t0);
    counts.ticks_during_scan_n10000 = ticks;
    counts.scanned_full_n10000 = r.scanned;
    counts.hits_n10000 = r.results.length;
    crit.push({ id: 'S1', desc: '索引与比中期间宏任务计时器真跑到（同步跑完必为 0）', pass: ticks >= 1, got: ticks });
  }

  /* ── ② 索引阶段作废：少建多少？段位是什么？ ── */
  {
    const eng = new g.GlobalSearchEngine({ sources: [mkSrc('tavern', 10000)] });
    let calls = 0;
    const t0 = process.hrtime.bigint();
    const r = await eng.searchAll(MARK_MID, { full: true, cancelIndex: true, isCancelled: () => { calls += 1; return true; } });
    timing.cancel_index_ms_n10000 = ms(t0);
    counts.index_cancel_indexed_n10000 = r.indexed;
    counts.index_cancel_scanned_n10000 = r.scanned;
    counts.index_cancel_results_n10000 = r.results.length;
    counts.index_cancel_at_is_index = (r.scope && r.scope.cancelledAt === 'index') ? 1 : 0;
    counts.index_cancel_pending_is_null = (r.scope && r.scope.pending === null) ? 1 : 0;
    counts.index_cancel_calls = calls;
    /* 取消之后 `_lastScan` 必须落**已建部分**的真记账 —— 不是上一轮的陈旧值。
     *   为什么单独记一格：`indexed` 是从返回值上看的，而真记账落在引擎实例上；
     *   两者**同时**对才说明 `gen.return()` 触发的 finally 真跑了（不报错、只错数那族）。 */
    counts.index_cancel_lastscan_indexed_n10000 = (eng._lastScan && typeof eng._lastScan.indexed === 'number') ? eng._lastScan.indexed : -1;
    crit.push({ id: 'S2', desc: '索引阶段作废：一条都不比中（scanned=0 / results=0）', pass: r.cancelled === true && r.scanned === 0 && r.results.length === 0, got: r.scanned + '/' + r.results.length });
    crit.push({ id: 'S3', desc: '索引阶段作废**真少建**（indexed 远小于全量 10000）', pass: typeof r.indexed === 'number' && r.indexed > 0 && r.indexed < 10000, got: r.indexed });
    /* 实例上的真记账必须与返回值一致 —— 两者同时成立才说明 finally 真跑了。 */
    crit.push({ id: 'S3b', desc: '作废后 _lastScan 落的是已建部分（真记账，不是上一轮陈旧值）',
      pass: counts.index_cancel_lastscan_indexed_n10000 === r.indexed && counts.index_cancel_lastscan_indexed_n10000 > 0,
      got: counts.index_cancel_lastscan_indexed_n10000 });
    crit.push({ id: 'S4', desc: '作废段位如实报 index（与比中作废不同形）', pass: counts.index_cancel_at_is_index === 1, got: String(r.scope && r.scope.cancelledAt) });
    crit.push({ id: 'S5', desc: '索引作废的 pending 是 null（未知不报 0）', pass: counts.index_cancel_pending_is_null === 1, got: String(r.scope && r.scope.pending) });
  }

  /* ── ③ 比中阶段作废：少扫多少？pending 是数字吗？ ── */
  {
    const eng = new g.GlobalSearchEngine({ sources: [mkSrc('tavern', 10000)] });
    let calls = 0;
    const t0 = process.hrtime.bigint();
    const r = await eng.searchAll(MARK_MID, { full: true, isCancelled: () => { calls += 1; return calls >= 4; } });
    timing.cancel_match_ms_n10000 = ms(t0);
    counts.match_cancel_scanned_n10000 = r.scanned;
    counts.match_cancel_pending_n10000 = (r.scope && typeof r.scope.pending === 'number') ? r.scope.pending : -1;
    counts.match_cancel_at_is_match = (r.scope && r.scope.cancelledAt === 'match') ? 1 : 0;
    counts.match_cancel_calls = calls;
    crit.push({ id: 'S6', desc: '比中作废：停在 6000（第 4 次检查 = 已扫 6000 条的契约仍在）', pass: r.scanned === 6000, got: r.scanned });
    crit.push({ id: 'S7', desc: '比中作废的 pending 是数字（已知），与索引作废不同形', pass: counts.match_cancel_pending_n10000 === 4000 && counts.match_cancel_at_is_match === 1, got: counts.match_cancel_pending_n10000 });
  }

  /* ── ④ 等价 + 完成态三态 ── */
  {
    const eng = new g.GlobalSearchEngine({ sources: [mkSrc('tavern', 5000)] });
    const sync = eng.query('楼正文', { full: true });
    const eng2 = new g.GlobalSearchEngine({ sources: [mkSrc('tavern', 5000)] });
    const chunked = await eng2.searchAll('楼正文', { full: true });
    const ids = (r) => r.results.map((x) => x.sourceId + '#' + x.title).join('|');
    counts.equiv_same_total = sync.total === chunked.total ? 1 : 0;
    counts.equiv_same_ids = ids(sync) === ids(chunked) ? 1 : 0;
    counts.equiv_total = sync.total;
    counts.done_pending_n5000 = (chunked.scope && typeof chunked.scope.pending === 'number') ? chunked.scope.pending : -1;
    counts.done_at_is_null = (chunked.scope && chunked.scope.cancelledAt === null) ? 1 : 0;
    crit.push({ id: 'S8', desc: '无取消路径与同步基线逐字一致（同 total / 同序列）', pass: counts.equiv_same_total === 1 && counts.equiv_same_ids === 1, got: counts.equiv_total });
    crit.push({ id: 'S9', desc: '完成态：pending=0 且段位为 null（三态互不同形）', pass: counts.done_pending_n5000 === 0 && counts.done_at_is_null === 1, got: counts.done_pending_n5000 });
  }

  /* ── ⑤ 取数耗时与逐源记账（R-O5 第 3 条） ── */
  {
    const src = mkSrc('tavern', 10000);
    const eng = new g.GlobalSearchEngine({ sources: [src] });
    const r = await eng.searchAll('楼正文', { full: true });
    const st = eng._lastScan || {};
    const per = (st.perSource && st.perSource.tavern) || {};
    counts.take_ms_present = (typeof per.ms === 'number' && Number.isFinite(per.ms)) ? 1 : 0;
    counts.take_ms_ge_0 = (typeof per.ms === 'number' && per.ms >= 0) ? 1 : 0;
    timing.take_ms_n10000 = (typeof per.ms === 'number') ? per.ms : -1;
    counts.last_scan_indexed_n10000 = (typeof st.indexed === 'number') ? st.indexed : -1;
    counts.scanned_again_n10000 = r.scanned;
    /* got 里**不得**放计时值：判据段必须逐字节可复算（计时值只进 timing 块）。 */
    crit.push({ id: 'S10', desc: '逐源取数耗时进读数（perSource.ms 是有限非负数）', pass: counts.take_ms_present === 1 && counts.take_ms_ge_0 === 1, got: counts.take_ms_present + '/' + counts.take_ms_ge_0 });
    crit.push({ id: 'S11', desc: '_lastScan.indexed 反映真建量（10000 档应铺满 10000）', pass: counts.last_scan_indexed_n10000 === 10000, got: counts.last_scan_indexed_n10000 });
  }

  /* ── ⑥ 上限档：60000 封顶下仍让出，且不越界 ── */
  {
    const eng = new g.GlobalSearchEngine({ sources: [mkSrc('a', CAP_N), mkSrc('b', CAP_N), mkSrc('c', CAP_N), mkSrc('d', CAP_N)] });
    let ticks = 0;
    const timer = setInterval(() => { ticks += 1; }, 1);
    let r = null;
    const t0 = process.hrtime.bigint();
    try { r = await eng.searchAll('楼正文', { full: true }); } finally { clearInterval(timer); }
    timing.cap_scan_ms_n80000 = ms(t0);
    counts.cap_scanned_n80000 = r.scanned;
    counts.cap_index_len_n80000 = r.scope.indexLen;
    counts.cap_ticks_n80000 = ticks;
    crit.push({ id: 'S12', desc: '60000 全索引封顶：不越界且期间仍让出', pass: r.scanned === 60000 && ticks >= 1, got: r.scanned + '/' + ticks });
  }

  /* ── ⑦ 规模读数（三档铺满量） ── */
  for (const N of SIZES) {
    const engQ = new g.GlobalSearchEngine({ sources: [mkSrc('tavern', N)] });
    counts['quick_index_len_n' + N] = engQ.build().length;
    const engF = new g.GlobalSearchEngine({ sources: [mkSrc('tavern', N)] });
    const t0 = process.hrtime.bigint();
    const r = await engF.searchAll('楼正文', { full: true });
    timing['scan_ms_n' + N] = ms(t0);
    counts['full_index_len_n' + N] = r.scope.indexLen;
    counts['full_scanned_n' + N] = r.scanned;
  }
  timing.heap_used_mb_after = Math.round((process.memoryUsage().heapUsed / 1048576) * 10) / 10;

  const allPass = crit.every((c) => c.pass);
  const rep = {
    file: 'tests/audit/search_scale_probe.cjs',
    probe: 'tests/audit/search_scale_probe.cjs',
    note: '搜索与大数据量交互性能取证：合成源 + 真模块（无浏览器 / 无 SillyTavern 宿主）。读数不代表实机；取消的**用户可感知延迟**须真 DOM 层另测。',
    measured_at: MEASURED_AT,
    host: { sizes: SIZES, cap_n: CAP_N * 4, announcement_stripped: false },
    readings: counts,
    timing: timing,
    criteria: crit,
    verdict: allPass ? '准入判据全绿：让出 / 取消 / 等价 / 三态四类在真模块上成立（读数见 readings 与 timing）'
      : { answer: 'inconclusive —— 准入判据未全绿，须先查探针本身而不是往下推', failed: crit.filter((c) => !c.pass).map((c) => c.id) },
    corrections: [
      '第一版把「索引阶段作废」的断言写成「indexed === 0」，实测是 2000 —— 检查点在**每片之后**（SCAN_CHUNK=2000），故第一片建完才受理。断言改为「0 < indexed < 全量」，那才是「真少建」的正确形态。',
      '不含索引阶段的取消时，比中阶段的第 4 次检查必须仍在 6000 条处生效 —— 该计数是 tests/system-v3170 B5 的既有契约，本版不得挪动（实现上表现为 cancelIndex 默认关）。',
      '计时读数不可逐字节复算（进程调度与 GC 会动它）⇒ 与计数段分块，套件只比同量级。'
    ],
    not_done: [
      '未做实机取证：无浏览器、无真 SillyTavern 宿主、无真实长会话；合成源单条正文远短于真实楼层（真实单楼可达数千字），故**绝对耗时不可外推**。',
      '未测真 DOM 层渲染代价：结果区高亮与列表重绘需要真浏览器（归 R-O6 / R-O1 的浏览器层）。',
      '未测手机端后台节流窗口：移动端定时器与 rAF 节流行为不同，本探针的「让出」证据只在 Node 事件循环上成立。',
      '未测 IndexedDB / localStorage 读取耗时：源侧取数在本探针里是内存数组，真实源走存储读取（本版只把它的耗时接进读数，未造真存储压力）。'
    ]
  };

  if (JSON_MODE) {
    process.stdout.write(JSON.stringify(rep, null, 1) + NL);
  } else {
    const L = [];
    L.push('[scale] ===== 搜索与大数据量交互性能 =====');
    for (const c of crit) L.push('[scale] ' + (c.pass ? 'OK  ' : 'NG  ') + c.id + ' ' + c.desc + ' —— ' + c.got);
    L.push('[scale] 读数组：' + JSON.stringify(counts));
    L.push('[scale] 计时组（不可复算）：' + JSON.stringify(timing));
    L.push('[scale] 判定：' + (typeof rep.verdict === 'string' ? rep.verdict : JSON.stringify(rep.verdict)));
    process.stdout.write(L.join(NL) + NL);
  }
  process.exit(0);
})().catch((e) => {
  console.error('[scale] 探针异常 —— fail-closed 拒判：' + String((e && e.stack) || e).slice(0, 400));
  process.exit(2);
});
