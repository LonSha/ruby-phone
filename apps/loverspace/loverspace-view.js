/* ========================================================
 * loverspace-view.js — [v3.30.0] 恋爱空间 App 视图
 * 归因卡 + 天数面（起算日 / 今日足迹）+ 日记面（日历 / 心情罐子 / 记一天）+ 情书 + 问答 + 设置
 *
 * 与 taobao-view / shop-view 同纪律：归因文案表的键取 LOVER_REASONS 的**值**。
 * 本视图**只画与派事件**：一切数据变动都回调到 App 的方法上（App 负责纯函数 + 落盘）。
 *
 * 四处「不糊弄」：
 *   · 两条面的切换是**显式的**（`_face` 是视图态，不是数据态）—— 天数与日记是两件事，
 *     挤在一屏里会让「今天几条足迹」和「今天记了什么心情」看起来像同一栏；
 *   · 足迹画的是**到点显形后**的那几条，没到点的**如实报数**（`还有 N 条没到点`），
 *     不静默吞、也不提前剧透；
 *   · 情书分「我寄的 / Ta 寄的」，回信按钮只出现在**来信**上（回自己的信没有去处）；
 *   · 问答三态各画各的（等你答 / 等 Ta 答 / 已答），不许塌成两态。
 * ======================================================== */
'use strict';
import { LOVER_REASONS, LOVER_LIMITS, QUESTION_STATES } from './loverspace-data.js';

/* 两个显示助手：与数据层同源（都只看毫秒与 Date），不 imports App —— 免得 App<->View 成环。 */
function agoText(ms) {
    const n = Number(ms);
    if (!Number.isFinite(n)) return '';
    const d = Math.max(0, Date.now() - n);
    const s2 = Math.floor(d / 1000);
    if (s2 < 60) return '刚刚';
    const m = Math.floor(s2 / 60);
    if (m < 60) return m + ' 分钟前';
    const h = Math.floor(m / 60);
    if (h < 24) return h + ' 小时前';
    const dy = Math.floor(h / 24);
    if (dy < 30) return dy + ' 天前';
    const dt = new Date(n);
    const p = (x) => String(x).padStart(2, '0');
    return p(dt.getMonth() + 1) + '-' + p(dt.getDate()) + ' ' + p(dt.getHours()) + ':' + p(dt.getMinutes());
}

/** 「第 N 天」的人话（与数据层 daysTogether 的口径对齐：没有就是「还没记录第一天」）。 */
function dayLabel(n) {
    const val = Number(n);
    return Number.isFinite(val) ? ('第 ' + val + ' 天') : '还没记录第一天';
}

const FACE_META = {
    [LOVER_REASONS.ready]: { icon: '\u2705', label: '恋爱空间开着', tone: 'ok' },
    [LOVER_REASONS.empty]: { icon: '\u{1f49e}', label: '这个会话还什么都没记', tone: 'warn' },
    [LOVER_REASONS.storage_absent]: { icon: '\u26a0\ufe0f', label: '存储不可用（读数拿不到）', tone: 'err' },
};

const FACE_TABS = [
    { key: 'days', label: '天数 · 足迹' },
    { key: 'diary', label: '日记 · 心情' },
];

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];

export class LoverSpaceView {
    constructor(app, shell, storage) {
        this.app = app;
        this.shell = shell;
        this.storage = storage;
        this._root = null;
        this._face = 'days';
        this._draft = { start: '', foot: '', letter: '', incoming: '', question: '', askByChar: '', answer: {} };
        this._replyTo = '';
        this._diaryDay = '';
        this._cursor = null;   // { y, m }
        this._pendingConfirm = '';
        this._flash = '';
        this._viewDay = '';    // 足迹面板看的是哪一天（空 = 今天）
        this._focusDiary = ''; // 日记面板展开的那一格
    }

    render() {
        const container = this.shell && this.shell.getContentContainer ? this.shell.getContentContainer() : null;
        if (!container) return;
        container.innerHTML = '';
        this._root = document.createElement('div');
        this._root.className = 'lov-root';
        this._root.innerHTML = this._buildHTML();
        container.appendChild(this._root);
        this._bindEvents();
    }

    refresh() {
        if (!this._root) return;
        this._root.innerHTML = this._buildHTML();
        this._bindEvents();
    }

    _buildHTML() {
        const app = this.app;
        const face = app.faceReason();
        const meta = FACE_META[face] || { icon: '\u2753', label: '未识别的状态：' + String(face), tone: 'warn' };
        const proj = app.projection() || {
            hasAny: false, startDate: null, daysTogether: null, todayDateStr: '', todayFootprintCount: 0,
            todayShownCount: 0, todayHiddenCount: 0, footprintsDropped: 0, footprintsOverCap: 0, nextFootprint: null,
            diaryDays: 0, monthDiaryCount: 0, moodJarCount: 0, questionCount: 0,
            awaitingChar: 0, awaitingUser: 0, answered: 0, letterCount: 0, lettersDropped: 0, lastLetterAt: null,
        };
        const limits = app.limits();
        const parts = [];

        parts.push('<div class="lov-header"><h2>\u{1f49e} 恋爱空间</h2>'
            + '<span class="lov-header-day">' + this._esc(app.todayLabel()) + '</span></div>');

        parts.push('<div class="lov-face lov-face-' + meta.tone + '">');
        parts.push('<span class="lov-face-icon">' + meta.icon + '</span>');
        parts.push('<span class="lov-face-label">' + this._esc(meta.label) + '</span>');
        parts.push('</div>');

        if (this._flash) parts.push('<div class="lov-flash">' + this._esc(this._flash) + '</div>');

        /* 两面的「这一面有什么」—— App 层同一份口径（faceSummary）。 */
        parts.push('<div class="lov-tabs">');
        for (const t of FACE_TABS) {
            parts.push('<button class="lov-tab' + (this._face === t.key ? ' is-on' : '') + '" data-face="' + t.key + '">');
            parts.push('<span class="lov-tab-label">' + this._esc(t.label) + '</span>');
            parts.push('<span class="lov-tab-sub">' + this._esc(app.faceOf(t.key)) + '</span>');
            parts.push('</button>');
        }
        parts.push('</div>');

        if (this._face === 'days') parts.push(this._daysPanel(proj, limits));
        else parts.push(this._diaryPanel(proj, limits));

        /* 情书与问答是**两面共用**的（它们不属于「哪一面」，是这段关系本身）。 */
        parts.push(this._lettersPanel(limits));
        parts.push(this._questionsPanel(proj, limits));
        parts.push(this._settingsPanel(limits));

        return parts.join('\n');
    }

    /* ---------- 天数面 ---------- */

    _daysPanel(proj, limits) {
        const app = this.app;
        const parts = [];
        parts.push('<div class="lov-days">');
        parts.push('<div class="lov-bigday">');
        parts.push('<span class="lov-bigday-num">' + (proj.daysTogether === null ? '\u2014' : proj.daysTogether) + '</span>');
        parts.push('<span class="lov-bigday-unit">' + (proj.daysTogether === null ? '还没记录第一天' : '天') + '</span>');
        if (proj.startDate) parts.push('<span class="lov-bigday-from">从 ' + this._esc(proj.startDate) + ' 起算</span>');
        parts.push('</div>');

        parts.push('<div class="lov-startrow">');
        parts.push('<input class="lov-input lov-input-date" id="lov-start" type="text" placeholder="YYYY-MM-DD" value="'
            + this._esc(proj.startDate || this._draft.start) + '">');
        parts.push('<button class="lov-btn lov-btn-primary" id="lov-start-set">记下第一天</button>');
        if (proj.startDate) parts.push('<button class="lov-mini" id="lov-start-clear">清</button>');
        parts.push('</div>');
        parts.push('<div class="lov-hint">源的口径是**首日即第 1 天**（`diffDays + 1`，且用 UTC 日期串 —— '
            + '东八区凌晨那几小时会被算到昨天，故本件一律取本地日期）。起算日在未来 ⇒ 一律当「还没记录」，不出现负数。</div>');

        /* 今日足迹 */
        const vis = app.visibleToday();
        parts.push('<h3 class="lov-list-title">今日足迹（' + vis.visible.length + ' / ' + vis.total + '）</h3>');
        if (proj.nextFootprint) {
            parts.push('<div class="lov-next">下一件：' + this._esc(proj.nextFootprint.description)
                + '<span class="lov-next-when">' + this._esc(proj.nextFootprint.time) + ' · 还要 '
                + this._esc(this._dur(proj.nextFootprint.inMs)) + '</span></div>');
        }
        if (!vis.visible.length) {
            parts.push('<div class="lov-empty">今天还没有足迹。</div>');
        } else {
            parts.push('<div class="lov-footline">');
            for (const f of vis.visible) {
                parts.push('<div class="lov-foot">');
                parts.push('<span class="lov-foot-time">' + this._esc(f.time) + '</span>');
                parts.push('<span class="lov-foot-icon">' + this._esc(f.icon || '') + '</span>');
                parts.push('<span class="lov-foot-desc">' + this._esc(f.description) + '</span>');
                if (f.duration) parts.push('<span class="lov-foot-dur">' + this._esc(f.duration) + '</span>');
                parts.push('</div>');
                /* HTML 小剧场：源直接 innerHTML。本件**只当文本留存**，缩在折叠里看。 */
                if (f.snippet) {
                    parts.push('<details class="lov-snippet"><summary>小剧场（按文本留存，不解析 HTML）</summary>'
                        + '<pre class="lov-snippet-body">' + this._esc(f.snippet) + '</pre></details>');
                }
            }
            parts.push('</div>');
        }
        if (vis.hidden) {
            parts.push('<div class="lov-note">还有 ' + vis.hidden + ' 条**没到点**（到点自己会显形，不用刷新界面）。</div>');
        }
        if (proj.footprintsOverCap) {
            parts.push('<div class="lov-warn">今天超过上限 ' + limits.maxFootprintsPerDay + ' 条，多的 '
                + proj.footprintsOverCap + ' 条没画（已如实计数，没有静默丢）。</div>');
        }
        if (proj.footprintsDropped) {
            parts.push('<div class="lov-warn">有 ' + proj.footprintsDropped + ' 条时间认不出来，没存。</div>');
        }

        parts.push('<h3 class="lov-list-title">登记今天</h3>');
        parts.push('<textarea class="lov-input lov-textarea" id="lov-foot" rows="4" placeholder="一行一条：08:30 起床\\n12:00 一起吃了拉面">'
            + this._esc(this._draft.foot) + '</textarea>');
        parts.push('<div class="lov-actions">');
        parts.push('<button class="lov-btn lov-btn-primary" id="lov-foot-save">登记</button>');
        parts.push('<button class="lov-mini" id="lov-foot-force">覆盖今天</button>');
        parts.push('<button class="lov-mini" id="lov-foot-clear">清空今天</button>');
        parts.push('</div>');
        parts.push('<div class="lov-hint">源的「今日足迹」是**让模型现编一整天**（直连 /v1/chat/completions，'
            + '解析失败整块丢）。本件把它拆开：生成那一半交回宿主，这里只收「行文本」——'
            + '认得出的留下，认不出的**如实报数**。同一天默认只能登记一次（源的门规），想再记点「覆盖今天」。</div>');
        parts.push('</div>');
        return parts.join('\n');
    }

    /* ---------- 日记面 ---------- */

    _diaryPanel(proj, limits) {
        const app = this.app;
        const parts = [];
        const cur = this._cursorOf(proj);
        const grid = app.gridOf(cur.y, cur.m);
        const jar = app.jarOf(cur.y, cur.m);

        parts.push('<div class="lov-diary">');
        parts.push('<div class="lov-month-head">');
        parts.push('<button class="lov-mini" id="lov-m-prev">\u2039</button>');
        parts.push('<span class="lov-month-label">' + grid.year + ' 年 ' + grid.month + ' 月</span>');
        parts.push('<button class="lov-mini" id="lov-m-next">\u203a</button>');
        parts.push('<span class="lov-month-stat">本月 ' + proj.monthDiaryCount + ' 天 · 心情 ' + jar.count + ' 个</span>');
        parts.push('</div>');

        parts.push('<div class="lov-week">');
        for (const w of WEEKDAYS) parts.push('<span class="lov-week-cell">' + w + '</span>');
        parts.push('</div>');
        parts.push('<div class="lov-grid">');
        for (const c of grid.cells) {
            if (!c) { parts.push('<span class="lov-cell is-blank"></span>'); continue; }
            const cls = 'lov-cell' + (c.hasDiary ? ' has-diary' : '') + (c.isToday ? ' is-today' : '')
                + (this._focusDiary === c.dateStr ? ' is-focus' : '');
            parts.push('<button class="' + cls + '" data-day="' + this._esc(c.dateStr) + '">');
            parts.push('<span class="lov-cell-num">' + c.day + '</span>');
            parts.push('<span class="lov-cell-emo">' + this._esc((c.userEmoji || '') + (c.charEmoji || '')) + '</span>');
            parts.push('</button>');
        }
        parts.push('</div>');

        /* 心情罐子 */
        parts.push('<div class="lov-jar">');
        parts.push('<span class="lov-jar-title">心情罐子</span>');
        if (!jar.count) parts.push('<span class="lov-jar-empty">这个月一个心情都没记</span>');
        else {
            parts.push('<span class="lov-jar-items">');
            for (const e of jar.emojis) parts.push('<span class="lov-jar-item">' + this._esc(e) + '</span>');
            parts.push('</span>');
        }
        parts.push('</div>');
        parts.push('<div class="lov-hint">源的罐子按对象键序平铺（`for…in` —— 换台机器顺序就变），'
            + '本件显式按日期串升序；每个日期先你的、再 Ta 的。</div>');

        /* 那一天 */
        const day = this._focusDiary || proj.todayDateStr;
        const entry = app.diaryOf(day);
        parts.push('<h3 class="lov-list-title">' + this._esc(day) + (app.hasDiaryOn(day) ? '（记过）' : '（空着）') + '</h3>');
        if (app.hasDiaryOn(day)) {
            parts.push('<div class="lov-dayentry">');
            parts.push('<div class="lov-dayentry-side"><span class="lov-dayentry-who">我</span>'
                + '<span class="lov-dayentry-emo">' + this._esc(entry.userEmoji || '\u2014') + '</span>'
                + '<span class="lov-dayentry-txt">' + this._esc(entry.userDiary || '（没写）') + '</span></div>');
            parts.push('<div class="lov-dayentry-side"><span class="lov-dayentry-who">Ta</span>'
                + '<span class="lov-dayentry-emo">' + this._esc(entry.charEmoji || '\u2014') + '</span>'
                + '<span class="lov-dayentry-txt">' + this._esc(entry.charDiary || '（没写）') + '</span></div>');
            parts.push('</div>');
        }
        parts.push('<textarea class="lov-input lov-textarea" id="lov-diary" rows="4" '
            + 'placeholder="我：\u{1f324}\uFE0F\\n今天挺好的\\nTa：\u{1f327}\uFE0F\\n他有点累"></textarea>');
        parts.push('<div class="lov-actions">');
        parts.push('<button class="lov-btn lov-btn-primary" id="lov-diary-save" data-day="' + this._esc(day) + '">记这一天</button>');
        if (app.hasDiaryOn(day)) parts.push('<button class="lov-mini" id="lov-diary-del" data-day="' + this._esc(day) + '">擦掉</button>');
        parts.push('</div>');
        parts.push('<div class="lov-hint">认得出 `我：` / `Ta：` 两个块就分开存；认不出就**整段当你的日记**'
            + '（不因为格式不合把你写的东西吃掉）。空串一律归一成「没记」——「没记」不等于「记了空」，'
            + '否则日历上会出现有格子却点不进去的日子。</div>');
        if (app.expiredDays().diaryDays) {
            parts.push('<div class="lov-warn">日记库超过 ' + limits.maxDiaryDays + ' 天，最老的 '
                + app.expiredDays().diaryDays + ' 天没再留。</div>');
        }
        parts.push('</div>');
        return parts.join('\n');
    }

    _cursorOf(proj) {
        if (this._cursor) return this._cursor;
        const ds = proj.todayDateStr || '';
        const m = /^(\d{4})-(\d{2})/.exec(ds);
        const now = new Date();
        const cur = m ? { y: Number(m[1]), m: Number(m[2]) } : { y: now.getFullYear(), m: now.getMonth() + 1 };
        this._cursor = cur;
        return cur;
    }

    /* ---------- 情书 ---------- */

    _lettersPanel(limits) {
        const app = this.app;
        const letters = app.lettersList();
        const names = app.names();
        const parts = [];
        parts.push('<div class="lov-letters">');
        parts.push('<h3 class="lov-list-title">情书（' + letters.length + '）</h3>');
        if (!letters.length) {
            parts.push('<div class="lov-empty">还没有信。先随便写一封给 Ta（或者把 Ta 写来的贴进「记一封来信」）。</div>');
        } else {
            for (const l of letters.slice().reverse()) {
                const mine = String(l.senderId || 'user') === 'user';
                parts.push('<div class="lov-letter' + (mine ? ' is-mine' : ' is-theirs') + '">');
                parts.push('<div class="lov-letter-head">');
                parts.push('<span class="lov-letter-who">' + this._esc(l.senderName || (mine ? names.myName : 'Ta'))
                    + ' \u2192 ' + this._esc(l.recipientName || (mine ? 'Ta' : names.myName)) + '</span>');
                parts.push('<span class="lov-letter-when">' + this._esc(agoText(l.timestamp)) + '</span>');
                parts.push('</div>');
                parts.push('<div class="lov-letter-body">' + this._esc(l.content) + '</div>');
                parts.push('<div class="lov-letter-actions">');
                /* 回信按钮**只出现在来信上** —— 回自己的信没有去处（数据层会拒 self-reply）。 */
                if (!mine) {
                    parts.push('<button class="lov-mini lov-letter-reply" data-id="' + this._esc(l.id) + '">回信</button>');
                }
                if (l.replyToId) parts.push('<span class="lov-letter-rep">回信</span>');
                parts.push('<button class="lov-mini lov-letter-del" data-id="' + this._esc(l.id) + '">删</button>');
                parts.push('</div>');
                parts.push('</div>');
            }
        }

        if (this._replyTo) {
            const rep = letters.find((l) => l.id === this._replyTo);
            parts.push('<div class="lov-repin">回 ' + this._esc(rep ? rep.senderName : '？') + ' 的信 '
                + '<button class="lov-mini" id="lov-reply-cancel">取消</button></div>');
        }
        parts.push('<textarea class="lov-input lov-textarea" id="lov-letter" rows="3" placeholder="'
            + (this._replyTo ? '写回信…' : '写一封信给 Ta（首行可写「致：谁」）') + '">' + this._esc(this._draft.letter) + '</textarea>');
        parts.push('<div class="lov-actions">');
        parts.push('<button class="lov-btn lov-btn-primary" id="lov-letter-send">' + (this._replyTo ? '寄回信' : '寄出') + '</button>');
        parts.push('<button class="lov-mini" id="lov-letter-incoming">记一封来信</button>');
        parts.push('<button class="lov-mini" id="lov-letter-clearall">清空</button>');
        parts.push('</div>');
        if (this._showIncoming) {
            parts.push('<textarea class="lov-input lov-textarea" id="lov-incoming" rows="3" placeholder="把 Ta 写来的原话贴在这里 —— 存成「Ta 寄给你」的一封">'
                + this._esc(this._draft.incoming) + '</textarea>');
            parts.push('<div class="lov-actions"><button class="lov-btn" id="lov-incoming-save">存下来信</button></div>');
        }
        parts.push('<div class="lov-hint">★ 源的回信是**收发对调**的（`senderName` 换成我、`recipientName` 取原信的发信人）——'
            + '方向错了在界面上完全看不出来。本件照做，但加一道门：**回自己的信直接拒收**（那会产出「我 → 我」的怪信）。'
            + '另外源靠往 `chat.history` 塞隐藏消息驱动模型写信 —— 本件不替宿主写楼层。</div>');
        parts.push('</div>');
        return parts.join('\n');
    }

    /* ---------- 问答 ---------- */

    _questionsPanel(proj, limits) {
        const app = this.app;
        const qs = app.questionsList();
        const states = app.states();
        const parts = [];
        parts.push('<div class="lov-qs">');
        parts.push('<h3 class="lov-list-title">提问与回答（' + qs.length + '）</h3>');
        parts.push('<div class="lov-qstat">等你答 <strong>' + proj.awaitingChar + '</strong> · 等 Ta 答 <strong>'
            + proj.awaitingUser + '</strong> · 已答 <strong>' + proj.answered + '</strong></div>');
        if (!qs.length) {
            parts.push('<div class="lov-empty">还没有问答。</div>');
        } else {
            for (const q of qs.slice().reverse()) {
                const state = (String(q.answerText || '').trim())
                    ? states.answered
                    : (String(q.answerer || '') === 'user' ? states.awaiting_user : states.awaiting_char);
                const tone = state === states.answered ? 'done' : (state === states.awaiting_user ? 'mine' : 'theirs');
                parts.push('<div class="lov-q lov-q-' + tone + '">');
                parts.push('<div class="lov-q-head">');
                parts.push('<span class="lov-q-by">' + (q.questioner === 'char' ? 'Ta 问' : '我问') + '</span>');
                parts.push('<span class="lov-q-when">' + this._esc(agoText(q.timestamp)) + '</span>');
                parts.push('</div>');
                parts.push('<div class="lov-q-text">' + this._esc(q.questionText) + '</div>');
                if (state === states.answered) {
                    parts.push('<div class="lov-q-ans"><span class="lov-q-ansby">'
                        + (q.answerer === 'char' ? 'Ta' : '我') + '答</span>' + this._esc(q.answerText) + '</div>');
                } else {
                    const mineTurn = (state === states.awaiting_user);
                    parts.push('<div class="lov-q-wait">' + (mineTurn ? '等你回答' : '等 Ta 回答') + '</div>');
                    if (mineTurn) {
                        parts.push('<div class="lov-q-reply">');
                        parts.push('<input class="lov-input lov-input-inline" data-qid="' + this._esc(q.id)
                            + '" placeholder="写回答…" value="' + this._esc(this._draft.answer[q.id] || '') + '">');
                        parts.push('<button class="lov-mini lov-q-answer" data-id="' + this._esc(q.id) + '" data-by="user">答</button>');
                        parts.push('</div>');
                    }
                }
                parts.push('<div class="lov-q-actions">');
                if (state !== states.answered) {
                    /* 替 Ta 答：写入一侧的显式出口（源是模型自答，本件把它交给用户手动填）。 */
                    if (state === states.awaiting_char) {
                        parts.push('<input class="lov-input lov-input-inline" data-qid="' + this._esc(q.id)
                            + '" placeholder="Ta 的回答…" value="' + this._esc(this._draft.answer[q.id] || '') + '">');
                        parts.push('<button class="lov-mini lov-q-answer" data-id="' + this._esc(q.id) + '" data-by="char">记成 Ta 答的</button>');
                    }
                }
                parts.push('<button class="lov-mini lov-q-del" data-id="' + this._esc(q.id) + '">删</button>');
                parts.push('</div>');
                parts.push('</div>');
            }
        }
        parts.push('<textarea class="lov-input lov-textarea" id="lov-q" rows="2" placeholder="问 Ta 一个问题…">' + this._esc(this._draft.question) + '</textarea>');
        parts.push('<div class="lov-actions">');
        parts.push('<button class="lov-btn lov-btn-primary" id="lov-q-ask">问 Ta</button>');
        parts.push('<button class="lov-mini" id="lov-q-by-char">记一个 Ta 问我的</button>');
        parts.push('</div>');
        if (this._showAskByChar) {
            parts.push('<textarea class="lov-input lov-textarea" id="lov-q-char" rows="2" placeholder="Ta 问你的问题…">'
                + this._esc(this._draft.askByChar) + '</textarea>');
            parts.push('<div class="lov-actions"><button class="lov-btn" id="lov-q-char-save">存下来</button></div>');
        }
        parts.push('<div class="lov-hint">★ 源的三态里，「等 Ta 答」与「等你答」是两种不同的事实（不许塌成两态）。'
            + '源的回答是**直接改字段**（谁都能覆盖谁的答复），本件把它变成一次有裁定的事务：'
            + '已答过的再答、或替对方答，一律拒收并说明原因。源提问后往 `chat.history` 塞隐藏系统消息去驱动模型 —— 本件不写历史。</div>');
        parts.push('</div>');
        return parts.join('\n');
    }

    /* ---------- 设置 ---------- */

    _settingsPanel(limits) {
        const s = this.app.settings;
        const parts = [];
        parts.push('<div class="lov-settings">');
        parts.push('<h3 class="lov-list-title">设置</h3>');
        parts.push('<label class="lov-toggle"><span>把「第几天 / 今天几条足迹」交给生成侧</span>'
            + '<input type="checkbox" id="lov-inject"' + (s.injectToPrompt ? ' checked' : '') + '></label>');
        parts.push('<label class="lov-field"><span>注入时带几条</span>'
            + '<input type="number" id="lov-max-inject" min="0" max="20" value="' + s.maxInjectLines + '"></label>');
        parts.push('<label class="lov-toggle"><span>足迹到点才显形</span>'
            + '<input type="checkbox" id="lov-reveal"' + (s.revealByTime ? ' checked' : '') + '></label>');
        parts.push('<label class="lov-toggle"><span>一天只登记一次足迹</span>'
            + '<input type="checkbox" id="lov-once"' + (s.oncePerDay ? ' checked' : '') + '></label>');
        parts.push('<div class="lov-hint">「到点显形」是源的行为：`activities.filter(act => act.timestamp &lt;= now)`。'
            + '关掉就是一整天一次画全（写复盘的时候好用）。上限：足迹一天 ' + limits.maxFootprintsPerDay + ' 条、'
            + '日记 ' + limits.maxDiaryDays + ' 天、情书 ' + limits.maxLetters + ' 封、问答 ' + limits.maxQuestions + ' 条 —— '
            + '源全都没有顶，长会话下是无上界增长。</div>');
        parts.push('</div>');
        return parts.join('\n');
    }

    /* ---------- 事件 ---------- */

    _bindEvents() {
        if (!this._root) return;
        const app = this.app;
        const q = (sel) => this._root.querySelector(sel);

        /* 面切换 */
        for (const b of this._root.querySelectorAll('.lov-tab')) {
            b.addEventListener('click', () => { this._face = b.dataset.face; this.refresh(); });
        }

        /* 天数面 */
        const startInput = q('#lov-start');
        if (startInput) startInput.addEventListener('input', () => { this._draft.start = startInput.value; });
        const startSet = q('#lov-start-set');
        if (startSet) startSet.addEventListener('click', () => {
            const v = (q('#lov-start') && q('#lov-start').value) || this._draft.start;
            const r = app.setStartDate(v);
            this._flash = r.ok ? ('记下了：' + dayLabel(r.days)) : (r.error || '记不下来');
            this.refresh();
        });
        const startClear = q('#lov-start-clear');
        if (startClear) startClear.addEventListener('click', () => {
            if (this._needConfirm('lov-start', startClear)) return;
            app.clearStartDate();
            this._flash = '起算日清掉了';
            this.refresh();
        });

        const foot = q('#lov-foot');
        if (foot) foot.addEventListener('input', () => { this._draft.foot = foot.value; });
        const footSave = q('#lov-foot-save');
        if (footSave) footSave.addEventListener('click', () => {
            const r = app.registerFootprints(this._draft.foot, false);
            if (!r.ok) { this._flash = r.error || '存不下'; this.refresh(); return; }
            this._flash = '存下 ' + r.count + ' 条' + (r.skipped ? ('（' + r.skipped + ' 行认不出来，没存）') : '');
            this._draft.foot = '';
            this.refresh();
        });
        const footForce = q('#lov-foot-force');
        if (footForce) footForce.addEventListener('click', () => {
            const r = app.registerFootprints(this._draft.foot, true);
            if (!r.ok) { this._flash = r.error || '存不下'; this.refresh(); return; }
            this._flash = '覆盖了今天：' + r.count + ' 条';
            this._draft.foot = '';
            this.refresh();
        });
        const footClear = q('#lov-foot-clear');
        if (footClear) footClear.addEventListener('click', () => {
            if (this._needConfirm('lov-footclear', footClear)) return;
            app.clearToday();
            this._flash = '今天的足迹清空了';
            this.refresh();
        });

        /* 日记面 */
        const prev = q('#lov-m-prev');
        if (prev) prev.addEventListener('click', () => { this._shiftMonth(-1); });
        const next = q('#lov-m-next');
        if (next) next.addEventListener('click', () => { this._shiftMonth(1); });
        for (const b of this._root.querySelectorAll('.lov-cell[data-day]')) {
            b.addEventListener('click', () => { this._focusDiary = b.dataset.day; this.refresh(); });
        }
        const diarySave = q('#lov-diary-save');
        if (diarySave) diarySave.addEventListener('click', () => {
            const v = q('#lov-diary') ? q('#lov-diary').value : '';
            const r = app.saveDiary(v, diarySave.dataset.day);
            this._flash = r.ok ? ('记下了这一天' + (r.parsed ? '（我 / Ta 分开存）' : '（整段当你的日记）')) : (r.error || '存不下');
            this.refresh();
        });
        const diaryDel = q('#lov-diary-del');
        if (diaryDel) diaryDel.addEventListener('click', () => {
            if (this._needConfirm('lov-diarydel', diaryDel)) return;
            const r = app.removeDiary(diaryDel.dataset.day);
            this._flash = r.ok ? '这一天擦掉了' : (r.error || '擦不掉');
            this.refresh();
        });

        /* 情书 */
        const letter = q('#lov-letter');
        if (letter) letter.addEventListener('input', () => { this._draft.letter = letter.value; });
        const send = q('#lov-letter-send');
        if (send) send.addEventListener('click', () => {
            const v = q('#lov-letter') ? q('#lov-letter').value : this._draft.letter;
            const r = app.writeLetter(v, this._replyTo);
            this._flash = r.ok ? (r.reply ? '回信寄出去了' : '信寄出去了') : (r.error || '寄不出去');
            if (r.ok) { this._draft.letter = ''; this._replyTo = ''; }
            this.refresh();
        });
        for (const b of this._root.querySelectorAll('.lov-letter-reply')) {
            b.addEventListener('click', () => { this._replyTo = b.dataset.id; this.refresh(); });
        }
        const replyCancel = q('#lov-reply-cancel');
        if (replyCancel) replyCancel.addEventListener('click', () => { this._replyTo = ''; this.refresh(); });
        for (const b of this._root.querySelectorAll('.lov-letter-del')) {
            b.addEventListener('click', () => {
                const r = app.removeLetter(b.dataset.id);
                this._flash = r.ok ? '信删了' : (r.error || '删不掉');
                this.refresh();
            });
        }
        const incomingBtn = q('#lov-letter-incoming');
        if (incomingBtn) incomingBtn.addEventListener('click', () => { this._showIncoming = !this._showIncoming; this.refresh(); });
        const incomingSave = q('#lov-incoming-save');
        if (incomingSave) incomingSave.addEventListener('click', () => {
            const v = q('#lov-incoming') ? q('#lov-incoming').value : '';
            const r = app.recordIncoming(v);
            this._flash = r.ok ? ('存下了 ' + (r.from || 'Ta') + ' 的信') : (r.error || '存不下');
            if (r.ok) { this._draft.incoming = ''; this._showIncoming = false; }
            this.refresh();
        });
        const clearAll = q('#lov-letter-clearall');
        if (clearAll) clearAll.addEventListener('click', () => {
            if (this._needConfirm('lov-clearletters', clearAll)) return;
            const r = app.clearLetters();
            this._flash = r.removed ? ('清掉了 ' + r.removed + ' 封') : '本来就是空的';
            this.refresh();
        });

        /* 问答 */
        const ask = q('#lov-q-ask');
        if (ask) ask.addEventListener('click', () => {
            const v = q('#lov-q') ? q('#lov-q').value : '';
            const r = app.ask(v);
            this._flash = r.ok ? ('问了' + (r.charName ? (' ' + r.charName) : ' Ta')) : (r.error || '问不出去');
            this.refresh();
        });
        const byChar = q('#lov-q-by-char');
        if (byChar) byChar.addEventListener('click', () => { this._showAskByChar = !this._showAskByChar; this.refresh(); });
        const byCharSave = q('#lov-q-char-save');
        if (byCharSave) byCharSave.addEventListener('click', () => {
            const v = q('#lov-q-char') ? q('#lov-q-char').value : '';
            const r = app.askByChar(v);
            this._flash = r.ok ? '记下了' : (r.error || '存不下');
            if (r.ok) { this._showAskByChar = false; }
            this.refresh();
        });
        /* 回答输入框：回显在草稿里，免得 refresh 把打的字吃掉 */
        for (const el of this._root.querySelectorAll('.lov-input-inline')) {
            el.addEventListener('input', () => { this._draft.answer[el.dataset.qid] = el.value; });
        }
        for (const b of this._root.querySelectorAll('.lov-q-answer')) {
            b.addEventListener('click', () => {
                const id = b.dataset.id;
                const v = this._draft.answer[id] || '';
                const r = app.answer(id, b.dataset.by, v);
                this._flash = r.ok ? '答上了' : (r.error || '答不上');
                if (r.ok) delete this._draft.answer[id];
                this.refresh();
            });
        }
        for (const b of this._root.querySelectorAll('.lov-q-del')) {
            b.addEventListener('click', () => {
                const r = app.removeQuestionItem(b.dataset.id);
                this._flash = r.ok ? '删了' : (r.error || '删不掉');
                this.refresh();
            });
        }

        /* 设置 */
        const inject = q('#lov-inject');
        if (inject) inject.addEventListener('change', (e) => {
            app.settings = { ...app.settings, injectToPrompt: e.target.checked };
            app.saveSettings();
        });
        const maxInject = q('#lov-max-inject');
        if (maxInject) maxInject.addEventListener('change', (e) => app.patchSettings({ maxInjectLines: e.target.value }));
        const reveal = q('#lov-reveal');
        if (reveal) reveal.addEventListener('change', (e) => app.patchSettings({ revealByTime: e.target.checked }));
        const once = q('#lov-once');
        if (once) once.addEventListener('change', (e) => app.patchSettings({ oncePerDay: e.target.checked }));
    }

    _shiftMonth(delta) {
        const c = this._cursor || { y: new Date().getFullYear(), m: new Date().getMonth() + 1 };
        let y = c.y; let m = c.m + delta;
        if (m < 1) { m = 12; y -= 1; }
        if (m > 12) { m = 1; y += 1; }
        this._cursor = { y, m };
        this.refresh();
    }

    /** 「还要多久」（与 taobao 的 _dur 同形；两处都短，不抽公共件 —— 抽了要动别人的文件）。 */
    _dur(ms) {
        const n = Number(ms);
        if (!Number.isFinite(n) || n <= 0) return '不到 1 分钟';
        const m = Math.round(n / 60000);
        if (m < 60) return Math.max(1, m) + ' 分钟';
        const h = Math.floor(m / 60);
        const rm = m % 60;
        if (h < 24) return rm ? (h + ' 小时 ' + rm + ' 分') : (h + ' 小时');
        const d = Math.floor(h / 24);
        const rh = h % 24;
        return rh ? (d + ' 天 ' + rh + ' 小时') : (d + ' 天');
    }

    _needConfirm(key, btn) {
        if (this._pendingConfirm === key) { this._pendingConfirm = ''; return false; }
        this._pendingConfirm = key;
        if (btn) { btn.textContent = '确认'; btn.classList.add('lov-mini-armed'); }
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

/* 视图内部两个开关是**视图态**（不是数据态）：切走再回来该重来，故不进 App、不落盘。 */
LoverSpaceView.prototype._showIncoming = false;
LoverSpaceView.prototype._showAskByChar = false;