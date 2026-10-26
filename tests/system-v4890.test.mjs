/* ============================================================
 * tests/system-v4890.test.mjs — v4.89.0 第九批缝入（四件内核）
 * ------------------------------------------------------------
 * 判据分六面：
 *   A 面 版本锚（五源同源 + 两处文案同份）+ 内核自包含自证
 *   B 面 激活扩散：衰减 / 抑制传负 / 上限 / 稳定序
 *   C 面 召回注入计划：角色映射 / 越界回落 / 计划外回 0 / 读数不说谎
 *   D 面 后台队列：满队丢弃计数 / 退避次数 / 中止分列 / 不重试开关 / 串行写入
 *   E 面 上游失败整形：三样齐备 / 深 4 上限 / 前缀循环剥 / 已知码专句 / 报错面接线
 *   F 面 中枢与诊断面：同步异步分工 / skipped 不冒充 / 六态文案 / 负控制两条
 *
 * 【为什么 async 自检要单独立面（本版最容易被写成假绿的地方）】
 *   orchestrator 原先同步逐个调 `v.run()`。把 async 自检直接塞进同步表，`res.ok === true`
 *   永远不成立 ⇒ 不再有红、只有静默失真。本套件因此同时钉住三件事：
 *     ① async 入口真 await（延迟 20ms 后压的失败必须抓到）；
 *     ② 同步入口对异步件**如实标 skipped**、且不把它算进 passed；
 *     ③ 两处的失败取值都认 `problems`（原先只认 `bad`，既有十一件失败也被算成通过）。
 *
 * 【负控制形式纪律（本仓三形假绿，逐条避开）】
 *   ① 对原文件断言 ② 破坏写死成模拟常量 ③ 破坏把判据自己删了。
 *   统一修法：真源码破坏（锚点恰中 1 次）→ data: URL 装载破坏副本 → 在副本上重跑同款判据，
 *   并对原版跑同一判据证明判据真、对破坏副本证明它假。两向都要。
 * ============================================================ */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const rel = (p) => path.join(ROOT, p);
const read = (p) => fs.readFileSync(rel(p), 'utf8');
const BORN_V = '4.89.0';

/* 四件内核（全部零 import 的自包含模块，可 data: URL 装载副本） */
import * as AD from '../config/activation-diffusion.js';
import * as RP from '../config/recall-injection-plan.js';
import * as BQ from '../config/background-queue.js';
import * as UF from '../config/upstream-failure.js';
import { SubsystemOrchestrator } from '../config/subsystem-orchestrator.js';
import { collectDiagnose, selfCheckFaceText } from '../apps/diagnose/diagnose-data.js';

/* ============================================================ */
/* A 面：版本锚与自包含                                           */
/* ============================================================ */
const semver = (v) => String(v).split('.').map(Number).reduce((a, x) => a * 1000 + x, 0);

test('A1: 五源版本同源且不低于 4.89.0', () => {
  /* [v4.90.0 交棒改写] 本版出生时五源都是 4.89.0，原判据把它写成等值锚 —— 抬版即红（那是抬版仪式，
   *   不是缺陷）。按仓内既定口径改成**下限形**：五源必须彼此一致、且都不低于诞生版（不回退即可），
   *   「当版是否等于某值」由当版套件（tests/system-v4900.test.mjs 的 A1）接管。 */
  const sem = (v) => String(v).split('.').map(Number).reduce((a, x) => a * 1000 + x, 0);
  const pkg = JSON.parse(read('package.json')).version;
  const man = JSON.parse(read('manifest.json')).version;
  const idx = read('index.js');
  const log = JSON.parse(read('update-log.json'));
  const five = [pkg, man, log.latest, log.head, log.versions[log.latest].version];
  assert.equal(new Set(five).size, 1, '五源必须彼此一致：' + five.join('/'));
  for (const v of five) assert.ok(sem(v) >= sem(BORN_V), '不得低于诞生版 ' + BORN_V + '，实得 ' + v);
  assert.match(idx, new RegExp("const ST_PHONE_VERSION = '" + pkg.replace(/\./g, '\\.') + "';"), '入口常量必须与五源一致');
});

test('A2: 四件内核在场，且除零依赖叶子 num-gate 外不引入其它依赖', () => {
  for (const f of ['activation-diffusion', 'recall-injection-plan', 'background-queue', 'upstream-failure']) {
    const src = read('config/' + f + '.js');
    assert.ok(src.length > 1000, f + ' 过短，可能被截断');
    const specs = [...src.matchAll(/^\s*import[^;]*from\s+'([^']+)'/gm)].map((m) => m[1]);
    for (const sp of specs) assert.equal(sp, './num-gate.js', f + ' 只允许引 num-gate，实得 ' + sp);
  }
});

test('A3: 四件自检自身全绿，且都在中枢的异步表里被登记', async () => {
  for (const [name, mod] of [['activationDiffusionSelfCheck', AD], ['recallInjectionPlanSelfCheck', RP],
    ['backgroundQueueSelfCheck', BQ], ['upstreamFailureSelfCheck', UF]]) {
    const r = await mod[name]();
    assert.equal(r.ok, true, name + ' 自检有红：' + JSON.stringify(r.problems));
  }
  const keys = Object.keys(new SubsystemOrchestrator(null)._kernelAsyncChecks());
  assert.deepEqual(keys.sort(), ['activationDiffusion', 'backgroundQueue', 'recallInjectionPlan', 'upstreamFailure']);
  /* 同步表里**不得**再出现异步件（重复登记会让 skip 与真跑同时成立，读数自相矛盾）。 */
  const syncKeys = Object.keys(new SubsystemOrchestrator(null)._kernelChecks());
  for (const k of keys) assert.equal(syncKeys.includes(k), false, k + ' 不得同时在同步表里');
});

/* ============================================================ */
/* B 面：激活扩散                                                 */
/* ============================================================ */
test('B1: 能量逐层衰减，越远越弱', () => {
  const edges = [{ from: 'a', to: 'b', strength: 1 }, { from: 'b', to: 'c', strength: 1 }];
  const r = AD.propagateActivation(AD.buildAdjacency(edges), [{ id: 'a', energy: 2 }]);
  assert.ok((r.get('b') || 0) > 0);
  assert.ok((r.get('b') || 0) > (r.get('c') || 0), '第二层必须弱于第一层');
});

test('B2: 抑制边传负能量', () => {
  const edges = [{ from: 'a', to: 'b', strength: 1, label: '仇人' }];
  const r = AD.propagateActivation(AD.buildAdjacency(edges), [{ id: 'a', energy: 1 }]);
  assert.ok((r.get('b') || 0) < 0, '抑制边必须传负，实得 ' + r.get('b'));
  assert.equal(AD.edgeTypeOf({ label: '同事' }), 0);
});

test('B3: 节点上限与同分稳定序都成立', () => {
  const edges = [];
  for (let i = 0; i < 60; i++) edges.push({ from: 'seed', to: 'n' + i, strength: 1 });
  /* 上限字段是 topK，且默认 100 大过 60 —— 不显式传小值就判不动（假绿形态②：判据根本没被调用）。 */
  const capped = AD.propagateActivation(AD.buildAdjacency(edges), [{ id: 'seed', energy: 1 }], { topK: 5 });
  assert.ok(capped.size <= 6, 'topK 必须生效，实得 ' + capped.size);
  const full = AD.propagateActivation(AD.buildAdjacency(edges), [{ id: 'seed', energy: 1 }]);
  assert.equal(full.size, 61, '默认上限下 60 个邻居必须全在，实得 ' + full.size);
  /* diffuseGraph 返回 {active,suppressed,total}（不是 Map）；同分次序由 localeCompare 定死。 */
  const same = AD.diffuseGraph([], ['p', 'q', 'r']);
  assert.deepEqual(same.active.map((x) => x.nodeId), ['p', 'q', 'r'], '同分必须按 id 稳定，不得抖散');
});

test('B4: 读数不说谎 —— 没实况说未取', () => {
  assert.match(AD.diffusionLine(null), /未取/);
  assert.match(AD.diffusionLine(new Map()), /空/);
  assert.match(AD.diffusionLine(new Map([['a', 2]])), /1 个节点/);
});

/* ============================================================ */
/* C 面：召回注入计划                                             */
/* ============================================================ */
const cands = () => ([
  { memoryId: 'm1', permission: 'cite', score: 0.2 },
  { memoryId: 'm2', permission: 'associate-only', score: 0.1 },
  { memoryId: 'm3', permission: 'cautious', score: 0.9 },
]);

test('C1: 权限映射到角色与优先级（写死在表里，不散落调用点）', () => {
  const r = RP.planFromCandidates(cands());
  assert.equal(r.valid, true, JSON.stringify(r.issues));
  const byId = new Map(r.plan.items.map((i) => [i.memoryId, i]));
  assert.equal(byId.get('m1').role, 'anchor');
  assert.equal(byId.get('m3').role, 'cause');
  assert.equal(byId.get('m2').role, 'background');
});

test('C2: 分数越界必须回落 1，不得混进排序', () => {
  const r = RP.normalizeRecallInjectionPlan({ items: [{ memoryId: 'x', role: 'anchor', priority: 9 }] });
  assert.equal(r.valid, false, '越界必须记问题');
  assert.equal(r.plan.items[0].priority, 1, '越界优先级必须回落 1，实得 ' + r.plan.items[0].priority);
});

test('C3: 计划外节点比较器回 0（交给调用方稳定排序）', () => {
  const plan = RP.normalizeRecallInjectionPlan({ items: [{ memoryId: 'in', role: 'anchor', priority: 5 }] }).plan;
  assert.equal(RP.compareNodesByRecallInjectionPlan(plan, { id: 'out1' }, { id: 'out2' }), 0);
  assert.ok(RP.compareNodesByRecallInjectionPlan(plan, { id: 'in' }, { id: 'out1' }) < 0, '计划内必须排在计划外前');
});

test('C4: 80 条上限与五角色顺序（顺序即注入序）', () => {
  assert.equal(RP.RECALL_INJECTION_MAX_ITEMS, 80);
  const many = Array.from({ length: 120 }, (_, i) => ({ memoryId: 'k' + i, permission: 'cite', score: 1 }));
  const r = RP.planFromCandidates(many);
  assert.equal(r.plan.items.length, 80);
  assert.deepEqual([...RP.RECALL_INJECTION_ROLES], ['anchor', 'cause', 'pov', 'constraint', 'background']);
});

test('C5: 读数报角色与条数，空计划说空', () => {
  assert.match(RP.recallPlanLine(null), /空/);
  const r = RP.planFromCandidates([{ memoryId: 'm', permission: 'cite', score: 9 }]);
  assert.match(RP.recallPlanLine(r), /锚点 1/);
});

/* ============================================================ */
/* D 面：后台队列                                                 */
/* ============================================================ */
test('D1: 满队不进队、丢并计数、回 queue-full', async () => {
  const q = BQ.createBoundedQueue({ maxItems: 2, maxRetries: 0 });
  const slow = () => new Promise((r) => setTimeout(r, 15));
  assert.equal(q.enqueue('a', slow).queued, true);
  assert.equal(q.enqueue('b', slow).queued, true);
  const c = q.enqueue('c', slow);
  assert.equal(c.queued, false);
  assert.equal(c.reason, 'queue-full');
  assert.equal(q.getSnapshot().dropped, 1);
  await new Promise((r) => setTimeout(r, 80));
});

test('D2: maxRetries 线性退避 —— 重试次数与快照分列', async () => {
  const q = BQ.createBoundedQueue({ maxItems: 4, maxRetries: 2, retryBaseMs: 5 });
  let tries = 0;
  await q.enqueue('boom', async () => { tries += 1; throw new Error('x'); }).done;
  assert.equal(tries, 3, '必须共跑 3 次，实得 ' + tries);
  assert.equal(q.getSnapshot().failed, 1);
  assert.equal(q.getSnapshot().aborted, 0);
});

test('D3: 中止不重试且与失败分列；retryable:false 直接不重试', async () => {
  const q = BQ.createBoundedQueue({ maxItems: 4, maxRetries: 3, retryBaseMs: 5 });
  let ab = 0;
  await q.enqueue('ab', async () => { ab += 1; const e = new Error('s'); e.name = 'AbortError'; throw e; }).done;
  assert.equal(ab, 1);
  assert.equal(q.getSnapshot().aborted, 1);
  assert.equal(q.getSnapshot().failed, 0);

  const q2 = BQ.createBoundedQueue({ maxItems: 4, maxRetries: 3, retryBaseMs: 5 });
  let once = 0;
  await q2.enqueue('once', async () => { once += 1; throw new Error('d'); }, { retryable: false }).done;
  assert.equal(once, 1);
});

test('D4: 并发被限在 strict 档 1，结果按原下标', async () => {
  let peak = 0, live = 0;
  const out = await BQ.runLimited([1, 2, 3, 4], async (n) => {
    live += 1; peak = Math.max(peak, live);
    await new Promise((r) => setTimeout(r, 2));
    live -= 1; return n * 10;
  }, { concurrency: BQ.concurrencyOf('strict', 8) });
  assert.equal(peak, 1);
  assert.deepEqual(out, [10, 20, 30, 40]);
  assert.equal(BQ.normalizeExecutionMode('瞎写'), 'strict');
});

test('D5: 世界书写入经队列真串行 —— 两条都留（后写不覆盖前写）', async () => {
  const WM = await import('../config/worldbook-manager.js');
  const wm = new WM.WorldbookManager(null);
  /* 桩打在**真被调用的方法**上（`_loadWorldInfoViaFrontendModule` / `_saveWorldInfo`）：
   *   读口那个模块级函数 `fetchWorldInfoByName` 桩不到方法上，若桩错就会静默落成 read-failed。 */
  const stored = [];
  const saved = [];
  let loadCalls = 0;
  wm._loadWorldInfoViaFrontendModule = async () => {
    loadCalls += 1;
    return { entries: stored.slice() };
  };
  wm._refreshWorldInfoCache = async () => true;
  wm._saveWorldInfo = async (name, payload) => {
    /* 既有表可能是不规整的字符串条目（mergeEntries 容忍），故字符串与对象都要取值。 */
    const list = Object.values(payload.entries || {}).map((e) => (typeof e === 'string' ? e : e.content));
    saved.push(list.length);
    stored.length = 0;
    stored.push(...list);
    return true;
  };
  const r = await Promise.all([
    wm.writeMemoryEntries('book', [{ uid: 1, content: '第一条' }]),
    wm.writeMemoryEntries('book', [{ uid: 2, content: '第二条' }])
  ]);
  assert.equal(r.every((x) => x.ok), true, '两次写入都必须 ok：' + JSON.stringify(r.map((x) => x.reason)));
  assert.equal(loadCalls, 2, '两次都必须真读一次（不是被合并掉）');
  assert.deepEqual(saved, [1, 2], '第二次写入必须看到第一条已落库（后写不覆盖前写），实得 ' + JSON.stringify(saved));
  assert.deepEqual(stored.slice().sort(), ['第一条', '第二条'].sort());
});

/* ============================================================ */
/* E 面：上游失败整形                                             */
/* ============================================================ */
test('E1: 详情三样齐备才算，缺一样不识别', () => {
  assert.ok(UF.asUpstreamFailureDetails({ code: 'network.timeout', category: 'network', message_key: 'k' }));
  assert.equal(UF.asUpstreamFailureDetails({ code: 'network.timeout', category: 'network' }), null);
  assert.equal(UF.asUpstreamFailureDetails('network.timeout'), null);
});

test('E2: 深 4 是硬上限（第 4 层挖得到、第 6 层挖不到）', () => {
  const t = { code: 'network.dns_failed', category: 'network', messageKey: 'k' };
  let d4 = t;
  for (let i = 0; i < 3; i++) d4 = { details: d4 };
  assert.ok(UF.findUpstreamFailureDetails(d4));
  let d6 = t;
  for (let i = 0; i < 6; i++) d6 = { details: d6 };
  assert.equal(UF.findUpstreamFailureDetails(d6), null);
});

test('E3: 前缀循环剥到稳定；业务话术不剥', () => {
  assert.equal(UF.readableErrorText('Internal server error: Bad request: 模型不支持'), '模型不支持');
  assert.equal(UF.readableErrorText('生成失败：额度用完'), '生成失败：额度用完');
  assert.equal(UF.ERROR_PREFIX_PATTERNS.length, 13);
});

test('E4: 已知码给专句并附 endpoint，未知码给兜底句', () => {
  assert.match(UF.upstreamFailureFallbackText({ code: 'network.timeout' }), /超时/);
  assert.ok(UF.upstreamFailureFallbackText({ code: 'network.timeout', endpoint: 'https://x' }).includes('https://x'));
  assert.equal(UF.upstreamFailureFallbackText({ code: 'network.zzz' }), UF.UPSTREAM_FAILURE_UNKNOWN);
});

test('E5: 报错面真接上 —— 埋在 details 的码上屏成一句人话', async () => {
  const { ApiManager } = await import('../config/api-manager.js');
  const m = new ApiManager({});
  const e = new Error('fetch failed');
  e.details = { code: 'network.dns_failed', category: 'network', message_key: 'k', endpoint: 'https://a/v1' };
  const text = m._formatError(e, '兜底');
  assert.match(text, /解析不到上游地址/);
  assert.match(text, /code=network\.dns_failed/);
  assert.equal(text.indexOf('解析不到'), 0, '专句必须置顶');
  assert.match(m._formatHttpFailureBody(400, 'Bad request: 缺参数 model'), /^缺参数 model$/);
  assert.match(m._formatHttpFailureBody(502, JSON.stringify({ error: { code: 'network.tls_failed', category: 'net', message_key: 'k' } })), /TLS/);
});

/* ============================================================ */
/* F 面：中枢分工、诊断面与负控制                                 */
/* ============================================================ */
test('F1: async 入口无 problems、出四件读数行、passed 含四件', async () => {
  const r = await new SubsystemOrchestrator(null).runSelfChecks();
  assert.deepEqual(r.problems, []);
  assert.equal(r.ok, true);
  assert.equal(r.skippedChecks, 0);
  for (const k of ['activationDiffusion', 'recallInjectionPlan', 'backgroundQueue', 'upstreamFailure']) {
    assert.ok(r.lines[k], k + ' 必须出读数行');
  }
});

test('F2: 同步入口把异步件标 skipped，既不判红也不冒充通过', () => {
  const o = new SubsystemOrchestrator(null);
  const s = o.runSelfChecksSync();
  const f = o._composeReport(o._syncChecks());
  assert.equal(s.skippedChecks, 4);
  assert.equal(s.problems.length, 0);
  assert.equal(s.passedChecks, f.passedChecks, '跳过件不得计进通过数');
  for (const k of Object.keys(o._kernelAsyncChecks())) {
    assert.equal(s.details[k].skipped, true);
    assert.equal(s.lines[k], undefined, k + ' 跳过件不得出读数行');
  }
});

test('F3: 诊断面六态文案互不相同，且跳过时不说全绿', () => {
  const texts = [
    selfCheckFaceText(null),
    selfCheckFaceText({ linked: false, reason: 'not-mounted' }),
    selfCheckFaceText({ linked: true, reason: 'sync-only', passed: 28, skipped: 4, problems: [] }),
    selfCheckFaceText({ linked: true, reason: 'full', passed: 31, skipped: 0, problems: ['x: 坏了'] }),
    selfCheckFaceText({ linked: true, reason: 'full', passed: 32, skipped: 0, problems: [] })
  ];
  assert.equal(new Set(texts).size, 5, '六态文案必须互不相同');
  assert.match(texts[2], /跳过 4 项/);
  assert.match(texts[2], /不等于/);
  assert.equal(new RegExp('无跳过').test(texts[2]), false);
  assert.match(texts[3], /有 1 条问题/);
  /* 真取数：未挂载与挂载后必须分得开。 */
  assert.match(selfCheckFaceText(collectDiagnose({}, null).selfCheckFace), /不在位/);
  const sub = new SubsystemOrchestrator(null);
  const win = { VirtualPhone: { subsystemSelfCheckSync: () => sub.runSelfChecksSync() } };
  assert.match(selfCheckFaceText(collectDiagnose(win, null).selfCheckFace), /仅同步面/);
});

/* ── 负控制 ─────────────────────────────────────────────────── */
/** 真源码破坏：锚点必须恰中 1 次、必改字节（H6 工具两向自证）。 */
function breakSrc(src, anchor, repl) {
  const n = src.split(anchor).length - 1;
  if (n !== 1) throw new Error('锚点命中 ' + n + ' 次（要求恰 1 次）：' + anchor.slice(0, 40));
  const out = src.split(anchor).join(repl);
  if (out === src) throw new Error('破坏未改字节');
  return out;
}
let seq = 0;
const loadBroken = async (src) => import(
  'data:text/javascript;charset=utf-8;base64,' + Buffer.from(src, 'utf8').toString('base64') + '#nc' + (++seq));
/** 两向：同一判据在原版上必须真、在破坏副本上必须假。 */
async function negative(file, anchor, repl, judge, label) {
  const broken = await loadBroken(breakSrc(read('config/' + file + '.js'), anchor, repl));
  const real = await judge(await import('../config/' + file + '.js'));
  const fake = await judge(broken);
  assert.equal(real, true, label + ' 原版判据不为真（判据写歪了）');
  assert.equal(fake, false, label + ' 破坏副本仍为真（负控制失效＝判据自我指涉）');
}

test('F4: 挖码函数恒返回 null ⇒ 埋在 details 的码再也挖不到', async () => {
  await negative('upstream-failure',
    '    if (depth > DETAIL_DEPTH_MAX || value === null || value === undefined) return null;',
    '    if (depth > DETAIL_DEPTH_MAX || value === null || value === undefined) return null;\n    return null;',
    (m) => m.findUpstreamFailureDetails({ details: { code: 'network.timeout', category: 'network', messageKey: 'k' } }) !== null,
    'F4');
});

test('F5: 剥前缀直返原文 ⇒ 两层前缀一层不剩变成一层不剥', async () => {
  await negative('upstream-failure', 'export function stripErrorPrefixes(message) {',
    "export function stripErrorPrefixes(message) {\n    return String(message == null ? '' : message).trim();",
    (m) => m.readableErrorText('Internal server error: Bad request: 模型') === '模型',
    'F5');
});

test('F6: 中枢读失败字段改回只认 bad ⇒ 异步件真红被吞成通过', async () => {
  /* 中枢不是自包含模块（带一堆 import），故走临时文件落在仓内再 import，事后删掉。 */
  const src = read('config/subsystem-orchestrator.js');
  const broken = breakSrc(src, '    if (Array.isArray(res.problems)) return res.problems;', '    return [];');
  const tmp = rel('config/__nc_orchestrator.js');
  fs.writeFileSync(tmp, broken, 'utf8');
  try {
    const { SubsystemOrchestrator: Broken } = await import('../config/__nc_orchestrator.js?' + (++seq));
    /* 造一件真红：上游失败自检被换成必红（只换运行函数，不动判据取值层 ——
     *   否则破坏点有两个，分不出是谁失效）。 */
    const red = { problems: ['注入红'], ok: false };
    /* `_kernelAsyncChecks()` 每次返回**新对象**，故必须整体替换该方法（改它的返回值是空改）。 */
    const inject = (o) => {
      const base = o._kernelAsyncChecks.bind(o);
      o._kernelAsyncChecks = () => Object.assign({}, base(), { upstreamFailure: { run: () => red, line: null } });
      return o;
    };
    const good = await inject(new SubsystemOrchestrator(null)).runSelfChecks();
    const bad = await inject(new Broken(null)).runSelfChecks();
    assert.equal(good.ok, false, '原版必须被这条红打穿');
    assert.match(good.problems.join(' '), /注入红/);
    /* [v4.90.0 交棒] 件数**不再写死**：本套件出生时 32 件、v4.90.0 起 35 件，写死就让下一版一加内核
     *   就在这里假红（那是抬版仪式，不是缺陷）。改成以 totalChecks 为基准：原版比总数少 1 件通过、
     *   破坏版等于总数（红的这件被错算成通过）—— 强度不降，且与件数解耦。 */
    assert.equal(good.passedChecks, good.totalChecks - 1, '原版：总数里恰有 1 件红 ⇒ 通过数少 1');
    assert.equal(bad.ok, true, '破坏版：红被吞掉，整轮谎报全绿');
    assert.equal(bad.problems.length, 0);
    assert.equal(bad.passedChecks, bad.totalChecks, '破坏版：红的这件被错算成通过');
  } finally {
    fs.unlinkSync(tmp);
  }
});

test('F7: 自检真红时 async 入口必须翻红（延迟失败被 await 到）', async () => {
  const src = read('config/background-queue.js');
  const anchor = "    const push = (ok, label) => { if (!ok) problems.push(label); };";
  const broken = breakSrc(src, anchor, anchor + "\n    await new Promise((r) => setTimeout(r, 20));\n    push(false, '注入失败');");
  const tmp = rel('config/__nc_bq.js');
  fs.writeFileSync(tmp, broken, 'utf8');
  try {
    const m = await import('../config/__nc_bq.js?' + (++seq));
    const r = await m.backgroundQueueSelfCheck();
    assert.equal(r.ok, false, '延迟压入的失败必须被 await 到');
    assert.deepEqual(r.problems, ['注入失败']);
  } finally {
    fs.unlinkSync(tmp);
  }
});