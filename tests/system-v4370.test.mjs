/* ============================================================
 * tests/system-v4370.test.mjs -- [v4.37.0 · 第五期 R5-X1 随身物品与借还事项的可操作卡片]
 *
 * 验收口径（计划原文 R5-X1）：
 *   「借书→查看乙持有→申请归还→确认→卡片回到甲；取消不改持有人；
 *     **无插件明示只可写草稿**；同名物品可按来源区分。」
 *   不做：**不复制物品账**；**不扣真实钱包**；不新增孤立 App 图标。
 *
 * 【修前实测的缺口（读码可复算，不是推演）】
 *   手机侧全仓零 `custody` / 借还关系引用：微信赠礼只画一条聊天气泡
 *   （`chat-view.js` 的 `case 'gift'` 只读 `msg.giftName`），于是
 *   「这把钥匙为什么在乙手里、该不该归还」在手机上**没有任何落点**；
 *   而用户看到的是一条「我送你一把钥匙」的消息 —— 那不是「实物已转移」。
 *   本项要治的正是这半句：**把一条赠礼聊天当成实物已转移**。
 *
 * 【本版落的三件】
 *   （一）契约件 `config/item-custody-contract.js`：六态分形（absent / unsupported /
 *   no-record / draft-only / ready / unreadable）、所有者与持有人**分列**、
 *   赠与**不产生欠还**、不认识的动作名如实具名、同名物品按来源区分、十项自证。
 *   （二）控制器 `itemCustody` / `itemCustodyDraft` / `itemCustodyDraftCount` /
 *   `itemCustodySelfCheck` 四口；换会话整块作废草稿与选中项。
 *   （三）视图物品卡（面 / 「该不该还」独立一行 / 历次交接 / 草稿）+ 三处事件 + 样式双侧。
 *
 * 判据面（六组）：
 *   A 口径：六态互不同形 / 所有者与持有人分列 / 纯契约零副作用 / 视图不自己判
 *   B 内核行为：借出「该还」、赠与「不该还」、部分归还与已回手分形、缺格不猜、
 *            no-record 与 absent 分形、取数失败 ≠ 没有关系、不认识动作名具名
 *   C 接线行为：真 App + 假插件走完整旅程（读到了 / 这件没借过 / 无插件只可草稿 /
 *            取数抛了 / 草稿只在本机 / 换会话作废）
 *   D 负控制：真源码定点破坏 ⇒ 同款判据必转红（每条配原版必真的反向对照）
 *   E 版本锚：五源同源 + 当版条目点名 R5-X1
 *
 * 【为什么负控制破坏副本而不是原仓】见 tests/system-v4120.test.mjs 档头（同规）。
 * 【为什么「申请归还→确认」不在本套件判到底】上游 M5-X1 未实现 ⇒ 本版按计划原文
 *   只做**只读卡 + 本地草稿**（降级模式）。本套件判它的**可判定前件**：
 *   有履约口时读数走履约面、没有时明说只可写草稿、草稿不改任何事实读数。
 * ========================================================== */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { copyTreeSafe } from './_mirror_tree.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const KERNEL_REL = 'config/item-custody-contract.js';
const APP_REL = 'apps/memory/memory-app.js';
const VIEW_REL = 'apps/memory/memory-view.js';
const VIEW_CSS_REL = 'apps/memory/memory.css';
const BUNDLE_CSS_REL = 'phone.css';
const NL = String.fromCharCode(10);

const K = await import(pathToFileURL(path.join(ROOT, KERNEL_REL)).href);
const APP = await import(pathToFileURL(path.join(ROOT, APP_REL)).href);

const kernelSrc = read(KERNEL_REL);
const appSrc = read(APP_REL);
const viewSrc = read(VIEW_REL);
const appCssSrc = read(VIEW_CSS_REL);
const bundleCssSrc = read(BUNDLE_CSS_REL);

/** 去注释后的源码：判据只认代码，不认注释里的自述（本仓旧病：注释里的名字被当成代码）。 */
function stripComments(src) {
    let out = '';
    let i = 0;
    let state = 'code';
    let quote = '';
    while (i < src.length) {
        const c = src[i];
        const d = src[i + 1];
        if (state === 'code') {
            if (c === '/' && d === '*') { state = 'block'; i += 2; continue; }
            if (c === '/' && d === '/') { state = 'line'; i += 2; continue; }
            if (c === '"' || c === "'" || c === '`') { state = 'str'; quote = c; out += c; i += 1; continue; }
            out += c; i += 1; continue;
        }
        if (state === 'block') { if (c === '*' && d === '/') { state = 'code'; i += 2; continue; } i += 1; continue; }
        if (state === 'line') { if (c === NL) { state = 'code'; out += c; } i += 1; continue; }
        if (c === String.fromCharCode(92)) { out += c + (d || ''); i += 2; continue; }
        if (c === quote) { state = 'code'; out += c; i += 1; continue; }
        out += c; i += 1;
    }
    return out;
}
const kernelCode = stripComments(kernelSrc);
const appCode = stripComments(appSrc);
const viewCode = stripComments(viewSrc);
const S = K.CUSTODY_STATES;

/* ══════════ 假件 ══════════ */
function mkStorage() {
    const mem = new Map();
    return { get: (k, d) => (mem.has(k) ? mem.get(k) : d), set: (k, v) => { mem.set(k, v); }, has: (k) => mem.has(k) };
}
/**
 * 上游插件假身。`impl` 可换 ⇒ 各测试自己造「读到了 / 这件没借过 / 取数抛了」。
 *   ★ 假件必须**真收参数**并把它转成回执 —— 只记「被调过」的假件会让
 *     「来源真的下传了没有」这条判据空转（本仓明记过的形态）。
 */
function mkPlugin(impl) {
    const p = {};
    p.__args = null;
    p.itemCustody = (name, opts) => {
        p.__args = { name: name, opts: opts || null };
        if (impl) return impl(name, opts || {});
        return {
            item: name, owner: '甲', holder: '乙', sourceKey: 'floor:12', dueAt: '周五',
            history: [{ action: 'loan', from: '甲', to: '乙', at: '12楼' }],
        };
    };
    return { LonShaMemory: p, __p: p };
}
function mkApp(plugin, kind) {
    globalThis.window = {
        VirtualPhone: {},
        ...(kind === 'no-plugin' ? {} : { LonShaMemory: plugin.LonShaMemory })
    };
    return new APP.MemoryApp(null, mkStorage());
}
function clearWin() { delete globalThis.window; }

/* ══════════ A ── 口径面 ══════════ */

test('A1 六态互不同形：问不了 / 这件没借过 / 只可写草稿 / 读不到 各自成格', () => {
    const states = Object.values(S);
    assert.equal(new Set(states).size, states.length, '★ 六态值必须唯一（压平即造出处置相反的处境长得一样）');
    assert.notEqual(S.ABSENT, S.NO_RECORD, '「插件不在场（问不了）」与「上游在、这件没借过」处置相反');
    assert.notEqual(S.UNSUPPORTED, S.ABSENT, '「没有履约出口」与「插件不在场」处置相反（等升级 vs 装插件）');
    assert.notEqual(S.DRAFT_ONLY, S.ABSENT, '「只可写草稿」与「问不了」处置相反（能写 vs 写不了）');
    assert.notEqual(S.UNREADABLE, S.NO_RECORD, '「读不到」与「没有记录」处置相反（再试 vs 就是这样）');
    /* 派发相严格判 true。 */
    assert.equal(K.planCustodyState(true, true), S.READY);
    assert.equal(K.planCustodyState(false, true), S.DRAFT_ONLY);
    assert.equal(K.planCustodyState(false, false), S.ABSENT);
    for (const bad of [undefined, null, 0, 1, 'yes', {}]) {
        assert.equal(K.planCustodyState(bad, false), S.ABSENT, '★ 非 true 一律当「没有」：' + JSON.stringify(bad));
    }
    assert.ok(kernelCode.indexOf('hasCustody === true') >= 0, '严格判必须写在代码里');
});

test('A2 所有者与持有人分列：借出只改后者（合成一格就答不了「该不该还」）', () => {
    const c = K.normalizeCustodyCard({
        item: '钥匙', owner: '甲', holder: '乙', history: [{ action: 'loan', from: '甲', to: '乙' }],
    });
    assert.equal(c.owner, '甲', '所有者不因借出而改变');
    assert.equal(c.holder, '乙', '持有人变了');
    assert.notEqual(c.owner, c.holder, '两者必须是两个格子');
    /* 视图与控制器都不得自己拼「该不该还」那一句。 */
    assert.equal(viewCode.indexOf('该还：'), -1, '★ 视图不得自己拼「该还」句（应读 app.itemCustody().should）');
    assert.equal(appCode.indexOf('该还：'), -1, '★ 控制器不得自己拼「该还」句（应转交契约件）');
    assert.ok(kernelCode.indexOf('function shouldReturnLine(') >= 0, '唯一出处必须真存在');
});

test('A3 纯契约：零 DOM / 零存储 / 零联网 / 零时钟（判据扫去注释后的代码）', () => {
    for (const bad of ['document.', 'window.', 'localStorage', 'sessionStorage', 'indexedDB',
        'fetch(', 'XMLHttpRequest', 'setTimeout', 'setInterval', 'new Date(', 'dispatchEvent']) {
        assert.equal(kernelCode.indexOf(bad) >= 0, false, '纯契约件不得出现 ' + bad);
    }
    /* 本件不得自己查东西（上游唯一真源）。 */
    for (const bad of ['plugin.', 'LonShaMemory', 'memoryCore']) {
        assert.equal(kernelCode.indexOf(bad) >= 0, false, '★ 本件不得自己取数：' + bad);
    }
});

test('A4 视图接线：卡片在场、事件真投递、样式双侧都写', () => {
    for (const id of ['mem-item-host', 'mem-item-name', 'mem-item-btn', 'mem-item-face',
        'mem-item-should', 'mem-item-rows', 'mem-item-draft', 'mem-item-save', 'mem-item-clear', 'mem-item-note']) {
        assert.ok(viewSrc.indexOf('"' + id + '"') >= 0, '视图缺元素 ' + id);
    }
    for (const fn of ["e.target.closest('#mem-item-btn')", "e.target.closest('#mem-item-save')",
        "e.target.closest('#mem-item-clear')"]) {
        assert.ok(viewCode.indexOf(fn) >= 0, '缺事件落点 ' + fn);
    }
    assert.ok(viewCode.indexOf('this._itemLookup()') >= 0, '「看这一件」必须真调到取数口');
    assert.ok(viewCode.indexOf('this._itemDraftSave(') >= 0, '草稿按钮必须真调到转交口');
    /* 样式两侧投递：只写一侧等于打包环境里裸奔。 */
    for (const cls of ['.mem-item-section', '.mem-item-face', '.mem-item-should', '.mem-item-row',
        '.mem-item-mini', '.mem-item-note-text']) {
        assert.ok(appCssSrc.indexOf(cls) >= 0, '源样式缺 ' + cls);
        assert.ok(bundleCssSrc.indexOf(cls) >= 0, 'phone.css 打包侧缺 ' + cls);
    }
    /* 物品卡独立于问答面渲染（与追问面同规：问答面读不出时不连坐）。 */
    const askHtml = viewCode.slice(viewCode.indexOf('_askHtml(pkg) {'));
    const body = askHtml.slice(0, askHtml.indexOf('  /* ====='));
    const iItem = body.indexOf('mem-item-host');
    const iQa = body.indexOf('if (!qa) return');
    assert.ok(iItem >= 0 && iQa > iItem, '物品卡必须排在「问答面读不出就返回」之前');
});

/* ══════════ B ── 内核行为面 ══════════ */

test('B1 借出 ⇒ 「该还」；赠与 ⇒ 「不该还」（且不给归还按钮）', () => {
    const loaned = K.normalizeCustodyCard({
        item: '钥匙', owner: '甲', holder: '乙', dueAt: '周五',
        history: [{ action: 'loan', from: '甲', to: '乙' }],
    });
    assert.equal(loaned.loaned, true);
    assert.equal(loaned.canConfirm, true, '借出中必须能发起归还确认');
    const line = K.shouldReturnLine(loaned);
    assert.ok(line.indexOf('该还') === 0, '借出中必须明说「该还」：' + line);
    assert.ok(line.indexOf('甲') >= 0 && line.indexOf('乙') >= 0, '要点名两边：' + line);
    assert.ok(line.indexOf('周五') >= 0, '应还日期要在场：' + line);

    /* ★ 赠与不产生欠还：这是本项最容易写坏的一处（把赠礼聊天当成实物已转移）。 */
    const gift = K.normalizeCustodyCard({
        item: '书', owner: '甲', holder: '乙', history: [{ action: 'gift', from: '甲', to: '乙' }],
    });
    assert.equal(gift.loaned, false, '赠与不得算作借出');
    assert.equal(gift.canConfirm, false, '★ 赠与不得给「发起归还确认」按钮（亮一个走不通的按钮比不亮更贵）');
    const gl = K.shouldReturnLine(gift);
    assert.ok(gl.indexOf('不该还') === 0, '赠与必须明说「不该还」：' + gl);
    assert.notEqual(gl, line, '两态必须不同句');
});

test('B2 部分归还与「已回所有者手上」分形；缺一格不猜', () => {
    const partial = K.normalizeCustodyCard({
        item: '钥匙', owner: '甲', holder: '乙',
        history: [{ action: 'loan', from: '甲', to: '乙' }, { action: 'return', from: '乙', to: '甲' }],
    });
    assert.equal(partial.partial, true, '有借有还但持有人仍非所有者 ⇒ 部分归还');
    assert.ok(K.custodyLineOf(partial).indexOf('部分归还') >= 0, '读数必须说清是部分归还：' + K.custodyLineOf(partial));

    const back = K.normalizeCustodyCard({
        item: '钥匙', owner: '甲', holder: '甲',
        history: [{ action: 'loan', from: '甲', to: '乙' }, { action: 'return', from: '乙', to: '甲' }],
    });
    assert.ok(K.shouldReturnLine(back).indexOf('不必还') === 0, '已回所有者手上必须说「不必还」：' + K.shouldReturnLine(back));
    assert.notEqual(K.shouldReturnLine(back), K.shouldReturnLine(partial), '两者必须不同句');

    /* 缺一格 ⇒ 判不了（不猜）。 */
    const half = K.normalizeCustodyCard({ item: '伞', holder: '乙', history: [{ action: 'loan' }] });
    assert.ok(K.shouldReturnLine(half).indexOf('判不了') === 0, '缺一格必须说「判不了」（不猜）');
});

test('B3 问不了 / 这件没借过 / 读不到 三态各有各的话', () => {
    const absent = K.normalizeCustodyCard(null);
    const noRec = K.normalizeCustodyCard({ item: '伞' });
    const bad = K.normalizeCustodyCard({ thrown: true, item: '伞' });
    assert.equal(absent.state, S.ABSENT);
    assert.equal(noRec.state, S.NO_RECORD);
    assert.equal(bad.state, S.UNREADABLE);
    const lines = [absent, noRec, bad].map((c) => K.custodyLineOf(c));
    assert.equal(new Set(lines).size, 3, '★ 三态必须三句不同：' + lines.join(' | '));
    assert.ok(lines[0].indexOf('不在场') >= 0, '不在场必须说清是「问不了」');
    assert.ok(lines[1].indexOf('没借过') >= 0 || lines[1].indexOf('没有履约记录') >= 0, '这件没借过必须说清：' + lines[1]);
    assert.ok(lines[2].indexOf('读不到') >= 0, '取数失败必须说「读不到 ≠ 没有关系」：' + lines[2]);
    /* 三态的「该不该还」也都不许给出确定结论。 */
    for (const c of [absent, noRec, bad]) {
        assert.ok(K.shouldReturnLine(c).indexOf('判不了') === 0, '非 ready 态不许给确定结论：' + K.shouldReturnLine(c));
    }
});

test('B4 不认识的动作名如实具名；同名物品按来源区分', () => {
    const weird = K.normalizeCustodyCard({
        item: '钥匙', owner: '甲', holder: '乙',
        history: [{ action: 'mystery-act', from: '甲', to: '乙' }],
    });
    assert.equal(weird.history[0].action, K.CUSTODY_ACTIONS.OTHER, '不认识的动作名归 other');
    assert.equal(weird.history[0].actionRaw, 'mystery-act', '★ 必须如实留下原名（不静默丢）');
    const row = K.handoverRowsOf(weird)[0].line;
    assert.ok(row.indexOf('mystery-act') >= 0, '读数行必须点名那个不认识的动作：' + row);
    assert.ok(row.indexOf('其他') >= 0, '同时说清是按「其他」列出的');
    /* 同名两件不串。 */
    const a = K.normalizeCustodyCard({ item: '钥匙', owner: '甲', holder: '乙', sourceKey: 'floor:12' });
    const b = K.normalizeCustodyCard({ item: '钥匙', owner: '丙', holder: '丁', sourceKey: 'floor:40' });
    assert.notEqual(a.sourceKey, b.sourceKey, '★ 同名物品必须按来源区分（否则两件串成一件）');
    assert.notEqual(K.custodyLineOf(a), K.custodyLineOf(b), '两件的读数也必须不同');
    /* 交接行按原序，不重排。 */
    const many = K.normalizeCustodyCard({
        item: '钥匙', owner: '甲', holder: '乙',
        history: [{ action: 'loan', from: '甲', to: '乙' }, { action: 'handover', from: '乙', to: '丙' },
            { action: 'return', from: '丙', to: '甲' }],
    });
    const rows = K.handoverRowsOf(many);
    assert.equal(rows.length, 3);
    assert.ok(rows[0].line.indexOf('借出') >= 0 && rows[1].line.indexOf('转交') >= 0 && rows[2].line.indexOf('归还') >= 0,
        '交接行必须按原序：' + rows.map((r) => r.line).join(' | '));
});

test('B5 自检十项零问题，且各态与动作计数与词表同源', () => {
    const r = K.custodySelfCheck();
    assert.deepEqual(r.problems, [], '★ 内核自检必须零问题：' + JSON.stringify(r.problems));
    assert.equal(r.states, 6, '六态');
    assert.equal(r.actions, 6, '六个受控动作');
    assert.equal(Object.keys(K.CUSTODY_STATES).length, 6);
});

/* ══════════ C ── 接线面（真 App + 假插件） ══════════ */

test('C1 有履约口：读到了、来源真下传、读数走履约面', () => {
    const plugin = mkPlugin();
    const app = mkApp(plugin, 'custody');
    try {
        const card = app.itemCustody('钥匙', { sourceKey: 'floor:12' });
        assert.deepEqual(plugin.__p.__args, { name: '钥匙', opts: { sourceKey: 'floor:12' } },
            '★ 物品名与来源必须原样下传（只记「被调过」会让这条判据空转）');
        assert.equal(card.state, S.READY);
        assert.ok(card.line.indexOf('甲') >= 0 && card.line.indexOf('乙') >= 0, '读数要点名两边：' + card.line);
        assert.ok(card.should.indexOf('该还') === 0, '该不该还必须走履约面：' + card.should);
        assert.equal(card.rows.length, 1, '历次交接要给出来');
        assert.deepEqual(app.itemCustodySelfCheck().problems, []);
    } finally { clearWin(); }
});

test('C2 上游在但这件没借过：说清「这件没借过」，不说「问不了」', () => {
    const plugin = mkPlugin((name) => ({ item: name }));
    const app = mkApp(plugin, 'custody');
    try {
        const card = app.itemCustody('伞');
        assert.equal(card.state, S.NO_RECORD, '★ 上游在场、没有关系 ⇒ 这件没借过');
        assert.notEqual(card.state, S.ABSENT, '不许读成「插件不在场」（两者处置相反）');
        assert.ok(card.should.indexOf('判不了') === 0, '没借过不许给确定结论');
    } finally { clearWin(); }
});

test('C3 取数抛了：如实报「读不到」，不假装「没有借还关系」', () => {
    const plugin = mkPlugin(() => { throw new Error('boom'); });
    const app = mkApp(plugin, 'custody');
    try {
        const card = app.itemCustody('钥匙');
        assert.equal(card.state, S.UNREADABLE, '★ 取数抛了必须记 unreadable');
        assert.ok(card.line.indexOf('读不到') >= 0, '必须说「读不到 ≠ 没有关系」：' + card.line);
    } finally { clearWin(); }
});

test('C4 ★★★ 无插件：明示只可写草稿（不说「没有借还」）', () => {
    const app = mkApp(null, 'no-plugin');
    try {
        const card = app.itemCustody('钥匙');
        assert.equal(card.state, S.ABSENT, '没有草稿时如实报不在场');
        assert.ok(card.line.indexOf('不在场') >= 0, '必须说清是「问不了」：' + card.line);
        /* 存一条草稿 ⇒ 态变成「只可写草稿」（不是「读到了」）。 */
        const saved = app.itemCustodyDraft('钥匙', '想还给乙');
        assert.equal(saved.ok, true);
        assert.ok(saved.note.indexOf('只是草稿') >= 0, '★ 必须明说「只是草稿」（没写成事实）：' + saved.note);
        const after = app.itemCustody('钥匙');
        assert.equal(after.state, S.DRAFT_ONLY, '★ 有草稿时必须是「只可写草稿」，不许读成「读到了」');
        assert.notEqual(after.state, S.READY, '草稿不是履约数据');
        assert.ok(after.should.indexOf('判不了') === 0, '草稿态不许给确定结论：' + after.should);
        /* 清草稿 ⇒ 回到「不在场」，且**没有任何事实被改写**（读数逐字回到原样）。 */
        const cleared = app.itemCustodyDraft('钥匙', '');
        assert.equal(cleared.cleared, true);
        assert.equal(app.itemCustody('钥匙').state, S.ABSENT);
        assert.equal(app.itemCustodyDraftCount(), 0);
        /* 空名存不出草稿。 */
        assert.equal(app.itemCustodyDraft('  ', 'x').ok, false);
    } finally { clearWin(); }
});

test('C5 草稿只在本机：不改任何持有关系读数，且换会话整块作废', () => {
    const plugin = mkPlugin();
    const app = mkApp(plugin, 'custody');
    try {
        const before = app.itemCustody('钥匙');
        app.itemCustodyDraft('钥匙', '想还给乙');
        const after = app.itemCustody('钥匙');
        assert.equal(after.line, before.line, '★ 草稿不得改动持有关系读数（草稿不是事实）');
        assert.equal(after.should, before.should, '也不得改动「该不该还」');
        assert.equal(app.itemCustodyDraftCount(), 1);
        /* 换会话：草稿与选中物品整块作废（与追问轨迹同族）。 */
        app.onChatChanged();
        assert.equal(app.itemCustodyDraftCount(), 0, '★★ 换会话必须作废草稿（不作废会把上一段的意向画进新会话）');
    } finally { clearWin(); }
});

test('C6 无插件 + 有草稿时不许假装读到了；视图不直摸上游全局', () => {
    const app = mkApp(null, 'no-plugin');
    try {
        app.itemCustodyDraft('书', '想借');
        const card = app.itemCustody('书');
        assert.equal(card.state, S.DRAFT_ONLY);
        assert.equal(card.rows.length, 0, '草稿态没有交接行（不许编一个）');
        assert.ok(card.line.indexOf('草稿') >= 0, '读数必须说清是草稿：' + card.line);
    } finally { clearWin(); }
    assert.equal(viewSrc.indexOf('LonShaMemory') >= 0, false, '视图不得直摸上游全局（取数在控制器）');
    assert.equal(viewCode.indexOf('itemCustody?.(') >= 0, true, '视图必须走 app.itemCustody()');
});

/* ══════════ D ── 负控制（真源码定点破坏 ⇒ 同一判据必转红） ══════════ */
const temps = [];
function makeMirror() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rp_v4370_'));
    temps.push(dir);
    copyTreeSafe(path.join(ROOT, 'config'), path.join(dir, 'config'));
    copyTreeSafe(path.join(ROOT, 'apps', 'memory'), path.join(dir, 'apps', 'memory'));
    copyTreeSafe(path.join(ROOT, 'apps', 'reading'), path.join(dir, 'apps', 'reading'));
    return dir;
}
process.on('exit', () => {
    for (const d of temps) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (_e) { /* 忽略 */ } }
});
function breakCopy(rel, anchor, replacement) {
    const dir = makeMirror();
    const src = read(rel);
    const hits = src.split(anchor).length - 1;
    assert.equal(hits, 1, '破坏锚点必须恰中 1 次（实测 ' + hits + '）：' + anchor.slice(0, 70));
    fs.writeFileSync(path.join(dir, rel), src.split(anchor).join(replacement));
    return dir;
}
async function loadKernel(dir, tag) {
    return await import(pathToFileURL(path.join(dir, KERNEL_REL)).href + '?' + tag + '=' + Date.now());
}
async function loadApp(dir, tag) {
    return await import(pathToFileURL(path.join(dir, APP_REL)).href + '?' + tag + '=' + Date.now());
}
const expectRed = (fn, tag) => {
    let problems = null;
    try { problems = fn(); } catch (e) { problems = ['抛了:' + String((e && e.message) || e)]; }
    assert.ok(problems.length > 0, tag + '：破坏副本上同款判据必须转红（实测全绿 ⇒ 判据空转）');
};

test('D0 ★★★ 阳性对照：未破坏时四条判据必须全为真（否则 D 组是假绿）', () => {
    assert.equal(K.planCustodyState('yes', false), S.ABSENT, '原版：严格判 true');
    const g = K.normalizeCustodyCard({ item: '书', owner: '甲', holder: '乙', history: [{ action: 'gift' }] });
    assert.equal(g.canConfirm, false, '原版：赠与不给归还按钮');
    assert.equal(K.normalizeCustodyCard({ item: '伞' }).state, S.NO_RECORD, '原版：没借过单列');
    assert.equal(K.normalizeCustodyCard(null).state, S.ABSENT, '原版：空件记不在场');
});

test('D1 ★★★★★ 破坏「赠与不产生欠还」⇒ 同款判据必转红（把赠礼当借出）', async () => {
    const dir = breakCopy(KERNEL_REL,
        "    const loans = history.filter((h) => h.action === CUSTODY_ACTIONS.LOAN || h.action === CUSTODY_ACTIONS.HANDOVER);",
        "    const loans = history.filter((h) => h.action === CUSTODY_ACTIONS.LOAN || h.action === CUSTODY_ACTIONS.HANDOVER || h.action === CUSTODY_ACTIONS.GIFT);");
    const mk = await loadKernel(dir, 'd1');
    const gift = mk.normalizeCustodyCard({ item: '书', owner: '甲', holder: '乙', history: [{ action: 'gift' }] });
    assert.equal(gift.loaned, true, '★★ 破坏副本：赠与被当成借出 ⇒ 用户被要求归还一件送出去的东西');
    assert.equal(mk.shouldReturnLine(gift).indexOf('该还'), 0, '破坏副本：读数变成「该还」');
    const good = K.normalizeCustodyCard({ item: '书', owner: '甲', holder: '乙', history: [{ action: 'gift' }] });
    assert.equal(good.loaned, false, '原版必须不把赠与算借出');
});

test('D2 ★★★★ 破坏「取数失败 ≠ 没有关系」⇒ 同款判据必转红（读不到被读成没借过）', async () => {
    const dir = breakCopy(KERNEL_REL,
        "    if (r.unreadable === true || r.thrown === true) {",
        '    if (false) {');
    const mk = await loadKernel(dir, 'd2');
    const bad = mk.normalizeCustodyCard({ thrown: true, item: '伞' });
    assert.notEqual(bad.state, mk.CUSTODY_STATES.UNREADABLE, '★ 破坏副本：取数失败不再记 unreadable');
    assert.equal(bad.state, mk.CUSTODY_STATES.NO_RECORD, '它被读成了「这件没借过」—— 与「读不到」处置相反');
    assert.equal(K.normalizeCustodyCard({ thrown: true, item: '伞' }).state, S.UNREADABLE, '原版必须记 unreadable');
});

test('D3 ★★★★ 破坏「不认识的动作名具名」⇒ 同款判据必转红（动作被静默吞掉）', async () => {
    const dir = breakCopy(KERNEL_REL,
        "            actionRaw: (act === CUSTODY_ACTIONS.OTHER && rawAct && rawAct !== CUSTODY_ACTIONS.OTHER) ? rawAct : '',",
        "            actionRaw: '',");
    const mk = await loadKernel(dir, 'd3');
    const weird = mk.normalizeCustodyCard({
        item: '钥匙', owner: '甲', holder: '乙', history: [{ action: 'mystery-act', from: '甲', to: '乙' }],
    });
    assert.equal(weird.history[0].actionRaw, '', '★ 破坏副本：不认识的动作名被静默丢掉');
    assert.equal(mk.handoverRowsOf(weird)[0].line.indexOf('mystery-act'), -1, '读数行再也点不出那个动作');
    const good = K.normalizeCustodyCard({
        item: '钥匙', owner: '甲', holder: '乙', history: [{ action: 'mystery-act' }],
    });
    assert.equal(good.history[0].actionRaw, 'mystery-act', '原版必须留下原名');
});

test('D4 ★★★★ 破坏「缺一格不猜」⇒ 同款判据必转红（缺格被读成确定结论）', async () => {
    const dir = breakCopy(KERNEL_REL,
        "    if (!c.holder || !c.owner) return '判不了：所有者或持有人缺一格（不猜）';",
        '    if (false) return \'\';');
    const mk = await loadKernel(dir, 'd4');
    const half = mk.normalizeCustodyCard({ item: '伞', holder: '乙', history: [{ action: 'loan' }] });
    assert.equal(mk.shouldReturnLine(half).indexOf('该还'), 0,
        '★ 破坏副本：缺所有者却给出「该还」确定结论（不猜是底线）');
    const good = K.normalizeCustodyCard({ item: '伞', holder: '乙', history: [{ action: 'loan' }] });
    assert.equal(K.shouldReturnLine(good).indexOf('判不了'), 0, '原版必须说「判不了」');
});

test('D5 ★★★★ 破坏「草稿态不许读成读到了」⇒ C4 同款判据必转红', async () => {
    /* ★ 破坏必须落在**真落点**上。前两版都没落对：
     *   ① 把 `hasCustody` 判成恒真 ⇒ `plugin` 为 null 时 `plugin.itemCustody(...)`
     *      当场抛，走的是 `unreadable` 分支；
     *   ② 改 `planCustodyState` 的兜底 ⇒ 那一格**根本不参与**这条路径
     *      （没有履约口时 `recv` 保持 null，态由 `normalizeCustodyCard` 的空件分支决定）。
     *   真落点是**空件分支那一行**：把它改成恒 ready，就是「拿草稿当事实」。 */
    const dir = breakCopy(KERNEL_REL,
        "            state: o.draft === true ? CUSTODY_STATES.DRAFT_ONLY : CUSTODY_STATES.ABSENT,",
        '            state: CUSTODY_STATES.READY,');
    const m = await loadApp(dir, 'd5');
    const plugin = mkPlugin();
    globalThis.window = { VirtualPhone: {}, LonShaMemory: undefined };
    const app = new m.MemoryApp(null, mkStorage());
    try {
        app.itemCustodyDraft('钥匙', '想还给乙');
        const card = app.itemCustody('钥匙');
        assert.notEqual(card.state, S.DRAFT_ONLY,
            '★★ 破坏副本：没有履约口却不再报「只可写草稿」⇒ 用户以为读到了真实持有关系');
        assert.equal(card.state, S.READY, '破坏副本：空件被读成「读到了」—— 正是本项要治的形态');
    } finally { clearWin(); }
});

/* ══════════ E ── 版本锚 ══════════ */
test('E1 五源同源 + 当版条目点名 R5-X1', () => {
    const pkg = JSON.parse(read('package.json'));
    const man = JSON.parse(read('manifest.json'));
    const log = JSON.parse(read('update-log.json'));
    const ver = pkg.version;
    assert.match(ver, /^\d+\.\d+\.\d+$/, '版本号形态必须正常:' + ver);
    assert.equal(man.version, ver, 'manifest 与 package 必须同版');
    assert.equal(log.latest, ver, 'update-log.latest 必须同版');
    assert.equal(log.head, ver, 'update-log.head 必须同版');
    assert.ok(log.versions[ver], '当版条目必须存在');
    const items = (log.versions[ver].items || []).join(NL);
    assert.ok(items.indexOf('R5-X1') >= 0, '当版条目必须点名 R5-X1');
    assert.ok(items.indexOf('第五期') >= 0, '当版条目必须点名第五期');
    assert.ok(items.indexOf('版本升至 ' + ver) >= 0, '当版条目必须带收口条目');
    assert.ok(read('index.js').indexOf("const ST_PHONE_VERSION = '" + ver + "';") >= 0, 'index.js 版本常量必须同源');
});