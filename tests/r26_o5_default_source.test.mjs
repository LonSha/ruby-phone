/**
 * tests/r26_o5_default_source.test.mjs — 默认值单一真源与显示值对拍判据 [R26-O5]
 *
 * A1 扫描认两种作用域：export 与模块私有
 * A2 同名跨文件即冲突，且两处文件名都点名（不合并成 1）
 * A3 真仓：config/ 下没有任何同名 DEFAULT_* 冲突（读数真实，不是空跑）
 * A4 真仓：声明总数自洽（exported + private === total，且 total > 0）
 * A5 显示值与声明值逐字一致 ⇒ ok
 * A6 显示值漂移 ⇒ uiMismatch 点名（含真源文件），ok=false
 * A7 界面自造默认值（未声明）⇒ uiOrphan 单列，不与「漂移」混为一类
 * A8 多行结构比不了字面量 ⇒ nonLiteral，且**不算一致**
 * A9 文案把冲突与漂移都列出来（定位不靠猜）
 * A10 自检为绿
 * A11 产品面接线：index.js 挂载 + 自检进总表
 * N1 破坏副本：冲突只取首条 ⇒ 第二处漏判（证明 A2 靠全量点名）
 * N2 破坏副本：显示值对拍只比键集合不比值 ⇒ 漂移漏判（证明 A6 靠逐字比）
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  DEFAULT_SCOPES,
  auditDefaultSource,
  defaultSourceSelfCheck,
  defaultSourceText,
  scanDefaultDeclarations,
} from '../config/default-source.js';

const ROOT = path.resolve(new URL('.', import.meta.url).pathname, '..');
const SOURCE = fs.readFileSync(path.join(ROOT, 'config', 'default-source.js'), 'utf8');

const SRC = {
  'a.js': 'export const DEFAULT_PAGE_SIZE = 6;\n// 注释行不该被当声明\nexport const DEFAULT_KEY = "ok";\n',
  'b.js': 'const DEFAULT_INTERNAL = 3;\n',
  'c.js': 'export const DEFAULT_PAGE_SIZE = 12;\n',
  'd.js': 'export const DEFAULT_STATE = {\n  n: 1\n};\n',
};

test('A1 扫描认两种作用域：export 与模块私有', () => {
  assert.deepEqual([...DEFAULT_SCOPES], ['export', 'private']);
  const scan = scanDefaultDeclarations(SRC);
  const a = scan.declarations.find((d) => d.file === 'a.js' && d.name === 'DEFAULT_PAGE_SIZE');
  const b = scan.declarations.find((d) => d.file === 'b.js');
  assert.equal(a.scope, 'export');
  assert.equal(b.scope, 'private');
  assert.equal(scan.declarations.length, 5, '四行声明 + c.js 那条，注释行不算');
});

test('A2 同名跨文件即冲突，且两处文件名都点名', () => {
  const scan = scanDefaultDeclarations(SRC);
  assert.equal(scan.duplicates.length, 1);
  assert.equal(scan.duplicates[0].name, 'DEFAULT_PAGE_SIZE');
  assert.deepEqual(scan.duplicates[0].files, ['a.js', 'c.js'], '不允许只报一处');
});

test('A3 真仓：config/ 下没有任何同名 DEFAULT_* 冲突', () => {
  const dir = path.join(ROOT, 'config');
  const sources = {};
  for (const f of fs.readdirSync(dir).sort()) {
    if (!f.endsWith('.js')) continue;
    sources[f] = fs.readFileSync(path.join(dir, f), 'utf8');
  }
  const scan = scanDefaultDeclarations(sources);
  assert.ok(scan.declarations.length > 20, `真仓默认值声明应当成规模，实测 ${scan.declarations.length}`);
  assert.deepEqual(scan.duplicates, [], '同名默认值必须清零：' + JSON.stringify(scan.duplicates));
});

test('A4 真仓：声明总数自洽', () => {
  const dir = path.join(ROOT, 'config');
  const sources = {};
  for (const f of fs.readdirSync(dir).sort()) {
    if (!f.endsWith('.js')) continue;
    sources[f] = fs.readFileSync(path.join(dir, f), 'utf8');
  }
  const rep = auditDefaultSource(scanDefaultDeclarations(sources));
  assert.equal(rep.exported + rep.privateCount, rep.total);
  assert.equal(rep.total, rep.exported + rep.privateCount);
  assert.ok(rep.exported > 0 && rep.privateCount > 0, '两种作用域都该有实例');
});

test('A5 显示值与声明值逐字一致 ⇒ ok', () => {
  const scan = scanDefaultDeclarations(SRC);
  const rep = auditDefaultSource(scan, { uiValues: { DEFAULT_INTERNAL: '3', DEFAULT_KEY: 'ok' } });
  assert.deepEqual(rep.uiMismatch, []);
  assert.deepEqual(rep.uiOrphan, []);
  assert.deepEqual(rep.nonLiteral, []);
});

test('A6 显示值漂移 ⇒ uiMismatch 点名（含真源文件）', () => {
  const scan = scanDefaultDeclarations(SRC);
  const rep = auditDefaultSource(scan, { uiValues: { DEFAULT_INTERNAL: '4' } });
  assert.equal(rep.uiMismatch.length, 1);
  assert.equal(rep.uiMismatch[0].name, 'DEFAULT_INTERNAL');
  assert.equal(rep.uiMismatch[0].file, 'b.js');
  assert.equal(rep.uiMismatch[0].declared, '3');
  assert.equal(rep.uiMismatch[0].displayed, '4');
  assert.equal(rep.ok, false);
});

test('A7 界面自造默认值（未声明）⇒ uiOrphan 单列', () => {
  const scan = scanDefaultDeclarations(SRC);
  const rep = auditDefaultSource(scan, { uiValues: { DEFAULT_GHOST: '9' } });
  assert.equal(rep.uiOrphan.length, 1);
  assert.equal(rep.uiOrphan[0].name, 'DEFAULT_GHOST');
  assert.deepEqual(rep.uiMismatch, [], '自造值与漂移是两种错因，不许混报');
  assert.equal(rep.ok, false);
});

test('A8 多行结构比不了字面量 ⇒ nonLiteral，且不算一致', () => {
  // 用一份**没有同名冲突**的源：否则 ok 会因为 duplicates 变红，测不到 nonLiteral 这条口径
  const clean = { 'd.js': 'export const DEFAULT_STATE = {\n  n: 1\n};\n' };
  const scan = scanDefaultDeclarations(clean);
  const rep = auditDefaultSource(scan, { uiValues: { DEFAULT_STATE: '{"n":1}' } });
  assert.equal(rep.nonLiteral.length, 1);
  assert.equal(rep.nonLiteral[0].name, 'DEFAULT_STATE');
  assert.equal(rep.ok, true, 'nonLiteral 不参与 ok 判定……');
  assert.ok(defaultSourceText(rep).includes('未逐字对拍'), '……但文案必须写明「没比」，不许读成一致');
});

test('A9 文案把冲突与漂移都列出来', () => {
  const scan = scanDefaultDeclarations(SRC);
  const rep = auditDefaultSource(scan, { uiValues: { DEFAULT_INTERNAL: '4', DEFAULT_GHOST: '9' } });
  const text = defaultSourceText(rep);
  assert.ok(text.includes('不一致'));
  assert.ok(text.includes('DEFAULT_PAGE_SIZE'), '冲突要点名');
  assert.ok(text.includes('DEFAULT_INTERNAL'), '漂移要点名');
  assert.ok(text.includes('DEFAULT_GHOST'), '自造值要点名');
  assert.equal(defaultSourceText(null), '默认值真源：无读数（未审计）');
});

test('A10 自检为绿', () => {
  const r = defaultSourceSelfCheck();
  assert.equal(r.ok, true, r.sample);
});

test('A11 产品面接线：index.js 挂载 + 自检进总表', () => {
  const indexSrc = fs.readFileSync(path.join(ROOT, 'index.js'), 'utf8');
  assert.match(indexSrc, /import\s*\{[^}]*scanDefaultDeclarations[^}]*\}\s*from\s*'\.\/config\/default-source\.js'/);
  assert.ok(/VirtualPhone\.defaultSource\s*=/.test(indexSrc), '默认值真源必须挂诊断面');
  assert.ok(/['"]_r26O5['"]/.test(indexSrc), '自检必须进启动自检总表 _r26O5');
});

/* ------------------------------ 负控制（确定性破坏） ------------------------------ */

async function loadMutant(replacements, tag) {
  let text = SOURCE;
  for (const [from, to] of replacements) {
    assert.ok(text.includes(from), `负控制锚点失效（源变了要同步改判据）：${from}`);
    text = text.split(from).join(to);
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `rp_o5_${tag}_`));
  const file = path.join(dir, 'default-source.js');
  fs.writeFileSync(file, text, 'utf8');
  return import(pathToFileURL(file).href + `?t=${Date.now()}`);
}

test('N1 破坏：冲突只取首条 ⇒ 第二处漏判（证明 A2 靠全量点名）', async () => {
  const broken = await loadMutant(
    [['    .map((name) => ({ name, files: [...new Set(byName[name])].sort() }));', '    .slice(0, 1)\n    .map((name) => ({ name, files: [byName[name][0]] }));']],
    'firstonly'
  );
  const scan = broken.scanDefaultDeclarations(SRC);
  assert.equal(scan.duplicates.length, 1);
  assert.deepEqual(scan.duplicates[0].files, ['a.js'], '破坏后只点名一处（正说明真实现是全量点名）');
});

test('N2 破坏：显示值对拍只比键集合不比值 ⇒ 漂移漏判（证明 A6 靠逐字比）', async () => {
  const broken = await loadMutant(
    [['    if (a !== b) uiMismatch.push({ name, file: decl.file, declared: b, displayed: a });', '    if (!decl) uiMismatch.push({ name, file: decl.file, declared: b, displayed: a });']],
    'keysonly'
  );
  const scan = broken.scanDefaultDeclarations(SRC);
  const rep = broken.auditDefaultSource(scan, { uiValues: { DEFAULT_INTERNAL: '4' } });
  assert.equal(rep.uiMismatch.length, 0, '破坏后漂移漏判（正说明真实现逐字比）');
});