/* ========================================================
 * config/today-terms.js — [v4.112.0 · R13-X1] 「今天」的口径与词表（纯数据，零 import）
 * --------------------------------------------------------
 * 【为什么口径要单独一件】「今天」这个词听起来无害，实际藏着三个必须**先定死**的决定：
 *   ① 边界怎么切（0 点 / 睡眠周期 / 世界历）—— 本仓同时有两个钟，切错了排出来的顺序是错的；
 *   ② 排序用哪个钟（剧情钟 vs 墙钟）—— 混用会让同一场雨落在两个时刻；
 *   ③ 「没有」与「接不上」怎么分（真没发生 vs 这个 App 还没接进来）。
 *   这三件事都会被人反复调整，而它们与聚合算法分开，才能保证调边界不会动到排序。
 *
 * 【本件守的边界（计划书要求「先定死并写进条目」，这里就是那个定死的地方）】
 *   边界：**剧情日的 0 点切**。理由三条：
 *     · 本仓用户读到的每一个时刻都是剧情时刻（`config/time-source.js` 的 FIELD_CLOCKS
 *       已把 timestamp / storyAt / dateKey 全判给剧情钟）；
 *     · 「今天」是给人看的词，人看的钟就是剧情钟 —— 用墙钟切会把「剧情里 1943 年的一晚」
 *       切成两半；
 *     · 睡眠周期切与世界历切都**需要一个本仓当前没有的权威定义**（谁的作息？哪本历？），
 *       没有定义就实现，等于把不确定藏进代码里。
 *   剧情钟读不到时**不退回墙钟**：退回就是把「1943 年的今天」读成「2026 年的今天」，
 *   而那是本仓已列的最贵错读数之一。此时如实报 `no-clock`，并说明「边界今天定不下来」。
 * ============================================================ */
'use strict';

/** 聚合结果的五态（**不是布尔**：「没接进来」与「今天真的没事」处置相反）。 */
export const TODAY_STATES = Object.freeze({
    ok: 'ok',                 /* 有事件 */
    empty: 'empty',           /* 今天真的什么都没发生（各源都接上了，只是空） */
    partly: 'partly',         /* 有的源接上了、有的没接（**不许当 empty**） */
    absent: 'absent',         /* 一个源都没接（取数面本身不在） */
    noClock: 'no-clock'       /* 剧情钟读不到 ⇒ 边界定不下来，不排时间轴 */
});

/** 单个源的状态（逐一给人话；这些词会直接摆在页面上）。 */
export const TODAY_SOURCE_STATES = Object.freeze({
    ok: 'ok',                 /* 接上了、读到了 */
    absent: 'absent',         /* 这个 App 还没接入今天（不是「今天没事」） */
    error: 'error'            /* 接了但取数抛错（读不出来 ≠ 没有） */
});

/** 源名（闭集）。顺序即**同刻并列时的稳定次序**：先消息，后日程、日记、照片。 */
export const TODAY_SOURCES = Object.freeze(['wechat', 'calendar', 'diary', 'album']);

/** 每个源的人话标签（键面取真源，视图不手写第二份）。 */
export const TODAY_SOURCE_LABEL = Object.freeze({
    wechat: '消息',
    calendar: '日程',
    diary: '日记',
    album: '照片'
});

/** 事件种类（闭集）。与 life-events 的 type 词表**不重叠也不替换**：那是事件档案，这是当天流水。 */
export const TODAY_KINDS = Object.freeze({
    message: 'message',
    memo: 'memo',
    diary: 'diary',
    photo: 'photo'
});

/**
 * 限额。
 * `maxEvents` 40：一屏能读下来的上限；超出的**如实报被截断多少条**，不许静默截断。
 * `sameAtTieBreak` 见排序口径（同刻按源序 + 源内序号，保证两次跑逐字相同）。
 */
export const TODAY_LIMITS = Object.freeze({
    maxEvents: 40,
    titleMaxChars: 60
});

/** 排序口径（写在数据里，算法件必须真读它 —— 否则这句声明就是假的）。 */
export const TODAY_ORDER = Object.freeze({
    /** 时间轴方向：最近的在前（`byRecentFirst:false` 即时间正序）。 */
    byRecentFirst: true
});
