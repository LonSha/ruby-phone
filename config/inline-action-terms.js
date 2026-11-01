/* ========================================================
 * config/inline-action-terms.js — [v4.113.0 · R13-X3] 「就地办」的口径与词表（纯数据，零 import）
 * --------------------------------------------------------
 * 【本件为何单独一件】动作条点下去**会真写数据**。所以口径要比别处更保守：
 *   同一个词表既决定「什么时候出条」，也决定「出了之后写什么」，两件事必须同源 ——
 *   否则会出现「条子说加日程、写进去的却是另一件事」这种最难查的错。
 *
 * 【本项把判据定在误报率上，不是召回率上】计划书原文。
 *   理由很硬：误报的代价是**用户点一下就多出一条错数据**，漏报的代价只是「自己手动加一次」。
 *   故提取规则设双重门槛：**时间词与意向词必须同时命中**，只命中一个的句子一律不出条。
 *   宁可少给动作条，不许给出错误动作。
 *
 * 【三 kind 的分界（按「写不写盘」分，不按句子长什么样分）】
 *   schedule  算得出具体 dateKey ⇒ 写日程（这是唯一真写盘的一档）
 *   memo      有时间与意向、但时间只有模糊说法（改天 / 过两天）⇒ 存备忘，不填日期
 *   reply     是问句且带时间或意向 ⇒ 只给一句**草稿**填进输入框，**不替你发**
 *   三档里只有 schedule 会改数据；另两档分别只写备忘 / 只填输入框，且都走可撤销口。
 * ============================================================ */
'use strict';

/** 动作种类（闭集）。 */
export const INLINE_ACTION_KINDS = Object.freeze({
    schedule: 'schedule',
    memo: 'memo',
    reply: 'reply'
});

/** 提取结果的三态（**不是布尔**：「没提取出东西」与「读不出来」处置相反）。 */
export const INLINE_ACTION_STATES = Object.freeze({
    ok: 'ok',                 /* 收到了候选 */
    none: 'none',             /* 读得到、但这句里没有可办的事 */
    unreadable: 'unreadable'  /* 读不出来（没 id / 没时钟 / 宿主缺） */
});

/** 丢弃因由（闭集，逐条给人话；判据要求因由非空）。 */
export const INLINE_ACTION_WHY = Object.freeze({
    noMsgId: 'no-msg-id',        /* 这条消息没有 id ⇒ 回不了源、也无法撤销 */
    noTime: 'no-time',           /* 没有时间词 */
    noIntent: 'no-intent',       /* 没有意向词 */
    noTitle: 'no-title',         /* 去掉时间与意向词后什么都不剩 */
    clockMissing: 'clock-missing', /* 剧情钟读不到 ⇒ 算不出 dateKey */
    tooLong: 'too-long'          /* 标题超长 */
});

/** 限额（都要写进读数，不静默截）。 */
export const INLINE_ACTION_LIMITS = Object.freeze({
    maxPerMsg: 3,        /* 一条消息最多给三个动作，多了就是噪声 */
    titleMaxChars: 60,
    maxScanMsgs: 200,    /* 只扫尾部消息：动作条是「刚说的那句」上的东西 */
    maxDaysAhead: 30     /* 超过一个月的日期不自动填（多半是误会） */
});

/** 星期表（索引 0 = 星期日，与 Date.getDay 同序 —— 不另立一套序号）。 */
export const INLINE_ACTION_WEEKDAYS = Object.freeze([
    '星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'
]);

/** 星期字（周X / 星期X / 礼拜X 里的那个字）。 */
export const INLINE_ACTION_WEEKDAY_CHARS = Object.freeze({
    '日': 0, '天': 0, '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6
});

/**
 * 能算出具体日子的时间词（正则源串，编译在算法件；此处只放数据）。
 * 每项：name + re + kind（offset / weekday / clock）
 *   offset  —— 相对今天的天数（今/明/后/大后天）
 *   weekday —— 周几（周X / 星期X / 礼拜X，可带「下」）
 *   clock   —— 具体时刻（21:14 / 晚上八点半）
 */
export const INLINE_ACTION_TIME_RULES = Object.freeze([
    Object.freeze({ name: 'day', re: '(大后天|后天|明天|今天|今日|明日)', kind: 'offset' }),
    Object.freeze({ name: 'eve', re: '(今晚|明晚)', kind: 'offset' }),
    Object.freeze({ name: 'weekday', re: '(下|这|本)?(?:周|星期|礼拜)([日天一二三四五六])', kind: 'weekday' }),
    Object.freeze({ name: 'clock', re: '([0-9]{1,2})[:：]([0-9]{2})', kind: 'clock' }),
    Object.freeze({ name: 'point', re: '(上午|下午|晚上|中午|早上)?([0-9一二三四五六七八九十]{1,2})点(半|一刻|三刻)?', kind: 'clock' })
]);

/** 模糊时间词：命中它们就**不能**填日期（只能进 memo 档）。 */
export const INLINE_ACTION_VAGUE_WORDS = Object.freeze([
    '改天', '过两天', '回头', '有空的时候', '这几天', '最近几天', '以后', '有时间', '看情况'
]);

/** 意向词：命中才算「这句在约事」。**只在被问句或邀约句包住时才算**，见算法件。 */
export const INLINE_ACTION_INTENT_WORDS = Object.freeze([
    '有空', '来不来', '一起', '约', '帮我', '记得', '别忘了', '要不要', '方便吗',
    '能不能', '聚一聚', '见面', '过来', '安排'
]);

/** 问句标记（reply 档用它；两档分开写是为了不让「随便一个问号」都长出回一句按钮）。 */
export const INLINE_ACTION_ASK_MARKS = Object.freeze(['吗', '呢', '?', '？', '吧']);

/** 回一句的草稿（按命中词挑，不生成新句子 —— 生成要模型，模型会编）。 */
export const INLINE_ACTION_DRAFTS = Object.freeze([
    Object.freeze({ when: ['有空', '方便吗'], text: '有空' }),
    Object.freeze({ when: ['来不来', '一起去', '一起'], text: '我去' }),
    Object.freeze({ when: ['要不要'], text: '要' }),
    Object.freeze({ when: ['能不能', '帮我'], text: '好' })
]);

/** 开关的存储键（**单独一条 `*_KEY` 常量**）。
 *   为何不把字面量藏在对象属性里：keys 门按 `*_KEY` / `storageKey` 这类**常量声明**抽键面，
 *   藏在 `{ key: '...' }` 里它看不见 —— 看不见就等于这个键从来没有被问过归属。
 *   故真源在这里，`INLINE_ACTION_TOGGLE.key` 只是转引，不另写一份。 */
export const INLINE_ACTION_TOGGLE_KEY = 'phone_inline_action_enabled';

/** 开关：整条动作条由它一键控制；关掉后界面与未接本项时逐字一致（判据钉住）。 */
export const INLINE_ACTION_TOGGLE = Object.freeze({
    /* ★ 真源是上方那条独立常量：keys 门按 `*_KEY` 常量声明抽键面，藏在对象属性里它看不见。 */
    key: INLINE_ACTION_TOGGLE_KEY,
    defaultOn: true
});

/** 人话标签（视图不手写第二份）。 */
export const INLINE_ACTION_LABEL = Object.freeze({
    schedule: '加日程',
    memo: '记到备忘',
    reply: '回一句',
    done: '已办',
    undo: '撤销'
});
