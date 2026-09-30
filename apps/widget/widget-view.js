/* ========================================================
 * widget-view.js — [v3.28.0] 自定义组件 App 视图
 * 归因卡 + 组件库（新建 / 编辑 / 删除 / 摆到桌面）+ 桌面实例（改变量值）+ 变量对账 + 导入导出 + 设置
 *
 * 与 focus-view / piggy-view / punchcard-view / regexfilter-view / weather-view 同纪律：
 * 归因文案表的键取 WGT_REASONS 的**值**；本视图**只画与派事件**，
 * 一切数据变动都回调到 App 的方法上（App 负责纯函数 + 落盘）。
 *
 * 四处「不糊弄」：
 *   · 组件代码是**文本**，本视图**不执行它**（源 `new Function(js)` 跑用户代码，本仓零动态求值）；
 *   · HTML 声明的变量 ↔ 默认值**两向对账**，漏配与死值都点名（源那边只是显示空白，看不出问题）；
 *   · 导出**剔掉图片值与实例数据**（源的隐私口径照搬），并且明说「本应用不执行这些代码」；
 *   · 尺寸、上限、失败原因全部来自数据层的真源常量，视图不自己编数。
 * ======================================================== */
'use strict';
import { WGT_REASONS, WGT_LIMITS, WGT_SIZES } from './widget-data.js';

const FACE_META = {
    [WGT_REASONS.ready]: { icon: '\u2705', label: '有组件', tone: 'ok' },
    [WGT_REASONS.empty]: { icon: '\u{1f9f1}', label: '还没建过组件', tone: 'warn' },
    [WGT_REASONS.storage_absent]: { icon: '\u26a0\ufe0f', label: '存储不可用（读数拿不到）', tone: 'err' },
};

const SIZE_LABEL = { '1x1': '1\u00d71 小', '2x2': '2\u00d72 方', '4x2': '4\u00d72 宽', '4x4': '4\u00d74 大' };

/** 源那四个示例模板的**结构**（源里是 `CUSTOM_WIDGET_EXAMPLES`；这里只留骨架名，代码是空白的）。 */
const EXAMPLES = [
    { key: 'blank', label: '空白', html: '<div class="wg-plain">\n  <span data-widget-var="text" data-widget-type="text"></span>\n</div>', css: '.wg-plain { width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; }' },
    { key: 'note', label: '便签', html: '<div class="wg-note">\n  <h4 data-widget-var="title" data-widget-type="text"></h4>\n  <p data-widget-var="body" data-widget-type="text"></p>\n</div>', css: '.wg-note { width: 100%; height: 100%; padding: 12px; box-sizing: border-box; border-radius: 16px; background: #fffbe8; }' },
    { key: 'photo', label: '相框', html: '<div class="wg-photo" data-widget-var="photo" data-widget-type="image"></div>', css: '.wg-photo { width: 100%; height: 100%; border-radius: 16px; background-size: cover; background-position: center; background-color: #eee; }' },
    { key: 'counter', label: '计数牌', html: '<div class="wg-count">\n  <b data-widget-var="count" data-widget-type="text"></b>\n  <span data-widget-var="label" data-widget-type="text"></span>\n</div>', css: '.wg-count { width: 100%; height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px; }' },
];

export class WidgetView {
    constructor(app, shell, storage) {
        this.app = app;
        this.shell = shell;
        this.storage = storage;
        this._root = null;
        /** 编辑器草稿（纯视图态；点「存为草稿」才交给 App 落盘） */
        this._edit = null;
        /** 键盘焦点记到哪个实例的哪个变量（刷新后还回去） */
        this._focus = null;
        this._pendingConfirm = '';
        this._flash = '';
        this._importText = '';
    }

    render() {
        const container = this.shell && this.shell.getContentContainer ? this.shell.getContentContainer() : null;
        if (!container) return;
        container.innerHTML = '';
        this._root = document.createElement('div');
        this._root.className = 'wgt-root';
        this._root.innerHTML = this._buildHTML();
        container.appendChild(this._root);
        this._bindEvents();
    }

    refresh() {
        if (!this._root) return;
        this._root.innerHTML = this._buildHTML();
        this._bindEvents();
    }

    /* ---------- 编辑器草稿 ---------- */

    _newDraft(seed) {
        const s = (seed && typeof seed === 'object') ? seed : {};
        return {
            id: s.id || null,
            name: s.name || '',
            size: WGT_SIZES.includes(s.size) ? s.size : (this.app.settings.defaultSize || '2x2'),
            html: s.html || '',
            css: s.css || '',
            notes: s.notes || '',
            defaults: { ...(s.defaults || {}) },
        };
    }

    _restoreDraft() {
        const d = this.app.draftSnapshot();
        if (d && typeof d.edit === 'object' && d.edit) this._edit = this._newDraft(d.edit);
        if (d && typeof d.importText === 'string') this._importText = d.importText;
    }

    _persistDraft() {
        this.app.saveDraft({ edit: this._edit, importText: this._importText });
    }

    /* ---------- 渲染 ---------- */

    _buildHTML() {
        const app = this.app;
        const face = app.faceReason();
        const meta = FACE_META[face] || { icon: '\u2753', label: '未识别的状态：' + String(face), tone: 'warn' };
        const proj = app.projection() || { templateCount: 0, instanceCount: 0, varCount: 0, imageVarCount: 0, missingDefaultCount: 0, orphanCount: 0, bySize: {}, hasAny: false };
        const limits = app.limits();
        const settings = app.settings;
        const parts = [];

        parts.push('<div class="wgt-header"><h2>\u{1f9f1} 自定义组件</h2></div>');

        parts.push('<div class="wgt-face wgt-face-' + meta.tone + '">');
        parts.push('<span class="wgt-face-icon">' + meta.icon + '</span>');
        parts.push('<span class="wgt-face-label">' + this._esc(meta.label) + '</span>');
        parts.push('</div>');

        /* 读数条：全部来自投影，视图不自己数 */
        parts.push('<div class="wgt-stats">');
        parts.push('<span class="wgt-stat"><b>' + proj.templateCount + '</b> 个组件</span>');
        parts.push('<span class="wgt-stat"><b>' + proj.instanceCount + '</b> 个摆在桌面</span>');
        parts.push('<span class="wgt-stat"><b>' + proj.varCount + '</b> 个变量（' + proj.imageVarCount + ' 个图片位）</span>');
        if (proj.missingDefaultCount > 0) {
            parts.push('<span class="wgt-stat wgt-stat-warn"><b>' + proj.missingDefaultCount + '</b> 处没有默认值</span>');
        }
        if (proj.orphanCount > 0) {
            parts.push('<span class="wgt-stat wgt-stat-warn"><b>' + proj.orphanCount + '</b> 个的原组件已删</span>');
        }
        parts.push('</div>');

        if (this._flash) {
            parts.push('<div class="wgt-flash">' + this._esc(this._flash) + '</div>');
        }

        /* 一句说明：本件不执行代码 —— 这条必须一直可见，不能藏在详情里 */
        parts.push('<p class="wgt-note">这里**只保存与整理**组件代码，**不执行**它（运行请把代码贴到你自己的环境里）。图片与「我用它干过什么」不会随导出带走。</p>');

        parts.push(this._htmlEditor(limits));
        parts.push(this._htmlTemplates(proj, limits));
        parts.push(this._htmlInstances(proj));
        parts.push(this._htmlIO(limits));
        parts.push(this._htmlSettings(settings, limits));

        return parts.join('');
    }

    /* ---------- 编辑器 ---------- */

    _htmlEditor(limits) {
        const e = this._edit;
        const parts = [];
        parts.push('<section class="wgt-sec">');
        parts.push('<h3>' + (e && e.id ? '编辑组件' : '新建组件') + '</h3>');

        if (!e) {
            parts.push('<div class="wgt-row wgt-examples">');
            parts.push('<span class="wgt-lbl">从骨架开始：</span>');
            for (const ex of EXAMPLES) {
                parts.push('<button class="wgt-btn wgt-btn-mini" data-act="example" data-key="' + ex.key + '">' + this._esc(ex.label) + '</button>');
            }
            parts.push('<button class="wgt-btn wgt-btn-mini" data-act="new-blank">空白开始</button>');
            parts.push('</div>');
            parts.push('<div class="wgt-row">');
            parts.push('<button class="wgt-btn" data-act="ai-prompt">生成给 AI 的说明</button>');
            parts.push('<span class="wgt-hint">写清需求 → 复制这段说明发给 AI → 把它给的代码粘回下面</span>');
            parts.push('</div>');
            parts.push('</section>');
            return parts.join('');
        }

        const varsNow = this.app.varsOf(e.html);
        parts.push('<div class="wgt-row">');
        parts.push('<label class="wgt-lbl">名称</label>');
        parts.push('<input class="wgt-inp" id="wgt-edit-name" maxlength="' + limits.maxNameLen + '" value="' + this._esc(e.name) + '" placeholder="比如：今日便签">');
        parts.push('<label class="wgt-lbl">尺寸</label>');
        parts.push('<select class="wgt-inp" id="wgt-edit-size">');
        for (const s of WGT_SIZES) {
            parts.push('<option value="' + s + '"' + (s === e.size ? ' selected' : '') + '>' + this._esc(SIZE_LABEL[s] || s) + '</option>');
        }
        parts.push('</select>');
        parts.push('</div>');

        parts.push('<div class="wgt-field">');
        parts.push('<label class="wgt-lbl">HTML（可替换处写 <code>data-widget-var="名字"</code>；图片位再加 <code>data-widget-type="image"</code>）</label>');
        parts.push('<textarea class="wgt-code" id="wgt-edit-html" rows="6" spellcheck="false" maxlength="' + limits.maxHtmlLen + '">' + this._esc(e.html) + '</textarea>');
        parts.push('</div>');

        parts.push('<div class="wgt-field">');
        parts.push('<label class="wgt-lbl">CSS</label>');
        parts.push('<textarea class="wgt-code" id="wgt-edit-css" rows="5" spellcheck="false">' + this._esc(e.css) + '</textarea>');
        parts.push('</div>');

        parts.push('<div class="wgt-field">');
        parts.push('<label class="wgt-lbl">备注（不执行；脚本交互写这里，留着自己贴到运行环境）</label>');
        parts.push('<textarea class="wgt-code" id="wgt-edit-notes" rows="3" spellcheck="false" maxlength="' + limits.maxNotesLen + '">' + this._esc(e.notes) + '</textarea>');
        parts.push('</div>');

        /* 变量清单：现抽的（e.html）与默认值对账 */
        parts.push('<div class="wgt-field">');
        parts.push('<label class="wgt-lbl">这个组件里的变量（' + varsNow.length + ' 个，上限 ' + limits.maxVars + '）</label>');
        if (!varsNow.length) {
            parts.push('<p class="wgt-hint">还没有可替换的变量。想让它能改，就在 HTML 里给对应位置写上 data-widget-var。</p>');
        } else {
            parts.push('<div class="wgt-vars">');
            for (const v of varsNow) {
                const val = (v.name in e.defaults) ? e.defaults[v.name] : '';
                parts.push('<div class="wgt-var-row">');
                parts.push('<span class="wgt-var-name">' + this._esc(v.name) + '</span>');
                parts.push('<span class="wgt-var-type">' + (v.type === 'image' ? '图片' : '文本') + '</span>');
                parts.push('<input class="wgt-inp wgt-var-val" data-var="' + this._esc(v.name) + '" value="' + this._esc(val) + '" placeholder="默认值" maxlength="' + limits.maxVarValueLen + '">');
                parts.push('</div>');
            }
            parts.push('</div>');
        }
        parts.push('</div>');

        parts.push('<div class="wgt-row">');
        parts.push('<button class="wgt-btn wgt-btn-primary" data-act="edit-save">' + (e.id ? '保存' : '存进组件库') + '</button>');
        parts.push('<button class="wgt-btn" data-act="edit-draft">存为草稿</button>');
        parts.push('<button class="wgt-btn" data-act="edit-cancel">取消</button>');
        parts.push('</div>');
        parts.push('</section>');
        return parts.join('');
    }

    /* ---------- 组件库 ---------- */

    _htmlTemplates(proj, limits) {
        const list = this.app.templateList();
        const parts = [];
        parts.push('<section class="wgt-sec">');
        parts.push('<h3>组件库（' + list.length + '/' + limits.maxTemplates + '）</h3>');
        if (!list.length) {
            parts.push('<p class="wgt-empty">还没有组件。上面从骨架开始建一个。</p>');
        } else {
            parts.push('<div class="wgt-list">');
            for (const t of list) {
                const rec = this.app.reconcile(t);
                parts.push('<div class="wgt-card">');
                parts.push('<div class="wgt-card-head">');
                parts.push('<b class="wgt-card-name">' + this._esc(t.name) + '</b>');
                parts.push('<span class="wgt-tag">' + this._esc(SIZE_LABEL[t.size] || t.size) + '</span>');
                parts.push('</div>');
                parts.push('<div class="wgt-card-meta">' + rec.declared.length + ' 个变量');
                if (rec.missingDefaults.length) {
                    parts.push('<span class="wgt-warn">· 漏配 ' + this._esc(rec.missingDefaults.join('、')) + '</span>');
                }
                if (rec.orphanDefaults.length) {
                    parts.push('<span class="wgt-warn">· 死值 ' + this._esc(rec.orphanDefaults.join('、')) + '</span>');
                }
                parts.push('</div>');
                parts.push('<div class="wgt-card-acts">');
                parts.push('<button class="wgt-btn wgt-btn-mini" data-act="tpl-edit" data-id="' + this._esc(t.id) + '">编辑</button>');
                parts.push('<button class="wgt-btn wgt-btn-mini" data-act="tpl-add" data-id="' + this._esc(t.id) + '">摆到桌面</button>');
                parts.push('<button class="wgt-btn wgt-btn-mini" data-act="tpl-export" data-id="' + this._esc(t.id) + '">导出这个</button>');
                parts.push('<button class="wgt-btn wgt-btn-mini wgt-btn-danger" data-act="tpl-del" data-id="' + this._esc(t.id) + '">' + (this._pendingConfirm === 'tpl:' + t.id ? '再点一次确认' : '删除') + '</button>');
                parts.push('</div>');
                parts.push('</div>');
            }
            parts.push('</div>');
        }
        parts.push('</section>');
        return parts.join('');
    }

    /* ---------- 桌面实例 ---------- */

    _htmlInstances(proj) {
        const list = this.app.instanceList();
        const tmap = new Map(this.app.templateList().map((t) => [t.id, t]));
        const parts = [];
        parts.push('<section class="wgt-sec">');
        parts.push('<h3>桌面上的组件（' + list.length + '）</h3>');
        if (!list.length) {
            parts.push('<p class="wgt-empty">桌面还空着。从上面挑一个「摆到桌面」。</p>');
        } else {
            parts.push('<div class="wgt-insts">');
            for (const inst of list) {
                const t = tmap.get(inst.templateId) || null;
                const focusKey = inst.id + ':' + (this._focus && this._focus.instanceId === inst.id ? this._focus.varName : '');
                parts.push('<div class="wgt-inst">');
                parts.push('<div class="wgt-inst-head">');
                parts.push('<b>' + this._esc(inst.name || (t ? t.name : '（原组件已删）')) + '</b>');
                parts.push('<span class="wgt-tag">' + this._esc(SIZE_LABEL[inst.size] || inst.size) + '</span>');
                if (!t) parts.push('<span class="wgt-warn">原组件已删</span>');
                parts.push('<button class="wgt-btn wgt-btn-mini wgt-btn-danger" data-act="inst-del" data-id="' + this._esc(inst.id) + '">' + (this._pendingConfirm === 'inst:' + inst.id ? '再点一次确认' : '拿走') + '</button>');
                parts.push('</div>');
                if (t && t.vars.length) {
                    parts.push('<div class="wgt-inst-vars">');
                    for (const v of t.vars) {
                        const val = inst.vars[v.name] === undefined ? '' : inst.vars[v.name];
                        const focused = (this._focus && this._focus.instanceId === inst.id && this._focus.varName === v.name) ? ' data-focus="1"' : '';
                        parts.push('<label class="wgt-inst-var">');
                        parts.push('<span class="wgt-var-name">' + this._esc(v.name) + (v.type === 'image' ? ' · 图片' : '') + '</span>');
                        parts.push('<input class="wgt-inp" data-inst="' + this._esc(inst.id) + '" data-var="' + this._esc(v.name) + '" value="' + this._esc(val) + '" placeholder="' + (v.type === 'image' ? '贴图片地址' : '填点什么') + '" maxlength="' + WGT_LIMITS.maxVarValueLen + '"' + focused + '>');
                        parts.push('</label>');
                    }
                    parts.push('</div>');
                }
                parts.push('</div>');
            }
            parts.push('</div>');
        }
        parts.push('</section>');
        return parts.join('');
    }

    /* ---------- 导入导出 ---------- */

    _htmlIO(limits) {
        const parts = [];
        parts.push('<section class="wgt-sec">');
        parts.push('<h3>导入 / 导出</h3>');
        parts.push('<div class="wgt-row">');
        parts.push('<button class="wgt-btn" data-act="export-all">导出全部组件（复制用）</button>');
        parts.push('<span class="wgt-hint">导出的是设计稿：名称、尺寸、代码、变量声明与文本默认值；**图片值与「我用它干过什么」不带**。</span>');
        parts.push('</div>');
        parts.push('<div class="wgt-field">');
        parts.push('<label class="wgt-lbl">把导出的内容（或别人给的组件）粘在这里，然后点导入</label>');
        parts.push('<textarea class="wgt-code" id="wgt-import" rows="4" spellcheck="false" placeholder=\'{ "kind": "ruby-phone.widget", "templates": [ ... ] }\'>' + this._esc(this._importText) + '</textarea>');
        parts.push('</div>');
        parts.push('<div class="wgt-row">');
        parts.push('<button class="wgt-btn wgt-btn-primary" data-act="import">导入</button>');
        parts.push('<button class="wgt-btn" data-act="import-clear">清空这格</button>');
        parts.push('</div>');
        parts.push('<textarea class="wgt-code wgt-out" id="wgt-out" rows="6" readonly hidden></textarea>');
        parts.push('</section>');
        return parts.join('');
    }

    /* ---------- 设置 ---------- */

    _htmlSettings(settings, limits) {
        const parts = [];
        parts.push('<section class="wgt-sec">');
        parts.push('<h3>设置</h3>');
        parts.push('<label class="wgt-check"><input type="checkbox" id="wgt-set-inject"' + (settings.injectToPrompt ? ' checked' : '') + '> 把桌面上有什么组件告诉生成侧</label>');
        parts.push('<div class="wgt-row">');
        parts.push('<label class="wgt-lbl">最多注入</label>');
        parts.push('<input class="wgt-inp wgt-num" type="number" id="wgt-set-lines" min="0" max="12" value="' + settings.maxInjectLines + '">');
        parts.push('<span class="wgt-hint">条（0 = 不注入）</span>');
        parts.push('</div>');
        parts.push('<div class="wgt-row">');
        parts.push('<label class="wgt-lbl">新建默认尺寸</label>');
        parts.push('<select class="wgt-inp" id="wgt-set-size">');
        for (const s of WGT_SIZES) {
            parts.push('<option value="' + s + '"' + (s === settings.defaultSize ? ' selected' : '') + '>' + this._esc(SIZE_LABEL[s] || s) + '</option>');
        }
        parts.push('</select>');
        parts.push('</div>');
        parts.push('<p class="wgt-hint">注入只带文字变量的值，不带图片地址（图片是本机的，不该进上下文）。</p>');
        parts.push('</section>');
        return parts.join('');
    }

    /* ---------- 事件 ---------- */

    _bindEvents() {
        const root = this._root;
        if (!root) return;
        this._restoreDraft();

        const cont = this.shell && this.shell.getContentContainer ? this.shell.getContentContainer() : null;
        if (cont && !cont.__wgtBound) {
            cont.__wgtBound = true;
            cont.addEventListener('click', (ev) => this._onClick(ev));
            cont.addEventListener('input', (ev) => this._onInput(ev));
            cont.addEventListener('change', (ev) => this._onInput(ev));
        }

        // 把焦点还回去（刷新会把 DOM 重建）
        if (this._focus) {
            const el = root.querySelector('input[data-focus="1"]');
            if (el && el.focus) { try { el.focus(); } catch (_e) { /* 忽略 */ } }
            this._focus = null;
        }
    }

    _onClick(ev) {
        const btn = ev.target && ev.target.closest ? ev.target.closest('[data-act]') : null;
        if (!btn) return;
        const act = btn.getAttribute('data-act');
        const id = btn.getAttribute('data-id') || '';
        const key = btn.getAttribute('data-key') || '';

        if (act === 'new-blank') { this._edit = this._newDraft(null); this._pendingConfirm = ''; this.refresh(); return; }
        if (act === 'example') {
            const ex = EXAMPLES.find((x) => x.key === key);
            if (ex) this._edit = this._newDraft({ name: '', size: '2x2', html: ex.html, css: ex.css });
            this._pendingConfirm = '';
            this.refresh();
            return;
        }
        if (act === 'edit-cancel') { this._edit = null; this._persistDraft(); this.refresh(); return; }
        if (act === 'edit-draft') { this._collectEdit(); this._persistDraft(); this._flash = '草稿已存（下次打开这个组件还在）'; this.refresh(); return; }
        if (act === 'edit-save') {
            this._collectEdit();
            const e = this._edit;
            if (!e) return;
            const r = this.app.saveTemplate({ id: e.id, name: e.name, size: e.size, html: e.html, css: e.css, notes: e.notes, defaults: e.defaults });
            if (!r.ok) { this._flash = r.error; this.refresh(); return; }
            this._edit = null;
            this.app.clearDraft();
            this._flash = '已存进组件库';
            this.refresh();
            return;
        }
        if (act === 'ai-prompt') {
            const txt = this.app.aiPromptText('', null);
            this._showOut(txt);
            this._flash = '说明已放进下面的框，长按复制后发给 AI';
            this.refresh();
            this._showOut(txt);
            return;
        }
        if (act === 'tpl-edit') {
            const t = this.app.templateList().find((x) => x.id === id);
            if (t) this._edit = this._newDraft(t);
            this._pendingConfirm = '';
            this.refresh();
            return;
        }
        if (act === 'tpl-add') {
            const r = this.app.addInstance(id);
            this._flash = r.ok ? '已摆到桌面' : r.error;
            this.refresh();
            return;
        }
        if (act === 'tpl-export') {
            const txt = this.app.exportTextOf(id);
            this._showOut(txt);
            this._flash = txt ? '已生成，长按复制' : '导不出来';
            this.refresh();
            this._showOut(txt);
            return;
        }
        if (act === 'tpl-del') {
            if (this._pendingConfirm !== 'tpl:' + id) { this._pendingConfirm = 'tpl:' + id; this._flash = '再点一次就删了'; this.refresh(); return; }
            const r = this.app.deleteTemplate(id);
            this._pendingConfirm = '';
            this._flash = r.ok ? '已删除' : r.error;
            this.refresh();
            return;
        }
        if (act === 'inst-del') {
            if (this._pendingConfirm !== 'inst:' + id) { this._pendingConfirm = 'inst:' + id; this._flash = '再点一次就从桌面拿走'; this.refresh(); return; }
            const r = this.app.removeInstance(id);
            this._pendingConfirm = '';
            this._flash = r.ok ? '已从桌面拿走' : r.error;
            this.refresh();
            return;
        }
        if (act === 'export-all') {
            const txt = this.app.exportText();
            this._showOut(txt);
            this._flash = '已生成全部组件，长按复制';
            this.refresh();
            this._showOut(txt);
            return;
        }
        if (act === 'import') { this._collectImport(); return; }
        if (act === 'import-clear') { this._importText = ''; this._persistDraft(); this.refresh(); return; }
    }

    _onInput(ev) {
        const el = ev.target;
        if (!el) return;
        if (el.id === 'wgt-set-inject') { this.app.patchSettings({ injectToPrompt: !!el.checked }); this.refresh(); return; }
        if (el.id === 'wgt-set-lines') { this.app.patchSettings({ maxInjectLines: el.value }); return; }
        if (el.id === 'wgt-set-size') { this.app.patchSettings({ defaultSize: el.value }); this.refresh(); return; }
        if (el.id === 'wgt-import') { this._importText = el.value; return; }
        if (el.id === 'wgt-edit-name' || el.id === 'wgt-edit-size' || el.id === 'wgt-edit-html' || el.id === 'wgt-edit-css' || el.id === 'wgt-edit-notes') {
            this._collectEdit({ silent: true });
            // HTML 变了 → 变量清单跟着变（重画一次让人当场看见）
            if (el.id === 'wgt-edit-html') this.refresh();
            return;
        }
        if (el.hasAttribute && el.hasAttribute('data-inst') && el.hasAttribute('data-var')) {
            const iid = el.getAttribute('data-inst');
            const vn = el.getAttribute('data-var');
            this._focus = { instanceId: iid, varName: vn };
            const r = this.app.setVar(iid, vn, el.value);
            if (!r.ok) { this._flash = r.error; this.refresh(); return; }
            this.refresh();
            return;
        }
        if (el.hasAttribute && el.hasAttribute('data-var') && !el.hasAttribute('data-inst')) {
            if (!this._edit) return;
            this._edit.defaults[el.getAttribute('data-var')] = el.value;
            return;
        }
    }

    /** 从 DOM 里把编辑器里当前的值收回草稿（`silent` 时不刷新）。 */
    _collectEdit(opts) {
        if (!this._edit || !this._root) return;
        const q = (id) => this._root.querySelector('#' + id);
        const name = q('wgt-edit-name'); if (name) this._edit.name = name.value;
        const size = q('wgt-edit-size'); if (size) this._edit.size = size.value;
        const html = q('wgt-edit-html'); if (html) this._edit.html = html.value;
        const css = q('wgt-edit-css'); if (css) this._edit.css = css.value;
        const notes = q('wgt-edit-notes'); if (notes) this._edit.notes = notes.value;
        const defs = this._root.querySelectorAll('input[data-var]:not([data-inst])');
        for (const el of defs) this._edit.defaults[el.getAttribute('data-var')] = el.value;
        if (!opts || !opts.silent) { /* 调用方决定要不要刷新 */ }
    }

    _collectImport() {
        const el = this._root ? this._root.querySelector('#wgt-import') : null;
        if (el) this._importText = el.value;
        const r = this.app.importText(this._importText);
        this._flash = r.ok ? ('导入了 ' + r.added + ' 个组件') : r.error;
        if (r.ok) { this._importText = ''; this.app.clearDraft(); }
        this.refresh();
    }

    _showOut(txt) {
        const out = this._root ? this._root.querySelector('#wgt-out') : null;
        if (!out) return;
        out.hidden = false;
        out.value = txt || '';
        try { if (out.select) out.select(); } catch (_e) { /* 忽略 */ }
    }

    _esc(s) {
        return String(s === null || s === undefined ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }
}