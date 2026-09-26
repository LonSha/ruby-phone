/* ========================================================
 * 塔罗 (Tarot) App — 视图
 * 牌阵选择 → 抽牌 → 翻牌网格 → 历史 → 求 AI 解读
 * ======================================================== */
'use strict';
import { SPREADS } from './tarot-data.js';

function esc(s) {
    return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function dateStr(ts) {
    const d = new Date(Number(ts) || Date.now());
    const p = n => String(n).padStart(2, '0');
    return `${d.getMonth() + 1}月${d.getDate()}日 ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export class TarotView {
    constructor(app) {
        this.app = app;
        this.selectedSpread = 'single';
    }

    render() {
        const html = `
        <style>
        .tarot-root { padding: 12px; font-family: system-ui; color: #e2e8f0; min-height:100%; box-sizing:border-box;
          background: linear-gradient(160deg, #1e1b4b 0%, #312e81 60%, #4c1d95 100%); }
        .tarot-root * { box-sizing: border-box; }
        .tarot-header { display:flex; align-items:center; justify-content:space-between; margin-bottom:10px; }
        .tarot-header h2 { margin:0; font-size:16px; color:#f8fafc; letter-spacing:2px; }
        .tarot-sub { font-size:10px; color:#a5b4fc; }
        .tarot-question { width:100%; padding:10px; border-radius:10px; border:1px solid #4c1d95; background:rgba(15,23,42,0.5); color:#e2e8f0; font-size:13px; margin-bottom:10px; resize:none; }
        .tarot-question::placeholder { color:#94a3b8; }
        .tarot-spreads { display:flex; flex-wrap:wrap; gap:8px; margin-bottom:10px; }
        .tarot-spread-btn { flex:1; min-width:46%; padding:8px; border-radius:10px; border:1px solid #6366f1; background:rgba(99,102,241,0.15); color:#c7d2fe; font-size:12px; cursor:pointer; }
        .tarot-spread-btn.active { background:#6366f1; color:#fff; }
        .tarot-draw-btn { width:100%; padding:12px; border-radius:12px; border:none; background:linear-gradient(90deg,#8b5cf6,#6366f1); color:#fff; font-size:15px; font-weight:600; cursor:pointer; margin-bottom:12px; letter-spacing:4px; }
        .tarot-result { margin-bottom:10px; }
        .tarot-grid { display:grid; grid-template-columns:repeat(3,1fr); gap:8px; }
        .tarot-card { background:rgba(15,23,42,0.6); border-radius:10px; padding:8px; border:1px solid #4c1d95; text-align:center; }
        .tarot-card-back { height:70px; border-radius:8px; background:linear-gradient(135deg,#6d28d9,#4338ca); display:flex; align-items:center; justify-content:center; color:#c7d2fe; font-size:22px; cursor:pointer; }
        .tarot-card-revealed { height:auto; }
        .tarot-card-name { font-size:13px; font-weight:600; color:#f8fafc; margin-top:4px; }
        .tarot-card-up { font-size:11px; color:#94a3b8; margin-top:2px; }
        .tarot-card-rev { font-size:10px; color:#fca5a5; }
        .tarot-pos { font-size:10px; color:#a5b4fc; }
        .tarot-ask { width:100%; padding:10px; border-radius:10px; border:1px solid #f59e0b; background:rgba(245,158,11,0.15); color:#fde68a; font-size:13px; cursor:pointer; margin-bottom:12px; }
        .tarot-history-title { font-size:12px; color:#94a3b8; margin:10px 0 6px; }
        .tarot-history { display:flex; flex-direction:column; gap:6px; }
        .tarot-history-item { background:rgba(15,23,42,0.4); border-radius:8px; padding:8px; font-size:11px; color:#cbd5e1; }
        .tarot-history-item b { color:#f8fafc; }
        .tarot-empty { padding:20px; text-align:center; color:#94a3b8; font-size:12px; }
        </style>
        <div class="tarot-root">
          <div class="tarot-header">
            <h2>🔮 塔罗</h2>
            <span class="tarot-sub">78 牌 · 5 牌阵</span>
          </div>
          <textarea class="tarot-question" id="tarot-q" rows="2" placeholder="心中默想一个问题…（可留空）"></textarea>
          <div class="tarot-spreads">
            ${Object.entries(SPREADS).map(([k, s]) =>
              `<button class="tarot-spread-btn ${k === this.selectedSpread ? 'active' : ''}" data-spread="${k}">${esc(s.name)}</button>`
            ).join('')}
          </div>
          <button class="tarot-draw-btn" id="tarot-draw">✦ 洗牌抽牌 ✦</button>
          <div class="tarot-result" id="tarot-result"></div>
          <button class="tarot-ask" id="tarot-ask" style="display:none">💬 求 AI 解读</button>
          <div class="tarot-history-title">历史占卜</div>
          <div class="tarot-history" id="tarot-history"></div>
        </div>`;
        this.app.phoneShell.setContent(html, 'tarot-main');
        this._bind();
        this._renderHistory();
    }

    _bind() {
        const root = document;
        const spreadBtns = root.querySelectorAll('.tarot-spread-btn');
        spreadBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                this.selectedSpread = btn.dataset.spread;
                spreadBtns.forEach(b => b.classList.toggle('active', b === btn));
            });
        });
        const drawBtn = root.getElementById('tarot-draw');
        drawBtn.addEventListener('click', () => {
            const q = (root.getElementById('tarot-q')?.value || '').trim();
            this.app.performDraw(this.selectedSpread, q);
            this._renderResult();
        });
        const askBtn = root.getElementById('tarot-ask');
        askBtn.addEventListener('click', () => {
            const injection = this.app.buildInjection();
            if (!injection) return;
            // 发送给 AI: 走 sendToChat 通道, 让角色在剧情中解读
            const event = new CustomEvent('phone:sendToChat', {
                detail: {
                    message: `【塔罗占卜】${injection}\n（请以角色口吻为对方解读这副牌）`,
                    chatId: undefined, chatName: undefined
                }
            });
            window.dispatchEvent(event);
            this.app.phoneShell?.showNotification?.('已请求解读', '请角色在对话中为你解读牌意', '🔮');
        });
    }

    _renderResult() {
        const root = document;
        const box = root.getElementById('tarot-result');
        const askBtn = root.getElementById('tarot-ask');
        const draw = this.app.currentDraw;
        if (!draw) return;
        const backHtml = draw.cards.map((c, i) => `
          <div class="tarot-card" data-idx="${i}">
            <div class="tarot-pos">${esc(c.position.label)}</div>
            <div class="tarot-card-back">🌟</div>
          </div>`).join('');
        box.innerHTML = `
          <div class="tarot-spread-title">✦ ${esc(draw.spread.name)} ${draw.question ? '· ' + esc(draw.question) : ''}</div>
          <div class="tarot-grid">${backHtml}</div>`;
        // 点击翻牌
        box.querySelectorAll('.tarot-card').forEach(cardEl => {
            cardEl.addEventListener('click', () => {
                const idx = Number(cardEl.dataset.idx);
                const c = draw.cards[idx];
                cardEl.innerHTML = `
                  <div class="tarot-pos">${esc(c.position.label)}</div>
                  <div class="tarot-card-revealed" style="border-top:3px solid ${esc(c.color || '#8b5cf6')}">
                    <div class="tarot-card-name">${c.reversed ? '🔄 ' : ''}${esc(c.name)}</div>
                    <div class="tarot-card-up">${c.reversed ? '逆位' : '正位'}：${esc(c.reversed ? c.down : c.up)}</div>
                  </div>`;
            });
        });
        askBtn.style.display = 'block';
        this._renderHistory();
    }

    _renderHistory() {
        const root = document;
        const hist = root.getElementById('tarot-history');
        if (!hist) return;
        const items = this.app.history || [];
        hist.innerHTML = items.length ? items.slice(0, 10).map(h => `
          <div class="tarot-history-item">
            <b>${esc(h.spread)}</b> ${dateStr(h.at)}<br>
            ${h.cards.map(c => esc(c.name) + (c.reversed ? '(逆)' : '')).join(' · ')}
            ${h.question ? `<div style="color:#94a3b8;margin-top:2px">问：${esc(h.question)}</div>` : ''}
          </div>`).join('') : '<div class="tarot-empty">还没有占卜记录。洗一局吧 ✨</div>';
    }
}