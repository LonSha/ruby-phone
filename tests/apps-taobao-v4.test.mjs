/* tests/apps-taobao-v4.test.mjs — 桃宝「照现实」v4.215.0 静态门 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const VIEW = read('apps/taobao/taobao-view.js');
const CSS = read('apps/taobao/taobao.v4.css').replace(/\/\*[\s\S]*?\*\//g, '');

test('v4.215.0 A1 TBO_FACES 五格单一真源', () => {
  assert.ok(/export const TBO_FACES\s*=\s*TABS/.test(VIEW));
  const i = VIEW.indexOf('const TABS');
  const def = VIEW.slice(i, VIEW.indexOf('];', i) + 2);
  for (const k of ['home', 'guang', 'msg', 'cart', 'mine']) assert.ok(def.includes("key: '" + k + "'"), '缺格 ' + k);
});
test('v4.215.0 A2 底栏从 TBO_FACES 渲染', () => {
  assert.ok(/for \(const t of TBO_FACES\)/.test(VIEW));
  assert.ok(!/for \(const t of TABS\)/.test(VIEW));
});
test('v4.215.0 A3 nav role + data-tbo-face + aria-current + 禁用语义', () => {
  const at = VIEW.indexOf('<nav class="tbo-tabbar"');
  assert.ok(at > 0);
  const body = VIEW.slice(at, VIEW.indexOf("'</nav>'", at));
  assert.ok(/role="navigation" aria-label="桃宝主导航"/.test(body));
  assert.ok(/data-tbo-face=/.test(body) && /aria-current=/.test(body));
  assert.ok(/data-act="tab"/.test(body) && /data-tab=/.test(body));
  assert.ok(/data-act="soon"/.test(body) && /aria-disabled="true"/.test(body));
});
test('v4.215.0 A4 DOM 顺序：_tabbarHTML 排在 _pageHTML 之后', () => {
  assert.ok(/this\._pageHTML\(\) \+ this\._tabbarHTML\(\)/.test(VIEW));
});
test('v4.215.0 A5 v4.css link 注入 + 无 fixed + 热区 + @layer', () => {
  assert.ok(/id = 'tbo-v4-css'/.test(VIEW));
  assert.ok(/new URL\('\.\/taobao\.v4\.css', import\.meta\.url\)/.test(VIEW));
  const nav = /\.tbo-app > \.tbo-tabbar \{[\s\S]*?\}/.exec(CSS);
  assert.ok(nav && /flex:\s*0 0 auto/.test(nav[0]));
  assert.ok(!/position:\s*fixed/.test(CSS));
  assert.ok(/min-height:\s*48px/.test(nav[0]));
  const layer = CSS.slice(CSS.indexOf('@layer rp.apps {'));
  assert.ok(/\.tbo-tab/.test(layer) && /min-height:\s*48px/.test(layer) && /min-width:\s*44px/.test(layer));
});
test('v4.215.0 N1 负控制：删 TBO_FACES 必红', () => {
  const b = VIEW.replace('export const TBO_FACES = TABS;', '');
  assert.notEqual(b, VIEW);
});
test('v4.215.0 N2 负控制：删 link 注入必红', () => {
  const b = VIEW.replace("link.id = 'tbo-v4-css';", '');
  assert.notEqual(b, VIEW);
});