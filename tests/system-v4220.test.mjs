/* ============================================================
 * tests/system-v4220.test.mjs -- [v4.22.0 · 第四期 R4-X1 可追问的往事会话]
 *
 * 验收口径（计划原文 R4-X1）：
 *   真宿主完成五轮追问，明确换人后旧人物不残留；换会话/分支后旧结果不混入；
 *   歧义时让用户选择；真实模型参与的回答须逐句核来源，未实测不标效果已验。
 *   不做：不把它变成通用 AI 聊天 App，不无限保存对话全文，不由手机自己猜角色身份。
 *
 * 【修前实测的缺口（读码可复算，不是推演）】
 *   `apps/memory/memory-app.js::askPast` 每次只传 `question + {}`，回执里的
 *   `actor / topics / timeHints` 一律被当成「这一问的临时结果」；`memory-view` 是
 *   单输入单结果区。于是用户问「那后来呢」「另一个人呢」时，上一轮认下的人与
 *   时点全部丢失 —— 后果不是报错，而是**回答悄悄换了人**：用户以为还在问甲，
 *   实际查的是全库。「那后来呢」没有会话语义承接，正是计划点名的这半句。
 *
 * 【本版落的四件】（一）纯契约内核 `config/memory-ask-thread.js`：只把上游回执
 *   翻成人能读的几行 + 派发相判定，**不自己算继承**（上游 qa-thread 已带 chatKey
 *   作废重建与消歧未决不产结论两条硬约束，手机再写一份就是把它们各判两次）。
 *   （二）控制器 `askThreadFace / askThreadLine / planAskFollowUpOutlet / askFollowUp /
 *   resolveAskPick / askTrace / askCandidateRows / askThreadSelfCheck / askCarryLine` 九口。
 *   （三）视图「接着上一句」追问区 + 消歧点选 + 轨迹（只回看条件，不留答案全文）。
 *   （四）本期自己抓到的真缺陷：换会话只作废了问答代际、**没作废追问轨迹**
 *   （旧条件会画进新会话那一屏）。
 *
 * 判据面（五组）：
 *   A 口径：六态互不同形 / 三派发相互不同 / 严格判 true / 纯内核零副作用 / 消费点在场
 *   B 内核行为：六态归一 / 沿用读数分句 / 轨迹滚动如实报 / 候选逐个可点 / 自检零问题
 *   C 接线行为：真 App + 假插件走完整旅程（追问继承 / 回落告知 / 消歧不猜 / 换会话作废）
 *   D 负控制：真源码定点破坏 ⇒ 同款判据必转红（每条配原版必真的反向对照）
 *   E 版本锚：五源同源
 *
 * 【为什么负控制破坏副本而不是原仓】见 tests/system-v4120.test.mjs 档头（同规）。
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

const KERNEL_REL = 'config/memory-ask-thread.js';
const APP_REL = 'apps/memory/memory-app.js';
const VIEW_REL = 'apps/memory/memory-view.js';
const VIEW_CSS_REL = 'apps/memory/memory.css';
const BUNDLE_CSS_REL = 'phone.css';

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
        if (state === 'line') { if (c === '\n') { state = 'code'; out += c; } i += 1; continue; }
        if (c === '\\') { out += c + (d || ''); i += 2; continue; }
        if (c === quote) { state = 'code'; out += c; i += 1; continue; }
        out += c; i += 1;
    }
    return out;
}
const kernelCode = stripComments(kernelSrc);
const appCode = stripComments(appSrc);
const viewCode = stripComments(viewSrc);
const P = K.ASK_THREAD_PHASES;
const O = K.ASK_FOLLOWUP_OUTLETS;

/* ══════════ 假件 ══════════ */
/** storage 假件：只实现本面用到的 get/set。 */
function mkStorage() {
    const mem = new Map();
    return {
        _mem: mem,
        get: (k, d) => (mem.has(k) ? mem.get(k) : d),
        set: (k, v) => { mem.set(k, v); },
        has: (k) => mem.has(k)
    };
}
/**
 * 上游插件假身。**三态各造一个**（有追问口 / 只有普通口 / 不在场）——
 * 压平任意两态都会造出处置相反的处境长得一样（装插件 vs 升级 vs 放弃）。
 */
function mkPlugin(kind, impl) {
    const p = {};
    if (kind === 'followup' || kind === 'followup-no-thread') {
        p.askMemoryQuestionFollowUp = impl || ((q) => ({
            version: 1, question: q, followUp: true, turn: 2, threadState: 'open',
            inherit: [{ axis: 'subject' }], condition: [], awaiting: false, accepted: true,
            candidates: [], actors: ['甲'], actor: '甲', refs: [{ ref: 'commit:1' }],
            answer: [{ text: '那晚下了雨' }], gaps: [], writesNothing: true
        }));
    }
    if (kind === 'plain' || kind === 'followup') {
        p.askMemoryQuestion = (q) => ({
            version: 1, question: q, answer: [], gaps: [{ kind: 'nothing', why: 'no-hit' }],
            refs: [], plans: [], actor: null, actors: [], writesNothing: true
        });
    }
    if (kind === 'followup') {
        /* thread 从**可变 holder** 读：真插件带 chatKey，换会话会自行作废重建；
         *   假件要在测试里模拟这一步（否则断的是假件的行为，不是实现的行为）。 */
        p.__thread = {
            version: 1, state: 'open', subjects: ['甲'], candidates: [], atFloor: 12,
            atHint: '', compareAxis: '', branchKey: '', scope: {}, turn: 2
        };
        p.qaThread = () => p.__thread;
    }
    return { LonShaMemory: p };
}
/** 造一个 App 实例并把 `window` 换成给定形态（假插件挂在 window.LonShaMemory 上）。 */
function mkApp(plugin, kind) {
    globalThis.window = {
        VirtualPhone: {},
        /* ★ 假件本身已是 `{LonShaMemory: p}`（与真宿主同形）：这里必须**取内层**，
         *   再套一层就等于挂了一个「装着插件的对象」，三个出口全读成不在场。 */
        ...(kind === 'no-plugin' ? {} : { LonShaMemory: plugin.LonShaMemory })
    };
    return new APP.MemoryApp(null, mkStorage());
}
function clearWin() { delete globalThis.window; }

/* ══════════ A ── 口径面 ══════════ */

test('A1 追问面六态互不同形，三派发相互不同形', () => {
    const phases = Object.values(P);
    assert.equal(phases.length, 6, '六态：' + phases.join(' / '));
    assert.equal(new Set(phases).size, 6, '★ 六态值必须唯一（压平即造出处置相反的处境长得一样）');
    /* 最关键的两对：缺件 ≠ 没开始；已结束 ≠ 没开始。 */
    assert.notEqual(P.ABSENT, P.IDLE, '「插件不在场」与「还没开始」处置相反：等装插件 vs 直接问');
    assert.notEqual(P.UNSUPPORTED, P.IDLE, '「本版没出口」与「还没开始」处置相反：等升级 vs 直接问');
    assert.notEqual(P.CLOSED, P.IDLE, '「这一场已结束」与「还没开始」处置相反：重新认起 vs 从未开始');
    assert.notEqual(P.AWAITING, P.OPEN, '「消歧未决」与「已认下」处置相反：不产结论 vs 产结论');
    const outs = Object.values(O);
    assert.equal(outs.length, 3);
    assert.equal(new Set(outs).size, 3);
    /* 与上游 qa-thread 四态对齐：上游第四态 closed 必须被本件认得（否则读成 idle）。 */
    for (const s of ['idle', 'open', 'awaiting-disambig', 'closed']) {
        assert.ok(kernelSrc.indexOf("'" + s + "'") >= 0, '内核必须认上游那一态：' + s);
    }
    assert.equal(K.ASK_THREAD_LIMITS.turns, 12, '轨迹轮数上限（不无限保存对话全文）');
    assert.equal(K.ASK_THREAD_LIMITS.candidates, 8);
});

test('A2 派发相严格判 true（宽松判会把 1 / \'yes\' 读成「有出口」）', () => {
    assert.equal(K.planFollowUpOutlet(true, true), O.FOLLOWUP, '有追问口优先走追问');
    assert.equal(K.planFollowUpOutlet(false, true), O.PLAIN, '没有追问口回落普通');
    assert.equal(K.planFollowUpOutlet(false, false), O.NONE);
    for (const bad of [undefined, null, 0, 1, 'yes', {}, []]) {
        assert.equal(K.planFollowUpOutlet(bad, false), O.NONE,
            '★ 非 true 一律当「没有」：' + JSON.stringify(bad));
        assert.equal(K.planFollowUpOutlet(false, bad), O.NONE);
    }
    assert.ok(kernelCode.indexOf('hasFollowUp === true') >= 0, '严格判必须写在代码里（不是注释里）');
});

test('A3 纯内核：零 DOM / 零存储 / 零联网 / 零时钟（判据扫去注释后的代码）', () => {
    for (const bad of ['document.', 'window.', 'localStorage', 'sessionStorage', 'indexedDB',
        'fetch(', 'XMLHttpRequest', 'setTimeout', 'setInterval', 'new Date(', 'dispatchEvent']) {
        assert.equal(kernelCode.indexOf(bad) >= 0, false, '纯内核不得出现 ' + bad);
    }
    /* 同时：本件不得自己重算继承（上游唯一真源）——出现这几个名字即越界。 */
    for (const bad of ['planQuestion(', 'composeAnswer(', 'advanceThread(', 'normalizeThread(']) {
        assert.equal(kernelCode.indexOf(bad) >= 0, false, '★ 本件不得自己算继承/查询：' + bad);
    }
});

test('A4 消费点在场：九口建好必须真被调用（视图那一屏也真取数）', () => {
    for (const fn of ['askThreadFace(', 'askThreadLine(', 'planAskFollowUpOutlet(', 'askFollowUp(',
        'resolveAskPick(', 'askTrace(', 'askCandidateRows(', 'askThreadSelfCheck(', 'askCarryLine(']) {
        assert.ok(appSrc.indexOf(fn) >= 0, 'App 侧必须有出口 ' + fn);
    }
    for (const fn of ['app.askThreadLine?.()', 'app.askCandidateRows?.()', 'app.askTrace?.()',
        'app.askFollowUp?.(', 'app.resolveAskPick?.(']) {
        assert.ok(viewSrc.indexOf(fn) >= 0, '视图必须真消费 ' + fn);
    }
    /* 视图不得直摸上游全局（与 v3202 同纪律：取数在控制器，视图只排版）。 */
    assert.equal(viewSrc.indexOf('LonShaMemory') >= 0, false, '视图不得直摸上游全局');
    /* 视图也不得自己拼追问读数/候选（各态怎么说一处判）。 */
    assert.equal(viewCode.indexOf('threadState') >= 0, false, '视图不得碰上游原始字段');
    /* 内核自检必须有真消费点（建好不消费就是悬空出口）。 */
    assert.ok(appCode.indexOf('askThreadSelfCheck()') >= 0);
});

/* ══════════ B ── 内核行为面 ══════════ */

test('B1 六态归一：上游回执 → 本件六态，一格不混', () => {
    assert.equal(K.normalizeThreadFace(null).phase, P.ABSENT, '空件 ⇒ 插件不在场');
    assert.equal(K.normalizeThreadFace({}).phase, P.UNSUPPORTED, '无 followUp 标志 ⇒ 没继承');
    assert.equal(K.normalizeThreadFace({ followUp: true, threadState: 'idle' }).phase, P.IDLE);
    assert.equal(K.normalizeThreadFace({ followUp: true, threadState: 'open', actors: ['甲'] }).phase, P.OPEN);
    assert.equal(K.normalizeThreadFace({ followUp: true, threadState: 'awaiting-disambig', awaiting: true }).phase, P.AWAITING);
    assert.equal(K.normalizeThreadFace({ followUp: true, threadState: 'closed', actors: ['甲'] }).phase, P.CLOSED,
        '★★ 上游说已结束必须记 closed（落进 idle 会被读成「还没开始」，处置相反）');
    /* 分界是上游自己的 followUp 标志，不是「有没有 turn」（turn=0 的普通回执不许读成追问）。 */
    const plainTurn0 = K.normalizeThreadFace({ turn: 0, actors: [], answer: [] });
    assert.equal(plainTurn0.phase, P.UNSUPPORTED);
    const fuTurn0 = K.normalizeThreadFace({ followUp: true, turn: 0, threadState: 'idle' });
    assert.equal(fuTurn0.phase, P.IDLE);
    assert.notEqual(plainTurn0.phase, fuTurn0.phase, '拿 turn 数值当分界就会把这两格压平');
    /* accepted 只在追问面有意义。 */
    assert.equal(plainTurn0.accepted, false, '★ 普通回执不得报「认下了」');
    assert.equal(K.normalizeThreadFace({ followUp: true, accepted: false, threadState: 'awaiting-disambig', awaiting: true }).accepted, false);
    assert.equal(K.normalizeThreadFace({ followUp: true, threadState: 'open' }).accepted, true);
    /* 候选与主体都逐项清洗（畸形值不得变成空串人名）。 */
    const dirty = K.normalizeThreadFace({ followUp: true, threadState: 'awaiting-disambig', awaiting: true, candidates: ['甲', '', null, '  ', '乙'] });
    assert.deepEqual(dirty.candidates, ['甲', '乙']);
    const long = K.normalizeThreadFace({ followUp: true, threadState: 'awaiting-disambig', awaiting: true, candidates: new Array(20).fill(null).map((_, i) => 'n' + i) });
    assert.equal(long.candidates.length, K.ASK_THREAD_LIMITS.candidates, '候选超过上限要截到上限');
});

test('B2 「本次沿用哪些条件」：三态分句、点名人物、时点是人话', () => {
    const open = K.normalizeThreadFace({
        followUp: true, turn: 2, threadState: 'open', actors: ['甲'], atFloor: 12,
        inherit: [{ axis: 'subject' }], condition: [{ axis: 'time' }]
    });
    const line = K.carryLineOf(open);
    assert.ok(line.indexOf('第 2 轮') >= 0, '要点明第几轮：' + line);
    assert.ok(line.indexOf('人物 甲') >= 0, '★ 要点名沿用的人（这正是「那后来呢」要治的那件事）');
    assert.ok(line.indexOf('时点 ≥12楼') >= 0, '时点下界要写成人话：' + line);
    assert.ok(line.indexOf('沿用 subject') >= 0);
    assert.ok(line.indexOf('新设 time') >= 0);
    /* 还没追问过 / 一轮都没有条件：各有各的话，不塌成同一句。 */
    assert.equal(K.carryLineOf(null), '还没有追问过');
    assert.equal(K.carryLineOf(K.normalizeThreadFace({ followUp: true, threadState: 'idle' })), '还没有追问过');
    const noCond = K.normalizeThreadFace({ followUp: true, turn: 1, threadState: 'open' });
    assert.equal(K.carryLineOf(noCond), '第 1 轮 · 没有沿用任何条件');
    const unnamed = K.normalizeThreadFace({ followUp: true, turn: 1, threadState: 'open', inherit: [{ axis: 'subject' }] });
    assert.ok(K.carryLineOf(unnamed).indexOf('人物 (未认下)') >= 0, '认不出人时要说「未认下」，不许假装认下了');
});

test('B3 一行读数：六态各占一格，没有两格同句', () => {
    const faces = {
        absent: K.normalizeThreadFace(null),
        unsupported: K.normalizeThreadFace({}),
        idle: K.normalizeThreadFace({ followUp: true, threadState: 'idle' }),
        open: K.normalizeThreadFace({ followUp: true, threadState: 'open', actors: ['甲'] }),
        awaiting: K.normalizeThreadFace({ followUp: true, threadState: 'awaiting-disambig', awaiting: true, candidates: ['甲', '乙'] }),
        closed: K.normalizeThreadFace({ followUp: true, threadState: 'closed', actors: ['甲'] })
    };
    const lines = Object.keys(faces).map((k) => K.threadFaceLine(faces[k]));
    for (const l of lines) assert.ok(l && l.indexOf('追问') === 0, '读数行必须以「追问」起头：' + l);
    assert.equal(new Set(lines).size, 6, '★ 六格必须六句不同：' + lines.join(' | '));
    assert.ok(lines[1].indexOf('不继承') >= 0, '「没有追问出口」必须明说回落普通问答不继承');
    assert.ok(lines[4].indexOf('待消歧') >= 0 && lines[4].indexOf('甲/乙') >= 0);
    assert.equal(K.threadFaceLine(null), '追问面读不到');
});

test('B4 轨迹：只留最近 N 轮，超出的丢几轮如实报（不静默截断）', () => {
    let h = [];
    let last = null;
    for (let i = 1; i <= K.ASK_THREAD_LIMITS.turns + 2; i++) {
        last = K.appendTrace(h, K.traceStepOf({ followUp: true, turn: i, actor: '甲' }, 'q' + String(i)));
        h = last.trace;
        if (i <= K.ASK_THREAD_LIMITS.turns) assert.equal(last.dropped, 0, '没到上限不该报丢');
    }
    assert.equal(h.length, K.ASK_THREAD_LIMITS.turns, '★ 只留最近 N 轮');
    assert.equal(last.dropped, 1, '本次挤掉几轮（每次最多 1：进一出一）');
    assert.equal(K.droppedTotalOf(h), 2, '★ 累计丢了几轮必须如实报，不许静默截断');
    assert.equal(last.count, K.ASK_THREAD_LIMITS.turns);
    assert.equal(h[h.length - 1].question, 'q' + String(K.ASK_THREAD_LIMITS.turns + 2), '尾必须是最近那一轮');
    assert.equal(h[0].question, 'q3', '头必须是第 N 轮之前的那一轮');
    /* 空历史 / 畸形历史都不抛。 */
    assert.deepEqual(K.appendTrace(null, null).trace, [], '空步不记');
    assert.equal(K.appendTrace('nope', null).count, 0);
    /* 轨迹只记约束，不记答案全文。 */
    const step = K.traceStepOf({ followUp: true, turn: 1, answer: [{ text: '一段很长的答案正文' }], refs: [1, 2] }, '问');
    assert.equal(JSON.stringify(step).indexOf('一段很长的答案正文'), -1, '★ 轨迹不得镜像答案全文（上游正文归上游）');
    assert.equal(step.refs, 2, '但出处条数要记（可回看「这一轮有几条来源」）');
});

test('B5 轨迹行文本：沿用 / 新设 / 待消歧分句，且空步读成空串', () => {
    const t1 = K.traceLineOf(K.traceStepOf({ followUp: true, turn: 1, actor: '甲', inherit: [{ axis: 'subject' }] }, '甲后来呢'));
    const t2 = K.traceLineOf(K.traceStepOf({ followUp: true, turn: 2, actor: '乙', condition: [{ axis: 'time' }] }, '另一个人呢'));
    assert.ok(t1.indexOf('甲后来呢') >= 0, '轨迹行要带上原来的问句（用户才认得出是哪一句）');
    assert.ok(t1.indexOf('人物 甲') >= 0 && t1.indexOf('沿用 subject') >= 0, t1);
    assert.ok(t2.indexOf('人物 乙') >= 0 && t2.indexOf('新设 time') >= 0, t2);
    assert.notEqual(t1, t2, '两轮必须两句');
    const aw = K.traceLineOf(K.traceStepOf({ followUp: true, turn: 3, awaiting: true }, '她是谁'));
    assert.ok(aw.indexOf('待消歧') >= 0 && aw.indexOf('没查') >= 0, '★ 待消歧那一轮必须说清本次没查：' + aw);
    assert.equal(aw.indexOf('沿用'), -1, '★ 待消歧不许写成「沿用」（那会把「没查」伪装成「查过了」）');
    assert.equal(K.traceLineOf(null), '');
});

test('B6 消歧候选：逐个可点、各自可辨认，不排序出「最可能」的那个', () => {
    const face = K.normalizeThreadFace({ followUp: true, threadState: 'awaiting-disambig', awaiting: true, candidates: ['甲', '乙', '丙'] });
    const rows = K.candidateRowsOf(face);
    assert.equal(rows.length, 3);
    assert.equal(new Set(rows.map((r) => r.line)).size, 3, '三行必须各自可辨认');
    assert.deepEqual(rows.map((r) => r.name), ['甲', '乙', '丙'], '顺序照上游给的原序（不重排出「最可能」）');
    assert.equal(rows[0].line, '是「甲」');
    assert.deepEqual(K.candidateRowsOf(null), [], '没有面时不抛');
    assert.deepEqual(K.candidateRowsOf(K.normalizeThreadFace({ followUp: true, threadState: 'open' })), [],
        '不是待消歧时不该有候选可点');
});

test('B7 自检十一项零问题，且各态计数与词表同源', () => {
    const r = K.askThreadSelfCheck();
    assert.deepEqual(r.problems, [], '★ 内核自检必须零问题');
    assert.equal(r.phases, 6, '自检必须覆盖到六态（含 closed）');
    assert.equal(r.outlets, 3);
    assert.equal(Object.keys(K.ASK_THREAD_PHASES).length, 6);
});

/* ══════════ C ── 接线面（真 App + 假插件） ══════════ */

test('C1 真 App：追问走上游追问口，条件真被继承并显示出来', () => {
    const app = mkApp(mkPlugin('followup'), 'followup');
    try {
        assert.equal(app.planAskFollowUpOutlet(), O.FOLLOWUP, '三个出口在时优先走追问');
        const face = app.askThreadFace();
        assert.equal(face.phase, P.OPEN, '插件自带 thread 读数 ⇒ 读它，而不是当成「还没开始」');
        assert.equal(face.subjects[0], '甲');
        assert.ok(app.askThreadLine().indexOf('人物 甲') >= 0, '一行读数必须点名沿用的人');
        /* 追问**前**：上游 thread 读数里没有沿用轴（它只给 state/subjects/turn/atFloor），
         *   故这一屏如实只显示人物与时点 —— 显示不出「沿用 subject」是**上游没给**，
         *   本层不许自己编一个（本项纪律：不自己算继承）。 */
        assert.equal(app.askCarryLine().indexOf('沿用'), -1, '上游 thread 读数不带轴，本层不得自己编');

        const res = app.askFollowUp('那后来呢');
        assert.equal(res.ok, true);
        assert.equal(res.outlet, O.FOLLOWUP);
        assert.equal(res.face.phase, P.OPEN);
        assert.equal(res.line.indexOf('人物 甲') >= 0, true);
        assert.equal(res.note, '', '顺畅追问不必多话');
        /* 追问**后**：同轮次的回执把沿用轴带进读数 —— 这才是计划验收原文点名的那一屏。 */
        assert.ok(app.askCarryLine().indexOf('沿用 subject') >= 0,
            '追问后必须显示「本次沿用哪些条件」，实测：' + app.askCarryLine());
        /* 轨迹记下来了，且只记约束。 */
        const tr = app.askTrace();
        assert.equal(tr.length, 1);
        assert.equal(tr[0].question, '那后来呢');
        assert.deepEqual(tr[0].inheritAxes, ['subject']);
        assert.equal(JSON.stringify(tr).indexOf('那晚下了雨'), -1, '★ 轨迹不得镜像答案全文');
        assert.deepEqual(app.askCandidateRows(), [], '不是待消歧时没有候选可点');
        assert.deepEqual(app.askThreadSelfCheck().problems, []);
    } finally { clearWin(); }
});

test('C2 只有普通问答口：回落并**如实告知没有继承**（不许假装能追）', () => {
    const app = mkApp(mkPlugin('plain'), 'plain');
    try {
        assert.equal(app.planAskFollowUpOutlet(), O.PLAIN);
        const face = app.askThreadFace();
        assert.equal(face.phase, P.UNSUPPORTED, '★ 没有追问出口必须记「不继承」，不许读成「还没开始」');
        assert.ok(app.askThreadLine().indexOf('不继承') >= 0);
        const res = app.askFollowUp('那后来呢');
        assert.equal(res.ok, true, '普通问答照样能问（能做，只是没有继承）');
        assert.equal(res.outlet, O.PLAIN);
        assert.ok(res.note.indexOf('没有被继承') >= 0, '★ 必须当面说清这次没有继承：' + res.note);
        assert.equal(res.face.phase, P.UNSUPPORTED);
    } finally { clearWin(); }
});

test('C3 插件不在场：如实说问不了，且不抛', () => {
    const app = mkApp(null, 'no-plugin');
    try {
        assert.equal(app.planAskFollowUpOutlet(), O.NONE);
        assert.equal(app.askThreadFace().phase, P.ABSENT);
        assert.ok(app.askThreadLine().indexOf('不在场') >= 0);
        const res = app.askFollowUp('那后来呢');
        assert.equal(res.ok, false);
        assert.equal(res.outlet, O.NONE);
        assert.ok(res.note.indexOf('不在场') >= 0, '★ 不许报成「没查到」');
        assert.deepEqual(app.askThreadSelfCheck().problems, [], '自检不依赖插件在场');
    } finally { clearWin(); }
});

test('C4 歧义时让用户选择：未决时**不产结论**，点选才接回上游', () => {
    const seen = { picks: null, called: 0 };
    const plugin = mkPlugin('followup-no-thread', (q) => ({
        version: 1, question: q, followUp: true, turn: 1, threadState: 'awaiting-disambig',
        awaiting: true, accepted: false, candidates: ['甲', '乙'], actors: [], inherit: [],
        condition: [], writeNothing: true
    }));
    plugin.LonShaMemory.qaThreadResolve = (picks) => {
        seen.picks = picks;
        seen.called += 1;
        return { ok: true, reason: '', resolved: picks[0] === '甲', thread: null, chosen: picks, unknown: [], writesNothing: true };
    };
    const app = mkApp(plugin, 'followup');
    try {
        const res = app.askFollowUp('她呢');
        assert.equal(res.face.phase, P.AWAITING);
        assert.equal(res.face.awaiting, true);
        assert.equal(res.face.accepted, false, '★ 未决时不许报「认下了」');
        assert.ok(res.note.indexOf('没有查') >= 0, '★ 必须说清本次没有查（替用户猜一个名字比不查更贵）');
        assert.ok(res.note.indexOf('甲') >= 0 && res.note.indexOf('乙') >= 0, '候选要摆出来：' + res.note);
        const rows = app.askCandidateRows();
        assert.equal(rows.length, 2, '★ 歧义时必须让用户有得选');
        assert.notEqual(rows[0].line, rows[1].line, '两个候选必须各自可辨认');

        /* 没选人 ⇒ 保持待消歧，不替用户猜。 */
        const empty = app.resolveAskPick('  ');
        assert.equal(empty.ok, false);
        assert.equal(empty.resolved, false);
        assert.ok(empty.note.indexOf('没选人') >= 0);
        assert.equal(seen.called, 0, '★ 没选人时不该去问上游');

        /* 点了可选的那个 ⇒ 接回上游并如实报成。 */
        const okPick = app.resolveAskPick('甲');
        assert.deepEqual(seen.picks, ['甲'], '裁决要原样交给上游');
        assert.equal(okPick.resolved, true);
        assert.ok(okPick.note.indexOf('甲') >= 0);

        /* 点了候选里没有的名字 ⇒ 保持待消歧（上游说不认就不认）。 */
        const bad = app.resolveAskPick('丙');
        assert.equal(bad.ok, false);
        assert.equal(bad.resolved, false);
        assert.ok(bad.note.indexOf('保持待消歧') >= 0, '★ 未认下不许产确定结论：' + bad.note);
    } finally { clearWin(); }
});

test('C5 ★★★ 换会话/分支后旧结果不混入：追问轨迹当场作废', () => {
    const plugin = mkPlugin('followup');
    const app = mkApp(plugin, 'followup');
    try {
        app.askFollowUp('那后来呢');
        app.askFollowUp('另一个人呢');
        assert.equal(app.askTrace().length, 2, '本会话内轨迹累积');
        assert.equal(app.askDroppedTotal(), 0, '没到上限不该报丢');

        /* 换会话：上游那一层的动作是**它自己**随 chatKey 作废重建（本层不替它做），
         *   故这里把假插件复位 —— 与真插件同一动作。 */
        plugin.LonShaMemory.__thread = { version: 1, state: 'idle', subjects: [], candidates: [], atFloor: null, atHint: '', compareAxis: '', branchKey: '', scope: {}, turn: 0 };
        app.onChatChanged();

        assert.equal(app.askTrace().length, 0,
            '★★★ 换会话必须作废轨迹：不作废就会把上一段的条件画进新会话那一屏'
            + '（用户看到「第 5 轮 · 人物 甲」而这一段一次都没追问过）—— 不报错、只是错数据');
        assert.equal(app.askCarryLine(), '还没有追问过', '读数也要跟着回到「还没追问过」');
        assert.equal(app.askThreadFace().phase, P.IDLE, '上游说还没开始，本层就报还没开始');
        assert.deepEqual(app.askCandidateRows(), [], '上一段的候选不许留在新会话里');
        /* ★ 本层**不替**上游作废 thread：上游没复位时读数仍以上游为准（那是它的活）。 */
        const plugin2 = mkPlugin('followup');
        const app2 = mkApp(plugin2, 'followup');
        try {
            app2.askFollowUp('那后来呢');
            app2.onChatChanged();
            assert.equal(app2.askTrace().length, 0, '轨迹当场作废');
            assert.ok(app2.askCarryLine().indexOf('人物 甲') >= 0,
                '上游未复位时读数仍照上游走（本层不越权替它作废 thread）');
        } finally { clearWin(); }
    } finally { clearWin(); }
});

test('C6 视图接线：追问输入/按钮/候选/轨迹在场，事件与样式都真投递', () => {
    for (const id of ['mem-fu-q', 'mem-fu-btn', 'mem-fu-host', 'mem-fu-face', 'mem-fu-cands', 'mem-fu-trace', 'mem-fu-note']) {
        assert.ok(viewSrc.indexOf('"' + id + '"') >= 0, '视图缺元素 ' + id);
    }
    assert.ok(viewCode.indexOf("q('#mem-fu-btn')?.addEventListener('click', () => this._doFollowUp());") >= 0,
        '追问按钮必须有事件落点');
    assert.ok(viewCode.indexOf("q('#mem-fu-q')?.addEventListener('keydown'") >= 0, '回车也要能追问');
    assert.ok(viewCode.indexOf("e.target.closest('.mem-fu-cand')") >= 0, '候选点选必须有落点（容器级委托）');
    assert.ok(viewCode.indexOf("this._pickAskCandidate(") >= 0, '委托必须真调到取数口');
    assert.ok(viewCode.indexOf('traceLineOf(') >= 0, '轨迹行必须走纯函数（各态怎么说一处判）');
    /* 追问面独立于问答面渲染：问答面读不出时追问面照样该说自己那一态（不连坐）。 */
    assert.ok(viewCode.indexOf("parts.push('<div id=\"mem-fu-host\">'") >= 0);
    const askHtml = viewCode.slice(viewCode.indexOf('_askHtml(pkg) {'));
    const body = askHtml.slice(0, askHtml.indexOf('  /* ====='));
    const iFu = body.indexOf('mem-fu-host');
    const iQa = body.indexOf("if (!qa) return");
    assert.ok(iFu >= 0 && iQa > iFu, '追问面必须排在「问答面读不出就返回」之前（否则插件没输出时整块不画）');
    /* 样式两侧投递（源文件保留 + phone.css 打包）：只写一侧等于打包环境里裸奔。 */
    for (const cls of ['.mem-fu-face', '.mem-fu-cand', '.mem-fu-trace-row', '.mem-fu-note-text']) {
        assert.ok(appCssSrc.indexOf(cls) >= 0, '源样式缺 ' + cls);
        assert.ok(bundleCssSrc.indexOf(cls) >= 0, 'phone.css 打包侧缺 ' + cls);
    }
});

test('C7 上游出口名逐字对齐（不各写一份）与三态出口的取数落点', () => {
    for (const name of ['plugin.askMemoryQuestionFollowUp', 'plugin.qaThreadResolve', 'plugin.qaThread']) {
        assert.ok(appCode.indexOf(name) >= 0, '必须调上游那一个名字：' + name);
    }
    /* 上游 thread 读数与回执字段同名同义：本层只做形状翻译，不改字段名。
     *   ★ 这些键是**内核**在消费（App 用的是内核翻好的 inheritAxes / conditionAxes），
     *     故判据扫内核 —— 首版去 App 里找 inherit，扫的是注释，等于没判。 */
    for (const k of ['threadState', 'awaiting', 'candidates', 'inherit', 'condition', 'accepted']) {
        assert.ok(kernelCode.indexOf(k) >= 0, '上游回执键必须原样使用：' + k);
    }
    /* 有出口但插件没给 thread 读数口 ⇒ 报 idle（「还没开始」），不许报「问不了」。 */
    const app = mkApp(mkPlugin('followup-no-thread', (q) => ({
        version: 1, question: q, followUp: true, turn: 0, threadState: 'idle', awaiting: false,
        accepted: true, candidates: [], actors: [], inherit: [], condition: [], writesNothing: true
    })), 'followup');
    try {
        assert.equal(app.askThreadFace().phase, P.IDLE);
        assert.ok(app.askThreadLine().indexOf('还没开始') >= 0);
    } finally { clearWin(); }
});

/* ══════════ D ── 负控制（真源码破坏 ⇒ 同一判据必转红） ══════════ */
const temps = [];
function makeMirror() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rp_v4220_'));
    temps.push(dir);
    copyTreeSafe(path.join(ROOT, 'config'), path.join(dir, 'config'));
    copyTreeSafe(path.join(ROOT, 'apps', 'memory'), path.join(dir, 'apps', 'memory'));
    /* ★ 镜像必须跟上真依赖（本版）：memory-app.js 自 v4.23.0 起 import 了
     *   `../reading/reading-data.js`（多编码解码复用阅读 App 那一份），
     *   镜像不带它 ⇒ 副本 import 就是 ERR_MODULE_NOT_FOUND，
     *   负控制会变成「因缺文件而红」而不是「因破坏而红」
     *   （本仓同一支笔的教训已反复出现，此处是第三次）。 */
    copyTreeSafe(path.join(ROOT, 'apps', 'reading'), path.join(dir, 'apps', 'reading'));
    return dir;
}
process.on('exit', () => {
    for (const d of temps) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (_e) { /* 忽略 */ } }
});
/** 真源码破坏：锚点必须**恰中一次**；破坏的是**副本**（绝不动真仓）。 */
function breakCopy(rel, anchor, replacement) {
    const dir = makeMirror();
    const src = read(rel);
    const hits = src.split(anchor).length - 1;
    assert.equal(hits, 1, '破坏锚点必须恰中 1 次（实测 ' + hits + '）：' + anchor.slice(0, 70));
    fs.writeFileSync(path.join(dir, rel), src.split(anchor).join(replacement));
    return dir;
}
async function loadApp(dir, tag) {
    return await import(pathToFileURL(path.join(dir, APP_REL)).href + '?' + tag + '=' + Date.now());
}

test('D0 ★★★ 阳性对照：未破坏时四条判据必须全为真（否则 D 组是假绿）', () => {
    assert.equal(K.normalizeThreadFace({ followUp: true, threadState: 'closed', actors: ['甲'] }).phase, P.CLOSED, '原版：已结束记 closed');
    assert.equal(K.planFollowUpOutlet('yes', false), O.NONE, '原版：严格判 true');
    let h = [];
    for (let i = 1; i <= K.ASK_THREAD_LIMITS.turns + 1; i++) h = K.appendTrace(h, K.traceStepOf({ turn: i }, 'q')).trace;
    assert.equal(h.length, K.ASK_THREAD_LIMITS.turns, '原版：轨迹滚动到上限');
    const app = mkApp(mkPlugin('followup'), 'followup');
    try {
        app.askFollowUp('q');
        app.onChatChanged();
        assert.equal(app.askTrace().length, 0, '原版：换会话清轨迹');
    } finally { clearWin(); }
    assert.equal(K.normalizeThreadFace({ turn: 0, answer: [] }).accepted, false, '原版：普通回执不报认下');
});

test('D1 ★★★ 破坏「已结束不得读成还没开始」⇒ 同款判据必转红', async () => {
    const dir = breakCopy(KERNEL_REL,
        "    else if (followUp && state === 'closed') phase = ASK_THREAD_PHASES.CLOSED;",
        '    else if (false) phase = ASK_THREAD_PHASES.CLOSED;');
    const mk = await import(pathToFileURL(path.join(dir, KERNEL_REL)).href + '?d1=' + Date.now());
    const broken = mk.normalizeThreadFace({ followUp: true, turn: 3, threadState: 'closed', actors: ['甲'] });
    assert.notEqual(broken.phase, mk.ASK_THREAD_PHASES.CLOSED, '破坏副本：上游说已结束却不再记 closed');
    assert.equal(broken.phase, mk.ASK_THREAD_PHASES.OPEN, '而它被读成了「已认下」—— 用户以为这一场还开着');
    assert.equal(K.normalizeThreadFace({ followUp: true, turn: 3, threadState: 'closed', actors: ['甲'] }).phase, P.CLOSED,
        '原版必须记 closed（否则上面的转红不算证据）');
});

test('D2 ★★★ 破坏「换会话作废轨迹」⇒ C5 同款判据必转红（旧条件混进新会话）', async () => {
    const dir = breakCopy(APP_REL, '    this._askTrace = [];', '    void 0;');
    const m = await loadApp(dir, 'd2');
    const app = mkApp(mkPlugin('followup'), 'followup');
    try {
        const a = new m.MemoryApp(null, mkStorage());
        a.askFollowUp('那后来呢');
        assert.equal(a.askTrace().length, 1, '破坏副本：问过一次');
        a.onChatChanged();
        assert.equal(a.askTrace().length, 1, '★★★ 破坏副本：换会话后旧轨迹仍在 ⇒ 会画进新会话那一屏');
    } finally { clearWin(); }
});

test('D3 ★★★ 破坏「严格判 true」⇒ 同款判据必转红（非 true 被读成有出口）', async () => {
    const dir = breakCopy(KERNEL_REL,
        '    if (hasFollowUp === true) return ASK_FOLLOWUP_OUTLETS.FOLLOWUP;',
        '    if (hasFollowUp) return ASK_FOLLOWUP_OUTLETS.FOLLOWUP;');
    const mk = await import(pathToFileURL(path.join(dir, KERNEL_REL)).href + '?d3=' + Date.now());
    assert.equal(mk.planFollowUpOutlet('yes', false), mk.ASK_FOLLOWUP_OUTLETS.FOLLOWUP,
        '破坏副本：一个字符串被读成「有追问出口」⇒ 用户会点到一个走不通的按钮');
    assert.equal(K.planFollowUpOutlet('yes', false), O.NONE, '原版必须严格判');
});

test('D4 ★★★ 破坏「accepted 只在追问面有意义」⇒ 同款判据必转红（没这回事报成认下了）', async () => {
    const dir = breakCopy(KERNEL_REL,
        '        accepted: followUp ? (r.accepted !== false) : false, candidates: candidates,',
        '        accepted: true, candidates: candidates,');
    const mk = await import(pathToFileURL(path.join(dir, KERNEL_REL)).href + '?d4=' + Date.now());
    assert.equal(mk.normalizeThreadFace({ turn: 0, actors: [], answer: [] }).accepted, true,
        '破坏副本：普通回执被报成「认下了」—— 用户会以为上一轮的条件还在');
    assert.equal(K.normalizeThreadFace({ turn: 0, actors: [], answer: [] }).accepted, false, '原版必须报没这回事');
    /* 反向对照：追问面的认下与否仍要如实传。 */
    assert.equal(K.normalizeThreadFace({ followUp: true, accepted: false, threadState: 'awaiting-disambig', awaiting: true }).accepted, false);
});

test('D5 ★★★ 破坏「轨迹滚动上限」⇒ 同款判据必转红（无限保存对话）', async () => {
    const dir = breakCopy(KERNEL_REL,
        '    const dropped = Math.max(0, list.length - ASK_THREAD_LIMITS.turns);',
        '    const dropped = 0;');
    const mk = await import(pathToFileURL(path.join(dir, KERNEL_REL)).href + '?d5=' + Date.now());
    let h = [];
    for (let i = 1; i <= mk.ASK_THREAD_LIMITS.turns + 2; i++) h = mk.appendTrace(h, mk.traceStepOf({ turn: i }, 'q')).trace;
    assert.equal(h.length, mk.ASK_THREAD_LIMITS.turns + 2, '破坏副本：轨迹无限增长');
    let h0 = [];
    for (let i = 1; i <= K.ASK_THREAD_LIMITS.turns + 2; i++) h0 = K.appendTrace(h0, K.traceStepOf({ turn: i }, 'q')).trace;
    assert.equal(h0.length, K.ASK_THREAD_LIMITS.turns, '原版必须滚动到上限');
});

/* ══════════ E ── 版本锚 ══════════ */
test('E1 五源同源（版本号不锁死具体值，但必须一致且当版条目存在）', () => {
    const pkg = JSON.parse(read('package.json'));
    const man = JSON.parse(read('manifest.json'));
    const log = JSON.parse(read('update-log.json'));
    const ver = pkg.version;
    assert.match(ver, /^\d+\.\d+\.\d+$/, '版本号形态必须正常:' + ver);
    assert.equal(man.version, ver, 'manifest 与 package 必须同版');
    assert.equal(log.latest, ver, 'update-log.latest 必须同版');
    assert.equal(log.head, ver, 'update-log.head 必须同版');
    assert.ok(log.versions[ver], '当版条目必须存在');
    assert.ok(Array.isArray(log.versions[ver].items) && log.versions[ver].items.length >= 8,
        '当版公告至少 8 条');
    assert.ok(read('index.js').indexOf("const ST_PHONE_VERSION = '" + ver + "';") >= 0, 'index.js 版本常量必须同源');
});
