/* ========================================================
 * honey-text-core.js — [v4.191.0] 蜜语 文本清洗与数值钳制 · 纯函数内核
 *
 * 职责：把 honey-data.js 里那批「给定一段文本/一个数 ⇒ 给定一个结论」的
 *   清洗面抽出来：HTML 剥除、空白：折叠、长度截断、好感度/参考值钳制、
 *   参考图归一、评论行归一、状态行识别。
 * 为什么不动 honey-data.js 那个 5228 行的类：HoneyData 构造器接 storage，
 *   持一票全局社交键与 _lyricCache 同类缓存，generate* 一族全是 async
 *   且自己 window 兜底取时钟 —— 是有副作用的编排。本件只包纯清洗面。
 *
 * 纪律：本件不碰随机源、不自己读系统时钟、不碰 DOM / 存储 / 网络、没有类。
 * ======================================================== */
'use strict';

/** 内联文本默认截断长度（源类口径）。 */
export const HONEY_TEXT_LIMITS = Object.freeze({
    inlineDefault: 260,
    favorabilityMin: 0,
    favorabilityMax: 100,
    favorabilityStep: 10,
    referenceStep: 100
});

/** 评论行等级前缀的字数上限（源类口径：【】/[] 内 1~16 字）。 */
export const HONEY_COMMENT_LIMITS = Object.freeze({
    rankMaxLen: 16,
    userMaxLen: 24
});

/* ══════════ 文本清洗三兄弟 ══════════ */

/**
 * 剥 HTML 标签、折叠连续空白、去首尾空白，再按 maxLen 截断。
 *
 * @param {*} value
 * @param {number} [maxLen]
 * @returns {string}
 */
export function sanitizeInlineText(value, maxLen = HONEY_TEXT_LIMITS.inlineDefault) {
    return String(value == null ? '' : value)
        .replace(/<[^>]*>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, maxLen);
}

/**
 * 提示词单行：剥 HTML、折叠空白，不截断。
 *
 * @param {*} value
 * @returns {string}
 */
export function sanitizePromptLine(value = '') {
    return String(value == null ? '' : value)
        .replace(/<[^>]*>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * 提示词块行：剥 HTML、去回车，保留换行以外的原样。
 *
 * @param {*} value
 * @returns {string}
 */
export function sanitizePromptBlockLine(value = '') {
    return String(value == null ? '' : value)
        .replace(/<[^>]*>/g, ' ')
        .replace(/\r/g, '')
        .trim();
}

/* ══════════ 数值钳制 ══════════ */

/**
 * 好感度：0~100，保留一位小数；读不出给 fallback（不编 0）。
 *
 * @param {*} value
 * @param {number|null} fallback
 * @returns {number}
 */
export function clampFavorability(value, fallback = 0) {
    const num = Number.parseFloat(value);
    if (!Number.isFinite(num)) return fallback;
    const clamped = Math.max(HONEY_TEXT_LIMITS.favorabilityMin,
        Math.min(HONEY_TEXT_LIMITS.favorabilityMax, num));
    return Math.round(clamped * HONEY_TEXT_LIMITS.favorabilityStep) / HONEY_TEXT_LIMITS.favorabilityStep;
}

/**
 * 参考值（0~1 之类）：按 min/max 钳制，保留两位小数。
 *
 * @param {*} value
 * @param {number} fallback
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
export function clampReferenceValue(value, fallback = 0.7, min = 0, max = 1) {
    const num = Number.parseFloat(value);
    if (!Number.isFinite(num)) return fallback;
    const clamped = Math.max(min, Math.min(max, num));
    return Math.round(clamped * HONEY_TEXT_LIMITS.referenceStep) / HONEY_TEXT_LIMITS.referenceStep;
}

/* ══════════ 参考图归一 ══════════ */

/**
 * 只放行 http(s) 与站内 backgrounds/ 路径；data: 内联图与占位串一律退回 ''。
 *
 * @param {*} value
 * @returns {string}
 */
export function normalizeNaiReferenceImage(value) {
    const raw = String(value == null ? '' : value).trim();
    if (!raw || raw === '[object Object]' || raw === 'undefined' || raw === 'null') return '';
    if (/^data:image\/[a-z0-9.+-]+;base64,/i.test(raw)) return '';
    if (/^(?:https?:\/\/|\/backgrounds\/)/i.test(raw)) return raw;
    return '';
}

/* ══════════ 评论行归一 ══════════ */

/**
 * 是不是「好感度状态行」（这类行不是评论，要从评论区剔掉）。
 *
 * @param {string} line
 * @returns {boolean}
 */
export function isCommentStatusLine(line = '') {
    const text = String(line == null ? '' : line).trim();
    if (!text) return true;
    if (/^(?:当前)?好感(?:度|值)\s*[:：]/.test(text)) return true;
    if (/^(?:热评|置顶|房管|官方|榜[一二三四五六七八九十0-9]+)?\s*(?:当前)?好感(?:度|值)\s*[:：]/.test(text)) return true;
    if (/^(?:系统公告|系统消息)\s*[:：]\s*(?:当前)?好感(?:度|值)/.test(text)) return true;
    return false;
}

/**
 * 把一条直播间评论行归一成「[等级]昵称: 内容」。
 * 状态行 / 空行 / 打赏行给 ''（调用方据此剔除）。
 *
 * @param {string} line
 * @returns {string}
 */
export function normalizeCommentLine(line) {
    let text = String(line == null ? '' : line).replace(/\r/g, '').trim();
    if (!text) return '';

    if (/^\s*(?:\(|（).*(?:\)|）)\s*$/.test(text)) return '';
    if (/^(?:---+|===+)$/.test(text)) return '';
    if (/^(?:互动区|打赏记录|直播剧情描写|\[【]?\s*(?:图片|画面|视频)\s*[\]】]?|简介|主播|标题|在线人数|粉丝)[：:]/.test(text)) return '';
    if (/^\[\s*评论区\s*\]/i.test(text)) return '';
    if (/^\[\s*(?:联播请求|其他直播间请求联播)\s*[：:]/i.test(text)) return '';
    if (/^(?:生成|不少于|至少)\d*条/.test(text)) return '';

    text = text
        .replace(/^\d{1,2}\s*[\.、]\s*/, '')
        .replace(/^[-*•]\s*/, '')
        .trim();
    if (!text) return '';

    const rankPrefixMatch = text.match(/^(【[^】]{1,16}】|\[[^\]]{1,16}\])\s*/);
    let rankPrefix = '';
    if (rankPrefixMatch) {
        const rawRank = String(rankPrefixMatch[1] || '').replace(/[【】\[\]\s]/g, '').trim();
        const normalizedRank = rawRank === '粉丝' ? '热评' : rawRank;
        rankPrefix = normalizedRank ? `[${normalizedRank}]` : '';
        text = text.slice(rankPrefixMatch[0].length).trim();
    }

    const fallbackUserSplit = text.match(/^([^:：\s]{1,24})\s*[：:]\s*(.+)$/);
    if (fallbackUserSplit) {
        const user = sanitizeInlineText(fallbackUserSplit[1], HONEY_COMMENT_LIMITS.userMaxLen);
        const content = sanitizePromptBlockLine(fallbackUserSplit[2]);
        if (!user || !content) return '';
        return `${rankPrefix}${user}: ${content}`.trim();
    }

    const fallback = sanitizePromptBlockLine(text);
    if (!fallback) return '';
    return `${rankPrefix}匿名: ${fallback}`.trim();
}

export default {
    sanitizeInlineText,
    sanitizePromptLine,
    sanitizePromptBlockLine,
    clampFavorability,
    clampReferenceValue,
    normalizeNaiReferenceImage,
    isCommentStatusLine,
    normalizeCommentLine
};