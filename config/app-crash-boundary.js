/* ============================================================
 * config/app-crash-boundary.js — 单 App 崩溃边界与自愈 [R25-X1]
 * ------------------------------------------------------------
 * 【治的欠账（先取证，再动手）】
 *   R25-X1 原文：「R24 自己写的『谁来兜住崩溃』至今无人接。一个 App 抛错 →
 *   整机白屏或静默失灵」。
 *   本轮取证（实读，不是推测）：
 *     · 全仓 `window.addEventListener('error'` / `'unhandledrejection'` **零命中**；
 *     · `index.js` 的 App 打开通路（`phone:openApp`）里，懒加载失败只做两件事：
 *       `console.error(...)` + `phoneShell.showNotification('错误', ...)`；
 *     · 也就是说：报错**进了控制台**，但没有「哪个 App、什么错、第几次、还能不能
 *       再打开」这四件事的回执，更没有「只重启这一个 App，桌面照旧可用」的动作。
 *
 * 【本模块是什么 / 不是什么】
 *   ✅ 是**边界内核**：记账 + 归一 + 重启预算 + 回执 + 三态。零依赖叶子（不 import
 *      任何东西）⇒ 宿主、诊断页、测试都能引用而不成环。
 *   ❌ **不是**错误上报服务：不联网、不写 storage、不吞异常。边界只做两件事：
 *      把「谁挂了」说清；把「还救不救」判明。救不救得了是宿主（restarter）的事。
 *
 * 【三态必须分得开（本仓最贵的错读数形态：把「读不到」冒充「很快」同族）】
 *   · `restarted` —— 重启动作真的跑了，且宿主返回了「重开了」的凭证；
 *   · `absent`    —— **没有 restarter**（或 restarter 自己抛了）：如实说「没能重启」，
 *                   绝不因为「异常被 catch 住了」就报成功；
 *   · `refused`   —— 重启预算用尽：转入人工（degraded），不再自动重试（防重启风暴）；
 *   · `duplicate` —— 同签名同窗的重复崩溃：**不再重启**，只累计次数（防死循环）。
 *
 * 【为什么要「同签名同窗不重复重启」】
 *   一个 App 只要在 render 里稳定抛错，重启就会立刻再崩：不设这条，边界会变成
 *   一台重启风暴制造机（每帧一次）。签名取 `kind|name|message前80字`，
 *   窗口默认 60s —— 同因复发在窗内只算一次重启尝试。
 *
 * 用法（调用侧只有四个动词，全部不抛）：
 *   const boundary = createCrashBoundary({ restart: (crash) => { ...开门禁... } });
 *   boundary.guard('wechat', () => app.render());          // 同步或返回 Promise 均可
 *   boundary.report(err, { appId: 'wechat', kind: 'load-failed' });
 *   boundary.receiptOf('wechat') / boundary.state() / boundary.line()
 * ============================================================ */

/** 崩溃类别闭集（不在这四个里的，按 uncaught-error 记，不编新类）。 */
export const CRASH_KINDS = Object.freeze([
    'load-failed',
    'render-threw',
    'uncaught-error',
    'unhandled-rejection'
]);

/** 消息保留上限：够诊断，不够塞满上下文。 */
export const MAX_MESSAGE = 200;

/** 默认重启预算：同一 App 最多自动重启 2 次；同签同窗内不重复重启。 */
export const DEFAULT_MAX_RESTARTS = 2;

/** 同签名去重窗口。 */
export const DEFAULT_CRASH_WINDOW_MS = 60000;

/** 事件留存上限（诊断面只看最近这些；溢出只计数不丢账）。 */
export const MAX_EVENTS = 50;

/** 取一条消息（任何形状都不抛；null/undefined ⇒ 空串，不编「未知错误」）。 */
function messageOf(err) {
    if (err == null) return '';
    if (typeof err === 'string') return err;
    try {
        if (typeof err.message === 'string') return err.message;
        const s = String(err);
        return s === '[object Object]' ? '' : s;
    } catch (_e) { return ''; }
}

/** 取错误名（Error 实例走 name；非 Error 如实标 NonError）。 */
function nameOf(err) {
    try {
        if (err && typeof err.name === 'string' && err.name) return err.name;
    } catch (_e) { /* 取不到就当 NonError */ }
    return 'NonError';
}

/**
 * 归一一条崩溃。**绝不抛**：宿主可能在错误处理里再抛一次（那才是真白屏）。
 *
 * @param {*} err 任意形状的错误（Error / {message} / string / null）
 * @param {{appId?:string, kind?:string, at?:number}} [meta]
 * @returns {{kind:string, name:string, message:string, truncated:boolean,
 *            appId:string, at:(number|null), signature:string}}
 */
export function normalizeCrash(err, meta) {
    const m = (meta && typeof meta === 'object') ? meta : {};
    const raw = messageOf(err);
    const truncated = raw.length > MAX_MESSAGE;
    const message = truncated ? raw.slice(0, MAX_MESSAGE) + '…' : raw;
    const name = nameOf(err);
    const kind = (typeof m.kind === 'string' && CRASH_KINDS.indexOf(m.kind) >= 0)
        ? m.kind
        : 'uncaught-error';
    /* appId 不编造：没有就是空串（诊断面据此渲染「整机级」而不是「某个 App」）。 */
    const appId = (typeof m.appId === 'string') ? m.appId : '';
    const at = (typeof m.at === 'number' && Number.isFinite(m.at)) ? m.at : null;
    return {
        kind: kind,
        name: name,
        message: message,
        truncated: truncated,
        appId: appId,
        at: at,
        /* 签名只取前 80 字：同一行代码抛的同一个错，措辞里的 id/行号漂移不该
         * 变成「新错误」从而绕过重启预算。 */
        signature: kind + '|' + name + '|' + raw.slice(0, 80)
    };
}

/**
 * 建一个崩溃边界。
 *
 * @param {{restart?:(crash:Object)=>*, now?:()=>number,
 *          maxRestarts?:number, windowMs?:number, onCrash?:(receipt:Object)=>void}} [opts]
 */
export function createCrashBoundary(opts) {
    const o = (opts && typeof opts === 'object') ? opts : {};
    const restarter = (typeof o.restart === 'function') ? o.restart : null;
    const nowFn = (typeof o.now === 'function') ? o.now : () => Date.now();
    const maxRestarts = (typeof o.maxRestarts === 'number' && Number.isFinite(o.maxRestarts) && o.maxRestarts >= 0)
        ? Math.floor(o.maxRestarts)
        : DEFAULT_MAX_RESTARTS;
    const windowMs = (typeof o.windowMs === 'number' && Number.isFinite(o.windowMs) && o.windowMs >= 0)
        ? o.windowMs
        : DEFAULT_CRASH_WINDOW_MS;
    const onCrash = (typeof o.onCrash === 'function') ? o.onCrash : null;

    /** appId（全局错误用 '' 键）→ 记账。 */
    const apps = new Map();
    const events = [];
    let total = 0;

    function readNow() {
        try {
            const n = nowFn();
            return Number.isFinite(n) ? n : null;
        } catch (_e) { return null; }
    }

    function recOf(appId) {
        let rec = apps.get(appId);
        if (!rec) {
            rec = { appId: appId, count: 0, restarts: 0, lastAt: null, lastKind: '', degraded: false, lastSignature: '' };
            apps.set(appId, rec);
        }
        return rec;
    }

    /**
     * 记账并判定「还救不救」。返回回执（永不抛）。
     */
    function report(err, meta) {
        const at = readNow();
        const crash = normalizeCrash(err, Object.assign({}, meta, { at: at }));
        const rec = recOf(crash.appId);
        rec.count += 1;
        total += 1;
        rec.lastAt = at;
        rec.lastKind = crash.kind;

        let restart = 'absent';
        let why = '';
        /* 同签同窗的复发判定：取「上一次**同签名**时刻」，不是 lastAt（刚被覆盖）。 */
        const sigSeenAt = (rec.sigAt instanceof Map) ? rec.sigAt.get(crash.signature) : undefined;
        const sameSignatureInWindow = typeof sigSeenAt === 'number' && at !== null
            && (at - sigSeenAt) <= windowMs;
        if (restarter === null) {
            restart = 'absent';
            why = 'no-restarter';
        } else if (rec.restarts >= maxRestarts) {
            restart = 'refused';
            why = 'budget-exhausted';
            rec.degraded = true;
        } else if (sameSignatureInWindow && rec.lastSignature === crash.signature) {
            restart = 'duplicate';
            why = 'same-signature-in-window';
        } else {
            try {
                const r = restarter(crash);
                /* 宿主返回 falsy ⇒ 没重开（必须如实说 absent，不能因为「调用没抛」就当成功）。 */
                if (r) {
                    restart = 'restarted';
                    rec.restarts += 1;
                } else {
                    restart = 'absent';
                    why = 'restarter-declined';
                }
            } catch (e) {
                restart = 'absent';
                why = 'restarter-threw:' + nameOf(e);
            }
        }
        rec.lastSignature = crash.signature;
        if (!(rec.sigAt instanceof Map)) rec.sigAt = new Map();
        if (at !== null) rec.sigAt.set(crash.signature, at);

        const receipt = {
            appId: crash.appId,
            kind: crash.kind,
            name: crash.name,
            message: crash.message,
            truncated: crash.truncated,
            at: at,
            attempts: rec.count,
            restarts: rec.restarts,
            restart: restart,
            why: why,
            degraded: rec.degraded,
            signature: crash.signature
        };
        events.push(receipt);
        while (events.length > MAX_EVENTS) {
            const dropped = events.shift();
            void dropped;
        }
        if (onCrash) {
            try { onCrash(receipt); } catch (_e) { /* 旁路回调不得再制造一次崩溃 */ }
        }
        return receipt;
    }

    return {
        report: report,
        /**
         * 包一段可能抛错的活。同步原样返回 `{ok:true, value}`；异步返回
         * Promise 且**永不 reject**（reject 会让调用链再崩一次）。
         * 失败时回执挂在 `{ok:false, crash}` 上 —— 调用方可以据此说人话。
         */
        guard(appId, fn, meta) {
            const base = Object.assign({}, meta, { appId: String(appId == null ? '' : appId) });
            if (typeof fn !== 'function') {
                return { ok: false, crash: report(new TypeError('guard 需要一个函数'), Object.assign({}, base, { kind: 'uncaught-error' })) };
            }
            let out;
            try {
                out = fn();
            } catch (e) {
                return { ok: false, crash: report(e, Object.assign({}, base, { kind: base.kind || 'render-threw' })) };
            }
            if (out && typeof out.then === 'function') {
                return Promise.resolve(out).then(
                    (value) => ({ ok: true, value: value }),
                    (e) => ({ ok: false, crash: report(e, Object.assign({}, base, { kind: base.kind || 'render-threw' })) })
                );
            }
            return { ok: true, value: out };
        },
        receiptOf(appId) {
            const key = String(appId == null ? '' : appId);
            const rec = apps.get(key);
            if (!rec) return null;
            return {
                appId: key, count: rec.count, restarts: rec.restarts,
                lastAt: rec.lastAt, lastKind: rec.lastKind, degraded: rec.degraded
            };
        },
        state() {
            const list = [...apps.values()].map((r) => ({
                appId: r.appId, count: r.count, restarts: r.restarts,
                lastAt: r.lastAt, lastKind: r.lastKind, degraded: r.degraded
            })).sort((a, b) => b.count - a.count || a.appId.localeCompare(b.appId));
            return {
                total: total,
                apps: list,
                degraded: list.filter((r) => r.degraded).map((r) => r.appId),
                restarter: restarter === null ? 'absent' : 'ok',
                maxRestarts: maxRestarts,
                windowMs: windowMs,
                events: events.slice(),
                overflow: Math.max(0, total - events.length)
            };
        },
        reset() {
            apps.clear();
            events.length = 0;
            total = 0;
        }
    };
}

/** 一行回执（日志与诊断卡共用同一实现；三态各有各的说法）。 */
export function crashLine(receipt) {
    const r = (receipt && typeof receipt === 'object') ? receipt : null;
    if (!r) return '崩溃：无回执';
    const who = r.appId ? r.appId : '整机级';
    const head = '崩溃：' + who + ' · ' + (r.kind || 'uncaught-error') + ' · ' + (r.name || 'NonError')
        + ' · 第 ' + (r.attempts || 1) + ' 次';
    const tail = {
        restarted: '已重启（该 App 第 ' + (r.restarts || 1) + ' 次）',
        absent: '**没能重启**（' + (r.why || 'no-restarter') + '）—— 需要人工看',
        refused: '**不再自动重启**（预算用尽）—— 转人工',
        duplicate: '同因复发不再重启（' + (r.why || 'same-signature-in-window') + '）'
    }[r.restart] || ('重启态未知（' + (r.restart || 'undefined') + '）');
    return head + ' · ' + tail;
}
