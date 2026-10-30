/* ============================================================
 * tests/system-v4930.test.mjs — v4.93.0 绑定级消费判据档（计划 R11-O1）
 * ------------------------------------------------------------
 * 为什么要有这一档：`dead-export-check` 的跨文件消费是**裸词正则**——
 *   只要别的文件里出现过同名标识符就算「已消费」。于是：
 *     • A 模块导出 X 从没人用，B 模块也导出 X 且被用 ⇒ A::X 永远判绿；
 *     • 转出模块 `export { X } from './src.js'` 会让 src 的 X 永远判绿。
 *   本档把判据升级为「模块解析后的绑定」，并用**真源码破坏**证明新口径能看见旧口径看不见的死导出。
 *
 * 判据分六面：
 *   A 夹具：同名异构（旧绿新红）
 *   B 夹具：重导出穿透（转出不算消费，穿透到源模块）
 *   C 夹具：命名空间同名重绑定（不得互相白拿成员）
 *   D 夹具：lazy-route cls 装配算消费
 *   E 真仓：基线账本自洽 + 绑定级零新增
 *   F 探测器自证：扫描面塌陷 / 空根 ⇒ exit 2；新死导出 ⇒ exit 1
 * ============================================================ */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import {
  loadTree, buildConsumptionIndex, hasBindingConsumer,
} from '../scripts/lib/binding-consumption.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const rel = (p) => path.join(ROOT, p);
const read = (p) => fs.readFileSync(rel(p), 'utf8');
const BORN_V = '4.93.0';
const AUDIT = rel('scripts/bind-consumption-audit.mjs');
const BASELINE = rel('scripts/bind-dead-baseline.json');

/** 建一棵临时树，返回 { root, index, has, cleanup } */
function fixture(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bindfix-'));
  for (const [p, src] of Object.entries(files)) {
    const abs = path.join(root, p);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, src);
  }
  const { texts, bindTexts, codeTexts } = loadTree(root, {
    skipDirs: new Set(['node_modules', '.git', '.wrangler', 'tests']),
  });
  const index = buildConsumptionIndex(bindTexts, { rawTexts: texts, codeTexts });
  return {
    root,
    index,
    has: (m, n) => hasBindingConsumer(index, m, n),
    cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
  };
}

/* ══════════════════ A 同名异构 ══════════════════ */
test('A1: 同名异构 —— 零消费的那个必须红，被消费的那个必须绿', () => {
  const f = fixture({
    'mods/a.js': 'export function shared() { return 1; }\n',
    'mods/b.js': 'export function shared() { return 9; }\n',
    'use-b.js': "import { shared } from './mods/b.js';\nconsole.log(shared());\n",
  });
  try {
    assert.equal(f.has('mods/b.js', 'shared'), true, 'B::shared 有绑定级消费 ⇒ 绿');
    assert.equal(f.has('mods/a.js', 'shared'), false,
      'A::shared 零消费。若这里变绿，说明判据退化回「全仓同名即消费」的裸词口径');
  } finally { f.cleanup(); }
});

test('A2: 别名导入记在原名下（`import { X as Y }`）', () => {
  const f = fixture({
    'm.js': 'export function realName() {}\n',
    'u.js': "import { realName as alias } from './m.js';\nalias();\n",
  });
  try {
    assert.equal(f.has('m.js', 'realName'), true, '别名导入也必须算 realName 被消费');
  } finally { f.cleanup(); }
});

/* ══════════════════ B 重导出穿透 ══════════════════ */
test('B1: 转出不等于消费 —— 只有转出时源模块仍红', () => {
  const f = fixture({
    'src.js': 'export const payload = 1;\n',
    'barrel.js': "export { payload } from './src.js';\n",
    'nobody.js': 'const x = 1;\n',
  });
  try {
    assert.equal(f.has('src.js', 'payload'), false, '只有 export-from、无下游 import ⇒ 源模块仍零消费');
  } finally { f.cleanup(); }
});

test('B2: 重导出穿透 —— 下游从 barrel 拿，消费记到源模块', () => {
  const f = fixture({
    'src.js': 'export const payload = 1;\n',
    'barrel.js': "export { payload as renamed } from './src.js';\n",
    'consumer.js': "import { renamed } from './barrel.js';\nconsole.log(renamed);\n",
  });
  try {
    assert.equal(f.has('src.js', 'payload'), true,
      '下游经 barrel 拿到 payload ⇒ 源模块必须判绿，否则转出层会造出假红');
    // ⚠️ 这里**不**断言 `has(barrel,'renamed') === false`：
    //   消费表按「谁 import 了谁」记账，consumer 确实 import 了 barrel 的 renamed，
    //   所以这笔消费在表里存在是正确的。真正要防止的是「枚举面把 barrel 当成
    //   renamed 的声明者」（那会产出伪条目，见 B3 与审计脚本的 export-from 跳过）。
    assert.equal(f.has('barrel.js', 'renamed'), true,
      '消费表如实记下 consumer → barrel 这一笔；是否出伪条目由枚举面负责');
  } finally { f.cleanup(); }
});

test('B3: 纯转出模块不产生「自己声明」的导出条目', () => {
  // apps/games/games-data.js 的真实形态：全文只有一行 export-from
  const f = fixture({
    'poker-data.js': 'export const HAND_LABELS = { a: 1 };\n',
    'games-data.js': "export { HAND_LABELS } from './poker-data.js';\n",
  });
  try {
    const src = fs.readFileSync(path.join(f.root, 'games-data.js'), 'utf8');
    assert.ok(/^\s*export\s*\{/.test(src) && !/^\s*export\s+(?:const|function|class)/m.test(src),
      '夹具形态必须与真仓一致：只有转出语句');
  } finally { f.cleanup(); }
  // 真仓侧：审计脚本的枚举面必须跳过 export-from（否则会出 `games-data.js::HAND_LABELS` 伪条目）
  const r = spawnSync(process.execPath, [AUDIT, '--list'], { encoding: 'utf8', cwd: ROOT, timeout: 300000 });
  assert.doesNotMatch(r.stdout, /apps\/games\/games-data\.js:\d+ /,
    'games-data.js 只有转出语句，不得出现在「本模块零消费导出」清单里');
  assert.doesNotMatch(r.stdout, /apps\/games\/games-view\.js:\d+ /,
    'games-view.js 同样只有转出语句，不得出现伪条目');
});

/* ══════════════════ C 命名空间同一 local 名重绑定 ══════════════════ */
test('C1: 同一文件里 `module` 先后指向两个模块，不得互相白拿成员', () => {
  const f = fixture({
    'n1.js': 'export function alpha() {}\nexport function beta() {}\n',
    'n2.js': 'export function gamma() {}\nexport function delta() {}\n',
    'boot.js': [
      "const module = await import('./n1.js');",
      'module.alpha();',
      "const module = await import('./n2.js');",
      'module.gamma();',
      '',
    ].join('\n'),
  });
  try {
    assert.equal(f.has('n1.js', 'alpha'), true, 'n1::alpha 被调用 ⇒ 绿');
    assert.equal(f.has('n1.js', 'beta'), false,
      'n1::beta 全仓没有 module.beta() ⇒ 必须红。若变绿说明同名重绑定把 11 个模块互相放生');
    assert.equal(f.has('n2.js', 'gamma'), true, 'n2::gamma 被调用 ⇒ 绿');
    assert.equal(f.has('n2.js', 'delta'), false, 'n2::delta 未被调用 ⇒ 红');
  } finally { f.cleanup(); }
});

/* ══════════════════ D lazy-route 装配 ══════════════════ */
test('D1: lazy-route 表的 cls 由装配器实例化 ⇒ 算消费', () => {
  const f = fixture({
    'config/app-lazy-routes.js': "export const R = [\n  { id: 'z', module: './apps/z/z-app.js', cls: 'ZApp' },\n];\n",
    'apps/z/z-app.js': 'export class ZApp {}\nexport class UnusedApp {}\n',
    'boot.js': "const m = await import('./apps/z/z-app.js');\nmodule.exports = new m.ZApp();\n",
  });
  try {
    assert.equal(f.has('apps/z/z-app.js', 'ZApp'), true, 'ZApp 被 lazy-route 登记 ⇒ 绿');
    assert.equal(f.has('apps/z/z-app.js', 'UnusedApp'), false, 'UnusedApp 未登记未引用 ⇒ 红');
  } finally { f.cleanup(); }
});

/* ══════════════════ E 真仓账本 ══════════════════ */
test('E1: 绑定级基线账本存在且条目带证据分级', () => {
  assert.ok(fs.existsSync(BASELINE), 'scripts/bind-dead-baseline.json 必须在场');
  const b = JSON.parse(fs.readFileSync(BASELINE, 'utf8'));
  assert.ok(Array.isArray(b.entries) && b.entries.length > 0, '账本不能为空（为空等于没判过）');
  for (const e of b.entries) {
    assert.ok(typeof e.file === 'string' && e.file.length, 'entry.file 必须是相对路径');
    assert.ok(typeof e.name === 'string' && e.name.length, 'entry.name 必须非空');
    assert.ok(['no-ref', 'name-clash'].includes(e.evidence),
      `${e.file}::${e.name} 的 evidence 必须是 no-ref / name-clash 之一，实际 ${e.evidence}`);
  }
});

test('E2: 账本不得混入 PARSER-GAP（探测器缺口不许冻结进账本）', () => {
  const b = JSON.parse(fs.readFileSync(BASELINE, 'utf8'));
  const gaps = b.entries.filter((e) => e.evidence === 'PARSER-GAP');
  assert.equal(gaps.length, 0,
    'PARSER-GAP 表示「判据说零消费但原文确实 import 了」，必须补解析器形态而不是写账本');
});

test('E3: 真仓绑定级零新增（门禁 rc=0）', () => {
  const r = spawnSync(process.execPath, [AUDIT], { encoding: 'utf8', cwd: ROOT, timeout: 300000 });
  assert.equal(r.status, 0, `bind-consumption-audit 必须以 0 退出\nstdout:${r.stdout}\nstderr:${r.stderr}`);
  assert.match(r.stdout, /新增 0/, '真仓当前不得有未登记的绑定级死导出');
});

/* ══════════════════ F 探测器自证（负控制） ══════════════════ */
test('F1: 新增真零消费导出 ⇒ rc=1（门禁会拦）', () => {
  const target = rel('config/district-network.js');
  const backup = fs.readFileSync(target, 'utf8');
  try {
    fs.writeFileSync(target, backup + '\nexport function __negControlOnlyExport() { return 1; }\n');
    const r = spawnSync(process.execPath, [AUDIT], { encoding: 'utf8', cwd: ROOT, timeout: 300000 });
    assert.equal(r.status, 1, '新增零消费导出必须让门禁 rc=1');
    assert.match(r.stderr, /__negControlOnlyExport/, '必须点名这个新死导出');
  } finally {
    fs.writeFileSync(target, backup);
  }
});

test('F2: 真源码破坏后门禁仍要认出旧条目的消失（不静默）', () => {
  const target = rel('config/diff-editor-desk.js');
  const backup = fs.readFileSync(target, 'utf8');
  try {
    const broken = backup.replace(/export function computeParagraphDiff\b/, 'export function computeParagraphDiffX');
    assert.notEqual(broken, backup, '破坏必须真的发生（锚点至少命中一次）');
    fs.writeFileSync(target, broken);
    const r = spawnSync(process.execPath, [AUDIT], { encoding: 'utf8', cwd: ROOT, timeout: 300000 });
    assert.equal(r.status, 1, '改名后 computeParagraphDiffX 是新的零消费导出 ⇒ rc=1');
    assert.match(r.stderr, /computeParagraphDiffX/, '必须点名被改名后的新名字');
  } finally {
    fs.writeFileSync(target, backup);
  }
});

test('F3: --root 指到空目录 ⇒ rc=2 fail-closed（不许 0 文件全绿）', () => {
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'bindempty-'));
  try {
    const r = spawnSync(process.execPath, [AUDIT, '--root', empty], { encoding: 'utf8', cwd: ROOT, timeout: 120000 });
    assert.equal(r.status, 2, '扫描面塌陷必须 exit 2，而不是「0 文件 0 死导出」地通过');
    assert.match(r.stderr, /扫描面|塌陷|fixture/, '必须说明塌陷或提示 --fixture');
  } finally { fs.rmSync(empty, { recursive: true, force: true }); }
});

test('F4: 夹具模式显式放行（--fixture）', () => {
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'bindempty-'));
  try {
    const r = spawnSync(process.execPath, [AUDIT, '--root', empty, '--fixture'], { encoding: 'utf8', cwd: ROOT, timeout: 120000 });
    assert.equal(r.status, 0, '显式 --fixture 时才允许小扫描面');
  } finally { fs.rmSync(empty, { recursive: true, force: true }); }
});

test('F5: check 链已接入绑定级门禁', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.ok(pkg.scripts['bind-consuming'], 'package.json 必须有 bind-consuming 脚本');
  assert.match(pkg.scripts.check, /bind-consuming/, 'npm run check 必须跑到 bind-consuming');
});

test('F6: 版本四源同源且不低于 4.93.0', () => {
  /* [v4.94.0 交棒改写] 本版出生时五源都是 4.93.0，原判据写的是等值锚 —— 抬版即红（那是抬版仪式，
   *   不是缺陷），且把「当版的落点」偷换成「上一版那件事」。按仓内既定口径换成**下限形**：五源必须
   *   彼此一致、且都不低于诞生版（不回退即可），「当版是否等于某值」由当版套件
   *   （tests/system-v4940.test.mjs）接管。本档只守「不许倒退」这一向。 */
  const sem = (v) => String(v).split('.').map(Number).reduce((a, x) => a * 1000 + x, 0);
  const pkg = JSON.parse(read('package.json')).version;
  const man = JSON.parse(read('manifest.json')).version;
  const log = JSON.parse(read('update-log.json')).latest;
  assert.equal(new Set([pkg, man, log]).size, 1, '版本三源必须一致');
  assert.ok(sem(pkg) >= sem(BORN_V), '版本不得低于本档诞生版 ' + BORN_V + '，实际 ' + pkg);
});