/* ========================================================
 * config/story-time-rel.js —— 故事内时间的「相对时间」推断
 * --------------------------------------------------------
 * 缝合自 memory-plugin-research/baibai/src/memory/timeRel.ts（标准 / 架空双型日期、
 *   带历法前缀跳过公历口语档、天 / 月 / 年降级、解析不出返回空串）。
 *
 * 【修前本仓是什么样（实测，不是推测）】
 *   本仓**只有绝对时间**：`config/comm-time.js` 把「2026年10月22日 14:30」解析成毫秒戳，
 *   `apps/needsim/needsim-data.js` 的 `memoryAgeOf()` 把「现在减戳」翻成「3分钟前 / 2小时前」。
 *   于是同一段剧情里出现两个时间面：
 *     · 现实面（本机时钟）—— 手机通知、通话、消息时间戳用它，正确；
 *     · **故事面**（`storyTime` 字段，v3.10 起随每条记忆落库）—— 一条记忆的 `storyTime`
 *       写着「3727年★9月30日」，却仍然按 `createdAt` 的**现实**间隔显示「3 小时前」。
 *   剧情里过了一整年，界面照样说「2 天前」。**故事时间是自由的文本**（模型写的），
 *   而本仓拿它当装饰字段，从没算过它与「现在」的差。
 *
 * 【本件给什么（逐条对应源，不是重写）】
 *   · 底线第一句：**宁可不标，绝不标错**。解析不出、跨架空月、写了年份却残缺 —— 一律返回空串，
 *     调用方据此**不加前缀**（而不是加一个「大约」糊过去）；
 *   · 数字公历（`1988/9/29`、`1988年9月29日`、`9/29`）精确算天数差；
 *   · 带历法前缀（`元持十二年八月二十一日`、`庆历三年`）照常算天数，但**跳过周 / 月 / 年的口语档**
 *     （「上周三」套到「元持十二年」上既出戏、小年份的 `getDay()` 又是乱算的），降级成「N 天前」；
 *   · 架空月（`霜月3日`、含 `XX` / `??` 占位）—— 仅同月可算，跨架空月放弃；
 *   · 明确写了年份却没能完整解析（`3727年★9月30日`）→ **禁止降级成无年份的 M月D日**：
 *     否则会静默丢掉 3727，再与另一个无年份日期按同一年比，跨年方向可能完全颠倒；
 *   · 「初七」「廿一」「卅」这类中文数字与农历前缀照源解析（`cnNumToInt`）；
 *   · 时刻（`15:00` / `下午` / `酉时`）在比日期前先剥掉 —— 只比日期。
 *
 * 【本仓差异（照抄会坏的地方）】
 *   · 源是 TS，本仓是零依赖 ESM：`interface` / 类型注解全部落成普通对象与注释；
 *   · 源用 `Record<string, number>` 表存中文数字；本仓用 `Object.freeze({...})`；
 *   · 源的 `defaultYear` 写死 2024（两端都缺年时用的假年）；本仓保留同一常量并写明它是**假年**，
 *     只在「两端都缺年」时用于对齐，不参与显示；
 *   · 源里有 `ageDisplay()` 锚点推算年龄；v4.90.0 只缝了相对时间一半、年龄面登记为欠债，
 *     v4.91.0 已按五态全档移植（`ageDisplayOf` / `ageDisplay` / `ageDisplayLine`）并由档案端
 *     真调（`profile-data` 的字段投影与注入块），不再有「第二套年龄口径」。
 *
 * 【纪律】
 *   ① 纯函数：零 import、不读 window、不看时钟（`now` 一律显式传入）；
 *   ② 不抛：任何畸形（null / 数组 / Symbol / 空串）都走「空串」这条统一出口；
 *   ③ 不猜：三种放弃（解析不出 / 跨架空月 / 写了年份却残缺）各留各的因，归因不压成一格。
 * ======================================================== */
'use strict';

/** 中文周几（0 = 周日）。 */
const WEEKDAY_NAMES = Object.freeze(['日', '一', '二', '三', '四', '五', '六']);
const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;
/** 两端都缺年时用的**假年**（只为让 Date 能算，不参与显示）。 */
const DEFAULT_YEAR = 2024;
/** 年→月 / 月→日 边界之间允许出现的装饰分隔符。刻意不全局替换，免得伤历法前缀与架空月名。 */
const DATE_FIELD_SEPARATOR = '[\\s·・•‧∙⋅.．。﹒/／,，、_\\-—–－]*';
/** 中文数字字面（「两」按 2、「〇/零」按 0）。 */
const CN_DIGIT = Object.freeze({
    〇: 0, 零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9
});
/** 中文数字字符集（含「廿」= 20、「卅」= 30）。 */
const CN_NUM_CLASS = '[一二三四五六七八九十两零〇廿卅]';

/** 文本取值：非字符串一律空串（**不 `String()` 强转** —— `String([])` 会变成 `''` 之外的东西）。 */
function textOf(value) {
    return typeof value === 'string' ? value.trim() : '';
}

/** 把全角 / 中文句点等日期分隔符规范成 `/`，便于后续正则统一处理。 */
function normalizeNumericDateSeparators(dateStr) {
    if (!dateStr) return dateStr;
    return dateStr
        /* 长格式（4 位年起）：日数后只要不再跟数字 / 点即认，容忍后接逗号、中文、括号等
         *   （如「2025.11.1, 多云」「2025.11.1晴」）；4 位年开头几乎不会是小数 / 版本号，放宽很安全。 */
        .replace(/^(\d{4,})[.．。﹒](\d{1,2})[.．。﹒](\d{1,2})(?![\d.．。﹒])/, '$1/$2/$3')
        /* 短格式（M.D）：歧义大（「1.5个小时」是小数不是日期），仍要求后接空白或结尾，保守。 */
        .replace(/^(\d{1,2})[.．。﹒](\d{1,2})(?=$|\s)/, '$1/$2');
}

/** 看起来是结构化数字日期（用于排除「霜月3日」被误判成架空）。 */
function looksLikeStructuredNumericDate(dateStr) {
    if (!dateStr) return false;
    return (
        /^(?:\d{4,}[/.\-．。﹒]\d{1,2}[/.\-．。﹒]\d{1,2}|\d{1,2}[/.\-．。﹒]\d{1,2})(?=$|\s)/.test(dateStr) ||
        new RegExp(
            '^\\d+\\s*年' + DATE_FIELD_SEPARATOR + '\\d{1,2}\\s*月' + DATE_FIELD_SEPARATOR + '\\d{1,2}\\s*日?(?=$|\\s)'
        ).test(dateStr) ||
        new RegExp('^\\d{1,2}\\s*月' + DATE_FIELD_SEPARATOR + '\\d{1,2}\\s*日?(?=$|\\s)').test(dateStr)
    );
}

/** 从架空日期串里抽「日数」（阿拉伯优先，无则取首个数字）。 */
function extractDayNumber(dateStr) {
    if (!dateStr) return null;
    const m = dateStr.match(/(\d+)\s*[日号]/) || dateStr.match(/第\s*(\d+)/);
    if (m) return parseInt(m[1], 10);
    const any = dateStr.match(/(\d+)/);
    if (any) return parseInt(any[1], 10);
    return null;
}

/** 从架空日期串里抽「月标识」（如「霜月」）。 */
function extractMonthIdentifier(dateStr) {
    if (!dateStr) return null;
    const m = dateStr.match(/([^\s\d]+月)/);
    if (m) return m[1];
    const num = dateStr.match(/(?:\d{4}[/\-])?(\d{1,2})[/\-]\d{1,2}/);
    if (num) return num[1] + '月';
    return null;
}

/** 解析 1-99 的中文数字（十、十一、二十、廿一、卅…）；纯阿拉伯直取。超出范围返回 null。 */
function cnNumToInt(raw) {
    const s = String(raw == null ? '' : raw).trim();
    if (!s) return null;
    if (/^\d+$/.test(s)) return parseInt(s, 10);
    /* 农历「初」前缀：初一~初九 = 个位、初十 = 10。剥掉「初」后交给下面正常解析。 */
    const str = s.replace(/^初/, '').replace(/廿/g, '二十').replace(/卅/g, '三十');
    if (!str) return null;
    const shiIdx = str.indexOf('十');
    if (shiIdx >= 0) {
        const tens = shiIdx === 0 ? 1 : CN_DIGIT[str[shiIdx - 1]];
        const onesPart = str.slice(shiIdx + 1);
        const ones = onesPart ? CN_DIGIT[onesPart] : 0;
        if (tens === undefined || ones === undefined) return null;
        return tens * 10 + ones;
    }
    if (str.length === 1) return Object.prototype.hasOwnProperty.call(CN_DIGIT, str) ? CN_DIGIT[str] : null;
    return null;
}

/**
 * 解析故事内日期。解析不出返回 `null`。
 * @returns {{type:'standard'|'fantasy', year?:number, month?:number, day?:number|null,
 *            monthId?:string, calendarPrefix?:string, raw?:string}|null}
 */
export function parseStoryDate(dateStr) {
    const raw = textOf(dateStr);
    if (!raw) return null;
    let s = raw;
    /* 去掉 AI 爱写的周几标注「(三)」。 */
    s = s.replace(/\s*\([日一二三四五六]\)\s*/g, ' ').trim();
    s = normalizeNumericDateSeparators(s);
    /* 含 XX / ?？占位 → 架空（放着不算，比猜安全）。 */
    if (/[xX]{2}|[?？]{2}/.test(s)) return { type: 'fantasy', raw: raw };
    /* 标准：YYYY/M/D */
    const full = s.match(/^(\d{4,})[/\-](\d{1,2})[/\-](\d{1,2})/);
    if (full) {
        const year = parseInt(full[1], 10);
        const month = parseInt(full[2], 10);
        const day = parseInt(full[3], 10);
        if (month >= 1 && month <= 12 && day >= 1 && day <= 31) return { year: year, month: month, day: day, type: 'standard' };
    }
    /* 标准：M/D（无年） */
    const short = s.match(/^(\d{1,2})[/\-](\d{1,2})(?:\s|$)/);
    if (short) {
        const month = parseInt(short[1], 10);
        const day = parseInt(short[2], 10);
        if (month >= 1 && month <= 12 && day >= 1 && day <= 31) return { month: month, day: day, type: 'standard' };
    }
    /* 中文 / 阿拉伯数字字段（日字段额外允许农历「初」）。 */
    const NUM = '(?:\\d+|' + CN_NUM_CLASS + '+)';
    const DAY = '(?:初)?' + NUM;
    const yearCn = s.match(
        new RegExp('(' + NUM + ')\\s*年' + DATE_FIELD_SEPARATOR + '(' + NUM + ')\\s*月' + DATE_FIELD_SEPARATOR + '(' + DAY + ')\\s*日?')
    );
    if (yearCn) {
        const year = cnNumToInt(yearCn[1]);
        const month = cnNumToInt(yearCn[2]);
        const day = cnNumToInt(yearCn[3]);
        if (year != null && month != null && day != null && month >= 1 && month <= 12 && day >= 1 && day <= 31) {
            const prefixEnd = s.indexOf(yearCn[0]);
            const calendarPrefix = s.substring(0, prefixEnd).trim() || undefined;
            return { year: year, month: month, day: day, type: 'standard', calendarPrefix: calendarPrefix };
        }
    }
    /* ★ 明确写了年份却没能完整解析 → 禁止继续降级成无年份的 M月D日。 */
    if (new RegExp('(?:' + NUM + ')\\s*年').test(s)) return null;
    /* 标准：M月D日（无年） */
    const cn = s.match(new RegExp('(' + NUM + ')\\s*月' + DATE_FIELD_SEPARATOR + '(' + DAY + ')\\s*日?'));
    if (cn) {
        const month = cnNumToInt(cn[1]);
        const day = cnNumToInt(cn[2]);
        if (month != null && day != null && month >= 1 && month <= 12 && day >= 1 && day <= 31) {
            return { month: month, day: day, type: 'standard' };
        }
    }
    /* 架空日历 */
    if (looksLikeStructuredNumericDate(s)) return null;
    const monthId = extractMonthIdentifier(s);
    const dayNum = extractDayNumber(s);
    if (monthId || dayNum !== null) {
        return { monthId: monthId === null ? undefined : monthId, day: dayNum, type: 'fantasy', raw: raw };
    }
    return null;
}

/** 剥掉尾部时刻（15:00 / 下午 / 酉时…），只留日期。 */
function stripTime(value) {
    return normalizeNumericDateSeparators(
        textOf(value)
            .replace(/\s+\d{1,2}[:：]\d{2}.*$/, '')
            .replace(/\s+(凌晨|早上|上午|中午|下午|傍晚|晚上|深夜|子时|丑时|寅时|卯时|辰时|巳时|午时|未时|申时|酉时|戌时|亥时).*$/i, '')
    );
}

/**
 * 计算 from→to 的天数差（to - from，正数表示 to 更晚）。
 *   解析不出、或跨架空月无法判定 → `null`。
 */
export function calculateRelativeDays(fromDate, toDate) {
    const fromRaw = textOf(fromDate);
    const toRaw = textOf(toDate);
    if (!fromRaw || !toRaw) return null;
    if (stripTime(fromRaw) === stripTime(toRaw)) return 0;
    const from = parseStoryDate(fromRaw);
    const to = parseStoryDate(toRaw);
    if (!from || !to) return null;
    /* 标准日历：精确算（用 setFullYear 避开 Date 对小年份的偏移）。 */
    if (from.type === 'standard' && to.type === 'standard') {
        const fromYear = from.year || to.year || DEFAULT_YEAR;
        const toYear = to.year || from.year || DEFAULT_YEAR;
        const fromObj = new Date(0);
        fromObj.setFullYear(fromYear, (from.month == null ? 1 : from.month) - 1, from.day == null ? 1 : from.day);
        const toObj = new Date(0);
        toObj.setFullYear(toYear, (to.month == null ? 1 : to.month) - 1, to.day == null ? 1 : to.day);
        return Math.round((toObj.getTime() - fromObj.getTime()) / DAY_MS);
    }
    /* 架空日历：仅同月可算，跨架空月名易误判 → 放弃。 */
    if (from.type === 'fantasy' || to.type === 'fantasy') {
        const fromMonth = from.monthId != null ? from.monthId : from.month;
        const toMonth = to.monthId != null ? to.monthId : to.month;
        if (from.day != null && to.day != null) {
            if (fromMonth && toMonth && fromMonth !== toMonth) return null;
            return to.day - from.day;
        }
        return null;
    }
    return null;
}

/** 标准日历的两端转成 Date（供周 / 月 / 年语义判定）；任一非标准则 null。 */
function toDatePair(fromDate, toDate) {
    const from = parseStoryDate(fromDate);
    const to = parseStoryDate(toDate);
    if (!from || !to) return null;
    if (from.type !== 'standard' || to.type !== 'standard') return null;
    const fromYear = from.year || to.year || DEFAULT_YEAR;
    const toYear = to.year || from.year || DEFAULT_YEAR;
    const f = new Date(0);
    f.setFullYear(fromYear, (from.month == null ? 1 : from.month) - 1, from.day == null ? 1 : from.day);
    const t = new Date(0);
    t.setFullYear(toYear, (to.month == null ? 1 : to.month) - 1, to.day == null ? 1 : to.day);
    return { from: f, to: t };
}

/** 以「周一」为周起点算周差。 */
function weekDiffByMonday(from, to) {
    const weekStart = function (d) {
        const wd = d.getDay();
        const offset = wd === 0 ? -6 : 1 - wd;
        return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate() + offset);
    };
    return Math.round((weekStart(to) - weekStart(from)) / WEEK_MS);
}

/** 自然月差。 */
function monthDiff(from, to) {
    return (to.getFullYear() - from.getFullYear()) * 12 + (to.getMonth() - from.getMonth());
}

/**
 * 算某个故事内时间的「周几」，**仅在纯数字公历且带年份**时给出，否则空串。
 *   三道门槛同源：非 standard 不算、无 year 不算、有历法前缀不算（古风纪年套公历星期既出戏、
 *   小年份的 getDay() 又是乱算）。一句话：能确定到公历某一天才标星期。
 */
export function weekdayLabel(timeStr) {
    const s = textOf(timeStr);
    if (!s) return '';
    const d = parseStoryDate(s);
    if (!d || d.type !== 'standard' || d.year == null || d.calendarPrefix) return '';
    const obj = new Date(0);
    obj.setFullYear(d.year, (d.month == null ? 1 : d.month) - 1, d.day == null ? 1 : d.day);
    return '周' + WEEKDAY_NAMES[obj.getDay()];
}

/**
 * 把「事件时间 event」相对「现在 now」格式化成相对前缀文本。
 *   解析不出 / 无法判定 → 空串（调用方据此不加前缀）。
 * @returns {string}
 */
export function relativeTimeLabel(eventTime, nowTime) {
    const ev = textOf(eventTime);
    const now = textOf(nowTime);
    if (!ev || !now) return '';
    /* days = now - event，正数表示事件在过去。 */
    const days = calculateRelativeDays(ev, now);
    if (days === null) return '';
    if (days === 0) return '今天';
    if (days === 1) return '昨天';
    if (days === 2) return '前天';
    if (days === 3) return '大前天';
    if (days === -1) return '明天';
    if (days === -2) return '后天';
    if (days === -3) return '大后天';
    /* 带历法前缀时跳过周 / 月 / 年口语档（见 weekdayLabel 的同款理由），只留通用档。 */
    const fromParsed = parseStoryDate(ev);
    const toParsed = parseStoryDate(now);
    const hasPrefix = Boolean((fromParsed && fromParsed.calendarPrefix) || (toParsed && toParsed.calendarPrefix));
    const pair = hasPrefix ? null : toDatePair(ev, now);
    if (days > 0) {
        if (days < 4) return days + '天前';
        if (days >= 4 && days <= 13 && pair) {
            const wd = weekDiffByMonday(pair.from, pair.to);
            if (wd === 1) return '上周' + WEEKDAY_NAMES[pair.from.getDay()];
            if (wd === 2) return '上上周' + WEEKDAY_NAMES[pair.from.getDay()];
        }
        if (days >= 7 && days < 60 && pair && monthDiff(pair.from, pair.to) === 1) {
            return '上个月' + pair.from.getDate() + '号';
        }
        if (days >= 300 && pair) {
            const yearDiff = pair.to.getFullYear() - pair.from.getFullYear();
            if (yearDiff === 1) return '去年' + (pair.from.getMonth() + 1) + '月' + pair.from.getDate() + '日';
            if (yearDiff === 2) return '前年' + (pair.from.getMonth() + 1) + '月' + pair.from.getDate() + '日';
        }
        if (days < 30) return days + '天前';
        if (days < 365) {
            const md = pair ? monthDiff(pair.from, pair.to) : 0;
            const months = md > 0 ? md : Math.floor(days / 30);
            return months + '个月前';
        }
        const years = Math.floor(days / 365);
        const remainMonths = Math.round((days % 365) / 30);
        if (remainMonths > 0 && years < 5) return years + '年' + remainMonths + '个月前';
        return years + '年前';
    }
    /* 未来方向 */
    const abs = Math.abs(days);
    if (abs < 4) return abs + '天后';
    if (abs >= 4 && abs <= 13 && pair) {
        const wd = weekDiffByMonday(pair.from, pair.to);
        if (wd === -1) return '下周' + WEEKDAY_NAMES[pair.from.getDay()];
        if (wd === -2) return '下下周' + WEEKDAY_NAMES[pair.from.getDay()];
    }
    if (abs >= 7 && abs < 60 && pair && monthDiff(pair.from, pair.to) === -1) {
        return '下个月' + pair.from.getDate() + '号';
    }
    if (abs < 30) return abs + '天后';
    if (abs < 365) {
        const md = pair ? monthDiff(pair.from, pair.to) : 0;
        const months = md < 0 ? Math.abs(md) : Math.floor(abs / 30);
        return months + '个月后';
    }
    const years = Math.floor(abs / 365);
    const remainMonths = Math.round((abs % 365) / 30);
    if (remainMonths > 0 && years < 5) return years + '年' + remainMonths + '个月后';
    return years + '年后';
}

/**
 * 归因版：给调用方的是「为什么没标」，不是只有一句空串。
 *   `ok` 时 `label` 有值；其余每态各有各的 reason，不压成一格「解析失败」。
 */
export function storyTimeAge(eventTime, nowTime) {
    const ev = textOf(eventTime);
    const now = textOf(nowTime);
    if (!ev) return { ok: false, reason: 'no-event-time', label: '' };
    if (!now) return { ok: false, reason: 'no-now-time', label: '' };
    const evParsed = parseStoryDate(ev);
    if (!evParsed) return { ok: false, reason: 'event-unparsed', label: '' };
    const nowParsed = parseStoryDate(now);
    if (!nowParsed) return { ok: false, reason: 'now-unparsed', label: '' };
    const days = calculateRelativeDays(ev, now);
    if (days === null) {
        /* 两端都认得、差却算不出 —— 只可能是跨架空月（同月能算、标准能算）。 */
        return { ok: false, reason: 'cross-fantasy-month', label: '' };
    }
    const label = relativeTimeLabel(ev, now);
    if (!label) return { ok: false, reason: 'label-empty', label: '' };
    return { ok: true, reason: 'ok', label: label };
}

/** 一行读数：三态分列（标出 / 未标 / 未标的原因），不压成「N 条有时间」。 */
export function storyTimeLine(stats) {
    const one = stats && typeof stats === 'object' ? stats : {};
    const labeled = Number.isFinite(one.labeled) ? one.labeled : 0;
    const skipped = Number.isFinite(one.skipped) ? one.skipped : 0;
    if (labeled + skipped === 0) return '故事时间相对读数：没跑过（不是全部标不出）';
    const parts = ['标出 ' + labeled, '未标 ' + skipped];
    const why = one.byReason && typeof one.byReason === 'object' ? one.byReason : {};
    const keys = Object.keys(why).filter((k) => why[k] > 0 && k !== 'ok');
    if (keys.length) parts.push(keys.map((k) => reasonLabel(k) + ' ' + why[k]).join(' / '));
    return '故事时间相对读数：' + parts.join(' · ');
}

/**
 * 从年龄原文里解析出**可推算**的数字（全串匹配，防「二十出头」「25%」被当数字）。
 *   只认「[约|大约] N 岁」这一种写法；其余（二十出头 / 年近三十 / 25%）一律 null —— 模糊值不猜。
 */
function parseAgeNumber(raw) {
    const text = textOf(raw);
    if (!text) return null;
    const m = text.match(new RegExp('^(?:约|大约)?\\s*(\\d{1,3}|' + CN_NUM_CLASS + '+)\\s*岁?$'));
    if (!m) return null;
    const n = cnNumToInt(m[1]);
    return n !== null && n > 0 && n < 1000 ? n : null;
}
/**
 * 锚点时间的简短标注：能解析出年份 → 「(历法前缀)X年」；否则剥掉时刻后的原文。
 *   用途是**括注**（「约31岁(1994年时24岁)」），故宁可用原文也不用数字。
 */
function anchorLabel(ageTime) {
    const text = textOf(ageTime);
    if (!text) return '';
    const parsed = parseStoryDate(text);
    if (parsed && parsed.type === 'standard' && parsed.year !== null && parsed.year !== undefined) {
        return String(parsed.calendarPrefix || '') + parsed.year + '年';
    }
    /* 剥时刻：锚点里带「下午 / 15:00 / 酉时」不参与括注。 */
    return text.replace(/\s*(?:\d{1,2}:\d{2}|上午|下午|中午|凌晨|清晨|傍晚|夜里|晚上|早上)/g, '').trim() || text;
}
/**
 * 年龄推算（归因版）：年龄不是状态而是时间的函数 —— 存储永远是「记录时的原文 + 锚点时间」，
 *   显示时相对当前故事时间推算，时间跳跃自动长岁，模型忘不忘更新都不影响正确性。
 *
 * 五态（互不同形，调用方据此决定要不要打「约」）：
 *   `empty`              —— 没有年龄原文，空串；
 *   `raw-no-anchor`      —— 缺锚点或缺当前时间，原样返回（无从推算，不猜）；
 *   `raw-within-year`    —— 锚点距今不足一年，原样返回（还没到长一岁的时候）；
 *   `estimated`          —— 跨了 N 年且原文是可解析数字：`约(原值+N)岁(锚点年时原值岁)`。
 *                          不知生日，±1 岁误差，「约」是诚实的；
 *   `raw-uncomputable`   —— 模糊年龄跨年 / 架空历算不出 / 时间倒流：原文 + 锚点括注，把推算留给读者。
 * 沿用本件底线「宁可不标，绝不标错」：the 估不出来时**一个数都不给**。
 * @param {string} age 年龄原文
 * @param {string} ageTime 记录这条年龄时的故事时间（锚点）
 * @param {string} now 当前故事时间
 * @returns {{ok:boolean, state:string, text:string, years?:number, anchor?:string}}
 */
export function ageDisplayOf(age, ageTime, now) {
    const raw = textOf(age);
    if (!raw) return { ok: false, state: 'empty', text: '' };
    const anchor = textOf(ageTime);
    const cur = textOf(now);
    if (!anchor || !cur) return { ok: false, state: 'raw-no-anchor', text: raw };
    const label = anchorLabel(anchor);
    const days = calculateRelativeDays(anchor, cur);
    const num = parseAgeNumber(raw);
    if (days !== null && days >= 0 && days < 365) return { ok: true, state: 'raw-within-year', text: raw };
    if (days !== null && days >= 365 && num !== null) {
        const years = Math.floor(days / 365);
        const est = num + years;
        return {
            ok: true, state: 'estimated', years: years, anchor: label,
            text: label ? '约' + est + '岁(' + label + '时' + num + '岁)' : '约' + est + '岁'
        };
    }
    return {
        ok: false, state: 'raw-uncomputable', anchor: label,
        text: label ? raw + '(' + label + '时)' : raw
    };
}
/** 只要显示串的那一层（绝大多数调用方要的只是它）。 */
export function ageDisplay(age, ageTime, now) {
    return ageDisplayOf(age, ageTime, now).text;
}
/** 一行读数：只数**推算过**的，原样与算不出分开报（不压成「有年龄 n 条」）。 */
export function ageDisplayLine(stats) {
    const one = stats && typeof stats === 'object' ? stats : {};
    const est = Number.isFinite(one.estimated) ? one.estimated : 0;
    const raw = Number.isFinite(one.raw) ? one.raw : 0;
    const unknown = Number.isFinite(one.unknown) ? one.unknown : 0;
    if (est + raw + unknown === 0) return '年龄推算：没跑过（不是全部算不出）';
    return '年龄推算：推算 ' + est + ' · 原样 ' + raw + ' · 算不出 ' + unknown;
}

/** 原因的人读文案（未知原因如实回原值，不吞）。 */
export function reasonLabel(reason) {
    const map = {
        'ok': '已标',
        'no-event-time': '没给事件时间',
        'no-now-time': '没给现在时间',
        'event-unparsed': '事件时间解析不出',
        'now-unparsed': '现在时间解析不出',
        'cross-fantasy-month': '跨架空月算不出',
        'label-empty': '算出来是空串'
    };
    const key = typeof reason === 'string' ? reason : '';
    return Object.prototype.hasOwnProperty.call(map, key) ? map[key] : (key || '未给原因');
}

/** 自检：三种放弃与各级档位都两向自证。 */
export function storyTimeRelSelfCheck() {
    const problems = [];
    const push = (ok, msg) => { if (!ok) problems.push(msg); };
    /* ① 中文数字两向：该认的认（含十 / 廿 / 初），不该认的不硬凑 */
    push(cnNumToInt('十') === 10, '「十」必须 10');
    push(cnNumToInt('廿一') === 21, '「廿一」必须 21');
    push(cnNumToInt('卅') === 30, '「卅」必须 30');
    push(cnNumToInt('初七') === 7, '「初七」必须 7');
    push(cnNumToInt('两') === 2 && cnNumToInt('〇') === 0, '「两」「〇」必须 2 / 0');
    push(cnNumToInt('一百') === null, '「一百」超出范围必须 null');
    push(cnNumToInt('') === null && cnNumToInt(null) === null, '空必须 null');
    /* ② 解析两向：标准 / 中文年 / 架空各就各位 */
    push(parseStoryDate('1988/9/29').type === 'standard', '斜线日期必须认成 standard');
    push(parseStoryDate('1988.9.29').type === 'standard', '点号日期必须规范成 standard');
    push(parseStoryDate('1988/9/29').day === 29, '日数必须保真');
    push(parseStoryDate('1.5个小时').type === 'fantasy', '小数不得被当 standard 日期（走架空且日数照抽）');
    push(parseStoryDate('1.5个小时').day === 1, '小数串里抽到的日数必须保真');
    const cn = parseStoryDate('元持十二年八月二十一日');
    push(cn && cn.type === 'standard' && cn.year === 12 && cn.month === 8 && cn.day === 21, '中文纪年必须解析');
    push(cn && cn.calendarPrefix === '元持', '历法前缀必须留下');
    push(parseStoryDate('霜月3日').type === 'fantasy', '架空月必须认成 fantasy');
    push(parseStoryDate('霜月3日').day === 3, '架空日数必须保真');
    push(parseStoryDate('XX月??日').type === 'fantasy', '占位必须认成 fantasy');
    /* ③ ★ 写了年份却残缺 → null，不得降级 */
    push(parseStoryDate('3727年★9月30日') === null, '写了年份残欠缺月日必须 null');
    push(parseStoryDate('') === null && parseStoryDate(null) === null, '空必须 null');
    /* ④ 天数差两向：同日 0 / 昨天 1 / 去年 365 / 架空同月可算 / 跨架空月 null */
    push(calculateRelativeDays('2024/3/1', '2024/3/1') === 0, '同日必须 0');
    push(calculateRelativeDays('2024/3/1', '2024/3/2') === 1, '次日前必须 1');
    push(calculateRelativeDays('2023/3/1', '2024/3/1') === 366, '闰年跨年必须 366（精确）');
    push(calculateRelativeDays('2024/3/1 15:00', '2024/3/1 傍晚') === 0, '时刻必须被剥掉');
    push(calculateRelativeDays('霜月3日', '霜月9日') === 6, '架空同月必须可算');
    push(calculateRelativeDays('霜月3日', '雪月9日') === null, '跨架空月必须 null');
    push(calculateRelativeDays('', '2024/3/1') === null, '缺一端必须 null');
    /* ⑤ 口语档两向：该用时用，带历法前缀时跳过 */
    push(relativeTimeLabel('2024/3/1', '2024/3/2') === '昨天', '昨天必须直给');
    push(relativeTimeLabel('2024/3/4', '2024/3/1') === '大后天', '三天后必须走「大后天」档');
    /* 3/1→4/1 恰是「同月起一月差」，命中原有「下个月N号」档（源 timeRel.ts:360 同款），故不落天后；
       天档本身另打一发未被周 / 月档截走的 19 天，并配 29 / 30 天边界：源 timeRel.ts:363 是严格 abs<30，
       30 天整必须翻月档，29 天必须仍是天档。 */
    push(relativeTimeLabel('2024/4/1', '2024/3/1') === '下个月1号', '同月起一月差必须落「下个月N号」');
    push(relativeTimeLabel('2024/3/20', '2024/3/1') === '19天后', '无周月档可截时必须落「天后」');
    push(relativeTimeLabel('2024/3/30', '2024/3/1') === '29天后', '未满 30 天必须仍是天档');
    push(relativeTimeLabel('2024/3/31', '2024/3/1') === '1个月后', '满 30 天必须翻进月档');
    push(relativeTimeLabel('2000/1/1', '2024/3/1').endsWith('年前'), '跨年必须落到「年前」');
    push(relativeTimeLabel('元持十一年三月一日', '元持十二年三月一日') === '1年前', '带前缀跨年必须跳过「去年X月X日」降级为年');
    push(relativeTimeLabel('元持十一年三月一日', '元持十一年三月九日') === '8天前', '带前缀近距必须仍是天档（不是周档）');
    push(relativeTimeLabel('霜月3日', '雪月9日') === '', '跨架空月必须空串');
    push(relativeTimeLabel('', '2024/3/1') === '', '缺一端必须空串');
    /* ⑥ 周二向：纯数字带年才给，其余空串 */
    push(/^周[日一二三四五六]$/.test(weekdayLabel('2024/3/1')), '公历带年必须给周几');
    push(weekdayLabel('3/1') === '', '无年必须空');
    push(weekdayLabel('元持十二年八月二十一日') === '', '带前缀必须空');
    push(weekdayLabel('霜月3日') === '', '架空必须空');
    push(weekdayLabel('') === '', '空必须空');
    /* ⑦ 归因两向：ok 有 label、每种放弃各有各的 reason */
    const okRes = storyTimeAge('2024/3/1', '2024/3/2');
    push(okRes.ok === true && okRes.label === '昨天', 'ok 情形必须给 label');
    push(storyTimeAge('', '2024/3/1').reason === 'no-event-time', '缺事件必须留因');
    push(storyTimeAge('2024/3/1', '').reason === 'no-now-time', '缺现在必须留因');
    push(storyTimeAge('霜月3日', '雪月9日').reason === 'cross-fantasy-month', '跨架空月必须留因');
    push(storyTimeAge('乱写', '2024/3/1').reason === 'event-unparsed', '乱写必须留因');
    push(reasonLabel('event-unparsed') !== reasonLabel('cross-fantasy-month'), '两因必须不同形');
    push(reasonLabel('没见过的因') === '没见过的因', '未知因必须如实回原值');
    /* ⑧ 读数：没跑过 vs 全标出 必须不同形 */
    push(storyTimeLine({}).includes('没跑过'), '空读数必须说没跑过');
    push(storyTimeLine({ labeled: 0, skipped: 0 }).includes('没跑过'), '零条必须说没跑过');
    const line = storyTimeLine({ labeled: 2, skipped: 1, byReason: { ok: 2, 'event-unparsed': 1 } });
    push(line.includes('标出 2') && line.includes('事件时间解析不出 1'), '读数必须分态并说因');
    /* ⑩ 年龄推算五态两向：该推的推、该原样的原样、模糊的不硬凑 */
    push(ageDisplayOf('', '2024/3/1', '2024/3/1').state === 'empty', '空年龄必须 empty');
    push(ageDisplayOf('24岁', '', '2024/3/1').state === 'raw-no-anchor', '缺锚点必须原样且留因');
    push(ageDisplayOf('24岁', '2024/3/1', '').state === 'raw-no-anchor', '缺现在必须原样且留因');
    push(ageDisplayOf('24岁', '2024/3/1', '2024/9/1').state === 'raw-within-year', '不足一年必须原样');
    push(ageDisplayOf('24岁', '2024/3/1', '2024/9/1').text === '24岁', '不足一年不得加「约」');
    const est = ageDisplayOf('24岁', '1994/3/1', '2024/3/1');
    push(est.state === 'estimated' && est.text === '约54岁(1994年时24岁)', '跨三十年必须给约数与括注，实得 ' + est.text);
    push(ageDisplayOf('二十四岁', '1994/3/1', '2024/3/1').text === '约54岁(1994年时24岁)', '中文数字年龄必须同样推算');
    push(ageDisplayOf('二十出头', '1994/3/1', '2024/3/1').state === 'raw-uncomputable', '模糊年龄跨年必须原样');
    push(ageDisplayOf('二十出头', '1994/3/1', '2024/3/1').text === '二十出头(1994年时)', '模糊年龄必须留锚点括注');
    push(ageDisplayOf('25%', '1994/3/1', '2024/3/1').text === '25%(1994年时)', '百分数不得当年龄');
    push(ageDisplayOf('24岁', '2024/3/1', '2023/3/1').state === 'raw-uncomputable', '时间倒流必须原样不推算');
    push(ageDisplayOf('24岁', '霜月3日', '雪月9日').state === 'raw-uncomputable', '跨架空月必须原样');
    push(ageDisplay('24岁', '1994/3/1', '2024/3/1') === '约54岁(1994年时24岁)', 'ageDisplay 必须只回串');
    push(ageDisplayLine({}).includes('没跑过'), '空读数必须说没跑过');
    push(ageDisplayLine({ estimated: 2, raw: 1, unknown: 3 }).includes('推算 2 · 原样 1 · 算不出 3'), '读数必须三态分列');
    /* ⑨ 不抛：畸形输入 */
    let threw = false;
    try {
        parseStoryDate(Symbol('s'));
        parseStoryDate([]);
        calculateRelativeDays(null, undefined);
        relativeTimeLabel(42, {});
        storyTimeAge([], []);
        storyTimeLine(null);
        ageDisplayOf(null, null, null);
        ageDisplay(42, {}, []);
        ageDisplayLine(null);
        weekdayLabel(0);
    } catch (_e) { threw = true; }
    push(!threw, '畸形输入不得抛');
    return { ok: problems.length === 0, problems: problems };
}

export default {
    parseStoryDate, calculateRelativeDays, weekdayLabel, relativeTimeLabel,
    storyTimeAge, storyTimeLine, reasonLabel,
    ageDisplayOf, ageDisplay, ageDisplayLine, storyTimeRelSelfCheck
};