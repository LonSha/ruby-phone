#!/usr/bin/env node
/* ============================================================
 * RubyPhone 语法门（强制 ES Module 解析，独立可执行）
 * ------------------------------------------------------------
 * 为什么存在：
 *   项目宪法要求「修改后必须通过 node --check 全量语法校验」。
 *   但在缺少 package.json（或无 "type": "module"）时，
 *   `node --check <文件>.js` 不会按 ES Module 解析该文件——
 *   对 index.js 当时的结构性损坏返回退出码 0（实测，见
 *   tests/syntax-gate.test.mjs 的负控制用例）。
 *   index.js 因此带着「根本无法解析、插件完全无法加载」的错误
 *   连续发布了约 9 个版本（v2.1.0 → v2.8.9）。
 *
 *   本脚本用 `--input-type=module` 从 stdin 强制按 ESM 解析每个
 *   .js/.mjs 文件，任一失败即非 0 退出并列出文件与首行报错。
 *
 * 性能层（v2.40.0，慎改）：
 *   旧实现为每个文件 spawn 一次 `node --input-type=module --check`
 *   （251 文件 = 251 个子进程，单次扫描实测 ~16.7s）。
 *   现改为「本进程内 vm 批量解析」（单次 <1s）：
 *     - 命中失败的文件，才逐个回退到 per-file `--check` 取回精确
 *       stderr（vm 抛出的 SyntaxError 不含行号/文件名，必须回退补齐）。
 *     - 判定等价性已实测：对照 251 个真实文件的 per-file
 *       `--input-type=module --check`，逐文件比对 0 处不一致。
 *   vm.SourceTextModule 需 --experimental-vm-modules，故无该标志时
 *   自 re-exec 一次（stdio: inherit，不占用管道缓冲）。
 *
 * 用法：
 *   node scripts/syntax-check.mjs              # 校验本仓库
 *   node scripts/syntax-check.mjs --verbose    # 逐文件输出
 *   node scripts/syntax-check.mjs --root <dir> # 校验指定目录（负控制测试用）
 * 退出码：0=全部可解析  1=存在损坏  2=参数错误
 * ============================================================ */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const VM_FLAG = '--experimental-vm-modules';
if (!process.execArgv.includes(VM_FLAG) && !process.env.RP_SYNTAX_GATE_REEXEC) {
  const r = spawnSync(
    process.execPath,
    [VM_FLAG, '--no-warnings', fileURLToPath(import.meta.url), ...process.argv.slice(2)],
    { env: { ...process.env, RP_SYNTAX_GATE_REEXEC: '1' }, stdio: 'inherit' },
  );
  process.exit(typeof r.status === 'number' ? r.status : 1);
}

const args = process.argv.slice(2);
const rootIdx = args.indexOf('--root');
const root = rootIdx >= 0
  ? path.resolve(args[rootIdx + 1] || '.')
  : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const verbose = args.includes('--verbose');

if (rootIdx >= 0 && !fs.existsSync(root)) {
  console.error(`✗ --root 指向不存在的路径: ${root}`);
  process.exit(2);
}

/* ---------- 输入在场性守卫（v3.3.2 · O-3 下游侧） ----------
 * 实测缺口（整仓镜像，三种退化）：
 *   · 根 .js 全删 ⇒ 本门仍 **exit 0**，报「395 个文件均可按 ES Module 解析」；
 *   · apps/ 或 config/ 整目录掏空 ⇒ 同样 exit 0。
 *   「剩下的文件都能解析」为真，但与本门存在的唯一理由无关 —— 文件头写着：
 *   `index.js` 坏掉时整个扩展不会被浏览器加载（所有 App 不可用）。
 *   旧代码只有 `total === 0` 一道，而删/掏空根 .js 后 apps/ 里仍有 300+ 个 .js，那道兜不住。
 *
 * 只作用于**默认根**（未显式给 --root）：显式 --root 是夹具通道
 *   （`tests/system-v282` 等用它塞合成小仓库），语义逐字不动。
 * 失败码 2（结构漂移 = 没得判）与 1（真语法失败 = 判出坏了）分开。 */
if (rootIdx < 0) {
  const ENTRY = 'index.js';
  const MIN_ENTRY_BYTES = 1000;
  const entryAbs = path.join(root, ENTRY);
  if (!fs.existsSync(path.join(root, 'manifest.json')) || !fs.existsSync(entryAbs)) {
    console.error(`✗ 结构漂移：默认根缺 manifest.json 或 ${ENTRY}（root=${root}）`);
    console.error('  本门只为入口文件而存在；入口不在场时「N 个文件均可解析」不具证明力。');
    process.exit(2);
  }
  const entrySize = fs.statSync(entryAbs).size;
  if (entrySize < MIN_ENTRY_BYTES) {
    console.error(`✗ 输入退化：${ENTRY} 仅 ${entrySize} 字节（下限 ${MIN_ENTRY_BYTES}），本门无法据此断言扩展可加载`);
    console.error('  若确有需要（如夹具），请显式传 --root <dir> 走目录级判定。');
    process.exit(2);
  }
}

// 仅 ESM 需要本门；.cjs 显式 CommonJS（如 workers/openai-image-local-relay.cjs）
const ESM_EXT = new Set(['.js', '.mjs']);
const SKIP_DIRS = new Set(['node_modules', '.git', '.wrangler']);

function* walk(dir) {
  let ents;
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const ent of ents) {
    if (SKIP_DIRS.has(ent.name) || ent.name.startsWith('.')) continue;
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) yield* walk(p);
    else if (ESM_EXT.has(path.extname(ent.name))) yield p;
  }
}

// 批量快筛：单进程内解析，不 spawn。语义与 --check 等价（已实测对照）。
function parseOne(file, src) {
  try {
    new vm.SourceTextModule(src, { identifier: file });
    return { ok: true };
  } catch (e) {
    return { ok: false, err: String((e && e.message) || e) };
  }
}

// 仅失败文件回退：拿精确 stderr（含 [stdin]:N 行号）+ 权威判定
function checkEsm(file) {
  try {
    execFileSync(process.execPath, ['--input-type=module', '--check'], {
      input: fs.readFileSync(file),
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, err: String(e.stderr || e.message) };
  }
}

function firstErr(err) {
  const lines = String(err).split('\n').map(l => l.trim()).filter(Boolean);
  return (lines.find(l => /Error/i.test(l)) || lines[0] || 'parse error').slice(0, 200);
}

function errLine(err) {
  const m = String(err).match(/\[stdin\]:(\d+)/) || String(err).match(/:[\w./-]+?:(\d+)\n/);
  return m ? m[1] : undefined;
}

let total = 0;
const failures = [];

for (const file of walk(root)) {
  total++;
  const rel = path.relative(root, file);

  const src = fs.readFileSync(file, 'utf8');
  const fast = parseOne(file, src);

  if (fast.ok) {
    if (verbose) console.log(`ok   ${rel}`);
    continue;
  }

  // 快筛报失败 → 用 per-file --check 复检取权威结论与报错文本
  const r = checkEsm(file);
  if (r.ok) {
    // 理论上不可达（等价性已实测）；万一发生，以权威结果为准，不误报
    if (verbose) console.log(`ok   ${rel}`);
    continue;
  }
  failures.push({ rel, msg: firstErr(r.err), line: errLine(r.err) });
}

if (total === 0) {
  console.error('✗ 未找到任何可校验文件（--root 是否指向正确目录？）');
  process.exit(2);
}

if (failures.length) {
  console.error(`\n✗ 语法门失败：${failures.length}/${total} 个文件无法按 ES Module 解析\n`);
  for (const f of failures) {
    console.error(`  ${f.rel}${f.line ? `  (约第 ${f.line} 行)` : ''}`);
    console.error(`      ${f.msg}`);
  }
  console.error('\n提示：若损坏在 index.js，整个扩展不会被浏览器加载（所有 App 不可用）。');
  process.exit(1);
}
console.log(`✓ 语法门通过：${total} 个文件均可按 ES Module 解析`);