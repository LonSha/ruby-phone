/* ========================================================
 * config/motion.js — 动效档位与「后台降频 / 恢复重取」统一出口 [v3.79.0]
 * --------------------------------------------------------
 * 【计划出处】R-O6 第二层第 3、4 条：「优先移除非必要动画与粒子」
 *   与「后台降频与恢复后重取一起设计，避免恢复瞬间全量重算」。
 *
 * 【修前实测的处境（不是推演）】
 *   · `prefers-reduced-motion` 全仓零命中（政策询问面根本不存在）；
 *   · `animation-play-state` 全仓零命中；
 *   · phone.css 侧 7 处 animation 带 infinite 常驻（黑胶唱片 6s / 语音弧线 1s×2 /
 *     来电脉冲 2s / 通话发光 2s / 输入指示器 1.5s / 短信输入脉冲 1.1s），
 *     App 局部样式表另有 7 处（音乐唱盘 7s / 音乐按钮 4s / 蜜语跑马灯 8.6s /
 *     蜜语刷新 0.85s / 日历加载 1.1s×2 / 日记生成 0.8s）；
 *   · `visibilitychange` 消费点全仓仅 3 处（相册暂停预览 / 蜜语两处检测），
 *     没有任何一处「面板隐藏或页面隐藏时把动效与轮询停下来」；
 *   · 浏览器层实测（Chromium 131 / headless old / 单帧 dump）：面板隐藏
 *     （display:none + PANEL_VISIBILITY(false)）之后 `document.getAnimations()` 里那条
 *     `yzp-home-vinyl-spin` 仍是 running；宠物 video 在面板关闭与页面隐藏两种状态下
 *     都还在播（`paused=false`）。
 *
 * 【本模块回答三个问题，只回答这三个】
 *   ① 本机现在该跑哪一档动效？`resolveMotionLevel` —— 用户显式档优先于系统政策。
 *   ② 怎么把「该停的那一类」表达成浏览器真懂的东西？`applyMotionLevel` 写
 *      documentElement 上的两个 dataset（`data-motion` 表档位、`data-still` 表
 *      「装饰类整族别动」）—— 两者**不同形**，因为语义不同。
 *   ③ 面板与页面重新可见时谁负责重取？`createResumeScheduler` —— 把同一轮恢复里
 *      的多个重取请求**合成一次**（合成本身就是这条工作的核心：本仓修前没人负责
 *      重取；一旦改成「人人负责重取」，恢复瞬间就变成每个消费方各跑一次全量重算）。
 *
 * 【口径纪律】
 *   · 零副作用：模块求值时不碰 DOM；一切动作都在被调用时发生。
 *   · 无宿主（Node 单测）下全部方法安全降级并返回可判读结果，不抛。
 *   · 「后台降频」不是「后台杀死」：默认只停**非必要**动效与轮询；
 *     用户显式选了 reduced/still 档才连「用户正在看的进行中状态」一起降。
 * ============================================================ */

/** 档位取值（互不相同、不得塌成两态）。 */
export const MOTION_LEVELS = Object.freeze({
    /** 跟随系统政策：系统说少动就少动，没说就全开。 */
    AUTO: 'auto',
    /** 全开（默认；与修前行为一致，不悄悄替用户减动）。 */
    FULL: 'full',
    /** 减动：非必要动效与装饰类停；用户可见的进行中状态保留。 */
    REDUCED: 'reduced',
    /** 静止：装饰类与全部 CSS 动画/过渡停（用户显式选的）。 */
    STILL: 'still'
});

export const MOTION_LEVEL_LIST = Object.freeze(['auto', 'full', 'reduced', 'still']);

/** 媒体查询串（单一真源：产品与测试读同一份，禁止两处各写一遍）。 */
export const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

/** 档位属性名（写在 documentElement 上）。 */
export const MOTION_ATTR = 'data-motion';
/** 「装饰类整族别动」属性名（仅 reduced/still 两档存在）。 */
export const STILL_ATTR = 'data-still';
/**
 * 「后台中」属性名：**非空即后台**，值就是后台的成因（foreground 时整个属性被移除）。
 * 为什么需要它与 data-still 分开：两者语义不同 ——
 *   · data-still 是**用户偏好**（用户说「少动/别动」），跨前后台持续成立；
 *   · data-bg 是**当下处境**（面板关了 / 页面切走了），恢复后必须立刻消失。
 * 塌成一个属性会让「用户自己选的减动」与「系统帮它省电」在读数上同形，
 *   那时「为什么它是静止的」在现场就无法回答。
 */
export const BG_ATTR = 'data-bg';
/** 恢复信号名（消费方用它触发「现取」）。 */
export const RESUME_EVENT = 'phone:motionResume';
/** 动效档位的 storage 键（随会话隔离，见 config/storage.js 的 /^sys_/）。 */
export const MOTION_STORAGE_KEY = 'sys_motion_level';

/**
 * 归一档位字符串：未知输入一律回落 AUTO（不猜用户想要什么）。
 * @param {*} raw
 * @returns {string} MOTION_LEVEL_LIST 之一
 */
export function normalizeMotionLevel(raw) {
    const s = String(raw === null || raw === undefined ? '' : raw).trim().toLowerCase();
    return MOTION_LEVEL_LIST.indexOf(s) >= 0 ? s : MOTION_LEVELS.AUTO;
}

/**
 * 问系统政策。无 matchMedia（Node / 老宿主）⇒ null（**未知不报 false**）。
 * 为什么不能回落成 false：false 是「系统明确说不用减动」，
 *   与「这里根本问不到」是两件事，塌成同形会让现场读数说谎。
 * @param {*} [win]
 * @returns {boolean|null}
 */
export function readReducedMotion(win) {
    try {
        const w = win || (typeof globalThis !== 'undefined' ? globalThis : null);
        if (!w || typeof w.matchMedia !== 'function') return null;
        const mq = w.matchMedia(REDUCED_MOTION_QUERY);
        if (!mq || typeof mq.matches !== 'boolean') return null;
        return mq.matches;
    } catch (_e) { return null; }
}

/**
 * 解析「本机现在该用哪一档动效」。
 * 判据顺序本身就是口径：**用户显式选择 > 系统政策 > 既有默认**。
 * @param {string} userLevel storage 里存的档位
 * @param {{reducedMotion?: boolean|null}} [env] 政策读数；null/undefined = 问不到
 * @returns {{level: string, source: string, reducedMotion: (boolean|null)}}
 *   source ∈ 'user' | 'policy' | 'default' —— 「这一档是谁定的」必须可读，
 *   否则「用户选全开却看起来被系统降了」这类问题在现场无法定位。
 */
export function resolveMotionLevel(userLevel, env) {
    const user = normalizeMotionLevel(userLevel);
    const rm = env && typeof env.reducedMotion === 'boolean' ? env.reducedMotion : null;
    if (user !== MOTION_LEVELS.AUTO) return { level: user, source: 'user', reducedMotion: rm };
    if (rm === true) return { level: MOTION_LEVELS.REDUCED, source: 'policy', reducedMotion: rm };
    if (rm === false) return { level: MOTION_LEVELS.FULL, source: 'policy', reducedMotion: rm };
    // 问不到政策：按**修前既有观感**给全开 —— 保守方向是「不改变既有行为」，
    //   而不是「悄悄替用户减动」。
    return { level: MOTION_LEVELS.FULL, source: 'default', reducedMotion: rm };
}

/** 档位是否属于「装饰类整族停」的那一侧（reduced / still）。 */
export function isStillLevel(level) {
    const l = normalizeMotionLevel(level);
    return l === MOTION_LEVELS.REDUCED || l === MOTION_LEVELS.STILL;
}

/**
 * 把档位写到 documentElement 上（浏览器真懂的载体）。
 * 写两个属性而不是一个，因为**语义不同**：
 *   · `data-motion=<实际生效的档>`：写解析后的 level 而不是原始 'auto' —— 否则
 *     CSS 侧要自己去问政策，等于把同一份判断散落两处；
 *   · `data-still`：**仅** reduced/still 写。full 档必须**移除**它（不是写 0）——
 *     属性存在即生效，写 0 仍会被 `[data-still]` 命中，那是本仓治过的
 *     「属性在但不表达这件事」。
 * @returns {{ok:boolean, level:string, source:string, still:boolean, reason:string}}
 */
export function applyMotionLevel(doc, userLevel, env) {
    const e = env || {};
    const rm = typeof e.reducedMotion === 'boolean' ? e.reducedMotion : readReducedMotion(e.win);
    const r = resolveMotionLevel(userLevel, { reducedMotion: rm });
    const still = isStillLevel(r.level);
    try {
        const de = doc && doc.documentElement;
        if (!de || typeof de.setAttribute !== 'function') {
            return { ok: false, level: r.level, source: r.source, still, reason: 'documentElement 不可用（无宿主）' };
        }
        de.setAttribute(MOTION_ATTR, r.level);
        if (still) de.setAttribute(STILL_ATTR, '1');
        else if (typeof de.removeAttribute === 'function') de.removeAttribute(STILL_ATTR);
        return { ok: true, level: r.level, source: r.source, still, reason: '' };
    } catch (err) {
        return { ok: false, level: r.level, source: r.source, still, reason: String((err && err.message) || err) };
    }
}

/**
 * 面板可见性 × 页面可见性的**降频判定**（纯函数，可单测）。
 * 判定表（四态互不同形，不得塌两态）：
 *   面板可见 + 页面可见 = foreground（跑满）
 *   面板不可见 + 页面可见 = panel-hidden（面板关了，停面板内动效/轮播）
 *   面板可见 + 页面不可见 = doc-hidden（页面切走了，停宠物与轮询）
 *   两者都不可见 = both-hidden
 * 为什么必须分开报：三种「不活跃」处境的**处置不同**。
 * @returns {{active:boolean, reason:string}}
 */
/**
 * 把闸门结果写到 documentElement（与 applyMotionLevel 分工不同，故不合并）：
 *   · 档位（applyMotionLevel）回答「用户/系统要多少动效」；
 *   · 闸门（本函数）回答「**现在这一刻**该不该跑」。
 * `active=false` 时写 `data-bg=<成因>`；`active=true` 时**移除**该属性（不是写空值）。
 * @returns {{ok:boolean, attr:string, reason:string}}
 */
export function applyMotionGate(doc, active, reason) {
    const r = String(reason || '');
    try {
        const de = doc && doc.documentElement;
        if (!de || typeof de.setAttribute !== 'function') return { ok: false, attr: '', reason: 'documentElement 不可用（无宿主）' };
        if (active === true) {
            if (typeof de.removeAttribute === 'function') de.removeAttribute(BG_ATTR);
            return { ok: true, attr: '', reason: r };
        }
        de.setAttribute(BG_ATTR, r || 'hidden');
        return { ok: true, attr: r || 'hidden', reason: r };
    } catch (e) {
        return { ok: false, attr: '', reason: String((e && e.message) || e) };
    }
}

export function motionGate(panelOpen, docVisible) {
    const p = panelOpen === true;
    const d = docVisible === true;
    if (p && d) return { active: true, reason: 'foreground' };
    if (!p && d) return { active: false, reason: 'panel-hidden' };
    if (p && !d) return { active: false, reason: 'doc-hidden' };
    return { active: false, reason: 'both-hidden' };
}

/**
 * 把两条可见性来源合起来绑一次。
 * @param {*} deps { win, doc, getPanelOpen }
 * @param {function} cb 状态变化回调（入参 = motionGate 结果 + {panelOpen, docVisible, cause}）
 * @param {*} [rt] ManagedRuntime（可选）：登记进它以便一次性回收
 * @returns {{ok:boolean, reason:string, state:function, off:function}}
 *   `off()` 幂等可重复调用；ok=false 时同样可调用（空操作）。
 */
export function bindVisibilityGate(deps, cb, rt) {
    const d = deps || {};
    const win = d.win || (typeof globalThis !== 'undefined' ? globalThis : null);
    const doc = d.doc || (win && win.document) || null;
    const getPanelOpen = typeof d.getPanelOpen === 'function' ? d.getPanelOpen : () => false;
    const notify = typeof cb === 'function' ? cb : () => {};
    if (!win || typeof win.addEventListener !== 'function') {
        return { ok: false, reason: '无 addEventListener（无宿主）', state: () => motionGate(false, false), off: () => {} };
    }
    let lastKey = null;
    let disposed = false;
    const docVisible = () => !(doc && doc.hidden === true);
    const current = () => {
        const panelOpen = !!getPanelOpen();
        const dv = docVisible();
        return { ...motionGate(panelOpen, dv), panelOpen, docVisible: dv };
    };
    const emit = (cause) => {
        try {
            const s = current();
            const key = s.reason;
            if (key === lastKey) return;
            lastKey = key;
            notify({ ...s, cause: String(cause || 'change') });
        } catch (_e) { /* 判定失败不得阻断宿主 */ }
    };
    const onVis = () => emit('visibility');
    const onPanel = () => emit('panel');
    try {
        if (rt && typeof rt.addListener === 'function') {
            rt.addListener(doc || win, 'visibilitychange', onVis, false, 'motion:visibility');
            rt.addListener(win, 'phone:panelVisibility', onPanel, false, 'motion:panel');
        } else {
            (doc || win).addEventListener('visibilitychange', onVis);
            win.addEventListener('phone:panelVisibility', onPanel);
        }
    } catch (e) {
        return { ok: false, reason: '绑定失败：' + String((e && e.message) || e), state: current, off: () => {} };
    }
    emit('init');
    return {
        ok: true,
        reason: '',
        /** 当前状态（现算，不留缓存） */
        state: current,
        off: () => {
            if (disposed) return;
            disposed = true;
            try {
                if (rt && typeof rt.cancelByTag === 'function') { rt.cancelByTag('motion:'); return; }
                (doc || win).removeEventListener('visibilitychange', onVis);
                win.removeEventListener('phone:panelVisibility', onPanel);
            } catch (_e) { /* 卸载失败不得抛 */ }
        }
    };
}

/**
 * 「恢复后重取」的调度器：同一次恢复里的多个重取请求**合成一次**。
 * 语义：
 *   · 同 key 覆盖（保留最新那次）；
 *   · `maxTasks` 有界：超出的请求**如实丢弃并计数**（不静默丢）；
 *   · flush 前先清空台账：任务内再登记不会造成自噬循环。
 * @returns {{ok:boolean, request:function, flush:function, stats:function}}
 */
export function createResumeScheduler(opts) {
    const o = opts || {};
    const maxTasks = Number.isFinite(o.maxTasks) && o.maxTasks > 0 ? Math.floor(o.maxTasks) : 12;
    const tasks = new Map();
    let dropped = 0;
    let flushes = 0;
    let lastFlushAt = null;
    return {
        ok: true,
        /** 登记一个「恢复时要重取」的任务；同 key 覆盖（保留最新那次）。 */
        request(key, fn) {
            const k = String(key || '');
            if (!k || typeof fn !== 'function') return false;
            if (!tasks.has(k) && tasks.size >= maxTasks) { dropped += 1; return false; }
            tasks.set(k, fn);
            return true;
        },
        /** 执行全部已登记任务。 */
        flush(reason) {
            if (!tasks.size) return { ran: 0, failed: 0, reason: String(reason || '') };
            const entries = [...tasks.entries()];
            tasks.clear();
            flushes += 1;
            lastFlushAt = Date.now();
            let ran = 0, failed = 0;
            for (const [k, fn] of entries) {
                try { fn(k); ran += 1; } catch (_e) { failed += 1; }
            }
            return { ran, failed, reason: String(reason || '') };
        },
        /** 读数：等待中 / 已丢弃 / 已 flush 次数 / 末次时刻 / 上限。 */
        stats() {
            return { pending: tasks.size, dropped, flushes, lastFlushAt, maxTasks, keys: [...tasks.keys()].sort() };
        }
    };
}

export default {
    MOTION_LEVELS, MOTION_LEVEL_LIST, REDUCED_MOTION_QUERY, MOTION_ATTR, STILL_ATTR, BG_ATTR,
    RESUME_EVENT, MOTION_STORAGE_KEY,
    normalizeMotionLevel, readReducedMotion, resolveMotionLevel, isStillLevel,
    applyMotionLevel, applyMotionGate, motionGate, bindVisibilityGate, createResumeScheduler
};
