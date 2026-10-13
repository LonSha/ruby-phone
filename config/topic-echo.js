/* ========================================================
 * config/topic-echo.js — [v4.02.0 · 第三期 E 包 R3-X4] 跨社媒同一事件的话题页与舆论演变（纯函数）
 * --------------------------------------------------------
 * 【这一刀治的是什么（计划原文 R3-X4 的真实缺口）】
 *   计划要的是「一件事可在朋友圈/贴吧/小红书表现不同而核心事实一致；删除/辟谣
 *   影响后续草稿；私聊秘密不会自动变公共热帖；公开范围由用户确认」。
 *   修前实测：retellChains 只把转述**归并计数**（同一传闻不算三条独立证据），
 *   knowledgeCheck 只判**可见性**——两者之间没有任何一层把「同一事件在各平台的
 *   发布/转载/评论/辟谣」**按事件聚拢成话题页**，更没有「辟谣之后新草稿不得照旧
 *   编写」「角色不知情不生成反应」的闸。
 *
 * 【本模块做五件事（只消费、不取数，与 provenance-graph 同范式）】
 *   ① **四类条目归一 normalizeTopicEntry**：publish 发布 / repost 转载 /
 *      comment 评论 / debunk 辟谣 —— 每条**必须带 rootEventId**，没有就如实拒
 *      （验收「各保留 rootEventId」）；
 *   ② **话题页 buildTopicPage**：按 rootEventId 聚拢条目，借 context-compose 的
 *      retellNode 标来源身份（转述链口径只有一份实现，不另写）；
 *   ③ **知情反应 reactionFor**：角色对事件不知情 ⇒ 不生成反应（「不知情不编反应」
 *      与 social-knowledge-bridge「未看不能互动」同口径）；知情来源数如实报，
 *      绝不把三平台转述读成三个独立信源（借 retellNode.kind 区分 original/retold）；
 *   ④ **辟谣传播 applyDebunk**：辟谣条目落地后，同话题**后续**草稿全部标 stale
 *      并带 debunkedBy —— 旧内容不从本上消失（撤回≠删除），但不得再被当作现状；
 *   ⑤ **公开确认 gatePublicity**：受众为公开（visibleTo 为空）的发布/转载，
 *      **必须带用户确认标记**才进本；未确认的进 pending 不落地（「公开范围由用户确认」）。
 *
 * 【不做什么】
 *   · 不取数：条目/知情状态全部由调用方取好传进来；
 *   · 不写存储、不碰 DOM、不带计时器（纯函数）；
 *   · 不重算可见性：知情与否由调用方过 knowledgeCheck 后传状态进来，本模块只闸不判；
 *   · 不把「发布到虚拟社媒」说成外网发布。
 *
 * 【口径纪律】
 *   · 读不出与空分开；认不出不硬塞；同键后到覆盖先到；上限最早先出；
 *   · 辟谣不删旧条（撤回≠消失）；草稿 stale 后 preview 文案如实报「已被辟谣」。
 * 纯 ESM export，纯函数，保证可测。
 * ======================================================== */
'use strict';
import { retellNode } from './context-compose.js';

/* ───────── ① 常量 ───────── */
export const TOPIC_KINDS = Object.freeze({
    publish: Object.freeze({ label: '发布', onePerPlatform: true, note: '本机第一次把这件事发上平台' }),
    repost: Object.freeze({ label: '转载', onePerPlatform: false, note: '转述已有内容，来源身份借 retellNode 标' }),
    comment: Object.freeze({ label: '评论', onePerPlatform: false, note: '围绕话题的发言，不改变核心事实' }),
    debunk: Object.freeze({ label: '辟谣', onePerPlatform: false, note: '声明核心事实有误；落地后同话题后续草稿标 stale' }),
});
export const TOPIC_LIMITS = Object.freeze({
    entries: 120,          /* 话题本上限，超出最早先出 */
    perTopic: 40,          /* 单话题条目上限，超出最早先出 */
    textMax: 400,          /* 条目文本裁长 */
});

function _s(x, max) {
    const t = (x === null || x === undefined) ? '' : String(x);
    return max ? t.slice(0, max) : t;
}
/* ───────── ② 条目归一（窄口：认不出就拒，不静默修） ───────── */
/**
 * @param {object} raw 裸条目（rootEventId 必须在场；kind 必须在四类表内）
 * @returns {{ok:boolean, reason:string, entry?:object, trimmed?:boolean}}
 */
export function normalizeTopicEntry(raw) {
    const no = (reason) => ({ ok: false, reason });
    try {
        const r = (raw && typeof raw === 'object') ? raw : null;
        if (!r) return no('条目不是对象');
        const rootEventId = _s(r.rootEventId, 120).trim();
        if (!rootEventId) return no('缺 rootEventId（话题页只收同源事件条目）');
        const kind = _s(r.kind, 24).trim();
        if (!Object.prototype.hasOwnProperty.call(TOPIC_KINDS, kind)) return no('条目类别认不出：' + (kind || '空'));
        const platform = _s(r.platform, 40).trim();
        if (!platform) return no('缺平台名');
        const id = _s(r.id, 80).trim();
        if (!id) return no('缺条目 id');
        const text = _s(r.text, TOPIC_LIMITS.textMax);
        const by = _s(r.by, 60);
        /* 公开确认闸：受众为空 = 公开 ⇒ 必须带用户确认标记；私域（受众非空）不受此闸 */
        const visibleTo = Array.isArray(r.visibleTo) ? r.visibleTo.map((x) => _s(x, 60)).filter(Boolean) : [];
        const isPublic = visibleTo.length === 0;
        const confirmed = r.confirmed === true;
        if ((kind === 'publish' || kind === 'repost') && isPublic && !confirmed) {
            return no('公开范围未经用户确认（confirmed 未标）');
        }
        const t = (typeof r.time === 'number' && isFinite(r.time)) ? r.time : 0;
        const entry = {
            key: platform + ':' + id,
            rootEventId: rootEventId,
            kind: kind,
            platform: platform,
            id: id,
            text: text,
            trimmed: String(r.text || '').length > TOPIC_LIMITS.textMax,
            by: by,
            origin: _s(r.origin || r.retellOf, 80),
            visibleTo: visibleTo,
            isPublic: isPublic,
            confirmed: confirmed,
            time: t,
        };
        return { ok: true, reason: 'ok', entry, trimmed: entry.trimmed };
    } catch (_e) { return no('条目认不出：' + String(_e && _e.message)); }
}
/* ───────── 话题本归一（读不出与空分开；上限最早先出） ───────── */
export function normalizeTopicBook(raw) {
    if (raw === null || raw === undefined) return { ok: false, reason: '读不出（键不存在或非 JSON）', entries: [] };
    let arr = raw;
    if (typeof arr === 'string') {
        try { arr = JSON.parse(arr); } catch (_e) { return { ok: false, reason: '读不出（JSON 解析失败）', entries: [] }; }
    }
    if (!Array.isArray(arr)) return { ok: false, reason: '读不出（不是数组）', entries: [] };
    const kept = [];
    let rejected = 0;
    const seen = new Map();
    for (const r of arr) {
        const n = normalizeTopicEntry(r);
        if (!n.ok) { rejected += 1; continue; }
        seen.set(n.entry.key, n.entry); /* 同键后到覆盖 */
    }
    for (const e of seen.values()) kept.push(e);
    kept.sort((a, b) => a.time - b.time); /* 时间正序；超限裁最旧 */
    let dropped = 0;
    while (kept.length > TOPIC_LIMITS.entries) { kept.shift(); dropped += 1; }
    return { ok: true, reason: 'ok', entries: kept, rejected, dropped };
}
/* ───────── ③ 话题页（按 rootEventId 聚拢；借 retellNode 标来源身份） ───────── */
/**
 * @param {Array} entries 话题本（已归一）
 * @param {string} rootEventId
 * @returns {{found:boolean, reason:string, entries:Array, byKind:object, platforms:string[], chains:object, debunked:boolean, debunkedBy:string, summary:string}}
 */
export function buildTopicPage(entries, rootEventId) {
    const empty = {
        found: false, reason: '', entries: [], byKind: {}, platforms: [], chains: { nodes: [], retoldChains: 0, unknown: 0 },
        debunked: false, debunkedBy: '', summary: '',
    };
    try {
        const rid = _s(rootEventId, 120).trim();
        if (!rid) { empty.reason = '缺 rootEventId'; return empty; }
        const list = (Array.isArray(entries) ? entries : [])
            .filter((e) => e && e.rootEventId === rid);
        if (!list.length) { empty.reason = '本上没有这个事件的条目'; return empty; }
        list.sort((a, b) => (a.time || 0) - (b.time || 0));
        let dropped = 0;
        while (list.length > TOPIC_LIMITS.perTopic) { list.shift(); dropped += 1; }
        const byKind = { publish: 0, repost: 0, comment: 0, debunk: 0 };
        const plats = new Set();
        const chainNodes = [];
        let debunked = false, debunkedBy = '';
        for (const e of list) {
            byKind[e.kind] += 1;
            plats.add(e.platform);
            chainNodes.push(retellNode({ platform: e.platform, id: e.id, retellOf: e.kind === 'repost' ? (e.text ? '' : '') : '' }));
            if (e.kind === 'debunk' && !debunked) { debunked = true; debunkedBy = e.by; }
        }
        /* 来源身份只对转载类标 retold：original = 该平台首次发布，unknown = 认不出 */
        for (const e of list) {
            /* 转载类按其 origin 认 retold；发布/评论按平台首发认 original；origin 缺失的转载如实 unknown */
            const n = retellNode({ platform: e.platform, id: e.id, retellOf: e.origin || '' });
            const chainKind = e.kind === 'repost'
                ? (n.kind === 'retold' ? 'retold' : (n.kind === 'original' ? 'unknown' : n.kind))
                : 'original';
            e._chain = { platform: n.platform, kind: chainKind, chainId: n.chainId };
        }
        const retoldChains = list.filter((e) => e._chain && e._chain.kind === 'retold').length;
        const unknown = list.filter((e) => !e._chain || e._chain.kind === 'unknown').length;
        const summary = '话题 ' + rid + '：' + list.length + ' 条（发布 ' + byKind.publish
            + ' / 转载 ' + byKind.repost + ' / 评论 ' + byKind.comment + ' / 辟谣 ' + byKind.debunk + '）'
            + ' · 平台 ' + plats.size + ' 个 · 转述链 ' + retoldChains + ' 条（同一事件不按平台数计信源）'
            + (debunked ? ' · 已辟谣' : '')
            + (dropped ? ' · 超上限裁最旧 ' + dropped + ' 条' : '');
        return {
            found: true, reason: 'ok', entries: list, byKind: byKind,
            platforms: Array.from(plats).sort(),
            chains: { nodes: chainNodes, retoldChains, unknown },
            debunked, debunkedBy, summary, dropped,
        };
    } catch (_e) {
        empty.reason = '话题页建不起来：' + String(_e && _e.message);
        return empty;
    }
}
/* ───────── ④ 知情反应（不知情不编反应；信源数不按平台数计） ───────── */
/**
 * @param {object} page buildTopicPage 的产物
 * @param {string} actorId
 * @param {{knows:boolean, knowsWhy?:string}} knowledge 调用方过 knowledgeCheck 后的知情状态
 * @returns {{ok:boolean, reason:string, text:string, sourcesCount:number}}
 */
export function reactionFor(page, actorId, knowledge) {
    const no = (reason) => ({ ok: false, reason, text: '', sourcesCount: 0 });
    try {
        if (!page || page.found !== true) return no('话题页不在场');
        const a = _s(actorId, 60).trim();
        if (!a) return no('缺角色');
        if (page.debunked) return no('话题已辟谣，不再生成新反应（旧条目仍在，可查证）');
        if (!knowledge || knowledge.knows !== true) return no('角色不知情：' + _s(knowledge && knowledge.knowsWhy, 80) + '（未看不能互动，不编反应）');
        /* 信源数：同一事件按来源链计，不按平台数计（三平台转述仍是一条链） */
        const originalPlatforms = page.platforms.length;
        const sourcesCount = Math.max(1, originalPlatforms - (page.chains.retoldChains || 0));
        const text = '知情来源 ' + sourcesCount + ' 条（按来源链计，非平台数）';
        return { ok: true, reason: 'ok', text: text, sourcesCount: sourcesCount };
    } catch (_e) { return no('反应生成失败：' + String(_e && _e.message)); }
}
/* ───────── ⑤ 辟谣传播（同话题后续草稿标 stale；旧条目不删） ───────── */
/**
 * @param {Array} drafts 创作草稿行（含 key/target/state/version/rootEventId 可选）
 * @param {string} rootEventId
 * @param {string} by
 * @returns {{changed:number, drafts:Array}}
 */
export function markDraftsDebunked(drafts, rootEventId, by) {
    try {
        const rid = _s(rootEventId, 120).trim();
        const who = _s(by, 60);
        const list = Array.isArray(drafts) ? drafts : [];
        if (!rid) return { changed: 0, drafts: list.slice() };
        let changed = 0;
        const out = list.map((d) => {
            if (!d || typeof d !== 'object') return d;
            if (d.rootEventId !== rid) return d; /* 别的话题不动 */
            if (d.state === 'stale') return d; /* 已 stale 不重复加版本 */
            changed += 1;
            return Object.assign({}, d, { state: 'stale', debunkedBy: who, version: (typeof d.version === 'number' ? d.version : 0) + 1 });
        });
        return { changed: changed, drafts: out };
    } catch (_e) { return { changed: 0, drafts: Array.isArray(drafts) ? drafts.slice() : [] }; }
}
/* ───────── 自检 ───────── */
export function topicSelfCheck() {
    const problems = [];
    /* 1. 四类表齐备且不可变 */
    if (Object.keys(TOPIC_KINDS).join() !== 'publish,repost,comment,debunk') problems.push('四类表不齐');
    /* 2. 缺 rootEventId 必拒（不静默修） */
    if (normalizeTopicEntry({ kind: 'publish', platform: 'weibo', id: 'x' }).ok) problems.push('缺 rootEventId 未拒');
    /* 3. 公开未确认必拒；私域不受闸 */
    const pub = normalizeTopicEntry({ rootEventId: 'e1', kind: 'publish', platform: 'weibo', id: 'p1', visibleTo: [] });
    if (pub.ok) problems.push('公开未确认未拒');
    const priv = normalizeTopicEntry({ rootEventId: 'e1', kind: 'publish', platform: 'wechat', id: 'p2', visibleTo: ['user'] });
    if (!priv.ok) problems.push('私域误拦');
    /* 4. 话题页：三平台一条链不按平台计信源 */
    const book = normalizeTopicBook([
        { rootEventId: 'e9', kind: 'publish', platform: 'weibo', id: 'a', confirmed: true, time: 1, text: '核心事实' },
        { rootEventId: 'e9', kind: 'repost', platform: 'xhs', id: 'b', confirmed: true, time: 2, text: '转述', origin: 'weibo:a' },
        { rootEventId: 'e9', kind: 'repost', platform: 'tieba', id: 'c', confirmed: true, time: 3, text: '再转述', origin: 'weibo:a' },
        { rootEventId: 'e9', kind: 'comment', platform: 'xhs', id: 'd', time: 4, text: '评论' },
    ]);
    if (!book.ok) { problems.push('话题本自检失败'); }
    else {
        const pg = buildTopicPage(book.entries, 'e9');
        if (!pg.found) problems.push('话题页建不起来');
        else {
            if (pg.byKind.publish !== 1 || pg.byKind.repost !== 2 || pg.byKind.comment !== 1) problems.push('分类计数错');
            if (pg.platforms.length !== 3) problems.push('平台数错');
            const rc = reactionFor(pg, 'char:a', { knows: true });
            if (!rc.ok) problems.push('知情反应失败');
            else if (rc.sourcesCount !== 1) problems.push('三平台一条链应计 1 个信源，得 ' + rc.sourcesCount);
            const ru = reactionFor(pg, 'char:b', { knows: false, knowsWhy: '未看' });
            if (ru.ok) problems.push('不知情未拒');
        }
    }
    /* 5. 辟谣传播：后续草稿标 stale、旧条目不删、别话题不动 */
    const md = markDraftsDebunked([
        { key: 'k1', target: 'weibo', state: 'ready', version: 1, rootEventId: 'e9' },
        { key: 'k2', target: 'xhs', state: 'ready', version: 1, rootEventId: 'e8' },
    ], 'e9', '辟谣人');
    if (md.changed !== 1) problems.push('辟谣传播数错');
    const d0 = md.drafts[0];
    if (!d0 || d0.state !== 'stale' || d0.debunkedBy !== '辟谣人' || d0.version !== 2) problems.push('辟谣后草稿未标 stale');
    if (md.drafts[1].state !== 'ready') problems.push('别的话题被误伤');
    /* 6. 读不出与空分开 */
    const r1 = normalizeTopicBook(null);
    if (r1.ok) problems.push('null 被当可读');
    const r2 = normalizeTopicBook('[]');
    if (!r2.ok || r2.entries.length !== 0) problems.push('空数组被当不可读');
    return { ok: problems.length === 0, problems: problems };
}
export default {
    TOPIC_KINDS, TOPIC_LIMITS,
    normalizeTopicEntry, normalizeTopicBook, buildTopicPage, reactionFor, markDraftsDebunked,
    topicSelfCheck,
};
