/* ========================================================
 * gacha-view.js — [v4.165.0]「照现实重写」· 幸运转盘视图
 * --------------------------------------------------------
 * 上一版的形态：三颗页签 + 卡池两格 + 两颗按钮，事件逐个元素挂，
 *   每次重绘重新 querySelectorAll 一遍再绑一遍 —— 元素没了监听就没了，
 *   元素换了一批就多绑一层（重绘 N 次 = 绑 N 层）。
 * 现实里的扭蛋 App 是三块：**抽取**（选池、看概率与价格、按一下）→
 *   **背包**（按品质分组、看重复几次）→ **记录**（每次花了多少、出了什么）。
 *
 * 纪律（与桃宝 / 心境 / 周期数学同一套）：
 *   ① 事件只挂在根容器上一次（click 一个），靠 data-act 与 closest() 分派；
 *   ② 读不到 DOM 一律不抛（夹具里 querySelector 返回 null）；
 *   ③ 数值缺失显示破折号，不拿 0 冒充；币不够就如实说「还差多少」，不画假按钮；
 *   ④ 概率只在数据层算（_rollOne 的权重在数据层），视图不另算一份概率。
 * ======================================================== */
'use strict';
import { QUALITY_META, SINGLE_COST, TEN_COST } from './gacha-data.js';

const AMP = String.fromCharCode(38);
const LT = String.fromCharCode(60);
const GT = String.fromCharCode(62);
const QUOTE = String.fromCharCode(34);
const DASH = String.fromCharCode(45, 45);

function esc(s) {
  return String(s === undefined || s === null ? '' : s)
    .split(AMP).join(AMP + 'amp;')
    .split(LT).join(AMP + 'lt;')
    .split(GT).join(AMP + 'gt;')
    .split(QUOTE).join(AMP + 'quot;');
}
function num(v) { return (typeof v === 'number' && Number.isFinite(v)) ? String(v) : DASH; }

/** 品质顺序：神话最前、普通最后。数据层给的 order 才是唯一口径。 */
function qorder(q) {
  const m = QUALITY_META[q];
  return (m && Number.isFinite(m.order)) ? m.order : 9;
}
function qcolor(q) {
  const m = QUALITY_META[q];
  return (m && m.color) ? m.color : '#94a3b8';
}

const TABS = [
  { key: 'gacha', label: '抽取' },
  { key: 'bag', label: '背包' },
  { key: 'history', label: '记录' },
];

const STYLE = `
<style>
.ga-root { display:flex; flex-direction:column; height:100%; box-sizing:border-box; overflow:hidden;
  font-family:system-ui; color:#f1f5f9; background:linear-gradient(165deg,#1e1b4b,#312e81 55%,#4c1d95); }
.ga-root * { box-sizing:border-box; }
.ga-head { display:flex; align-items:center; gap:10px; padding:10px 12px;
  background:rgba(15,23,42,.35); border-bottom:1px solid rgba(255,255,255,.08); }
.ga-title { flex:1; font-size:16px; font-weight:700; letter-spacing:1px; color:#f8fafc; }
.ga-coins { font-size:12px; font-weight:700; color:#fbbf24; background:rgba(0,0,0,.25); padding:4px 10px; border-radius:20px; }
.ga-body { flex:1; overflow-y:auto; padding:10px 12px 14px; display:flex; flex-direction:column; gap:10px; }
.ga-tabbar { display:flex; border-top:1px solid rgba(255,255,255,.08); background:rgba(15,23,42,.5); }
.ga-tab { flex:1; padding:10px 0 12px; border:0; background:none; color:#94a3b8; font-size:12px; cursor:pointer; }
.ga-tab.is-on { color:#fbbf24; font-weight:700; }
.ga-face { font-size:11px; line-height:1.7; color:#a5b4fc; background:rgba(255,255,255,.05);
  border-radius:10px; padding:8px 10px; }
.ga-sec { background:rgba(15,23,42,.45); border:1px solid rgba(255,255,255,.09); border-radius:12px; padding:10px; }
.ga-sec-title { font-size:12px; font-weight:700; color:#c7d2fe; margin-bottom:8px; }
.ga-pools { display:grid; grid-template-columns:repeat(2,1fr); gap:8px; }
.ga-pool { border:1px solid rgba(255,255,255,.12); border-radius:10px; padding:8px;
  background:rgba(255,255,255,.05); cursor:pointer; text-align:left; color:#e2e8f0; }
.ga-pool.is-on { border-color:#fbbf24; background:rgba(251,191,36,.14); }
.ga-pool b { display:block; font-size:12px; }
.ga-pool span { display:block; font-size:10px; color:#94a3b8; margin-top:3px; }
.ga-actions { display:flex; gap:8px; }
.ga-btn { flex:1; border:0; border-radius:12px; padding:12px; font-size:13px; font-weight:700;
  color:#fff; cursor:pointer; }
.ga-btn-one { background:linear-gradient(90deg,#8b5cf6,#6366f1); }
.ga-btn-ten { background:linear-gradient(90deg,#f59e0b,#f97316); }
.ga-btn:disabled { opacity:.45; cursor:not-allowed; }
.ga-cost { font-size:10px; opacity:.85; font-weight:400; }
.ga-grid { display:grid; grid-template-columns:repeat(3,1fr); gap:8px; }
.ga-card { background:rgba(15,23,42,.55); border:1px solid rgba(255,255,255,.1);
  border-radius:10px; padding:8px; text-align:center; }
.ga-card .ga-q { display:inline-block; font-size:9px; padding:1px 8px; border-radius:10px; color:#fff; margin-bottom:5px; }
.ga-card .ga-n { font-size:12px; font-weight:600; line-height:1.3; word-break:break-all; }
.ga-card .ga-t { font-size:10px; color:#94a3b8; margin-top:3px; }
.ga-row { display:flex; align-items:center; gap:8px; justify-content:space-between;
  padding:7px 0; font-size:12px; color:#e2e8f0; border-bottom:1px solid rgba(255,255,255,.06); }
.ga-row:last-child { border-bottom:0; }
.ga-row em { font-style:normal; font-size:11px; color:#94a3b8; }
.ga-tag { font-size:10px; padding:1px 8px; border-radius:10px; color:#fff; }
.ga-bag-count { font-size:12px; font-weight:700; color:#cbd5e1; }
.ga-hist { background:rgba(15,23,42,.4); border-radius:8px; padding:8px 10px; font-size:11px; color:#cbd5e1; }
.ga-hist b { color:#fbbf24; font-weight:600; }
.ga-empty { text-align:center; color:#94a3b8; font-size:12px; line-height:1.8; padding:24px 10px;
  background:rgba(15,23,42,.4); border-radius:12px; }
</style>`;

export class GachaView {
  constructor(app) {
    this.app = app;
    this.tab = 'gacha';
    /* 默认选中第一个池；池读不到时留空（render 里如实说读不到，不拿 'all' 冒充）。 */
    let pools = [];
    try { pools = (app && app.data && typeof app.data.getPools === 'function') ? app.data.getPools() : []; }
    catch (_e) { pools = []; }
    this.selectedPool = (pools[0] && pools[0].id) ? pools[0].id : '';
    this.lastResult = null;
    this._boundScreen = null;
    this._root = null;
    this._hClick = null;
  }

  /* ---------- 1. 挂载与重绘 ---------- */

  render() {
    const shell = this.app && this.app.phoneShell;
    if (!shell) return;
    const html = this._html();
    /* [v3.61.0 · O1] 唯一内容入口：走 setContent 落进 [data-view-id] 图层，
     *   不直接覆盖 .phone-screen（否则会抹掉 view-stack 与返回键）。 */
    if (typeof shell.setContent === 'function') shell.setContent(html, 'gacha-main');
    /* [v4.186.0] 不写 .phone-screen：screen-host 门实测此处会连同图层栈/返回键/小白条一起抹掉。
     *   setContent 缺席时如实不画（与 reading / diary 同口径），不退回外壳直写。 */
    this._bind();
  }

  _mount() {
    const shell = this.app && this.app.phoneShell;
    const screen = shell && shell.screen;
    if (!screen || typeof screen.querySelector !== 'function') return null;
    let root = null;
    try { root = screen.querySelector('.ga-root'); } catch (_e) { root = null; }
    return root || null;
  }

  /* ---------- 2. 事件（根容器一次，靠 data-act 分派） ---------- */

  _bind() {
    const root = this._mount();
    if (!root) return;
    this._root = root;
    if (this._boundScreen === root) return;
    this._hClick = (ev) => this._handleClick(ev);
    if (typeof root.addEventListener === 'function') root.addEventListener('click', this._hClick);
    this._boundScreen = root;
  }

  _act(el, name) {
    try { return (el && typeof el.getAttribute === 'function') ? el.getAttribute(name) : null; }
    catch (_e) { return null; }
  }

  _handleClick(ev) {
    const target = ev && ev.target;
    const hit = (target && typeof target.closest === 'function') ? target.closest('[data-act]') : null;
    const act = this._act(hit, 'data-act');
    if (!act) return;
    if (act === 'tab') {
      const key = this._act(hit, 'data-tab') || 'gacha';
      if (TABS.some((t) => t.key === key)) { this.tab = key; this.render(); }
      return;
    }
    if (act === 'pool') {
      const id = this._act(hit, 'data-pool') || '';
      if (id) { this.selectedPool = id; this.render(); }
      return;
    }
    if (act === 'pull' || act === 'pull10') this._doPull(act === 'pull10' ? 10 : 1);
  }

  /* ---------- 3. 抽取 ---------- */

  _doPull(count) {
    const data = this.app && this.app.data;
    if (!data) return;
    const fn = count >= 10 ? 'pullTen' : 'pullOnce';
    let r = null;
    try { r = data[fn](this.selectedPool); } catch (_e) { r = { ok: false, reason: '抽卡失败' }; }
    if (r && r.ok) {
      this.lastResult = r;
      const n = Array.isArray(r.results) ? r.results.length : 0;
      try {
        this.app.phoneShell.showNotification?.('幸运转盘',
          '抽到 ' + String(n) + ' 件 · 余额 ' + String(r.balance) + '🪙', '🎰');
      } catch (_e) { /* 通知不是本视图的责任，读不到就算了 */ }
    } else {
      try {
        this.app.phoneShell.showNotification?.('幸运转盘', (r && r.reason) || '抽卡失败', '⚠️');
      } catch (_e) { /* 同上 */ }
    }
    this.render();
  }

  /* ---------- 4. 三页 ---------- */

  _poolsHTML() {
    const data = this.app && this.app.data;
    let pools = [];
    try { pools = (data && typeof data.getPools === 'function') ? data.getPools() : []; }
    catch (_e) { pools = []; }
    if (!pools.length) return '<div class="ga-face">卡池一张都没读到 —— 不是没有池，是数据层这不回话</div>';
    const cells = pools.map((p) => {
      let n = DASH;
      try { n = num((data.getItemsOfPool(p.id) || []).length); } catch (_e) { n = DASH; }
      const on = (p.id === this.selectedPool) ? ' is-on' : '';
      return '<button class="ga-pool' + on + '" data-act="pool" data-pool="' + esc(p.id) + '">'
        + '<b>' + esc(p.name || p.id) + '</b><span>' + n + ' 件道具</span></button>';
    });
    return '<div class="ga-pools">' + cells.join('') + '</div>';
  }

  _resultHTML() {
    const last = this.lastResult;
    if (!last || !Array.isArray(last.results) || !last.results.length) {
      return '<div class="ga-empty">选一个卡池，按下面那颗按钮开始 🎰<br/>'
        + '单抽 ' + num(SINGLE_COST) + ' 🪙 · 十连 ' + num(TEN_COST) + ' 🪙（十连省 '
        + num(SINGLE_COST * 10 - TEN_COST) + '）</div>';
    }
    const rows = last.results.map((r) => {
      const q = esc(r.quality || '普通');
      const c = esc(qcolor(r.quality));
      return '<div class="ga-card" data-quality="' + q + '">'
        + '<span class="ga-q" data-tone="' + q + '" data-color="' + c + '" style="background:' + c + '">' + q + '</span>'
        + '<div class="ga-n">' + esc(r.name) + '</div>'
        + '<div class="ga-t">' + esc(r.type || '道具') + '</div></div>';
    });
    return '<div class="ga-sec"><div class="ga-sec-title">这一把（花 '
      + num(last.cost) + ' 🪙，余额 ' + num(last.balance) + ' 🪙）</div>'
      + '<div class="ga-grid">' + rows.join('') + '</div></div>';
  }

  _gachaHTML() {
    const data = this.app && this.app.data;
    let balance = NaN;
    let stats = {};
    try { balance = (data && typeof data.getBalance === 'function') ? data.getBalance() : NaN; } catch (_e) { balance = NaN; }
    try { stats = (data && typeof data.getStats === 'function') ? (data.getStats() || {}) : {}; } catch (_e) { stats = {}; }
    const canOne = Number.isFinite(balance) && balance >= SINGLE_COST;
    const canTen = Number.isFinite(balance) && balance >= TEN_COST;
    const gap = Number.isFinite(balance) ? Math.max(0, SINGLE_COST - balance) : NaN;
    const parts = ['<section class="ga-body" data-page="gacha">'];
    parts.push('<div class="ga-face">' + (Number.isFinite(balance)
      ? '余额 ' + num(balance) + ' 🪙 · 累计 ' + num(stats.pullCount) + ' 次 · 背包 ' + num(stats.itemKinds) + ' 种'
      : '余额读不到 —— 数据层这不回话，先别按抽卡') + '</div>');
    parts.push('<div class="ga-sec"><div class="ga-sec-title">卡池</div>' + this._poolsHTML() + '</div>');
    parts.push('<div class="ga-actions">'
      + '<button class="ga-btn ga-btn-one" data-act="pull"' + (canOne ? '' : ' disabled') + '>单抽 '
      + '<span class="ga-cost">' + num(SINGLE_COST) + ' 🪙</span></button>'
      + '<button class="ga-btn ga-btn-ten" data-act="pull10"' + (canTen ? '' : ' disabled') + '>十连 '
      + '<span class="ga-cost">' + num(TEN_COST) + ' 🪙</span></button>'
      + '</div>');
    if (!Number.isFinite(balance)) {
      parts.push('<div class="ga-face">价格照标，但余额读不到，按下去也没法保证扣得对</div>');
    } else if (!canOne) {
      parts.push('<div class="ga-face">单抽还差 ' + num(gap) + ' 🪙 —— 差多少就说多少，不画一颗假按钮</div>');
    }
    parts.push(this._resultHTML());
    parts.push('</section>');
    return parts.join('');
  }

  _bagHTML() {
    let inv = [];
    try { inv = (this.app.data.getInventory() || []); } catch (_e) { inv = []; }
    const parts = ['<section class="ga-body" data-page="bag">'];
    if (!inv.length) {
      parts.push('<div class="ga-empty">背包还是空的 —— 先去「抽取」扭一个</div></section>');
      return parts.join('');
    }
    /* 按品质分组：顺序照数据层的 QUALITY_META.order，不在这里另排一套。 */
    const groups = new Map();
    for (const it of inv) {
      const q = it.quality || '普通';
      if (!groups.has(q)) groups.set(q, []);
      groups.get(q).push(it);
    }
    const keys = Array.from(groups.keys()).sort((a, b) => qorder(a) - qorder(b));
    parts.push('<div class="ga-face">共 ' + num(inv.length) + ' 种 · 合计 '
      + num(inv.reduce((s, it) => s + (Number(it.count) || 0), 0)) + ' 件</div>');
    for (const q of keys) {
      const list = groups.get(q);
      const rows = list.map((it) => '<div class="ga-row"><span>'
        + '<span class="ga-tag" data-tone="' + esc(q) + '" data-color="' + esc(qcolor(q)) + '" style="background:'
        + esc(qcolor(q)) + '">' + esc(q) + '</span> ' + esc(it.name) + '</span>'
        + '<em class="ga-bag-count">×' + num(it.count) + '</em></div>');
      parts.push('<div class="ga-sec"><div class="ga-sec-title">' + esc(q) + ' · ' + num(list.length) + ' 种</div>'
        + rows.join('') + '</div>');
    }
    parts.push('</section>');
    return parts.join('');
  }

  _historyHTML() {
    const hist = Array.isArray(this.app.data.history) ? this.app.data.history : [];
    const parts = ['<section class="ga-body" data-page="history">'];
    if (!hist.length) {
      parts.push('<div class="ga-empty">还没有抽卡记录</div></section>');
      return parts.join('');
    }
    const rows = hist.slice(0, 20).map((h) => {
      const when = new Date(h.at);
      const stamp = Number.isFinite(when.getTime())
        ? (when.getMonth() + 1) + '/' + when.getDate() + ' '
          + String(when.getHours()).padStart(2, '0') + ':' + String(when.getMinutes()).padStart(2, '0')
        : DASH;
      const got = (Array.isArray(h.got) ? h.got : []).map((g) => '<b>' + esc(g.name) + '</b>').join('、');
      return '<div class="ga-hist">' + esc(stamp) + ' · 花费 ' + num(h.cost) + ' 🪙 · ' + (got || '没有记录到战果')
        + '</div>';
    });
    parts.push('<div class="ga-face">只留最近 30 次（数据层的口径），这里显示最近 ' + num(rows.length) + ' 次</div>');
    parts.push('<div class="ga-sec">' + rows.join('') + '</div>');
    parts.push('</section>');
    return parts.join('');
  }

  /* ---------- 5. 总装 ---------- */

  _html() {
    const page = this.tab === 'bag' ? this._bagHTML()
      : (this.tab === 'history' ? this._historyHTML() : this._gachaHTML());
    let balance = DASH;
    try { balance = num(this.app.data.getBalance()); } catch (_e) { balance = DASH; }
    const tabs = ['<nav class="ga-tabbar">']
      .concat(TABS.map((t) => '<button class="ga-tab' + (this.tab === t.key ? ' is-on' : '')
        + '" data-act="tab" data-tab="' + t.key + '">' + t.label + '</button>'))
      .concat(['</nav>'])
      .join('');
    return STYLE
      + '<div class="ga-root">'
      + '<div class="ga-head"><div class="ga-title">🎰 幸运转盘</div>'
      + '<span class="ga-coins">🪙 ' + balance + '</span></div>'
      + page + tabs + '</div>';
  }
}

export default GachaView;