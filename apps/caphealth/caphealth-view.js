/* ========================================================
 * caphealth-view.js — [v3.92.0 · 拓展计划 R-X8] 宿主与能力健康中心 · 视图（纯渲染）
 * 挂载走 shell.getContentContainer；与号/尖括号走拼装形（不在模板串里出现裸尖括号）。
 *
 * 【本视图刻意不做的事】
 *   · **动作白名单只有一个**：report（data-ch-act）—— 「受限」即「认得出的动作有限」。
 *   · **不检测**：本层不 fetch、不碰浏览器能力探针、不写存储；一切转 app.act()。
 *   · **不自己判**：四态文案与替代操作全部来自内核（CAP_STATE_TEXT / CAP_FALLBACKS）。
 *   · **不只用颜色区分状态**：每一行都带**文字**（stateText）——禁用色即可读（见验收④）。
 * ========================================================= */
'use strict';
import { CAP_STATE_TEXT } from '../../config/capability-health.js';
const AMP = String.fromCharCode(38);
const LT = String.fromCharCode(60);
const GT = String.fromCharCode(62);
const QUOTE = String.fromCharCode(34);
const QUOTE_ESC = AMP + 'quot;';
function esc(s) {
    return String(s === undefined || s === null ? '' : s)
        .split(AMP).join(AMP + 'amp;')
        .split(LT).join(AMP + 'lt;')
        .split(GT).join(AMP + 'gt;')
        .split(QUOTE).join(QUOTE_ESC);
}
/* 状态 → 样式后缀（**不是**第二份文案表：文案唯一实现在内核，这里只挑类名）。
 *   缺省后缀取未验证 —— 认不出的状态不得被渲染成「可用」。 */
const STATE_CLS = { ok: 'cph-ok', partial: 'cph-part', unavailable: 'cph-bad', unverified: 'cph-un' };
const clsOf = (s) => STATE_CLS[s] || 'cph-un';

export class CaphealthView {
    constructor(app) { this.app = app; this.root = null; }
    _mount() {
        if (this.root && this.root.isConnected) return this.root;
        const shell = this.app && this.app.shell;
        const container = shell && typeof shell.getContentContainer === 'function' ? shell.getContentContainer() : null;
        if (!container) return null;
        container.innerHTML = '';
        const root = document.createElement('div');
        root.className = 'cph-root';
        container.appendChild(root);
        this.root = root;
        return this.root;
    }
    render(vm) {
        const el = this._mount();
        if (!el) return;
        el.innerHTML = this._html(vm);
        this._bind(el);
    }
    _head(vm) {
        let h = '<div class="cph-head">';
        h += '<div class="cph-title">宿主与能力健康</div>';
        h += '<div class="cph-sub">每项能力四态分开：可用 / 部分可用 / 不可用 / 未验证（没测过不等于坏）</div>';
        /* 功能点 ①：宿主版本与上游版本 —— 与「能力四态」分开摆（前者是身份，后者是处境）。 */
        h += '<div class="cph-reads">' + esc(vm.hostVersionLine) + '</div>';
        h += '<div class="cph-reads">' + esc(vm.summaryLine) + '</div>';
        if (!vm.faceReadable) {
            h += '<div class="cph-reads cph-face-bad">' + esc(vm.faceWhy) + '</div>';
        }
        const sc = vm.selfCheck || {};
        const probs = sc.problems || [];
        h += '<div class="cph-self' + (probs.length ? ' cph-self-bad' : '') + '">' +
            (probs.length ? ('自检 ' + String(probs.length) + ' 项：' + esc(probs.slice(0, 3).join('；')))
                : ('自检通过（四态 ' + String(sc.states) + ' / 能力 ' + String(sc.capabilities) + ' / 替代操作组 ' + String(sc.fallbacks) + '）')) +
            '</div>';
        /* 验收③的可见证据：检测本身零写入、零模型调用（判定内核零 import 零 IO）。 */
        h += '<div class="cph-zero">本页只读：取数不写存储、不发网络、不调模型（写入计数 ' + (vm.zeroWrite ? '0' : '未知') + '）</div>';
        if (vm.flash) h += '<div class="cph-flash' + (vm.flashBad ? ' cph-flash-bad' : '') + '">' + esc(vm.flash) + '</div>';
        return h + '</div>';
    }
    _rows(vm) {
        let h = '<div class="cph-box"><h3>能力面（六项：搜索 / 记忆 / 图片 / 语音 / 通知 / 恢复交接）</h3>';
        const rows = vm.rows || [];
        if (!rows.length) h += '<div class="cph-note">能力读数还没取到（这不是「全部不可用」）</div>';
        for (const r of rows) {
            const cls = clsOf(r.state);
            h += '<div class="cph-row"><span class="cph-badge ' + cls + '">' + esc(r.label) + '</span>';
            /* 状态既给符号又给文字：符号是「不只依赖颜色」的落点，文字是唯一文案（内核给）。 */
            h += '<span class="cph-state">' + esc(symOf(r.state)) + ' ' + esc(r.stateText || CAP_STATE_TEXT[r.state] || '') + '</span></div>';
            if (r.why) h += '<div class="cph-why">' + esc(r.why) + '</div>';
            /* 验收②：缺能力时必须给替代操作（不可用与部分可用才给；未验证不需要）。 */
            if (r.state === 'unavailable' || r.state === 'partial') {
                h += '<div class="cph-fb">替代操作（顺序即优先级）：' + esc((r.fallbacks || []).join(' -> ')) + '</div>';
            } else if (r.state === 'unverified') {
                h += '<div class="cph-note">现在不必动手：跑一次才知道（未验证不是坏）</div>';
            }
        }
        return h + '</div>';
    }
    _cross(vm) {
        let h = '<div class="cph-box"><h3>跨仓联动（双项目版本）</h3>';
        h += '<div class="cph-note">' + esc(vm.noticeLine) + '</div>';
        if (vm.notice && vm.notice.stale) {
            h += '<div class="cph-why">版本读不出与版本偏低是两件事（处置相反）：读不出 -> 确认装没装；偏低 -> 升级</div>';
        }
        if (vm.notice && (vm.notice.missing || []).length) {
            h += '<div class="cph-why">' + esc('读不出的上游：' + vm.notice.missing.join('、')) + '</div>';
        }
        if (vm.notice && (vm.notice.outdated || []).length) {
            h += '<div class="cph-why">' + esc('版本偏低的上游：' + vm.notice.outdated.join('、')) + '</div>';
        }
        return h + '</div>';
    }
    _rep(vm) {
        let h = '<div class="cph-box"><h3>诊断报告</h3>';
        h += '<div class="cph-acts"><button class="cph-btn" data-ch-act="report" type="button">复制诊断报告</button></div>';
        if (vm.report) h += '<pre class="cph-pre">' + esc(vm.report) + '</pre>';
        else h += '<div class="cph-note">尚未生成（「复制」不会触发任何检测 —— 报告只用已判定的读数拼）</div>';
        return h + '</div>';
    }
    _html(vm) {
        let h = '<div class="cph-wrap">';
        h += this._head(vm);
        h += this._rows(vm);
        h += this._cross(vm);
        h += this._rep(vm);
        h += '</div>';
        return h;
    }
    _bind(el) {
        const self = this;
        el.querySelectorAll('[data-ch-act]').forEach(function (b) {
            b.addEventListener('click', function () { self.app.act(b.getAttribute('data-ch-act')); });
        });
    }
}
/* 状态符号（「重要状态不只依赖颜色」的落点；这里是**辅助**，不是唯一信息源 ——
 *   每一行同时给出内核文案，符号只是为了在颜色失效时仍可分辨（灰度/色盲/高对比模式）。 */
function symOf(state) {
    if (state === 'ok') return '[可用]';
    if (state === 'partial') return '[部分]';
    if (state === 'unavailable') return '[不可用]';
    return '[未验证]';
}
