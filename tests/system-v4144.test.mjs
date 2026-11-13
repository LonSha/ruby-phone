/* ============================================================
 * tests/system-v4144.test.mjs -- [v4.144.0 · 第二十一期 批次B 第二步 R21-O6 长会话内存跨轮趋势门]
 *   —— 把「探针建好了、基线也落了、可没有任何门在读」这第三笔账，收成一道真会响的门。
 *
 * 【修前实测的缺口（读码可复算，不是推演）】
 *   ① `tests/audit/memory_growth_probe.cjs` 早就在盘上，`memory_growth_baseline.json` 也早落了读数
 *      （8 轮 heap 4362→4378 KB），基线自己的 `note` 逐字写着「单点仍不可判泄漏，只判**跨轮趋势**」。
 *   ② 但 `package.json` 的 `scripts.check` 十九道门里**没有任何一道读它**；
 *      `grep -rn memory_growth scripts/*.mjs` 零命中（本版实测）。
 *    → 读数会随真正的泄漏越来越大，而没有东西会响。这正是本仓第三笔账「已经写好但没人用」。
 *
 * 【本版落的三件】
 *   一 `scripts/lib/memory-trend.mjs`（纯函数两面：`judgeTrendReadings` 判越界 / `guardProbeOutput` 判可比性）；
 *   二 `scripts/memory-trend-check.mjs`（CLI 骨架：真启子进程跑探针，**必须带 --expose-gc**，三档退出码）；
 *   三 五处接线：`package.json` 脚本与 check 链、`config/gate-tiers.json` 静态档、`config/gate-budget.json` 逐门预算、
 *      `scripts/check-file.mjs` 主读数登记。
 *
 * 判据面（五组）：
 *   A 口径：两根上界与实测的倍数关系 / 三档退出码各有其义 / 判决不靠中文字去匹
 *   B 纯函数行为：越界即红（两侧各一面）/ 边界值不误伤 / 「不可比」七理由互不同形
 *   C 接线：脚本在位 / 链上位置 / 分档表同序 / 预算自算 / 主读数已登记
 *   D 真跑与负控制：真跑三次都过门（防单次侥幸）/ 带 --keep-kb 必红 / 探针必须自报 gc_forced
 *   E 版本锚与诚实体边界：五源同源且 ≥ 4.144.0 / 明确不判「真机长时运行」
 * ============================================================ */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const readJson = (rel) => JSON.parse(read(rel));
const exists = (rel) => fs.existsSync(path.join(ROOT, rel));

const LIB_REL = 'scripts/lib/memory-trend.mjs';
const GATE_REL = 'scripts/memory-trend-check.mjs';
const PROBE_REL = 'tests/audit/memory_growth_probe.cjs';
const BASE_REL = 'tests/audit/memory_growth_baseline.json';
const BORN_V = '4.144.0';

const LIB = await import(pathToFileURL(path.join(ROOT, LIB_REL)).href);
const sem = (v) => String(v).split('.').map(Number).reduce((a, x) => a * 1000 + x, 0);
/** 真跑一次门脚本，返回 { code, out, err }。**统一入口**：判据不在各处手搓 spawn 参数。 */
function runGate(extraArgs = []) {
  const r = spawnSync(process.execPath, [path.join(ROOT, GATE_REL), ...extraArgs],
    { cwd: ROOT, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, timeout: 300000 });
  return { code: typeof r.status === 'number' ? r.status : -1, out: String(r.stdout || ''), err: String(r.stderr || '') };
}

/* ═══════════════════════════ A · 口径 ═══════════════════════════ */
test('A1 两根上界必须是实测值的量级倍数（趋势门不是精确门）', () => {
  const base = readJson(BASE_REL);
  const measuredTail = base.readings.heap_tail_growth_kb;
  const measuredTotal = base.readings.heap_total_growth_kb;
  assert.equal(typeof measuredTail, 'number', '基线必须落着实测尾段增长');
  assert.equal(typeof measuredTotal, 'number', '基线必须落着实测总增长');
  /* 4 倍余量：太小则噪声即红（实测同代码 12 连跑出现 0.5 与 55.25KB/轮 两个档次），
   * 太大则真泄漏也过（本门负控制实测越界 3074KB，任何合理上界都拦得住）。 */
  assert.equal(LIB.TAIL_LIMIT_KB, 8, '尾段上界应为 8KB（实测 ' + measuredTail + 'KB 的 4 倍）');
  assert.equal(LIB.TOTAL_LIMIT_KB, 64, '总增长上界应为 64KB（实测 ' + measuredTotal + 'KB 的 4 倍）');
  assert.ok(LIB.TAIL_LIMIT_KB > measuredTail, '尾段上界必须严格高于实测值，否则平均态就是红的');
  assert.ok(LIB.TOTAL_LIMIT_KB > measuredTotal, '总增长上界必须严格高于实测值');
  assert.ok(LIB.TAIL_LIMIT_KB < 32, '★ 尾段上界不得放宽到 32KB —— 那是探针判 leak-candidate 的同一根线，放到那里门就不再有分辨力');
});

test('A2 判决词三态互不同形：pass / over-limit / 拒判理由码（不得全塌成「不行」）', () => {
  const ok = LIB.judgeTrendReadings({ heap_tail_growth_kb: 2, heap_total_growth_kb: 15 });
  assert.equal(ok.verdict, 'pass');
  assert.deepEqual(ok.over, []);
  const bad = LIB.judgeTrendReadings({ heap_tail_growth_kb: 999, heap_total_growth_kb: 15 });
  assert.equal(bad.verdict, 'over-limit');
  assert.equal(bad.over.length, 1, '只有尾段越界时只能报一条（不得顺手把总增长也报上）');
  const codes = new Set(['empty', 'gc-not-forced', 'no-readings', 'samples-not-array', 'samples-too-few', 'rounds-too-few', 'rise-missing', 'ready']);
  for (const c of codes) assert.equal(typeof c, 'string');
  const seen = [
    LIB.guardProbeOutput(null).code,
    LIB.guardProbeOutput({ gc_forced: false }).code,
    LIB.guardProbeOutput({ gc_forced: true }).code,
    LIB.guardProbeOutput({ gc_forced: true, readings: {} }).code,
    LIB.guardProbeOutput({ gc_forced: true, readings: { heap_samples_kb: [1] } }).code,
    LIB.guardProbeOutput({ gc_forced: true, rounds: 8, readings: { heap_samples_kb: [1, 2, 3, 4, 5, 6] } }).code,
  ];
  assert.equal(new Set(seen).size, seen.length, '拒判理由码必须互不相同，实得 ' + JSON.stringify(seen));
  for (const c of seen) assert.ok(codes.has(c), '理由码必须在登记表内：' + c);
});

/* ═══════════════════════════ B · 纯函数行为 ═══════════════════════════ */
test('B1 两侧各管一面：只越尾段红线会红，只越总增长红线也会红（不是取并集的发涩口径）', () => {
  const onlyTail = LIB.judgeTrendReadings({ heap_tail_growth_kb: 9, heap_total_growth_kb: 15 });
  assert.equal(onlyTail.verdict, 'over-limit', '尾段 9KB > 8KB ⇒ 必红');
  assert.ok(/尾段/.test(onlyTail.over[0]) && !/总增长/.test(onlyTail.over.join()), '只应点名尾段');
  const onlyTotal = LIB.judgeTrendReadings({ heap_tail_growth_kb: 2, heap_total_growth_kb: 65 });
  assert.equal(onlyTotal.verdict, 'over-limit', '总增长 65KB > 64KB ⇒ 必红');
  assert.ok(/总增长/.test(onlyTotal.over[0]) && !/尾段/.test(onlyTotal.over.join()), '只应点名总增长');
  const both = LIB.judgeTrendReadings({ heap_tail_growth_kb: 100, heap_total_growth_kb: 900 });
  assert.equal(both.over.length, 2, '两根都越界时两条都要点名');
});

test('B2 边界值不误伤：恰等于上界算过，差 1KB 才算越界', () => {
  assert.equal(LIB.judgeTrendReadings({ heap_tail_growth_kb: 8, heap_total_growth_kb: 64 }).verdict, 'pass',
    '★ 恰等于上界必须是 pass —— 若写成 >=，门会在「正好到线」时红，那不是缺陷');
  assert.equal(LIB.judgeTrendReadings({ heap_tail_growth_kb: 9, heap_total_growth_kb: 64 }).verdict, 'over-limit');
  assert.equal(LIB.judgeTrendReadings({ heap_tail_growth_kb: 8, heap_total_growth_kb: 65 }).verdict, 'over-limit');
  /* 负增长（GC 把峰值收回去）不得被当成越界 */
  assert.equal(LIB.judgeTrendReadings({ heap_tail_growth_kb: -40, heap_total_growth_kb: -300 }).verdict, 'pass');
});

test('B3 不可比就必须拒判：gc_forced 不是 true 一律拦（这是本门最重要的那一条）', () => {
  for (const v of [false, undefined, null, 'true', 1]) {
    const g = LIB.guardProbeOutput({ gc_forced: v, rounds: 8, readings: { heap_samples_kb: [1, 2, 3, 4, 5, 6], heap_tail_growth_kb: 2, heap_total_growth_kb: 15 } });
    assert.equal(g.ok, false, 'gc_forced=' + String(v) + ' 必须拒判（实测不带 gc 读数差 300 倍）');
    assert.equal(g.code, 'gc-not-forced');
  }
  const good = LIB.guardProbeOutput({ gc_forced: true, rounds: 8, readings: { heap_samples_kb: [1, 2, 3, 4, 5, 6], heap_tail_growth_kb: 2, heap_total_growth_kb: 15 } });
  assert.equal(good.ok, true);
  assert.equal(good.samples, 6);
});

test('B4 结构漂移必须拒判：样本点/轮数低于下限、主读数缺格，三者理由各不相同', () => {
  const base = { gc_forced: true, rounds: 8, readings: { heap_samples_kb: [1, 2, 3, 4, 5, 6], heap_tail_growth_kb: 2, heap_total_growth_kb: 15 } };
  assert.equal(LIB.guardProbeOutput(base).ok, true, '前置：合格样本必须判 ok（否则下面的拒判是恒真）');
  const fewSamples = { ...base, readings: { ...base.readings, heap_samples_kb: [1, 2, 3, 4, 5] } };
  assert.equal(LIB.guardProbeOutput(fewSamples).code, 'samples-too-few');
  const fewRounds = { ...base, rounds: 5 };
  assert.equal(LIB.guardProbeOutput(fewRounds).code, 'rounds-too-few');
  const missing = { ...base, readings: { ...base.readings, heap_tail_growth_kb: null } };
  assert.equal(LIB.guardProbeOutput(missing).code, 'rise-missing');
  assert.ok(!Number.isNaN(Number(LIB.MIN_ROUNDS)) && LIB.MIN_ROUNDS >= 6,
    '轮数下限不得低于 6（低于 6 时「跨轮趋势」只剩两三个点，斜率是噪声）');
});

/* ═══════════════════════════ C · 接线 ═══════════════════════════ */
test('C1 三件产物都在位，且门不自己重写判决（它 import lib）', () => {
  for (const rel of [LIB_REL, GATE_REL, PROBE_REL, BASE_REL]) assert.ok(exists(rel), '必须在位：' + rel);
  const gate = read(GATE_REL);
  assert.ok(/from '\.\/lib\/memory-trend\.mjs'/.test(gate), '门必须 import lib（判决只有一份实现）');
  assert.ok(/judgeTrendReadings/.test(gate) && /guardProbeOutput/.test(gate), '门必须真调两个纯函数');
  /* 反向自证：门里不得再出现「就地写一遍上界比较」的痕迹 */
  assert.equal(/heap_tail_growth_kb\s*>\s*TAIL_LIMIT_KB/.test(gate), false,
    '★ 门里不得自己写 `heap_tail_growth_kb > LIMIT` —— 那就是第二份判决');
});

test('C2 门必须带 --expose-gc 跑探针（不带就是在量未回收垃圾）', () => {
  const gate = read(GATE_REL);
  assert.ok(/'--expose-gc'/.test(gate), '★ 门必须在 spawn 参数里显式带 --expose-gc');
  assert.ok(/spawnSync\(process\.execPath/.test(gate), '门必须用 process.execPath 起子进程（不靠 PATH 里的 node 版本）');
  const probe = read(PROBE_REL);
  assert.ok(/gc_forced: GC_FORCED/.test(probe), '探针必须自报 gc_forced 字段（门靠它判可比性）');
  assert.ok(/typeof global\.gc === 'function'/.test(probe), 'gc_forced 的判定必须是真探测（不得写死 true）');
});

test('C3 五处接线齐：脚本键 / check 链 / 分档表同序 / 预算自算 / 主读数登记', () => {
  const pkg = readJson('package.json');
  assert.equal(pkg.scripts['memory-trend'], 'node scripts/memory-trend-check.mjs', 'package.json 必须有 memory-trend 脚本键');
  const chain = pkg.scripts.check.split('&&').map((s) => s.trim());
  assert.ok(chain.includes('npm run memory-trend'), '★ 趋势门必须在 check 链上（不在链上 = 读数等于没人读）');
  assert.equal(chain[chain.length - 1], 'npm run upstream-face', '链尾 upstream-face 是不变量');

  const tiers = readJson('config/gate-tiers.json');
  const staticCmds = tiers.tiers.static.commands;
  assert.ok(staticCmds.includes('npm run memory-trend'), '静态档必须列本门');
  const chainOrder = chain.filter((c) => staticCmds.includes(c));
  assert.deepEqual(chainOrder, staticCmds.filter((c) => chain.includes(c)),
    '★ 分档表静态档顺序必须与 check 链同序（否则人读到的档序与机器跑的顺序不同）');

  const budget = readJson('config/gate-budget.json');
  const g = budget.gates['memory-trend'];
  assert.ok(g, 'gate-budget.json 必须补入本门预算');
  assert.equal(g.limit_ms, Math.round(g.ms * (1 + budget.margin_pct / 100)), 'limit_ms 必须由 margin_pct 自算');
  assert.ok(g.ms > 0, '本门 ms 必须是实测正数（它是真起子进程的门，不会接近 0）');
  const sum = Object.values(budget.gates).reduce((a, x) => a + x.ms, 0);
  assert.equal(budget.total_ms, sum, 'total_ms 必须等于各门 ms 之和：' + sum);

  const checker = read('scripts/check-file.mjs');
  assert.ok(/'memory-trend': \[/.test(checker), '★ check-file 必须为本门登记主读数（未登记 ⇒ 执行器 exit 2 拒判）');
  const seg = checker.slice(checker.indexOf("'memory-trend': ["), checker.indexOf("'memory-trend': [") + 400);
  assert.ok(/尾段增长 \(-\?\\d\+\)KB/.test(seg), '主读数必须钉住「尾段增长」这一行');
  assert.ok(/总增长 \(-\?\\d\+\)KB/.test(seg), '主读数必须钉住「总增长」这一行');
});

/* ═══════════════════════════ D · 真跑与负控制 ═══════════════════════════ */
test('D1 真跑三次都过门（防单次侥幸）', () => {
  for (let i = 1; i <= 3; i += 1) {
    const r = runGate(['--json']);
    assert.equal(r.code, 0, '第 ' + i + ' 次真跑必须 exit 0（stderr: ' + r.err.slice(0, 200) + '）');
    const j = JSON.parse(r.out);
    assert.equal(j.verdict, 'pass', '第 ' + i + ' 次判决必须是 pass，实得 ' + j.verdict + ' ' + JSON.stringify(j.over));
    assert.equal(j.readings.gc_forced, true, '★ 每次读数都必须带 gc_forced=true（否则读数不可比）');
    assert.ok(j.readings.tail_limit_kb === LIB.TAIL_LIMIT_KB, '门报告的尾段上界必须与 lib 同源');
    assert.ok(j.readings.total_limit_kb === LIB.TOTAL_LIMIT_KB, '门报告的总增长上界必须与 lib 同源');
  }
});

test('D2 负控制：让探针每轮真留 1MB ⇒ 同一条门必须红（而且必须点到尾段）', () => {
  const r = runGate(['--keep-kb', '1024', '--json']);
  assert.equal(r.code, 1, '★ 真保留 1MB/轮时必须 exit 1（实得 ' + r.code + '；若为 0 说明门在超界时不响）');
  const j = JSON.parse(r.out);
  assert.equal(j.verdict, 'over-limit');
  assert.ok(j.over.length >= 1, '必须点名越界项');
  assert.ok(/尾段/.test(j.over.join()), '★ 必须点名尾段 —— 泄漏形态就长在尾段斜率上，只报总增长说明分块口径坏了');
  assert.ok(j.readings.retained_arrays >= 1, '负控制必须真留了数组（retained_arrays 是这条负控制的自证）');
});

test('D3 负控制必须真的比正跑高一个量级（防「负控制本来就不会红」的假对照）', () => {
  const pos = JSON.parse(runGate(['--json']).out);
  const neg = JSON.parse(runGate(['--keep-kb', '1024', '--json']).out);
  assert.ok(neg.readings.heap_tail_growth_kb > pos.readings.heap_tail_growth_kb * 10,
    '★ 负控制尾段增长必须比正跑高一个量级以上（正 ' + pos.readings.heap_tail_growth_kb
    + 'KB / 负 ' + neg.readings.heap_tail_growth_kb + 'KB）——否则这条负控制换不来任何分辨力');
});

test('D4 读不到就不发合格证：探针不在场时门必须 exit 2（不是 0）', () => {
  const fakeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rp-v4144-'));
  try {
    const r = spawnSync(process.execPath, [path.join(ROOT, GATE_REL), '--root', fakeRoot, '--json'],
      { cwd: ROOT, encoding: 'utf8', timeout: 120000 });
    assert.equal(r.status, 2, '空树里没有探针 ⇒ 必须 exit 2 拒判（实得 ' + r.status + '）');
    const j = JSON.parse(String(r.stdout || '{}'));
    assert.equal(j.verdict, 'reject', 'JSON 模式下必须报 verdict=reject');
    assert.ok(/探针不在场/.test(String(j.why)), '拒判理由必须点名缺什么：' + String(j.why));
  } finally {
    fs.rmSync(fakeRoot, { recursive: true, force: true });
  }
});

/* ═══════════════════════════ E · 版本锚与诚实边界 ═══════════════════════════ */
test('E1 五源同源且 ≥ ' + BORN_V, () => {
  const pkg = readJson('package.json').version;
  const man = readJson('manifest.json').version;
  const ul = readJson('update-log.json');
  const led = readJson('tests/audit/status-ledger.json');
  const idxV = /const ST_PHONE_VERSION = '([^']+)'/.exec(read('index.js'))[1];
  assert.equal(new Set([pkg, man, ul.latest, ul.head, led.version, idxV]).size, 1,
    '五源必须一致：' + JSON.stringify({ pkg, man, latest: ul.latest, head: ul.head, led: led.version, idxV }));
  assert.ok(sem(pkg) >= sem(BORN_V), '版本不得低于本档诞生版 ' + BORN_V + '，实得 ' + pkg);
});

test('E2 诚实边界：门只判跨轮趋势，不得自称判过「真机长时运行」', () => {
  const gate = read(GATE_REL);
  assert.ok(/真机长时运行/.test(gate), '★ 门的输出必须如实写明不判真机长时运行');
  const base = readJson(BASE_REL);
  assert.ok(Array.isArray(base.unmeasurable) && base.unmeasurable.length >= 3,
    '基线必须仍登记着不可测项（不得因为有了门就顺手抹掉）');
  assert.ok(base.unmeasurable.some((u) => /小时级|长时间/.test(String(u.item))),
    '★ 「跨会话长时间运行（小时级）」必须仍在不可测清单里');
  assert.ok(/跨轮趋势/.test(String(base.noise_note)), '基线的噪声声明必须仍点明「只判趋势」');
});
