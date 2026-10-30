/* ========================================================
 * config/device-face-bridge.js
 * R11-X8 · 拟真读数面（设备三域的纯映射桥）
 *
 * 为什么要有这一层：
 *   电池动力学（BatteryThermodynamics）、蜂窝弱网（CellularSignalSim）、
 *   健康手环（SmartBandBiometrics）三个内核早在 R10 就写好、也被中枢实例化了，
 *   但**产品端没有一处读它们**：
 *     · 状态栏电量读的是 `navigator.getBattery()`（宿主真机的电池），
 *       与虚拟手机自己 tick 出来的电量是两个真源 —— 剧情里手机放电到 5%，
 *       状态栏还显示宿主笔记本的 100%；
 *     · 信号永远是一个静态 Wi-Fi 图标，电梯/地下密室把格子打到 0 也看不出来；
 *     · 手环的 historyLog 声明了却从没人写过，「曲线」这件事在手机里不存在。
 *   本层把这三个读数接成产品面，并守住一条纪律：**读不到就说读不到**。
 *
 * 房式（与 config/economy-face-bridge.js / config/spotlight-face-bridge.js 同族）：
 *   ① 只做纯映射与三态合并，**不含 storage / 不写键 / 不 new 实例**；
 *   ② 活体真源在 App 侧与中枢侧，持久化不在桥里；
 *   ③ 三态不同形：「读数缺失」与「读数正常」与「读数失败」是三件事，
 *      尤其**不许拿上一次的旧读数冒充当前读数**（本层从不持有旧值）；
 *   ④ 取数口径一律走 config/num-gate.js 的 numOrNull
 *      （就地写一份 `Number.isFinite(Number(v))` 是本仓治过四轮的弱口径副本）。
 *
 * 本件零副作用：每次调用都只看传入的 read 对象，算完即返回，不留状态。
 * ======================================================== */
import { numOrNull } from './num-gate.js';

/** 设备三域（冻结，键名即 domain）。 */
export const DEVICE_FACE_DOMAINS = Object.freeze({
    BATTERY: 'battery',
    SIGNAL: 'signal',
    BAND: 'band'
});

/** 每域元信息：中文名、宿主 App（点一下能去哪看）、读不到时的那句话。 */
export const DEVICE_DOMAIN_META = Object.freeze({
    battery: Object.freeze({
        domain: 'battery', label: '电量',
        appId: 'settings', emptyLine: '电量：数据缺失（不是「没电」）'
    }),
    signal: Object.freeze({
        domain: 'signal', label: '蜂窝信号',
        appId: 'settings', emptyLine: '信号：数据缺失（不是「无服务」）'
    }),
    band: Object.freeze({
        domain: 'band', label: '生命体征',
        appId: 'health', emptyLine: '心率曲线：数据缺失（不是「没有心跳」）'
    })
});

/**
 * 读数归因词表。空串 = 正常；其余每一档都必须能在前台读出来，
 * 不许把它抹平成同一句「暂无数据」。
 */
export const DEVICE_FEED_REASONS = Object.freeze({
    OK: '',
    NO_HOST: 'no_host',                 // 宿主不在（VirtualPhone 未装配）
    NO_SUBSYSTEMS: 'no_subsystems',     // 中枢没建起来
    NO_DOMAIN: 'no_domain',             // 中枢上没有这一域实例
    NO_METHOD: 'no_method',             // 实例在但没有读数方法/字段
    READ_THREW: 'read_threw',           // 读数过程本身抛了
    BAD_RESULT: 'bad_result'            // 读回来了，但不是能用的形状
});

/** 曲线「够用」的下限：少于这个点数不许画成一条线（计划原文 ≥10 点）。 */
export const HEALTH_SERIES_MIN = 10;

/** 信号格上限（与内核的 0~5 对齐）。 */
export const SIGNAL_BARS_MAX = 5;

const LINE_SUFFIX = '（不是「没有心跳」）';

function readOf(read) {
    return (read && typeof read === 'object') ? read : null;
}

/** 归因：把读数元信息翻成「读不到」的原因（正常时为空串）。 */
function whyOf(r) {
    if (!r) return DEVICE_FEED_REASONS.NO_HOST;
    if (r.ok === true) return DEVICE_FEED_REASONS.OK;
    const why = typeof r.why === 'string' ? r.why : '';
    return why || DEVICE_FEED_REASONS.NO_DOMAIN;
}

/** 一档归因是否属于「读数过程本身出事」（与「没有数据」区分开）。 */
function isThrew(why) {
    return why === DEVICE_FEED_REASONS.READ_THREW || why === DEVICE_FEED_REASONS.BAD_RESULT;
}

/**
 * 电量读数（三态：ok / missing / threw）。
 * ★ 本函数**从不保留旧值**：读不到就报读不到，level 一律为 null。
 *   把上一次的 78% 继续挂在状态栏上，是「显示旧值冒充当前读数」——
 *   这正是本版要治的那一类谎报（中枢被换成桩时最容易发生）。
 * @param {{ok:boolean, why?:string, battery?:{level:*, charging?:*, throttling?:*}}} read
 */
export function batteryFaceOf(read) {
    const r = readOf(read);
    const why = whyOf(r);
    if (why !== DEVICE_FEED_REASONS.OK) {
        const threw = isThrew(why);
        return {
            domain: 'battery',
            state: threw ? 'threw' : 'missing',
            why,
            level: null,
            charging: false,
            throttling: false,
            stale: false,
            line: threw ? '电量：读取失败（不是「没电」）' : '电量：数据缺失（不是「没电」）'
        };
    }
    const b = r.battery;
    const level = numOrNull(b && b.level);
    if (level === null) {
        /* 中枢在、但没给出能用的电量 ⇒ 这是「读数失败」，不是「没电」。 */
        return {
            domain: 'battery', state: 'threw', why: DEVICE_FEED_REASONS.READ_THREW,
            level: null, charging: false, throttling: false, stale: false,
            line: '电量：读取失败（不是「没电」）'
        };
    }
    const pct = Math.max(0, Math.min(100, Math.round(level)));
    const charging = b.charging === true;
    const throttling = b.throttling === true;
    let line = '电量 ' + pct + '%' + (charging ? '（充电中）' : '');
    if (throttling) line += ' · 发热降频中';
    return {
        domain: 'battery', state: 'ok', why: DEVICE_FEED_REASONS.OK,
        level: pct, charging, throttling, stale: false, line
    };
}

/**
 * 蜂窝信号读数（四态：ok / weak / missing / threw）。
 * 「无服务」与「读不到」必须分成两句 —— 把后者说成前者，
 * 等于把「系统坏了」粉饰成「你在地下室」（剧情上会骗到人）。
 */
export function signalFaceOf(read) {
    const r = readOf(read);
    const why = whyOf(r);
    if (why !== DEVICE_FEED_REASONS.OK) {
        const threw = isThrew(why);
        return {
            domain: 'signal',
            state: threw ? 'threw' : 'missing',
            why,
            bars: null,
            networkType: '',
            weak: false,
            line: threw ? '信号：读取失败（不是「无服务」）' : '信号：数据缺失（不是「无服务」）'
        };
    }
    const s = r.signal;
    const bars = numOrNull(s && s.bars);
    if (bars === null) {
        return {
            domain: 'signal', state: 'threw', why: DEVICE_FEED_REASONS.READ_THREW,
            bars: null, networkType: '', weak: false,
            line: '信号：读取失败（不是「无服务」）'
        };
    }
    const n = Math.max(0, Math.min(SIGNAL_BARS_MAX, Math.round(bars)));
    const type = (s && typeof s.networkType === 'string' && s.networkType) ? s.networkType : '';
    const noService = n === 0 || type === 'NO_SERVICE';
    const weak = !noService && n <= 1;
    const head = noService ? '无服务' : (type || '蜂窝');
    const line = head + ' · ' + n + ' 格' + (noService || weak ? '（弱网）' : '');
    const deg = noService || weak;
    return {
        domain: 'signal',
        state: deg ? 'weak' : 'ok',
        why: DEVICE_FEED_REASONS.OK,
        bars: n, networkType: type, weak: deg, line
    };
}

/**
 * 生命体征曲线读数（五态：ok / thin / empty / missing / threw）。
 * 「点数不足」与「一次都没采到」分开：前者是「刚戴上」，后者是「手环没在跑」。
 * 可回溯 = 每个点都带时间戳且按时间升序（不按数组顺序照抄）。
 */
export function bandSeriesOf(read) {
    const r = readOf(read);
    const why = whyOf(r);
    const base = { domain: 'band', points: [], count: 0, enough: false, spanMs: 0 };
    if (why !== DEVICE_FEED_REASONS.OK) {
        const threw = isThrew(why);
        return Object.assign({}, base, {
            state: threw ? 'threw' : 'missing',
            why,
            line: threw ? ('心率曲线：读取失败' + LINE_SUFFIX) : ('心率曲线：数据缺失' + LINE_SUFFIX)
        });
    }
    const b = r.band;
    const raw = b && Array.isArray(b.historyLog) ? b.historyLog : [];
    const points = [];
    for (const it of raw) {
        if (!it || typeof it !== 'object') continue;
        const hr = numOrNull(it.hr != null ? it.hr : it.heartRate);
        const t = numOrNull(it.t != null ? it.t : it.ts);
        if (hr === null) continue;                 // 采样值本身不可用 ⇒ 不算一个点
        points.push({ t: t === null ? null : t, hr: Math.round(hr) });
    }
    /* 可回溯：先按时间排（缺时间戳的排在前面，如实保留而不是丢掉）。 */
    points.sort((a, c) => (a.t === null ? -1 : a.t) - (c.t === null ? -1 : c.t));
    const count = points.length;
    const enough = count >= HEALTH_SERIES_MIN;
    const withT = points.filter(p => p.t !== null);
    const spanMs = withT.length >= 2 ? (withT[withT.length - 1].t - withT[0].t) : 0;
    let state;
    let line;
    if (count === 0) {
        state = 'empty';
        line = '心率曲线：还没有采样' + LINE_SUFFIX;
    } else if (!enough) {
        state = 'thin';
        line = '心率曲线：' + count + ' 点，采样不足 ' + HEALTH_SERIES_MIN + ' 点（不是「没有心跳」）';
    } else {
        state = 'ok';
        line = '心率曲线：' + count + ' 点' + (spanMs > 0 ? '（跨度 ' + Math.round(spanMs / 60000) + ' 分钟）' : '');
    }
    return {
        domain: 'band', state, why: DEVICE_FEED_REASONS.OK,
        points, count, enough, spanMs, line
    };
}

/**
 * 一句话读数（状态栏 / 诊断页共用）：传入任一域或三域汇总 face，返回它自己的那句。
 * ★ 不编话：face 里没有 line 就如实说「数据缺失」，绝不返回一个看起来正常的读数。
 */
export function deviceLineOf(face) {
    if (!face || typeof face !== 'object') return '设备读数：数据缺失';
    return typeof face.line === 'string' && face.line ? face.line : '设备读数：数据缺失';
}

/**
 * 宿主真实电量 → 一次性种子（纯函数，不写任何东西）。
 * 为什么要有：虚拟手机首次装配时手里没有任何电量依据，直接写 85 是凭空捏造。
 *   取宿主真机那一格当**初值**是对的 —— 但它只能进一次，此后一律以中枢实例为准；
 *   两个真源同时活着就是本版要治的病。
 * @returns {{ok:boolean, level:number|null, charging:boolean, why:string}}
 */
export function seedFromHost(read) {
    const r = readOf(read);
    if (!r || r.ok !== true) {
        return { ok: false, level: null, charging: false, why: whyOf(r) || DEVICE_FEED_REASONS.NO_HOST };
    }
    const level = numOrNull(r.level);
    if (level === null) return { ok: false, level: null, charging: false, why: DEVICE_FEED_REASONS.BAD_RESULT };
    return {
        ok: true,
        level: Math.max(0, Math.min(100, Math.round(level))),
        charging: r.charging === true,
        why: DEVICE_FEED_REASONS.OK
    };
}

/**
 * 三域汇总读数（App / 诊断面用）。
 * 与单域口同纪律：任何一域读不到都**不携带旧值**，只如实报这一域的状态。
 */
export function deviceFaceOf(reads = {}) {
    const r = readOf(reads) || {};
    const battery = batteryFaceOf(r.battery);
    const signal = signalFaceOf(r.signal);
    const band = bandSeriesOf(r.band);
    const states = [battery.state, signal.state, band.state];
    const bad = states.filter(s => s !== 'ok').length;
    let line;
    if (bad === 0) {
        line = battery.line + ' · ' + signal.line + ' · ' + band.line;
    } else if (bad === 3) {
        line = '设备读数：三域都没读到（不是「一切正常」）';
    } else {
        line = '设备读数：' + (3 - bad) + '/3 域可读（其余如实标注）';
    }
    return { battery, signal, band, bad, total: 3, line };
}
