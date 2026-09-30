/* ========================================================
 * widget-app.js — [v3.28.0] 自定义组件 App 控制器
 * 照抄 focus / piggy / punchcard / regexfilter / avatarframe / shop / block / weather 规格：
 * 取数 → 纯函数 → 视图；注入走表驱动。
 *
 * 缝合自 EPhone·xINOVO 的 `custom-widgets.js` + `widget-presets.js`（见 widget-data 文件头）。
 * 源那四处本仓不能有的东西（**执行用户代码** / 自建 iframe + postMessage 桥 /
 * sessionStorage 草稿 / Blob 下载）逐条写在不搬清单里，这里一条都不落地。
 *
 * 【本件的定位（与源最本质的一条偏离）】
 *   源是**运行器**：用户写完 js，它 `new Function(...)()` 跑起来，组件就在桌面上动。
 *   本件是**工作台**：登记组件、对账变量、产出描述、导出设计稿 —— **一行用户代码都不执行**。
 *   宿主若想渲染，拿 `hostPayload()` 去渲染（那是宿主的决定，本件不碰 DOM）。
 *
 * 零数据库、零网络、零 iframe、零动态求值、零定时器、零碰聊天历史。
 * ======================================================== */
'use strict';
import {
    WGT_REASONS, WGT_SIZES, WGT_LIMITS, WGT_VAR_TYPES,
    defaultWgtSettings, normalizeWgtSettings,
    normalizeTemplates, normalizeInstances,
    upsertTemplate, removeTemplate, addInstance, removeInstance, setInstanceVar,
    reconcileVars, extractVars, toHostPayload,
    toExportText, fromImportText, shareTemplate, aiPrompt,
    projectWidget, readWidgetFace, widgetPromptBlock,
} from './widget-data.js';
import { WidgetView } from './widget-view.js';

/* 会话键：必须匹配 config/storage.js 的 CHAT_DATA_PATTERNS 中 `/^widget_/`，否则跨会话串味 */
const SETTINGS_KEY = 'widget_settings';
const TEMPLATES_KEY = 'widget_templates';
const INSTANCES_KEY = 'widget_instances';
/** 编辑草稿（源用 sessionStorage；本仓一律走 PhoneStorage —— 见文件头第 ③ 条）。 */
const DRAFT_KEY = 'widget_draft';

export class WidgetApp {
    constructor(phoneShell, storage) {
        this.shell = phoneShell;
        this.storage = storage;
        this.settings = { ...defaultWgtSettings() };
        this.templates = [];
        this.instances = [];
        this.draft = null;
        this.face = WGT_REASONS.storage_absent;
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
            this.storage.set(key, JSON.stringify(v));
            return true;
        } catch (_e) { return false; }
    }

    /* ---------- 取数 ---------- */

    /** 现取（每次 render / refresh 都重取，不持跨轮副本 —— 防陈旧）。 */
    probe() {
        let storageOk = !!this.storage;
        try {
            this.templates = normalizeTemplates(this._readJSON(TEMPLATES_KEY));
            this.instances = normalizeInstances(this._readJSON(INSTANCES_KEY));
            this.draft = this._readJSON(DRAFT_KEY);
        } catch (_e) {
            storageOk = false;
            this.templates = [];
            this.instances = [];
            this.draft = null;
        }
        this.face = readWidgetFace({ storageOk, hasAny: (this.templates.length > 0 || this.instances.length > 0) });
        this._proj = storageOk ? projectWidget(this.templates, this.instances) : null;
    }

    faceReason() { return this.face; }
    projection() { return this._proj; }
    limits() { return WGT_LIMITS; }
    sizes() { return WGT_SIZES.slice(); }
    varTypes() { return WGT_VAR_TYPES.slice(); }
    templateList() { return normalizeTemplates(this.templates); }
    instanceList() { return normalizeInstances(this.instances); }
    /** 单条模板的两向对账（视图编模板卡时用同一个口）。 */
    reconcile(tmpl) { return reconcileVars(tmpl); }
    /** 从 HTML 里现抽变量（编辑器里「粘贴代码后立刻看变量」用）。 */
    varsOf(html) { return extractVars(html); }
    aiPromptText(request, current) { return aiPrompt(request, current); }
    exportText() { return toExportText(this.templates); }
    hostPayload() { return toHostPayload(this.templates, this.instances); }
    draftSnapshot() { return this.draft && typeof this.draft === 'object' ? { ...this.draft } : null; }

    /* ---------- 模板增删改 ---------- */

    saveTemplate(patch) {
        const r = upsertTemplate(this.templates, patch);
        if (!r.ok) return { ok: false, error: r.error || '没存上' };
        this.templates = r.templates;
        if (!this._writeJSON(TEMPLATES_KEY, this.templates)) return { ok: false, error: '写盘失败' };
        this.probe();
        return { ok: true };
    }

    deleteTemplate(id) {
        const r = removeTemplate(this.templates, id);
        if (!r.ok) return { ok: false, error: '找不到这个组件' };
        this.templates = r.templates;
        this._writeJSON(TEMPLATES_KEY, this.templates);
        this.probe();
        return { ok: true };
    }

    /* ---------- 实例增删改 ---------- */

    /** 摆到桌面。 */
    addInstance(templateId) {
        const r = addInstance(this.templates, this.instances, templateId, Date.now());
        if (!r.ok) return { ok: false, error: r.error || '没摆上' };
        this.instances = r.instances;
        if (!this._writeJSON(INSTANCES_KEY, this.instances)) return { ok: false, error: '写盘失败' };
        this.probe();
        return { ok: true };
    }

    removeInstance(id) {
        const r = removeInstance(this.instances, id);
        if (!r.ok) return { ok: false, error: '找不到这个实例' };
        this.instances = r.instances;
        this._writeJSON(INSTANCES_KEY, this.instances);
        this.probe();
        return { ok: true };
    }

    setVar(instanceId, varName, value) {
        const r = setInstanceVar(this.templates, this.instances, instanceId, varName, value);
        if (!r.ok) return { ok: false, error: r.error || '没改上' };
        this.instances = r.instances;
        this._writeJSON(INSTANCES_KEY, this.instances);
        this.probe();
        return { ok: true };
    }

    /* ---------- 导入 / 导出（只产文本，不下载、不读文件） ---------- */

    exportTextOf(id) {
        const t = this.templates.find((x) => x.id === id);
        if (!t) return '';
        const one = shareTemplate(t);
        if (!one) return '';
        return JSON.stringify({ kind: 'ruby-phone.widget', schemaVersion: 1, templates: [one] }, null, 2);
    }

    importText(text) {
        const r = fromImportText(text);
        if (!r.ok) {
            const M = {
                empty: '没粘内容', 'bad-json': '不是合法的 JSON',
                'bad-shape': '结构不对（要 { templates: [...] } 或数组）',
                'no-valid-template': '里面没有能用的组件（可能都缺名称）',
            };
            return { ok: false, error: M[r.reason] || '导不进来', added: 0 };
        }
        let list = this.templates;
        let added = 0;
        for (const t of r.templates) {
            const patch = { ...t, id: null };
            const rr = upsertTemplate(list, patch);
            if (!rr.ok) break;
            list = rr.templates;
            added += 1;
        }
        if (!added) return { ok: false, error: '一个也没进来', added: 0 };
        this.templates = list;
        this._writeJSON(TEMPLATES_KEY, this.templates);
        this.probe();
        return { ok: true, added };
    }

    /* ---------- 草稿（源用 sessionStorage，本仓用会话键） ---------- */

    saveDraft(d) {
        this.draft = (d && typeof d === 'object') ? d : null;
        if (this.draft) this._writeJSON(DRAFT_KEY, this.draft);
        return true;
    }

    clearDraft() {
        this.draft = null;
        try { if (this.storage) this.storage.remove(DRAFT_KEY); } catch (_e) { /* 清不掉也不阻断 */ }
        return true;
    }

    /* ---------- 注入 ---------- */

    /** 生成侧注入块：只注入事实（见数据层 widgetPromptBlock）。 */
    promptBlock() {
        if (!this.settings.injectToPrompt) return '';
        return widgetPromptBlock(this.templates, this.instances, this.settings);
    }

    summaryLine() {
        const p = this._proj;
        if (!p) return '读不到组件';
        if (!p.hasAny) return '还没有组件';
        const bits = [p.templateCount + ' 个组件', '桌面摆着 ' + p.instanceCount + ' 个'];
        if (p.orphanCount) bits.push(p.orphanCount + ' 个的原组件已被删');
        if (p.missingDefaultCount) bits.push(p.missingDefaultCount + ' 处变量没有默认值');
        return bits.join(' · ');
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

    _loadSettings() {
        try {
            this.settings = normalizeWgtSettings(this._readJSON(SETTINGS_KEY));
        } catch (_e) { this.settings = { ...defaultWgtSettings() }; }
    }

    saveSettings() {
        this._writeJSON(SETTINGS_KEY, this.settings);
    }

    patchSettings(patch) {
        this.settings = normalizeWgtSettings({ ...this.settings, ...(patch || {}) });
        this.saveSettings();
    }

    /* ---------- 生命周期 ---------- */

    /** 换会话：组件与桌面上摆的都是「这个会话的」，故全部重取（草稿同步重取）。 */
    onChatChanged() {
        this._loadSettings();
        this.probe();
        if (this._view) this._view.refresh();
    }

    render() {
        this.probe();
        this._initHook();
        if (!this._view) {
            this._view = new WidgetView(this, this.shell, this.storage);
        }
        this._view.render();
    }
}