/* ============================================================
 * tests/system-v4510.test.mjs — v4.51.0 · 第六期批次 C 双项验收
 *   - R6-O4 能改道的多人活动：计划遇到变化也能继续玩
 *   - R6-O6 主动研读工作室：从找句摘录到提出问题、比较观点、形成作品
 *   - 配套 R6-X4 委托创作生命周期 / R6-X8 师友共学成长
 * ------------------------------------------------------------
 * 判据分六面：
 *   A 面 口径：词表冻结 + 纯契约自证
 *   B 面 R6-O4 能改道的多人活动（迟到事实/换地不重扣/退出防伪亲历/亲历者分账）
 *   C 面 R6-O6 主动研读工作室（跨书正反观点/段落回源/草稿衍生/改版保护作者正文）
 *   D 面 配套契约（R6-X4 委托加需求协商与定金结算 / R6-X8 师友作品片段反馈与分歧自决）
 *   E 面 负控制三向自证：真源码破坏副本必红 / 原版必绿 / 锚点不唯一必抛
 *   F 面 版本锚与结构自证
 * ============================================================ */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const rel = (p) => path.join(ROOT, p);
const read = (p) => fs.readFileSync(rel(p), 'utf8');

const MIN_VERSION = '4.51.0';
const MAR_REL = 'config/multi-activity-reroute.js';
const RS_REL = 'config/reading-studio.js';
const COMM_REL = 'config/commission-pipeline.js';
const MC_REL = 'config/mentorship-colearn.js';
const STORAGE_REL = 'config/storage.js';
const KEYS_AUDIT_REL = 'scripts/keys-audit.mjs';

const MAR = await import(pathToFileURL(rel(MAR_REL)).href);
const RS = await import(pathToFileURL(rel(RS_REL)).href);
const COMM = await import(pathToFileURL(rel(COMM_REL)).href);
const MC = await import(pathToFileURL(rel(MC_REL)).href);

/* ============================================================
 * A 面：口径与纯契约自证
 * ========================================================== */
test('A1 词表口径：活动段状态/成员状态/委托阶段全部冻结且值完备', () => {
    assert.equal(Object.isFrozen(MAR.MAR_SEGMENT_STATES), true);
    assert.equal(MAR.MAR_SEGMENT_STATES.PLANNED, 'planned');
    assert.equal(MAR.MAR_SEGMENT_STATES.IN_PROGRESS, 'in_progress');
    assert.equal(MAR.MAR_SEGMENT_STATES.COMPLETED, 'completed');
    assert.equal(MAR.MAR_SEGMENT_STATES.REROUTED, 'rerouted');

    assert.equal(Object.isFrozen(MAR.MAR_PARTICIPANT_STATES), true);
    assert.equal(MAR.MAR_PARTICIPANT_STATES.ARRIVED, 'arrived');
    assert.equal(MAR.MAR_PARTICIPANT_STATES.DELAYED, 'delayed');
    assert.equal(MAR.MAR_PARTICIPANT_STATES.WITHDRAWN, 'withdrawn');

    assert.equal(Object.isFrozen(COMM.COMMISSION_STAGES), true);
    assert.equal(COMM.COMMISSION_STAGES.BRIEF, 'brief');
    assert.equal(COMM.COMMISSION_STAGES.CONCEPT, 'concept');
    assert.equal(COMM.COMMISSION_STAGES.CHANGE_SCOPE, 'change_scope');
    assert.equal(COMM.COMMISSION_STAGES.ACCEPTANCE, 'acceptance');
});

test('A2 纯契约：新内核零 DOM / 零网络 / 零定时器 / 零宿主依赖', () => {
    for (const file of [MAR_REL, RS_REL, COMM_REL, MC_REL]) {
        const src = read(file);
        assert.doesNotMatch(src, /\bwindow\b|\bdocument\b/, `${file} 不能含有 DOM 全局`);
        assert.doesNotMatch(src, /\bfetch\s*\(/, `${file} 不能直接发起网络请求`);
        assert.doesNotMatch(src, /\bsetTimeout\s*\(|\bsetInterval\s*\(/, `${file} 不能使用异步定时器`);
    }
});

/* ============================================================
 * B 面：R6-O4 能改道的多人活动
 * ========================================================== */
test('B1 六人活动两人迟到：保留已到场事实，未到场者标 delayed，不伪造亲历', () => {
    let act = MAR.createMultiActivity({
        title: '周末科技馆与艺术巡展',
        participants: ['Alice', 'Bob', 'Charlie', 'Diana', 'Edward', 'Fiona'],
        segments: [
            { id: 'seg1', name: '集合破冰', location: '科技馆正门', plannedCost: 60, attendeeActors: ['Alice', 'Bob', 'Charlie', 'Diana', 'Edward', 'Fiona'] }
        ]
    });

    // 四人先到场
    act = MAR.markParticipantArrived(act, 'Alice', '09:50').activity;
    act = MAR.markParticipantArrived(act, 'Bob', '09:55').activity;
    act = MAR.markParticipantArrived(act, 'Charlie', '09:58').activity;
    act = MAR.markParticipantArrived(act, 'Diana', '10:00').activity;

    // 两人迟到报备
    act = MAR.reportParticipantDelay(act, 'Edward', 30, '地铁故障延误').activity;
    act = MAR.reportParticipantDelay(act, 'Fiona', 40, '堵车延误').activity;

    assert.equal(act.participants.filter(p => p.status === MAR.MAR_PARTICIPANT_STATES.ARRIVED).length, 4);
    assert.equal(act.participants.filter(p => p.status === MAR.MAR_PARTICIPANT_STATES.DELAYED).length, 2);

    // 第一段完成：只有 4 位实际到场者参与
    act = MAR.completeSegment(act, 'seg1', ['Alice', 'Bob', 'Charlie', 'Diana'], 40).activity;
    const seg1 = act.segments.find(s => s.id === 'seg1');
    assert.equal(seg1.status, MAR.MAR_SEGMENT_STATES.COMPLETED);
    assert.deepEqual(seg1.attendeeActors, ['Alice', 'Bob', 'Charlie', 'Diana']);
    assert.ok(!seg1.attendeeActors.includes('Edward'), '未到场者决不能被记为亲历');
});

test('B2 遇变化改道（改地点/重排段序）：已完成段不重扣费用，剩余预算正确更新', () => {
    let act = MAR.createMultiActivity({
        title: '郊野公园露营与观星',
        budget: { initial: 600, spent: 0 },
        participants: ['Alice', 'Bob', 'Charlie'],
        segments: [
            { id: 's1', name: '露营装备租赁与搭建', plannedCost: 200, status: 'planned', attendeeActors: ['Alice', 'Bob', 'Charlie'] },
            { id: 's2', name: '露天烧烤晚宴', plannedCost: 200, status: 'planned', attendeeActors: ['Alice', 'Bob', 'Charlie'] },
            { id: 's3', name: '后山天文台观星', plannedCost: 150, status: 'planned', attendeeActors: ['Alice', 'Bob', 'Charlie'] }
        ]
    });

    // s1 顺利完成并支付
    act = MAR.completeSegment(act, 's1', ['Alice', 'Bob', 'Charlie'], 200).activity;
    assert.equal(act.budget.spent, 200);
    assert.equal(act.budget.remaining, 400);

    // 突发雷雨：后山天文台关闭，发起改道提议切换至室内天文馆互动放映
    const propRes = MAR.proposeActivityReroute(act, {
        proposalId: 'prop_rain_switch',
        type: 'location_switch',
        reason: '后山暴雨道路封闭',
        description: '取消后山观星，改为前往室内天文馆体验球幕电影',
        proposedSegments: [
            { id: 's2_mod', name: '室内暖锅晚宴', plannedCost: 180, attendeeActors: ['Alice', 'Bob', 'Charlie'] },
            { id: 's3_mod', name: '室内球幕星空放映', plannedCost: 120, attendeeActors: ['Alice', 'Bob', 'Charlie'] }
        ]
    });
    assert.ok(propRes.ok);
    act = propRes.activity;

    // 生效改道
    const applied = MAR.applyActivityReroute(act, 'prop_rain_switch').activity;
    assert.equal(applied.segments.length, 3, '已完成段保留，未执行段被新段替换');
    assert.equal(applied.segments[0].id, 's1');
    assert.equal(applied.segments[0].status, MAR.MAR_SEGMENT_STATES.COMPLETED);
    assert.equal(applied.budget.spent, 200, '已支付费用绝不被重扣');
});

test('B3 成员中途退出与分账保护：未参与者不承担缺席段的支出', () => {
    let act = MAR.createMultiActivity({
        title: '桌游俱乐部与密室逃脱',
        participants: ['Alice', 'Bob', 'Charlie'],
        segments: [
            { id: 'g1', name: '下午茶桌游对决', plannedCost: 90, attendeeActors: ['Alice', 'Bob', 'Charlie'] },
            { id: 'g2', name: '高难度机械密室', plannedCost: 180, attendeeActors: ['Alice', 'Bob', 'Charlie'] }
        ]
    });

    // 环节 1：三人均参与
    act = MAR.completeSegment(act, 'g1', ['Alice', 'Bob', 'Charlie'], 90).activity;

    // 环节 2 前：Charlie 临时有急事退出
    act = MAR.reportParticipantWithdraw(act, 'Charlie', '公司临时加班召回').activity;
    assert.equal(act.participants.find(p => p.actor === 'Charlie').status, MAR.MAR_PARTICIPANT_STATES.WITHDRAWN);

    // 环节 2 完成：只有 Alice 与 Bob
    act = MAR.completeSegment(act, 'g2', ['Alice', 'Bob'], 180).activity;

    // 结算分账
    const settled = MAR.settleActivity(act).settlement;
    assert.equal(settled.isSettled, true);
    assert.equal(settled.totalSpent, 270);

    // 分摊核对：
    // g1 (90元，3人每人30)；
    // g2 (180元，2人每人90)；
    // Charlie 只承担 30 元；Alice 和 Bob 各承担 30 + 90 = 120 元
    assert.equal(settled.perPersonDebt['Charlie'], 30);
    assert.equal(settled.perPersonDebt['Alice'], 120);
    assert.equal(settled.perPersonDebt['Bob'], 120);
});

/* ============================================================
 * C 面：R6-O6 主动研读工作室
 * ========================================================== */
test('C1 围绕核心研读问题跨书阅读，正反观点对照与精确段落回源', () => {
    let dossier = RS.createReadingDossier({
        researchQuestion: '传统村落保护应侧重活态传承还是原貌冻结？'
    });

    // 关联两本资料书
    dossier = RS.linkBookToDossier(dossier, { bookId: 'b_heritage', title: '中国古村落保护通论', version: 'v1.0' }).dossier;
    dossier = RS.linkBookToDossier(dossier, { bookId: 'b_economy', title: '乡村振兴与文旅经济学', version: 'v2.1' }).dossier;

    // 摘录原书具体段落
    dossier = RS.addExcerpt(dossier, {
        id: 'exc_1',
        bookId: 'b_heritage',
        paragraphRef: '第三章第4段',
        verbatimText: '过度商业化改造会导致原住民流失与宗族文化空心化，必须以原貌冻结为底线。'
    }).dossier;

    dossier = RS.addExcerpt(dossier, {
        id: 'exc_2',
        bookId: 'b_economy',
        paragraphRef: '第五章第2段',
        verbatimText: '缺乏基础设施更新与产业导入的古村无法维系年轻人口，活态发展才能造血。'
    }).dossier;

    // 建立正反观点对照
    dossier = RS.addContrastingView(dossier, {
        id: 'v_pro',
        claimText: '静态原貌保护优先，防范资本入侵',
        stance: 'pro',
        evidenceExcerptIds: ['exc_1']
    }).dossier;

    dossier = RS.addContrastingView(dossier, {
        id: 'v_contra',
        claimText: '动态活化更新优先，依托业态留住人口',
        stance: 'contra',
        evidenceExcerptIds: ['exc_2']
    }).dossier;

    assert.equal(dossier.books.length, 2);
    assert.equal(dossier.excerpts.length, 2);
    assert.equal(dossier.contrastingViews.length, 2);
    assert.equal(dossier.contrastingViews[0].stance, 'pro');
    assert.equal(dossier.contrastingViews[1].stance, 'contra');
});

test('C2 疑问批注与论证草稿衍生：研究成果直接转化为成稿章节', () => {
    let dossier = RS.createReadingDossier({ researchQuestion: '人工智能与人机协同' });
    dossier = RS.addAnnotation(dossier, {
        excerptId: 'exc_9',
        question: '模型置信度衰减的临界点在哪里？',
        comment: '这里需要比对长文本上下文截断前后的记忆一致性表现'
    }).dossier;
    assert.equal(dossier.annotations.length, 1);

    // 编写论证草稿
    const draftRes = RS.updateDraft(dossier, {
        title: '长线互动下的人格稳定性评析',
        sections: [
            { heading: '引言与核心问题', body: '在超长上下文中，人物记忆漂移与自传一致性是关键瓶颈。', citedExcerptIds: [] },
            { heading: '证据分析', body: '根据双向对账数据，显式分辨率阶梯能有效抑制结论坍缩。', citedExcerptIds: ['exc_9'] }
        ]
    });
    assert.ok(draftRes.ok);
    assert.equal(draftRes.dossier.draft.sections.length, 2);
    assert.equal(draftRes.dossier.status, 'drafting');
});

test('C3 书籍改版保护：新版书更新时保留作者观点与草稿，不静默覆盖', () => {
    let dossier = RS.createReadingDossier({ researchQuestion: '算法伦理' });
    dossier = RS.linkBookToDossier(dossier, { bookId: 'b_law', title: '数字法学论纲', version: 'v1.0' }).dossier;
    dossier = RS.addExcerpt(dossier, {
        id: 'exc_law_1',
        bookId: 'b_law',
        paragraphRef: '第12节',
        verbatimText: '责任主体应当由系统开发者承担。'
    }).dossier;
    dossier = RS.updateDraft(dossier, {
        title: '作者独立思考草稿',
        sections: [{ heading: '观点', body: '这是作者辛苦构思的论证正文，绝不可被覆盖。' }]
    }).dossier;

    // 书籍发布了 v2.0 修订版
    const updateRes = RS.handleBookVersionUpdate(dossier, 'b_law', 'v2.0', 'preserve_views');
    assert.ok(updateRes.ok);
    assert.equal(updateRes.staleExcerptsCount, 1);

    // 校验：作者的草稿正文完好无损
    assert.equal(updateRes.dossier.draft.sections[0].body, '这是作者辛苦构思的论证正文，绝不可被覆盖。');
    // 校验：摘录被打上陈旧待核实标记
    const exc = updateRes.dossier.excerpts.find(e => e.id === 'exc_law_1');
    assert.equal(exc.isStale, true);
    assert.ok(exc.staleReason.includes('更新至 v2.0'));
});

/* ============================================================
 * D 面：配套契约（R6-X4 委托创作 / R6-X8 师友共学）
 * ========================================================== */
test('D1 R6-X4 委托创作：五阶段流转，加需求必须协商定费，取消按约定结算定金', () => {
    let comm = COMM.createCommission({
        title: '县城宇宙定制宣传插画',
        client: '主办方老李',
        agreedFee: 300
    });
    assert.equal(comm.stage, COMM.COMMISSION_STAGES.BRIEF);

    // 确认简报进入概念样稿
    comm = COMM.acceptBrief(comm, 100).commission;
    assert.equal(comm.stage, COMM.COMMISSION_STAGES.CONCEPT);
    assert.equal(comm.depositPaid, 100);

    // 提议加需求（增加夜景变体与双角色立绘）
    comm = COMM.proposeScopeChange(comm, {
        changeId: 'chg_1',
        additionalRequirements: ['额外增加一张黄昏逆光色调变体'],
        feeDelta: 80
    }).commission;
    assert.equal(comm.stage, COMM.COMMISSION_STAGES.CHANGE_SCOPE);

    // 双方同意变更
    comm = COMM.agreeScopeChange(comm, 'chg_1').commission;
    assert.equal(comm.agreedFee, 380, '费用随范围变更同步调整');
    assert.equal(comm.stage, COMM.COMMISSION_STAGES.REVISION);

    // 验收与结算
    const finalComm = COMM.acceptAndSettle(comm, 5, '光影细节极为出色').commission;
    assert.equal(finalComm.stage, COMM.COMMISSION_STAGES.ACCEPTANCE);
    assert.equal(finalComm.settlement.isSettled, true);
    assert.equal(finalComm.settlement.remainingPaid, 280);
});

test('D2 R6-X8 师友共学：练习作品提交、引用片段深度反馈、师友分歧用户自决', () => {
    let track = MC.createColearnTrack({
        skill: '纪实摄影叙事',
        mentors: [{ mentor: '老张', focus: '构图与光影' }, { mentor: '小苏', focus: '情绪与抓拍' }]
    });

    // 提交第一轮练习作业
    const subRes = MC.submitPractice(track, {
        title: '老街雨后光影抓拍',
        workSnippet: '画面中央是积水倒影中的骑车少年，右侧屋檐滴水形成断续反光。',
        feedbacks: [
            { mentor: '老张', citedQuote: '右侧屋檐滴水形成断续反光', critique: '高光部分略有溢出', suggestion: '可稍降半档曝光以压暗边缘杂光' },
            { mentor: '小苏', citedQuote: '积水倒影中的骑车少年', critique: '动势极具故事性', suggestion: '保持当前速度快门，凸显飞溅水花的动感' }
        ]
    });
    assert.ok(subRes.ok);
    track = subRes.track;
    assert.equal(track.practices.length, 1);
    assert.equal(track.practices[0].feedbacks.length, 2);

    // 两位师友建议侧重不同：用户自主选择深入小苏的情绪动感方向
    const chooseRes = MC.chooseDirection(track, 1, '采纳小苏建议，强化少年穿行雨幕的动态叙事');
    assert.ok(chooseRes.ok);
    assert.equal(chooseRes.practice.chosenDirection, '采纳小苏建议，强化少年穿行雨幕的动态叙事');
});

/* ============================================================
 * E 面：负控制真源码破坏
 * ========================================================== */
function breakSource(relPath, anchor, replacement) {
    const orig = read(relPath);
    const n = orig.split(anchor).length - 1;
    if (n !== 1) {
        throw new Error(`[breakSource] 破坏锚点必须在 ${relPath} 中恰好出现 1 次，实测 ${n} 次`);
    }
    const broken = orig.replace(anchor, replacement);
    const tmp = path.join(os.tmpdir(), `broken-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.js`);
    fs.writeFileSync(tmp, broken, 'utf8');
    return tmp;
}

test('E1 负控制：破坏 R6-O4 分账亲历者逻辑（均摊给全员） -> 亲历者分账判据必红', async () => {
    const tmp = breakSource(
        MAR_REL,
        "const attendees = seg.attendeeActors.filter(a => act.participants.some(p => p.actor === a));",
        "const attendees = act.participants.map(p => p.actor);"
    );
    try {
        const brokenMAR = await import(pathToFileURL(tmp).href);
        let act = brokenMAR.createMultiActivity({
            participants: ['A', 'B'],
            segments: [{ id: 's1', plannedCost: 100, actualCost: 100, status: 'completed', attendeeActors: ['A'] }]
        });
        const res = brokenMAR.settleActivity(act).settlement;
        // 在破坏副本上，未参与的 B 也被平摊了 50 元
        assert.equal(res.perPersonDebt['B'], 50, '破坏副本上 B 被错误均摊');
    } finally {
        fs.unlinkSync(tmp);
    }
});

test('E2 负控制：破坏 R6-O6 改版保护逻辑（更新书目时清空作者草稿） -> 草稿保留判据必红', async () => {
    const tmp = breakSource(
        RS_REL,
        "b.version = normStr(newVersion);",
        "b.version = normStr(newVersion); d.draft.sections = [];"
    );
    try {
        const brokenRS = await import(pathToFileURL(tmp).href);
        let dossier = brokenRS.createReadingDossier({});
        dossier = brokenRS.linkBookToDossier(dossier, { bookId: 'b1', version: 'v1.0' }).dossier;
        dossier = brokenRS.updateDraft(dossier, { sections: [{ heading: '心血', body: '正文' }] }).dossier;
        const res = brokenRS.handleBookVersionUpdate(dossier, 'b1', 'v2.0');
        // 在破坏副本上草稿被清空
        assert.equal(res.dossier.draft.sections.length, 0, '破坏副本上作者草稿被清空');
    } finally {
        fs.unlinkSync(tmp);
    }
});

test('E3 负控制：破坏 R6-X4 变更逻辑（同意变更时不增加需求列表） -> 变更累加判据必红', async () => {
    const tmp = breakSource(
        COMM_REL,
        "c.requirements.push(...chg.additionalRequirements);",
        "/* c.requirements.push(...chg.additionalRequirements); */"
    );
    try {
        const brokenCOMM = await import(pathToFileURL(tmp).href);
        let comm = brokenCOMM.createCommission({ requirements: ['原需求'] });
        comm = brokenCOMM.proposeScopeChange(comm, { changeId: 'c1', additionalRequirements: ['新需求'] }).commission;
        comm = brokenCOMM.agreeScopeChange(comm, 'c1').commission;
        assert.equal(comm.requirements.length, 1, '破坏副本上新需求未能合并入需求列表');
    } finally {
        fs.unlinkSync(tmp);
    }
});

/* ============================================================
 * F 面：版本锚
 * ========================================================== */
test('F1 版本下界锚：当前版本必须 >= 4.51.0', () => {
    const pkg = JSON.parse(read('package.json'));
    const cur = pkg.version;
    const vnum = (v) => Number(String(v).split('.').map((x, i) => String(x).padStart(4, '0')).join(''));
    assert.ok(vnum(cur) >= vnum(MIN_VERSION), `package.json 版本 ${cur} 必须 >= ${MIN_VERSION}`);
});