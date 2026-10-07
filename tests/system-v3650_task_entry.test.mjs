// tests/system-v3650_task_entry.test.mjs — 任务入口与页签定位 [v3.65.0 · 拓展计划 X1]
//
// 本套件守六面（每面都对着**磁盘真源**算，不读被测模块的自述）：
//   A 面 结构：卡表 / 归因词表 / 状态四态 / 能力筛选四值（真模块真调）；
//   B 面 页签真源对账：TABS_BY_APP 逐条与 apps/** 真源码的抽取结果比集合相等
//     （按 shape 分派抽取器 —— array/ifchain/view/single 四种白名单载体形态不同）；
//   C 面 卡 × 路由 × 页签三面交叉：每条靶心的 appId 必须在本仓有路由、声明的 tab
//     必须在真源白名单里（X1 验收原文「导航到真实 App 并定位具体页签」）；
//   D 面 派发面接线：index.js 的装配器必须在 render **之前**投页签（顺序即正确性）；
//   E 面 负控制：真源码定点破坏 ⇒ 同款真判据在副本树上必须转红（破坏不落真仓）；
//   V 面 版本与登记：本套件只在当版成立 + 两个会话键真登记在 keys-audit 与 storage 前缀族。
//
// 判据纪律（本仓硬纪律）：锚点必须恰中 1 次（不唯一即抛）；破坏只落副本树；
//   判据不得引用被测模块的自述常量当结论（自述与本套件声明分开存放才有判别力）。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { copyTreeSafe } from './_mirror_tree.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const Q = String.fromCharCode(39);
const NL = String.fromCharCode(10);
const BS = String.fromCharCode(92);

const TE_REL = 'config/task-entry.js';
const TABSRC_REL = 'config/tab-source.js';
const DETAIL_REL = 'config/app-open-detail.js';
const APPS_REL = 'config/apps.js';
const ROUTES_REL = 'config/app-lazy-routes.js';
const INDEX_REL = 'index.js';
const KEYS_REL = 'scripts/keys-audit.mjs';
const STORAGE_REL = 'config/storage.js';
const APP_REL = 'apps/taskentry/taskentry-app.js';
const VIEW_REL = 'apps/taskentry/taskentry-view.js';
const MIN_VERSION = '3.65.0';

const readRel = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const temps = [];
process.on('exit', () => {
    for (const d of temps) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (_e) { /* 忽略 */ } }
});
/** 真源码破坏：锚点必须**恰中一次**（多一点即意味着改了不该改的地方）。
 *  ★ 副本树带上一份**完整 config/**：被破坏的模块（如 task-entry.js）静态 import 同目录
 *    依赖（usage-tracker / app-lazy-routes / …），副本树若只有被破坏那一件，
 *    ESM 解析相对依赖会 MODULE_NOT_FOUND —— 那是**判据基建坏了**，会被误读成「破坏没反应」。
 *    apps/** 不整树复制：读源码一律走 readFrom（副本优先、缺则回落真仓），只放被破坏的一件。 */
function damage(rel, anchor, replacement) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rp_v3650_'));
    temps.push(dir);
    /* 走共享实现（tests/_mirror_tree.mjs）：本仓纪律是「镜像点不得裸调」，见 v3230 门禁。 */
    copyTreeSafe(path.join(ROOT, 'config'), path.join(dir, 'config'));
    const src = readRel(rel);
    const hits = src.split(anchor).length - 1;
    assert.equal(hits, 1, '破坏锚点必须恰中 1 次（实测 ' + hits + '）：' + anchor.slice(0, 70));
    const dst = path.join(dir, rel);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.writeFileSync(dst, src.split(anchor).join(replacement));
    return dir;
}
/** 副本树优先读：只读被破坏的那件，其余回落真仓。 */
function readFrom(dir, rel) {
    const p = path.join(dir, rel);
    if (dir !== ROOT && fs.existsSync(p)) return fs.readFileSync(p, 'utf8');
    return readRel(rel);
}
async function loadMod(dir, rel) {
    return import(pathToFileURL(path.join(dir, rel)).href + '?v=' + Date.now() + Math.random());
}

/* ══════════ B 面抽取器：按 shape 分派（真读源码，不看表怎么说） ══════════ */
const S_QUOTED = new RegExp(Q + '([^' + Q + ']*)' + Q, 'g');
function quoted(s) { return [...s.matchAll(S_QUOTED)].map((m) => m[1]); }
/** array：setTab 体内第一个 [...] 里的所有串。 */
function extractArray(src) {
    const i = src.indexOf('setTab(');
    if (i < 0) return null;
    const win = src.slice(i, i + 1200);
    /* ⚠ `]` 在字符类里**必须**转义，且只转一次：上一版拼成 `[^\]\]*]`（多一个 `]`）
     *   会让 RegExp 直接抛 Unterminated character class —— 那是抽取器自身崩了，
     *   不是「表与源码不一致」，两者混在一起会把判据基建缺陷读成被测对象缺陷。 */
    const m = win.match(new RegExp(BS + '[' + '([^' + BS + ']]*)' + BS + ']'));
    if (!m) return null;
    return quoted(m[1]);
}
/** ifchain：setTab 起 400 字符内所有 `=== 'x'` 比较串。 */
function extractIfChain(src) {
    const i = src.indexOf('setTab(');
    if (i < 0) return null;
    const win = src.slice(i, i + 400);
    return [...win.matchAll(new RegExp('===' + BS + 's*' + Q + '([^' + Q + ']*)' + Q, 'g'))].map((m) => m[1]);
}
/** view：视图层 `const tabs = [...]` 里的下标串（配平到行首 `];`）。 */
function extractViewTabs(src) {
    const i = src.indexOf('const tabs = [');
    if (i < 0) return null;
    const rest = src.slice(i);
    const m = rest.match(new RegExp('const tabs = ' + BS + '[' + '([' + BS + 's' + BS + 'S]*?)' + BS + 'n' + BS + 's*' + BS + ']' + BS + 's*;'));
    const body = m ? m[1] : rest.slice(0, 1200);
    const rows = body.match(new RegExp(BS + '[' + '[^' + BS + ']]*' + BS + ']', 'g'));
    if (rows && rows.length > 1) return rows.map((r) => quoted(r)[0]).filter((x) => x);
    return quoted(body);
}
/** single：app 层兜底串 + 视图层「没有第二个 tab 分支」的自证读数。 */
function probeSingle(appSrc, viewSrc) {
    const i = appSrc.indexOf('setTab(');
    const win = i >= 0 ? appSrc.slice(i, i + 200) : '';
    const fallback = (win.match(new RegExp(BS + '|' + BS + '|' + BS + 's*' + Q + '([^' + Q + ']*)' + Q)) || [])[1] || '';
    return {
        fallback: fallback,
        hasTabsArr: viewSrc.indexOf('const tabs = [') >= 0,
        tabBranches: (viewSrc.match(new RegExp('vm' + BS + '.tab' + BS + 's*===', 'g')) || []).length
    };
}
/** 单条表的源码抽取（真仓或副本树都吃）。 */
function extractFromSource(dir, id, row) {
    const appRel = 'apps/' + id + '/' + id + '-app.js';
    const viewRel = 'apps/' + id + '/' + id + '-view.js';
    if (row.shape === 'array') return { tabs: extractArray(readFrom(dir, appRel)), extra: {} };
    if (row.shape === 'ifchain') return { tabs: extractIfChain(readFrom(dir, appRel)), extra: {} };
    if (row.shape === 'view') return { tabs: extractViewTabs(readFrom(dir, viewRel)), extra: {} };
    if (row.shape === 'single') {
        const p = probeSingle(readFrom(dir, appRel), readFrom(dir, viewRel));
        return { tabs: [p.fallback], extra: p };
    }
    return { tabs: null, extra: { unknownShape: row.shape } };
}
const uniqSorted = (a) => Array.from(new Set(a || [])).sort();
const sameSet = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

/** ⭐ B 面主判据（真仓与副本树共用）：返回问题码数组，空数组 = 干净。 */
async function tabSourceJudge(dir) {
    const problems = [];
    const mod = await loadMod(dir, TABSRC_REL);
    const appsSrc = readFrom(dir, APPS_REL);
    const appIds = new Set([...appsSrc.matchAll(new RegExp('^ {8}id: ' + Q + '([' + BS + 'w-]+)' + Q, 'gm'))].map((m) => m[1]));
    for (const id of mod.TAB_SOURCE_APPS) {
        const row = mod.TABS_BY_APP[id];
        if (!appIds.has(id)) { problems.push('表项不在 APPS 里：' + id); continue; }
        const got = extractFromSource(dir, id, row);
        if (!got.tabs) { problems.push('抽取器没抽到：' + id + '（' + row.shape + '）'); continue; }
        const declared = uniqSorted(row.tabs);
        const actual = uniqSorted(got.tabs);
        if (!sameSet(declared, actual)) {
            problems.push('页签漂移：' + id + ' 声明 ' + JSON.stringify(declared) + ' vs 源码 ' + JSON.stringify(actual));
        }
        if (row.shape === 'single') {
            if (got.extra.hasTabsArr) problems.push(id + ' 标 single 但视图层有 tabs 数组');
            if (got.extra.tabBranches !== 0) problems.push(id + ' 标 single 但视图层有 ' + got.extra.tabBranches + ' 处 tab 分支');
        }
    }
    const self = mod.tabSourceSelfCheck();
    for (const p of self.problems) problems.push('表自检：' + p);
    return problems;
}

/* ══════════ C 面主判据：卡表 × 路由 × 页签三面交叉 ══════════ */
async function cardJudge(dir) {
    const problems = [];
    const te = await loadMod(dir, TE_REL);
    const routes = await loadMod(dir, ROUTES_REL);
    const appIds = new Set([...readFrom(dir, APPS_REL).matchAll(new RegExp('^ {8}id: ' + Q + '([' + BS + 'w-]+)' + Q, 'gm'))].map((m) => m[1]));
    const rowsAll = te.availableCards(te.TE_CARDS, {});
    if (rowsAll.length !== te.TE_CARDS.length) problems.push('可用性表长度与卡数不一致');
    for (const card of te.TE_CARDS) {
        for (const t of card.targets) {
            if (!appIds.has(t.appId)) problems.push(card.id + ' 靶心不在 APPS：' + t.appId);
            if (!te.isRouted(t.appId)) problems.push(card.id + ' 靶心无路由：' + t.appId);
            if (!routes.APP_LAZY_ROUTE_INDEX.has(t.appId)) {
                /* 有 tab 声明的 appId 必须在**表驱动装配器**上：内联分支不投页签，
                 *   声明了页签却落在内联分支上 ⇒ 声明与靶心脱钩（本仓最贵的形态）。
                 *   无 tab 声明的不限（内联分支照常能开 App）。 */
                if (t.tab) problems.push(card.id + ' 声明页签但不在表驱动装配器上：' + t.appId + '#' + t.tab);
            }
            const ts = te.tabState(t.appId, t.tab);
            if (ts.state !== 'ok') problems.push(card.id + ' 靶心页签 ' + ts.state + '：' + t.appId + '#' + t.tab);
        }
    }
    return problems;
}

/* ══════════ D 面主判据：派发面接线（顺序即正确性） ══════════ */
function wiringJudge(dir) {
    const problems = [];
    const idx = readFrom(dir, INDEX_REL);
    const applier = idx.indexOf('applyOpenDetail(');
    if (applier < 0) { problems.push('装配器没有调用 applyOpenDetail'); return problems; }
    const norm = idx.indexOf('normalizeOpenDetail(e.detail)');
    if (norm < 0) problems.push('装配器没有归一 e.detail');
    /* ★ 顺序：投页签必须在 `.render()` **之前**。
     *   本仓有一族 setTab 只改状态不渲染（曲库/老福特/素材书…），先渲染再设页签
     *   会让它们停在兜底页 —— 那正是本版要治的形态。 */
    const renderAfter = idx.indexOf('window.VirtualPhone[lazyRoute.key].render()', applier);
    if (renderAfter < 0) problems.push('装配器里找不到投页签之后的 render');
    return problems;
}

/* ══════════ V 面：版本锚与登记 ══════════ */
function registryJudge(dir) {
    const problems = [];
    const keysSrc = readFrom(dir, KEYS_REL);
    for (const k of ['te_pins', 'te_ledger']) {
        if (keysSrc.indexOf(Q + k + Q) < 0) problems.push('keys-audit 未登记 ' + k);
    }
    const storSrc = readFrom(dir, STORAGE_REL);
    /* 只在 **CHAT_DATA_PATTERNS 数组区间**内找 `/^te_/`：
     *   整个文件里搜会把注释里提到 `^te_` 的地方也算成「登记了」—— 那是把说明当实现。 */
    const pstart = storSrc.indexOf('this.CHAT_DATA_PATTERNS = [');
    const pend = pstart >= 0 ? storSrc.indexOf('];', pstart) : -1;
    const family = (pstart >= 0 && pend > pstart) ? storSrc.slice(pstart, pend) : '';
    if (family.indexOf('/^te_/') < 0) problems.push('storage 会话前缀族缺 ^te_');
    return problems;
}

/* ══════════════════════════ A 面 结构 ══════════════════════════ */
test('A1 卡表结构：至少 6 张卡、每张有 label 与靶心、id 不重复、全部冻结', async () => {
    const m = await loadMod(ROOT, TE_REL);
    assert.ok(m.TE_CARDS.length >= 6, '卡数下限 6（实测 ' + m.TE_CARDS.length + '）');
    const ids = new Set();
    for (const c of m.TE_CARDS) {
        assert.ok(c.id && c.label, '卡必须有 id 与 label：' + JSON.stringify(c.id));
        assert.ok(c.targets.length >= 2, c.id + ' 靶心下限 2（实测 ' + c.targets.length + '）');
        assert.ok(!ids.has(c.id), '卡 id 重复：' + c.id);
        ids.add(c.id);
        for (const t of c.targets) {
            assert.ok(typeof t.appId === 'string' && t.appId, c.id + ' 靶心缺 appId');
            assert.ok(t.tab === null || typeof t.tab === 'string', c.id + ' 靶心 tab 只许 null 或非空串');
        }
    }
    const self = m.taskEntrySelfCheck();
    assert.deepEqual(self.problems, [], '自检不该有问题：' + JSON.stringify(self.problems));
});

test('A2 归因词表：每个 why 都取自词表（不许随口新词），状态四态齐备', async () => {
    const m = await loadMod(ROOT, TE_REL);
    const allowed = new Set(Object.values(m.TE_REASONS));
    const seen = new Set();
    /* 逐路取读数，收集所有出现过的 why */
    const cases = [
        m.normalizePins(undefined, 3),
        m.normalizePins('nope', 3),
        m.normalizePins([], 3),
        m.normalizePins([{ appId: 'a' }, { appId: 'a' }, {}, 'x'], 1),
        m.tabState('musicdesk', 'nope'),
        m.tabState('nosuch', 'x'),
        m.readPins(null),
        m.readLedger(null),
        m.recentFromUsage(null)
    ];
    for (const c of cases) {
        if (c && typeof c.why === 'string' && c.why) seen.add(c.why);
    }
    for (const w of seen) assert.ok(allowed.has(w), '出现了词表外的 why：' + w);
    assert.equal(Object.keys(m.TE_STATES).length, 4, '状态四态');
    assert.ok(seen.size >= 4, '样本太小（只见到 ' + seen.size + ' 个 why），判据失去判别力');
});

test('A3 能力筛选：四值齐备且语义互不塌缩（all ⊃ usable；withTab/appOnly 之和 = usable 的靶心数）', async () => {
    const m = await loadMod(ROOT, TE_REL);
    assert.equal(m.TE_CAPS.length, 4);
    const rows = m.availableCards(m.TE_CARDS, {});
    const all = m.filterCards(rows, 'all');
    const usable = m.filterCards(rows, 'usable');
    const withTab = m.filterCards(rows, 'withTab');
    const appOnly = m.filterCards(rows, 'appOnly');
    assert.equal(all.length, rows.length, 'all 不筛掉卡');
    assert.ok(usable.length <= all.length, 'usable ⊆ all');
    assert.ok(withTab.length > 0, '★ 必须有能定位页签的卡（否则本版等于没做成）');
    assert.equal(withTab.length + appOnly.length, usable.length, 'withTab 与 appOnly 必须恰好划分 usable');
    for (const r of withTab) assert.ok(r.withTab > 0, 'withTab 组里有零页签卡：' + r.id);
    for (const r of appOnly) assert.equal(r.withTab, 0, 'appOnly 组里有带页签卡：' + r.id);
});

test('A4 收藏归一：坏条目进 dropped 不补假值；重复去重；超上限只截不丢计数', async () => {
    const m = await loadMod(ROOT, TE_REL);
    const r = m.normalizePins([{ appId: 'a' }, { appId: 'a' }, { nope: 1 }, 'x', { appId: 'b' }], 3);
    assert.equal(r.state, 'ok');
    assert.deepEqual(r.pins.map((p) => p.appId), ['a', 'b'], '重复与坏条目都要被收掉');
    assert.equal(r.dropped, 3, '坏条目（1 重复 + 2 形态坏）必须如实计数，实测 ' + r.dropped);
    const over = m.normalizePins([{ appId: 'a' }, { appId: 'b' }, { appId: 'c' }], 2);
    assert.equal(over.pins.length, 2, '超上限截断');
    assert.equal(over.why, m.TE_REASONS.TOO_MANY_PINS, '超上限要说明成因');
    assert.equal(over.dropped, 1, '被截掉的要计数');
    assert.equal(m.normalizePins([], 3).state, 'empty');
    assert.equal(m.normalizePins(undefined, 3).state, 'absent');
});

test('A5 收藏开关：同一条收藏两次回到原状、无效输入不算变更、上限满时如实报（不静默顶掉别人）', async () => {
    const m = await loadMod(ROOT, TE_REL);
    const a1 = m.togglePin([], 'x', null);
    assert.equal(a1.changed, 'added');
    assert.deepEqual(a1.pins.map((p) => p.appId), ['x']);
    const a2 = m.togglePin(a1.pins, 'x', null);
    assert.equal(a2.changed, 'removed');
    assert.equal(a2.pins.length, 0);
    /* 开关不是「只会删」：不在列表里就是加进来（**不静默吞掉**用户的动作）。 */
    const a3 = m.togglePin([{ appId: 'b' }], 'c', null);
    assert.equal(a3.changed, 'added');
    assert.deepEqual(a3.pins.map((p) => p.appId), ['b', 'c']);
    /* 无效 appId 才是「不算变更」的那一路。 */
    assert.equal(m.togglePin([{ appId: 'b' }], '', null).changed, '');
    assert.equal(m.togglePin([{ appId: 'b' }], '   ', null).changed, '');
    let pins = [];
    for (let i = 0; i < m.TE_PINS_MAX; i++) pins = m.togglePin(pins, 'app' + String(i), null).pins;
    assert.equal(pins.length, m.TE_PINS_MAX);
    const full = m.togglePin(pins, 'one-more', null);
    assert.equal(full.full, true, '上限满了要如实报 full');
    assert.equal(full.pins.length, m.TE_PINS_MAX, '满了不许悄悄顶掉别人');
    assert.equal(full.changed, '', '满了就是没变更，不许报 added');
});

test('A6 最近使用：委托 usage-tracker（不抄第二份），读不出与「没记录」分态，去不了的单列 stale', async () => {
    const m = await loadMod(ROOT, TE_REL);
    assert.equal(m.recentFromUsage(null, 3).state, 'unreadable', '读不出是 unreadable 不是 empty');
    assert.equal(m.recentFromUsage(undefined, 3).state, 'unreadable');
    assert.equal(m.recentFromUsage('nope', 3).state, 'unreadable');
    assert.equal(m.recentFromUsage({}, 3).state, 'empty', '没有记录是 empty 不是 unreadable');
    assert.equal(m.recentFromUsage({ days: {} }, 3).state, 'empty');
    /* 真读数（形态取自 usage-tracker 的 emptyUsage：{version, days:{日:{apps:{id:{count,ms}}}}）。 */
    const usage = {
        version: 1,
        days: {
            '2026-10-01': { apps: { musicdesk: { count: 5, ms: 60000 }, needsim: { count: 2, ms: 30000 } }, hours: {}, ms: 90000, count: 7 },
            '2026-10-02': { apps: { musicdesk: { count: 1, ms: 10000 }, retired_app_xyz: { count: 9, ms: 90000 } }, hours: {}, ms: 100000, count: 10 }
        },
        open: null
    };
    const r = m.recentFromUsage(usage, 6);
    assert.equal(r.state, 'ok');
    assert.ok(r.activeDays >= 2, '活跃天数由 usage-tracker 出口给出（实测 ' + r.activeDays + '）');
    const byId = {}; for (const x of r.items) byId[x.appId] = x;
    assert.ok(byId.musicdesk && byId.musicdesk.routed === true, '★ 在位 App 必须 routed:true');
    assert.ok(byId.retired_app_xyz, '★ 已退役的 appId 不许被静默丢掉');
    assert.equal(byId.retired_app_xyz.routed, false, '★ 去不了的单列 routed:false（点了没反应是本仓最贵的形态）');
    /* 顺序与计数必须来自 usage-tracker 的 topApps（不在这里抄第二份聚合）：按 count 降序。 */
    const routedIds = r.items.filter((x) => x.routed).map((x) => x.appId);
    assert.deepEqual(routedIds, ['musicdesk', 'needsim'], '按次数降序：' + JSON.stringify(routedIds));
    assert.equal(byId.musicdesk.count, 6, '同一 App 跨天计数须合并（5 + 1）');
    /* 出口自证：委托面必须真指向 usage-tracker 的两个出口。 */
    const src = readRel(TE_REL);
    assert.ok(src.indexOf('topApps') >= 0 && src.indexOf('usageSummary') >= 0,
        '★ 最近使用必须委托 usage-tracker 的两个出口（不在这里抄第二份聚合）');
    assert.ok(src.indexOf('usage-tracker.js') >= 0, '依赖面须指向 usage-tracker');
});

/* ══════════════════════════ B 面 页签真源对账 ══════════════════════════ */
test('B1 ★★★ 页签真源：TABS_BY_APP 逐条与 apps/** 真源码抽取结果集合相等（按 shape 分派）', async () => {
    const problems = await tabSourceJudge(ROOT);
    assert.deepEqual(problems, [], '页签真源漂移：' + problems.join(' | '));
});

test('B2 表覆盖面自证：登记在案的每个 appId 都真有对应源文件，且 shape 取值合法', async () => {
    const m = await loadMod(ROOT, TABSRC_REL);
    assert.ok(m.TAB_SOURCE_APPS.length >= 15, '覆盖面下限 15（实测 ' + m.TAB_SOURCE_APPS.length + '）');
    for (const id of m.TAB_SOURCE_APPS) {
        const row = m.TABS_BY_APP[id];
        assert.ok(m.TAB_SHAPES.indexOf(row.shape) >= 0, id + ' shape 非法');
        assert.ok(fs.existsSync(path.join(ROOT, row.file)), id + ' 声明的源文件不存在：' + row.file);
    }
    const rd = m.tabSourceReadings();
    assert.ok(rd.tabs >= 60, '页签总数下限 60（实测 ' + rd.tabs + '）');
    assert.equal(rd.apps, m.TAB_SOURCE_APPS.length);
});

test('B3 ★ tabState 三态：白名单含 ⇒ ok / 不含 ⇒ unsupported / 未登记 ⇒ unknown（未核对 ⇏ 通过）', async () => {
    const m = await loadMod(ROOT, TE_REL);
    assert.equal(m.tabState('musicdesk', 'lyrics').state, 'ok');
    assert.equal(m.tabState('musicdesk', 'no-such-tab').state, 'unsupported');
    assert.equal(m.tabState('no-such-app', 'x').state, 'unknown',
        '★ 未登记不许当支持 —— 那正是「未核对被显示成没问题」的形态');
    assert.equal(m.tabState('anything', null).state, 'ok', 'null 一律 ok（不声称页签）');
    /* 缺省吃真表：不传 tabMap 时也应给真结论（防「忘了传 ⇒ 一片 unknown」的假绿） */
    assert.equal(m.tabState('musicdesk', 'lyrics', undefined).state, 'ok', '缺省必须吃真表');
});

/* ══════════════════════════ C 面 三面交叉 ══════════════════════════ */
test('C1 ★★★ 卡 × 路由 × 页签三面交叉：每条靶心都有路由，声明的页签都在真源白名单里', async () => {
    const problems = await cardJudge(ROOT);
    assert.deepEqual(problems, [], '靶心脱钩：' + problems.join(' | '));
});

test('C2 靶心不可达时如实点名：appId 无路由的进 missing、页签坏的进 badTabs，不静默变「没这张卡」', async () => {
    const m = await loadMod(ROOT, TE_REL);
    const cards = [
        { id: 'x', label: 'X', hint: '', targets: [{ appId: 'no-such-app-xyz', tab: null, note: '' }] },
        { id: 'y', label: 'Y', hint: '', targets: [{ appId: 'musicdesk', tab: 'no-such-tab', note: '' }] },
        { id: 'z', label: 'Z', hint: '', targets: [{ appId: 'musicdesk', tab: 'lyrics', note: '' }] }
    ];
    const rows = m.availableCards(cards, {});
    const byId = {}; for (const r of rows) byId[r.id] = r;
    assert.equal(byId.x.usable, false);
    assert.equal(byId.x.why, m.TE_REASONS.APP_NOT_ROUTED);
    assert.deepEqual(byId.x.missing, ['no-such-app-xyz']);
    assert.equal(byId.y.usable, false, '★ 靶心坏掉时连 App 也不可达 —— 送去不存在的页签比不去更坏');
    assert.equal(byId.y.why, m.TE_REASONS.TAB_UNSUPPORTED);
    assert.deepEqual(byId.y.badTabs, ['musicdesk#no-such-tab']);
    assert.equal(byId.z.usable, true);
    assert.equal(byId.z.withTab, 1);
});

/* ══════════════════════════ D 面 派发面接线 ══════════════════════════ */
test('D1 ★★★ 装配器投页签必须在 render 之前（顺序即正确性），且走唯一归一实现', async () => {
    const problems = wiringJudge(ROOT);
    assert.deepEqual(problems, [], '接线面问题：' + problems.join(' | '));
    const idx = readRel(INDEX_REL);
    const a = idx.indexOf('applyOpenDetail(');
    const r = idx.indexOf('window.VirtualPhone[lazyRoute.key].render()', a);
    assert.ok(a > 0 && r > a, '投递在 render 之前');
});

test('D2 唯一一支笔：9 处既有派发点仍是旧形态（不得被本版顺手改写），新入口走 buildOpenDetail', async () => {
    const detail = await loadMod(ROOT, DETAIL_REL);
    assert.deepEqual(detail.buildOpenDetail('a', null), { appId: 'a' },
        '★ tab 为 null 时**不写这个字段** —— 既有派发点的载荷必须逐字节不变（白改是倒退）');
    assert.deepEqual(detail.buildOpenDetail('a', 'lyrics'), { appId: 'a', tab: 'lyrics' });
    assert.deepEqual(detail.buildOpenDetail('a', ''), { appId: 'a' }, '空串不算页签');
    assert.deepEqual(detail.buildOpenDetail('a', 5), { appId: 'a' }, '非字符串不算页签');
});

test('D3 载荷归一：非对象 / 缺 appId / tab 形态不对三态分列（不塌成一格）', async () => {
    const d = await loadMod(ROOT, DETAIL_REL);
    assert.equal(d.normalizeOpenDetail(null).why, d.OPEN_DETAIL_REASONS.NOT_OBJECT);
    assert.equal(d.normalizeOpenDetail({}).why, d.OPEN_DETAIL_REASONS.BAD_APP_ID);
    assert.equal(d.normalizeOpenDetail({ appId: 'a', tab: 5 }).why, d.OPEN_DETAIL_REASONS.BAD_TAB_SHAPE);
    assert.equal(d.normalizeOpenDetail({ appId: 'a', tab: 5 }).tab, null, '形态不对归 null，不把坏值往下传');
    assert.equal(d.normalizeOpenDetail({ appId: 'a' }).why, '', '没给 tab 是正常，不是错误');
    assert.equal(d.normalizeOpenDetail({ appId: 'a', tab: 'x' }).tab, 'x');
});

test('D4 投递口：真调到 setTab；没有这个口如实报 no-set-tab（不假装投过）', async () => {
    const d = await loadMod(ROOT, DETAIL_REL);
    const calls = [];
    const r = d.applyOpenDetail({ setTab: (t) => { calls.push(t); } }, { appId: 'a', tab: 'lyrics', ok: true, why: '' });
    assert.equal(r.applied, true);
    assert.deepEqual(calls, ['lyrics']);
    assert.equal(d.applyOpenDetail({}, { appId: 'a', tab: 'lyrics', ok: true, why: '' }).why, 'no-set-tab');
    assert.equal(d.applyOpenDetail(null, { appId: 'a', tab: 'lyrics', ok: true, why: '' }).why, 'no-instance');
    assert.equal(d.applyOpenDetail({ setTab: () => {} }, { appId: 'a', tab: null, ok: true, why: '' }).applied, false,
        'tab 为 null 直接不做（不是失败）');
});

/* ══════════════════════════ E 面 负控制（真源码破坏） ══════════════════════════ */
test('E1 ★★ 破坏页签真源（改一个不存在的页签名）⇒ B 面同款判据在副本上必须转红', async () => {
    const dir = damage(TABSRC_REL,
        'tabs: Object.freeze([' + Q + 'shelf' + Q + ', ' + Q + 'lyrics' + Q + ', ' + Q + 'queue' + Q + ', ' + Q + 'source' + Q + ', ' + Q + 'form' + Q + ', ' + Q + 'policy' + Q + '])',
        'tabs: Object.freeze([' + Q + 'shelf' + Q + ', ' + Q + 'no_such_tab' + Q + '])');
    const before = await tabSourceJudge(ROOT);
    assert.deepEqual(before, [], '真仓先必须干净（否则破坏对比无意义）');
    const after = await tabSourceJudge(dir);
    assert.ok(after.length > 0, '★ 破坏后必须转红');
    assert.ok(after.some((p) => p.indexOf('页签漂移') >= 0), '必须是「漂移」这一类红：' + after.join(' | '));
});
test('E2 ★★ 破坏源码白名单（把某 App 的页签数组删一个成员）⇒ B 面判据必须转红', async () => {
    /* 锚点选 `const ok = [...]` 整行 —— 裸的 `'needs', 'pool'` 在本文件出现 2 次
     *   （另一处在别的方法的 tabs 声明里），锚点不唯一时 damage 会抛，
     *   而「锚点撞车」与「判据没反应」是两件不同的事，必须用唯一锚点测后者。 */
    const dir = damage('apps/needsim/needsim-app.js',
        'const ok = [' + Q + 'needs' + Q + ', ' + Q + 'pool' + Q + ', ' + Q + 'wish' + Q + ', ' + Q + 'memory' + Q + ', ' + Q + 'ledger' + Q + ', ' + Q + 'policy' + Q + '];',
        'const ok = [' + Q + 'needs' + Q + ', ' + Q + 'pool' + Q + ', ' + Q + 'wish' + Q + ', ' + Q + 'memory' + Q + ', ' + Q + 'ledger' + Q + '];');
    const after = await tabSourceJudge(dir);
    assert.ok(after.some((p) => p.indexOf('needsim') >= 0 && p.indexOf('页签漂移') >= 0),
        '★ 源码侧改动必须被真读源码的判据抓住：' + after.join(' | '));
});
test('E3 ★★ 破坏卡表靶心（把一个正确页签改成不存在的）⇒ C 面判据必须转红', async () => {
    const dir = damage(TE_REL, '{ appId: ' + Q + 'musicdesk' + Q + ', tab: ' + Q + 'shelf' + Q,
        '{ appId: ' + Q + 'musicdesk' + Q + ', tab: ' + Q + 'no_such' + Q);
    const after = await cardJudge(dir);
    assert.ok(after.some((p) => p.indexOf('musicdesk#no_such') >= 0), '★ 必须点名到具体靶心：' + after.join(' | '));
});

test('E4 ★★ 破坏接线顺序（把投递挪到 render 之后）⇒ D 面判据必须转红', async () => {
    const src = readRel(INDEX_REL);
    /* 只移动「哪一段先出现」：把投递块整段搬到 render 调用之后。
     *   锚点用装配器里那两行的**唯一**组合（恰中 1 次由 damage 保证）。 */
    const block = 'const openRes = applyOpenDetail(window.VirtualPhone[lazyRoute.key], normalizeOpenDetail(e.detail));';
    const render = 'window.VirtualPhone[lazyRoute.key].render();';
    const i = src.indexOf(block);
    const j = src.indexOf(render, i);
    assert.ok(i > 0 && j > i, '真仓锚点必须存在且有序（接线面被改动时这条会先红）');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rp_v3650_'));
    temps.push(dir);
    const moved = src.slice(0, i) + src.slice(j, j + render.length) + NL + src.slice(i, j) + src.slice(j + render.length);
    fs.writeFileSync(path.join(dir, INDEX_REL), moved);
    const after = wiringJudge(dir);
    assert.ok(after.length > 0, '★ 把投递挪到 render 之后必须被判红：' + JSON.stringify(after));
});

test('E5 ★★ 破坏 keys 登记（删掉 te_pins 登记行）⇒ V 面判据必须转红', async () => {
    const dir = damage(KEYS_REL, Q + 'te_pins' + Q + ', scope: ' + Q + 'chat' + Q + ', note:', Q + 'te_pins_x' + Q + ', scope: ' + Q + 'chat' + Q + ', note:');
    const after = registryJudge(dir);
    assert.ok(after.some((p) => p.indexOf('te_pins') >= 0), '★ 未登记必须报红：' + after.join(' | '));
});

test('E6 负控制自证：破坏锚点不唯一时必须抛（不许把「恰中多次」当成功）', async () => {
    assert.throws(() => damage(KEYS_REL, 'scope:', 'scope_x:'), /恰中 1 次/,
        '★ 锚点不唯一必须抛 —— 否则「破坏了别处」会被当成判据没反应');
});

/* ══════════════════════════ V 面 版本与登记 ══════════════════════════ */
test('V1 登记面：两个会话键进了 keys-audit，^te_ 进了 storage 的会话前缀族', async () => {
    const problems = registryJudge(ROOT);
    assert.deepEqual(problems, [], problems.join(' | '));
});

test('V2 本套件只在 3.65.0 及以后成立（版本下限锚）', () => {
    const pkg = JSON.parse(readRel('package.json'));
    const toNum = (v) => String(v).split('.').map((x) => Number.parseInt(x, 10)).reduce((a, b) => a * 1000 + b, 0);
    assert.ok(toNum(pkg.version) >= toNum(MIN_VERSION),
        '本套件要求 package.version >= ' + MIN_VERSION + '（实测 ' + pkg.version + '）');
});

test('V3 结构自证：扫描面非空（防「空对空」全绿）', async () => {
    const m = await loadMod(ROOT, TABSRC_REL);
    assert.ok(m.TAB_SOURCE_APPS.length > 0, '页签表不得为空');
    const te = await loadMod(ROOT, TE_REL);
    assert.ok(te.TE_CARDS.length > 0, '卡表不得为空');
    const files = ['config/task-entry.js', TABSRC_REL, DETAIL_REL, 'apps/taskentry/taskentry-app.js', VIEW_REL];
    for (const f of files) assert.ok(fs.existsSync(path.join(ROOT, f)), '缺文件：' + f);
});
