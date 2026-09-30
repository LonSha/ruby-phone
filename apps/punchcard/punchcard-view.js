/* ========================================================
 * punchcard-view.js — [v3.26.0] 打卡 App 视图
 * 归因卡 + 今日卡（勾选 / 备注 / 删项）+ 记一片段的表单 + 连续天数 + 历史列表 + 设置
 *
 * 与 focus-view / piggy-view 同纪律：归因文案表的键取 PUNCH_REASONS 的**值**（连字符形）。
 * 本视图**只画与派事件**：一切数据变动都回调到 App 的方法上（App 负责纯函数 + 落盘）。
 *
 * 勾选与备注的定位一律用 **data-id**（项 id），不用 data-index —— 删项后下标平移，
 * 按下标回写会把备注串到别的项上（数据层文件头偏离第 2 条记的就是这个形态）。
 * ======================================================== */
'use strict';
import { PUNCH_REASONS, PUNCH_ITEM_KINDS, PUNCH_LIMITS } from './punchcard-data.js';

const FACE_META = {
    [PUNCH_REASONS.ready]: { icon: '\u2705', label: '已有打卡记录', tone: 'ok' },
    [PUNCH_REASONS.empty]: { icon: '\u{1f4c5}', label: '这个会话还没打过卡', tone: 'warn' },
    [PUNCH_REASONS.storage_absent]: { icon: '\u26a0\ufe0f', label: '存储不可用（读数拿不到）', tone: 'err' },
};

const KIND_LABEL = { time: '时间点', duration: '时长' };

export class PunchcardView {
    constructor(app, shell, storage) {
        this.app = app;
        this.shell = shell;
        this.storage = storage;
        this._root = null;
        /** 新建区草稿（纯视图态，不落盘）：若干 `{ kind, at, label }` */
        this._draft = [];
        /** 两步确认 */
        this._pendingConfirm = '';
        /** 展开看历史里哪一张卡的明细（纯视图态） */
        this._openCardId = '';
    }

    render() {
        const container = this.shell && this.shell.getContentContainer ? this.shell.getContentContainer() : null;
        if (!container) return;
        container.innerHTML = '';
        this._root = document.createElement('div');
        this._root.className = 'pch-root';
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
        const proj = app.projection() || {
            cardCount: 0, itemCount: 0, doneCount: 0, streak: 0, todayKey: '', todayItemCount: 0,
            todayDoneCount: 0, todayCardId: '', hasAny: false,
        };
        const settings = app.settings;
        const parts = [];

        parts.push('<div class="pch-header"><h2>\u2705 打卡</h2></div>');

        parts.push('<div class="pch-face pch-face-' + meta.tone + '">');
        parts.push('<span class="pch-face-icon">' + meta.icon + '</span>');
        parts.push('<span class="pch-face-label">' + this._esc(meta.label) + '</span>');
        parts.push('</div>');

        parts.push('<div class="pch-streak">');
        parts.push('<div class="pch-streak-num">' + proj.streak + '</div>');
        parts.push('<div class="pch-streak-unit">天连续</div>');
        parts.push('</div>');

        parts.push('<div class="pch-stats">');
        parts.push('<div class="pch-stat-row"><span>今天（' + this._esc(proj.todayKey) + '）</span><span>'
            + proj.todayDoneCount + ' / ' + proj.todayItemCount + ' 项</span></div>');
        parts.push('<div class="pch-stat-row"><span>累计打卡</span><span>' + proj.cardCount + ' 天 · ' + proj.itemCount + ' 项</span></div>');
        parts.push('<div class="pch-stat-row"><span>累计完成</span><span>' + proj.doneCount + ' 项</span></div>');
        parts.push('</div>');

        /* ---------- 今天这张卡 ---------- */
        const cards = app.cardsList();
        const today = cards.find((c) => c.id === proj.todayCardId) || null;
        parts.push('<div class="pch-today">');
        parts.push('<h3 class="pch-list-title">今天的作息</h3>');
        if (!today) {
            parts.push('<div class="pch-empty">今天还没记。下面加一项就会开今天的卡。</div>');
        } else {
            if (today.targetName) parts.push('<div class="pch-target">给 ' + this._esc(today.targetName) + '</div>');
            for (const it of today.items) {
                parts.push('<div class="pch-item' + (it.done ? ' is-done' : '') + '" data-card="' + this._esc(today.id) + '" data-id="' + this._esc(it.id) + '">');
                parts.push('<label class="pch-item-main">');
                parts.push('<input type="checkbox" class="pch-item-check"' + (it.done ? ' checked' : '') + ' data-card="' + this._esc(today.id) + '" data-id="' + this._esc(it.id) + '">');
                parts.push('<span class="pch-item-at">' + this._esc(it.at || '') + '</span>');
                parts.push('<span class="pch-item-label">' + this._esc(it.label) + '</span>');
                parts.push('<span class="pch-item-kind">' + this._esc(KIND_LABEL[it.kind] || it.kind) + '</span>');
                parts.push('</label>');
                parts.push('<input class="pch-input pch-item-remark" type="text" maxlength="' + PUNCH_LIMITS.maxRemarkLen + '" placeholder="这一步怎么样（备注）" value="' + this._esc(it.remark) + '" data-card="' + this._esc(today.id) + '" data-id="' + this._esc(it.id) + '">');
                parts.push('<button class="pch-mini pch-item-del" data-card="' + this._esc(today.id) + '" data-id="' + this._esc(it.id) + '">删</button>');
                parts.push('</div>');
            }
        }
        parts.push('</div>');

        /* ---------- 加一项 ---------- */
        parts.push('<div class="pch-create">');
        parts.push('<h3 class="pch-list-title">' + (today ? '再添一项' : '记今天的作息') + '</h3>');
        const draft = this._draft.length ? this._draft : [{ kind: 'time', at: '', label: '' }];
        draft.forEach((d, i) => {
            parts.push('<div class="pch-draft" data-i="' + i + '">');
            parts.push('<select class="pch-input pch-draft-kind" data-i="' + i + '">');
            for (const k of PUNCH_ITEM_KINDS) {
                parts.push('<option value="' + this._esc(k) + '"' + (d.kind === k ? ' selected' : '') + '>' + this._esc(KIND_LABEL[k] || k) + '</option>');
            }
            parts.push('</select>');
            parts.push('<input class="pch-input pch-draft-at" type="text" maxlength="24" placeholder="' + (d.kind === 'duration' ? '如 30分钟' : '如 08:00') + '" value="' + this._esc(d.at) + '" data-i="' + i + '">');
            parts.push('<input class="pch-input pch-draft-label" type="text" maxlength="' + PUNCH_LIMITS.maxLabelLen + '" placeholder="做什么" value="' + this._esc(d.label) + '" data-i="' + i + '">');
            parts.push('<button class="pch-mini pch-draft-del" data-i="' + i + '">删</button>');
            parts.push('</div>');
        });
        parts.push('<div class="pch-actions">');
        parts.push('<button class="pch-mini" id="pch-add-item">+ 加一项</button>');
        parts.push('<button class="pch-btn pch-btn-primary" id="pch-save">存档</button>');
        parts.push('</div>');
        parts.push('<div class="pch-hint">同一天再存会**并到当天那张卡**里（不会开出第二张）。</div>');
        parts.push('</div>');

        /* ---------- 历史 ---------- */
        parts.push('<div class="pch-list">');
        parts.push('<h3 class="pch-list-title">历史（' + cards.length + '）</h3>');
        if (!cards.length) {
            parts.push('<div class="pch-empty">还没有卡。</div>');
        } else {
            for (const c of cards) {
                const doneN = c.items.filter((x) => x.done).length;
                parts.push('<div class="pch-hist' + (this._openCardId === c.id ? ' is-open' : '') + '">');
                parts.push('<div class="pch-hist-head" data-id="' + this._esc(c.id) + '">');
                parts.push('<span class="pch-hist-date">' + this._esc(c.date) + '</span>');
                parts.push('<span class="pch-hist-meta">' + doneN + ' / ' + c.items.length + (c.targetName ? (' · ' + this._esc(c.targetName)) : '') + '</span>');
                parts.push('<button class="pch-mini pch-hist-del" data-id="' + this._esc(c.id) + '">删</button>');
                parts.push('</div>');
                if (this._openCardId === c.id) {
                    for (const it of c.items) {
                        parts.push('<div class="pch-hist-item">' + (it.done ? '\u2705 ' : '\u25cb ') + this._esc(it.at || '') + ' ' + this._esc(it.label)
                            + (it.remark ? (' <em>（' + this._esc(it.remark) + '）</em>') : '') + '</div>');
                    }
                }
                parts.push('</div>');
            }
        }
        parts.push('</div>');

        /* ---------- 设置 ---------- */
        parts.push('<div class="pch-settings">');
        parts.push('<h3 class="pch-list-title">设置</h3>');
        parts.push('<label class="pch-toggle"><span>把今日进度交给生成侧</span>'
            + '<input type="checkbox" id="pch-inject"' + (settings.injectToPrompt ? ' checked' : '') + '></label>');
        parts.push('<label class="pch-field"><span>注入时带几个「还没做」</span>'
            + '<input type="number" id="pch-max-inject" min="0" max="20" value="' + settings.maxInjectItems + '"></label>');
        parts.push('<label class="pch-field"><span>最多留几天</span>'
            + '<input type="number" id="pch-max-cards" min="7" max="400" value="' + settings.maxCards + '"></label>');
        parts.push('<div class="pch-hint">换角色 / 换会话后，这份作息和上一个角色的是分开的两份。'
            + '本 App 只记你自己填的东西：不替你去问模型，也不碰聊天记录。</div>');
        parts.push('</div>');

        return parts.join('\n');
    }

    _bindEvents() {
        if (!this._root) return;
        const app = this.app;
        const q = (sel) => this._root.querySelector(sel);

        /* 勾选：按 id 定位 */
        for (const cb of this._root.querySelectorAll('.pch-item-check')) {
            cb.addEventListener('change', (e) => {
                app.toggleItem(cb.dataset.card, cb.dataset.id, e.target.checked);
                this.refresh();
            });
        }

        /* 备注：失焦时写回（按 id；不按下标） */
        for (const inp of this._root.querySelectorAll('.pch-item-remark')) {
            inp.addEventListener('change', () => {
                app.setItemRemark(inp.dataset.card, inp.dataset.id, inp.value);
                this.refresh();
            });
        }

        for (const btn of this._root.querySelectorAll('.pch-item-del')) {
            btn.addEventListener('click', () => {
                app.deleteItem(btn.dataset.card, btn.dataset.id);
                this.refresh();
            });
        }

        /* 草稿区 */
        for (const el of this._root.querySelectorAll('.pch-draft-kind')) {
            el.addEventListener('change', () => { this._pullDraft(); this.refresh(); });
        }
        for (const el of this._root.querySelectorAll('.pch-draft-at, .pch-draft-label')) {
            el.addEventListener('input', () => this._pullDraft());
        }
        for (const btn of this._root.querySelectorAll('.pch-draft-del')) {
            btn.addEventListener('click', () => {
                this._pullDraft();
                this._draft.splice(Number(btn.dataset.i), 1);
                this.refresh();
            });
        }

        const addItem = q('#pch-add-item');
        if (addItem) addItem.addEventListener('click', () => {
            this._pullDraft();
            this._draft.push({ kind: 'time', at: '', label: '' });
            this.refresh();
        });

        const save = q('#pch-save');
        if (save) save.addEventListener('click', () => {
            this._pullDraft();
            const items = this._draft
                .filter((d) => String(d.label || '').trim())
                .map((d) => ({ kind: d.kind, at: d.at, label: d.label }));
            if (!items.length) { this._flash('至少写一项「做什么」'); return; }
            const added = app.addCard({ items });
            if (!added) { this._flash('没存上（检查内容是否为空）'); return; }
            this._draft = [];
            this.refresh();
        });

        /* 历史：展开 / 删除 */
        for (const head of this._root.querySelectorAll('.pch-hist-head')) {
            head.addEventListener('click', (e) => {
                if (e.target && e.target.classList && e.target.classList.contains('pch-hist-del')) return;
                const id = head.dataset.id;
                this._openCardId = (this._openCardId === id) ? '' : id;
                this.refresh();
            });
        }
        for (const btn of this._root.querySelectorAll('.pch-hist-del')) {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const id = btn.dataset.id;
                if (this._needConfirm('pch-del:' + id, btn)) return;
                app.deleteCard(id);
                if (this._openCardId === id) this._openCardId = '';
                this.refresh();
            });
        }

        /* 设置 */
        const inject = q('#pch-inject');
        if (inject) inject.addEventListener('change', (e) => {
            app.settings = { ...app.settings, injectToPrompt: e.target.checked };
            app.saveSettings();
        });
        const maxInject = q('#pch-max-inject');
        if (maxInject) maxInject.addEventListener('change', (e) => app.patchSettings({ maxInjectItems: e.target.value }));
        const maxCards = q('#pch-max-cards');
        if (maxCards) maxCards.addEventListener('change', (e) => app.patchSettings({ maxCards: e.target.value }));
    }

    /** 把 DOM 里的草稿收回 `_draft`（重画前必调，否则用户打的字会丢）。 */
    _pullDraft() {
        if (!this._root) return;
        const rows = this._root.querySelectorAll('.pch-draft');
        const out = [];
        for (const row of rows) {
            const k = row.querySelector('.pch-draft-kind');
            const a = row.querySelector('.pch-draft-at');
            const l = row.querySelector('.pch-draft-label');
            out.push({ kind: k ? k.value : 'time', at: a ? a.value : '', label: l ? l.value : '' });
        }
        if (out.length) this._draft = out;
    }

    _flash(msg) {
        const box = this._root ? this._root.querySelector('.pch-hint') : null;
        if (box) box.textContent = '\u26a0\ufe0f ' + msg;
    }

    /** 两步确认（删卡不可逆，而本仓不弹宿主 confirm）。 */
    _needConfirm(key, btn) {
        if (this._pendingConfirm === key) { this._pendingConfirm = ''; return false; }
        this._pendingConfirm = key;
        if (btn) { btn.textContent = '确认'; btn.classList.add('pch-mini-armed'); }
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