/* ========================================================
 * accessdesk-view.js — [v3.93.0 · 拓展计划 R-X9] 无障碍操作台 · 视图（纯渲染）
 * 挂载走 shell.getContentContainer；与号/尖括号走拼装形（不在模板串里出现裸尖括号）。
 *
 * 【本视图刻意不做的事】
 *   · 动作白名单只有四个 data-ax-act 值：level / compact / theme / preview。
 *   · 不检测、不写 storage、不碰 documentElement —— 一切转 app.act() 交咽喉。
 *   · 不只靠颜色：每个开关都带**文字**（当前值写在标签旁），状态行带文字与符号。
 *   · 放大量与窄屏：类名与 data-ax-* 全部来自内核的 guard（视图不自己算断点）。
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
const LEVEL_TEXT = { standard: '标准', enhanced: '增强', large: '大字号' };
const THEME_TEXT = { auto: '跟随系统', light: '浅色', dark: '深色' };
const SOURCE_TEXT = { user: '你自己选的', policy: '跟随系统设置', default: '默认值' };

export class AccessdeskView {
    constructor(app) { this.app = app; this.root = null; }
    _mount() {
        if (this.root && this.root.isConnected) return this.root;
        const shell = this.app && this.app.shell;
        const container = shell && typeof shell.getContentContainer === 'function' ? shell.getContentContainer() : null;
        if (!container) return null;
        container.innerHTML = '';
        const root = document.createElement('div');
        root.className = 'axd-root';
        container.appendChild(root);
        this.root = root;
        return this.root;
    }
    render(vm) {
        const el = this._mount();
        if (!el) return;
        /* 放大量与窄屏落到**本 App 自己的根**（不写 documentElement —— 那是咽喉的事）。
         *   两个 dataset 与内核的两格一一对应：band（字号档）/ narrow（窄屏）。 */
        el.setAttribute('data-ax-band', String(vm.guard && vm.guard.band || 'normal'));
        el.setAttribute('data-ax-narrow', vm.narrow ? '1' : '0');
        el.setAttribute('data-ax-guard', vm.guard && vm.guard.wrapActions ? 'wrap' : 'tight');
        el.innerHTML = this._html(vm);
        this._bind(el);
    }
    _rows(vm) {
        const g = vm.guard || {};
        /* 排版口径只认 vm.plan 一格（与咽喉的同名格对齐）；取不到才如实标「读不出」。 */
        const plan = vm.plan || null;
        const planNarrow = plan && plan.narrow === true;
        const planReason = plan ? String(plan.reason || '') : '读数还没取到';
        let h = '<div class="axd-box"><h3>这一屏会怎么排</h3>';
        h += '<div class="axd-row"><span class="axd-k">视口判定</span><span class="axd-v">' +
            (planNarrow ? '窄屏专门布局' : '标准布局') + '</span></div>';
        h += '<div class="axd-row"><span class="axd-k">依据</span><span class="axd-v axd-dim">' + esc(planReason) + '</span></div>';
        h += '<div class="axd-row"><span class="axd-k">字号档</span><span class="axd-v">' +
            esc(g.band === 'large' ? '大字号' : '标准字号') + '（' + esc(vm.fontPercent === null || vm.fontPercent === undefined ? '读不出' : String(vm.fontPercent) + '%') + '）</span></div>';
        h += '<div class="axd-row"><span class="axd-k">按钮行</span><span class="axd-v">' +
            (g.wrapActions ? '允许换行（放大后不压住旁边的按钮）' : '一行放得下') + '</span></div>';
        h += '<div class="axd-row"><span class="axd-k">状态行</span><span class="axd-v">' +
            (g.growRows ? '高度自适应（文字顶高不压下一行）' : '定高够用') + '</span></div>';
        h += '<div class="axd-row"><span class="axd-k">文字标签</span><span class="axd-v">' +
            (g.keepLabels ? '保留（不用图标替掉文字）' : '——') + '</span></div>';
        h += '<div class="axd-note">' + esc(g.note || '') + '</div>';
        return h + '</div>';
    }
    _levels(vm) {
        let h = '<div class="axd-box"><h3>操作层档位</h3>';
        h += '<div class="axd-caps">';
        for (const lv of vm.levels) {
            const on = vm.level === lv ? ' axd-cap-on' : '';
            h += '<button class="axd-cap' + on + '" data-ax-act="level" data-ax-value="' + esc(lv) + '" aria-pressed="' +
                (vm.level === lv ? 'true' : 'false') + '">' + esc(LEVEL_TEXT[lv] || lv) + '</button>';
        }
        h += '</div>';
        h += '<div class="axd-row"><span class="axd-k">已保存</span><span class="axd-v">' +
            esc(LEVEL_TEXT[vm.levelSaved] || vm.levelSaved) + '</span></div>';
        if (vm.previewing) {
            h += '<div class="axd-warn">正在预览「' + esc(LEVEL_TEXT[vm.level] || vm.level) + '」—— 还没有保存（预览不写任何东西）</div>';
        }
        h += '<div class="axd-acts">';
        h += '<button class="axd-btn" data-ax-act="level" data-ax-value="' + esc(vm.level) + '">按当前档保存</button>';
        h += '<button class="axd-btn axd-btn-dim" data-ax-act="preview" data-ax-value="">退出预览</button>';
        h += '</div>';
        return h + '</div>';
    }
    _prefs(vm) {
        let h = '<div class="axd-box"><h3>个性化</h3>';
        h += '<div class="axd-caps">';
        for (const t of vm.themes) {
            const on = vm.theme === t ? ' axd-cap-on' : '';
            h += '<button class="axd-cap' + on + '" data-ax-act="theme" data-ax-value="' + esc(t) + '" aria-pressed="' +
                (vm.theme === t ? 'true' : 'false') + '">' + esc(THEME_TEXT[t] || t) + '</button>';
        }
        h += '</div>';
        h += '<div class="axd-row"><span class="axd-k">主题来源</span><span class="axd-v">' +
            esc(SOURCE_TEXT[vm.themeSource] || vm.themeSource) + '</span></div>';
        h += '<div class="axd-row"><span class="axd-k">紧凑列表</span><span class="axd-v">' +
            (vm.compact ? '开' : '关') + '</span>' +
            '<button class="axd-btn" data-ax-act="compact" data-ax-value="' + (vm.compact ? 'off' : 'on') + '">' +
            (vm.compact ? '关掉' : '打开') + '</button></div>';
        /* 低动画与字体缩放**指向既有真源**：本 App 只读不写，避免同一件事两个存储位。 */
        h += '<div class="axd-row"><span class="axd-k">低动画</span><span class="axd-v axd-dim">' +
            '当前 ' + esc(vm.motionLevel) + '（用设置页的「动效档位」，本页不重复一个开关）</span></div>';
        h += '<div class="axd-row"><span class="axd-k">字体缩放</span><span class="axd-v axd-dim">' +
            '用设置页的「字体大小」，本页只按它决定排版</span></div>';
        return h + '</div>';
    }
    _states(vm) {
        const c = vm.counts || {};
        const m = vm.stateMark || {};
        let h = '<div class="axd-box"><h3>状态怎么读</h3>';
        h += '<div class="axd-row"><span class="axd-k">本页</span><span class="axd-v axd-mark axd-tone-' + esc(m.tone || 'muted') + '">' +
            esc(m.textFirst || '') + '</span><span class="axd-dim">' + esc(m.detail || '') + '</span></div>';
        h += '<div class="axd-legend">';
        h += '<span class="axd-legend-i axd-tone-good">成功 ✓</span>';
        h += '<span class="axd-legend-i axd-tone-bad">失败 ×</span>';
        h += '<span class="axd-legend-i axd-tone-muted">未知 ？</span>';
        h += '<span class="axd-legend-i axd-tone-muted">空 ○</span>';
        h += '</div>';
        h += '<div class="axd-row"><span class="axd-k">本会话读数</span><span class="axd-v">成功 ' + String(c.ok) +
            ' / 失败 ' + String(c.fail) + ' / 未知 ' + String(c.unknown) + ' / 空 ' + String(c.empty) + '</span></div>';
        h += '<div class="axd-note">颜色只是附加：上面每一行都带文字，去掉颜色也读得出差别。</div>';
        return h + '</div>';
    }
    _audit(vm) {
        const sc = vm.selfCheck || {};
        const probs = sc.problems || [];
        let h = '<div class="axd-box"><h3>可达性自检</h3>';
        h += '<div class="axd-row"><span class="axd-k">桌面图标可读名</span><span class="axd-v">' +
            (vm.namesMissing === null ? '（未取数）' : (vm.namesMissing === 0 ? '全部有名字' : ('缺 ' + String(vm.namesMissing) + ' 个'))) + '</span></div>';
        h += '<div class="axd-row"><span class="axd-k">焦点环</span><span class="axd-v">' +
            (vm.focusRing === 'always' ? '常显（增强档）' : (vm.focusRing === 'auto' ? '跟随浏览器默认（标准档）' : esc(String(vm.focusRing)))) + '</span></div>';
        h += '<div class="axd-self' + (probs.length ? ' axd-self-bad' : '') + '">' +
            (probs.length ? ('自检 ' + String(probs.length) + ' 项：' + esc(probs.slice(0, 3).join('；'))) :
                ('自检通过（' + String(sc.states || 0) + ' 态 / ' + String(sc.levels || 0) + ' 档 / ' + String(sc.bands || 0) + ' 字号档）')) + '</div>';
        return h + '</div>';
    }
    _html(vm) {
        let h = '<div class="axd-wrap">';
        h += '<div class="axd-head"><div class="axd-title">无障碍操作台</div>' +
            '<div class="axd-sub">键盘 / 触摸可达 · 放大不遮挡 · 状态不只靠颜色 · 窄屏专门布局</div>' +
            '<div class="axd-note">' + esc(vm.note) + '</div></div>';
        h += this._levels(vm);
        h += this._rows(vm);
        h += this._prefs(vm);
        h += this._states(vm);
        h += this._audit(vm);
        if (vm.flash) h += '<div class="axd-flash' + (vm.flashBad ? ' axd-flash-bad' : '') + '" role="status">' + esc(vm.flash) + '</div>';
        return h + '</div>';
    }
    _bind(el) {
        const self = this;
        /* 动作白名单：四个 data-ax-act 值。preview 是纯视图态（不进 storage）。 */
        el.querySelectorAll('[data-ax-act]').forEach(function (b) {
            b.addEventListener('click', function () {
                const act = String(b.getAttribute('data-ax-act') || '');
                const val = String(b.getAttribute('data-ax-value') || '');
                if (act === 'preview') return self.app.preview(val);
                /* 档位按钮是**预览**不是立即落盘：换了档先让用户看见这一屏会怎么排，
                 *   确认（「按当前档保存」）之后才写 storage —— 见 box 里那一行提示。 */
                if (act === 'level') {
                    const saved = (self.app._displayedFace && self.app._displayedFace.level) || 'standard';
                    return self.app.preview(val === saved ? '' : val);
                }
                if (act === 'theme') return self.app.setTheme(val);
                if (act === 'compact') return self.app.setCompact(val === 'on');
                return null;
            });
        });
    }
}