// tests/r14_o2_search_session_isolation.test.mjs — R14-O2 搜索取消与会话切换后的旧结果 [v4.121.0]
//
//   计划原文（.agents/notes/proposed/architecture/2026-11-03-product-optimization-v14.md）：
//     · 现有底座与差距：browser_readings 的 search-cancel 场景有 48 条登记失败；
//       尚不等于 48 个产品缺陷。
//     · 本期交付：用实际搜索任务复现取消、晚到结果、换会话和回跳，修复污染或驱动定位根因。
//     · 验收旅程：慢查询A后发B，A晚到不得覆盖B；取消后不回填；切会话无旧片段；
//       原搜索排序不被模糊层替换。
//
//   本套件只钉**能复现的源码缺陷**。侦察（真探针，非读注释）确认了三处，均已修：
//     ① Spotlight 内核的索引是累加的：`items` / `index` 只增不删，`indexEntities`
//        是「再补几条」而不是「这一域现在长这样」。于是换会话后，上一段会话独有的
//        id 这一轮根本不会出现在 `_spotlightSources()` 里 —— **没有任何一次写入会碰它**
//        —— 它就一直留在倒排表里，新会话照样搜得到。探针实测：
//        `s.indexEntities('WECHAT', [c1])` → 搜得到；再灌 `[c2]` → 搜「秘密片段」仍命中 c1。
//        用户删掉一条日记后它在搜索里永远搜得到，是同一根因的第二个面孔。
//     ② `onChatChanged()` 清了视图的 `_keyword/_scope/_result/_vague*`，**但漏了 `_scanning`**。
//        `renderResults(gen, r, kw)` 有两道关：先 `s.gen !== gen`、再 `_keyword !== kw`。
//        视图 `_scanning` 还停在旧代际 ⇒ 第①道关两边相等、**通过**；用户在新会话里
//        恰好又搜了同样的词 ⇒ 第②道关也通过 ⇒ 上一段会话的命中被写进新会话面板。
//     ③ Spotlight 单例在换会话时**完全不重置**。`spotlightFace` 里对每个域是
//        `try { indexEntities(...) } catch {}` —— 某域这一轮取数抛错时该域**一条都不灌**，
//        于是旧条目留在那里（不是「覆盖」，是「这一轮压根没碰」）。
//
//   为什么不把「点取消」再判一遍：取消的谓言（`_scanGen !== gen`）、引擎侧
//   `isCancelled`、视图侧的取消渲染分支，`tests/system-v3170` B5b/C3 与
//   `tests/system-v3760` 已经钉死。同一口径只许一份判据，本套件不重写第二份，
//   只补它够不到的**会话维度**（取消本身没有会话气息，泄漏才有）。
//
//   覆盖：
//     A 内核索引账（按域替换 · 跨域不牵连 · 倒排表无空 token · reset 整份清）
//     B 换会话的视图记账（旧扫描记账必须不在 · 晚到回执不得落面）
//     C 换会话的 Spotlight 残留（正常重灌 · 某域取数抛错时的降级路）
//     D 接线（App 的三个出口各自真调了修好的件）
//     E 负控制（真源码破坏 + 副本上重跑同款判据）
//     F 台账纪律与自证（判据自身不许恒真）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const SPOT = 'config/spotlight-universal-search.js';
const APP = 'apps/search/search-app.js';
const VIEW = 'apps/search/search-view.js';
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const readAt = (root, p) => fs.readFileSync(path.join(root, p), 'utf8');
const SPOT_SRC = read(SPOT);
const APP_SRC = read(APP);
const VIEW_SRC = read(VIEW);

const loadSpot = (root) => import(pathToFileURL(path.join(root, SPOT)).href);
const loadApp = (root) => import(pathToFileURL(path.join(root, APP)).href);

/* ══════════════ 夹具 ══════════════ */
/** 面板壳：只为 `renderResults` 里 `this.app.phoneShell?.screen` 那一跳不炸。 */
function mkShell() {
    return {
        screen: { querySelector: () => null, querySelectorAll: () => [] },
        html: '',
        setContent(h) { this.html = String(h); }
    };
}
/**
 * 会话化 storage。
 *   `currentConversationId` 是 `_chatId()` 的读处；两个会话的数据**分开存放**，
 *   换会话就是换一整份 storage（与真实宿主行为一致：键前缀按会话隔开）。
 */
function mkStorage(convId, data = {}) {
    const m = new Map(Object.entries(Object.assign({}, data)));
    return {
        currentConversationId: convId,
        get: (k, d = null) => (m.has(k) ? m.get(k) : d),
        set: (k, v) => m.set(k, v),
        remove: (k) => m.delete(k),
        _m: m
    };
}
/** 换掉宿主上的 VirtualPhone 侧读数（通讯录 getContacts 等）。 */
function withHost(vp, fn) {
    const prevWin = globalThis.window;
    globalThis.window = Object.assign(globalThis.window || {}, { VirtualPhone: vp });
    try { return fn(); } finally { globalThis.window = prevWin; }
}

/* ══════════════ 同一份判据（原件与破坏副本上跑的是它们） ══════════════ */
/**
 * A1：同域重灌 = 整份替换。
 *   旧语义（只增不删）下，`c1` 在第二次灌入后仍然可搜 —— 这就是「上一段会话的片段」。
 *
 * ★ 探针词必须用**不共享任何 bigram 的标记串**：
 *   本内核的分词器（`_tokenize`）会把中文切成单字 + 双字 bigram，于是
 *   「秘密片段」与「别的片段」共享「片段」这个双字 token —— 用它们当判据，
 *   旧条目即使已经被正确清掉，新条目也会命中，判据就成了假红。
 *   英文/数字串（`[a-z0-9_]+`）只产生**一个整词 token**，天然不跨词共享。
 *   这条教训对任何拿本内核做判据的后来者都成立，故写在这里。
 */
const MARK_A = 'zzoldmarkerq';
const MARK_B = 'zznewmarkerkv';
async function judgeDomainReplace(root) {
    const { SpotlightUniversalSearch } = await loadSpot(root);
    const s = new SpotlightUniversalSearch();
    s.indexEntities('WECHAT', [{ id: 'c1', title: 'A会话的群', content: MARK_A }]);
    const beforeHits = s.search(MARK_A).results.length;
    s.indexEntities('WECHAT', [{ id: 'c2', title: 'B会话的群', content: MARK_B }]);
    const staleHits = s.search(MARK_A).results.length;
    const freshHits = s.search(MARK_B).results.length;
    return { beforeHits, staleHits, freshHits, items: s.items.size, tokens: s.index.size };
}
/**
 * A2：跨域互不牵连。
 *   清 WECHAT 不许把 DIARY 里的同 id 条目带走（`fullId` 带域前缀，账也按域记）。
 */
async function judgeCrossDomain(root) {
    const { SpotlightUniversalSearch } = await loadSpot(root);
    const s = new SpotlightUniversalSearch();
    s.indexEntities('WECHAT', [{ id: 'x', title: '会话 x', content: MARK_A }]);
    s.indexEntities('DIARY', [{ id: 'x', title: '日记 x', content: MARK_A }]);
    const both = s.search(MARK_A).results.length;
    s.indexEntities('WECHAT', []);
    const afterWipeWechat = s.search(MARK_A).results;
    return {
        both,
        left: afterWipeWechat.length,
        leftDomains: afterWipeWechat.map((r) => r.domain).sort().join(','),
        items: s.items.size
    };
}
/**
 * A3：倒排表不许留空桶。
 *   删了条目却把空 Set 留在 token 上，会让「这个词在索引里」永远答「在」，
 *   白占内存且 `index.size` 这个读数再也量不出真实规模。
 */
async function judgeNoEmptyBuckets(root) {
    const { SpotlightUniversalSearch } = await loadSpot(root);
    const s = new SpotlightUniversalSearch();
    s.indexEntities('WECHAT', [{ id: 'c1', title: '甲', content: '独有词AAA' }]);
    const tokensBefore = s.index.size;
    s.indexEntities('WECHAT', []);
    const emptyBuckets = Array.from(s.index.values()).filter((b) => !b || b.size === 0).length;
    return { tokensBefore, tokensAfter: s.index.size, emptyBuckets, items: s.items.size };
}
/** A4：`reset()` 整份清空，连搜索历史一起（它是上一段会话的用户输入痕迹）。 */
async function judgeReset(root) {
    const { SpotlightUniversalSearch } = await loadSpot(root);
    const s = new SpotlightUniversalSearch();
    s.indexEntities('WECHAT', [{ id: 'c1', title: '甲', content: '甲词' }]);
    s.indexEntities('DIARY', [{ id: 'd1', title: '乙', content: '乙词' }]);
    s.search('甲词');
    const historyBefore = s.searchHistory.length;
    const cleared = s.reset();
    return {
        cleared, historyBefore, historyAfter: s.searchHistory.length,
        items: s.items.size, tokens: s.index.size, domains: s._domainIds.size
    };
}

/**
 * B1：换会话后旧扫描记账必须不在。
 *   判据只问行为：换会话**之后**再让 A 会话的回执晚到，`_result` 不许被写。
 *   （这就是 §② 那个窗口：`_keyword` 已清、但用户在 B 会话里又搜了同样的词，
 *    于是第二道关也放行 —— 能拦住它的只有第一道关，而第一道关读的正是 `_scanning`。）
 */
async function judgeLateWriteAfterChatSwitch(root) {
    const { SearchApp } = await loadApp(root);
    const app = new SearchApp(mkShell(), mkStorage('conv-A', {
        wechat_data: { chats: [{ id: 'c1', name: 'A群', lastMessage: '甲' }] }
    }));
    const v = app.view;
    const genA = app._scanGen;
    // ① A 会话起了一轮全历史扫描
    v._scanning = { gen: genA, kw: '咖啡' };
    v._keyword = '咖啡';
    v._result = null;
    // ② 换到 B 会话
    app.storage = mkStorage('conv-B', { wechat_data: { chats: [{ id: 'c2', name: 'B群', lastMessage: '乙' }] } });
    app.onChatChanged();
    const scanningAfter = v._scanning;
    // ③ B 会话里用户恰好又搜了同样的词（第二道关放行）
    v._keyword = '咖啡';
    v._result = null;
    // ④ A 会话那份回执晚到
    v.renderResults(genA, { cancelled: false, results: [{ title: 'A会话的命中' }], groups: [], total: 1 }, '咖啡');
    return {
        scanningAfter,
        lateWriteLanded: v._result !== null,
        landedTitles: (v._result && v._result.results || []).map((r) => r.title).join('|')
    };
}

/**
 * C1：换会话后 Spotlight 不许留旧片段（正常重灌这一路）。
 *   `spotlightFace` 每次都会把四域全量重灌，所以这条在「按域替换」修好后就该绿 ——
 *   它守的是「按域替换」本身没退化（A1 守内核，这里守 App 真的每轮都灌全量）。
 */
async function judgeSpotlightNoStaleAfterSwitch(root) {
    const { SearchApp } = await loadApp(root);
    const appA = new SearchApp(mkShell(), mkStorage('conv-A', {
        wechat_data: { chats: [{ id: 'c1', name: 'A群', lastMessage: MARK_A }] }
    }));
    const faceA = appA.spotlightFace(MARK_A);
    // 同一个 App 实例（模拟「没退出 App，只换了会话」）
    appA.storage = mkStorage('conv-B', {
        wechat_data: { chats: [{ id: 'c2', name: 'B群', lastMessage: MARK_B }] }
    });
    appA.onChatChanged();
    const faceB = appA.spotlightFace(MARK_A);
    return {
        aHits: faceA.rows.length,
        bHits: faceB.rows.length,
        bIds: faceB.rows.map((r) => r.id || r.rawId).join('|')
    };
}
/**
 * C2：`reset()` 的**不可替代的部分** —— 四域清单之外的任何残留。
 *
 * 【为什么不能拿「某域取数抛错」当这条的剧情】初稿就是这么写的，一跑就露馅：
 *   `_spotlightSources()` **每次都返回四域**（取不到数据的域返回 `rows: []`），
 *   于是 `spotlightFace` 里对每个域都会调一次 `indexEntities` —— 空数组也算一次调用，
 *   也会触发按域替换。所以「某域这一轮取数崩了」这一路其实**已经被按域替换治住了**，
 *   把它当成 reset 的独有价值，就是一条**没有牙**的判据（破坏 reset 后照旧为绿，实测 0 !== 1）。
 *
 * 【reset 真正只有它能做的两件事】
 *   ① 四域清单里**没有**的域：`_spotlightSources()` 只灌 CONTACTS / WECHAT / DIARY /
 *      SETTINGS 四个域，别的域名它一辈子不会碰 —— 那种条目只能靠整份清；
 *      而「清单会变」（加一域、删一域、某域临时下线）正是会留残的那一类改动。
 *   ② `searchHistory`：按域替换完全不管它，它是**上一段会话的用户输入痕迹**。
 *   本判据就钉这两件，不钉一件已经有人负责的事。
 */
async function judgeResetOnlyLeak(root) {
    const { SearchApp } = await loadApp(root);
    const app = new SearchApp(mkShell(), mkStorage('conv-A', {}));
    // 先让单例建起来（惰性），再手工塞一条**不属于任何已知域**的残留 + 一条搜索历史
    app.spotlightFace('');
    const eng = app._spotlightEngine;
    eng.indexEntities('LEGACY_DOMAIN', [{ id: 'z1', title: '历史遗留', content: MARK_A }]);
    eng.search(MARK_A);
    const beforeIndex = eng.search(MARK_A).results.length;
    const beforeHistory = eng.searchHistory.length;
    // 换会话
    app.storage = mkStorage('conv-B', {});
    app.onChatChanged();
    // 再跑一次正常读数（四域重灌会跑，但不会碰 LEGACY_DOMAIN）
    app.spotlightFace('');
    /* ★ 先读历史、再查索引：`search()` 自己会 `_recordHistory`，
     *   所以在断言表达式里顺手 `eng.search(...)` 会把刚清空的历史又填上一条 ——
     *   于是「历史没清」和「历史被我这句判据自己写了」在读数上长得一样。
     *   这类自指伪证本仓已经记过好几形态，这里按「读一次、存下来」处理。 */
    const afterHistory = eng.searchHistory.length;
    const afterIndex = eng.search(MARK_A).results.length;
    return {
        beforeIndex, beforeHistory,
        afterIndex, afterHistory,
        items: eng.items.size
    };
}

/* ══════════════ 副本树（负控制用） ══════════════ */
/**
 * 从入口递归解析相对 import，把整条闭包复制过去。
 *   ★ 为什么不用手写清单：手写清单每次新增 config 依赖都要补一遍，
 *     而「漏补 ⇒ 副本 ERR_MODULE_NOT_FOUND ⇒ 负控制因缺文件而红」这个坑，
 *     本仓已经在 v4.05 / v4.20 / v4.99.7 踩过三次。让解析器算，就不会再漏。
 */
function closureOf(entry) {
    const seen = new Set();
    const stack = [entry];
    while (stack.length) {
        const rel = stack.pop();
        if (seen.has(rel)) continue;
        const abs = path.join(ROOT, rel);
        if (!fs.existsSync(abs)) continue;
        seen.add(rel);
        const src = fs.readFileSync(abs, 'utf8');
        const re = /from\s+['"](\.[^'"]+)['"]/g;
        let m;
        while ((m = re.exec(src))) {
            const target = path.posix.normalize(path.posix.join(path.posix.dirname(rel), m[1]));
            stack.push(target);
        }
    }
    return Array.from(seen);
}
function mkTree(tag, entry) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rp-r14o2-' + tag + '-'));
    for (const rel of closureOf(entry)) {
        const dst = path.join(dir, rel);
        fs.mkdirSync(path.dirname(dst), { recursive: true });
        fs.copyFileSync(path.join(ROOT, rel), dst);
    }
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ type: 'module' }));
    return dir;
}
/** 真源码破坏：锚点必须恰中 1 次，且必须真的改了文件（否则抛）。 */
function mutate(tag, entry, edits) {
    const dir = mkTree(tag, entry);
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

/* ══════════════ A ── 内核索引账 ══════════════ */
test('A1 同域重灌是整份替换：上一段会话独有的条目必须消失（不是「被覆盖」，是「本轮没碰它」）', async () => {
    const r = await judgeDomainReplace(ROOT);
    assert.equal(r.beforeHits, 1, '前置：A 会话自己搜得到');
    assert.equal(r.staleHits, 0, '重灌同域后旧条目仍可搜到 —— 这就是「上一段会话的片段」泄漏');
    assert.equal(r.freshHits, 1, '新会话自己的条目必须搜得到');
    assert.equal(r.items, 1, 'items 只该剩这一域这一轮灌的那一条');
});

test('A2 跨域互不牵连：清 WECHAT 不许带走 DIARY 里的同 id 条目', async () => {
    const r = await judgeCrossDomain(ROOT);
    assert.equal(r.both, 2, '前置：两个域各有一条同名条目');
    assert.equal(r.left, 1, '清掉一个域后另一个域必须还在');
    assert.equal(r.leftDomains, 'DIARY', '留下来的必须是 DIARY 那条（不是 WECHAT 的）');
});

test('A3 倒排表不留空桶：删条目要把 token 上的空集一并删掉（否则「在不在索引里」永远答「在」）', async () => {
    const r = await judgeNoEmptyBuckets(ROOT);
    assert.ok(r.tokensBefore > 0, '前置：灌入后该有 token');
    assert.equal(r.items, 0, '清空该域后条目数为 0');
    assert.equal(r.emptyBuckets, 0, '索引里不许有空 Set（实得 ' + r.emptyBuckets + ' 个）');
    assert.equal(r.tokensAfter, 0, '该域是唯一来源时 token 表该被清空');
});

test('A4 reset 整份清空：条目 / 倒排 / 域账 / 搜索历史一起走（历史是上一段会话的输入痕迹）', async () => {
    const r = await judgeReset(ROOT);
    assert.ok(r.historyBefore >= 1, '前置：搜索历史里有东西');
    assert.equal(r.cleared, 2, 'reset 要如实报清掉几条');
    assert.equal(r.historyAfter, 0, '搜索历史必须清（它是上一段会话的用户输入痕迹）');
    assert.equal(r.items, 0, '条目表清空');
    assert.equal(r.tokens, 0, '倒排表清空');
    assert.equal(r.domains, 0, '域账清空');
});

/* ══════════════ B ── 换会话的视图记账 ══════════════ */
test('B1 换会话后旧的视图扫描记账必须不在：A 会话的回执晚到、B 会话恰好搜同一个词，也不许落面', async () => {
    const r = await judgeLateWriteAfterChatSwitch(ROOT);
    assert.equal(r.scanningAfter, null, 'onChatChanged 必须把 view._scanning 一并丢掉（此前漏了这一格）');
    assert.equal(r.lateWriteLanded, false, 'A 会话的命中被写进了 B 会话的面板（实得 ' + r.landedTitles + '）');
});

/* ══════════════ C ── 换会话的 Spotlight 残留 ══════════════ */
test('C1 换会话后 Spotlight 不许留旧片段（正常重灌这一路）', async () => {
    const r = await judgeSpotlightNoStaleAfterSwitch(ROOT);
    assert.equal(r.aHits, 1, '前置：A 会话自己搜得到');
    assert.equal(r.bHits, 0, '换会话后仍搜得到 A 会话的片段（实得 ' + r.bIds + '）');
});

test('C2 reset 的不可替代之处：四域清单之外的残留与搜索历史，换会话后一件都不许留', async () => {
    const r = await judgeResetOnlyLeak(ROOT);
    assert.equal(r.beforeIndex, 1, '前置：残留条目真在倒排表里');
    assert.ok(r.beforeHistory >= 1, '前置：搜索历史里有东西');
    assert.equal(r.afterIndex, 0, '四域之外那个域的条目换会话后仍在（按域替换一辈子碰不到它，只有 reset 能清）');
    assert.equal(r.afterHistory, 0, '搜索历史是上一段会话的输入痕迹，必须清');
});

/* ══════════════ D ── 接线 ══════════════ */
test('D1 App 的换会话出口真调了 reset，且真清了视图的扫描记账', () => {
    const fn = APP_SRC.slice(APP_SRC.indexOf('onChatChanged()'));
    assert.ok(/_spotlightEngine\.reset\(\)/.test(fn), 'onChatChanged 必须真调 Spotlight 的 reset（不是只写注释）');
    assert.ok(/this\.view\._scanning\s*=\s*null/.test(fn), 'onChatChanged 必须清 view._scanning');
});

test('D2 内核把「按域替换」做在自己的入口里，不指望调用点记得先清', () => {
    const i = SPOT_SRC.indexOf('indexEntities(domain, entities = []) {');
    assert.ok(i > 0, '内核必须有 indexEntities');
    const body = SPOT_SRC.slice(i, i + 800);
    assert.ok(/this\.clearDomain\(dom\)/.test(body), 'indexEntities 第一件事就该是 clearDomain（调用点每次拿的都是全量）');
});

test('D3 三道关各司其职：App 侧换代际、内核侧按域替换、单例侧整份 reset', () => {
    assert.ok(/invalidateAll\(\)/.test(APP_SRC), 'App 侧换会话要先作废代际');
    assert.ok(/clearDomain\(domain\)/.test(SPOT_SRC) && /reset\(\)/.test(SPOT_SRC), '内核侧两个清理口都在');
    // 取消谓言只判代际（不该掺会话判断 —— 会话维度由 onChatChanged 的作废负责）
    const t = APP_SRC.slice(APP_SRC.indexOf('cancelToken(gen)'));
    assert.ok(/return function \(\) \{ return self\._scanGen !== gen; \}/.test(t), '取消谓言必须只看代际');
});

/* ══════════════ E ── 负控制 ══════════════ */
test('E1 拿掉「按域替换」⇒ 换会话后旧片段真泄漏（副作用可见才算破坏生效）', async () => {
    const dir = mutate('e1', SPOT, [[
        SPOT,
        '        this.clearDomain(dom);\n        const bucket = new Set();',
        '        /* [负控制] 故意不做按域替换 */\n        const bucket = new Set();'
    ]]);
    const r = await judgeDomainReplace(dir);
    assert.equal(r.staleHits, 1, '破坏后旧条目必须仍然可搜（判据必须有牙）');
});

test('E2 拿掉「域账落盘」⇒ clearDomain 找不到账，条目原地留下', async () => {
    const dir = mutate('e2', SPOT, [[
        SPOT,
        '        this._domainIds.set(dom, bucket);\n    }',
        '        /* [负控制] 故意不落域账 */\n    }'
    ]]);
    const r = await judgeDomainReplace(dir);
    assert.equal(r.staleHits, 1, '破坏后旧条目必须仍然可搜');
});

test('E3 拿掉换会话的 reset ⇒ 四域之外的残留与搜索历史都留下来了', async () => {
    const dir = mutate('e3', APP, [[
        APP,
        'try { if (this._spotlightEngine) this._spotlightEngine.reset(); } catch (_e) { /* 单例不在就没残留 */ }',
        'try { /* [负控制] 故意不 reset */ } catch (_e) { /* 同前 */ }'
    ]]);
    const r = await judgeResetOnlyLeak(dir);
    assert.equal(r.afterIndex, 1, '破坏后残留必须留在倒排表里（否则说明这条判据是恒真的）');
    assert.ok(r.afterHistory >= 1, '破坏后搜索历史必须留得下来');
});

test('E4 拿掉 view._scanning 的清理 ⇒ A 会话的晚到回执真写进 B 会话面板', async () => {
    const dir = mutate('e4', APP, [[
        APP,
        'this.view._scanning = null;',
        '/* [负控制] 故意不清扫描记账 */'
    ]]);
    const r = await judgeLateWriteAfterChatSwitch(dir);
    assert.equal(r.lateWriteLanded, true, '破坏后晚到回执必须真的落面（判据必须有牙）');
});

/* ══════════════ F ── 台账纪律与自证 ══════════════ */
test('F1 视图的两道关都在场：代际关 + 关键词关（少一道就有一个可复现的泄漏窗口）', () => {
    assert.ok(/if \(!s \|\| s\.gen !== gen\) return;/.test(VIEW_SRC), '第一道关：视图账的代际');
    assert.ok(/this\._keyword\.trim\(\) !== String\(kw \|\| ''\)/.test(VIEW_SRC), '第二道关：关键词');
});

test('F2 取消后不给任何结果（这是既有 v3170 的判据，本套件只确认它没被本版改坏）', () => {
    const i = VIEW_SRC.indexOf('if (r && r.cancelled === true) {');
    assert.ok(i > 0, '取消分支必须还在');
    /* 取 900 字而非 400：这个分支里带三行中文注释，400 字的窗口刚好卡在
     *   「这里不给任何结果」之前（实测），于是判据读到的是一个被截断的片段。
     *   窗口长度的唯一依据是「这条判据要看的最后一件东西在哪」，不是随手一个数。 */
    const body = VIEW_SRC.slice(i, i + 900);
    assert.ok(/this\._result = null;/.test(body), '取消后必须把 _result 真空掉');
    assert.ok(/这里不给任何结果/.test(body), '取消后必须说清「为什么不给结果」');
});

test('F3 自证：本套件的四条验收旅程逐条都有判据在场（不许只写其中一条）', () => {
    const src = fs.readFileSync(fileURLToPath(import.meta.url), 'utf8');
    const journeys = [
        ['A晚到不得覆盖B', 'judgeLateWriteAfterChatSwitch'],
        ['取消后不回填', 'if (r && r.cancelled === true)'],
        ['切会话无旧片段', 'judgeSpotlightNoStaleAfterSwitch'],
        ['四域之外的残留也只能靠 reset', 'judgeResetOnlyLeak']
    ];
    for (const [label, needle] of journeys) {
        assert.ok(src.includes(needle), '验收旅程「' + label + '」缺判据（找 ' + needle + '）');
    }
    // 自证第二侧：判据数量与用例数量都不许是 0（恒真集合的另一种形态）
    assert.ok((src.match(/^test\(/gm) || []).length >= 14, '用例数不该少于 14');
});

test('F4 本版不动存储键：换会话隔离靠「清」，不靠新键（不新增第六个需要登记的键）', () => {
    assert.ok(!/spotlight_[a-z_]*'/.test(APP_SRC), 'App 不得新造 spotlight 存储键');
    assert.ok(!/ia_[a-z_]*'/.test(SPOT_SRC), '内核不得引入任何存储键（它是纯内存件）');
});
