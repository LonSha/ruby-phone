// SYS-V4197 宽松文本规整面收敛：24 份 str 复制件 → config/loose-str-face.js
// 为什么做这一件：本版重做全仓同名函数体指纹扫描（v4.196.0 后新基线），实测
// `function str(v) { return String(v == null ? '' : v).trim(); }` 在 apps 与 config 里有
// **24 份逐字相同**（1 变体），调用点合计 449 处 —— 目前最大的一簇。
// 关键：str 与 toStr / safeStr **不等价**（非串时 str 给 '5'，另两个给 ''），
// 所以必须独立成第三个内核，不许合并 —— 本判据 C3 专门钉住这条分工。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const NL = String.fromCharCode(10);

const KERNEL = 'config/loose-str-face.js';
const DEF = "function str(v) { return String(v == null ? '' : v).trim(); }";

/* 24 个转调文件（apps 1 + config 23）。 */
const CONVERTED = [
  'apps/reading/reading-attachment.js',
  'config/affair-state.js',
  'config/branch-canon-contract.js',
  'config/causal-board-contract.js',
  'config/comm-thread.js',
  'config/consume-once.js',
  'config/gathering-plan.js',
  'config/goal-tree-contract.js',
  'config/group-vote-contract.js',
  'config/item-custody-contract.js',
  'config/library-backup.js',
  'config/material-board-contract.js',
  'config/material-board-handoff.js',
  'config/memory-ask-thread.js',
  'config/perspective-card-contract.js',
  'config/perspective-contrast-contract.js',
  'config/presence-band-contract.js',
  'config/recurrence-contract.js',
  'config/relation-album-contract.js',
  'config/rumor-source-contract.js',
  'config/setting-rewrite-contract.js',
  'config/share-fragment.js',
  'config/shared-past-contract.js',
  'config/topic-dossier-contract.js',
];

const walkJs = (d) => {
  const out = [];
  for (const e of fs.readdirSync(path.join(ROOT, d), { withFileTypes: true })) {
    if (e.isDirectory()) out.push(...walkJs(d + '/' + e.name));
    else if (e.name.endsWith('.js')) out.push(d + '/' + e.name);
  }
  return out;
};

/* ══════════ A 组 · 内核纯度与等价性 ══════════ */

test('A1 内核源码面零副作用、零类、不自己取随机与时钟', () => {
  const raw = read(KERNEL);
  for (const bad of ['Math.random', 'Date.now', 'class ', 'this.', 'localStorage',
                     'window.', 'document.', 'fetch(', 'import.meta.url']) {
    assert.equal(raw.indexOf(bad), -1, KERNEL + ' 不许出现 ' + bad);
  }
});

test('A2 str 与原 24 份复制件逐用例等价（19 例 0 diff）', async () => {
  const { str } = await import('../' + KERNEL);
  const OLD = (v) => String(v == null ? '' : v).trim();
  const cases = [
    'a', '  a  ', '', null, undefined, 5, 0, -1, true, false, NaN,
    {}, [], [1, 2], { length: 3 }, '  ', 'a b', new String('x'), '0',
  ];
  for (const c of cases) {
    assert.deepEqual(str(c), OLD(c), '用例不等价：' + String(c));
  }
});

test('A3 str 三条立场（宽松 / trim 在内 / 空串是如实回答）', async () => {
  const { str } = await import('../' + KERNEL);
  // ① 宽松：非串也 String() 成串 —— 这是与 toStr/safeStr 的唯一差别
  assert.equal(str(5), '5');
  assert.equal(str(true), 'true');
  assert.equal(str(0), '0');
  // ② trim 在本口径之内
  assert.equal(str('  x  '), 'x');
  // ③ null/undefined 给空串（不是 'null'/'undefined'）
  assert.equal(str(null), '');
  assert.equal(str(undefined), '');
  assert.equal(str(''), '');
});

test('A4 内核只导出被真消费的面（一个具名出口，且不许有 default 面）', async () => {
  const mod = await import('../' + KERNEL);
  const keys = Object.keys(mod);
  assert.deepEqual(keys, ['str'], '只许有一个具名出口，实测 ' + keys.join(','));
  assert.equal('default' in mod, false, '不许有 default 面（v4.193.0 纪律：不留零消费出口）');
  const raw = read(KERNEL);
  for (const dead of ['strLoose', 'strOr', 'safeText', 'toText']) {
    assert.equal(raw.indexOf(dead), -1, dead + ' 不许复活');
  }
});

/* ══════════ B 组 · 转调 ══════════ */

test('B1 24 个转调文件：本地定义已删、import 内核、仍有调用点', () => {
  for (const rel of CONVERTED) {
    const raw = read(rel);
    const stripped = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    assert.equal(raw.indexOf(DEF), -1, rel + ' 的 str 本地定义必须已删');
    const want = rel.startsWith('config/') ? './loose-str-face.js' : '../../config/loose-str-face.js';
    assert.ok(raw.indexOf(want) >= 0, rel + ' 必须 import ' + want);
    assert.equal(/str\s*\(/.test(stripped), true, rel + ' 必须仍有 str 调用点');
  }
});

test('B2 每个转调文件的 import 都落在注释块之外、且是完整语句', () => {
  for (const rel of CONVERTED) {
    const lines = read(rel).split(NL);
    const want = rel.startsWith('config/') ? './loose-str-face.js' : '../../config/loose-str-face.js';
    let inBlock = false;
    let hit = 0;
    for (const l of lines) {
      const st = l.trim();
      if (inBlock) { if (st.indexOf('*/') >= 0) inBlock = false; continue; }
      if (st.startsWith('/*')) { if (st.indexOf('*/') < 0) inBlock = true; continue; }
      if (st.indexOf(want) >= 0) {
        hit++;
        assert.ok(/^import\s*\{\s*str\s*\}\s*from\s*'[^']+';\s*$/.test(st),
          rel + ' 的 import 必须是完整单行语句（v4.196.0 踩过：插进多行 import 块中间会被截断）：' + st);
      }
    }
    assert.equal(hit, 1, rel + ' 必须恰好一条 loose-str-face import，实测 ' + hit);
  }
});

/* ══════════ C 组 · 口径唯一性与刻意保留 ══════════ */

test('C1 apps 与 config 下不再有 str 逐字等价定义', () => {
  const all = [...walkJs('apps'), ...walkJs('config')];
  const leftovers = [];
  for (const rel of all) {
    if (rel === KERNEL) continue; // 内核自身是唯一实现，不是残留复制件
    if (read(rel).indexOf(DEF) >= 0) leftovers.push(rel);
  }
  assert.deepEqual(leftovers, [], '这 24 份之外不许再有同口径定义：' + leftovers.join(', '));
});

test('C2 str 的 10 种异口径刻意未动（不 trim 形 / max 截断形 / ?? 形等）', () => {
  const all = [...walkJs('apps'), ...walkJs('config')];
  let noTrim = 0, maxCut = 0;
  for (const rel of all) {
    if (rel === KERNEL) continue;
    const raw = read(rel);
    // 不 trim 形：v == null ? '' : String(v)
    if (/function\s+str\s*\(\s*v\s*\)\s*\{\s*return\s+v == null \? '' : String\(v\);\s*\}/.test(raw)) noTrim++;
    // max 截断形
    if (/function\s+str\s*\(\s*v\s*,\s*max/.test(raw)) maxCut++;
  }
  assert.ok(noTrim >= 9, '不 trim 形必须仍在场（实测 ' + noTrim + '）');
  assert.ok(maxCut >= 3, 'max 截断形必须仍在场（实测 ' + maxCut + '）');
});

test('C3 str 与 toStr / safeStr 必须保持互不等价（不许被错误合并）', async () => {
  /* 这是本版最要紧的一条：三份内核治的是三个**不同**口径。
     · toStr   = 严格 + 不 trim：非串给 ''，字符串原文不动
     · safeStr = 严格 + trim   ：非串给 ''
     · str     = 宽松 + trim   ：非串也 String() 成串
     若有人把 str 并进 safeStr（或反向），449 个调用点的显示会集体变形。 */
  const { str } = await import('../config/loose-str-face.js');
  const { toStr } = await import('../config/text-face.js');
  const { safeStr } = await import('../config/str-face.js');
  for (const probe of [5, 0, -1, true, false, {}, [1, 2], { length: 3 }]) {
    assert.notEqual(str(probe), toStr(probe), 'str 与 toStr 在 ' + String(probe) + ' 上必须不同');
    assert.notEqual(str(probe), safeStr(probe), 'str 与 safeStr 在 ' + String(probe) + ' 上必须不同');
  }
  // trim 分工：只有 toStr 不 trim
  assert.equal(toStr('  x  '), '  x  ');
  assert.equal(str('  x  '), 'x');
  assert.equal(safeStr('  x  '), 'x');
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

test('V1 五源版本号不低于 4.197.0', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.ok(cmp(pkg.version, '4.197.0') >= 0, 'package.json 必须不低于 4.197.0，当前 ' + pkg.version);
  const man = JSON.parse(read('manifest.json'));
  assert.ok(cmp(man.version, '4.197.0') >= 0, 'manifest.json 必须不低于 4.197.0，当前 ' + man.version);
  const ul = JSON.parse(read('update-log.json'));
  assert.ok(ul.versions['4.197.0'], 'update-log.json 必须有 4.197.0 条目');
  assert.ok(cmp(ul.latest, '4.197.0') >= 0, 'update-log.json latest 必须不低于 4.197.0');
  const idx = read('index.js');
  const mVer = idx.match(/ST_PHONE_VERSION\s*=\s*'([^']+)'/);
  assert.ok(mVer, 'index.js 必须能取到 ST_PHONE_VERSION 常量');
  assert.ok(cmp(mVer[1], '4.197.0') >= 0, 'index.js 的 ST_PHONE_VERSION 必须不低于 4.197.0，当前 ' + mVer[1]);
  const iter = read('ITERATION_LOG.md');
  assert.ok(iter.indexOf('4.197.0') >= 0, 'ITERATION_LOG.md 必须出现 4.197.0');
});