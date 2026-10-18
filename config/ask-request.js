/* ========================================================
 * config/ask-request.js — [v4.14.0 · R4-O2] 问答请求身份与取消(纯函数)
 * --------------------------------------------------------
 * 【这一刀治的是什么(修前实测,读码可复算)】
 *   `apps/memory/memory-app.js::askPast` → `config/memory-qa-contract.js::readMemoryQaAnswer`
 *   → 上游**同步** `askMemoryQuestion`。上游 lonsha-memory-plugin **v3.332.0(M4-O4)**
 *   已经交付了异步出口 `askMemoryQuestionAsync`(逐条计划走 `queryAsync`,片间让出主线程,
 *   自带 `taskId` / `shouldCancel()` / `onProgress(p)`,回执在同步版全键之外增
 *   `async / taskId / state / processed` 四键),而下游**一个消费者都没有** ——
 *   实测 `grep askMemoryQuestionAsync apps config index.js` 零命中。
 *   于是大库上「问往事」是一次**同步全量扫描**:按钮按下去面板不动,连按两次
 *   只会得到两个串在一起的结果(旧的那次可能后回来、把新的那次覆盖掉)。
 *
 * 【本件回答的两个问题(都是纯函数,不碰 DOM / 不写存储 / 不联网)】
 *   1 **这一条回信还是不是「现在这一次」?** —— 代际(token)判定。
 *      为什么不能用「清结果」代替:清结果只能拦住**还没出发**的那一轮,
 *      拦不住**已经在跑**的那一轮回来时把旧命中写回面板(本仓在搜索侧治过同一形态)。
 *   2 **该不该停?** —— 交给上游 `shouldCancel()` 的谓言。
 *      上游在**协作分片间**调用它,返回 true 即取消;取消后的回执
 *      `state === 'canceled'` 且 answer/gaps 是**已处理部分**,不当全量结论
 *      ——这条提醒写在上游契约里,本件把它变成结构上不可混读的一态。
 *
 * 【为什么不复用搜索的 `_scanGen`】搜索那套是**App 实例字段 + 视图自判**,
 *   它的判定埋在两处(`search-app.js` 自增、`search-view.js` 比对),且没有对外契约。
 *   问答这一面要跨「App 控制器 / 视图 / 上游异步口」三处**,若各自判一次必然分岔**
 *   (本仓「同一口径只许一份实现」)。故收成一个可断言的纯函数件。
 * ======================================================== */
'use strict';

/**
 * 一次问答的运行态(**六态互不同形,不许压平**)。
 *   · 压平 `canceled` 与 `stale-dropped` ⇒ 用户会以为「我按了取消」,
 *     其实是「他问了新的、旧的那条被顶掉」—— 两件事处置相反(前者可再问,后者等新的);
 *   · 压平 `sync-fallback` 与 `running` ⇒ 「本版插件没有异步口、正在同步跑(会卡)」
 *     会被显示成「正在后台跑(不卡)」,用户会一直等一个**永远不动的界面**。
 */
export const ASK_RUN_STATES = Object.freeze({
    IDLE: 'idle',                       // 还没问
    RUNNING: 'running',                 // 正在问(可能有进度读数)
    DONE: 'done',                       // 问到了(读数由问答面自己给)
    CANCELED: 'canceled',               // 用户按了取消:读数**是已处理部分**,不是全量结论
    STALE_DROPPED: 'stale-dropped',     // 旧回信回来了,但用户已问新的 ⇒ 丢弃(不显示)
    SYNC_FALLBACK: 'sync-fallback'      // 上游没有异步出口 ⇒ 明说降级走同步(与「后台跑」不同形)
});

/** 派发相:走哪一条上游出口。**判据按此表逐词核,防随口新词**。 */
export const ASK_PHASES = Object.freeze({
    ASYNC: 'async',     // 上游有异步出口(可取消、有进度、片间让出)
    SYNC: 'sync',       // 上游只有同步出口(兼容路径:能用,但会占住主线程)
    ABSENT: 'absent'    // 上游问答出口整个不在场(等装/等升级,由问答面自己报)
});

/** 任务身份前缀(宿主侧与手机侧都照这一个写,不各写一份)。 */
export const ASK_TASK_PREFIX = 'rp-ask';

/**
 * 造一个任务身份串(**纯**:同一组输入恒得同一串)。
 *
 * 为什么要带会话 id:上游把 `taskId` 回填在回执里,而**回执可能跨会话回来**
 *   (用户问完就切了会话)。只带代际的话,两个会话各自的第 3 次问句会撞成同一个
 *   taskId —— 而「两个会话的第 3 次」是**两件事**,不得同形。
 * 会话 id 取不到时写 `na` 而**不写空串**:空串会被上游 `String(o.taskId)`
 *   读成一个合法身份,与「没给」同形。
 *
 * @param {number} gen 代际(由 tracker 给出,从 1 起)
 * @param {string} [chatId] 会话身份串
 * @returns {string} 形如 `rp-ask:<chatId|na>:<gen>`
 */
export function makeAskTaskId(gen, chatId) {
    const g = (typeof gen === 'number' && Number.isFinite(gen) && gen > 0) ? Math.floor(gen) : 0;
    const c = (typeof chatId === 'string' && chatId.trim()) ? chatId.trim() : 'na';
    return ASK_TASK_PREFIX + ':' + c + ':' + g;
}

/**
 * 请求跟踪器(**只持一个计数器**,不碰 DOM、不写存储、不联网)。
 *
 * 用法(调用方持有它,本件不改任何外部状态):
 *   const t = newAskTracker();
 *   const gen = advanceAsk(t);          // 每问一次 +1
 *   ...上游回信...
 *   if (isStale(t, gen)) { 丢弃 }        // 旧回信不许覆盖新问题
 */
export function newAskTracker() {
    return { gen: 0, asked: 0, lastState: ASK_RUN_STATES.IDLE };
}

/** 推进代际并返回它(**从 1 起**;0 是「从没问过」的哨兵)。 */
export function advanceAsk(tracker) {
    const t = (tracker && typeof tracker === 'object') ? tracker : newAskTracker();
    const next = (typeof t.gen === 'number' && Number.isFinite(t.gen) && t.gen > 0) ? Math.floor(t.gen) + 1 : 1;
    t.gen = next;
    t.asked = (typeof t.asked === 'number' && Number.isFinite(t.asked) && t.asked > 0) ? Math.floor(t.asked) + 1 : 1;
    return next;
}

/** 这条回信是不是**旧的**(用户已经问过新的了)。 */
export function isStale(tracker, gen) {
    const t = (tracker && typeof tracker === 'object') ? tracker : null;
    if (!t) return true;                     // 跟踪器不在 ⇒ 无从判定 ⇒ 按「旧的」处置(不许写进面板)
    const cur = (typeof t.gen === 'number' && Number.isFinite(t.gen)) ? Math.floor(t.gen) : 0;
    const g = (typeof gen === 'number' && Number.isFinite(gen) && gen > 0) ? Math.floor(gen) : 0;
    return g !== cur || cur === 0;
}

/** 用户按了取消:给**当前**代际打上取消标记(下一片让出点即生效)。 */
export function cancelAsk(tracker) {
    const t = (tracker && typeof tracker === 'object') ? tracker : newAskTracker();
    const cur = (typeof t.gen === 'number' && Number.isFinite(t.gen)) ? Math.floor(t.gen) : 0;
    t.canceledGen = cur;
    t.lastState = ASK_RUN_STATES.CANCELED;
    return { ok: cur > 0, gen: cur };
}

/** 当前代际是否已被用户取消(供视图判按钮态)。 */
export function isCanceled(tracker) {
    const t = (tracker && typeof tracker === 'object') ? tracker : null;
    if (!t) return false;
    const cur = (typeof t.gen === 'number' && Number.isFinite(t.gen)) ? Math.floor(t.gen) : 0;
    const c = (typeof t.canceledGen === 'number' && Number.isFinite(t.canceledGen)) ? Math.floor(t.canceledGen) : -1;
    return cur > 0 && c === cur;
}

/**
 * 交给上游 `shouldCancel()` 的谓言(上游在**协作分片间**调用它)。
 *
 * 语义刻意收窄成两件:**这一段还是当前代际吗**、**用户取消这一代了吗**。
 *   前者覆盖「用户又问了一次」(旧那轮该停,免得白扫),后者覆盖「用户按了取消」。
 *   两者都**不**判会话身份 —— 会话身份由 `config/session-gate.js` 的既有栅栏在
 *   写回口判,本件再判一次就是第二份口径(且会与栅栏说的不一致)。
 */
export function shouldCancelFn(tracker, gen) {
    const g = (typeof gen === 'number' && Number.isFinite(gen)) ? Math.floor(gen) : 0;
    return function shouldCancel() {
        if (isStale(tracker, g)) return true;
        const t = (tracker && typeof tracker === 'object') ? tracker : null;
        if (!t) return true;
        const c = (typeof t.canceledGen === 'number' && Number.isFinite(t.canceledGen)) ? Math.floor(t.canceledGen) : -1;
        return c === g && g > 0;
    };
}

/**
 * 由上游回执推出**运行态**(上游读数 → 本件六态之一)。**只读、不猜**。
 *
 * @param {object} receipt 上游回执(同步或异步)
 * @param {boolean} stale 是否已被新问题顶替(由调用方先判 `isStale`)
 * @returns {string} ASK_RUN_STATES 之一
 */
export function runStateOf(receipt, stale) {
    if (stale === true) return ASK_RUN_STATES.STALE_DROPPED;
    const r = (receipt && typeof receipt === 'object') ? receipt : null;
    if (!r) return ASK_RUN_STATES.RUNNING;
    const st = (typeof r.state === 'string') ? r.state : '';
    if (st === 'canceled') return ASK_RUN_STATES.CANCELED;
    if (st === 'absent') return ASK_RUN_STATES.SYNC_FALLBACK;
    return ASK_RUN_STATES.DONE;
}

/**
 * 运行态的一句话归因(唯一实现;供视图念出)。**六态各有各的形**。
 * @param {string} state ASK_RUN_STATES 之一
 * @param {{progress?:object, gen?:number}} [extra]
 */
export function askRunLine(state, extra) {
    const e = (extra && typeof extra === 'object') ? extra : {};
    switch (state) {
        case ASK_RUN_STATES.RUNNING:
            return '正在问…' + progressLine(e.progress, true);
        case ASK_RUN_STATES.CANCELED:
            return '已取消 —— 下面是**已处理部分**,不是全量结论';
        case ASK_RUN_STATES.STALE_DROPPED:
            return '这一条是上一次的答案,已被新问题顶替(不覆盖)';
        case ASK_RUN_STATES.SYNC_FALLBACK:
            return '本版记忆插件没有异步问答出口 —— 退回同步跑(能用,但期间界面会卡住)';
        case ASK_RUN_STATES.DONE:
            return '问完了';
        case ASK_RUN_STATES.IDLE:
        default:
            return '';
    }
}

/**
 * 进度一行(上游 `onProgress(p)` 给的 `{plan, plans, rows, totalRows}`)。
 *
 * 【未给进度与进度为 0 必须分开】`plan`/`rows` 读不到时**不补 0**
 *   (0 是合法值:第 0 条计划、已处理 0 行),两者塌成同一个数会让
 *   「还没开始」显示成「已经在第 0 条计划上」(本仓 num-gate 治过的同族形态)。
 *
 * @param {object} p 上游进度读数
 * @param {boolean} [brief] 真时只给后半段(供与「正在问…」拼一行)
 */
export function progressLine(p, brief) {
    const o = (p && typeof p === 'object') ? p : null;
    if (!o) return brief ? '' : '(没有进度读数)';
    const plan = num1(o.plan);
    const plans = num1(o.plans);
    const rows = num1(o.rows);
    const seg = [];
    if (plan !== null && plans !== null) seg.push('第 ' + (plan + 1) + '/' + plans + ' 条计划');
    else if (plans !== null) seg.push('共 ' + plans + ' 条计划');
    if (rows !== null) seg.push('已处理 ' + rows + ' 行');
    if (!seg.length) return brief ? '(进度读不出)' : '(进度读不出 —— 不是「0 行」)';
    return seg.join(' · ');
}

/** 只认非负整数;其余如实 null(**不编 0**)。局部实现,与全仓唯一取值门同口径。 */
function num1(v) {
    if (typeof v !== 'number') return null;
    if (!Number.isFinite(v)) return null;
    const n = Math.floor(v);
    return n >= 0 ? n : null;
}

/**
 * 由「上游有没有异步出口」定派发相(**口径一处,调用方不各判一次**)。
 * @param {boolean} hasAsync 上游插件上 `askMemoryQuestionAsync` 是不是函数
 * @param {boolean} hasSync 上游插件上 `askMemoryQuestion` 是不是函数
 */
export function planAskPhase(hasAsync, hasSync) {
    if (hasAsync === true) return ASK_PHASES.ASYNC;
    if (hasSync === true) return ASK_PHASES.SYNC;
    return ASK_PHASES.ABSENT;
}

export default {
    ASK_RUN_STATES, ASK_PHASES, ASK_TASK_PREFIX,
    makeAskTaskId, newAskTracker, advanceAsk, isStale, cancelAsk, isCanceled,
    shouldCancelFn, runStateOf, askRunLine, progressLine, planAskPhase
};