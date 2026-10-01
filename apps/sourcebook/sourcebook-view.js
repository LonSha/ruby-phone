/* ========================================================
 * sourcebook-view.js — [v3.39.0] 时光胶囊 · 封存取回台 视图层
 * 照抄 recall / soundkit / pixiv / magazine 规格：_buildHTML() 拼串 → innerHTML
 * → _bindEvents()。只在 render / refresh 里读 App 现算值，**不缓存投影**。
 *
 * 五条视图纪律：
 *  ① **封存时间三态分开画**：已填 / 没填 / 填了但认不出来 —— 三种处境文案与色相不同。
 *     源把「取不出来」当成今天封的（createdAt 取不出来就 Date.now()），于是三种处境
 *     在用户眼里完全同形，也就无从知道该去补写、还是该去改错字。
 *  ② **心情两态分开画**：未填写不许显示成填了默认值（源写 mood 取不出来就 quiet）。
 *  ③ **跨度六档 / 口吻六族逐档逐族列全**（塔成一档 = 收信口吻永远偏档）。
 *     档位与人话、族名与手感都**取 App 的 catalogs()**（数据层真源），视图不写第二份。
 *  ④ **空与坏不同形**：台账「一条都没有」与「读不出来」两种色相与文案；
 *     跨度与口吻的计数在读数取不出来时画「—」而不是「0」。
 *  ⑤ **两条硬约束要报在哪一句**：命中要带**字段名与那个词**（源抛异常，
 *     调用方一吐，用户只知道「不合格」而不知道改哪句）。
 *
 * 本文件与数据层同守的纪律：不写正则字面量（本仓剥注释器是字符状态机，
 * 正则里的裸引号会让它卡住）；& 与双引号一律走**拼装形**（不写实体字面量：
 * 落盘传输链会把实体字面量解码成真字符，转义函数会静默失效而不报错）。
 * ======================================================== */
'use strict';
/* ★ 这里只取**键面**真源（计算键与人话表）。六档 / 六族的**清单**不在这里：
 *   由 App 的 spanRows() / toneRows() 现算给出 —— 视图不持第二份清单，
 *   否则真源表增删一档，视图会静默少画一档而不报错（本仓 J7 形态）。
 *   （修前这里导入了 SPAN_BUCKETS / TONE_TYPES / MOOD_FALLBACK 三个**从未使用**的
 *    符号，而真正用到的 RECIPIENT_KINDS 反而没导入 ⇒ _kindLabel 一调就 ReferenceError。） */
import {
    SOURCEBOOK_FACES, CREATED_STATES, SPAN_UNKNOWN_LABEL, RECIPIENT_KINDS
} from './sourcebook-data.js';

/** 转义耍 replace 的三个字符 —— 用**拼装形**，不写实体字面量。 */
const DQUOTE = String.fromCharCode(34);
const SQ = String.fromCharCode(39);
const AMP = String.fromCharCode(38);
const NL = String.fromCharCode(10);

/** 三态人话（「一条信都没有」与「读数拿不到」**不许同形**）。
 *  ★ 键面取数据层真源（计算键），不在本文件写一套标识符形 ——
 *    本仓 J7 形态：两份靠碰巧拼写一致对齐，任何一边改名都会让本表静默落兜底。 */
const FACE_META = {
    [SOURCEBOOK_FACES.ok]: { icon: '\u{1f4d6}', label: '书架上有信', tone: 'ok' },
    [SOURCEBOOK_FACES.empty]: { icon: '\u{1f4ed}', label: '还没有存过信', tone: 'warn' },
    [SOURCEBOOK_FACES.storage_absent]: { icon: '\u26a0\ufe0f', label: '存储不可用（读数拿不到）', tone: 'err' }
};
const CREATED_LABEL = {
    [CREATED_STATES.ok]: '已填',
    [CREATED_STATES.absent]: '没填',
    [CREATED_STATES.malformed]: '填了但认不出来'
};
const CREATED_TONE = {
    [CREATED_STATES.ok]: 'ok',
    [CREATED_STATES.absent]: 'warn',
    [CREATED_STATES.malformed]: 'err'
};
const TABS = [
    { key: 'shelf', label: '书架' },
    { key: 'span', label: '跨度六档' },
    { key: 'tone', label: '口吻六族' },
    { key: 'ledger', label: '台账' },
    { key: 'policy', label: '策略' }
];

/** 视图层：五页签（书架 / 跨度六档 / 口吻六族 / 台账 / 策略），六档六族分开画。 */
export class SourcebookView {
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
        this._root.className = 'sbr-root';
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
        return (v === null || v === undefined) ? '—' : String(v);
    }
    _buildHTML() {
        const app = this.app;
        const face = app.faceOf();
        const meta = FACE_META[face] || { icon: '\u2753', label: '未识别的状态：' + String(face), tone: 'warn' };
        const parts = [];
        parts.push('<div class="sbr-header"><h2>\u{1f4da} 时光胶囊</h2>'
            + '<span class="sbr-header-sub">把信存起来、到日子再拆——本件不替你发请求</span></div>');
        parts.push('<div class="sbr-face sbr-face-' + meta.tone + '">');
        parts.push('<span class="sbr-face-icon">' + meta.icon + '</span>');
        parts.push('<span class="sbr-face-label">' + this._esc(meta.label) + '</span>');
        parts.push('<span class="sbr-face-sub">' + this._esc(app.summaryLine()) + '</span>');
        parts.push('</div>');
        if (this._flash) parts.push('<div class="sbr-flash">' + this._esc(this._flash) + '</div>');
        const cur = app.tab();
        parts.push('<div class="sbr-tabs">');
        for (const t of TABS) {
            parts.push('<button type="button" class="sbr-tab' + (cur === t.key ? ' is-on' : '')
                + '" data-tab="' + t.key + '">' + this._esc(t.label) + '</button>');
        }
        parts.push('</div>');
        if (cur === 'span') parts.push(this._spanPanel());
        else if (cur === 'tone') parts.push(this._tonePanel());
        else if (cur === 'ledger') parts.push(this._ledgerPanel());
        else if (cur === 'policy') parts.push(this._policyPanel());
        else parts.push(this._shelfPanel());
        return parts.join('');
    }
    /* ---------- 面板 ①：书架 ---------- */
    _shelfPanel() {
        const app = this.app;
        const rows = app.shelfRows();
        const cur = app.currentKey();
        const parts = [];
        parts.push('<div class="sbr-panel">');
        parts.push('<p class="sbr-hint">封存时间为「没填」与「填了但认不出来」的信会分开写明 ——'
            + ' 源把这两种都当成「今天封的」，于是「刚写」与「三年前写」在跨度上同形。'
            + '</p>');
        parts.push('<div class="sbr-form">');
        parts.push('<label>正文</label><textarea data-k="message" rows="3" placeholder="要写给未来的自己或 TA 的话"></textarea>');
        parts.push('<label>拆开日期</label><input type="text" data-k="openDate" placeholder="YYYY-MM-DD" />');
        parts.push('<label>封存时间</label><input type="text" data-k="createdAt" placeholder="YYYY-MM-DD（留空就是「没填」）" />');
        parts.push('<label>心情（可留空）</label><input type="text" data-k="mood" placeholder="留空与填了默认值不同形" />');
        parts.push('<label>保管的角色（可留空）</label><input type="text" data-k="roleId" placeholder="留空 = 写给未来的自己" />');
        parts.push('<button type="button" data-act="seal">存一封信</button>');
        parts.push('</div>');
        parts.push('<div class="sbr-shelf">');
        for (let i = 0; i < rows.length; i += 1) {
            const r = rows[i];
            const ct = CREATED_TONE[r.createdAtState] || "warn";
            parts.push('<div class="sbr-cap sbr-ct-' + ct + (cur === String(i) ? " is-on" : "") + '" data-open="' + i + '">');
            parts.push('<div class="sbr-cap-top">');
            parts.push('<span class="sbr-cap-idx">#' + (i + 1) + '</span>');
            parts.push('<span class="sbr-cap-open">拆 ' + this._esc(r.openDate || "（缺）") + '</span>');
            parts.push('<span class="sbr-cap-kind">' + this._esc(this._kindLabel(r.kind)) + '</span>');
            parts.push('</div>');
            parts.push('<div class="sbr-cap-msg">' + this._esc(r.message) + '</div>');
            parts.push('<div class="sbr-cap-meta">');
            parts.push('<span class="sbr-b sbr-b-span' + (r.spanKnown ? "" : " is-unk") + '">' + this._esc(r.spanLabel) + '</span>');
            parts.push('<span class="sbr-b sbr-b-tone">' + this._esc(r.toneLabel) + '</span>');
            parts.push('<span class="sbr-b sbr-b-mood' + (r.moodFilled ? "" : " is-empty") + '">'
                + (r.moodFilled ? this._esc(r.moodKey) : '心情未填') + '</span>');
            parts.push('<span class="sbr-b sbr-bc-' + ct + '">封存时间 '
                + this._esc(CREATED_LABEL[r.createdAtState] || r.createdAtState) + '</span>');
            parts.push('</div>');
            parts.push('<div class="sbr-cap-btns">');
            parts.push('<button type="button" data-act="open" data-i="' + i + '">看这封信</button>');
            parts.push('<button type="button" data-act="unseal" data-i="' + i + '">撤掉</button>');
            parts.push('</div>');
            parts.push('</div>');
        }
        if (!rows.length) {
            parts.push('<div class="sbr-shelf-none">'
                + (app.faceOf() === SOURCEBOOK_FACES.storage_absent ? '存储读不出来，不是「没有信」' : '还没有存过信')
                + '</div>');
        }
        parts.push('</div>');
        parts.push(this._detailPanel());
        parts.push('</div>');
        return parts.join("");
    }
    /** 收信人两种人话（键面取数据层真源）。 */
    _kindLabel(kind) {
        const hit = RECIPIENT_KINDS[kind];
        return hit ? hit.label : String(kind);
    }
    /* ---------- 单封信详情：产要求文本 / 贴回信 ---------- */
    _detailPanel() {
        const app = this.app;
        const key = app.currentKey();
        if (key === "") return "";
        const i = Number(key);
        const row = app.shelfRows()[i];
        if (!row) return "";
        const parts = [];
        parts.push('<div class="sbr-detail">');
        parts.push('<div class="sbr-detail-head">第 ' + (i + 1) + ' 封　拆 ' + this._esc(row.openDate) + '</div>');
        parts.push('<div class="sbr-detail-msg">' + this._esc(row.message) + '</div>');
        parts.push('<div class="sbr-detail-btns">');
        parts.push('<button type="button" data-act="build" data-i="' + i + '">产一段要求文本</button>');
        parts.push('<button type="button" data-act="close">收起</button>');
        parts.push('</div>');
        const draft = app.draftOf();
        if (draft) parts.push('<textarea class="sbr-draft" rows="9" readonly>' + this._esc(draft) + '</textarea>');
        parts.push('<label class="sbr-detail-lab">把模型的回信（JSON）贴回来</label>');
        parts.push('<textarea data-k="echo" rows="5" placeholder="回信四段：title / roleMessage / receiptNote / keywords；违反两条硬约束会被拒收"></textarea>');
        parts.push('<button type="button" data-act="accept" data-i="' + i + '">校验并入库</button>');
        parts.push('</div>');
        return parts.join("");
    }
    /* ---------- 面板 ②：跨度六档 ---------- */
    _spanPanel() {
        const app = this.app;
        const rows = app.spanRows();
        const parts = [];
        parts.push('<div class="sbr-panel">');
        parts.push('<p class="sbr-hint">六档**逐档列全**（每档带自己的天数下限与一句「心理距离」）——'
            + ' 塔成少于六档，收信口吻就会永远偏档。计数是「—」时表示读数取不出来，不是零点。'
            + '</p>');
        parts.push('<div class="sbr-rows">');
        for (const r of rows) {
            parts.push('<div class="sbr-row sbr-sp-' + r.key + '">');
            parts.push('<span class="sbr-row-k">' + this._esc(r.label) + '</span>');
            parts.push('<span class="sbr-row-floor">下限 ' + r.floorDays + ' 天</span>');
            parts.push('<span class="sbr-row-count">' + this._count(r.count) + ' 封</span>');
            parts.push('</div>');
        }
        parts.push('</div>');
        const rd = app.readings();
        parts.push('<div class="sbr-extra"><span class="sbr-extra-k">跨度取不出来</span>'
            + '<span class="sbr-extra-v">' + this._count(rd ? rd.spanUnknown : null) + ' 封（源会当成「今天封的」）</span></div>');
        parts.push('</div>');
        return parts.join("");
    }
    /* ---------- 面板 ③：口吻六族 ---------- */
    _tonePanel() {
        const app = this.app;
        const rows = app.toneRows();
        const parts = [];
        parts.push('<div class="sbr-panel">');
        parts.push('<p class="sbr-hint">六族**逐族列全**，每族带一句说话指引（写要求文本时直接用）——'
            + ' 塔成一族，所有回信就都是同一种腔。'
            + '</p>');
        parts.push('<div class="sbr-rows">');
        for (const r of rows) {
            parts.push('<div class="sbr-row sbr-tn-' + r.key + '">');
            parts.push('<span class="sbr-row-k">' + this._esc(r.label) + '</span>');
            parts.push('<span class="sbr-row-count">' + this._count(r.count) + ' 封</span>');
            parts.push('<span class="sbr-row-feel">' + this._esc(r.feel) + '</span>');
            parts.push('</div>');
        }
        parts.push('</div>');
        parts.push('</div>');
        return parts.join("");
    }
    /* ---------- 面板 ④：台账 ---------- */
    _ledgerPanel() {
        const app = this.app;
        const rows = app.receiptRows();
        const p = app.policyRow();
        const parts = [];
        parts.push('<div class="sbr-panel">');
        parts.push('<p class="sbr-hint">每收一封回信留一张回执。两条硬约束命中时**分因列出「哪一句里的哪个词」**——'
            + ' 不报位置的话用户只知道「不合格」。'
            + '</p>');
        parts.push('<div class="sbr-led-btns">');
        parts.push('<button type="button" data-act="clear-ledger">清空台账</button>');
        parts.push('<span class="sbr-led-cap">已存 ' + p.receiptCount + ' / ' + p.ledgerKeep + ' 条'
            + (p.receiptFull ? '（已达上限，新的会把最旧的顶掉）' : "") + '</span>');
        parts.push('</div>');
        parts.push('<div class="sbr-led">');
        for (let i = 0; i < rows.length; i += 1) {
            const r = rows[i];
            const tone = r.guardOk ? "ok" : "err";
            parts.push('<div class="sbr-rec sbr-rc-' + tone + '">');
            parts.push('<div class="sbr-rec-top">');
            parts.push('<span class="sbr-rec-id">' + this._esc(r.capsuleId || '（未记）') + '</span>');
            parts.push('<span class="sbr-rec-span' + (r.spanKnown ? "" : " is-unk") + '">'
                + this._esc(r.spanLabel) + (r.spanKnown && r.spanDays !== null ? '（' + r.spanDays + '天）' : "") + '</span>');
            parts.push('<span class="sbr-rec-tone">' + this._esc(r.toneLabel) + '</span>');
            parts.push('</div>');
            parts.push('<div class="sbr-rec-body">封存时间 ' + this._esc(r.created || "—")
                + (r.at ? '・回信于 ' + this._esc(r.at) : "") + '</div>');
            const fb = [];
            if (r.fellBack.title) fb.push('标题落兜底');
            if (r.fellBack.keywords) fb.push('关键词落兜底');
            if (r.fellBack.witness) fb.push('见证语落兜底');
            if (fb.length) parts.push('<div class="sbr-rec-fb">' + this._esc(fb.join(' · ')) + '（源不报，模型真写了与没写同形）</div>');
            parts.push('</div>');
        }
        if (!rows.length) {
            parts.push('<div class="sbr-led-none">'
                + (app.faceOf() === SOURCEBOOK_FACES.storage_absent ? '读不出来，不是「没写过」' : '还没有任何回执')
                + '</div>');
        }
        parts.push('</div>');
        parts.push('</div>');
        return parts.join("");
    }
    /* ---------- 面板 ⑤：策略 ---------- */
    _policyPanel() {
        const app = this.app;
        const p = app.policyRow();
        const cat = app.catalogs();
        const parts = [];
        parts.push('<div class="sbr-panel">');
        parts.push('<div class="sbr-row"><span class="sbr-row-k">台账保留数</span>');
        parts.push('<input type="number" step="1" min="1" max="' + cat.limits.maxReceipts + '" data-k="keep" value="' + p.ledgerKeep + '" />');
        parts.push('<span class="sbr-row-sub">源对回执无上限（同一个数据库键一直堆）；本仓给口，上限 ' + cat.limits.maxReceipts + '</span></div>');
        parts.push('<div class="sbr-cats">');
        parts.push('<div class="sbr-cat"><span class="sbr-cat-k">两条硬约束词库</span>'
            + '<span class="sbr-cat-v">线下 / 送礼 ' + cat.guardVocab.offline + ' 个词・压力 ' + cat.guardVocab.pressure
            + ' 个词・扫 ' + cat.guardVocab.fields + ' 个字段</span></div>');
        parts.push('<div class="sbr-cat"><span class="sbr-cat-k">见证语上限</span>'
            + '<span class="sbr-cat-v">' + cat.limits.maxReceiptWitness + ' 字（超了截断）</span></div>');
        parts.push('<div class="sbr-cat"><span class="sbr-cat-k">其余上限</span>'
            + '<span class="sbr-cat-v">书架 ' + cat.limits.maxCapsules + ' 封・标题 ' + cat.limits.maxTitle
            + ' 字・正文 ' + cat.limits.maxMessage + ' 字・关键词 ' + cat.limits.maxKeywords + ' 个</span></div>');
        parts.push('<div class="sbr-cat"><span class="sbr-cat-k">心情兜底键</span>'
            + '<span class="sbr-cat-v">' + this._esc(cat.moodFallback) + '（只用于展示；未填一律报「未填」）</span></div>');
        parts.push('</div>');
        parts.push('<p class="sbr-hint">本件**零网络、零密钥**：源自己从浏览器本地存储读模型地址与密钥、'
            + '并自己拼请求；本件只产「可复制的要求文本」与「回信校验」。</p>');
        parts.push('</div>');
        return parts.join("");
    }
    /* ---------- 事件 ---------- */
    _field(k) { const el = this._q('[data-k="' + k + '"]'); return el ? String(el.value || "") : ""; }
    _act(act, el) {
        const app = this.app;
        const i = el ? Number(el.getAttribute('data-i')) : -1;
        if (act === 'seal') {
            const r = app.seal({
                message: this._field('message'),
                openDate: this._field('openDate'),
                createdAt: this._field('createdAt'),
                mood: this._field('mood'),
                roleId: this._field('roleId')
            });
            this._flash = r.ok ? '存下了（书架已刷新）' : this._sealWhy(r);
        } else if (act === 'open') {
            const r = app.openCapsule(i);
            this._flash = r.ok ? '看这一封' : '找不到这一封';
        } else if (act === 'close') {
            app.closeCapsule();
            this._flash = "";
        } else if (act === 'unseal') {
            const r = app.unseal(i);
            this._flash = r.ok ? ('撤掉了，还剩 ' + r.left + ' 封') : '找不到这一封';
        } else if (act === 'build') {
            const r = app.buildRequest(i);
            this._flash = r.ok ? ('要求文本已产（扫 ' + r.guardWords.fields + ' 个字段）') : this._buildWhy(r);
        } else if (act === 'accept') {
            const r = app.acceptEcho(i, this._field('echo'));
            this._flash = r.ok ? this._acceptWhy(r) : this._rejectWhy(r);
        } else if (act === 'clear-ledger') {
            app.clearLedger();
            this._flash = '台账清空了';
        }
        this.refresh();
    }
    /** 产要求文本被拒的原因（只有「这一封已经不在了」一种）。 */
    _buildWhy(r) {
        if (r.reason === 'out_of_range') return '这一封已经不在了（书架被撤过，或换过会话）';
        return '产不了：' + r.reason;
    }
    /** 封存被拒的四种原因各自说清（不许塔成一句「存不下」）。 */
    _sealWhy(r) {
        if (r.reason === 'no_message') return '正文是空的，写点什么再存';
        if (r.reason === 'bad_open_date') return '拆开日期认不出来（' + (r.why || "") + '），要 YYYY-MM-DD';
        if (r.reason === 'bad_created_at') return '封存时间「' + (r.saw || "") + '」既不是日期也不是日序号';
        if (r.reason === 'over_max') return '书架满了（上限 ' + r.max + ' 封）';
        return '存不下：' + r.reason;
    }
    _acceptWhy(r) {
        const fb = [];
        if (r.fellBack.title) fb.push('标题');
        if (r.fellBack.keywords) fb.push('关键词');
        if (r.fellBack.witness) fb.push('见证语');
        return '入库了（跨度 ' + (r.span.known ? r.span.label : SPAN_UNKNOWN_LABEL) + '）'
            + (fb.length ? ('；' + fb.join('与') + '落兜底') : "");
    }
    /** 拒收回信：分因 + 命中位置（哪个字段里的哪个词）。 */
    _rejectWhy(r) {
        if (r.reason === 'empty_input') return '还没贴东西';
        if (r.reason === 'bad_json') return '不是合法 JSON';
        if (r.reason === 'not_object') return 'JSON 顶层要是一个对象';
        if (r.reason === 'guard') {
            const g = r.guard || { hits: [] };
            const list = (g.hits || []).map((h) => ('「' + h.field + '」里的「' + h.word + '」'));
            return list.length ? ('碰了硬约束：' + list.join('、')) : '碰了硬约束';
        }
        return '收不了：' + r.reason;
    }
    _bindEvents() {
        const root = this._root;
        if (!root) return;
        /* 点击分派：三个面各走一遍「从命中元素**向上找最近的带标记祖先**」。
         *  ★ 修前的实缺陷：卡片判定读 ev.target.className，点卡片里的**正文文字**时
         *    target 是子元素（sbr-cap-msg 等），判定落空 ⇒ 用户点正文没反应，
         *    必顶点卡片留白才打开。向上找最近祖先才不会漏。
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
                this._flash = "";
                this.refresh();
                return;
            }
            const actEl = climb(t, (n) => n.getAttribute('data-act'));
            if (actEl) { this._act(actEl.getAttribute('data-act'), actEl); return; }
            const cardEl = climb(t, (n) => n.getAttribute('data-open') !== null);
            if (cardEl) {
                this.app.openCapsule(Number(cardEl.getAttribute('data-open')));
                this._flash = "";
                this.refresh();
            }
        });
        root.addEventListener('change', (e) => {
            const t = e.target;
            if (!t || !t.getAttribute) return;
            if (t.getAttribute('data-k') === 'keep') {
                const r = this.app.setLedgerKeep(t.value);
                this._flash = (r.saw === r.took)
                    ? ('台账最多留 ' + r.took + ' 条')
                    : ('「' + r.saw + '」不收，仍按 ' + r.took + ' 条');
                this.refresh();
            }
        });
    }
}
