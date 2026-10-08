/* ========================================================
 * lover-data.js — [v3.30.0] 恋爱空间（情侣空间）· 纯函数内核
 *
 * 缝合自 EPhone·xintuk（`runtime/scripts/lovers-space/`，四片 174001 字节 / 77 函数）。
 * 源是一个把**六件事**塞进同一个 `chat.loversSpaceData` 的模块：
 *   ① 在一起天数（`relationshipStartDate`）
 *   ② 今日足迹（`dailyActivity[YYYY-MM-DD]`，一整天的时间轴 + 可选 HTML 小剧场）
 *   ③ 心情日记 + 心情罐子（`emotionDiaries[YYYY-MM-DD]`，双方各一个 emoji + 各一段日记）
 *   ④ 情书（`loveLetters`，可回信 —— 回信时收发双方对调）
 *   ⑤ 提问与回答（`questions`，提问者与回答者各为 user / char）
 *   ⑥ 说说 / 相册 / 照片 / 分享（`moments` / `albums` / `photos` / `shares`）
 * 本件取其中**五块**（①②③④⑤），第 ⑥ 块**不取**（理由见下「四处不缝」①）。
 *
 * ── 四条偏离（偏离不是遗漏，逐条写明）────────────────────────
 *   ① **不做实时定时器**：源的今日足迹「到点显形」靠 `setInterval(…, 60 * 1000)` 每
 *      分钟重画一次（切页签时还要 clearInterval 收掉）。本件一个定时器都不转 ——
 *      改「惰性显形」：每次取数用 `now` 一次性算出「到此刻为止哪些条已经到点」，
 *      纯函数、可复算、与页面在不在无关（桃宝的物流时间线是同一套处置）。
 *   ② **时间一律「本地时区的日期串＋当天的毫秒时刻」**：源用 `toISOString().split('T')[0]`
 *      取日期串 —— 那是 **UTC 日期**，在东八区会让 00:00–07:59 的足迹记到「昨天」。
 *      本件改用本地日期串（`localDateStr`），并把「一天只有一次」这条门规建在**本地日**上。
 *   ③ **足迹条数有上限**：源一天可以塞进任意条（模型给多少就多少）。本件封顶
 *      `maxFootprintsPerDay`（24），超出的**如实计数**而不是静默丢弃（`overCap` 读数）。
 *   ④ **心情日记的日期键必须是本地日、且空的是「没记」不是「记了空」**：源的 `emotionDiaries`
 *      用同一个 UTC 日期串，且写入空字符串也算「有记录」。本件：空串一律归一成
 *      `null`（没记），`hasDiary()` 判的是**内容非空**，日历上不会出现「有格子点不进去」。
 *
 * ── 四处不缝（源里有、本仓明令禁止或有第二个权威的东西，一条都没进来）──
 *   ① **说说 / 相册 / 照片 / 分享不取**：本仓的 `apps/weibo/` 就是**完整的动态与相册**
 *      （2611 行 / 4669 行视图），源那四块与它是同一件事的第二份实现。同一件事两个权威
 *      ⇒ 用户在哪儿发都可能「另一半看不见」。故本件**只做恋爱空间特有的那五块**
 *      （天数 / 足迹 / 心情 / 情书 / 问答）—— 它们在本仓**零对应物**。
 *   ② **番茄钟不取**：源的 002/003 两片里带着一整套番茄钟 + 白噪音播放器（`pomodoroState`、
 *      `bgmAudio = new Audio()`、`setInterval` 计时、打断闲聊）。本仓 `apps/focus/`（v3.21.0）
 *      已是权威；且**一个模块里两处计时器**正是本仓忌的形态。整块不缝。
 *   ③ **不直连模型**：源 `handleGenerateDailyActivity` / `triggerPomodoroAIResponse` 直接
 *      `fetch(proxyUrl + '/v1/chat/completions')` 并自己拼 systemPrompt。本仓模型调用走
 *      宿主生成侧 —— App 不自己发请求。故今日足迹**不靠模型生成**，而是像桃宝的商品目录
 *      那样**由用户登记**（模型要看，走 `loverPromptBlock` 注入的事实块）。
 *   ④ **不写 Dexie、不碰 `db.chats` / `chat.history`**：源把整份 `chat` 对象
 *      `db.chats.put(chat)` 落库，还往 `chat.history` 里塞 `isHidden` 的系统消息去驱动模型。
 *      本仓零数据库铁律（落 PhoneStorage、键走 `^lover_`），且**不替宿主往对话里写楼层**
 *      （那是生成侧的事，App 干了就成了第二个写手）。
 *   ⑤ **12 条外链素材一条不收**：源的默认背景是 `i.postimg.cc/…/profile-banner.jpg`，
 *      音乐播放器指向网易云 / QQ 音乐的搜索接口。本件**一条 URL 都没有**。
 *
 * ── 本套件守的静默失效形态（都不报错、不崩溃，只是结果不对）──
 *   · 「在一起第 N 天」的**首日算第 1 天**（源 `+ 1`）—— 差一天是最常见的错法；
 *   · 跨天不算错天：起算日与今天**都归零到本地 0 点**再除天数；
 *   · 未来时刻的足迹**不许提前显形**（源只显 `timestamp <= now`）；
 *   · 心情日记的空串**不许当成有记录**；
 *   · 情书回信**收发必须对调**（回错方向在界面上看不出来）；
 *   · 问答的三态**不许塌成两态**（「等 Ta 答」与「等你答」是两种不同的事实）。
 * ======================================================== */
'use strict';

/* ★ 本仓铁律：数值取数口径**全仓只有一份实现**（`config/num-gate.js`）。
 *   本层不自己再写一份 `Number.isFinite(Number(x))` —— 那个写法会把
 *   `''` / `[]` / `true` 全读成 `0`，于是「上游没给这一格」与「上游给了 0」
 *   塔成同一读数，而两者处置相反。本文件因此**只有一条 import**。
 *   （本文件仍是纯函数内核：那一条 import 是零依赖叶子模块，无副作用。） */
import { numOrNull } from '../../config/num-gate.js';

/* ---------- 归因（与 taobao/widget/block 同形：先判能不能读） ---------- */

export const LOVER_REASONS = Object.freeze({
    ready: 'ready',
    empty: 'empty',
    storage_absent: 'storage-absent',
});

/** 两个面：天数面 / 日记面（视图的问法不同，读数不同）。 */
export const LOVER_FACES = Object.freeze(['days', 'diary']);

export const LOVER_LIMITS = Object.freeze({
    /** 一天最多几条足迹（源的模型可以给任意条；本件封顶并如实计数）。 */
    maxFootprintsPerDay: 24,
    /** 心情日记最多存多少天。 */
    maxDiaryDays: 400,
    /** 情书上限。 */
    maxLetters: 100,
    /** 问答上限。 */
    maxQuestions: 100,
    /** 单条文本上限（足迹描述 / 日记正文 / 情书 / 提问 / 回答）。 */
    maxTextLen: 800,
    /** emoji 位长度上限（一个 emoji 可能由多个码点组成，按码点算 8 足够）。 */
    maxEmojiLen: 8,
    /** 在一起天数的起算日最早不早于这一年（防手滑打成 1900 让天数变五位数）。 */
    minStartYear: 1970,
    /** 注入块最多给几条事实。 */
    maxInjectLines: 6,
    /**
     * 足迹按日期留存多少天。
     * 源把 dailyActivity 全量存在 chat 里（日期键，没有上限）—— 长会话下那是**无上界增长**。
     * 本件只留最近这些天，更早的**如实计数后丢弃**（`footprintsExpired`），不静默吞。
     */
    maxFootprintDays: 30,
});

export const DEFAULT_LOVER_SETTINGS = Object.freeze({
    injectToPrompt: true,
    maxInjectLines: 6,
    /** 足迹「到点显形」：到点的那条才画（源的行为）。关掉则整天一次画全。 */
    revealByTime: true,
    /** 每天只登记一次足迹（源的门规：`此操作每天只能进行一次`）。 */
    oncePerDay: true,
});

export function defaultLoverSettings() {
    return Object.freeze({ ...DEFAULT_LOVER_SETTINGS });
}

const intOr = (v, d) => {
    const n = numOrNull(v);
    return n === null ? d : Math.round(n);
};
const boundedInt = (v, d, lo, hi) => Math.min(hi, Math.max(lo, intOr(v, d)));

export function normalizeLoverSettings(raw) {
    const o = (raw && typeof raw === 'object') ? raw : {};
    const d = DEFAULT_LOVER_SETTINGS;
    return Object.freeze({
        injectToPrompt: (o.injectToPrompt === undefined) ? d.injectToPrompt : !!o.injectToPrompt,
        maxInjectLines: boundedInt(o.maxInjectLines, d.maxInjectLines, 0, 20),
        revealByTime: (o.revealByTime === undefined) ? d.revealByTime : !!o.revealByTime,
        oncePerDay: (o.oncePerDay === undefined) ? d.oncePerDay : !!o.oncePerDay,
    });
}

/** 归因三态：**先判能不能读**（读不到就说读不到，不许说「空的」）。 */
export function readLoverFace(probe) {
    if (!probe || probe.storageOk === false) return LOVER_REASONS.storage_absent;
    if (probe.hasAny !== true) return LOVER_REASONS.empty;
    return LOVER_REASONS.ready;
}

/* ---------- ① 在一起天数 ---------- */

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * 时间参数归一：这两个对外函数（`daysTogether` / `startOfLocalDay` / `localDateStr`）
 * 的既有契约是**接受 Date 对象**（界面传的就是 `new Date(...)`）。
 * ★ `numOrNull` 只认 number / 非空数字串（它的职责是「这格有没有一个可用的数」），
 * 故 Date 在这里**先显式取毫秒再过门** —— 这是类型判定，不是又写一份弱口径。
 * （当初把 Date 直接丢给 numOrNull，结果「传 Date 变成没传」—— 数天从 1 变成了 273，被 A1 当场抳中。）
 */
export function msOfTime(v) {
    if (v instanceof Date) return numOrNull(v.getTime());
    return numOrNull(v);
}

/** 本地日期串 `YYYY-MM-DD`（★ 偏离②：源用的是 UTC 日期串，东八区会把凌晨算到昨天）。 */
export function localDateStr(ms) {
    const t = msOfTime(ms);
    const d = new Date(t === null ? Date.now() : t);
    const p = (n) => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

/** 把任意时间归零到**本地 0 点**（源的算法先 setHours(0,0,0,0) 再算差）。 */
export function startOfLocalDay(ms) {
    const t = msOfTime(ms);
    const d = new Date(t === null ? Date.now() : t);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
}

/**
 * 「我们已经在一起 N 天了」。
 * 源：两天都归零到 0 点 → `Math.abs(差) / 一天` 向上取整 → **再 +1**（首日即第 1 天）。
 * 起算日缺失/非法 ⇒ 返回 null（界面显示「点击设置来记录第一天吧」）。
 * 起算日在**未来** ⇒ 返回 null（不是负数天数：那是「还没开始」，与「没设」在界面上同一句话）。
 */
export function daysTogether(startDate, now) {
    const s = parseDateInput(startDate);
    if (s === null) return null;
    const from = startOfLocalDay(s);
    const to = startOfLocalDay(now);
    if (from > to) return null;
    return Math.ceil(Math.abs(to - from) / MS_PER_DAY) + 1;
}

/**
 * 起算日输入解析：接受 `YYYY-MM-DD` / 毫秒数 / Date。
 * 坏输入一律 null（**不抛**：一个坏字符串不该让整个空间打不开）。
 */
export function parseDateInput(v) {
    if (v === null || v === undefined || v === '') return null;
    if (typeof v === 'number') { const n = numOrNull(v); return n === null ? null : Math.round(n); }
    if (v instanceof Date) return numOrNull(v.getTime());
    const s = String(v).trim();
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
    if (m) {
        const y = Number(m[1]); const mo = Number(m[2]); const d = Number(m[3]);
        if (y < LOVER_LIMITS.minStartYear || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
        const dt = new Date(y, mo - 1, d, 0, 0, 0, 0);
        /* 反查一遍：2026-02-30 会被 Date 顺延成 3-02，那种「看着像日期其实不存在」的输入必须拒。 */
        if (dt.getFullYear() !== y || dt.getMonth() + 1 !== mo || dt.getDate() !== d) return null;
        return dt.getTime();
    }
    const n = numOrNull(s);
    if (n !== null && n > 0) return Math.round(n);
    return null;
}

/* ---------- ② 今日足迹 ---------- */

/**
 * 足迹规范化：源一条足迹是 `{ time: 'HH:mm', description, duration?, icon, html_snippet? }`。
 * 本件把 `time` **就地转成当天毫秒时刻**（`at`），这样「到点显形」是纯数值比较。
 * 坏输入（没有 time / 时间格式不对 / 描述空）**如实丢弃并计数**（`dropped`），不静默吞。
 */
export function normalizeFootprints(list, dayMs) {
    const base = Array.isArray(list) ? list : [];
    const day0 = startOfLocalDay(dayMs === undefined ? Date.now() : dayMs);
    const kept = [];
    let dropped = 0;
    for (const it of base) {
        const o = (it && typeof it === 'object') ? it : {};
        const at = atFromHHMM(o.time, day0);
        const desc = String(o.description || '').trim();
        if (at === null || !desc) { dropped += 1; continue; }
        kept.push(Object.freeze({
            at,
            time: hhmmOf(at),
            description: desc.slice(0, LOVER_LIMITS.maxTextLen),
            duration: String(o.duration || '').trim().slice(0, 32),
            icon: String(o.icon || '').trim().slice(0, LOVER_LIMITS.maxEmojiLen),
            /* HTML 小剧场：源直接把模型给的 HTML 塞进 innerHTML。本件**只当文本留存**，
             *   视图里不解析（零动态求值同族的纪律：不把外来 HTML 当代码看）。 */
            snippet: String(o.html_snippet || '').trim().slice(0, LOVER_LIMITS.maxTextLen),
        }));
    }
    kept.sort((a, b) => a.at - b.at);
    const capped = kept.length > LOVER_LIMITS.maxFootprintsPerDay;
    return Object.freeze({
        list: Object.freeze(kept.slice(0, LOVER_LIMITS.maxFootprintsPerDay)),
        dropped,
        overCap: capped ? kept.length - LOVER_LIMITS.maxFootprintsPerDay : 0,
    });
}

/** `'HH:mm'` → 当天毫秒时刻。非法返回 null（**不抛**）。 */
export function atFromHHMM(hhmm, dayMs) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || '').trim());
    if (!m) return null;
    const h = Number(m[1]); const mi = Number(m[2]);
    if (h < 0 || h > 23 || mi < 0 || mi > 59) return null;
    return startOfLocalDay(dayMs) + (h * 60 + mi) * 60 * 1000;
}

export function hhmmOf(ms) {
    const d = new Date(Number(ms));
    const p = (n) => String(n).padStart(2, '0');
    return p(d.getHours()) + ':' + p(d.getMinutes());
}

/**
 * 到点显形：只留 `at <= now` 的（源 `activities.filter((act) => act.timestamp <= now)`）。
 * `allShown` 是源那个返回值的同名口径（用来决定还要不要重画）。
 */
export function visibleFootprints(list, now, revealByTime) {
    const arr = Array.isArray(list) ? list : [];
    const t = Number(now);
    const nowMs = Number.isFinite(t) ? Math.round(t) : Date.now();
    if (revealByTime === false) {
        return Object.freeze({ visible: Object.freeze(arr.slice()), hidden: 0, allShown: true });
    }
    const visible = arr.filter((x) => x && Number.isFinite(x.at) && x.at <= nowMs);
    return Object.freeze({
        visible: Object.freeze(visible.slice()),
        hidden: arr.length - visible.length,
        allShown: visible.length === arr.length,
    });
}

/** 今日还可不可以登记（源的门规：一天一次）。`force` 是显式覆盖。 */
export function canRegisterToday(existing, dayMs, oncePerDay, force) {
    if (force) return Object.freeze({ ok: true, reason: 'forced' });
    if (oncePerDay === false) return Object.freeze({ ok: true, reason: 'allowed' });
    const has = Array.isArray(existing) && existing.length > 0;
    return Object.freeze({ ok: !has, reason: has ? 'today-already' : 'allowed' });
}

/* ---------- ③ 心情日记 + 心情罐子 ---------- */

/**
 * 一条心情日记：`{ userEmoji, charEmoji, userDiary, charDiary }`。
 * ★ 偏离④：空串归一成 null（「没记」不等于「记了空」）。
 */
export function normalizeDiaryEntry(raw) {
    const o = (raw && typeof raw === 'object') ? raw : {};
    const em = (v) => {
        const s = String(v === null || v === undefined ? '' : v).trim();
        return s ? s.slice(0, LOVER_LIMITS.maxEmojiLen) : null;
    };
    const tx = (v) => {
        const s = String(v === null || v === undefined ? '' : v).trim();
        return s ? s.slice(0, LOVER_LIMITS.maxTextLen) : null;
    };
    return Object.freeze({
        userEmoji: em(o.userEmoji),
        charEmoji: em(o.charEmoji),
        userDiary: tx(o.userDiary),
        charDiary: tx(o.charDiary),
    });
}

/** 「这一天有记录吗」——**内容非空**才算（emoji 或任一方日记）。 */
export function hasDiary(entry) {
    if (!entry) return false;
    return !!(entry.userEmoji || entry.charEmoji || entry.userDiary || entry.charDiary);
}

/** `YYYY-MM-DD` 串 → `{y, m, d}`；非法返回 null。 */
export function splitDateStr(s) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || '').trim());
    if (!m) return null;
    const y = Number(m[1]); const mo = Number(m[2]); const d = Number(m[3]);
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    const dt = new Date(y, mo - 1, d, 0, 0, 0, 0);
    if (dt.getFullYear() !== y || dt.getMonth() + 1 !== mo || dt.getDate() !== d) return null;
    return Object.freeze({ y, m: mo, d });
}

/** 该月天数（用「下月 0 号」取，不手写月份表）。 */
export function daysInMonth(year, month) {
    const y = intOr(year, 1970); const m = boundedInt(month, 1, 1, 12);
    return new Date(y, m, 0).getDate();
}

/**
 * 日历格子：前导空格数 = 该月 1 号是周几（0=周日，源的表头是「日一二三四五六」），
 * 之后逐日一格。每格带 `dateStr` / `day` / 双方 emoji / 有没有日记。
 * **不返回 HTML**（源返回 HTML 串；本件数据层只给数据结构，画是视图的事）。
 */
export function calendarGrid(year, month, diaryMap) {
    const y = intOr(year, 1970); const mo = boundedInt(month, 1, 1, 12);
    const map = (diaryMap && typeof diaryMap === 'object') ? diaryMap : {};
    const lead = new Date(y, mo - 1, 1).getDay();
    const dim = daysInMonth(y, mo);
    const todayStr = localDateStr(Date.now());
    const cells = [];
    for (let i = 0; i < lead; i += 1) cells.push(null);
    for (let d = 1; d <= dim; d += 1) {
        const p = (n) => String(n).padStart(2, '0');
        const ds = y + '-' + p(mo) + '-' + p(d);
        const e = normalizeDiaryEntry(map[ds]);
        cells.push(Object.freeze({
            dateStr: ds, day: d, isToday: ds === todayStr,
            userEmoji: e.userEmoji, charEmoji: e.charEmoji, hasDiary: hasDiary(e),
        }));
    }
    return Object.freeze({ year: y, month: mo, lead, daysInMonth: dim, cells: Object.freeze(cells) });
}

/**
 * 心情罐子：把该月**所有**记过的 emoji 平铺（源的顺序：按日期键遍历，先 user 后 char）。
 * 顺序是**可复算**的：按日期串升序 —— 源的 `for (const dateStr in diaryData)` 依赖对象键序，
 * 那是「看着一样、其实换台机器就变」的一处；本件显式排序。
 */
export function moodJar(year, month, diaryMap) {
    const y = intOr(year, 1970); const mo = boundedInt(month, 1, 1, 12);
    const map = (diaryMap && typeof diaryMap === 'object') ? diaryMap : {};
    const p = (n) => String(n).padStart(2, '0');
    const prefix = y + '-' + p(mo) + '-';
    const keys = Object.keys(map).filter((k) => typeof k === 'string' && k.startsWith(prefix)).sort();
    const items = [];
    for (const k of keys) {
        const e = normalizeDiaryEntry(map[k]);
        if (e.userEmoji) items.push(e.userEmoji);
        if (e.charEmoji) items.push(e.charEmoji);
    }
    return Object.freeze({ count: items.length, emojis: Object.freeze(items) });
}

/* ---------- ④ 情书 ---------- */

/**
 * 写一封信。`replyTo` 非空时**收发对调**（源：`senderName: 我` /
 * `recipientName: originalLetter.senderName`）—— 回信方向错在界面上看不出来，
 * 是本件要守的静默失效之一。
 */
export function composeLetter(content, ctx, replyTo, now) {
    const text = String(content || '').trim();
    if (!text) return Object.freeze({ letter: null, error: 'empty-content' });
    const c = (ctx && typeof ctx === 'object') ? ctx : {};
    const meName = String(c.myName || '我').trim() || '我';
    const meAvatar = c.myAvatar ? String(c.myAvatar) : null;
    const charName = String(c.charName || '').trim();
    const charAvatar = c.charAvatar ? String(c.charAvatar) : null;
    const rep = (replyTo && typeof replyTo === 'object') ? replyTo : null;
    /* ★ 源的一处坑：回信时收发对调，但**回自己的信**也会照做 —— 于是产出一封
     *   「我 → 我」的怪信，且方向在界面上看不出来。本件直接拒收（回信只能回**来信**）。 */
    if (rep && String(rep.senderId || 'user') === 'user') {
        return Object.freeze({ letter: null, error: 'self-reply' });
    }
    const t = Number(now);
    const ts = Number.isFinite(t) ? Math.round(t) : Date.now();
    const base = {
        id: 'letter_' + ts + '_' + Math.floor(Math.random() * 1000),
        content: text.slice(0, LOVER_LIMITS.maxTextLen),
        timestamp: ts,
        replyToId: rep ? String(rep.id || '') : null,
    };
    if (rep) {
        return Object.freeze({
            letter: Object.freeze({
                ...base,
                senderId: 'user', senderName: meName, senderAvatar: meAvatar,
                recipientId: rep.senderId || 'char',
                recipientName: String(rep.senderName || charName || ''), recipientAvatar: rep.senderAvatar || null,
            }),
            error: null,
        });
    }
    if (!charName) return Object.freeze({ letter: null, error: 'no-char' });
    return Object.freeze({
        letter: Object.freeze({
            ...base,
            senderId: 'user', senderName: meName, senderAvatar: meAvatar,
            recipientId: 'char', recipientName: charName, recipientAvatar: charAvatar,
        }),
        error: null,
    });
}

/** 情书列表规范化：坏条目如实丢弃并计数，按时间升序（源显示时 reverse 成新→旧）。 */
export function normalizeLetters(list) {
    const base = Array.isArray(list) ? list : [];
    const kept = [];
    let dropped = 0;
    for (const it of base) {
        const o = (it && typeof it === 'object') ? it : {};
        const text = String(o.content || '').trim();
        const ts = numOrNull(o.timestamp);
        if (!text || ts === null) { dropped += 1; continue; }
        kept.push(Object.freeze({
            id: String(o.id || ('letter_' + Math.round(ts))),
            senderId: String(o.senderId || 'user'),
            senderName: String(o.senderName || ''),
            senderAvatar: o.senderAvatar ? String(o.senderAvatar) : null,
            recipientId: String(o.recipientId || 'char'),
            recipientName: String(o.recipientName || ''),
            recipientAvatar: o.recipientAvatar ? String(o.recipientAvatar) : null,
            content: text.slice(0, LOVER_LIMITS.maxTextLen),
            timestamp: Math.round(ts),
            replyToId: o.replyToId ? String(o.replyToId) : null,
        }));
    }
    kept.sort((a, b) => a.timestamp - b.timestamp);
    const over = Math.max(0, kept.length - LOVER_LIMITS.maxLetters);
    return Object.freeze({
        list: Object.freeze(over ? kept.slice(kept.length - LOVER_LIMITS.maxLetters) : kept),
        dropped,
        overCap: over,
    });
}

/**
 * 记一封**来信**（`senderId: 'char'`）。
 * ★ 源里角色来信由模型驱动（往 `chat.history` push 一条隐藏系统消息让模型产出）——
 *   本件不替宿主写楼层，故改成「宿主/用户把 Ta 说的话贴进来归档」：事实由外面填，
 *   本件只负责存成形状正确的一封信。没有它，回信功能就是个没有对象的按钮。
 */
export function composeIncoming(content, ctx, now) {
    const text = String(content || '').trim();
    if (!text) return Object.freeze({ letter: null, error: 'empty-content' });
    const c = (ctx && typeof ctx === 'object') ? ctx : {};
    const meName = String(c.myName || '我').trim() || '我';
    const charName = String(c.charName || '').trim();
    if (!charName) return Object.freeze({ letter: null, error: 'no-char' });
    const t = Number(now);
    const ts = Number.isFinite(t) ? Math.round(t) : Date.now();
    return Object.freeze({
        letter: Object.freeze({
            id: 'letter_' + ts + '_' + Math.floor(Math.random() * 1000),
            senderId: 'char', senderName: charName, senderAvatar: c.charAvatar ? String(c.charAvatar) : null,
            recipientId: 'user', recipientName: meName, recipientAvatar: c.myAvatar ? String(c.myAvatar) : null,
            content: text.slice(0, LOVER_LIMITS.maxTextLen),
            timestamp: ts,
            replyToId: null,
        }),
        error: null,
    });
}

/* ---------- ⑤ 提问与回答 ---------- */

/** 三态（**不许塌成两态**：「等 Ta 答」与「等你答」是两种不同的事实）。 */
export const QUESTION_STATES = Object.freeze({
    awaiting_char: 'awaiting-char',
    awaiting_user: 'awaiting-user',
    answered: 'answered',
});

export function questionState(q) {
    const o = (q && typeof q === 'object') ? q : {};
    if (String(o.answerText || '').trim()) return QUESTION_STATES.answered;
    return (String(o.answerer || '') === 'user') ? QUESTION_STATES.awaiting_user : QUESTION_STATES.awaiting_char;
}

export function normalizeQuestion(raw, now) {
    const o = (raw && typeof raw === 'object') ? raw : {};
    const text = String(o.questionText || '').trim();
    if (!text) return null;
    const t = numOrNull(o.timestamp);
    const nw = numOrNull(now);
    const ts = (t === null) ? (nw === null ? Date.now() : Math.round(nw)) : Math.round(t);
    const ans = String(o.answerText || '').trim();
    const who = (String(o.questioner || 'user') === 'char') ? 'char' : 'user';
    const ansr = (String(o.answerer || (who === 'user' ? 'char' : 'user')) === 'user') ? 'user' : 'char';
    return Object.freeze({
        id: String(o.id || ('q_' + ts)),
        questioner: who,
        questionText: text.slice(0, LOVER_LIMITS.maxTextLen),
        timestamp: ts,
        answerer: ansr,
        answerText: ans ? ans.slice(0, LOVER_LIMITS.maxTextLen) : null,
    });
}

/**
 * 提一个问（源：提问者=user、指定回答者=char、answerText=null）。
 * 内容空 ⇒ 拒收并给原因（**不抛**）。
 */
export function askQuestion(raw, now) {
    const q = normalizeQuestion(raw, now);
    if (!q) return Object.freeze({ question: null, error: 'empty-content' });
    return Object.freeze({ question: q, error: null });
}

/**
 * 回答一个问题：**只有悬着的那一方能答**。
 * 已经答过 ⇒ 拒收（`already-answered`）；不是轮到你 ⇒ 拒收（`not-your-turn`）。
 * 源直接改字段（谁都能覆盖谁的答复），本件把它变成一次有裁定的事务。
 */
export function answerQuestion(list, id, byWhom, text, now) {
    const arr = Array.isArray(list) ? list : [];
    const target = String(id || '');
    const body = String(text || '').trim();
    if (!body) return Object.freeze({ list: arr, error: 'empty-content' });
    const who = (String(byWhom || '') === 'char') ? 'char' : 'user';
    let found = false; let err = null;
    const next = arr.map((raw) => {
        const q = normalizeQuestion(raw, now);
        if (!q || q.id !== target) return raw;
        found = true;
        const st = questionState(q);
        if (st === QUESTION_STATES.answered) { err = 'already-answered'; return q; }
        if (st === QUESTION_STATES.awaiting_user && who !== 'user') { err = 'not-your-turn'; return q; }
        if (st === QUESTION_STATES.awaiting_char && who !== 'char') { err = 'not-your-turn'; return q; }
        return Object.freeze({ ...q, answerer: who, answerText: body.slice(0, LOVER_LIMITS.maxTextLen) });
    });
    if (!found) return Object.freeze({ list: arr, error: 'not-found' });
    if (err) return Object.freeze({ list: arr, error: err });
    return Object.freeze({ list: Object.freeze(next), error: null });
}

/** 删一条提问（源：filter by id）。找不到 ⇒ `not-found`（不静默成功）。 */
export function removeQuestion(list, id) {
    const arr = Array.isArray(list) ? list : [];
    const target = String(id || '');
    const next = arr.filter((raw) => {
        const q = normalizeQuestion(raw);
        return !q || q.id !== target;
    });
    return Object.freeze({
        list: Object.freeze(next),
        error: next.length === arr.length ? 'not-found' : null,
    });
}

/* ---------- 投影 / 归因 / 注入 ---------- */

/**
 * 投影（读数）。读不到就如实给 0 / 空，**不编数**。
 * `nextFootprint` 是「今天还没到点的那条里最靠前的一条」（给界面挂个「下一件事」提示）。
 */
export function projectLover(state, now, settings) {
    const s = (state && typeof state === 'object') ? state : {};
    const set = normalizeLoverSettings(settings);
    const t = Number(now);
    const nowMs = Number.isFinite(t) ? Math.round(t) : Date.now();
    const day0 = startOfLocalDay(nowMs);
    const foot = normalizeFootprints(s.todayFootprints, day0);
    const vis = visibleFootprints(foot.list, nowMs, set.revealByTime);
    const letters = normalizeLetters(s.letters);
    const rawQs = Array.isArray(s.questions) ? s.questions : [];
    const qs = rawQs.map((q) => normalizeQuestion(q, nowMs)).filter(Boolean);
    let awaitingChar = 0; let awaitingUser = 0; let answered = 0;
    for (const q of qs) {
        const st = questionState(q);
        if (st === QUESTION_STATES.awaiting_char) awaitingChar += 1;
        else if (st === QUESTION_STATES.awaiting_user) awaitingUser += 1;
        else answered += 1;
    }
    const diaryMap = (s.diary && typeof s.diary === 'object') ? s.diary : {};
    const dm = splitDateStr(localDateStr(nowMs)) || { y: 1970, m: 1 };
    const jar = moodJar(dm.y, dm.m, diaryMap);
    const grid = calendarGrid(dm.y, dm.m, diaryMap);
    let diaryDays = 0;
    for (const k of Object.keys(diaryMap)) if (hasDiary(normalizeDiaryEntry(diaryMap[k]))) diaryDays += 1;
    const days = daysTogether(s.startDate, nowMs);
    const hiddenList = foot.list.filter((x) => x.at > nowMs);
    const next = hiddenList.length ? hiddenList[0] : null;
    const lastLetter = letters.list.length ? letters.list[letters.list.length - 1] : null;
    const hasAny = !!(days !== null || foot.list.length > 0 || letters.list.length > 0
        || qs.length > 0 || diaryDays > 0);
    return Object.freeze({
        hasAny,
        startDate: days === null ? null : (localDateStr(parseDateInput(s.startDate))),
        daysTogether: days,
        todayDateStr: localDateStr(nowMs),
        todayFootprintCount: foot.list.length,
        todayShownCount: vis.visible.length,
        todayHiddenCount: vis.hidden,
        footprintsDropped: foot.dropped,
        footprintsOverCap: foot.overCap,
        nextFootprint: next ? Object.freeze({ time: next.time, description: next.description, inMs: next.at - nowMs }) : null,
        diaryDays,
        monthDiaryCount: grid.cells.filter((c) => c && c.hasDiary).length,
        moodJarCount: jar.count,
        questionCount: qs.length,
        awaitingChar,
        awaitingUser,
        answered,
        letterCount: letters.list.length,
        lettersDropped: letters.dropped,
        lastLetterAt: lastLetter ? lastLetter.timestamp : null,
    });
}

/**
 * 注入块：只给**事实**（在一起多少天、今天几条足迹、几条悬着的问答、几封情书）。
 * 空读数返回 `''`（不产生空块）—— 与 taobao/widget/block 同规格。
 * ★ 头行必须是 `'【系统·恋爱空间】\n'`（桃宝那一版漏了换行，本件照同形写死）。
 */
export function loverPromptBlock(proj, settings) {
    const p = (proj && typeof proj === 'object') ? proj : null;
    if (!p || !p.hasAny) return '';
    const set = normalizeLoverSettings(settings);
    if (!set.injectToPrompt) return '';
    const max = set.maxInjectLines;
    if (!max) return '';
    const rows = [];
    if (p.daysTogether !== null && p.daysTogether !== undefined) {
        rows.push('· 在一起第 ' + p.daysTogether + ' 天（起算 ' + String(p.startDate || '') + '）');
    }
    if (p.todayFootprintCount > 0) {
        rows.push('· 今天已登记 ' + p.todayFootprintCount + ' 条足迹，到点显形 ' + p.todayShownCount + ' 条'
            + (p.todayHiddenCount ? '（还有 ' + p.todayHiddenCount + ' 条没到点）' : ''));
    }
    if (p.awaitingChar > 0) rows.push('· 悬着 ' + p.awaitingChar + ' 个提问**等你回答**');
    if (p.awaitingUser > 0) rows.push('· 悬着 ' + p.awaitingUser + ' 个提问**等用户回答**');
    if (p.letterCount > 0) rows.push('· 情书共 ' + p.letterCount + ' 封');
    if (p.diaryDays > 0) rows.push('· 心情日记已记 ' + p.diaryDays + ' 天（本月 ' + p.moodJarCount + ' 个心情）');
    if (!rows.length) return '';
    return '【系统·恋爱空间】\n' + rows.slice(0, max).join('\n');
}

/**
 * 两个面的「这一面有什么」事实行（视图的归因卡用）——
 * 键取 `LOVER_FACES` 的值，与数据层同一份口径。
 */
export function faceSummary(proj, face) {
    const p = (proj && typeof proj === 'object') ? proj : {};
    if (face === 'diary') {
        return '日记 ' + (p.diaryDays || 0) + ' 天 · 本月心情 ' + (p.moodJarCount || 0) + ' 个';
    }
    if (p.daysTogether === null || p.daysTogether === undefined) return '还没记录第一天';
    return '在一起第 ' + p.daysTogether + ' 天 · 今天 ' + (p.todayFootprintCount || 0) + ' 条足迹';
}

/* ---------- 足迹库（按日期留存）与输入解析 ---------- */

/** `'YYYY-MM-DD'` 串本身合法吗（用真 Date 反查，防 `2026-02-30` 被顺延）。 */
export function isValidDateStr(s) {
    return splitDateStr(s) !== null;
}

/**
 * 尾巴收紧：足迹库是 `{ 'YYYY-MM-DD': [足迹...] }`。只留最近 `maxDays` 天，
 * 更早的**如实计数**（`expiredDays`）后丢弃 —— 源把它无限长地存在 chat 里，
 * 那是长会话下的无上界增长，本件必须给它一个顶。
 */
export function pruneFootprintStore(store, maxDays) {
    const src = (store && typeof store === 'object') ? store : {};
    const top = boundedInt(maxDays, LOVER_LIMITS.maxFootprintDays, 1, 400);
    const keys = Object.keys(src).filter(isValidDateStr).sort().reverse();
    const keep = keys.slice(0, top);
    const out = {};
    for (const k of keep) out[k] = src[k];
    return Object.freeze({
        store: Object.freeze(out),
        keptDays: keep.length,
        expiredDays: Math.max(0, keys.length - keep.length),
    });
}

/** 取某一天的足迹数组（没记过 ⇒ 空数组，不编）。 */
export function footprintsOf(store, dateStr) {
    const s = (store && typeof store === 'object') ? store : {};
    const k = String(dateStr || '');
    return Array.isArray(s[k]) ? s[k] : [];
}

/** 把某一天的足迹写回库（不改原对象；日期串非法 ⇒ 原样返回并给 reason）。 */
export function putFootprints(store, dateStr, list) {
    const s = (store && typeof store === 'object') ? store : {};
    const k = String(dateStr || '');
    if (!isValidDateStr(k)) return Object.freeze({ store: s, error: 'bad-date' });
    const next = { ...s };
    next[k] = Array.isArray(list) ? list.slice() : [];
    return Object.freeze({ store: Object.freeze(next), error: null });
}

/**
 * 尾巴收紧：心情日记库同族（`{ 'YYYY-MM-DD': 一条 }`）。源无限长地存，本件给顶。
 */
export function pruneDiaryStore(store, maxDays) {
    const src = (store && typeof store === 'object') ? store : {};
    const top = boundedInt(maxDays, LOVER_LIMITS.maxDiaryDays, 1, 3000);
    const keys = Object.keys(src).filter(isValidDateStr).sort().reverse();
    const keep = keys.slice(0, top);
    const out = {};
    for (const k of keep) out[k] = src[k];
    return Object.freeze({
        store: Object.freeze(out),
        keptDays: keep.length,
        expiredDays: Math.max(0, keys.length - keep.length),
    });
}

/**
 * 解析「一整天足迹」的输入：**一行一条**，`HH:mm 描述`（描述里可以含 emoji）。
 * 凭什么不指望模型直接给 json：源是让模型产 json 再由前端 `JSON.parse`，
 * 解析失败就整块丢——本件把「生成」这一半交给宿主，留下的是一行一行的纯文本，
 * 认得出来的留下、认不出来的**如实计数**（`skipped`）并回就读，不静默吞。
 */
export function parseFootprintLines(text) {
    const raw = String(text === null || text === undefined ? '' : text).split(/\r?\n/);
    const list = [];
    let skipped = 0;
    for (const line of raw) {
        const t = line.trim();
        if (!t) continue;
        const m = /^(\d{1,2}:\d{2})\s+(.+)$/.exec(t);
        if (!m) { skipped += 1; continue; }
        list.push(Object.freeze({ time: m[1], description: m[2].trim() }));
    }
    return Object.freeze({ list: Object.freeze(list), skipped });
}

/**
 * 解析「写一封信」的输入：可带一行抬头 `致：<收信人>`（可选），其余为正文。
 * 抬头认不出来就当正文的一部分 —— 不因为一个格式细节把用户写的东西吃掉。
 */
export function parseLetterInput(text) {
    const raw = String(text === null || text === undefined ? '' : text);
    const lines = raw.split(/\r?\n/);
    if (!lines.length) return Object.freeze({ body: '', to: null });
    const head = /^\s*致\s*[:：]\s*(.+)$/.exec(lines[0]);
    if (!head) return Object.freeze({ body: raw.trim(), to: null });
    return Object.freeze({ body: lines.slice(1).join('\n').trim(), to: head[1].trim() || null });
}

/**
 * 解析「记一天心情」的输入：三行 —— 你的心情 emoji / 你的日记 / Ta 的心情 emoji？
 * 太脆。本件只认一种**带标记**的形状（认得出才认，认不出全当写给你自己）：
 *   `我：🌤\n今天……` 与 `Ta：🌧\n他……` 两个块，块内首行是 emoji 时可空。
 * 认不出 ⇒ `{ parsed: null }`，由界面走「只记你这一半」的降级路。
 */
export function parseDiaryInput(text) {
    const raw = String(text === null || text === undefined ? '' : text).trim();
    if (!raw) return Object.freeze({ parsed: null });
    const out = { userEmoji: '', userDiary: '', charEmoji: '', charDiary: '' };
    let hit = false;
    const re = /(我|Ta|ta|TA)\s*[:：]\s*([^\n]*)((?:\n(?!\s*(?:我|Ta|ta|TA)\s*[:：])[^\n]*)*)/g;
    let m;
    while ((m = re.exec(raw)) !== null) {
        const who = m[1];
        const first = String(m[2] || '').trim();
        const rest = String(m[3] || '').replace(/^\n/, '').trim();
        const isTa = who !== '我';
        /* 首行长得像 emoji（不含汉字/字母数字）⇒ 当 emoji；否则并回正文。 */
        const looksEmoji = first && !/[\u4e00-\u9fffA-Za-z0-9]/.test(first) && first.length <= LOVER_LIMITS.maxEmojiLen;
        const emoji = looksEmoji ? first : '';
        const body = (looksEmoji ? rest : [first, rest].filter(Boolean).join('\n')).trim();
        if (isTa) { out.charEmoji = emoji; out.charDiary = body; } else { out.userEmoji = emoji; out.userDiary = body; }
        hit = true;
    }
    if (!hit) return Object.freeze({ parsed: null });
    return Object.freeze({ parsed: Object.freeze(out) });
}
