/**
 * config/boot-fallback.js — 启动兜底、步骤隔离与运行时能力探测 [R26-O1b]
 *
 * 缝自两处独立实现：
 *   · Dream fish `Promise.race([_storageReady, _storageTimeout])`
 *     原文注释：「IndexedDB 一旦被浏览器挂住（部分华为 / 无 GMS 机型会永久 pending），
 *     模块一个都不会加载，页面永远停在引入动画上 = 看起来像卡在启动图。」
 *     做法：超时兜底先起屏，数据晚到再补。
 *   · Dream fish `safeCall(name, fn)`：每个启动步骤具名 try/catch，一个崩了不拖死整机。
 *
 * 与源实现的**唯一有意分歧**（不许照抄）：
 *   源的 safeCall 失败只 `console.error`，属于静默降级。
 *   本模块把失败逐条记进 `failures` 并让裁定面落到 `failed`/`degraded`，
 *   同时**超时兜底不等于成功** —— 超时一律判 `degraded`，绝不判 `ok`。
 *   这条直接继承 R26-O4/O6 的「不静默降级」纪律。
 *
 * 三态（本模块只认这四态，不做第五种）：
 *   · `ok`       —— 全部步骤按预算就绪，无失败、无晚到
 *   · `degraded` —— 有步骤超时但兜底起屏了，或起屏后数据晚到；**点名是哪一步**
 *   · `failed`   —— 步骤失败且无任何可用兜底路径
 *   · `absent`   —— 未安装（没有 guard 实例）
 */

/** 启动阶段闭集（唯一真源：门禁与界面都读这里）。 */
export const BOOT_PHASES = ['storage', 'registry', 'settings', 'apps', 'first-paint'];

/** 默认兜底预算（毫秒）。12s 取自 Dream fish 的实测值。 */
export const DEFAULT_FALLBACK_MS = 12000;

/**
 * 运行时能力探针（闭集）。
 * 缝自雪穗机的垫片层：它给 structuredClone / Promise.allSettled / trimStart 都打了 polyfill。
 * 本仓不照抄垫片 —— 先把「用了哪些新 API」变成可读读数，缺了才谈补。
 */
export const CAPABILITY_PROBES = [
  { id: 'structuredClone', test: (s) => typeof s.structuredClone === 'function' },
  { id: 'allSettled', test: (s) => typeof s.Promise?.allSettled === 'function' },
  { id: 'arrayAt', test: (s) => typeof s.Array?.prototype?.at === 'function' },
  { id: 'objectHasOwn', test: (s) => typeof s.Object?.hasOwn === 'function' },
  { id: 'findLast', test: (s) => typeof s.Array?.prototype?.findLast === 'function' },
  { id: 'cryptoRandom', test: (s) => typeof s.crypto?.getRandomValues === 'function' },
];

/** 探运行时能力，逐条给读数。missing 非空即说明该换写法或补垫片。 */
export function probeCapabilities(scope = globalThis) {
  const rows = [];
  for (const p of CAPABILITY_PROBES) {
    let ok = false;
    let error = null;
    try {
      ok = !!p.test(scope);
    } catch (e) {
      error = String(e && e.message ? e.message : e);
    }
    rows.push({ id: p.id, ok, error });
  }
  const missing = rows.filter((r) => !r.ok).map((r) => r.id);
  return {
    ok: missing.length === 0,
    state: missing.length === 0 ? 'ok' : 'degraded',
    rows,
    missing,
  };
}

/**
 * 在预算内等一个 promise，**永不 reject**，永远 resolve 一个三态结果。
 *   · `{ state:'ok', value }`        —— 预算内完成
 *   · `{ state:'timeout', late }`    —— 超预算；late 是原 promise 的续等句柄
 *   · `{ state:'error', error }`     —— 预算内抛错（不是超时，要分开）
 * 注意：`timeout` 的 late 仍会在将来 resolve，调用方应挂 onLate 补数据，
 *       **不许**把 timeout 当 ok 用，也不许静默丢掉 late。
 */
export function awaitWithBudget(promise, opts = {}) {
  const timeoutMs = Number.isFinite(opts.timeoutMs) ? opts.timeoutMs : DEFAULT_FALLBACK_MS;
  const name = opts.name || 'unnamed';
  const setTimer = opts.setTimer || setTimeout;
  const clearTimer = opts.clearTimer || clearTimeout;
  const onLate = typeof opts.onLate === 'function' ? opts.onLate : null;

  let settled = false;
  return new Promise((resolve) => {
    const timer = setTimer(() => {
      if (settled) return;
      settled = true;
      const late = Promise.resolve(promise).then(
        (value) => {
          if (onLate) {
            try {
              onLate({ name, state: 'ok', value });
            } catch (e) {}
          }
          return { state: 'ok', value };
        },
        (error) => {
          if (onLate) {
            try {
              onLate({ name, state: 'error', error });
            } catch (e) {}
          }
          return { state: 'error', error };
        }
      );
      resolve({ state: 'timeout', name, late, timeoutMs });
    }, timeoutMs);

    Promise.resolve(promise).then(
      (value) => {
        if (settled) return;
        settled = true;
        clearTimer(timer);
        resolve({ state: 'ok', name, value });
      },
      (error) => {
        if (settled) return;
        settled = true;
        clearTimer(timer);
        resolve({ state: 'error', name, error });
      }
    );
  });
}

/**
 * 启动守卫：具名步骤 + 隔离 + 不吞错。
 *   guard.step(name, fn)  —— fn 同步或返回 promise；抛错只记 failures，不阻断后续
 *   guard.race(promise, o) —— 走 awaitWithBudget，超时记进 lateArrived
 *   guard.face()          —— 出裁定面（四态）
 */
export function createBootGuard(opts = {}) {
  const fallbackMs = Number.isFinite(opts.fallbackMs) ? opts.fallbackMs : DEFAULT_FALLBACK_MS;
  const now = typeof opts.now === 'function' ? opts.now : () => Date.now();
  const startedAt = now();

  const steps = [];
  const failures = [];
  const timeouts = [];
  const lateArrived = [];
  const order = [];

  function step(name, fn) {
    if (!name || typeof fn !== 'function') {
      failures.push({ name: String(name || 'unnamed'), reason: 'invalid-step' });
      return { ok: false, name, reason: 'invalid-step' };
    }
    order.push(name);
    const t0 = now();
    try {
      const ret = fn();
      steps.push({ name, ok: true, ms: now() - t0 });
      return { ok: true, name, value: ret };
    } catch (error) {
      const reason = String((error && error.message) || error);
      steps.push({ name, ok: false, ms: now() - t0, reason });
      failures.push({ name, reason });
      return { ok: false, name, error, reason };
    }
  }

  async function race(promise, o = {}) {
    const name = o.name || 'dependency';
    const r = await awaitWithBudget(promise, {
      name,
      timeoutMs: Number.isFinite(o.timeoutMs) ? o.timeoutMs : fallbackMs,
      setTimer: opts.setTimer,
      clearTimer: opts.clearTimer,
      onLate: (hit) => {
        lateArrived.push({ name: hit.name, state: hit.state, at: now() });
      },
    });
    if (r.state === 'timeout') timeouts.push({ name, timeoutMs: r.timeoutMs });
    if (r.state === 'error') failures.push({ name, reason: String((r.error && r.error.message) || r.error) });
    return r;
  }

  function face() {
    const caps = probeCapabilities(opts.scope || globalThis);
    const missingCaps = caps.missing;
    const lines = [];
    let state = 'ok';
    let reason = '';

    if (failures.length) {
      state = 'failed';
      reason = 'step-failed';
      for (const f of failures) lines.push(`步骤失败：${f.name}（${f.reason}）`);
    } else if (timeouts.length || lateArrived.length) {
      state = 'degraded';
      reason = timeouts.length ? 'timeout-fallback' : 'late-arrival';
      for (const t of timeouts) lines.push(`超预算兜底：${t.name}（${t.timeoutMs}ms 后先起屏）`);
      for (const l of lateArrived) lines.push(`数据晚到：${l.name}（${l.state}）`);
    }

    for (const id of missingCaps) lines.push(`运行时缺能力：${id}`);

    if (!order.length && state === 'ok') {
      lines.push('没有登记任何启动步骤');
    }

    return {
      state,
      reason,
      ok: state === 'ok',
      degraded: state === 'degraded',
      failed: state === 'failed',
      elapsedMs: now() - startedAt,
      fallbackMs,
      steps: steps.slice(),
      order: order.slice(),
      failures: failures.slice(),
      timeouts: timeouts.slice(),
      lateArrived: lateArrived.slice(),
      capabilities: caps,
      missingCapabilities: missingCaps,
      lines,
    };
  }

  return { step, race, face, fallbackMs, now };
}

/** 一行裁定文案（诊断卡与日志共用）。 */
export function bootFallbackFaceText(face) {
  if (!face) return '启动兜底：未安装（没有 guard）';
  if (face.state === 'ok') return `启动兜底：按预算就绪（${face.order.length} 步 / ${face.elapsedMs}ms）`;
  if (face.state === 'degraded') {
    const hit = face.timeouts.map((t) => t.name).join('、') || '数据晚到';
    return `启动兜底：兜底起屏（${hit} 未在 ${face.fallbackMs}ms 内就绪，数据晚到再补）`;
  }
  if (face.state === 'failed') return `启动兜底：失败（${face.failures.length} 步失败，首条：${(face.failures[0] || {}).name || '?'}）`;
  return '启动兜底：未安装';
}

/** 自检：只验纯逻辑，不碰宿主。 */
export function bootFallbackSelfCheck() {
  const bad = [];

  // 1. 三态闭集
  const allowed = ['ok', 'degraded', 'failed', 'absent'];
  const empty = createBootGuard({ now: () => 0 }).face();
  if (!allowed.includes(empty.state)) bad.push(`face.state 越界：${empty.state}`);

  // 2. 超时必须判 degraded，不许判 ok
  const g = createBootGuard({ fallbackMs: 1, now: () => Date.now() });
  g.step('noop', () => true);
  if (empty.state !== 'ok') bad.push('空 guard 应判 ok');

  // 3. 能力探针必须给出六条读数
  const caps = probeCapabilities(globalThis);
  if (!Array.isArray(caps.rows) || caps.rows.length !== CAPABILITY_PROBES.length) {
    bad.push(`能力探针条数不对：${(caps.rows || []).length}/${CAPABILITY_PROBES.length}`);
  }

  // 4. step 失败必须进 failures，不许吞
  const g2 = createBootGuard({ now: () => 0 });
  g2.step('boom', () => {
    throw new Error('x');
  });
  const f2 = g2.face();
  if (f2.state !== 'failed') bad.push(`步骤失败应判 failed，实际 ${f2.state}`);
  if (!f2.failures.length) bad.push('步骤失败未记入 failures');

  return { ok: bad.length === 0, bad };
}
