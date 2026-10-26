/* ========================================================
 * config/redraw-generation.js — 重绘代次栅栏（纯函数）[v4.88.0 · 第七批缝入]
 * --------------------------------------------------------
 * 【这一刀治的是什么（本仓实测的真缺口）】
 *   同一个对象会被「恢复」「重新生成」「换图」反复改写，而这些动作是异步的：
 *   旧流程拿着旧连接回来，把新结果盖掉。
 *   本仓修前只有 session-gate 拦「跨会话」，**没有拦「同一会话里的旧操作」**：
 *   换一张头像、再点一次「恢复」，先回来的旧写入就把刚恢复的状态覆盖了。
 *
 * 【源形态（非描述，按源码判定）】
 *   qegj567-cloud/SullyOS · utils/amsgCloudOwnerGeneration.ts
 *     · 每个 owner 存一个**单调代次**；恢复之后代次 +1（`invalidateCloudOwnerWrites`）；
 *     · 写入时**只认发起那一刻的代次**（`captureCloudOwnerGenerations` 冻结快照），
 *       写进信封的 `ownerGeneration` 就是那个冻结值；
 *     · 提交前还有一个检查器：`captureCloudWriteCheck(ids)` 在操作**开始时**取代次，
 *       返回的闭包在**写入前**比一遍，只要有一个 owner 变过就整体 `throw`；
 *     · 关键是**捕获时机在开始**、不在结束 —— 否则恢复后拿到新连接照样被盖。
 *
 * 【本仓差异与后果（照抄会坏的地方）】
 *   · 源的代次是云端恢复代次、存在 localStorage 且按连接隔离；本仓没有连接概念，
 *     故改为按 owner 键存的进程内 Map，由调用方决定持久化与否。
 *   · 源在检查失败时 `throw`；本仓调用点（消息写回）不能炸，
 *     故返回 `{ok:false, bad:[...]}`，让调用方自己选「丢弃 / 重试 / 提示」。
 *   · 源只对 owner 生效；本仓的对应物是「对象键」（角色 id / 消息 id / 档位 id），
 *     由调用方传，模块不认识任何具体 id。
 *
 * 【纪律】
 *   ① 纯函数外壳：内部账由模块持有（进程内），但所有读写在入参上可覆写（便于测试）；
 *   ② 只增不减：代次单调 +1，不提供回退；
 *   ③ 只拦不猜：没捕获过代次的检查器放行（空集合 = 没有要守的东西）；
 *   ④ 二态互不同形：`ok:true` 与 `ok:false + bad` 分得开，绝不返回空 bad。
 * ======================================================== */
'use strict';

/** 进程内代次账：ownerKey -> 代次。整个应用一份。 */
const EPOCHS = new Map();

/** 取某 owner 当前代次（没记过就是 0）。 */
export function currentEpoch(ownerKey) {
    const k = String(ownerKey == null ? '' : ownerKey);
    if (!k) return 0;
    return EPOCHS.get(k) || 0;
}

/** 作废某 owner 的旧写入：代次 +1。返回新代次。 */
export function invalidateOwner(ownerKey) {
    const k = String(ownerKey == null ? '' : ownerKey);
    if (!k) return 0;
    const next = (EPOCHS.get(k) || 0) + 1;
    EPOCHS.set(k, next);
    return next;
}

/** 只读快照：ownerKeys -> 代次的普通对象（用于把代次写进信封）。 */
export function captureEpochs(ownerKeys) {
    const keys = Array.isArray(ownerKeys) ? ownerKeys : [];
    const out = {};
    for (const k of keys) {
        const key = String(k == null ? '' : k);
        if (key) out[key] = currentEpoch(key);
    }
    return out;
}

/**
 * 取一个检查器。**必须在操作开始时调**，它会把此刻的代次钉住；
 * 返回的闭包在提交前调，任一 owner 变过即 ok:false。
 */
export function captureWriteCheck(ownerKeys) {
    const keys = (Array.isArray(ownerKeys) ? ownerKeys : [])
        .map((k) => String(k == null ? '' : k))
        .filter(Boolean);
    const frozen = keys.map((k) => [k, currentEpoch(k)]);
    return function check() {
        if (!frozen.length) return { ok: true, bad: [] };
        const bad = frozen.filter(([k, e]) => currentEpoch(k) !== e).map(([k]) => k);
        return { ok: bad.length === 0, bad };
    };
}

/** 给信封盖代次戳（不存在的 owner 记 0，表明「没见过」而不是漏了）。 */
export function stampEnvelope(envelope, ownerKey) {
    const env = (envelope && typeof envelope === 'object') ? { ...envelope } : {};
    const k = String(ownerKey == null ? '' : ownerKey);
    if (k) { env.ownerKey = k; env.ownerGeneration = currentEpoch(k); }
    return env;
}

/** 一行读数。 */
export function epochLine(current, frozen) {
    const c = Number(current) || 0;
    const f = Number(frozen);
    if (!Number.isFinite(f)) return '代次 ' + String(c) + '（未钉住）';
    return c === f ? '代次 ' + String(c) + '（未变）' : '代次已从 ' + String(f) + ' 变为 ' + String(c) + '（旧写入应弃）';
}

/** 清空账（仅测试用；运行期不清）。 */
export function resetEpochs() {
    EPOCHS.clear();
}

/** 自检：作废后检查器必红、未变必绿、空集合放行、戳记带当前代次。 */
export function redrawSelfCheck() {
    const bad = [];
    resetEpochs();
    const check = captureWriteCheck(['char:1']);
    if (!check().ok) bad.push('未变却报红');
    invalidateOwner('char:1');
    const r = check();
    if (r.ok || r.bad.indexOf('char:1') < 0) bad.push('作废后未报红');
    if (!captureWriteCheck([])().ok) bad.push('空集合未放行');
    const env = stampEnvelope({ a: 1 }, 'char:1');
    if (env.ownerGeneration !== currentEpoch('char:1')) bad.push('戳记未取当前代次');
    if (currentEpoch('char:2') !== 0) bad.push('未登记 owner 代次应为 0');
    resetEpochs();
    return { ok: bad.length === 0, bad };
}