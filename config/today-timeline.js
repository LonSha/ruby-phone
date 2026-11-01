/* ========================================================
 * config/today-timeline.js — [v4.112.0 · R13-X1] 把散在各 App 里的事收成「今天」
 * --------------------------------------------------------
 * 【它要治的缺陷：五个 App，五条时间流】
 *   本仓每个 App 都有自己的时间流：消息按会话看、日程按日历看、日记按天看、照片按相册看。
 *   用户要回答「今天到底发生了什么」得开五个 App 自己对时刻。
 *   `apps/worldpulse` 有世界侧脉冲，`config/life-events.js` 有事件档案，
 *   但**没有任何一处是「我的今天」这个横向面**。
 *
 * 【本件只做聚合，不做取数】计划书原文。
 *   各源通过宿主给出的 `sources` 各报一串 `{ at, id, kind, title }`，本件只按 `at` 归并排序、
 *   做边界过滤、做同刻稳定次序、做截断记账。**不发请求、不写盘、不读时钟**。
 *   边界（哪个 `[start, end)` 算「今天」）由调用方算好传进来 —— 因为算边界要读剧情钟，
 *   而读钟是 App 的事（`config/time-source.js` 是唯一取数口）。
 *
 * 【一件拆成两件（不是拆着好看）】单条行长什么样 ⇒ `today-rows.js`；怎么排、怎么判态 ⇒ 本件。
 *   实测不分拆时本件 9708 字节，超了 X1 给的 8K 预算。这次拆分不损伤任何调用面：
 *   改「什么算一条可用的事件」不必碰排序，改排序也不必读行归一的判断链。
 *
 * 【三条不变量】
 *   ① **时刻必须真**：`at` 读不出来的条目当场丢弃并记账，不给 0 充数 ——
 *      0 会被排到 1970 年，那是替用户编了一个时刻（与 X8「宁可复述得笨，不许复述得假」同一条）；
 *   ② **源的状态必须分开报**：某个源没接入 ≠ 今天没事。压成一句就等于让用户去翻一个
 *      其实根本没接进来的 App；
 *   ③ **截断要记账**：超过上限就如实报被截掉多少条，不静默截。
 * ============================================================ */
'use strict';
import { numOrNull } from './num-gate.js';
import {
    TODAY_STATES, TODAY_SOURCE_STATES, TODAY_SOURCES, TODAY_SOURCE_LABEL,
    TODAY_LIMITS, TODAY_ORDER
} from './today-terms.js';
import { collectSource } from './today-rows.js';

/** 行归一的两个出口原样转发：调用面只有一处，视图/判据不必知道它搬过家。 */
export { collectSource, idOf, titleOf } from './today-rows.js';

/**
 * 主出口：把各源的原串收成一条时间轴。
 *
 * @param {{start:number, end:number, sources:Object}} input
 *   · `start` / `end` —— 今天的半开区间（由调用方按剧情日 0 点算好）；
 *   · `sources` —— `{ wechat: [...], calendar: [...], ... }`，**缺键即「没接入」**。
 * @returns {{state:string, events:Array, sourceRows:Array, truncated:number, dropped:number}}
 */
export function buildToday(input) {
    const o = input || {};
    const start = numOrNull(o.start);
    const end = numOrNull(o.end);
    const srcs = (o.sources && typeof o.sources === 'object') ? o.sources : {};
    const events = [];
    const sourceRows = [];
    let dropped = 0;
    if (start === null || end === null || start <= 0 || end <= start) {
        /* 边界定不下来：**不排时间轴**。此时仍要把每个源的状态报出去，
         *   否则界面会显示「今天什么都没有」—— 那是把「算不出来」说成「没事」。 */
        for (const s of TODAY_SOURCES) {
            const mounted = Object.prototype.hasOwnProperty.call(srcs, s) && Array.isArray(srcs[s]);
            sourceRows.push({
                source: s, label: TODAY_SOURCE_LABEL[s] || s,
                state: mounted ? TODAY_SOURCE_STATES.ok : TODAY_SOURCE_STATES.absent,
                count: mounted ? srcs[s].length : 0, dropped: 0, outOfRange: 0
            });
        }
        return {
            state: TODAY_STATES.noClock, events: [], sourceRows: sourceRows,
            truncated: 0, dropped: 0
        };
    }
    for (const s of TODAY_SOURCES) {
        const has = Object.prototype.hasOwnProperty.call(srcs, s);
        if (!has) {
            sourceRows.push({
                source: s, label: TODAY_SOURCE_LABEL[s] || s,
                state: TODAY_SOURCE_STATES.absent, count: 0, dropped: 0, outOfRange: 0
            });
            continue;
        }
        const got = collectSource(s, srcs[s], start, end);
        for (const r of got.rows) events.push(r);
        dropped += got.dropped;
        sourceRows.push({
            source: s, label: TODAY_SOURCE_LABEL[s] || s,
            /* 给了键但不是数组 ⇒ 这个源没接上来（mounted:false），不许冒充「今天没事」。 */
            state: got.mounted ? TODAY_SOURCE_STATES.ok : TODAY_SOURCE_STATES.absent,
            count: got.rows.length, dropped: got.dropped, outOfRange: got.outOfRange
        });
    }
    /* 排序：时间顺逆由口径表决定（不在本地写死方向 —— 否则那句声明就是假的）；
     * 同刻按**源序 → 源内序号**兜底，保证两次跑逐字相同（判据会逐字比）。 */
    const desc = TODAY_ORDER.byRecentFirst !== false;
    events.sort((a, b) => {
        if (a.at !== b.at) return desc ? (b.at - a.at) : (a.at - b.at);
        const ia = TODAY_SOURCES.indexOf(a.source);
        const ib = TODAY_SOURCES.indexOf(b.source);
        if (ia !== ib) return ia - ib;
        return a.seq - b.seq;
    });
    const limit = TODAY_LIMITS.maxEvents;
    const truncated = events.length > limit ? (events.length - limit) : 0;
    const kept = truncated ? events.slice(0, limit) : events;
    /* 五态判定：先看有没有源接上，再看有没有事件。
     *   `absent`（一个都没接）与 `empty`（都接了但真没有）**处置相反**，不许压平。 */
    const live = sourceRows.filter((r) => r.state === TODAY_SOURCE_STATES.ok).length;
    let state;
    if (!live) state = TODAY_STATES.absent;
    else if (kept.length > 0) state = TODAY_STATES.ok;
    else if (live < sourceRows.length) state = TODAY_STATES.partly;
    else state = TODAY_STATES.empty;
    return {
        state: state, events: kept, sourceRows: sourceRows,
        truncated: truncated, dropped: dropped
    };
}

/**
 * 一句话读数（界面标题行与判据共用，不许各写一份）。
 * 五态各有各的说法 —— 压平任意两态都会造出「处置相反的两件事长得一样」。
 */
export function todayLine(res) {
    const r = res || {};
    const n = Array.isArray(r.events) ? r.events.length : 0;
    const rows = Array.isArray(r.sourceRows) ? r.sourceRows : [];
    const live = rows.filter((x) => x.state === TODAY_SOURCE_STATES.ok).length;
    const absent = rows.filter((x) => x.state === TODAY_SOURCE_STATES.absent).length;
    if (r.state === TODAY_STATES.noClock) {
        return '剧情时刻读不到，今天这个边界定不下来 —— 这不等于今天没事';
    }
    if (r.state === TODAY_STATES.absent) {
        return '一个 App 都还没接入今天 —— 这不等于今天没事';
    }
    const tail = absent ? ('（还有 ' + absent + ' 个 App 没接入今天）') : '';
    const cut = (Number(r.truncated) > 0) ? ('，另有 ' + r.truncated + ' 条没排进来') : '';
    if (r.state === TODAY_STATES.ok) {
        return '今天 ' + n + ' 条' + cut + '，来自 ' + live + ' 个 App' + tail;
    }
    if (r.state === TODAY_STATES.partly) {
        return '今天还没有事，但只有 ' + live + ' 个 App 接上了' + tail + ' —— 还不能说今天没事';
    }
    return '今天什么都没有' + tail;
}