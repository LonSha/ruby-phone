/* ========================================================
 * config/community-autonomy.js — [R7-X5 · 第七期拓展规划] 角色社群自治季（纯函数）
 * --------------------------------------------------------
 * 【这一刀治的是什么】
 *   虚构社群（社团、同好会、剧组、街坊理事会）的集体筹备活动以往常沦为单线任务，
 *   角色的不同主张被抹平，玩家缺席或拒绝时系统要么卡死，要么伪造在场全票通过。
 *   角色社群自治季建立“跨阶段多成员协商、分工替代与成果回溯”机制：
 *     ① 四阶段推进模型(AUTONOMY_PHASES)：
 *        倡议召集(initiation) -> 议事分工(deliberation) -> 筹备攻坚(execution) -> 成果归档(archiving)；
 *     ② 成员岗位与资源建模：成员各具岗位(duty)、可用精力/物资(resources)与个人诉求偏好；
 *     ③ 议事冲突与妥协记录(deliberateOnIssue)：记录议案的争论焦点、分歧意见(dissentingOpinions)与妥协决议；
 *     ④ 缺席尊重与替代方案(handleMemberAbsence)：玩家或核心成员拒绝或缺席时，
 *        系统绝不强行代打或伪造参与，而是由社团启动显式替代方案(fallbackAction)继续前行；
 *     ⑤ 成果长线绑定(archiveCommunityOutput)：归档成果回链至各阶段实际贡献人与关键议事决定。
 * ======================================================== */
'use strict';

/** 自治季推进阶段 */
export const AUTONOMY_PHASES = Object.freeze({
    INITIATION: 'initiation',       // 倡议与目标确立
    DELIBERATION: 'deliberation',   // 议事分工与预算商讨
    EXECUTION: 'execution',         // 任务筹备与难关攻坚
    ARCHIVING: 'archiving'          // 成果归档与复盘结项
});

/** 成员参与状态 */
export const MEMBER_ENGAGEMENT = Object.freeze({
    ACTIVE: 'active',               // 全力投入
    LIMITED: 'limited',             // 有限参与/仅提供资源
    ABSENT: 'absent',               // 明确缺席/中途请辞
    OBSERVER: 'observer'            // 列席旁观（不承担关键交付）
});

function safeStr(val, fallback = '') {
    return (typeof val === 'string') ? val.trim() : fallback;
}

function safeNum(val, fallback = 0) {
    const n = Number(val);
    return Number.isFinite(n) ? n : fallback;
}

/**
 * 规范化社团自治季对象
 */
export function normalizeCommunitySeason(raw = {}) {
    if (!raw || typeof raw !== 'object') return null;
    const seasonId = safeStr(raw.seasonId || raw.id, `season_${Date.now().toString(36)}`);
    const communityName = safeStr(raw.communityName, '未命名社团');
    const seasonGoal = safeStr(raw.seasonGoal, '年度社团展示与共同创作');
    const phaseValues = Object.values(AUTONOMY_PHASES);
    const currentPhase = phaseValues.includes(raw.currentPhase) ? raw.currentPhase : AUTONOMY_PHASES.INITIATION;

    const members = Array.isArray(raw.members)
        ? raw.members.map(m => ({
            memberId: safeStr(m.memberId || m.id),
            name: safeStr(m.name, '匿名成员'),
            role: safeStr(m.role, '社团成员'),
            engagement: Object.values(MEMBER_ENGAGEMENT).includes(m.engagement) ? m.engagement : MEMBER_ENGAGEMENT.ACTIVE,
            resourceContribution: safeStr(m.resourceContribution, '时间与建议')
        })).filter(m => m.memberId.length > 0)
        : [];

    const deliberations = Array.isArray(raw.deliberations)
        ? raw.deliberations.map(d => ({
            issueId: safeStr(d.issueId),
            topic: safeStr(d.topic),
            resolution: safeStr(d.resolution),
            dissentingOpinions: Array.isArray(d.dissentingOpinions) ? d.dissentingOpinions.map(safeStr).filter(Boolean) : []
        }))
        : [];

    const absenceRecords = Array.isArray(raw.absenceRecords)
        ? raw.absenceRecords.map(a => ({
            memberId: safeStr(a.memberId),
            reason: safeStr(a.reason),
            fallbackAction: safeStr(a.fallbackAction),
            isPlayer: Boolean(a.isPlayer)
        }))
        : [];

    return Object.freeze({
        seasonId,
        communityName,
        seasonGoal,
        currentPhase,
        members: Object.freeze(members),
        deliberations: Object.freeze(deliberations),
        absenceRecords: Object.freeze(absenceRecords),
        finalOutput: raw.finalOutput && typeof raw.finalOutput === 'object' ? Object.freeze({
            title: safeStr(raw.finalOutput.title),
            summary: safeStr(raw.finalOutput.summary),
            contributors: Array.isArray(raw.finalOutput.contributors) ? Object.freeze(raw.finalOutput.contributors.map(safeStr)) : Object.freeze([])
        }) : null,
        createdAt: safeNum(raw.createdAt, Date.now()),
        updatedAt: safeNum(raw.updatedAt, Date.now())
    });
}

/**
 * 推进自治季到下一阶段
 */
export function advanceSeasonPhase(season, targetPhase, now = Date.now()) {
    const norm = normalizeCommunitySeason(season);
    if (!norm) return null;
    const phaseValues = Object.values(AUTONOMY_PHASES);
    if (!phaseValues.includes(targetPhase)) return norm;

    return Object.freeze({
        ...norm,
        currentPhase: targetPhase,
        updatedAt: now
    });
}

/**
 * 记录议事冲突与决议
 */
export function deliberateOnIssue(season, issue = {}, now = Date.now()) {
    const norm = normalizeCommunitySeason(season);
    if (!norm) return null;

    const topic = safeStr(issue.topic);
    if (!topic) return norm;

    const record = {
        issueId: safeStr(issue.issueId, `issue_${norm.deliberations.length + 1}`),
        topic,
        resolution: safeStr(issue.resolution, '搁置争议，采取折中折算'),
        dissentingOpinions: Array.isArray(issue.dissentingOpinions)
            ? issue.dissentingOpinions.map(safeStr).filter(Boolean)
            : []
    };

    return Object.freeze({
        ...norm,
        deliberations: Object.freeze([...norm.deliberations, record]),
        updatedAt: now
    });
}

/**
 * 记录成员缺席并确立社团替代应对方案（绝不伪造在场）
 */
export function handleMemberAbsence(season, { memberId, reason, fallbackAction, isPlayer = false }, now = Date.now()) {
    const norm = normalizeCommunitySeason(season);
    if (!norm) return null;
    const mid = safeStr(memberId);
    if (!mid) return norm;

    const updatedMembers = norm.members.map(m => {
        if (m.memberId !== mid) return m;
        return {
            ...m,
            engagement: MEMBER_ENGAGEMENT.ABSENT
        };
    });

    const absenceLog = {
        memberId: mid,
        reason: safeStr(reason, '个人事务冲突请辞缺席'),
        fallbackAction: safeStr(fallbackAction, '由备选成员代为分担基础事务，简化展示规格'),
        isPlayer: Boolean(isPlayer)
    };

    return Object.freeze({
        ...norm,
        members: Object.freeze(updatedMembers),
        absenceRecords: Object.freeze([...norm.absenceRecords, absenceLog]),
        updatedAt: now
    });
}

/**
 * 成果归档与功绩回溯
 */
export function archiveCommunityOutput(season, output = {}, now = Date.now()) {
    const norm = normalizeCommunitySeason(season);
    if (!norm) return null;

    const contributors = norm.members
        .filter(m => m.engagement === MEMBER_ENGAGEMENT.ACTIVE || m.engagement === MEMBER_ENGAGEMENT.LIMITED)
        .map(m => m.name);

    return Object.freeze({
        ...norm,
        currentPhase: AUTONOMY_PHASES.ARCHIVING,
        finalOutput: Object.freeze({
            title: safeStr(output.title, `${norm.communityName}自治季成果结项`),
            summary: safeStr(output.summary, '全体成员协同努力与克服分歧的共同见证'),
            contributors: Object.freeze(contributors)
        }),
        updatedAt: now
    });
}

/**
 * 模块自检函数
 */
export function communityAutonomySelfCheck() {
    const problems = [];
    if (Object.keys(AUTONOMY_PHASES).length !== 4) {
        problems.push('AUTONOMY_PHASES 必须恰好为 4 个阶段');
    }
    if (Object.keys(MEMBER_ENGAGEMENT).length !== 4) {
        problems.push('MEMBER_ENGAGEMENT 必须恰好为 4 种状态');
    }

    try {
        let season = normalizeCommunitySeason({
            seasonId: 'season_exhibition',
            communityName: '老城旧物研究所',
            seasonGoal: '举办第一届老物件故事微展',
            members: [
                { memberId: 'm_player', name: '玩家', role: '策展顾问' },
                { memberId: 'm_luojia', name: '珞珈', role: '主讲与联络' },
                { memberId: 'm_shuyun', name: '舒芸', role: '场地布置' }
            ]
        });

        // 1. 推进到议事阶段
        season = advanceSeasonPhase(season, AUTONOMY_PHASES.DELIBERATION);
        if (season.currentPhase !== AUTONOMY_PHASES.DELIBERATION) {
            problems.push('自治季推进到议事阶段失败');
        }

        // 2. 发生意见冲突并形成折中决议
        season = deliberateOnIssue(season, {
            topic: '展览门票收费还是免收',
            resolution: '采取免票制，但入口设置自愿打赏明信片箱',
            dissentingOpinions: ['场地维护成本需要硬性门票覆盖']
        });
        if (season.deliberations.length !== 1 || season.deliberations[0].dissentingOpinions.length !== 1) {
            problems.push('议事分歧与决议记录异常');
        }

        // 3. 玩家因故缺席，社团启动替代方案
        season = handleMemberAbsence(season, {
            memberId: 'm_player',
            reason: '出差无法亲临现场布展',
            fallbackAction: '由舒芸全权代理展位摆放，通过邮件同步照片确认',
            isPlayer: true
        });
        const player = season.members.find(m => m.memberId === 'm_player');
        if (!player || player.engagement !== MEMBER_ENGAGEMENT.ABSENT) {
            problems.push('缺席成员状态变更异常');
        }
        if (season.absenceRecords.length !== 1 || !season.absenceRecords[0].isPlayer) {
            problems.push('缺席记录及替代方案留痕异常');
        }

        // 4. 推进攻坚与成果归档
        season = advanceSeasonPhase(season, AUTONOMY_PHASES.EXECUTION);
        season = archiveCommunityOutput(season, {
            title: '《时间裂缝中的老城》展览图录',
            summary: '历时四周，展出 32 件带口述录音的老物件'
        });
        if (season.currentPhase !== AUTONOMY_PHASES.ARCHIVING || !season.finalOutput) {
            problems.push('成果归档状态流转异常');
        }
        if (season.finalOutput.contributors.includes('玩家')) {
            problems.push('已缺席人员被错误列入了实际主要贡献者名单');
        }
    } catch (err) {
        problems.push(`自检运行异常: ${err && err.message ? err.message : String(err)}`);
    }

    return { problems };
}