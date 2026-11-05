/* ========================================================
 * config/shared-chore-terms.js — [v4.125.0 · R14-X4] 共同清单的口径与词表（纯数据，零 import）
 * --------------------------------------------------------
 * 【本件为何单独一件】R14-X4 的验收旅程有四条不许含糊的边界：
 *   ① 甲代办不自动宣告乙付钱 —— 代办只改「谁执行」，不碰「谁出钱」；
 *   ② 部分完成保留余项 —— 部分完成是**子项级**状态，不等于整条 done；
 *   ③ 作废不改账 —— 作废是「这件事不做了」，分摊与财务记录一字不动；
 *   ④ 分摊总额守恒、未确认不扣款 —— 分摊只是**草案**，落钱走原 finance-commit。
 * 词表先成文，再写状态机：状态闭集外的值一律归 unknown 并具名，不猜。
 * ============================================================ */
'use strict';
/** 共同事项六态（闭集）。
 *   draft：刚建，还没分派；assigned：已分派到人；partial：部分子项完成；
 *   done：全员子项都完成；cancelled：作废（不改账）；unknown：读不出来。 */
export const SC_STATES = Object.freeze({
    draft: 'draft',
    assigned: 'assigned',
    partial: 'partial',
    done: 'done',
    cancelled: 'cancelled',
    unknown: 'unknown'
});
/** 因由词表（why 只许取这里的值；判据逐词核）。 */
export const SC_WHY = Object.freeze({
    ok: '',
    noId: 'no-id',
    noTitle: 'no-title',
    noMembers: 'no-members',
    noAssignee: 'no-assignee',
    notInvolved: 'not-involved',
    notFound: 'not-found',
    alreadyDone: 'already-done',
    alreadyCancelled: 'already-cancelled',
    notAssigned: 'not-assigned',
    subNotFound: 'sub-not-found',
    subAlreadyDone: 'sub-already-done',
    badSplit: 'bad-split',
    badShape: 'bad-shape',
    unknownState: 'unknown-state'
});
/** 分摊行状态：草案（未确认）→ 已确认（落账走 finance-commit，本项只产 draft）。
 *   ★ 未确认的分摊行**永远不许**出现在「已付」读数里。 */
export const SC_SPLIT_STATES = Object.freeze({
    draft: 'draft',
    confirmed: 'confirmed',
    waived: 'waived'
});
/** 上限（都要写进读数，不静默截）。 */
export const SC_LIMITS = Object.freeze({
    chores: 40,
    titleChars: 40,
    noteChars: 80,
    members: 12,
    subs: 12,
    splits: 12,
    amountMax: 1000000
});
/** 人话标签（视图不手写第二份）。 */
export const SC_LABEL = Object.freeze({
    draft: '未分派',
    assigned: '进行中',
    partial: '部分完成',
    done: '已完成',
    cancelled: '已作废',
    unknown: '状态不明',
    delegate: '代办',
    finishSub: '完成这项',
    cancel: '作废',
    confirmSplit: '确认分摊',
    waiveSplit: '不出这份'
});
/** 存储键（独立常量；会话族前缀 ^aff —— 共同清单装的是「这段对话里这几个人欠着的事」，落全局会串场）。 */
export const SC_KEY = 'affairs_shared_chores_v1';
