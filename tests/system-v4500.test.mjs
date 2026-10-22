/* ============================================================
 * tests/system-v4500.test.mjs — v4.50.0 · 第六期批次 B 双项验收
 *   - R6-O3 群聊议事与群像互动：角色有立场，议题有来回
 *   - R6-O5 长篇创作项目：从多份草稿升级为一部持续完成的作品
 * ------------------------------------------------------------
 * 判据分六面：
 *   A 面 口径：词表冻结 + 纯契约自证 + 双自检恒真
 *   B 面 R6-O3 议事多轮与防读心行为（5人/2议题/8轮/新证据知情隔离/退出续推/调度）
 *   C 面 R6-O5 长篇作品编排（三章派生/选择性改稿保留人工文字/脱机韧性/多目标虚拟发布）
 *   D 面 接线：调度接线 + 创作台接线 + 存储键进 keys-audit 与 storage 隔离族
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

const MIN_VERSION = '4.50.0';
const GD_REL = 'config/group-deliberation.js';
const CP_REL = 'config/creation-project.js';
const SCHED_REL = 'apps/wechat/group-scheduler.js';
const CD_APP_REL = 'apps/creationdesk/creationdesk-app.js';
const STORAGE_REL = 'config/storage.js';
const KEYS_AUDIT_REL = 'scripts/keys-audit.mjs';

const GD = await import(pathToFileURL(rel(GD_REL)).href);
const CP = await import(pathToFileURL(rel(CP_REL)).href);
const SCHED = await import(pathToFileURL(rel(SCHED_REL)).href);
const CD_APP = await import(pathToFileURL(rel(CD_APP_REL)).href);

/** 内存存储桩 */
function mkStorage() {
    const bag = new Map();
    return {
        get(k, dflt) { return bag.has(k) ? bag.get(k) : dflt; },
        set(k, v) { bag.set(k, v); },
        _bag: bag,
    };
}

/* ============================================================
 * A 面：口径与纯契约自证
 * ========================================================== */
test('A1 词表口径：议事状态4态/立场4态/知情3态 + 作品状态4态/目标5项/策略3项全部冻结', () => {
    assert.equal(Object.isFrozen(GD.GD_TOPIC_STATES), true);
    assert.equal(GD.GD_TOPIC_STATES.OPEN, 'open');
    assert.equal(GD.GD_TOPIC_STATES.BRANCHED, 'branched');
    assert.equal(GD.GD_TOPIC_STATES.RESOLVED, 'resolved');
    assert.equal(GD.GD_TOPIC_STATES.SUSPENDED, 'suspended');

    assert.equal(Object.isFrozen(GD.GD_STANCES), true);
    assert.equal(GD.GD_STANCES.PROPOSE, 'propose');
    assert.equal(GD.GD_STANCES.SUPPORT, 'support');
    assert.equal(GD.GD_STANCES.RESERVE, 'reserve');
    assert.equal(GD.GD_STANCES.OPPOSE, 'oppose');

    assert.equal(Object.isFrozen(CP.CP_WORK_STATUS), true);
    assert.equal(CP.CP_WORK_STATUS.DRAFT, 'draft');
    assert.equal(CP.CP_WORK_STATUS.SERIALIZING, 'serializing');
    assert.equal(CP.CP_WORK_STATUS.COMPLETED, 'completed');
    assert.equal(CP.CP_WORK_STATUS.ARCHIVED, 'archived');

    assert.equal(Object.isFrozen(CP.CP_TARGETS), true);
    assert.ok(CP.CP_TARGETS.includes('moments'));
    assert.ok(CP.CP_TARGETS.includes('blog'));
});

test('A2 纯契约：两个新内核零 DOM / 零网络 / 零定时器 / 零宿主依赖', () => {
    for (const f of [GD_REL, CP_REL]) {
        const s = read(f);
        for (const bad of ['document.', 'window.', 'setTimeout', 'setInterval', 'fetch(', 'XMLHttpRequest']) {
            assert.ok(s.indexOf(bad) < 0, `${f} 不得包含宿主依赖: ${bad}`);
        }
    }
});

test('A3 自检真跑：两个内核 gdSelfCheck 与 cpSelfCheck 返回恒定结构且必绿', () => {
    const a = GD.gdSelfCheck();
    assert.equal(typeof a.ok, 'boolean');
    assert.ok(Array.isArray(a.problems));
    assert.equal(a.ok, true, 'GD 自检必须绿: ' + JSON.stringify(a.problems));

    const b = CP.cpSelfCheck();
    assert.equal(typeof b.ok, 'boolean');
    assert.ok(Array.isArray(b.problems));
    assert.equal(b.ok, true, 'CP 自检必须绿: ' + JSON.stringify(b.problems));
});

/* ============================================================
 * B 面：R6-O3 群聊议事与群像互动验收
 * ========================================================== */
test('B1 五人、两个议题、八轮互动台账：可回看谁提出什么与未回应问题', () => {
    const members = ['user', 'alice', 'bob', 'charlie', 'diana'];
    // 议题 1: 预算规划
    let topic1 = GD.createTopic({ topicId: 't1', title: '展会预算规划', proposerId: 'alice', summary: '提议申请5000元预算' });
    // 议题 2: 展品选址
    let topic2 = GD.createTopic({ topicId: 't2', title: '展位选址方案', proposerId: 'bob', summary: '建议选择东展厅' });

    // 8 轮互动
    topic1 = GD.updateStance(topic1, 'bob', { stance: GD.GD_STANCES.OPPOSE, reason: '预算过高，建议压缩至3000' });
    topic1 = GD.addQuestion(topic1, { questionId: 'q1', fromMemberId: 'bob', targetMemberId: 'alice', text: '5000元的详细类目明细在哪里？' });
    topic1 = GD.updateStance(topic1, 'charlie', { stance: GD.GD_STANCES.RESERVE, reason: '支持压缩，但需保留宣发费用' });
    topic1 = GD.updateStance(topic1, 'diana', { stance: GD.GD_STANCES.SUPPORT, reason: '如果包含搭建费用，5000合理' });
    topic1 = GD.answerQuestion(topic1, 'q1', { answeredBy: 'alice', text: '已整理明细，搭建占2000，宣发2000，机动1000' });

    topic2 = GD.updateStance(topic2, 'charlie', { stance: GD.GD_STANCES.SUPPORT, reason: '东展厅人流大' });
    topic2 = GD.addQuestion(topic2, { questionId: 'q2', fromMemberId: 'diana', targetMemberId: 'bob', text: '东展厅租金是否超标？' });
    topic2 = GD.updateStance(topic2, 'alice', { stance: GD.GD_STANCES.RESERVE, reason: '等看租金核算' });

    // 检查议题 1 台账汇总
    const sum1 = GD.summarizeDeliberation(topic1);
    assert.equal(sum1.ok, true);
    assert.equal(sum1.stanceSummary.propose, 1); // alice
    assert.equal(sum1.stanceSummary.oppose, 1);  // bob
    assert.equal(sum1.stanceSummary.reserve, 1); // charlie
    assert.equal(sum1.stanceSummary.support, 1); // diana
    assert.equal(sum1.unansweredQuestions.length, 0, 'q1已被alice回应');

    // 检查议题 2 台账汇总
    const sum2 = GD.summarizeDeliberation(topic2);
    assert.equal(sum2.ok, true);
    assert.equal(sum2.unansweredQuestions.length, 1, 'q2未回应必须准确列出');
    assert.equal(sum2.unansweredQuestions[0].questionId, 'q2');
    assert.equal(sum2.unansweredQuestions[0].target, 'bob');
});

test('B2 严禁全员读心：新证据只影响知情人物立场，外部未披露证据被拦截', () => {
    let t = GD.createTopic({ topicId: 't_leak', title: '秘密企划', proposerId: 'alice' });
    // alice 公开提供一份证据 doc_public
    t = GD.updateStance(t, 'alice', {
        stance: GD.GD_STANCES.PROPOSE,
        reason: '依据公开招募书',
        evidenceRefs: ['doc_public'],
        disclosedInTurn: true,
    });
    assert.ok(t.knownEvidence.alice.includes('doc_public'));

    // bob 试图引用未持有的秘密档案 secret_intel
    t = GD.updateStance(t, 'bob', {
        stance: GD.GD_STANCES.OPPOSE,
        reason: '据我所知有隐情',
        evidenceRefs: ['secret_intel'],
    });
    // 读心被阻止：leakPrevented 为 true，且 secret_intel 不进入已验证引用
    assert.equal(t.stances.bob.leakPrevented, true);
    assert.equal(t.stances.bob.evidenceRefs.includes('secret_intel'), false, '未获披露的证据严禁跨角色读心使用');
});

test('B3 成员退出与议题续推：一人退出后立场保留（标withdrawn），原议题继续推进', () => {
    let t = GD.createTopic({ title: '户外探险', proposerId: 'guide' });
    t = GD.updateStance(t, 'member_1', { stance: GD.GD_STANCES.SUPPORT, reason: '我很想去' });
    t = GD.updateStance(t, 'member_2', { stance: GD.GD_STANCES.OPPOSE, reason: '太危险了' });

    // member_2 退出群聊
    t = GD.handleMemberLeave(t, 'member_2');
    assert.equal(t.stances.member_2.withdrawn, true, '退群成员历史立场必须保留并标 withdrawn');

    // 议题继续由剩余成员推进
    t = GD.updateStance(t, 'member_3', { stance: GD.GD_STANCES.SUPPORT, reason: '加我一个' });
    const sum = GD.summarizeDeliberation(t);
    assert.equal(sum.ok, true);
    // 活跃支持人数为 2（guide propose 1, member_1 support 1, member_3 support 1）
    assert.equal(sum.stanceSummary.support, 2);
    assert.equal(sum.stanceSummary.oppose, 0, '退出成员不计入活跃反对票');
});

test('B4 议事调度：有未回应提问的目标优先发言，持保留/反对话题优先阐述', () => {
    let t = GD.createTopic({ title: '技术选型', proposerId: 'lead' });
    t = GD.updateStance(t, 'dev_a', { stance: GD.GD_STANCES.SUPPORT });
    t = GD.updateStance(t, 'dev_b', { stance: GD.GD_STANCES.OPPOSE });
    t = GD.addQuestion(t, { fromMemberId: 'lead', targetMemberId: 'dev_b', text: '为什么反对框架X？' });

    const next = GD.suggestNextSpeakers(t, ['dev_a', 'dev_b', 'dev_c']);
    assert.equal(next[0], 'dev_b', '被直接点名提问的 dev_b 必须具有最高调度优先级');
});

/* ============================================================
 * C 面：R6-O5 长篇创作作品编排验收
 * ========================================================== */
test('C1 三章作品多平台派生：编辑第二章情节只更新选定派生稿，未选稿件人工文字不丢', () => {
    let work = CP.createProjectWork({ workId: 'w1', title: '夏日重现' });
    work = CP.upsertChapter(work, { chapterId: 'ch1', synopsis: '第一幕：海岛重逢' });
    work = CP.upsertChapter(work, { chapterId: 'ch2', synopsis: '第二幕：影子传说' });
    work = CP.upsertChapter(work, { chapterId: 'ch3', synopsis: '第三幕：祭典前夜' });

    // 为第二章配置朋友圈（moments）与微博（blog）两份改编稿，带有人工修改痕迹
    work = CP.setChapterDraft(work, 'ch2', 'moments', { text: '朋友圈：今天岛上有奇怪的风声。' });
    work = CP.setChapterDraft(work, 'ch2', 'blog', { text: '【深度长文】手记：关于慎平在日都岛见到的第一个影子异闻……' });

    // 作者修改第二章情节，只勾选更新 moments，不选 blog
    const patchRes = CP.planPlotRevision(work, 'ch2', {
        synopsis: '第二幕：影子传说的真相被初步揭开',
    }, {
        selectedTargets: ['moments'],
    });

    assert.equal(patchRes.ok, true);
    assert.ok(patchRes.report.updatedTargets.includes('moments'));
    assert.ok(patchRes.report.untouchedTargets.includes('blog'));

    const updatedWork = patchRes.work;
    const ch2 = updatedWork.chapters.find(c => c.chapterId === 'ch2');
    // moments 被更新
    assert.ok(ch2.drafts.moments.text.includes('已根据新情节更新'));
    // blog 严格保持原汁原味，手工文字一个字未动
    assert.equal(ch2.drafts.blog.text, '【深度长文】手记：关于慎平在日都岛见到的第一个影子异闻……');
});

test('C2 撤销局部改稿：撤回修订记录后恢复原情节，同时保留原有草稿', () => {
    let work = CP.createProjectWork({ title: '撤销测试' });
    work = CP.upsertChapter(work, { chapterId: 'ch1', synopsis: '原版情节：平静的生活' });
    work = CP.setChapterDraft(work, 'ch1', 'moments', { text: '平静日志' });

    const rev = CP.planPlotRevision(work, 'ch1', { synopsis: '冲突爆发：外敌入侵' }, { selectedTargets: ['moments'] });
    assert.equal(rev.work.chapters[0].synopsis, '冲突爆发：外敌入侵');

    // 撤销该次修订
    const reverted = CP.revertPlotRevision(rev.work, rev.revision.revisionId);
    assert.equal(reverted.chapters[0].synopsis, '原版情节：平静的生活', '撤销后章节情节必须回滚回修改前');
});

test('C3 脱机韧性：断开记忆插件（无window.LonShaMemory）仍可在本地读取与编辑已存作品', () => {
    const memStorage = mkStorage();
    const app = new CD_APP.CreationdeskApp(null, memStorage);

    // 模拟脱机状态：内存存储中有历史保存的作品
    let offlineWork = CP.createProjectWork({ workId: 'offline_w', title: '离线独立篇章' });
    offlineWork = CP.upsertChapter(offlineWork, { chapterId: 'ch1', synopsis: '离线编写的内容' });
    app.saveProjectWork(offlineWork);

    // 脱机读取
    const loaded = app.getProjectWork();
    assert.ok(loaded !== null, '脱机状态下必须能从本地存储完整读取作品');
    assert.equal(loaded.title, '离线独立篇章');
    assert.equal(loaded.chapters.length, 1);
});

test('C4 虚拟发布多目标闭环：从素材到两个目标（moments与blog）全部跑通并产生流水凭单', () => {
    let work = CP.createProjectWork({ title: '发布工程' });
    work = CP.upsertChapter(work, { chapterId: 'ch1', synopsis: '终曲' });
    work = CP.setChapterDraft(work, 'ch1', 'moments', { text: '朋友圈最终回发布！', images: ['cover.png'] });
    work = CP.setChapterDraft(work, 'ch1', 'blog', { text: '博客完整完结感言……', images: [] });

    const pub = CP.publishProjectTargets(work, 'ch1', ['moments', 'blog']);
    assert.equal(pub.ok, true);
    assert.equal(pub.publishedCount, 2, '两个目标虚拟发布必须全部跑通');
    assert.equal(pub.receipts.length, 2);
    assert.equal(pub.receipts[0].target, 'moments');
    assert.equal(pub.receipts[1].target, 'blog');
    assert.equal(pub.receipts[0].status, 'success');
});

/* ============================================================
 * D 面：接线与注册检查
 * ========================================================== */
test('D1 微信调度接线：scheduleDeliberationSpeakers 正确接入 group-scheduler', () => {
    assert.equal(typeof SCHED.scheduleDeliberationSpeakers, 'function');
    assert.ok(SCHED.GD !== undefined);
    assert.equal(typeof SCHED.GD.createTopic, 'function');
});

test('D2 创作台接线：CreationdeskApp 挂载长篇作品编排与脱机支持出口', () => {
    const proto = CD_APP.CreationdeskApp.prototype;
    assert.equal(typeof proto.getProjectWork, 'function');
    assert.equal(typeof proto.saveProjectWork, 'function');
    assert.equal(typeof proto.planPlotRevision, 'function');
    assert.equal(typeof proto.revertPlotRevision, 'function');
    assert.equal(typeof proto.publishProjectTargets, 'function');
});

test('D3 键注册与隔离：group_deliberation_v1 与 creation_projects_v1 进 keys-audit 与 storage 会话前缀族', () => {
    const ka = read(KEYS_AUDIT_REL);
    assert.ok(ka.includes("'group_deliberation_v1'"), 'group_deliberation_v1 必须登记在 KEY_REGISTRY');
    assert.ok(ka.includes("'creation_projects_v1'"), 'creation_projects_v1 必须登记在 KEY_REGISTRY');

    const st = read(STORAGE_REL);
    assert.ok(st.includes('/^group_deliberation/'), 'storage 必须登记 group_deliberation 会话隔离前缀');
    assert.ok(st.includes('/^creation_project/'), 'storage 必须登记 creation_project 会话隔离前缀');
});

/* ============================================================
 * E 面：负控制真源码破坏自证
 * ========================================================== */
function breakSource(relPath, oldStr, newStr) {
    const full = rel(relPath);
    const content = fs.readFileSync(full, 'utf8');
    const idx = content.indexOf(oldStr);
    assert.ok(idx >= 0, `锚点未找到: ${oldStr}`);
    assert.equal(content.indexOf(oldStr, idx + 1), -1, `锚点不唯一: ${oldStr}`);
    const broken = content.replace(oldStr, newStr);
    const tmpFile = path.join(os.tmpdir(), `broken_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.js`);
    fs.writeFileSync(tmpFile, broken, 'utf8');
    return tmpFile;
}

test('E1 负控制：破坏 R6-O3 防读心逻辑（放行未持有证据） -> 防读心判据必红', async () => {
    // 破坏点：将 leakDetected = true 改为 leakDetected = false
    const tmp = breakSource(
        GD_REL,
        'leakDetected = true;',
        'leakDetected = false;'
    );
    try {
        const brokenGD = await import(pathToFileURL(tmp).href);
        let t = brokenGD.createTopic({ topicId: 't_leak', title: '破坏防读心', proposerId: 'alice' });
        t = brokenGD.updateStance(t, 'bob', {
            stance: brokenGD.GD_STANCES.OPPOSE,
            evidenceRefs: ['unheld_secret'],
        });
        // 在破坏副本上，leakPrevented 变成了 false
        assert.equal(t.stances.bob.leakPrevented, false, '破坏副本上读心拦截必须失效（使原判据翻红）');
    } finally {
        fs.unlinkSync(tmp);
    }
});

test('E2 负控制：破坏 R6-O5 选择性改稿逻辑（强制把未选稿件一并改写） -> 未选保留判据必红', async () => {
    // 破坏点：将 else { updateReport.untouchedTargets.push(tKey); } 改为覆盖
    const tmp = breakSource(
        CP_REL,
        "updateReport.untouchedTargets.push(tKey);",
        "draft.text = '[强制冲刷覆盖]'; updateReport.updatedTargets.push(tKey);"
    );
    try {
        const brokenCP = await import(pathToFileURL(tmp).href);
        let w = brokenCP.createProjectWork({ title: '破坏保留' });
        w = brokenCP.upsertChapter(w, { chapterId: 'ch1', synopsis: '序幕' });
        w = brokenCP.setChapterDraft(w, 'ch1', 'blog', { text: '保留手工文字' });
        const res = brokenCP.planPlotRevision(w, 'ch1', { synopsis: '改动' }, { selectedTargets: [] });
        // 在破坏副本上，blog 变成了 [强制冲刷覆盖]
        assert.equal(res.work.chapters[0].drafts.blog.text, '[强制冲刷覆盖]', '破坏副本上人工文字必须被冲掉');
    } finally {
        fs.unlinkSync(tmp);
    }
});

test('E3 负控制：破坏 R6-O5 撤销逻辑（撤销时不恢复原情节） -> 撤销恢复判据必红', async () => {
    // 破坏点：将 ch.synopsis = rev.oldSynopsis 注释掉
    const tmp = breakSource(
        CP_REL,
        'ch.synopsis = rev.oldSynopsis;',
        '/* ch.synopsis = rev.oldSynopsis; */'
    );
    try {
        const brokenCP = await import(pathToFileURL(tmp).href);
        let w = brokenCP.createProjectWork({ title: '破坏撤销' });
        w = brokenCP.upsertChapter(w, { chapterId: 'ch1', synopsis: '旧情节' });
        const rev = brokenCP.planPlotRevision(w, 'ch1', { synopsis: '新情节' }, {});
        const reverted = brokenCP.revertPlotRevision(rev.work, rev.revision.revisionId);
        assert.equal(reverted.chapters[0].synopsis, '新情节', '破坏副本上情节未能恢复旧值');
    } finally {
        fs.unlinkSync(tmp);
    }
});

/* ============================================================
 * F 面：版本锚
 * ========================================================== */
test('F1 版本下界锚：当前版本必须 >= 4.50.0', () => {
    const pkg = JSON.parse(read('package.json'));
    const cur = pkg.version;
    const vnum = (v) => Number(String(v).split('.').map((x, i) => String(x).padStart(4, '0')).join(''));
    assert.ok(vnum(cur) >= vnum(MIN_VERSION), `package.json 版本 ${cur} 必须 >= ${MIN_VERSION}`);
});
