/**
 * 生活事件时间线 — 适配自 jiuyi777/xiao-shouji lifeEvents.ts
 */
const VALID_TYPES = new Set(['chat', 'call', 'diary', 'photo', 'calendar', 'music', 'social', 'video', 'memo', 'system']);
const VALID_APPS = new Set(['wechat', 'qq', 'phone', 'diary', 'calendar', 'gallery', 'xiaohongshu', 'bilibili', 'music', 'memo', 'system']);

function cleanText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeImportance(value) {
  if (typeof value !== 'number' || Number.isNaN(value)) return 3;
  return Math.min(5, Math.max(1, Math.round(value)));
}

export function buildLifeEvent(event) {
  const title = cleanText(event.title) || '生活事件';
  const summary = cleanText(event.summary);
  return {
    id: cleanText(event.id) || ('life-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)),
    type: VALID_TYPES.has(event.type) ? event.type : 'system',
    app: VALID_APPS.has(event.app) ? event.app : 'system',
    characterId: cleanText(event.characterId) || undefined,
    title,
    summary,
    mood: cleanText(event.mood) || undefined,
    importance: normalizeImportance(event.importance),
    sourceId: cleanText(event.sourceId) || undefined,
    readableByChar: event.readableByChar === undefined ? undefined : Boolean(event.readableByChar),
    createdAt: typeof event.createdAt === 'number' && Number.isFinite(event.createdAt) ? event.createdAt : Date.now()
  };
}

export function isHighValueChatLifeEventInput(input) {
  if (input?.favorite) return true;
  if (typeof input?.importance === 'number' && input.importance >= 4) return true;
  return Boolean(input?.summary && String(input.summary).trim().length >= 16 && String(input.summary).includes('重要'));
}

export class LifeEventStore {
  constructor(storage) {
    this.storage = storage;
    this.key = 'life_events_v1';
    this.events = [];
    this._load();
  }

  _load() {
    try {
      const raw = this.storage?.get?.(this.key);
      const data = typeof raw === 'string' ? JSON.parse(raw) : raw;
      this.events = Array.isArray(data) ? data.map((item) => buildLifeEvent(item)) : [];
    } catch (e) {
      this.events = [];
    }
  }

  _save() {
    try { this.storage?.set?.(this.key, this.events); } catch (e) {}
  }

  add(event) {
    const item = buildLifeEvent(event);
    if (!item.summary) return null;
    if (item.sourceId) {
      const same = this.events.find((entry) => entry.sourceId === item.sourceId && entry.type === item.type);
      if (same) return same;
    }
    this.events.unshift(item);
    this.events = this.events.slice(0, 200);
    this._save();
    return item;
  }

  /* 以 sourceId 定位并**就地更新**同一件事：
   *   日历备忘改了标题/日期/时间后，时间线显示的必须是改后的内容。
   *   旧实现让 add() 直接返回旧条目，于是时间线永远停在第一次写入的读数——
   *   不报错、不崩溃，只错数据（本仓最贵的形态）。找不到则回落为新增。 */
  updateBySource(sourceId, fields = {}) {
    const sid = cleanText(sourceId);
    if (!sid) return null;
    const entry = this.events.find((item) => item.sourceId === sid);
    if (!entry) return this.add({ ...fields, sourceId: sid });
    if (Object.prototype.hasOwnProperty.call(fields, 'title')) {
      entry.title = cleanText(fields.title) || entry.title;
    }
    if (Object.prototype.hasOwnProperty.call(fields, 'summary')) {
      const summary = cleanText(fields.summary);
      if (!summary) return null;          // 内容空了就不能留着旧读数冒充现状
      entry.summary = summary;
    }
    if (Object.prototype.hasOwnProperty.call(fields, 'importance')) {
      entry.importance = normalizeImportance(fields.importance);
    }
    if (Object.prototype.hasOwnProperty.call(fields, 'type')) {
      entry.type = VALID_TYPES.has(fields.type) ? fields.type : entry.type;
    }
    entry.updatedAt = Date.now();
    this._save();
    return entry;
  }
  /* 以 sourceId 移除：源头（日历备忘）被删后，时间线不得再持有它。 */
  removeBySource(sourceId) {
    const sid = cleanText(sourceId);
    if (!sid) return 0;
    const before = this.events.length;
    this.events = this.events.filter((item) => item.sourceId !== sid);
    const removed = before - this.events.length;
    if (removed) this._save();
    return removed;
  }
  timeline(filter = {}) {
    return this.events
      .filter((event) => !filter.characterId || event.characterId === filter.characterId)
      .filter((event) => !filter.minImportance || event.importance >= filter.minImportance)
      .slice(0, filter.limit || 40);
  }
}

export default LifeEventStore;