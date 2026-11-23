/* ========================================================
 * phone-text-core.js — [v4.192.0] 通话/短信 文本归一面 · 纯函数内核
 * --------------------------------------------------------
 * 为什么抽这一层：phone-view.js 4243 行里散着一族「同一条 AI 回复怎么读」
 *   的清洗逻辑（_cleanAIResponse / _cleanCallRejectReason / _parseSmsAiResponse
 *   / _normalizeTtsGender / _buildPhoneCallTtsCacheKey / _normalizeWechatAvatarPath）。
 *   它们全都只碰入参字符串、不读时钟不造随机、不碰 DOM 与 storage ——
 *   却因为长在视图类里，只能靠 new 一个 4243 行的对象才能试算一次。
 * 本文件只做「同一输入 => 同一结果」的归一与判读，不含任何编排。
 * 纪律：不取 Date.now / Math.random、不建类、不碰 DOM / localStorage / window /
 *   import.meta.url（URL 解析由调用方给 base 或直接收下已归一的结果）。
 * ======================================================== */
'use strict';

/** TTS 性别归一：只认 male/m/f/男 与 female/f/女，其余一律 ''（不猜）。 */
export const TTS_GENDERS = Object.freeze(['male', 'female']);

/** 缓存键分段之间的分隔符：用 US（单元分隔符）而不是空格，避免文本自带空格串味。 */
export const TTS_CACHE_KEY_SEPARATOR = '\u001f';

/** 头像占位符：这个值不是「没有头像」，是「用默认人形图标」。 */
export const AVATAR_PLACEHOLDER = '\u{1F464}';

/* 以下两个前缀集合决定「这个字符串是已经能直接用的地址，还是要再归一」。
 * 已能直接用的形态原样返回（不做二次加工，避免把带 query 的 URL 剪坏）。 */
const ABSOLUTE_AVATAR_PREFIX = /^(?:https?:\/\/|\/|data:image|blob:)/i;
/** 站内已知头像目录前缀（从长到短剥，避免 'wechat/avatars/' 被 'avatars/' 提前吃掉）。 */
const KNOWN_AVATAR_PREFIXES = [
    /^apps\/wechat\/avatars\//i,
    /^wechat\/avatars\//i,
    /^avatars\//i
];
/** 自动头像命名：male3 / female12 —— 这类一定在 avatars 目录下。 */
const AUTO_AVATAR_NAME = /^(?:male|female)\d+$/i;
/** 普通头像文件名：只放行这几种扩展名，别的不落（防目录穿越与乱码）。 */
const AVATAR_FILE_NAME = /^[a-z0-9._-]+\.(?:png|jpg|jpeg|webp|gif)$/i;

/** 把任意入参拧成字符串（null/undefined 统一成 ''，不抛）。 */
function text(value) {
    return String(value == null ? '' : value);
}

/** 通话 AI 回复清洗：<Call> 优先、去姓名行、去残留标签、按行拆并去重。
 *  返回字符串数组（空回复给 ['...']，与旧口径一致：界面上永远有东西可显示）。 */
export function cleanCallAiResponse(response, callerName) {
    let cleaned = text(response).trim();
    if (!cleaned) return ['...'];

    const callMatch = cleaned.match(/<Call>([\s\S]*?)<\/Call>/i);
    if (callMatch) cleaned = callMatch[1].trim();

    cleaned = cleaned.replace(/^---.*---\s*$/gm, '');
    cleaned = cleaned.replace(/<\/?Call>/gi, '');
    cleaned = cleaned.replace(/<\/?Phone>/gi, '');
    cleaned = cleaned.replace(/\[手机来电通话\][^:：]*[：:]\s*/g, '');
    cleaned = cleaned.replace(/^from\s+\S+[：:]\s*/gmi, '');
    if (callerName) cleaned = cleaned.replace(new RegExp(`^${escapeRegExp(callerName)}[：:]\\s*`, 'gmi'), '');
    cleaned = cleaned.replace(/\|\|\|/g, '');

    const seen = new Set();
    const deduped = [];
    cleaned.split(/\n/).forEach((line) => {
        const trimmed = String(line || '').trim();
        if (!trimmed) return;
        const key = trimmed.replace(/\s+/g, ' ').trim();
        if (seen.has(key)) return;
        seen.add(key);
        deduped.push(trimmed);
    });

    return deduped.length > 0 ? deduped : ['...'];
}

/** 拒接理由清洗：剥标签/前缀/姓名头，压掉三连以上空行；读不出给兜底句。 */
export function cleanCallRejectReason(raw, callerName) {
    const safeCaller = text(callerName).trim();
    let cleaned = text(raw).trim();
    cleaned = cleaned.replace(/<Call>|<\/Call>|<Phone>|<\/Phone>/gi, '').trim();
    cleaned = cleaned.replace(/\[拒绝电话\]\s*[：:]\s*/gi, '').trim();
    cleaned = cleaned.replace(/^---[\s\S]*?---\s*/gm, '').trim();
    if (safeCaller) {
        cleaned = cleaned
            .replace(new RegExp(`^${escapeRegExp(safeCaller)}[：:]\\s*`, 'i'), '')
            .trim();
    }
    cleaned = cleaned.replace(/\n{3,}/g, '\n\n').trim();
    return cleaned || (safeCaller ? `${safeCaller} 暂时不方便接听。` : '对方暂时不方便接听。');
}

/** 正则字面量转义（用于把用户/角色名拼进正则）。 */
function escapeRegExp(value) {
    return text(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** 短信 AI 回复解析：<短信>/<SMS> 标签优先，块内取 [发送方] + 内容 + 发送时间。
 *  发送方写成「发件方姓名/姓名」时改用 fallbackSender（上游让调用方补名）。 */
export function parseSmsAiResponse(response, fallbackSender = '') {
    const raw = text(response).replace(/```(?:\w+)?/g, '').trim();
    if (!raw) return [];

    const tagPattern = /<(?:短信|SMS)>([\s\S]*?)<\/\s*(?:短信|SMS)\s*>/gi;
    const taggedBodies = [];
    let match = null;
    while ((match = tagPattern.exec(raw)) !== null) taggedBodies.push(match[1]);
    const bodies = taggedBodies.length > 0 ? taggedBodies : [raw];

    return bodies
        .flatMap(body => text(body).split(/^\s*---+\s*$/gm))
        .flatMap((block) => {
            const source = text(block);
            const senderMatch = source.match(/^\s*\[([^\]\r\n]+)\]\s*$/m);
            const contentMatch = source.match(/内容\s*[：:]\s*([\s\S]*?)(?=\r?\n\s*发送时间\s*[：:]|$)/i);
            if (!senderMatch || !contentMatch) return [];

            const parsedSender = text(senderMatch[1]).trim();
            const sender = /^(?:发件方姓名|姓名)$/i.test(parsedSender)
                ? text(fallbackSender).trim()
                : parsedSender;
            const body = text(contentMatch[1]).trim();
            if (!sender || !body) return [];

            const dateTimeMatch = source.match(/发送时间\s*[：:]\s*(?:(\d{1,6})\s*(?:年|[-/.])\s*(0?[1-9]|1[0-2])\s*(?:月|[-/.])\s*(0?[1-9]|[12]\d|3[01])\s*日?\s*)?([01]?\d|2[0-3])\s*[:：]\s*([0-5]\d)/i);
            const year = text(dateTimeMatch?.[1]);
            const date = year
                ? `${year.padStart(4, '0')}年${text(dateTimeMatch[2]).padStart(2, '0')}月${text(dateTimeMatch[3]).padStart(2, '0')}日`
                : '';
            const time = dateTimeMatch
                ? `${text(dateTimeMatch[4]).padStart(2, '0')}:${text(dateTimeMatch[5])}`
                : '';
            return [{ sender, text: body, date, time }];
        });
}

/** 按 key 取通话 TTS 持久化缓存（纯读，不含存储编排）。 */
export function buildCallTtsCacheKey(parts = {}) {
    return [
        text(parts.bubbleId).trim(),
        text(parts.caller).trim(),
        text(parts.provider).trim(),
        text(parts.voice).trim(),
        text(parts.text).trim()
    ].join(TTS_CACHE_KEY_SEPARATOR);
}

/** TTS 性别归一：只认 male/m/男 与 female/f/女，其余一律 ''（不猜）。 */
export function normalizeTtsGender(gender = '') {
    const raw = text(gender).trim().toLowerCase();
    if (raw === 'male' || raw === 'm' || raw === '\u7537') return 'male';
    if (raw === 'female' || raw === 'f' || raw === '\u5973') return 'female';
    return '';
}

/** 微信头像地址归一：只放行「已能用」与「站内 avatars 下这两类命名」，其余给 ''。
 *  baseUrl 由调用方给（视图手里才有 import.meta.url）；不传时只做形态判定，
 *  返回形如 `avatars/male3.png` 的站内相对路径，交给调用方决定怎么变绝对地址。 */
export function normalizeWechatAvatarPath(value, baseUrl = '') {
    const raw = text(value).trim();
    if (!raw || raw === AVATAR_PLACEHOLDER) return '';
    if (ABSOLUTE_AVATAR_PREFIX.test(raw)) return raw;

    let cleaned = raw.replace(/^['"]|['"]$/g, '');
    for (const prefix of KNOWN_AVATAR_PREFIXES) cleaned = cleaned.replace(prefix, '');
    cleaned = cleaned.replace(/^\.?\/*/, '');
    if (!cleaned || /\s/.test(cleaned)) return '';

    const isAuto = AUTO_AVATAR_NAME.test(cleaned);
    const isFile = AVATAR_FILE_NAME.test(cleaned);
    if (!isAuto && !isFile) return '';

    const fileName = isAuto ? `${cleaned}.png` : cleaned;
    if (!baseUrl) return `avatars/${fileName}`;
    try {
        return new URL(`../wechat/avatars/${fileName}`, baseUrl).href;
    } catch (_e) {
        return `avatars/${fileName}`;
    }
}

export default {
    TTS_GENDERS,
    TTS_CACHE_KEY_SEPARATOR,
    AVATAR_PLACEHOLDER,
    cleanCallAiResponse,
    cleanCallRejectReason,
    parseSmsAiResponse,
    buildCallTtsCacheKey,
    normalizeTtsGender,
    normalizeWechatAvatarPath
};
