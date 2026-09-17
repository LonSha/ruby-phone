/* ========================================================
 * runtime-lifecycle.js — 运行时资源登记与统一回收 [v2.26.0 / v2.27.0]
 * --------------------------------------------------------
 * 动机：v2.25 证明「长期存活对象上的监听器漏一次即永久累积」。
 * 同一类失效在定时器上更隐蔽也更贵：一个 setInterval 只要持有已废弃
 * 实例的闭包，就把该实例的 data/DOM 全部钉在内存里，永不释放，且仍按
 * 周期执行 —— 实测 phone-shell.startClock() 正是这种形态（定时器句柄
 * 未保存、无任何清理路径，一旦宿主被重建即永久累积一个 30s 轮询）。
 *
 * 本模块提供两条收口：
 *   1) ManagedRuntime：登记制。定时器/观察器/监听器一律"经我登记"，
 *      于是 dispose() 能一次性回收全部，stats() 能回答"现在有多少在跑"。
 *   2) onceFlag / rebindGlobal：把仓库里已在用的两种幂等范式
 *      （window._xxxBound 单次 guard、music 的 remove-then-add）收敛成
 *      一处实现，避免各 App 各写一遍、各写各的。
 *
 * [v2.27.0] 登记制推广面：v2.26 只把 phone-shell 一个消费方接上，
 * globalRuntime / onceFlag / rebindGlobal 三个导出全仓零消费 —— 即
 * 「内核建好了但没人用」。本版把 index.js 的三处永久轮询（快捷回复注入
 * 1s / 极文 tick 5min / 微信线上主动 30s）与三处手写 once guard 接上，
 * 并把 globalRuntime 暴露给诊断入口，回答"现在有多少在跑"。
 *
 * 设计约束：
 *   - 所有方法在无宿主（Node 单测）下不抛错：拿不到 timer/observer 就只登记不启动。
 *   - dispose 幂等，可重复调用；dispose 后仍可继续使用（重新登记）。
 *   - 登记项带 tag，便于诊断定位是谁漏的。
 * ======================================================== */

const KIND = Object.freeze({
    INTERVAL: 'interval',
    TIMEOUT: 'timeout',
    OBSERVER: 'observer',
    LISTENER: 'listener'
});

function nextId(rt) {
    rt._seq += 1;
    return `${rt.name}#${rt._seq}`;
}

export class ManagedRuntime {
    /**
     * @param {string} name 诊断用名称（stats/日志中显示）
     */
    constructor(name = 'runtime') {
        this.name = String(name || 'runtime');
        this._seq = 0;
        /** @type {Map<string, {kind:string, tag:string, handle:*}>} */
        this._entries = new Map();
        this._disposed = false;
    }

    /** 已登记项数量 */
    get size() { return this._entries.size; }

    /**
     * 周期定时器（可回收版 setInterval）。
     * @returns {string|null} 登记 id；宿主无 setInterval 时返回 null（不抛）
     */
    addInterval(fn, ms, tag = '') {
        const host = globalThis;
        if (typeof host.setInterval !== 'function' || typeof fn !== 'function') return null;
        const id = nextId(this);
        const handle = host.setInterval(fn, ms);
        this._entries.set(id, { kind: KIND.INTERVAL, tag: String(tag || ''), handle });
        return id;
    }

    /** 一次性定时器（自动在触发后销账，不留僵尸登记） */
    addTimeout(fn, ms, tag = '') {
        const host = globalThis;
        if (typeof host.setTimeout !== 'function' || typeof fn !== 'function') return null;
        const id = nextId(this);
        const handle = host.setTimeout(() => {
            this._entries.delete(id);   // 先销账再执行：回调内可安全 dispose
            try { fn(); } catch (_) { /* 一次性回调的异常不应污染登记层 */ }
        }, ms);
        this._entries.set(id, { kind: KIND.TIMEOUT, tag: String(tag || ''), handle });
        return id;
    }

    /**
     * MutationObserver 登记。宿主无 MutationObserver 时返回 null。
     * @param {Function} callback observer 回调（takes records, observer）
     * @param {object} opts observe() 的 options
     * @returns {{id:string, observe:(node:Node)=>void, observer:MutationObserver}|null}
     */
    addObserver(callback, opts = {}, tag = '') {
        const host = globalThis;
        if (typeof host.MutationObserver !== 'function' || typeof callback !== 'function') return null;
        const id = nextId(this);
        const observer = new host.MutationObserver(callback);
        const entry = { kind: KIND.OBSERVER, tag: String(tag || ''), handle: observer };
        this._entries.set(id, entry);
        return {
            id,
            observer,
            observe(node) {
                if (!node || typeof node.observe !== 'function') return;
                observer.observe(node, { childList: true, subtree: true, ...opts });
                entry.observed = node;   // 记录以供 disconnect 后重连诊断
            }
        };
    }

    /**
     * 监听器登记（等价于 v2.25 手工字段持有，但由登记层统一解绑）。
     * @param {EventTarget} target 长期存活对象（window/document/元素）
     */
    addListener(target, type, handler, opts = false, tag = '') {
        if (!target || typeof target.addEventListener !== 'function') return null;
        const id = nextId(this);
        target.addEventListener(type, handler, opts);
        this._entries.set(id, {
            kind: KIND.LISTENER, tag: String(tag || ''),
            handle: { target, type, handler, opts }
        });
        return id;
    }

    /** 撤销单个登记（清定时器 / 断观察器 / 解监听器） */
    cancel(id) {
        const e = this._entries.get(String(id));
        if (!e) return false;
        this._entries.delete(String(id));
        ManagedRuntime._release(e);
        return true;
    }

    static _release(e) {
        try {
            if (e.kind === KIND.INTERVAL || e.kind === KIND.TIMEOUT) {
                const host = globalThis;
                if (e.kind === KIND.INTERVAL && typeof host.clearInterval === 'function') host.clearInterval(e.handle);
                if (e.kind === KIND.TIMEOUT && typeof host.clearTimeout === 'function') host.clearTimeout(e.handle);
            } else if (e.kind === KIND.OBSERVER) {
                e.handle?.disconnect?.();
            } else if (e.kind === KIND.LISTENER) {
                const h = e.handle;
                h?.target?.removeEventListener?.(h.type, h.handler, h.opts);
            }
        } catch (_) { /* 回收失败不能阻断其余项回收 */ }
    }

    /**
     * [v2.27.0] 按 tag 前缀批量回收：定位"某一类资源整体重建"场景
     * （如调度器重复启动要先停后启、宿主换会话要清空某子系统）。
     * 前缀匹配是刻意的：一次启动往往登记多个资源（轮询 + 预热 timeout），
     * 用同一前缀命名即可一并回收，不必逐个记住 id。
     * @returns {number} 实际回收项数
     */
    cancelByTag(tag) {
        const t = String(tag || '');
        if (!t) return 0;
        let n = 0;
        for (const [id, e] of [...this._entries.entries()]) {
            if (!String(e.tag || '').startsWith(t)) continue;
            this._entries.delete(id);
            ManagedRuntime._release(e);
            n += 1;
        }
        return n;
    }
    /** 全量回收。幂等：重复调用不报错；调用后可继续登记新资源。 */
    dispose() {
        // [v2.28.0] 宿主级域回收时级联回收全部实例级子域：
        //   否则「实例被置 null 但没人调它的 dispose」会留下孤儿域（登记表被外部引用钉住）。
        if (this._childOf === undefined && _childRuntimes.size) {
            for (const rt of [..._childRuntimes]) rt.dispose();
        }
        const ids = [...this._entries.keys()];
        for (const id of ids) {
            const e = this._entries.get(id);
            this._entries.delete(id);
            ManagedRuntime._release(e);
        }
        this._disposed = true;
        // [v2.28.0] 实例级资源域自行注销，避免子域表无限增长
        if (this._childOf) _childRuntimes.delete(this);
        return ids.length;
    }

    /** 是否曾被 dispose 过（供宿主判断是否需要重建） */
    get disposed() { return this._disposed; }

    /** 分类计数：{ interval, timeout, observer, listener, total } */
    stats() {
        const out = { interval: 0, timeout: 0, observer: 0, listener: 0, total: this._entries.size };
        for (const e of this._entries.values()) out[e.kind] = (out[e.kind] || 0) + 1;
        return out;
    }

    /** 登记明细（诊断面板/测试用）：{id, kind, tag} */
    entries() {
        return [...this._entries.entries()].map(([id, e]) => ({ id, kind: e.kind, tag: e.tag }));
    }

    /** 某一类的 tag 列表（定位"谁还在跑"） */
    tagsOf(kind) {
        return [...this._entries.values()].filter(e => e.kind === String(kind)).map(e => e.tag);
    }
}

/* ---------------- 全局登记层（宿主级资源，随插件一次回收） ---------------- */
export const globalRuntime = new ManagedRuntime('global');
/* ---------------- [v2.28.0] 实例级资源域表 ----------------
 * 动机：v2.27 把宿主级常驻资源接进 globalRuntime 后暴露了下一层问题——
 *   大量资源属于**某个实例**而非宿主：一个 MVVM 视图、一个 App、一个组件。
 *   它们只在实例存活期内应当存在，实例销毁/重建时必须精确回收该实例
 *   自己登记的一切，而不该把宿主级资源一起清掉，也不该靠人工维护一份
 *   「这个实例登记了哪几个句柄」的清单（v2.27 前的 6 处手写 clearInterval
 *   正是这份清单的失败形态：漏一个就永久泄漏）。
 * 设计：childRuntime(name) 返回一个挂在 globalRuntime 名下的独立域，
 *   它自持 entries，但由 _childRuntimes 登记以便全量诊断；其 dispose()
 *   只回收本域资源并自动从域表注销。父域 dispose() 会级联回收所有子域。
 */
const _childRuntimes = new Set();
/**
 * [v2.27.0] 全局登记层诊断快照：宿主可直接挂到设置页/控制台，
 * 回答"现在还有哪些常驻资源在跑、分别属于谁"。
 * 无任何登记项时 total 为 0，调用方无需判空。
 * @returns {{total:number, byKind:object, tags:Array<{kind:string, tag:string}>}}
 */
export function globalRuntimeSnapshot() {
    const stats = globalRuntime.stats();
    const children = [..._childRuntimes].map(rt => ({
        name: rt.name,
        total: rt.size,
        byKind: rt.stats()
    }));
    return {
        total: stats.total,
        byKind: { interval: stats.interval, timeout: stats.timeout, observer: stats.observer, listener: stats.listener },
        tags: globalRuntime.entries().map(e => ({ kind: e.kind, tag: e.tag })),
        // [v2.28.0] 实例级资源域：回答「除宿主级之外，还有几个实例各持有多少资源」
        children
    };
}
/* ---------------- [v2.28.0] 实例级资源域 ----------------
 * 用法（视图/App/组件）：
 *   const rt = childRuntime('music-view');
 *   rt.addInterval(fn, 250, 'progress');
 *   ...
 *   rt.dispose();          // 实例销毁：一次性回收本实例全部资源
 * 语义要点：
 *   - 域内 tag 只在本域内匹配（cancelByTag 不会误伤别的实例）；
 *   - 域 dispose 幂等，且会自动从域表注销（重复 dispose 不会二次累加）；
 *   - 无宿主环境下所有方法安全降级不抛（Node 单测可直接调用）。
 * @returns {ManagedRuntime} 独立资源域（已挂到全局域表以供诊断）
 */
export function childRuntime(name) {
    const rt = new ManagedRuntime(String(name || 'child'));
    rt._childOf = globalRuntime;
    _childRuntimes.add(rt);
    return rt;
}
/** 当前存活的实例级资源域数量（诊断/测试用） */
export function childRuntimeCount() {
    return _childRuntimes.size;
}
/**
 * [v2.28.0] 按名（前缀）回收实例级资源域。
 * 场景：宿主把实例置 null（清数据/换会话/换壳）而不走实例自身的 destroy 时，
 *   域内的定时器/监听器会被全局域表引用钉住成为孤儿。此处按域名一次性收净。
 * @param {string} namePrefix 域名前缀（如 'music-view'）；空串 = 回收全部实例域
 * @returns {number} 被回收的域数
 */
export function disposeChildRuntimes(namePrefix) {
    const p = String(namePrefix || '');
    const victims = p ? [..._childRuntimes].filter(rt => rt.name.startsWith(p)) : [..._childRuntimes];
    let n = 0;
    for (const rt of victims) { rt.dispose(); n += 1; }
    return n;
}

/* ---------------- 幂等范式原语（收敛 v2.25 观察到的三种手写写法） ---------------- */

/**
 * 单次 guard 的等价实现（替代散落的 `if (!window._xxxBound) { ... window._xxxBound = true; }`）。
 * @returns {boolean} true = 本次是首次（应继续绑定）；false = 已绑过（应跳过）
 */
export function onceFlag(key, holder = globalThis) {
    const k = `__once_${String(key || '')}`;
    if (!k || k === '__once_') return true;      // 无 key 不去重，避免误吞
    if (holder[k] === true) return false;
    holder[k] = true;
    return true;
}

/**
 * remove-then-add 幂等重绑的等价实现（music-app 范式的通用化）。
 * 旧 handler 存在 holder[holderKey] 上；重建实例时自动先解绑旧引用。
 * @returns {Function} 本次生效并已登记的 handler
 */
export function rebindGlobal(target, type, handler, holder = globalThis, holderKey = '') {
    if (!holderKey) throw new Error('rebindGlobal 需要 holderKey 以定位既有 handler');
    const prev = holder[holderKey];
    if (prev && typeof target?.removeEventListener === 'function') {
        target.removeEventListener(type, prev);
    }
    holder[holderKey] = handler;
    if (typeof target?.addEventListener === 'function') target.addEventListener(type, handler);
    return handler;
}

/** 测试/热重载用：清空 once 标记（生产不调用） */
export function resetOnceFlags(holder = globalThis) {
    for (const k of Object.keys(holder)) {
        if (k.startsWith('__once_')) delete holder[k];
    }
}