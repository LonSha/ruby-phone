/**
 * commitment-flow.js — 约定流程 [v2.74.0]
 *
 * 把一次约定从“一条备忘”推进为可追踪流程：
 *   proposed → confirmed → rescheduled → fulfilled / cancelled
 * 每次变化保留原因与事件键；终态不可逆，重复事件不重复生效。
 * 只投影已确认或改期后的约定，调用方再决定是否写入日历。
 */
const STATES = new Set(['proposed', 'confirmed', 'rescheduled', 'fulfilled', 'cancelled']);
export const TERMINAL = new Set(['fulfilled', 'cancelled']);
const MAX_ITEMS = 100;
const MAX_HISTORY = 12;

function clean(value, max = 160) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim().slice(0, max);
}
function int(value) {
  const n = Number(value);
  return Number.isInteger(n) ? n : null;
}
function copy(item) {
  return {
    id: clean(item.id, 80),
    actor: clean(item.actor, 40),
    with: clean(item.with, 40),
    content: clean(item.content, 160),
    dateKey: clean(item.dateKey, 32),
    time: clean(item.time, 16),
    place: clean(item.place, 80),
    status: STATES.has(item.status) ? item.status : 'proposed',
    revision: int(item.revision) || 1,
    history: Array.isArray(item.history) ? item.history.slice(-MAX_HISTORY).map((event) => ({
      action: clean(event.action, 20),
      eventKey: clean(event.eventKey, 120),
      reason: clean(event.reason, 120),
      at: int(event.at)
    })) : []
  };
}
export function normalizeCommitments(raw) {
  const source = Array.isArray(raw) ? raw : Array.isArray(raw?.items) ? raw.items : [];
  const seen = new Set();
  const items = [];
  for (const value of source) {
    const item = copy(value || {});
    if (!item.id || !item.actor || !item.content || seen.has(item.id)) continue;
    seen.add(item.id);
    items.push(item);
  }
  return { version: 1, items: items.slice(-MAX_ITEMS) };
}
function result(state, extra) {
  return { ok: true, state: normalizeCommitments(state), ...extra };
}
function reject(state, reason) {
  return { ok: false, reason, changed: false, state: normalizeCommitments(state) };
}
function nextId(state) {
  let max = 0;
  for (const item of state.items) {
    const n = Number(String(item.id).replace(/^apt_/, ''));
    if (Number.isInteger(n)) max = Math.max(max, n);
  }
  return 'apt_' + (max + 1);
}
function find(state, input) {
  const id = clean(input?.id, 80);
  if (id) return state.items.find((item) => item.id === id) || null;
  const actor = clean(input?.actor, 40);
  const content = clean(input?.content, 160);
  return state.items.find((item) => !TERMINAL.has(item.status) && item.actor === actor && item.content === content) || null;
}
function record(item, action, input) {
  const eventKey = clean(input?.eventKey, 120);
  if (eventKey && item.history.some((event) => event.eventKey === eventKey)) return false;
  item.history.push({ action, eventKey, reason: clean(input?.reason, 120), at: int(input?.at) });
  if (item.history.length > MAX_HISTORY) item.history = item.history.slice(-MAX_HISTORY);
  item.revision += 1;
  return true;
}

export function proposeCommitment(raw, input) {
  const state = normalizeCommitments(raw);
  const actor = clean(input?.actor, 40);
  const content = clean(input?.content, 160);
  if (!actor || !content || !/^\d{4}-\d{2}-\d{2}$/.test(clean(input?.dateKey, 32))) return reject(state, 'missing-fact');
  const existing = find(state, input);
  if (existing) return result(state, { item: copy(existing), replayed: true, changed: false });
  const item = copy({ ...input, id: nextId(state), actor, content, status: 'proposed', revision: 0, history: [] });
  record(item, 'propose', input);
  state.items.push(item);
  return result(state, { item: copy(item), replayed: false, changed: true });
}
function move(raw, action, status, input, apply) {
  const state = normalizeCommitments(raw);
  const item = find(state, input);
  if (!item) return reject(state, 'not-found');
  if (TERMINAL.has(item.status)) return result(state, { item: copy(item), replayed: true, changed: false, reason: 'terminal' });
  if (!record(item, action, input)) return result(state, { item: copy(item), replayed: true, changed: false });
  apply(item);
  item.status = status;
  return result(state, { item: copy(item), replayed: false, changed: true });
}
export const confirmCommitment = (raw, input) => move(raw, 'confirm', 'confirmed', input, () => {});
export const fulfillCommitment = (raw, input) => move(raw, 'fulfill', 'fulfilled', input, () => {});
export const cancelCommitment = (raw, input) => move(raw, 'cancel', 'cancelled', input, () => {});
export function rescheduleCommitment(raw, input) {
  const dateKey = clean(input?.dateKey, 32);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return reject(normalizeCommitments(raw), 'invalid-date');
  return move(raw, 'reschedule', 'rescheduled', input, (item) => {
    item.dateKey = dateKey;
    if (input?.time !== undefined) item.time = clean(input.time, 16);
    if (input?.place !== undefined) item.place = clean(input.place, 80);
  });
}
export function commitmentCalendarProjection(raw) {
  return normalizeCommitments(raw).items
    .filter((item) => item.status === 'confirmed' || item.status === 'rescheduled')
    .map((item) => ({
      sourceId: item.id,
      dateKey: item.dateKey,
      time: item.time,
      title: (item.with ? item.actor + '与' + item.with + '：' : item.actor + '：') + item.content,
      place: item.place,
      status: item.status
    }));
}
export function summarizeCommitments(raw) {
  const counts = { proposed: 0, confirmed: 0, rescheduled: 0, fulfilled: 0, cancelled: 0 };
  for (const item of normalizeCommitments(raw).items) counts[item.status] += 1;
  return counts;
}