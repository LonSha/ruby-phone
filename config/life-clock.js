/* ============================================================
 * config/life-clock.js — [v4.99.4 · R11-X3] 生活流的**低频时钟**
 * ------------------------------------------------------------
 * 【它要治的缺陷：自驱生活只在测试里存在】
 *   四件生活流内核（autonomous-life-scheduler / calendar-autonomous-life /
 *   daily-rhythm / response-cadence）早就写好，中枢也早就把它们实例化，
 *   可唯一的推进口 `SubsystemOrchestrator.advanceAutonomousLifeStep`
 *   **产品端零调用**（全仓只有 tests/ 一处）。后果：
 *   手机永远不会自己推进时间 —— 放着不动一段时间，日历上不会多出按节律生成的事件，
 *   通知中心也不会出现对应提醒。所谓「自驱」只在测试进程里成立。
 *
 * 【本件的分工：只做「什么时候推进、推了多少、谁来落盘」，不做业务】
 *   ★ 推进逻辑**不在这里重写**：本件只是 `advanceAutonomousLifeStep` 的**调用方**，
 *     把它的返回形状原样记进日志。业务语义有一份实现（中枢里那份），
 *     这里再抄一份等于制造第二份真源，两边必然漂移。
 *   ★ 本件不读日历、不读通知：那两件事是中枢内部做的，本件只记「推了几步、
 *     其中带出多少条提醒」。让时钟自己去读日历 = 时钟变成第二个中枢。
 *
 * 【三条硬约束（计划原文）】
 *   ① **不许 `setInterval` 无节制推进**（会污染存档）：
 *      间隔 60s 起步，且**推进量步进封顶**（MAX_STEPS_PER_TICK），
 *      真实流逝不足 `OFFLINE_GAP_MIN` 分钟时**不推进**（防抖：用户来回切 App
 *      不该每次都拍一步出去）。
 *   ② **必须可暂停**：`pause()` 之后 `tick()` 返回 paused 且**一步不推**。
 *   ③ **推进量落盘可查**：每一步都写 `lc_life_clock_v1`（累计步数 / 累计分钟 /
 *      上次推进时刻 / 最近 N 步的「为什么发生」）。存储写不进去时**如实说**
 *     （`storageOk:false`），不把「没存上」装成「已存」。
 *
 * 【为什么必须由时钟自己持有累计计数，而不能从中枢反推】
 *   中枢的 `advanceAutonomousLifeStep` 是**无状态**的（它的返回里没有累计数）。
 *   若把累计数挂在内存变量上，重载即归零 —— 而验收语要求
 *   「存档重载后推进计数连续」。故累计计数与「上次推进时刻」是**本件自己的落盘状态**，
 *   与中枢的瞬时返回是两件事。
 *
 * 【不可用时的形状（本仓纪律：读不到就说原因，不返 0 冒充）】
 *   `face()` 总有 `status`：`running` / `paused` / `unmounted`。
 *   `unmounted` 表示「表没挂上」（宿主无 setInterval、或中枢缺席）——
 *   这时 `mounted:false` + `why`，**不假装自己在跑**。
 * ============================================================ */
'use strict';
import { numOrNull } from './num-gate.js';
/** 时钟状态。`unmounted` 不是错误，是「这环境里没表可挂」（无头测试 / 宿主尚未装配）。 */
export const CLOCK_STATUS = Object.freeze({
    RUNNING: 'running',
    PAUSED: 'paused',
    UNMOUNTED: 'unmounted'
});
/** 时钟参数。**步进上限与防抖阈值不是可调花活**，是「不许无节制推进」的落地形式。 */
export const CLOCK_LIMITS = Object.freeze({
    /** 轮询间隔（毫秒）。60s 起步：这是「手机自己动」的最小可感知粒度。 */
    TICK_MS: 60000,
    /** 一步代表多少剧情分钟（与中枢默认 elapsedMinutes=15 对齐的**下限档**）。 */
    STEP_MINUTES: 15,
    /** 单次 tick 最多推几步。防「放着一天回来一次拍出上百步」。 */
    MAX_STEPS_PER_TICK: 12,
    /** 真实流逝不足这么多分钟就不推（防抖）。 */
    OFFLINE_GAP_MIN: 8,
    /** 日志上限（最近 N 步）。 */
    MAX_LOG: 40
});
/** 落盘键（会话隔离：换角色不该带着上一段会话的自驱计数）。
 *  ★ 必须是 `XXX_KEY = '<lit>'` 常量形式：keys-audit 的键面抽取器只认这一形式，
 *    写成对象属性会让 K3 判「幽灵放行条」拒判（X2 踩过，见 tests/system-v4993）。 */
export const LC_CLOCK_STORAGE_KEY = 'lc_life_clock_v1';
function nowMs(opts) {
    return (typeof opts.now === 'function') ? Number(opts.now()) : Date.now();
}
function safeInt(v, d = 0) {
    const n = Number(v);
    return Number.isFinite(n) ? Math.trunc(n) : d;
}
/**
 * 建一个生活流时钟。
 * @param {object} opts
 * @param {object} [opts.storage]  落盘接口（get/set）；缺席时 state 仍在内存里，但 storageOk:false
 * @param {Function} [opts.readHub] 取中枢（返回 {ok, why, hub}）。取不到**不算错误**，但要说原因
 * @param {Function} [opts.now]    取当前时间（测试注入用）
 * @param {object} [opts.runtime]  登记层（addInterval/cancel）；缺席时挂不上表
 * @param {Function} [opts.onTick]  每次 tick 之后的回调（参数 = 该次结果）。用于状态栏等前台指示刷新；
 *   ★ 不把前台绘制写进本件（那会让时钟知道 DOM），回调里做什么由実主决定。
 * @returns {object} 时钟实例
 */
export function createLifeClock(opts = {}) {
    const o = (opts && typeof opts === 'object') ? opts : {};
    const storage = o.storage || null;
    /** 内存态：与落盘态同构，落盘失败只影响持久化，不影响本次会话的累计。 */
    const state = {
        steps: 0,
        advancedMinutes: 0,
        lastTickAt: 0,
        log: [],
        paused: false,
        /* ★ 为什么要一个独立布尔而不是用 `lastTickAt !== 0` 判「推过没推过」：
         *   0 是**合法时间值**（拨表测试、时钟回拨、存档损坏都可能给出 0）。
         *   用它当哨兵会产生一整类误判：「首拍」语义（端到就推一步）会在每一拍都成立，
         *   于是防抖失效、按流逝换算失效、步进封顶也失效（不报错，只是推进量永远是 1）。
         *   本版首跑 27 条判据时就是这个形态报红的（B2/B3/B4/C2/E1 五条同一根因）。 */
        everTicked: false
    };
    let storageOk = true;
    let storageWhy = '';
    let intervalId = null;
    let mounted = false;
    /** 恢复：把上次落盘的累计计数读回来（重载连续 —— 这是验收语第四条）。 */
    function restore() {
        if (!storage || typeof storage.get !== 'function') {
            storageOk = false;
            storageWhy = 'no_storage';
            return;
        }
        let raw;
        try { raw = storage.get(LC_CLOCK_STORAGE_KEY, null); } catch (_e) {
            storageOk = false;
            storageWhy = 'read_threw';
            return;
        }
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return;   // 首次（空）不是异常
        state.steps = Math.max(0, safeInt(raw.steps, 0));
        state.advancedMinutes = Math.max(0, safeInt(raw.advancedMinutes, 0));
        state.lastTickAt = Math.max(0, safeInt(raw.lastTickAt, 0));
        /* 旧存档（本版之前写的）没有 everTicked 字段：按 lastTickAt > 0 推断。
         *   推断只用于迁移，不当新存档的真相。 */
        state.everTicked = (typeof raw.everTicked === 'boolean') ? raw.everTicked : (state.lastTickAt > 0);
        state.paused = raw.paused === true;
        state.log = Array.isArray(raw.log) ? raw.log.filter(x => x && typeof x === 'object').slice(0, CLOCK_LIMITS.MAX_LOG) : [];
    }
    function save() {
        if (!storage || typeof storage.set !== 'function') {
            storageOk = false;
            storageWhy = 'no_storage';
            return false;
        }
        try {
            storage.set(LC_CLOCK_STORAGE_KEY, {
                steps: state.steps,
                advancedMinutes: state.advancedMinutes,
                lastTickAt: state.lastTickAt,
                everTicked: state.everTicked,
                paused: state.paused,
                log: state.log
            });
            storageOk = true;
            storageWhy = '';
            return true;
        } catch (_e) {
            /* ★ 不静默：写失败要能被上层看见（否则「推进量落盘可查」是空话）。 */
            storageOk = false;
            storageWhy = 'write_threw';
            return false;
        }
    }
    restore();
    function readHub() {
        if (typeof o.readHub !== 'function') return { ok: false, why: 'no_reader', hub: null };
        try {
            const r = o.readHub();
            if (!r || typeof r !== 'object') return { ok: false, why: 'bad_shape', hub: null };
            if (!r.ok) return { ok: false, why: String(r.why || 'unavailable'), hub: r.hub || null };
            return { ok: true, why: '', hub: r.hub };
        } catch (_e) {
            return { ok: false, why: 'read_threw', hub: null };
        }
    }
    /**
     * 推进一步（一次 tick 的**净动作**）。失败路径**如实回因**：
     *   `{ok:false, why}` 且**累计计数一步不动** —— 不能「失败了也把步数加上」。
     */
    function tick(realNow = null) {
        const t = (realNow === null) ? nowMs(o) : Number(realNow);
        if (state.paused) return { ok: false, why: 'paused', steps: 0 };
        const r = readHub();
        if (!r.ok) return { ok: false, why: r.why, steps: 0 };
        const hub = r.hub;
        if (!hub || typeof hub.advanceAutonomousLifeStep !== 'function') {
            return { ok: false, why: 'no_step_method', steps: 0 };
        }
        const prev = state.lastTickAt;
        /* 防抖：真实流逝不足阈值就不推。首拍允许直接推一步，
         *   否则「刚打开手机」永远等不到第一次推进（而用户要看的正是那一步）。
         *   ★ 首拍的判据是 everTicked（显式布尔），**不是 `prev !== 0`**：
         *     0 是合法时间值，用它当哨兵会让每一拍都被当成首拍（防抖 / 换算 / 封顶三者一并失效）。 */
        const elapsedMin = state.everTicked ? Math.floor((t - prev) / 60000) : CLOCK_LIMITS.STEP_MINUTES;
        if (state.everTicked && elapsedMin < CLOCK_LIMITS.OFFLINE_GAP_MIN) {
            return { ok: false, why: 'too_soon', steps: 0, elapsedMin };
        }
        /* 步进封顶：一次 tick 最多 MAX_STEPS_PER_TICK 步。
         *   ★ 这里**按实际流逝分钟换算**，而不是恒定拍 1 步：
         *     放着两小时回来，应当补上两小时的生活流，而不是只补 15 分钟。
         *     但上不封顶会让「关一夜回来」拍出几百步、写爆日志与通知队列。 */
        const wanted = Math.max(1, Math.floor(elapsedMin / CLOCK_LIMITS.STEP_MINUTES));
        const n = Math.min(wanted, CLOCK_LIMITS.MAX_STEPS_PER_TICK);
        const steps = [];
        for (let i = 0; i < n; i += 1) {
            let out;
            try {
                out = hub.advanceAutonomousLifeStep(CLOCK_LIMITS.STEP_MINUTES);
            } catch (e) {
                /* ★ 中枢抛错：已推的步数**照样记账**（它们真的发生了），
                 *   但把这一步的 why 记下来 —— 「推了一半炸了」不能装成「全推完了」。 */
                steps.push({ i, why: 'step_threw', message: String((e && e.message) || e) });
                break;
            }
            steps.push(summarizeStep(out));
        }
        const advanced = steps.filter(s => s.why !== 'step_threw').length;
        if (advanced === 0 && steps.length > 0) {
            /* 一步都没成：不记账、不动 lastTickAt（下次 tick 仍是同一段流逝，不丢）。 */
            state.log.unshift({ at: t, steps: 0, elapsedMin, advanced: 0, why: 'all_threw', detail: steps[0] });
            state.log = state.log.slice(0, CLOCK_LIMITS.MAX_LOG);
            save();
            return { ok: false, why: 'all_threw', steps: 0, elapsedMin };
        }
        state.steps += advanced;
        state.advancedMinutes += advanced * CLOCK_LIMITS.STEP_MINUTES;
        state.lastTickAt = t;
        state.everTicked = true;
        const row = {
            at: t,
            steps: advanced,
            elapsedMin,
            advanced,
            capped: wanted > n,
            why: steps.length && steps[0].why === 'step_threw' ? 'partial_threw' : 'ok',
            detail: steps
        };
        state.log.unshift(row);
        state.log = state.log.slice(0, CLOCK_LIMITS.MAX_LOG);
        save();
        const res = { ok: true, why: '', steps: advanced, elapsedMin, capped: wanted > n, detail: steps };
        /* 前台指示刷新回调：⚙ 回调自己抛错不能把已记账的推进变成失败（推进已经发生了）。 */
        if (typeof o.onTick === 'function') {
            try { o.onTick(res); } catch (_e) { /* 前台指示挂了不影响记账 */ }
        }
        return res;
    }
    /**
     * 把中枢一步的返回压成「这一步为什么发生」的可读摘要。
     *   ★ 只读不猜：拿不到相位就说 null，不补一个假的相位名。
     */
    function summarizeStep(out) {
        if (!out || typeof out !== 'object') return { why: 'bad_step_shape' };
        const alerts = Array.isArray(out.alerts) ? out.alerts.length : 0;
        const atmo = (out.atmosphere && typeof out.atmosphere === 'object') ? out.atmosphere : null;
        const bat = (out.battery && typeof out.battery === 'object') ? out.battery : null;
        return {
            why: 'ok',
            alerts,
            phase: atmo && typeof atmo.phase === 'string' ? atmo.phase : null,
            batteryPct: bat ? numOrNull(bat.percent) : null,
            alertTitles: Array.isArray(out.alerts)
                ? out.alerts.map(a => String((a && a.title) || '')).filter(Boolean).slice(0, 5)
                : []
        };
    }
    /** 暂停：**一步不推**（验收语第二条）。落盘 paused 以便重载后仍暂停。 */
    function pause() {
        state.paused = true;
        save();
        return { ok: true, paused: true };
    }
    function resume() {
        state.paused = false;
        /* 恢复时**重置计时起点**：暂停期间流逝的那段时间不该一次性补拍，
         *   「暂停」的语义是「这段时间不存在」。 */
        state.lastTickAt = nowMs(o);
        /* 恢复时置 everTicked=true：计时起点已被重置到现在，不该再按首拍处理。 */
        state.everTicked = true;
        save();
        return { ok: true, paused: false };
    }
    /**
     * 挂表：宿主给登记层就挂，没给**不假装挂上了**（mounted:false）。
     *   ★ 走 `runtime.addInterval`（本仓登记制）：裸 setInterval 在手机壳重建后
     *     旧轮询会永久残留（本仓治过多次的形态）。
     */
    function mount() {
        if (mounted) return { ok: true, why: '', mounted: true };
        const rt = o.runtime;
        if (!rt || typeof rt.addInterval !== 'function') {
            return { ok: false, why: 'no_runtime', mounted: false };
        }
        intervalId = rt.addInterval(() => { tick(); }, CLOCK_LIMITS.TICK_MS, 'life:clock');
        mounted = intervalId !== null;
        return { ok: mounted, why: mounted ? '' : 'no_setinterval', mounted };
    }
    /** 卸表：与 mount 成对。卸了之后 snapshot().status 回到 unmounted。 */
    function unmount() {
        const rt = o.runtime;
        if (intervalId && rt && typeof rt.cancel === 'function') {
            try { rt.cancel(intervalId); } catch (_e) { /* 登记层已经在回收了 */ }
        }
        intervalId = null;
        mounted = false;
        return { ok: true, mounted: false };
    }
    /** 读数（前台指示 + 诊断 + 判据的唯一入口）。 */
    function face() {
        const status = !mounted ? CLOCK_STATUS.UNMOUNTED : (state.paused ? CLOCK_STATUS.PAUSED : CLOCK_STATUS.RUNNING);
        return {
            status,
            mounted,
            paused: state.paused,
            steps: state.steps,
            advancedMinutes: state.advancedMinutes,
            lastTickAt: state.lastTickAt,
            storageOk,
            storageWhy,
            recent: state.log.slice(0, CLOCK_LIMITS.MAX_LOG),
            /* 表没挂上时必须说原因：`no_runtime` = 宿主没给登记层；
             *   `paused` 单独一档 —— 那是用户主动停的，不是坏了。 */
            why: !mounted ? 'no_runtime' : (state.paused ? 'paused' : '')
        };
    }
    /** 前台一行的可读文案（供状态栏/日历今日视图直接画，不在这里拼 HTML）。 */
    function line() {
        const s = face();
        if (s.status === CLOCK_STATUS.UNMOUNTED) return '生活流：未启动（' + (s.why === 'no_runtime' ? '无运行时登记层' : s.why) + '）';
        if (s.status === CLOCK_STATUS.PAUSED) return '生活流：已暂停（今日已推进 ' + s.steps + ' 步）';
        return '生活流：运行中 · 今日已推进 ' + s.steps + ' 步';
    }
    return { tick, pause, resume, mount, unmount, face, line, restore };
}
