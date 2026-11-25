/* ============================================================
 * tests/apps-clock-v4.test.mjs
 *   时计「照现实」v4（底栏一级导航）的**静态门**。
 *   真盒模型与真点击的证据在浏览器场景 o8-clock-bottomnav.scen.js（14 条读数 ×3 档），
 *   本套只守「一改就悄悄退回去」的那几处结构，不重复验像素。
 *
 * 判据来源（Apple 官方支持两篇，写在文件里不靠记忆）：
 *   ①「在 iPhone 上使用计时器或秒表」：「轻点『秒表』」；
 *   ②「在 iPhone 上的『时钟』中查看世界时间」：「前往『时钟』App。轻点『世界时钟』」。
 *   ⇒ 一级入口在页面底部页签上。
 *
 * 为什么要有 A2（格数 == _tabs().length）：本仓最贵的一类缺陷是「画出来但点不动的假键」。
 *   底栏格数一旦手工写死，将来 _tabs() 增删就会多出/少掉一格而没人发现。
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

const mkView = () => {
  const v = new ClockView({ settings: {} }, null, null);
  v._tab = 'today';
  return v;
};

test('v4.208.0 A1 底栏是 <nav>，且带 role=navigation 与中文无障碍名', () => {
  const html = mkView()._tabbarHtml();
  assert.ok(html.startsWith('<nav class="cl-tabbar"'), '底栏必须是 .cl-tabbar 的 <nav>');
  assert.ok(html.includes('role="navigation"'), '缺 role=navigation 就读不成一级导航');
  assert.ok(html.includes('aria-label="主导航"'), '缺中文无障碍名');
});

test('v4.208.0 A2 底栏格数 == _tabs().length，每格一个 data-tab（不写死、不凑格）', () => {
  const v = mkView();
  const tabs = v._tabs();
  const html = v._tabbarHtml();
  const cells = html.match(/class="cl-tabbar-item/g) || [];
  assert.equal(cells.length, tabs.length, '底栏格数必须等于 _tabs() 的真格数');
  for (const t of tabs) {
    assert.ok(html.includes('data-tab="' + t.key + '"'), '缺格：' + t.key);
    assert.ok(html.includes('>' + t.label + '<'), '缺文案：' + t.label);
  }
});

test('v4.208.0 A3 当前面高亮走 aria-current=page（不是只靠颜色）', () => {
  const v = mkView();
  v._tab = 'clock';
  const html = v._tabbarHtml();
  const clockCell = /<button[^>]*data-tab="clock"[^>]*>/.exec(html);
  assert.ok(clockCell, '找不到 clock 格');
  assert.ok(clockCell[0].includes('aria-current="page"'), '当前面必须带 aria-current=page');
  const todayCell = /<button[^>]*data-tab="today"[^>]*>/.exec(html);
  assert.ok(todayCell && todayCell[0].includes('aria-current="false"'), '非当前面必须是 false');
});

test('v4.208.0 A4 视图里底栏排在内容层之后（DOM 顺序＝视觉顺序）', () => {
  const src = read('apps/clock/clock-view.js');
  const iScroll = src.indexOf("parts.push('<div class=\"cl-scroll\">')");
  const iNav = src.indexOf('parts.push(this._tabbarHtml())');
  assert.ok(iScroll > 0, '找不到 .cl-scroll 压入点');
  assert.ok(iNav > iScroll, '底栏必须在内容层之后压入，否则滚动区会把它顶走');
  /* 两个真面各自都要压底栏 —— 早退分支漏一条，那个面就没有导航。 */
  const navPushes = src.match(/parts\.push\(this\._tabbarHtml\(\)\)/g) || [];
  assert.equal(navPushes.length, 2, '「今天」与「时计」两个面都必须压底栏，实得 ' + navPushes.length);
});

test('v4.208.0 A5 官方有、本机没有的三格不画，但有如实说明', () => {
  const src = read('apps/clock/clock-view.js');
  assert.ok(src.includes('cl-absent'), '缺 .cl-absent 说明行');
  assert.ok(src.includes('闹钟') && src.includes('假键'), '说明行必须点出「闹钟/秒表/计时器」与「假键」这两个理由');
  const html = mkView()._tabbarHtml();
  for (const w of ['闹钟', '秒表', '计时器']) {
    assert.ok(!html.includes('data-tab="' + w + '"'), '底栏不许出现未实现的格：' + w);
  }
});

test('v4.208.0 A6 皮肤表：由入口 @import 投递，且底栏不用 position:fixed', () => {
  const entry = read('phone/design/rp-entry.css');
  assert.ok(entry.includes('apps/clock/clock.v4.css'), 'clock.v4.css 未被 rp-entry.css 投递（等于样式不上屏）');
  const css = read('apps/clock/clock.v4.css');
  const navBlock = /\.cl-app \.cl-tabbar \{[\s\S]*?\}/.exec(css);
  assert.ok(navBlock, '找不到 .cl-app .cl-tabbar 规则');
  assert.ok(navBlock[0].includes('flex-shrink: 0'), '底栏必须 flex-shrink:0 贴底');
  assert.ok(!/position:\s*fixed/.test(navBlock[0]), '底栏不许用 position:fixed（会脱离外壳高度约束）');
});

test('v4.208.0 A7 滚动层必须 min-height:0（缺它 flex 子项不收缩，底栏被顶出可视区）', () => {
  const css = read('apps/clock/clock.v4.css');
  const scrollBlock = /\.cl-app \.cl-scroll \{[\s\S]*?\}/.exec(css);
  assert.ok(scrollBlock, '找不到 .cl-app .cl-scroll 规则');
  assert.ok(/min-height:\s*0/.test(scrollBlock[0]), '滚动层缺 min-height:0');
  assert.ok(/overflow-y:\s*auto/.test(scrollBlock[0]), '滚动层必须是唯一滚动区');
});