/* ========================================================
 * block-app.js — [v3.27.0] 拉黑 App 控制器
 * 照抄 focus / piggy / punchcard / avatarframe / shop 规格：取数 → 纯函数 → 视图；注入走表驱动。
 *
 * 缝合自 EPhone·xINOVO（`src_xinovo/js/modules/block_system.js`，530 行 / 27324 字符）。
 * 源那三处本仓不能有（见 block-data 文件头）：把标记写在宿主角色对象上、自己拼 prompt 调模型、
 * 起 60 秒轮询。本件只做**本会话的两本账**：你拉黑它（含它的申请）／它拉黑你（含你的申请）。
 * 零数据库、零网络、零定时器、零碰聊天历史。
 *
 * 【契约：生成侧怎么把事实塞进来、怎么落定】
 *   注入：`promptBlock()` 只给事实（谁在拉黑谁、几次、最近的回绝理由、几条申请悬着）。
 *   落定：生成侧在它自己的回合里决定答不答应，再由**宿主/用户**调用本件的方法把结果记下来
 *        （`resolveCharRequest(...)` / `resolveMyRequest(...)`），`decidedBy` 会记成 `'char'`。
 *        本件不替它答，也不替它开口。
 * ======================================================== */
'use strict';
import {
    BLOCK_REASONS, BLOCK_LIMITS, BLOCK_REAPPLY_MODES,
    defaultBlockSettings, normalizeBlockSettings,
    normalizeBlockState, emptyBlockState,
    setBlocked, clearBlocked, charApplyRequest, resolveRequest, setReapply,
    setCharBlocked, clearCharBlocked, myApply, resolveMyRequest,
    clearAllHistory, resetBlockState,
    readBlockFace, projectBlock, cooldownRemaining, blockPromptBlock,
} from './block-data.js';
import { BlockView } from './block-view.js';
import { writeReceipt } from '../../config/write-receipt.js';

/* 会话键：必须匹配 config/storage.js 的 CHAT_DATA_PATTERNS 中 `/^block_/`，否则跨会话串味 */
const SETTINGS_KEY = 'block_settings';
const STATE_KEY = 'block_state';

export class BlockApp {
    constructor(phoneShell, storage) {
        this.shell = phoneShell;
        this.storage = storage;
        this.settings = { ...defaultBlockSettings() };
        this.state = emptyBlockState();
        this.face = BLOCK_REASONS.storage_absent;
        this._proj = null;
        this._view = null;
        this._hookBound = false;
        this._seq = 0;
        this._loadSettings();
    }

    _win() {
        try { return (typeof window !== 'undefined') ? window : globalThis; } catch (_e) { return globalThis; }
    }

    _readJSON(key) {
        try {
            const raw = this.storage ? this.storage.get(key) : null;
            return (typeof raw === 'string') ? JSON.parse(raw) : raw;
        } catch (_e) { return null; }
    }

    _writeJSON(key, v) {
        try {
            if (!this.storage) return false;
            /* [v3.58.0 · 计划 O5] 写回执走唯一实现：此前这里无条件 return true，
             *   写调用失败（真 PhoneStorage 内部吞错）也照报成功。 */
            return writeReceipt(this.storage, key, JSON.stringify(v)).saved === true;
        } catch (_e) { return false; }
    }

    /** 生成条目 id（不带时间戳也能唯一：序号 + 计数）。 */
    _makeId(prefix) {
        this._seq += 1;
        return prefix + '_' + this._seq;
    }

    /* ---------- 取数 ---------- */

    /** 现取（每次 render / refresh 都重取，不持跨轮副本 —— 防陈旧）。 */
    probe() {
        let storageOk = !!this.storage;
        try {
            this.state = normalizeBlockState(this._readJSON(STATE_KEY));
        } catch (_e) {
            storageOk = false;
            this.state = emptyBlockState();
        }
        this.face = readBlockFace({ storageOk, hasAny: this._any() });
        this._proj = projectBlock(this.state, Date.now());
    }

    _any() {
        const s = this.state;
        return !!(s.direct.blocked || s.reverse.blocked
            || s.direct.history.length || s.direct.requests.length
            || s.reverse.history.length || s.reverse.myRequests.length);
    }

    faceReason() { return this.face; }
    projection() { return this._proj; }
    limits() { return BLOCK_LIMITS; }
    reapplyModes() { return BLOCK_REAPPLY_MODES.slice(); }
    stateSnapshot() { return normalizeBlockState(this.state); }

    /** 离下一条申请还差多久（毫秒，0 = 现在就行）。**读数**，无人转定时器。 */
    cooldown() { return cooldownRemaining(this.state, Date.now()); }

    /* ---------- 你拉黑它 ---------- */

    block() {
        const r = setBlocked(this.state, Date.now());
        if (!r.changed) return { ok: false, error: '已经在拉黑状态' };
        this.state = r.state;
        this._writeState();
        this.probe();
        return { ok: true };
    }

    unblock() {
        const r = clearBlocked(this.state, Date.now());
        if (!r.changed) return { ok: false, error: '现在是没拉黑的状态' };
        this.state = r.state;
        this._writeState();
        this.probe();
        return { ok: true };
    }

    /** 角色来一条申请（由生成侧触发 / 用户手动记）。 */
    charRequest(reason) {
        const r = charApplyRequest(this.state, reason, Date.now(), () => this._makeId('cq'));
        if (!r.added) return { ok: false, error: r.error || '没能记上' };
        this.state = r.state;
        this._writeState();
        this.probe();
        return { ok: true, id: r.id };
    }

    /** 落定角色的申请。`by` = 'char'（生成侧答的）或 'user'（手动标）。接受即自动解除拉黑。 */
    resolveCharRequest(requestId, accept, rejectReason, by) {
        const r = resolveRequest(this.state, requestId, accept, rejectReason, Date.now(), by);
        if (!r.changed) return { ok: false, error: '这条申请已经不是待答复状态了' };
        this.state = r.state;
        this._writeState();
        this.probe();
        return { ok: true };
    }

    setReapply(mode, intervalMin) {
        const r = setReapply(this.state, mode, intervalMin);
        this.state = r.state;
        this._writeState();
        this.probe();
        return { ok: true };
    }

    /* ---------- 它拉黑你 ---------- */

    /** 角色主动拉黑用户（生成侧在正文里触发时调这里）。 */
    charBlock(reason) {
        const r = setCharBlocked(this.state, reason, Date.now());
        if (!r.changed) return { ok: false, error: '已经在被拉黑状态' };
        this.state = r.state;
        this._writeState();
        this.probe();
        return { ok: true };
    }

    charUnblock() {
        const r = clearCharBlocked(this.state, Date.now());
        if (!r.changed) return { ok: false, error: '现在是没被拉黑的状态' };
        this.state = r.state;
        this._writeState();
        this.probe();
        return { ok: true };
    }

    /** 你去申请加回它（源 `submitUserFriendRequest` 的用户侧；本件不叫模型，落 pending）。 */
    myRequest(reason) {
        const r = myApply(this.state, reason, Date.now(), () => this._makeId('um'));
        if (!r.added) return { ok: false, error: r.error || '没能记上' };
        this.state = r.state;
        this._writeState();
        this.probe();
        return { ok: true, id: r.id };
    }

    /** 落定你那条申请。接受即反向解除。 */
    resolveMyRequest(requestId, accept, rejectReason, by) {
        const r = resolveMyRequest(this.state, requestId, accept, rejectReason, Date.now(), by);
        if (!r.changed) return { ok: false, error: '这条申请已经没有待回的状态了' };
        this.state = r.state;
        this._writeState();
        this.probe();
        return { ok: true };
    }

    /* ---------- 清账 ---------- */

    clearHistory() {
        const r = clearAllHistory(this.state);
        if (!r.removed) return 0;
        this.state = r.state;
        this._writeState();
        this.probe();
        return r.removed;
    }

    resetAll() {
        const r = resetBlockState();
        this.state = r.state;
        this._writeState();
        this.probe();
        return true;
    }

    /* ---------- 注入 ---------- */

    promptBlock() {
        if (!this.settings.injectToPrompt) return '';
        const proj = this._proj || projectBlock(this.state, Date.now());
        return blockPromptBlock(proj, this.settings);
    }

    summaryLine() {
        const p = this._proj;
        if (!p) return '读不到拉黑';
        if (!p.hasAny) return '两本账都是平的';
        const bits = [];
        if (p.directBlocked) bits.push('你拉黑了它');
        else if (p.directTimes) bits.push('你拉黑过 ' + p.directTimes + ' 次');
        if (p.reverseBlocked) bits.push('它拉黑了你');
        else if (p.reverseTimes) bits.push('它拉黑过你 ' + p.reverseTimes + ' 次');
        return bits.join(' · ') || '两本账都是平的';
    }

    _initHook() {
        if (this._hookBound) return;
        try {
            const ctx = this._win().SillyTavern && this._win().SillyTavern.getContext ? this._win().SillyTavern.getContext() : null;
            const es = ctx ? ctx.eventSource : null;
            const et = ctx ? ctx.event_types : null;
            if (!es || !et || !et.GENERATE_BEFORE_COMBINE_PROMPTS) return;
            es.on(et.GENERATE_BEFORE_COMBINE_PROMPTS, (payload) => {
                try {
                    if (!payload || !Array.isArray(payload.prompt)) return;
                    const blk = this.promptBlock();
                    if (blk) payload.prompt.push({ role: 'system', content: blk });
                } catch (_e) { /* 静默失败：生成照常进行 */ }
            });
            this._hookBound = true;
        } catch (_e) { /* 宿主无事件源：不挂钩子 */ }
    }

    /* ---------- 落盘 ---------- */

    _writeState() {
        this._writeJSON(STATE_KEY, this.state);
    }

    _loadSettings() {
        try {
            this.settings = normalizeBlockSettings(this._readJSON(SETTINGS_KEY));
        } catch (_e) { this.settings = { ...defaultBlockSettings() }; }
    }

    saveSettings() {
        this._writeJSON(SETTINGS_KEY, this.settings);
    }

    patchSettings(patch) {
        this.settings = normalizeBlockSettings({ ...this.settings, ...(patch || {}) });
        this.saveSettings();
    }

    /* ---------- 生命周期 ---------- */

    /** 换会话：两本账都是「本会话的账」，故全部重取。 */
    onChatChanged() {
        this._loadSettings();
        this.probe();
        if (this._view) this._view.refresh();
    }

    render() {
        this.probe();
        this._initHook();
        if (!this._view) {
            this._view = new BlockView(this, this.shell, this.storage);
        }
        this._view.render();
    }
}