/* ============================================================
 * resume-handoff.js — [v3.63.0 · X8 第二切片] 受控恢复交接内核
 *                              （**预检 → 执行 → 回读**三段闸门）
 * ------------------------------------------------------------
 * 【为什么需要它 / 修前实测后果（不是整洁性偏好）】
 *   X8 原文：「恢复只委托真实宿主/引擎 owner。**先完成只读导航，再推进受控恢复交接**」
 *   验收原文：「**恢复前预检、恢复后回读，旧异步写入被拒**」。
 *
 *   本仓实测（逐条对应上面三句）：
 *     · **恢复前预检**此前**不存在**。全仓唯一与「读档」有关的写面在
 *       `config/floor-store.js`（`appendBatch` / `removeByFloor` / `removeById`）与
 *       `apps/archive/archive-data.js`（覆盖式导入 / 全量重置），
 *       它们**拿到指令就动手**，没有任何一处先回答「现在到底能不能恢复」；
 *     · **恢复后回读**此前**不存在**。B 支「真的恢复成功了吗」只能靠 user 自己再打开一遍页面看
 *       —— 而「恢复动作抛错」与「恢复写了但写丢了」在这套路径下**长得一样**；
 *     · **旧异步写入被拒**此前**只有一半**：`config/session-gate.js`（O4 交付）已经能挡下
 *       「会话身份变了 / 世代涨了」的旧回信，但它**不认识「恢复」这件事** ——
 *       恢复动作本身会改数据，而**在恢复过程中**飞出去的回信会拿着恢复**之前**的代际，
 *       回来时 gate 判它「还算当前」（id 与 epoch 都没变，因为恢复改的是数据不是会话身份）
 *       ⇒ 它把**旧分支的内容写进刚恢复好的存档**。这正是本切片要堵的那一格。
 *
 * 【本模块只做三件事（多一件都会变成第二处真源）】
 *   ① **预检（precheck）**：动手前把「能不能恢复」变成**可判定**的读数 ——
 *      目标存在吗、会话身份取到了吗、当前数据是空的还是非空的、有没有在飞的回信；
 *      并把结论收成三档 `ok` / `blocked` / `unusable`（**不可测 ≠ 通过**）；
 *   ② **交接（handoff）**：把「恢复」这件事**委托给真实 owner** —— 本模块**不自带任何写面**，
 *      执行体由调用方注入（`opts.apply`）。恢复**只发生一次**：同一 `handoffId` 重复调用
 *      返回**首次结果**（幂等），绝不二次执行；
 *   ③ **回读（readback）**：恢复后**从 owner 重新取一遍真读数**并做读后校验 ——
 *      写面自述的成功（`apply` 返回 `{ok:true}`）**不作为**恢复成功的证据。
 *      三态必须不同形：`ok` / `mismatch`（回读与预期不符）/ `unreadable`（回读取不到）。
 *
 * 【旧异步写入被拒（本切片的第三条验收，实现方式）】
 *   本模块持一枚**进程内交接世代号**（`handoffEpoch`），每次进入恢复流程就 +1，
 *   且**在任何写动作之前** +1。在飞的回信出发时记下 { sessionToken, handoffEpoch }，
 *   回信时**两把闸门都要过**：
 *     · `config/session-gate.js` 的会话身份栅栏（id + epoch）——已有，管「换了会话」；
 *     · 本模块的交接栅栏 `guardHandoffWrite`（handoffEpoch 比对）——新增，管「恢复过数据」。
 *   只过一把都不算当前。**本模块不重写会话栅栏**（那是第二处真源），只做它的**补充维度**。
 *
 * 【不做什么（边界，防第二份真源）】
 *   · **不做取数**：目标清单、会话身份、当前数据面、在飞回信清单全部由调用方给；
 *   · **不做写**：本模块只 import 取数门 `numOrNull`（零依赖叶子），**结构上**没有任何执行体 —— `apply` 由调用方注入；
 *   · **不重算回读**：回读的比对口径是「调用方给的 `expect` 与调用方取的 `observed`」，
 *     本模块只判「有没有、一不一样」，不自己解释业务；
 *   · **不读时钟、不读存储、不带计时器**：纯函数（`at` 由调用方给），可在合成输入上复算。
 * ============================================================ */
import { numOrNull } from './num-gate.js';

export const HANDOFF_VERSION = 1;

/** 预检三档（**不可测 ≠ 通过**，本仓最贵的老账）。 */
export const PRECHECK_STATES = Object.freeze({
    OK: 'ok',
    BLOCKED: 'blocked',
    UNUSABLE: 'unusable'
});

/** 回读三档（写面自述的成功不是证据）。 */
export const READBACK_STATES = Object.freeze({
    OK: 'ok',
    MISMATCH: 'mismatch',
    UNREADABLE: 'unreadable'
});

/** 交接总状态（三档，互不同形）。 */
export const HANDOFF_STATES = Object.freeze({
    HELD: 'held',          // 预检不过 ⇒ 根本没动手（held = 拦住了）
    DONE: 'done',          // 执行体真跑了且回读通过
    PARTIAL: 'partial'     // 执行体跑了但回读不符
});

/** 预检各项（顺序固定，UI 可直接按此渲染；**缺一不可**）。 */
export const PRECHECK_CHECKS = Object.freeze([
    'target',      // 目标存在（缺 ⇒ blocked；清单读不到 ⇒ unusable）
    'identity',    // 会话身份取到了（缺 ⇒ unusable，不是 blocked）
    'inFlight',    // 有没有在飞的旧回信（有 ⇒ blocked，且**说出是哪几条**）
    'current'      // 当前数据面（空 / 非空 —— 非空**不是**阻塞项，但必须显式告知会被覆盖）
]);

/** 拒绝原因 → 可读中文（诊断面直出，不在这里做二次解释）。 */
export const HANDOFF_REASON_TEXT = Object.freeze({
    'no-target': '目标不存在（这份存档/分支不在清单里）',
    'target-list-unreadable': '目标清单读不到（**不是**「没有这份存档」）',
    'no-identity': '会话身份取不到（此刻读不出发言人会话）',
    'in-flight': '有在飞的旧回信（恢复前必须先把它们挡住）',
    'precheck-failed': '预检未通过（见 checks）',
    'no-applier': '没有注入执行体（恢复委托真实 owner —— 本模块自己没有写面）',
    'applier-threw': '执行体抛错（已记账，未回读）',
    'applier-refused': '执行体拒绝（真实 owner 说不）',
    'readback-mismatch': '回读与预期不符（写面自述成功不算证据）',
    'readback-unreadable': '回读取不到（**不是**「回读一致」）',
    'already-done': '本交接已完成（重复调用返回首次结果，不二次执行）'
});

/* ---------------- 进程内交接世代号（唯一可变状态，有界账本） ---------------- */
const HANDOFF_LOG_MAX = 60;
const gate = { epoch: 0, log: [], done: new Map() };

/**
 * 进入一次恢复流程：交接世代 +1。**必须在任何写动作之前调用**。
 * @returns {number} 新世代号
 */
export function bumpHandoffEpoch(reason = 'restore') {
    gate.epoch += 1;
    return gate.epoch;
}

/** 当前交接世代号（只读）。 */
export function handoffEpoch() {
    return gate.epoch;
}

/**
 * 在飞回信出发时记令牌。**任务开始那一刻调，不要等回来了再调**
 *   —— 回来时取到的是「现在」，那就永远判当前，栅栏等于没建。
 *
 * @param {object} sessionToken `config/session-gate.js` 的 `captureSessionToken` 结果
 * @returns {{session:object, handoff:number}} 双维令牌
 */
export function captureHandoffToken(sessionToken) {
    return { session: sessionToken || null, handoff: gate.epoch };
}

/**
 * 交接栅栏：这一轮回信的令牌还算不算「恢复前那一段」。
 *
 * 【为什么必须是**两把**闸门】会话身份栅栏（session-gate）判的是「会话换了没」；
 *   恢复动作**不改会话身份**（id 与 epoch 都不动，改的是数据），故旧回信在它眼里
 *   完全合法。本函数补的正是这一维：**恢复期间飞出去的回信一律作废**。
 *
 * @returns {'current'|'invalid-token'|'epoch-bumped'} 判决
 */
export function handoffWriteReason(token) {
    if (!token || typeof token !== 'object') return 'invalid-token';
    const t = Number(token.handoff);
    if (!Number.isFinite(t)) return 'invalid-token';
    if (t !== gate.epoch) return 'epoch-bumped';
    return 'current';
}

/**
 * 回信写回前的唯一门槛（**交接维**）。`false` = 已挡下并记账，调用方必须原样 return。
 *   ★ 与 `session-gate.js` 的 `guardSessionWrite` **串联**使用，不是替代：
 *     前者管会话身份，本函数管交接世代。**两把都要过**。
 *
 * @param {object} token `captureHandoffToken` 的返回
 * @param {string} domain 诊断用域名（如 diary-photo / wechat-image）
 * @returns {boolean} true = 允许写回
 */
export function guardHandoffWrite(token, domain = '') {
    const reason = handoffWriteReason(token);
    if (reason === 'current') return true;
    const entry = {
        domain: String(domain || 'unknown').trim() || 'unknown',
        reason: reason,
        text: reason === 'epoch-bumped'
            ? '交接世代已变（恢复流程已开始）—— 本回信出发于恢复之前'
            : '令牌畸形（交接世代取不到数）',
        at: Date.now()
    };
    gate.log.push(entry);
    if (gate.log.length > HANDOFF_LOG_MAX) gate.log.splice(0, gate.log.length - HANDOFF_LOG_MAX);
    return false;
}

/** 被挡下的旧回信只读读数（诊断中心消费；返回快照副本）。 */
export function handoffDropLog() {
    return {
        epoch: gate.epoch,
        count: gate.log.length,
        rows: gate.log.map((row) => Object.assign({}, row))
    };
}

/* ---------------- 预检 ---------------- */
/**
 * 恢复前预检（**只看不写**）。四道检查一件不落地收集，不早退 ——
 *   早退会让「同时在场的两个问题」只报出一个，用户修完一个再撞第二个。
 *
 * @param {object} input
 *   · `target`       目标标识（存档/分支名；空 ⇒ blocked）
 *   · `targets`      目标清单（**数组**；`null` ⇒ 清单读不到 ⇒ unusable，不是「没有」）
 *   · `identity`     会话身份（串；空 ⇒ unusable）
 *   · `inFlight`     在飞回信清单（数组；`null` ⇒ 读不到 ⇒ unusable）
 *   · `current`      当前数据面读数（`{rows:number|null}`；`null` ⇒ 读不到 ⇒ unusable）
 *   · `at`           时间戳（由调用方给）
 * @returns 恒定键面读数
 */
export function precheckHandoff(input = {}) {
    const o = (input && typeof input === 'object') ? input : {};
    const checks = [];
    const add = (key, state, reason) => checks.push({ key: key, state: state, reason: reason || '' });

    /* ① 目标清单（先判「读不读得到」，再判「有没有」—— 两者处置相反） */
    const target = String(o.target == null ? '' : o.target).trim();
    let targetKnown = null;
    if (!Array.isArray(o.targets)) {
        add('target', 'unusable', 'target-list-unreadable');
    } else if (!target) {
        add('target', 'blocked', 'no-target');
    } else if (!o.targets.map((x) => String(x == null ? '' : x)).includes(target)) {
        add('target', 'blocked', 'no-target');
    } else {
        targetKnown = true;
        add('target', 'ok', '');
    }

    /* ② 会话身份（取不到 ⇒ unusable：恢复委托 owner 时 owner 也在同一段会话上动手） */
    const identity = String(o.identity == null ? '' : o.identity).trim();
    if (identity) add('identity', 'ok', '');
    else add('identity', 'unusable', 'no-identity');

    /* ③ 在飞回信（有 ⇒ blocked，且**点名**；读不到 ⇒ unusable） */
    let inFlight = null;
    let inFlightCount = 0;
    if (!Array.isArray(o.inFlight)) {
        add('inFlight', 'unusable', 'in-flight-unreadable');
    } else {
        inFlight = o.inFlight.map((x) => String((x && x.domain) || x || 'unknown'));
        inFlightCount = inFlight.length;
        if (inFlightCount) add('inFlight', 'blocked', 'in-flight');
        else add('inFlight', 'ok', '');
    }

    /* ④ 当前数据面（空/非空**都不是**阻塞项 —— 但必须显式告知覆盖语义） */
    let currentRows = null;
    let currentState = 'unusable';
    const cur = o.current;
    const curRows = (cur && typeof cur === 'object') ? numOrNull(cur.rows) : null;
    if (curRows !== null) {
        currentRows = curRows;
        currentState = currentRows > 0 ? 'non-empty' : 'empty';
        add('current', 'ok', currentState);
    } else {
        add('current', 'unusable', 'current-unreadable');
    }

    const state = checks.some((c) => c.state === 'unusable') ? PRECHECK_STATES.UNUSABLE
        : (checks.some((c) => c.state === 'blocked') ? PRECHECK_STATES.BLOCKED : PRECHECK_STATES.OK);
    const blockedBy = checks.filter((c) => c.state !== 'ok').map((c) => c.key);

    return {
        version: HANDOFF_VERSION,
        state: state,
        target: target,
        targetKnown: targetKnown,
        identity: identity,
        checks: checks,
        blockedBy: blockedBy,
        inFlight: inFlight,
        inFlightCount: inFlightCount,
        currentRows: currentRows,
        currentState: currentState,
        /* 覆盖语义**只在非空时说**：空档覆盖没什么可提醒的，说了会造成噪声。 */
        overwritesExisting: currentState === 'non-empty',
        epoch: gate.epoch,
        at: (typeof o.at === 'number' ? o.at : 0),
        why: precheckWhy(state, blockedBy, currentState)
    };
}

function precheckWhy(state, blockedBy, currentState) {
    if (state === PRECHECK_STATES.OK) {
        return '预检通过' + (currentState === 'non-empty' ? '；注意当前数据面非空，恢复将**覆盖**它' : '（当前数据面为空）');
    }
    if (state === PRECHECK_STATES.UNUSABLE) {
        return '有取不到的项（' + blockedBy.join(' / ') + '）⇒ **不给恢复**（不可测 ≠ 通过）';
    }
    return '阻塞项：' + blockedBy.join(' / ') + ' ⇒ 先处理再恢复';
}

/* ---------------- 交接（预检 → 执行 → 回读 三段闸门） ---------------- */
/**
 * 受控恢复交接。**三段闸门一次性走完，任一段不过就停在那里**（不停在半路）。
 *
 * @param {object} input 预检的全部字段，另加：
 *   · `handoffId` 本次交接标识（**幂等键**：同一 id 重复调用返回首次结果）
 *   · `expect`    回读预期（调用方给的**真值面**，如 `{rows:number}`）
 *   · `observed`  回读读数（调用方从 owner **重新取**的真读数；`null` ⇒ unreadable）
 *   · `apply`     执行体（**真实 owner** 注入；缺 ⇒ held + no-applier）
 * @returns 恒定键面读数（含 precheck / execute / readback 三段各自读数）
 */
export function handoffResume(input = {}) {
    const o = (input && typeof input === 'object') ? input : {};
    const id = String(o.handoffId == null ? '' : o.handoffId).trim();
    const at = (typeof o.at === 'number' ? o.at : 0);

    /* 幂等：同一交接 id 只执行一次，重复调用**返回首次结果**（不二次执行）。 */
    if (id && gate.done.has(id)) {
        const first = gate.done.get(id);
        return Object.assign({}, first, { state: HANDOFF_STATES.DONE, idempotent: true,
            why: HANDOFF_REASON_TEXT['already-done'] });
    }

    const pre = precheckHandoff(o);
    const out = {
        version: HANDOFF_VERSION,
        id: id,
        ts: at,
        state: HANDOFF_STATES.HELD,
        applied: false,
        idempotent: false,
        precheck: pre,
        execute: null,
        readback: null,
        epoch: gate.epoch,
        why: ''
    };

    /* 第①段：预检不过 ⇒ **根本没动手**（held = 拦住了，不是「失败」）。 */
    if (pre.state !== PRECHECK_STATES.OK) {
        out.why = HANDOFF_REASON_TEXT['precheck-failed'] + '：' + pre.why;
        return out;
    }
    /* 没有执行体 ⇒ 不动手（本模块自己**没有**写面，这是结构性的，不是运行时分支）。 */
    if (typeof o.apply !== 'function') {
        out.why = HANDOFF_REASON_TEXT['no-applier'];
        return out;
    }

    /* 第②段：**先抬交接世代，再执行** —— 顺序反了就会有一段窗口里的旧回信
     *   拿着「还没抬」的世代回来，正好写进刚恢复好的数据里。 */
    const before = gate.epoch;
    const after = bumpHandoffEpoch('restore:' + (id || 'anonymous'));
    out.epoch = after;

    let res = null;
    let threw = null;
    try {
        res = o.apply({ target: pre.target, handoffId: id, epoch: after, at: at });
    } catch (e) {
        threw = e;
    }
    if (threw) {
        out.execute = { ran: true, ok: false, reason: 'applier-threw',
            note: String((threw && threw.message) || threw) };
        out.why = HANDOFF_REASON_TEXT['applier-threw'];
        return out;
    }
    const okSelf = !!(res && typeof res === 'object' && res.ok === true);
    out.execute = {
        ran: true,
        ok: okSelf,
        reason: okSelf ? 'ok' : String((res && res.reason) || 'applier-refused'),
        epochBefore: before,
        epochAfter: after
    };
    if (!okSelf) {
        out.why = HANDOFF_REASON_TEXT['applier-refused'] + '（' + out.execute.reason + '）';
        return out;
    }
    out.applied = true;

    /* 第③段：回读 —— **写面自述的成功不作为证据**，一律从 owner 重取一遍。 */
    out.readback = readbackOf(o, at);
    if (out.readback.state === READBACK_STATES.OK) {
        out.state = HANDOFF_STATES.DONE;
        out.why = '恢复完成且回读一致';
        if (id) gate.done.set(id, Object.assign({}, out, { epoch: after }));
    } else if (out.readback.state === READBACK_STATES.MISMATCH) {
        out.state = HANDOFF_STATES.PARTIAL;
        out.why = HANDOFF_REASON_TEXT['readback-mismatch'];
    } else {
        out.state = HANDOFF_STATES.PARTIAL;
        out.why = HANDOFF_REASON_TEXT['readback-unreadable'];
    }
    return out;
}

/**
 * 回读判定（**唯一实现**）：三态不同形。
 *   ① `expect` 或 `observed` 取不到 ⇒ `unreadable`（**不是**「一致」）；
 *   ② 逐键比 ⇒ 不一致 `mismatch`（并点出**哪些键**不符，不止「不一致」）；
 *   ③ 全一致 ⇒ `ok`。
 */
export function readbackOf(input = {}, at = 0) {
    const o = (input && typeof input === 'object') ? input : {};
    const expect = (o.expect && typeof o.expect === 'object') ? o.expect : null;
    const obs = (o.observed && typeof o.observed === 'object') ? o.observed : null;
    if (!expect || !obs) {
        return {
            state: READBACK_STATES.UNREADABLE,
            reason: (!expect ? 'expect-missing' : 'observed-missing'),
            rows: null, mismatched: [], compared: 0, at: at,
            why: HANDOFF_REASON_TEXT['readback-unreadable'] + '（' + (!expect ? '预期面没给' : '回读面没取到') + '）'
        };
    }
    const mismatched = [];
    const keys = Object.keys(expect);
    for (const k of keys) {
        const a = expect[k];
        const b = obs[k];
        const same = (a === b) || (JSON.stringify(a) === JSON.stringify(b));
        if (!same) mismatched.push({ key: k, expect: brief(a), observed: brief(b) });
    }
    /* 多出来的键也算不符：回读**比预期多**同样是「写面写的不是我们要的那件事」。 */
    for (const k of Object.keys(obs)) {
        if (!Object.prototype.hasOwnProperty.call(expect, k)) {
            mismatched.push({ key: k, expect: '(未预期)', observed: brief(obs[k]) });
        }
    }
    return {
        state: mismatched.length ? READBACK_STATES.MISMATCH : READBACK_STATES.OK,
        reason: mismatched.length ? 'mismatch' : 'ok',
        rows: numOrNull(obs.rows),
        mismatched: mismatched,
        compared: keys.length,
        at: at,
        why: mismatched.length
            ? ('回读不符 ' + mismatched.length + ' 处：' + mismatched.map((m) => m.key).join(' / '))
            : '回读一致（' + keys.length + ' 个键逐值相等）'
    };
}

function brief(v) {
    if (v === null) return 'null';
    if (v === undefined) return 'undefined';
    const t = typeof v;
    if (t === 'string') return v.length > 40 ? (v.slice(0, 40) + '…') : v;
    if (t === 'number' || t === 'boolean') return String(v);
    if (Array.isArray(v)) return '[' + v.length + ' 项]';
    if (t === 'object') return '{' + Object.keys(v).length + ' 键}';
    return String(v);
}

/* ---------------- 一行文案（唯一实现） ---------------- */
/** 预检一行文案（三档各自成形；**缺席与空不同形**）。 */
export function precheckLine(p) {
    if (!p || typeof p !== 'object') return '[预检] 读数不可用';
    if (p.state === PRECHECK_STATES.UNUSABLE) return '[预检] 不可测：' + p.why;
    if (p.state === PRECHECK_STATES.BLOCKED) return '[预检] 阻塞：' + p.why;
    return '[预检] 可恢复' + (p.overwritesExisting ? '（当前 ' + p.currentRows + ' 行将被**覆盖**）' : '（当前数据面为空）');
}

/** 交接一行文案（三段闸门各自可见；**held ≠ partial ≠ done**）。 */
export function handoffLine(h) {
    if (!h || typeof h !== 'object') return '[交接] 读数不可用';
    const seg = (h.precheck && h.precheck.state) || 'unknown';
    if (h.state === HANDOFF_STATES.HELD) return '[交接] 未动手（预检 ' + seg + '）：' + (h.why || '');
    const rb = h.readback ? h.readback.state : 'unknown';
    if (h.state === HANDOFF_STATES.DONE) {
        return '[交接] 已完成（预检 ok · 执行 ok · 回读 ' + rb + '）'
            + (h.idempotent ? '（重复调用，未二次执行）' : '');
    }
    return '[交接] 部分完成（预检 ok · 执行 ok · 回读 ' + rb + '）：' + (h.why || '');
}

/** 交接栅栏一行文案（**与 session-gate 的文案分列** —— 两种拒绝原因不同）。 */
export function handoffGateLine(log) {
    const L = (log && typeof log === 'object') ? log : null;
    if (!L) return '交接栅栏：读不到账本 —— 这不是「没有被挡下的回信」';
    if (!L.count) return '交接栅栏：当前交接世代 ' + String(L.epoch) + '，本轮无恢复，未被挡下任何回信。';
    return '交接栅栏：当前交接世代 ' + String(L.epoch) + '，已挡下 ' + String(L.count) + ' 条恢复前的旧回信。';
}

export default {
    precheckHandoff, handoffResume, readbackOf,
    bumpHandoffEpoch, handoffEpoch, captureHandoffToken, handoffWriteReason,
    guardHandoffWrite, handoffDropLog,
    precheckLine, handoffLine, handoffGateLine,
    PRECHECK_STATES, READBACK_STATES, HANDOFF_STATES, PRECHECK_CHECKS, HANDOFF_REASON_TEXT,
    HANDOFF_VERSION
};