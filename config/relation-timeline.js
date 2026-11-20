/**
 * config/relation-timeline.js — 关系与时间线可视化数据面 [R26-X3]
 *
 * 立项时的空缺（原文）：有联系人、有聊天、有关系读数，但没有一张图能看
 * 「谁和谁什么时候变的」。验收口径：时间轴可拖、可筛、可点到具体消息；
 * 无数据时显示「还没有」而非空图。
 *
 * 这里只做「给图吃的数据」，不做画图。四条硬口径：
 *  ① **排序必须确定**：同一时刻多条事件按 id 升序 —— 否则同一份数据画两次图不一样，
 *     「可复跑」直接失效。
 *  ② **筛完要能说清筛掉了多少**：`filtered` 是读数的一部分，不许悄悄少给点。
 *  ③ **可点到消息**：每条事件必须带 `messageId`；没有消息锚点的事件单列 `unanchored`，
 *     因为它们点不进去（不能假装可点）。
 *  ④ **空就说空**：`timelineText()` 在零事件时输出「还没有……」，
 *     绝不返回一个 0 点的空图让人以为图坏了。
 */

import { numOrNull } from './num-gate.js';

export const RELATION_EVENT_KINDS = Object.freeze(['met', 'trust-up', 'trust-down', 'conflict', 'repair', 'gift']);

/**
 * 事件规范化：时间戳走全仓唯一的数值取值门（`numOrNull`），
 * 不用 `Number.isFinite(Number(x))` —— 那会把 `null`/`''`/`[]` 都读成 0，
 * 于是「上游没给时间」与「真给了 1970」塌成同一个读数（弱口径门 W1 会红）。
 */
function normalizeEvents(events) {
  return events.map((e) => {
    if (!e || typeof e.id !== 'string' || !e.id) throw new TypeError('每条事件必须有 id');
    if (!RELATION_EVENT_KINDS.includes(e.kind)) throw new TypeError(`未知关系事件类型：${e.kind}`);
    const at = numOrNull(e.at);
    if (at === null) throw new TypeError(`事件 ${e.id} 的 at 必须是时间戳`);
    return { ...e, at };
  });
}

/**
 * 生成时间线数据。
 * @param {Array<{id:string,at:number,kind:string,actor:string,target?:string,delta?:number,messageId?:string}>} events
 * @param {{from?: number, to?: number, kinds?: string[], actors?: string[], limit?: number}} [opts]
 */
export function buildTimeline(events, opts = {}) {
  if (!Array.isArray(events)) throw new TypeError('buildTimeline 需要事件数组');
  const kinds = Array.isArray(opts.kinds) && opts.kinds.length ? opts.kinds : null;
  const actors = Array.isArray(opts.actors) && opts.actors.length ? opts.actors : null;
  const normalized = normalizeEvents(events);
  const all = [...normalized].sort((a, b) => (a.at - b.at) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const kept = all.filter((e) => {
    if (opts.from != null && e.at < Number(opts.from)) return false;
    if (opts.to != null && e.at > Number(opts.to)) return false;
    if (kinds && !kinds.includes(e.kind)) return false;
    if (actors && !actors.includes(e.actor) && !actors.includes(e.target)) return false;
    return true;
  });
  const limit = Number(opts.limit) > 0 ? Number(opts.limit) : 0;
  const shown = limit && kept.length > limit ? kept.slice(-limit) : kept;
  return {
    points: shown.map((e) => ({
      id: e.id,
      at: e.at,
      kind: e.kind,
      actor: e.actor,
      target: e.target || null,
      delta: e.delta == null ? 0 : Number(e.delta),
      messageId: e.messageId || null,
    })),
    total: all.length,
    kept: kept.length,
    filtered: all.length - kept.length,
    truncated: shown.length < kept.length,
    unanchored: kept.filter((e) => !e.messageId).map((e) => e.id),
    from: opts.from != null ? Number(opts.from) : null,
    to: opts.to != null ? Number(opts.to) : null,
  };
}

/** 拖动定位：给定时间点，找最近的一条事件（没有事件时返回 null，不许瞎返回第 0 条）。 */
export function nearestEvent(timeline, at) {
  if (!timeline || !Array.isArray(timeline.points) || !timeline.points.length) return null;
  const t = numOrNull(at);
  if (t === null) throw new TypeError('nearestEvent 需要时间戳');
  let best = timeline.points[0];
  for (const p of timeline.points) if (Math.abs(p.at - t) < Math.abs(best.at - t)) best = p;
  return best;
}

export function timelineText(timeline) {
  if (!timeline || !Array.isArray(timeline.points)) return '关系时间线：还没有可画的数据';
  if (timeline.points.length === 0) {
    if (timeline.total === 0) return '关系时间线：还没有任何关系变化记录';
    return `关系时间线：这段时间里没有事件（整段共 ${timeline.total} 条，被筛掉 ${timeline.filtered} 条）`;
  }
  const head = `关系时间线：${timeline.points.length} 个点（共 ${timeline.total} 条，筛掉 ${timeline.filtered} 条）`;
  const first = timeline.points[0];
  const last = timeline.points[timeline.points.length - 1];
  const tail = `最早 ${first.kind}（${first.id}） → 最近 ${last.kind}（${last.id}）`;
  const warn = timeline.unanchored.length ? `\n有 ${timeline.unanchored.length} 条点不到具体消息：${timeline.unanchored.slice(0, 3).join('、')}` : '';
  return head + '\n' + tail + warn;
}

export function relationTimelineSelfCheck() {
  const events = [
    { id: 'e2', at: 200, kind: 'trust-up', actor: 'me', target: 'her', delta: 5, messageId: 'm2' },
    { id: 'e1', at: 100, kind: 'met', actor: 'me', target: 'her', messageId: 'm1' },
    { id: 'e3', at: 200, kind: 'gift', actor: 'her', target: 'me', delta: 1 },
  ];
  const tl = buildTimeline(events);
  const filtered = buildTimeline(events, { kinds: ['met'] });
  const empty = buildTimeline([], {});
  const ok =
    tl.points.map((p) => p.id).join(',') === 'e1,e2,e3' &&
    tl.total === 3 &&
    tl.filtered === 0 &&
    tl.unanchored.join(',') === 'e3' &&
    filtered.points.length === 1 &&
    filtered.filtered === 2 &&
    nearestEvent(tl, 190).id === 'e2' &&
    nearestEvent(empty, 1) === null &&
    timelineText(empty).includes('还没有') &&
    timelineText(tl).includes('点不到具体消息');
  return { ok, bad: { tl, filtered }, sample: timelineText(tl) };
}