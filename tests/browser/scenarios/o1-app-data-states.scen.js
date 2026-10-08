/* ============================================================
 * tests/browser/scenarios/o1-app-data-states.scen.js — R-O1 第 3 条：**空态与有数据两组**
 * ------------------------------------------------------------
 * R-O1 工作第 3 条原文：「App 首屏按**空态**与**有数据**两组各跑一遍，入口按
 *   `config/apps.js` 的 82 条 id 枚举。」
 * 同场景①（o1-app-enumeration）只跑了**空态**那一组。本场景补另一组。
 *
 * 本场景回答的问题（与空态组**不同**的一组问题）：
 *   一个 App 在「里面有数据」时，首屏是否仍然：① 有真盒；② 不被遮挡；
 *   ③ 有可见文本；④ 不把外壳撑破。
 *   空态能过、有数据态不能过，是本仓最典型的一类缺陷形态 ——
 *   静态检查与空态渲染都看不出，只有真排版引擎 + 真数据才现形：
 *     · 列表项宽度算错 ⇒ 长文本把容器撑出屏幕（有数据才有长文本）；
 *     · 空态分支画的是占位图、有数据分支画的是真内容，两者样式不同源；
 *     · 渲染路径对空数组有 early-return，对非空数组才走到会抛的那一段。
 *
 * 数据注入的**诚实边界**（必须写清，否则这份读数就是伪造的）：
 *   本场景注入的是**存储层**（PhoneStorage 的会话键），不是「用户的真实历史」。
 *   它能证明的是「渲染路径在拿到非空数据时不炸、不出零盒、不撑破外壳」；
 *   **不能**证明「真实用户的长文本排版好看」—— 那需要真素材，归 R-O3。
 *   故读数里逐条带 `fixture=data-injected` 标记，与真宿主读数分报。
 * ============================================================ */
import { installBrowserHost, waitFor } from '/tests/browser/host-stub.mjs';

/* ---------- 数据夹具：按模块分组，每组都是**该 App 真会读到的那几个键** ----------
 * 键名取自产品源码（`apps/**` 里 `storage.get(...)` 的字面量），不是编的。
 * 值取「小但非空」：1~3 条记录 —— 本场景验的是**渲染路径**，不是容量。 */
const FIXTURE = {
  diary: {
    diary_entries: [
      { id: 'd1', date: '2026-10-01', title: '第一篇', content: '今天把手机壳换成了深色。', mood: 'quiet' },
      { id: 'd2', date: '2026-10-02', title: '第二篇', content: '把桌上的书按颜色重排了一遍。', mood: 'good' },
    ],
    diary_settings: { auto: false, limit: 20 },
  },
  music: {
    music_playlist: [
      { id: 'm1', title: '一段很长的曲名用来压测标题容器是否会撑破布局', artist: '佚名' },
      { id: 'm2', title: '短名', artist: '佚名' },
    ],
    music_playback_mode: 'order',
    music_auto_play: false,
  },
  clock: {
    clock_settings: { format24: true, showSeconds: false },
  },
  ledger: {
    ledger_settings: { currency: 'CNY', showCents: true },
  },
  gamehall: {
    games_poker_user_chips: 1200,
    games_poker_ai_prompt: '稳一点。',
  },
};
/* 逐组注入用的键清单（读数里要能看见"注了哪几个键"，否则「有数据组」无从复核） */
const injectedKeys = [];
function injectGroup(store, group) {
  let n = 0;
  for (const [k, v] of Object.entries(group)) {
    store[k] = v;
    injectedKeys.push(k);
    n += 1;
  }
  return n;
}

/* ---------- 宿主：先装桩，再把夹具塞进 chatMetadata 命名空间 ---------- */
const host = installBrowserHost({
  chat: Array.from({ length: 4 }, (_, i) => ({ mes: '楼层' + i, is_user: i % 2 === 0, swipes: ['x'], swipe_id: 0 })),
});
const NS = 'st_virtual_phone';
host.ctx.chatMetadata[NS] = host.ctx.chatMetadata[NS] || {};
let injectedTotal = 0;
for (const g of Object.values(FIXTURE)) injectedTotal += injectGroup(host.ctx.chatMetadata[NS], g);
report({
  name: 'fixture-injected',
  ok: injectedTotal === injectedKeys.length && injectedTotal > 0,
  detail: 'fixture=data-injected keys=' + injectedKeys.length + ' [' + injectedKeys.slice(0, 6).join(',') + '…]',
});

/* ---------- 起真入口（与其余场景同链路） ---------- */
try { await import('/index.js'); } catch (_e) { /* 由读数判定 */ }
const up = await waitFor(() => !!(window.VirtualPhone && window.VirtualPhone.version), { timeoutMs: 25000 });
report({ name: 'entry-version', ok: up, detail: up ? String(window.VirtualPhone.version) : '未挂上' });

const panelUp = await waitFor(() => document.getElementById('phone-panel'), { timeoutMs: 15000 });
if (panelUp) {
  const trig = document.getElementById('phoneDrawerToolEntry') || document.getElementById('phoneDrawerIcon');
  if (trig) trig.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
}
const homeUp = await waitFor(() => document.querySelector('.home-screen'), { timeoutMs: 15000 });
report({ name: 'shell-ready', ok: !!(panelUp && homeUp), detail: 'panel=' + !!panelUp + ' home=' + !!homeUp });
if (!homeUp) done();

/* 公告弹窗：不关掉它，后面每一次命中测试都会命中弹窗（其余场景均已登记此坑） */
function realClick(el) {
  if (!el) return false;
  el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  return true;
}
const modalShown = await waitFor(() => !!document.getElementById('st-phone-update-modal'), { timeoutMs: 6000 });
if (modalShown) {
  const m = document.getElementById('st-phone-update-modal');
  const btn = m && m.querySelector('.st-phone-update-btn-primary');
  if (btn) { try { btn.scrollIntoView({ block: 'center' }); } catch (_e) { /* 退回 DOM 直点 */ } }
  realClick(btn);
  await waitFor(() => !document.getElementById('st-phone-update-modal'), { timeoutMs: 5000 });
}

/* ---------- 真盒 / 真命中 / 可见文本三判据 ---------- */
function boxOf(el) {
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { w: Math.round(r.width), h: Math.round(r.height), t: Math.round(r.top), l: Math.round(r.left) };
}
/** 真命中：元素中心点上最顶层的那个是不是它（或其后代）。
 *   ● **不要求中心点**：有数据的列表常常是「容器高、首项在顶部」，
 *     中心点可能落在留白上。这里取「元素内若干采样点里**至少一个**命中本体」，
 *     比中心点更贴近真实可达性，且不会因为布局留白产生假红。 */
function reachable(el) {
  if (!el) return { ok: false, why: 'no-element' };
  const r = el.getBoundingClientRect();
  if (r.width <= 0 || r.height <= 0) return { ok: false, why: 'zero-box ' + Math.round(r.width) + 'x' + Math.round(r.height) };
  const pts = [
    [r.left + r.width / 2, r.top + r.height / 2],
    [r.left + Math.min(8, r.width / 4), r.top + Math.min(8, r.height / 4)],
    [r.left + r.width - Math.min(8, r.width / 4), r.top + r.height - Math.min(8, r.height / 4)],
  ];
  for (const [x, y] of pts) {
    if (x < 0 || y < 0 || x > window.innerWidth || y > window.innerHeight) continue;
    const hit = document.elementFromPoint(x, y);
    if (hit && (hit === el || el.contains(hit) || (hit.contains && hit.contains(el)))) return { ok: true, why: '采样点命中本体' };
  }
  const c = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  return { ok: false, why: '中心命中 ' + (c ? (c.className || c.id || c.tagName) : 'null') };
}
/** 可见文本：图层内真的有非空白文本节点（不是「innerHTML 非空」——
 *  空 div 也算非空，那会假绿）。 */
function visibleText(root) {
  if (!root) return 0;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(n) {
      if (!n.nodeValue || !n.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
      const p = n.parentElement;
      if (!p) return NodeFilter.FILTER_REJECT;
      const st = getComputedStyle(p);
      if (st.display === 'none' || st.visibility === 'hidden' || Number(st.opacity) === 0) return NodeFilter.FILTER_REJECT;
      if (p.getBoundingClientRect().height <= 0) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  let n = 0;
  while (walker.nextNode()) n += 1;
  return n;
}
function viewIdNow() {
  const cur = document.querySelector('.view-stack-container .phone-view-current');
  return cur ? String(cur.getAttribute('data-view-id') || '') : '';
}
function backToHome() {
  const back = document.getElementById('phone-back-button');
  if (back && getComputedStyle(back).display !== 'none') realClick(back);
}

/* ---------- 逐 App 开屏（只跑夹具覆盖到的那些 App，其余归空态组） ---------- */
const mod = await import('/config/apps.js');
const byId = new Map(mod.APPS.map((a) => [a.id, a]));
/** 夹具组 → 目标 App id（按产品源码的读取点归属；一组可能对应多入口）。 */
const TARGETS = [
  { id: 'diary', group: 'diary' },
  { id: 'music', group: 'music' },
  { id: 'clock', group: 'clock' },
  { id: 'ledger', group: 'ledger' },
  { id: 'games', group: 'gamehall' },
];
let opened = 0;
let failures = 0;
for (const t of TARGETS) {
  if (!byId.has(t.id)) {
    report({ name: 'data-open:' + t.id, ok: false, detail: 'config/apps.js 里没有这个 id（夹具与入口表脱节）' });
    failures += 1;
    continue;
  }
  backToHome();
  await window.__sleep(560); // 返回键有 500ms 重入屏蔽（场景① 同款处置）
  /* 走真实入口：桌面图标 → 点击。图标用 `data-app` 标 id（不是 data-app-id，
   *   也不是 aria-label 文案 —— 文案会被 i18n 与自定义名改掉）。
   *   ★ 图标可能落在**非当前页**：`.app-grid-pager` 是横向轨道，
   *   非当前页 `aria-hidden=true` 且盒在视口外 —— 那不是「找不到入口」，
   *   是分页的正确行为。故先在本页找，找不到就**真翻页**再找（禁 transition，
   *   与场景① 同一取证口径：--dump-dom 单帧下 transition 冻结在 t=0）。 */
  const findTile = () => {
    const all = [...document.querySelectorAll('.home-screen [data-app="' + t.id + '"]')];
    return all.find((el) => {
      const p = el.closest('.app-grid-page');
      return !p || p.getAttribute('aria-hidden') !== 'true';
    }) || null;
  };
  let tile = findTile();
  let flipped = 0;
  if (!tile) {
    const pager = document.querySelector('.home-screen .app-grid-pager');
    const dots = [...document.querySelectorAll('.home-page-dot')];
    if (pager) pager.style.transition = 'none';
    for (const dot of dots) {
      const idx = Number(dot.getAttribute('data-page-index'));
      if (!Number.isFinite(idx)) continue;
      dot.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      await window.__sleep(160);
      flipped += 1;
      tile = findTile();
      if (tile) break;
    }
  }
  if (!tile) {
    report({ name: 'data-open:' + t.id, ok: false, detail: '翻了 ' + flipped + ' 页仍找不到该图标（入口不在任何可达页）' });
    failures += 1;
    continue;
  }
  realClick(tile);
  const arrived = await waitFor(() => viewIdNow() && viewIdNow() !== 'home', { timeoutMs: 8000 });
  await window.__sleep(220);
  const vid = viewIdNow();
  const layer = vid ? document.querySelector('.view-stack-container [data-view-id="' + vid + '"]') : null;
  const box = boxOf(layer);
  const hit = reachable(layer);
  const texts = visibleText(layer);
  const shellIntact = !!document.querySelector('.phone-screen .view-stack-container')
    && document.querySelector('.phone-screen')?.classList.contains('screen-off') === false;
  const ok = !!arrived && !!box && box.w > 0 && box.h > 0 && hit.ok && texts > 0 && shellIntact;
  if (!ok) failures += 1;
  report({
    name: 'data-open:' + t.id,
    ok,
    detail: 'fixture=data-injected group=' + t.group
      + ' vid=' + (vid || '(none)')
      + ' box=' + (box ? box.w + 'x' + box.h : 'none')
      + ' hit=' + hit.why
      + ' textNodes=' + texts
      + ' shellIntact=' + shellIntact,
  });
  opened += 1;
}
report({
  name: 'data-group-summary',
  ok: opened === TARGETS.length && failures === 0,
  detail: 'fixture=data-injected opened=' + opened + '/' + TARGETS.length + ' failures=' + failures,
});

/* ---------- 外壳完整性（有数据态最容易把外壳撑破） ---------- */
backToHome();
await window.__sleep(560);
const shellViews = document.querySelectorAll('.phone-screen .view-stack-container').length;
const screenChildren = document.querySelector('.phone-screen')
  ? Array.from(document.querySelector('.phone-screen').children).map((c) => c.className || c.tagName).join('|')
  : 'none';
report({
  name: 'shell-intact-after-data-run',
  ok: shellViews === 1,
  detail: 'view-stack-container=' + shellViews + ' screen.children=[' + screenChildren.slice(0, 120) + ']',
});
report({ name: 'host-stub-ledger', ok: true, detail: 'blocked=' + host.log.fetchBlocked.length + ' saveChat=' + host.log.saveChatCalls });
done();