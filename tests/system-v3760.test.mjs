// tests/system-v3760.test.mjs — 搜索与大数据量交互性能治理（计划 R-O5）[v3.75.0]
//
//   本版治的是 R-O5「搜索与大数据量交互性能」验收四条里**前三条 + 读数**：
//     ① 搜索进行中计时器与点击事件可执行（证明真让出）—— 由 v3.60.0 已交付，
//        本套件只做**回归锚**（不重复立判据，避免两份实现）；
//     ② 取消后**确实少扫描**（以扫描计数证明，不只看返回值）—— 本版新增两段：
//        索引阶段受理作废（此前最贵的一段不可中断）、作废段位可区分（index / match）；
//     ③ 无取消路径的结果与同步基线**逐字一致**（同 total / 同序列）—— 本套件守；
//     ④ 读数：逐源取数耗时进读数（此前源侧 `items()` 同步物化的代价是「看不见的成本」）、
//        `pending` 与 `cancelledAt` 三态互不同形（未知不报 0）。
//
//   为什么「让出」的判据不在这里重写：v3.60.0 立的是**行为面**判据（宏任务计时器真跑到 /
//   让出次数可观测 / 收束前让出），本仓纪律是同一口径只有一份实现。本套件对它只做
//   负控制交棒（D5 复用其变异纪律）+ 回归锚（C1）。
//
//   边界（诚实，四条）：
//     · 计时读数（逐源取数 ms / 各档扫描 ms）本套件**只登记、不设阈值**：目标设备读数未取得，
//       本机读数不可复算（与 tests/system-v327 / v3600 同口径）；
//     · 未证明真浏览器里的渲染代价：结果区高亮与列表重绘归 R-O6 / 浏览器层；
//     · 未证明移动端后台节流窗口：本层只在 Node 事件循环上成立；
//     · 源的取数耗时接进了读数，但**没有造真存储压力**（真 IndexedDB / localStorage 读取归实测）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const GSE = 'apps/memory/global-search-engine.js';
const APP = 'apps/search/search-app.js';
const PROBE = 'tests/audit/search_scale_probe.cjs';
const BASEF = 'tests/audit/search_scale_baseline.json';
const NL = String.fromCharCode(10);
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const readAt = (root, p) => fs.readFileSync(path.join(root, p), 'utf8');
const GSE_SRC = read(GSE);
const APP_SRC = read(APP);
const PROBE_SRC = read(PROBE);
const base = JSON.parse(read(BASEF));
/** 基线首测版：**冻结的历史值**（建基线时的当版），抬版不得改写 —— tests/system-v327 E1 同款纪律。 */
const FIRST_MEASURED_AT = 'v3.75.0';
const baselineFrozenAt = (b, first) => b.measured_at === first;

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
/** 合成源：`items()` 是**真物化**（与 makeTavernSource 同形）—— 预算在下游，取数口不前移截断。 */
function mkSrc(id, n) {
    const chat = mkChat(n);
    return { id: id, label: id, icon: 'DOC', appId: '', weight: 1,
        items: () => chat.map((m, i) => ({ title: '第 ' + (i + 1) + ' 楼', body: m.mes, ts: m.send_date, icon: 'DOC', meta: { floor: i } })) };
}
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
/** C1：索引阶段作废 —— 少建多少？段位是什么？读数是不是**已建部分**的真记账？
 *  让出次数用 `_yieldTurn` 计数（可观测的实参），不用计时器（计时器在单次让出上非确定）。 */
async function judgeIndexPhaseCancel(root) {
    const g = await loadGse(root);
    const eng = new g.GlobalSearchEngine({ sources: [mkSrc('tavern', 10000)] });
    let yields = 0;
    const orig = eng._yieldTurn.bind(eng);
    eng._yieldTurn = function () { yields += 1; return orig(); };
    let calls = 0;
    const r = await eng.searchAll(MARK_MID, { full: true, cancelIndex: true, isCancelled: () => { calls += 1; return true; } });
    const st = eng._lastScan || {};
    return { cancelled: r.cancelled === true, scanned: r.scanned, results: r.results.length, total: r.total,
        indexed: r.indexed, scopeIndexed: r.scope && r.scope.indexLen,
        /* 实例上的真记账：读不到就报 -1（「没有」与「是 0」不同形 —— 后者会与 legit 的 0 混淆）。 */
        lastScanIndexed: (typeof st.indexed === 'number') ? st.indexed : -1,
        cancelledAt: r.scope && r.scope.cancelledAt, pending: r.scope && r.scope.pending,
        complete: r.scope && r.scope.complete, calls: calls, yields: yields };
}
/** C2：默认路径（不传 cancelIndex）—— 索引阶段**不得**受理作废。
 *  `isCancelled` 调用计数是 tests/system-v3170 B5 的既有契约：默认路径第 1 次检查在比中起点。 */
async function judgeDefaultPath(root) {
    const g = await loadGse(root);
    const eng = new g.GlobalSearchEngine({ sources: [mkSrc('tavern', 10000)] });
    let calls = 0;
    const r = await eng.searchAll(MARK_MID, { full: true, isCancelled: () => { calls += 1; return true; } });
    return { cancelledAt: r.scope && r.scope.cancelledAt, scanned: r.scanned, indexed: r.indexed, calls: calls };
}
/** C3：比中阶段作废 —— 少扫多少、pending 是已知数（与索引作废不同形）。 */
async function judgeMatchPhaseCancel(root) {
    const g = await loadGse(root);
    const eng = new g.GlobalSearchEngine({ sources: [mkSrc('tavern', 10000)] });
    let calls = 0;
    const r = await eng.searchAll(MARK_MID, { full: true, isCancelled: () => { calls += 1; return calls >= 4; } });
    return { scanned: r.scanned, indexed: r.indexed, pending: r.scope && r.scope.pending,
        cancelledAt: r.scope && r.scope.cancelledAt, calls: calls, results: r.results.length };
}
/** C4：等价 —— 分片（无取消）与同步全历史逐条同结果；完成态三态。 */
async function judgeEquivalence(root) {
    const g = await loadGse(root);
    const eng = new g.GlobalSearchEngine({ sources: [mkSrc('tavern', 5000)] });
    const sync = eng.query('楼正文', { full: true });
    const eng2 = new g.GlobalSearchEngine({ sources: [mkSrc('tavern', 5000)] });
    const chunked = await eng2.searchAll('楼正文', { full: true });
    const ids = (r) => r.results.map((x) => x.sourceId + '#' + x.title).join('|');
    return { sameTotal: sync.total === chunked.total, sameIds: ids(sync) === ids(chunked),
        total: sync.total, scanned: chunked.scanned, indexLen: chunked.scope.indexLen,
        pending: chunked.scope.pending, cancelledAt: chunked.scope.cancelledAt, complete: chunked.scope.complete };
}
/** C5：逐源取数耗时进读数 + `_lastScan.indexed` 是真建量。 */
async function judgeTakeMs(root) {
    const g = await loadGse(root);
    const eng = new g.GlobalSearchEngine({ sources: [mkSrc('tavern', 10000)] });
    const r = await eng.searchAll('楼正文', { full: true });
    const st = eng._lastScan || {};
    const per = (st.perSource && st.perSource.tavern) || {};
    return { ms: per.ms, lastScanIndexed: st.indexed, scanned: r.scanned };
}
/** C6：调度契约回归锚 —— 默认路径第 4 次检查仍在 6000 条处（v3170 B5 的既有契约不得挪动）。 */
async function judgeScheduleContract(root) {
    const g = await loadGse(root);
    const eng = new g.GlobalSearchEngine({ sources: [mkSrc('tavern', 10000)] });
    let calls = 0;
    const r = await eng.searchAll('楼正文', { full: true, isCancelled: () => { calls += 1; return calls >= 4; } });
    return { scanned: r.scanned, calls: calls };
}
/** E1/E2：app 层端到端 —— 全历史档点取消，引擎必须真收到 `cancelIndex`。 */
async function judgeAppCancelIndex(root, n = 10000) {
    const { SearchApp } = await loadApp(root);
    const restore = mkHostChat(n);
    try {
        const app = new SearchApp(mkShellApp(), mkStorage());
        app.toggleFullMode();
        const a = app.search(MARK_MID);
        if (!a || !a.promise) return { hasPromise: false };
        app.newQueryToken(); /* 用户点「取消」：代际推进 ⇒ isCancelled 谓言转真 */
        const r = await a.promise;
        return { hasPromise: true, cancelled: r.cancelled === true, results: r.results.length,
            cancelledAt: r.scope && r.scope.cancelledAt, pending: r.scope && r.scope.pending,
            complete: r.scope && r.scope.complete };
    } finally { restore(); }
}
/** B：探针与基线（探针是只读取数面，套件只对账、不重写）。 */
function runProbe(root) {
    const args = [path.join(ROOT, PROBE)];
    if (root) args.push('--root', root);
    args.push('--json');
    return spawnSync(process.execPath, args, { cwd: ROOT, encoding: 'utf8', timeout: 300000 });
}
function judgeProbeBase(root) {
    const r = runProbe(root);
    if (r.status !== 0) return { status: r.status, stderr: String(r.stderr || '').slice(0, 400) };
    try { return { status: 0, rep: JSON.parse(r.stdout) }; } catch (e) { return { status: 0, bad: String(r.stdout).slice(0, 200) }; }
}

/* ══════════════ 变异工具（真源码破坏 → 副本上重跑同款判据） ══════════════ */
/* 引擎闭包：global-search-engine 的 import 闭包（6 个文件，实测形态）。
 *   闭包不带全 ⇒ 副本 import 直接 ERR_MODULE_NOT_FOUND ⇒ 负控制会退化成「因缺文件而红」。 */
const CLOSURE_ENGINE = [GSE, 'data/cheat-index.js', 'data/dirtytalk-index.js',
    'config/world-bridge.js', 'config/open-ref.js', 'config/num-gate.js'];
/* app 闭包：search-app 的 import 闭包（9 个文件，比引擎多视图层两件）。 */
const CLOSURE_APP = CLOSURE_ENGINE.concat([APP, 'apps/search/search-view.js', 'config/app-open-detail.js']);
function mkTree(tag, files) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rp-v3760-' + tag + '-'));
    for (const f of files) {
        const dst = path.join(dir, f);
        fs.mkdirSync(path.dirname(dst), { recursive: true });
        fs.copyFileSync(path.join(ROOT, f), dst);
    }
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ type: 'module' }));
    return dir;
}
/** 真源码破坏：锚点必须恰中 1 次，且必须真的改了文件（否则抛）。 */
function mutate(tag, edits, files = CLOSURE_ENGINE) {
    const dir = mkTree(tag, files);
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

/* ══════════════ A ── 结构面 ══════════════ */
test('v3760 A1. 受理作废的唯一开关在场，且默认关是**显式**的', () => {
    assert.ok(GSE_SRC.includes('const cancelIndex = opts.cancelIndex === true;'),
        '索引阶段受理作废必须有唯一开关，且默认关写成显式比较（不得 `!== false`）');
    assert.equal(GSE_SRC.includes('const cancelIndex = opts.cancelIndex !== false;'), false,
        '默认关不得写成 `!== false`（那会让既有调用方在索引阶段被提前作废，挪动 isCancelled 调用计数契约）');
    assert.ok(GSE_SRC.includes('if (cancelIndex && cancelledNow()) {'), '开关必须真进判定');
    assert.ok(GSE_SRC.includes('gen.return();'), '作废必须用 gen.return() 收束生成器（触发 finally 落真记账）');
});
test('v3760 A2. 段位与三态：cancelledAt / pending 各恰好一份实现', () => {
    const once = (t, why) => assert.equal(GSE_SRC.split(t).length - 1, 1, why + '（不得两份实现）：' + t);
    once('cancelledAt: (cov && cov.cancelledAt) || null,', '段位口径');
    once("pending: null, complete: false, cancelledAt: 'index'", '索引段作废');
    once('const pendingKnown = (cov && cov.pending != null) ? Number(cov.pending) : null;', 'pending 三态');
    for (const s of ['indexed: all.length', 'scanned: 0']) {
        assert.ok(GSE_SRC.includes(s), '索引段作废必须如实报：' + s);
    }
});
test('v3760 A3. 取数耗时进读数，且**取数口不前移截断**（既有契约一字不改）', () => {
    assert.ok(GSE_SRC.includes('const takeT0 = nowMs();'), '取数耗时计时起点');
    assert.ok(GSE_SRC.includes('const takeMs = Math.round((nowMs() - takeT0) * 100) / 100;'), '取数耗时读数');
    assert.equal(GSE_SRC.split('ms: takeMs }').length - 1, 3, 'perSource 三个登记点都要带 ms（初记 / 片登记 / 收尾）');
    assert.equal(GSE_SRC.includes('ms: takeMs },'), false, 'ms 不得写成另一样式（两份实现必然漂移）');
    /* 取数口仍是一次同步物化：items() 全表现取，预算在下游（v3170 A2 / v327 B1 锁死）。 */
    assert.ok(GSE_SRC.includes('items: () => ctx.chat.map((m, i) => ({'), '酒馆源仍须全表现取');
    for (const bad of ['chat.slice(-', 'lazyItems', 'takeFromTail', 'headSlice']) {
        assert.equal(GSE_SRC.includes(bad), false, '不得引入前移截断标记：' + bad);
    }
});
test('v3760 A4. 控制器把「索引阶段受理作废」接上（端到端不是死代码）', () => {
    assert.ok(APP_SRC.includes('cancelIndex: true,'), '全历史档必须真传这一格（否则新路径在界面上永不生效）');
    assert.ok(APP_SRC.includes('isCancelled: self.cancelToken(gen)'), '取消谓言仍交给内核（代际语义不变）');
    assert.equal(APP_SRC.split('cancelIndex:').length - 1, 1, '这一格只许有一个传点（多处传会让「谁在作废」不可查）');
});
test('v3760 A5. 探针与基线在场，且路径互相指名', () => {
    assert.ok(PROBE_SRC.includes("const MEASURED_AT = 'v' + MANIFEST.version;"), '探针版本必须现读 manifest');
    assert.equal(base.probe, PROBE, '基线必须指名探针路径');
    assert.ok(Array.isArray(base.criteria) && base.criteria.length >= 12, '基线判据面须齐（≥12 条）');
    assert.ok(base.readings && typeof base.readings === 'object' && Object.keys(base.readings).length >= 30, '读数面须齐（≥30 项）');
    assert.ok(Array.isArray(base.corrections) && base.corrections.length >= 3, '修正面须如实写下');
    assert.ok(Array.isArray(base.not_done) && base.not_done.length >= 4, '没做什么须如实写下（≥4）');
    const txt = JSON.stringify(base);
    assert.ok(/合成/.test(txt) && /非实机|不代表实机/.test(txt), '必须写明合成源 / 非实机');
});

/* ══════════════ B ── 探针与基线对账 ══════════════ */
test('v3760 B1. 探针可跑通、判据全绿，且计数段与基线逐项一致（读数零手抄）', () => {
    const r = judgeProbeBase(null);
    assert.equal(r.status, 0, '探针必须能跑通：' + String(r.stderr || r.bad || ''));
    const rep = r.rep;
    assert.ok(rep, '探针输出必须是 JSON');
    assert.deepEqual(rep.readings, base.readings, '读数必须与基线逐项一致');
    assert.deepEqual(rep.criteria, base.criteria, '判据段（含 got）必须逐字节可复算');
    const failed = (rep.criteria || []).filter((c) => !c.pass).map((c) => c.id);
    assert.deepEqual(failed, [], '探针判据必须全绿，未过：' + failed.join(','));
    assert.equal(typeof rep.verdict, 'string', '全绿时结论必须是文本，不是 inconclusive 对象');
});
test('v3760 B2. 计时段与计数段分块：套件只对账计数，不把耗时写成阈值', () => {
    const r = judgeProbeBase(null);
    assert.equal(r.status, 0);
    const rep = r.rep;
    assert.ok(rep.timing && typeof rep.timing === 'object', '计时段必须单列');
    for (const [k, v] of Object.entries(rep.timing)) {
        assert.ok(Number.isFinite(v) && v >= 0, 'timing.' + k + ' 必须是有限非负数');
    }
    for (const k of ['scan_ms_n1000', 'scan_ms_n5000', 'scan_ms_n10000', 'take_ms_n10000']) {
        assert.ok(Number.isFinite(rep.timing[k]), '计时段缺格：' + k);
    }
    /* 单调度量级：耗时随规模单调不减 —— 只做**量级**判定，不设绝对阈值（目标设备未取得）。 */
    assert.ok(rep.timing.scan_ms_n10000 >= rep.timing.scan_ms_n1000 * 0.5, '10000 档不得比 1000 档快一半以上（调度抖动之外）');
    assert.ok(base.timing, '基线必须也留计时段（供跨版本比较）');
});
test('v3760 B3. 负控制：探针硬编码版本 / 基线改成当前版本 ⇒ 同款真判据必须转红', () => {
    /* 真源码破坏：对**探针文件的真实副本**做替换，同款判据作用在副本上。 */
    const damaged = PROBE_SRC.split("'v' + MANIFEST.version").join("'v3.74.0'");
    assert.notEqual(damaged, PROBE_SRC, '破坏必须真的发生（锚点须命中探针源码）');
    const live = (src) => src.includes("'v' + MANIFEST.version");
    assert.equal(live(damaged), false, '负控制：硬编码版本后「现读」判据必须转红');
    assert.equal(live(PROBE_SRC), true, '对照：真探针仍为真');
    /* 基线首测版是**冻结的历史值**（本基线建立时的当版），抬版不得改写它 ——
     *   改成「当前版本」这个移动靶，判据会随抬版无声漂移（与 tests/system-v327 E1 同款纪律）。
     *   ★ 本条会在「未抬版」的中间态红：那是对的 —— 本套件与 F1 的下限锚同期生效。 */
    assert.ok(baselineFrozenAt(base, FIRST_MEASURED_AT), '基线首测版必须冻结在 ' + FIRST_MEASURED_AT + '（实测 ' + base.measured_at + '）');
    /* 破坏样本必须取**首测版之外**的版本 —— 拿「当版」当样本是形状错：建基线那一版
     *   首测版与当版天然同值，断言会恒真（假绿）。取首测版的下一版则两向恒成立。 */
    const OTHER = 'v' + FIRST_MEASURED_AT.replace(/(\d+)$/, (d) => String(Number(d) + 1));
    assert.notEqual(OTHER, FIRST_MEASURED_AT, '破坏样本必须与首测版不同');
    assert.equal(baselineFrozenAt({ measured_at: OTHER }, FIRST_MEASURED_AT), false,
        '负控制：把基线改成另一个版本（含抬版后的当版）必须转红');
    assert.equal(baselineFrozenAt(base, FIRST_MEASURED_AT), true, '对照：真基线仍冻结在首测版');
});
test('v3760 B4. 位置无关：探针在**镜像根**上跑出同一份计数段', () => {
    const dir = mkTree('probe', [PROBE, 'manifest.json', GSE].concat(CLOSURE_ENGINE.filter((f) => f !== GSE)));
    const r = judgeProbeBase(dir);
    assert.equal(r.status, 0, '探针必须能在镜像根上跑（位置无关）：' + String(r.stderr || r.bad || ''));
    assert.deepEqual(r.rep.readings, base.readings, '同一份树下计数段必须逐字节相同（读数与根路径无关）');
});

/* ══════════════ C ── 行为面 ══════════════ */
test('v3760 C1. 索引阶段作废：一条都不比中，且**真少建**（以计数证明）', async () => {
    const r = await judgeIndexPhaseCancel(ROOT);
    assert.equal(r.cancelled, true, '必须如实报作废');
    assert.equal(r.results, 0, '取消后不得给任何结果（半份比空更糟）');
    assert.equal(r.total, 0);
    assert.equal(r.scanned, 0, '一条都没比中过（作废发生在索引段）');
    assert.ok(r.indexed > 0 && r.indexed < 10000, '索引阶段作废必须**真少建**（0 < indexed < 10000，实得 ' + r.indexed + '）');
    assert.equal(r.indexed, 2000, '检查点在每片之后（SCAN_CHUNK=2000）⇒ 第一片建完才受理（实得 ' + r.indexed + '）');
    assert.ok(r.yields >= 1, '索引阶段必须仍让出（作废路径不得把让出吃掉，实得 ' + r.yields + '）');
});
test('v3760 C2. 作废段位可区分，且读数落的是**已建部分**的真记账', async () => {
    const r = await judgeIndexPhaseCancel(ROOT);
    assert.equal(r.cancelledAt, 'index', '索引段作废必须报 index（与比中段不同形）');
    assert.equal(r.complete, false, '未完成态须如实报');
    assert.equal(r.pending, null, '★ 「还剩多少没建」根本不可得 ⇒ 必须报 null，不得塌成 0');
    assert.equal(r.lastScanIndexed, r.indexed, '引擎实例上的 _lastScan 必须与返回值同数（gen.return() 触发的 finally 真跑了）');
    assert.ok(r.lastScanIndexed > 0, '真记账不得停在上一轮的陈旧值（实得 ' + r.lastScanIndexed + '）');
    assert.equal(r.scopeIndexed, r.indexed, 'scope.indexLen 与 indexed 必须同源（同一个 all.length）');
    assert.equal(r.calls, 1, '索引段的检查点每片一次 ⇒ 立即作废只调一次谓言（实得 ' + r.calls + '）');
});
test('v3760 C3. 比中阶段作废：少扫（6000/10000）且 pending 是已知数（与索引段不同形）', async () => {
    const r = await judgeMatchPhaseCancel(ROOT);
    assert.equal(r.scanned, 6000, '第 4 次检查 = 已扫 6000 条（既有契约仍在，实得 ' + r.scanned + '）');
    assert.equal(r.cancelledAt, 'match', '比中段作废必须报 match');
    assert.equal(r.pending, 4000, '比中段的剩余是**已知数**（10000-6000）');
    assert.equal(r.indexed, 10000, '比中段作废时索引已建满 —— 这正是它比索引段「贵」的地方');
    assert.equal(r.results, 0);
});
test('v3760 C4. 无取消路径与同步基线逐字一致（同 total / 同序列）', async () => {
    const r = await judgeEquivalence(ROOT);
    assert.equal(r.sameTotal, true, '分片与同步的 total 必须相等');
    assert.equal(r.sameIds, true, '结果序列必须逐条相等（时序不得影响结果）');
    assert.ok(r.total >= 5000, '命中面须覆盖全部 5000 楼（' + r.total + '）');
    assert.equal(r.scanned, 5000);
    assert.equal(r.indexLen, 5000);
    assert.equal(r.complete, true, '完成态');
    assert.equal(r.pending, 0, '完成态 pending 是**数字 0**（真的没有剩余，与「未知」不同形）');
    assert.equal(r.cancelledAt, null, '完成态段位是 null（三态互不同形：null / index / match）');
    assert.equal(r.cancelledAt === undefined, false, '段位格必须在场（缺席与 null 不是一回事）');
});
test('v3760 C5. 默认路径的调度契约一字未动（不给 cancelIndex 就不会在索引段被作废）', async () => {
    const r = await judgeDefaultPath(ROOT);
    assert.equal(r.cancelledAt, 'match', '默认路径仍在**比中段**受理作废（索引段不得受理）');
    assert.equal(r.scanned, 0, '比中段第一次检查在 processed=0 ⇒ 立即作废时已扫 0 条');
    assert.equal(r.indexed, 10000, '索引仍须建满（默认路径不给索引段检查点）');
    assert.equal(r.calls, 1, '默认路径的谓言第 1 次调用出现在比中段（v3170 B5 的调用计数契约）');
    const c6 = await judgeScheduleContract(ROOT);
    assert.equal(c6.scanned, 6000, '第 4 次检查仍须落在 6000 条处（实得 ' + c6.scanned + '）');
});
test('v3760 C6. 逐源取数耗时进读数，且 _lastScan.indexed 是真建量', async () => {
    const r = await judgeTakeMs(ROOT);
    assert.ok(Number.isFinite(r.ms), 'perSource.ms 必须是有限数（R-O5 第 3 条：取数耗时必须计入）');
    assert.ok(r.ms >= 0, '耗时不小于 0');
    assert.ok(r.ms < 5000, '单源取数耗时须是有界读数（实得 ' + r.ms + 'ms；超界说明夹具或形态变了）');
    assert.equal(r.lastScanIndexed, 10000, '未作废时 _lastScan.indexed 必须铺满（实得 ' + r.lastScanIndexed + '）');
    assert.equal(r.scanned, 10000);
});

/* ══════════════ D ── 负控制（真源码破坏 → 副本上重跑同款判据） ══════════════ */
test('v3760 D1. 摘掉索引段的受理分支 ⇒ C1/C2 同款判据必须转红', async () => {
    const A_GUARD = ['            if (cancelIndex && cancelledNow()) {', '                /* 索引阶段被作废'].join(NL);
    /* 替换必须**保住注释开头那一行**：锚点的第二行是注释起始，吃掉它会让注释体变成悬空 `*` ⇒ 语法坏，
     *   负控制就退化成「因语法错而红」而不是「因分支被摘而红」（这是本版自己踩到的一处）。 */
    const A_GUARD_X = ['            if (false) {', '                /* 索引阶段被作废'].join(NL);
    const dir = mutate('d1', [[GSE, A_GUARD, A_GUARD_X]]);
    const r = await judgeIndexPhaseCancel(dir);
    /* 前置：破坏**不得**改变「一条都没比中」这一点 —— 谓言恒真，两条路径都会作废。
     *   能区分的观测量是 `indexed`（是否真少建）与 `cancelledAt`（受理在哪一段）。 */
    assert.equal(r.scanned, 0, '前置：两条路径都不该比中任何一条（实得 ' + r.scanned + '）');
    assert.equal(r.indexed, 10000, '★ 摘掉分支后索引必然建满 —— 「少建」这一条必须转红');
    assert.equal(r.cancelledAt, 'match', '★ 段位必须退回到比中段（不再报 index）');
    const ok = await judgeIndexPhaseCancel(ROOT);
    assert.equal(ok.cancelledAt, 'index', '阳性对照：原件上同款判据必须为绿');
    assert.ok(ok.indexed < 10000, '阳性对照：原件上索引必须真少建');
});
test('v3760 D2. 开关默认改成「非 false 即为真」⇒ 默认路径的调度契约必须转红', async () => {
    const A = 'const cancelIndex = opts.cancelIndex === true;';
    const dir = mutate('d2', [[GSE, A, 'const cancelIndex = opts.cancelIndex !== false;']]);
    const r = await judgeDefaultPath(dir);
    assert.equal(r.cancelledAt, 'index', '★ 默认打开后，不给选项的调用方也会在索引段被作废（这就是契约被挪动）');
    assert.equal(r.indexed, 2000, '★ 索引只建了一片 —— 既有调用方的行为被改');
    const ok = await judgeDefaultPath(ROOT);
    assert.equal(ok.cancelledAt, 'match', '阳性对照：原件上默认路径仍只在比中段受理');
});
test('v3760 D3. 作废时不给 gen.return() ⇒ 实例上的真记账必须转红', async () => {
    const A = ['                 *   （防「取消之后读数还停在上一轮」那类不报错、只错数的形态）。 */', '                gen.return();'].join(NL);
    /* 只摘 `gen.return();` 那一行，换成一条普通注释行：注释头仍在 ⇒ 语法不坏 ⇒
     *   转红只会来自「生成器没被收束」，不会退化成「因语法错而红」。 */
    const B = ['                 *   （防「取消之后读数还停在上一轮」那类不报错、只错数的形态）。 */', '                /* 收束被摘掉（生成器不再 return） */'].join(NL);
    const dir = mutate('d3', [[GSE, A, B]]);
    const r = await judgeIndexPhaseCancel(dir);
    /* 不收束 ⇒ 生成器没跑 finally ⇒ 引擎实例上的 _lastScan 停在「还没记账」的形态。 */
    assert.notEqual(r.lastScanIndexed, r.indexed, '★ 不收束生成器时，实例记账必须与返回的 indexed 不同（实得 ' + r.lastScanIndexed + '）');
    assert.notEqual(r.lastScanIndexed, 2000, '★ 不收束 ⇒ 真记账不得是已建部分（实得 ' + r.lastScanIndexed + '）');
    const ok = await judgeIndexPhaseCancel(ROOT);
    assert.equal(ok.lastScanIndexed, ok.indexed, '阳性对照：原件上两者必须同数');
});
test('v3760 D4. 把作废的 pending 从 null 改成 0 ⇒ C2 同款判据必须转红', async () => {
    const A = "pending: null, complete: false, cancelledAt: 'index'";
    const dir = mutate('d4', [[GSE, A, "pending: 0, complete: false, cancelledAt: 'index'"]]);
    const r = await judgeIndexPhaseCancel(dir);
    assert.equal(r.pending, 0, '★ 「未知」被塌成「0」—— 界面会说「没有剩余」，而事实是不知道');
    assert.notEqual(r.pending, null, '★ 这一格必须与完成态的 0 不同形');
    const ok = await judgeIndexPhaseCancel(ROOT);
    assert.equal(ok.pending, null, '阳性对照：原件上索引段报 null');
});
test('v3760 D5. 抹掉取数耗时读数 ⇒ C6 同款判据必须转红', async () => {
    const A = 'const takeMs = Math.round((nowMs() - takeT0) * 100) / 100;';
    const dir = mutate('d5', [[GSE, A, 'const takeMs = NaN;']]);
    const r = await judgeTakeMs(dir);
    assert.equal(Number.isFinite(r.ms), false, '★ 耗时读数不在场时，判据必须能看见（实得 ' + r.ms + '）');
    const ok = await judgeTakeMs(ROOT);
    assert.ok(Number.isFinite(ok.ms), '阳性对照：原件上读数在场');
});
test('v3760 D6. 变异工具两向自证（锚点不存在 / 不唯一都必须抛）', () => {
    assert.throws(() => mutate('d6a', [[GSE, '不存在的锚点字符串_zzz', 'x']]), /须恰中 1 次/);
    assert.throws(() => mutate('d6b', [[GSE, 'const MAX_SCAN_PER_SOURCE', 'x']]), /须恰中 1 次/);
});
test('v3760 D7. 真仓只读：全部破坏跑完后，真仓判据必须仍然干净', async () => {
    const r = await judgeIndexPhaseCancel(ROOT);
    assert.equal(r.cancelledAt, 'index');
    assert.equal(r.pending, null);
    const raw = readAt(ROOT, GSE);
    assert.ok(raw.includes('const cancelIndex = opts.cancelIndex === true;'), '真仓开关仍在');
    assert.ok(raw.includes('ms: takeMs }'), '真仓取数耗时读数仍在');
});

/* ══════════════ E ── 端到端（控制器真接、真行为） ══════════════ */
test('v3760 E1. 全历史档点取消：在**索引阶段**就被受理（不是等整段建完）', async () => {
    const r = await judgeAppCancelIndex(ROOT, 10000);
    assert.equal(r.hasPromise, true, '全历史档必须返回承诺（分片入口）');
    assert.equal(r.cancelled, true, '代际推进后旧扫描必须自停');
    assert.equal(r.results, 0, '取消后不得给结果');
    assert.equal(r.cancelledAt, 'index', '★ 端到端必须在索引阶段受理（实得 ' + r.cancelledAt + '）—— 这正是本版要治的「等待期点取消没人理」');
    assert.equal(r.pending, null, '索引段作废的 pending 是未知（null）');
    assert.equal(r.complete, false);
});
test('v3760 E2. 负控制：控制器不传 cancelIndex ⇒ 同款端到端判据必须退回比中段', async () => {
    const A = '            cancelIndex: true,' + NL;
    const dir = mutate('e2', [[APP, A, '']], CLOSURE_APP);
    const r = await judgeAppCancelIndex(dir, 10000);
    assert.equal(r.cancelled, true, '前置：取消仍然生效（只是晚了一段）');
    assert.equal(r.cancelledAt, 'match', '★ 不传这一格时只能在比中段受理（实得 ' + r.cancelledAt + '）');
    assert.notEqual(r.pending, null, '★ 比中段作废的 pending 是已知数 —— 与索引段不同形');
    const ok = await judgeAppCancelIndex(ROOT, 10000);
    assert.equal(ok.cancelledAt, 'index', '阳性对照：原件上端到端必须落在索引段');
});

/* ══════════════ F ── 版本锚（下限形） ══════════════ */
test('v3760 F1. 版本锚（下限形）：三处同源且不低于 3.75.0', () => {
    const VNUM = (s) => Number(String(s).split('.').reduce((a, x) => a * 1000 + Number(x), 0));
    const man = JSON.parse(read('manifest.json'));
    const pkg = JSON.parse(read('package.json'));
    const codeVer = (/const ST_PHONE_VERSION = '([^']+)'/.exec(read('index.js')) || [])[1];
    assert.ok(codeVer, '入口版本常量在场');
    assert.equal(codeVer, man.version, '入口 == manifest');
    assert.equal(pkg.version, man.version, 'package == manifest');
    assert.ok(VNUM(man.version) >= VNUM('3.75.0'), '本套件自 3.75.0 起成立；当前 ' + man.version);
    /* 基线与**首测版**同源（不是「当前版本」这个移动靶）—— 与 tests/system-v327 E1 同款纪律。 */
    assert.ok(baselineFrozenAt(base, FIRST_MEASURED_AT), '基线必须冻结在首测版 ' + FIRST_MEASURED_AT);
    assert.equal(base.probe, PROBE, '基线必须指名探针路径');
});
