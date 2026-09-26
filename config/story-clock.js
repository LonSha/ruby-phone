/* ========================================================
 * story-clock.js — [v3.10.0] 跨 App 的**单一「当前剧情时刻」读数面**
 *
 * 【为什么需要这一面 / 修前实测后果】
 *   本仓有三套「时间」在各自说话，而没有任何一处回答同一个问题：
 *     · `world-bridge.js` 的 `readWorldClock(snapshot)` —— WorldAxis 侧的世界钟
 *       （`{date, label, precision, turn}`，由 `config/time-manager.js` 消费）；
 *     · lonsha 快照的 `clock` 面 —— 记忆插件侧的剧情日期（自由文本 `story_date`）；
 *     · `calendar` App 的约定/备忘 —— 手机侧记录的**当天**事项。
 *   三者之间的关系（"世界钟说 7 月 28 日、插件说 3 月 15 日、日历里排的是 6 月 1 日"）
 *   在修前**没有任何出口**：用户只能看到三个互相矛盾的日期，无法判断哪一个才是
 *   "现在"。`bridgeReport` 里有一个 `diffClocks` 判定，但它只报结论、不给出
 *   可用的单一读数面，且只有诊断页在调。
 *
 * 【本模块的职责（只归一、只陈述、不选边）】
 *   把三处读数收成一份**恒定键面**的 `storyClock()`：
 *     · 每个来源的**在场性**与**原值**（缺失就是缺失，绝不补默认值）；
 *     · 三者**是否一致**（`agree`）与其**依据**（`basis`：只有两个以上来源都给了日期才有结论）；
 *     · 谁是**当前**（`primary`）—— 规则是**确定性**的，且**规则本身可读**：
 *         优先 WorldAxis 世界钟（它带 `precision` 与 `turn`，是唯一可计算的），
 *         其次 lonsha 剧情日期，再次日历当天；来源全缺 ⇒ `primary === null`。
 *
 * 【口径纪律（本仓反复治理的形态，逐条对应）】
 *   ① **不猜**：来源缺失一律 `null` + 归因；**绝不**用「今天」或 `Date.now()` 顶替剧情日期
 *      （现实时间与剧情时间不是同一件事，混用正是本仓最贵的错读数之一）。
 *   ② **不一致必须说出来**：三源都给日期而互不相同时，`agree === false` 且 `conflict === true`，
 *      **不得**静默采用其中一个 —— 用户必须知道这件事（这是本模块存在的主要理由）。
 *   ③ **无法比较要说无法比较**：少于两个来源给出日期时 `agree === null`（不是 `true`）——
 *      「没能比」与「比过、一致」是两件事，处置相反。
 *   ④ **不抛、键面恒定**：畸形输入一律降级；读者不必再判 `undefined`。
 *   ⑤ **纯读**：不写任何存储、不注册任何监听、不碰宿主。
 *
 * 纯 ESM export，零 window 依赖（window 由调用方注入）。
 * ======================================================== */

import { readWorldClock, readWorldAxisSnapshot, readPushProbe, readPushField, faceFieldState } from './world-bridge.js';

/** 来源标识（顺序即优先级；`primary` 的选取规则由这份顺序定义） */
export const CLOCK_SOURCES = Object.freeze(['worldaxis', 'lonsha', 'calendar']);

/** 归因文案（缺项即 UI 显示原始值，不静默） */
export const CLOCK_REASONS = Object.freeze({
    ok: '就绪',
    'source-missing': '这一层没有时间读数（不是「读不到」，是「这一层没给」）',
    'bridge-absent': '这一层的桥未安装',
    'no-snapshot': '桥在，但还没产出过快照',
    'face-absent': '这版快照没有时间面（需插件较新版本）',
    'unusable': '有面但读不出（本机读不到，等上游修）'
});

function str(v, max) {
    const s = String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
    return max ? s.slice(0, max) : s;
}

/** 归一一个来源：`{ state, reason, date, label, precision, turn, extra }`，键面恒定 */
function sourceFace(state, reason, patch) {
    return Object.assign({
        state,
        reason: reason || state,
        date: null,
        label: '',
        precision: '',
        turn: null,
        extra: ''
    }, patch || {});
}

/**
 * 读 WorldAxis 侧的世界钟。
 * 这一层是唯一带 `precision` 与 `turn` 的（可计算），故在 `primary` 规则里排第一。
 */
export function worldAxisClock(win) {
    try {
        const r = readWorldAxisSnapshot({ win });
        if (!r || !r.ok || !r.snapshot) {
            const reason = (r && r.reason === 'not-mounted') ? 'bridge-absent' : 'no-snapshot';
            return sourceFace(reason, reason);
        }
        const wc = readWorldClock(r.snapshot);
        if (!wc) return sourceFace('face-absent', 'face-absent');
        const date = str(wc.iso || wc.date || wc.label);
        if (!date) return sourceFace('face-absent', 'face-absent');
        return sourceFace('ok', 'ok', {
            date,
            label: str(wc.label || wc.iso),
            precision: str(wc.precision),
            turn: Number.isFinite(Number(wc.turn)) ? Number(wc.turn) : null,
            extra: str(wc.source)
        });
    } catch (_e) { return sourceFace('unusable', 'unusable'); }
}

/**
 * 读 lonsha 侧的剧情日期（快照 `clock` 面 / `story_date`）。
 * 上游把 `story_date` 定为**自由文本**（见 v3.8.0 F-4 取证结论：上游时间轴只有楼层这一条），
 * 故本层**不做解析**：原样带出文本，`precision` 恒为 `''`（不假装它有精度）。
 */
export function lonshaClock(win) {
    try {
        const p = readPushProbe(win);
        if (!p || p.mounted !== true) return sourceFace('bridge-absent', 'bridge-absent');
        if (!p.hasSnapshot) return sourceFace('no-snapshot', 'no-snapshot');
        const field = readPushField(p.snapshot, 'clock');
        if (!field || field.present !== true) {
            const faceState = faceFieldState(p.snapshot, ['clock']);
            return sourceFace(faceState === 'absent' ? 'face-absent' : 'source-missing',
                faceState === 'absent' ? 'face-absent' : 'source-missing');
        }
        const v = field.value;
        const text = (v && typeof v === 'object')
            ? str(v.date || v.storyDate || v.label)
            : str(v);
        if (!text) return sourceFace('source-missing', 'source-missing');
        const turn = (v && typeof v === 'object' && Number.isFinite(Number(v.turn))) ? Number(v.turn) : null;
        return sourceFace('ok', 'ok', { date: text, label: text, precision: '', turn, extra: 'lonsha' });
    } catch (_e) { return sourceFace('unusable', 'unusable'); }
}

/**
 * 读日历侧的「当天」（由调用方注入一份**只读**取数函数；本模块不 import 任何 App）。
 * 契约：`source()` 返回 `{ date?:string, label?:string, source?:string } | null`，取不到即 null。
 * 刻意做成注入式：日历是会话级数据、取数路径随 App 变，本模块不承担它（同一口径只许一份实现）。
 */
export function calendarClock(source) {
    try {
        if (typeof source !== 'function') return sourceFace('source-missing', 'source-missing');
        const v = source();
        if (!v || typeof v !== 'object') return sourceFace('source-missing', 'source-missing');
        const date = str(v.date || v.label);
        if (!date) return sourceFace('source-missing', 'source-missing');
        return sourceFace('ok', 'ok', { date, label: str(v.label || v.date), precision: str(v.precision), turn: null, extra: str(v.source || 'calendar') });
    } catch (_e) { return sourceFace('unusable', 'unusable'); }
}

/** 日期归一：只用于**比较**（去空白、去掉常见分隔与「日」字），返回值不用于展示 */
function normDate(v) {
    return str(v).toLowerCase()
        .replace(/[年月]/g, '-').replace(/日/g, '')
        .replace(/\s/g, '').replace(/-0(?=\d)/g, '-')
        .replace(/^0(?=\d)/, '');
}

/**
 * 两处日期能否算「同一天」—— 逐字相等，或**粒度相容**。
 *
 * 【为什么需要「粒度相容」这一档（本仓的假阳性纪律）】
 *   三处读数天然粒度不同：世界钟带年（`2026-03-15`），日历当天往往只有月日（`3月15日`）。
 *   若只做逐字比较，「同一月的同一天 + 一边没写年」会被判成**冲突** —— 那是假警报，
 *   而假警报的代价在本仓是明确的：用户学会忽略这个面，真冲突也跟着被忽略。
 *   故相容规则**必须窄**：短串是长串的**尾段**、且尾段前恰好是分隔符（即整段对齐），
 *   才算相容。`3-15` 对 `2026-03-15` 相容；`6-1` 对 `2026-03-15` 不相容（真冲突）。
 *   `basis` 会如实带出这次比较是 `exact` 还是 `suffix-compatible`，读者不必猜。
 *
 * @returns {{ ok:boolean, basis:'exact'|'suffix-compatible'|'mismatch' }}
 */
function sameDate(a, b) {
    if (a === b) return { ok: true, basis: 'exact' };
    const [short, long] = a.length <= b.length ? [a, b] : [b, a];
    if (!short) return { ok: false, basis: 'mismatch' };
    if (long.endsWith(short) && long[long.length - short.length - 1] === '-') {
        return { ok: true, basis: 'suffix-compatible' };
    }
    return { ok: false, basis: 'mismatch' };
}

/**
 * 三源合一：本模块的**唯一出口**。
 *
 * @param {{win?:object, calendarSource?:Function}} [o]
 * @returns {{ sources:object, present:number, agree:boolean|null, conflict:boolean,
 *             primary:string|null, primaryDate:string|null, text:string, at:number }}
 *   · `agree === null` —— **没能比**（给出日期的来源少于两个）；
 *   · `agree === false` 且 `conflict === true` —— 比过、**不一致**（用户必须知道）；
 *   · `primary === null` —— 三源全缺（**不是**「今天是某天」）。
 */
export function storyClock(o = {}) {
    const win = o.win;
    const sources = {
        worldaxis: worldAxisClock(win),
        lonsha: lonshaClock(win),
        calendar: calendarClock(o.calendarSource)
    };
    const withDate = CLOCK_SOURCES.filter((k) => sources[k].state === 'ok' && sources[k].date);
    const present = withDate.length;
    let agree = null;
    let conflict = false;
    let basis = 'none';
    if (present >= 2) {
        const first = normDate(sources[withDate[0]].date);
        let weakest = 'exact';
        let all = true;
        for (const k of withDate) {
            const r = sameDate(first, normDate(sources[k].date));
            if (!r.ok) { all = false; break; }
            if (r.basis === 'suffix-compatible') weakest = 'suffix-compatible';
        }
        agree = all;
        conflict = agree === false;
        basis = all ? weakest : 'mismatch';
    }
    const primary = withDate.length ? withDate[0] : null;
    const text = (() => {
        if (!primary) return '三处时间读数全缺（不是「今天是某天」——本模块绝不用现实时间顶替剧情时间）';
        if (conflict) {
            const parts = withDate.map((k) => k + '=' + sources[k].date).join(' · ');
            return '剧情时刻**不一致**（多处都给日期但互不相同）：' + parts + '；以下以 ' + primary + ' 为准，但请先确认哪个是当前。';
        }
        if (agree === null) return '当前剧情时刻：' + sources[primary].date + '（只有 ' + present + ' 处给出日期，**无法交叉验证**）';
        const tail = basis === 'suffix-compatible'
            ? '（' + present + ' 处相容：有来源只给到月日，未逐字相等）'
            : '（' + present + ' 处逐字一致）';
        return '当前剧情时刻：' + sources[primary].date + tail;
    })();
    return { sources, present, agree, conflict, basis, primary, primaryDate: primary ? sources[primary].date : null, text, at: Date.now() };
}

/**
 * 一行总述（供视图/诊断）。
 * 与 `text` 的分工：`text` 给用户读，本函数给**紧凑列表**用（含各源在场性）。
 */
export function storyClockLine(sc) {
    const c = (sc && typeof sc === 'object') ? sc : storyClock({});
    const marks = CLOCK_SOURCES.map((k) => {
        const s = c.sources && c.sources[k] ? c.sources[k] : { state: 'source-missing' };
        return k + ':' + (s.state === 'ok' ? s.date : s.state);
    });
    const verdict = c.conflict ? '不一致' : (c.agree === true ? '一致' : '无法验证');
    return { present: c.present, verdict, detail: marks.join(' · ') };
}

export default {
    CLOCK_SOURCES,
    CLOCK_REASONS,
    worldAxisClock,
    lonshaClock,
    calendarClock,
    storyClock,
    storyClockLine
};