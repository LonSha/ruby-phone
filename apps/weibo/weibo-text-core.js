/* ========================================================
 * weibo-text-core.js — [v4.191.0] 微博 文本解析 · 纯函数内核
 *
 * 职责：把 weibo-data.js 里那批「给定一段文本 ⇒ 给定一个结论」的解析面抽出来。
 *   为什么不动 weibo-data.js 那个 2719 行的类：WeiboData 构造器接 storage，
 *   持 _likedRecommendPosts / _hotSearchMeta 一票缓存键，generate* 一族全是
 *   async 且自己 window 兜底取时钟 —— 是有副作用的编排。本件只包文本面。
 *
 * 抽出来的四族（都从源类逐字搬来，行为不变，只把 this. 去掉）：
 *   ① 相对时间：分钟数 <-> 「x分钟前 / x小时前 / x天前」互转
 *   ② @ 人名：补 @ 前缀 / 剥 @ 前缀 / 剥重复回复称呼
 *   ③ 粉丝数：「1.2万」「3,000」「5k」「12位」⇒ 整数；认不出给 null（不编 0）
 *   ④ 评论行：「@名字（IP属地：北京）：内容」「A 回复 B：内容」⇒ 结构化
 *
 * 纪律：本件不碰随机源、不自己读系统时钟、不碰 DOM / 存储 / 网络、没有类。
 * ======================================================== */
'use strict';

/** 微博相对时间的换算上限：超过这个天数仍按天显示（不换月/年，源类即此口径）。 */
export const WEIBO_TIME_LIMITS = Object.freeze({
    minuteMs: 60 * 1000,
    hourMinutes: 60,
    dayMinutes: 24 * 60
});

/** 评论行人名长度上限（源类口径：超过即判这不是一条评论）。 */
export const WEIBO_COMMENT_LIMITS = Object.freeze({
    nameMaxLen: 30
});

/** 粉丝数单位倍率表（源类口径：k/千 = 千，w/万 = 万）。 */
export const WEIBO_FOLLOWER_UNITS = Object.freeze({
    k: 1000,
    '千': 1000,
    w: 10000,
    '万': 10000
});

export const WEIBO_REJECT = Object.freeze({
    notComment: 'not_comment',
    badName: 'bad_name',
    badNumber: 'bad_number'
});

/* ══════════ ① 相对时间 ══════════ */

/**
 * 「3小时前」「2天前」「1周前」「刚刚」⇒ 分钟数。
 * 认不出的文本给 0（与源类一致：不猜、不抛）。
 *
 * @param {string} timeText
 * @returns {number} 分钟数，>= 0
 */
export function parseRelativeTimeToMinutes(timeText) {
    const text = String(timeText == null ? '' : timeText).trim();
    if (!text || text === '刚刚') return 0;

    const minuteMatch = text.match(/(\d+)\s*分钟/);
    if (minuteMatch) return Math.max(0, parseInt(minuteMatch[1], 10) || 0);

    const hourMatch = text.match(/(\d+)\s*小时/);
    if (hourMatch) return Math.max(0, (parseInt(hourMatch[1], 10) || 0) * WEIBO_TIME_LIMITS.hourMinutes);

    const dayMatch = text.match(/(\d+)\s*天/);
    if (dayMatch) return Math.max(0, (parseInt(dayMatch[1], 10) || 0) * WEIBO_TIME_LIMITS.dayMinutes);

    const weekMatch = text.match(/(\d+)\s*(?:周|星期)/);
    if (weekMatch) return Math.max(0, (parseInt(weekMatch[1], 10) || 0) * 7 * WEIBO_TIME_LIMITS.dayMinutes);

    return 0;
}

/**
 * 分钟数 ⇒ 「刚刚 / x分钟前 / x小时前 / x天前」。
 * 负数与 NaN 一律按 0 处理（不给「-1分钟前」这种读数）。
 *
 * @param {number} minutes
 * @returns {string}
 */
export function formatRelativeTimeFromMinutes(minutes) {
    const totalMinutes = Math.max(0, Math.floor(Number(minutes) || 0));
    if (totalMinutes < 1) return '刚刚';
    if (totalMinutes < WEIBO_TIME_LIMITS.hourMinutes) return `${totalMinutes}分钟前`;
    if (totalMinutes < WEIBO_TIME_LIMITS.dayMinutes) return `${Math.floor(totalMinutes / WEIBO_TIME_LIMITS.hourMinutes)}小时前`;
    return `${Math.floor(totalMinutes / WEIBO_TIME_LIMITS.dayMinutes)}天前`;
}

/* ══════════ ② @ 人名 ══════════ */

/**
 * 给人名补 @ 前缀；空名用 fallback（源类默认「网友」）。
 *
 * @param {string} name
 * @param {string} [fallback]
 * @returns {string} 一定以 @ 开头
 */
export function normalizeAtName(name, fallback = '网友') {
    const raw = String(name == null ? '' : name).trim();
    const finalName = raw || fallback;
    return finalName.startsWith('@') ? finalName : `@${finalName}`;
}

/**
 * 剥掉人名上的 @ 前缀（回复对象、@名单共用）。
 *
 * @param {string} name
 * @returns {string}
 */
export function normalizeBareName(name = '') {
    return String(name == null ? '' : name)
        .replace(/^@+/, '')
        .trim();
}

/**
 * 剥掉正文开头重复的回复称呼（「@张三：」开头而 replyTo 已是张三时）。
 *
 * @param {string} text 正文
 * @param {string} replyTo 回复对象
 * @returns {string} 剥完的正文
 */
export function stripDuplicateReplyMention(text = '', replyTo = '') {
    let safeText = String(text == null ? '' : text).trim();
    const target = normalizeBareName(replyTo);
    if (!safeText || !target) return safeText;

    const escaped = target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const duplicatePrefix = new RegExp(`^@?${escaped}\\s*[：:]\\s*`, 'u');
    safeText = safeText.replace(duplicatePrefix, '').trim();
    return safeText;
}

/* ══════════ ③ 粉丝数 ══════════ */

/**
 * 「1.2万」「3,000」「5k」「12位」⇒ 整数。
 * 认不出（空串 / 非数字 / null）给 null —— **不编 0**：
 *   「上游没给这一格」与「上游给了 0」在读数面上处置常常相反。
 *
 * @param {*} raw
 * @returns {number|null}
 */
export function parseFollowerNumber(raw) {
    if (raw === null || raw === undefined) return null;
    let text = String(raw).trim();
    if (!text) return null;

    text = text
        .replace(/[,\s，]/g, '')
        .replace(/(人|位|名|个)$/u, '');

    const match = text.match(/^(\d+(?:\.\d+)?)(万|千|[kKwW])?$/);
    if (!match) return null;

    let value = Number(match[1]);
    if (!Number.isFinite(value)) return null;
    const unit = String(match[2] || '').toLowerCase();
    const factor = WEIBO_FOLLOWER_UNITS[unit];
    if (factor) value *= factor;

    return Math.max(0, Math.round(value));
}

/* ══════════ ④ 评论行 ══════════ */

/** 属地写法的四种收口形态（源类逐字搬来）。 */
const LOCATION_PATTERNS = [
    /[（(]\s*(?:来自|IP属地|ip)?[：:\s]*\[?([^\]）)]+)\]?\s*[）)]$/i,
    /[（(]\s*\[?([^\]）)]+)\]?\s*[）)]$/i,
    /(?:\[|【)\s*(?:来自|IP属地|ip)?[：:\s]*\[?([^\]】]+)\]?\s*(?:\]|】)$/i,
    /(?:\[|【)\s*\[?([^\]】]+)\]?\s*(?:\]|】)$/i
];

/**
 * 从「@名字（IP属地：北京）：内容」这种行里切出 IP 属地。
 * 命中即从 head 上摘掉该片段（源类口径：只认行尾的属地）。
 *
 * @param {string} head
 * @returns {{location: string, head: string}}
 */
export function extractTrailingLocation(head) {
    const src = String(head == null ? '' : head);
    for (const reg of LOCATION_PATTERNS) {
        const locMatch = src.match(reg);
        if (locMatch) {
            const location = String(locMatch[1] || '')
                .replace(/^\s*(?:来自|IP属地|ip)\s*[：:\s]*/i, '')
                .replace(/^\[/, '')
                .replace(/\]$/, '')
                .trim();
            return { location, head: src.replace(reg, '').trim() };
        }
    }
    return { location: '', head: src.trim() };
}

/**
 * 统一解析一条评论行（支持楼中楼：A 回复 B：内容）。
 *
 * @param {string} rawLine
 * @returns {{ok: boolean, reason: string|null, out: object|null}}
 *   out = { name, location, text, replyTo }；name/replyTo 都带 @ 前缀。
 */
export function parseCommentLine(rawLine) {
    if (!rawLine || typeof rawLine !== 'string') {
        return { ok: false, reason: WEIBO_REJECT.notComment, out: null };
    }

    let line = rawLine.trim();
    if (!line) return { ok: false, reason: WEIBO_REJECT.notComment, out: null };

    line = line
        .replace(/^\d+[.、．]\s*/, '')
        .replace(/^[\-•]\s*/, '')
        .replace(/^\[([^\]]+)\]/, '$1')
        .trim();

    // 用「最后一个冒号」切分，避免把「IP属地：北京」里的冒号当成正文分隔符
    const splitMatch = line.match(/^(.+)[：:]\s*([\s\S]+)$/);
    if (!splitMatch) return { ok: false, reason: WEIBO_REJECT.notComment, out: null };

    let head = (splitMatch[1] || '').trim();
    const text = (splitMatch[2] || '').trim();
    if (!head || !text) return { ok: false, reason: WEIBO_REJECT.notComment, out: null };

    const cleanNameToken = (token) => String(token == null ? '' : token)
        .trim()
        .replace(/^@/, '')
        .replace(/^【/, '')
        .replace(/】$/, '')
        .replace(/^\[/, '')
        .replace(/\]$/, '')
        .trim();

    const loc = extractTrailingLocation(head);
    const location = loc.location;
    head = loc.head;

    let nameHead = head;
    let replyTo = null;
    const replyMatch = head.match(/^(.+?)\s*回复\s*(.+)$/);
    if (replyMatch) {
        nameHead = cleanNameToken(replyMatch[1]);
        const target = cleanNameToken(replyMatch[2]);
        if (target) replyTo = `@${target}`;
    }

    const nameClean = cleanNameToken(nameHead);
    if (!nameClean || nameClean.length > WEIBO_COMMENT_LIMITS.nameMaxLen) {
        return { ok: false, reason: WEIBO_REJECT.badName, out: null };
    }

    return {
        ok: true,
        reason: null,
        out: {
            name: `@${nameClean}`,
            location,
            text,
            replyTo
        }
    };
}

export default {
    parseRelativeTimeToMinutes,
    formatRelativeTimeFromMinutes,
    normalizeAtName,
    normalizeBareName,
    stripDuplicateReplyMention,
    parseFollowerNumber,
    extractTrailingLocation,
    parseCommentLine
};
