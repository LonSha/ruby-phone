/* ========================================================
 * weather-view.js — [v4.166.0]「照现实重写」· 天气 App 视图
 * --------------------------------------------------------
 * 上一版的形态：一页到底 —— 归因卡 + 两处读数 + 两套录入表单 + 读数 + 清账 + 设置，
 *   全挤在一列里；事件按类名逐元素绑（每次重绘都重新绑一遍）。
 * 现实里的天气 App 是三块：**现在**（两处此刻怎么样）→ **记录**（改/清你填的那两格）
 *   → **设置**（注入与时效口径）。
 *
 * 三处「不糊弄」照旧，一字未改：
 *   · 天数/温度是**你自己填的**，本件不请求、不定位；
 *   · 数据放了多久**明写在面板上**，不把一天前的观测当此刻；
 *   · 认不出的码**显示「未知」**，不猜成晴天。
 *
 * 接线纪律（与桃宝 / 心境 / 周期数学 / 幸运转盘 / 纪念日 / 小红书同一套）：
 *   ① 事件只在根容器上挂一次：click / input / change 各一个，靠 data-act 与 dataset 分派；
 *   ② 读不到 DOM 不抛；③ 数值缺失显示破折号，不拿 0 冒充。
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

const TABS = [
    { key: 'now', label: '现在' },
    { key: 'records', label: '记录' },
    { key: 'settings', label: '设置' },
];
/* [v4.215.0 · 照现实] 底栏真源别名：WTH_FACES 与 TABS 同一引用，不另写格表。 */
export const WTH_FACES = TABS;

const DASH = String.fromCharCode(45, 45);

export class WeatherView {
    constructor(app, shell, storage) {
        this.app = app;
        this.shell = shell;
        this.storage = storage;
        this._root = null;
        this.tab = 'now';
        /** 逐槽位的输入草稿：`{ char: {...}, user: {...} }`（纯视图态，不落盘） */
        this._draft = { char: { city: '', tempC: '', code: '0' }, user: { city: '', tempC: '', code: '0' } };
        /** 是否已经用落盘值初始化过草稿（换会话要重置，见 onChatChanged 走 App 的 refresh） */
        this._seeded = false;
        /** 两步确认 */
        this._pendingConfirm = '';
        /** 提示条 */
        this._flash = '';
        this._boundRoot = null;
        this._hClick = null;
        this._hInput = null;
        this._hChange = null;
    }

    /* ---------- 1. 挂载与重绘 ---------- */

    /* [v4.215.0 · 照现实] weather 样式走独立 weather.css，v4 分层样式走 link 幂等注入。 */
    _loadV4CSS() {
        if (typeof document === 'undefined' || !document.head) return;
        if (document.getElementById('wth-v4-css')) return;
        const link = document.createElement('link');
        link.id = 'wth-v4-css';
        link.rel = 'stylesheet';
        link.href = new URL('./weather.v4.css', import.meta.url).href;
        document.head.appendChild(link);
    }

    render() {
        this._loadV4CSS();
        const container = this.shell && this.shell.getContentContainer ? this.shell.getContentContainer() : null;
        if (!container) return;
        container.innerHTML = '';
        this._root = document.createElement('div');
        this._root.className = 'wth-root';
        container.appendChild(this._root);
        this.refresh();
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

    _projection() {
        try {
            const p = this.app.projection();
            if (p && Array.isArray(p.rows)) return p;
        } catch (_e) { /* 读不到就按空投影画，并在归因条上如实说明 */ }
        return { rows: [], observedCount: 0, rainCount: 0, staleCount: 0, hasAny: false };
    }

    /* ---------- 2. 三页 ---------- */

    _nowHTML(proj) {
        const settings = this.app.settings || {};
        const parts = ['<section class="wth-page" data-page="now">'];
        parts.push('<div class="wth-banner">本页<strong>不替你问天气</strong>：没有联网、没有定位。'
            + '哪儿、几度、什么天，是你（或者宿主读到之后）填进来的；本件只把它翻成说得出口的事实。</div>');
        if (!proj.rows.length) {
            parts.push('<div class="wth-empty">两处都没有读数 —— 去「记录」里填一格。</div>');
        }
        for (const r of proj.rows) {
            parts.push('<div class="wth-slot' + (r.has ? '' : ' is-empty') + '">');
            parts.push('<h3 class="wth-slot-title">' + (KIND_ICON[r.kind] || KIND_ICON.unknown) + ' '
                + this._esc(SLOT_LABEL[r.slot] || r.slot) + '</h3>');
            if (!r.has) {
                parts.push('<div class="wth-empty">这个位置还没记。</div>');
                parts.push('<div class="wth-actions"><button class="wth-mini" data-act="goto-records">去记一格</button></div>');
                parts.push('</div>');
                continue;
            }
            parts.push('<div class="wth-read">');
            parts.push('<span class="wth-read-desc">' + this._esc(r.desc) + '</span>');
            if (r.tempText) parts.push('<span class="wth-read-temp">' + this._esc(r.tempText) + '</span>');
            if (r.city) parts.push('<span class="wth-read-city">' + this._esc(r.city) + '</span>');
            if (r.isRain) parts.push('<span class="wth-read-rain">下雨</span>');
            parts.push('</div>');
            parts.push('<div class="wth-read-age' + (r.isStale ? ' is-stale' : '') + '">'
                + (r.ageText ? ('记于 ' + this._esc(r.ageText)) : '没记时间')
                + (r.isStale ? (' —— 超过 ' + String(settings.freshHours) + ' 小时，<strong>未必是当下的</strong>') : '')
                + '</div>');
            parts.push('</div>');
        }
        parts.push('<div class="wth-stats">');
        parts.push('<div class="wth-stat-row"><span>记过的位置</span><span>'
            + String(proj.observedCount) + ' / ' + String(proj.rows.length) + '</span></div>');
        parts.push('<div class="wth-stat-row"><span>正在下雨</span><span>' + String(proj.rainCount) + '</span></div>');
        parts.push('<div class="wth-stat-row"><span>不是当下的</span><span>' + String(proj.staleCount) + '</span></div>');
        parts.push('<div class="wth-hint">「算不算下雨」按源那张码表判：毛毛雨、冻雨、阵雨、雷阵雨都算，'
            + '别的都不算。认不出的码一律显示「未知」，不猜成晴天。</div>');
        parts.push('</div>');
        parts.push('</section>');
        return parts.join('');
    }

    _slotForm(r, limits) {
        const d = this._draft[r.slot] || { city: '', tempC: '', code: '0' };
        const parts = [];
        parts.push('<div class="wth-slot' + (r.has ? '' : ' is-empty') + '">');
        parts.push('<h3 class="wth-slot-title">' + (KIND_ICON[r.kind] || KIND_ICON.unknown) + ' '
            + this._esc(SLOT_LABEL[r.slot] || r.slot) + (r.has ? '' : '（还没记）') + '</h3>');
        parts.push('<div class="wth-form">');
        parts.push('<input class="wth-input wth-city" type="text" maxlength="' + String(limits.maxCityLen)
            + '" placeholder="在哪儿（如 成都）" value="' + this._esc(d.city) + '" data-in="city" data-slot="' + this._esc(r.slot) + '">');
        parts.push('<div class="wth-form-row">');
        parts.push('<input class="wth-input wth-temp" type="number" step="0.1" min="' + String(limits.minTempC)
            + '" max="' + String(limits.maxTempC) + '" placeholder="几度（℃）" value="' + this._esc(d.tempC)
            + '" data-in="tempC" data-slot="' + this._esc(r.slot) + '">');
        parts.push('<select class="wth-input wth-code" data-in="code" data-slot="' + this._esc(r.slot) + '">');
        for (const g of CODE_GROUPS) {
            parts.push('<optgroup label="' + this._esc(g[0]) + '">');
            for (const c of g[1]) {
                const hit = WEATHER_CODES[c];
                if (!hit) continue;
                parts.push('<option value="' + String(c) + '"' + (String(d.code) === String(c) ? ' selected' : '') + '>'
                    + String(c) + ' ' + this._esc(hit.desc) + '</option>');
            }
            parts.push('</optgroup>');
        }
        parts.push('<option value=""' + (String(d.code) === '' ? ' selected' : '') + '>不指定</option>');
        parts.push('</select>');
        parts.push('</div>');
        parts.push('<div class="wth-actions">');
        parts.push('<button class="wth-btn wth-btn-primary" data-act="save" data-slot="' + this._esc(r.slot) + '">记下</button>');
        parts.push('<button class="wth-mini" data-act="clear-slot" data-slot="' + this._esc(r.slot) + '"'
            + (r.has ? '' : ' disabled') + '>清掉</button>');
        parts.push('</div>');
        parts.push('</div>');
        parts.push('</div>');
        return parts.join('');
    }

    _recordsHTML(proj) {
        const limits = this.app.limits ? this.app.limits() : WEATHER_LIMITS;
        const parts = ['<section class="wth-page" data-page="records">'];
        parts.push('<div class="wth-banner">记的是<strong>事实</strong>，不是预报：哪儿、几度、什么天，你自己填。'
            + '填完这一格，别的 App 只会读到「你记过什么」，读不到你没记过的。</div>');
        for (const r of proj.rows) parts.push(this._slotForm(r, limits || WEATHER_LIMITS));
        parts.push('<div class="wth-clean">');
        parts.push('<h3 class="wth-list-title">清账</h3>');
        parts.push('<div class="wth-actions">');
        parts.push('<button class="wth-mini' + (this._pendingConfirm === 'wth-clear-all' ? ' wth-mini-armed' : '')
            + '" data-act="clear-all">' + (this._pendingConfirm === 'wth-clear-all' ? '确认' : '两处都清掉') + '</button>');
        parts.push('</div>');
        parts.push('<div class="wth-hint">清账不可逆，所以要按两下（第一下只变成「确认」）；本仓不弹宿主 confirm。</div>');
        parts.push('</div>');
        parts.push('</section>');
        return parts.join('');
    }

    _settingsHTML() {
        const settings = this.app.settings || {};
        const parts = ['<section class="wth-page" data-page="settings">'];
        parts.push('<h3 class="wth-list-title">设置</h3>');
        parts.push('<label class="wth-toggle"><span>把天气交给生成侧</span>'
            + '<input type="checkbox" id="wth-inject" data-act="inject"' + (settings.injectToPrompt ? ' checked' : '') + '></label>');
        parts.push('<label class="wth-field"><span>注入最多几行</span>'
            + '<input type="number" id="wth-max-lines" data-act="max-lines" min="0" max="10" value="'
            + String(settings.maxInjectLines) + '"></label>');
        parts.push('<label class="wth-field"><span>多久算「不是当下的」（小时）</span>'
            + '<input type="number" id="wth-fresh-hours" data-act="fresh-hours" min="1" max="168" value="'
            + String(settings.freshHours) + '"></label>');
        parts.push('<div class="wth-hint">天气随会话走：换角色后那是另一个地方的另一场天。'
            + '本 App 只记事：不联网、不定位、不读别的 App 的表。</div>');
        parts.push('</section>');
        return parts.join('');
    }

    /* ---------- 3. 总装 ---------- */

    _buildHTML() {
        const app = this.app;
        const face = (typeof app.faceReason === 'function') ? app.faceReason() : WEATHER_REASONS.empty;
        const meta = FACE_META[face] || { icon: '\u2753', label: '未识别的状态：' + String(face), tone: 'warn' };
        const proj = this._projection();
        this._seedDraft(proj);
        const page = this.tab === 'records' ? this._recordsHTML(proj)
            : (this.tab === 'settings' ? this._settingsHTML() : this._nowHTML(proj));
        const head = '<div class="wth-header"><h2>\u{1f324}\ufe0f 天气</h2>'
            + '<span class="wth-head-meta">' + this._esc(String(proj.observedCount)) + ' / '
            + this._esc(String(proj.rows.length)) + ' 处有读数</span></div>'
            + '<div class="wth-face wth-face-' + meta.tone + '">'
            + '<span class="wth-face-icon">' + meta.icon + '</span>'
            + '<span class="wth-face-label">' + this._esc(meta.label) + '</span></div>'
            + (this._flash ? '<div class="wth-flash">' + this._esc(this._flash) + '</div>' : '');
        const tabs = ['<nav class="wth-tabbar" role="navigation" aria-label="天气主导航">']
            .concat(WTH_FACES.map((t) => {
                const on = this.tab === t.key;
                return '<button class="wth-tab' + (on ? ' is-on' : '') + '" data-act="tab" data-tab="' + t.key
                    + '" data-wth-face="' + t.key + '"' + (on ? ' aria-current="page"' : '')
                    + '>' + this._esc(t.label) + '</button>';
            }))
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

    _el(ev) { return (ev && ev.target) || null; }

    /** 取元素：读不到就返回 null（宿主 DOM 不全会抛）。 */
    q(sel) {
        try { return this._root && this._root.querySelector ? this._root.querySelector(sel) : null; }
        catch (_e) { return null; }
    }

    /** 把光标放到某一格的「在哪儿」上（切页、记完都往这儿落，省一次瞎点）。 */
    _focusCity(slot) {
        const el = this.q('.wth-city' + (slot ? '[data-slot="' + slot + '"]' : ''));
        if (el && typeof el.focus === 'function') el.focus();
    }

    _attr(el, name) {
        try { return (el && typeof el.getAttribute === 'function') ? el.getAttribute(name) : null; }
        catch (_e) { return null; }
    }

    _slotOf(el) {
        const s = this._attr(el, 'data-slot');
        return (s === 'char' || s === 'user') ? s : '';
    }

    /** 草稿写入：输入与选择都走这一处（键盘输入与程序改值同一口径）。 */
    _onInput(ev) {
        const el = this._el(ev);
        const slot = this._slotOf(el);
        const field = this._attr(el, 'data-in');
        if (!slot || !field) return;
        if (!this._draft[slot]) this._draft[slot] = { city: '', tempC: '', code: '0' };
        this._draft[slot][field] = el.value;
    }

    _onChange(ev) {
        const el = this._el(ev);
        const act = this._attr(el, 'data-act');
        /* 设置三项都是 change 语义：改了就存，不必再按保存。 */
        if (act === 'inject') {
            this.app.settings = Object.assign({}, this.app.settings, { injectToPrompt: !!el.checked });
            if (typeof this.app.saveSettings === 'function') this.app.saveSettings();
            return;
        }
        if (act === 'max-lines') { this.app.patchSettings({ maxInjectLines: el.value }); return; }
        if (act === 'fresh-hours') { this.app.patchSettings({ freshHours: el.value }); return; }
        /* 码表是 select：change 走草稿，等「记下」再落盘（与输入框同一套）。 */
        this._onInput(ev);
    }

    _onClick(ev) {
        const target = this._el(ev);
        const hit = (target && typeof target.closest === 'function') ? target.closest('[data-act]') : null;
        const act = this._attr(hit, 'data-act');
        if (!act) return;
        if (act === 'tab') {
            const key = this._attr(hit, 'data-tab') || 'now';
            if (!TABS.some((t) => t.key === key)) return;
            /* 点的是当前页就什么都不做：整页重绘会把正在填的格子和光标一起冲掉。 */
            const on = this.q('.wth-tab.is-on');
            if (on && this._attr(on, 'data-tab') === key) return;
            this.tab = key;
            this._pendingConfirm = '';
            this.refresh();
            return;
        }
        if (act === 'goto-records') {
            this.tab = 'records';
            this.refresh();
            /* 从「现在」空着的那格跳过来：直接把光标放在该填的地方。 */
            const empty = this.q('.wth-slot.is-empty .wth-city');
            if (empty && typeof empty.focus === 'function') empty.focus();
            return;
        }
        if (act === 'save') {
            const slot = this._slotOf(hit);
            const d = this._draft[slot] || { city: '', tempC: '', code: '' };
            const r = this.app.setSlot(slot, {
                city: d.city,
                tempC: (String(d.tempC).trim() === '') ? null : d.tempC,
                code: (String(d.code).trim() === '') ? null : d.code,
            });
            this._flash = r && r.ok ? '记下了' : ((r && r.error) || '没记上');
            this.refresh();
            if (r && r.ok) this._focusCity(slot);
            return;
        }
        if (act === 'clear-slot') {
            const slot = this._slotOf(hit);
            const r = this.app.clearSlot(slot);
            if (r && r.ok) { this._seeded = false; this._draft[slot] = { city: '', tempC: '', code: '0' }; }
            this._flash = r && r.ok ? '清掉了' : ((r && r.error) || '');
            this.refresh();
            return;
        }
        if (act === 'clear-all') {
            /* 两步确认：第一下只把按钮改成「确认」，第二下才真清（本仓不弹宿主 confirm）。 */
            if (this._pendingConfirm !== 'wth-clear-all') {
                this._pendingConfirm = 'wth-clear-all';
                this.refresh();
                return;
            }
            this._pendingConfirm = '';
            const n = this.app.clearAll();
            if (n) {
                this._seeded = false;
                this._draft = { char: { city: '', tempC: '', code: '0' }, user: { city: '', tempC: '', code: '0' } };
            }
            this._flash = n ? ('清掉了 ' + String(n) + ' 处') : '本来就是空的';
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

export default WeatherView;