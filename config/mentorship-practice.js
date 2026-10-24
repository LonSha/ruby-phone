/* ========================================================
 * config/mentorship-practice.js — [R7-X8 · 第七期拓展规划] 生活技能与师徒实践（纯函数）
 * --------------------------------------------------------
 * 【这一刀治的是什么】
 *   角色之间相互传授生活技能（烹饪、吉他指弹、速写、手冲咖啡）时，
 *   传统系统往往以冰冷的经验条数值(+10EXP)敷衍了事，或者角色未曾练习便凭空宣称“已精通”。
 *   生活技能与师徒实践建立“作品证据驱动、阶段演练闭环与师徒角色互换”机制：
 *     ① 实践阶段流转模型(PRACTICE_PHASE)：
 *        示范点拨(demonstration) -> 独立练习(exercise) -> 成果评审(feedback) ->
 *        针对性再试(retry) -> 掌握结业(mastery)；
 *     ② 失败留痕与经验沉淀(recordPracticeFailure)：练习失败绝不倒扣抽象数值，
 *        而是记录具体翻车原因（如火候过猛、指法按品不紧）与改进心得；
 *     ③ 师徒角色平滑互换(swapMentorshipRoles)：教者与学者并非固定尊卑，
 *        随科目切换可自然互为师徒；
 *     ④ 作品证据证明技能：技能掌握必须绑定具体的作品成品，严禁虚构未练之功。
 * ======================================================== */
'use strict';

/** 实践推进阶段 */
export const PRACTICE_PHASE = Object.freeze({
    DEMONSTRATION: 'demonstration',   // 师父示范/要诀点拨
    EXERCISE: 'exercise',             // 学徒亲自动手练习
    FEEDBACK: 'feedback',             // 观察成品并指出不足
    RETRY: 'retry',                   // 针对盲区重新调整再试
    MASTERY: 'mastery'                // 稳定产出合格作品，宣布掌握
});

/** 生活技能类别 */
export const SKILL_CATEGORY = Object.freeze({
    COOKING: 'cooking',               // 厨艺烹饪/烘焙
    MUSIC: 'music',                   // 乐器演奏/乐理
    DRAWING: 'drawing',               // 绘画速写/手作
    LANGUAGE: 'language'              // 方言习俗/外语口语
});

function safeStr(val, fallback = '') {
    return (typeof val === 'string') ? val.trim() : fallback;
}

function safeNum(val, fallback = 0) {
    const n = Number(val);
    return Number.isFinite(n) ? n : fallback;
}

/**
 * 规范化师徒实践项目
 */
export function normalizeMentorshipProject(raw = {}) {
    if (!raw || typeof raw !== 'object') return null;
    const projectId = safeStr(raw.projectId || raw.id, `proj_${Date.now().toString(36)}`);
    const skillName = safeStr(raw.skillName, '未命名生活技艺');
    const categoryValues = Object.values(SKILL_CATEGORY);
    const category = categoryValues.includes(raw.category) ? raw.category : SKILL_CATEGORY.COOKING;
    const phaseValues = Object.values(PRACTICE_PHASE);
    const currentPhase = phaseValues.includes(raw.currentPhase) ? raw.currentPhase : PRACTICE_PHASE.DEMONSTRATION;

    const mentorId = safeStr(raw.mentorId, 'char_mentor');
    const apprenticeId = safeStr(raw.apprenticeId, 'char_apprentice');

    const practiceRounds = Array.isArray(raw.practiceRounds)
        ? raw.practiceRounds.map(r => ({
            roundNum: safeNum(r.roundNum, 1),
            artifactOutcome: safeStr(r.artifactOutcome, ''),
            isSuccess: Boolean(r.isSuccess),
            feedback: safeStr(r.feedback, ''),
            lessonLearned: safeStr(r.lessonLearned, ''),
            timestamp: safeNum(r.timestamp, Date.now())
        }))
        : [];

    return Object.freeze({
        projectId,
        skillName,
        category,
        mentorId,
        apprenticeId,
        currentPhase,
        practiceRounds: Object.freeze(practiceRounds),
        isPaused: Boolean(raw.isPaused),
        masteredArtifactProof: safeStr(raw.masteredArtifactProof, ''),
        createdAt: safeNum(raw.createdAt, Date.now()),
        updatedAt: safeNum(raw.updatedAt, Date.now())
    });
}

/**
 * 记录一次练习尝试（支持成功与失败经验留痕）
 */
export function recordPracticeAttempt(project, { artifactOutcome, isSuccess, feedback, lessonLearned }, now = Date.now()) {
    const norm = normalizeMentorshipProject(project);
    if (!norm) return null;

    const roundNum = norm.practiceRounds.length + 1;
    const newRound = {
        roundNum,
        artifactOutcome: safeStr(artifactOutcome, '未命名练习习作'),
        isSuccess: Boolean(isSuccess),
        feedback: safeStr(feedback, ''),
        lessonLearned: safeStr(lessonLearned, ''),
        timestamp: now
    };

    let nextPhase = PRACTICE_PHASE.FEEDBACK;
    let proof = norm.masteredArtifactProof;

    if (!newRound.isSuccess) {
        nextPhase = PRACTICE_PHASE.RETRY;
    } else if (norm.practiceRounds.filter(r => r.isSuccess).length >= 1) {
        // 多次成功后方可达成 mastery
        nextPhase = PRACTICE_PHASE.MASTERY;
        proof = newRound.artifactOutcome;
    }

    return Object.freeze({
        ...norm,
        currentPhase: nextPhase,
        practiceRounds: Object.freeze([...norm.practiceRounds, newRound]),
        masteredArtifactProof: proof,
        updatedAt: now
    });
}

/**
 * 师徒角色平滑互换
 */
export function swapMentorshipRoles(project, newSkillName = '', now = Date.now()) {
    const norm = normalizeMentorshipProject(project);
    if (!norm) return null;

    return Object.freeze({
        ...norm,
        projectId: `proj_swap_${Date.now().toString(36)}`,
        skillName: safeStr(newSkillName, `${norm.skillName}（身份互换研讨）`),
        mentorId: norm.apprenticeId, // 原学徒变为新师父
        apprenticeId: norm.mentorId, // 原师父变为新学徒
        currentPhase: PRACTICE_PHASE.DEMONSTRATION,
        practiceRounds: Object.freeze([]),
        masteredArtifactProof: '',
        updatedAt: now
    });
}

/**
 * 暂停与恢复练习会话
 */
export function setPracticePaused(project, isPaused = true, now = Date.now()) {
    const norm = normalizeMentorshipProject(project);
    if (!norm) return null;

    return Object.freeze({
        ...norm,
        isPaused: Boolean(isPaused),
        updatedAt: now
    });
}

/**
 * 模块自检函数
 */
export function mentorshipPracticeSelfCheck() {
    const problems = [];
    if (Object.keys(PRACTICE_PHASE).length !== 5) {
        problems.push('PRACTICE_PHASE 必须恰好为 5 个阶段');
    }
    if (Object.keys(SKILL_CATEGORY).length !== 4) {
        problems.push('SKILL_CATEGORY 必须恰好为 4 种门类');
    }

    try {
        let proj = normalizeMentorshipProject({
            projectId: 'proj_latte_art',
            skillName: '手冲拿铁拉花',
            category: SKILL_CATEGORY.COOKING,
            mentorId: 'char_shuyun',
            apprenticeId: 'char_luojia'
        });

        // 1. 第一次练习：失败翻车
        proj = recordPracticeAttempt(proj, {
            artifactOutcome: '一碗混浊的白色奶泡',
            isSuccess: false,
            feedback: '发泡过厚，奶缸倾斜角过大，导致表面结块。',
            lessonLearned: '下次需调小打气深度，晃缸使泡沫均匀'
        });
        if (proj.currentPhase !== PRACTICE_PHASE.RETRY || proj.practiceRounds.length !== 1) {
            problems.push('练习失败阶段流转未进入 retry');
        }

        // 2. 针对性再试：第二次改善
        proj = recordPracticeAttempt(proj, {
            artifactOutcome: '稍微成型的心形轮廓',
            isSuccess: true,
            feedback: '已有雏形，出奶点基本准确，收尾略显拖沓。',
            lessonLearned: '最后收杯动作要果断提起'
        });

        // 3. 第三次练习：巩固作品
        proj = recordPracticeAttempt(proj, {
            artifactOutcome: '对称完整的三层郁金香拉花',
            isSuccess: true,
            feedback: '非常规整，层次分明，已完全具备出品水准。',
            lessonLearned: '熟能生巧，找到了手腕发力的感觉'
        });
        if (proj.currentPhase !== PRACTICE_PHASE.MASTERY || !proj.masteredArtifactProof) {
            problems.push('练习多次成功后未正确达成 mastery 结业证据');
        }

        // 4. 角色互换测试（如珞珈反过来教舒芸吉他调音）
        const swapped = swapMentorshipRoles(proj, '民谣吉他标准调音与和弦按法');
        if (swapped.mentorId !== 'char_luojia' || swapped.apprenticeId !== 'char_shuyun') {
            problems.push('师徒身份互换异常');
        }
    } catch (err) {
        problems.push(`自检运行异常: ${err && err.message ? err.message : String(err)}`);
    }

    return { problems };
}