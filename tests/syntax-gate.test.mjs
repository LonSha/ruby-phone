/* ============================================================
 * 语法门自身的回归测试（含负控制）
 * ------------------------------------------------------------
 * 目的：证明 scripts/syntax-check.mjs 真的拦得住「插件无法加载」级损坏；
 * 并锁定历史上那条发布门为何一路假绿。若语法门哪天退化成 no-op，
 * 或 package.json 的 type 字段被删，本测试失败。
 *
 * 实测过的三种语境（结论，勿凭直觉改动）：
 *   无 package.json   → node --check 把 .js 按脚本解析 → 损坏文件退出码 0（假绿，历史根因）
 *   type: commonjs    → 本样例含 export → 退出码 1（因 ESM 语法报错，非我们要复现的机制）
 *   type: module      → 退出码 1（正确报错）
 * ============================================================ */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`✓ ${name}`); }
  else { fail++; console.log(`✗ ${name} ${detail}`); }
};

const run = (cmd, args) => {
  try {
    const out = execFileSync(cmd, args, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
    return { code: 0, out: String(out || ''), err: '' };
  } catch (e) {
    return { code: typeof e.status === 'number' ? e.status : 1, out: String(e.stdout || ''), err: String(e.stderr || e.message) };
  }
};

// 复刻当年真实发布过的损坏模式（结构性损坏，ESM 无法解析）
const BROKEN = [
  'export class Broken {',
  '  m() {',
  "    Promise.resolve().catch(() => {",
  '      }                } else if (x) {',
  '    }););',
  '  }',
  '}',
  '',
].join('\n');

const HEALTHY = "export class Healthy { m() { return 1; } }\n";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rp-gate-'));
const mkdir = (name) => { const d = path.join(tmp, name); fs.mkdirSync(d, { recursive: true }); return d; };

// 语境 A：无 package.json（复现历史假绿 —— 仓库此前正是这个状态）
const ctxNoPkg = mkdir('no-pkg');
fs.writeFileSync(path.join(ctxNoPkg, 'broken.js'), BROKEN);

// 语境 B：type: module（当前仓库状态）
const ctxEsm = mkdir('esm');
fs.writeFileSync(path.join(ctxEsm, 'package.json'), JSON.stringify({ type: 'module' }));
fs.writeFileSync(path.join(ctxEsm, 'broken.js'), BROKEN);
fs.writeFileSync(path.join(ctxEsm, 'healthy.js'), HEALTHY);

// ========== 1. 负控制：复现「假绿」根因 ==========
{
  const r = run(process.execPath, ['--check', path.join(ctxNoPkg, 'broken.js')]);
  ok('负控制成立：无 package.json 时 node --check 对损坏文件返回0（历史假绿根因）',
    r.code === 0, `实际退出码=${r.code}；这是 index.js 损坏却存活约 9 个版本的直接机制`);

  const rEsm = run(process.execPath, ['--check', path.join(ctxEsm, 'broken.js')]);
  ok('加 type=module 后同一命令能正确拒绝损坏文件', rEsm.code !== 0, `退出码=${rEsm.code}`);
}

// ========== 2. 语法门必须拦住损坏 ==========
{
  const r = run(process.execPath, [path.join(root, 'scripts', 'syntax-check.mjs'), '--root', ctxNoPkg]);
  ok('语法门对损坏目录返回非0', r.code !== 0, `退出码=${r.code}`);
  ok('语法门报告具体损坏文件名', /broken\.js/.test(r.err), `stderr=${r.err.slice(0, 140)}`);
}

// ========== 3. 语法门不得误伤健康代码 ==========
{
  const good = mkdir('allgood');
  fs.writeFileSync(path.join(good, 'a.js'), HEALTHY);
  const r = run(process.execPath, [path.join(root, 'scripts', 'syntax-check.mjs'), '--root', good]);
  ok('语法门对健康目录返回0', r.code === 0, `退出码=${r.code} ${(r.err || '').slice(0, 120)}`);
}

// ========== 4. 真实仓库通过，且覆盖面不为零 ==========
{
  const r = run(process.execPath, [path.join(root, 'scripts', 'syntax-check.mjs')]);
  ok('真实仓库全量通过语法门', r.code === 0, (r.err || r.out).slice(0, 220));
  const n = Number((r.out.match(/(\d+)\s*个文件/) || [])[1] || 0);
  // 覆盖数骤降意味着遍历被改坏（例如扩展名过滤写错），门会退化成空跑
  ok(`语法门覆盖面合理（${n} 个文件 ≥ 170）`, n >= 170, `实际=${n}`);
}

// ========== 5. package.json 关键字段不得丢失 ==========
{
  const raw = fs.readFileSync(path.join(root, 'package.json'), 'utf8');
  const pkg = JSON.parse(raw);
  ok('package.json 声明 type=module（使宪法里的 node --check 真正生效）',
    pkg.type === 'module', `type=${pkg.type}`);
  ok('package.json 不声明 dependencies（宿主不会尝试安装）',
    !pkg.dependencies || Object.keys(pkg.dependencies).length === 0);
  ok('package.json 不声明 devDependencies（同上）',
    !pkg.devDependencies || Object.keys(pkg.devDependencies).length === 0);
  ok('scripts 提供 syntax / test / check', ['syntax', 'test', 'check'].every(k => typeof pkg.scripts?.[k] === 'string'));
  ok('package.json 与 manifest.json 版本一致', pkg.version === JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8')).version,
    `pkg=${pkg.version}`);
}

// ========== 6. .cjs 保持 CommonJS，不受 type=module 影响 ==========
{
  const cjsFiles = ['workers/openai-image-local-relay.cjs'];
  for (const f of cjsFiles) {
    const p = path.join(root, f);
    if (!fs.existsSync(p)) { ok(`${f} 存在`, false, '缺失'); continue; }
    const src = fs.readFileSync(p, 'utf8');
    ok(`${f} 仍为 CommonJS（require/module.exports）且被 .cjs 显式声明`,
      /\b(require\(|module\.exports)/.test(src) && f.endsWith('.cjs'));
  }
}

// ========== 7. 宪法文档需指向可生效的门 ==========
{
  const ctx = fs.readFileSync(path.join(root, 'CONTEXT.md'), 'utf8');
  ok('CONTEXT.md 发布链路写明强制 ESM 语法门（不再只写裸 node --check）',
    /syntax-check|npm run syntax/.test(ctx), '宪法仍可能引导使用假绿命令');
}

try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* 忽略 */ }

console.log(`\n${pass} 通过, ${fail} 失败`);
process.exit(fail > 0 ? 1 : 0);