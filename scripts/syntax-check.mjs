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
 * 用法：
 *   node scripts/syntax-check.mjs              # 校验本仓库
 *   node scripts/syntax-check.mjs --verbose    # 逐文件输出
 *   node scripts/syntax-check.mjs --root <dir> # 校验指定目录（负控制测试用）
 * ============================================================ */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

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

// 仅 ESM 需要本门；.cjs 显式 CommonJS（如 workers/openai-image-local-relay.cjs）
const ESM_EXT = new Set(['.js', '.mjs']);
const SKIP_DIRS = new Set(['node_modules', '.git', '.wrangler']);

function* walk(dir) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(ent.name) || ent.name.startsWith('.')) continue;
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) yield* walk(p);
    else if (ESM_EXT.has(path.extname(ent.name))) yield p;
  }
}

let total = 0;
const failures = [];
for (const file of walk(root)) {
  total++;
  try {
    // stdin 喂入 + --input-type=module：可暴露 import/export 误用、
    // 块结构错位（多余的 } 提前闭合）、未闭合 .catch 等真实损坏。
    execFileSync(process.execPath, ['--input-type=module', '--check'], {
      input: fs.readFileSync(file),
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    if (verbose) console.log(`ok   ${path.relative(root, file)}`);
  } catch (e) {
    const errText = String(e.stderr || e.message);
    const firstLine = errText.split('\n').map(l => l.trim()).filter(Boolean)[0] || 'parse error';
    // 提取 [stdin]:NNNN 行号，方便直接定位
    const lineNo = (errText.match(/\[stdin\]:(\d+)/) || [])[1];
    failures.push({ rel: path.relative(root, file), msg: firstLine, line: lineNo });
  }
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