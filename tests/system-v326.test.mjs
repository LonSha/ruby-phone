// tests/system-v326.test.mjs — F-1 分支与玩法可行性取证 [v3.9.0]
//   [v3.11.0 交棒] F-1 的**替代轴**（回滚影响的可见性提升）已在 v3.11.0 落地：真源
//     `config/rollback-preview.js` + 诊断面接线。故本版把两条判据由「零命中」主动改写为
//     「下限 / 例外面」形（A2 的预览读数、B1 的 token 面），**而非静默通过** ——
//     改写处的注释写明代价与理由。同族前例：v326-B1 / v327-E1 / v328-B2 / v268-P1 / v3210-G1。
//
//   本版**只取证，不实施**。TODO F 批最后一项 F-1「分支与玩法（R4 第一批）：
//   持久检查点 / 回滚预览 / 分支只读对照」一直挂着「先取证再立 Gate」。
//
//   本轮结论（三件里两件**要接的面不存在**、第三件**面上没有内容**）：
//     ① 持久检查点：上游 65 个模块里以 checkpoint / 存档点 为名的**零个**；
//        分支态唯一载体 branch-guard 是**内存态 Map**（TTL 3 分钟、上限 200 条、零持久化 token）。
//     ② 回滚预览：分支 / 回滚域 18 个模块内 dryRun / 预检 / 干跑 / 预演**零命中**；
//        `replayDrop(host, floor, registry)` 形参无 opts、调用即真撤。
//     ③ 分支只读对照：两模块**运行时可达**（真加载真调用验证：9 + 8 个 API 键），
//        但 `stats()` 只出七个数（楼层号与计数、**无内容**）⇒ 那是仪表读数，不是对照。
//     ④ 下游已有强基础：41 个回滚点 / 4 文件 / 12 入口定义 / 89 条会话隔离正则 / 5 处命名空间守卫。
//
//   覆盖：
//     A 基线齐备 + 读数可复算（含跑两次逐字节相同）+ 判定挂在读数上 + 未给上游根不假绿
//     B 回写防护：产品代码零改动 / 无 F-1 三件 / 无兄弟仓硬编码 / 探针位置无关
//     C 结论面（not_now 必须给出三类证据 + 替代轴 + not_blocked_by）
//     D 负控制五条（真源码破坏 → 同款真判据转红；含 fail-closed 两条）
//   ★ [v3.64.0 交棒] A2 的第三条判据（`checkpointFaceHits` 下限 1）在本版改写为
//     「真源四出口在场 + 产品面真调用」—— 理由与代价见该判据处留档（探针补上块注释
//     纪律后该文本读数如实归零，原先那 1 点来自文件头规格注释）。
//     E 版本锚
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { copyTreeSafe } from './_mirror_tree.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const AUDIT = path.join(ROOT, 'tests', 'audit');
const PROBE = path.join(AUDIT, 'branch_play_probe.cjs');
const BASEF = path.join(AUDIT, 'branch_play_baseline.json');
const read = (p) => fs.readFileSync(p, 'utf8');
const PROBE_SRC = read(PROBE);
const IDX_SRC = read(path.join(ROOT, 'index.js'));

function runProbe(root, extra) {
  const args = [PROBE];
  if (root) args.push('--root', root);
  if (extra) args.push.apply(args, extra);
  args.push('--json');
  return spawnSync(process.execPath, args, { cwd: ROOT, encoding: 'utf8', timeout: 240000 });
}
const main = runProbe(null, null);
assert.equal(main.status, 0, '探针必须能跑通：' + String(main.stderr || '').slice(0, 300));
let rep;
try { rep = JSON.parse(main.stdout); } catch (e) { assert.fail('探针输出必须是 JSON：' + String(main.stdout).slice(0, 160)); }
const base = JSON.parse(read(BASEF));
const R = base.readings;

/* ── 夹具：只复制判据真正需要的输入面（index.js + apps/ + config/），走 os.tmpdir() ── */
const temps = [];
function makeCopy(withUpstream) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rp_f1_'));
  temps.push(dir);
  fs.copyFileSync(path.join(ROOT, 'index.js'), path.join(dir, 'index.js'));
  copyTreeSafe(path.join(ROOT, 'apps'), path.join(dir, 'apps'));
  copyTreeSafe(path.join(ROOT, 'config'), path.join(dir, 'config'));
  if (withUpstream) {
    /* 合成上游：只放探针真正要读的文件（branch-guard / ledger-replay / index.js） */
    const u = path.join(dir, '_upstream');
    fs.mkdirSync(u, { recursive: true });
    for (const f of ['branch-guard.js', 'ledger-replay.js', 'index.js', 'floor-ledger.js',
      'summary-provenance.js', 'changeset.js', 'schema-migration.js', 'stale-guard.js',
      'ledger-entity.js', 'evidence-workbench.js', 'settings-ui.js', 'archive-shift.js']) {
      const src = path.join(UP_ROOT(), f);
      if (fs.existsSync(src)) fs.copyFileSync(src, path.join(u, f));
    }
    return { dir: dir, upstream: u };
  }
  return { dir: dir, upstream: null };
}
function UP_ROOT() { return process.env.RP_UPSTREAM_ROOT || '/home/user/lonsha-memory-plugin'; }
process.on('exit', () => {
  for (const d of temps) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (_e) { /* 忽略 */ } }
});
/* 真源码破坏：锚点必须**恰中一次** */
function damage(rel, anchor, replacement) {
  const c = makeCopy(false);
  const p = path.join(c.dir, rel);
  const src = read(p);
  const hits = src.split(anchor).length - 1;
  assert.equal(hits, 1, '破坏锚点必须恰中 1 次（实测 ' + hits + '）：' + anchor.slice(0, 70));
  fs.writeFileSync(p, src.split(anchor).join(replacement));
  return { dir: c.dir, res: runProbe(c.dir, null) };
}

/* ══════════ A ── 基线与读数 ══════════ */
test('A1 基线齐备（读数 / 上游冻结证据 / 可达性 / 判定 / 修正 / 未做）', () => {
  for (const k of ['file', 'note', 'measured_at', 'probe', 'upstream_frozen', 'readings',
    'upstream_reach', 'criteria', 'verdict', 'corrections', 'not_done']) {
    assert.ok(base[k], '缺面：' + k);
  }
  for (const [k, v] of Object.entries(R)) {
    assert.ok(Number.isFinite(v) && v >= 0, 'readings.' + k + ' 必须是有限非负数');
  }
  const uf = base.upstream_frozen;
  assert.ok(uf.commit && uf.version, '上游冻结证据必须带版本与 commit（可追溯）');
  assert.ok(Array.isArray(uf.findings) && uf.findings.length >= 5, '上游发现必须逐条写明（≥5）');
  assert.ok(/位置无关|路径依赖|兄弟仓/.test(uf.why_frozen), '必须写明为什么冻结（跨仓路径纪律）');
  assert.ok(Array.isArray(base.corrections) && base.corrections.length >= 4, '修正面必须如实写下（≥4 条口径事故）');
  assert.ok(Array.isArray(base.not_done) && base.not_done.length >= 4, '必须如实写下没做什么');
  /* 可达性是本项的关键读数：不能只有「零命中」的结论，必须有「真加载过」的证据 */
  assert.equal(base.upstream_reach.branch_guard.loadable, true, 'branch-guard 必须真加载过');
  assert.equal(base.upstream_reach.ledger_replay.loadable, true, 'ledger-replay 必须真加载过');
  assert.ok(base.upstream_reach.branch_guard.api_keys >= 8, 'branch-guard API 键数必须记下');
  assert.ok(base.upstream_reach.ledger_replay.floor_owners >= 20, 'ledger-replay 登记账数必须记下');
});

test('A2 探针读数与基线逐项一致（读数可复算，防转写漂移）', () => {
  assert.equal(rep.filesScanned, R.files_scanned);
  assert.equal(rep.rollbackPoints, R.rollback_points);
  assert.equal(rep.rollbackFiles, R.rollback_files);
  assert.equal(rep.rollbackEntryDefs, R.rollback_entry_defs);
  assert.equal(rep.upstreamGlobalReadSites, R.upstream_global_read_sites);
  assert.equal(rep.chatDataPatterns, R.chat_data_patterns);
  assert.equal(rep.namespaceStoreSites, R.namespace_store_sites);
  assert.deepEqual(rep.rollbackFilesList, base.rollback_files_list);
  /* 枚举面自证：扫描器失效时会塌成 0 */
  assert.ok(rep.filesScanned > 150, '枚举面须 > 150 个文件，实测 ' + rep.filesScanned);
  assert.ok(rep.rollbackPoints > rep.rollbackFiles, '回滚点数须多于文件数（同一文件多点）');
  assert.ok(rep.chatDataPatterns > 50, '会话隔离正则须 > 50 条，实测 ' + rep.chatDataPatterns);
  /* 下游**没有** F-1 三件（本版只取证）—— 读到非 0 说明要么已实施要么判据被污染。
   * [v3.11.0 交棒] F-1 的**替代轴**（回滚影响的可见性提升）已在本版落地：真源
   *   `config/rollback-preview.js` + 诊断面接线 ⇒ `previewFaceHits` 必然非 0，
   *   这是「从只取证切到实施」的**预期代价**（本探针的刻度就是「回滚预览面有没有被做」）。
   *   故本判据由「必须为 0」改写为「**下限 + 不假零**」：
   *     · 下限：修订前实测 18 处（真源模块 + 两个诊断文件里的导出名与引用），
   *       只锁「不准塌成 0」（塌成 0 = 探针刻度失效或实现被摘掉）；
   *     · 不假零：改版本不得顺手把回滚覆盖面读数做小（真源模块只算不写，
   *       不该新增或减少回滚点）。精确读数由当版套件（v3213）接管。
   *   为何不删这条：删了就等于「主动取消观测」；改写为下限后它仍能抓住「实现被摘」与「探针失效」。
   *
   * [v3.20.2 交棒] 同一款改写本轮**第二次**发生，对象是 `checkpointFaceHits`：
   *   本版**有意**把上游 v3.252.0（F7 首阶段）的检查点内容级对照接进下游
   *   （新增只读真源 `config/checkpoint-content-contract.js` + 诊断中心接线）⇒ 该读数必然非 0。
   *   **红的原因不是判据坏了，是它量的那件事已发生**；故由「必须为 0」改写为「下限 + 不假零」。
   *   实测口径（本轮真跑基线复算，不是照抄）：`checkpointFaceHits` 0 → **1**
   *   （唯一增量来自那个新真源的读取面）；`previewFaceHits` **42 → 42 逐项不变**
   *   —— 同一轮它先虚涨到 45 过一次，归因**是注释**（探针只跳 `//` 行、**不跳块注释续行**），
   *   把注释措辞改掉后回落。这条把它写进留档：**探针的刻度是文本的**，注释也会进读数。
   *   精确读数由当版套件 `tests/system-v3202.test.mjs` 接管（18 条，含 4 条真源码破坏负控制）。 */
  /* ★ [v3.64.0 交棒] 本条由「探针文本计数的下限」改写为「真源出口 + 产品面真调用」。
   *   **为什么必须改**：`checkpointFaceHits` 是**文本子串计数**，而本探针（v3.64.0 前）
   *   只跳 `//` 行、**不剥块注释** ⇒ 它量的从来不是「有没有实施」，而是「有没有人在这份树的
   *   任意位置（含块注释散文）写过这个 token」。实测：唯一的 1 点命中来自
   *   `config/checkpoint-content-contract.js` 的文件头**规格注释** —— 那几行逐字写着
   *   「绝不碰 `saveCheckpoint` / `dropCheckpoint` 这类写面」，即它声明的是**没做**写面。
   *   v3.64.0 给探针补上块注释纪律（与 `schedule_conflict_probe.cjs` 的 v3.22.0 同款）后
   *   该读数如实归零 ⇒ 旧下限 1 翻红。**这不是「塌成 0」，是「原先那个 1 本来就是散文」**
   *   （本仓 v3.20.2 已为同一形态留过档：探针的刻度是文本的，注释也会进读数）。
   *   **为什么这样改**：按本仓纪律「优先交棒为版本无关的真判据」，且不取两条下策 ——
   *     删断言（= 洗断言）与「换个 token 把散文重新算绿」（= 把散文固化成读数）。
   *     新判据锚在**实现**上：① 真源四出口在场；② 产品面**真调用**（import 名不算消费）。
   *   同一件事 `scripts/bridge-contract-audit.mjs` 的 J13 已以更强形式守着
   *   （`[face: checkpointCompare] [reader: readLonshaCheckpointFace] [floor: 1]`，
   *   实测消费点 1、真源四出口在场）。旧判据「写 1 不留余量」的原意（少一个 = 那一面又回到
   *   零消费）由 J13 承接，本处另留**调用点级**贴身复核。
   *   ⚠ 代价如实记：本条不再能拦住「把实现删掉、把注释留下」这一形态 —— 但那种形态现在由
   *   真调用判据拦（删掉调用点即翻红），而**注释形态本来就不该被判据当成实现**。 */
  const cpSrc = read(path.join(ROOT, 'config', 'checkpoint-content-contract.js'));
  for (const fn of ['readLonshaCheckpointFace', 'readCheckpointContentDiff',
    'checkpointContentLines', 'checkpointFaceLine']) {
    assert.ok(new RegExp('export function ' + fn + '\\b').test(cpSrc),
      '检查点真源必须导出 ' + fn + '（缺一即该面被摘）');
  }
  assert.ok(/checkpointContentDiff|CHECKPOINT_DIFF_STATES/.test(cpSrc),
    '真源必须带深对照态（上游半成功与失败不同形）');
  const cpConsumer = read(path.join(ROOT, 'apps', 'diagnose', 'diagnose-data.js'));
  assert.ok(/readLonshaCheckpointFace\(/.test(cpConsumer),
    '产品面必须**真调用**检查点读面（import 进来的名字不算消费）—— '
    + '这是「下游已实施检查点内容级对照」此刻的**实现级**证据');
  assert.ok(/readCheckpointContentDiff\(/.test(cpConsumer),
    '产品面必须真调用深对照读数（只读一行文案不算接了内容级对照）');
  assert.ok(rep.previewFaceHits >= 15,
    '回滚预览面已实施（下限 15）—— 读数不得塌成 0，实测 ' + rep.previewFaceHits);
  /* `branchFaceHits` 仍保持**零点判据**：本版接的是**检查点内容级对照**，不是「分支只读对照」
   *   （下游走 `readLonshaCheckpointFace` 一族出口，不含分支对照 token）。
   *   所以这一条**一字未改** —— 不改没有发生的事。 */
  assert.equal(rep.branchFaceHits, 0, '下游不得出现分支只读对照面');
  assert.equal(rep.rollbackPoints, R.rollback_points,
    '回滚覆盖面读数不得因本版落地而变动（真源模块只算不写）：' + rep.rollbackPoints);
  assert.equal(rep.rollbackFiles, R.rollback_files, '回滚覆盖文件数不得变动');
  assert.equal(rep.rollbackEntryDefs, R.rollback_entry_defs, '回滚入口定义数不得变动');
});

test('A3 判定挂在读数上 + 同一棵树跑两次逐字节相同', () => {
  /* ★ 判据口径：A3 只查**冻结基线**里的五条判据形状，不查裸跑读数。
   *   为什么：裸跑（不给上游根）时 R1–R4 一律为 false（A4 守的就是这条 fail-closed 语义），
   *   若在这里拿裸跑读数要求 R3 成立，两条判据会互相打架 —— 那是口径错，不是缺陷。
   *   实测模式下的判据值由 D4/D5（合成上游）与 A2（读数一致）分别守。 */
  assert.equal(base.criteria.length, 5, '五条判据必须在场（冻结基线）');
  assert.equal(base.criteria.map((c) => c.id).join(','), 'R1,R2,R3,R4,R5');
  for (const c of base.criteria) assert.ok(c.desc && c.got_text, '判据必须自带口径与实测值：' + c.id);
  assert.equal(base.verdict.answer.indexOf('not_now') >= 0, true, '本版判定必须是 not_now');
  const by = {};
  for (const c of base.criteria) by[c.id] = c.pass;
  assert.equal(by.R1, false, 'R1「有检查点面」必须不成立');
  assert.equal(by.R2, false, 'R2「域内有预检面」必须不成立');
  assert.equal(by.R3, true, 'R3「模块全局可达」必须成立（否则「读得到」这个前提没证据）');
  assert.equal(by.R4, false, 'R4「回滚面携带内容」必须不成立');
  assert.equal(by.R5, true, 'R5「下游已有回滚覆盖面」必须成立');
  /* 冻结基线与实测（裸跑）在判据形状上必须同构：id 序一致、not_now 一致 */
  assert.equal(rep.criteria.map((c) => c.id).join(','), base.criteria.map((c) => c.id).join(','));
  assert.equal(rep.verdict, 'not_now');
  const again = runProbe(null, null);
  assert.equal(again.status, 0);
  assert.equal(again.stdout, main.stdout, '同一棵树跑两次读数必须逐字相同');
});

test('A4 未指定上游根时不得假绿（跨仓证据不硬依赖兄弟仓在场）', () => {
  const j = JSON.parse(runProbe(null, null).stdout);
  assert.equal(j.upstream.checked, false, '不给上游根时不得声称复核过');
  assert.ok(/未指定上游根/.test(String(j.upstream.note)), '必须写明为什么没复核');
  assert.equal(j.verdict, 'not_now', '未复核时判定不得翻成 go');
  /* ★ 路径写错必须 fail-closed，不得静默降级成「未指定」
   *   （否则「复核过」与「路径写错」在读数上同形 —— 这正是本项要防的那类假绿） */
  const bad = runProbe(null, ['--upstream', path.join(os.tmpdir(), 'rp_no_such_upstream_xyz')]);
  assert.equal(bad.status, 2, '指定了读不到的上游根必须 exit 2，实测 exit ' + bad.status);
  assert.ok(/fail-closed/.test(String(bad.stderr)), '必须说明 fail-closed');
  /* 下游读数（不依赖上游）必须恒可算：给不给上游根都一致 */
  const upRoot = UP_ROOT();
  if (fs.existsSync(path.join(upRoot, 'branch-guard.js'))) {
    const up = JSON.parse(runProbe(null, ['--upstream', upRoot]).stdout);
    assert.equal(up.upstream.checked, true, '给了可用上游根就必须真复核');
    assert.equal(up.upstream.reach.branch_guard.loadable, true, '真复核必须量出可达性');
    assert.equal(up.rollbackPoints, j.rollbackPoints);
    assert.equal(up.filesScanned, j.filesScanned);
  } else {
    /* 兄弟仓不在场：如实跳过，但下游读数仍必须可算（不许因为兄弟仓缺席而假绿或拒判） */
    assert.ok(j.filesScanned > 150 && j.rollbackPoints > 0, '兄弟仓缺席时下游读数仍须可算');
  }
});

/* ★ v3.23.0 补门：判据散文（criteria[*].got_text）必须与探针现场**复算一致**。
 *   此前本套件只校验「criteria 在场 / 条数 / desc 非空」—— **从不复算内容**，
 *   于是散文会随 readings 漂移而无人发现（活标本：schedule R4 散文 4 / 读数 6；
 *   long_chat L5 散文 238/18/50 / scan 248/11/48，自 v3.19.0 起分叉）。
 *   纪律：冻结面（现场写「未复核（冻结证据：…）」= 这次没传 --upstream）按设计跳过。
 *   自包含：冻结判据与取字段函数都在函数体内（不受模块顶层 const 的 TDZ 影响）。 */
function assertAuditCriteria(baseCrit, liveCrit) {
  const FROZEN_RE = /未复核|冻结证据|（冻结）/;
  const gotOf = (c) => (c.gotText !== undefined ? String(c.gotText) : String(c.got_text));
  assert.equal(liveCrit.length, baseCrit.length, '判据条数必须一致');
  const live = new Map(liveCrit.map((c) => [String(c.id), c]));
  for (const b of baseCrit) {
    const id = String(b.id);
    const l = live.get(id);
    assert.ok(l, '现场缺判据：' + id);
    const lg = gotOf(l);
    if (FROZEN_RE.test(lg)) continue;
    assert.equal(lg, String(b.got_text),
      '判据散文必须与现场复算一致（' + id + '）—— 源变了就该主动刷新基线的 got_text');
  }
}
test('FM1 判据散文可复算（零手抄）＋ 负控制：手抄漂移必须转红', () => {
  assertAuditCriteria(base.criteria, rep.criteria);
  /* 真值破坏：挑一条**现场非冻结**的判据，把散文换成一个不可能等于现场的值 ⇒ 必须转红 */
  const gotOf = (c) => (c.gotText !== undefined ? String(c.gotText) : String(c.got_text));
  const liveMap = new Map(rep.criteria.map((c) => [String(c.id), c]));
  const bad = JSON.parse(JSON.stringify(base));
  const FROZEN_RE = /未复核|冻结证据|（冻结）/;
  const target = bad.criteria.find((c) => {
    const l = liveMap.get(String(c.id));
    return l && !FROZEN_RE.test(gotOf(l));
  });
  assert.ok(target, '负控制需要一个「现场非冻结」的判据');
  target.got_text = '【负控制占位】与现场必然不符';
  assert.throws(() => assertAuditCriteria(bad.criteria, rep.criteria),
    /判据散文必须与现场复算一致/, '负控制：手抄漂移必须让同款判据转红');
});

/* ══════════ B ── 回写防护 ══════════ */
test('B1 产品代码零改动（本版只取证；若实施，本判据会被主动改写而非静默通过）', () => {
  /* ★ 判据面纪律与本探针同形：查「下游有没有实现」只能看**产品代码**。
   *   本版公告会描述这三个面（「持久检查点 / 回滚预览 / 分支只读对照」）——
   *   公告是散文，不是实现；不剥离就会把「公告写了」误判成「代码实现了」。 */
  const strip = (s) => {
    const at = s.indexOf('const ST_PHONE_CURRENT_UPDATE');
    if (at < 0) return s;
    const end = s.indexOf('};', at);
    if (end < 0) return s;
    return s.slice(0, at) + s.slice(at, end + 2).replace(/[^\n]/g, '') + s.slice(end + 2);
  };
  /* ★ [v3.72.0 交棒] 剥离面补上「**块注释也算注释**」（与 `branch_play_probe.cjs` 的 v3.64.0 /
   *   `schedule_conflict_probe.cjs` 的 v3.22.0 同款：整段抹白、**保留换行** ⇒ 行号不变）。
   *   为什么必须补：本判据自称查的是**产品代码**（「公告是散文，不是实现」），但它此前**只剥公告块**，
   *   于是 `index.js` 里的**块注释散文**照样进读数 —— v3.72.0 X8 的接线说明注释里写了
   *   「续玩与分支对照工作区」，该 token 当场被算成「产品代码引进了分支对照面」。
   *   这不是「降低断言」：token 禁令对**真代码**一字未松，且下面加了**两向自证**
   *   （真代码里写 ⇒ 必须仍被读到；只写在注释里 ⇒ 必须读不到）。
   *   同族前例：v3.64.0（探针补块注释纪律后 `checkpointFaceHits` 如实归零，旧下限判据交棒改写）。 */
  const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .split('\n').map((l) => (l.trim().slice(0, 2) === '//' ? ' '.repeat(l.length) : l)).join('\n');
  /* 两向自证（工具自证，不依赖被测对象）：注释面必须被抹掉，真代码面必须留下。 */
  assert.equal(stripComments('var a = 1; /* 分支对照 */\nvar b = 2;').indexOf('分支对照'), -1,
    '自证：块注释里的 token 必须被抹掉（否则判据仍在量散文）');
  assert.equal(stripComments('// 分支对照\nvar c = 3;').indexOf('分支对照'), -1,
    '自证：整行 // 注释里的 token 必须被抹掉');
  assert.ok(stripComments('var d = fn(分支对照);\n').indexOf('分支对照') >= 0,
    '自证：真代码里的 token 必须**仍被读到**（禁令不得被抹掉）');
  const IDX_CODE = stripComments(strip(IDX_SRC));
  /* ★ 自证「剥离面确实非空」不得硬钉当版公告的**具体词**：公告每版都会改写，
   *   钉词等于把判据挂在会被正常迭代修改的散文上（v3.9.1 抬版即翻红的真实事故）。
   *   改为**结构性**自证：公告块的 item 数组必须非空、且剥离后行数不变（行号仍指向真文件）。 */
  const annAt = IDX_SRC.indexOf('const ST_PHONE_CURRENT_UPDATE');
  assert.ok(annAt > 0, '公告块必须存在（剥离面前提）');
  const annEnd = IDX_SRC.indexOf('};', annAt);
  assert.ok(annEnd > annAt, '公告块必须有收尾');
  const annBlock = IDX_SRC.slice(annAt, annEnd + 2);
  const annItems = (annBlock.match(/"[^"]{10,}"/g) || []).length;
  assert.ok(annItems >= 4, '本版公告须描述取证对象（自证剥离面确实非空），实测条目 ' + annItems);
  assert.equal(IDX_CODE.split('\n').length, IDX_SRC.split('\n').length,
    '剥离必须保留行数（行号仍指向真实文件）');
  assert.equal(IDX_CODE.indexOf('const ST_PHONE_CURRENT_UPDATE'), -1, '剥离后代码面不得再含公告块');
  /* [v3.11.0 交棒] token 面按**位置**拆成两族：
   *   · `index.js`（入口/宿主层）：**仍全禁**。本版落地的是「预览面」而不是「入口接线」，
   *     入口出现预览面 token 意味着它真的在删楼路径上动了手 —— 那超出本轴范围；
   *   · `apps/<一层>/*.js`（App 层）：保留 6 个上游分支面 / 检查点面 token
   *     （`phoneCheckpoint` / `branchCheckpoint` / `saveCheckpoint` / `branchCompare` /
     `分支对照` / `分支只读`）。
   *     为什么在此摘掉**三个预览 token**（`previewRollback` / `rollbackPreview` / `dryRunRollback`）：
   *     下游自建的回滚影响预览面（v3.11.0）是**产品功能面**，它长在 App 层是设计而不是污染
   *     —— 探针对这三个 token 的**计数**（A2 的 `previewFaceHits`）仍会把它量出来。
   *     反过来，拦住「上游分支/检查点面被接进来」的纪律**一字未松**（那才是本判据真正要守的）：
   *     六个 token 全在，且中文裸词 `分支对照` / `分支只读` 与 `branchCompare` 都是上游面专属，
   *     在本仓**产品代码**里出现都意味着「接了不该接的东西」（v3.72.0 起剥块注释：散文不算实现，见下方交棒留档）。 */
  for (const tok of ['phoneCheckpoint', 'branchCheckpoint', 'saveCheckpoint', 'restoreCheckpoint',
    'previewRollback', 'rollbackPreview', 'dryRunRollback', 'RollbackPreview', '回滚预览',
    'branchCompare', '分支对照', '分支只读']) {
    assert.equal(IDX_CODE.indexOf(tok), -1, 'index.js 产品代码不得引入 ' + tok);
  }
  for (const dir of fs.readdirSync(path.join(ROOT, 'apps'))) {
    const abs = path.join(ROOT, 'apps', dir);
    if (!fs.statSync(abs).isDirectory()) continue;
    for (const f of fs.readdirSync(abs)) {
      if (f.slice(-3) !== '.js') continue;
      const src = stripComments(read(path.join(abs, f)));
      for (const tok of ['phoneCheckpoint', 'branchCheckpoint', 'saveCheckpoint',
        'branchCompare', '分支对照', '分支只读']) {
        assert.equal(src.indexOf(tok), -1, dir + '/' + f + ' 不得引入 ' + tok);
      }
    }
  }
  /* 上游也不得被本项改动：本探针只读上游，不改上游 */
  assert.equal(IDX_CODE.indexOf('LonShaBranchGuard'), -1, '下游不得直读分支守护（本版未接）');
  assert.equal(IDX_CODE.indexOf('LonShaLedgerReplay'), -1, '下游不得直读账本回放（本版未接）');
});

test('B4 判据面不得被公告侵入（把取证对象写进公告 ⇒ 下游读数必须一动不动）', () => {
  /* ★ 这一条是**真源码破坏型**负控制：在副本 index.js 的公告块里塞进三个面的名字，
   *   探针的下游读数必须与「注入前的同一棵树」**逐字相同**（证明它查的是产品代码而不是散文）。
   *   若哪天有人把剥离逻辑删掉，本条会立刻转红。
   * [v3.11.0 交棒] 本条的**形式**由「读数必须为 0」改写为「读数必须与注入前逐字相同」——
   *   理由：本版已把回滚预览面真做进产品（A2 的 `previewFaceHits` = 39 非 0），
   *   若仍钉 0 则它量的是「有没有做这个功能」，而不是它本来要守的「**公告变更会不会污染读数**」。
   *   改写后它反而**更严**：三读数逐项相等 + 回滚覆盖面四项相等，任何一项被公告干扰立即红。
   *   注意它仍守住原本的杀伤面 —— 剥离逻辑若被删，三个读数各会 +1（注入的正是这三个词）。 */
  const c = makeCopy(false);
  const before = (() => { const r0 = runProbe(c.dir, null); assert.equal(r0.status, 0); return JSON.parse(r0.stdout); })();
  const ip = path.join(c.dir, 'index.js');
  const src = read(ip);
  const anchor = 'const ST_PHONE_CURRENT_UPDATE = {';
  assert.equal(src.split(anchor).length - 1, 1, '公告锚点必须恰中 1 次');
  const at = src.indexOf(anchor);
  const end = src.indexOf('};', at);
  assert.ok(end > at, '公告块必须有收尾');
  /* 把公告整块换成「写了三个面名的散文」——产品代码一个字未动 */
  const injected = 'const ST_PHONE_CURRENT_UPDATE = { version: ST_PHONE_VERSION, ' +
    'date: "2026-09-26", items: ["本版实现持久检查点 saveCheckpoint 与回滚预览 previewRollback ' +
    '以及分支只读对照 branchCompare"] };';
  fs.writeFileSync(ip, src.slice(0, at) + injected + src.slice(end + 2));
  /* 自证注入确实生效：换完的 index.js 里必须能读到这三个面名 */
  const after = read(ip);
  for (const tok of ['saveCheckpoint', 'previewRollback', 'branchCompare']) {
    assert.ok(after.includes(tok), '注入须生效（公告里应能读到 ' + tok + '）');
  }
  const r = runProbe(c.dir, null);
  assert.equal(r.status, 0, '公告被注入不得使探针崩溃：' + String(r.stderr).slice(0, 200));
  const j = JSON.parse(r.stdout);
  assert.equal(j.checkpointFaceHits, before.checkpointFaceHits,
    '公告写了检查点 ⇒ 读数必须不动（判据查代码不查散文）');
  assert.equal(j.previewFaceHits, before.previewFaceHits,
    '公告写了回滚预览 ⇒ 读数必须不动（实测 ' + j.previewFaceHits + ' vs ' + before.previewFaceHits + '）');
  assert.equal(j.branchFaceHits, before.branchFaceHits, '公告写了分支对照 ⇒ 读数必须不动');
  /* 回滚覆盖面四项也一并守：公告里写的服务名与入口名不得被算成实现点 */
  for (const k of ['rollbackPoints', 'rollbackFiles', 'rollbackEntryDefs', 'filesScanned']) {
    assert.equal(j[k], before[k], '公告注入不得改变 ' + k);
  }
});

test('B2 探针位置无关：不得把兄弟仓绝对路径写死（上游 v3.204.0 的跨仓纪律）', () => {
  const code = PROBE_SRC.split('\n')
    .filter((l) => { const t = l.trim(); return !(t.slice(0, 2) === ' *' || t.slice(0, 2) === '/*' || t.slice(0, 2) === '//'); })
    .join('\n');
  assert.equal(/['"]\/home\//.test(code), false, '探针代码里不得出现 /home/ 绝对路径字面量');
  assert.ok(/RP_UPSTREAM_ROOT/.test(PROBE_SRC), '上游根必须走环境变量入口');
  assert.ok(/--upstream/.test(PROBE_SRC), '上游根必须走 --upstream 入口');
});

test('B3 探针的两条形态纪律必须在源码里可见（迭代搜索 / 可达性实测）', () => {
  /* 为什么守这条：本探针 v1 的两条口径事故（写死模块名单 ⇒ 假阴性；把外供等同于进快照 ⇒ 假阴性）
   *   正是本项最重要的教训。纪律必须**写在代码里**，否则下一个人会把名单写回去。 */
  assert.ok(/readdirSync\(UPSTREAM\)/.test(PROBE_SRC), '上游模块名单必须由目录枚举得出（迭代搜索）');
  assert.ok(/loadUpModule/.test(PROBE_SRC), '必须有真加载模块的可达性实测通道');
  assert.ok(/new Function/.test(PROBE_SRC), '可达性实测必须真执行源码（隔离沙箱）');
  assert.ok(/buildBridgeSnapshot\(/.test(PROBE_SRC), '查快照必须按函数体抽取（范围粒度纪律）');
  assert.ok(!/UPSTREAM \+ '\/branch-guard\.js', 'UNUSED/.test(PROBE_SRC), '不得把上游面写成字符串常量清单');
});

/* ══════════ C ── 结论面 ══════════ */
test('C1 not_now 必须给出「面不存在 / 面没有内容」的三类证据，不得只写一句「不做」', () => {
  const v = base.verdict;
  assert.ok(v && v.question && v.answer, '须有被问的问题与给的答案');
  assert.ok(/not_now/.test(v.answer), '结论必须明确标 not_now');
  const txt = v.reasons.join(' ');
  assert.ok(/checkpoint|存档点/.test(txt), '必须写明「以检查点命名者零个」');
  assert.ok(/内存态|Map/.test(txt), '必须写明 branch-guard 是内存态（TTL 会过期、跨实例不可见）');
  assert.ok(/dryRun|预检/.test(txt) && /形参/.test(txt), '必须写明域内无预演面（含形参证据）');
  assert.ok(/可达/.test(txt) && /无内容|七个数|仪表读数/.test(txt), '必须写明「通道可达但内容不足」');
  assert.ok(/41|回滚点/.test(txt), '必须给出下游基础的实测读数');
  assert.ok(v.not_blocked_by, '必须写明不阻其他项');
});

test('C2 结论必须给出有读数支持的替代轴（否掉一个候选的同时必须指出方向）', () => {
  assert.ok(base.verdict.only_axis_with_evidence, '必须有替代轴');
  assert.ok(/可见性|读前即知/.test(base.verdict.only_axis_with_evidence), '替代轴须围绕回滚影响的可见性');
  assert.ok(/只呈现|不执行/.test(base.verdict.only_axis_with_evidence), '替代轴须明确「不写判定 / 不执行」');
  assert.ok(/上游之外|下游自己的/.test(base.verdict.only_axis_with_evidence), '替代轴须说明证据不依赖上游那两本账');
});

test('C3 修正面必须记下三条以上「读数说谎」的形态（本项最重要的沉淀）', () => {
  const txt = base.corrections.join(' ');
  assert.ok(/假阴性/.test(txt) && /写死|枚举面/.test(txt), '必须记下「写死枚举面 ⇒ 假阴性」');
  assert.ok(/口径错|不要用推断代替测量/.test(txt), '必须记下「把外供等同于进快照」的口径错');
  assert.ok(/假阳性/.test(txt), '必须记下假阳性（域未限定 / token 撞词）');
  assert.ok(/取消检查点|step-pipeline/.test(txt), '必须记下「检查点」中文 token 撞步进流水线');
});

/* ══════════ D ── 负控制（真破坏 → 同款真判据必须转红） ══════════ */
test('D1 破坏枚举面（掏空 apps/ 与 config/）⇒ 探针必须 fail-closed 拒判', () => {
  const c = makeCopy(false);
  fs.rmSync(path.join(c.dir, 'apps'), { recursive: true, force: true });
  const r = runProbe(c.dir, null);
  assert.equal(r.status, 2, '枚举面塌陷时必须 exit 2，实测 exit ' + r.status);
  assert.ok(/fail-closed/.test(String(r.stderr)), '必须说明 fail-closed');
});

test('D2 破坏 index.js（空文件）⇒ 探针必须 fail-closed 拒判', () => {
  const c = makeCopy(false);
  fs.writeFileSync(path.join(c.dir, 'index.js'), '');
  const r = runProbe(c.dir, null);
  assert.equal(r.status, 2, '入口被掏空时必须 exit 2，实测 exit ' + r.status);
});

test('D3 摘掉一处回滚入口定义 ⇒ 入口定义读数必须可观测地变少（真判据对破坏有反应）', () => {
  /* ★ 破坏形态必须与判据粒度匹配（f4 的教训：探针 token 是子串匹配时，
   *   「改名」不会让点数变少 ⇒ 负控制假绿）。此处判据要求**定义行**形态
   *   （`<name>(...) {`），故破坏取「把定义行改成赋值形」——它同时满足
   *   「恰中 1 次」与「该行不再被判据认作定义」。 */
  const anchor = '    rollbackTaskProgressAtFloor(targetTavernIndex) {';
  const d = damage(path.join('apps', 'wangxiang', 'wangxiang-app.js'), anchor,
    '    rollbackTaskProgressAtFloor = function (targetTavernIndex) {');
  assert.equal(d.res.status, 0, '单行改动不应使探针拒判（只是读数变小）');
  const j = JSON.parse(d.res.stdout);
  assert.equal(j.rollbackEntryDefs, R.rollback_entry_defs - 1,
    '入口定义必须恰好少 1（' + j.rollbackEntryDefs + ' vs ' + R.rollback_entry_defs + '）');
  assert.equal(j.rollbackPoints, R.rollback_points,
    '回滚点总数不变（调用点仍在，判据区分了定义与调用）');
});

test('D4 破坏合成上游（摘掉分支模块的全局挂载）⇒ 可达性判据必须转红', () => {
  /* ★ 这一条守的是 R3「可达性实测」是**活判据**：把 `Object.freeze(api)` 挂载摘掉，
   *   沙箱里就读不到 LonShaBranchGuard ⇒ loadable 必须翻成 false。 */
  const c = makeCopy(true);
  const bg = path.join(c.upstream, 'branch-guard.js');
  const src = read(bg);
  const anchor = 'g.LonShaBranchGuard = Object.freeze(api);';
  assert.equal(src.split(anchor).length - 1, 1, '锚点必须恰中 1 次');
  fs.writeFileSync(bg, src.split(anchor).join('void api;'));
  const r = runProbe(c.dir, ['--upstream', c.upstream]);
  assert.equal(r.status, 0, '上游面被改不得使探针崩溃（应如实报不可达）');
  const j = JSON.parse(r.stdout);
  assert.equal(j.upstream.reach.branch_guard.loadable, true, '模块本身仍可加载');
  assert.equal(j.upstream.global_channel_reachable, j.upstream.reach.ledger_replay.loadable,
    '分支模块的全局面必须变成不可达（可达性判据对破坏有反应）');
  /* 直接量「沙箱里有没有那个全局名」 */
  assert.equal(j.upstream.reach.branch_guard.api_keys, 0, '摘掉挂载后 API 键数必须为 0');
});

test('D5 把「检查点」面凭空写进上游 ⇒ 同名判据必须能观测到差异（判据不是死的）', () => {
  const c = makeCopy(true);
  /* 合成一个同时带 checkpoint 之名与持久化机制的模块 —— 判据要求**两者同时在场**才算面 */
  fs.writeFileSync(path.join(c.upstream, 'synthetic-checkpoint.js'),
    'var s = { checkpoint: 1 };\n' + 'localStorage.setItem("x", "1");\n');
  const r = runProbe(c.dir, ['--upstream', c.upstream]);
  assert.equal(r.status, 0, '合成上游不得使探针失败');
  const j = JSON.parse(r.stdout);
  const cp = j.upstream.checkpoint_named;
  assert.ok(cp.indexOf('synthetic-checkpoint.js') >= 0, '合成模块必须被「以 checkpoint 为名」判据认出来');
  assert.ok(j.upstream.checkpoint_named_persistent.indexOf('synthetic-checkpoint.js') >= 0,
    '且必须被「带持久化机制」判据认出来 ⇒ R1 可被合成面翻绿');
  /* 反坐实：真实上游（冻结读数）这两项都是 0 */
  assert.equal(R.upstream_checkpoint_named, 0);
  assert.equal(R.upstream_checkpoint_named_persistent, 0);
});

/* ══════════ E ── 版本锚 ══════════ */
test('E1 版本锚（只在 3.9.0 及以后成立）', () => {
  const v = JSON.parse(read(path.join(ROOT, 'manifest.json'))).version;
  const parts = v.split('.').map(Number);
  const ok = parts[0] > 3 || (parts[0] === 3 && parts[1] >= 9);
  assert.ok(ok, '本套件成立于 RubyPhone 3.9.0 及以后，当前 ' + v);
  assert.equal(base.measured_at, 'v3.8.0', '基线首测版必须是 v3.8.0');
});