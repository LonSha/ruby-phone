/* ========================================================
 * magazine-view.js — [v3.36.0] 杂志 视图层
 * 照抄 pixiv / lofter / date / taobao 规格：`_buildHTML()` 拼串 → `innerHTML`
 * → `_bindEvents()`。只在 render / refresh 里读 App 现算值，**不缓存投影**（防陈旧）。
 *
 * 四条视图纪律：
 *  ① **切块只有数据层一份实现**：视图拿 `app.blocks(id)` 的结构直接画，
 *     绝不自己 split 行、绝不自己判「这行算提问还是算回答」。
 *     源把十套解析器写在渲染里，同一行在不同类型下归类不同，且没人能回答
 *     「这行到底被识别成什么」—— 本件把这件事变成数据。
 *  ② **期号是事实不是位置**：视图直接显示 `article.vol`，
 *     绝不 `index + 1`（源 `_getVolNum` 用位置反查 ⇒ 删掉中间一篇后
 *     后面所有篇的期号集体前移，旧导出的 TXT 与新读到的期号对不上）。
 *  ③ **受访者查不到人必须看得见**：源 `_getNpcNames` 用 `.filter(Boolean)`
 *     把查不到的人整条抹掉，三人访谈少一人读者看不出来。本件把
 *     `missing` 计数画出来（「有 N 位受访者查不到人」）。
 *  ④ **译文不拼 HTML**：按段落建元素，绝不把整段转义后塞 innerHTML ——
 *     源 `_escHtml` 转发 `Utils.escapeHtml`，译文里的任何标签都变成可见字符。
 * ======================================================== */
'use strict';
import {
    MAGAZINE_REASONS, MAGAZINE_TYPES, MAGAZINE_TYPE_LABELS, MAGAZINE_TYPE_COLORS,
    MAGAZINE_FEATURE_ICONS, MAGAZINE_POLL_MEDALS, MAGAZINE_ARROW_KINDS,
    MAGAZINE_TIME_UNITS,
} from './magazine-data.js';

/** 箭头 → SVG marker 属性。★ 键**取真源常量**（`MAGAZINE_ARROW_KINDS` 里那四个），
 *  不手写第二份 —— 数据层多认一个箭头而视图静默不画 marker，就是「手写键 = 第二个真源」
 *  那个形态（本仓 J7 记过）。`⇔` 与 `↔` 语义相同（双向），故两者共用一个键位。 */
const ARROW_MARKERS = {
    [MAGAZINE_ARROW_KINDS[1]]: ' marker-end="url(#mgz-arrow-end)"',
    [MAGAZINE_ARROW_KINDS[2]]: ' marker-start="url(#mgz-arrow-start)"',
    [MAGAZINE_ARROW_KINDS[0]]: ' marker-start="url(#mgz-arrow-start)" marker-end="url(#mgz-arrow-end)"',
    [MAGAZINE_ARROW_KINDS[3]]: ' marker-start="url(#mgz-arrow-start)" marker-end="url(#mgz-arrow-end)"',
};

/** HTML 转义要 replace 掉的「双引号」——用**字符数组 + split/join**，不写成正则字面量。
 *  ★ 本仓判据共用的剥注释器（`stripComments`）是字符状态机、**不解析正则字面量**：
 *    正则字面量里一旦出现半个引号，剥器就把它当成字符串的起头，从那一行往后块注释再也剥不掉。
 *    v3.31.0 在 date-view 上当场踩到，本件一律照 date / lofter / pixiv 的写法抄。 */
const DQUOTE = '"';
/** `&` 的**拼装形**（不写实体字面量：落盘传输链会把 `&amp;` 这类字面量解码成真字符，
 *  于是 `_esc` 静默失效却不报错 —— v3.35.0 在数据层当场踩过这个坑）。 */
const AMP = String.fromCharCode(38);

/** 三态人话（「还没有稿件」与「读不出来」**不许同形**）。 */
const FACE_META = {
    [MAGAZINE_REASONS.ok]: { icon: '\u{1f4d6}', label: '杂志社开着', tone: 'ok' },
    [MAGAZINE_REASONS.empty]: { icon: '\u{1f4c4}', label: '还没有稿件', tone: 'warn' },
    [MAGAZINE_REASONS.storage_absent]: { icon: '\u26a0\ufe0f', label: '存储不可用（读数拿不到）', tone: 'err' },
};

const TABS = [
    { key: 'list', label: '目录' },
    { key: 'new', label: '取材' },
    { key: 'search', label: '检索' },
    { key: 'settings', label: '设置' },
];

/** 时间读数的人话（数据层只给 `{unit, value}` 事实，文案在视图）。
 *  ★ 键**取真源常量**（`MAGAZINE_TIME_UNITS`），不手写 —— 手写就是第二个真源。 */
const AGO_TEXT = {
    [MAGAZINE_TIME_UNITS[1]]: () => '刚刚',
    [MAGAZINE_TIME_UNITS[2]]: (v) => v + ' 分钟前',
    [MAGAZINE_TIME_UNITS[3]]: (v) => v + ' 小时前',
    [MAGAZINE_TIME_UNITS[4]]: (v) => v + ' 天前',
    [MAGAZINE_TIME_UNITS[0]]: () => '时间不详',
};

export class MagazineView {
    constructor(app, shell, storage) {
        this.app = app;
        this.shell = shell;
        this.storage = storage;
        this._root = null;
        this._flash = '';
        this._promptFor = '';
        this._promptText = '';
        this._draft = {
            type: 'seiyuu', theme: '', featureKey: 'bag', bodyLanguage: 'jp',
            peopleIds: [], paste: '', search: '', name: '', translation: '',
        };
    }
    render() {
        const container = this.shell && this.shell.getContentContainer ? this.shell.getContentContainer() : null;
        if (!container) return;
        container.innerHTML = '';
        this._root = document.createElement('div');
        this._root.className = 'mgz-root';
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

    _buildHTML() {
        const app = this.app;
        const face = app.faceOf();
        const meta = FACE_META[face] || { icon: '\u2753', label: '未识别的状态：' + String(face), tone: 'warn' };
        const cur = app.tab();
        const parts = [];
        parts.push('<div class="mgz-header"><h2>\u{1f4d6} ' + this._esc(app.settings.magazineName) + '</h2>'
            + '<span class="mgz-header-sub">动画杂志</span></div>');
        parts.push('<div class="mgz-face mgz-face-' + meta.tone + '">');
        parts.push('<span class="mgz-face-icon">' + meta.icon + '</span>');
        parts.push('<span class="mgz-face-label">' + this._esc(meta.label) + '</span>');
        parts.push('<span class="mgz-face-sub">' + this._esc(app.summaryLine()) + '</span>');
        parts.push('</div>');
        if (this._flash) parts.push('<div class="mgz-flash">' + this._esc(this._flash) + '</div>');
        if (this._promptFor) parts.push(this._promptPanel());
        const curId = app.currentId();
        if (cur === 'reader' && curId) parts.push(this._readerPanel(curId));
        parts.push('<div class="mgz-tabs">');
        for (const t of TABS) {
            parts.push('<button class="mgz-tab' + (cur === t.key || (cur === 'reader' && t.key === 'list') ? ' is-on' : '') + '" data-tab="' + t.key + '">');
            parts.push('<span class="mgz-tab-label">' + this._esc(t.label) + '</span>');
            parts.push('</button>');
        }
        parts.push('</div>');
        if (cur === 'new') parts.push(this._newPanel());
        else if (cur === 'search') parts.push(this._searchPanel());
        else if (cur === 'settings') parts.push(this._settingsPanel());
        else if (!(cur === 'reader' && curId)) parts.push(this._listPanel());
        return parts.join('');
    }

    /* ---------- 目录 ---------- */
    _listPanel() {
        const app = this.app;
        const arr = app.articlesNewest();
        const parts = [];
        const counts = app.groupCounts();
        const chips = [];
        for (const t of MAGAZINE_TYPES) {
            if (!counts[t]) continue;
            chips.push('<span class="mgz-chip" style="border-color:' + MAGAZINE_TYPE_COLORS[t] + '">'
                + this._esc(MAGAZINE_TYPE_LABELS[t]) + ' ' + counts[t] + '</span>');
        }
        if (chips.length) parts.push('<div class="mgz-chips">' + chips.join('') + '</div>');
        if (!arr.length) {
            const e = app.empty();
            parts.push('<div class="mgz-empty">');
            parts.push('<div class="mgz-empty-text">' + this._esc(e.reason === MAGAZINE_REASONS.storage_absent
                ? '读不出来（存储不可用）' : '还没有稿件 —— 去「取材」页产一份要求文本，把结果贴回来') + '</div>');
            parts.push('</div>');
            return parts.join('');
        }
        parts.push('<div class="mgz-list">');
        for (const a of arr) {
            const cover = app.cover(a.id);
            const t = app.timeFace(a.id);
            const people = app.peopleByIds(a.peopleIds);
            parts.push('<div class="mgz-card" data-open="' + this._esc(a.id) + '">');
            parts.push('<div class="mgz-card-cover" style="background:' + (cover ? cover.typeColor : '#888') + '">');
            parts.push('<span class="mgz-card-vol">' + this._esc(cover ? cover.volLabel : '') + '</span>');
            parts.push('</div>');
            parts.push('<div class="mgz-card-main">');
            parts.push('<div class="mgz-card-title">' + this._esc(a.title || a.theme) + '</div>');
            parts.push('<div class="mgz-card-meta">' + this._esc(app.typeLabel(a.type))
                + ' · ' + this._esc((AGO_TEXT[t.unit] || AGO_TEXT.none)(t.value)) + '</div>');
            if (people.display) parts.push('<div class="mgz-card-npc">' + this._esc(people.display) + '</div>');
            /* ★ 查不到人必须看得见（源用 filter(Boolean) 整条抹掉）。 */
            if (people.missing.length) {
                parts.push('<div class="mgz-card-warn">有 ' + people.missing.length + ' 位受访者查不到人</div>');
            }
            parts.push('</div>');
            parts.push('<div class="mgz-card-side">');
            parts.push('<button class="mgz-mini" data-open="' + this._esc(a.id) + '">读</button>');
            parts.push('<button class="mgz-mini" data-share="' + this._esc(a.id) + '">分享</button>');
            parts.push('<button class="mgz-mini mgz-mini-err" data-del="' + this._esc(a.id) + '">删</button>');
            parts.push('</div>');
            parts.push('</div>');
        }
        parts.push('</div>');
        return parts.join('');
    }

    /* ---------- 阅读面 ---------- */
    _readerPanel(id) {
        const app = this.app;
        const f = app.find(id);
        if (!f.found) return '<div class="mgz-empty"><div class="mgz-empty-text">这一篇不在了</div></div>';
        const a = f.article;
        const cover = app.cover(id);
        const people = app.peopleByIds(a.peopleIds);
        const parsed = app.blocks(id);
        const parts = [];
        parts.push('<div class="mgz-reader">');
        parts.push('<div class="mgz-reader-top">');
        parts.push('<button class="mgz-mini" data-back="1">← 回目录</button>');
        parts.push('<span class="mgz-reader-vol">' + this._esc(cover ? cover.volLabel : '') + '</span>');
        parts.push('<span class="mgz-reader-type" style="color:' + (cover ? cover.typeColor : '#888') + '">'
            + this._esc(app.typeLabel(a.type)) + '</span>');
        parts.push('</div>');
        parts.push('<h3 class="mgz-reader-title">' + this._esc(a.title || a.theme) + '</h3>');
        if (people.display) parts.push('<div class="mgz-reader-npc">' + this._esc(people.display) + '</div>');
        if (people.missing.length) {
            parts.push('<div class="mgz-card-warn">有 ' + people.missing.length + ' 位受访者查不到人（已如实留空，未静默抹掉）</div>');
        }
        /* ★ 「解析器没认出来」与「这篇文章没内容」**不许同形** —— 如实画出来。 */
        if (parsed.unknown) {
            parts.push('<div class="mgz-card-warn">有 ' + parsed.unknown + ' 行没认出格式，已按原文照排</div>');
        }
        if (!parsed.blocks.length) {
            parts.push('<div class="mgz-empty"><div class="mgz-empty-text">正文是空的（不是解析失败）</div></div>');
        } else {
            parts.push(this._bodyHTML(a.type, parsed.blocks, id));
        }
        parts.push('<div class="mgz-reader-acts">');
        parts.push('<button class="mgz-btn" data-share="' + this._esc(a.id) + '">分享文本</button>');
        parts.push('<button class="mgz-btn" data-export="' + this._esc(a.id) + '">导出 TXT</button>');
        parts.push('<button class="mgz-btn" data-print="' + this._esc(a.id) + '">可打印版</button>');
        parts.push('<button class="mgz-btn mgz-btn-warn" data-del="' + this._esc(a.id) + '">删除</button>');
        parts.push('</div>');
        parts.push(this._translationBlock(id));
        parts.push('</div>');
        return parts.join('');
    }

    /** 按**块类型**画正文（视图不判行、不切块）。 */
    _bodyHTML(type, blocks, id) {
        const parts = ['<div class="mgz-body">'];
        let cardOpen = false;
        for (const b of blocks) {
            if (!b || typeof b !== 'object') continue;
            switch (b.kind) {
                case 'gap':
                    if (cardOpen) { parts.push('</div>'); cardOpen = false; }
                    parts.push('<div class="mgz-gap"></div>');
                    break;
                case 'question':
                    parts.push('<div class="mgz-q">' + this._esc(b.text) + '</div>');
                    break;
                case 'answer':
                    parts.push('<div class="mgz-a"><span class="mgz-a-name">' + this._esc(b.name) + '：</span>'
                        + this._esc(b.text) + '</div>');
                    break;
                case 'prose':
                    parts.push('<div class="mgz-p' + (b.unparsed ? ' mgz-p-warn' : '') + '">' + this._esc(b.text) + '</div>');
                    break;
                case 'rank': {
                    const medal = b.rank !== null && MAGAZINE_POLL_MEDALS[b.rank] ? MAGAZINE_POLL_MEDALS[b.rank] : '';
                    const pct = parseFloat(b.pct);
                    const w = Number.isFinite(pct) ? Math.min(pct, 100) : 0;
                    parts.push('<div class="mgz-rank">');
                    parts.push('<div class="mgz-rank-head">');
                    if (medal) parts.push('<span class="mgz-rank-medal">' + this._esc(medal) + '</span>');
                    parts.push('<span class="mgz-rank-num">' + this._esc(b.rank === null ? '?' : String(b.rank)) + '位</span>');
                    parts.push('<span class="mgz-rank-name">' + this._esc(b.name) + '</span>');
                    parts.push('<span class="mgz-rank-pct">' + this._esc(b.pct) + '</span>');
                    parts.push('</div>');
                    parts.push('<div class="mgz-rank-bar-wrap"><div class="mgz-rank-bar" style="width:' + w + '%"></div></div>');
                    parts.push('</div>');
                    break;
                }
                case 'comment':
                    parts.push('<div class="mgz-cmt">「' + this._esc(b.text) + '」</div>');
                    break;
                case 'card':
                    if (cardOpen) parts.push('</div>');
                    parts.push('<div class="mgz-feat">');
                    parts.push('<div class="mgz-feat-head"><span class="mgz-feat-icon">'
                        + this._esc(MAGAZINE_FEATURE_ICONS[this._featureKeyOf(id)] || '◆') + '</span>'
                        + '<span class="mgz-feat-name">' + this._esc(b.name) + '</span></div>');
                    cardOpen = true;
                    break;
                case 'cardline':
                    parts.push('<div class="mgz-feat-line">' + this._esc(b.text) + '</div>');
                    break;
                case 'letter':
                    parts.push('<div class="mgz-letter' + (b.header ? ' mgz-letter-head' : '') + '">' + this._esc(b.text) + '</div>');
                    break;
                case 'reply':
                    parts.push('<div class="mgz-reply' + (b.header ? ' mgz-reply-head' : '') + '">' + this._esc(b.text) + '</div>');
                    break;
                case 'talk':
                    parts.push('<div class="mgz-talk"><span class="mgz-talk-name">' + this._esc(b.name) + '</span>'
                        + '「' + this._esc(b.dialogue) + '」</div>');
                    break;
                case 'narration':
                    parts.push('<div class="mgz-narr">' + this._esc(b.text) + '</div>');
                    break;
                case 'relation':
                    parts.push('<div class="mgz-rel">◆ ' + this._esc(b.from) + ' ' + this._esc(b.arrow) + ' '
                        + this._esc(b.to) + '：' + this._esc(b.desc) + '</div>');
                    break;
                case 'note':
                    parts.push('<div class="mgz-note">' + this._esc(b.text) + '</div>');
                    break;
                default:
                    parts.push('<div class="mgz-p">' + this._esc(b.text || '') + '</div>');
                    break;
            }
        }
        if (cardOpen) parts.push('</div>');
        /* 关系图：**有节点才画图**，没节点走兜底原文（源只在关系图上做了兜底）。 */
        if (type === 'chart') {
            const g = this.app.graph(id);
            if (g.nodes.length) parts.push(this._chartHTML(id, g));
            else {
                const fb = this.app.graphFallback(id);
                parts.push('<div class="mgz-chart-fallback">');
                parts.push('<div class="mgz-card-warn">关系一条都没认出来，已按原文照排（不是「没有内容」）</div>');
                for (const line of fb) parts.push('<div class="mgz-p">' + this._esc(line) + '</div>');
                parts.push('</div>');
            }
        }
        parts.push('</div>');
        return parts.join('');
    }

    _featureKeyOf(id) {
        const a = this.app.articleById(id);
        return a && a.featureKey ? a.featureKey : '';
    }

    /** 关系图（纯 SVG 字符串；坐标来自数据层纯函数，视图不算几何）。 */
    _chartHTML(id, g) {
        const layout = this.app.graphLayout(id);
        const parts = [];
        parts.push('<div class="mgz-chart">');
        parts.push('<svg viewBox="0 0 ' + layout.width + ' ' + layout.height + '" class="mgz-chart-svg">');
        parts.push('<defs><marker id="mgz-arrow-end" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">'
            + '<polygon points="0 0, 8 3, 0 6" fill="currentColor"/></marker>'
            + '<marker id="mgz-arrow-start" markerWidth="8" markerHeight="6" refX="0" refY="3" orient="auto">'
            + '<polygon points="8 0, 0 3, 8 6" fill="currentColor"/></marker></defs>');
        for (const e of layout.edges) {
            const pA = layout.positions[e.from];
            const pB = layout.positions[e.to];
            if (!pA || !pB) continue;
            const marker = ARROW_MARKERS[e.arrow] || '';
            parts.push('<line x1="' + pA.x + '" y1="' + pA.y + '" x2="' + pB.x + '" y2="' + pB.y
                + '" class="mgz-edge"' + marker + '/>');
            const mx = Math.round(((pA.x + pB.x) / 2) * 100) / 100;
            const my = Math.round(((pA.y + pB.y) / 2) * 100) / 100;
            const desc = e.desc.length > 12 ? e.desc.slice(0, 12) + '…' : e.desc;
            parts.push('<text x="' + mx + '" y="' + my + '" text-anchor="middle" dominant-baseline="central"'
                + ' font-size="10" class="mgz-edge-label">' + this._esc(desc) + '</text>');
        }
        for (const n of layout.nodes) {
            const p = layout.positions[n];
            if (!p) continue;
            parts.push('<circle cx="' + p.x + '" cy="' + p.y + '" r="22" fill="' + (layout.colors[n] || '#888') + '" class="mgz-node"/>');
            parts.push('<text x="' + p.x + '" y="' + p.y + '" text-anchor="middle" dominant-baseline="central"'
                + ' font-size="10" class="mgz-node-label">' + this._esc(n.length > 5 ? n.slice(0, 5) : n) + '</text>');
        }
        parts.push('</svg>');
        if (g.droppedNodes || g.droppedEdges) {
            parts.push('<div class="mgz-card-warn">节点上限 ' + layout.nodes.length + '：另有 '
                + g.droppedNodes + ' 个节点 / ' + g.droppedEdges + ' 条关系未画出（如实计数）</div>');
        }
        for (const nt of layout.notes) parts.push('<div class="mgz-note">' + this._esc(nt) + '</div>');
        parts.push('</div>');
        return parts.join('');
    }

    /** 译文块：**逐段建元素**（不拼整段 HTML —— 见视图纪律④）。 */
    _translationBlock(id) {
        const paras = this.app.translation(id);
        const parts = ['<div class="mgz-tl">'];
        if (paras.length) {
            parts.push('<div class="mgz-tl-head">中文译文</div>');
            for (const p of paras) parts.push('<div class="mgz-tl-p">' + this._esc(p) + '</div>');
            parts.push('<button class="mgz-mini" data-tlclear="' + this._esc(id) + '">清掉译文</button>');
        } else {
            parts.push('<div class="mgz-tl-head">中文译文（还没有）</div>');
        }
        parts.push('<textarea id="mgz-tl-input" class="mgz-input mgz-ta" placeholder="把译文贴在这里（空行分段）"></textarea>');
        parts.push('<button class="mgz-mini" data-tlsave="' + this._esc(id) + '">存译文</button>');
        parts.push('</div>');
        return parts.join('');
    }

    /* ---------- 取材 ---------- */
    _newPanel() {
        const app = this.app;
        const d = this._draft;
        const parts = ['<div class="mgz-new">'];
        parts.push('<div class="mgz-new-row"><label>稿件类型</label>');
        parts.push('<select id="mgz-new-type" class="mgz-input">');
        for (const t of app.typeOptions()) {
            parts.push('<option value="' + this._esc(t.key) + '"' + (d.type === t.key ? ' selected' : '') + '>'
                + this._esc(t.label) + '</option>');
        }
        parts.push('</select></div>');
        if (d.type === 'feature') {
            parts.push('<div class="mgz-new-row"><label>企划模板</label>');
            parts.push('<select id="mgz-new-feature" class="mgz-input">');
            for (const f of app.featureOptions()) {
                parts.push('<option value="' + this._esc(f.key) + '"' + (d.featureKey === f.key ? ' selected' : '') + '>'
                    + this._esc(f.label) + '</option>');
            }
            parts.push('</select></div>');
        }
        parts.push('<div class="mgz-new-row"><label>主题</label>');
        parts.push('<input id="mgz-new-theme" class="mgz-input" value="' + this._esc(d.theme) + '" placeholder="例：新曲收录现场" /></div>');
        parts.push('<div class="mgz-new-row"><label>正文语言</label>');
        parts.push('<select id="mgz-new-lang" class="mgz-input">');
        parts.push('<option value="jp"' + (d.bodyLanguage === 'jp' ? ' selected' : '') + '>日文</option>');
        parts.push('<option value="cn"' + (d.bodyLanguage === 'cn' ? ' selected' : '') + '>中文</option>');
        parts.push('</select></div>');
        if (app.needsPeople(d.type)) {
            parts.push('<div class="mgz-new-row mgz-new-people"><label>受访者</label><div class="mgz-people">');
            for (const p of app.peopleAll()) {
                const on = d.peopleIds.includes(p.id);
                parts.push('<button class="mgz-person' + (on ? ' is-on' : '') + '" data-person="' + this._esc(p.id) + '">'
                    + this._esc((p.role || '') + '・' + (p.name || '')) + '</button>');
            }
            parts.push('</div></div>');
        }
        parts.push('<button class="mgz-btn" id="mgz-make-prompt">产要求文本</button>');
        parts.push('<div class="mgz-hint">本件**不发任何请求**：把这段文本复制到你惯用的对话端，再把结果贴回下面。</div>');
        parts.push('<div class="mgz-new-row"><label>把结果贴回来</label>');
        parts.push('<textarea id="mgz-paste" class="mgz-input mgz-ta" placeholder="第一行写 TITLE: 标题，随后是正文"></textarea></div>');
        parts.push('<button class="mgz-btn" id="mgz-ingest">登记这一篇</button>');
        parts.push('</div>');
        return parts.join('');
    }

    /** 要求文本面板（可复制）。 */
    _promptPanel() {
        const parts = ['<div class="mgz-prompt">'];
        parts.push('<div class="mgz-prompt-head"><span>要求文本（复制走）</span>');
        parts.push('<button class="mgz-mini" id="mgz-prompt-close">收起</button></div>');
        parts.push('<textarea class="mgz-input mgz-ta mgz-ta-lg" readonly>' + this._esc(this._promptText) + '</textarea>');
        parts.push('<div class="mgz-prompt-acts">');
        parts.push('<button class="mgz-mini" id="mgz-prompt-copy">全选（手动复制）</button>');
        parts.push('</div>');
        parts.push('</div>');
        return parts.join('');
    }

    /* ---------- 检索 ---------- */
    _searchPanel() {
        const app = this.app;
        const parts = ['<div class="mgz-search">'];
        parts.push('<input id="mgz-search" class="mgz-input" value="' + this._esc(this._draft.search)
            + '" placeholder="搜标题 / 主题 / 正文 / 类型" />');
        const q = this._draft.search;
        if (q) {
            const r = app.search(q);
            parts.push('<div class="mgz-search-meta">命中 ' + r.total + ' 篇'
                + (r.capped ? '（只列前 ' + r.hits.length + ' 篇）' : '') + '</div>');
            if (!r.total) parts.push('<div class="mgz-empty"><div class="mgz-empty-text">没有命中</div></div>');
            for (const h of r.hits) {
                const a = app.articleById(h.id);
                if (!a) continue;
                const sn = app.snippet(h.id, q);
                parts.push('<div class="mgz-hit" data-open="' + this._esc(h.id) + '">');
                parts.push('<div class="mgz-hit-title">' + this._esc(a.title || a.theme) + '</div>');
                parts.push('<div class="mgz-hit-meta">命中 ' + this._esc(h.fields.join(' / ')) + '</div>');
                if (sn) parts.push('<div class="mgz-hit-sn">' + this._esc(sn) + '</div>');
                parts.push('</div>');
            }
        }
        parts.push('</div>');
        return parts.join('');
    }

    /* ---------- 设置 ---------- */
    _settingsPanel() {
        const app = this.app;
        const l = app.ledgerFace();
        const r = app.readings();
        const parts = ['<div class="mgz-set">'];
        parts.push('<div class="mgz-set-row"><label>杂志名</label>');
        parts.push('<input id="mgz-set-name" class="mgz-input" value="' + this._esc(app.settings.magazineName) + '" /></div>');
        parts.push('<div class="mgz-set-row"><label>正文语言</label>');
        parts.push('<select id="mgz-set-lang" class="mgz-input">');
        parts.push('<option value="jp"' + (app.settings.bodyLanguage === 'jp' ? ' selected' : '') + '>日文</option>');
        parts.push('<option value="cn"' + (app.settings.bodyLanguage === 'cn' ? ' selected' : '') + '>中文</option>');
        parts.push('</select></div>');
        parts.push('<div class="mgz-set-row"><label>默认类型</label>');
        parts.push('<select id="mgz-set-type" class="mgz-input">');
        for (const t of app.typeOptions()) {
            parts.push('<option value="' + this._esc(t.key) + '"'
                + (app.settings.defaultType === t.key ? ' selected' : '') + '>' + this._esc(t.label) + '</option>');
        }
        parts.push('</select></div>');
        parts.push('<div class="mgz-set-readings">');
        parts.push('<div>稿件 ' + r.totalArticles + ' 篇 · 分享 ' + l.shared + ' · 导出 ' + l.exported + '</div>');
        parts.push('<div>丢弃 ' + r.dropped + ' · 截断 ' + r.trimmed + ' 字 · 撞号 ' + r.volConflicts + ' · 未识别行 ' + r.unparsed + '</div>');
        parts.push('</div>');
        parts.push('<button class="mgz-btn" id="mgz-export-all">导出全刊 TXT</button>');
        parts.push('</div>');
        return parts.join('');
    }

    /* ---------- 事件 ---------- */
    _bindEvents() {
        const app = this.app;
        for (const el of this._qa('[data-tab]')) {
            el.addEventListener('click', () => { app.setTab(el.getAttribute('data-tab')); this.refresh(); });
        }
        for (const el of this._qa('[data-open]')) {
            el.addEventListener('click', () => { app.openArticle(el.getAttribute('data-open')); this.refresh(); });
        }
        const back = this._q('[data-back]');
        if (back) back.addEventListener('click', () => { app.backToList(); this.refresh(); });
        for (const el of this._qa('[data-del]')) {
            el.addEventListener('click', () => {
                const id = el.getAttribute('data-del');
                const r = app.removeArticle(id);
                this._flash = r.removed ? '已删掉这一篇' : '这一篇本来就不在';
                app.backToList();
                this.refresh();
            });
        }
        for (const el of this._qa('[data-share]')) {
            el.addEventListener('click', () => {
                const r = app.shareText(el.getAttribute('data-share'));
                this._flash = r.reason === 'ok' ? '分享文本已生成（' + r.text.length + ' 字，可复制）' : '这一篇不在了';
                this.refresh();
            });
        }
        for (const el of this._qa('[data-export]')) {
            el.addEventListener('click', () => {
                const r = app.exportOne(el.getAttribute('data-export'));
                this._flash = r.reason === 'ok' ? '导出文本已生成（' + r.text.length + ' 字）' : '这一篇不在了';
                this.refresh();
            });
        }
        for (const el of this._qa('[data-print]')) {
            el.addEventListener('click', () => {
                const p = app.printable(el.getAttribute('data-print'));
                this._flash = p ? ('可打印版 ' + p.rows.length + ' 行'
                    + (p.unknownBlocks ? '（其中 ' + p.unknownBlocks + ' 行未识别）' : '')) : '这一篇不在了';
                this.refresh();
            });
        }
        /* 取材面 */
        const selType = this._q('#mgz-new-type');
        if (selType) selType.addEventListener('change', (e) => { this._draft.type = e.target.value; this.refresh(); });
        const selFeat = this._q('#mgz-new-feature');
        if (selFeat) selFeat.addEventListener('change', (e) => { this._draft.featureKey = e.target.value; this.refresh(); });
        const inTheme = this._q('#mgz-new-theme');
        if (inTheme) inTheme.addEventListener('input', (e) => { this._draft.theme = e.target.value; });
        const selLang = this._q('#mgz-new-lang');
        if (selLang) selLang.addEventListener('change', (e) => { this._draft.bodyLanguage = e.target.value; this.refresh(); });
        for (const el of this._qa('[data-person]')) {
            el.addEventListener('click', () => {
                const id = el.getAttribute('data-person');
                const i = this._draft.peopleIds.indexOf(id);
                if (i >= 0) this._draft.peopleIds.splice(i, 1); else this._draft.peopleIds.push(id);
                this.refresh();
            });
        }
        const mk = this._q('#mgz-make-prompt');
        if (mk) mk.addEventListener('click', () => {
            const r = app.promptBlock(this._draft.type, {
                theme: this._draft.theme,
                peopleIds: this._draft.peopleIds,
                featureKey: this._draft.type === 'feature' ? this._draft.featureKey : undefined,
            });
            this._promptFor = this._draft.type;
            this._promptText = r.text;
            this._flash = '要求文本已生成（' + r.chars + ' 字' + (r.capped ? '，已到上限' : '') + '）';
            this.refresh();
        });
        const pc = this._q('#mgz-prompt-close');
        if (pc) pc.addEventListener('click', () => { this._promptFor = ''; this._promptText = ''; this.refresh(); });
        const pcp = this._q('#mgz-prompt-copy');
        if (pcp) pcp.addEventListener('click', () => {
            const ta = this._q('.mgz-ta-lg');
            if (ta && typeof ta.select === 'function') ta.select();
            this._flash = '已全选（用系统复制）';
            this.refresh();
        });
        const pa = this._q('#mgz-paste');
        if (pa) pa.addEventListener('input', (e) => { this._draft.paste = e.target.value; });
        const ing = this._q('#mgz-ingest');
        if (ing) ing.addEventListener('click', () => {
            if (!this._draft.paste.trim()) { this._flash = '先把结果贴进来'; this.refresh(); return; }
            const r = app.ingest({
                type: this._draft.type,
                theme: this._draft.theme,
                peopleIds: this._draft.peopleIds,
                featureKey: this._draft.type === 'feature' ? this._draft.featureKey : undefined,
                response: this._draft.paste,
            });
            if (r.reason === 'ok' && r.article) {
                this._flash = '已登记 VOL.' + r.article.vol + '（' + app.typeLabel(r.article.type) + '）'
                    + (r.dropped ? '，同时按上限丢了 ' + r.dropped + ' 条旧稿' : '');
                this._draft.paste = '';
                app.setTab('list');
            } else {
                this._flash = '登记失败：输入不合法';
            }
            this.refresh();
        });
        /* 检索 */
        const sea = this._q('#mgz-search');
        if (sea) sea.addEventListener('input', (e) => { this._draft.search = e.target.value; this.refresh(); });
        /* 设置 */
        const sn = this._q('#mgz-set-name');
        if (sn) sn.addEventListener('change', (e) => {
            const r = app.rename(e.target.value);
            this._flash = '杂志名改成「' + r.name + '」' + (r.trimmed ? '（截掉 ' + r.trimmed + ' 字）' : '');
            this.refresh();
        });
        const sl = this._q('#mgz-set-lang');
        if (sl) sl.addEventListener('change', (e) => { app.setBodyLanguage(e.target.value); this.refresh(); });
        const st = this._q('#mgz-set-type');
        if (st) st.addEventListener('change', (e) => { app.setDefaultType(e.target.value); this.refresh(); });
        const ea = this._q('#mgz-export-all');
        if (ea) ea.addEventListener('click', () => {
            const r = app.exportAll();
            this._flash = '全刊文本已生成（' + r.text.length + ' 字）';
            this.refresh();
        });
        /* 译文 */
        const tls = this._q('[data-tlsave]');
        if (tls) tls.addEventListener('click', () => {
            const ta = this._q('#mgz-tl-input');
            const r = app.setTranslation(tls.getAttribute('data-tlsave'), ta ? ta.value : '');
            this._flash = r.ok ? ('译文已存' + (r.trimmed ? '（截掉 ' + r.trimmed + ' 字）' : '')) : '这一篇不在了';
            this.refresh();
        });
        const tlc = this._q('[data-tlclear]');
        if (tlc) tlc.addEventListener('click', () => {
            app.setTranslation(tlc.getAttribute('data-tlclear'), '');
            this._flash = '译文已清掉';
            this.refresh();
        });
    }

    _esc(s) {
        return String(s === null || s === undefined ? '' : s)
            .split(AMP).join(AMP + 'amp;')
            .split('<').join(AMP + 'lt;')
            .split('>').join(AMP + 'gt;')
            .split(DQUOTE).join(AMP + 'quot;');
    }
}