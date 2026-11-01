/* ========================================================
 * config/errand-terms.js — [v4.114.0 · R13-X7] 「这个月要处理的」口径与词表（纯数据，零 import）
 * --------------------------------------------------------
 * 【本件为何单独一件】待办的生命周期一旦写错，用户看到的是一张**看起来没坏**的清单：
 *   条目还在、日期也对，只是「早该过期了」或「办完了没留回执」。这类错读数没有报错、
 *   不崩界面，只会让用户以为「手机替我把事管住了」—— 而这恰好是本项唯一的价值。
 *   故口径（状态闭集 / 因由闭集 / 四个上限 / 可办 app 表）先成文，再写状态机。
 *
 * 【为什么「过期」只是**一条后果事件**，不是自动扣钱】
 *   过期是时间推到的事实（钱没交、网该断），而扣钱是**不可逆动作**。二者的处置相反：
 *   前者只能如实记账，后者必须玩家在场点头（与本仓回收站那条「不可逆要单独设计」同源）。
 *   故 consequence 只有 { kind, text, at, acked } 四个字段，**没有金额格**：
 *   没有金额格，就没有任何一条路径能把「过期」悄悄变成「已扣款」。
 *
 * 【四态互不同形】pending / done / expired / waived 四态处置两两不同：
 *   待办：还能办；已办：有回执、可撤回；过期：只能承认后果（或豁免）；豁免：用户说这事不办。
 *   把 expired 与 waived 压成一格，用户就分不清「我放弃了」与「我错过了」。
 * ======================================================== */
'use strict';

/** 四态（闭集；不认识的一律归 unknown 并具名，不猜）。 */
export const ERRAND_STATES = Object.freeze({
    pending: 'pending',
    done: 'done',
    expired: 'expired',
    waived: 'waived',
    unknown: 'unknown'
});

/** 归因词表（why 只许取这里的值；判据逐词核）。 */
export const ERRAND_WHY = Object.freeze({
    ok: '',
    noId: 'no-id',
    noTitle: 'no-title',
    noDue: 'no-due',
    badDue: 'bad-due',
    alreadyDone: 'already-done',
    alreadyExpired: 'already-expired',
    notPending: 'not-pending',
    notFound: 'not-found',
    unknownState: 'unknown-state',
    badShape: 'bad-shape'
});

/** 后果事件的类别（受控词表；本项**只给机制**，具体后果文字由各 app 自己写）。 */
export const ERRAND_CONSEQUENCE_KINDS = Object.freeze({
    remind: 'remind',        /* 催一下（房东催 / 客服催） */
    suspend: 'suspend',      /* 服务暂停（断网 / 停水） */
    lose: 'lose',            /* 名额被占（预约过期） */
    none: 'none'             /* 没有后果（如订阅自动续费失败但无惩罚） */
});

/** 上限（都要写进读数，不静默截）。 */
export const ERRAND_LIMITS = Object.freeze({
    errands: 60,
    titleChars: 40,
    consequenceChars: 120,
    receipts: 60,
    monthRows: 40
});

/** 可办的 app（清单上每一条都得指向一个真能跳的地方；写不出目标就不许生成条目）。 */
export const ERRAND_APPS = Object.freeze({
    accounting: '记账',
    calendar: '日历',
    health: '健康',
    shop: '商城',
    taobao: '桃宝',
    affairs: '事务台'
});

/** 人话标签（视图不手写第二份）。 */
export const ERRAND_LABEL = Object.freeze({
    pending: '待办',
    done: '已办',
    expired: '过期',
    waived: '已豁免',
    unknown: '状态不明',
    doIt: '办掉',
    waive: '不办',
    undo: '撤回',
    ack: '知道了'
});

/** 存储键（**独立常量**：keys 门按 *_KEY 常量声明抽键面）。
 *   刻意命中会话族前缀 ^aff：这张清单装的是「这个角色这段对话里欠着的事」，
 *   落全局会把上一个角色的房租贴到新会话里（与 affairs_v1 同族静默错串）。 */
export const ERRAND_KEY = 'affairs_errands_v1';

/** 创建条目时的默认后果（让「没填后果」不等于「没后果」—— 二者处置相反）。 */
export const ERRAND_DEFAULT_CONSEQUENCE = Object.freeze({
    kind: ERRAND_CONSEQUENCE_KINDS.remind,
    text: '这件事一直没办'
});
