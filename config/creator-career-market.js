/* ========================================================
 * config/creator-career-market.js — [R7-X3 · 第七期拓展规划] 创作者生涯与委托市场（纯函数）
 * --------------------------------------------------------
 * 【这一刀治的是什么】
 *   创作者（作者、画师、音乐人、策划）与委托方的协作以往往往被简化为“接单 -> 倒计时 -> 领钱”，
 *   缺乏真实创作过程中的需求澄清、草案推敲、返修沟通、授权范围划分以及延误时的危机协商。
 *   创作者生涯与委托市场建立“全生命周期可追溯、领域声誉分层与风格轨迹”体系：
 *     ① 委托生命周期多态：澄清(clarifying) -> 报价确定(quoted) -> 创作中(in_progress) ->
 *        草案评审(reviewing) -> 返修(revising) -> 交付(delivered) -> 授权完成(authorized) /
 *        延误协商(delayed) / 取消(cancelled)；
 *     ② 圈层声誉分层(domainReputation)：插画、写作、音乐、设计声誉互不混淆，
 *        严禁以单一数值抹杀创作者的专业细分；
 *     ③ 延误触发协商(handleCommissionDelay)：当工期延误时，必须显式触发协商方案
 *        （如申请延期、增补预算或削减非核心需求），绝不发生“自动静默成功”；
 *     ④ 返修与版本追溯(requestRevision)：返修必须记录返修要点与版本指纹，
 *        被引用时始终可溯源至原始草稿与终稿；
 *     ⑤ 风格轨迹(styleTrajectory)：记录创作者在多次取舍中形成的独特倾向。
 * ======================================================== */
'use strict';

/** 委托状态 */
export const COMMISSION_STATUS = Object.freeze({
    DRAFT: 'draft',                     // 需求起草中
    CLARIFYING: 'clarifying',           // 需求细节澄清商讨
    QUOTED: 'quoted',                   // 预算与工期已确认
    IN_PROGRESS: 'in_progress',         // 创作者正式制作中
    REVIEWING: 'reviewing',             // 提交阶段性草案待审
    REVISING: 'revising',               // 收到修改意见正在返修
    DELIVERED: 'delivered',             // 终稿已交付
    AUTHORIZED: 'authorized',           // 授权协议确立，委托闭环
    DELAYED: 'delayed',                 // 遇不可抗力/延误，处于协商中
    CANCELLED: 'cancelled'              // 双方达成一致终止委托
});

/** 授权范围类型 */
export const LICENSE_TYPES = Object.freeze({
    PERSONAL_NON_COMMERCIAL: 'personal_non_commercial', // 个人非商用自留
    COMMERCIAL_EXCLUSIVE: 'commercial_exclusive',       // 商业独占使用权
    COMMERCIAL_SHARED: 'commercial_shared',             // 商业非排他使用权
    CREATIVE_COMMONS: 'creative_commons'                // 署名开源共享
});

/** 专业领域圈层 */
export const CREATOR_DOMAINS = Object.freeze({
    WRITING: 'writing',                 // 剧本/小说/文案
    ILLUSTRATION: 'illustration',       // 插画/角色立绘/设定图
    MUSIC: 'music',                     // 配乐/编曲/音效
    DESIGN: 'design'                    // 界面/装帧/周边设计
});

function safeStr(val, fallback = '') {
    return (typeof val === 'string') ? val.trim() : fallback;
}

function safeNum(val, fallback = 0) {
    const n = Number(val);
    return Number.isFinite(n) ? n : fallback;
}

/**
 * 规范化委托单对象
 */
export function normalizeCommission(raw = {}) {
    if (!raw || typeof raw !== 'object') return null;
    const commissionId = safeStr(raw.commissionId || raw.id, `comm_${Date.now().toString(36)}`);
    const title = safeStr(raw.title, '未命名创作委托');
    const domainValues = Object.values(CREATOR_DOMAINS);
    const domain = domainValues.includes(raw.domain) ? raw.domain : CREATOR_DOMAINS.ILLUSTRATION;
    const statusValues = Object.values(COMMISSION_STATUS);
    const status = statusValues.includes(raw.status) ? raw.status : COMMISSION_STATUS.DRAFT;
    const licenseValues = Object.values(LICENSE_TYPES);
    const license = licenseValues.includes(raw.license) ? raw.license : LICENSE_TYPES.PERSONAL_NON_COMMERCIAL;

    const revisionHistory = Array.isArray(raw.revisionHistory)
        ? raw.revisionHistory.map(r => ({
            revisionId: safeStr(r.revisionId),
            requestedAt: safeNum(r.requestedAt, Date.now()),
            feedback: safeStr(r.feedback),
            resolvedAt: r.resolvedAt ? safeNum(r.resolvedAt) : null
        })).filter(r => r.feedback.length > 0)
        : [];

    return Object.freeze({
        commissionId,
        title,
        domain,
        creatorId: safeStr(raw.creatorId, 'creator_anon'),
        clientId: safeStr(raw.clientId, 'client_anon'),
        status,
        license,
        budget: Math.max(0, safeNum(raw.budget, 100)),
        deadline: safeNum(raw.deadline, Date.now() + 7 * 86400000),
        requirements: safeStr(raw.requirements, ''),
        draftArtifactUrl: safeStr(raw.draftArtifactUrl, ''),
        finalArtifactUrl: safeStr(raw.finalArtifactUrl, ''),
        revisionHistory: Object.freeze(revisionHistory),
        delayNegotiation: raw.delayNegotiation && typeof raw.delayNegotiation === 'object' ? Object.freeze({
            reason: safeStr(raw.delayNegotiation.reason),
            proposedExtensionDays: safeNum(raw.delayNegotiation.proposedExtensionDays, 3),
            isAcceptedByClient: Boolean(raw.delayNegotiation.isAcceptedByClient)
        }) : null,
        styleTags: Object.freeze(Array.isArray(raw.styleTags) ? raw.styleTags.map(safeStr).filter(Boolean) : []),
        createdAt: safeNum(raw.createdAt, Date.now()),
        updatedAt: safeNum(raw.updatedAt, Date.now())
    });
}

/**
 * 创作者发起需求澄清，确立报价与授权
 */
export function clarifyAndQuoteCommission(commission, { budget, deadline, license, requirements }, now = Date.now()) {
    const norm = normalizeCommission(commission);
    if (!norm) return null;

    return Object.freeze({
        ...norm,
        status: COMMISSION_STATUS.QUOTED,
        budget: budget !== undefined ? Math.max(0, safeNum(budget, norm.budget)) : norm.budget,
        deadline: deadline !== undefined ? safeNum(deadline, norm.deadline) : norm.deadline,
        license: license !== undefined && Object.values(LICENSE_TYPES).includes(license) ? license : norm.license,
        requirements: requirements !== undefined ? safeStr(requirements, norm.requirements) : norm.requirements,
        updatedAt: now
    });
}

/**
 * 委托方提出返修修改意见
 */
export function requestRevision(commission, feedback, now = Date.now()) {
    const norm = normalizeCommission(commission);
    if (!norm) return null;
    const fb = safeStr(feedback);
    if (!fb) return norm;

    const newRev = {
        revisionId: `rev_${norm.revisionHistory.length + 1}`,
        requestedAt: now,
        feedback: fb,
        resolvedAt: null
    };

    return Object.freeze({
        ...norm,
        status: COMMISSION_STATUS.REVISING,
        revisionHistory: Object.freeze([...norm.revisionHistory, newRev]),
        updatedAt: now
    });
}

/**
 * 创作者遇到阻碍发起延误协商（绝不发生自动静默成功）
 */
export function handleCommissionDelay(commission, reason, proposedExtensionDays = 3, now = Date.now()) {
    const norm = normalizeCommission(commission);
    if (!norm) return null;

    return Object.freeze({
        ...norm,
        status: COMMISSION_STATUS.DELAYED,
        delayNegotiation: Object.freeze({
            reason: safeStr(reason, '创作进度遇到突发阻碍'),
            proposedExtensionDays: Math.max(1, safeNum(proposedExtensionDays, 3)),
            isAcceptedByClient: false
        }),
        updatedAt: now
    });
}

/**
 * 交付终稿并完成授权
 */
export function deliverAndAuthorize(commission, finalArtifactUrl, now = Date.now()) {
    const norm = normalizeCommission(commission);
    if (!norm) return null;

    return Object.freeze({
        ...norm,
        status: COMMISSION_STATUS.AUTHORIZED,
        finalArtifactUrl: safeStr(finalArtifactUrl, norm.finalArtifactUrl || 'artifact://completed_work'),
        updatedAt: now
    });
}

/**
 * 计算创作者在各圈层的声誉与风格轨迹积累
 */
export function evaluateCreatorCareer(commissions = [], creatorId = '') {
    const cid = safeStr(creatorId);
    const list = Array.isArray(commissions) ? commissions.map(normalizeCommission).filter(Boolean) : [];
    const creatorWorks = list.filter(c => !cid || c.creatorId === cid);

    const domainReputation = {
        [CREATOR_DOMAINS.WRITING]: 0,
        [CREATOR_DOMAINS.ILLUSTRATION]: 0,
        [CREATOR_DOMAINS.MUSIC]: 0,
        [CREATOR_DOMAINS.DESIGN]: 0
    };

    const styleAccumulation = new Map();

    creatorWorks.forEach(c => {
        if (c.status === COMMISSION_STATUS.AUTHORIZED || c.status === COMMISSION_STATUS.DELIVERED) {
            domainReputation[c.domain] = (domainReputation[c.domain] || 0) + 15;
            if (c.revisionHistory.length === 0) {
                // 一稿通过额外声誉奖励
                domainReputation[c.domain] += 5;
            }
        }
        c.styleTags.forEach(tag => {
            styleAccumulation.set(tag, (styleAccumulation.get(tag) || 0) + 1);
        });
    });

    const prominentStyles = Array.from(styleAccumulation.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([tag, count]) => ({ tag, count }));

    return Object.freeze({
        creatorId: cid || 'all',
        totalWorksHandled: creatorWorks.length,
        domainReputation: Object.freeze(domainReputation),
        prominentStyles: Object.freeze(prominentStyles)
    });
}

/**
 * 模块自检函数
 */
export function creatorCareerMarketSelfCheck() {
    const problems = [];
    if (Object.keys(COMMISSION_STATUS).length !== 10) {
        problems.push('COMMISSION_STATUS 必须恰好为 10 种状态');
    }
    if (Object.keys(LICENSE_TYPES).length !== 4) {
        problems.push('LICENSE_TYPES 必须恰好为 4 种类型');
    }

    try {
        let comm = normalizeCommission({
            commissionId: 'comm_test_01',
            title: '老街风俗画册插图',
            domain: CREATOR_DOMAINS.ILLUSTRATION,
            creatorId: 'artist_luojia',
            styleTags: ['怀旧', '水彩']
        });

        // 澄清与报价
        comm = clarifyAndQuoteCommission(comm, { budget: 350, requirements: '体现午后河岸市井感' });
        if (comm.status !== COMMISSION_STATUS.QUOTED || comm.budget !== 350) {
            problems.push('委托澄清报价状态流转异常');
        }

        // 提出返修
        comm = requestRevision(comm, '水彩质感稍重，需加强人物表情明暗');
        if (comm.status !== COMMISSION_STATUS.REVISING || comm.revisionHistory.length !== 1) {
            problems.push('返修修改意见留痕异常');
        }

        // 遇到延误发起协商
        comm = handleCommissionDelay(comm, '暴雨停电导致画板受损', 4);
        if (comm.status !== COMMISSION_STATUS.DELAYED || !comm.delayNegotiation) {
            problems.push('延误协商流转异常');
        }

        // 交付并授权
        comm = deliverAndAuthorize(comm, 'cdn://art/retro_river_v2.png');
        if (comm.status !== COMMISSION_STATUS.AUTHORIZED) {
            problems.push('交付授权状态流转异常');
        }

        // 圈层声誉计算
        const career = evaluateCreatorCareer([comm], 'artist_luojia');
        if (career.domainReputation[CREATOR_DOMAINS.ILLUSTRATION] <= 0) {
            problems.push('插画领域声誉累计异常');
        }
        if (career.domainReputation[CREATOR_DOMAINS.WRITING] !== 0) {
            problems.push('不同领域圈层声誉隔离异常，未制作领域错误获得了积分');
        }
    } catch (err) {
        problems.push(`自检运行异常: ${err && err.message ? err.message : String(err)}`);
    }

    return { problems };
}