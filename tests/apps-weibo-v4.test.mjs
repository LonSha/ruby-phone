/* ============================================================
 * tests/apps-weibo-v4.test.mjs — 微博「照现实」v4.215.0 静态门
 * ------------------------------------------------------------
 * weibo 是 v4.203.0 的半改造：已有官方五格底栏雏形，但缺单一真源、
 * 缺独立 v4.css、缺静态判据。本套只钉「一改就悄悄退回去」的结构面：
 *   A1 WB_FACES 五格单一真源；
 *   A2 底栏一处生成且只调一次（不许另写一份格表）；
 *   A3 nav role/navigation + aria-label + data-wb-face + aria-current + 绑定属性保留；
 *   A4 底栏排在 .weibo-tab-content 之后；
 *   A5 weibo.css @import 投递 v4.css，无 position:fixed，热区 48/44，按钮进 @layer rp.apps；
 *   N1/N2 负控制：删格 / 去 import 必须转红。
 * 不实例化 WeiboView（constructor/渲染依赖宿主），走源码形态判据。
 * ============================================================ */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = dirname(HERE);
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const VIEW = read('apps/weibo/weibo-view.js');
const CSS = read('apps/weibo/weibo.v4.css').replace(/\/\*[\s\S]*?\*\//g, '');
const MAIN_CSS = read('apps/weibo/weibo.css');
const countOf = (src, lit) => src.split(lit).length - 1;

test('v4.215.0 A1 WB_FACES 是五格单一真源（官方 16.11.3）', () => {
  const i = VIEW.indexOf('export const WB_FACES');
  assert.ok(i >= 0, '必须有 WB_FACES 真源');
  const def = VIEW.slice(i, VIEW.indexOf('];', i) + 2);
  for (const key of ['home', 'video', 'discover', 'message', 'me']) {
    assert.ok(def.includes("key: '" + key + "'"), 'WB_FACES 缺格：' + key);
  }
});

test('v4.215.0 A2 底栏一处生成，旧 navItems/bottomNav 拼装必须移除', () => {
  assert.ok(/WB_FACES\.map\(/.test(VIEW), '底栏必须从 WB_FACES 渲染');
  assert.equal(countOf(VIEW, '_bottomNavHtml('), 2,
    '应恰好 2 处：1 处定义 + 1 处模板调用，实得 ' + countOf(VIEW, '_bottomNavHtml('));
  assert.ok(!/const navItems\s*=\s*\[/.test(VIEW), '旧 navItems 数组必须移除');
  assert.ok(!/const bottomNav\s*=/.test(VIEW), '旧 bottomNav 拼装必须移除');
});

test('v4.215.0 A3 底栏是 <nav role=navigation>，格带 data-wb-face / aria-current，且绑定语义保留', () => {
  const at = VIEW.indexOf('_bottomNavHtml(activeFace)');
  assert.ok(at > 0, '找不到 _bottomNavHtml 定义');
  const body = VIEW.slice(at, VIEW.indexOf('\n    }', at) + 7);
  assert.ok(/<nav class="weibo-bottomnav" role="navigation" aria-label="微博主导航">/.test(body), '底栏必须是带无障碍名的 nav');
  assert.ok(/data-wb-face=/.test(body), '每格必须带 data-wb-face');
  assert.ok(/aria-current=/.test(body), '当前格必须带 aria-current');
  assert.ok(/data-act="weibo-goto"/.test(body), '必须保留 weibo-goto 绑定属性');
  assert.ok(/data-goto=/.test(body), '必须保留 data-goto');
  assert.ok(/data-act="weibo-soon"/.test(body), '必须保留 weibo-soon 绑定属性');
  assert.ok(/aria-disabled="true"/.test(body), '禁用格必须带 aria-disabled');
});

test('v4.215.0 A4 底栏排在内容层之后（DOM 顺序=视觉顺序）', () => {
  const at = VIEW.indexOf('${this._bottomNavHtml(bottomFace)}');
  assert.ok(at > 0, '模板里必须调用 _bottomNavHtml');
  const before = VIEW.slice(0, at);
  const contentOpen = before.lastIndexOf('<div class="weibo-tab-content">');
  assert.ok(contentOpen >= 0, '底栏前必须有 .weibo-tab-content 打开');
  const contentClose = VIEW.indexOf('</div>', contentOpen + '<div class="weibo-tab-content">'.length);
  assert.ok(contentClose > contentOpen && contentClose < at, '底栏必须在 .weibo-tab-content 闭合之后');
});

test('v4.215.0 A5 样式由 weibo.css @import 投递，底栏无 position:fixed、热区≥48/44、按钮进 @layer rp.apps', () => {
  assert.ok(MAIN_CSS.includes('@import url("./weibo.v4.css")'), 'weibo.v4.css 未被 weibo.css @import 投递（样式不上屏）');
  const nav = /\.weibo-app > \.weibo-bottomnav \{[\s\S]*?\}/.exec(CSS);
  assert.ok(nav, '找不到 .weibo-app > .weibo-bottomnav 规则');
  assert.ok(/flex:\s*0 0 auto/.test(nav[0]), '底栏必须 flex:0 0 auto 贴底');
  assert.ok(!/position:\s*fixed/.test(CSS), '底栏不许用 position:fixed');
  assert.ok(/min-height:\s*48px/.test(nav[0]), '底栏本身缺 48px 热区下限');
  const appLayer = CSS.slice(CSS.indexOf('@layer rp.apps {'));
  assert.ok(/\.weibo-navitem/.test(appLayer), '按钮规则必须进 @layer rp.apps（否则被 all:revert-layer 回滚）');
  assert.ok(/min-height:\s*48px/.test(appLayer) && /min-width:\s*44px/.test(appLayer), '格热区下限 48/44 必须在层内');
});

test('v4.215.0 N1 负控制：删掉 WB_FACES 的一格 ⇒ A1 同款判据必须转红', () => {
  const broken = VIEW.replace("    { key: 'video', label: '视频', icon: 'fa-clapperboard', disabled: true },", '');
  assert.notEqual(broken, VIEW, '破坏锚点必须命中');
  const def = broken.slice(broken.indexOf('export const WB_FACES'), broken.indexOf('];', broken.indexOf('export const WB_FACES')) + 2);
  assert.ok(!def.includes("key: 'video'"), '删格后 WB_FACES 不该再有 video（证明判据有牙）');
});

test('v4.215.0 N2 负控制：把 @import 去掉 ⇒ A5 同款判据必须转红', () => {
  const broken = MAIN_CSS.replace('@import url("./weibo.v4.css");', '');
  assert.ok(!broken.includes('@import url("./weibo.v4.css")'), '去掉 import 后应探测不到投递');
});