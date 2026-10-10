/* ========================================================
 * backupdesk-view.js — [v3.91.0 · 拓展计划 R-X7] 本地备份与恢复 · 视图（纯渲染）
 * 挂载走 shell.getContentContainer；与号/尖括号走拼装形（不在模板串里出现裸尖括号）。
 *
 * 【本视图刻意不做的事】
 *   · **动作白名单只有四个**：export / preview / commit / undo（data-bk-act）。
 *   · **不写存储 / 不读文件 / 不发网络**：一切转 app.act()，由咽喉收口。
 *   · **不自己判**：分面 / 冲突 / 迁移的名与文案全部来自内核。
 * ========================================================= */
'use strict';
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
const STATE_LABEL = {
    new: '新增', restore: '还原', conflict: '冲突', rejected: '拒收', identical: '逐字相同',
};
export class BackupdeskView {
    constructor(app) { this.app = app; this.root = null; }
    _mount() {
        if (this.root && this.root.isConnected) return this.root;
        const shell = this.app && this.app.shell;
        const container = shell && typeof shell.getContentContainer === 'function' ? shell.getContentContainer() : null;
        if (!container) return null;
        container.innerHTML = '';
        const root = document.createElement('div');
        root.className = 'bk-root';
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
        let h = '<div class="bk-head">';
        h += '<div class="bk-title">本地备份与恢复</div>';
        h += '<div class="bk-sub">导出范围 → 包体身份 → 迁移判定 → 导入计划 → 提交／撤销（导入前不改现有数据）</div>';
        h += '<div class="bk-reads">' + esc(vm.keysText) + '</div>';
        h += '<div class="bk-reads">' + esc(vm.ledgerText) + '</div>';
        h += '<div class="bk-reads">' + esc(vm.cloudLine) + '</div>';
        h += '<div class="bk-reads">' + (vm.scopeOk ? '会话身份齐备' : '会话身份缺项（缺项即判「不是同一段」，一律不开工）') + '</div>';
        const sc = vm.selfCheck || {};
        const probs = sc.problems || [];
        h += '<div class="bk-self' + (probs.length ? ' bk-self-bad' : '') + '">' +
            (probs.length ? ('自检 ' + String(probs.length) + ' 项：' + esc(probs.slice(0, 3).join('；'))) : ('自检通过（范围维度 ' + String(sc.dims) + ' / 分面 ' + String(sc.scopes) + ' / 迁移步 ' + String(sc.migrations) + ' / schema v' + String(sc.schema) + '）')) +
            '</div>';
        if (vm.flash) h += '<div class="bk-flash' + (vm.flashBad ? ' bk-flash-bad' : '') + '">' + esc(vm.flash) + '</div>';
        return h + '</div>';
    }
    _range(vm) {
        let h = '<div class="bk-box"><h3>导出范围（四维取交集；不选则不限制）</h3>';
        for (const dim of (vm.dims || [])) {
            const values = (vm.dimValues && vm.dimValues[dim]) || [];
            const picked = (vm.picked && vm.picked[dim]) || [];
            h += '<div class="bk-dim"><span class="bk-dim-k">' + esc(dim) + '</span>';
            if (!values.length) h += '<span class="bk-dim-empty">本机读不到这一维的可选值</span>';
            for (const v of values) {
                const on = picked.indexOf(v) >= 0;
                h += '<button class="bk-chip' + (on ? ' bk-chip-on' : '') + '" data-bk-dim="' + esc(dim) + '" data-bk-val="' + esc(v) + '">' + esc(v) + '</button>';
            }
            h += '</div>';
        }
        return h + '</div>';
    }
    _plan(vm) {
        let h = '<div class="bk-box"><h3>导入计划（导入前不改现有数据）</h3>';
        h += '<div class="bk-plan">' + esc(vm.planLine) + '</div>';
        h += '<div class="bk-note">冲突处置：';
        for (const mode of ['keep', 'overwrite', 'skip']) {
            const label = mode === 'keep' ? '保留本机' : (mode === 'overwrite' ? '用包覆盖' : '跳过冲突');
            h += '<button class="bk-chip' + (vm.onConflict === mode ? ' bk-chip-on' : '') + '" data-bk-conflict="' + esc(mode) + '">' + esc(label) + '</button>';
        }
        h += '（默认保留本机；逐字相同的条目一律不写）</div>';
        if (vm.identical) h += '<div class="bk-note">逐字相同 ' + String(vm.identical) + ' 条：重复导入不产生任何写入（幂等）</div>';
        for (const r of (vm.planRows || [])) {
            const cls = r.state === 'conflict' ? ' bk-row-conflict' : (r.state === 'rejected' ? ' bk-row-bad' : '');
            h += '<div class="bk-row' + cls + '"><span class="bk-row-k">' + esc(String(STATE_LABEL[r.state] || r.state)) + '</span>'
                + '<span class="bk-row-v">' + esc(r.key) + ' · ' + esc(String(r.scope)) + (r.app ? (' · ' + esc(r.app)) : '') + ' · ' + esc(String(r.why || '')) + '</span></div>';
        }
        if (vm.undo) {
            h += '<div class="bk-note">撤销清单 ' + String(vm.undo.count) + ' 项：' + esc(vm.undo.note) + '</div>';
        }
        h += '<div class="bk-acts">';
        h += '<button class="bk-btn" data-bk-act="export">导出包（预览读数）</button>';
        h += '<button class="bk-btn" data-bk-act="preview">预览导入（只读）</button>';
        h += '<button class="bk-btn bk-btn-go" data-bk-act="commit">确认导入</button>';
        h += '<button class="bk-btn" data-bk-act="undo">撤销本次导入</button>';
        h += '</div></div>';
        return h;
    }
    _html(vm) {
        let h = '<div class="bk-wrap">';
        h += this._head(vm);
        h += this._range(vm);
        h += this._plan(vm);
        h += '</div>';
        return h;
    }
    _bind(el) {
        const self = this;
        el.querySelectorAll('[data-bk-dim]').forEach(function (b) {
            b.addEventListener('click', function () { self.app.setDim(b.getAttribute('data-bk-dim'), b.getAttribute('data-bk-val')); });
        });
        el.querySelectorAll('[data-bk-conflict]').forEach(function (b) {
            b.addEventListener('click', function () { self.app.setConflict(b.getAttribute('data-bk-conflict')); });
        });
        el.querySelectorAll('[data-bk-act]').forEach(function (b) {
            b.addEventListener('click', function () { self.app.act(b.getAttribute('data-bk-act')); });
        });
    }
}
