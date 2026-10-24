/* ========================================================
 * config/daily-rhythm.js — [R7-O3 · 第七期规划] 今日节奏编排内核（纯函数）
 * --------------------------------------------------------
 * 【这一刀治的是什么】
 *   用户面对工作、休息、约会和突发消息，常常面临时间冲突与精力透支；
 *   以往日程只能单点添加，无法将周期承诺、精力时段与临时变更协同编排。
 *   今日节奏编排提供可调整、可拒绝的日内节奏草案：
 *     ① 组合日历日程、周期安排、承诺项与精力时段槽位；
 *     ② 检测时段重叠(overlap)与精力过载(energy_overload)；
 *     ③ 突发变更只重排受影响的未锁定事项，严格保留用户锁定项(locked: true)；
 *     ④ 用户可拒绝或延期，记录明确理由；草案态未确认前绝不写入正式日历。
 * ======================================================== */
'use strict';

/** 日内四大精力时段 */
export const RHYTHM_SLOTS = Object.freeze({
    MORNING: 'morning',     // 早间 06:00 - 12:00
    AFTERNOON: 'afternoon', // 午间 12:00 - 18:00
    EVENING: 'evening',     // 晚间 18:00 - 22:00
    NIGHT: 'night'          // 夜间 22:00 - 06:00
});

/** 事项冲突类型 */
export const RHYTHM_CONFLICT_TYPES = Object.freeze({
    NONE: 'none',
    TIME_OVERLAP: 'time_overlap',
    ENERGY_OVERLOAD: 'energy_overload',
    LOCKED_COLLISION: 'locked_collision'
});

/** 事项状态 */
export const RHYTHM_ITEM_STATUS = Object.freeze({
    PLANNED: 'planned',
    LOCKED: 'locked',
    RESCHEDULED: 'rescheduled',
    REJECTED: 'rejected',
    DEFERRED: 'deferred'
});

function safeStr(v) { return String(v == null ? '' : v).trim(); }
function safeNum(v, fallback = 0) {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
}

/**
 * 规范化单个节奏事项
 */
export function normalizeRhythmItem(raw, idx = 0) {
    if (!raw || typeof raw !== 'object') return null;
    const id = safeStr(raw.id) || ('ritem_' + idx);
    const title = safeStr(raw.title) || '未命名事项';
    const slot = Object.values(RHYTHM_SLOTS).includes(raw.slot) ? raw.slot : RHYTHM_SLOTS.MORNING;
    const startMinute = Math.max(0, Math.min(1439, safeNum(raw.startMinute, 540))); // 默认 09:00 (540分)
    const durationMinutes = Math.max(15, Math.min(480, safeNum(raw.durationMinutes, 60)));
    const endMinute = Math.min(1440, startMinute + durationMinutes);

    const locked = Boolean(raw.locked);
    const costEnergy = Math.max(1, Math.min(5, safeNum(raw.costEnergy, 2))); // 精力开销 1-5
    const status = Object.values(RHYTHM_ITEM_STATUS).includes(raw.status)
        ? raw.status
        : (locked ? RHYTHM_ITEM_STATUS.LOCKED : RHYTHM_ITEM_STATUS.PLANNED);

    const source = safeStr(raw.source) || 'calendar';
    const rejectReason = safeStr(raw.rejectReason);

    return Object.freeze({
        id,
        title,
        slot,
        startMinute,
        endMinute,
        durationMinutes,
        locked,
        costEnergy,
        status,
        source,
        rejectReason
    });
}

/**
 * 构建今日节奏草案
 */
export function buildDailyRhythmDraft(items = [], opts = {}) {
    const rawList = Array.isArray(items) ? items : [];
    const normalized = rawList.map((it, idx) => normalizeRhythmItem(it, idx)).filter(Boolean);

    // 按起始时间排序
    normalized.sort((a, b) => a.startMinute - b.startMinute);

    const conflicts = [];
    const maxEnergyPerSlot = safeNum(opts.maxEnergyPerSlot, 8);
    const energyBySlot = {
        [RHYTHM_SLOTS.MORNING]: 0,
        [RHYTHM_SLOTS.AFTERNOON]: 0,
        [RHYTHM_SLOTS.EVENING]: 0,
        [RHYTHM_SLOTS.NIGHT]: 0
    };

    for (let i = 0; i < normalized.length; i++) {
        const cur = normalized[i];
        if (cur.status === RHYTHM_ITEM_STATUS.REJECTED || cur.status === RHYTHM_ITEM_STATUS.DEFERRED) {
            continue;
        }

        energyBySlot[cur.slot] = (energyBySlot[cur.slot] || 0) + cur.costEnergy;

        // 检查与后续事项的时间重叠
        for (let j = i + 1; j < normalized.length; j++) {
            const next = normalized[j];
            if (next.status === RHYTHM_ITEM_STATUS.REJECTED || next.status === RHYTHM_ITEM_STATUS.DEFERRED) {
                continue;
            }
            if (cur.endMinute > next.startMinute) {
                conflicts.push(Object.freeze({
                    type: (cur.locked && next.locked) ? RHYTHM_CONFLICT_TYPES.LOCKED_COLLISION : RHYTHM_CONFLICT_TYPES.TIME_OVERLAP,
                    itemA: cur.id,
                    itemB: next.id,
                    overlapMinutes: cur.endMinute - next.startMinute
                }));
            }
        }
    }

    // 检查精力过载
    for (const [slot, energy] of Object.entries(energyBySlot)) {
        if (energy > maxEnergyPerSlot) {
            conflicts.push(Object.freeze({
                type: RHYTHM_CONFLICT_TYPES.ENERGY_OVERLOAD,
                slot,
                energy,
                limit: maxEnergyPerSlot
            }));
        }
    }

    return Object.freeze({
        date: safeStr(opts.date) || new Date().toISOString().slice(0, 10),
        items: Object.freeze(normalized),
        conflicts: Object.freeze(conflicts),
        hasConflict: conflicts.length > 0,
        energyBySlot: Object.freeze(energyBySlot),
        isCommitted: false // 未确认草案绝不写入正式日历
    });
}

/**
 * 突发变更与局部重排：
 * 规则：遇到冲突时只改动未锁定事项（如顺延或调整时段），用户锁定的事项绝不改动！
 */
export function rescheduleConflict(draft, affectedItemId, newStartMinute) {
    if (!draft || !Array.isArray(draft.items)) return draft;
    const target = draft.items.find(it => it.id === affectedItemId);
    if (!target) return draft;
    if (target.locked) {
        // 锁定的项目不能被强制改动
        return draft;
    }

    const updatedItems = draft.items.map(it => {
        if (it.id !== affectedItemId) return it;
        const newStart = Math.max(0, Math.min(1439, newStartMinute));
        const newEnd = Math.min(1440, newStart + it.durationMinutes);
        return Object.freeze({
            ...it,
            startMinute: newStart,
            endMinute: newEnd,
            status: RHYTHM_ITEM_STATUS.RESCHEDULED
        });
    });

    return buildDailyRhythmDraft(updatedItems, { date: draft.date });
}

/**
 * 用户拒绝某事项（附带理由）
 */
export function rejectRhythmItem(draft, itemId, reason = '') {
    if (!draft || !Array.isArray(draft.items)) return draft;
    const updatedItems = draft.items.map(it => {
        if (it.id !== itemId) return it;
        return Object.freeze({
            ...it,
            status: RHYTHM_ITEM_STATUS.REJECTED,
            rejectReason: safeStr(reason) || '用户选择拒绝'
        });
    });
    return buildDailyRhythmDraft(updatedItems, { date: draft.date });
}

/**
 * 自检函数
 */
export function dailyRhythmSelfCheck() {
    const problems = [];
    if (Object.keys(RHYTHM_SLOTS).length !== 4) problems.push('RHYTHM_SLOTS 必须恰好为 4 槽位');
    if (Object.keys(RHYTHM_CONFLICT_TYPES).length !== 4) problems.push('RHYTHM_CONFLICT_TYPES 必须为 4 类');
    return { problems };
}