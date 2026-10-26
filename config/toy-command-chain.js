/* ============================================================
 * config/toy-command-chain.js — [v4.88.0] 玩具指令串行链 + 过期令牌
 * ------------------------------------------------------------
 * 缝合自 c3ll256/dsh-toy（src/runtime.ts:96-160，BSD-3）。
 *
 * ── 源在治什么（这条非常具体，不是泛泛的「排队」）────────
 *   遥控类玩具的指令是**有停止动作**的：start / speed 之后一定跟 stop。
 *   于是两个定时器互相踩成了稳定性缺陷：
 *     · 硬启 1s 后自动 stop 的定时器，会在「刚发了新 start」之后把**新的**
 *       那次停掉（用户体感：发两次，第二次没反应）；
 *     · 长按连发会并发打满（设备端按到达序执行，乱序即错动作）。
 *   源的修法两条，都很硬：
 *     ① **Symbol 令牌**：每次派发生成唯一 token，定时器回调里比
 *        `current?.token !== token` 就**丢弃本次**（旧定时器不许停新指令）；
 *     ② `exclusive()` Promise 链串行 + `disposing` 分流（销毁期的新指令
 *        直接丢，不再入链让链永续）。
 *   另有 `validateControl`：强度取整、上限卡死、时长上限卡死。
 *
 * ── 本件在本仓怎么落（纯函数，不带 Promise）──────────────
 *   本仓没有设备侧 SDK，故串行链落成**可驱动的状态机**：一次「派发」返回
 *   下一个应执行动作与一个 token，`settle()` 报告完成。这样：
 *     · 定时器该不该停，靠 `isStale(token)` 判 —— 与源的令牌比对等价；
 *     · 并发靠 `pending` 单坑位 + 队列（不引入 Promise 让无头判定变难）。
 *   与源的两处**有意差异**，都写了后果：
 *     ① 源的 `exclusive` 是无限链；本件的队列有上限，超限**如实拒绝**
 *        （`rejected:'queue-full'`）而不是静默丢弃 —— 玩具指令丢一条用户能看出来，
 *        静默丢一条会让「按了没反应」变成玄学。
 *     ② 本件把「过期令牌」的判定**只**用于自动 stop：只有 stop 是定时器派发的，
 *        人按的 start 永不过期（源亦如此）。
 *
 * ── 校验口径（源的 validateControl 照搬）─────────────────
 *   强度整数、0..MAX；时长整数毫秒、MIN..MAX。**越界一律夹到边界并如实标
 *   `clamped:true`**，不做「越界就拒绝」（这一版要的是能用，拒绝会让人以为坏了）。
 * ============================================================ */

/** 强度上限（源同）。 */
export const TOY_STRENGTH_MAX = 20;
/** 时长上下限（毫秒）：太短设备收不到，太长会盖住下一条。 */
export const TOY_DURATION_MIN_MS = 200;
export const TOY_DURATION_MAX_MS = 15000;
/** 自动 stop 的默认延迟（源 1s）。 */
export const TOY_AUTO_STOP_MS = 1000;
/** 队列上限。 */
export const TOY_QUEUE_MAX = 6;
/* [v4.88.0 · 第七批缝入] 数值取值门（弱口径清零）。 */
import { numOrNull } from './num-gate.js';

/** 拒绝原因。 */
export const TOY_REJECT_REASONS = Object.freeze(['queue-full', 'disposed', 'invalid']);

/** 整数归一 + 夹边界。非数一律 null（不猜 0）。 */
function clampInt(v, min, max) {
    if (typeof v === 'number') {
        if (!Number.isFinite(v)) return null;
        return Math.min(max, Math.max(min, Math.round(v)));
    }
    if (typeof v === 'string' && v.trim() !== '') {
        const n = Number(v);
        if (!Number.isFinite(n)) return null;
        return Math.min(max, Math.max(min, Math.round(n)));
    }
    return null;
}

/**
 * 校验一条控制指令。返回 `{ok, value, clamped, reason}`：
 *   · ok=false 只会因为强度完全给不出（`reason:'invalid'`）；
 *   · 给了但越界 ⇒ ok=true + clamped=true（夹边界）。
 */
export function validateControl(raw, opts = {}) {
    const o = opts || {};
    const maxStrength = clampInt(o.maxStrength ?? TOY_STRENGTH_MAX, 1, 100) ?? TOY_STRENGTH_MAX;
    const minMs = clampInt(o.minDurationMs ?? TOY_DURATION_MIN_MS, 50, 600000) ?? TOY_DURATION_MIN_MS;
    const maxMs = clampInt(o.maxDurationMs ?? TOY_DURATION_MAX_MS, minMs, 600000) ?? TOY_DURATION_MAX_MS;
    const r = raw || {};

    const s = clampInt(r.strength ?? r.level, 0, maxStrength);
    const dRaw = clampInt(r.durationMs ?? r.duration, minMs, maxMs);
    const clamped = (s !== null && Number(r.strength ?? r.level) !== s)
        || (dRaw !== null && Number(r.durationMs ?? r.duration) !== dRaw);

    if (s === null) return { ok: false, value: null, clamped: false, reason: 'invalid' };
    return {
        ok: true,
        value: { strength: s, durationMs: dRaw === null ? null : dRaw },
        clamped,
        reason: clamped ? 'clamped' : ''
    };
}

/**
 * 串行链。**单坑位 current + 有界队列**：
 *   派发时若没有在跑的，直接成为 current；否则排队。
 *   `settle()` 一次只消化一条，且**只消化 current**（不让后来的插到本轮之前）。
 */
export class ToyCommandChain {
    constructor(opts = {}) {
        this.maxQueue = clampInt(opts.maxQueue ?? TOY_QUEUE_MAX, 1, 50) ?? TOY_QUEUE_MAX;
        this.autoStopMs = clampInt(opts.autoStopMs ?? TOY_AUTO_STOP_MS, 50, 60000) ?? TOY_AUTO_STOP_MS;
        this._seq = 0;
        this._current = null;
        this._queue = [];
        this._disposed = false;
        this._rejected = [];
        this._settled = 0;
        this._superseded = 0;
    }

    /** 新令牌。用递增序号而不是对象引用：可序列化，读数里也看得见。 */
    _token() {
        this._seq += 1;
        return 'tk_' + this._seq;
    }

    /**
     * 派发一条指令。
     * @returns {{ok:boolean, token:string|null, action:string, entry:object|null,
     *            queued:boolean, rejected:string|null}}
     */
    dispatch(action, rawControl, opts = {}) {
        const act = String(action || '').trim();
        if (this._disposed) return { ok: false, token: null, action: act, entry: null, queued: false, rejected: 'disposed' };
        if (!act) return { ok: false, token: null, action: act, entry: null, queued: false, rejected: 'invalid' };

        const v = validateControl(rawControl, opts);
        if (!v.ok) return { ok: false, token: null, action: act, entry: null, queued: false, rejected: 'invalid' };

        const auto = opts.autoStop === true || act !== 'stop';
        const entry = {
            token: this._token(),
            action: act,
            control: v.value,
            clamped: v.clamped,
            autoStop: auto && act !== 'stop',
            autoStopMs: this.autoStopMs,
            issuedAt: numOrNull(opts.now) ?? Date.now()
        };

        if (!this._current) {
            this._current = entry;
            return { ok: true, token: entry.token, action: act, entry, queued: false, rejected: null };
        }
        if (this._queue.length >= this.maxQueue) {
            this._rejected.push({ action: act, reason: 'queue-full', at: Date.now() });
            return { ok: false, token: null, action: act, entry: null, queued: false, rejected: 'queue-full' };
        }
        this._queue.push(entry);
        return { ok: true, token: entry.token, action: act, entry, queued: true, rejected: null };
    }

    /**
     * 定时器回调里的过期判定：**只认当前令牌**。
     * 旧定时器（`_current` 已换人）一律 true ⇒ 不许停新指令。
     */
    isStale(token) {
        if (!this._current) return true;
        return this._current.token !== String(token || '');
    }

    /** 完成当前指令并推进队列。返回下一个要执行的（或 null）。 */
    settle(token) {
        if (!this._current) return { ok: false, next: null, reason: 'idle' };
        if (String(token || '') !== this._current.token) {
            this._superseded += 1;
            return { ok: false, next: null, reason: 'stale-token', currentToken: this._current.token };
        }
        this._settled += 1;
        this._current = this._queue.shift() || null;
        return { ok: true, next: this._current ? { ...this._current } : null, reason: '' };
    }

    /** 销毁：在跑的作废、队列清空、后续派发一律 disposed（源 disposing 分流同义）。 */
    dispose() {
        this._disposed = true;
        this._current = null;
        this._queue = [];
    }

    /** 当前在跑的指令（副本）。 */
    current() {
        return this._current ? { ...this._current } : null;
    }

    /** 读数：等待/队列/已拒绝/已作废/已结算/已销毁。 */
    stats() {
        return {
            busy: Boolean(this._current),
            currentToken: this._current ? this._current.token : null,
            queued: this._queue.length,
            maxQueue: this.maxQueue,
            rejected: this._rejected.length,
            superseded: this._superseded,
            settled: this._settled,
            disposed: this._disposed
        };
    }
}