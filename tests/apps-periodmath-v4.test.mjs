/* tests/apps-periodmath-v4.test.mjs — 周期「照现实」v4.215.0 静态门
 * PM_FACES 复用 TABS；底栏一处生成；nav role + data-pm-face + aria-current；
 * DOM 顺序；v4.css link 注入投递；无 fixed / 热区 48/44 / @layer；负控制。 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = dirname(HERE);
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const VIEW = read('apps/periodmath/periodmath-view.js');
const CSS = read('apps/periodmath/periodmath.v4.css').replace(/\/\*[\s\S]*?\*\//g, '');

test('v4.215.0 A1 PM_FACES 是三格单一真源（与 TABS 同引用）', () => {
  assert.ok(/export const PM_FACES\s*=\s*TABS/.test(VIEW));
  const i = VIEW.indexOf('const TABS');
  const def = VIEW.slice(i, VIEW.indexOf('];', i) + 2);
  for (const key of ['today', 'records', 'settings']) {
    assert.ok(def.includes("key: '" + key + "'"), '缺格：' + key);
  }
});

test('v4.215.0 A2 底栏从 PM_FACES 渲染', () => {
  assert.ok(/PM_FACES\.map\(/.test(VIEW), '底栏必须从 PM_FACES 渲染');
  assert.ok(!/TABS\.map\(\(t\) => '<button class="pm-tab'/.test(VIEW), '旧 TABS 拼装必须移除');
});

test('v4.215.0 A3 nav role + data-pm-face + aria-current，绑定保留', () => {
  const at = VIEW.indexOf('<nav class="pm-tabbar"');
  assert.ok(at > 0);
  const body = VIEW.slice(at, VIEW.indexOf("'</nav>'", at));
  assert.ok(/role="navigation" aria-label="周期主导航"/.test(body));
  assert.ok(/data-pm-face=/.test(body));
  assert.ok(/aria-current=/.test(body));
  assert.ok(/data-act="tab"/.test(body) && /data-tab=/.test(body));
});

test('v4.215.0 A4 底栏排在 page 之后', () => {
  const at = VIEW.indexOf("const tabs = ['<nav class=\"pm-tabbar\"");
  assert.ok(at > 0);
  const page = VIEW.lastIndexOf('const page =', at);
  assert.ok(page > 0 && page < at);
});

test('v4.215.0 A5 v4.css link 注入投递，无 fixed，热区 48/44，按钮进 @layer', () => {
  assert.ok(/id = 'pm-v4-css'/.test(VIEW));
  assert.ok(/new URL\('\.\/periodmath\.v4\.css', import\.meta\.url\)/.test(VIEW));
  const nav = /\.pm-root > \.pm-tabbar \{[\s\S]*?\}/.exec(CSS);
  assert.ok(nav);
  assert.ok(/flex:\s*0 0 auto/.test(nav[0]));
  assert.ok(!/position:\s*fixed/.test(CSS));
  assert.ok(/min-height:\s*48px/.test(nav[0]));
  const layer = CSS.slice(CSS.indexOf('@layer rp.apps {'));
  assert.ok(/\.pm-tab/.test(layer));
  assert.ok(/min-height:\s*48px/.test(layer) && /min-width:\s*44px/.test(layer));
});

test('v4.215.0 N1 负控制：删 PM_FACES ⇒ A1 转红', () => {
  const broken = VIEW.replace('export const PM_FACES = TABS;', '');
  assert.notEqual(broken, VIEW);
  assert.ok(!/export const PM_FACES\s*=\s*TABS/.test(broken));
});

test('v4.215.0 N2 负控制：删 link 注入 ⇒ A5 转红', () => {
  const broken = VIEW.replace("link.id = 'pm-v4-css';", '');
  assert.notEqual(broken, VIEW);
  assert.ok(!/id = 'pm-v4-css'/.test(broken));
});