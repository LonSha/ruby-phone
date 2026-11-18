/**
 * config/phone-facts.js — R24-X1 手机事实通道：跨 App 的「现在是什么值」（v4.158.0）
 *
 * 【与现有两面划清边界（读前必看，否则必然重做一份）】
 *   1. `config/phone-events.js`（316 行）是**事件**契约：16 个事件名、29 处订阅、83 处派发。
 *      事件 = **动词**（「谁做了什么」），是边沿触发，订阅方错过就错过。
 *      本模块 = **名词**（「现在是什么值」），是电平语义，任何时刻可读当前快照。
 *      两者缺一不可，且**新代码不得混用**：想推动作走事件，想显示数据走事实。
 *   2. `config/phone-fact-contract.js`（R3-X1）是**消费上游 lonsha 记忆插件事实桥**的回执面
 *      （跨仓、只读、四态回执）。本模块是**本仓内** App 之间的值总线，不碰上游、不发网络、
 *      不写存储。同名不同事，勿合并。
 *
 * 【治的欠债】
 *   现在想知道「当前剧情钟几点」「我在跟谁聊」「今天花多少钱」，订阅方各自去翻别人的 storage 键
 *   或全局对象 —— 于是同一个值长出多份账，且各份在某一轮改动后无声分叉（本仓老账「一物多账」）。
 *   本模块给出一条唯一通道：值只由**唯一持有者**发布，订阅方只拿快照。
 *
 * 【三态不塌（本仓最贵的老账）】
 *   `known`   有值且未过期
 *   `stale`   有值但超过该事实的时效（**仍带 value**，界面必须与 known 不同形）
 *   `unknown` 没有可用值；`reason` 必须逐条区分，不许压成一句「无」：
 *            `never-published`（登记了但从未发布）/ `publisher-off`（发布者未上电）/
 *            `no-declaration`（这个事实名根本没登记）
 *   「没发布」与「发布者关了」与「没这个事实」是三种处置相反的处境。
 *
 * 【单发布者铁律】
 *   同一事实被两个发布者登记 ⇒ **启动即拒判**（后到者被拒，先到者保留），并在回执里点名冲突双方。
 *   这不是洁癖：双发布者意味着两处各写一份，读到的值取决于谁后写 —— 这正是「一物多账」的起点。
 *
 * 【纪律】
 *   纯函数式内核 + 显式注入时钟（`atMs` / `nowMs`），不读 `Date.now()`，不碰 DOM，不写 storage。
 *   装配点只做一件事：把 `phoneFactsSelfCheck()` 挂进启动自检。
 */

/* 数值取值门：全仓唯一实现（config/num-gate.js，零依赖叶子）。
 * 本模块不用 `Number.isFinite(Number(x))` —— 那会把「没给」与「给了 0」塌成同一个读数。 */
import { numOrNull } from './num-gate.js';

/** 事实三态（唯一词表；界面按名渲染，不许折叠） */
export const FACT_STATES = Object.freeze({
    KNOWN: 'known',
    STALE: 'stale',
    UNKNOWN: 'unknown'
});

/** 未取到值的三种理由（必须逐条不同形） */
export const FACT_UNKNOWN_REASONS = Object.freeze({
    NEVER_PUBLISHED: 'never-published',
    PUBLISHER_OFF: 'publisher-off',
    NO_DECLARATION: 'no-declaration'
});

/** 默认时效（毫秒）：钟/未读这类高频值应由调用方给更小的 ttl，此处只作兜底 */
const DEFAULT_TTL_MS = 60000;

/** 回执台账上限（内存内环形；不落盘，不参与持久化） */
const RECEIPT_CAP = 64;

/**
 * 单值三态判定（纯函数，唯一实现）。
 * @param {{value:*, atMs:number}|null} slot 当前值槽
 * @param {number} nowMs 显式当前时刻
 * @param {number} ttlMs 该事实时效
 * @param {string} reasonWhenAbsent 槽为空时的理由
 */
export function factFace(slot, nowMs, ttlMs, reasonWhenAbsent) {
    if (!slot || slot.atMs === null || slot.atMs === undefined) {
        return {
            face: FACT_STATES.UNKNOWN,
            reason: String(reasonWhenAbsent || FACT_UNKNOWN_REASONS.NEVER_PUBLISHED),
            value: null,
            ageMs: null,
            atMs: null,
            publisher: '',
            version: 0
        };
    }
    const nowN = numOrNull(nowMs);
    const ageMs = nowN === null ? null : nowN - Number(slot.atMs);
    const ttlN = numOrNull(ttlMs);
    const ttl = ttlN === null ? DEFAULT_TTL_MS : ttlN;
    return {
        /* 过期**仍然带值**：`stale` 是「旧但可显示」，「unknown」是「不能显示」。 */
        face: (ageMs !== null && ageMs > ttl) ? FACT_STATES.STALE : FACT_STATES.KNOWN,
        reason: 'ok',
        value: slot.value,
        ageMs,
        atMs: slot.atMs,
        publisher: String(slot.publisher || ''),
        version: Number(slot.version) || 0
    };
}

/**
 * 建一个事实登记表（一次一台手机 = 一个实例）。
 * @param {{ttlMs?:number, receiptCap?:number}} [opts]
 */
export function createFactRegistry(opts) {
    const o = (opts && typeof opts === 'object') ? opts : {};
    const ttlOpt = numOrNull(o.ttlMs);
    const defaultTtl = ttlOpt === null ? DEFAULT_TTL_MS : ttlOpt;
    const capOpt = numOrNull(o.receiptCap);
    const cap = capOpt === null ? RECEIPT_CAP : capOpt;
    /** factName -> { publisher, ttlMs } */
    const decls = new Map();
    /** publisherId -> { powered:boolean } */
    const pubs = new Map();
    /** factName -> { value, atMs, publisher, version } */
    const slots = new Map();
    /** factName -> Set<fn> */
    const subs = new Map();
    const receipts = [];

    function pushReceipt(row) {
        receipts.push(row);
        while (receipts.length > cap) receipts.shift();
    }

    function publisherPower(id) {
        const p = pubs.get(String(id));
        /* 未显式声明上电状态 ⇒ 视为上电（发布即证明它在），但**读**的时候仍按槽位判定。 */
        return p ? p.powered !== false : true;
    }

    /**
     * 登记某事实的唯一发布者。
     * @returns {{ok:boolean, face:'declared'|'idempotent'|'conflict', publisher:string, conflictWith:string}}
     */
    function declarePublisher(factName, publisherId, declOpts) {
        const fact = String(factName || '');
        const pub = String(publisherId || '');
        if (!fact || !pub) {
            return { ok: false, face: 'invalid', publisher: pub, conflictWith: '', reason: 'empty-name' };
        }
        const ttlOpt = numOrNull(declOpts && declOpts.ttlMs);
        const ttl = ttlOpt === null ? defaultTtl : ttlOpt;
        const cur = decls.get(fact);
        if (cur && cur.publisher === pub) {
            return { ok: true, face: 'idempotent', publisher: pub, conflictWith: '' };
        }
        if (cur && cur.publisher !== pub) {
            /* 后到者被拒，先到者保留 —— 冲突不静默覆盖，也不「最后写入者赢」。 */
            pushReceipt({ fact, publisher: pub, face: 'conflict', atMs: null, conflictWith: cur.publisher });
            return { ok: false, face: 'conflict', publisher: pub, conflictWith: cur.publisher };
        }
        decls.set(fact, { publisher: pub, ttlMs: ttl });
        if (!pubs.has(pub)) pubs.set(pub, { powered: true });
        return { ok: true, face: 'declared', publisher: pub, conflictWith: '' };
    }

    /** 发布者上电 / 断电（断电后其名下事实一律 `unknown` + `publisher-off`，不许继续显示旧值冒充现状）。 */
    function setPublisherPower(publisherId, powered) {
        const pub = String(publisherId || '');
        if (!pub) return { ok: false, face: 'invalid' };
        const owned = [];
        for (const [fact, d] of decls) if (d.publisher === pub) owned.push(fact);
        pubs.set(pub, { powered: powered === true });
        return { ok: true, face: powered === true ? 'on' : 'off', facts: owned };
    }

    /**
     * 发布一个值。非登记发布者、未登记事实、发布者断电 —— 三种一律拒收（fail-closed）。
     * @returns {{ok:boolean, face:string, version:number, reason:string}}
     */
    function publish(factName, publisherId, value, atMs) {
        const fact = String(factName || '');
        const pub = String(publisherId || '');
        const d = decls.get(fact);
        if (!d) {
            pushReceipt({ fact, publisher: pub, face: 'undeclared', atMs: null, conflictWith: '' });
            return { ok: false, face: 'undeclared', version: 0, reason: 'not-declared' };
        }
        if (d.publisher !== pub) {
            pushReceipt({ fact, publisher: pub, face: 'not-publisher', atMs: null, conflictWith: d.publisher });
            return { ok: false, face: 'not-publisher', version: 0, reason: 'declared-by:' + d.publisher };
        }
        if (!publisherPower(pub)) {
            pushReceipt({ fact, publisher: pub, face: 'publisher-off', atMs: null, conflictWith: '' });
            return { ok: false, face: 'publisher-off', version: 0, reason: 'publisher-powered-off' };
        }
        const prev = slots.get(fact);
        const version = (prev ? Number(prev.version) || 0 : 0) + 1;
        const at = numOrNull(atMs);
        slots.set(fact, { value, atMs: at, publisher: pub, version });
        const face = factFace(slots.get(fact), at === null ? 0 : at, d.ttlMs, FACT_UNKNOWN_REASONS.NEVER_PUBLISHED);
        pushReceipt({ fact, publisher: pub, face: 'published', atMs: at, conflictWith: '', version });
        /* 订阅方只拿快照（不是可变槽位引用），且拿不到别人的 storage 键。 */
        const set = subs.get(fact);
        if (set) {
            for (const fn of Array.from(set)) {
                try { fn(Object.assign({ fact }, face)); } catch (_e) { /* 订阅方自己的错不许影响发布方 */ }
            }
        }
        return { ok: true, face: 'published', version, reason: 'ok' };
    }

    /** 读当前值（三态 + 逐条理由）。 */
    function read(factName, nowMs) {
        const fact = String(factName || '');
        const d = decls.get(fact);
        if (!d) {
            return {
                fact, face: FACT_STATES.UNKNOWN, reason: FACT_UNKNOWN_REASONS.NO_DECLARATION,
                value: null, ageMs: null, atMs: null, publisher: '', version: 0
            };
        }
        const slot = slots.get(fact);
        if (!slot) {
            return Object.assign(factFace(null, nowMs, d.ttlMs, FACT_UNKNOWN_REASONS.NEVER_PUBLISHED), { fact });
        }
        if (!publisherPower(d.publisher)) {
            /* 断电优先于过期：发布者已不在，旧值连 `stale` 都不配当，只能 `unknown`。 */
            const nowOff = numOrNull(nowMs);
            return {
                fact, face: FACT_STATES.UNKNOWN, reason: FACT_UNKNOWN_REASONS.PUBLISHER_OFF,
                value: null, ageMs: (nowOff === null ? null : nowOff - Number(slot.atMs)),
                atMs: slot.atMs, publisher: d.publisher, version: Number(slot.version) || 0
            };
        }
        return Object.assign(factFace(slot, nowMs, d.ttlMs, FACT_UNKNOWN_REASONS.NEVER_PUBLISHED), { fact });
    }

    /** 全表快照 + 三态计数（界面一屏读全部事实，不逐个去翻别人的键）。 */
    function snapshot(nowMs) {
        const faces = {};
        const counts = { known: 0, stale: 0, unknown: 0 };
        for (const fact of decls.keys()) {
            const f = read(fact, nowMs);
            faces[fact] = f;
            if (f.face === FACT_STATES.KNOWN) counts.known++;
            else if (f.face === FACT_STATES.STALE) counts.stale++;
            else counts.unknown++;
        }
        return { faces, counts, total: decls.size };
    }

    /** 订阅某事实的变更（返回退订函数）。 */
    function subscribe(factName, fn) {
        const fact = String(factName || '');
        if (typeof fn !== 'function') return function noop() {};
        if (!subs.has(fact)) subs.set(fact, new Set());
        subs.get(fact).add(fn);
        return function unsubscribe() {
            const s = subs.get(fact);
            if (s) s.delete(fn);
        };
    }

    /** 登记面自述（谁发布哪个事实、时效多少）—— 供诊断面直接渲染，不用猜。 */
    function describe() {
        const rows = [];
        for (const [fact, d] of decls) {
            rows.push({ fact, publisher: d.publisher, ttlMs: d.ttlMs, powered: publisherPower(d.publisher) });
        }
        return { rows, count: rows.length };
    }

    /** 回执台账副本（环形，最多 cap 条；不外抛内部数组引用）。 */
    function receiptLog() {
        return receipts.slice();
    }

    return {
        declarePublisher, setPublisherPower, publish, read, snapshot,
        subscribe, describe, receiptLog
    };
}

/**
 * 装配点自检：把上面每一条铁律都真跑一遍。
 * 返回 `{ok, bad, sample}`，与 `_bridgeChecks` 的约定一致（坏项逐条写进 bad）。
 */
export function phoneFactsSelfCheck() {
    const bad = [];
    const reg = createFactRegistry({ ttlMs: 1000 });
    const d1 = reg.declarePublisher('clock', 'story-clock', { ttlMs: 1000 });
    if (!d1.ok || d1.face !== 'declared') bad.push('declare:clock');
    const d2 = reg.declarePublisher('clock', 'wallet');
    if (d2.ok || d2.face !== 'conflict' || d2.conflictWith !== 'story-clock') bad.push('双发布者必须拒判');
    /* 未登记事实发布 ⇒ fail-closed */
    const p0 = reg.publish('wallet.balance', 'wallet', 100, 0);
    if (p0.ok || p0.face !== 'undeclared') bad.push('未登记事实必须拒收');
    const p1 = reg.publish('clock', 'story-clock', 480, 0);
    if (!p1.ok || p1.version !== 1) bad.push('publish:first');
    const r1 = reg.read('clock', 500);
    if (r1.face !== FACT_STATES.KNOWN || r1.value !== 480) bad.push('known');
    const r2 = reg.read('clock', 5000);
    if (r2.face !== FACT_STATES.STALE || r2.value !== 480) bad.push('stale 必须仍带值');
    const r3 = reg.read('nope', 500);
    if (r3.face !== FACT_STATES.UNKNOWN || r3.reason !== FACT_UNKNOWN_REASONS.NO_DECLARATION) bad.push('unknown:no-declaration');
    reg.declarePublisher('talk', 'chat');
    const r4 = reg.read('talk', 500);
    if (r4.reason !== FACT_UNKNOWN_REASONS.NEVER_PUBLISHED) bad.push('unknown:never-published');
    /* 订阅：只拿快照，且能退订 */
    let hits = 0;
    const off = reg.subscribe('clock', function () { hits++; });
    reg.publish('clock', 'story-clock', 481, 600);
    off();
    reg.publish('clock', 'story-clock', 482, 700);
    if (hits !== 1) bad.push('subscribe/unsubscribe');
    /* 断电 ⇒ unknown + publisher-off（不许拿旧值冒充现状） */
    reg.setPublisherPower('story-clock', false);
    const r5 = reg.read('clock', 800);
    if (r5.face !== FACT_STATES.UNKNOWN || r5.reason !== FACT_UNKNOWN_REASONS.PUBLISHER_OFF) bad.push('publisher-off');
    const p2 = reg.publish('clock', 'story-clock', 483, 900);
    if (p2.ok) bad.push('断电后不许发布成功');
    const snap = reg.snapshot(800);
    if (snap.total !== 2 || snap.counts.unknown !== 2) bad.push('snapshot:counts');
    const log = reg.receiptLog();
    if (!log.length || typeof log[0].fact !== 'string' || typeof log[0].face !== 'string') bad.push('receipt:shape');
    const desc = reg.describe();
    if (desc.count !== 2) bad.push('describe');
    return {
        ok: bad.length === 0,
        bad,
        sample: 'facts=' + desc.count + ' logs=' + log.length + ' states=' + JSON.stringify(snap.counts)
    };
}

export default {
    FACT_STATES,
    FACT_UNKNOWN_REASONS,
    factFace,
    createFactRegistry,
    phoneFactsSelfCheck
};
