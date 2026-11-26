/* ============================================================
 * tests/apps-xhs-v4.test.mjs
 *   小红书「照官方那种」（v4.210.0：底栏照官方五格 首页/视频/＋/消息/我）的**静态门**。
 *   真盒模型与真点击的证据在浏览器场景 o8-xhs-bottomnav.scen.js（读数 ×3 档），
 *   本套只守「一改就悄悄退回去」的那几处结构，不重复验像素。
 *
 * 判据来源（写在文件里，不靠记忆）：2024-10-12 钛媒体《购物改视频，小红书视频3.0提速》——
 *   「近期的版本更新之后，更多用户会发现自己的小红书APP的第二Tab由「购物」替换为「视频」」。
 *   由此官方底栏五格依次为 首页 / 视频 / ＋ / 消息 / 我，中央「＋」是凸起的圆形发布键。
 *   本仓「视频」没有实现 ⇒ 照位置画出来但禁用，点一下在页面内给真话。
 *
 * 为什么 A8 要双向对账：只查「禁用格是不是画了」会漏掉「多画一格官方没有的假格」；
 *   只查「真面是不是都在」会漏掉「少画一格官方有的」。两边都要对，才叫「照官方那种」。
 * ============================================================ */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { XhsView } from '../apps/xhs/xhs-view.js';
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = dirname(HERE);
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
/* 官方五格里的**格**（中央「＋」是发布键，不是格，单列一条判据）。 */
const OFFICIAL = ['首页', '视频', '消息', '我'];
const mkView = () => {
  const v = new XhsView({ data: { getNotes: () => [] } });
  v.tab = 'feed';
  return v;
};
test('v4.210.0 A1 底栏是 <nav>，且带 role=navigation 与中文无障碍名', () => {
  const html = mkView()._tabbarHtml();
  assert.ok(html.startsWith('<nav class="xhs-tabbar"'), '底栏必须是 .xhs-tabbar 的 <nav>');
  assert.ok(html.includes('role="navigation"'), '缺 role=navigation 就读不成一级导航');
  assert.ok(html.includes('aria-label="主导航"'), '缺中文无障碍名');
});
test('v4.210.0 A2 真格（能切的）必须与 _tabs() 一一对应，且都用 data-tab', () => {
  const v = mkView();
  const html = v._tabbarHtml();
  const tabs = v._tabs();
  assert.ok(tabs.length >= 2, '_tabs() 至少要有两个真面');
  for (const t of tabs) {
    assert.ok(html.includes('data-tab="' + t.key + '"'), '缺真格：' + t.key);
  }
  const dataTabs = html.match(/data-tab="/g) || [];
  assert.equal(dataTabs.length, tabs.length, 'data-tab 数应等于真面数，实得 ' + dataTabs.length);
});
test('v4.210.0 A3 当前面高亮走 aria-current=page（不是只靠颜色）', () => {
  const v = mkView();
  v.tab = 'me';
  const html = v._tabbarHtml();
  const meCell = /<button[^>]*data-tab="me"[^>]*>/.exec(html);
  assert.ok(meCell, '找不到「我」格');
  assert.ok(meCell[0].includes('aria-current="page"'), '当前面必须带 aria-current=page');
  const feedCell = /<button[^>]*data-tab="feed"[^>]*>/.exec(html);
  assert.ok(feedCell && feedCell[0].includes('aria-current="false"'), '非当前面必须是 false');
});
test('v4.210.0 A4 底栏排在内容层之后（DOM 顺序＝视觉顺序），且一个模板管三面', () => {
  const src = read('apps/xhs/xhs-view.js');
  const iBody = src.indexOf('${body}');
  const iNav = src.indexOf('${this._tabbarHtml()}');
  assert.ok(iBody > 0, '找不到内容层压入点');
  assert.ok(iNav > iBody, '底栏必须在内容层之后压入，否则滚动区会把它顶走');
  /* 一个 `_shell()` 同时服务首页 / 消息 / 我 ⇒ 不存在「某个面忘了压底栏」的分支。 */
  const shellCalls = src.match(/\$\{this\._tabbarHtml\(\)\}/g) || [];
  assert.equal(shellCalls.length, 1, '底栏模板只该压入一次（一个 _shell 管三个面），实得 ' + shellCalls.length);
  assert.ok(src.includes('${this._soonNoteHTML()}'), '首页页脚必须有如实说明（藏起来会被读成「没有视频」）');
});
test('v4.210.0 A5 未实现的「视频」格**画出来但禁用**：is-disabled + aria-disabled + data-act（不静默）', () => {
  const html = mkView()._tabbarHtml();
  const cell = /<button[^>]*data-what="视频"[^>]*>/.exec(html);
  assert.ok(cell, '缺格（照官方要画出来）：视频');
  const tag = cell[0];
  assert.ok(tag.includes('is-disabled'), '视频格必须带 is-disabled（看得出不能点）');
  assert.ok(tag.includes('aria-disabled="true"'), '视频格必须带 aria-disabled=true');
  assert.ok(tag.includes('data-act="xhs-soon"'), '视频格必须带 data-act（点了要有真话，不许静默）');
  assert.ok(!tag.includes('data-tab='), '视频格不许带 data-tab（它不是能切的面）');
  const src = read('apps/xhs/xhs-view.js');
  assert.ok(src.includes("'[data-act=\"xhs-soon\"]'"), '委托里没有处理 xhs-soon ⇒ 点了不会有任何反应');
  assert.ok(src.includes('本机还没做'), '提示条文案必须直说「本机还没做」');
});
test('v4.210.0 A6 皮肤表：由入口 @import 投递，底栏不用 position:fixed，禁用格有置灰', () => {
  const entry = read('phone/design/rp-entry.css');
  assert.ok(entry.includes('apps/xhs/xhs.v4.css'), 'xhs.v4.css 未被 rp-entry.css 投递（等于样式不上屏）');
  const css = read('apps/xhs/xhs.v4.css').replace(/\/\*[\s\S]*?\*\//g, '');
  const navBlock = /\.xhs-app \.xhs-tabbar \{[\s\S]*?\}/.exec(css);
  assert.ok(navBlock, '找不到 .xhs-app .xhs-tabbar 规则');
  assert.ok(/flex:\s*0 0 auto/.test(navBlock[0]), '底栏必须 flex:0 0 auto 贴底');
  assert.ok(!/position:\s*fixed/.test(navBlock[0]), '底栏不许用 position:fixed（会脱离外壳高度约束）');
  const disBlock = /\.xhs-app \.xhs-tabbar-cell\.is-disabled \{[\s\S]*?\}/.exec(css);
  assert.ok(disBlock && /opacity:\s*0\.38/.test(disBlock[0]), '禁用格必须置灰（opacity .38）');
});
test('v4.210.0 A7 滚动层必须 min-height:0（缺它 flex 子项不收缩，底栏被顶出可视区）', () => {
  const css = read('apps/xhs/xhs.v4.css');
  const scrollBlock = /\.xhs-app \.xhs-body \{[\s\S]*?\}/.exec(css);
  assert.ok(scrollBlock, '找不到 .xhs-app .xhs-body 规则');
  assert.ok(/min-height:\s*0/.test(scrollBlock[0]), '滚动层缺 min-height:0');
  assert.ok(/overflow-y:\s*auto/.test(scrollBlock[0]), '滚动层必须是唯一滚动区');
});
test('v4.210.0 A8 格面双向对账：官方四格一个不少、不多画假格、顺序不乱、＋是真动作', () => {
  const v = mkView();
  const cells = v._navCells();
  const labels = cells.map((c) => c.label);
  for (const w of OFFICIAL) assert.ok(labels.includes(w), '底栏缺官方格：' + w);
  const extra = labels.filter((w) => !OFFICIAL.includes(w));
  /* 官方五格里唯一不在 OFFICIAL 的是中央发布键：它必须是真动作（act），不是格。 */
  assert.deepEqual(extra, ['发布'], '多出来的格只许是中央「＋」发布键，实得 ' + extra.join('/'));
  const pub = cells.find((c) => c.label === '发布');
  assert.equal(pub.act, 'xhs-compose', '中央「＋」必须是真动作 xhs-compose（不是假键、也不是禁用格）');
  assert.ok(!pub.disabled, '中央「＋」不许被标成禁用（本仓发布链路是真的）');
  const officialOrder = labels.filter((w) => OFFICIAL.includes(w));
  assert.deepEqual(officialOrder, OFFICIAL, '官方四格的相对顺序被打乱：' + officialOrder.join('/'));
  /* 中央「＋」必须落在四格正中（官方位置）：下标 2。 */
  assert.equal(labels.indexOf('发布'), 2, '中央「＋」必须排在官方五格正中，实得下标 ' + labels.indexOf('发布'));
});
test('v4.210.0 A9 提示条不许用宿主 alert（会卡住 SillyTavern 消息流）', () => {
  const src = read('apps/xhs/xhs-view.js').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(!/\balert\s*\(/.test(src), 'xhs-view.js 里出现了 alert(');
  assert.ok(src.includes('_toast('), '缺页面内提示条实现');
  assert.ok(src.includes('_clearToast()'), '缺提示条回收（重绘会留一颗看不见的定时器）');
});
/* ---------- 分层位次：v4.209.0 测到的两个坑，各用一条判据钉住 ----------
 * 坑① 按钮规则若留在「无层」，会被 rp-entry.css 的
 *      `:is(...)[data-rp-ds="2"] :is(button, ...) { all: revert-layer; }` 回滚成 UA 默认
 *      （实测症状：禁用格 opacity=1、padding=0、color:#000）⇒ 按钮规则进 @layer rp.apps。
 * 坑② 容器规则若进了 @layer，会输给 xhs.v3.css 的 rp.skins 层（层序先于特异性）
 *      ⇒ 容器规则留无层；v3 下的按钮修正放进 rp.skins 同层抢特异性。
 * 两条互为反向，缺一条就会「修好一个弄坏另一个」，必须成对守。 */
function segOfLayer(css, layer) {
  const i = css.indexOf('@layer ' + layer + ' {');
  if (i < 0) return '';
  let depth = 0;
  const start = css.indexOf('{', i);
  for (let k = start; k < css.length; k++) {
    if (css[k] === '{') depth++;
    else if (css[k] === '}') {
      depth--;
      if (depth === 0) return css.slice(i, k + 1);
    }
  }
  return '';
}
test('v4.210.0 A10 分层位次：按钮进 rp.apps、容器留无层、v3 按钮修正进 rp.skins', () => {
  const css = read('apps/xhs/xhs.v4.css').replace(/\/\*[\s\S]*?\*\//g, '');
  const entry = read('phone/design/rp-entry.css');
  assert.ok(/all:\s*revert-layer/.test(entry), '前提变了：rp-entry.css 里已无 all: revert-layer，A10 的坑①需重估');
  const apps = segOfLayer(css, 'rp.apps');
  assert.ok(apps, 'xhs.v4.css 缺 @layer rp.apps 块');
  assert.ok(apps.includes('.xhs-app .xhs-tabbar-cell {'), '按钮规则不在 rp.apps 层内 ⇒ 会被 all: revert-layer 打回 UA 默认（置灰/内边距/字色全失效）');
  assert.ok(apps.includes('.xhs-app .xhs-tabbar-cell.is-disabled {'), '禁用格规则不在 rp.apps 层内 ⇒ opacity .38 会被打回 1');
  assert.ok(apps.includes('.xhs-app .xhs-tabbar-pub {'), '中央「＋」规则不在 rp.apps 层内 ⇒ 圆形红键会被打回 UA 默认按钮');
  const skins = segOfLayer(css, 'rp.skins');
  assert.ok(skins, 'xhs.v4.css 缺 @layer rp.skins 块（v3 皮肤下的按钮修正无处可放）');
  assert.ok(skins.includes('#phone-panel[data-rp-ios="3"] .xhs-root.xhs-app .xhs-tabbar-cell'), 'v3 下的按钮修正不在 rp.skins 层内 ⇒ 层序上永远输给 xhs.v3.css');
  /* 容器规则必须落在第一个 @layer 之前（= 无层）。 */
  const firstLayer = css.indexOf('@layer ');
  const rootIdx = css.indexOf('.xhs-root.xhs-app {');
  assert.ok(rootIdx >= 0, '找不到 .xhs-root.xhs-app 规则');
  assert.ok(rootIdx < firstLayer, '容器规则被放进了 @layer ⇒ 会输给 v3 皮肤的 rp.skins 层（底栏会被 padding-bottom 顶离外壳底）');
  const bodyIdx = css.indexOf('.xhs-app .xhs-body {');
  assert.ok(bodyIdx >= 0 && bodyIdx < firstLayer, '滚动层规则被放进了 @layer（同上，会被皮肤覆盖）');
  const navIdx = css.indexOf('.xhs-app .xhs-tabbar {');
  assert.ok(navIdx >= 0 && navIdx < firstLayer, '底栏规则被放进了 @layer（同上）');
});
/* ---------- A11 底栏热区数值只能有一个来源 ----------
 * 本版自己抓到的缺陷（浏览器场景首跑当场红，nav-thumb-height 量出 31）：
 *   v3 皮肤里的按钮修正写了 `min-block-size: var(--rp33-tab-h, 44px)`，
 *   而 --rp33-tab-h 在 phone-tokens-v3.3.css:62 是 **32px** —— 那是胶囊页签的口径，不是底栏热区。
 *   层序上 rp.skins 赢 rp.apps，所以 apps 层写的 44 根本轮不到生效，格高掉到 33。
 *   修法是把数值提成一个 token（--xhs-tabbar-h: 48px，无层声明），两处都从它取。
 * 判据三条：① token 只定义一次；② apps 与 skins 两处都从 token 取；
 *          ③ skins 段里不许再出现 --rp33-tab-h（那个口径低于热区下限，写进去就是复发）。 */
test('v4.210.0 A11 底栏热区数值单一来源：token 一处定义、两处引用、皮肤段不许借 --rp33-tab-h', () => {
  const css = read('apps/xhs/xhs.v4.css').replace(/\/\*[\s\S]*?\*\//g, '');
  const defs = css.match(/--xhs-tabbar-h\s*:/g) || [];
  assert.equal(defs.length, 1, 'token --xhs-tabbar-h 必须只定义一次（实得 ' + defs.length + ' 处）');
  const def = /--xhs-tabbar-h\s*:\s*(\d+)px/.exec(css);
  assert.ok(def, '找不到 --xhs-tabbar-h 的定义');
  assert.ok(Number(def[1]) >= 48, 'token 不得低于 48：外壳 scale≈0.9，44 会被量成 ≈40，低于 HIG 的 44 热区下限（实得 ' + def[1] + 'px）');
  const apps = segOfLayer(css, 'rp.apps');
  const skins = segOfLayer(css, 'rp.skins');
  assert.ok(/min-block-size:\s*var\(--xhs-tabbar-h/.test(apps), 'rp.apps 里的格高没从 token 取（硬编码会在缩放后掉到热区线下）');
  assert.ok(/min-block-size:\s*var\(--xhs-tabbar-h/.test(skins), 'rp.skins 里的格高没从 token 取');
  assert.ok(!/--rp33-tab-h/.test(skins), 'rp.skins 段里又出现了 --rp33-tab-h（32px 的胶囊页签口径）：层序上它会压过 rp.apps，底栏会掉回 32');
  /* 底栏本身也要有热区下限（只写在格上时，宿主压按钮高度会把栏压成一条细线）。 */
  const navBlock = /\.xhs-app \.xhs-tabbar \{[\s\S]*?\}/.exec(css);
  assert.ok(navBlock, '找不到 .xhs-app .xhs-tabbar 规则');
  assert.ok(/min-block-size:\s*var\(--xhs-tabbar-h/.test(navBlock[0]), '底栏本身缺 min-block-size（热区下限只写在格上不写在栏上）');
});