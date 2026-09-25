/* ========================================================
 * timeweaver-collector.js — 织光机数据收集器（主动聚合，完全原创）
 * 区别于 life-events.js 的被动上报，本收集器「主动读取」各 App 已沉淀的
 * 私有数据，逐源容错聚合成引擎可消费的 rawSources。任一源缺失/脏数据不毁整部。
 * ======================================================== */
'use strict';
import TW from './timeweaver-engine.js';
// [v2.36.0] 桥读取走 config/world-bridge.js 单一真源：
//   本文件此前**自写**了一份 `window.lonsha_memory_bridge_v1` 读取（只取 snapshot.recallAudit）。
//   同一份桥读取逻辑有两份实现必然漂移（且第二份不知道对方 v3.174 的 sourceState 可归因），
//   故收敛到一处——本文件只负责「取 recallAudit 这一块业务数据」，桥怎么读由真源决定。
import { readLonshaSnapshot } from '../../config/world-bridge.js';
// [v3.0.2] R2-C：上游**注入读数**的消费侧单一真源（与上面那条桥读取并列，
//   但读的是**不同的一面**：readLonshaSnapshot 取 recallAudit「召回了什么」，
//   本函数取 injection「最终送进上下文的是什么」——中间隔着预算裁剪与去重）。
import { readInjection, injectionLine } from '../../config/injection-contract.js';

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
 * [v2.15.0] 读取 LonSha 侧召回自检摘要（跨项目观测互喂）。
 *  数据源：window.lonsha_memory_bridge_v1.snapshot.recallAudit
 *  （lonsha v3.151 把 v3.150 召回自检账本压成只读摘要外供）。
 *  产出「你最常回望的时光」维度：轮数 / 空结果轮数 / 平均命中 / 热点楼层 Top10。
 *  插件未安装 / 未生成 / 旧版无该字段 → 返回 null（不影响织光机其它源）。
 */
export function collectLonshaRecall() {
  try {
    // [v2.36.0] 经单一真源读桥（只读、不抛、可归因）；本文件不再自己摸 window 全局。
    const r = readLonshaSnapshot();
    const snap = (r && r.ok && r.snapshot) ? r.snapshot : null;
    if (!snap) return null;   // 桥未装 / 对方未就绪 / 无快照 ⇒ 返回 null（不影响织光机其它源）
    const ra = snap.recallAudit;
    if (!ra || !Number(ra.rounds)) return null;
    const hotFloors = (Array.isArray(ra.hotFloors) ? ra.hotFloors : [])
      .map(h => ({ floor: Number(h && h.floor), count: Number(h && h.count) || 0 }))
      .filter(h => Number.isFinite(h.floor) && h.floor >= 0)
      .slice(0, 10);
    return {
      rounds: Number(ra.rounds) || 0,
      emptyRounds: Number(ra.emptyRounds) || 0,
      avgHits: Number(ra.avgHits) || 0,
      hotFloors,
      lastQuery: String(ra.lastQuery || '').slice(0, 80),
      lastTs: Number(ra.lastTs) || 0,
      pluginVersion: String(snap.pluginVersion || '')
    };
  } catch (e) { return null; }
}

/**
 * [v3.0.2] R2-C：读取 LonSha 侧的**注入读数**（本轮最终实际注入）。
 *
 * 与 `collectLonshaRecall` 的分工（两者常被混为一谈，是两个不同的问题）：
 *   · collectLonshaRecall —— 召回侧：「想起了哪段剧情」（recallAudit）；
 *   · collectLonshaInjection —— 送达侧：「哪几块**真的**进了上下文」（injection）。
 *   中间隔着预算裁剪与去重，故两边数字本就不该相等；少的那部分正是「被裁掉」的。
 *
 * 插件未装 / 未就绪 / 旧版无该字段 → 返回 null（不影响织光机其它源）。
 * 刻意**不在这里拼结论文案**：那是真源 injectionLine() 的活（单一出口）。
 */
export function collectLonshaInjection(win) {
  try {
    /* 显式注入 window（无头测试用；运行时不传即取全局）—— 与 config/world-bridge.js
       的 read* 同规格：消费方要能在无宿主环境下被独立驱动，否则行为面判据只能靠全局状态，
       而那正是本仓 v2.97 之前 7 份重复实现各自为政的温床。 */
    const r = readInjection(win);
    if (!r || r.reason !== 'ready') return null;
    return {
      verdict: r.verdict,
      line: injectionLine(r),
      round: r.round,
      origin: r.origin,
      strayOrigin: r.strayOrigin,
      total: r.total,
      kept: r.kept,
      dropped: r.dropped,
      chars: r.chars,
      tokens: r.tokens,
      ts: r.ts,
      blocks: r.blocks
    };
  } catch (e) { return null; }
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
  // [v2.15.0] 跨项目观测：LonSha 召回自检（你最常回望的时光）。独立于生活事件，空时不影响 empty 判定。
  const recall = (opts.withRecall === false) ? null : collectLonshaRecall();
  // [v3.0.2] R2-C：注入面与召回面**并列**（各答一个问题，不互相顶替）。
  //   注：刻意**不**并入 empty 判定 —— 生活事件为空时注入读数仍可能有效，
  //   把它算进 empty 会让「有剧情侧观测、没生活碎片」被误报成「什么都没有」。
  const injection = (opts.withRecall === false) ? null : collectLonshaInjection(opts.win);
  if (!events.length) return { events: [], empty: true, recall, injection };
  return {
    empty: false,
    events,
    recall,
    injection,
    timeline: TW.buildTimeline(events, opts.bucket || 'day'),
    milestones: TW.detectMilestones(events),
    curve: TW.buildMoodCurve(events, opts.window || 5),
    board: TW.buildAffinityBoard(events),
    letter: TW.composeLetter(events, opts)
  };
}

export default { collectSources, buildNarrative };