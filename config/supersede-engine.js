/* ========================================================
 * 记忆换代失效 (supersede-engine) — Paramecium「原文是唯一真相」移植
 * 只移植纯规则/确定性算法, 零 LLM:
 *   superseded 矛盾失效: 新记忆与旧记忆高置信冲突/更新时,
 *   旧条目标记 superseded —— 退出排名但不删除(可逆), 手动 pin 的
 *   记忆神圣不可侵犯。哪天旧事实复活了, 旧条目还能解冻。
 * 原则 (源自 Paramecium):
 *   - 原文是唯一真相: 失效只改"是否排得上号", 永不改原文内容
 *   - 机械校验 > 模型自觉: 冲突判定必须基于可复现的词面信号
 *   - 宁可留旧不可丢真: 只有高置信冲突才失效, 低置信静默跳过
 * ======================================================== */
'use strict';

export const SUPERSEDE_STATUS = Object.freeze({
  ACTIVE: 'active',           // 正常参与召回
  SUPERSEDED: 'superseded'    // 已换代: 退出排名, 内容保留可逆
});

// 冲突判定参数
const SIM_ACTIVE_THRESHOLD = 0.55;   // 词面相似 ≥ 此值 → 视作同一事实上下文
const CONFLICT_SUPERSEDE_BIAS = 1.0;    // 新条目重要性 ≥ 旧即可压过 (换代语义)
const MAX_SCAN_POOL = 60;            // 每次 sleep 最多扫描前 N 条长期记忆找冲突
const PROTECTED_FLAG = ['pinned', 'pinnedBy', 'permanent'];

/** 是否受保护 (不可被失效) */
export function isProtected(memory) {
  if (!memory) return false;
  const meta = memory.metadata || {};
  return PROTECTED_FLAG.some(k => meta[k]) || meta.type === 'permanent' ||
         (memory.content && String(memory.content).startsWith('[剧情]'));
}
/**
 * 词集相似度 (0~1)。中文 2-gram 分词, 兼顾短句。
 * 用 overlap coefficient (交集/较小集合): 对长度差异不敏感,
 * 能更好捕捉"共享话题词"(如两句都含「奶茶」)。短句补单字特征。
 */
export function jaccardSimilarity(a, b) {
  const ta = String(a || '');
  const tb = String(b || '');
  if (!ta || !tb) return 0;
    const grams = (s) => {
    const set = new Set();
    const chars = s.replace(/[\u0000-\u001f\u007f\s，。！？、；：""''（）【】《》…—·,.!?;:'"()\[\]{}<>]/g, '').slice(0, 120);
    // 2-gram
    for (let i = 0; i < chars.length - 1; i++) set.add(chars.slice(i, i + 2));
    // 短句补单字特征 (较短文本时 bigram 区分度差; 长句 let 2-gram + 少量单字特征词)
    if (chars.length <= 60) { for (const c of chars) set.add(c); }
    return set;
  };
  const A = grams(ta), B = grams(tb);
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  for (const g of A) if (B.has(g)) inter++;
  const smaller = Math.min(A.size, B.size);
  return smaller > 0 ? inter / smaller : 0;
}


/**
 * 语义锚点冲突: 检测"同一锚点 + 反义立场"。纯规则轻量版:
 * 只有当同一锚点词同时被新旧条目包含, 且新条目含明显的"转变"标记词 + 旧条目含原始立场词,
 * 且二者立场词互为反义时才判定冲突。此表为轻量反义立场组:
 */
// 立场冲突词表。注意: 正则在多次 test 时勿带 g 标志 (lastIndex 副作用)
// neg: 表示"放弃/推翻/离开旧状态"; pos: 表示"持有/接受/留在状态"
const STANCE_CONFLICTS = [
  { anchors: [/奶茶/, /奶/, /茶/], pos: [/喜欢|爱喝|常喝|最爱|又开始|重新喝|又喝|恢复|戒不掉|戒不了/], neg: [/不喝|戒(?!不掉|不了)|戒掉|戒了|戒除|讨厌|换掉|再也不|不敢喝|不能喝/] },
  { anchors: [/住/, /老房子/, /房子/], pos: [/住|住着|定居|住下|住在/],          neg: [/搬走|离开|不住了|搬去|退了|搬离/] },
  { anchors: [/吃/],            pos: [/喜欢吃|爱吃|常吃/],         neg: [/不吃|戒(?!不掉|不了)|戒掉|忌口|不能吃/] },
  { anchors: [/工作/, /上班/],  pos: [/还在|继续做|当前|在做/],      neg: [/辞|离职|不干|换工作|跳槽|失业/] },
  { anchors: [/养/],            pos: [/养|养着|收养/],             neg: [/送走|不养|寄养/] },
  { anchors: [/喜欢|爱/],       pos: [/喜欢|爱上|最爱|心动/],       neg: [/不喜欢|不爱了|讨厌|无感|放弃/] }
];

/**
 * 是否判定为高置信冲突: 旧条目述说一个状态, 新条目推翻/替代它
 * @returns {boolean}
 */
export function isHighConfidenceConflict(oldText, newText) {
  const o = String(oldText || ''), n = String(newText || '');
  if (!o || !n) return false;
  // 先过词面相似度闸门: 完全无关话题不判冲突
  const sim = jaccardSimilarity(o, n);
  if (sim < 0.10) return false; // 话题都不同, 不判冲突
  // 立场冲突检测: 同一锚点 + 旧持正立场 + 新持负立场 (或反向)
  for (const sc of STANCE_CONFLICTS) {
    const hasAnchor = sc.anchors.some(ar => ar.test(o) && ar.test(n));
    if (!hasAnchor) continue;
    const cleanPos = (s) => sc.pos.some(r => r.test(s));
    const cleanNeg = (s) => sc.neg.some(r => r.test(s));
    // 强恢复信号: 新文明确"重新/又喝回" → 即使含过去式"戒了"也应判为正向持有
    const strongRecover = /又重新|重新开始|又喝回|恢复喝|再次喝|又爱上/;
    const oldPos = cleanPos(o) && !cleanNeg(o);   // 负 > 正: 同时命中按负立场算
    const oldNeg = cleanNeg(o);
    const newPos = (cleanPos(n) && !cleanNeg(n)) || (strongRecover.test(n));
    const newNeg = cleanNeg(n) && !strongRecover.test(n);
    // 正→负: 旧持有, 新推翻 (核心换代场景)
    if (oldPos && newNeg) return true;
    // 负→正: 旧已放弃, 新重新持有 (复活场景, 冲突同样成立: 事实已变)
    if (oldNeg && newPos) return true;
    // 强正→强负 (新文明确"不再/已经不用"): 即使旧 pos 弱命中也可判定
    if (oldPos && /已经|现在|如今|后来|其实/.test(n) && newNeg) return true;
  }
  // 强词面覆盖: 新文本真包含旧文本核心 且 含转变标记 → 换代
  const oCore = o.replace(/\s+/g, '').slice(0, 30);
  if (oCore.length >= 6 && n.replace(/\s+/g, '').includes(oCore)) {
    if (/不过|其实|现在|后来|已经|变了|换|改|戒/.test(n)) return true;
  }
  return false;
}
/**
 * 判定新记忆是否应使旧记忆换代 (superseded)
 * 规则:
 *   - 旧受保护(pinned/permanent/剧情) → 永不失效
 *   - 新条目重要性 < 旧×CONFLICT_SUPERSEDE_BIAS → 不足以压过旧 (保留旧, 新条目本身待议)
 *   - 高置信冲突 → 标旧为 superseded
 * @returns {boolean} 是否将 oldMemory 标为 superseded
 */
export function shouldSupersede(oldMemory, newMemory) {
  if (!oldMemory || !newMemory) return false;
  if (isProtected(oldMemory)) return false;
  const oldImportance = oldMemory.importance || oldMemory.metadata?.importance || 5;
  const newImportance = newMemory.importance || newMemory.metadata?.importance || 5;
  if (newImportance < oldImportance * CONFLICT_SUPERSEDE_BIAS) return false;
  const conflict = isHighConfidenceConflict(
    oldMemory.content || oldMemory.summary,
    newMemory.content || newMemory.summary
  );
  return conflict;
}

/**
 * 标记旧条目为 superseded (可逆: 仅填 metadata 标, 不改原文)
 */
export function markSuperseded(oldMemory, newMemory, now = Date.now()) {
  if (!oldMemory) return oldMemory;
  const meta = { ...(oldMemory.metadata || {}) };
  meta._superseded = SUPERSEDE_STATUS.SUPERSEDED;
  meta.supersededBy = newMemory ? (newMemory.id || null) : null;
  meta.supersededAt = new Date(now).toISOString();
  return { ...oldMemory, metadata: meta };
}

/**
 * 解除 superseded 复活: 旧条目重新参与排名
 */
export function reviveMemory(memory, now = Date.now()) {
  if (!memory) return memory;
  const meta = { ...(memory.metadata || {}) };
  delete meta._superseded;
  delete meta.supersededBy;
  delete meta.supersededAt;
  meta._revivedAt = new Date(now).toISOString();
  return { ...memory, metadata: meta };
}

/**
 * 对一批新增记忆做换代扫描: 找出被新记忆压过的旧记忆
 * @param {Array} newEntries  本次新入的记忆条目
 * @param {Array} existing    长期记忆池
 * @returns {{ superseded: Array, kept: Array }} superseded 是被标记的旧条目(已替换到池), kept 是未变化的
 */
export function scanSupersede(newEntries, existing, now = Date.now()) {
  const superseded = [];
  const kept = [];
  if (!Array.isArray(existing) || existing.length === 0) return { superseded, kept };
  if (!Array.isArray(newEntries) || newEntries.length === 0) return { superseded, kept };
  // 扫描池: 优先最近活跃的 (按 lastActive/createdAt 最近的先扫)
  const pool = [...existing]
    .map(m => ({ m, t: (m.metadata?.lastActive || m.createdAt || '').toString().length ? new Date(m.metadata?.lastActive || m.createdAt || now).getTime() : now }))
    .sort((a, b) => b.t - a.t)
    .slice(0, MAX_SCAN_POOL)
    .map(x => x.m);
  for (const ne of newEntries) {
    if (!ne || !ne.content) continue;
    for (const old of pool) {
      if (!old || !old.content) continue;
      // 跳过已墓碑化的 (内容已清空, 无需换代标记); 已 superseded 的允许被更新的状态替换走链
      if (old.metadata?._lifecycle === 'tombstone') continue;
      if (shouldSupersede(old, ne)) {
        const updated = markSuperseded(old, ne, now);
        superseded.push(updated);
        // 在原池中替换
        const idx = existing.indexOf(old);
        if (idx >= 0) existing[idx] = updated;
      }
    }
  }
  kept.push(...existing);
  return { superseded, kept };
}

/**
 * 复活检查: 当某 superseded 条目引用的新条目本身被换代/删除时, 复活旧条目
 * (轻量版: 若 supersededBy 引用的条目已不存在或自身已 superseded, 则复活)
 */
export function reviveSuperseded(memories, now = Date.now()) {
  if (!Array.isArray(memories)) return memories;
  const idSet = new Set(memories.filter(m => m && m.id).map(m => m.id));
  const supersededFlag = (m) => !!(m && m.metadata && m.metadata._superseded === SUPERSEDE_STATUS.SUPERSEDED);
  return memories.map(m => {
    if (!supersededFlag(m)) return m;
    const by = m.metadata?.supersededBy;
    if (by && idSet.has(by) && !supersededFlag(memories.find(x => x && x.id === by))) return m; // 压制方还在, 保持换代
    if (by && idSet.has(by) && supersededFlag(memories.find(x => x && x.id === by))) return reviveMemory(m, now); // 压制方也被换代 → 复活
    if (!by) return m;
    // 压制方消失 → 复活
    return reviveMemory(m, now);
  });
}
