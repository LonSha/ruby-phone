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
 *   - 计划文档声明的「未来交付物」另立台账 doc-path-claim-planned-deliverables.json，
 *     该台账自带到期自锁：已落地 / 已到期 / 计划文档不在场 / 字段缺失的条目一律报红，
 *     故本类不得当作「计划里随便写个路径」的避难所（R13-O7 配套）。
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
const PLANNED_DELIVERABLES_PATH = path.join(__dir, 'doc-path-claim-planned-deliverables.json');
const PLANNED_REL = 'scripts/doc-path-claim-planned-deliverables.json';
const PLANNED_SCHEMA = 'doc-path-claim-planned@1';
const MAX_PLANNED = 24;

function cmpVer(a, b) {
  const pa = String(a).replace(/^v/, '').split('.').map(Number);
  const pb = String(b).replace(/^v/, '').split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const x = pa[i] || 0;
    const y = pb[i] || 0;
    if (x !== y) return x - y;
  }
  return 0;
}

function manifestVersion() {
  try {
    return JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
  } catch (_e) {
    return '0.0.0';
  }
}

/**
 * 读取「计划交付物」台账。只有同时满足下列条件的条目才被放行：
 *   1. 计划文档（plan）真实存在于本仓；
 *   2. 目标路径此刻尚未落地（一旦落地须从台账移除，改用真实文件判据）；
 *   3. 当前 manifest 版本尚未达到 land_version（到期即须移除）；
 *   4. 六个字段齐全，且总条数不超过 MAX_PLANNED。
 * 任何不满足都进 errors（调用方据此报红），不会静默放行。
 */
function loadPlannedLedger(ledgerPath) {
  const allowed = new Set();
  const errors = [];
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
  } catch (_e) {
    return { allowed, errors, entries: 0 };
  }
  if (raw.schema !== PLANNED_SCHEMA) {
    errors.push(`台账 schema 必须是 ${PLANNED_SCHEMA}，实际 ${JSON.stringify(raw.schema)}`);
  }
  const list = Array.isArray(raw.entries) ? raw.entries : [];
  if (list.length > MAX_PLANNED) {
    errors.push(`计划交付物 ${list.length} 条 > 上限 ${MAX_PLANNED}：本类只登记计划文档已声明的近期待落地物`);
  }
  const mv = manifestVersion();
  for (const e of list) {
    const p = String((e && e.path) || '');
    const need = ['path', 'plan', 'epoch', 'land_version', 'date', 'why'];
    const miss = need.filter(k => !(e && e[k]));
    if (miss.length) {
      errors.push(`条目 ${p || '(无 path)'} 缺字段：${miss.join('/')}`);
      continue;
    }
    if (!fs.existsSync(path.join(ROOT, e.plan))) {
      errors.push(`条目 ${p} 的计划文档 ${e.plan} 不在场，该声明退回违规`);
      continue;
    }
    if (fs.existsSync(path.join(ROOT, p))) {
      errors.push(`条目 ${p} 已落地在磁盘，须移出台账并改用真实文件判据`);
      continue;
    }
    if (cmpVer(mv, e.land_version) >= 0) {
      errors.push(`条目 ${p} 已到期：当前 ${mv} 已达/越过落地版本 ${e.land_version}`);
      continue;
    }
    allowed.add(p);
  }
  return { allowed, errors, entries: list.length };
}

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
  const plannedLedger = loadPlannedLedger(opts.plannedLedgerPath || PLANNED_DELIVERABLES_PATH);
  const planned = plannedLedger.allowed;

  const skip = new Set(opts.skipFiles || []);
  const allFiles = walk(targetRoot).filter(f => !f.startsWith('tests/audit/') && f !== 'scripts/doc-path-claim-baseline.json' && f !== PLANNED_REL && !skip.has(f));
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
  let plannedClaims = 0;

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

        // 6. 计划交付物（计划文档已声明、此刻尚未落地；台账自带到期自锁）
        if (planned.has(claimPath)) {
          plannedClaims++;
          continue;
        }

        // 7. 未登记的落空声明
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
    status: violations.length === 0 && plannedLedger.errors.length === 0 ? 'ok' : 'violation',
    exitCode: violations.length === 0 && plannedLedger.errors.length === 0 ? 0 : 1,
    totalClaims,
    upstreamClaims,
    localClaims,
    plannedClaims,
    plannedErrors: plannedLedger.errors,
    violations,
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const res = auditDocPathClaims(root);
  if (res.status === 'fail_closed') {
    console.error(`[doc-path-claim-audit] FAIL-CLOSED: ${res.error}`);
    process.exit(2);
  }
  if (res.plannedErrors.length > 0) {
    console.error(`[doc-path-claim-audit] 计划交付物台账 ${res.plannedErrors.length} 处失格（已落地/已到期/计划文档不在场/字段缺失）：`);
    for (const e of res.plannedErrors) console.error(`  - ${e}`);
  }
  if (res.violations.length > 0) {
    console.error(`[doc-path-claim-audit] 发现 ${res.violations.length} 处未登记的路径落空声明：`);
    for (const v of res.violations) {
      console.error(`  - ${v.file}:${v.line} -> ${v.claimPath}`);
    }
  }
  if (res.violations.length > 0 || res.plannedErrors.length > 0) {
    process.exit(1);
  }
  console.log(`[doc-path-claim-audit] 检查通过：共扫描 ${res.totalClaims} 处声明（本仓 ${res.localClaims} 处，上游 ${res.upstreamClaims} 处，计划交付物 ${res.plannedClaims} 处），0 未登记落空。`);
  process.exit(0);
}