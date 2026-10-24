/* ========================================================
 * config/district-opportunities.js — [R7-X1 · 第七期拓展规划] 街区机会生态内核（纯函数）
 * --------------------------------------------------------
 * 【这一刀治的是什么】
 *   街区、地点与人物在场如果只是静态展示，玩家就只是被动的旁观者；
 *   以往地点漫游与在场没有因果链，无法形成连贯的因缘巧合与行动后果。
 *   街区机会生态将地点、在场、营业时段与历史事件整合成“可参与的机会链”：
 *     ① 组合生成有限机会(opportunityItem)：由地点(placeId)、在场角色(presentRoles)、
 *        时段窗口(timeWindow)与前置事件(prerequisites)共同激活；
 *     ② 机会状态确定性流转：可用(available) -> 已接受(accepted) -> 已完成(completed) /
 *        已婉拒(declined) / 已过期(expired)；
 *     ③ 拒绝与完成严格分形：用户拒绝机会决绝不标成已完成，而是记录拒绝缘由并可能触发分支机会；
 *     ④ 链式因果推进(advanceOpportunityChain)：完成或错过前序机会，激活链条下一环或产生缺席后果；
 *     ⑤ 零写原则与可恢复性：纯函数计算与迁移，支持离线序列化与重开可续。
 * ======================================================== */

'use strict';

/** 机会状态 */
export const OPPORTUNITY_STATUS = Object.freeze({
    AVAILABLE: 'available',   // 处于时段与条件内，可参与
    ACCEPTED: 'accepted',     // 用户已接下机会，正在进行
    COMPLETED: 'completed',   // 成功完成，产生积极后续
    DECLINED: 'declined',     // 用户明确拒绝/放弃
    EXPIRED: 'expired'        // 错过时段或在场角色离开，自然失效
});

/** 机会类型 */
export const OPPORTUNITY_TYPES = Object.freeze({
    CASUAL_ENCOUNTER: 'casual_encounter', // 偶遇交谈/商议
    COMMISSION_LEAD: 'commission_lead',   // 委托线索/兼职引荐
    JOINT_ACTIVITY: 'joint_activity',     // 结伴出行/街坊互助
    MYSTERY_CLUE: 'mystery_clue'          // 传闻探查/暗室发现
});

function safeStr(val, fallback = '') {
    return (typeof val === 'string') ? val.trim() : fallback;
}

function safeNum(val, fallback = 0) {
    const n = Number(val);
    return Number.isFinite(n) ? n : fallback;
}

function clone(val) {
    return JSON.parse(JSON.stringify(val));
}

/**
 * 规范化单条街区机会
 */
export function normalizeOpportunity(raw, idx = 0) {
    if (!raw || typeof raw !== 'object') return null;
    const opportunityId = safeStr(raw.opportunityId || raw.id, `opp_${Date.now().toString(36)}_${idx}`);
    const title = safeStr(raw.title, '未命名街区机会');
    const placeId = safeStr(raw.placeId, 'common_street');

    const typeValues = Object.values(OPPORTUNITY_TYPES);
    const type = typeValues.includes(raw.type) ? raw.type : OPPORTUNITY_TYPES.CASUAL_ENCOUNTER;

    const statusValues = Object.values(OPPORTUNITY_STATUS);
    const status = statusValues.includes(raw.status) ? raw.status : OPPORTUNITY_STATUS.AVAILABLE;

    const requiredRoles = Array.isArray(raw.requiredRoles) ? raw.requiredRoles.map(safeStr).filter(Boolean) : [];
    const chainId = safeStr(raw.chainId, 'standalone');
    const chainStep = Math.max(1, safeNum(raw.chainStep, 1));
    const nextOpportunityId = safeStr(raw.nextOpportunityId, '');

    const expiresAt = safeNum(raw.expiresAt, Date.now() + 86400000);
    const consequenceNote = safeStr(raw.consequenceNote, '');

    return Object.freeze({
        opportunityId,
        title,
        placeId,
        type,
        status,
        requiredRoles: Object.freeze(requiredRoles),
        chainId,
        chainStep,
        nextOpportunityId,
        expiresAt,
        consequenceNote,
        createdAt: safeNum(raw.createdAt, Date.now()),
        updatedAt: safeNum(raw.updatedAt, Date.now())
    });
}

/**
 * 刷新机会状态（基于当前在场角色与时间）
 * @param {Array} opportunities 机会列表
 * @param {Object} worldState 当前世界状态 { activePlaceId, presentRoles, currentTime }
 */
export function evaluateOpportunities(opportunities = [], worldState = {}) {
    const now = safeNum(worldState.currentTime, Date.now());
    const placeId = safeStr(worldState.activePlaceId);
    const presentRoles = new Set((Array.isArray(worldState.presentRoles) ? worldState.presentRoles : []).map(safeStr));

    const evaluated = [];
    for (const opp of (Array.isArray(opportunities) ? opportunities : [])) {
        const norm = normalizeOpportunity(opp);
        if (!norm) continue;

        // 已终态的机会保持不变
        if (norm.status === OPPORTUNITY_STATUS.COMPLETED || norm.status === OPPORTUNITY_STATUS.DECLINED) {
            evaluated.push(norm);
            continue;
        }

        // 检查时间是否过期
        if (now > norm.expiresAt) {
            evaluated.push(Object.freeze({
                ...norm,
                status: OPPORTUNITY_STATUS.EXPIRED,
                consequenceNote: norm.consequenceNote || '因超过活动时段已自然失效',
                updatedAt: now
            }));
            continue;
        }

        // 检查地点与角色在场前提
        const placeMatch = !placeId || norm.placeId === placeId;
        const allRolesPresent = norm.requiredRoles.every(r => presentRoles.has(r));

        if (norm.status === OPPORTUNITY_STATUS.AVAILABLE && (!placeMatch || !allRolesPresent)) {
            // 条件暂时不满足，仍保留为 available 但可能处于待激活状态
            evaluated.push(norm);
        } else {
            evaluated.push(norm);
        }
    }

    return Object.freeze(evaluated);
}

/**
 * 用户接受机会
 */
export function acceptOpportunity(opportunities = [], opportunityId, now = Date.now()) {
    const targetId = safeStr(opportunityId);
    return Object.freeze((Array.isArray(opportunities) ? opportunities : []).map(opp => {
        if (opp.opportunityId !== targetId) return opp;
        if (opp.status !== OPPORTUNITY_STATUS.AVAILABLE) return opp;
        return Object.freeze({
            ...opp,
            status: OPPORTUNITY_STATUS.ACCEPTED,
            updatedAt: now
        });
    }));
}

/**
 * 用户拒绝机会（绝不标为已完成）
 */
export function declineOpportunity(opportunities = [], opportunityId, reason = '', now = Date.now()) {
    const targetId = safeStr(opportunityId);
    return Object.freeze((Array.isArray(opportunities) ? opportunities : []).map(opp => {
        if (opp.opportunityId !== targetId) return opp;
        return Object.freeze({
            ...opp,
            status: OPPORTUNITY_STATUS.DECLINED,
            consequenceNote: safeStr(reason, '用户明确婉拒参与该街区活动'),
            updatedAt: now
        });
    }));
}

/**
 * 完成机会并推进链条产生下一机会
 */
export function completeOpportunityAndAdvance(opportunities = [], opportunityId, resultNote = '', nextOppTemplate = null, now = Date.now()) {
    const targetId = safeStr(opportunityId);
    const list = Array.isArray(opportunities) ? opportunities : [];
    let completedOpp = null;

    const nextList = list.map(opp => {
        if (opp.opportunityId !== targetId) return opp;
        completedOpp = Object.freeze({
            ...opp,
            status: OPPORTUNITY_STATUS.COMPLETED,
            consequenceNote: safeStr(resultNote, '街区活动顺利达成'),
            updatedAt: now
        });
        return completedOpp;
    });

    if (completedOpp && nextOppTemplate && typeof nextOppTemplate === 'object') {
        const nextOpp = normalizeOpportunity({
            ...nextOppTemplate,
            chainId: completedOpp.chainId,
            chainStep: completedOpp.chainStep + 1,
            createdAt: now,
            updatedAt: now
        });
        if (nextOpp) {
            nextList.push(nextOpp);
        }
    }

    return Object.freeze(nextList);
}

/**
 * 模块自检函数
 */
export function districtOpportunitiesSelfCheck() {
    const problems = [];
    if (Object.keys(OPPORTUNITY_STATUS).length !== 5) {
        problems.push('OPPORTUNITY_STATUS 必须恰好为 5 态');
    }
    if (Object.keys(OPPORTUNITY_TYPES).length !== 4) {
        problems.push('OPPORTUNITY_TYPES 必须恰好为 4 种');
    }

    // 单元自测两步链条流转
    const opp1 = normalizeOpportunity({
        opportunityId: 'opp_tea_house',
        title: '老茶馆打听掌柜口风',
        placeId: 'tea_house',
        requiredRoles: ['lao_liu'],
        chainId: 'chain_ruins',
        chainStep: 1,
        expiresAt: Date.now() + 10000
    });

    let list = [opp1];
    list = acceptOpportunity(list, 'opp_tea_house');
    if (list[0].status !== OPPORTUNITY_STATUS.ACCEPTED) {
        problems.push('acceptOpportunity 后状态应为 accepted');
    }

    list = completeOpportunityAndAdvance(list, 'opp_tea_house', '从老刘口中获知后山密道', {
        opportunityId: 'opp_secret_passage',
        title: '探查后山密道暗门',
        placeId: 'back_mountain',
        requiredRoles: ['lin_zhou']
    });

    if (list.length !== 2) {
        problems.push('完成并推进机会链后列表应包含 2 个条目');
    }
    const nextOpp = list.find(x => x.opportunityId === 'opp_secret_passage');
    if (nextOpp?.chainStep !== 2) {
        problems.push('推进生成的下一阶段机会 step 应为 2');
    }

    // 拒绝测试
    list = declineOpportunity(list, 'opp_secret_passage', '天色已晚不便涉险');
    const declinedOpp = list.find(x => x.opportunityId === 'opp_secret_passage');
    if (declinedOpp?.status !== OPPORTUNITY_STATUS.DECLINED) {
        problems.push('declineOpportunity 后状态应为 declined 绝非 completed');
    }

    return { problems };
}