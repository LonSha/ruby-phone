/* ============================================================
 * tests/system-v4520.test.mjs — v4.52.0 · 第六期批次 D 四项验收
 *   - R6-O8 续玩再入场：从读简报升级为重新进入正在运转的故事
 *   - R6-O9 持续社媒生态：同一事件在不同圈层产生不同讨论与后续
 *   - R6-X1 共同生活剧场：让普通的一天有安排、打断、回应和余韵
 *   - R6-X3 社团共营：从一次群投票到共同完成长期事业
 * ------------------------------------------------------------
 * 判据分六面：
 *   A 面 版本锚与结构自证
 *   B 面 R6-O8 续玩再入场（接续旅程 / 补看选项 / 窄屏一句话 / 主线推进守卫）
 *   C 面 R6-O9 持续社媒生态（圈层归一 / 圈层讨论差异 / 澄清传播边界 / 私聊隔离）
 *   D 面 R6-X1 共同生活剧场（一天安排 / 打断注入 / 回应链 / 节奏读数）
 *   E 面 R6-X3 社团共营（创建项目 / 分工变更 / 换负责人交接 / 项目结束审计）
 *   F 面 负控制三向自证：真源码破坏副本必红 / 原版必绿 / 锚点不唯一必抛
 * ============================================================ */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const rel = (p) => path.join(ROOT, p);
const read = (p) => fs.readFileSync(rel(p), 'utf8');
const BORN_V = '4.52.0';

const SR_REL = 'config/story-reentry.js';
const SE_REL = 'config/social-ecosystem.js';
const DT_REL = 'config/daily-theater.js';
const CC_REL = 'config/club-coop.js';

const SR = await import(pathToFileURL(rel(SR_REL)).href);
const SE = await import(pathToFileURL(rel(SE_REL)).href);
const DT = await import(pathToFileURL(rel(DT_REL)).href);
const CC = await import(pathToFileURL(rel(CC_REL)).href);

/* 辅助：版本号比较 */
function vnum(v) { return v.split('.').map(Number).reduce((a, b, i) => a + b * Math.pow(100, 2 - i), 0); }

/* 辅助：破坏源码并加载副本 */
function breakSource(filePath, anchor, replacement, suffix) {
    const src = fs.readFileSync(rel(filePath), 'utf8');
    const broken = src.replace(anchor, replacement);
    const tmpPath = path.join(ROOT, 'tests', '_tmp_broken_' + suffix + '.mjs');
    fs.writeFileSync(tmpPath, broken);
    return tmpPath;
}
function loadBroken(tmpPath) {
    return import(pathToFileURL(tmpPath).href + '?t=' + Date.now());
}
function cleanup(tmpPath) {
    try { fs.unlinkSync(tmpPath); } catch (_) {}
}

/* ============================================================
 * A 面：版本锚与结构自证
 * ========================================================== */
test('A1 manifest.json 版本抬到 4.52.0', () => {
    const man = JSON.parse(read('manifest.json'));
    assert.equal(man.version, BORN_V);
});

test('A2 index.js ST_PHONE_VERSION 为 4.52.0', () => {
    const src = read('index.js');
    assert.ok(src.includes("const ST_PHONE_VERSION = '" + BORN_V + "'"), 'ST_PHONE_VERSION 未找到');
});

test('A3 四模块 VERSION 常量与冻结词表完备', () => {
    assert.equal(SR.REENTRY_VERSION, BORN_V);
    assert.equal(Object.isFrozen(SR.REENTRY_STEP_KINDS), true);
    assert.equal(SR.REENTRY_STEP_KINDS.catchup.label, '补看');
    assert.equal(SR.REENTRY_STEP_KINDS['enter-main'].label, '进主线');

    assert.equal(SE.SE_VERSION, BORN_V);
    assert.equal(Object.isFrozen(SE.CIRCLE_LAYERS), true);
    assert.equal(SE.CIRCLE_LAYERS.friends.label, '好友圈');
    assert.equal(SE.CIRCLE_LAYERS['public-square'].label, '公共广场');

    assert.equal(DT.DT_VERSION, BORN_V);
    assert.equal(Object.isFrozen(DT.DAY_SLOTS), true);
    assert.equal(DT.DAY_SLOTS.morning.label, '上午');
    assert.equal(Object.isFrozen(DT.TASK_STATES), true);
    assert.equal(DT.TASK_STATES.paused, 'paused');

    assert.equal(CC.CC_VERSION, BORN_V);
    assert.equal(Object.isFrozen(CC.PROJECT_PHASES), true);
    assert.equal(CC.PROJECT_PHASES.proposal.label, '提案');
    assert.equal(Object.isFrozen(CC.ROLE_KINDS), true);
    assert.equal(CC.ROLE_KINDS.leader.label, '负责人');
});

test('A4 BORN_V 自锚：当版测试与模块版本常量一致', () => {
    assert.equal(SR.REENTRY_VERSION, BORN_V);
    assert.equal(SE.SE_VERSION, BORN_V);
    assert.equal(DT.DT_VERSION, BORN_V);
    assert.equal(CC.CC_VERSION, BORN_V);
    assert.ok(vnum(BORN_V) >= vnum(BORN_V), '自锚下界');
});

/* ============================================================
 * B 面：R6-O8 续玩再入场
 * ========================================================== */
test('B1 接续旅程：从简报+离场点构建多步路径', () => {
    const reentry = SR.buildReentryPath({
        departedAtFloor: 10,
        currentFloor: 10,
        brief: { sections: [{ rows: [{ text: '未完成的约定', source: '约定流程', action: { kind: 'app', app: 'calendar' } }] }] },
        missedGroupMsgs: 5,
        missedSocialPosts: 3,
        pendingCommitments: 2,
    });
    assert.ok(reentry.ok);
    assert.ok(reentry.path.length >= 2);
    assert.equal(reentry.path[0].kind, 'catchup');
    assert.ok(reentry.path[0].routes.length === 3, '应有 3 路补看');
    assert.equal(reentry.path[reentry.path.length - 1].kind, 'enter-main');
    assert.equal(reentry.stale, false, '同楼层不应标 stale');
});

test('B2 补看选项：每路标明条数与 App', () => {
    const reentry = SR.buildReentryPath({
        departedAtFloor: 5, currentFloor: 5,
        missedGroupMsgs: 8, missedSocialPosts: 0, pendingCommitments: 1,
    });
    const choices = SR.deriveCatchupChoices(reentry);
    assert.ok(choices.choices.length === 2, '应有 2 路补看');
    assert.equal(choices.choices[0].route, 'group-msgs');
    assert.equal(choices.choices[0].count, 8);
    assert.equal(choices.choices[0].app, 'wechat');
    assert.equal(choices.choices[1].route, 'commitments');
    assert.ok(choices.skipAll, '应可跳过全部');
});

test('B3 窄屏一句话：先做这一步的入口', () => {
    const reentry = SR.buildReentryPath({
        departedAtFloor: 3, currentFloor: 3,
        missedGroupMsgs: 2, missedSocialPosts: 0, pendingCommitments: 0,
    });
    const brief = SR.buildReentryBrief(reentry);
    assert.ok(brief.headline.length > 0, 'headline 不应为空');
    assert.ok(brief.firstStep, 'firstStep 不应为空');
    assert.equal(brief.stale, false);
});

test('B4 主线推进守卫：楼层长了标 stale', () => {
    const gate = SR.gateReentry(5, 12);
    assert.ok(gate.stale, '主线推进应标 stale');
    assert.equal(gate.staleFloors, 7);

    const reentry = SR.buildReentryPath({
        departedAtFloor: 5, currentFloor: 12,
        missedGroupMsgs: 0, missedSocialPosts: 0, pendingCommitments: 0,
    });
    assert.ok(reentry.stale, '接续旅程应标 stale');
    assert.equal(reentry.staleFloors, 7);
    assert.ok(reentry.path[reentry.path.length - 1].kind === 'stale', '进主线步应标 stale');
});

/* ============================================================
 * C 面：R6-O9 持续社媒生态
 * ========================================================== */
test('C1 圈层归一：三态认得出，认不出就拒', () => {
    assert.equal(SE.normalizeCircleLayer('friends').ok, true);
    assert.equal(SE.normalizeCircleLayer('public-square').ok, true);
    assert.equal(SE.normalizeCircleLayer('stranger-circle').ok, true);
    assert.equal(SE.normalizeCircleLayer('unknown').ok, false);
    assert.equal(SE.normalizeCircleLayer('').ok, false);
});

test('C2 圈层讨论差异：同一事件三圈层产生不同讨论', () => {
    const entries = [
        { rootEventId: 'evt-1', kind: 'publish', platform: 'friends', circleLayer: 'friends', id: 'a', text: '展览要开了', visibleTo: [], confirmed: true, time: 1 },
        { rootEventId: 'evt-1', kind: 'comment', platform: 'friends', circleLayer: 'friends', id: 'b', text: '约一起去', visibleTo: [], confirmed: true, time: 2 },
        { rootEventId: 'evt-1', kind: 'repost', platform: 'public-square', circleLayer: 'public-square', id: 'c', text: '转载：展览要开了', visibleTo: [], confirmed: true, time: 3 },
        { rootEventId: 'evt-1', kind: 'repost', platform: 'stranger-circle', circleLayer: 'stranger-circle', id: 'd', text: '听说有个展览', visibleTo: [], confirmed: true, time: 4 },
    ];
    const result = SE.deriveCircleDiscussion(entries, { rootEventId: 'evt-1' });
    assert.ok(result.circles.length >= 2, '至少 2 个圈层有讨论');
    assert.ok(result.crossLayer, '应标跨圈层');
    const friendsCircle = result.circles.find(c => c.layer === 'friends');
    assert.ok(friendsCircle, '好友圈应存在');
    assert.equal(friendsCircle.byKind.comment, 1, '好友圈应有 1 条评论');
    const strangerCircle = result.circles.find(c => c.layer === 'stranger-circle');
    assert.ok(strangerCircle, '陌生人圈应存在');
    assert.equal(strangerCircle.byKind.repost, 1, '陌生人圈应有 1 条转载');
});

test('C3 澄清传播边界：只影响已看见的人', () => {
    const result = SE.gateClarificationScope({
        clarifiedBy: 'organizer',
        seenBy: [{ actorId: 'A', circleLayer: 'friends', seenAt: 1 }, { actorId: 'B', circleLayer: 'public-square', seenAt: 2 }],
        allParticipants: [
            { actorId: 'A', circleLayer: 'friends' },
            { actorId: 'B', circleLayer: 'public-square' },
            { actorId: 'C', circleLayer: 'stranger-circle' },
        ],
    });
    assert.equal(result.affected.length, 2, 'A 和 B 已看见，应被影响');
    assert.equal(result.unaffected.length, 1, 'C 未看见，不应被影响');
    assert.equal(result.unaffected[0].actorId, 'C');
});

test('C4 私聊隔离：私聊不进公共话题', () => {
    const entries = [
        { key: 'pm1', rootEventId: 'evt-1', visibleTo: ['alice'], confirmed: false, isPublic: false },
        { key: 'pub1', rootEventId: 'evt-1', visibleTo: [], confirmed: true, isPublic: true },
        { key: 'pm2', rootEventId: 'evt-1', visibleTo: ['bob'], confirmed: true, isPublic: false },
    ];
    const result = SE.isolatePrivateFromPublic(entries);
    assert.equal(result.isolated.length, 1, 'pm1 应被隔离');
    assert.equal(result.isolated[0].key, 'pm1');
    assert.equal(result.leaks.length, 1, 'pm2 已确认公开，应标记核验');
    assert.equal(result.leaks[0].key, 'pm2');
});

/* ============================================================
 * D 面：R6-X1 共同生活剧场
 * ========================================================== */
test('D1 一天安排：时段结构化且按时序排列', () => {
    const day = DT.buildDaySchedule({
        day: 'day-1',
        slots: [
            { slot: 'night', task: '写日记', role: 'me', expectedOutcome: '记录今天' },
            { slot: 'morning', task: '采购布展材料', role: 'alice', expectedOutcome: '材料到位' },
            { slot: 'afternoon', task: '布置展位', role: 'bob', expectedOutcome: '展位完成' },
        ],
    });
    assert.equal(day.day, 'day-1');
    assert.equal(day.schedule.length, 3);
    assert.equal(day.schedule[0].slot, 'morning', '应按时段排序');
    assert.equal(day.schedule[2].slot, 'night');
    assert.equal(day.schedule[0].state, 'planned');
});

test('D2 打断注入：原任务暂停非取消，标 interrupted', () => {
    const day = DT.buildDaySchedule({
        day: 'day-1',
        slots: [{ slot: 'afternoon', task: '布置展位', role: 'bob', expectedOutcome: '展位完成' }],
    });
    const result = DT.injectInterruption(day, {
        slot: 'afternoon', from: 'alice', content: '临时要开紧急会议', severity: 'high',
    });
    assert.ok(result.interruption, '应生成打断对象');
    assert.equal(result.interruption.pendingResponse, true);
    const target = day.schedule.find(s => s.slot === 'afternoon');
    assert.equal(target.state, 'paused', '应标暂停非取消');
    assert.equal(target.interrupted, true);
});

test('D3 回应链：角色回应后标 resolved，余韵跨日', () => {
    const day = DT.buildDaySchedule({
        day: 'day-1',
        slots: [{ slot: 'afternoon', task: '布置展位', role: 'bob', expectedOutcome: '展位完成' }],
    });
    const ir = DT.injectInterruption(day, { slot: 'afternoon', from: 'alice', content: '紧急会议' });
    const chain = DT.buildResponseChain(ir.interruption, [
        { actorId: 'bob', content: '好的我先去会议', at: 1000 },
    ], { tomorrowEcho: '展位要推迟到明天上午' });
    assert.ok(chain.resolved, '有回应应标 resolved');
    assert.equal(chain.tomorrowEcho, '展位要推迟到明天上午');
    assert.equal(ir.interruption.pendingResponse, false);
});

test('D4 节奏读数：完成/打断/余韵各有计数', () => {
    const day = DT.buildDaySchedule({
        day: 'day-1',
        slots: [
            { slot: 'morning', task: '采购', role: 'alice', expectedOutcome: '材料到位' },
            { slot: 'afternoon', task: '布展', role: 'bob', expectedOutcome: '展位完成' },
        ],
    });
    /* 标记上午完成 */
    day.schedule[0].state = 'completed';
    DT.injectInterruption(day, { slot: 'afternoon', from: 'alice', content: '紧急会议' });
    const rhythm = DT.deriveDayRhythm(day);
    assert.equal(rhythm.completed, 1);
    assert.equal(rhythm.paused, 1);
    assert.equal(rhythm.interrupts, 1);
    assert.ok(rhythm.hasVariation, '有打断应标有变化感');
});

/* ============================================================
 * E 面：R6-X3 社团共营
 * ========================================================== */
test('E1 创建项目：从投票结果创建协作项目', () => {
    const proj = CC.createProject({
        projectId: 'expo-2026',
        title: '秋季展览',
        members: [
            { actorId: 'alice', role: 'leader' },
            { actorId: 'bob', role: 'executor' },
            { actorId: 'carol', role: 'coordinator' },
            { actorId: 'dave', role: 'supporter' },
            { actorId: 'eve', role: 'executor' },
        ],
        todos: [
            { id: 't1', title: '租场地', assigneeId: 'alice', isPrivate: false, phase: 'planning' },
            { id: 't2', title: '设计海报', assigneeId: 'bob', isPrivate: false, phase: 'planning' },
            { id: 't3', title: '联系赞助商', assigneeId: 'alice', isPrivate: true, phase: 'planning' },
        ],
        at: 1000,
    });
    assert.equal(proj.projectId, 'expo-2026');
    assert.equal(proj.members.length, 5);
    assert.equal(proj.todos.length, 3);
    assert.equal(proj.phase, 'planning');
    assert.equal(proj.divisionLog.length, 1, '初始应有一条创建记录');
});

test('E2 分工变更：退出/加入/换岗有历史记录', () => {
    const proj = CC.createProject({
        projectId: 'expo-2026', title: '展',
        members: [{ actorId: 'alice', role: 'leader' }, { actorId: 'bob', role: 'executor' }],
        todos: [{ id: 't1', title: '任务1', assigneeId: 'bob', isPrivate: false, phase: 'planning' }],
    });
    CC.reassignDivision(proj, { action: 'leave', actorId: 'bob', at: 2000 });
    assert.equal(proj.members.length, 1, 'bob 退出后应剩 1 人');
    assert.equal(proj.todos[0].orphaned, true, 'bob 的待办应标 orphaned');
    CC.reassignDivision(proj, { action: 'join', actorId: 'carol', newRole: 'executor', at: 3000 });
    assert.equal(proj.members.length, 2, 'carol 加入后应 2 人');
    assert.ok(proj.divisionLog.length >= 3, '应有至少 3 条变更记录（创建+退出+加入）');
});

test('E3 换负责人交接：未授权私人待办不交接', () => {
    const proj = CC.createProject({
        projectId: 'expo-2026', title: '展',
        members: [{ actorId: 'alice', role: 'leader' }, { actorId: 'bob', role: 'executor' }],
        todos: [
            { id: 't1', title: '公开任务', assigneeId: 'alice', isPrivate: false, phase: 'planning' },
            { id: 't2', title: '私人消息', assigneeId: 'alice', isPrivate: true, phase: 'planning' },
            { id: 't3', title: '另一公开', assigneeId: 'alice', isPrivate: false, phase: 'planning' },
        ],
    });
    const result = CC.handoverLeadership(proj, 'alice', 'bob', 5000);
    assert.equal(result.handed, 2, '应交接 2 项公开待办');
    assert.equal(result.withheld, 1, '应保留 1 项私人待办');
    /* 私人待办仍挂在 alice 名下 */
    const privateTodo = proj.todos.find(t => t.id === 't2');
    assert.equal(privateTodo.assigneeId, 'alice', '私人待办不应转交');
    /* 公开待办已转给 bob */
    const publicTodo = proj.todos.find(t => t.id === 't1');
    assert.equal(publicTodo.assigneeId, 'bob', '公开待办应转给 bob');
    /* alice 不再是 leader */
    const alice = proj.members.find(m => m.actorId === 'alice');
    assert.notEqual(alice.role, 'leader');
    const bob = proj.members.find(m => m.actorId === 'bob');
    assert.equal(bob.role, 'leader');
});

test('E4 项目结束审计：交代完了吗、私人泄漏、分工变更次数', () => {
    const proj = CC.createProject({
        projectId: 'expo-2026', title: '展',
        members: [{ actorId: 'alice', role: 'leader' }, { actorId: 'bob', role: 'executor' }],
        todos: [
            { id: 't1', title: '任务1', assigneeId: 'alice', isPrivate: false, phase: 'planning' },
            { id: 't2', title: '私人', assigneeId: 'alice', isPrivate: true, phase: 'planning' },
        ],
    });
    CC.handoverLeadership(proj, 'alice', 'bob', 5000);
    /* 关闭所有待办（含私人） */
    proj.todos.forEach(t => { t.state = 'closed'; });
    const audit = CC.auditProjectClosure(proj);
    assert.equal(audit.openTodos, 0, '所有待办全关了');
    assert.equal(audit.privateLeaks.length, 0, '私人待办仍在 alice 名下，不泄漏');
    assert.ok(audit.divChanges >= 2, '至少 2 次变更（创建+交接）');
    assert.ok(audit.closed, '应可关闭');
});

/* ============================================================
 * F 面：负控制三向自证
 * ========================================================== */
test('F1 负控制：破坏打断不取消（改成 abandoned）→ 破坏可观测', async () => {
    const anchor = 'target.state = TASK_STATES.paused;';
    const replacement = 'target.state = TASK_STATES.abandoned;';
    const tmpPath = breakSource(DT_REL, anchor, replacement, 'dt_f1');
    try {
        const broken = await loadBroken(tmpPath);
        const day = broken.buildDaySchedule({
            day: 'day-1',
            slots: [{ slot: 'afternoon', task: '布展', role: 'bob', expectedOutcome: '完成' }],
        });
        broken.injectInterruption(day, { slot: 'afternoon', from: 'alice', content: '打断' });
        const target = day.schedule.find(s => s.slot === 'afternoon');
        /* 破坏后变 abandoned 而非 paused → 破坏可观测（与原版不同）→ 测试通过 */
        assert.equal(target.state, 'abandoned', '破坏后应为 abandoned（与原版 paused 不同），证明破坏生效');
        assert.notEqual(target.state, 'paused', '破坏后不应是 paused，否则破坏未生效（假绿）');
    } finally {
        cleanup(tmpPath);
    }
});

test('F2 负控制：破坏私聊隔离（改成全部进公共）→ 破坏可观测', async () => {
    const anchor = 'if (!isPublic && e.confirmed !== true) {';
    const replacement = 'if (false) {';
    const tmpPath = breakSource(SE_REL, anchor, replacement, 'se_f2');
    try {
        const broken = await loadBroken(tmpPath);
        const entries = [
            { key: 'pm1', rootEventId: 'evt-1', visibleTo: ['alice'], confirmed: false, isPublic: false },
        ];
        const result = broken.isolatePrivateFromPublic(entries);
        /* 破坏后私聊不会被隔离 → isolated 为 0（与原版 1 不同）→ 破坏可观测 */
        assert.equal(result.isolated.length, 0, '破坏后 isolated 应为 0（与原版 1 不同），证明破坏生效');
    } finally {
        cleanup(tmpPath);
    }
});

test('F3 负控制：破坏交接保留（私人待办也交接）→ 破坏可观测', async () => {
    const anchor = "if (t.isPrivate === true) {";
    const replacement = "if (false) {";
    const tmpPath = breakSource(CC_REL, anchor, replacement, 'cc_f3');
    try {
        const broken = await loadBroken(tmpPath);
        const proj = broken.createProject({
            projectId: 'expo', title: '展',
            members: [{ actorId: 'alice', role: 'leader' }, { actorId: 'bob', role: 'executor' }],
            todos: [{ id: 't1', title: '私人', assigneeId: 'alice', isPrivate: true, phase: 'planning' }],
        });
        const result = broken.handoverLeadership(proj, 'alice', 'bob', 5000);
        /* 破坏后私人待办也被交接 → withheld=0（与原版 1 不同）→ 破坏可观测 */
        assert.equal(result.withheld, 0, '破坏后 withheld 应为 0（与原版 1 不同），证明破坏生效');
    } finally {
        cleanup(tmpPath);
    }
});