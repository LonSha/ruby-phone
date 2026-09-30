/* ========================================================
 * block-view.js — [v3.27.0] 拉黑 App 视图
 * 归因卡 + 两本账（你拉黑它 / 它拉黑你）+ 各自的申请流 + 重来模式 + 清账 + 设置
 *
 * 与 focus-view / piggy-view / punchcard-view 同纪律：归因文案表的键取 BLOCK_REASONS 的**值**。
 * 本视图**只画与派事件**：一切数据变动都回调到 App 的方法上（App 负责纯函数 + 落盘）。
 *
 * 三处「不糊弄」：
 *   · 申请一律**显式落定**（接受 / 回绝 + 理由），本件不替角色答；
 *   · 回绝要**填理由**，理由会进下一次申请的注入（源就是这么拿它当记仇材料的）；
 *   · 冷却走**读数**（`离下一条还差 X 分钟`），不靠一个自己转的定时器。
 * ======================================================== */
'use strict';
import { BLOCK_REASONS, BLOCK_LIMITS, formatCooldown } from './block-data.js';

const FACE_META = {
    [BLOCK_REASONS.ready]: { icon: '\u2705', label: '两本账里有记录', tone: 'ok' },
    [BLOCK_REASONS.empty]: { icon: '\u{1f6ab}', label: '两本账都是平的', tone: 'warn' },
    [BLOCK_REASONS.storage_absent]: { icon: '\u26a0\ufe0f', label: '存储不可用（读数拿不到）', tone: 'err' },
};

const STATUS_LABEL = { pending: '待答复', accepted: '答应了', rejected: '回绝了' };
const MODE_LABEL = { fixed: '按间隔来（到点它才来敲）', auto: '让它自己看时机' };
const BY_LABEL = { char: '它自己定的', user: '你替它记的' };

export class BlockView {
    constructor(app, shell, storage) {
        this.app = app;
        this.shell = shell;
        this.storage = storage;
        this._root = null;
        /** 申请理由草稿（纯视图态） */
        this._reason = '';
        /** 记「它来加你」时说的话（纯视图态） */
        this._applyReason = '';
        /** 逐条申请的回绝理由草稿：`{ [requestId]: text }` */
        this._rejectDraft = {};
        /** 两步确认 */
        this._pendingConfirm = '';
        /** 提示条 */
        this._flash = '';
    }

    render() {
        const container = this.shell && this.shell.getContentContainer ? this.shell.getContentContainer() : null;
        if (!container) return;
        container.innerHTML = '';
        this._root = document.createElement('div');
        this._root.className = 'blk-root';
        this._root.innerHTML = this._buildHTML();
        container.appendChild(this._root);
        this._bindEvents();
    }

    refresh() {
        if (!this._root) return;
        this._root.innerHTML = this._buildHTML();
        this._bindEvents();
    }

    _ts(ms) {
        const n = Number(ms);
        if (!Number.isFinite(n) || n <= 0) return '';
        const d = new Date(n);
        const p = (x) => String(x).padStart(2, '0');
        return (d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
    }

    _buildHTML() {
        const app = this.app;
        const face = app.faceReason();
        const meta = FACE_META[face] || { icon: '\u2753', label: '未识别的状态：' + String(face), tone: 'warn' };
        const proj = app.projection() || {
            directBlocked: false, directSince: 0, directTimes: 0, directRequests: [], requestCount: 0,
            pendingFromChar: [], acceptedCount: 0, rejectedCount: 0, lastReject: '',
            reapply: { mode: 'fixed', intervalMin: 30, lastRequestTime: 0 },
            cooldownMs: 0, reverseBlocked: false, reverseSince: 0, reverseReason: '', reverseTimes: 0,
            myRequests: [], myPending: [], myRejectedCount: 0, hasAny: false,
        };
        const settings = app.settings;
        const limits = app.limits();
        const parts = [];

        parts.push('<div class="blk-header"><h2>\u{1f6ab} 拉黑</h2></div>');

        parts.push('<div class="blk-face blk-face-' + meta.tone + '">');
        parts.push('<span class="blk-face-icon">' + meta.icon + '</span>');
        parts.push('<span class="blk-face-label">' + this._esc(meta.label) + '</span>');
        parts.push('</div>');

        if (this._flash) parts.push('<div class="blk-flash">' + this._esc(this._flash) + '</div>');

        /* ---------- 本一：你拉黑它 ---------- */
        parts.push('<div class="blk-book blk-book-direct' + (proj.directBlocked ? ' is-on' : '') + '">');
        parts.push('<h3 class="blk-book-title">本一 · 你拉黑它</h3>');
        parts.push('<div class="blk-book-state">' + (proj.directBlocked
            ? ('\u{1f6ab} 正拉黑着' + (proj.directSince ? ('（自 ' + this._ts(proj.directSince) + '）') : ''))
            : ('\u2705 没拉黑' + (proj.directTimes ? ('（拉黑过 ' + proj.directTimes + ' 次）') : ''))) + '</div>');
        parts.push('<div class="blk-actions">');
        if (proj.directBlocked) {
            parts.push('<button class="blk-btn blk-unblock">解除拉黑</button>');
        } else {
            parts.push('<button class="blk-btn blk-btn-primary blk-block">拉黑它</button>');
        }
        parts.push('<button class="blk-mini blk-char-apply"' + (proj.directBlocked ? '' : ' disabled') + '>记一条它的申请</button>');
        parts.push('</div>');
        parts.push('<input class="blk-input" id="blk-apply-reason" type="text" maxlength="' + limits.maxReasonLen
            + '" placeholder="它来加你时说的那句话（可留空）" value="' + this._esc(this._applyReason) + '"'
            + (proj.directBlocked ? '' : ' disabled') + '>');

        if (proj.directBlocked) {
            parts.push('<div class="blk-sub">重来模式</div>');
            parts.push('<div class="blk-mode-row">');
            parts.push('<select class="blk-input blk-mode" id="blk-mode">');
            for (const m of app.reapplyModes()) {
                parts.push('<option value="' + this._esc(m) + '"' + (proj.reapply.mode === m ? ' selected' : '') + '>'
                    + this._esc(MODE_LABEL[m] || m) + '</option>');
            }
            parts.push('</select>');
            parts.push('<input class="blk-input blk-interval" id="blk-interval" type="number" min="' + limits.minInterval
                + '" max="' + limits.maxInterval + '" value="' + proj.reapply.intervalMin + '">');
            parts.push('<span class="blk-unit">分钟</span>');
            parts.push('</div>');
            parts.push('<div class="blk-hint">到点它才来敲 —— 这不是定时器在转，是你打开这一页时现算的读数：'
                + (proj.cooldownMs > 0
                    ? ('离下一条还差 <strong>' + this._esc(formatCooldown(proj.cooldownMs)) + '</strong>')
                    : '现在它随时可以再来敲')
                + '。</div>');
        }

        /* 它的申请流 */
        parts.push('<div class="blk-sub">它来加好友（' + proj.requestCount + ' 条'
            + '，答了 ' + proj.acceptedCount + ' / 回绝 ' + proj.rejectedCount + '）</div>');
        if (!proj.directRequests.length) {
            parts.push('<div class="blk-empty">还没有它的申请。</div>');
        } else {
            for (const r of proj.directRequests) {
                parts.push('<div class="blk-req is-' + this._esc(r.status) + '">');
                parts.push('<div class="blk-req-head">');
                parts.push('<span class="blk-req-status">' + this._esc(STATUS_LABEL[r.status] || r.status) + '</span>');
                parts.push('<span class="blk-req-time">' + this._esc(this._ts(r.createdAt)) + '</span>');
                if (r.decidedBy) parts.push('<span class="blk-req-by">' + this._esc(BY_LABEL[r.decidedBy] || r.decidedBy) + '</span>');
                parts.push('</div>');
                if (r.reason) parts.push('<div class="blk-req-reason">「' + this._esc(r.reason) + '」</div>');
                if (r.status === 'rejected' && r.rejectReason) {
                    parts.push('<div class="blk-req-reject">你回绝的理由：' + this._esc(r.rejectReason) + '</div>');
                }
                if (r.status === 'pending') {
                    parts.push('<div class="blk-req-actions">');
                    parts.push('<button class="blk-mini blk-req-accept" data-id="' + this._esc(r.id) + '">答应</button>');
                    parts.push('<input class="blk-input blk-req-reason-input" type="text" maxlength="' + limits.maxRejectReasonLen
                        + '" placeholder="回绝就说一句为什么" value="' + this._esc(this._rejectDraft[r.id] || '') + '" data-id="' + this._esc(r.id) + '">');
                    parts.push('<button class="blk-mini blk-req-reject-btn" data-id="' + this._esc(r.id) + '">回绝</button>');
                    parts.push('</div>');
                }
                parts.push('</div>');
            }
        }
        parts.push('<div class="blk-hint">答应就**自动解除拉黑**（源里接受申请和解除拉黑是连着的）。'
            + '本 App 不替它答 —— 它在自己回合里怎么说，你在这儿落一下就行。</div>');
        parts.push('</div>');

        /* ---------- 本二：它拉黑你 ---------- */
        parts.push('<div class="blk-book blk-book-reverse' + (proj.reverseBlocked ? ' is-on' : '') + '">');
        parts.push('<h3 class="blk-book-title">本二 · 它拉黑你</h3>');
        parts.push('<div class="blk-book-state">' + (proj.reverseBlocked
            ? ('\u26d4 被它拉黑着' + (proj.reverseSince ? ('（自 ' + this._ts(proj.reverseSince) + '）') : '')
                + (proj.reverseReason ? (' · 理由：' + this._esc(proj.reverseReason)) : ''))
            : ('\u2705 没被拉黑' + (proj.reverseTimes ? ('（被拉黑过 ' + proj.reverseTimes + ' 次）') : ''))) + '</div>');
        parts.push('<div class="blk-actions">');
        parts.push('<button class="blk-mini blk-char-block">记它拉黑了你</button>');
        parts.push('<button class="blk-mini blk-char-unblock"' + (proj.reverseBlocked ? '' : ' disabled') + '>记它放你出来</button>');
        parts.push('</div>');
        parts.push('<input class="blk-input" id="blk-char-reason" type="text" maxlength="' + limits.maxReasonLen
            + '" placeholder="它拉黑你时说的理由（可留空，空则记「不想再聊了」）">');

        parts.push('<div class="blk-sub">你去申请加回（' + proj.myRequests.length + ' 条'
            + '，被回绝 ' + proj.myRejectedCount + '）</div>');
        if (!proj.reverseBlocked) {
            parts.push('<div class="blk-empty">它没拉黑你，不用申请。</div>');
        } else {
            parts.push('<div class="blk-create-row">');
            parts.push('<input class="blk-input" id="blk-my-reason" type="text" maxlength="' + limits.maxReasonLen
                + '" placeholder="你想说的话（申请理由）" value="' + this._esc(this._reason) + '">');
            parts.push('<button class="blk-mini" id="blk-my-apply">递交申请</button>');
            parts.push('</div>');
        }
        if (proj.myRequests.length) {
            for (const r of proj.myRequests) {
                parts.push('<div class="blk-req is-' + this._esc(r.status) + '">');
                parts.push('<div class="blk-req-head">');
                parts.push('<span class="blk-req-status">' + this._esc(STATUS_LABEL[r.status] || r.status) + '</span>');
                parts.push('<span class="blk-req-time">' + this._esc(this._ts(r.createdAt)) + '</span>');
                parts.push('</div>');
                if (r.reason) parts.push('<div class="blk-req-reason">「' + this._esc(r.reason) + '」</div>');
                if (r.status === 'rejected' && r.rejectReason) {
                    parts.push('<div class="blk-req-reject">它的回绝理由：' + this._esc(r.rejectReason) + '</div>');
                }
                if (r.status === 'pending') {
                    parts.push('<div class="blk-req-actions">');
                    parts.push('<button class="blk-mini blk-my-accept" data-id="' + this._esc(r.id) + '">记：它答应了</button>');
                    parts.push('<input class="blk-input blk-my-reason-input" type="text" maxlength="' + limits.maxRejectReasonLen
                        + '" placeholder="它回绝的理由" value="' + this._esc(this._rejectDraft[r.id] || '') + '" data-id="' + this._esc(r.id) + '">');
                    parts.push('<button class="blk-mini blk-my-reject" data-id="' + this._esc(r.id) + '">记：它回绝了</button>');
                    parts.push('</div>');
                }
                parts.push('</div>');
            }
        }
        parts.push('<div class="blk-hint">源在这个位置**自己拼人设、自己调模型**问「接受还是回绝」。'
            + '本仓不这么干：模型调用归生成侧。你在这儿递交申请，它答不答、怎么答，是它回合里的事；'
            + '答完你落一下，两本账才一致。</div>');
        parts.push('</div>');

        /* ---------- 清账 ---------- */
        parts.push('<div class="blk-clean">');
        parts.push('<h3 class="blk-list-title">清账</h3>');
        parts.push('<div class="blk-actions">');
        parts.push('<button class="blk-mini blk-clear-history">清空历史（保留当前状态）</button>');
        parts.push('<button class="blk-mini blk-mini-armed blk-reset">整本清掉</button>');
        parts.push('</div>');
        parts.push('<div class="blk-hint">「清空历史」只抹掉次数与申请，**当前拉黑状态不动**；'
            + '「整本清掉」两边状态一起归零。</div>');
        parts.push('</div>');

        /* ---------- 设置 ---------- */
        parts.push('<div class="blk-settings">');
        parts.push('<h3 class="blk-list-title">设置</h3>');
        parts.push('<label class="blk-toggle"><span>把两本账交给生成侧</span>'
            + '<input type="checkbox" id="blk-inject"' + (settings.injectToPrompt ? ' checked' : '') + '></label>');
        parts.push('<label class="blk-field"><span>注入最多几行</span>'
            + '<input type="number" id="blk-max-lines" min="0" max="20" value="' + settings.maxInjectLines + '"></label>');
        parts.push('<label class="blk-field"><span>默认间隔（分钟）</span>'
            + '<input type="number" id="blk-default-interval" min="' + limits.minInterval + '" max="' + limits.maxInterval
            + '" value="' + settings.defaultIntervalMin + '"></label>');
        parts.push('<div class="blk-hint">两本账随会话走：换角色后那是另一个角色和你的另一段恩怨。'
            + '本 App 只记账：不替你去问模型，不碰聊天记录，也不在后台转任何定时器。</div>');
        parts.push('</div>');

        return parts.join('\n');
    }

    _bindEvents() {
        if (!this._root) return;
        const app = this.app;
        const q = (sel) => this._root.querySelector(sel);

        const flash = (msg) => { this._flash = msg || ''; };

        /* 本一 */
        const blockBtn = q('.blk-block');
        if (blockBtn) blockBtn.addEventListener('click', () => {
            const r = app.block();
            flash(r.ok ? '已拉黑' : (r.error || ''));
            this.refresh();
        });
        const unblockBtn = q('.blk-unblock');
        if (unblockBtn) unblockBtn.addEventListener('click', () => {
            const r = app.unblock();
            flash(r.ok ? '已解除' : (r.error || ''));
            this.refresh();
        });
        const charApply = q('.blk-char-apply');
        if (charApply) charApply.addEventListener('click', () => {
            const r = app.charRequest(this._applyReason);
            flash(r.ok ? '记上了它的一条申请' : (r.error || ''));
            if (r.ok) this._applyReason = '';
            this.refresh();
        });
        const applyReason = q('#blk-apply-reason');
        if (applyReason) applyReason.addEventListener('input', () => { this._applyReason = applyReason.value; });

        const mode = q('#blk-mode');
        if (mode) mode.addEventListener('change', () => {
            const iv = q('#blk-interval');
            app.setReapply(mode.value, iv ? iv.value : app.settings.defaultIntervalMin);
            this.refresh();
        });
        const interval = q('#blk-interval');
        if (interval) interval.addEventListener('change', () => {
            app.setReapply(app.projection().reapply.mode, interval.value);
            this.refresh();
        });

        for (const b of this._root.querySelectorAll('.blk-req-accept')) {
            b.addEventListener('click', () => {
                const r = app.resolveCharRequest(b.dataset.id, true, '', 'user');
                flash(r.ok ? '答应它了（拉黑也随之解除）' : (r.error || ''));
                this.refresh();
            });
        }
        for (const el of this._root.querySelectorAll('.blk-req-reason-input')) {
            el.addEventListener('input', () => { this._rejectDraft[el.dataset.id] = el.value; });
        }
        for (const b of this._root.querySelectorAll('.blk-req-reject-btn')) {
            b.addEventListener('click', () => {
                const id = b.dataset.id;
                const txt = this._rejectDraft[id] || '';
                if (!String(txt).trim()) { flash('回绝要写一句为什么 —— 这句会进它的下一次申请'); this.refresh(); return; }
                const r = app.resolveCharRequest(id, false, txt, 'user');
                flash(r.ok ? '回绝了（理由已记下）' : (r.error || ''));
                if (r.ok) delete this._rejectDraft[id];
                this.refresh();
            });
        }

        /* 本二 */
        const charBlock = q('.blk-char-block');
        if (charBlock) charBlock.addEventListener('click', () => {
            const inp = q('#blk-char-reason');
            const r = app.charBlock(inp ? inp.value : '');
            flash(r.ok ? '记上了：它拉黑了你' : (r.error || ''));
            this.refresh();
        });
        const charUnblock = q('.blk-char-unblock');
        if (charUnblock) charUnblock.addEventListener('click', () => {
            const r = app.charUnblock();
            flash(r.ok ? '记上了：它放你出来了' : (r.error || ''));
            this.refresh();
        });
        const myReason = q('#blk-my-reason');
        if (myReason) myReason.addEventListener('input', () => { this._reason = myReason.value; });
        const myApply = q('#blk-my-apply');
        if (myApply) myApply.addEventListener('click', () => {
            const r = app.myRequest(this._reason);
            flash(r.ok ? '申请递交了（等它回合里回）' : (r.error || ''));
            if (r.ok) this._reason = '';
            this.refresh();
        });
        for (const b of this._root.querySelectorAll('.blk-my-accept')) {
            b.addEventListener('click', () => {
                const r = app.resolveMyRequest(b.dataset.id, true, '', 'user');
                flash(r.ok ? '记上了：它答应加回你' : (r.error || ''));
                this.refresh();
            });
        }
        for (const el of this._root.querySelectorAll('.blk-my-reason-input')) {
            el.addEventListener('input', () => { this._rejectDraft[el.dataset.id] = el.value; });
        }
        for (const b of this._root.querySelectorAll('.blk-my-reject')) {
            b.addEventListener('click', () => {
                const id = b.dataset.id;
                const txt = this._rejectDraft[id] || '';
                if (!String(txt).trim()) { flash('它回绝总得有个理由 —— 空着记不下来'); this.refresh(); return; }
                const r = app.resolveMyRequest(id, false, txt, 'user');
                flash(r.ok ? '记上了：它回绝' : (r.error || ''));
                if (r.ok) delete this._rejectDraft[id];
                this.refresh();
            });
        }

        /* 清账 */
        const clearH = q('.blk-clear-history');
        if (clearH) clearH.addEventListener('click', () => {
            const n = app.clearHistory();
            flash(n ? ('清掉了 ' + n + ' 条记录') : '本来就没记录');
            this.refresh();
        });
        const reset = q('.blk-reset');
        if (reset) reset.addEventListener('click', () => {
            if (this._needConfirm('blk-reset', reset)) return;
            app.resetAll();
            flash('整本清掉了');
            this.refresh();
        });

        /* 设置 */
        const inject = q('#blk-inject');
        if (inject) inject.addEventListener('change', (e) => {
            app.settings = { ...app.settings, injectToPrompt: e.target.checked };
            app.saveSettings();
        });
        const maxLines = q('#blk-max-lines');
        if (maxLines) maxLines.addEventListener('change', (e) => app.patchSettings({ maxInjectLines: e.target.value }));
        const defIv = q('#blk-default-interval');
        if (defIv) defIv.addEventListener('change', (e) => app.patchSettings({ defaultIntervalMin: e.target.value }));
    }

    /** 两步确认（整本清账不可逆，而本仓不弹宿主 confirm）。 */
    _needConfirm(key, btn) {
        if (this._pendingConfirm === key) { this._pendingConfirm = ''; return false; }
        this._pendingConfirm = key;
        if (btn) { btn.textContent = '确认'; btn.classList.add('blk-mini-armed'); }
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