/**
 * config/memory-reclaim.js — 内存/占用压力阈值与回收回执 [R26-O3]
 *
 * 立项时的空缺（原文）：与 R24-X8 的生命周期四态联动，但**阈值与回收顺序未定**；
 * 验收口径是「阈值可配；触发回收有回执；草稿永不自动回收（可复跑）」。
 *
 * 五条纪律：
 *   ① 阈值可配、且配错就抛：给负数 / NaN / soft > hard 一律抛 TypeError，
 *      不许「悄悄用默认值」—— 那会让设置页的开关变成摆设。
 *   ② 草稿永不自动回收：`kind === 'draft'` 无条件保留，并且**在 plan 里点名原因**；
 *      用户没发出去的话不能因为内存紧张被丢掉。
 *   ③ 回收顺序确定性：按字节降序、同字节按 id 升序 —— 同一份输入跑两次必须逐字相同
 *      （可复跑，才能当判据）。
 *   ④ 回收有回执且失败不冒充：`reclaim()` 抛错的那条记进 `failed`，**不计入 freedBytes**。
 *   ⑤ 未到阈值不动机器：`level === 'ok'` 时 plan 必为空 —— 空闲时也乱删就是缺陷。
 *
 * 纯逻辑件：不读存储、不看设备，输入全由调用方给。
 */

/** 默认阈值（字节）。soft = 该清了，hard = 必须清。 */
export const DEFAULT_THRESHOLDS = Object.freeze({ softBytes: 48 * 1024 * 1024, hardBytes: 96 * 1024 * 1024 });

/** 回收等级闭集。 */
export const RECLAIM_LEVELS = ['ok', 'soft', 'hard'];

/** 各等级允许回收的类别（闭集；draft 不在任何一档里 —— 结构上就不给回收口）。 */
const LEVEL_KINDS = Object.freeze({
  ok: [],
  soft: ['cache', 'log'],
  hard: ['cache', 'log', 'media'],
});

/** 类别闭集（未登记的类别一律不自动回收，宁可不删）。 */
export const RECLAIM_KINDS = ['cache', 'log', 'media', 'draft'];

/**
 * 校验并合并阈值。任何一项非法都抛错，不回落默认值。
 * @returns {{softBytes:number, hardBytes:number}}
 */
export function resolveThresholds(partial) {
  const out = { ...DEFAULT_THRESHOLDS, ...(partial || {}) };
  for (const key of ['softBytes', 'hardBytes']) {
    const v = out[key];
    if (!Number.isFinite(v) || v <= 0) throw new TypeError(`memory-reclaim: ${key} 必须是正有限数（收到 ${String(v)}）`);
  }
  if (out.softBytes >= out.hardBytes) {
    throw new TypeError(`memory-reclaim: softBytes(${out.softBytes}) 必须小于 hardBytes(${out.hardBytes})`);
  }
  return out;
}

/** 按占用给等级：只在两个阈值处切换，不做「差不多就清」。 */
export function assessUsage(usageBytes, thresholds) {
  const t = resolveThresholds(thresholds);
  const used = Number.isFinite(usageBytes) && usageBytes > 0 ? usageBytes : 0;
  if (used >= t.hardBytes) return { level: 'hard', usedBytes: used, thresholds: t, reason: `已用 ${used} ≥ hard ${t.hardBytes}` };
  if (used >= t.softBytes) return { level: 'soft', usedBytes: used, thresholds: t, reason: `已用 ${used} ≥ soft ${t.softBytes}` };
  return { level: 'ok', usedBytes: used, thresholds: t, reason: `已用 ${used} < soft ${t.softBytes}` };
}

/**
 * 出回收计划（不动手）。
 * @param {Array<{id:string, kind:string, bytes:number, at?:number}>} items
 * @param {number} usageBytes
 * @param {{thresholds?:object, minAgeMs?:number, now?:number}} opts
 */
export function planReclaim(items, usageBytes, opts = {}) {
  const face = assessUsage(usageBytes, opts.thresholds);
  const nowAt = Number.isFinite(opts.now) ? opts.now : Date.now();
  const minAgeMs = Number.isFinite(opts.minAgeMs) ? opts.minAgeMs : 60 * 60 * 1000;
  const allowed = LEVEL_KINDS[face.level] || [];
  const reclaimable = [];
  const kept = [];

  const rows = Array.isArray(items) ? items.slice() : [];
  /* 确定性排序：字节降序、同字节 id 升序。 */
  rows.sort((a, b) => {
    const ba = Number.isFinite(a && a.bytes) ? a.bytes : 0;
    const bb = Number.isFinite(b && b.bytes) ? b.bytes : 0;
    if (bb !== ba) return bb - ba;
    return String(a && a.id).localeCompare(String(b && b.id));
  });

  for (const it of rows) {
    const id = String((it && it.id) || '');
    const kind = String((it && it.kind) || 'unknown');
    const bytes = Number.isFinite(it && it.bytes) ? it.bytes : 0;
    if (kind === 'draft') {
      kept.push({ id, kind, bytes, why: 'draft-never-auto' });
      continue;
    }
    if (!RECLAIM_KINDS.includes(kind)) {
      kept.push({ id, kind, bytes, why: 'kind-not-registered' });
      continue;
    }
    if (!allowed.includes(kind)) {
      kept.push({ id, kind, bytes, why: face.level === 'ok' ? 'below-threshold' : 'kind-not-in-level' });
      continue;
    }
    const at = Number.isFinite(it && it.at) ? it.at : nowAt;
    if (nowAt - at < minAgeMs) {
      kept.push({ id, kind, bytes, why: 'too-new' });
      continue;
    }
    reclaimable.push({ id, kind, bytes, at });
  }

  return {
    level: face.level,
    usedBytes: face.usedBytes,
    thresholds: face.thresholds,
    reason: face.reason,
    reclaimable,
    kept,
    planBytes: reclaimable.reduce((sum, r) => sum + r.bytes, 0),
  };
}

/**
 * 执行计划，返回回执。`reclaim(item)` 逐条调用，抛错即记 failed（不计入 freedBytes）。
 * @returns {{ok:boolean, level:string, reclaimed:Array, failed:Array, freedBytes:number,
 *            kept:Array, at:number, lines:Array}}
 */
export function runReclaim(plan, reclaim, opts = {}) {
  if (!plan || !Array.isArray(plan.reclaimable)) throw new TypeError('memory-reclaim: 需要 planReclaim 的结果');
  if (typeof reclaim !== 'function') throw new TypeError('memory-reclaim: 必须注入 reclaim(item)');
  const nowAt = Number.isFinite(opts.now) ? opts.now : Date.now();
  const reclaimed = [];
  const failed = [];
  let freedBytes = 0;
  for (const item of plan.reclaimable) {
    try {
      const r = reclaim(item);
      if (r === false) throw new Error('reclaim 返回 false');
      reclaimed.push({ id: item.id, kind: item.kind, bytes: item.bytes });
      freedBytes += item.bytes;
    } catch (e) {
      failed.push({ id: item.id, kind: item.kind, bytes: item.bytes, error: String((e && e.message) || e) });
    }
  }
  const lines = [
    `回收：${plan.level}（已用 ${plan.usedBytes}）→ 清 ${reclaimed.length} 条 / ${freedBytes} 字节`,
    ...(failed.length ? [`回收失败 ${failed.length} 条（${failed.map((f) => f.id).join('、')}）`] : []),
    ...(plan.kept.some((k) => k.why === 'draft-never-auto') ? [`保留草稿 ${plan.kept.filter((k) => k.why === 'draft-never-auto').length} 条（永不自动回收）`] : []),
  ];
  return { ok: failed.length === 0, level: plan.level, reclaimed, failed, freedBytes, kept: plan.kept, at: nowAt, lines };
}

/** 一行裁定文案。 */
export function memoryFaceText(face) {
  if (!face) return '内存回收：未评估';
  if (face.level === 'ok') return `内存回收：${face.reason}（不动）`;
  return `内存回收：${face.level} 档 —— ${face.reason}；可清 ${face.planBytes} 字节`;
}

/** 自检：只验纪律。 */
export function memoryReclaimSelfCheck() {
  const bad = [];
  const t = { softBytes: 100, hardBytes: 200 };

  // 1. 阈值非法必须抛
  for (const bad3 of [{ softBytes: -1 }, { softBytes: 300, hardBytes: 200 }, { softBytes: NaN }]) {
    let threw = false;
    try {
      resolveThresholds(bad3);
    } catch (_e) {
      threw = true;
    }
    if (!threw) bad.push(`非法阈值未抛错：${JSON.stringify(bad3)}`);
  }

  // 2. 未到阈值不动手
  const calm = planReclaim([{ id: 'a', kind: 'cache', bytes: 10, at: 0 }], 50, { thresholds: t, now: 10 * 3600 * 1000 });
  if (calm.level !== 'ok' || calm.reclaimable.length) bad.push('未到阈值时不许回收任何一条');

  // 3. 草稿永不回收（哪怕 hard）
  const hot = planReclaim(
    [{ id: 'd1', kind: 'draft', bytes: 999, at: 0 }, { id: 'c1', kind: 'cache', bytes: 10, at: 0 }],
    1000, { thresholds: t, now: 10 * 3600 * 1000 }
  );
  if (!hot.kept.some((k) => k.id === 'd1' && k.why === 'draft-never-auto')) bad.push('草稿未被保留（或没点名原因）');
  if (hot.reclaimable.some((r) => r.kind === 'draft')) bad.push('草稿进了回收清单');

  // 4. 可复跑：同输入两次逐字相同
  const a = planReclaim([{ id: 'x', kind: 'cache', bytes: 5, at: 0 }, { id: 'y', kind: 'log', bytes: 5, at: 0 }], 1000, { thresholds: t, now: 10 * 3600 * 1000 });
  const b = planReclaim([{ id: 'y', kind: 'log', bytes: 5, at: 0 }, { id: 'x', kind: 'cache', bytes: 5, at: 0 }], 1000, { thresholds: t, now: 10 * 3600 * 1000 });
  if (JSON.stringify(a.reclaimable) !== JSON.stringify(b.reclaimable)) bad.push('同输入两次计划不一致（不可复跑）');

  // 5. 失败不冒充
  const rep = runReclaim(a, () => { throw new Error('io'); }, { now: 1 });
  if (rep.freedBytes !== 0) bad.push('全部失败却仍报释放字节');
  if (!rep.failed.length) bad.push('失败未进回执');

  return { ok: bad.length === 0, bad, sample: memoryFaceText(assessUsage(1000, t)) };
}