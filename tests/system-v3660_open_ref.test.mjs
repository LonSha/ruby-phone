// tests/system-v3660_open_ref.test.mjs — 跨 App「定位引用」（X2 第一切片）[v3.66.0]
//
// 本套件守六面（每面都对着**磁盘真源**算，不读被测模块的自述）：
//   A 面 协议：`config/open-ref.js` 的七 kind 登记 / 六归因态 / 归一与投递（真模块真调）；
//   B 面 源侧：引擎 7 条新源逐条 `meta.ref` 必须**自身归一成立**，且 id 必须取自真源里
//     既有的稳定 id（不是下标）——「索引到了」与「点得回去」是两件事；
//   C 面 消费侧：六个 App 的 `openRef` 在同一 id 上必须命中同一条，**且删中间项后仍命中
//     同一条**（按 id 现找的判据；按下标的实现会在这里串项，不报错、只串项）；
//   D 面 派发面接线：search-view 的 `_row` 必须渲 `data-ref`、`_bindItems` 必须走
//     `buildOpenDetail` 派发；装配器必须在 `render()` **之前**投靶心（顺序即正确性）；
//   E 面 负控制：真源码定点破坏 ⇒ 同款真判据在副本树上必须转红（破坏不落真仓）；
//   V 面 版本与导出面：本套件只在当版及以后成立 + 协议件导出面恒定。
//
// 判据纪律（本仓硬纪律）：锚点必须恰中 1 次（不唯一即抛）；破坏只落副本树；
//   判据不得引用被测模块的自述常量当结论（自述与声明分开存放才有判别力）。
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
const DQ = String.fromCharCode(34);
const NL = String.fromCharCode(10);
const REF_REL = 'config/open-ref.js';
const ENGINE_REL = 'apps/memory/global-search-engine.js';
const SEARCH_VIEW_REL = 'apps/search/search-view.js';
const MATRIX_REL = 'config/app-consumption-matrix.js';
const INDEX_REL = 'index.js';
const MIN_VERSION = '3.66.0';
/** 本切片接的六个 App 与它们各自的 kind（与协议件登记表**分开声明**：同源自述恒绿）。 */
const EXPECT_KINDS = Object.freeze({
    expense: 'traveldesk', memory: 'summdesk', item: 'annidate',
    song: 'musicdesk', novel: 'pixiv', illust: 'pixiv', article: 'lofter'
});
const EXPECT_APPS = Object.freeze(['traveldesk', 'summdesk', 'annidate', 'musicdesk', 'pixiv', 'lofter']);
const readRel = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const temps = [];
process.on('exit', () => {
    for (const d of temps) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (_e) { /* 忽略 */ } }
});
/** 内存 storage 替身：只实现本层真正用到的 get/set（与 v216 同款）。 */
function mkStorage(seed = {}) {
    const d = Object.assign({}, seed);
    const writes = [];
    return {
        d, writes,
        get(k, dflt = null) { return (k in d) ? d[k] : dflt; },
        set(k, v) { d[k] = v; writes.push({ key: k, value: v }); }
    };
}
function mkTemp(prefix) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    temps.push(dir);
    return dir;
}
/** 真源码破坏：锚点必须**恰中一次**（多一点即意味着改了不该改的地方）。
 *  ★ 副本树必须**够模块加载**：被破坏的模块静态 import 同目录 / 相邻目录依赖，
 *   副本树若只有被破坏那一件，ESM 解析相对依赖会 MODULE_NOT_FOUND —— 那是
 *   **判据基建坏了**，会被误读成「破坏没反应」。故：
 *    · 一律带一份完整 `config/`（write-receipt / open-ref / num-gate / … 都在这里）；
 *    · 破坏 `apps/<x>/…` 时额外带该 App 的**整个目录**（data / view 与 app 同目录）；
 *    · 只读源码文本的判据不受此限（走 readFrom，副本优先、缺则回落真仓）。 */
function damage(rel, anchor, replacement) {
    const dir = mkTemp('rp_v3660_');
    copyTreeSafe(path.join(ROOT, 'config'), path.join(dir, 'config'));
    if (rel.indexOf('apps/') === 0) {
        const seg = rel.split('/')[1];
        copyTreeSafe(path.join(ROOT, 'apps', seg), path.join(dir, 'apps', seg));
    }
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
}/* ══════════════════════════ A 面 协议（config/open-ref.js） ══════════════════════════ */
test('A1 ★★★ 登记表：本切片声明的七个 kind 逐条在场，且归属 App 与声明一致', async () => {
    const m = await loadMod(ROOT, REF_REL);
    const kinds = Object.keys(m.OPEN_REF_KINDS);
    assert.deepEqual(kinds.slice().sort(), Object.keys(EXPECT_KINDS).slice().sort(),
        '★ 登记表与套件声明必须逐条对齐（登记表是消费侧的判据真源，必须独立对账）');
    for (const [kind, appId] of Object.entries(EXPECT_KINDS)) {
        assert.equal(m.OPEN_REF_KINDS[kind].appId, appId, kind + ' 的归属 App 漂了');
        assert.ok(String(m.OPEN_REF_KINDS[kind].label || '').length > 0, kind + ' 缺 label（诊断视图要用）');
    }
    const self = m.openRefSelfCheck();
    assert.deepEqual(self.problems, [], self.problems.join(' | '));
});
test('A2 ★★★ 归一六态分列：结构 / kind / appId / 归属 / id 各自一态（不塌成一格）', async () => {
    const m = await loadMod(ROOT, REF_REL);
    const R = m.OPEN_REF_REASONS;
    assert.equal(m.normalizeOpenRef(null).why, R.NOT_OBJECT);
    assert.equal(m.normalizeOpenRef([]).why, R.NOT_OBJECT, '★ 数组不是 ref（不许当对象收下）');
    assert.equal(m.normalizeOpenRef('expense').why, R.NOT_OBJECT, '★ 裸串不是 ref');
    assert.equal(m.normalizeOpenRef({ kind: 'nope', id: '1', appId: 'traveldesk' }).why, R.KIND_UNKNOWN,
        '★ 未登记的 kind 一律不投（否则「投到没人认的类型」会静默）');
    assert.equal(m.normalizeOpenRef({ kind: 'expense', id: '1' }).why, R.NO_APP);
    assert.equal(m.normalizeOpenRef({ kind: 'expense', id: '1', appId: 'lofter' }).why, R.APP_MISMATCH,
        '★ kind 与 appId 必须自洽（novel 投到 lofter 会报「文章没了」，用户以为被删）');
    assert.equal(m.normalizeOpenRef({ kind: 'expense', id: '  ', appId: 'traveldesk' }).ok, false,
        '★ 纯空白 id 不算 id（否则「投了但找不到」会伪装成正常投递）');
    assert.equal(m.normalizeOpenRef({ kind: 'expense', id: 'tv_e_1', appId: 'traveldesk' }).ok, true);
    assert.equal(m.normalizeOpenRef({ kind: 'song', id: 7, appId: 'musicdesk' }).id, '7',
        '★ 数字形 id 必须收成字符串再比（曲库 id 有下标形与稳定 id 两种）');
});
test('A3 ★★ 源侧那支笔不做归一：坏值要**看得见**，不在写的时候悄悄修好', async () => {
    const m = await loadMod(ROOT, REF_REL);
    const bad = m.buildOpenRef('nope', 'x', 'nopeapp');
    assert.equal(bad.kind, 'nope');
    assert.equal(bad.appId, 'nopeapp', '★ buildOpenRef 不许替源侧猜归属');
    assert.equal(m.normalizeOpenRef(bad).ok, false, '坏 ref 归一必须失败（由 B 面逐条判据当场抓）');
    assert.equal(m.sameRef({ kind: 'expense', id: 'a', appId: 'traveldesk' }, { kind: 'expense', id: 'a', appId: 'traveldesk' }), true);
    assert.equal(m.sameRef({ kind: 'expense', id: 'a', appId: 'traveldesk' }, { kind: 'expense', id: 'b', appId: 'traveldesk' }), false);
    assert.equal(m.sameRef({ kind: 'nope', id: 'a', appId: 'x' }, { kind: 'nope', id: 'a', appId: 'x' }), false,
        '★ 两条坏 ref 不得判成相等（自查不出错的那类相等必须为假）');
});
test('A4 ★★★ 投递五态：没抛 ≠ 定位到了（silent 必须自成一态）', async () => {
    const m = await loadMod(ROOT, REF_REL);
    const ok = m.normalizeOpenRef({ kind: 'expense', id: 'a', appId: 'traveldesk' });
    assert.equal(m.applyOpenRef(null, ok).why, 'no-instance');
    assert.equal(m.applyOpenRef({}, ok).why, 'no-open-ref');
    assert.equal(m.applyOpenRef({ openRef: () => { throw new Error('x'); } }, ok).why, 'open-ref-threw');
    assert.equal(m.applyOpenRef({ openRef: () => ({ ok: false, reason: 'not_found' }) }, ok).why, 'target-missed:not_found',
        '★ 目标报了没找到 ⇒ 归因必须带出目标给的理由（不是含糊的「失败」）');
    assert.equal(m.applyOpenRef({ openRef: () => undefined }, ok).why, 'target-silent',
        '★★ 函数没抛但也没回报 ok:true ⇒ **不算成功**（本仓最贵的形态：不报错、只是没生效）');
    const r = m.applyOpenRef({ openRef: () => ({ ok: true }) }, ok);
    assert.equal(r.applied, true);
    assert.equal(r.why, '');
    assert.equal(m.applyOpenRef({ openRef: () => ({ ok: true }) }, { appId: 'x', kind: 'nope', id: '1' }).applied, false,
        '★ 归一不成立时**根本不投**（不许先投再说）');
});
/* ══════════════════════════ B 面 源侧（引擎 7 条新源） ══════════════════════════ */
/** 本切片六桶的**真实存储形状** seed（字段名逐条对齐各 App 的落盘键与归一产物）。 */
const SRC_IDS = Object.freeze([
    'traveldesk-expense', 'summdesk-memory', 'annidate-item',
    'musicdesk-song', 'pixiv-novel', 'pixiv-illust', 'lofter-article'
]);
function seedStorage() {
    return mkStorage({
        tv_book: { people: ['我', '她'], families: [], expenses: [
            { id: 'tv_e_a', payer: '我', type: 'shared', currency: 'CNY', amount: 300, finalCNY: 300, note: '机票' },
            { id: 'tv_e_b', payer: '她', type: 'shared', currency: 'JPY', amount: 12000, rate: 0.048, unit: 1, finalCNY: 576, note: '拉面' },
            { id: 'tv_e_c', payer: '我', type: 'shared', currency: 'CNY', amount: 88, finalCNY: 88, note: '门票' }
        ] },
        sm_memories: [
            { id: 'sm_m_a', title: '第一次见面', content: '在便利店门口躲雨', timestamp: 1700000000000 },
            { id: 'sm_m_b', title: '搬家那天', content: '她带来了三箱书', timestamp: 1700100000000 },
            { id: 'sm_m_c', title: '冬天', content: '一起看了第一场雪', timestamp: 1700200000000 }
        ],
        ad_items: [
            { id: 'ad_i_a', title: '她的生日', date: 1700300000000, isStarred: true, note: '要提前订蛋糕' },
            { id: 'ad_i_b', title: '相识纪念', date: 1700400000000, isStarred: false, note: '' },
            { id: 'ad_i_c', title: '第一次旅行', date: 1700500000000, isStarred: false, note: '海边' }
        ],
        musicdesk_lib: { songs: [
            { id: 'mus_a', name: '雨', artist: 'A', album: 'Alb1', seconds: 210 },
            { id: 'mus_b', name: '夜', artist: 'B', album: 'Alb2', seconds: 190 },
            { id: 'mus_c', name: '晴', artist: 'C', album: 'Alb3', seconds: 230 }
        ] },
        pixiv_content: {
            authors: [],
            novels: [
                { id: 'n_a', title: '第一篇', authorName: '作者甲', synopsis: '简介一', chapters: [] },
                { id: 'n_b', title: '第二篇', authorName: '作者乙', synopsis: '简介二', chapters: [] },
                { id: 'n_c', title: '第三篇', authorName: '作者丙', synopsis: '简介三', chapters: [] }
            ],
            illustrations: [
                { id: 'i_a', prompt: 'p1', size: 'S', count: 1, drawnBy: '画师甲' },
                { id: 'i_b', prompt: 'p2', size: 'S', count: 1, drawnBy: '画师乙' },
                { id: 'i_c', prompt: 'p3', size: 'S', count: 1, drawnBy: '画师丙' }
            ]
        },
        lofter_content: {
            authors: [],
            articles: [
                { id: 'a_a', title: '文章一', summary: '摘要一', tags: ['tagA'] },
                { id: 'a_b', title: '文章二', summary: '摘要二', tags: ['tagB'] },
                { id: 'a_c', title: '文章三', summary: '摘要三', tags: ['tagC'] }
            ],
            collections: []
        }
    });
}
async function engineSources(dir, storage) {
    const eng = await loadMod(dir, ENGINE_REL);
    return eng.buildDefaultSources(storage, {});
}
/** 源侧靶心的**文本面**判据（可跑在副本树上，不 import 引擎 —— 副本树里没有 data/）：
 *  逐条要求引擎源码里出现「该 kind 的靶心是用唯一一支笔写出来的」。
 *  ⚠ 这条不是运行时判据，故与下面的运行时判据**分开报**，不许互相顶替。 */
function sourceRefTextJudge(dir) {
    const problems = [];
    const src = readFrom(dir, ENGINE_REL);
    for (const [kind, appId] of Object.entries(EXPECT_KINDS)) {
        const anchor = 'buildOpenRef(' + Q + kind + Q + ', id, ' + Q + appId + Q + ')';
        if (src.indexOf(anchor) < 0) problems.push('源侧缺靶心（文本面）：' + kind + ' → ' + appId);
    }
    return problems;
}
test('B0 ★★ 源侧文本面自证：七条 kind 的靶心都用唯一一支笔写在引擎源码里', async () => {
    const problems = sourceRefTextJudge(ROOT);
    assert.deepEqual(problems, [], problems.join(' | '));
});
test('B1 ★★★ 七条新源在场，且每条逐条命中真源里的**稳定 id**', async () => {
    const m = await loadMod(ROOT, REF_REL);
    const sources = await engineSources(ROOT, seedStorage());
    const byId = new Map(sources.map((s) => [s.id, s]));
    for (const sid of SRC_IDS) {
        assert.ok(byId.has(sid), '★ 源表缺本切片登记的源：' + sid);
        const items = byId.get(sid).items();
        assert.ok(items.length >= 3, sid + ' 的 seed 有 3 条却只索引出 ' + items.length + ' 条（源侧没真读到）');
        for (const it of items) {
            const ref = it.meta && it.meta.ref;
            assert.ok(ref, '★ 源条目必须带靶心（否则「搜到了」与「点得回去」之间没有桥）：' + sid);
            const n = m.normalizeOpenRef(ref);
            assert.equal(n.ok, true, '★★ 源侧写出的 ref 必须**自身归一成立**（写坏值要当场看见）：'
                + sid + ' → ' + JSON.stringify(ref) + ' / ' + n.why);
            assert.equal(n.appId, byId.get(sid).appId,
                '★ 靶心的归属 App 必须与源条目所属 App 一致（错配会报「这条没了」，用户以为被删）');
        }
    }
});
test('B2 ★★★ 靶心 id 是稳定 id，不是下标：删中间一条后，剩两条的靶心一字不变', async () => {
    const m = await loadMod(ROOT, REF_REL);
    const idsOf = (items) => items.map((x) => m.normalizeOpenRef(x.meta.ref).id).sort();
    const before = new Map();
    for (const s of await engineSources(ROOT, seedStorage())) {
        if (SRC_IDS.indexOf(s.id) < 0) continue;
        before.set(s.id, idsOf(s.items()));
    }
    const s2 = seedStorage();
    /* 删中间那条（第 2 条）——按下标派生的实现会在这里把 id 整体前移一位。 */
    s2.d.tv_book.expenses.splice(1, 1);
    s2.d.sm_memories.splice(1, 1);
    s2.d.ad_items.splice(1, 1);
    s2.d.musicdesk_lib.songs.splice(1, 1);
    s2.d.pixiv_content.novels.splice(1, 1);
    s2.d.pixiv_content.illustrations.splice(1, 1);
    s2.d.lofter_content.articles.splice(1, 1);
    for (const s of await engineSources(ROOT, s2)) {
        if (SRC_IDS.indexOf(s.id) < 0) continue;
        const after = idsOf(s.items());
        const kept = before.get(s.id).filter((x) => after.indexOf(x) >= 0);
        assert.equal(kept.length, 2, '★ 删中间一条后，剩余两条的靶心必须原样还在：' + s.id
            + ' before=' + JSON.stringify(before.get(s.id)) + ' after=' + JSON.stringify(after));
        assert.equal(after.length, 2, s.id + ' 删后应剩 2 条');
    }
});
test('B3 ★★★ 源侧 id 与 App 侧归一**同一口径**：两侧派生出的 id 必须逐条相等', async () => {
    const m = await loadMod(ROOT, REF_REL);
    const sources = await engineSources(ROOT, seedStorage());
    /* 逐条核：源侧索引出来的 id 必须等于「把同一份 seed 喂给 App 的归一函数」得到的 id。
     *   两侧各派生一次 id 时，只要有一侧写了兜底形（`tv_e_<下标>`），这条判据就会当场红 ——
     *   而不是等到用户点进去得到 not_found 才知道。 */
    const cases = [
        ['traveldesk-expense', 'apps/traveldesk/traveldesk-data.js', 'normalizeExpenses', 'expenses'],
        ['summdesk-memory', 'apps/summdesk/summdesk-data.js', 'normalizeMemories', 'memories'],
        ['annidate-item', 'apps/annidate/annidate-data.js', 'normalizeItems', 'items']
    ];
    const st = seedStorage();
    const args = {
        'traveldesk-expense': [st.d.tv_book.expenses, st.d.tv_book.people],
        'summdesk-memory': [st.d.sm_memories],
        'annidate-item': [st.d.ad_items]
    };
    for (const [sid, rel, fn, key] of cases) {
        const mod = await loadMod(ROOT, rel);
        const fromSource = sources.find((s) => s.id === sid).items()
            .map((x) => m.normalizeOpenRef(x.meta.ref).id).sort();
        const norm = mod[fn].apply(null, args[sid]);
        const fromApp = (norm[key] || []).map((x) => String(x.id)).sort();
        assert.deepEqual(fromSource, fromApp,
            '★★ 源侧索引的 id 与 App 侧归一出的 id 必须逐条相等（差一位就是「点进去找不到」）：' + sid);
    }
});/* ══════════════════════════ C 面 消费侧（六个 App 的 openRef） ══════════════════════════ */
/** 六个 App 的构造与「定位到的那一条」的取证口（同一 id 必须命中同一条）。 */
const CONSUME = Object.freeze([
    { app: 'traveldesk', rel: 'apps/traveldesk/traveldesk-app.js', cls: 'TraveldeskApp',
        kind: 'expense', key: 'tv_book', field: 'expenses', seed: () => seedStorage().d.tv_book,
        ids: ['tv_e_a', 'tv_e_b', 'tv_e_c'], mid: 'tv_e_b', last: 'tv_e_c',
        peek: (inst, id) => { const r = inst.focusRow(); return r && r.id === id && r.gone === false ? r.note : null; },
        expect: '门票' },
    { app: 'summdesk', rel: 'apps/summdesk/summdesk-app.js', cls: 'SummdeskApp',
        kind: 'memory', key: 'sm_memories', field: null, seed: () => seedStorage().d.sm_memories,
        ids: ['sm_m_a', 'sm_m_b', 'sm_m_c'], mid: 'sm_m_b', last: 'sm_m_c',
        peek: (inst, id) => { const r = inst.focusRow(); return r && r.id === id && r.gone === false ? r.title : null; },
        expect: '冬天' },
    { app: 'annidate', rel: 'apps/annidate/annidate-app.js', cls: 'AnnidateApp',
        kind: 'item', key: 'ad_items', field: null, seed: () => seedStorage().d.ad_items,
        ids: ['ad_i_a', 'ad_i_b', 'ad_i_c'], mid: 'ad_i_b', last: 'ad_i_c',
        peek: (inst, id) => { const r = inst.focusRow(); return r && r.id === id && r.gone === false ? r.title : null; },
        expect: '第一次旅行' },
    { app: 'musicdesk', rel: 'apps/musicdesk/musicdesk-app.js', cls: 'MusicdeskApp',
        kind: 'song', key: 'musicdesk_lib', field: 'songs', seed: () => seedStorage().d.musicdesk_lib,
        ids: ['mus_a', 'mus_b', 'mus_c'], mid: 'mus_b', last: 'mus_c',
        peek: (inst, id) => { const s = inst.songs[Number(inst._current)]; return s && s.id === id ? s.name : null; },
        expect: '晴' },
    { app: 'pixiv', rel: 'apps/pixiv/pixiv-app.js', cls: 'PixivApp',
        kind: 'novel', key: 'pixiv_content', field: 'novels', seed: () => seedStorage().d.pixiv_content,
        ids: ['n_a', 'n_b', 'n_c'], mid: 'n_b', last: 'n_c',
        peek: (inst, id) => (inst.openedNovelId() === id ? inst.novelById(id).title : null),
        expect: '第三篇' },
    { app: 'lofter', rel: 'apps/lofter/lofter-app.js', cls: 'LofterApp',
        kind: 'article', key: 'lofter_content', field: 'articles', seed: () => seedStorage().d.lofter_content,
        ids: ['a_a', 'a_b', 'a_c'], mid: 'a_b', last: 'a_c',
        peek: (inst, id) => (inst.refArticleId() === id ? inst.articleById(id).title : null),
        expect: '文章三' }
]);
async function mkApp(dir, row, data) {
    const mod = await loadMod(dir, row.rel);
    const seed = {};
    seed[row.key] = data;
    return new mod[row.cls](null, mkStorage(seed));
}
test('C1 ★★★ 六个 App 都真接了定位口：同一 id 命中**同一条**（不是同名、不是邻居）', async () => {
    for (const row of CONSUME) {
        const inst = await mkApp(ROOT, row, row.seed());
        assert.equal(typeof inst.openRef, 'function', '★ ' + row.app + ' 没有 openRef ⇒ 引擎的靶心投过来会落在 no-open-ref（静默无形）');
        const r = inst.openRef({ kind: row.kind, id: row.mid, appId: row.app });
        assert.equal(r && r.ok, true, '★ ' + row.app + ' 定位未命中：' + JSON.stringify(r));
        const seen = row.peek(inst, row.mid);
        assert.ok(seen, '★ ' + row.app + ' 回报命中了，但详情态**没同步**（「投了但没画出来」本仓最贵形态）');
        assert.equal(inst.openRef({ kind: row.kind, id: 'no_such_id', appId: row.app }).ok, false,
            '★ ' + row.app + ' 对不存在的 id 必须**如实报 not_found**（不许静默成功）');
        assert.equal(inst.clearRef().ok, true, row.app + ' 的 clearRef 必须可用');
        assert.equal(row.peek(inst, row.mid), null, '★ ' + row.app + ' 清掉之后定位态必须真空（防「合上了但定位还在」）');
    }
});
test('C2 ★★★ 删中间项后仍命中同一条（按下标的实现会在这里串项，且不报错）', async () => {
    for (const row of CONSUME) {
        const data = JSON.parse(JSON.stringify(row.seed()));
        const list = row.field ? data[row.field] : data;
        list.splice(1, 1);
        const inst = await mkApp(ROOT, row, data);
        const gone = inst.openRef({ kind: row.kind, id: row.mid, appId: row.app });
        assert.equal(gone.ok, false, '★ ' + row.app + ' 对**被删掉的那一条**必须报失败（不是随便指一条）：' + JSON.stringify(gone));
        assert.equal(gone.reason, 'not_found', row.app + ' 的归因词应为 not_found，实得 ' + gone.reason);
        const hit = inst.openRef({ kind: row.kind, id: row.last, appId: row.app });
        assert.equal(hit.ok, true, '★ ' + row.app + ' 删中间项后末条仍须命中：' + JSON.stringify(hit));
        assert.equal(row.peek(inst, row.last), row.expect,
            '★★ ' + row.app + ' 命中的**不是**那一条（按下标定位会串到邻居头上，且一个字都不报）');
    }
});
test('C3 ★★ 跨 kind 不误伤：pixiv 的 novel / illust 两个 kind 各认各的', async () => {
    const inst = await mkApp(ROOT, CONSUME[4], seedStorage().d.pixiv_content);
    const n = inst.openRef({ kind: 'novel', id: 'n_b', appId: 'pixiv' });
    assert.equal(n.ok, true);
    assert.equal(inst.openedNovelId(), 'n_b');
    const i = inst.openRef({ kind: 'illust', id: 'i_b', appId: 'pixiv' });
    assert.equal(i.ok, true);
    assert.equal(inst.openedIllustId(), 'i_b');
    assert.equal(inst.openRef({ kind: 'illust', id: 'n_b', appId: 'pixiv' }).ok, false,
        '★ 拿小说 id 去查插画必须失败（两个 kind 的池子不同，串池会指到不相干的一条）');
    inst.clearRef();
    assert.equal(inst.openedIllustId(), '', '清定位态必须两个 kind 一起清（留一个会让下次打开停在上个会话的作品上）');
});/* ══════════════════════════ D 面 派发面接线 ══════════════════════════ */
/** search-view 接线面（真读源码文本；返回问题码数组，空数组 = 干净）。 */
function searchWiringJudge(dir) {
    const problems = [];
    const src = readFrom(dir, SEARCH_VIEW_REL);
    if (src.indexOf('buildOpenDetail') < 0) {
        problems.push('search-view 没有走唯一一支笔（buildOpenDetail）');
    }
    /* ⚠ 只查「有没有把进口接上」这一条真判据：首版写成 `A 缺 && B 缺`，
     *   而 B（函数调用处出现 `buildOpenDetail }`）**恒成立**，于是这条永远为假 ⇒
     *   去掉 import 也照样全绿。这是本仓反复登记的「自查不出错的那类判据必须为假」同款。 */
    if (src.indexOf('import ' + '{ buildOpenDetail }') < 0) {
        problems.push('search-view 没有把 buildOpenDetail 接进来（模块写了但没 import ⇒ 跑起来直接 ReferenceError）');
    }
    const rowAt = src.indexOf('_row(it, kw) {');
    const bindAt = src.indexOf('_bindItems() {');
    if (rowAt < 0 || bindAt < 0 || bindAt < rowAt) { problems.push('search-view 行渲染 / 绑定两处结构没抽到'); return problems; }
    const rowBody = src.slice(rowAt, bindAt);
    if (rowBody.indexOf('data-ref') < 0) problems.push('行上没有靶心（data-ref）⇒ 点进去只能落在 App 首屏');
    const bindBody = src.slice(bindAt);
    /* ⚠ 必须钉**真读取点**（`item.dataset.ref`）而不是裸的 `data-ref` 字样：
     *   绑定的注释里也写着 `data-ref`，按字样查会恒绿 —— 去掉真读取照样全绿。 */
    if (bindBody.indexOf('item.dataset.ref') < 0) {
        problems.push('绑定时不读 data-ref ⇒ 渲了靶心也没人投出去（本仓最贵的「写了零消费」形态）');
    }
    if (bindBody.indexOf('buildOpenDetail(') < 0) problems.push('派发载荷没有走唯一一支笔');
    if (bindBody.indexOf('console.warn') < 0) {
        problems.push('解析失败必须出声（静默退化会让「靶心坏了」与「本来就没有靶心」长得一样）');
    }
    return problems;
}
/** 装配器接线面：投靶心必须在 render **之前**（顺序即正确性）。 */
function dispatchOrderJudge(dir) {
    const problems = [];
    const idx = readFrom(dir, INDEX_REL);
    const impAt = idx.indexOf('import { applyOpenRef }');
    if (impAt < 0) problems.push('index.js 没有 import applyOpenRef（模块写了但没人调）');
    const refAt = idx.indexOf('applyOpenRef(window.VirtualPhone[lazyRoute.key]');
    if (refAt < 0) { problems.push('装配器没有投靶心'); return problems; }
    const renderAt = idx.indexOf('window.VirtualPhone[lazyRoute.key].render()', refAt);
    if (renderAt < 0) problems.push('装配器里找不到投靶心之后的 render');
    else if (renderAt < refAt) problems.push('投靶心在 render 之后（目标只点亮详情态、自己不渲染 ⇒ 画不出来）');
    if (idx.indexOf('if (refRes && refRes.applied === false') < 0) {
        problems.push('未定位到靶心时必须出声（不许静默）');
    }
    return problems;
}
/** 矩阵声明侧：本切片六件的 F2 必须为 true（与引擎源表复算双向对账）。 */
function matrixF2Judge(dir) {
    const problems = [];
    const eng = readFrom(dir, ENGINE_REL);
    /* ⚠ 引擎源表用**单引号**、矩阵用**双引号**（两处风格不同由各件自身决定）。
     *   判据必须按各自真源的字面量查：首版两处都按单引号查，于是矩阵「一行都找不到」，
     *   六件全报「矩阵缺行」——那是**判据基建坏了**，不是矩阵坏了。 */
    const declared = new Set([...eng.matchAll(new RegExp('appId: ' + Q + '([^' + Q + ']+)' + Q, 'g'))].map((m) => m[1]));
    const mx = readFrom(dir, MATRIX_REL);
    for (const app of EXPECT_APPS) {
        const at = mx.indexOf('{ appId: ' + DQ + app + DQ);
        if (at < 0) { problems.push('矩阵缺行：' + app); continue; }
        const line = mx.slice(at, mx.indexOf(NL, at));
        const want = declared.has(app);
        const got = line.indexOf('F2_search: true') >= 0;
        if (want !== got) problems.push('F2 声明与引擎源表不符：' + app + ' 声明=' + got + ' 源表=' + want);
    }
    return problems;
}
test('D1 ★★★ 派发面：search-view 渲靶心 + 绑定读靶心 + 走唯一一支笔（真读源码）', async () => {
    const problems = searchWiringJudge(ROOT);
    assert.deepEqual(problems, [], '接线面问题：' + problems.join(' | '));
});
test('D2 ★★★ 装配器：投靶心必须在 render 之前（挪到之后必须被判红）', async () => {
    const problems = dispatchOrderJudge(ROOT);
    assert.deepEqual(problems, [], '接线面问题：' + problems.join(' | '));
    const idx = readRel(INDEX_REL);
    const refAt = idx.indexOf('applyOpenRef(window.VirtualPhone[lazyRoute.key]');
    const renderAt = idx.indexOf('window.VirtualPhone[lazyRoute.key].render()', refAt);
    assert.ok(refAt > 0 && renderAt > refAt, '真仓锚点必须存在且有序');
});
test('D3 ★★ 矩阵声明侧与引擎源表双向对账：本切片六件 F2 必须同步转 true', async () => {
    const problems = matrixF2Judge(ROOT);
    assert.deepEqual(problems, [], problems.join(' | '));
    /* 反向自证：把六件里的某一格改回 false，同款判据必须能看见（防「判据读的是自己声明的表」）。 */
    const dir = damage(MATRIX_REL, '{ appId: ' + DQ + 'traveldesk' + DQ + ', name:', '{ appId: ' + DQ + 'traveldesk_x' + DQ + ', name:');
    const after = matrixF2Judge(dir);
    assert.ok(after.some((p) => p.indexOf('traveldesk') >= 0), '★ 判据必须真读矩阵，改坏即红：' + after.join(' | '));
});/* ══════════════════════════ E 面 负控制（真源码破坏，只落副本树） ══════════════════════════ */
test('E1 ★★★ 破坏源侧靶心（把旅行费用那条源的 meta.ref 去掉）⇒ B0 文本面判据必须转红', async () => {
    const anchor = 'meta: { ref: buildOpenRef(' + Q + 'expense' + Q + ', id, ' + Q + 'traveldesk' + Q + ') }';
    assert.deepEqual(sourceRefTextJudge(ROOT), [], '真仓先必须干净（否则破坏对比无意义）');
    const dir = damage(ENGINE_REL, anchor, 'meta: {}');
    const problems = sourceRefTextJudge(dir);
    assert.ok(problems.some((p) => p.indexOf('源侧缺靶心') >= 0),
        '★ 去掉靶心必须被判红：' + problems.join(' | '));
});
test('E2 ★★★ 破坏消费侧定位（找不到时不报失败，改成「随便指一条」）⇒ C2 同款判据必须转红', async () => {
    const anchor = "        if (!hit.length) return { ok: false, reason: 'not_found', id: id, saw: this._expenses.length };";
    const dir = damage('apps/traveldesk/traveldesk-app.js', anchor,
        "        if (!hit.length) { this._focus = this._expenses.length ? toStr(this._expenses[0].id) : ''; return { ok: true, id: id, index: 0 }; }");
    const mod = await loadMod(dir, 'apps/traveldesk/traveldesk-app.js');
    const inst = new mod.TraveldeskApp(null, mkStorage({ tv_book: seedStorage().d.tv_book }));
    /* 删中间那条 ⇒ 同款判据（「被删的那条必须报 not_found」）在破坏副本上必须不再成立。 */
    const r = inst.openRef({ kind: 'expense', id: 'tv_e_b', appId: 'traveldesk' });
    assert.equal(r.ok, true, '★ 破坏必须真改变行为（否则这条负控制是空转），实测：' + JSON.stringify(r));
    assert.notEqual(r.reason, 'not_found', '★ 真仓判据（如实报 not_found）在破坏副本上必须不再成立');
});
test('E3 ★★★ 破坏协议（把 silent 判成成功）⇒ A4 的判据在副本上必须不再成立', async () => {
    const head = '    if (!(r && typeof r === ' + Q + 'object' + Q + ' && r.ok === true)) {';
    const anchor = head + NL + '        return { applied: false, why: ' + Q + 'target-silent' + Q + ' };';
    const dir = damage(REF_REL, anchor,
        head + NL + '        return { applied: true, why: ' + Q + Q + ' };');
    const m = await loadMod(dir, REF_REL);
    const ok = m.normalizeOpenRef({ kind: 'expense', id: 'a', appId: 'traveldesk' });
    assert.equal(m.applyOpenRef({ openRef: () => undefined }, ok).applied, true,
        '★ 破坏必须真改变行为（否则这条负控制是空转）');
    assert.notEqual(m.applyOpenRef({ openRef: () => undefined }, ok).why, 'target-silent',
        '★ 真仓判据（silent 自成一态）在破坏副本上必须不再成立');
});
test('E4 ★★★ 破坏装配顺序（把投靶心挪到 render 之后）⇒ D2 必须转红', async () => {
    const src = readRel(INDEX_REL);
    const A = 'const refRaw = (e.detail && typeof e.detail === ' + Q + 'object' + Q + ' && e.detail.ref) ? e.detail.ref : null;';
    const R = 'window.VirtualPhone[lazyRoute.key].render();';
    const i = src.indexOf(A);
    const j = src.indexOf(R, i);
    assert.ok(i > 0 && j > i, '真仓锚点必须存在且有序（接线面被改动时这条会先红）');
    const two = 'const refRes = applyOpenRef(window.VirtualPhone[lazyRoute.key], refRaw);';
    const k = src.indexOf(two, i);
    assert.ok(k > i, '投靶心那行必须在场');
    const dir = mkTemp('rp_v3660_');
    copyTreeSafe(path.join(ROOT, 'config'), path.join(dir, 'config'));
    /* 只把「投靶心那两行」搬到 render 调用之后（其余一字不动）。 */
    const moved = src.slice(0, i) + src.slice(k + two.length, j + R.length) + NL
        + src.slice(i, k + two.length) + src.slice(j + R.length);
    fs.writeFileSync(path.join(dir, INDEX_REL), moved);
    const problems = dispatchOrderJudge(dir);
    /* 「投靶心在 render 之后」与「投靶心之后根本没有 render」都是同一种病（顺序被破坏），
     *   判据只认「同款判据在副本上必须转红」，不钉死是哪一句。 */
    assert.ok(problems.some((p) => p.indexOf('render') >= 0), '★ 挪到 render 之后必须被判红：' + problems.join(' | '));
});
test('E5 ★★ 破坏派发读靶心（绑定时不再读 data-ref）⇒ D1 必须转红', async () => {
    const dir = damage(SEARCH_VIEW_REL, 'const rawRef = item.dataset.ref;', "const rawRef = '';");
    const problems = searchWiringJudge(dir);
    assert.ok(problems.length > 0, '★ 渲了靶心却没人读必须被判红：' + problems.join(' | '));
});
test('E6 负控制自证：破坏锚点不唯一 / 不存在时必须抛（不许把「没改到」当成功）', async () => {
    assert.throws(() => damage(REF_REL, 'OPEN_REF_KINDS', 'OPEN_REF_KINDS_X'),
        /恰中 1 次/, '★ 锚点不唯一必须抛 —— 否则「破坏了别处」会被当成判据没反应');
    assert.throws(() => damage(REF_REL, 'this_anchor_does_not_exist_at_all', 'x'),
        /恰中 1 次/, '★ 锚点不存在同样必须抛（否则破坏没发生、判据却全绿，是最贵的假绿）');
});
/* ══════════════════════════ V 面 版本与导出面 ══════════════════════════ */
test('V1 ★ 版本下限锚：本套件只在 3.66.0 及以后成立', async () => {
    const pkg = JSON.parse(readRel('package.json'));
    const toNum = (v) => String(v).split('.').map((x) => Number.parseInt(x, 10)).reduce((a, b) => a * 1000 + b, 0);
    assert.ok(toNum(pkg.version) >= toNum(MIN_VERSION),
        '本套件要求 package.version >= ' + MIN_VERSION + '（实测 ' + pkg.version + '）');
});
test('V2 ★★ 协议件导出面恒定：不留「将来可能有人用」的口', async () => {
    const m = await loadMod(ROOT, REF_REL);
    const got = Object.keys(m).sort();
    const want = ['OPEN_REF_KINDS', 'OPEN_REF_REASONS', 'applyOpenRef', 'buildOpenRef', 'kindAppOf',
        'normalizeOpenRef', 'openRefSelfCheck', 'refStr', 'sameRef'].sort();
    assert.deepEqual(got, want, '导出面漂了（多一个就是「写了没人用」的口子）');
});
test('V3 ★★ 结构自证：登记表非空、源表含本切片 7 条、六件 App 文件都在（防「空对空」全绿）', async () => {
    const m = await loadMod(ROOT, REF_REL);
    assert.ok(Object.keys(m.OPEN_REF_KINDS).length >= 7, '登记表不得为空');
    const sources = await engineSources(ROOT, seedStorage());
    const ids = new Set(sources.map((s) => s.id));
    for (const sid of SRC_IDS) assert.ok(ids.has(sid), '缺源：' + sid);
    for (const row of CONSUME) assert.ok(fs.existsSync(path.join(ROOT, row.rel)), '缺文件：' + row.rel);
});