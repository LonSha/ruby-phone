/* ========================================================
 * config/source-locator.js — [v4.13.0 · R4-O1 第一切片] 出处定位归一(纯函数)
 * --------------------------------------------------------
 * 【这一刀治的是什么(修前实测,读码可复算)】
 *   `apps/memory/memory-view.js::_askFaceHtml` 把答案行的出处渲染成一个**普通 div**
 *   ——`出处:承诺 · 第 12 楼` 只是一行字。注释与计划都写着「可点开」,而**答案行上
 *   没有任何跳转按钮**:`config/memory-qa-contract.js::qaRefOf` 早就能把上游
 *   `{ref, floor, ledger}` 归一成 `{kind:'memory', id, appId}`(九账行身份),
 *   `config/open-ref.js` 也早有 `applyOpenRef`,但**问往事这条路一个消费点都没有**
 *   (全仓实测:`qaRefOf` 只被测试与门禁清单引用,产品面零命中)。
 *   ⇒ 「相信一行摘要」与「点开原文核对」之间没有桥。这不是索引不够,是**出处没有靶心**。
 *
 * 【为什么单独一件(而不是在视图里就地判)】
 *   出处有**两类靶心**,处置相反:
 *     · 有楼层(chat 事实) ⇒ 该跳**主聊天的那一楼**;
 *     · 无楼层但有引用键(九账行) ⇒ 该跳**总结记忆册的那一条**。
 *   若视图自己判:`kind` 会漂(同一件事出现 `chat` / `floor` / `chat-floor` 三种写法),
 *   而「**本版宿主没有楼层定位口**」与「**这一楼被删了**」会压成同一句
 *   「打不开」—— 前者等升级、后者去查历史楼,处置相反。
 *   本件把这两类在**渲染前**一次判死,并把「为什么不跳 / 跳了但没到」说成一个词。
 *
 * 【口径四条】
 *   1 楼层走**全仓唯一取值门** `config/num-gate.js::numOrNull` —— `Number(null)` 恒等于 0,
 *     不设门就会把「没给楼层」读成「就在第 0 楼」;而 `0` 是**合法楼层**。
 *   2 有楼层**优先**跳楼层(chat):楼层是原文本体,九账行只是它的索引。
 *   3 无楼层但归一引用成立 ⇒ 走跨 App 靶心(`config/open-ref.js` 的 `memory` kind,
 *     已登记归属 `summdesk`),**不硬投**未登记的 kind。
 *   4 定位口缺席(opts/probe 没给)**不报成功**——「函数没抛」不等于「定位到了」,
 *     这正是本仓最贵的缺陷形态(不报错、只默默没生效)。
 * ======================================================== */
'use strict';
import { numOrNull } from './num-gate.js';

/** 出处靶心的状态词表(判据按此表逐词核,防随口新词)。**六态互不同形,不许压平**。 */
export const LOCATOR_STATES = Object.freeze({
    CHAT: 'chat',                                  // 有合法楼层 ⇒ 跳主聊天那一楼
    MEMORY: 'memory',                              // 无楼层、有引用键 ⇒ 跳总结记忆册那一条
    NO_TARGET: 'no-target',                        // 既无楼层也无引用键(不假装有)
    REF_INVALID: 'ref-invalid',                    // 有账名但没有可用引用键(不蒙着投)
    LOCATION_UNAVAILABLE: 'location-unavailable',  // 本版宿主没提供楼层定位口(等升级)
    NOT_FOUND: 'not-found'                         // 宿主跑了、点了,但那一楼/那一条不在了
});

/** 定位手的归因词表(与 states 分开:一个是「该去哪」,一个是「去成了没有」)。 */
export const LOCATE_METHODS = Object.freeze({
    CHAT_FLOOR: 'chat-floor',
    OPEN_REF: 'open-ref',
    NONE: 'none'
});

/** 宿主定位口的**唯一契约名**(宿主与手机两侧都照这一个名字接线,不各写一份)。 */
export const HOST_LOCATE_METHOD = 'locateChatFloor';

/**
 * 跨 App 靶心投递名(`config/open-ref.js` 已登记 `memory → summdesk`)。
 * 只登记**归属**,不在本件重算一遍 kind 合法性(那是 open-ref.js 的职责)。
 */
export const SOURCE_VIEWER = Object.freeze({
    appId: 'summdesk',
    label: '总结记忆',
    hint: '记忆册里按 id 定位那一条'
});

/** 账名兜底标签(上游账 id 缺省时)。**不做客户端账名翻译** —— 臆造账名比显示原值更糟。 */
export const LEDGER_FALLBACK = '出处';

/** 该账的可读标签:有账名用账名,没有用兜底。不臆造、不猜。 */
export function ledgerLabelOf(ledger) {
    const s = (typeof ledger === 'string') ? ledger.trim() : '';
    return s || LEDGER_FALLBACK;
}

/**
 * 把上游答案行(或任何 `{ref, floor, ledger}`)归一成一个**恒定形状**的出处靶心。
 *
 * @param raw 任意值(上游 answer 项 / qaRefOf 结果 / 视图 data-src 解出的对象)
 * @returns {{state:string, kind:string, id:string, floor:number|null,
 *            appId:string, ledger:string, label:string}}
 *   · `floor` 为 `null` 只说「没给可用楼层」,**不补 0**;
 *   · `id` 与 `kind` 在不可投时尽量带回可读值,便于把「哪儿不对」报出来。
 */
export function normalizeSource(raw) {
    const r = (raw && typeof raw === 'object' && !Array.isArray(raw)) ? raw : {};
    /* ★ 楼层先过取值门:`null` / `''` / `undefined` 一律 null(不塌成 0 楼);
     *   而数字 `0` 与字符串 `'0'` **都是合法楼层**。 */
    const floor = numOrNull(r.floor);
    const ledger = (typeof r.ledger === 'string') ? r.ledger.trim() : '';
    const label = ledgerLabelOf(ledger);
    const refId = refStr(r.ref) || refStr(r.id);
    if (floor !== null) {
        return {
            state: LOCATOR_STATES.CHAT, kind: 'chat-floor',
            id: refId || ('floor:' + floor), floor, appId: '', ledger, label
        };
    }
    if (refId) {
        return {
            state: LOCATOR_STATES.MEMORY, kind: 'memory',
            id: refId, floor: null, appId: SOURCE_VIEWER.appId, ledger, label
        };
    }
    if (ledger) {
        return {
            state: LOCATOR_STATES.REF_INVALID, kind: '', id: '',
            floor: null, appId: '', ledger, label
        };
    }
    return {
        state: LOCATOR_STATES.NO_TARGET, kind: '', id: '',
        floor: null, appId: '', ledger: '', label: LEDGER_FALLBACK
    };
}

function refStr(v) {
    if (typeof v === 'string') return v.trim();
    if (typeof v === 'number' && Number.isFinite(v)) return String(v);
    return '';
}

/** 该靶心是不是「能去」的(chat / memory);其余四态一律不能去。 */
export function isLocatable(target) {
    const t = (target && typeof target === 'object') ? target : null;
    return !!(t && (t.state === LOCATOR_STATES.CHAT || t.state === LOCATOR_STATES.MEMORY));
}

/**
 * 把 memory 靶心折成一条**跨 App 引用**(供派发侧用同一支笔写字)。
 *
 * 为什么单独一件:`ref` 的字段名与 `appId` 的归属都是**登记面**的事
 *   (kind→appId 归属在 `config/open-ref.js` 已登记;`appId` 必须与归属一致,
 *   否则那里会判 `ref-app-mismatch` 而**不投**)。若消费侧各处手写对象字面量,
 *   归属一改就有一处静默失配。本函数只做一件事:照登记面写出**那一份**。
 *
 * @returns {{appId:string, kind:string, id:string}|null} 不可投(非 memory 态 / 无 id)时 **null**
 */
export function sourceOpenRef(target) {
    const t = (target && typeof target === 'object') ? target : normalizeSource(null);
    if (t.state !== LOCATOR_STATES.MEMORY || !t.id) return null;
    return { appId: SOURCE_VIEWER.appId, kind: 'memory', id: t.id };
}

/**
 * 把靶心投到宿主/壳上(消费侧**唯一一处**)。
 *
 * 契约(两侧照同一个名字接线,不各写一份):
 *   · `host[HOST_LOCATE_METHOD](floor, opts)` —— 宿主定位主聊天楼层;
 *     返回 `{ok:true}` 才算成,**不返回 / 返回非对象一律算没成**(防「没抛=成功」)。
 *   · memory 靶心走 `open-ref` 通道:由调用方(视图)派发跨 App 事件,
 *     本函数不自己派事件(纯函数不碰 DOM —— 本件零副作用)。
 *
 * @param target normalizeSource 的结果
 * @param host   宿主(`window` / 壳 / 测试注入的探针对象);缺省即无定位口
 * @returns {{ok:boolean, method:string, reason:string}}
 *   reason 五态:''(成了)/ location-unavailable / not-found / host-silent / thrown
 */
export function locateTarget(target, host) {
    const t = (target && typeof target === 'object') ? target : normalizeSource(null);
    if (t.state === LOCATOR_STATES.MEMORY) {
        /* 跨 App 靶心由视图派事件,本函数如实报「交给 open-ref 通道」——
         *   不在这里假装投过(投递结果由 applyOpenRef 在宿主侧回报)。 */
        return { ok: true, method: LOCATE_METHODS.OPEN_REF, reason: '' };
    }
    if (t.state !== LOCATOR_STATES.CHAT) {
        return { ok: false, method: LOCATE_METHODS.NONE, reason: t.state };
    }
    const fn = (host && typeof host === 'object') ? host[HOST_LOCATE_METHOD] : null;
    if (typeof fn !== 'function') {
        return { ok: false, method: LOCATE_METHODS.NONE, reason: LOCATOR_STATES.LOCATION_UNAVAILABLE };
    }
    let r;
    try { r = fn.call(host, t.floor, { ref: t.id, ledger: t.ledger }); }
    catch (_e) { return { ok: false, method: LOCATE_METHODS.CHAT_FLOOR, reason: 'thrown' }; }
    if (r && typeof r === 'object' && r.ok === true) {
        return { ok: true, method: LOCATE_METHODS.CHAT_FLOOR, reason: '' };
    }
    if (r && typeof r === 'object' && r.ok === false) {
        return { ok: false, method: LOCATE_METHODS.CHAT_FLOOR, reason: refStr(r.reason) || LOCATOR_STATES.NOT_FOUND };
    }
    /* ★ 不回报 = 没成。本仓最贵的缺陷形态正是「不报错、只是默默没生效」。 */
    return { ok: false, method: LOCATE_METHODS.CHAT_FLOOR, reason: 'host-silent' };
}

/**
 * 出处靶心的一句话归因(唯一实现;供视图念出)。
 * **六态各有各的形** —— 压平任意两态都会造出「处置相反的两件事长得一样」。
 */
export function sourceLocatorLine(target) {
    const t = (target && typeof target === 'object') ? target : normalizeSource(null);
    switch (t.state) {
        case LOCATOR_STATES.CHAT:
            return '可跳到第 ' + t.floor + ' 楼' + (t.ledger ? '(' + t.label + ')' : '');
        case LOCATOR_STATES.MEMORY:
            return '这条只有账名与引用键,可到' + SOURCE_VIEWER.label + '里定位';
        case LOCATOR_STATES.REF_INVALID:
            return '有出处(' + t.label + ')但没给引用键 —— 不硬投(不假装能跳)';
        case LOCATOR_STATES.LOCATION_UNAVAILABLE:
            return '本版宿主没有楼层定位口(等升级;不是「这一楼没了」)';
        case LOCATOR_STATES.NOT_FOUND:
            return '点了,但那一楼不在了(可能已删)';
        case LOCATOR_STATES.NO_TARGET:
        default:
            return '未给出出处(不假装有)';
    }
}

/** 定位手的归因一句话(供视图在跳转失败时念出;与上面的「该去哪」分列)。 */
export function locateResultLine(res) {
    const r = (res && typeof res === 'object') ? res : {};
    if (r.ok) {
        return r.method === LOCATE_METHODS.OPEN_REF
            ? '已交给' + SOURCE_VIEWER.label + '定位'
            : '已跳到出处';
    }
    const why = refStr(r.reason) || 'unknown';
    if (why === LOCATOR_STATES.LOCATION_UNAVAILABLE) return '本版宿主没有楼层定位口(等升级)';
    if (why === LOCATOR_STATES.NOT_FOUND) return '那一楼不在了(可能已删)';
    if (why === 'host-silent') return '宿主没回报结果 —— 不当作跳成功';
    if (why === 'thrown') return '定位口抛错(已降级)';
    return '没能定位:' + why;
}

export default {
    LOCATOR_STATES, LOCATE_METHODS, HOST_LOCATE_METHOD, SOURCE_VIEWER, LEDGER_FALLBACK,
    ledgerLabelOf, normalizeSource, isLocatable, sourceOpenRef,
    locateTarget, sourceLocatorLine, locateResultLine
};