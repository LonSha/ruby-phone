/* ========================================================
 * timeweaver-engine.js — 织光机 · 数字生活叙事引擎（核心，纯函数）
 * 【完全原创·LonSha 独有】跨 App 人生叙事聚合
 *
 * 创作动机（补全 ruby-phone 独有空白）：
 *   ruby-phone 28 个 App 是「当下的娱乐孤岛」——微信聊完即散、日记写完即存、
 *   照片拍过即忘、成就解锁即躺。没有一个 App 把散落的数字生活碎片整合成
 *   「可回顾的个人叙事」。本引擎是这种「跨 App 人生叙事」能力的从零实现，
 *   所有手机插件中独一无二。
 *
 * 设计原则：
 *   1. 容错聚合——各 App 数据结构不一且可能缺失，逐源 try/catch，失败跳过，
 *      绝不让单个 App 的脏数据毁掉整部叙事。
 *   2. 纯函数 core——不碰 DOM，输入「已解析的各源数据数组」，输出叙事模型，
 *      便于 node 独立单测。DOM 渲染在 timeweaver-view.js。
 *   3. 时间归一——各源时间戳五花八门（ms 时间戳/剧情日期字符串/楼号），
 *      统一归一为可排序的 sortKey（ms 优先，缺失用楼号回退）。
 *
 * 四大叙事能力：
 *   A. 生活流时间线  把所有源事件按时间编织成一条「数字生活流」
 *   B. 里程碑检测    首张照片/首篇日记/亲密度破阈/成就解锁等「第一次」与高光亮刻
 *   C. 情感曲线      聚合各源情感信号（复用叙事心电图词典思想）画出生活情绪走向
 *   D. 关系亲密度榜  统计各角色在各源的互动频次/情感浓度，生成「谁最重要」榜
 *   E. 年度信        把整个周期凝练成一封可导出的叙事信（数据驱动，非 LLM）
 *
 * ======================================================== */
'use strict';
// ESM（对齐 ruby-phone 引擎约定：config/drives-engine.js / jiwen-engine.js 均为纯 ESM export）

// ── 源定义：每种碎片归一为一个「生活事件 life-event」─────────────
// life-event: { source, kind, ts(排序键ms), floor, title, body, actors[], moodScore, weight, extra }
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, Number(n) || 0));
const text = v => typeof v === 'string' ? v.trim() : '';

// 情感词典（轻量复用叙事心电图思想，六维→单一 moodScore -1~1）
const MOOD_LEX = {
  pos: ['笑','喜','欢','甜','温柔','幸福','开心','快乐','欣慰','安心','温暖','悸动','心动','亲吻','拥抱','撒娇','宠溺','守护','陪伴','依靠','信任','珍惜','眷恋','牵挂','归处','承诺','爱','美好','治愈','感动'],
  neg: ['泪','哭','泣','悲伤','难过','心痛','绝望','失落','孤独','寂寞','遗憾','愧疚','心碎','哀','凄凉','黯然','牺牲','离别','怕','恐惧','惊','颤抖','不安','怒','愤','憎恨','怨','焦虑','疲惫','崩溃','危机','背叛','阴谋']
};
export function scoreMood(txt) {
  txt = text(txt);
  if (!txt) return 0;
  let pos = 0, neg = 0;
  for (const w of MOOD_LEX.pos) { let i=0,c=0; while((i=txt.indexOf(w,i))!==-1){c++;i+=w.length;} pos+=Math.min(c,3); }
  for (const w of MOOD_LEX.neg) { let i=0,c=0; while((i=txt.indexOf(w,i))!==-1){c++;i+=w.length;} neg+=Math.min(c,3); }
  const total = pos + neg;
  return total ? clamp((pos - neg) / total, -1, 1) : 0;
}

// 安全解析 JSON（可能是 string 或已解析对象）
export function parseMaybe(v, fallback) {
  if (v == null) return fallback;
  if (typeof v === 'object') return v;
  if (typeof v === 'string') { try { return JSON.parse(v); } catch (e) { return fallback; } }
  return fallback;
}

/* ================================================================
 * 归一化各源数据 → life-event[]
 * rawSources: { diary[], albums/photos[], achievements[], moods, calendar[], weibo[], honey[], theater[] }
 * 每源传入「已解析数组」，引擎内部逐条归一、容错跳过。
 * ================================================================ */
export function normalizeEvents(rawSources = {}) {
  const events = [];
  const push = (ev) => {
    if (!ev || !ev.title && !ev.body) return;
    events.push({
      source: text(ev.source) || 'unknown',
      kind: text(ev.kind) || 'note',
      ts: Number(ev.ts) || (Number(ev.floor) >= 0 ? Number(ev.floor) : 0),
      floor: Number(ev.floor) || null,
      title: text(ev.title).slice(0, 60),
      body: text(ev.body).slice(0, 400),
      actors: Array.isArray(ev.actors) ? ev.actors.map(a => text(a).slice(0, 30)).filter(Boolean) : [],
      moodScore: clamp(ev.moodScore ?? 0, -1, 1),
      weight: clamp(ev.weight ?? 1, 0, 10),
      extra: ev.extra && typeof ev.extra === 'object' ? ev.extra : {}
    });
  };

  // ── 日记 ──
  for (const d of (rawSources.diary || [])) {
    try {
      const content = text(d.content || d.body || d.text);
      if (!content) continue;
      push({
        source: 'diary', kind: 'diary',
        ts: d.createdAt || d.ts || d._ts,
        floor: d.endIndex ?? d.startIndex ?? d.floor,
        title: text(d.title) || content.slice(0, 20),
        body: content,
        actors: d.author ? [d.author] : (d.actors || []),
        moodScore: d.moodScore ?? scoreMood(content),
        weight: 2,
        extra: { date: d.date, photos: (d.photos||[]).length }
      });
    } catch (e) {}
  }

  // ── 相册/照片 ──
  for (const p of (rawSources.photos || rawSources.album || [])) {
    try {
      const desc = text(p.desc || p.caption || p.prompt || p.title);
      push({
        source: 'album', kind: 'photo',
        ts: p.createdAt || p.ts || p.timestamp,
        floor: p.floor ?? p.endIndex,
        title: desc ? `📷 ${desc.slice(0,24)}` : '📷 一张照片',
        body: desc,
        actors: p.author ? [p.author] : (p.characters || p.actors || []),
        moodScore: p.moodScore ?? scoreMood(desc),
        weight: 1.5,
        extra: { url: p.url || p.src }
      });
    } catch (e) {}
  }

  // ── 成就 ──
  for (const a of (rawSources.achievements || [])) {
    try {
      if (a.unlocked === false) continue;
      const name = text(a.name || a.title || a.id);
      if (!name) continue;
      push({
        source: 'achievement', kind: 'achievement',
        ts: a.unlockedAt || a.ts || a.createdAt,
        floor: a.floor,
        title: `🏆 ${name}`,
        body: text(a.desc || a.description),
        actors: [],
        moodScore: 0.8,
        weight: 3,
        extra: { icon: a.icon }
      });
    } catch (e) {}
  }

  // ── 日历事件 ──
  for (const c of (rawSources.calendar || [])) {
    try {
      const title = text(c.title || c.name || c.text);
      if (!title) continue;
      push({
        source: 'calendar', kind: 'event',
        ts: c.ts || c.timestamp || c.date,
        floor: c.floor,
        title: `📅 ${title}`,
        body: text(c.desc || c.note),
        actors: c.actors || (c.character ? [c.character] : []),
        moodScore: c.moodScore ?? scoreMood(title + ' ' + (c.desc||'')),
        weight: 2,
        extra: { date: c.date }
      });
    } catch (e) {}
  }

  // ── 微博/动态 ──
  for (const w of (rawSources.weibo || [])) {
    try {
      const content = text(w.content || w.text || w.body);
      if (!content) continue;
      push({
        source: 'weibo', kind: 'post',
        ts: w.createdAt || w.ts || w.timestamp,
        floor: w.floor,
        title: `💬 ${content.slice(0,24)}`,
        body: content,
        actors: w.author ? [w.author] : (w.character ? [w.character] : []),
        moodScore: w.moodScore ?? scoreMood(content),
        weight: 1,
        extra: { likes: w.likes, comments: w.comments }
      });
    } catch (e) {}
  }

  // ── 蜜语（亲密关系互动）──
  for (const h of (rawSources.honey || [])) {
    try {
      const content = text(h.content || h.text || h.message || h.body);
      const who = text(h.character || h.partner || h.with || h.name);
      if (!content && !who) continue;
      push({
        source: 'honey', kind: 'intimate',
        ts: h.createdAt || h.ts || h.timestamp,
        floor: h.floor,
        title: who ? `🍯 与${who}的蜜语` : '🍯 蜜语时刻',
        body: content,
        actors: who ? [who] : (h.actors || []),
        moodScore: h.moodScore ?? Math.max(0.3, scoreMood(content)),
        weight: 2,
        extra: { affinity: h.affinity || h.intimacy }
      });
    } catch (e) {}
  }

  // ── 剧场/剧情高光 ──
  for (const t of (rawSources.theater || [])) {
    try {
      const title = text(t.title || t.name || t.scene);
      if (!title) continue;
      push({
        source: 'theater', kind: 'scene',
        ts: t.createdAt || t.ts || t.timestamp,
        floor: t.floor,
        title: `🎭 ${title}`,
        body: text(t.desc || t.summary || t.content),
        actors: t.actors || t.characters || [],
        moodScore: t.moodScore ?? scoreMood(t.desc || t.summary || title),
        weight: 2,
        extra: {}
      });
    } catch (e) {}
  }

  // ── 通用兜底源（其它任何带 ts/floor + content/title 的条目）──
  for (const g of (rawSources.generic || [])) {
    try { push({ source: g.source || 'misc', kind: g.kind || 'note', ...g }); } catch (e) {}
  }

  // 按时间排序（ts 升序）
  events.sort((a, b) => a.ts - b.ts);
  return events;
}

/* ================================================================
 * A. 生活流时间线：按「日/周/月」分桶
 * ================================================================ */
export function buildTimeline(events, bucket = 'day') {
  const fmt = (ts) => {
    if (!ts || ts < 946684800000) return ts != null ? `第${Math.round(ts)}楼` : '未知时刻'; // <2000年视为楼号
    const d = new Date(ts);
    if (bucket === 'month') return `${d.getFullYear()}年${d.getMonth()+1}月`;
    if (bucket === 'week') { const w = new Date(ts); w.setDate(w.getDate() - w.getDay()); return `${w.getMonth()+1}月${w.getDate()}日 周`; }
    return `${d.getMonth()+1}月${d.getDate()}日`;
  };
  const buckets = new Map();
  for (const ev of events) {
    const key = fmt(ev.ts);
    if (!buckets.has(key)) buckets.set(key, { label: key, events: [], moodSum: 0, weight: 0 });
    const b = buckets.get(key);
    b.events.push(ev);
    b.moodSum += ev.moodScore;
    b.weight += ev.weight;
  }
  return [...buckets.values()].map(b => ({
    label: b.label,
    events: b.events,
    avgMood: b.events.length ? b.moodSum / b.events.length : 0,
    topEvent: b.events.slice().sort((x, y) => y.weight - x.weight)[0] || null
  }));
}

/* ================================================================
 * B. 里程碑检测：「第一次」与高光
 * ================================================================ */
export function detectMilestones(events) {
  const milestones = [];
  const seenFirst = new Set();
  const FIRST_LABEL = { photo: '第一张照片', diary: '第一篇日记', achievement: '第一个成就', intimate: '第一次蜜语', scene: '第一场剧场', post: '第一条动态', event: '第一个日程' };
  for (const ev of events) {
    // 各类「第一次」
    if (!seenFirst.has(ev.kind) && FIRST_LABEL[ev.kind]) {
      seenFirst.add(ev.kind);
      milestones.push({ ts: ev.ts, icon: '🌱', label: FIRST_LABEL[ev.kind], detail: ev.title, actors: ev.actors, weight: 3 });
    }
    // 高光：weight>=3 且情绪浓烈
    if (ev.weight >= 3 && Math.abs(ev.moodScore) >= 0.5 && ev.kind !== 'achievement') {
      milestones.push({ ts: ev.ts, icon: ev.moodScore > 0 ? '✨' : '🌧', label: ev.moodScore > 0 ? '高光时刻' : '深刻时刻', detail: ev.title, actors: ev.actors, weight: ev.weight });
    }
  }
  milestones.sort((a, b) => a.ts - b.ts);
  return milestones;
}

/* ================================================================
 * C. 情感曲线：按时间滑窗平均 moodScore
 * ================================================================ */
export function buildMoodCurve(events, window = 5) {
  if (!events.length) return [];
  const pts = [];
  for (let i = 0; i < events.length; i++) {
    const lo = Math.max(0, i - window + 1);
    const slice = events.slice(lo, i + 1);
    const avg = slice.reduce((s, e) => s + e.moodScore, 0) / slice.length;
    pts.push({ ts: events[i].ts, mood: avg, label: events[i].title });
  }
  return pts;
}

/* ================================================================
 * D. 关系亲密度榜：互动频次×情感浓度×跨源广度
 * ================================================================ */
export function buildAffinityBoard(events) {
  const board = {};
  for (const ev of events) {
    for (const actor of ev.actors) {
      if (!board[actor]) board[actor] = { name: actor, interactions: 0, moodSum: 0, sources: new Set(), weight: 0 };
      const b = board[actor];
      b.interactions++;
      b.moodSum += ev.moodScore;
      b.sources.add(ev.source);
      b.weight += ev.weight;
    }
  }
  return Object.values(board).map(b => ({
    name: b.name,
    interactions: b.interactions,
    avgMood: b.interactions ? b.moodSum / b.interactions : 0,
    breadth: b.sources.size,
    // 亲密度 = 频次(归一)×情感(转正)×广度
    score: clamp(b.interactions * 2 + (b.moodSum > 0 ? b.moodSum : 0) * 3 + b.sources.size * 2, 0, 999)
  })).sort((a, b) => b.score - a.score);
}

/* ================================================================
 * E. 年度信 / 周期叙事信（数据驱动，非 LLM）
 * ================================================================ */
export function composeLetter(events, opts = {}) {
  if (!events.length) return null;
  const tl = buildTimeline(events, opts.bucket || 'day');
  const milestones = detectMilestones(events);
  const board = buildAffinityBoard(events);
  const curve = buildMoodCurve(events);
  const avgMood = events.reduce((s, e) => s + e.moodScore, 0) / events.length;
  const moodWord = avgMood > 0.3 ? '温暖明亮' : avgMood < -0.3 ? '跌宕起伏' : '平静流淌';
  const topPerson = board[0] || null;
  const topMoment = events.slice().sort((a, b) => b.weight - a.weight)[0] || null;
  const srcCount = new Set(events.map(e => e.source)).size;
  const firsts = milestones.filter(m => m.icon === '🌱').length;

  const paragraphs = [];
  paragraphs.push(`这段时间，你的数字生活留下了 ${events.length} 个碎片，散落在 ${srcCount} 个角落，整体是${moodWord}的。`);
  if (firsts) paragraphs.push(`你经历了 ${firsts} 个「第一次」——${milestones.filter(m=>m.icon==='🌱').slice(0,3).map(m=>m.label).join('、')}等，每一个都是这段旅程的起点。`);
  if (topPerson) paragraphs.push(`${topPerson.name} 是出现最多的人，共 ${topPerson.interactions} 次交集，横跨 ${topPerson.breadth} 个场景。${topPerson.avgMood > 0.2 ? '每一次相处都透着暖意。' : topPerson.avgMood < -0.2 ? '你们的故事里有泪也有成长。' : '平淡中自有默契。'}`);
  if (topMoment) paragraphs.push(`最深刻的片段，是「${topMoment.title}」。${topMoment.moodScore > 0.3 ? '那一刻的光，值得被记住。' : topMoment.moodScore < -0.3 ? '那一刻的重量，塑造了现在的你。' : '那一刻，安静地留在了时光里。'}`);
  const highDays = tl.filter(t => t.avgMood > 0.3).length, lowDays = tl.filter(t => t.avgMood < -0.3).length;
  if (highDays || lowDays) paragraphs.push(`回望这段路，有 ${highDays} 段明亮的时光${lowDays ? `，也有 ${lowDays} 段需要撑过去的日子` : ''}。它们加在一起，才是完整的生活。`);
  paragraphs.push('—— 织光机 · 为你把散落的碎片，织成值得回望的光。');

  return {
    title: opts.title || '一段被织起的时光',
    paragraphs,
    stats: { total: events.length, sources: srcCount, firsts, avgMood, topPerson: topPerson?.name || null, topMoment: topMoment?.title || null, highDays, lowDays },
    milestones, board, curve, timeline: tl
  };
}

// ── 导出 ─────────────────────────────────────────────
const api = { normalizeEvents, buildTimeline, detectMilestones, buildMoodCurve, buildAffinityBoard, composeLetter, scoreMood, parseMaybe };
if (typeof window !== 'undefined') window.LonShaTimeweaver = api;
export default api;