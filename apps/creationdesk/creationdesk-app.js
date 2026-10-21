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
/* [v4.45.0 · 第五期 R5-O1] 取材板交接契约件：**去向表与文案的唯一出处**。
 *   本层只转发（界面不写第二份去向表）；判定与落笔分别在契约件与宿主。 */
import { handoffTargetIds as mbhTargetIds, handoffTargetLabel as mbhTargetLabel, MBH_STATES } from '../../config/material-board-handoff.js';
/* [v4.47.0 · 第五期 R5-X7] 可丢弃的假设场景双栏试写（契约件）。
 *   本层只持**用户的临时选择**（两栏假设 + 基线 + 选中栏）与转交；
 *   态 / 文案 / 可比性判定全在契约件与宿主，界面不写第二份。
 *   ★ 试写**不是既成结局**：本层不生成、不采纳、不落正史。 */
import {
    HY_STATES, HY_LANES, HY_LANE_LABEL, HY_LANE_STATES, HY_ASSUME_KINDS, HY_ASSUME_LABEL,
    HY_DECISIONS, HY_DECISION_LABEL, HY_COMPARABLE, HY_COMPARABLE_LABEL, HY_LANE_STATE_LABEL,
    compareLanes as hyCompareLanes, normalizeLane as hyNormalizeLane,
    laneLine as hyLaneLine, trialLine as hyTrialLine,
} from '../../config/hypo-trial-contract.js';
/* [v4.47.0 / R5-X7] 数值取值门走全仓唯一实现（config/num-gate.js）。
 *   为什么必须引门而不是就地再写一遍：Number.isFinite(Number(v)) 会把
 *   '' / [] / false 读成 0，与「上游没给」塌成同一个读数，而两者处置相反
 *   （留空 => 等用户补基线；0 => 那是一个真时点）。本仓自 v3.12.0 起有常驻
 *   门禁 scripts/weak-coercion-audit.mjs 守这条，本版新件首版正是被它抓住的。
 */
import { numOrNull } from '../../config/num-gate.js';
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
        /* [v4.45.0 · R5-O1] 交接单预览行（**纯读数**；预览不落笔，落笔在 boardCommit）。 */
        this._boardPreview = '';
        /* [v4.47.0 · R5-X7] 假设试写区交互态：两栏假设 + 各自试写文本 + 基线 + 选中栏。
         *   ★ 它**不是**剧情事实：只活在实例态与本机键（`cw_hy_trial`，随会话隔离），换会话一律作废。 */
        this._hy = {
            baseline: '',
            a: { kind: '', text: '', written: '' },
            b: { kind: '', text: '', written: '' },
            picked: '',
            flash: '',
            flashBad: false
        };
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
    /* ══════════ [v4.45.0 · R5-O1] 取材板交接：**真落笔** ══════════
     * 【修前实测处境】`boardHandoff()` 端出的只有三个 owner **字符串**（composeOwner /
     *   budgetOwner / draftOwner）：谁都没被调用，一个字节都没落笔，而按钮点下去
     *   界面看起来像交过去了。计划原文点名：「owner 字符串不是实际交接」。
     * 【本层做两件】① 把「用户选的这几条 + 去哪儿」交给**宿主的 board 动作**（那里才落笔）；
     *   ② 收下回执如实念（五态：drafted / replayed / pending / failed / unreceived）。
     * 【本层不做】不自己落盘（写口只有一处）、不发布、不生成、不发消息。
     *   ★ 失败**不清选择**（用户改完能重试）——「交不过去」与「已经交出去了」必须分得开。
     * ------------------------------------------------------------------ */
    /**
     * 把选定交给既有 owner（**真落笔**；两条去向：创作草稿 / 下一次主聊天）。
     * @param {string} target 'draft' | 'chat'
     * @returns {Promise<{ok,state,note,target,count,key}>}
     */
    async boardCommit(target) {
        const t = String(target || '').trim();
        const pick = this._board.pick();
        const items = (pick.items || []).map(function (m) {
            return {
                id: m.id, source: m.source, facet: m.facet, facetLabel: m.facetLabel,
                title: m.title, floor: m.floor
            };
        });
        const handoff = {
            target: t,
            task: this._board.task,
            taskLabel: this._board.taskLabel ? this._board.taskLabel(this._board.task) : '',
            asOf: this._board.asOf,
            items: items
        };
        const vp = (typeof window !== 'undefined') ? window.VirtualPhone : null;
        if (!vp || typeof vp.applyCreationdeskAction !== 'function') {
            /* 入口不在位 ⇒ **如实报没有接收者**，不许报成功（计划原文：目标缺席不报成功）。 */
            const note = '**没有接收者**：创作工作台入口不在位（本板零写盘，不代写）';
            this._flash = note; this._flashBad = true; this.render();
            return { ok: false, state: MBH_STATES.UNRECEIVED, note: note, target: t, count: items.length, key: '' };
        }
        const face = this._displayedFace;
        const payload = {
            action: 'board', handoff: handoff,
            scope: face && face.scope, token: face && face.token
        };
        let r;
        try { r = await vp.applyCreationdeskAction(payload); }
        catch (e) { r = { ok: false, note: '执行失败：' + String(e.message || e), state: 'failed' }; }
        const now = this.host();
        if (now && (now.token !== payload.token)) return r;
        this._flash = String((r && r.note) || '');
        this._flashBad = !(r && r.ok === true);
        /* ★ 落进草稿本之后**顺手把那一份选中**（用户立刻能在草稿本里打开看它）。 */
        if (r && r.ok === true && r.state === MBH_STATES.DRAFTED && r.key) this._draftKey = String(r.key);
        this.render();
        return {
            ok: !!(r && r.ok === true),
            state: String((r && r.state) || 'failed'),
            note: this._flash, target: t, count: items.length,
            key: String((r && r.key) || '')
        };
    }
/**
     * 预览交接单（**纯读数，不落笔**）：把「会交哪几条、幂等键是什么、两套来源词表怎么分」
     *   拼成一行给用户看一眼 —— 计划原文要求「**预览内容后**交给原 owner」。
     *   ★ 预览**不改变任何状态**：草稿本与待用登记一个字节都不动（落笔在 boardCommit）。
     */
    setBoardPreview(read) {
        const r = (read && typeof read === 'object') ? read : null;
        if (!r || !r.ok) {
            this._boardPreview = '这份选定还交不出去（先勾几条本幕材料；不在包里 / 时点之后的要先处理）';
            this.render();
            return this._boardPreview;
        }
        this._boardPreview = ('交 ' + String(r.count) + ' 条 · ' + String(r.chars) + ' 字 · 幂等键 '
            + String(r.ids.slice(0, 2).join('+')) + (r.ids.length > 2 ? '…' : '')
            + '（素材来源是**记忆事实**，与 App 内容来源不是同一张表）');
        this.render();
        return this._boardPreview;
    }
    /** 取材板交接的两处落点读数（宿主给；读不到 ⇒ null，**不拟一份**）。 */
    boardHandoffFace() {
        const host = this.host();
        if (!host) return { pending: null, draftedCount: null };
        return {
            pending: host.boardPending || null,
            draftedCount: (typeof host.boardDraftedCount === 'number') ? host.boardDraftedCount : null
        };
    }
    /* ══════════ [v4.47.0 · 第五期 R5-X7] 可丢弃的假设场景双栏试写 ══════════
     * 【为什么要有它】正史选择（archive 的支线结局）只能对**已经存在的**两条分支做取舍；
     *   而「还没建正式分支前，先拿两种假设各写一栏看看」此前**全仓零落点**（grep 零命中）。
     *   于是用户要么在脑子里比，要么**先建一条正式分支再删** —— 而正式分支是既成结局，
     *   建了就有痕迹，「预演」被读成「已经这么定了」。
     * 【本层做什么】持用户的临时选择 + 转交；`run` 落本机键、`keep` 落既有草稿本、
     *   `adopt` 只判闸并交回选中栏、`discard` 清临时选择（**正史零写**）。
     * 【本层不做什么】不生成文本、不建分支、不写剧情事实、不发请求
     *   （计划原文三条不做：不自动多模型竞赛 / 不后台无限续写 / 不增加第二套生成 API）。
     * ------------------------------------------------------------------ */
    /** 试写区读数（宿主给；读不到 ⇒ null，**不拟一份**）。 */
    hyFace() {
        const host = this.host();
        if (!host || !host.hypoTrial) return null;
        return host.hypoTrial.face || null;
    }
    /** 试写区一行主读数（判据全在契约件 `trialLine`）。 */
    hyLine() {
        const host = this.host();
        if (host && host.hypoTrial && host.hypoTrial.line) return String(host.hypoTrial.line);
        try {
            return hyTrialLine({ state: HY_STATES.EMPTY });
        } catch (_e) { return '假设试写：读数读不到（不假装为空）'; }
    }
    /** 两栏读数（本机交互态现算；**不冒充已试写**）。
     *   ★ 这里刻意**不覆盖**态与行文案：态与 `line` 一律由契约件的 `normalizeLane` /
     *     `laneLine` 算 —— 两份实现必然漂移，而漂移的表现是「同一栏在两条路上得到
     *     不同的读数」，不报错、只是错数。 */
    hyLanes() {
        const out = {};
        for (const id of HY_LANES) {
            const local = this._hy[id] || { kind: '', text: '', written: '' };
            const base = String(this._hy.baseline || '').trim();
            /* 留空 => 没给基线（等用户补）；给了非数 => 也没给。两者都不许塌成 0。 */
            const at = numOrNull(base);
            const bl = (at === null)
                ? { at: null, label: '', given: false }
                : { at: at, label: '', given: true };
            const one = hyNormalizeLane(id, {
                assume: { kind: String(local.kind || ''), text: String(local.text || '') },
                baseline: bl,
                text: String(local.written || '')
            });
            const lane = one.lane || { id: id, label: HY_LANE_LABEL[id], state: '', chars: 0, line: '' };
            lane.written = String(local.written || '');
            out[id] = lane;
        }
        return out;
    }
    /** 可比性（**真算**：同基线才叫「同一场景的两条岔路」；基线不同 ⇒ 差异里混着基线差）。 */
    hyCompare() {
        const lanes = this.hyLanes();
        try { return hyCompareLanes(lanes.a, lanes.b); }
        catch (_e) {
            /* 读不出可比性 ⇒ 按**比不了**报（不许塌成「同基线」：那会让采纳按钮亮起来）。 */
            return { comparable: HY_COMPARABLE.MISSING, label: HY_COMPARABLE_LABEL[HY_COMPARABLE.MISSING], diffCount: 0 };
        }
    }
    /** 可比性标签（界面只读这一处，不写第二份）。 */
    hyCompareLabel() {
        const c = this.hyCompare();
        return String((c && c.label) || HY_COMPARABLE_LABEL[HY_COMPARABLE.MISSING] || '');
    }
    /** 可比性态（界面判「采纳按钮画不画」用；**不许**用文案子串去猜）。 */
    hyComparableState() {
        const c = this.hyCompare();
        return String((c && c.comparable) || HY_COMPARABLE.MISSING);
    }
    /** 采纳按钮画不画（界面不许拿文案子串猜：判据是契约件的可比性态 + 选中栏）。
     *   用文案子串判的后果不是报错，是文案一改按钮就静默消失。 */
    hyAdoptReady() {
        /* ★ 三个条件都要：同基线（可比）+ 选中了某栏 + **那一栏真有试写文本**。
         *   少判最后一条就会亮出一个点下去必然被闸拒的按钮 —— 本仓纪律：
         *   「亮一个走不通的按钮比不亮更贵」。 */
        if (this.hyComparableState() !== HY_COMPARABLE.SAME) return false;
        const id = String(this._hy.picked || '');
        if (HY_LANES.indexOf(id) < 0) return false;
        const lane = this.hyLanes()[id] || {};
        return lane.state === HY_LANE_STATES.WRITTEN;
    }
    /** 一栏当前的假设种类（界面「再点一次即取消」读它；不读实例私有态）。 */
    hyKindOf(lane) {
        const id = HY_LANES.indexOf(String(lane || '')) >= 0 ? String(lane) : '';
        return id ? String((this._hy[id] || {}).kind || '') : '';
    }
    /** 这一栏有没有写过的文本（回填用；**与「试写跑过了」不是一回事**）。 */
    hyWrittenOf(lane) {
        const id = HY_LANES.indexOf(String(lane || '')) >= 0 ? String(lane) : '';
        return id ? String((this._hy[id] || {}).written || '') : '';
    }
    /** 基线（楼层号；空值即清空，**不默认挑一个**）。 */
    hySetBaseline(v) { this._hy.baseline = String(v == null ? '' : v).trim(); this.render(); return this._hy.baseline; }
    /** 一栏的假设种类（空值即清空，**不回落成「接受」**）。 */
    hySetAssumeKind(lane, kind) {
        const id = HY_LANES.indexOf(String(lane || '')) >= 0 ? String(lane) : '';
        if (!id) return '';
        this._hy[id].kind = String(kind || '').trim();
        this.render();
        return this._hy[id].kind;
    }
    /** 一栏的假设说明。 */
    hySetAssumeText(lane, text) {
        const id = HY_LANES.indexOf(String(lane || '')) >= 0 ? String(lane) : '';
        if (!id) return '';
        this._hy[id].text = String(text || '');
        return this._hy[id].text;
    }
    /** 一栏的试写文本（**用户显式写**：本层不代写、不后台续写）。 */
    hySetWritten(lane, text) {
        const id = HY_LANES.indexOf(String(lane || '')) >= 0 ? String(lane) : '';
        if (!id) return '';
        this._hy[id].written = String(text || '');
        return this._hy[id].written;
    }
    /** 选中要采纳的那一栏（空值即取消选中）。 */
    hyPick(lane) {
        const id = HY_LANES.indexOf(String(lane || '')) >= 0 ? String(lane) : '';
        this._hy.picked = id;
        this.render();
        return id;
    }
    /** 假设种类 id 与标签（界面不写第二份种类表）。 */
    hyAssumeIds() { return HY_ASSUME_KINDS.slice(); }
    hyAssumeLabel(k) { return HY_ASSUME_LABEL[String(k || '')] || ''; }
    hyDecisionIds() { return HY_DECISIONS.slice(); }
    hyDecisionLabel(d) { return HY_DECISION_LABEL[String(d || '')] || ''; }
    hyLaneStateLabel(s) { return HY_LANE_STATE_LABEL[String(s || '')] || ''; }
    /** Good-tempered wrapper: old suites construct view with shell:null (no real App). */
    hyLaneState(s) { try { return this.hyLaneStateLabel(s); } catch (_e) { return ''; } }
    /**
     * 试写区动作统一入口（与 draftAct 同范式：只转咽喉，不直连、不落正史）。
     * @param {string} sub run | keep | adopt | discard
     */
    async hyAct(sub) {
        const vp = (typeof window !== 'undefined') ? window.VirtualPhone : null;
        if (!vp || typeof vp.applyCreationdeskAction !== 'function') {
            /* 入口不在位 ⇒ **如实报没有接收者**，不许报成功。 */
            this._hy.flash = '**没有接收者**：创作工作台入口不在位（本层零写盘，不代写）';
            this._hy.flashBad = true;
            this.render();
            return { ok: false, note: this._hy.flash };
        }
        const face = this._displayedFace;
        const lanes = {};
        for (const id of HY_LANES) {
            const l = this._hy[id] || { kind: '', text: '', written: '' };
            lanes[id] = {
                assume: { kind: String(l.kind || ''), text: String(l.text || '') },
                text: String(l.written || '')
            };
        }
        const payload = {
            action: 'hypo', sub: String(sub || ''),
            baseline: numOrNull(this._hy.baseline),
            lanes: lanes,
            picked: this._hy.picked,
            scope: face && face.scope, token: face && face.token
        };
        let r;
        try { r = await vp.applyCreationdeskAction(payload); }
        catch (e) { r = { ok: false, note: '执行失败：' + String(e.message || e) }; }
        const now = this.host();
        if (now && (now.token !== payload.token)) return r;
        this._hy.flash = String((r && r.note) || '');
        this._hy.flashBad = !(r && r.ok === true);
        this.render();
        return r;
    }
    /** 去向 id 与标签（界面不写第二份去向表）。 */
    boardTargetIds() { try { return mbhTargetIds(); } catch (_e) { return []; } }
    boardTargetLabel(t) { try { return mbhTargetLabel(t); } catch (_e) { return ''; } }
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
            boardPreview: String(this._boardPreview || ''),
            /* [v4.47.0 · 第五期 R5-X7] 假设试写读数（**如实分列**：试写 ≠ 已采纳 ≠ 已落正史）。 */
            hyLine: this.hyLine(),
            hyFace: this.hyFace(),
            hyLanes: this.hyLanes(),
            hyCompareLabel: this.hyCompareLabel(),
            hyBaseline: String(this._hy.baseline || ''),
            hyPicked: String(this._hy.picked || ''),
            /* 界面「采纳按钮画不画」与「一栏现在是什么种类」的真源（视图不猜文案、不读私有态）。 */
            hyComparable: this.hyComparableState(),
            hyAdoptReady: this.hyAdoptReady(),
            hyFlash: String(this._hy.flash || ''),
            hyFlashBad: this._hy.flashBad === true,
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
        this._boardPreview = '';
        /* [v4.47.0 · R5-X7] 试写区实例态一律丢（换角色后上一个角色的两栏预演不能留着）。 */
        this._hy = { baseline: '', a: { kind: '', text: '', written: '' }, b: { kind: '', text: '', written: '' }, picked: '', flash: '', flashBad: false };
        /* [v4.30.0 · R4-X9] 取材板也丢实例态：换角色后上一个角色选的任务 / 时点 / 勾选不能留着。 */
        if (this._board && typeof this._board.resetScene === 'function') this._board.resetScene();
        this.render();
    }
    destroy() { this._view = null; }
}
