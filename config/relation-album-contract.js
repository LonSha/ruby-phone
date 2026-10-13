/* ============================================================
 * config/relation-album-contract.js — [第三期 R3-X5] 人物关系回忆册的
 *   消费侧单一真源(上游 **relationHistory** 面 + 本仓事件面)
 * ------------------------------------------------------------
 *
 * 【计划原文 R3-X5】
 *   「按双方身份建立共同经历册:初识、争执、和解、礼物、约定等由真实事件聚合;\n *    允许选素材编纪念页,附出处与关系转折而非只报好感数。」\n *   验收四条:切换人物对能看到各自往事;同名不混;撤回事件不再生成纪念页;\n *    「共同经历」与单方听说分开。
 *
 * 【修前实测的缺口(不是推演)】
 *   本仓 config/contact-insight.js 只答「谁最近聊过、谁沉了多久」(次数与时间类读数);\n *   config/relation-tier.js 只答「这对人现在算哪一级」(一个离散刻度);\n *   apps/timeweaver 能织信与收藏。三者合起来仍答不了计划点名的这一问:
 *   **这对人之间发生过什么、是怎么变成现在这样的**。
 *   上游在 v3.323.0(M3-X2)交付了 relationHistory 面——它答的正是
 *   「这对人的关系随时间怎么变的、每次转折凭什么」,\n *   而本仓**零消费**(未消费理由台账里写的就是这一条:
 *   「R3-X5 尚未开工故 relationHistory 没接」)。本模块把它接上,
 *   并把本仓自己的事件面与其合成一本「回忆册」。
 *
 * 【本模块只做四件事(而不重算任何上游口径)】
 *   1 **双方身份键**：优先用 id(同名异人不混);只有名字时退化并**如实标 byName**;
 *   2 **事件归属分三份**：双方都在场(共同经历)/ 只有一方(单方经历)/
 *      只有听说(未在场)—— 三份**不得合并**(验收第四条原文);
 *   3 **转折从上游读**：转折点直接用上游 relationHistory 的产物,
 *      **不在这里重算一份**—— 重算就是第二套关系轨迹口径;
 *   4 **撤回即不再生成**：已撤回的事件不进纪念页，且不参与转折。
 *
 * 【五态(本仓最贵的老账：缺席与空必须不同形)】
 *   · 插件不在场                   ⇒ engine-absent(等装插件)
 *   · 插件在场但无该面(旧版)     ⇒ face-absent(等上游升级)
 *   · 出口在但调用抛错 / 读不出          ⇒ unusable(本机读不出)
 *   · 读到了、真的没有转折             ⇒ empty(**真读数**)
 *   · 有转折                         ⇒ ok
 *   压平任何两态都会把「还没装插件」显示成「你们没什么可回忆的」。
 *
 * 【边界(如实登记,不装)】
 *   · 本模块**不读存储、不写状态、不派事件**；两份输入(上游读数 + 本仓事件列)
 *     都由调用方嗂入。
 *   · 「允许选素材编纪念页」这一条本模块只产出**选材列表**,
 *     编排与渲染在视图层；本模块不知道 UI 长什么样。
 *   · 「附出处」指的是**楼层 / 事件 id**,不是一句文字描述；
 *     没有出处的条目不进纪念页(无出处的「共同回忆」与编造无异)。
 * ============================================================ */
import { numOrNull } from './num-gate.js';

'use strict';

/** 上游插件全局名(与其它契约模块读的是同一个) */
const LONSHA_PLUGIN_GLOBAL = 'LonShaMemory';

/** 上游 relationHistory 面的五态(本模块自己的归因) */
export const RELATION_ALBUM_STATES = Object.freeze({
    ENGINE_ABSENT: 'engine-absent',
    FACE_ABSENT: 'face-absent',
    UNUSABLE: 'unusable',
    EMPTY: 'empty',
    OK: 'ok'
});

/** 三份归属(不得合并：共同经历 / 单方经历 / 单方听说) */
export const ALBUM_SCOPES = Object.freeze({
    SHARED: 'shared',       /* 双方都在场 */
    ONESIDED: 'onesided',   /* 只有一方在场 */
    HEARSAY: 'hearsay'      /* 只有听说，本人未在场 */
});

/** 三份各自的人读字样(两份同形即失败) */
export const ALBUM_SCOPE_TEXT = Object.freeze({
    shared: '双方都在场',
    onesided: '只有一方在场',
    hearsay: '本人未在场(听说)'
});

/** 七类纪念页素材(对齐计划原文点名的初识 / 争执 / 和解 / 礼物 / 约定)。 */
export const ALBUM_KINDS = Object.freeze({
    firstMeet: { id: 'firstMeet', label: '初识' },
    quarrel: { id: 'quarrel', label: '争执' },
    reconcile: { id: 'reconcile', label: '和解' },
    gift: { id: 'gift', label: '礼物' },
    promise: { id: 'promise', label: '约定' },
    trip: { id: 'trip', label: '同行' },
    other: { id: 'other', label: '其他' }
});

/** 六个归因词(两个同形即失败) */
export const RELATION_ALBUM_REASONS = Object.freeze({
    ok: '转折读数可用',
    'no-subject': '没给要看的人',
    'engine-absent': '记忆插件未装或未加载(等装插件)',
    'face-absent': '插件在场但无关系变化读面(等上游升级)',
    unusable: '出口在但读不出(本机读不出,不是你们没什么可回忆的)',
    empty: '读到了、真的没有转折'
});

/** 上限(冻结) */
export const ALBUM_LIMITS = Object.freeze({
    entries: 40,        /* 单本纪念册条目上限 */
    turns: 12,          /* 单对人物转折点上限 */
    label: 24           /* 人物标签截断长度 */
});

function str(v) { return String(v == null ? '' : v).trim(); }

/** 宿主窗口(注入优先,回落全局) */
function resolveWin(win) {
    if (win && typeof win === 'object') return win;
    try { return (typeof globalThis !== 'undefined' && globalThis) ? globalThis : null; }
    catch (_e) { return null; }
}

/** 对侧身份键:优先 id,只有名字时退化并如实标 byName。 */
function identityOf(obj, keys) {
    for (const k of keys) {
        const v = str(obj && obj[k]);
        if (v) return { id: v, byName: k === 'name' };
    }
    return null;
}

/**
 * 读上游 relationHistory 面(只读、不重算、不抛)。
 * @returns {{state, reason, pairs, line, raw}}
 */
export function readRelationHistory(win, opts = {}) {
    const w = resolveWin(win);
    const plugin = w ? (w[LONSHA_PLUGIN_GLOBAL] || null) : null;
    const base = { state: RELATION_ALBUM_STATES.ENGINE_ABSENT, reason: 'engine-absent', pairs: [], line: '', raw: null };
    if (!plugin) return base;
    const engine = plugin.engine || plugin.memoryEngine || null;
    if (!engine || typeof engine.relationHistory !== 'function') {
        return { state: RELATION_ALBUM_STATES.FACE_ABSENT, reason: 'face-absent', pairs: [], line: '', raw: null };
    }
    let got = null;
    try { got = engine.relationHistory(opts || {}); }
    catch (_e) {
        return { state: RELATION_ALBUM_STATES.UNUSABLE, reason: 'unusable', pairs: [], line: '', raw: null };
    }
    /* 面形态:必须是对象且带 kind。形态不对与「没有转折」不同形。 */
    if (!got || typeof got !== 'object' || got.kind !== 'relation_history') {
        return { state: RELATION_ALBUM_STATES.UNUSABLE, reason: 'unusable', pairs: [], line: '', raw: null };
    }
    /* version === 0 = 「这一面不在场」(上游常恒键面写法)。 */
    if (Number(got.version) === 0) {
        return { state: RELATION_ALBUM_STATES.FACE_ABSENT, reason: 'face-absent', pairs: [], line: '', raw: null };
    }
    const pairs = Array.isArray(got.pairs) ? got.pairs : [];
    let line = '';
    try { if (typeof engine._relationHistoryLine === 'function') line = str(engine._relationHistoryLine()); }
    catch (_e) { line = ''; }
    return {
        state: pairs.length ? RELATION_ALBUM_STATES.OK : RELATION_ALBUM_STATES.EMPTY,
        reason: pairs.length ? 'ok' : 'empty',
        pairs: pairs, line: line, raw: got
    };
}

/**
 * 把一条事件归成三份之一(**不得合并**)。
 *   · 双方都在场(两侧都在 present 里)⇒ shared;
 *   · 只有一方在场⇒ onesided;
 *   · 本人不在场、只有听说⇒ hearsay。
 * 读不到 present(不是数组)⇒ 如实标 hearsay(没有证据说人在场;不抬成共同经历)。
 */
export function scopeOfEvent(ev, pair) {
    const present = Array.isArray(ev && ev.present) ? ev.present.map(str).filter(Boolean) : null;
    const a = str(pair && pair.a), b = str(pair && pair.b);
    if (!present) return ALBUM_SCOPES.HEARSAY;
    const hasA = present.includes(a) || present.includes(str(pair && pair.aId));
    const hasB = present.includes(b) || present.includes(str(pair && pair.bId));
    if (hasA && hasB) return ALBUM_SCOPES.SHARED;
    if (hasA || hasB) return ALBUM_SCOPES.ONESIDED;
    return ALBUM_SCOPES.HEARSAY;
}

/** 标签截断(超限即截,并如实标记)。 */
function clip(s, n) {
    const t = str(s);
    return t.length > n ? (t.slice(0, n) + '…') : t;
}

/**
 * 编一本回忆册(R3-X5 主出口)。
 *
 * @param {object} input
 *   · subject   { id?, name }         —— 要看的人(最终读者看的是 ta 与各人的纪念册)
 *   · events    [{ id?, kind?, label?, floor?, at?, present?, revoked?, with? }]
 *   · upstream  readRelationHistory() 的返回(不给则不接轨迹)
 * @param {object} [opts] { entries, turns }
 * @returns 恒定键面的读数(永不抛)
 */
export function buildRelationAlbum(input = {}, opts = {}) {
    const LIM = ALBUM_LIMITS;
    const maxEntries = Math.max(1, Math.min(200, Number(opts.entries) || LIM.entries));
    const maxTurns = Math.max(1, Math.min(60, Number(opts.turns) || LIM.turns));
    const subject = input.subject || null;
    const subjId = str(subject && (subject.id || subject.name));
    const base = {
        state: RELATION_ALBUM_STATES.EMPTY, reason: 'no-subject',
        subject: { id: subjId, name: str(subject && subject.name) },
        albums: [], counts: { pairs: 0, entries: 0, shared: 0, onesided: 0, hearsay: 0, revoked: 0, dropped: 0, byName: 0 },
        turnsFace: false, line: '', truncated: 0, degraded: false
    };
    if (!subjId) return base;

    const events = Array.isArray(input.events) ? input.events : [];
    /* 撤回的事件**不进纪念页**，也不参与转折(验收第三条)。 */
    const live = [];
    let revoked = 0;
    for (const ev of events) {
        if (!ev || typeof ev !== 'object') continue;
        if (ev.revoked === true) { revoked += 1; continue; }
        live.push(ev);
    }

    /* 上游转折:直接用它的产物,不重算一份。 */
    const up = (input.upstream && typeof input.upstream === 'object') ? input.upstream : null;
    const upPairs = (up && Array.isArray(up.pairs)) ? up.pairs : [];
    base.turnsFace = !!(up && up.state === RELATION_ALBUM_STATES.OK);
    base.line = str(up && up.line);

    /* 按对方身份分桶:优先 id,退化到名字时如实计 byName。 */
    const buckets = new Map();
    const bucketOf = (peer) => {
        const key = peer.id || peer.name;
        if (!buckets.has(key)) buckets.set(key, { peer: peer, entries: [] });
        return buckets.get(key);
    };
    const selfKeys = new Set([subjId]);
    for (const ev of live) {
        const present = Array.isArray(ev.present) ? ev.present.map(str).filter(Boolean) : [];
        /* 事件必须有**出处**(楼层或 id):无出处的「共同回忆」与编造无异。 */
        /* 取数走仓内唯一实现(config/num-gate.js):就地再写一份弱口径就是第二套取数口径(第十道门 W1 正是那么针的)。 */
            const floor = numOrNull(ev.floor);
        const evId = str(ev.id);
        if (floor === null && !evId) { base.counts.dropped += 1; continue; }
        if (ev.with != null) {
            const w = ev.with;
            const ws = (w && typeof w === 'object') ? w : { name: str(w) };
            const peer = identityOf(ws, ['id', 'name']);
            if (!peer) { base.counts.dropped += 1; continue; }
            if (peer.id === subjId) { base.counts.dropped += 1; continue; }
            const b = bucketOf(peer);
            b.entries.push({ ev: ev, floor: floor, evId: evId });
            continue;
        }
        /* 未给 with:从 present 里取**除主体外**的人作为对方。
         *   多人场合(三人以上)会同时落多个桶 —— 那是对的:同一场同行对每一对人都算共同经历。 */
        const peers = present.filter((n) => n !== subjId);
        if (!peers.length) { base.counts.dropped += 1; continue; }
        for (const pn of peers) {
            const peer = { id: pn, name: pn };
            const b = bucketOf(peer);
            b.entries.push({ ev: ev, floor: floor, evId: evId });
        }
    }

    /* 一人一本:条目按出处排(楼层优先,无楼层则取 0)。 */
    const albums = [];
    for (const [, b] of buckets) {
        const scopeCounts = { shared: 0, onesided: 0, hearsay: 0 };
        const entries = [];
        for (const it of b.entries) {
            const sc = scopeOfEvent(it.ev, { a: subjId, b: b.peer.name });
            scopeCounts[sc] += 1;
            const kindRaw = str(it.ev.kind);
            const kind = Object.prototype.hasOwnProperty.call(ALBUM_KINDS, kindRaw) ? kindRaw : 'other';
            entries.push({
                kind: kind,
                kindLabel: ALBUM_KINDS[kind].label,
                label: clip(it.ev.label || ALBUM_KINDS[kind].label, 60),
                scope: sc,
                scopeText: ALBUM_SCOPE_TEXT[sc],
                floor: it.floor,
                eventId: it.evId
            });
        }
        entries.sort((x, y) => ((x.floor == null ? 1e9 : x.floor) - (y.floor == null ? 1e9 : y.floor)));
        base.counts.shared += scopeCounts.shared;
        base.counts.onesided += scopeCounts.onesided;
        base.counts.hearsay += scopeCounts.hearsay;
        base.counts.entries += entries.length;
        /* 转折:从上游读的那一份里按身份键取(不重算)。 */
        let turns = null;
        if (base.turnsFace) {
            const hit = upPairs.find((p) => {
                const a = str(p && (p.aId || p.a)), bb = str(p && (p.bId || p.b));
                const pn = str(b.peer.id || b.peer.name);
                return (a === subjId && bb === pn) || (bb === subjId && a === pn);
            });
            if (hit) {
                const list = Array.isArray(hit.turns) ? hit.turns : [];
                if (list.length > maxTurns) base.truncated += 1;
                turns = list.slice(0, maxTurns).map((t) => ({
                    floor: numOrNull(t && t.floor),
                    label: clip(t && (t.label || t.to || t.kind), 40)
                }));
            }
        }
        albums.push({
            peer: { id: str(b.peer.id), name: str(b.peer.name) },
            entries: entries.slice(0, maxEntries),
            counts: scopeCounts,
            turns: turns,
            turnsKnown: turns !== null
        });
    }
    /* 排序:条目多的在前(读者最想看的是经历最多的那几个人);\n     *   同数保持分桶顺序(不按名字排,否则「顺序一变归属就变」复发)。 */
    albums.sort((x, y) => (y.entries.length - x.entries.length));
    base.albums = albums.slice(0, 60);
    base.counts.pairs = albums.length;
    base.counts.revoked = revoked;
    base.counts.byName = albums.filter((a) => !a.peer.id).length;
    base.state = albums.length ? RELATION_ALBUM_STATES.OK : RELATION_ALBUM_STATES.EMPTY;
    base.reason = albums.length ? 'ok' : 'empty';
    base.degraded = !!(up && up.state === RELATION_ALBUM_STATES.UNUSABLE);
    return base;
}

/** 一行读数(三态各占一格,与「你们没什么可回忆的」不同形)。 */
export function relationAlbumLine(album) {
    if (!album || typeof album !== 'object') return '人物回忆册:无读数';
    if (album.reason === 'no-subject') return '人物回忆册:' + RELATION_ALBUM_REASONS['no-subject'];
    if (!album.counts || !album.counts.pairs) return '人物回忆册:' + RELATION_ALBUM_REASONS.empty;
    const c = album.counts;
    return '人物回忆册:' + album.subject.name + ' · 共同 ' + c.shared
        + ' / 单方 ' + c.onesided + ' / 听说 ' + c.hearsay
        + (album.turnsFace ? ' · 转折读数在场' : ' · 转折读数不在场');
}

/** 自检(纯函数,不抛)。 */
export function relationAlbumSelfCheck() {
    const problems = [];
    const a = buildRelationAlbum({});
    if (a.reason !== 'no-subject') problems.push('没给要看的人时应如实报 no-subject');
    const b = buildRelationAlbum({ subject: { name: 'A' } });
    if (b.reason !== 'empty') problems.push('没事件时应如实报 empty');
    const c = buildRelationAlbum({ subject: { name: 'A' }, events: [{ id: 'e1', present: ['A', 'B'], floor: 1 }] });
    if (c.counts.shared !== 1) problems.push('双方在场的事件应计入 shared');
    const d = buildRelationAlbum({ subject: { name: 'A' }, events: [{ id: 'e1', present: ['A'], floor: 1, with: { name: 'B' } }] });
    if (d.counts.onesided !== 1) problems.push('只有一方在场的事件应计入 onesided');
    const e = buildRelationAlbum({ subject: { name: 'A' }, events: [{ id: 'e1', revoked: true, present: ['A', 'B'], floor: 1 }] });
    if (e.counts.revoked !== 1 || e.counts.pairs !== 0) problems.push('撤回的事件不得进纪念册');
    const f = buildRelationAlbum({ subject: { name: 'A' }, events: [{ present: ['A', 'B'] }] });
    if (f.counts.dropped !== 1) problems.push('无出处的事件应如实计 dropped');
    return { problems: problems };
}
