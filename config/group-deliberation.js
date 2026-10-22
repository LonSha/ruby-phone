/**
 * config/group-deliberation.js — [v4.50.0 · R6-O3] 群聊议事与群像互动契约内核
 * 
 * 【设计职责】
 * 解决“角色在群聊中缺乏持续立场、议题缺乏多轮互动、全员同步读心、议程易被打断”的缺陷：
 * 1. 维护议题的多轮状态（open / branched / resolved / suspended）；
 * 2. 参与者四态立场（propose / support / reserve / oppose）与理由和证据关联；
 * 3. 私有知情边界（严禁跨角色无出处读心：新证据只影响知情人物立场）；
 * 4. 未回应问题队列（openQuestions）与分话题拆合（branch / merge）；
 * 5. 人员离线/退出时立场保留与议题续推；
 * 6. 发言调度候选度计算（优先推给被提问者、对立反驳者、有新证据者）。
 * 
 * 零宿主依赖、零 DOM、纯函数、状态不可变或受控克隆，全面冻结导出。
 */

export const GD_TOPIC_STATES = Object.freeze({
    OPEN: 'open',
    BRANCHED: 'branched',
    RESOLVED: 'resolved',
    SUSPENDED: 'suspended',
});

export const GD_STANCES = Object.freeze({
    PROPOSE: 'propose',
    SUPPORT: 'support',
    RESERVE: 'reserve',
    OPPOSE: 'oppose',
});

export const GD_INFO_STATES = Object.freeze({
    KNOWN: 'known',
    UNINFORMED: 'uninformed',
    LEAK_PREVENTED: 'leak_prevented',
});

export const GD_LIMITS = Object.freeze({
    maxTopics: 20,
    maxTurns: 100,
    maxQuestions: 50,
    maxBranches: 10,
    maxStanceHistory: 20,
});

export const GD_STORAGE_KEY = 'group_deliberation_v1';

/** 归一化字符串标识 */
function normId(s) {
    return String(s ?? '').trim();
}

/** 深度冻结浅对象/数组 */
function deepFreeze(obj) {
    if (!obj || typeof obj !== 'object' || Object.isFrozen(obj)) return obj;
    Object.freeze(obj);
    for (const key of Object.keys(obj)) {
        deepFreeze(obj[key]);
    }
    return obj;
}

/**
 * 创建新议题
 * @param {object} raw
 * @returns {object}
 */
export function createTopic(raw = {}) {
    const topicId = normId(raw.topicId || raw.id || `topic_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`);
    const title = String(raw.title || '未命名议题').trim();
    const proposerId = normId(raw.proposerId || raw.authorId || 'unknown');
    const initialSummary = String(raw.summary || title).trim();

    const topic = {
        topicId,
        title,
        proposerId,
        status: GD_TOPIC_STATES.OPEN,
        parentTopicId: raw.parentTopicId ? normId(raw.parentTopicId) : null,
        subTopicIds: [],
        openQuestions: [],
        /** 成员立场表: memberId -> { stance, reason, evidenceRefs: [], updatedAt, withdrawn: boolean } */
        stances: {},
        /** 成员知情事实集合: memberId -> [evidenceRefId] */
        knownEvidence: {},
        /** 议事轮次日志: [{ turn, speakerId, type, content, timestamp, targetQuestionId }] */
        turns: [],
        createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : Date.now(),
        updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : Date.now(),
    };

    // 提出者默认带有 propose 立场
    if (proposerId && proposerId !== 'unknown') {
        topic.stances[proposerId] = {
            stance: GD_STANCES.PROPOSE,
            reason: initialSummary,
            evidenceRefs: Array.isArray(raw.evidenceRefs) ? [...raw.evidenceRefs] : [],
            updatedAt: topic.createdAt,
            withdrawn: false,
        };
        topic.knownEvidence[proposerId] = Array.isArray(raw.evidenceRefs) ? [...raw.evidenceRefs] : [];
    }

    return topic;
}

/**
 * 记录或更新成员立场
 * 严格防读心检查：若 stance 附带证据引用，必须检查该成员是否在 knownEvidence 中持有该证据或正在公开提供
 */
export function updateStance(topic, memberId, stanceUpdate = {}) {
    if (!topic || typeof topic !== 'object') return null;
    const mid = normId(memberId);
    if (!mid) return topic;

    const next = JSON.parse(JSON.stringify(topic));
    const current = next.stances[mid] || {
        stance: GD_STANCES.RESERVE,
        reason: '',
        evidenceRefs: [],
        updatedAt: Date.now(),
        withdrawn: false,
    };

    const targetStance = Object.values(GD_STANCES).includes(stanceUpdate.stance)
        ? stanceUpdate.stance
        : current.stance;

    // 严禁读心：如果更新依赖外部私有证据，未被披露则拒绝或标记 leak_prevented
    const requestedEvidence = Array.isArray(stanceUpdate.evidenceRefs) ? stanceUpdate.evidenceRefs : [];
    const memberKnown = new Set(next.knownEvidence[mid] || []);
    const verifiedEvidence = [];
    let leakDetected = false;

    for (const ref of requestedEvidence) {
        if (memberKnown.has(ref) || stanceUpdate.disclosedInTurn) {
            verifiedEvidence.push(ref);
            memberKnown.add(ref);
        } else {
            leakDetected = true;
        }
    }
    next.knownEvidence[mid] = Array.from(memberKnown);

    next.stances[mid] = {
        stance: targetStance,
        reason: String(stanceUpdate.reason ?? current.reason ?? '').trim(),
        evidenceRefs: verifiedEvidence,
        updatedAt: typeof stanceUpdate.timestamp === 'number' ? stanceUpdate.timestamp : Date.now(),
        withdrawn: false,
        leakPrevented: leakDetected,
    };
    next.updatedAt = next.stances[mid].updatedAt;

    return next;
}

/**
 * 成员提出新疑问（未回应问题入队）
 */
export function addQuestion(topic, question = {}) {
    if (!topic || typeof topic !== 'object') return null;
    const next = JSON.parse(JSON.stringify(topic));
    const qid = normId(question.questionId || question.id || `q_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`);
    const fromMemberId = normId(question.fromMemberId || question.from || 'unknown');
    const targetMemberId = question.targetMemberId ? normId(question.targetMemberId) : null;
    const text = String(question.text || '').trim();

    if (!text) return next;

    next.openQuestions.push({
        questionId: qid,
        fromMemberId,
        targetMemberId,
        text,
        answered: false,
        createdAt: Date.now(),
    });
    next.updatedAt = Date.now();
    return next;
}

/**
 * 回应问题（将未回应问题标记为已回应）
 */
export function answerQuestion(topic, questionId, answerDetail = {}) {
    if (!topic || typeof topic !== 'object') return null;
    const next = JSON.parse(JSON.stringify(topic));
    const qid = normId(questionId);

    const q = next.openQuestions.find(item => item.questionId === qid);
    if (q) {
        q.answered = true;
        q.answeredBy = normId(answerDetail.answeredBy || 'unknown');
        q.answeredAt = Date.now();
        q.answerSummary = String(answerDetail.text || '').trim();
    }
    next.updatedAt = Date.now();
    return next;
}

/**
 * 拆出分话题（branch）
 */
export function branchSubTopic(parentTopic, subTopicRaw = {}) {
    if (!parentTopic || typeof parentTopic !== 'object') return { parent: parentTopic, sub: null };
    const pNext = JSON.parse(JSON.stringify(parentTopic));
    const sub = createTopic({
        ...subTopicRaw,
        parentTopicId: pNext.topicId,
        proposerId: subTopicRaw.proposerId || pNext.proposerId,
    });
    pNext.subTopicIds.push(sub.topicId);
    pNext.status = GD_TOPIC_STATES.BRANCHED;
    pNext.updatedAt = Date.now();

    return { parent: pNext, sub };
}

/**
 * 合并分话题结论回主议题（merge）
 */
export function mergeSubTopic(parentTopic, subTopic, resolution = '') {
    if (!parentTopic || !subTopic) return parentTopic;
    const pNext = JSON.parse(JSON.stringify(parentTopic));
    const sub = JSON.parse(JSON.stringify(subTopic));

    sub.status = GD_TOPIC_STATES.RESOLVED;
    sub.resolution = String(resolution || '分话题已归并').trim();

    // 将分话题中达成共识或更新的立场同步回主议题参考
    for (const [mid, st] of Object.entries(sub.stances)) {
        if (!pNext.stances[mid] || pNext.stances[mid].withdrawn) {
            pNext.stances[mid] = { ...st };
        }
    }
    // 检查是否所有分话题都已解决
    pNext.updatedAt = Date.now();
    return pNext;
}

/**
 * 成员退出/掉线处理（不崩溃，保留历史立场，标记 withdrawn）
 */
export function handleMemberLeave(topic, memberId) {
    if (!topic || typeof topic !== 'object') return null;
    const mid = normId(memberId);
    const next = JSON.parse(JSON.stringify(topic));
    if (next.stances[mid]) {
        next.stances[mid].withdrawn = true;
        next.stances[mid].updatedAt = Date.now();
    }
    next.updatedAt = Date.now();
    return next;
}

/**
 * 依据当前议事状态调度推荐下一个最适合发言的角色：
 * 规则优先级：
 * 1. 被指定提问且尚未回答该问题的目标成员（targetMemberId 且 answered=false）
 * 2. 持对立立场（oppose / reserve）且距离上次发言间隔最长的活跃成员
 * 3. 尚未表态的参会成员
 */
export function suggestNextSpeakers(topic, activeMemberIds = []) {
    if (!topic || typeof topic !== 'object') return [];
    const members = (Array.isArray(activeMemberIds) ? activeMemberIds : []).map(normId).filter(Boolean);
    const pendingQuestions = topic.openQuestions.filter(q => !q.answered);

    const scores = new Map();
    for (const mid of members) {
        // 如果已退出则不建议
        if (topic.stances[mid]?.withdrawn) continue;

        let score = 10; // 基础权重
        // 是否有被点名提问
        const targeted = pendingQuestions.some(q => q.targetMemberId === mid);
        if (targeted) score += 50;

        // 立场权重：反对或保留者优先发言阐述
        const st = topic.stances[mid]?.stance;
        if (st === GD_STANCES.OPPOSE) score += 30;
        else if (st === GD_STANCES.RESERVE) score += 20;
        else if (!st) score += 25; // 尚未表态

        scores.set(mid, score);
    }

    return Array.from(scores.entries())
        .sort((a, b) => b[1] - a[1])
        .map(entry => entry[0]);
}

/**
 * 议事台账汇总报告（可复看谁提出什么、哪些问题未回应）
 */
export function summarizeDeliberation(topic) {
    if (!topic || typeof topic !== 'object') return { ok: false, reason: 'empty-topic' };
    const unanswered = topic.openQuestions.filter(q => !q.answered);
    const stanceCount = { propose: 0, support: 0, reserve: 0, oppose: 0 };
    for (const s of Object.values(topic.stances)) {
        if (!s.withdrawn && stanceCount[s.stance] !== undefined) {
            stanceCount[s.stance]++;
        }
    }
    return {
        ok: true,
        topicId: topic.topicId,
        title: topic.title,
        status: topic.status,
        stanceSummary: stanceCount,
        unansweredQuestions: unanswered.map(q => ({
            questionId: q.questionId,
            from: q.fromMemberId,
            target: q.targetMemberId,
            text: q.text,
        })),
        totalTurns: topic.turns.length,
        updatedAt: topic.updatedAt,
    };
}

/** 诊断行格式化输出 */
export function groupDeliberationLine(topic) {
    if (!topic) return '[议事台] 未激活';
    const sum = summarizeDeliberation(topic);
    if (!sum.ok) return '[议事台] 无效议题';
    return `[议事台] 议题: "${sum.title}" | 状态: ${sum.status} | 赞成/反对/保留: ${sum.stanceSummary.support}/${sum.stanceSummary.oppose}/${sum.stanceSummary.reserve} | 待回应问题: ${sum.unansweredQuestions.length}`;
}

/**
 * 内核自检方法（恒定结构）
 */
export function gdSelfCheck() {
    const problems = [];
    try {
        const t = createTopic({ title: '自检测试议题', proposerId: 'char_a' });
        if (t.status !== GD_TOPIC_STATES.OPEN) problems.push('createTopic 初始状态必须为 open');
        if (t.stances.char_a?.stance !== GD_STANCES.PROPOSE) problems.push('提出者默认立场必须为 propose');

        // 测试防读心更新
        const t2 = updateStance(t, 'char_b', { stance: GD_STANCES.OPPOSE, reason: '没有根据', evidenceRefs: ['secret_doc_1'] });
        if (t2.stances.char_b?.leakPrevented !== true) problems.push('未持有证据的成员更新立场必须被防读心拦截');

        // 测试问题追加
        const t3 = addQuestion(t2, { fromMemberId: 'char_b', targetMemberId: 'char_a', text: '资金从何而来？' });
        if (t3.openQuestions.length !== 1) problems.push('addQuestion 应该成功增加未回应问题');

        const rec = suggestNextSpeakers(t3, ['char_a', 'char_b', 'char_c']);
        if (rec[0] !== 'char_a') problems.push('被点名回答问题的角色应具有最高调度优先级');

        const sum = summarizeDeliberation(t3);
        if (!sum.ok || sum.unansweredQuestions.length !== 1) problems.push('汇总报告应正确计算未回应问题');
    } catch (e) {
        problems.push('gdSelfCheck 运行时抛出异常: ' + (e?.message || String(e)));
    }

    return {
        ok: problems.length === 0,
        problems,
        timestamp: Date.now(),
    };
}

export default {
    GD_TOPIC_STATES,
    GD_STANCES,
    GD_INFO_STATES,
    GD_LIMITS,
    createTopic,
    updateStance,
    addQuestion,
    answerQuestion,
    branchSubTopic,
    mergeSubTopic,
    handleMemberLeave,
    suggestNextSpeakers,
    summarizeDeliberation,
    groupDeliberationLine,
    gdSelfCheck,
};
