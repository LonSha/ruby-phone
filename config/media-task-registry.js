/* =========================================================
 * config/media-task-registry.js — [v4.00.0 · R3-O7] 生图与语音的中断续用（**纯函数**）
 * ---------------------------------------------------------
 * 【这一刀治的是什么（修前实测处境）】
 *   修前实测：传输层（image-generation-manager / tts-manager）已有 signal 通道
 *   （NAI 队列等待、ComfyUI 历史轮询、TTS fetch 全线接了 signal），但用户侧没有
 *   一处取消入口；各 App 的生图/语音任务态各自为政，没有跨 App 的统一任务卡。
 *   计划原文要的是：统一任务卡（等待/生成/可播放/失败/结果待核）、取消排队、
 *   只重试失败步骤、已知完成不重复生成。
 *
 * 【本模块只做三件事（不新建入口 App、不重建运行器）】
 *   ① 任务态机：normalizeTask 净化为五态 + 已取消读数；迁移走 canTransition 白名单；
 *   ② 取消面：canCancel 只允许 waiting/running 取消——可播放成果不允许被取消误伤；
 *   ③ 聚合面：summarizeTasks 按任务键去重并产出五档计数，供任务入口聚合显示。
 *
 * 【刻意不做的事（边界，逐条对齐计划原文）】
 *   · 不写存储：任务键与状态由调用方持有（微信生图在消息上、TTS 在会话内存），
 *     本模块零 storage 零 DOM 零计时 API；
 *   · 不做供应商实测：无凭据时验本地任务态，不假报供应商行为；
 *   · 不重建运行器：signal 通道已在传输层贯通，本模块只给用户侧任务卡与取消读数；
 *   · 不代扣费判断：取消不新增扣费请求由传输层 signal 语义保证，本模块不数钱。
 * ========================================================= */
'use strict';

/* 统一任务状态全集即 MTR_TRANSITIONS 的键集（waiting/running/playable/failed/review + cancelled）——
   不另立第二份枚举表：状态合法性与迁移合法性用同一张表判定，改表即同时改两面。 */

/* 状态迁移白名单（判定面：不在表内的迁移一律拒）。 */
export const MTR_TRANSITIONS = Object.freeze({
    waiting: ['running', 'failed', 'cancelled'],
    running: ['playable', 'failed', 'cancelled'],
    playable: ['failed', 'review'],
    failed: ['waiting', 'running'],
    review: ['playable', 'failed'],
    cancelled: []
});

/* 每态的用户侧文案（文案表：视图不手写）。 */
export const MTR_STATE_LABELS = Object.freeze({
    waiting: '排队等待中',
    running: '生成中',
    playable: '可播放',
    failed: '生成失败，可重试',
    review: '结果待核',
    cancelled: '已取消'
});
/* ---- 净化窄口：任何入口进来的任务先过这里，不合法字段不收 ---- */

/**
 * 净化单条任务。缺 key / 非法 state 不收（返回 ok:false + reason）。
 * @param {object} raw - { key, app, kind, state, title, hasResult }
 *   key     任务键（如 wechat:img:<messageId> / tts:<cacheKey>），缺了不收；
 *   app     来源 App 标识（wechat / honey / ...），缺了不收；
 *   kind    媒体类型（image / video / tts），缺了不收；
 *   state   五态之一（或 'cancelled'），非法不收；
 *   title   展示名（可缺，缺了用 kind 兜底）；
 *   hasResult 已有成果（图片 URL / 音频缓存键），取消误伤判定的依据。
 * @returns {{ok:boolean, reason:string, task:object}}
 */
export function normalizeTask(raw) {
    const key = String(raw?.key || '').trim();
    if (!key) return { ok: false, reason: '缺任务键', task: null };
    const app = String(raw?.app || '').trim();
    if (!app) return { ok: false, reason: '缺来源App', task: null };
    const kind = String(raw?.kind || '').trim();
    if (!['image', 'video', 'tts'].includes(kind)) return { ok: false, reason: '媒体类型必须是 image/video/tts', task: null };
    const state = String(raw?.state || '').trim();
    if (!Object.prototype.hasOwnProperty.call(MTR_TRANSITIONS, state)) {
        return { ok: false, reason: '非法状态：' + (state || '(空)'), task: null };
    }
    const title = String(raw?.title || '').trim() || kind;
    const hasResult = raw?.hasResult === true;
    return { ok: true, reason: '', task: { key, app, kind, state, title, hasResult } };
}

/**
 * 状态迁移判定（白名单面）。同态迁移视为无操作，放行。
 * @returns {{ok:boolean, reason:string}}
 */
export function canTransition(from, to) {
    const f = String(from || '').trim();
    const t = String(to || '').trim();
    if (!Object.prototype.hasOwnProperty.call(MTR_TRANSITIONS, f)) {
        return { ok: false, reason: '非法起始状态：' + (f || '(空)') };
    }
    if (!Object.prototype.hasOwnProperty.call(MTR_TRANSITIONS, t)) {
        return { ok: false, reason: '非法目标状态：' + (t || '(空)') };
    }
    if (f === t) return { ok: true, reason: '' };
    const allowed = MTR_TRANSITIONS[f] || [];
    if (!allowed.includes(t)) {
        return { ok: false, reason: '状态迁移被白名单拒绝：' + f + ' → ' + t };
    }
    return { ok: true, reason: '' };
}

/* ---- 取消面：可播放成果不允许被取消误伤 ---- */

/**
 * 取消判定：只有 waiting / running 可取消；playable（已有成果）一律拒。
 * @returns {{ok:boolean, reason:string}}
 */
export function canCancel(task) {
    const state = String(task?.state || '').trim();
    if (state === 'waiting' || state === 'running') return { ok: true, reason: '' };
    if (state === 'playable') return { ok: false, reason: '成果已生成，不需要取消' };
    if (state === 'failed') return { ok: false, reason: '已失败，直接重试即可，没有可取消的在飞请求' };
    if (state === 'review') return { ok: false, reason: '结果待核，先核对再决定收下或判失败' };
    return { ok: false, reason: '已取消的任务没有在飞请求可取消' };
}

/**
 * 取消读数：产出已取消面（不写存储——落盘由调用方执行）。
 * cancelledAt 只在调用方真落盘时记时间，这里不取时钟。
 */
export function applyCancel(task) {
    const gate = canCancel(task);
    if (!gate.ok) return { ok: false, reason: gate.reason, task: null };
    return {
        ok: true, reason: '',
        task: {
            key: task.key, app: task.app, kind: task.kind,
            state: 'cancelled', title: task.title,
            hasResult: task.hasResult === true
        }
    };
}
/* ---- 聚合面：跨 App 任务卡汇总（去重 + 五档计数） ---- */

/**
 * 聚合任务列表：按 key 去重（后到覆盖先到——同键后写是新读数），
 * 产出五档计数与按态分组的读数。供任务入口/诊断聚合显示。
 * @param {Array<object>} tasks - 已经 normalizeTask 通过的任务数组
 * @returns {{ok:boolean, reason:string, counts:object, groups:object, total:number}}
 */
export function summarizeTasks(tasks) {
    const list = Array.isArray(tasks) ? tasks : [];
    const byKey = {};
    const order = [];
    for (const t of list) {
        const key = String(t?.key || '').trim();
        if (!key) continue;
        if (!byKey[key]) order.push(key);
        byKey[key] = t;
    }
    const counts = { waiting: 0, running: 0, playable: 0, failed: 0, review: 0, cancelled: 0 };
    const groups = { waiting: [], running: [], playable: [], failed: [], review: [], cancelled: [] };
    for (const key of order) {
        const t = byKey[key];
        const state = String(t?.state || '').trim();
        if (!Object.prototype.hasOwnProperty.call(counts, state)) continue;
        counts[state] += 1;
        groups[state].push(t);
    }
    return {
        ok: true, reason: '',
        counts,
        groups,
        total: order.length
    };
}

/**
 * 「已知完成不重复生成」判定（**在飞拦截**）。
 *
 * 语义口径（对齐验收原文，不扩大）：验收原文的「已知完成不重复生成」
 *   指的是「切 App 回来不重新发起一遍」（后台恢复先核对任务），
 *   **不是**「用户不能主动重新生成」——用户点「重新生成」是显式意图，
 *   重新生成时调用方负责用新成果替换旧成果（本模块不管旧成果清理）。
 *
 * 因此只有**在飞**（waiting / running）才拦：已有成果的重新生成是合法意图，放行。
 * @returns {{skip:boolean, reason:string}}
 */
export function duplicateGuard(tasks, key) {
    const list = Array.isArray(tasks) ? tasks : [];
    const k = String(key || '').trim();
    if (!k) return { skip: false, reason: '' };
    const hit = list.find((t) => String(t?.key || '').trim() === k);
    if (!hit) return { skip: false, reason: '' };
    const state = String(hit?.state || '').trim();
    if (state === 'waiting' || state === 'running') {
        return { skip: true, reason: '同键任务' + (MTR_STATE_LABELS[state] || state) + '，不重复发起' };
    }
    return { skip: false, reason: '' };
}

/* ---- 自检：两侧判据（登记表自洽 + 白名单全覆盖） ---- */

/**
 * 模块自检。纯读数，无副作用；测试与运行时都可直接调用。
 * @returns {{ok:boolean, failures:string[]}}
 */
export function selfCheck() {
    const failures = [];
    const states = Object.keys(MTR_TRANSITIONS);
    if (states.length !== 6) failures.push('迁移表应有六态（五态+cancelled），实得 ' + states.length);
    for (const s of states) {
        if (!MTR_STATE_LABELS[s]) failures.push('状态 ' + s + ' 缺文案');
    }
    for (const label of Object.keys(MTR_STATE_LABELS)) {
        if (!Object.prototype.hasOwnProperty.call(MTR_TRANSITIONS, label)) {
            failures.push('文案表出现迁移表没有的状态：' + label);
        }
    }
    for (const s of states) {
        for (const to of MTR_TRANSITIONS[s]) {
            if (!Object.prototype.hasOwnProperty.call(MTR_TRANSITIONS, to)) {
                failures.push('迁移目标不是已登记状态：' + s + ' → ' + to);
            }
        }
    }
    const probe = normalizeTask({ key: 'k', app: 'a', kind: 'image', state: 'waiting' });
    if (!probe.ok) failures.push('最小合法任务被拒：' + probe.reason);
    const bad = normalizeTask({ key: '', app: 'a', kind: 'image', state: 'waiting' });
    if (bad.ok) failures.push('缺任务键应被拒');
    const noCancelPlayable = canCancel({ state: 'playable' });
    if (noCancelPlayable.ok) failures.push('playable 应不可取消');
    const cancelRunning = canCancel({ state: 'running' });
    if (!cancelRunning.ok) failures.push('running 应可取消');
    const blocked = canTransition('cancelled', 'running');
    if (blocked.ok) failures.push('cancelled 是终态，不应放行迁移');
    const dup = duplicateGuard([{ key: 'x', state: 'running', hasResult: false }], 'x');
    if (!dup.skip) failures.push('在飞同键应被拦');
    const dupDone = duplicateGuard([{ key: 'y', state: 'playable', hasResult: true }], 'y');
    if (dupDone.skip) failures.push('已有成果的重新生成是合法意图，不应被拦');
    return { ok: failures.length === 0, failures };
}
