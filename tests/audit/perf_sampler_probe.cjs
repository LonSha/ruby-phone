#!/usr/bin/env node
/* ============================================================
 * tests/audit/perf_sampler_probe.cjs
 * 探针：被动采样器的**有界性**与三态口径 —— 只量，不改。
 * ------------------------------------------------------------
 * 【要回答的问题】（R-O6 第二层第 5 条「性能读数被动采样、有界保存，
 *   守护器自身不得常驻拖累」的准入读数）
 *   ① 溢出时账对不对？（灌 limit+N 条 ⇒ count 停在 limit、dropped == N）
 *   ② 样本顺序对不对？（环形缓冲的读序必须是最旧→最新 —— 写指针回绕
 *      后若按物理下标读，读出来的是乱序，而乱序的 longtask 序列无法对时序）
 *   ③ 「没测到」与「0 条」是否不同形？（supported=false 时不得报 count=0 当合格证）
 *   ④ 守护器自身有没有定时器？（浏览器里无法直接数，但 Node 侧可把
 *      globalThis.setInterval 换成一个计数器 —— 真「被动」的定义就是它恒为 0）
 *   ⑤ arm/disarm 是否幂等？（重复 arm 不重订、disarm 后可再 arm）
 *
 * 【与其它探针的关系】
 *   与 longlist_scale_probe / search_scale_probe 同族：只读 / 可复算 / 位置无关 /
 *   fail-closed。区别：它**不跑浏览器** —— 有界性与三态是纯函数性质，
 *   在 Node 上比在浏览器里更容易复算（浏览器里那部分由 o6-motion-throttle 场景读）。
 *
 * 【口径纪律】
 *   · 只读：不写任何文件；基线由调用方重定向 stdout 落盘。
 *   · 完全确定性：合成 observer，不用真 PerformanceObserver（后者结果不可复算）。
 *   · 位置无关：根走 --root 或 __dirname/../..，代码里不得出现绝对路径字面量。
 *   · 读不到就 fail-closed（exit 2），绝不以 0 发合格证。
 * ============================================================ */
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const argv = process.argv.slice(2);
const argVal = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : null; };
const JSON_MODE = argv.includes('--json');
const rootArg = argVal('--root');
const ROOT = rootArg ? path.resolve(rootArg) : path.resolve(__dirname, '..', '..');

const MOD_REL = 'config/perf-sampler.js';
const MANIFEST_REL = 'manifest.json';
for (const [p, label] of [[path.join(ROOT, MOD_REL), MOD_REL], [path.join(ROOT, MANIFEST_REL), MANIFEST_REL]]) {
  if (!fs.existsSync(p)) { console.error('[perf-sampler] 读不到 ' + label + ' —— fail-closed 拒判'); process.exit(2); }
}
const MANIFEST = (() => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, MANIFEST_REL), 'utf8')); } catch (_e) { return null; } })();
if (!MANIFEST || !MANIFEST.version) { console.error('[perf-sampler] 读不到 manifest.json 的 version —— fail-closed 拒判'); process.exit(2); }
const MEASURED_AT = 'v' + MANIFEST.version;

(async () => {
  const mod = await import(pathToFileURL(path.join(ROOT, MOD_REL)).href).catch((e) => {
    console.error('[perf-sampler] 模块装载失败 —— fail-closed 拒判：' + String((e && e.message) || e).slice(0, 200));
    return null;
  });
  if (!mod || typeof mod.createPerfSampler !== 'function') {
    console.error('[perf-sampler] 导出面不可用（createPerfSampler 缺席）—— fail-closed 拒判');
    process.exit(2);
  }

  /* ★ 被动性的**可测定义**：采样器存活期间不得调用 setInterval / setTimeout。
   *   把 globalThis 上这两个函数换成计数器 —— 计数不为 0 就是「守护器自己在轮询」。
   *   （本仓 v2.27.0 把三处永久轮询改成登记制，理由写在 runtime-lifecycle.js 文件头。） */
  const realSetInterval = globalThis.setInterval;
  const realSetTimeout = globalThis.setTimeout;
  let timerCalls = 0;
  globalThis.setInterval = function () { timerCalls += 1; return realSetInterval.apply(this, arguments); };
  globalThis.setTimeout = function () { timerCalls += 1; return realSetTimeout.apply(this, arguments); };

  const readings = {};
  const criteria = [];

  /* ---------- ① 有界：灌 limit + N 条 ---------- */
  const LIMIT = 8;
  const EXTRA = 5;
  const s1 = mod.createPerfSampler({ limit: LIMIT, observe: (cb) => { s1._cb = cb; return { disconnect() { s1._disconnected = true; } }; } });
  const armed1 = s1.arm('probe');
  for (let i = 1; i <= LIMIT + EXTRA; i++) s1.push({ duration: i, startTime: i * 10, name: 'longtask' });
  const r1 = s1.readings();
  readings.bounded = { armed: armed1, limit: r1.limit, count: r1.count, dropped: r1.dropped, maxMs: r1.maxMs, lastMs: r1.lastMs };
  criteria.push({ id: 'P1', desc: '环形缓冲有界：灌 limit+extra 条后 count 停在 limit，dropped == extra',
    pass: r1.limit === LIMIT && r1.count === LIMIT && r1.dropped === EXTRA, got: 'limit=' + r1.limit + ' count=' + r1.count + ' dropped=' + r1.dropped });

  /* ---------- ② 读序：最旧→最新（回绕后不得乱序） ---------- */
  /* 灌进去的是 1..limit+extra，溢出 extra 条，故存活样本应是 (extra+1)..(limit+extra)，
   *   且 maxMs 必为 limit+extra、lastMs 必为 limit+extra。 */
  const seq = (() => { const s2 = mod.createPerfSampler({ limit: LIMIT, observe: () => ({ disconnect() {} }) });
    s2.arm('probe');
    for (let i = 1; i <= LIMIT + EXTRA; i++) s2.push({ duration: i, startTime: i * 10 });
    return s2; })();
  const ring = seq.readings();
  const expectMax = LIMIT + EXTRA;
  const expectMin = EXTRA + 1;
  readings.order = { maxMs: ring.maxMs, lastMs: ring.lastMs, count: ring.count, expectMin: expectMin, expectMax: expectMax };
  criteria.push({ id: 'P2', desc: '环形缓冲读序为最旧→最新（maxMs / lastMs 都落在溢出后的尾样本上）',
    pass: ring.maxMs === expectMax && ring.lastMs === expectMax && ring.count === LIMIT,
    got: 'maxMs=' + ring.maxMs + ' lastMs=' + ring.lastMs + '（期望 max=' + expectMax + ' last=' + expectMax + '，存活样本自 ' + expectMin + ' 起）' });

  /* ---------- ③ 三态：未支持 != 0 条 ---------- */
  const unsupported = mod.createPerfSampler({ limit: LIMIT, win: {} });
  const uArm = unsupported.arm('probe');
  const uRead = unsupported.readings();
  readings.unsupported = { armOk: uArm.ok, support: unsupported.support(), probed: uRead.probed, supported: uRead.supported, count: uRead.count };
  criteria.push({ id: 'P3', desc: '宿主不支持时 arm 返回 ok=false 且 readings().supported===false、probed===true（“没测到”不得与“0 条”同形）',
    pass: uArm.ok === false && uRead.supported === false && uRead.probed === true && uRead.count === 0,
    got: 'armOk=' + uArm.ok + ' supported=' + uRead.supported + ' probed=' + uRead.probed + ' count=' + uRead.count });

  /* ---------- ④ 被动：采样期间零定时器调用 ---------- */
  timerCalls = 0;
  const s4 = mod.createPerfSampler({ limit: 4, observe: () => ({ disconnect() {} }) });
  s4.arm('probe');
  for (let i = 0; i < 10; i++) s4.push({ duration: 60 + i });
  s4.readings();
  s4.disarm('probe');
  s4.dispose();
  readings.passive = { timerCalls: timerCalls };
  criteria.push({ id: 'P4', desc: '守护器自身零定时器（被动订阅，不轮询）：整段生命周期内 setInterval/setTimeout 调用数为 0',
    pass: timerCalls === 0, got: 'timerCalls=' + timerCalls });

  globalThis.setInterval = realSetInterval;
  globalThis.setTimeout = realSetTimeout;

  /* ---------- ⑤ arm/disarm 幂等 ---------- */
  let disconnects = 0;
  const s5 = mod.createPerfSampler({ limit: 4, observe: () => ({ disconnect() { disconnects += 1; } }) });
  const a1 = s5.arm('probe');
  const a2 = s5.arm('probe');
  const d1 = s5.disarm('probe');
  const d2 = s5.disarm('probe');
  const a3 = s5.arm('probe');
  readings.idempotent = { a1: a1.ok, a2: a2.reason, d1was: d1.was, d2was: d2.was, a3: a3.ok, disconnects: disconnects };
  criteria.push({ id: 'P5', desc: 'arm/disarm 幂等：重复 arm 走 already-armed 短路、重复 disarm 报 was=false、disarm 后可再 arm',
    pass: a1.ok === true && a2.reason === 'already-armed' && d1.was === true && d2.was === false && a3.ok === true && disconnects === 1,
    got: 'a2=' + a2.reason + ' d1was=' + d1.was + ' d2was=' + d2.was + ' a3=' + a3.ok + ' disconnects=' + disconnects });

  /* ---------- ⑥ 可复算：同输入两遍读数逐字段相等 ---------- */
  const mk = () => { const s = mod.createPerfSampler({ limit: 6, observe: () => ({ disconnect() {} }) }); s.arm('p'); for (let i = 1; i <= 9; i++) s.push({ duration: i * 1.5, startTime: i }); return s.readings(); };
  const runA = mk();
  const runB = mk();
  const same = JSON.stringify(runA) === JSON.stringify(runB);
  readings.repeatable = { equal: same, sample: runA };
  criteria.push({ id: 'P6', desc: '同一输入复算两遍读数逐字段相等（读数可复算）',
    pass: same, got: same ? '两遍逐字段相等' : '不一致：' + JSON.stringify(runA) + ' vs ' + JSON.stringify(runB) });

  const failed = criteria.filter((c) => !c.pass);
  const out = {
    file: 'tests/audit/perf_sampler_probe.cjs',
    probe: 'tests/audit/perf_sampler_probe.cjs',
    note: '被动采样器有界性与三态口径取证：合成 observer + Node（无浏览器）。读数不代表真机上的长任务分布；浏览器侧归 tests/browser/scenarios/o6-motion-throttle.scen.js。',
    measured_at: MEASURED_AT,
    module: MOD_REL,
    readings: readings,
    criteria: criteria,
  };
  if (JSON_MODE) {
    process.stdout.write(JSON.stringify(out, null, 1) + String.fromCharCode(10));
  } else {
    console.log('[perf-sampler] ' + MOD_REL + ' @ ' + MEASURED_AT);
    for (const c of criteria) console.log((c.pass ? '  ok  ' : '  FAIL') + ' ' + c.id + ' ' + c.desc + ' | ' + c.got);
    console.log('[perf-sampler] ' + (failed.length ? failed.length + ' 条判据未通过' : '全部判据通过'));
  }
  process.exit(failed.length ? 1 : 0);
})();
