/**
 * config/notification-digest.js — 通知中心分组、批量处理与每日摘要 [R26-X8]
 *
 * 立项时的空缺（原文）：有通知与分级（R24/R25），但无分组、批量处理、摘要。
 * 验收口径：同源通知自动分组；批量已读/清除；每日摘要可关。
 *
 * 三条硬口径：
 *  ① **同源 = 同一个 appId**，分组只按 appId，不按标题猜（标题会被改，appId 不会）。
 *  ② **批量操作只动点名的那几条**：返回实际改动数 `changed`，没有改动就如实是 0，
 *     不许「看着像成功」。
 *  ③ **摘要关掉就明说关掉了**：`enabled:false` 时返回 `{enabled:false, items:[], reason}`，
 *     绝不返回一份空摘要让人以为「今天没事」。
 */

/** 摘要关闭时的固定说法（界面直接显示这句）。 */
export const DIGEST_DISABLED_REASON = '每日摘要已关闭';

function normalize(list) {
  if (!Array.isArray(list)) throw new TypeError('通知列表必须是数组');
  return list.map((n) => {
    if (!n || typeof n.id !== 'string' || !n.id) throw new TypeError('每条通知必须有 id');
    if (!n.appId) throw new TypeError(`通知 ${n.id} 缺少 appId，无法同源分组`);
    return {
      id: n.id,
      appId: String(n.appId),
      title: n.title == null ? '' : String(n.title),
      at: Number(n.at) || 0,
      read: n.read === true,
      level: n.level || 'info',
    };
  });
}

/**
 * 同源分组。
 * @param {Array<object>} list
 * @returns {Array<{appId:string, count:number, unread:number, latestAt:number, ids:string[], titles:string[]}>}
 */
export function groupNotifications(list) {
  const items = normalize(list);
  const map = new Map();
  for (const n of items) {
    if (!map.has(n.appId)) map.set(n.appId, { appId: n.appId, count: 0, unread: 0, latestAt: 0, ids: [], titles: [] });
    const g = map.get(n.appId);
    g.count += 1;
    if (!n.read) g.unread += 1;
    g.latestAt = Math.max(g.latestAt, n.at);
    g.ids.push(n.id);
    g.titles.push(n.title);
  }
  return [...map.values()].sort((a, b) => b.latestAt - a.latestAt || (a.appId < b.appId ? -1 : 1));
}

/** 批量已读：只动 ids 点名的那些；返回实际改动数。 */
export function markReadBulk(list, ids) {
  const items = normalize(list);
  const set = new Set(Array.isArray(ids) ? ids : []);
  let changed = 0;
  const next = items.map((n) => {
    if (set.has(n.id) && !n.read) {
      changed += 1;
      return { ...n, read: true };
    }
    return n;
  });
  return { list: next, changed };
}

/** 批量清除：返回新列表与被移除的 id。 */
export function clearBulk(list, ids) {
  const items = normalize(list);
  const set = new Set(Array.isArray(ids) ? ids : []);
  const removed = items.filter((n) => set.has(n.id)).map((n) => n.id);
  return { list: items.filter((n) => !set.has(n.id)), removed };
}

/**
 * 每日摘要。
 * @param {Array<object>} list
 * @param {{enabled?: boolean, since?: number}} [opts]
 */
export function buildDigest(list, opts = {}) {
  const enabled = opts.enabled !== false;
  const items = normalize(list);
  if (!enabled) return { enabled: false, items: [], total: 0, reason: DIGEST_DISABLED_REASON };
  const since = opts.since == null ? 0 : Number(opts.since);
  const picked = items.filter((n) => n.at >= since);
  const groups = groupNotifications(picked);
  return {
    enabled: true,
    items: groups.map((g) => ({ appId: g.appId, count: g.count, unread: g.unread, latestAt: g.latestAt })),
    total: picked.length,
    reason: null,
  };
}

export function digestText(digest) {
  if (!digest || typeof digest !== 'object') return '通知摘要：没有数据';
  if (digest.enabled === false) return `通知摘要：${digest.reason || DIGEST_DISABLED_REASON}`;
  if (!digest.items || digest.items.length === 0) return '通知摘要：今天没有新通知';
  const head = `通知摘要：${digest.total} 条 / ${digest.items.length} 个来源`;
  const body = digest.items.slice(0, 4).map((g) => `${g.appId} ${g.count} 条（未读 ${g.unread}）`).join('；');
  return head + '\n' + body;
}

export function notificationDigestSelfCheck() {
  const list = [
    { id: 'n1', appId: 'wechat', at: 100, read: false },
    { id: 'n2', appId: 'wechat', at: 300, read: true },
    { id: 'n3', appId: 'calendar', at: 200, read: false },
  ];
  const groups = groupNotifications(list);
  const read = markReadBulk(list, ['n1', 'n2']);
  const readAgain = markReadBulk(read.list, ['n2']);
  const cleared = clearBulk(list, ['n2', 'missing']);
  const off = buildDigest(list, { enabled: false });
  const digest = buildDigest(list, { since: 150 });
  const ok =
    groups.length === 2 &&
    groups[0].appId === 'wechat' &&
    groups[0].count === 2 &&
    groups[0].unread === 1 &&
    groups[0].latestAt === 300 &&
    read.changed === 1 &&
    readAgain.changed === 0 &&
    cleared.removed.join(',') === 'n2' &&
    cleared.list.length === 2 &&
    off.enabled === false &&
    off.items.length === 0 &&
    digestText(off).includes(DIGEST_DISABLED_REASON) &&
    digest.total === 2 &&
    digestText(digest).includes('wechat');
  return { ok, bad: { groups, off }, sample: digestText(digest) };
}