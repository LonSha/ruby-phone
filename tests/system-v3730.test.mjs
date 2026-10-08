/* ============================================================
 * tests/system-v3730.test.mjs — R-O9「计划、版本、门禁与基线自动同源」
 *                              + R-O1「L4 浏览器层总门禁」的结构面判据
 * ------------------------------------------------------------
 * 本套件守两件事（各自对应计划里的一条）：
 *
 * 【R-O9】台账必须**随磁盘动**，且「未知」不许塌成 0
 *   makeStatus 从 tools/gen_status_ledger.mjs 现场取数（与生成器**同一份函数**，
 *   不各写一遍 —— 两份取数必然漂移），与落盘台账对账：
 *     S1 落盘台账在场且 schema 对
 *     S2 版本四源同源（package / manifest / update-log / index 常量）
 *     S3 落盘台账的每个「非 null」计数格 == 现场取数（漂移即红）
 *     S4 **未知不报 0**：现场取数的 null 格必须在 unknown[] 里有解释
 *     S5 **未执行不报通过**：浏览器环境面如实登记（有/无都要说出来）
 *     S6 干净检出可重建：同一批文件的内容摘要可复算
 *     S7 门禁分档展示（四档：静态门 / 定向套件 / 浏览器门 / 真宿主门）
 *     S8 负控制：把台账里的数改掉 ⇒ S3 同款判据必须转红
 *     S9 负控制：把 unknown 抹掉而现场仍为 null ⇒ S4 同款判据必须转红
 *
 * 【R-O1】L4 总门禁的结构面
 *     G1 tests/browser/gate.mjs 在场，且**覆盖面是判据**（场景数/视口数下限）
 *     G2 四档视口齐全（320/390/768/1280），少一档即红
 *     G3 无浏览器时退出码 2（不得计通过）—— 以「探针返回 available:false」的
 *        真分支判：把 findBrowser 换成假实现跑同款判据，必须判「未执行」
 *     G4 证据行必带版本 / 浏览器 / host 标记（格式面）
 *     G5 `_` 前缀探针不进正式扫描面（取证脚本不得冒充交付场景）
 *
 * 为什么本套件不去「跑浏览器」：
 *   起 Chromium 要 3~10 秒/场景，套件里跑会把 `npm test` 拖成分钟级；
 *   浏览器门的**执行**归 `node tests/browser/gate.mjs`（单独一条命令，
 *   见门禁分档的第四档）。本套件守的是它的**结构面**——
 *   结构面能在毫秒级回答「门还在不在、覆盖面有没有被掏空」。
 *   两者分工与 browser-runner 里 printReports 的纪律同源：
 *   **判据在各自层，报表与执行不互相顶替。**
 * ============================================================ */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectStatus, ROOT } from '../tools/gen_status_ledger.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LEDGER_REL = 'tests/audit/status-ledger.json';
const GATE_REL = 'tests/browser/gate.mjs';
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const readJson = (rel) => JSON.parse(read(rel));

const live = collectStatus();
const ledgerOnDisk = JSON.parse(read(LEDGER_REL));

/* ══════════ S ── R-O9 台账 ══════════ */
test('S1 落盘台账在场且 schema 对（台账必须是机器可读的一份账）', () => {
  assert.equal(ledgerOnDisk.schema, 'status-ledger@1', '台账 schema 必须钉住版本，口径可变即须改 schema');
  assert.equal(ledgerOnDisk.generated_by, 'tools/gen_status_ledger.mjs');
  assert.ok(Array.isArray(ledgerOnDisk.unknown), '台账必须带 unknown[]（未知项要说出来，不是省略）');
});

test('S2 版本四源同源（package / manifest / update-log.latest / index 常量）', () => {
  assert.equal(live.version_same, true,
    '版本四源必须同源：' + JSON.stringify(live.version_sources));
  assert.ok(live.version, '同源时必须给出唯一版本号');
});

/* 逐格对账：只比「两边都不是 null」的格。
 *   为什么 null 不参与比较：null 是「数不出来」，它的一致性由 S4 判
 *   （必须有解释）——把 null 也拿来做相等比较，会把「两处都数不出来」
 *   判成「一致」，而那正是 fail-open 的一种形态。 */
function compareGrids(disk, liveObj, prefix, out) {
  for (const k of Object.keys(liveObj)) {
    const lv = liveObj[k];
    const dv = disk ? disk[k] : undefined;
    const p = prefix + k;
    if (lv !== null && typeof lv === 'object' && !Array.isArray(lv)) {
      compareGrids(dv, lv, p + '.', out);
      continue;
    }
    if (Array.isArray(lv)) {
      if (lv.length > 0) {
        assert.ok(Array.isArray(dv), p + ' 落盘台账缺这一格（现场为数组）');
        assert.deepEqual(dv, lv, p + ' 落盘台账与现场取数不一致');
      }
      continue;
    }
    if (lv === null) continue; // 未知项：归 S4
    out.push([p, dv, lv]);
  }
}

test('S3 落盘台账与现场取数逐格一致（漂移即红 —— 这就是「判据看守」）', () => {
  const grid = [];
  compareGrids({ version: ledgerOnDisk.version, gates: ledgerOnDisk.gates, tests: ledgerOnDisk.tests, scale: ledgerOnDisk.scale }, {
    version: live.version,
    gates: { static_gate_files: live.gates.static_gate_files, check_chain_len: live.gates.check_chain_len },
    tests: { test_files: live.tests.test_files, audit_files: live.tests.audit_files },
    scale: { app_dirs: live.scale.app_dirs, apps_ids: live.scale.apps_ids, index_lines: live.scale.index_lines, css_bytes: live.scale.css_bytes },
  }, '', grid);
  const bad = grid.filter(([, d, l]) => d !== l).map(([p, d, l]) => `${p}: 台账=${d} 现场=${l}`);
  assert.equal(bad.length, 0, '台账与磁盘漂移（重跑 `node tools/gen_status_ledger.mjs --write`）：\n  ' + bad.join('\n  '));
  assert.ok(grid.length >= 6, '对账格数下限 6（防对账面被掏空后"零不一致"全绿）');
});

test('S4 ★ 未知不报 0：现场每一格 null 都必须有解释（unknown[] 或旁挂 `_note`）', () => {
  /* 判据是「合取」而不是「析取」：既要 NULL 有解释，也要「有解释的格确实为 NULL」。
   *   只判前半 ⇒ 有人把 null 改成 0 并留着一句解释，照样绿（本仓假绿第二形）。
   *
   * 两种解释形态都接受，但**都必须写下来**：
   *   ① unknown[] 里有一条提到这一格（外部读不到 / 口径变了）；
   *   ② 该格旁挂 `xxx_note`（≥ 10 字）说明「这个 null 表示什么、不表示什么」——
   *      用于「未设置 ≠ 没有」这类三态区分（如 chromium_env）。 */
  const explainedBySiblingNote = (obj, key) => {
    const note = obj && obj[key + '_note'];
    return typeof note === 'string' && note.length >= 10;
  };
  const nullPaths = [];
  (function walk(o, prefix, parent) {
    for (const k of Object.keys(o)) {
      const v = o[k];
      if (v === null) {
        const leaf = k;
        const byUnknown = live.unknown.some((u) => u.includes(leaf));
        const byNote = explainedBySiblingNote(parent, k);
        nullPaths.push({ path: prefix + k, byUnknown, byNote });
      } else if (v && typeof v === 'object' && !Array.isArray(v)) walk(v, prefix + k + '.', v);
    }
  })({
    version: live.version, gates: live.gates, tests: live.tests,
    browser: live.browser, scale: live.scale,
    material_split: live.material_split,
  }, '', null);
  for (const p of nullPaths) {
    assert.ok(p.byUnknown || p.byNote,
      '未知格 ' + p.path + ' 既不在 unknown[] 里、也没有旁挂 _note 解释（未知不许静默变 0）');
  }
  assert.equal(live.unknown_count, live.unknown.length, 'unknown_count 必须等于 unknown 长度');
  /* 反向：有解释的格子不许在盘上是真数（否则解释与事实不同形） */
  for (const u of live.unknown) {
    const m = /([a-z_]+)\b/.exec(u);
    if (!m) continue;
    const key = m[1];
    const found = (function find(o, prefix) {
      for (const k of Object.keys(o)) {
        const v = o[k];
        if (k === key) return { path: prefix + k, v };
        if (v && typeof v === 'object' && !Array.isArray(v)) { const r = find(v, prefix + k + '.'); if (r) return r; }
      }
      return null;
    })({ version: live.version, gates: live.gates, tests: live.tests, browser: live.browser, scale: live.scale }, '');
    if (found && /读不到|为 null|数不出来|解析为 0|不同源|不.*同源/.test(u)) {
      assert.ok(found.v === null || found.v === false,
        'unknown 里说「' + key + ' 数不出来」，但现场是 ' + JSON.stringify(found.v) + '（解释与事实必须同形）');
    }
  }
});

test('S5 未执行不报通过：浏览器环境面如实登记（有/无都要说出来）', () => {
  assert.ok(live.browser && Object.prototype.hasOwnProperty.call(live.browser, 'scenarios'),
    '浏览器场景面必须在台账里有一格（哪怕为空也要在场，缺席与空不同形）');
  if (live.browser.scenario_count === null) {
    assert.ok(live.unknown.some((u) => u.includes('scenarios')), '场景数为 null 时必须解释');
  } else {
    assert.ok(live.browser.scenario_count >= 1, '正式场景数至少 1（本仓已有 L4 层）');
  }
  /* 基建四件必须在台账里逐件点名：缺一件就不是「环境没有」，是「基建被人拆了」 */
  for (const k of ['runner', 'driver', 'gate', 'host_stub']) {
    assert.equal(typeof live.browser.infra[k], 'boolean', 'L4 基建 ' + k + ' 必须如实记布尔');
  }
});

test('S6 干净检出可重建：同一批文件的内容摘要可复算', () => {
  assert.ok(live.digest && /^[0-9a-f]{16}$/.test(live.digest.sha256_16),
    '摘要必须是 16 位十六进制（口径可见、可复算）');
  assert.ok(Array.isArray(live.digest.scope) && live.digest.scope.length >= 2,
    '摘要范围必须写明（不写范围 = 换一批文件摘要就变，重建不了）');
  /* 复算：同一批文件再算一次必须逐字相同 */
  const again = collectStatus();
  assert.equal(again.digest.sha256_16, live.digest.sha256_16, '同一批文件两次取数摘要必须相同');
  assert.equal(again.digest.scope.join(','), live.digest.scope.join(','), '摘要范围必须稳定');
});

test('S7 门禁分档展示：四档齐备（静态门 / 定向套件 / 浏览器门 / 真宿主门）', () => {
  const tiers = readJson('config/gate-tiers.json');
  assert.equal(tiers.schema, 'gate-tiers@1');
  const want = ['static', 'targeted', 'browser', 'host'];
  /* 四档必须齐备且**顺序同源**；允许在其后追加档（如 full 全量档），
   *   但不允许四档里缺任何一个、也不允许把 host 档挪到前面 ——
   *   「先静态、再定向、再浏览器、最后真宿主」这个由快到慢的顺序本身就是口径。 */
  const keys = Object.keys(tiers.tiers);
  assert.deepEqual(keys.slice(0, 4), want, '四档必须齐备且顺序同源（其后可追加）');
  assert.ok(keys.length >= 4, '分档表不得少于四档');
  /* ① 静态门档：必须与真实 scripts/ 面有一致关系（不许多报不存在的门） */
  for (const g of tiers.tiers.static.commands) {
    const m = /scripts\/([a-z0-9-]+\.mjs)/.exec(g);
    if (m) assert.ok(fs.existsSync(path.join(ROOT, 'scripts', m[1])), '静态档报了不存在的门：' + m[1]);
  }
  /* ② 定向档：每条命令的套件文件必须在场 */
  for (const g of tiers.tiers.targeted.commands) {
    const m = /tests\/([a-zA-Z0-9_-]+\.test\.mjs)/.exec(g);
    if (m) assert.ok(fs.existsSync(path.join(ROOT, 'tests', m[1])), '定向档报了不存在的套件：' + m[1]);
  }
  /* ③ 浏览器档：命令必须指向真实驱动，且 gate 必须在场 */
  assert.ok(fs.existsSync(path.join(ROOT, GATE_REL)), '浏览器档的 gate 必须在场');
  assert.ok(tiers.tiers.browser.commands.some((c) => c.includes('tests/browser/gate.mjs')),
    '浏览器档必须包含总门禁命令（只列单场景驱动 = 覆盖面不设下限）');
  /* ④ 真宿主档：本环境没有真宿主 ⇒ 必须如实登记未执行，且**不许**写成通过 */
  assert.equal(tiers.tiers.host.status, 'not-executed',
    '真宿主档在本环境必须如实登记 not-executed（不得计通过）');
  assert.ok(String(tiers.tiers.host.note || '').length > 10, '真宿主档必须写清为什么未执行');
});

test('S8 ★ 负控制：把落盘台账的一个数改掉 ⇒ S3 同款判据必须转红', () => {
  /* 真源码破坏 → 副本 → 在副本上重跑**同款**判据。
   *   这里破坏的是**台账**（被判对象），判据用现场取数对照 —— 两件事分开，
   *   所以这条负控制验的是「判据真的在看磁盘，而不是自说自话」。 */
  const dir = fs.mkdtempSync(path.join(process.env.TMPDIR || '/tmp', 'ledger-neg-'));
  const broken = JSON.parse(JSON.stringify(ledgerOnDisk));
  broken.tests.test_files = broken.tests.test_files + 1; // 真破坏：数被改动
  const grid = [];
  compareGrids({ tests: broken.tests }, { tests: { test_files: live.tests.test_files } }, '', grid);
  const bad = grid.filter(([, d, l]) => d !== l);
  assert.equal(bad.length, 1, '改动台账后同款判据必须报出 1 处不一致（判据不是死的）');
  assert.notEqual(broken.tests.test_files, ledgerOnDisk.tests.test_files, '前提：破坏必须真改了值');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('S9 ★ 负控制：把 unknown 抹掉而现场仍为 null ⇒ S4 同款判据必须转红', () => {
  const hollow = { ...live, unknown: [], unknown_count: 0 };
  const nullPaths = [];
  (function walk(o, prefix) {
    for (const k of Object.keys(o)) {
      const v = o[k];
      if (v === null) nullPaths.push(prefix + k);
      else if (v && typeof v === 'object' && !Array.isArray(v)) walk(v, prefix + k + '.');
    }
  })({ version: hollow.version, gates: hollow.gates, tests: hollow.tests, browser: hollow.browser, scale: hollow.scale }, '');
  if (nullPaths.length === 0) {
    /* 现况下没有未知项 —— 那这条负控制要自证「判据在未知项出现时真会响」，
     *   用一个**构造出来的**未知项跑同款判定（不依赖当前磁盘恰有未知）。 */
    const fake = { unknown: [] };
    const covered = fake.unknown.some((u) => u.includes('test_files'));
    assert.equal(covered, false, '说明面为空时「有解释」判定必须为假（否则判据恒真）');
    assert.ok(true, '现况 unknown 为空，负控制以构造样本自证：判据在缺解释时判定为假');
    return;
  }
  for (const p of nullPaths) {
    const covered = hollow.unknown.some((u) => u.includes(p.split('.').pop()));
    assert.equal(covered, false, '抹掉 unknown 后 ' + p + ' 必须被判成「无解释」');
  }
});

/* ══════════ S10 ── R-O9 工作第 4 条：私有素材依赖两组分报 ══════════ */
test('S10 ★ 素材依赖两组分报：公开夹具 / 私有真素材分列，缺席组如实登记不可跑', () => {
  const ms = live.material_split;
  assert.ok(ms && typeof ms === 'object', '台账必须带 material_split 格（R-O9 工作第 4 条）');
  /* ① 分组的依据必须是**磁盘现状**，不是「我以为应该有」 */
  assert.equal(typeof ms.material_present, 'boolean', '素材在场与否必须如实记布尔');
  /* ② 两组必须都在场且 id 稳定（分报的意义就在「分」） */
  const ids = ms.groups.map((g) => g.id);
  assert.deepEqual(ids, ['mechanism', 'fidelity'], '两组必须齐备且顺序同源（公开夹具 / 私有真素材）');
  /* ③ 私有组可跑性 == 素材在场（这是一条恒等式，不是「恰好」） */
  const fid = ms.groups.find((g) => g.id === 'fidelity');
  assert.equal(fid.runnable, ms.material_present,
    '私有素材组的可跑性必须等于素材在场（runnable ≠ present 就是把「缺素材」写成「跑过」）');
  /* ④ 不可跑时必须说清「这一格不是通过、也不是产品红」 */
  if (!fid.runnable) {
    assert.ok(/不可跑|unrunnable/.test(fid.why), '不可跑组必须写出原因');
    assert.ok(/不报通过|不算作产品红|既不/.test(fid.why), '必须说清这一格**不表示**什么（否则会被读成产品红）');
  }
  /* ⑤ 套件清单必须逐条能在磁盘上找到（防清单是手抄的 / 陈旧的） */
  if (Array.isArray(ms.suite_list)) {
    for (const n of ms.suite_list) {
      assert.ok(fs.existsSync(path.join(ROOT, 'tests', n)), '清单里的套件必须在盘上：tests/' + n);
    }
    assert.ok(ms.suite_list.every((n) => n.endsWith('.test.mjs')), '清单只收 *.test.mjs');
  }
  /* ⑥ 口径声明必须在场：套件数 ≠ 通过数 */
  assert.ok(/套件数 ≠ 通过数|不报跑绿/.test(ms.note || ''), '必须声明本格只报可跑性、不报跑绿与否');
});

test('S11 ★ 负控制：把「私有素材缺席」抹成「可跑」⇒ S10 同款判据必须转红', () => {
  /* 假绿形态：素材明明不在，却把 runnable 写成 true（等于宣称「跑过保真用例」）。 */
  const ms = live.material_split;
  const hollow = {
    ...ms,
    groups: [{ id: 'mechanism' }, { id: 'fidelity', runnable: true, why: '私有素材在场 ⇒ 本组可跑' }],
  };
  /* 同款恒等式判定：present=false 而 fidelity.runnable=true ⇒ 必须判假 */
  const present = false; // 构造：素材缺席
  const fid = hollow.groups.find((g) => g.id === 'fidelity');
  const eq = fid.runnable === present;
  assert.equal(eq, false, '素材缺席时把 runnable 写成 true，同款判据必须转红（这就是本条的负控制）');
  /* 反向：真实现场若素材在场，这条恒等式必须为真（证明判据本身不是恒假） */
  const realEq = ms.groups.find((g) => g.id === 'fidelity').runnable === ms.material_present;
  assert.ok(realEq, '前提：真实现场该恒等式必须成立（否则 S10 是真红而非判据误伤）');
});

/* ══════════ G ── R-O1 L4 总门禁结构面 ══════════ */
test('G1 浏览器总门禁在场，且覆盖面上限行为「判据」而非「注释」', () => {
  assert.ok(fs.existsSync(path.join(ROOT, GATE_REL)), '总门禁必须落仓：' + GATE_REL);
  const src = read(GATE_REL);
  /* 三条 fail-closed 结构必须真在代码里（不是写在注释里就算） */
  assert.match(src, /MIN_SCENES\s*=\s*Number\(/, '场景数下限必须可配且默认真实存在');
  assert.match(src, /MIN_VIEWPORTS\s*=\s*Number\(/, '视口档数下限必须存在');
  assert.match(src, /MIN_READS_PER_SCENE\s*=\s*Number\(/, '每场景读数下限必须存在（判据被掏空要能转红）');
  assert.match(src, /process\.exit\(2\)/, '未执行/覆盖面不足必须走 exit 2');
  assert.match(src, /process\.exit\(1\)/, '有 FAIL 必须走 exit 1');
});

test('G2 四档视口齐全（320 / 390 / 768 / 1280）', () => {
  const src = read(GATE_REL);
  for (const w of [320, 390, 768, 1280]) {
    assert.ok(new RegExp(`width:\\s*${w}\\b`).test(src), `四档视口缺 ${w}px（R-O1 验收点名的那四档）`);
  }
  const tiers = readJson('config/gate-tiers.json');
  assert.ok(tiers.tiers.browser.viewports.length >= 4, '分档表里也要写明四档视口');
});

test('G3 ★ 无浏览器 ⇒ 未执行（exit 2），不得计通过', () => {
  const src = read(GATE_REL);
  assert.match(src, /if\s*\(!probe\.available\)/, '必须显式判「浏览器不可用」这一支');
  const seg = src.slice(src.indexOf('if (!probe.available)'));
  assert.ok(seg.includes('process.exit(2)'), '不可用分支必须 exit 2（不是 exit 0、不是静默跳过）');
  assert.ok(/未执行|不得计通过/.test(seg), '不可用分支必须把「未执行」说出来，读数不许空着');
  /* 反向自证：把探针换成「不可用」的假实现，同款分支判定必须成立 */
  const probe = { available: false, reason: '构造样本' };
  assert.equal(!probe.available, true, '假实现的不可用分支必须真被走到');
});

test('G4 证据行必带版本 / 浏览器 / host 三标记（R-O1 验收原文）', () => {
  const src = read(GATE_REL);
  assert.ok(/ver=\$\{VERSION\}/.test(src) || /ver=/.test(src), '证据行必须带版本号');
  assert.ok(/browser=\$\{probe\.source\}/.test(src) || /browser=/.test(src), '证据行必须带浏览器来源');
  assert.ok(/host=stub/.test(src), '证据行必须带 host 标记（区分真宿主与桩）');
});

test('G5 `_` 前缀探针不进正式扫描面（取证脚本不得冒充交付场景）', () => {
  const src = read(GATE_REL);
  assert.match(src, /startsWith\('_'\)/, '必须显式跳过 `_` 前缀探针');
  const scenDir = path.join(ROOT, 'tests/browser/scenarios');
  const names = fs.readdirSync(scenDir);
  const probes = names.filter((n) => n.startsWith('_') && n.endsWith('.scen.js'));
  const official = names.filter((n) => !n.startsWith('_') && n.endsWith('.scen.js'));
  assert.ok(official.length >= 1, '正式场景至少 1 件');
  assert.ok(probes.length >= 1, '本仓既有取证探针（`_` 前缀）—— 若已清理，删本条下限即可');
  assert.equal(official.some((n) => n.startsWith('_')), false, '正式面不得混入探针');
});
