/* ============================================================
 * 语法门性能层回归（v2.40.0）
 * ------------------------------------------------------------
 * 背景：scripts/syntax-check.mjs 旧实现逐文件 spawn `node --check`，
 * 251 文件 = 251 个子进程，单次扫描 ~16.7s。本次改为本进程内 vm
 * 批量解析 + 失败文件回退。本测试锁定：① 性能不退化；② 与旧
 * per-file 判定逐文件等价；③ 拦截能力六态不丢；④ 负控制证明本测试
 * 真能发现「快筛被改成恒过」。
 *
 * 判定策略沿用 v392 的三条实测结论（勿凭直觉改动）：
 *   一律 ESM 强解析、不用 CJS→ESM 自适应、不自写 tokenizer。
 * ============================================================ */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const GATE = path.join(root, 'scripts', 'syntax-check.mjs');
let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`✓ ${name}`); }
  else { fail++; console.log(`✗ ${name} ${detail}`); }
};

const runGate = (args = []) => {
  try {
    const out = execFileSync(process.execPath, [GATE, ...args], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
    return { code: 0, out: String(out), err: '' };
  } catch (e) {
    return { code: typeof e.status === 'number' ? e.status : 1, out: String(e.stdout || ''), err: String(e.stderr || e.message) };
  }
};

const BROKEN_ESM = 'import fs from "node:fs";\nexport class A {\n  m() {\n    Promise.resolve().catch(() => {\n      }                } else if (x) {\n    }););\n  }\n}\n';
const HEALTHY_ESM = 'export class H { m() { return 1; } }\n';

// ========== A. 性能不退化 ==========
{
  const t0 = Date.now();
  const r = runGate();
  const dt = Date.now() - t0;
  ok(`A1 全量扫描 <6000ms（旧实现 ~16700ms；阈值两头留 2× 余量）`, dt < 6000, `实际=${dt}ms`);
  ok('A2 全量扫描通过', r.code === 0, (r.err || r.out).slice(0, 160));

  const src = fs.readFileSync(GATE, 'utf8');
  ok('A3 源码保留 vm 批量快筛路径（vm.SourceTextModule）', /vm\.SourceTextModule/.test(src));
  ok('A4 源码保留失败回退路径（checkEsm per-file --check）', /function checkEsm/.test(src) && /--input-type=module/.test(src));
  ok('A5 缺 --experimental-vm-modules 标志时自 re-exec 且有防递归哨兵',
    /RP_SYNTAX_GATE_REEXEC/.test(src) && /spawnSync/.test(src));
}

// ========== B. 与 per-file 判定逐文件等价 ==========
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rp-equiv-'));
  const cases = [
    ['broken-esm.mjs', BROKEN_ESM],
    ['healthy-esm.mjs', HEALTHY_ESM],
    ['broken-cjs.js', 'const x = {a: 1};\nfunction f( {\n}\n'],
    ['healthy-cjs.js', 'const x = { a: 1 };\nmodule.exports = x;\n'],
  ];
  for (const [n, s] of cases) fs.writeFileSync(path.join(tmp, n), s);
  fs.writeFileSync(path.join(tmp, 'package.json'), JSON.stringify({ type: 'module' }));

  const gate = runGate(['--root', tmp]);
  // 逐文件权威判定（复制门自身用的 per-file 命令）
  let refFail = 0;
  for (const [n] of cases) {
    const p = path.join(tmp, n);
    try {
      execFileSync(process.execPath, ['--input-type=module', '--check'], { input: fs.readFileSync(p), stdio: ['pipe', 'pipe', 'pipe'] });
    } catch { refFail++; }
  }
  const gateFail = (gate.err.match(/^  \S+?\.m?js/gm) || []).length;
  ok(`B1 混合目录（2 损坏 / 2 健康）门判定与 per-file 判定一致（参考失败=${refFail}）`,
    gateFail === refFail && refFail === 2, `门报失败=${gateFail} 门退出码=${gate.code}`);
  fs.rmSync(tmp, { recursive: true, force: true });
}

// ========== C. 能力六态 ==========
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rp-cap-'));

  const dBroken = path.join(tmp, 'broken'); fs.mkdirSync(dBroken);
  fs.writeFileSync(path.join(dBroken, 'broken.js'), BROKEN_ESM);
  const rB = runGate(['--root', dBroken]);
  ok('C1 损坏 ESM 返回非 0', rB.code !== 0, `code=${rB.code}`);
  ok('C2 报出具体文件名', /broken\.js/.test(rB.err), rB.err.slice(0, 120));
  ok('C3 报出行号（约第 N 行）', /约第 \d+ 行/.test(rB.err), rB.err.slice(0, 160));

  const dGood = path.join(tmp, 'good'); fs.mkdirSync(dGood);
  fs.writeFileSync(path.join(dGood, 'good.js'), HEALTHY_ESM);
  const rG = runGate(['--root', dGood]);
  ok('C4 健康 ESM 返回 0 且不误伤', rG.code === 0 && /1 个文件/.test(rG.out), rG.err.slice(0, 120));

  // IIFE/CJS 风格 .js（无 import/export）不应因强 ESM 解析而误报
  const dIife = path.join(tmp, 'iife'); fs.mkdirSync(dIife);
  fs.writeFileSync(path.join(dIife, 'iife.js'), '(function(){ var a = 1; return a; })();\nif (typeof module !== "undefined") module.exports = {};\n');
  const rI = runGate(['--root', dIife]);
  ok('C5 IIFE/CJS 风格 .js 在强 ESM 下不误报', rI.code === 0, rI.err.slice(0, 140));

  // 伪指令/假损坏不误伤：合法指令 + 字符串里的坏片段
  const dFake = path.join(tmp, 'fake'); fs.mkdirSync(dFake);
  fs.writeFileSync(path.join(dFake, 'f.js'), '#!/usr/bin/env node\n"use strict";\nexport const s = "} else if (x) {";\n');
  const rF = runGate(['--root', dFake]);
  ok('C6 合法 shebang + 字符串内含坏片段不误伤', rF.code === 0, rF.err.slice(0, 140));

  const rM = runGate(['--root', path.join(tmp, 'nope-xyz')]);
  ok('C7 --root 不存在返回 rc=2', rM.code === 2, `code=${rM.code}`);

  fs.rmSync(tmp, { recursive: true, force: true });
}

// ========== D. 负控制：本测试真能发现「快筛被改成恒过」 ==========
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rp-neg-'));
  const src = fs.readFileSync(GATE, 'utf8');
  const ANCHOR = 'const fast = parseOne(file, src);';
  const hits = src.split(ANCHOR).length - 1;
  ok('D1 破坏锚点在真源码中恰中 1 次', hits === 1, `命中=${hits}`);

  if (hits === 1) {
    // 破坏副本：把快筛改成恒过（模拟门退化）
    const brokenSrc = src.replace(ANCHOR, 'const fast = { ok: true };');
    const gDir = path.join(tmp, 'gate'); fs.mkdirSync(gDir);
    const gPath = path.join(gDir, 'syntax-check.mjs');
    fs.writeFileSync(gPath, brokenSrc);

    const dBroken = path.join(tmp, 'broken'); fs.mkdirSync(dBroken);
    fs.writeFileSync(path.join(dBroken, 'broken.js'), BROKEN_ESM);

    const runBrokenGate = () => {
      try {
        const out = execFileSync(process.execPath, [gPath, '--root', dBroken], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
        return { code: 0, out: String(out) };
      } catch (e) {
        return { code: typeof e.status === 'number' ? e.status : 1, out: String(e.stdout || '') };
      }
    };
    const rb = runBrokenGate();
    ok('D2 破坏副本（快筛恒过）对损坏文件放行（退出码 0）——证明本测试的 C1 判据真有效',
      rb.code === 0, `code=${rb.code}（若不为 0，说明破坏未生效，C1 可能假绿）`);

    // 原版同一目录必须拒绝
    const rOrig = runGate(['--root', dBroken]);
    ok('D3 原版门在同一目录仍正确拒绝（否则破坏不可观测）', rOrig.code !== 0, `code=${rOrig.code}`);

    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// ========== E. 版本三源一致 ==========
{
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const man = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
  const ul = JSON.parse(fs.readFileSync(path.join(root, 'update-log.json'), 'utf8'));
  ok('E1 package.json / manifest.json 版本一致', pkg.version === man.version, `pkg=${pkg.version} man=${man.version}`);
  ok('E2 update-log 存在对应版本条目', !!ul.versions[pkg.version], `缺 ${pkg.version}`);
}

console.log(`\n${pass} 通过, ${fail} 失败`);
process.exit(fail > 0 ? 1 : 0);