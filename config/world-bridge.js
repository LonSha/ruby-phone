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
 *
 * 【v2.36.0 桥可观测面】两个桥本来只在**各自被用到的那一刻**才被读一次（世界脉搏生成时、
 *   TimeManager 取时间时）——那一刻是「业务路径」，读不到就静默退回旧路，用户看不到任何痕迹。
 *   v2.35.0 留下的 `worldBridgeAvailability()` 与 `WorldpulseApp.bridgeStatus()` 也是**零消费**：
 *   前者只被后者调用，后者全库无人调用（grep 实测）。于是「桥是不是通着」这件事在手机上
 *   完全不可观测——用户能看到的只有「世界脉搏又是编的」这种结果，看不到原因。
 *   本节把可观测面收敛为 `bridgeReport()`：一份可被 UI/诊断直接渲染的报告，覆盖
 *     · 在场与闸门（mounted / enabled，未装与未开分开）
 *     · 我方读取归因（worldaxis 的 reason 五态；lonsha 的来源态由对方 sourceState 映射）
 *     · 对方的自述（lonsha v3.174 的 sourceState + lastError 不吞）
 *     · 两个钟的对账（可比才比；「本机没有公历钟」与「对方没记」与「读不出」三者分开）
 *   三条纪律不变：只读（只调对方的读取面）、不抛（任何畸形都降级）、不猜（不可用如实报）。
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
 * 对方**有没有**可外供的物——**必须按桥的形态判**，不能一律拿 `snapshot` 是不是对象去量。
 *
 * 【为什么单列这一层】两个桥是同规格接口，但不是同一种**发布方式**：
 *   · 推送型（lonsha）：`snapshot` 是**对象**（生成管线里 refresh 覆盖），没有就是 null；
 *   · 拉取型（WorldAxis）：`snapshot` 是**函数**（外部入口，调一次返回深拷贝），
 *     这个属性**永远存在** ⇒ 用「属性在不在」判必然恒真，等于把「有物/没物」写成常数。
 *     拉取型的「有没有物」只能问它**自己记账**：`stat().published`（已发布过）/ `stat().invalidated`（已作废待重建）。
 * 这正是本项目反复治理的形态：「读了一个恒真的判据，于是读数看着像真读数」。
 *
 * @returns {{ kind:'push'|'pull'|'unknown', has:boolean }}
 *   kind='unknown' 表示这版桥没有自述能力，has 一律 false（不硬猜「有」）。
 */
function readPublished(id, win) {
    try {
        const b = getBridge(id, win);
        if (!b) return { kind: 'unknown', has: false };
        let raw;
        try { raw = b.snapshot; } catch (_e) { raw = null; }
        if (raw && typeof raw === 'object') return { kind: 'push', has: true };
        if (typeof raw === 'function') {
            let st = null;
            try { st = (typeof b.stat === 'function') ? (b.stat() || null) : null; } catch (_e) { st = null; }
            // 拉取型：published=已产出过快照；invalidated=已作废（下一次读必然重建）。
            //   两项都不报 ⇒ 不硬报有/无，按「暂无」处理（少报胜过多报）。
            if (st && typeof st === 'object') {
                if (st.invalidated === true) return { kind: 'pull', has: false };
                if (st.published === true) return { kind: 'pull', has: true };
            }
            return { kind: 'pull', has: false };
        }
        return { kind: 'unknown', has: false };
    } catch (_e) { return { kind: 'unknown', has: false }; }
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
    try { hasSnapshot = readPublished(id, win).has; } catch (_e) { hasSnapshot = false; }
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

/**
 * [v2.36.0] lonsha 桥的**来源归因**（对方自述，不是我们猜的）。
 *
 * lonsha v3.174 把桥的来源做成显式状态机：sourceState ∈
 *   idle / ready / engine-absent / engine-empty / thrown，且 lastError 不吞。
 * 那台状态机就是为了让消费者可归因而做的——「对方还没就绪，稍后再读」与
 * 「对方坏了，该报出来」必须分开，否则读者只能一律当「没数据」。
 *
 * @returns {{mounted:boolean, sourceState:string|null, lastError:string|null, hasSnapshot:boolean, reason:string}}
 */
export function lonshaSource(id, win) {
    try {
        const b = getBridge(id || LONSHA_BRIDGE_ID, win);
        if (!b) return { mounted: false, sourceState: null, lastError: null, hasSnapshot: false, reason: 'not-mounted' };
        let sourceState = null, lastError = null, hasSnapshot = false;
        try { sourceState = (typeof b.sourceState === 'string') ? b.sourceState : null; } catch (_e) { sourceState = null; }
        try { lastError = b.lastError ? String(b.lastError) : null; } catch (_e) { lastError = null; }
        try { hasSnapshot = readPublished(id || LONSHA_BRIDGE_ID, win).has; } catch (_e) { hasSnapshot = false; }
        let reason;
        if (sourceState === 'thrown') reason = 'thrown';
        else if (sourceState === 'engine-absent') reason = 'engine-absent';
        else if (sourceState === 'engine-empty') reason = 'engine-empty';
        else if (hasSnapshot) reason = 'ready';
        else reason = 'no-snapshot';   // idle / 未知来源态 / 旧版无该字段：都还没有可读的快照
        return { mounted: true, sourceState, lastError, hasSnapshot, reason };
    } catch (_e) {
        return { mounted: false, sourceState: null, lastError: null, hasSnapshot: false, reason: 'probe-threw' };
    }
}
/**
 * [v2.36.0] 两个钟的对账（纯函数，不读任何全局，便于判据独立驱动）。
 *
 * 为什么要对账：本机的时间由正文/世界书/消息戳**猜**（config/time-manager.js），
 *   WorldAxis 的世界钟是**推演结果**（决策时间），LonSha 的 GameClock 由**正文**校准。
 *   三个「现在」各走各的，此前在手机侧完全不可观测。对账只报差异，不改任何一方。
 *
 * @param {string} worldIso   WorldAxis 世界钟的 iso（无公历形态即空串）
 * @param {string} lonshaDate LonSha GameClock 的 date（可能是古历串）
 * @returns {{comparable:boolean, verdict:string, days:number|null, worldDate:string, lonshaDate:string}}
 *   verdict ∈ { same, world-ahead, world-behind, world-uncomparable, lonsha-empty, unparsable }
 *   · world-uncomparable —— 本机（WorldAxis 侧）**没有公历钟**（自由标签「第12日·黄昏」或
 *       桥没开）：本就不该比，绝不硬比出一个假的「不一致」。
 *   · lonsha-empty —— 对方**还没记录时间**（等它即可），与 unparsable（记了但读不出，
 *       两套历法）处置相反，不得同形。
 */
export function diffClocks(worldIso, lonshaDate) {
    const out = { comparable: false, verdict: 'unparsable', days: null, worldDate: String(worldIso || '').trim(), lonshaDate: String(lonshaDate || '').trim() };
    try {
        const wRaw = out.worldDate, sRaw = out.lonshaDate;
        if (!sRaw) { out.verdict = 'lonsha-empty'; return out; }
        if (!wRaw) { out.verdict = 'world-uncomparable'; return out; }
        const parse = (s) => {
            const m = /^(\d{1,4})\s*[-/年.]\s*(\d{1,2})\s*[-/月.]\s*(\d{1,2})/.exec(String(s || '').trim());
            if (!m) return null;
            const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
            if (!(y >= 1 && mo >= 1 && mo <= 12 && d >= 1 && d <= 31)) return null;
            return Date.UTC(y, mo - 1, d) / 86400000;
        };
        const a = parse(wRaw), b = parse(sRaw);
        if (a === null || b === null) { out.verdict = 'unparsable'; return out; }
        const days = b - a;   // 正 = 对方记的日期在后（本机（世界钟）走在前 → world-ahead）
        out.comparable = true; out.days = days;
        out.verdict = (days === 0) ? 'same' : (days > 0 ? 'world-ahead' : 'world-behind');
        return out;
    } catch (_e) { return out; }
}
/**
 * [v2.36.0] 两个桥的**可观测面报告**（纯读，供 UI / 诊断 / 测试直接渲染）。
 *
 * 这是本版的核心出口：把「桥通不通、通到哪一步、两个钟差多少」压成一份可读数据。
 * 三条纪律：只读（只调对方读取面）、不抛（任何畸形都降级为 reason）、不猜（如实报）。
 *
 * 【为什么还要单独报 `read`】`bridgeSource()` 的 reason 是**来源归因**（按对方自述的发布记账推出来），
 *   它刻意**不拉快照**；而 `read` 是**这一次真去拉**的结果。两者必须分开报，因为会不一致：
 *   对方自述「已发布」，但这一次拉回来的是 null（旧桥/竞态/快照被作废）——此时报告里
 *   「来源就绪 + 读取失败」并列存在，用户才能知道是「桥说它行、实际不行」。
 *   这正是本项目反复治理的形态：**可观测面自己不得自相矛盾**。
 *
 * @returns {{ worldaxis:{...}, lonsha:{...}, clock:{...}, summary:string, anyReadable:boolean }}
 */
export function bridgeReport(win) {
    try { return bridgeReportInner(win); }
    catch (_e) {
        return {
            worldaxis: { id: WORLDAXIS_BRIDGE_ID, mounted: false, enabled: null, hasSnapshot: false, reason: 'report-threw', stat: null, read: null },
            lonsha: { id: LONSHA_BRIDGE_ID, mounted: false, sourceState: null, lastError: null, hasSnapshot: false, reason: 'report-threw', read: null },
            clock: { comparable: false, verdict: 'unparsable', days: null, worldDate: '', lonshaDate: '' },
            consistent: false,
            summary: '桥可观测面读取失败（已降级，不外抛）',
            anyReadable: false
        };
    }
}
function bridgeReportInner(win) {
    // ── WorldAxis 侧：我方读取（含闸门与记账自述）──
    const waSrc = bridgeSource(WORLDAXIS_BRIDGE_ID, win);
    const waStat = waSrc.stat && typeof waSrc.stat === 'object' ? {
        publishes: Number(waSrc.stat.publishes) || 0,
        externalReads: Number(waSrc.stat.externalReads) || 0,
        refused: Number(waSrc.stat.refused) || 0,
        failures: Number(waSrc.stat.failures) || 0,
        lastRefusal: (waSrc.stat.lastRefusal && waSrc.stat.lastRefusal.reason) || null,
        lastFailure: (waSrc.stat.lastFailure && waSrc.stat.lastFailure.reason) || null,
        subscribed: waSrc.stat.subscribed === true,
        published: waSrc.stat.published === true,
        invalidated: waSrc.stat.invalidated === true
    } : null;
    // ── lonsha 侧：对方的来源自述 ──
    const loSrc = lonshaSource(LONSHA_BRIDGE_ID, win);
    // ── 两个钟的对账（只在这两边都真读到时才有意义）──
    let worldIso = '';
    let lonshaDate = '';
    // 实际读取的结果也要报：来源态说「就绪」不等于「这一次真读到了」（见下方注释）
    let waRead = null;
    let loRead = null;
    try {
        const rwa = readWorldAxisSnapshot({ win, reason: 'bridge-report' });
        if (rwa) waRead = { ok: rwa.ok === true, reason: String(rwa.reason || '') };
        if (rwa && rwa.ok) {
            const wc = readWorldClock(rwa.snapshot);
            if (wc && wc.iso) worldIso = wc.iso;
        }
    } catch (_e) { /* 降级：worldIso 保持空串（对账会报 world-uncomparable） */ }
    try {
        const rlo = readLonshaSnapshot({ win });
        if (rlo) loRead = { ok: rlo.ok === true, reason: String(rlo.reason || '') };
        if (rlo && rlo.ok && rlo.snapshot && rlo.snapshot.clock && typeof rlo.snapshot.clock === 'object') {
            lonshaDate = String(rlo.snapshot.clock.date || '').trim();
        }
    } catch (_e) { /* 降级：lonshaDate 保持空串（对账会报 lonsha-empty） */ }
    const clock = diffClocks(worldIso, lonshaDate);
    const anyReadable = !!(waSrc.mounted || loSrc.mounted);
    return {
        worldaxis: {
            id: WORLDAXIS_BRIDGE_ID, mounted: waSrc.mounted, enabled: waSrc.enabled,
            hasSnapshot: waSrc.hasSnapshot, reason: waSrc.reason, stat: waStat, read: waRead
        },
        lonsha: {
            id: LONSHA_BRIDGE_ID, mounted: loSrc.mounted, sourceState: loSrc.sourceState,
            lastError: loSrc.lastError, hasSnapshot: loSrc.hasSnapshot, reason: loSrc.reason, read: loRead
        },
        clock,
        // 自洽性：来源态说 ready 就必须真读得到（否则可观测面自己打自己脸）。
        //   真出现不一致（对方自述已发布、实际拉回 null）时如实置 false，不掩盖。
        consistent: ((waSrc.reason === 'ready') === !!(waRead && waRead.ok === true))
            && ((loSrc.reason === 'ready') === !!(loRead && loRead.ok === true)),
        summary: describeReport(waSrc, loSrc, clock, waRead, loRead),
        anyReadable
    };
}
/** 一句话总述（供 UI 直接显示；纯字符串拼接，无副作用） */
function describeReport(waSrc, loSrc, clock, waRead, loRead) {
    const WA_TXT = {
        'not-mounted': 'WorldAxis 未安装', 'disabled': 'WorldAxis 世界桥休眠（未开闸）',
        'refused': 'WorldAxis 世界桥拒绝读取', 'no-snapshot': 'WorldAxis 桥在但尚无快照',
        'ready': 'WorldAxis 桥就绪', 'probe-threw': 'WorldAxis 桥探针异常'
    };
    const LO_TXT = {
        'not-mounted': 'LonSha 记忆插件未安装', 'ready': 'LonSha 桥就绪',
        'engine-absent': 'LonSha 插件在但记忆引擎未就位', 'engine-empty': 'LonSha 引擎在位但返回空',
        'thrown': 'LonSha 桥取快照抛错', 'no-snapshot': 'LonSha 桥在但尚未产出快照',
        'probe-threw': 'LonSha 桥探针异常'
    };
    const CK_TXT = {
        'same': '两个钟同日', 'world-ahead': '世界钟在前 ' + Math.abs(Number(clock.days) || 0) + ' 天',
        'world-behind': '世界钟在后 ' + Math.abs(Number(clock.days) || 0) + ' 天',
        'world-uncomparable': '本机无公历钟（本就不比）', 'lonsha-empty': 'LonSha 尚未记录时间',
        'unparsable': '日期串读不出'
    };
    // 「说就绪、实际拉不到」必须出现在这一句话里——否则用户看到的第一行就是好消息。
    const waNote = (waSrc.reason === 'ready' && !(waRead && waRead.ok)) ? '（实际拉取失败：' + ((waRead && waRead.reason) || 'unknown') + '）' : '';
    const loNote = (loSrc.reason === 'ready' && !(loRead && loRead.ok)) ? '（实际拉取失败：' + ((loRead && loRead.reason) || 'unknown') + '）' : '';
    return (WA_TXT[waSrc.reason] || waSrc.reason) + waNote + ' ｜ ' + (LO_TXT[loSrc.reason] || loSrc.reason) + loNote
        + ' ｜ 对账：' + (CK_TXT[clock.verdict] || clock.verdict);
}
export default {
    WORLDAXIS_BRIDGE_ID,
    LONSHA_BRIDGE_ID,
    getBridge,
    bridgeSource,
    readWorldAxisSnapshot,
    readWorldClock,
    readLonshaSnapshot,
    worldBridgeAvailability,
    lonshaSource,
    diffClocks,
    bridgeReport
};
