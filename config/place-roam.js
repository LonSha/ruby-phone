/* ========================================================
 * place-roam.js — [v4.05.0 · 第三期 E 包手机侧第六项 R3-X9] 地点探索与场景漫游 · 纯内核
 *
 * 【这一层解决的真缺口】
 *   apps/place 已经把「场所在哪 / 谁在这个地方 / 去过几次」摆出来了,但它是**一面镜子**:
 *   只能看,不能选。用户看完之后想做的下一件事是「那我去哪儿」——
 *   修前实测:place-data.js 的导出面里没有任何一个函数回答「从当前位置到某个地方
 *   怎么走 / 那条路上我还知道些什么 / 去了以后会碰到谁」,也没有任何「去过 / 待探索 /
 *   可进入」的分类读数,更没有任何能把选择变成一次出行提案的出口。
 *
 * 【这一层**不**做的事(与 R3-X3 的边界写死在这一行)】
 *   · 不自行移动角色:本文件**没有**任何写当前地点的函数 —— 走动只发生在正文里,
 *     本层只给提案文本,由用户交给聊天(R3-X3 的约会执行流程才知道一次出行到哪一步了)。
 *   · **不编距离与耗时**:未知路径就是未知。本文件的提案对象里**根本没有**
 *     distance / eta / minutes 这些格 —— 格不存在,也就编不出来。
 *   · 不读别人的存储键:往事与约定线索由调用方传入(`notes` 面);没给就是「本面读不到」,
 *     不假装「没有约定」(读不到 ≠ 没有,与本仓一贯口径同)。
 *
 * 【四条口径纪律】
 *   · **读不到 ≠ 去没去过**:到访史面读不到时,清单里每一行都是「未知」,
 *     绝不因为读不到就说「从没去过」(那会把等升级说成结论);
 *   · **认不出即未知,不猜**:目标不在树里 / 与当前链毫无共同段 ⇒ route=unknown,
 *     如实说「路账里没登记过」,不就近凑一个节点顶替;
 *   · **先看再从**:提案里第一条永远是「先看清楚这是哪儿」(名称 / 层级 / 去过的记录),
 *     再是路径;路径中树里查不到的含义段也如实标 known=false;
 *   · **只读**:零存储、零脚本、零事件派发,时间与随机数一律由调用方注入。
 *
 * 纯 ESM export,纯函数无 window 依赖,保证可测。
 * ======================================================== */
'use strict';
import { numOrNull } from './num-gate.js';
/** 清单四态(去过 / 待探索 / 可进入 / 未知)。四态互异,不得两态同形。 */
export const ROAM_STATES = Object.freeze({
    VISITED: 'visited',
    TO_EXPLORE: 'to-explore',
    ENTERABLE: 'enterable',
    UNKNOWN: 'unknown'
});
/** 四态文案(缺项时 UI 显示原值,不静默) */
export const ROAM_STATE_TEXT = Object.freeze({
    'visited': '去过',
    'to-explore': '待探索',
    'enterable': '可进入',
    'unknown': '未知(到访史读不到)'
});
/** 路径三态:链上直下(exact)/ 同祖换路(prefix)/ 路账里没有(unknown) */
export const ROAM_ROUTES = Object.freeze({
    EXACT: 'exact',
    PREFIX: 'prefix',
    UNKNOWN: 'unknown'
});
/** 归因文案(与各函数 reason 一一对应;缺项即 UI 显示原始 reason) */
export const ROAM_REASONS = Object.freeze({
    'ok': '这条路账本里有',
    'no-current': '还没有当前位置,算不出从哪儿出发',
    'no-nodes': '这个会话还没登记过场所',
    'target-missing': '没说要往哪儿去',
    'place-unknown': '路账里没有登记过这个地方',
    'same-place': '已经在这条链上了',
    'no-history-face': '到访史这版读不到(不等于没去过)',
    'no-presence': '没有登记在场的人',
    'no-presence-face': '在场面这版读不到(不等于这里没人)',
    'no-notes-face': '这版读不到本面(等约定面接入,不等于没有)'
});
/** 上限(冻结;防单条无界与长列表) */
export const ROAM_LIMITS = Object.freeze({
    nodes: 400,
    steps: 8,
    clues: 6,
    presence: 8,
    line: 120
});
/* ==================== 局部工具(一律本地强口径) ==================== */
function keyOf(v) {
    const s = String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
    return s.slice(0, 160);
}
function textOf(v, max = ROAM_LIMITS.line) {
    const s = String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
    return s.length > max ? s.slice(0, max) + '...' : s;
}
/** 路径段(键按 / 切;空段丢弃,不补位) */
function segsOf(key) {
    return keyOf(key).split('/').map((s) => s.trim()).filter(Boolean);
}
/** 父键(无父则空串,不编一个根) */
function parentOf(key) {
    const s = segsOf(key);
    return s.length > 1 ? s.slice(0, -1).join('/') : '';
}
/** 末段(显示名同段时用它兜) */
function lastSeg(key) {
    const s = segsOf(key);
    return s.length ? s[s.length - 1] : '';
}
/** 深度:上游没给就按段数算(不算第 0 层);给了一律用上游的 */
function depthOf(node) {
    const d = numOrNull(node.depth);
    if (d !== null) return Math.max(1, Math.min(d, 4));
    return Math.max(1, Math.min(segsOf(node.key).length, 4));
}
/**
 * 归一输入面。未给出的面**显式报「没这面」**,不用空数组顶替 ——
 * 这是本层唯一的口径入口:`visits === null` 与 `visits === []` 意思相反。
 *
 * @param {{tree?:Array, nodes?:Array, visits?:Array, hasVisitFace?:boolean,
 *          presence?:Array, notes?:Array, currentChain?:Array}} raw
 */
export function normalizeRoamInputs(raw = {}) {
    const o = raw && typeof raw === 'object' ? raw : {};
    const treeRaw = Array.isArray(o.tree) ? o.tree : (Array.isArray(o.nodes) ? o.nodes : []);
    const nodes = [];
    const seen = new Set();
    for (const n of treeRaw) {
        if (!n || typeof n !== 'object') continue;
        const key = keyOf(n.key || n.name);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        nodes.push({
            key,
            name: textOf(n.name || lastSeg(key), 60),
            desc: textOf(n.desc, 200),
            depth: depthOf({ key, depth: n.depth }),
            floor: numOrNull(n.floor),
            visited: n.visited === true,
            visits: numOrNull(n.visits) ?? 0
        });
        if (nodes.length >= ROAM_LIMITS.nodes) break;
    }
    // 到访史面:数组才算有面;显式 hasVisitFace 优先(调用方知道得更准)
    const hasVisitFace = typeof o.hasVisitFace === 'boolean' ? o.hasVisitFace : Array.isArray(o.visits);
    const visits = [];
    if (Array.isArray(o.visits)) {
        for (const v of o.visits) {
            if (!v || typeof v !== 'object') continue;
            const key = keyOf(v.key || (Array.isArray(v.path) ? v.path.join('/') : ''));
            if (!key) continue;
            visits.push({
                key,
                count: numOrNull(v.count),
                firstFloor: numOrNull(v.firstFloor),
                lastFloor: numOrNull(v.lastFloor),
                registered: v.registered !== false
            });
        }
    }
    const hasPresenceFace = Array.isArray(o.presence);
    const presence = [];
    if (hasPresenceFace) {
        for (const g of o.presence) {
            if (!g || typeof g !== 'object') continue;
            const key = keyOf(g.key);
            const members = Array.isArray(g.members) ? g.members.map((m) => textOf(m, 40)).filter(Boolean) : [];
            if (!key || !members.length) continue;
            presence.push({ key, members, atFloor: numOrNull(g.atFloor) });
        }
    }
    const hasNotesFace = Array.isArray(o.notes);
    const notes = [];
    if (hasNotesFace) {
        for (const n of o.notes) {
            if (!n || typeof n !== 'object') continue;
            const text = textOf(n.text || n.content || n.title, 160);
            if (!text) continue;
            notes.push({
                kind: keyOf(n.kind || n.type || 'note') || 'note',
                text,
                place: keyOf(n.place),
                dateKey: keyOf(n.dateKey),
                atFloor: numOrNull(n.atFloor)
            });
        }
    }
    const chainRaw = Array.isArray(o.currentChain) ? o.currentChain : [];
    const currentChain = chainRaw.map((s) => textOf(s, 60)).filter(Boolean);
    return {
        nodes, visits, hasVisitFace, presence, hasPresenceFace,
        notes, hasNotesFace, currentChain
    };
}
/**
 * 当前链 → 树节点键。逐段按「键相等 / 名相等 / 末段相等」匹配,
 * 匹配不到就**停在那里**(后面的段一律不再推) —— 后半段仍列出,但 known=false。
 * @returns {{keys:string[], known:boolean[], nodes:Array}}
 */
export function resolveCurrentChain(nodes, currentChain) {
    const list = Array.isArray(nodes) ? nodes : [];
    const keys = [];
    const known = [];
    const hit = [];
    for (const seg of (Array.isArray(currentChain) ? currentChain : [])) {
        const node = list.find((n) => n.key === seg)
            || list.find((n) => n.name === seg)
            || list.find((n) => lastSeg(n.key) === seg);
        if (!node) { keys.push(seg); known.push(false); hit.push(null); continue; }
        keys.push(node.key);
        known.push(true);
        hit.push(node);
    }
    return { keys, known, nodes: hit };
}
/**
 * 清单态。证据优先级写死在这里(顺序即口径,换顺序就是换结论):
 *   1 **树面自带「去过」**(上游在节点上标了)⇒ 去过 —— 这是直接证据,不因别的面读不到而作废;
 *   2 **到访史面在,且记着去过**(count > 0)⇒ 去过 —— 第二份证据;
 *   3 **到访史面读不到** ⇒ 未知 —— 读不到不是「没去过」(那会把等升级说成结论);
 *   4 父在链上 ⇒ 可进入;其余 ⇒ 待探索。
 * 前三步的顺序不是顺手写的:1 与 2 是「有证据」,3 是「没证据」,有证据永远压过没证据。
 */
export function roamStateOf(node, o = {}) {
    if (o.visited === true) return ROAM_STATES.VISITED;
    if (o.hasVisitFace === true && (numOrNull(o.visits) ?? 0) > 0) return ROAM_STATES.VISITED;
    if (o.hasVisitFace !== true) return ROAM_STATES.UNKNOWN;
    if (o.enterable === true) return ROAM_STATES.ENTERABLE;
    return ROAM_STATES.TO_EXPLORE;
}
/* ==================== 清单:去过 / 待探索 / 可进入 / 未知 ==================== */
/**
 * 探索清单。每个节点一行,态由 roamStateOf 钉住(四态互异)。
 * 排序**分组固定**:去过 → 可进入 → 待探索 → 未知;组内保持树序(不再排,避免把别人的顺序改掉)。
 * 到访史里登记了但树里没有的键(registered=false)另起一组拼在末尾,标 orphan=true ——
 * 那是真缺陷(去过但树里没这个节点),不能因为「树里没有」就把它藏起来。
 *
 * @returns {{ok:boolean, state:string, reason:string, items:Array, readings:object}}
 */
export function exploreList(raw = {}) {
    const inp = normalizeRoamInputs(raw);
    const cur = resolveCurrentChain(inp.nodes, inp.currentChain);
    const knownChainKeys = new Set();
    let currentKey = '';
    for (let i = 0; i < cur.keys.length; i++) {
        if (cur.known[i] === true) { knownChainKeys.add(cur.keys[i]); currentKey = cur.keys[i]; }
    }
    const visitByKey = new Map();
    for (const v of inp.visits) visitByKey.set(v.key, v);
    const rows = [];
    const seenKey = new Set();
    for (const n of inp.nodes) {
        seenKey.add(n.key);
        const v = visitByKey.get(n.key) || null;
        const parent = parentOf(n.key);
        const state = roamStateOf(n, {
            visited: n.visited,
            visits: v ? v.count : n.visits,
            hasVisitFace: inp.hasVisitFace,
            enterable: !!parent && knownChainKeys.has(parent)
        });
        rows.push({
            key: n.key, name: n.name, desc: n.desc, depth: n.depth, floor: n.floor,
            state, stateText: ROAM_STATE_TEXT[state] || state, orphan: false,
            visits: v ? v.count : (n.visits || null),
            lastFloor: v ? v.lastFloor : null,
            firstFloor: v ? v.firstFloor : null,
            registered: v ? v.registered : true,
            isCurrent: n.key === currentKey
        });
    }
    let orphan = 0;
    for (const v of inp.visits) {
        if (seenKey.has(v.key)) continue;
        orphan++;
        rows.push({
            key: v.key, name: v.key.split('/').filter(Boolean).pop() || v.key, desc: '',
            depth: Math.max(1, Math.min(v.key.split('/').filter(Boolean).length, 4)), floor: null,
            state: ROAM_STATES.VISITED, stateText: ROAM_STATE_TEXT[ROAM_STATES.VISITED], orphan: true,
            visits: v.count, lastFloor: v.lastFloor, firstFloor: v.firstFloor,
            registered: v.registered, isCurrent: false
        });
    }
    const order = {};
    order[ROAM_STATES.VISITED] = 0;
    order[ROAM_STATES.ENTERABLE] = 1;
    order[ROAM_STATES.TO_EXPLORE] = 2;
    order[ROAM_STATES.UNKNOWN] = 3;
    const items = rows
        .map((r, i) => ({ r, i }))
        .sort((a, b) => (order[a.r.state] - order[b.r.state]) || (a.i - b.i))
        .map((x) => x.r);
    const count = (s) => items.filter((x) => x.state === s).length;
    const readings = {
        nodes: inp.nodes.length,
        rows: items.length,
        visited: count(ROAM_STATES.VISITED),
        enterable: count(ROAM_STATES.ENTERABLE),
        toExplore: count(ROAM_STATES.TO_EXPLORE),
        unknown: count(ROAM_STATES.UNKNOWN),
        orphan,
        currentKey,
        hasVisitFace: inp.hasVisitFace
    };
    let reason = 'ok';
    let state = 'ready';
    if (!inp.nodes.length && !inp.visits.length) { reason = 'no-nodes'; state = 'empty'; }
    return { ok: !!items.length, state, reason, items, readings };
}
/**
 * 路径:从当前链到目标。三态:exact(就在当前链上往下)/ prefix(同祖换路)/ unknown(路账里没登记接法)。
 * **没有任何距离 / 耗时格** —— 未知就是未知,不是零,也不是估算。
 * 目标认不出 ⇒ ok=false(reason 说明);认得出但算不出接法 ⇒ ok=true + route=unknown(照给拓扑)。
 */
export function buildRouteFrom(inp, target = null) {
    const list = Array.isArray(inp?.nodes) ? inp.nodes : [];
    const want = textOf(typeof target === 'string' ? target : (target && (target.key || target.name)) || '', 160);
    const base = {
        ok: false, reason: 'target-missing', route: ROAM_ROUTES.UNKNOWN,
        from: [], to: [], common: 0, steps: [], place: null, heads: [], unknownHeads: 0
    };
    if (!want) return base;
    const wantSegs = segsOf(want);
    const node = list.find((n) => n.key === want)
        || list.find((n) => n.name === want)
        || list.find((n) => lastSeg(n.key) === want)
        || list.find((n) => segsOf(n.key).join('/') === wantSegs.join('/'));
    if (!node) return { ...base, reason: 'place-unknown' };
    const cur = resolveCurrentChain(list, inp.currentChain);
    let currentKey = '';
    for (let i = 0; i < cur.keys.length; i++) if (cur.known[i] === true) currentKey = cur.keys[i];
    const from = segsOf(currentKey);
    const to = segsOf(node.key);
    let common = 0;
    while (common < from.length && common < to.length && from[common] === to[common]) common++;
    const place = {
        key: node.key, name: node.name || lastSeg(node.key), desc: node.desc,
        depth: node.depth, floor: node.floor, visited: node.visited === true, visits: node.visits
    };
    const out = {
        ...base, ok: true, reason: 'ok', place,
        from: from.slice(), to: to.slice(), common,
        /* 路账里的层级串(每行一段),与「走法」的行面同源:
         *   共同段(含当前所在)+ 目标的后半段;共同段之后的每一步都不发明层级。 */
        top: node.key,
        keys: from.slice(0, common).concat(to.slice(common))
    };
    if (!from.length) return { ...out, reason: 'no-current', route: ROAM_ROUTES.UNKNOWN };
    if (from.join('/') === to.join('/')) {
        return { ...out, reason: 'same-place', route: ROAM_ROUTES.EXACT, steps: [] };
    }
    // 拓扑:从共同祖先的下一段起,逐段往下(每一步都标明这一段树里认不认得)
    const steps = [];
    for (let i = common; i < to.length && steps.length < ROAM_LIMITS.steps; i++) {
        const key = to.slice(0, i + 1).join('/');
        const hit = list.find((n) => n.key === key) || list.find((n) => lastSeg(n.key) === to[i]) || null;
        steps.push({
            key, parent: to.slice(0, i).join('/'), segment: to[i],
            name: hit ? hit.name : to[i], known: !!hit, floor: hit ? hit.floor : null
        });
    }
    const unknownHeads = steps.filter((s) => !s.known).length;
    out.steps = steps;
    out.unknownHeads = unknownHeads;
    if (common === 0) return { ...out, reason: 'ok', route: ROAM_ROUTES.UNKNOWN };
    if (common >= from.length) return { ...out, route: ROAM_ROUTES.EXACT };
    return { ...out, route: ROAM_ROUTES.PREFIX };
}
/** buildRoute 的入参未归一版(自己归一一次);已归一的对象再归一一次是稳定的 */
export function buildRoute(raw = {}, target = null) {
    return buildRouteFrom(normalizeRoamInputs(raw), target);
}
/* ==================== 条目「先看再从」与两行提案 ==================== */
/** 在场:这个地点(含其子路)上此刻登记着谁 */
export function presenceAt(inp, key) {
    const want = segsOf(key);
    const hit = [];
    for (const g of (Array.isArray(inp?.presence) ? inp.presence : [])) {
        const segs = segsOf(g.key);
        if (!segs.length || !want.length) continue;
        const isSelf = segs.join('/') === want.join('/');
        const isUnder = segs.length > want.length && segs.slice(0, want.length).join('/') === want.join('/');
        if (isSelf || isUnder) hit.push({ ...g, under: isUnder });
    }
    return hit.slice(0, ROAM_LIMITS.presence);
}
/** 往事与约定:只按地点匹配(没注地点的条不归到任何地点头上) */
export function notesAt(inp, key) {
    const want = segsOf(key);
    const out = [];
    for (const n of (Array.isArray(inp?.notes) ? inp.notes : [])) {
        if (!n.place) continue;
        const segs = segsOf(n.place);
        const isSelf = segs.join('/') === want.join('/');
        const isUnder = segs.length > want.length && segs.slice(0, want.length).join('/') === want.join('/');
        if (!isSelf && !isUnder) continue;
        out.push({ ...n, under: isUnder });
    }
    return out.slice(0, ROAM_LIMITS.clues);
}
/**
 * 地点卡线索:先看清这是哪儿,再报怎么去;路上与到了才知道的事排在后面。
 * 三面(在场 / 往事 / 约定)各归各的归因 —— 读不到就是读不到,不假装「没有」。
 *
 * @param {object} raw 未归一输入面(含 nodes/visits/presence/notes/currentChain)
 * @param {string|object} target 目标地点(键或名)
 * @returns {{ok:boolean, reason:string, route:string, place:object|null,
 *            lines:string[], present:Array, notes:Array, counts:object}}
 */
export function roamClues(raw = {}, target = null) {
    const inp = normalizeRoamInputs(raw);
    const rt = buildRouteFrom(inp, target);
    const out = {
        ok: false, reason: rt.reason, route: rt.route, place: rt.place,
        lines: [], present: [], notes: [], counts: { present: 0, notes: 0, steps: 0, unknown: 0 }
    };
    if (!rt.ok || !rt.place) return out;
    const place = rt.place;
    const lines = [];
    const depth = (place.depth === null || place.depth === undefined) ? '—' : String(place.depth);
    const times = numOrNull(place.visits);
    const seen = place.visited === true
        ? ((times !== null && times > 1) ? '去过 ' + times + ' 次' : '去过')
        : ((times !== null && times > 0) ? '去过 ' + times + ' 次' : '没去过记录');
    lines.push('这是「' + place.name + '」(第 ' + depth + ' 层 · ' + seen + ')'
        + (place.desc ? '·' + place.desc : ''));
    // 在场:三态各自归因(没这面 / 有面没人 / 有人)——「此刻这里」只出现一次,不叠字
    const present = presenceAt(inp, place.key);
    if (!inp.hasPresenceFace) {
        lines.push('此刻这里:' + ROAM_REASONS['no-presence-face']);
    } else if (!present.length) {
        lines.push('此刻这里' + ROAM_REASONS['no-presence']);
    } else {
        for (const g of present) {
            lines.push('到了可能碰到' + (g.under ? '(' + g.key + ')' : '') + ':' + g.members.join('、'));
        }
    }
    resumeStepLine(lines, rt);
    clueLines(lines, inp, place.key);
    out.present = present;
    out.notes = notesAt(inp, place.key);
    out.lines = lines.slice(0, ROAM_LIMITS.steps + ROAM_LIMITS.clues + 4);
    out.ok = true;
    out.counts.present = present.length;
    out.counts.notes = out.notes.length;
    out.counts.steps = Array.isArray(rt.steps) ? rt.steps.length : 0;
    out.counts.unknown = ROAM_LIMITS.steps; // 占位,下面立刻覆盖
    out.counts.unknown = (rt.unknownHeads || 0);
    return out;
}
/**
 * 「怎么去」的一段。三种处境各自的字样:
 *   same-place ⇒ 已经在;no-current ⇒ 算不出从哪儿出发;否则给拓扑(含未知段如实标)。
 * 这一段**只描述路账里登记过的层级关系**,没有距离也没有耗时。
 */
function resumeStepLine(lines, rt) {
    if (rt.reason === 'same-place') { lines.push('你已经在这儿了(' + ROAM_REASONS['same-place'] + ')'); return; }
    if (rt.reason === 'no-current') { lines.push('去这儿的走法:' + ROAM_REASONS['no-current']); return; }
    const commonKey = Array.isArray(rt.keys) && rt.common > 0 ? rt.keys[rt.common - 1] : '';
    const head = rt.route === ROAM_ROUTES.EXACT ? '从当前位置往下一路走'
        : (rt.route === ROAM_ROUTES.PREFIX
            ? '从当前位置退回「' + (commonKey || '共同的那一段') + '」再换一条路'
            : '走法:路账里没登记过这两处怎么接上(只给拓扑,不编路线)');
    lines.push(head);
    for (const s of (Array.isArray(rt.steps) ? rt.steps : [])) {
        lines.push('  · ' + s.segment + (s.known ? '' : ' (树里没有这一段,未知)'));
    }
}
/** 往事与约定:读不到就说读不到;读到了逐条列出(带日期与楼层) */
function clueLines(lines, inp, key) {
    if (!inp.hasNotesFace) { lines.push('往事与约定:' + ROAM_REASONS['no-notes-face']); return; }
    const notes = notesAt(inp, key);
    if (!notes.length) { lines.push('往事与约定:本账里这处还没有记下过的往事或约定'); return; }
    for (const n of notes) {
        const tail = [];
        if (n.dateKey) tail.push(n.dateKey);
        if (n.atFloor !== null) tail.push('第' + n.atFloor + '楼');
        lines.push('往:[' + n.kind + '] ' + n.text + (tail.length ? '(' + tail.join(' · ') + ')' : ''));
    }
}
/** 开关三态文案(起草动作的读数面) */
export const ROAM_REGISTERS_TEXT = Object.freeze({
    'register': '记住登记',
    'unknown': '不知道(改过由正文说了算)',
    'unregistered': '还没登记(点一下记住)'
});
export function registerStateOf(face) {
    const st = face && typeof face === 'object' ? face : {};
    const known = Array.isArray(st.known) ? st.known.map((k) => textOf(k, 60)).filter(Boolean) : [];
    const unknown = Array.isArray(st.unknown) ? st.unknown.map((k) => textOf(k, 60)).filter(Boolean) : [];
    const out = {};
    for (const k of known) out[k] = 'register';
    for (const k of unknown) out[k] = 'unknown';
    return out;
}
export function registerLine(face) {
    const st = registerStateOf(face);
    const ks = Object.keys(st);
    if (!ks.length) return '还没记下任何名字:和谁一起走,回来点一下「记住」';
    return ks.map((k) => k + ':' + (ROAM_REGISTERS_TEXT[st[k]] || st[k])).join(' · ');
}
/**
 * 出行提案。**这是本层对外的唯一出口**,也是「不自行移动角色」的落地处:
 * 它产出的是一段**给人(与给聊天)看的话**,不是一次移动 ——
 * 本函数零存储、零事件、零副作用,点不点、去不去都由用户与正文决定。
 *
 * 三行结构固定:去哪儿 / 已知什么(线索卡)/ 记住什么(开关)。
 * 路径未知就直接说未知(由线索卡第一段给出),**不编距离与耗时** ——
 * 本对象里没有 distance / eta / minutes 这些格。
 *
 * @returns {{ok:boolean, reason:string, text:string, place:object|null, route:string,
 *            lines:string[], registerLine:string, counts:object}}
 */
export function buildTravelProposal(raw = {}, target = null) {
    const clues = roamClues(raw, target);
    if (!clues.ok) {
        return {
            ok: false, reason: clues.reason, text: '', place: null,
            route: clues.route, lines: [], registerLine: '', counts: clues.counts
        };
    }
    const place = clues.place || {};
    const head = '打算去「' + place.name + '」'
        + (clues.route === ROAM_ROUTES.UNKNOWN ? '(路账里没登记过怎么走,算不出路线)' : '(路账里有,按拓扑走)');
    const tail = '到这里只是提案:要去的话把这段话交给聊天,走不走由正文说了算(本机不替你把角色挪过去)。';
    const text = [head].concat(clues.lines, [tail]).join('\n');
    return {
        ok: true, reason: 'ok', text, place, route: clues.route,
        lines: clues.lines, registerLine: registerLine(raw?.register || null),
        counts: clues.counts
    };
}
/** 自检:四态与三路由与四归因各在同域里,以及「没有距离格」这条硬口径 */
export function roamSelfCheck() {
    const problems = [];
    const states = Object.keys(ROAM_STATE_TEXT);
    for (const s of Object.values(ROAM_STATES)) if (!states.includes(s)) problems.push('state-text-missing:' + s);
    const texts = new Set(Object.values(ROAM_STATE_TEXT));
    if (texts.size !== states.length) problems.push('state-text-collapsed');
    const routes = new Set(Object.values(ROAM_ROUTES));
    if (routes.size !== 3) problems.push('route-collapsed');
    if (!Object.isFrozen(ROAM_LIMITS)) problems.push('limits-not-frozen');
    if (typeof ROAM_LIMITS.steps !== 'number' || ROAM_LIMITS.steps < 1) problems.push('limits-steps');
    /* 「没有距离 / 耗时格」这条硬口径的查法有三条不许踩的坑(本版实测踩过):
     *   1 判据不许把词写在自己的字面量里(自我指涉 ⇒ 永远报错),故用字符码拼词;
     *   2 不许扫自检自己(它本来就在查这个词),只扫对外的两个出口;
     *   3 不许把注释算进代码(注释里为说清口径必然提到这些词)⇒ 先去注释。
     *   扫的是**出口函数的源码**,不是内部工具 —— 工具里出现这些词不算出口有格。 */
    const strip = (s) => String(s).replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/.*$/gm, ' ');
    const bads = [[100, 105, 115, 116, 97, 110, 99, 101], [101, 116, 97], [109, 105, 110, 117, 116, 101, 115], [100, 117, 114, 97, 116, 105, 111, 110]]
        .map((codes) => String.fromCharCode(...codes));
    const scanned = strip(buildTravelProposal.toString()) + strip(roamClues.toString());
    for (const bad of bads) {
        if (scanned.indexOf(bad) !== -1) problems.push('distance-like-key:' + bad);
    }
    /* 出口对象真的**没有**这些格,才算这条过:构造一次再看键(源码扫只是补一道,
     *   真正的判据是对象里没有格 —— 两条一起才算数)。 */
    const probe = buildTravelProposal({
        tree: [{ key: 'a', name: 'A' }], currentChain: ['A'],
        visits: [], presence: [], notes: []
    }, 'A');
    for (const bad of bads) {
        if (Object.prototype.hasOwnProperty.call(probe, bad)) problems.push('distance-like-field:' + bad);
        if (probe.place && Object.prototype.hasOwnProperty.call(probe.place, bad)) problems.push('distance-like-field:place.' + bad);
    }
    return { ok: problems.length === 0, problems };
}