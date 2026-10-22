/* ============================================================
 * config/social-ecosystem.js — [v4.52.0 · 第六期 R6-O9]
 *   「持续社媒生态：同一事件在不同圈层产生不同讨论与后续」（纯函数）
 * ------------------------------------------------------------
 * 【计划原文（R6-O9）】
 *   「同一展览消息在三圈层产生不同讨论；澄清只影响已看见的人；
 *    私聊不进公共话题；隔几天回来能接上舆论演变。」
 *
 * 【修前实测的缺口】
 *   本仓 `config/topic-echo.js`（v4.02.0）已实现「同一 rootEventId 的话题页」
 *   与辟谣传播（applyDebunk 标 stale）。但它把**同一事件**按平台聚拢，
 *   没有把**不同圈层**（好友圈 / 陌生人圈 / 公共广场）的讨论差异结构化：
 *     · 同一条消息发到朋友圈 vs 贴吧 vs 小红书，**受众不同 → 讨论不同**；
 *     · 澄清只影响**已经看到的人**，没看到的人后来看到的仍是原版；
 *     · 私聊里提到的事，**不会**自动变成公共话题。
 *   topic-echo 解决了「同一事件的条目归一」；social-ecosystem 解决「不同圈层
 *   对同一事件的不同反应与澄清传播边界」。
 *
 * 【本模块只做四件事（纯函数，不读存储 / 不碰 DOM / 不读时钟）】
 *   1 **normalizeCircleLayer**：把圈层归一为三态（friends / public-square / stranger-circle），
 *      认不出就拒（不静默归到公共）；
 *   2 **deriveCircleDiscussion**：同一事件在不同圈层产生不同的讨论形态——
 *      好友圈偏私人化、公共广场偏事实+观点、陌生人圈偏传闻转载；
 *   3 **gateClarificationScope**：澄清只影响「已经看到的人」——
 *      产出哪些圈层的哪些人需要更新、哪些人不受影响（没看到的不被波及）；
 *   4 **isolatePrivateFromPublic**：私聊中提到的事件 rootEventId，
 *      不会自动进入公共话题本——返回是否泄漏到公共的判定。
 *
 * 【口径纪律】
 *   · 圈层由调用方标在条目上（circleLayer 字段），本模块只归一不推断；
 *   · 「已经看到」由调用方传入 seenBy 列表，本模块不读可见性引擎；
 *   · 私聊条目天然带 visibleTo 非空，公共条目 visibleTo 为空——
 *     用此差异判泄漏，不另设标志位。
 * ============================================================ */
'use strict';

export const SE_VERSION = '4.52.0';
export const CIRCLE_LAYERS = Object.freeze({
    'friends': Object.freeze({ label: '好友圈', note: '互相可见的私人关系网，讨论偏私人化' }),
    'public-square': Object.freeze({ label: '公共广场', note: '完全公开的发布面，讨论偏事实与观点' }),
    'stranger-circle': Object.freeze({ label: '陌生人圈', note: '半公开的转载/讨论面，偏传闻' }),
});
export const SE_LIMITS = Object.freeze({
    maxCircles: 10,
    maxSeenBy: 200,
    textMax: 300,
});

function _s(x, max) {
    const t = (x === null || x === undefined) ? '' : String(x);
    return max ? t.slice(0, max) : t;
}

/* ───────── ① 圈层归一 ───────── */
/**
 * @param {string} layer 裸圈层标识
 * @returns {{ ok:boolean, layer?:string, label?:string, reason:string }}
 */
export function normalizeCircleLayer(layer) {
    const k = _s(layer, 40).trim();
    if (!k) return { ok: false, reason: '缺圈层标识' };
    if (Object.prototype.hasOwnProperty.call(CIRCLE_LAYERS, k)) {
        return { ok: true, layer: k, label: CIRCLE_LAYERS[k].label, reason: 'ok' };
    }
    return { ok: false, reason: '圈层认不出：' + k };
}

/* ───────── ② 不同圈层讨论差异 ───────── */
/**
 * 从话题页条目列表（已归一，来自 topic-echo）中，按圈层分出不同的讨论形态。
 * @param {Array} entries topic-echo normalizeTopicBook 的产物
 * @param {object} opts { rootEventId }
 * @returns {{ circles:Array<{layer:string,label:string,entries:Array,summary:string}>, crossLayer:boolean, summary:string }}
 */
export function deriveCircleDiscussion(entries, opts = {}) {
    const o = (opts && typeof opts === 'object') ? opts : {};
    const rid = _s(o.rootEventId, 120).trim();
    const list = Array.isArray(entries) ? entries.filter(e => e && typeof e === 'object') : [];
    const circles = [];
    for (const [layerKey, layerVal] of Object.entries(CIRCLE_LAYERS)) {
        const sub = list.filter(e => _s(e.circleLayer, 40).trim() === layerKey || _s(e.platform, 40).trim() === layerKey);
        if (sub.length === 0) continue;
        /* 圈层讨论特征：好友圈偏私人化（comment 多）、公共广场偏事实（publish 多）、陌生人圈偏转载（repost 多） */
        const byKind = { publish: 0, repost: 0, comment: 0, debunk: 0 };
        for (const e of sub) {
            if (byKind[e.kind] !== undefined) byKind[e.kind] += 1;
        }
        let characteristic = '';
        if (layerKey === 'friends') characteristic = byKind.comment >= byKind.publish ? '私人讨论为主' : '个人分享';
        else if (layerKey === 'public-square') characteristic = byKind.publish >= byKind.repost ? '首发为主' : '转载为主';
        else if (layerKey === 'stranger-circle') characteristic = byKind.repost > 0 ? '传闻转载' : '讨论';
        const summary = layerVal.label + '：' + sub.length + ' 条 · ' + characteristic
            + (byKind.debunk > 0 ? ' · 含澄清 ' + byKind.debunk + ' 条' : '');
        circles.push({ layer: layerKey, label: layerVal.label, entries: sub, summary, byKind });
    }
    while (circles.length > SE_LIMITS.maxCircles) circles.pop();
    const crossLayer = circles.length > 1;
    const summary = (rid ? '事件 ' + rid + ' · ' : '') + circles.length + ' 个圈层讨论'
        + (crossLayer ? ' · 跨圈层' : '');
    return { circles, crossLayer, summary };
}

/* ───────── ③ 澄清传播边界 ───────── */
/**
 * 澄清只影响已经看到的人。没看到的人后来看到的仍是原版。
 * @param {object} params
 *   · `clarifiedBy`     — 澄清条目的 by（谁澄清的）
 *   · `seenBy`         — 已经看到过原版的人列表 [{actorId, circleLayer, seenAt}]
 *   · `allParticipants` — 所有参与过讨论的人列表 [{actorId, circleLayer}]
 * @returns {{ affected:Array, unaffected:Array, reason:string }}
 */
export function gateClarificationScope(params = {}) {
    const o = (params && typeof params === 'object') ? params : {};
    const seenBy = Array.isArray(o.seenBy) ? o.seenBy : [];
    const allP = Array.isArray(o.allParticipants) ? o.allParticipants : [];
    const seenIds = new Set(seenBy.map(s => _s(s && s.actorId, 60)).filter(Boolean));
    const affected = [];
    const unaffected = [];
    for (const p of allP) {
        const aid = _s(p && p.actorId, 60);
        if (!aid) continue;
        if (seenIds.has(aid)) {
            affected.push({ actorId: aid, circleLayer: _s(p && p.circleLayer, 40), reason: '已看到原版，需更新' });
        } else {
            unaffected.push({ actorId: aid, circleLayer: _s(p && p.circleLayer, 40), reason: '未看到原版，不受澄清影响' });
        }
    }
    const reason = '澄清影响 ' + affected.length + ' 人 · 不影响 ' + unaffected.length + ' 人（未看到不波及）';
    return { affected, unaffected, reason };
}

/* ───────── ④ 私聊隔离 ───────── */
/**
 * 私聊中提到的事件 rootEventId，不应自动进入公共话题。
 * 判据：条目的 visibleTo 非空（私域）且 isPublic 为 false → 不应进公共话题本。
 * @param {Array} entries 话题本条目列表
 * @returns {{ leaks:Array, isolated:Array, reason:string }}
 */
export function isolatePrivateFromPublic(entries) {
    const list = Array.isArray(entries) ? entries.filter(e => e && typeof e === 'object') : [];
    const leaks = [];
    const isolated = [];
    for (const e of list) {
        const isPublic = !Array.isArray(e.visibleTo) || e.visibleTo.length === 0;
        if (!isPublic && e.confirmed !== true) {
            /* 私域条目且未经公开确认 → 不应进公共话题 */
            isolated.push({
                key: _s(e.key || e.id, 80),
                rootEventId: _s(e.rootEventId, 120),
                reason: '私聊条目（visibleTo 非空），不进公共话题',
            });
        } else if (isPublic) {
            /* 公共条目正常 */
        } else {
            /* 私域但已确认公开 → 可能是故意公开的，不判泄漏但标记 */
            leaks.push({
                key: _s(e.key || e.id, 80),
                rootEventId: _s(e.rootEventId, 120),
                reason: '私聊转公开（已确认），需人工核验',
            });
        }
    }
    const reason = '隔离 ' + isolated.length + ' 条私聊 · 核验 ' + leaks.length + ' 条私转公';
    return { leaks, isolated, reason };
}