/* ========================================================
 * backupdesk-view.js — [v3.91.0 · 拓展计划 R-X7] 本地备份与恢复 · 视图（纯渲染）
 * 挂载走 shell.getContentContainer；与号/尖括号走拼装形（不在模板串里出现裸尖括号）。
 *
 * 【本视图刻意不做的事】
 *   · **包面动作白名单只有四个**：export / preview / commit / undo（data-bk-act）。
 *   · **恢复快照面动作白名单只有四个**（v4.96.0 起）：capture / diff / restore / inspect
 *     （data-bk-snapact）—— 两族刻意不同名：包面动作走宿主咽喉，快照面动作走本 App 的内核读写口，
 *     混在一个 data-* 里会让人以为它们是同一层（它们的失败回执来源真的不同）。
 *   · **不写存储 / 不读文件 / 不发网络**：一切转 app 口，由咽喉或本 App 的读写口收口。
 *   · **不自己判**：分面 / 冲突 / 迁移 / 快照差异的名与文案全部来自内核。
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
    /**
     * [v4.99.8 · R11-X4] 分享与迁移审阅面：起草 / 收件人视角 / 撤回留痕。
     *   三件事都是**读得出与读不出分两句**（台账读不到就明说读不到，不画成「没分享过」）。
     *   五态授权（全文 / 遮蔽 / 无权 / 过期 / 撤回）的文案全部来自桥的 `label` ——
     *   本视图**不写任何一个授权态字面量**，写一个就是第二份口径。
     */
    _share(vm) {
        const s = vm.share || {};
        let h = '<div class="bk-box bk-share"><h3>分享与迁移审阅（先看收件人看到什么，再决定发不发）</h3>';
        h += '<div class="bk-note">' + esc(s.text || '') + '</div>';
        if (s.flash) h += '<div class="bk-flash' + (s.flashBad ? ' bk-flash-bad' : '') + '">' + esc(s.flash) + '</div>';
        if (s.empty) h += '<div class="bk-note">这个会话还没起草过分享。</div>';
        for (const r of (s.rows || [])) {
            h += '<div class="bk-row' + (r.pick ? ' bk-row-picked' : '') + (r.revoked ? ' bk-row-revoked' : '') + '">' +
                '<span class="bk-row-k">' + esc(r.id) + '</span>' +
                '<span class="bk-row-v">' + esc(r.snippet || '') + ' · ' + esc(r.line || '') + '</span>' +
                '<button class="bk-chip" data-bk-shareact="pick" data-bk-share="' + esc(r.id) + '">看这份</button>' +
                '<button class="bk-chip" data-bk-shareact="revoke" data-bk-share="' + esc(r.id) + '">撤回</button>' +
                '</div>';
        }
        /* 收件人选择：只列这份草案的受众 —— 名单之外的人本来就没授权，列出来会让人以为能给他看。 */
        const audience = s.audience || [];
        if (s.pick && audience.length) {
            h += '<div class="bk-note">按收件人看：';
            for (const who of audience) {
                h += '<button class="bk-chip" data-bk-shareact="viewer" data-bk-viewer="' + esc(who) + '">' + esc(who) + '</button>';
            }
            h += '</div>';
        }
        if (s.preview) {
            h += '<div class="bk-note">收件人视角 · ' + esc(s.preview.viewer || '（未选）') + '：' + esc(s.preview.label || '') + '</div>';
            /* 只有 readable 时才画内容：不可读却画一行空白，等于让用户以为「他什么都没看到」。 */
            if (s.preview.readable) {
                h += '<div class="bk-row bk-row-hear"><span class="bk-row-k">他会看到</span><span class="bk-row-v">' + esc(s.preview.content || '') + '</span></div>';
                /* [v4.99.8 · R11-X4] 「记他读过了」是真写盘的一步，与「看他会看到什么」分开：
                 *   没有这个入口，「撤回前已读 N 人」这句留痕在界面上永远是 0 人。
                 */
                h += '<button class="bk-chip" data-bk-shareact="read" data-bk-share="' + esc(s.pick || '') + '" data-bk-reader="' + esc(s.preview.viewer || '') + '">记他读过了</button>';
            }
            if (s.preview.masked) h += '<div class="bk-note">敏感处已遮蔽 —— 他看到的与你写的**不是同一份**</div>';
            if (s.preview.why) h += '<div class="bk-note">判据原话：' + esc(s.preview.why) + '</div>';
        }
        /* [v4.99.8 · R11-X4] 创作者包计划：审过才画。被安全阻断时**不画成警告色**，
         *   而是明确的「装不了」—— 与「缺依赖能装」是两句不同的话（同一处口径在桥里）。 */
        if (s.bundle) {
            h += '<div class="bk-row' + (s.bundle.blocked ? ' bk-row-revoked' : '') + '">' +
                '<span class="bk-row-k">创作者包</span>' +
                '<span class="bk-row-v">' + esc(s.bundle.label || '') + '</span></div>';
        }
        const sc = s.selfCheck || {};
        const probs = sc.problems || [];
        h += '<div class="bk-self' + (probs.length ? ' bk-self-bad' : '') + '">' +
            (probs.length ? ('授权自检 ' + String(probs.length) + ' 项：' + esc(probs.slice(0, 3).join('；'))) : '授权自检通过（三级范围 / 五态授权）') +
            '</div>';
        h += '<div class="bk-acts">';
        h += '<button class="bk-btn bk-btn-go" data-bk-shareact="draft">起草一份分享（示例草案）</button>';
        /* 创作者包审阅走同一族动作（失败回执来源相同：都是「本 App 调内核拿读数」）。
         *   与上面那份示例草案一样是示例包 —— 真包体由宿主给，本面不自己造包。 */
        h += '<button class="bk-btn" data-bk-shareact="bundle">审阅一个创作者包（示例包）</button>';
        h += '</div></div>';
        return h;
    }
    _html(vm) {
        let h = '<div class="bk-wrap">';
        h += this._head(vm);
        h += this._range(vm);
        h += this._plan(vm);
        h += this._snap(vm);
        h += this._share(vm);
        h += '</div>';
        return h;
    }
    /**
     * [v4.96.0 · R11-O3 第二批] 恢复快照面：拍点 / 差异 / 选择性还原（与包面同一屏的下半段）。
     *   四件事都是**读得出与读不出分两句**：台账读不出就明说读不出，不画成「没有恢复点」。
     */
    _snap(vm) {
        const s = vm.snap || {};
        let h = '<div class="bk-box bk-snap"><h3>恢复快照（拍点 → 差异 → 只还原选中的键）</h3>';
        h += '<div class="bk-note">' + esc(s.text || '') + '</div>';
        if (s.flash) h += '<div class="bk-flash' + (s.flashBad ? ' bk-flash-bad' : '') + '">' + esc(s.flash) + '</div>';
        if (s.empty) h += '<div class="bk-note">还没有拍过恢复点。</div>';
        for (const r of (s.rows || [])) {
            h += '<div class="bk-row' + (r.picked ? ' bk-row-picked' : '') + '">' +
                '<span class="bk-row-k">' + esc(r.label) + '</span>' +
                '<span class="bk-row-v">' + esc(r.id) + ' · ' + String(r.keyCount) + ' 键</span>' +
                '<button class="bk-chip" data-bk-snapact="diff" data-bk-snap="' + esc(r.id) + '">比差异</button>' +
                '<button class="bk-chip" data-bk-snapact="restore" data-bk-snap="' + esc(r.id) + '">还原变更键</button>' +
                '</div>';
        }
        if (s.diff) {
            h += '<div class="bk-note">' + esc(s.diff.label || s.diff.id) + '：' + esc(s.diff.line) + '</div>';
            if ((s.diff.modified || []).length) h += '<div class="bk-row"><span class="bk-row-k">变更</span><span class="bk-row-v">' + esc(s.diff.modified.join('、')) + '</span></div>';
            if ((s.diff.added || []).length) h += '<div class="bk-row"><span class="bk-row-k">新增</span><span class="bk-row-v">' + esc(s.diff.added.join('、')) + '</span></div>';
            if ((s.diff.removed || []).length) h += '<div class="bk-row"><span class="bk-row-k">移除</span><span class="bk-row-v">' + esc(s.diff.removed.join('、')) + '</span></div>';
        }
        if (s.inspect) h += '<div class="bk-note">' + esc(s.inspect.text) + '</div>';
        h += '<div class="bk-acts">';
        h += '<button class="bk-btn bk-btn-go" data-bk-snapact="capture">拍一个恢复点</button>';
        h += '<button class="bk-btn" data-bk-snapact="inspect">体检最近一个包</button>';
        h += '</div></div>';
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
        /* 快照面：四个动作一一对应 App 上的四个口，中间没有第二种转法。 */
        el.querySelectorAll('[data-bk-snapact]').forEach(function (b) {
            b.addEventListener('click', function () {
                const act = b.getAttribute('data-bk-snapact');
                const id = b.getAttribute('data-bk-snap');
                if (act === 'capture') self.app.captureSnapshot('手动恢复点');
                else if (act === 'diff') self.app.diffSnapshot(id);
                else if (act === 'restore') {
                    /* 「还原变更键」= 只还原差异里**变更**那一组：新增/移除键要么本机已没有、要么快照里没有，
                     *   一次性全量写回等于把用户后来新增的数据抹掉。要全量的人可先比差异再逐个键处理。 */
                    const d = self.app._snapDiff;
                    if (!d || d.id !== id) { self.app.diffSnapshot(id); return; }
                    const full = (d.diff.modified || []).map(function (k) { return k; });
                    self.app.restoreSnapshotKeys(id, full);
                } else if (act === 'inspect') {
                    const host = self.app.host();
                    const pack = host && host.pack ? host.pack : null;
                    self.app.inspectPayload(pack);
                }
            });
        });
        /* [v4.99.8 · R11-X4] 分享面：四个动作对应 App 上四个口（pick / viewer 是纯视图态，
         *   draft / revoke 走内核）。★ 「预览」不是动作 —— 选人之后就自动算，
         *   让它成一个按钮会让人以为「点了才算过一遍」。 */
        el.querySelectorAll('[data-bk-shareact]').forEach(function (b) {
            b.addEventListener('click', function () {
                const act = b.getAttribute('data-bk-shareact');
                const id = b.getAttribute('data-bk-share');
                if (act === 'pick') self.app.pickShare(id);
                else if (act === 'viewer') self.app.setShareViewer(b.getAttribute('data-bk-viewer'));
                else if (act === 'revoke') self.app.revokeShare(id, '');
                else if (act === 'read') {
                    /* 记一次已读：预览不替对方记账，这一步才记（会写盘）。 */
                    self.app.markShareRead(id, b.getAttribute('data-bk-reader'));
                }
                else if (act === 'draft') {
                    self.app.draftShare({
                        snippet: '（示例）这段内容是这段会话里的一段回忆，先看看对方会看到什么。',
                        scope: 'private_one_to_one',
                        recipients: ['对方'],
                        reshareable: false,
                    });
                } else if (act === 'bundle') {
                    /* 示例包：主题 + 规则都带、**故意不带 programs** —— 好让「缺依赖提示」
                     *   这一种形态在界面上真的出现过一次。从未出现过的话，用户第一次遇到
                     *   真包缺节目单时会以为是坏了。 */
                    self.app.planBundle({
                        name: '（示例）夜灯主题包',
                        theme: true,
                        rules: true,
                        assets: true,
                    }, { modules: ['theme', 'rules', 'programs'] });
                }
            });
        });
    }
}
