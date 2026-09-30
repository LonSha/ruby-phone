/* ========================================================
 * regexfilter-view.js — [v3.26.0] 正则过滤器 App 视图
 * 归因卡 + 统计卡 + 预设列表 + 规则编辑 + 实时预览 + 导入导出
 *
 * 与 focus-view / piggy-view 同纪律：归因文案表的键取 RGX_REASONS 的**值**（连字符形），
 *   不另写一套下划线形 —— 否则查不到会静默走兜底，多种处境显示成同一句话。
 *
 * 本视图**只画与派事件**：一切数据变动都回调到 App 的方法上（App 负责纯函数 + 落盘）。
 * 预览区**只读用户当场输入的测试文本**，绝不读消息 —— 见 App 文件头「零自动改写」。
 * ======================================================== */
'use strict';
import { RGX_REASONS, RGX_LIMITS } from './regexfilter-data.js';

const FACE_META = {
    [RGX_REASONS.ready]: { icon: '\u{1f9f9}', label: '已有规则集', tone: 'ok' },
    [RGX_REASONS.empty]: { icon: '\u{1f4e6}', label: '这个会话还没建过方案', tone: 'warn' },
    [RGX_REASONS.storage_absent]: { icon: '\u26a0\ufe0f', label: '存储不可用（读数拿不到）', tone: 'err' },
};

export class RegexFilterView {
    constructor(app, shell, storage) {
        this.app = app;
        this.shell = shell;
        this.storage = storage;
        this._root = null;
        /** 编辑区状态（纯视图态，不落盘）：正在编辑的规则行 */
        this._draft = [];
        this._editingId = '';
        /** 两步确认（删方案不可逆） */
        this._pendingConfirm = '';
    }

    render() {
        const container = this.shell && this.shell.getContentContainer ? this.shell.getContentContainer() : null;
        if (!container) return;
        container.innerHTML = '';
        this._root = document.createElement('div');
        this._root.className = 'rgx-root';
        this._root.innerHTML = this._buildHTML();
        container.appendChild(this._root);
        this._bindEvents();
    }

    refresh() {
        if (!this._root) return;
        this._root.innerHTML = this._buildHTML();
        this._bindEvents();
    }

    _buildHTML() {
        const app = this.app;
        const face = app.faceReason();
        const meta = FACE_META[face] || { icon: '\u2753', label: '未识别的状态：' + String(face), tone: 'warn' };
        const proj = app.projection() || { presetCount: 0, ruleCount: 0, invalidCount: 0, enabledCount: 0, boundCharCount: 0, hasAny: false };
        const settings = app.settings;
        const parts = [];

        parts.push('<div class="rgx-header"><h2>\u{1f9f9} 正则过滤器</h2></div>');

        parts.push('<div class="rgx-face rgx-face-' + meta.tone + '">');
        parts.push('<span class="rgx-face-icon">' + meta.icon + '</span>');
        parts.push('<span class="rgx-face-label">' + this._esc(meta.label) + '</span>');
        parts.push('</div>');

        parts.push('<div class="rgx-stats">');
        parts.push('<div class="rgx-stat-row"><span>方案</span><span>' + proj.presetCount + ' 个（启用 ' + proj.enabledCount + '）</span></div>');
        parts.push('<div class="rgx-stat-row"><span>规则</span><span>' + proj.ruleCount + ' 条</span></div>');
        parts.push('<div class="rgx-stat-row"><span>无效规则</span><span>' + (proj.invalidCount > 0 ? ('\u26a0\ufe0f ' + proj.invalidCount + ' 条') : '0 条') + '</span></div>');
        parts.push('<div class="rgx-stat-row"><span>已绑定角色</span><span>' + proj.boundCharCount + ' 个</span></div>');
        parts.push('</div>');

        /* ---------- 新建 / 编辑 ---------- */
        parts.push('<div class="rgx-create">');
        parts.push('<h3 class="rgx-list-title">' + (this._editingId ? '编辑方案' : '新建方案') + '</h3>');
        parts.push('<input class="rgx-input" id="rgx-name" type="text" maxlength="' + RGX_LIMITS.maxNameLen + '" placeholder="方案名（必填）" value="'
            + this._esc(this._draftName || '') + '">');
        parts.push('<div class="rgx-rules" id="rgx-rules">');
        const rows = this._draft.length ? this._draft : [{ pattern: '', replace: '' }];
        rows.forEach((r, i) => {
            parts.push('<div class="rgx-rule" data-i="' + i + '">');
            parts.push('<input class="rgx-input rgx-rule-pattern" type="text" placeholder="正则表达式，如：确实如此|不得不说" value="' + this._esc(r.pattern) + '">');
            parts.push('<input class="rgx-input rgx-rule-replace" type="text" placeholder="替换为（留空则删除匹配内容）" value="' + this._esc(r.replace) + '">');
            parts.push('<button class="rgx-mini rgx-rule-del" data-i="' + i + '">删</button>');
            parts.push('</div>');
        });
        parts.push('</div>');
        parts.push('<div class="rgx-rule-actions">');
        parts.push('<button class="rgx-mini" id="rgx-rule-add">+ 加一条规则</button>');
        parts.push('<button class="rgx-btn rgx-btn-primary" id="rgx-save">' + (this._editingId ? '保存修改' : '存为方案') + '</button>');
        if (this._editingId) parts.push('<button class="rgx-mini" id="rgx-cancel">取消编辑</button>');
        parts.push('</div>');
        parts.push('</div>');

        /* ---------- 预览（吃用户当场给的文本，不读消息） ---------- */
        parts.push('<div class="rgx-preview">');
        parts.push('<h3 class="rgx-list-title">预览</h3>');
        parts.push('<textarea class="rgx-input rgx-preview-in" id="rgx-test" placeholder="把一段文本粘进来试试规则（这里只测你贴的这段，不读聊天记录）"></textarea>');
        parts.push('<div class="rgx-preview-box" id="rgx-preview-box">（还没测）</div>');
        parts.push('<div class="rgx-errors" id="rgx-errors"></div>');
        parts.push('</div>');

        /* ---------- 方案列表 ---------- */
        const presets = app.presetsList();
        parts.push('<div class="rgx-list">');
        parts.push('<h3 class="rgx-list-title">方案（' + presets.length + '）</h3>');
        if (!presets.length) {
            parts.push('<div class="rgx-empty">还没有方案。上面写一条规则就能存下来。</div>');
        } else {
            for (const p of presets) {
                parts.push('<div class="rgx-preset" data-id="' + this._esc(p.id) + '">');
                parts.push('<div class="rgx-preset-name">' + this._esc(p.name) + '</div>');
                parts.push('<div class="rgx-preset-meta">' + p.rules.length + ' 条规则 · 绑定 '
                    + (p.boundChars.length ? (p.boundChars.length + ' 个角色') : '全部角色') + ' · ' + (p.enabled ? '启用' : '停用') + '</div>');
                parts.push('<div class="rgx-preset-tags">');
                parts.push('<button class="rgx-mini rgx-edit" data-id="' + this._esc(p.id) + '">编辑</button>');
                parts.push('<button class="rgx-mini rgx-toggle" data-id="' + this._esc(p.id) + '">' + (p.enabled ? '停用' : '启用') + '</button>');
                parts.push('<button class="rgx-mini rgx-export" data-id="' + this._esc(p.id) + '">导出脚本</button>');
                parts.push('<button class="rgx-mini rgx-del" data-id="' + this._esc(p.id) + '">删</button>');
                parts.push('</div>');
                parts.push('</div>');
            }
        }
        parts.push('</div>');

        /* ---------- 导入导出 ---------- */
        parts.push('<div class="rgx-settings">');
        parts.push('<h3 class="rgx-list-title">导入 / 导出</h3>');
        parts.push('<textarea class="rgx-input rgx-io" id="rgx-io" placeholder="导出后粘贴这里，或把别处的 JSON 粘进来再点导入"></textarea>');
        parts.push('<div class="rgx-rule-actions">');
        parts.push('<button class="rgx-mini" id="rgx-export-all">全部导出到上面</button>');
        parts.push('<button class="rgx-mini" id="rgx-import">从上面导入</button>');
        parts.push('</div>');
        parts.push('<label class="rgx-toggle"><span>预览时顺手清理连续空行</span>'
            + '<input type="checkbox" id="rgx-tidy"' + (settings.tidy ? ' checked' : '') + '></label>');
        parts.push('<div class="rgx-hint">这里只写规则、看效果、导出。它不会自动改你的聊天正文——'
            + '本机的正文过滤只有一处（生成前的标签过滤），规则交给你自己拿去用。</div>');
        parts.push('</div>');
        parts.push('<div class="rgx-hidden" id="rgx-sink"></div>');

        return parts.join('\n');
    }

    _bindEvents() {
        if (!this._root) return;
        const app = this.app;
        const q = (sel) => this._root.querySelector(sel);

        const nameEl = q('#rgx-name');
        if (nameEl) this._draftName = nameEl.value;

        for (const el of this._root.querySelectorAll('.rgx-rule-pattern')) el.addEventListener('input', () => this._pullDraft());
        for (const el of this._root.querySelectorAll('.rgx-rule-replace')) el.addEventListener('input', () => this._pullDraft());

        for (const btn of this._root.querySelectorAll('.rgx-rule-del')) {
            btn.addEventListener('click', () => {
                this._pullDraft();
                const i = Number(btn.dataset.i);
                this._draft.splice(i, 1);
                this.refresh();
            });
        }

        const addRule = q('#rgx-rule-add');
        if (addRule) addRule.addEventListener('click', () => {
            this._pullDraft();
            this._draft.push({ pattern: '', replace: '' });
            this.refresh();
        });

        const save = q('#rgx-save');
        if (save) save.addEventListener('click', () => {
            this._pullDraft();
            const rules = this._draft.filter((r) => String(r.pattern || '').trim());
            if (!nameEl || !String(nameEl.value || '').trim()) { this._flashError('名字必填'); return; }
            if (!rules.length) { this._flashError('至少写一条规则'); return; }
            const ok = app.savePreset({
                id: this._editingId || undefined,
                name: nameEl.value,
                rules,
                boundChars: [],
                enabled: true,
            });
            if (!ok) { this._flashError('这条没存上（检查规则是否为空）'); return; }
            this._draft = [];
            this._draftName = '';
            this._editingId = '';
            this.refresh();
        });

        const cancel = q('#rgx-cancel');
        if (cancel) cancel.addEventListener('click', () => {
            this._draft = []; this._draftName = ''; this._editingId = ''; this.refresh();
        });

        const test = q('#rgx-test');
        if (test) test.addEventListener('input', () => this._renderPreview());

        for (const btn of this._root.querySelectorAll('.rgx-edit')) {
            btn.addEventListener('click', () => {
                const p = app.presetsList().find((x) => x.id === btn.dataset.id);
                if (!p) return;
                this._editingId = p.id;
                this._draftName = p.name;
                this._draft = p.rules.map((r) => ({ pattern: r.pattern, replace: r.replace }));
                this.refresh();
            });
        }

        for (const btn of this._root.querySelectorAll('.rgx-toggle')) {
            btn.addEventListener('click', () => { app.togglePreset(btn.dataset.id); this.refresh(); });
        }

        for (const btn of this._root.querySelectorAll('.rgx-del')) {
            btn.addEventListener('click', () => {
                const id = btn.dataset.id;
                if (this._needConfirm('rgx-del:' + id, btn)) return;
                app.removePreset(id);
                this.refresh();
            });
        }

        for (const btn of this._root.querySelectorAll('.rgx-export')) {
            btn.addEventListener('click', () => {
                const scripts = app.exportScriptsFor(btn.dataset.id);
                const io = q('#rgx-io');
                if (io) io.value = JSON.stringify(scripts, null, 2);
            });
        }

        const exportAll = q('#rgx-export-all');
        if (exportAll) exportAll.addEventListener('click', () => {
            const io = q('#rgx-io');
            if (io) io.value = app.exportText();
        });

        const importBtn = q('#rgx-import');
        if (importBtn) importBtn.addEventListener('click', () => {
            const io = q('#rgx-io');
            const r = app.importText(io ? io.value : '');
            if (!r.ok) { this._flashError('导入失败：' + r.reason); return; }
            this.refresh();
        });

        const tidy = q('#rgx-tidy');
        if (tidy) tidy.addEventListener('change', (e) => {
            app.patchSettings({ tidy: e.target.checked });
            this._renderPreview();
        });

        this._renderPreview();
    }

    /** 把 DOM 里当前的规则行收回 `_draft`（重画前必调，否则用户打的字会丢）。 */
    _pullDraft() {
        if (!this._root) return;
        const rows = this._root.querySelectorAll('.rgx-rule');
        const out = [];
        for (const row of rows) {
            const p = row.querySelector('.rgx-rule-pattern');
            const r = row.querySelector('.rgx-rule-replace');
            out.push({ pattern: p ? p.value : '', replace: r ? r.value : '' });
        }
        if (out.length) this._draft = out;
    }

    /** 预览：跑 App.preview（只吃用户贴的文本），并把坏规则显式列出来。 */
    _renderPreview() {
        if (!this._root) return;
        const box = this._root.querySelector('#rgx-preview-box');
        const errBox = this._root.querySelector('#rgx-errors');
        const test = this._root.querySelector('#rgx-test');
        if (!box || !test) return;
        const src = String(test.value || '');
        if (!src) {
            box.textContent = '（还没测）';
            if (errBox) errBox.textContent = '';
            return;
        }
        this._pullDraft();
        const rules = this._draft.filter((r) => String(r.pattern || '').trim());
        const r = this.app.previewFromRules(rules, src);
        box.textContent = r.text || '（过滤后为空）';
        if (errBox) {
            errBox.textContent = r.errors && r.errors.length
                ? ('\u26a0\ufe0f ' + r.errors.length + ' 条规则写坏了，已跳过（没吞掉你的文本）：'
                    + r.errors.map((e) => e.pattern + ' → ' + e.message).join('；'))
                : '';
        }
    }

    _flashError(msg) {
        const box = this._root ? this._root.querySelector('#rgx-errors') : null;
        if (box) box.textContent = '\u26a0\ufe0f ' + msg;
    }

    /**
     * 两步确认（删方案不可逆，而本仓不弹宿主 confirm）。
     * 第一次点击把按钮变成「确认」，第二次才真执行；重画即复位。
     */
    _needConfirm(key, btn) {
        if (this._pendingConfirm === key) { this._pendingConfirm = ''; return false; }
        this._pendingConfirm = key;
        if (btn) { btn.textContent = '确认'; btn.classList.add('rgx-mini-armed'); }
        return true;
    }

    _esc(s) {
        return String(s === null || s === undefined ? '' : s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '\x26quot;');
    }
}