/* ========================================================
 * config/errand-actions.js — [v4.114.0 · R13-X7] 清单上那四个动作（真写面的唯一入口）
 * --------------------------------------------------------
 * 【为何与状态机分开】`config/errand-lifecycle.js` 只答「时间推过之后它变成什么」——
 *   那是**不带人**的判定，必须能被同一份输入重跑出同一结果（判据就是这么复跑的）。
 *   本件答「人点了一下之后它变成什么」，每一次都带时刻与回执。两件事混在一件里，
 *   改判据就得连人的动作一起读，而人的动作恰恰是最容易改的一块。
 *
 * 【四个动作，四条不许含糊的边界】
 *   ① 办掉：只从 pending 办；重复点不给第二条回执（否则用户以为办了两次）；
 *      **过期的条目不许直接「办掉」** —— 那是错过，得先承认后果再补办，两件事分开记。
 *   ② 豁免：pending / expired 都能豁免；已办的不许豁免（把「办过」改成「不办」是改历史）。
 *   ③ 承认后果：**只改一个布尔**。不扣钱、不销条目、不改状态 ——
 *      承认是「我知道这事黄了」，办掉是「我把事做了」，二者不可互换。
 *   ④ 新建：到期日与去处都必填 —— 写不出这两格的条目就是一条永远不动的摆设。
 *
 * 【全部返回 { ok, why, list }】why 取词表值（不抛、不自造新词）；调用方据此展示，不猜。
 * ============================================================ */
'use strict';
import {
    ERRAND_STATES, ERRAND_WHY, ERRAND_LIMITS, ERRAND_APPS, ERRAND_DEFAULT_CONSEQUENCE
} from './errand-terms.js';
import { normalizeErrand, normalizeErrands, dateKeyOf, dayStartOf } from './errand-lifecycle.js';

const str = (v) => String(v == null ? '' : v).trim();
const cap = (v, n) => { const s = str(v); return s.length > n ? s.slice(0, n) : s; };

/** 改写一条（找到才改；找不到如实报 not-found，不新建一条顶上）。 */
function replaceOne(list, id, patch) {
    const arr = list.slice();
    const i = arr.findIndex((e) => e.id === id);
    if (i < 0) return null;
    arr[i] = Object.assign({}, arr[i], patch);
    return arr;
}

/**
 * 办掉：pending → done，并留一条回执（回执是本项「办完看得见」的全部凭据）。
 *   done 后**不能重复办**（重复点两次会写出两条回执，用户会以为办了两次）。
 */
export function markErrandDone(list, id, atMs, note) {
    const key = str(id);
    const src = normalizeErrands(list);
    if (!key) return { ok: false, why: ERRAND_WHY.noId, list: src };
    const one = src.find((e) => e.id === key);
    if (!one) return { ok: false, why: ERRAND_WHY.notFound, list: src };
    if (one.state === ERRAND_STATES.done) return { ok: false, why: ERRAND_WHY.alreadyDone, list: src };
    if (one.state === ERRAND_STATES.expired) return { ok: false, why: ERRAND_WHY.alreadyExpired, list: src };
    if (one.state !== ERRAND_STATES.pending) return { ok: false, why: ERRAND_WHY.notPending, list: src };
    const at = dateKeyOf(atMs);
    const next = replaceOne(src, key, {
        state: ERRAND_STATES.done,
        updatedAt: at,
        receipts: one.receipts.concat([{ at: at, text: cap(note || '已办掉', ERRAND_LIMITS.consequenceChars) }])
    });
    return { ok: true, why: ERRAND_WHY.ok, list: next };
}

/**
 * 豁免：pending / expired → waived（用户说「这事不办」）。
 *   与「过期」分开：一个是错过了，一个是我决定不管，**处置相反**（一个能补、一个不该再提）。
 */
export function waiveErrand(list, id, atMs, note) {
    const key = str(id);
    const src = normalizeErrands(list);
    if (!key) return { ok: false, why: ERRAND_WHY.noId, list: src };
    const one = src.find((e) => e.id === key);
    if (!one) return { ok: false, why: ERRAND_WHY.notFound, list: src };
    if (one.state === ERRAND_STATES.done) return { ok: false, why: ERRAND_WHY.alreadyDone, list: src };
    if (one.state !== ERRAND_STATES.pending && one.state !== ERRAND_STATES.expired) {
        return { ok: false, why: ERRAND_WHY.notPending, list: src };
    }
    const at = dateKeyOf(atMs);
    const next = replaceOne(src, key, {
        state: ERRAND_STATES.waived,
        updatedAt: at,
        receipts: one.receipts.concat([{ at: at, text: cap(note || '决定不办', ERRAND_LIMITS.consequenceChars) }])
    });
    return { ok: true, why: ERRAND_WHY.ok, list: next };
}

/**
 * 承认后果（expired 的 consequence.acked = true）。
 *   **只改一个布尔**：不扣钱、不销条目、不改状态 —— 承认与办掉是两件事。
 */
export function ackConsequence(list, id) {
    const key = str(id);
    const src = normalizeErrands(list);
    if (!key) return { ok: false, why: ERRAND_WHY.noId, list: src };
    const one = src.find((e) => e.id === key);
    if (!one) return { ok: false, why: ERRAND_WHY.notFound, list: src };
    if (one.state !== ERRAND_STATES.expired) return { ok: false, why: ERRAND_WHY.notPending, list: src };
    const next = replaceOne(src, key, {
        consequence: Object.assign({}, one.consequence, { acked: true })
    });
    return { ok: true, why: ERRAND_WHY.ok, list: next };
}

/** 新增一条（dueAt / app 必填：写不出到期日与去处的条目，就是一条永远不动的摆设）。 */
export function createErrand(list, raw, nowMs) {
    const r = (raw && typeof raw === 'object') ? raw : {};
    const src = normalizeErrands(list);
    const title = cap(r.title, ERRAND_LIMITS.titleChars);
    const dueAt = str(r.dueAt);
    const app = str(r.app);
    if (!title) return { ok: false, why: ERRAND_WHY.noTitle, list: src };
    if (!dueAt) return { ok: false, why: ERRAND_WHY.noDue, list: src };
    if (!dayStartOf(dueAt)) return { ok: false, why: ERRAND_WHY.badDue, list: src };
    if (!Object.prototype.hasOwnProperty.call(ERRAND_APPS, app)) {
        return { ok: false, why: ERRAND_WHY.badShape, list: src };
    }
    const id = 'er_' + (dateKeyOf(nowMs) || 'x') + '_' + String(src.length + 1);
    const one = normalizeErrand({
        id: id, title: title, dueAt: dueAt, app: app,
        state: ERRAND_STATES.pending, createdAt: dateKeyOf(nowMs),
        consequence: r.consequence || ERRAND_DEFAULT_CONSEQUENCE
    });
    if (!one) return { ok: false, why: ERRAND_WHY.badShape, list: src };
    return { ok: true, why: ERRAND_WHY.ok, list: src.concat([one]).slice(-ERRAND_LIMITS.errands), errand: one };
}

