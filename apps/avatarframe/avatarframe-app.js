/* ========================================================
 * avatarframe-app.js — [v3.27.0] 头像框 App 控制器
 * 照抄 focus / piggy / punchcard 规格：取数 → 纯函数 → 视图；注入走表驱动。
 *
 * 缝合自 EPhone·xintuk（`avatar-frames/001.js` 数据 + `main-app/033.js` 换框逻辑）。
 * 源那两块本仓不能有（见 avatarframe-data 文件头）：自定义框进 IndexedDB（违零数据库铁律）、
 * 364 条框全部是 postimg 外链（本仓禁新增外链消费）。本件只做**本会话的框账**：
 * 清单（谁有哪些框）→ 两个挂载点挂什么 → 事实注入。零数据库、零网络、零宿主 DOM 依赖。
 *
 * 【本件的字段级设计：挂载点是草稿，保存才落盘】
 *   源对「角色设置里的框」先暂存内存、点保存才写；对主屏 / 微博却是选完立即写。
 *   同一份数据两套语义在界面上看不出来（用户不知道哪一处已经生效）。
 *   本件统一成**草稿 + 显式保存**，并把「有几处改了还没存」做成可见读数。
 * ======================================================== */
'use strict';
import {
    AVATAR_FRAME_REASONS, AVATAR_FRAME_TARGETS, AVATAR_FRAME_LIMITS,
    defaultAvatarFrameSettings, normalizeAvatarFrameSettings,
    normalizeFrames, parsePresetFrames, dedupeFrames, isStorable, classifySource,
    projectFrames, readAvatarFrameFace, avatarFramePromptBlock,
} from './avatarframe-data.js';
import { AvatarFrameView } from './avatarframe-view.js';

/* 会话键：必须匹配 config/storage.js 的 CHAT_DATA_PATTERNS 中 `/^avatarframe_/`，否则跨会话串味 */
const FRAMES_KEY = 'avatarframe_frames';
const MOUNTS_KEY = 'avatarframe_mounts';
const SETTINGS_KEY = 'avatarframe_settings';

export class AvatarFrameApp {
    constructor(phoneShell, storage) {
        this.shell = phoneShell;
        this.storage = storage;
        this.settings = { ...defaultAvatarFrameSettings() };
        /** 已落盘的清单 */
        this.frames = [];
        /** 已落盘的挂载点 `{my, ai}` */
        this.mounts = { my: '', ai: '' };
        /** 草稿挂载点（未保存） */
        this._draftMounts = { my: '', ai: '' };
        /** 草稿是否脏（与落盘值不同即脏） */
        this._mountsDirty = false;
        this.face = AVATAR_FRAME_REASONS.storage_absent;
        this._proj = null;
        this._view = null;
        this._hookBound = false;
        this._loadSettings();
    }

    _win() {
        try { return (typeof window !== 'undefined') ? window : globalThis; } catch (_e) { return globalThis; }
    }

    /* ---------- 取数 ---------- */

    /** 现取（每次 render / refresh 都重取，不持跨轮副本 —— 防陈旧）。 */
    probe() {
        let storageOk = !!this.storage;
        try {
            const rawF = this.storage ? this.storage.get(FRAMES_KEY) : null;
            const objF = (typeof rawF === 'string') ? JSON.parse(rawF) : rawF;
            this.frames = normalizeFrames(objF).frames;

            const rawM = this.storage ? this.storage.get(MOUNTS_KEY) : null;
            const objM = (typeof rawM === 'string') ? JSON.parse(rawM) : rawM;
            this.mounts = this._normMounts(objM);
        } catch (_e) {
            storageOk = false;
            this.frames = [];
            this.mounts = { my: '', ai: '' };
        }
        /* 草稿：未脏则跟随落盘值（换会话 / 重进不残留别人的草稿） */
        if (!this._mountsDirty) this._draftMounts = { ...this.mounts };
        this.face = readAvatarFrameFace({ storageOk, hasFrames: this.frames.length > 0 });
        this._proj = projectFrames(this.frames, this._draftMounts);
    }

    _normMounts(raw) {
        const o = (raw && typeof raw === 'object') ? raw : {};
        const out = {};
        for (const t of AVATAR_FRAME_TARGETS) out[t] = String(o[t] || '').trim();
        return out;
    }

    faceReason() { return this.face; }
    projection() { return this._proj; }
    limits() { return AVATAR_FRAME_LIMITS; }
    targets() { return AVATAR_FRAME_TARGETS.slice(); }
    framesList() { return Array.isArray(this.frames) ? this.frames.slice() : []; }

    /** 草稿里有没有还没保存的改动。 */
    mountsDirty() { return this._mountsDirty; }

    /* ---------- 挂载点的账（草稿） ---------- */

    /** 在草稿里给某个挂载点选框。src 为空串 = 摘掉。返回 `{ok, error?}`。 */
    draftMount(target, src) {
        if (!AVATAR_FRAME_TARGETS.includes(target)) return { ok: false, error: '未知挂载点' };
        const s = String(src || '').trim();
        const kind = classifySource(s);
        if (s && kind === 'invalid') return { ok: false, error: '这个来源不是图片（拒收）' };
        if (s && !isStorable(s, this.settings)) {
            return { ok: false, error: (kind === 'blob-url')
                ? 'blob 链接重开会话就失效，不能存'
                : '外链默认不收（要收先在设置里打开「允许外链」）' };
        }
        /* 非空 src 必须是**清单里有的**框 —— 否则挂上去就是孤儿（源没有这道门） */
        if (s && !this.frames.some((f) => f.src === s)) {
            return { ok: false, error: '这个框不在清单里，先加进来再挂' };
        }
        this._draftMounts = { ...this._draftMounts, [target]: s };
        this._proj = projectFrames(this.frames, this._draftMounts);
        this._mountsDirty = this._mountsDirty ||
            (this._draftMounts.my !== this.mounts.my) || (this._draftMounts.ai !== this.mounts.ai);
        return { ok: true };
    }

    /** 把草稿落盘。返回是否真写了。 */
    saveMounts() {
        if (!this._mountsDirty) return false;
        try {
            if (this.storage) this.storage.set(MOUNTS_KEY, JSON.stringify(this._draftMounts));
        } catch (_e) { return false; }
        this.mounts = { ...this._draftMounts };
        this._mountsDirty = false;
        return true;
    }

    /** 丢弃草稿，回到落盘值。 */
    discardMounts() {
        this._draftMounts = { ...this.mounts };
        this._mountsDirty = false;
        this._proj = projectFrames(this.frames, this._draftMounts);
    }

    /* ---------- 清单的账（立即落盘 —— 加框/删框没有中间态） ---------- */

    /** 加一张框。src 非法 / 超限 / 重复一律**如实拒绝**（不静默截断）。返回 `{ok, added, error?}`。 */
    addFrame(input) {
        const o = (input && typeof input === 'object') ? input : {};
        const src = String(o.src || '').trim();
        if (!src) return { ok: false, added: 0, error: '没有内容' };
        const kind = classifySource(src);
        if (kind === 'invalid') return { ok: false, added: 0, error: '不是可识别的图片来源' };
        if (!isStorable(src, this.settings)) {
            return { ok: false, added: 0, error: (kind === 'blob-url') ? 'blob 链接重开会话即失效' : '外链未开启' };
        }
        if (src.length > AVATAR_FRAME_LIMITS.maxSrcLen) {
            return { ok: false, added: 0, error: '这条太大了（' + src.length + ' 字符 > 上限 ' + AVATAR_FRAME_LIMITS.maxSrcLen + '）' };
        }
        if (this.frames.some((f) => f.src === src)) return { ok: false, added: 0, error: '清单里已经有同一个框（按来源去重）' };
        if (this.frames.length >= AVATAR_FRAME_LIMITS.maxFrames) {
            return { ok: false, added: 0, error: '清单已满（' + AVATAR_FRAME_LIMITS.maxFrames + '）' };
        }
        const merged = this.frames.concat([{ id: o.id || '', name: o.name || '', src, addedAt: Date.now() }]);
        const norm = normalizeFrames(merged);
        this.frames = norm.frames;
        this._writeFrames();
        this.probe();
        return { ok: true, added: 1 };
    }

    /** 批量导入预置清单（源那段数组字面量）。返回 `{ok, added, dropped, rejected, malformed}`。 */
    importPreset(rawText) {
        const p = parsePresetFrames(rawText);
        if (!p.matched) return { ok: false, added: 0, dropped: 0, rejected: 0, malformed: p.malformed, error: '没认出任何条目' };
        const before = this.frames.length;
        const merged = this.frames.concat(p.frames.map((f) => ({
            id: f.id, name: f.name, src: f.src, addedAt: Date.now(),
        })));
        const norm = normalizeFrames(merged);
        this.frames = norm.frames;
        this._writeFrames();
        this.probe();
        return {
            ok: true,
            added: Math.max(0, this.frames.length - before),
            dropped: norm.dropped,
            rejected: norm.rejected,
            malformed: p.malformed,
        };
    }

    /** 删除一张框（按 src —— 身份是 src）。若某挂载点正指着它，**连挂载点一起摘**。 */
    removeFrame(src) {
        const s = String(src || '').trim();
        if (!s) return { ok: false, removed: 0 };
        const kept = this.frames.filter((f) => f.src !== s);
        const removed = this.frames.length - kept.length;
        if (!removed) return { ok: false, removed: 0 };
        this.frames = kept;
        this._writeFrames();
        /* 摘掉指向它的挂载点（草稿与落盘都摘，否则会留一个孤儿） */
        let touched = false;
        for (const t of AVATAR_FRAME_TARGETS) {
            if (this.mounts[t] === s) { this.mounts[t] = ''; touched = true; }
            if (this._draftMounts[t] === s) { this._draftMounts[t] = ''; touched = true; }
        }
        if (touched) {
            try { if (this.storage) this.storage.set(MOUNTS_KEY, JSON.stringify(this.mounts)); } catch (_e) { /* silent */ }
        }
        this.probe();
        return { ok: true, removed, unmounted: touched };
    }

    /** 清空清单。 */
    clearFrames() {
        const n = this.frames.length;
        if (!n) return 0;
        this.frames = [];
        this._writeFrames();
        this.mounts = { my: '', ai: '' };
        this._draftMounts = { my: '', ai: '' };
        this._mountsDirty = false;
        try { if (this.storage) this.storage.set(MOUNTS_KEY, JSON.stringify(this.mounts)); } catch (_e) { /* silent */ }
        this.probe();
        return n;
    }

    /* ---------- 注入 ---------- */

    /** 生成侧注入块：只注入「谁挂着什么框」这一事实（见数据层 avatarFramePromptBlock）。 */
    promptBlock() {
        if (!this.settings.injectToPrompt) return '';
        return avatarFramePromptBlock(this._proj || projectFrames(this.frames, this._draftMounts), this.settings);
    }

    summaryLine() {
        const p = this._proj;
        if (!p) return '读不到头像框';
        if (!p.hasAny) return '还没有框';
        const n = p.mounts.filter((m) => !m.none).length;
        return p.stats.total + ' 张框 · ' + n + ' 处在用';
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

    _writeFrames() {
        try {
            if (!this.storage) return;
            this.storage.set(FRAMES_KEY, JSON.stringify(this.frames));
        } catch (_e) { /* silent */ }
    }

    _loadSettings() {
        try {
            const raw = this.storage ? this.storage.get(SETTINGS_KEY) : null;
            const obj = (typeof raw === 'string') ? JSON.parse(raw) : raw;
            this.settings = normalizeAvatarFrameSettings(obj);
        } catch (_e) { this.settings = { ...defaultAvatarFrameSettings() }; }
    }

    saveSettings() {
        try {
            if (this.storage) this.storage.set(SETTINGS_KEY, JSON.stringify(this.settings));
        } catch (_e) { /* silent */ }
    }

    patchSettings(patch) {
        this.settings = normalizeAvatarFrameSettings({ ...this.settings, ...(patch || {}) });
        this.saveSettings();
    }

    /* ---------- 生命周期 ---------- */

    /** 换会话：框架是「本会话的框」，故只重取读数 + 丢草稿，不持跨轮缓存。 */
    onChatChanged() {
        this._loadSettings();
        this._mountsDirty = false;
        this.probe();
        if (this._view) this._view.refresh();
    }

    render() {
        this.probe();
        this._initHook();
        if (!this._view) {
            this._view = new AvatarFrameView(this, this.shell, this.storage);
        }
        this._view.render();
    }
}