/* ============================================================
 * config/session-gate.js — 会话世代栅栏（在飞回信的唯一裁决口）[v3.58.0 · 计划 O4]
 * ------------------------------------------------------------
 * 【治的欠债】v2.23~v3.57 陆续交付了 lifecycle 表与三条清理路径（换会话 /
 *   清当前数据 / 清全部数据）。它们回答的是「**实例**该不该活、监听器与
 *   定时器有没有收干净」—— 表里有名字只证明**接线在场**。
 *
 *   它们**没有**回答另一件事：「**已经飞出去、还没回来的那一轮请求**」会不会
 *   把结果写到别的会话。生图 / 搜索 / 微信生成 / 总结 / 日程 / 微博推荐这些
 *   回信**可能晚于会话切换**：用户点了生成 → 切到另一个会话 → 旧请求这时才
 *   回来 → 它拿着**出发时**的聊天气息与参数，却把结果写进**现在**的存储桶。
 *   这一族形态的共性是「不报错、不崩溃、只错结果」——面板上会出现一条不属于
 *   本会话的内容，下一次落盘就把它带进新会话的存档。
 *
 * 【本模块回答的唯一问题】「**这一轮请求出发时的那段会话，还是现在这段吗**」
 *   裁决用**两维，两维都要真**（少一维就有一种切换方式漏网）：
 *     ① `id`    —— 会话身份串（与 PhoneStorage 的 currentConversationId 同口径）。
 *                   覆盖「宿主换了会话，但本扩展没走到 bump」的路径；
 *     ② `epoch` —— 进程内单调世代号，**任何一次会话身份变更都 +1**。
 *                   覆盖「会话没换、数据被清了」（清当前数据 / 清全部数据）
 *                   与「切走又切回」（回来时 id 相同、epoch 已不同）。
 *
 * 【为什么不做成「单调世代」一维就够】不够。只用 epoch 时，宿主直接换会话
 *   （扩展没收到 CHAT_CHANGED）那条路径上 epoch 不涨、旧回信照样落盘；
 *   只用 id 时，清当前数据不改变身份、旧回信会把已清的内容复活。
 *   两维合起来才是「这段会话的**这一段**数据」。
 *
 * 【口径纪律】
 *   · **拿不到身份 ⇒ 判不当前**（fail-closed）：宁可丢一次回信，不可串一次会话。
 *   · `epoch` 与 `id` 都过 `config/num-gate.js` 取数门（`epoch` 是数、`id` 是串）：
 *     畸形世代一律判「没给」—— 不许 `Number(null)` 把空世代读成 0 而与真世代 0
 *     撞车（这正是 v3.57.0 治过的那族错读数在本面上的复现，不复刻第四遍）。
 *   · **本模块不认识任何业务**：不生图、不碰 DOM、不写会话存储。它只持两样东西
 *     —— 进程内的世代号，与一本**只读账本**（谁在什么时候被挡下）。
 *   · 账本**有界**（保留最近 60 条）：遥测不得成为新的泄漏源。
 *
 * 【为什么账本必须存在】计划验收要求「旧响应有**可读的拒绝原因**」。
 *   抛异常会打断调用方的 finally 清理；弹窗会吵。故把拒绝落成**可读读数**：
 *   诊断中心读得到，真机上也就能被看见 ——「安静地知道」优于「吵闹地知道」
 *   （与 config/silence-guard.js 同族）。
 *
 * 【消费面（本文件导出四件，各自有跨文件生产消费点 —— 零消费导出即欠债）】
 *   bumpSessionEpoch   ← index.js 三条路径（换会话 / 清当前 / 清全部）
 *   captureSessionToken← 六处回信写回点（出发时记令牌）
 *   guardSessionWrite  ← 同上（回信时裁决，不当前即丢）
 *   sessionDropLog     ← 诊断中心（把被挡下的回信摆到可见面上）
 * ============================================================ */
'use strict';
import { numOrNull } from './num-gate.js';

/** 账本上限：遥测有界，不成为新的泄漏源 */
const DROP_LOG_MAX = 60;

/** 进程内世代号 + 有界账本（模块级单例：全仓唯一真源） */
const gate = { epoch: 0, drops: [] };

/**
 * 会话身份串：与 PhoneStorage 的 currentConversationId 同口径，**不复制实现**。
 *   刻意不 import config/storage.js（避免 config 内部循环依赖），只读它算好的那格。
 *   取不到 → 返回空串（调用方据此 fail-closed，不编一个身份出来）。
 */
function identityOf(storage) {
    if (!storage || typeof storage !== 'object') return '';
    let id = String(storage.currentConversationId || '').trim();
    if (id) return id;
    try {
        if (typeof storage.getContext === 'function') storage.getContext();
    } catch (_e) { /* 取不到就如实空，不抛 */ }
    return String(storage.currentConversationId || '').trim();
}

/**
 * 会话身份变更的唯一出口。三条清理路径（换会话 / 清当前数据 / 清全部数据）
 *   各调一次；每调一次，此前**所有**在飞回信一律失去当前身份。
 *   刻意不按会话分桶：切走 A → 到 B → 再切回 A 时，途中那一轮 A 的回信
 *   已跨过两次会话，交给它写回是安全侧最坏的赌注。整体 +1 是**保守且确定**的。
 *
 * @param {string} reason 诊断用成因（不参与判定，只进读数）
 * @returns {number} 新的世代号
 */
export function bumpSessionEpoch(reason = 'chat-changed') {
    gate.epoch += 1;
    return gate.epoch;
}

/**
 * 回信出发时记令牌。**任务开始那一刻调，不要等回来了再调**
 *   —— 回来时已经取到的是「现在」，那就永远判当前，栅栏等于没建。
 *
 * @param {object} storage PhoneStorage 实例
 * @returns {{id:string, epoch:number}} 令牌；`id` 为空串表示当场就没拿到身份
 */
export function captureSessionToken(storage) {
    return { id: identityOf(storage), epoch: gate.epoch };
}

/**
 * 裁决：这一轮回信的令牌还算不算当前。
 * @returns {'current'|'invalid-token'|'no-identity'|'chat-changed'|'epoch-bumped'}
 */
function sessionDropReason(storage, token) {
    if (!token || typeof token !== 'object') return 'invalid-token';
    const tokenEpoch = numOrNull(token.epoch);
    if (tokenEpoch === null) return 'invalid-token';
    const nowId = identityOf(storage);
    const tokenId = String(token.id || '').trim();
    if (!nowId || !tokenId) return 'no-identity';
    if (nowId !== tokenId) return 'chat-changed';
    if (tokenEpoch !== gate.epoch) return 'epoch-bumped';
    return 'current';
}

/** 拒绝原因 → 可读中文（诊断面直出，不在这里做二次解释） */
const REASON_TEXT = Object.freeze({
    'invalid-token': '令牌畸形（世代取不到数）',
    'no-identity': '会话身份取不到（本扩展此刻读不出发言人会话）',
    'chat-changed': '会话已切换（回信出发时那一段已经不是当前这段）',
    'epoch-bumped': '会话内数据世代已变（换会话 / 清当前数据 / 清全部数据）'
});

/**
 * 回信写回前的唯一门槛。**不当前即返回 false，调用方必须原样 return**
 *   （不要「继续写但只打日志」—— 那正是本模块要消灭的形态）。
 *
 * @param {object} storage PhoneStorage 实例
 * @param {object} token captureSessionToken 的返回
 * @param {string} domain 诊断用域名（如 wechat-image / diary-photo）
 * @returns {boolean} true = 允许写回；false = 已挡下并记账
 */
export function guardSessionWrite(storage, token, domain = '') {
    const reason = sessionDropReason(storage, token);
    if (reason === 'current') return true;
    const entry = {
        domain: String(domain || 'unknown').trim() || 'unknown',
        reason: reason,
        text: REASON_TEXT[reason] || reason,
        at: Date.now()
    };
    gate.drops.push(entry);
    if (gate.drops.length > DROP_LOG_MAX) gate.drops.splice(0, gate.drops.length - DROP_LOG_MAX);
    try {
        console.warn('[ST-Phone][SessionGate] 已挡下旧会话回信：' + entry.domain + ' —— ' + entry.text);
    } catch (_e) { /* 宿主无 console 不打紧 */ }
    return false;
}

/**
 * 被挡下回信的只读读数（诊断中心消费）。返回快照副本 —— 调用方改不动账本。
 * @returns {{epoch:number, count:number, rows:Array<{domain:string,reason:string,text:string,at:number}>}}
 */
export function sessionDropLog() {
    return {
        epoch: gate.epoch,
        count: gate.drops.length,
        rows: gate.drops.map(row => Object.assign({}, row))
    };
}
