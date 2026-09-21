/**
 * bio-propagation.js — 异种繁殖推演（Breeding Simulator）
 * 算法移植自 Liuuuu54/st_bs_biotracker v0.9.9（scripts/calculator.js + race_config.js 全纯算法部分）
 * 只保留纯数学与本地可跑部分，不绑 OpenAI / MVU / 世界书 API —— 与 bio-engine.js 同规格。
 *
 * 【三组只读推演（不抽随机数、不写状态，纯供界面展示与「看一眼」）】
 *   1. 自然受精预测   calculateFertilizationPreview —— 多精源归属概率 / 受孕率 / 有效精液暴露
 *   2. 后代预测       calculateOffspringPreview  —— 胎儿种族 / 胚型 / 孕期 / 卵群规模 / 胎重
 *   3. 衍生遗传预测   calculateDerivedInheritancePreview —— 12 类衍生类型遗传进度 / 到判定线天数
 * 依赖：bio-races.js 的五组族表 + RACE_PHYSIOLOGY（本模块自足实现远程 helper，不绑远程默认值）。
 */
import {
  VIVIPAROUS_RACES, OVIPAROUS_RACES, OVOVIVIPAROUS_RACES,
  METOVIVIPAROUS_RACES, AMORPHOUS_RACES, RACE_PHYSIOLOGY,
} from './bio-races.js';
import { MENSTRUAL_STAGES, MENSTRUAL_STAGE_DAYS } from './bio-engine.js';

export const SPERM_DECAY_PER_DAY = 10;
export const CROSS_RACE_DIFFICULTY_MULTIPLIER = 1.5;
export const EMBRYO_TYPE_MISMATCH_MULTIPLIER = 1.25;
export const DERIVED_INHERITANCE_THRESHOLD = 75;
export const DERIVED_INHERITANCE_BASELINE_DAYS = 140;

export const DERIVED_TYPE_RACES = Object.freeze([
  '修炼', '魔导', '妖怪', '神祇', '不死', '血族', '星际', '机械', '器灵', '变异', '序列', '兽化',
]);
export const DERIVED_TYPE_INHERITANCE_PROFILES = Object.freeze({
  修炼: Object.freeze({ inheritanceSpeed: 0.8 }),
  魔导: Object.freeze({ inheritanceSpeed: 1.0 }),
  妖怪: Object.freeze({ inheritanceSpeed: 1.25 }),
  神祇: Object.freeze({ inheritanceSpeed: 0.25 }),
  不死: Object.freeze({ inheritanceSpeed: 2.5 }),
  血族: Object.freeze({ inheritanceSpeed: 1.9 }),
  星际: Object.freeze({ inheritanceSpeed: 1.7 }),
  机械: Object.freeze({ inheritanceSpeed: 0.5 }),
  器灵: Object.freeze({ inheritanceSpeed: 0.65 }),
  变异: Object.freeze({ inheritanceSpeed: 1.55 }),
  序列: Object.freeze({ inheritanceSpeed: 1.1 }),
  兽化: Object.freeze({ inheritanceSpeed: 1.4 }),
});
export const DERIVED_TYPE_FLUX_PROFILES = Object.freeze({
  修炼: Object.freeze({ fluxName: '炁', fluxDefinition: '个体吸收天地灵气转化为自身的超凡生命能量。' }),
  魔导: Object.freeze({ fluxName: '魔力', fluxDefinition: '体内蓄积并循环的魔力总量与操控余裕，是施术与维持术式的基础。' }),
  妖怪: Object.freeze({ fluxName: '妖力', fluxDefinition: '由执念生智并汲取世人畏惧与认知而存在的异类法则。' }),
  神祇: Object.freeze({ fluxName: '信仰', fluxDefinition: '源自凡人祈求、敬畏与香火供奉的概念集合体。' }),
  不死: Object.freeze({ fluxName: '死气', fluxDefinition: '维持亡者驱壳活动的负面能量，与生前记忆形成互斥。' }),
  血族: Object.freeze({ fluxName: '血欲', fluxDefinition: '驱动吸血种族生理机能的血液渴求度，与理智防线呈反比。' }),
  星际: Object.freeze({ fluxName: '连结力', fluxDefinition: '维持星际物种与母体网路或同族间的心灵共鸣度。' }),
  机械: Object.freeze({ fluxName: '负载', fluxDefinition: '驱动机械体运作的核心能源输出与算力占用率。' }),
  器灵: Object.freeze({ fluxName: '共鸣', fluxDefinition: '器物生智后与持有者之间的灵魂/意识同步率。' }),
  变异: Object.freeze({ fluxName: '异能', fluxDefinition: '基因突变所产生的超自然能力输出频率。' }),
  序列: Object.freeze({ fluxName: '序列活性', fluxDefinition: '原有性别与种族之外的第二生理或精神序列活跃度。' }),
  兽化: Object.freeze({ fluxName: '兽性', fluxDefinition: '动物性身体特征、感官与本能的显化程度。' }),
});
export const DERIVED_TYPE_METABOLISM_EXEMPTIONS = Object.freeze({
  血族: Object.freeze(['hunger', 'excretion', 'odor']),
  不死: Object.freeze(['odor', 'sleep', 'milk']),
  修炼: Object.freeze(['hunger', 'excretion', 'companionship']),
  魔导: Object.freeze(['sleep', 'companionship', 'odor']),
  妖怪: Object.freeze(['hunger', 'excretion', 'sleep']),
  神祇: Object.freeze(['hunger', 'sleep', 'companionship']),
  机械: Object.freeze(['hunger', 'milk', 'companionship']),
  器灵: Object.freeze(['hunger', 'milk', 'sleep']),
  星际: Object.freeze(['sleep', 'milk', 'companionship']),
  变异: Object.freeze(['sleep', 'hunger', 'odor']),
  序列: Object.freeze(['sleep', 'odor', 'companionship']),
  兽化: Object.freeze(['milk', 'odor', 'companionship']),
});

/* ================= 基础工具（自足实现） ================= */
function clampNumber(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback === undefined ? min : fallback;
  return Math.min(max, Math.max(min, n));
}
export function parseRaceDescriptor(rawRace) {
  const value = String(rawRace || '').trim();
  if (!value) return { race: '', derivedType: null };
  const derivedMatch = value.match(/^\[([^\]]+)\](.+)$/);
  if (!derivedMatch) return { race: value, derivedType: null };
  return { race: String(derivedMatch[2] || '').trim(), derivedType: String(derivedMatch[1] || '').trim() || null };
}
function canonicalizeRaceComponent(c) { return String(c || '').trim(); }
export function getRaceDescriptorComponents(race) {
  const value = parseRaceDescriptor(race).race;
  if (!value) return [];
  return value.split(/[xX]/).map(canonicalizeRaceComponent).filter(Boolean);
}
function getBaseRaceComponentName(component) {
  const value = canonicalizeRaceComponent(component);
  if (!value) return '';
  const separatorIndex = value.indexOf('-');
  return separatorIndex >= 0 ? value.slice(0, separatorIndex).trim() : value;
}
export function getRaceComponents(race) {
  const seen = new Set();
  return getRaceDescriptorComponents(race)
    .map((c) => getBaseRaceComponentName(c))
    .filter((name) => {
      if (!name || seen.has(name)) return false;
      seen.add(name);
      return true;
    });
}
function getRacePhysiologyProfile(race) {
  return RACE_PHYSIOLOGY && typeof RACE_PHYSIOLOGY === 'object' ? RACE_PHYSIOLOGY[race] : undefined;
}
// —— 卵群规模（clutchSizeMean）——
// 由远程 v0.9.9 race_config.RACE_CLUTCH_SIZE_MEANS 移植，仅保留本地 RACE_PHYSIOLOGY 存在的种族。
// 未列出的种族（默认单卵群）不在此表出现；getClutchSizeMeanByRace 查不到时回落 RACE_PHYSIOLOGY 内置字段。
export const RACE_CLUTCH_SIZE_MEANS = Object.freeze({
  "植物亚人": 12,
  "真菌亚人": 20,
  "社会虫族": 50,
  "独居虫族": 20,
  "蜥蜴人": 12,
  "海蛞蝓族": 30,
  "龟族": 20,
  "甲壳族": 50,
  "宝箱怪": 8,
  "阿拉克涅": 30,
  "百足姬": 25,
  "触手怪": 10,
  "狗头人": 2,
  "海妖": 16,
  "蛙人": 100,
  "水母族": 50,
  "蛇人": 1,
  "人鱼": 1,
  "深潜者": 1,
  "史萊姆": 4,
  "活体铠甲": 6,
});

const RACE_PHYSIOLOGY_FIELDS = [
  'menstrualLengthRatio', 'gestationSpeciesSpeed', 'birthDifficulty', 'breedTolerance',
  'impregnationDifficulty', 'orgasmOvulationAmount', 'identicalProbability',
];
function mergeGenderRatioValues(values) {
  if (values.some((v) => v === null)) return null;
  const normal = values.filter((v) => Number.isFinite(v) && v >= 0 && v <= 100);
  if (normal.length > 0) return normal.reduce((s, v) => s + v, 0) / normal.length;
  if (values.some((v) => v === -1)) return -1;
  return 50;
}
function mergeGestationSpeedByAverageDays(values) {
  const speeds = values.filter((v) => Number.isFinite(v) && v > 0);
  if (speeds.length === 0) return null;
  const avgDays = speeds.map((s) => 280 / s).reduce((s, d) => s + d, 0) / speeds.length;
  return avgDays > 0 ? 280 / avgDays : null;
}
export function getMergedRacePhysiologyProfile(race) {
  const parts = getRaceComponents(race);
  if (parts.length === 0) return null;
  const profiles = parts.map((p) => getRacePhysiologyProfile(p)).filter((p) => p && typeof p === 'object');
  if (profiles.length === 0) return null;
  const merged = {};
  for (const field of RACE_PHYSIOLOGY_FIELDS) {
    const values = profiles.map((p) => Number(p[field])).filter((v) => Number.isFinite(v));
    if (values.length > 0) {
      merged[field] = field === 'gestationSpeciesSpeed'
        ? mergeGestationSpeedByAverageDays(values)
        : values.reduce((s, v) => s + v, 0) / values.length;
    }
  }
  merged.clutchSizeMean = getClutchSizeMeanByRace(race);
  merged.genderRatio = mergeGenderRatioValues(profiles.map((p) => p.genderRatio));
  return merged;
}
export function getEmbryoTypeByRace(race) {
  const parts = getRaceComponents(race);
  if (parts.length === 0) return '胎生';
  let dominantRace = parts[0];
  let lowestSpeed = Number.POSITIVE_INFINITY;
  for (const part of parts) {
    const speed = Number(getRacePhysiologyProfile(part)?.gestationSpeciesSpeed);
    if (Number.isFinite(speed) && speed < lowestSpeed) { lowestSpeed = speed; dominantRace = part; }
  }
  if (VIVIPAROUS_RACES.includes(dominantRace)) return '胎生';
  if (OVIPAROUS_RACES.includes(dominantRace)) return '卵生';
  if (OVOVIVIPAROUS_RACES.includes(dominantRace)) return '卵胎生';
  if (METOVIVIPAROUS_RACES.includes(dominantRace)) return '胎转卵生';
  if (AMORPHOUS_RACES.includes(dominantRace)) return '不定型';
  return '胎生';
}
export function getClutchSizeMeanByRace(race) {
  const embryoType = getEmbryoTypeByRace(race);
  if (embryoType === '胎生' || embryoType === '胎转卵生') return 1;
  const parts = getRaceComponents(race);
  if (parts.length === 0) return 1;
  const values = parts.map((p) => {
    const fromDict = Number(RACE_CLUTCH_SIZE_MEANS && RACE_CLUTCH_SIZE_MEANS[p]);
    if (Number.isFinite(fromDict) && fromDict >= 1) return fromDict;
    const v = Number(getRacePhysiologyProfile(p)?.clutchSizeMean);
    return Number.isFinite(v) && v >= 1 ? v : 1;
  });
  if (values.length === 1) return values[0];
  return Math.exp(values.reduce((s, v) => s + Math.log(v), 0) / values.length);
}
export function getSpermDoseClutchMultiplier(spermValue = 20) {
  const dose = Number.isFinite(Number(spermValue)) ? Math.max(0, Number(spermValue)) : 20;
  return Math.max(0.5, Math.min(1.5, 0.5 + (dose / 40)));
}
export function getSpermDoseDifficultyBonus(totalSperm) {
  const dose = Number.isFinite(Number(totalSperm)) ? Math.max(0, Number(totalSperm)) : 0;
  return Math.max(0.5, Math.min(2, Math.sqrt(dose / 20)));
}

/* ================= 精液暴露 ================= */
export function calculateSpermExposure(value, elapsedDays, decayPerDay = SPERM_DECAY_PER_DAY) {
  const startingValue = clampNumber(value, 0, 999999, 0);
  const requestedDays = Math.max(0, Number(elapsedDays) || 0);
  const decay = clampNumber(decayPerDay, 0.000001, 999999, SPERM_DECAY_PER_DAY);
  const exposureDays = Math.min(requestedDays, startingValue / decay);
  const endingValue = Math.max(0, startingValue - (decay * exposureDays));
  const exposureAmountDays = ((startingValue + endingValue) / 2) * exposureDays;
  return { startingValue, endingValue, exposureDays, exposureAmountDays };
}
function isSameRaceGroup(raceA, raceB) {
  const left = getRaceComponents(raceA).map(String).sort();
  const right = getRaceComponents(raceB).map(String).sort();
  return left.length > 0 && right.length > 0
    && left.length === right.length
    && left.every((v, i) => v === right[i]);
}
/* ================= 1. 自然受精预测 ================= */
export function calculateFertilizationPreview({
  eggRace = '人类', impregnationDifficulty = null, elapsedDays = 1, chanceFactor = 1, spermSources = [],
} = {}) {
  const eggProfile = getMergedRacePhysiologyProfile(eggRace) || {};
  const femaleDifficulty = impregnationDifficulty === null || impregnationDifficulty === undefined || impregnationDifficulty === ''
    ? clampNumber(eggProfile.impregnationDifficulty, 0.1, 100, 1)
    : clampNumber(impregnationDifficulty, 0.1, 100, 1);
  const validSources = (Array.isArray(spermSources) ? spermSources : [])
    .map((source, index) => ({
      ...source, sourceIndex: index, race: String(source?.race || '人类'),
      value: clampNumber(source?.value, 0, 999999, 0),
    }))
    .filter((source) => source.value > 0)
    .map((source) => ({ ...source, ...calculateSpermExposure(source.value, elapsedDays) }))
    .filter((source) => source.exposureDays > 0);
  const totalSperm = validSources.reduce((s, x) => s + x.value, 0);
  const effectiveExposureDays = validSources.reduce((mx, x) => Math.max(mx, x.exposureDays), 0);
  const totalExposureAmountDays = validSources.reduce((s, x) => s + x.exposureAmountDays, 0);
  const effectiveTotalSperm = effectiveExposureDays > 0 ? totalExposureAmountDays / effectiveExposureDays : 0;
  const spermDoseBonus = getSpermDoseDifficultyBonus(effectiveTotalSperm);
  const sources = validSources.map((source) => {
    const share = totalExposureAmountDays > 0 ? source.exposureAmountDays / totalExposureAmountDays : 0;
    const maleProfile = getMergedRacePhysiologyProfile(source.race) || {};
    const maleDifficulty = clampNumber(maleProfile.impregnationDifficulty, 0.1, 100, 1);
    const sameRace = isSameRaceGroup(eggRace, source.race);
    let effectiveDifficulty = sameRace
      ? femaleDifficulty
      : Math.sqrt(femaleDifficulty * maleDifficulty) * CROSS_RACE_DIFFICULTY_MULTIPLIER;
    const eggEmbryoType = getEmbryoTypeByRace(eggRace);
    const spermEmbryoType = getEmbryoTypeByRace(source.race);
    if (eggEmbryoType !== spermEmbryoType) effectiveDifficulty *= EMBRYO_TYPE_MISMATCH_MULTIPLIER;
    effectiveDifficulty /= spermDoseBonus;
    const baseChance = clampNumber((effectiveExposureDays * 12 * 0.5) / effectiveDifficulty, 0.001, 1, 0.001);
    const chance = clampNumber(baseChance * share * Math.max(0, Number(chanceFactor) || 0), 0, 1, 0);
    return { ...source, share, maleDifficulty, sameRace, effectiveDifficulty, chance };
  });
  const failureChance = sources.reduce((r, x) => r * (1 - x.chance), 1);
  const successChance = 1 - failureChance;
  const totalChanceWeight = sources.reduce((s, x) => s + x.chance, 0);
  const weightedSources = sources.map((x) => ({
    ...x,
    winnerWeight: totalChanceWeight > 0 ? x.chance / totalChanceWeight : 0,
    winChance: totalChanceWeight > 0 ? successChance * x.chance / totalChanceWeight : 0,
  }));
  return {
    eggRace, femaleDifficulty, totalSperm, effectiveTotalSperm, effectiveExposureDays,
    totalExposureAmountDays, spermDoseBonus, sources: weightedSources,
    totalChanceWeight, successChance, failureChance,
  };
}
/* ================= 着床预测 ================= */
export function calculateImplantationDays(cycleLength = 28) {
  return Math.max(1, (6 * clampNumber(cycleLength, 0.1, 9999, 28)) / 28);
}
export function calculateRaceImplantationDays(race = '人类') {
  const profile = getMergedRacePhysiologyProfile(race) || {};
  const ratio = clampNumber(profile.menstrualLengthRatio, 0.1, 20, 1);
  const cycleLength = MENSTRUAL_STAGES.reduce((s, stage) => (
    s + Math.max(1, (Number(MENSTRUAL_STAGE_DAYS[stage]) || 0) * ratio)
  ), 0);
  return calculateImplantationDays(cycleLength || 28);
}
export function calculateImplantationPreview({ cycleLength = 28, vitality = 100, elapsedDays = 0 } = {}) {
  const requiredDays = calculateImplantationDays(cycleLength);
  const elapsed = Math.max(0, Number(elapsedDays) || 0);
  return {
    requiredDays, elapsedDays: elapsed, remainingDays: Math.max(0, requiredDays - elapsed),
    ready: elapsed >= requiredDays,
    successChance: clampNumber(vitality, 0, 200, 100) >= 100 ? 1 : clampNumber(vitality, 0, 100, 100) / 100,
  };
}
/* ================= 2. 后代预测 ================= */
export function calculateOffspringPreview({
  eggRace = '人类', spermRace = '人类', spermValue = 20, conceptionStage = '排卵期',
} = {}) {
  const fetusRace = deriveFetusRace(eggRace, spermRace);
  const embryoType = getEmbryoTypeByRace(fetusRace);
  const clutchSizeMean = getClutchSizeMeanByRace(fetusRace);
  const clutchMultiplier = getSpermDoseClutchMultiplier(spermValue);
  const adjustedMean = clutchSizeMean <= 1 ? 1 : clutchSizeMean * clutchMultiplier;
  const clutchRange = clutchSizeMean <= 1
    ? { min: 1, typical: 1, max: 1 }
    : {
        min: Math.max(1, Math.min(12500, Math.round(adjustedMean * 0.9))),
        typical: Math.max(1, Math.min(12500, Math.round(adjustedMean))),
        max: Math.max(1, Math.min(12500, Math.ceil((adjustedMean * 1.1) + 0.5) - 1)),
      };
  const profile = getMergedRacePhysiologyProfile(fetusRace) || {};
  const eggProfile = getMergedRacePhysiologyProfile(eggRace) || {};
  const spermProfile = getMergedRacePhysiologyProfile(spermRace) || {};
  const gestationSpeciesSpeed = clampNumber(profile.gestationSpeciesSpeed, 0.1, 20, 1);
  const components = getRaceComponents(fetusRace);
  const embryoTypeSource = components.reduce((slowest, race) => {
    const speed = clampNumber(getMergedRacePhysiologyProfile(race)?.gestationSpeciesSpeed, 0.1, 20, 1);
    if (!slowest || speed < slowest.speed) return { race, speed };
    return slowest;
  }, null);
  const eggBreedTolerance = clampNumber(eggProfile.breedTolerance, 0.1, 100, 1);
  const spermBreedTolerance = clampNumber(spermProfile.breedTolerance, 0.1, 100, 1);
  const dominance = (spermBreedTolerance - eggBreedTolerance) / Math.max(eggBreedTolerance + spermBreedTolerance, 0.1);
  const breedWeightRatio = clampNumber(1 + (dominance * 0.65), 0.625, 1.6, 1);
  const stageWeight = { 黄体期: 1.2, 排卵期: 1.1, 卵泡期: 1, 产后恢复: 1 / 1.1, 月经期: 1 / 1.2 }[String(conceptionStage || '')] || 1;
  const genderRatio = profile.genderRatio;
  const sexMultipliers = genderRatio === null || Number(genderRatio) === -1
    ? [1]
    : Number(genderRatio) <= 0
      ? [1 / 1.05]
      : Number(genderRatio) >= 100
        ? [1.05]
        : [1 / 1.05, 1.05];
  const weightCandidates = sexMultipliers.flatMap((sexMultiplier) => [
    stageWeight * Math.exp(-0.083) * sexMultiplier * breedWeightRatio,
    stageWeight * Math.exp(0.083) * sexMultiplier * breedWeightRatio,
  ]).map((v) => clampNumber(v, 0.33, 3, 1));
  const fetalWeightRange = {
    min: Math.min(...weightCandidates),
    typical: clampNumber(stageWeight * breedWeightRatio, 0.33, 3, 1),
    max: Math.max(...weightCandidates),
  };
  return {
    eggRace, spermRace, fetusRace, embryoType, embryoTypeSource: embryoTypeSource?.race || fetusRace,
    gestationSpeciesSpeed, gestationDays: 280 / gestationSpeciesSpeed, genderRatio,
    implantationDays: calculateRaceImplantationDays(eggRace),
    identicalProbability: clampNumber(profile.identicalProbability, 0, 100, 5),
    conceptionStage, breedWeightRatio, fetalWeightRange,
    clutchSizeMean, clutchMultiplier, adjustedClutchMean: adjustedMean, clutchRange,
  };
}

/* ================= 核型继承 ================= */
const RACE_INHERITANCE_MODES = { NORMAL: 'normal', PATERNAL: 'paternal', MATERNAL: 'maternal' };
// 核型种族（雄核/雌核发生）——无法从本地 RACE_PHYSIOLOGY 直接读取，用特征名判定
const PATERNAL_NUCLEUS_RACES = [];
const MATERNAL_NUCLEUS_RACES = [];
export function getRaceInheritanceMode(race) {
  const descriptorParts = getRaceDescriptorComponents(race);
  if (descriptorParts.length !== 1) return RACE_INHERITANCE_MODES.NORMAL;
  const key = getBaseRaceComponentName(descriptorParts[0]);
  const profile = getRacePhysiologyProfile(key);
  const mode = String(profile?.inheritanceMode || '');
  return Object.values(RACE_INHERITANCE_MODES).includes(mode) ? mode : RACE_INHERITANCE_MODES.NORMAL;
}
function combineRaceDescriptors(spermRace, eggRace) {
  const combined = [...getRaceDescriptorComponents(spermRace), ...getRaceDescriptorComponents(eggRace)].filter(Boolean);
  if (combined.length === 0) return '人类';
  return [...new Set(combined)].join('x');
}
export function deriveFetusRace(eggRace, spermRace) {
  const eggMode = getRaceInheritanceMode(eggRace);
  const spermMode = getRaceInheritanceMode(spermRace);
  const eggHasNucleus = eggMode !== RACE_INHERITANCE_MODES.NORMAL;
  const spermHasNucleus = spermMode !== RACE_INHERITANCE_MODES.NORMAL;
  if (eggHasNucleus !== spermHasNucleus) {
    const activeMode = eggHasNucleus ? eggMode : spermMode;
    const selectedRace = activeMode === RACE_INHERITANCE_MODES.PATERNAL ? spermRace : eggRace;
    const selectedParts = getRaceDescriptorComponents(selectedRace);
    if (selectedParts.length > 0) return [...new Set(selectedParts)].join('x');
  }
  return combineRaceDescriptors(spermRace, eggRace);
}
export function getFetusInheritanceTag(eggRace, spermRace) {
  const eggMode = getRaceInheritanceMode(eggRace);
  const spermMode = getRaceInheritanceMode(spermRace);
  const eggHasNucleus = eggMode !== RACE_INHERITANCE_MODES.NORMAL;
  const spermHasNucleus = spermMode !== RACE_INHERITANCE_MODES.NORMAL;
  if (eggHasNucleus === spermHasNucleus) return null;
  const activeMode = eggHasNucleus ? eggMode : spermMode;
  return activeMode === RACE_INHERITANCE_MODES.PATERNAL ? 'androgenesis' : 'gynogenesis';
}
/* ================= 3. 衍生遗传推演 ================= */
export function getDerivedTypeInheritanceProfile(derivedType) {
  const baseName = derivedType ? String(derivedType) : '';
  return DERIVED_TYPE_INHERITANCE_PROFILES[baseName] || null;
}
export function getDerivedInheritanceSeed(motherDerivedType, fatherDerivedType) {
  const mother = motherDerivedType ? String(motherDerivedType) : null;
  const father = fatherDerivedType ? String(fatherDerivedType) : null;
  if (!mother && !father) return { affinity: 0, progress: 0 };
  if (mother && father && mother === father) return { affinity: 30, progress: 30 };
  if (mother && father && mother !== father) return { affinity: -30, progress: -30 };
  return { affinity: 15, progress: 0 };
}
function getDerivedInheritanceDirection(currentProgress, motherDerivedType, fatherDerivedType) {
  if (currentProgress !== 0) return Math.sign(currentProgress);
  const mother = motherDerivedType ? String(motherDerivedType) : null;
  const father = fatherDerivedType ? String(fatherDerivedType) : null;
  if (mother && !father) return 1;
  if (!mother && father) return -1;
  if (mother && father) return mother === father ? 1 : -1;
  return 0;
}
function getDerivedInheritanceRate({
  currentProgress = 0, affinity = 0, motherDerivedType = null, fatherDerivedType = null,
  fetusRace = '人类', gestationModifierMultiplier = 1,
} = {}) {
  const progress = clampNumber(currentProgress, -100, 100, 0);
  const direction = getDerivedInheritanceDirection(progress, motherDerivedType, fatherDerivedType);
  const activeDerivedType = direction > 0 ? motherDerivedType : fatherDerivedType;
  if (direction === 0 || !activeDerivedType) return { progress, direction, activeDerivedType: null, dailyDelta: 0 };
  const alignedAffinity = direction * clampNumber(affinity, -50, 50, 0);
  const affinityFactor = clampNumber(1 + (alignedAffinity / 30), 0, 3, 1);
  const inheritanceSpeed = clampNumber(getDerivedTypeInheritanceProfile(activeDerivedType)?.inheritanceSpeed, 0.2, 3, 1);
  const speciesSpeed = clampNumber(getMergedRacePhysiologyProfile(fetusRace)?.gestationSpeciesSpeed, 0.1, 20, 1);
  const modifier = clampNumber(gestationModifierMultiplier, 0, 20, 1);
  const dailyDelta = direction * (DERIVED_INHERITANCE_THRESHOLD / DERIVED_INHERITANCE_BASELINE_DAYS)
    * speciesSpeed * modifier * affinityFactor * inheritanceSpeed;
  return { progress, direction, activeDerivedType, dailyDelta };
}
export function calculateDerivedInheritanceProgress({
  currentProgress = 0, affinity = 0, motherDerivedType = null, fatherDerivedType = null,
  fetusRace = '人类', passedDays = 0, gestationModifierMultiplier = 1,
} = {}) {
  const { progress, dailyDelta } = getDerivedInheritanceRate({
    currentProgress, affinity, motherDerivedType, fatherDerivedType, fetusRace, gestationModifierMultiplier,
  });
  const elapsedDays = Math.max(0, Number(passedDays) || 0);
  if (dailyDelta === 0 || elapsedDays <= 0) return progress;
  return clampNumber(progress + (dailyDelta * elapsedDays), -100, 100, progress);
}
export function calculateDerivedInheritancePreview(options = {}) {
  const { progress, direction, activeDerivedType, dailyDelta } = getDerivedInheritanceRate(options);
  const nextProgress = calculateDerivedInheritanceProgress(options);
  const distance = direction > 0
    ? DERIVED_INHERITANCE_THRESHOLD - progress
    : direction < 0 ? progress + DERIVED_INHERITANCE_THRESHOLD : 0;
  const exactDaysToThreshold = direction && Math.abs(dailyDelta) > 0
    ? Math.max(0, distance / Math.abs(dailyDelta))
    : null;
  return {
    direction, activeDerivedType: activeDerivedType || null, currentProgress: progress, nextProgress,
    dailyDelta,
    exactDaysToThreshold,
    wholeDaysToInherit: exactDaysToThreshold === null
      ? null
      : exactDaysToThreshold <= 0 ? 0 : Math.floor(exactDaysToThreshold) + 1,
    inheritedType: nextProgress > DERIVED_INHERITANCE_THRESHOLD
      ? (options.motherDerivedType || null)
      : nextProgress < -DERIVED_INHERITANCE_THRESHOLD
        ? (options.fatherDerivedType || null)
        : null,
  };
}
