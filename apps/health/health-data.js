/**
 * 健康与生理 App (Health App) - 数据管理模块
 * 汲取自角色生理状态引擎 ver5.49 的精纯 28 天月经周期与性欲波动模型
 * 零外部数据库依赖，持久化保存在 chatMetadata['st_virtual_phone'].health 中
 */

export class HealthData {
  constructor(storage) {
    this.storage = storage;
    this.storageKey = 'ruby_health_cycle';
    this.cycleLength = 28; // 标准 28 天周期
    this.currentCycleDay = 14; // 默认第 14 天 (排卵期附近)
    this.isPregnant = false;
    this.gestationWeeks = 0;
    this.bodyTemp = 36.6;
    this.autoInject = false;
    
    this.loadState();
  }

  loadState() {
    try {
      const raw = this.storage?.get?.(this.storageKey);
      if (raw) {
        const d = typeof raw === 'string' ? JSON.parse(raw) : raw;
        if (typeof d.cycleDay === 'number') this.currentCycleDay = d.cycleDay;
        if (typeof d.isPregnant === 'boolean') this.isPregnant = d.isPregnant;
        if (typeof d.gestationWeeks === 'number') this.gestationWeeks = d.gestationWeeks;
        if (typeof d.autoInject === 'boolean') this.autoInject = d.autoInject;
        if (typeof d.bodyTemp === 'number') this.bodyTemp = d.bodyTemp;
      }
    } catch (e) {
      console.warn('[HealthData] 加载生理状态失败:', e);
    }
  }

  saveState() {
    try {
      const data = {
        cycleDay: this.currentCycleDay,
        isPregnant: this.isPregnant,
        gestationWeeks: this.gestationWeeks,
        bodyTemp: this.bodyTemp,
        autoInject: this.autoInject,
        updatedAt: Date.now()
      };
      this.storage?.set?.(this.storageKey, data);
    } catch (e) {
      console.warn('[HealthData] 保存生理状态失败:', e);
    }
  }

  /**
   * 获取当前周期阶段 (5.49 标准模型)
   */
  getPhaseInfo() {
    const day = ((this.currentCycleDay - 1) % this.cycleLength) + 1;
    if (this.isPregnant) {
      return {
        phase: '妊娠期',
        color: '#f43f5e',
        badge: `孕 ${this.gestationWeeks} 周`,
        desc: '体内激素水平维持高位，体温略高，易产生轻度嗜睡或晨起反应。',
        fertility: '无受孕可能 (已妊娠)',
        arousalLevel: '敏感波动'
      };
    }

    if (day <= 5) {
      return {
        phase: '月经期',
        color: '#ef4444',
        badge: `经期 第 ${day} 天`,
        desc: '子宫内膜脱落，伴随轻微腹胀或疲倦。情绪偏向需要呵护与陪伴，对生冷刺激抗拒。',
        fertility: '极低 (安全期)',
        arousalLevel: '性欲低落 (敏感需要安抚)'
      };
    } else if (day <= 12) {
      return {
        phase: '卵泡期',
        color: '#ec4899',
        badge: `卵泡期 第 ${day} 天`,
        desc: '雌激素水平回升，精力充沛，皮肤通透，心情轻快愉悦。',
        fertility: '偏低逐渐转高',
        arousalLevel: '自然平稳'
      };
    } else if (day <= 16) {
      return {
        phase: '排卵期 (高危易孕)',
        color: '#a855f7',
        badge: `排卵日附近 (第 ${day} 天)`,
        desc: '宫颈黏液清亮滑润，基础体温略微升高 0.3-0.5℃。性本能极其敏锐，触觉与嗅觉放大。',
        fertility: '极高 (极易受孕⚠️)',
        arousalLevel: '达到峰值 (渴望亲密与充盈)'
      };
    } else {
      return {
        phase: '黄体期',
        color: '#f59e0b',
        badge: `黄体期 第 ${day} 天`,
        desc: '孕激素占主导，基础体温处于高相期。情绪趋于内敛稳定，食欲轻度增加。',
        fertility: '低 (黄体安全期)',
        arousalLevel: '温和沉静'
      };
    }
  }

  /**
   * 推进周期天数 (支持按剧情时间自然推进)
   */
  advanceDays(days = 1) {
    if (this.isPregnant) {
      // 妊娠状态按天数折算周
      return;
    }
    this.currentCycleDay = ((this.currentCycleDay - 1 + days) % this.cycleLength) + 1;
    this.saveState();
  }

  setDay(day) {
    this.currentCycleDay = Math.max(1, Math.min(this.cycleLength, parseInt(day, 10) || 1));
    this.saveState();
  }

  togglePregnancy(pregnant, weeks = 4) {
    this.isPregnant = !!pregnant;
    this.gestationWeeks = weeks;
    this.saveState();
  }

  /**
   * 构建注入给大模型的生理状态上下文指引
   */
  buildPromptDirective() {
    const info = this.getPhaseInfo();
    return `<Physiological_Status>\n【当前角色生理状态与体征基准】\n- 当前阶段: ${info.phase} (${info.badge})\n- 受孕可能: ${info.fertility}\n- 身体特质: ${info.desc}\n- 敏感情绪: ${info.arousalLevel}\n在接下来的亲密接触或生活描写中，细腻体现上述体温、润滑度、触感敏感度与情绪起伏，避免违背生理常理。\n</Physiological_Status>`;
  }
}
