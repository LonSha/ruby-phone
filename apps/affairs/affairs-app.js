/* ========================================================
 * affairs-app.js — [v4.48.0 · 第六期 R6-O1] 事务台 App 控制器
 *
 * 【本件是什么】以事情为中心的手机（R6-O1）的宿主消费面：把 config/affair-state.js
 *   纯契约内核（阶段/参与者/待决/动作引用）接到视图与生成侧。**取数在咽喉，
 *   判定全在内核**（本仓既有范式），本 App 只做三件转发：读存储 → 交内核归一 →
 *   给视图/生成侧。不重判任何一格。
 *
 * 三条纪律（与 plotline-app 同规格）：
 *   ① 只持引用不持正文：事务的 refs/actions 源引用指向 open-ref 登记桶，
 *      本 App 不复制任何源 App 内容（「不复制事实所有者」铁律同源）；
 *   ② 不抛：存储读不出 / 内核归一失败，一律降级为空列表 + 归因，不阻断渲染；
 *   ③ 不猜：拿不到就如实说（「这条事务读不出来」），不编造阶段顶替。
 *
 * 【与 te_ledger 的分工】task-entry 的台账是「这段对话里点过什么」（单次点击流），
 *   本件是「正在进行的这件事」（持续事务状态）。两者不合并：合并就会把
 *   「点过日历」伪装成「筹备已推进」—— 那是跳转，不是推进。
 * ======================================================== */
'use strict';
import {
  /* 只导入**真用到的**入口：本仓门禁不判「未使用的具名导入」，但欠债清单同样不欢迎它。
   *   常量表（AFF_STAGES / AFF_DECISION / AFF_STATES / AFF_REASONS / AFF_LIMITS / AFF_KEY）
   *   与归一层（normalizeAffair(s) / normalizeAffairRef / sameAffairRef / trimAffairs /
   *   affairStateOf）由**内核自己与判据套件**消费 —— 本 App 不重判，故不在此重复持有。 */
  findAffair, createAffair, transitionAffairStage,
  appendAffairAction, appendAffairDecision, resolveAffairDecision,
  addAffairParticipants, attachAffairRef,
  activeAffairs, affairSummaryLine, affairMaterial,
  affairSelfCheck, readAffairs, writeAffairs,
} from '../../config/affair-state.js';
import { AffairsView } from './affairs-view.js';
/* [v4.114.0 · R13-X7] 「这个月要处理的」清单。
 *   判定全在内核（状态机 / 四个动作 / 存储口），本层只做三件事：
 *   取剧情当下、把时间推进后的结果写回、把读数交给视图。
 *   ★ 一格不重判：「到没到期」「能不能办」全在内核，这里只转发。 */
import {
  advanceErrands, normalizeErrands, dateKeyOf as errandDateKeyOf
} from '../../config/errand-lifecycle.js';
import {
  markErrandDone, waiveErrand as waiveErrandCore, ackConsequence, createErrand as createErrandCore
} from '../../config/errand-actions.js';
import { monthRows, readErrands, writeErrands } from '../../config/errand-store.js';
import { ERRAND_STATES, ERRAND_KEY } from '../../config/errand-terms.js';
/* 页签归一（与 freehome / stickerdesk 同款：单页 App 只认兜底页 board） */
function toStr(v) { return String(v == null ? '' : v).trim(); }
export class AffairsApp {
    constructor(phoneShell, storage) {
        this.phoneShell = phoneShell;
        this.storage = storage;
        this.view = new AffairsView(this);
        this._lastAction = null; /* 最近一次内核归因（供诊断；不参与渲染数据） */
        this._hooked = false;    /* 生成前钩子只挂一次 */
        this._tab = 'board';     /* 单页 App 的兜底页签 */
    }
    /* ========== 读（现取现归一，不缓存 —— 换会话/删楼后缓存即陈旧） ========== */
    list() { return readAffairs(this.storage); }
    activeList() { return activeAffairs(this.list()); }
    find(id) { return findAffair(this.list(), id); }
    /* ========== 写（每一步都过内核判定；ok=false 时视图展示 why，不落账） ========== */
    create(raw) {
        const res = createAffair(this.list(), raw, Date.now());
        if (res.ok) writeAffairs(this.storage, res.list);
        this._lastAction = { op: 'create', ok: res.ok, why: res.why };
        return res;
    }
    transition(id, stage) {
        const res = transitionAffairStage(this.list(), id, stage, Date.now());
        if (res.ok) writeAffairs(this.storage, res.list);
        this._lastAction = { op: 'transition', ok: res.ok, why: res.why };
        return res;
    }
    appendAction(id, action) {
        const res = appendAffairAction(this.list(), id, action, Date.now());
        if (res.ok) writeAffairs(this.storage, res.list);
        this._lastAction = { op: 'appendAction', ok: res.ok, why: res.why };
        return res;
    }
    addDecision(id, text) {
        const res = appendAffairDecision(this.list(), id, text, Date.now());
        if (res.ok) writeAffairs(this.storage, res.list);
        this._lastAction = { op: 'addDecision', ok: res.ok, why: res.why };
        return res;
    }
    resolveDecision(id, text, resolvedBy, outcome) {
        const res = resolveAffairDecision(this.list(), id, text, resolvedBy, outcome, Date.now());
        if (res.ok) writeAffairs(this.storage, res.list);
        this._lastAction = { op: 'resolveDecision', ok: res.ok, why: res.why };
        return res;
    }
    addParticipants(id, names) {
        const res = addAffairParticipants(this.list(), id, names);
        if (res.ok) writeAffairs(this.storage, res.list);
        this._lastAction = { op: 'addParticipants', ok: res.ok, why: res.why };
        return res;
    }
    attachRef(id, ref) {
        const res = attachAffairRef(this.list(), id, ref);
        if (res.ok) writeAffairs(this.storage, res.list);
        this._lastAction = { op: 'attachRef', ok: res.ok, why: res.why };
        return res;
    }
    /* ========== [v4.114.0 · R13-X7] 「这个月要处理的」 ========== */
    /** 剧情当下（**只走 timeManager**；读不到返回 0，不拿墙钟顶替）。 */
    _storyMs() {
        try {
            const tm = this._win().VirtualPhone?.timeManager;
            if (!tm || typeof tm.getCurrentStoryTime !== 'function') return 0;
            const ms = Number(tm.getCurrentStoryTime()?.timestamp);
            return (Number.isFinite(ms) && ms > 0) ? ms : 0;
        } catch (_e) { return 0; }
    }

    /**
     * 本月读数（**每次现取 + 现推**）。
     *   推进不是一个后台计时器：本层没有定时任何东西，读一次就推一次，
     *   界面关了它就不跑——与本仓「手机关掉不该还在跑」同规。
     *   ★ 读不出就如实报：不把异常吞掉当「这个月没事」（两件事处置相反）。
     */
    monthFace() {
        const out = { rows: [], line: '', warn: '', state: '', nowMs: 0 };
        let raw = [];
        /* ★ 措意不走 `readErrands` 的「吞异常返回 []」：那一层是给视图兜底用的，
         *   ��里需要分辨「读不到（键不存在）」与「读不出来（存储抛了）」——
         *   两者的处置相反（前者是没事，后者是别当成没事）。 */
        try {
            const got = this.storage && typeof this.storage.get === 'function'
                ? this.storage.get(ERRAND_KEY, false) : null;
            raw = got ? normalizeErrands(typeof got === 'string' ? JSON.parse(got) : got) : [];
        } catch (_e) {
            out.state = 'unreadable';
            out.line = '读不出来（不等于这个月没事）';
            out.warn = '清单读不出来：这不等于「这个月没事」';
            return out;
        }
        const nowMs = this._storyMs();
        out.nowMs = nowMs;
        const adv = advanceErrands(raw, nowMs);
        /* 推进真的改了状态就当场写回；没变化不写（避免每次渲染都刷一次盘）。 */
        if (adv.expired.length) writeErrands(this.storage, adv.list);
        const monthKey = errandDateKeyOf(nowMs).slice(0, 7);
        out.rows = monthRows(adv.list, monthKey);
        out.state = 'ok';
        const pending = out.rows.filter((e) => e.state === ERRAND_STATES.pending).length;
        const expired = out.rows.filter((e) => e.state === ERRAND_STATES.expired).length;
        const done = out.rows.filter((e) => e.state === ERRAND_STATES.done).length;
        out.line = !nowMs
            ? '时间读不出来，到没到期判不了（' + out.rows.length + ' 条在清单上）'
            : ('待办 ' + pending + ' · 过期 ' + expired + ' · 已办 ' + done);
        if (adv.skipped.length) {
            out.warn = '有 ' + adv.skipped.length + ' 条到期日读不出，判不了到没到期（'
                + adv.skipped.map((s) => s.id).join('、') + '）—— 这不等于它们没过期';
        }
        return out;
    }

    /** 办掉（回执写进条目，不只在界面上说一句）。 */
    doErrand(id, note) {
        const res = markErrandDone(readErrands(this.storage), id, this._storyMs(), note);
        if (res.ok) writeErrands(this.storage, res.list);
        this._lastAction = { op: 'errand-done', ok: res.ok, why: res.why };
        return res;
    }

    /** 豁免（「这事不办」）。 */
    waiveErrand(id, note) {
        const res = waiveErrandCore(readErrands(this.storage), id, this._storyMs(), note);
        if (res.ok) writeErrands(this.storage, res.list);
        this._lastAction = { op: 'errand-waive', ok: res.ok, why: res.why };
        return res;
    }

    /** 承认后果（**只改一个布尔**，不扣钱）。 */
    ackErrand(id) {
        const res = ackConsequence(readErrands(this.storage), id);
        if (res.ok) writeErrands(this.storage, res.list);
        this._lastAction = { op: 'errand-ack', ok: res.ok, why: res.why };
        return res;
    }

    /** 新增一条（到期日与去处必填）。 */
    createErrand(raw) {
        const nowMs = this._storyMs();
        const res = createErrandCore(readErrands(this.storage), raw, nowMs || (Date.now()));
        if (res.ok) writeErrands(this.storage, res.list);
        this._lastAction = { op: 'errand-create', ok: res.ok, why: res.why };
        return res;
    }

    /** 清单整体读数（给诊断与生成侧；没有不产生空块）。 */
    errandPromptBlock() {
        try {
            const rows = this.monthFace().rows.filter((e) => e.state === ERRAND_STATES.pending);
            if (!rows.length) return '';
            const lines = rows.slice(0, 5).map((e) => '- ' + e.title + '（' + e.dueAt + '）');
            return '【这个月还欠着的事（手机事务台）】\n' + lines.join('\n');
        } catch (_e) { return ''; }
    }

    /** 内核归一原样转发（判据与诊断面用，不重写）。 */
    normalizeErrands(list) { return normalizeErrands(list); }

    /* ========== 投影（给视图/生成侧/其他 App 消费） ========== */
    /** 一件事的读数句（阶段/参与者/待决/最近动作各说各的）。 */
    summaryOf(id) {
        const aff = this.find(id);
        return aff ? affairSummaryLine(aff) : '没有这件事务（或形态读不出）';
    }
    /** 本幕材料：给 R6-O2 连续通信与记忆桥消费（引用不复制正文）。 */
    materialOf(id) {
        const aff = this.find(id);
        return aff ? affairMaterial(aff) : null;
    }
    /** 生成侧一致性块：进行中事务的读数（无内容返回 ''，不产生空块）。 */
    promptBlock() {
        try {
            const list = this.activeList();
            if (!list.length) return '';
            const lines = list.slice(0, 5).map((a) => affairSummaryLine(a));
            const head = '【进行中的事务（手机事务台）】\n' + lines.map((l) => '- ' + l).join('\n');
            /* [v4.114.0 · R13-X7] 「这个月还欠着的事」一并交给生成侧：
             *   它与进行中的事务是两层（一个是「进行到哪」，一个是「欠着什么」），
             *   压成一块会让角色把「缴费」读成「筹备已推进」。故各自成段、各自带标题。 */
            const errands = this.errandPromptBlock();
            return errands ? (head + '\n' + errands) : head;
        } catch (_e) { return ''; }
    }
    /** 自检（内核十项原样转发，本层不重判）。 */
    selfCheck() { return affairSelfCheck(); }
    /* ========== 页签（单页 App：只接受兜底页，投别的串等价于兜底 —— 与 tab-source 的 single 口径一致） ========== */
    setTab(tab) { this._tab = toStr(tab) || 'board'; }
    _win() {
        try { return (typeof window !== 'undefined') ? window : globalThis; } catch (_e) { return globalThis; }
    }
    /**
     * 挂生成前钩子（构造期一次；宿主无 eventSource 时静默不挂，不影响 App 本体）。
     *   只注入「进行中事务的读数句」，不注入任何源 App 正文 —— 与内核「只持引用不持正文」同源。
     */
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
     * 换会话：事务**本来就是会话私有**（前缀 ^aff_ 落 chatMetadata），
     *   故不持任何跨会话读数副本；这里只丢上一次动作归因（那是旧会话的判定）。
     */
    onChatChanged() {
        this._lastAction = null;
        this._tab = 'board';
    }
    /* ========== 宿主渲染 ========== */
    render(container) {
        this._initHook();
        const host = container
            || this.phoneShell?.layerHost?.('affairs-main')
            || this.phoneShell?.screen;
        this.view.render(host);
    }
}
export default AffairsApp;
