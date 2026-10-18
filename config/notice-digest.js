/* ========================================================
 * config/notice-digest.js — [v4.19.0 · R4-O7] 通知按「事情」收拢(纯函数)
 * --------------------------------------------------------
 * 【这一刀治的是什么(修前实测,读码可复算)】
 *   `config/system-notifications.js` 的 `push()` 只有一道合并:**同 senderKey 且 3 分钟内**。
 *   于是同一件事的两次更新只要换了发送者(或隔了 3 分钟)就是**两条**;
 *   而同一个人的两件不同事(改期 + 转账)在读数上**无法分开** —— 它们就长得一样。
 *   计划原文点名的缺口正是这句:「同一发送者的不同事件与同一事件的多次更新缺少
 *   面向用户的整理方式」。
 *
 * 【本件只做四件事(纯函数:不碰 DOM、不写存储、不联网、不看时钟)】
 *   1 **事件身份**:从通知的 meta 里取 `eventKey`(事情 id)——**缺了就保守分开**
 *      (绝不按标题或发送者猜成同一件事);
 *   2 **按事收拢**:同 `eventKey` 的多条合成一组(最新一条为代表,`count` 为条数,
 *      `spread` 为时间跨度);**跨 App 同事件**也归一组(这正是「不只是按发送者」);
 *   3 **静音规则**:按 App / 联系人 / 事件类型静音 —— 静音**只影响打断,不删消息**
 *      (计划原文逐字);
 *   4 **未读与详情对应**:每组的 `unread` 数与 `ids` 与代表条一一对应,点击能用代表条直跳。
 *
 * 【为什么时钟由参数给,不用 Date.now()】纯函数不得自己看时间 —— 那会让
 *   「同一输入两次调用得同一结果」失效,而判据正靠它(R4-O5 已立此规)。
 * ============================================================ */
'use strict';

/** 收拢态(**四态互不同形,不许压平**)。 */
export const ND_GROUP_STATES = Object.freeze({
    EVENT: 'event',       // 有 eventKey ⇒ 按事收拢(可跨发送者、可跨 App)
    SENDER: 'sender',     // 没有 eventKey ⇒ 只能按发送者兜底(**保守分开**)
    SOLO: 'solo',         // 单条(没有可并的)
    EMPTY: 'empty'        // 没有通知
});

/** 静音维度(**登记表**:改这里即口径变化)。 */
export const ND_MUTE_DIMS = Object.freeze(['appId', 'sender', 'eventKind']);

/** 静音一句话归因词表。 */
export const ND_MUTE_REASONS = Object.freeze({
    OK: '',
    BAD_SHAPE: 'mute-not-object',
    NO_DIM: 'mute-no-dimension',
    UNKNOWN_DIM: 'mute-dim-unknown'
});

/** 事件类型兜底标签:**不臆造翻译**(认不出就用原值)。 */
export function eventKindOf(meta) {
    const m = (meta && typeof meta === 'object') ? meta : {};
    const k = (typeof m.eventKind === 'string') ? m.eventKind.trim() : '';
    return k;
}

/**
 * 一条通知的**事情身份**(唯一实现)。
 *
 * 口径(顺序即语义):
 *   1 有 `meta.eventKey`(非空串)⇒ `{state:'event', key:'event:<k>'}`
 *      —— 可跨发送者、可跨 App 收拢;
 *   2 没有 ⇒ `{state:'sender', key:'sender:<senderKey>', appId}` —— **保守分开**:
 *      同一发送者的两件不同事在读数上仍是两组(缺事件 ID 时不猜);
 *   3 senderKey 也没有 ⇒ `{state:'solo', key:'solo:<id>'}`。
 *
 * @param {{id?:string, appId?:string, senderKey?:string, meta?:object}} rec
 * @returns {{state:string, key:string, appId:string, eventKey:string, senderKey:string}}
 */
export function eventIdentityOf(rec) {
    const r = (rec && typeof rec === 'object') ? rec : {};
    const meta = (r.meta && typeof r.meta === 'object') ? r.meta : {};
    const appId = (typeof r.appId === 'string') ? r.appId : '';
    const senderKey = (typeof r.senderKey === 'string') ? r.senderKey.trim() : '';
    const eventKey = (typeof meta.eventKey === 'string') ? meta.eventKey.trim() : '';
    if (eventKey) {
        return { state: ND_GROUP_STATES.EVENT, key: 'event:' + eventKey, appId: appId, eventKey: eventKey, senderKey: senderKey };
    }
    if (senderKey) {
        return { state: ND_GROUP_STATES.SENDER, key: 'sender:' + senderKey, appId: appId, eventKey: '', senderKey: senderKey };
    }
    const id = (typeof r.id === 'string') ? r.id : '';
    return { state: ND_GROUP_STATES.SOLO, key: 'solo:' + id, appId: appId, eventKey: '', senderKey: '' };
}

/**
 * 把通知历史收成**按事分组**的视图(**纯**:不改入参)。
 *
 * 每组:
 *   · `key` 事情身份;`state` event / sender / solo;
 *   · `lead` 代表条(**最新那一条**,供点击直达与展示);
 *   · `count` 条数;`unread` 组内未读数;`ids` 组内全部 id(与 unread 一一对应);
 *   · `spansApps` 是否跨 App(「不只是按发送者」的证据);
 *   · `firstTs` / `lastTs` / `durationMs` 时间跨度(全都读不出时给 null,**不补 0**)。
 *
 * @param {Array} list 通知列表(新 → 旧)
 * @returns {{ok:boolean, total:number, groups:Array, unread:number, reason:string}}
 */
export function digestOf(list) {
    const out = { ok: false, total: 0, groups: [], unread: 0, reason: '' };
    if (!Array.isArray(list)) {
        out.reason = 'list-not-array(拿不到历史 ⇒ 判不了,不是「没有通知」)';
        return out;
    }
    out.ok = true;
    out.total = list.length;
    if (!list.length) {
        out.reason = 'empty-history(历史真的是空的)';
        return out;
    }
    const order = [];
    const byKey = new Map();
    for (const raw of list) {
        /* ★ **非对象元素不炸也不丢**:历史里混进 null / 数字 / 字符串时,
         *   收拢层必须仍能给出「共 N 条」的读数(丢掉它们等于把用户的条数改小了)。
         *   这些元素没有 eventKey 也没有 senderKey ⇒ 各自成一组(solo),如实分开。 */
        const n = (raw && typeof raw === 'object' && !Array.isArray(raw)) ? raw : { id: '', ts: null, read: false, appId: '', senderKey: '', meta: {} };
        const idt = eventIdentityOf(n);
        let g = byKey.get(idt.key);
        if (!g) {
            g = {
                key: idt.key, state: idt.state, appId: idt.appId,
                eventKey: idt.eventKey, senderKey: idt.senderKey,
                lead: n, count: 0, unread: 0, ids: [],
                apps: [], firstTs: null, lastTs: null, durationMs: null
            };
            /* solo 键会把所有「空壳」并成一组 —— 它们 id 都是空串,故 key 相同。
             *   这是**如实**的:它们确实「没有可分辨的身份」,合成一组并在读数里计数,
             *   好过把它们悄悄丢掉。 */
            byKey.set(idt.key, g);
            order.push(g);
        }
        g.count += 1;
        if (!n.read) g.unread += 1;
        g.ids.push(String(n.id || ''));
        const a = String(n.appId || '');
        if (a && g.apps.indexOf(a) < 0) g.apps.push(a);
        const ts = (typeof n.ts === 'number' && Number.isFinite(n.ts)) ? n.ts : null;
        if (ts !== null) {
            if (g.firstTs === null || ts < g.firstTs) g.firstTs = ts;
            if (g.lastTs === null || ts > g.lastTs) g.lastTs = ts;
        }
    }
    for (const g of order) {
        g.spansApps = g.apps.length > 1;
        g.durationMs = (g.firstTs !== null && g.lastTs !== null) ? (g.lastTs - g.firstTs) : null;
        out.unread += g.unread;
        delete g.apps;
    }
    out.groups = order;
    return out;
}

/**
 * 统一个静音规则:**只认三个维度**且逐条可核。
 *   · 形态不对 ⇒ BAD_SHAPE;**缺维度词** ⇒ NO_DIM;未登记维度 ⇒ UNKNOWN_DIM。
 *   · 三条都瘸时**不静音**(fail-open 到「照常打断」):静音错了会漏掉重要提醒,
 *     而不静音只是吵一点 —— 两害相权取轻。
 *
 * @param {*} rule `{dim, value}` 或 `{appId|sender|eventKind: value}` 的花式写法
 * @returns {{ok:boolean, dim:string, value:string, reason:string}}
 */
export function normalizeMuteRule(rule) {
    const r = (rule && typeof rule === 'object' && !Array.isArray(rule)) ? rule : null;
    if (!r) return { ok: false, dim: '', value: '', reason: ND_MUTE_REASONS.BAD_SHAPE };
    const dimRaw = (typeof r.dim === 'string') ? r.dim.trim() : '';
    if (dimRaw) {
        if (ND_MUTE_DIMS.indexOf(dimRaw) < 0) {
            return { ok: false, dim: dimRaw, value: '', reason: ND_MUTE_REASONS.UNKNOWN_DIM };
        }
        const v = (typeof r.value === 'string') ? r.value.trim() : '';
        if (!v) return { ok: false, dim: dimRaw, value: '', reason: ND_MUTE_REASONS.NO_DIM };
        return { ok: true, dim: dimRaw, value: v, reason: '' };
    }
    /* 花式:恰好给一个维度键才认(**给了两个即形态不明,不猜**)。 */
    const hits = ND_MUTE_DIMS.filter((d) => typeof r[d] === 'string' && r[d].trim());
    if (hits.length !== 1) {
        return { ok: false, dim: '', value: '', reason: ND_MUTE_REASONS.NO_DIM };
    }
    return { ok: true, dim: hits[0], value: String(r[hits[0]]).trim(), reason: '' };
}

/**
 * 该条通知是否被静音。
 *   静音**只影响是否打断** —— 本函数不碰存储、不删消息,调用方据此决定要不要弹横幅。
 *
 * @param {object} rec 通知
 * @param {Array} rules 规则数组(每条经 normalizeMuteRule;**坏的规则跳过**)
 * @returns {{muted:boolean, by:string}}
 */
export function mutedOf(rec, rules) {
    const list = Array.isArray(rules) ? rules : [];
    if (!list.length) return { muted: false, by: '' };
    const r = (rec && typeof rec === 'object') ? rec : {};
    const meta = (r.meta && typeof r.meta === 'object') ? r.meta : {};
    const valOf = {
        appId: String(r.appId || ''),
        sender: String(r.senderKey || ''),
        eventKind: eventKindOf(meta)
    };
    for (const raw of list) {
        const n = normalizeMuteRule(raw);
        if (!n.ok) continue;
        const v = valOf[n.dim];
        if (v && v === n.value) return { muted: true, by: n.dim + '=' + n.value };
    }
    return { muted: false, by: '' };
}

/** 未读与详情对应:一组的代表条 id 与未读 id 列表(**点击直达用代表条**)。 */
export function groupRefsOf(group) {
    const g = (group && typeof group === 'object') ? group : null;
    if (!g) return { ok: false, leadId: '', ids: [], unread: 0, reason: 'group-not-object' };
    const lead = g.lead || {};
    const leadId = String(lead.id || '');
    const ids = Array.isArray(g.ids) ? g.ids.slice() : [];
    return {
        ok: !!leadId && ids.length > 0,
        leadId: leadId, ids: ids,
        unread: Number(g.unread) || 0,
        reason: leadId ? '' : 'lead-missing-id(代表条没 id ⇒ 点不了)'
    };
}

/** 收拢态的一句话归因(唯一实现;**四态各有各的形**)。 */
export function digestLine(d) {
    const x = (d && typeof d === 'object') ? d : {};
    if (!x.ok) return '通知汇总 —(' + (x.reason || '判不了') + ')';
    if (!x.total) return '通知汇总 —(' + (x.reason || '空历史') + ')';
    const events = x.groups.filter((g) => g.state === ND_GROUP_STATES.EVENT).length;
    const senders = x.groups.filter((g) => g.state === ND_GROUP_STATES.SENDER).length;
    return x.total + ' 条收成 ' + x.groups.length + ' 组(按事 ' + events + ' · 按发送者兜底 ' + senders + ')'
        + ' · 未读 ' + x.unread;
}

export default {
    ND_GROUP_STATES, ND_MUTE_DIMS, ND_MUTE_REASONS,
    eventKindOf, eventIdentityOf, digestOf, normalizeMuteRule, mutedOf, groupRefsOf, digestLine
};