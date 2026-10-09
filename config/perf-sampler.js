/* ========================================================
 * config/perf-sampler.js — 有界的**被动**性能采样器 [v3.79.0]
 * --------------------------------------------------------
 * 【计划出处】R-O6 第二层第 5 条：「性能读数被动采样、有界保存，守护器自身
 *   不得常驻拖累」。
 *
 * 【修前实测的处境】
 *   · 全仓 `document.getAnimations` / `PerformanceObserver` **零命中**；
 *   · 已有读数（`boot-timing` / `perf_probe` / 内存趋势探针）全部是**主动调用式**：
 *     谁想看谁跑一遍，于是「用户实际体验到了什么」在两次主动调用之间是空白；
 *   · 轮询式守护器是**本仓明令避免**的形态（v2.27.0 把三处永久轮询改成登记制，
 *     理由写在 runtime-lifecycle.js 文件头：句柄不存、无清理路径即永久累积）。
 *
 * 【本模块的四条硬口径（每一条都是「不做某件事」的理由）】
 *   ① **被动**：只用 `PerformanceObserver` 订阅浏览器自己产生的条目，
 *      **不起任何定时器 / 不轮询** —— 守护器自己不得成为被守护的对象。
 *   ② **有界**：环形缓冲，上限固定（默认 60 条）。溢出时**覆盖最旧**并计数
 *      （`dropped` 只增不减），不静默不增长。读完不保留第二份。
 *   ③ **可停**：`arm()` / `disarm()` 显式可关。后台（面板与页面都不可见）时
 *      由调用方 disarm —— 断开订阅的成本是 0，保留一个隐藏期的 observer 不是。
 *   ④ **未知不报 0**：宿主不支持 `PerformanceObserver` / `longtask` 时，
 *      `supported` 为 false、`readings()` 的 `supported` 也是 false ——
 *      「没测到」与「测得 0 次」不得同形。
 *
 * 【为什么只收 longtask】
 *   它是浏览器自己判定「主线程卡了」的条目（>50ms），不需要我们自己定阈值 ——
 *   本仓反复的教训是「自定阈值等于自己造口径」。其余类别（resource / paint）
 *   数据量太大且有别的通道，本层不收。
 * ============================================================ */

/** 默认上界：60 条长任务样本（有界是本模块存在的理由之一，故常数写在一处）。 */
export const SAMPLER_LIMIT = 60;

/** 只收浏览器自己判定为「主线程卡了」的条目：它自带 50ms 阈值，不靠我们定。 */
export const SAMPLER_ENTRY = 'longtask';

/**
 * 建一个被动采样器。
 * @param {{observe?: Function, limit?: number}} [opts]
 *   `observe` 便于测试注入一个合成观察器（真环境下不传）。
 * @returns 采样器对象（armed / arm / disarm / push / readings / stats / dispose）
 */
export function createPerfSampler(opts) {
    const o = opts || {};
    const limit = Number.isFinite(o.limit) && o.limit > 0 ? Math.floor(o.limit) : SAMPLER_LIMIT;
    /** 环形缓冲：定长数组 + 写指针（比 shift() 便宜，且溢出行为显式可数）。 */
    const ring = new Array(limit).fill(null);
    let cursor = 0;
    let count = 0;
    let dropped = 0;
    let armed = false;
    let observer = null;
    let supported = null;   // null = 还没探过（**未知不报 false**）
    let lastReason = '';

    const push = (entry) => {
        const dur = Number(entry && entry.duration);
        if (!Number.isFinite(dur)) return false;
        const rec = {
            ms: Math.round(dur * 100) / 100,
            at: Number(entry && entry.startTime) || 0,
            name: String((entry && entry.name) || 'longtask')
        };
        if (ring[cursor] !== null) dropped += 1;
        ring[cursor] = rec;
        cursor = (cursor + 1) % limit;
        if (count < limit) count += 1;
        return true;
    };

    const probe = () => {
        if (supported !== null) return supported;
        const host = (o.win) || (typeof globalThis !== 'undefined' ? globalThis : null);
        if (!host || typeof host.PerformanceObserver !== 'function') { supported = false; return supported; }
        try {
            const test = new host.PerformanceObserver(() => {});
            const types = test.supportedEntryTypes;
            supported = Array.isArray(types) ? types.indexOf(SAMPLER_ENTRY) >= 0 : true;
        } catch (_e) { supported = false; }
        return supported;
    };

    return {
        limit,
        get armed() { return armed; },
        /** 宿主支不支持（三态：null 没探过 / true / false） */
        support: () => probe(),

        /** 直接喂一条条目（真观察器与测试共用同一条入口）。 */
        push,

        /**
         * 开始订阅。幂等：已 armed 时直接返回 true（不重复订阅）。
         * @returns {{ok:boolean, reason:string}}
         */
        arm(reason) {
            lastReason = String(reason || 'arm');
            if (armed) return { ok: true, reason: 'already-armed' };
            if (!probe()) return { ok: false, reason: '宿主不支持 ' + SAMPLER_ENTRY + ' 条目（不得当成 0 条）' };
            try {
                const host = (o.win) || (typeof globalThis !== 'undefined' ? globalThis : null);
                const mk = typeof o.observe === 'function'
                    ? o.observe
                    : (cb) => {
                        const ob = new host.PerformanceObserver((list) => cb(list.getEntries()));
                        ob.observe({ entryTypes: [SAMPLER_ENTRY] });
                        return ob;
                    };
                observer = mk((entries) => { for (const e of entries) push(e); });
                armed = true;
                return { ok: true, reason: '' };
            } catch (e) {
                observer = null;
                armed = false;
                return { ok: false, reason: '订阅失败：' + String((e && e.message) || e) };
            }
        },

        /** 停止订阅。幂等；未 armed 时也是空操作（返回 ok=true）。 */
        disarm(reason) {
            lastReason = String(reason || 'disarm');
            try { observer?.disconnect?.(); } catch (_e) { /* 断开失败不得抛 */ }
            observer = null;
            const was = armed;
            armed = false;
            return { ok: true, was };
        },

        /**
         * 读数：全部有界。`readings()` **只读快照，不清空**（清空由显式 reset 负责）——
         *   诊断面看完一次就把样本丢了，下一屏就没得看（本仓治过的形态）。
         */
        readings() {
            const out = [];
            const start = count < limit ? 0 : cursor;
            for (let i = 0; i < count; i++) {
                const rec = ring[(start + i) % limit];
                if (rec) out.push(rec);
            }
            const ms = out.map((r) => r.ms);
            return {
                supported: supported === true,
                probed: supported !== null,
                armed,
                limit,
                count,
                dropped,
                maxMs: ms.length ? Math.max.apply(null, ms) : null,
                totalMs: ms.length ? Math.round(ms.reduce((a, b) => a + b, 0) * 100) / 100 : null,
                lastMs: ms.length ? ms[ms.length - 1] : null,
                lastAt: out.length ? out[out.length - 1].at : null,
                reason: lastReason
            };
        },

        /** 清空样本（保留上界与支持面：这两样不因清空而变化）。 */
        reset() {
            ring.fill(null);
            cursor = 0;
            count = 0;
            dropped = 0;
            return true;
        },

        /** 彻底释放：disarm + 清空。 */
        dispose() {
            const r = this.disarm('dispose');
            this.reset();
            return r;
        }
    };
}

export default { createPerfSampler, SAMPLER_LIMIT, SAMPLER_ENTRY };
