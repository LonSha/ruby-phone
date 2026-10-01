/* ========================================================
 * musicdesk-view.js — [v3.42.0] 曲库案头 · 视图层
 * 照抄 needsim / kettle / sourcebook 规格：_buildHTML() 拼串 → innerHTML
 * → _bindEvents()。只在 render / refresh 里读 App 现算值，**不缓存投影**。
 *
 * 六条视图纪律：
 *  ① **四态逐格分开画**：「没了」与「读不出来」不同形 ——
 *     源把读不出来的曲库画成空列表，用户以为今天就是没歌。
 *  ② **时长读不出来画横线**：不是 00:00（源画 00:00，与真的 0 秒同形）。
 *  ③ **封面零外链**：出**色相块 + 首字**（源用一条外链托底图）。
 *  ④ **歌词坏行报出来**：几行没时间标签、几行没正文，逐项列（源静默丢）。
 *  ⑤ **去重与截断逐条报**：合并了几条、截掉几条（源静默）。
 *  ⑥ **空与坏不同形**：计数在读数取不出来时画横线而不是零。
 *
 * 本文件与数据层同守的纪律：不写正则字面量（本仓剥注释器是字符状态机，
 * 正则里的裸引号会让它卡住）；与号、双引号与单引号一律走**拼装形**
 * （不写实体字面量：落盘传输链会把实体字面量解码成真字符，
 * 转义函数会静默失效而不报错）。
 * ======================================================== */
'use strict';
/* ★ 这里只取**键面**真源（四态与三模式取值）。四态的清单不在这里：
 *   由 App 的各类 Rows() 现算给出 —— 视图不持第二份清单，
 *   否则真源表增删一态，视图会静默少画一态而不报错（本仓 J7 形态）。 */
import { MUS_FACES, MUS_STATES, MUS_PLAYBACK_MODES } from './musicdesk-data.js';

/** 转义要 replace 的三个字符 —— 用**拼装形**，不写实体字面量。 */
const DQUOTE = String.fromCharCode(34);
const SQ = String.fromCharCode(39);
const AMP = String.fromCharCode(38);
const LT = String.fromCharCode(60);
const GT = String.fromCharCode(62);
const NL = String.fromCharCode(10);
const DASH = String.fromCharCode(8212);
const UNI_HEAD = String.fromCharCode(55356) + String.fromCharCode(57259);

/** 四态人话与色相（**键面取数据层真源**，不写标识符形 —— 本仓 J7 形态）。 */
const FACE_TONE = {};
FACE_TONE[MUS_FACES[0]] = 'ok';
FACE_TONE[MUS_FACES[1]] = 'warn';
FACE_TONE[MUS_FACES[2]] = 'err';
FACE_TONE[MUS_FACES[3]] = 'err';

const STATE_TONE = {};
STATE_TONE[MUS_STATES[0]] = 'ok';
STATE_TONE[MUS_STATES[1]] = 'warn';
STATE_TONE[MUS_STATES[2]] = 'off';
STATE_TONE[MUS_STATES[3]] = 'err';

const TABS = [
    { key: 'shelf', label: '曲库' },
    { key: 'lyrics', label: '歌词' },
    { key: 'queue', label: '队列' },
    { key: 'source', label: '来源' },
    { key: 'form', label: '收拾' },
    { key: 'policy', label: '策略' }
];

/** 视图层：六页签（曲库 / 歌词 / 队列 / 来源 / 收拾 / 策略）。 */
export class MusicdeskView {
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
        this._root.className = 'msd-root';
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
    /** 色相令牌直接当类名（八档在数据层定，视图不重排）。 */
    _tone(t) { return t ? ('msd-tone-' + this._esc(t)) : 'msd-tone-none'; }
    _buildHTML() {
        const app = this.app;
        const face = app.faceOf();
        const tone = FACE_TONE[face] || 'warn';
        const parts = [];
        parts.push('<div class="msd-header"><h2>' + UNI_HEAD + ' 曲库案头</h2>'
            + '<span class="msd-header-sub">把对话端拿回来的那份曲目收拾好——本件不发请求、不读账号、不碰音频元件</span></div>');
        parts.push('<div class="msd-face msd-face-' + tone + '">');
        parts.push('<span class="msd-face-label">' + this._esc(app.faceTextOf(face)) + '</span>');
        parts.push('<span class="msd-face-sub">' + this._esc(app.summaryLine()) + '</span>');
        parts.push('</div>');
        if (this._flash) parts.push('<div class="msd-flash">' + this._esc(this._flash) + '</div>');
        const cur = app.tab();
        parts.push('<div class="msd-tabs">');
        for (const t of TABS) {
            parts.push('<button type="button" class="msd-tab' + (cur === t.key ? ' is-on' : '')
                + '" data-tab="' + t.key + '">' + this._esc(t.label) + '</button>');
        }
        parts.push('</div>');
        if (cur === 'lyrics') parts.push(this._lyricPanel());
        else if (cur === 'queue') parts.push(this._queuePanel());
        else if (cur === 'source') parts.push(this._sourcePanel());
        else if (cur === 'form') parts.push(this._formPanel());
        else if (cur === 'policy') parts.push(this._policyPanel());
        else parts.push(this._shelfPanel());
        return parts.join('');
    }

    /* ---------- 面板 ①：曲库 ---------- */
    _shelfPanel() {
        const app = this.app;
        const rows = app.songRows();
        const covers = app.coverRows();
        const parts = [];
        parts.push('<div class="msd-panel">');
        parts.push('<p class="msd-hint">时长读不出来的画横线，不画 00:00 —— '
            + '源把读不出来的时长与真的 0 秒长成同一个样子。封面一律不出外链：'
            + '出的是色相块加首字（源在没有封面时换成一条外链托底图）。</p>');
        parts.push('<div class="msd-covers">');
        if (!covers) {
            parts.push('<span class="msd-cover-none">封面读数拿不到（' + DASH + '）</span>');
        } else {
            for (const c of covers) {
                parts.push('<span class="msd-cover-count msd-state-' + this._esc(STATE_TONE[c.state] || 'off')
                    + '">' + this._esc(c.text) + ' ' + this._count(c.n) + '</span>');
            }
        }
        parts.push('</div>');
        if (!rows.length) {
            parts.push('<div class="msd-empty">这份曲库还空着 —— 去「收拾」页贴一段对话端给的回信，'
                + '或者点下面那行「产一段要求文本」把要什么写清楚。</div>');
            parts.push('<button type="button" data-act="tab-form">去收拾</button>');
        } else {
            parts.push('<div class="msd-list">');
            for (const r of rows) {
                parts.push('<div class="msd-song' + (r.onCursor ? ' is-on' : '') + '" data-open="' + r.index + '">');
                parts.push('<span class="msd-cover ' + this._tone(r.coverTone) + '">'
                    + this._esc(r.coverInitial || DASH) + '</span>');
                parts.push('<div class="msd-song-main">');
                parts.push('<div class="msd-song-top"><span class="msd-song-name">' + this._esc(r.name) + '</span>'
                    + '<span class="msd-song-dur' + (r.durationOk ? '' : ' is-unk') + '">'
                    + this._esc(r.durationText || DASH) + '</span></div>');
                parts.push('<div class="msd-song-sub">' + this._esc(r.artist)
                    + (r.album ? (' · ' + this._esc(r.album)) : ' · 专辑没给')
                    + (r.gone ? ' · <span class="msd-gone">这一条在源里找不到了</span>' : '') + '</div>');
                if (!r.durationOk) parts.push('<div class="msd-song-why">时长：' + this._esc(r.durationWhy) + '</div>');
                parts.push('</div>');
                parts.push('<span class="msd-song-cov msd-state-' + this._esc(STATE_TONE[r.coverState] || 'off') + '">'
                    + this._esc(app.stateTextOf(r.coverState)) + '</span>');
                parts.push('</div>');
            }
            parts.push('</div>');
        }
        const cur = app.currentKey();
        if (cur !== '') {
            const one = rows[Number(cur)];
            if (one) {
                parts.push('<div class="msd-detail">');
                parts.push('<div class="msd-detail-top"><span>曲目键</span>'
                    + '<span class="msd-mono">' + this._esc(one.key) + '</span></div>');
                parts.push('<div class="msd-detail-top"><span>稳定编号</span>'
                    + '<span class="msd-mono">' + this._esc(one.id) + '</span></div>');
                parts.push('<div class="msd-detail-top"><span>时长读数</span>'
                    + '<span class="msd-mono">' + this._esc(one.durationWhy || 'ok') + '</span></div>');
                parts.push('<button type="button" data-act="close">收起</button>');
                parts.push('</div>');
            }
        }
        parts.push('<div class="msd-modes">');
        for (const m of app.modeRows()) {
            parts.push('<button type="button" class="msd-mode' + (m.on ? ' is-on' : '') + '" data-mode="'
                + this._esc(m.key) + '">' + this._esc(m.label) + '</button>');
        }
        parts.push('<button type="button" data-act="step">下一首</button>');
        parts.push('</div>');
        parts.push('</div>');
        return parts.join('');
    }

    /* ---------- 面板 ②：歌词 ---------- */
    _lyricPanel() {
        const app = this.app;
        const l = app.lyricRows();
        const parts = [];
        parts.push('<div class="msd-panel">');
        parts.push('<p class="msd-hint">坏行不静默丢：没有时间标签的、标签成形成了但后面没字的，逐项列出来。'
            + '源拿正则试一次不中就跳过 —— 用户只会觉得「这首歌歌词怎么这么短」。</p>');
        parts.push('<div class="msd-lyr-bar">');
        parts.push('<span>留下 <b>' + this._count(l.kept) + '</b> 行</span>');
        parts.push('<span>时间标签 <b>' + this._count(l.tags) + '</b> 个</span>');
        parts.push('<span class="msd-state-warn">没有时间标签 <b>' + this._count(l.noTime) + '</b> 行</span>');
        parts.push('<span class="msd-state-warn">标签后没字 <b>' + this._count(l.noText) + '</b> 处</span>');
        if (l.capped) parts.push('<span class="msd-state-err">超上限没放下 <b>' + l.capped + '</b> 行</span>');
        parts.push('</div>');
        if (!l.lines.length) {
            parts.push('<div class="msd-empty">还没贴过歌词 —— 在「收拾」页把对话端给的歌词原文整段贴进来。</div>');
        } else {
            parts.push('<ol class="msd-lyric-list">');
            for (const x of l.lines) {
                parts.push('<li class="msd-lyric"><span class="msd-lyric-at msd-mono">'
                    + this._esc(x.timeText) + '</span><span class="msd-lyric-tx">' + this._esc(x.text) + '</span></li>');
            }
            parts.push('</ol>');
        }
        parts.push('</div>');
        return parts.join('');
    }

    /* ---------- 面板 ③：队列 ---------- */
    _queuePanel() {
        const app = this.app;
        const q = app.queueRow();
        const parts = [];
        parts.push('<div class="msd-panel">');
        parts.push('<p class="msd-hint">去重与截断逐条报：合并进哪一条、截掉几条都要看得见。'
            + '源留下第一条、其余塞进备选且一个字不说；到上限就 break，后面的也一条不报。</p>');
        if (!q) {
            parts.push('<div class="msd-empty">队列读数拿不到。</div>');
        } else {
            parts.push('<div class="msd-qgrid">');
            parts.push('<div class="msd-qcell"><span class="msd-qk">给进来</span><span class="msd-qv">'
                + this._count(q.given) + '</span></div>');
            parts.push('<div class="msd-qcell"><span class="msd-qk">留下来</span><span class="msd-qv">'
                + this._count(q.kept) + '</span></div>');
            parts.push('<div class="msd-qcell msd-state-warn"><span class="msd-qk">合并掉的</span><span class="msd-qv">'
                + this._count(q.merged) + '</span></div>');
            parts.push('<div class="msd-qcell msd-state-err"><span class="msd-qk">超上限截掉</span><span class="msd-qv">'
                + this._count(q.capped) + '</span></div>');
            parts.push('<div class="msd-qcell msd-state-err"><span class="msd-qk">没编号丢掉</span><span class="msd-qv">'
                + this._count(q.droppedNoId) + '</span></div>');
            parts.push('<div class="msd-qcell msd-state-err"><span class="msd-qk">没名字丢掉</span><span class="msd-qv">'
                + this._count(q.droppedNoName) + '</span></div>');
            parts.push('</div>');
            parts.push('<div class="msd-qline">上限 ' + this._count(q.limit)
                + ' · 这次' + (q.over ? '<b class="msd-state-err">超了</b>' : '没超') + '</div>');
            parts.push('<div class="msd-qline">游标：' + (q.cursorOk
                ? ('第 ' + q.cursorIndex + ' / ' + q.cursorSize + ' 首')
                : ('<b class="msd-state-err">' + this._esc(q.cursorWhy) + '</b>（给的是 '
                    + this._esc(String(q.cursorGiven)) + '，一共 ' + q.cursorSize + ' 首）')) + '</div>');
            parts.push('<div class="msd-qline">这一次该从哪条来源试：<b>' + this._esc(q.sourcePick) + '</b>'
                + ' · 上一次那条还在不在：<b>' + this._esc(q.order) + '</b></div>');
        }
        parts.push('<div class="msd-modes">');
        for (const m of app.modeRows()) {
            parts.push('<button type="button" class="msd-mode' + (m.on ? ' is-on' : '') + '" data-mode="'
                + this._esc(m.key) + '">' + this._esc(m.label) + '</button>');
        }
        parts.push('<button type="button" data-act="step">下一首</button>');
        parts.push('</div>');
        parts.push('</div>');
        return parts.join('');
    }

    /* ---------- 面板 ④：来源 ---------- */
    _sourcePanel() {
        const app = this.app;
        const rows = app.sourceRows();
        const parts = [];
        parts.push('<div class="msd-panel">');
        parts.push('<p class="msd-hint">来源是**你自己填的清单**：本件不发请求、不读账号、不碰 cookie。'
            + '它只把「哪条现在还能试、哪条正在冷静」记下来 —— '
            + '源把偏好那条永远排第一，哪怕它正在冷静（用户点下去还是它，失败依旧）。</p>');
        if (!rows.length) {
            parts.push('<div class="msd-empty">一条来源都没填。本件不自己找来源，'
                + '要哪几家写在这里就行（填完只用于「该先试哪条」这一件事）。</div>');
            parts.push('<textarea class="msd-src-in" rows="4" data-k="sources" '
                + 'placeholder="一行一条。形如：名字 | 地址 | 偏好（可选）"></textarea>');
            parts.push('<button type="button" data-act="sources">收下这份来源清单</button>');
        } else {
            parts.push('<div class="msd-list">');
            for (const r of rows) {
                parts.push('<div class="msd-src">');
                parts.push('<div class="msd-src-main">');
                parts.push('<div class="msd-src-top"><span class="msd-src-k">' + this._esc(r.key) + '</span>'
                    + (r.pending ? '<span class="msd-src-flag">你偏好这条</span>' : '')
                    + '<span class="msd-state-' + this._esc(STATE_TONE[r.state] || 'off') + '">'
                    + this._esc(r.stateText) + '</span></div>');
                parts.push('<div class="msd-src-sub msd-mono">' + this._esc(r.url || '（没填地址）') + '</div>');
                parts.push('<div class="msd-src-sub">失败 ' + r.fails + ' 次 · 成功 ' + r.oks + ' 次'
                    + (r.leftText ? (' · ' + this._esc(r.leftText)) : '')
                    + (r.pending && r.state === MUS_STATES[1]
                        ? ' · <b class="msd-state-err">你偏好这条，可它正在冷静</b>' : '') + '</div>');
                parts.push('</div>');
                parts.push('<div class="msd-src-btns">');
                parts.push('<button type="button" data-src="' + this._esc(r.key) + '" data-ok="1">记一次成功</button>');
                parts.push('<button type="button" data-src="' + this._esc(r.key) + '" data-ok="0">记一次失败</button>');
                parts.push('</div>');
                parts.push('</div>');
            }
            parts.push('</div>');
            parts.push('<textarea class="msd-src-in" rows="4" data-k="sources" '
                + 'placeholder="改名 / 换址：一行一条，形如 名字 | 地址 | 偏好（可选）"></textarea>');
            parts.push('<button type="button" data-act="sources">整份换掉</button>');
        }
        parts.push('<p class="msd-hint">填法：一行一条，用竖线隔开；写「偏好」两字表示这条是你首选。'
            + '地址超 120 字会被截，名字超 24 字会被截 —— 截了会在台账里留痕。</p>');
        parts.push('</div>');
        return parts.join('');
    }

    /* ---------- 面板 ⑤：收拾 ---------- */
    _formPanel() {
        const app = this.app;
        const draft = app.draftOf();
        const parts = [];
        parts.push('<div class="msd-panel">');
        parts.push('<p class="msd-hint">本件不替你发请求 —— 数据得由你从任何对话端拿回来。'
            + '贴进来就行：曲目表原样给（重复的别删，去重我来做），时长给秒数，歌词整段贴。</p>');
        parts.push('<div class="msd-form">');
        parts.push('<label>贴对话端给的回信</label>');
        parts.push('<textarea data-k="reply" rows="7" placeholder="'
            + '只回一个 JSON 对象：songs 是曲目表，lrc 可省。括号要配平。"></textarea>');
        parts.push('<button type="button" data-act="ingest">收拾这一份</button>');
        parts.push('<button type="button" data-act="request">产一段要求文本</button>');
        parts.push('<button type="button" data-act="clear-songs">清空曲库（歌词与台账不动）</button>');
        parts.push('</div>');
        if (draft) {
            parts.push('<p class="msd-hint">下面这段可以直接复制去问：</p>');
            parts.push('<textarea class="msd-draft" rows="12" readonly>' + this._esc(draft) + '</textarea>');
        }
        parts.push('</div>');
        return parts.join('');
    }

    /* ---------- 面板 ⑥：策略与台账 ---------- */
    _policyPanel() {
        const app = this.app;
        const p = app.policyRow();
        const rows = app.receiptRows();
        const parts = [];
        parts.push('<div class="msd-panel">');
        parts.push('<p class="msd-hint">台账把每次动作的账都记下来：给进来几条、留下几条、'
            + '合并几条、截掉几条、当时认不出的那串字是什么。</p>');
        parts.push('<div class="msd-rows">');
        parts.push('<label>队列上限（1 ~ ' + p.maxUnits + '）</label>');
        parts.push('<input type="number" data-k="queue" min="1" max="' + p.maxUnits
            + '" value="' + p.queueKeep + '">');
        parts.push('<label>台账最多留几条</label>');
        parts.push('<input type="number" data-k="keep" min="1" max="' + p.maxUnits
            + '" value="' + p.ledgerKeep + '">');
        parts.push('<button type="button" data-act="clear-ledger">清空台账</button>');
        parts.push('</div>');
        parts.push('<div class="msd-qline">曲目 ' + p.songCount + ' 首 · 回执 ' + p.receiptCount
            + ' / ' + p.ledgerKeep + ' 条' + (p.receiptFull ? '（满了，再记会顶掉最旧那条）' : '') + '</div>');
        if (!rows.length) {
            parts.push('<div class="msd-empty">还没动过 —— 收拾一份回信、换一次模式、跳一次曲，这里都会留一条。</div>');
        } else {
            parts.push('<div class="msd-receipts">');
            for (const r of rows) {
                parts.push('<div class="msd-receipt">');
                parts.push('<div class="msd-rc-top"><span class="msd-rc-k">' + this._esc(r.label) + '</span>'
                    + (r.line ? ('<span class="msd-rc-line">' + this._esc(r.line) + '</span>') : '')
                    + '<span class="msd-rc-why msd-mono">' + this._esc(r.why) + '</span></div>');
                parts.push('<div class="msd-rc-sub">给 ' + r.given + ' · 留 ' + r.kept
                    + ' · 合并 ' + r.merged + ' · 截 ' + r.capped + ' · 丢 ' + r.dropped
                    + (r.saw ? (' · 认不出的那串：' + this._esc(r.saw)) : '') + '</div>');
                parts.push('</div>');
            }
            parts.push('</div>');
        }
        parts.push('</div>');
        return parts.join('');
    }

    /* ---------- 交互 ---------- */
    _flashOf(r, okText, failText) {
        if (r.ok === true) return okText;
        if (r.reason === 'empty_input') return '还没贴东西';
        return failText + '（' + r.reason + '）';
    }
    /** 来源清单文本 → 对象表（一行一条，竖线隔开；写「偏好」两字表示首选）。 */
    _parseSources(text) {
        const out = [];
        const rows = String(text == null ? '' : text).split(NL);
        for (let i = 0; i < rows.length; i += 1) {
            const row = rows[i].trim();
            if (!row) continue;
            const bits = row.split(String.fromCharCode(124));
            const key = bits.length > 0 ? bits[0].trim() : '';
            const url = bits.length > 1 ? bits[1].trim() : '';
            const tail = bits.length > 2 ? bits[2].trim() : '';
            if (!key && !url) continue;
            out.push({ key: key, url: url, preferred: (tail.indexOf('偏好') >= 0) });
        }
        return out;
    }
    _act(act) {
        const app = this.app;
        if (act === 'tab-form') { app.setTab('form'); this._flash = ''; this.refresh(); return; }
        if (act === 'close') { app.closeSong(); this._flash = ''; this.refresh(); return; }
        if (act === 'step') {
            const r = app.stepIndex(0.5);
            this._flash = r.ok
                ? ('换到第 ' + r.index + ' 首' + (r.wrapped ? '（绕回开头了）' : '') + '，因为 ' + r.why)
                : ('换不了（' + r.reason + '）');
            this.refresh();
            return;
        }
        if (act === 'request') {
            const r = app.requestText('');
            this._flash = '要求文本已放在下面，可以直接复制';
            this.refresh();
            return;
        }
        if (act === 'clear-songs') {
            const r = app.clearSongs();
            this._flash = ('清掉 ' + r.cleared + ' 首（歌词与台账没动）');
            this.refresh();
            return;
        }
        if (act === 'clear-ledger') {
            app.clearLedger();
            this._flash = '台账清空了';
            this.refresh();
            return;
        }
        if (act === 'sources') {
            const box = this._q('[data-k="sources"]');
            const r = app.setSources(this._parseSources(box ? box.value : ''));
            this._flash = r.ok
                ? ('收下 ' + r.count + ' 条来源 · 这一次该试：' + r.pick)
                : ('没收下（' + r.reason + '）');
            this.refresh();
            return;
        }
        if (act === 'ingest') {
            const box = this._q('[data-k="reply"]');
            const r = app.ingestReply(box ? box.value : '');
            if (r.ok !== true) {
                this._flash = this._flashOf(r, '', '收拾不了');
                this.refresh();
                return;
            }
            const bits = ['留下 ' + r.kept + ' 首'];
            if (r.merged) bits.push('合并掉 ' + r.merged + ' 首');
            if (r.capped) bits.push('超上限截掉 ' + r.capped + ' 首');
            if (r.droppedNoId) bits.push('没编号丢掉 ' + r.droppedNoId);
            if (r.droppedNoName) bits.push('没名字丢掉 ' + r.droppedNoName);
            if (r.lyrics) {
                bits.push('歌词留 ' + r.lyrics.kept + ' 行');
                if (r.lyrics.noTime) bits.push('坏行 ' + r.lyrics.noTime + ' 行没时间标签');
                if (r.lyrics.noText) bits.push('坏处 ' + r.lyrics.noText + ' 处标签后没字');
            }
            this._flash = bits.join(' · ');
            this.refresh();
            return;
        }
    }
    _bindEvents() {
        const root = this._root;
        if (!root) return;
        /* 点击分派：各面各走一遍「从命中元素**向上找最近的带标记祖先**」。
         *  ★ 卡片判定不许读直点元素：点卡片里的正文文字时 target 是子元素，
         *    判定落空 ⇒ 用户点正文没反应、必顶点卡片留白才打开。
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
            const modeEl = climb(t, (n) => n.getAttribute('data-mode'));
            if (modeEl) {
                const r = this.app.setMode(modeEl.getAttribute('data-mode'));
                this._flash = r.ok ? ('换成' + r.mode) : ('不认这个模式（' + r.reason + '），仍按 ' + r.kept);
                this.refresh();
                return;
            }
            const srcEl = climb(t, (n) => n.getAttribute('data-src'));
            if (srcEl) {
                const r = this.app.recordSource(srcEl.getAttribute('data-src'), srcEl.getAttribute('data-ok') === '1');
                this._flash = r.ok
                    ? ('记下了：这条现在「' + r.state + '」' + (r.left > 0 ? ('，还要等 ' + Math.ceil(r.left / 1000) + ' 秒') : ''))
                    : ('没有这条来源（' + r.saw + '）');
                this.refresh();
                return;
            }
            const actEl = climb(t, (n) => n.getAttribute('data-act'));
            if (actEl) { this._act(actEl.getAttribute('data-act')); return; }
            const cardEl = climb(t, (n) => n.getAttribute('data-open') !== null);
            if (cardEl) {
                this.app.openSong(Number(cardEl.getAttribute('data-open')));
                this._flash = '';
                this.refresh();
            }
        });
        root.addEventListener('change', (e) => {
            const t = e.target;
            if (!t || !t.getAttribute) return;
            const k = t.getAttribute('data-k');
            if (k === 'queue') {
                const r = this.app.setQueueKeep(t.value);
                this._flash = (String(r.saw) === String(r.took))
                    ? ('队列上限 ' + r.took + ' 首')
                    : ('「' + r.saw + '」不收，仍按 ' + r.took + ' 首');
                this.refresh();
                return;
            }
            if (k === 'keep') {
                const r = this.app.setLedgerKeep(t.value);
                this._flash = (String(r.saw) === String(r.took))
                    ? ('台账最多留 ' + r.took + ' 条')
                    : ('「' + r.saw + '」不收，仍按 ' + r.took + ' 条');
                this.refresh();
            }
        });
    }
}