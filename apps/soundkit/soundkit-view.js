/* ========================================================
 * soundkit-view.js — [v3.37.0] 白盒音效盒 视图层
 * 照抄 pixiv / lofter / magazine 规格：`_buildHTML()` 拼串 → `innerHTML`
 * → `_bindEvents()`。只在 render / refresh 里读 App 现算值，**不缓存投影**。
 *
 * 四条视图纪律：
 *  ① **四态必须分开画**：内置配方 / 自定义配方 / 已静音 / 没绑这条
 *     四种处境各有各的文案与配色。源把这四种塌成「点了没响」一种观感。
 *  ② **真源表不许手写键**：波形下拉、内置音效按钮、槽位名、坏音符原因
 *     全部来自 `app.catalogs()`（数据层真源），视图不写第二份。
 *  ③ **配方是数据**：编辑器直接编辑音符数组（频率 / 起点 / 时长 / 波形 /
 *     增益），坏音符**当场显示计数与原因**，不许静默丢。
 *  ④ **不出声也能看**：波形预览由 `app.planOf()` 的纯读数画 SVG，
 *     无头环境（没有 AudioContext）照样能看到「这条音效长什么样」。
 * ======================================================== */
'use strict';
import { SOUNDKIT_FACES } from './soundkit-data.js';

/** HTML 转义要 replace 掉的「双引号」——用**字符数组 + split/join**，不写成正则字面量。
 *  ★ 本仓判据共用的剥注释器（stripComments）是字符状态机、**不解析正则字面量**：
 *    正则字面量里一旦出现半个引号，剥器就把它当成字符串的起头，从那一行往后块注释再也剥不掉。
 *    v3.31.0 在 date-view、v3.35.0 在 pixiv 的 `_esc` 上各踩过一次 —— 本件照抄安全写法。 */
const DQUOTE = String.fromCharCode(34);
/** `&` 的**拼装形**（不写实体字面量：落盘传输链会把实体字面量解码成真字符，
 *  于是 `_esc` 静默失效却不报错 —— v3.35.0 在数据层当场踩过）。 */
const AMP = String.fromCharCode(38);

/** 三态人话（「还没有配方」与「读不出来」**不许同形**）。
 *  ★ 键面**取数据层真源**（计算键），不在本文件手写一套标识符形。
 *    本版第四处同族真缺陷就是这个形态：首版这里手写 `{ ok: …, empty: …,
 *    storage_absent: … }`，而 App 里另写了一份同形常量 —— 两份靠碰巧拼写一致对齐，
 *    任何一边改名都会让本表**静默落兜底**，「还没有配方」与「存储不可用」塌成同一句话。
 *    第九道门 J7 当场报红（这正是 clock-view / ledger-view 在 v2.98.0 修过的同一条）。 */
const FACE_META = {
    [SOUNDKIT_FACES.ok]: { icon: '\u{1f514}', label: '音效盒开着', tone: 'ok' },
    [SOUNDKIT_FACES.empty]: { icon: '\u{1f4c4}', label: '还没有配方', tone: 'warn' },
    [SOUNDKIT_FACES.storage_absent]: { icon: '\u26a0\ufe0f', label: '存储不可用（读数拿不到）', tone: 'err' },
};

/** 四态配色：**键面从 `app.catalogs().states` 算**（severity → 色相），不手写第二份。
 *  ★ 首版这里是手写的 `{ builtin: 'ok', custom: 'info', silent: 'mute', missing: 'warn' }`
 *    —— 本仓 J7 形态：数据层多一态时这份表静默落兜底色，四态在用户眼里又塌回一种观感。 */
const TONE_BY_SEVERITY = { ok: 'ok', info: 'info', mute: 'mute', warn: 'warn', err: 'err' };
function toneTable(states) {
    const out = {};
    for (const s of (Array.isArray(states) ? states : [])) {
        out[s.key] = TONE_BY_SEVERITY[s.severity] || 'warn';
    }
    return out;
}

const TABS = [
    { key: 'slots', label: '槽位' },
    { key: 'editor', label: '编辑器' },
    { key: 'share', label: '分享' },
    { key: 'settings', label: '设置' },
];

export class SoundkitView {
    constructor(app, shell, storage) {
        this.app = app;
        this.shell = shell;
        this.storage = storage;
        this._root = null;
        this._flash = '';
        this._draft = {
            key: '', label: '', volume: 0.6,
            notes: [{ freq: 880, at: 0, dur: 0.3, type: 'sine', gain: 0.6 }],
            code: '', slot: 'message'
        };
    }
    render() {
        const container = this.shell && this.shell.getContentContainer ? this.shell.getContentContainer() : null;
        if (!container) return;
        container.innerHTML = '';
        this._root = document.createElement('div');
        this._root.className = 'snd-root';
        this._root.innerHTML = this._buildHTML();
        container.appendChild(this._root);
        this._bindEvents();
    }
    refresh() {
        if (!this._root) return;
        this._root.innerHTML = this._buildHTML();
        this._bindEvents();
    }
    _q(sel) { return this._root ? this._root.querySelector(sel) : null; }
    _qa(sel) { return this._root ? this._root.querySelectorAll(sel) : []; }

    /** 转义（`&` 与双引号走拼装形 —— 见文件头纪律）。 */
    _esc(s) {
        return String(s == null ? '' : s)
            .split(AMP).join(AMP + 'amp;')
            .split('<').join(AMP + 'lt;')
            .split('>').join(AMP + 'gt;')
            .split(DQUOTE).join(AMP + 'quot;')
            .split(String.fromCharCode(39)).join(AMP + '#39;');
    }

    _buildHTML() {
        const app = this.app;
        const face = app.faceOf();
        const meta = FACE_META[face] || { icon: '\u2753', label: '未识别的状态：' + String(face), tone: 'warn' };
        const parts = [];
        parts.push('<div class="snd-header"><h2>\u{1f514} 白盒音效盒</h2>'
            + '<span class="snd-header-sub">音效是数据，不是音频文件</span></div>');
        parts.push('<div class="snd-face snd-face-' + meta.tone + '">');
        parts.push('<span class="snd-face-icon">' + meta.icon + '</span>');
        parts.push('<span class="snd-face-label">' + this._esc(meta.label) + '</span>');
        parts.push('<span class="snd-face-sub">' + this._esc(app.summaryLine()) + '</span>');
        parts.push('</div>');
        if (this._flash) parts.push('<div class="snd-flash">' + this._esc(this._flash) + '</div>');
        const cur = app.tab();
        parts.push('<div class="snd-tabs">');
        for (const t of TABS) {
            parts.push('<button type="button" class="snd-tab' + (cur === t.key ? ' is-on' : '')
                + '" data-tab="' + t.key + '">' + this._esc(t.label) + '</button>');
        }
        parts.push('</div>');
        if (cur === 'slots') parts.push(this._slotsPanel());
        else if (cur === 'editor') parts.push(this._editorPanel());
        else if (cur === 'share') parts.push(this._sharePanel());
        else parts.push(this._settingsPanel());
        return parts.join('');
    }

    /* ══════════ 槽位面板 ══════════ */
    _slotsPanel() {
        const app = this.app;
        const rows = app.slotRows();
        const tone = toneTable(app.catalogs().states);
        const parts = ['<div class="snd-panel snd-slots">'];
        parts.push('<div class="snd-sec-title">四个去处 · 各自绑什么</div>');
        for (const r of rows) {
            const t = tone[r.kind] || 'warn';
            parts.push('<div class="snd-slot snd-tone-' + t + '" data-slot="' + this._esc(r.slot) + '">');
            parts.push('<div class="snd-slot-head">');
            parts.push('<span class="snd-slot-name">' + this._esc(r.slotLabel) + '</span>');
            parts.push('<span class="snd-slot-state">' + this._esc(r.kindLabel) + '</span>');
            parts.push('<span class="snd-slot-detail">'
                + (r.kind === 'builtin' || r.kind === 'custom'
                    ? this._esc(r.label) + ' · ' + r.notes + ' 个音符 · 音量 ' + r.volume
                    : (r.missingKind === 'unknown_key' ? '指向的配方不在了' : '没绑'))
                + '</span>');
            if (r.dropped) parts.push('<span class="snd-slot-warn">有 ' + r.dropped + ' 个音符放不了</span>');
            parts.push('</div>');
            parts.push('<div class="snd-slot-acts">');
            parts.push('<button type="button" class="snd-btn" data-act="preview" data-slot="' + this._esc(r.slot) + '">试听</button>');
            parts.push('<button type="button" class="snd-btn" data-act="bind-builtin" data-slot="' + this._esc(r.slot) + '">绑内置</button>');
            parts.push('<button type="button" class="snd-btn" data-act="bind-custom" data-slot="' + this._esc(r.slot) + '">绑自定义</button>');
            parts.push('<button type="button" class="snd-btn" data-act="bind-silent" data-slot="' + this._esc(r.slot) + '">静音</button>');
            parts.push('<button type="button" class="snd-btn" data-act="bind-none" data-slot="' + this._esc(r.slot) + '">解绑</button>');
            parts.push('</div>');
            if (r.kind === 'builtin' || r.kind === 'custom') {
                parts.push('<div class="snd-slot-vol">');
                parts.push('<label class="snd-slot-vol-label">这一条的音量</label>');
                parts.push('<input type="range" class="snd-range snd-slot-range" data-k="slot-volume" data-slot="'
                    + this._esc(r.slot) + '" min="0" max="1" step="0.05" value="' + r.volume + '" />');
                parts.push('<span class="snd-range-val">' + r.volume + '</span>');
                parts.push('</div>');
                parts.push('<div class="snd-wave">' + this._waveSVG(app.planOf(r.slot)) + '</div>');
            }
            parts.push('</div>');
        }
        const lp = app.lastPlay();
        if (lp) {
            parts.push('<div class="snd-note">上次试听：' + this._esc(lp.slot) + ' · '
                + (lp.ok ? '响了 ' + Math.round(lp.totalMs) + ' 毫秒' : '没响（' + this._esc(lp.reason) + '）')
                + '</div>');
        }
        parts.push('</div>');
        return parts.join('');
    }

    /* ══════════ 编辑器面板 ══════════ */
    _editorPanel() {
        const app = this.app;
        const cat = app.catalogs();
        const d = this._draft;
        const check = app.dropReasonLabel;
        const parts = ['<div class="snd-panel snd-editor">'];
        const editing = app.currentKey();
        parts.push('<div class="snd-sec-title">配方编辑器 · 频率 / 起点 / 时长 / 波形 / 增益</div>');
        parts.push('<div class="snd-edit-head">');
        parts.push('<span class="snd-edit-cur">' + (editing
            ? '正在改「' + this._esc(editing) + '」（同名保存即覆盖）'
            : '新配方（保存后才有 key）') + '</span>');
        parts.push('<button type="button" class="snd-btn" data-act="close-recipe">返回槽位</button>');
        parts.push('</div>');
        parts.push('<div class="snd-field"><label>名字</label>'
            + '<input type="text" class="snd-input" data-k="label" value="' + this._esc(d.label) + '" maxlength="40" /></div>');
        parts.push('<div class="snd-field"><label>音量</label>'
            + '<input type="number" class="snd-input" data-k="volume" value="' + d.volume + '" min="0" max="1" step="0.05" /></div>');
        parts.push('<div class="snd-notes">');
        for (let i = 0; i < d.notes.length; i += 1) {
            const n = d.notes[i];
            parts.push('<div class="snd-note-row" data-i="' + i + '">');
            parts.push('<input type="number" class="snd-cell" data-k="freq" data-i="' + i + '" value="' + n.freq + '" min="' + cat.limits.freqMin + '" max="' + cat.limits.freqMax + '" step="1" title="频率 Hz" />');
            parts.push('<input type="number" class="snd-cell" data-k="at" data-i="' + i + '" value="' + n.at + '" min="0" max="' + cat.limits.atMax + '" step="0.01" title="起点 秒" />');
            parts.push('<input type="number" class="snd-cell" data-k="dur" data-i="' + i + '" value="' + n.dur + '" min="' + cat.limits.durMin + '" max="' + cat.limits.durMax + '" step="0.01" title="时长 秒" />');
            parts.push('<select class="snd-cell" data-k="type" data-i="' + i + '">');
            for (const w of cat.waves) {
                parts.push('<option value="' + w + '"' + (n.type === w ? ' selected' : '') + '>' + w + '</option>');
            }
            parts.push('</select>');
            parts.push('<input type="number" class="snd-cell" data-k="gain" data-i="' + i + '" value="' + n.gain + '" min="0" max="1" step="0.05" title="增益" />');
            parts.push('<button type="button" class="snd-btn snd-del" data-act="del-note" data-i="' + i + '">删</button>');
            parts.push('</div>');
        }
        parts.push('</div>');
        parts.push('<div class="snd-row">');
        parts.push('<button type="button" class="snd-btn" data-act="add-note">加一个音符</button>');
        parts.push('<button type="button" class="snd-btn snd-primary" data-act="save-recipe">保存配方</button>');
        parts.push('<button type="button" class="snd-btn" data-act="clear-draft">清空</button>');
        parts.push('</div>');
        /* 当场算一次校验：坏音符**不许静默丢**，要显示计数与原因。 */
        const s = this._draftCheck();
        if (s.dropped) {
            const why = Object.keys(s.reasons).map((k) => check(k) + ' ×' + s.reasons[k]).join(' · ');
            parts.push('<div class="snd-warn">有 ' + s.dropped + ' 个音符放不了：' + this._esc(why) + '</div>');
        } else {
            parts.push('<div class="snd-note">这条配方能播：' + s.notes.length + ' 个音符，共 '
                + Math.round(s.totalMs) + ' 毫秒</div>');
        }
        parts.push('<div class="snd-wave snd-wave-lg">' + this._waveSVG(this._draftPlan()) + '</div>');
        parts.push('<div class="snd-sec-title">内置配方（点一下载进编辑器）</div>');
        parts.push('<div class="snd-builtins">');
        for (const key of cat.builtins) {
            const b = cat.builtinRecipes[key];
            parts.push('<button type="button" class="snd-chip" data-act="load-builtin" data-key="' + this._esc(key) + '">'
                + this._esc(b.label) + '</button>');
        }
        parts.push('</div>');
        const recipes = app.readings();
        parts.push('<div class="snd-sec-title">我的配方（' + recipes.recipes + ' 条 / 上限 '
            + cat.limits.maxRecipes + '）</div>');
        parts.push('<div class="snd-recipes">');
        if (!app.recipes.length) parts.push('<div class="snd-note">还没有自定义配方</div>');
        for (const r of app.recipes) {
            parts.push('<div class="snd-recipe-row" data-key="' + this._esc(r.key) + '">');
            parts.push('<span class="snd-recipe-name">' + this._esc(r.label) + '</span>');
            parts.push('<span class="snd-recipe-meta">' + r.notes.length + ' 个音符 · 约 '
                + Math.round(this._recipeMs(r)) + ' 毫秒</span>');
            parts.push('<button type="button" class="snd-btn" data-act="edit-recipe" data-key="' + this._esc(r.key) + '">编辑</button>');
            parts.push('<button type="button" class="snd-btn" data-act="export-recipe" data-key="' + this._esc(r.key) + '">导出码</button>');
            parts.push('<button type="button" class="snd-btn snd-del" data-act="delete-recipe" data-key="' + this._esc(r.key) + '">删除</button>');
            parts.push('</div>');
        }
        parts.push('</div>');
        parts.push('</div>');
        return parts.join('');
    }

    /** 草稿的校验读数（视图只读，不自己实现校验 —— 真源是数据层）。 */
    _draftCheck() {
        return this.app.checkNotes(this._draft.notes);
    }
    _draftPlan() {
        return this.app.planOfDraft(this._draft.notes, this._draft.volume);
    }
    _recipeMs(r) {
        let max = 0;
        for (const n of (Array.isArray(r.notes) ? r.notes : [])) {
            max = Math.max(max, (Number(n.at) + Number(n.dur)) * 1000);
        }
        return max;
    }

    /* ══════════ 分享面板 ══════════ */
    _sharePanel() {
        const app = this.app;
        const cat = app.catalogs();
        const d = this._draft;
        const parts = ['<div class="snd-panel snd-share">'];
        parts.push('<div class="snd-sec-title">分享码 · 只带配方，不带任何外链</div>');
        parts.push('<div class="snd-note">前缀 <code>' + this._esc(cat.limits.sharePrefix) + '</code>'
            + ' · 导出前先过校验门（坏音符根本不进码）</div>');
        parts.push('<textarea class="snd-code" data-k="code" rows="4" placeholder="粘贴分享码">'
            + this._esc(d.code) + '</textarea>');
        parts.push('<div class="snd-row">');
        parts.push('<button type="button" class="snd-btn snd-primary" data-act="import-code">导入这条码</button>');
        parts.push('<button type="button" class="snd-btn" data-act="copy-code">复制当前码</button>');
        parts.push('</div>');
        const lp = app.lastPlay();
        parts.push('<div class="snd-note">台账：导出过 ' + app.ledger.exportedKeys.length
            + ' 条 · 试听过 ' + app.ledger.previewedKeys.length + ' 个槽'
            + (lp ? ' · 上次试听 ' + this._esc(lp.reason || 'ok') : '') + '</div>');
        parts.push('<div class="snd-sec-title">CSS 绑定注释（读回 / 写出）</div>');
        parts.push('<textarea class="snd-code" data-k="css" rows="3" placeholder="贴一段 CSS，读回里面的绑定">'
            + this._esc(this._cssProbe) + '</textarea>');
        parts.push('<div class="snd-row">');
        parts.push('<button type="button" class="snd-btn" data-act="read-css">读回绑定</button>');
        parts.push('<button type="button" class="snd-btn" data-act="write-css">把当前绑定写进去</button>');
        parts.push('</div>');
        parts.push('</div>');
        return parts.join('');
    }

    /* ══════════ 设置面板 ══════════ */
    _settingsPanel() {
        const app = this.app;
        const cat = app.catalogs();
        const r = app.readings();
        const parts = ['<div class="snd-panel snd-settings">'];
        parts.push('<div class="snd-sec-title">试听总音量</div>');
        parts.push('<div class="snd-field"><label>总音量</label>'
            + '<input type="range" class="snd-range" data-k="master" min="0" max="1" step="0.05" value="'
            + app.masterVolumeOf() + '" /><span class="snd-range-val">' + app.masterVolumeOf() + '</span></div>');
        parts.push('<div class="snd-sec-title">读数</div>');
        for (const s of cat.states) {
            parts.push('<div class="snd-read"><span>' + this._esc(s.label) + '</span>'
                + '<span>' + (r.counts[s.key] || 0) + ' 个槽</span></div>');
        }
        parts.push('<div class="snd-read"><span>自定义配方</span><span>' + r.recipes + ' 条（余 '
            + r.recipeRoom + '）</span></div>');
        parts.push('<div class="snd-read"><span>坏音符</span><span>' + r.droppedNotes + ' 个（配方里还有 '
            + r.recipeDropped + ' 个）</span></div>');
        parts.push('<div class="snd-read"><span>内置配方</span><span>' + r.builtinCount + ' 条</span></div>');
        if (r.unresolvedCount) {
            parts.push('<div class="snd-warn">' + r.unresolvedCount + ' 个槽位指向了不存在的配方：'
                + this._esc(r.unresolved.map((u) => u.slot + '(' + u.why + ')').join('、')) + '</div>');
        }
        parts.push('<div class="snd-sec-title">语音二态开关（读数面）</div>');
        const sf = app.speechFaceOf(this._truthProbe, this._surfaceProbe);
        parts.push('<div class="snd-read"><span>当前显示</span><span>' + this._esc(sf.mode) + '</span></div>');
        parts.push('<div class="snd-note">' + this._esc(sf.text || '（两种都没有）') + '</div>');
        parts.push('</div>');
        return parts.join('');
    }

    /* ══════════ 波形预览（纯读数画 SVG，不出声） ══════════ */
    /**
     * 把播放计划画成方块图：横轴是时间、纵轴是频率（对数感），色深是增益。
     * ★ 这一块**不依赖 AudioContext** —— 无头环境里也能看到配方长什么样。
     * ★ 纵轴的两端**不许手写**（本版第三处同族缺陷）：频率上下界是数据层的上限，
     *   视图再写一遍 20 / 20000 就是第二个真源 —— 上限一改，波形图的纵轴**静默失真**。
     */
    _waveSVG(plan, lim) {
        const p = plan && plan.ok ? plan : null;
        if (!p) {
            return '<div class="snd-wave-empty">这条没有声音（'
                + this._esc(plan && plan.reason ? plan.reason : 'no_sound') + '）</div>';
        }
        const L = lim || this.app.catalogs().limits;
        const fMin = Math.max(1, L.freqMin);
        const fMax = Math.max(fMin + 1, L.freqMax);
        const lo = Math.log(fMin);
        const span = Math.log(fMax) - lo;
        const W = 320;
        const H = 64;
        const total = Math.max(0.05, p.totalMs / 1000);
        const parts = ['<svg class="snd-wave-svg" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none">'];
        for (const st of p.steps) {
            const x = Math.round((st.startAt / total) * (W - 6));
            const w = Math.max(3, Math.round(((st.stopAt - st.startAt) / total) * (W - 6)));
            const f = Math.max(0, Math.min(1, (Math.log(Math.max(fMin, st.freq)) - lo) / span));
            const h = Math.max(4, Math.round(8 + f * (H - 16)));
            const y = H - h - 4;
            const op = Math.max(0.25, Math.min(1, st.peak));
            parts.push('<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h
                + '" rx="2" opacity="' + op.toFixed(2) + '"></rect>');
        }
        parts.push('</svg>');
        parts.push('<div class="snd-wave-meta">' + p.steps.length + ' 个音符 · 共 '
            + Math.round(p.totalMs) + ' 毫秒</div>');
        return parts.join('');
    }

    /* ══════════ 事件 ══════════ */
    _bindEvents() {
        if (!this._root) return;
        const root = this._root;
        root.addEventListener('click', (e) => {
            const t = e.target;
            const tab = t && t.getAttribute ? t.getAttribute('data-tab') : null;
            if (tab) { this.app.setTab(tab); this.refresh(); return; }
            const act = t && t.getAttribute ? t.getAttribute('data-act') : null;
            if (!act) return;
            const slot = t.getAttribute('data-slot') || '';
            const key = t.getAttribute('data-key') || '';
            const idx = t.getAttribute('data-i');
            if (act === 'preview') {
                const r = this.app.play(slot);
                this._flash = r.ok ? '试听 ' + slot + '：' + Math.round(r.totalMs) + ' 毫秒'
                    : '试听 ' + slot + '：没响（' + r.reason + '）';
            } else if (act === 'bind-builtin') {
                const cat = this.app.catalogs();
                const r = this.app.bind(slot, 'builtin', cat.builtins[0], 0.6);
                this._flash = r.ok ? '已绑内置「' + cat.builtinRecipes[cat.builtins[0]].label + '」' : '绑定失败：' + r.reason;
            } else if (act === 'bind-custom') {
                const first = this.app.recipes[0];
                const r = first ? this.app.bind(slot, 'custom', first.key, first.volume)
                    : { ok: false, reason: 'no_custom_recipe' };
                this._flash = r.ok ? '已绑自定义「' + first.label + '」' : '绑定失败：' + r.reason;
            } else if (act === 'bind-silent') {
                this.app.bind(slot, 'silent');
                this._flash = '已把 ' + slot + ' 设为静音（**与没绑不同**）';
            } else if (act === 'bind-none') {
                this.app.bind(slot, 'none');
                this._flash = '已解绑 ' + slot;
            } else if (act === 'close-recipe') {
                this.app.closeRecipe();
                this.refresh();
                return;
            } else if (act === 'add-note') {
                this._draft.notes.push({ freq: 660, at: 0, dur: 0.2, type: 'sine', gain: 0.5 });
                this.refresh();
                return;
            } else if (act === 'del-note') {
                const i = Number(idx);
                if (i >= 0 && i < this._draft.notes.length) this._draft.notes.splice(i, 1);
                this.refresh();
                return;
            } else if (act === 'save-recipe') {
                const r = this.app.saveRecipe({
                    key: this._draft.key || undefined,
                    label: this._draft.label,
                    notes: this._draft.notes,
                    volume: this._draft.volume
                });
                this._flash = r.ok
                    ? (r.replaced ? '已覆盖配方「' + this._draft.label + '」' : '已保存配方「' + this._draft.label + '」')
                    : '保存失败：' + r.reason;
            } else if (act === 'clear-draft') {
                this._draft.key = '';
                this._draft.label = '';
                this._draft.notes = [{ freq: 880, at: 0, dur: 0.3, type: 'sine', gain: 0.6 }];
                this.refresh();
                return;
            } else if (act === 'load-builtin') {
                const cat = this.app.catalogs();
                const b = cat.builtinRecipes[key];
                if (b) {
                    this._draft.key = '';
                    this._draft.label = b.label;
                    this._draft.notes = b.notes.map((n) => ({ ...n }));
                }
                this.refresh();
                return;
            } else if (act === 'edit-recipe') {
                const rec = this.app.recipeByKey(key);
                if (rec) {
                    this._draft.key = rec.key;
                    this._draft.label = rec.label;
                    this._draft.volume = rec.volume;
                    this._draft.notes = rec.notes.map((n) => ({ ...n }));
                    this.app.openRecipe(rec.key);
                }
                this.refresh();
                return;
            } else if (act === 'export-recipe') {
                const r = this.app.exportRecipe(key);
                this._flash = r.ok ? '已生成分享码（长度 ' + r.code.length + '）' : '导出失败：' + r.reason;
                if (r.ok) this._draft.code = r.code;
            } else if (act === 'delete-recipe') {
                const r = this.app.deleteRecipe(key);
                this._flash = r.ok ? '已删除配方（绑它的槽位一并解绑）' : '这条配方本来就不在';
            } else if (act === 'import-code') {
                const r = this.app.importRecipe(this._draft.code);
                this._flash = r.ok ? '已导入为「' + r.key + '」（丢掉 ' + r.dropped + ' 个坏音符）'
                    : '导入失败：' + r.reason;
            } else if (act === 'copy-code') {
                this._flash = '分享码已放在下面的框里（长度 ' + this._draft.code.length + '）';
            } else if (act === 'read-css') {
                const b = this.app.readCssBinding(this._cssProbe);
                this._flash = b ? '读回绑定：' + b.mode + (b.key ? '/' + b.key : '') : '这段 CSS 里没有绑定注释';
            } else if (act === 'write-css') {
                const r = this.app.writeCssBinding(this._cssProbe, this._draft.slot);
                this._cssProbe = r.css;
                this._flash = r.ok ? '已写进 CSS 顶部（旧的那行先剥掉）' : '这个槽位没绑东西，只剥不写';
                this.refresh();
                return;
            }
            this.refresh();
        });
        root.addEventListener('input', (e) => {
            const t = e.target;
            if (!t || !t.getAttribute) return;
            const k = t.getAttribute('data-k');
            const i = t.getAttribute('data-i');
            if (k === 'master') {
                this.app.setMasterVolume(t.value);
                this.refresh();
                return;
            }
            if (k === 'slot-volume') {
                const sl = t.getAttribute('data-slot') || '';
                const r = this.app.setSlotVolume(sl, t.value);
                this._flash = r.ok ? sl + ' 这一条的音量改成 ' + r.volume : '这个槽位没绑东西，改不了音量';
                return;
            }
            if (k === 'code') { this._draft.code = t.value; return; }
            if (k === 'css') { this._cssProbe = t.value; return; }
            if (i !== null && k) {
                const idx = Number(i);
                const n = this._draft.notes[idx];
                if (!n) return;
                const v = (k === 'type') ? t.value : Number(t.value);
                n[k] = v;
                const s = this._draftCheck();
                const el = this._q('.snd-warn');
                if (el) el.textContent = s.dropped ? ('有 ' + s.dropped + ' 个音符放不了') : '';
                return;
            }
            if (k === 'label') { this._draft.label = t.value; return; }
            if (k === 'volume') { this._draft.volume = Number(t.value); return; }
        });
    }
}
/** CSS 探针（视图私有草稿，不落盘）。 */
SoundkitView.prototype._cssProbe = '';
SoundkitView.prototype._truthProbe = '原台词示例';
SoundkitView.prototype._surfaceProbe = '污染台词示例';