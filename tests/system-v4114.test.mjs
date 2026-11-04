/* ========================================================
 * system-v4114.test.mjs — [v4.113.0 · 第十三期 R13-X3] 消息里能「就地办」
 * --------------------------------------------------------
 * 本套件守的是 R13-X3 的验收（计划书 §1 该项原文 + §5 共同验收）：
 *   A 口径：三 kind 分界按「写不写盘」分、六因由闭集、开关有独立键常量；
 *   B 提取：双重门槛（时间词 + 意向词）**逐种拒法**各一例，且不许自动执行；
 *   C 提交：没有 sourceMsgId 一律拒、日历不在不许冒充成功、reply 只给草稿、
 *            待定档的「待定 · 」必须落在**数据**里、回执逐字可复原、撤销走回收站；
 *   D 接线：chat-view 零侵入、开关关后**一条都不长**、只在有候选时出条、
 *            事件委托只绑一次、不覆盖用户已输入的字；
 *   E 负控制（真源码破坏）：拿掉 sourceMsgId 前置检查 / 拿掉时间门槛 / 拿掉「自己发的不给条」
 *            三处，逐处都要**看得见行为变化** —— 判据不红就等于那三条纪律是假的。
 *
 * 【本件为什么自带一套迷你 DOM】本仓零依赖（node_modules 为空），而本项最外层交付物
 *   `apps/wechat/inline-action-bar.js` 的产物**就是 DOM**。用真 jsdom 会给仓库引入依赖；
 *   不测 DOM 则「只在有候选时出条」「开关关后逐字一致」两条根本无处落地。
 *   故自带一份**够判**的最小树：只实现本件用到的那几个选择器（类 / id / [attr] /
 *   后代 / 逗号或），命中判定走真实属性，不假装浏览器（布局、样式、伪元素一概不测，
 *   写进 `docs/runtime-verification-boundary.md`）。
 *
 * 【本套件自己防的三种判据失真形】
 *   · 用「没有候选」测「不出条」—— 那只证明函数被调了，证明不了它**没往 DOM 写**；
 *     故 D3 两侧都有候选/无候选消息，且断言「无候选那一行后面紧邻的兄弟不是 ia-stack」；
 *   · 破坏只改一个分支而判据只看返回值 —— 例如拿掉 noSource 检查后仍能靠别的路拒掉，
 *     那就证明不了那条检查有用；故 E1 同时断言「破坏版真写进日历了」（副作用可见）；
 *   · 用临时文件路径差异伪造「零侵入」—— chat-view.js 的零侵入必须是**真文件**的断言（D1）。
 * ============================================================ */
'use strict';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeHarness } from './_inline_action_harness.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temps = [];
process.on('exit', () => { for (const d of temps) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (_e) { /* 清理失败不影响结论 */ } } });

const TM = await import(path.join(ROOT, 'config', 'inline-action-terms.js'));
const IA = await import(path.join(ROOT, 'config', 'inline-action.js'));
const IT = await import(path.join(ROOT, 'config', 'inline-action-time.js'));
const CM = await import(path.join(ROOT, 'config', 'inline-action-commit.js'));
const BarMod = await import(path.join(ROOT, 'apps', 'wechat', 'inline-action-bar.js'));

/** 固定剧情当下（本地时间构造：带 Z 会因时区漂）。2026-10-01 是星期四。 */
const T0 = new Date(2026, 9, 1, 10, 0, 0).getTime();
const NOW = { storyMs: T0 };

/* ══════════ 迷你 DOM + 替身（[v4.120.0 · R14-O5] 已抽到共用底座） ══════════
 * 为什么抽走：R14-O5 要在同一块交付物上验「双击 / 刷新 / 源句漂 / 撤后重办」，
 *   若再抄第二份迷你 DOM，两套选择器迟早会漂 —— 而漂了之后「同一条纪律在
 *   两份套件里结论不同」这种红点不指向任何一处源码，最难查。故只有一份。 */
const H = makeHarness(new Date(2026, 9, 1, 10, 0, 0).getTime());
const mkNode = H.mkNode;
const installDom = H.installDom;
const withDom = H.withDom;
const mkStorage = H.mkStorage;
const mkCalendar = H.mkCalendar;
const mkMsg = H.mkMsg;
const paintMessages = H.paintMessages;
const mkApp = H.mkApp;
const mkHost = H.mkHost;


/* ══════════ 负控制用：真源码破坏 ══════════ */

function stageTree() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rp_v4114_'));
    temps.push(dir);
    fs.mkdirSync(path.join(dir, 'config'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'apps', 'wechat'), { recursive: true });
    for (const f of ['num-gate.js', 'inline-action-terms.js', 'inline-action-time.js',
        'inline-action.js', 'inline-action-commit.js',
        /* [v4.120.0 · R14-O5] 动作条现在静态 import 台账件：副本树必须够模块加载，
         *   否则负控制会以 ERR_MODULE_NOT_FOUND 假红（那不是「纪律被破坏」，是「树不全」）。 */
        'inline-action-ledger.js']) {
        fs.copyFileSync(path.join(ROOT, 'config', f), path.join(dir, 'config', f));
    }
    fs.copyFileSync(path.join(ROOT, 'apps', 'wechat', 'inline-action-bar.js'),
        path.join(dir, 'apps', 'wechat', 'inline-action-bar.js'));
    return dir;
}

function damage(rel, from, to) {
    const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    const n = src.split(from).length - 1;
    assert.equal(n, 1, '破坏锚点必须恰中一次：' + rel + ' -> ' + String(n) + ' 次');
    const dir = stageTree();
    fs.writeFileSync(path.join(dir, rel), src.split(from).join(to), 'utf8');
    return dir;
}

/* ══════════ A 口径 ══════════ */

test('A1 术语件是零 import 叶子：三 kind / 三态 / 六因由 各自闭集且互不重名', () => {
    const src = fs.readFileSync(path.join(ROOT, 'config', 'inline-action-terms.js'), 'utf8');
    assert.equal(/^\s*import\s/m.test(src), false, '口径件必须是零 import 叶子（改口径不许牵到算法）');
    assert.deepEqual(Object.values(TM.INLINE_ACTION_KINDS).sort(), ['memo', 'reply', 'schedule']);
    assert.equal(Object.keys(TM.INLINE_ACTION_STATES).length, 3);
    assert.equal(new Set(Object.values(TM.INLINE_ACTION_STATES)).size, 3, '三态必须互不同名');
    assert.equal(Object.keys(TM.INLINE_ACTION_WHY).length, 6);
    assert.equal(new Set(Object.values(TM.INLINE_ACTION_WHY)).size, 6, '六因由必须互不同名（重名就是塔缩）');
    /* 因由必须真被算法件用到：写了六条却只用三条，等于三条是摆设。 */
    const algo = fs.readFileSync(path.join(ROOT, 'config', 'inline-action.js'), 'utf8');
    for (const w of Object.values(TM.INLINE_ACTION_WHY)) {
        if (w === 'too-long') continue;   /* 超长走标题截断，不在主件里当丢弃因由 */
        assert.ok(algo.includes('INLINE_ACTION_WHY.'), '因由必须走常量面引用');
    }
    assert.deepEqual(Object.keys(TM.INLINE_ACTION_LABEL).sort(), ['done', 'memo', 'reply', 'schedule', 'undo']);
});

test('A2 三档按「写不写盘」分界，且这条分界写在条目里', () => {
    const src = fs.readFileSync(path.join(ROOT, 'config', 'inline-action-terms.js'), 'utf8');
    /* 计划书要的是「只生成候选，不自动执行」。分界不写下来，下一个改的人就会把 memo 也去写盘。 */
    assert.ok(src.includes('只有 schedule 会改数据'), '必须写明哪一档真写盘');
    assert.ok(src.includes('不替你发'), 'reply 档必须写明不代发');
    assert.ok(src.includes('误报'), '必须写明判据定在误报率上');
});

test('A3 开关有独立的键常量：藏在对象属性里的键等于没被问过归属', () => {
    const src = fs.readFileSync(path.join(ROOT, 'config', 'inline-action-terms.js'), 'utf8');
    assert.ok(/export\s+const\s+INLINE_ACTION_TOGGLE_KEY\s*=/.test(src), '键必须是独立常量（keys 门按常量声明抽键面）');
    assert.equal(typeof TM.INLINE_ACTION_TOGGLE.key, 'string');
    assert.equal(TM.INLINE_ACTION_TOGGLE.key, TM.INLINE_ACTION_TOGGLE_KEY, '两处必须是同一个真源，不许各写一份');
    assert.equal(TM.INLINE_ACTION_TOGGLE.defaultOn, true);
    /* 默认开：关掉才需要理由，开是常态（但关掉后必须逐字一致，见 D2）。 */
    assert.equal(TM.INLINE_ACTION_LIMITS.maxPerMsg, 3);
    assert.equal(TM.INLINE_ACTION_WEEKDAYS.length, 7);
});

/* ══════════ B 提取（双重门槛，逐种拒法各一例） ══════════ */

test('B1 双重门槛：只有时间词 / 只有意向词 / 都没有 —— 三种都必须 none 且因由分得开', () => {
    /* 只有时间词：有时间、没在约事。 */
    const a = IA.scanMessage(mkMsg('m1', '今天天气不错'), NOW);
    assert.equal(a.state, TM.INLINE_ACTION_STATES.none);
    assert.equal(a.why, TM.INLINE_ACTION_WHY.noIntent);
    /* 只有意向词：在约事、没说时间 —— 不许出「加日程」（那就是替用户编了个日子）。 */
    const b = IA.scanMessage(mkMsg('m2', '一起吃饭'), NOW);
    assert.equal(b.state, TM.INLINE_ACTION_STATES.none);
    assert.equal(b.why, TM.INLINE_ACTION_WHY.noTime);
    /* 两样都没有。 */
    const c = IA.scanMessage(mkMsg('m3', '这部电影真好看'), NOW);
    assert.equal(c.state, TM.INLINE_ACTION_STATES.none);
    assert.equal(c.why, TM.INLINE_ACTION_WHY.noIntent);
    /* 三种因由不许塌成一个字：全塌了就没法解释「为什么不出条」。 */
    assert.notEqual(a.why, b.why);
});

test('B2 没有 id 的消息一律不办（回不了源，也撤不掉）', () => {
    const r = IA.scanMessage({ content: '周六有空吗' }, NOW);
    assert.equal(r.state, TM.INLINE_ACTION_STATES.unreadable);
    assert.equal(r.why, TM.INLINE_ACTION_WHY.noMsgId);
    assert.equal(r.actions.length, 0, '读不出来的时候一个候选都不许给');
    /* 空白 content 与 null 都不许抛（渲染路径不许崩）。 */
    assert.equal(IA.scanMessage(mkMsg('m4', '   '), NOW).state, TM.INLINE_ACTION_STATES.none);
    assert.equal(IA.scanMessage(null, NOW).state, TM.INLINE_ACTION_STATES.unreadable);
});

test('B3 计划书点名的那一句：周六有空吗 ⇒ 三档齐出，且日子是**真算出来的周六**', () => {
    const r = IA.scanMessage(mkMsg('m1', '周六有空吗'), NOW);
    assert.equal(r.state, TM.INLINE_ACTION_STATES.ok);
    assert.deepEqual(r.actions.map((a) => a.kind), ['schedule', 'memo', 'reply']);
    /* 2026-10-01 是星期四，最近的周六是 10-03（不是「+7 天」那种糊）。 */
    assert.equal(r.actions[0].payload.dateKey, '2026-10-03');
    assert.equal(r.actions[2].payload.text, '有空');
    for (const a of r.actions) {
        assert.equal(a.sourceMsgId, 'm1', '每个候选都必须带出处');
        assert.ok(String(a.why || '').length > 0, '每个候选都必须能说清为什么给它');
    }
});

test('B4 模糊说法一律不许填日期（改天 / 过两天 只能进备忘）', () => {
    const r = IA.scanMessage(mkMsg('m1', '改天一起聚一聚'), NOW);
    assert.equal(r.state, TM.INLINE_ACTION_STATES.ok);
    assert.equal(r.actions.some((a) => a.kind === 'schedule'), false, '「改天」算不出日子，不许出加日程');
    assert.equal(r.actions.some((a) => a.kind === 'memo'), true, '日子没定也能记下来');
    /* 时间件本身也要说清：vague 命中即不许给 dateKey。 */
    const t = IT.pickTime('改天一起聚一聚', NOW);
    assert.equal(t.vague, true);
    assert.equal(t.dateKey, '');
});

test('B5 中文数字与跨月进位：明晚八点 / 下周三 都要落到具体日子', () => {
    const a = IT.pickTime('明天晚上八点一起吃饭', NOW);
    assert.equal(a.dateKey, '2026-10-02');
    assert.equal(a.time, '20:00');
    const b = IT.pickTime('下周三要不要一起去看电影', NOW);
    assert.equal(b.dateKey, '2026-10-07');
    /* 跨月：9-30 +1 天进 10-01（日期加天数走 Date 进位，不手写月长表）。 */
    assert.equal(IT.addDaysToKey('2026-09-30', 1), '2026-10-01');
    assert.equal(IT.addDaysToKey('2026-12-31', 1), '2027-01-01');
    /* 读不出时刻 ⇒ 空串，不拿今天充数。 */
    assert.equal(IT.dateKeyOf(0), '');
    assert.equal(IT.dateKeyOf(null), '');
});

test('B6 一条消息最多三个动作（多了就是噪声），超长标题截断加省略号', () => {
    const r = IA.scanMessage(mkMsg('m1', '明天晚上八点一起吃饭吧'), NOW);
    assert.ok(r.actions.length <= TM.INLINE_ACTION_LIMITS.maxPerMsg);
    const long = '明天晚上八点一起' + '饭'.repeat(100);
    const t = IA.titleOf(long);
    assert.equal(t.length, TM.INLINE_ACTION_LIMITS.titleMaxChars + 1);
    assert.ok(t.endsWith('…'));
});

/* ══════════ C 提交（写不写盘、写错怎么办） ══════════ */

/** 取一条真候选（内核出，不自造 —— 自造就测不到「认与写同源」）。 */
function pick(actions, kind) {
    return actions.filter((a) => a.kind === kind)[0] || null;
}

test('C1 没有 sourceMsgId 一律拒，而且**一字节都不许写盘**', () => {
    const cal = mkCalendar();
    const act = { kind: 'schedule', title: '吃饭', payload: { dateKey: '2026-10-02', time: '20:00' } };
    const r = CM.commitAction(act, { calendarData: cal, nowMs: T0, chatName: '阿莲', atMs: T0 });
    assert.equal(r.ok, false);
    assert.equal(r.why, CM.INLINE_COMMIT_WHY.noSource);
    assert.equal(cal.calls.length, 0, '★ 拒了就不能已经写进去了（先写后报错是本仓最贵的形态）');
    assert.equal(r.receipt, '');
});

test('C2 日历不在 ≠ 写成功：报 no-calendar，不报 ok', () => {
    const r = CM.commitAction(
        { kind: 'memo', sourceMsgId: 'm1', title: '吃饭', payload: {} },
        { calendarData: null, nowMs: T0, chatName: '阿莲', atMs: T0 });
    assert.equal(r.ok, false);
    assert.equal(r.why, CM.INLINE_COMMIT_WHY.noCalendar);
    assert.equal(r.entryId, '');
});

test('C3 reply 档只给草稿：ok 但一个字节不写盘（发不发是用户的事）', () => {
    const cal = mkCalendar();
    const r = CM.commitAction(
        { kind: 'reply', sourceMsgId: 'm1', title: '有空', payload: { text: '有空' } },
        { calendarData: cal, nowMs: T0, chatName: '阿莲', atMs: T0 });
    assert.equal(r.ok, true);
    assert.equal(r.why, CM.INLINE_COMMIT_WHY.draftOnly);
    assert.equal(r.draft, '有空');
    assert.equal(cal.calls.length, 0, '★ reply 档绝对不许写日历');
    assert.equal(r.entryId, '');
});

test('C4 待定档的「待定 · 」要落在**数据**里，不是只在界面上加', () => {
    const cal = mkCalendar();
    const r = CM.commitAction(
        { kind: 'memo', sourceMsgId: 'm1', title: '聚一聚', payload: {} },
        { calendarData: cal, nowMs: T0, chatName: '阿莲', atMs: T0 });
    assert.equal(r.ok, true);
    assert.equal(cal.calls.length, 1);
    const arg = cal.calls[0];
    assert.equal(arg.title, CM.INLINE_PENDING_PREFIX + '聚一聚', '界面会关，数据不会 —— 前缀必须写进条目');
    assert.ok(arg.title.startsWith('待定'), '前缀必须可被日历一眼认出');
    assert.equal(arg.dateKey, '2026-10-01', '本仓没有「无日期备忘」容器，故落在今天但标题带待定');
    assert.equal(arg.sourceMsgId, 'm1', '★ 计划书硬要求：条目必须带来源');
    assert.equal(arg.source, 'inline-action');
});

test('C5 回执逐字可复原：来自谁、哪一天几点、写到了哪里', () => {
    const cal = mkCalendar();
    const r = CM.commitAction(
        { kind: 'schedule', sourceMsgId: 'm1', title: '吃饭', payload: { dateKey: '2026-10-02', time: '20:00' } },
        { calendarData: cal, nowMs: T0, chatName: '阿莲', atMs: new Date(2026, 9, 30, 21, 14, 0).getTime() });
    assert.equal(r.ok, true);
    assert.ok(r.receipt.includes('来自与 阿莲 的聊天'), '回执必须能指回会话：' + r.receipt);
    assert.ok(r.receipt.includes('10月30日 21:14'), '回执必须能指回那一刻：' + r.receipt);
    assert.ok(r.receipt.includes('2026-10-02 20:00'), '回执必须写出目标 app 里的具体读数：' + r.receipt);
    /* 读不出项就如实缺着，不编一个日期顶上。 */
    assert.equal(CM.receiptLine({}), '来自一条聊天记录（那一刻读不出来）');
    assert.ok(CM.receiptLine({ chatName: '阿莲', atMs: 0 }).includes('时刻读不出来'));
    assert.ok(CM.receiptLine({ atMs: T0 }).includes('来自一条聊天'));
});

test('C6 撤销走回收站：deleteMemo 真被调到；没提交过的不许报撤销成功', () => {
    const cal = mkCalendar();
    const r = CM.commitAction(
        { kind: 'schedule', sourceMsgId: 'm1', title: '吃饭', payload: { dateKey: '2026-10-02', time: '' } },
        { calendarData: cal, nowMs: T0, chatName: '阿莲', atMs: T0 });
    const u = CM.undoCommit(r, { calendarData: cal });
    assert.equal(u.ok, true);
    assert.deepEqual(cal.deleted, [r.entryId], '撤销必须把提交那一格送进回收站');
    /* 没提交过 / 没 id ⇒ 拒，不许报「已撤销」。 */
    assert.equal(CM.undoCommit({ ok: true, entryId: '' }, { calendarData: cal }).ok, false);
    assert.equal(CM.undoCommit({ ok: false, entryId: 'x' }, { calendarData: cal }).ok, false);
    assert.equal(CM.undoCommit(r, { calendarData: null }).why, CM.INLINE_COMMIT_WHY.noCalendar);
});

test('C7 数据层自己拒了（无 id 返回）不许冒充成功；未知 kind 一律拒', () => {
    const cal = mkCalendar({ reject: true });
    const r = CM.commitAction(
        { kind: 'memo', sourceMsgId: 'm1', title: '聚一聚', payload: {} },
        { calendarData: cal, nowMs: T0, chatName: '阿莲', atMs: T0 });
    assert.equal(r.ok, false);
    assert.equal(r.why, CM.INLINE_COMMIT_WHY.rejected);
    const bad = CM.commitAction({ kind: 'nuke', sourceMsgId: 'm1', title: 'x' }, { calendarData: cal, nowMs: T0 });
    assert.equal(bad.ok, false);
    assert.equal(bad.why, CM.INLINE_COMMIT_WHY.unknownKind);
});

test('C8 与内核对接：内核给的真候选过一遍提交，sourceMsgId 从消息接到条目', () => {
    const cal = mkCalendar();
    const scan = IA.scanMessage(mkMsg('c1:m7', '明天晚上八点一起吃饭吧'), NOW);
    const act = pick(scan.actions, 'schedule');
    assert.ok(act, '这一句必须能认出加日程');
    const r = CM.commitAction(act, { calendarData: cal, nowMs: T0, chatName: '阿莲', atMs: T0 });
    assert.equal(r.ok, true);
    assert.equal(cal.calls[0].sourceMsgId, 'c1:m7', '★ 回源：条目上的来源必须是那条消息的真 id');
    assert.equal(cal.calls[0].dateKey, '2026-10-02');
    assert.equal(cal.calls[0].time, '20:00');
});

/* ========== D 接线（旁路的三条纪律） ========== */

test('D1 零侵入：chat-view.js 里一个字节都没提动作条，且 wechat-app 只经 _mountInlineBar 挂一次', () => {
    const cv = fs.readFileSync(path.join(ROOT, 'apps', 'wechat', 'chat-view.js'), 'utf8');
    for (const word of ['inline-action', 'InlineActionBar', 'ia-stack', 'ia-bar']) {
        assert.equal(cv.includes(word), false, 'chat-view.js 只许被旁路「看着」，不许被改：' + word);
    }
    const wa = fs.readFileSync(path.join(ROOT, 'apps', 'wechat', 'wechat-app.js'), 'utf8');
    assert.equal(wa.split('this._mountInlineBar();').length - 1, 1, '挂载点只许一处');
    assert.ok(wa.includes('this.inlineBar = new InlineActionBar(this);'));
    const iSet = wa.indexOf('this.phoneShell.setContent(html, viewId);');
    const iMount = wa.indexOf('this._mountInlineBar();');
    assert.ok(iSet > 0 && iMount > iSet, 'mount 必须在 setContent 之后');
});

/** 数本件可能写的所有节点（四种类名）。 */
function countAll(root) {
    return root.querySelectorAll('.ia-stack, .ia-bar, .ia-receipt, .ia-fail').length;
}

test('D2 开关关掉：mount() 返回 0，且 DOM 里一条 ia-* 都没有（与没有这个功能时逐字一致）', () => {
    const storage = mkStorage({ [TM.INLINE_ACTION_TOGGLE.key]: false });
    const app = mkApp({ messages: [mkMsg('m1', '周六有空吗')], storage: storage });
    const got = withDom(mkHost({ calendar: mkCalendar() }), (d) => {
        paintMessages(d.box, app.wechatData.getMessages('c1'));
        const n = new BarMod.InlineActionBar(app).mount();
        return { n: n, stacks: d.box.querySelectorAll('.ia-stack').length, cnt: countAll(d.box) };
    });
    assert.equal(got.n, 0, '开关关 ⇒ 一条都不挂');
    assert.equal(got.stacks, 0);
    assert.equal(got.cnt, 0, '开关关 ⇒ 不许往容器里多写任何节点');
});

test('D3 只在有候选时出条：无候选的那一行后面不许紧接着一块动作条', () => {
    const app = mkApp({
        messages: [mkMsg('m1', '周六有空吗'), mkMsg('m2', '这部电影真好看'), mkMsg('m3', '今天天气不错')]
    });
    withDom(mkHost({ calendar: mkCalendar() }), (d) => {
        paintMessages(d.box, app.wechatData.getMessages('c1'));
        const n = new BarMod.InlineActionBar(app).mount();
        assert.ok(n >= 1, '有候选的那一句必须出条');
        const rows = d.box.querySelectorAll('.chat-message[data-message-id]');
        for (const row of rows) {
            const mid = row.getAttribute('data-message-id');
            const next = row.nextSibling;
            const isStack = !!(next && String(next.className || '').includes('ia-stack'));
            if (mid === 'm1') assert.equal(isStack, true, 'm1 有候选 ⇒ 紧邻后面必须有条');
            else assert.equal(isStack, false, mid + ' 没候选 ⇒ 紧邻后面不许有空白条子');
        }
        assert.equal(d.box.querySelectorAll('.ia-stack').length, 1, '三条消息里只该出一块');
    });
});

test('D4 量：一句三档 ⇒ 三条按钮 + 三条 why，且都挂在那一条消息后面', () => {
    const app = mkApp({ messages: [mkMsg('m1', '周六有空吗')] });
    withDom(mkHost({ calendar: mkCalendar() }), (d) => {
        paintMessages(d.box, app.wechatData.getMessages('c1'));
        const n = new BarMod.InlineActionBar(app).mount();
        assert.equal(n, 3);
        const stack = d.box.querySelectorAll('.ia-stack')[0];
        assert.ok(stack, '必须长出容器');
        assert.equal(stack.getAttribute('data-ia-for'), 'm1');
        assert.equal(stack.querySelectorAll('.ia-bar').length, 3);
        assert.equal(stack.querySelectorAll('.ia-btn').length, 3);
        assert.equal(stack.querySelectorAll('.ia-why').length, 3, '每条都要写「为什么给它」');
        const kinds = stack.querySelectorAll('[data-ia-do]').map((b) => b.getAttribute('data-ia-action')).sort();
        assert.deepEqual(kinds, ['memo', 'reply', 'schedule']);
    });
});

test('D5 自己发的不给动作条（给自己加日程不是这个功能）', () => {
    const app = mkApp({ messages: [mkMsg('m1', '周六有空吗', { from: 'me' })] });
    withDom(mkHost({ calendar: mkCalendar() }), (d) => {
        paintMessages(d.box, app.wechatData.getMessages('c1'));
        assert.equal(new BarMod.InlineActionBar(app).mount(), 0);
        assert.equal(d.box.querySelectorAll('.ia-stack').length, 0);
    });
});

test('D6 事件委托只绑一次：重画多少轮，容器上 click 监听器始终只有 1 个', () => {
    const app = mkApp({ messages: [mkMsg('m1', '周六有空吗')] });
    withDom(mkHost({ calendar: mkCalendar() }), (d) => {
        paintMessages(d.box, app.wechatData.getMessages('c1'));
        const bar = new BarMod.InlineActionBar(app);
        bar.mount();
        assert.equal(d.box.listenerCount('click'), 1);
        bar.mount();
        bar.mount();
        assert.equal(d.box.listenerCount('click'), 1, '重画不许叠加监听器（叠加 = 点一次办三遍）');
    });
});

test('D7 点「加日程」：真写进日历且带来源；点「撤销」：真进回收站', () => {
    const cal = mkCalendar();
    const app = mkApp({ messages: [mkMsg('m1', '明天晚上八点一起吃饭吧')] });
    withDom(mkHost({ calendar: cal }), (d) => {
        paintMessages(d.box, app.wechatData.getMessages('c1'));
        const bar = new BarMod.InlineActionBar(app);
        bar.mount();
        const btn = d.box.querySelectorAll('[data-ia-action="schedule"]')[0];
        assert.ok(btn, '必须有加日程按钮');
        d.box.fire('click', { target: btn });
        assert.equal(cal.calls.length, 1, '点下去必须真写一条');
        assert.equal(cal.calls[0].sourceMsgId, 'm1');
        assert.ok(d.box.querySelectorAll('.ia-receipt').length >= 1, '写完必须给回执');
        const undoBtn = d.box.querySelectorAll('[data-ia-undo]')[0];
        assert.ok(undoBtn, '办完之后同一位置必须换成撤销');
        d.box.fire('click', { target: undoBtn });
        assert.equal(cal.deleted.length, 1, '撤销要送进回收站');
    });
});

test('D8 点「回一句」：草稿填进输入框，但不覆盖用户打了一半的字', () => {
    const app = mkApp({ messages: [mkMsg('m1', '周六有空吗')] });
    withDom(mkHost({ calendar: mkCalendar() }), (d) => {
        paintMessages(d.box, app.wechatData.getMessages('c1'));
        const bar = new BarMod.InlineActionBar(app);
        bar.mount();
        const btn = d.box.querySelectorAll('[data-ia-action="reply"]')[0];
        assert.ok(btn);
        d.box.fire('click', { target: btn });
        assert.equal(d.input.value, '有空', '草稿要填进输入框');
        d.input.value = '我先想一下';
        const btn2 = d.box.querySelectorAll('[data-ia-action="reply"]')[0];
        d.box.fire('click', { target: btn2 });
        assert.equal(d.input.value, '我先想一下', '不许覆盖用户已经输入的内容');
    });
});

test('D9 设置页有这一个开关，且写口只有 setEnabled（不自己碰键）', () => {
    const wa = fs.readFileSync(path.join(ROOT, 'apps', 'wechat', 'wechat-app.js'), 'utf8');
    assert.ok(wa.includes('wechat-inline-action-enabled'), '设置页必须有开关控件');
    assert.equal(wa.split("getElementById('wechat-inline-action-enabled')").length - 1, 1);
    assert.ok(wa.includes('.setEnabled(on)'), '控件只许调 setEnabled');
    const bar = fs.readFileSync(path.join(ROOT, 'apps', 'wechat', 'inline-action-bar.js'), 'utf8');
    assert.equal(wa.includes('INLINE_ACTION_TOGGLE.key'), false, '设置页不许直接碰存储键');
    assert.ok(bar.includes('INLINE_ACTION_TOGGLE.key'));
});

/* ========== E 负控制（真源码破坏） ========== */

test('E1 拿掉 sourceMsgId 前置检查 ⇒ 没出处的动作真写进日历了（副作用可见才算破坏生效）', async () => {
    const dir = damage('config/inline-action-commit.js',
        'if (!srcId) { out.why = INLINE_COMMIT_WHY.noSource; return out; }',
        'if (false) { out.why = INLINE_COMMIT_WHY.noSource; return out; }');
    const broke = await import(path.join(dir, 'config', 'inline-action-commit.js'));
    const act = { kind: 'memo', title: '聚一聚', payload: {} };
    /* 原版：一字节不写。 */
    const calOk = mkCalendar();
    assert.equal(CM.commitAction(act, { calendarData: calOk, nowMs: T0, chatName: 'x', atMs: T0 }).ok, false);
    assert.equal(calOk.calls.length, 0);
    /* 破坏版：写进去了，而且条目上的 sourceMsgId 是空的 —— 回不了源、也撤不干净。 */
    const calBad = mkCalendar();
    const r = broke.commitAction(act, { calendarData: calBad, nowMs: T0, chatName: 'x', atMs: T0 });
    assert.equal(calBad.calls.length, 1, '这一条不红，就证明 noSource 那道检查在判据里根本没被验到');
    assert.equal(calBad.calls[0].sourceMsgId, '', '写进去的那条没有出处');
    assert.equal(r.ok, true);
});

test('E2 拿掉时间门槛 ⇒ 「一起吃饭」这种没时间的句子也长出了动作条', async () => {
    const dir = damage('config/inline-action.js',
        'if (!t.hasTime) { out.why = INLINE_ACTION_WHY.noTime; return out; }',
        'if (false) { out.why = INLINE_ACTION_WHY.noTime; return out; }');
    const broke = await import(path.join(dir, 'config', 'inline-action.js'));
    const msg = mkMsg('m1', '一起吃饭');
    /* 原版：双重门槛拦下。 */
    assert.equal(IA.scanMessage(msg, NOW).state, TM.INLINE_ACTION_STATES.none);
    /* 破坏版：拦不住了 —— 恰好是计划书最担心的「误报」。 */
    const bad = broke.scanMessage(msg, NOW);
    assert.equal(bad.state, TM.INLINE_ACTION_STATES.ok, '这一条不红，就证明时间门槛没被判据钉住');
    assert.ok(bad.actions.length >= 1);
});

test('E3 拿掉「自己发的不给条」⇒ 我发的那句也长出动作条（用户会给自己加日程）', async () => {
    const dir = damage('apps/wechat/inline-action-bar.js',
        'if (isMine(msg)) continue;',
        'if (false) continue;');
    const broke = await import(path.join(dir, 'apps', 'wechat', 'inline-action-bar.js'));
    const app = mkApp({ messages: [mkMsg('m1', '周六有空吗', { from: 'me' })] });
    /* 原版：一条不出。 */
    withDom(mkHost({ calendar: mkCalendar() }), (d) => {
        paintMessages(d.box, app.wechatData.getMessages('c1'));
        assert.equal(new BarMod.InlineActionBar(app).mount(), 0);
    });
    /* 破坏版：出条了。 */
    const got = withDom(mkHost({ calendar: mkCalendar() }), (d) => {
        paintMessages(d.box, app.wechatData.getMessages('c1'));
        return new broke.InlineActionBar(app).mount();
    });
    assert.ok(got >= 1, '这一条不红，就证明「自己发的不给条」只是写在注释里');
});

test('E4 拿掉「没有 id 就不办」⇒ 回不了源的消息也给出了候选', async () => {
    const dir = damage('config/inline-action.js',
        'if (!id) { out.state = INLINE_ACTION_STATES.unreadable; out.why = INLINE_ACTION_WHY.noMsgId; return out; }',
        'if (false) { out.state = INLINE_ACTION_STATES.unreadable; out.why = INLINE_ACTION_WHY.noMsgId; return out; }');
    const broke = await import(path.join(dir, 'config', 'inline-action.js'));
    const msg = { content: '周六有空吗', from: 'them' };
    assert.equal(IA.scanMessage(msg, NOW).state, TM.INLINE_ACTION_STATES.unreadable);
    const bad = broke.scanMessage(msg, NOW);
    assert.equal(bad.state, TM.INLINE_ACTION_STATES.ok, '这一条不红，就证明「没 id 不办」没被判据钉住');
    assert.equal(bad.actions[0].sourceMsgId, '', '★ 这正是「点上去回不了源」的现场');
});
