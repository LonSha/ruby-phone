/* ============================================================
 * tests/system-v4980.test.mjs — R11-O4 与 R11-O5 验收套件
 * ------------------------------------------------------------
 * 覆盖：
 *   - R11-O5: PLAN 基线表接机器台账（消灭 v3.74.0，手改或读数漂移即红）
 *   - R11-O4: 文档与源码路径声明必须存在（doc-path-claim-audit，区分本仓/上游）
 * ============================================================ */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { computePlanBaseline, checkPlanBaseline } from '../tools/gen_plan_baseline.mjs';
import { auditDocPathClaims } from '../scripts/doc-path-claim-audit.mjs';

const __dir = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dir, '..');

/* ------------------------------------------------------------
 * A 组：R11-O5 · PLAN 基线表接机器台账
 * ------------------------------------------------------------ */
test('A1: PLAN.md 现状基线表三行必须与机器台账及磁盘现状完全吻合', () => {
  const chk = checkPlanBaseline();
  assert.equal(
    chk.ok,
    true,
    'PLAN.md 现状基线表不应与机器台账漂移：' + (chk.errors || []).join('; ')
  );
});

test('A2: PLAN.md 读数必须反映当前最新版本与真实体量，不得滞留在 v3.74.0 历史旧读数', () => {
  const planContent = fs.readFileSync(path.join(ROOT, 'PLAN.md'), 'utf8');
  assert.ok(
    !/\|\s*版本\s*\|\s*\*\*v3\.74\.0\*\*/.test(planContent),
    'PLAN.md 现状基线表不得再滞留 v3.74.0'
  );
  assert.ok(
    !/apps\s+\*\*81\s+个\s*App\s*目录\*\*/.test(planContent),
    'PLAN.md 现状基线表不得再滞留 apps 81 历史旧读数'
  );

  const baseline = computePlanBaseline();
  assert.ok(
    planContent.includes(`**v${baseline.raw.version}**`),
    `PLAN.md 必须包含当前版本号 **v${baseline.raw.version}**`
  );
  assert.ok(
    planContent.includes(`apps **${baseline.raw.appDirs} 个 App 目录**`),
    `PLAN.md 必须包含真实 App 目录数 **${baseline.raw.appDirs} 个 App 目录**`
  );
});

test('A3: 负控制 — 篡改 PLAN.md 基线表读数后，checkPlanBaseline 必须精准转红', () => {
  const planPath = path.join(ROOT, 'PLAN.md');
  const original = fs.readFileSync(planPath, 'utf8');
  /* [v4.99.1 夹具修复] 「恢复内容 ≠ 恢复树」：写回原内容后 mtime 必然变化，
   * 与并发跑批的隔离快照（v315 B1 按 size:mtimeMs 对账）互踩 ⇒ 偶发假红
   * （报「跑批改动了仓库：PLAN.md」，而内容其实已还原）。恢复 mtime 后，
   * 本测试对树的观察面与跑批前逐格一致。 */
  const origStat = fs.statSync(planPath);
  try {
    // 篡改版本为 v0.0.0-tampered
    const tampered = original.replace(/\|\s*版本\s*\|.*\|/, '| 版本 | **v0.0.0-tampered** | `test` |');
    fs.writeFileSync(planPath, tampered, 'utf8');
    const chk = checkPlanBaseline();
    assert.equal(chk.ok, false, '被篡改后 checkPlanBaseline 必须返回 false');
    assert.ok(
      chk.errors.some(e => e.includes('版本读数未对齐')),
      '必须精准报错点名版本读数未对齐'
    );
  } finally {
    fs.writeFileSync(planPath, original, 'utf8');
    try { fs.utimesSync(planPath, origStat.atime, origStat.mtime); } catch (_e) { /* 尽力恢复 */ }
  }
});

/* ------------------------------------------------------------
 * B 组：R11-O4 · 文档路径声明必须存在与上游引用合法性
 * ------------------------------------------------------------ */
test('B1: 全仓文档与源码中声明的 tests/scripts/tools 路径必须 0 未登记落空', () => {
  const res = auditDocPathClaims(ROOT);
  assert.equal(res.status, 'ok', '审计状态必须为 ok');
  assert.equal(res.exitCode, 0, '退出码必须为 0');
  assert.equal(res.violations.length, 0, '未登记落空违规数必须为 0');
  assert.ok(res.totalClaims > 3000, '总路径声明数必须 > 3000');
  assert.ok(res.localClaims > 3000, '本地有效声明数必须 > 3000');
  assert.ok(res.upstreamClaims > 0, '上游合法声明数必须 > 0');
});

test('B2: config/app-library.js 与 config/app-surfaces.js 中的判据声明必须指向真实文件', () => {
  const libSrc = fs.readFileSync(path.join(ROOT, 'config/app-library.js'), 'utf8');
  const surfSrc = fs.readFileSync(path.join(ROOT, 'config/app-surfaces.js'), 'utf8');

  assert.ok(
    !libSrc.includes('tests/system-v4870.test.mjs'),
    'config/app-library.js 不得再声称不存在的 tests/system-v4870.test.mjs'
  );
  assert.ok(
    !surfSrc.includes('tests/system-v4870.test.mjs'),
    'config/app-surfaces.js 不得再声称不存在的 tests/system-v4870.test.mjs'
  );

  assert.ok(
    libSrc.includes('tests/system-v4920.test.mjs'),
    'config/app-library.js 应正确声明真实存在的 tests/system-v4920.test.mjs'
  );
  assert.ok(
    surfSrc.includes('tests/system-v4920.test.mjs'),
    'config/app-surfaces.js 应正确声明真实存在的 tests/system-v4920.test.mjs'
  );
});

test('B3: 负控制 — 虚构落空本仓路径必须报红，而带有 upstream: 前缀必须合法放行', () => {
  const tmpDir = path.join(ROOT, 'node_modules', '.tmp_doc_audit_fixture');
  fs.mkdirSync(tmpDir, { recursive: true });
  const fakeBadPath = 'tests/' + 'non-existent-probe-v9999.test.mjs';
  try {
    // 构造虚构的文档文件
    const testDoc = path.join(tmpDir, 'sample-test-note.md');
    fs.writeFileSync(
      testDoc,
      '# Test Note\n' +
      '引用虚构的本仓路径：`' + fakeBadPath + '` 会被抓。\n' +
      '引用合法的上游路径：`upstream:tests/audit/scan_cross_repo_binding.mjs` 会放行。\n',
      'utf8'
    );

    // 在临时夹具中执行审计（需传入 fixture=true 以豁免最小文件数检查）
    const res = auditDocPathClaims(tmpDir, { fixture: true });
    assert.equal(res.status, 'violation', '存在未登记的本地落空路径时必须返回 violation');
    assert.equal(res.exitCode, 1, '退出码必须为 1');
    assert.equal(res.violations.length, 1, '应当只抓出 1 处未登记落空');
    assert.equal(res.violations[0].claimPath, fakeBadPath);
    assert.equal(res.upstreamClaims, 1, '带 upstream: 的引用必须被正确识别为合法上游声明');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('B4: 负控制 — 扫描面塌陷时必须 fail-closed（exit 2），杜绝探测器空跑假绿', () => {
  const emptyDir = path.join(ROOT, 'node_modules', '.tmp_doc_audit_empty');
  fs.mkdirSync(emptyDir, { recursive: true });
  try {
    const res = auditDocPathClaims(emptyDir);
    assert.equal(res.status, 'fail_closed', '扫描文件数过少时必须判定为 fail_closed');
    assert.equal(res.exitCode, 2, '退出码必须为 2');
  } finally {
    fs.rmSync(emptyDir, { recursive: true, force: true });
  }
});