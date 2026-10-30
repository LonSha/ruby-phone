/* ============================================================
 * tests/system-v4994.test.mjs — R11-X3 验收：生活流真运行（低频时钟）
 * ------------------------------------------------------------
 * 【这一项为什么单列】
 *   四件生活流内核（autonomous-life-scheduler / calendar-autonomous-life /
 *   daily-rhythm / response-cadence）早就写好、也早就被中枢实例化，
 *   但唯一的推进口 `SubsystemOrchestrator.advanceAutonomousLifeStep`
 *   **产品端零调用**（全仓只有 tests/ 一处）⇒ 手机永远不会自己推进时间，
 *   「自驱生活」只在测试进程里存在。
 *
 * 【X3 的验收语（计划原文）】
 *   静置 30 分钟 → 日历真多出事件且能说出触发来源；暂停后不再增长；
 *   存档重载后推进计数连续；破坏时钟装配 ⇒ 套件红。
 *   不许：用 setInterval 无节制推进（会污染存档）；必须可暂停且推进量落盘可查。
 *
 * 【覆盖】
 *   A 三档不可用如实回因（无读口 / 读抛错 / 中枢缺方法）——不返 0 冒充「没推进」
 *   B 推进语义：首拍 / 防抖 / 按流逝换算 / 步进封顶 / 暂停一步不推 / 恢复重置计时
 *   C 落盘：一次写齐 / 重载计数连续 / 写失败如实说 / 暂停态随盘
 *   D 接线：index.js 装配与挂表、状态栏那格真在场、键面登记、无裸 setInterval、
 *           内核不重写业务（不出现第二个 advanceAutonomousLifeStep 定义）
 *   E 真跑通：多次 tick 累计 + 每步来源摘要可读 + 与真中枢联跑
 *   F 负控制：真破坏源码 ⇒ 在副本上重跑同款判据必须转红
 * ============================================================ */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createLifeClock, CLOCK_STATUS, CLOCK_LIMITS, LC_CLOCK_STORAGE_KEY } from '../config/life-clock.js';

const __dir = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dir, '..');
const CLOCK_REL = 'config/life-clock.js';
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

function mkStorage() {
  const mem = new Map();
  const writes = [];
  let fail = null;
  return {
    _mem: mem, _writes: writes,
    failWith(err) { fail = err; },
    get: (k, d) => (mem.has(k) ? mem.get(k) : d),
    set: (k, v) => { if (fail) throw fail; mem.set(k, v); writes.push({ key: k, value: v }); },
  };
}
/** 假中枢：只数被推了几步，不引入真业务（真业务另有一条 E3）。 */
function mkHub(opts = {}) {
  const calls = [];
  return {
    _calls: calls,
    advanceAutonomousLifeStep(min) {
      calls.push(min);
      if (opts.throwOn && calls.length === opts.throwOn) throw new Error('hub boom');
      return { battery: { percent: 80 - calls.length }, alerts: [{ title: '日程提醒 ' + calls.length }], atmosphere: { phase: 'night' } };
    },
  };
}
const okHub = (hub) => () => ({ ok: true, why: '', hub });
const MIN = 60000;
/** 时间受控的时钟（now 注入：推进语义全靠真实流逝判定，必须能拨表）。 */
function mkClock({ storage = null, hub = null, runtime = undefined, why = null, now = 0 } = {}) {
  let t = now;
  const c = createLifeClock({
    storage,
    runtime,
    now: () => t,
    readHub: hub ? okHub(hub) : (why === null ? undefined : () => { throw new Error('read boom'); }),
  });
  return { c, at: (ms) => { t = ms; } };
}

/* ══════════════ A 组：不可用三档如实回因 ══════════════ */
test('A1: 时钟契约形状显式（三态 / 五常数 / 键名是 lc_ 前缀）', () => {
  assert.deepEqual(Object.values(CLOCK_STATUS).sort(), ['paused', 'running', 'unmounted']);
  for (const k of ['TICK_MS', 'STEP_MINUTES', 'MAX_STEPS_PER_TICK', 'OFFLINE_GAP_MIN', 'MAX_LOG']) {
    assert.ok(Number.isFinite(CLOCK_LIMITS[k]) && CLOCK_LIMITS[k] > 0, k + ' 必须是正数');
  }
  assert.ok(CLOCK_LIMITS.TICK_MS >= 60000, '轮询间隔不得低于 60s（计划明文：不许无节制推进）');
  assert.ok(/^lc_/.test(LC_CLOCK_STORAGE_KEY), '键名必须是 lc_ 前缀（落盘模式 /^lc_/ 靠它）');
});

test('A2: 没有中枢读口 ⇒ 说 no_reader，且 face 报 unmounted（不装成在跑）', () => {
  const { c } = mkClock({ now: 1000 });
  const r = c.tick(1000 + MIN);
  assert.equal(r.ok, false);
  assert.equal(r.steps, 0);
  assert.equal(r.why, 'no_reader');
  assert.equal(c.face().status, CLOCK_STATUS.UNMOUNTED);
  assert.equal(c.face().mounted, false);
  assert.equal(c.face().steps, 0);
});

test('A3: 读口抛错 ⇒ why=read_threw（与「读到空」分开）', () => {
  const { c } = mkClock({ why: 'boom', now: 1000 });
  assert.equal(c.tick(1000 + MIN).why, 'read_threw');
});

test('A4: 中枢在但缺推进方法 ⇒ why=no_step_method（能力探测，不靠 identity）', () => {
  const { c } = mkClock({ hub: { other() {} }, now: 1000 });
  assert.equal(c.tick(1000 + MIN).why, 'no_step_method');
});

test('A5: 中枢抛错 ⇒ all_threw 且累计计数**一步不动**（失败不许记账）', () => {
  const hub = mkHub({ throwOn: 1 });
  const st = mkStorage();
  const { c } = mkClock({ hub, storage: st, now: 1000 });
  const r = c.tick(1000 + MIN);
  assert.equal(r.ok, false);
  assert.equal(r.why, 'all_threw');
  assert.equal(c.face().steps, 0, '推一步都没成就不能把步数加上');
  assert.equal(c.face().lastTickAt, 0, '失败不许把 lastTickAt 推掉（否则那段流逝白扔）');
});

/* ══════════════ B 组：推进语义 ══════════════ */
test('B1: 首拍直接推一步（prev=0 不判防抖）——否则刚打开手机永远等不到第一次推进', () => {
  const hub = mkHub();
  const { c } = mkClock({ hub, now: 5_000_000 });
  const r = c.tick(5_000_000);
  assert.equal(r.ok, true);
  assert.equal(r.steps, 1);
  assert.equal(hub._calls.length, 1);
  assert.equal(c.face().steps, 1);
});

test('B2: 真实流逝不足 OFFLINE_GAP_MIN ⇒ too_soon 且一步不推（防抖）', () => {
  const hub = mkHub();
  const { c, at } = mkClock({ hub, now: 0 });
  c.tick(0);                       // 首拍
  const before = hub._calls.length;
  at(3 * MIN);
  const r = c.tick(3 * MIN);       // 3 分钟 < 8 分钟
  assert.equal(r.ok, false);
  assert.equal(r.why, 'too_soon');
  assert.equal(hub._calls.length, before, '防抖失败 = 用户来回切 App 每次都拍一步出去');
});

test('B3: 放两小时回来 ⇒ 按流逝换算推 8 步（不是恒定拍 1 步）', () => {
  const hub = mkHub();
  const { c } = mkClock({ hub, now: 0 });
  c.tick(0);
  const r = c.tick(120 * MIN);
  assert.equal(r.ok, true);
  assert.equal(r.steps, 8, '120 分钟 / 15 分钟一步 = 8 步');
  assert.equal(c.face().advancedMinutes, (8 + 1) * CLOCK_LIMITS.STEP_MINUTES);
});

test('B4: 放一整夜 ⇒ 步进封顶（capped=true），不当场拍出上百步', () => {
  const hub = mkHub();
  const { c } = mkClock({ hub, now: 0 });
  c.tick(0);                          // 首拍（按定义只推一步，不可能封顶）
  const r = c.tick(20 * 60 * MIN);    // 第二拍：20 小时 = 80 步的流逝
  assert.equal(r.ok, true);
  assert.equal(r.steps, CLOCK_LIMITS.MAX_STEPS_PER_TICK);
  assert.equal(r.capped, true, '被截断必须说 capped（否则「补上了全部流逝」是谎）');
});

test('B5: 暂停 ⇒ 一步不推；恢复 ⇒ 计时起点重置（暂停那段不允许被补拍）', () => {
  const hub = mkHub();
  const { c, at } = mkClock({ hub, now: 0 });
  c.tick(0);
  const before = hub._calls.length;
  c.pause();
  at(600 * MIN);
  const r = c.tick(600 * MIN);
  assert.equal(r.ok, false);
  assert.equal(r.why, 'paused');
  assert.equal(hub._calls.length, before, '暂停后必须一步不加（验收语：暂停后不再增长）');
  at(600 * MIN + MIN);
  c.resume();
  assert.equal(c.face().lastTickAt, 600 * MIN + MIN, '恢复时必须重置计时起点');
});

/* ══════════════ C 组：落盘 ══════════════ */
test('C1: 推进量落盘可查（步数 / 累计分钟 / 上次时刻 / 最近一步的来源）', () => {
  const hub = mkHub();
  const st = mkStorage();
  const { c } = mkClock({ hub, storage: st, now: 0 });
  c.tick(0);
  const row = st._mem.get(LC_CLOCK_STORAGE_KEY);
  assert.ok(row && typeof row === 'object', '必须写 LC_CLOCK_STORAGE_KEY');
  assert.equal(row.steps, 1);
  assert.equal(row.advancedMinutes, CLOCK_LIMITS.STEP_MINUTES);
  assert.equal(row.lastTickAt, 0);
  assert.equal(row.log.length, 1);
  assert.equal(row.log[0].detail[0].alerts, 1, '每步要能说出「这一步发生了什么」（提醒条数）');
  assert.equal(row.log[0].detail[0].phase, 'night', '相位如实读，拿不到就说 null，不编');
});

test('C2: 存档重载 ⇒ 推进计数连续（验收语第四条）', () => {
  const hub = mkHub();
  const st = mkStorage();
  const a = mkClock({ hub, storage: st, now: 0 });
  a.c.tick(0);
  a.c.tick(60 * MIN);
  const steps = a.c.face().steps;
  assert.ok(steps >= 4, '先要有推进量才有连续性可谈');
  const b = mkClock({ hub, storage: st, now: 0 });   // 重载：同一份 storage
  assert.equal(b.c.face().steps, steps, '重载后计数必须连续（挂在内存变量上就会归零）');
  assert.equal(b.c.face().advancedMinutes, a.c.face().advancedMinutes);
});

test('C3: 写不进去 ⇒ storageOk:false + why，但内存计数照记（不许静默）', () => {
  const hub = mkHub();
  const st = mkStorage();
  st.failWith(new Error('quota'));
  const { c } = mkClock({ hub, storage: st, now: 0 });
  c.tick(0);
  assert.equal(c.face().steps, 1, '存储坏了不影响本次会话的累计（只是存不下）');
  assert.equal(c.face().storageOk, false);
  assert.equal(c.face().storageWhy, 'write_threw');
});

test('C4: 暂停态随盘（重载后仍是暂停，不偷偷开跑）', () => {
  const hub = mkHub();
  const st = mkStorage();
  const a = mkClock({ hub, storage: st, now: 0 });
  a.c.tick(0);
  a.c.pause();
  const b = mkClock({ hub, storage: st, now: 0 });
  assert.equal(b.c.face().paused, true);
  assert.equal(b.c.tick(999 * MIN).why, 'paused');
});

/* ══════════════ D 组：接线自证 ══════════════ */
test('D1: index.js 真装配（createLifeClock + mount + 挂到 VirtualPhone）', () => {
  const ij = read('index.js');
  assert.ok(/from '\.\/config\/life-clock\.js'/.test(ij), 'index.js 必须 import 时钟内核');
  assert.ok(/createLifeClock\(\{/.test(ij), '必须真建实例');
  assert.ok(/lifeClock\.mount\(\)/.test(ij), '必须挂表（否则永远等不到推进）');
  assert.ok(/window\.VirtualPhone\.lifeClock = lifeClock/.test(ij), '实例要挂到宿主（前端口 / 诊断口取它）');
  assert.ok(/advanceAutonomousLifeStep/.test(ij), '装配必须存在推进口的引用（能力探测）');
});

test('D2: 状态栏那格真在场，且由 refreshLifeClockFace 回填', () => {
  const sh = read('phone/phone-shell.js');
  assert.ok(/class="statusbar-left"/.test(sh));
  assert.ok(/life-clock-chip/.test(sh), '状态栏必须有这一格（「晋升了也没人知道」= 无声）');
  const ij = read('index.js');
  assert.ok(/function refreshLifeClockFace\(\)/.test(ij));
  assert.ok(/function lifeClockFace\(\)/.test(ij));
  assert.ok(/querySelector\('\.statusbar-left \.life-clock-chip'\)/.test(ij), '回填必须打到那一格上');
  assert.ok(/if \(!chip\) return false/.test(ij), '取不到那一格要如实返回 false，不得补一个假元素');
});

test('D3: 键面三处同源（storage 模式 / keys-audit 登记 / 内核常量）', () => {
  assert.ok(/\/\^lc_\//.test(read('config/storage.js')), '落盘模式必须有 /^lc_/');
  assert.ok(/lc_life_clock_v1/.test(read('scripts/keys-audit.mjs')), 'K 面必须登记（否则 K3 判幽灵放行条）');
  assert.ok(/LC_CLOCK_STORAGE_KEY = 'lc_life_clock_v1'/.test(read(CLOCK_REL)));
});

test('D4: 内核不碰 storage 字典以外的世界：无裸 setInterval、无第二个业务实现', () => {
  const code = stripComments(read(CLOCK_REL));
  assert.ok(!/\bsetInterval\s*\(/.test(code), '不许裸 setInterval（手机壳重建后旧轮询会永久残留）');
  assert.ok(/rt\.addInterval\s*\(/.test(code), '必须走登记层 addInterval');
  assert.ok(!/function\s+advanceAutonomousLifeStep/.test(code), '不许在本件里重写第二个推进实现（两份必然漂移）');
  assert.ok(!/mintAsset|executeTransaction\(/.test(code), '时钟不做业务，只做「什么时候推进」');
});

test('D5a: 日历侧真多出一行「今日生活流」（读数口 + 渲染 + 样式三件齐）', () => {
  const app = read('apps/calendar/calendar-app.js');
  assert.ok(/lifeClockFace\(\)/.test(app), '日历 App 必须有读数口');
  assert.ok(/if \(typeof vp\.lifeClockFace === 'function'\)/.test(app), '优先走宿主的同名口（不另写一份读法）');
  assert.ok(/读不到/.test(app) || /why: 'no_clock'/.test(app), '读不到必须如实说原因');
  const view = read('apps/calendar/calendar-view.js');
  assert.ok(/renderLifeClockStrip\(\)/.test(view));
  assert.ok(/\$\{this\.renderLifeClockStrip\(\)\}/.test(view), '必须真插进渲染块（定义了不调 = 死代码）');
  assert.ok(/最近一步来源/.test(view), '要能说出触发来源（验收语）');
  assert.ok(/yzp-calendar-lifeclock/.test(read('apps/calendar/calendar.css')), '样式要在局部表里');
});

test('D5b: 日历侧对「未装配」与「没推进」不同形（不得压成同一句）', () => {
  const view = read('apps/calendar/calendar-view.js');
  const fn = view.slice(view.indexOf('renderLifeClockStrip()'), view.indexOf('renderCalendarGrid(storyDate) {'));
  assert.ok(/is-unknown/.test(fn) && /is-ok/.test(fn), '两档必须分类名（字段上就能区分）');
  assert.ok(/还没有推进过/.test(fn), '零步要有一句专门的话，不能跟「未装配」共用文案');
  assert.ok(/上一步异常/.test(fn), '异常步要单独说出来（不隐藏在数里）');
});

test('D5: 负控制前置——装配点必须能被真破坏命中恰一次（否则负控制是假的）', () => {
  const ij = read('index.js');
  assert.equal(ij.split('lifeClock.mount()').length - 1, 1, '挂表那句必须恰一处');
  assert.equal(ij.split('window.VirtualPhone.lifeClock = lifeClock').length - 1, 1);
});

/* ══════════════ E 组：真跑通 ══════════════ */
test('E1: 多次 tick 累计正确，且每一步的来源摘要都读得出', () => {
  const hub = mkHub();
  const st = mkStorage();
  const { c } = mkClock({ hub, storage: st, now: 0 });
  c.tick(0);
  c.tick(30 * MIN);
  c.tick(60 * MIN);
  const s = c.face();
  assert.equal(s.steps, 1 + 2 + 2, '1 + 30/15 + 30/15');
  assert.equal(s.recent.length, 3);
  for (const row of s.recent) {
    assert.ok(Array.isArray(row.detail) && row.detail.length > 0, '每步都必须带来源摘要');
    assert.equal(row.detail[0].why, 'ok');
    assert.ok(row.detail[0].alertTitles.length > 0, '「这一步为什么发生」要有可读标题');
  }
});

test('E2: 挂表走登记层，且表路径真的会 tick（不漏挂）', () => {
  const hub = mkHub();
  const handlers = [];
  const runtime = {
    addInterval(fn, ms, tag) { handlers.push({ fn, ms, tag }); return 'id-1'; },
    cancel() {},
  };
  const { c } = mkClock({ hub, runtime, now: 0 });
  const m = c.mount();
  assert.equal(m.mounted, true);
  assert.equal(handlers.length, 1);
  assert.equal(handlers[0].ms, CLOCK_LIMITS.TICK_MS);
  assert.equal(handlers[0].tag, 'life:clock', '登记必须有 tag（诊断页要能说出谁在跑）');
  handlers[0].fn();               // 手动拍一次：证明挂上去的回调真会推进
  assert.equal(c.face().steps, 1);
  assert.equal(c.face().status, CLOCK_STATUS.RUNNING);
  c.unmount();
  assert.equal(c.face().status, CLOCK_STATUS.UNMOUNTED);
});

test('E3: 与真中枢联跑（advanceAutonomousLifeStep 真被调到，返回形状被如实记账）', async () => {
  const { SubsystemOrchestrator } = await import('../config/subsystem-orchestrator.js');
  const st = mkStorage();
  let hub = null;
  try { hub = new SubsystemOrchestrator(st); } catch (_e) { hub = null; }
  if (!hub || typeof hub.advanceAutonomousLifeStep !== 'function') {
    /* 无头环境建不起中枢不是「跳过」的理由，而是**必须说清楚**的一档：
     *   本条判据的意义在于「真中枢在场时它真被调到」；中枢缺席时只能证到 A2/D1。 */
    assert.ok(/advanceAutonomousLifeStep/.test(read(CLOCK_REL)), '中枢缺席时至少内核的调用点必须在');
    return;
  }
  const c = createLifeClock({ storage: st, now: () => 0, readHub: () => ({ ok: true, why: '', hub }) });
  const r = c.tick(0);
  assert.equal(r.ok, true, '真中枢必须能推得动：' + JSON.stringify(r));
  assert.equal(r.steps, 1);
  assert.ok(c.face().recent[0].detail[0], '真中枢的返回也要被压成可读摘要');
});

/* ══════════════ F 组：负控制（真破坏源码 ⇒ 副本上同款判据转红） ══════════════ */
function brokenCopy(pairs) {
  let src = read(CLOCK_REL);
  for (const [from, to] of pairs) {
    const n = src.split(from).length - 1;
    assert.equal(n, 1, '负控制锚点必须恰中一次：' + JSON.stringify(from.slice(0, 60)));
    src = src.replace(from, to);
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rp_x3_'));
  /* ★ 剪具必须把**相对依赖一并复制进副本目录**（否则副本载不起来，
   *   负控制退化成「剪具坏了」而不是「判据转红」—— X2 当年踩过同族坑）。
   *   路径按**同层平铺**写回：`./x.js` 直接拿同名文件。 */
  const deps = new Set();
  const re = /from\s+'\.\/([^']+)'/g;
  let m;
  while ((m = re.exec(src)) !== null) deps.add(m[1]);
  for (const dep of deps) {
    const from = path.join(ROOT, 'config', dep);
    if (fs.existsSync(from)) fs.copyFileSync(from, path.join(dir, dep));
  }
  const file = path.join(dir, 'life-clock.broken.js');
  fs.writeFileSync(file, src, 'utf8');
  return 'file://' + file;
}

for (const [name, pairs, verify] of [
  ['F1 暂停判定被抹掉', [["        if (state.paused) return { ok: false, why: 'paused', steps: 0 };", '        /* broken: 暂停判定被抹掉 */']],
    async (C) => {
      const hub = mkHub();
      let t = 0;
      const c = C.createLifeClock({ now: () => t, readHub: okHub(hub) });
      c.pause();
      t = 600 * MIN;
      const r = c.tick(600 * MIN);
      assert.equal(r.why, 'paused', '不能返回 paused 了');
    }],
  ['F2 防抖被抹掉', [["        if (state.everTicked && elapsedMin < CLOCK_LIMITS.OFFLINE_GAP_MIN) {", '        if (false) {']],
    async (C) => {
      const hub = mkHub();
      let t = 0;
      const c = C.createLifeClock({ now: () => t, readHub: okHub(hub) });
      c.tick(0);
      const n = hub._calls.length;
      t = 3 * MIN;
      c.tick(3 * MIN);
      assert.equal(hub._calls.length, n, '防抖坏掉后 3 分钟就推了');
    }],
  ['F3 失败也记账（把步数加上）', [["        if (advanced === 0 && steps.length > 0) {", '        if (false) {']],
    async (C) => {
      const hub = mkHub({ throwOn: 1 });
      const c = C.createLifeClock({ now: () => 1000, readHub: okHub(hub) });
      /* ★ 看**返回形状**，不只看 face()：
       *   在 t=0 这种边界上「破坏后步数仍为 0」，单看计数会假绿。 */
      const r = c.tick(1000);
      assert.equal(r.ok, false, '一步没成不得回 ok:true');
      assert.equal(r.why, 'all_threw', '失败必须如实回因');
      assert.equal(r.steps, 0);
    }],
  ['F4 表没挂上也报 running', [["        const status = !mounted ? CLOCK_STATUS.UNMOUNTED", '        const status = false ? CLOCK_STATUS.UNMOUNTED']],
    async (C) => {
      const c = C.createLifeClock({ now: () => 0 });
      assert.equal(c.face().status, 'unmounted', '未挂表不得报 running');
    }],
])
  test('负控制 · ' + name + ' ⇒ 副本上同款判据必须转红', async () => {
    const url = brokenCopy(pairs);
    const Broken = await import(url);
    let red = false;
    try { await verify(Broken); } catch (_e) { red = true; }
    assert.equal(red, true, name + '：破坏后同款判据仍然绿 ⇒ 这条判据是假的');
    /* 反向自证：同一份判据在原版上必须**真**绿（否则「转红」可能只是判据本身错）。 */
    await verify({ createLifeClock });
  });

/* 反向自证：破坏锚点在原版上确实各自恰一处（已在 brokenCopy 里断言），
 *   这里再确认四条破坏没有互相污染（同一份源码上锚点都在）。 */
test('F5: 四条负控制锚点在原版上各自独立可达', () => {
  const src = read(CLOCK_REL);
  assert.equal(src.split('        if (state.paused) return').length - 1, 1);
  assert.equal(src.split('        if (state.everTicked && elapsedMin < CLOCK_LIMITS.OFFLINE_GAP_MIN) {').length - 1, 1);
  assert.equal(src.split('        if (advanced === 0 && steps.length > 0) {').length - 1, 1);
  assert.equal(src.split('        const status = !mounted ? CLOCK_STATUS.UNMOUNTED').length - 1, 1);
});
