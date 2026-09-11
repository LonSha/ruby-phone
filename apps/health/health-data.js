/**
 * 健康与生理 App - 数据管理
 * 28 天周期沿用生理引擎 5.49；妊娠/产程/种族孕速移植自 Liuuuu54/st_bs_biotracker
 * 纯本地数学，不绑定外部 LLM
 */

import {
  MENSTRUAL_STAGES,
  LABOR_STAGES,
  DEFAULT_RECOVERY_DAYS,
  clampNumber,
  getRaceProfile,
  getEmbryoTypeByRace,
  getGestationEffectiveSpeed,
  getPregnancyTotalDays,
  derivePregnancyStageState,
  cycleDayToMenstrualStage,
  menstrualStageToCycleDay,
  resolveLaborPhaseHours,
  getLaborPhaseForStage,
  getProdromalInitialHours,
  estimateLaborPain,
  createFetus,
  describeFetusTags,
  pregnancyWeeks,
  isLaborish,
  listKnownRaces,
  EMBRYO_LORE,
} from './bio-engine.js';
import { normalizeNeeds, advanceNeeds, applyNeedEvent, describeNeeds, buildNeedsDirective } from './physio-core.js';
import { emptyLineage, normalizeLineage, addBirth, removeBirth } from './family-core.js';

const PHASE_META = {
  月经期: {
    color: '#ef4444',
    desc: '子宫内膜脱落，伴随轻微腹胀或疲倦。对生冷刺激抗拒。',
    fertility: '极低 (安全期)',
    arousalLevel: '性欲偏低',
    tempDelta: -0.1,
  },
  卵泡期: {
    color: '#ec4899',
    desc: '雌激素回升，精力较好，皮肤状态回暖。',
    fertility: '偏低逐渐转高',
    arousalLevel: '自然平稳',
    tempDelta: 0,
  },
  排卵期: {
    color: '#a855f7',
    desc: '宫颈黏液清亮，基础体温可升高 0.3-0.5℃。受孕窗口打开。',
    fertility: '极高 (极易受孕)',
    arousalLevel: '敏感度升高',
    tempDelta: 0.4,
  },
  黄体期: {
    color: '#f59e0b',
    desc: '孕激素占主导，基础体温处于高相。食欲轻度增加。',
    fertility: '低 (黄体安全期)',
    arousalLevel: '温和沉静',
    tempDelta: 0.3,
  },
  孕早期: {
    color: '#fb7185',
    desc: '着床后激素爬升。可能出现晨起不适、嗜睡、乳房胀痛。',
    fertility: '无受孕可能 (已妊娠)',
    arousalLevel: '敏感波动',
    tempDelta: 0.3,
  },
  孕中期: {
    color: '#f43f5e',
    desc: '胎动逐渐明显，腰腹变沉，胃口与睡眠需求上升。',
    fertility: '无受孕可能 (已妊娠)',
    arousalLevel: '血流增加、局部更敏感',
    tempDelta: 0.35,
  },
  孕晚期: {
    color: '#e11d48',
    desc: '宫底升高，呼吸与行动变沉，Braxton-Hicks 样宫缩可能出现。',
    fertility: '无受孕可能 (已妊娠)',
    arousalLevel: '坠胀与宫缩感间歇出现',
    tempDelta: 0.4,
  },
  临产期: {
    color: '#be123c',
    desc: '先兆宫缩变密，见红或破水可能发生。距离正式产程不远。',
    fertility: '临产窗口',
    arousalLevel: '宫缩压力主导',
    tempDelta: 0.45,
  },
  逾期: {
    color: '#9f1239',
    desc: '已超过该种族折算孕期。宫内压力持续累积，随时可能进入产兆。',
    fertility: '逾期待产',
    arousalLevel: '持续坠胀',
    tempDelta: 0.5,
  },
  产兆前驱: {
    color: '#7c2d12',
    desc: '规律宫缩开始建立，尚未开全。正式产程倒计时中。',
    fertility: '产兆中',
    arousalLevel: '宫缩阵痛',
    tempDelta: 0.4,
  },
  第一产程: {
    color: '#9a3412',
    desc: '宫口扩张期。潜伏期→活跃期→过渡期，宫缩逐渐加密加强。',
    fertility: '分娩中',
    arousalLevel: '阵痛递进',
    tempDelta: 0.5,
  },
  第二产程: {
    color: '#c2410c',
    desc: '胎儿下降与娩出。多胎时一胎娩出后进入间歇再推下一胎。',
    fertility: '分娩中',
    arousalLevel: '用力与压迫',
    tempDelta: 0.55,
  },
  第三产程: {
    color: '#ea580c',
    desc: '供养器官娩出与产后观察。出血与宫缩仍需监测。',
    fertility: '分娩收尾',
    arousalLevel: '余痛与虚脱',
    tempDelta: 0.4,
  },
  产后恢复: {
    color: '#0d9488',
    desc: '恶露与子宫复旧期。周期暂停，恢复完成后回到卵泡期。',
    fertility: '暂无 (产后恢复)',
    arousalLevel: '疲乏为主',
    tempDelta: 0.1,
  },
};

function cloneFetuses(list) {
  if (!Array.isArray(list)) return [];
  return list.map((item) => createFetus(item || {}));
}

export class HealthData {
  constructor(storage) {
    this.storage = storage;
    this.storageKey = 'ruby_health_cycle';
    this.cycleLength = 28;
    this.currentCycleDay = 14;
    this.isPregnant = false;
    this.gestationWeeks = 0;
    this.bodyTemp = 36.6;
    this.autoInject = false;
    this.race = '人类';
    this.gestationModifier = 1;
    this.stage = '排卵期';
    this.stageDays = 2;
    this.pregnantDays = 0;
    this.effectivePregnantDays = 0;
    this.laborHours = 0;
    this.effectiveLaborHours = 0;
    this.laborPhase = null;
    this.laborPain = 0;
    this.prodromalRemainingHours = 0;
    this.fetuses = [];
    this.recoveryDays = DEFAULT_RECOVERY_DAYS;
    this.naturalBirthExperience = 0;
    this.bornThisLabor = 0;
    this.bornChildrenThisLabor = [];
    this.needs = normalizeNeeds();
    this.lineage = emptyLineage();
    this.healthTab = 'cycle';
    this.lastNotify = '';
    this.loadState();
  }

  get raceProfile() {
    return getRaceProfile(this.race);
  }

  get gestationSpeed() {
    return getGestationEffectiveSpeed({
      race: this.race,
      modifier: this.gestationModifier,
    });
  }

  get embryoType() {
    const fromFetus = this.fetuses[0]?.embryoType;
    return fromFetus || getEmbryoTypeByRace(this.race);
  }

  get pregnancyTotalDays() {
    return getPregnancyTotalDays(this.gestationSpeed);
  }

  loadState() {
    try {
      const raw = this.storage?.get?.(this.storageKey);
      if (!raw) {
        this._syncDerived();
        return;
      }
      const d = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (typeof d.cycleDay === 'number') this.currentCycleDay = d.cycleDay;
      if (typeof d.isPregnant === 'boolean') this.isPregnant = d.isPregnant;
      if (typeof d.gestationWeeks === 'number') this.gestationWeeks = d.gestationWeeks;
      if (typeof d.autoInject === 'boolean') this.autoInject = d.autoInject;
      if (typeof d.bodyTemp === 'number') this.bodyTemp = d.bodyTemp;
      if (typeof d.race === 'string' && d.race.trim()) this.race = d.race.trim();
      if (typeof d.gestationModifier === 'number') this.gestationModifier = clampNumber(d.gestationModifier, 0.1, 20, 1);
      if (typeof d.stage === 'string') this.stage = d.stage;
      if (typeof d.stageDays === 'number') this.stageDays = d.stageDays;
      if (typeof d.pregnantDays === 'number') this.pregnantDays = d.pregnantDays;
      if (typeof d.effectivePregnantDays === 'number') this.effectivePregnantDays = d.effectivePregnantDays;
      if (typeof d.laborHours === 'number') this.laborHours = d.laborHours;
      if (typeof d.effectiveLaborHours === 'number') this.effectiveLaborHours = d.effectiveLaborHours;
      if (typeof d.laborPhase === 'string' || d.laborPhase === null) this.laborPhase = d.laborPhase;
      if (typeof d.laborPain === 'number') this.laborPain = d.laborPain;
      if (typeof d.prodromalRemainingHours === 'number') this.prodromalRemainingHours = d.prodromalRemainingHours;
      if (Array.isArray(d.fetuses)) this.fetuses = cloneFetuses(d.fetuses);
      if (typeof d.recoveryDays === 'number') this.recoveryDays = clampNumber(d.recoveryDays, 1, 9999, DEFAULT_RECOVERY_DAYS);
      if (typeof d.naturalBirthExperience === 'number') this.naturalBirthExperience = clampNumber(d.naturalBirthExperience, 0, 99, 0);
      if (typeof d.bornThisLabor === 'number') this.bornThisLabor = clampNumber(d.bornThisLabor, 0, 6, 0);
      if (Array.isArray(d.bornChildrenThisLabor)) this.bornChildrenThisLabor = d.bornChildrenThisLabor;
      if (d.needs) this.needs = normalizeNeeds(d.needs);
      if (d.lineage) this.lineage = normalizeLineage(d.lineage);
      if (typeof d.healthTab === 'string') this.healthTab = d.healthTab;
      if (typeof d.lastNotify === 'string') this.lastNotify = d.lastNotify;

      // 旧档：只有周期天/孕周，没有阶段字段
      if (!d.stage) {
        if (this.isPregnant) {
          if (this.pregnantDays <= 0 && this.gestationWeeks > 0) {
            this.pregnantDays = this.gestationWeeks * 7;
          }
          this.effectivePregnantDays = this.pregnantDays * this.gestationSpeed;
          if (!this.fetuses.length) this.fetuses = [createFetus({ race: this.race })];
        } else {
          const mapped = cycleDayToMenstrualStage(this.currentCycleDay, this.cycleLength);
          this.stage = mapped.stage;
          this.stageDays = mapped.days;
        }
      }

      // 旧档：只有孕周、没有孕日
      if (this.isPregnant && this.pregnantDays <= 0 && this.gestationWeeks > 0) {
        this.pregnantDays = this.gestationWeeks * 7;
        this.effectivePregnantDays = this.pregnantDays * this.gestationSpeed;
        if (!this.fetuses.length) this.fetuses = [createFetus({ race: this.race })];
      }
      this._syncDerived();
    } catch (e) {
      console.warn('[HealthData] 加载生理状态失败:', e);
      this._syncDerived();
    }
  }

  saveState() {
    this._syncDerived();
    try {
      this.storage?.set?.(this.storageKey, {
        cycleDay: this.currentCycleDay,
        isPregnant: this.isPregnant,
        gestationWeeks: this.gestationWeeks,
        bodyTemp: this.bodyTemp,
        autoInject: this.autoInject,
        race: this.race,
        gestationModifier: this.gestationModifier,
        stage: this.stage,
        stageDays: this.stageDays,
        pregnantDays: this.pregnantDays,
        effectivePregnantDays: this.effectivePregnantDays,
        laborHours: this.laborHours,
        effectiveLaborHours: this.effectiveLaborHours,
        laborPhase: this.laborPhase,
        laborPain: this.laborPain,
        prodromalRemainingHours: this.prodromalRemainingHours,
        fetuses: this.fetuses,
        recoveryDays: this.recoveryDays,
        naturalBirthExperience: this.naturalBirthExperience,
        bornThisLabor: this.bornThisLabor,
        bornChildrenThisLabor: this.bornChildrenThisLabor,
        needs: this.needs,
        lineage: this.lineage,
        healthTab: this.healthTab,
        lastNotify: this.lastNotify,
        updatedAt: Date.now(),
      });
    } catch (e) {
      console.warn('[HealthData] 保存生理状态失败:', e);
    }
  }

  _syncDerived() {
    if (this.isPregnant && this.fetuses.length === 0 && !isLaborish(this.stage) && this.stage !== '产后恢复') {
      this.fetuses = [createFetus({ race: this.race })];
    }
    if (this.isPregnant && !isLaborish(this.stage) && this.stage !== '产后恢复') {
      const derived = derivePregnancyStageState(this.effectivePregnantDays, 1);
      this.stage = derived.stage;
      this.stageDays = derived.days;
    }
    if (MENSTRUAL_STAGES.includes(this.stage)) {
      this.currentCycleDay = menstrualStageToCycleDay(this.stage, this.stageDays);
      this.isPregnant = false;
    }
    this.gestationWeeks = this.isPregnant ? pregnancyWeeks(this.pregnantDays) : 0;
    const meta = PHASE_META[this.stage] || PHASE_META['卵泡期'];
    this.bodyTemp = Math.round((36.6 + (meta.tempDelta || 0)) * 10) / 10;
    if (isLaborish(this.stage)) {
      this.laborPhase = this.stage === '产兆前驱'
        ? null
        : getLaborPhaseForStage(this.stage, this.laborPhase);
      const threshold = this._laborThreshold();
      const progress = threshold > 0 ? this.effectiveLaborHours / threshold : 0;
      this.laborPain = estimateLaborPain(this.stage, this.laborPhase, progress, this.raceProfile.birthDifficulty);
    }
  }

  _laborThreshold() {
    if (this.stage === '产兆前驱') return getProdromalInitialHours(this.raceProfile.birthDifficulty);
    return resolveLaborPhaseHours({
      stage: this.stage,
      phase: this.laborPhase,
      fetusesCount: Math.max(1, this.fetuses.length),
      birthDifficulty: this.raceProfile.birthDifficulty,
      naturalBirthExperience: this.naturalBirthExperience,
    });
  }

  _notify(text) {
    this.lastNotify = String(text || '');
    return this.lastNotify;
  }

  _progressRatio(total) {
    if (this.stage === '产后恢复') return Math.min(1, this.stageDays / Math.max(1, this.recoveryDays));
    if (this.stage === '产兆前驱') {
      const initial = getProdromalInitialHours(this.raceProfile.birthDifficulty);
      return initial > 0 ? Math.min(1, 1 - (this.prodromalRemainingHours / initial)) : 1;
    }
    if (LABOR_STAGES.includes(this.stage)) {
      const threshold = this._laborThreshold();
      return threshold > 0 ? Math.min(1, this.effectiveLaborHours / threshold) : 1;
    }
    if (this.isPregnant && total > 0) return Math.min(1, this.effectivePregnantDays / total);
    return this.currentCycleDay / this.cycleLength;
  }

  getPhaseInfo() {
    this._syncDerived();
    const meta = PHASE_META[this.stage] || PHASE_META['卵泡期'];
    const speed = this.gestationSpeed;
    const total = this.pregnancyTotalDays;
    let badge;
    if (this.stage === '产后恢复') {
      badge = `产后第 ${Math.floor(this.stageDays)} 天 / ${this.recoveryDays} 天`;
    } else if (this.stage === '产兆前驱') {
      badge = `产兆 剩余 ${Math.ceil(this.prodromalRemainingHours)} 小时`;
    } else if (LABOR_STAGES.includes(this.stage)) {
      badge = `${this.stage}·${this.laborPhase || ''}  ${this.effectiveLaborHours.toFixed(1)}h`;
    } else if (this.isPregnant) {
      badge = `孕 ${this.gestationWeeks} 周 · ${this.stage} 第 ${Math.floor(this.stageDays)} 天`;
    } else {
      badge = `${this.stage} 第 ${this.currentCycleDay} 天`;
    }
    return {
      phase: this.stage,
      color: meta.color,
      badge,
      desc: meta.desc,
      fertility: meta.fertility,
      arousalLevel: meta.arousalLevel,
      bodyTemp: this.bodyTemp,
      race: this.race,
      embryoType: this.embryoType,
      embryoLore: EMBRYO_LORE[this.embryoType] || '',
      gestationSpeed: speed,
      pregnantDays: this.pregnantDays,
      effectivePregnantDays: this.effectivePregnantDays,
      pregnancyTotalDays: total,
      progress: this._progressRatio(total),
      fetuses: this.fetuses,
      laborPhase: this.laborPhase,
      laborPain: this.laborPain,
      lastNotify: this.lastNotify,
      cycleDay: this.currentCycleDay,
    };
  }

  knownRaces() {
    return listKnownRaces();
  }

  setRace(race) {
    const name = String(race || '').trim() || '人类';
    const prev = this.race;
    this.race = name;
    if (this.isPregnant) {
      this.fetuses = this.fetuses.map((f) => {
        const nextRace = (!f.race || f.race === prev) ? name : f.race;
        return createFetus({ ...f, race: nextRace, embryoType: getEmbryoTypeByRace(nextRace) });
      });
      if (this.pregnantDays > 0) {
        this.effectivePregnantDays = this.pregnantDays * this.gestationSpeed;
      }
    }
    this.saveState();
  }

  setGestationModifier(value) {
    this.gestationModifier = clampNumber(value, 0.1, 20, 1);
    if (this.isPregnant && this.pregnantDays > 0 && !isLaborish(this.stage)) {
      this.effectivePregnantDays = this.pregnantDays * this.gestationSpeed;
    }
    this.saveState();
  }

  setDay(day) {
    if (this.isPregnant) {
      const weeks = clampNumber(day, 0, 60, 0);
      this.pregnantDays = weeks * 7;
      this.effectivePregnantDays = this.pregnantDays * this.gestationSpeed;
      this.saveState();
      return;
    }
    this.currentCycleDay = Math.max(1, Math.min(this.cycleLength, parseInt(day, 10) || 1));
    const mapped = cycleDayToMenstrualStage(this.currentCycleDay, this.cycleLength);
    this.stage = mapped.stage;
    this.stageDays = mapped.days;
    this.saveState();
  }

  setAutoInject(on) {
    this.autoInject = !!on;
    this.saveState();
  }

  conceive({ weeks = 4, fathers = '未知', gender = '未知', count = 1, tags = [] } = {}) {
    const n = Math.max(1, Math.min(6, parseInt(count, 10) || 1));
    this.isPregnant = true;
    this.pregnantDays = Math.max(0, Number(weeks) || 0) * 7;
    this.effectivePregnantDays = this.pregnantDays * this.gestationSpeed;
    this.laborHours = 0;
    this.effectiveLaborHours = 0;
    this.laborPhase = null;
    this.laborPain = 0;
    this.prodromalRemainingHours = 0;
    this.bornThisLabor = 0;
    this.bornChildrenThisLabor = [];
    this.fetuses = [];
    for (let i = 0; i < n; i += 1) {
      this.fetuses.push(createFetus({
        race: this.race,
        fathers,
        gender,
        tags,
      }));
    }
    this._syncDerived();
    this._notify(`已受孕：${this.race} / ${this.embryoType} / ${n} 胎 / 孕 ${this.gestationWeeks} 周`);
    this.saveState();
  }

  togglePregnancy(pregnant, weeks = 4) {
    if (pregnant) this.conceive({ weeks });
    else this.clearPregnancy('解密妊娠，回到常规周期');
  }

  clearPregnancy(reason) {
    this.isPregnant = false;
    this.pregnantDays = 0;
    this.effectivePregnantDays = 0;
    this.laborHours = 0;
    this.effectiveLaborHours = 0;
    this.laborPhase = null;
    this.laborPain = 0;
    this.prodromalRemainingHours = 0;
    this.bornThisLabor = 0;
    this.bornChildrenThisLabor = [];
    this.fetuses = [];
    this.stage = '卵泡期';
    this.stageDays = 0;
    this.currentCycleDay = 6;
    this._notify(reason || '已恢复常规生理周期');
    this.saveState();
  }

  updateFetus(index, patch) {
    if (!this.fetuses[index]) return;
    this.fetuses[index] = createFetus({ ...this.fetuses[index], ...patch });
    this.saveState();
  }

  addFetus(patch = {}) {
    if (!this.isPregnant) this.conceive({ weeks: Math.max(1, this.gestationWeeks || 4) });
    if (this.fetuses.length >= 6) return;
    this.fetuses.push(createFetus({ race: this.race, ...patch }));
    this.saveState();
  }

  removeFetus(index) {
    if (this.fetuses.length <= 1) return;
    this.fetuses.splice(index, 1);
    this.saveState();
  }

  startLabor() {
    if (!this.isPregnant) return;
    if (this.stage === '产兆前驱' || LABOR_STAGES.includes(this.stage) || this.stage === '产后恢复') return;
    this.bornThisLabor = 0;
    this.bornChildrenThisLabor = [];
    this.stage = '产兆前驱';
    this.stageDays = 0;
    this.laborHours = 0;
    this.effectiveLaborHours = 0;
    this.laborPhase = null;
    this.prodromalRemainingHours = getProdromalInitialHours(this.raceProfile.birthDifficulty);
    this._notify(`进入产兆前驱，约 ${Math.ceil(this.prodromalRemainingHours)} 小时后正式产程`);
    this.saveState();
  }

  finishBirth({ surgical = false } = {}) {
    if (!this.isPregnant && this.stage !== '产后恢复') return;
    const remaining = this.fetuses.slice();
    const born = this.bornChildrenThisLabor.concat(remaining);
    const count = born.length;
    if (!surgical) this.naturalBirthExperience += 1;
    for (const child of born) {
      this.lineage = addBirth(this.lineage, {
        name: (child.gender && child.gender !== '未知') ? (child.gender + '婴') : ('孩子' + (this.lineage.births.length + 1)),
        gender: child.gender || '未知',
        father: child.fathers || '未知',
        race: child.race || this.race,
        embryoType: child.embryoType || this.embryoType,
        note: surgical ? '手术分娩' : '自然分娩',
      });
    }
    this.bornThisLabor = 0;
    this.bornChildrenThisLabor = [];
    this.isPregnant = false;
    this.pregnantDays = 0;
    this.effectivePregnantDays = 0;
    this.laborHours = 0;
    this.effectiveLaborHours = 0;
    this.laborPhase = null;
    this.laborPain = 0;
    this.prodromalRemainingHours = 0;
    this.fetuses = [];
    this.stage = '产后恢复';
    this.stageDays = 0;
    this._notify(surgical
      ? `手术分娩完成，${count} 胎已娩出，进入产后恢复`
      : `自然分娩完成，${count} 胎已娩出，进入产后恢复`);
    this.saveState();
  }

  _advanceMenstrual(days) {
    let next = ((this.currentCycleDay - 1 + days) % this.cycleLength + this.cycleLength) % this.cycleLength + 1;
    this.currentCycleDay = next;
    const mapped = cycleDayToMenstrualStage(next, this.cycleLength);
    this.stage = mapped.stage;
    this.stageDays = mapped.days;
  }

  _advancePregnancy(days) {
    if (days === 0) return;
    this.pregnantDays = Math.max(0, this.pregnantDays + days);
    this.effectivePregnantDays = Math.max(0, this.effectivePregnantDays + (days * this.gestationSpeed));
    const derived = derivePregnancyStageState(this.effectivePregnantDays, 1);
    const prev = this.stage;
    this.stage = derived.stage;
    this.stageDays = derived.days;
    if (this.stage !== prev) {
      this._notify(`妊娠阶段变化：${prev} → ${this.stage}`);
    }
    if ((this.stage === '临产期' || this.stage === '逾期') && days > 0) {
      // 临产/逾期后，每推进 1 天有机会进入产兆；本地规则：逾期必进，临产满 7 有效天再进
      if (this.stage === '逾期' || this.stageDays >= 7) {
        this.startLabor();
      }
    }
  }

  _advanceProdromal(days) {
    const hours = days * 24;
    this.prodromalRemainingHours = Math.max(0, this.prodromalRemainingHours - hours);
    const initial = getProdromalInitialHours(this.raceProfile.birthDifficulty);
    this.laborPain = estimateLaborPain('产兆前驱', null, 1 - (this.prodromalRemainingHours / initial), this.raceProfile.birthDifficulty);
    if (this.prodromalRemainingHours <= 0) {
      this.stage = '第一产程';
      this.laborPhase = '潜伏期';
      this.laborHours = 0;
      this.effectiveLaborHours = 0;
      this.stageDays = 0;
      this._notify('产兆结束，进入第一产程·潜伏期');
    } else {
      this._notify(`仍处产兆前驱，约剩 ${Math.ceil(this.prodromalRemainingHours)} 小时`);
    }
  }

  _advanceLabor(days) {
    if (days <= 0) {
      // 允许用负天数回退产程小时，但不跨阶段倒退到妊娠
      const hours = days * 24;
      this.laborHours = Math.max(0, this.laborHours + hours);
      this.effectiveLaborHours = Math.max(0, this.effectiveLaborHours + hours);
      return;
    }
    let remainHours = days * 24;
    let guard = 0;
    while (remainHours > 0 && LABOR_STAGES.includes(this.stage) && guard < 20) {
      guard += 1;
      this.laborPhase = getLaborPhaseForStage(this.stage, this.laborPhase);
      const threshold = this._laborThreshold();
      const need = Math.max(0.05, threshold - this.effectiveLaborHours);
      const step = Math.min(remainHours, need);
      this.laborHours += step;
      this.effectiveLaborHours += step;
      remainHours -= step;
      this.laborPain = estimateLaborPain(this.stage, this.laborPhase, this.effectiveLaborHours / threshold, this.raceProfile.birthDifficulty);
      if (this.effectiveLaborHours + 1e-6 < threshold) {
        this._notify(`${this.stage}·${this.laborPhase} 进度 ${this.effectiveLaborHours.toFixed(1)}/${threshold.toFixed(1)} 小时`);
        break;
      }
      this._progressLaborPhase();
    }
  }

  _progressLaborPhase() {
    const stage = this.stage;
    const phase = this.laborPhase;
    if (stage === '第一产程') {
      if (phase === '潜伏期') {
        this.laborPhase = '活跃期';
        this.laborHours = 0;
        this.effectiveLaborHours = 0;
        this._notify('进入第一产程·活跃期');
        return;
      }
      if (phase === '活跃期') {
        this.laborPhase = '过渡期';
        this.laborHours = 0;
        this.effectiveLaborHours = 0;
        this._notify('进入第一产程·过渡期');
        return;
      }
      this.stage = '第二产程';
      this.laborPhase = '胎体下降';
      this.laborHours = 0;
      this.effectiveLaborHours = 0;
      this._notify('宫口开全，进入第二产程·胎体下降');
      return;
    }
    if (stage === '第二产程') {
      if (phase === '胎体下降') {
        this.laborPhase = '胎体娩出';
        this.laborHours = 0;
        this.effectiveLaborHours = 0;
        this._notify('进入第二产程·胎体娩出');
        return;
      }
      if (phase === '胎体娩出') {
        const born = this.fetuses.shift();
        this.bornThisLabor += 1;
        if (born) this.bornChildrenThisLabor.push(born);
        if (this.fetuses.length > 0) {
          this.laborPhase = '间歇期';
          this.laborHours = 0;
          this.effectiveLaborHours = 0;
          this._notify(`${born?.gender || '未知'}胎娩出，仍有 ${this.fetuses.length} 胎待产`);
          return;
        }
        this.stage = '第三产程';
        this.laborPhase = '供养器官娩出';
        this.laborHours = 0;
        this.effectiveLaborHours = 0;
        this._notify('胎儿全部娩出，进入第三产程');
        return;
      }
      if (phase === '间歇期') {
        this.laborPhase = '胎体下降';
        this.laborHours = 0;
        this.effectiveLaborHours = 0;
        this._notify('间歇结束，下一胎开始下降');
        return;
      }
    }
    if (stage === '第三产程') {
      if (phase === '供养器官娩出') {
        this.laborPhase = '产后观察';
        this.laborHours = 0;
        this.effectiveLaborHours = 0;
        this._notify('供养器官娩出，进入产后观察');
        return;
      }
      this.finishBirth({ surgical: false });
    }
  }

  _advancePostpartum(days) {
    this.stageDays = Math.max(0, this.stageDays + days);
    if (this.stageDays > this.recoveryDays) {
      this.stage = '卵泡期';
      this.stageDays = 0;
      this.currentCycleDay = 6;
      this.isPregnant = false;
      this._notify('产后恢复完成，回到卵泡期');
    } else {
      this._notify(`产后恢复第 ${Math.floor(this.stageDays)} / ${this.recoveryDays} 天`);
    }
  }

  advanceDays(days = 1) {
    const delta = Number(days);
    if (!Number.isFinite(delta) || delta === 0) return this.getPhaseInfo();
    if (this.stage === '产后恢复') this._advancePostpartum(delta);
    else if (this.stage === '产兆前驱') this._advanceProdromal(delta);
    else if (LABOR_STAGES.includes(this.stage)) this._advanceLabor(delta);
    else if (this.isPregnant) this._advancePregnancy(delta);
    else this._advanceMenstrual(delta);
    this.needs = advanceNeeds(this.needs, delta * 24, this.stage);
    this.saveState();
    return this.getPhaseInfo();
  }

  advanceHours(hours = 1) {
    return this.advanceDays((Number(hours) || 0) / 24);
  }

  setHealthTab(tab) {
    this.healthTab = ['cycle', 'needs', 'family'].includes(tab) ? tab : 'cycle';
    this.saveState();
  }

  applyNeed(type) {
    this.needs = applyNeedEvent(this.needs, type);
    this.saveState();
    return describeNeeds(this.needs);
  }

  describeNeeds() {
    return describeNeeds(this.needs);
  }

  addChild(payload = {}) {
    this.lineage = addBirth(this.lineage, { race: this.race, embryoType: this.embryoType, ...payload });
    this.saveState();
    return this.lineage;
  }

  removeChild(id) {
    this.lineage = removeBirth(this.lineage, id);
    this.saveState();
    return this.lineage;
  }

  buildPromptDirective() {
    const info = this.getPhaseInfo();
    const lines = [
      '<Physiological_Status>',
      '【当前角色生理状态 — 只陈述事实，按此描写体征，不要背诵标签】',
      `- 阶段: ${info.phase}（${info.badge}）`,
      `- 种族/胚胎类型: ${info.race} / ${info.embryoType}`,
      `- 基础体温: ${info.bodyTemp}℃`,
      `- 受孕评估: ${info.fertility}`,
      `- 体征: ${info.desc}`,
    ];
    if (info.embryoLore) lines.push(`- 胚胎类型说明: ${info.embryoLore}`);
    if (this.isPregnant || isLaborish(this.stage)) {
      lines.push(`- 孕日: 实际 ${this.pregnantDays.toFixed(1)} 天 / 有效 ${this.effectivePregnantDays.toFixed(1)} 天 / 足月折算 ${this.pregnancyTotalDays.toFixed(1)} 天`);
      lines.push(`- 孕速系数: ${this.gestationSpeed.toFixed(2)}（种族 ${this.raceProfile.gestationSpeciesSpeed} × 修正 ${this.gestationModifier}）`);
      lines.push(`- 胎数: ${this.fetuses.length}`);
      this.fetuses.forEach((f, i) => {
        const tags = describeFetusTags(f.tags).map((t) => t.label).join('、') || '无';
        lines.push(`  · 第${i + 1}胎 ${f.gender} / 种族 ${f.race} / 父源 ${f.fathers} / 标签 ${tags}`);
      });
    }
    if (isLaborish(this.stage)) {
      lines.push(`- 产程: ${this.stage}${this.laborPhase ? '·' + this.laborPhase : ''}，宫缩痛感 ${this.laborPain}/10`);
    }
    const needLines = buildNeedsDirective(this.needs);
    if (needLines) lines.push('- 五维体征:', needLines);
    if (this.lineage.births.length) lines.push(`- 子嗣: 已登记 ${this.lineage.births.length} 人`);
    if (this.lastNotify) lines.push(`- 最近变化: ${this.lastNotify}`);
    lines.push('描写时遵循上述体温、孕周/产程与种族胚胎类型，不要发明未发生的分娩或流产。');
    lines.push('</Physiological_Status>');
    return lines.join('\n');
  }
}

export default HealthData;
