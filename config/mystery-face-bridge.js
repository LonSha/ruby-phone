/* ============================================================
 * config/mystery-face-bridge.js — [v4.102.0 · R13-O3]
 *   「推理谜题」桥：把 mystery-engine 的纯函数接到游戏大厅的可见页上
 * ------------------------------------------------------------
 * 【为什么需要这一层（R13-O3 的 A 类决策）】
 *   `config/mystery-engine.js` 自 v4.53.0 起就有完整的推理剧能力：
 *     作者定义谜题（公开线索 / 证人知情范围 / 多解法 / 误导线索）
 *     → 玩家读材料、向证人提问、提交假说 → 正确揭示收束，猜错可回证据。
 *   但产品端零 import，只在 tests/system-v4530.test.mjs 里被消费。
 *   R13-O3 判 A 类，理由：它的能力只差一个界面。
 *
 * 【内核是纯函数，进度归调用方 —— 这是本桥存在的一半理由】
 *   实测内核（v4.53.0）的签名与「读→问→提交」的完整流程之间有一道缝：
 *     · `submitHypothesis` 只**读** `progress.readClueIds` 判断是否已读齐，
 *       自己从不写入 `readClueIds` / `discoveredClueIds`；
 *     · 内核里没有任何「发现线索」的入口，`getDiscoveredClues` 只按
 *       `progress.discoveredClueIds` 过滤。
 *   也就是说，内核把「玩家怎么发现一条线索」留给了宿主。本桥补这一格，
 *   并把规则写死成可审计的三句：
 *     ① 公开线索（isPublic）开局即可读；
 *     ② 非公开线索只有在**知情证人承认知情之后**才可读（发现动作）；
 *     ③ 「承认知情」不泄底：线索正文仍要玩家自己按下「读」才进 readClueIds。
 *
 * 【本模块只做翻译 + 记账，不做判定】
 *   判「这条假说对不对、这个证人知不知道」永远是内核的事。桥不重写判定，
 *   只在两处补口径：
 *     · 把内核的 `{responded, text, leakedUnread}` 翻成视图能分档显示的行；
 *     · 把「证人不知情」与「证人知情但还没承认」分成两句不同的话。
 *
 * 【诚实边界】
 *   · 示例谜题只是**一个可玩的例子**，不是内容库：真谜题应由作者写进
 *     世界书，本桥不生成谜题、不调用 AI；
 *   · 进度持久化归调用方（本桥不写存储）：`progress` 是纯对象，
 *     存不存、存哪由视图决定；
 *   · 内核抛错（参数不全）不吞：原样抛出，由视图决定怎么提示；
 *   · 本桥只保证「能力有了一扇门」，**不保证这一页好玩**。
 * ============================================================ */
import {
  createMystery,
  createProgress,
  submitHypothesis,
  queryWitness,
  getDiscoveredClues,
} from './mystery-engine.js';

/**
 * 内置示例谜题（「谁拿错了伞」）。
 * 四条线索（含一条误导）、两位证人、两条解法 —— 覆盖内核验收下限的最小可玩集。
 * 内容刻意做成**非暴力日常**：计划书要求「一件非暴力日常谜题」。
 */
export function sampleMystery() {
  return createMystery({
    mysteryId: 'sample-umbrella',
    title: '谁拿错了伞',
    // c1 公开（开局就在公告栏上），c2/c3 要靠证人承认，c4 是误导。
    clues: [
      { id: 'c1', text: '玄关只剩一把深灰长柄伞，伞骨断了一根。', isPublic: true },
      { id: 'c2', text: '值班表显示傍晚最后离开的是两个人：一个去了车库，一个回了工位。' },
      { id: 'c3', text: '清洁工说六点半有人拿着湿伞从侧门回来过，鞋底带泥。' },
      { id: 'c4', text: '大厅监控那天正好检修，什么都没拍到。', isRedHerring: true },
    ],
    witnesses: [
      { id: 'w1', actorId: 'cleaner', knowsClueIds: ['c3'] },
      { id: 'w2', actorId: 'duty', knowsClueIds: ['c2'] },
    ],
    solutions: [
      {
        solutionId: 's1',
        requiredClueIds: ['c1', 'c2', 'c3'],
        steps: ['比对值班表', '核对清洁工的说法', '锁定了拿错伞的人'],
        conclusion: '拿错伞的是最后回工位的那位：他顺手拎走了玄关那把断骨伞。',
      },
      {
        solutionId: 's2',
        requiredClueIds: ['c1', 'c3'],
        steps: ['只看清洁工的说法就够'],
        conclusion: '其实是清洁工自己拿错了：他嫌断骨伞挡路，把它挪到了侧门。',
      },
    ],
    autoHint: false,
  });
}

/** 新开一局：谜题 + 初始进度（公开线索开局即可读）。 */
export function startSampleRun() {
  const mystery = sampleMystery();
  const progress = createProgress(mystery.mysteryId);
  progress.discoveredClueIds.push(...mystery.clues.filter((c) => c.isPublic).map((c) => c.id));
  return { mystery, progress };
}

function guard(run) {
  const r = (run && typeof run === 'object') ? run : {};
  if (!r.mystery || !r.progress) return null;
  return r;
}

function findClue(run, clueId) {
  return (run.mystery.clues || []).find((c) => c.id === clueId) || null;
}

/**
 * 读一条已发现的线索：把它写进 readClueIds（内核不做这件事）。
 * 未发现的线索不给读 —— 这正是「未读线索不能泄底」的落地处。
 * @returns {{ ok:boolean, text:string, why:string }}
 */
export function readClue(run, clueId) {
  const r = guard(run);
  if (!r) return { ok: false, text: '', why: '这一局还没开始' };
  const clue = findClue(r, clueId);
  if (!clue) return { ok: false, text: '', why: '没有这条线索' };
  if (!r.progress.discoveredClueIds.includes(clueId)) {
    return { ok: false, text: '', why: '这条线索你还没发现，先去找人问问' };
  }
  if (!r.progress.readClueIds.includes(clueId)) r.progress.readClueIds.push(clueId);
  return { ok: true, text: String(clue.text || ''), why: '' };
}

/**
 * 向证人提问。
 * @returns {{ ok:boolean, text:string, why:string, discovered:string[] }}
 *   discovered 是本问**新承认**的线索 id（已写进 discoveredClueIds，但未读）。
 */
export function askAndRead(run, witnessId, clueId) {
  const r = guard(run);
  if (!r) return { ok: false, text: '', why: '这一局还没开始', discovered: [] };
  const res = queryWitness(r.mystery, r.progress, witnessId, clueId);
  if (!res || !res.responded) {
    return { ok: false, text: '', why: String((res && res.text) || '证人没有回答'), discovered: [] };
  }
  const discovered = [];
  if (!r.progress.discoveredClueIds.includes(clueId)) {
    r.progress.discoveredClueIds.push(clueId);
    discovered.push(clueId);
  }
  if (res.leakedUnread) {
    /* 内核若哪天把未读内容漏出来，桥这一层先把它按住并记账，不让它到视图。 */
    return { ok: false, text: '', why: '证人还没打算说这件事', discovered };
  }
  const read = r.progress.readClueIds.includes(clueId);
  if (!read) {
    return {
      ok: true,
      text: '证人点头，说他确实知道这件事——但得你自己去看那一格。',
      why: '',
      discovered,
    };
  }
  return { ok: true, text: String(res.text || ''), why: '', discovered };
}

/**
 * 提交假说。clueIds 缺省时用「已读全部线索」，否则必须非空。
 * @returns {{ ok:boolean, verdict:'solved'|'wrong'|'incomplete'|'bad-input', title:string, detail:string, revealed:Array }}
 */
export function submitAndRead(run, solutionId, clueIds) {
  const r = guard(run);
  if (!r) {
    return { ok: false, verdict: 'bad-input', title: '这一局还没开始', detail: '谜题或进度不在场', revealed: [] };
  }
  const ids = Array.isArray(clueIds) ? clueIds.slice() : r.progress.readClueIds.slice();
  if (!ids.length) {
    return { ok: false, verdict: 'bad-input', title: '还没有读到任何线索', detail: '先去读几条线索再提假说', revealed: [] };
  }
  if (r.progress.solved) {
    return { ok: true, verdict: 'solved', title: '已经解开了', detail: '这一局结束了；换一局再玩', revealed: [] };
  }
  /* 内核 check 先判「必需线索是否都读过」再判「提交的线索是否匹配」，
   * 所以「线索没读齐」与「方向错了」从 feedback 文本上不好区分。
   * 桥自己先算一次已读齐否，把这两种情况分成两档（只读 progress，不改判定）。 */
  const solution = (r.mystery.solutions || []).find((s) => s.solutionId === solutionId);
  const readSet = new Set(r.progress.readClueIds);
  const readEnough = solution ? solution.requiredClueIds.every((cid) => readSet.has(cid)) : true;

  const res = submitHypothesis(r.mystery, r.progress, solutionId, ids);
  const revealed = (res && Array.isArray(res.newlyRevealed)) ? res.newlyRevealed.slice() : [];
  if (res && res.correct) {
    return { ok: true, verdict: 'solved', title: '假说成立', detail: String(res.feedback || ''), revealed };
  }
  if (!readEnough) {
    return {
      ok: false,
      verdict: 'incomplete',
      title: '还差证据',
      detail: '有些关键线索你还没读到——回去问问知情的人',
      revealed: [],
    };
  }
  return {
    ok: false,
    verdict: 'wrong',
    title: '假说还不成立',
    detail: String((res && res.feedback) || '推理方向有误，回到证据重新梳理'),
    revealed: [],
  };
}

/** 已发现线索的可读列表（给视图直接渲染）。 */
export function discoveredRows(run) {
  const r = guard(run);
  if (!r) return [];
  const rows = getDiscoveredClues(r.mystery, r.progress) || [];
  return rows.map((c) => ({
    id: c.id,
    text: String(c.text || ''),
    isRead: !!c.isRead,
    isRedHerring: !!c.isRedHerring,
  }));
}

/** 证人清单（视图要人给人，不要 actorId 也行）。 */
export function witnessRows(run) {
  const r = guard(run);
  if (!r) return [];
  return (r.mystery.witnesses || []).map((w) => ({ id: w.id, actorId: String(w.actorId || w.id) }));
}

/** 这一局的一句话状态。 */
export function runStatus(run) {
  const r = (run && typeof run === 'object') ? run : {};
  if (!r.progress) return { state: 'idle', text: '还没开始' };
  if (r.progress.solved) return { state: 'solved', text: '已解开' };
  const d = Array.isArray(r.progress.discoveredClueIds) ? r.progress.discoveredClueIds.length : 0;
  const rd = Array.isArray(r.progress.readClueIds) ? r.progress.readClueIds.length : 0;
  if (!d) return { state: 'running', text: '还没发现线索' };
  return { state: 'running', text: '已发现 ' + d + ' 条线索（已读 ' + rd + ' 条）' };
}
