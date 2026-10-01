/* ========================================================
 * needsim-view.js — [v3.41.0] 需求沙盘 · 视图层
 * 照抄 kettle / sourcebook / recall 规格：_buildHTML() 拼串 → innerHTML
 * → _bindEvents()。只在 render / refresh 里读 App 现算值，**不缓存投影**。
 *
 * 五条视图纪律：
 *  ① **需求逐项分开画**：「读得出来」与「读不出来」不同形 ——
 *     源把读不出来的需求回落成 5 并照画进度条，于是用户看着一根几乎
 *     见底的条，以为他真的快见底了。
 *  ② **心情缺项不同形**：源在六项不齐时落「非常不开心」（最差档）；
 *     本件画「心情读不出来」。
 *  ③ **池子四态逐格列全**：源只有「拆得开」与「当成空」。
 *  ④ **空与坏不同形**：计数在读数取不出来时画横线而不是零。
 *  ⑤ **愿望四态各自带话**：过期不许与「今天没有」同形。
 *
 * 本文件与数据层同守的纪律：不写正则字面量（本仓剥注释器是字符状态机，
 * 正则里的裸引号会让它卡住）；与号与双引号一律走**拼装形**（不写实体字面量：
 * 落盘传输链会把实体字面量解码成真字符，转义函数会静默失效而不报错）。
 * ======================================================== */
'use strict';
/* ★ 这里只取**键面**真源（四态取值）。四态 / 六项的清单不在这里：
 *   由 App 的各类 Rows() 现算给出 —— 视图不持第二份清单，
 *   否则真源表增删一态，视图会静默少画一态而不报错（本仓 J7 形态）。 */
import { SIMS_FACES } from './needsim-data.js';

/** 转义要 replace 的三个字符 —— 用**拼装形**，不写实体字面量。 */
const DQUOTE = String.fromCharCode(34);
const SQ = String.fromCharCode(39);
const AMP = String.fromCharCode(38);
const NL = String.fromCharCode(10);
const DASH = '\u2014';
const UNI_SIM = String.fromCharCode(55358) + String.fromCharCode(56760);

/** 四态人话与色相（**键面取数据层真源**，不写标识符形 —— 本仓 J7 形态）。 */
const FACE_TONE = {};
FACE_TONE[SIMS_FACES[0]] = 'ok';
FACE_TONE[SIMS_FACES[1]] = 'warn';
FACE_TONE[SIMS_FACES[2]] = 'err';
FACE_TONE[SIMS_FACES[3]] = 'err';
const TABS = [
    { key: 'needs', label: '六项' },
    { key: 'pool', label: '台词池' },
    { key: 'wish', label: '今日愿望' },
    { key: 'memory', label: '记忆流' },
    { key: 'ledger', label: '台账' },
    { key: 'policy', label: '策略' }
];

/** 视图层：六页签（六项 / 台词池 / 今日愿望 / 记忆流 / 台账 / 策略）。 */
export class NeedsimView {
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
        this._root.className = 'nsm-root';
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
    /** 转义（与号与两个引号走拼装形 —— 见文件头纪律）。 */
    _esc(s) {
        return String(s == null ? '' : s)
            .split(AMP).join(AMP + 'amp;')
            .split('<').join(AMP + 'lt;')
            .split('>').join(AMP + 'gt;')
            .split(DQUOTE).join(AMP + 'quot;')
            .split(SQ).join(AMP + '#39;');
    }
    /** 计数位：null 画横线（**不是零**）—— 「真的没有」与「读不出来」不同形。 */
    _count(v) {
        return (v === null || v === undefined) ? DASH : String(v);
    }
    _buildHTML() {
        const app = this.app;
        const face = app.faceOf();
        const tone = FACE_TONE[face] || 'warn';
        const parts = [];
        parts.push('<div class="nsm-header"><h2>' + UNI_SIM + ' 需求沙盘</h2>'
            + '<span class="nsm-header-sub">把模型给的那份状态数据收拾好——本件不替你发请求</span></div>');
        parts.push('<div class="nsm-face nsm-face-' + tone + '">');
        parts.push('<span class="nsm-face-label">' + this._esc(app.faceTextOf(face)) + '</span>');
        parts.push('<span class="nsm-face-sub">' + this._esc(app.summaryLine()) + '</span>');
        parts.push('</div>');
        if (this._flash) parts.push('<div class="nsm-flash">' + this._esc(this._flash) + '</div>');
        const cur = app.tab();
        parts.push('<div class="nsm-tabs">');
        for (const t of TABS) {
            parts.push('<button type="button" class="nsm-tab' + (cur === t.key ? ' is-on' : '')
                + '" data-tab="' + t.key + '">' + this._esc(t.label) + '</button>');
        }
        parts.push('</div>');
        if (cur === 'pool') parts.push(this._poolPanel());
        else if (cur === 'wish') parts.push(this._wishPanel());
        else if (cur === 'memory') parts.push(this._memoryPanel());
        else if (cur === 'ledger') parts.push(this._ledgerPanel());
        else if (cur === 'policy') parts.push(this._policyPanel());
        else parts.push(this._needPanel());
        return parts.join('');
    }

    /* ---------- 面板 ①：六项需求 ---------- */
    _needPanel() {
        const app = this.app;
        const rows = app.needRows();
        const mood = app.moodRow();
        const parts = [];
        parts.push('<div class="nsm-panel">');
        parts.push('<p class="nsm-hint">读不出来的那一项画横线而不是一根几乎见底的条 —— '
            + '源会把读不出来的值按最小值画，看着就像他真的快见底了。</p>');
        parts.push('<div class="nsm-needs">');
        for (const r of rows) {
            const known = r.ok === true;
            parts.push('<div class="nsm-need' + (known ? '' : ' is-unk') + '">');
            parts.push('<div class="nsm-need-top"><span class="nsm-need-ic">' + this._esc(r.icon) + '</span>'
                + '<span class="nsm-need-lab">' + this._esc(r.label) + '</span>'
                + '<span class="nsm-need-val">' + (known ? (r.value + '<span class="nsm-pct">%</span>') : this._esc(r.unreadableText)) + '</span></div>');
            if (known) {
                parts.push('<div class="nsm-bar"><span class="nsm-bar-fill nsm-lv-' + r.level
                    + '" style="width:' + r.value + '%"></span></div>');
                parts.push('<div class="nsm-need-sub">' + this._esc(r.levelLabel) + '・照顾动作：' + this._esc(r.careLabel) + '</div>');
            } else {
                parts.push('<div class="nsm-bar nsm-bar-unk"><span class="nsm-bar-dash">' + DASH + '</span></div>');
                parts.push('<div class="nsm-need-sub">这一项没被存下来，或存下的值不是数</div>');
            }
            parts.push('</div>');
        }
        parts.push('</div>');
        parts.push('<div class="nsm-mood' + (mood.ok ? '' : ' is-unk') + '">');
        parts.push('<span class="nsm-mood-k">心情</span>');
        parts.push('<span class="nsm-mood-v">' + this._esc(mood.label) + '</span>');
        parts.push('<span class="nsm-mood-sub">'
            + (mood.ok ? ('六项平均 ' + mood.avg) : ('六项只拿得到 ' + mood.given + ' 项，不替你按最差档算'))
            + '</span>');
        parts.push('</div>');
        parts.push('<div class="nsm-form">');
        parts.push('<label>贴模型回信（六项需求 + 台词池 + 小事件 + 今日愿望）</label>');
        parts.push('<textarea data-k="reply" rows="5" placeholder="只回一个 JSON 对象；本件只收拾，不替你发请求"></textarea>');
        parts.push('<button type="button" data-act="ingest">收拾这份回信</button>');
        parts.push('<button type="button" data-act="request">产一段要求文本</button>');
        parts.push('<button type="button" data-act="reset">六项回到初值</button>');
        parts.push('</div>');
        const draft = app.draftOf();
        if (draft) parts.push('<textarea class="nsm-draft" rows="8" readonly>' + this._esc(draft) + '</textarea>');
        parts.push('</div>');
        return parts.join('');
    }
    /* ---------- 面板 ②：台词池与小事件 ---------- */
    _poolPanel() {
        const app = this.app;
        const actions = app.actionRows();
        const events = app.eventRows();
        const cat = app.catalogs();
        const rd = app.readings();
        /* ★ 整格四态从 App 取（事件池坏了要报「一条都用不上」，不许视图自己数条数推）。 */
        const evFace = app.eventsStateOf();
        const parts = [];
        parts.push('<div class="nsm-panel">');
        parts.push('<p class="nsm-hint">每个行动**逐格报四态**：合格 / 不满三条（点几次就会绕回开头）/ 还没生成 / 写了但一条都用不上。'
            + '源只有「能拆开」与「当成空」两种。</p>');
        parts.push('<div class="nsm-grid">');
        for (const a of actions) {
            parts.push('<div class="nsm-act nsm-pool-' + a.poolState + '">');
            parts.push('<div class="nsm-act-top"><span class="nsm-act-ic">' + this._esc(a.icon) + '</span>'
                + '<span class="nsm-act-lab">' + this._esc(a.label) + '</span>'
                + '<span class="nsm-act-n">' + a.lineCount + ' / ' + cat.limits.lineLimit + '</span></div>');
            parts.push('<div class="nsm-act-eff">' + this._esc(a.effectText) + '</div>');
            parts.push('<div class="nsm-act-state">' + this._esc(a.poolText) + '</div>');
            if (a.blocked) parts.push('<div class="nsm-act-warn">有一项需求读不出来，这一下会跳过那一项</div>');
            parts.push('<button type="button" data-act="do" data-a="' + a.key + '">点一下</button>');
            parts.push('</div>');
        }
        parts.push('</div>');
        parts.push('<div class="nsm-sec-head">小事件池'
            + '<span class="nsm-sec-sub">' + this._esc((cat.poolStateText[evFace] || '')) + '</span>'
            + '<button type="button" data-act="ev">点一次小事件</button></div>');
        parts.push('<div class="nsm-events">');
        for (const e of events) {
            parts.push('<div class="nsm-ev">');
            parts.push('<div class="nsm-ev-top"><span class="nsm-ev-i">#' + (e.index + 1) + '</span>'
                + '<span class="nsm-ev-t">' + this._esc(e.title) + '</span></div>');
            parts.push('<div class="nsm-ev-x">' + this._esc(e.text)
                + (e.hasEffects ? ('・' + this._esc(e.effectText)) : '') + '</div>');
            parts.push('</div>');
        }
        /* ★ 空态文案按**整格四态**取：事件池「写了但一条都用不上」不许画成「还没生成过」。 */
        if (!events.length) parts.push('<div class="nsm-none">' + this._esc(app.poolTextOf(evFace)) + '</div>');
        parts.push('</div>');
        parts.push('<div class="nsm-extra"><span class="nsm-extra-k">台词总条数</span>'
            + '<span class="nsm-extra-v">' + this._count(rd ? rd.lines : null) + '</span></div>');
        parts.push('</div>');
        return parts.join('');
    }
    /* ---------- 面板 ③：今日愿望 ---------- */
    _wishPanel() {
        const app = this.app;
        const w = app.wishRow();
        const parts = [];
        parts.push('<div class="nsm-panel">');
        parts.push('<p class="nsm-hint">四态各自带话：今天的 / 存着的是过去某天的（不会替你当成「今天没有」）'
            + ' / 今天还没有 / 存着一条但读不出来。源把前两种一起归成「没有」。</p>');
        parts.push('<div class="nsm-wish nsm-wish-' + w.state + '">');
        parts.push('<div class="nsm-wish-state">' + this._esc(w.stateText) + '</div>');
        if (w.title) parts.push('<div class="nsm-wish-title">' + this._esc(w.title) + '</div>');
        if (w.desc) parts.push('<div class="nsm-wish-desc">' + this._esc(w.desc) + '</div>');
        if (w.has) {
            parts.push('<div class="nsm-wish-meta">对应需求：' + this._esc(w.needLabel)
                + '・对应行动：' + this._esc(w.actionLabel)
                + (w.completed ? '・已完成' : '') + (w.date ? '・' + this._esc(w.date) : '') + '</div>');
        }
        if (w.staleText) parts.push('<div class="nsm-wish-warn">' + this._esc(w.staleText) + '</div>');
        parts.push('</div>');
        parts.push('<div class="nsm-form">');
        parts.push('<button type="button" data-act="wish-build">按最弱的那项定今天的愿望</button>');
        parts.push('<button type="button" data-act="wish-set">存一条愿望</button>');
        parts.push('<label>愿望标题</label><input type="text" data-k="wtitle" placeholder="如 想听见你的声音" />');
        parts.push('<label>愿望说明</label><input type="text" data-k="wdesc" placeholder="如 希望今天能和你聊几句" />');
        parts.push('</div>');
        parts.push('</div>');
        return parts.join('');
    }

    /* ---------- 面板 ④：记忆流 ---------- */
    _memoryPanel() {
        const app = this.app;
        const rows = app.memoryRows();
        const p = app.policyRow();
        const cur = app.currentKey();
        const parts = [];
        parts.push('<div class="nsm-panel">');
        parts.push('<p class="nsm-hint">上限 ' + p.maxMemories + ' 条：满了落最旧的那条并写明「顶掉了 1 条」—— '
            + '源在满了的时候会把整本一次清空，而且不报错不提示。</p>');
        parts.push('<div class="nsm-led-btns">');
        parts.push('<button type="button" data-act="clear-mem">清空记忆流</button>');
        parts.push('<span class="nsm-led-cap">已存 ' + p.memoryCount + ' / ' + p.maxMemories + ' 条</span>');
        parts.push('</div>');
        parts.push('<div class="nsm-mems">');
        for (let i = 0; i < rows.length; i += 1) {
            const r = rows[i];
            parts.push('<div class="nsm-mem' + (cur === String(i) ? ' is-on' : '') + (r.auto ? ' is-auto' : '') + '" data-open="' + i + '">');
            parts.push('<div class="nsm-mem-top"><span class="nsm-mem-t">' + this._esc(r.title) + '</span>');
            parts.push('<span class="nsm-mem-age' + (r.ageOk ? '' : ' is-unk') + '">' + this._esc(r.ageLabel) + '</span></div>');
            parts.push('<div class="nsm-mem-x">' + this._esc(r.text)
                + (r.effects ? ('・' + this._esc(r.effects)) : '') + '</div>');
            parts.push('<div class="nsm-mem-kind">' + (r.auto ? '自己冒出来的' : '我点出来的') + '</div>');
            parts.push('</div>');
        }
        if (!rows.length) parts.push('<div class="nsm-none">还没有记下任何一件事</div>');
        parts.push('</div>');
        parts.push('</div>');
        return parts.join('');
    }
    /* ---------- 面板 ⑤：台账 ---------- */
    _ledgerPanel() {
        const app = this.app;
        const rows = app.receiptRows();
        const p = app.policyRow();
        const parts = [];
        parts.push('<div class="nsm-panel">');
        parts.push('<p class="nsm-hint">每次点行动 / 点小事件 / 重定愿望留一张回执：数值动了几项、跳过了几项、'
            + '顶掉了记忆几条、台词绕回第几轮。</p>');
        parts.push('<div class="nsm-led-btns">');
        parts.push('<button type="button" data-act="clear-ledger">清空台账</button>');
        parts.push('<span class="nsm-led-cap">已存 ' + p.receiptCount + ' / ' + p.ledgerKeep + ' 条'
            + (p.receiptFull ? '（已达上限，新的会把最旧的顶掉）' : '') + '</span>');
        parts.push('</div>');
        parts.push('<div class="nsm-led">');
        for (let i = 0; i < rows.length; i += 1) {
            const r = rows[i];
            const tone = (r.skipped > 0 || r.evicted > 0) ? 'warn' : 'ok';
            parts.push('<div class="nsm-rec nsm-rc-' + tone + '">');
            parts.push('<div class="nsm-rec-top">');
            parts.push('<span class="nsm-rec-lab">' + this._esc(r.label || '（无标题）') + '</span>');
            parts.push('<span class="nsm-rec-kind">' + (r.kind === 'event' ? '小事件' : '行动') + '</span>');
            parts.push('<span class="nsm-rec-mood">' + this._esc(r.mood) + '</span>');
            parts.push('</div>');
            parts.push('<div class="nsm-rec-line">' + this._esc(r.line) + '</div>');
            parts.push('<div class="nsm-rec-body">动了 ' + r.applied + ' 项・跳过 ' + r.skipped + ' 项'
                + (r.capped ? '・有 ' + r.capped + ' 项被夹到边界' : '')
                + (r.evicted ? '・顶掉记忆 ' + r.evicted + ' 条' : '')
                + (r.wrap ? '・台词绕回第 ' + r.wrap + ' 轮' : '')
                + (r.wishDone ? '・完成了今日愿望' : '') + '</div>');
            parts.push('</div>');
        }
        if (!rows.length) parts.push('<div class="nsm-none">还没有任何回执</div>');
        parts.push('</div>');
        parts.push('</div>');
        return parts.join('');
    }
    /* ---------- 面板 ⑥：策略 ---------- */
    _policyPanel() {
        const app = this.app;
        const p = app.policyRow();
        const cat = app.catalogs();
        const parts = [];
        parts.push('<div class="nsm-panel">');
        parts.push('<div class="nsm-row"><span class="nsm-row-k">台账保留数</span>');
        parts.push('<input type="number" step="1" min="1" max="' + cat.limits.maxUnits + '" data-k="keep" value="' + p.ledgerKeep + '" />');
        parts.push('<span class="nsm-row-sub">源对回执无上限（与别的状态混在一处一直堆）；本仓给口，上限 ' + cat.limits.maxUnits + '</span></div>');
        parts.push('<div class="nsm-cats">');
        parts.push('<div class="nsm-cat"><span class="nsm-cat-k">六项需求</span>'
            + '<span class="nsm-cat-v">' + this._esc(cat.needKeys.map((k) => cat.needMeta[k].label).join(' / '))
            + '（初值 ' + this._esc(cat.needKeys.map((k) => cat.needMeta[k].base).join(' / ')) + '）</span></div>');
        parts.push('<div class="nsm-cat"><span class="nsm-cat-k">六个行动</span>'
            + '<span class="nsm-cat-v">' + this._esc(cat.actionIds.map((k) => cat.actionMeta[k].label).join(' / ')) + '</span></div>');
        parts.push('<div class="nsm-cat"><span class="nsm-cat-k">数值口径</span>'
            + '<span class="nsm-cat-v">' + cat.limits.valueMin + ' 到 ' + cat.limits.valueMax
            + '；单项变化 ' + cat.limits.effectMin + ' 到 ' + cat.limits.effectMax + '</span></div>');
        parts.push('<div class="nsm-cat"><span class="nsm-cat-k">池子口径</span>'
            + '<span class="nsm-cat-v">每个行动要 ' + cat.limits.lineLimit + ' 条台词・小事件要 ' + cat.limits.eventLimit
            + ' 条・记忆上限 ' + cat.limits.memoryLimit + ' 条</span></div>');
        parts.push('<div class="nsm-cat"><span class="nsm-cat-k">池子四态</span>'
            + '<span class="nsm-cat-v">' + this._esc(cat.poolStates.map((k) => cat.poolStateText[k]).join(' / ')) + '</span></div>');
        parts.push('<div class="nsm-cat"><span class="nsm-cat-k">愿望四态</span>'
            + '<span class="nsm-cat-v">' + this._esc(cat.wishStates.map((k) => cat.wishStateText[k]).join(' / ')) + '</span></div>');
        parts.push('<div class="nsm-cat"><span class="nsm-cat-k">回信读不出来时</span>'
            + '<span class="nsm-cat-v">' + this._esc(Object.keys(cat.replyWhys).map((k) => cat.replyWhys[k].label).join(' / ')) + '</span></div>');
        parts.push('</div>');
        parts.push('<p class="nsm-hint">本件**零网络、零密钥**：源自己从浏览器本地存储读模型地址与密钥、'
            + '自己发请求、自己从回复里抠 JSON；本件只产「可复制的要求文本」与「回信收拾」。</p>');
        parts.push('</div>');
        return parts.join('');
    }

    /* ---------- 事件 ---------- */
    _field(k) { const el = this._q('[data-k="' + k + '"]'); return el ? String(el.value || '') : ''; }
    _act(act, el) {
        const app = this.app;
        const a = el ? String(el.getAttribute('data-a') || '') : '';
        if (act === 'ingest') {
            const r = app.ingestReply(this._field('reply'));
            this._flash = r.ok ? this._ingestWhy(r) : this._ingestFail(r);
        } else if (act === 'request') {
            app.requestText({ role: '这个角色' });
            this._flash = '要求文本已产（贴到你惯用的对话端）';
        } else if (act === 'reset') {
            app.resetNeeds();
            this._flash = '六项回到初值（这不是「读不出来」，是按初值重来）';
        } else if (act === 'do') {
            const r = app.performAction(a);
            this._flash = r.ok ? this._doWhy(r) : this._doFail(r);
        } else if (act === 'ev') {
            const r = app.triggerEvent();
            this._flash = r.ok ? ('小事件：' + r.title) : this._evFail(r);
        } else if (act === 'wish-build') {
            const r = app.buildWishNow();
            this._flash = r.ok ? ('今天的愿望定下了：' + app.wishRow().title) : this._wishFail(r);
        } else if (act === 'wish-set') {
            const r = app.setWish({ title: this._field('wtitle'), desc: this._field('wdesc'), need: '', actionId: '' });
            this._flash = r.ok ? '愿望存下了' : (r.reason === 'no_title' ? '还没写标题' : '还没写说明');
        } else if (act === 'clear-mem') {
            const r = app.clearMemories();
            this._flash = '记忆流清空了（清掉 ' + r.cleared + ' 条；需求与池子没动）';
        } else if (act === 'clear-ledger') {
            app.clearLedger();
            this._flash = '台账清空了';
        }
        this.refresh();
    }
    /** 点行动的结果：绕回 / 跳过 / 顶掉 / 完成愿望 四件事各自报出。 */
    _doWhy(r) {
        const bits = [r.label + '：' + r.line];
        bits.push('动了 ' + r.applied.length + ' 项');
        if (r.skipped.length) bits.push('跳过 ' + r.skipped.length + ' 项（含读不出来或已到边界）');
        if (r.evicted) bits.push('顶掉记忆 ' + r.evicted + ' 条');
        if (r.wrapped) bits.push('台词绕回第 ' + r.wrap + ' 轮（池子只有 ' + r.poolSize + ' 条）');
        if (r.wishDone) bits.push('完成了今日愿望');
        return bits.join('・');
    }
    _doFail(r) {
        if (r.reason === 'empty_pool') return r.label + '还没有台词（台词的池子空着，点不动）';
        if (r.reason === 'unknown_action') return '没有这个行动';
        return '点不动：' + r.reason;
    }
    _evFail(r) {
        if (r.reason === 'empty_pool') return '小事件池：' + r.poolText;
        return '点不动：' + r.reason;
    }
    _wishFail(r) {
        if (r.reason === 'need_unreadable') return '有 ' + r.unknown + ' 项需求读不出来，不替你按「他最饿」算';
        return '定不下：' + r.reason;
    }
    /** 收拾回信的结果：给了几项 / 缺哪几项 / 池子逐格四态 / 愿望有没有一起定下。 */
    _ingestWhy(r) {
        const bits = ['需求给了 ' + r.given + ' 项'];
        if (r.missing.length) bits.push('缺 ' + r.missing.length + ' 项（没给的不动，不按零算）');
        const cat = this.app.catalogs();
        const faces = r.pool.faces || {};
        const count = (state) => {
            let n = 0;
            for (const k of cat.actionIds) if (faces[k] === state) n += 1;
            return n;
        };
        const okN = count(cat.poolStates[0]);
        const partN = count(cat.poolStates[1]);
        const badN = count(cat.poolStates[3]);
        bits.push('台词池合格 ' + okN + ' / ' + cat.actionIds.length);
        if (partN) bits.push('不满 ' + cat.limits.lineLimit + ' 条的有 ' + partN + ' 格');
        if (badN) bits.push('一条都用不上的有 ' + badN + ' 格');
        bits.push('台词共 ' + r.pool.lines + ' 条');
        if (r.pool.rejected) bits.push('丢掉 ' + r.pool.rejected + ' 条');
        if (r.wish) bits.push('今日愿望一并定下了');
        if (r.moodBefore !== r.moodAfter) bits.push('心情：' + r.moodBefore + ' → ' + r.moodAfter);
        return bits.join('・');
    }
    _ingestFail(r) {
        if (r.reason === 'empty_input') return '还没贴东西';
        const lab = r.whyLabel || r.reason;
        return '收拾不了（' + lab + '）' + (r.truncated ? '：花括号没配平，回信可能被截断了' : '');
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
                this.app.openMemory(Number(cardEl.getAttribute('data-open')));
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
