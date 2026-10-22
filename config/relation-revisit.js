/* ============================================================
 * config/relation-revisit.js — [v4.53.0 · 第六期 R6-O7]
 *   「可重访的关系往事：回忆册从陈列页变成互动现场」（纯函数）
 * ------------------------------------------------------------
 * 【计划原文（R6-O7）】
 *   「用户选择一段往事、讲述对象和分享范围；可翻旧消息、对照各自所见、
 *    发送询问或邀请重访。对方的回应形成新的交流记录，与旧事实分离；
 *    照片/音乐等可用素材围绕这一场回顾编排。」
 *
 * 【验收下限】
 *   ① 一人愿意重谈、一人回避，后续交流不强制统一立场；
 *   ② 私人旧消息可选引用范围，不整段泄露给其他角色；
 *   ③ 重访活动产生新记录而非改写旧经历，重开后两者可分别阅读。
 *
 * 【本模块只做四件事（纯函数，不读存储 / 不碰 DOM / 不读时钟）】
 *   1 **createRevisitSession**：选择一段往事 + 讲述对象 + 分享范围，
 *      初始化一场重访会话，各参与方带 stance（willing/avoiding/neutral），
 *      不强制统一立场；
 *   2 **quoteOldMessages**：从旧消息列表中按引用范围（quoteScope）选取可分享片段，
 *      只暴露 selected 的、不在 scope 内的不泄露（private 消息对未授权方隐藏全文）；
 *   3 **addRevisitExchange**：一方发起询问或分享，另一方回应形成新的交流记录，
 *      新记录标 newRecord=true，与旧事实分离；
 *   4 **closeRevisit**：结束一场重访，旧经历不变（originalPast 不被改写），
 *      重访产生的新记录独立可读，两者可分别阅读。
 *
 * 【口径纪律】
 *   · stance 由调用方给，本模块不判定谁该愿意谁该回避；
 *   · 旧消息引用范围（quoteScope）限定可分享的消息 id 列表，范围外消息对其他角色不可见；
 *   · 重访产生的新交流记录绝不写回旧经历的源数据。
 * ============================================================ */
const VERSION = '4.53.0';
const FROZEN_WORDS = ['revisit', 'stance', 'willing', 'avoiding', 'quoteScope', 'newRecord'];

/**
 * 创建一场往事重访会话
 * @param {object} opts
 * @param {string} opts.pastId - 旧经历标识
 * @param {object} opts.originalPast - 旧经历的原始数据（只读引用，不修改）
 * @param {Array<{actorId:string, stance:'willing'|'avoiding'|'neutral'}>} opts.participants - 参与方及立场
 * @param {Array<string>} opts.quoteScope - 可引用的旧消息 id 列表
 * @returns {object} revisit session
 */
export function createRevisitSession(opts) {
  if (!opts || !opts.pastId || !opts.originalPast) {
    throw new Error('createRevisitSession: pastId and originalPast required');
  }
  if (!Array.isArray(opts.participants) || opts.participants.length < 1) {
    throw new Error('createRevisitSession: participants required');
  }
  // 校验 stance 合法值
  const validStances = ['willing', 'avoiding', 'neutral'];
  for (const p of opts.participants) {
    if (!p.actorId || !validStances.includes(p.stance)) {
      throw new Error('createRevisitSession: each participant needs actorId and valid stance');
    }
  }
  // 不强制统一立场：记录各方的原始 stance，不做合并
  const stances = {};
  for (const p of opts.participants) {
    stances[p.actorId] = p.stance;
  }
  return {
    sessionId: `revisit_${opts.pastId}_${Date.now()}`,
    pastId: opts.pastId,
    originalPast: opts.originalPast, // 只读引用，不改
    stances, // { alice: 'willing', bob: 'avoiding' }
    quoteScope: Array.isArray(opts.quoteScope) ? [...opts.quoteScope] : [],
    exchanges: [], // 新交流记录列表
    status: 'open', // open / closed
    createdAt: null, // 调用方填
  };
}

/**
 * 从旧消息列表中按引用范围选取可分享片段
 * @param {Array<{id:string, from:string, text:string, isPrivate?:boolean}>} oldMessages - 旧消息列表
 * @param {Array<string>} quoteScope - 可引用的消息 id 列表
 * @param {string} viewerId - 查看者 id（用于判断是否泄露私人消息）
 * @returns {Array} 可分享的消息片段（scope 外的 private 消息全文被隐藏）
 */
export function quoteOldMessages(oldMessages, quoteScope, viewerId) {
  if (!Array.isArray(oldMessages) || !Array.isArray(quoteScope)) {
    return [];
  }
  const scopeSet = new Set(quoteScope);
  return oldMessages.map((msg) => {
    if (scopeSet.has(msg.id)) {
      // 在引用范围内：可展示
      return { id: msg.id, from: msg.from, text: msg.text, quoted: true };
    }
    if (msg.isPrivate && msg.from !== viewerId) {
      // 私人消息不在范围内且查看者非发送者：隐藏全文
      return { id: msg.id, from: msg.from, text: '[该消息不在分享范围内]', quoted: false, hidden: true };
    }
    // 非私人消息不在范围内：标注存在但不展示全文
    return { id: msg.id, from: msg.from, text: '[未引用]', quoted: false };
  });
}

/**
 * 在重访会话中添加一条新的交流记录
 * @param {object} session - revisit session（会被修改）
 * @param {object} exchange - { from, to, kind:'inquiry'|'share'|'response', text }
 * @returns {object} 新增的交流记录
 */
export function addRevisitExchange(session, exchange) {
  if (!session || session.status !== 'open') {
    throw new Error('addRevisitExchange: session is not open');
  }
  if (!exchange || !exchange.from || !exchange.kind) {
    throw new Error('addRevisitExchange: from and kind required');
  }
  const validKinds = ['inquiry', 'share', 'response'];
  if (!validKinds.includes(exchange.kind)) {
    throw new Error('addRevisitExchange: invalid kind');
  }
  const record = {
    exchangeId: `${session.sessionId}_ex_${session.exchanges.length + 1}`,
    from: exchange.from,
    to: exchange.to || null,
    kind: exchange.kind,
    text: exchange.text || '',
    newRecord: true, // 标记为新记录
    timestamp: null, // 调用方填
  };
  session.exchanges.push(record);
  return record;
}

/**
 * 关闭一场重访会话
 * 旧经历不变，新交流记录独立可读
 * @param {object} session
 * @returns {{closedSession:object, originalPast:object}} 关闭的会话 + 未改动的旧经历
 */
export function closeRevisit(session) {
  if (!session) throw new Error('closeRevisit: session required');
  session.status = 'closed';
  // 返回：关闭的会话（含新记录）+ 旧经历原样不动
  return {
    closedSession: {
      sessionId: session.sessionId,
      pastId: session.pastId,
      stances: { ...session.stances },
      exchanges: [...session.exchanges],
      status: 'closed',
    },
    originalPast: session.originalPast, // 原样返回，不改写
  };
}

Object.freeze(Object.freeze({ VERSION, FROZEN_WORDS }));
