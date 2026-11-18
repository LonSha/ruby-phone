/* [R25-X4] 会话列表的时刻与日期也走**同一份格式真源**：
 *   旧写法把 `MM/DD` 与 `昨天 HH:MM` 硬拼在这里，于是用户改 12 小时制 / 日期顺序时，
 *   聊天列表纹丝不动 —— “改了没变”是比“没这个设置”更坏的体验。
 *   第三参数接受两种形态：已归一化的 settings 对象，或 readFormatSettings() 的返回值（带 settings）。 */
import { formatClockText, formatShortDay, DEFAULT_FORMAT } from '../../config/time-format.js';

function parseCalendarDate(value) {
    const match = String(value || '').trim().match(/^(\d{1,8})\s*(?:年|[-/])\s*(\d{1,2})\s*(?:月|[-/])\s*(\d{1,2})\s*日?$/);
    if (!match) return null;

    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    if (!Number.isInteger(year) || year < 1 || !Number.isInteger(month) || month < 1 || month > 12) return null;

    const isLeapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    const daysInMonth = [31, isLeapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    if (!Number.isInteger(day) || day < 1 || day > daysInMonth[month - 1]) return null;

    return { year, month, day };
}

function getDateFromTimestamp(timestamp) {
    const numericTimestamp = Number(timestamp);
    if (!Number.isFinite(numericTimestamp) || numericTimestamp <= 0) return null;

    const date = new Date(numericTimestamp);
    if (Number.isNaN(date.getTime())) return null;
    return {
        year: date.getFullYear(),
        month: date.getMonth() + 1,
        day: date.getDate()
    };
}

// Proleptic Gregorian day number, including story years below 100 and far-future years.
function getCalendarDayNumber({ year, month, day }) {
    const adjustedYear = year - (month <= 2 ? 1 : 0);
    const era = Math.floor(adjustedYear / 400);
    const yearOfEra = adjustedYear - era * 400;
    const adjustedMonth = month + (month > 2 ? -3 : 9);
    const dayOfYear = Math.floor((153 * adjustedMonth + 2) / 5) + day - 1;
    const dayOfEra = yearOfEra * 365
        + Math.floor(yearOfEra / 4)
        - Math.floor(yearOfEra / 100)
        + dayOfYear;
    return era * 146097 + dayOfEra;
}

function settingsOf(format) {
    if (!format || typeof format !== 'object') return DEFAULT_FORMAT;
    if (format.settings && typeof format.settings === 'object') return format.settings;
    return format;
}

export function formatWechatChatListTime(chat = {}, storyTime = {}, format = null) {
    const settings = settingsOf(format);
    const fallbackRaw = String(chat.time || '').trim() || '刚刚';
    /* 时钟部分一律过真源：认不出是 `HH:MM` 的文本（如“刚刚”）原样返回，**不猜**。 */
    const fallback = formatClockText(fallbackRaw, settings);
    if (!String(chat.lastMessage || '').trim()) return fallback;

    const currentDate = parseCalendarDate(storyTime.date);
    const messageDate = parseCalendarDate(chat.date) || getDateFromTimestamp(chat.timestamp);
    if (!currentDate || !messageDate) return fallback;

    const daysAgo = getCalendarDayNumber(currentDate) - getCalendarDayNumber(messageDate);
    if (daysAgo < 0) return fallback;
    if (daysAgo === 0) return fallback;
    if (daysAgo === 1) return `昨天 ${fallback}`;

    const short = formatShortDay(messageDate, settings.dateStyle, currentDate.year);
    if (!short) return fallback;
    return short;
}
