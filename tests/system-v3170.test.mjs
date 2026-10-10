// tests/system-v3170.test.mjs — 全历史检索（R-O1）+ 搜索轻依赖（R-O2）[v3.17.0]
//
//   本版做两件事，都在计划一（《优化提升计划.md》）的 A 批里：
//     ① R-O1「全历史搜到末楼」：搜索内核此前是**单档 600/源**（`MAX_SCAN_PER_SOURCE`）。
//        长会话里第 601 楼之后的正文**根本不在检索面里**，而且面板不会说「还有更多」——
//        于是「搜不到」被读成「没有」。本版改成两档：
//          · 快速档 = 旧行为（600/源，一字不改，默认）；
//          · 全历史档 = 20000/源、总封顶 60000，分片可中断、带进度与取消；
//        并把**展示段**（前 600 字，仍是 `body`）与**可检索段**（600–4000 字尾部余量，`bodyFull`）
//        拆开：搜得到开头、搜不到结尾——同一类病的另一个面。
//     ② R-O2「搜索移除重依赖」：`getCheatById` / `getModuleById` 把三本正文库
//        （cheats 1.60MB + dirtytalk 0.73MB + dirtytalk-corpus 0.15MB）拖进了搜索的导入闭包。
//        搜索只用元数据，改走同源轻索引（cheat-index / dirtytalk-index）。
//        实测：search-app 导入闭包 2,689,609 B → 198,077 B；未压缩字节 2,473,764 → 81,144。
//
//   覆盖：
//     A 结构面（两档常量在场 / 取数口不前移 / 新出口接线 / 依赖面收敛）
//     B 引擎行为面（两档预算 · 末楼到顶 · 规模档 · 展示段与可检索段分离 · 分片等价 · 取消 · 覆盖度）
//     C 控制器与视图面（同步/分片分流 · 代际作废 · 覆盖度出口 · 落地口两向）
//     D 轻索引行为面（与正文库逐字同源 · 未知 id · 闭包与零依赖）
//     E 负控制（真源码破坏 → 副本上重跑同款判据）
//     F 版本锚（下限形）
//
//   边界（诚实）：
//     · 计时读数（真宿主里 10000 楼扫多久）本套件**不测**，也不进判据 ——
//       本机读数不可复算，只登记 `tests/audit/long_chat_probe.cjs` 的分块纪律；
//     · 本套件不管「真浏览器里的滚动/渲染」，那是 `docs/runtime-verification-boundary.md` 的边界外。
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
const VIEW = 'apps/search/search-view.js';
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const readAt = (root, p) => fs.readFileSync(path.join(root, p), 'utf8');
const GSE_SRC = read(GSE);
const APP_SRC = read(APP);
const VIEW_SRC = read(VIEW);

/* ══════════════ 夹具 ══════════════ */
const MARK_HEAD = '头楼独有词';
const MARK_MID = '中楼独有词';
const MARK_TAIL = '末楼独有词';
/** 造 n 楼会话：首/中/末楼各埋一个独有词（只有这三个词能定位到「第几楼」）。 */
function mkChat(n) {
    const mid = Math.floor(n / 2);
    const out = [];
    for (let i = 0; i < n; i++) {
        const mark = i === 0 ? MARK_HEAD : (i === mid ? MARK_MID : (i === n - 1 ? MARK_TAIL : ''));
        out.push({
            is_user: i % 2 === 0,
            mes: (mark ? mark + ' ' : '') + '第 ' + (i + 1) + ' 楼正文 内容片段 ' + (i % 7),
            send_date: 1758000000000 + i * 1000
        });
    }
    return out;
}
/** 小手机面板壳：只提供 setContent / screen.querySelector（不渲染真 DOM）。 */
function mkShell() {
    const screen = { querySelector: () => null, querySelectorAll: () => [] };
    return { screen, html: '', setContent(h) { this.html = String(h); } };
}
/** 一条「1200 楼」源：快速档只能索引前 600 楼，末楼词只在全历史档可见。 */
function bigSource(g, n = 1200) {
    return { id: 'tavern', label: '酒馆正文', icon: 'DOC', appId: '', weight: 1,
        items: () => mkChat(n).map((m, i) => ({
            title: (m.is_user ? '我' : 'AI') + ' · 第 ' + (i + 1) + ' 楼',
            body: m.mes, ts: m.send_date, icon: 'DOC', meta: { floor: i }
        })) };
}
const loadGse = (root) => import(pathToFileURL(path.join(root, GSE)).href);
const loadApp = (root) => import(pathToFileURL(path.join(root, APP)).href);

/* ══════════════ 同一份判据（原件与破坏副本上跑的是它们） ══════════════ */
/** R1：两档预算 —— 快速仍是 600，全历史铺满；且全扫不污染快速档缓存。 */
async function judgeTwoTier(root, n = 1000) {
    const g = await loadGse(root);
    const eng = new g.GlobalSearchEngine({ sources: [g.makeTavernSource({ chat: mkChat(n) })] });
    const quickN = eng.build().length;
    const fullN = eng.build({ full: true }).length;
    const quickAfterFull = eng.build().length;
    const tailQuick = eng.query(MARK_TAIL).results.length;
    const tailMid = eng.query(MARK_MID, { full: true }).results.length;
    const tailFull = eng.query(MARK_TAIL, { full: true }).results.length;
    const headFull = eng.query(MARK_HEAD, { full: true }).results.length;
    return { quickN, fullN, quickAfterFull, tailQuick, tailMid, tailFull, headFull };
}
/** R2：规模档 —— 分片扫到末楼，进度真报，覆盖度落成 complete。 */
async function judgeScale(root, n) {
    const g = await loadGse(root);
    const eng = new g.GlobalSearchEngine({ sources: [g.makeTavernSource({ chat: mkChat(n) })] });
    const seen = [];
    const r = await eng.searchAll(MARK_TAIL, { full: true, onProgress: (p) => seen.push(p.processed) });
    return {
        hits: r.results.length, scanned: r.scanned, indexLen: r.scope.indexLen,
        complete: r.scope.complete, pending: r.scope.pending,
        chunks: seen.length, monotonic: seen.every((v, i) => i === 0 || v >= seen[i - 1]),
        lastProgress: seen.length ? seen[seen.length - 1] : -1
    };
}
/** R3：展示段与可检索段分离 —— 尾部命中且 `body` 仍是前 600 字。 */
async function judgeTailBody(root) {
    const g = await loadGse(root);
    const long = '前段填充'.repeat(150) + '尾段独有词' + '后缀填充'.repeat(150);
    const eng = new g.GlobalSearchEngine({ sources: [{ id: 'tavern', label: 'T', icon: 'T', items: () => [{ title: '第 1 楼', body: long }] }] });
    const quick = eng.query('尾段独有词');
    const it = quick.results[0];
    return {
        raw: long.length,
        hits: quick.results.length,
        bodyLen: it ? it.body.length : -1,
        bodyHasWord: it ? it.body.includes('尾段独有词') : null,
        hasFull: it ? (typeof it.bodyFull === 'string' && it.bodyFull.length > 0) : false,
        snippetHasWord: it ? String(it.snippet || '').includes('尾段独有词') : false
    };
}
/** R4：分片只影响节奏、不影响结果集 —— 与同步全历史逐条同结果。 */
async function judgeChunkEquiv(root, n = 5000) {
    const g = await loadGse(root);
    const eng = new g.GlobalSearchEngine({ sources: [g.makeTavernSource({ chat: mkChat(n) })] });
    const sync = eng.query('楼正文', { full: true });
    const chunked = await eng.searchAll('楼正文', { full: true });
    const ids = (r) => r.results.map((x) => x.sourceId + '#' + x.title).join('|');
    return { sameTotal: sync.total === chunked.total, sameIds: ids(sync) === ids(chunked), total: sync.total, scanned: chunked.scanned };
}
/** R5：取消 —— `isCancelled` 一真即返回空结果集（半份结果比空结果更糟）。 */
/* 取消点必须是「已经扫到标记楼、后面还有下一轮」的那个边界：
 *   本夹具 10000 楼 / 片 2000，MARK_MID 在 index 5000（片 3 扫到），
 *   而 MARK_TAIL 在 index 9999（片 5，且那是最后一轮 —— 之后没有取消检查点了）。
 *   所以默认 cancelAt=4（第 4 次检查 = 片 4 开工前）：此时 hits 已经有 1 条，
 *   「破坏后泄露半份」才测得到。 */
async function judgeCancel(root, cancelAt = 4) {
    const g = await loadGse(root);
    let calls = 0;
    const eng = new g.GlobalSearchEngine({ sources: [g.makeTavernSource({ chat: mkChat(10000) })] });
    const r = await eng.searchAll(MARK_MID, { full: true, isCancelled: () => { calls += 1; return calls >= cancelAt; } });
    const eng2 = new g.GlobalSearchEngine({ sources: [g.makeTavernSource({ chat: mkChat(10000) })] });
    const ok = await eng2.searchAll(MARK_MID, { full: true });
    return {
        cancelled: r.cancelled === true, results: r.results.length, total: r.total,
        scanned: r.scanned, complete: r.scope.complete, calls: calls,
        liveHits: ok.results.length, liveCancelled: ok.cancelled === true
    };
}
/**
 * R5b：**App 侧代际守卫**的专属窗口（引擎侧取消够不着它）。
 * 引擎的 isCancelled 与 App 的 .then 守卫看的是同一个代际：
 *   在分片边界上取消时引擎自己就返回 cancelled:true，把 App 守卫删掉判据照旧为绿。
 * 真正能把两者分开的窗口只有一个：**分片循环的最后一次进度回调之后** ——
 *   检查取消(1) → 扫完本片 → onProgress(processed===total) → 循环条件为假 → 返回完整结果，
 *   此后没有任何取消检查。在 onProgress 里换代际，引擎交出的就是非取消的完整旧结果，
 *   能不能丢掉它，全靠 App 的 .then 守卫。夹具 800 楼（< 片大小 2000 = 单帧），末楼埋词。
 */
async function judgeAppGuard(root, n = 800) {
    const { SearchApp } = await loadApp(root);
    const restore = mkHostChat(n);
    try {
        const app = new SearchApp(mkShellApp(), mkStorage());
        app.toggleFullMode();
        const b = app.search(MARK_TAIL, { onProgress: (p) => { if (p.processed >= p.total) app.invalidateAll(); } });
        const genAtStart = b.gen;
        const r = await b.promise;
        return {
            moved: app._scanGen !== genAtStart,
            dropped: !!(r && r.cancelled === true && r.results.length === 0),
            leaked: !!(r && r.cancelled !== true && r.results.length > 0)
        };
    } finally { restore(); }
}
/** R6：覆盖度声明 —— 谁被截、谁超长、扫完没有，都必须说得出。 */
async function judgeScope(root) {
    const g = await loadGse(root);
    const eng = new g.GlobalSearchEngine({ sources: [g.makeTavernSource({ chat: mkChat(1200) })] });
    const quick = eng.query('楼正文');
    const full = eng.query('楼正文', { full: true });
    const eng2 = new g.GlobalSearchEngine({ sources: [{ id: 'tavern', label: 'T', icon: 'T', items: () => [{ title: 'x', body: '甲'.repeat(5000) }] }] });
    eng2.build();
    const s3 = eng2._scope(false, {}, 1);
    return {
        quickMode: quick.scope.mode, quickTrunc: quick.scope.truncatedSources.includes('tavern'),
        quickScanned: quick.scope.scannedBySource.tavern, quickIndexLen: quick.scope.indexLen,
        fullMode: full.scope.mode, fullTrunc: full.scope.truncatedSources.length,
        fullComplete: full.scope.complete, fullPending: full.scope.pending, fullIndexLen: full.scope.indexLen,
        bodyTrunc: s3.bodyTruncatedSources.includes('tavern')
    };
}

/* ══════════════ A ── 结构面 ══════════════ */
function importClosure(root, entry) {
    const seen = new Set();
    let bytes = 0;
    const stack = [entry];
    while (stack.length) {
        const f = stack.pop();
        if (seen.has(f)) continue;
        seen.add(f);
        let src = '';
        try { src = readAt(root, f); } catch (_e) { continue; }
        bytes += Buffer.byteLength(src, 'utf8');
        const dir = path.posix.dirname(f);
        const re = /import\s+(?:[^'"]*?from\s+)?['"]([^'"]+)['"]/g;
        let m;
        while ((m = re.exec(src))) {
            if (!m[1].startsWith('.')) continue;
            stack.push(path.posix.normalize(path.posix.join(dir, m[1])));
        }
    }
    return { files: [...seen], bytes };
}
test('v3170 A1. 两档预算与分片常量在场（旧名旧值一字不改）', () => {
    assert.match(GSE_SRC, /const MAX_SCAN_PER_SOURCE = 600;/, '快速档预算必须仍是 600（tests/system-v327 锁的就是它）');
    assert.match(GSE_SRC, /const MAX_SCAN_PER_SOURCE_FULL = 20000;/, '全历史档预算');
    assert.match(GSE_SRC, /const MAX_INDEX_FULL = 60000;/, '全历史总封顶');
    assert.match(GSE_SRC, /const SCAN_CHUNK = 2000;/, '分片粒度');
    assert.match(GSE_SRC, /const BODY_DISPLAY_CAP = 600;/, '展示段上限（与旧行为同值）');
    assert.match(GSE_SRC, /const BODY_SEARCH_CAP = 4000;/, '可检索段上限');
});
test('v3170 A2. 取数口不前移截断（截断只能在引擎里做，因为那里才能声明覆盖度）', () => {
    assert.match(GSE_SRC, /items: \(\) => ctx\.chat\.map\(\(m, i\) => \(\{/, '酒馆正文源必须仍然全表现取（预算在下游）');
    for (const bad of ['chat.slice(-', 'makeTavernSourceLazy', 'lazyItems', 'takeFromTail', 'headSlice']) {
        assert.equal(GSE_SRC.includes(bad), false, '不得引入前移截断标记：' + bad);
    }
});
test('v3170 A3. 新出口齐备（两档 build / 评分 / 覆盖度 / 分片扫描）', () => {
    assert.match(GSE_SRC, /build\(opts = \{\}\) \{/);
    assert.match(GSE_SRC, /_score\(it, q\) \{/);
    assert.match(GSE_SRC, /_scope\(full, opts, indexLen\) \{/);
    assert.match(GSE_SRC, /searchAll\(query, opts = \{\}\) \{/);
    assert.match(GSE_SRC, /bodyFull: bodyFull,/, '条目必须携带可检索段');
    assert.match(GSE_SRC, /scope: scope/, '返回体必须带覆盖度');
});
test('v3170 A4. 控制器与视图接线（代际 / 模式切换 / 取消 / 占位）', () => {
    assert.match(APP_SRC, /this\.invalidateAll\(\);/, 'render 必须走「失效 + 作废扫描」的唯一出口');
    assert.match(APP_SRC, /toggleFullMode\(\) \{/);
    assert.match(APP_SRC, /cancelToken\(gen\) \{/);
    assert.match(APP_SRC, /newQueryToken\(\) \{/);
    assert.match(VIEW_SRC, /#gs-mode/, '视图必须有快速/全历史切换按钮');
    assert.match(VIEW_SRC, /#gs-cancel/, '视图必须有取消按钮');
    assert.match(VIEW_SRC, /正在检索/, '全历史档开扫时必须有占位文案（不能空着等）');
});
test('v3170 A5. 依赖面收敛（三正文库不再进搜索闭包）', () => {
    /* 判据只看 import 语句（不看正文文本）：
     *   这条误判本身就是一个教训—— 初版用 `GSE_SRC.includes('cheat-data.js')`，
     *   结果被 R-O2 自己写的注释（“那条边会连带 `data/cheats.js` 进导入闭包”）而误判为红。
     *   同族记录见 scripts/weak-coercion-audit.mjs 的 W1（判据必须剔除注释与字符串）。 */
    assert.equal(/from\s+['"][^'"]*cheat-data\.js['"]/.test(GSE_SRC), false, '搜索内核不得再 import cheat-data.js');
    assert.equal(/from\s+['"][^'"]*dt-data\.js['"]/.test(GSE_SRC), false, '搜索内核不得再 import dt-data.js');
    assert.equal(/from\s+['"][^'"]*data\/cheats\.js['"]/.test(GSE_SRC), false, '也不得直接引正文库本体');
    assert.equal(/from\s+['"][^'"]*data\/dirtytalk\.js['"]/.test(GSE_SRC), false);
    assert.match(GSE_SRC, /from '\.\.\/\.\.\/data\/cheat-index\.js'/);
    assert.match(GSE_SRC, /from '\.\.\/\.\.\/data\/dirtytalk-index\.js'/);
    const c = importClosure(ROOT, APP);
    for (const heavy of ['data/cheats.js', 'data/dirtytalk.js', 'data/dirtytalk-corpus.js', 'apps/cheat/cheat-data.js', 'apps/dirtytalk/dt-data.js']) {
        assert.equal(c.files.includes(heavy), false, '搜索 App 导入闭包不得含 ' + heavy);
    }
    assert.ok(c.bytes < 400000, '闭包字节必须到 400KB 以下（实测 ' + c.bytes + '）');
});

/* ══════════════ B ── 引擎行为面 ══════════════ */
test('v3170 B1. 两档预算：快速 600 / 全历史铺满，且全扫不污染快速档缓存', async () => {
    const r = await judgeTwoTier(ROOT, 1000);
    assert.equal(r.quickN, 600, '快速档预算仍是 600/源');
    assert.equal(r.fullN, 1000, '全历史档要铺满 1000 楼');
    assert.equal(r.quickAfterFull, 600, '全扫不得写进快速档缓存（否则快速档被上一次全扫污染）');
    assert.equal(r.tailQuick, 0, '快速档找不到末楼词（这正是本版要治的现象）');
    assert.equal(r.tailFull, 1, '全历史档必须找得到末楼词');
    assert.equal(r.headFull, 1, '首楼词也要在');
    assert.equal(r.tailMid, 1, '中楼词也要在');
});
test('v3170 B2. 规模档：5000 / 10000 楼的末楼词都能扫到，进度真报且完成态落成', async () => {
    for (const n of [5000, 10000]) {
        const r = await judgeScale(ROOT, n);
        assert.equal(r.hits, 1, n + ' 楼：末楼词必须命中');
        assert.equal(r.scanned, n, n + ' 楼：必须扫到底（实得 ' + r.scanned + '）');
        assert.equal(r.indexLen, n);
        assert.equal(r.complete, true, n + ' 楼：完成态必须是 true');
        assert.equal(r.pending, 0);
        assert.ok(r.chunks >= 2, n + ' 楼：分片执行必须真发生（实得 ' + r.chunks + ' 片）');
        assert.ok(r.monotonic, '进度必须单调不退');
        assert.equal(r.lastProgress, n);
    }
});
test('v3170 B3. 展示段与可检索段分离：尾部命中、body 仍是前 600 字', async () => {
    const r = await judgeTailBody(ROOT);
    assert.ok(r.raw > 1200, '前置：测试用长文必须真的超过可检索上限之外的部分（' + r.raw + '）');
    assert.equal(r.hits, 1, '尾部词必须命中（以前搜不到）');
    assert.equal(r.bodyLen, 600, 'body 必须仍是前 600 字（与旧行为逐字同值）');
    assert.equal(r.bodyHasWord, false, '尾部词不得出现在展示段里（否则这条判据测的不是分离）');
    assert.equal(r.hasFull, true, '可检索段必须在场');
    assert.equal(r.snippetHasWord, true, '摘要应在可检索段上取（命中处可见）');
});
test('v3170 B4. 分片只影响节奏、不影响结果集', async () => {
    const r = await judgeChunkEquiv(ROOT, 5000);
    assert.ok(r.total >= 5000, '命中数应该覆盖全部 5000 楼（' + r.total + '）');
    assert.equal(r.sameTotal, true, '分片与同步的 total 必须相等');
    assert.equal(r.sameIds, true, '分片与同步的结果序列必须相等');
    assert.equal(r.scanned, 5000);
});
test('v3170 B5. 取消：一旦作废就不给半份结果（半份比空更糟）', async () => {
    const r = await judgeCancel(ROOT);
    assert.equal(r.cancelled, true);
    assert.equal(r.results, 0, '取消后不得给任何结果');
    assert.equal(r.total, 0);
    assert.ok(r.scanned >= 6000 && r.scanned < 10000, '取消应在中途生效（实得 ' + r.scanned + '）');
    assert.equal(r.complete, false, '未完成态必须如实报');
    assert.equal(r.liveHits, 1, '正控：不取消时标记楼词必须命中');
    assert.equal(r.liveCancelled, false);
});
test('v3170 B6. 覆盖度声明：谁被截、谁超长、扫完没有，都说得出', async () => {
    const r = await judgeScope(ROOT);
    assert.equal(r.quickMode, 'quick');
    assert.equal(r.quickTrunc, true, '快速档必须如实报「这个源被截了」');
    assert.equal(r.quickScanned, 600);
    assert.equal(r.quickIndexLen, 600);
    assert.equal(r.fullMode, 'full');
    assert.equal(r.fullTrunc, 0, '1200 楼在 20000/源预算内，不得误报截断');
    assert.equal(r.fullComplete, true);
    assert.equal(r.fullIndexLen, 1200);
    assert.equal(r.bodyTrunc, true, '超长正文必须如实报「单条仅检索前 4000 字」');
});

test('v3170 B7. App 侧代际守卫：最后一帧换代际时，旧完整结果必须整份丢掉（引擎够不着）', async () => {
    const r = await judgeAppGuard(ROOT);
    assert.equal(r.moved, true, '前置：代际必须真的在扫描途中被换掉（否则探针测的不是这件事）');
    assert.equal(r.dropped, true, '旧代际的完整结果必须被 App 丢掉');
    assert.equal(r.leaked, false, '不得把旧命中泄露给调用方');
});
test('v3170 B8. [v3.60.0 · 计划 O2] 全历史扫描片间真的让出事件循环', async () => {
    /* 守的是 O2 本体：片间让出必须是**宏任务**。旧实现（按 2000/片循环但全程同步）
     *   零延迟计时器要等函数返回才轮得到，本判据必为 0 次；让出退化成微任务
     *   （await Promise.resolve()）同样为 0 —— 负控制 E9 就是把让出指令改回去。 */
    const g = await loadGse(ROOT);
    const eng = new g.GlobalSearchEngine({ sources: [g.makeTavernSource({ chat: mkChat(10000) })] });
    let ticks = 0;
    const timer = setInterval(() => { ticks += 1; }, 1);
    let r = null;
    try { r = await eng.searchAll(MARK_MID, { full: true }); } finally { clearInterval(timer); }
    assert.equal(r.results.length, 1, '让出不得改变结果集（中楼词仍须命中）');
    assert.equal(r.scanned, 10000, '让出不得少扫（仍须扫到底）');
    assert.ok(ticks >= 1, '扫描期间零延迟计时器必须至少跑到一次（同步跑完必为 0，实得 ' + ticks + '）');
});

/* ══════════════ C ── 控制器与视图面 ══════════════ */
/** 小仓库：把搜索链路整条复制过去（负控制副本与行为判据共用一份）。 */
const CLOSURE = [
    GSE, APP, VIEW, 'config/world-bridge.js',
    // [v3.66.0 · X2] 搜索内核新增两个 config 依赖（跨 App 靶心协议件 / 数值门）：
    //   闭包不带它们，副本 import 直接 ERR_MODULE_NOT_FOUND，
    //   负控制就变成「因缺文件而红」而不是「因破坏而红」。
    'config/open-ref.js', 'config/num-gate.js',
    'config/provenance-graph.js', 'config/context-compose.js', 'config/knowledge-contract.js', 'config/social-knowledge-bridge.js', 'config/story-clock.js',
    // [v3.66.0 · X2] 视图侧新增详情荷载装配件依赖（target_kind 表挂在它上面）
    'config/app-open-detail.js',
    'data/cheat-index.js', 'data/dirtytalk-index.js',
    // 正文库只为 D1 同源判据与轻索引对照：它们**不在**搜索导入闭包里（见 A5）
    'data/cheats.js', 'data/dirtytalk.js', 'data/dirtytalk-corpus.js'
];
function mkTree(tag) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rp-v3170-' + tag + '-'));
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
/** 一条「1200 楼 + 一条可跳转日记」的宿主：既测得到末楼，也测得到分组/跳转。 */
function mkStorage(extra = {}) {
    const m = new Map(Object.entries(Object.assign({
        diary_entries: [{ title: '日记标题', date: '9月1日', content: '日记正文独有词', author: '我', createdAt: 1758000000000 }]
    }, extra)));
    return { get: (k, d = null) => (m.has(k) ? m.get(k) : d), set: (k, v) => m.set(k, v), remove: (k) => m.delete(k), _m: m };
}
function mkHostChat(n) {
    const prevWin = globalThis.window;
    globalThis.window = Object.assign(globalThis.window || {}, {
        SillyTavern: { getContext: () => ({ chat: mkChat(n) }) },
        VirtualPhone: { storage: null }
    });
    return () => { globalThis.window = prevWin; };
}
const mkShellApp = () => {
    const screen = { querySelector: () => null, querySelectorAll: () => [] };
    return { screen, html: '', setContent(h) { this.html = String(h); } };
};

/** C1：快速档与全历史档走**不同路径**，且快速档行为与旧版逐字一致。 */
async function judgeDispatch(root) {
    const { SearchApp } = await loadApp(root);
    const restore = mkHostChat(1000);
    try {
        const app = new SearchApp(mkShellApp(), mkStorage());
        const a = app.search('日记正文独有词');
        const quickSync = !!(a && a.result && !a.promise);
        const quickHits = a && a.result ? a.result.results.length : -1;
        app.toggleFullMode();
        const b = app.search('日记正文独有词');
        const fullAsync = !!(b && !b.result && b.promise && typeof b.promise.then === 'function');
        const gen = b ? b.gen : -1;
        const r = b && b.promise ? await b.promise : null;
        app.toggleFullMode();
        const c = app.search('日记正文独有词');
        return {
            quickSync, quickHits, fullAsync, gen,
            fullHits: r ? r.results.length : -1,
            backQuickSync: !!(c && c.result && !c.promise),
            scanGen: app._scanGen, scanning: app._scanning
        };
    } finally { restore(); }
}
/** C2：本代扫描一旦作废，旧结果**整份丢弃**（不报错、只错结果的那种病）。 */
async function judgeGeneration(root) {
    const { SearchApp } = await loadApp(root);
    const restore = mkHostChat(10000);
    try {
        const app = new SearchApp(mkShellApp(), mkStorage());
        app.toggleFullMode();
        const a = app.search('末楼独有词');
        const k1 = a.gen + 1;
        app.newQueryToken();                      // 换关键词：上一轮作废
        const r1 = await a.promise;
        const k2 = app._scanGen + 1;
        const b = app.search('末楼独有词');   // 真正取消
        const dbgAfterInvalidate = app._scanGen;
        const dbgGenB = b.gen;
        app.invalidateAll();                      // 数据变了（编辑/删楼/换会话）
        const r2 = await b.promise;
        const engineCancelled = await app.engine.searchAll('末楼独有词', { full: true, isCancelled: () => true });
        return {
            dbg: JSON.stringify({ gi: dbgAfterInvalidate, gb: dbgGenB, isFn: typeof app.engine.searchAll,
                r1: r1 && { c: r1.cancelled, n: r1.results && r1.results.length },
                r2: r2 && { c: r2.cancelled, n: r2.results && r2.results.length }, k1: k1, k2: k2 }),
            staleDropped: !!(r1 && r1.cancelled === true && r1.results.length === 0),
            invalidatedDropped: !!(r2 && r2.cancelled === true && r2.results.length === 0),
            k1: k1, k2: k2, engineCancelled: engineCancelled.cancelled === true
        };
    } finally { restore(); }
}
/** C3：覆盖度是**出口** —— 页头 / 空态 / 告警都必须带上它。 */
async function judgeScopeSurface(root) {
    const { SearchApp } = await loadApp(root);
    const restore = mkHostChat(1200);
    try {
        const app = new SearchApp(mkShellApp(), mkStorage());
        const quick = app.scopeSummary();
        app.toggleFullMode();
        const full = app.scopeSummary();
        app.toggleFullMode();
        const v = app.view;
        v._keyword = '日记正文独有词';
        v._result = null;
        const html = v._resultsHtml();
        v._keyword = '肯定搜不到的词儿啊';
        v._result = null;
        const empty = v._resultsHtml();
        return {
            quick, full,
            hasCountScope: /已检索 \d+ 条记录[^<]*快速档/.test(html),
            // 空态必须带**档位**：只认「已检索 N 条」与范围无关（N 永远在），是弱判据
            emptyHasScope: /已检索 \d+ 条记录（\d+ 个来源）[^<]*快速档/.test(empty),
            emptyHasTrunc: /个来源只索引了前 600 条/.test(empty),
            modeBtn: /gs-mode/.test(html)
        };
    } finally { restore(); }
}
/** C4：落地面 —— 扫描结果要真的进结果区，取消不给半份。 */
async function judgeSurfaceLive(root) {
    const { SearchApp } = await loadApp(root);
    const restore = mkHostChat(10000);
    const box = { innerHTML: '' };
    try {
        const app = new SearchApp(mkShellApp(), mkStorage());
        app.phoneShell.screen.querySelector = (sel) => (sel === '#gs-results' ? box : null);
        app.phoneShell.screen.querySelectorAll = () => [];
        app.toggleFullMode();
        const v = app.view;
        v._keyword = '末楼独有词';
        v._resultsHtml();
        /* [v3.60.0 · 计划 O2] 等待口径随施工改：原先固定「等 2 个 setImmediate」，
         *   那等于把「全历史扫描同步跑完」当前提。本版 O2 正是要打破它 ——
         *   片间让出宏任务后，完成时刻从「约 2 个 tick」变成「约 2 + 片数」个 tick。
         *   本判据的本意是「结果真的落到结果区」，故改为**有界真等**（上限 4s）：
         *   不是放宽，是把「等多久」换成「等它到」。 */
        const t0 = Date.now();
        while (Date.now() - t0 < 4000 && !(/gs-item/.test(box.innerHTML) && /末楼独有词/.test(box.innerHTML))) {
            await new Promise((r) => setTimeout(r, 10));
        }
        const landed = box.innerHTML;
        const hasHit = /末楼独有词/.test(landed) && /gs-item/.test(landed);
        // 取消后：旧结果不得残留
        const v2 = app.view;
        v2._keyword = '末楼独有词';
        v2._scanning = { gen: app._scanGen, kw: v2._keyword };
        v2.renderResults(app._scanGen - 9999, { cancelled: true, results: [] }, v2._keyword);
        const zombieState = v2._scanning !== null;
        return { hasHit: hasHit, landedLen: landed.length, zombieVerdict: zombieState };
    } finally { restore(); }
}
test('v3170 C1. 分流：快速档同步、全历史档分片，切回来仍是同步', async () => {
    const r = await judgeDispatch(ROOT);
    assert.equal(r.quickSync, true, '快速档必须同步返回（与旧行为一致）');
    assert.equal(r.quickHits, 1);
    assert.equal(r.fullAsync, true, '全历史档必须走分片（带 promise）');
    assert.equal(r.fullHits, 1, '分片结果必须真的回到');
    assert.equal(r.backQuickSync, true, '切回快速档必须恢复同步');
    assert.equal(r.scanning, false, '扫描完必须清记账');
});
test('v3170 C2. 代际：换词 / 数据变了都作废跑着的扫描，旧命中整份丢弃', async () => {
    const r = await judgeGeneration(ROOT);
    console.error('DBG', r.dbg);
    assert.equal(r.staleDropped, true, '换关键词后旧扫描结果必须整份丢弃（不得写回面板）');
    assert.equal(r.invalidatedDropped, true, '数据变了后旧扫描结果必须整份丢弃');
    assert.ok(r.k2 > r.k1, '每一次作废都要真的换代（' + r.k1 + ' → ' + r.k2 + '）');
    assert.equal(r.engineCancelled, true, '引擎侧 isCancelled 也要能单独生效');
});
test('v3170 C3. 覆盖度出口：页头、结果区与空态都必须带上「扫到哪儿了」', async () => {
    const r = await judgeScopeSurface(ROOT);
    assert.match(r.quick, /快速/, '快速档页头必须标明档位：' + r.quick);
    assert.match(r.quick, /有更多未索引/, '1200 楼在快速档必须如实报「有更多未索引」：' + r.quick);
    assert.match(r.full, /全历史/, '全历史档页头必须标明档位：' + r.full);
    assert.equal(r.hasCountScope, true, '结果区计数行必须带档位：' + JSON.stringify(r));
    assert.equal(r.emptyHasScope, true, '空态必须如实报「已检索 N 条（什么范围）」（不能把没扫到显示成没命中）');
    assert.equal(r.emptyHasTrunc, true, '空态还必须告诉用户「切全历史可继续」');
});
test('v3170 C4. 落地面：分片结果真进结果区，旧代际的落地请求被拒', async () => {
    const r = await judgeSurfaceLive(ROOT);
    assert.equal(r.hasHit, true, '全历史扫到的末楼必须真的落到结果区（' + r.landedLen + ' 字）');
    assert.equal(r.zombieVerdict, true, '旧代际的 renderResults 必须被拒（不得把 _scanning 清成 null）');
});

/* ══════════════ D ── 轻索引行为面 ══════════════ */
async function judgeLightIndex(root) {
    const load = (rel) => import(pathToFileURL(path.join(root, rel)).href);
    const ci = (await load('data/cheat-index.js')).cheatIndex;
    const cp = (await load('data/cheats.js')).cheatPacks;
    const di = (await load('data/dirtytalk-index.js')).dirtyTalkIndex;
    const dm = (await load('data/dirtytalk.js')).dirtyTalkModules;
    const byId = (a) => new Map(a.map((x) => [String(x.id), x]));
    const A = byId(ci), B = byId(cp), C = byId(di), D = byId(dm);
    let cheatDiff = 0, dtDiff = 0;
    if (A.size !== B.size) cheatDiff++;
    if (C.size !== D.size) dtDiff++;
    const CK = ["name", "quality", "type", "desc"];
    const DK = ["name", "cat", "label", "tier", "desc"];
    for (const [id, x] of A) {
        const y = B.get(id);
        if (!y) { cheatDiff++; continue; }
        for (const k of CK) if (String(x[k]) !== String(y[k])) cheatDiff++;
    }
    for (const [id, x] of C) {
        const y = D.get(id);
        if (!y) { dtDiff++; continue; }
        for (const k of DK) if (String(x[k]) !== String(y[k])) dtDiff++;
    }
    return { cheatCount: ci.length, packCount: cp.length, dtCount: di.length, modCount: dm.length, cheatDiff, dtDiff };
}
test('v3170 D1. 轻索引与正文库逐字同源（id 集合 + 搜索用到的每个字段）', async () => {
    const r = await judgeLightIndex(ROOT);
    assert.equal(r.cheatCount, r.packCount, '武库轻索引条数必须等于正文库');
    assert.equal(r.dtCount, r.modCount, '撩语轻索引条数必须等于正文库');
    assert.equal(r.cheatDiff, 0, '武库搜索字段差异必须为 0（实得 ' + r.cheatDiff + '）');
    assert.equal(r.dtDiff, 0, '撩语搜索字段差异必须为 0（实得 ' + r.dtDiff + '）');
});
test('v3170 D2. 两条源走 buildDefaultSources 真跑：命中、未知 id 如实丢弃', async () => {
    const g = await loadGse(ROOT);
    const ci = (await import(pathToFileURL(path.join(ROOT, 'data/cheat-index.js')).href)).cheatIndex;
    const di = (await import(pathToFileURL(path.join(ROOT, 'data/dirtytalk-index.js')).href)).dirtyTalkIndex;
    const c0 = ci[0], d0 = di[0];
    const store = new Map([
        ['cheat_state_v1', { installed: [c0.id, 'no_such_id_zzz'] }],
        ['dt_state_v1', { installed: [d0.id, 'no_such_id_zzz'] }]
    ]);
    const storage = { get: (k, dv = null) => (store.has(k) ? store.get(k) : dv) };
    const srcs = g.buildDefaultSources(storage, {});
    const eng = new g.GlobalSearchEngine({ sources: srcs });
    const all = eng.build();
    const cheatItems = all.filter((x) => x.sourceId === 'cheat');
    const dtItems = all.filter((x) => x.sourceId === 'dirtytalk');
    assert.equal(cheatItems.length, 1, '未知 id 必须如实丢弃（实得 ' + cheatItems.length + '）');
    assert.equal(dtItems.length, 1, '撚语同理');
    assert.equal(cheatItems[0].title, String(c0.name), '武库标题必须等于索引里的名字');
    assert.ok(cheatItems[0].body.includes(String(c0.type)), '武库正文要带类型');
    assert.equal(dtItems[0].title, String(d0.name));
    const hit = eng.query(String(c0.name)).results.filter((x) => x.sourceId === 'cheat');
    assert.equal(hit.length, 1, '按名字搜必须命中那条武库');
});
test('v3170 D3. 生成侧同源 + 零新增 npm 依赖', () => {
    const gen = read('scripts/gen-cheats.mjs');
    assert.ok(/cheat-index\.js/.test(gen), '轻索引必须由同一脚本产出（否则两份真相会鞘）');
    const pkg = JSON.parse(read('package.json'));
    assert.deepEqual(pkg.dependencies || {}, {}, '生产包不得新增运行时依赖（本仓刻意零依赖）');
    assert.deepEqual(pkg.devDependencies || {}, {}, '连 dev 依赖也不得新增');
});

/* ══════════════ E ── 负控制（真源码破坏 → 副本上重跑同款判据） ══════════════ */
test('v3170 E1. 破坏「全历史不进快速档缓存」⇒ B1 同款判据必须转红', async () => {
    const dir = mutate('e1', [[GSE, '        if (!full) this._index = out;', '        this._index = out;']]);
    const r = await judgeTwoTier(dir, 1000);
    assert.notEqual(r.quickAfterFull, 600, '★ 破坏后快速档必须被全扫污染（实得 ' + r.quickAfterFull + '）');
    assert.equal(r.fullN, 1000, '对照：全历史档本身仍须铺满');
    const ok = await judgeTwoTier(ROOT, 1000);
    assert.equal(ok.quickAfterFull, 600, '阳性对照：原件上同款判据必须为绿');
});
test('v3170 E2. 破坏「分片遇到取消即返空结果」⇒ B5 同款判据必须转红', async () => {
    const dir = mutate('e2', [[GSE, "                    query: '', results: [], groups: [], total: 0, scanned: processed,", "                    query: q, results: hits.slice(), groups: [], total: hits.length, scanned: processed,"]]);
    // 必须在「已收到命中之后」取消（cancelAt=6 = 全部扫完那一帧）
    const r = await judgeCancel(dir, 4);
    assert.notEqual(r.results, 0, '★ 破坏后取消会泄露半份结果（实得 ' + r.results + ' 条）');
    assert.equal(r.cancelled, true, '取消标志仍在');
    const ok = await judgeCancel(ROOT, 4);
    assert.equal(ok.results, 0, '阳性对照：原件上取消必须给空');
});
test('v3170 E3. 破坏「展示段与可检索段分离」⇒ B3 同款判据必须转红', async () => {
    const dir = mutate('e3', [[GSE, "                        bodyFull: bodyFull,", "                        bodyFull: '',"]]);
    const r = await judgeTailBody(dir);
    assert.equal(r.hits, 0, '★ 破坏后尾部词必须搜不到（实得 ' + r.hits + '）');
    const ok = await judgeTailBody(ROOT);
    assert.equal(ok.hits, 1, '阳性对照：原件上尾部词必须命中');
});
test('v3170 E4. 破坏「录入截断如实声明」⇒ B6 同款判据必须转红', async () => {
    const dir = mutate('e4', [[GSE, "                if (capped) cappedSources.push(src.id);", "                if (false) cappedSources.push(src.id);"]]);
    const r = await judgeScope(dir);
    assert.equal(r.quickTrunc, false, '★ 破坏后「被截了」必须不再如实报（实得 ' + r.quickTrunc + '）');
    const ok = await judgeScope(ROOT);
    assert.equal(ok.quickTrunc, true, '阳性对照：原件必须如实报截断');
});
test('v3170 E5. 破坏「App 的代际作废」⇒ C2 同款判据必须转红', async () => {
    const dir = mutate('e5', [[APP, "            if (self._scanGen !== gen) return { cancelled: true, results: [], scope: r && r.scope };", "            if (false) return { cancelled: true, results: [], scope: r && r.scope };"]]);
    const r = await judgeAppGuard(dir);
    assert.equal(r.moved, true, '前置：代际确实被换掉（破坏的是换掉之后怎么办，不是换没换）');
    assert.equal(r.leaked, true, '★ 破坏后旧命中必须泄露给调用方（实得 leaked=' + r.leaked + ' dropped=' + r.dropped + '）');
    const ok = await judgeAppGuard(ROOT);
    assert.equal(ok.dropped, true, '阳性对照：原件上同款判据必须为绿');
    assert.equal(ok.leaked, false, '阳性对照：原件不得泄露');
});
test('v3170 E6. 破坏「没扫到也要说出范围」⇒ C3 同款判据必须转红', async () => {
    const dir = mutate('e6', [[VIEW, "        return t ? ` · 快速档（${t} 个来源有更多未索引）` : ' · 快速档';", "        return '';"]]);
    const r = await judgeScopeSurface(dir);
    assert.equal(r.emptyHasScope, false, '★ 破坏后空态就不再报范围（实得 ' + r.emptyHasScope + '）');
    const ok = await judgeScopeSurface(ROOT);
    assert.equal(ok.emptyHasScope, true, '阳性对照：原件空态必须报范围');
});
test('v3170 E7. 破坏「轻索引同源」⇒ D1 同款判据必须转红', async () => {
    /* 破坏必须**仍然是合法 JS**：否则副本 import 直接语法错，负控制就变成
     *   「因解析失败而红」，而不是「因破坏而红」（本仓反假绿纪律之一）。 */
    const dir = mutate('e7', [['data/cheat-index.js', 'export const cheatIndex = [',
        'export const cheatIndex = [];\nconst _CHEAT_DEAD = [']]);
    const destroyed = await judgeLightIndex(dir);
    assert.equal(destroyed.cheatCount, 0, '自证：破坏必须真的把索引掏空（实得 ' + destroyed.cheatCount + ' 条）');
    assert.ok(destroyed.cheatDiff > 0, '★ 破坏后 D1 同款判据必须转红（实得 ' + destroyed.cheatDiff + '）');
    const ok = await judgeLightIndex(ROOT);
    assert.equal(ok.cheatDiff, 0, '阳性对照：原件上同款判据必须为绿');
    assert.equal(ok.dtDiff, 0, '阳性对照：撩语侧也一样');
});
test('v3170 E9. [v3.60.0 · 计划 O2] 破坏「片间让出宏任务」⇒ B8 同款判据必须转红', async () => {
    /* 让出退化成微任务 = 没让出：await 一枚已决 Promise 在同一轮事件循环里被抽干。 */
    const dir = mutate('e9', [[GSE, "            if (typeof g.setTimeout === 'function') { g.setTimeout(resolve, 0); return; }", "            if (typeof g.setTimeout === 'function') { resolve(); return; }"]]);
    const g = await loadGse(dir);
    const eng = new g.GlobalSearchEngine({ sources: [g.makeTavernSource({ chat: mkChat(10000) })] });
    let ticks = 0;
    const timer = setInterval(() => { ticks += 1; }, 1);
    try { await eng.searchAll(MARK_MID, { full: true }); } finally { clearInterval(timer); }
    assert.equal(ticks, 0, '★ 让出退化成微任务后，计时器必须一次都跑不到（实得 ' + ticks + '）');
    const ok = await loadGse(ROOT);
    const eng2 = new ok.GlobalSearchEngine({ sources: [ok.makeTavernSource({ chat: mkChat(10000) })] });
    let t2 = 0;
    const tm2 = setInterval(() => { t2 += 1; }, 1);
    try { await eng2.searchAll(MARK_MID, { full: true }); } finally { clearInterval(tm2); }
    assert.ok(t2 >= 1, '阳性对照：原件上同款判据必须为绿');
});

test('v3170 E8. 变异工具两向自证（锚点不存在 / 不唯一都必须抛）', () => {
    assert.throws(() => mutate('e8a', [[GSE, '不存在的锚点字符串_zzz', 'x']]), /须恰中 1 次/);
    assert.throws(() => mutate('e8b', [[GSE, 'const MAX_SCAN_PER_SOURCE', 'x']]), /须恰中 1 次/);
});

/* ══════════════ F ── 版本锚（下限形） ══════════════ */
test('v3170 F1. 版本锚（下限形）：三处同源且不低于 3.17.0', () => {
    const VNUM = (s) => Number(String(s).split('.').reduce((a, x) => a * 1000 + Number(x), 0));
    const man = JSON.parse(read('manifest.json'));
    const pkg = JSON.parse(read('package.json'));
    const codeVer = (/const ST_PHONE_VERSION = '([^']+)'/.exec(read('index.js')) || [])[1];
    assert.ok(codeVer, '入口版本常量在场');
    assert.equal(codeVer, man.version, '入口 == manifest');
    assert.equal(pkg.version, man.version, 'package == manifest');
    assert.ok(VNUM(man.version) >= VNUM('3.17.0'), '本套件自 3.17.0 起成立；当前 ' + man.version);
});
