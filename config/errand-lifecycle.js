/* ========================================================
 * config/errand-lifecycle.js — [v4.114.0 · R13-X7] 「这个月要处理的」状态机（纯函数）
 * --------------------------------------------------------
 * 【它治的缝】记账有账本、事务台有事、日历有日程，但没有任何一处表达**「欠着的事到点没办」**：
 *   房租到期、订阅续费、体检预约。这些东西的共同形态是「有时间点 + 到点没办会有后果」，
 *   而本仓现有四张表都不管时间推进：账本记已发生、事务台记阶段、日历记安排、待办入口记点击。
 *
 * 【本件只做三件事】
 *   ① 归一（`normalizeErrand` / `normalizeErrands`）：形状不对的当场剔，不自造一条顶上；
 *   ② 推进（`advanceErrands`）：拿**当下**去把到点的条目从 pending 推到 expired，并生成一条
 *      **后果事件**；本函数是纯函数，同一个输入两次跑结果逐字相同；
 *   ③ 记账（`readErrands` / `writeErrands`）：唯一一组存储读写口，与 affairs_v1 同规。
 *
 * 【三条不变量】
 *   ① **过期不自动扣钱**：consequence 只有 { kind, text, at, acked }，**没有金额格** ——
 *      没有金额格就没有任何一条路径能把「过期」悄悄变成「已扣款」；
 *   ② **判不了不动手**：dueAt 读不出或不合法 ⇒ 该条不参与推进（记 `bad-due`），
 *      不拿今天顶替（那会让一条本来没到期的条目立刻过期）；
 *   ③ **终结态不再推**：done / waived 已经是人的决定，任何时间推进都不许改写它们 ——
 *      自动把用户「不办」的条目推成「过期」，等于替他改主意。
 *
 * 【为什么 done 与 waived 分开】二者都能让条目离场，但一个是「办完了」一个是「决定不办」。
 *   压成一格，用户回头就分不清「我交过房租」与「我当时说不管了」—— 而这恰好是唯一需要说清的事。
 * ============================================================ */
'use strict';
import {
    ERRAND_STATES, ERRAND_WHY, ERRAND_LIMITS, ERRAND_APPS,
    ERRAND_KEY, ERRAND_CONSEQUENCE_KINDS, ERRAND_DEFAULT_CONSEQUENCE
} from './errand-terms.js';

const str = (v) => String(v == null ? '' : v).trim();
const cap = (v, n) => { const s = str(v); return s.length > n ? s.slice(0, n) : s; };

/** 日键（本地日期串）。**不引别的模块**：本件是叶子侧，跨模块取一个日期工具会让
 *   「口径件零 import」这条纪律在依赖链上失效（口径件 → 状态机 → 工具件，改一个牵三个）。 */
function p2(n) { return String(Number(n)).padStart(2, '0'); }
export function dateKeyOf(ms) {
    const n = Number(ms);
    if (!Number.isFinite(n) || n <= 0) return '';
    const d = new Date(n);
    if (!Number.isFinite(d.getTime())) return '';
    return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate());
}

/** 日键 → 当天 0 点的毫秒（**只能从日键反向算**，不从毫秒取整 —— 那条路会吃掉时区）。 */
export function dayStartOf(key) {
    const m = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/.exec(str(key));
    if (!m) return 0;
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    return Number.isFinite(d.getTime()) ? d.getTime() : 0;
}

/** 一条后果事件（**只读**形状；本项不执行任何动作）。 */
function normalizeConsequence(raw) {
    const c = (raw && typeof raw === 'object') ? raw : {};
    const kind = Object.prototype.hasOwnProperty.call(ERRAND_CONSEQUENCE_KINDS, str(c.kind))
        ? str(c.kind) : ERRAND_CONSEQUENCE_KINDS.none;
    return {
        kind: kind,
        text: cap(c.text, ERRAND_LIMITS.consequenceChars),
        at: str(c.at),
        acked: c.acked === true
    };
}

/**
 * 一条 errand 归一。
 * 形状不对 ⇒ 返回 null（调用方据此剔除并记账，**不自造一条顶上**）。
 */
export function normalizeErrand(raw) {
    const r = (raw && typeof raw === 'object') ? raw : null;
    if (!r) return null;
    const id = str(r.id);
    const title = cap(r.title, ERRAND_LIMITS.titleChars);
    if (!id || !title) return null;
    const dueAt = str(r.dueAt);
    const state = Object.prototype.hasOwnProperty.call(ERRAND_STATES, str(r.state))
        ? str(r.state) : ERRAND_STATES.unknown;
    const app = Object.prototype.hasOwnProperty.call(ERRAND_APPS, str(r.app)) ? str(r.app) : '';
    const receipts = Array.isArray(r.receipts)
        ? r.receipts.map((x) => ({ at: str(x && x.at), text: cap(x && x.text, ERRAND_LIMITS.consequenceChars) }))
            .filter((x) => x.text)
            .slice(-ERRAND_LIMITS.receipts)
        : [];
    return {
        id: id,
        title: title,
        dueAt: dueAt,
        app: app,
        state: state,
        /* 后果：没填也**不是没有后果**，故补默认值（remind）。 */
        consequence: normalizeConsequence(r.consequence || ERRAND_DEFAULT_CONSEQUENCE),
        receipts: receipts,
        createdAt: str(r.createdAt),
        updatedAt: str(r.updatedAt)
    };
}

/** 一批归一（剔坏条目 + 按上限截断；截断要能被调用方读到，故另给 count）。 */
export function normalizeErrands(list) {
    const arr = Array.isArray(list)
        ? list
        : (list && typeof list === 'object' && Array.isArray(list.items) ? list.items : []);
    const out = [];
    for (const raw of arr) {
        const one = normalizeErrand(raw);
        if (!one) continue;
        out.push(one);
        if (out.length >= ERRAND_LIMITS.errands) break;
    }
    return out;
}

/**
 * 推进：把到点的 pending 推成 expired，并挂一条后果事件。
 *
 * @param {Array} list 已有条目
 * @param {number} nowMs 剧情当下（由调用方取好；本件不读钟）
 * @returns {{list:Array, expired:Array, skipped:Array}}
 *   · `expired` 这一轮**新**过期的条目（界面据此提示，不重报）；
 *   · `skipped` 判不了而没推进的（dueAt 读不出 / 形态不对），逐条带 why ——
 *     **不静默跳过**：静默跳过会让用户以为「没事到点」，而真相是「判不了」。
 */
export function advanceErrands(list, nowMs) {
    const now = Number(nowMs);
    const out = { list: [], expired: [], skipped: [] };
    const src = normalizeErrands(list);
    if (!Number.isFinite(now) || now <= 0) {
        /* 读不到当下 ⇒ 一条都不推（拿今天顶替会让本来还有三天的条目立刻过期）。 */
        for (const e of src) {
            out.list.push(e);
            if (e.state === ERRAND_STATES.pending) {
                out.skipped.push({ id: e.id, why: ERRAND_WHY.badDue });
            }
        }
        return out;
    }
    const todayKey = dateKeyOf(now);
    for (const e of src) {
        /* 终结态不再推：done / waived 是人的决定，时间不许改写它。 */
        if (e.state === ERRAND_STATES.done || e.state === ERRAND_STATES.waived) {
            out.list.push(e);
            continue;
        }
        if (e.state === ERRAND_STATES.expired) { out.list.push(e); continue; }
        if (e.state !== ERRAND_STATES.pending) { out.list.push(e); continue; }
        const dueStart = dayStartOf(e.dueAt);
        if (!e.dueAt || !dueStart) {
            out.list.push(e);
            out.skipped.push({ id: e.id, why: e.dueAt ? ERRAND_WHY.badDue : ERRAND_WHY.noDue });
            continue;
        }
        /* 到期日**当天**还没过：只有严格早于今天才算过期（当天仍给用户一整天）。 */
        if (dueStart >= dayStartOf(todayKey)) { out.list.push(e); continue; }
        const next = Object.assign({}, e, {
            state: ERRAND_STATES.expired,
            updatedAt: todayKey,
            consequence: Object.assign({}, e.consequence, { at: e.dueAt })
        });
        out.list.push(next);
        out.expired.push(next);
    }
    return out;
}
