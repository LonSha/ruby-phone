/* ========================================================
 * back-guard.js — 返回键守卫（LIFO 返回栈）[v2.99.0]
 * --------------------------------------------------------
 * 【来源】缝合自上游「瑟瑟小手机 V1.059」的 `__ubBackGuard`
 *   （EMBEDDED_HTML 内 1840 模块 `c()`）。上游形制（逐条对齐，非照抄实现）：
 *     · 单例状态对象挂在 window 上：{ armed, selfNav, bound, closers[], probe }
 *     · armed 时 `history.pushState` 压一层哨兵；
 *     · popstate 不自行 close：交给 `probe()` 问一句「当前还有东西可关吗」，
 *       有则**重新压哨兵**（于是连续按返回可逐层关闭）；
 *     · closers 反向遍历（后进先出），`closers[i]()` 返回 falsy 表示
 *       「这个不是我该关的」，继续往下找；返回 truthy 表示「我关了」→ 停止。
 *
 * 【为什么本仓需要（真实缺口，非设计洁癖）】
 *   实测本仓全库 **零 `popstate` / 零 `history.pushState`**：返回只有一条通路
 *   `PHONE_EVENTS.SWIPE_BACK`（右滑手势派发），且 `_dispatchSwipeBackWithFallback`
 *   是**时间兜底**（250ms 派发 → 550ms 检查层是否真的移动，没动就回弹并 push 回
 *   viewHistory）。两个后果：
 *     ① 安卓物理返回键 / 浏览器返回，本仓**完全不响应**（没有 popstate 监听）；
 *     ② 右滑时 App 的 `handleSwipeBack` 只知道「往回一层视图」，
 *        **打开着的浮层/模态不参与**——用户按返回期望「关掉浮层」，实际整页退出。
 *   上游那份实现治的正是这件事：把「谁可以被返回关掉」变成**后开的先关**
 *   的有序栈，而不是一层视图。
 *
 * 【与上游的差异（本仓适配，刻意）】
 *   · 上游 closers 是模块内数组，本仓改成**注册制**：任何模块
 *     `registerBackCloser(closeFn, { tag })` 一个关闭器，返回注销函数。理由：
 *     本仓是多 App 懒加载单例（55 个 App），没有单一模块能知道「当前开着的浮层」。
 *   · 上游 `probe` 由内部逻辑提供；本仓 probe 的默认实现是
 *     「closers 非空即算有东西可关」——**没有关闭器时不许压哨兵**，
 *     否则会出现「返回键被手机吃掉、宿主页面再也退不出」的最坏形态。
 *   · **不抛**（任何畸形一律降级）。`history.pushState` 在沙箱 / 无 history
 *     环境下会 throw，必须 try/catch。
 *   · 深度上限：关闭器数量超过 `_MAX_DEPTH`（浮层泄漏）不得让哨兵无限压入
 *     宿主历史，到达上限后**拒绝继续压**并如实记数（`dropped`），诊断中心会显示。
 *
 * 【与 SWIPE_BACK 的关系】本模块**不替换**右滑手势（物理手势底座属 yuzuki-phone
 *   缝入面，改动风险高）。两者分工：右滑 = 视图层后退（已有兜底）；
 *   返回键 = 先关浮层、再退视图（新增）。
 * ======================================================== */

const BACK_GUARD_KEY = '__ubBackGuard';        // 状态槽名（与上游同名，便于对照）
const BACK_GUARD_SENTINEL = '__rpBackGuard';   // 哨兵 state 标记：识别「这一层是我压的」
const _MAX_DEPTH = 30;                         // 关闭器数量上限（超出即拒压哨兵并记数）

function hostWindow(win) {
    if (win) return win;
    return (typeof window !== 'undefined') ? window : null;
}

/** 取（或建）状态对象。**不抛**：无 window 时返回 null。建对象不做任何 DOM/history 操作。 */
function backGuardState(win) {
    try {
        const w = hostWindow(win);
        if (!w) return null;
        const cur = w[BACK_GUARD_KEY];
        if (!cur || typeof cur !== 'object') {
            w[BACK_GUARD_KEY] = {
                armed: false,
                selfNav: false,
                bound: false,
                closers: [],
                probe: null,
                dropped: 0,
                lastClose: null
            };
        }
        const st = w[BACK_GUARD_KEY];
        if (!Array.isArray(st.closers)) st.closers = [];
        if (typeof st.dropped !== 'number' || !Number.isFinite(st.dropped)) st.dropped = 0;
        return st;
    } catch (_e) { return null; }
}

function hasSentinelTop(w) {
    try {
        const s = w.history && w.history.state;
        return !!(s && typeof s === 'object' && s[BACK_GUARD_SENTINEL] === true);
    } catch (_e) { return false; }
}

/** 压一层哨兵（幂等）。@returns {boolean} 是否真的压入 */
function arm(st, win) {
    const s = st || backGuardState(win);
    if (!s) return false;
    const w = hostWindow(win);
    if (!w) return false;
    if (s.armed) return true;
    /* 【实测修】没有东西可关就**不压哨兵**。为什么必须在这里判、而不是只在 probe 里判：
     *   本函数是唯一压栈点。若允许「closers 为空也压」，用户按一次返回只会把哨兵弹掉、什么都不关
     *   （`installBackGuard()` 在进面板时就被调用，而那一刻通常还没有浮层）
     *   ⇒ 表现是「按返回没反应，要按两次」—— 本仓最贵形态（不报错、不崩溃、只错结果）。 */
    if (!s.closers.length) return false;
    if (hasSentinelTop(w)) { s.armed = true; return false; }   // 上一次会话压的，认领即可
    /* 【实测修】深度上限检查**不在这里**。旧写法在本函数内判 `closers.length > _MAX_DEPTH`，
     *   但本函数第一句就是 `if (s.armed) return true`，而首次压入后 armed 恒为 true
     *   ⇒ 那条检查是**永远不会执行的死代码**（探针实测：连续注册 40 个关闭器，
     *   dropped 恒为 0）。而且哨兵是**单实例**（armed 期间不会重复 push），
     *   本来就不会无限压入宿主历史 —— 真正需要封顶的是**关闭器数量**（浮层泄漏会使 probe 恒为 true，
     *   于是哨兵被无限重新压上，用户的返回键永远被幻影浮层吃掉）。故封顶放在注册处。 */
    try {
        const payload = {};
        payload[BACK_GUARD_SENTINEL] = true;
        w.history.pushState(payload, '');
        s.armed = true;
        bindIfNeeded(s, w);
        return true;
    } catch (_e) {
        s.armed = false;
        return false;                                          // 沙箱 / 无 history：降级，不抛
    }
}

/** 默认 probe：还有关闭器 才算「有东西可关」 */
function defaultProbe(s) {
    return !!(s && s.closers.length > 0);
}

function bindIfNeeded(s, w) {
    if (s.bound) return;
    s.bound = true;
    w.addEventListener('popstate', () => {
        if (s.selfNav) {
            s.selfNav = false;
            /* 【实测修】只在「栈顶仍是我压的哨兵」时才忽略这次 popstate——那说明它是
             *   沙箱 / 宿主补发的，不是用户按的。若栈顶已经不是哨兵了，那正是用户按了返回，必须继续往下处理；
             *   否则「关掉一层之后，下一次返回被静默吞掉」，表现同样是「要按两次」
             *   （本仓最贵形态：不报错、不崩溃、只错结果）。 */
            if (hasSentinelTop(w)) return;
        }
        if (!s.armed) return;
        // 反向遍历：后开的先关（LIFO）。返回 falsy 表示「不是我的」，继续往下。
        for (let i = s.closers.length - 1; i >= 0; i -= 1) {
            let done = false;
            try { done = !!s.closers[i].close(); } catch (_e) { done = false; }
            if (done) {
                s.lastClose = String((s.closers[i] && s.closers[i].tag) || '');
                break;
            }
        }
        // 关完之后：还有东西可关就重新压哨兵（连续按返回可逐层关闭，与上游同）
        s.armed = false;
        s.selfNav = false;
        /* 【实测修】selfNav 必须在 `pushState` **之后**置位，不能提前。
         *   `history.pushState` **不会触发 popstate**，所以它没有任何东西可供「忽略」；
         *   若在此提前置 true，那个标记会一直留到**用户下一次真实按返回**，把它静默吞掉
         *   ⇒ 表现是「每关一层要按两次返回」（本仓最贵形态：不报错、不崩溃、只错结果）。
         *   此处由 tests/system-v299.test.mjs 的 C2 抳到（实测：第二次返回只重复关同一层）。 */
        const probe = (typeof s.probe === 'function') ? s.probe : () => defaultProbe(s);
        let more = false;
        try { more = !!probe(); } catch (_e) { more = false; }
        if (more) { arm(s, w); s.selfNav = s.armed === true; }
        else { s.armed = false; }
    });
}

/**
 * 注册一个「可被返回键关掉的东西」。
 * @param {() => boolean} closeFn 返回 truthy = 我关了（停止继续找）；falsy = 不是我的。
 * @param {{tag?:string, win?:object}} [opts]
 * @returns {() => void} 注销函数（幂等）
 */
export function registerBackCloser(closeFn, opts = {}) {
    const st = backGuardState(opts.win);
    if (!st || typeof closeFn !== 'function') return () => {};
    /* 【实测修】关闭器数量封顶：超过 _MAX_DEPTH 即拒绝注册并如实记数（dropped）。
     *   为什么要封：浮层泄漏（closer 注册了却从不注销）会使 defaultProbe 恒为真 ⇒
     *   哨兵被无限重压 ⇒ **用户的返回键永远被幻影浂层吃掉，宿主页面再也退不出**（本仓最重的一类后果）。
     *   拒绝注册的代价（那一层只能点按钮关，返回键关不了）**小于**让返回键彻底失效，
     *   且 dropped 在诊断中心可见 —— 宁可可见地降级，不可见地坏掉。 */
    if (st.closers.length >= _MAX_DEPTH) {
        st.dropped += 1;
        return () => {};
    }
    const entry = { close: closeFn, tag: String(opts.tag || 'anonymous') };
    st.closers.push(entry);
    try { arm(st, opts.win); } catch (_e) { /* 压哨兵失败：登记照常，返回键不拦（降级） */ }
    let alive = true;
    return () => {
        if (!alive) return;
        alive = false;
        try {
            const i = st.closers.indexOf(entry);
            if (i >= 0) st.closers.splice(i, 1);
        } catch (_e) { /* 忽略 */ }
        /* 【实测修】注销后若「已无物可关」而哨兵还在栈顶，必须把自己那层**弹回去**。
         *   为什么：浮层被点右上角 X 关掉（而非按返回）时， closer 注销了但哨兵还在，
         *   事后第一次按返回会被这层孤儿哨兵静默吃掉 ⇒ 又是「要按两次」。
         *   安全性：仅在 `hasSentinelTop` 为真时才弹（那层确实是自己压的，不会误弹宿主自己的条目），
         *   且整段 try/catch（沙箱可能拒绝 back()：拒绝就不清，不影响其余）。 */
        try {
            const w = hostWindow(opts.win);
            if (!st.closers.length && st.armed && w && hasSentinelTop(w)) {
                st.armed = false;
                st.selfNav = true;
                w.history.back();
            }
        } catch (_e) { /* 清理失败：留着孤儿哨兵（最坏也只是多按一次）*/ }
    };
}

/**
 * 压哨兵（供外壳在面板显示时调用；幂等）。
 * 真实消费方：`phone/phone-shell.js` 的 createInPanel。
 */
export function installBackGuard(opts = {}) {
    const st = backGuardState(opts.win);
    if (!st) return false;
    return arm(st, opts.win);
}

/**
 * 诊断快照（供诊断中心；纯读，不触发任何状态变更）。
 * 真实消费方：`apps/diagnose/diagnose-data.js`。
 */
export function backGuardReport(win) {
    const st = backGuardState(win);
    if (!st) {
        return { mounted: false, armed: false, bound: false, closers: 0, tags: [], dropped: 0, lastClose: null, sentinelTop: false };
    }
    return {
        mounted: true,
        armed: st.armed === true,
        bound: st.bound === true,
        closers: st.closers.length,
        tags: st.closers.map((c) => String((c && c.tag) || 'anonymous')),
        dropped: Number(st.dropped) || 0,
        lastClose: st.lastClose || null,
        sentinelTop: hasSentinelTop(hostWindow(win))
    };
}

export default {
    registerBackCloser,
    installBackGuard,
    backGuardReport
};
