/* ========================================================
 * regexfilter-app.js — [v3.26.0] 正则过滤器 App 控制器
 * 照抄 focus / piggy 规格：取数 → 纯函数 → 视图。
 *
 * 缝合自 EPhone·xINOVO（js/modules/regex_filter.js）。源的操作面里有一块**本仓不能有**的：
 *   `applyRegexFilter(content, charId)` 在渲染前**就地改写消息文本**。
 * 本仓消息文本的既有唯一仲裁者是 `config/tag-filter.js`（生成前的标签级黑白名单过滤）——
 * 同一块文本上放两个改写者，就是本仓最贵的形态（不报错、只错结果），
 * 与存钱罐「不与微信零钱争」同规（那里争的是钱，这里争的是正文）。
 *
 * 故本件是**正则工作台**：写规则 → 实时预览 → 导出。
 *   零自动改写（不 hook 任何生成/渲染事件）、零碰消息、零碰角色会话数据。
 *   规则由用户自己拿去用 —— 这是「不争」的落点：本件提供**工具**，不提供第二个权威。
 *
 * 【为什么它仍有存在价值】本仓此前**零正则工具面**：用户要过滤正文只能用 ST 自己的
 *   正则扩展（在手机外面），规则与角色/会话没有任何关联视图。本件把「规则集合 → 预览 →
 *   导出成 ST 正则脚本」这条链路放进手机里，并把**坏规则**做成显式读数
 *   （源只 `console.error`，界面上看不出哪条坏了 —— 这正是「看起来没坏但显示不对」）。
 * ======================================================== */
'use strict';
import {
    RGX_REASONS, RGX_LIMITS,
    defaultRgxSettings, normalizeRgxSettings,
    normalizePreset, normalizePresets, applyRulesToText, applyPresetsToText, projectRgx,
    readRgxFace, toExportText, fromImportText, toStileRegexScripts,
} from './regexfilter-data.js';
import { RegexFilterView } from './regexfilter-view.js';

/* 会话键：必须匹配 config/storage.js 的 CHAT_DATA_PATTERNS 中 `/^regexfilter_/`，否则跨会话串味 */
const SETTINGS_KEY = 'regexfilter_settings';
const PRESETS_KEY = 'regexfilter_presets';

export class RegexFilterApp {
    constructor(phoneShell, storage) {
        this.shell = phoneShell;
        this.storage = storage;
        this.settings = { ...defaultRgxSettings() };
        this.presets = [];
        this.face = RGX_REASONS.storage_absent;
        this._proj = null;
        this._view = null;
        this._hookBound = false;
        this._loadSettings();
    }

    _win() {
        try { return (typeof window !== 'undefined') ? window : globalThis; } catch (_e) { return globalThis; }
    }

    /* ---------- 取数 ---------- */

    /**
     * 现取（每次 render / refresh 都重取，不持跨轮副本 —— 防陈旧）。
     * 换会话后由 index.js 的 REBIND 表调 onChatChanged()，走的也是这一条路。
     */
    probe() {
        let storageOk = !!this.storage;
        let raw = null;
        try {
            raw = this.storage ? this.storage.get(PRESETS_KEY) : null;
            const obj = (typeof raw === 'string') ? JSON.parse(raw) : raw;
            this.presets = normalizePresets(obj);
        } catch (_e) {
            storageOk = false;
            this.presets = [];
        }
        this.face = readRgxFace({ storageOk, hasPresets: this.presets.length > 0 });
        this._proj = storageOk ? projectRgx(this.presets) : null;
    }

    faceReason() { return this.face; }
    projection() { return this._proj; }
    limits() { return RGX_LIMITS; }

    /** 预设（副本，防视图就地改）。 */
    presetsList() {
        return Array.isArray(this.presets) ? this.presets.slice() : [];
    }

    /* ---------- 规则编辑 ---------- */

    /** 新增/覆盖一个预设。名称或有效规则为空的输入一律拒绝并返回 null。 */
    savePreset(input) {
        const p = normalizePreset(input);
        if (!p) return null;
        const keep = this.presets.filter((x) => x.id !== p.id);
        this.presets = [p, ...keep].slice(0, RGX_LIMITS.maxPresets);
        this._write(this.presets);
        this.probe();
        return p;
    }

    /** 删一个预设。返回实际删掉的条数。 */
    removePreset(id) {
        const sid = String(id);
        const kept = this.presets.filter((p) => p.id !== sid);
        const removed = this.presets.length - kept.length;
        if (removed > 0) {
            this.presets = kept;
            this._write(this.presets);
            this.probe();
        }
        return removed;
    }

    /** 切换启用态。返回新的启用值（找不到该预设时返回 null）。 */
    togglePreset(id) {
        const sid = String(id);
        let next = null;
        this.presets = this.presets.map((p) => {
            if (p.id !== sid) return p;
            next = !p.enabled;
            return { ...p, enabled: next };
        });
        if (next !== null) { this._write(this.presets); this.probe(); }
        return next;
    }

    /* ---------- 预览与导出（零自动改写：全部按需现算） ---------- */

    /**
     * 预览：把规则跑在**用户当场给的文本**上（不是消息文本）。
     * 返回 `{ text, applied, errors, matchedPresets }`；storage 不可用时如实返回空结果。
     */
    preview(text, charId) {
        const src = String(text === null || text === undefined ? '' : text);
        if (!src) return { text: '', applied: 0, errors: [], matchedPresets: [] };
        const r = applyRulesToText(src, this._flattenRules(), { tidy: this.settings.tidy });
        return { text: r.text, applied: r.applied, errors: r.errors, matchedPresets: [] };
    }

    /**
     * 用**当场这一组规则**预览（视图编辑区里的草稿还没存盘，也要能预览 —— 这是源
     * 的实时预览同义，只是本件不碰消息：文本由用户在预览框里当场给）。
     */
    previewFromRules(rules, text) {
        const src = String(text === null || text === undefined ? '' : text);
        if (!src) return { text: '', applied: 0, errors: [], matchedPresets: [] };
        const r = applyRulesToText(src, Array.isArray(rules) ? rules : [], { tidy: this.settings.tidy });
        return { text: r.text, applied: r.applied, errors: r.errors, matchedPresets: [] };
    }

    /** 单预设预览（外壳保护 + 绑定过滤走数据层）。 */
    previewPreset(id, text, charId) {
        const p = this.presets.find((x) => x.id === String(id));
        if (!p) return { text: '', applied: 0, errors: [], matchedPresets: [] };
        return applyPresetsToText(String(text === null || text === undefined ? '' : text),
            [p], charId, { tidy: this.settings.tidy });
    }

    _flattenRules() {
        const all = [];
        for (const p of this.presets) {
            if (!p.enabled) continue;
            for (const r of p.rules) all.push(r);
        }
        return all;
    }

    /** 导出全部预设为可复制的 JSON 文本。 */
    exportText() {
        return toExportText(this.presets);
    }

    /** 导出单个预设为 SillyTavern 正则脚本数组（仍只是**文本数据**，不写 ST）。 */
    exportScriptsFor(id) {
        const p = this.presets.find((x) => x.id === String(id));
        return p ? toStileRegexScripts(p) : [];
    }

    /** 导入：吃 JSON 文本，成功则并入预设表。返回 `{ ok, reason, added }`。 */
    importText(text) {
        const r = fromImportText(text);
        if (!r.ok) return { ok: false, reason: r.reason, added: 0 };
        const existing = new Set(this.presets.map((p) => p.id));
        const add = [];
        for (const p of r.presets) {
            /* 撞 id 就换一个新 id 再进（不覆盖用户已有预设 —— 源在这里是直接 push，
             *   本件显式分开：导入是「并入」，不是「替换」）。 */
            add.push(existing.has(p.id) ? { ...p, id: 'rf_' + Math.random().toString(36).slice(2, 9) } : p);
        }
        this.presets = [...add, ...this.presets].slice(0, RGX_LIMITS.maxPresets);
        this._write(this.presets);
        this.probe();
        return { ok: true, reason: 'ok', added: add.length };
    }

    /* ---------- 落盘 ---------- */

    /** 唯一写盘口。 */
    _write(presets) {
        try {
            if (!this.storage) return;
            this.storage.set(PRESETS_KEY, normalizePresets(presets));
        } catch (_e) { /* silent */ }
    }

    _loadSettings() {
        try {
            const raw = this.storage ? this.storage.get(SETTINGS_KEY) : null;
            const obj = (typeof raw === 'string') ? JSON.parse(raw) : raw;
            this.settings = normalizeRgxSettings(obj);
        } catch (_e) { this.settings = { ...defaultRgxSettings() }; }
    }

    saveSettings() {
        try {
            if (this.storage) this.storage.set(SETTINGS_KEY, JSON.stringify(this.settings));
        } catch (_e) { /* silent */ }
    }

    /** 改设置里的项（视图只给原始输入值，钳制与类型收敛都在这里做）。 */
    patchSettings(patch) {
        this.settings = normalizeRgxSettings({ ...this.settings, ...(patch || {}) });
        this.saveSettings();
    }

    /* ---------- 生命周期 ---------- */

    /** 换会话：预设是「本会话的规则集」，故只重取读数，不持跨轮缓存。 */
    onChatChanged() {
        this._loadSettings();
        this.probe();
        if (this._view) this._view.refresh();
    }

    render() {
        this.probe();
        if (!this._view) {
            this._view = new RegexFilterView(this, this.shell, this.storage);
        }
        this._view.render();
    }
}