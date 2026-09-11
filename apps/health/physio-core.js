/**
 * 生理五维（饥/渴/洁/尿/便）
 * 算法移植自 LA-0.6.37 physio-core，去掉世界书投影、疾病库、扫描裁判
 */

export const NEEDS = Object.freeze(['hunger', 'thirst', 'clean', 'bladder', 'bowel']);
export const NEED_LABELS = Object.freeze({
  hunger: '饥饿度',
  thirst: '口渴度',
  clean: '干净度',
  bladder: '尿意',
  bowel: '便意',
});
export const LEVEL_EDGES = Object.freeze([0, 21, 41, 61, 81, 96]);
export const LABELS = Object.freeze({
  hunger: ['饱足', '正常', '饥饿', '很饿', '饥肠辘辘', '饿到发昏'],
  thirst: ['不渴', '正常', '口渴', '很渴', '口干舌燥', '脱水·头晕'],
  clean: ['干净', '略脏', '身体肮脏', '明显异味', '污秽难闻', '污秽不堪'],
  bladder: ['无', '略有', '尿意浮现', '想上', '憋得难受', '憋不住（濒临失禁）'],
  bowel: ['无', '略有', '便意浮现', '想上', '憋得难受', '憋不住（濒临失禁）'],
});
export const HOURLY_RATES = Object.freeze({ hunger: 12, thirst: 15, clean: 3, bladder: 12, bowel: 3 });
export const INJECT_THRESHOLD = 61;
const VOID_CLEAN_DELTA = { cleaned: -10, not_cleaned: 0, accident: 30 };

export function clamp(n, min, max) {
  const v = Number(n);
  if (!Number.isFinite(v)) return min;
  return Math.min(max, Math.max(min, v));
}

export function levelIndex(value) {
  const v = clamp(value, 0, 100);
  let idx = 0;
  for (let i = 0; i < LEVEL_EDGES.length; i += 1) {
    if (v >= LEVEL_EDGES[i]) idx = i;
  }
  return Math.min(idx, 5);
}

export function levelLabel(need, value) {
  return (LABELS[need] || [])[levelIndex(value)] || '';
}

export function emptyNeeds() {
  return { hunger: 20, thirst: 15, clean: 8, bladder: 10, bowel: 8 };
}

export function normalizeNeeds(input) {
  const src = input && typeof input === 'object' ? input : {};
  const next = emptyNeeds();
  for (const need of NEEDS) {
    if (src[need] != null) next[need] = clamp(src[need], 0, 100);
  }
  return next;
}

export function advanceNeeds(actor, hours, period) {
  const next = normalizeNeeds(actor);
  const h = Number(hours) || 0;
  if (h === 0) return next;
  const bowelMul = period && (period === '月经期' || period.isMenstrual) ? 1.3 : 1;
  for (const need of NEEDS) {
    const mul = need === 'bowel' ? bowelMul : 1;
    next[need] = clamp(next[need] + HOURLY_RATES[need] * mul * h, 0, 100);
  }
  return next;
}

export function applyNeedEvent(actor, type) {
  const next = normalizeNeeds(actor);
  if (type === 'eat') next.hunger = 0;
  else if (type === 'drink') next.thirst = 0;
  else if (type === 'void') {
    next.bladder = 0;
    next.clean = clamp(next.clean + VOID_CLEAN_DELTA.cleaned, 0, 100);
  } else if (type === 'defecate') {
    next.bowel = 0;
    next.clean = clamp(next.clean + VOID_CLEAN_DELTA.cleaned, 0, 100);
  } else if (type === 'wash') next.clean = 0;
  return next;
}

export function describeNeeds(actor) {
  const src = normalizeNeeds(actor);
  return NEEDS.map((need) => ({
    id: need,
    label: NEED_LABELS[need],
    value: Math.round(src[need]),
    text: levelLabel(need, src[need]),
    inject: src[need] >= INJECT_THRESHOLD,
  }));
}

export function buildNeedsDirective(actor) {
  const rows = describeNeeds(actor).filter((row) => row.inject);
  if (!rows.length) return '';
  return rows.map((row) => '- ' + row.label + ': ' + row.text + '（' + row.value + '）').join(String.fromCharCode(10));
}
