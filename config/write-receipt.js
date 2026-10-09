/* ============================================================
 * config/write-receipt.js — 写回执的唯一实现（PhoneStorage.set 的返回值怎么读）[v3.58.0 · 计划 O5]
 * ------------------------------------------------------------
 * 【治的欠债】PhoneStorage.set / remove 都是 **async**（返回 Promise）。而案头一族 App
 *   各自写了一份「同步布尔」的读数：
 *
 *       const wrote = this.storage.set(key, value);
 *       return { saved: wrote === true, why: wrote === true ? '' : 'set_false' };
 *
 *   `set()` 返回的**永远是 Promise**，`Promise === true` **恒假**。于是真环境里这一族
 *   的回执出现了一条最贵的形态 —— **`ok: true` 与 `saved: false` 恒定并存**：
 *   界面照常显示「已收下」，而那个 `saved` 永远是假的、`why` 永远是 `set_false`。
 *   它不报错、不崩溃、不进日志，只是「成功与否」这一格**永远读不出真值**。
 *   同族的另一支方向相反：`this.storage.set(k, v); return true;`（压根没摸返回值）
 *   —— 写调用抛错时也照报成功。两支合起来就是本仓对 O5 的定义：**回执与真实落盘必须一致**。
 *
 * 【为什么长期没被抓住】单元夹具用的是一次性同步假 storage（`set: (k,v) => { ...; return true }`），
 *   在夹具里 `wrote === true` 恰好成立 ⇒ 判据全绿。**夹具比被测契约更强**，于是缺陷只活在真机上。
 *   本仓对这类形态的既有结论是：不是「夹具写错了」，而是**判据没有对着真契约取值**。
 *
 * 【本模块的唯一职责】把「一次写调用到底算不算写成功」收成**一处实现**（`decideReceipt`）：
 *   · Thenable（真 PhoneStorage）⇒ 成功与否由「调用有没有抛」决定，**不把 Promise 当布尔读**；
 *   · 同步返回 `true` ⇒ 成功；
 *   · 同步返回 `false` / `undefined` / 其它 ⇒ `set_false`（**读不清 ≠ 写成功**）；
 *   · 调用抛错 ⇒ `write_threw`（与「明确的假」分面：本仓纪律，抛异常不是「没记过」，
 *     但它是**明确的**失败，与「不知道」不许塌成一格）；
 *   · 拿不到 `set` ⇒ `no_api`。
 *   两个出口（同步 / 异步）都只调这一份内核 —— 同一口径两份实现是本仓常驻判据之一。
 *
 * 【能证明什么、不能证明什么（诚实边界）】
 *   能证明：调用真的落了（没抛），且返回值不是「明确的假」。
 *   不能证明：字节真的进了 chatMetadata / extensionSettings —— 那是 `set()` 内部与宿主的事，
 *   且 `immediate !== true` 时调用方拿到的是一个已排队的 Promise，落盘在防抖之后。
 *   故本模块报出的字段名叫 `saved` 而**不叫** `committed`；需要「重开能回读」的场合，
 *   由 O5 的往返判据（写后真读一次）来证明，不靠这一格。
 *
 * 【形态惯例（本仓既有）】返回值一律 `{ saved, why }`：`saved` 只说这一格，`why` 给可读成因。
 * ============================================================ */
'use strict';

/** 收成一处：把「一次写调用 + 返回值的形态」判成回执。**不碰 storage、不抛**。 */
function decideReceipt(out, threw) {
    if (threw) return { saved: false, why: 'write_threw' };
    /* Thenable（真 PhoneStorage 的 async 契约）：不许把它当布尔读 —— 那正是本模块要消灭的那一行。 */
    if (out && typeof out.then === 'function') {
        /* 已排队的写：本刻无法回读结果，故只证明「调用落了」。附一个吞错的接驳，
         *   避免契约外实现产生未处理的 rejection（真 set() 自己 catch 并打日志）。 */
        try { Promise.resolve(out).catch(function () { /* 已由 storage 侧报告 */ }); } catch (_e) { /* 忽略 */ }
        return { saved: true, why: '' };
    }
    if (out === true) return { saved: true, why: '' };
    return { saved: false, why: 'set_false' };
}

/**
 * 读一次写的回执（同步口径：给原本就是同步的调用方）。
 * @param {object|null} storage 宿主存储（通常 PhoneStorage 实例）
 * @param {string} key 写入的键
 * @param {*} value 写入的值
 * @returns {{saved:boolean, why:string}} why 为空串表示这一格真的写下去了
 */
/* ── 相位（三阶段读数）[v3.74.0 · 计划 R-O4] ─────────────────
 * 【为什么必须有这三段】上一版把「成功」压成一个布尔 `saved`，于是三件**处置相反**的事
 *   在读数上同形：
 *     · 调用根本没落（门不过 / 抛了）—— 该报错并重试；
 *     · 调用落了、字节还没确认 —— 真宿主上这是常态（set() 返回 Promise、防抖在后）；
 *     · 落下去了，且**回读得到同一份** —— 这才是用户以为的「已保存」。
 *   本仓最贵的事故形态正是把第二段当成第三段：界面照报「已保存」，重开读不回来。
 *   相位是**读数**不是新判据：`saved` 的口径一字不改（既有调用方与判据全体不动）。
 *
 * 取值（互斥）：gate_failed / threw / not_confirmed / failed / partial / prepared / written / confirmed。
 *   其中 not_confirmed 与 partial 此前与 confirmed、saved 同形，是本次要分开的两格。
 */
export const PHASE_GATE_FAILED = 'gate_failed';
export const PHASE_THREW = 'threw';
export const PHASE_NOT_CONFIRMED = 'not_confirmed';
export const PHASE_FAILED = 'failed';
export const PHASE_PARTIAL = 'partial';
export const PHASE_PREPARED = 'prepared';
export const PHASE_WRITTEN = 'written';
export const PHASE_CONFIRMED = 'confirmed';
/** 全部相位（顺序即「从未发出 → 已确认」；判据按它核对覆盖面） */
export const RECEIPT_PHASES = Object.freeze([
    PHASE_GATE_FAILED, PHASE_THREW, PHASE_NOT_CONFIRMED, PHASE_FAILED,
    PHASE_PARTIAL, PHASE_PREPARED, PHASE_WRITTEN, PHASE_CONFIRMED,
]);

/** 相位是否认得（不许拿一个自造字符串冒充「已确认」）。
 *  ★ 判定用**循环**而不是 indexOf：两者等价，但循环让本条与 RECEIPT_PHASES 的耦合
 *    一眼可见（改常量表不必回来改这里），且不依赖同名字符串方法。 */
export function isReceiptPhase(p) {
    if (typeof p !== 'string') return false;
    for (let i = 0; i < RECEIPT_PHASES.length; i += 1) {
        if (RECEIPT_PHASES[i] === p) return true;
    }
    return false;
}

/**
 * 从「一次动作落的那几行」推相位（纯函数）。
 * 读不出一律落 failed —— 落 confirmed 要求逐行都有明确 true。
 * @param {Array<{key?:string, called?:boolean, ok?:boolean, confirmed?:boolean}>} rows
 * @returns {string} 上列八个相位之一
 */
export function phaseOf(rows) {
    const list = Array.isArray(rows) ? rows.filter((r) => r && typeof r === 'object') : [];
    /* 空行集不是成功：没有可对账的行 ⇒ 本刻不知道落没落，按 failed 报（不许虚报通过）。 */
    if (!list.length) return PHASE_FAILED;
    /* `called !== false`：未声明即「未观测到抛」。既有调用点只给 {key, ok}，
     *   本条让它们保持原相位，不把旧调用方整族降级成 prepared。 */
    if (!list.every((r) => r.called !== false)) return PHASE_PREPARED;
    const anyOk = list.some((r) => r.ok === true);
    const allOk = list.every((r) => r.ok === true);
    if (!allOk) return anyOk ? PHASE_PARTIAL : PHASE_FAILED;
    const stated = list.filter((r) => r.confirmed === true || r.confirmed === false);
    if (stated.length < list.length) return PHASE_WRITTEN;
    if (stated.every((r) => r.confirmed === true)) return PHASE_CONFIRMED;
    return stated.some((r) => r.confirmed === true) ? PHASE_PARTIAL : PHASE_NOT_CONFIRMED;
}

/** 相位的一句话（八态不许同形：读不出 / 没发 / 没落 / 部分落 / 已确认各有各的话）。
 *  ★ 「读不出的相位」这一格**先判**再进 switch：那不是 default 兜底，而是一条判定 ——
 *    自造字符串冒充「已确认」时必须落在「读不出」上，不许落进任何一格已知相位。 */
export function phaseText(p) {
    if (!isReceiptPhase(p)) return PHASE_UNKNOWN_TEXT;
    if (p === PHASE_GATE_FAILED) return '存储接口不在场 —— 写与读都不可能';
    if (p === PHASE_THREW) return '写调用抛了 —— 与「明确的假」不同形';
    if (p === PHASE_NOT_CONFIRMED) return '写了但读不回同一份 —— 不许当已保存';
    if (p === PHASE_FAILED) return '明确没落下去';
    if (p === PHASE_PARTIAL) return '只落了一部分（完成范围见 kept/lost）';
    if (p === PHASE_PREPARED) return '写还没发生（中途读数）';
    if (p === PHASE_WRITTEN) return '落盘调用成功，未回读确认';
    return '落下去了且读回一致';
}
/** 「读不出的相位」在界面上的一句话（唯一一份实现 —— 视图与诊断都取这里）。 */
export const PHASE_UNKNOWN_TEXT = '读不出的相位 —— 一律不许当成功';

/**
 * 相位 → 界面能不能说「存住了」（**唯一判据**）。
 *
 * 【为什么单独给这一格而非复用 writeLanded】`writeLanded` 判的是「这次动作算不算成」：
 *   它要同时看 `ok`（动作本身成立吗）与 `saved`（这一刀落的键盘上有没有）。
 *   而本函数只问**写**这一件事：相位读得出来时以它为准，读不出来时报 false。
 *   ★ 两者不是「同一口径两份实现」：前者是动作判据（入口在动作口），
 *     后者是**相位读数**的出口（入口在相位模型）—— 各判各的格，互不顶替。
 *   ★ 为什么必须有它：`writeLanded` 的相位门只覆盖 partial / not_confirmed 两格，
 *     其余相位（gate_failed / threw / failed / prepared）靠 `saved` 口径兜着；
 *     一旦有一处回执**既没 saved 也没 ok**、只有相位，writeLanded 会判成「不成」——
 *     那是误报。相位自己得有一条不依赖 saved 的出口。
 * @param {string} p 相位（自造字符串一律判 false）
 * @returns {boolean} 界面可以说「存住了」当且仅当相位是 confirmed
 */
export function phaseSettled(p) {
    return p === PHASE_CONFIRMED;
}

/**
 * 「读回来的是不是写下去的那一份」—— 唯一的比对口径（纯函数）。
 *
 * 【一、删除语义】真 `PhoneStorage.set(key, null)` **不是写一份 null**，它是 **remove()**
 *   （v2.84.0 起：`value === null || value === undefined` 一律委托删除）。
 *   于是「删掉」这一刀写下去的**正是「没有」**，读回来也是「没有」—— 那是一致的。
 *   若把它判成「写了但读不回」，删这一格在界面上会显示成失败。
 *
 * 【二、结构相等 ≠ 引用相等】写对象时读回来的**必然**是新对象：本仓有一族键写的是
 *   `JSON.stringify(...)` 文本；即便写的是对象树，宿主在落盘/回读时也可能做一次深拷贝。
 *   用 `got === value` 比引用，会把「结构一模一样」判成「读了但读不回」——
 *   那是**把每一次正常落对象都显示成失败**。故对象/数组走**结构相等**。
 *
 * 【三、原值仍走严格相等】`1` 与 `'1'` 结构不同、语义不同，不许因为「都长得像」而判相等；
 *   字符串 / 数字 / 布尔 / null 一律 `===`。
 *
 * 【四、深度有界】结构比较最多下钻 `SHAPE_DEPTH_MAX` 层：回读取值**不该**遍历任意深的树
 *   （那是热路径）。超深即判不等 —— 报「读不回」比「无限递归」安全：
 *   前者只是读数偏保守，后者会把界面卡死。
 * ★ 这两条（删除语义、结构相等）都是本版**自己抓到的缺陷**（探针 /tmp/t3740_c.mjs、
 *   /tmp/t3740_d.mjs 先红后修），不是推演。
 *
 * @param {*} wanted 写下去的那一份
 * @param {*} got 读回来的那一份
 * @returns {boolean} 两者是否同一份（含「都是没有」与「结构相同」两形）
 */
export function readbackSame(wanted, got) {
    return sameValue(wanted, got, 0);
}

/** 结构比较的最深下钻层数（超深判不等 —— 见 readbackSame 第四条）。 */
export const SHAPE_DEPTH_MAX = 8;

/** 两条值的同一性（readbackSame 的实现核；depth 由调用方给）。 */
function sameValue(a, b, depth) {
    /* 判「都是没有」这一形：null 与 undefined 在存储语义上同属「没有」，
     *   而写入 null 会被真宿主委托成 remove —— 故二者等价。 */
    const aEmpty = (a === null || a === undefined);
    const bEmpty = (b === null || b === undefined);
    if (aEmpty) return bEmpty;
    if (bEmpty) return false;
    if (a === b) return true;
    const aObj = (typeof a === 'object');
    const bObj = (typeof b === 'object');
    /* 对象与非对象不同形：`1` 与 `'1'` 这类绝不放行。 */
    if (aObj !== bObj) return false;
    if (!aObj) return false;
    if (depth >= SHAPE_DEPTH_MAX) return false;
    const aArr = Array.isArray(a);
    const bArr = Array.isArray(b);
    if (aArr !== bArr) return false;
    if (aArr) {
        if (a.length !== b.length) return false;
        for (let i = 0; i < a.length; i += 1) {
            if (!sameValue(a[i], b[i], depth + 1)) return false;
        }
        return true;
    }
    const ak = Object.keys(a);
    const bk = Object.keys(b);
    if (ak.length !== bk.length) return false;
    for (let i = 0; i < ak.length; i += 1) {
        const k = ak[i];
        if (!Object.prototype.hasOwnProperty.call(b, k)) return false;
        if (!sameValue(a[k], b[k], depth + 1)) return false;
    }
    return true;
}

/**
 * 形态史台账（计划 R-O4 第 5 条）：哪些键**存过两种形态**，故读侧必须容错。
 *
 * 【为什么要有台账而不是直接改】写侧已统一（实测：勘察脚本逐文件扫字面量键，
 *   **零处**同键混写），混用全部活在**读侧的历史兼容分支**上（上百处）。
 *   改它们属于另一件事（会动各件自己的坏值处置），本版先把这份「历史兼容面」
 *   变成**可核对的事实**：每条给出载体 + 键名。判据两条：台账每条必须在真源码里
 *   找得到那个键（防「台账空挂」），且这些键真被读过（同上）。
 *
 * 【它怎么被消费】`decodeStored` 在收到 `key` 时查这张表，命中即回话里带 `legacy`：
 *   那一格存过两种形态，所以它是**容错读**而不是「按新形态硬解」。
 *   测试另行逐条核对台账与真源码（防脱钩）。
 *
 * 字段：rel 载体 · key 键名 · shape 旧形态（`raw`=曾写裸对象 / `json`=曾写 JSON 文本）
 */
export const STORAGE_SHAPE_LEDGER = Object.freeze([
    { rel: 'apps/diary/diary-data.js', key: 'diary_entries', shape: 'raw' },
    { rel: 'apps/diary/diary-data.js', key: 'diary_settings', shape: 'raw' },
    { rel: 'apps/diary/diary-data.js', key: 'diary_auto_settings', shape: 'raw' },
    { rel: 'apps/music/music-data.js', key: 'music_playlist', shape: 'raw' },
    { rel: 'apps/music/music-data.js', key: 'music_card_data', shape: 'raw' },
    { rel: 'apps/phone/phone-data.js', key: 'phone_call_history', shape: 'raw' },
    { rel: 'apps/phone/phone-data.js', key: 'phone_call_contacts', shape: 'raw' },
    { rel: 'apps/phone/phone-data.js', key: 'phone_call_sms_conversations', shape: 'raw' },
    { rel: 'apps/phone/phone-data.js', key: 'phone_call_sms_processed_batches', shape: 'raw' },
    { rel: 'apps/settings/image-upload.js', key: 'phone_images', shape: 'raw' },
    { rel: 'apps/settings/settings-app.js', key: 'phone-app-custom-names', shape: 'raw' },
    { rel: 'apps/settings/settings-app.js', key: 'phone_memory_permissions', shape: 'raw' },
    { rel: 'apps/settings/settings-app.js', key: 'phone_api_config', shape: 'raw' },
]);
/** 台账的查表面（模块内唯一一份；建一次，读侧不每次遍历）。 */
const SHAPE_LEDGER_KEYS = (() => {
    const s = new Set();
    for (let i = 0; i < STORAGE_SHAPE_LEDGER.length; i += 1) s.add(STORAGE_SHAPE_LEDGER[i].key);
    return s;
})();

/**
 * 历史兼容读的**唯一口径**：把「存下去的那一格」解回对象（计划 R-O4 第 5 条）。
 *
 * 【治的欠债】混用全在**读侧**：本仓到处长着同一条分支
 *   `typeof raw === 'string' ? JSON.parse(raw) : raw`，每处的坏值处置都不一样
 *   （有的抛、有的吞成 `[]`、有的吞成 `{}`、有的判 null）。
 *   同一口径多份实现，就是「分歧只在坏值那一格上显现」的温床。
 *
 * 【三分面，不许塌】本函数把三种处境分开，**不把「解不开」静默当成「就是那个字符串」**：
 *   · 不是字符串 ⇒ 原值形态（`ok: true`, why 空）；
 *   · 空串 / 全空白 ⇒ **没写过**（`ok: true`, why `empty`，值 `null`）；
 *   · 字符串但解不开 ⇒ **读不懂**（`ok: false`, why `json`，值 `undefined`）。
 *   调用方据此决定「当空」还是「报坏」—— 那是**调用方的**判断，本函数不下结论。
 *
 * @param {*} raw `storage.get(key, ...)` 读回来的原样
 * @param {string} [key] 键名（给了才查形态史台账；不给就纯解码）
 * @returns {{ok:boolean, why:string, value:*, legacy:boolean}} `legacy` 为真表示这个键
 *          在形态史台账里（**容错读**），不是「按新形态硬解」。
 */
export function decodeStored(raw, key) {
    const legacy = (typeof key === 'string') && SHAPE_LEDGER_KEYS.has(key);
    if (typeof raw !== 'string') return { ok: true, why: '', value: raw, legacy: legacy };
    if (raw.trim() === '') return { ok: true, why: 'empty', value: null, legacy: legacy };
    try {
        return { ok: true, why: '', value: JSON.parse(raw), legacy: legacy };
    } catch (_e) {
        return { ok: false, why: 'json', value: undefined, legacy: legacy };
    }
}

/**
 * 单键写 + **回读确认**（三阶段一次给全）[v3.74.0 · 计划 R-O4 第 2 条]。
 * 【与 writeReceipt 的分工】writeReceipt 只证明「调用落了」——那是**那一刻**；
 *   本出口多走一步：写之后按同一把键读回来，比「读回来的与写下去的是不是同一份」。
 * 【为什么不是默认行为】读一次就多一次宿主调用；热路径（每帧写一格的缓存）上不该有。
 *   故它是个**显式**出口：调用方自己决定这一步值不值。
 * 【诚实边界】回读一致**不证明**字节进了 chatMetadata —— `immediate !== true` 时
 *   落盘在防抖之后，本刻读回的可能是尚未落盘的旧值而非报错。故相位止于 `confirmed`
 *   （「这一次读写往返一致」），不叫 `durable`。
 * @param {object|null} storage
 * @param {string} key
 * @param {*} value 写入值（另用 `readOne` 读回同一把键做比较）
 * @param {(key:string)=>*} [readOne] 默认取 storage.get
 * @returns {{saved:boolean, why:string, phase:string, confirmed:boolean, got:*}}
 */
export function writeConfirmed(storage, key, value, readOne) {
    if (!storage || typeof storage.set !== 'function') {
        return { saved: false, why: 'no_api', phase: PHASE_GATE_FAILED, confirmed: false, got: undefined };
    }
    const r = writeReceipt(storage, key, value);
    if (r.saved !== true) {
        return {
            saved: false, why: r.why,
            phase: (r.why === 'write_threw' ? PHASE_THREW : PHASE_FAILED),
            confirmed: false, got: undefined,
        };
    }
    /* 读回那一格：不传 readOne 就用 storage.get（这是**唯一**合法默认 —— 换别的读法
     *   等于「写进 A、读自 B」，那时一致与否都不说明写成功了）。 */
    const read = (typeof readOne === 'function')
        ? readOne
        : ((k) => storage.get(k, null));
    let got;
    let readThrew = false;
    try { got = read(key); } catch (_e) { readThrew = true; }
    if (readThrew) {
        /* 读不出来：**不许**当已保存，也不许说成「明确没落」——那是两件事。
         *   （「读抛了」与「读回空」也不同形：前者是坏，后者是空。） */
        return { saved: true, why: '', phase: PHASE_NOT_CONFIRMED, confirmed: false, got: undefined };
    }
    /* [v3.74.0 自纠] 比对走 readbackSame：**写 null 即删除**时「读回空」正是写下去的那一份，
     *   判成 not_confirmed 会让每次删除都在界面上显示失败（探针 /tmp/t3740_c.mjs 抓到的真形态）。 */
    const same = readbackSame(value, got);
    return {
        saved: true, why: '',
        phase: same ? PHASE_CONFIRMED : PHASE_NOT_CONFIRMED,
        confirmed: same, got: got,
    };
}

/**
 * 逐行回读确认（纯函数：不改入参、不碰 storage、不抛）[v3.74.0 · 计划 R-O4]。
 *
 * 【一条关键分野】「**没做**回读」与「**做了**但读不回」是两件事，本函数必须让它们可分 ——
 *   故 `readOne` 不是函数时**一个都不标**（相位止于 written）；传了函数才逐行标 true/false。
 *   若把「没做」也标成 false，全仓每一次普通写都会显示「写了但读不回」，那不是诚实，是另一种失真。
 * @param {Array<{key?:string, ok?:boolean, value?:*}>} rows 行里带 `value` 时才比得出「同一份」
 * @param {(key:string)=>*} [readOne] 读一格（抛了即视为**读不回来**，不当成一致）
 * @returns {Array<object>} 新行集：传了 readOne 时每行多 `confirmed`（true/false），读不回来另有 `notReadBack`
 */
export function confirmRows(rows, readOne) {
    const list = Array.isArray(rows) ? rows : [];
    const hasReader = (typeof readOne === 'function');
    const out = [];
    for (const r of list) {
        const row = Object.assign({}, r);
        const hasWanted = Object.prototype.hasOwnProperty.call(row, 'value');
        if (!hasReader || row.ok !== true || !hasWanted) {
            /* 没落下去的行没有「读回同一份」可言：报 false，且不冒充读到了。
             *   没传读者的行则**不标**（见上面那条分野）。 */
            if (hasReader) row.confirmed = false;
            out.push(row);
            continue;
        }
        let got;
        try { got = readOne(row.key); }
        catch (_e) {
            /* 读抛了：与「读不到东西」不同形 —— 前者是坏，后者是空。 */
            row.confirmed = false;
            row.notReadBack = true;
            out.push(row);
            continue;
        }
        if (got === undefined || got === null) {
            /* 读回空：若行里写的**本来就是空**（`set(k, null)` = 删这一格），那正是写下去的那一份；
             *   否则记为「读了读不回」。★ 与 writeConfirmed 同一口径（readbackSame），
             *   不许两处各判一遍 —— 那正是本模块头注里点名要消灭的形态。 */
            if (readbackSame(row.value, got)) { row.confirmed = true; out.push(row); continue; }
            row.confirmed = false;
            row.notReadBack = true;
            out.push(row);
            continue;
        }
        row.confirmed = readbackSame(row.value, got);
        out.push(row);
    }
    return out;
}

/**
 * 一次动作的**完整回执**：完成范围（既有 collectReceipt 口径）+ 相位 + 逐行确认读数。
 * `saved` 仍是「全部键都落了」，一字不改 —— 相位是**多出来**的那一栏。
 * @param {Array<{key:string, ok:boolean, value?:*}>} rows
 * @param {(key:string)=>*} [readOne] 不传即不做回读（相位止于 written）
 * @returns {{saved:boolean, why:string, kept:string[], lost:string[], phase:string, rows:Array<object>}}
 */
export function writeScopeReceipt(rows, readOne) {
    const confirmed = confirmRows(rows, readOne);
    const scope = collectReceipt(confirmed);
    return {
        saved: scope.saved, why: scope.why, kept: scope.kept, lost: scope.lost,
        phase: phaseOf(confirmed), rows: confirmed,
    };
}

export function writeReceipt(storage, key, value) {
    if (!storage || typeof storage.set !== 'function') return { saved: false, why: 'no_api' };
    let out = null;
    let threw = false;
    try {
        out = storage.set(key, value);
    } catch (_e) {
        threw = true;
    }
    return decideReceipt(out, threw);
}

/**
 * 同一件事的异步版：真 PhoneStorage 上等它落队（语义完全一致，只多一次等待）。
 * @returns {Promise<{saved:boolean, why:string}>}
 */
export async function writeReceiptAsync(storage, key, value) {
    if (!storage || typeof storage.set !== 'function') return { saved: false, why: 'no_api' };
    let out = null;
    let threw = false;
    try {
        out = storage.set(key, value);
        if (out && typeof out.then === 'function') await out;
    } catch (_e) {
        threw = true;
    }
    return decideReceipt(out, threw);
}

/**
 * 多键写：把**同一动作里落的那几条键**的完成范围收成一份回执（计划 O5「多键操作记录完成范围」）。
 *
 * 【治的欠债】动作口常一次落好几条键（收下原文 → 再落投影与台账）。此前各件写的是
 *
 *     this._persistPack();
 *     const wrote = this._persistFace();
 *     return Object.assign(this._savedOk(wrote), { ok: true, ... });
 *
 * —— 前一次的结果**直接丢掉**，`saved` 只反映最后一条键。于是「正文没落下去、投影落下了」
 * 这种情况在界面上完全等于成功：下一次打开，正文没了、投影还在，两边对不上。
 *
 * 【口径】`saved` = **全部**键都落了（`saved` 只回答「一次单键写落没落」，
 * 本出口回答「这次动作整个落没落」）；`kept` / `lost` = 落了的 / 没落的，给可读归因。
 *
 * @param {Array<{key:string, ok:boolean, why?:string}>} rows 顺序即落盘顺序
 * @returns {{saved:boolean, why:string, kept:string[], lost:string[]}} why 为第一条没落的键的成因
 */
export function collectReceipt(rows) {
    const list = Array.isArray(rows) ? rows : [];
    const kept = [];
    const lost = [];
    let firstWhy = '';
    for (const r of list) {
        const key = (r && typeof r.key === 'string') ? r.key : '';
        if (r && r.ok === true) { kept.push(key); continue; }
        lost.push(key);
        if (!firstWhy) firstWhy = (r && typeof r.why === 'string' && r.why) ? r.why : 'write_failed';
    }
    return { saved: lost.length === 0 && list.length > 0, why: firstWhy, kept: kept, lost: lost };
}


/**
 * 界面该不该说「成了」—— 视图层播报的**唯一判据**（不许各件自己判一遍）。
 *
 * 【为什么不是 `r.ok`】两格回答的是不同的问题：
 *   · `ok`    = 这个动作**本身**成立吗（输入认得出、结果算得出）；
 *   · `saved` = 这一刀落的键**盘上有没有**。
 *   用 `ok` 播报，就是「没写下去也说写下去了」—— 用户照着提示条以为存住了，
 *   重开才发现原文没了、只剩投影。计划 O5 验收原文点名这一条：
 *   「多键中途失败时**不显示**已保存」。
 *
 * 【诚实边界】本判据只保证播报不再与回执相左；它不证明字节进了宿主存储
 *   （那是 `set()` 内部与宿主的事，由 O5 的重开往返判据负责）。
 *   存储不可用时各件已经报 `saved: false`，故此处无需再读 `storage` 一格 ——
 *   同一件事读两处，正是「同一口径两份实现」的开端。
 *
 * 【四态】**不带 `saved` 的返回体沿用 `ok` 口径** —— 本仓多数读法（取一格、算一段、
 *   定位一条）压根不写盘，它们的「成」与落盘无关，没有 `saved` 可对；要求它们也有
 *   `saved` 就是把「读法」按「写法」判。反过来，只要回执**带了** `saved`，
 *   就以它为准 —— 写口一律带（这一点由本套件 R3 接线面钉住）。
 *
 * @param {{ok?:boolean, saved?:boolean}|null} r 动作口返回体
 * @returns {boolean} 界面可以说「成」当且仅当动作成立**且**（带 `saved` 时必须真）
 */
export function writeLanded(r) {
    if (!r || r.ok !== true) return false;
    /* [v3.74.0 · 计划 R-O4] 带相位时，**只有** written / confirmed 两格能过 —— 它们正是
     *   本版要分开的那些格：其余六个相位在界面上都**不许**说「已保存」，理由各不相同：
     *     · partial       多键里一部分落了 ⇒ 重开就是「正文没了、投影还在」；
     *     · not_confirmed 写了但读不回同一份 ⇒ 用户重开才发现没存住；
     *     · 另外四个      写压根没发生 / 落不下去（saved 口径本就为假，此处再钉一道）。
     *   自造相位（读不出来的字符串）同样判不成：不许拿一个没定义的字符串冒充已确认。
     *   未回读的 written 必须放过 —— 它是真宿主上的常态，判成失败会让全部写口
     *   在真机上显示失败，那不是诚实，是另一种失真。 */
    if (typeof r.phase === 'string') {
        if (!isReceiptPhase(r.phase)) return false;
        if (r.phase !== PHASE_WRITTEN && r.phase !== PHASE_CONFIRMED) return false;
    }
    return (typeof r.saved === 'boolean') ? (r.saved === true) : true;
}
