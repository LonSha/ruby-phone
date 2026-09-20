/* ========================================================
 * clock-data.js — [v2.52.0] 时计 App 纯函数内核
 * 消费 snapshot.clock（GameClock.export()）
 * ======================================================== */

export const CLOCK_REASONS = Object.freeze({
  ready: 'ready',
  empty: 'empty',
  no_clock_face: 'no-clock-face',
  no_snapshot: 'no-snapshot',
  bridge_absent: 'bridge-absent',
});

export function defaultClockSettings() {
  return Object.freeze({
    injectToPrompt: true,
    showDiagnostics: false,
  });
}

export function readClockFace(probe) {
  if (!probe || probe.hasBridge === false) return CLOCK_REASONS.bridge_absent;
  if (!probe.hasSnapshot) return CLOCK_REASONS.no_snapshot;
  const clock = probe.clock;
  if (clock === undefined || clock === null) return CLOCK_REASONS.no_clock_face;
  const hasDate = typeof clock.date === 'string' && clock.date.length > 0;
  const hasLabel = typeof clock.label === 'string' && clock.label.length > 0;
  if (!hasDate && !hasLabel) return CLOCK_REASONS.empty;
  return CLOCK_REASONS.ready;
}

export function projectClock(clock) {
  if (!clock || typeof clock !== 'object') {
    return { date: '', label: '', precision: 'unknown', turn: 0, hasFlashback: false, flashback: null, stats: null, worldClock: null, anchor: null };
  }
  const stats = clock.timeTagStats && typeof clock.timeTagStats === 'object'
    ? { total: clock.timeTagStats.total || 0, paired: clock.timeTagStats.paired || 0, unparseable: clock.timeTagStats.unparseable || 0, calibrated: clock.timeTagStats.calibrated || 0 }
    : null;
  return {
    date: typeof clock.date === 'string' ? clock.date : '',
    label: typeof clock.label === 'string' ? clock.label : '',
    precision: typeof clock.precision === 'string' ? clock.precision : 'unknown',
    turn: Number.isFinite(clock.turn) ? clock.turn : 0,
    hasFlashback: !!(clock.lastFlashback && clock.lastFlashback.date),
    flashback: clock.lastFlashback ? { date: clock.lastFlashback.date || '', label: clock.lastFlashback.label || '', floor: clock.lastFlashback.floor || 0 } : null,
    stats,
    worldClock: clock.worldClockRead || null,
    anchor: clock.lastNarrativeAnchor || null,
  };
}

export function clockPromptBlock(clock) {
  if (!clock || typeof clock !== 'object') return '';
  const proj = projectClock(clock);
  if (!proj.date && !proj.label) return '';
  const parts = [];
  if (proj.date) parts.push('【剧情时间】' + proj.date);
  if (proj.label) parts.push('【时段】' + proj.label);
  if (proj.precision === 'day') parts.push('（精确日期）');
  else if (proj.precision === 'approximate') parts.push('（约数）');
  if (proj.turn > 0) parts.push('【楼层】第 ' + proj.turn + ' 层');
  if (proj.hasFlashback && proj.flashback) {
    parts.push('【闪回】' + (proj.flashback.date || '未知时间') + (proj.flashback.label ? '·' + proj.flashback.label : ''));
  }
  if (parts.length === 0) return '';
  return '【系统·时计】\n' + parts.join('\n');
}
