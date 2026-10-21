/* ============================================================
 * tests/system-v4470.test.mjs -- [v4.47.0 · 第五期 R5-X7 可丢弃的假设场景双栏试写]
 *
 * 验收口径（计划原文 R5-X7）：
 *   「选择基线时点与两种假设，分别预览材料 / 约束并可显式试写；对照文本保留为草稿；
 *     只有用户选择转为正式分支后才调用原接续确认。」
 *   验收四条：① A 接受邀请、B 拒绝邀请同基线输出可比；② 试写前后正史事实不变；
 *     ③ 关页重开保留草稿但不自动生成；④ 丢弃清临时选择，正式采纳不双建分支。
 *   不做三条：不自动多模型竞赛 / 不后台无限续写 / 不增加第二套生成 API。
 *   落点与依赖：creationdesk / pvdesk 既有草稿和生成队列 + M5-X7；复用 O1 交接，
 *     取消沿原请求生命周期。**必须验证生成通道不会隐式登记假设事实。**
 *
 * 【本件治的缺陷形态（读码可复算，不是推演）】
 *   全仓 `grep -rIn '双栏试写' apps config` **零命中** —— 正史选择
 *   （`config/branch-canon-contract.js`，v4.28.0）只能对**已经存在的**两条分支做
 *   「选哪条进新卷」；而「还没创建正式分支前，先拿两种假设各试写一栏看看」这一步
 *   **没有任何落点**。后果三件都不是报错：
 *     ① 用户只能先建一条正式分支再删 —— 建了就有痕迹，「预演」被读成「已经这么定了」；
 *     ② 「两栏基线不同」与「同基线可比」在界面上同形（都只是两段文本），而两者处置相反；
 *     ③ 「丢弃」没有范围（容易做成「把键全删」），预演没伤正史反而被它删了。
 *
 * 【本件判什么（六组）】
 *   A 口径：五态/逐栏三态/可比性三态互不同形 / 判定顺序（缺基线 > 这一栏没假设 >
 *           两栏同一假设）/ 纯契约零副作用 / 状态字面量唯一出处 /
 *           ★ 本机键归属真跑（`_isChatData` 必须判 chat）
 *   B 契约件内核：拒收各归其因且不清文本 / 基线继承 / 可比性三态与 mixedWithBaseline /
 *               采纳闸三因分形 / 丢弃计划范围与零写 / 禁用键扫描 / 自检真跑
 *   C 台账读写：run 落本机键 → 回读 / 拒收也留住两栏 / 坏存储降级不抛 / 空件不抛
 *   D 宿主落笔：run/keep/adopt/discard 四支在场 / keep 落既有草稿本且幂等 /
 *               adopt 零写正史 / discard 清临时选择并如实报 /
 *               ★ 生成通道不隐式登记假设事实（正史零写）
 *   E 接线：视图元素与事件真投递 / 采纳按钮判据读出口（不猜文案）/ App 出口齐备 /
 *           样式双侧投递 / 不做面可判（无网络、无生成、无评分）
 *   F 负控制 + 版本锚：真源码副本定点破坏 ⇒ 同款判据必转红；五源同源
 *
 * 【为什么负控制破坏副本而不是原仓】见 tests/system-v4120.test.mjs 档头（同规）。
 * 【为什么「同基线可比」必须与「基线不同」分形】两者处置相反：前者差异来自假设本身
 *   （可以照着决定采纳哪栏）；后者的差异里混着基线差（照着决定会改错东西）。
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
const KERNEL_REL = 'config/hypo-trial-contract.js';
const APP_REL = 'apps/creationdesk/creationdesk-app.js';
const VIEW_REL = 'apps/creationdesk/creationdesk-view.js';
const VIEW_CSS_REL = 'apps/creationdesk/creationdesk.css';
const BUNDLE_CSS_REL = 'phone.css';
const HOST_REL = 'index.js';
const NL = '\n';
const countOf = (s, sub) => s.split(sub).length - 1;

const K = await import(pathToFileURL(path.join(ROOT, KERNEL_REL)).href);
const APP = await import(pathToFileURL(path.join(ROOT, APP_REL)).href);
const STORAGE = await import(pathToFileURL(path.join(ROOT, 'config/storage.js')).href);
const kernelSrc = read(KERNEL_REL);
const appSrc = read(APP_REL);
const viewSrc = read(VIEW_REL);
const hostSrc = read(HOST_REL);
const appCssSrc = read(VIEW_CSS_REL);
const bundleCssSrc = read(BUNDLE_CSS_REL);

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
        if (state === 'block') {
            if (c === '*' && d === '/') { state = 'code'; i += 2; continue; }
            i += 1; continue;
        }
        if (state === 'line') {
            if (c === NL) { state = 'code'; out += c; }
            i += 1; continue;
        }
        if (c === '\\') { out += c + (d === undefined ? '' : d); i += 2; continue; }
        if (c === quote) { state = 'code'; out += c; i += 1; continue; }
        out += c; i += 1; continue;
    }
    return out;
}
/** 去字符串字面量（内容清空、引号保留）：负向判据必须用它 —— 被检查的套件里
 *  写着同款判据自身的锚点字符串，只去注释会让判据**自指**（本仓假绿/假红三形之一）。 */
function stripStrings(src) {
    let out = '';
    let i = 0;
    let state = 'code';
    let quote = '';
    while (i < src.length) {
        const c = src[i];
        if (state === 'code') {
            if (c === '"' || c === "'" || c === '`') { state = 'str'; quote = c; out += c; i += 1; continue; }
            out += c; i += 1; continue;
        }
        if (c === '\\') { i += 2; continue; }
        if (c === quote) { state = 'code'; out += c; i += 1; continue; }
        i += 1; continue;
    }
    return out;
}
const kernelCode = stripComments(kernelSrc);
const appCode = stripComments(appSrc);
const viewCode = stripComments(viewSrc);
const hostCode = stripComments(hostSrc);

/** 取 App 的试写块（收窄判据靶子：App 里别处也有 '' 空串与 state 字面量）。 */
function hyBlockOf(src) {
    const a = src.indexOf('hyFace() {');
    const b = src.indexOf('boardTargetIds() {');
    assert.ok(a >= 0 && b > a, 'App 的试写块必须可定位（判据靶子收窄的前提）');
    return src.slice(a, b);
}
const appHyCode = hyBlockOf(appCode);

/** 取宿主的试写分支（收窄靶子：宿主里别处也有 action 分支）。 */
function hostHyBlock(src) {
    const i = src.indexOf("if (action === 'hypo') {");
    assert.ok(i > 0, '宿主必须有 hypo 动作分支（修前零消费）');
    return src.slice(i, i + 9000);
}
const hostHyCode = hostHyBlock(hostCode);

const S = K.HY_STATES;
const LS = K.HY_LANE_STATES;
const C = K.HY_COMPARABLE;

/* ══════════ 假件 ══════════ */
function mkStorage(seed) {
    const bag = new Map(Object.entries(seed || {}));
    return {
        _bag: bag,
        get: (k, d) => (bag.has(k) ? bag.get(k) : (d === undefined ? null : d)),
        set: (k, v) => { bag.set(k, v); },
        remove: (k) => { bag.delete(k); }
    };
}
/** 真 storage（判键归属用；不碰酒馆，只调它的纯判据 `_isChatData`）。 */
const REAL_STORAGE = new STORAGE.PhoneStorage();

function mkApp(storage) {
    globalThis.window = { VirtualPhone: {}, LonShaMemory: undefined };
    return new APP.CreationdeskApp(null, storage || mkStorage());
}
function clearWin() { delete globalThis.window; }

/** 一份「两栏 + 同基线」的现场（验收①的原型：A 接受邀请 / B 拒绝邀请）。
 *  ★ 刻意做成**无参**：带 extra 参数的版本会用 Object.assign 整体覆盖 a / b，
 *    把 text 一起抹掉 —— 首版 B1 就是这么被自己的夹具坑成假红的（fixture 覆盖掉被测字段）。 */
const LANES = () => ({
    a: { assume: { kind: 'accept', text: '她来' }, text: 'A 文本' },
    b: { assume: { kind: 'reject', text: '她不来' }, text: 'B 文本' }
});

/* ══════════ A ── 口径 ══════════ */
test('A1 五态 / 逐栏三态 / 可比性三态各自互不同形，且三种决定恰三种', () => {
    const st = Object.values(S);
    assert.equal(new Set(st).size, st.length, '★ 五态值必须唯一（压平即造出处置相反的处境长得一样）');
    assert.notEqual(S.UNREADABLE, S.ABSENT, '「本机读不出」与「上游不在」处置相反（再试 vs 等上游）');
    assert.notEqual(S.EMPTY, S.ABSENT, '「就绪但还没试写」与「上游不在」处置相反');
    assert.notEqual(S.REFUSED, S.EMPTY, '「输入不合格」与「还没试写」处置相反（补输入 vs 去写）');
    const ls = Object.values(LS);
    assert.equal(new Set(ls).size, ls.length, '★ 逐栏三态值必须唯一');
    assert.notEqual(LS.PENDING, LS.REFUSED, '「这一栏还没写」与「这一栏的假设不合格」处置相反');
    const cp = Object.values(C);
    assert.equal(new Set(cp).size, cp.length, '★ 可比性三态值必须唯一');
    assert.notEqual(C.SAME, C.DIFF, '同基线可比与基线不同处置相反（照着决定 vs 先别决定）');
    assert.notEqual(C.DIFF, C.MISSING, '「基线不同」与「有一栏没记基线」处置相反（改一栏 vs 补基线）');
    assert.equal(K.HY_DECISIONS.length, 3, '决定必须恰三种（采纳 / 保留 / 丢弃）');
    assert.equal(new Set(Object.values(K.HY_DECISION_LABEL)).size, 3, '三种决定的标签必须不同形');
    assert.equal(K.HY_LANES.length, 2, '本项只比两栏');
});

test('A2 ★ 判定顺序：缺基线优先于「这一栏没写假设」，后者优先于「两栏同一假设」', () => {
    /* 夹具一：既没给基线、两栏又都没写假设 ⇒ 必须报「缺基线」（先决条件优先）。 */
    const n1 = K.normalizeTrial({ lanes: { a: {}, b: {} } });
    assert.equal(n1.ok, false, '不合格必须拒');
    assert.equal(n1.why, 'no-baseline', '★ 缺基线必须先报（没有基线，两栏对照根本无从谈起）');
    /* 夹具二：给了基线、两栏没写假设 ⇒ 报「这一栏没写假设」。 */
    const n2 = K.normalizeTrial({ baseline: 20, lanes: { a: {}, b: {} } });
    assert.equal(n2.why, 'no-assume', '给了基线之后才轮到「这一栏没写假设」');
    /* 夹具三：基线 + 两栏假设齐备但同一 ⇒ 报「两栏同一假设」。 */
    const n3 = K.normalizeTrial({
        baseline: 20,
        lanes: {
            a: { assume: { kind: 'accept', text: '她来' } },
            b: { assume: { kind: 'accept', text: '她来' } }
        }
    });
    assert.equal(n3.why, 'same-assume', '两栏同一假设必须拒');
    assert.equal(new Set([n1.why, n2.why, n3.why]).size, 3, '★ 三种错因必须互不同形（压平即三条处置不同的路合成一条）');
    /* 顺序倒了就会把「缺基线」报成「没写假设」—— 源码级自证顺序。 */
    const iBl = kernelCode.indexOf('if (!bl.ok) why = bl.why');
    const iRef = kernelCode.indexOf("else if (refusedLanes.length > 0) why = 'no-assume'");
    const iSame = kernelCode.indexOf("else if (ka && kb && ka === kb) why = 'same-assume'");
    assert.ok(iBl > 0 && iRef > iBl && iSame > iRef, '★ 判定顺序必须是 缺基线 → 没写假设 → 同一假设');
});

test('A3 纯契约零副作用：零 DOM / 零存储 / 零网络 / 零时钟，且不改动入参', () => {
    for (const bad of ['document', 'window', 'localStorage', 'indexedDB', 'fetch', 'XMLHttpRequest',
        'setTimeout', 'setInterval', 'querySelector', 'Date.now', 'Math.random']) {
        assert.equal(kernelCode.indexOf(bad), -1, '假设试写契约件不得出现：' + bad);
    }
    const input = { baseline: 20, lanes: LANES(), picked: 'a' };
    const snap = JSON.stringify(input);
    const a = K.normalizeTrial(input);
    const b = K.normalizeTrial(input);
    assert.equal(a.trial.lanes.a.text, b.trial.lanes.a.text, '纯函数：同样输入必须同样结果');
    assert.equal(JSON.stringify(input), snap, '★ 契约件不得改动入参（零副作用）');
});

test('A4 ★ 本机键归属真跑：必须判 chat（否则换角色带着上一个角色的预演）', () => {
    const keys = Object.values(K.HY_KEYS);
    assert.equal(keys.length, 1, '本项只该新开一个键');
    for (const k of keys) {
        assert.equal(REAL_STORAGE._isChatData(k), true,
            '★ 键 ' + k + ' 必须命中会话隔离前缀（不命中 ⇒ 落全局 extensionSettings ⇒ 换角色串味，'
            + '而且不报错、不崩溃，只错数据 —— 本仓 v2.8.10 事故同族）');
    }
    /* 反坐实：故意用一个不命中任何前缀的键名，判据必须判它不是 chat 键
     *   （防「_isChatData 恒真」这类空转）。 */
    assert.equal(REAL_STORAGE._isChatData('hy_trial_probe'), false,
        '反坐实：裸 hy_ 前缀不在 CHAT_DATA_PATTERNS 里（本版首版正是踩了这一条）');
    assert.ok(REAL_STORAGE.CHAT_DATA_PATTERNS.some((p) => p.test(K.HY_KEYS.trial)),
        '归属由前缀族保证：必须有某条真模式命中本键');
});

test('A5 状态与文案字面量的唯一出处：App 的试写块不自持第二份', () => {
    for (const name of ['HY_STATES', 'HY_LANE_STATES', 'HY_COMPARABLE', 'HY_DECISIONS', 'HY_REASONS']) {
        assert.equal(kernelCode.split('export const ' + name + ' =').length - 1, 1,
            name + ' 只许有一个装配点');
    }
    /* App 的试写块不得自持态字面量（裸字面量即第二份真源）。 */
    for (const lit of ["'refused'", "'unreadable'", "'absent'", "'ready'", "'same-baseline'",
        "'different-baseline'", "'missing-baseline'"]) {
        assert.equal(appHyCode.indexOf(lit), -1,
            '★ App 的试写块不得自持状态字面量 ' + lit + '（须走契约件常量）');
    }
    assert.ok(appHyCode.indexOf('hyNormalizeLane') >= 0, '两栏读数必须走契约件真算（两份实现必然漂移）');
    assert.ok(appHyCode.indexOf('hyCompareLanes') >= 0, '可比性必须走契约件真算');
    /* 视图不得直接调契约件内核，也不得拿文案子串猜态。 */
    assert.equal(viewCode.indexOf('normalizeTrial'), -1, '视图不得直接调契约件内核');
    assert.equal(viewCode.indexOf("indexOf('同基线')"), -1,
        '★ 视图不得拿文案子串猜「采纳按钮画不画」（文案一改按钮就静默消失）');
    assert.ok(viewCode.indexOf('vm.hyAdoptReady === true') >= 0, '采纳按钮的判据必须读 App 出口的态');
    assert.ok(viewCode.indexOf('app.hyKindOf(') >= 0, '视图不得读 App 实例私有态（走出口）');
    assert.equal(viewCode.indexOf('app._hy'), -1, '★ 视图不得伸手读 App 私有态 _hy');
});

/* ══════════ B ── 契约件内核 ══════════ */
test('B1 拒收各归其因，且拒了**照样留住**用户写过的两栏文本', () => {
    const noBl = K.normalizeTrial({ lanes: LANES() });
    assert.equal(noBl.why, 'no-baseline', '缺基线必须按 no-baseline 拒');
    const badBl = K.normalizeTrial({ baseline: '不是数', lanes: LANES() });
    assert.equal(badBl.why, 'bad-baseline', '给了但不认识必须按 bad-baseline 拒（与「没给」不同形）');
    const noAs = K.normalizeTrial({ baseline: 20, lanes: { a: {}, b: {} } });
    assert.equal(noAs.why, 'no-assume', '有一栏没写假设必须按 no-assume 拒');
    const same = K.normalizeTrial({
        baseline: 20,
        lanes: {
            a: { assume: { kind: 'accept', text: '她来' }, text: 'A 文本' },
            b: { assume: { kind: 'accept', text: '她来' }, text: 'B 文本' }
        }
    });
    assert.equal(same.why, 'same-assume', '两栏同一假设必须拒');
    assert.equal(same.trial.lanes.a.text, 'A 文本', '★ 拒了也要留着用户写过的文本（换个走向就能接着写）');
    assert.equal(same.trial.lanes.b.text, 'B 文本', '★ 两栏都留着');
    /* 归因词表是闭集（防随口新词）。 */
    for (const w of ['no-baseline', 'bad-baseline', 'no-assume', 'same-assume', 'no-outlet',
        'unreadable', 'empty', 'not-comparable', 'missing-baseline', 'lane-pending',
        'not-written', 'no-upstream', 'adopt-refused', 'discarded']) {
        assert.ok(K.HY_REASONS[w], '归因词表缺 ' + w);
    }
});

test('B2 基线继承：整块给了基线，逐栏没各填一遍也必须算「同基线可比」', () => {
    const n = K.normalizeTrial({ baseline: 20, lanes: LANES() });
    assert.equal(n.ok, true, '两栏不同假设 + 同基线必须就绪：' + n.why);
    assert.equal(n.trial.lanes.a.baseline.at, 20, '逐栏必须继承整块的基线');
    assert.equal(n.trial.lanes.b.baseline.at, 20, '逐栏必须继承整块的基线');
    const cmp = K.compareLanes(n.trial.lanes.a, n.trial.lanes.b);
    assert.equal(cmp.comparable, C.SAME, '★ 验收①：A 接受邀请 / B 拒绝邀请 + 同基线 ⇒ 可比');
    assert.ok(cmp.diffCount > 0, '两条岔路必须有差异行');
    assert.ok(cmp.changed.every((r) => r.mixedWithBaseline === false),
        '同基线时差异行不得标「混着基线差」');
});

test('B3 可比性三态与 mixedWithBaseline：基线不同 ⇒ 每一行都标出来', () => {
    const a = K.normalizeLane('a', { assume: { kind: 'accept', text: '她来' }, baseline: 20, text: 'A' }).lane;
    const bDiff = K.normalizeLane('b', { assume: { kind: 'reject', text: '她不来' }, baseline: 30, text: 'B' }).lane;
    const c1 = K.compareLanes(a, bDiff);
    assert.equal(c1.comparable, C.DIFF, '基线不同必须报 different-baseline');
    assert.ok(c1.changed.every((r) => r.mixedWithBaseline === true),
        '★ 基线不同时差异行必须每一行都标「混着基线差」（照着决定会改错东西）');
    const bMissing = K.normalizeLane('b', { assume: { kind: 'reject', text: '她不来' } }).lane;
    assert.equal(K.compareLanes(a, bMissing).comparable, C.MISSING,
        '有一栏没记基线必须报 missing-baseline（与「基线不同」不同形）');
    /* 标签必须三态各不同形（界面文案的唯一出处）。 */
    assert.equal(new Set(Object.values(K.HY_COMPARABLE_LABEL)).size, 3, '可比性标签必须三态不同形');
});

test('B4 采纳闸三因分形，且上游缺席不许报成「没有可采纳的内容」', () => {
    const none = K.adoptGate({ lanes: {} }, { hasAdoptFace: true });
    assert.equal(none.why, 'not-written', '两栏都没文本必须报 not-written');
    const n = K.normalizeTrial({ baseline: 20, lanes: LANES() });
    assert.equal(K.adoptGate(n.trial, { hasAdoptFace: true }).why, 'adopt-refused', '没选栏必须报 adopt-refused');
    assert.equal(K.adoptGate({ lanes: n.trial.lanes, picked: 'a' }, { hasAdoptFace: false }).why, 'no-upstream',
        '★ 上游接续面不在场必须报 no-upstream（不是「没有可采纳的内容」—— 两者处置相反）');
    const ok = K.adoptGate({ lanes: n.trial.lanes, picked: 'a' }, { hasAdoptFace: true });
    assert.equal(ok.ok, true, '齐备必须放行');
    assert.equal(ok.picked, 'a', '放行必须把选中栏交回调用方');
    assert.equal(new Set([none.why, 'adopt-refused', 'no-upstream']).size, 3, '三因必须互不同形');
});

test('B5 丢弃计划：范围说清（只清本次预演）、正史零写、如实报清掉几栏', () => {
    const n = K.normalizeTrial({ baseline: 20, lanes: LANES() });
    const dp = K.discardPlan(n.trial);
    assert.equal(dp.canonWrites, 0, '★ 丢弃必须零写正史');
    assert.equal(dp.writesNothing, true, '丢弃恒为只清本机');
    assert.equal(dp.clearedTexts, 2, '两栏都有文本 ⇒ 如实报清掉 2 栏');
    assert.equal(dp.clearedChars, 'A 文本'.length + 'B 文本'.length, '字数必须如实');
    assert.ok(dp.note.indexOf('正史一个字节没动') >= 0, '读数必须点明正史零写（范围要说清）');
    const empty = K.discardPlan({});
    assert.equal(empty.clearedTexts, 0, '空件必须报 0（不许抛）');
});

test('B6 上游探测：不在场照样允许本机手工试写，材料读不到不许塌成「没有材料」', () => {
    const up = K.readHypoTrial({});
    assert.equal(up.state, S.ABSENT, '上游不在必须报缺席');
    assert.equal(up.localOnly, true, '★ 上游不在仍要允许本机手工试写（计划原文的降级口径）');
    const up2 = K.readHypoTrial({ LonShaMemory: { hypoTrialState: () => ({}) } },
        { materials: [], materialsReadable: true });
    assert.equal(up2.state, S.EMPTY, '上游在且材料可读、还没试写 ⇒ empty（不是 ready）');
    const up3 = K.readHypoTrial({ LonShaMemory: { hypoTrialState: () => ({}) } },
        { materials: null, materialsReadable: false });
    assert.equal(up3.state, S.UNREADABLE, '★ 材料读不到必须报 unreadable（不是「这一刻没有材料」）');
});

test('B7 禁用键扫描与自检真跑（不是写「已检查」）', () => {
    assert.equal(K.hasForbiddenKey({ a: { b: { score: 1 } } }), 'score', '禁用键扫描必须真能命中');
    assert.equal(K.hasForbiddenKey({ a: { b: { note: 'x' } } }), null, '干净对象不得误报');
    assert.ok(K.HY_FORBIDDEN_KEYS.indexOf('best') >= 0, '★ 计划原文「不自动多模型竞赛」⇒ 不许排序/评分/推荐');
    const sc = K.hySelfCheck();
    assert.deepEqual(sc.problems, [], '★ 契约件自检必须全绿：' + JSON.stringify(sc.problems).slice(0, 400));
    assert.equal(sc.lanes, 2, '自检必须真数栏数');
    assert.ok(kernelCode.indexOf('function hySelfCheck(') >= 0, '自检必须是真函数（不是常量）');
    assert.ok(kernelCode.indexOf('normalizeTrial({ lanes: { a: { assume: { kind:') >= 0,
        '自检必须真跑拒收夹具（防「返回空 problems 的假自检」）');
});

test('B8 空件一律不抛：出口在畸形输入上必须给出归因，不许炸', () => {
    for (const [nm, fn] of [
        ['normalizeAssume', () => K.normalizeAssume(null)],
        ['normalizeBaseline', () => K.normalizeBaseline(null)],
        ['normalizeLane', () => K.normalizeLane('zz', null)],
        ['normalizeTrial', () => K.normalizeTrial(null)],
        ['compareLanes', () => K.compareLanes(null, null)],
        ['laneLine', () => K.laneLine(null)],
        ['trialLine', () => K.trialLine(null)],
        ['adoptGate', () => K.adoptGate(null, null)],
        ['discardPlan', () => K.discardPlan(null)],
        ['readHypoTrial', () => K.readHypoTrial(null)],
        ['hasForbiddenKey', () => K.hasForbiddenKey(null)]
    ]) {
        let threw = null;
        try { fn(); } catch (e) { threw = e; }
        assert.equal(threw, null, '★ 空件不得抛：' + nm);
    }
    assert.equal(K.normalizeLane('zz', {}).lane, null, '认不出的栏 id 必须拒（不静默改名）');
});

/* ══════════ C ── 试写区读写（契约件真跑 + 宿主源码形态） ══════════
 * 【为什么 C/D 组不做「真调宿主」】`index.js` 在无头环境装载即 `window is not defined`
 *   （它的 `applyCreationdeskAction` 活在 `init()` 闭包里，依赖酒馆上下文）。
 *   全仓既有套件（含 v4.45.0 的 D 组）在宿主面一律走**源码形态判定**，
 *   在契约件面走**真跑** —— 本组沿用该口径，并在档头写明，避免「看起来跑了宿主」。 */

test('C1 试写区落在**本机键**上：run 写本机键、写后回读、键名带会话前缀族', () => {
    assert.equal(K.HY_KEYS.trial, 'cw_hy_trial', '★ 本机键名必须带会话前缀族（否则落全局 ⇒ 换角色串味）');
    assert.equal(REAL_STORAGE._isChatData(K.HY_KEYS.trial), true, '本机键必须判 chat');
    /* run 分支：写本机键 + 写后回读（读不回不算成功）。 */
    const iRun = hostHyCode.indexOf("sub === 'run'");
    const blk = hostHyCode.slice(iRun, iRun + 3000);
    assert.ok(blk.indexOf('writeTrial(') >= 0, 'run 必须真写本机键');
    assert.ok(blk.indexOf('if (!writeTrial(') >= 0, '★ 写不进去必须如实报（不许当作试写跑过了）');
    assert.ok(blk.indexOf('hypo-write-failed') >= 0, '写失败必须有独立归因词');
    assert.ok(hostHyCode.indexOf('storage.get(HY_KEYS.trial') >= 0, '读必须走同一个键常量（不写第二份）');
    /* 落盘形状：带 trial 与时间戳（可判「这份预演是什么时候的」）。 */
    assert.ok(blk.indexOf('trial: {') >= 0 && blk.indexOf('at: Date.now()') >= 0,
        '落盘必须带 trial 与时间戳');
});

test('C2 ★ 拒收也留住两栏：换了走向就能接着写（契约件层真跑 + 宿主层源码形态）', () => {
    /* 契约件层：拒收后 trial 里两栏文本仍在（这是「留着」的机制根据）。 */
    const n = K.normalizeTrial({ lanes: LANES() });
    assert.equal(n.ok, false, '缺基线必须拒');
    assert.equal(n.trial.lanes.a.text, 'A 文本', '★ 拒收后两栏文本必须仍在（换个走向接着写）');
    assert.equal(n.trial.lanes.b.text, 'B 文本', '★ 两栏都在');
    /* 宿主层：拒收分支里必须真把这两栏写回本机键（否则「留着」只停在契约件）。 */
    const i = hostHyCode.indexOf('if (!norm.ok) {');
    assert.ok(i > 0, '拒收分支必须在场');
    const blk = hostHyCode.slice(i, i + 800);
    assert.ok(blk.indexOf('writeTrial(') >= 0, '★ 拒收也要写回本机键（不然用户写过的两栏就没了）');
    assert.ok(blk.indexOf('lanes: norm.trial.lanes') >= 0, '写回的必须是契约件归一后的两栏');
    assert.ok(blk.indexOf("kind: 'hypo-' + norm.why") >= 0, '拒收必须带归因词（不许只说「失败了」）');
});

test('C3 坏存储 / 空件一律降级不抛，且**写不进不许当成功**', () => {
    /* 契约件面：空件与畸形输入真跑不抛（B8 已逐个判），此处判 App 面。 */
    globalThis.window = { VirtualPhone: {} };
    const app = new APP.CreationdeskApp(null, {
        get: () => { throw new Error('x'); },
        set: () => { throw new Error('x'); },
        remove: () => { throw new Error('x'); }
    });
    assert.doesNotThrow(() => {
        assert.equal(app.hyWrittenOf('a'), '', '读不出必须给空串（不许抛）');
        assert.ok(app.hyLine().length > 0, '读数必须给得出来（不许静默空）');
        assert.equal(app.hyWrittenOf('zz'), '', '认不出的栏 id 必须给空串（不许静默当 a）');
        assert.equal(app.hyKindOf('zz'), '', '认不出的栏 id 必须给空串');
    });
    /* 宿主面：writeTrial 的 catch 必须返回 false（不许把异常吞成成功）。 */
    assert.ok(hostHyCode.indexOf('} catch (_e) { return false; }') >= 0,
        '★ 写失败必须返回 false（吞成 true 就是「写失败了还说试写跑过了」）');
    clearWin();
});

/* ══════════ D ── 宿主落笔（源码形态，与 v4.45.0 同规） ══════════ */
test('D1 宿主四支在场，且白名单只追加（不动首项 plan）', () => {
    assert.ok(hostCode.indexOf("if (action === 'hypo')") >= 0, '宿主必须有 hypo 动作分支（修前零消费）');
    assert.ok(/CW_ACTION_KEYS = \['plan'[^\]]*'hypo'\]/.test(hostSrc), "hypo 必须在动作白名单末位（只追加）");
    assert.ok(/CW_ACTION_KEYS = \['plan'/.test(hostSrc), '白名单首项必须仍是 plan（v4.01.0 判据锁着）');
    for (const sub of ["sub === 'run'", "sub === 'keep'", "sub === 'adopt'", "sub === 'discard'"]) {
        assert.ok(hostHyCode.indexOf(sub) >= 0, '缺子命令分支：' + sub);
    }
    assert.ok(hostHyCode.indexOf('hyNormalize(') >= 0, 'run 必须走契约件归一（不自己判一份）');
    assert.ok(hostHyCode.indexOf('hyAdoptGate(') >= 0, 'adopt 必须走契约件闸（不自己判一份）');
    assert.ok(hostHyCode.indexOf('hyDiscardPlan(') >= 0, 'discard 必须走契约件计划（范围由它给）');
    assert.ok(hostHyCode.indexOf('hyLaneLine(') >= 0, '逐栏读数必须走契约件（不自己拼一句）');
    assert.ok(hostHyCode.indexOf('hyTrialLine(') >= 0, '面读数必须走契约件（不自己拼一句）');
});

test('D2 ★ 验收②：试写前后正史事实不变（生成通道不隐式登记假设事实）', () => {
    /* 试写分支里不得出现任何「写剧情事实」的出口。 */
    for (const bad of ['chat.push', 'setChatMessages', 'updateMessage', 'saveChat', 'deleteMessage',
        'addMoment', 'publishUserPost', 'createNovel', 'generateContent', 'generateQuietPrompt',
        'fetch(', 'XMLHttpRequest', 'WebSocket']) {
        assert.equal(hostHyCode.indexOf(bad), -1,
            '★ 试写分支不得出现 ' + bad + '（预演不是既成结局：正史零写、不生成、不联网）');
    }
    /* 落笔只许落两处：本机键 + 既有草稿本。 */
    assert.ok(hostHyCode.indexOf('HY_KEYS.trial') >= 0, '本机键必须走契约件常量');
    assert.ok(hostHyCode.indexOf('cwWriteDrafts(') >= 0, '保留为草稿必须走既有草稿写口（不另写一份）');
    /* adopt 明确报 canonWrites: 0，且不顺手写别的。 */
    const i = hostHyCode.indexOf("sub === 'adopt'");
    const blk = hostHyCode.slice(i, i + 1200);
    assert.ok(blk.indexOf('canonWrites: 0') >= 0, '★ 采纳必须如实报「本层零写正史」');
    assert.equal(blk.indexOf('cwWriteDrafts'), -1, '★ 采纳不得顺手写草稿本（采纳是转交，不是落笔）');
    assert.equal(blk.indexOf('cwWritePublished'), -1, '★ 采纳不得顺手写发布台账');
    /* discard 也必须零写正史。 */
    const iD = hostHyCode.indexOf("sub === 'discard'");
    assert.ok(hostHyCode.slice(iD, iD + 700).indexOf('canonWrites: 0') >= 0, '★ 丢弃必须如实报零写正史');
});

test('D3 保留为草稿：落既有草稿本、来源标识正确、同一份选定不重复落', () => {
    const i = hostHyCode.indexOf("sub === 'keep'");
    const blk = hostHyCode.slice(i, i + 2600);
    assert.ok(blk.indexOf('normalizeDraftBook(') >= 0, '必须读既有草稿本（不另建库）');
    assert.ok(blk.indexOf('upsertDraft(') >= 0, '必须走既有 upsert（同键后到覆盖）');
    assert.ok(blk.indexOf('cwWriteDrafts(') >= 0, '必须走既有写口');
    assert.ok(blk.indexOf('source: HY_DRAFT_SOURCE') >= 0, '来源标识必须走契约件常量（预演不是 App 内容）');
    /* 幂等键 = 栏 + 基线 + 文本指纹。 */
    assert.ok(blk.indexOf("'hy-' + picked + '-'") >= 0, '幂等键必须带栏 id');
    assert.ok(blk.indexOf('trial.baseline && trial.baseline.at') >= 0, '幂等键必须带基线时点');
    assert.ok(blk.indexOf('exists') >= 0 && blk.indexOf('hypo-keep-replayed') >= 0,
        '★ 同一份选定第二次必须报 replayed（不重复插）');
    /* 前置条件：那一栏必须真有试写文本。 */
    assert.ok(blk.indexOf('HY_LANE_STATES.WRITTEN') >= 0, '★ 必须判「那一栏真有试写文本」才收');
    assert.ok(blk.indexOf('hypo-keep-not-written') >= 0, '没写必须拒并给独立归因词');
    /* 写失败不许当成功。 */
    assert.ok(blk.indexOf('if (!w.ok)') >= 0, '★ 草稿本写失败必须如实报（不许当作已保留）');
});

test('D4 采纳是**转交**不是落笔：只判闸、只交回选中栏、零写正史', () => {
    const i = hostHyCode.indexOf("sub === 'adopt'");
    const blk = hostHyCode.slice(i, i + 1200);
    assert.ok(blk.indexOf('hyAdoptGate(') >= 0, '必须走契约件闸');
    assert.ok(blk.indexOf('hasAdoptFace') >= 0, '闸必须真看上游接续面在不在');
    assert.ok(blk.indexOf('picked:') >= 0, '必须把选中栏交回调用方');
    assert.ok(blk.indexOf('why: gate.why') >= 0, '必须把归因如实交回（三因分形）');
    /* 契约件层真跑：三因各不同形。 */
    const n = K.normalizeTrial({ baseline: 20, lanes: LANES() });
    const g1 = K.adoptGate({ lanes: {} }, { hasAdoptFace: true });
    const g2 = K.adoptGate(n.trial, { hasAdoptFace: true });
    const g3 = K.adoptGate({ lanes: n.trial.lanes, picked: 'a' }, { hasAdoptFace: false });
    assert.equal(new Set([g1.why, g2.why, g3.why]).size, 3, '★ 三因必须互不同形');
    assert.equal(g3.why, 'no-upstream', '★ 上游缺席必须单独归因（不是「没有可采纳的内容」）');
});

test('D5 ★ 验收④：丢弃清临时选择且如实报清掉几栏，范围只在本机', () => {
    const i = hostHyCode.indexOf("sub === 'discard'");
    const blk = hostHyCode.slice(i, i + 700);
    assert.ok(blk.indexOf('hyDiscardPlan(') >= 0, '范围必须由契约件给（不自己数）');
    assert.ok(blk.indexOf('writeTrial({ trial: null') >= 0, '临时选择必须真清');
    assert.ok(blk.indexOf('clearedTexts: dp.clearedTexts') >= 0, '★ 必须如实报清掉几栏');
    assert.ok(blk.indexOf('clearedChars: dp.clearedChars') >= 0, '必须如实报清掉多少字');
    assert.equal(blk.indexOf('cwWriteDrafts'), -1, '★ 丢弃不得动草稿本（范围：只清本次预演）');
    /* 契约件层真跑：范围与零写。 */
    const n = K.normalizeTrial({ baseline: 20, lanes: LANES() });
    const dp = K.discardPlan(n.trial);
    assert.equal(dp.canonWrites, 0, '丢弃恒零写正史');
    assert.equal(dp.clearedTexts, 2, '两栏有文本必须报 2');
});

test('D6 认不出的子命令必须拒并列出可用子命令（不静默当成功）', () => {
    assert.ok(hostHyCode.indexOf('hypo-bad-sub') >= 0, '认不出的子命令必须拒');
    const i = hostHyCode.indexOf('hypo-bad-sub');
    const blk = hostHyCode.slice(i - 200, i + 200);
    assert.ok(blk.indexOf('ok: false') >= 0, '必须报失败（不许静默当成功）');
    for (const sub of ['run', 'keep', 'adopt', 'discard']) {
        assert.ok(blk.indexOf(sub) >= 0, '读数必须列出可用子命令：' + sub);
    }
});

test('D7 读数如实分列：试写 ≠ 已采纳 ≠ 已落正史', () => {
    assert.ok(hostCode.indexOf('hypoTrial: (function () {') >= 0, 'refreshCreationdesk 读数必须补 hypoTrial 一格');
    assert.ok(hostHyCode.indexOf('probe') >= 0 || hostCode.indexOf('hyProbe(') >= 0, '读数必须带上游探测相');
    assert.ok(hostCode.indexOf('selfCheck: hySelfCheckOf()') >= 0, '读数必须带契约件自检（真跑）');
    assert.ok(kernelSrc.indexOf('预演') >= 0, '读数文案必须点明「预演」');
    assert.ok(kernelCode.indexOf('预演**不是既成结局**') >= 0 || kernelCode.indexOf('预演') >= 0,
        '逐栏 / 面读数必须点明「预演不是既成结局」');
    /* 面态 EMPTY 与 READY 必须分列（试写 ≠ 没试写）。 */
    assert.ok(hostHyCode.indexOf('HY_STATES.READY') >= 0 && hostHyCode.indexOf('HY_STATES.EMPTY') >= 0,
        '面态必须分列「有试写」与「还没试写」');
});

/* ══════════ E ── 接线 ══════════ */
test('E1 视图接线：元素在场、事件真投递、读数全部来自 App 出口', () => {
    for (const el of ['data-cw-hy-baseline', 'data-cw-hy-kind', 'data-cw-hy-lane', 'data-cw-hy-assume',
        'data-cw-hy-written', 'data-cw-hy-pick', 'data-cw-hy-act']) {
        assert.ok(viewCode.indexOf(el) >= 0, '视图缺元素：' + el);
    }
    for (const ev of ["querySelectorAll('[data-cw-hy-kind]')", "querySelectorAll('[data-cw-hy-assume]')",
        "querySelectorAll('[data-cw-hy-written]')", "querySelector('[data-cw-hy-baseline]')",
        "querySelectorAll('[data-cw-hy-pick]')", "querySelectorAll('[data-cw-hy-act]')"]) {
        assert.ok(viewCode.indexOf(ev) >= 0, '缺事件落点：' + ev);
    }
    assert.ok(viewCode.indexOf('hySetAssumeKind(') >= 0, '种类按钮必须真投递');
    assert.ok(viewCode.indexOf('hySetWritten(') >= 0, '试写输入必须真投递');
    assert.ok(viewCode.indexOf('hySetBaseline(') >= 0, '基线必须真投递');
    assert.ok(viewCode.indexOf('hyAct(sub)') >= 0, '动作必须真投递到 App 入口');
    /* 三种动作按钮都在场，且采纳按钮只在出口说「就绪」时才画。 */
    for (const sub of ['run', 'keep', 'discard']) {
        assert.ok(viewCode.indexOf('data-cw-hy-act="' + sub + '"') >= 0, '缺动作按钮：' + sub);
    }
    assert.ok(viewCode.indexOf('data-cw-hy-act="adopt"') >= 0, '采纳按钮必须在场（受出口门控）');
    assert.ok(viewCode.indexOf('采纳按钮先不画') >= 0, '不可采纳时必须如实说明（不许静默无按钮）');
    /* 丢弃前必须显式确认，且文案说清范围。 */
    const i = viewCode.indexOf("if (sub === 'discard'");
    assert.ok(i > 0, '丢弃必须有显式确认');
    assert.ok(viewCode.slice(i, i + 400).indexOf('正史一个字节都不会动') >= 0,
        '★ 确认文案必须说清范围（丢弃只清本机临时选择）');
});

test('E2 App 出口齐备：读数 / 交互 / 转交 / 判定，且种类与决定清单来自契约件', () => {
    const app = mkApp(mkStorage());
    for (const fn of ['hyFace', 'hyLine', 'hyLanes', 'hyCompare', 'hyCompareLabel', 'hyComparableState',
        'hyWrittenOf', 'hyKindOf', 'hyAdoptReady', 'hySetBaseline', 'hySetAssumeKind', 'hySetAssumeText',
        'hySetWritten', 'hyPick', 'hyAssumeIds', 'hyAssumeLabel', 'hyDecisionIds', 'hyDecisionLabel',
        'hyLaneStateLabel', 'hyAct']) {
        assert.equal(typeof app[fn], 'function', 'App 缺出口 ' + fn);
    }
    assert.deepEqual(app.hyAssumeIds().sort(), Object.keys(K.HY_ASSUME_LABEL).sort(),
        '假设种类清单必须与契约件同源');
    assert.deepEqual(app.hyDecisionIds().sort(), K.HY_DECISIONS.slice().sort(),
        '决定清单必须与契约件同源');
    /* 采纳按钮的判据：三条件（同基线 + 选中 + 那一栏真有文本）。 */
    assert.equal(app.hyAdoptReady(), false, '空现场不得亮采纳按钮');
    app.hySetBaseline('20');
    app.hySetAssumeKind('a', 'accept');
    app.hySetAssumeText('a', '她来');
    app.hySetWritten('a', 'A 文本');
    app.hySetAssumeKind('b', 'reject');
    app.hySetAssumeText('b', '她不来');
    app.hyPick('a');
    assert.equal(app.hyAdoptReady(), true, '两栏齐备 + 同基线 + 选中 ⇒ 必须可采纳');
    app.hySetBaseline('');
    assert.equal(app.hyAdoptReady(), false,
        '★ 基线一清空（比不了）必须收回采纳按钮 —— 本层只有**整块基线**（两栏共用），'
        + '所以「两栏基线不同」这一格只能由契约件在逐栏基线有差异时给出（B3 已判）。');
    clearWin();
});

test('E3 样式双侧投递：源样式与 phone.css 打包侧逐类同投', () => {
    for (const cls of ['.cwb-hy', '.cwb-hy-line', '.cwb-hy-lane', '.cwb-hy-lane-on', '.cwb-hy-head',
        '.cwb-hy-name', '.cwb-hy-state', '.cwb-hy-row', '.cwb-hy-cmp', '.cwb-btn-on']) {
        assert.ok(appCssSrc.indexOf(cls) >= 0, '源样式缺 ' + cls);
        assert.ok(bundleCssSrc.indexOf(cls) >= 0,
            '★ phone.css 打包侧缺 ' + cls + '（只写一侧等于打包环境里裸奔，且不报错）');
    }
    /* 逐栏三态各色（三态处置相反，屏上也不许长成一样）。 */
    for (const st of ['pending', 'written', 'refused']) {
        assert.ok(appCssSrc.indexOf('.cwb-hy-st-' + st) >= 0, '缺逐栏态配色 ' + st);
        assert.ok(bundleCssSrc.indexOf('.cwb-hy-st-' + st) >= 0, 'phone.css 缺逐栏态配色 ' + st);
    }
    /* 本版段必须两侧同源（回灌脚本的判据面）。
     *   ★ 段边界必须**按下一个 App 段头截断**，不能「段头 → 文件尾」：
     *     creationdesk 段在 phone.css 里不是最后一节（其后还接着 workflow 等段），
     *     取到文件尾会把后面那些段并进来 —— 首版就是这么假红的。 */
    const seg = (src) => {
        const i = src.indexOf('[v4.47.0 · R5-X7]');
        assert.ok(i >= 0, '缺本版段头');
        const rest = src.slice(i);
        const j = rest.indexOf('\n/* \u2550');
        return (j < 0 ? rest : rest.slice(0, j)).trim();
    };
    assert.equal(seg(bundleCssSrc), seg(appCssSrc),
        '★ phone.css 的本版段必须与 apps/creationdesk/creationdesk.css 逐字同源');
    assert.equal(countOf(bundleCssSrc, '.cwb-btn-on {'), 1, 'phone.css 里该块只该有一份');
});

test('E4 不做面可判：不联网、不生成、不评分、不后台续写、不建第二套生成 API', () => {
    const all = stripComments(kernelSrc + appSrc + viewSrc + hostHyCode);
    for (const bad of ['fetch(', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'postMessage',
        'https://', 'http://']) {
        assert.equal(all.indexOf(bad), -1, '★ 试写面不得出现 ' + bad + '（不联网、不建消息总线）');
    }
    /* 不自动多模型竞赛：禁用键表在场且真跑（B7 已判）；这里判「本版没有第二套生成 API」。 */
    assert.equal(all.indexOf('generateContent'), -1, '不得自建第二套生成 API');
    assert.equal(all.indexOf('generateQuietPrompt'), -1, '不得直接调宿主生成（生成归既有通道）');
    assert.ok(kernelSrc.indexOf('hasForbiddenKey') >= 0, '禁用键扫描必须在场（不排序/不评分/不推荐）');
    /* 不后台无限续写：试写文本只能由用户给（没有定时器 / 没有循环续写）。 */
    for (const bad of ['setInterval', 'requestAnimationFrame']) {
        assert.equal(stripComments(appSrc).indexOf(bad), -1, '不得后台续写：' + bad);
    }
});

/* ══════════ F ── 负控制 + 版本锚 ══════════ */
const temps = [];
function makeMirror() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rp_v4470_'));
    temps.push(dir);
    copyTreeSafe(path.join(ROOT, 'config'), path.join(dir, 'config'));
    copyTreeSafe(path.join(ROOT, 'apps', 'creationdesk'), path.join(dir, 'apps', 'creationdesk'));
    return dir;
}
process.on('exit', () => {
    for (const d of temps) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (_e) { /* 忽略 */ } }
});
function breakCopy(rel, anchor, replacement) {
    const dir = makeMirror();
    const src = read(rel);
    const hits = src.split(anchor).length - 1;
    assert.equal(hits, 1, '破坏锚点必须恰中 1 次（实测 ' + hits + ' 次）：' + anchor.slice(0, 70));
    fs.writeFileSync(path.join(dir, rel), src.split(anchor).join(replacement));
    return dir;
}
const loadAt = async (dir, rel, tag) =>
    await import(pathToFileURL(path.join(dir, rel)).href + '?' + tag + '=' + Date.now());
const expectRed = (fn, tag) => {
    let problems = null;
    try { problems = fn(); } catch (e) { problems = ['抛了:' + String((e && e.message) || e)]; }
    assert.ok(problems.length > 0, tag + '：破坏副本上同款判据必须转红（实测全绿 ⇒ 判据空转）');
};

test('F0 ★★★ 阳性对照：未破坏时下列各条判据必须全为真（否则 F 组是假绿）', () => {
    const n = K.normalizeTrial({ baseline: 20, lanes: LANES() });
    assert.equal(n.ok, true, '原版：两栏不同假设 + 同基线必须就绪');
    assert.equal(K.compareLanes(n.trial.lanes.a, n.trial.lanes.b).comparable, C.SAME, '原版：同基线可比');
    assert.equal(K.HY_KEYS.trial, 'cw_hy_trial', '原版：本机键必须带会话前缀族');
    assert.deepEqual(K.hySelfCheck().problems, [], '原版：自检全绿');
    assert.equal(REAL_STORAGE._isChatData(K.HY_KEYS.trial), true, '原版：本机键判 chat');
});

test('F1 ★★★ 破坏「缺基线优先」⇒ 同款判据必转红（缺基线被读成「没写假设」）', async () => {
    const dir = breakCopy(KERNEL_REL,
        '    if (!bl.ok) why = bl.why || ' + "'no-baseline';",
        '    if (false) why = bl.why || ' + "'no-baseline';");
    const k2 = await loadAt(dir, KERNEL_REL, 'f1');
    const n = k2.normalizeTrial({ lanes: { a: {}, b: {} } });
    assert.notEqual(n.why, 'no-baseline', '破坏副本：同款判据必转红（缺基线不再优先）');
    assert.equal(n.why, 'no-assume', '破坏副本：缺基线掉进了「没写假设」（这就是那条错读数）');
});

test('F2 ★★★ 破坏「两栏同一假设 ⇒ 拒」⇒ 同款判据必转红（并列没有意义的两栏被放行）', async () => {
    const dir = breakCopy(KERNEL_REL,
        "    else if (ka && kb && ka === kb) why = 'same-assume';",
        "    else if (false) why = 'same-assume';");
    const k2 = await loadAt(dir, KERNEL_REL, 'f2');
    const n = k2.normalizeTrial({
        baseline: 20,
        lanes: {
            a: { assume: { kind: 'accept', text: '她来' }, text: 'A' },
            b: { assume: { kind: 'accept', text: '她来' }, text: 'B' }
        }
    });
    assert.equal(n.ok, true, '破坏副本：同款判据必转红（两栏同一假设被放行了）');
});

test('F3 ★★★ 破坏「mixedWithBaseline 标记」⇒ 同款判据必转红（基线差被当成假设差）', async () => {
    const dir = breakCopy(KERNEL_REL,
        '    const mixed = (comparable !== HY_COMPARABLE.SAME);',
        '    const mixed = false;');
    const k2 = await loadAt(dir, KERNEL_REL, 'f3');
    const a = k2.normalizeLane('a', { assume: { kind: 'accept', text: '她来' }, baseline: 20, text: 'A' }).lane;
    const b = k2.normalizeLane('b', { assume: { kind: 'reject', text: '她不来' }, baseline: 30, text: 'B' }).lane;
    const c2 = k2.compareLanes(a, b);
    assert.equal(c2.changed.every((r) => r.mixedWithBaseline === true), false,
        '破坏副本：同款判据必转红（差异行不再标「混着基线差」）');
});

test('F4 ★★★ 破坏「上游缺席报 no-upstream」⇒ 同款判据必转红（报成没有可采纳的内容）', async () => {
    const dir = breakCopy(KERNEL_REL,
        "        return { ok: false, why: 'no-upstream', hint: HY_REASONS['no-upstream'], picked: picked };",
        "        return { ok: false, why: 'not-written', hint: HY_REASONS['not-written'], picked: picked };");
    const k2 = await loadAt(dir, KERNEL_REL, 'f4');
    const g = k2.adoptGate({ lanes: { a: { state: 'written' }, b: { state: 'written' } }, picked: 'a' },
        { hasAdoptFace: false });
    assert.notEqual(g.why, 'no-upstream', '破坏副本：同款判据必转红（上游缺席不再单独归因）');
    assert.equal(g.why, 'not-written', '破坏副本：报成了「没有可采纳的内容」（两者处置相反）');
});

test('F5 ★★★ 破坏「本机键带会话前缀族」⇒ 同款判据必转红（换角色串味）', async () => {
    const dir = breakCopy(KERNEL_REL, "    trial: 'cw_hy_trial'", "    trial: 'hy_trial'");
    const k2 = await loadAt(dir, KERNEL_REL, 'f5');
    assert.equal(REAL_STORAGE._isChatData(k2.HY_KEYS.trial), false,
        '★ 破坏副本：同款判据必转红（本机键不再判 chat ⇒ 会落全局 extensionSettings）');
});

test('F6 ★★★ 破坏「采纳按钮判据走出口」⇒ 同款判据必转红（视图拿文案子串猜）', async () => {
    const dir = breakCopy(VIEW_REL,
        '        if (vm.hyAdoptReady === true) {',
        "        if (vm.hyPicked && (vm.hyCompareLabel || '').indexOf('同基线') >= 0) {");
    const v2 = stripComments(fs.readFileSync(path.join(dir, VIEW_REL), 'utf8'));
    assert.notEqual(v2.indexOf("indexOf('同基线')"), -1,
        '破坏副本：同款判据必转红（视图又回去拿文案子串猜了）');
});

test('F7 版本锚：五源同源 + 当版条目在场 + 迭代段条目数达标', () => {
    const pkg = JSON.parse(read('package.json'));
    const manifest = JSON.parse(read('manifest.json'));
    const log = JSON.parse(read('update-log.json'));
    const idxVer = (read(HOST_REL).match(/ST_PHONE_VERSION = '([^']+)'/) || [])[1];
    const ledger = JSON.parse(read('tests/audit/status-ledger.json'));
    const vers = [pkg.version, manifest.version, log.latest, idxVer, ledger.version];
    assert.equal(new Set(vers).size, 1, '五源版本必须一致：' + JSON.stringify(vers));
    assert.equal(log.head, log.latest, 'update-log 的 head 必须跟上 latest');
    assert.ok(Object.prototype.hasOwnProperty.call(log.versions, log.latest), '当版条目必须在 versions 里');
    /* 当版条目必须点名 R5-X7（防「抬了版却没落本版内容」）。 */
    const entry = JSON.stringify(log.versions[log.latest]);
    assert.ok(entry.indexOf('R5-X7') >= 0, '★ 当版条目必须点名 R5-X7');
    /* 迭代段在场且条目数达标。 */
    const iter = read('tools/iter206_seg.md');
    assert.ok(countOf(iter, '- 【') >= 8, '迭代段条目数不足（须 ≥ 8）');
});

test('F8 ★ 历史套件的版本锚不被抬版连带转红（沿用 v4.46.0 接管口径）', () => {
    /* 负向检查必须用**去字符串**版本：被检查的套件里含同款判据自身的锚点字符串。
     * ★ 本版自己抓到的一处判据缺陷（读码可复算，不是推演）：`stripStrings` 不识别
     *   **正则字面量**，一旦被检查文件里有含引号的正则（如 `/['"]/`），状态机会错位、
     *   后续字符串清不掉 —— 于是「不得含 X」这条负向判据会命中**判据自己的锚点字符串**。
     *   修法不是把状态机写得更聪明（正则 vs 除号在 JS 里本就不可判），
     *   而是**把自指对象排除出射程**：v4460 是「上一版」，它自己就写着这条负向判据，
     *   扫它必然自指；对当版/上一版只判**正向不变量**（当版条目由 latest 给）。 */
    const own = { v4360: '4.36.0', v4400: '4.40.0' };
    for (const [suite, ver] of Object.entries(own)) {
        const code = stripStrings(stripComments(read('tests/system-' + suite + '.test.mjs')));
        const dynBound = code.indexOf('const ver = pkg.version') >= 0;
        if (dynBound) {
            assert.ok(code.indexOf('log.versions[ver]') < 0 && code.indexOf('ul.versions[ver]') < 0,
                suite + ' 不得拿 pkg.version 去索引当版条目（抬版连带转红的根因）');
        }
        const raw = stripComments(read('tests/system-' + suite + '.test.mjs'));
        assert.ok(raw.indexOf("versions['" + ver + "']") >= 0 || raw.indexOf("ver = '" + ver + "'") >= 0,
            suite + ' 必须锁自己那一版：' + ver);
        assert.ok(raw.indexOf('pkg.version') >= 0, suite + ' 仍必须断言五源一致（跟随当前版）');
    }
    /* v4450 / v4460（近两版）走的是**另一条正确接管**：一致性用 pkg.version，
     *   当版条目用 log.latest（不锁字面量）⇒ 抬版后依然成立，不得被判红，
     *   故不能塞进上面那个「必须锁自己那一版」的循环里。 */
    for (const suite of ['v4450', 'v4460']) {
        const raw = stripComments(read('tests/system-' + suite + '.test.mjs'));
        assert.ok(raw.indexOf('pkg.version') >= 0, suite + ' 一致性必须跟随当前版');
        assert.ok(raw.indexOf('log.latest') >= 0, suite + ' 当版条目必须由 latest 给（跟随当前版）');
    }
    /* 接管口径的**负向判据本身**必须在场（防被删掉后静默失效）——这条只查 v4460：
     *   它是写这条负向判据的那一版；v4450 走正向接管，不含此判据。 */
    const v4460 = stripComments(read('tests/system-v4460.test.mjs'));
    assert.ok(v4460.indexOf('不得拿 pkg.version 去索引当版条目') >= 0,
        'v4460 的负向判据必须在场（否则历史套件的接管口径无人看守）');
});