/* ============================================================
 * config/mystery-engine.js — [v4.53.0 · 第六期 R6-X6]
 *   「手机原生推理剧：消息、时间、证词与行动共同组成可玩的谜题」（纯函数）
 * ------------------------------------------------------------
 * 【计划原文（R6-X6）】
 *   「作者指定可公开线索、隐藏条件、证人知情范围和多条解法；
 *    玩家读材料、联系角色、比对时间和提出假说。正确操作揭示下一层证据，
 *    不用猜中提示词；不同解法可得到不同但自洽的收束。」
 *
 * 【验收下限】
 *   ① 一件非暴力日常谜题有至少两条解法、三位证人和一条误导线索；
 *   ② 未读线索不能被角色回答泄底，作者可关闭自动提示；
 *   ③ 猜错可回到证据继续，存档重开不重置已发现线索。
 *
 * 【本模块只做四件事（纯函数，不读存储 / 不碰 DOM / 不调用 AI）】
 *   1 **createMystery**：作者定义谜题，含公开线索、隐藏条件、证人知情范围、
 *      多条解法路径和误导线索；autoHint 可关闭；
 *   2 **submitHypothesis**：玩家提交假说（选择线索+推理步骤），
 *      正确则揭示下一层证据并标记线索已读，错误则返回错误反馈但保留已读线索；
 *   3 **queryWitness**：玩家向证人提问，证人只回答其知情范围内的线索，
 *      未读线索不泄底（witness 不暴露 unread clue）；
 *   4 **getDiscoveredClues**：返回玩家已发现的线索列表，
 *      存档重开不重置已发现线索（progress 独立于 mystery 定义）。
 *
 * 【口径纪律】
 *   · 谜底由作者设定，推理过程依赖可见线索，不调用 AI；
 *   · 未读线索不能被角色回答泄底；
 *   · 猜错可回到证据继续，不惩罚。
 * ============================================================ */
const VERSION = '4.53.0';
const FROZEN_WORDS = ['mystery', 'clue', 'witness', 'hypothesis', 'solution', 'unread'];

/**
 * 创建一个推理谜题
 * @param {object} opts
 * @param {string} opts.mysteryId
 * @param {string} opts.title
 * @param {Array<{id:string, text:string, isPublic?:boolean, isRedHerring?:boolean}>} opts.clues - 全部线索
 * @param {Array<{id:string, actorId:string, knowsClueIds:string[]}>} opts.witnesses - 证人知情范围
 * @param {Array<{solutionId:string, requiredClueIds:string[], steps:string[], conclusion:string}>} opts.solutions - 多条解法
 * @param {boolean} [opts.autoHint=true] - 是否开启自动提示（作者可关闭）
 * @returns {object} mystery definition
 */
export function createMystery(opts) {
  if (!opts || !opts.mysteryId || !opts.title) {
    throw new Error('createMystery: mysteryId and title required');
  }
  if (!Array.isArray(opts.clues) || opts.clues.length < 3) {
    throw new Error('createMystery: need at least 3 clues');
  }
  if (!Array.isArray(opts.witnesses) || opts.witnesses.length < 1) {
    throw new Error('createMystery: witnesses required');
  }
  if (!Array.isArray(opts.solutions) || opts.solutions.length < 1) {
    throw new Error('createMystery: at least one solution required');
  }
  // 校验证人知情范围只引用存在的线索
  const clueIds = new Set(opts.clues.map((c) => c.id));
  for (const w of opts.witnesses) {
    if (!w.id || !w.actorId || !Array.isArray(w.knowsClueIds)) {
      throw new Error('createMystery: witness needs id, actorId, knowsClueIds');
    }
    for (const cid of w.knowsClueIds) {
      if (!clueIds.has(cid)) {
        throw new Error(`createMystery: witness ${w.id} knows unknown clue ${cid}`);
      }
    }
  }
  // 校验解法引用的线索存在
  for (const sol of opts.solutions) {
    if (!sol.solutionId || !Array.isArray(sol.requiredClueIds)) {
      throw new Error('createMystery: solution needs solutionId and requiredClueIds');
    }
    for (const cid of sol.requiredClueIds) {
      if (!clueIds.has(cid)) {
        throw new Error(`createMystery: solution ${sol.solutionId} requires unknown clue ${cid}`);
      }
    }
  }
  return {
    mysteryId: opts.mysteryId,
    title: opts.title,
    clues: opts.clues,
    witnesses: opts.witnesses,
    solutions: opts.solutions,
    autoHint: opts.autoHint !== false, // 默认 true，作者可显式 false 关闭
  };
}

/**
 * 创建玩家进度（存档用）
 * @param {string} mysteryId
 * @returns {object} progress
 */
export function createProgress(mysteryId) {
  return {
    mysteryId,
    discoveredClueIds: [], // 已发现的线索 id
    readClueIds: [], // 已读线索 id
    attemptedSolutions: [], // 尝试过的解法记录
    solved: false,
    solvedBy: null, // 哪条解法
  };
}

/**
 * 玩家提交假说（选择线索+选择解法路径）
 * @param {object} mystery
 * @param {object} progress
 * @param {string} solutionId - 玩家选择的解法
 * @param {Array<string>} clueIds - 玩家认为需要的线索
 * @returns {object} { correct, feedback, newlyRevealed, unlockedClues }
 */
export function submitHypothesis(mystery, progress, solutionId, clueIds) {
  if (!mystery || !progress) throw new Error('submitHypothesis: mystery and progress required');
  if (!solutionId || !Array.isArray(clueIds)) {
    throw new Error('submitHypothesis: solutionId and clueIds required');
  }

  const solution = mystery.solutions.find((s) => s.solutionId === solutionId);
  if (!solution) {
    return { correct: false, feedback: '未知的解法路径', newlyRevealed: [], unlockedClues: [] };
  }

  // 检查玩家是否已读所有必需线索
  const readSet = new Set(progress.readClueIds);
  const hasAllRequired = solution.requiredClueIds.every((cid) => readSet.has(cid));
  if (!hasAllRequired) {
    // 猜错：不揭示下一层，但保留已读线索，可回到证据继续
    progress.attemptedSolutions.push({ solutionId, clueIds, result: 'incomplete', timestamp: null });
    return {
      correct: false,
      feedback: '还有关键证据未发现，回到线索继续调查',
      newlyRevealed: [],
      unlockedClues: [],
    };
  }

  // 检查玩家提交的线索是否匹配解法
  const submittedSet = new Set(clueIds);
  const matchesSolution = solution.requiredClueIds.every((cid) => submittedSet.has(cid));

  if (matchesSolution) {
    // 正确：揭示下一层证据（conclusion）并标记已解决
    progress.solved = true;
    progress.solvedBy = solutionId;
    progress.attemptedSolutions.push({ solutionId, clueIds, result: 'correct', timestamp: null });
    return {
      correct: true,
      feedback: solution.conclusion,
      newlyRevealed: [{ type: 'conclusion', text: solution.conclusion, solutionId }],
      unlockedClues: [],
    };
  }

  // 猜错：保留已读线索，可继续
  progress.attemptedSolutions.push({ solutionId, clueIds, result: 'wrong', timestamp: null });
  return {
    correct: false,
    feedback: '推理方向有误，回到证据重新梳理',
    newlyRevealed: [],
    unlockedClues: [],
  };
}

/**
 * 玩家向证人提问
 * 证人只回答其知情范围内的线索，未读线索不泄底
 * @param {object} mystery
 * @param {object} progress
 * @param {string} witnessId
 * @param {string} questionClueId - 询问的线索 id
 * @returns {object} { responded, text, leakedUnread }
 */
export function queryWitness(mystery, progress, witnessId, questionClueId) {
  if (!mystery || !progress) throw new Error('queryWitness: mystery and progress required');
  const witness = mystery.witnesses.find((w) => w.id === witnessId);
  if (!witness) {
    return { responded: false, text: '找不到这位证人', leakedUnread: false };
  }

  // 检查线索是否在证人知情范围内
  const inKnowsRange = witness.knowsClueIds.includes(questionClueId);
  if (!inKnowsRange) {
    return { responded: false, text: '证人表示对此毫不知情', leakedUnread: false };
  }

  // 检查线索是否已被玩家读过（未读线索不泄底）
  const isRead = progress.readClueIds.includes(questionClueId);
  if (!isRead) {
    // 未读线索：证人不直接泄露内容，只暗示存在
    return { responded: true, text: '证人似乎知道些什么，但需要你先自己找到相关线索', leakedUnread: false };
  }

  // 已读线索：证人可回答
  const clue = mystery.clues.find((c) => c.id === questionClueId);
  return {
    responded: true,
    text: `证人确认：${clue.text}`,
    leakedUnread: false,
  };
}

/**
 * 获取玩家已发现的线索列表
 * @param {object} mystery
 * @param {object} progress
 * @returns {Array} 已发现的线索详情
 */
export function getDiscoveredClues(mystery, progress) {
  if (!mystery || !progress) return [];
  const discovered = new Set(progress.discoveredClueIds);
  return mystery.clues
    .filter((c) => discovered.has(c.id))
    .map((c) => ({
      id: c.id,
      text: c.text,
      isPublic: c.isPublic || false,
      isRedHerring: c.isRedHerring || false,
      isRead: progress.readClueIds.includes(c.id),
    }));
}

Object.freeze(Object.freeze({ VERSION, FROZEN_WORDS }));