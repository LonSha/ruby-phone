/* ========================================================
 * undercover-rules-view.js — [v4.190.0] 谁是卧底 · 规则视图
 * 纪律：_boundRoot === root 去重 / data-act 委派 / CSS 自注入 / 无 input 监听。
 * 界面是一座 6 人空桌：发身份 / 点死活 / 手动设身份 / 记发言推进 / 结算投票 / 看胜负。
 * ======================================================== */
'use strict';
import { PLAYER_COUNT, ROLES, UC_REJECT } from './undercover-rules.js';

const ROLE_LABELS = { civilian: '平民', undercover: '卧底' };

export class UndercoverRulesView {
    constructor(app, shell) {
        this.app = app;
        this.shell = shell;
        this._root = null;
        this._boundRoot = null;
        this._flash = '';
    }

    _ensureCss() {
        try {
            if (typeof document === 'undefined' || !document.head) return;
            if (document.getElementById('uc-rules-css')) return;
            const link = document.createElement('link');
            link.id = 'uc-rules-css';
            link.rel = 'stylesheet';
            link.href = new URL('./undercover-rules.css?v=1.0.0', import.meta.url).href;
            document.head.appendChild(link);
        } catch (_e) { /* 无头如实不注入 */ }
    }

    render() {
        this._ensureCss();
        const container = (this.shell && this.shell.getContentContainer) ? this.shell.getContentContainer() : null;
        if (!container) return;
        container.innerHTML = '';
        const root = document.createElement('div');
        root.className = 'uc-root';
        root.innerHTML = this._html();
        container.appendChild(root);
        this._root = root;
        this._bind(root);
    }

    refresh() {
        if (!this._root) { this.render(); return; }
        this._root.innerHTML = this._html();
    }

    _flashText(msg) { this._flash = msg || ''; this.refresh(); }

    _html() {
        const a = this.app;
        const rows = a.players.map((p) => {
            const role = p.role || '';
            const cls = p.alive === false ? 'dead' : (role === 'undercover' ? 'uc' : '');
            return '<tr class="' + cls + '" data-seat="' + p.seat + '">'
                + '<td>' + p.seat + '</td>'
                + '<td>' + (p.isUser ? '你' : String(p.name || '')) + '</td>'
                + '<td>' + (role ? ROLE_LABELS[role] : '—') + '</td>'
                + '<td>' + (p.alive === false ? '出局' : '在场') + '</td>'
                + '<td>'
                + '<button type="button" data-act="toggle" data-seat="' + p.seat + '">死活</button> '
                + '<button type="button" data-act="set-uc" data-seat="' + p.seat + '">设卧底</button> '
                + '<button type="button" data-act="set-cv" data-seat="' + p.seat + '">设平民</button>'
                + '</td></tr>';
        }).join('');

        const v = a.verdict();
        const verdict = v.winner === 'civilian' ? '平民阵营获胜'
            : v.winner === 'undercover' ? '卧底获胜' : '未分胜负（' + v.aliveCount + ' 人在场）';
        const last = a.lastResult ? (a.lastResult.eliminated
            ? ('上轮 ' + a.lastResult.eliminated.seat + ' 号出局（' + ROLE_LABELS[a.lastResult.eliminated.role] + '）')
            : '上轮平票，无人出局') : '还没有结算过';

        return '<div class="uc-head">'
            + '<div class="uc-title">谁是卧底 · 规则试算台</div>'
            + '<div class="uc-sub">6 人桌 · 随机源由调用方给（同一 rng 序列 = 同一局）</div>'
            + '</div>'
            + '<div class="uc-bar">'
            + '<button type="button" data-act="deal">发身份</button>'
            + '<button type="button" data-act="speak">当前座位发言</button>'
            + '<button type="button" data-act="vote">结算投票</button>'
            + '<span class="uc-state">回合 ' + a.round + ' · ' + a.phase + ' · 当前 ' + a.currentSpeakerSeat + ' 号</span>'
            + '</div>'
            + (this._flash ? '<div class="uc-flash">' + this._flash + '</div>' : '')
            + '<table class="uc-table"><thead><tr><th>座</th><th>谁</th><th>身份</th><th>状态</th><th>操作</th></tr></thead>'
            + '<tbody>' + rows + '</tbody></table>'
            + '<div class="uc-foot">'
            + '<div>词对：' + (a.wordPair.civilian ? ('平民「' + a.wordPair.civilian + '」/ 卧底「' + a.wordPair.undercover + '」') : '未设（点「发身份」前先设词对）') + '</div>'
            + '<div>卧底座位：' + (a.undercoverSeat ? a.undercoverSeat + ' 号' : '未发') + '</div>'
            + '<div>胜负读数：' + verdict + '</div>'
            + '<div>' + last + '</div>'
            + '</div>'
            + '<div class="uc-word">'
            + '<label>平民词 <input data-act="word-cv" type="text" value=""></label>'
            + '<label>卧底词 <input data-act="word-uc" type="text" value=""></label>'
            + '<button type="button" data-act="set-word">设词对</button>'
            + '</div>';
    }

    _bind(root) {
        if (this._boundRoot === root) return;
        this._boundRoot = root;
        root.addEventListener('click', (ev) => {
            const btn = ev.target && ev.target.closest ? ev.target.closest('[data-act]') : null;
            if (!btn) return;
            const act = btn.getAttribute('data-act');
            const seat = Number(btn.getAttribute('data-seat') || 0);
            if (act === 'toggle') {
                const r = this.app.toggleAlive(seat);
                this._flashText(r.ok ? '' : ('没这个座位：' + r.reason));
            } else if (act === 'set-uc') {
                const r = this.app.setRole(seat, 'undercover');
                this._flashText(r.ok ? '' : ('设不了：' + r.reason));
            } else if (act === 'set-cv') {
                const r = this.app.setRole(seat, 'civilian');
                this._flashText(r.ok ? '' : ('设不了：' + r.reason));
            } else if (act === 'deal') {
                const r = this.app.deal(null);
                this._flashText(r.ok ? ('卧底在 ' + r.undercoverSeat + ' 号') : ('发不了：' + r.reason));
            } else if (act === 'speak') {
                const r = this.app.speak(this.app.currentSpeakerSeat, '我说一句');
                this._flashText(r.ok ? ('切到 ' + this.app.currentSpeakerSeat + ' 号') : ('说不了：' + r.reason));
            } else if (act === 'vote') {
                const r = this.app.vote([], null);
                this._flashText(r.ok ? r.text : ('结算不了：' + r.reason));
            } else if (act === 'set-word') {
                const cv = root.querySelector('[data-act="word-cv"]');
                const uc = root.querySelector('[data-act="word-uc"]');
                const r = this.app.setWordPair(cv ? cv.value : '', uc ? uc.value : '');
                this._flashText(r.ok ? ('词对已设' + (r.fromFallback ? '（落到兜底池）' : '')) : ('设不了：' + r.reason));
            }
        });
    }
}

export { ROLE_LABELS, PLAYER_COUNT, ROLES, UC_REJECT };
export default UndercoverRulesView;