/* ============================================================
 * tests/apps-lofter-v4.test.mjs — 老福特「照现实」v4.215.0 静态门
 * ------------------------------------------------------------
 * lofter 已有 LOF_NAV + _bottomNavHTML 的半改造；本套补齐可看守面：
 *   A1 LF_FACES 是五格单一真源（与 LOF_NAV 同引用）；
 *   A2 底栏一处生成（不许另写格表）；
 *   A3 nav role/navigation + data-lf-face + aria-current，且 data-tab / lof-soon 绑定保留；
 *   A4 底栏排在 .lof-main 之后；
 *   A5 lofter.css @import 投递 v4.css，无 position:fixed，热区 48/44，按钮进 @layer rp.apps；
 *   N1/N2 负控制。
 * 不实例化视图，走源码形态判据。
 * ============================================================ */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = dirname(HERE);
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const VIEW = read('apps/lofter/lofter-view.js');
const CSS = read('apps/lofter/lofter.v4.css').replace(/\/\*[\s\S]*?\*\//g, '');
const MAIN_CSS = read('apps/lofter/lofter.css');
const countOf = (src, lit) => src.split(lit).length - 1;

test('v4.215.0 A1 LF_FACES 是五格单一真源（与 LOF_NAV 同引用）', () => {
  assert.ok(/export const LF_FACES\s*=\s*LOF_NAV/.test(VIEW), 'LF_FACES 必须复用 LOF_NAV，不许另写一份');
  const i = VIEW.indexOf('const LOF_NAV');
  assert.ok(i >= 0, '必须有 LOF_NAV 真源');
  const def = VIEW.slice(i, VIEW.indexOf('];', i) + 2);
  for (const key of ['home', 'follow', 'message', 'me', 'search']) {
    assert.ok(def.includes("key: '" + key + "'"), 'LOF_NAV/LF_FACES 缺格：' + key);
  }
});

test('v4.215.0 A2 底栏一处生成，旧格表不能另写', () => {
  assert.ok(/LF_FACES\.map\(/.test(VIEW), '底栏必须从 LF_FACES 渲染');
  assert.equal(countOf(VIEW, '_bottomNavHTML('), 2,
    '应恰好 2 处：1 处定义 + 1 处调用，实得 ' + countOf(VIEW, '_bottomNavHTML('));
});

test('v4.215.0 A3 nav role/navigation，格带 data-lf-face/aria-current，绑定语义保留', () => {
  const at = VIEW.indexOf('_bottomNavHTML(cur) {');
  assert.ok(at > 0, '找不到 _bottomNavHTML 定义');
  const endMarker = VIEW.indexOf('/* ---------- 首页', at);
  assert.ok(endMarker > at, '找不到 _bottomNavHTML 结束标记');
  const body = VIEW.slice(at, endMarker);
  assert.ok(/<nav class="lof-bottomnav" role="navigation" aria-label="老福特主导航">/.test(body), '底栏必须是带无障碍名的 nav');
  assert.ok(/data-lf-face=/.test(body), '每格必须带 data-lf-face');
  assert.ok(/aria-current=/.test(body), '当前格必须带 aria-current');
  assert.ok(/data-tab=/.test(body), '可点格必须保留 data-tab（原 setTab 语义）');
  assert.ok(/data-act="lof-soon"/.test(body), '消息格必须保留 lof-soon 绑定');
  assert.ok(/aria-disabled="true"/.test(body), '禁用格必须带 aria-disabled');
});

test('v4.215.0 A4 底栏排在 .lof-main 之后', () => {
  const at = VIEW.indexOf("parts.push(this._bottomNavHTML(cur));");
  assert.ok(at > 0, '模板必须调用 _bottomNavHTML');
  const mainClose = VIEW.lastIndexOf("parts.push('</div>');           /* /.lof-main */", at);
  assert.ok(mainClose > 0 && mainClose < at, '底栏必须在 .lof-main 闭合之后');
});

test('v4.215.0 A5 样式由 lofter.css @import 投递，无 fixed，热区 48/44，按钮进 @layer rp.apps', () => {
  assert.ok(MAIN_CSS.includes('@import url("./lofter.v4.css")'), 'lofter.v4.css 未被 lofter.css @import 投递');
  const nav = /\.lof-app > \.lof-bottomnav \{[\s\S]*?\}/.exec(CSS);
  assert.ok(nav, '找不到 .lof-app > .lof-bottomnav 规则');
  assert.ok(/flex:\s*0 0 auto/.test(nav[0]), '底栏必须 flex:0 0 auto 贴底');
  assert.ok(!/position:\s*fixed/.test(CSS), '底栏不许用 position:fixed');
  assert.ok(/min-height:\s*48px/.test(nav[0]), '底栏本身缺 48px 热区下限');
  const appLayer = CSS.slice(CSS.indexOf('@layer rp.apps {'));
  assert.ok(/\.lof-navitem/.test(appLayer), '按钮规则必须进 @layer rp.apps');
  assert.ok(/min-height:\s*48px/.test(appLayer) && /min-width:\s*44px/.test(appLayer), '格热区下限 48/44 必须在层内');
});

test('v4.215.0 N1 负控制：删掉 LF_FACES 别名 ⇒ A1 同款判据必须转红', () => {
  const broken = VIEW.replace('export const LF_FACES = LOF_NAV;', '');
  assert.notEqual(broken, VIEW, '破坏锚点必须命中');
  assert.ok(!/export const LF_FACES\s*=\s*LOF_NAV/.test(broken), '删别名后应探测不到 LF_FACES');
});

test('v4.215.0 N2 负控制：把 @import 去掉 ⇒ A5 同款判据必须转红', () => {
  const broken = MAIN_CSS.replace('@import url("./lofter.v4.css");', '');
  assert.ok(!broken.includes('@import url("./lofter.v4.css")'), '去掉 import 后应探测不到投递');
});