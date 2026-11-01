/* ========================================================
 * apps/wechat/inline-action-bar.js — [v4.113.0 · R13-X3] 消息下方的「就地办」动作条（纯旁路）
 * --------------------------------------------------------
 * 【为什么是旁路，而不是改 chat-view】`chat-view.js` 实测 946383 字符，是全仓最大文件，
 *   也是用户停留最久的地方。计划书 P8 给的施工约束是「新增旁路 + 不动原函数体」，
 *   本件把这条约束推到头：**chat-view.js 一个字节都不改**。
 *   做法是「消息渲染完成之后，在 DOM 上再挂一层」—— 结构变了、字号变了、气泡代码变了，
 *   动作条都不需要跟着改；而它一旦读错，最多是多出一块条子（用户关掉开关即可），
 *   不会把消息本身画坏。
 *
 * 【为什么挂在消息行**旁边**而不是里面】`.chat-message` 是 `display:flex`（头像 + 气泡并排）。
 *   动作条塞进行内会变成「气泡右边多一截按钮」，还会被 `message-right` 的 `flex-end`
 *   推到对面去。挂在行**之后**（同一父容器的下一个兄弟）才能真的「在消息下方」。
 *   代价是它不再随消息行一起被删 —— 所以每次重画都先把自己摘干净（`_clearNodes`）。
 *
 * 【为什么用 MutationObserver 而不是回调钩子】`smartUpdateMessages` 一条路径有 9 处调用方
 *   （发送 / 收到 / 重 roll / 刷新 / 音乐联动 …），挨个插钩子等于改 chat-view 的六个函数体。
 *   观察容器子节点变化是**零侵入**的：谁画的、怎么画的都不必知道。
 *   自触发的坑写在 `_applying` 上：本件自己的增删同样会触发观察回调，必须屏掉，
 *   否则「渲染 → 观察 → 再渲染」会打成死循环。
 *
 * 【三条纪律】
 *   ① **只在有候选时出条**：没有候选的消息下方不许多出一块空白（那是「看起来没坏但显示不对」）；
 *   ② **关掉开关后行为逐字一致**：开关关 ⇒ 本件立即摘掉自己挂过的所有节点，
 *      且不往 DOM 写任何东西；
 *   ③ **不替你发消息**：reply 档只把草稿填进输入框，一个字节都不写盘。
 *
 * 【它不重算任何一格】候选来自 `config/inline-action.js`，提交与撤销来自
 *   `config/inline-action-commit.js`。本件只做三件事：找 DOM 位置、事件委托、把读数写上去。
 * ======================================================== */
'use strict';
import {
    INLINE_ACTION_STATES, INLINE_ACTION_LABEL, INLINE_ACTION_TOGGLE, INLINE_ACTION_LIMITS
} from '../../config/inline-action-terms.js';
import { scanMessage } from '../../config/inline-action.js';
import { commitAction, undoCommit } from '../../config/inline-action-commit.js';

/** 样式只注一次（本件是唯一主人，不往 wechat-app 的巨大样式串里再塞一截）。 */
const STYLE_ID = 'inline-action-bar-style';
const STYLE_TEXT = [
    '.ia-stack{display:flex;flex-direction:column;gap:2px;margin:-8px 0 10px 6px;padding-left:46px;}',
    '.ia-bar{display:flex;flex-wrap:wrap;gap:6px;align-items:center;padding:2px 0;}',
    '.ia-btn{font-size:12px;line-height:1;padding:5px 10px;border-radius:12px;',
    'border:1px solid #d8dde3;background:#f7f9fb;color:#3a4a5a;cursor:pointer;font-family:inherit;}',
    '.ia-btn:active{background:#e9eef3;}',
    '.ia-why{font-size:11px;color:#8a97a5;}',
    '.ia-receipt{font-size:11px;color:#4a7a52;}',
    '.ia-fail{font-size:11px;color:#a2453c;}'
].join('');

function injectStyle(doc) {
    if (!doc || !doc.head) return;
    if (typeof doc.getElementById === 'function' && doc.getElementById(STYLE_ID)) return;
    const el = doc.createElement('style');
    el.id = STYLE_ID;
    el.textContent = STYLE_TEXT;
    doc.head.appendChild(el);
}

/** 消息行的「我发的」判定（三个字段任一成立都算：老数据字段名不统一）。 */
function isMine(msg) {
    if (!msg || typeof msg !== 'object') return false;
    return msg.from === 'me' || msg.isMe === true || msg.sender === 'user';
}

export class InlineActionBar {
    constructor(wechatApp) {
        this.app = wechatApp;
        /* 办过的动作：msgId → 结果（供「撤销」按钮与回执重画用）。
         *   ★ 只留内存：一条消息上办过什么，跨会话没有意义，写盘反而会变成一份陈账。 */
        this._done = new Map();
        this._noteOf = new Map();
        this._bound = null;
        this._onClick = null;
        this._observer = null;
        this._observed = null;
        this._pending = false;
        this._applying = false;
        /* 上一次算好的签名与条数：DOM 已经长成这样就不再动手（防死循环）。 */
        this._sig = '';
        this._drawn = 0;
    }

    /** 开关在不在（读不出盘 ⇒ 按默认值走，不把「读不出」当成「关」）。 */
    enabled() {
        const st = this._storage();
        if (!st || typeof st.get !== 'function') return INLINE_ACTION_TOGGLE.defaultOn;
        let raw = null;
        try { raw = st.get(INLINE_ACTION_TOGGLE.key); } catch (_e) { raw = null; }
        if (raw === null || raw === undefined || raw === '') return INLINE_ACTION_TOGGLE.defaultOn;
        return !(raw === false || raw === 'false' || raw === 0 || raw === '0');
    }

    /** 开关唯一写口（设置页只调它，不自己碰存储键）。 */
    setEnabled(on) {
        const st = this._storage();
        if (!st || typeof st.set !== 'function') return false;
        const v = on !== false;
        try { st.set(INLINE_ACTION_TOGGLE.key, v); } catch (_e) { return false; }
        /* 关掉要立即摘干净；打开要立即长出来 —— 用户不该为了看效果再切一次页面。 */
        this.mount();
        return true;
    }

    _storage() {
        const g = this._win();
        return (g && g.VirtualPhone && g.VirtualPhone.storage) || this.app?.storage || null;
    }

    _win() {
        return (typeof window !== 'undefined') ? window : globalThis;
    }

    /** 剧情当下（**只走 timeManager**，不自己 Date.now 当剧情时刻）。 */
    _storyMs() {
        const vp = this._win()?.VirtualPhone || null;
        const tm = vp ? vp.timeManager : null;
        if (!tm || typeof tm.getCurrentStoryTime !== 'function') return 0;
        let face = null;
        try { face = tm.getCurrentStoryTime(); } catch (_e) { return 0; }
        const ms = Number(face && face.timestamp);
        return (Number.isFinite(ms) && ms > 0) ? ms : 0;
    }

    /** 当前会话的尾部消息（只扫尾部：动作条是「刚说的那句」上的东西）。 */
    _tailMessages() {
        const app = this.app;
        const chatId = String(app?.currentChat?.id || '').trim();
        if (!chatId) return [];
        let list = [];
        try { list = app.wechatData.getMessages(chatId) || []; } catch (_e) { list = []; }
        if (!Array.isArray(list)) return [];
        const cap = INLINE_ACTION_LIMITS.maxScanMsgs;
        return list.length > cap ? list.slice(list.length - cap) : list;
    }

    /** 扫描：msgId → 候选动作数组（只为「有候选」的消息建表）。 */
    _candidates() {
        const now = { storyMs: this._storyMs() };
        const out = new Map();
        for (const msg of this._tailMessages()) {
            /* 自己发的不给动作条：那句是「我」说的，给自己加日程不是这个功能的意图。 */
            if (isMine(msg)) continue;
            const r = scanMessage(msg, now);
            if (r.state !== INLINE_ACTION_STATES.ok || !r.actions.length) continue;
            out.set(String(msg.id || ''), r.actions);
        }
        return out;
    }

    /** 找消息容器（**不缓存在实例上**：每次打开 App 都是新 DOM）。 */
    _container() {
        const doc = this._win()?.document;
        if (!doc) return null;
        const scoped = doc.querySelector('.phone-view-current #chat-messages');
        return scoped || doc.querySelector('#chat-messages') || null;
    }

    _rows(box) {
        if (!box || typeof box.querySelectorAll !== 'function') return [];
        const list = box.querySelectorAll('.chat-message[data-message-id]');
        return list ? Array.prototype.slice.call(list) : [];
    }

    /**
     * 挂上去（消息渲染完成后调；也可以由宿主在每次 render 后调）。
     * 开关关 ⇒ 摘掉自己挂过的节点并**直接返回 0**（不往 DOM 写任何东西）。
     * @returns {number} 这一轮长出来的动作条条数（0 = 一条都没有 / 开关关 / 没容器）
     */
    mount() {
        const n = this._refreshAll();
        this._watch();
        return n;
    }

    /** 摘掉本件挂过的所有节点（**只删自己的**：消息本身一个不动）。 */
    unmount() {
        this._unwatch();
        this._applying = true;
        try { this._clearNodes(); this._sig = ''; this._drawn = 0; } finally { this._applying = false; }
    }

    /**
     * 星号对账（**防死循环的关键**）。
     * 为何不靠 `_applying` 就够：MutationObserver 的回调是**异步微任务**——
     *   我们插完节点时 `_applying` 已经改回 false，回调进来时它根本篡不到。
     *   于是「插入 → 观察 → 再插入」每一帧都重跑一次，页面永远在重画。
     *   正确的停手条件是「**DOM 已经长成该长的样子**」，而不是「刚才是不是我在写」。
     *   两侧各算一临时签名（计划 vs DOM），一样就不动手。
     */
    _scheduleOf(cands, box) {
        const plan = [];
        for (const row of this._rows(box)) {
            const mid = String(row.getAttribute('data-message-id') || '');
            const actions = cands.get(mid);
            if (!actions || !actions.length) continue;
            plan.push({ row: row, mid: mid, actions: actions });
        }
        return plan;
    }

    _planSig(plan) {
        const parts = [];
        for (const p of plan) {
            const kinds = p.actions.map((a) => String(a.kind || '')).join(',');
            const done = this._done.has(p.mid) ? '+' : '-';
            const note = this._noteOf.has(p.mid) ? '!' : '.';
            parts.push(p.mid + ':' + kinds + done + note);
        }
        return parts.join('|');
    }

    /** DOM 这一刻长啥样（只认本件自己的节点，消息一个字节不看）。 */
    _domSig(box) {
        if (!box || typeof box.querySelectorAll !== 'function') return '';
        const stacks = box.querySelectorAll('.ia-stack');
        const parts = [];
        for (const stack of Array.prototype.slice.call(stacks || [])) {
            const mid = String(stack.getAttribute('data-ia-for') || '');
            const bars = stack.querySelectorAll('.ia-bar');
            const kinds = Array.prototype.slice.call(bars || [])
                .map((b) => String(b.getAttribute('data-ia-kind') || '')).join(',');
            const hasNote = stack.querySelectorAll('.ia-receipt, .ia-fail');
            const done = stack.querySelectorAll('[data-ia-undo]').length ? '+' : '-';
            const note = (hasNote && hasNote.length) ? '!' : '.';
            parts.push(mid + ':' + kinds + done + note);
        }
        return parts.join('|');
    }

    /** 核心：重画一层（先算计划，再比签名，不一样才动 DOM）。 */
    _refreshAll() {
        const doc = this._win()?.document;
        const box = this._container();
        this._applying = true;
        try {
            if (!doc || !box) { this._clearNodes(); this._sig = ''; return 0; }
            if (!this.enabled()) { this._clearNodes(); this._sig = ''; return 0; }
            const plan = this._scheduleOf(this._candidates(), box);
            const sig = this._planSig(plan);
            if (sig === this._domSig(box)) { this._sig = sig; return this._drawn; }
            this._clearNodes();
            if (!sig) { this._sig = ''; this._drawn = 0; return 0; }
            injectStyle(doc);
            let n = 0;
            for (const p of plan) {
                const stack = doc.createElement('div');
                stack.className = 'ia-stack';
                stack.setAttribute('data-ia-for', p.mid);
                for (const act of p.actions) {
                    stack.appendChild(this._renderBar(doc, p.mid, act));
                    n += 1;
                }
                const note = this._noteOf.get(p.mid);
                if (note) stack.appendChild(this._renderNote(doc, note.text, note.ok));
                /* 挂在消息行**之后**：`.chat-message` 是 flex 行，挂进去会排到头像旁边。 */
                const parent = p.row.parentNode;
                if (!parent || typeof parent.insertBefore !== 'function') continue;
                parent.insertBefore(stack, p.row.nextSibling || null);
            }
            this._sig = sig;
            this._drawn = n;
            if (n) this._bindOnce(box);
            return n;
        } finally {
            this._applying = false;
        }
    }

    _clearNodes() {
        const doc = this._win()?.document;
        if (!doc || typeof doc.querySelectorAll !== 'function') return;
        const marks = ['.ia-stack', '.ia-bar', '.ia-receipt', '.ia-fail'];
        for (const sel of marks) {
            const list = doc.querySelectorAll(sel);
            if (!list) continue;
            for (const el of Array.prototype.slice.call(list)) {
                if (el && typeof el.remove === 'function') el.remove();
            }
        }
    }

    /** 观察容器变化（**零侵入**：不钩 chat-view 的任何一个函数）。 */
    _watch() {
        const box = this._container();
        if (!box) return;
        if (this._observed === box && this._observer) return;
        this._unwatch();
        const MO = this._win()?.MutationObserver;
        if (typeof MO !== 'function') return;
        try {
            this._observer = new MO(() => {
                if (this._applying || this._pending) return;
                this._pending = true;
                const run = () => { this._pending = false; this._refreshAll(); };
                const raf = this._win()?.requestAnimationFrame;
                if (typeof raf === 'function') raf(run);
                else if (typeof setTimeout === 'function') setTimeout(run, 0);
                else run();
            });
            this._observer.observe(box, { childList: true, subtree: true });
            this._observed = box;
        } catch (_e) { this._observer = null; this._observed = null; }
    }

    _unwatch() {
        try { this._observer?.disconnect?.(); } catch (_e) { /* 摘不掉不影响消息本身 */ }
        this._observer = null;
        this._observed = null;
        this._pending = false;
    }

    _bindOnce(box) {
        if (this._bound === box) return;
        if (this._bound && this._onClick && typeof this._bound.removeEventListener === 'function') {
            this._bound.removeEventListener('click', this._onClick);
        }
        this._onClick = (e) => this._handleClick(e);
        this._bound = box;
        if (typeof box.addEventListener === 'function') box.addEventListener('click', this._onClick);
    }

    _renderBar(doc, msgId, act) {
        const bar = doc.createElement('div');
        bar.className = 'ia-bar';
        bar.setAttribute('data-ia-msg', msgId);
        bar.setAttribute('data-ia-kind', String(act.kind || ''));
        const why = doc.createElement('span');
        why.className = 'ia-why';
        /* 为什么给它：计划书要求每条都能看出为什么被命中（不写 why 等于没理由）。 */
        why.textContent = String(act.why || '');
        bar.appendChild(why);
        const done = this._done.get(msgId);
        const btn = doc.createElement('button');
        btn.type = 'button';
        btn.className = 'ia-btn';
        if (done && done.ok) {
            /* 已办：同一位置换成「撤销」（一个按钮两态，界面不写第二份判定）。 */
            btn.setAttribute('data-ia-undo', msgId);
            btn.textContent = INLINE_ACTION_LABEL.undo;
        } else {
            btn.setAttribute('data-ia-do', msgId);
            btn.setAttribute('data-ia-action', String(act.kind || ''));
            btn.textContent = INLINE_ACTION_LABEL[String(act.kind || '')] || String(act.kind || '');
        }
        bar.appendChild(btn);
        return bar;
    }

    _renderNote(doc, text, ok) {
        const note = doc.createElement('div');
        note.className = ok ? 'ia-receipt' : 'ia-fail';
        note.textContent = String(text || '');
        return note;
    }

    _handleClick(e) {
        const t = e && e.target;
        if (!t || typeof t.getAttribute !== 'function') return;
        const undoId = t.getAttribute('data-ia-undo');
        if (undoId) { this._undo(undoId); return; }
        const doId = t.getAttribute('data-ia-do');
        if (doId) this._commit(doId, t.getAttribute('data-ia-action'));
    }

    /** 取出那一条的候选（按 kind 定位：一条消息上可能同时摆着好几个档）。 */
    _actionOf(msgId, kind) {
        const actions = this._candidates().get(String(msgId)) || [];
        for (const a of actions) {
            if (String(a.kind) === String(kind)) return a;
        }
        return null;
    }

    /** 写一条回执（**记在实例里**：重画之后它还得在，不然用户看不到办没办成）。 */
    _note(msgId, text, ok) {
        this._noteOf.set(String(msgId), { text: String(text || ''), ok: ok === true });
    }

    _calendarData() {
        const vp = this._win()?.VirtualPhone || null;
        const cal = vp?.calendarApp || vp?._calendarReminderApp || null;
        return cal ? cal.calendarData : null;
    }

    _commit(msgId, kind) {
        const act = this._actionOf(msgId, kind);
        if (!act) return null;
        const chat = this.app?.currentChat || {};
        const storyMs = this._storyMs();
        const res = commitAction(act, {
            calendarData: this._calendarData(),
            nowMs: storyMs,
            chatName: String(chat.name || ''),
            atMs: storyMs
        });
        /* reply 档：把草稿**填进输入框**，不发（发不发是用户那一步）。 */
        if (res.ok && res.draft) this._fillDraft(res.draft);
        if (res.ok) this._done.set(String(msgId), res);
        /* 写不出来时说清哪一步没成 —— 不把「没写成」说成「已经写进去」。 */
        this._note(msgId, res.ok ? res.receipt : ('没办成：' + String(res.why || '')), res.ok);
        this._refreshAll();
        return res;
    }

    _undo(msgId) {
        const done = this._done.get(String(msgId));
        if (!done || !done.ok) return { ok: false, why: 'nothing-to-undo' };
        const res = undoCommit(done, { calendarData: this._calendarData() });
        if (res.ok) this._done.delete(String(msgId));
        this._note(msgId, res.ok
            ? '已撤销（那条日程进了回收站，可在设置里恢复）'
            : ('撤销没成：' + String(res.why || '')), res.ok);
        this._refreshAll();
        return res;
    }

    /** 把草稿填进输入框（**不发**；也不覆盖用户已经打了一半的字）。 */
    _fillDraft(text) {
        const doc = this._win()?.document;
        if (!doc) return false;
        const input = doc.querySelector('.phone-view-current #chat-input') || doc.querySelector('#chat-input');
        if (!input) return false;
        const cur = String(input.value || '');
        if (cur.trim()) return false;
        input.value = String(text || '');
        return true;
    }
}

