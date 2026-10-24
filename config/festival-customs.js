/* ========================================================
 * config/festival-customs.js — [R7-X2 · 第七期拓展规划] 城市节庆与习俗内核（纯函数）
 * --------------------------------------------------------
 * 【这一刀治的是什么】
 *   虚构世界如果没有共同时间刻度与集体仪式感，角色之间的互动就容易碎片化；
 *   以往只有冰冷的周期日历提醒，所有角色千篇一律，没有各自的偏好、回忆与缺席后果。
 *   城市节庆与习俗建立“随周期演进的集体仪式与个人记忆”闭环：
 *     ① 节庆传统建模(festivalTradition)：包含筹备阶段(phases)、角色独特偏好/禁忌(characterHabits)、
 *        仪式规范(rituals)与跨届演变历史(editionHistory)；
 *     ② 跨轮次记忆承接：上一轮的难忘事件或遗憾会改变下一轮的筹备意愿；
 *     ③ 缺席后果显式记录(recordAbsence)：错过仪式留下具体的缺席遗憾与他人反应，而非静默跳过；
 *     ④ 传统修订历史恒定性：用户可以编辑甚至废除某项传统规范，但绝不倒抹历史已发生的回忆记录；
 *     ⑤ 零写原则：纯函数输入输出，支持无副作用评估与自检。
 * ======================================================== */

'use strict';

/** 节庆周期类型 */
export const FESTIVAL_CYCLE_TYPES = Object.freeze({
    SEASONAL: 'seasonal',       // 季节节气 (如立春、中秋)
    ANNUAL_MEMORIAL: 'annual',  // 年度纪念日 (如镇庆日、建市纪念)
    MONTHLY_GATHERING: 'monthly', // 月度市集/定期祈福
    CUSTOM_EVENT: 'custom'      // 用户自定义节日
});

/** 节庆阶段 */
export const FESTIVAL_PHASES = Object.freeze({
    DORMANT: 'dormant',         // 尚未到期休眠
    PREPARATION: 'preparation', // 筹备阶段 (置办物资、商讨分工)
    CELEBRATION: 'celebration', // 庆典正日 (仪式举行)
    REFLECTION: 'reflection'    // 事后回顾与余韵
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
 * 规范化角色习俗偏好
 */
export function normalizeCharacterHabit(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const characterId = safeStr(raw.characterId || raw.id);
    if (!characterId) return null;

    return Object.freeze({
        characterId,
        favoriteRitual: safeStr(raw.favoriteRitual, ''),
        tabooOrDislike: safeStr(raw.tabooOrDislike, ''),
        assignedDuty: safeStr(raw.assignedDuty, ''), // 承担的分工 (如采买、司厨、祭祀)
        enthusiasmLevel: Math.max(1, Math.min(5, safeNum(raw.enthusiasmLevel, 3))) // 热情度 1~5
    });
}

/**
 * 规范化节庆历史记录项
 */
export function normalizeEditionRecord(raw, editionIdx = 1) {
    if (!raw || typeof raw !== 'object') return null;
    const edition = safeNum(raw.edition, editionIdx);
    const highlights = Array.isArray(raw.highlights) ? raw.highlights.map(safeStr).filter(Boolean) : [];
    const absences = Array.isArray(raw.absences)
        ? raw.absences.map(a => ({
            characterId: safeStr(a.characterId),
            reason: safeStr(a.reason, '因故未能出席'),
            impact: safeStr(a.impact, '')
        })).filter(a => a.characterId)
        : [];

    return Object.freeze({
        edition,
        yearOrCycle: safeStr(raw.yearOrCycle, `第${edition}届`),
        highlights: Object.freeze(highlights),
        absences: Object.freeze(absences),
        timestamp: safeNum(raw.timestamp, Date.now())
    });
}

/**
 * 规范化节庆传统
 */
export function normalizeFestival(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const festivalId = safeStr(raw.festivalId || raw.id, `fest_${Date.now().toString(36)}`);
    const name = safeStr(raw.name, '未命名节日');
    const cycleTypeValues = Object.values(FESTIVAL_CYCLE_TYPES);
    const cycleType = cycleTypeValues.includes(raw.cycleType) ? raw.cycleType : FESTIVAL_CYCLE_TYPES.ANNUAL_MEMORIAL;

    const phaseValues = Object.values(FESTIVAL_PHASES);
    const currentPhase = phaseValues.includes(raw.currentPhase) ? raw.currentPhase : FESTIVAL_PHASES.DORMANT;

    const characterHabits = Array.isArray(raw.characterHabits)
        ? raw.characterHabits.map(normalizeCharacterHabit).filter(Boolean)
        : [];

    const editionHistory = Array.isArray(raw.editionHistory)
        ? raw.editionHistory.map((h, idx) => normalizeEditionRecord(h, idx + 1)).filter(Boolean)
        : [];

    return Object.freeze({
        festivalId,
        name,
        cycleType,
        currentPhase,
        description: safeStr(raw.description, ''),
        characterHabits: Object.freeze(characterHabits),
        editionHistory: Object.freeze(editionHistory),
        isDeprecated: Boolean(raw.isDeprecated),
        createdAt: safeNum(raw.createdAt, Date.now()),
        updatedAt: safeNum(raw.updatedAt, Date.now())
    });
}

/**
 * 推进到下一届节庆（延续上一届记忆并开启新一轮筹备）
 */
export function advanceToNextEdition(festival, newHighlights = [], absences = [], now = Date.now()) {
    const norm = normalizeFestival(festival);
    if (!norm) return null;

    const nextEditionNum = norm.editionHistory.length + 1;
    const currentRecord = normalizeEditionRecord({
        edition: nextEditionNum - 1,
        yearOrCycle: `第${nextEditionNum - 1}届`,
        highlights: newHighlights,
        absences
    }, nextEditionNum - 1);

    const nextHistory = [...norm.editionHistory, currentRecord];

    return Object.freeze({
        ...norm,
        currentPhase: FESTIVAL_PHASES.PREPARATION,
        editionHistory: Object.freeze(nextHistory),
        updatedAt: now
    });
}

/**
 * 记录缺席及其后果
 */
export function recordAbsence(festival, characterId, reason, impactNote = '', now = Date.now()) {
    const norm = normalizeFestival(festival);
    if (!norm) return festival;
    const cid = safeStr(characterId);
    if (!cid) return festival;

    const lastIdx = norm.editionHistory.length - 1;
    if (lastIdx < 0) {
        // 若尚无历史届次，先补第一届
        const initRec = normalizeEditionRecord({
            edition: 1,
            absences: [{ characterId: cid, reason: safeStr(reason), impact: safeStr(impactNote) }]
        }, 1);
        return Object.freeze({
            ...norm,
            editionHistory: Object.freeze([initRec]),
            updatedAt: now
        });
    }

    const lastRecord = norm.editionHistory[lastIdx];
    const updatedAbsences = [
        ...lastRecord.absences.filter(a => a.characterId !== cid),
        { characterId: cid, reason: safeStr(reason), impact: safeStr(impactNote) }
    ];

    const updatedRecord = Object.freeze({
        ...lastRecord,
        absences: Object.freeze(updatedAbsences)
    });

    const nextHistory = [...norm.editionHistory.slice(0, lastIdx), updatedRecord];

    return Object.freeze({
        ...norm,
        editionHistory: Object.freeze(nextHistory),
        updatedAt: now
    });
}

/**
 * 用户编辑或废除传统（保留已发生历史）
 */
export function deprecateFestival(festival, reason = '', now = Date.now()) {
    const norm = normalizeFestival(festival);
    if (!norm) return festival;
    return Object.freeze({
        ...norm,
        isDeprecated: true,
        description: `${norm.description} (已于历史中废止: ${safeStr(reason)})`.trim(),
        updatedAt: now
    });
}

/**
 * 模块自检函数
 */
export function festivalCustomsSelfCheck() {
    const problems = [];
    if (Object.keys(FESTIVAL_CYCLE_TYPES).length !== 4) {
        problems.push('FESTIVAL_CYCLE_TYPES 必须恰好为 4 种');
    }
    if (Object.keys(FESTIVAL_PHASES).length !== 4) {
        problems.push('FESTIVAL_PHASES 必须恰好为 4 态');
    }

    // 单元自测两轮节庆发生流转
    let fest = normalizeFestival({
        festivalId: 'fest_lantern',
        name: '上元灯会',
        cycleType: 'annual',
        currentPhase: 'preparation',
        characterHabits: [
            { characterId: 'zhou_jie', favoriteRitual: '猜灯谜', assignedDuty: '扎花灯', enthusiasmLevel: 5 },
            { characterId: 'lin_zhou', favoriteRitual: '看焰火', tabooOrDislike: '嫌人多拥挤', enthusiasmLevel: 2 }
        ]
    });

    // 跨两轮流转：第一轮成功举办，林舟缺席
    fest = advanceToNextEdition(fest, ['周姐扎出九莲宝灯夺魁'], [{ characterId: 'lin_zhou', reason: '在后山疗伤闭关', impact: '留下灯谜无人对出的遗憾' }]);
    if (fest.editionHistory.length !== 1) {
        problems.push('跨轮后应累积 1 届历史记录');
    }
    const r1 = fest.editionHistory[0];
    if (r1.absences.length !== 1 || r1.absences[0].characterId !== 'lin_zhou') {
        problems.push('第一轮缺席记录未正确沉淀');
    }

    // 用户废止传统测试：废止后历史记录不应被抹除
    fest = deprecateFestival(fest, '后来沧州城遭战火波及，灯会遂停');
    if (!fest.isDeprecated) {
        problems.push('deprecateFestival 后 isDeprecated 应为 true');
    }
    if (fest.editionHistory.length !== 1) {
        problems.push('废除传统不得破坏历史已发生的举办与缺席记录');
    }

    return { problems };
}