/* ========================================================
 * creationdesk-app.js — [v3.90.0 · 拓展计划 R-X6]
 *   素材到发布的完整创作工作台 · 落盘与接线
 *
 * 【本件刻意不做的事（验收③④的落点）】
 *   · **不发布**：本件没有 addMoment / publishUserPost / createNovel 的任何直接调用；
 *     发布动作一律交咽喉的 cwInvokeOwner（那里才认目标 App 的**真源写口**）。
 *   · **不造第二份草稿/素材状态**：素材清单与草稿读数全部读咽喉缓存（`_creationWorkbench`），
 *     草稿本身走 creation-pipeline 的同一个幂等键。
 *   · **不自己判**：能不能发布全由内核 cwPlanPublish 判；本件只把意图交上去
 *     —— 重判就是同一口径两份实现。
 *   · **不执行任意用户 JS**：素材与目标是**数据**，没有脚本编辑器。
 * ========================================================= */
'use strict';
import { cwPlanLine, cwSelfCheck, CW_STEPS } from '../../config/creation-workbench.js';
import { CreationdeskView } from './creationdesk-view.js';
/* [v4.17.0 · R4-O5] 编辑缓冲(纯函数)。本层只转交:归一与三态判定全在那件里,
 *   **已发布不许被覆盖这条红线也由它守**(本层不自己判一份)。 */
import {
    editBufferKey, normalizeEditBuffer, editBufferState,
    editRecoveryPlan, applyRecoveryChoice, afterSaveAttempt
} from '../../config/edit-buffer.js';
import { writeReceipt } from '../../config/write-receipt.js';
/* [v4.30.0 · R4-X9] 取材板接线件（夹在契约件与视图之间：取数 / 持起点 / 落点形状）。
 *   本层只转交：任务轴与面优先级、矛盾取代、两条闸、缺口计数**全归上游**，
 *   手机侧只做取舍与目标选择（选人物 / 地点 / 时点 / 写作目标）。 */
import { CreationdeskBoard } from './creationdesk-board.js';
/* [v4.25.0 · R4-X3] 故事年鉴(纯契约)。
 *   创作台侧只消费**两件**:① 年鉴面读数(建章册一行 + 派发相);
 *   ② 把某一版年鉴导出文本取来当**草稿素材**(不把它写进剧情事实,也不发布)。
 *   去剧透/编辑/过期判定全在阅读侧与上游,本件不另写第二份口径。 */
import {
    saOutletProbe, planSaOutlet, readAnnualBuild, readingVersionOf, exportTextOf,
    bookLine
} from '../../config/story-annual-contract.js';

export class CreationdeskApp {
    constructor(shell, storage) {
        this.shell = shell || null;
        this.storage = storage || null;
        this._view = null;
        this._pickRef = '';
        this._target = '';
        this._sensitive = false;
        this._note = '';
        this._draftKey = '';
        this._draftNote = '';
        this._multiTargets = [];
        /* [v4.02.0 · R3-X4] 话题交互态：事件键 / 平台 / 文本 / 最近一次话题页读数 */
        this._topicEvent = '';
        this._topicPlatform = '';
        this._topicText = '';
        this._topicPage = null;
        /* [v4.30.0 · R4-X9] 取材板接线件（持用户的**选择**，不缓存读数） */
        this._board = new CreationdeskBoard(this);
        this._flash = '';
        this._flashBad = false;
    }
    /* ---------- 读数：只取，不判 ---------- */
    host() {
        try {
            const vp = (typeof window !== 'undefined') ? window.VirtualPhone : null;
            return (vp && typeof vp.creationWorkbenchFace === 'function') ? vp.creationWorkbenchFace() : null;
        } catch (_e) { return null; }
    }
    /* ══════════ [v4.25.0 · R4-X3] 故事年鉴（创作台侧：取材，不改事实） ══════════
     * 【为什么创作台要读它】计划落点原文：「reading + creationdesk……编辑文稿、导出本地可读文件」。
     *   年鉴是**文稿**，创作台的职责就是把稿子变成可用的素材 —— 这里取它的导出文本当草稿素材。
     * 【不做什么】不写剧情事实、不发布、不自己判去剧透（那一律走上游 + 阅读侧）。
     * ------------------------------------------------------------------ */
    /** 宿主 window（读上游插件句柄用；无头环境降级成 globalThis）。 */
    _hostWin() {
        try { return (typeof window !== 'undefined') ? window : globalThis; } catch (_e) { return globalThis; }
    }
    /** 年鉴面读数（建章册一行 + 派发相；出口名只在契约件里出现）。 */
    annualFace() {
        const probe = saOutletProbe(this._hostWin());
        const book = readAnnualBuild(this._hostWin(), null, {});
        let line = '';
        try { line = bookLine(book); } catch (_e) { line = '年鉴读数读不到（不假装为 0 章）'; }
        return { probe: probe, outlet: planSaOutlet(probe.hasBuild, probe.hasEdit), book: book, line: line };
    }
    /** 年鉴一行读数（视图借用；判据全在内核 `bookLine`）。 */
    annualLine() {
        try { return String(this.annualFace().line || ''); }
        catch (_e) { return '年鉴读数读不到（不假装为 0 章）'; }
    }
    /** 取一份年鉴草稿素材（按本机进度裁阅读版；**只返回文本，不写任何键**）。 */
    annualDraftMaterial(opts) {
        const o = (opts && typeof opts === 'object') ? opts : {};
        const book = readAnnualBuild(this._hostWin(), null, {});
        const all = (book && Array.isArray(book.chapters)) ? book.chapters : [];
        if (!all.length) return { ok: false, text: '', line: bookLine(book) };
        const ver = readingVersionOf(all, { readThrough: o.readThrough });
        const text = exportTextOf(ver, { bookTitle: o.bookTitle || '故事年鉴', versionLabel: o.versionLabel || '' });
        return { ok: true, text: text, line: (bookLine(book) + ' · 取稿 ' + String(text.length) + ' 字') };
    }
    /* ---------- 交互：全部转咽喉 ---------- */
    setPick(ref) { this._pickRef = String(ref || ''); this.render(); return this._pickRef; }
    setTarget(t) { this._target = String(t || ''); this.render(); return this._target; }
    setSensitive(on) { this._sensitive = on === true; this.render(); return this._sensitive; }
    setNote(note) { this._note = String(note || ''); return this._note; }
    /* ---------- [v4.01.0 · R3-O8] 草稿本交互 ---------- */
    /** 选中一份草稿：同时把它的文案装进编辑框（用户看到的就是这一份的文字）。 */
    setDraft(key) {
        this._draftKey = String(key || '');
        const d = this._draftOf(this._draftKey);
        this._draftNote = d ? d.note : '';
        this.render();
        return this._draftKey;
    }
    /* ---------- [v4.17.0 · R4-O5] 编辑缓冲:半成品不再随页面/刷新/切会话丢掉 ---------- */
    /**
     * 写一份半成品缓冲。**节流 400ms**:每次敲键都同步写盘会把本机存储当高频落盘器用。
     *   节流丢的是**最后 400ms** 的输入,而那段会在下一次点击/关闭时补上。
     * @returns {{ok:boolean, key:string, why:string}}
     */
    saveEditBuffer(target) {
        /* 键名**逐字常量**:keys 门的抽取器认 `const XXX = 'edit_buffer_...'` 这一形态。 */
        const EDIT_BUFFER_KEY = 'edit_buffer_creationdeskApp';
        const key = EDIT_BUFFER_KEY;
        if (editBufferKey('creationdeskApp') !== key) {
            return { ok: false, key: key, why: 'key-drift(键名与真源不一致)' };
        }
        const now = (typeof Date.now === 'function') ? Date.now() : 0;
        if (this._bufLastAt && now && now - this._bufLastAt < 400) {
            return { ok: true, key: key, why: 'throttled' };
        }
        this._bufLastAt = now;
        const pack = normalizeEditBuffer({
            text: this._draftNote, caret: 0,
            target: String(target || this._target || ''),
            version: 1, published: false
        });
        /* 空缓冲**不写盘**(写一份空的等于把已存的顶掉)。 */
        if (!pack.hasText) return { ok: false, key: key, why: 'empty-not-written' };
        try {
            const w = writeReceipt(this.storage, key, JSON.stringify({
                text: pack.text, caret: pack.caret, target: pack.target,
                version: pack.version, published: pack.published, chatId: this._chatId()
            }));
            return { ok: !!(w && w.saved === true), key: key, why: (w && w.why) || '' };
        } catch (_e) { return { ok: false, key: key, why: 'write-threw' }; }
    }
    /** 本会话身份(取不到返回空串;纯函数对空串与空串判「同一段」)。 */
    _chatId() {
        try { return String(this.storage?.currentConversationId || ''); } catch (_e) { return ''; }
    }
    /** 读回缓冲(**只读,不判**;三态判定交给 `decideRecovery`)。 */
    loadEditBuffer() {
        const key = 'edit_buffer_creationdeskApp';
        let raw = undefined;
        try { raw = this.storage?.get?.(key, undefined); } catch (_e) { raw = undefined; }
        if (raw === undefined || raw === null || raw === '') return null;
        let obj = raw;
        if (typeof raw === 'string') {
            try { obj = JSON.parse(raw); } catch (_e) { return null; }
        }
        return (obj && typeof obj === 'object') ? obj : null;
    }
    /**
     * 恢复判定(**只判,不改任何东西**):给出三态与可选处置。
     *   ★ **默认什么都不动**(keep-editing)—— 验收原文要求「恢复旧缓冲需选择,不自动覆盖」。
     */
    decideRecovery() {
        const buf = this.loadEditBuffer();
        const saved = { text: String(this._draftNote || ''), published: false };
        return editRecoveryPlan(buf, saved);
    }
    /** 采纳某个恢复选择(写盘/清盘都由这里做;**纯函数只算不写**)。 */
    applyRecovery(choice) {
        const buf = this.loadEditBuffer();
        const saved = { text: String(this._draftNote || ''), published: false };
        const r = applyRecoveryChoice(choice, buf, saved);
        const key = 'edit_buffer_creationdeskApp';
        if (r.ok && r.applied === 'drop-buffer') {
            try { this.storage?.set?.(key, ''); } catch (_e) { /* 清不掉不影响结论 */ }
        }
        if (r.ok && r.applied === 'restore-buffer' && r.buffer && r.buffer.text !== null) {
            this._draftNote = String(r.buffer.text);
            this.render();
        }
        return r;
    }
    /** 保存回执 → 缓冲处置(**失败必须保留文字**;成功才清)。 */
    settleSave(receipt) {
        const buf = this.loadEditBuffer();
        const r = afterSaveAttempt(receipt, buf);
        const key = 'edit_buffer_creationdeskApp';
        if (r.state === 'saved') {
            try { this.storage?.set?.(key, ''); } catch (_e) { /* 清不掉不影响结论 */ }
        }
        this._lastSaveState = r.state;
        return r;
    }
    setDraftNote(note) { this._draftNote = String(note || ''); return this._draftNote; }
    /** 多目标勾选：一个目标一份稿，勾几个就编排几份（**不互覆盖**）。 */
    toggleMultiTarget(t) {
        const v = String(t || '').trim();
        if (!v) return this._multiTargets.slice();
        const i = this._multiTargets.indexOf(v);
        if (i >= 0) this._multiTargets.splice(i, 1);
        else this._multiTargets.push(v);
        this.render();
        return this._multiTargets.slice();
    }
    _draftOf(key) {
        const host = this.host();
        const items = (host && host.drafts && host.drafts.items) || [];
        for (const d of items) if (d.key === String(key || '')) return d;
        return null;
    }
    /** 四个草稿动作统一入口（视图只调这个，不直连咽喉）。 */
    async draftAct(action) {
        const vp = (typeof window !== 'undefined') ? window.VirtualPhone : null;
        if (!vp || typeof vp.applyCreationdeskAction !== 'function') {
            this._flash = '创作工作台入口不在位（咽喉未就绪）';
            this._flashBad = true;
            this.render();
            return { ok: false, note: this._flash };
        }
        const face = this._displayedFace;
        const payload = {
            action: action,
            ref: this._pickRef,
            target: this._target,
            targets: this._multiTargets.slice(),
            key: this._draftKey,
            note: this._draftNote,
            scope: face && face.scope,
            token: face && face.token,
        };
        let r;
        try { r = await vp.applyCreationdeskAction(payload); }
        catch (e) { r = { ok: false, note: '执行失败：' + String(e.message || e) }; }
        const now = this.host();
        if (now && (now.token !== payload.token)) return r;
        this._flash = String((r && r.note) || '');
        this._flashBad = !(r && r.ok === true);
        if (r && r.ok === true && r.key) this._draftKey = String(r.key);
        this.render();
        return r;
    }
    /* ---------- [v4.02.0 · R3-X4] 话题页交互 ---------- */
    setTopicEvent(id) { this._topicEvent = String(id || '').trim(); this.render(); return this._topicEvent; }
    setTopicPlatform(pl) { this._topicPlatform = String(pl || '').trim(); return this._topicPlatform; }
    setTopicText(t) { this._topicText = String(t || ''); return this._topicText; }
    /**
     * 话题动作统一入口（与 draftAct 同范式：只转咽喉，不直连、不发布）。
     * @param {string} sub record / page / react / debunk
     * @param {object} [extra] 额外参数（如 actor / knows / kind / confirmed）
     */
    async topicAct(sub, extra) {
        const vp = (typeof window !== 'undefined') ? window.VirtualPhone : null;
        if (!vp || typeof vp.applyCreationdeskAction !== 'function') {
            this._flash = '创作工作台入口不在位（咽喉未就绪）';
            this._flashBad = true;
            this.render();
            return { ok: false, note: this._flash };
        }
        const face = this._displayedFace;
        const ex = (extra && typeof extra === 'object') ? extra : {};
        const payload = {
            action: 'topic',
            topic: sub,
            rootEventId: this._topicEvent,
            platform: this._topicPlatform,
            text: this._topicText,
            kind: ex.kind || 'publish',
            confirmed: ex.confirmed === true,
            actor: ex.actor || '',
            knows: ex.knows === true,
            knowsWhy: ex.knowsWhy || '',
            scope: face && face.scope,
            token: face && face.token,
        };
        if (sub === 'record' || sub === 'debunk') {
            payload.id = String(this._topicPlatform || 'local') + '_' + String(Date.now().toString(36));
            payload.by = 'user';
        }
        let r;
        try { r = await vp.applyCreationdeskAction(payload); }
        catch (e) { r = { ok: false, note: '执行失败：' + String(e.message || e) }; }
        const now = this.host();
        if (now && (now.token !== payload.token)) return r;
        if (r && r.ok === true && r.page) this._topicPage = r.page;
        this._flash = String((r && r.note) || '');
        this._flashBad = !(r && r.ok === true);
        this.render();
        return r;
    }
    /* ══════════ [v4.30.0 · R4-X9] 面向下一幕的写作取材板 ══════════
     * 【为什么创作台要读它】计划落点原文：「creationdesk 复用 context-compose / 注入预算 owner；
     *   M4-X8 负责按任务组织事实，手机负责取舍和目标选择。引用动态重取，不存第二套世界状态。」
     * 【不做什么】不装配材料池、不裁到 token、不落笔 —— 全归既有 owner（本层零写盘）。
     * ------------------------------------------------------------------ */
    /** 取材板四路读数一次取齐（视图借用；判定全在契约件）。 */
    boardPack(opts) {
        try { return this._board.packAll(opts); }
        catch (_e) {
            return { read: null, sheet: null, held: null, pick: null, lines: { pack: '取材:读数失败（已降级）', sheet: '逐面:读数失败（已降级）', held: '被挡住:读数失败（已降级）', pick: '选定:读数失败（已降级）' }, gate: null, note: '', task: '', asOf: null, picked: [], state: '' };
        }
    }
    /** 取材板一行主读数（视图借用；判据全在内核 `packLine`）。 */
    boardLine() {
        try { return String(this.boardPack().lines.pack || ''); }
        catch (_e) { return '取材:读数失败（已降级）'; }
    }
    /** 选下一幕任务（**用户显式选择**；空值即清空，不回落成「推进」）。 */
    setBoardTask(t) { const r = this._board.setTask(t); this.render(); return r; }
    /** 选时点（楼层号；空值即清空，**不默认挑一个**）。 */
    setBoardAsOf(v) { const r = this._board.setAsOf(v); this.render(); return r; }
    /** 勾 / 取消勾一条取材（视图不自己记；勾了但不在包里的如实进 notInPack）。 */
    toggleBoardPicked(id) { const r = this._board.togglePicked(id); this.render(); return r; }
    /** 取材板交接读数（**只算并端出**：进主聊天 / 进草稿归既有 owner）。 */
    boardHandoff() {
        try { return this._board.handoff(); }
        catch (_e) { return { ok: false, kind: 'material_board_handoff', reason: 'threw', ids: [], count: 0, chars: 0, items: [], notInPack: [], afterAsOf: [], writesNothing: true }; }
    }
    /* ========== 取材板标签出口（界面文案的唯一出处 = 内核表，本层只转发） ========== */
    boardTaskIds() { try { return this._board.taskIds(); } catch (_e) { return []; } }
    boardTaskLabel(t) { try { return this._board.taskLabel(t); } catch (_e) { return String(t == null ? '' : t); } }
    boardHeldBucketIds() { try { return this._board.heldBucketIds(); } catch (_e) { return []; } }
    boardHeldBucketLabel(b) { try { return this._board.heldBucketLabel(b); } catch (_e) { return String(b == null ? '' : b); } }
    boardPickHeldIds() { try { return this._board.pickHeldIds(); } catch (_e) { return []; } }
    boardPickHeldLabel(b) { try { return this._board.pickHeldLabel(b); } catch (_e) { return String(b == null ? '' : b); } }
    boardStateHint(s) { try { return this._board.stateHint(s); } catch (_e) { return ''; } }
    boardLimits() { try { return this._board.limits(); } catch (_e) { return {}; } }
    /** 取消取材（**不触发生成**；验收②）。 */
    cancelBoard() { const r = this._board.cancel(); this.render(); return r; }
    async act(action) {
        const vp = (typeof window !== 'undefined') ? window.VirtualPhone : null;
        if (!vp || typeof vp.applyCreationdeskAction !== 'function') {
            this._flash = '创作工作台入口不在位（咽喉未就绪）';
            this._flashBad = true;
            this.render();
            return { ok: false, note: this._flash };
        }
        const face = this._displayedFace;
        const scope = face && face.scope;
        const token = face && face.token;
        const payload = {
            action: action,
            ref: this._pickRef,
            target: this._target,
            sensitive: this._sensitive,
            note: this._note,
            scope: scope,
            token: token,
        };
        let r;
        try { r = await vp.applyCreationdeskAction(payload); }
        catch (e) { r = { ok: false, note: '执行失败：' + String(e.message || e) }; }
        const now = this.host();
        if (now && (now.token !== token || JSON.stringify(now.scope) !== JSON.stringify(scope))) return r;
        this._flash = String((r && r.note) || '');
        this._flashBad = !(r && r.ok === true);
        this.render();
        return r;
    }
    /* ---------- 渲染 ---------- */
    render() {
        if (!this._view) this._view = new CreationdeskView(this);
        this._view.render(this._vm());
    }
    _vm() {
        const host = this.host();
        this._displayedFace = host;
        const mats = host && host.materials ? host.materials : { items: [], states: [], unreadable: [], dropped: 0, readable: false };
        const plan = host && host.plan ? host.plan : null;
        const self = cwSelfCheck(this._target);
        return {
            scope: host && host.scope ? host.scope : {},
            scopeOk: !!(host && host.scopeState === 'ok'),
            materials: mats,
            materialsText: mats.readable
                ? ('素材 ' + String(mats.items.length) + ' 条（认不出 ' + String(mats.dropped) + ' 条）')
                : ('有 ' + String(mats.unreadable.length) + ' 类清单**读不到**（不是「没有素材」—— 这两件事处置相反）'),
            states: mats.states || [],
            pickRef: this._pickRef,
            target: this._target,
            targets: (host && host.targets) || [],
            sensitive: this._sensitive,
            plan: plan,
            planLine: cwPlanLine(plan),
            steps: CW_STEPS,
            published: (host && host.published) || { readable: false, entries: [], dropped: 0 },
            publishedText: (host && host.published && host.published.readable)
                ? ('已发布台账 ' + String(host.published.entries.length) + ' 条')
                : '已发布台账**读不到**（不是「没发过」）',
            selfCheck: self,
            drafts: (host && host.drafts) || { readable: false, items: [], dropped: 0, limit: 0 },
            draftsText: (host && host.draftsText) || '草稿本**读不到**（不是「没草稿」）',
            /* [v4.25.0 · R4-X3] 故事年鉴读数（创作台侧取材口径；判据全在契约件）。 */
            annualText: this.annualLine(),
            multiSelfCheck: (host && host.multiSelfCheck) || null,
            draftKey: this._draftKey,
            draftNote: this._draftNote,
            multiTargets: this._multiTargets.slice(),
            /* [v4.02.0 · R3-X4] 话题本读数与话题交互态 */
            topics: (host && host.topics) || { readable: false, reason: '', count: 0, rejected: 0, dropped: 0, kinds: 4, limit: 0 },
            topicsText: (host && host.topics)
                ? (host.topics.readable
                    ? ('话题本 ' + String(host.topics.count) + ' 条（认不出 ' + String(host.topics.rejected) + ' 条）')
                    : ('话题本**读不到**（不是「没话题」—— 这两件事处置相反）：' + String(host.topics.reason || '')))
                : '话题本**读不到**（不是「没话题」）',
            topicSelfCheck: (host && host.topicSelfCheck) || null,
            topicEvent: this._topicEvent,
            topicPlatform: this._topicPlatform,
            topicText: this._topicText,
            topicPage: this._topicPage,
            /* [v4.30.0 · R4-X9] 取材板读数（创作台侧取舍与目标选择；判据全在契约件）。 */
            board: (function () {
                try { return this._board ? this._board.packAll() : null; }
                catch (_e) { return null; }
            }).call(this),
            flash: this._flash,
            flashBad: this._flashBad,
        };
    }
    selfCheck() { return cwSelfCheck(this._target); }
    onChatChanged() {
        /* 换会话必须丢**实例态**：选中素材 / 目标 / 提示行（换角色后上一个角色的选中项不能留着）。 */
        this._pickRef = '';
        this._target = '';
        this._sensitive = false;
        this._note = '';
        this._draftKey = '';
        this._draftNote = '';
        this._multiTargets = [];
        this._topicEvent = '';
        this._topicPlatform = '';
        this._topicText = '';
        this._topicPage = null;
        this._flash = '';
        this._flashBad = false;
        /* [v4.30.0 · R4-X9] 取材板也丢实例态：换角色后上一个角色选的任务 / 时点 / 勾选不能留着。 */
        if (this._board && typeof this._board.resetScene === 'function') this._board.resetScene();
        this.render();
    }
    destroy() { this._view = null; }
}
