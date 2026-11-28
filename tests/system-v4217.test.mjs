/* ============================================================
 * tests/system-v4217.test.mjs — 设计系统 CSS「真的能加载」的守门
 * ------------------------------------------------------------
 * 起因（真机报障，不是推测）：
 *   用户在真手机上看到「背景黑的烂的、UI 不是 iOS 26/27」，而单元判据全绿。
 *   根因之一：整份旧 UI 样式（19945 行）靠 rp-entry.css 的 @import 链加载。
 *   @import 写错一个相对路径，浏览器**静默失败**，不报错、不抛异常、
 *   单元测试也看不到 —— 页面只剩零散规则，看起来就是「黑的、烂的」。
 *
 * 这组断言只做一件事：把「样式表链路」当成可复算的事实来钉。
 *   ① 每条 @import 指向的文件必须真实存在（相对路径按被导入文件所在目录解析）
 *   ② @import 必须出现在所有非 @import / 非 @layer 语句之前
 *      （CSS 规范硬要求，一旦违反，后面的 @import 全被浏览器丢弃）
 *   ③ 几何兜底层 rp-home-fix.css 必须被 @import，且必须落在 rp.components 层
 *      （层序里 rp.components 晚于 rp.legacy，才能压过被摘掉 !important 的老规则）
 *   ④ layer 语句必须把 rp.components 排在 rp.legacy 之后
 *   ⑤ 一页容量恒为 列数×5（桌面 15 格在任何宽度都只占 1 页）
 * ============================================================ */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ENTRY_REL = 'phone/design/rp-entry.css';
const ENTRY = path.join(ROOT, ENTRY_REL);
const read = (p) => fs.readFileSync(p, 'utf8');
const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');

const IMPORT_RE = /@import\s+url\(\s*["']?([^"')]+)["']?\s*\)([^;]*);/g;

function importsOf(cssText) {
  const body = stripComments(cssText);
  const out = [];
  let m;
  IMPORT_RE.lastIndex = 0;
  while ((m = IMPORT_RE.exec(body)) !== null) {
    out.push({ href: m[1], tail: m[2].trim(), at: m.index, raw: m[0] });
  }
  return out;
}

function walkImports(fileAbs, seen, missing, depth = 0) {
  const rel = path.relative(ROOT, fileAbs).split(path.sep).join('/');
  if (seen.has(rel)) return;
  seen.add(rel);
  if (!fs.existsSync(fileAbs)) {
    missing.push(rel);
    return;
  }
  for (const imp of importsOf(read(fileAbs))) {
    const href = imp.href.split('?')[0];
    if (/^https?:/i.test(href) || href.startsWith('data:')) continue;
    const target = path.resolve(path.dirname(fileAbs), href);
    const targetRel = path.relative(ROOT, target).split(path.sep).join('/');
    if (!fs.existsSync(target)) {
      missing.push(targetRel + '  (from ' + rel + ')');
      continue;
    }
    if (depth < 3) walkImports(target, seen, missing, depth + 1);
  }
}

test('v4217 CSS-1. rp-entry.css 的整条 @import 链上每个文件都必须真实存在', () => {
  const seen = new Set();
  const missing = [];
  walkImports(ENTRY, seen, missing);
  assert.deepEqual(missing, [], '@import 链上有不存在的文件（浏览器静默丢弃，真机表现为「样式全丢」）');
  assert.ok(seen.size >= 20, '样例数异常：链上只走到 ' + seen.size + ' 个文件，可能 @import 解析断了');
});

test('v4217 CSS-2. 每条 @import 必须位于所有普通规则之前', () => {
  const body = stripComments(read(ENTRY));
  const imps = importsOf(body);
  assert.ok(imps.length > 0, '入口文件里没有任何 @import');
  for (const imp of imps) {
    const before = body.slice(0, imp.at);
    assert.equal(before.search(/@layer\s+[\w.\-\s,]+\{/), -1, '@import 之前出现 @layer 块，其后 @import 会被丢弃');
    /* 先剔掉 @import 与 @layer 语句本身，再看剩下有没有普通规则 */
    const stray = before.replace(IMPORT_RE, '').replace(/@(charset|layer)[^;{}]*;/g, '').trim();
    assert.equal(stray, '', '@import 之前出现普通规则或声明：' + stray.slice(0, 120));
  }
});

test('v4217 CSS-3. 几何兜底层必须被加载，且落在 rp.components 层', () => {
  const entry = stripComments(read(ENTRY));
  const imp = importsOf(entry).find((i) => i.href.includes('rp-home-fix.css'));
  assert.ok(imp, 'rp-entry.css 没有 @import rp-home-fix.css —— 桌面与 dock 的几何兜底会整层消失');
  assert.match(imp.tail, /layer\(\s*rp\.components\s*\)/, 'rp-home-fix.css 必须以 layer(rp.components) 导入，否则压不过 legacy 层');

  const fixRel = 'phone/design/rp-home-fix.css';
  assert.ok(fs.existsSync(path.join(ROOT, fixRel)), 'rp-home-fix.css 不存在');
  const fix = stripComments(read(path.join(ROOT, fixRel)));
  assert.match(fix, /@layer\s+rp\.components\s*\{/, 'rp-home-fix.css 内容必须包在 @layer rp.components 里');
  assert.match(fix, /\.home-screen\.home-layout-icons\s*\{[^}]*padding-bottom:\s*146px/, 'home-screen 必须留 146px 的 dock 净空');
  assert.match(fix, /\.app-grid-pager\s*\{[^}]*overflow-y:\s*auto/, '矮屏必须让图标区可纵向滚动，而不是溢出压住 dock');
});

test('v4217 CSS-4. layer 语句里 rp.components 必须排在 rp.legacy 之后', () => {
  const entry = stripComments(read(ENTRY));
  const m = entry.match(/@layer\s+([^;]+);/);
  assert.ok(m, '缺顶层 @layer 层序语句');
  const order = m[1].split(',').map((s) => s.trim());
  const li = order.indexOf('rp.legacy');
  const ci = order.indexOf('rp.components');
  assert.ok(li >= 0 && ci >= 0, '层序里必须同时有 rp.legacy 与 rp.components');
  assert.ok(ci > li, 'rp.components 必须排在 rp.legacy 之后（右边赢左边），否则兜底层压不过旧样式');
});

test('v4217 CSS-5. 一页容量恒为 列数×5（桌面 15 格在任何宽度都只占 1 页）', () => {
  const HOME = read(path.join(ROOT, 'phone/home-screen.js'));
  const at = HOME.indexOf('getIconPageCapacity(');
  assert.ok(at > 0, 'getIconPageCapacity 未找到');
  const body = HOME.slice(at, at + 1200);
  assert.match(body, /const\s+perPage\s*=\s*columns\s*\*\s*5/, '一页容量必须写成 列数×5 的单一真源');
  assert.match(body, /return\s+perPage/, '默认路径必须直接返回 perPage（不得再按屏幕高度分档）');
  const fallback = body.slice(body.indexOf('if (need > perPage)'));
  assert.ok(fallback.indexOf('h <= 660') > 0, '断点表必须只出现在 need > perPage 的兜底分支里');
});