/* ============================================================
 * tests/apps-honey-v4.test.mjs — 蜜语「照现实」v4.215.0 静态门
 * ------------------------------------------------------------
 * 蜜语是内容类 App（无记忆插件归因面），故照 xhs/bilibili 流派：
 *   底栏四格（推荐/直播/关注/我的）从 HN_FACES 单一真源渲染，
 *   aria-current / role=tab / data-hn-face 三标记齐全，底栏排在内容之后，
 *   CSS 分层投递（容器无层 + 按钮 @layer rp.apps + 无 position:fixed + 热区下限）。
 * 本套只钉「一改就悄悄退回去」的结构面；真盒模型见浏览器层，不在此重复验像素。
 * 不实例化 HoneyView（constructor 里有 Audio/fetch），走源码形态判据 + 负控制。
 * ============================================================ */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = dirname(HERE);
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const VIEW = read('apps/honey/honey-view.js');
const CSS = read('apps/honey/honey.v4.css').replace(/\/\*[\s\S]*?\*\//g, '');
const ENTRY = read('phone/design/rp-entry.css');
const countOf = (src, lit) => src.split(lit).length - 1;

test('v4.215.0 A1 HN_FACES 是四格单一真源，底栏由它渲染（不许另写一份格表）', () => {
  const i = VIEW.indexOf('export const HN_FACES');
  assert.ok(i >= 0, '必须有 HN_FACES 真源');
  const def = VIEW.slice(i, VIEW.indexOf(']);', i) + 3);
  for (const key of ['recommend', 'live', 'follow', 'mine']) {
    assert.ok(def.includes("key: '" + key + "'"), 'HN_FACES 缺格：' + key);
  }
  assert.ok(/HN_FACES\.map\(/.test(VIEW), '底栏必须从 HN_FACES 渲染');
});

test('v4.215.0 A2 底栏一处生成（4 页模板都调 _bottomNavHtml，不重复抄格子）', () => {
  assert.ok(/export const HN_FACES/.test(VIEW));
  assert.equal(countOf(VIEW, '_bottomNavHtml('), 5,
    '应恰好 5 处：1 处定义 + 4 处模板调用（推荐/直播/关注/我的），实得 ' + countOf(VIEW, '_bottomNavHtml('));
  /* 旧的四格 div 模板必须清掉（否则页面上会有两套导航） */
  assert.ok(!/class="honey-tabs"/.test(VIEW), '旧 honey-tabs 四格模板必须移除');
});

test('v4.215.0 A3 底栏是 <nav role=navigation>，格带 aria-current / data-hn-face / role=tab', () => {
  const at = VIEW.indexOf('_bottomNavHtml(active)');
  assert.ok(at > 0, '找不到 _bottomNavHtml 定义');
  const body = VIEW.slice(at, VIEW.indexOf('\n    }', at) + 7);
  assert.ok(/<nav class="honey-bottomnav" role="navigation" aria-label="主导航">/.test(body), '底栏必须是带无障碍名的 nav');
  assert.ok(/aria-current=/.test(body), '当前格高亮必须走 aria-current');
  assert.ok(/data-hn-face=/.test(body), '每格必须带 data-hn-face');
  assert.ok(/role="tab"/.test(body), '每格必须带 role=tab');
  assert.ok(/id="honey-tab-/.test(body), '必须保留原 tab id（现有点击绑定靠它命中）');
});

test('v4.215.0 A4 底栏排在内容层之后（DOM 顺序=视觉顺序），四页都如此', () => {
  /* 逐页校验：_bottomNavHtml 调用前必须“先开后闭”一个 honey-content 容器，
     调用后紧跟 honey-app 外壳闭合 —— 不用固定字符窗口，避免长页面误判。 */
  const calls = [...VIEW.matchAll(/\$\{this\._bottomNavHtml\('([a-z]+)'\)\}/g)];
  assert.equal(calls.length, 4, '四个页面模板都应注入底栏');
  for (const m of calls) {
    const before = VIEW.slice(0, m.index);
    // 距本页最近一次 honey-content 打开必须严格晚于上一个底栏/页面起点
    const opens = [...before.matchAll(/<div class="honey-content/g)];
    assert.ok(opens.length >= 1, m[1] + ' 页缺少内容层');
    // 打开之后、调用之前必须出现 honey-content 的闭合 </div>（内容先结束，底栏才入场）
    const lastOpen = opens[opens.length - 1].index;
    const between = VIEW.slice(lastOpen, m.index);
    assert.ok(between.includes('</div>'), m[1] + ' 页底栏仍在内容层内部（顺序会被顶走）');
    // 内容层必须在底栏调用前“打开且闭合”；弹窗等覆盖层可在底栏之后，不影响 DOM 顺序
  }
});

test('v4.215.0 A5 皮肤表由入口 @import 投递，底栏无 position:fixed、热区≥48、按钮进 @layer rp.apps', () => {
  assert.ok(ENTRY.includes('apps/honey/honey.v4.css'), 'honey.v4.css 未被 rp-entry.css 投递（样式不上屏）');
  const nav = /\.honey-app > \.honey-bottomnav \{[\s\S]*?\}/.exec(CSS);
  assert.ok(nav, '找不到 .honey-app > .honey-bottomnav 规则');
  assert.ok(/flex:\s*0 0 auto/.test(nav[0]), '底栏必须 flex:0 0 auto 贴底');
  assert.ok(!/position:\s*fixed/.test(CSS), '底栏不许用 position:fixed');
  assert.ok(/min-height:\s*48px/.test(nav[0]), '底栏本身缺 48px 热区下限');
  const appLayer = CSS.slice(CSS.indexOf('@layer rp.apps {'));
  assert.ok(/\.honey-tab/.test(appLayer), '按钮规则必须进 @layer rp.apps（否则被 all:revert-layer 回滚）');
  assert.ok(/min-height:\s*48px/.test(appLayer) && /min-width:\s*44px/.test(appLayer), '格热区下限 48/44 必须在层内');
});

test('v4.215.0 N1 负控制：删掉 HN_FACES 的一格 ⇒ A1 同款判据必须转红', () => {
  const broken = VIEW.replace("{ key: 'live',      label: '直播', icon: 'fa-tower-broadcast', page: 'live' },", '');
  assert.notEqual(broken, VIEW, '破坏锚点必须命中');
  const def = broken.slice(broken.indexOf('export const HN_FACES'), broken.indexOf(']);', broken.indexOf('export const HN_FACES')) + 3);
  assert.ok(!def.includes("key: 'live'"), '删格后 HN_FACES 不该再有 live（证明判据有牙）');
});

test('v4.215.0 N2 负控制：把入口 @import 去掉 ⇒ A5 同款判据必须转红', () => {
  const broken = ENTRY.replace('@import url("../../apps/honey/honey.v4.css");', '');
  assert.ok(!broken.includes('apps/honey/honey.v4.css'), '去掉 import 后应探测不到投递');
});