/* ========================================================
 * line-app.js — [v4.159.0 · 第 2 层最后一件] LINE App 控制器
 * 照抄 weather / taobao / lofter 规格：取数 → 纯函数 → 视图；注入走表驱动。
 *
 * 【本件只做三件事】读账 / 写账（走纯函数）/ 把事实交给生成侧。
 *   · 零数据库：两格会话键（line_settings / line_state），由
 *     config/storage.js 的 `/^line_/` 前缀随会话隔离；
 *   · 零网络：不拉贴图、不拉历史、不连任何 LINE 服务（源那些图床与
 *     `fetch` 一条都不进来）；
 *   · 零定时器：新消息只能由 `appendMessage` 进来（用户手填 / 宿主喂），
 *     界面只在 render 时现取 —— 源那套轮询在这里不存在；
 *   · 零碰宿主角色对象：成员只是名字串，不读任何角色字段。
 *
 * 【写回执】所有写都走 config/write-receipt.js 的唯一实现：`saved === true`
 *   才算写成功（此前同族 App 无条件 return true 的坑不重犯）。
 * ======================================================== */
'use strict';
import {
    LINE_REASONS, LINE_LIMITS, LINE_KINDS, LINE_STICKERS,
    defaultLineSettings, normalizeLineSettings,
    normalizeLineState, emptyLineState, hasAny, readLineFace,
    upsertRoom, removeRoom, appendMessage, recallMessage, markRead,
    unreadTotal, projectLine, linePromptBlock,
    describeKind, stickerById, formatClock, roomOf,
} from './line-data.js';
import { LineView } from './line-view.js';
import { writeReceipt } from '../../config/write-receipt.js';

/* 会话键：必须匹配 config/storage.js 的 CHAT_DATA_PATTERNS 中 `/^line_/`，
 *   否则跨会话串味（换角色后上一段关系的聊天记录跟着走 —— 源就是这样）。 */
const SETTINGS_KEY = 'line_settings';
const STATE_KEY = 'line_state';

export class LineApp {
    constructor(phoneShell, storage) {
        this.shell = phoneShell;
        this.storage = storage;
        this.settings = { ...defaultLineSettings() };
        this.state = emptyLineState();
        this.face = LINE_REASONS.storage_absent;
        this._proj = null;
        this._view = null;
        this._hookBound = false;
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
            return writeReceipt(this.storage, key, JSON.stringify(v)).saved === true;
        } catch (_e) { return false; }
    }
    /* ---------- 取数 ---------- */
    /** 现取（每次 render / refresh 都重取，不持跨轮副本 —— 防陈旧）。 */
    probe() {
        let storageOk = !!this.storage;
        try {
            this.state = normalizeLineState(this._readJSON(STATE_KEY));
        } catch (_e) {
            storageOk = false;
            this.state = emptyLineState();
        }
        this.face = readLineFace({ storageOk, hasAny: hasAny(this.state) });
        this._proj = storageOk ? projectLine(this.state, this.settings, Date.now()) : null;
    }
    faceReason() { return this.face; }
    projection() { return this._proj; }
    limits() { return LINE_LIMITS; }
    kinds() { return LINE_KINDS.slice(); }
    stickers() { return LINE_STICKERS.slice(); }
    stickerName(id) { const s = stickerById(id); return s ? s.name : ''; }
    kindText(kind) { return describeKind(kind); }
    clockText(ts) { return formatClock(ts); }
    stateSnapshot() { return normalizeLineState(this.state); }
    room(roomId) { return roomOf(this.state, roomId); }
    unread() { return unreadTotal(this.state, this.settings); }
    /* ---------- 记账（全部经纯函数，App 只负责落盘 + 重取） ---------- */
    /** 建 / 改会话。`{ok, error?}` —— 上限与坏入参**都**带人话原因。 */
    upsertRoom(room) {
        const r = upsertRoom(this.state, room);
        if (!r.ok) return { ok: false, error: r.error || '没建上' };
        this.state = r.state;
        if (!this._writeState()) return { ok: false, error: '存储写不进去（这一次没落盘）' };
        this.probe();
        return { ok: true };
    }
    /** 关掉会话。`{ok, removed}`（本来就没有 ⇒ ok:false 但不算错）。 */
    dropRoom(roomId) {
        const r = removeRoom(this.state, roomId);
        if (!r.removed) return { ok: false, removed: false, error: '本来就没有这个会话' };
        this.state = r.state;
        if (!this._writeState()) return { ok: false, removed: false, error: '存储写不进去（这一次没落盘）' };
        this.probe();
        return { ok: true, removed: true };
    }
    /** 追加一条消息（环形上限由数据层裁，`dropped` 计数留痕）。 */
    append(roomId, msg) {
        const r = appendMessage(this.state, roomId, msg);
        if (!r.ok) return { ok: false, error: r.error || '没记上' };
        this.state = r.state;
        if (!this._writeState()) return { ok: false, error: '存储写不进去（这一次没落盘）' };
        this.probe();
        return { ok: true };
    }
    /** 撤回：只标记，不删（删了就没有「撤回」这件事可读）。 */
    recall(roomId, msgId) {
        const r = recallMessage(this.state, roomId, msgId);
        if (!r.ok) return { ok: false, error: r.error || '没撤成' };
        this.state = r.state;
        if (!this._writeState()) return { ok: false, error: '存储写不进去（这一次没落盘）' };
        this.probe();
        return { ok: true };
    }
    /** 已读：把读游标推到该会话最后一条（不是布尔）。 */
    markRead(roomId) {
        const r = markRead(this.state, roomId);
        if (!r.ok) return { ok: false, error: r.error || '本来就没有新消息' };
        this.state = r.state;
        if (!this._writeState()) return { ok: false, error: '存储写不进去（这一次没落盘）' };
        this.probe();
        return { ok: true };
    }
    /* ---------- 注入 ---------- */
    /** 生成侧注入块：只注入事实（见数据层 linePromptBlock）。 */
    promptBlock() {
        if (!this.settings.injectToPrompt) return '';
        const proj = this._proj || projectLine(this.state, this.settings, Date.now());
        return linePromptBlock(proj, this.settings);
    }
    /** 一行读数（给状态条 / 桌面摘要用）。 */
    summaryLine() {
        const p = this._proj;
        if (!p) return '读不到 LINE';
        if (!p.hasAny) return '还没有会话';
        const u = p.unreadTotal;
        return p.roomCount + ' 个会话' + (u > 0 ? (' · ' + u + ' 条未读') : ' · 都读过了');
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
        return this._writeJSON(STATE_KEY, this.state);
    }
    _loadSettings() {
        try {
            this.settings = normalizeLineSettings(this._readJSON(SETTINGS_KEY));
        } catch (_e) { this.settings = { ...defaultLineSettings() }; }
    }
    saveSettings() {
        return this._writeJSON(SETTINGS_KEY, this.settings);
    }
    patchSettings(patch) {
        this.settings = normalizeLineSettings({ ...this.settings, ...(patch || {}) });
        const ok = this.saveSettings();
        this.probe();
        return { ok, settings: this.settings };
    }
    /* ---------- 生命周期 ---------- */
    /** 换会话：两格都是「本会话的 LINE」，故全部重取（读游标也一起换）。 */
    onChatChanged() {
        this._loadSettings();
        this.probe();
        if (this._view) this._view.onChatChanged();
    }
    render() {
        this.probe();
        this._initHook();
        if (!this._view) this._view = new LineView(this, this.shell, this.storage);
        this._view.render();
    }
}