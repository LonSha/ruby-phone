/* ============================================================
 * config/notice-paradigm-bridge.js — [v4.99.7 · R11-X7] 范式阈值 ↔ 通知行形状 的**中间一层**
 * ------------------------------------------------------------
 * 【为什么不能直接把 `filterNoticesByParadigm` 接进通知中心】
 *   内核 `config/usage-paradigm.js` 的 `filterNoticesByParadigm(notices, paradigm)` 只看三样：
 *     `item.level`（字符串）/ `item.isUrgent === true` / `item.isImportant === true`。
 *   而通知中心的两种行**一个都不带**：
 *     · `NotificationLog` 的行（`config/system-notifications.js` 的 `_normalize`）字段是
 *       { id, ts, title, message, icon, appId, senderKey, read, count, meta } —— **没有 level**；
 *       `push()` 也不收 level（全仓 `showNotification` 一次都没传过档次）。
 *     · 中枢映射行（`notification-hub-bridge.js` 的 `mapHubNotification`）把优先级塞在
 *       `meta.hubPriority`（'URGENT'|'NORMAL'|'SILENT'）与 `meta.hubPriorityNum`（3|2|1）里，
 *       行上同样没有 `level`。
 *   直连的实测后果（一次性探针实测，产物已清理）：五档范式下 `urgent_only` 把
 *   **全部 5 条通知丢光、连中枢那条 URGENT 也一起丢**（存活 0/2）。
 *   这不是「过滤生效」，这是在没有任何报错的前提下把「系统坏了」演成「一切正常」——
 *   本仓治过多次的同一种病，故先适配、再过滤。
 *
 * 【本层只做一件事：把行形状翻译成内核认的形状，过滤仍由内核做】
 *   ★ 不重写过滤逻辑：留哪条、丢哪条**只有内核一处口径**。本层若自己写一遍
 *     `urgent_only 留 urgent` 的判据，就是第二份实现，改阈值时两边必然走岔。
 *   ★ 不改入参：`adaptNoticeForParadigm` 返回**新对象**，原行（含 `meta`）一字不动 ——
 *     过滤是**呈现层**的事，不许把 level 写回 `sys_notifs`（写回就是往真源里塞渲染态）。
 *   ★ 档次有出处：每条的 level 必须能说出「凭什么」（`source` 字段）——
 *     `row.level` / `hubPriority` / `hubPriorityNum` / `isUrgent` / `isImportant` / `none`。
 *     说不出出处的（`none`）按 `normal`，与内核 `safeStr(item.level) || 'normal'` 同口径。
 * ============================================================ */
'use strict';
import { filterNoticesByParadigm } from './usage-paradigm.js';

/** 内核认的三档阈值（`noticeThreshold` 的合法取值）。 */
const THRESHOLDS = Object.freeze(['all', 'important', 'urgent_only']);
/** 本层认的行档次（比内核多一个 `silent`：中枢派发器的 SILENT 在重要档下**不该**活）。 */
const LEVELS = Object.freeze(['urgent', 'important', 'normal', 'silent']);
/** 中枢派发器的字符串优先级 → 行档次。 */
const HUB_NAME_TO_LEVEL = Object.freeze({ URGENT: 'urgent', NORMAL: 'normal', SILENT: 'silent' });
/** 中枢派发器的数字优先级 → 行档次（NOTIFICATION_PRIORITY：URGENT 3 / NORMAL 2 / SILENT 1）。 */
const HUB_NUM_TO_LEVEL = Object.freeze({ 3: 'urgent', 2: 'normal', 1: 'silent' });

/**
 * 判定一条通知属于哪一档，并说清依据。
 * @param {object} row 通知行（log 行或 hub 映射行）
 * @returns {{level:string, source:string}} source ∈ row.level|hubPriority|hubPriorityNum|isUrgent|isImportant|none
 */
export function noticeLevelOf(row) {
    if (!row || typeof row !== 'object') return { level: 'normal', source: 'none' };
    /* ① 行上自带 level：**尊重真源**（将来落账层真写了档次，本层不需要改）。 */
    const raw = typeof row.level === 'string' ? row.level.trim().toLowerCase() : '';
    if (LEVELS.includes(raw)) return { level: raw, source: 'row.level' };
    /* ② 中枢映射行的优先级（字符串名优先于数字：名字更明确、不受常量表漂移影响）。 */
    const meta = (row.meta && typeof row.meta === 'object') ? row.meta : {};
    const name = typeof meta.hubPriority === 'string' ? meta.hubPriority.trim().toUpperCase() : '';
    if (name && HUB_NAME_TO_LEVEL[name]) return { level: HUB_NAME_TO_LEVEL[name], source: 'hubPriority' };
    const num = Number(meta.hubPriorityNum);
    if (Number.isFinite(num) && HUB_NUM_TO_LEVEL[num]) {
        return { level: HUB_NUM_TO_LEVEL[num], source: 'hubPriorityNum' };
    }
    /* ③ 显式布尔（内核也认这两个，这里提前折算成 level，避免下游两套判据）。 */
    if (row.isUrgent === true) return { level: 'urgent', source: 'isUrgent' };
    if (row.isImportant === true) return { level: 'important', source: 'isImportant' };
    /* ④ 什么都没说：按 normal —— 与内核默认同口径，**不猜成 important**（猜高会让
     *    「读不到档次」在重要档下伪装成「这条很重要」）。 */
    return { level: 'normal', source: 'none' };
}

/**
 * 把一条通知行翻译成内核认的形状（**返回新对象，不改入参**）。
 * @param {object} row
 * @returns {object}
 */
function adaptNoticeForParadigm(row) {
    const info = noticeLevelOf(row);
    const base = (row && typeof row === 'object') ? row : {};
    return {
        ...base,
        level: info.level,
        isUrgent: info.level === 'urgent',
        isImportant: info.level === 'urgent' || info.level === 'important'
    };
}

/**
 * 归一化范式的通知阈值。
 * @param {object|null} paradigm 范式定义（`resolveActiveParadigm` 的产物）
 * @returns {{threshold:string, raw:string, fallback:boolean}}
 *   · 未设阈值（`raw===''`）→ `all`，`fallback:false`（**这是设计内默认**，不是坏数据）；
 *   · 设了但不认识（`raw='weird'`）→ `all`，`fallback:true`（这是坏数据，界面该说出来）。
 *   两者都落 `all`（与内核 `threshold || 'all'` 同口径），但**不能压成同一句**。
 */
export function thresholdOf(paradigm) {
    const p = (paradigm && typeof paradigm === 'object') ? paradigm : null;
    let raw = '';
    let err = '';
    try {
        /* 只读一次：`typeof p.x === 'string'` 后面再 `p.x.trim()` 会触发两遍 getter，
         *   而且任何一遍都可能抛 —— 一次读进变量，异常就只在一个地方出。 */
        const v = p ? p.noticeThreshold : undefined;
        raw = (typeof v === 'string') ? v.trim() : '';
    } catch (e) {
        /* ★ 读阈值这一步自己坏了，**不等于**「没设阈值」。故另立 `err`，
         *   由 `splitNoticesByParadigm` 报成 ok:false 并全量显示 ——
         *   绝不允许它逃到界面（逃出去的表现是渲染直接抛，整页空白、还没人知道为什么）。 */
        err = String((e && e.message) || e || 'threshold_threw');
    }
    if (err) return { threshold: 'all', raw: '', fallback: false, err };
    if (THRESHOLDS.includes(raw)) return { threshold: raw, raw, fallback: false, err: '' };
    return { threshold: 'all', raw, fallback: raw !== '', err: '' };
}

/**
 * 按范式把一组通知分成「留下」与「被隐藏」两堆（**过滤判据全部来自内核**）。
 * @param {Array} rows 通知行（`feed().rows` 的产物，含 log 行与 hub 映射行）
 * @param {object|null} paradigm 当前范式定义
 * @returns {{ok:boolean, why:string, threshold:string, raw:string, fallback:boolean,
 *            applied:boolean, visible:Array, hidden:Array, levels:Array,
 *            counts:{total:number, visible:number, hidden:number}}}
 *   · `ok:false` 表示**这一层自己出错了**（内核抛错）—— 此时 `visible` 是全量、
 *     `applied:false`，但界面必须把 `why` 念出来：不能让「过滤坏了」看起来像「没过滤」。
 *   · `applied:false`（阈值 all）时 `hidden` 恒空 —— 「没有隐藏」与「隐藏了 0 条」不同形，
 *     由 `applied` 区分，界面据此决定要不要显示隐藏区（all 档不显示，免得占位）。
 */
/**
 * 阈值的**界面文案**（档次名的唯一出处）。
 *
 * 为什么放在这一层而不是视图里：视图自己写 `{ important: '只留重要及以上' }`
 * 就等于有了第二处档次字面量 —— 内核改了档名、或将来加了第四档，
 * 视图不会跟着变，而且不会有任何判据替它响（本仓治过多次的那种漂移）。
 * 故：**档名只在本文件出现一次**，视图只消费本函数的结果。
 *
 * @param {string} threshold 阈值（`all` / `important` / `urgent_only`，或坏数据）
 * @returns {string} 可直接显示的中文短语；`all` 返回空串（调用方本来就不该为 all 出文案）
 */
const THRESHOLD_LABELS = Object.freeze({
    all: '',
    important: '只留重要及以上',
    urgent_only: '只留紧急'
});
/* ★ 表**不导出**：上一版把它 export 出去给判据核对键集，结果它自己成了
 *   「只有测试消费的导出」——bind-audit 当场记了一条零消费（判绿靠测试不算真消费）。
 *   判据改成**行为核对**（三档都有中文文案、坏阈值如实念、all 档空串），
 *   表格就退回本文件私有：少一个导出，少一条要还的债。 */
export function thresholdLabelOf(threshold) {
    const t = (typeof threshold === 'string') ? threshold.trim() : '';
    if (Object.prototype.hasOwnProperty.call(THRESHOLD_LABELS, t)) return THRESHOLD_LABELS[t];
    return t ? ('阈值「' + t + '」') : '';
}
export function splitNoticesByParadigm(rows, paradigm) {
    const list = Array.isArray(rows) ? rows.filter(r => r && typeof r === 'object') : [];
    const th = thresholdOf(paradigm);
    const levels = list.map(r => noticeLevelOf(r));
    if (th.err) {
        /* 阈值读不出来 ⇒ 不过滤，并把原因念出来（形与内核抛错一致，但不是同一件事：
         *   `why` 前缀区分，免得排查时把「范式数据坏了」认成「内核坏了」）。 */
        return {
            ok: false,
            why: 'threshold_threw: ' + th.err,
            threshold: th.threshold,
            label: thresholdLabelOf(th.threshold),
            raw: '',
            fallback: false,
            applied: false,
            visible: list.slice(),
            hidden: [],
            levels,
            counts: { total: list.length, visible: list.length, hidden: 0 }
        };
    }
    let adapted = null;
    let kept = null;
    try {
        adapted = list.map(adaptNoticeForParadigm);
        kept = filterNoticesByParadigm(adapted, paradigm || null);
    } catch (e) {
        adapted = null;
        return {
            ok: false,
            why: String((e && e.message) || e || 'filter_threw'),
            threshold: th.threshold,
            label: thresholdLabelOf(th.threshold),
            raw: th.raw,
            fallback: th.fallback,
            applied: false,
            visible: list.slice(),
            hidden: [],
            levels,
            counts: { total: list.length, visible: list.length, hidden: 0 }
        };
    }
    const keptSet = new Set(Array.isArray(kept) ? kept : []);
    const visible = [];
    const hidden = [];
    for (let i = 0; i < list.length; i += 1) {
        if (keptSet.has(adapted[i])) visible.push(list[i]);
        else hidden.push(list[i]);
    }
    return {
        ok: true,
        why: '',
        threshold: th.threshold,
        label: thresholdLabelOf(th.threshold),
        raw: th.raw,
        fallback: th.fallback,
        applied: th.threshold !== 'all',
        visible,
        hidden,
        levels,
        counts: { total: list.length, visible: visible.length, hidden: hidden.length }
    };
}
