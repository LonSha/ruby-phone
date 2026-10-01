/* ========================================================
 * kettle-view.js — [v3.40.0] 对话水壶 · 视图层
 * 照抄 sourcebook / recall / soundkit / pixiv / magazine 规格：_buildHTML() 拼串
 * → innerHTML → _bindEvents()。只在 render / refresh 里读 App 现算值，**不缓存投影**。
 *
 * 五条视图纪律：
 *  ① **取数四态分开画**：读得到 / 还没记过 / 写了但认不出来 / 取不出来 ——
 *     四种处境文案与色相各异。源把「取不出来」与「还没记过」都画成空列表，
 *     于是用户无从知道该去检查存储、还是该去补写。
 *  ② **轮次三档逐档列全**，且**数不出来单列一栏**（不塔进任一档）。
 *     源在数不出来时落「很久」、在一条都没有时落「短暂」，两处都反了。
 *  ③ **选项四态逐态列全**：源只有「能拆开」与「拆不开」。
 *  ④ **空与坏不同形**：计数在读数取不出来时画「—」而不是「0」。
 *  ⑤ **单字语气词是读数不是内容**：列表里只报「含几个」，不把它当正文重放。
 *
 * 本文件与数据层同守的纪律：不写正则字面量（本仓剥注释器是字符状态机，
 * 正则里的裸引号会让它卡住）；& 与双引号一律走**拼装形**（不写实体字面量：
 * 落盘传输链会把实体字面量解码成真字符，转义函数会静默失效而不报错）。
 * ======================================================== */
'use strict';
/* ★ 这里只取**键面**真源（人话表与四态取值）。三档 / 四态的**清单**不在这里：
 *   由 App 的 roundRows() / optionRows() 现算给出 —— 视图不持第二份清单，
 *   否则真源表增删一档，视图会静默少画一档而不报错（本仓 J7 形态）。 */
import { KETTLE_FACES, KETTLE_ROUND_UNKNOWN } from './kettle-data.js';

/** 转义要 replace 的三个字符 —— 用**拼装形**，不写实体字面量。 */
const DQUOTE = String.fromCharCode(34);
const SQ = String.fromCharCode(39);
const AMP = String.fromCharCode(38);
const NL = String.fromCharCode(10);

/** 四态人话与色相（**键面取数据层真源**，不写标识符形 —— 本仓 J7 形态）。
 *  ★ 源只有「有」与「空」两态，故这里比源多一态（写了但认不出来）。 */
const FACE_TONE = {};
FACE_TONE[KETTLE_FACES[0]] = 'ok';
FACE_TONE[KETTLE_FACES[1]] = 'warn';
FACE_TONE[KETTLE_FACES[2]] = 'err';
FACE_TONE[KETTLE_FACES[3]] = 'err';
const TABS = [
    { key: 'notes', label: '记录' },
    { key: 'rounds', label: '轮次三档' },
    { key: 'options', label: '选项四态' },
    { key: 'ledger', label: '台账' },
    { key: 'policy', label: '策略' }
];

/** 视图层：五页签（记录 / 轮次三档 / 选项四态 / 台账 / 策略）。 */
export class KettleView {
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
        this._root.className = 'ktl-root';
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
    /** 转义（& 与两个引号走拼装形 —— 见文件头纪律）。 */
    _esc(s) {
        return String(s == null ? '' : s)
            .split(AMP).join(AMP + 'amp;')
            .split('<').join(AMP + 'lt;')
            .split('>').join(AMP + 'gt;')
            .split(DQUOTE).join(AMP + 'quot;')
            .split(SQ).join(AMP + '#39;');
    }
    /** 计数位：null 画「—」（**不是 0**）—— 「这一档真的没有」与「读不出来」不同形。 */
    _count(v) {
        return (v === null || v === undefined) ? '\u2014' : String(v);
    }
    _buildHTML() {
        const app = this.app;
        const face = app.faceOf();
        const meta = { tone: FACE_TONE[face] || 'warn' };
        const parts = [];
        parts.push('<div class="ktl-header"><h2>\u{1f375} 对话水壶</h2>'
            + '<span class="ktl-header-sub">把模型已经说过的那些话收拾好——本件不替你发请求</span></div>');
        parts.push('<div class="ktl-face ktl-face-' + meta.tone + '">');
        parts.push('<span class="ktl-face-label">' + this._esc(app.faceTextOf(face)) + '</span>');
        parts.push('<span class="ktl-face-sub">' + this._esc(app.summaryLine()) + '</span>');
        parts.push('</div>');
        if (this._flash) parts.push('<div class="ktl-flash">' + this._esc(this._flash) + '</div>');
        const cur = app.tab();
        parts.push('<div class="ktl-tabs">');
        for (const t of TABS) {
            parts.push('<button type="button" class="ktl-tab' + (cur === t.key ? ' is-on' : '')
                + '" data-tab="' + t.key + '">' + this._esc(t.label) + '</button>');
        }
        parts.push('</div>');
        if (cur === 'rounds') parts.push(this._roundPanel());
        else if (cur === 'options') parts.push(this._optionPanel());
        else if (cur === 'ledger') parts.push(this._ledgerPanel());
        else if (cur === 'policy') parts.push(this._policyPanel());
        else parts.push(this._notePanel());
        return parts.join('');
    }
    /* ---------- 面板 ①：记录 ---------- */
    _notePanel() {
        const app = this.app;
        const rows = app.noteRows();
        const cur = app.currentKey();
        const parts = [];
        parts.push('<div class="ktl-panel">');
        parts.push('<p class="ktl-hint">轮次数不出来的那几段会写明「' + this._esc(KETTLE_ROUND_UNKNOWN)
            + '」——源在这种情况下按「聊了很久」算，而一条 assistant 都没有时按「短暂」算，两种都反了。'
            + ' 单字语气词只登个数，不当正文重放。</p>');
        parts.push('<div class="ktl-form">');
        parts.push('<label>对面的人（封记录必填）</label><input type="text" data-k="partner" placeholder="姓名或称呼" />');
        parts.push('<label>店名（可留空）</label><input type="text" data-k="shop" placeholder="在哪家店" />');
        parts.push('<label>发生了什么时候</label><input type="text" data-k="at" placeholder="如 2026-10-04 晚" />');
        parts.push('<button type="button" data-act="settle-demo">封一段示范对话</button>');
        parts.push('</div>');
        parts.push('<div class="ktl-list">');
        for (let i = 0; i < rows.length; i += 1) {
            const r = rows[i];
            const rb = r.bucketKnown ? ' is-known' : ' is-unk';
            parts.push('<div class="ktl-cap' + (cur === String(i) ? ' is-on' : '') + '" data-open="' + i + '">');
            parts.push('<div class="ktl-cap-top">');
            parts.push('<span class="ktl-cap-idx">#' + (i + 1) + '</span>');
            parts.push('<span class="ktl-cap-who">' + this._esc(r.partner || '（没写是谁）') + '</span>');
            parts.push('<span class="ktl-cap-shop">' + this._esc(r.shop || '（没写店名）') + '</span>');
            parts.push('</div>');
            parts.push('<div class="ktl-cap-line">' + this._esc(r.firstLine || '（这一条没有可留下的正文）') + '</div>');
            parts.push('<div class="ktl-cap-meta">');
            parts.push('<span class="ktl-b ktl-b-round' + rb + '">' + this._esc(r.bucketLabel) + '</span>');
            parts.push('<span class="ktl-b ktl-b-scene">' + this._esc(r.sceneLabel) + '</span>');
            parts.push('<span class="ktl-b ktl-b-solo' + (r.soloHits > 0 ? ' is-hit' : '') + '">'
                + (r.soloHits > 0 ? ('单字语气词 ' + r.soloHits + ' 处') : '没有单字语气词') + '</span>');
            parts.push('<span class="ktl-b ktl-b-dash' + (r.dashDense ? ' is-hit' : '') + '">'
                + (r.dashDense ? '破折号偏密' : '破折号正常') + '</span>');
            parts.push('</div>');
            parts.push('<div class="ktl-cap-btns">');
            parts.push('<button type="button" data-act="open" data-i="' + i + '">看这一段</button>');
            parts.push('<button type="button" data-act="unnote" data-i="' + i + '">撤掉</button>');
            parts.push('</div>');
            parts.push('</div>');
        }
        if (!rows.length) {
            parts.push('<div class="ktl-list-none">'
                + this._esc(app.faceTextOf(app.faceOf())) + '</div>');
        }
        parts.push('</div>');
        parts.push(this._detailPanel());
        parts.push('</div>');
        return parts.join('');
    }
    /* ---------- 单条详情：产要求文本 / 收拾回信 ---------- */
    _detailPanel() {
        const app = this.app;
        const key = app.currentKey();
        if (key === '') return '';
        const i = Number(key);
        const row = app.noteRows()[i];
        if (!row) return '';
        const parts = [];
        parts.push('<div class="ktl-detail">');
        parts.push('<div class="ktl-detail-head">第 ' + (i + 1) + ' 段　' + this._esc(row.partner)
            + (row.shop ? '　在 ' + this._esc(row.shop) : '') + '</div>');
        parts.push('<div class="ktl-detail-line">' + this._esc(row.firstLine) + '</div>');
        parts.push('<div class="ktl-detail-btns">');
        parts.push('<button type="button" data-act="build" data-i="' + i + '">产一段要求文本</button>');
        parts.push('<button type="button" data-act="close">收起</button>');
        parts.push('</div>');
        const draft = app.draftOf();
        if (draft) parts.push('<textarea class="ktl-draft" rows="8" readonly>' + this._esc(draft) + '</textarea>');
        parts.push('<label class="ktl-detail-lab">把模型的回信贴回来（本件只收拾，不替你发）</label>');
        parts.push('<textarea data-k="reply" rows="5" placeholder="贴回信正文；带不带选项段与场景段都能收拾"></textarea>');
        parts.push('<button type="button" data-act="parse" data-i="' + i + '">收拾这一段回信</button>');
        parts.push('</div>');
        return parts.join('');
    }
    /* ---------- 面板 ②：轮次三档 ---------- */
    _roundPanel() {
        const app = this.app;
        const rows = app.roundRows();
        const parts = [];
        parts.push('<div class="ktl-panel">');
        parts.push('<p class="ktl-hint">三档**逐档列全**（每档带自己的轮次上限与一句处置），'
            + '另有「数不出来」单列一栏——塔进任一档就是源的那个毛病，'
            + '数不出来被说成「聊了很久」、一条都没有被说成「三言两语」。'
            + '计数是「—」时表示读数取不出来，不是零点。</p>');
        parts.push('<div class="ktl-rows">');
        for (const r of rows) {
            parts.push('<div class="ktl-row ktl-rd-' + r.key + '">');
            parts.push('<span class="ktl-row-k">' + this._esc(r.label) + '</span>');
            parts.push('<span class="ktl-row-floor">' + (r.max === null ? '不限轮次' : '最多 ' + r.max + ' 轮') + '</span>');
            parts.push('<span class="ktl-row-count">' + this._count(r.count) + ' 段</span>');
            parts.push('<span class="ktl-row-why">' + this._esc(r.why) + '</span>');
            parts.push('</div>');
        }
        parts.push('</div>');
        const rd = app.readings();
        parts.push('<div class="ktl-extra"><span class="ktl-extra-k">' + this._esc(KETTLE_ROUND_UNKNOWN) + '</span>'
            + '<span class="ktl-extra-v">' + this._count(rd ? rd.unknownRounds : null) + ' 段（源会把它当成「聊了很久」）</span></div>');
        parts.push('<div class="ktl-extra"><span class="ktl-extra-k">含单字语气词</span>'
            + '<span class="ktl-extra-v">' + this._count(rd ? rd.withSolo : null) + ' 段（本仓口径：登记不保存）</span></div>');
        parts.push('</div>');
        return parts.join('');
    }
    /* ---------- 面板 ③：选项四态 ---------- */
    _optionPanel() {
        const app = this.app;
        const rows = app.optionRows();
        const parts = [];
        parts.push('<div class="ktl-panel">');
        parts.push('<p class="ktl-hint">选项**四态逐态列全**（源只有「能拆开」与「拆不开」两种，'
            + '一个选项与八个选项都照样成条）。比例是这一态占最近回执的比例。\u200b</p>');
        parts.push('<div class="ktl-rows">');
        for (const r of rows) {
            parts.push('<div class="ktl-row ktl-op-' + r.key + '">');
            parts.push('<span class="ktl-row-k">' + this._esc(r.text) + '</span>');
            parts.push('<span class="ktl-row-count">' + this._count(r.count) + ' 次</span>');
            parts.push('<span class="ktl-row-why">占比 ' + this._count(r.rate) + '<span class="ktl-pct">%</span></span>');
            parts.push('</div>');
        }
        parts.push('</div>');
        parts.push('</div>');
        return parts.join('');
    }
    /* ---------- 面板 ④：台账 ---------- */
    _ledgerPanel() {
        const app = this.app;
        const rows = app.receiptRows();
        const p = app.policyRow();
        const parts = [];
        parts.push('<div class="ktl-panel">');
        parts.push('<p class="ktl-hint">每收拾一段回信留一张回执：选项落在哪一态、场景是标了还是没标（没标就是没标，'
            + '不沿用上一次的地点）、单字语气词几处、破折号密不密。</p>');
        parts.push('<div class="ktl-led-btns">');
        parts.push('<button type="button" data-act="clear-ledger">清空台账</button>');
        parts.push('<span class="ktl-led-cap">已存 ' + p.receiptCount + ' / ' + p.ledgerKeep + ' 条'
            + (p.receiptFull ? '（已达上限，新的会把最旧的顶掉）' : '') + '</span>');
        parts.push('</div>');
        parts.push('<div class="ktl-led">');
        for (let i = 0; i < rows.length; i += 1) {
            const r = rows[i];
            const tone = (r.optionFace === 'ok') ? 'ok' : 'warn';
            parts.push('<div class="ktl-rec ktl-rc-' + tone + '">');
            parts.push('<div class="ktl-rec-top">');
            parts.push('<span class="ktl-rec-who">' + this._esc(r.partner || '（没写是谁）') + '</span>');
            parts.push('<span class="ktl-rec-round' + (r.bucketKnown ? '' : ' is-unk') + '">' + this._esc(r.bucketLabel) + '</span>');
            parts.push('<span class="ktl-rec-opt">' + this._esc(r.optionText) + '</span>');
            parts.push('</div>');
            parts.push('<div class="ktl-rec-body">场景：' + this._esc(r.sceneLabel)
                + (r.at ? '・' + this._esc(r.at) : '') + '</div>');
            parts.push('<div class="ktl-rec-body">单字语气词 ' + r.soloHits + ' 处・破折号 ' + r.dashTotal + ' 处'
                + (r.dashDense ? '（偏密）' : '') + (r.dropped > 0 ? '・选项丢掉了 ' + r.dropped + ' 条' : '') + '</div>');
            parts.push('</div>');
        }
        if (!rows.length) {
            parts.push('<div class="ktl-led-none">'
                + this._esc(app.faceTextOf(app.faceOf())) + '</div>');
        }
        parts.push('</div>');
        parts.push('</div>');
        return parts.join('');
    }
    /* ---------- 面板 ⑤：策略 ---------- */
    _policyPanel() {
        const app = this.app;
        const p = app.policyRow();
        const cat = app.catalogs();
        const parts = [];
        parts.push('<div class="ktl-panel">');
        parts.push('<div class="ktl-row"><span class="ktl-row-k">台账保留数</span>');
        parts.push('<input type="number" step="1" min="1" max="' + cat.limits.maxNotes + '" data-k="keep" value="' + p.ledgerKeep + '" />');
        parts.push('<span class="ktl-row-sub">源对回执无上限（与记录混在一个键里一直堆）；本仓给口，上限 ' + cat.limits.maxNotes + '</span></div>');
        parts.push('<div class="ktl-cats">');
        parts.push('<div class="ktl-cat"><span class="ktl-cat-k">轮次三档</span>'
            + '<span class="ktl-cat-v">' + this._esc(cat.rounds.join(' / '))
            + '（上限 ' + (cat.roundMeta[cat.rounds[0]].max === null ? '—' : cat.roundMeta[cat.rounds[0]].max)
            + ' / ' + cat.roundMeta[cat.rounds[1]].max + ' / 不限）</span></div>');
        parts.push('<div class="ktl-cat"><span class="ktl-cat-k">选项条数</span>'
            + '<span class="ktl-cat-v">少 ' + cat.limits.optionsMin + ' 条或超 ' + cat.limits.optionsMax
            + ' 条都不算合格；每条封顶 ' + cat.limits.optionMaxLen + ' 字</span></div>');
        parts.push('<div class="ktl-cat"><span class="ktl-cat-k">场景标签</span>'
            + '<span class="ktl-cat-v">最多 ' + cat.limits.sceneMaxLen + ' 字；缺了就是没标，不外推上一条</span></div>');
        parts.push('<div class="ktl-cat"><span class="ktl-cat-k">单字语气词</span>'
            + '<span class="ktl-cat-v">' + this._esc(cat.soloChars.join(' ')) + '（共 ' + cat.soloChars.length + ' 个）</span></div>');
        parts.push('<div class="ktl-cat"><span class="ktl-cat-k">为什么不留单字语气词</span>'
            + '<span class="ktl-cat-v">' + this._esc(cat.soloWhy) + '</span></div>');
        parts.push('<div class="ktl-cat"><span class="ktl-cat-k">其余上限</span>'
            + '<span class="ktl-cat-v">记录 ' + cat.limits.maxNotes + ' 条・首句 ' + cat.limits.maxSummary
            + ' 字・正文 ' + cat.limits.maxText + ' 字・快照 ' + cat.limits.maxSnapshot + ' 条</span></div>');
        parts.push('</div>');
        parts.push('<p class="ktl-hint">本件**零网络、零密钥**：源自己从浏览器本地存储读模型地址与密钥、'
            + '自己走 SSE 流并往会话里写楼层；本件只产「可复制的要求文本」与「回信收拾」。</p>');
        parts.push('</div>');
        return parts.join('');
    }
    /* ---------- 事件 ---------- */
    _field(k) { const el = this._q('[data-k="' + k + '"]'); return el ? String(el.value || '') : ''; }
    _act(act, el) {
        const app = this.app;
        const i = el ? Number(el.getAttribute('data-i')) : -1;
        if (act === 'settle-demo') {
            const r = app.settleDemo(this._field('partner'), this._field('shop'), this._field('at'));
            this._flash = r.ok ? ('封下了（共 ' + app.noteCount() + ' 段）') : this._settleWhy(r);
        } else if (act === 'open') {
            const r = app.openNote(i);
            this._flash = r.ok ? '看这一段' : '找不到这一段';
        } else if (act === 'close') {
            app.closeNote();
            this._flash = '';
        } else if (act === 'unnote') {
            const r = app.unnote(i);
            this._flash = r.ok ? ('撤掉了，还剩 ' + r.left + ' 段') : '找不到这一段';
        } else if (act === 'build') {
            const r = app.buildEnvelope(i);
            this._flash = r.ok ? '要求文本已产（贴到你惯用的对话端）' : '这一段已经不在了';
        } else if (act === 'parse') {
            const r = app.parseReply(i, this._field('reply'));
            this._flash = r.ok ? this._parseWhy(r) : this._parseFail(r);
        } else if (act === 'clear-ledger') {
            app.clearLedger();
            this._flash = '台账清空了';
        }
        this.refresh();
    }
    /** 封记录被拒的四种原因各自说清（不许塔成一句「封不下」）。 */
    _settleWhy(r) {
        const rs = r.reasons || [];
        if (rs.indexOf('over_max') >= 0) return '记录满了（上限 ' + r.max + ' 段）';
        const bits = [];
        if (rs.indexOf('no_note') >= 0) bits.push('没有一句可留下的正文');
        if (rs.indexOf('no_partner') >= 0) bits.push('没写对面是谁');
        if (rs.indexOf('bad_rounds') >= 0) bits.push('轮次数不出来（不会替你按「聊了很久」算）');
        return bits.length ? ('封不下：' + bits.join('、')) : ('封不下：' + rs.join('、'));
    }
    /** 收拾结果：四件事各自报出（源把这四件事写在四处，且都不报「这轮没给选项」）。 */
    _parseWhy(r) {
        const bits = ['选项：' + r.optionText];
        bits.push('场景：' + r.sceneLabel);
        bits.push(r.soloHits > 0 ? ('单字语气词 ' + r.soloHits + ' 处（登记不留）') : '没有单字语气词');
        bits.push(r.dashDense ? '破折号偏密' : '破折号正常');
        return bits.join('・');
    }
    _parseFail(r) {
        if (r.reason === 'empty_input') return '还没贴东西';
        if (r.reason === 'out_of_range') return '这一段已经不在了（被撤过，或换过会话）';
        return '收拾不了：' + r.reason;
    }
    _bindEvents() {
        const root = this._root;
        if (!root) return;
        /* 点击分派：三个面各走一遍「从命中元素**向上找最近的带标记祖先**」。
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
            const actEl = climb(t, (n) => n.getAttribute('data-act'));
            if (actEl) { this._act(actEl.getAttribute('data-act'), actEl); return; }
            const cardEl = climb(t, (n) => n.getAttribute('data-open') !== null);
            if (cardEl) {
                this.app.openNote(Number(cardEl.getAttribute('data-open')));
                this._flash = '';
                this.refresh();
            }
        });
        root.addEventListener('change', (e) => {
            const t = e.target;
            if (!t || !t.getAttribute) return;
            if (t.getAttribute('data-k') === 'keep') {
                const r = this.app.setLedgerKeep(t.value);
                this._flash = (String(r.saw) === String(r.took))
                    ? ('台账最多留 ' + r.took + ' 条')
                    : ('「' + r.saw + '」不收，仍按 ' + r.took + ' 条');
                this.refresh();
            }
        });
    }
}
