/* ========================================================
 * config/background-queue.js —— 有界后台队列与受限并发
 * --------------------------------------------------------
 * 缝合自 memory-plugin-research/stbme/runtime/concurrency.js
 *   （ST-BME 的后台维护队列：满队 drop 并计数、attempts 线性退避、
 *    AbortError 单独终止不重试、snapshot 四态、runLimited 三档模式）。
 *
 * 【本仓修前是什么样（两处真缺陷，都不是崩）】
 *   ① `config/worldbook-manager.js` 的 `listAvailableWorldbooks({includeEntries:true})`
 *      用 `Promise.all(books.map(_loadWorldContent))` —— **多少本书就同时打多少次读**，
 *      没有上限。世界书多的用户一次刷列表就是几十路并发，先到的先消耗、
 *      后到的全挤在连接池里排队；更糟的是 `renderWorldbookSelector` 每帧都可能刷。
 *   ② `writeMemoryEntries` 是「读→合并→写」三步，**全程没有互斥**。两次写入同一本书
 *      并发时，双方都读到同一份旧条目表，各自合并后各自整表回写 ⇒
 *      **后写的那次把前一次的新增整批覆盖掉**（`mergeEntries` 只保证单次合并正确，
 *      挡不住两个合并结果互相覆盖）。而症状是「写了两条，只剩一条」，不报错。
 *
 * 【本件给什么（逐条对应源）】
 *   · `runLimited(items, worker, {concurrency, preserveOrder, failFast, signal})`：
 *     有界并发执行，结果按原下标回收（`preserveOrder`），`AbortError` 一律穿透；
 *   · `createBoundedQueue({maxItems, maxRetries, retryBaseMs})`：
 *     满队不进队而是**丢并计数**（`dropped += 1` 且回 `reason`），
 *     `attempts` 线性退避重试（`retryBaseMs × attempts`），
 *     `AbortError` 不进重试循环而标 `aborted`；
 *   · snapshot 四态 idle / queued / running / (dropped 计数)：**idle 与 queued 分得开**
 *     （「没有活」与「有活没开始」处置相反）。
 *
 * 【本仓差异（照抄会坏的地方）】
 *   · 源的 `enqueue` 不返回任务句柄，调用方拿不到结果；本仓的 `enqueue` 多返
 *     `done`（该任务的 promise）—— 否则没法把「串行化写入」写成 `await`。
 *   · 源的失败计数把 aborted 也算进 failed；本仓把 `completed / failed / aborted / dropped`
 *     **四分**，因为「被人叫停」不是失败。
 *   · 源没有「永久失败不重试」的出口（`maxRetries` 只在任务级）；本仓另有
 *     `retryable:false` 的任务级开关，供「读不到世界书」这类确定性失败直接用。
 *
 * 【纪律】
 *   ① 不抛向调用方（除 worker 自身错误按 failFast 语义）：队列坏了不许把整轮渲染带走；
 *   ② 不猜：`onStatus` 回调抛错被吞、`maxItems` 非法回落默认值；
 *   ③ 计时只用注入的 `retryBaseMs`，不用真实时钟做判定（可被测试穷举）。
 * ======================================================== */
'use strict';
import { numOrNull } from './num-gate.js';

/** 三种执行模式（源的 strict / balanced / fast → 并发档）。 */
export const EXECUTION_MODES = Object.freeze(['strict', 'balanced', 'fast']);
export const MODE_LEVEL = Object.freeze({ strict: 1, balanced: 2, fast: 3 });

function clampInt(value, fallback, min = 1, max = 64) {
    const n = numOrNull(value);
    if (n === null) return fallback;
    return Math.max(min, Math.min(max, Math.floor(n)));
}

/** 归一化模式（非法按 strict —— 保守档，不因写错字就全速并发）。 */
export function normalizeExecutionMode(value) {
    const s = String(value == null ? '' : value).trim().toLowerCase();
    if (s === 'balanced' || s === 'balance' || s === 'normal' || s === '2') return 'balanced';
    if (s === 'fast' || s === 'async' || s === '3') return 'fast';
    return 'strict';
}

/** 模式 → 并发数（strict 恒 1；其余按 base 回落到档位下限）。 */
export function concurrencyOf(mode, base = 3) {
    const level = MODE_LEVEL[normalizeExecutionMode(mode)] || 1;
    if (level === 1) return 1;
    const n = clampInt(base, 3, 1, 12);
    return level === 2 ? n : Math.min(12, n * 2);
}

/** 中止信号检查：已中止就抛（AbortError 由调用方识别，不进重试）。 */
export function throwIfAborted(signal) {
    if (!signal || !signal.aborted) return;
    const reason = signal.reason;
    if (reason instanceof Error) throw reason;
    const err = new Error(String(reason || 'Operation aborted'));
    err.name = 'AbortError';
    throw err;
}

/**
 * 有界并发执行。
 * @param {Array} items
 * @param {(item:any, index:number)=>Promise<any>} worker
 * @param {{concurrency?:number, signal?:object, preserveOrder?:boolean, failFast?:boolean}} options
 * @returns {Promise<Array>} `preserveOrder:true` 时按原下标；否则只回成功的紧凑数组
 */
export async function runLimited(items, worker, options = {}) {
    const o = options || {};
    const list = Array.isArray(items) ? items : [];
    const limit = clampInt(o.concurrency, 1, 1, Math.max(1, list.length || 1));
    const preserveOrder = o.preserveOrder !== false;
    const failFast = o.failFast !== false;
    const results = new Array(list.length);
    let cursor = 0;
    if (typeof worker !== 'function' || list.length === 0) {
        return preserveOrder ? results : [];
    }
    async function pump() {
        while (cursor < list.length) {
            throwIfAborted(o.signal);
            const index = cursor;
            cursor += 1;
            try {
                results[index] = await worker(list[index], index);
            } catch (error) {
                if (error && error.name === 'AbortError') throw error;
                if (failFast) throw error;
                results[index] = { error: error };
            }
        }
    }
    const pumps = [];
    const width = Math.min(limit, list.length);
    for (let i = 0; i < width; i += 1) pumps.push(pump());
    await Promise.all(pumps);
    return preserveOrder ? results : results.filter((item) => item !== undefined);
}

function emptySnapshot(state) {
    return {
        state: state.active ? 'running' : (state.queue.length > 0 ? 'queued' : 'idle'),
        queued: state.queue.length,
        activeId: state.active ? state.active.id : '',
        activeName: state.active ? state.active.name : '',
        completed: state.completed,
        failed: state.failed,
        aborted: state.aborted,
        dropped: state.dropped,
        lastTask: state.lastTask ? Object.assign({}, state.lastTask) : null,
        updatedAt: state.updatedAt
    };
}

/**
 * 有界后台队列。**满队不是排队而是丢**：队列满时继续收会无限堆积内存，
 *   丢一条并如实计数（调用方据 `reason` 决定要不要提示）。
 */
export function createBoundedQueue(options = {}) {
    const o = options || {};
    const state = {
        queue: [],
        active: null,
        completed: 0,
        failed: 0,
        aborted: 0,
        dropped: 0,
        lastTask: null,
        updatedAt: Date.now(),
        nextId: 1,
        draining: false,
        maxItems: clampInt(o.maxItems, 16, 2, 256),
        maxRetries: clampInt(o.maxRetries, 1, 0, 10),
        retryBaseMs: clampInt(o.retryBaseMs, 400, 10, 60000),
        onStatus: typeof o.onStatus === 'function' ? o.onStatus : null
    };
    function emitStatus() {
        state.updatedAt = Date.now();
        const snap = emptySnapshot(state);
        try { if (state.onStatus) state.onStatus(snap); } catch (_e) { /* 回调坏了不带走队列 */ }
        return snap;
    }
    function delay(ms) {
        const safe = Math.max(0, Math.floor(numOrNull(ms) ?? 0));
        if (safe <= 0) return Promise.resolve();
        return new Promise((resolve) => setTimeout(resolve, safe));
    }
    async function runTask(task) {
        state.active = task;
        task.status = 'running';
        task.startedAt = Date.now();
        emitStatus();
        while (task.attempts <= task.maxRetries) {
            try {
                task.attempts += 1;
                const result = await task.run({ attempt: task.attempts, maxRetries: task.maxRetries, id: task.id, name: task.name });
                task.status = 'success';
                task.finishedAt = Date.now();
                state.completed += 1;
                state.lastTask = { id: task.id, name: task.name, status: 'success', attempts: task.attempts, error: '', finishedAt: task.finishedAt };
                if (task.resolve) task.resolve(result);   // 只在成功终态兑现
                return result;
            } catch (error) {
                /* 「被人叫停」不是失败：单列 aborted，且绝不重试。 */
                if (error && error.name === 'AbortError') {
                    task.status = 'aborted';
                    task.error = (error && error.message) || String(error);
                    state.aborted += 1;
                    state.lastTask = { id: task.id, name: task.name, status: 'aborted', attempts: task.attempts, error: task.error, finishedAt: Date.now() };
                    if (task.resolve) task.resolve(null);
                    return null;
                }
                task.error = (error && error.message) || String(error) || 'background-task-failed';
                if (task.retryable === false || task.attempts > task.maxRetries) {
                    task.status = 'failed';
                    break;
                }
                task.status = 'retrying';
                emitStatus();
                await delay(task.retryBaseMs * Math.max(1, task.attempts));
                task.status = 'running';
                emitStatus();
            }
        }
        task.finishedAt = Date.now();
        state.failed += 1;
        state.lastTask = { id: task.id, name: task.name, status: 'failed', attempts: task.attempts, error: task.error || '', finishedAt: task.finishedAt };
        if (task.resolve) task.resolve(null);   // 重试全部耗尽才兑现
        return null;
    }
    async function drain() {
        if (state.draining) return;
        state.draining = true;
        try {
            while (state.queue.length > 0) {
                const task = state.queue.shift();
                await runTask(task);
                state.active = null;
                emitStatus();
            }
        } finally {
            state.active = null;
            state.draining = false;
            emitStatus();
        }
    }
    return {
        configure(next = {}) {
            const n = next || {};
            state.maxItems = clampInt(n.maxItems, state.maxItems, 2, 256);
            state.maxRetries = clampInt(n.maxRetries, state.maxRetries, 0, 10);
            state.retryBaseMs = clampInt(n.retryBaseMs, state.retryBaseMs, 10, 60000);
            if (typeof n.onStatus === 'function') state.onStatus = n.onStatus;
            return emitStatus();
        },
        /**
         * 入队。
         * @returns {{queued:boolean, id:string, reason:string, snapshot:object, done:Promise<any>}}
         *   满队时 `queued:false`、`reason:'queue-full'`、`done` 立即 resolve(null)。
         */
        enqueue(name, run, taskOptions = {}) {
            const opts = taskOptions || {};
            if (typeof run !== 'function') {
                throw new TypeError('background task must be a function');
            }
            const occupied = state.queue.length + (state.active ? 1 : 0);
            if (occupied >= state.maxItems) {
                state.dropped += 1;
                state.lastTask = {
                    id: '', name: String(name || 'task'), status: 'dropped',
                    attempts: 0, error: 'queue-full', finishedAt: Date.now()
                };
                const snap = emitStatus();
                return { queued: false, id: '', reason: 'queue-full', snapshot: snap, done: Promise.resolve(null) };
            }
            const task = {
                id: String(opts.id || ('bg-' + Date.now() + '-' + (state.nextId++))),
                name: String(name || opts.name || 'task'),
                run: run,
                attempts: 0,
                maxRetries: clampInt(opts.maxRetries, state.maxRetries, 0, 10),
                retryBaseMs: clampInt(opts.retryBaseMs, state.retryBaseMs, 10, 60000),
                retryable: opts.retryable !== false,
                status: 'queued',
                createdAt: Date.now()
            };
            const done = new Promise((resolve) => { task.resolve = resolve; });
            state.queue.push(task);
            const snap = emitStatus();
            void drain();
            return { queued: true, id: task.id, reason: '', snapshot: snap, done: done };
        },
        getSnapshot() { return emptySnapshot(state); },
        get size() { return state.queue.length + (state.active ? 1 : 0); },
        /** 清空未开始的（不动正在跑的）。 */
        clear() {
            const n = state.queue.length;
            state.queue = [];
            emitStatus();
            return n;
        }
    };
}

/** 一行读数（四态分列，不压成「跑了 N 个」）。 */
export function queueLine(snap) {
    const s = snap && typeof snap === 'object' ? snap : {};
    const parts = ['态 ' + (s.state || 'idle')];
    if (s.queued) parts.push('排队 ' + s.queued);
    if (s.running !== undefined) parts.push('在跑 ' + (s.activeName || '无'));
    if (s.completed) parts.push('完成 ' + s.completed);
    if (s.failed) parts.push('失败 ' + s.failed);
    if (s.aborted) parts.push('中止 ' + s.aborted);
    if (s.dropped) parts.push('丢弃 ' + s.dropped);
    return '后台队列：' + parts.join(' · ');
}

/**
 * 一行读数（未取实况时如实说未取；队列四态分列交给 queueLine）。
 *   与 queueLine 的分工：那条负责「有实况怎么写得准」，这条负责「没有实况别装作有」。
 */
export function queueReadLine(snap) {
    if (!snap || typeof snap !== 'object' || !snap.state) return '后台队列：未取实况';
    return queueLine(snap);
}

/* ── 自检 ────────────────────────────────────────────────────────────── */
export async function backgroundQueueSelfCheck() {
    const problems = [];
    const push = (ok, label) => { if (!ok) problems.push(label); };
    /* ① 模式归一与并发档：写错字回落 strict（保守），不是全速 */
    push(normalizeExecutionMode('BALANCED') === 'balanced', '大写模式未归一');
    push(normalizeExecutionMode('瞎写') === 'strict', '非法模式必须回落 strict');
    push(concurrencyOf('strict', 8) === 1, 'strict 必须恒 1');
    push(concurrencyOf('fast', 3) === 6, 'fast 必须是 balanced 的两倍');
    /* ② runLimited：并发不超过上限，且结果按原下标 */
    let peak = 0;
    let live = 0;
    const seen = [];
    const out = await runLimited([1, 2, 3, 4, 5, 6], async (n) => {
        live += 1;
        peak = Math.max(peak, live);
        await new Promise((r) => setTimeout(r, 2));
        live -= 1;
        seen.push(n);
        return n * 10;
    }, { concurrency: 2 });
    push(peak <= 2, '并发必须被限在 2 以内，实测峰值 ' + peak);
    push(out.length === 6 && out[0] === 10 && out[5] === 60, '结果必须按原下标回收，实得 ' + JSON.stringify(out));
    push(seen.length === 6, '每个条目都必须跑到');
    /* ③ runLimited：AbortError 穿透（不被 failFast 之外的判定吞） */
    let aborted = '';
    try {
        await runLimited([1, 2], async () => { const e = new Error('stop'); e.name = 'AbortError'; throw e; }, { concurrency: 1 });
    } catch (e) { aborted = e.name; }
    push(aborted === 'AbortError', 'AbortError 必须穿透');
    /* ④ runLimited：failFast=false 时错误就地记录，不中断其它条目 */
    const soft = await runLimited([1, 2, 3], async (n) => { if (n === 2) throw new Error('x'); return n; }, { concurrency: 1, failFast: false });
    push(soft.length === 3 && soft[1] && soft[1].error, '非快速失败必须就地记错并继续');
    /* ⑤ 队列：满队不进队，丢并计数、回 reason */
    const q = createBoundedQueue({ maxItems: 2, maxRetries: 0, retryBaseMs: 10 });
    const slow = () => new Promise((r) => setTimeout(r, 15));
    const a = q.enqueue('a', slow);
    const b = q.enqueue('b', slow);
    const c = q.enqueue('c', slow);
    push(a.queued && b.queued, '前两条必须能进队');
    push(!c.queued && c.reason === 'queue-full', '第三条必须被丢并回 queue-full');
    push(q.getSnapshot().dropped === 1, '丢弃必须计数');
    await new Promise((r) => setTimeout(r, 120));
    /* ⑥ 队列：线性退避重试次数与 attempts 一致 */
    const q2 = createBoundedQueue({ maxItems: 4, maxRetries: 2, retryBaseMs: 5 });
    let tries = 0;
    await q2.enqueue('boom', async () => { tries += 1; throw new Error('nope'); }).done;
    push(tries === 3, 'maxRetries=2 必须共跑 3 次，实得 ' + tries);
    push(q2.getSnapshot().failed === 1, '失败必须计数');
    /* ⑦ 队列：AbortError 不重试，且记 aborted 而不是 failed */
    const q3 = createBoundedQueue({ maxItems: 4, maxRetries: 3, retryBaseMs: 5 });
    let abTries = 0;
    await q3.enqueue('ab', async () => { abTries += 1; const e = new Error('x'); e.name = 'AbortError'; throw e; }).done;
    push(abTries === 1, 'AbortError 必须不再重试，实得 ' + abTries);
    push(q3.getSnapshot().aborted === 1 && q3.getSnapshot().failed === 0, '中止必须与失败分列');
    /* ⑧ retryable:false 的任务级开关：确定性失败直接用 */
    const q4 = createBoundedQueue({ maxItems: 4, maxRetries: 3, retryBaseMs: 5 });
    let once = 0;
    await q4.enqueue('once', async () => { once += 1; throw new Error('deterministic'); }, { retryable: false }).done;
    push(once === 1, 'retryable:false 必须不重试，实得 ' + once);
    /* ⑨ snapshot：idle 与 queued 分得开 */
    const q5 = createBoundedQueue({ maxItems: 4 });
    push(q5.getSnapshot().state === 'idle', '空队列必须是 idle');
    let release = null;
    q5.enqueue('hold', () => new Promise((r) => { release = r; }));
    await new Promise((r) => setTimeout(r, 5));
    q5.enqueue('wait', async () => 1);
    push(q5.getSnapshot().state === 'running', '有在跑必须是 running');
    q5.enqueue('wait2', async () => 1);
    push(q5.getSnapshot().queued >= 1, '排队数必须可读');
    if (release) release(1);
    await new Promise((r) => setTimeout(r, 30));
    /* ⑩ 读数不说谎 + 空输入不抛 */
    const line = queueLine(q5.getSnapshot());
    push(line.indexOf('后台队列：态') === 0, '读数必须以「后台队列：态」开头，实得 ' + line);
    push((await runLimited([], () => 1)).length === 0, '空数组必须回空');
    return { ok: problems.length === 0, problems: problems };
}

export default {
    EXECUTION_MODES, MODE_LEVEL, normalizeExecutionMode, concurrencyOf, throwIfAborted,
    runLimited, createBoundedQueue, queueLine, queueReadLine, backgroundQueueSelfCheck
};