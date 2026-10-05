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
    return (typeof r.saved === 'boolean') ? (r.saved === true) : true;
}
