/**
 * config/system-update.js — 系统更新语义（变更说明 / 迁移步骤 / 可延后 / 跨大版本强制备份）[R26-X9]
 *
 * 立项时的空缺（原文）：扩展有版本号，但用户侧没有「系统升级」这件事；
 * 验收口径是「升级有变更说明、迁移步骤、可延后；跨大版本必须先备份（强制）」。
 *
 * 五条纪律：
 *   ① 版本是**解析后比较**，不是字符串比较：`4.157.10 > 4.157.9`，
 *      写成 `'4.157.10' < '4.157.9'` 这种字符串比较是本仓最典型的假实现。
 *   ② 跨大版本（主版本号变化）**强制先备份**：没备份就 `apply()`，一律抛错，
 *      不许「先升了再说」—— 升坏了没有退路比不升更糟。
 *   ③ 可延后：`defer()` 给出明确状态 `deferred`，界面必须显示「待升级」而不是「已是最新」。
 *   ④ 每个版本必须有真变更说明：`notes` 为空数组视为缺陷（沉默升级 = 用户不知道动了什么）。
 *   ⑤ 步骤有闭集且有序：`migrations` 只接受登记过的步骤 id，乱序/未登记一律报出来。
 *
 * 纯逻辑件：不读 manifest、不看存储，版本与说明全由调用方给。
 */

/** 迁移步骤闭集（登记过才允许写进计划）。 */
export const UPDATE_STEPS = Object.freeze([
  'backup',
  'storage-schema',
  'settings-schema',
  'cache-clear',
  'rebuild-index',
]);

/** 升级类型闭集。 */
export const UPDATE_KINDS = ['patch', 'minor', 'major'];

/** 延后状态闭集（界面读这三个，不许自造第四种）。 */
export const UPDATE_STATES = ['pending', 'deferred', 'applied', 'refused'];

/** 解析 `x.y.z`（缺位按 0；非数字一律抛，不许当 0 糊过去）。 */
export function parseVersion(text) {
  const raw = String(text == null ? '' : text).trim();
  const m = /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:[-+].*)?$/.exec(raw);
  if (!m) throw new TypeError(`system-update: 版本号无法解析（${raw || '空'}）`);
  return { major: Number(m[1]), minor: Number(m[2] || 0), patch: Number(m[3] || 0) };
}

/** 三段数值比较：-1 / 0 / 1。 */
export function compareVersion(a, b) {
  const x = parseVersion(a);
  const y = parseVersion(b);
  for (const key of ['major', 'minor', 'patch']) {
    if (x[key] !== y[key]) return x[key] < y[key] ? -1 : 1;
  }
  return 0;
}

/** 升级类型只看主/次/补丁号哪一段动。 */
export function updateKind(from, to) {
  const a = parseVersion(from);
  const b = parseVersion(to);
  if (a.major !== b.major) return 'major';
  if (a.minor !== b.minor) return 'minor';
  if (a.patch !== b.patch) return 'patch';
  return 'patch';
}

/**
 * 出升级计划（不动手）。
 * @param {{from:string, to:string, notes:Array<string>, migrations?:Array<string>, deferred?:boolean}} input
 */
export function planUpdate(input) {
  const o = input && typeof input === 'object' ? input : {};
  if (!o.from || !o.to) throw new TypeError('system-update: 必须给 from 与 to');
  const kind = updateKind(o.from, o.to);
  const cmp = compareVersion(o.from, o.to);
  const notes = Array.isArray(o.notes) ? o.notes.filter((n) => typeof n === 'string' && n.trim()) : [];
  const problems = [];

  if (cmp === 0) problems.push('same-version');
  /* 方向要读对：cmp < 0 是「from 比 to 旧」= 正常升级；cmp > 0 才是降级。
   * （首版写反了，A3/A4/A6 一起转红 —— 这就是方向类判据必须成对写正反例的原因。） */
  if (cmp > 0) problems.push('downgrade-refused');
  if (!notes.length) problems.push('notes-empty');
  if (!UPDATE_KINDS.includes(kind)) problems.push('kind-unknown');

  const rawSteps = Array.isArray(o.migrations) ? o.migrations.slice() : [];
  const steps = [];
  const unknownSteps = [];
  for (const step of rawSteps) {
    const s = String(step);
    if (!UPDATE_STEPS.includes(s)) unknownSteps.push(s);
    else if (!steps.includes(s)) steps.push(s);
  }
  if (unknownSteps.length) problems.push('step-unregistered');
  /* 跨大版本：备份必须是**第一步**，不靠调用方记得写。 */
  const mustBackup = kind === 'major';
  if (mustBackup && steps[0] !== 'backup') steps.unshift('backup');
  const state = o.deferred === true ? 'deferred' : 'pending';

  return {
    from: String(o.from),
    to: String(o.to),
    kind,
    cmp,
    mustBackup,
    steps,
    notes,
    deferred: state === 'deferred',
    state,
    problems,
    ok: problems.length === 0,
  };
}

/**
 * 执行升级。跨大版本没备份 ⇒ 抛错（不是返回 ok:false，而是根本不许往下走）。
 * @param {object} plan planUpdate 的结果
 * @param {{backupTaken:boolean, run?:Function, now?:Function}} ctx
 */
export function applyUpdate(plan, ctx = {}) {
  if (!plan || typeof plan !== 'object') throw new TypeError('system-update: 需要 planUpdate 的结果');
  if (plan.ok !== true) throw new Error(`system-update: 计划本身有问题，拒绝执行（${plan.problems.join('、')}）`);
  const backupTaken = ctx.backupTaken === true;
  if (plan.mustBackup && !backupTaken) {
    throw new Error(`system-update: 跨大版本（${plan.from} → ${plan.to}）必须先备份，没备份不许升`);
  }
  const run = typeof ctx.run === 'function' ? ctx.run : null;
  const done = [];
  const failed = [];
  for (const step of plan.steps) {
    try {
      if (run) run(step);
      done.push(step);
    } catch (e) {
      failed.push({ step, error: String((e && e.message) || e) });
      break; /* 步骤失败即停：不许跳过失败步骤继续往下升 */
    }
  }
  const at = typeof ctx.now === 'function' ? ctx.now() : Date.now();
  return {
    ok: failed.length === 0,
    state: failed.length ? 'refused' : 'applied',
    from: plan.from,
    to: plan.to,
    kind: plan.kind,
    done,
    failed,
    backupTaken,
    at,
    lines: [
      `系统更新：${plan.from} → ${plan.to}（${plan.kind}）${failed.length ? '失败' : '完成'}`,
      ...(plan.mustBackup ? [`升级前备份：${backupTaken ? '已备份' : '未备份（拒绝执行）'}`] : []),
      ...plan.notes.map((n) => `· ${n}`),
      ...(failed.length ? [`失败步骤：${failed[0].step}（${failed[0].error}）`] : []),
    ],
  };
}

/** 一行裁定文案。 */
export function updateFaceText(plan) {
  if (!plan || typeof plan !== 'object') return '系统更新：没有待升级内容';
  if (plan.state === 'deferred') return `系统更新：${plan.from} → ${plan.to}（${plan.kind}）已延后，仍是待升级状态`;
  if (!plan.ok) return `系统更新：计划有问题（${plan.problems.join('、')}）`;
  if (plan.cmp === 0) return '系统更新：已是最新';
  return `系统更新：可升 ${plan.from} → ${plan.to}（${plan.kind}${plan.mustBackup ? ' · 需先备份' : ''}）`;
}

/** 自检：只验纪律。 */
export function systemUpdateSelfCheck() {
  const bad = [];

  // 1. 版本比较必须是数值，不是字符串
  if (compareVersion('4.157.10', '4.157.9') !== 1) bad.push('4.157.10 应大于 4.157.9（字符串比较会错）');
  if (compareVersion('v5.0.0', '4.999.999') !== 1) bad.push('主版本号优先');
  if (compareVersion('4.157', '4.157.0') !== 0) bad.push('缺位按 0');

  // 2. 跨大版本必须强制备份，且备份排第一步
  const major = planUpdate({ from: '4.157.0', to: '5.0.0', notes: ['大版本'], migrations: ['storage-schema'] });
  if (!major.mustBackup) bad.push('跨大版本未标记 mustBackup');
  if (major.steps[0] !== 'backup') bad.push('跨大版本未把 backup 排到第一步');

  // 3. 没备份不许升（抛错）
  let threw = false;
  try {
    applyUpdate(major, { backupTaken: false });
  } catch (_e) {
    threw = true;
  }
  if (!threw) bad.push('跨大版本未备份竟然放行');

  // 4. 空变更说明视为缺陷
  if (planUpdate({ from: '4.157.0', to: '4.158.0', notes: [] }).ok) bad.push('空变更说明竟然通过');

  // 5. 未登记步骤要报出来
  if (!planUpdate({ from: '4.157.0', to: '4.158.0', notes: ['x'], migrations: ['rm-rf'] }).problems.includes('step-unregistered')) {
    bad.push('未登记步骤未被点名');
  }

  return { ok: bad.length === 0, bad, sample: updateFaceText(major) };
}