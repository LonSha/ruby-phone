/* ========================================================
 * config/vague-recall-terms.js — [v4.110.0 · R13-X2] 模糊回忆的词表（纯数据，零 import）
 * --------------------------------------------------------
 * 【为什么词表要单独一件】主件 `vague-recall.js` 的算法只有一百多行，
 *   而词表本身占了一半体积。计划书的硬约束是「新内核单件 ≤ 12K，超出必须拆」，
 *   拆词表是**唯一不损伤算法的切法**：改词不必碰算法，改算法不必读词表。
 *
 * 【与 apps/weather 的关系（两边**不是**副本）】那边 `WEATHER_CODES` 是「WMO 码 → 大类」，
 *   本表是「用户口语 → 大类」—— 回答的问题不同。类名刻意同字面（rain/snow/clear/cloud/fog），
 *   但本件**不 import apps**（config 不许反向依赖业务模块，否则内核钉在 App 上）。
 * ============================================================ */
'use strict';

/** 一句话解析的两种结局：**不是**布尔 —— 「没听懂」与「听懂了但没命中」处置相反。 */
export const VAGUE_STATES = Object.freeze({ ok: 'ok', unresolved: 'unresolved' });

/** 命中因由的四类（闭集：`why[].kind` 只能取这里的值）。 */
export const VAGUE_WHY_KINDS = Object.freeze(['weather', 'time', 'actor', 'keyword']);

/** 天气词 → 大类。**长词优先**（`下雨` 先于 `雨`、`雷阵雨` 先于 `雨`）。 */
export const WEATHER_WORDS = Object.freeze([
    Object.freeze({ word: '雷阵雨', kind: 'thunder' }),
    Object.freeze({ word: '下雨', kind: 'rain' }),
    Object.freeze({ word: '雨', kind: 'rain' }),
    Object.freeze({ word: '下雪', kind: 'snow' }),
    Object.freeze({ word: '雪', kind: 'snow' }),
    Object.freeze({ word: '晴天', kind: 'clear' }),
    Object.freeze({ word: '晴', kind: 'clear' }),
    Object.freeze({ word: '阴天', kind: 'cloud' }),
    Object.freeze({ word: '多云', kind: 'cloud' }),
    Object.freeze({ word: '起雾', kind: 'fog' }),
    Object.freeze({ word: '雾', kind: 'fog' }),
    Object.freeze({ word: '刮风', kind: 'wind' }),
    Object.freeze({ word: '打雷', kind: 'thunder' })
]);

/**
 * 能切成**硬区间**的相对词 → 往前几天。
 * 与 `config/search-facets.js` 的 `FACET_TIME_WORDS` **同一份口径**（那边是筛选层，这边是回忆层）。
 */
export const VAGUE_TIME_WORDS = Object.freeze({
    '这几天': 7, '这些天': 7, '最近': 7, '前几天': 7,
    '前阵子': 30, '那阵子': 30, '这阵子': 30
});

/**
 * **没有确定边界**的指代词：**不切区间**，只当排序偏好。
 * 为什么不切：「上次」本就没边界，硬切一个区间会让范围外的记录静默消失。
 */
export const VAGUE_SOFT_TIME = Object.freeze(['上次', '上回', '有一回', '那天', '那次', '当时', '那时候', '之前', '以前']);

/** 代词：**不换算成具体人**（谁是她，只有上下文知道；猜错就是「按不存在的人名筛出空」）。 */
export const VAGUE_PRONOUNS = Object.freeze(['她们', '他们', '她', '他', 'ta', 'TA', 'Ta']);

export const VAGUE_LIMITS = Object.freeze({
    /** 一次最多交回多少条（`total` 仍报真实命中数）。 */
    maxRows: 60,
    /** 语义残余最多取几个词（再多就不叫「模糊」了）。 */
    maxRest: 6,
    /** 「近期」的默认窗口：30 天（相对指代只在排序上加分，不筛）。 */
    recentMs: 30 * 86400000,
    /** 语义残余词的最小长度：**单字不当条件**（「说」「的」这种字到处都是，当条件等于没筛）。 */
    minRestLen: 2,
    /**
     * 残余词的 bigram **覆盖率阈值**（0~1）。
     * 为什么不要求全覆盖：中文没有词边界，用户连着打的「那天搬家」是一个整块，
     *   而记录里这几个字通常不连续（「那天雨很大，她说要搬家」）。全覆盖会把真命中全判掉；
     *   完全不要求覆盖又等于「有几个字对上就算」—— 半数是一条能说清的分界线，
     *   并且它**不是**相关性打分：本阈值只决定「算不算提过这件事」。
     */
    restCover: 0.5
});
