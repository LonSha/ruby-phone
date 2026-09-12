/* ========================================================
 * 心境 (Mood) 视图 — 聚合情绪/积温/记忆 三合一界面
 * ======================================================== */
'use strict';

// 15 维情绪的中文标签 + 归属 (pos/neg/中性)
const EMOTION_META = {
    vitality:       { label: '活力',      pos: true,  color: '#22c55e' },
    longing:        { label: '思念',      pos: true,  color: '#a78bfa' },
    intimacy:       { label: '亲密',      pos: true,  color: '#f472b6' },
    possessiveness: { label: '占有',      pos: false, color: '#fb7185' },
    lust:           { label: '欲求',      pos: false, color: '#ef4444' },
    jealousy:       { label: '嫉妒',      pos: false, color: '#f59e0b' },
    anxiety:        { label: '不安',      pos: false, color: '#94a3b8' },
    protectiveness: { label: '保护',      pos: true,  color: '#38bdf8' },
    contentment:    { label: '满足',      pos: true,  color: '#4ade80' },
    elation:        { label: '雀跃',      pos: true,  color: '#fde047' },
    seeking:        { label: '探索',      pos: true,  color: '#2dd4bf' },
    play:           { label: '玩闹',      pos: true,  color: '#fb923c' },
    dejection:      { label: '低落',      pos: false, color: '#818cf8' },
    irritability:   { label: '烦躁',      pos: false, color: '#f87171' },
    fear:           { label: '恐惧',      pos: false, color: '#64748b' }
};

// 积温五轴中文标签 + 色
const JIWEN_AXES = {
    connection: { label: '连接需求', color: '#38bdf8' },
    pride:      { label: '骄傲',     color: '#a78bfa' },
    valence:    { label: '愉悦度',   color: '#4ade80' },
    arousal:    { label: '唤醒',     color: '#fb923c' },
    immersion:  { label: '沉浸',     color: '#f472b6' }
};

function esc(s) {
    return String(s ?? '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '"');
}
function pct(v, min = 0, max = 1) {
    const p = ((Number(v) - min) / (max - min)) * 100;
    return Math.max(0, Math.min(100, p));
}
function fmtPct(v) { return Math.round(Number(v || 0) * 100) + '%'; }
function fmtNum(v, digits = 2) { return Number(v).toFixed(digits); }

// 从 state 计算主导情绪 (top3 维度)
function topEmotions(state, keys, n = 3) {
    const arr = keys.filter(k => k !== 'vitality' && k !== 'fatigue')
        .map(k => ({ k, v: Number(state?.mood?.[k] ?? state?.base?.[k] ?? 0) }))
        .filter(x => Math.abs(x.v) > 0.12)
        .sort((a, b) => Math.abs(b.v) - Math.abs(a.v));
    const top = arr.slice(0, n);
    // 若不足 n 个强项, 用 base 兜底 (仅显示 >0.15)
    return top.length ? top : arr.slice(0, n);
}

export class MoodView {
    constructor(app) {
        this.app = app;
        this.container = null;
    }

    render(drives, jiwen, memory) {
        if (!this.app.phoneShell?.setContent) return;
        const html = this._layout(drives, jiwen, memory);
        this.app.phoneShell.setContent(html, 'mood-main');
    }

    _moodCard(drives) {
        if (!drives) {
            return '<div class="mood-empty">情绪引擎尚未初始化。<br>对话推进后会自动积累心境。</div>';
        }
        const mood = drives.mood || {};
        const base = drives.base || {};
        const sleep = drives.sleep || {};
        const top = topEmotions(drives, Object.keys(EMOTION_META), 3);
        const dominant = top[0];
        const domMeta = dominant ? EMOTION_META[dominant.k] : null;
        const domVal = dominant ? dominant.v : 0;
        // 色卡: 由主导情绪颜色 * 强度渐变
        const bgColor = domMeta?.color || '#64748b';
        const strength = Math.min(1, Math.abs(domVal));
        const label = domMeta?.label || '平静';
        const sleepText = sleep.status === 'asleep' ? '💤 睡梦中' : '🟢 清醒';
        return `
        <div class="mood-card" style="background:linear-gradient(135deg, ${bgColor}33, ${bgColor}11)">
          <div class="mood-card-head">
            <span class="mood-emoji">${domVal > 0 ? '😊' : (domVal < 0 ? '😔' : '😐')}</span>
            <div>
              <div class="mood-label">${esc(label)}</div>
              <div class="mood-strength">强度 ${fmtPct(strength)}</div>
            </div>
            <span class="mood-sleep">${sleepText}</span>
          </div>
          <div class="mood-toplist">
            ${top.map(t => {
                const meta = EMOTION_META[t.k];
                return `<div class="mood-top-item">
                  <span class="mood-top-dot" style="background:${meta?.color || '#888'}"></span>
                  <span>${esc(meta?.label || t.k)}</span>
                  <span class="mood-top-val ${t.v < 0 ? 'neg' : ''}">${t.v > 0 ? '+' : ''}${fmtNum(t.v)}</span>
                </div>`;
            }).join('')}
          </div>
        </div>`;
    }

    _drivesBars(drives) {
        if (!drives) return '';
        const keys = ['vitality', 'longing', 'intimacy', 'contentment', 'anxiety', 'dejection', 'lust', 'possession'];
        const valid = keys.filter(k => EMOTION_META[k]);
        // key 修正: possessiveness 完整名
        const showKeys = ['vitality', 'longing', 'intimacy', 'contentment', 'lust', 'anxiety', 'dejection', 'possessiveness'];
        const bars = showKeys.filter(k => EMOTION_META[k]).map(k => {
            const v = Number(drives.mood?.[k] ?? drives.base?.[k] ?? 0);
            const meta = EMOTION_META[k];
            const cls = v >= 0 ? 'pos' : 'neg';
            return `
            <div class="mood-bar-row">
              <span class="mood-bar-label">${esc(meta.label)}</span>
              <div class="mood-bar-track"><div class="mood-bar-fill ${cls}" style="width:${pct(v, -1, 1)}%;background:${meta.color}"></div></div>
              <span class="mood-bar-val">${v >= 0 ? '+' : ''}${fmtNum(v)}</span>
            </div>`;
        }).join('');
        return `<div class="mood-section mood-drives"><div class="mood-section-title">🌈 情绪维度</div>${bars}</div>`;
    }

    _jiwenCard(jiwen) {
        const state = jiwen?.state;
        const probe = jiwen?.proactive;
        if (!state) {
            return '<div class="mood-empty">积温引擎尚未初始化。</div>';
        }
        const bars = Object.keys(JIWEN_AXES).map(k => {
            const v = Number(state[k] ?? 0);
            const meta = JIWEN_AXES[k];
            // 轴范围: connection/immersion [0,1], 其余 [-1,1]
            const range = (k === 'connection' || k === 'immersion') ? [0, 1] : [-1, 1];
            return `
            <div class="mood-bar-row">
              <span class="mood-bar-label">${esc(meta.label)}</span>
              <div class="mood-bar-track"><div class="mood-bar-fill pos" style="width:${pct(v, range[0], range[1])}%;background:${meta.color}"></div></div>
              <span class="mood-bar-val">${v >= 0 ? '+' : ''}${fmtNum(v)}</span>
            </div>`;
        }).join('');
        const probeHtml = probe ? `<div class="mood-probe">💭 主动想法：${esc(probe)}</div>` : '';
        return `
        <div class="mood-section mood-jiwen"><div class="mood-section-title">🐾 积温五轴</div>
          ${bars}
          ${probeHtml}
        </div>`;
    }

    _memoryCard(memory) {
        if (!memory) return '<div class="mood-empty">记忆系统未初始化。</div>';
        return `
        <div class="mood-section mood-memory"><div class="mood-section-title">🧠 记忆</div>
          <div class="mood-stat-grid">
            <div class="mood-stat"><b>${memory.longTermCount}</b><span>长期</span></div>
            <div class="mood-stat"><b>${memory.shortTermCount}</b><span>短期</span></div>
            <div class="mood-stat"><b>${memory.consolidated}</b><span>已巩固</span></div>
            <div class="mood-stat"><b>${memory.superseded}</b><span>已换代</span></div>
            <div class="mood-stat"><b>${memory.tombstoned}</b><span>已墓碑</span></div>
            <div class="mood-stat"><b>${memory.tier.cite}</b><span>可引用</span></div>
            <div class="mood-stat"><b>${memory.tier.cautious}</b><span>需谨慎</span></div>
            <div class="mood-stat"><b>${memory.tier.associate}</b><span>仅联想</span></div>
          </div>
        </div>`;
    }

    _layout(drives, jiwen, memory) {
        return `
        <style>
        .mood-root { padding: 12px; font-family: system-ui; background: #0f172a; color: #e2e8f0; min-height:100%; box-sizing:border-box; }
        .mood-root * { box-sizing:border-box; }
        .mood-header { display:flex; align-items:center; justify-content:space-between; margin-bottom:12px; }
        .mood-header h2 { margin:0; font-size:16px; color:#f1f5f9; }
        .mood-header .mood-time { font-size:11px; color:#94a3b8; }
        .mood-empty { padding:20px; text-align:center; color:#94a3b8; font-size:13px; background:#1e293b; border-radius:12px; margin-bottom:10px; }
        .mood-card { border-radius:14px; padding:14px; margin-bottom:10px; border:1px solid rgba(255,255,255,0.08); }
        .mood-card-head { display:flex; align-items:center; gap:10px; }
        .mood-emoji { font-size:28px; }
        .mood-label { font-size:15px; font-weight:600; color:#f8fafc; }
        .mood-strength { font-size:11px; color:#94a3b8; }
        .mood-sleep { margin-left:auto; font-size:11px; color:#a7f3d0; }
        .mood-toplist { display:flex; flex-direction:column; gap:4px; margin-top:10px; }
        .mood-top-item { display:flex; align-items:center; gap:8px; font-size:12px; }
        .mood-top-dot { width:8px; height:8px; border-radius:50%; flex-shrink:0; }
        .mood-top-val { margin-left:auto; font-weight:600; color:#f1f5f9; }
        .mood-top-val.neg { color:#f87171; }
        .mood-section { background:#1e293b; border-radius:12px; padding:12px; margin-bottom:10px; }
        .mood-section-title { font-size:13px; font-weight:600; color:#cbd5e1; margin-bottom:8px; }
        .mood-bar-row { display:flex; align-items:center; gap:8px; margin-bottom:6px; font-size:11px; }
        .mood-bar-label { width:44px; flex-shrink:0; color:#94a3b8; }
        .mood-bar-track { flex:1; height:8px; background:#334155; border-radius:4px; overflow:hidden; }
        .mood-bar-fill { height:100%; border-radius:4px; }
        .mood-bar-fill.pos { }
        .mood-bar-val { width:38px; text-align:right; color:#cbd5e1; font-variant-numeric:tabular-nums; }
        .mood-probe { margin-top:8px; padding:8px; background:#312e81; border-radius:8px; font-size:11px; color:#c7d2fe; line-height:1.4; }
        .mood-stat-grid { display:grid; grid-template-columns:repeat(4,1fr); gap:8px; }
        .mood-stat { background:#0f172a; border-radius:8px; padding:8px; text-align:center; }
        .mood-stat b { display:block; font-size:16px; color:#f8fafc; }
        .mood-stat span { font-size:10px; color:#94a3b8; }
        </style>
        <div class="mood-root">
          <div class="mood-header">
            <h2>✨ 心境</h2>
            <span class="mood-time">${new Date().toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'})}</span>
          </div>
          ${this._moodCard(drives)}
          ${this._jiwenCard(jiwen)}
          ${this._drivesBars(drives)}
          ${this._memoryCard(memory)}
        </div>`;
    }
}