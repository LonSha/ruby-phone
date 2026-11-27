/* tests/apps-weather-v4.test.mjs — 天气「照现实」v4.215.0 静态门 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = dirname(HERE);
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const VIEW = read('apps/weather/weather-view.js');
const CSS = read('apps/weather/weather.v4.css').replace(/\/\*[\s\S]*?\*\//g, '');

test('v4.215.0 A1 WTH_FACES 是三格单一真源', () => {
  assert.ok(/export const WTH_FACES\s*=\s*TABS/.test(VIEW));
  const i = VIEW.indexOf('const TABS');
  const def = VIEW.slice(i, VIEW.indexOf('];', i) + 2);
  for (const k of ['now', 'records', 'settings']) assert.ok(def.includes("key: '" + k + "'"), '缺格 ' + k);
});
test('v4.215.0 A2 底栏从 WTH_FACES 渲染', () => {
  assert.ok(/WTH_FACES\.map\(/.test(VIEW));
  assert.ok(!/TABS\.map\(\(t\) => '<button class="wth-tab'/.test(VIEW));
});
test('v4.215.0 A3 nav role + data-wth-face + aria-current', () => {
  const at = VIEW.indexOf('<nav class="wth-tabbar"');
  assert.ok(at > 0);
  const body = VIEW.slice(at, VIEW.indexOf("'</nav>'", at));
  assert.ok(/role="navigation" aria-label="天气主导航"/.test(body));
  assert.ok(/data-wth-face=/.test(body) && /aria-current=/.test(body));
  assert.ok(/data-act="tab"/.test(body) && /data-tab=/.test(body));
});
test('v4.215.0 A4 底栏排在 page 之后', () => {
  const at = VIEW.indexOf("const tabs = ['<nav class=\"wth-tabbar\"");
  assert.ok(at > 0);
  assert.ok(VIEW.lastIndexOf('const page =', at) < at);
});
test('v4.215.0 A5 v4.css link 注入 + 无 fixed + 热区 48/44 + @layer', () => {
  assert.ok(/id = 'wth-v4-css'/.test(VIEW));
  assert.ok(/new URL\('\.\/weather\.v4\.css', import\.meta\.url\)/.test(VIEW));
  const nav = /\.wth-root > \.wth-tabbar \{[\s\S]*?\}/.exec(CSS);
  assert.ok(nav && /flex:\s*0 0 auto/.test(nav[0]));
  assert.ok(!/position:\s*fixed/.test(CSS));
  assert.ok(/min-height:\s*48px/.test(nav[0]));
  const layer = CSS.slice(CSS.indexOf('@layer rp.apps {'));
  assert.ok(/\.wth-tab/.test(layer) && /min-height:\s*48px/.test(layer) && /min-width:\s*44px/.test(layer));
});
test('v4.215.0 N1 负控制：删 WTH_FACES', () => {
  const b = VIEW.replace('export const WTH_FACES = TABS;', '');
  assert.notEqual(b, VIEW); assert.ok(!/export const WTH_FACES\s*=\s*TABS/.test(b));
});
test('v4.215.0 N2 负控制：删 link 注入', () => {
  const b = VIEW.replace("link.id = 'wth-v4-css';", '');
  assert.notEqual(b, VIEW); assert.ok(!/id = 'wth-v4-css'/.test(b));
});