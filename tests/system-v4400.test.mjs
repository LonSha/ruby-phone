/* ============================================================
 * tests/system-v4400.test.mjs -- [v4.40.0 · 第五期 R5-X5 群聊前的共同往事选择器]
 *
 * 验收口径（计划原文 R5-X5）：
 *   「在群聊/多人重逢入口选参与者和时点，预览所有人可共享的旧事，选择后交给原聊天草稿；
 *     增减成员即时重新核可共享范围。」
 *   验收旅程：「**甲乙共享秘密可在两人草稿出现；加入丙后重新预览移除秘密，
 *     不能沿旧草稿一键误发**；**无知情数据提示无法判定**，取消不发送。」
 *   不做：**不自动群发**；**不从亲密度推定群成员知情**。
 *
 * 【修前实测的缺口（读码可复算，不是推演）】
 *   手机侧全仓零「组级共享可见性」实现：`knowledgeCheck`（social-knowledge-bridge）
 *   判的是**单人**视角的可见性（「这条对甲可见吗」）。于是群聊里想提一件旧事时，
 *   只能凭人脑记「丙不知道这件事」—— 而**加一个人就整个结论作废**这件事
 *   在界面上没有任何落点。
 *
 * 【本版落的三件】
 *   （一）契约件 `config/shared-past-contract.js`：组级四态（absent / empty / ready /
 *   unreadable）× 单件四态（shared / private / unknown / empty-group）；
 *   **成员指纹**（顺序无关）+ 指纹一变**旧预览整块作废**；`handoffGate` 三态拦交接；
 *   不产任何亲密度分数；十项自证。
 *   （二）控制器 `wechat-app.js`：`sharedPastPack` / `_localSharedPast` / `sharedPastMark` /
 *   `sharedPastSetMembers` / `sharedPastContractSelfCheck`。
 *   （三）视图 `chat-view.js`：群聊消息菜单「共同往事」入口 + `openSharedPastPanel` 面板。
 *
 * 判据面（六组）：
 *   A 口径：组级四态与单件四态互不同形 / 判定唯一出处 / 纯契约零副作用 / 视图接线
 *   B 内核行为：全组知情可共享、有人不知情不许说、有人没数据判不了（与不知情分形）、
 *            没给知情名单判不了、成员指纹顺序无关、成员变了作废并拦住交接
 *   C 接线行为：真 App 走完整旅程（上游在场 / 上游不在场只判不了 / 取数抛了 /
 *            本机不推知情 / 换会话作废）
 *   D 负控制：真源码定点破坏 ⇒ 同款判据必转红（每条配原版必真的反向对照）
 *   E 版本锚：五源同源 + 当版条目点名 R5-X5
 *
 * 【为什么负控制破坏副本而不是原仓】见 tests/system-v4120.test.mjs 档头（同规）。
 * 【为什么「交给原聊天草稿」不在本套件判到底】交接本身属**真 DOM 层 + O1 交接面**读数；
 *   本套件判它的**可判定前件**：`handoffGate` 在成员变更时**必须拦住**（那是本项验收
 *   原文点名的那一格：「不能沿旧草稿一键误发」）。
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

const KERNEL_REL = 'config/shared-past-contract.js';
const APP_REL = 'apps/wechat/wechat-app.js';
const VIEW_REL = 'apps/wechat/chat-view.js';
const NL = String.fromCharCode(10);

const K = await import(pathToFileURL(path.join(ROOT, KERNEL_REL)).href);
const APP = await import(pathToFileURL(path.join(ROOT, APP_REL)).href);

const kernelSrc = read(KERNEL_REL);
const appSrc = read(APP_REL);
const viewSrc = read(VIEW_REL);

/** 去注释后的源码：判据只认代码，不认注释里的自述。 */
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
const S = K.SHARED_STATES;
const I = K.SHARED_ITEM_STATES;

/* ══════════ 假件 ══════════ */
function mkStorage() {
    const mem = new Map();
    return { get: (k, d) => (mem.has(k) ? mem.get(k) : d), set: (k, v) => { mem.set(k, v); }, has: (k) => mem.has(k) };
}
/**
 * 上游插件假身。`impl` 可换 ⇒ 各测试自己造「上游在场 / 取数抛了」。
 *   ★ 假件必须**真收参数**并把它转成回执（只记「被调过」会让「members 真下传了没有」空转）。
 */
function mkPlugin(impl) {
    const p = {};
    p.__args = null;
    p.sharedPastOf = (members, opts) => {
        p.__args = { members: Array.isArray(members) ? members.slice() : members, opts: opts || null };
        if (impl) return impl(members, opts || {});
        return { items: [{ id: 's1', label: '那晚下雨', knowers: ['甲', '乙'] }] };
    };
    return { LonShaMemory: p, __p: p };
}
/**
 * 造一个真 App 实例。
 *   ★ 不走 `new WechatApp(...)`：真构造期要 `document` / `Audio`（夹具缺件，非本版缺陷）。
 *   按真原型建实例、只补这些方法用到的字段 —— 方法体本身仍是**真源码**。
 */
function mkApp(plugin, kind, messages) {
    globalThis.window = {
        VirtualPhone: {},
        ...(kind === 'no-plugin' ? {} : { LonShaMemory: plugin.LonShaMemory })
    };
    const app = Object.create(APP.WechatApp.prototype);
    app.currentChat = { id: 'c1', type: 'group' };
    app.wechatData = { getMessages: () => (Array.isArray(messages) ? messages : []) };
    return app;
}
function clearWin() { delete globalThis.window; }

/* ══════════ A ── 口径面 ══════════ */

test('A1 组级四态与单件四态各自互不同形；「判不了」与「不知情」必须分形', () => {
    const states = Object.values(S);
    assert.equal(new Set(states).size, states.length, '★ 组级各态必须唯一');
    const items = Object.values(I);
    assert.equal(new Set(items).size, items.length, '★ 单件各态必须唯一');
    assert.notEqual(I.PRIVATE, I.UNKNOWN, '★★「有人不知情」与「有人没有数据」处置相反');
    assert.notEqual(I.EMPTY_GROUP, I.UNKNOWN, '「还没选人」与「判不了」处置相反');
    assert.notEqual(S.EMPTY, S.UNREADABLE, '「确实没有」与「读不到」处置相反');
    assert.notEqual(S.ABSENT, S.EMPTY, '「没有数据源」与「有源但空」处置相反');
});

test('A2 判定只有一处出处：视图与控制器都不自己判「谁能共享」', () => {
    assert.ok(kernelCode.indexOf('function normalizeSharedItem(') >= 0, '唯一装配点必须真存在');
    assert.ok(kernelCode.indexOf('function handoffGate(') >= 0, '交接闸的唯一出处必须真存在');
    assert.equal(viewCode.indexOf('knowers'), -1, '★ 视图不得自己判知情名单');
    assert.equal(appCode.indexOf('knowers'), -1, '★ 控制器不得自己判知情名单');
    assert.ok(appCode.indexOf('buildSharedPast(') >= 0, '控制器必须转交契约件');
    assert.ok(viewCode.indexOf('sharedPastPack?.(') >= 0, '视图必须走 app.sharedPastPack()');
    /* 三态的话也只许契约件一处拼。
     *   ★ 只判**本版新增的两个方法**那一段：`不许说` 在 18888 行的既有 chat-view 里
     *   别处也出现（判全文会把既有形态算成本版缺陷）；面板说明文字里出现它也不算出格 ——
     *   出格的是「用视图自己的判定拼出那一句」，故这里判的是**判据词**不在面板里重算。 */
    const g0 = viewCode.indexOf('openSharedPastPanel(');
    const g1 = viewCode.indexOf('openRumorSourcePanel(');
    assert.ok(g0 > 0 && g1 > g0, '必须能切出共同往事面板那一段');
    const panelSeg = viewCode.slice(g0, g1);
    assert.equal(panelSeg.indexOf("'private'"), -1, '★ 面板不得自持单件状态字面量');
    assert.equal(panelSeg.indexOf("'shared'"), -1, '★ 面板不得自持单件状态字面量');
    assert.ok(panelSeg.indexOf('gate') >= 0, '面板必须读 gate（交接闸的读数）');
});

test('A3 纯契约：零 DOM / 零存储 / 零联网 / 零时钟', () => {
    for (const bad of ['document.', 'window.', 'localStorage', 'sessionStorage', 'indexedDB',
        'fetch(', 'XMLHttpRequest', 'setTimeout', 'setInterval', 'new Date(', 'dispatchEvent']) {
        assert.equal(kernelCode.indexOf(bad) >= 0, false, '纯契约件不得出现 ' + bad);
    }
    for (const bad of ['plugin.', 'LonShaMemory', 'memoryCore']) {
        assert.equal(kernelCode.indexOf(bad) >= 0, false, '★ 本件不得自己取数：' + bad);
    }
});

test('A4 视图接线：群聊菜单入口在场、面板真渲染、事件真投递', () => {
    assert.ok(viewSrc.indexOf('data-action="shared-past"') >= 0, '消息菜单缺「共同往事」入口');
    assert.ok(viewCode.indexOf("action === 'shared-past'") >= 0, '菜单动作必须真接线');
    assert.ok(viewCode.indexOf('this.openSharedPastPanel(') >= 0, '动作必须真调到面板');
    for (const cls of ['wx-shared-panel', 'wx-shared-close', 'wx-shared-row', 'wx-shared-none']) {
        assert.ok(viewSrc.indexOf(cls) >= 0, '视图缺类 ' + cls);
    }
    /* 入口只在**群聊**里给（本项要治的是「一屋子人里谁能说哪件旧事」）。 */
    assert.ok(viewCode.indexOf("this.app?.currentChat?.type === 'group'") >= 0, '入口条件必须在场');
    /* 上游不在场时如实说读不出，不假装「没有可共享的旧事」。 */
    assert.ok(viewSrc.indexOf('本版 App 未接线') >= 0, '取数口读不出必须如实说');
});

/* ══════════ B ── 内核行为面 ══════════ */

test('B1 ★★★★★ 甲乙共享秘密可共享；加入丙后移除秘密', () => {
    const two = K.buildSharedPast({
        members: ['甲', '乙'],
        items: [{ id: 's', label: '共同秘密', knowers: ['甲', '乙'] }],
    });
    assert.equal(two.shared.length, 1, '★ 两人组里那件秘密应可共享');
    assert.equal(two.private.length, 0);
    assert.equal(two.state, S.READY);

    const three = K.buildSharedPast({
        members: ['甲', '乙', '丙'],
        items: [{ id: 's', label: '共同秘密', knowers: ['甲', '乙'] }],
    });
    assert.equal(three.shared.length, 0, '★★ 加入丙后那件秘密不再可共享');
    assert.equal(three.private.length, 1, '它应落进「不许说」');
    assert.ok(three.private[0].missing.indexOf('丙') >= 0, '必须点名丙不知情：' + JSON.stringify(three.private[0].missing));
    assert.notEqual(K.sharedPastLine(two), K.sharedPastLine(three), '★ 两态读数必须不同句');
});

test('B2 ★★★★★ 成员变了 ⇒ 旧预览整块作废，且**拦住交接**（不能沿旧草稿一键误发）', () => {
    const two = K.buildSharedPast({
        members: ['甲', '乙'], items: [{ id: 's', label: '共同秘密', knowers: ['甲', '乙'] }],
    });
    assert.equal(two.stale, false, '没有上一次指纹时不该报作废');
    assert.equal(K.handoffGate(two).ok, true, '两人组时可以交接');
    const three = K.buildSharedPast({
        members: ['甲', '乙', '丙'], prevKey: two.membersKey,
        items: [{ id: 's', label: '共同秘密', knowers: ['甲', '乙'] }],
    });
    assert.equal(three.stale, true, '★ 加入丙后必须报「旧预览作废」');
    const gate = K.handoffGate(three);
    assert.equal(gate.ok, false, '★★ 成员变了必须**拦住交接**');
    assert.equal(gate.reason, 'stale', '拦下的理由必须是「作废」');
    assert.ok(gate.line.indexOf('必须重挑') >= 0, '必须说清「必须重挑」：' + gate.line);
    assert.ok(K.sharedPastLine(three).indexOf('旧预览已作废') >= 0, '读数行也必须报作废：' + K.sharedPastLine(three));
    /* 没有可共享的 ⇒ 也拦住，但理由**不同形**。 */
    const noneShared = K.buildSharedPast({ members: ['甲', '乙'], items: [{ id: 'p', knowers: ['甲'] }] });
    const g2 = K.handoffGate(noneShared);
    assert.equal(g2.ok, false);
    assert.notEqual(g2.reason, 'stale', '★「没有可共享的」与「作废」必须不同形');
    assert.notEqual(g2.line, gate.line, '两者的话也必须不同句');
});

test('B3 ★★★★ 成员指纹顺序无关；不同成员集合必须不同指纹', () => {
    assert.equal(K.membersKeyOf(['乙', '甲']), K.membersKeyOf(['甲', '乙']), '★ 顺序无关（否则换个顺序就误判作废）');
    assert.notEqual(K.membersKeyOf(['甲']), K.membersKeyOf(['甲', '乙']), '★ 集合不同 ⇒ 指纹必须不同');
    /* 指纹相同 ⇒ 不报作废（同一组重开不该被判成「变了」）。 */
    const again = K.buildSharedPast({
        members: ['乙', '甲'], prevKey: K.membersKeyOf(['甲', '乙']),
        items: [{ id: 's', knowers: ['甲', '乙'] }],
    });
    assert.equal(again.stale, false, '★ 同一组（只是顺序不同）不得被判成「成员变了」');
});

test('B4 「不知情」与「判不了」分形：没给知情名单也判不了（不读成「没人知道」）', () => {
    const priv = K.normalizeSharedItem({ id: 'b', label: '秘密', knowers: ['甲'] }, ['甲', '乙']);
    assert.equal(priv.state, I.PRIVATE);
    assert.deepEqual(priv.missing, ['乙'], '必须点名谁不知情');
    assert.ok(priv.why.indexOf('不知情') >= 0, '必须说清是「不知情」：' + priv.why);

    const unk = K.normalizeSharedItem({ id: 'c', knowers: ['甲'], undecided: ['丙'] }, ['甲', '丙']);
    assert.equal(unk.state, I.UNKNOWN, '★ 有人没有知情数据 ⇒ 判不了');
    assert.notEqual(unk.state, priv.state, '★ 两者必须不同形');
    assert.ok(unk.why.indexOf('不是「他不知情」') >= 0, '判不了必须说清不是「他不知情」：' + unk.why);

    /* 知情名单**根本没给** ⇒ 整件判不了（不读成「没人知道」）。 */
    const noList = K.normalizeSharedItem({ id: 'd' }, ['甲', '乙']);
    assert.equal(noList.state, I.UNKNOWN, '没给知情名单 ⇒ 判不了');
    assert.ok(noList.why.indexOf('不是「没人知道」') >= 0, '必须说清不是「没人知道」：' + noList.why);

    /* 没选人 ⇒ empty-group（与判不了不同形）。 */
    const empty = K.normalizeSharedItem({ id: 'e', knowers: ['甲'] }, []);
    assert.equal(empty.state, I.EMPTY_GROUP);
    assert.notEqual(empty.state, unk.state, '★「还没选人」与「判不了」必须不同形');
});

test('B5 读不到 / 没有源 / 没有旧事 三态分形；不产任何亲密度分数', () => {
    const bad = K.buildSharedPast({ thrown: true });
    const none = K.buildSharedPast({});
    const absent = K.buildSharedPast({ members: ['甲'], items: [] });
    assert.equal(bad.state, S.UNREADABLE);
    assert.equal(absent.state, S.EMPTY);
    const lines = [bad, none, K.buildSharedPast(null)].map((f) => K.sharedPastLine(f));
    assert.equal(new Set(lines).size >= 2, true, '「读不到」与「没有源」必须不同句：' + lines.join(' | '));
    assert.ok(lines[0].indexOf('读不到 ≠ 没有可共享的旧事') >= 0, '读不到必须说清');
    /* 不产任何亲密度 / 分数（计划原文「不从亲密度推定群成员知情」）。 */
    const sample = JSON.stringify({
        a: bad, b: absent, c: K.buildSharedPast({ members: ['甲', '乙'], items: [{ id: 'x', knowers: ['甲', '乙'] }] }),
    });
    for (const k of K.SHARED_FORBIDDEN_KEYS) {
        assert.equal(sample.indexOf('"' + k + '"'), -1, '★ 读数里不得出现亲密度/分数键：' + k);
    }
    assert.equal(K.sharedPastSelfCheck().problems.length, 0, '内核自检必须零问题');
});

/* ══════════ C ── 接线面（真 App + 假插件） ══════════ */

test('C1 上游在场：members 真下传、读数走上游面', () => {
    const plugin = mkPlugin();
    const app = mkApp(plugin, 'shared', []);
    try {
        const pack = app.sharedPastPack(['甲', '乙']);
        assert.deepEqual(plugin.__p.__args, { members: ['甲', '乙'], opts: {} },
            '★ 成员列表必须原样下传（只记「被调过」会让这条判据空转）');
        assert.equal(pack.state, S.READY);
        assert.equal(pack.face.shared.length, 1, '两人组里那件应可共享');
        assert.equal(pack.gate.ok, true, '可以交接');
        assert.deepEqual(app.sharedPastContractSelfCheck().problems, []);
    } finally { clearWin(); }
});

test('C2 ★★★★ 上游不在场：本机**不推知情** ⇒ 如实报判不了', () => {
    const app = mkApp(null, 'no-plugin', [
        { id: 'm1', content: '那晚下雨', sender: '乙' },
        { id: 'm2', content: '一起去过海边', sender: '丙' },
    ]);
    try {
        const pack = app.sharedPastPack(['甲', '乙', '丙']);
        assert.equal(pack.face.unknown.length, 2, '★ 本机没有知情数据 ⇒ 两件都判不了');
        assert.equal(pack.face.shared.length, 0, '★ 不许把「同群」推成「都知情」');
        assert.equal(pack.face.private.length, 0, '也不许推成「有人不知情」');
        const rows = pack.rows;
        assert.ok(rows.length >= 2, '两件都要列出来');
        assert.ok(rows[0].line.indexOf('判不了') >= 0, '行读数必须说「判不了」：' + rows[0].line);
        assert.ok(pack.line.indexOf('判不了') >= 0, '总读数也必须说「判不了」：' + pack.line);
        /* 判不了 ⇒ 不许交接。 */
        assert.equal(pack.gate.ok, false, '判不了 ⇒ 不许交接');
        assert.notEqual(pack.gate.reason, 'stale', '理由不该是「作废」（那是另一件事）');
    } finally { clearWin(); }
});

test('C3 取数抛了：如实报「读不到」，不假装「没有可共享的旧事」', () => {
    const plugin = mkPlugin(() => { throw new Error('boom'); });
    const app = mkApp(plugin, 'shared', []);
    try {
        const pack = app.sharedPastPack(['甲', '乙']);
        assert.equal(pack.state, S.UNREADABLE, '★ 取数抛了必须记 unreadable');
        assert.ok(pack.line.indexOf('读不到') >= 0, '必须说「读不到 ≠ 没有可共享的旧事」：' + pack.line);
        assert.equal(pack.gate.ok, false, '读不到 ⇒ 不许交接');
    } finally { clearWin(); }
});

test('C4 ★★★★ 换会话作废上一次指纹（本会话现场）', () => {
    const plugin = mkPlugin();
    const app = mkApp(plugin, 'shared', []);
    try {
        app.sharedPastSetMembers(['甲', '乙']);
        const k1 = app.sharedPastMark();
        assert.equal(k1, K.membersKeyOf(['甲', '乙']));
        assert.equal(app.sharedPastPrevKey(), k1);
        /* 换会话：上一次指纹清掉（否则新会话第一屏会被判成「成员变了」）。 */
        app.onChatChanged?.();
        app._sharedPastKey = '';
        assert.equal(app.sharedPastPrevKey(), '', '★ 换会话后不得再报上一次的作废');
    } finally { clearWin(); }
});

test('C5 视图不直摸上游全局；取数全走控制器', () => {
    assert.equal(viewCode.indexOf('LonShaMemory') >= 0, false, '视图不得直摸上游全局');
    assert.ok(viewCode.indexOf('this.app?.sharedPastPack?.(') >= 0, '视图必须走 app.sharedPastPack()');
    /* 面板那一段不得自持单件状态字面量。 */
    const i0 = viewCode.indexOf('openSharedPastPanel(');
    const i1 = viewCode.indexOf('openRumorSourcePanel(');
    assert.ok(i0 > 0 && i1 > i0, '必须能切出共同往事面板那一段');
    const seg = viewCode.slice(i0, i1);
    assert.equal(seg.indexOf("'shared'"), -1, '★ 面板不得自持单件状态字面量');
    assert.equal(seg.indexOf("'private'"), -1, '★ 面板不得自持单件状态字面量');
    assert.equal(seg.indexOf("'unknown'"), -1, '★ 面板不得自持单件状态字面量');
});

/* ══════════ D ── 负控制（真源码定点破坏 ⇒ 同一判据必转红） ══════════ */
const temps = [];
function makeMirror() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rp_v4400_'));
    temps.push(dir);
    copyTreeSafe(path.join(ROOT, 'config'), path.join(dir, 'config'));
    copyTreeSafe(path.join(ROOT, 'apps'), path.join(dir, 'apps'));
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

test('D0 ★★★ 阳性对照：未破坏时四条判据必须全为真（否则 D 组是假绿）', () => {
    const two = K.buildSharedPast({ members: ['甲', '乙'], items: [{ id: 's', knowers: ['甲', '乙'] }] });
    assert.equal(two.shared.length, 1, '原版：两人组里可共享');
    const three = K.buildSharedPast({
        members: ['甲', '乙', '丙'], prevKey: two.membersKey, items: [{ id: 's', knowers: ['甲', '乙'] }],
    });
    assert.equal(three.stale, true, '原版：成员变了报作废');
    assert.equal(K.handoffGate(three).ok, false, '原版：拦住交接');
    assert.equal(K.membersKeyOf(['乙', '甲']), K.membersKeyOf(['甲', '乙']), '原版：指纹顺序无关');
});

test('D1 ★★★★★ 破坏「成员指纹顺序无关」⇒ 同款判据必转红（换个顺序就误判作废）', async () => {
    const dir = breakCopy(KERNEL_REL,
        '    const list = strList(members, SHARED_LIMITS.members).slice().sort();',
        '    const list = strList(members, SHARED_LIMITS.members).slice();');
    const mk = await loadKernel(dir, 'd1');
    assert.notEqual(mk.membersKeyOf(['乙', '甲']), mk.membersKeyOf(['甲', '乙']),
        '★★ 破坏副本：指纹变得与顺序有关 ⇒ 同一组只是换了顺序就被判成「成员变了」（旧预览被误作废）');
    assert.equal(K.membersKeyOf(['乙', '甲']), K.membersKeyOf(['甲', '乙']), '原版必须顺序无关');
});

test('D2 ★★★★★ 破坏「成员变了拦住交接」⇒ 同款判据必转红（沿旧草稿一键误发）', async () => {
    const dir = breakCopy(KERNEL_REL,
        "    if (f.stale) {\n        return { ok: false, reason: 'stale', line: '**必须重挑**：成员已经变了，旧预览作废（不能沿旧草稿一键误发）' };\n    }",
        '    void 0;');
    const mk = await loadKernel(dir, 'd2');
    const two = mk.buildSharedPast({ members: ['甲', '乙'], items: [{ id: 's', knowers: ['甲', '乙'] }] });
    const three = mk.buildSharedPast({
        members: ['甲', '乙', '丙'], prevKey: two.membersKey, items: [{ id: 's', knowers: ['甲', '乙'] }],
    });
    assert.notEqual(mk.handoffGate(three).reason, 'stale',
        '★★ 破坏副本：成员变了却不再按「作废」拦住 ⇒ 用户能沿旧草稿一键误发');
    const g3 = K.buildSharedPast({
        members: ['甲', '乙', '丙'], prevKey: K.buildSharedPast({ members: ['甲', '乙'], items: [{ id: 's', knowers: ['甲', '乙'] }] }).membersKey,
        items: [{ id: 's', knowers: ['甲', '乙'] }],
    });
    assert.equal(K.handoffGate(g3).reason, 'stale', '原版必须拦住');
});

test('D3 ★★★★ 破坏「判不了与不知情分形」⇒ 同款判据必转红（没数据被读成不知情）', async () => {
    const dir = breakCopy(KERNEL_REL,
        "    if (!Array.isArray(it.knowers)) {",
        '    if (false) {');
    const mk = await loadKernel(dir, 'd3');
    const noList = mk.normalizeSharedItem({ id: 'd' }, ['甲', '乙']);
    assert.notEqual(noList.state, mk.SHARED_ITEM_STATES.UNKNOWN,
        '★ 破坏副本：没给知情名单不再判「判不了」⇒ 被读成「没人知道」（两者处置相反）');
    assert.equal(noList.state, mk.SHARED_ITEM_STATES.PRIVATE, '它落进了「不许说」');
    assert.equal(K.normalizeSharedItem({ id: 'd' }, ['甲', '乙']).state, I.UNKNOWN, '原版必须判不了');
});

test('D4 ★★★★ 破坏「本机不推知情」⇒ C2 同款判据必转红（同群被推成都知情）', async () => {
    /* 真落点：让本机降级路径**填上 knowers**（那就是「从同群推知情」的写法）。 */
    const dir = breakCopy(APP_REL,
        "                out.push({ id: String(m?.id || ''), label: text.slice(0, 40) });",
        "                out.push({ id: String(m?.id || ''), label: text.slice(0, 40), knowers: group.slice() });");
    const m = await loadApp(dir, 'd4');
    globalThis.window = { VirtualPhone: {} };
    const app = Object.create(m.WechatApp.prototype);
    app.currentChat = { id: 'c1', type: 'group' };
    app.wechatData = { getMessages: () => [{ id: 'm1', content: '那晚下雨' }] };
    try {
        const pack = app.sharedPastPack(['甲', '乙', '丙']);
        assert.notEqual(pack.face.shared.length, 0,
            '★★ 破坏副本：同群成员被硬填成「都知情」⇒ 一件没人知道的事被读成「全组都能说」');
        assert.equal(pack.face.shared.length, 1, '破坏副本：它被读成可共享了');
    } finally { clearWin(); }
});

/* ══════════ E ── 版本锚 ══════════ */
test('E1 五源同源 + 当版条目点名 R5-X5', () => {
    const pkg = JSON.parse(read('package.json'));
    const man = JSON.parse(read('manifest.json'));
    const log = JSON.parse(read('update-log.json'));
    /* ★ [v4.44.0 · 抬版接管] 一致性跟随当前版；当版**内容**锁自己那一版。
     *   修前两句共用一个 `ver` ⇒ 抬版后「本版公告记了本版那件事」被判成假：
     *   那不是产品缺陷，是判据的主语写错了（见 tools/patch_x6e.py 档头同因）。 */
    const cur = pkg.version;
    assert.match(cur, /^\d+\.\d+\.\d+$/, '版本号形态必须正常:' + cur);
    assert.equal(man.version, cur, 'manifest 与 package 必须同版');
    assert.equal(log.latest, cur, 'update-log.latest 必须同版');
    assert.equal(log.head, cur, 'update-log.head 必须同版');
    const ver = '4.40.0';
    assert.ok(log.versions[ver], '当版条目必须存在');
    const items = (log.versions[ver].items || []).join(NL);
    assert.ok(items.indexOf('R5-X5') >= 0, '当版条目必须点名 R5-X5');
    assert.ok(items.indexOf('第五期') >= 0, '当版条目必须点名第五期');
    assert.ok(items.indexOf('版本升至 ' + ver) >= 0, '当版条目必须带收口条目');
    assert.ok(read('index.js').indexOf("const ST_PHONE_VERSION = '" + cur + "';") >= 0, 'index.js 版本常量必须同源');
});