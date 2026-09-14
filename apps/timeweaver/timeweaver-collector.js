/* ========================================================
 * timeweaver-collector.js — 织光机数据收集器（主动聚合，完全原创）
 * 区别于 life-events.js 的被动上报，本收集器「主动读取」各 App 已沉淀的
 * 私有数据，逐源容错聚合成引擎可消费的 rawSources。任一源缺失/脏数据不毁整部。
 * ======================================================== */
'use strict';
import TW from './timeweaver-engine.js';

// 安全读 storage 键并解析为数组
function readArr(storage, key) {
  try {
    const raw = storage?.get?.(key);
    const v = TW.parseMaybe(raw, null);
    if (Array.isArray(v)) return v;
    if (v && typeof v === 'object') {
      // 对象包数组的常见形态 {records:[]}/{entries:[]}/{list:[]}/{photos:[]}
      for (const k of ['records', 'entries', 'list', 'photos', 'items', 'data']) {
        if (Array.isArray(v[k])) return v[k];
      }
    }
    return [];
  } catch (e) { return []; }
}

// 从 chatMetadata 收集 st_virtual_phone_* 下疑似事件数组（兜底源）
function readChatMetaArrays(ctx) {
  const out = [];
  try {
    const meta = ctx?.chatMetadata;
    if (!meta || typeof meta !== 'object') return out;
    for (const [k, v] of Object.entries(meta)) {
      if (!k.startsWith('st_virtual_phone')) continue;
      const arr = Array.isArray(v) ? v : (v && Array.isArray(v.events) ? v.events : (v && Array.isArray(v.records) ? v.records : null));
      if (arr) for (const it of arr) if (it && typeof it === 'object') out.push({ ...it, _src: k });
    }
  } catch (e) {}
  return out;
}

/**
 * 主动聚合所有源 → rawSources（供 TW.normalizeEvents）
 * @param storage PhoneStorage 实例
 */
export function collectSources(storage) {
  const ctx = storage?.getContext?.() || null;
  const safe = (fn) => { try { return fn() || []; } catch (e) { return []; } };

  const raw = {
    diary:        safe(() => readArr(storage, 'diary_entries')),
    photos:       safe(() => readArr(storage, 'album_photos').concat(readArr(storage, 'album_records'), readArr(storage, 'gallery_photos'))),
    achievements: safe(() => readArr(storage, 'ruby_unlocked_achievements').concat(readArr(storage, 'achievements'))),
    calendar:     safe(() => readArr(storage, 'calendar_events').concat(readArr(storage, 'calendar_records'))),
    weibo:        safe(() => readArr(storage, 'weibo_posts').concat(readArr(storage, 'weibo_feed'))),
    honey:        safe(() => readArr(storage, 'honey_records').concat(readArr(storage, 'honey_messages'), readArr(storage, 'honey_moments'))),
    theater:      safe(() => readArr(storage, 'theater_scenes').concat(readArr(storage, 'theater_records'))),
    generic:      safe(() => readArr(storage, 'life_events_v1').map(e => ({ source: e.app || 'life', kind: e.type || 'note', title: e.title, body: e.summary, ts: e.createdAt, moodScore: TW.scoreMood((e.title||'')+' '+(e.summary||'')), weight: (e.importance||3) })))
      .concat(safe(() => readChatMetaArrays(ctx)).map(e => ({ source: e._src || 'chat', kind: 'note', title: e.title || e.summary || '', body: e.summary || e.content || '', ts: e.createdAt || e.ts, floor: e.floor, moodScore: TW.scoreMood((e.title||'')+' '+(e.summary||'')+(e.content||'')), weight: 1 })))
  };
  return raw;
}

/** 聚合 → 完整叙事模型（事件 + 时间线 + 里程碑 + 曲线 + 亲密度榜 + 信） */
export function buildNarrative(storage, opts = {}) {
  const raw = collectSources(storage);
  const events = TW.normalizeEvents(raw);
  if (!events.length) return { events: [], empty: true };
  return {
    empty: false,
    events,
    timeline: TW.buildTimeline(events, opts.bucket || 'day'),
    milestones: TW.detectMilestones(events),
    curve: TW.buildMoodCurve(events, opts.window || 5),
    board: TW.buildAffinityBoard(events),
    letter: TW.composeLetter(events, opts)
  };
}

export default { collectSources, buildNarrative };