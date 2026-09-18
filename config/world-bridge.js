/* ========================================================
 * world-bridge.js — [v2.35.0] 对外世界桥消费面（只读）
 *
 * 【为什么需要这一面 / 修前实测后果】
 *   这套三插件体系里，上游有两个**同规格的只读世界桥**：
 *     · window.lonsha_memory_bridge_v1   —— 记忆插件的剧情记忆/召回账本快照
 *     · window.worldaxis_bridge_v1       —— WorldAxis 的世界状态快照（世界钟/暗流/权威事实/舆情）
 *   而 RubyPhone 侧实测：**只消费了前者**——
 *     apps/timeweaver/timeweaver-collector.js 读 lonsha_memory_bridge_v1.snapshot.recallAudit；
 *     全库 grep `WorldAxis` / `worldaxis` 在产品代码里**零命中**。
 *   后果是「同一个剧情里两个世界对不上」的真现场：
 *     · apps/worldpulse 自己队列化楼层变化、按阈值触发、调 LLM **现编**平行事件
 *       —— 与 WorldAxis 已经推演出的真·世界动态毫无关联，等于凭空发明一个平行世界；
 *     · config/time-manager.js 从正文/世界书**猜**当前时间，而 WorldAxis 的世界钟
 *       （决策时间，进存档、参与判定）就摆在那里没人读。
 *
 * 【本模块的职责】
 *   把两个桥的**读取**收敛成单一真源，供 worldpulse / TimeManager 消费：
 *     ① 只读：本模块只调 bridge.snapshot() / bridge.stat()，绝不写世界状态（两桥本就不给写路径）；
 *     ② 不抛：桥未装 / 未加载 / 旧版无字段 / 快照畸形，一律降级为 {ok:false, reason}，
 *        由调用方决定「退回原路径」还是「不出声」；
 *     ③ 不猜：把不可用**如实**报出来（reason 可归因），不静默编造数据顶替。
 *
 * 【为什么降级要带 reason（而不是直接返回 null）】
 *   本项目反复治理的缺陷形态就是「静默降级」：拿不到数据与「这个世界是空的」同形，
 *   调用方只能一律当「没数据」处理，于是「桥没装」「桥装了但没开」「快照畸形」
 *   三种完全不同的处境在 UI 上长得一模一样。这里把三态显式区分出来。
 *
 * 【与上游的规格对齐】
 *   WorldAxis v2.16.0 的桥默认**休眠**（settings.enabled === false ⇒ snapshot() 返回 null，
 *   由 stat().refused / lastRefusal 归因）。故本模块把「未启用」与「未安装」分开报，
 *   让调用方（以及用户）知道该去开哪个开关，而不是以为功能坏了。
 * ======================================================== */
'use strict';

/** 桥的全局挂载名（与上游 id 常量逐字一致，改一处即两边同时失联） */
export const WORLDAXIS_BRIDGE_ID = 'worldaxis_bridge_v1';
export const LONSHA_BRIDGE_ID = 'lonsha_memory_bridge_v1';

/** 读取用的 window（显式注入，便于无头测试；运行时不传即取全局） */
function resolveWin(win) {
    if (win) return win;
    try { return globalThis.window || globalThis; } catch (_e) { return globalThis; }
}

/** 安全取桥对象（不存在即 null，绝不因宿主怪异的 getter 抛出去） */
export function getBridge(id, win) {
    try {
        const w = resolveWin(win);
        const b = w && w[id];
        return (b && typeof b === 'object') ? b : null;
    } catch (_e) { return null; }
}

/**
 * 桥的**来源归因**读数（只读，不拉快照）。
 * @returns {{ mounted:boolean, enabled:boolean|null, hasSnapshot:boolean, stat:object|null, refused:boolean, refuses:number, reason:string|null }}
 *   mounted  —— 桥对象在不在全局上（不在 ⇒ 插件未安装/未加载）
 *   enabled  —— 桥自身开关（null 表示桥没有 settings() 口，无从判断）
 *   hasSnapshot —— 桥是否已经有可外供的快照
 *   refused/refuses —— 桥是否拒绝了读取（WorldAxis 默认休眠就是这条路径）
 *   reason   —— 一句话归因（未安装 / 未启用 / 已就绪 / 旧版无此能力）
 */
export function bridgeSource(id, win) {
    const b = getBridge(id, win);
    if (!b) {
        return { mounted: false, enabled: null, hasSnapshot: false, stat: null, refused: false, refuses: 0, reason: 'not-mounted' };
    }
    let enabled = null;
    try {
        if (typeof b.settings === 'function') {
            const s = b.settings();
            enabled = !(s && s.enabled === false);
        }
    } catch (_e) { enabled = null; }
    let stat = null;
    try { stat = (typeof b.stat === 'function') ? (b.stat() || null) : null; } catch (_e) { stat = null; }
    let hasSnapshot = false;
    try { hasSnapshot = !!(b.snapshot !== undefined && b.snapshot !== null); } catch (_e) { hasSnapshot = false; }
    const refused = !!(stat && stat.lastRefusal);
    const refuses = (stat && Number(stat.refused)) || 0;
    let reason = 'ready';
    if (enabled === false) reason = 'disabled';
    else if (refused) reason = 'refused';
    else if (!hasSnapshot) reason = 'no-snapshot';
    return { mounted: true, enabled, hasSnapshot, stat, refused, refuses, reason };
}

/**
 * 取 WorldAxis 的世界状态快照（只读、深拷贝由上游保证）。
 * @param {{reason?:string, win?:object, force?:boolean}} opts
 * @returns {{ ok:boolean, reason:string, source:object, snapshot:object|null }}
 *   永不抛；拿不到快照时 ok=false 且 reason ∈
 *   { not-mounted, disabled, refused, no-snapshot, pull-failed }
 */
export function readWorldAxisSnapshot(opts = {}) {
    const win = opts.win;
    const src = bridgeSource(WORLDAXIS_BRIDGE_ID, win);
    if (!src.mounted) return { ok: false, reason: 'not-mounted', source: src, snapshot: null };
    if (src.enabled === false) return { ok: false, reason: 'disabled', source: src, snapshot: null };
    const b = getBridge(WORLDAXIS_BRIDGE_ID, win);
    let snap = null;
    try {
        // 优先 snapshot()（带 debounce 的外供口）；旧版/精简版只有 refresh() 时退而求其次。
        if (typeof b.snapshot === 'function') snap = b.snapshot({ reason: opts.reason || 'rubyphone-pull' });
        else if (opts.force !== false && typeof b.refresh === 'function') snap = b.refresh({ reason: opts.reason || 'rubyphone-pull' });
    } catch (_e) { snap = null; }
    if (!snap || typeof snap !== 'object') {
        return { ok: false, reason: src.refused ? 'refused' : 'pull-failed', source: src, snapshot: null };
    }
    return { ok: true, reason: 'ok', source: src, snapshot: snap };
}

const ISO_RE = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ](\d{1,2}):(\d{2}))?/;

/**
 * 把 WorldAxis 快照里的 `worldClock` 解析成 TimeManager 可消费的时间对象。
 *
 * WorldAxis 的世界钟是**决策时间**（进存档、参与判定），比「从正文里猜」权威。
 * 只在能解析出合法日期时才返回；否则返回 null（调用方退回原路径，不猜）。
 *
 * @returns {{ date:string, time:string, weekday:string, isAncient:boolean, era:string,
 *             calendarDate:string, timestamp:number, label:string, source:string,
 *             iso:string, dayIndex:number, fromWorldClock:true }|null}
 */
export function readWorldClock(snapshot) {
    try {
        const wc = snapshot && snapshot.worldClock;
        if (!wc || typeof wc !== 'object') return null;
        const iso = String(wc.iso || '').trim();
        const m = ISO_RE.exec(iso);
        if (!m) return null;
        const year = Number(m[1]);
        const month = Number(m[2]);
        const day = Number(m[3]);
        if (!(year >= 1 && month >= 1 && month <= 12 && day >= 1 && day <= 31)) return null;
        const hour = m[4] === undefined ? 0 : Number(m[4]);
        const minute = m[5] === undefined ? 0 : Number(m[5]);
        const hh = String(Math.min(23, Math.max(0, hour))).padStart(2, '0');
        const mm = String(Math.min(59, Math.max(0, minute))).padStart(2, '0');
        const dt = new Date(year, month - 1, day, Number(hh), Number(mm));
        const weekdays = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
        return {
            date: `${year}年${String(month).padStart(2, '0')}月${String(day).padStart(2, '0')}日`,
            time: `${hh}:${mm}`,
            weekday: weekdays[dt.getDay()],
            // ISO 形态即公历；世界钟若走古历纪年，其 iso 会是空串或非 ISO 串 ⇒ 上面直接返回 null。
            isAncient: false,
            era: '',
            calendarDate: `${year}年${String(month).padStart(2, '0')}月${String(day).padStart(2, '0')}日`,
            timestamp: dt.getTime(),
            label: String(wc.label || ''),
            source: String(wc.source || 'worldaxis'),
            iso,
            dayIndex: Number(wc.dayIndex) || 0,
            fromWorldClock: true
        };
    } catch (_e) { return null; }
}

/**
 * 读 lonsha 记忆桥快照（与 timeweaver-collector 同源，此处供 worldpulse 复用）。
 * @returns {{ ok:boolean, reason:string, source:object, snapshot:object|null }}
 */
export function readLonshaSnapshot(opts = {}) {
    const win = opts.win;
    const src = bridgeSource(LONSHA_BRIDGE_ID, win);
    if (!src.mounted) return { ok: false, reason: 'not-mounted', source: src, snapshot: null };
    const b = getBridge(LONSHA_BRIDGE_ID, win);
    let snap = null;
    try {
        snap = (b.snapshot && typeof b.snapshot === 'object') ? b.snapshot : null;
        // lonsha 桥是**推**型快照（生成管线里 refresh 覆盖），旧版/未生成时为 null。
        if (!snap && typeof b.refresh === 'function') snap = b.refresh();
    } catch (_e) { snap = null; }
    if (!snap || typeof snap !== 'object') {
        return { ok: false, reason: 'no-snapshot', source: src, snapshot: null };
    }
    return { ok: true, reason: 'ok', source: src, snapshot: snap };
}

/** 两个桥的在场一览（供诊断面板/测试；纯读） */
export function worldBridgeAvailability(win) {
    const wa = bridgeSource(WORLDAXIS_BRIDGE_ID, win);
    const lo = bridgeSource(LONSHA_BRIDGE_ID, win);
    return {
        worldaxis: { id: WORLDAXIS_BRIDGE_ID, mounted: wa.mounted, enabled: wa.enabled, reason: wa.reason },
        lonsha: { id: LONSHA_BRIDGE_ID, mounted: lo.mounted, enabled: lo.enabled, reason: lo.reason }
    };
}

export default {
    WORLDAXIS_BRIDGE_ID,
    LONSHA_BRIDGE_ID,
    getBridge,
    bridgeSource,
    readWorldAxisSnapshot,
    readWorldClock,
    readLonshaSnapshot,
    worldBridgeAvailability
};
