/* ========================================================
 * punchcard-view.js — [v4.167.0]「照现实重写」· 打卡 App 视图
 * --------------------------------------------------------
 * 上一版的形态：一页到底 —— 归因卡 + 连续天数 + 统计 + 今天的清单 + 草稿表单 + 历史 + 设置，
 *   全挤在一列里；事件按类名逐元素绑（每次重绘都重新绑一遍）。
 * 现实里的打卡 App 是三块：**今天**（这份作息现在怎么样）→ **历史**（都记过哪些天）
 *   → **设置**（注入与留存口径）。
 *
 * 两条「不串项」的纪律照旧，一字未改：
 *   ① 勾选 / 备注 / 删项一律用 **data-id**（项 id）定位，不用 data-index ——
 *      删掉中间一项后下标会整体平移，按下标回写会把备注串到别的项上；
 *   ② 删卡 / 删项都不可逆，走两步确认（本仓不弹宿主 confirm）。
 *
 * 接线纪律（与心境 / 周期数学 / 幸运转盘 / 纪念日 / 小红书 / 天气同一套）：
 *   事件只在根容器上挂一次：click / input / change 各一个，靠 data-act 与 dataset 分派；
 *   读不到 DOM 不抛；数值缺失显示破折号，不拿 0 冒充。
 * ======================================================== */
'use strict';
import { PUNCH_REASONS, PUNCH_ITEM_KINDS, PUNCH_LIMITS } from './punchcard-data.js';

const FACE_META = {
    [PUNCH_REASONS.ready]: { icon: '\u2705', label: '已有打卡记录', tone: 'ok' },
    [PUNCH_REASONS.empty]: { icon: '\u{1f4c5}', label: '这个会话还没打过卡', tone: 'warn' },
    [PUNCH_REASONS.storage_absent]: { icon: '\u26a0\ufe0f', label: '存储不可用（读数拿不到）', tone: 'err' },
};

const KIND_LABEL = { time: '时间点', duration: '时长' };

const TABS = [
    { key: 'today', label: '今天' },
    { key: 'history', label: '历史' },
    { key: 'settings', label: '设置' },
];

const DASH = String.fromCharCode(45, 45);

export class PunchcardView {
    constructor(app, shell, storage) {
        this.app = app;
        this.shell = shell;
        this.storage = storage;
        this._root = null;
        this.tab = 'today';
        /** 新建区草稿（纯视图态，不落盘）：若干 `{ kind, at, label }` */
        this._draft = [];
        /** 两步确认（键形如 `card:<id>` / `item:<card>:<item>`） */
        this._pendingConfirm = '';
        /** 展开看历史里哪一张卡的明细（纯视图态） */
        this._openCardId = '';
        /** 提示条 */
        this._flash = '';
        this._boundRoot = null;
        this._hClick = null;
        this._hInput = null;
        this._hChange = null;
    }

    /* ---------- 1. 挂载与重绘 ---------- */

    render() {
        const container = this.shell && this.shell.getContentContainer ? this.shell.getContentContainer() : null;
        if (!container) return;
        container.innerHTML = '';
        this._root = document.createElement('div');
        this._root.className = 'pch-root';
        container.appendChild(this._root);
        this.refresh();
    }

    refresh() {
        if (!this._root) return;
        this._root.innerHTML = this._buildHTML();
        this._bindEvents();
    }

    _projection() {
        try {
            const p = this.app.projection();
            if (p && typeof p === 'object') return p;
        } catch (_e) { /* 读不到就按空投影画，归因条上会如实说明 */ }
        return {
            cardCount: 0, itemCount: 0, doneCount: 0, streak: 0, todayKey: '', todayItemCount: 0,
            todayDoneCount: 0, todayCardId: '', hasAny: false,
        };
    }

    _cards() {
        try {
            const list = this.app.cardsList();
            if (Array.isArray(list)) return list;
        } catch (_e) { /* 同上 */ }
        return [];
    }

    /* ---------- 2. 三页 ---------- */

    _itemHTML(card, it) {
        const key = 'item:' + card.id + ':' + it.id;
        const armed = this._pendingConfirm === key;
        const parts = [];
        parts.push('<div class="pch-item' + (it.done ? ' is-done' : '') + '" data-card="' + this._esc(card.id)
            + '" data-id="' + this._esc(it.id) + '">');
        parts.push('<label class="pch-item-main">');
        parts.push('<input type="checkbox" class="pch-item-check" data-act="toggle" data-card="' + this._esc(card.id)
            + '" data-id="' + this._esc(it.id) + '"' + (it.done ? ' checked' : '') + '>');
        parts.push('<span class="pch-item-at">' + this._esc(it.at || '') + '</span>');
        parts.push('<span class="pch-item-label">' + this._esc(it.label) + '</span>');
        parts.push('<span class="pch-item-kind">' + this._esc(KIND_LABEL[it.kind] || it.kind) + '</span>');
        parts.push('</label>');
        parts.push('<input class="pch-input pch-item-remark" type="text" maxlength="' + String(PUNCH_LIMITS.maxRemarkLen)
            + '" data-act="remark" placeholder="这一步怎么样（备注）" value="' + this._esc(it.remark)
            + '" data-card="' + this._esc(card.id) + '" data-id="' + this._esc(it.id) + '">');
        parts.push('<button class="pch-mini pch-item-del' + (armed ? ' pch-mini-armed' : '')
            + '" data-act="del-item" data-card="' + this._esc(card.id) + '" data-id="' + this._esc(it.id) + '">'
            + (armed ? '确认删' : '删') + '</button>');
        parts.push('</div>');
        return parts.join('');
    }

    _draftRowHTML(d, i) {
        const parts = [];
        parts.push('<div class="pch-draft" data-i="' + String(i) + '">');
        parts.push('<select class="pch-input pch-draft-kind" data-act="draft-kind" data-i="' + String(i) + '">');
        for (const k of PUNCH_ITEM_KINDS) {
            parts.push('<option value="' + this._esc(k) + '"' + (d.kind === k ? ' selected' : '') + '>'
                + this._esc(KIND_LABEL[k] || k) + '</option>');
        }
        parts.push('</select>');
        parts.push('<input class="pch-input pch-draft-at" type="text" maxlength="24" data-in="at" data-i="' + String(i)
            + '" placeholder="' + (d.kind === 'duration' ? '如 30分钟' : '如 08:00') + '" value="' + this._esc(d.at) + '">');
        parts.push('<input class="pch-input pch-draft-label" type="text" maxlength="' + String(PUNCH_LIMITS.maxLabelLen)
            + '" data-in="label" data-i="' + String(i) + '" placeholder="做什么" value="' + this._esc(d.label) + '">');
        parts.push('<button class="pch-mini pch-draft-del" data-act="del-draft" data-i="' + String(i) + '">删</button>');
        parts.push('</div>');
        return parts.join('');
    }

    _todayHTML(proj, cards) {
        const today = cards.find((c) => c.id === proj.todayCardId) || null;
        const parts = ['<section class="pch-page" data-page="today">'];

        parts.push('<div class="pch-streak">');
        parts.push('<div class="pch-streak-num">' + this._esc(String(proj.streak)) + '</div>');
        parts.push('<div class="pch-streak-unit">天连续（最近一张是昨天也算连着）</div>');
        parts.push('</div>');

        parts.push('<div class="pch-stats">');
        parts.push('<div class="pch-stat-row"><span>今天（' + this._esc(proj.todayKey || DASH) + '）</span><span>'
            + this._esc(String(proj.todayDoneCount)) + ' / ' + this._esc(String(proj.todayItemCount)) + ' 项</span></div>');
        parts.push('<div class="pch-stat-row"><span>累计打卡</span><span>' + this._esc(String(proj.cardCount))
            + ' 天 · ' + this._esc(String(proj.itemCount)) + ' 项</span></div>');
        parts.push('<div class="pch-stat-row"><span>累计完成</span><span>' + this._esc(String(proj.doneCount)) + ' 项</span></div>');
        parts.push('</div>');

        parts.push('<div class="pch-today">');
        parts.push('<h3 class="pch-list-title">今天的作息</h3>');
        if (!today) {
            parts.push('<div class="pch-empty">今天还没记。下面加一项并存档，就会开今天的卡。</div>');
        } else {
            if (today.targetName) parts.push('<div class="pch-target">给 ' + this._esc(today.targetName) + '</div>');
            for (const it of today.items) parts.push(this._itemHTML(today, it));
        }
        parts.push('</div>');

        parts.push('<div class="pch-create">');
        parts.push('<h3 class="pch-list-title">' + (today ? '再添一项' : '记今天的作息') + '</h3>');
        const draft = this._draft.length ? this._draft : [{ kind: 'time', at: '', label: '' }];
        draft.forEach((d, i) => parts.push(this._draftRowHTML(d, i)));
        parts.push('<div class="pch-actions">');
        parts.push('<button class="pch-mini" data-act="add-draft">+ 加一项</button>');
        parts.push('<button class="pch-btn pch-btn-primary" data-act="save">存档</button>');
        parts.push('</div>');
        parts.push('<div class="pch-hint">同一天再存会<strong>并到当天那张卡</strong>里（不会开出第二张）；'
            + '一张卡最多 ' + this._esc(String(PUNCH_LIMITS.maxItemsPerCard)) + ' 项。</div>');
        parts.push('</div>');
        parts.push('</section>');
        return parts.join('');
    }

    _historyHTML(cards) {
        const parts = ['<section class="pch-page" data-page="history">'];
        parts.push('<div class="pch-list">');
        parts.push('<h3 class="pch-list-title">全部（' + this._esc(String(cards.length)) + ' 天）</h3>');
        if (!cards.length) {
            parts.push('<div class="pch-empty">还没有卡 —— 去「今天」记一项。</div>');
        } else {
            for (const c of cards) {
                const doneN = c.items.filter((x) => x.done).length;
                const open = this._openCardId === c.id;
                const armed = this._pendingConfirm === ('card:' + c.id);
                parts.push('<div class="pch-hist' + (open ? ' is-open' : '') + '">');
                parts.push('<div class="pch-hist-head" data-act="open-card" data-id="' + this._esc(c.id) + '">');
                parts.push('<span class="pch-hist-date">' + this._esc(c.date) + '</span>');
                parts.push('<span class="pch-hist-meta">' + this._esc(String(doneN)) + ' / '
                    + this._esc(String(c.items.length)) + (c.targetName ? (' · ' + this._esc(c.targetName)) : '') + '</span>');
                parts.push('<button class="pch-mini pch-hist-del' + (armed ? ' pch-mini-armed' : '')
                    + '" data-act="del-card" data-id="' + this._esc(c.id) + '">' + (armed ? '确认删' : '删') + '</button>');
                parts.push('</div>');
                if (!open) {
                    parts.push('<div class="pch-hist-item">点这一行看那天记了什么</div>');
                } else {
                    for (const it of c.items) {
                        parts.push('<div class="pch-hist-item">' + (it.done ? '\u2705 ' : '\u25cb ')
                            + this._esc(it.at || '') + ' ' + this._esc(it.label)
                            + (it.remark ? (' <em>（' + this._esc(it.remark) + '）</em>') : '') + '</div>');
                    }
                }
                parts.push('</div>');
            }
        }
        parts.push('</div>');
        parts.push('<div class="pch-hint">删卡不可逆，所以要按两下（第一下只变成「确认删」）；'
            + '本仓不弹宿主 confirm。删掉的卡会先进回收站，不是当场抹掉。</div>');
        parts.push('</section>');
        return parts.join('');
    }

    _settingsHTML() {
        const settings = this.app.settings || {};
        const parts = ['<section class="pch-page" data-page="settings">'];
        parts.push('<div class="pch-settings">');
        parts.push('<h3 class="pch-list-title">设置</h3>');
        parts.push('<label class="pch-toggle"><span>把今日进度交给生成侧</span>'
            + '<input type="checkbox" data-act="inject"' + (settings.injectToPrompt ? ' checked' : '') + '></label>');
        parts.push('<label class="pch-field"><span>注入时带几个「还没做」</span>'
            + '<input type="number" data-act="max-inject" min="0" max="20" value="'
            + this._esc(String(settings.maxInjectItems)) + '"></label>');
        parts.push('<label class="pch-field"><span>最多留几天</span>'
            + '<input type="number" data-act="max-cards" min="7" max="400" value="'
            + this._esc(String(settings.maxCards)) + '"></label>');
        parts.push('<div class="pch-hint">换角色 / 换会话后，这份作息和上一个角色的是分开的两份。'
            + '本 App 只记你自己填的东西：不替你去问模型，也不碰聊天记录。</div>');
        parts.push('</div>');
        parts.push('</section>');
        return parts.join('');
    }

    /* ---------- 3. 总装 ---------- */

    _buildHTML() {
        const app = this.app;
        let face = PUNCH_REASONS.empty;
        try {
            if (typeof app.faceReason === 'function') face = app.faceReason();
        } catch (_e) { face = PUNCH_REASONS.storage_absent; }
        const meta = FACE_META[face] || { icon: '\u2753', label: '未识别的状态：' + String(face), tone: 'warn' };
        const proj = this._projection();
        const cards = this._cards();
        const page = this.tab === 'history' ? this._historyHTML(cards)
            : (this.tab === 'settings' ? this._settingsHTML() : this._todayHTML(proj, cards));

        const head = '<div class="pch-header"><h2>\u2705 打卡</h2>'
            + '<span class="pch-head-meta">' + this._esc(String(proj.cardCount)) + ' 天 · '
            + this._esc(String(proj.itemCount)) + ' 项</span></div>'
            + '<div class="pch-face pch-face-' + meta.tone + '">'
            + '<span class="pch-face-icon">' + meta.icon + '</span>'
            + '<span class="pch-face-label">' + this._esc(meta.label) + '</span></div>'
            + (this._flash ? '<div class="pch-flash">' + this._esc(this._flash) + '</div>' : '');

        const tabs = ['<nav class="pch-tabbar">']
            .concat(TABS.map((t) => '<button class="pch-tab' + (this.tab === t.key ? ' is-on' : '')
                + '" data-act="tab" data-tab="' + t.key + '">' + t.label + '</button>'))
            .concat(['</nav>'])
            .join('');
        return head + page + tabs;
    }

    /* ---------- 4. 事件（根容器各挂一次） ---------- */

    _bindEvents() {
        if (!this._root) return;
        if (this._boundRoot !== this._root) {
            this._hClick = (ev) => this._onClick(ev);
            this._hInput = (ev) => this._onInput(ev);
            this._hChange = (ev) => this._onChange(ev);
            this._root.addEventListener('click', this._hClick);
            this._root.addEventListener('input', this._hInput);
            this._root.addEventListener('change', this._hChange);
            this._boundRoot = this._root;
        }
    }

    /** 取元素：读不到就返回 null（宿主 DOM 不全会抛）。 */
    q(sel) {
        try { return this._root && this._root.querySelector ? this._root.querySelector(sel) : null; }
        catch (_e) { return null; }
    }

    /** 把光标落到某个草稿行上（加行、存完都往这儿落）。 */
    _focusDraft(i) {
        const sel = '.pch-draft-label' + ((i === null || i === undefined) ? '' : '[data-i="' + String(i) + '"]');
        const el = this.q(sel);
        if (el && typeof el.focus === 'function') el.focus();
    }

    _el(ev) { return (ev && ev.target) || null; }

    _attr(el, name) {
        try { return (el && typeof el.getAttribute === 'function') ? el.getAttribute(name) : null; }
        catch (_e) { return null; }
    }

    /** 读一条记录的 id：优先 dataset（事件回读的标准路径），再退到属性读。 */
    _id(el) {
        try {
            if (el && el.dataset && el.dataset.id) return String(el.dataset.id);
        } catch (_e) { /* 往下退 */ }
        return this._attr(el, 'data-id') || '';
    }

    /** 读所属卡的 id（同上）。 */
    _card(el) {
        try {
            if (el && el.dataset && el.dataset.card) return String(el.dataset.card);
        } catch (_e) { /* 往下退 */ }
        return this._attr(el, 'data-card') || '';
    }

    _hit(target) {
        return (target && typeof target.closest === 'function') ? target.closest('[data-act]') : null;
    }

    /** 把 DOM 里的草稿收回 `_draft`（重画前必调，防输入事件没送到时丢字）。 */
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

    _onInput(ev) {
        const el = this._el(ev);
        const field = this._attr(el, 'data-in');
        if (!field) return;
        const i = Number(this._attr(el, 'data-i'));
        if (!isFinite(i) || i < 0) return;
        while (this._draft.length <= i) this._draft.push({ kind: 'time', at: '', label: '' });
        this._draft[i][field] = el.value;
    }

    _onChange(ev) {
        const el = this._el(ev);
        const hit = this._hit(el);
        const act = this._attr(hit, 'data-act');
        if (!act) return;

        if (act === 'toggle') {
            this.app.toggleItem(this._card(hit), this._id(hit), !!(el && el.checked));
            this.refresh();
            return;
        }
        if (act === 'remark') {
            this.app.setItemRemark(this._card(hit), this._id(hit), el.value);
            this.refresh();
            return;
        }
        if (act === 'draft-kind') {
            const i = Number(this._attr(hit, 'data-i'));
            if (isFinite(i) && i >= 0 && this._draft[i]) this._draft[i].kind = el.value;
            /* 时间点 / 时长的占位语不同，换形态要重画（草稿已按行同步，重画不丢字）。 */
            this.refresh();
            return;
        }
        /* 设置三项都是 change 语义：改了就存，不必再按保存。 */
        if (act === 'inject') {
            this.app.settings = Object.assign({}, this.app.settings, { injectToPrompt: !!(el && el.checked) });
            if (typeof this.app.saveSettings === 'function') this.app.saveSettings();
            return;
        }
        if (act === 'max-inject') { this.app.patchSettings({ maxInjectItems: el.value }); return; }
        if (act === 'max-cards') { this.app.patchSettings({ maxCards: el.value }); return; }
    }

    _onClick(ev) {
        const target = this._el(ev);
        const hit = this._hit(target);
        const act = this._attr(hit, 'data-act');
        if (!act) return;

        if (act === 'tab') {
            const key = this._attr(hit, 'data-tab') || 'today';
            if (!TABS.some((t) => t.key === key)) return;
            /* 点的是当前页就什么都不做：整页重绘会把正在填的草稿和光标一起冲掉。 */
            const on = this.q('.pch-tab.is-on');
            if (on && this._attr(on, 'data-tab') === key) return;
            this._pullDraft();
            this.tab = key;
            this._pendingConfirm = '';
            this.refresh();
            return;
        }
        if (act === 'add-draft') {
            this._pullDraft();
            this._draft.push({ kind: 'time', at: '', label: '' });
            this.refresh();
            this._focusDraft(this._draft.length - 1);
            return;
        }
        if (act === 'del-draft') {
            this._pullDraft();
            const i = Number(this._attr(hit, 'data-i'));
            if (isFinite(i) && i >= 0 && i < this._draft.length) this._draft.splice(i, 1);
            this.refresh();
            return;
        }
        if (act === 'save') {
            this._pullDraft();
            const items = this._draft
                .filter((d) => String(d.label || '').trim())
                .map((d) => ({ kind: d.kind, at: d.at, label: d.label }));
            if (!items.length) { this._flash = '至少写一项「做什么」'; this.refresh(); return; }
            const added = this.app.addCard({ items });
            if (!added) { this._flash = '没存上（检查内容是否为空，或者这张卡已经满了）'; this.refresh(); return; }
            this._draft = [];
            this._flash = '记下了 ' + String(added) + ' 项';
            this.refresh();
            this._focusDraft(0);
            return;
        }
        if (act === 'del-item') {
            const cardId = this._card(hit);
            const id = this._id(hit);
            const key = 'item:' + cardId + ':' + id;
            if (this._pendingConfirm !== key) {
                this._pendingConfirm = key;
                this.refresh();
                return;
            }
            this._pendingConfirm = '';
            const n = this.app.deleteItem(cardId, id);
            this._flash = n ? '删掉一项' : '没删到（这一项可能已经不在卡里）';
            this.refresh();
            return;
        }
        if (act === 'open-card') {
            const id = this._id(hit);
            this._openCardId = (this._openCardId === id) ? '' : id;
            this._pendingConfirm = '';
            this.refresh();
            return;
        }
        if (act === 'del-card') {
            const id = this._id(hit);
            const key = 'card:' + id;
            if (this._pendingConfirm !== key) {
                this._pendingConfirm = key;
                this.refresh();
                return;
            }
            this._pendingConfirm = '';
            const n = this.app.deleteCard(id);
            if (this._openCardId === id) this._openCardId = '';
            this._flash = n ? '删掉一天' : '没删到（这一天可能已经不在册里）';
            this.refresh();
        }
    }

    _esc(s) {
        return String(s === null || s === undefined ? '' : s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '\x26quot;');
    }
}

export default PunchcardView;