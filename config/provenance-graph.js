/* ========================================================
 * config/provenance-graph.js — [v3.86.0 · 拓展计划 R-X2] 跨 App 来源链与实体关系浏览器（纯函数）
 * --------------------------------------------------------
 * 【这一刀治的是什么（修前实测处境，逐条核对）】
 *   全局搜索（v2.16 建、v3.66 接靶心）已经能把「找到一条内容」做对：条目上挂
 *   `meta.ref`、行上有 `data-ref`、点击带靶心派发。但它回答不了另一个问题 ——
 *   **这条内容从哪来、中间被谁改过、还在不在**：
 *     · 生活事件（`config/life-events.js`）的 `sourceId` 明明指向日历备忘或约定，
 *       可时间线上只显示「一条事件」，看不出它的上游此刻还在不在；
 *     · 微博的一条动态可能是世界脉搏推来的**转述**（`config/context-compose.js`
 *       的 `retellChains` 早就会把「同一传闻三平台转述」归成一条链），
 *       但没有任何界面把这条链摆出来，于是生成侧仍会把三处转述读成「三个独立证据」；
 *     · 派生条目（万象背包按 `task:<id>:<index>` 发的奖励）与原始事实**同形**，
 *       没有任何一处标注「这条是算出来的，不是发生过的」；
 *     · 上游被删/撤回后，下游要么照旧显示（冒充现状），要么整条消失（用户以为看错了）
 *       —— 两种都不诚实；
 *     · 角色名（`commitment` 的 actor、聊天里提到的人）**不是全局唯一**：
 *       同名异人、不同会话、不同分支的同一名字，此前没有任何共享的隔离口径。
 *
 * 【本模块做四件事（与 R-X1 action-center 同范式：只消费、不取数）】
 *   ① **节点归一 `buildProvenanceGraph`**：五类节点（事件 / 角色 / 交易 / 素材 / 楼层）
 *      逐条判定「有没有稳定 ref」，没有就**如实标注原因**（验收①）；
 *   ② **四类边**：来源 / 派生 / 转述 / 引用 —— 派生内容必须带 `via` 指向上游，
 *      不写就不算派生、而是**冒充原始事实**（验收②，本模块把这条变成判据）；
 *   ③ **撤回传播**：源被撤回后，下游标 `withdrawn` 并带上 `withdrawnBy`，
 *      **绝不从图上消失**（验收③）；上游不在场时边标 `dangling`（悬空也是读数）；
 *   ④ **隔离**：跨会话 / 跨分支的节点只报壳（kind + 原因，**不带内容**），
 *      跨 scope 的边一律不建（验收④）；可见性判定**共用** X5 已交付的
 *      `config/social-knowledge-bridge.js` 的 `knowledgeCheck`（不写第二份口径）。
 *
 * 【不做什么】
 *   · 不取数：nodes / sources / posts 全部由调用方取好传进来（咽喉唯一取数口）；
 *   · 不写存储：本模块不持 storage 键、不带计时器、不碰 DOM（故**不新增会话键**）；
 *   · 不抛：畸形输入一律降级为「认不出」，如实报，不静默当成功。
 *
 * 【口径纪律（逐条对应本仓治理过的形态）】
 *   · **三态互不同形**：节点 `live` / 边 `live` 与 `dangling` / 失效 `withdrawn`
 *     —— 不许把「上游不在场」与「上游撤回了」压成一格（两者处置相反）；
 *   · **读不到 ≠ 没有**：源本轮没读到 ⇒ 记 `not-read` gap，不记「没有节点」；
 *   · **按内容去重、绝不覆盖**：同 key 的节点第二次出现直接跳过，
 *     不把后一条盖到前一条上（本仓两条写铁律）；
 *   · **认不出就不硬塞**：拿不到会话身份即判「不是同一段」（fail-closed），
 *     宁可多拦一条，不可让一条跨会话内容从关系图里漏出去。
 *
 * 纯 ESM export，纯函数无 window 依赖，保证可测。
 * ======================================================== */
'use strict';

import { numOrNull } from './num-gate.js';
import { normalizeOpenRef, kindAppOf, OPEN_REF_REASONS } from './open-ref.js';
import { retellChains } from './context-compose.js';
import { knowledgeCheck } from './social-knowledge-bridge.js';

/* ───────── ① 五类节点（表格即判据；未登记的 kind 一律不收） ───────── */

export const PG_NODE_KINDS = Object.freeze({
    event: Object.freeze({ label: '事件', icon: '📅', durable: true, note: '本机生活事件，按来源键在本机时间线定位' }),
    character: Object.freeze({ label: '角色', icon: '👤', durable: false, note: '角色名不是全局唯一（同名异人），只在会话内定位' }),
    trade: Object.freeze({ label: '交易', icon: '🧾', durable: true, note: '跨 App 靶心登记表里的账目条目' }),
    material: Object.freeze({ label: '素材', icon: '🖼️', durable: true, note: '跨 App 靶心登记表里的创作条目' }),
    floor: Object.freeze({ label: '楼层', icon: '📜', durable: true, note: '会话内的正文楼层' })
});

/* ───────── ② 四类边（「转述」与「独立来源」必须不同形） ───────── */

export const PG_EDGE_KINDS = Object.freeze({
    source: Object.freeze({ label: '来源', note: '上游是这条的出处' }),
    derive: Object.freeze({ label: '派生', note: '这条由上游算出来，不是发生过的原始事实' }),
    retell: Object.freeze({ label: '转述', note: '同一件事被另一个平台又说了一遍（只算一条来源链）' }),
    quote: Object.freeze({ label: '引用', note: '这条搬了上游原文的一段' })
});

/* ───────── ③ 三态（撤回不消失） ───────── */

export const PG_STATES = Object.freeze({
    live: 'live',            // 在场且有效
    withdrawn: 'withdrawn',  // 源被撤回 / 删除 ⇒ 下游**留位显示失效**
    dangling: 'dangling'     // 上游认不出 / 不在场 ⇒ 悬空（也是读数，不是「没有」）
});

/* ───────── ④ 归因词表（判据按此表逐词核，防随口新词） ───────── */

export const PG_REF_REASONS = Object.freeze({
    OK: '',
    NO_REF: 'no-ref',
    BAD_SHAPE: 'ref-bad-shape',
    NOT_DURABLE: 'not-durable',
    TABLE_MISS: 'ref-table-miss'
});

export const PG_JUMP_REASONS = Object.freeze({
    OK: '',
    NO_REF: 'no-ref',
    NOT_DURABLE: 'not-durable',
    NO_APP_TARGET: 'no-app-target',
    KIND_NOT_REGISTERED: 'kind-not-registered'
});

export const PG_BLOCK_REASONS = Object.freeze({
    CROSS_SCOPE: 'cross-scope',
    CROSS_SCOPE_EDGE: 'cross-scope-edge',
    NOT_VISIBLE: 'not-visible'
});

/* ───────── 小工具 ───────── */

function pgStr(v, max) {
    const s = String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
    return max ? s.slice(0, max) : s;
}

function miss(reason, text) {
    return { ok: false, durable: false, ref: null, reason: reason, text: text };
}

/**
 * 一条记录的**归属段**（跨会话 / 跨分支隔离的两维）。
 * 与 `config/session-gate.js` 的两维同口径：会话身份串 + 分支键。
 */
export function pgScopeOf(x) {
    const o = (x && typeof x === 'object' && !Array.isArray(x)) ? x : {};
    return { chatId: pgStr(o.chatId, 120), branchKey: pgStr(o.branchKey, 120) };
}

/**
 * 两条记录是否属**同一段**（同会话 + 同分支）。
 * **拿不到会话身份即判「不是同一段」**（fail-closed）：宁可多拦一条，
 *   不可让一条跨会话内容从关系图里漏出去 —— 与 session-gate 的纪律同源。
 */
export function pgSameScope(a, b) {
    const x = pgScopeOf(a), y = pgScopeOf(b);
    if (!x.chatId || !y.chatId) return false;
    return x.chatId === y.chatId && x.branchKey === y.branchKey;
}

/** 靶心 → 图上的稳定键（`kind:id`）。 */
export function pgKeyOf(ref) {
    const r = (ref && typeof ref === 'object') ? ref : {};
    return pgStr(r.kind, 40) + ':' + pgStr(r.id, 120);
}

/**
 * 节点身份归一：**有稳定 ref** / **不可长期定位（带原因）** / **认不出**。
 *
 * 为什么角色名必须走「不可长期定位」这条而不是当 id 使：
 *   同名异人是本仓的既知形态（同名的两个人在两个会话里各有一条记录），
 *   把名字当全局唯一 id ⇒ 关系图会把两个人拼成一个人，且**不报错**。
 *
 * @param {object} raw  节点原始记录（含 ref / sourceId / name / floor 之一）
 * @param {string} kind PG_NODE_KINDS 的键
 * @returns {{ok:boolean, durable:boolean, ref:object|null, reason:string, text:string}}
 */
export function pgRefOf(raw, kind) {
    const rc = (raw && typeof raw === 'object' && !Array.isArray(raw)) ? raw : {};
    const k = pgStr(kind || rc.kind, 40);

    if (k === 'character') {
        const name = pgStr(rc.name || rc.label || rc.id, 40);
        if (!name) return miss(PG_REF_REASONS.NO_REF, '角色没有名字，认不出');
        return {
            ok: false, durable: false, ref: { kind: 'character', id: name },
            reason: PG_REF_REASONS.NOT_DURABLE,
            text: '角色名不是全局唯一（同名异人），只能在本会话内定位'
        };
    }
    if (k === 'floor') {
        const n = numOrNull(rc.floor != null ? rc.floor : rc.id);
        if (n === null || n <= 0) return miss(PG_REF_REASONS.BAD_SHAPE, '楼层号不是一个正整数');
        return { ok: true, durable: true, ref: { kind: 'floor', id: String(n) }, reason: '', text: '本会话内按楼层号定位' };
    }
    if (k === 'event') {
        const sid = pgStr(rc.sourceId || rc.id, 120);
        if (!sid) return miss(PG_REF_REASONS.NO_REF, '事件没有来源键，认不出它从哪来');
        return { ok: true, durable: true, ref: { kind: 'event', id: sid }, reason: '', text: '按来源键在本机时间线里定位' };
    }
    /* 交易 / 素材（以及任何带跨 App 靶心的）：**同一份登记表说话** ——
     *   本模块不自己判 kind 是否合法、id 是否成立，那是 open-ref.js 的职责。 */
    const norm = normalizeOpenRef(rc.ref || rc);
    if (!norm.ok) {
        const why = norm.why;
        if (why === OPEN_REF_REASONS.KIND_UNKNOWN || why === OPEN_REF_REASONS.NO_APP) {
            return miss(PG_REF_REASONS.TABLE_MISS, '这个类型没登记在跨 App 靶心表里（投出去也找不到）');
        }
        if (why === OPEN_REF_REASONS.NO_ID) return miss(PG_REF_REASONS.NO_REF, '条目上没有 id');
        return miss(PG_REF_REASONS.BAD_SHAPE, '靶心形态不对（' + String(why) + '）');
    }
    return { ok: true, durable: true, ref: { kind: norm.kind, id: norm.id }, reason: '', text: '按跨 App 靶心定位' };
}

/** 按节点类型给一条**可执行的替代定位**（无跳转能力时不能只说「跳不过去」）。 */
function pgAltOf(node) {
    const k = pgStr(node && node.kind);
    if (k === 'character') return '在「角色」App 里按名字筛（同名会有多条，注意是哪一段会话）';
    if (k === 'event') return '在「日历 → 时间线」里按这条的来源键定位';
    if (k === 'floor') return '在酒馆正文里跳到该楼层';
    return '在来源 App 里按关键词重新检索（这一轮没有可用的靶心）';
}

/**
 * 从图上的一个节点跳到原始出处；**没有跳转能力时给可执行的替代定位**（验收②）。
 * 跳转能力本身仍由 `config/open-ref.js` 的登记表说话 —— 本模块不另立一套。
 */
export function pgJumpOf(node) {
    const n = (node && typeof node === 'object') ? node : {};
    const ref = n.ref || null;
    if (!ref || !ref.kind) {
        return { ok: false, why: PG_JUMP_REASONS.NO_REF, appId: '', ref: null, alt: pgAltOf(n) };
    }
    if (n.durable !== true) {
        return { ok: false, why: PG_JUMP_REASONS.NOT_DURABLE, appId: '', ref: ref, alt: pgAltOf(n) };
    }
    if (ref.kind === 'floor' || ref.kind === 'event') {
        return { ok: false, why: PG_JUMP_REASONS.NO_APP_TARGET, appId: '', ref: ref, alt: pgAltOf(n) };
    }
    const appId = kindAppOf(ref.kind);
    if (!appId) {
        return { ok: false, why: PG_JUMP_REASONS.KIND_NOT_REGISTERED, appId: '', ref: ref, alt: pgAltOf(n) };
    }
    return { ok: true, why: PG_JUMP_REASONS.OK, appId: appId, ref: { appId: appId, kind: ref.kind, id: String(ref.id) }, alt: '' };
}

/* ───────── ⑤ 主入口：归一 → 成边 → 隔离 → 撤回传播 ───────── */

function pgNodeOf(raw, kind, opts) {
    const rc = (raw && typeof raw === 'object' && !Array.isArray(raw)) ? raw : {};
    const refc = pgRefOf(rc, kind);
    const nodeScope = pgScopeOf(rc.scope || opts.scope);
    const key = refc.ref ? pgKeyOf(refc.ref) : (kind + ':?' + String(opts.seq));
    /* 跨会话 / 跨分支：只报壳 —— kind 与原因可以带，**内容一个字都不带**（验收④）。 */
    if (!pgSameScope(nodeScope, opts.scope)) {
        return { blocked: { key: key, kind: kind, reason: PG_BLOCK_REASONS.CROSS_SCOPE, hasRef: !!refc.ref }, node: null };
    }
    return {
        blocked: null,
        node: {
            key: key, kind: kind,
            label: pgStr(rc.label || rc.title || rc.name, 60),
            ref: refc.ref, durable: refc.durable === true, refReason: refc.reason, refText: refc.text,
            scope: nodeScope,
            origin: pgStr(rc.origin, 160),        // 来源端点（另一节点的 key）
            via: pgStr(rc.via, 160),              // 派生自（另一节点的 key）
            of: pgStr(rc.of, 160),                // 引用自（另一节点的 key）
            retellOf: pgStr(rc.retellOf, 160),    // 转述自（另一节点的 key）
            platform: pgStr(rc.platform, 24),     // 转述所属平台（转述链归并用）
            postId: pgStr(rc.postId, 80),         // 社媒来源帖（可见性判定用）
            derived: rc.derived === true,
            state: PG_STATES.live,
            withdrawnBy: ''
        }
    };
}

/**
 * 把一轮取好的记录归一成**来源关系图**。
 *
 * @param {object} input
 *   · `nodes`       记录数组（每条的 `kind` 必须是 PG_NODE_KINDS 的键）
 *   · `readSources` 本轮**确实读到**的源名（未列出的 source 记 `not-read` gap）
 *   · `scope`       当前所属段 `{chatId, branchKey}`（跨段的记录只报壳）
 *   · `withdrawn`   本轮判定已失效的节点 key 数组（撤回**不删除**，只标失效）
 *   · `posts` / `contacts` / `actorId` / `nowMs`  可见性判定输入（走 knowledgeCheck）
 * @returns {{nodes,edges,chains,blocked,gaps,counts,text}}
 */
export function buildProvenanceGraph(input = {}) {
    const o = (input && typeof input === 'object' && !Array.isArray(input)) ? input : {};
    const scope = pgScopeOf(o.scope);
    const rawNodes = Array.isArray(o.nodes) ? o.nodes : [];
    /* 调用方**显式声明读过**的源（撤回判定只认它 —— 见 ④b）。
     *   只凭「图里有这个 kind 的节点」不算读过：那只能证明**至少有一条**，
     *   证明不了「这一类全都在这里」。把「部分看见」当「看全了」=
     *   把「读不到」当「没有」，那正是本仓最贵的反向错读数。 */
    const declaredRead = new Set(Array.isArray(o.readSources) ? o.readSources.map((s) => pgStr(s)) : []);
    const readSet = new Set(declaredRead);
    const nodes = [];
    const blocked = [];
    const gaps = [];
    const seen = new Set();
    let seq = 0;

    /* ① 收节点（未登记的 kind 记 gap，不硬塞进图里） */
    for (const raw of rawNodes) {
        seq += 1;
        const kind = pgStr(raw && raw.kind, 40);
        if (!Object.prototype.hasOwnProperty.call(PG_NODE_KINDS, kind)) {
            gaps.push({ source: kind || '?', reason: 'unknown-kind' });
            continue;
        }
        readSet.add(kind);
        const made = pgNodeOf(raw, kind, { scope: scope, seq: seq });
        if (made.blocked) { blocked.push(made.blocked); continue; }
        if (seen.has(made.node.key)) continue;      // 按内容去重：绝不覆盖
        seen.add(made.node.key);
        nodes.push(made.node);
    }

    /* ② 读不到 ≠ 没有：本轮没读到的源，逐条记 gap */
    for (const k of Object.keys(PG_NODE_KINDS)) {
        if (!readSet.has(k)) gaps.push({ source: k, reason: 'not-read' });
    }

    /* ③ 可见性：**共用** X5 的 knowledgeCheck（不写第二份口径）。
     *   不可见的社媒节点**移到 blocked（只报壳）** —— 这才是「不泄露内容」，
     *   而不是把它静默删掉（那样「被拦下」与「本来没有」又同形了）。 */
    const posts = Array.isArray(o.posts) ? o.posts : null;
    const contacts = Array.isArray(o.contacts) ? o.contacts : [];
    const actorId = pgStr(o.actorId, 80);
    let knowledge = null;
    if (posts && actorId) {
        try { knowledge = knowledgeCheck(posts, contacts, actorId, numOrNull(o.nowMs) || 0); }
        catch (_e) { knowledge = null; }
    }
    if (knowledge) {
        const visibleIds = new Set(knowledge.visible.map((v) => String(v.postId)));
        for (let i = nodes.length - 1; i >= 0; i -= 1) {
            const n = nodes[i];
            if (!n.postId) continue;
            if (visibleIds.has(n.postId)) continue;
            blocked.push({ key: n.key, kind: n.kind, reason: PG_BLOCK_REASONS.NOT_VISIBLE, hasRef: n.durable === true });
            nodes.splice(i, 1);
        }
    }

    /* ④ 成边（先建索引：边只认在场节点；不在场的如实标悬空） */
    const index = new Map();
    for (const n of nodes) index.set(n.key, n);
    const edges = [];
    const addEdge = (kind, fromKey, toKey) => {
        if (!fromKey || !toKey || fromKey === toKey) return;
        const f = index.get(fromKey);
        const t = index.get(toKey);
        if (!f || !t) {
            edges.push({ kind: kind, from: fromKey, to: toKey, state: PG_STATES.dangling });
            return;
        }
        if (!pgSameScope(f.scope, t.scope)) {
            blocked.push({ key: fromKey + '->' + toKey, kind: kind, reason: PG_BLOCK_REASONS.CROSS_SCOPE_EDGE, hasRef: true });
            return;
        }
        edges.push({ kind: kind, from: fromKey, to: toKey, state: PG_STATES.live });
    };
    for (const n of nodes) {
        if (n.origin) addEdge('source', n.origin, n.key);
        if (n.via) addEdge('derive', n.via, n.key);
        if (n.of) addEdge('quote', n.of, n.key);
        if (n.retellOf) addEdge('retell', n.retellOf, n.key);
    }

    /* ④b **同轮内可判定的撤回**（本仓不需要跨轮账本就能判的那一种）：
     *   派生 / 引用 / 转述节点的上游**不在图里**，而**上游那类源本轮确实读过**
     *   ⇒ 那不是「没读到」，是上游**被删 / 被撤回了**。此时：
     *     · 给上游立一块**留位**（墓碑节点：key 与 kind 在，内容已不在）——
     *       验收③要求的「显示失效而不是静默消失」就落在这里；
     *     · 下游标 `withdrawn`，`withdrawnBy` 指向那块墓碑。
     *   反过来：上游那类源本轮**没读** ⇒ 不判撤（留 `dangling`）——
     *   「读不到」与「没有」永远是两件事（本仓最贵的反向错读数）。 */
    for (const e of edges.slice()) {
        if (e.state !== PG_STATES.dangling) continue;
        const upKind = String(e.from).split(':')[0];
        if (!declaredRead.has(upKind)) continue;
        if (index.has(String(e.from))) continue;
        if (!seen.has(String(e.from))) {
            seen.add(String(e.from));
            const tomb = {
                key: String(e.from), kind: upKind,
                label: '', ref: null, durable: false,
                refReason: PG_REF_REASONS.NOT_DURABLE, refText: '源已不在本机（被删或撤回），只知道它曾经是哪一类的哪一条',
                scope: scope, origin: '', via: '', of: '', retellOf: '', platform: '', postId: '',
                derived: false, state: PG_STATES.withdrawn, withdrawnBy: String(e.from), tombstone: true
            };
            nodes.push(tomb);
            index.set(tomb.key, tomb);
        }
        e.state = PG_STATES.withdrawn;
        const t1 = index.get(String(e.to));
        if (t1 && t1.state !== PG_STATES.withdrawn) {
            t1.state = PG_STATES.withdrawn;
            t1.withdrawnBy = String(e.from);
        }
    }

    /* ⑤ 撤回传播：源被撤回 ⇒ 下游标 withdrawn（**留位，不消失**），
     *   并把「是谁被撤了」带到下游（`withdrawnBy`）—— 用户要能看出是谁连累了谁。 */
    const withdrawnSet = new Set(Array.isArray(o.withdrawn) ? o.withdrawn.map((x) => pgStr(x, 160)) : []);
    if (withdrawnSet.size) {
        for (const n of nodes) {
            if (withdrawnSet.has(n.key)) { n.state = PG_STATES.withdrawn; n.withdrawnBy = n.key; }
        }
        let changed = true;
        let guard = 0;
        while (changed && guard < nodes.length + 2) {
            changed = false;
            guard += 1;
            for (const e of edges) {
                /* 上游**已被撤回**（这一轮它已不在图里，但撤回名单点名了它）：
                 *   悬空边照样把失效传下去 —— 否则「上游撤回」会退化成「莫名其妙悬空」，
                 *   两者在用户眼里处置不同（前者等上游恢复，后者要去看看哪条不见了）。 */
                if (e.state === PG_STATES.dangling && withdrawnSet.has(String(e.from))) {
                    const t0 = index.get(e.to);
                    if (t0 && t0.state !== PG_STATES.withdrawn) {
                        t0.state = PG_STATES.withdrawn;
                        t0.withdrawnBy = String(e.from);
                        changed = true;
                    }
                    continue;
                }
                if (e.state !== PG_STATES.live) continue;
                const f = index.get(e.from);
                const t = index.get(e.to);
                if (!f || !t) continue;
                if (f.state === PG_STATES.withdrawn && t.state !== PG_STATES.withdrawn) {
                    t.state = PG_STATES.withdrawn;
                    t.withdrawnBy = f.withdrawnBy || f.key;
                    changed = true;
                }
            }
        }
        for (const e of edges) {
            const f = index.get(e.from);
            const t = index.get(e.to);
            if (e.state === PG_STATES.live && ((f && f.state === PG_STATES.withdrawn) || (t && t.state === PG_STATES.withdrawn))) {
                e.state = PG_STATES.withdrawn;
            }
        }
    }

    /* ⑥ 转述链归并：走 context-compose 的**同一份**口径（同一传闻三平台转述只算一条链）。 */
    const retellFeed = nodes.filter((n) => n.platform && n.retellOf)
        .map((n) => ({ platform: n.platform, id: (n.ref && n.ref.id) || n.key, origin: n.retellOf }));
    const chainFace = retellFeed.length
        ? retellChains(retellFeed)
        : { chains: [], chainCount: 0, retoldChains: 0, unknown: 0, text: '' };

    const counts = {
        nodes: nodes.length,
        edges: edges.length,
        live: nodes.filter((n) => n.state === PG_STATES.live).length,
        withdrawn: nodes.filter((n) => n.state === PG_STATES.withdrawn).length,
        dangling: edges.filter((e) => e.state === PG_STATES.dangling).length,
        blocked: blocked.length,
        notDurable: nodes.filter((n) => n.durable !== true).length,
        derived: nodes.filter((n) => n.derived === true).length,
        gaps: gaps.length,
        chains: chainFace.chainCount,
        retoldChains: chainFace.retoldChains
    };

    const graph = {
        nodes: nodes, edges: edges,
        chains: chainFace.chains, chainText: chainFace.text,
        blocked: blocked, gaps: gaps, counts: counts, text: ''
    };
    graph.text = pgSummaryLine(graph);
    return graph;
}

/**
 * 从一个节点往上回溯它的来源链（来源 / 派生 / 引用 / 转述都算上游）。
 * 带环保护：转述链可能互相指（A 转述 B、B 又转述 A），硬跟会无限循环。
 */
export function pgChainOf(graph, key) {
    const g = (graph && typeof graph === 'object') ? graph : {};
    const nodes = Array.isArray(g.nodes) ? g.nodes : [];
    const edges = Array.isArray(g.edges) ? g.edges : [];
    const index = new Map(nodes.map((n) => [String(n.key), n]));
    const start = pgStr(key, 160);
    if (!index.has(start)) return { ok: false, why: 'no-such-node', keys: [], rows: [] };
    const rows = [];
    const seen = new Set([start]);
    let cur = start;
    let guard = 0;
    while (cur && guard < 64) {
        guard += 1;
        const up = edges.filter((e) => String(e.to) === cur);
        if (!up.length) break;
        const pick = up[0];
        const next = String(pick.from);
        if (seen.has(next)) { rows.push({ key: next, edge: pick.kind, cycle: true, state: pick.state, label: '', durable: false }); break; }
        seen.add(next);
        const n = index.get(next);
        rows.push({
            key: next, edge: pick.kind, cycle: false, state: pick.state,
            label: n ? n.label : '', durable: n ? (n.durable === true) : false
        });
        cur = next;
    }
    return { ok: rows.length > 0, why: rows.length ? '' : 'no-upstream', keys: rows.map((r) => r.key), rows: rows };
}

/**
 * 给**一行产品记录**（如一条搜索结果 / 一条通知）配上它在来源图上的面。
 * 视图只拿这个面渲染，不自己查图、不自己拼字符串（本仓「视图纯渲染」纪律）。
 *
 * 四态互不同形（这是验收①与④在界面上的落点）：
 *   · `no-graph` —— 这一轮还没取数（**不是**「这条没有来源」）；
 *   · `no-key`   —— 这条记录没有身份（连找都没法找）；
 *   · `blocked`  —— 它在图上，但被隔离（跨段 / 不可见）：**只给原因，不给内容**；
 *   · `not-in-graph` —— 图上有数、而这条不在里面（图本轮没覆盖到它，如实报）。
 * 命中时给 `line` / `chain` / `jump` 三样，视图照着排版即可。
 */
export function pgRowFace(graph, ref) {
    const missFace = (why, note) => ({ found: false, why: why, node: null, line: '', chain: null, jump: null, note: note });
    if (!graph || typeof graph !== 'object' || !Array.isArray(graph.nodes)) return missFace('no-graph', '这一轮还没取到来源图');
    const key = pgKeyOf(ref);
    if (!key || key === ':') return missFace('no-key', '这条记录没有可用的身份，认不出它从哪来');
    const node = graph.nodes.filter((n) => String(n.key) === key)[0] || null;
    if (!node) {
        const blockedList = Array.isArray(graph.blocked) ? graph.blocked : [];
        const hit = blockedList.filter((b) => String(b && b.key) === key)[0] || null;
        if (hit) return { found: false, why: 'blocked', node: null, line: '', chain: null, jump: null, note: String(hit.reason || ''), blockReason: String(hit.reason || '') };
        return missFace('not-in-graph', '这张图本轮没有覆盖到这一条');
    }
    const jump = pgJumpOf(node);
    return {
        found: true, why: '', node: node, line: pgNodeLine(node),
        chain: pgChainOf(graph, key), jump: jump, note: '', blockReason: ''
    };
}

/** 一行节点读数（视图直接渲染这一行；三态与「能不能长期定位」都要看得见）。 */
export function pgNodeLine(n) {
    const x = (n && typeof n === 'object') ? n : {};
    const meta = PG_NODE_KINDS[x.kind];
    const kindText = meta ? meta.label : String(x.kind || '?');
    const stateText = x.state === PG_STATES.withdrawn ? '已失效（源被撤回）'
        : (x.state === PG_STATES.dangling ? '悬空' : '在位');
    const refText = x.durable === true
        ? ('可定位 ' + pgKeyOf(x.ref))
        : ('不可长期定位：' + String(x.refText || x.refReason || '没有身份'));
    const derivedText = x.derived === true ? '（派生，不是原始事实）' : '';
    return kindText + '「' + String(x.label || '') + '」' + derivedText + ' · ' + stateText + ' · ' + refText;
}

/**
 * 一行总述。**三态必须不同形**：
 *   · 未取数（这一轮还没跑）→ 说读不到；
 *   · 取到了、确实空 → 说「本机还没有可展示的来源关系」；
 *   · 有节点 → 分列读数（失效 / 悬空 / 拦截 / 不可长期定位 / 转述链）。
 */
export function pgSummaryLine(graph) {
    if (!graph || typeof graph !== 'object') return '来源链：读不到（这一轮还没取数）';
    const c = (graph.counts && typeof graph.counts === 'object') ? graph.counts : {};
    const n = Number(c.nodes) || 0;
    const b = Number(c.blocked) || 0;
    const g = Number(c.gaps) || 0;
    if (!n && !b && !g) return '来源链：本机还没有可展示的来源关系';
    const parts = ['来源链：节点 ' + n];
    parts.push('边 ' + (Number(c.edges) || 0));
    if (Number(c.withdrawn)) parts.push('已失效 ' + Number(c.withdrawn));
    if (Number(c.dangling)) parts.push('悬空 ' + Number(c.dangling));
    if (b) parts.push('隔离/不可见 ' + b);
    if (Number(c.notDurable)) parts.push('不可长期定位 ' + Number(c.notDurable));
    if (Number(c.derived)) parts.push('派生 ' + Number(c.derived));
    if (Number(c.retoldChains)) parts.push('同一来源被多处转述 ' + Number(c.retoldChains) + ' 条');
    if (g) parts.push('未取到的源 ' + g);
    return parts.join(' · ') + '。';
}

/**
 * 表自检（供门禁与诊断页调用，不读磁盘）。
 * 自等自证**真 + 假两侧都跑**：只报「真的一侧成立」时，
 *   一个恒返回 `{ok:true}` 的归一口径也会让这面全绿。
 */
export function provenanceSelfCheck() {
    const problems = [];
    for (const [k, rec] of Object.entries(PG_NODE_KINDS)) {
        if (!k) problems.push('节点类型为空');
        if (!rec || typeof rec.label !== 'string' || !rec.label) problems.push(k + ' 缺 label');
        if (!rec || typeof rec.icon !== 'string' || !rec.icon) problems.push(k + ' 缺 icon');
    }
    for (const [k, rec] of Object.entries(PG_EDGE_KINDS)) {
        if (!rec || typeof rec.label !== 'string' || !rec.label) problems.push('边类型 ' + k + ' 缺 label');
    }
    if (!Object.keys(PG_STATES).length) problems.push('三态表为空');

    const good = pgRefOf({ ref: { appId: 'traveldesk', kind: 'expense', id: 'pg-probe' } }, 'trade');
    if (good.ok !== true || good.durable !== true) problems.push('自等自证：登记表里的靶心必须判「可长期定位」');
    const badId = pgRefOf({ ref: { appId: 'traveldesk', kind: 'expense', id: '' } }, 'trade');
    if (badId.ok === true) problems.push('自等自证：空 id 竟判成立 ⇒ 归一口径坏了（恒真）');
    const badScope = pgSameScope({ chatId: '' }, { chatId: '' });
    if (badScope === true) problems.push('自等自证：拿不到会话身份竟判同一段 ⇒ 隔离 fail-open');
    const nameRef = pgRefOf({ name: '甲' }, 'character');
    if (nameRef.durable === true) problems.push('自等自证：角色名竟判「可长期定位」（同名异人会串）');
    return { problems: problems };
}

export default {
    PG_NODE_KINDS, PG_EDGE_KINDS, PG_STATES,
    PG_REF_REASONS, PG_JUMP_REASONS, PG_BLOCK_REASONS,
    pgScopeOf, pgSameScope, pgKeyOf, pgRefOf, pgJumpOf,
    buildProvenanceGraph, pgChainOf, pgNodeLine, pgSummaryLine, pgRowFace,
    provenanceSelfCheck
};
