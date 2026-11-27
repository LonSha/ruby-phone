/* tests/apps-gacha-v4.test.mjs — gacha「照现实」v4.215.0 静态门 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const VIEW = read('apps/gacha/gacha-view.js');
const CSS = read('apps/gacha/gacha.v4.css').replace(/\/\*[\s\S]*?\*\//g, '');

test('v4.215.0 A1 GA_FACES 单一真源', () => {
  assert.ok(/export const GA_FACES\s*=\s*TABS/.test(VIEW));
  assert.ok(/GA_FACES\.map\(/.test(VIEW), '底栏必须从 GA_FACES 渲染');
});
test('v4.215.0 A2 语义属性保留', () => {
  const at = VIEW.indexOf('<nav class="ga-tabbar"');
  assert.ok(at > 0);
  const body = VIEW.slice(at, VIEW.indexOf("'</nav>'", at));
  assert.ok(/role="navigation"/.test(body));
  assert.ok(/data-ga-face=/.test(body) && /aria-current=/.test(body));
  assert.ok(/data-act="tab"/.test(body) && /data-tab=/.test(body));
});
test('v4.215.0 A3 DOM 顺序：底栏拼装在 page 之后', () => {
  const at = VIEW.indexOf("const tabs = ['<nav class=\"ga-tabbar\"");
  assert.ok(at > 0);
  assert.ok(VIEW.lastIndexOf('const page =', at) < at);
});
test('v4.215.0 A4 v4.css link 注入 + 无 fixed + 热区 + @layer', () => {
  assert.ok(/id = 'ga-v4-css'/.test(VIEW));
  assert.ok(/new URL\('\.\/gacha\.v4\.css', import\.meta\.url\)/.test(VIEW));
  const nav = /\.ga-root > \.ga-tabbar \{[\s\S]*?\}/.exec(CSS);
  assert.ok(nav && /flex:\s*0 0 auto/.test(nav[0]));
  assert.ok(!/position:\s*fixed/.test(CSS));
  assert.ok(/min-height:\s*48px/.test(nav[0]));
  const layer = CSS.slice(CSS.indexOf('@layer rp.apps {'));
  assert.ok(/\.ga-tab/.test(layer) && /min-height:\s*48px/.test(layer) && /min-width:\s*44px/.test(layer));
});
test('v4.215.0 N 负控制：删 GA_FACES 必红', () => {
  const b = VIEW.replace('export const GA_FACES = TABS;', '');
  assert.notEqual(b, VIEW);
});
test('v4.215.0 N 负控制：删 link 注入必红', () => {
  const b = VIEW.replace("link.id = 'ga-v4-css';", '');
  assert.notEqual(b, VIEW);
});
