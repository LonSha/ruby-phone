/* ========================================================
 * config/task-entry.js — [v3.65.0 · 拓展计划 X1 第一切片] 任务入口内核（纯函数）
 * --------------------------------------------------------
 * 【这一刀治的是什么（修前实测处境）】
 *   桌面是「81 个 App 的平铺网格」。用户要做一件事（找一段往事 / 整理素材 /
 *   今天有哪些事 / 管理余额）得先自己知道那件事归哪个 App —— 入口成本随 App 数
 *   线性上升，而 App 数是 81。
 *   更要紧的是：**即使点对了 App，也到不了要看的那个页签**。修前全仓 `phone:openApp`
 *   的 detail 恒为 `{ appId }`（实测 9 处派发点；settings-app.js 那处多带一个 icon
 *   字段，仍无页签）。于是「打开曲库」只能落在曲库的**首个页签**上，
 *   哪怕用户要的是歌词页 —— 这不是入口不够多，是**入口没有靶心**。
 *
 * 【本件的两块，边界写死】
 *   ① 任务卡表 `TE_CARDS`（声明面）：按用户任务聚合 App + 页签（`tab` 可为 null）。
 *   ② 判定与读数（判定面）：收藏归一 / 可用性筛选 / 最近使用 / 页签合法性。
 *
 * 【tab 是 null 与 tab 是某个词，是两件不同的事】
 *   本仓最贵的形态是「把没有的写成有」。故：
 *   · `tab: 'x'` 表示**声明**「这个入口会把用户送到 App 的 x 页签」—— 该声明由判据
 *     真读对应 App 源文件的 `setTab` 白名单逐条核（声明 ↔ 真码）；
 *   · `tab: null` 表示**只到 App**，一个字都不多声称。
 *   两者在读数里分列（`withTab` / `appOnly`），不合并成一个数。
 *
 * 【零 DOM / 零网络 / 零定时器 / 零 storage 直访】
 *   读写 storage 的口在本文件末尾（`readPins` / `writePins` / `readLedger` / …）
 *   的**唯一一组函数**里 —— 与 config/usage-tracker.js 同规：采集/持久化只有一处，
 *   判定与投影是纯函数（可对合成输入跑，不必起宿主）。
 * ======================================================== */
'use strict';
import { topApps, usageSummary, normalizeUsage } from './usage-tracker.js';
import { APP_LAZY_ROUTE_INDEX } from './app-lazy-routes.js';
import { writeReceipt } from './write-receipt.js';
import { buildOpenDetail } from './app-open-detail.js';
import { tabSourceSelfCheck, tabMapOf, TABS_BY_APP } from './tab-source.js';

/* 两条会话键：随会话隔离（键前缀 ^te_ 已在 config/storage.js 的会话族里，
 *   与「切聊遵守既有 scope」的验收同源 —— 不做第二套隔离机制）。 */
export const TE_PINS_KEY = 'te_pins';
export const TE_LEDGER_KEY = 'te_ledger';
export const TE_PINS_MAX = 12;
export const TE_RECENT_MAX = 6;
export const TE_LEDGER_MAX = 80;

/* 可用性四态：**分开报**（缺席 / 读不出 / 空 / 有）。压平即错读数。 */
export const TE_STATES = Object.freeze({
    OK: 'ok',
    EMPTY: 'empty',
    ABSENT: 'absent',
    UNREADABLE: 'unreadable'
});

/* 归因词表（`why` 只许取这里的值 —— 判据按此表逐词核，防「随口一个新词」）。 */
export const TE_REASONS = Object.freeze({
    NO_STORAGE: 'no-storage',
    NO_API: 'no-api',
    READ_THREW: 'read-threw',
    WRITE_THREW: 'write-threw',
    ABSENT: 'absent',
    APP_NOT_ROUTED: 'app-not-routed',
    TAB_UNSUPPORTED: 'tab-unsupported',
    TAB_UNKNOWN: 'tab-unknown',
    USAGE_UNREADABLE: 'usage-unreadable',
    TOO_MANY_PINS: 'too-many-pins',
    BAD_SHAPE: 'bad-shape'
});

/* ---------- 任务卡表（声明面） ----------
 * 每张卡：{ id, label, hint, targets: [{ appId, tab, note }] }
 *   · tab === null ⇒ 只到 App（不声称页签）
 *   · targets 至少一项；**不新造 App**，全部取本仓既有 appId
 */
export const TE_CARDS = Object.freeze([
    Object.freeze({
        id: 'past',
        label: '找一段往事',
        hint: '翻回某个时刻说过的话',
        targets: Object.freeze([
            Object.freeze({ appId: 'memory', tab: null, note: '记忆库总入口' }),
            Object.freeze({ appId: 'search', tab: null, note: '按词跨 App 检索' }),
            Object.freeze({ appId: 'sourcebook', tab: 'shelf', note: '时光胶囊书架的素材条目' }),
            Object.freeze({ appId: 'archive', tab: 'pack', note: '存档台已收下的包' })
        ])
    }),
    Object.freeze({
        id: 'materials',
        label: '整理素材',
        hint: '把散在各处的东西归拢',
        targets: Object.freeze([
            Object.freeze({ appId: 'musicdesk', tab: 'shelf', note: '曲库书架' }),
            Object.freeze({ appId: 'stickerdesk', tab: 'board', note: '表情包册总览' }),
            Object.freeze({ appId: 'pvdesk', tab: 'shelf', note: 'PV 素材书架' }),
            Object.freeze({ appId: 'doujin', tab: 'shelf', note: '同人商店藏品架' })
        ])
    }),
    Object.freeze({
        id: 'today',
        label: '今天有哪些事',
        hint: '约会 / 纪念日 / 番茄钟 / 打卡',
        targets: Object.freeze([
            Object.freeze({ appId: 'annidate', tab: null, note: '纪念日数学' }),
            Object.freeze({ appId: 'calendar', tab: null, note: '日历' }),
            Object.freeze({ appId: 'focus', tab: null, note: '番茄钟' }),
            Object.freeze({ appId: 'punchcard', tab: null, note: '打卡' })
        ])
    }),
    Object.freeze({
        id: 'money',
        label: '管理余额',
        hint: '钱在哪、欠谁、花去哪',
        targets: Object.freeze([
            Object.freeze({ appId: 'wallet', tab: null, note: '钱袋（上游金钱账）' }),
            Object.freeze({ appId: 'asset', tab: null, note: '资产总览' }),
            Object.freeze({ appId: 'accounting', tab: null, note: '记账' }),
            Object.freeze({ appId: 'piggy', tab: null, note: '存钱罐' }),
            Object.freeze({ appId: 'traveldesk', tab: null, note: '旅行分摊结算' })
        ])
    }),
    Object.freeze({
        id: 'people',
        label: '记事与人脉',
        hint: '把人和事串起来看',
        targets: Object.freeze([
            Object.freeze({ appId: 'kettle', tab: 'notes', note: '对话水壶笔记' }),
            Object.freeze({ appId: 'needsim', tab: 'needs', note: '需求沙盘' }),
            Object.freeze({ appId: 'socialguard', tab: null, note: '熟人可见性' })
        ])
    }),
    Object.freeze({
        id: 'create',
        label: '创作与发布',
        hint: '从素材到草稿',
        targets: Object.freeze([
            Object.freeze({ appId: 'magazine', tab: 'list', note: '杂志排版' }),
            Object.freeze({ appId: 'lofter', tab: 'home', note: '老福特' }),
            Object.freeze({ appId: 'pixiv', tab: 'illust', note: 'Pixiv 插画页' }),
            Object.freeze({ appId: 'bilibili', tab: null, note: 'B 站' })
        ])
    }),
    Object.freeze({
        id: 'clinic',
        label: '看诊与档案',
        hint: '读数、对账、排查',
        targets: Object.freeze([
            Object.freeze({ appId: 'diagnose', tab: null, note: '诊断中心' }),
            Object.freeze({ appId: 'diagdesk', tab: 'overview', note: '诊断案头总览' }),
            Object.freeze({ appId: 'recall', tab: 'channels', note: '召回治理台' }),
            Object.freeze({ appId: 'cotdesk', tab: 'items', note: '思维链案头条目' }),
            Object.freeze({ appId: 'uterus', tab: 'board', note: '子宫画板' })
        ])
    })
]);

export function isPlain(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
export function toStr(v) { return (typeof v === 'string') ? v : ''; }
export function listOf(v) { return Array.isArray(v) ? v : []; }
function hasOwn(o, k) { return isPlain(o) ? Object.prototype.hasOwnProperty.call(o, k) : false; }

/** 路由在场判定：该 appId 是否有懒加载路由（14 个内联分支按既有事实登记为在场）。 */
export const TE_INLINE_ROUTED = Object.freeze([
    'settings', 'wechat', 'diary', 'phone', 'music', 'weibo', 'honey', 'mofo',
    'wangxiang', 'games', 'album', 'calendar', 'lexiscore', 'graph'
]);
export function isRouted(appId) {
    const id = toStr(appId);
    if (!id) return false;
    if (APP_LAZY_ROUTE_INDEX.has(id)) return true;
    return TE_INLINE_ROUTED.indexOf(id) >= 0;
}
/* ---------- 页签真源的**派生平铺表**（判定的默认入参） ----------
 * 登记面在 config/tab-source.js（带 file/shape/note 的登记表），判定只要白名单集合。
 * 派生在这一层做一次，`tabState` 缺省就能吃到真表，见其注释。 */
export const TE_TABMAP = tabMapOf();
export function teTabSourceSelfCheck() { return tabSourceSelfCheck(); }

/* ---------- 收藏归一 ---------- */
/**
 * 形态归一：任意来源的收藏读数收成**结构恒定**的 `{state, why, pins, dropped}`。
 * 坏条目按「没给」处理（丢进 dropped 计数），**不补假值**、不去猜用户想收藏什么。
 * 上限超出只报不截的只有 dropped 计数（截断本身是设计：桌面放不下更多）。
 */
export function normalizePins(raw, max) {
    if (raw === undefined || raw === null || raw === '') {
        return { state: TE_STATES.ABSENT, why: TE_REASONS.ABSENT, pins: [], dropped: 0 };
    }
    if (!Array.isArray(raw)) {
        return { state: TE_STATES.UNREADABLE, why: TE_REASONS.BAD_SHAPE, pins: [], dropped: 0 };
    }
    const cap = (typeof max === 'number' && max > 0) ? Math.floor(max) : TE_PINS_MAX;
    const seen = Object.create(null);
    const out = [];
    let dropped = 0;
    for (const item of raw) {
        if (!isPlain(item) || !toStr(item.appId)) { dropped += 1; continue; }
        const appId = toStr(item.appId);
        if (seen[appId]) { dropped += 1; continue; }
        seen[appId] = true;
        const tab = (item.tab === null || item.tab === undefined) ? null : (toStr(item.tab) || null);
        out.push({ appId: appId, tab: tab });
    }
    if (out.length > cap) {
        dropped += out.length - cap;
        return { state: TE_STATES.OK, why: TE_REASONS.TOO_MANY_PINS, pins: out.slice(0, cap), dropped: dropped };
    }
    if (!out.length) return { state: TE_STATES.EMPTY, why: '', pins: [], dropped: dropped };
    return { state: TE_STATES.OK, why: '', pins: out, dropped: dropped };
}
/**
 * 页签合法性三态（**不压成一态**）：
 *   · unsupported —— tabMap 里该 appId 在场、但白名单不含这个 tab ⇒ 声明的靶心不存在
 *   · unknown     —— tabMap 里没有该 appId ⇒ 不知道，**不许当支持**（未核对 ⇏ 通过）
 *   · ok          —— 白名单在场且含该 tab
 * `tab === null` 一律 ok（本就不声称页签）。
 * @param tabMap 缺省走 **TE_TABMAP（真表）**。为什么缺省不是 `{}`：忘了传就得到
 *   一片 `unknown`，那张「页签全绿」的读数全是假的（未核对被显示成没问题）。
 *   宁可缺省吃真表：忘了传最多是拿真表判，绝不会得到假绿。
 */
export function tabState(appId, tab, tabMap) {
    if (tab === null || tab === undefined) return { state: 'ok', why: '' };
    const map = (tabMap === undefined || tabMap === null) ? TE_TABMAP : tabMap;
    const wl = hasOwn(map, appId) ? map[appId] : null;
    if (!Array.isArray(wl)) return { state: 'unknown', why: TE_REASONS.TAB_UNKNOWN };
    return (wl.indexOf(tab) >= 0) ? { state: 'ok', why: '' } : { state: 'unsupported', why: TE_REASONS.TAB_UNSUPPORTED };
}

/**
 * 可用性筛选（逐卡）。读不到的卡**说清原因**，不静默变成「没这张卡」。
 * @param cards 卡表
 * @param ctx   { tabMap } 可选；给 tab 给出靶心读数
 * @returns 逐卡 { id, label, hint, usable, why, targets[], withTab, appOnly }
 */
export function availableCards(cards, ctx) {
    const o = isPlain(ctx) ? ctx : {};
    /* 缺省吃**真表**（与 tabState 同一条口径）：忘了传 map 最多是拿真表判，
     *   绝不会得到「15 条带页签靶心全判 unknown ⇒ 带页签的卡整体不可用」这种假红。
     *   要空表判（判据需要时）显式传 { tabMap: {} }。 */
    const tabMap = isPlain(o.tabMap) ? o.tabMap : TE_TABMAP;
    const rows = [];
    for (const card of listOf(cards)) {
        if (!isPlain(card) || !toStr(card.id)) continue;
        const targets = [];
        let reachable = 0;
        let withTab = 0;
        const missing = [];
        const badTabs = [];
        for (const t of listOf(card.targets)) {
            if (!isPlain(t) || !toStr(t.appId)) continue;
            const routed = isRouted(t.appId);
            const ts = tabState(t.appId, (t.tab === undefined ? null : t.tab), tabMap);
            /* 靶心坏掉时**连 App 也不可达**：声称会送到不存在的页签，比不声称更坏。
             *   故 unsupported 与 unknown 都让这一条退出可达集合，且各自点名。 */
            const ok = routed && ts.state === 'ok';
            if (ok) { reachable += 1; if (t.tab) withTab += 1; }
            if (!routed) missing.push(toStr(t.appId));
            if (ts.state !== 'ok' && routed) badTabs.push(toStr(t.appId) + '#' + toStr(t.tab));
            targets.push({
                appId: toStr(t.appId), tab: (t.tab === undefined ? null : t.tab),
                note: toStr(t.note), routed: routed, tabState: ts.state, usable: ok
            });
        }
        let why = '';
        if (!reachable) {
            why = missing.length ? TE_REASONS.APP_NOT_ROUTED
                : (badTabs.length ? TE_REASONS.TAB_UNSUPPORTED : TE_REASONS.BAD_SHAPE);
        } else {
            const appOnly = targets.filter((x) => x.usable && !x.tab).length;
            if (appOnly === reachable) why = '';
        }
        rows.push({
            id: toStr(card.id), label: toStr(card.label), hint: toStr(card.hint),
            usable: reachable > 0, why: why, targets: targets,
            reachable: reachable, withTab: withTab, appOnly: reachable - withTab,
            missing: missing, badTabs: badTabs
        });
    }
    return rows;
}

/**
 * 收藏卡：按收藏顺序取卡（**顺序即用户在桌面上摆的顺序**，不按卡片表重排）。
 * 收藏的 appId 不在任何卡里 ⇒ 如实记 orphan（不静默丢弃，也不编一张卡）。
 */
export function pinnedCards(pinNorm, cards, ctx) {
    const pins = listOf(pinNorm && pinNorm.pins);
    if (!pins.length) {
        return {
            state: (pinNorm && pinNorm.state) ? pinNorm.state : TE_STATES.EMPTY,
            why: (pinNorm && pinNorm.why) ? pinNorm.why : '',
            items: [], orphans: [], dropped: (pinNorm && pinNorm.dropped) || 0
        };
    }
    const byCard = Object.create(null);
    for (const row of availableCards(cards, ctx)) byCard[row.id] = row;
    const items = [];
    const orphans = [];
    for (const p of pins) {
        const row = byCard[p.appId];
        if (!row) { orphans.push(p.appId); continue; }
        items.push({ appId: p.appId, tab: p.tab, label: row.label, usable: row.usable, why: row.why });
    }
    return {
        state: TE_STATES.OK, why: (pinNorm && pinNorm.why) || '',
        items: items, orphans: orphans, dropped: (pinNorm && pinNorm.dropped) || 0
    };
}

/**
 * 最近使用：**委托 usage-tracker 的 topApps**，不在这里抄第二份聚合。
 * 读不出与「没有记录」分态（空 ≠ 读不出）。
 */
export function recentFromUsage(usage, n) {
    if (!isPlain(usage)) {
        return { state: TE_STATES.UNREADABLE, why: TE_REASONS.USAGE_UNREADABLE, items: [] };
    }
    const norm = normalizeUsage(usage);
    const sum = usageSummary(norm);
    if (sum.empty) return { state: TE_STATES.EMPTY, why: '', items: [], activeDays: 0 };
    const cap = (typeof n === 'number' && n > 0) ? Math.floor(n) : TE_RECENT_MAX;
    const raw = topApps(norm, cap);
    const items = [];
    for (const r of raw) {
        /* 只保留**去得了**的入口：usage 里可能有已退役的 appId（历史读数）。
         *   去不了的老条目如实计数（stale），不当最近使用摆出来 —— 摆出来点了没反应
         *   正是本仓最贵的「不报错、只错结果」。 */
        if (!isRouted(r.id)) { items.push({ appId: r.id, count: r.count, ms: r.ms, routed: false }); continue; }
        items.push({ appId: r.id, count: r.count, ms: r.ms, routed: true });
    }
    const live = items.filter((x) => x.routed);
    return {
        state: live.length ? TE_STATES.OK : TE_STATES.EMPTY,
        why: '', items: items, activeDays: sum.activeDays
    };
}

/** 读数面：把三个面收成结构恒定的一张读数表（给展示与判据共用，不自持第二份数据）。 */
export function entryReadings(cards, pins, usage, ctx) {
    const rows = availableCards(cards, ctx);
    const usable = rows.filter((r) => r.usable);
    const pinNorm = normalizePins(pins, TE_PINS_MAX);
    const pinned = pinnedCards(pinNorm, cards, ctx);
    const rec = recentFromUsage(usage, TE_RECENT_MAX);
    return {
        cards: rows.length,
        usableCards: usable.length,
        unusableCards: rows.length - usable.length,
        targets: rows.reduce((a, r) => a + r.targets.length, 0),
        withTab: rows.reduce((a, r) => a + r.withTab, 0),
        appOnly: rows.reduce((a, r) => a + r.appOnly, 0),
        pins: pinNorm.pins.length,
        pinState: pinNorm.state,
        pinned: pinned.items.length,
        pinOrphans: pinned.orphans.length,
        recent: rec.items.filter((x) => x.routed).length,
        recentStale: rec.items.filter((x) => !x.routed).length,
        recentState: rec.state
    };
}

/* ---------- 唯一读写门（本文件之外不许碰这两条键） ---------- */
function usable(storage) {
    if (!storage) return { ok: false, why: TE_REASONS.NO_STORAGE };
    if (typeof storage.get !== 'function') return { ok: false, why: TE_REASONS.NO_API };
    return { ok: true, why: '' };
}
/** 读收藏：读不出/畸形一律返回空读数（不抛、也不退回上一次读数）。 */
export function readPins(storage) {
    const g = usable(storage);
    if (!g.ok) return { state: TE_STATES.ABSENT, why: g.why, pins: [], dropped: 0 };
    let raw;
    try { raw = storage.get(TE_PINS_KEY, undefined); }
    catch (_e) { return { state: TE_STATES.UNREADABLE, why: TE_REASONS.READ_THREW, pins: [], dropped: 0 }; }
    return normalizePins(raw, TE_PINS_MAX);
}
/** 写收藏：走唯一写回执实现（真 PhoneStorage.set 是 async —— O5 交付的口径）。 */
export function writePins(storage, pins) {
    const g = usable(storage);
    if (!g.ok) return { saved: false, why: g.why };
    if (typeof storage.set !== 'function') return { saved: false, why: TE_REASONS.NO_API };
    try { return writeReceipt(storage, TE_PINS_KEY, listOf(pins)); }
    catch (_e) { return { saved: false, why: TE_REASONS.WRITE_THREW }; }
}
/** 收藏增删：**幂等**（重复收藏同一条不产生第二条、取消不存在的不是错误）。 */
export function togglePin(pins, appId, tab) {
    const id = toStr(appId);
    /* 空串与纯空白都寻不到任何一张卡 —— 不当变更，也不落进收藏列表
     *   （落了会在 `pinnedCards` 里变成一个永远消不掉的 orphan）。 */
    if (!id || !id.trim()) return { pins: listOf(pins), changed: '', full: false };
    const cur = listOf(pins).filter((p) => isPlain(p) && toStr(p.appId) && toStr(p.appId) !== id);
    if (cur.length !== listOf(pins).length) {
        return { pins: cur, changed: 'removed', full: false };
    }
    if (listOf(pins).length >= TE_PINS_MAX) return { pins: listOf(pins), changed: '', full: true };
    const t = (tab === null || tab === undefined) ? null : (toStr(tab) || null);
    return { pins: cur.concat([{ appId: id, tab: t }]), changed: 'added', full: false };
}
export function readLedger(storage) {
    const g = usable(storage);
    if (!g.ok) return { state: TE_STATES.ABSENT, why: g.why, rows: [] };
    let raw;
    try { raw = storage.get(TE_LEDGER_KEY, undefined); }
    catch (_e) { return { state: TE_STATES.UNREADABLE, why: TE_REASONS.READ_THREW, rows: [] }; }
    if (raw === undefined || raw === null || raw === '') return { state: TE_STATES.ABSENT, why: TE_REASONS.ABSENT, rows: [] };
    if (!Array.isArray(raw)) return { state: TE_STATES.UNREADABLE, why: TE_REASONS.BAD_SHAPE, rows: [] };
    return { state: raw.length ? TE_STATES.OK : TE_STATES.EMPTY, why: '', rows: raw.slice(0, TE_LEDGER_MAX) };
}
export function writeLedger(storage, rows) {
    const g = usable(storage);
    if (!g.ok) return { saved: false, why: g.why };
    try { return writeReceipt(storage, TE_LEDGER_KEY, listOf(rows).slice(0, TE_LEDGER_MAX)); }
    catch (_e) { return { saved: false, why: TE_REASONS.WRITE_THREW }; }
}
/* ---------- 能力筛选（X1 原文：「能力筛选」） ----------
 * 口径：能力是**逐卡**的读数（`availableCards` 的 reachable/withTab/appOnly），
 *   不是逐 App 的标签。故筛选只在小表上做，不重算卡。
 *   `all` 与 `usable` **不是一个意思**：all 含不可用的卡（要能看到「为什么没这张」），
 *   usable 才是「现在真能去的」。两者都留。
 */
export const TE_CAPS = Object.freeze(['all', 'usable', 'withTab', 'appOnly']);
export function filterCards(rows, cap) {
    const c = (typeof cap === 'string' && TE_CAPS.indexOf(cap) >= 0) ? cap : 'usable';
    const list = listOf(rows);
    if (c === 'all') return list.slice(0);
    if (c === 'usable') return list.filter((r) => r && r.usable);
    if (c === 'withTab') return list.filter((r) => r && r.usable && r.withTab > 0);
    return list.filter((r) => r && r.usable && r.withTab === 0);
}
/** 逐卡能力标签（给展示用；**不合并成一串** —— 合并后就说不清为什么筛掉了）。 */
export function capabilityOf(row) {
    if (!isPlain(row)) return 'unusable';
    if (!row.usable) return 'unusable';
    if (row.withTab > 0 && row.appOnly > 0) return 'mixed';
    if (row.withTab > 0) return 'with-tab';
    return 'app-only';
}

/* ---------- 派发桩：把「到哪个 App 的哪个页签」交给唯一一支笔 ----------
 * **本函数的全部价值是「别处不再手写 detail 字面量」**。
 * 由 config/app-open-detail.js 归一，`tab` 不成立时不写这个字段。
 */
export function openPayload(appId, tab) {
    return buildOpenDetail(appId, tab);
}
export function dispatchOpen(appId, tab, win) {
    const payload = openPayload(appId, tab);
    if (!payload.appId) return { sent: false, why: TE_REASONS.BAD_SHAPE };
    const w = win || (typeof window !== 'undefined' ? window : null);
    if (!w || typeof w.dispatchEvent !== 'function') return { sent: false, why: TE_REASONS.NO_API };
    w.dispatchEvent(new w.CustomEvent('phone:openApp', { detail: payload }));
    return { sent: true, why: '' };
}

/* ---------- 自检口（不读 fs、不起宿主；判据与体检共用） ---------- */
export function taskEntrySelfCheck() {
    const problems = [];
    /* 0) 页签真源自检：卡表说「送到某页签」的底气全在这张表上。
     *   表自身结构坏（shape 非法 / 单页却登记多条 / 页签重复）时，
     *   逐卡判定的结论跟着一起不可信 —— 故先把它自己的问题并进来。 */
    const ts = teTabSourceSelfCheck();
    for (const p of listOf(ts.problems)) problems.push('页签表：' + p);
    if (Object.keys(TE_TABMAP).length !== ts.apps) {
        problems.push('页签平铺表与登记表条数不一致：' + Object.keys(TE_TABMAP).length + ' vs ' + String(ts.apps));
    }
    /* 1) 卡表结构 */
    if (!TE_CARDS.length) problems.push('卡表为空');
    const ids = Object.create(null);
    for (const c of TE_CARDS) {
        if (!isPlain(c) || !toStr(c.id)) { problems.push('卡缺 id'); continue; }
        if (ids[c.id]) problems.push('卡 id 重复：' + c.id);
        ids[c.id] = true;
        if (!listOf(c.targets).length) problems.push(c.id + ' 无靶心');
        for (const t of listOf(c.targets)) {
            if (!isPlain(t) || !toStr(t.appId)) { problems.push(c.id + ' 靶心缺 appId'); continue; }
            /* 靶心的 appId 必须在**本仓有路由**，否则这张卡是空头支票 */
            if (!isRouted(t.appId)) problems.push(c.id + ' 靶心 appId 无路由：' + t.appId);
            if (t.tab !== null && t.tab !== undefined && !toStr(t.tab)) problems.push(c.id + ' 靶心 tab 非空串但非字符串：' + t.appId);
        }
    }
    /* 2) 词表与常量的一致性（判据会按词表逐词核读数里的 why） */
    for (const k of Object.keys(TE_REASONS)) {
        const v = TE_REASONS[k];
        if (typeof v !== 'string' || !v) problems.push('归因词表 ' + k + ' 不是非空串');
    }
    /* 3) 能力表与筛选口径 */
    for (const cap of TE_CAPS) {
        const probe = filterCards([{ usable: true, withTab: 1, appOnly: 0 }, { usable: true, withTab: 0, appOnly: 2 }, { usable: false, withTab: 0, appOnly: 0 }], cap);
        if (!Array.isArray(probe)) problems.push('能力筛选 ' + cap + ' 没返回数组');
    }
    if (filterCards([{ usable: false, withTab: 0, appOnly: 0 }], 'usable').length !== 0) problems.push('usable 没有滤掉不可用卡');
    return { cards: TE_CARDS.length, caps: TE_CAPS.length, problems: problems };
}