/* ========================================================
 * weather-view.js — [v3.27.0] 天气 App 视图
 * 归因卡 + 两个位置（角色 / 你）的记事 + 码表选择 + 时效提示 + 设置
 *
 * 与 focus-view / piggy-view / punchcard-view 同纪律：归因文案表的键取 WEATHER_REASONS 的**值**。
 * 本视图**只画与派事件**：一切数据变动都回调到 App 的方法上（App 负责纯函数 + 落盘）。
 *
 * 三处「不糊弄」：
 *   · 天数/温度是**你自己填的**，本件不请求、不定位（源两路都自己发请求，本仓新增模块零外部请求）；
 *   · 数据放了多久**明写在面板上**，不把一天前的观测当此刻（源的 24 小时缓存界面上看不出来）；
 *   · 认不出的码**显示「未知」**，不猜成晴天。
 * ======================================================== */
'use strict';
import { WEATHER_REASONS, WEATHER_LIMITS, WEATHER_CODES } from './weather-data.js';

const FACE_META = {
    [WEATHER_REASONS.ready]: { icon: '\u2705', label: '记过天气', tone: 'ok' },
    [WEATHER_REASONS.empty]: { icon: '\u{1f324}\ufe0f', label: '还没记过天气', tone: 'warn' },
    [WEATHER_REASONS.storage_absent]: { icon: '\u26a0\ufe0f', label: '存储不可用（读数拿不到）', tone: 'err' },
};

const SLOT_LABEL = { char: '角色所在地', user: '你所在地' };

/** 码表按「大类」分组给选项（数据层的码位是扁平表，这里只排列显示顺序）。 */
const CODE_GROUPS = [
    ['晴 / 云 / 雾', [0, 1, 2, 3, 45, 48]],
    ['毛毛雨 / 冻雨', [51, 53, 55, 56, 57, 66, 67]],
    ['雨', [61, 63, 65]],
    ['雪', [71, 73, 75, 77]],
    ['阵雨 / 阵雪', [80, 81, 82, 85, 86]],
    ['雷阵雨', [95, 96, 99]],
];

const KIND_ICON = {
    clear: '\u2600\ufe0f', cloud: '\u26c5', fog: '\u{1f32b}\ufe0f', drizzle: '\u{1f326}\ufe0f',
    freezing: '\u{1f9ca}', rain: '\u{1f327}\ufe0f', snow: '\u2744\ufe0f', shower: '\u{1f326}\ufe0f',
    thunder: '\u26c8\ufe0f', unknown: '\u2753',
};

export class WeatherView {
    constructor(app, shell, storage) {
        this.app = app;
        this.shell = shell;
        this.storage = storage;
        this._root = null;
        /** 逐槽位的输入草稿：`{ char: {...}, user: {...} }`（纯视图态，不落盘） */
        this._draft = { char: { city: '', tempC: '', code: '0' }, user: { city: '', tempC: '', code: '0' } };
        /** 是否已经用落盘值初始化过草稿（换会话要重置，见 `onChatChanged` 走的是 App 的 `refresh`） */
        this._seeded = false;
        /** 两步确认 */
        this._pendingConfirm = '';
        /** 提示条 */
        this._flash = '';
    }

    render() {
        const container = this.shell && this.shell.getContentContainer ? this.shell.getContentContainer() : null;
        if (!container) return;
        container.innerHTML = '';
        this._root = document.createElement('div');
        this._root.className = 'wth-root';
        this._root.innerHTML = this._buildHTML();
        container.appendChild(this._root);
        this._bindEvents();
    }

    refresh() {
        if (!this._root) return;
        this._root.innerHTML = this._buildHTML();
        this._bindEvents();
    }

    /** 用当前读数给空的草稿播种（只在没播过时播，免得把用户正在打的字覆盖掉）。 */
    _seedDraft(proj) {
        if (this._seeded || !proj) return;
        for (const r of proj.rows) {
            this._draft[r.slot] = {
                city: r.city || '',
                tempC: (r.tempC === null || r.tempC === undefined) ? '' : String(r.tempC),
                code: (r.code === null || r.code === undefined) ? '0' : String(r.code),
            };
        }
        this._seeded = true;
    }

    _buildHTML() {
        const app = this.app;
        const face = app.faceReason();
        const meta = FACE_META[face] || { icon: '\u2753', label: '未识别的状态：' + String(face), tone: 'warn' };
        const proj = app.projection() || { rows: [], observedCount: 0, rainCount: 0, staleCount: 0, hasAny: false };
        this._seedDraft(proj);
        const settings = app.settings;
        const limits = app.limits();
        const parts = [];

        parts.push('<div class="wth-header"><h2>\u{1f324}\ufe0f 天气</h2></div>');

        parts.push('<div class="wth-face wth-face-' + meta.tone + '">');
        parts.push('<span class="wth-face-icon">' + meta.icon + '</span>');
        parts.push('<span class="wth-face-label">' + this._esc(meta.label) + '</span>');
        parts.push('</div>');

        if (this._flash) parts.push('<div class="wth-flash">' + this._esc(this._flash) + '</div>');

        parts.push('<div class="wth-banner">本页**不替你问天气**：没有联网、没有定位。'
            + '哪儿、几度、什么天，是你（或者宿主读到之后）填进来的；本件只把它翻成说得出口的事实。</div>');

        for (const r of proj.rows) {
            const d = this._draft[r.slot] || { city: '', tempC: '', code: '0' };
            parts.push('<div class="wth-slot' + (r.has ? '' : ' is-empty') + '">');
            parts.push('<h3 class="wth-slot-title">' + KIND_ICON[r.kind] + ' ' + this._esc(SLOT_LABEL[r.slot] || r.slot) + '</h3>');

            /* 现在的读数 */
            if (r.has) {
                parts.push('<div class="wth-read">');
                parts.push('<span class="wth-read-desc">' + this._esc(r.desc) + '</span>');
                if (r.tempText) parts.push('<span class="wth-read-temp">' + this._esc(r.tempText) + '</span>');
                if (r.city) parts.push('<span class="wth-read-city">' + this._esc(r.city) + '</span>');
                if (r.isRain) parts.push('<span class="wth-read-rain">下雨</span>');
                parts.push('</div>');
                parts.push('<div class="wth-read-age' + (r.isStale ? ' is-stale' : '') + '">'
                    + (r.ageText ? ('记于 ' + this._esc(r.ageText)) : '没记时间')
                    + (r.isStale ? (' —— 超过 ' + settings.freshHours + ' 小时，**未必是当下的**') : '')
                    + '</div>');
            } else {
                parts.push('<div class="wth-empty">这个位置还没记。</div>');
            }

            /* 填 */
            parts.push('<div class="wth-form">');
            parts.push('<input class="wth-input wth-city" type="text" maxlength="' + limits.maxCityLen
                + '" placeholder="在哪儿（如 成都）" value="' + this._esc(d.city) + '" data-slot="' + this._esc(r.slot) + '">');
            parts.push('<div class="wth-form-row">');
            parts.push('<input class="wth-input wth-temp" type="number" step="0.1" min="' + limits.minTempC + '" max="' + limits.maxTempC
                + '" placeholder="几度（℃）" value="' + this._esc(d.tempC) + '" data-slot="' + this._esc(r.slot) + '">');
            parts.push('<select class="wth-input wth-code" data-slot="' + this._esc(r.slot) + '">');
            for (const g of CODE_GROUPS) {
                parts.push('<optgroup label="' + this._esc(g[0]) + '">');
                for (const c of g[1]) {
                    const hit = WEATHER_CODES[c];
                    if (!hit) continue;
                    parts.push('<option value="' + c + '"' + (String(d.code) === String(c) ? ' selected' : '') + '>'
                        + c + ' ' + this._esc(hit.desc) + '</option>');
                }
                parts.push('</optgroup>');
            }
            parts.push('<option value=""' + (String(d.code) === '' ? ' selected' : '') + '>不指定</option>');
            parts.push('</select>');
            parts.push('</div>');
            parts.push('<div class="wth-actions">');
            parts.push('<button class="wth-btn wth-btn-primary wth-save" data-slot="' + this._esc(r.slot) + '">记下</button>');
            parts.push('<button class="wth-mini wth-clear" data-slot="' + this._esc(r.slot) + '"'
                + (r.has ? '' : ' disabled') + '>清掉</button>');
            parts.push('</div>');
            parts.push('</div>');
            parts.push('</div>');
        }

        /* ---------- 读数 ---------- */
        parts.push('<div class="wth-stats">');
        parts.push('<div class="wth-stat-row"><span>记过的位置</span><span>' + proj.observedCount + ' / ' + proj.rows.length + '</span></div>');
        parts.push('<div class="wth-stat-row"><span>正在下雨</span><span>' + proj.rainCount + '</span></div>');
        parts.push('<div class="wth-stat-row"><span>不是当下的</span><span>' + proj.staleCount + '</span></div>');
        parts.push('<div class="wth-hint">「算不算下雨」按**源那张码表**判：毛毛雨、冻雨、阵雨、雷阵雨都算，'
            + '别的都不算。认不出的码一律显示「未知」，不猜成晴天。</div>');
        parts.push('</div>');

        /* ---------- 清 ---------- */
        parts.push('<div class="wth-clean">');
        parts.push('<h3 class="wth-list-title">清账</h3>');
        parts.push('<div class="wth-actions">');
        parts.push('<button class="wth-mini wth-mini-armed wth-clear-all">两处都清掉</button>');
        parts.push('</div>');
        parts.push('</div>');

        /* ---------- 设置 ---------- */
        parts.push('<div class="wth-settings">');
        parts.push('<h3 class="wth-list-title">设置</h3>');
        parts.push('<label class="wth-toggle"><span>把天气交给生成侧</span>'
            + '<input type="checkbox" id="wth-inject"' + (settings.injectToPrompt ? ' checked' : '') + '></label>');
        parts.push('<label class="wth-field"><span>注入最多几行</span>'
            + '<input type="number" id="wth-max-lines" min="0" max="10" value="' + settings.maxInjectLines + '"></label>');
        parts.push('<label class="wth-field"><span>多久算「不是当下的」（小时）</span>'
            + '<input type="number" id="wth-fresh-hours" min="1" max="168" value="' + settings.freshHours + '"></label>');
        parts.push('<div class="wth-hint">天气随会话走：换角色后那是另一个地方的另一场天。'
            + '本 App 只记事：不联网、不定位、不读别的 App 的表。</div>');
        parts.push('</div>');

        return parts.join('\n');
    }

    _bindEvents() {
        if (!this._root) return;
        const app = this.app;
        const q = (sel) => this._root.querySelector(sel);
        const flash = (msg) => { this._flash = msg || ''; };

        for (const el of this._root.querySelectorAll('.wth-city')) {
            el.addEventListener('input', () => { this._draft[el.dataset.slot].city = el.value; });
        }
        for (const el of this._root.querySelectorAll('.wth-temp')) {
            el.addEventListener('input', () => { this._draft[el.dataset.slot].tempC = el.value; });
        }
        for (const el of this._root.querySelectorAll('.wth-code')) {
            el.addEventListener('change', () => { this._draft[el.dataset.slot].code = el.value; });
        }
        for (const b of this._root.querySelectorAll('.wth-save')) {
            b.addEventListener('click', () => {
                const slot = b.dataset.slot;
                const d = this._draft[slot] || { city: '', tempC: '', code: '' };
                const r = app.setSlot(slot, {
                    city: d.city,
                    tempC: (String(d.tempC).trim() === '') ? null : d.tempC,
                    code: (String(d.code).trim() === '') ? null : d.code,
                });
                flash(r.ok ? '记下了' : (r.error || '没记上'));
                this.refresh();
            });
        }
        for (const b of this._root.querySelectorAll('.wth-clear')) {
            b.addEventListener('click', () => {
                const r = app.clearSlot(b.dataset.slot);
                if (r.ok) this._seeded = false;
                flash(r.ok ? '清掉了' : (r.error || ''));
                this.refresh();
            });
        }
        const clearAll = q('.wth-clear-all');
        if (clearAll) clearAll.addEventListener('click', () => {
            if (this._needConfirm('wth-clear-all', clearAll)) return;
            const n = app.clearAll();
            if (n) this._seeded = false;
            flash(n ? ('清掉了 ' + n + ' 处') : '本来就是空的');
            this.refresh();
        });

        const inject = q('#wth-inject');
        if (inject) inject.addEventListener('change', (e) => {
            app.settings = { ...app.settings, injectToPrompt: e.target.checked };
            app.saveSettings();
        });
        const maxLines = q('#wth-max-lines');
        if (maxLines) maxLines.addEventListener('change', (e) => app.patchSettings({ maxInjectLines: e.target.value }));
        const freshHours = q('#wth-fresh-hours');
        if (freshHours) freshHours.addEventListener('change', (e) => app.patchSettings({ freshHours: e.target.value }));
    }

    /** 两步确认（清账不可逆，而本仓不弹宿主 confirm）。 */
    _needConfirm(key, btn) {
        if (this._pendingConfirm === key) { this._pendingConfirm = ''; return false; }
        this._pendingConfirm = key;
        if (btn) { btn.textContent = '确认'; btn.classList.add('wth-mini-armed'); }
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