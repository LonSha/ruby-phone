/* ========================================================
 * date-view.js — [v3.31.0] 约会大作战 App 视图
 * 归因卡 + 两面（去处 / 约过的）+ 出资与钱包读数 + 结算卡 + 欠账台账 + 设置
 *
 * 与 taobao-view / loverspace-view 同纪律：归因文案表的键取 DATE_REASONS 的**值**。
 * 本视图**只画与派事件**：一切数据变动都回调到 App 的方法上（App 负责纯函数 + 落盘）。
 *
 * 四处「不糊弄」：
 *   · 出资四路是**显式的四选一**，且把「各出多少」摆在按钮上算给你看（源点完才扣）；
 *   · 钱包读数分三种：「读不到」「够」「差多少」——**不把「读不到」说成「余额不足」**；
 *   · 结算卡画的是**可核对的三件事实**（钱对得上 / 走到收场 / 有记录），
 *     不是模型报的浪漫值 / 性欲值 / 完成度那三个数；
 *   · 分享只产一段可复制的文本 —— 本视图**不往聊天里写任何东西**。
 * ======================================================== */
'use strict';
import { DATE_REASONS, FUND_MODES, RUN_PHASES } from './date-data.js';

/** HTML 转义要replace掉的「双引号」——用**字符数组 + split/join**，不写成正则字面量。
 *  ★ 本仓判据共用的剥注释器（`stripComments`）是字符状态机、**不解析正则字面量**：
 *    正则字面量里一旦出现半个引号（哪怕转义），剥器就把它当成**字符串的起头**，
 *    从那一行往后块注释再也剥不掉 —— 于是一整类「剥注释后不得出现 X」的强判据
 *    会把自己的说明文字当成消费（假红），而更坏的方向是把**真**消费剥掉（假绿）。
 *    v3.31.0 当场踩到：`_esc` 里那半行让整个 date-view 的尾随块注释失守。
 *    改法：字符数组 + split/join（字面替换，不解释 `$&`），语义与 `/"/g` 等价。 */
const DQUOTE = '"';

/** 「多久以前 / 多久了」的人话（只看毫秒与 Date，不 import App —— 免得 App<->View 成环）。 */
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

const FACE_META = {
    [DATE_REASONS.ready]: { icon: '\u2705', label: '约会大作战开着', tone: 'ok' },
    [DATE_REASONS.empty]: { icon: '\u{1f498}', label: '还没有去处，也还没约过', tone: 'warn' },
    [DATE_REASONS.storage_absent]: { icon: '\u26a0\ufe0f', label: '存储不可用（读数拿不到）', tone: 'err' },
};

const FACE_TABS = [
    { key: 'scenes', label: '去处' },
    { key: 'runs', label: '约过的' },
];

const MODE_META = [
    { key: FUND_MODES.user, label: '我来付', sub: '全是我的' },
    { key: FUND_MODES.char, label: 'Ta 来付', sub: '全是 Ta 的' },
    { key: FUND_MODES.aa, label: 'AA', sub: '对半，余数归 Ta' },
    { key: FUND_MODES.lend, label: '找人借', sub: '我出的那部分靠借' },
];

const PHASE_LABEL = {
    [RUN_PHASES.planned]: '还没出发',
    [RUN_PHASES.running]: '正在约会',
    [RUN_PHASES.ended]: '已经收场',
};

export class DateView {
    constructor(app, shell, storage) {
        this.app = app;
        this.shell = shell;
        this.storage = storage;
        this._root = null;
        this._face = 'scenes';
        this._draft = {
            sceneName: '', sceneCost: '', sceneUrl: '', scenePrompt: '', batch: '',
            logText: '', story: '', borrowName: '', borrowAmount: '',
        };
        this._newMode = '';
        this._newSceneUid = '';
        this._pendingConfirm = '';
        this._flash = '';
        this._showShare = '';
        this._showPrompt = '';
        this._editScene = '';
    }

    render() {
        const container = this.shell && this.shell.getContentContainer ? this.shell.getContentContainer() : null;
        if (!container) return;
        container.innerHTML = '';
        this._root = document.createElement('div');
        this._root.className = 'dat-root';
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
            hasAny: false, todayDateStr: '', sceneCount: 0, scenesDropped: 0, scenesTrimmed: 0, sceneNames: [],
            runCount: 0, plannedCount: 0, runningCount: 0, endedCount: 0, spent: 0, borrowed: 0,
            outstanding: 0, debtCount: 0, lastSceneName: '', lastCharName: '', lastStars: 0, lastRating: '',
            lastPhase: '', lastElapsed: '', injectLines: 0,
        };
        const limits = app.limits();
        const parts = [];

        parts.push('<div class="dat-header"><h2>\u{1f496} 约会大作战</h2>'
            + '<span class="dat-header-day">' + this._esc(app.todayLabel() || '—') + '</span></div>');

        parts.push('<div class="dat-face dat-face-' + meta.tone + '">');
        parts.push('<span class="dat-face-icon">' + meta.icon + '</span>');
        parts.push('<span class="dat-face-label">' + this._esc(meta.label) + '</span>');
        parts.push('<span class="dat-face-sub">' + this._esc(app.summaryLine()) + '</span>');
        parts.push('</div>');

        if (this._flash) parts.push('<div class="dat-flash">' + this._esc(this._flash) + '</div>');

        parts.push('<div class="dat-tabs">');
        for (const t of FACE_TABS) {
            parts.push('<button class="dat-tab' + (this._face === t.key ? ' is-on' : '') + '" data-face="' + t.key + '">');
            parts.push('<span class="dat-tab-label">' + this._esc(t.label) + '</span>');
            parts.push('<span class="dat-tab-sub">' + this._esc(app.faceOf(t.key)) + '</span>');
            parts.push('</button>');
        }
        parts.push('</div>');

        if (this._face === 'scenes') parts.push(this._scenesPanel(proj, limits));
        else parts.push(this._runsPanel(proj, limits));

        parts.push(this._debtsPanel(limits));
        parts.push(this._settingsPanel(proj, limits));

        return parts.join('\n');
    }

    /* ---------- 去处面 ---------- */

    _scenesPanel(proj, limits) {
        const app = this.app;
        const scenes = app.sceneList();
        const read = app.sceneReading();
        const parts = [];
        parts.push('<div class="dat-scenes">');
        parts.push('<h3 class="dat-list-title">场景册（' + scenes.length + ' / ' + limits.maxScenes + '）</h3>');

        if (!scenes.length) {
            parts.push('<div class="dat-empty">还没有去处。手填一个，或者把一段 JSON 场景数组贴进来。</div>');
        } else {
            for (const s of scenes) {
                const style = app.styleOf(s);
                const editing = this._editScene === s.uid;
                parts.push('<div class="dat-scene">');
                parts.push('<div class="dat-scene-head">');
                parts.push('<span class="dat-scene-name">' + this._esc(s.name) + '</span>');
                parts.push('<span class="dat-scene-cost">' + s.cost + ' 金币</span>');
                parts.push('<span class="dat-scene-kind">' + this._esc(this._kindLabel(style.kind)) + '</span>');
                parts.push((s.source === 'user') ? '<span class="dat-scene-src">手建</span>' : '<span class="dat-scene-src">收进来的</span>');
                parts.push('</div>');
                if (s.imageUrl) {
                    parts.push('<div class="dat-scene-url">图：' + this._esc(s.imageUrl) + '</div>');
                }
                if (s.imagePrompt) {
                    parts.push('<details class="dat-prompt"' + (this._showPrompt === s.uid ? ' open' : '') + '>');
                    parts.push('<summary>背景提示词（' + s.imagePrompt.length + ' 字）</summary>');
                    parts.push('<pre class="dat-prompt-body">' + this._esc(app.promptOf(s)) + '</pre>');
                    parts.push('</details>');
                }
                if (editing) {
                    parts.push('<div class="dat-scene-edit">');
                    parts.push('<input class="dat-input" data-edit="name" data-uid="' + this._esc(s.uid) + '" value="' + this._esc(s.name) + '" placeholder="场景名">');
                    parts.push('<input class="dat-input dat-input-num" data-edit="cost" data-uid="' + this._esc(s.uid) + '" value="' + s.cost + '" placeholder="花费">');
                    parts.push('<input class="dat-input" data-edit="imageUrl" data-uid="' + this._esc(s.uid) + '" value="' + this._esc(s.imageUrl) + '" placeholder="图片地址（可空）">');
                    parts.push('<div class="dat-actions"><button class="dat-btn dat-btn-primary" id="dat-scene-edit-save" data-uid="' + this._esc(s.uid) + '">保存</button>');
                    parts.push('<button class="dat-mini" id="dat-scene-edit-cancel">取消</button></div>');
                    parts.push('</div>');
                } else {
                    parts.push('<div class="dat-scene-actions">');
                    parts.push('<button class="dat-mini" id="dat-scene-edit" data-uid="' + this._esc(s.uid) + '">改</button>');
                    parts.push('<button class="dat-mini" id="dat-scene-del" data-uid="' + this._esc(s.uid) + '">删</button>');
                    parts.push('</div>');
                }
                parts.push('</div>');
            }
        }

        if (read.dropped || read.dupes || read.trimmed) {
            parts.push('<div class="dat-warn">读场景册时：'
                + (read.dropped ? (read.dropped + ' 条读不出来（没名字 / 花费不对 / 地址不认）') : '')
                + (read.dupes ? ((read.dropped ? '；' : '') + read.dupes + ' 条 uid 撞车，只留了先来的') : '')
                + (read.trimmed ? ((read.dropped || read.dupes ? '；' : '') + read.trimmed + ' 条超过上限 ' + limits.maxScenes + ' 没再留') : '')
                + '。都如实计数了，没有静默丢。</div>');
        }

        parts.push('<h3 class="dat-list-title">手建一个去处</h3>');
        parts.push('<input class="dat-input" id="dat-new-name" value="' + this._esc(this._draft.sceneName) + '" placeholder="名字（比如「江边的旧书店」）">');
        parts.push('<input class="dat-input dat-input-num" id="dat-new-cost" value="' + this._esc(this._draft.sceneCost) + '" placeholder="花费（整数金币，可以填 0）">');
        parts.push('<input class="dat-input" id="dat-new-url" value="' + this._esc(this._draft.sceneUrl) + '" placeholder="图片地址（可空：留空就按名字编一段纯风景提示词）">');
        parts.push('<div class="dat-actions"><button class="dat-btn dat-btn-primary" id="dat-new-save">收进场景册</button></div>');
        parts.push('<div class="dat-hint">★ 名字里带引号或括号会被清掉再存 —— 源把用户填的地址**裸插进 `style="background-image: url(...)"`**，'
            + '一个 `)` 就能截断那条样式。另外源在有图时仍把提示词写成「User-provided image」（那不是提示词），本件给了图就不再编。</div>');

        parts.push('<h3 class="dat-list-title">贴一段 JSON 场景数组</h3>');
        parts.push('<textarea class="dat-input dat-textarea" id="dat-batch" rows="4" placeholder=\'[{"name":"夜市","cost":80,"imagePrompt":"street food stalls"}]\'></textarea>');
        parts.push('<div class="dat-actions">');
        parts.push('<button class="dat-btn" id="dat-batch-add">收下这些场景</button>');
        parts.push('<button class="dat-mini" id="dat-scenes-clear">清空场景册</button>');
        parts.push('</div>');
        parts.push('<div class="dat-hint">源的场景册是**让模型现编 3–5 个**再落库的（直连 /v1/chat/completions）。'
            + '本件把这一步交回宿主：你在别处让模型产好 JSON，把数组贴进来。认不出的条目**如实报数**，'
            + 'uid 撞车只留先来的（源用 `Date.now() + index` 生成 uid，同毫秒必撞）。</div>');
        parts.push('</div>');
        return parts.join('\n');
    }

    _kindLabel(kind) {
        if (kind === 'outdoor') return '户外';
        if (kind === 'indoor-public') return '室内 · 公共';
        return '通用';
    }

    /* ---------- 约过的面 ---------- */

    _runsPanel(proj, limits) {
        const app = this.app;
        const runs = app.runList();
        const scenes = app.sceneList();
        const w = app.walletReading();
        const parts = [];

        parts.push('<div class="dat-runs">');

        /* 新约会 */
        parts.push('<h3 class="dat-list-title">新的一场</h3>');
        if (!scenes.length) {
            parts.push('<div class="dat-empty">先去「去处」那一面收几个场景。</div>');
        } else {
            parts.push('<label class="dat-field"><span>去哪</span><select class="dat-input" id="dat-pick-scene">');
            for (const s of scenes) {
                parts.push('<option value="' + this._esc(s.uid) + '"'
                    + ((this._newSceneUid === s.uid) ? ' selected' : '') + '>'
                    + this._esc(s.name) + '（' + s.cost + '）</option>');
            }
            parts.push('</select></label>');

            const pickUid = this._newSceneUid || (scenes[0] && scenes[0].uid) || '';
            const pick = app.sceneByUid(pickUid);
            parts.push('<div class="dat-modes">');
            for (const m of MODE_META) {
                const pv = pick ? app.previewFunds(m.key, pick.cost) : { ok: false };
                const sub = pv.ok ? ('我 ' + pv.userPart + ' / Ta ' + pv.charPart) : '—';
                parts.push('<button class="dat-mode' + (this._newMode === m.key ? ' is-on' : '') + '" data-mode="' + m.key + '">');
                parts.push('<span class="dat-mode-label">' + this._esc(m.label) + '</span>');
                parts.push('<span class="dat-mode-sub">' + this._esc(sub) + '</span>');
                parts.push('</button>');
            }
            parts.push('</div>');
            parts.push('<div class="dat-wallet">钱包：' + this._esc(this._walletLine(w, pick, this._newMode)) + '</div>');
            parts.push('<div class="dat-actions">');
            parts.push('<button class="dat-btn dat-btn-primary" id="dat-plan">计划这一场</button>');
            parts.push('<span class="dat-note">出资方式可以先不定（开演前随时改）。</span>');
            parts.push('</div>');
        }
        parts.push('<div class="dat-hint">★ 源在这里是四路内联扣款：`updateUserBalanceAndLogTransaction(...)` 两次、'
            + '`updateCharacterPhoneBankBalance(...)` 一次，AA 还各自写一份 `scene.cost / 2` 的浮点算账。'
            + '本件**一分钱都不动**：只算「谁出多少」（不变量 `我出的 + Ta 出的 === 花费`，AA 余数明确归 Ta），'
            + '出账入账交给本仓钱包那个权威（用户钱包的仲裁源是**微信零钱**）。这里读它只是为了告诉你够不够。</div>');

        /* 场次列表 */
        parts.push('<h3 class="dat-list-title">场次（' + runs.length + ' / ' + limits.maxRuns + '）</h3>');
        if (!runs.length) {
            parts.push('<div class="dat-empty">还没约过。</div>');
        } else {
            for (const r of runs.slice().reverse()) {
                parts.push(this._runCard(r));
            }
        }
        if (app.expiredReading().expiredRuns) {
            parts.push('<div class="dat-warn">场次超过上限 ' + limits.maxRuns + ' 场，更早的 '
                + app.expiredReading().expiredRuns + ' 场没再留（已如实计数；源把 `datingGameState` 挂在内存里，连丢都不报）。</div>');
        }
        parts.push('<div class="dat-actions"><button class="dat-mini" id="dat-runs-clear">清空场次</button></div>');
        parts.push('</div>');
        return parts.join('\n');
    }

    _walletLine(w, pick, mode) {
        if (!w.available) return '读不到（本件只读不写，读不到不等于没钱）';
        const bal = (w.balance === null) ? '读不到' : (w.balance + ' 金币');
        if (!pick) return bal;
        if (!mode) return bal + '（选一种出资方式看看够不够）';
        const g = this.app.gateFor(mode, pick.cost);
        if (g.error === 'no-balance') return bal + ' · 读不到余额，够不够判不了（不是「余额不足」）';
        if (g.error === 'short') return bal + ' · 差 ' + g.shortfall + '（这一场我要出 ' + g.userPart + '）';
        if (g.ok === false) return bal + ' · ' + (g.error || '判不了');
        return bal + ' · 够了（这一场我要出 ' + g.userPart + '，出完还剩 ' + g.remaining + '）';
    }

    _runCard(r) {
        const app = this.app;
        const isCur = app.currentUid() === r.uid;
        const phase = (r.phaseNow && r.phaseNow.phase) || r.phase || RUN_PHASES.planned;
        const stars = '★'.repeat(Math.max(0, Math.min(3, Number(r.stars) || 0)));
        const parts = [];
        parts.push('<div class="dat-run' + (isCur ? ' is-cur' : '') + '">');
        parts.push('<button class="dat-run-head" data-uid="' + this._esc(r.uid) + '">');
        parts.push('<span class="dat-run-scene">' + this._esc(r.sceneName) + '</span>');
        parts.push('<span class="dat-run-char">和 ' + this._esc(r.charName) + '</span>');
        parts.push('<span class="dat-run-phase dat-phase-' + this._esc(phase) + '">' + this._esc(PHASE_LABEL[phase] || phase) + '</span>');
        parts.push('<span class="dat-run-when">' + this._esc(agoText(r.endedAt || r.startedAt || r.plannedAt)) + '</span>');
        parts.push('</button>');

        if (!isCur) { parts.push('</div>'); return parts.join('\n'); }

        const settle = app.settleOf(r.uid);
        const rating = app.ratingOf(r.uid);
        const prog = app.progressOf(r.uid);

        parts.push('<div class="dat-run-body">');
        parts.push('<div class="dat-money">花费 ' + settle.cost + ' ｜ 我出 ' + settle.userPaid + ' ｜ Ta 出 ' + settle.charPaid
            + (settle.borrowed ? (' ｜ 其中借了 ' + settle.borrowed + (settle.debtTo ? ('（来自 ' + this._esc(settle.debtTo) + '）') : '')) : '')
            + ' ｜ 出资：' + this._esc(this._modeLabel(settle.mode)) + '</div>');
        if (!settle.balanced) {
            parts.push('<div class="dat-warn">这三笔对不上（我 + Ta ≠ 花费）—— 账目破了，别当它是对的。</div>');
        }
        if (phase === RUN_PHASES.running || phase === RUN_PHASES.ended) {
            parts.push('<div class="dat-prog">' + this._esc(PHASE_LABEL[phase]) + (prog.elapsedText ? (' · ' + this._esc(prog.elapsedText)) : '') + '</div>');
        }

        /* 结算卡：三件可核对的事实 */
        parts.push('<div class="dat-rate">');
        parts.push('<span class="dat-rate-stars">' + (stars || '—') + '</span>');
        parts.push('<span class="dat-rate-label">' + this._esc(rating.label) + '</span>');
        parts.push('</div>');
        parts.push('<ul class="dat-facts">');
        for (const f of rating.facts) {
            parts.push('<li class="dat-fact' + (f.ok ? ' is-ok' : '') + '">' + (f.ok ? '\u2714' : '\u2715') + ' ' + this._esc(f.text) + '</li>');
        }
        parts.push('</ul>');
        parts.push('<div class="dat-hint">源的评级看**浪漫值 / 性欲值 / 完成度**三条 `&gt;= 100`（那三个数是模型报的，'
            + '模型不报就恒为 0，于是永远只能拿到最低那一档）。本件改成看**可核对的事实**：钱对得上 / 走到收场 / 有记录。</div>');

        /* 出资（未开演可改） */
        if (phase === RUN_PHASES.planned) {
            parts.push('<div class="dat-modes dat-modes-sm">');
            for (const m of MODE_META) {
                const pv = app.previewFunds(m.key, settle.cost);
                parts.push('<button class="dat-mode' + (settle.mode === m.key ? ' is-on' : '') + '" data-setmode="' + m.key
                    + '" data-uid="' + this._esc(r.uid) + '">');
                parts.push('<span class="dat-mode-label">' + this._esc(m.label) + '</span>');
                parts.push('<span class="dat-mode-sub">' + this._esc(pv.ok ? ('我 ' + pv.userPart + ' / Ta ' + pv.charPart) : '—') + '</span>');
                parts.push('</button>');
            }
            parts.push('</div>');
        }

        /* 记账与剧情 */
        parts.push('<textarea class="dat-input dat-textarea" id="dat-log" rows="2" placeholder="记一笔（谁说了什么 / 发生了什么）"></textarea>');
        parts.push('<textarea class="dat-input dat-textarea" id="dat-story" rows="3" placeholder="把这一段的剧情贴进来（登记，不是生成 —— 剧情来自宿主生成侧）"></textarea>');
        parts.push('<div class="dat-actions">');
        parts.push('<button class="dat-btn" id="dat-log-add" data-uid="' + this._esc(r.uid) + '">记一笔</button>');
        parts.push('<button class="dat-btn" id="dat-story-set" data-uid="' + this._esc(r.uid) + '">存剧情</button>');
        if (phase !== RUN_PHASES.ended) {
            if (phase === RUN_PHASES.planned) parts.push('<button class="dat-btn dat-btn-primary" id="dat-start" data-uid="' + this._esc(r.uid) + '">出发</button>');
            parts.push('<button class="dat-btn dat-btn-primary" id="dat-finish" data-uid="' + this._esc(r.uid) + '">收场</button>');
        }
        parts.push('</div>');
        if (!settle.balanced && phase !== RUN_PHASES.planned) {
            parts.push('<div class="dat-warn">已经开演了，出资方式不能再改（改分配就是在改账）。</div>');
        }

        /* 借一笔 */
        parts.push('<div class="dat-borrow">');
        parts.push('<input class="dat-input" id="dat-borrow-name" placeholder="找谁借（比如「阿岚」）">');
        parts.push('<input class="dat-input dat-input-num" id="dat-borrow-amount" placeholder="借多少">');
        parts.push('<button class="dat-mini" id="dat-borrow-add" data-uid="' + this._esc(r.uid) + '">借一笔</button>');
        parts.push('</div>');
        parts.push('<div class="dat-hint">源的借钱是**真动余额**的（借到钱就打进你的余额）。本件只登记一条事实：欠谁多少。'
            + '候选人是除约会对象外的人（源的门规；想找 Ta 本人在设置里开）。</div>');

        /* 分享（只产文本，不写楼层） */
        parts.push('<div class="dat-actions">');
        parts.push('<button class="dat-mini" id="dat-share" data-uid="' + this._esc(r.uid) + '">' + (this._showShare === r.uid ? '收起记录' : '看记录文本') + '</button>');
        parts.push('<button class="dat-mini" id="dat-run-del" data-uid="' + this._esc(r.uid) + '">删这一场</button>');
        parts.push('</div>');
        if (this._showShare === r.uid) {
            parts.push('<textarea class="dat-input dat-textarea dat-share" rows="6" readonly>' + this._esc(app.textOf(r.uid)) + '</textarea>');
            parts.push('<div class="dat-hint">源把这段直接 `chat.history.push({ type: \'dating_summary_card\' })` 塞进聊天（还带「重新打开」的入口）。'
                + '本件**一个字都不往历史里写**：文本给你，要不要发出去是你的事。</div>');
        }
        parts.push('</div>');
        parts.push('</div>');
        return parts.join('\n');
    }

    _modeLabel(mode) {
        for (const m of MODE_META) if (m.key === mode) return m.label;
        return mode ? String(mode) : '还没定';
    }

    /* ---------- 欠账台账 ---------- */

    _debtsPanel(limits) {
        const app = this.app;
        const debts = app.debtList();
        let total = 0;
        for (const d of debts) total += Number(d.amount) || 0;
        const parts = [];
        parts.push('<div class="dat-debts">');
        parts.push('<h3 class="dat-list-title">欠账台账（' + debts.length + ' 笔 · 共 ' + total + '）</h3>');
        if (!debts.length) parts.push('<div class="dat-empty">没有欠账。</div>');
        else {
            for (const d of debts.slice().reverse()) {
                parts.push('<div class="dat-debt">');
                parts.push('<span class="dat-debt-name">' + this._esc(d.name) + '</span>');
                parts.push('<span class="dat-debt-amount">' + (Number(d.amount) || 0) + '</span>');
                parts.push('<span class="dat-debt-scene">' + this._esc(d.sceneName || '') + '</span>');
                parts.push('<span class="dat-debt-when">' + this._esc(agoText(d.at)) + '</span>');
                parts.push('<button class="dat-mini" id="dat-debt-del" data-uid="' + this._esc(d.uid) + '">销</button>');
                parts.push('</div>');
            }
        }
        parts.push('<div class="dat-hint">源把「借条」写成聊天消息（没有台账，也就没有「一共欠多少」这个数）。'
            + '本件只登记事实、不催不还 —— 「还钱」是用户自己决定的事，本件只保证这个数算得清。上限 ' + limits.maxDebts + ' 笔。</div>');
        parts.push('</div>');
        return parts.join('\n');
    }

    /* ---------- 设置 ---------- */

    _settingsPanel(proj, limits) {
        const s = this.app.settings;
        const parts = [];
        parts.push('<div class="dat-settings">');
        parts.push('<h3 class="dat-list-title">设置</h3>');
        parts.push('<label class="dat-toggle"><span>把「几个去处 / 欠着多少」交给生成侧</span>'
            + '<input type="checkbox" id="dat-inject"' + (s.injectToPrompt ? ' checked' : '') + '></label>');
        parts.push('<label class="dat-field"><span>注入时带几条</span>'
            + '<input type="number" id="dat-max-inject" min="1" max="20" value="' + s.maxInjectLines + '"></label>');
        parts.push('<label class="dat-field"><span>默认出资方式</span><select class="dat-input" id="dat-default-mode">');
        parts.push('<option value=""' + (s.defaultFundMode === '' ? ' selected' : '') + '>每次现问</option>');
        for (const m of MODE_META) {
            parts.push('<option value="' + m.key + '"' + (s.defaultFundMode === m.key ? ' selected' : '') + '>' + this._esc(m.label) + '</option>');
        }
        parts.push('</select></label>');
        parts.push('<label class="dat-toggle"><span>找 Ta 本人借（源只列除约会对象外的人）</span>'
            + '<input type="checkbox" id="dat-borrow-from-date"' + (s.allowBorrowFromDate ? ' checked' : '') + '></label>');
        parts.push('<div class="dat-hint">上限：场景 ' + limits.maxScenes + ' 个、场次 ' + limits.maxRuns + ' 场、'
            + '一场最多 ' + limits.maxLogPerRun + ' 条日志、欠账 ' + limits.maxDebts + ' 笔 —— 源全都没有顶'
            + '（`datingGameState` 挂内存、场景与历史只增不减）。</div>');
        parts.push('<div class="dat-hint">源还有一个**立绘库**（滑块调 x / y / 大小把图叠在背景上）与一个 **BGM 面板**'
            + '（读「一起听」的曲库、音量写的是全局存储键）—— 两块都不缝：立绘编辑器是另一件事（本仓也没有立绘权威），'
            + 'BGM 的曲库本仓另有权威、音量写全局键会跨会话串味。</div>');
        parts.push('</div>');
        return parts.join('\n');
    }

    /* ---------- 事件 ---------- */

    _bindEvents() {
        if (!this._root) return;
        const app = this.app;
        const q = (sel) => this._root.querySelector(sel);

        for (const b of this._root.querySelectorAll('.dat-tab')) {
            b.addEventListener('click', () => { this._face = b.dataset.face; this.refresh(); });
        }

        /* 去处面 */
        const name = q('#dat-new-name');
        if (name) name.addEventListener('input', () => { this._draft.sceneName = name.value; });
        const cost = q('#dat-new-cost');
        if (cost) cost.addEventListener('input', () => { this._draft.sceneCost = cost.value; });
        const url = q('#dat-new-url');
        if (url) url.addEventListener('input', () => { this._draft.sceneUrl = url.value; });
        const newSave = q('#dat-new-save');
        if (newSave) newSave.addEventListener('click', () => {
            const r = app.addScene({
                name: q('#dat-new-name') ? q('#dat-new-name').value : this._draft.sceneName,
                cost: q('#dat-new-cost') ? q('#dat-new-cost').value : this._draft.sceneCost,
                imageUrl: q('#dat-new-url') ? q('#dat-new-url').value : this._draft.sceneUrl,
            });
            if (!r.ok) { this._flash = r.error || '收不进来'; this.refresh(); return; }
            this._flash = '收下了「' + this._draft.sceneName + '」' + (r.trimmed ? ('（超过上限，裁了 ' + r.trimmed + ' 条）') : '');
            this._draft.sceneName = ''; this._draft.sceneCost = ''; this._draft.sceneUrl = '';
            this.refresh();
        });
        const batch = q('#dat-batch');
        if (batch) batch.addEventListener('input', () => { this._draft.batch = batch.value; });
        const batchAdd = q('#dat-batch-add');
        if (batchAdd) batchAdd.addEventListener('click', () => {
            const raw = q('#dat-batch') ? q('#dat-batch').value : this._draft.batch;
            let parsed = null;
            try { parsed = JSON.parse(String(raw || '').trim()); } catch (_e) { parsed = null; }
            if (!Array.isArray(parsed)) { this._flash = '这段不是 JSON 数组（要 [ {…}, {…} ] 这样的）'; this.refresh(); return; }
            const r = app.addScenes(parsed);
            if (!r.ok) { this._flash = r.error || '收不下'; this.refresh(); return; }
            this._flash = '收下 ' + r.added + ' 条'
                + (r.dropped ? ('（' + r.dropped + ' 条认不出，没存）') : '')
                + (r.dupes ? ('（' + r.dupes + ' 条重了）') : '')
                + (r.trimmed ? ('（超上限裁了 ' + r.trimmed + ' 条）') : '');
            this._draft.batch = '';
            this.refresh();
        });
        const scenesClear = q('#dat-scenes-clear');
        if (scenesClear) scenesClear.addEventListener('click', () => {
            if (this._needConfirm('dat-scenes-clear', scenesClear)) return;
            const r = app.clearScenes();
            this._flash = r.removed ? ('清掉 ' + r.removed + ' 个去处') : '本来就是空的';
            this.refresh();
        });
        for (const b of this._root.querySelectorAll('#dat-scene-del')) {
            b.addEventListener('click', () => {
                const r = app.removeScene(b.dataset.uid);
                this._flash = r.ok ? ('删掉 ' + r.removed + ' 个去处') : (r.error || '删不掉');
                this.refresh();
            });
        }
        for (const b of this._root.querySelectorAll('#dat-scene-edit')) {
            b.addEventListener('click', () => { this._editScene = b.dataset.uid; this.refresh(); });
        }
        const editCancel = q('#dat-scene-edit-cancel');
        if (editCancel) editCancel.addEventListener('click', () => { this._editScene = ''; this.refresh(); });
        const editSave = q('#dat-scene-edit-save');
        if (editSave) editSave.addEventListener('click', () => {
            const uid = editSave.dataset.uid;
            const get = (field) => {
                const el = this._root.querySelector('[data-edit="' + field + '"][data-uid="' + uid + '"]');
                return el ? el.value : undefined;
            };
            const r = app.patchScene(uid, { name: get('name'), cost: get('cost'), imageUrl: get('imageUrl') });
            this._flash = r.ok ? '改好了' : (r.error || '改不了');
            if (r.ok) this._editScene = '';
            this.refresh();
        });
        for (const d of this._root.querySelectorAll('.dat-prompt')) {
            d.addEventListener('toggle', () => {
                const sum = d.querySelector('summary');
                if (d.open && sum) this._showPrompt = '';
            });
        }

        /* 约过的面 */
        const pick = q('#dat-pick-scene');
        if (pick) pick.addEventListener('change', () => {
            this._newSceneUid = pick.value;
            this.refresh();
        });
        for (const b of this._root.querySelectorAll('.dat-mode[data-mode]')) {
            b.addEventListener('click', () => { this._newMode = b.dataset.mode; this.refresh(); });
        }
        const plan = q('#dat-plan');
        if (plan) plan.addEventListener('click', () => {
            const uid = (q('#dat-pick-scene') ? q('#dat-pick-scene').value : '') || this._newSceneUid;
            const r = app.plan(uid, this._newMode || '');
            if (!r.ok) { this._flash = r.error || '计划不成'; this.refresh(); return; }
            this._flash = '计划好了' + (r.expiredRuns ? ('（超过上限，更早的 ' + r.expiredRuns + ' 场没再留）') : '');
            this.refresh();
        });
        for (const b of this._root.querySelectorAll('.dat-run-head')) {
            b.addEventListener('click', () => {
                app.setCurrent(app.currentUid() === b.dataset.uid ? '' : b.dataset.uid);
                this.refresh();
            });
        }
        for (const b of this._root.querySelectorAll('.dat-mode[data-setmode]')) {
            b.addEventListener('click', () => {
                const r = app.setMode(b.dataset.uid, b.dataset.setmode);
                this._flash = r.ok ? '出资方式记下了（开演前还能改）' : (r.error || '改不了');
                this.refresh();
            });
        }
        const logAdd = q('#dat-log-add');
        if (logAdd) logAdd.addEventListener('click', () => {
            const v = q('#dat-log') ? q('#dat-log').value : '';
            const r = app.log(logAdd.dataset.uid, app.names().myName, v);
            this._flash = r.ok ? ('记下了（这一场第 ' + r.count + ' 条）') : (r.error || '记不下');
            this.refresh();
        });
        const storySet = q('#dat-story-set');
        if (storySet) storySet.addEventListener('click', () => {
            const v = q('#dat-story') ? q('#dat-story').value : '';
            const r = app.setStory(storySet.dataset.uid, v);
            this._flash = r.ok ? ('剧情存下了（' + r.len + ' 字）') : (r.error || '存不下');
            this.refresh();
        });
        const startBtn = q('#dat-start');
        if (startBtn) startBtn.addEventListener('click', () => {
            const r = app.start(startBtn.dataset.uid);
            if (!r.ok) { this._flash = r.error || '出发不了'; this.refresh(); return; }
            const g = r.gate || {};
            this._flash = '出发了' + (g.error === 'no-balance' ? '（读不到余额，够不够判不了）'
                : (g.error === 'short' ? ('（钱差 ' + g.shortfall + ' —— 本件不扣钱，你自己看着办）') : ''));
            this.refresh();
        });
        const finishBtn = q('#dat-finish');
        if (finishBtn) finishBtn.addEventListener('click', () => {
            const r = app.finish(finishBtn.dataset.uid);
            this._flash = r.ok ? ('收场了 · ' + r.rating.label + '（' + r.rating.stars + ' / 3）') : (r.error || '收不了场');
            this.refresh();
        });
        const borrowAdd = q('#dat-borrow-add');
        if (borrowAdd) borrowAdd.addEventListener('click', () => {
            const nm = q('#dat-borrow-name') ? q('#dat-borrow-name').value : '';
            const am = q('#dat-borrow-amount') ? q('#dat-borrow-amount').value : '';
            const r = app.borrow(borrowAdd.dataset.uid, nm, am);
            this._flash = r.ok ? ('借到了：欠 ' + nm + ' ' + (Number(am) || 0) + '（只是登记，钱没动）') : (r.error || '借不了');
            this.refresh();
        });
        const shareBtn = q('#dat-share');
        if (shareBtn) shareBtn.addEventListener('click', () => {
            this._showShare = (this._showShare === shareBtn.dataset.uid) ? '' : shareBtn.dataset.uid;
            this.refresh();
        });
        const runDel = q('#dat-run-del');
        if (runDel) runDel.addEventListener('click', () => {
            if (this._needConfirm('dat-rundel', runDel)) return;
            const r = app.removeRun(runDel.dataset.uid);
            this._flash = r.ok ? '删掉了这一场' : (r.error || '删不掉');
            this.refresh();
        });
        const runsClear = q('#dat-runs-clear');
        if (runsClear) runsClear.addEventListener('click', () => {
            if (this._needConfirm('dat-runsclear', runsClear)) return;
            const r = app.clearRuns();
            this._flash = r.removed ? ('清掉 ' + r.removed + ' 场') : '本来就没有';
            this.refresh();
        });

        /* 欠账 */
        for (const b of this._root.querySelectorAll('#dat-debt-del')) {
            b.addEventListener('click', () => {
                const r = app.settleDebt(b.dataset.uid);
                this._flash = r.ok ? '销掉一笔' : (r.error || '销不掉');
                this.refresh();
            });
        }

        /* 设置 */
        const inject = q('#dat-inject');
        if (inject) inject.addEventListener('change', (e) => app.patchSettings({ injectToPrompt: e.target.checked }));
        const maxInject = q('#dat-max-inject');
        if (maxInject) maxInject.addEventListener('change', (e) => app.patchSettings({ maxInjectLines: e.target.value }));
        const defMode = q('#dat-default-mode');
        if (defMode) defMode.addEventListener('change', (e) => app.patchSettings({ defaultFundMode: e.target.value }));
        const bfd = q('#dat-borrow-from-date');
        if (bfd) bfd.addEventListener('change', (e) => app.patchSettings({ allowBorrowFromDate: e.target.checked }));
    }

    _needConfirm(key, btn) {
        if (this._pendingConfirm === key) { this._pendingConfirm = ''; return false; }
        this._pendingConfirm = key;
        if (btn) { btn.textContent = '确认'; btn.classList.add('dat-mini-armed'); }
        return true;
    }

    _esc(s) {
        return String(s === null || s === undefined ? '' : s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            /* ★ 「双引号」用**字符数组 + split/join**，不写成正则字面量：
             *   本仓判据共用的剥注释器（`stripComments`）是字符状态机、**不解析正则字面量** ——
             *   正则里那半个引号会被它当成字符串的起头，从这一行往后块注释全部失守
             *   （v3.31.0 当场踩到：本行使 `date-view.js` 的尾随块注释再也剥不掉）。
             *   语义与 `.replace(/"/g, ...)` 完全一致（split/join 是字面替换，不解释 `$&`）。
             *   下半句是 K3 判据的地面自证：本文件的**尾随块注释**必须能被剥掉。 */
            /* ★ 用的是 split/join 而**不是** `.replace(DQUOTE, …)`：后者只换**第一个**匹配，
             *   而 `/"/g` 是全部 —— 换法必须语义等价，否则 `_esc` 会漏掉后面的双引号。 */
            .split(DQUOTE).join('\x26quot;');
    }
}