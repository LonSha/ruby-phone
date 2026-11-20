/**
 * tests/r26_o8_theme_hardcode.test.mjs — 私有硬编码色板清零判据 [R26-O8]
 *
 * A1 扫描只认字面量颜色（hex / rgb / hsl），`var(--token)` 不算
 * A2 扫描带行号，能定位到具体一行
 * A3 豁免逐条对拍：登记过的进 allowed，没登记进 remaining，ok 只在 remaining=0 时真
 * A4 失效豁免单独列（登记了但代码里已经没有这个色）
 * A5 豁免项必须写明 file 与 value，否则抛错
 * A6 真仓：扫描面成规模，且读数自洽（total = allowed + remaining）
 * A7 真仓：文案如实报「仍有残留 N 处」并点名前几处
 * A8 自检为绿
 * A9 产品面接线：index.js 挂载 + 自检进总表
 * N1 破坏副本：不区分 var() ⇒ 令牌被当成硬编码（豁免表全部失效）
 * N2 破坏副本：remaining 一律清空 ⇒ 残留被藏成 0（假清零）
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  COLOR_PATTERNS,
  auditThemeHardcode,
  scanHardcodedColors,
  themeHardcodeSelfCheck,
  themeHardcodeText,
} from '../config/theme-hardcode.js';

const ROOT = path.resolve(new URL('.', import.meta.url).pathname, '..');
const SOURCE = fs.readFileSync(path.join(ROOT, 'config', 'theme-hardcode.js'), 'utf8');

const SRC = {
  'apps/a/style.css': 'body { color: #fff; background: var(--bg); }\n.x { border: 1px solid rgba(0,0,0,.2); }\n',
  'apps/b/theme.js': "export const ACCENT = '#FF00AA';\nconst t = 'hsl(210, 50%, 40%)';\n",
};

function readTree(dir) {
  const out = [];
  for (const name of fs.readdirSync(dir).sort()) {
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) out.push(...readTree(p));
    else if (/\.(css|js|html)$/.test(name)) out.push(p);
  }
  return out;
}

/** 真仓现场：扫 apps/ 下的样式与脚本。 */
const REPO = (() => {
  const sources = {};
  for (const f of readTree(path.join(ROOT, 'apps'))) {
    sources[path.relative(ROOT, f)] = fs.readFileSync(f, 'utf8');
  }
  return scanHardcodedColors(sources);
})();

test('A1 只认字面量颜色，var() 不算', () => {
  assert.deepEqual(COLOR_PATTERNS.map((p) => p.id), ['hex', 'rgb', 'hsl']);
  const scan = scanHardcodedColors(SRC);
  assert.equal(scan.total, 4);
  assert.ok(!scan.hits.some((h) => h.value.includes('var(')), '令牌不许被当成硬编码');
  const values = scan.hits.map((h) => h.value).sort();
  assert.deepEqual(values, ['#FF00AA', '#fff', 'hsl(210, 50%, 40%)', 'rgba(0,0,0,.2)']);
});

test('A2 扫描带行号', () => {
  const scan = scanHardcodedColors(SRC);
  const hit = scan.hits.find((h) => h.value === '#fff');
  assert.equal(hit.file, 'apps/a/style.css');
  assert.equal(hit.line, 1);
  const second = scan.hits.find((h) => h.value.startsWith('#FF00AA'));
  assert.equal(second.line, 1);
  assert.equal(scan.byFile['apps/b/theme.js'], 2);
});

test('A3 豁免逐条对拍', () => {
  const scan = scanHardcodedColors(SRC);
  const partial = auditThemeHardcode(scan, { allowlist: [{ file: 'apps/a/style.css', value: '#fff' }] });
  assert.equal(partial.allowed, 1);
  assert.equal(partial.remainingCount, 3);
  assert.equal(partial.ok, false);
  const full = auditThemeHardcode(scan, {
    allowlist: [
      { file: 'apps/a/style.css', value: '#fff' },
      { file: 'apps/a/style.css', value: 'rgba(0,0,0,.2)' },
      { file: 'apps/b/theme.js', value: '#FF00AA' },
      { file: 'apps/b/theme.js', value: 'hsl(210, 50%, 40%)' },
    ],
  });
  assert.equal(full.ok, true);
  assert.equal(full.remainingCount, 0);
});

test('A4 失效豁免单独列', () => {
  const scan = scanHardcodedColors(SRC);
  const rep = auditThemeHardcode(scan, { allowlist: [{ file: 'apps/a/style.css', value: '#abc' }] });
  assert.equal(rep.unusedAllowlist.length, 1);
  assert.ok(rep.unusedAllowlist[0].includes('#abc'));
  assert.ok(themeHardcodeText(rep).includes('失效豁免'));
});

test('A5 豁免项必须写明 file 与 value', () => {
  const scan = scanHardcodedColors(SRC);
  assert.throws(() => auditThemeHardcode(scan, { allowlist: [{ value: '#fff' }] }), /必须逐条写明/);
  assert.throws(() => auditThemeHardcode(null), /需要扫描结果/);
  assert.throws(() => scanHardcodedColors(null), /需要/);
});

test('A6 真仓：扫描面成规模且读数自洽', () => {
  assert.ok(REPO.total > 100, `apps/ 下颜色字面量应当成规模，实测 ${REPO.total}`);
  const rep = auditThemeHardcode(REPO, { allowlist: [] });
  assert.equal(rep.total, rep.allowed + rep.remainingCount);
  assert.equal(rep.ok, false, '真仓现状不该是「已清零」——否则是扫描面漏了');
});

test('A7 真仓：文案如实报残留并点名', () => {
  const rep = auditThemeHardcode(REPO, { allowlist: [] });
  const text = themeHardcodeText(rep);
  assert.ok(text.includes('仍有残留'));
  assert.ok(text.includes(String(rep.remainingCount)));
  assert.ok(text.includes('待清前几处'));
  assert.equal(themeHardcodeText(null), '主题硬编码：无读数（未审计）');
});

test('A8 自检为绿', () => {
  const r = themeHardcodeSelfCheck();
  assert.equal(r.ok, true, r.sample);
});

test('A9 产品面接线：index.js 挂载 + 自检进总表', () => {
  const indexSrc = fs.readFileSync(path.join(ROOT, 'index.js'), 'utf8');
  assert.match(indexSrc, /import\s*\{[^}]*scanHardcodedColors[^}]*\}\s*from\s*'\.\/config\/theme-hardcode\.js'/);
  assert.ok(/VirtualPhone\.themeHardcode\s*=/.test(indexSrc), '硬编码审计必须挂诊断面');
  assert.ok(/['"]_r26O8['"]/.test(indexSrc), '自检必须进启动自检总表 _r26O8');
});

/* ------------------------------ 负控制（确定性破坏） ------------------------------ */

async function loadMutant(replacements, tag) {
  let text = SOURCE;
  for (const [from, to] of replacements) {
    assert.ok(text.includes(from), `负控制锚点失效（源变了要同步改判据）：${from}`);
    text = text.split(from).join(to);
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `rp_o8_${tag}_`));
  const file = path.join(dir, 'theme-hardcode.js');
  fs.writeFileSync(file, text, 'utf8');
  return import(pathToFileURL(file).href + `?t=${Date.now()}`);
}

test('N1 破坏：把 var(--bg) 也当颜色 ⇒ 令牌被误判成硬编码', async () => {
  const broken = await loadMutant(
    [["{ id: 'hex', re: /#[0-9a-fA-F]{3,8}\\b/g },", "{ id: 'hex', re: /#[0-9a-fA-F]{3,8}\\b|var\\(--[a-z-]+\\)/g },"]],
    'varashard'
  );
  const scan = broken.scanHardcodedColors(SRC);
  assert.ok(scan.hits.some((h) => h.value.includes('var(--bg)')), '破坏后令牌被当成硬编码（正说明真实现排除它）');
  assert.equal(scan.total, 5);
});

test('N2 破坏：remaining 一律清空 ⇒ 残留被藏成 0（假清零）', async () => {
  const broken = await loadMutant(
    [
      ['  remaining,', '  remaining: [],'],
      ['  remainingCount: remaining.length,', '  remainingCount: 0,'],
      ['  ok: remaining.length === 0,', '  ok: true,'],
    ],
    'fakenezero'
  );
  const scan = broken.scanHardcodedColors(SRC);
  const rep = broken.auditThemeHardcode(scan, { allowlist: [] });
  assert.equal(rep.ok, true, '破坏后四处残留也报清零（正说明真实现逐条对拍）');
  assert.equal(rep.remainingCount, 0);
});