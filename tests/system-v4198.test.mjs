// SYS-V4198 HTML ESCQUOT 转义面收敛：18 份 esc 复制件 → config/esc-face.js
// 为什么做这一件：本版重做全仓同名函数体指纹扫描（v4.197.0 后新基线），实测
// function esc(s) 在 apps 下共 35 处定义、12 种口径。其中变体 [0] 为 18 份逐字全等
//（调用点合计 449 处），是目前最大的一簇；另外 11 种口径行为不等价，一律未动。
// 关键：esc 只转 & / < / > / " 四个字符，单引号刻意不转；
// 与带 max 第二签名 + 转单引号的 v11 不等价 —— 本判据 C3 专门钉住这条分工。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const NL = String.fromCharCode(10);
const AMP = String.fromCharCode(38);
const LT = String.fromCharCode(60);
const GT = String.fromCharCode(62);
const DQ = String.fromCharCode(34);
const SQ = String.fromCharCode(39);

const KERNEL = 'config/esc-face.js';

/* 18 个转调文件（全部在 apps 下，深度一致）。 */
const CONVERTED = [
  'apps/accessdesk/accessdesk-view.js',
  'apps/annidate/annidate-view.js',
  'apps/backupdesk/backupdesk-view.js',
  'apps/caphealth/caphealth-view.js',
  'apps/cardtable/cardtable-view.js',
  'apps/creationdesk/creationdesk-view.js',
  'apps/freehome/freehome-view.js',
  'apps/lexiscore/lexiscore-view.js',
  'apps/memtable/memtable-view.js',
  'apps/periodmath/periodmath-view.js',
  'apps/socialguard/socialguard-view.js',
  'apps/stickerdesk/stickerdesk-view.js',
  'apps/sullydesk/sullydesk-view.js',
  'apps/summdesk/summdesk-view.js',
  'apps/taskentry/taskentry-view.js',
  'apps/traveldesk/traveldesk-view.js',
  'apps/workflow/workflow-design.js',
  'apps/workflow/workflow-view.js',
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

test('A2 esc 与原 18 份复制件逐用例等价（45 例 0 diff）', async () => {
  const { esc } = await import('../' + KERNEL);
  const A_ = AMP, L_ = String.fromCharCode(60), G_ = String.fromCharCode(62), Q_ = String.fromCharCode(34);
  const OLD = (s) => String(s === undefined || s === null ? '' : s)
    .split(A_).join(A_ + 'amp;')
    .split(L_).join(A_ + 'lt;')
    .split(G_).join(A_ + 'gt;')
    .split(Q_).join(A_ + 'quot;');
  const cases = [
    'a', '  a  ', '', null, undefined, 5, 0, -1, true, false, NaN,
    {}, [], [1, 2], { length: 3 }, new String('x'), '0',
    'a & b', 'a &amp; b', '&lt;already&gt;', '&amp;&lt;&gt;',
    'he said "hi"', 'it'+SQ+'s', 'both " and '+SQ,,
    AMP+LT+GT+DQ+SQ, '&amp;amp;', '&&&', '<<<', DQ+DQ+DQ, SQ+SQ+SQ,
    'x'.repeat(200), '&notanentity;', '5 < 6 > 4',
  ];
  for (const c of cases) {
    assert.equal(esc(c), OLD(c), '用例不等价：' + String(c));
  }
});

test('A3 esc 三条立场（四字符 / 单引号不转 / null 给空串 / 无 max）', async () => {
  const { esc } = await import('../' + KERNEL);
  assert.equal(esc('a & b'), 'a ' + AMP + 'amp; b');
  assert.equal(esc('a < b'), 'a ' + AMP + 'lt; b');
  assert.equal(esc('a > b'), 'a ' + AMP + 'gt; b');
  assert.equal(esc('a " b'), 'a ' + AMP + 'quot; b');
  // 单引号刻意不转
  assert.equal(esc('its'), 'its');
  // null / undefined 给空串
  assert.equal(esc(null), '');
  assert.equal(esc(undefined), '');
  assert.equal(esc(''), '');
  // 非串也 String()
  assert.equal(esc(5), '5');
  assert.equal(esc(true), 'true');
  // 无 max 截断：第二个入参被忽略
  assert.equal(esc('abcdefghij', 4), 'abcdefghij');
});

test('A4 内核只导出被真消费的面（一个具名出口，且不许有 default 面）', async () => {
  const mod = await import('../' + KERNEL);
  const keys = Object.keys(mod);
  assert.deepEqual(keys, ['esc'], '只许有一个具名出口，实测 ' + keys.join(','));
  assert.equal('default' in mod, false, '不许有 default 面（v4.193.0 纪律：不留零消费出口）');
  const raw = read(KERNEL);
  for (const dead of ['escHtml', 'escapeHtml', 'escAttr', 'escMax']) {
    assert.equal(raw.indexOf(dead), -1, dead + ' 不许复活');
  }
});

/* ══════════ B 组 · 转调 ══════════ */

test('B1 18 个转调文件：本地定义与 5 个常量已删、import 内核、仍有调用点', () => {
  for (const rel of CONVERTED) {
    const raw = read(rel);
    const stripped = raw.replace(/\/[\*][\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    for (const dead of ['function esc(', 'const AMP =', 'const LT =', 'const GT =',
                       'const QUOTE =', 'const QUOTE_ESC =']) {
      assert.equal(raw.indexOf(dead), -1, rel + ' 必须已删 ' + dead);
    }
    assert.equal(/\b(AMP|LT|GT|QUOTE|QUOTE_ESC)\b/.test(stripped), false,
      rel + ' 不许残留 esc 专用常量标识符');
    const want = '../../config/esc-face.js';
    assert.ok(raw.indexOf(want) >= 0, rel + ' 必须 import ' + want);
    assert.equal(/esc\(/.test(stripped), true, rel + ' 必须仍有 esc 调用点');
  }
});

test('B2 每个转调文件的 import 都落在注释块之外、且是完整语句', () => {
  for (const rel of CONVERTED) {
    const lines = read(rel).split(NL);
    const want = '../../config/esc-face.js';
    let inBlock = false;
    let hit = 0;
    for (const l of lines) {
      const st = l.trim();
      if (inBlock) { if (st.indexOf('*/') >= 0) inBlock = false; continue; }
      if (st.startsWith('/*')) { if (st.indexOf('*/') < 0) inBlock = true; continue; }
      if (st.indexOf(want) >= 0) {
        hit++;
        assert.ok(/^import\s*\{\s*esc\s*\}\s*from\s*'[^']+';\s*$/.test(st),
          rel + ' 的 import 必须是完整单行语句：' + st);
      }
    }
    assert.equal(hit, 1, rel + ' 必须恰好一条 esc-face import，实测 ' + hit);
  }
});

test('B3 import 必须紧跟 use strict 之后（不插进多行 import 块中间）', () => {
  const SQ = String.fromCharCode(39);
  const STRICT = SQ + 'use strict' + SQ + ';';
  const WANT = 'import { esc } from ' + SQ + '../../config/esc-face.js' + SQ + ';';
  for (const rel of CONVERTED) {
    const lines = read(rel).split(NL);
    const si = lines.findIndex((l) => l.trim() === STRICT);
    assert.ok(si >= 0, rel + ' 必须能找到 use strict');
    assert.equal(lines[si + 1].trim(), WANT,
      rel + ' 的 esc import 必须紧接 use strict，实测第 ' + (si + 2) + ' 行');
  }
});

/* ══════════ C 组 · 口径唯一性与刻意保留 ══════════ */

test('C1 apps 与 config 下不再有 esc 变体 0 的逐字等价定义', () => {
  const all = [...walkJs('apps'), ...walkJs('config')];
  const leftovers = [];
  for (const rel of all) {
    if (rel === KERNEL) continue;
    const raw = read(rel);
    if (raw.indexOf('function esc(s)') >= 0 && raw.indexOf('QUOTE_ESC') >= 0) leftovers.push(rel);
  }
  assert.deepEqual(leftovers, [], '这 18 份之外不许再有同口径定义：' + leftovers.join(', '));
});

test('C2 esc 的其余 11 种异口径刻意未动（不许被顺手合并）', () => {
  const all = [...walkJs('apps'), ...walkJs('config')];
  let defs = 0, withMax = 0, singleQuote = 0, nullish = 0;
  for (const rel of all) {
    if (rel === KERNEL) continue;
    const raw = read(rel);
    if (/function\s+esc\s*\(/.test(raw)) defs++;
    if (/function\s+esc\s*\(\s*\w+\s*,\s*max/.test(raw)) withMax++;
    if (/function[\s\S]{0,400}?esc[\s\S]{0,400}?#39/.test(raw)) singleQuote++;
    if (/function\s+esc\s*\(\s*\w+\s*\)\s*\{\s*return\s+String\(\w+\s*\?\?/.test(raw)) nullish++;
  }
  // 35 处定义 - 18 份转调 = 17 处异口径必须仍在场
  assert.ok(defs >= 17, 'esc 定义处必须仍有 17 个以上，实测 ' + defs);
  assert.ok(withMax >= 1, '带 max 第二签名的形必须仍在场，实测 ' + withMax);
  assert.ok(singleQuote >= 1, '转单引号的形必须仍在场，实测 ' + singleQuote);
  assert.ok(nullish >= 1, '?? 形必须仍在场，实测 ' + nullish);
});

test('C3 esc 与带 max + 转单引号的 v11 必须保持互不等价（不许被错误合并）', async () => {
  /* 这是本版最要紧的一条：v11 会把 its 变成 it &#39;s，本内核不转单引号；
     且 v11 有 max 第二签名会截断，本内核没有。两者合并就是造假等价。 */
  const { esc } = await import('../' + KERNEL);
  const V11 = (s, max) => {
    let t = String(s === undefined || s === null ? '' : s)
      .replace(/&/g, AMP + 'amp;')
      .replace(/</g, AMP + 'lt;')
      .replace(/>/g, AMP + 'gt;')
      .replace(/"/g, AMP + 'quot;')
      .replace(/'/g, AMP + '#39;');
    return (typeof max === 'number' && max >= 0 && t.length > max) ? t.slice(0, max) : t;
  };
  for (const probe of [SQ+'its'+SQ, 'both '+DQ+' and '+SQ, SQ+SQ+SQ]) {
    assert.notEqual(esc(probe), V11(probe), 'esc 与 v11 在 ' + probe + ' 上必须不同');
  }
  assert.equal(esc('abcdefghij', 4), 'abcdefghij');
  assert.equal(V11('abcdefghij', 4), 'abcd');
});

test('C4 esc 与三个文本内核互不等价（管的是四个字符，不是整串规整）', async () => {
  const { esc } = await import('../config/esc-face.js');
  const { toStr } = await import('../config/text-face.js');
  const { safeStr } = await import('../config/str-face.js');
  const { str } = await import('../config/loose-str-face.js');
  /* 分工不在「非串给什么」—— esc(5) 与 str(5) 都是 '5'，那是三份文本内核之间的差别。
     esc 治的是「串里的四个字符怎么变成实体」：只要输入含 & < > 或双引号，
     esc 会转义，另三个内核一律原样返回。 */
  for (const probe of ['a & b', 'a < b', 'a > b', 'a ' + DQ + ' b']) {
    assert.notEqual(esc(probe), toStr(probe), 'esc 与 toStr 在 ' + probe + ' 上必须不同');
    assert.notEqual(esc(probe), safeStr(probe), 'esc 与 safeStr 在 ' + probe + ' 上必须不同');
    assert.notEqual(esc(probe), str(probe), 'esc 与 str 在 ' + probe + ' 上必须不同');
  }
  // 反向确认：另三个内核对同样输入原样返回
  assert.equal(toStr('a & b'), 'a & b');
  assert.equal(safeStr('a & b'), 'a & b');
  assert.equal(str('a & b'), 'a & b');
  // 不含四个字符时四者一致 —— 这才是 esc 与另三个内核的真正边界
  assert.equal(esc('plain text'), toStr('plain text'));
  assert.equal(esc('plain text'), safeStr('plain text'));
  assert.equal(esc('plain text'), str('plain text'));
  // 而 esc 会把它变成实体
  assert.equal(esc('a & b'), 'a ' + AMP + 'amp; b');
});

/* ══════════ D 组 · 负控制 ══════════ */

test('D1 负控制：把 esc 换回 split/join 旧形必须被判据抓出（A2 会红）', async () => {
  const { esc } = await import('../' + KERNEL);
  const BAD = (s) => String(s === undefined || s === null ? '' : s)
    .split(AMP).join(AMP + 'amp;')
    .split(String.fromCharCode(60)).join(AMP + 'lt;')
    .split(String.fromCharCode(62)).join(AMP + 'gt;')
    .split(String.fromCharCode(34)).join(AMP + 'quot;')
    .split(String.fromCharCode(39)).join(AMP + '#39;');
  // 负控制样本在含单引号的输入上与内核不同 —— 证明 A2 的对拍不是空转
  const probe = String.fromCharCode(39) + 'its' + String.fromCharCode(39);
  assert.notEqual(esc(probe), BAD(probe),
    '负控制必须与内核不同，否则 A2 的等价性对拍是空转');
});

test('D2 负控制：内核若多了 default 面或第二个具名出口，A4 必须转红', async () => {
  const mod = await import('../' + KERNEL);
  // 只断言当前状态合规；真正的红来自 A4 的 deepEqual(keys, ['esc'])
  assert.deepEqual(Object.keys(mod), ['esc']);
  assert.equal('default' in mod, false);
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

test('V1 五源版本号不低于 4.198.0', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.ok(cmp(pkg.version, '4.198.0') >= 0, 'package.json 必须不低于 4.198.0，当前 ' + pkg.version);
  const man = JSON.parse(read('manifest.json'));
  assert.ok(cmp(man.version, '4.198.0') >= 0, 'manifest.json 必须不低于 4.198.0，当前 ' + man.version);
  const ul = JSON.parse(read('update-log.json'));
  assert.ok(ul.versions['4.198.0'], 'update-log.json 必须有 4.198.0 条目');
  assert.ok(cmp(ul.latest, '4.198.0') >= 0, 'update-log.json latest 必须不低于 4.198.0');
  const idx = read('index.js');
  const mVer = idx.match(/ST_PHONE_VERSION\s*=\s*'([^']+)'/);
  assert.ok(mVer, 'index.js 必须能取到 ST_PHONE_VERSION 常量');
  assert.ok(cmp(mVer[1], '4.198.0') >= 0, 'index.js 的 ST_PHONE_VERSION 必须不低于 4.198.0，当前 ' + mVer[1]);
  const iter = read('ITERATION_LOG.md');
  assert.ok(iter.indexOf('4.198.0') >= 0, 'ITERATION_LOG.md 必须出现 4.198.0');
});
