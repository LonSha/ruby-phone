/* tests/apps-mood-v4.test.mjs — 心境「照现实」v4.215.0 静态门
 * MOOD_FACES 复用 TABS；底栏一处生成；nav role + data-mood-face + aria-current；
 * DOM 顺序；v4.css link 幂等注入投递；无 fixed / 热区 48/44 / @layer rp.apps；负控制。 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = dirname(HERE);
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const VIEW = read('apps/mood/mood-view.js');
const CSS = read('apps/mood/mood.v4.css').replace(/\/\*[\s\S]*?\*\//g, '');
const countOf = (src, lit) => src.split(lit).length - 1;

test('v4.215.0 A1 MOOD_FACES 是三格单一真源（与 TABS 同引用）', () => {
  assert.ok(/export const MOOD_FACES\s*=\s*TABS/.test(VIEW));
  const i = VIEW.indexOf('const TABS');
  const def = VIEW.slice(i, VIEW.indexOf('];', i) + 2);
  for (const key of ['now', 'axes', 'memory']) {
    assert.ok(def.includes("key: '" + key + "'"), 'TABS/MOOD_FACES 缺格：' + key);
  }
});

test('v4.215.0 A2 底栏一处生成', () => {
  assert.ok(/MOOD_FACES\)/.test(VIEW) || /of MOOD_FACES/.test(VIEW), '底栏必须从 MOOD_FACES 渲染');
  assert.equal(countOf(VIEW, '_tabbarHTML('), 2, '应恰好 2 处（定义+调用）');
});

test('v4.215.0 A3 nav role + data-mood-face + aria-current，绑定语义保留', () => {
  const at = VIEW.indexOf('_tabbarHTML() {');
  const end = VIEW.indexOf('_topbar(', at);
  assert.ok(at > 0 && end > at, '找不到 _tabbarHTML 定义/结束');
  const body = VIEW.slice(at, end);
  assert.ok(/<nav class="mood-tabbar" role="navigation" aria-label="心境主导航">/.test(body));
  assert.ok(/data-mood-face=/.test(body));
  assert.ok(/aria-current=/.test(body));
  assert.ok(/data-act="tab"/.test(body) && /data-tab=/.test(body));
});

test('v4.215.0 A4 底栏排在 .mood-page 之后', () => {
  const at = VIEW.indexOf('this._tabbarHTML()', VIEW.indexOf('_layout('));
  assert.ok(at > 0);
  const page = VIEW.lastIndexOf('+ page', at);
  assert.ok(page > 0 && page < at, '底栏必须在 page 之后');
});

test('v4.215.0 A5 v4.css 由 link 幂等注入投递，无 fixed，热区 48/44，按钮进 @layer rp.apps', () => {
  assert.ok(/id = 'mood-v4-css'/.test(VIEW), '必须有 mood-v4-css link 注入');
  assert.ok(/new URL\('\.\/mood\.v4\.css', import\.meta\.url\)/.test(VIEW), 'link 必须指向 mood.v4.css');
  const nav = /\.mood-root > \.mood-tabbar \{[\s\S]*?\}/.exec(CSS);
  assert.ok(nav, '找不到 .mood-root > .mood-tabbar 规则');
  assert.ok(/flex:\s*0 0 auto/.test(nav[0]));
  assert.ok(!/position:\s*fixed/.test(CSS));
  assert.ok(/min-height:\s*48px/.test(nav[0]));
  const layer = CSS.slice(CSS.indexOf('@layer rp.apps {'));
  assert.ok(/\.mood-tab/.test(layer));
  assert.ok(/min-height:\s*48px/.test(layer) && /min-width:\s*44px/.test(layer));
});

test('v4.215.0 N1 负控制：删 MOOD_FACES ⇒ A1 转红', () => {
  const broken = VIEW.replace('export const MOOD_FACES = TABS;', '');
  assert.notEqual(broken, VIEW);
  assert.ok(!/export const MOOD_FACES\s*=\s*TABS/.test(broken));
});

test('v4.215.0 N2 负控制：删 link 注入 ⇒ A5 转红', () => {
  const broken = VIEW.replace("link.id = 'mood-v4-css';", '');
  assert.notEqual(broken, VIEW);
  assert.ok(!/id = 'mood-v4-css'/.test(broken));
});