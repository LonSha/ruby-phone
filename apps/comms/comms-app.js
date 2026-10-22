/* ========================================================
 * comms-app.js — [v4.49.0 · 第六期 R6-O2] 会话台 App 控制器
 *
 * 【本件是什么】连续通信（R6-O2）的宿主消费面：把 config/comm-thread.js 纯契约内核
 *   （一段交流：接触点/注意面/漏接续谈）接到视图与生成侧。**取数在咽喉，判定全在内核**
 *   （本仓既有范式），本 App 只做三件转发：读存储 → 交内核归一 → 给视图/生成侧。
 *
 * 三条纪律（与 affairs-app / plotline-app 同规格）：
 *   ① 只持引用不持正文：接触点只记 `{channel, refId, kind}`，正文留在 wechat/phone
 *      各自的存储里。本 App **不读任何 App 的存储**（不复制事实所有者）；
 *   ② 不抛：存储读不出 / 内核归一失败，一律降级为空列表 + 归因，不阻断渲染；
 *   ③ 不猜：时间读不出就是读不出（见 config/comm-time.js 的「绝不补现在」），
 *      绝不静默回落成「刚刚」——「三天前漏接」被读成「刚刚漏接」是最伤的一类假读数。
 *
 * 【与 R6-O1 事务台的分工】事务台答「这件事进行到哪」（阶段/待决/参与者）；
 *   本件答「我们这一段聊到哪、断在哪」（接触点/未读未回/漏接与续谈）。
 *   两者**不合并**：一次通话可以是某件事的推进，也可以是纯闲聊 ——
 *   合并就会把「聊了两句」伪装成「筹备已推进」。
 * ======================================================== */
'use strict';
import {
  /* 只导入真用到的入口（常量表由内核与判据消费，本层不重判故不重复持有） */
  openThread, appendPoint, closeThread, addThreadParticipants,
  markPointSeen, markPointAnswered, planPoint,
  liveThreads, pendingAttention, findThread, idleThreads,
  threadSummaryLine, threadCounts, resumeOf, threadMaterial,
  threadStateOf, attentionOf,
  commSelfCheck, readThreads, writeThreads,
} from '../../config/comm-thread.js';
import { stampOfCall, commTimeSelfCheck } from '../../config/comm-time.js';
import { CommsView } from './comms-view.js';

function toStr(v) { return String(v == null ? '' : v).trim(); }

export class CommsApp {
    constructor(phoneShell, storage) {
        this.phoneShell = phoneShell;
        this.storage = storage;
        this.view = new CommsView(this);
        this._lastAction = null;  /* 最近一次内核归因（诊断用；不参与渲染数据） */
        this._hooked = false;     /* 生成前钩子只挂一次 */
        this._tab = 'board';      /* 单页 App 的兜底页签 */
    }
    /* ========== 读（现取现归一，不缓存 —— 换会话/删楼后缓存即陈旧） ========== */
    list() { return readThreads(this.storage); }
    live() { return liveThreads(this.list(), Date.now()); }
    /** 安静了的段（open 且静默超窗）—— 与 live() 分列：安静不是结束，但也不该混进「正在聊」。 */
    idle() { return idleThreads(this.list(), Date.now()); }
    pending() { return pendingAttention(this.list()); }
    find(id) { return findThread(this.list(), id); }
    /* ========== 写（每一步都过内核判定；ok=false 时视图展示 why，不落账） ========== */
    open(participant, note) {
        const res = openThread(this.list(), participant, Date.now(), note);
        if (res.ok) writeThreads(this.storage, res.list);
        this._lastAction = { op: 'open', ok: res.ok, why: res.why };
        return res;
    }
    append(threadId, point) {
        const res = appendPoint(this.list(), threadId, point, Date.now());
        if (res.ok) writeThreads(this.storage, res.list);
        this._lastAction = { op: 'append', ok: res.ok, why: res.why };
        return res;
    }
    close(threadId, reason) {
        const res = closeThread(this.list(), threadId, reason, Date.now());
        if (res.ok) writeThreads(this.storage, res.list);
        this._lastAction = { op: 'close', ok: res.ok, why: res.why };
        return res;
    }
    addParticipants(threadId, names) {
        const res = addThreadParticipants(this.list(), threadId, names);
        if (res.ok) writeThreads(this.storage, res.list);
        this._lastAction = { op: 'addParticipants', ok: res.ok, why: res.why };
        return res;
    }
    markSeen(threadId, pointId) {
        const res = markPointSeen(this.list(), threadId, pointId);
        if (res.ok) writeThreads(this.storage, res.list);
        this._lastAction = { op: 'markSeen', ok: res.ok, why: res.why };
        return res;
    }
    markAnswered(threadId, pointId) {
        const res = markPointAnswered(this.list(), threadId, pointId);
        if (res.ok) writeThreads(this.storage, res.list);
        this._lastAction = { op: 'markAnswered', ok: res.ok, why: res.why };
        return res;
    }
    /* ========== 投影（给视图/生成侧/其他 App 消费） ========== */
    /**
     * ★ 从**痕迹所有者**的原始读数造一个接触点（本件唯一的跨层入口，也是
     *   config/comm-time.js 的真消费点）。
     *   为什么需要它：通话记录的时间是**文本**（date:'2026年10月22日' + time:'14:30'，
     *   见 apps/phone/phone-data.js 的 addCallRecord 契约），而交流内核要毫秒数。
     *   没有这一件，**漏接来电根本进不了交流读数** —— 而漏接是 R6-O2 最不能丢的一格。
     *   ★ 时间读不出**直接拒**（no-source），绝不回落成「现在」：
     *     把「三天前没接到的电话」读成「刚刚漏接」是最伤的一类假读数。
     * @param {'message'|'call'|'missed'|'sms'} kind
     * @param {'wechat'|'phone-call'|'phone-sms'} channel
     * @param {{refId:string, label?:string, direction?:string, at?:number,
     *          record?:object, dateText?:string, timeText?:string}} raw
     * @param {{year?:number, month?:number, day?:number}} storyDay 故事日（显式参数，非猜）
     */
    pointOf(kind, channel, raw, storyDay) {
        const r = (raw && typeof raw === 'object' && !Array.isArray(raw)) ? raw : {};
        let at = (typeof r.at === 'number' && Number.isFinite(r.at)) ? r.at : null;
        if (at === null && r.record && typeof r.record === 'object') {
            /* 通话记录条目：走唯一实现 stampOfCall（读不出即 null） */
            at = stampOfCall(r.record, storyDay);
        }
        if (at === null && (r.dateText || r.timeText)) {
            at = stampOfCall(r.dateText, r.timeText, storyDay);
        }
        return {
            kind: toStr(kind),
            channel: toStr(channel),
            refId: toStr(r.refId),
            label: toStr(r.label),
            direction: toStr(r.direction) === 'incoming' ? 'incoming' : 'outgoing',
            at: at,
            seen: r.seen === true,
            answered: r.answered === true,
        };
    }
    /** 自检合并（内核两件的原样转发，本层不重判）。 */
    selfCheckAll() {
        const a = commSelfCheck();
        const b = commTimeSelfCheck();
        return { ok: a.ok && b.ok, problems: a.problems.concat(b.problems) };
    }
    /** 该续还是该开新段（纯判定，不落账）—— 调用方据此决定，本层不猜。 */
    plan(participant, at) { return planPoint(this.list(), participant, at); }
    /** 一段的读数句。 */
    summaryOf(id) {
        const t = this.find(id);
        return t ? threadSummaryLine(t, Date.now()) : '没有这段交流（或形态读不出）';
    }
    /**
     * 视图取读数用的三处转发（**不重判**：口径全在内核，这里只是把 id 换成读数）。
     *   视图需要 counts/resume/state/attention 才能画卡片，而卡片不该自己算 ——
     *   自算就是第二份口径，正是本仓反复治理的「同一件事两处实现」。
     */
    countsOf(id) {
        const t = this.find(id);
        return t ? threadCounts(t) : { messages: 0, calls: 0, missed: 0, sms: 0, unread: 0, unanswered: 0, points: 0, dropped: 0 };
    }
    resumeOf(id) {
        const t = this.find(id);
        return t ? resumeOf(t) : { missed: 0, lastMissedAt: null, resumedAfterMissed: false, endedOnMissed: false };
    }
    stateOf(id) {
        const t = this.find(id);
        return t ? threadStateOf(t) : 'absent';
    }
    attentionOf(id) {
        const t = this.find(id);
        return t ? attentionOf(t) : 'settled';
    }
    /** 本幕材料：给记忆桥与 R6-O3 消费（引用不复制正文）。 */
    materialOf(id) {
        const t = this.find(id);
        return t ? threadMaterial(t, Date.now()) : null;
    }
    /**
     * 生成侧一致性块：待处理面 + 漏接悬置的读数（无内容返回 ''，不产生空块）。
     *   ★ 只给**待处理**与**正悬着**的段：安静了且已回的段不注入 ——
     *     把「早就聊完了」塞进上下文，会让模型以为对方还在等。
     */
    promptBlock() {
        try {
            const lines = [];
            for (const t of this.pending().slice(0, 4)) {
                lines.push('- ' + threadSummaryLine(t, Date.now()));
            }
            const dangling = liveThreads(this.list(), Date.now()).filter(function (t) {
                const r = resumeOf(t);
                return r.endedOnMissed;
            });
            for (const t of dangling) {
                if (lines.some(function (l) { return l.indexOf(t.participant) >= 0; })) continue;
                lines.push('- ' + threadSummaryLine(t, Date.now()));
            }
            if (!lines.length) return '';
            return '【手机上的待处理交流（会话台）】\n' + lines.join('\n');
        } catch (_e) { return ''; }
    }
    /** 自检（内核原样转发，本层不重判）。 */
    selfCheck() { return commSelfCheck(); }
    /* ========== 页签（单页 App：只认兜底页，与 tab-source 的 single 口径一致） ========== */
    setTab(tab) { this._tab = toStr(tab) || 'board'; }
    _win() {
        try { return (typeof window !== 'undefined') ? window : globalThis; } catch (_e) { return globalThis; }
    }
    /** 挂生成前钩子（构造期一次；宿主无 eventSource 时静默不挂，不影响 App 本体）。 */
    _initHook() {
        if (this._hooked) return;
        try {
            const ctx = this._win().SillyTavern?.getContext?.();
            const es = ctx?.eventSource;
            const et = ctx?.event_types;
            if (!es || !et?.GENERATE_BEFORE_COMBINE_PROMPTS) return;
            es.on(et.GENERATE_BEFORE_COMBINE_PROMPTS, (payload) => {
                try {
                    if (!payload || !Array.isArray(payload.prompt)) return;
                    const block = this.promptBlock();
                    if (block) payload.prompt.push({ role: 'system', content: block });
                } catch (_e) { /* 静默失败：生成照常进行 */ }
            });
            this._hooked = true;
        } catch (_e) { /* 宿主无事件源：不挂钩子 */ }
    }
    /**
     * 换会话：交流**本来就是会话私有**（键 comm_threads_v1 命中 ^comm 前缀落 chatMetadata），
     *   故不持任何跨会话副本；这里只丢上一次动作归因（那是旧会话的判定）。
     */
    onChatChanged() {
        this._lastAction = null;
        this._tab = 'board';
    }
    /* ========== 宿主渲染 ========== */
    render(container) {
        this._initHook();
        const host = container
            || this.phoneShell?.layerHost?.('comms-main')
            || this.phoneShell?.screen;
        this.view.render(host);
    }
}
export default CommsApp;