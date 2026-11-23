// SYS-V4196 字符串规整读取面收敛：15 份 safeStr 复制件 → config/str-face.js
// 为什么做这一件：本版重做全仓同名函数体指纹扫描（v4.195.0 后新基线），实测
// `function safeStr(v) { return (typeof v === 'string') ? v.trim() : ''; }` 在
// apps 与 config 里有 **15 份逐字相同**（1 变体），调用点约 166 处。
// 与 text-face.js 的唯一差别是 trim；另 3 种口径（fallback 形 11 份 / 宽口径 9 份 /
// 空串也走 fallback 的严格形 1 份）刻意未动。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const NL = String.fromCharCode(10);

const KERNEL = 'config/str-face.js';

/* 15 个转调文件（apps 1 + config 14）。 */
const CONVERTED = [
  'apps/wallet/economy-store.js',
  'config/action-receipt.js',
  'config/action-stack.js',
  'config/auth-expiration.js',
  'config/character-dwelling.js',
  'config/economy-face-bridge.js',
  'config/intent-relay.js',
  'config/living-assets.js',
  'config/recovery-hub.js',
  'config/response-cadence.js',
  'config/resume-anchor.js',
  'config/rule-theatre.js',
  'config/theme-pack.js',
  'config/urban-economy.js',
  'config/usage-paradigm.js',
];

/* ══════════ A 组 · 内核纯度与等价性 ══════════ */

test('A1 内核源码面零副作用、零类、不自己取随机与时钟', () => {
  const raw = read(KERNEL);
  for (const bad of ['Math.random', 'Date.now', 'class ', 'this.', 'localStorage',
                     'window.', 'document.', 'fetch(', 'import.meta.url']) {
    assert.equal(raw.indexOf(bad), -1, KERNEL + ' 不许出现 ' + bad);
  }
});

test('A2 safeStr 与原 15 份复制件逐用例等价（18 例 0 diff）', async () => {
  const { safeStr } = await import('../' + KERNEL);
  const OLD = (v) => (typeof v === 'string') ? v.trim() : '';
  const cases = [
    'hello', '  pad  ', String.fromCharCode(9) + 'tab' + String.fromCharCode(10), '',
    null, undefined, 5, true, 0, NaN, {}, [], [1, 2], { length: 3 }, '   ', 'a b',
    new String('x'), 'ok',
  ];
  for (const c of cases) {
    assert.deepEqual(safeStr(c), OLD(c), '用例不等价：' + String(c));
  }
});

test('A3 safeStr 三条立场（只收字符串 / trim 在内 / 空串不是兜底值）', async () => {
  const { safeStr } = await import('../' + KERNEL);
  // ① 只收字符串：非串（含数字/布尔/对象/类数组）一律空串
  assert.equal(safeStr(5), '');
  assert.equal(safeStr(true), '');
  assert.equal(safeStr({}), '');
  assert.equal(safeStr({ length: 3 }), '');
  assert.equal(safeStr(['a']), '');
  // ② trim 在本口径之内（这是与 toStr 的唯一差别）
  assert.equal(safeStr('  x  '), 'x');
  assert.equal(safeStr('  x  '.trim()), 'x');
  // ③ 空串是如实回答，不是兜底值：空串输入给空串，纯空白也给空串
  assert.equal(safeStr(''), '');
  assert.equal(safeStr('   '), '');
});

test('A4 内核只导出被真消费的面（一个具名出口，且不许有 default 面）', async () => {
  const mod = await import('../' + KERNEL);
  const keys = Object.keys(mod);
  assert.deepEqual(keys, ['safeStr'], '只许有一个具名出口，实测 ' + keys.join(','));
  assert.equal('default' in mod, false, '不许有 default 面（v4.193.0 纪律：不留零消费出口）');
  const raw = read(KERNEL);
  for (const dead of ['safeStrLoose', 'strOr', 'safeTrim', 'trimmed']) {
    assert.equal(raw.indexOf(dead), -1, dead + ' 不许复活');
  }
});

/* ══════════ B 组 · 转调 ══════════ */

test('B1 15 个转调文件：本地定义已删、import 内核、仍有调用点', () => {
  for (const rel of CONVERTED) {
    const raw = read(rel);
    const stripped = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    // 定义已删
    assert.equal(/function\s+safeStr\s*\(/.test(stripped), false,
      rel + ' 的 safeStr 本地定义必须已删');
    // import 在场
    const want = rel.startsWith('config/') ? './str-face.js' : '../../config/str-face.js';
    assert.ok(raw.indexOf(want) >= 0, rel + ' 必须 import ' + want);
    // 仍有调用点（不是删了没人用的死定义）
    assert.equal(/safeStr\s*\(/.test(stripped), true, rel + ' 必须仍有 safeStr 调用点');
  }
});

test('B2 每个转调文件的 import 都落在注释块之外、且是完整语句', () => {
  for (const rel of CONVERTED) {
    const lines = read(rel).split(NL);
    const want = rel.startsWith('config/') ? './str-face.js' : '../../config/str-face.js';
    let inBlock = false;
    let hit = 0;
    for (const l of lines) {
      const st = l.trim();
      if (inBlock) { if (st.indexOf('*/') >= 0) inBlock = false; continue; }
      if (st.startsWith('/*')) { if (st.indexOf('*/') < 0) inBlock = true; continue; }
      if (st.indexOf(want) >= 0) {
        hit++;
        assert.ok(/^import\s*\{\s*safeStr\s*\}\s*from\s*'[^']+';\s*$/.test(st),
          rel + ' 的 import 必须是完整单行语句（v4.196.0 踩过：插进多行 import 块中间会被截断）：' + st);
      }
    }
    assert.equal(hit, 1, rel + ' 必须恰好一条 str-face import，实测 ' + hit);
  }
});

/* ══════════ C 组 · 口径唯一性与刻意保留 ══════════ */

test('C1 apps 与 config 下不再有 safeStr 逐字等价定义', () => {
  const walk = (d) => {
    const out = [];
    for (const e of fs.readdirSync(path.join(ROOT, d), { withFileTypes: true })) {
      if (e.isDirectory()) out.push(...walk(d + '/' + e.name));
      else if (e.name.endsWith('.js')) out.push(d + '/' + e.name);
    }
    return out;
  };
  const all = [...walk('apps'), ...walk('config')];
  const leftovers = [];
  for (const rel of all) {
    if (rel === KERNEL) continue; // 内核自身就是这条口径的唯一实现，不是残留复制件
    const raw = read(rel);
    if (raw.indexOf("function safeStr(v) { return (typeof v === 'string') ? v.trim() : ''; }") >= 0) {
      leftovers.push(rel);
    }
  }
  assert.deepEqual(leftovers, [], '这 15 份之外不许再有同口径定义：' + leftovers.join(', '));
});

test('C2 三种不同口径刻意未动（fallback 形 / 宽口径 / 空串也走 fallback）', () => {
  const walk = (d) => {
    const out = [];
    for (const e of fs.readdirSync(path.join(ROOT, d), { withFileTypes: true })) {
      if (e.isDirectory()) out.push(...walk(d + '/' + e.name));
      else if (e.name.endsWith('.js')) out.push(d + '/' + e.name);
    }
    return out;
  };
  const all = [...walk('apps'), ...walk('config')];
  let fb = 0, wide = 0, strictFb = 0;
  for (const rel of all) {
    const raw = read(rel);
    if (/function\s+safeStr\s*\(\s*val\s*,\s*fallback/.test(raw)) fb++;
    if (raw.indexOf("function safeStr(v) { return String(v == null ? '' : v).trim(); }") >= 0) wide++;
    if (/function\s+safeStr\s*\(\s*val\s*,\s*fallback[^)]*\)\s*\{\s*return\s*\(typeof val === 'string' && val\.trim\(\)\.length > 0\)/.test(raw)) strictFb++;
  }
  assert.ok(fb >= 11, 'fallback 形必须仍在场（实测 ' + fb + '）');
  assert.ok(wide >= 9, '宽口径必须仍在场（实测 ' + wide + '）');
  assert.ok(strictFb >= 1, '空串也走 fallback 的严格形必须仍在场（实测 ' + strictFb + '）');
});

/* ══════════ V 组 · 版本锚 ══════════ */

function cmp(a, b) {
  const pa = String(a).split('.').map(Number);
  const pb = String(b).split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] || 0, y = pb[i] || 0;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

test('V1 五源版本号不低于 4.196.0', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.ok(cmp(pkg.version, '4.196.0') >= 0, 'package.json 必须不低于 4.196.0，当前 ' + pkg.version);
  const man = JSON.parse(read('manifest.json'));
  assert.ok(cmp(man.version, '4.196.0') >= 0, 'manifest.json 必须不低于 4.196.0，当前 ' + man.version);
  const ul = JSON.parse(read('update-log.json'));
  assert.ok(ul.versions['4.196.0'], 'update-log.json 必须有 4.196.0 条目');
  assert.ok(cmp(ul.latest, '4.196.0') >= 0, 'update-log.json latest 必须不低于 4.196.0');
  const idx = read('index.js');
  const mVer = idx.match(/ST_PHONE_VERSION\s*=\s*'([^']+)'/);
  assert.ok(mVer, 'index.js 必须能取到 ST_PHONE_VERSION 常量');
  assert.ok(cmp(mVer[1], '4.196.0') >= 0, 'index.js 的 ST_PHONE_VERSION 必须不低于 4.196.0，当前 ' + mVer[1]);
  const iter = read('ITERATION_LOG.md');
  assert.ok(iter.indexOf('4.196.0') >= 0, 'ITERATION_LOG.md 必须出现 4.196.0');
});
