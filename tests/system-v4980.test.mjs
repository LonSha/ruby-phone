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

/* ------------------------------------------------------------
 * C 组：计划交付物台账（R13-O7 配套）—— 门禁不是避难所
 * ------------------------------------------------------------
 * 背景：v13 计划文档声明了若干「未来才落地」的交付物路径，被 R11-O4 判红。
 * 语义上它们既不是历史存量（曾经存在、现已删除），也不是夹具占位，
 * 故新增 planned 台账；本组四道判据守住这一类不被滥用。
 * ------------------------------------------------------------ */
const PLANNED_ABS = path.join(ROOT, 'scripts/doc-path-claim-planned-deliverables.json');

test('C1: 计划交付物台账必须合法，且当期计划声明的未来路径被放行而非当违规', () => {
  const ledger = JSON.parse(fs.readFileSync(PLANNED_ABS, 'utf8'));
  assert.equal(ledger.schema, 'doc-path-claim-planned@1', '台账 schema 锚必须正确');
  assert.ok(Array.isArray(ledger.entries) && ledger.entries.length > 0, '台账须至少登记一条当期计划交付物');
  assert.ok(ledger.entries.length <= 24, '计划交付物条数有上限，杜绝堆成避难所');
  for (const e of ledger.entries) {
    for (const k of ['path', 'plan', 'epoch', 'land_version', 'date', 'why']) {
      assert.ok(e[k], `条目 ${e.path || '(无 path)'} 缺字段 ${k}`);
    }
    assert.ok(
      fs.existsSync(path.join(ROOT, e.plan)),
      `条目 ${e.path} 的计划文档 ${e.plan} 必须真实存在`
    );
    assert.ok(
      !fs.existsSync(path.join(ROOT, e.path)),
      `条目 ${e.path} 不得已经落在磁盘上（落地即须移出台账）`
    );
  }

  const res = auditDocPathClaims(ROOT);
  assert.equal(res.plannedErrors.length, 0, '真台账不应有失格条目：' + res.plannedErrors.join('; '));
  assert.equal(res.violations.length, 0, '计划声明的未来路径不得再被算作违规');
  assert.equal(res.exitCode, 0, '真仓当前必须 exit 0');
  assert.ok(res.plannedClaims > 0, '当期计划声明的未来路径应当被计入 plannedClaims');
});

test('C2: 负控制 — 已到期的计划交付物条目必须自曝报红（exit 1）', () => {
  const tmpDir = path.join(ROOT, 'node_modules', '.tmp_planned_due');
  const tmpLedger = path.join(ROOT, 'node_modules', '.tmp_planned_due.json');
  fs.mkdirSync(tmpDir, { recursive: true });
  const claim = 'tests/audit/' + 'probe-due-v9999.tsv';
  try {
    fs.writeFileSync(
      tmpLedger,
      JSON.stringify({
        schema: 'doc-path-claim-planned@1',
        entries: [
          {
            path: claim, plan: 'PLAN.md', epoch: 'R99',
            land_version: 'v0.0.1', date: '2026-01-01', why: 'negative control',
          },
        ],
      }),
      'utf8'
    );
    fs.writeFileSync(path.join(tmpDir, 'note.md'), '计划声明 `' + claim + '`。\n', 'utf8');

    const res = auditDocPathClaims(tmpDir, { fixture: true, plannedLedgerPath: tmpLedger });
    assert.equal(res.plannedErrors.length, 1, '到期条目必须报失格');
    assert.match(res.plannedErrors[0], /已到期/, '失格原因须点名到期');
    assert.equal(res.status, 'violation', '有失格条目时状态不得为 ok');
    assert.equal(res.exitCode, 1, '到期条目必须 exit 1');
    // 到期即移出放行集 ⇒ 该路径退回普通违规（不静默放行，这是自锁的本意）
    assert.equal(res.violations.length, 1, '到期条目必须退回违规');
    assert.equal(res.violations[0].claimPath, claim, '退回违规的必须是同一条路径');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.rmSync(tmpLedger, { force: true });
  }
});

test('C3: 负控制 — 已落地路径的台账条目必须移除（留着即报红）', () => {
  const tmpDir = path.join(ROOT, 'node_modules', '.tmp_planned_landed');
  const tmpLedger = path.join(ROOT, 'node_modules', '.tmp_planned_landed.json');
  fs.mkdirSync(tmpDir, { recursive: true });
  const landed = 'tests/system-v4980.test.mjs';
  try {
    fs.writeFileSync(
      tmpLedger,
      JSON.stringify({
        schema: 'doc-path-claim-planned@1',
        entries: [
          {
            path: landed, plan: 'PLAN.md', epoch: 'R99',
            land_version: 'v999.0.0', date: '2026-01-01', why: 'negative control',
          },
        ],
      }),
      'utf8'
    );
    fs.writeFileSync(path.join(tmpDir, 'note.md'), '判据见 `' + landed + '`。\n', 'utf8');

    const res = auditDocPathClaims(tmpDir, { fixture: true, plannedLedgerPath: tmpLedger });
    assert.equal(res.plannedErrors.length, 1, '已落地条目必须报失格');
    assert.match(res.plannedErrors[0], /已落地/, '失格原因须点名已落地');
    assert.equal(res.exitCode, 1, '已落地仍留在台账必须 exit 1');
    // 夹具根是 tmpDir，该路径在此根下不存在；且条目已移出放行集 ⇒ 退回违规
    assert.equal(res.violations.length, 1, '已落地条目在夹具根下须退回违规');
    assert.equal(res.violations[0].claimPath, landed, '退回违规的必须是同一条路径');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.rmSync(tmpLedger, { force: true });
  }
});

test('C4: 负控制 — 计划文档不在场的条目不算数，路径退回违规', () => {
  const tmpDir = path.join(ROOT, 'node_modules', '.tmp_planned_nodoc');
  const tmpLedger = path.join(ROOT, 'node_modules', '.tmp_planned_nodoc.json');
  fs.mkdirSync(tmpDir, { recursive: true });
  const claim = 'tests/audit/' + 'probe-nodoc-v9999.tsv';
  const ghostPlan = '.agents/notes/proposed/architecture/' + '2026-13-ghost-plan.md';
  try {
    fs.writeFileSync(
      tmpLedger,
      JSON.stringify({
        schema: 'doc-path-claim-planned@1',
        entries: [
          {
            path: claim, plan: ghostPlan, epoch: 'R99',
            land_version: 'v999.0.0', date: '2026-01-01', why: 'negative control',
          },
        ],
      }),
      'utf8'
    );
    fs.writeFileSync(path.join(tmpDir, 'note.md'), '计划声明 `' + claim + '`。\n', 'utf8');

    const res = auditDocPathClaims(tmpDir, { fixture: true, plannedLedgerPath: tmpLedger });
    assert.equal(res.plannedErrors.length, 1, '计划文档缺位的条目必须报失格');
    assert.match(res.plannedErrors[0], /计划文档/, '失格原因须点名计划文档不在场');
    assert.equal(res.violations.length, 1, '条目失效后该路径必须退回违规');
    assert.equal(res.violations[0].claimPath, claim, '退回违规的必须是同一条路径');
    assert.equal(res.exitCode, 1, '必须 exit 1');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.rmSync(tmpLedger, { force: true });
  }
});
