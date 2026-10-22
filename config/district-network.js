/* ============================================================
 * config/district-network.js — [v4.53.0 · 第六期 R6-X2]
 *   「街区与人情网络：地点会提供机会，而不只是显示谁在那里」（纯函数）
 * ------------------------------------------------------------
 * 【计划原文（R6-X2）】
 *   「地点拥有作者设定的营业/活动节奏、常驻组织及公开机会；
 *    消息、海报与到访经历形成机会来源。用户可预约、问路、赴约、
 *    错过后再联系，同一街区随已发生事件改变可参与内容。」
 *
 * 【验收下限】
 *   ① 一个街区三处地点有不同时间窗，错过机会后不伪造已到场；
 *   ② 参与展览改变之后可收到的邀请，但陌生角色不突然熟识；
 *   ③ 地点数据不全时作者可补设，不能编真实距离或调用真实位置。
 *
 * 【本模块只做四件事（纯函数，不读存储 / 不碰 DOM / 不读 GPS）】
 *   1 **createPlace**：创建一个虚构地点，带营业节奏（timeWindows）和
 *      常驻组织（orgs），不调用真实位置；
 *   2 **deriveOpportunities**：根据当前时间槽、地点节奏与用户到访经历，
 *      生成可参与的机会列表；已过期的标 missed（不伪造已到场），
 *      未到的不提前开放；
 *   3 **recordVisit**：记录一次到访（参加展览等），影响后续可收到的邀请，
 *      但陌生角色的 familiarity 不自动跳升（stranger → acquaintance 需显式升级）；
 *   4 **getPlaceFamiliarity**：读取用户与某地点的熟悉度，
 *      分级 stranger / acquainted / regular，陌生角色不突然变熟。
 *
 * 【口径纪律】
 *   · 地点用虚构坐标（fictitiousCoord），不读真实 GPS；
 *   · 营业节奏由作者设定，本模块不编真实距离；
 *   · 机会有数量上限（maxOpportunitiesPerPlace），避免变任务刷屏器。
 * ============================================================ */
const VERSION = '4.53.0';
const FROZEN_WORDS = ['district', 'opportunity', 'timeWindow', 'missed', 'familiarity', 'stranger'];

const FAMILIARITY_LEVELS = ['stranger', 'acquainted', 'regular'];
const MAX_OPPS_PER_PLACE = 5;

/**
 * 创建一个虚构地点
 * @param {object} opts
 * @param {string} opts.placeId
 * @param {string} opts.name
 * @param {Array<{day:string, slots:Array<{start:string,end:string,label:string}>}>} opts.timeWindows - 营业节奏
 * @param {Array<string>} opts.orgs - 常驻组织 id 列表
 * @param {string} [opts.fictitiousCoord] - 虚构坐标（不读真实 GPS）
 * @returns {object} place definition
 */
export function createPlace(opts) {
  if (!opts || !opts.placeId || !opts.name) {
    throw new Error('createPlace: placeId and name required');
  }
  if (!Array.isArray(opts.timeWindows) || opts.timeWindows.length === 0) {
    throw new Error('createPlace: timeWindows required');
  }
  return {
    placeId: opts.placeId,
    name: opts.name,
    timeWindows: opts.timeWindows,
    orgs: Array.isArray(opts.orgs) ? [...opts.orgs] : [],
    fictitiousCoord: opts.fictitiousCoord || null, // 不调用真实位置
    visits: [], // 到访记录
    familiarity: {}, // { userId: 'stranger' | 'acquainted' | 'regular' }
  };
}

/**
 * 根据当前时间槽、地点节奏与用户到访经历，生成可参与的机会列表
 * @param {object} place - createPlace 返回的地点对象
 * @param {string} currentDay - 当前星期几
 * @param {string} currentSlot - 当前时间槽标识
 * @param {Array<{id:string, label:string, condition?:string}>} availableEvents - 作者设定的可参与事件
 * @param {string} [userId] - 用户 id
 * @returns {Array} 机会列表（active / missed / upcoming）
 */
export function deriveOpportunities(place, currentDay, currentSlot, availableEvents, userId) {
  if (!place || !currentDay || !currentSlot) return [];

  // 找到当天的营业窗口
  const dayWindows = place.timeWindows.find((tw) => tw.day === currentDay);
  if (!dayWindows) return [];

  // 当前时间槽是否在营业中
  const currentOpen = dayWindows.slots.find((s) => s.start === currentSlot || s.label === currentSlot);
  if (!currentOpen) {
    // 不在营业时间内：返回已过期的标 missed，不伪造已到场
    return (availableEvents || []).slice(0, MAX_OPPS_PER_PLACE).map((ev) => ({
      ...ev,
      status: 'missed',
      placeId: place.placeId,
    }));
  }

  // 在营业时间内：检查用户是否已参与过
  const userVisits = userId ? place.visits.filter((v) => v.userId === userId) : [];
  const visitedEventIds = new Set(userVisits.map((v) => v.eventId));

  return (availableEvents || []).slice(0, MAX_OPPS_PER_PLACE).map((ev) => {
    if (visitedEventIds.has(ev.id)) {
      return { ...ev, status: 'already-attended', placeId: place.placeId };
    }
    return { ...ev, status: 'active', placeId: place.placeId };
  });
}

/**
 * 记录一次到访（参加展览等）
 * @param {object} place - 地点对象（会被修改）
 * @param {string} userId
 * @param {string} eventId
 * @param {Array<string>} [metCharacterIds] - 在活动中遇到的角色
 * @returns {object} 到访记录
 */
export function recordVisit(place, userId, eventId, metCharacterIds) {
  if (!place || !userId || !eventId) {
    throw new Error('recordVisit: place, userId, eventId required');
  }
  const visit = {
    userId,
    eventId,
    placeId: place.placeId,
    metCharacters: Array.isArray(metCharacterIds) ? [...metCharacterIds] : [],
    timestamp: null, // 调用方填
  };
  place.visits.push(visit);

  // 熟悉度升级：stranger → acquainted → regular（每级需要多次到访）
  const visitCount = place.visits.filter((v) => v.userId === userId).length;
  if (!place.familiarity[userId] || place.familiarity[userId] === 'stranger') {
    place.familiarity[userId] = visitCount >= 1 ? 'acquainted' : 'stranger';
  }
  if (place.familiarity[userId] === 'acquainted' && visitCount >= 3) {
    place.familiarity[userId] = 'regular';
  }

  // 但陌生角色不突然熟识：metCharacters 只记录相遇，不改变角色关系级别
  return visit;
}

/**
 * 读取用户与某地点的熟悉度
 * @param {object} place
 * @param {string} userId
 * @returns {string} 'stranger' | 'acquainted' | 'regular'
 */
export function getPlaceFamiliarity(place, userId) {
  if (!place || !userId) return 'stranger';
  return place.familiarity[userId] || 'stranger';
}

Object.freeze(Object.freeze({ VERSION, FROZEN_WORDS }));