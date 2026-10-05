/* ========================================================
 * pvdesk-view.js — [v3.43.0] PV 案头 · 视图层
 * 照抄 musicdesk / sourcebook / kettle 规格：_buildHTML() 拼串 → innerHTML
 * → _bindEvents()。只在 render / refresh 里读 App 现算值，**不缓存投影**。
 *
 * 六条视图纪律（逐条对着源的静默失效）：
 *  ① **四态逐格分开画**：「还没写题面」与「写了但认不出」与「读数拿不到」不同形
 *     —— 源把读不出来的那一份画成「没有」，用户以为今天没这活。
 *  ② **镜头区间反了逐条报**：源只认正序，反序的镜头被静默跳过，
 *     于是分镜表上少了几镜而没人知道。
 *  ③ **镜头体为空逐条报**：源照收空体，出片侧拿到一镜空白。
 *  ④ **歌词坏行逐项列**：几行没时间标签、几处标签后没字（源静默丢）。
 *  ⑤ **上限画余量、不画硬闸**：源满了只丢一句「已裁剪」；本件给余量与拒绝原因。
 *  ⑥ **空与坏不同形**：读数取不出来画横线，**不是零**。
 *
 * 本文件与数据层同守的纪律：不写正则字面量（本仓剥注释器是字符状态机，
 * 正则里的裸引号会让它卡住）；与号、双引号与单引号一律走**拼装形**
 * （不写实体字面量：落盘传输链会把实体字面量解码成真字符，转义函数静默失效）。
 * ======================================================== */
'use strict';
/* ★ 这里只取**键面**真源（四态取值与几项上限）。清单不在这里：
 *   逐镜、逐句、逐素材的行由 App 的各类 Rows() 现算给出 —— 视图不持第二份
 *   清单，否则真源表增删一项，视图会静默少画一行（本仓 J7 形态）。 */
import {
    PV_FACES, PV_SHOT_MAX, PV_HARD_LIMIT_CHARS, PV_REFS_MAX, PV_REFS_MAX_WIDE,
    PV_CAST_MAX, PV_CAPTION_MIN, PV_LRC_LINE_MAX, PV_META_TAGS, PV_FIG_MARKS,
    PV_DURATION_MIN, PV_DURATION_MAX
} from './pvdesk-data.js';
import { writeLanded } from '../../config/write-receipt.js';

/** 转义要 replace 的几个字符 —— 用**拼装形**，不写实体字面量。 */
const AMP = String.fromCharCode(38);
const LT = String.fromCharCode(60);
const GT = String.fromCharCode(62);
const DQUOTE = String.fromCharCode(34);
const SQ = String.fromCharCode(39);
const NL = String.fromCharCode(10);
const DASH = String.fromCharCode(8212);
const UNI_HEAD = String.fromCharCode(55356) + String.fromCharCode(57246);

/** 四态色相（**键面取数据层真源**，不写标识符形 —— 本仓 J7 形态）。 */
const FACE_TONE = Object.freeze({
    [PV_FACES[0]]: 'ok',
    [PV_FACES[1]]: 'warn',
    [PV_FACES[2]]: 'err',
    [PV_FACES[3]]: 'err'
});

const TABS = [
    { key: 'brief', label: '题面' },
    { key: 'shots', label: '镜头' },
    { key: 'cast', label: '对白' },
    { key: 'lyrics', label: '歌词' },
    { key: 'compose', label: '成文' },
    { key: 'shelf', label: '台账' }
];

/** 视图层：六页签（题面 / 镜头 / 对白 / 歌词 / 成文 / 台账）。 */
export class PvdeskView {
    constructor(app, shell, storage) {
        this.app = app;
        this.shell = shell;
        this.storage = storage;
        this._root = null;
        this._flash = '';
    }
    render() {
        const container = this.shell && this.shell.getContentContainer ? this.shell.getContentContainer() : null;
        if (!container) return;
        container.innerHTML = '';
        this._root = document.createElement('div');
        /* ★ 四态色调挂在根上（面色相表在这里**真被用上**，不是摆设）。 */
        this._root.className = 'pvd-root ' + this._tone(this.app.faceOf());
        this._root.innerHTML = this._buildHTML();
        container.appendChild(this._root);
        this._bindEvents();
    }
    refresh() {
        if (!this._root) return;
        this._root.className = 'pvd-root ' + this._tone(this.app.faceOf());
        this._root.innerHTML = this._buildHTML();
        this._bindEvents();
    }
    _q(sel) { return this._root ? this._root.querySelector(sel) : null; }
    /** 转义（与号与三个引号走拼装形 —— 见文件头纪律）。 */
    _esc(s) {
        return String(s == null ? '' : s)
            .split(AMP).join(AMP + 'amp;')
            .split(LT).join(AMP + 'lt;')
            .split(GT).join(AMP + 'gt;')
            .split(DQUOTE).join(AMP + 'quot;')
            .split(SQ).join(AMP + '#39;');
    }
    /** 计数位：null 画横线（**不是零**）—— 「真的没有」与「读不出来」不同形。 */
    _count(v) {
        return (v === null || v === undefined) ? DASH : String(v);
    }
    _tone(t) { return t ? ('pvd-tone-' + this._esc(t)) : 'pvd-tone-none'; }

    /* ---------- 通用小块 ---------- */
    /** 下拉：allowNone 时第一项是「没给」——「没给」与「给了但认不出」不同形。 */
    _sel(kind, items, cur, noneLabel) {
        const parts = [];
        parts.push('<select class="pvd-sel" data-pick="' + this._esc(kind) + '">');
        if (noneLabel) {
            parts.push('<option value=""' + (cur ? '' : ' selected') + '>' + this._esc(noneLabel) + '</option>');
        }
        for (let i = 0; i < items.length; i++) {
            const it = items[i];
            /* ★ 取值字段先认 key，再认真源的 n：时长档给的是 { n, label }。
             *   取错字段不会报错，只会「选什么都没反应」（项值全是 undefined）。 */
            const v = (it.key === undefined) ? String(it.n) : it.key;
            parts.push('<option value="' + this._esc(v) + '"' + (String(cur) === String(v) ? ' selected' : '')
                + '>' + this._esc(it.label) + '</option>');
        }
        parts.push('</select>');
        return parts.join('');
    }
    _chip(label, value, of) {
        const over = (of > 0 && value !== null && value >= of);
        return '<span class="pvd-chip' + (value === null ? ' is-unk' : (over ? ' is-over' : ''))
            + '">' + this._esc(label) + ' <b>' + this._count(value) + '</b>'
            + (of > 0 ? ('/' + String(of)) : '') + '</span>';
    }

    /* ---------- 头与页签 ---------- */
    _buildHTML() {
        const app = this.app;
        const face = app.faceOf();
        const tone = FACE_TONE[face] || 'warn';
        const parts = [];
        parts.push('<div class="pvd-head"><h2>' + UNI_HEAD + ' PV 案头</h2>'
            + '<span class="pvd-head-sub">把分镜脚本与歌词收拾成一份可复制的要求文本'
            + ' —— 本件不出图、不出片、不合成、不联网、不读宿主界面</span></div>');
        parts.push('<div class="pvd-face pvd-face-' + tone + '">');
        parts.push('<span class="pvd-face-label">' + this._esc(app.faceTextOf()) + '</span>');
        parts.push('<span class="pvd-face-sub">' + this._esc(app.summaryLine()) + '</span>');
        parts.push('</div>');
        parts.push(this._gaugeBlock());
        if (this._flash) parts.push('<div class="pvd-flash">' + this._esc(this._flash) + '</div>');
        const cur = app.tab();
        parts.push('<div class="pvd-tabs">');
        for (let i = 0; i < TABS.length; i++) {
            const t = TABS[i];
            parts.push('<button type="button" class="pvd-tab' + (cur === t.key ? ' is-on' : '')
                + '" data-tab="' + t.key + '">' + this._esc(t.label) + '</button>');
        }
        parts.push('</div>');
        if (cur === 'shots') parts.push(this._shotsPanel());
        else if (cur === 'cast') parts.push(this._castPanel());
        else if (cur === 'lyrics') parts.push(this._lyricsPanel());
        else if (cur === 'compose') parts.push(this._composePanel());
        else if (cur === 'shelf') parts.push(this._shelfPanel());
        else parts.push(this._briefPanel());
        return parts.join('');
    }
    /** 余量面：四项上限一律画「读数 / 上限」，取不出来画横线。 */
    _gaugeBlock() {
        const rows = this.app.gaugeRows();
        const parts = [];
        parts.push('<div class="pvd-gauges">');
        for (let i = 0; i < rows.length; i++) {
            const g = rows[i];
            parts.push(this._chip(g.label, g.value, g.of));
        }
        if (!this.app.readingsOk()) {
            parts.push('<span class="pvd-chip is-unk">读数拿不到（存储不可用）</span>');
        }
        parts.push('</div>');
        return parts.join('');
    }

    /* ---------- 面板 ①：题面 ---------- */
    _briefPanel() {
        const app = this.app;
        const cat = app.catalogs();
        const info = app.parseInfo();
        const pv = app.previewOf();
        const meta = app.briefMeta();
        const parts = [];
        parts.push('<div class="pvd-panel">');
        parts.push('<p class="pvd-hint">两种回信都吃得进：键值形态（标题 / 时长 / 风格 / 镜头 / 情绪）与分镜脚本形态（镜头 1（0-3秒）…）。两种都没认出时报原因，'
            + '<b>不静默当成空的</b>。镜头体里以「使用的素材」打头的行一律剔掉（源口径）。</p>');
        parts.push('<div class="pvd-row"><span>时长</span>' + this._sel('duration', cat.durations, app.durationOf(), '') + '</div>');
        parts.push('<div class="pvd-row"><span>机型</span>' + this._sel('lens', cat.perspectives, app.lensOf(), '没给') + '</div>');
        parts.push('<div class="pvd-row"><span>画风</span>' + this._sel('style', cat.styles, app.styleOf(), '没给') + '</div>');
        parts.push('<div class="pvd-row"><span>情绪</span>' + this._sel('mood', cat.moods, app.moodOf(), '没给') + '</div>');
        parts.push('<textarea class="pvd-ta" data-k="reply" rows="6" placeholder="把分镜脚本或题面贴这里"></textarea>');
        parts.push('<div class="pvd-btns">');
        parts.push('<button type="button" data-act="ingest">收下题面</button>');
        parts.push('<button type="button" data-act="clear-brief">清空题面与台账</button>');
        parts.push('</div>');
        parts.push('<div class="pvd-reads">');
        parts.push(this._chip('镜头', info.shots, PV_SHOT_MAX));
        parts.push(this._chip('正文', info.chars, PV_HARD_LIMIT_CHARS));
        parts.push('</div>');
        parts.push('<div class="pvd-sub">时长档 ' + String(PV_DURATION_MIN) + ' 到 '
            + String(PV_DURATION_MAX) + ' 秒（默认 ' + String(app.durationOf()) + ' 秒）'
            + ' · 预览阈值 ' + String(meta.limit) + ' 字'
            + (meta.truncated ? ('（正文超了，这里只显示前 ' + String(meta.keptChars) + ' 字）') : '') + '</div>');
        if (!info.ok) {
            parts.push('<div class="pvd-warn">这一份没认出来：<b>' + this._esc(app.whyTextOf(info.why)) + '</b>'
                + (info.saw ? ('（开头是「' + this._esc(info.saw) + '」）') : '') + '</div>');
        }
        if (info.truncated) {
            parts.push('<div class="pvd-warn">正文超硬限 ' + String(PV_HARD_LIMIT_CHARS) + ' 字：'
                + '只解了前 ' + String(info.keptChars) + ' 字，后面 <b>' + String(info.chars - info.keptChars)
                + '</b> 字没进来（源把整段照喂，不解释）</div>');
        }
        if (info.rejected.length > 0) {
            parts.push('<div class="pvd-warn">区间反了、或超了镜数上限的镜头，逐条列（源静默跳过）：</div>');
            parts.push('<ul class="pvd-list">');
            for (let i = 0; i < info.rejected.length; i++) {
                parts.push('<li>镜头 ' + this._esc(info.rejected[i].n) + ' · ' + this._esc(info.rejected[i].saw) + '</li>');
            }
            parts.push('</ul>');
        }
        if (info.emptyBodies.length > 0) {
            parts.push('<div class="pvd-warn">镜头体为空的（源照收，出片侧拿到一镜空白）：'
                + this._esc(info.emptyBodies.join(' / ')) + '</div>');
        }
        parts.push('<div class="pvd-sub">题面正文 ' + this._count(pv.chars) + ' 字'
            + (pv.truncated ? ('（这里只显示前 ' + String(pv.keptChars) + ' 字）') : '') + '</div>');
        parts.push('<pre class="pvd-pre">' + this._esc(pv.text || '（还没有题面）') + '</pre>');
        parts.push('</div>');
        return parts.join('');
    }

    /* ---------- 面板 ②：镜头 ---------- */
    _shotsPanel() {
        const app = this.app;
        const rows = app.shotRows();
        const parts = [];
        parts.push('<div class="pvd-panel">');
        parts.push('<p class="pvd-hint">每一镜给一段可直接拿去用的要求文本：画风锚 + 机型 + 情绪 + '
            + '这一镜挂到的立绘 + 「只画这一帧」的约束。点一行看这一镜的详情。</p>');
        if (rows.length === 0) {
            parts.push('<div class="pvd-empty">还没有镜头 —— 去「题面」页贴一段分镜脚本。</div>');
            parts.push('<button type="button" data-act="tab-brief">去题面</button>');
        } else {
            for (let i = 0; i < rows.length; i++) {
                const r = rows[i];
                parts.push('<div class="pvd-card' + (app.currentKey() === String(r.n) ? ' is-on' : '')
                    + '" data-open="' + String(r.n) + '">');
                parts.push('<div class="pvd-card-top"><span class="pvd-card-n">镜头 ' + this._esc(r.n) + '</span>'
                    + '<span class="pvd-card-clock">' + this._esc(r.clock) + '</span>'
                    + '<span class="pvd-chip">' + String(r.sec) + ' 秒</span>'
                    + (r.figs.length > 0 ? ('<span class="pvd-chip">立绘 ' + this._esc(r.figs.join('/')) + '</span>')
                        : '<span class="pvd-chip is-unk">没挂立绘</span>')
                    + (r.empty ? '<span class="pvd-chip is-over">这一镜是空的</span>' : '')
                    + this._fillTone(r.filled)
                    + '</div>');
                parts.push('<pre class="pvd-pre">' + this._esc(r.text) + '</pre>');
                if (app.currentKey() === String(r.n)) {
                    parts.push('<div class="pvd-detail">');
                    parts.push('<div class="pvd-row"><span>原镜正文</span></div>');
                    parts.push('<pre class="pvd-pre">' + this._esc(r.body || '（空）') + '</pre>');
                    parts.push('<button type="button" data-act="close-item">收起</button>');
                    parts.push('</div>');
                }
                parts.push('</div>');
            }
        }
        const refs = app.refRows();
        parts.push('<div class="pvd-sub">参考素材台账（源缩成一句「图1～图N」，超了只报一句「已裁剪」）</div>');
        if (refs.length === 0) {
            parts.push('<div class="pvd-empty">这一份还没挂过参考素材。</div>');
        } else {
            parts.push('<table class="pvd-table"><thead><tr><th>素材</th><th>用到几镜</th><th>哪几镜</th>'
                + '<th>当前上限</th><th>状态</th></tr></thead><tbody>');
            for (let i = 0; i < refs.length; i++) {
                const r = refs[i];
                parts.push('<tr' + (r.over ? ' class="pvd-over"' : '') + '><td>' + this._esc(r.key) + '</td><td>'
                    + String(r.shots) + '</td><td>' + this._esc(r.where || DASH) + '</td><td>' + String(r.limit)
                    + '</td><td>' + (r.over ? '已超限' : '在限内') + '</td></tr>');
            }
            parts.push('</tbody></table>');
        }
        const cuts = app.bodyCutRows();
        parts.push('<div class="pvd-sub">以「使用的素材」打头的行被剔掉了 '
            + this._count(cuts.length ? cuts.length : 0) + ' 镜：'
            + '源静默剔，用户只看到「这一镜怎么这么短」</div>');
        if (cuts.length > 0) {
            parts.push('<ul class="pvd-list">');
            for (let i = 0; i < cuts.length; i++) {
                parts.push('<li>镜头 ' + this._esc(cuts[i].n) + ' · 剔掉 ' + String(cuts[i].cut) + ' 行</li>');
            }
            parts.push('</ul>');
        }
        const map = app.figMapRowsOf(0);
        parts.push('<div class="pvd-sub">图号 → 镜号映射（源把它写成「连号就写区间」这一形；'
            + '把「只取前几镜做参考帧」填成正数就会生成映射行）</div>');
        if (map.lines.length === 0) {
            parts.push('<div class="pvd-empty">还没取参考帧。</div>');
        }
        parts.push('<div class="pvd-warn">立绘号「' + this._esc(PV_FIG_MARKS[0] + '」与「' + PV_FIG_MARKS[1])
            + '」都认（源口径：图 与 図 一个都不漏）</div>');
        parts.push('</div>');
        return parts.join('');
    }
    /** 逐格填写态：哪一格「没给」、哪一格「给了但认不出」（源都写「未指定」）。 */
    _fillTone(filled) {
        const f = filled || {};
        const parts = [];
        const names = { style: '画风', lens: '机型', mood: '情绪' };
        const keys = ['style', 'lens', 'mood'];
        for (let i = 0; i < keys.length; i++) {
            const k = keys[i];
            const v = f[k];
            if (v === 'ok') continue;
            const label = names[k] + (v === 'absent' ? '没给' : '认不出');
            parts.push('<span class="pvd-chip is-warn">' + this._esc(label) + '</span>');
        }
        return parts.join('');
    }

    /* ---------- 面板 ③：对白 ---------- */
    _castPanel() {
        const app = this.app;
        const rows = app.castRows();
        const langs = app.catalogs().langs;
        const parts = [];
        parts.push('<div class="pvd-panel">');
        parts.push('<p class="pvd-hint">按语速表核这一句塞不塞得进这一镜：'
            + '源只在心里估，估错了没人知道。语速口径：'
            + this._esc(langs.map((l) => (l.label + ' ' + String(l.pace))).join('；')) + '。</p>');
        parts.push('<div class="pvd-reads">');
        parts.push(this._chip('登场角色', app.refRows().length, PV_CAST_MAX));
        parts.push(this._chip('台词行', rows.length, 0));
        parts.push('</div>');
        if (rows.length === 0) {
            parts.push('<div class="pvd-empty">还没从镜头里读到对白 —— 台词写成「…」引号包起来就会被收进来。</div>');
        } else {
            parts.push('<table class="pvd-table"><thead><tr><th>镜头</th><th>这一镜几秒</th><th>台词</th>'
                + '<th>字数</th><th>字形</th><th>这一镜放得下</th><th>结论</th></tr></thead><tbody>');
            for (let i = 0; i < rows.length; i++) {
                const r = rows[i];
                parts.push('<tr' + (r.ok ? '' : ' class="pvd-over"') + '><td>' + this._esc(r.shot) + '</td><td>'
                    + String(r.sec) + '</td><td class="pvd-cell-text">' + this._esc(r.text) + '</td><td>'
                    + String(r.saw) + '</td><td>' + this._esc(app.vocabOf(r.text).cls) + '</td><td>'
                    + this._count(r.limit) + '</td><td>'
                    + (r.ok ? '塞得进' : this._esc(app.holdWhyTextOf(r.why))) + '</td></tr>');
            }
            parts.push('</tbody></table>');
        }
        parts.push('</div>');
        return parts.join('');
    }

    /* ---------- 面板 ④：歌词 ---------- */
    _lyricsPanel() {
        const app = this.app;
        const cat = app.catalogs();
        const info = app.lyricsInfo();
        const cues = app.captionRows();
        const dropped = app.droppedRows();
        const plan = app.captionPlan();
        const pol = app.policyOf();
        const cue = app.cueAt(0);
        const parts = [];
        parts.push('<div class="pvd-panel">');
        parts.push('<p class="pvd-hint">坏行不静默丢：没有时间标签的、标签成形成了但后面没字的，逐项列出来。'
            + '源把无时间戳的歌词按字数硬分，用户只会觉得「字幕怎么对不上」。</p>');
        parts.push('<div class="pvd-reads">');
        parts.push(this._chip('留下行数', info.lines, 0));
        parts.push(this._chip('成句', info.cues, 0));
        parts.push(this._chip('没时间标签', info.noTime, 0));
        parts.push(this._chip('标签后没字', info.noText, 0));
        parts.push(this._chip('元标签行', info.meta, 0));
        parts.push('</div>');
        parts.push('<div class="pvd-sub">字幕口径：一句最短停 ' + String(PV_CAPTION_MIN)
            + ' 秒 · 单行最长 ' + String(PV_LRC_LINE_MAX) + ' 字（超了按坏行报，不当成歌词收下）'
            + ' · 元标签认这 ' + String(PV_META_TAGS.length) + ' 个：'
            + this._esc(PV_META_TAGS.join('/')) + '</div>');
        parts.push('<div class="pvd-row"><span>这一刻是哪句</span>'
            + '<input class="pvd-num" type="number" min="0" step="1" data-k="cuesec" value="0">'
            + '<span class="pvd-sub">' + this._esc(cue.text ? (cue.clock + ' ' + cue.text)
                : ('这一秒没词（' + cue.why + '）')) + '</span></div>');
        const plain = app.plainRows();
        parts.push('<div class="pvd-sub">按字数排的正文行 ' + this._count(plain.length)
            + ' 行（没时间戳时只能读它；源自己有这一函数，不说就等于用户看不到）</div>');
        if (plain.length > 0) {
            parts.push('<ul class="pvd-list">');
            for (let i = 0; i < plain.length && i < 12; i++) {
                parts.push('<li>' + this._esc(plain[i].text) + '</li>');
            }
            parts.push('</ul>');
        }
        parts.push('<div class="pvd-sub">歌词形态：<b>' + this._esc(app.lyricsModeText()) + '</b>'
            + ' · 字幕排布：' + this._esc(plan.mode) + '（' + String(plan.slots) + ' 句 · 每句均摊 '
            + String(plan.perSlot) + ' 秒 · 主行上限 ' + String(plan.maxChars) + ' 字）</div>');
        parts.push('<textarea class="pvd-ta" data-k="lyrics" rows="6" placeholder="把 LRC 或纯歌词贴这里"></textarea>');
        parts.push('<div class="pvd-btns">');
        parts.push('<button type="button" data-act="ingest-lyrics">收下歌词</button>');
        parts.push('</div>');
        parts.push('<div class="pvd-sub">字幕策略</div>');
        parts.push('<div class="pvd-row"><span>主行最大字数</span>'
            + '<input class="pvd-num" type="number" min="4" max="40" step="1" data-k="maxchars" value="'
            + String(pol.maxChars) + '"></div>');
        parts.push('<div class="pvd-row"><span>语速口径</span>'
            + this._sel('lang', cat.langs, pol.lang, '') + '</div>');
        if (cues.length === 0) {
            parts.push('<div class="pvd-empty">还没有成句的歌词。</div>');
        } else {
            parts.push('<table class="pvd-table"><thead><tr><th>时刻</th><th>主行</th><th>副行</th>'
                + '<th>主行哪来</th><th>副行哪来</th></tr></thead><tbody>');
            for (let i = 0; i < cues.length; i++) {
                const c = cues[i];
                parts.push('<tr><td>' + this._esc(c.clock) + '</td><td class="pvd-cell-text">'
                    + this._esc(c.main || DASH) + '</td><td class="pvd-cell-text">'
                    + this._esc(c.sub || DASH) + '</td><td>-</td><td>'
                    + this._esc(c.subFrom === 'cut' ? '主行太长切下来的' : (c.subFrom === 'paren' ? '括注切出来的' : DASH))
                    + '</td></tr>');
            }
            parts.push('</tbody></table>');
        }
        if (dropped.length > 0) {
            parts.push('<div class="pvd-sub">没排进去的行</div>');
            parts.push('<table class="pvd-table"><thead><tr><th>第几行</th><th>原文开头</th><th>为什么</th>'
                + '</tr></thead><tbody>');
            for (let i = 0; i < dropped.length; i++) {
                const d = dropped[i];
                parts.push('<tr class="pvd-over"><td>' + String(d.line) + '</td><td class="pvd-cell-text">'
                    + this._esc(d.saw) + '</td><td>' + this._esc(app.whyTextOf(d.why) === d.why ? d.why : app.whyTextOf(d.why))
                    + '</td></tr>');
            }
            parts.push('</tbody></table>');
        }
        parts.push('</div>');
        return parts.join('');
    }

    /* ---------- 面板 ⑤：成文 ---------- */
    _composePanel() {
        const app = this.app;
        const pol = app.policyOf();
        const parts = [];
        parts.push('<div class="pvd-panel">');
        parts.push('<p class="pvd-hint">产出的是一份**可复制的要求文本**（素材指代 + 逐镜要求 + 负向控制）。'
            + '本件到此为止：不出图、不出片、不合成、不备份。</p>');
        parts.push('<div class="pvd-row"><span>宽素材上限</span>'
            + '<label class="pvd-check"><input type="checkbox" data-k="wide"' + (pol.wide ? ' checked' : '')
            + '> 打开（参考图上限 ' + String(PV_REFS_MAX) + ' → ' + String(PV_REFS_MAX_WIDE)
            + '，参考音频 15 秒 → 30 秒）</label></div>');
        parts.push('<div class="pvd-row"><span>只取前几镜做参考帧</span>'
            + '<input class="pvd-num" type="number" min="0" max="' + String(PV_SHOT_MAX)
            + '" step="1" data-k="frames" value="0"></div>');
        parts.push('<div class="pvd-row"><span>映射行预览</span>'
            + '<input class="pvd-num" type="number" min="0" max="' + String(PV_SHOT_MAX)
            + '" step="1" data-k="figmap" value="0"></div>');
        parts.push('<div class="pvd-btns">');
        parts.push('<button type="button" data-act="compose">配好这一份 · 产要求文本</button>');
        parts.push('<button type="button" data-act="save">存进台账</button>');
        parts.push('<button type="button" data-act="clear-draft">清掉这份草稿</button>');
        parts.push('<button type="button" data-act="clear-brief">清空题面与台账</button>');
        parts.push('</div>');
        const draft = app.draftOf();
        parts.push('<div class="pvd-sub">当前草稿 ' + this._count(draft ? draft.length : 0) + ' 字'
            + '（长按选中即可复制）</div>');
        parts.push('<pre class="pvd-pre pvd-pre-out">' + this._esc(draft || '（还没产过文本）') + '</pre>');
        parts.push('</div>');
        return parts.join('');
    }

    /* ---------- 面板 ⑥：台账与来源 ---------- */
    _shelfPanel() {
        const app = this.app;
        const rows = app.shelfRows();
        const ledger = app.ledgerRows();
        const info = app.ledgerInfo();
        const files = app.sourceFilesOf();
        const parts = [];
        parts.push('<div class="pvd-panel">');
        parts.push('<p class="pvd-hint">台账是「写过的每一份」，题面是「眼下这一份」—— 源把两者与成片任务混在一处，'
            + '清一次任务列表会把题面一起清掉。</p>');
        if (rows.length === 0) {
            parts.push('<div class="pvd-empty">台账还空着 —— 配好一份之后在「成文」页存进台账。</div>');
        } else {
            parts.push('<table class="pvd-table"><thead><tr><th>标题</th><th>镜头</th><th>字数</th><th>形态</th>'
                + '<th>存于</th><th></th></tr></thead><tbody>');
            for (let i = 0; i < rows.length; i++) {
                const r = rows[i];
                parts.push('<tr><td>' + this._esc(r.title) + '</td><td>' + this._esc(r.shots) + '</td><td>'
                    + this._esc(r.chars) + '</td><td>'
                    + this._esc(r.kind === 'cut' ? '配过文本' : '只有题面') + '</td><td>'
                    + this._esc(new Date(r.at).toLocaleString()) + '</td>'
                    + '<td><button type="button" data-rm="' + String(r.index) + '">划掉</button></td></tr>');
            }
            parts.push('</tbody></table>');
        }
        parts.push('<div class="pvd-sub">动作台账：留着 ' + this._count(info.kept) + ' / ' + this._count(info.max)
            + ' 条' + (info.dropped > 0 ? ('，被挤掉 <b>' + String(info.dropped) + '</b> 条') : '') + '</div>');
        if (ledger.length === 0) {
            parts.push('<div class="pvd-empty">还没有动作记录。</div>');
        } else {
            parts.push('<table class="pvd-table"><thead><tr><th>时刻</th><th>动作</th><th>结果</th>'
                + '<th>原因</th></tr></thead><tbody>');
            for (let i = 0; i < ledger.length; i++) {
                const l = ledger[i];
                parts.push('<tr' + (l.ok ? '' : ' class="pvd-over"') + '><td>'
                    + this._esc(new Date(l.at).toLocaleTimeString()) + '</td><td>' + this._esc(l.kind)
                    + '</td><td>' + (l.ok ? '成' : '没成') + '</td><td>'
                    + this._esc(l.why ? app.whyTextOf(l.why) : DASH) + '</td></tr>');
            }
            parts.push('</tbody></table>');
        }
        parts.push('<div class="pvd-btns">');
        parts.push('<button type="button" data-act="clear-ledger">清台账</button>');
        parts.push('</div>');
        parts.push('<div class="pvd-sub">出处</div>');
        parts.push('<div class="pvd-note">' + this._esc(app.sourceNoteOf()) + '</div>');
        parts.push('<ul class="pvd-list">');
        for (let i = 0; i < files.length; i++) {
            parts.push('<li>' + this._esc(files[i]) + '</li>');
        }
        parts.push('</ul>');
        const reads = app.readerRows();
        parts.push('<div class="pvd-sub">眼下这一份的六格读数（取不出来画横线 —— '
            + '「真的 0」与「读不出来」不同形）</div>');
        parts.push('<table class="pvd-table"><thead><tr><th>格</th><th>读数</th></tr></thead><tbody>');
        for (let i = 0; i < reads.length; i++) {
            parts.push('<tr><td>' + this._esc(reads[i].key) + '</td><td'
                + (reads[i].dash ? ' class="pvd-cell-text"' : '') + '>'
                + this._esc(reads[i].dash ? DASH : reads[i].text) + '</td></tr>');
        }
        parts.push('</tbody></table>');
        parts.push('</div>');
        return parts.join('');
    }

    /* ---------- 动作 ---------- */
    _act(name) {
        const app = this.app;
        if (name === 'tab-brief') { app.setTab('brief'); this._flash = ''; this.refresh(); return; }
        if (name === 'close-item') { app.closeItem(); this._flash = ''; this.refresh(); return; }
        if (name === 'ingest') {
            const box = this._q('[data-k="reply"]');
            const r = app.ingestReply(box ? box.value : '');
            if (r.ok !== true) {
                this._flash = '没收下（' + (r.why ? app.whyTextOf(r.why) : '没落下去') + '）';
                this.refresh();
                return;
            }
            const bits = [r.kind === 'brief' ? '收下题面' : '收下分镜脚本'];
            bits.push('镜头 ' + r.detail.shots + ' 镜');
            bits.push('正文 ' + r.detail.chars + ' 字');
            if (r.detail.rejected) bits.push('区间反了丢掉 ' + r.detail.rejected + ' 镜');
            if (r.detail.emptyBodies) bits.push('空体 ' + r.detail.emptyBodies + ' 镜');
            this._flash = bits.join(' · ');
            this.refresh();
            return;
        }
        if (name === 'ingest-lyrics') {
            const box = this._q('[data-k="lyrics"]');
            const r = app.ingestLyrics(box ? box.value : '');
            this._flash = writeLanded(r) ? ('收下歌词：' + app.lyricsModeText() + ' · 成句 ' + r.cues) : '歌词是空的，没记';
            this.refresh();
            return;
        }
        if (name === 'compose') {
            const box = this._q('[data-k="frames"]');
            const frames = box ? Number(box.value) : 0;
            const r = app.composeText({ frameCount: frames > 0 ? frames : 0 });
            if (r.ok !== true) {
                this._flash = '配不了：还没有镜头';
                this.refresh();
                return;
            }
            this._flash = '产好了 ' + r.chars + ' 字 · ' + r.blocks + ' 块 · 用了 ' + r.shots + ' 镜 · '
                + r.figs + ' 张立绘';
            app.setTab('compose');
            this.refresh();
            return;
        }
        if (name === 'save') {
            const r = app.saveToShelf({});
            this._flash = writeLanded(r) ? ('存进台账（' + r.shots + ' 镜 · ' + r.chars + ' 字）') : '存不进：还没有题面';
            this.refresh();
            return;
        }
        if (name === 'clear-draft') {
            app.clearDraft();
            this._flash = '草稿已清掉';
            this.refresh();
            return;
        }
        if (name === 'clear-ledger') {
            app.clearLedger();
            this._flash = '动作台账已清';
            this.refresh();
            return;
        }
        if (name === 'clear-brief') {
            app.clearBrief();
            this._flash = '题面与台账已清空';
            this.refresh();
        }
    }
    _flashOf(r, okText, badText) {
        if (writeLanded(r)) return okText;
        return badText + (r && r.why ? ('（' + r.why + '）') : '（没落下去）');
    }

    /* ---------- 事件 ---------- */
    _bindEvents() {
        const root = this._root;
        if (!root) return;
        /* 点击分派：从命中元素**向上找最近的带标记祖先**。
         *  ★ 卡片判定不许读直点元素：点卡片里的正文文字时 target 是子元素，
         *    判定落空 ⇒ 用户点正文没反应、必顶点留白才打开（源满篇 target 直读）。
         *  ★ 顺序：动作按钮**先于**卡片 —— 按钮在卡片内部，先判卡片会把按钮吃掉。 */
        const climb = (from, pred) => {
            let node = from;
            while (node && node !== root) {
                if (node.getAttribute && pred(node)) return node;
                node = node.parentNode;
            }
            return null;
        };
        root.addEventListener('click', (e) => {
            const t = e.target;
            if (!t || !t.getAttribute) return;
            const tabEl = climb(t, (n) => n.getAttribute('data-tab'));
            if (tabEl) {
                this.app.setTab(tabEl.getAttribute('data-tab'));
                this._flash = '';
                this.refresh();
                return;
            }
            const actEl = climb(t, (n) => n.getAttribute('data-act'));
            if (actEl) { this._act(actEl.getAttribute('data-act')); return; }
            const rmEl = climb(t, (n) => n.getAttribute('data-rm') !== null);
            if (rmEl) {
                const r = this.app.removeFromShelf(Number(rmEl.getAttribute('data-rm')));
                this._flash = writeLanded(r) ? ('台账还剩 ' + r.left + ' 份') : ('没有这一份（' + r.saw + '）');
                this.refresh();
                return;
            }
            const cardEl = climb(t, (n) => n.getAttribute('data-open') !== null);
            if (cardEl) {
                const r = this.app.openItem(cardEl.getAttribute('data-open'));
                this._flash = writeLanded(r) ? '' : ('找不到镜头 ' + r.key);
                this.refresh();
            }
        });
        root.addEventListener('change', (e) => {
            const t = e.target;
            if (!t || !t.getAttribute) return;
            const pick = t.getAttribute('data-pick');
            const k0 = t.getAttribute('data-k');
            if (pick === 'lens') {
                const r = this.app.setLens(t.value);
                this._flash = writeLanded(r) ? ('机型换成 ' + t.value) : '没这个机型，当没给';
                this.refresh();
                return;
            }
            if (pick === 'style') {
                const r = this.app.setStyle(t.value);
                this._flash = writeLanded(r) ? ('画风换成 ' + t.value) : (r.saw ? ('认不出这个画风（' + r.saw + '），当没给') : '画风当没给');
                this.refresh();
                return;
            }
            if (pick === 'mood') {
                const r = this.app.setMood(t.value);
                this._flash = writeLanded(r) ? ('情绪换成 ' + t.value) : '情绪当没给';
                this.refresh();
                return;
            }
            if (pick === 'duration') {
                const r = this.app.setDuration(t.value);
                this._flash = writeLanded(r) ? ('时长定成 ' + r.duration + ' 秒') : ('「' + r.saw + '」不收（'
                    + r.min + ' 到 ' + r.max + ' 秒）');
                this.refresh();
                return;
            }
            if (k0 === 'cuesec') {
                const r = this.app.cueAt(t.value);
                this._flash = writeLanded(r) ? ('第 ' + String(t.value) + ' 秒是「' + r.text + '」（' + r.clock + '）')
                    : ('第 ' + String(t.value) + ' 秒没词（' + r.why + '）');
                this.refresh();
                return;
            }
            if (k0 === 'figmap') {
                const r = this.app.figMapRowsOf(t.value);
                this._flash = r.frames > 0 ? ('映射行已生成 ' + r.lines.length + ' 条（取前 ' + r.frames + ' 镜）')
                    : '取 0 镜，不生成映射行';
                this.refresh();
                return;
            }
            if (pick === 'lang') {
                const r = this.app.setLang(t.value);
                this._flash = writeLanded(r) ? ('语速口径换成 ' + r.lang) : ('不认这个语言（' + r.saw + '）');
                this.refresh();
                return;
            }
            const k = t.getAttribute('data-k');
            if (k === 'maxchars') {
                const r = this.app.setMaxChars(t.value);
                this._flash = writeLanded(r) ? ('主行上限 ' + r.maxChars + ' 字') : ('「' + r.saw + '」不收（4 到 40 字）');
                this.refresh();
                return;
            }
            if (k === 'wide') {
                const r = this.app.setWide(t.checked === true);
                this._flash = writeLanded(r) ? ('宽素材上限' + (r.wide ? '已打开' : '已关闭') + '（参考图 ' + r.refs + ' 张）')
                    : '没改成就';
                this.refresh();
            }
        });
    }
}