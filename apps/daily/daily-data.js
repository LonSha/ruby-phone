/* ============================================================
 * daily-data.js — [v4.188.0] 跨 App 生活事件织机的纯函数内核
 * ------------------------------------------------------------
 * 重构自 cross-app-daily-life-fabric.js（100 行）：类持 lifeGraph、
 *   四条正则 `/吃|火锅|奶茶|.../` 按关键词猜事件、命中就编一段
 *   「自动在外卖收藏夹中生成附近高分餐厅推介清单」这种叙事、自己 Date.now + Math.random 造 id。
 * 本件：App 与事件类型都是封闭词表、规则可审计、注入只给事件计数读数。
 * 刻意不做：不取 now、不 Math.random、不猜、不写叙事。
 * ============================================================ */

/** 目标 App 封闭词表（只认本仓真有的 id）。 */
export const LIFE_APPS = Object.freeze({
    takeout: '外卖',
    calendar: '日历',
    traveldesk: '出行',
    album: '相册',
    comms: '会话台',
    money: '账目'
});

/** 事件类型封闭词表。 */
export const EVENT_TYPES = Object.freeze(['merchant_discovery', 'schedule_synced', 'commute_route_pinned', 'shared_album_sync']);

/** 规则表：每条规则的 keyword / app / type 都写死，可逐条审。
 *  为什么不用正则：本仓判据纪律一律 indexOf（生成链会吃反斜杠，见 r25_o3 / r27_o1）。 */
export const LIFE_RULES = Object.freeze([
    Object.freeze({ ruleId: 'food', app: 'takeout', type: 'merchant_discovery', keywords: Object.freeze(['吃', '火锅', '奶茶', '咖啡', '夜宵', '烤肉', '聚餐', '餐厅']) }),
    Object.freeze({ ruleId: 'schedule', app: 'calendar', type: 'schedule_synced', keywords: Object.freeze(['明天', '后天', '周一', '周二', '周三', '周四', '周五', '周六', '周日', '约', '见']) }),
    Object.freeze({ ruleId: 'travel', app: 'traveldesk', type: 'commute_route_pinned', keywords: Object.freeze(['车站', '机场', '堵车', '打车', '地铁', '导航', '出发']) }),
    Object.freeze({ ruleId: 'album', app: 'album', type: 'shared_album_sync', keywords: Object.freeze(['拍照', '相片', '截图', '留个纪念']) })
]);

export const DAILY_LIMITS = Object.freeze({ maxEvents: 100, maxNotes: 6 });
export const DAILY_FACE = Object.freeze({ EMPTY: 'empty', EVENTS: 'events' });
export const DAILY_REJECT = Object.freeze({
    unknownRule: 'unknown_rule',
    noMatch: 'no_match',
    emptyText: 'empty_text'
});

function inList(list, v) { return typeof v === 'string' && list.indexOf(v) >= 0; }

export function defaultDailyState() { return { events: [], notes: [] }; }

/** 归一：坏档不抛；半截数据（没 eventId / app 或 type 不认得）一律丢。 */
export function normalizeDailyState(raw) {
    const out = defaultDailyState();
    if (!raw || typeof raw !== 'object' || !Array.isArray(raw.events)) return out;
    for (const e of raw.events) {
        if (!e || typeof e !== 'object') continue;
        if (typeof e.eventId !== 'string' || !e.eventId) continue;
        if (!Object.prototype.hasOwnProperty.call(LIFE_APPS, e.app)) continue;
        if (!inList(EVENT_TYPES, e.type)) continue;
        out.events.push({
            eventId: e.eventId,
            app: e.app,
            type: e.type,
            ruleId: typeof e.ruleId === 'string' ? e.ruleId : '',
            hit: typeof e.hit === 'string' ? e.hit : '',
            snippet: typeof e.snippet === 'string' ? e.snippet.slice(0, 40) : '',
            at: Number.isFinite(e.at) ? e.at : 0
        });
    }
    if (Array.isArray(raw.notes)) for (const n of raw.notes) if (typeof n === 'string') out.notes.push(n);
    if (out.notes.length > DAILY_LIMITS.maxNotes) out.notes = out.notes.slice(0, DAILY_LIMITS.maxNotes);
    return out;
}

/** 面态。 */
export function readDailyFace(state) {
    const s = normalizeDailyState(state);
    return s.events.length ? DAILY_FACE.EVENTS : DAILY_FACE.EMPTY;
}

/** 拿一条规则。拿不出就拒，不猜。 */
export function ruleById(ruleId) {
    if (typeof ruleId !== 'string') return null;
    const r = LIFE_RULES.filter((x) => x.ruleId === ruleId)[0];
    return r || null;
}

/** 触发一条规则：正文里一个词都没中就拒；命中的词如实记账。 */
export function triggerRule(state, ruleId, text, at, eventId) {
    const s = normalizeDailyState(state);
    const rule = ruleById(ruleId);
    if (!rule) return { state: s, ok: false, reason: DAILY_REJECT.unknownRule, event: null };
    const body = typeof text === 'string' ? text : '';
    if (!body.trim()) return { state: s, ok: false, reason: DAILY_REJECT.emptyText, event: null };
    let hit = null;
    for (const k of rule.keywords) { if (body.indexOf(k) >= 0) { hit = k; break; } }
    if (!hit) return { state: s, ok: false, reason: DAILY_REJECT.noMatch, event: null };
    if (typeof eventId !== 'string' || !eventId) return { state: s, ok: false, reason: DAILY_REJECT.unknownRule, event: null };
    const ev = {
        eventId,
        app: rule.app,
        type: rule.type,
        ruleId: rule.ruleId,
        hit,
        snippet: body.slice(0, 40),
        at: Number.isFinite(at) ? at : 0
    };
    const events = s.events.concat([ev]).slice(-DAILY_LIMITS.maxEvents);
    return { state: { events, notes: s.notes }, ok: true, reason: null, event: ev };
}

/** 注入面：只给事件计数读数（哪条规则触发了几次、命中哪个词）。零叙事。 */
export function dailyPromptBlock(state) {
    const s = normalizeDailyState(state);
    const out = ['[跨App生活事件·事实读数]'];
    out.push('事件 ' + s.events.length + ' 条');
    const byRule = new Map();
    for (const e of s.events) {
        const cur = byRule.get(e.ruleId) || { n: 0, app: e.app };
        cur.n += 1;
        byRule.set(e.ruleId, cur);
    }
    for (const [rid, c] of byRule) out.push('- ' + rid + ' → ' + c.app + ' | ' + c.n + ' 次');
    const last = s.events.length ? s.events[s.events.length - 1] : null;
    out.push('最近一次：' + (last ? (last.ruleId + ' 命中「' + last.hit + '」') : '无'));
    return out;
}
