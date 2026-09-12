/* ========================================================
 * 积分引擎 (Phosphene 任务/积分/连击/成就 核心算法移植)
 * SPDX: 参考 3lmglow/Phosphene (MIT)
 * 只移植纯规则/确定性算法, 零 LLM:
 *   1. 难度倍率: easy=1 / medium=2 / hard=3
 *   2. 完成奖励: basePoints × 难度倍率
 *   3. 连击奖励: streak 2-5→+1, 6-7→+2, ≥8→+3 (每日一算, 断签清零)
 *   4. 失败惩罚: ceil(reward×0.5), 受余额+每日限额双重约束
 *   5. 成就解锁: 累计阈值(完成数/最长连击/活跃天数/困难任务等)
 *   6. 积分流水: 不可变账本(type/amount/reason/date), 余额=sum(amount)
 * ======================================================== */
'use strict';

export const DIFFICULTY_MULTIPLIER = Object.freeze({ easy: 1, medium: 2, hard: 3 });
export const TASK_TYPES = Object.freeze(['daily', 'challenge', 'surprise']);
export const DIFFICULTIES = Object.freeze(['easy', 'medium', 'hard']);

// 连击奖励: 天数 → 奖励分 (Phosphene streakBonusForDay)
export function streakBonusForDay(streak) {
  const s = Math.max(1, Math.floor(Number(streak) || 1));
  if (s >= 8) return 3;
  if (s >= 6) return 2;
  if (s >= 2) return 1;
  return 0;
}

export function rewardForTask(task = {}) {
  const base = Math.max(0, Math.floor(Number(task.basePoints) || 0));
  const diff = DIFFICULTY_MULTIPLIER[task.difficulty] || 1;
  return base * diff;
}

// 失败惩罚: ceil(reward × 0.5), 受余额 + 每日限额约束
// @returns 实际扣分
export function penaltyFor(task = {}, balance = 0, dailyUsed = 0, dailyLimit = Infinity) {
  const requested = Math.ceil(rewardForTask(task) * 0.5);
  const availableByBoundary = Math.max(0, dailyLimit - dailyUsed);
  return Math.min(requested, Math.max(0, Math.floor(balance)), availableByBoundary);
}

// 农历/日常连击推进: 传入今天日期(yyyy-mm-dd)与前一条完成日期, 返回新连击数
export function advanceStreak(today, previousDate, currentStreak) {
  if (!previousDate) return 1;
  const diff = dayDiff(today, previousDate);
  if (diff === 1) return currentStreak + 1;
  if (diff === 0) return currentStreak; // 同一天多条不重复加
  return 1; // 断签
}

function dayDiff(a, b) {
  const da = new Date(a + 'T00:00:00Z');
  const db = new Date(b + 'T00:00:00Z');
  return Math.round((da - db) / 86400000);
}

// 成就定义与判断
export const ACHIEVEMENT_DEFS = [
  { id: 'first_light', name: '初光', category: 'completed', threshold: 1, desc: '完成第一件任务' },
  { id: 'steady', name: '稳步', category: 'completed', threshold: 10, desc: '累计完成 10 件任务' },
  { id: 'seasoned', name: '熟手', category: 'completed', threshold: 50, desc: '累计完成 50 件任务' },
  { id: 'week_streak', name: '一周之约', category: 'streak', threshold: 7, desc: '连击达到 7 天' },
  { id: 'month_streak', name: '月月有约', category: 'streak', threshold: 30, desc: '连击达到 30 天' },
  { id: 'ten_active', name: '十日谈', category: 'active_days', threshold: 10, desc: '累计活跃 10 天' },
  { id: 'habit', name: '习惯成自然', category: 'active_days', threshold: 30, desc: '累计活跃 30 天' },
  { id: 'hard_one', name: '硬骨头', category: 'hard', threshold: 1, desc: '完成 1 件困难任务' },
  { id: 'challenge_one', name: '挑战者', category: 'challenge', threshold: 1, desc: '完成 1 件挑战任务' },
  { id: 'rich', name: '小富婆', category: 'earned', threshold: 200, desc: '累计赚取 200 积分' },
  { id: 'philanthropist', name: '慷慨', category: 'redemptions', threshold: 1, desc: '兑现 1 次奖励' },
];

// 统计指标 → 解锁成就
export function evaluateAchievements(stats = {}) {
  const metrics = {
    completed: Number(stats.completedTasks || 0),
    streak: Number(stats.longestStreak || 0),
    active_days: Number(stats.activeDays || 0),
    hard: Number(stats.byDifficulty?.hard || 0),
    challenge: Number(stats.byType?.challenge || 0),
    surprise: Number(stats.byType?.surprise || 0),
    earned: Number(stats.totalEarned || 0),
    redemptions: Number(stats.redemptions || 0),
  };
  const unlocked = [];
  for (const def of ACHIEVEMENT_DEFS) {
    if ((metrics[def.category] || 0) >= def.threshold) unlocked.push({ ...def });
  }
  return unlocked;
}

// ── 积分流水账本 (不可变) ──────────────────────────────────────────────────────
export function addLedgerEntry(ledger, entry) {
  if (!Array.isArray(ledger)) ledger = [];
  const amount = Math.round(Number(entry.amount) || 0);
  if (amount === 0) return ledger;
  return [{
    id: entry.key || ('ledger-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6)),
    type: entry.type || 'task_reward',
    amount,
    reason: entry.reason || '',
    taskId: entry.taskId || null,
    date: entry.date || todayStr(),
    key: entry.key || null,
  }, ...ledger];
}

export function currentBalance(ledger) {
  return (Array.isArray(ledger) ? ledger : []).reduce((sum, row) => sum + Math.round(Number(row.amount) || 0), 0);
}

export function totalEarned(ledger) {
  return (Array.isArray(ledger) ? ledger : []).reduce((sum, row) => sum + Math.max(0, Math.round(Number(row.amount) || 0)), 0);
}

export function totalSpent(ledger) {
  return (Array.isArray(ledger) ? ledger : []).filter(row => row.type === 'redemption').reduce((sum, row) => sum - Math.round(Number(row.amount) || 0), 0);
}

export function totalPenalties(ledger) {
  return (Array.isArray(ledger) ? ledger : []).filter(row => row.type === 'task_penalty' || row.type === 'manual_penalty').reduce((sum, row) => sum - Math.round(Number(row.amount) || 0), 0);
}

// 按日期聚合连击数据 (适合每日结算)
export function computeStreakFromDates(completionDates) {
  const dates = [...new Set((Array.isArray(completionDates) ? completionDates : [])
    .map(d => String(d || '').slice(0, 10).trim())
    .filter(Boolean))].sort();
  let streak = 0;
  let longest = 0;
  let prev = null;
  for (const date of dates) {
    streak = prev && dayDiff(date, prev) === 1 ? streak + 1 : 1;
    longest = Math.max(longest, streak);
    prev = date;
  }
  return { currentStreak: dates.length ? streak : 0, longestStreak: longest, activeDays: dates.length };
}

export function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}