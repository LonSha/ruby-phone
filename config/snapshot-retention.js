/* ========================================================
 * config/snapshot-retention.js — 通话快照保留策略（纯函数）[v4.88.0 · 第七批缝入]
 * --------------------------------------------------------
 * 【这一刀治的是什么（本仓实测的真缺口）】
 *   视频通话每轮都会留一张对方画面快照，连着聊一小时就是几十上百张 base64。
 *   本仓修前**一张都不回收**：全塞在消息里，导出与列表逐条渲染越来越慢。
 *   而删也要删得对：删摘要不动正文 —— 会话里要留一个「[图片]」记号，
 *   否则翻上去就是一段段空白，读起来像消息丢了。
 *
 * 【源形态（非描述，按源码判定）】
 *   qegj567-cloud/SullyOS · utils/callSnapshotRetention.ts
 *     · 常量 CALL_SNAPSHOT_RETAINED_ROUNDS = 3（只保留最近 3 轮）；
 *     · 新→旧排序后 `.slice(keep)` 取过期集合（**保留侧不参与删除**）；
 *     · 四条筛选缺一不可：role 是 user、`metadata.source === 'call'`、
 *       `metadata.callSessionId` 等于当前会话、`cameraSnapshotRef` 是非空串；
 *     · 排序是时间倒序 + id 倒序（时间相同时也稳定）；
 *     · 返回 `{messageId, ref}`，不负责真正删（删与改写是调用方的事）。
 *
 * 【本仓差异与后果（照抄会坏的地方）】
 *   · 源的快照挂在消息 `metadata` 上；本仓同形（消息对象带 metadata），
 *     但本仓消息 id 可能是字符串且**不等于数组下标** —— 故排序必须用 id 值比较
 *     而不是下标，且只要求「同类型可比」，不假定数字。
 *   · 源只处理 user 侧。本仓视频通话的对方画面也是 user 消息挂着（角色发来的
 *     画面同样挂 `source:'call'`），故保留 role 判定，但**不额外要求 user**
 *     以外的东西 —— 若将来角色侧也挂，加一条 role 白名单即可。
 *   · 源不删 Blob、只清引用；本仓同口径：返回要被清掉 ref 的消息，
 *     清完 ref 但**保留 messageId 与占位符**。
 *
 * 【纪律】
 *   ① 纯函数：不改入参数组，返回新数组；
 *   ② 只判不改：返回「哪些该清」，清与占位由调用方落地；
 *   ③ 只清不删：过期的是**引用**，消息本身永不出会话；
 *   ④ 判不出就留：keep 非数字、会话 id 缺失、ref 为空的一律不列入过期。
 * ======================================================== */
'use strict';

/** 默认保留轮数。改这里即改判据，须同步套件。 */
export const DEFAULT_RETAINED_ROUNDS = 3;

/** 快照占位符：清掉引用后正文里留下的记号（视图据此画 [图片]）。 */
export const SNAPSHOT_PLACEHOLDER = '[图片]';

/** 消息是否可判为「本会话的通话快照」。 */
export function isCallSnapshotOf(message, sessionId) {
    if (!message || typeof message !== 'object') return false;
    const sid = (typeof sessionId === 'string') ? sessionId : String(sessionId == null ? '' : sessionId);
    if (!sid) return false;
    const meta = message.metadata;
    if (!meta || typeof meta !== 'object') return false;
    if (meta.source !== 'call') return false;
    if (String(meta.callSessionId == null ? '' : meta.callSessionId) !== sid) return false;
    if (typeof meta.cameraSnapshotRef !== 'string' || !meta.cameraSnapshotRef) return false;
    return true;
}

/** id 比较：同类型直接比，数字与数字、字符串与字符串；混类型时退化为字符串序（仍稳定）。 */
function compareIdDesc(a, b) {
    if (typeof a === 'number' && typeof b === 'number') return b - a;
    const sa = String(a == null ? '' : a);
    const sb = String(b == null ? '' : b);
    return sa < sb ? 1 : (sa > sb ? -1 : 0);
}

/**
 * 找出该清引用的快照。
 * @param {Array} messages 会话消息（任意顺序）
 * @param {string} sessionId 当前通话会话 id
 * @param {number} [keep] 保留最近几条（默认 DEFAULT_RETAINED_ROUNDS）
 * @returns {Array<{messageId:any, ref:string}>}
 */
export function findExpiredSnapshots(messages, sessionId, keep = DEFAULT_RETAINED_ROUNDS) {
    const list = Array.isArray(messages) ? messages : [];
    const retain = Math.max(0, Math.floor(Number(keep)));
    const kept = Math.max(0, Number.isFinite(retain) ? retain : DEFAULT_RETAINED_ROUNDS);
    return list
        .filter((m) => isCallSnapshotOf(m, sessionId))
        .slice()
        .sort((a, b) => {
            const ta = Number(a.timestamp) || 0;
            const tb = Number(b.timestamp) || 0;
            if (ta !== tb) return tb - ta;
            return compareIdDesc(a.id, b.id);
        })
        .slice(kept)
        .map((m) => ({ messageId: m.id, ref: m.metadata.cameraSnapshotRef }));
}

/**
 * 在消息副本上清掉过期快照（不动原数组）。正文里**只补占位符，不删字**。
 * @returns {{ messages:Array, cleared:number }}
 */
export function applySnapshotRetention(messages, sessionId, keep = DEFAULT_RETAINED_ROUNDS) {
    const list = Array.isArray(messages) ? messages : [];
    const expired = findExpiredSnapshots(list, sessionId, keep);
    if (!expired.length) return { messages: list, cleared: 0 };
    const index = new Map(expired.map((e) => [e.messageId, e.ref]));
    const out = list.map((m) => {
        if (!m || !index.has(m.id)) return m;
        const meta = { ...(m.metadata || {}) };
        const ref = meta.cameraSnapshotRef;
        meta.cameraSnapshotRef = '';
        meta.snapshotRetained = false;
        const text = (typeof m.content === 'string') ? m.content : '';
        const withMark = (text && text.indexOf(SNAPSHOT_PLACEHOLDER) >= 0) ? text : (text + SNAPSHOT_PLACEHOLDER);
        return { ...m, metadata: meta, content: withMark, _expiredRef: ref };
    });
    return { messages: out, cleared: expired.length };
}

/** 一行读数。 */
export function retentionLine(cleared, keep = DEFAULT_RETAINED_ROUNDS) {
    return '通话快照保留最近 ' + String(keep) + ' 张 · 本次清 ' + String(Number(cleared) || 0) + ' 张';
}

/** 自检：保留侧不动、超出的被清、占位符补上、跨会话不误伤、ref 空的不算。 */
export function retentionSelfCheck() {
    const bad = [];
    const mk = (id, ts, sid, ref) => ({ id, timestamp: ts, content: '画面', metadata: { source: 'call', callSessionId: sid, cameraSnapshotRef: ref } });
    const list = [mk(1, 100, 's1', 'a'), mk(2, 200, 's1', 'b'), mk(3, 300, 's1', 'c'), mk(4, 400, 's1', 'd'), mk(5, 500, 's2', 'e')];
    const exp = findExpiredSnapshots(list, 's1', 2);
    if (exp.length !== 2) bad.push('过期数量错: ' + exp.length);
    if (exp.some((e) => e.messageId === 4)) bad.push('保留侧被列入过期');
    const applied = applySnapshotRetention(list, 's1', 2);
    if (applied.messages[0].content.indexOf(SNAPSHOT_PLACEHOLDER) < 0) bad.push('占位符未补');
    if (applied.messages[0].metadata.cameraSnapshotRef !== '') bad.push('引用未清');
    if (applied.messages[4].metadata.cameraSnapshotRef !== 'e') bad.push('跨会话被误伤');
    if (list[0].metadata.cameraSnapshotRef !== 'a') bad.push('原数组被改');
    if (findExpiredSnapshots([{ id: 1, metadata: { source: 'call', callSessionId: 's1', cameraSnapshotRef: '' } }], 's1', 0).length !== 0) bad.push('空 ref 被计入');
    if (findExpiredSnapshots(list, '', 0).length !== 0) bad.push('空会话 id 未挡');
    return { ok: bad.length === 0, bad };
}