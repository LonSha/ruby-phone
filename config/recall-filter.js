/* ========================================================
 * 记忆召回过滤 (Memory Constellations 设计移植)
 * 只移植纯规则/确定性算法, 零 LLM:
 *   1. 分段衰减排序: 3 天内新鲜度主导, 之后情感强度主导
 *   2. 回忆权限分级: 可引用(cite) / 需谨慎(cautious) / 仅联想(associate-only)
 *   3. 生命周期冷却: active→cooling→frozen→tombstone 分级清理, 访问重置
 * 原则 (源自 MemoryConstellations):
 *   - 双通道命中 + 较新 → 可引用; 单通道或较旧 → 需谨慎; 很旧或随机 → 仅联想
 *   - 低分静默丢弃: 宁可禁声不乱丢
 *   - 行为/重要记忆的强度只增不减, 新鲜度独立控制注入优先级
 * ======================================================== */
'use strict';

export const RECALL_PERMISSION = Object.freeze({
  CITE: 'cite',
  CAUTIOUS: 'cautious',
  ASSOCIATE: 'associate-only'
});
export const PERMISSION_LABEL = Object.freeze({
  'cite': '可引用',
  'cautious': '需谨慎',
  'associate-only': '仅联想'
});

// 分段衰减参数 (源自 MemoryConstellations 检索设计)
const FRESH_DAYS = 3;
const FRESH_FRESHNESS_WEIGHT = 0.7;   // 3天内: 新鲜度主导
const FRESH_EMOTION_WEIGHT = 0.3;
const OLD_EMOTION_WEIGHT = 0.7;       // 3天后: 情感强度主导
const OLD_FRESHNESS_WEIGHT = 0.3;
const SCORE_FLOOR = 0.005;            // 低于此分静默丢弃

/**
 * 分段衰减得分: 融合 新鲜度(距最后活跃) 与 情感强度(arousal)
 * 与 memory-engine.calculateDecayScore 不同: 显式分段切换主导因子
 */
export function segmentedRecallScore(memory, now = Date.now()) {
  if (!memory) return 0;
  const meta = memory.metadata || {};
  const lastActive = meta.lastActive ? new Date(meta.lastActive).getTime() : (memory.createdAt ? new Date(memory.createdAt).getTime() : now);
  const days = Math.max(0, (now - lastActive) / 86400000);
  // 新鲜度: 指数衰减, 半衰 48h
  const freshness = Math.exp(-days / 2);
  // 情感强度: arousal (0~1)
  const arousal = (memory.emotion && memory.emotion.arousal) || (meta.arousal) || 0.5;
  // 重要性 (1~10)
  const importance = meta.importance || memory.importance || 5;
  const fresh = days <= FRESH_DAYS;
  const weight = fresh
    ? freshness * FRESH_FRESHNESS_WEIGHT + arousal * FRESH_EMOTION_WEIGHT
    : freshness * OLD_FRESHNESS_WEIGHT + arousal * OLD_EMOTION_WEIGHT;
  const score = (importance / 10) * (0.4 + weight);
  return score;
}

/**
 * 回忆权限分级 (确定性, 非 LLM)
 * 双通道命中(srcHits>=2) + <30天 → 可引用
 * 单通道或 30~90 天 → 需谨慎
 * >90 天 → 仅联想
 */
export function permissionFor(memory, channelHits = 1, now = Date.now()) {
  if (!memory) return RECALL_PERMISSION.ASSOCIATE;
  const meta = memory.metadata || {};
  const lastActive = meta.lastActive ? new Date(meta.lastActive).getTime() : (memory.createdAt ? new Date(memory.createdAt).getTime() : now);
  const days = Math.max(0, (now - lastActive) / 86400000);
  if (channelHits >= 2 && days < 30) return RECALL_PERMISSION.CITE;
  if (days >= 30 && days <= 90) return RECALL_PERMISSION.CAUTIOUS;
  if (days > 90) return RECALL_PERMISSION.ASSOCIATE;
  return RECALL_PERMISSION.CAUTIOUS;
}

/**
 * 对召回结果统一打权限标签 + 分段衰减排序 + 过滤低分
 * @param {Array} results [{content, _score, layer, emotion, ...}]
 * @param {Object} options { channelHits: 每个条目命中通道数(map or fn), topN }
 */
export function decorateRecall(results, options = {}) {
  const now = Date.now();
  const chFn = options.channelHits || (() => 1);
  const ranked = [];
  for (const r of results) {
    if (!r || !r.content) continue;
    const per = permissionFor(r, chFn(r), now);
    const seg = segmentedRecallScore(r, now);
    const finalScore = (typeof r._score === 'number' ? r._score : 0) + seg;
    if (finalScore < SCORE_FLOOR) continue; // 低分静默丢弃
    ranked.push({
      ...r,
      _score: finalScore,
      _permission: per,
      permissionLabel: PERMISSION_LABEL[per]
    });
  }
  ranked.sort((a, b) => (b._score || 0) - (a._score || 0));
  const topN = options.topN || 8;
  return ranked.slice(0, topN);
}

// ── 生命周期冷却 (源自 MemoryConstellations lifecycle) ────────────────────────
export const LIFECYCLE = Object.freeze({
  ACTIVE: 'active',       // 活跃, 正常注入
  COOLING: 'cooling',     // 降温, 降低注入优先级
  FROZEN: 'frozen',       // 冻结, 仅检索但不注入
  TOMBSTONE: 'tombstone'  // 墓碑, 内容清空仅存引用
});
const ACTIVE_DAYS = 14;
const COOLING_DAYS = 30;
const FROZEN_DAYS = 90;

export function lifecycleStage(memory, now = Date.now()) {
  if (!memory) return LIFECYCLE.TOMBSTONE;
  if (memory._lifecycle === LIFECYCLE.TOMBSTONE) return LIFECYCLE.TOMBSTONE;
  const meta = memory.metadata || {};
  // 受保护条目 (pinned/permanent/手动收藏) 永远处于 active, 不被冷却/冻结/墓碑
  if (meta.pinned || meta.pinnedBy || meta.permanent || meta.type === 'permanent' || (memory.content && memory.content.startsWith('[剧情]'))) {
    return LIFECYCLE.ACTIVE;
  }
  const lastAccess = meta.lastActive ? new Date(meta.lastActive).getTime() : (memory.createdAt ? new Date(memory.createdAt).getTime() : now);
  const days = Math.max(0, (now - lastAccess) / 86400000);
  if (days > FROZEN_DAYS) return LIFECYCLE.TOMBSTONE;   // >90天 → 墓碑(清空)
  if (days > COOLING_DAYS) return LIFECYCLE.FROZEN;     // 30-90天 → 冻结
  if (days > ACTIVE_DAYS) return LIFECYCLE.COOLING;     // 14-30天 → 冷却
  return LIFECYCLE.ACTIVE;
}

/**
 * 生命周期清理: 返回 { active, cooling, frozen, tombstoned }
 * - active: 保留且正常注入
 * - cooling: 保留但注入降权
 * - frozen: 内容保留但不注入 (仅可被检索)
 * - tombstone: 超过墓碑期且非 pinned/permanent → 内容清空, 保留最小引用
 * 访问重置: lastActive 更新的条目自动回到 active (调用方负责在访问时更新 lastActive)
 */
export function pruneByLifecycle(memories, now = Date.now()) {
  const result = { active: [], cooling: [], frozen: [], tombstoned: [] };
  for (const m of memories || []) {
    if (!m || !m.content) { result.tombstoned.push(m); continue; }
    const meta = m.metadata || {};
    const protectedFlag = meta.pinned || meta.permanent || meta.type === 'permanent';
    const stage = lifecycleStage(m, now);
    if (stage === LIFECYCLE.TOMBSTONE && !protectedFlag) {
      // 墓碑化: 仅保留剪影
      const tomb = { ...m, content: '', metadata: { ...meta, tombstonedAt: new Date(now).toISOString(), _lifecycle: LIFECYCLE.TOMBSTONE } };
      result.tombstoned.push(tomb);
      continue;
    }
    const tagged = { ...m, metadata: { ...meta, _lifecycle: stage || LIFECYCLE.ACTIVE } };
    if (stage === LIFECYCLE.FROZEN) result.frozen.push(tagged);
    else if (stage === LIFECYCLE.COOLING) result.cooling.push(tagged);
    else result.active.push(tagged);
  }
  return result;
}