/* ============================================================
 * tests/browser/scenarios/o8-tieba-bottomnav.scen.js
 *   O8 场景⑤：贴吧「照现实」改造验收（底栏一级导航 / 消息未实现格给真话 / 进吧与我的真能走）
 * ------------------------------------------------------------
 * 判据来源（写在这里，不靠记忆）：
 *   ① 贴吧 App 有**底部导航条** —— 站内提问帖「底部导航条怎么关?」即为此而问；
 *   ② 「我的」在**最右下角** —— 站内教程原文「点击右下角【我的】图标，进入个人主页」。
 *   两条都是贴吧站内可检索到的原话。**取不到官方图的中间两格配色与图标细节
 *   不当作判据**，只验结构与可点性。
 *
 * 本仓的有意偏离（结构照官方、能力照本仓）：
 *   · 四格封顶，不凑五格：本仓没有「发现 / 商店 / 直播」任何落点，凑出来的第五格
 *     必然是一颗点了不动的假键；
 *   · 「消息」**画出来但禁用**（opacity .38 + aria-disabled），点击给页面内提示条。
 *     藏起来会被读成「这个 App 没有消息」，静默会被读成「按钮坏了」，两种都不对；
 *   · 「进吧」「我的」是本轮新增的一级面，必须真能进、真能显示真数据。
 *
 * 量的五件事（真盒模型 + 真点击）：
 *   ① 底栏**贴底**（delta ≤1px）与**拇指可点高度**（offsetHeight ≥44）；
 *   ② 四格文案与格数；「消息」看得出不能点；点了有真话提示而不是静默；
 *   ③ 「进吧」真能进：列表项数 == 数据层吧数，点一行真把 barId 切过去并回首页；
 *   ④ 「我的」真能进：计数与数据层一致（author==='我' / isLiked）；
 *   ⑤ 切过之后底栏仍贴底、且复用同一外壳（整页重绘最容易把底栏丢掉的一步）。
 *
 * 单独跑：
 *   node tests/browser/run-scenario.mjs tests/browser/scenarios/o8-tieba-bottomnav.scen.js
 * ============================================================ */
import { installBrowserHost, waitFor } from '/tests/browser/host-stub.mjs';
installBrowserHost({ chat: [{ mes: 'a', is_user: false, swipes: ['x'], swipe_id: 0 }] });
try { await import('/index.js'); } catch (e) { report({ name: 'entry-import', ok: false, detail: String(e && e.message) }); }
await waitFor(() => !!(window.VirtualPhone && window.VirtualPhone.version), { timeoutMs: 30000 });
await waitFor(() => document.getElementById('phone-panel'), { timeoutMs: 20000 });
const trig = document.getElementById('phoneDrawerToolEntry') || document.getElementById('phoneDrawerIcon');
if (trig) trig.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
await waitFor(() => document.querySelector('.home-screen'), { timeoutMs: 20000 });
window.dispatchEvent(new CustomEvent('phone:openApp', { detail: { appId: 'tieba' } }));
const appUp = await waitFor(() => document.querySelector('.tb-app'), { timeoutMs: 20000 });
report({ name: 'tieba-open', ok: !!appUp, detail: appUp ? '.tb-app 到场' : '未开屏' });

const APP = () => window.VirtualPhone && window.VirtualPhone.tiebaApp;
/* 视图槽位是 .view（tieba-app.js 构造里写死），读错路径会把「已成功」验成假红。 */
const VIEW = () => {
  const a = APP();
  return a ? (a.view || a._view || null) : null;
};
const rectOf = (el) => {
  const r = el.getBoundingClientRect();
  return { t: Math.round(r.top), b: Math.round(r.bottom), h: Math.round(r.height), w: Math.round(r.width) };
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------- ① 底栏存在 + 贴底 + 可点高度 ---------- */
const nav = document.querySelector('.tb-tabbar');
report({ name: 'nav-exists', ok: !!nav, detail: nav ? '.tb-tabbar 存在' : '.tb-tabbar 缺失' });
if (nav) {
  const appBox = document.querySelector('.tb-app');
  const nb = rectOf(nav);
  const ab = rectOf(appBox);
  const delta = Math.abs(nb.b - ab.b);
  report({
    name: 'nav-pinned-to-bottom',
    ok: delta <= 1,
    detail: 'navBottom=' + nb.b + ' appBottom=' + ab.b + ' delta=' + delta
  });
  /* 用布局 offsetHeight 而不是 getBoundingClientRect：外壳对整屏做过约 0.9 的
   * scale，rect 会缩水，用 rect 判 44 会误红（LOFTER 那轮读数 nav 高 41 即此故）。 */
  const item = nav.querySelector('.tb-tabitem');
  const ih = item ? item.offsetHeight : 0;
  report({
    name: 'nav-touch-height',
    ok: ih >= 44,
    detail: 'offsetH=' + ih + ' rectH=' + (item ? rectOf(item).h : 0)
  });
  /* 底栏不许盖住内容：滚动区底边必须落在底栏顶边之上（±2px 容差）。 */
  const scroll = document.querySelector('.tb-scroll');
  if (scroll) {
    const sb = rectOf(scroll);
    report({
      name: 'content-above-nav',
      ok: sb.b <= nb.t + 2,
      detail: 'scrollBottom=' + sb.b + ' navTop=' + nb.t
    });
  }
}

/* ---------- ② 四格文案 + disabled 表现 ---------- */
const items = nav ? Array.from(nav.querySelectorAll('.tb-tabitem')) : [];
const labels = items.map((i) => (i.querySelector('.tb-tabtext') || {}).textContent || '');
report({
  name: 'nav-four-slots',
  ok: items.length === 4,
  detail: 'count=' + items.length + ' labels=' + labels.join('/')
});
report({
  name: 'nav-labels-order',
  ok: labels.join('/') === '首页/进吧/消息/我的',
  detail: labels.join('/')
});
const msgItem = items[3 - 1] || null;
const msgOff = msgItem ? msgItem.classList.contains('is-off') : false;
const msgOpacity = msgItem ? Number(getComputedStyle(msgItem).opacity) : -1;
report({
  name: 'message-disabled-look',
  ok: msgOff && msgItem.getAttribute('aria-disabled') === 'true' && msgOpacity < 0.45,
  detail: 'is-off=' + msgOff + ' aria-disabled=' + (msgItem ? msgItem.getAttribute('aria-disabled') : 'n/a') + ' opacity=' + msgOpacity
});

/* 点「消息」：必须给页面内提示条（真话），不许静默、不许跳空页。 */
if (msgItem) {
  const pageBefore = (VIEW() || {}).page;
  msgItem.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  await sleep(120);
  const toast = document.querySelector('.tb-toast');
  const pageAfter = (VIEW() || {}).page;
  report({
    name: 'message-says-not-implemented',
    ok: !!toast && String(toast.textContent || '').indexOf('还没做') >= 0 && pageAfter === pageBefore,
    detail: 'toast=' + (toast ? String(toast.textContent) : 'none') + ' page ' + pageBefore + '->' + pageAfter
  });
  const stray = document.querySelectorAll('.tb-toast');
  stray.forEach((n) => n.remove());
}

/* ---------- ③ 「进吧」真能进 ---------- */
const barsItem = items[1] || null;
if (barsItem) {
  barsItem.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  await sleep(120);
  const rows = Array.from(document.querySelectorAll('.tb-barrow'));
  const dataBars = (APP() && APP().data) ? APP().data.getBars().length : -1;
  report({
    name: 'bars-page-real-list',
    ok: rows.length > 0 && rows.length === dataBars,
    detail: 'rows=' + rows.length + ' dataBars=' + dataBars
  });
  report({
    name: 'bars-page-title',
    ok: ((document.querySelector('.tb-title') || {}).textContent || '') === '进吧',
    detail: 'title=' + ((document.querySelector('.tb-title') || {}).textContent || '')
  });
  /* 点第一行：必须真把 barId 切过去，并回到首页（等价于「进到那个吧」）。 */
  if (rows.length) {
    const wantBar = rows[0].getAttribute('data-bar');
    rows[0].dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await sleep(120);
    const v = VIEW() || {};
    const page = v.page;
    const barId = v.barId;
    report({
      name: 'enter-bar-switches-and-returns',
      ok: barId === wantBar && page === 'home',
      detail: 'want=' + wantBar + ' got=' + barId + ' page=' + page
    });
    /* 首页的 chip 必须已经跟着切过去，证明这不是只改了内部状态。 */
    const onChip = document.querySelector('.tb-chip.is-on');
    const onBar = onChip ? onChip.getAttribute('data-bar') : '';
    report({
      name: 'home-chip-follows',
      ok: onBar === wantBar,
      detail: 'onChipBar=' + onBar
    });
  } else {
    report({ name: 'enter-bar-switches-and-returns', ok: false, detail: '没有可点的吧行' });
  }
}

/* ---------- ④ 「我的」真能进，计数与数据层一致 ----------
 * ★ 先造一条**自己的**帖子再验：默认夹具里 author==='我' 是 0 条，
 *   若直接验「我的帖子 (0) == 0」是 0 对 0 的空验证 —— 数据层把「我」的过滤
 *   写挂了也会绿。所以这里先发一帖，让 dataMine 从 0 变 1，再比对页面读数。 */
const SEED_TITLE = '底栏验收自习室占座帖';
{
  const v = VIEW();
  if (v && APP() && APP().data) {
    const bars = APP().data.getBars();
    const targetBar = bars.length ? bars[0].id : 'all';
    APP().data.createPost(targetBar, SEED_TITLE, '这条帖子是验收造出来的，用来验「我的」页真的会数到它。', '我');
    report({ name: 'seed-my-post', ok: true, detail: '在 ' + targetBar + ' 造了一条 author=我 的帖' });
  }
}
const meItem = (document.querySelectorAll('.tb-tabitem') || [])[3] || null;
if (meItem) {
  meItem.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  await sleep(120);
  const data = APP() && APP().data;
  const all = data ? data.getPostsByBar('all') : [];
  const mine = all.filter((p) => String(p.author) === '我').length;
  const liked = all.filter((p) => p.isLiked && String(p.author) !== '我').length;
  const secs = Array.from(document.querySelectorAll('.tb-me-sec')).map((n) => String(n.textContent || ''));
  const okMine = secs.some((t) => t === '我的帖子 (' + mine + ')');
  const okLiked = secs.some((t) => t === '我赞过的 (' + liked + ')');
  report({
    name: 'me-page-counts-match-data',
    ok: okMine && okLiked,
    detail: 'sections=' + secs.join(' | ') + ' dataMine=' + mine + ' dataLiked=' + liked
  });
  /* 种子帖必须真出现在「我的帖子」列表里（只数对计数还不够：
   * 计数与列表可以各错各的，这里要求标题真的画出来）。 */
  const meHtmlNow = (document.querySelector('.tb-scroll') || {}).innerHTML || '';
  report({
    name: 'me-page-shows-my-post',
    ok: mine >= 1 && meHtmlNow.indexOf(SEED_TITLE) >= 0,
    detail: 'dataMine=' + mine + ' 列表里含种子帖=' + (meHtmlNow.indexOf(SEED_TITLE) >= 0)
  });
  report({
    name: 'me-page-no-fake-account',
    ok: String((document.querySelector('.tb-me-note') || {}).textContent || '').indexOf('没有账号体系') >= 0,
    detail: 'note=' + String((document.querySelector('.tb-me-note') || {}).textContent || '').slice(0, 40)
  });
  /* 「我的」里不许出现假控件：不能有签到 / 等级 / 金币这类点不动的入口。 */
  const meShell = document.querySelector('.tb-scroll');
  const meHtml = meShell ? meShell.innerHTML : '';
  const fake = ['签到', '经验', '等级', '金币', '会员'].filter((w) => meHtml.indexOf(w) >= 0);
  report({
    name: 'me-page-no-fake-widgets',
    ok: fake.length === 0,
    detail: fake.length ? '出现假控件词：' + fake.join(',') : '无假控件'
  });
}

/* ---------- ⑤ 切完以后底栏仍贴底 + 复用同一外壳 ---------- */
const nav2 = document.querySelector('.tb-tabbar');
const appBox2 = document.querySelector('.tb-app');
if (nav2 && appBox2) {
  const nb2 = rectOf(nav2);
  const ab2 = rectOf(appBox2);
  report({
    name: 'nav-still-pinned-after-switch',
    ok: Math.abs(nb2.b - ab2.b) <= 1,
    detail: 'navBottom=' + nb2.b + ' appBottom=' + ab2.b + ' delta=' + Math.abs(nb2.b - ab2.b)
  });
  report({
    name: 'same-shell-reused',
    ok: document.querySelectorAll('.tb-app').length === 1 && document.querySelectorAll('.tb-tabbar').length === 1,
    detail: 'app=' + document.querySelectorAll('.tb-app').length + ' nav=' + document.querySelectorAll('.tb-tabbar').length
  });
}
/* 回到首页收尾，让「反复切面」这条也留一条读数。 */
const homeItem = (document.querySelectorAll('.tb-tabitem') || [])[0] || null;
if (homeItem) {
  homeItem.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  await sleep(120);
  const v = VIEW() || {};
  const nav3 = document.querySelector('.tb-tabbar');
  const appBox3 = document.querySelector('.tb-app');
  report({
    name: 'back-to-home-keeps-nav',
    ok: v.page === 'home' && !!nav3 && !!appBox3 && Math.abs(rectOf(nav3).b - rectOf(appBox3).b) <= 1,
    detail: 'page=' + v.page + ' delta=' + (nav3 && appBox3 ? Math.abs(rectOf(nav3).b - rectOf(appBox3).b) : 'n/a')
  });
}
report({ name: 'scenario-done', ok: true, detail: '贴吧底栏验收完成' });