/* ========================================================
 * recall-view.js — [v3.38.0] 记忆宫殿 · 召回治理台 视图层
 * 照抄 soundkit / pixiv / lofter 规格：`_buildHTML()` 拼串 → `innerHTML`
 * → `_bindEvents()`。只在 render / refresh 里读 App 现算值，**不缓存投影**。
 *
 * 四条视图纪律：
 *  ① **六态必须分开画**：可用 / 没配 / 已关 / 索引陈旧 / 降级中 / 上次失败
 *     六种处境的文案与配色各不相同。源把这六种塔成「不可用」一种观感 ——
 *     于是用户永远分不出该去配置、该去开开关、还是该去重建索引。
 *  ② **真源表不许手写键**：四路名、状态名、房间名、跳过因、上限
 *     全部来自 `app.catalogs()`（数据层真源），视图不写第二份。
 *  ③ **每路都要报贡献**：融合面板逐路列出「进来几条 / 并了几条 / 跳过了」。
 *     源融合后只给结果列表，没有任何一处能回答「这条路到底出没出力」。
 *  ④ **空与坏不同形**：台账里「一条都没召回到」与「四路全坏」是两种
 *     不同颜色与不同文案 —— 前者不用管，后者得去修。
 * ======================================================== */
'use strict';
import { RECALL_FACES, RECALL_CHANNELS, RECALL_CHANNEL_META, RECALL_ROOM_WEIGHTS }
    from './recall-data.js';
/** HTML 转义要 replace 掉的「双引号」—— 用**字符数组 + split/join**，不写成正则字面量。
 *  ★ 本仓判据共用的剥注释器（stripComments）是字符状态机、**不解析正则字面量**：
 *    正则字面量里一旦出现半个引号，剥器就把它当成字符串的起头，从那一行往后块注释再也剥不掉。
 *    v3.31.0 在 date-view、v3.35.0 在 pixiv、v3.37.0 在 soundkit 各踩过一次 —— 本件照抄安全写法。 */
const DQUOTE = String.fromCharCode(34);
/** `&` 的**拼装形**（不写实体字面量：落盘传输链会把实体字面量解码成真字符，
 *  于是 `_esc` 静默失效却不报错 —— v3.35.0 在数据层当场踩过）。 */
const AMP = String.fromCharCode(38);
/** 三态人话（「还没有记录」与「读不出来」**不许同形**）。
 *  ★ 键面**取数据层真源**（计算键），不在本文件手写一套标识符形 ——
 *    本仓 J7 形态：两份靠碰巧拼写一致对齐，任何一边改名都会让本表静默落兜底。 */
const FACE_META = {
    [RECALL_FACES.ok]: { icon: '\u{1f5c2}\ufe0f', label: '召回台已配置', tone: 'ok' },
    [RECALL_FACES.empty]: { icon: '\u{1f4c4}', label: '还没有任何配置与记录', tone: 'warn' },
    [RECALL_FACES.storage_absent]: { icon: '\u26a0\ufe0f', label: '存储不可用（读数拿不到）', tone: 'err' },
};
/** 严重度 → 色相（severity 由数据层给，视图只上色，不自己判态）。 */
const TONE_BY_SEVERITY = { ok: 'ok', mute: 'mute', warn: 'warn' };
const TABS = [
    { key: 'channels', label: '四路' },
    { key: 'fusion', label: '融合' },
    { key: 'ledger', label: '台账' },
    { key: 'policy', label: '策略' },
];
/** 房间人话：键面**取数据层真源**（计算键，与上面 FACE_META 同规格）——
 *  手写一套标识符形会与本仓已立判据（J7：归因文案表不得手写键）相撞，
 *  且真源一旦改名，本表会静默落兜底、多种处境显示成同一句话。 */
const ROOM_LABEL = {
    [RECALL_ROOM_WEIGHTS.living_room]: '客厅',
    [RECALL_ROOM_WEIGHTS.bedroom]: '卧室',
    [RECALL_ROOM_WEIGHTS.study]: '书房',
    [RECALL_ROOM_WEIGHTS.balcony]: '阳台',
    [RECALL_ROOM_WEIGHTS.kitchen]: '厨房'
};

export class RecallView {
    constructor(app, shell, storage) {
        this.app = app;
        this.shell = shell;
        this.storage = storage;
        this._root = null;
        this._flash = '';
        this._draft = { snapshot: '', extra: '' };
    }
    render() {
        const container = this.shell && this.shell.getContentContainer ? this.shell.getContentContainer() : null;
        if (!container) return;
        container.innerHTML = '';
        this._root = document.createElement('div');
        this._root.className = 'rcl-root';
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
        parts.push('<div class="rcl-header"><h2>\u{1f3db}\ufe0f 召回治理台</h2>'
            + '<span class="rcl-header-sub">管理取回的路，不自己取回</span></div>');
        parts.push('<div class="rcl-face rcl-face-' + meta.tone + '">');
        parts.push('<span class="rcl-face-icon">' + meta.icon + '</span>');
        parts.push('<span class="rcl-face-label">' + this._esc(meta.label) + '</span>');
        parts.push('<span class="rcl-face-sub">' + this._esc(app.summaryLine()) + '</span>');
        parts.push('</div>');
        if (this._flash) parts.push('<div class="rcl-flash">' + this._esc(this._flash) + '</div>');
        const cur = app.tab();
        parts.push('<div class="rcl-tabs">');
        for (const t of TABS) {
            parts.push('<button type="button" class="rcl-tab' + (cur === t.key ? ' is-on' : '')
                + '" data-tab="' + t.key + '">' + this._esc(t.label) + '</button>');
        }
        parts.push('</div>');
        if (cur === 'channels') parts.push(this._channelsPanel());
        else if (cur === 'fusion') parts.push(this._fusionPanel());
        else if (cur === 'ledger') parts.push(this._ledgerPanel());
        else parts.push(this._policyPanel());
        return parts.join('');
    }
    /* ---------- 面板 ①：四路 ---------- */
    _channelsPanel() {
        const app = this.app;
        const parts = [];
        parts.push('<div class="rcl-panel">');
        parts.push('<p class="rcl-hint">六态各自画：没配（该去配）、已关（该去开）、'
            + '陈旧（该重建索引）、降级（还能出但慢）、上次失败（本轮不可信）、可用。</p>');
        /* 徽章色相按**六态键**取（不是按三档 severity）—— 否则「没配」与「已关」
         * 会拿到同一个色相，用户再次看不出「该去配」与「该去开」的区别。
         * 键面仍来自数据层（channelState 的产物 + catalogs().stateKeys 白名单），
         * 视图不自己判态、也不手写第二份键面。 */
        const stateKeys = app.catalogs().stateKeys || [];
        for (const row of app.channelRows()) {
            const fam = TONE_BY_SEVERITY[row.severity] || 'warn';
            const st = (stateKeys.indexOf(row.state) >= 0) ? row.state : 'absent';
            parts.push('<div class="rcl-ch rcl-ch-' + fam + '">');
            parts.push('<div class="rcl-ch-top">');
            parts.push('<span class="rcl-ch-name">' + this._esc(row.label) + '</span>');
            parts.push('<span class="rcl-ch-state rcl-st-' + st + '">' + this._esc(row.stateLabel) + '</span>');
            parts.push('<span class="rcl-ch-count">候选 ' + row.candidates + ' 条</span>');
            parts.push('</div>');
            parts.push('<div class="rcl-ch-why">' + this._esc(row.why) + '</div>');
            if (row.lastError) {
                parts.push('<div class="rcl-ch-err">上次的错：' + this._esc(row.lastError) + '</div>');
            }
            parts.push('<div class="rcl-ch-btns">');
            parts.push('<button type="button" data-act="cfg-on" data-ch="' + row.channel + '">配置</button>');
            parts.push('<button type="button" data-act="cfg-off" data-ch="' + row.channel + '">关掉</button>');
            parts.push('<button type="button" data-act="cfg-unset" data-ch="' + row.channel + '">取消配置</button>');
            parts.push('<button type="button" data-act="mark-stale" data-ch="' + row.channel + '">标为陈旧</button>');
            parts.push('<button type="button" data-act="mark-degraded" data-ch="' + row.channel + '">标为降级</button>');
            parts.push('<button type="button" data-act="mark-failed" data-ch="' + row.channel + '">记一次错</button>');
            parts.push('<button type="button" data-act="mark-ok" data-ch="' + row.channel + '">清掉标记</button>');
            parts.push('</div>');
            parts.push('</div>');
        }
        parts.push('</div>');
        return parts.join('');
    }
    /* ---------- 面板 ②：融合 ---------- */
    _fusionPanel() {
        const app = this.app;
        const catalogs = app.catalogs();
        const parts = [];
        parts.push('<div class="rcl-panel">');
        parts.push('<p class="rcl-hint">每路自己填候选（一行一个 id），融合时逐路报「进来 / 并入 / 跳过」——'
            + '空候选池与这一路没配**不同形**。</p>');
        parts.push('<div class="rcl-snaps">');
        for (const ch of catalogs.channels) {
            const meta = catalogs.channelMeta[ch] || {};
            const cur = app.snapshotOf(ch);
            parts.push('<div class="rcl-snap">');
            parts.push('<label>' + this._esc(meta.label) + '</label>');
            parts.push('<textarea data-k="snap" data-ch="' + ch + '" rows="3"'
                + ' placeholder="一行一个 id">' + this._esc(cur.join('\n')) + '</textarea>');
            parts.push('<button type="button" data-act="save-snap" data-ch="' + ch + '">存下这一路</button>');
            parts.push('</div>');
        }
        parts.push('</div>');
        parts.push('<div class="rcl-fuse-btns">');
        parts.push('<button type="button" data-act="run-fusion">跑一次融合</button>');
        parts.push('<button type="button" data-act="run-decide">出注入裁决</button>');
        parts.push('<button type="button" data-act="clear-snaps">清空全部候选</button>');
        parts.push('</div>');
        const fused = app.fusedOf();
        if (fused) {
            parts.push('<div class="rcl-fuse">');
            parts.push('<div class="rcl-fuse-head">合出 ' + fused.total + ' 条候选，取前 '
                + fused.hits.length + ' 条，落选 ' + fused.dropped + ' 条</div>');
            parts.push('<div class="rcl-fuse-per">');
            for (const ch of catalogs.channels) {
                const p = fused.per[ch] || {};
                const meta = catalogs.channelMeta[ch] || {};
                const skipped = p.skipped === true;
                parts.push('<span class="rcl-per' + (skipped ? ' is-skip' : '') + '">'
                    + this._esc(meta.label) + '：进来 ' + (p.in || 0)
                    + ' / 并入 ' + (p.merged || 0)
                    + (p.dupInChannel ? ' / 重复 ' + p.dupInChannel : '')
                    + (skipped ? '（跳过）' : '') + '</span>');
            }
            parts.push('</div>');
            parts.push('<div class="rcl-fuse-hits">');
            for (const h of fused.hits) {
                parts.push('<div class="rcl-hit"><span class="rcl-hit-rank">' + h.rank + '</span>'
                    + '<span class="rcl-hit-id">' + this._esc(h.id) + '</span>'
                    + '<span class="rcl-hit-score">' + h.score + '</span></div>');
            }
            if (!fused.hits.length) parts.push('<div class="rcl-hit-none">合出来是空的</div>');
            parts.push('</div>');
            parts.push('</div>');
        }
        const v = app.verdictOf();
        if (v) {
            const tone = v.inject ? 'ok' : (v.reason === 'all_broken' ? 'err' : 'warn');
            parts.push('<div class="rcl-verdict rcl-vd-' + tone + '">');
            parts.push('<span class="rcl-vd-main">' + (v.inject ? '\u2705 可以注入 ' + v.count + ' 条' : '\u23f8\ufe0f 这一次不注入') + '</span>');
            parts.push('<span class="rcl-vd-why">' + this._esc(app.skipLabelOf(v.reason)) + '</span>');
            parts.push('</div>');
        }
        parts.push('</div>');
        return parts.join('');
    }
    /* ---------- 面板 ③：台账 ---------- */
    _ledgerPanel() {
        const app = this.app;
        const rows = app.receiptRows();
        const parts = [];
        parts.push('<div class="rcl-panel">');
        parts.push('<p class="rcl-hint">每回一次召回留一张回执：「真的没有」（不用管）与「四路全坏」'
            + '（得去修）是两种颜色、两种文案。</p>');
        parts.push('<div class="rcl-led-btns">');
        parts.push('<button type="button" data-act="add-receipt">按当前状态记一张</button>');
        parts.push('<button type="button" data-act="clear-receipts">清空台账</button>');
        parts.push('</div>');
        parts.push('<div class="rcl-led">');
        for (let i = 0; i < rows.length; i += 1) {
            const r = rows[i];
            const tone = r.inject ? 'ok' : (r.reason === 'all_broken' ? 'err' : 'warn');
            const flags = [];
            if (r.degraded && r.degraded.length) flags.push('降级 ' + r.degraded.length + ' 路');
            if (r.failed && r.failed.length) flags.push('出错 ' + r.failed.length + ' 路');
            if (r.timedOut) flags.push('超时');
            parts.push('<div class="rcl-rec rcl-rc-' + tone + '">');
            parts.push('<div class="rcl-rec-top">');
            parts.push('<span class="rcl-rec-at">' + this._esc(r.at || '（未记时刻）') + '</span>');
            parts.push('<span class="rcl-rec-entry">' + this._esc(r.entry || '（未记入口）') + '</span>');
            parts.push('<span class="rcl-rec-face">' + this._esc(r.face) + '</span>');
            parts.push('</div>');
            parts.push('<div class="rcl-rec-body">召回到 ' + r.hits + ' 条'
                + (r.contributed === null ? '' : '，出力 ' + r.contributed + ' 路')
                + '；' + (r.inject ? '已注入' : '没注入（' + this._esc(r.reasonLabel) + '）')
                + (r.ms === null ? '' : '；耗时 ' + r.ms + 'ms') + '</div>');
            if (flags.length) parts.push('<div class="rcl-rec-flags">' + this._esc(flags.join(' · ')) + '</div>');
            parts.push('<button type="button" data-act="open-rec" data-i="' + i + '">看详情</button>');
            parts.push('</div>');
        }
        if (!rows.length) parts.push('<div class="rcl-led-none">还没有任何回执</div>');
        parts.push('</div>');
    }
    /* ---------- 面板 ④：策略 ---------- */
    _policyPanel() {
        const app = this.app;
        const p = app.policyRow();
        const catalogs = app.catalogs();
        const parts = [];
        parts.push('<div class="rcl-panel">');
        parts.push('<div class="rcl-row"><span class="rcl-row-k">当前房间</span>');
        parts.push('<span class="rcl-row-v">' + this._esc(ROOM_LABEL[p.room] || p.room) + '</span>');
        if (!p.roomKnown) {
            parts.push('<span class="rcl-row-warn">存放的房间名「' + this._esc(p.roomSaw) + '」没认出来，按 '
                + this._esc(ROOM_LABEL[p.room] || p.room) + ' 的配比在算</span>');
        }
        parts.push('</div>');
        parts.push('<div class="rcl-row"><span class="rcl-row-k">三轴配比</span>');
        parts.push('<span class="rcl-row-v">相似 ' + p.weights.similarity
            + ' · 新近 ' + p.weights.recency + ' · 重要 ' + p.weights.importance + '</span></div>');
        parts.push('<div class="rcl-rooms">');
        for (const rk of Object.keys(catalogs.rooms)) {
            parts.push('<button type="button" data-act="set-room" data-room="' + rk + '"'
                + (rk === p.room ? ' class="is-on"' : '') + '>' + this._esc(ROOM_LABEL[rk] || rk) + '</button>');
        }
        parts.push('</div>');
        parts.push('<div class="rcl-row"><span class="rcl-row-k">注入</span>');
        parts.push('<label><input type="checkbox" data-k="inject"' + (p.injectEnabled ? ' checked' : '') + ' /> 允许注入</label>');
        parts.push('</div>');
        parts.push('<div class="rcl-row"><span class="rcl-row-k">最低分</span>');
        parts.push('<input type="number" step="0.01" min="0" max="1" data-k="floor" value="' + p.floor + '" />');
        parts.push('<span class="rcl-row-sub">低于这个分的不注入</span></div>');
        parts.push('<div class="rcl-row"><span class="rcl-row-k">取前几条</span>');
        parts.push('<input type="number" step="1" min="1" max="' + catalogs.limits.maxCandidates
            + '" data-k="topn" value="' + p.topN + '" />');
        parts.push('<span class="rcl-row-sub">上限 ' + catalogs.limits.maxCandidates + '</span></div>');
        parts.push('<div class="rcl-row"><span class="rcl-row-k">高水位线</span>');
        parts.push('<span class="rcl-row-v">' + (p.watermark === null ? '还没推过' : p.watermark) + '</span>');
        parts.push('<button type="button" data-act="advance-ok">推一批（成功）</button>');
        parts.push('<button type="button" data-act="advance-fail">推一批（有失败）</button>');
        parts.push('</div>');
        parts.push('<div class="rcl-row"><span class="rcl-row-k">BM25 档位</span>');
        parts.push('<input type="text" data-k="bm25" value="' + this._esc(app.bm25RawOf()) + '" placeholder="naive / indexed / dual" />');
        parts.push('<span class="rcl-row-sub">当前按 ' + p.bm25 + ' 在算</span>');
        if (!p.bm25Recognized) {
            parts.push('<span class="rcl-row-warn">存的值「' + this._esc(p.bm25Saw) + '」不是这三档之一，已落 '
                + this._esc(catalogs.bm25Fallback) + '</span>');
        }
        parts.push('</div>');
        parts.push('<div class="rcl-cats"><span class="rcl-cats-k">融合参数</span>'
            + '<span class="rcl-cats-v">RRF k=' + catalogs.limits.rrfK
            + ' · 默认取前 ' + catalogs.limits.defaultTopN
            + ' · 最低分兜底 ' + catalogs.limits.minScore + '</span></div>');
        parts.push('</div>');
        return parts.join('');
    }
    /* ---------- 事件 ---------- */
    _act(act, el) {
        const app = this.app;
        const ch = el ? (el.getAttribute('data-ch') || '') : '';
        if (act === 'cfg-on') {
            const r = app.configure(ch, { enabled: true });
            this._flash = r.ok ? (app.channelLabelOf(ch) + ' 已配置并开着') : '认不出这一路：' + r.reason;
        } else if (act === 'cfg-off') {
            const r = app.configure(ch, { enabled: false });
            this._flash = r.ok ? (app.channelLabelOf(ch) + ' 关掉了（不是没配）') : '认不出这一路：' + r.reason;
        } else if (act === 'cfg-unset') {
            const r = app.unconfigure(ch);
            this._flash = r.ok ? (app.channelLabelOf(ch) + ' 回到没配（候选也清空）') : '认不出这一路：' + r.reason;
        } else if (act === 'mark-stale') {
            app.configure(ch, { modelChanged: true });
            this._flash = app.channelLabelOf(ch) + ' 标为索引陈旧（向量模型换了）';
        } else if (act === 'mark-degraded') {
            app.configure(ch, { degraded: true });
            this._flash = app.channelLabelOf(ch) + ' 标为降级中（还能出，但慢）';
        } else if (act === 'mark-failed') {
            app.configure(ch, { lastError: '上一次这一路抛了错' });
            this._flash = app.channelLabelOf(ch) + ' 记了一次错（本轮结果不可信）';
        } else if (act === 'mark-ok') {
            app.configure(ch, { modelChanged: false, degraded: false, lastError: '' });
            this._flash = app.channelLabelOf(ch) + ' 的标记清掉了';
        } else if (act === 'save-snap') {
            const ta = this._root ? this._root.querySelector('textarea[data-ch="' + ch + '"]') : null;
            const text = ta ? ta.value : '';
            const ids = text.split(String.fromCharCode(10)).map((x) => x.trim()).filter((x) => !!x);
            const r = app.setSnapshot(ch, ids);
            this._flash = r.ok ? (app.channelLabelOf(ch) + ' 存下 ' + r.kept + ' 条候选（填了 ' + r.saw + ' 条）')
                : '存不下：' + r.reason;
        } else if (act === 'run-fusion') {
            const f = app.runFusion({});
            const v = app.decide(f, {});
            this._flash = '融合：合出 ' + f.total + ' 条，出力路数 ' + f.contributedChannels
                + '，跳过 ' + f.skippedChannels + ' 路；裁决：' + app.skipLabelOf(v.reason);
        } else if (act === 'run-decide') {
            const v = app.decide(null, {});
            this._flash = v.inject ? ('可以注入 ' + v.count + ' 条') : ('不注入：' + app.skipLabelOf(v.reason));
        } else if (act === 'clear-snaps') {
            app.clearSnapshots();
            this._flash = '全部候选清空了';
        } else if (act === 'add-receipt') {
            const v = app.decide(null, {});
            const card = app.recordReceipt({
                at: new Date().toISOString().slice(0, 19).replace('T', ' '),
                entry: '手动',
                verdict: v,
                ms: null
            });
            this._flash = '记了一张：召回到 ' + card.hits + ' 条，' + (card.inject ? '注入' : '不注入（' + app.skipLabelOf(card.reason) + '）');
        } else if (act === 'clear-receipts') {
            app.clearReceipts();
            this._flash = '台账清空了';
        } else if (act === 'open-rec') {
            const i = el ? Number(el.getAttribute('data-i')) : -1;
            const r = app.openReceipt(i);
            if (r.ok) {
                const one = r.receipt;
                this._flash = '这张回执：' + one.hits + ' 条 / ' + one.reasonLabel
                    + (one.degraded.length ? ' / 降级 ' + one.degraded.join('、') : '')
                    + (one.failed.length ? ' / 出错 ' + one.failed.join('、') : '');
            } else {
                this._flash = '这张回执找不到了';
            }
        } else if (act === 'set-room') {
            const room = el ? (el.getAttribute('data-room') || '') : '';
            const r = app.setRoom(room);
            this._flash = r.ok ? ('房间换成 ' + room) : ('认不出这个房间：' + r.sawRoom);
        } else if (act === 'advance-ok') {
            const cur = app.watermarkOf();
            const from = (cur === null ? 1 : cur + 1);
            const r = app.advanceLine({ from: from, to: from + 9 });
            this._flash = r.advanced ? ('水位线推到 ' + r.value) : ('没推进：' + r.reason);
        } else if (act === 'advance-fail') {
            const cur = app.watermarkOf();
            const from = (cur === null ? 1 : cur + 1);
            const r = app.advanceLine({ from: from, to: from + 9, ok: false, failedCount: 2 });
            this._flash = r.advanced ? ('水位线推到 ' + r.value)
                : ('没推进（' + r.reason + '，' + (r.failedCount || 0) + ' 条失败，原文留着下次重试）');
        }
        this.refresh();
    }
    _bindEvents() {
        const root = this._root;
        if (!root) return;
        root.addEventListener('click', (e) => {
            const t = e.target;
            if (!t || !t.getAttribute) return;
            const tab = t.getAttribute('data-tab');
            if (tab) {
                this.app.setTab(tab);
                this._flash = '';
                this.refresh();
                return;
            }
            const act = t.getAttribute('data-act');
            if (!act) return;
            this._act(act, t);
        });
        root.addEventListener('change', (e) => {
            const t = e.target;
            if (!t || !t.getAttribute) return;
            const k = t.getAttribute('data-k');
            if (k === 'inject') {
                const r = this.app.setInjectEnabled(t.checked === true);
                this._flash = r.injectEnabled ? '允许注入' : '关了注入（用户明确关的，不是没召回到）';
                this.refresh();
            } else if (k === 'floor') {
                const r = this.app.setFloor(t.value);
                this._flash = r.ok ? ('最低分改成 ' + r.floor) : ('这个最低分不收：' + r.saw);
                this.refresh();
            } else if (k === 'topn') {
                const r = this.app.setTopN(t.value);
                this._flash = r.ok ? ('改取前 ' + r.topN + ' 条') : ('这个条数不收（最多 ' + r.max + '）');
                this.refresh();
            } else if (k === 'bm25') {
                const r = this.app.setBm25(t.value);
                this._flash = r.recognized ? ('BM25 档位按 ' + r.mode + ' 算')
                    : ('「' + r.sawRaw + '」不是这三档，已落 ' + r.mode);
                this.refresh();
            }
        });
    }
}
