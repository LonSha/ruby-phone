/* ========================================================
 * comms-view.js — [v4.49.0 · 第六期 R6-O2] 会话台视图
 * --------------------------------------------------------
 * single 形态：没有 tabs 数组、**没有 tab 分支**（与 config/tab-source.js 的
 *   `comms` 行 shape:'single' 一致；判据 C 面按住这条）。
 * 渲染纪律：走宿主给的容器（App 侧已做 layerHost 解析），本层**不直接写 .phone-screen**
 *   —— 直接写会抹掉返回键与小白条（scripts/screen-host-check.mjs 判红）。
 * 转义纪律（本仓踩过的坑）：四个替换目标必须逐字写全，写漏一个就退化成恒等转义，
 *   而判据只看「有没有 .replace」时仍会绿 —— 故本层四个字面量一个不少。
 * ============================================================ */
'use strict';
function _esc(v) {
    return String(v == null ? '' : v)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&#x26quot;');
}
const KIND_LABEL = { message: '消息', call: '通话', missed: '漏接', sms: '短信' };
/* [v4.123.0 · R14-X1] 落地 App 的展示名。**只做展示**：归属由内核
 *   COMM_CHANNEL_APP 决定，这里写错只影响文案，不影响投递目标。 */
const APP_LABEL = { wechat: '微信', phone: '电话' };
const ATTN_LABEL = { settled: '已回', unread: '未读', unanswered: '未回' };
export class CommsView {
    constructor(app) {
        this.app = app;
    }
    /**
     * 渲染会话台。
     * @param {object} container 宿主给的容器（App 侧已解析 layerHost/screen）
     */
    render(container) {
        const host = container;
        if (!host || typeof host.querySelector !== 'function') return;
        const list = this.app.live();
        const pending = this.app.pending();
        this._draw(host, list, pending);
        this._bind(host);
    }
    _draw(host, list, pending) {
        const rows = list.map((t) => this._card(t)).join('');
        const empty = list.length
            ? ''
            : '<p class="cm-empty">还没有交流记录。开一段：写下对方的名字（第一句话之后再挂接触点）。</p>';
        const pendLine = pending.length
            ? '<p class="cm-pending">待处理 ' + pending.length + ' 段：' + pending.map((t) => _esc(t.participant)).join('、') + '</p>'
            : '<p class="cm-pending cm-pending-none">没有未读未回。</p>';
        host.innerHTML = [
            '<div class="cm-root">',
            '  <header class="cm-head">',
            '    <h3 class="cm-title">会话台</h3>',
            '    <p class="cm-sub">消息 / 来电 / 漏接 / 短信，归成同一段交流；断在哪里看得见。</p>',
            '  </header>',
            '  <section class="cm-new">',
            '    <input class="cm-new-name" type="text" maxlength="40" placeholder="对方名字" aria-label="对方名字">',
            '    <button class="cm-new-btn" type="button" data-cm-act="open">开一段</button>',
            '  </section>',
            pendLine,
            this._replySection(),
            empty,
            '<div class="cm-list">' + rows + '</div>',
            '</div>',
        ].join('\n');
    }
    /* ───────── [v4.123.0 · R14-X1] 待回应清单（逐项三动作，回到原处）───────── */
    _replySection() {
        /* ★ 读数一律向 App 取（replyBoard 的口径在内核 replyPointsOf，视图不自算）。 */
        const board = this.app.replyBoard();
        if (!board.length) {
            return '<section class="cm-reply cm-reply-none"><p class="cm-empty">没有等着回应的事。</p></section>';
        }
        const groups = board.map((g) => {
            const rows = g.points.map((p) => (
                '<li class="cm-reply-item">'
                + '<span class="cm-pt-kind cm-k-' + _esc(p.kind) + '">' + _esc(KIND_LABEL[p.kind] || p.kind) + '</span>'
                + '<span class="cm-pt-label">' + _esc(p.label || p.refId) + '</span>'
                + '<span class="cm-reply-btns">'
                + '<button class="cm-pt-go" type="button" data-cm-act="goto" data-t="' + _esc(g.thread.id) + '" data-p="' + _esc(p.id) + '"'
                + ' title="' + _esc(this._landingTitle(p)) + '">回到原处</button>'
                + '<button class="cm-reply-btn" type="button" data-cm-act="reply" data-r="answered" data-t="' + _esc(g.thread.id) + '" data-p="' + _esc(p.id) + '">已回应</button>'
                + '<button class="cm-reply-btn" type="button" data-cm-act="reply" data-r="later" data-t="' + _esc(g.thread.id) + '" data-p="' + _esc(p.id) + '">稍后</button>'
                + '<button class="cm-reply-btn" type="button" data-cm-act="reply" data-r="not-needed" data-t="' + _esc(g.thread.id) + '" data-p="' + _esc(p.id) + '">无需回应</button>'
                + '</span></li>'
            )).join('');
            return [
                '<div class="cm-reply-group" data-t="' + _esc(g.thread.id) + '">',
                '  <p class="cm-reply-who">' + _esc(g.thread.participant) + '</p>',
                '  <ul class="cm-reply-list">' + rows + '</ul>',
                '</div>',
            ].join('\n');
        }).join('');
        return [
            '<section class="cm-reply">',
            '  <h4 class="cm-reply-title">待回应</h4>',
            '  <p class="cm-reply-sub">消息、错过来电……逐项选择；回一项不收这段交流。</p>',
            groups,
            '</section>',
        ].join('\n');
    }
    /**
     * 回到原处的悬停说明：**由落地读数决定文案**，不写死「落到那一条」。
     *   本版 no-landing 是常态（三个来源都没有逐条定位口），文案必须如实说
     *   「只打开 X」；不然按钮长得像能落到那一条，用户点完会以为「这条没了」。
     */
    /** 按 (交流线 id, 接触点 id) 取那一条原始接触点（取不到返回空对象，让落地如实报 no-source）。 */
    _pointOf(tid, pid) {
        const list = this.app.live().concat(this.app.idle());
        for (const t of list) {
            if (String(t.id) !== String(tid)) continue;
            for (const p of (t.points || [])) if (String(p.id) === String(pid)) return p;
        }
        return {};
    }
    _landingTitle(p) {
        const land = this.app.landingOf(p);
        if (!land || !land.appId) return '这一条没登记来源，去不了';
        const who = APP_LABEL[land.appId] || land.appId;
        if (land.landed) return '落到' + who + '的那一条';
        return '只打开' + who + '（本版落不到具体那一条）';
    }
    _card(t) {
        /* ★ 读数一律向 App 取（口径在内核），视图**不自算** —— 自算即第二份口径。 */
        const c = this.app.countsOf(t.id);
        const r = this.app.resumeOf(t.id);
        const kind = this.app.stateOf(t.id);
        const attn = ATTN_LABEL[this.app.attentionOf(t.id)] || '已回';
        const bits = [];
        if (c.messages) bits.push(c.messages + ' 消息');
        if (c.sms) bits.push(c.sms + ' 短信');
        if (c.calls) bits.push(c.calls + ' 通话');
        if (c.missed) bits.push(c.missed + ' 漏接');
        if (!bits.length) bits.push('还没有接触点');
        const dang = r.endedOnMissed ? '<p class="cm-dangling">★ 最后一次接触是漏接，正悬着（该回拨，不算安静）</p>' : '';
        const wander = kind === 'unreadable'
            ? '<p class="cm-wander">这段有 ' + c.dropped + ' 条接触点读不出来，如实报，不猜。</p>'
            : '';
        const pnts = (t.points || []).slice(-4).map((p) => (
            '<li class="cm-pt">'
            + '<span class="cm-pt-kind cm-k-' + _esc(p.kind) + '">' + _esc(KIND_LABEL[p.kind] || p.kind) + '</span>'
            + '<span class="cm-pt-label">' + _esc(p.label || p.refId) + '</span>'
            + (p.direction === 'incoming'
                ? '<button class="cm-pt-btn" type="button" data-cm-act="seen" data-t="' + _esc(t.id) + '" data-p="' + _esc(p.id) + '">看过了</button>'
                + '<button class="cm-pt-btn" type="button" data-cm-act="answered" data-t="' + _esc(t.id) + '" data-p="' + _esc(p.id) + '">回过了</button>'
                : '')
            + '</li>'
        )).join('');
        return [
            '<article class="cm-card" data-t="' + _esc(t.id) + '">',
            '  <div class="cm-card-head">',
            '    <span class="cm-name">' + _esc(t.participant) + '</span>',
            '    <span class="cm-attn cm-attn-' + _esc(attn) + '">' + _esc(attn) + '</span>',
            '  </div>',
            '  <p class="cm-counts">' + _esc(bits.join('、')) + '</p>',
            wander,
            dang,
            (pnts ? '<ul class="cm-points">' + pnts + '</ul>' : ''),
            '  <div class="cm-acts">',
            '    <button class="cm-act" type="button" data-cm-act="close" data-t="' + _esc(t.id) + '">收束这段</button>',
            '  </div>',
            '</article>',
        ].join('\n');
    }
    _bind(host) {
        if (host.__cmBound) return;
        host.__cmBound = true;
        host.addEventListener('click', (e) => {
            const el = e && e.target && typeof e.target.closest === 'function' ? e.target.closest('[data-cm-act]') : null;
            if (!el) return;
            const act = String(el.dataset.cmAct || '');
            const t = String(el.dataset.t || '');
            const p = String(el.dataset.p || '');
            if (act === 'open') {
                const input = host.querySelector('.cm-new-name');
                const name = input ? String(input.value || '').trim() : '';
                if (!name) return;
                const res = this.app.open(name, '');
                if (res.ok && input) input.value = '';
                this.app.render(host);
                return;
            }
            if (act === 'reply') {
                const r = String(el.dataset.r || '');
                this.app.reply(t, p, r);
                this.app.render(host);
                return;
            }
            if (act === 'goto') {
                /* ★ 跳出去之前先把这一项的选择**记下来**：这是回到原处的入口，
                 *   不是「已回应」。不改 replyState —— 去了原处之后用户才决定怎么回。 */
                this.app.goto(this._pointOf(t, p));
                return;
            }
            if (act === 'seen') { this.app.markSeen(t, p); this.app.render(host); return; }
            if (act === 'answered') { this.app.markAnswered(t, p); this.app.render(host); return; }
            if (act === 'close') { this.app.close(t, ''); this.app.render(host); return; }
        });
    }
    }
export default CommsView;