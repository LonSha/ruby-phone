/* ========================================================
 * usage-view.js — [v3.15.0] 洞察 App 视图（计划 #52 + #53）
 * 两个分页：使用统计（#52）/ 联系人互动（#53）。
 * ======================================================== */

import { formatDuration } from '../../config/usage-tracker.js';
import { insightSummaryLine } from '../../config/contact-insight.js';
import { USAGE_APP_ICON } from './usage-data.js';

/** App id → 中文名（桌面条目是单一真源；这里只做**显示**用的回落表）。 */
const APP_LABELS = Object.freeze({
    wechat: '微信', weibo: '微博', honey: '蜜语', mofo: '魔坊', wangxiang: '万象',
    phone: '电话', diary: '日记', music: '音乐', album: '相册', calendar: '日历',
    games: '游戏', settings: '设置', notifications: '通知中心', diagnose: '诊断',
    xhs: '小红书', tieba: '贴吧', bilibili: 'B站', theater: '小剧场', tarot: '塔罗',
    reading: '阅读', health: '健康', achievement: '成就', gacha: '抽卡', cheat: '金手指',
    dirtytalk: '撩语', memory: '记忆', mood: '心情', place: '地点', profile: '档案',
    plotline: '剧情线', wallet: '钱袋', chars: '群像', clock: '时计', ledger: '世界账本',
    asset: '资产', peek: '查手机', playbook: '灵感工坊', timeweaver: '织光机',
    worldpulse: '世界脉搏', search: '搜索', usage: '洞察'
});

export class UsageView {
    constructor(app, shell, storage) {
        this.app = app;
        this.shell = shell;
        this.storage = storage;
        this._root = null;
        this._tab = 'usage';
    }

    render() {
        const container = this.shell?.getContentContainer?.();
        if (!container) return;
        container.innerHTML = '';
        this._root = document.createElement('div');
        this._root.className = 'uq-root';
        this._root.innerHTML = this._buildHTML();
        container.appendChild(this._root);
        this._bind();
    }

    refresh() {
        if (!this._root) return;
        this._root.innerHTML = this._buildHTML();
        this._bind();
    }

    _buildHTML() {
        const parts = [];
        parts.push('<div class="uq-header"><h2>' + USAGE_APP_ICON + ' 洞察</h2></div>');
        parts.push('<div class="uq-tabs">');
        parts.push('<button type="button" class="uq-tab' + (this._tab === 'usage' ? ' is-active' : '') + '" data-tab="usage">使用统计</button>');
        parts.push('<button type="button" class="uq-tab' + (this._tab === 'contact' ? ' is-active' : '') + '" data-tab="contact">联系人互动</button>');
        parts.push('</div>');
        parts.push(this._tab === 'usage' ? this._usageHTML() : this._contactHTML());
        parts.push(this._settingsHTML());
        return parts.join('\n');
    }

    /* ---------------- #52 使用统计 ---------------- */

    /**
     * 采集面自检卡。
     * ★ 为什么要有一张「采集面」的卡（本仓反复出现的形态）：
     *   展示面读的是**已存下的**统计。采集坏了（接线漏一处 / 键没落库）时，
     *   展示面只会显示「还没有使用记录」—— 于是「采集坏了」与「你还没用过」
     *   在界面上**完全同形**。这正是本仓最贵的「不报错、不崩溃、只错结论」形态。
     *   故把采集键的真实状态（有几个日子、当前挂着哪个 App）直接摆出来：
     *   用户只要记「我刚才开过 App」，就能用这张卡判断采集到底在不在工作。
     */
    _selfCheckHTML() {
        const sc = this.app.selfCheck();
        if (!sc) {
            return '<div class="uq-card uq-warn">采集面自检读不出来（取数失败）。</div>';
        }
        const parts = [];
        parts.push('<div class="uq-card uq-settings"><h3>采集面自检</h3>');
        parts.push('<div class="uq-row"><span class="uq-row-name">统计键</span>'
            + '<span class="uq-row-val">' + this._esc(sc.key) + '</span></div>');
        parts.push('<div class="uq-row"><span class="uq-row-name">已记天数</span>'
            + '<span class="uq-row-val">' + sc.days + ' 天</span></div>');
        parts.push('<div class="uq-row"><span class="uq-row-name">当前挂着的 App</span>'
            + '<span class="uq-row-val">' + this._esc(sc.open ? (APP_LABELS[sc.open] || sc.open) : '（无）') + '</span></div>');
        parts.push('<div class="uq-dim uq-note">若「已记天数」在你刚开过 App 后仍是 0，说明采集没在工作'
            + ' —— 而界面上的「还没有记录」这两种情形长得一模一样。</div>');
        parts.push('</div>');
        return parts.join('\n');
    }

    _usageHTML() {
        const u = this.app.usage();
        const parts = [];
        if (!u) {
            parts.push('<div class="uq-card uq-warn">读数不可用：使用统计取数失败（不显示 0 —— 读不到与「没用过」是两件事）。</div>');
            // ★ 取数失败时**更要**显示采集面自检：它才是「采集到底在不在工作」的那个读数。
            parts.push(this._selfCheckHTML());
            return parts.join('\n');
        }
        const s = u.summary;
        parts.push('<div class="uq-summary">' + this._esc(this.app.summaryLine()) + '</div>');
        parts.push(this._selfCheckHTML());

        if (s.empty) {
            // 空态必须说清「还没开始记」而不是「你用了 0 分钟」。
            parts.push('<div class="uq-card uq-empty">还没有使用记录。<br><span class="uq-dim">本版起，每次打开 App 会记一条（次数 / 时长 / 时段）；不记任何内容。</span></div>');
            return parts.join('\n');
        }

        // ① 最常用功能
        parts.push('<div class="uq-card"><h3>最常用功能</h3>');
        for (const row of u.top) {
            const label = APP_LABELS[row.id] || row.id;
            parts.push('<div class="uq-row"><span class="uq-row-name">' + this._esc(label) + '</span>'
                + '<span class="uq-row-val">' + row.count + ' 次 · ' + this._esc(formatDuration(row.ms)) + '</span></div>');
        }
        parts.push('</div>');

        // ② 每日使用时长（最近 7 天）
        parts.push('<div class="uq-card"><h3>每日使用时长（近 7 天）</h3>');
        const maxMs = Math.max(...u.daily.map((d) => (d.ms === null ? 0 : d.ms)), 1);
        parts.push('<div class="uq-bars">');
        for (const d of u.daily) {
            // 无记录的日子：**不画 0 高度的柱**，改画虚线占位并注明「无记录」。
            const known = d.ms !== null;
            const h = known ? Math.max(2, Math.round((d.ms / maxMs) * 56)) : 0;
            const label = known ? formatDuration(d.ms) : '无记录';
            parts.push('<div class="uq-bar-col" title="' + this._esc(label) + '">'
                + '<div class="uq-bar' + (known ? '' : ' uq-bar-none') + '" style="height:' + h + 'px"></div>'
                + '<div class="uq-bar-label">' + this._esc(d.label) + '</div></div>');
        }
        parts.push('</div>');
        parts.push('<div class="uq-dim uq-note">无记录的日子如实留空，不按 0 分钟计入。</div>');
        parts.push('</div>');

        // ③ 访问热点（0–23 时）
        parts.push('<div class="uq-card"><h3>访问热点（按小时）</h3>');
        const maxH = Math.max(...u.hours.map((h) => h.count), 1);
        parts.push('<div class="uq-heat">');
        for (const h of u.hours) {
            const op = h.count === 0 ? 0.06 : (0.2 + 0.8 * (h.count / maxH));
            parts.push('<div class="uq-heat-cell" style="opacity:' + op.toFixed(2) + '" title="' + h.hour + ' 时 · ' + h.count + ' 次"></div>');
        }
        parts.push('</div>');
        parts.push('<div class="uq-heat-axis"><span>0 时</span><span>6 时</span><span>12 时</span><span>18 时</span><span>23 时</span></div>');
        if (u.openApp) parts.push('<div class="uq-dim uq-note">当前挂着：' + this._esc(APP_LABELS[u.openApp] || u.openApp) + '（时长在下次打开时结算）</div>');
        parts.push('</div>');
        return parts.join('\n');
    }

    /* ---------------- #53 联系人互动 ---------------- */

    _contactHTML() {
        const ins = this.app.insight();
        const parts = [];
        if (!ins) {
            parts.push('<div class="uq-card uq-warn">联系人读数不可用：取数失败。</div>');
            return parts.join('\n');
        }
        parts.push('<div class="uq-summary">' + this._esc(insightSummaryLine(ins)) + '</div>');

        // 归因面：三处来源各自读到了没有（**不合并**：读不到的源不能说成「没有联系人」）
        const bad = ins.sources.filter((s) => s.state !== 'ok');
        if (bad.length) {
            parts.push('<div class="uq-card uq-warn"><h3>取数归因</h3>');
            for (const s of bad) {
                parts.push('<div class="uq-row"><span class="uq-row-name">' + this._esc(this._srcLabel(s.id)) + '</span>'
                    + '<span class="uq-row-val">' + this._esc(this._stateLabel(s.state)) + '</span></div>');
            }
            parts.push('<div class="uq-dim uq-note">这一处读不到时，其联系人不会出现在下表 —— 表里没有不等于没有。</div></div>');
        }

        if (ins.empty) {
            parts.push('<div class="uq-card uq-empty">还没有可统计的联系人。<br><span class="uq-dim">（若你已有会话却看到这句，请先打开一次微信/电话 App，让数据载入内存。）</span></div>');
            return parts.join('\n');
        }

        // 重点格：重要且长期未联系
        if (ins.staleImportant.length) {
            parts.push('<div class="uq-card uq-alert"><h3>该联系一下了</h3>');
            for (const r of ins.staleImportant) {
                parts.push('<div class="uq-row"><span class="uq-row-name">' + this._esc(r.name) + '</span>'
                    + '<span class="uq-row-val uq-stale">' + r.daysSince + ' 天未联系 · ' + r.count + ' 条</span></div>');
            }
            parts.push('<div class="uq-dim uq-note">「重要」= 互动条数前 ' + ins.importantCount + '；阈值 ' + ins.staleDays + ' 天，可在下方调整。</div></div>');
        }

        // 全表
        parts.push('<div class="uq-card"><h3>全部联系人（' + ins.rows.length + '）</h3>');
        for (const r of ins.rows) {
            const when = (r.daysSince === null) ? '最近联系时间未知' : (r.daysSince + ' 天前');
            const cnt = (r.count === null)
                ? ('条数未知' + (r.partial ? '（会话未加载）' : ''))
                : (r.count + ' 条');
            const extra = r.calls ? (' · 通话 ' + r.calls + ' 次') : '';
            parts.push('<div class="uq-row"><span class="uq-row-name">'
                + this._esc(r.name) + (r.isGroup ? ' <span class="uq-tag">群</span>' : '')
                + '</span><span class="uq-row-val' + (r.freshness === 'stale' ? ' uq-stale' : '') + '">'
                + this._esc(when + ' · ' + cnt + extra) + '</span></div>');
        }
        parts.push('</div>');
        if (ins.partialWechat > 0) {
            parts.push('<div class="uq-dim uq-note">有 ' + ins.partialWechat + ' 个微信会话的正文尚未载入内存，其条数如实标为「未知」（下界），不按 0 计。</div>');
        }
        return parts.join('\n');
    }

    _settingsHTML() {
        const s = this.app.settings;
        const parts = [];
        parts.push('<div class="uq-card uq-settings"><h3>⚙️ 设置</h3>');
        parts.push('<label class="uq-toggle"><input type="checkbox" id="uq-inject" ' + (s.injectToPrompt ? 'checked' : '') + '><span>把「长期未联系人」注入 Prompt</span></label>');
        parts.push('<label class="uq-toggle"><span>未联系阈值（天）</span>'
            + '<input type="number" id="uq-stale" inputmode="numeric" min="1" max="365" step="1" value="' + s.staleDays + '"></label>');
        parts.push('<div class="uq-dim uq-note">只注入联系人疏远度这一项；使用统计是给你自己看的读数，写进上下文只会白烧 token。</div>');
        parts.push('</div>');
        return parts.join('\n');
    }

    _bind() {
        this._root.querySelectorAll('.uq-tab').forEach((btn) => {
            btn.addEventListener('click', () => {
                const t = btn.getAttribute('data-tab');
                if (t && t !== this._tab) { this._tab = t; this.refresh(); }
            });
        });
        const inject = this._root.querySelector('#uq-inject');
        if (inject) inject.addEventListener('change', (e) => {
            this.app.settings.injectToPrompt = e.target.checked;
            this.app.saveSettings();
        });
        const stale = this._root.querySelector('#uq-stale');
        if (stale) stale.addEventListener('change', (e) => {
            const n = Number(e.target.value);
            if (!Number.isFinite(n)) return;
            this.app.settings.staleDays = Math.min(365, Math.max(1, Math.trunc(n)));
            this.app.saveSettings();
            this.app.probe();
            this.refresh();
        });
    }

    _srcLabel(id) {
        if (id === 'wechat') return '微信';
        if (id === 'sms') return '短信';
        if (id === 'calls') return '通话记录';
        return String(id);
    }

    _stateLabel(state) {
        if (state === 'no-host') return '数据层未挂载（先打开一次对应 App）';
        if (state === 'face-absent') return '这一层没给读数';
        if (state === 'thrown') return '取数时抛错（已降级）';
        return String(state);
    }

    /**
     * HTML 转义。
     * ★ 为什么写成 `\x26quot;` 而不是直接写字面量（本文件初版写错了，如实记下）：
     *   `.replace(/"/g, '"')` —— 右边那个所谓「实体」是**裸引号本身**，于是这条替换
     *   **恒等于什么都没做**：& / < / > 三处真在转义，只有引号那一处空转，
     *   所以「看起来一切都对」。这正是本仓 v3.10.1 收干过 7 处的同款形态
     *   （cheat-view / gacha-view 曾犯，v246 J15 已修，v257 F3 立过回归锁）。
     *   根因：实体字面量在**写盘/补丁层**会被就地解码成裸字符，故合法写法必须用
     *   反斜杠转义序列（`\x26quot;`）或运行时生成（`String.fromCharCode(38)`），
     *   使字面量在源码里不被解码。
     */
    _esc(s) {
        return String(s === null || s === undefined ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '\x26quot;').replace(/'/g, '\x26#39;');
    }
}