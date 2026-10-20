/* ============================================================
 * tests/system-v4390.test.mjs -- [v4.39.0 · 第五期 R5-X4 传闻源头图与证词回溯]
 *
 * 验收口径（计划原文 R5-X4）：
 *   「从一条群消息/社媒事件进入『来自哪里』，显示转述链、共同根、独立证词与被撤回源；
 *     可沿边回到原消息，对照反证。」
 *   验收旅程：「**三次转发同一消息呈一个根，另一个目击者另列**；删除根消息后引用显示失效；
 *     反证可点开；**没有证据链时不画编造连线**。」
 *   不做：**不重复实现舆论热度**；**不给人物贴骗子标签**。
 *
 * 【修前实测的缺口（读码可复算，不是推演）】
 *   溯源图（`config/provenance-graph.js`，R-X2 已交付）能回答「这条从哪来、上游还在不在、
 *   被谁撤了」；`retellChains`（context-compose）也会把「同一传闻三平台转述」归成一条链。
 *   但**手机侧零消费**：全仓零 `independent` / `corroborat` 命中。
 *   于是「一条消息被转了三次」与「三个目击者各说了一遍」在界面上**完全同形** ——
 *   而这两件事处置相反（前者仍是孤证、后者才算互相印证）。
 *   计划原文点名要治的正是这半句：**「热度高」与「独立来源多」是不同结果**。
 *
 * 【本版落的三件】
 *   （一）契约件 `config/rumor-source-contract.js`：六态分形（absent / no-chain /
 *   single / corroborated / disputed / unreadable）、**转述不算独立来源**（按 rootKey 去重）、
 *   未标注不算独立、反证独立成态且**优先呈现**、被撤回的源照旧列出、不产任何可信度分数、
 *   十项自证。
 *   （二）控制器 `wechat-app.js`：`rumorFaceOf`（取数走上游 `rumorSources`；上游不在场时
 *   落**纯本地降级**——同群同文只算转述、独立来源判不了）+ `_localRetellOf` +
 *   `rumorContractSelfCheck`。
 *   （三）视图 `chat-view.js`：消息菜单「来自哪里」入口 + `openRumorSourcePanel` 面板。
 *
 * 判据面（六组）：
 *   A 口径：六态互不同形 / 独立来源唯一出处 / 纯契约零副作用 / 视图接线
 *   B 内核行为：转述不算独立（核心）、同根不同类别仍算一条、未标注不算独立、
 *            反证优先且独立成态、被撤回不消失、没有链与读不到分形
 *   C 接线行为：真 App 走完整旅程（上游在场 / 上游不在场只给转述 / 取数抛了 /
 *            同文转发只算转述 / 自检真消费）
 *   D 负控制：真源码定点破坏 ⇒ 同款判据必转红（每条配原版必真的反向对照）
 *   E 版本锚：五源同源 + 当版条目点名 R5-X4
 *
 * 【为什么负控制破坏副本而不是原仓】见 tests/system-v4120.test.mjs 档头（同规）。
 * 【为什么「沿边回到原消息」不在本套件判到底】那属**真 DOM 层**读数
 *   （点击 + 渲染 + 跳转），归浏览器门；本套件判它的**可判定前件**：
 *   来源行带得出 ref、跳转声明来自既有 `pgJumpOf`（本版不另造跳转）。
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

const KERNEL_REL = 'config/rumor-source-contract.js';
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
const S = K.RUMOR_STATES;

/* ══════════ 假件 ══════════ */
function mkStorage() {
    const mem = new Map();
    return { get: (k, d) => (mem.has(k) ? mem.get(k) : d), set: (k, v) => { mem.set(k, v); }, has: (k) => mem.has(k) };
}
/**
 * 上游插件假身。`impl` 可换 ⇒ 各测试自己造「上游在场 / 取数抛了」。
 *   ★ 假件必须**真收参数**并把它转成回执（只记「被调过」会让「claim 真下传了没有」空转）。
 */
function mkPlugin(impl) {
    const p = {};
    p.__args = null;
    p.rumorSources = (claim, opts) => {
        p.__args = { claim: claim, opts: opts || null };
        if (impl) return impl(claim, opts || {});
        return {
            claim: claim,
            sources: [
                { id: 's1', origin: 'witness', rootKey: 'r1', label: '乙' },
                { id: 's2', origin: 'document', rootKey: 'r2', label: '物业记录' },
            ],
            refutes: [],
        };
    };
    return { LonShaMemory: p, __p: p };
}
/** 造一个真 App 实例（带最小 wechatData 假件，供 _localRetellOf 取同群同文）。
 *   ★ 不走 `new WechatApp(...)`：真构造期会 `loadStyles()`（要 `document`）与 `new ChatView()`
 *   （要 `Audio`），那是**夹具缺件**而不是本版缺陷。本判据要验的是**本版新增的那两个方法**
 *   （`rumorFaceOf` / `_localRetellOf`），故按真原型建实例、只补这两个方法用到的字段 ——
 *   方法体本身仍是**真源码**（原型来自真类），不是抄一份。 */
function mkApp(plugin, kind, messages) {
    globalThis.window = {
        VirtualPhone: {},
        ...(kind === 'no-plugin' ? {} : { LonShaMemory: plugin.LonShaMemory })
    };
    const app = Object.create(APP.WechatApp.prototype);
    app.currentChat = { id: 'c1' };
    app.wechatData = { getMessages: () => (Array.isArray(messages) ? messages : []) };
    return app;
}
function clearWin() { delete globalThis.window; }

/* ══════════ A ── 口径面 ══════════ */

test('A1 六态互不同形：没有面 / 没有可回溯来源 / 孤证 / 互相印证 / 有争议 / 读不到', () => {
    const states = Object.values(S);
    assert.equal(new Set(states).size, states.length, '★ 六态值必须唯一（压平即造出处置相反的处境长得一样）');
    assert.notEqual(S.ABSENT, S.NO_CHAIN, '「没有溯源面」与「这一条没有可回溯来源」处置相反');
    assert.notEqual(S.SINGLE, S.CORROBORATED, '★「孤证」与「互相印证」处置相反（本项核心）');
    assert.notEqual(S.DISPUTED, S.CORROBORATED, '「有争议」与「互相印证」处置相反');
    assert.notEqual(S.UNREADABLE, S.NO_CHAIN, '「读不到」与「没有来源」处置相反');
    /* 派发相严格判 true。 */
    assert.equal(K.planRumorState(true, 0), S.NO_CHAIN);
    assert.equal(K.planRumorState(false, 3), S.ABSENT);
    for (const bad of [undefined, null, 0, 1, 'yes', {}]) {
        assert.equal(K.planRumorState(bad, 3), S.ABSENT, '★ 非 true 一律当「没有」：' + JSON.stringify(bad));
    }
    assert.ok(kernelCode.indexOf('hasFace !== true') >= 0, '严格判必须写在代码里');
});

test('A2 独立来源的判定只有一处出处：视图与控制器都不自己算', () => {
    assert.ok(kernelCode.indexOf('function normalizeRumorFace(') >= 0, '唯一装配点必须真存在');
    assert.equal(viewCode.indexOf('independent'), -1, '★ 视图不得自己算独立来源数');
    assert.equal(appCode.indexOf('independent'), -1, '★ 控制器不得自己算独立来源数');
    assert.ok(appCode.indexOf('normalizeRumorFace(') >= 0, '控制器必须转交契约件');
    assert.ok(viewCode.indexOf('rumorFaceOf?.(') >= 0, '视图必须走 app.rumorFaceOf()');
    /* 「热度高 ≠ 独立来源多」那一句也只许契约件一处拼。 */
    assert.ok(kernelCode.indexOf('function corroborationLineOf(') >= 0, '唯一出处必须真存在');
    assert.equal(viewCode.indexOf('孤证'), -1, '★ 视图不得自己拼「孤证」那一句');
    assert.ok(viewCode.indexOf('corroboration') >= 0, '视图必须读取数口给的 corroboration');
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

test('A4 视图接线：菜单入口在场、面板真渲染、事件真投递', () => {
    assert.ok(viewSrc.indexOf('data-action="rumor-source"') >= 0, '消息菜单缺「来自哪里」入口');
    assert.ok(viewSrc.indexOf('来自哪里') >= 0, '入口文案必须在场');
    assert.ok(viewCode.indexOf("action === 'rumor-source'") >= 0, '菜单动作必须真接线');
    assert.ok(viewCode.indexOf('this.openRumorSourcePanel(') >= 0, '动作必须真调到面板');
    for (const cls of ['wx-rumor-panel', 'wx-rumor-close', 'wx-rumor-row', 'wx-rumor-none']) {
        assert.ok(viewSrc.indexOf(cls) >= 0, '视图缺类 ' + cls);
    }
    /* 面板只在「可以是被转述的内容」上给（文本 / 图片）。 */
    assert.ok(viewCode.indexOf('if (isTextMessage || isImageMessage)') >= 0, '入口条件必须在场');
    /* 上游不在场时如实说读不出，不假装「没有来源」。 */
    assert.ok(viewSrc.indexOf('本版 App 未接线') >= 0, '取数口读不出必须如实说');
});

/* ══════════ B ── 内核行为面 ══════════ */

test('B1 ★★★★★ 三次转发同一消息呈一个根（仍是孤证）；另一个目击者另列', () => {
    /* 同根：一次目击 + 两处转述 ⇒ 独立来源 1 条（**孤证**）。 */
    const one = K.normalizeRumorFace({
        claim: '甲搬走了',
        sources: [
            { id: 's1', origin: 'witness', rootKey: 'r1', label: '乙' },
            { id: 's2', origin: 'retell', rootKey: 'r1', label: '丙' },
            { id: 's3', origin: 'retell', rootKey: 'r1', label: '丁' },
        ],
    });
    assert.equal(one.independent, 1, '★ 同一根下的三条只算一条独立来源');
    assert.equal(one.retell, 2, '两处转述必须单独计数');
    assert.equal(one.state, S.SINGLE, '★ 转述再多也还是孤证');
    assert.ok(K.corroborationLineOf(one).indexOf('孤证') >= 0, '必须明说孤证');
    assert.ok(K.corroborationLineOf(one).indexOf('不是新来源') >= 0, '必须点明转述不是新来源');

    /* 另一个目击者（不同根）⇒ 互相印证。 */
    const two = K.normalizeRumorFace({
        claim: '甲搬走了',
        sources: [
            { id: 's1', origin: 'witness', rootKey: 'r1', label: '乙' },
            { id: 's2', origin: 'retell', rootKey: 'r1', label: '丙' },
            { id: 's3', origin: 'witness', rootKey: 'r9', label: '戊' },
        ],
    });
    assert.equal(two.independent, 2, '另一条不同根 ⇒ 第二条独立来源');
    assert.equal(two.state, S.CORROBORATED, '≥2 条独立来源 ⇒ 互相印证');
    assert.notEqual(K.corroborationLineOf(two), K.corroborationLineOf(one), '★ 两态必须不同句');
});

test('B2 同根不同类别仍算一条；未标注不算独立（判不了不硬算）', () => {
    const sameRoot = K.normalizeRumorFace({
        sources: [{ id: 'a', origin: 'witness', rootKey: 'r' }, { id: 'b', origin: 'document', rootKey: 'r' }],
    });
    assert.equal(sameRoot.independent, 1, '★ 同一件事的两种说法不是两个来源');
    const unknown = K.normalizeRumorFace({
        sources: [{ id: 'a', origin: 'unknown', rootKey: 'r1' }, { id: 'b', origin: 'weird-name', rootKey: 'r2' }],
    });
    assert.equal(unknown.independent, 0, '★ 未标注来源不算独立（判不了不硬算）');
    assert.equal(unknown.unknown, 2, '未标注必须单独计数');
    assert.equal(unknown.sources[1].originRaw, 'weird-name', '不认识的类别名必须如实留下原名');
    assert.ok(K.rumorRowsOf(unknown)[1].line.indexOf('weird-name') >= 0, '读数行必须点名那个不认识的类别');
    /* 单条 witness ⇒ 孤证（不是「没有来源」）。 */
    const single = K.normalizeRumorFace({ sources: [{ id: 'a', origin: 'witness', rootKey: 'r1' }] });
    assert.equal(single.state, S.SINGLE);
    assert.notEqual(single.state, S.NO_CHAIN, '★「孤证」与「没有来源」必须不同形');
});

test('B3 反证优先且独立成态；被撤回的源不消失', () => {
    const disputed = K.normalizeRumorFace({
        sources: [{ id: 'a', origin: 'witness', rootKey: 'r1' }, { id: 'b', origin: 'witness', rootKey: 'r2' }],
        refutes: ['甲其实没搬'],
    });
    assert.equal(disputed.state, S.DISPUTED, '有反证 ⇒ disputed');
    const rows = K.rumorRowsOf(disputed);
    assert.equal(rows[0].kind, 'refute', '★ 反证必须排在最前（用户最该先看的那一格）');
    assert.ok(rows[0].line.indexOf('甲其实没搬') >= 0, '反证内容必须在场');
    assert.ok(K.corroborationLineOf(disputed).indexOf('有争议') >= 0, '有争议必须明说');

    /* 被撤回的源**照旧列出**并标失效。 */
    const wd = K.normalizeRumorFace({
        sources: [{ id: 'a', origin: 'witness', rootKey: 'r1', label: '乙', state: 'withdrawn' }],
    });
    assert.equal(wd.withdrawn.length, 1, '被撤回的源必须如实列出');
    assert.ok(K.rumorRowsOf(wd)[0].line.indexOf('已撤回') >= 0, '读数行必须说清「已撤回」');
    assert.ok(K.rumorRowsOf(wd)[0].line.indexOf('曾经有过') >= 0, '必须说清是「曾经有过，现在失效」');
});

test('B4 没有链 / 读不到 / 没有面 三态三句不同；不产任何可信度分数', () => {
    const none = K.normalizeRumorFace({ claim: 'x' });
    const bad = K.normalizeRumorFace({ thrown: true });
    const absent = K.normalizeRumorFace(null);
    assert.equal(none.state, S.NO_CHAIN);
    assert.equal(bad.state, S.UNREADABLE);
    assert.equal(absent.state, S.ABSENT);
    const lines = [none, bad, absent].map((f) => K.rumorLineOf(f));
    assert.equal(new Set(lines).size, 3, '★ 三态必须三句不同：' + lines.join(' | '));
    assert.ok(lines[0].indexOf('不是「没人说过」') >= 0, '没有来源必须说清不是「没人说过」');
    assert.ok(lines[1].indexOf('读不到 ≠ 没有来源') >= 0, '读不到必须说清');
    /* 不产任何可信度 / 热度（计划原文两条不做）。 */
    const sample = JSON.stringify({
        a: none, b: bad, c: absent,
        d: K.normalizeRumorFace({ sources: [{ id: 'a', origin: 'witness', rootKey: 'r' }] }),
    });
    for (const k of K.RUMOR_FORBIDDEN_KEYS) {
        assert.equal(sample.indexOf('"' + k + '"'), -1, '★ 读数里不得出现可信度/热度键：' + k);
    }
});

test('B5 自检十项零问题，且各态与来源类别计数与词表同源', () => {
    const r = K.rumorSelfCheck();
    assert.deepEqual(r.problems, [], '★ 内核自检必须零问题：' + JSON.stringify(r.problems));
    assert.equal(r.states, 6, '六态');
    assert.equal(r.origins, 4, '四个来源类别');
    assert.equal(Object.keys(K.RUMOR_STATES).length, 6);
});

/* ══════════ C ── 接线面（真 App + 假插件） ══════════ */

test('C1 上游在场：claim 真下传、读数走上游面', () => {
    const plugin = mkPlugin();
    const app = mkApp(plugin, 'rumor', []);
    try {
        const face = app.rumorFaceOf({ id: 'm1', content: '甲搬走了' });
        assert.deepEqual(plugin.__p.__args, { claim: '甲搬走了', opts: { messageId: 'm1' } },
            '★ claim 与消息 id 必须原样下传（只记「被调过」会让这条判据空转）');
        assert.equal(face.state, S.CORROBORATED, '两条不同根 ⇒ 互相印证');
        assert.ok(face.rows.length >= 2, '逐条来源必须给出来');
        assert.deepEqual(app.rumorContractSelfCheck().problems, []);
    } finally { clearWin(); }
});

test('C2 ★★★★ 上游不在场：只给本机能证实的转述，独立来源判不了（不硬算）', () => {
    const app = mkApp(null, 'no-plugin', [
        { id: 'm1', content: '甲搬走了', sender: '乙' },
        { id: 'm2', content: '甲搬走了', sender: '丙' },
        { id: 'm3', content: '甲搬走了', sender: '丁' },
    ]);
    try {
        const face = app.rumorFaceOf({ id: 'm1', content: '甲搬走了' });
        assert.equal(face.state, S.SINGLE, '★ 同群同文只算转述 ⇒ 仍是孤证');
        assert.equal(face.face.independent, 0, '★ 上游不在场时独立来源**判不了**（不许硬算）');
        assert.equal(face.face.retell, 2, '本机能证实的转述要如实计数');
        assert.ok(face.corroboration.indexOf('孤证') >= 0, '必须明说孤证：' + face.corroboration);
        /* 一行都没转述 ⇒ 没有可回溯来源（不是「没人说过」）。 */
        const single = app.rumorFaceOf({ id: 'x1', content: '从没人转过的独白' });
        assert.equal(single.state, S.NO_CHAIN, '没有同文痕迹 ⇒ 没有可回溯来源');
    } finally { clearWin(); }
});

test('C3 取数抛了：如实报「读不到」，不假装「没有来源」', () => {
    const plugin = mkPlugin(() => { throw new Error('boom'); });
    const app = mkApp(plugin, 'rumor', []);
    try {
        const face = app.rumorFaceOf({ id: 'm1', content: '甲搬走了' });
        assert.equal(face.state, S.UNREADABLE, '★ 取数抛了必须记 unreadable');
        assert.ok(face.line.indexOf('读不到') >= 0, '必须说「读不到 ≠ 没有来源」：' + face.line);
    } finally { clearWin(); }
});

test('C4 本机转发痕迹只算转述：同文不同人也不升格为独立来源', () => {
    const app = mkApp(null, 'no-plugin', [
        { id: 'm1', content: '甲搬走了', sender: '乙' },
        { id: 'm2', content: '甲搬走了', sender: '丙' },
    ]);
    try {
        const local = app._localRetellOf({ id: 'm1', content: '甲搬走了' });
        assert.equal(local.length, 1, '同文另一处要如实收进来');
        for (const s of local) {
            assert.equal(s.origin, K.RUMOR_ORIGINS.RETELL,
                '★★ 本机转发痕迹**只能算转述**（同一段话出现两次证明不了两个人各自知道）');
        }
        /* 同文不同发送者：独立来源仍是 0（不因「不同人」升格）。 */
        const face = app.rumorFaceOf({ id: 'm1', content: '甲搬走了' });
        assert.equal(face.face.independent, 0, '★ 不同人转发同一句话仍是同一来源');
    } finally { clearWin(); }
});

test('C5 视图不直摸上游全局；取数全走控制器', () => {
    assert.equal(viewCode.indexOf('LonShaMemory') >= 0, false, '视图不得直摸上游全局');
    assert.ok(viewCode.indexOf('this.app.rumorFaceOf?.(') >= 0, '视图必须走 app.rumorFaceOf()');
    /* 视图不得自己判状态字面量（那是契约件的事）。
     *   ★ 只判**本版新增的那两个方法**那一段：`'single'` / `'corroborated'` 在
     *   chat-view 别处（18888 行的既有文件）可能作为别的字符串出现，
     *   判全文会把既有形态算成本版缺陷。 */
    const i0 = viewCode.indexOf('openRumorSourcePanel(');
    const i1 = viewCode.indexOf('showMessageMenu(messageIndex)');
    assert.ok(i0 > 0 && i1 > i0, '必须能切出传闻面板那一段');
    const rumorSeg = viewCode.slice(i0, i1);
    assert.equal(rumorSeg.indexOf("'corroborated'"), -1, '★ 面板不得自持状态字面量');
    assert.equal(rumorSeg.indexOf("'single'"), -1, '★ 面板不得自持状态字面量');
    assert.equal(rumorSeg.indexOf("'disputed'"), -1, '★ 面板不得自持状态字面量');
});

/* ══════════ D ── 负控制（真源码定点破坏 ⇒ 同一判据必转红） ══════════ */
const temps = [];
function makeMirror() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rp_v4390_'));
    temps.push(dir);
    copyTreeSafe(path.join(ROOT, 'config'), path.join(dir, 'config'));
    /* ★ 镜像必须跟上真依赖：`chat-view.js` → `../app-injection.js` → 各 App 的 data 模块
     *   （如 `place/place-data.js`）。缺任何一个 ⇒ 副本 import 就是 ERR_MODULE_NOT_FOUND，
     *   负控制会变成「因缺文件而红」而不是「因破坏而红」（本仓同一支笔的教训已出现多次）。
     *   故这里直接**整棵 apps 树**拷过去 —— 少拷一处就是下一次踩同一个坑。 */
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
    assert.equal(K.planRumorState('yes', 3), S.ABSENT, '原版：严格判 true');
    const one = K.normalizeRumorFace({
        sources: [{ id: 's1', origin: 'witness', rootKey: 'r1' }, { id: 's2', origin: 'retell', rootKey: 'r1' }],
    });
    assert.equal(one.independent, 1, '原版：转述不算独立');
    assert.equal(K.normalizeRumorFace({ sources: [{ id: 'a', origin: 'unknown', rootKey: 'r' }] }).independent, 0, '原版：未标注不算独立');
    assert.equal(K.normalizeRumorFace({ claim: 'x' }).state, S.NO_CHAIN, '原版：没有来源单列');
});

test('D1 ★★★★★ 破坏「转述不算独立来源」⇒ 同款判据必转红（把转发当独立证词）', async () => {
    /* ★ 破坏落点要**真的改变独立计数**：把「只认 witness/document」这一条改成恒真，
     *   于是 retell 也走进独立分支（首版改 `RETELL` 那一条时，去重仍在 ⇒ 计数不变，
     *   红得落点不对 —— 与 R5-X1 的 D5 同族）。 */
    const dir = breakCopy(KERNEL_REL,
        "        if (s.origin !== RUMOR_ORIGINS.WITNESS && s.origin !== RUMOR_ORIGINS.DOCUMENT) { unknown += 1; continue; }",
        '        if (false) { unknown += 1; continue; }');
    const mk = await loadKernel(dir, 'd1');
    const one = mk.normalizeRumorFace({
        sources: [
            { id: 's1', origin: 'witness', rootKey: 'r1' },
            { id: 's2', origin: 'unknown', rootKey: 'r2' },
            { id: 's3', origin: 'unknown', rootKey: 'r3' },
        ],
    });
    assert.notEqual(one.independent, 1,
        '★★ 破坏副本：未标注来源被算成独立 ⇒「判不了」被读成「有来源」');
    assert.equal(one.independent, 3, '破坏副本：三条全被算成独立来源');
    const good = K.normalizeRumorFace({
        sources: [
            { id: 's1', origin: 'witness', rootKey: 'r1' },
            { id: 's2', origin: 'unknown', rootKey: 'r2' },
            { id: 's3', origin: 'unknown', rootKey: 'r3' },
        ],
    });
    assert.equal(good.independent, 1, '原版必须只认 witness/document');
});

test('D2 ★★★★ 破坏「同根只算一条」⇒ 同款判据必转红（同一件事算两次）', async () => {
    const dir = breakCopy(KERNEL_REL,
        '        if (roots.has(s.rootKey)) continue;    // 同一根下的多条只算一条',
        '        if (false) continue;');
    const mk = await loadKernel(dir, 'd2');
    const same = mk.normalizeRumorFace({
        sources: [{ id: 'a', origin: 'witness', rootKey: 'r' }, { id: 'b', origin: 'document', rootKey: 'r' }],
    });
    assert.equal(same.independent, 2,
        '★★ 破坏副本：同一根下的两条被算成两个独立来源 ⇒ 同一件事被算两次');
    const good = K.normalizeRumorFace({
        sources: [{ id: 'a', origin: 'witness', rootKey: 'r' }, { id: 'b', origin: 'document', rootKey: 'r' }],
    });
    assert.equal(good.independent, 1, '原版必须只算一条');
});

test('D3 ★★★★ 破坏「转述单独计数」⇒ 同款判据必转红（转述被并进未标注）', async () => {
    const dir = breakCopy(KERNEL_REL,
        "        if (s.origin === RUMOR_ORIGINS.RETELL) { retell += 1; continue; }",
        '        if (false) { retell += 1; continue; }');
    const mk = await loadKernel(dir, 'd3');
    const one = mk.normalizeRumorFace({
        sources: [
            { id: 's1', origin: 'witness', rootKey: 'r1' },
            { id: 's2', origin: 'retell', rootKey: 'r1' },
        ],
    });
    assert.notEqual(one.retell, 1,
        '★ 破坏副本：转述不再单独计数（它被并进「未标注」，而两者处置不同：一处是「同一来源又说了一遍」、一处是「判不了」）');
    assert.equal(one.unknown, 1, '破坏副本：转述落进了未标注格');
    const good = K.normalizeRumorFace({
        sources: [{ id: 's1', origin: 'witness', rootKey: 'r1' }, { id: 's2', origin: 'retell', rootKey: 'r1' }],
    });
    assert.equal(good.retell, 1, '原版必须单独计数转述');
});

test('D4 ★★★★ 破坏「反证优先呈现」⇒ 同款判据必转红（反证被压到来源后面）', async () => {
    const dir = breakCopy(KERNEL_REL,
        "    for (const ref of ((f && f.refutes) || [])) {\n        rows.push({ kind: 'refute', line: '反证：' + ref });\n    }",
        '    void 0;');
    const mk = await loadKernel(dir, 'd4');
    const disputed = mk.normalizeRumorFace({
        sources: [{ id: 'a', origin: 'witness', rootKey: 'r1' }],
        refutes: ['甲其实没搬'],
    });
    const rows = mk.rumorRowsOf(disputed);
    assert.notEqual(rows[0].kind, 'refute',
        '★ 破坏副本：反证不再排在最前 ⇒ 用户看不到最该先看的那一格');
    assert.equal(K.rumorRowsOf(K.normalizeRumorFace({
        sources: [{ id: 'a', origin: 'witness', rootKey: 'r1' }], refutes: ['甲其实没搬'],
    }))[0].kind, 'refute', '原版必须把反证排最前');
});

test('D5 ★★★★ 破坏「本机痕迹只算转述」⇒ C4 同款判据必转红', async () => {
    const dir = breakCopy(APP_REL,
        "                    origin: RUMOR_ORIGINS.RETELL, rootKey: 'local:' + text.slice(0, 40),",
        "                    origin: RUMOR_ORIGINS.WITNESS, rootKey: 'local:' + text.slice(0, 40),");
    const m = await loadApp(dir, 'd5');
    globalThis.window = { VirtualPhone: {} };
    /* 同 mkApp：按真原型建实例（真构造期要 document / Audio，那是夹具缺件）。 */
    const app = Object.create(m.WechatApp.prototype);
    app.currentChat = { id: 'c1' };
    app.wechatData = { getMessages: () => [{ id: 'm1', content: '甲搬走了' }, { id: 'm2', content: '甲搬走了' }] };
    try {
        const local = app._localRetellOf({ id: 'm1', content: '甲搬走了' });
        assert.notEqual(local[0].origin, 'retell',
            '★★ 破坏副本：本机转发痕迹被算成「目击者亲述」⇒ 同一句话出现两次被读成两个独立来源');
        assert.equal(local[0].origin, 'witness', '破坏副本：它被升格成独立来源了');
    } finally { clearWin(); }
});

/* ══════════ E ── 版本锚 ══════════ */
test('E1 五源同源 + 当版条目点名 R5-X4', () => {
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
    assert.ok(items.indexOf('R5-X4') >= 0, '当版条目必须点名 R5-X4');
    assert.ok(items.indexOf('第五期') >= 0, '当版条目必须点名第五期');
    assert.ok(items.indexOf('版本升至 ' + ver) >= 0, '当版条目必须带收口条目');
    assert.ok(read('index.js').indexOf("const ST_PHONE_VERSION = '" + ver + "';") >= 0, 'index.js 版本常量必须同源');
});