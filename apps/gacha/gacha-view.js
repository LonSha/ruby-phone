/* ========================================================
 * 幸运转盘 (Gacha) App — 视图
 * 卡池选择 / 单抽·十连 / 品质高亮 / 背包 / 幸运币
 * ======================================================== */
'use strict';
import { QUALITY_META, SINGLE_COST, TEN_COST } from './gacha-data.js';

function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&#34;').replace(/'/g, '&#39;');
}

export class GachaView {
  constructor(app) {
    this.app = app;
    this.tab = 'gacha';       // gacha | bag | history
    this.selectedPool = (app.data.getPools()[0] || {}).id || 'all';
  }

  render() {
    const html = `
    <style>
    .ga-root { display:flex; flex-direction:column; height:100%; font-family:system-ui; color:#f1f5f9; background:linear-gradient(165deg,#1e1b4b,#312e81 55%,#4c1d95); box-sizing:border-box; overflow:hidden; }
    .ga-root * { box-sizing:border-box; }
    .ga-head { display:flex; align-items:center; justify-content:space-between; padding:10px 12px; background:rgba(15,23,42,.35); border-bottom:1px solid rgba(255,255,255,.08); }
    .ga-head h2 { margin:0; font-size:16px; letter-spacing:1px; color:#f8fafc; }
    .ga-coins { font-size:12px; color:#fbbf24; font-weight:700; background:rgba(0,0,0,.25); padding:4px 10px; border-radius:20px; }
    .ga-tabs { display:flex; padding:8px 12px 0; gap:6px; }
    .ga-tab { flex:1; border:none; background:rgba(255,255,255,.06); color:#cbd5e1; border-radius:10px 10px 0 0; padding:8px; font-size:12px; cursor:pointer; }
    .ga-tab.on { background:rgba(255,255,255,.14); color:#fff; font-weight:700; }
    .ga-body { flex:1; overflow-y:auto; padding:10px 12px 20px; }
    .ga-pools { display:grid; grid-template-columns:repeat(2,1fr); gap:8px; margin-bottom:12px; }
    .ga-pool { border:1px solid rgba(255,255,255,.12); border-radius:10px; padding:8px; background:rgba(255,255,255,.05); cursor:pointer; }
    .ga-pool.on { border-color:#fbbf24; background:rgba(251,191,36,.12); }
    .ga-pool b { display:block; font-size:12px; }
    .ga-pool span { display:block; font-size:10px; color:#94a3b8; margin-top:3px; }
    .ga-actions { display:flex; gap:8px; margin-bottom:12px; }
    .ga-btn { flex:1; border:none; border-radius:12px; padding:12px; font-size:14px; font-weight:700; cursor:pointer; color:#fff; }
    .ga-btn-one { background:linear-gradient(90deg,#8b5cf6,#6366f1); }
    .ga-btn-ten { background:linear-gradient(90deg,#f59e0b,#f97316); }
    .ga-btn:disabled { opacity:.45; cursor:not-allowed; }
    .ga-grid { display:grid; grid-template-columns:repeat(3,1fr); gap:8px; }
    .ga-card { background:rgba(15,23,42,.55); border-radius:10px; padding:8px; text-align:center; border:1px solid rgba(255,255,255,.1); }
    .ga-card .ga-q { display:inline-block; font-size:9px; padding:1px 8px; border-radius:10px; color:#fff; margin-bottom:5px; }
    .ga-card .ga-n { font-size:12px; font-weight:600; line-height:1.3; word-break:break-all; }
    .ga-card .ga-t { font-size:10px; color:#94a3b8; margin-top:3px; }
    .ga-empty { text-align:center; color:#94a3b8; font-size:12px; padding:30px 10px; }
    .ga-bag-item { display:flex; align-items:center; justify-content:space-between; background:rgba(15,23,42,.45); border-radius:8px; padding:8px 10px; margin-bottom:6px; }
    .ga-bag-item .q { font-size:10px; padding:1px 8px; border-radius:10px; color:#fff; }
    .ga-bag-count { font-size:12px; color:#cbd5e1; font-weight:700; }
    .ga-hist { background:rgba(15,23,42,.4); border-radius:8px; padding:8px 10px; margin-bottom:6px; font-size:11px; color:#cbd5e1; }
    .ga-hist b { color:#fbbf24; }
    </style>
    <div class="ga-root">
      <div class="ga-head">
        <h2>🎰 幸运转盘</h2>
        <span class="ga-coins">🪙 ${this.app.data.getBalance()}</span>
      </div>
      <div class="ga-tabs">
        <button class="ga-tab${this.tab === 'gacha' ? ' on' : ''}" data-ga-tab="gacha">抽取</button>
        <button class="ga-tab${this.tab === 'bag' ? ' on' : ''}" data-ga-tab="bag">背包</button>
        <button class="ga-tab${this.tab === 'history' ? ' on' : ''}" data-ga-tab="history">记录</button>
      </div>
      <div class="ga-body">${this._renderBody()}</div>
    </div>`;
    /* [v3.61.0 · O1] 唯一内容入口纪律：此前这里写 `this.app.phoneShell.screen.innerHTML = html`，
     *   直接覆盖 `.phone-screen` 的全部子节点 —— 后果与 phone-shell 的第 3 步同源：
     *   把 `.view-stack-container`（以及返回键等 screen 直系成员）一并抹掉，
     *   且因为没有 view-stack 了，下一次 setContent 会以为自己是首帧、重建一份栈，
     *   历史栈与图层随之错位。改成走 setContent 后，内容落进 [data-view-id] 图层，
     *   与全仓另外 40 余处 App 同一条路径。
     *   `_bind()` 里读的是 `screen`（图层的祖先），选择器一字不用改。 */
    this.app.phoneShell.setContent(html, 'gacha-main');
    this._bind();
  }

  _renderBody() {
    if (this.tab === 'bag') return this._renderBag();
    if (this.tab === 'history') return this._renderHistory();
    // 抽取页
    const pools = this.app.data.getPools();
    const poolHtml = pools.map(p => `
      <div class="ga-pool${this.selectedPool === p.id ? ' on' : ''}" data-pool="${esc(p.id)}">
        <b>${esc(p.name || p.id)}</b><span>${this.app.data.getItemsOfPool(p.id).length} 件</span>
      </div>`).join('');
    const last = this.lastResult;
    const resultHtml = last ? `
      <div class="ga-grid">${last.results.map(r => {
        const q = QUALITY_META[r.quality] || QUALITY_META['普通'];
        return `<div class="ga-card" style="border-color:${q.color}55"><span class="ga-q" style="background:${q.color}">${esc(r.quality)}</span><div class="ga-n">${esc(r.name)}</div><div class="ga-t">${esc(r.type || '道具')}</div></div>`;
      }).join('')}</div>` : `<div class="ga-empty">选择卡池，开始抽取 🎰<br/>单抽 ${SINGLE_COST} 🪙 · 十连 ${TEN_COST} 🪙</div>`;
    return poolHtml +
      `<div class="ga-actions">
         <button class="ga-btn ga-btn-one" id="ga-once" ${this.app.data.getBalance() < SINGLE_COST ? 'disabled' : ''}>单抽 ${SINGLE_COST}🪙</button>
         <button class="ga-btn ga-btn-ten" id="ga-ten" ${this.app.data.getBalance() < TEN_COST ? 'disabled' : ''}>十连 ${TEN_COST}🪙</button>
       </div>` + resultHtml;
  }

  _renderBag() {
    const inv = this.app.data.getInventory();
    if (!inv.length) return '<div class="ga-empty">背包还是空的，先去扭一个吧</div>';
    return inv.map(item => {
      const q = QUALITY_META[item.quality] || QUALITY_META['普通'];
      return `<div class="ga-bag-item"><div><span class="q" style="background:${q.color}">${esc(item.quality)}</span> <b style="font-size:13px">${esc(item.name)}</b></div><span class="ga-bag-count">×${item.count}</span></div>`;
    }).join('');
  }

  _renderHistory() {
    const hist = this.app.data.history || [];
    if (!hist.length) return '<div class="ga-empty">还没有抽卡记录</div>';
    return hist.map(h => {
      const when = new Date(h.at);
      const time = `${when.getMonth()+1}/${when.getDate()} ${String(when.getHours()).padStart(2,'0')}:${String(when.getMinutes()).padStart(2,'0')}`;
      const got = (h.got || []).map(g => `<b>${esc(g.name)}</b>`).join('、');
      return `<div class="ga-hist">${time} · 花费 ${h.cost}🪙 · ${got}</div>`;
    }).join('');
  }

  _bind() {
    const root = this.app.phoneShell.screen;
    root.querySelectorAll('.ga-tab').forEach(btn => {
      btn.addEventListener('click', () => { this.tab = btn.dataset.gaTab; this.render(); });
    });
    root.querySelectorAll('.ga-pool').forEach(p => {
      p.addEventListener('click', () => { this.selectedPool = p.dataset.pool; this.render(); });
    });
    const doPull = (count) => {
      const fn = count >= 10 ? 'pullTen' : 'pullOnce';
      const r = this.app.data[fn](this.selectedPool);
      if (r.ok) {
        this.lastResult = r;
        this.app.phoneShell.showNotification?.('幸运转盘', `抽到 ${r.results.length} 件 · 余额 ${r.balance}🪙`, '🎰');
      } else {
        this.app.phoneShell.showNotification?.('幸运转盘', r.reason || '抽卡失败', '⚠️');
      }
      this.render();
    };
    root.querySelector('#ga-once')?.addEventListener('click', () => doPull(1));
    root.querySelector('#ga-ten')?.addEventListener('click', () => doPull(10));
  }
}

export default GachaView;