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

  timeline(filter = {}) {
    return this.events
      .filter((event) => !filter.characterId || event.characterId === filter.characterId)
      .filter((event) => !filter.minImportance || event.importance >= filter.minImportance)
      .slice(0, filter.limit || 40);
  }
}

export default LifeEventStore;