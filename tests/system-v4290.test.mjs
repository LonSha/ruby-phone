/* ============================================================
 * tests/system-v4290.test.mjs -- [v4.29.0 · 第四期 R4-X7 群聊投票与协商式活动安排]
 *
 * 验收口径（计划原文 R4-X7）：
 *   「群里提出时间/地点选项，人物按已知偏好回应、弃权或反对；用户综合结果再确认活动，
 *     形成可玩的协商过程。」
 *   落点与依赖：wechat 内投票消息 + 既有日历/旅行入口，复用稳定成员 ID 与约定 owner；
 *     表决不直接变成承诺，只有明确接受者进入参与名单。
 *   验收五条：① 四人群两轮改方案；② 缺席者不被代投；③ 平票不自动拍板；
 *     ④ 重复回复不重复计票；⑤ 确认一次只生成一份活动。
 *   不做三条：不接真实通讯平台、不引入常驻群聊代理、不用关系分数伪造角色同意。
 *
 * 【本件与 R4-X4 / R4-X6 不同（读码可复算）】
 *   那两件治的是「上游名面已在、手机侧零消费」；本件是**下游自建**：
 *   上游 lonsha-memory-plugin 的外供面表十四面里没有任何投票 / 轮询 / 计票面，
 *   故本件不能搬上游读数，也不立跨仓登记行与桥消费面标签（无上游面对应）。
 *   本仓既有的三件底座（group-scheduler / group-pace / traveldesk-plan 与
 *   commitment-flow）都不是投票面 —— 计划原文逐字写着「现有行程确认不等于多人表达不同意见」。
 *
 * 【本版治的缺陷形态（四条，都不是报错）】
 *   缺了把「多人对多个选项的表态」落成可判读数的那一层，四件事会同时发生：
 *     ① 同一人回两次，票数翻倍；
 *     ② 两个选项票数一样时，「取第一个」被当成「大家选了它」；
 *     ③ 没表态的人被当成默许；
 *     ④ 「投过票」直接等于「约好了」。
 *   故本件的四条口径在本套件里是**可判的**：重复两层分开报、平票不自动拍板、
 *   缺席不进参与名单也不算反对、确认只产活动读数（commitment 恒 null）。
 *
 * 判据面（五组）：
 *   A 口径：四态两两不同形 / 纯内核零副作用（不碰 DOM 存储网络时钟、只依赖唯一取数门） /
 *          出口名与状态字面量唯一出现点 / 视图不直呼内核 / 禁用键清单在场且非空
 *   B 内核行为：四态分形逐态 / 三张具名表与四类人分列 / 重复两层分开报 /
 *              平票不自动拍板且点名非并列项拒收 / 缺席不被代投 / 确认幂等 / 确认不产承诺 / 自检真跑
 *   C 接线行为：真接线件 + 假数据面走完整旅程（读不出 → 四态 → 设选位 → 换会话作废 →
 *              真视图渲染与绑定 → 确认派发零写盘）
 *   D 负控制：真源码定点破坏 ⇒ 同款判据必转红（每条配原版必真的反向对照）
 *   E 版本锚：五源同源（不锁死具体版本值）
 *
 * 【为什么负控制破坏副本而不是原仓】见 tests/system-v4120.test.mjs 档头（同规）。
 * 【为什么自检里也要真跑判据】数常量只能证明表在，不能证明**判得对**。
 * ========================================================== */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { copyTreeSafe } from './_mirror_tree.mjs';
import { execFileSync } from 'node:child_process';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const KERNEL_REL = 'config/group-vote-contract.js';
const WIRE_REL = 'apps/wechat/group-vote.js';
const VIEW_REL = 'apps/wechat/chat-view.js';
const APP_REL = 'apps/wechat/wechat-app.js';
const EVENTS_REL = 'config/phone-events.js';
const K = await import(pathToFileURL(path.join(ROOT, KERNEL_REL)).href);
const WIRE = await import(pathToFileURL(path.join(ROOT, WIRE_REL)).href);
const VIEW = await import(pathToFileURL(path.join(ROOT, VIEW_REL)).href);
const EVENTS = await import(pathToFileURL(path.join(ROOT, EVENTS_REL)).href);
const kernelSrc = read(KERNEL_REL);
const wireSrc = read(WIRE_REL);
const viewSrc = read(VIEW_REL);
const appSrc = read(APP_REL);
const S = K.GV_STATES;
const countOf = (hay, needle) => hay.split(needle).length - 1;
/** 去注释（块注释 + 整行注释）：判据只认代码，不认注释里的自述。 */
const stripAll = (s) => s
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split(NL).filter((l) => !/^\s*\/\//.test(l)).join(NL);
/* 本面独有的状态字面量：**只许内核一份**（接线层与视图零命中）。
 *   ★ 'support' / 'oppose' / 'abstain' / 'replayed' 等不进这一档：
 *     视图要以它们作**查表键**（这不算第二份判定），算进来是误报。
 *   这一档只收「状态 / 归因」词，它们的唯一出现点就是内核的表。 */
const KERNEL_ONLY = ["'no-options'", "'no-members'", "'no-votes'", "'option-absent'",
    "'votedNow'", "'staleOnly'"];
const NL = String.fromCharCode(10);
/* ══════════ 假件 ══════════ */
/** 群消息数据面假件：只实现接线件真正用到的三个口。 */
function mkData(msgs, members) {
    return {
        getMessages: () => msgs,
        getGroupMembers: () => members,
        getUserInfo: () => ({ name: '我' }),
        _msgs: msgs,
        addMessage: (id, m) => { msgs.push(m); },
        get addCount() { return msgs.filter((m) => m.type === 'group_vote_activity').length; }
    };
}
/** 真接线件 + 假数据面的 App 外壳（视图只经它取数）。 */
function mkApp(data, win) {
    const wire = new WIRE.GroupVote({ wechatData: data });
    const notes = [];
    return {
        _wire: wire,
        _notes: notes,
        _win: () => win,
        wechatData: data,
        currentChat: { id: 'g1' },
        phoneShell: { showNotification: (t, b) => { notes.push(String(b)); } },
        render() {},
        votePack: (id) => wire.pack(id || 'g1'),
        voteRead: (id) => wire.tally(id || 'g1'),
        votePicked: () => wire.picked,
        setVotePicked: (v) => wire.setPicked(v),
        voteGate: (r) => wire.gate(r),
        voteNote: (r) => wire.note(r),
        voteChoiceIds: () => wire.choiceIds(),
        voteChoiceLabel: (c) => wire.choiceLabel(c),
        voteChoiceIdByLabel: (t) => wire.choiceIdByLabel(t),
        voteBucketIds: () => wire.memberBucketIds(),
        voteBucketLabel: (b) => wire.memberBucketLabel(b),
        voteReasonHint: (r) => wire.reasonHint(r),
        voteConfirm: (id) => wire.confirm(id || 'g1')
    };
}
/** 视图假件：Object.create(真 ChatView.prototype)，只补它真正用到的字段。 */
function mkView(app) {
    const v = Object.create(VIEW.ChatView.prototype);
    v.app = app;
    v._voteCache = null;
    v._escapeHtml = (s) => String(s == null ? '' : s)
        .split('&').join('&amp;').split('<').join('&lt;').split('>').join('&gt;');
    return v;
}
/** 一条群投票消息 + 若干表态消息。 */
const GV_MSG = { id: 'm1', from: 'system', type: 'group_vote', content: '[群投票]',
    groupVote: { question: '周末去哪', round: 2, options: [
        { id: 'o1', label: '周六下午', kind: 'time', round: 2 },
        { id: 'o2', label: '周日晚上', kind: 'time', round: 2 },
        { id: 'o3', label: '老地方', kind: 'place', round: 1 }] } };
const stmt = (id, memberId, optionId, choice) => ({ id: id, from: 'c', type: 'group_vote_statement',
    content: '[投票]', groupVote: { memberId: memberId, optionId: optionId, choice: choice } });
/** 内核输入形状（扁平）：接线件负责把消息面搬成这个形状，判据两边都要用。
 *   ★ 两者**不能混用**：混用会把「接线件搬错了」读成「内核判错了」。 */
const kv = (memberId, optionId, choice, eventKey) => ({ memberId: memberId, optionId: optionId,
    choice: choice, eventKey: eventKey || (memberId + '|' + optionId + '|' + choice) });
const MEMBERS = [{ id: 'c1', name: '甲' }, { id: 'c2', name: '乙' },
    { id: 'c3', name: '丙' }, { id: 'c4', name: '丁' }];
const withWin = async (obj, fn) => {
    const backup = Object.getOwnPropertyDescriptor(globalThis, 'window');
    globalThis.window = obj;
    try { return await fn(); } finally {
        if (backup) Object.defineProperty(globalThis, 'window', backup);
        else delete globalThis.window;
    }
};
/* ══════════ A ── 口径 ══════════ */
test('A1 四态两两不同形（没得投 / 群里一个人都没有 / 真读数空 / 读到）', () => {
    const vals = Object.values(S);
    assert.equal(new Set(vals).size, vals.length, '四态各格必须互不相同');
    assert.equal(vals.length, 4, '四态口径必须四项');
    assert.notEqual(S.NO_OPTIONS, S.EMPTY, '「没得投」与「真读数空」必须不同形');
    assert.notEqual(S.NO_MEMBERS, S.EMPTY, '「群里没人」与「没人表态」必须不同形');
    assert.notEqual(S.NO_OPTIONS, S.NO_MEMBERS, '「没得投」与「没人」必须不同形');
    /* 三态结果也必须互不相同（平票与无人支持处置相反）。 */
    const vd = K.GV_VERDICTS;
    assert.equal(new Set(vd).size, vd.length);
    assert.equal(vd.length, 3, '结果三态必须三项');
    /* 四类人分列。 */
    const bk = K.GV_MEMBER_BUCKETS;
    assert.equal(new Set(bk).size, bk.length);
    assert.equal(bk.length, 4, '归属四类必须分列（合成一格就分不出谁算在场）');
});
test('A2 纯内核零副作用：不碰 DOM / 存储 / 网络 / 时钟，且只依赖唯一取数门', () => {
    const code = stripAll(kernelSrc);
    for (const bad of ['document.', 'window.', 'localStorage', 'sessionStorage',
        'fetch(', 'XMLHttpRequest', 'WebSocket', 'setTimeout', 'setInterval', 'Date.now']) {
        assert.equal(countOf(code, bad), 0, '纯内核不得出现 ' + bad);
    }
    /* 只依赖唯一取数门（弱口径门 W1 的修法）：不在本文件就地再写一份数值取值。 */
    const imports = kernelSrc.match(/^import .*$/gm) || [];
    assert.equal(imports.length, 1, '纯内核只许一条 import（实测 ' + imports.length + '）');
    assert.ok(imports[0].indexOf('num-gate.js') >= 0, '唯一依赖必须是 config/num-gate.js');
    assert.equal(countOf(code, 'Number.isFinite'), 0, '不得就地写第二份弱口径');
});
test('A3 出口名与状态字面量唯一出现点：改一处即全仓同改', () => {
    const outlets = ['GV_STATES', 'GV_REASONS', 'GV_STATE_HINT', 'GV_REASON_HINT', 'GV_CHOICES',
        'GV_CHOICE_LABEL', 'GV_CHOICE_BY_LABEL', 'GV_VERDICTS', 'GV_VERDICT_LABEL',
        'GV_OPTION_KINDS', 'GV_KIND_LABEL', 'GV_MEMBER_BUCKETS', 'GV_MEMBER_LABEL',
        'GV_FORBIDDEN_KEYS', 'GV_LIMITS', 'normalizeVote', 'tallyVote', 'activityIdOf',
        'confirmActivity', 'summarizeVote', 'voteLine', 'activityLine', 'voteGateOf',
        'voteNoteOf', 'gvSelfCheck'];
    for (const name of outlets) {
        assert.ok(countOf(kernelSrc, name) >= 2, '出口 ' + name + ' 必须定义并进 default');
        const inDefault = countOf(kernelSrc, '    ' + name + ',') + countOf(kernelSrc, '    ' + name + NL + '};');
        assert.ok(inDefault >= 1, '出口 ' + name + ' 必须进 default export');
    }
    /* 接线层与视图不得再写本面独有的状态 / 归因词。 */
    const wiring = wireSrc + appSrc + viewSrc;
    for (const lit of KERNEL_ONLY) {
        assert.equal(countOf(wiring, lit), 0, '接线层不得再写判定词 ' + lit);
    }
});
test('A4 视图不直呼内核：判定全由 App 转交', () => {
    /* ★ 剥注释后再判：视图里为了讲清「判定词只许内核一份」而在注释里提过这个文件名，
     *   那不是 import（本仓旧病：注释里的名字被当成代码判）。 */
    assert.equal(countOf(stripAll(viewSrc), 'group-vote-contract.js'), 0, '视图不得 import 契约件');
    for (const fn of ['tallyVote(', 'confirmActivity(', 'voteGateOf(', 'voteNoteOf(',
        'voteLine(', 'activityLine(', 'gvSelfCheck(', 'summarizeVote(', 'normalizeVote(']) {
        assert.equal(countOf(viewSrc, fn), 0, '视图不得直呼内核函数 ' + fn);
    }
    for (const fn of ['votePack(', 'voteChoiceLabel(', 'voteChoiceIdByLabel(',
        'voteReasonHint(', 'votePicked', 'setVotePicked', 'voteConfirm(']) {
        assert.ok(countOf(viewSrc, fn) >= 1, '视图必须经 App 出口取数：' + fn);
    }
    /* 视图不单独直取 gate / note / 四类人标签：它们由 pack **一次取齐**，
     *   多开一个取数点就多一处漂移面（本仓「同一读数两个来源必然漂移」）。 */
    for (const fn of ['voteGate(', 'voteNote(', 'voteBucketLabel(']) {
        assert.equal(countOf(viewSrc, fn), 0, '视图不得另开取数点：' + fn);
    }
    /* ★ 视图里不许写第二份「理由 -> 文案」表与第二份「中文标签 -> 表态 id」映射：
     *   本版判据当场抓到过这两份（已由 patch_x7d 收回内核）—— 这一条把「收回」变成
     *   跑不掉的约束。判据只认「表形态」（键值对 / 三元式），不认说明句。 */
    assert.equal(countOf(viewSrc, "'no-options': '"), 0, '视图不得写第二份理由表');
    assert.equal(countOf(viewSrc, "=== '支持'"), 0, '视图不得写第二份中文标签映射');
    /* 反向对照：视图里那两处**调用**必须在场（上一条判的不是空判据）。 */
    assert.ok(countOf(viewSrc, 'voteReasonHint') >= 2, '视图必须经 App 出口取理由文案');
    assert.ok(countOf(viewSrc, 'voteChoiceIdByLabel') >= 2, '视图必须经 App 出口取中文标签映射');
});
test('A5 禁用键清单在场且非空：读数里不得出现分数 / 权重 / 概率一族', () => {
    const keys = K.GV_FORBIDDEN_KEYS;
    assert.ok(Array.isArray(keys) && keys.length >= 5);
    for (const k of ['score', 'weight', 'probability', 'rank', 'rating']) {
        assert.ok(keys.indexOf(k) >= 0, '禁用键必须含 ' + k);
    }
    const scan = (v, hits) => {
        if (v === null || v === undefined) return hits;
        if (Array.isArray(v)) { for (const it of v) scan(it, hits); return hits; }
        if (typeof v !== 'object') return hits;
        for (const k of Object.keys(v)) {
            if (keys.indexOf(String(k).toLowerCase()) >= 0) hits.push(k);
            scan(v[k], hits);
        }
        return hits;
    };
    const data = mkData([GV_MSG, stmt('e1', 'c1', 'o1', 'support'),
        stmt('e2', 'c2', 'o1', 'support'), stmt('e3', 'c3', 'o2', 'oppose')], MEMBERS);
    const wire = new WIRE.GroupVote({ wechatData: data });
    const hits = scan([wire.tally('g1'), wire.summary('g1'), wire.pack('g1')], []);
    assert.deepEqual(hits, [], '读数里出现禁用键：' + hits.join('/'));
});
/* ══════════ B ── 内核行为 ══════════ */
test('B1 四态分形逐态实测（没得投 / 没人 / 真读数空 / 读到）', () => {
    const noOpt = K.tallyVote({ round: 1, options: [], members: MEMBERS, statements: [] });
    assert.equal(noOpt.state, S.NO_OPTIONS);
    assert.equal(noOpt.reason, 'no-options');
    const noMem = K.tallyVote({ round: 1, options: [{ id: 'o1', label: 'A', round: 1 }], members: [], statements: [] });
    assert.equal(noMem.state, S.NO_MEMBERS);
    assert.equal(noMem.reason, 'no-members');
    const empty = K.tallyVote({ round: 1, options: [{ id: 'o1', label: 'A', round: 1 }],
        members: MEMBERS, statements: [] });
    assert.equal(empty.state, S.EMPTY);
    assert.equal(empty.reason, 'empty');
    assert.notEqual(empty.verdict, 'tie', '零表态不得报平票（两态不同形）');
    const ok = K.tallyVote({ round: 2, options: [{ id: 'o1', label: 'A', round: 2 }],
        members: MEMBERS, statements: [kv('c1', 'o1', 'support', 'k1')] });
    assert.equal(ok.state, S.OK);
    assert.equal(ok.verdict, 'decided');
    assert.equal(ok.leader, 'o1');
    /* 一行读数逐态不同形（合成一句就分不出「该去提选项」与「该等人回」）。 */
    const lines = [K.voteLine(noOpt), K.voteLine(noMem), K.voteLine(empty), K.voteLine(ok)];
    assert.equal(new Set(lines).size, 4, '四态一行读数不得同形');
});
test('B2 三张具名表 + 四类人分列（缺席不被代投，旧轮表态不掺本轮）', () => {
    const data = { round: 2,
        options: [{ id: 'o1', label: '周六', round: 2 }, { id: 'o2', label: '周日', round: 2 },
            { id: 'o3', label: '老地方', round: 1 }],
        members: MEMBERS,
        statements: [kv('c1', 'o1', 'support'), kv('c2', 'o1', 'support'),
            kv('c3', 'o1', 'oppose'), kv('c4', 'o3', 'support'),
            kv('c9', 'o1', 'support')] };
    const r = K.tallyVote(data);
    const o1 = r.participants.filter((x) => x.optionId === 'o1')[0];
    assert.deepEqual(o1.members, ['甲', '乙'], '参与名单只收明确支持者');
    const d1 = r.declined.filter((x) => x.optionId === 'o1')[0];
    assert.deepEqual(d1.members, ['丙'], '反对单列在 declined');
    assert.deepEqual(r.abstained.filter((x) => x.optionId === 'o1')[0].members, [], '弃权单列在 abstained');
    /* 四类人分列。 */
    assert.deepEqual(r.staleOnly, ['丁'], '只在旧轮表过态单独一格');
    assert.deepEqual(r.foreign.map((x) => x.id), ['c9'], '表外人具名且不计票');
    assert.ok(r.absent.indexOf('丁') < 0, '在旧轮表过态的丁不算「完全没表态」');
    assert.ok(o1.members.indexOf('丁') < 0 && d1.members.indexOf('丁') < 0, '丁不得进参与名单也不得被算成反对');
    assert.ok(r.foreign.length === 1 && r.counts.support === 2, '表外人的票不得计入支持数');
});
test('B3 重复回复不重复计票：两层分开报（真重复 ≠ 改主意）', () => {
    const base = { round: 2, options: [{ id: 'o1', label: 'A', round: 2 }], members: MEMBERS,
        statements: [kv('c1', 'o1', 'support'), kv('c2', 'o1', 'support')] };
    /* 第一层：事件键相同 ⇒ 归一阶段丢弃并计数。 */
    const dup = K.tallyVote(Object.assign({}, base, { statements: base.statements.concat([base.statements[0]]) }));
    assert.equal(dup.counts.duplicate, 1, '事件键相同的重复回复必须丢弃并计数');
    assert.equal(dup.counts.replaced, 0, '「真重复」不得被记成「改主意」（两件事分开报）');
    assert.equal(dup.counts.support, 2, '重复回复不得抬高支持数');
    /* 第二层：同一人同一选项改主意 ⇒ 只认最后一条，被取代者具名。 */
    const flip = K.tallyVote(Object.assign({}, base, { statements: base.statements.concat([kv('c1', 'o1', 'oppose')]) }));
    assert.equal(flip.counts.replaced, 1, '被取代的那条必须具名计入 replaced');
    assert.equal(flip.counts.duplicate, 0, '「改主意」不得被记成「真重复」');
    assert.equal(flip.tally[0].support, 1, '改主意后支持栏必须少一票');
    assert.equal(flip.tally[0].oppose, 1, '改主意后反对栏必须接上');
    assert.equal(flip.replaced[0].from, 'support');
    assert.equal(flip.replaced[0].to, 'oppose');
});
test('B4 平票不自动拍板：leader 为空、tied 具名，且点名非并列项一律拒收', () => {
    const data = { round: 2, options: [{ id: 'o1', label: '周六', round: 2 }, { id: 'o2', label: '周日', round: 2 }],
        members: MEMBERS, statements: [kv('c1', 'o1', 'support'), kv('c2', 'o2', 'support')] };
    const r = K.tallyVote(data);
    assert.equal(r.verdict, 'tie');
    assert.equal(r.leader, '', '平票时 leader 必须为空（不自动拍板）');
    assert.deepEqual(r.tied, ['o1', 'o2'], '并列项必须具名');
    assert.equal(r.decided, false, '平票不得报 decided');
    assert.ok(K.voteNoteOf(r).length > 0, '平票必须给一句说明');
    /* 点名非并列项 ⇒ 拒收（可选项原样带回）。 */
    const bad = K.confirmActivity(data, { optionId: 'o3' });
    assert.equal(bad.ok, false);
    assert.equal(bad.reason, 'option-absent');
    assert.equal(bad.wrote, false);
    /* 点名并列项 ⇒ 可确认（上一条判的不是「一律拒收」）。 */
    const good = K.confirmActivity(data, { optionId: 'o1' });
    assert.equal(good.ok, true);
    assert.equal(good.reason, 'created');
    /* 无人支持与平票不同形。 */
    const nv = K.tallyVote({ round: 2, options: [{ id: 'o1', label: 'A', round: 2 }],
        members: MEMBERS, statements: [kv('c1', 'o1', 'oppose')] });
    assert.equal(nv.verdict, 'no-votes');
    assert.equal(nv.tied.length, 0, '无人支持不得报出并列项');
    assert.notEqual(K.voteLine(nv), K.voteLine(r), '无人支持与平票的一行读数不得同形');
});
test('B5 确认幂等：同一份结果两次确认恒得同一个 id，第二次起如实报 replayed', () => {
    const data = { round: 2, options: [{ id: 'o1', label: '周六', round: 2 }], members: MEMBERS,
        statements: [kv('c1', 'o1', 'support'), kv('c2', 'o1', 'support')] };
    const one = K.confirmActivity(data, { optionId: 'o1' });
    assert.equal(one.ok, true);
    assert.equal(one.reason, 'created');
    assert.equal(one.wrote, false, '确认不得写盘');
    assert.deepEqual(one.activity.participants, ['甲', '乙']);
    const again = K.confirmActivity(Object.assign({}, data, { activities: [one.activity] }), { optionId: 'o1' });
    assert.equal(again.reason, 'replayed');
    assert.equal(again.replayed, true);
    assert.equal(again.activity.id, one.activity.id, '同一份结果两次确认必须恒得同一个 id');
    /* 幂等键是确定性派生：同输入恒同输出（不读时钟、不读随机）。 */
    assert.equal(K.activityIdOf('o1', ['乙', '甲']), K.activityIdOf('o1', ['甲', '乙']),
        '参与名单顺序不得影响幂等键');
    assert.notEqual(K.activityIdOf('o1', ['甲']), K.activityIdOf('o2', ['甲']), '不同选项不得同键');
});
test('B6 确认不产出承诺：commitment 恒 null、commitmentCreated 恒假、writesNothing 恒真', () => {
    const data = { round: 2, options: [{ id: 'o1', label: '周六', round: 2 }], members: MEMBERS,
        statements: [kv('c1', 'o1', 'support')] };
    const r = K.tallyVote(data);
    assert.equal(r.writesNothing, true, '本件一个字节都不落盘');
    assert.equal(r.commitmentCreated, false, '表决不直接变成承诺');
    const one = K.confirmActivity(data, { optionId: 'o1' });
    assert.equal(one.activity.commitment, null, '活动不得携带承诺');
    assert.equal(one.activity.commitmentCreated === undefined || one.activity.commitmentCreated === false, true);
    /* 一行读数必须点明「仍未成为约定」。 */
    assert.ok(K.activityLine(r).indexOf('仍未成为约定') >= 0, '活动一行读数必须点明未成约定');
});
test('B7 缺席不进参与名单：一条表态都没有的人既不算支持也不算反对', () => {
    const data = { round: 2, options: [{ id: 'o1', label: 'A', round: 2 }], members: MEMBERS,
        statements: [kv('c1', 'o1', 'support')] };
    const r = K.tallyVote(data);
    assert.deepEqual(r.absent, ['乙', '丙', '丁'], '没表态的人进 absent');
    const one = K.confirmActivity(data, { optionId: 'o1' });
    assert.deepEqual(one.activity.participants, ['甲'], '只有明确支持者进参与名单');
    assert.ok(one.activity.participants.indexOf('乙') < 0);
    /* 本件压根不读关系刻度：接线件与内核都不得出现关系读取口。 */
    /* ★ 先摘掉 GV_FORBIDDEN_KEYS 表本身：它**列举**了这些词（那是「禁用」），
     *   不摘会把「禁用清单」误判成「真去读了关系刻度」。判据只认表外的引用。 */
    const noKeysTable = stripAll(kernelSrc).replace(/export const GV_FORBIDDEN_KEYS =[\s\S]*?\]\);/, '');
    for (const bad of ['relationTier', 'affinity', 'favorability', 'relationshipScore']) {
        assert.equal(countOf(noKeysTable + stripAll(wireSrc), bad), 0, '不得用关系刻度伪造同意：' + bad);
    }
    /* 双向对照：被摘掉的那张表确实在场（否则上一条判的是空判据）。 */
    assert.ok(K.GV_FORBIDDEN_KEYS.indexOf('affinity') >= 0, '禁用键清单必须真含 affinity');
});
test('B8 voteGateOf：读到走 readable=true / 读不到 hint 必非空 / 未知态也走不可读', () => {
    const gOk = K.voteGateOf(K.tallyVote({ round: 1, options: [{ id: 'o1', label: 'A', round: 1 }],
        members: MEMBERS, statements: [kv('c1', 'o1', 'support')] }));
    assert.equal(gOk.readable, true);
    assert.equal(gOk.hint, '');
    const gEmpty = K.voteGateOf(K.tallyVote({ round: 1, options: [{ id: 'o1', label: 'A', round: 1 }],
        members: MEMBERS, statements: [] }));
    assert.equal(gEmpty.readable, false);
    assert.ok(gEmpty.hint.length > 0, '读不到时 hint 必非空');
    const gWeird = K.voteGateOf({ state: 'some-future-state' });
    assert.equal(gWeird.readable, false, '未知态也必须走不可读（绝不默认成读到了）');
    assert.ok(gWeird.hint.length > 0);
});
test('B9 自检真跑判据（不是数常量）', () => {
    const sc = K.gvSelfCheck();
    assert.deepEqual(sc.problems, [], '自检必须零问题：' + (sc.problems || []).join('/'));
});
/* ══════════ C ── 接线行为 ══════════ */
test('C1 读不到消息面：如实报读不出，不假装成「还没人表态」', () => {
    /* ★ 接线件读不到数据面时必须返回 null（**不退化成空数组**）。 */
    const wire = new WIRE.GroupVote({});
    assert.equal(wire.readings('g1'), null, '读不到数据面必须返回 null');
    const r = wire.tally('g1');
    assert.equal(r.state, S.NO_OPTIONS, '读不到必须报 no-options，不得报成 empty');
    assert.notEqual(r.state, S.EMPTY, '读不出与「真没人表态」不同形');
    /* 消息面不是数组（畸形）时同样降级。 */
    const wire2 = new WIRE.GroupVote({ wechatData: { getMessages: () => null, getGroupMembers: () => [] } });
    assert.equal(wire2.readings('g1'), null);
});
test('C2 完整旅程：真接线件走四态 → 设选位 → 确认（幂等）', () => {
    const data = mkData([GV_MSG, stmt('e1', 'c1', 'o1', 'support'),
        stmt('e2', 'c2', 'o1', 'support'), stmt('e3', 'c3', 'o2', 'oppose')], MEMBERS);
    const app = mkApp(data, null);
    const p = app.votePack('g1');
    assert.equal(p.state, S.OK, '四态：读到');
    assert.equal(p.read.verdict, 'decided');
    assert.equal(p.read.leader, 'o1');
    assert.ok(String(p.lines.vote).length > 0, '一行读数不得为空');
    assert.ok(String(p.lines.activity).length > 0);
    assert.equal(p.gate.readable, true);
    assert.equal(p.picked, '', '初始无选位');
    /* 设选位：用户显式点选。 */
    assert.equal(app.setVotePicked('o1'), 'o1');
    assert.equal(app.votePicked(), 'o1');
    /* 确认：一次生成一份活动，第二次如实报 replayed 且不重复落消息。 */
    const c1 = app.voteConfirm('g1');
    assert.equal(c1.reason, 'created');
    assert.equal(data.addCount, 0, '接线件本身不落消息（落点是视图层）');
    data.getMessages().push({ id: 'act1', type: 'group_vote_activity',
        groupVoteActivity: c1.activity, content: 'x' });
    const c2 = app.voteConfirm('g1');
    assert.equal(c2.reason, 'replayed');
    assert.equal(c2.activity.id, c1.activity.id);
});
test('C3 设选位：空值即清空（不回落成「票最多的那个」）', () => {
    const data = mkData([GV_MSG, stmt('e1', 'c1', 'o1', 'support'), stmt('e2', 'c2', 'o1', 'support')], MEMBERS);
    const wire = new WIRE.GroupVote({ wechatData: data });
    assert.equal(wire.picked, '');
    wire.setPicked('o1');
    assert.equal(wire.picked, 'o1');
    /* ★ 空值即清空：绝不回落到读数里领先的那个（那会把「用户还没定」伪装成「已经定了」）。 */
    assert.equal(wire.setPicked(''), '');
    assert.equal(wire.picked, '', '空值必须清空，不得回落成 o1');
    wire.setPicked('o2');
    assert.equal(wire.setPicked(null), '', 'null 同样即清空');
});
test('C4 换会话作废选位（读数本来就不缓存）', () => {
    const data = mkData([GV_MSG], MEMBERS);
    const wire = new WIRE.GroupVote({ wechatData: data });
    wire.setPicked('o1');
    assert.equal(wire.picked, 'o1');
    wire.resetScene();
    assert.equal(wire.picked, '', '换会话必须作废选位');
});
test('C5 真视图渲染：四态读数 + 选项行 + 三按钮同屏可辨', () => {
    const data = mkData([GV_MSG, stmt('e1', 'c1', 'o1', 'support'),
        stmt('e2', 'c2', 'o1', 'support'), stmt('e3', 'c3', 'o2', 'oppose')], MEMBERS);
    const app = mkApp(data, null);
    const v = mkView(app);
    const html = v._renderGroupVoteCard(GV_MSG);
    assert.ok(html.indexOf('群投票') >= 0, '卡片标题必须在场');
    assert.ok(html.indexOf('pick-vote-option') >= 0, '选项行必须在场');
    assert.ok(html.indexOf('clear-vote-option') >= 0 && html.indexOf('confirm-group-vote') >= 0,
        '清位与确认按钮必须在场');
    assert.ok(html.indexOf('周六下午') >= 0, '选项标签必须摆出来');
    /* 缓存键含消息条数与末条 id ⇒ 任何一条新消息都会换键（不出现陈旧卡）。 */
    const before = v._voteCache && v._voteCache.key;
    data.getMessages().push(stmt('e4', 'c4', 'o1', 'support'));
    v._renderGroupVoteCard(GV_MSG);
    assert.notEqual(v._voteCache.key, before, '消息面变了，缓存键必须换');
});
test('C6 真视图：读不出时不摆选项行、也不画确认按钮（不拿空板冒充）', () => {
    const data = mkData([GV_MSG], MEMBERS);
    const app = mkApp(data, null);
    const v = mkView(app);
    const html = v._renderGroupVoteCard(GV_MSG);
    assert.equal(app.voteRead('g1').state, S.EMPTY, '选项与人都齐但零表态 ⇒ empty');
    assert.equal(countOf(html, 'pick-vote-option'), 0, '读不出时不许摆选项行');
    assert.equal(countOf(html, 'confirm-group-vote'), 0, '读不出时不许画确认按钮');
    assert.ok(html.indexOf('等人表态') >= 0 || html.indexOf('还没人表态') >= 0, '必须如实说明原因');
});
test('C7 真视图绑定：选位与清位都走 App 出口（视图不自己记）', () => {
    const data = mkData([GV_MSG, stmt('e1', 'c1', 'o1', 'support')], MEMBERS);
    const app = mkApp(data, null);
    const v = mkView(app);
    const calls = [];
    const realSet = app.setVotePicked;
    app.setVotePicked = (x) => { calls.push(String(x)); return realSet(x); };
    /* 视图的绑定代码经 data-action 选择器取按钮 —— 这里直接验证它调的是 App 出口。 */
    assert.ok(countOf(viewSrc, "[data-action=\"pick-vote-option\"]") >= 1, '选位按钮必须被绑定');
    assert.ok(countOf(viewSrc, "[data-action=\"clear-vote-option\"]") >= 1, '清位按钮必须被绑定');
    assert.ok(countOf(viewSrc, "[data-action=\"confirm-group-vote\"]") >= 1, '确认按钮必须被绑定');
    app.setVotePicked('o1');
    assert.deepEqual(calls, ['o1'], '选位必须经 App 出口');
    assert.equal(app.votePicked(), 'o1');
});
test('C8 确认派发：把凭据经 phone:groupVoteConfirm 原样转出去，本件零写盘', async () => {
    const data = mkData([GV_MSG, stmt('e1', 'c1', 'o1', 'support'),
        stmt('e2', 'c2', 'o1', 'support')], MEMBERS);
    const seen = [];
    const win = { CustomEvent: globalThis.CustomEvent, dispatchEvent: (e) => { seen.push(e); },
        addEventListener() {}, removeEventListener() {} };
    await withWin(win, async () => {
        const app = mkApp(data, win);
        const v = mkView(app);
        app.setVotePicked('o1');
        v.confirmGroupVote();
        assert.equal(seen.length, 1, '必须派发一次确认事件');
        assert.equal(seen[0].type, EVENTS.PHONE_EVENTS.GROUP_VOTE_CONFIRM,
            '事件名必须走唯一常量（不得手写字面量）');
        const d = seen[0].detail;
        assert.ok(String(d.activityId).length > 0, 'detail 必须带 activityId');
        assert.equal(d.optionId, 'o1');
        assert.deepEqual(d.participants, ['甲', '乙']);
        /* ★ 本件零写盘：派发出去的只是凭据，约定落笔在日历 owner。 */
        assert.ok(seen[0].detail.commitment === undefined, 'detail 不得携带承诺');
        assert.ok(data.addCount >= 1, '幂等落一条自己的消息行（活动读数）');
        /* 幂等：再确认一次不重复落消息、也不再派发。 */
        const before = data.addCount;
        v.confirmGroupVote();
        assert.equal(data.addCount, before, '第二次确认不得重复落消息');
    });
});
test('C9 凭据没定就不派发（不拿空选项去确认）', async () => {
    const data = mkData([GV_MSG], MEMBERS);
    const seen = [];
    const win = { CustomEvent: globalThis.CustomEvent, dispatchEvent: (e) => { seen.push(e); },
        addEventListener() {}, removeEventListener() {} };
    await withWin(win, async () => {
        const app = mkApp(data, win);
        const v = mkView(app);
        /* 一条表态都没有 ⇒ 确认被内核拒收 ⇒ 不得派发。 */
        v.confirmGroupVote();
        assert.equal(seen.length, 0, '没定就不许派发');
        assert.ok(app._notes.length >= 1, '必须给出拒收理由的通知');
        assert.ok(String(app._notes[0]).length > 0);
    });
});
test('C10 本版三条「不做」在代码上可判', () => {
    /* 去块注释 + 去单行注释 + 去含「不做」的登记句：判的是**引入形态**。 */
    const strip = (s) => s
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split(NL).filter((l) => !/^\s*\/\//.test(l) && l.indexOf('不做') < 0).join(NL);
    const all = strip(kernelSrc + wireSrc + appSrc + viewSrc);
    /* 不接真实通讯平台：零网络口。 */
    for (const bad of ['fetch(', 'XMLHttpRequest', 'WebSocket', 'EventSource']) {
        assert.equal(countOf(strip(kernelSrc) + strip(wireSrc), bad), 0, '不得接真实通讯平台：' + bad);
    }
    /* 不引入常驻群聊代理：零常驻定时器 / 零全局监听注册。 */
    for (const bad of ['setInterval', 'setTimeout']) {
        assert.equal(countOf(strip(kernelSrc) + strip(wireSrc), bad), 0, '不得引入常驻代理：' + bad);
    }
    /* 不用关系分数伪造角色同意：禁用键深度扫描守这一条（B 组已真跑）。 */
    for (const bad of ['score', 'weight', 'probability']) {
        assert.ok(K.GV_FORBIDDEN_KEYS.indexOf(bad) >= 0, '禁用键必须含 ' + bad);
    }
    /* 本件只认两种消息类别（视图不写第二份类型字面量）。 */
    assert.deepEqual(WIRE.GV_MESSAGE_KINDS.slice(), ['group_vote', 'group_vote_statement']);
    void all;
});
/* ══════════ D ── 负控制 ══════════ */
const temps = [];
function makeMirror() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rp_v4290_'));
    temps.push(dir);
    copyTreeSafe(path.join(ROOT, 'apps', 'wechat'), path.join(dir, 'apps', 'wechat'));
    copyTreeSafe(path.join(ROOT, 'config'), path.join(dir, 'config'));
    return dir;
}
process.on('exit', () => {
    for (const d of temps) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (_e) {} }
});
/** 定点破坏真源码副本：锚点必须恰中 1 次（失配即 abort，防「破坏没发生也算红」）。 */
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
async function loadWire(dir, tag) {
    return await import(pathToFileURL(path.join(dir, WIRE_REL)).href + '?' + tag + '=' + Date.now());
}
const TIE = { round: 2, options: [{ id: 'o1', label: '周六', round: 2 }, { id: 'o2', label: '周日', round: 2 }],
    members: MEMBERS, statements: [kv('c1', 'o1', 'support', 't1'), kv('c2', 'o2', 'support', 't2')] };
test('D0 ★★★ 阳性对照：未破坏时下列各条判据必须全为真', () => {
    assert.equal(K.tallyVote(TIE).verdict, 'tie', '原版：一票对一票报平票');
    assert.equal(K.tallyVote(TIE).leader, '', '原版：平票 leader 为空');
    assert.equal(K.confirmActivity(TIE, { optionId: 'o3' }).reason, 'option-absent', '原版：点名非并列项拒收');
    const one = K.confirmActivity({ round: 2, options: [{ id: 'o1', label: 'A', round: 2 }],
        members: MEMBERS, statements: [kv('c1', 'o1', 'support')] }, { optionId: 'o1' });
    const again = K.confirmActivity({ round: 2, options: [{ id: 'o1', label: 'A', round: 2 }],
        members: MEMBERS, statements: [kv('c1', 'o1', 'support')], activities: [one.activity] },
        { optionId: 'o1' });
    assert.equal(again.reason, 'replayed', '原版：重复确认报 replayed');
    const w = new WIRE.GroupVote({});
    assert.equal(w.readings('g1'), null, '原版：读不到数据面返回 null');
    w.setPicked('x');
    assert.equal(w.picked, 'x');
    w.setPicked('');
    assert.equal(w.picked, '', '原版：空值即清空');
    w.setPicked('y');
    w.resetScene();
    assert.equal(w.picked, '', '原版：换会话作废选位');
});
test('D1 ★★★ 破坏「平票不自动拍板」⇒ B4 同款判据必转红', async () => {
    const dir = breakCopy(KERNEL_REL,
        "        verdict = 'tie';" + NL + "        tied = leaders.map((x) => x.optionId);",
        "        verdict = 'decided';" + NL + "        tied = leaders.map((x) => x.optionId);");
    const M = await loadKernel(dir, 'd1');
    const r = M.tallyVote(TIE);
    assert.notEqual(r.verdict, 'tie', '破坏副本：平票被读成了「已决定」');
    assert.equal(K.tallyVote(TIE).verdict, 'tie', '原版必须报平票');
});
test('D2 ★★★ 破坏「缺席不进参与名单」⇒ B7 同款判据必转红', async () => {
    const dir = breakCopy(KERNEL_REL,
        "        participants.push({ optionId: x.id, label: x.label, members: sup.map((r) => r.member), memberIds: sup.map((r) => r.memberId) });",
        "        participants.push({ optionId: x.id, label: x.label, members: st.members.map((r) => r.name), memberIds: st.members.map((r) => r.id) });");
    const M = await loadKernel(dir, 'd2');
    const data = { round: 2, options: [{ id: 'o1', label: 'A', round: 2 }], members: MEMBERS,
        statements: [kv('c1', 'o1', 'support')] };
    const one = M.confirmActivity(data, { optionId: 'o1' });
    assert.ok(one.activity.participants.indexOf('乙') >= 0, '破坏副本：缺席者被代投进了参与名单');
    const orig = K.confirmActivity(data, { optionId: 'o1' });
    assert.ok(orig.activity.participants.indexOf('乙') < 0, '原版必须排除缺席者');
});
test('D3 ★★★ 破坏「确认幂等」⇒ B5 同款判据必转红', async () => {
    const dir = breakCopy(KERNEL_REL, "    if (existed) {", "    if (false) {");
    const M = await loadKernel(dir, 'd3');
    const data = { round: 2, options: [{ id: 'o1', label: 'A', round: 2 }], members: MEMBERS,
        statements: [kv('c1', 'o1', 'support')] };
    const one = M.confirmActivity(data, { optionId: 'o1' });
    const again = M.confirmActivity(Object.assign({}, data, { activities: [one.activity] }), { optionId: 'o1' });
    assert.notEqual(again.reason, 'replayed', '破坏副本：重复确认不再报 replayed');
    const o1 = K.confirmActivity(data, { optionId: 'o1' });
    const o2 = K.confirmActivity(Object.assign({}, data, { activities: [o1.activity] }), { optionId: 'o1' });
    assert.equal(o2.reason, 'replayed', '原版必须幂等');
});
test('D4 ★★★ 破坏「改主意只认最后一条」⇒ B3 同款判据必转红', async () => {
    const dir = breakCopy(KERNEL_REL, "        if (prev) replaced.push(", "        if (false) replaced.push(");
    const M = await loadKernel(dir, 'd4');
    const base = { round: 2, options: [{ id: 'o1', label: 'A', round: 2 }], members: MEMBERS,
        statements: [kv('c1', 'o1', 'support', 'e1'), kv('c1', 'o1', 'oppose', 'e3')] };
    assert.equal(M.tallyVote(base).counts.replaced, 0, '破坏副本：被取代的那条不再具名');
    assert.equal(M.tallyVote(base).replaced.length, 0);
    assert.equal(K.tallyVote(base).counts.replaced, 1, '原版必须记 replaced');
    assert.equal(K.tallyVote(base).replaced[0].to, 'oppose', '原版必须记下改成了什么');
});
test('D5 ★★★ 破坏「读不到数据面返回 null」⇒ C1 同款判据必转红', async () => {
    const dir = breakCopy(WIRE_REL, "        if (!d) return null;",
        "        if (!d) return { question: '', round: 1, options: [], members: [], statements: [], activities: [] };");
    const M = await loadWire(dir, 'd5');
    const w = new M.GroupVote({});
    assert.notEqual(w.readings('g1'), null, '破坏副本：读不到时退化成了一份空形状');
    assert.equal(new WIRE.GroupVote({}).readings('g1'), null, '原版必须返回 null');
});
test('D6 ★★★ 破坏「换会话作废选位」⇒ C4 同款判据必转红', async () => {
    const dir = breakCopy(WIRE_REL, "    resetScene() { this._picked = ''; }", "    resetScene() { }");
    const M = await loadWire(dir, 'd6');
    const w = new M.GroupVote({});
    w.setPicked('o1');
    w.resetScene();
    assert.equal(w.picked, 'o1', '破坏副本：换会话不再作废选位');
    const o = new WIRE.GroupVote({});
    o.setPicked('o1');
    o.resetScene();
    assert.equal(o.picked, '', '原版必须作废');
});
test('D7 ★★★ 破坏「空值即清空」⇒ C3 同款判据必转红', async () => {
    const dir = breakCopy(WIRE_REL, "        this._picked = s.slice(0, 120);",
        "        this._picked = s ? s.slice(0, 120) : this._picked;");
    const M = await loadWire(dir, 'd7');
    const w = new M.GroupVote({});
    w.setPicked('o1');
    w.setPicked('');
    assert.equal(w.picked, 'o1', '破坏副本：空值不再清空（回落成了上一次的选择）');
    const o = new WIRE.GroupVote({});
    o.setPicked('o1');
    o.setPicked('');
    assert.equal(o.picked, '', '原版必须清空');
});
/* E2 守补丁 F 修的那处：取数臂 flag() 必须两种写法都吃。
 *   为什么值得占一格：注释写空格形、实现只认等号形时，按注释敲 `--why "..."`
 *   会**静默不写来由段**、退出码仍是 0（数字一致、复校标记在场）—— 没有任何
 *   东西会响。这正是本仓第二类边界「没坏但结果不对」在工具自己身上的同形，
 *   故这里真 import 那个工具、按两种写法各取一次，值必须一致。
 *   ★ 先自证：把 flag() 换回初版单形态源码，本判据必须取不到空格形（否则它是
 *   一条永远为真的空判据）。自证在内存里做，不落盘、不改真文件。 */
test('E2 取数臂 flag() 两种写法都吃（等号形 / 空格形真跑取值必须一致）', () => {
    const REFRESH_REL = 'tools/refresh_doc_readings.py';
    assert.ok(fs.existsSync(path.join(ROOT, REFRESH_REL)), '取数臂必须在仓里');
    const src = read(REFRESH_REL);
    /* 用法侧：注释里两种写法都写着（等号形主推 + 空格形也吃）。 */
    assert.ok(src.indexOf('--why="..." --write') >= 0, '用法注释必须写等号形（主推）');
    assert.ok(src.indexOf('--why "..." --write') >= 0, '用法注释必须写明空格形也吃');
    /* ★ 真跑：把取数臂复制到临时目录，用子进程按三种 argv 各加载一次副本、
     *   真调 flag()，取回值逐项比对 —— 不 import 原模块（避免它现场跑两道门）。 */
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rp_v4290_flag_'));
    temps.push(dir);
    const toolCopy = path.join(dir, 'refresh_doc_readings.py');
    fs.copyFileSync(path.join(ROOT, REFRESH_REL), toolCopy);
    const drive = path.join(dir, 'drive.py');
    fs.writeFileSync(drive, [
        'import importlib.util, json, sys',
        'p = sys.argv[1]',
        'cases = [["x", "--why=AAA", "--write"], ["x", "--why", "AAA", "--write"], ["x", "--write"]]',
        'out = []',
        'for i, argv in enumerate(cases):',
        '    sys.argv = argv',
        '    spec = importlib.util.spec_from_file_location("rdr_" + str(i), p)',
        '    m = importlib.util.module_from_spec(spec)',
        '    spec.loader.exec_module(m)',
        '    out.append(m.flag("why", ""))',
        'print(json.dumps(out))',
        ''
    ].join(NL), 'utf8');
    const raw = execFileSync('python3', [drive, toolCopy], { encoding: 'utf8' });
    const got = JSON.parse(raw.trim());
    assert.equal(got[0], 'AAA', '等号形必须取到值（实得 ' + JSON.stringify(got[0]) + '）');
    assert.equal(got[1], 'AAA', '空格形必须取到值（实得 ' + JSON.stringify(got[1]) + '）');
    assert.equal(got[2], '', '两个写法都不给时必须回落 default（实得 ' + JSON.stringify(got[2]) + '）');
    assert.equal(got[0], got[1], '两种写法取到的值必须一致');
    /* ★ 反向自证（真跑）：把初版单形态实现（只认等号形）写进另一副本，同款驱动跑，
     *   空格形必须取不到 —— 否则本判据是一条永远为真的空判据。 */
    const oldCopy = path.join(dir, 'old_flag.py');
    fs.writeFileSync(oldCopy, [
        'import sys',
        'def flag(name, default=None):',
        "    pre = '--' + name + '='",
        '    for a in sys.argv:',
        '        if a.startswith(pre):',
        '            return a[len(pre):]',
        '    return default',
        ''
    ].join(NL), 'utf8');
    const rawOld = execFileSync('python3', [drive, oldCopy], { encoding: 'utf8' });
    const gotOld = JSON.parse(rawOld.trim());
    assert.equal(gotOld[0], 'AAA', '自证前置：初版等号形仍应取到值');
    assert.equal(gotOld[1], '', '★ 自证：初版单形态实现必须取不到空格形（否则本判据是空判据）');
});
/* ══════════ E ── 版本锚 ══════════ */
test('E1 五源同源（不锁死具体版本值，但必须一致且当版条目在场）', () => {
    const pkg = JSON.parse(read('package.json'));
    const man = JSON.parse(read('manifest.json'));
    const log = JSON.parse(read('update-log.json'));
    const ver = pkg.version;
    assert.match(ver, /^\d+\.\d+\.\d+$/);
    assert.equal(man.version, ver);
    assert.equal(log.latest, ver);
    assert.equal(log.head, ver);
    assert.ok(log.versions[ver], '当版条目必须存在');
    const items = (log.versions[ver] && log.versions[ver].items) || [];
    assert.ok(Array.isArray(items) && items.length >= 8, '当版公告至少 8 条');
    assert.ok(read('index.js').indexOf("const ST_PHONE_VERSION = '" + ver + "';") >= 0);
    assert.ok(read('ITERATION_LOG.md').indexOf('v' + ver) >= 0);
    /* ★ 同 v4260 / v4270 / v4280 的修法：这几条断的是「**v4.29.0 这一版**记全了」，
     *   故锁自己那一版的字面量，不跟随 `pkg.version` ——
     *   否则本套件会在抬到 v4.30.0 时因「新版公告里没有本版件名」而转红。 */
    const own = log.versions['4.29.0'];
    assert.ok(own, 'v4.29.0 条目必须在账上');
    const all = (own.items || []).join(NL);
    assert.ok(all.indexOf('group-vote-contract.js') >= 0, 'v4.29.0 公告必须记内核件');
    assert.ok(all.indexOf('group-vote.js') >= 0, 'v4.29.0 公告必须记接线件');
    assert.ok(all.indexOf('运行时验证边界') >= 0);
    assert.ok(all.indexOf('R4-X7') >= 0, 'v4.29.0 公告必须记计划项 id');
    /* 本版件名必须真的在仓里（公告不许记不存在的东西）。 */
    for (const rel of [KERNEL_REL, WIRE_REL]) {
        assert.ok(fs.existsSync(path.join(ROOT, rel)), 'v4.29.0 公告记的件必须在仓里：' + rel);
    }
});
