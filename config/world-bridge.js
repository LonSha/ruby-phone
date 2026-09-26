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
        return { ok: false, reason: 'no-snapshot', source: src, snapshot: null, face: null };
    }
    // [v3.5.0] 三态补全：原来「快照不在场」这条出口**没有 face 键**，读者拿到的对象键面随路径变，
    //   只能靠 `('face' in r)` 猜 —— 上一条出口已补 `face: null`，此处补真值（口径：faceFieldState(snapshot)）。
    return { ok: true, reason: 'ok', source: src, snapshot: snap, face: faceFieldState(snap) };
}

/* ── [v3.5.0] F-2 下游侧：事件来源构成（上游 lonsha v3.233.0 的 eventPlatforms）
 *
 * 上游把「这条事件是谁记的」从 40 字自由文本折成受控分级
 * （extract / platform / other / none）并外供 `snapshot.eventPlatforms`。
 *
 * 下游要答的是**另一个问题**（不是重复上游读数）：
 *   · 上游答：「每个段来自哪一级、每个平台占了几段」。
 *   · 下游答：「这台设备上，`extract` 之外的平台标签（`phone:*` / `world:*` / `chat:*`）
 *     有没有被真用过」——那是**登记方有没有真给标签**的事实面，
 *     直接决定「跨平台对照」这件事现在能不能做。
 *
 * 【五态纪律】（本仓反复治理的形态：缺席与空读数必须可分，且三者处置相反）
 *   · 桥未装 / 无快照              ⇒ bridge-absent（等装桥 / 等生成跑一轮）
 *   · 有快照、旧版没有这一面         ⇒ face-absent（等上游升级）
 *   · 有面、但上游模块未就位/读面抛错 ⇒ unusable（本机读不出，等上游修）
 *   · 有面、账里没有任何事件段        ⇒ empty（**真读数**：还没有事件线，等剧情推进）
 *   · 有构成                      ⇒ ok
 *
 * ★ 下列形态是**真跑取证**得来的（v3.233.0 的 `platformFace(null)` 与 `_eventPlatformsFace()`）：
 *   空账返回 **`ok:true` + `reason:'no-events'`**；两条兜底分支返回的是
 *   **`ok:false` + `reason:'module-unavailable' | 'thrown'`**。
 *   一律按 `ok !== true` 归一（初稿就是这么写的）会把「上游模块没挂上」谎报成
 *   「还没有事件线」——两种处境处置相反，压成一态就是错读数。
 *
 * 两条硬约束：
 *   ① **不做判断**（与上游同一纪律）：只说「有几个平台被标过」「共几段」，
 *      不说「哪个平台更重要」。
 *   ② **不猜标签**：`platforms` 原样透传（上游已保证受控词表），不合并、不改写、不补全；
 *      **顺序也照上游**（受控词表顺序），不按段数重排 —— 重排本身就是一种重要性表达。
 */
const EVENT_PLATFORM_STATES = Object.freeze({
    BRIDGE_ABSENT: 'bridge-absent',
    FACE_ABSENT: 'face-absent',
    UNUSABLE: 'unusable',
    EMPTY: 'empty',
    OK: 'ok'
});

/** 缺席形态的恒定键面（读者不必再判 undefined；`state`/`reason` 之外的键都有确定零值） */
function emptyEventPlatformFace(state, reason) {
    return {
        state, reason, platforms: [], platformCount: 0, topPlatform: '', topSegments: 0,
        segments: 0, countedEvents: 0, unlabeled: 0, truncated: false, pluginVersion: ''
    };
}

/**
 * 读上游事件来源构成（单一真源：config/world-bridge.js）。
 * @param {object} [win] 显式注入 window（无头测试用），不传即取全局
 * @returns {{ state:string, reason:string, platforms:string[], platformCount:number,
 *             topPlatform:string, topSegments:number, segments:number, countedEvents:number,
 *             unlabeled:number, truncated:boolean, pluginVersion:string }}
 *   state ∈ { bridge-absent, face-absent, unusable, empty, ok }
 *   topPlatform —— 上游词表顺序里的首个平台（**不是**「最大 / 最重要」；本面不排序不打分）
 *   任何形态下本函数都**不抛**，且键面恒定（读者不必再判 undefined）。
 */
export function readLonshaEventPlatforms(win) {
    try {
        const r = readLonshaSnapshot({ win });
        if (!r || !r.ok || !r.snapshot) {
            return emptyEventPlatformFace(EVENT_PLATFORM_STATES.BRIDGE_ABSENT, String((r && r.reason) || 'not-mounted'));
        }
        const snap = r.snapshot;
        const pluginVersion = String(snap.pluginVersion || '');
        const face = snap.eventPlatforms;
        // 旧版快照没有这一面 ⇒ 如实说「这版没这面」，不是「零个平台」。
        if (!face || typeof face !== 'object' || Array.isArray(face)) {
            return Object.assign(emptyEventPlatformFace(EVENT_PLATFORM_STATES.FACE_ABSENT, 'face-absent'), { pluginVersion });
        }
        // 上游两条兜底（模块未就位 / 读面抛错）⇒ 本机读不出，与「还没有事件线」相反。
        if (face.ok !== true) {
            return Object.assign(
                emptyEventPlatformFace(EVENT_PLATFORM_STATES.UNUSABLE, String(face.reason || 'module-unavailable')),
                { pluginVersion }
            );
        }
        const plats = (Array.isArray(face.platforms) ? face.platforms : [])
            .map((p) => ({
                platform: String((p && p.platform) || ''),
                segments: Number(p && p.segments) || 0,
                events: Number(p && p.events) || 0
            }))
            .filter((p) => p.platform && p.segments > 0);   // ★ 顺序照上游（不重排）
        const segs = Number(face.segments) || 0;
        const reason = String(face.reason || '');
        const countedEvents = Number(face.countedEvents) || 0;
        const unlabeled = Number(face.unlabeled) || 0;
        // 空账：只认上游自己给的 `reason === 'no-events'`，不拿段数去猜（不替上游下结论）。
        if (reason === 'no-events' || segs === 0) {
            return Object.assign(
                emptyEventPlatformFace(EVENT_PLATFORM_STATES.EMPTY, reason || 'no-events'),
                { pluginVersion, countedEvents, unlabeled }
            );
        }
        const first = plats[0] || null;
        return {
            state: EVENT_PLATFORM_STATES.OK,
            reason: 'ok',
            platforms: plats.map((p) => p.platform),
            platformCount: plats.length,
            topPlatform: first ? first.platform : '',
            topSegments: first ? first.segments : 0,
            segments: segs,
            countedEvents,
            unlabeled,
            truncated: face.truncated === true,
            pluginVersion
        };
    } catch (_e) {
        return emptyEventPlatformFace(EVENT_PLATFORM_STATES.UNUSABLE, 'thrown');
    }
}

/**
 * 一行可读的读数（**不拼结论文案**，只做单位与分隔：判断归读者）。
 * 例：`事件来源：2 个平台（phone · chat）/ 共 5 段`；五态各有自己的句子。
 * ★ 有面但无任何平台标签时说「无平台标签」，**不写「0 个平台」** —— 那句话读者会当成「确实没有」，
 *   而它与「读不到」在字面上长得太像（本仓三态纪律的直接后果）。
 */
export function eventPlatformsLine(win) {
    try {
        const r = readLonshaEventPlatforms(win);
        if (r.state === EVENT_PLATFORM_STATES.BRIDGE_ABSENT) return '事件来源：尚未读到（记忆插件未接上，或还没生成过快照）';
        if (r.state === EVENT_PLATFORM_STATES.FACE_ABSENT) return '事件来源：本版没有这一面（需记忆插件 v3.233 或更新）';
        if (r.state === EVENT_PLATFORM_STATES.UNUSABLE) return '事件来源：本版读不出这一面（上游模块未就位，需升级记忆插件）';
        if (r.state === EVENT_PLATFORM_STATES.EMPTY) return '事件来源：还没有事件线';
        const who = r.platforms.length ? (r.platforms.join(' · ') + '') : '无平台标签';
        return '事件来源：' + (r.platforms.length ? r.platformCount + ' 个平台（' + who + '）' : who)
            + ' / 共 ' + r.segments + ' 段';
    } catch (_e) {
        return '事件来源：尚未读取（读取异常，已降级）';
    }
}

/* ── [v3.6.0] R1-E 下游侧：九账证据面（上游 evidence-workbench 的对账面） ──
 *
 * 上游 lonsha v3.214.0 把九本账（伏笔 / 约定 / 平行事实 / 秘密 / 前文回扣 /
 * 回声 / 事实版本 / 事件完整性 / 修复闭环）收成**一份可查对账面**并写进快照
 * `evidence` 字段（`index.js` 的 `_evidenceWorkbench()`）。上游把它定位成
 * 「这个承诺是哪一楼说的」的唯一答案面；而实测下游**零消费**（全仓无 `.evidence`
 * 读取）——「建好不消费」的又一例。
 *
 * 【下游要答的是另一个问题（不是重复上游读数）】
 *   · 上游答：「九本账各自多少条、哪本没接上」（面内对账）。
 *   · 下游答：「这台设备上现在能查到几条证据、还有几本账读不到、为什么」——
 *     直接决定用户点开「证据」时看到的是一份可查的表还是一个空壳。
 *
 * 【五态纪律】（与事件来源面同规格：缺席与空读数必须可分，且处置相反）
 *   · 桥未装 / 无快照        ⇒ bridge-absent（等装桥 / 等生成跑一轮）
 *   · 有快照、旧版没这一面    ⇒ face-absent（等上游升级）
 *   · 有面、九账一本也读不到  ⇒ unusable（归因 module-unavailable / thrown / mixed；
 *                                 「模块没挂」与「账里没条目」处置相反，压成一态就是错读数）
 *   · 有面、账在位但零条目    ⇒ empty（**真读数**：九本账都还没记东西，等剧情推进）
 *   · 有面、有条目            ⇒ ok
 *
 * ★ 上游兜底形态是**真跑取证**得来的（`_evidenceWorkbench()` 的两条 catch）：
 *   模块未挂 ⇒ `{version:0, ledgers:{}, summary:{total:0,...}, selfConsistent:false,
 *   reason:'module-unavailable'}`；抛错 ⇒ 同形但 `reason:'thrown'`。
 *   两者 `summary.total` 都是 0 —— 归因只能看顶层 `reason`（拿计数去猜必猜错）。
 *
 * 两条硬约束：
 *   ① **不调用上游模块**：本面只读快照数据（`snapshot.evidence`），不摸
 *      `window.LonShaEvidenceWorkbench`（第九道门 J1/J4 同纪律：下游不重造上游口径）。
 *      故上游的 `line()` / `search()` 一律不复用 —— 本文件另给纯串行文案与扁平条目表。
 *   ② **不猜楼层**：`floor` / `updatedFloor` 取不到即 `null`，**不写 0**（0 是「第 0 楼」
 *      这个真实读数；上游 `finiteFloor` 已立此契约，下游原样透传，不二次归一）。
 */
const EVIDENCE_STATES = Object.freeze({
    BRIDGE_ABSENT: 'bridge-absent',
    FACE_ABSENT: 'face-absent',
    UNUSABLE: 'unusable',
    EMPTY: 'empty',
    OK: 'ok'
});

/** 缺席形态的恒定键面（读者不必再判 undefined；`state`/`reason` 之外的键都有确定零值） */
function emptyEvidenceFace(state, reason) {
    return {
        state, reason,
        version: 0, at: 0,
        total: 0, okCount: 0, emptyCount: 0, absentCount: 0, itemCount: 0,
        selfConsistent: null,
        ledgers: [], items: [], absentReasons: []
    };
}

/**
 * 读上游九账证据面（单一真源：config/world-bridge.js）。
 * @param {object} [win] 显式注入 window（无头测试用），不传即取全局
 * @returns {{ state:string, reason:string, version:number, at:number,
 *             total:number, okCount:number, emptyCount:number, absentCount:number,
 *             itemCount:number, selfConsistent:boolean|null,
 *             ledgers:Array, items:Array, absentReasons:Array }}
 *   state ∈ { bridge-absent, face-absent, unusable, empty, ok }
 *   ledgers[i] —— `{id, label, state, reason, count, truncated, apiGlobal}`（逐账读数）
 *   items[i]   —— `{ref, ledger, ledgerLabel, title, detail, status, floor, updatedFloor, source, revision}`
 *   absentReasons[i] —— `{id, label, reason}`（缺席两因**如实带出**，不合并成一态）
 *   任何形态下本函数都**不抛**，且键面恒定（读者不必再判 undefined）。
 */
export function readLonshaEvidence(win) {
    try {
        const r = readLonshaSnapshot({ win });
        if (!r || !r.ok || !r.snapshot) {
            return emptyEvidenceFace(EVIDENCE_STATES.BRIDGE_ABSENT, String((r && r.reason) || 'not-mounted'));
        }
        return evidenceFaceOf(r.snapshot);
    } catch (_e) {
        return emptyEvidenceFace(EVIDENCE_STATES.UNUSABLE, 'thrown');
    }
}

/**
 * 由**已有快照**构建九账证据面（纯函数：只读传入对象，不摸桥、不取快照）。
 *
 * 为什么必须拆出来：诊断中心与全局搜索**各自已经握着快照**（诊断经 `readPushProbe`、
 * 搜索经 `bridgeSnapshot()`）。若它们为了这一面再调一次 `readLonshaEvidence(win)`，
 * 同一轮里就有两个取数点 —— 而上游快照是**推送型**（生成管线里 refresh 覆盖），
 * 两次取到的可能不是同一份（本仓「同一读数的两个来源必然漂移」的根因形态）。
 * 故：取数留在调用方，构建口径只此一份。
 *
 * @param {object|null} snapshot 上游快照本体
 * @returns 与 `readLonshaEvidence` 同形（state/reason/计数/ledgers/items/absentReasons）
 */
export function evidenceFaceOf(snapshot) {
    try {
        const face = (snapshot && typeof snapshot === 'object') ? snapshot.evidence : null;
        // 旧版快照没有这一面 ⇒ 如实说「这版没这面」，不是「九账全空」。
        if (!face || typeof face !== 'object' || Array.isArray(face)) {
            return emptyEvidenceFace(EVIDENCE_STATES.FACE_ABSENT, 'face-absent');
        }
        const why = String(face.reason || '');
        // 上游两条兜底（模块未就位 / 读面抛错）⇒ 本机读不出，与「账里没条目」相反。
        if (why === 'module-unavailable' || why === 'thrown') {
            const out = emptyEvidenceFace(EVIDENCE_STATES.UNUSABLE, why);
            out.version = Number(face.version) || 0;
            return out;
        }
        const summary = (face.summary && typeof face.summary === 'object') ? face.summary : {};
        const counts = (summary.counts && typeof summary.counts === 'object') ? summary.counts : {};
        const raw = (face.ledgers && typeof face.ledgers === 'object' && !Array.isArray(face.ledgers)) ? face.ledgers : {};
        const ledgers = [];
        const items = [];
        const absentReasons = [];
        for (const id of Object.keys(raw)) {
            const L = raw[id];
            if (!L || typeof L !== 'object') continue;
            const st = String(L.state || 'absent');
            const reason = String(L.reason || '');
            const label = String(L.label || id);
            ledgers.push({
                id, label, state: st,
                reason: (st === 'absent' ? (reason || 'absent') : ''),
                count: Number(L.count) || 0,
                truncated: L.truncated === true,
                apiGlobal: String(L.apiGlobal || '')
            });
            if (st === 'absent') { absentReasons.push({ id, label, reason: reason || 'absent' }); continue; }
            if (st !== 'ok') continue;
            const list = Array.isArray(L.items) ? L.items : [];
            for (const it of list) {
                if (!it || typeof it !== 'object') continue;
                items.push({
                    ref: String(it.ref || ''),
                    ledger: String(it.ledger || id),
                    ledgerLabel: String(it.ledgerLabel || label),
                    title: String(it.title || ''),
                    detail: String(it.detail || ''),
                    status: String(it.status || ''),
                    // ★ 不写 0：null 表示「楼层未知」，0 表示「第 0 楼」，两者相反（上游契约）。
                    floor: (it.floor === undefined ? null : it.floor),
                    updatedFloor: (it.updatedFloor === undefined ? null : it.updatedFloor),
                    source: String(it.source || ''),
                    revision: (it.revision === undefined ? null : it.revision)
                });
            }
        }
        const total = Number(summary.total) || ledgers.length;
        const itemCount = Number(summary.items) || items.length;
        const okCount = Number(counts.ok) || 0;
        const emptyCount = Number(counts.empty) || 0;
        const absentCount = Number(counts.absent) || 0;
        /* 三态分流（**不许压成一态**）：
         *   有条目                     ⇒ ok
         *   无条目、但有账被真读到      ⇒ empty（账在位、确实没有条目 —— 真读数）
         *   无条目、且无一本账被读到    ⇒ unusable（本机读不出，等上游/宿主） */
        let state = EVIDENCE_STATES.EMPTY;
        let reason = 'no-items';
        if (itemCount > 0) { state = EVIDENCE_STATES.OK; reason = 'ok'; }
        else if (okCount + emptyCount === 0 && absentCount > 0) {
            state = EVIDENCE_STATES.UNUSABLE;
            const kinds = {};
            for (const a of absentReasons) kinds[a.reason] = (kinds[a.reason] || 0) + 1;
            const ks = Object.keys(kinds);
            reason = (ks.length === 1) ? ks[0] : (ks.length ? 'mixed' : 'absent');
        }
        return {
            state, reason,
            version: Number(face.version) || 0,
            at: Number(face.at) || 0,
            total, okCount, emptyCount, absentCount, itemCount,
            // 自洽性**原样透传**（上游自报；取不到即 null，不替它下结论）
            selfConsistent: (typeof face.selfConsistent === 'boolean') ? face.selfConsistent : null,
            ledgers, items, absentReasons
        };
    } catch (_e) {
        return emptyEvidenceFace(EVIDENCE_STATES.UNUSABLE, 'thrown');
    }
}

/**
 * 一行可读的九账读数（**不拼结论文案**，只做单位与分隔：判断归读者）。
 * 五态各有自己的句子；「九本账一本也读不到」与「账在职但没有条目」**措辞必须不同**
 * —— 前者等上游修，后者等剧情推进。
 */
export function evidenceLine(win) {
    try {
        return evidenceFaceLine(readLonshaEvidence(win));
    } catch (_e) {
        return '证据：尚未读取（读取异常，已降级）';
    }
}

/**
 * 纯 face 版文案（**唯一实现**，`evidenceLine(win)` 也走这里）。
 * 为什么拆出来：诊断中心**已经**读到了 face 对象，若为了拿一行文案再调
 * `evidenceLine(win)`，就是**重取一次快照**（同一轮里两个取数点 —— 本仓反复
 * 收敛掉的形态：同口径被抄 N 份）。故文案只写一份，取数在调用方。
 */
export function evidenceFaceLine(face) {
    try {
        const r = face;
        if (!r || typeof r !== 'object') return '证据：尚未读取（无读数）';
        if (r.state === EVIDENCE_STATES.BRIDGE_ABSENT) return '证据：尚未读到（记忆插件未接上，或还没生成过快照）';
        if (r.state === EVIDENCE_STATES.FACE_ABSENT) return '证据：本版没有这一面（需记忆插件 v3.214 或更新）';
        if (r.state === EVIDENCE_STATES.UNUSABLE) {
            return '证据：九本账一本也读不到（归因 ' + String(r.reason || '') + '）—— 这不是「账里没有条目」';
        }
        if (r.state === EVIDENCE_STATES.EMPTY) return '证据：九本账都在位，但一条证据也没有（真读数，等剧情推进）';
        const parts = ['证据：九账 ' + (r.okCount || 0) + '/' + (r.total || 0) + ' 读到', '条目 ' + (r.itemCount || 0)];
        if (r.emptyCount) parts.push('空账 ' + r.emptyCount);
        if (r.absentCount) {
            const why = (Array.isArray(r.absentReasons) ? r.absentReasons : [])
                .map((a) => a.label + '（' + a.reason + '）').join('、');
            parts.push('缺席 ' + r.absentCount + (why ? '：' + why : ''));
        }
        return parts.join(' · ');
    } catch (_e) {
        return '证据：尚未读取（读取异常，已降级）';
    }
}

/**
 * [v3.6.0] R1-C 下游侧：投影的**导出期新鲜度归因**（上游 `meta.projectionFreshness`）。
 *
 * 【修前的真实错读数】
 *   上游 v3.213.0 给投影加了导出期新鲜度守卫：切聊（会话不符）或回滚（代数不符）时的
 *   旧缓存**不再导出**，`projection` 缺席，原因留在 `snap.meta.projectionFreshness`。
 *   而上游快照的 `meta.fieldTypes.projection.present` 此时同样为 **false**
 *   —— 因为字段确实没进快照。
 *   下游 `config/projection-contract.js` 的 `readProjection()` 见 `raw` 缺席就报
 *   `reason: 'no-projection-face'`（文案：「这版快照没有投影面（需记忆插件 v3.212+）」）。
 *   ⇒ **两种处置相反的处境被压成一态**：
 *     · 本版真没这面        ⇒ 等上游升级（用户什么都做不了）
 *     · 有面但被守卫扣下了  ⇒ **等宿主重跑一轮**（用户重发消息就好）
 *   本函数把后者的真因读出来，让读者能区分「扔掉了」与「本来就没这面」。
 *
 * 【为什么不复用 readPushField / faceFieldState】
 *   那两个读的是 `meta.fieldTypes`（字段在场三态），而新鲜度归因**不在 fieldTypes 里**
 *   ——它在 `meta.projectionFreshness`，且只有 `{dropped, reason, from, to}` 四键。
 *   拿 fieldTypes 去推这件事必然推错（present=false 两种原因同形）。
 *
 * 纪律：只读（不重取快照、不写上游）、不抛（任何畸形都降级）、不猜
 *   （`reason` 未知取值**如实输出原值**，不静默兜底成某个具体结论；
 *    `from`/`to` 取不到即 null，与「真的是空串」分开）。
 *
 * @param {object|null} snapshot 上游快照本体
 * @returns {{ present:boolean, dropped:boolean, reason:string, from:*, to:* }}
 *   present=false ⇒ 上游没给这份归因（旧版快照 / 本轮回放未扣下任何投影）
 *   dropped=true  ⇒ 确实有一份投影因归属不符被扣下（reason ∈ stale-conversation / stale-revision）
 */
export function readProjectionFreshness(snapshot) {
    const miss = { present: false, dropped: false, reason: '', from: null, to: null };
    try {
        if (!snapshot || typeof snapshot !== 'object') return miss;
        const meta = snapshot.meta;
        const d = (meta && typeof meta === 'object') ? meta.projectionFreshness : null;
        if (!d || typeof d !== 'object' || Array.isArray(d)) return miss;
        return {
            present: true,
            dropped: d.dropped === true,
            // 未知原因如实输出原值（不静默兜底 —— 静默兜底会把将来的新原因显示成旧结论）
            reason: String(d.reason == null ? '' : d.reason),
            from: (d.from === undefined ? null : d.from),
            to: (d.to === undefined ? null : d.to)
        };
    } catch (_e) { return miss; }
}

/**
 * 新鲜度归因的中文文案（未知原因**如实输出原值**）。
 * 「扔掉了」与「本来就没这面」必须读到两句不同的话（本面存在的唯一理由）。
 */
const FRESHNESS_TEXT = Object.freeze({
    'stale-conversation': '投影已被新鲜度守卫扣下：它属于**另一个会话**（切聊后旧缓存不得当作当前读数）',
    'stale-revision': '投影已被新鲜度守卫扣下：它属于**上一代**（回滚/恢复后旧代数不得当作当前读数）'
});

export function projectionFreshnessText(fresh) {
    const f = fresh || {};
    if (f.dropped !== true) return '';
    return FRESHNESS_TEXT[f.reason] || ('投影已被新鲜度守卫扣下（原因 ' + String(f.reason || '未知') + '）');
}

/**
 * [v2.97.0] 世界桥的**统一探针**：一次读出「桥在不在 / 有没有可读快照 / 快照本体」，形态判定只写这一份。
 *
 * 【为什么需要这个出口】（真实缺陷成因，不是设计洁癖）
 *   RubyPhone 侧实测有 **7 份同构的 probeBridge()**（place / wallet / profile / plotline /
 *   chars / clock / ledger）+ 两份自写读取（global-search-engine 与 dirtytalk）。
 *   它们抄的时候没人知道桥有**两种发布方式**：
 *     · lonsha 桥 = **推送型**：`snapshot` 是**对象**（生成管线里 refresh 覆盖）；
 *     · WorldAxis 桥 = **拉取型**：`snapshot` 是**函数**（外部入口，调一次返回深拷贝）。
 *   于是 clock / ledger 那两份写成了 `bridge.snapshot ? bridge.snapshot() : null`：
 *   把**对象**当函数调用 ⇒ 必然抛 TypeError ⇒ 被 `catch (_e) { snap = null; }` 吞掉
 *   ⇒ snap 恒为 null ⇒ 两个 App 永久显示「桥在但没快照」，哪怕桥里躺着完整快照。
 *   这正是本仓最贵的缺陷形态（不报错、不崩溃、只错结果）在桥读取侧的翻版。
 *
 * 三条纪律：只读（不写上游）、不抛（任何畸形都降级）、不猜（拿不到就如实说拿不到）。
 * 形态判定本身也不猜：对象就是对象（推型），函数才调（拉取型），两者都不是则当「没有可外供的物」。
 *
 * 【两个桥都探】lonsha（记忆插件）与 WorldAxis 是同规格**只读**世界桥，RubyPhone 侧一律经本探针读；
 *   一台装了两者的环境里，能读到任一台的快照都不算「没数据」。
 *   但**不许把两台混成一份读数**：返回值带 `id` 标明快照是谁家的（否则下游无法归因）。
 *
 * @param {object} [win] 显式注入 window（无头测试用），不传即取全局
 * @returns {{ id, mounted, hasSnapshot, snapshot, kind, reason, sourceState, lastError }}
 *   kind ∈ { push, pull, unknown }；reason ∈ { not-mounted, no-snapshot, ready }
 *   sourceState / lastError 为上游 v3.174 自述（旧版桥无此字段 ⇒ 如实 null，不伪造）
 */
const PROBE_ORDER = Object.freeze([LONSHA_BRIDGE_ID, WORLDAXIS_BRIDGE_ID]);

function probeOne(id, win) {
    const base = { id, mounted: false, hasSnapshot: false, snapshot: null, kind: 'unknown', reason: 'not-mounted', sourceState: null, lastError: null };
    try {
        const w = resolveWin(win);
        let b = null;
        try { b = w ? w[id] : null; } catch (_e) { b = null; }
        if (!b || typeof b !== 'object') return base;
        let sourceState = null;
        try { sourceState = (typeof b.sourceState === 'string') ? b.sourceState : null; } catch (_e) { sourceState = null; }
        let lastError = null;
        try { lastError = b.lastError ? String(b.lastError) : null; } catch (_e) { lastError = null; }
        // 形态判定（与 readPublished 同口径，但这里要把快照**本体**带回去）
        let raw = null;
        try { raw = b.snapshot; } catch (_e) { raw = null; }
        const kind = (raw && typeof raw === 'object') ? 'push' : (typeof raw === 'function' ? 'pull' : 'unknown');
        let snap = null;
        if (kind === 'push') snap = raw;
        else if (kind === 'pull') {
            // 拉取型：只在它自己说「已发布」时才真去拉（否则空拉一次只会把对方的记账刷脏）
            const pub = readPublished(id, win);
            if (pub.has) { try { snap = b.snapshot(); } catch (_e) { snap = null; } }
        }
        if (!snap && typeof b.refresh === 'function') { try { snap = b.refresh(); } catch (_e) { snap = null; } }
        const ok = !!(snap && typeof snap === 'object');
        return { id, mounted: true, hasSnapshot: ok, snapshot: ok ? snap : null, kind, reason: ok ? 'ready' : 'no-snapshot', sourceState, lastError };
    } catch (_e) { return base; }
}

/**
 * 统一探针：按 PROBE_ORDER 逐台探，取**第一台真读出快照**的桥；
 * 都不行时退回第一台的如实读数（谁在场报谁）。
 * 不抛（任何畸形都降级）、只读（不写上游）。
 * @param {object} [win]
 * @returns {{ id, mounted, hasSnapshot, snapshot, kind, reason, sourceState, lastError }}
 */
export function readPushProbe(win) {
    let first = null;
    for (const id of PROBE_ORDER) {
        const p = probeOne(id, win);
        if (p.hasSnapshot) return p;
        if (!first && p.mounted) first = p;
    }
    return first || probeOne(PROBE_ORDER[0], win);
}

/**
 * [v2.98.0] 读上游快照的一个**字段**，把「没有这项」与「有这项、值是空」分开。
 *
 * 【为何需要（真实缺口，不是设计洁癖）】
 *   上游 v3.174 专门为读者做了一份**字段类型三态自述** `snapshot.meta.fieldTypes`:
 *     present=false            ⇒ 源里没这项（读者应当作「没有」）
 *     present=true, kind='null' ⇒ 源里给了这项、值是空（读者应当作「空」）
 *     其余 kind               ⇒ 真有值
 *   而 RubyPhone 侧实测：**这份自述零消费**。各 App 的 `read*Face()` 一律写成
 *   `const x = (snap.k && typeof snap.k === 'object') ? snap.k : null;` ——
 *   于是上述两种完全不同的处境压成同一个 reason（`no-*-face`），
 *   而文案还告诉用户「需插件较新版本」——对后一种处境而言，
 *   这是一句**事实错误**的归因（插件已是最新，只是这一项为空）。
 *
 * 申明与实现同域不得互相矛盾：上游把这三态写进了自述，下游却不读，
 * 等于上游的“三态”做了也白做。本函数就是下游读这份自述的**唯一真源**。
 *
 * @param {object|null} snapshot 上游快照本体
 * @param {string} key 顶层字段名
 * @returns {{ present:boolean, kind:string|null, value:*, reason:string }}
 *   reason ∈ { value, declared-null, absent, legacy-null, legacy-value, no-snapshot }
 *   · declared-null —— 上游明确声明：给了这项，值是空
 *   · absent        —— 上游明确声明：源里根本没这项（真的“没这面”）
 *   · legacy-null   —— 旧版桥无 fieldTypes，且值是 null/undefined：
 *                     **两种处境本就无从分辨**，如实标出来，不硬猜。
 */
export function readPushField(snapshot, key) {
    const miss = { present: false, kind: null, value: undefined, reason: 'no-snapshot' };
    try {
        if (!snapshot || typeof snapshot !== 'object') return miss;
        if (typeof key !== 'string' || !key) return miss;
        const meta = snapshot.meta;
        const ft = (meta && typeof meta === 'object' && meta.fieldTypes && typeof meta.fieldTypes === 'object')
            ? meta.fieldTypes : null;
        const d = ft ? ft[key] : null;
        if (d && typeof d === 'object' && typeof d.present === 'boolean') {
            if (d.present === false) return { present: false, kind: String(d.kind || 'undefined'), value: undefined, reason: 'absent' };
            const kind = String(d.kind || '');
            if (kind === 'null') return { present: true, kind: 'null', value: null, reason: 'declared-null' };
            return { present: true, kind, value: snapshot[key], reason: 'value' };
        }
        // 旧版桥（无 meta.fieldTypes）：只能按值本体如实报，不伪造三态
        const v = snapshot[key];
        if (v === undefined || v === null) return { present: false, kind: (v === null ? 'null' : 'undefined'), value: v, reason: 'legacy-null' };
        return { present: true, kind: (Array.isArray(v) ? 'array' : typeof v), value: v, reason: 'legacy-value' };
    } catch (_e) { return miss; }
}

/**
 * [v2.98.0] 把多个字段的三态合成一个**面级**结论，供 `read*Face()` 直接用。
 *
 * 为何面级而不是字段级：一个“面”（档案面 = protagonist + lifeDetails）
 * 通常由多个字段组成，而读者关心的是「这一面是空还是根本没这面」。
 *
 * 裁定（严格，不模糊）：
 *   · 任一字段真有值              ⇒ present        （这面在，下游照常走）
 *   · 任一字段被声明 absent        ⇒ absent         （上游没给这面）
 *   · 全部字段被声明 declared-null ⇒ declared-empty （声明了、就是空）
 *   · 任一字段无从分辨（legacy-null） ⇒ legacy-unknown （旧版桥，不硬猜）
 *   优先级：present > absent > legacy-unknown > declared-empty
 *   （“有值”总是最强证据；“明说没这面”比“旧版读不出”更确定）
 *
 * @param {object|null} snapshot
 * @param {string[]} keys
 * @returns {string}
 */
export function faceFieldState(snapshot, keys) {
    try {
        const list = Array.isArray(keys) ? keys : [];
        if (!list.length) return 'legacy-unknown';
        const reads = list.map((k) => readPushField(snapshot, k));
        if (reads.some((r) => r.reason === 'value')) return 'present';
        if (reads.some((r) => r.reason === 'absent')) return 'absent';
        if (reads.some((r) => r.reason === 'legacy-null' || r.reason === 'no-snapshot')) return 'legacy-unknown';
        if (reads.every((r) => r.reason === 'declared-null')) return 'declared-empty';
        return 'legacy-unknown';
    } catch (_e) { return 'legacy-unknown'; }
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
    eventPlatformsLine,
    readLonshaEventPlatforms,
    EVENT_PLATFORM_STATES,
    readLonshaEvidence,
    evidenceLine,
    evidenceFaceLine,
    evidenceFaceOf,
    EVIDENCE_STATES,
    readProjectionFreshness,
    projectionFreshnessText,
    readPushProbe,
    readPushField,
    faceFieldState,
    worldBridgeAvailability,
    lonshaSource,
    diffClocks,
    bridgeReport
};
