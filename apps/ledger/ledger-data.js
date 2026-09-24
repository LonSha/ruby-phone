import { faceFieldState } from '../../config/world-bridge.js';

/* ========================================================
 * ledger-data.js — [v2.53.0] 世界账本 App 纯函数内核
 * [v2.54.0] 深化：舆情强度三分（已核实/传闻/未知）+ 事实对读差集
 * 消费 snapshot.worldLedgerRead（GameClock._worldLedgerRead）
 * 结构：{ ok, reason, describe, shape, gap, opinion, counts, peopleDiff, factsDiff, at }
 * ======================================================== */
export const LEDGER_REASONS = Object.freeze({
  ready: 'ready',
  empty: 'empty',
  no_worldaxis: 'no-worldaxis',
  no_ledger_face: 'no-ledger-face',
  upstream_empty: 'upstream-empty',
  no_snapshot: 'no-snapshot',
  bridge_absent: 'bridge-absent',
});
const NO_WORLDAXIS_REASONS = new Set(['reader-unavailable', 'not-mounted', 'disabled', 'refused']);
export function defaultLedgerSettings() {
  return Object.freeze({
    injectToPrompt: true,
    showDiff: true,
  });
}
/**
 * 六态归因。
 * @param {object|null|undefined} probe - { hasBridge, hasSnapshot, ledger }
 * @returns {string} LEDGER_REASONS 之一
 */
export function readLedgerFace(probe, snapshot) {
  if (!probe || probe.hasBridge === false) return LEDGER_REASONS.bridge_absent;
  if (!probe.hasSnapshot) return LEDGER_REASONS.no_snapshot;
  const wlr = probe.ledger;
  if (wlr === undefined || wlr === null) {
    // [v2.98.0] 同 clock：上游声明了这项、值为空 ⇒ 不是「这版没这面」。判定只此一份。
    if (snapshot && faceFieldState(snapshot, ['worldLedgerRead']) === 'declared-empty') return LEDGER_REASONS.upstream_empty;
    return LEDGER_REASONS.no_ledger_face;
  }
  if (!wlr.ok) {
    if (NO_WORLDAXIS_REASONS.has(wlr.reason)) return LEDGER_REASONS.no_worldaxis;
    return LEDGER_REASONS.empty;
  }
  return LEDGER_REASONS.ready;
}
function num(v) { const n = Number(v); return Number.isFinite(n) ? n : 0; }
function strArr(a, cap) {
  if (!Array.isArray(a)) return [];
  return a.slice(0, cap).map((x) => String(x));
}
/**
 * 投影：提取展示所需字段。纯函数。
 * @param {object} wlr - snapshot.worldLedgerRead
 */
export function projectLedger(wlr) {
  const base = {
    ok: false, reason: '', describe: '', counts: null, gap: null, opinion: null,
    opinionDetail: null, peopleMismatch: 0, factsDiff: null, factsDetail: null, at: 0
  };
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
  // [v2.54.0] 舆情强度三分：权威/论坛/沙盒在场数 + 已核实/传闻/未知 claim 强度
  const op = (wlr.opinion && typeof wlr.opinion === 'object') ? wlr.opinion : null;
  const opinionDetail = op ? {
    present: !!op.present,
    canon: num(op.canon),
    forum: num(op.forum),
    sandbox: num(op.sandbox),
    verified: num(op.verified),
    rumor: num(op.rumor),
    unknown: num(op.unknown),
  } : null;
  // [v2.54.0] 事实对读差集（推演侧已结算 vs 本插件侧大纲）
  const fd = (wlr.factsDiff && typeof wlr.factsDiff === 'object') ? wlr.factsDiff : null;
  const factsDetail = fd ? {
    hasWorld: !!fd.hasWorld,
    hasLocal: !!fd.hasLocal,
    shared: num(fd.shared),
    worldOnlyTotal: num(fd.worldOnlyTotal),
    localOnlyTotal: num(fd.localOnlyTotal),
    worldOnly: strArr(fd.worldOnly, 6),
    localOnly: strArr(fd.localOnly, 6),
  } : null;
  return {
    ok: !!wlr.ok,
    reason: typeof wlr.reason === 'string' ? wlr.reason : '',
    describe: typeof wlr.describe === 'string' ? wlr.describe : '',
    counts,
    gap,
    opinion: wlr.opinion || null,
    opinionDetail,
    peopleMismatch: pd,
    factsDiff: wlr.factsDiff || null,
    factsDetail,
    at: Number.isFinite(wlr.at) ? wlr.at : 0,
  };
}
/**
 * 注入块。仅 ready 态产出内容。
 * [v2.54.0] 增补舆情强度三分与事实对读差集（有冲突或无标记时）。
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
  if (proj.opinionDetail && proj.opinionDetail.present) {
    const o = proj.opinionDetail;
    parts.push('舆情强度：已核实 ' + o.verified + ' / 传闻 ' + o.rumor + ' / 未知 ' + o.unknown);
  }
  if (proj.gap) {
    if (proj.gap.verdict === 'gapped') parts.push('【未外供缺口】' + proj.gap.notMarkedCount + ' 条暗流未放行');
    else if (proj.gap.verdict === 'no-filter') parts.push('【缺口不可知】上游无 filter 块');
  }
  if (proj.peopleMismatch > 0) parts.push('【位置冲突】' + proj.peopleMismatch + ' 条人物位置对不上');
  if (proj.factsDetail && (proj.factsDetail.worldOnlyTotal > 0 || proj.factsDetail.localOnlyTotal > 0)) {
    const f = proj.factsDetail;
    parts.push('【事实对读】世界侧独有 ' + f.worldOnlyTotal + ' / 本机侧独有 ' + f.localOnlyTotal + ' / 共有 ' + f.shared);
  }
  if (parts.length === 0) return '';
  return '【系统·世界账本】\n' + parts.join('\n');
}
