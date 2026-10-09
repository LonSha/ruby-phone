/* ========================================================
 * punchcard-data.js — [v3.26.0] 打卡 App 纯函数内核
 *
 * 缝合自 MyPhone（src_myphone/punchcard.js，501 行）的**作息表数据模型那一半**：
 *   一天一张卡 → 卡里若干作息项（时间点或时长 + 任务内容）→ 每项可勾完成 + 写备注
 *   → 连续打卡天数（streak）→ 事实注入。
 *
 * 【缝什么、不缝什么 —— 三处「源有本仓不能有」】
 *   ① 持久化：源 `const DB_NAME = 'PhoneSimPunchCard'` + 自建 IndexedDB（openDB / dbPut /
 *      dbGetAll / dbDelete 四个函数 50 行）。本仓**零数据库铁律**（CONTEXT.md）——
 *      全书走 PhoneStorage（键前缀 `punchcard_`），本文件保持**纯函数**：卡片数组进、
 *      数组出，落盘由 App 层负责。
 *   ② **AI 生成**：源 `generateCard` 自己 `fetch` 角色 API、拼 system prompt、**两轮重试**
 *      （第一次作息项少于 8 项就再问一遍）、`JSON.parse` 模型输出、写回卡里。
 *      本仓这套没有归属：模型调用一律走宿主（生成侧），App 不自己发请求；
 *      请求失败/JSON 坏掉的分支在源里是一整块 `catch → showToast('生成失败')`，
 *      硬缝只会造出「点了没反应」的壳。
 *      ⇒ 本件**只做主叫侧的账**：用户填表 → 打卡 → 统计 → 注入事实；**不替用户叫模型**。
 *   ③ 世界书铺料：源 `getGlobalWbText` / `getCharWbText` / `getFullCharCardText` 把
 *      全局世界书 + 角色世界书 + 完整角色卡拼成上下文喂给模型。本仓这些各有归属
 *      （`config/prompt-manager.js` 与记忆插件），App 不自己去搬世界书。
 *
 * 【从源里取的三块真价值】
 *   · **「时间点 / 时长」双形态的作息项**（源 `toggleTimeInput`）：同一栏既能填 `08:00`
 *     也能填「30分钟」。很多打卡 App 只认时刻，作息里的「练琴半小时」就无处安放。
 *   · **完成勾 + 逐项备注**（源 `updateTaskCheck` / `updateTaskRemark`）：备注是**证据**
 *     而不是心情 —— 它随项走，不是随卡走。
 *   · **按天归档**（源 `createdAt` + 列表倒序）：一天一张卡，天然可算连续天数。
 *
 * 【与源的偏离（逐条写明）】
 *   1. `date` 用**本地日键**（`YYYY-MM-DD`）而不用 `createdAt` 毫秒值。源只存毫秒，
 *      于是「同一天补了第二张卡」在数据上无法识别（两张卡的日期在界面上看起来一样、
 *      在数据上是两个不同的数）。日键让「一天一张」成为可判定的事实，
 *      也让 streak 不必反复算时区。`createdAt` 仍保留（排序用）。
 *   2. 每个作息项一个**稳定 id**（源用数组下标当身份）。源 `updateTaskCheck(id, index, checked)`
 *      按下标改 —— 用户删掉中间一项后，所有下标平移，**备注会串到别的项上**：
 *      不报错、只错数据（本仓最贵的形态）。本件改成 id 定位并配往返判据。
 *   3. streak 口径写死并配判据：以**最近一张卡**为起点逐日回退，必须**逐日连续**；
 *      最近卡距今超过 1 天即视为已断（返回 0）。源没有 streak 概念，这是本件的加法，
 *      加法的理由是「打卡类工具没有连续天数就只剩一张表」。
 *   4. 卡片数 / 项数 / 文案长度均设上限（源无上限）：随会话存档走，无界会顶到 chatMetadata。
 *
 * 本文件零依赖叶子模块（只引 num-gate），无副作用、不碰 DOM、不碰 window、不碰网络。
 * ======================================================== */
'use strict';
import { numOrNull } from '../../config/num-gate.js';
import { boundedInt } from '../../config/num-clamp.js';

/** 归因三态。**值**是连字符形，视图文案表的键必须取这里的值（与 focus / piggy / rgx 同纪律）。 */
export const PUNCH_REASONS = Object.freeze({
    ready: 'ready',
    empty: 'empty',
    storage_absent: 'storage-absent',
});

/** 作息项的两种形态（源 `toggleTimeInput` 同义）。 */
export const PUNCH_ITEM_KINDS = Object.freeze(['time', 'duration']);

export const PUNCH_LIMITS = Object.freeze({
    maxCards: 60,
    maxItemsPerCard: 30,
    maxLabelLen: 60,
    maxRemarkLen: 60,
});

export const DEFAULT_PUNCH_SETTINGS = Object.freeze({
    injectToPrompt: true,
    /** 注入时带几个未完成项（0 = 不带明细）。 */
    maxInjectItems: 4,
    maxCards: 60,
});

export function defaultPunchSettings() {
    return Object.freeze({ ...DEFAULT_PUNCH_SETTINGS });
}

export function normalizePunchSettings(raw) {
    const d = DEFAULT_PUNCH_SETTINGS;
    const o = (raw && typeof raw === 'object') ? raw : {};
    return Object.freeze({
        injectToPrompt: o.injectToPrompt !== false,
        maxInjectItems: boundedInt(o.maxInjectItems, d.maxInjectItems, 0, 20),
        maxCards: boundedInt(o.maxCards, d.maxCards, 7, 400),
    });
}

/** 本地日键（`YYYY-MM-DD`）。用本地时区切天，与 focus-data.dayKey 同族。 */
export function dayKey(ts) {
    const n = numOrNull(ts);
    const d = new Date(n === null ? Date.now() : n);
    if (!Number.isFinite(d.getTime())) return '';
    const m = d.getMonth() + 1;
    return d.getFullYear() + '-' + (m < 10 ? ('0' + m) : String(m)) + '-' + (d.getDate() < 10 ? ('0' + d.getDate()) : String(d.getDate()));
}

/** 把日键回退 n 天（streak 逐日回退用）。日键非法返回空串。 */
export function shiftDayKey(key, days) {
    const m = String(key || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return '';
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    if (!Number.isFinite(d.getTime())) return '';
    d.setDate(d.getDate() + days);
    return dayKey(d.getTime());
}

/** 一条作息项。label 为空即判无效返回 null。 */
export function normalizeItem(raw, now) {
    const o = (raw && typeof raw === 'object') ? raw : {};
    const label = String(o.label || '').trim().slice(0, PUNCH_LIMITS.maxLabelLen);
    if (!label) return null;
    const kind = PUNCH_ITEM_KINDS.includes(o.kind) ? o.kind : 'time';
    const t = numOrNull(now);
    const stamp = t === null ? Date.now() : Math.round(t);
    return {
        id: (typeof o.id === 'string' && o.id) ? o.id : ('pi_' + stamp + '_' + Math.random().toString(36).slice(2, 8)),
        kind,
        at: String(o.at || '').trim().slice(0, 24),
        label,
        done: o.done === true,
        remark: String(o.remark || '').trim().slice(0, PUNCH_LIMITS.maxRemarkLen),
    };
}

/** 一张打卡卡（一天一张）。无有效作息项即返回 null。 */
export function normalizeCard(raw) {
    const o = (raw && typeof raw === 'object') ? raw : {};
    const cAt = numOrNull(o.createdAt);
    const createdAt = cAt === null ? Date.now() : Math.round(cAt);
    const date = /^\d{4}-\d{2}-\d{2}$/.test(String(o.date || '')) ? String(o.date) : dayKey(createdAt);
    const items = (Array.isArray(o.items) ? o.items : [])
        .map((x) => normalizeItem(x, createdAt)).filter(Boolean).slice(0, PUNCH_LIMITS.maxItemsPerCard);
    if (!items.length) return null;
    return {
        id: (typeof o.id === 'string' && o.id) ? o.id : ('pch_' + createdAt + '_' + Math.random().toString(36).slice(2, 8)),
        date,
        targetName: String(o.targetName || '').trim().slice(0, PUNCH_LIMITS.maxLabelLen),
        items,
        createdAt,
    };
}

/** 卡片数组规范化（去无效项、按上限截断、最新在前）。 */
export function normalizeCards(raw) {
    const list = Array.isArray(raw) ? raw : [];
    const out = list.map(normalizeCard).filter(Boolean);
    out.sort((a, b) => b.createdAt - a.createdAt);
    return out.slice(0, PUNCH_LIMITS.maxCards);
}

/** 建一张卡（同一天已有卡时**并项**而不是再开一张：源没这个约束，见文件头偏离第 1 条）。 */
export function createCard(cards, input, now) {
    const base = normalizeCards(cards);
    const t = numOrNull(now);
    const nowMs = t === null ? Date.now() : Math.round(t);
    const o = (input && typeof input === 'object') ? input : {};
    const date = /^\d{4}-\d{2}-\d{2}$/.test(String(o.date || '')) ? String(o.date) : dayKey(nowMs);
    const fresh = (Array.isArray(o.items) ? o.items : [])
        .map((x) => normalizeItem(x, nowMs)).filter(Boolean);
    if (!fresh.length) return { cards: base, added: 0, cardId: '' };
    const idx = base.findIndex((c) => c.date === date);
    if (idx >= 0) {
        const merged = {
            ...base[idx],
            items: base[idx].items.concat(fresh).slice(0, PUNCH_LIMITS.maxItemsPerCard),
            targetName: base[idx].targetName || String(o.targetName || '').trim(),
        };
        const next = base.slice();
        next[idx] = merged;
        return { cards: next, added: fresh.length, cardId: merged.id };
    }
    const card = {
        id: 'pch_' + nowMs + '_' + Math.random().toString(36).slice(2, 8),
        date,
        targetName: String(o.targetName || '').trim(),
        items: fresh.slice(0, PUNCH_LIMITS.maxItemsPerCard),
        createdAt: nowMs,
    };
    return { cards: normalizeCards([card, ...base]), added: fresh.length, cardId: card.id };
}

/** 按 **id** 定位并改一项（源按下标改 —— 见文件头偏离第 2 条）。返回 `{ cards, changed }`。 */
export function patchItem(cards, cardId, itemId, patch) {
    const base = normalizeCards(cards);
    const cid = String(cardId);
    const iid = String(itemId);
    let changed = 0;
    const next = base.map((c) => {
        if (c.id !== cid) return c;
        const items = c.items.map((it) => {
            if (it.id !== iid) return it;
            const o = (patch && typeof patch === 'object') ? patch : {};
            const merged = { ...it };
            if (o.done !== undefined) merged.done = o.done === true;
            if (o.remark !== undefined) merged.remark = String(o.remark || '').trim().slice(0, PUNCH_LIMITS.maxRemarkLen);
            changed += 1;
            return merged;
        });
        return { ...c, items };
    });
    return { cards: next, changed };
}

/** 勾选（patchItem 的便捷面）。 */
export function toggleItem(cards, cardId, itemId, done) {
    return patchItem(cards, cardId, itemId, { done: done === true });
}

/** 删除一张卡。返回 `{ cards, removed }`。 */
export function removeCard(cards, cardId) {
    const base = normalizeCards(cards);
    const cid = String(cardId);
    const kept = base.filter((c) => c.id !== cid);
    return { cards: kept, removed: base.length - kept.length };
}

/** 删掉卡里的一项。返回 `{ cards, removed }`。 */
export function removeItem(cards, cardId, itemId) {
    const base = normalizeCards(cards);
    const cid = String(cardId);
    const iid = String(itemId);
    let removed = 0;
    const next = base.map((c) => {
        if (c.id !== cid) return c;
        const items = c.items.filter((it) => {
            if (it.id === iid) { removed += 1; return false; }
            return true;
        });
        return { ...c, items };
    });
    return { cards: next, removed };
}

/**
 * 连续打卡天数。口径（见文件头偏离第 3 条，本条是**本件的加法**）：
 *   以最近一张卡的日期为起点，逐日回退，日键必须**恰好存在**（不得跳日）；
 *   最近卡距今超过 1 天 ⇒ 已断，返回 0。
 * 无卡 ⇒ 0。
 */
export function streakOf(cards, now) {
    const base = normalizeCards(cards);
    if (!base.length) return 0;
    const t = numOrNull(now);
    const today = dayKey(t === null ? Date.now() : t);
    const newest = base[0].date;
    if (!newest || !today) return 0;
    const gapOk = newest === today || newest === shiftDayKey(today, -1);
    if (!gapOk) return 0;
    const have = new Set(base.map((c) => c.date));
    let n = 0;
    let cur = newest;
    while (cur && have.has(cur)) { n += 1; cur = shiftDayKey(cur, -1); }
    return n;
}

/** 投影（读数）。读不到就如实给 0 / null，**不编数**。 */
export function projectPunch(cards, now) {
    const base = normalizeCards(cards);
    const t = numOrNull(now);
    const nowMs = t === null ? Date.now() : Math.round(t);
    const today = dayKey(nowMs);
    const todayCard = base.find((c) => c.date === today) || null;
    let itemCount = 0;
    let doneCount = 0;
    for (const c of base) {
        itemCount += c.items.length;
        doneCount += c.items.filter((x) => x.done).length;
    }
    return {
        cardCount: base.length,
        todayKey: today,
        todayCardId: todayCard ? todayCard.id : '',
        todayItemCount: todayCard ? todayCard.items.length : 0,
        todayDoneCount: todayCard ? todayCard.items.filter((x) => x.done).length : 0,
        itemCount,
        doneCount,
        streak: streakOf(base, nowMs),
        latest: base.length ? base[0] : null,
        hasAny: base.length > 0,
    };
}

/** 归因：先判能不能读，再判读到了什么（与 focus / piggy / rgx 同纪律）。 */
export function readPunchFace(probe) {
    if (!probe || probe.storageOk === false) return PUNCH_REASONS.storage_absent;
    if (probe.hasCards !== true) return PUNCH_REASONS.empty;
    return PUNCH_REASONS.ready;
}

/** 今日未完成项（注入用）。 */
export function pendingItems(cards, now) {
    const base = normalizeCards(cards);
    const t = numOrNull(now);
    const today = dayKey(t === null ? Date.now() : t);
    const card = base.find((c) => c.date === today);
    if (!card) return [];
    return card.items.filter((x) => !x.done);
}

/**
 * 生成侧注入块。只给**事实**（今天几项 / 完成几项 / 连续几天 / 未完成明细），
 * 不给角色台词模板 —— 让模型自己决定要不要接话。
 */
export function punchPromptBlock(proj, settings, pending) {
    if (!settings || settings.injectToPrompt !== true) return '';
    if (!proj) return '';
    const parts = [];
    if (!proj.hasAny) return '';
    parts.push('【连续】' + proj.streak + ' 天');
    parts.push('【今天】' + proj.todayItemCount + ' 项 · 已完成 ' + proj.todayDoneCount + ' 项');
    const max = (settings && typeof settings.maxInjectItems === 'number') ? settings.maxInjectItems : 4;
    const list = Array.isArray(pending) ? pending : [];
    if (max > 0 && list.length) {
        const show = list.slice(0, max).map((x) => (x.at ? (x.at + ' ') : '') + x.label);
        parts.push('【还没做】' + show.join(' / ') + (list.length > max ? (' …等 ' + list.length + ' 项') : ''));
    }
    return '【系统·作息打卡】\n' + parts.join('\n');
}