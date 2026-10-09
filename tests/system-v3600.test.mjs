// tests/system-v3600.test.mjs — 全历史检索真正让出事件循环（计划 O2）[v3.60.0]
//
//   本版治的是：GlobalSearchEngine.searchAll() 虽按 2000/片循环，但整个函数从头到尾
//   同步跑完 —— 片间从不让出事件循环。计时器（含用户点「取消」后那枚零延迟计时器）
//   与点击事件排在宏任务队列里，要等函数返回才轮得到；控制器那层
//   Promise.resolve().then() 只是把开始推到微任务，不是让出。
//
//   形态：取数 / 归一化 / 两档预算收成**唯一实现**（可中断生成器 _indexChunks）：
//     · build() 同步抽干 —— 快速档与全部同步调用方一字不改；
//     · searchAll() 异步驱动 —— 建索引每片后让出、比中每片后让出、收束前再让一次。
//   让出必须是**宏任务**：await 一枚已决 Promise 会被同一轮事件循环抽干，等于没让。
//
//   覆盖：
//     A 结构面（新出口在场 / 唯一实现 / 取数口不前移 / 控制器读数收敛）
//     B 行为面（片间让出宏任务 / 建索引阶段也让出 / 收束前仍让出 / 取消 / 等价 / 上限）
//     C 控制器面（读数收成一次 build / 分流不变）
//     D 负控制（真源码破坏 → 副本上重跑同款判据）
//     F 版本锚（下限形）
//
//   边界（诚实）：
//     · 计时读数（最大片耗时 / 取消延迟）本套件**只登记、不设阈值**：首次建立基线，
//       阈值待目标设备读数到手后再定 —— 本机读数不可复算（与 tests/system-v327 同口径）；
//     · 未验证真浏览器里的滚动 / 渲染：那是 docs/runtime-verification-boundary.md 的边界外。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const GSE = 'apps/memory/global-search-engine.js';
const APP = 'apps/search/search-app.js';
const NL = String.fromCharCode(10);
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const readAt = (root, p) => fs.readFileSync(path.join(root, p), 'utf8');
const GSE_SRC = read(GSE);
const APP_SRC = read(APP);

/* ══════════════ 夹具 ══════════════ */
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
function mkSrc(id, n) {
    return { id: id, label: id, icon: 'DOC', appId: '', weight: 1,
        items: () => mkChat(n).map((m, i) => ({ title: '第 ' + (i + 1) + ' 楼', body: m.mes, ts: m.send_date, icon: 'DOC', meta: { floor: i } })) };
}
const mkBigSource = (n) => mkSrc('tavern', n);
function mkShellApp() {
    const screen = { querySelector: () => null, querySelectorAll: () => [] };
    return { screen: screen, html: '', setContent(h) { this.html = String(h); } };
}
function mkStorage(extra = {}) {
    const m = new Map(Object.entries(Object.assign({ diary_entries: [{ title: '日记标题', content: '日记正文独有词' }] }, extra)));
    return { get: (k, d = null) => (m.has(k) ? m.get(k) : d), set: (k, v) => m.set(k, v), remove: (k) => m.delete(k) };
}
function mkHostChat(n) {
    const prevWin = globalThis.window;
    globalThis.window = Object.assign(globalThis.window || {}, {
        SillyTavern: { getContext: () => ({ chat: mkChat(n) }) },
        VirtualPhone: { storage: null }
    });
    return () => { globalThis.window = prevWin; };
}
const loadGse = (root) => import(pathToFileURL(path.join(root, GSE)).href);
const loadApp = (root) => import(pathToFileURL(path.join(root, APP)).href);

/* ══════════════ 同一份判据（原件与破坏副本上跑的是它们） ══════════════ */
/** B1：片间让出必须是宏任务 —— 扫描期间零延迟计时器必须真跑到。 */
async function judgeMacrotaskYield(root) {
    const g = await loadGse(root);
    const eng = new g.GlobalSearchEngine({ sources: [mkBigSource(10000)] });
    let ticks = 0;
    const timer = setInterval(() => { ticks += 1; }, 1);
    let r = null;
    try { r = await eng.searchAll(MARK_MID, { full: true }); } finally { clearInterval(timer); }
    return { ticks: ticks, hits: r.results.length, scanned: r.scanned, cancelled: r.cancelled === true };
}
/** B2：建索引阶段也让出 —— 第一次进度回调之前必须已经有计时器跑过。 */
async function judgeIndexPhaseYield(root) {
    const g = await loadGse(root);
    const eng = new g.GlobalSearchEngine({ sources: [mkBigSource(5000)] });
    let ticks = 0;
    let progressCount = 0;
    let sawTickBeforeFirstProgress = false;
    const timer = setInterval(() => { ticks += 1; if (progressCount === 0) sawTickBeforeFirstProgress = true; }, 1);
    let r = null;
    try {
        r = await eng.searchAll('楼正文', { full: true, onProgress: () => { progressCount += 1; } });
    } finally { clearInterval(timer); }
    return { sawTickBeforeFirstProgress: sawTickBeforeFirstProgress, ticks: ticks, progressCount: progressCount, scanned: r.scanned };
}
/** B3：真让出次数（可观测计数）。
 *  为什么不能用「尾巴计时器」测收束前那次让出：onProgress 之后就紧跟循环末尾的让出，
 *  尾巴计时器在任何一次让出里都会跑 —— 那种判据**分不出**收束前的那一次（假绿）。
 *  故直接数 _yieldTurn 的调用次数：它是可观测的实参，且破坏掉任何一处让出都少一次。 */
async function judgeYieldCount(root) {
    const g = await loadGse(root);
    const eng = new g.GlobalSearchEngine({ sources: [mkBigSource(5000)] });
    let yields = 0;
    const orig = eng._yieldTurn.bind(eng);
    eng._yieldTurn = function () { yields += 1; return orig(); };
    const r = await eng.searchAll('楼正文', { full: true });
    return { yields: yields, total: r.total, scanned: r.scanned, indexLen: r.scope.indexLen };
}
/** B4：取消 —— 一旦作废就不给半份结果；且如实报「扫到哪儿了」。 */
async function judgeCancel(root) {
    const g = await loadGse(root);
    let calls = 0;
    const eng = new g.GlobalSearchEngine({ sources: [mkBigSource(10000)] });
    const r = await eng.searchAll(MARK_MID, { full: true, isCancelled: () => { calls += 1; return calls >= 4; } });
    const live = await eng.searchAll(MARK_MID, { full: true });
    return { cancelled: r.cancelled === true, results: r.results.length, total: r.total,
        scanned: r.scanned, complete: r.scope.complete, pending: r.scope.pending, calls: calls,
        liveHits: live.results.length };
}
/** B5：分片只影响节奏、不影响结果集 —— 与同步全历史逐条同结果。 */
async function judgeEquivalence(root) {
    const g = await loadGse(root);
    const eng = new g.GlobalSearchEngine({ sources: [mkBigSource(5000)] });
    const sync = eng.query('楼正文', { full: true });
    const chunked = await eng.searchAll('楼正文', { full: true });
    const ids = (r) => r.results.map((x) => x.sourceId + '#' + x.title).join('|');
    return { sameTotal: sync.total === chunked.total, sameIds: ids(sync) === ids(chunked),
        total: sync.total, scanned: chunked.scanned, indexLen: chunked.scope.indexLen, complete: chunked.scope.complete };
}
/** B6：全索引封顶（60000）下也让出，且不越界。 */
async function judgeCapYield(root) {
    const g = await loadGse(root);
    const eng = new g.GlobalSearchEngine({ sources: [mkSrc('a', 20000), mkSrc('b', 20000), mkSrc('c', 20000), mkSrc('d', 20000)] });
    let ticks = 0;
    const timer = setInterval(() => { ticks += 1; }, 1);
    const t0 = Date.now();
    let r = null;
    try { r = await eng.searchAll('楼正文', { full: true }); } finally { clearInterval(timer); }
    return { scanned: r.scanned, indexLen: r.scope.indexLen, total: r.total, ticks: ticks, ms: Date.now() - t0 };
}
/** B7：快速档仍同步、仍 600/源（同步路径行为一字不改）。 */
async function judgeQuickSync(root) {
    const g = await loadGse(root);
    const eng = new g.GlobalSearchEngine({ sources: [mkBigSource(2000)] });
    const q = eng.query(MARK_TAIL);
    const qf = eng.query(MARK_TAIL, { full: true });
    const quickAfterFull = eng.build().length;
    return { quickHits: q.results.length, fullHits: qf.results.length, quickIndexLen: quickAfterFull, isThenable: !!(q && typeof q.then === 'function') };
}
/** B8/D4 用：全历史 build 的条目数（同步抽干是否仍在）。 */
async function judgeFullIndexOf(root) {
    const g = await loadGse(root);
    const eng = new g.GlobalSearchEngine({ sources: [mkBigSource(5000)] });
    return { fullLen: eng.build({ full: true }).length, quickLen: eng.build().length };
}
/** B9：读数登记（最大片耗时 / 取消延迟）—— 只登记不设阈值。 */
async function judgeReadings(root) {
    const g = await loadGse(root);
    const eng = new g.GlobalSearchEngine({ sources: [mkBigSource(10000)] });
    const chunks = [];
    let last = Date.now();
    const r = await eng.searchAll('楼正文', { full: true, onProgress: (p) => {
        const now = Date.now(); chunks.push(now - last); last = now;
    } });
    const maxChunkMs = chunks.length ? Math.max.apply(null, chunks) : -1;
    const eng2 = new g.GlobalSearchEngine({ sources: [mkBigSource(10000)] });
    let cancelAt = 0;
    const t0 = Date.now();
    setTimeout(() => { cancelAt = Date.now(); }, 5);
    const r2 = await eng2.searchAll(MARK_MID, { full: true, isCancelled: () => (cancelAt > 0) });
    return { maxChunkMs: maxChunkMs, chunks: chunks.length, scanned: r.scanned,
        cancelLatencyMs: cancelAt ? (Date.now() - t0) : -1, cancelScanned: r2.scanned, cancelResults: r2.results.length };
}

/* ══════════════ A ── 结构面 ══════════════ */
test('v3600 A1. 新出口在场：唯一实现生成器 + 让出口 + 异步分片扫描', () => {
    assert.ok(GSE_SRC.includes('async searchAll(query, opts = {}) {'), 'searchAll 必须是 async（同步函数无法让出）');
    assert.equal(GSE_SRC.includes('    searchAll(query, opts = {}) {'), false, '旧同步签名不得残留');
    assert.ok(GSE_SRC.includes('* _indexChunks(opts = {}) {'), '取数/归一化/两档预算的唯一实现生成器');
    assert.ok(GSE_SRC.includes('_yieldTurn() {'), '让出口');
    assert.ok(GSE_SRC.includes('scanSummary(full = false, opts = {}) {'), '读数出口（一次 build 出 scanned + scope）');
    assert.ok(GSE_SRC.includes('await this._yieldTurn();'), '让出必须真被 await');
});
test('v3600 A2. 两档预算常量与旧名旧值一字未改', () => {
    for (const c of ['const MAX_SCAN_PER_SOURCE = 600;', 'const MAX_SCAN_PER_SOURCE_FULL = 20000;',
        'const MAX_INDEX_FULL = 60000;', 'const SCAN_CHUNK = 2000;',
        'const BODY_DISPLAY_CAP = 600;', 'const BODY_SEARCH_CAP = 4000;']) {
        assert.ok(GSE_SRC.includes(c), '常量须在场：' + c);
    }
});
test('v3600 A3. 同一口径只有一份实现（两档预算 / 展示段分离 / 截断登记各恰好一处）', () => {
    const once = (t, why) => assert.equal(GSE_SRC.split(t).length - 1, 1, why + '（不得两份实现）：' + t);
    once('const perSource = full ? MAX_SCAN_PER_SOURCE_FULL : MAX_SCAN_PER_SOURCE;', '每源预算');
    once('if (n >= perSource || out.length >= totalCap) break;', '预算判定');
    once('bodyFull: bodyFull,', '可检索段');
    once('if (capped) cappedSources.push(src.id);', '截断登记');
    once('if (!full) this._index = out;', '全历史不进快速档缓存');
    assert.ok(GSE_SRC.includes('const gen = this._indexChunks({ full: full, sink: out });'), 'build 必须抽干同一份生成器');
    assert.ok(GSE_SRC.includes('const gen = this._indexChunks({ full: full, sink: all });'), 'searchAll 必须驱动同一份生成器');
});
test('v3600 A4. 取数口不前移截断（既有契约一字不改）', () => {
    assert.ok(GSE_SRC.includes('items: () => ctx.chat.map((m, i) => ({'), '酒馆正文源仍须全表现取（预算在下游）');
    for (const bad of ['chat.slice(-', 'makeTavernSourceLazy', 'lazyItems', 'takeFromTail', 'headSlice']) {
        assert.equal(GSE_SRC.includes(bad), false, '不得引入前移截断标记：' + bad);
    }
});
test('v3600 A5. 控制器读数收敛到内核唯一出口（页头不再重复全量 build）', () => {
    assert.ok(APP_SRC.includes('this.engine.scanSummary(full)'), '页头读数须走内核的唯一出口');
    assert.equal(APP_SRC.includes('const scanned = this.engine.build({ full: full }).length;'), false, '旧的双 build 写法不得残留');
    assert.ok(APP_SRC.includes('typeof this.engine.scanSummary'), '内核无读数出口时须诚实降级（退回旧两件）');
    assert.ok(APP_SRC.includes('isCancelled: self.cancelToken(gen)'), '取消谓言仍交给内核');
});

/* ══════════════ B ── 行为面 ══════════════ */
test('v3600 B1. 片间让出必须是宏任务：扫描期间零延迟计时器真跑到，且结果不变', async () => {
    const r = await judgeMacrotaskYield(ROOT);
    assert.equal(r.hits, 1, '让出不得改变结果集（中楼词仍须命中）');
    assert.equal(r.scanned, 10000, '让出不得少扫（仍须扫到底）');
    assert.equal(r.cancelled, false);
    assert.ok(r.ticks >= 1, '扫描期间计时器必须至少跑到一次（同步跑完必为 0，实得 ' + r.ticks + '）');
});
test('v3600 B2. 建索引阶段也让出：第一次进度回调之前就已有计时器跑过', async () => {
    const r = await judgeIndexPhaseYield(ROOT);
    assert.equal(r.scanned, 5000, '仍须扫到底');
    assert.ok(r.progressCount >= 2, '进度必须真报（实得 ' + r.progressCount + ' 片）');
    assert.equal(r.sawTickBeforeFirstProgress, true, '★ 建索引若有让出，第一次进度回调前就该有计时器跑过');
});
test('v3600 B3. 真让出次数是可观测的：索引片 + 比中片 + 收束各让一次', async () => {
    const r = await judgeYieldCount(ROOT);
    assert.equal(r.scanned, 5000, '仍须扫到底');
    assert.ok(r.total >= 5000, '命中面不变（' + r.total + '）');
    assert.ok(r.yields >= 3, '让出必须真发生多次（实得 ' + r.yields + ' 次）');
});
test('v3600 B4. 取消：作废即给空结果，且首轮检查点落在第一片之前', async () => {
    const r = await judgeCancel(ROOT);
    assert.equal(r.cancelled, true);
    assert.equal(r.results, 0, '取消后不得给任何结果（半份比空更糟）');
    assert.equal(r.total, 0);
    assert.equal(r.complete, false, '未完成态必须如实报');
    assert.equal(r.liveHits, 1, '正控：不取消时标记楼词必须命中');
    assert.equal(r.calls >= 1, true, '取消谓言必须真被调用');
});
test('v3600 B5. 等价：分片结果与同步全历史逐条同结果、同扫数、同索引长度', async () => {
    const r = await judgeEquivalence(ROOT);
    assert.ok(r.total >= 5000, '命中数应覆盖全部 5000 楼（' + r.total + '）');
    assert.equal(r.sameTotal, true, '分片与同步的 total 必须相等');
    assert.equal(r.sameIds, true, '分片与同步的结果序列必须相等（时序不得影响结果）');
    assert.equal(r.scanned, 5000);
    assert.equal(r.indexLen, 5000);
    assert.equal(r.complete, true);
});
test('v3600 B6. 全索引封顶 60000：越界不越、仍让出', async () => {
    const r = await judgeCapYield(ROOT);
    assert.equal(r.scanned, 60000, '四源各 20000 必须停在总封顶（实得 ' + r.scanned + '）');
    assert.equal(r.indexLen, 60000);
    assert.ok(r.ticks >= 1, '封顶规模下同样必须让出（实得 ' + r.ticks + ' 次）');
});
test('v3600 B7. 快速档仍同步、仍 600/源，且全扫不污染快速档', async () => {
    const r = await judgeQuickSync(ROOT);
    assert.equal(r.isThenable, false, '快速档 query 必须仍是同步返回（不得变成 Promise）');
    assert.equal(r.quickHits, 0, '快速档找不到末楼词（这正是全历史档存在的理由）');
    assert.equal(r.fullHits, 1, '全历史档必须找得到');
    assert.equal(r.quickIndexLen, 600, '全扫不得写进快速档缓存');
});
test('v3600 B8. 读数登记：最大片间隔与取消延迟（只登记不设阈值）', async () => {
    const r = await judgeReadings(ROOT);
    console.error('[v3600 读数] 片数=' + r.chunks + ' 最大片间隔=' + r.maxChunkMs + 'ms 扫描条目=' + r.scanned +
        ' 取消生效耗时=' + r.cancelLatencyMs + 'ms 取消后已扫=' + r.cancelScanned + ' 取消后结果数=' + r.cancelResults);
    assert.equal(r.cancelResults, 0, '取消后结果数必须为 0');
    assert.ok(r.maxChunkMs >= 0 && r.maxChunkMs < 5000, '最大片间隔必须是有界读数（实得 ' + r.maxChunkMs + 'ms）');
    assert.ok(r.chunks >= 2, '进度片必须真发生');
});

/* ══════════════ C ── 控制器面 ══════════════ */
test('v3600 C1. 页头读数收成一次 build（原先是两次全量 build）', async () => {
    const { SearchApp } = await loadApp(ROOT);
    const restore = mkHostChat(1200);
    try {
        const app = new SearchApp(mkShellApp(), mkStorage());
        let buildCalls = 0;
        let summaryCalls = 0;
        const ob = app.engine.build.bind(app.engine);
        const os2 = app.engine.scanSummary.bind(app.engine);
        app.engine.build = function () { buildCalls += 1; return ob.apply(null, arguments); };
        app.engine.scanSummary = function () { summaryCalls += 1; return os2.apply(null, arguments); };
        const quick = app.scopeSummary();
        app.toggleFullMode();
        const full = app.scopeSummary();
        return { quick: quick, full: full, buildCalls: buildCalls, summaryCalls: summaryCalls };
    } finally { restore(); }
});
test('v3600 C2. 分流不变：快速档同步、全历史档带承诺，切回仍同步', async () => {
    const { SearchApp } = await loadApp(ROOT);
    const restore = mkHostChat(1000);
    try {
        const app = new SearchApp(mkShellApp(), mkStorage());
        const a = app.search('日记正文独有词');
        const quickSync = !!(a && a.result && !a.promise);
        const quickHits = a && a.result ? a.result.results.length : -1;
        app.toggleFullMode();
        const b = app.search('日记正文独有词');
        const fullAsync = !!(b && !b.result && b.promise && typeof b.promise.then === 'function');
        const r = b && b.promise ? await b.promise : null;
        app.toggleFullMode();
        const c = app.search('日记正文独有词');
        return { quickSync: quickSync, quickHits: quickHits, fullAsync: fullAsync,
            fullHits: r ? r.results.length : -1, backQuickSync: !!(c && c.result && !c.promise), scanning: app._scanning };
    } finally { restore(); }
});

/* ══════════════ D ── 负控制（真源码破坏 → 副本上重跑同款判据） ══════════════ */
const CLOSURE = [GSE, APP, 'config/world-bridge.js', 'data/cheat-index.js', 'data/dirtytalk-index.js',
    // [v3.66.0 · X2] 搜索内核新增两个 config 依赖（跨 App 靶心协议件 / 数值门）：
    //   闭包不带它们，副本 import 直接 ERR_MODULE_NOT_FOUND ⇒ 负控制会退化成
    //   「因缺文件而红」而不是「因破坏而红」。
    'config/open-ref.js', 'config/num-gate.js'];
function mkTree(tag) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rp-v3600-' + tag + '-'));
    for (const f of CLOSURE) {
        const dst = path.join(dir, f);
        fs.mkdirSync(path.dirname(dst), { recursive: true });
        fs.copyFileSync(path.join(ROOT, f), dst);
    }
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ type: 'module' }));
    return dir;
}
/** 真源码破坏：锚点必须恰中 1 次，且必须真的改了文件（否则抛）。 */
function mutate(tag, edits) {
    const dir = mkTree(tag);
    for (const [f, oldText, newText] of edits) {
        const p = path.join(dir, f);
        const src = fs.readFileSync(p, 'utf8');
        const n = src.split(oldText).length - 1;
        assert.equal(n, 1, '变异锚点须恰中 1 次：' + tag + ' / ' + f + '（实得 ' + n + '）');
        const next = src.replace(oldText, newText);
        assert.notEqual(next, src, '变异必须真的改了文件：' + tag);
        fs.writeFileSync(p, next);
    }
    return dir;
}
/* [v3.75.0 + R-O5 交棒] 索引让出点仍是同一句；它在索引循环体内、且其后紧跟「索引片间受理作废」分支（默认关）。
 *   为什么不再把 `}` 与阶段二注释一起当锚点：形状变了（合法地多了一个分支），判据要钉的是**让出本身**，不是它周围有几行。
 *   判别力不变：删掉这句后「第一次进度回调前不得再有计时器跑过」照样转红（D1）。 */
/* ★ 唯一性靠**上下文**，不靠缩进：阶段二循环里也有一句同缩进的让出，
 *   单行锚点实得 2 次（D1 因此在唯一性断言上 fail-closed 拒改 —— 这是对的）。
 *   故锚点取「让出 + 紧随的索引阶段开关」两行；阶段二那句后面跟的是 `}`。 */
const A_STAGE1 = ['            await this._yieldTurn();', '            if (cancelIndex && cancelledNow()) {'].join(NL);
const A_STAGE1_X = ['            if (cancelIndex && cancelledNow()) {'].join(NL);
const A_TAIL = ['        await this._yieldTurn();', '        hits.sort((a, b) => (b.score - a.score) || (b.ts - a.ts));'].join(NL);
const A_TAIL_X = ['        hits.sort((a, b) => (b.score - a.score) || (b.ts - a.ts));'].join(NL);
const A_MACRO = "if (typeof g.setTimeout === 'function') { g.setTimeout(resolve, 0); return; }";
const A_MACRO_X = "if (typeof g.setTimeout === 'function') { resolve(); return; }";
const A_DRAIN = '        for (let step = gen.next(); !step.done; step = gen.next()) { /* 抽干，不让出 */ }';
const A_DRAIN_X = '        gen.next();';

test('v3600 D1. 删掉建索引阶段的让出 ⇒ B2 同款判据必须转红', async () => {
    const dir = mutate('d1', [[GSE, A_STAGE1, A_STAGE1_X]]);
    const r = await judgeIndexPhaseYield(dir);
    assert.equal(r.sawTickBeforeFirstProgress, false, '★ 删掉建索引让出后，第一次进度回调前不得再有计时器跑过');
    const ok = await judgeIndexPhaseYield(ROOT);
    assert.equal(ok.sawTickBeforeFirstProgress, true, '阳性对照：原件上同款判据必须为绿');
});
test('v3600 D2. 删掉收束前的让出 ⇒ B3 同款判据必须转红', async () => {
    const dir = mutate('d2', [[GSE, A_TAIL, A_TAIL_X]]);
    const r = await judgeYieldCount(dir);
    const ok = await judgeYieldCount(ROOT);
    assert.equal(r.scanned, 5000, '前置：破坏不得改变结果集');
    assert.equal(r.yields, ok.yields - 1, '★ 少一次让出必须可观测（实得 ' + r.yields + '，原件 ' + ok.yields + '）');
    assert.ok(ok.yields >= 3, '阳性对照：原件让出次数充足');
});
test('v3600 D3. 让出退化成微任务 ⇒ B1 同款判据必须转红', async () => {
    const dir = mutate('d3', [[GSE, A_MACRO, A_MACRO_X]]);
    const r = await judgeMacrotaskYield(dir);
    assert.equal(r.hits, 1, '前置：破坏不得改变结果集');
    assert.equal(r.ticks, 0, '★ 让出退化成微任务后，计时器必须一次都跑不到（实得 ' + r.ticks + '）');
    const ok = await judgeMacrotaskYield(ROOT);
    assert.ok(ok.ticks >= 1, '阳性对照：原件上同款判据必须为绿');
});
test('v3600 D4. build 不再抽干生成器 ⇒ B8 同款判据必须转红', async () => {
    const dir = mutate('d4', [[GSE, A_DRAIN, A_DRAIN_X]]);
    const bad = await judgeFullIndexOf(dir);
    assert.notEqual(bad.fullLen, 5000, '★ 不抽干后全历史 build 必须拿不到满量（实得 ' + bad.fullLen + '）');
    const ok = await judgeFullIndexOf(ROOT);
    assert.equal(ok.fullLen, 5000, '阳性对照：原件全历史 build 必须铺满');
    assert.equal(ok.quickLen, 600, '阳性对照：原件快速档仍 600/源');
});
test('v3600 D5. 变异工具两向自证（锚点不存在 / 不唯一都必须抛）', () => {
    assert.throws(() => mutate('d5a', [[GSE, '不存在的锚点字符串_zzz', 'x']]), /须恰中 1 次/);
    assert.throws(() => mutate('d5b', [[GSE, 'const MAX_SCAN_PER_SOURCE', 'x']]), /须恰中 1 次/);
});
test('v3600 D6. 真仓只读：全部破坏跑完后，真仓判据必须仍然干净', async () => {
    const r = await judgeMacrotaskYield(ROOT);
    assert.equal(r.hits, 1);
    assert.ok(r.ticks >= 1, '真仓仍须让出');
    const q = await judgeQuickSync(ROOT);
    assert.equal(q.quickIndexLen, 600);
    const raw = readAt(ROOT, GSE);
    assert.ok(raw.includes(A_STAGE1), '真仓建索引让出仍在');
    /* [v3.75.0 + R-O5] 新增分支必须也在（防有人把整块摘掉而套件不自知）：
     *   只钉「开关在场」这一条字符串 —— 分支的行为面由新套件 v3760 守。 */
    assert.ok(raw.includes('const cancelIndex = opts.cancelIndex === true;'), '真仓索引阶段受理作废的开关仍在');
    assert.ok(raw.includes(A_TAIL), '真仓收束让出仍在');
});

/* ══════════════ F ── 版本锚（下限形） ══════════════ */
test('v3600 F1. 版本锚（下限形）：三处同源且不低于 3.60.0', () => {
    const VNUM = (s) => Number(String(s).split('.').reduce((a, x) => a * 1000 + Number(x), 0));
    const man = JSON.parse(read('manifest.json'));
    const pkg = JSON.parse(read('package.json'));
    const codeVer = (/const ST_PHONE_VERSION = '([^']+)'/.exec(read('index.js')) || [])[1];
    assert.ok(codeVer, '入口版本常量在场');
    assert.equal(codeVer, man.version, '入口 == manifest');
    assert.equal(pkg.version, man.version, 'package == manifest');
    assert.ok(VNUM(man.version) >= VNUM('3.60.0'), '本套件自 3.60.0 起成立；当前 ' + man.version);
});
