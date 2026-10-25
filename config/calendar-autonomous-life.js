/* ========================================================
 * config/calendar-autonomous-life.js
 * 
 * RubyPhone 第十期核心前沿拓展 (R10-X8)
 * 智能生活日程管家与自驱生活事件发生器 (Autonomous Calendar & Spontaneous Life Engine)
 * 
 * 核心特性：
 * 1. 结构化日程管理与时段冲突检测 (Overlap & Conflict Resolution)
 * 2. 角色自驱生活事件生成器 (NPC-Driven Spontaneous Life Events, 基于角色关系与情境)
 * 3. 动态日程提醒与临近触发 (Proximity Alerts & Notification Trigger)
 * 4. 履约与违约状态机 (Pending -> Active -> Completed / Flaked，违约反噬人际好感)
 * ======================================================== */

export const EVENT_CATEGORIES = {
  DATE: 'date',           // 约会/情感
  WORK: 'work',           // 工作/剧情推进
  SOCIAL: 'social',       // 聚会/社交
  ROUTINE: 'routine',     // 日常作息
  EMERGENCY: 'emergency'  // 突发紧急事件
};

export const EVENT_STATUS = {
  SCHEDULED: 'scheduled',
  IN_PROGRESS: 'in_progress',
  COMPLETED: 'completed',
  FLAKED: 'flaked',       // 鸽约/未履约
  CANCELLED: 'cancelled'
};

export class CalendarAutonomousLifeEngine {
  constructor(options = {}) {
    this.events = [];
    this.pendingNotifications = [];
    this.lifeTriggers = options.triggers || [];
    this.punctualityRate = 1.0; // 守约率
  }

  /**
   * 添加日程事件并检查时间冲突
   */
  addEvent(event) {
    if (!event.id) event.id = 'evt_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
    if (!event.status) event.status = EVENT_STATUS.SCHEDULED;

    // 冲突检测
    const conflicts = this.detectConflicts(event.startTime, event.endTime, event.id);
    const hasCriticalConflict = conflicts.length > 0 && ((event.category === EVENT_CATEGORIES.EMERGENCY || event.category === EVENT_CATEGORIES.DATE) || conflicts.some(c => c.category === EVENT_CATEGORIES.EMERGENCY || c.category === EVENT_CATEGORIES.DATE));

    this.events.push({
      ...event,
      createdAt: Date.now()
    });

    return {
      success: true,
      event,
      hasConflict: conflicts.length > 0,
      conflicts,
      criticalWarning: hasCriticalConflict ? '检测到核心约会或紧急事件时段冲突！' : (conflicts.length > 0 ? '检测到日程安排时段重叠' : null)
    };
  }

  /**
   * 检测时段重叠冲突
   */
  detectConflicts(startTime, endTime, excludeId = null) {
    return this.events.filter(e => {
      if (e.id === excludeId) return false;
      if (e.status === EVENT_STATUS.CANCELLED || e.status === EVENT_STATUS.COMPLETED || e.status === EVENT_STATUS.FLAKED) return false;
      // 重叠区间判定: max(start1, start2) < min(end1, end2)
      return Math.max(e.startTime, startTime) < Math.min(e.endTime, endTime);
    });
  }

  /**
   * 角色自驱生活事件生成 (NPC 依据关系、好感度与当前情绪主动邀约或突发拜访)
   */
  generateSpontaneousEvent(npcId, npcAffinity = 50, currentAtmosphere = 'clear', currentTime = Date.now()) {
    let category = EVENT_CATEGORIES.ROUTINE;
    let title = '';
    let duration = 3600 * 1000; // 默认1小时
    let impactDelta = 0;

    if (npcAffinity >= 80) {
      category = EVENT_CATEGORIES.DATE;
      title = `${npcId} 发起的深夜专属邀约`;
      impactDelta = 5;
    } else if (currentAtmosphere === 'rain' || currentAtmosphere === 'storm') {
      category = EVENT_CATEGORIES.EMERGENCY;
      title = `${npcId} 突发的雨夜送伞与避雨求助`;
      impactDelta = 3;
    } else if (npcAffinity < 30) {
      category = EVENT_CATEGORIES.SOCIAL;
      title = `${npcId} 礼节性公事会面`;
      impactDelta = 1;
    } else {
      category = EVENT_CATEGORIES.SOCIAL;
      title = `${npcId} 邀请你共进下午茶`;
      impactDelta = 2;
    }

    const spontaneous = {
      id: 'spont_' + Date.now(),
      title,
      category,
      npcId,
      startTime: currentTime + 1800 * 1000, // 30分钟后开始
      endTime: currentTime + 1800 * 1000 + duration,
      status: EVENT_STATUS.SCHEDULED,
      affinityReward: impactDelta,
      flakedPenalty: -Math.abs(impactDelta * 2) // 鸽约双倍扣除
    };

    const addRes = this.addEvent(spontaneous);
    return {
      event: spontaneous,
      conflictNotice: addRes.criticalWarning,
      requiresAcceptance: true
    };
  }

  /**
   * 履约/结算判定
   */
  resolveEvent(eventId, action = 'complete') {
    const evt = this.events.find(e => e.id === eventId);
    if (!evt) return { success: false, error: '事件不存在' };

    if (action === 'complete') {
      evt.status = EVENT_STATUS.COMPLETED;
      return {
        success: true,
        status: evt.status,
        affinityDelta: evt.affinityReward || 1,
        message: '准时赴约并圆满完成日程'
      };
    } else if (action === 'flake') {
      evt.status = EVENT_STATUS.FLAKED;
      this.punctualityRate = Math.max(0, this.punctualityRate - 0.1);
      return {
        success: true,
        status: evt.status,
        affinityDelta: evt.flakedPenalty || -5,
        message: '未能按时赴约，好感度下降'
      };
    } else if (action === 'cancel') {
      evt.status = EVENT_STATUS.CANCELLED;
      return {
        success: true,
        status: evt.status,
        affinityDelta: 0,
        message: '日程已提前取消'
      };
    }

    return { success: false, error: '无效结算动作' };
  }

  /**
   * 扫描临近日程并生成系统提醒
   * @param {number} currentTime 当前时间戳
   * @param {number} advanceMs 提前通知毫秒数 (默认15分钟)
   */
  scanUpcomingAlerts(currentTime, advanceMs = 900000) {
    const alerts = [];
    this.events.forEach(evt => {
      if (evt.status !== EVENT_STATUS.SCHEDULED) return;
      if (evt.notified) return;

      const timeUntil = evt.startTime - currentTime;
      if (timeUntil > 0 && timeUntil <= advanceMs) {
        evt.notified = true;
        alerts.push({
          eventId: evt.id,
          title: `日程提醒：${evt.title}`,
          content: `将在 ${Math.ceil(timeUntil / 60000)} 分钟后开始，请做好准备。`,
          category: evt.category,
          urgency: evt.category === EVENT_CATEGORIES.EMERGENCY ? 'URGENT' : 'NORMAL'
        });
      }
    });

    return alerts;
  }
}
