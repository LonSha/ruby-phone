/**
 * config/dependency-slimming.js — 只被测试引用的模块清单与逐条处置 [R26-O2]
 *
 * 立项时的空缺（原文）：R25-O1 拆完单体后依赖关系才第一次看得清；现在无人知道
 * 哪些模块只被测试引用。验收口径：输出「只被测试引用」清单并逐条处置；处置后全门绿。
 *
 * 三条口径，缺一条这份清单就会变成假清单：
 *  ① **清单来自真实引用计数**，不手抄。分类交 `capability-manifest` 的 buildManifest，
 *     这里只做「处置」与「未处置」的记账。
 *  ② **处置只有三种**：接线（wired）/ 登记豁免（exempt，写明为什么留着）/ 删掉（remove）。
 *     没有第四种「先放着」—— 放着就是 undisposed，必须数出来。
 *  ③ **ok 只在「零未处置」时为真**。真仓现状可能大量未处置，那就如实说「未处置 N 条」，
 *     不许把 readonly 读数写成绿。
 */

export const SLIM_DISPOSITIONS = Object.freeze(['wired', 'exempt', 'remove']);

/** 需要处置的状态：只被测试引用 / 仅自身引用 / 无任何引用。wired 不在此列。 */
export const SLIM_TARGET_STATES = Object.freeze(['test-only', 'self-only', 'dormant']);

/**
 * 生成处置计划。
 * @param {{entries: Array<{id:string,kind:string,state:string,reason?:string}>}} manifest
 * @param {Record<string, {disposition: string, note?: string}>} dispositions
 * @returns {{items: Array<object>, disposed: number, undisposed: string[], ok: boolean, counts: Record<string, number>}}
 */
export function buildSlimPlan(manifest, dispositions = {}) {
  if (!manifest || !Array.isArray(manifest.entries)) throw new TypeError('buildSlimPlan 需要能力清单');
  const table = dispositions && typeof dispositions === 'object' ? dispositions : {};
  for (const id of Object.keys(table)) {
    const d = table[id] && table[id].disposition;
    if (!SLIM_DISPOSITIONS.includes(d)) throw new TypeError(`未知处置方式：${id} → ${d}`);
  }
  const items = manifest.entries
    .filter((e) => SLIM_TARGET_STATES.includes(e.state))
    .map((e) => {
      const row = table[e.id];
      return {
        id: e.id,
        kind: e.kind,
        state: e.state,
        reason: e.reason || null,
        disposition: row ? row.disposition : null,
        note: row && row.note ? String(row.note) : null,
      };
    });
  const undisposed = items.filter((i) => i.disposition === null).map((i) => i.id);
  const counts = { total: items.length, wired: 0, exempt: 0, remove: 0 };
  for (const i of items) if (i.disposition) counts[i.disposition] += 1;
  return { items, disposed: items.length - undisposed.length, undisposed, ok: undisposed.length === 0, counts };
}

/** 文案：未处置项要按名字点出来（「N 条未处置」而说不出是谁，等于没处置）。 */
export function slimPlanText(plan) {
  if (!plan || !Array.isArray(plan.items)) return '瘦身清单：无读数（未生成）';
  const c = plan.counts || {};
  const head = `瘦身清单：待处置 ${c.total} 条 · 已处置 ${plan.disposed}（接线 ${c.wired || 0} / 豁免 ${c.exempt || 0} / 删除 ${c.remove || 0}）`;
  if (plan.ok === true) return head + '\n没有未处置项。';
  return head + `\n未处置 ${plan.undisposed.length} 条：` + plan.undisposed.slice(0, 5).join('、');
}

export function dependencySlimmingSelfCheck() {
  const manifest = {
    entries: [
      { id: 'boot-budget', kind: 'config', state: 'wired' },
      { id: 'fake-progress', kind: 'config', state: 'test-only', reason: '仅测试引用' },
      { id: 'ghost', kind: 'config', state: 'dormant', reason: '无任何引用' },
    ],
  };
  const plan = buildSlimPlan(manifest, { 'fake-progress': { disposition: 'wired' } });
  const all = buildSlimPlan(manifest, {
    'fake-progress': { disposition: 'exempt', note: '守着回归判据，暂不接线' },
    ghost: { disposition: 'remove' },
  });
  const text = slimPlanText(plan);
  const ok =
    plan.items.length === 2 &&
    plan.undisposed.join(',') === 'ghost' &&
    plan.ok === false &&
    plan.counts.wired === 1 &&
    all.ok === true &&
    all.disposed === 2 &&
    text.includes('未处置 1 条') &&
    slimPlanText(null).includes('无读数');
  return { ok, bad: { plan, all }, sample: text };
}