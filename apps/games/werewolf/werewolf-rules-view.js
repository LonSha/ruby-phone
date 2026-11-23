/* ========================================================
 * werewolf-rules-view.js — [v4.189.0] 狼人杀规则 · 视图
 * 纪律：_boundRoot 去重 / data-act 委派 / CSS 自注入 / 无 input 监听。
 * 界面是一座 8 人空桌：发身份 / 改一个身份 / 点死活 / 推夜晚步骤 / 看胜负。
 * ======================================================== */
'use strict';
import { ROLE_POOL, NIGHT_STEPS, NIGHT_STEP_LABELS, REVEAL_MODES } from './werewolf-rules.js';

export class WerewolfRulesView {
    constructor(app, shell) {
        this.app = app; this.shell = shell;
        this._root = null; this._boundRoot = null; this._flash = '';
    }

    _ensureCss() {
        try {
            if (typeof document === 'undefined' || !document.head) return;
            if (document.getElementById('ww-rules-css')) return;
            const link = document.createElement('link');
            link.id = 'ww-rules-css'; link.rel = 'stylesheet';
            link.href = new URL('./werewolf-rules.css?v=1.0.0', import.meta.url).href;
            document.head.appendChild(link);
        } catch (_e) { /* 无头如实不注入 */ }
    }

    render() {
        this._ensureCss();
        const container = (this.shell && this.shell.getContentContainer) ? this.shell.getContentContainer() : null;
        if (!container) return;
        container.innerHTML = '';
        const root = document.createElement('div');
        root.className = 'ww-root';
        root.innerHTML = this._html();
        container.appendChild(root);
        this._root = root; this._bind(root);
    }

    refresh() {
        if (!this._root) { this.render(); return; }
        this._root.innerHTML = this._html();
        this._bind(this._root);
    }

    _html() {
        const app = this.app;
        const flash = this._flash ? '<div class="ww-flash">' + this._flash + '</div>' : '';
        const seats = app.players.map((p) => {
            const alive = p.alive !== false;
            const shown = app.revealMode === 'open' || p.isUser ? (p.role || '未发') : '?';
            return (
                '<div class="ww-seat' + (alive ? '' : ' is-dead') + (p.isUser ? ' is-user' : '') + '">'
                + '<div class="ww-seatno">' + p.seat + (p.isUser ? ' · 你' : '') + '</div>'
                + '<div class="ww-role">' + shown + '</div>'
                + '<div class="ww-seatacts">'
                + '<button class="ww-mini" type="button" data-act="toggle" data-seat="' + p.seat + '">' + (alive ? '杀' : '救') + '</button>'
                + '<button class="ww-mini" type="button" data-act="cycle" data-seat="' + p.seat + '">换身份</button>'
                + '</div>'
                + '</div>'
            );
        }).join('');

        const v = app.verdict();
        const verdictText = v.ok
            ? (v.winner === 'good' ? '好人胜' : v.winner === 'wolves' ? '狼人胜' : '未分胜负（狼 ' + v.wolves + ' / 非狼 ' + v.nonWolves + '）')
            : '读不出：' + v.reason;
        const stepRow = NIGHT_STEPS.map((s) => (
            '<button class="ww-step' + (app.nightStep === s ? ' is-on' : '') + '" type="button" data-act="step" data-step="' + s + '">'
            + NIGHT_STEP_LABELS[s] + '</button>'
        )).join('');
        const modeRow = REVEAL_MODES.map((m) => (
            '<button class="ww-mode' + (app.revealMode === m ? ' is-on' : '') + '" type="button" data-act="mode" data-mode="' + m + '">' + m + '</button>'
        )).join('');
        const cur = app.currentRole();

        return (
            '<div class="ww-head">'
            + '<button class="ww-back" type="button" data-act="back">‹</button>'
            + '<div class="ww-title">规则试算</div>'
            + '<div class="ww-alive">活 ' + app.aliveCount() + '/' + ROLE_POOL.length + '</div>'
            + '</div>'
            + flash
            + '<div class="ww-sec-t">判定：' + verdictText + '</div>'
            + '<div class="ww-sec-t">夜晚步骤（当前该 ' + (cur.ok ? cur.role : '?') + ' 动）</div>'
            + '<div class="ww-steps">' + stepRow
            + '<button class="ww-next" type="button" data-act="nextstep">下一步</button></div>'
            + '<div class="ww-sec-t">揭示模式</div>'
            + '<div class="ww-modes">' + modeRow + '</div>'
            + '<div class="ww-sec-t">座位（' + app.players.length + ' 人）</div>'
            + '<div class="ww-seats">' + seats + '</div>'
            + '<div class="ww-foot">'
            + '<button class="ww-btn" type="button" data-act="deal">发身份</button>'
            + '<button class="ww-btn ww-btn-ghost" type="button" data-act="resetstep">回到第一夜</button>'
            + '</div>'
        );
    }

    _bind(root) {
        if (this._boundRoot === root) return;
        this._boundRoot = root;
        root.addEventListener('click', (ev) => this._onClick(ev));
    }

    _onClick(ev) {
        const el = ev.target && ev.target.closest ? ev.target.closest('[data-act]') : null;
        if (!el) return;
        const act = el.getAttribute('data-act');
        if (act === 'back') { if (this.shell && this.shell.goHome) this.shell.goHome(); return; }
        if (act === 'toggle') { this.app.toggleAlive(el.getAttribute('data-seat')); this.refresh(); return; }
        if (act === 'cycle') {
            const seat = Number(el.getAttribute('data-seat'));
            const p = this.app.players.filter((x) => Number(x.seat) === seat)[0];
            const pool = ROLE_POOL.filter((r) => r !== p.role);
            const next = pool[(Math.floor(Date.now() / 1000) + seat) % pool.length];
            const r = this.app.setRole(seat, next);
            this._flash = r.ok ? (seat + ' 号 → ' + next) : ('没换成：' + r.reason);
            this.refresh(); return;
        }
        if (act === 'deal') {
            const r = this.app.deal();
            this._flash = r.ok ? ('已发 ' + r.roles.length + ' 个身份') : ('发不出：' + r.reason);
            this.refresh(); return;
        }
        if (act === 'nextstep') {
            const r = this.app.nextStep();
            this._flash = r.ok ? (r.done ? '夜晚走完，转白天' : ('下一步 → ' + r.next)) : ('推不动：' + r.reason);
            this.refresh(); return;
        }
        if (act === 'resetstep') { this.app.resetStep(); this._flash = '回到第一夜'; this.refresh(); return; }
        if (act === 'mode') {
            const r = this.app.setRevealMode(el.getAttribute('data-mode'));
            this._flash = r.ok ? ('揭示模式 → ' + r.mode) : ('模式认不出：' + r.reason);
            this.refresh(); return;
        }
        if (act === 'step') {
            const s = el.getAttribute('data-step');
            const r = this.app.roleForStep ? this.app.roleForStep(s) : { ok: true };
            this._flash = r.ok ? '' : '步骤认不出';
            this.refresh();
        }
    }
}

export { ROLE_POOL, NIGHT_STEPS, REVEAL_MODES };
export default WerewolfRulesView;
