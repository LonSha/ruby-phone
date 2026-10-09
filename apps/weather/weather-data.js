/* ========================================================
 * weather-data.js — [v3.27.0] 天气 App 纯函数内核
 *
 * 缝合自两路源：
 *   · EPhone·xINOVO（`src_xinovo/js/modules/weather.js`，250 行 / 9075 字符，`class WeatherService`）
 *     —— 取它的**结构**：角色一份 / 用户一份（`charCity` / `userCity`），
 *        「把天气转成一句自然语言塞给生成侧」的用法，以及 24 小时缓存那条**时效**概念。
 *   · MyPhone（`src_myphone/weather.js`，29718 字符 / 483 行）
 *     —— 取它的**事实模型**：`WEATHER_CODES` 那张 WMO 码表（码 → 中文说法）与 `isRainCode()`
 *        那张「算不算下雨」的码表。这两张表是**知识**，不是请求。
 *
 * 【缝什么、不缝什么 —— 源里三处「本仓不能有」】
 *   ① **源自己发请求**：xINOVO 四家 provider（wttrin / openmeteo / qweather / seniverse），
 *      MyPhone 两处 `fetch`（`api.open-meteo.com` 取天气、`nominatim.openstreetmap.org` 地理编码）。
 *      本仓新增模块**零外部请求**（`tests/audit.test.mjs` 第 8 段的判据），故本件**一条 URL 都没有**：
 *      天气事实由**宿主或用户**填进来（什么时候、哪儿、几度、什么码），本件只做「码 → 说法」的翻译、
 *      「算不算下雨」的判定、时效读数与注入。
 *   ② **源自己拿定位**：`navigator.geolocation.getCurrentPosition` + 手输城市搜经纬度。
 *      本仓不碰定位（那是权限面的事）：城市名是一个**由用户填的字符串**，本件不解析、不换算。
 *   ③ **源读别的 App 的库**：MyPhone 的雨天提醒直开 `indexedDB.open('PhoneSimOctopus')`
 *      去读另一个 App（章鱼助手）的任务表，用来决定提醒谁。
 *      本仓零数据库铁律，且**一个 App 不该读另一个 App 的表** —— 提醒这件事本件不做（没有跨 App 引用）。
 *
 * 【从源里取的三块真价值】
 *   · **天气是「分人的」**：xINOVO 给角色和用户各一套（两地可以不同）——
 *     角色在东京、用户在成都，各自的天气该各说各的。
 *   · **码要翻译成人话**：WMO 码是给机器看的，注入给生成侧的必须是「小雨 / 3℃」这种说得出口的事实。
 *   · **天气有保鲜期**：源缓存 24 小时。本件不自己过期（不删数据——删了就变成「怎么没了」），
 *     而是把**放了多久**算成读数（`staleMs` / `isStale`），由视图与注入决定要不要标「这是昨天的」。
 *
 * 【与源的偏离（逐条写明）】
 *   1. **不请求、不定位、不缓存对象**：只存「最后一次已知观测」，并且**明确标注它是几时的**
 *      （源把 24 小时前的数据照样当当前天气用，界面上看不出来）。
 *   2. **码表按 WMO 全表补全**：源表只有 21 个码（够用但不全），本件按 WMO 4677 的标准码位补齐，
 *      未收录的码一律「未知」而不猜（源也是 `|| { desc: '未知' }`）。
 *   3. **注入不给「穿着建议」**：源里有「不建议洗衣服哦」这类话术 —— 那是角色说的话，归生成侧。
 *      本件只给事实（哪里、几度、什么天、下不下雨、这数据几时的）。
 *
 * 本文件只引 num-gate，无副作用、不碰 DOM、不碰 window、不碰网络、不读聊天历史、不碰定位。
 * ======================================================== */
'use strict';
import { numOrNull } from '../../config/num-gate.js';
import { boundedInt } from '../../config/num-clamp.js';

/** 归因三态。**值**是连字符形，视图文案表的键必须取这里的值（同 focus / piggy / punchcard 纪律）。 */
export const WEATHER_REASONS = Object.freeze({
    ready: 'ready',
    empty: 'empty',
    storage_absent: 'storage-absent',
});

/** 源里就是两份（角色 / 用户）。 */
export const WEATHER_SLOTS = Object.freeze(['char', 'user']);

export const WEATHER_LIMITS = Object.freeze({
    maxCityLen: 24,
    minTempC: -80,
    maxTempC: 60,
    /** 源的缓存时长：24 小时（`this.CACHE_DURATION = 24 * 60 * 60 * 1000`）。 */
    freshMs: 24 * 60 * 60 * 1000,
    maxInjectLines: 4,
});

export const DEFAULT_WEATHER_SETTINGS = Object.freeze({
    injectToPrompt: true,
    maxInjectLines: 4,
    /** 数据放了多久算「不是当下的」。源就是 24 小时。 */
    freshHours: 24,
});

export function defaultWeatherSettings() {
    return Object.freeze({ ...DEFAULT_WEATHER_SETTINGS });
}

export function normalizeWeatherSettings(raw) {
    const d = DEFAULT_WEATHER_SETTINGS;
    const o = (raw && typeof raw === 'object') ? raw : {};
    return Object.freeze({
        injectToPrompt: o.injectToPrompt !== false,
        maxInjectLines: boundedInt(o.maxInjectLines, d.maxInjectLines, 0, 10),
        freshHours: boundedInt(o.freshHours, d.freshHours, 1, 168),
    });
}

/* ---------- 码表（WMO 4677 的常用码位，源表是按需取子集） ---------- */

/** 大类：给视图选图标、给注入挑措辞用；**不用来看数据本身**。 */
export const WEATHER_KINDS = Object.freeze({
    clear: 'clear',
    cloud: 'cloud',
    fog: 'fog',
    drizzle: 'drizzle',
    freezing: 'freezing',
    rain: 'rain',
    snow: 'snow',
    shower: 'shower',
    thunder: 'thunder',
    unknown: 'unknown',
});

/**
 * 码 → `{ desc, kind }`。desc 用源表里的中文说法（晴 / 多云 / 阴 / 雾 / 毛毛雨 / 冻雨 /
 * 小雨 / 中雨 / 大雨 / 小雪 / 中雪 / 大雪 / 雪粒 / 阵雨 / 阵雪 / 雷阵雨）。
 * 未收录的码**就是未知**，不猜成晴天（源也是这个兜底）。
 */
export const WEATHER_CODES = Object.freeze({
    0: { desc: '晴', kind: WEATHER_KINDS.clear },
    1: { desc: '多云', kind: WEATHER_KINDS.cloud },
    2: { desc: '多云', kind: WEATHER_KINDS.cloud },
    3: { desc: '阴', kind: WEATHER_KINDS.cloud },
    45: { desc: '雾', kind: WEATHER_KINDS.fog },
    48: { desc: '雾凇', kind: WEATHER_KINDS.fog },
    51: { desc: '毛毛雨', kind: WEATHER_KINDS.drizzle },
    53: { desc: '毛毛雨', kind: WEATHER_KINDS.drizzle },
    55: { desc: '毛毛雨', kind: WEATHER_KINDS.drizzle },
    56: { desc: '冻毛毛雨', kind: WEATHER_KINDS.freezing },
    57: { desc: '冻毛毛雨', kind: WEATHER_KINDS.freezing },
    61: { desc: '小雨', kind: WEATHER_KINDS.rain },
    63: { desc: '中雨', kind: WEATHER_KINDS.rain },
    65: { desc: '大雨', kind: WEATHER_KINDS.rain },
    66: { desc: '冻雨', kind: WEATHER_KINDS.freezing },
    67: { desc: '冻雨', kind: WEATHER_KINDS.freezing },
    71: { desc: '小雪', kind: WEATHER_KINDS.snow },
    73: { desc: '中雪', kind: WEATHER_KINDS.snow },
    75: { desc: '大雪', kind: WEATHER_KINDS.snow },
    77: { desc: '雪粒', kind: WEATHER_KINDS.snow },
    80: { desc: '阵雨', kind: WEATHER_KINDS.shower },
    81: { desc: '阵雨', kind: WEATHER_KINDS.shower },
    82: { desc: '阵雨', kind: WEATHER_KINDS.shower },
    85: { desc: '阵雪', kind: WEATHER_KINDS.shower },
    86: { desc: '阵雪', kind: WEATHER_KINDS.shower },
    95: { desc: '雷阵雨', kind: WEATHER_KINDS.thunder },
    96: { desc: '雷阵雨', kind: WEATHER_KINDS.thunder },
    99: { desc: '雷阵雨', kind: WEATHER_KINDS.thunder },
});

/** 源 `isRainCode` 的那张码表，**逐字照搬**（56/57/66/67 算在下雨里）。 */
export const WEATHER_RAIN_CODES = Object.freeze([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82, 95, 96, 99]);

/** 源口径：这场天算不算「下雨」（含冻雨、雷阵雨）。 */
export function isRainCode(code) {
    const n = numOrNull(code);
    if (n === null) return false;
    return WEATHER_RAIN_CODES.includes(Math.round(n));
}

/** 码 → 中文说法。未知码返回「未知」（不猜）。 */
export function describeCode(code) {
    const n = numOrNull(code);
    if (n === null) return '未知';
    const hit = WEATHER_CODES[Math.round(n)];
    return hit ? hit.desc : '未知';
}

/** 码 → 大类。未知码给 `unknown`。 */
export function kindOfCode(code) {
    const n = numOrNull(code);
    if (n === null) return WEATHER_KINDS.unknown;
    const hit = WEATHER_CODES[Math.round(n)];
    return hit ? hit.kind : WEATHER_KINDS.unknown;
}

/* ---------- 数值格式化 ---------- */

/** 温度显示（一位小数；源是 `temp_C + '℃'` 字符串直用，本件统一成一个口）。 */
export function formatTempC(v) {
    const n = numOrNull(v);
    if (n === null) return '';
    const r = Math.round(n * 10) / 10;
    return (Number.isInteger(r) ? String(r) : r.toFixed(1)) + '\u2103';
}

/**
 * 观测年龄的说法（源用 24 小时缓存一刀切，本件把它显出来）。
 * 返回 `''`（无时间）/「刚刚」/「N 分钟前」/「N 小时前」/「N 天前」。
 */
export function formatAge(ms) {
    const n = numOrNull(ms);
    if (n === null) return '';
    if (n < 60000) return '刚刚';
    if (n < 3600000) return Math.floor(n / 60000) + ' 分钟前';
    if (n < 86400000) return Math.floor(n / 3600000) + ' 小时前';
    return Math.floor(n / 86400000) + ' 天前';
}

/* ---------- 观测记录 ---------- */

function normSlot(raw) {
    const o = (raw && typeof raw === 'object') ? raw : {};
    const city = String(o.city || '').trim().slice(0, WEATHER_LIMITS.maxCityLen);
    const t = numOrNull(o.tempC);
    const tempC = (t === null) ? null
        : Math.max(WEATHER_LIMITS.minTempC, Math.min(WEATHER_LIMITS.maxTempC, Math.round(t * 10) / 10));
    const c = numOrNull(o.code);
    const code = (c === null) ? null : Math.round(c);
    return {
        city,
        tempC,
        code,
        desc: describeCode(code),
        kind: kindOfCode(code),
        isRain: isRainCode(code),
        observedAt: boundedInt(o.observedAt, 0, 0, 4102444800000),
    };
}

/** 全账规范化（两个槽位）。 */
export function normalizeWeatherState(raw) {
    const o = (raw && typeof raw === 'object') ? raw : {};
    const out = {};
    for (const s of WEATHER_SLOTS) out[s] = normSlot(o[s]);
    return out;
}

export function emptyWeatherState() {
    return normalizeWeatherState(null);
}

/**
 * 记一条观测。**城市名与温度至少得有一个**，否则这条记录没有意义（返回 `{ok:false}`）。
 * 码非法（不在表里）**不拒收**，只是描述成「未知」—— 天气码表本来就会随年份扩，
 * 拒收会让「今天有个没见过的新码」变成「什么都记不下来」。
 */
export function setObservation(state, slot, patch, now) {
    const s = normalizeWeatherState(state);
    if (!WEATHER_SLOTS.includes(slot)) return { state: s, ok: false, error: '未知的槽位' };
    const o = (patch && typeof patch === 'object') ? patch : {};
    const city = String(o.city !== undefined ? o.city : s[slot].city).trim().slice(0, WEATHER_LIMITS.maxCityLen);
    const hasTemp = (o.tempC !== undefined && o.tempC !== null && o.tempC !== '');
    const tempC = hasTemp ? numOrNull(o.tempC) : (Number.isFinite(s[slot].tempC) ? s[slot].tempC : null);
    const hasCode = (o.code !== undefined && o.code !== null && o.code !== '');
    const code = hasCode ? numOrNull(o.code) : (s[slot].code === null ? null : s[slot].code);
    if (!city && tempC === null) return { state: s, ok: false, error: '至少要知道在哪儿、或者几度' };
    const t = numOrNull(now);
    const observedAt = (o.observedAt !== undefined) ? boundedInt(o.observedAt, 0, 0, 4102444800000)
        : (t === null ? Date.now() : Math.round(t));
    s[slot] = normSlot({
        city,
        tempC: tempC === null ? null : tempC,
        code: code === null ? null : code,
        observedAt,
    });
    return { state: s, ok: true };
}

/** 清掉一个槽位（**只清观测，别的什么都不动**）。 */
export function clearObservation(state, slot) {
    const s = normalizeWeatherState(state);
    if (!WEATHER_SLOTS.includes(slot)) return { state: s, cleared: 0 };
    const had = s[slot].city || s[slot].tempC !== null || s[slot].code !== null;
    s[slot] = normSlot(null);
    return { state: s, cleared: had ? 1 : 0 };
}

export function clearAllObservations(state) {
    const s = normalizeWeatherState(state);
    let cleared = 0;
    for (const slot of WEATHER_SLOTS) {
        if (s[slot].city || s[slot].tempC !== null || s[slot].code !== null) cleared += 1;
        s[slot] = normSlot(null);
    }
    return { state: s, cleared };
}

/* ---------- 投影 / 归因 / 注入 ---------- */

/** 归因：先判能不能读，再判读到了什么。**两个槽位都空**才算 empty。 */
export function readWeatherFace(probe) {
    if (!probe || probe.storageOk === false) return WEATHER_REASONS.storage_absent;
    if (probe.hasAny !== true) return WEATHER_REASONS.empty;
    return WEATHER_REASONS.ready;
}

/** 一个槽位的读数：摆上「它是什么」+「它放了多久」。 */
export function slotReading(slotData, now, freshMs) {
    const s = normSlot(slotData);
    const t = numOrNull(now);
    const nowMs = t === null ? Date.now() : Math.round(t);
    const has = !!(s.city || s.tempC !== null || s.code !== null);
    const ageMs = (has && s.observedAt) ? Math.max(0, nowMs - s.observedAt) : null;
    const fresh = (typeof freshMs === 'number' && freshMs > 0)
        ? (ageMs !== null && ageMs <= freshMs)
        : true;
    return {
        slot: '',
        has,
        city: s.city,
        tempC: s.tempC,
        tempText: formatTempC(s.tempC),
        code: s.code,
        desc: s.desc,
        kind: s.kind,
        isRain: s.isRain,
        observedAt: s.observedAt,
        ageMs,
        ageText: ageMs === null ? '' : formatAge(ageMs),
        isStale: has ? !fresh : false,
    };
}

/** 投影。读不到就如实给空，**不编数**。 */
export function projectWeather(state, settings, now) {
    const s = normalizeWeatherState(state);
    const freshMs = (settings && numOrNull(settings.freshHours) !== null)
        ? Math.round(settings.freshHours) * 3600000
        : WEATHER_LIMITS.freshMs;
    const rows = WEATHER_SLOTS.map((slot) => {
        const r = slotReading(s[slot], now, freshMs);
        return { ...r, slot };
    });
    return {
        rows,
        freshMs,
        observedCount: rows.filter((r) => r.has).length,
        rainCount: rows.filter((r) => r.has && r.isRain).length,
        staleCount: rows.filter((r) => r.has && r.isStale).length,
        hasAny: rows.some((r) => r.has),
    };
}

/**
 * 生成侧注入块。只给**事实**：谁在哪儿、什么天、几度、下不下雨、这条是几时的。
 * 不给穿着建议、不给角色台词。两处都没记 ⇒ 返回**空串**（不产生空块）。
 */
export function weatherPromptBlock(proj, settings) {
    if (!settings || settings.injectToPrompt !== true) return '';
    if (!proj || !proj.hasAny) return '';
    const max = (typeof settings.maxInjectLines === 'number') ? settings.maxInjectLines : 4;
    if (max <= 0) return '';
    const LABEL = { char: '角色所在地', user: '你所在地' };
    const rows = [];
    for (const r of proj.rows) {
        if (!r.has) continue;
        const bits = [];
        if (r.city) bits.push(r.city);
        bits.push(r.desc);
        if (r.tempText) bits.push(r.tempText);
        if (r.isRain) bits.push('在下雨');
        const line = '\u00b7 ' + LABEL[r.slot] + '：' + bits.join('\uff0c')
            + (r.isStale && r.ageText ? ('（这条是 ' + r.ageText + '记的，未必是当下的）') : '');
        rows.push(line);
        if (rows.length >= max) break;
    }
    if (!rows.length) return '';
    return '【系统·天气】\n' + rows.join('\n');
}