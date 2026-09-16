/* ========================================================
 * timeweaver-view.js — 织光机视图（生活流时间线 + 里程碑 + 情感曲线 + 亲密度榜 + 年度信）
 * ======================================================== */
'use strict';
import { buildNarrative } from './timeweaver-collector.js';

function esc(s) {
    return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'"');
}
const SRC_ICON = { diary:'📔', album:'🖼️', achievement:'🏆', calendar:'📅', weibo:'💬', honey:'🍯', theater:'🎭', life:'✨', chat:'💬', misc:'✨', unknown:'✨' };

export class TimeweaverView {
    constructor(app) { this.app = app; this._tab = 'letter'; }

    render() {
        if (!this.app.phoneShell?.setContent) return;
        const model = buildNarrative(this.app.storage, { bucket: 'day' });
        const html = model.empty ? this._empty() : this._layout(model);
        this.app.phoneShell.setContent(this._css() + html, 'timeweaver-main');
        this._bind();
    }

    _empty() {
        return `<div class="tw-wrap"><div class="tw-empty">
          <div class="tw-empty-icon">🕰️</div>
          <div class="tw-empty-title">织光机还没有可织的碎片</div>
          <div class="tw-empty-sub">去写写日记、拍张照片、聊聊蜜语、解锁成就……<br>当生活散落足够的碎片，这里会为你织出一部可回望的时光。</div>
        </div></div>`;
    }

    _layout(m) {
        return `<div class="tw-wrap">
          <div class="tw-hero">
            <div class="tw-hero-title">🕰️ 织光机</div>
            <div class="tw-hero-sub">${m.events.length} 个碎片 · ${new Set(m.events.map(e=>e.source)).size} 个来源 · 已织成你的时光</div>
          </div>
          <div class="tw-tabs">
            ${[['letter','💌 叙事信'],['timeline','🧵 生活流'],['mile','🌱 里程碑'],['board','❤️ 亲密度']].map(([k,l])=>
              `<button class="tw-tab ${this._tab===k?'on':''}" data-tab="${k}">${l}</button>`).join('')}
          </div>
          <div class="tw-body">${this._panel(m)}</div>
        </div>`;
    }

    _panel(m) {
        if (this._tab === 'timeline') return this._timeline(m);
        if (this._tab === 'mile') return this._milestones(m);
        if (this._tab === 'board') return this._board(m);
        return this._letter(m);
    }

    _letter(m) {
        const L = m.letter;
        if (!L) return '<div class="tw-hint">碎片还太少，织不出一封完整的信。</div>';
        const ai = this.app.aiLetter || null;
        const moodColor = L.stats.avgMood > 0.2 ? '#4ade80' : L.stats.avgMood < -0.2 ? '#f87171' : '#58a6ff';
        // [v2.14.0] AI 升华层：有 AI 信优先渲染，本地规则版作离线/降级兜底
        const letterBody = (ai && ai.paragraphs && ai.paragraphs.length)
            ? `<div class="tw-letter-title">✨ 一封被 AI 织起的时光信</div>
               ${ai.paragraphs.map(p => `<p class="tw-letter-p">${esc(p)}</p>`).join('')}
               <div class="tw-letter-stats"><span class="tw-chip" style="color:#e8a33d">AI 升华 · 本地规则版可导出</span></div>`
            : `<div class="tw-letter-title">${esc(L.title)}</div>
               ${L.paragraphs.map(p => `<p class="tw-letter-p">${esc(p)}</p>`).join('')}
               <div class="tw-letter-stats">
                 <span class="tw-chip" style="color:${moodColor}">情绪 ${L.stats.avgMood>=0?'+':''}${L.stats.avgMood.toFixed(2)}</span>
                 ${L.stats.topPerson?`<span class="tw-chip">❤️ ${esc(L.stats.topPerson)}</span>`:''}
                 <span class="tw-chip">${L.stats.firsts} 个第一次</span>
               </div>`;
        const aiBtn = ai && ai.loading
            ? '<button class="tw-export" disabled>✨ AI 升华中…</button>'
            : '<button class="tw-export" id="tw-ai">✨ 求 AI 升华这封信</button>';
        const aiErr = (ai && ai.error) ? `<div class="tw-hint" style="color:#f87171">${esc(ai.error)}</div>` : '';
        return `
        <div class="tw-curve">${this._curve(m)}</div>
        <div class="tw-letter">
          ${letterBody}
        </div>
        ${aiErr}
        <div class="tw-actions">
          ${aiBtn}
          <button class="tw-export" id="tw-export">⬇ 导出本地规则版</button>
        </div>`;
    }

    _curve(m) {
        if (!m.curve || !m.curve.length) return '';
        const pts = m.curve.slice(-30);
        const bars = pts.map(p => {
            const h = Math.max(6, Math.round((p.mood + 1) / 2 * 44));
            const col = p.mood > 0.15 ? '#4ade80' : p.mood < -0.15 ? '#f87171' : '#58a6ff';
            return `<div class="tw-curve-bar" title="${esc(p.label)}" style="height:${h}px;background:${col}"></div>`;
        }).join('');
        return `<div class="tw-curve-label">生活情绪曲线（近 ${pts.length} 拍 · 绿=上扬/红=下沉/蓝=平静）</div><div class="tw-curve-track">${bars}</div>`;
    }

    _timeline(m) {
        return m.timeline.map(b => `
          <div class="tw-day">
            <div class="tw-day-head"><span class="tw-day-label">${esc(b.label)}</span>
              <span class="tw-day-mood ${b.avgMood>0.2?'pos':b.avgMood<-0.2?'neg':''}">${b.avgMood>0.2?'☀️':b.avgMood<-0.2?'🌧':'⛅'}</span></div>
            ${b.events.map(e => `<div class="tw-ev">
              <span class="tw-ev-icon">${SRC_ICON[e.source]||'✨'}</span>
              <div class="tw-ev-main"><div class="tw-ev-title">${esc(e.title)}</div>
              ${e.body?`<div class="tw-ev-body">${esc(e.body.slice(0,80))}</div>`:''}</div>
              ${e.actors.length?`<span class="tw-ev-actor">${esc(e.actors[0])}</span>`:''}
            </div>`).join('')}
          </div>`).join('');
    }

    _milestones(m) {
        if (!m.milestones.length) return '<div class="tw-hint">还没有里程碑。第一次总是值得期待。</div>';
        return m.milestones.map(x => `
          <div class="tw-mile">
            <span class="tw-mile-icon">${x.icon}</span>
            <div><div class="tw-mile-label">${esc(x.label)}</div>
            <div class="tw-mile-detail">${esc(x.detail)}</div></div>
          </div>`).join('');
    }

    _board(m) {
        if (!m.board.length) return '<div class="tw-hint">还没有人物轨迹。</div>';
        const max = m.board[0].score || 1;
        return m.board.slice(0, 12).map((b, i) => `
          <div class="tw-person">
            <span class="tw-person-rank">${['🥇','🥈','🥉'][i] || (i+1)}</span>
            <div class="tw-person-main">
              <div class="tw-person-name">${esc(b.name)} <span class="tw-person-meta">${b.interactions}次交集 · ${b.breadth}场景</span></div>
              <div class="tw-person-bar"><div class="tw-person-fill" style="width:${Math.round(b.score/max*100)}%"></div></div>
            </div>
            <span class="tw-person-mood ${b.avgMood>0.2?'pos':b.avgMood<-0.2?'neg':''}">${b.avgMood>0.2?'😊':b.avgMood<-0.2?'😔':'😐'}</span>
          </div>`).join('');
    }

    _bind() {
        const root = this.app.phoneShell?.element;
        if (!root) return;
        root.querySelectorAll('.tw-tab').forEach(btn => {
            btn.addEventListener('click', () => { this._tab = btn.dataset.tab; this.render(); });
        });
        const ex = root.querySelector('#tw-export');
        if (ex) ex.addEventListener('click', () => this._export());
        // [v2.14.0] AI 升华按钮：调 app.composeAILetter（无 API 时该方法已自处理降级）
        const aiBtn = root.querySelector('#tw-ai');
        if (aiBtn) aiBtn.addEventListener('click', () => { const p = this.app.composeAILetter?.(); if (p && typeof p.catch === 'function') p.catch(() => {}); });
    }

    _export() {
        const m = buildNarrative(this.app.storage, {});
        if (!m.letter) return;
        const txt = `【${m.letter.title}】\n\n${m.letter.paragraphs.join('\n\n')}\n\n—— 织光机 · ${new Date().toLocaleDateString('zh-CN')}`;
        try {
            const blob = new Blob([txt], { type: 'text/plain;charset=utf-8' });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = `织光机-时光信-${Date.now()}.txt`;
            a.click();
            URL.revokeObjectURL(a.href);
        } catch (e) { console.error('[织光机] 导出失败', e); }
    }

    _css() {
        return `<style>
.tw-wrap{padding:12px;font-size:13px;color:var(--rp-text,#e6edf3);min-height:100%;background:linear-gradient(180deg,#1a1410,#12100c)}
.tw-hero{padding:8px 4px 12px;border-bottom:1px solid #e8a33d33}
.tw-hero-title{font-size:20px;font-weight:700;color:#e8a33d}
.tw-hero-sub{font-size:11px;color:#9c8b7a;margin-top:2px}
.tw-tabs{display:flex;gap:6px;padding:10px 0;flex-wrap:wrap}
.tw-tab{flex:1;min-width:64px;padding:7px 4px;border:1px solid #e8a33d44;background:#e8a33d11;color:#cbb89a;border-radius:8px;font-size:12px;cursor:pointer}
.tw-tab.on{background:#e8a33d;color:#1a1410;font-weight:700}
.tw-empty{text-align:center;padding:60px 20px}
.tw-empty-icon{font-size:48px}
.tw-empty-title{font-size:16px;font-weight:700;margin:16px 0 8px;color:#e8a33d}
.tw-empty-sub{font-size:12px;color:#9c8b7a;line-height:1.8}
.tw-curve{margin-bottom:12px;background:#ffffff08;border-radius:10px;padding:10px}
.tw-curve-label{font-size:10px;color:#9c8b7a;margin-bottom:6px}
.tw-curve-track{display:flex;align-items:flex-end;gap:2px;height:48px;border-bottom:1px solid #ffffff22}
.tw-curve-bar{flex:1;min-width:3px;border-radius:2px 2px 0 0;opacity:0.85}
.tw-letter{background:linear-gradient(135deg,#e8a33d18,#e8a33d08);border:1px solid #e8a33d33;border-radius:12px;padding:16px}
.tw-letter-title{font-size:15px;font-weight:700;color:#e8a33d;margin-bottom:10px}
.tw-letter-p{font-size:13px;line-height:1.9;color:#e6d9c8;margin:8px 0}
.tw-letter-stats{display:flex;gap:6px;flex-wrap:wrap;margin-top:12px}
.tw-chip{font-size:10px;background:#ffffff12;border-radius:10px;padding:3px 8px;color:#cbb89a}
.tw-export{width:100%;margin-top:12px;padding:10px;border:none;border-radius:10px;background:#e8a33d;color:#1a1410;font-weight:700;cursor:pointer}
.tw-day{margin-bottom:14px}
.tw-day-head{display:flex;justify-content:space-between;padding:6px 2px;border-bottom:1px solid #ffffff18;margin-bottom:6px}
.tw-day-label{font-weight:700;color:#e8a33d;font-size:12px}
.tw-ev{display:flex;gap:8px;padding:6px 2px;align-items:flex-start}
.tw-ev-icon{font-size:14px}
.tw-ev-main{flex:1;min-width:0}
.tw-ev-title{font-size:12px;color:#e6d9c8}
.tw-ev-body{font-size:11px;color:#9c8b7a;margin-top:2px}
.tw-ev-actor{font-size:10px;background:#e8a33d22;color:#e8a33d;border-radius:8px;padding:2px 6px;flex-shrink:0}
.tw-mile{display:flex;gap:10px;padding:10px;background:#ffffff06;border-radius:10px;margin-bottom:8px;align-items:center}
.tw-mile-icon{font-size:20px}
.tw-mile-label{font-size:12px;font-weight:700;color:#e8a33d}
.tw-mile-detail{font-size:11px;color:#9c8b7a}
.tw-person{display:flex;gap:10px;align-items:center;padding:8px;background:#ffffff06;border-radius:10px;margin-bottom:8px}
.tw-person-rank{font-size:16px;width:24px;text-align:center}
.tw-person-main{flex:1}
.tw-person-name{font-size:13px;font-weight:700;color:#e6d9c8}
.tw-person-meta{font-size:10px;color:#9c8b7a;font-weight:400;margin-left:6px}
.tw-person-bar{height:5px;background:#ffffff14;border-radius:3px;margin-top:5px;overflow:hidden}
.tw-person-fill{height:100%;background:linear-gradient(90deg,#e8a33d,#f5c96b);border-radius:3px}
.tw-person-mood.pos{color:#4ade80}.tw-person-mood.neg{color:#f87171}
.tw-day-mood.pos,.tw-hint{color:#9c8b7a}
.tw-hint{text-align:center;padding:30px;font-size:12px}
</style>`;
    }
}

export default TimeweaverView;