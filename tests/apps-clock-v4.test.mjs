/* ============================================================
 * tests/apps-clock-v4.test.mjs
 *   时计「照官方那种」（v4.209.0：底栏照官方四格 + 本仓自有「今天」）的**静态门**。
 *   真盒模型与真点击的证据在浏览器场景 o8-clock-bottomnav.scen.js（读数 ×3 档），
 *   本套只守「一改就悄悄退回去」的那几处结构，不重复验像素。
 *
 * 判据来源（Apple 官方支持两篇，写在文件里不靠记忆）：
 *   ①「在 iPhone 上使用计时器或秒表」：「轻点『秒表』」；
 *   ②「在 iPhone 上的『时钟』中查看世界时间」：「前往『时钟』App。轻点『世界时钟』」。
 *   ⇒ 一级入口在页面底部页签上；官方四格 = 世界时钟 / 闹钟 / 秒表 / 计时器。
 *
 * 为什么 A8 要双向对账：只查「禁用格是不是都画了」会把「多画一格官方没有的假格」漏掉；
 *   只查「真面是不是都在」会把「少画一格官方有的」漏掉。两边都要对，才叫「照官方那种」。
 * ============================================================ */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { ClockView } from '../apps/clock/clock-view.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = dirname(HERE);
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

/* 官方「时钟」的四格（判据见文件头）。顺序是官方的相对顺序。 */
const OFFICIAL = ['世界时钟', '闹钟', '秒表', '计时器'];

const mkView = () => {
  const v = new ClockView({ settings: {} }, null, null);
  v._tab = 'today';
  return v;
};

test('v4.209.0 A1 底栏是 <nav>，且带 role=navigation 与中文无障碍名', () => {
  const html = mkView()._tabbarHtml();
  assert.ok(html.startsWith('<nav class="cl-tabbar"'), '底栏必须是 .cl-tabbar 的 <nav>');
  assert.ok(html.includes('role="navigation"'), '缺 role=navigation 就读不成一级导航');
  assert.ok(html.includes('aria-label="主导航"'), '缺中文无障碍名');
});

test('v4.209.0 A2 真格（能切的）必须与 _tabs() 一一对应，且都用 data-tab', () => {
  const v = mkView();
  const html = v._tabbarHtml();
  const tabs = v._tabs();
  assert.ok(tabs.length >= 2, '_tabs() 至少要有今天与时计两个真面');
  for (const t of tabs) {
    assert.ok(html.includes('data-tab="' + t.key + '"'), '缺真格：' + t.key);
  }
  const dataTabs = html.match(/data-tab="/g) || [];
  assert.equal(dataTabs.length, tabs.length, 'data-tab 数应等于真面数，实得 ' + dataTabs.length);
});

test('v4.209.0 A3 当前面高亮走 aria-current=page（不是只靠颜色）', () => {
  const v = mkView();
  v._tab = 'clock';
  const html = v._tabbarHtml();
  const clockCell = /<button[^>]*data-tab="clock"[^>]*>/.exec(html);
  assert.ok(clockCell, '找不到 clock 格');
  assert.ok(clockCell[0].includes('aria-current="page"'), '当前面必须带 aria-current=page');
  const todayCell = /<button[^>]*data-tab="today"[^>]*>/.exec(html);
  assert.ok(todayCell && todayCell[0].includes('aria-current="false"'), '非当前面必须是 false');
});

test('v4.209.0 A4 视图里底栏排在内容层之后（DOM 顺序＝视觉顺序），两个面都要压底栏', () => {
  const src = read('apps/clock/clock-view.js');
  const iScroll = src.indexOf("parts.push('<div class=\"cl-scroll\">')");
  const iNav = src.indexOf('parts.push(this._tabbarHtml())');
  assert.ok(iScroll > 0, '找不到 .cl-scroll 压入点');
  assert.ok(iNav > iScroll, '底栏必须在内容层之后压入，否则滚动区会把它顶走');
  const navPushes = src.match(/parts\.push\(this\._tabbarHtml\(\)\)/g) || [];
  assert.equal(navPushes.length, 2, '「今天」与「时计」两个面都必须压底栏，实得 ' + navPushes.length);
});

test('v4.209.0 A5 未实现的三格**画出来但禁用**：is-disabled + aria-disabled + data-act（不静默）', () => {
  const html = mkView()._tabbarHtml();
  for (const w of ['闹钟', '秒表', '计时器']) {
    const cell = new RegExp('<button[^>]*data-what="' + w + '"[^>]*>').exec(html);
    assert.ok(cell, '缺格（照官方要画出来）：' + w);
    const tag = cell[0];
    assert.ok(tag.includes('is-disabled'), w + ' 必须带 is-disabled（看得出不能点）');
    assert.ok(tag.includes('aria-disabled="true"'), w + ' 必须带 aria-disabled=true');
    assert.ok(tag.includes('data-act="cl-soon"'), w + ' 必须带 data-act（点了要有真话，不许静默）');
    assert.ok(!tag.includes('data-tab='), w + ' 不许带 data-tab（它不是能切的面）');
  }
  const src = read('apps/clock/clock-view.js');
  assert.ok(src.includes("=== 'cl-soon'"), '委托里没有处理 cl-soon ⇒ 点了不会有任何反应');
  assert.ok(src.includes('本机还没做'), '提示条文案必须直说「本机还没做」');
});

test('v4.209.0 A6 皮肤表：由入口 @import 投递，底栏不用 position:fixed，禁用格有置灰', () => {
  const entry = read('phone/design/rp-entry.css');
  assert.ok(entry.includes('apps/clock/clock.v4.css'), 'clock.v4.css 未被 rp-entry.css 投递（等于样式不上屏）');
  const css = read('apps/clock/clock.v4.css');
  const navBlock = /\.cl-app \.cl-tabbar \{[\s\S]*?\}/.exec(css);
  assert.ok(navBlock, '找不到 .cl-app .cl-tabbar 规则');
  assert.ok(navBlock[0].includes('flex-shrink: 0'), '底栏必须 flex-shrink:0 贴底');
  assert.ok(!/position:\s*fixed/.test(navBlock[0]), '底栏不许用 position:fixed（会脱离外壳高度约束）');
  const disBlock = /\.cl-app \.cl-tabbar-item\.is-disabled \{[\s\S]*?\}/.exec(css);
  assert.ok(disBlock && /opacity:\s*\.38/.test(disBlock[0]), '禁用格必须置灰（opacity .38）');
});

test('v4.209.0 A7 滚动层必须 min-height:0（缺它 flex 子项不收缩，底栏被顶出可视区）', () => {
  const css = read('apps/clock/clock.v4.css');
  const scrollBlock = /\.cl-app \.cl-scroll \{[\s\S]*?\}/.exec(css);
  assert.ok(scrollBlock, '找不到 .cl-app .cl-scroll 规则');
  assert.ok(/min-height:\s*0/.test(scrollBlock[0]), '滚动层缺 min-height:0');
  assert.ok(/overflow-y:\s*auto/.test(scrollBlock[0]), '滚动层必须是唯一滚动区');
});

test('v4.209.0 A8 格面双向对账：官方四格一个不少、多出来的只能是本仓自有面', () => {
  const v = mkView();
  const cells = v._navCells();
  const labels = cells.map((c) => c.label);
  const realLabels = v._tabs().map((t) => t.label);
  for (const w of OFFICIAL) assert.ok(labels.includes(w), '底栏缺官方格：' + w);
  const extra = labels.filter((w) => !OFFICIAL.includes(w));
  for (const w of extra) {
    assert.ok(realLabels.includes(w), '多出来的格「' + w + '」背后没有真面 ⇒ 假键');
    const cell = cells.find((c) => c.label === w);
    assert.ok(cell && !cell.disabled, '多出来的格「' + w + '」不是真面却也切不了 ⇒ 假键');
  }
  const officialOrder = labels.filter((w) => OFFICIAL.includes(w));
  assert.deepEqual(officialOrder, OFFICIAL, '官方四格的相对顺序被打乱：' + officialOrder.join('/'));
  assert.equal(labels[labels.length - 1], extra[0], '本仓自有面应排最后，实得 ' + labels.join('/'));
});

test('v4.209.0 A9 提示条不许用宿主 alert（会卡住 SillyTavern 消息流）', () => {
  const src = read('apps/clock/clock-view.js').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(!/\balert\s*\(/.test(src), 'clock-view.js 里出现了 alert(');
  assert.ok(src.includes('_toast('), '缺页面内提示条实现');
  assert.ok(src.includes('_clearToast()'), '缺提示条回收（重绘会留一颗看不见的定时器）');
});

/* ---------- 分层位次：v4.209.0 实测踩到的两个坑，各用一条判据钉住 ----------
 * 坑① 按钮规则若留在「无层」，会被
 *      rp-entry.css:65 的 `:is(...)[data-rp-ds="2"] :is(button, ...) { all: revert-layer; }`
 *      回滚成 UA 默认 —— 实测症状：禁用格 opacity=1（置灰消失）、padding=0、color:#000。
 *      修法：按钮规则进 @layer rp.apps（revert-layer 会回退到该层的值）。
 * 坑② 容器规则若进了 @layer，会输给 clock.v3.css 的 rp.skins 层
 *      （层序先于特异性）—— 实测症状：底栏被 32px 的 padding-bottom 顶离外壳底 29px。
 *      修法：容器规则留在无层（无层优先于所有层），v3 下的按钮修正放进 rp.skins 同层抢特异性。
 * 这两条互为反向，缺任何一条都会「修好一个弄坏另一个」，所以必须成对守着。 */
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
test('v4.209.0 A10 分层位次：按钮进 rp.apps、容器留无层、v3 按钮修正进 rp.skins', () => {
  const css = read('apps/clock/clock.v4.css').replace(/\/\*[\s\S]*?\*\//g, '');
  const entry = read('phone/design/rp-entry.css');
  assert.ok(/all:\s*revert-layer/.test(entry), '前提变了：rp-entry.css 里已无 all: revert-layer，A10 的坑①需重估');
  const apps = segOfLayer(css, 'rp.apps');
  assert.ok(apps, 'clock.v4.css 缺 @layer rp.apps 块');
  assert.ok(apps.includes('.cl-app .cl-tabbar-item {'), '按钮规则不在 rp.apps 层内 ⇒ 会被 all: revert-layer 打回 UA 默认（置灰/内边距/字色全失效）');
  assert.ok(apps.includes('.cl-app .cl-tabbar-item.is-disabled {'), '禁用格规则不在 rp.apps 层内 ⇒ opacity .38 会被打回 1');
  const skins = segOfLayer(css, 'rp.skins');
  assert.ok(skins, 'clock.v4.css 缺 @layer rp.skins 块（v3 皮肤下的按钮修正无处可放）');
  assert.ok(skins.includes('#phone-panel[data-rp-ios="3"] .cl-app .cl-tabbar-item'), 'v3 下的按钮修正不在 rp.skins 层内 ⇒ 层序上永远输给 clock.v3.css');
  /* 容器规则必须落在第一个 @layer 之前（= 无层）。 */
  const firstLayer = css.indexOf('@layer ');
  const rootIdx = css.indexOf('.cl-root.cl-app {');
  assert.ok(rootIdx >= 0, '找不到 .cl-root.cl-app 规则');
  assert.ok(rootIdx < firstLayer, '容器规则被放进了 @layer ⇒ 会输给 v3 皮肤的 rp.skins 层（底栏会被 padding-bottom 顶离外壳底）');
  const scrollIdx = css.indexOf('.cl-app .cl-scroll {');
  assert.ok(scrollIdx >= 0 && scrollIdx < firstLayer, '滚动层规则被放进了 @layer（同上，会被皮肤覆盖）');
  const navIdx = css.indexOf('.cl-app .cl-tabbar {');
  assert.ok(navIdx >= 0 && navIdx < firstLayer, '底栏规则被放进了 @layer（同上）');
});