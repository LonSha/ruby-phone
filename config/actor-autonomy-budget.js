/**
 * config/actor-autonomy-budget.js — R24-X7 角色自主行为预算（v4.158.0）
 *
 * 【治的欠债】
 *   本仓到 R23 为止的所有桥都是「记录 AI 说了什么 / 推断当前状态」，
 *   **没有一个让角色自己做事**：主动发一条消息、发个朋友圈、改个状态、拒接电话。
 *   而「拟真手机」最像手机的那一刻，恰恰是**手机自己会动**。
 *   但「会动」不能是随机乱动 —— 必须有预算、有静默规则、有可回源的回执，否则用户只会关掉它。
 *
 * 【四态不塌（本仓最贵的老账）】
 *   `allowed`     可以动，且给出 `remaining`
 *   `suppressed`  此刻**不该动**（夜间 / 勿扰 / 连续未回），原因码逐条不同形
 *   `exhausted`   预算用尽（**不是** suppressed：一个是「这会儿不合适」，一个是「今天够了」）
 *   `disabled`    用户关停了（**不是** exhausted：关停是意愿，用尽是额度）
 *   四者处置相反：suppressed 等下一时段，exhausted 等下一窗口，disabled 等用户开回来。
 *
 * 【可回源铁律】
 *   每一次真动作都必须带 `factRef`（依据哪条事实）与 `rule`（命中哪条规则）。
 *   缺 `factRef` ⇒ 直接拒收（`no-fact-ref`），不许出现「AI 觉得」这种无源行为。
 *   这与 R24-X1 的事实通道是同一条链：X1 供值，X7 消费值并留回执。
 *
 * 【纪律】
 *   纯函数式内核 + 显式注入时间与上下文（`nowMs` / `minuteOfDay` / `unansweredCount`），
 *   不读系统时钟、不碰 DOM、不写 storage、不新起模型调用（模型调用归宿主生成侧）。
 */
import { numOrNull } from './num-gate.js';

/** 五类自主行为（词表唯一；界面按名渲染，不许折叠成「动作」） */
export const AUTONOMY_ACTIONS = Object.freeze({
    SEND_MESSAGE: 'send_message',
    POST_MOMENT: 'post_moment',
    CHANGE_STATUS: 'change_status',
    REJECT_CALL: 'reject_call',
    SET_REMINDER: 'set_reminder'
});

/** 四态（每一态都要能被判据区分，否则这层等于没说） */
export const AUTONOMY_FACES = Object.freeze({
    ALLOWED: 'allowed',
    SUPPRESSED: 'suppressed',
    EXHAUSTED: 'exhausted',
    DISABLED: 'disabled'
});

/** 静默原因码（逐条不同形；界面各说各的话） */
export const AUTONOMY_SUPPRESS_REASONS = Object.freeze({
    QUIET_HOURS: 'quiet-hours',
    DND: 'dnd',
    NO_REPLY: 'no-reply'
});

const DEFAULT_LIMITS = Object.freeze({
    send_message: 3,
    post_moment: 1,
    change_status: 2,
    reject_call: 1,
    set_reminder: 2
});

const DEFAULT_AUTONOMY_WINDOW_MS = 3600000;      // 一小时窗口
const DEFAULT_UNANSWERED_LIMIT = 3;     // 连续三条没回就闭嘴
const DEFAULT_QUIET = Object.freeze({ from: 23 * 60, to: 7 * 60 }); // 23:00–07:00

/** 分钟数是否落在静默区间（支持跨零点区间）。 */
export function inQuietHours(minuteOfDay, quiet) {
    const m = numOrNull(minuteOfDay);
    const q = (quiet && typeof quiet === 'object') ? quiet : DEFAULT_QUIET;
    const from = numOrNull(q.from);
    const to = numOrNull(q.to);
    if (m === null || from === null || to === null) return false;
    const mm = ((m % 1440) + 1440) % 1440;
    if (from === to) return false;
    return from < to ? (mm >= from && mm < to) : (mm >= from || mm < to);
}

/**
 * 建一份自主预算表（一次会话一份）。
 * @param {{enabled?:boolean, limits?:object, windowMs?:number,
 *          unansweredLimit?:number, quiet?:{from:number,to:number}, receiptCap?:number}} [opts]
 */
export function createAutonomyBudget(opts) {
    const o = (opts && typeof opts === 'object') ? opts : {};
    let enabled = o.enabled !== false;
    const windowOpt = numOrNull(o.windowMs);
    const windowMs = windowOpt === null ? DEFAULT_AUTONOMY_WINDOW_MS : windowOpt;
    const unansweredOpt = numOrNull(o.unansweredLimit);
    const unansweredLimit = unansweredOpt === null ? DEFAULT_UNANSWERED_LIMIT : unansweredOpt;
    const quiet = (o.quiet && typeof o.quiet === 'object') ? o.quiet : DEFAULT_QUIET;
    const capOpt = numOrNull(o.receiptCap);
    const cap = capOpt === null ? 128 : capOpt;
    const limits = Object.assign({}, DEFAULT_LIMITS);
    if (o.limits && typeof o.limits === 'object') {
        for (const k of Object.keys(DEFAULT_LIMITS)) {
            const v = numOrNull(o.limits[k]);
            if (v !== null) limits[k] = v;
        }
    }
    /** 已用记录：[{action, atMs}] */
    let used = [];
    const receipts = [];

    function prune(nowMs) {
        const now = numOrNull(nowMs);
        if (now === null) return;
        used = used.filter((r) => (now - r.atMs) <= windowMs);
    }

    function usedOf(action, nowMs) {
        prune(nowMs);
        let n = 0;
        for (const r of used) if (r.action === action) n++;
        return n;
    }

    /**
     * 判一次「能不能动」。**只判不动**（不占额度），动完由 `record` 落账。
     * @param {string} action AUTONOMY_ACTIONS 之一
     * @param {{nowMs?:number, minuteOfDay?:number, dnd?:boolean, unansweredCount?:number, factRef?:string}} ctx
     */
    function canAct(action, ctx) {
        const c = (ctx && typeof ctx === 'object') ? ctx : {};
        const act = String(action || '');
        const base = { action: act, face: AUTONOMY_FACES.DISABLED, reason: '', limit: 0, used: 0, remaining: 0, factRef: '' };
        if (!Object.prototype.hasOwnProperty.call(limits, act)) {
            return Object.assign(base, { face: AUTONOMY_FACES.DISABLED, reason: 'unknown-action' });
        }
        if (!enabled) return Object.assign(base, { reason: 'user-disabled' });
        const limit = limits[act];
        const usedN = usedOf(act, c.nowMs);
        const remaining = Math.max(0, limit - usedN);
        /* 静默优先于额度：今晚不该开口，说「额度还够」是误导。 */
        if (inQuietHours(c.minuteOfDay, quiet)) {
            return Object.assign(base, {
                face: AUTONOMY_FACES.SUPPRESSED, reason: AUTONOMY_SUPPRESS_REASONS.QUIET_HOURS,
                limit, used: usedN, remaining
            });
        }
        if (c.dnd === true) {
            return Object.assign(base, {
                face: AUTONOMY_FACES.SUPPRESSED, reason: AUTONOMY_SUPPRESS_REASONS.DND,
                limit, used: usedN, remaining
            });
        }
        const unans = numOrNull(c.unansweredCount);
        if (unans !== null && unans >= unansweredLimit) {
            return Object.assign(base, {
                face: AUTONOMY_FACES.SUPPRESSED, reason: AUTONOMY_SUPPRESS_REASONS.NO_REPLY,
                limit, used: usedN, remaining
            });
        }
        if (remaining <= 0) {
            return Object.assign(base, {
                face: AUTONOMY_FACES.EXHAUSTED, reason: 'budget-exhausted', limit, used: usedN, remaining: 0
            });
        }
        return Object.assign(base, {
            face: AUTONOMY_FACES.ALLOWED, reason: 'ok', limit, used: usedN, remaining, factRef: String(c.factRef || '')
        });
    }

    /**
     * 落一次真动作（占额度 + 留回执）。`factRef` 为空一律拒收 —— 无源行为不许入账。
     * @returns {{ok:boolean, face:string, reason:string, rule:string, remaining:number, receipt:object|null}}
     */
    function record(action, ctx) {
        const c = (ctx && typeof ctx === 'object') ? ctx : {};
        const act = String(action || '');
        const factRef = String(c.factRef || '');
        if (!factRef) {
            return { ok: false, face: 'rejected', reason: 'no-fact-ref', rule: '', remaining: 0, receipt: null };
        }
        const decision = canAct(act, c);
        if (decision.face !== AUTONOMY_FACES.ALLOWED) {
            return {
                ok: false, face: decision.face, reason: decision.reason,
                rule: decision.face === AUTONOMY_FACES.SUPPRESSED ? ('suppress:' + decision.reason) : ('limit:' + act),
                remaining: decision.remaining, receipt: null
            };
        }
        const now = numOrNull(c.nowMs);
        used.push({ action: act, atMs: now === null ? 0 : now });
        const receipt = {
            action: act,
            factRef,
            rule: 'autonomy:' + act,
            atMs: now,
            remaining: decision.remaining - 1
        };
        receipts.push(receipt);
        while (receipts.length > cap) receipts.shift();
        return { ok: true, face: AUTONOMY_FACES.ALLOWED, reason: 'ok', rule: receipt.rule, remaining: receipt.remaining, receipt };
    }

    /** 用户关停 / 开回（关停是意愿，不是额度：与 exhausted 不同形）。 */
    function setEnabled(next) {
        enabled = next === true;
        return { ok: true, enabled };
    }

    function snapshotAt(nowMs) {
        prune(nowMs);
        const rows = [];
        for (const act of Object.keys(limits)) {
            const usedN = usedOf(act, nowMs);
            rows.push({ action: act, limit: limits[act], used: usedN, remaining: Math.max(0, limits[act] - usedN) });
        }
        return { enabled, windowMs, unansweredLimit, quiet: Object.assign({}, quiet), rows };
    }

    function describe() {
        return {
            actions: Object.keys(limits).map((k) => ({ action: k, limit: limits[k] })),
            windowMs, unansweredLimit,
            quiet: Object.assign({}, quiet),
            enabled
        };
    }

    function receiptLog() {
        return receipts.slice();
    }

    return { canAct, record, setEnabled, snapshotAt, describe, receiptLog };
}

/**
 * 装配点自检：四态、五个原因码、可回源铁律、额度窗口都真跑一遍。
 * @returns {{ok:boolean, bad:string[], sample:string}}
 */
export function actorAutonomySelfCheck() {
    const bad = [];
    const b = createAutonomyBudget({ limits: { send_message: 2 }, windowMs: 1000, unansweredLimit: 3 });
    /* 白天、有事实依据 ⇒ allowed */
    const a1 = b.canAct(AUTONOMY_ACTIONS.SEND_MESSAGE, { nowMs: 0, minuteOfDay: 600, factRef: 'fact:unread' });
    if (a1.face !== AUTONOMY_FACES.ALLOWED || a1.remaining !== 2) bad.push('allowed');
    /* 夜间 ⇒ suppressed + quiet-hours（不是 exhausted） */
    const a2 = b.canAct(AUTONOMY_ACTIONS.SEND_MESSAGE, { nowMs: 0, minuteOfDay: 2 * 60 });
    if (a2.face !== AUTONOMY_FACES.SUPPRESSED || a2.reason !== AUTONOMY_SUPPRESS_REASONS.QUIET_HOURS) bad.push('quiet-hours');
    /* 勿扰 ⇒ suppressed + dnd */
    const a3 = b.canAct(AUTONOMY_ACTIONS.SEND_MESSAGE, { nowMs: 0, minuteOfDay: 600, dnd: true });
    if (a3.reason !== AUTONOMY_SUPPRESS_REASONS.DND) bad.push('dnd');
    /* 连续未回 ⇒ suppressed + no-reply */
    const a4 = b.canAct(AUTONOMY_ACTIONS.SEND_MESSAGE, { nowMs: 0, minuteOfDay: 600, unansweredCount: 3 });
    if (a4.reason !== AUTONOMY_SUPPRESS_REASONS.NO_REPLY) bad.push('no-reply');
    /* 无事实依据 ⇒ record 拒收（可回源铁律） */
    const r0 = b.record(AUTONOMY_ACTIONS.SEND_MESSAGE, { nowMs: 0, minuteOfDay: 600 });
    if (r0.ok || r0.reason !== 'no-fact-ref') bad.push('no-fact-ref');
    /* 两次占满 ⇒ exhausted（与 suppressed 不同形） */
    const r1 = b.record(AUTONOMY_ACTIONS.SEND_MESSAGE, { nowMs: 0, minuteOfDay: 600, factRef: 'fact:a' });
    const r2 = b.record(AUTONOMY_ACTIONS.SEND_MESSAGE, { nowMs: 10, minuteOfDay: 600, factRef: 'fact:b' });
    if (!r1.ok || !r2.ok || r2.remaining !== 0) bad.push('record:two');
    const a5 = b.canAct(AUTONOMY_ACTIONS.SEND_MESSAGE, { nowMs: 20, minuteOfDay: 600, factRef: 'x' });
    if (a5.face !== AUTONOMY_FACES.EXHAUSTED) bad.push('exhausted');
    /* 窗口滑过后额度回来 */
    const a6 = b.canAct(AUTONOMY_ACTIONS.SEND_MESSAGE, { nowMs: 5000, minuteOfDay: 600, factRef: 'x' });
    if (a6.face !== AUTONOMY_FACES.ALLOWED || a6.remaining !== 2) bad.push('window-slide');
    /* 用户关停 ⇒ disabled（不是 exhausted） */
    b.setEnabled(false);
    const a7 = b.canAct(AUTONOMY_ACTIONS.SEND_MESSAGE, { nowMs: 5000, minuteOfDay: 600, factRef: 'x' });
    if (a7.face !== AUTONOMY_FACES.DISABLED) bad.push('disabled');
    /* 回执可回源 */
    const log = b.receiptLog();
    if (log.length !== 2 || !log[0].factRef || !log[0].rule) bad.push('receipt:shape');
    const snap = b.snapshotAt(5000);
    if (snap.rows[0].used !== 0) bad.push('snapshot:prune');
    const okQuiet = inQuietHours(2 * 60, DEFAULT_QUIET) === true && inQuietHours(600, DEFAULT_QUIET) === false;
    if (!okQuiet) bad.push('quiet:boundary');
    return {
        ok: bad.length === 0,
        bad,
        sample: 'actions=' + Object.keys(DEFAULT_LIMITS).length + ' receipts=' + log.length
    };
}

export default {
    AUTONOMY_ACTIONS,
    AUTONOMY_FACES,
    AUTONOMY_SUPPRESS_REASONS,
    inQuietHours,
    createAutonomyBudget,
    actorAutonomySelfCheck
};