/* ========================================================
 * ledger-data.js — [v2.53.0] 世界账本 App 纯函数内核
 * 消费 snapshot.worldLedgerRead（GameClock._worldLedgerRead）
 * 结构：{ ok, reason, describe, shape, gap, opinion, counts, peopleDiff, factsDiff, at }
 * ======================================================== */

export const LEDGER_REASONS = Object.freeze({
  ready: 'ready',
  empty: 'empty',
  no_worldaxis: 'no-worldaxis',
  no_ledger_face: 'no-ledger-face',
  no_snapshot: 'no-snapshot',
  bridge_absent: 'bridge-absent',
});

const NO_WORLDAXIS_REASONS = new Set(['reader-unavailable', 'not-mounted', 'disabled', 'refused']);

export function defaultLedgerSettings() {
  return Object.freeze({
    injectToPrompt: true,
    showDiff: false,
  });
}

/**
 * 六态归因。
 * @param {object|null|undefined} probe - { hasBridge, hasSnapshot, ledger }
 * @returns {string} LEDGER_REASONS 之一
 */
export function readLedgerFace(probe) {
  if (!probe || probe.hasBridge === false) return LEDGER_REASONS.bridge_absent;
  if (!probe.hasSnapshot) return LEDGER_REASONS.no_snapshot;
  const wlr = probe.ledger;
  if (wlr === undefined || wlr === null) return LEDGER_REASONS.no_ledger_face;
  if (!wlr.ok) {
    if (NO_WORLDAXIS_REASONS.has(wlr.reason)) return LEDGER_REASONS.no_worldaxis;
    return LEDGER_REASONS.empty;
  }
  return LEDGER_REASONS.ready;
}

function num(v) { const n = Number(v); return Number.isFinite(n) ? n : 0; }

/**
 * 投影：提取展示所需字段。纯函数。
 * @param {object} wlr - snapshot.worldLedgerRead
 */
export function projectLedger(wlr) {
  const base = { ok: false, reason: '', describe: '', counts: null, gap: null, opinion: null, peopleMismatch: 0, factsDiff: null, at: 0 };
  if (!wlr || typeof wlr !== 'object') return base;
  const c = (wlr.counts && typeof wlr.counts === 'object') ? wlr.counts : null;
  const counts = c ? {
    currents: num(c.currents),
    facts: num(c.facts),
    people: num(c.people),
    opinion: num(c.opinionCanon) + num(c.opinionForum),
  } : null;
  const gap = (wlr.gap && typeof wlr.gap === 'object') ? {
    verdict: wlr.gap.verdict || '',
    notMarkedCount: num(wlr.gap.notMarkedCount),
  } : null;
  const pd = (wlr.peopleDiff && typeof wlr.peopleDiff === 'object') ? (Array.isArray(wlr.peopleDiff.mismatched) ? wlr.peopleDiff.mismatched.length : 0) : 0;
  return {
    ok: !!wlr.ok,
    reason: typeof wlr.reason === 'string' ? wlr.reason : '',
    describe: typeof wlr.describe === 'string' ? wlr.describe : '',
    counts,
    gap,
    opinion: wlr.opinion || null,
    peopleMismatch: pd,
    factsDiff: wlr.factsDiff || null,
    at: Number.isFinite(wlr.at) ? wlr.at : 0,
  };
}

/**
 * 注入块。仅 ready 态产出内容。
 * @param {object|null} wlr
 * @returns {string}
 */
export function ledgerPromptBlock(wlr) {
  if (!wlr || typeof wlr !== 'object') return '';
  if (!wlr.ok) return '';
  const proj = projectLedger(wlr);
  const parts = [];
  if (proj.describe) parts.push(proj.describe);
  if (proj.counts) {
    const c = proj.counts;
    parts.push('暗流 ' + c.currents + ' / 事实 ' + c.facts + ' / 人物 ' + c.people + ' / 舆情 ' + c.opinion);
  }
  if (proj.gap) {
    if (proj.gap.verdict === 'gapped') parts.push('【未外供缺口】' + proj.gap.notMarkedCount + ' 条暗流未放行');
    else if (proj.gap.verdict === 'no-filter') parts.push('【缺口不可知】上游无 filter 块');
  }
  if (proj.peopleMismatch > 0) parts.push('【位置冲突】' + proj.peopleMismatch + ' 条人物位置对不上');
  if (parts.length === 0) return '';
  return '【系统·世界账本】\n' + parts.join('\n');
}
