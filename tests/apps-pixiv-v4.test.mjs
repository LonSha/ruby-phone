/* ============================================================
 * tests/apps-pixiv-v4.test.mjs — Pixiv「照现实」v4.215.0 静态门
 * 同 lofter 口径：PXV_FACES 复用 PXV_NAV；底栏一处生成；
 * nav role/navigation + data-pxv-face/aria-current；DOM 顺序；v4.css 投递与热区/分层；负控制。
 * ============================================================ */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = dirname(HERE);
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const VIEW = read('apps/pixiv/pixiv-view.js');
const CSS = read('apps/pixiv/pixiv.v4.css').replace(/\/\*[\s\S]*?\*\//g, '');
const MAIN_CSS = read('apps/pixiv/pixiv.css');
const countOf = (src, lit) => src.split(lit).length - 1;

test('v4.215.0 A1 PXV_FACES 是五格单一真源（与 PXV_NAV 同引用）', () => {
  assert.ok(/export const PXV_FACES\s*=\s*PXV_NAV/.test(VIEW), 'PXV_FACES 必须复用 PXV_NAV');
  const i = VIEW.indexOf('const PXV_NAV');
  const def = VIEW.slice(i, VIEW.indexOf('];', i) + 2);
  for (const key of ['novel', 'search', 'illust', 'notice', 'me']) {
    assert.ok(def.includes("key: '" + key + "'"), 'PXV_NAV/PXV_FACES 缺格：' + key);
  }
});

test('v4.215.0 A2 底栏一处生成，旧格表不能另写', () => {
  assert.ok(/PXV_FACES\.map\(/.test(VIEW), '底栏必须从 PXV_FACES 渲染');
  assert.equal(countOf(VIEW, '_bottomNavHTML('), 2, '应恰好 2 处（定义+调用）');
});

test('v4.215.0 A3 nav role/navigation，格带 data-pxv-face/aria-current，绑定语义保留', () => {
  const at = VIEW.indexOf('_bottomNavHTML(cur) {');
  const end = VIEW.indexOf('/* ---------- 作品面', at);
  assert.ok(at > 0 && end > at, '找不到 _bottomNavHTML 定义/结束');
  const body = VIEW.slice(at, end);
  assert.ok(/<nav class="pxv-bottomnav" role="navigation" aria-label="Pixiv 主导航">/.test(body), '底栏必须是带无障碍名的 nav');
  assert.ok(/data-pxv-face=/.test(body), '每格必须带 data-pxv-face');
  assert.ok(/aria-current=/.test(body), '当前格必须带 aria-current');
  assert.ok(/data-tab=/.test(body), '可点格必须保留 data-tab');
  assert.ok(/data-act="pxv-soon"/.test(body), '通知格必须保留 pxv-soon 绑定');
  assert.ok(/aria-disabled="true"/.test(body), '禁用格必须带 aria-disabled');
});

test('v4.215.0 A4 底栏排在 .pxv-main 之后', () => {
  const at = VIEW.indexOf("parts.push(this._bottomNavHTML(cur));");
  assert.ok(at > 0, '模板必须调用 _bottomNavHTML');
  const mainClose = VIEW.lastIndexOf("parts.push('</div>');           /* /.pxv-main */", at);
  assert.ok(mainClose > 0 && mainClose < at, '底栏必须在 .pxv-main 闭合之后');
});

test('v4.215.0 A5 样式由 pixiv.css @import 投递，无 fixed，热区 48/44，按钮进 @layer rp.apps', () => {
  assert.ok(MAIN_CSS.includes('@import url("./pixiv.v4.css")'), 'pixiv.v4.css 未被 @import 投递');
  const nav = /\.pxv-app > \.pxv-bottomnav \{[\s\S]*?\}/.exec(CSS);
  assert.ok(nav, '找不到 .pxv-app > .pxv-bottomnav 规则');
  assert.ok(/flex:\s*0 0 auto/.test(nav[0]), '底栏必须 flex:0 0 auto');
  assert.ok(!/position:\s*fixed/.test(CSS), '底栏不许用 position:fixed');
  assert.ok(/min-height:\s*48px/.test(nav[0]), '底栏缺 48px 热区下限');
  const layer = CSS.slice(CSS.indexOf('@layer rp.apps {'));
  assert.ok(/\.pxv-navitem/.test(layer), '按钮规则必须进 @layer rp.apps');
  assert.ok(/min-height:\s*48px/.test(layer) && /min-width:\s*44px/.test(layer), '格热区 48/44 必须在层内');
});

test('v4.215.0 N1 负控制：删掉 PXV_FACES 别名 ⇒ A1 同款判据必须转红', () => {
  const broken = VIEW.replace('export const PXV_FACES = PXV_NAV;', '');
  assert.notEqual(broken, VIEW);
  assert.ok(!/export const PXV_FACES\s*=\s*PXV_NAV/.test(broken));
});

test('v4.215.0 N2 负控制：把 @import 去掉 ⇒ A5 同款判据必须转红', () => {
  const broken = MAIN_CSS.replace('@import url("./pixiv.v4.css");', '');
  assert.ok(!broken.includes('@import url("./pixiv.v4.css")'));
});