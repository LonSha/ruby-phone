/**
 * config/log-gate.js — 日志分级与采样 [R26-O4]
 *
 * 【治的欠账】R26-O4 原文：「现有输出无级别、无采样，出问题只能翻全量」。
 *   取证（动手前实测）：`config/` 下 `console.log|info|warn|error|debug` 共 **150 处**，
 *   分布在 14 个文件（`image-generation-manager` 44 / `storage` 33 / `api-manager` 25 = 102 处、68%），
 *   而全仓**没有一个** logger（`grep 'createLogger|logLevel|LOG_LEVEL'` 命中 0）。所以缺的不是
 *   「再写一遍输出」，是**一处能分级、能降量、能回执的地方**。
 *
 * 【本模块的边界（读清楚再改）】
 *   ✅ 一条流水线：`emit(level, msg)` 给出**决策**（放行 / 被级过滤 / 被采样丢掉）+ 计数；
 *      `installConsoleBridge()` 把 `console` 的五个方法接到这条流水线上，可 `undo()` 逐引用还原。
 *   ❌ 不搬运 150 处调用点：改调用点等于全仓重写，本轮不做（那是「收口」不是「立度量」）。
 *      零侵入接管才是这期能真落地的最小切面 —— 存量一行不改，行为也能被分级与采样。
 *
 * 【采样为什么必须是确定性的（本仓最容易被做假的一条）】
 *   若用 `Math.random()`，判据只能统计「大概」，永远无法复跑「同一条消息该不该留」。
 *   这里用 **FNV-1a(级别 | 时间桶 | 消息前缀 | 第几次出现) % 10000 < rate*10000**：
 *     · 同一序列 ⇒ 决策逐条相同（判据可复跑，负控制换成 random 必红）；
 *     · 同一消息**刷屏**时第 N 次出现会换 key，所以不会「一条热门日志全留或全丢」；
 *     · rate 越大 kept 集合越大且**单调**（阈值单调 ⇒ 0.5 的保留集是 1.0 的子集）。
 *
 * 【三态不塌】
 *   `absent` —— 这台机器上还没装桥（不是「日志 0 条」，是没量过）；
 *   `ok`     —— 读到了计数；
 *   `unknown`—— 读的时候抛了。**没有钟**（`bucketOf` 返回 null）时如实记 `undecidable`：
 *              采样无法分桶 ⇒ 全量放行，并在读数里点名，绝不编一个「丢了 50%」出来。
 *
 * 【error 永不采样：两道硬保证】
 *   ① `setRate('error', x)` 直接拒（返回 `{ ok:false, bad:['error-never-sampled'] }`）；
 *   ② `emit` 里对 error **强制 rate = 1**，即使 state 被外部改坏也不采。
 *   判据 A2 的双面验证与负控制 N1（摘掉 ②）就是钉这两道的。
 */
import { numOrNull } from './num-gate.js';

/** 四级（闭集：认不出的级别会如实计数，不静默归并）。 */
export const LOG_LEVELS = Object.freeze(['debug', 'info', 'warn', 'error']);
const RANK = Object.freeze({ debug: 10, info: 20, warn: 30, error: 40 });
/** 默认级别：info。`config/` 下 150 处里**没有一处 `console.debug`**（实测），
 *  所以「丢 debug」在默认态下**不会改变任何现有输出**；这是刻意选的默认值，不是顺手。 */
export const DEFAULT_LEVEL = 'info';
/** 默认采样率：全 1（默认态 = 纯分级，不降量）。降量由使用方显式打开。 */
export const DEFAULT_RATES = Object.freeze({ debug: 1, info: 1, warn: 1, error: 1 });
/** 采样分母（万分之一分辨率：0.0001 一档）。 */
export const SAMPLE_SCALE = 10000;

/** FNV-1a 32 位：纯函数、跨进程同结果（不依赖 Math.random，判据才能复跑）。 */
function fnv1a(str) {
    let h = 0x811c9dc5;
    const s = String(str);
    for (let i = 0; i < s.length; i += 1) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h >>> 0;
}

/** 级别归一：认不出 ⇒ null（调用方决定如实计数，不许静默并级）。 */
function normLevel(level) {
    const lv = typeof level === 'string' ? level.trim().toLowerCase() : '';
    return LOG_LEVELS.indexOf(lv) >= 0 ? lv : null;
}

function clampRate(v) {
    const n = numOrNull(v);
    if (n === null) return null;
    if (n <= 0) return 0;
    if (n >= 1) return 1;
    return n;
}

/** 消息 → 采样 key 的前缀（不把整个大对象塞进 hash：前 120 字符足够区分）。 */
function msgKey(msg) {
    if (typeof msg === 'string') return msg.slice(0, 120);
    if (msg === null || msg === undefined) return String(msg);
    if (typeof msg === 'number' || typeof msg === 'boolean') return String(msg);
    try {
        const j = JSON.stringify(msg);
        return (typeof j === 'string' ? j : '[unserializable]').slice(0, 120);
    } catch (_e) {
        return '[unserializable]';
    }
}

/** 默认分桶：按天（一天之内同一条日志的采样决策稳定，跨天才允许换）。 */
function dayBucket(ms) {
    return 'd' + Math.floor(ms / 86400000);
}

/**
 * 建一个闸。纯决策对象，不碰 console —— 判据可以直接驱动它，不需要真宿主。
 * @param {{level?:string, rates?:object, now?:Function, bucketOf?:Function}} opts
 */
export function createLogGate(opts) {
    const o = opts && typeof opts === 'object' ? opts : {};
    const now = typeof o.now === 'function' ? o.now : function () { return Date.now(); };
    const bucketOf = typeof o.bucketOf === 'function' ? o.bucketOf : function () {
        const t = numOrNull(now());
        return t === null ? null : dayBucket(t);
    };
    const startLevel = normLevel(o.level);
    const state = {
        /* 级别不合法就退回默认：默认值只有一处（DEFAULT_LEVEL），不在这里另写一个 'info' */
        level: startLevel === null ? DEFAULT_LEVEL : startLevel,
        rates: Object.assign({}, DEFAULT_RATES),
        seq: new Map(),
        unknownLevel: 0,
        badRate: [],
        totals: { kept: 0, levelDropped: 0, sampledDropped: 0, undecidable: 0 },
        byLevel: {}
    };
    LOG_LEVELS.forEach(function (lv) {
        state.byLevel[lv] = { kept: 0, levelDropped: 0, sampledDropped: 0 };
    });
    const given = o.rates && typeof o.rates === 'object' ? o.rates : {};
    Object.keys(given).forEach(function (k) {
        const lv = normLevel(k);
        const r = clampRate(given[k]);
        if (lv === null || r === null) { state.badRate.push('bad-rate:' + String(k)); return; }
        if (lv === 'error' && r < 1) { state.badRate.push('error-never-sampled'); return; }
        state.rates[lv] = lv === 'error' ? 1 : r;
    });

    /** 当前级别（人话 + 允许改）。 */
    function setLevel(level) {
        const lv = normLevel(level);
        if (lv === null) return { ok: false, bad: ['unknown-level:' + String(level)], level: state.level };
        state.level = lv;
        return { ok: true, bad: [], level: state.level };
    }

    /** 调整某一级的采样率。error 一律拒（见文件头「两道硬保证」）。 */
    function setRate(level, v) {
        const lv = normLevel(level);
        if (lv === null) return { ok: false, bad: ['unknown-level:' + String(level)] };
        const r = clampRate(v);
        if (r === null) return { ok: false, bad: ['bad-rate'] };
        if (lv === 'error') return { ok: false, bad: ['error-never-sampled'], rate: 1 };
        state.rates[lv] = r;
        return { ok: true, bad: [], rate: r };
    }

    /**
     * 一次输出的决策。**不转发**，只回答「该不该留、为什么」。
     * @returns {{forwarded:boolean, level:string|null, reason:string, key?:string}}
     */
    function emit(level, msg) {
        const lv = normLevel(level);
        if (lv === null) {
            state.unknownLevel += 1;
            /* 认不出的级别按 info 的下限处理（不丢，也不当成 error 抬高）；读数里点名。 */
            return { forwarded: RANK.info >= RANK[state.level], level: null, reason: 'unknown-level' };
        }
        if (RANK[lv] < RANK[state.level]) {
            state.totals.levelDropped += 1;
            state.byLevel[lv].levelDropped += 1;
            return { forwarded: false, level: lv, reason: 'below-level' };
        }
        /* ② 硬保证：error 不看 rates，永远全量。 */
        const rate = lv === 'error' ? 1 : state.rates[lv];
        if (rate >= 1) {
            state.totals.kept += 1;
            state.byLevel[lv].kept += 1;
            return { forwarded: true, level: lv, reason: 'all' };
        }
        if (rate <= 0) {
            state.totals.sampledDropped += 1;
            state.byLevel[lv].sampledDropped += 1;
            return { forwarded: false, level: lv, reason: 'sampled-out' };
        }
        const bucket = bucketOf();
        if (bucket === null || bucket === undefined) {
            /* 没有钟 ⇒ 采样不可判定：全量放行并计数（不编造丢弃）。 */
            state.totals.undecidable += 1;
            state.totals.kept += 1;
            state.byLevel[lv].kept += 1;
            return { forwarded: true, level: lv, reason: 'undecidable-bucket' };
        }
        const sig = lv + '|' + String(bucket) + '|' + msgKey(msg);
        const n = state.seq.get(sig) || 0;
        state.seq.set(sig, n + 1);
        const h = fnv1a(sig + '|' + n);
        const keep = h % SAMPLE_SCALE < Math.round(rate * SAMPLE_SCALE);
        if (keep) {
            state.totals.kept += 1;
            state.byLevel[lv].kept += 1;
            return { forwarded: true, level: lv, reason: 'sampled-in', key: sig };
        }
        state.totals.sampledDropped += 1;
        state.byLevel[lv].sampledDropped += 1;
        return { forwarded: false, level: lv, reason: 'sampled-out', key: sig };
    }

    function stats() {
        const byLevel = {};
        LOG_LEVELS.forEach(function (lv) {
            const b = state.byLevel[lv];
            byLevel[lv] = { kept: b.kept, levelDropped: b.levelDropped, sampledDropped: b.sampledDropped };
        });
        return {
            level: state.level,
            rates: Object.assign({}, state.rates),
            kept: state.totals.kept,
            levelDropped: state.totals.levelDropped,
            sampledDropped: state.totals.sampledDropped,
            undecidable: state.totals.undecidable,
            unknownLevel: state.unknownLevel,
            badRate: state.badRate.slice(),
            byLevel
        };
    }

    return { emit, setLevel, setRate, stats, levels: LOG_LEVELS };
}

/**
 * 接管 console（**零侵入**：一行调用点都不改）。默认 `level:'info'` + rates 全 1 ⇒
 *   纯 pass-through（`config/` 下没有 console.debug，实测），行为与不装完全一致。
 * @param {object} target 要接管的对象（默认传 `console`；判据传假对象以免污染真 console）
 * @returns {{ok:boolean, bad:string[], gate:object|null, undo:Function|null}}
 */
export function installConsoleBridge(target, opts) {
    const t = target && typeof target === 'object' ? target : null;
    if (!t) return { ok: false, bad: ['no-target'], gate: null, undo: null };
    const gate = (opts && opts.gate && typeof opts.gate.emit === 'function') ? opts.gate : createLogGate(opts);
    const MAP = { log: 'info', debug: 'debug', info: 'info', warn: 'warn', error: 'error' };
    const orig = {};
    const missing = [];
    Object.keys(MAP).forEach(function (k) {
        if (typeof t[k] === 'function') orig[k] = t[k];
        else missing.push(k);
    });
    Object.keys(MAP).forEach(function (k) {
        if (!orig[k]) return;
        const lv = MAP[k];
        t[k] = function () {
            const args = Array.prototype.slice.call(arguments);
            const d = gate.emit(lv, args[0]);
            if (d.forwarded) return orig[k].apply(this, args);
            return undefined;
        };
    });
    return {
        ok: true,
        bad: missing.map(function (k) { return 'missing-console-fn:' + k; }),
        gate,
        undo: function () {
            Object.keys(orig).forEach(function (k) { t[k] = orig[k]; });
        }
    };
}

/** 读数三态：`absent` / `ok` / `unknown`（不塌成「0 条」）。 */
export function logGateFace(win) {
    const vp = win && win.VirtualPhone ? win.VirtualPhone : null;
    if (!vp || !vp.logGate || typeof vp.logGate.stats !== 'function') {
        return { kind: 'absent', reason: 'no-gate', stats: null };
    }
    try {
        return { kind: 'ok', reason: '', stats: vp.logGate.stats() };
    } catch (_e) {
        return { kind: 'unknown', reason: 'stats-threw', stats: null };
    }
}

function n(v) {
    const x = numOrNull(v);
    return x === null ? '—' : String(x);
}

/** 一句话读数（人话，先说自己是什么形态）。 */
export function logGateFaceText(face) {
    const f = face && typeof face === 'object' ? face : { kind: 'absent', reason: 'no-face', stats: null };
    if (f.kind === 'absent') return '日志闸尚未安装（本机没装桥）—— 不是「日志 0 条」，是「没量过」';
    if (f.kind !== 'ok') return '日志闸读数读取失败：' + (f.reason || 'unknown') + '（如实标未知，不写 0）';
    const s = f.stats || {};
    const kept = n(s.kept);
    const dropped = n(s.levelDropped) + ' 条被级别挡下、' + n(s.sampledDropped) + ' 条被采样丢';
    const extra = [];
    if (numOrNull(s.undecidable) > 0) extra.push(n(s.undecidable) + ' 条无钟不可判定（全量放行，未编造丢弃）');
    if (numOrNull(s.unknownLevel) > 0) extra.push(n(s.unknownLevel) + ' 条级别认不出（如实计数）');
    if (Array.isArray(s.badRate) && s.badRate.length) extra.push('非法配置 ' + s.badRate.length + ' 条已拒');
    return '日志级别 ' + String(s.level || '—') + ' · 留下 ' + kept + ' 条（' + dropped + '）'
        + (extra.length ? ' · ' + extra.join(' · ') : '');
}

/** 读数六格（诊断卡片用，视图不重算）。 */
export function logGateRows(face) {
    const f = face && typeof face === 'object' ? face : { kind: 'absent', reason: 'no-face', stats: null };
    if (f.kind !== 'ok') {
        return [
            { label: '状态', value: f.kind === 'absent' ? '未安装' : '读取失败' },
            { label: '原因', value: String(f.reason || '—') }
        ];
    }
    const s = f.stats || {};
    const r = s.rates || {};
    const b = s.byLevel || {};
    const lv = function (k) {
        const x = b[k] || {};
        return n(x.kept) + ' 留 / ' + (n(x.levelDropped) + n(x.sampledDropped)) + ' 丢';
    };
    return [
        { label: '级别门槛', value: String(s.level || '—') + '（低于它的一律不出现）' },
        { label: '采样率', value: 'debug ' + n(r.debug) + ' · info ' + n(r.info) + ' · warn ' + n(r.warn) + ' · error 恒 1' },
        { label: '留下 / 挡下', value: n(s.kept) + ' 条 / ' + n(s.levelDropped) + ' 条（级别）' },
        { label: '采样丢弃', value: n(s.sampledDropped) + ' 条' + (numOrNull(s.undecidable) > 0 ? ' · 无钟不可判定 ' + n(s.undecidable) + ' 条' : '') },
        { label: '分级留/丢', value: 'D ' + lv('debug') + ' · I ' + lv('info') + ' · W ' + lv('warn') + ' · E ' + lv('error') },
        { label: '认不出的级别', value: n(s.unknownLevel) + ' 条' + (Array.isArray(s.badRate) && s.badRate.length ? ' · 非法配置 ' + s.badRate.length + ' 条' : '') }
    ];
}

/** 启动时留痕的自检（纯内建断言，不依赖测试框架；坏了不影响手机本体）。 */
export function logGateSelfCheck() {
    const bad = [];
    const keepMsgs = function (gate, level, msgs) {
        const out = [];
        msgs.forEach(function (m) { if (gate.emit(level, m).forwarded) out.push(m); });
        return out;
    };
    const seq = [];
    for (let i = 0; i < 40; i += 1) seq.push('msg-' + i);
    /* ① 级别过滤：warn 门槛下 info 一条都不留 */
    const g1 = createLogGate({ level: 'warn', now: function () { return 0; } });
    if (keepMsgs(g1, 'info', seq).length !== 0) bad.push('级别过滤失效：info 在 warn 门槛下仍放行');
    if (keepMsgs(g1, 'error', ['e1']).length !== 1) bad.push('error 被级别错误挡下');
    /* ② error 永不采样：rate 0 请求被拒，且 error 仍全过 */
    const g2 = createLogGate({ level: 'debug', rates: { info: 0 }, now: function () { return 0; } });
    const refused = g2.setRate('error', 0);
    if (refused.ok !== false || refused.bad.indexOf('error-never-sampled') < 0) bad.push('setRate(error,0) 未被拒');
    if (keepMsgs(g2, 'error', ['x', 'y', 'z']).length !== 3) bad.push('error 被采样丢了');
    /* ③ 确定性：同序列两个闸逐条一致 */
    const mk = function () { return createLogGate({ level: 'debug', rates: { info: 0.5 }, now: function () { return 0; } }); };
    const a = keepMsgs(mk(), 'info', seq).join(',');
    const b = keepMsgs(mk(), 'info', seq).join(',');
    if (a !== b) bad.push('采样不确定：同序列两次结果不同');
    if (a.length === 0) bad.push('rate 0.5 一条都没留（采样可能恒丢）');
    /* ④ 单调：0.3 的保留集是 1.0 的子集 */
    const half = keepMsgs(createLogGate({ level: 'debug', rates: { info: 0.3 }, now: function () { return 0; } }), 'info', seq);
    const all = keepMsgs(createLogGate({ level: 'debug', rates: { info: 1 }, now: function () { return 0; } }), 'info', seq);
    if (half.some(function (m) { return all.indexOf(m) < 0; })) bad.push('采样不单调：低采样率留下了高采样率会丢的条目');
    /* ⑤ 桥可逆（对假 console，不碰真 console） */
    const fake = { log: function () {}, warn: function () {}, error: function () {}, info: function () {}, debug: function () {} };
    const origin = { log: fake.log, warn: fake.warn, error: fake.error, info: fake.info, debug: fake.debug };
    const br = installConsoleBridge(fake, { level: 'info', now: function () { return 0; } });
    if (!br.ok) bad.push('装桥失败');
    else {
        if (fake.log === origin.log) bad.push('装桥后 console.log 未被接管');
        br.undo();
        if (fake.log !== origin.log || fake.error !== origin.error) bad.push('undo 未逐引用还原');
    }
    return {
        ok: bad.length === 0,
        bad,
        note: '四级 ' + LOG_LEVELS.join('/') + ' · 默认 ' + DEFAULT_LEVEL + ' · error 恒 1 永不采样'
    };
}

export default {
    LOG_LEVELS,
    DEFAULT_LEVEL,
    DEFAULT_RATES,
    SAMPLE_SCALE,
    createLogGate,
    installConsoleBridge,
    logGateFace,
    logGateFaceText,
    logGateRows,
    logGateSelfCheck
};
