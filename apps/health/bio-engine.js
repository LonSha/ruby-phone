/**
 * 本地生理/妊娠引擎
 * 算法移植自 Liuuuu54/st_bs_biotracker
 * 只保留纯数学与本地可跑部分，不绑 OpenAI / MVU / 世界书 API
 */

import {
  getRaceProfile,
  getEmbryoTypeByRace,
  listKnownRaces,
  EMBRYO_LORE,
} from './bio-races.js';

export const MENSTRUAL_STAGES = Object.freeze(['卵泡期', '排卵期', '黄体期', '月经期']);
export const PREGNANCY_STAGES = Object.freeze(['孕早期', '孕中期', '孕晚期', '临产期', '逾期']);
export const LABOR_STAGES = Object.freeze(['第一产程', '第二产程', '第三产程']);
export const SPECIAL_STAGES = Object.freeze(['产兆前驱', '产后恢复']);

export const MENSTRUAL_STAGE_DAYS = Object.freeze({
  卵泡期: 9,
  排卵期: 2,
  黄体期: 12,
  月经期: 5,
});

export const PREGNANCY_STAGE_DAYS = Object.freeze({
  孕早期: 84,
  孕中期: 105,
  孕晚期: 63,
  临产期: 28,
});

export const LABOR_STAGE_BASE_HOURS = Object.freeze({
  第一产程: 12,
  第二产程: 2,
  第三产程: 0.5,
});

export const LABOR_STAGE_INCREMENT = Object.freeze({
  第一产程: 1.5,
  第二产程: 2,
  第三产程: 0.5,
});

export const FIRST_STAGE_NATURAL_BIRTH_EXPERIENCE = Object.freeze({
  reductionPerBirth: 0.15,
  maxCount: 3,
  minMultiplier: 0.55,
});

export const LABOR_POSTPARTUM_OBSERVATION_HOURS = 2;
export const DEFAULT_RECOVERY_DAYS = 56;
export const HUMAN_PREGNANCY_DAYS = 280;

export const FETUS_TAG_CATALOG = Object.freeze([
  { id: 'chimera', label: '嵌合体', short: '两颗以上受精卵著床前融合为一个体。' },
  { id: 'surrogacy', label: '代孕', short: '卵来自 provider，承载者只提供子宫。' },
  { id: 'selfing', label: '自交', short: '父方与遗传母方是同一个人。' },
  { id: 'identical', label: '同卵', short: '由同一颗受精卵分裂而来。' },
  { id: 'superfetation', label: '异期复孕', short: '已孕时又受精的一胎，孕龄落后。' },
  { id: 'nested', label: '孕中孕', short: '长在另一颗胎儿体内。' },
]);

const TAG_BY_ID = new Map(FETUS_TAG_CATALOG.map((t) => [t.id, t]));

export function clampNumber(value, min, max, fallback = 0) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

export function getGestationSpeciesSpeed(race) {
  const speed = Number(getRaceProfile(race)?.gestationSpeciesSpeed);
  if (Number.isFinite(speed) && speed > 0) return Math.max(0.1, Math.min(20, speed));
  return 1;
}

export function getGestationEffectiveSpeed({ race = '人类', modifier = 1, override } = {}) {
  if (Number.isFinite(Number(override)) && Number(override) >= 0) {
    return Math.max(0, Math.min(20, Number(override)));
  }
  const species = getGestationSpeciesSpeed(race);
  const mul = clampNumber(modifier, 0, 20, 1);
  return Math.max(0, Math.min(20, species * mul));
}

export function getPregnancyTotalDays(speed = 1) {
  const s = Math.max(0.1, Number(speed) || 1);
  let total = 0;
  for (const name of ['孕早期', '孕中期', '孕晚期', '临产期']) {
    total += PREGNANCY_STAGE_DAYS[name] / s;
  }
  return total;
}

export function derivePregnancyStageState(pregnantDays, gestationSpeed = 1) {
  const actual = Math.max(0, Number(pregnantDays) || 0);
  const speed = Math.max(0.1, Number(gestationSpeed) || 1);
  const stageNames = ['孕早期', '孕中期', '孕晚期', '临产期'];
  let total = 0;
  for (const name of stageNames) total += PREGNANCY_STAGE_DAYS[name] / speed;
  if (actual > total) {
    return { stage: '逾期', days: actual - total, totalDays: total, progress: 1 };
  }
  let stage = '孕早期';
  let baseDays = 0;
  let currentStageDays = 0;
  let stageLimit = PREGNANCY_STAGE_DAYS['孕早期'] / speed;
  for (const name of stageNames) {
    stageLimit = PREGNANCY_STAGE_DAYS[name] / speed;
    if (actual >= baseDays && actual <= baseDays + stageLimit) {
      stage = name;
      currentStageDays = actual - baseDays;
      break;
    }
    baseDays += stageLimit;
  }
  return {
    stage,
    days: currentStageDays,
    totalDays: total,
    progress: total > 0 ? actual / total : 0,
    stageLimit,
  };
}

export function cycleDayToMenstrualStage(cycleDay, cycleLength = 28) {
  const day = ((Math.round(Number(cycleDay) || 1) - 1) % cycleLength + cycleLength) % cycleLength + 1;
  if (day <= 5) return { stage: '月经期', days: day, cycleDay: day };
  if (day <= 12) return { stage: '卵泡期', days: day - 5, cycleDay: day };
  if (day <= 16) return { stage: '排卵期', days: day - 12, cycleDay: day };
  return { stage: '黄体期', days: day - 16, cycleDay: day };
}

export function menstrualStageToCycleDay(stage, days = 0) {
  const d = Math.max(0, Math.floor(Number(days) || 0));
  if (stage === '月经期') return Math.min(5, Math.max(1, d || 1));
  if (stage === '卵泡期') return Math.min(12, Math.max(6, 5 + d));
  if (stage === '排卵期') return Math.min(16, Math.max(13, 12 + d));
  if (stage === '黄体期') return Math.min(28, Math.max(17, 16 + d));
  return 14;
}

export function resolveLaborStageHours(stage, fetusesCount, birthDifficulty) {
  const safeCount = Math.max(1, fetusesCount || 1);
  const baseHours = LABOR_STAGE_BASE_HOURS[stage] || 0;
  const increment = LABOR_STAGE_INCREMENT[stage] || 0;
  return (baseHours + ((safeCount - 1) * increment)) * clampNumber(birthDifficulty, 0.1, 100, 1);
}

export function resolveFirstStageExperienceMultiplier(naturalBirthExperience = 0) {
  const count = Math.min(
    FIRST_STAGE_NATURAL_BIRTH_EXPERIENCE.maxCount,
    Math.floor(clampNumber(naturalBirthExperience, 0, 999, 0)),
  );
  return Math.max(
    FIRST_STAGE_NATURAL_BIRTH_EXPERIENCE.minMultiplier,
    1 - (count * FIRST_STAGE_NATURAL_BIRTH_EXPERIENCE.reductionPerBirth),
  );
}

export function getLaborPhaseForStage(stage, currentPhase) {
  if (stage === '第一产程') return ['潜伏期', '活跃期', '过渡期'].includes(currentPhase) ? currentPhase : '潜伏期';
  if (stage === '第二产程') return ['胎体下降', '胎体娩出', '间歇期'].includes(currentPhase) ? currentPhase : '胎体下降';
  if (stage === '第三产程') return ['供养器官娩出', '产后观察'].includes(currentPhase) ? currentPhase : '供养器官娩出';
  return null;
}

export function resolveLaborPhaseHours({
  stage,
  phase,
  fetusesCount = 1,
  birthDifficulty = 1,
  naturalBirthExperience = 0,
} = {}) {
  const difficulty = clampNumber(birthDifficulty, 0.1, 100, 1);
  if (stage === '第一产程') {
    const total = resolveLaborStageHours('第一产程', fetusesCount, difficulty)
      * resolveFirstStageExperienceMultiplier(naturalBirthExperience);
    if (phase === '活跃期') return total * 0.35;
    if (phase === '过渡期') return total * 0.15;
    return total * 0.5;
  }
  if (stage === '第二产程') {
    if (phase === '间歇期') return Math.max(0.5, difficulty * 0.5);
    const total = resolveLaborStageHours('第二产程', 1, difficulty);
    return total * (phase === '胎体娩出' ? 0.4 : 0.6);
  }
  if (stage === '第三产程') {
    if (phase === '产后观察') return Math.max(LABOR_POSTPARTUM_OBSERVATION_HOURS, difficulty * LABOR_POSTPARTUM_OBSERVATION_HOURS);
    return Math.max(0.5, resolveLaborStageHours('第三产程', 1, difficulty));
  }
  return 1;
}

export function getProdromalInitialHours(birthDifficulty = 1) {
  return 48 * clampNumber(birthDifficulty, 0.1, 100, 1);
}

export function estimateLaborPain(stage, phase, progress = 0, birthDifficulty = 1) {
  const ratio = clampNumber(progress, 0, 1, 0);
  const ranges = {
    产兆前驱: [0.5, 2.5],
    潜伏期: [2, 4],
    活跃期: [4, 7],
    过渡期: [7, 8.5],
    胎体下降: [6, 8],
    胎体娩出: [8, 9],
    间歇期: [3, 5],
    供养器官娩出: [3, 5.5],
    产后观察: [1, 3],
  };
  const key = stage === '产兆前驱' ? '产兆前驱' : phase;
  const range = ranges[key] || [0, 0];
  let pain = range[0] + ((range[1] - range[0]) * ratio);
  pain += clampNumber((birthDifficulty - 1) * 1.5, -1.5, 3, 0);
  return Math.round(clampNumber(pain, 0, 10, 0) * 10) / 10;
}

export function createFetus({
  id,
  race = '人类',
  gender = '未知',
  fathers = '未知',
  tags = [],
  embryoType,
} = {}) {
  const resolvedRace = String(race || '人类');
  const knownTags = (Array.isArray(tags) ? tags : [])
    .map((t) => String(t || '').trim())
    .filter((idValue) => TAG_BY_ID.has(idValue));
  return {
    id: id || ('fetus-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)),
    race: resolvedRace,
    gender: String(gender || '未知'),
    fathers: String(fathers || '未知'),
    tags: knownTags,
    embryoType: embryoType || getEmbryoTypeByRace(resolvedRace),
  };
}

export function describeFetusTags(ids) {
  const wanted = new Set((Array.isArray(ids) ? ids : []).filter((id) => TAG_BY_ID.has(id)));
  return FETUS_TAG_CATALOG.filter((tag) => wanted.has(tag.id));
}

export function pregnancyWeeks(days) {
  return Math.max(0, Math.floor(Math.max(0, Number(days) || 0) / 7));
}

export function isLaborish(stage) {
  return stage === '产兆前驱' || LABOR_STAGES.includes(stage);
}

export function isPregnancyish(stage) {
  return PREGNANCY_STAGES.includes(stage) || isLaborish(stage);
}

export { getRaceProfile, getEmbryoTypeByRace, listKnownRaces, EMBRYO_LORE };
