#!/usr/bin/env node
/**
 * scripts/doc-path-claim-audit.mjs — 文档与源码中声明的路径存活性审计（R11-O4）
 *
 * 为什么存在（Problem 6 / R11-O4）：
 *   散文声称有判据看守，但对应文件不存在（如曾经在 app-library.js / app-surfaces.js
 *   声称 `tests/system-v4870.test.mjs` 会校验，但磁盘并无该文件）。
 *   另一类是上游路径声明（如 `tests/audit/scan_cross_repo_binding.mjs` 属上游仓，正当引用）。
 *   本门对全仓文档与源码中出现的 `tests/`、`scripts/`、`tools/` 路径声明进行存活性审计：
 *   - 本仓声明必须真实存在于磁盘；
 *   - 上游引用必须显式标注 `upstream:` 前缀或在 baseline.upstream_allowed 登记；
 *   - 规范别名、测试占位夹具、历史存量需在台账 baseline 中显式登记；
 *   - 任何新增且未登记的落空路径声明直接报红（exit 1）；
 *   - 扫描面塌陷（文件数低于阈值）fail-closed（exit 2）。
 *
 * 退出码：0 通过 / 1 有未登记缺失路径 / 2 结构失效（fail-closed）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dir = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dir, '..');
const BASELINE_PATH = path.join(__dir, 'doc-path-claim-baseline.json');

const args = process.argv.slice(2);
const rootIdx = args.indexOf('--root');
const root = rootIdx >= 0 ? path.resolve(args[rootIdx + 1]) : ROOT;
const isFixture = args.includes('--fixture');
const updateMode = args.includes('--update') || args.includes('--write');

const MIN_FILES = 500;

function walk(dir, baseDir = dir) {
  let res = [];
  for (const n of fs.readdirSync(dir)) {
    if (n === 'node_modules' || n === '.git' || n === 'dist' || n === '.wrangler') continue;
    const p = path.join(dir, n);
    let st;
    try { st = fs.statSync(p); } catch (_e) { continue; }
    if (st.isDirectory()) {
      res = res.concat(walk(p, baseDir));
    } else if (/\.(md|js|mjs|cjs|json)$/.test(n)) {
      res.push(path.relative(baseDir, p));
    }
  }
  return res;
}

export function auditDocPathClaims(targetRoot = root, opts = {}) {
  const baseline = JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8'));
  const upstreamAllowed = new Set(baseline.upstream_allowed || []);
  const fixtures = new Set(baseline.fixtures_or_placeholders || []);
  const aliases = baseline.known_aliases || {};
  const historical = new Set((baseline.historical_records || []).map(r => r.path));

  const skip = new Set(opts.skipFiles || []);
  const allFiles = walk(targetRoot).filter(f => !f.startsWith('tests/audit/') && f !== 'scripts/doc-path-claim-baseline.json' && !skip.has(f));
  if (allFiles.length < MIN_FILES && !isFixture && !opts.fixture) {
    return {
      status: 'fail_closed',
      exitCode: 2,
      error: `扫描面文件数过低 (${allFiles.length} < ${MIN_FILES})，结构失效 fail-closed`,
    };
  }

  const pathRegex = /(upstream:)?((?:tests|scripts|tools)\/[A-Za-z0-9_\/-]+(?:\.[A-Za-z0-9_\-]+)*\.(?:mjs|cjs|js|json|md|py|sh|tsv))\b/g;

  const violations = [];
  let totalClaims = 0;
  let upstreamClaims = 0;
  let localClaims = 0;

  for (const rel of allFiles) {
    const full = path.join(targetRoot, rel);
    let content;
    try { content = fs.readFileSync(full, 'utf8'); } catch (_e) { continue; }

    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      let m;
      while ((m = pathRegex.exec(line)) !== null) {
        totalClaims++;
        const isExplicitUpstream = Boolean(m[1]);
        const claimPath = m[2];

        // 1. 显式 upstream 或台账登记 upstream
        if (isExplicitUpstream || upstreamAllowed.has(claimPath)) {
          upstreamClaims++;
          continue;
        }

        // 2. 本地真实存在
        if (fs.existsSync(path.join(targetRoot, claimPath))) {
          localClaims++;
          continue;
        }

        // 3. 别名映射且真实存在
        if (aliases[claimPath] && fs.existsSync(path.join(targetRoot, aliases[claimPath]))) {
          localClaims++;
          continue;
        }

        // 4. 夹具占位符
        if (fixtures.has(claimPath)) {
          continue;
        }

        // 5. 历史归档存量
        if (historical.has(claimPath)) {
          continue;
        }

        // 6. 未登记的落空声明
        violations.push({
          file: rel,
          line: i + 1,
          claimPath,
          fullMatch: m[0],
        });
      }
    }
  }

  return {
    status: violations.length === 0 ? 'ok' : 'violation',
    exitCode: violations.length === 0 ? 0 : 1,
    totalClaims,
    upstreamClaims,
    localClaims,
    violations,
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const res = auditDocPathClaims(root);
  if (res.status === 'fail_closed') {
    console.error(`[doc-path-claim-audit] FAIL-CLOSED: ${res.error}`);
    process.exit(2);
  }
  if (res.violations.length > 0) {
    console.error(`[doc-path-claim-audit] 发现 ${res.violations.length} 处未登记的路径落空声明：`);
    for (const v of res.violations) {
      console.error(`  - ${v.file}:${v.line} -> ${v.claimPath}`);
    }
    process.exit(1);
  }
  console.log(`[doc-path-claim-audit] 检查通过：共扫描 ${res.totalClaims} 处声明（本仓 ${res.localClaims} 处，上游 ${res.upstreamClaims} 处），0 未登记落空。`);
  process.exit(0);
}