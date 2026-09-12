/* ========================================================
 * 万象·积分系统 (Phosphene 核心算法接入层)
 * 负责: 积分账本存取 / 连击推进 / 成就解锁 / 统计
 * 底层算法来自 config/points-engine.js (纯规则零 LLM)
 * ======================================================== */
'use strict';

import {
  rewardForTask,
  penaltyFor,
  streakBonusForDay,
  advanceStreak,
  evaluateAchievements,
  addLedgerEntry,
  currentBalance,
  totalEarned,
  totalSpent,
  totalPenalties,
  computeStreakFromDates,
  todayStr,
  ACHIEVEMENT_DEFS,
} from '../../config/points-engine.js';

const LEDGER_KEY = 'wangxiang_points_ledger_v1';
const DAILY_KEY = 'wangxiang_points_daily_v1';
const STATS_KEY = 'wangxiang_points_stats_v1';

export class PointsLedger {
  constructor(storage) {
    this.storage = storage;
    this.ledger = this._loadList(LEDGER_KEY);
    this.daily = this._loadObject(DAILY_KEY, { date: null, streak: 0, penaltyUsedToday: 0 });
    this.stats = this._loadObject(STATS_KEY, {
      completedTasks: 0, longestStreak: 0, activeDays: 0,
      byType: {}, byDifficulty: {}, totalCompletedDates: [], totalEarned: 0,
      redemptions: 0, unlocked: []
    });
    this._reconcileDaily();
  }

  _loadList(key) {
    try {
      const raw = this.storage?.get?.(key);
      if (Array.isArray(raw)) return raw;
      if (typeof raw === 'string') { const d = JSON.parse(raw); if (Array.isArray(d)) return d; }
    } catch (e) { /* 忽略 */ }
    return [];
  }

  _loadObject(key, fallback) {
    try {
      const raw = this.storage?.get?.(key);
      if (raw && typeof raw === 'object') return { ...fallback, ...raw };
      if (typeof raw === 'string') { const d = JSON.parse(raw); if (d && typeof d === 'object') return { ...fallback, ...d }; }
    } catch (e) { /* 忽略 */ }
    return { ...fallback };
  }

  _saveList(key, list) {
    try {
      if (Array.isArray(list) && (this.storage?.set)) this.storage.set(key, list);
    } catch (e) { /* 忽略 */ }
  }

  _saveObject(key, obj) {
    try {
      if (obj && typeof obj === 'object' && this.storage?.set) this.storage.set(key, obj);
    } catch (e) { /* 忽略 */ }
  }

  _persist() {
    this._saveList(LEDGER_KEY, this.ledger);
    this._saveObject(DAILY_KEY, this.daily);
    this._saveObject(STATS_KEY, this.stats);
  }

  // 每日滚动: 跨天重置 penalty 计数, 连击从完成日期重算
  _reconcileDaily() {
    const today = todayStr();
    if (this.daily.date !== today) {
      // 从历史完成日期重算连击 (而不是保留旧值, 支持冷启动/跨会话)
      const streakInfo = computeStreakFromDates(this.stats.totalCompletedDates || []);
      const last = [...(this.stats.totalCompletedDates || [])].sort().at(-1) || null;
      // 若最后完成是今天或昨天, 连击延续; 否则已断签归 1
      let ongoing = false;
      if (last) {
        const da = new Date(last + 'T00:00:00Z');
        const db = new Date(today + 'T00:00:00Z');
        ongoing = last === today || Math.round((db - da) / 86400000) === 1;
      }
      this.daily = {
        date: today,
        streak: ongoing ? Math.max(streakInfo.currentStreak, 1) : 1,
        penaltyUsedToday: 0
      };
      this._saveObject(DAILY_KEY, this.daily);
      this._recomputeStats();
    }
  }

  _recomputeStats() {
    const dates = this.stats.totalCompletedDates || [];
    const streakInfo = computeStreakFromDates(dates);
    const byType = {};
    const byDifficulty = {};
    for (const d of dates) { /* type/diff 在 addCompletion 时统计 */ }
    this.stats.longestStreak = Math.max(this.stats.longestStreak || 0, streakInfo.longestStreak);
    this.stats.activeDays = streakInfo.activeDays;
    this.stats.totalEarned = totalEarned(this.ledger);
    this._evalAchievements();
    this._saveObject(STATS_KEY, this.stats);
  }

  _evalAchievements() {
    const unlocked = evaluateAchievements({
      completedTasks: this.stats.completedTasks || 0,
      longestStreak: this.stats.longestStreak || 0,
      activeDays: this.stats.activeDays || 0,
      byDifficulty: this.stats.byDifficulty || {},
      byType: this.stats.byType || {},
      totalEarned: this.stats.totalEarned || 0,
      redemptions: this.stats.redemptions || 0,
    });
    const existing = new Set((this.stats.unlocked || []).map(u => u.id));
    const fresh = unlocked.filter(u => !existing.has(u.id));
    if (fresh.length) {
      this.stats.unlocked = unlocked;
      this._saveObject(STATS_KEY, this.stats);
      return fresh;
    }
    return [];
  }

  /** 任务完成: 加基础奖励 + 连击奖励, 记录流水 */
  completeTask(task = {}) {
    this._reconcileDaily();
    const reward = rewardForTask(task);
    const today = todayStr();
    // 连击推进
    const prevDate = this.stats.totalCompletedDates?.length
      ? [...this.stats.totalCompletedDates].sort().at(-1)
      : null;
    this.daily.streak = advanceStreak(today, prevDate, this.daily.streak || 0);
    let total = reward;
    if (this.daily.streak >= 2) {
      const bonus = streakBonusForDay(this.daily.streak);
      if (bonus > 0) {
        this.ledger = addLedgerEntry(this.ledger, {
          type: 'streak_bonus', amount: bonus,
          reason: `Day ${this.daily.streak} 连击奖励`, date: today,
          key: `streak-bonus:${today}:${this.daily.streak}`
        });
        total += bonus;
      }
    }
    this.ledger = addLedgerEntry(this.ledger, {
      type: 'task_reward', amount: reward,
      reason: `完成任务 ${task.title || ''}`.trim(), taskId: task.id, date: today,
      key: `task-reward:${task.id}`
    });
    // 统计
    this.stats.completedTasks = (this.stats.completedTasks || 0) + 1;
    if (!this.stats.totalCompletedDates) this.stats.totalCompletedDates = [];
    this.stats.totalCompletedDates.push(today);
    if (this.stats.totalCompletedDates.length > 1000) this.stats.totalCompletedDates = this.stats.totalCompletedDates.slice(-1000);
    const type = task.type || 'daily';
    const diff = task.difficulty || 'easy';
    this.stats.byType[type] = (this.stats.byType[type] || 0) + 1;
    this.stats.byDifficulty[diff] = (this.stats.byDifficulty[diff] || 0) + 1;
    this._persist();
    const freshAch = this._evalAchievements();
    return { reward, streak: this.daily.streak, streakBonus: Math.max(0, total - reward), total, achievements: freshAch };
  }

  /** 任务失败: 扣罚 (余额+日限双重约束) */
  failTask(task = {}) {
    this._reconcileDaily();
    const balance = currentBalance(this.ledger);
    const actual = penaltyFor(task, balance, this.daily.penaltyUsedToday || 0, 50);
    if (actual > 0) {
      this.ledger = addLedgerEntry(this.ledger, {
        type: 'task_penalty', amount: -actual,
        reason: `任务未完成惩罚 ${task.title || ''}`.trim(), taskId: task.id, date: todayStr(),
        key: `task-penalty:${task.id}`
      });
      this.daily.penaltyUsedToday = (this.daily.penaltyUsedToday || 0) + actual;
      this._persist();
    }
    return actual;
  }

  /** 兑换奖励: 扣积分 + 记录 */
  redeem(item = {}) {
    this._reconcileDaily();
    const cost = Math.max(0, Math.floor(Number(item.cost) || 0));
    const balance = currentBalance(this.ledger);
    if (cost > balance) return { ok: false, reason: '积分不足', balance };
    this.ledger = addLedgerEntry(this.ledger, {
      type: 'redemption', amount: -cost,
      reason: `兑换 ${item.name || '奖励'}`.trim(), date: todayStr(),
      key: `redemption:${item.id || Date.now()}`
    });
    this.stats.redemptions = (this.stats.redemptions || 0) + 1;
    this._persist();
    const freshAch = this._evalAchievements();
    return { ok: true, balance: currentBalance(this.ledger), achievements: freshAch };
  }

  getBalance() { return currentBalance(this.ledger); }
  getLedger() { return [...this.ledger]; }
  getStats() {
    this._recomputeStats();
    return { ...this.stats };
  }
  getDaily() { return { ...this.daily }; }
  getAchievementDefs() { return ACHIEVEMENT_DEFS.map(a => ({ ...a })); }
}

export default PointsLedger;