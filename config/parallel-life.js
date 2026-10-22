/* ============================================================
 * config/parallel-life.js — [v4.54.0 · 第六期 R6-X9]
 *   「平行人生试玩场：在另一条路线中真正使用另一部手机」（纯函数）
 * ------------------------------------------------------------
 * 【计划原文（R6-X9）】
 *   「从明确起点建立仅包含被选择内容的临时手机状态，玩家在其中回消息、
 *    安排活动、制作作品；两条路线可切换、比较自己实际做过的选择及后果，
 *    最后丢弃或通过现有确认流程带回选定成果。」
 *
 * 【验收下限】
 *   ① 同一起点在A线接受邀请、B线继续创作，两线聊天/日程/作品均可分别操作
 *   ② 来回切换三次并重开不混数据，主线没有自动新增事实
 *   ③ 只带回选定作品而不带回临时关系结果
 *
 * 【本模块只做四件事（纯函数）】
 *   1 createParallelLife：从明确起点建立临时手机状态（仅包含被选择内容）
 *   2 forkRoute：从起点分出一条新路线，各自独立操作
 *   3 switchRoute：切换活跃路线，不混数据
 *   4 harvestAndDiscard：只带回选定作品，丢弃临时关系结果
 *
 * 【口径纪律】
 *   · 临时手机状态隔离，不写回主线
 *   · 只带回选定作品，不带回临时关系
 *   · 不克隆全部历史或附件
 * ============================================================ */
const VERSION = '4.54.0';
const FROZEN_WORDS = ['parallel', 'route', 'fork', 'switch', 'harvest', 'isolated'];

/**
 * 从明确起点建立临时手机状态
 * @param {object} opts
 * @param {string} opts.lifeId
 * @param {object} opts.originPoint - 明确起点（不克隆全部历史）
 * @param {Array<string>} [opts.selectedContent] - 被选择纳入的内容 id
 * @returns {object} parallel life
 */
export function createParallelLife(opts) {
  if (!opts || !opts.lifeId || !opts.originPoint) {
    throw new Error('createParallelLife: lifeId and originPoint required');
  }
  return {
    lifeId: opts.lifeId,
    originPoint: opts.originPoint,
    selectedContent: Array.isArray(opts.selectedContent) ? [...opts.selectedContent] : [],
    routes: {}, // { routeId: { messages, schedule, works, active } }
    activeRouteId: null,
    mainLineContaminated: false, // 主线不自动新增事实
    status: 'active',
  };
}

/**
 * 从起点分出一条新路线
 * @param {object} life - parallel life
 * @param {string} routeId - 路线 id
 * @param {object} [initialState] - 初始状态
 * @returns {object} route
 */
export function forkRoute(life, routeId, initialState) {
  if (!life || !routeId) throw new Error('forkRoute: life and routeId required');
  if (life.routes[routeId]) {
    throw new Error(`forkRoute: route ${routeId} already exists`);
  }
  const route = {
    routeId,
    messages: [], // 聊天消息（独立）
    schedule: [], // 日程（独立）
    works: [], // 作品（独立）
    active: false,
    createdAt: null,
  };
  // 从初始状态导入
  if (initialState) {
    if (Array.isArray(initialState.messages)) route.messages = [...initialState.messages];
    if (Array.isArray(initialState.schedule)) route.schedule = [...initialState.schedule];
    if (Array.isArray(initialState.works)) route.works = [...initialState.works];
  }
  life.routes[routeId] = route;
  // 第一个路线自动设为活跃
  if (!life.activeRouteId) {
    life.activeRouteId = routeId;
    route.active = true;
  }
  return route;
}

/**
 * 切换活跃路线，不混数据
 * @param {object} life
 * @param {string} routeId - 要切换到的路线
 * @returns {object} { activeRoute, previousRoute, switched }
 */
export function switchRoute(life, routeId) {
  if (!life || !routeId) throw new Error('switchRoute: life and routeId required');
  if (!life.routes[routeId]) {
    return { activeRoute: null, previousRoute: null, switched: false };
  }
  // 取消之前的活跃
  let previousRouteId = life.activeRouteId;
  if (previousRouteId && life.routes[previousRouteId]) {
    life.routes[previousRouteId].active = false;
  }
  // 设新活跃
  life.routes[routeId].active = true;
  life.activeRouteId = routeId;
  // 数据不混：各路线保持独立
  return {
    activeRoute: life.routes[routeId],
    previousRoute: previousRouteId ? life.routes[previousRouteId] : null,
    switched: true,
  };
}

/**
 * 只带回选定作品，丢弃临时关系结果
 * @param {object} life
 * @param {string} routeId - 从哪条路线收获
 * @param {Array<string>} selectedWorkIds - 选定要带回的作品 id
 * @returns {object} { harvested, discarded, mainLineClean }
 */
export function harvestAndDiscard(life, routeId, selectedWorkIds) {
  if (!life || !routeId) throw new Error('harvestAndDiscard: life and routeId required');
  const route = life.routes[routeId];
  if (!route) {
    throw new Error(`harvestAndDiscard: route ${routeId} not found`);
  }
  // 只带回选定的作品
  const harvestedWorks = route.works.filter((w) =>
    Array.isArray(selectedWorkIds) && selectedWorkIds.includes(w.id)
  );
  // 丢弃临时关系结果（messages 和 schedule 不带回）
  const discarded = {
    messages: route.messages.length,
    schedule: route.schedule.length,
    worksNotHarvested: route.works.length - harvestedWorks.length,
  };
  life.status = 'discarded';
  // 主线清洁：没有自动新增事实
  life.mainLineContaminated = false;
  return {
    harvested: harvestedWorks, // 只带回选定作品
    discarded,
    mainLineClean: true, // 主线没有自动新增事实
  };
}

Object.freeze(Object.freeze({ VERSION, FROZEN_WORDS }));