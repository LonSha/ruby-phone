/* ========================================================
 * 心境 (Mood) 视图 — v4.164.0「照现实重写」
 * --------------------------------------------------------
 * 上一版的形态：**一页到底** —— 情绪色卡 / 积温五轴 / 八条维度 / 记忆统计
 * 全堆在同一条滚动里，`<style>` 还嵌在 HTML 里跟着每帧重发一遍。
 *
 * 现实里的心境 App 是三个页签：**此刻**（今天怎么样）→ **维度**（哪些情绪在动）
 * → **记忆**（它们被记成了什么）。页签之间切换不换 App，靠底部栏。
 *
 * 三条落地纪律（与本仓门禁一一对应）：
 *   ① **事件委托**：整页重绘不能把监听丢了，也不能每绘一次多挂一份 —— 监听只挂容器一次；
 *   ② **宿主读不到也不许抛**：所有 DOM 读取都走 _q() + 空判断；
 *   ③ **不编数**：引擎没初始化就说没初始化，不画 0、不画假色卡。
 * ======================================================== */
'use strict';

/* 15 维情绪的中文标签 + 归属 + 色（与引擎的键一一对应，键改了这里就会显形为空态） */
const EMOTION_META = {
    vitality: { label: '活力', pos: true, color: '#22c55e' },
    longing: { label: '思念', pos: true, color: '#a78bfa' },
    intimacy: { label: '亲密', pos: true, color: '#f472b6' },
    possessiveness: { label: '占有', pos: false, color: '#fb7185' },
    lust: { label: '欲求', pos: false, color: '#ef4444' },
    jealousy: { label: '嫉妒', pos: false, color: '#f59e0b' },
    anxiety: { label: '不安', pos: false, color: '#94a3b8' },
    protectiveness: { label: '保护', pos: true, color: '#38bdf8' },
    contentment: { label: '满足', pos: true, color: '#4ade80' },
    elation: { label: '雀跃', pos: true, color: '#fde047' },
    seeking: { label: '探索', pos: true, color: '#2dd4bf' },
    play: { label: '玩闹', pos: true, color: '#fb923c' },
    dejection: { label: '低落', pos: false, color: '#818cf8' },
    irritability: { label: '烦躁', pos: false, color: '#f87171' },
    fear: { label: '恐惧', pos: false, color: '#64748b' },
};

/* 积温五轴：标签 + 色 + 取值范围（范围只写一次，条宽与读数共用） */
const JIWEN_AXES = {
    connection: { label: '连接需求', color: '#38bdf8', min: 0, max: 1 },
    pride: { label: '骄傲', color: '#a78bfa', min: -1, max: 1 },
    valence: { label: '愉悦度', color: '#4ade80', min: -1, max: 1 },
    arousal: { label: '唤醒', color: '#fb923c', min: -1, max: 1 },
    immersion: { label: '沉浸', color: '#f472b6', min: 0, max: 1 },
};

/** 页签：顺序就是现实里的顺序。 */
const TABS = [
    { key: 'now', label: '此刻', icon: 'fa-solid fa-heart-pulse' },
    { key: 'axes', label: '维度', icon: 'fa-solid fa-chart-simple' },
    { key: 'memory', label: '记忆', icon: 'fa-solid fa-brain' },
];
/* [v4.215.0 · 照现实] 底栏真源别名：MOOD_FACES 与 TABS 同一引用，不另写格表。 */
export const MOOD_FACES = TABS;

/** 维度页展示的八条（顺序固定：先正向骨架，再负向三条）。 */
const AXIS_ROWS = ['vitality', 'longing', 'intimacy', 'contentment', 'lust', 'anxiety', 'dejection', 'possessiveness'];

function esc(s) {
    return String(s === undefined || s === null ? '' : s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}
function pct(v, min, max) {
    const p = ((Number(v) - min) / (max - min)) * 100;
    if (!Number.isFinite(p)) return 0;
    return Math.max(0, Math.min(100, p));
}
function fmtPct(v) { return Math.round(Number(v || 0) * 100) + '%'; }
function fmtNum(v) { return Number(Number(v) || 0).toFixed(2); }
function valOf(state, k) {
    const m = (state && state.mood) || {};
    const b = (state && state.base) || {};
    const v = (m[k] !== undefined && m[k] !== null) ? m[k] : b[k];
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
}

/** 主导情绪：三强（不到阈值就如实返回空数组，不硬凑一个）。 */
function topEmotions(state, n) {
    const arr = Object.keys(EMOTION_META)
        .filter((k) => k !== 'vitality')
        .map((k) => ({ k, v: valOf(state, k) }))
        .filter((x) => Math.abs(x.v) > 0.12)
        .sort((a, b) => Math.abs(b.v) - Math.abs(a.v));
    return arr.slice(0, n || 3);
}

export class MoodView {
    constructor(app) {
        this.app = app;
        this.container = null;
        this.tab = 'now';
        this._boundEl = null;
        this._hClick = null;
        this._state = { drives: null, jiwen: null, memory: null };
    }

    /* ---------- 1. 生命周期 ---------- */

    /* [v4.215.0 · 照现实] mood 无独立主 CSS（样式内联在 STYLE），v4 分层样式走 link 幂等注入。 */
    _loadV4CSS() {
        if (typeof document === 'undefined' || !document.head) return;
        if (document.getElementById('mood-v4-css')) return;
        const link = document.createElement('link');
        link.id = 'mood-v4-css';
        link.rel = 'stylesheet';
        link.href = new URL('./mood.v4.css', import.meta.url).href;
        document.head.appendChild(link);
    }

    render(drives, jiwen, memory) {
        this._state = { drives, jiwen, memory };
        this._loadV4CSS();
        const shell = this.app && this.app.phoneShell;
        if (!shell || typeof shell.setContent !== 'function') return;
        const html = this._layout(drives, jiwen, memory);
        try { shell.setContent(html, 'mood-main'); } catch (_e) { /* 宿主夹具不接收内容：不抛 */ }
        /* setContent 之后容器实体不一定能拿到（夹具里是桩），拿不到就不绑事件。 */
        try {
            const c = shell.layerHost ? shell.layerHost('mood-main', { create: false }) : shell.getContentContainer?.();
            if (c) this._syncBinding(c);
        } catch (_e) { /* 忽略 */ }
    }

    _syncBinding(c) {
        if (this._boundEl === c) return;
        const old = this._boundEl;
        if (old && this._hClick && typeof old.removeEventListener === 'function') {
            try { old.removeEventListener('click', this._hClick); } catch (_e) { /* 老容器已死 */ }
        }
        this._hClick = (ev) => this._handleClick(ev);
        if (typeof c.addEventListener === 'function') c.addEventListener('click', this._hClick);
        this._boundEl = c;
    }

    /* ---------- 2. 小工具 ---------- */

    _attr(el, name) {
        try { return (el && typeof el.getAttribute === 'function') ? el.getAttribute(name) : null; }
        catch (_e) { return null; }
    }

    /* ---------- 3. 骨架 ---------- */

    _tabbarHTML() {
        const parts = ['<nav class="mood-tabbar" role="navigation" aria-label="心境主导航">'];
        for (const t of MOOD_FACES) {
            const on = this.tab === t.key;
            parts.push('<button class="mood-tab' + (on ? ' is-on' : '') + '" data-act="tab" data-tab="' + t.key
                + '" data-mood-face="' + t.key + '"' + (on ? ' aria-current="page"' : '') + '>'
                + '<i class="' + t.icon + '"></i><span class="mood-tab-label">' + esc(t.label) + '</span></button>');
        }
        parts.push('</nav>');
        return parts.join('');
    }

    _topbar(title, meta) {
        return '<div class="mood-top"><div class="mood-title">' + esc(title) + '</div>'
            + '<span class="mood-top-meta">' + esc(meta || '') + '</span></div>';
    }

    /* ---------- 4. 此刻 ---------- */

    _nowHTML(drives, jiwen) {
        const parts = ['<section class="mood-page" data-page="now">'];
        parts.push(this._faceHTML(drives));
        if (!drives) {
            parts.push('<div class="mood-empty">情绪引擎还没初始化。对话推进一段之后，这里会自动长出今天的心境。</div>');
            parts.push(this._probeHTML(jiwen));
            parts.push('</section>');
            return parts.join('');
        }
        parts.push(this._cardHTML(drives));
        parts.push(this._todayStatsHTML(drives));
        parts.push(this._probeHTML(jiwen));
        parts.push('</section>');
        return parts.join('');
    }

    /** 归因条：先判「读不读得到」，再谈读到了什么。 */
    _faceHTML(drives) {
        if (!drives) {
            return '<div class="mood-face is-warn"><span class="mood-face-icon">⚠️</span>'
                + '<span class="mood-face-text">读不到情绪引擎（尚未初始化）</span></div>';
        }
        return '<div class="mood-face is-ok"><span class="mood-face-icon">🫶</span>'
            + '<span class="mood-face-text">情绪引擎在线，读数来自本轮对话积累</span></div>';
    }

    _cardHTML(drives) {
        const top = topEmotions(drives, 3);
        const dom = top[0] || null;
        const meta = dom ? EMOTION_META[dom.k] : null;
        const color = (meta && meta.color) || '#64748b';
        const strength = dom ? Math.min(1, Math.abs(dom.v)) : 0;
        const label = dom ? (meta ? meta.label : dom.k) : '平静';
        const emoji = !dom ? '😐' : (dom.v > 0 ? '😊' : (dom.v < 0 ? '😔' : '😐'));
        const sleep = (drives.sleep && drives.sleep.status === 'asleep') ? '💤 睡梦中' : '🟢 清醒';
        const parts = ['<div class="mood-card" style="border-color:' + color + '55">'];
        parts.push('<div class="mood-card-head"><span class="mood-emoji">' + emoji + '</span>'
            + '<div class="mood-card-main"><div class="mood-label">' + esc(label) + '</div>'
            + '<div class="mood-strength">强度 ' + fmtPct(strength) + '</div></div>'
            + '<span class="mood-sleep">' + sleep + '</span></div>');
        if (top.length) {
            parts.push('<div class="mood-toplist">');
            for (const t of top) {
                const m = EMOTION_META[t.k] || { label: t.k, color: '#888' };
                parts.push('<div class="mood-top-item"><span class="mood-top-dot" style="background:' + m.color + '"></span>'
                    + '<span class="mood-top-name">' + esc(m.label) + '</span>'
                    + '<span class="mood-top-val' + (t.v < 0 ? ' is-neg' : '') + '">' + (t.v > 0 ? '+' : '') + fmtNum(t.v) + '</span></div>');
            }
            parts.push('</div>');
        } else {
            parts.push('<div class="mood-hint">今天的情绪都很平：没有哪一维超过 0.12 的阈值。这不是没读到，是真的平。</div>');
        }
        parts.push('</div>');
        return parts.join('');
    }

    _todayStatsHTML(drives) {
        const sleep = (drives && drives.sleep) || {};
        const status = sleep.status === 'asleep' ? '睡梦中' : '清醒';
        return '<div class="mood-stats">'
            + '<div class="mood-stat"><b>' + esc(status) + '</b><span>睡眠状态</span></div>'
            + '<div class="mood-stat"><b>' + fmtNum(valOf(drives, 'vitality')) + '</b><span>活力</span></div>'
            + '<div class="mood-stat"><b>' + fmtNum(valOf(drives, 'intimacy')) + '</b><span>亲密</span></div>'
            + '<div class="mood-stat"><b>' + fmtNum(valOf(drives, 'anxiety')) + '</b><span>不安</span></div>'
            + '</div>';
    }

    _probeHTML(jiwen) {
        const probe = jiwen && jiwen.proactive;
        if (!probe) {
            return '<div class="mood-sec"><div class="mood-sec-title">💭 他现在想说什么</div>'
                + '<div class="mood-hint">积温还没攒到主动档位 —— 没有想法就说没有，不编一句。</div></div>';
        }
        return '<div class="mood-sec"><div class="mood-sec-title">💭 他现在想说什么</div>'
            + '<div class="mood-probe">' + esc(probe) + '</div></div>';
    }

    /* ---------- 5. 维度 ---------- */

    _axesHTML(drives, jiwen) {
        const parts = ['<section class="mood-page" data-page="axes">'];
        parts.push('<div class="mood-sec"><div class="mood-sec-title">🐾 积温五轴</div>');
        const st = (jiwen && jiwen.state) || null;
        if (!st) {
            parts.push('<div class="mood-hint">积温引擎还没初始化。</div>');
        } else {
            for (const k of Object.keys(JIWEN_AXES)) {
                const m = JIWEN_AXES[k];
                const v = Number(st[k] === undefined || st[k] === null ? 0 : st[k]);
                parts.push(this._barHTML(m.label, m.color, pct(v, m.min, m.max), (v >= 0 ? '+' : '') + fmtNum(v)));
            }
        }
        parts.push('</div>');
        parts.push('<div class="mood-sec"><div class="mood-sec-title">🌈 情绪维度</div>');
        if (!drives) {
            parts.push('<div class="mood-hint">情绪引擎还没初始化。</div>');
        } else {
            for (const k of AXIS_ROWS) {
                const m = EMOTION_META[k];
                if (!m) continue;
                const v = valOf(drives, k);
                parts.push(this._barHTML(m.label, m.color, pct(v, -1, 1), (v >= 0 ? '+' : '') + fmtNum(v), v < 0));
            }
        }
        parts.push('</div>');
        parts.push('</section>');
        return parts.join('');
    }

    _barHTML(label, color, widthPct, text, neg) {
        return '<div class="mood-bar-row"><span class="mood-bar-label">' + esc(label) + '</span>'
            + '<div class="mood-bar-track"><div class="mood-bar-fill' + (neg ? ' is-neg' : '') + '" style="width:' + widthPct + '%;background:' + color + '"></div></div>'
            + '<span class="mood-bar-val">' + esc(text) + '</span></div>';
    }

    /* ---------- 6. 记忆 ---------- */

    _memoryHTML(memory) {
        const parts = ['<section class="mood-page" data-page="memory">'];
        if (!memory) {
            parts.push('<div class="mood-empty">记忆系统没接上，读不到规模与权限。</div></section>');
            return parts.join('');
        }
        parts.push('<div class="mood-sec"><div class="mood-sec-title">🧠 规模</div><div class="mood-stats">'
            + '<div class="mood-stat"><b>' + memory.longTermCount + '</b><span>长期</span></div>'
            + '<div class="mood-stat"><b>' + memory.shortTermCount + '</b><span>短期</span></div>'
            + '<div class="mood-stat"><b>' + (memory.consolidated ?? '未知') + '</b><span>已巩固</span></div>'
            + '<div class="mood-stat"><b>' + (memory.superseded ?? '未知') + '</b><span>已换代</span></div>'
            + '<div class="mood-stat"><b>' + (memory.tombstoned ?? '未知') + '</b><span>已墓碑</span></div>'
            + '</div></div>');
        parts.push('<div class="mood-sec"><div class="mood-sec-title">🔐 长期记忆的权限标注</div><div class="mood-stats">'
            + '<div class="mood-stat"><b>' + memory.tier.cite + '</b><span>可引用</span></div>'
            + '<div class="mood-stat"><b>' + memory.tier.cautious + '</b><span>需谨慎</span></div>'
            + '<div class="mood-stat"><b>' + memory.tier.associate + '</b><span>仅联想</span></div>'
            + '<div class="mood-stat"><b>' + memory.tier.unlabelled + '</b><span>未标注</span></div>'
            + '</div></div>');
        parts.push('</section>');
        return parts.join('');
    }

    /* ---------- 7. 总装 ---------- */

    _layout(drives, jiwen, memory) {
        const page = this.tab === 'axes' ? this._axesHTML(drives, jiwen)
            : (this.tab === 'memory' ? this._memoryHTML(memory) : this._nowHTML(drives, jiwen));
        const time = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
        return '<div class="mood-root" data-tab="' + this.tab + '">'
            + this._topbar('心境', time)
            + page
            + this._tabbarHTML()
            + '</div>' + STYLE;
    }

    /* ---------- 8. 事件（容器级委托） ---------- */

    _handleClick(ev) {
        const el = ev && ev.target;
        const hit = (el && typeof el.closest === 'function') ? el.closest('[data-act]') : null;
        const act = this._attr(hit, 'data-act');
        if (!act) return;
        if (act === 'tab') {
            const tab = this._attr(hit, 'data-tab') || 'now';
            if (TABS.some((t) => t.key === tab)) {
                this.tab = tab;
                const s = this._state;
                this.render(s.drives, s.jiwen, s.memory);
            }
            return;
        }
    }
}

/* 样式随视图走（本 App 没有独立样式表接线，内联一份避免半套样式）；
 * 与上一版的差别：整份只发一次、不再散在结构里，类名统一 mood- 前缀。 */
const STYLE = `
<style>
.mood-root { position:relative; display:flex; flex-direction:column; height:100%; box-sizing:border-box;
  padding:0; font-family:system-ui; background:#0f172a; color:#e2e8f0; overflow:hidden; }
.mood-root * { box-sizing:border-box; }
.mood-top { display:flex; align-items:center; gap:8px; padding:10px 12px 8px; }
.mood-title { flex:1; font-size:15px; font-weight:600; color:#f8fafc; }
.mood-top-meta { font-size:11px; color:#94a3b8; }
.mood-page { flex:1; overflow-y:auto; padding:0 12px 12px; display:flex; flex-direction:column; gap:10px; }
.mood-tabbar { display:flex; border-top:1px solid rgba(255,255,255,.07); background:#0d1524; }
.mood-tab { flex:1; display:flex; flex-direction:column; align-items:center; gap:3px; padding:8px 0 10px;
  border:0; background:none; color:#64748b; font-size:11px; cursor:pointer; }
.mood-tab.is-on { color:#f472b6; }
.mood-tab-label { line-height:1.1; }
.mood-face { display:flex; align-items:center; gap:8px; padding:8px 12px; border-radius:10px; font-size:12px; }
.mood-face.is-ok { background:rgba(34,197,94,.12); color:#4ade80; }
.mood-face.is-warn { background:rgba(251,191,36,.12); color:#fbbf24; }
.mood-empty { padding:20px; text-align:center; color:#94a3b8; font-size:12px; line-height:1.7;
  background:#1e293b; border-radius:12px; }
.mood-hint { font-size:11px; color:#64748b; line-height:1.6; }
.mood-card { border-radius:14px; padding:14px; background:#1e293b; border:1px solid rgba(255,255,255,.08); }
.mood-card-head { display:flex; align-items:center; gap:10px; }
.mood-emoji { font-size:28px; }
.mood-card-main { flex:1; min-width:0; }
.mood-label { font-size:15px; font-weight:600; color:#f8fafc; }
.mood-strength { font-size:11px; color:#94a3b8; }
.mood-sleep { font-size:11px; color:#a7f3d0; }
.mood-toplist { display:flex; flex-direction:column; gap:4px; margin-top:10px; }
.mood-top-item { display:flex; align-items:center; gap:8px; font-size:12px; }
.mood-top-dot { width:8px; height:8px; border-radius:50%; flex:0 0 auto; }
.mood-top-name { color:#cbd5e1; }
.mood-top-val { margin-left:auto; font-weight:600; color:#f1f5f9; font-variant-numeric:tabular-nums; }
.mood-top-val.is-neg { color:#f87171; }
.mood-stats { display:grid; grid-template-columns:repeat(4,1fr); gap:8px; }
.mood-stat { background:#0f172a; border-radius:10px; padding:8px 4px; text-align:center; }
.mood-stat b { display:block; font-size:15px; color:#f8fafc; font-variant-numeric:tabular-nums; }
.mood-stat span { font-size:10px; color:#94a3b8; }
.mood-sec { background:#1e293b; border-radius:12px; padding:12px; }
.mood-sec-title { font-size:13px; font-weight:600; color:#cbd5e1; margin-bottom:8px; }
.mood-probe { padding:8px 10px; background:#312e81; border-radius:8px; font-size:12px; color:#c7d2fe; line-height:1.5; }
.mood-bar-row { display:flex; align-items:center; gap:8px; margin-bottom:6px; font-size:11px; }
.mood-bar-label { width:56px; flex:0 0 auto; color:#94a3b8; }
.mood-bar-track { flex:1; height:8px; background:#334155; border-radius:4px; overflow:hidden; }
.mood-bar-fill { height:100%; border-radius:4px; opacity:.85; }
.mood-bar-fill.is-neg { opacity:.95; }
.mood-bar-val { width:44px; text-align:right; color:#cbd5e1; font-variant-numeric:tabular-nums; }
</style>`;
