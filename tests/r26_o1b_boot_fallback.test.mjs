/**
 * tests/r26_o1b_boot_fallback.test.mjs — R26-O1b 启动兜底与步骤隔离判据
 *
 * 验收口径（对应 config/boot-fallback.js）：
 *   ① 依赖永不 resolve 时，首屏仍必须在预算内放行，且判 `degraded` 而不是 `ok`
 *   ② 任一步骤抛错必须具名记入 failures，且不阻断后续步骤
 *   ③ 运行时能力缺失要成为可读读数，不是沉默
 *   ④ 晚到的数据要留痕（lateArrived），不能静默丢弃
 *
 * 负控制（真打坏源码再验红）：
 *   N1 拆掉超时（setTimer 永不触发）→ 依赖挂死
 *   N2 把 timeout 当 ok（删掉 degraded 分支）→ 超时被当成成功
 *   N3 吞掉步骤失败（删掉 failures.push）→ 失败不可见
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, '..', 'config', 'boot-fallback.js');
const RAW = fs.readFileSync(SRC, 'utf8');

const mod = await import(pathToFileURL(SRC).href);
let breakSeq = 0;
async function loadBroken(mutate) {
  const text = mutate(RAW);
  assert.notEqual(text, RAW, '打坏未生效：替换点没命中，负控制无效');
  const out = path.join('/tmp', `boot-fallback-broken-${process.pid}-${++breakSeq}.mjs`);
  fs.writeFileSync(out, text);
  return import(pathToFileURL(out).href);
}

const never = () => new Promise(() => {});
const withTimeout = (p, ms) =>
  Promise.race([p, new Promise((r) => setTimeout(() => r({ state: 'SUSPENDED' }), ms))]);

// ── A1 导出闭集 ──
test('A1 导出闭集齐全', () => {
  const need = [
    'BOOT_PHASES',
    'DEFAULT_FALLBACK_MS',
    'CAPABILITY_PROBES',
    'probeCapabilities',
    'awaitWithBudget',
    'createBootGuard',
    'bootFallbackFaceText',
    'bootFallbackSelfCheck',
  ];
  for (const k of need) assert.ok(k in mod, `缺少导出 ${k}`);
  assert.equal(mod.DEFAULT_FALLBACK_MS, 12000);
  assert.ok(mod.BOOT_PHASES.includes('storage'));
  assert.deepEqual(mod.bootFallbackSelfCheck(), { ok: true, bad: [] });
});

// ── A2 依赖永不 resolve：必须在预算内放行，不挂死 ──
test('A2 永不 resolve 的依赖不会拖死启动', async () => {
  const r = await withTimeout(mod.awaitWithBudget(never(), { timeoutMs: 30, name: 'storage' }), 800);
  assert.notEqual(r.state, 'SUSPENDED', '依赖挂死了：超时没生效');
  assert.equal(r.state, 'timeout');
  assert.equal(r.name, 'storage');
  assert.ok(r.late && typeof r.late.then === 'function', 'timeout 时必须给出晚到句柄');
});

// ── A3 超时必须判 degraded，且点名是哪一步 ──
test('A3 超时兜底判 degraded 而不是 ok', async () => {
  const g = mod.createBootGuard({ fallbackMs: 30 });
  g.step('registry', () => true);
  const r = await g.race(never(), { name: 'storage' });
  assert.equal(r.state, 'timeout');
  const face = g.face();
  assert.equal(face.state, 'degraded');
  assert.equal(face.ok, false, '超时不得判 ok');
  assert.equal(face.reason, 'timeout-fallback');
  assert.ok(
    face.timeouts.some((t) => t.name === 'storage'),
    'degraded 必须点名超时的步骤'
  );
  assert.ok(face.lines.some((l) => l.includes('storage')), '裁定面要点名具体步骤');
});

// ── A4 步骤抛错：具名记账 + 后续步骤仍执行 ──
test('A4 步骤失败具名记账且不阻断后续', () => {
  const g = mod.createBootGuard({ fallbackMs: 30 });
  const r1 = g.step('boom', () => {
    throw new Error('kaput');
  });
  const r2 = g.step('after', () => 'still-ran');
  assert.equal(r1.ok, false);
  assert.equal(r2.ok, true);
  assert.equal(r2.value, 'still-ran', '前一步失败不得阻断后续');
  const face = g.face();
  assert.equal(face.state, 'failed');
  assert.deepEqual(face.order, ['boom', 'after']);
  assert.equal(face.failures.length, 1);
  assert.equal(face.failures[0].name, 'boom');
  assert.match(face.failures[0].reason, /kaput/);
});

// ── A5 晚到数据必须留痕 ──
test('A5 晚到的数据留痕，不静默丢弃', async () => {
  let release;
  const slow = new Promise((r) => {
    release = r;
  });
  const g = mod.createBootGuard({ fallbackMs: 20 });
  const r = await g.race(slow, { name: 'settings' });
  assert.equal(r.state, 'timeout');
  assert.equal(g.face().lateArrived.length, 0);
  release({ hello: 1 });
  const late = await r.late;
  assert.equal(late.state, 'ok');
  const face = g.face();
  assert.equal(face.lateArrived.length, 1);
  assert.equal(face.lateArrived[0].name, 'settings');
  assert.equal(face.state, 'degraded');
});

// ── A6 能力探针：缺失要成读数 ──
test('A6 运行时能力缺失是可读读数', () => {
  const bare = mod.probeCapabilities({});
  assert.equal(bare.state, 'degraded');
  assert.equal(bare.missing.length, mod.CAPABILITY_PROBES.length);
  assert.ok(bare.rows.length === mod.CAPABILITY_PROBES.length);
  assert.ok(bare.rows.every((r) => r.ok === false && r.error === null));
  const full = mod.probeCapabilities(globalThis);
  assert.equal(full.state, 'ok');
  assert.deepEqual(full.missing, []);
});

// ── A7 文案四态 ──
test('A7 裁定文案覆盖四态', () => {
  assert.match(mod.bootFallbackFaceText(null), /未安装/);
  const okG = mod.createBootGuard({ fallbackMs: 20 });
  okG.step('a', () => 1);
  assert.match(mod.bootFallbackFaceText(okG.face()), /就绪/);
  const failG = mod.createBootGuard({ fallbackMs: 20 });
  failG.step('bad', () => {
    throw new Error('x');
  });
  assert.match(mod.bootFallbackFaceText(failG.face()), /失败/);
  const degG = mod.createBootGuard({ fallbackMs: 10 });
  return degG.race(never(), { name: 'storage' }).then(() => {
    const t = mod.bootFallbackFaceText(degG.face());
    assert.match(t, /兜底起屏/);
    assert.match(t, /storage/);
  });
});

// ── N1 拆掉超时 → 依赖挂死必须暴露 ──
test('N1 负控制：拆掉超时则依赖挂死', async () => {
  const broken = await loadBroken((s) => s.replace('const setTimer = opts.setTimer || setTimeout;', 'const setTimer = () => 0;'));
  const r = await withTimeout(broken.awaitWithBudget(never(), { timeoutMs: 30 }), 400);
  assert.equal(r.state, 'SUSPENDED', '拆掉超时后居然还能返回，负控制无效');
});

// ── N2 把 timeout 当 ok → degraded 消失必须暴露 ──
test('N2 负控制：超时当成成功则 degraded 消失', async () => {
  const broken = await loadBroken((s) => s.replace('} else if (timeouts.length || lateArrived.length) {', '} else if (false) {'));
  const g = broken.createBootGuard({ fallbackMs: 20 });
  await g.race(never(), { name: 'storage' });
  const face = g.face();
  assert.equal(face.state, 'ok', '打坏后应当静默判 ok，否则负控制无效');
  assert.equal(face.ok, true);
});

// ── N3 吞掉步骤失败 → 失败不可见必须暴露 ──
test('N3 负控制：吞掉失败则 failed 退化成 ok', () => {
  return loadBroken((s) => s.replace('      failures.push({ name, reason });', '      void 0;')).then((broken) => {
    const g = broken.createBootGuard({ fallbackMs: 20 });
    g.step('boom', () => {
      throw new Error('kaput');
    });
    const face = g.face();
    assert.equal(face.failures.length, 0, '打坏后 failures 应为空，否则负控制无效');
    assert.equal(face.state, 'ok', '吞错后应当看不见失败');
  });
});
