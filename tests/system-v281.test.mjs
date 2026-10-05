// tests/system-v281.test.mjs
// [v2.81.0] 搜索索引不许停在「上一次打开搜索那一刻」。
//   实测两形态（都不崩溃、都不报错，只是读数错——正是本仓最贵的缺陷形态）：
//   P1 SearchApp 是单例、engine 只在构造时建一次；宿主上下文（SillyTavern）就绪
//      晚于构造时，'tavern' 源**永久缺席**——面板重开一百次也不会补上（源表冻结）。
//   P2 SearchView._result 只在输入 / 换 chip 时清；关掉面板重开走的是 SearchApp.render，
//      它只 invalidate 索引、不清结果快照——源头改了以后重开仍显示旧正文。
//   本版把两者都收成「每次打开都对齐」：源表与会话对齐（换 / 摘 / 登记），结果快照作废。
//
// 负控制纪律：不在原文件上断言「破坏没发生」，而是真源码破坏 → 复制副本
//   → 在副本上重跑同一批行为判据（见 C 段）。
import test from 'node:test';
import assert from 'node:assert/strict';
import {
    readFileSync, writeFileSync, mkdtempSync, mkdirSync, copyFileSync
} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rel = (p) => path.join(ROOT, p);
const read = (p) => readFileSync(rel(p), 'utf8');
const ENGINE_REL = 'apps/memory/global-search-engine.js';
const APP_REL = 'apps/search/search-app.js';
const VIEW_REL = 'apps/search/search-view.js';

// ============ 夹具 ============
function makeShell() {
    const screen = { querySelector: () => null, querySelectorAll: () => [] };
    return { screen, _html: '', setContent(html) { this._html = String(html); } };
}
function makeStorage(seed = {}) {
    const map = new Map(Object.entries(seed));
    return {
        _map: map,
        get(k, d = null) { return map.has(k) ? map.get(k) : d; },
        set(k, v) { map.set(k, v); },
        remove(k) { map.delete(k); }
    };
}
const DIARY = (content) => ([{ title: '标题', date: '9月1日', content, author: '我', createdAt: 1758000000000 }]);

// ============ 行为判据（正控与破坏副本共用同一份） ============
// 判据只认「真数据进来 → 真行为出去」，不认源码文本。
async function loadAt(dir) {
    const g = await import(pathToFileURL(path.join(dir, ENGINE_REL)).href);
    const s = await import(pathToFileURL(path.join(dir, APP_REL)).href);
    return { g, s };
}
/** P1：构造时宿主未就绪 → 宿主就绪并重开面板后，tavern 源必须补上且能搜到 */
async function probeHostLateBind(dir) {
    const { s } = await loadAt(dir);
    const gw = globalThis.window;
    globalThis.window = {};
    try {
        const app = new s.SearchApp(makeShell(), makeStorage());
        const before = app.engine.listSources().some((x) => x.id === 'tavern');
        globalThis.window.SillyTavern = {
            getContext: () => ({ chat: [{ is_user: true, mes: '第一楼正文' }] })
        };
        app.render();
        const after = app.engine.listSources().some((x) => x.id === 'tavern');
        const hit = app.engine.query('第一楼正文').results
            .filter((r) => r.sourceId === 'tavern').length;
        return { frozen: !after || hit === 0, constructed: before, after, hit };
    } finally {
        if (gw === undefined) delete globalThis.window; else globalThis.window = gw;
    }
}
/** P2：换会话（chat 数组换成新实例）后必须跟新、且旧会话不残留 */
async function probeSessionSwitch(dir) {
    const { s } = await loadAt(dir);
    const gw = globalThis.window;
    globalThis.window = { SillyTavern: { getContext: () => ({ chat: [{ is_user: true, mes: '甲会话正文' }] }) } };
    try {
        const app = new s.SearchApp(makeShell(), makeStorage());
        const hitOldBefore = app.engine.query('甲会话正文').results.length;
        globalThis.window.SillyTavern = { getContext: () => ({ chat: [{ is_user: true, mes: '乙会话正文' }] }) };
        app.render();
        const hitNew = app.engine.query('乙会话正文').results.length;
        const hitOld = app.engine.query('甲会话正文').results.length;
        return { followed: hitOldBefore === 1 && hitNew === 1 && hitOld === 0, hitNew, hitOld, hitOldBefore };
    } finally {
        if (gw === undefined) delete globalThis.window; else globalThis.window = gw;
    }
}
/** P3：源头改了 → 关掉面板重开后必须给新读数，不能拿旧结果快照糊弄 */
async function probeStaleResult(dir) {
    const { s } = await loadAt(dir);
    const gw = globalThis.window;
    globalThis.window = { VirtualPhone: {} };
    try {
        const storage = makeStorage({ diary_entries: DIARY('旧正文') });
        const app = new s.SearchApp(makeShell(), storage);
        const view = app.view;
        view._keyword = '正文';
        const first = view._resultsHtml();
        // 注意：命中片段经 highlight() 插了 <mark>，「旧正文」不会连续出现——
        //   故判据用「不含新正文 且 含正文」表达「这一轮读的是旧数据」。
        const firstFresh = first.includes('正文') && !first.includes('新正文');
        storage.set('diary_entries', DIARY('新正文'));
        app.render();
        const bodies = (view._result?.results || []).map((x) => x.body).join('|');
        return {
            followed: firstFresh && bodies.includes('新正文') && !bodies.includes('旧正文'),
            firstFresh, bodies
        };
    } finally {
        if (gw === undefined) delete globalThis.window; else globalThis.window = gw;
    }
}

// ============ 破坏副本基建 ============
const TMP_ROOT = mkdtempSync(path.join(os.tmpdir(), 'rp-v281-'));
// 依赖闭包（只含搜索链路真正会 import 的文件；cheat/dirtytalk 是 buildDefaultSources 的纯数据依赖）
const CLOSURE = [
    ENGINE_REL, APP_REL, VIEW_REL,
    // [v2.97.0] 搜索内核改走单一真源读桥（readPushProbe），破坏副本必须带上该依赖，
    //   否则副本 import 直接 ERR_MODULE_NOT_FOUND，负控制变成「因缺文件而红」而不是「因破坏而红」。
    'config/world-bridge.js',
    'apps/cheat/cheat-data.js',
    'apps/dirtytalk/dt-data.js',
    'data/cheats.js', 'data/cheat-index.js',
    'data/dirtytalk.js', 'data/dirtytalk-corpus.js', 'data/dirtytalk-index.js'
];
function makeCopy(tag) {
    const dir = path.join(TMP_ROOT, tag);
    for (const r of CLOSURE) {
        const dst = path.join(dir, r);
        mkdirSync(path.dirname(dst), { recursive: true });
        copyFileSync(rel(r), dst);
    }
    writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ type: 'module' }));
    return dir;
}
/** 真源码破坏：锚点必须恰好命中一次（否则抛），改造后必须真变（否则抛） */
function mutate(tag, edits) {
    const dir = makeCopy(tag);
    for (const [r, oldText, newText] of edits) {
        const p = path.join(dir, r);
        const src = readFileSync(p, 'utf8');
        const n = src.split(oldText).length - 1;
        assert.equal(n, 1, `变异锚点须恰好命中 1 次：${tag} / ${r}（实得 ${n}）`);
        const next = src.replace(oldText, newText);
        assert.notEqual(next, src, `变异必须真的改了文件：${tag}`);
        writeFileSync(p, next);
    }
    return dir;
}

// ============================================================================
// A. 源码形态：接线点必须在（防止「行为对了但判据搭在别处」）
// ============================================================================
test('v281 A. 源表对齐的接线点齐备', () => {
    const eng = read(ENGINE_REL);
    const app = read(APP_REL);
    const view = read(VIEW_REL);
    // tavern 源由工厂现取（不得再内联一份 chat 数组快照）
    assert.ok(/export function makeTavernSource\s*\(/.test(eng), '酒馆正文源必须是可现取的工厂');
    assert.ok(!/const chatMsgs = Array\.isArray\(ctx\?\.chat\)/.test(eng),
        '不得再内联「构造那一刻」的 chat 快照');
    // 源表要有「换 / 摘」两个出口（只登记不摘换 = 又回到只能叠一份）
    assert.ok(/replaceSource\s*\(src\)\s*\{/.test(eng), '缺少 replaceSource');
    assert.ok(/removeSource\s*\(id\)\s*\{/.test(eng), '缺少 removeSource');
    // 搜索 App 每次打开都要对齐宿主源 + 视图每次重开都要作废旧结果
    assert.ok(/_syncHostSources\s*\(\)\s*\{/.test(app), '缺少 _syncHostSources 定义');
    assert.ok(/this\._syncHostSources\(\);/.test(app), 'render 未调用 _syncHostSources');
    assert.ok(/this\._result = null;/.test(view), '视图重开未作废结果快照');
});

// ============================================================================
// B. 结构契约：按 id 去重的源表必须三出口齐备（同 v2.79 第 6 条的判据形状）
// ============================================================================
test('v281 B. 源表登记面：幂等 + 可换 + 可摘', async () => {
    const { g } = await loadAt(ROOT);
    const eng = new g.GlobalSearchEngine({});
    const mk = (label) => ({ id: 'dup', label, items: () => [{ title: 'x', body: 'x' }] });
    assert.equal(eng.registerSource(mk('第一份')), true, '首次登记应成功');
    assert.equal(eng.registerSource(mk('第二份')), false, '同 id 重复登记必须被拒（否则数据在结果里出现两遍）');
    const ids = eng.listSources().map((s) => s.id);
    assert.equal(ids.filter((x) => x === 'dup').length, 1, '同 id 只能有一个源');
    assert.equal(eng.listSources()[0].label, '第一份', '被拒的登记不得悄悄替换');
    assert.equal(eng.replaceSource(mk('换过的')), true, 'replaceSource 应换掉同 id 的源');
    assert.equal(eng.listSources()[0].label, '换过的');
    assert.equal(eng.listSources().length, 1, '替换不得变成第二个源');
    assert.equal(eng.removeSource('dup'), true);
    assert.equal(eng.listSources().length, 0, '摘掉后不得残留');
    assert.equal(eng.removeSource('dup'), false, '摘不存在的源应如实报 false（不抛）');
    assert.equal(eng.replaceSource(null), false, '畸形入参应如实报 false（不抛）');
});

// ============================================================================
// C. 行为正控：三个探针在原版上必须是绿的（不绿则说明判据本身失效）
// ============================================================================
test('v281 C1. 宿主晚于构造就绪 → 重开面板即补上酒馆正文源', async () => {
    const r = await probeHostLateBind(ROOT);
    assert.equal(r.constructed, false, '前置：构造时宿主要真的未就绪（否则探针测的不是这件事）');
    assert.equal(r.frozen, false, `宿主就绪后源表仍冻结：${JSON.stringify(r)}`);
    assert.equal(r.hit, 1, '补上的源必须真的能搜到楼层正文');
});
test('v281 C2. 换会话 → 跟新会话且旧会话不残留', async () => {
    const r = await probeSessionSwitch(ROOT);
    assert.equal(r.followed, true, `换会话后读数没跟上：${JSON.stringify(r)}`);
});
test('v281 C3. 源头改了 → 重开面板给新读数（不吃旧结果快照）', async () => {
    const r = await probeStaleResult(ROOT);
    assert.equal(r.firstFresh, true, '前置：改之前应能搜到旧正文');
    assert.equal(r.followed, true, `重开面板仍在给旧读数：${JSON.stringify(r)}`);
});

// ============================================================================
// D. 负控制：真源码破坏 → 副本上重跑同一批判据，必须真的转红
// ============================================================================
test('v281 D1. 破坏「每次打开对齐宿主源」→ C1/C2 同款判据在副本上转红', async () => {
    const dir = mutate('no-sync', [
        /* [v3.58.0 · 计划 O4] 锚点收回到 render() 那一处：O4 之后 onChatChanged() 也有
         *   同一行「对齐宿主源」，裸行字面量会命中 2 次（mutate 直接抛，负控制跑不起来）。
         *   两条路径都该对齐，判据钉的是**打开面板**这条（C1/C2 探针走 render），
         *   故取 render() 独有的注释 + 调用一起锚定，破坏面与判据面一致。 */
        [APP_REL, '        // [v2.81.0] 顺带对齐宿主侧源：宿主上下文刚就绪 / 刚换会话时，源表不能停在构造那一刻\n'
            + '        this._syncHostSources();\n', '']
    ]);
    const p1 = await probeHostLateBind(dir);
    assert.equal(p1.constructed, false, '破坏副本的前置仍应成立');
    assert.equal(p1.frozen, true, '去掉对齐后必须复现「源表冻结」（否则判据恒绿，等于没测）');
    const p2 = await probeSessionSwitch(dir);
    assert.equal(p2.followed, false, '去掉对齐后换会话必须跟丢');
});
test('v281 D2. 破坏「重开作废结果快照」→ C3 同款判据在副本上转红', async () => {
    const dir = mutate('no-reset', [
        [VIEW_REL, `        // [v2.81.0] 面板重开 = 一次新检索：丢掉上一轮的结果快照。
        //   否则源头改了以后，重开面板仍按旧索引给旧结果（_paint 那条路保持不变，
        //   输入过程中照样复用同一份内存索引，不重扫全库）。
        this._result = null;
`, '']
    ]);
    const p3 = await probeStaleResult(dir);
    assert.equal(p3.firstFresh, true, '破坏副本的前置仍应成立');
    assert.equal(p3.followed, false, '去掉作废后必须复现「重开仍给旧读数」');
    // 该破坏不该连坐宿主源对齐（两件事互不依赖）
    const p1 = await probeHostLateBind(dir);
    assert.equal(p1.frozen, false, '只破坏结果快照不得影响源表对齐');
});
test('v281 D3. 变异工具两向自证（锚点不存在 / 不唯一都必须抛）', () => {
    assert.throws(() => mutate('bogus', [[APP_REL, '这串源码里没有这句话', '']]),
        /恰好命中 1 次/, '锚点不存在必须抛，不能静默生成「没被破坏的副本」');
    assert.throws(() => mutate('dup-anchor', [[APP_REL, '    }\n', '']]),
        /恰好命中 1 次/, '锚点不唯一必须抛，不能误伤别处');
});

// ============================================================================
// E. 版本锚点
// ============================================================================
test('v281 E. 版本不低于 2.81.0（本套件接管版本锚点）', () => {
    const m = /const ST_PHONE_VERSION = '([0-9.]+)'/.exec(read('index.js'));
    assert.ok(m, 'ST_PHONE_VERSION 必须存在');
    const manifest = JSON.parse(read('manifest.json'));
    assert.equal(m[1], String(manifest.version), '四源同源：index.js 与 manifest.json');
    const log = JSON.parse(read('update-log.json'));
    assert.equal(log.latest, String(manifest.version), '四源同源：update-log.latest');
    const num = (v) => v.split('.').map(Number).reduce((a, b) => a * 1000 + b, 0);
    assert.ok(num(m[1]) >= num('2.81.0'), '本套件需要 2.81.0 及以上，实得 ' + m[1]);
});
