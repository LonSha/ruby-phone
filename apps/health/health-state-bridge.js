/**
 * health-state-bridge.js — 生理状态交接适配层（v2.70.0）
 *
 * 设计来源：参考「角色生理状态引擎 ver5.57」的外部状态交接协议思路
 * （正文事实 → <state_handoff> → 规范化 → 校验 → 本地确定性应用），
 * 本文件为 RubyPhone 的**独立重写**，不包含、不依赖该引擎的任何实现、
 * 提示词、水印或完整性机制。
 *
 * 职责边界（刻意保持窄）：
 *   1. 从模型回复中提取并剥离 <state_handoff> 块；
 *   2. 把交接内容规范化为「已发生事实」的观察列表并校验；
 *   3. 只允许通过 HealthData 的既有确定性方法应用事实
 *      （applyNeed / addCondition / removeCondition / advanceHours），
 *      外部文本**不能直接覆盖**周期日、孕周、胎儿等本地状态机字段；
 *   4. 维护交接账本（去重、上限、可查询），随会话隔离。
 *
 * 铁律：
 *   - 只读不抛：任何畸形输入降级为「拒绝并说明原因」，绝不抛出；
 *   - 只认已发生事实：用户意图、命令、计划、未完成动作一律拒绝；
 *   - 本地算法是唯一真源：本层只投递事件，不计算生理数值。
 */

import { parseJsonTolerant } from '../../config/json-symbol-repair.js';

export const BRIDGE_VERSION = '2';
const HANDOFF_TAG = 'state_handoff';
export const LEDGER_LIMIT = 50;
/** [v4.31.0 · R5-O4] 事件账上限（与事实账同量级；两者各自裁剪，互不挤占）。 */
export const LEDGER_EVENT_LIMIT = 50;

/** 交接块正则：允许属性，内容惰性匹配到第一个闭合标签。 */
const HANDOFF_RE = /<state_handoff\b[^>]*>([\s\S]*?)<\/state_handoff>/gi;

/**
 * 事实类型表。
 * effect.kind:
 *   need      → HealthData.applyNeed(effect.type)（五维需求的确定性事件）
 *   condition → HealthData.addCondition(name, severity)
 *   resolve   → HealthData.removeCondition(name)
 *   advance   → HealthData.advanceHours(hours)（时间流逝，走本地状态机）
 * partial=true 的条目表达「部分缓解」：本地算法只有全量事件，
 *   故只记录、不投递，避免把「喝了一口水」误判成「口渴清零」。
 */
export const FACT_TYPES = Object.freeze({
  drink: { effect: { kind: 'need', type: 'drink' }, label: '饮水' },
  drink_partial: { effect: null, partial: true, label: '少量饮水（仅记录）' },
  meal: { effect: { kind: 'need', type: 'eat' }, label: '进食' },
  meal_partial: { effect: null, partial: true, label: '少量进食（仅记录）' },
  urination: { effect: { kind: 'need', type: 'void' }, label: '排尿' },
  urination_partial: { effect: null, partial: true, label: '少量排尿（仅记录）' },
  bowel_movement: { effect: { kind: 'need', type: 'defecate' }, label: '排便' },
  bowel_partial: { effect: null, partial: true, label: '少量排便（仅记录）' },
  wash: { effect: { kind: 'need', type: 'wash' }, label: '洗漱' },
  sleep: { effect: { kind: 'advance', hours: 8 }, label: '睡眠（推进 8 小时）' },
  nap: { effect: { kind: 'advance', hours: 1 }, label: '小憩（推进 1 小时）' },
  time_passed: { effect: { kind: 'advance' }, label: '时间流逝' },
  illness_onset: { effect: { kind: 'condition' }, label: '病症出现' },
  illness_resolved: { effect: { kind: 'resolve' }, label: '病症解除' },
});

const SEVERITIES = Object.freeze(['轻度', '中度', '重度']);

/** 意图/未完成标记：命中即拒绝，防止把愿望当成事实。 */
const INTENT_MARKERS = ['想要', '打算', '准备', '计划', '希望', '试图', '试着', '即将', '将要', '差点', '几乎', '没能', '未能', '没有成功'];

function clampStr(value, max) {
  const s = String(value == null ? '' : value).trim();
  return s.length > max ? s.slice(0, max) : s;
}

/** 解析单个交接块正文：优先 JSON，失败时按「类型: 说明」逐行解析。 */
export function parseHandoffBody(body) {
  const text = String(body == null ? '' : body).trim();
  if (!text) return [];
  const jsonStart = text.indexOf('{') >= 0 ? text.indexOf('{') : text.indexOf('[');
  if (jsonStart >= 0) {
    // [v2.94.0] 模型交接块是典型的「半合规 JSON」产地（尾逗号、缺分隔逗号、
    //   裸键）。旧实现 JSON.parse 一失败就整块落到按行解析，交接事实可能被丢掉。
    //   改走符号级修复器：仍严格优先，只在符号层面改动；铁律（只认已发生事实、
    //   本地算法是唯一真源）不受影响 —— 这里只负责「把块读出来」。
    const tolerant = parseJsonTolerant(text.slice(jsonStart));
    if (tolerant.ok) {
      const parsed = tolerant.value;
      if (Array.isArray(parsed)) return parsed;
      if (parsed && typeof parsed === 'object') {
        if (Array.isArray(parsed.facts)) return parsed.facts;
        if (parsed.type) return [parsed];
      }
    }
  }
  const facts = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim().replace(/^[-*]\s*/, '');
    if (!line) continue;
    const m = line.match(/^([a-z_]+)\s*[:：]\s*(.*)$/i);
    if (m) facts.push({ type: m[1].toLowerCase(), note: m[2] });
  }
  return facts;
}

/**
 * 提取回复中的全部交接块。
 * @returns {{ facts: object[], blocks: number }}
 */
export function extractStateHandoff(text) {
  const src = String(text == null ? '' : text);
  const facts = [];
  let blocks = 0;
  HANDOFF_RE.lastIndex = 0;
  let m;
  while ((m = HANDOFF_RE.exec(src))) {
    blocks += 1;
    for (const fact of parseHandoffBody(m[1])) facts.push(fact);
  }
  return { facts, blocks };
}

/** 剥离交接块，返回可展示的正文。交接块是协议数据，不应展示给用户。 */
function stripStateHandoff(text) {
  return String(text == null ? '' : text).replace(HANDOFF_RE, '').replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * 规范化并校验单条事实。
 * @returns {{ ok: true, fact: object } | { ok: false, reason: string }}
 */
export function normalizeFact(raw) {
  if (!raw || typeof raw !== 'object') return { ok: false, reason: 'not-object' };
  const type = String(raw.type || '').trim().toLowerCase();
  const spec = FACT_TYPES[type];
  if (!spec) return { ok: false, reason: 'unknown-type' };

  const note = clampStr(raw.note || raw.detail || '', 200);
  if (INTENT_MARKERS.some((marker) => note.includes(marker))) {
    return { ok: false, reason: 'intent-not-fact' };
  }

  const fact = { type, note, partial: spec.partial === true, effect: spec.effect, label: spec.label };

  if (spec.effect && spec.effect.kind === 'condition') {
    const name = clampStr(raw.name || raw.condition || '', 40);
    if (!name) return { ok: false, reason: 'condition-name-missing' };
    const severity = SEVERITIES.includes(raw.severity) ? raw.severity : '轻度';
    fact.name = name;
    fact.severity = severity;
  } else if (spec.effect && spec.effect.kind === 'resolve') {
    const name = clampStr(raw.name || raw.condition || '', 40);
    if (!name) return { ok: false, reason: 'condition-name-missing' };
    fact.name = name;
  } else if (type === 'time_passed') {
    const hours = Number(raw.hours);
    if (!Number.isFinite(hours) || hours <= 0 || hours > 48) {
      return { ok: false, reason: 'bad-hours' };
    }
    fact.hours = Math.round(hours * 10) / 10;
  }
  if (raw.id) fact.id = clampStr(raw.id, 60);
  return { ok: true, fact };
}

/** 批量规范化。返回 { accepted, rejected }，绝不抛出。 */
export function normalizeFacts(list) {
  const accepted = [];
  const rejected = [];
  const arr = Array.isArray(list) ? list : [];
  for (const raw of arr) {
    try {
      const res = normalizeFact(raw);
      if (res.ok) accepted.push(res.fact);
      else rejected.push({ reason: res.reason, type: raw && raw.type ? String(raw.type) : '' });
    } catch (e) {
      rejected.push({ reason: 'normalize-error', type: '' });
    }
  }
  return { accepted, rejected };
}

/**
 * 把已校验事实应用到 HealthData。
 * 只调用既有确定性方法；部分缓解类事实只记录不投递。
 * @returns {{ applied: object[], recorded: object[], skipped: object[] }}
 */
export function applyFacts(healthData, facts) {
  const applied = [];
  const recorded = [];
  const skipped = [];
  if (!healthData || typeof healthData !== 'object') {
    return { applied, recorded, skipped: [{ reason: 'no-health-data' }] };
  }
  for (const fact of Array.isArray(facts) ? facts : []) {
    try {
      if (fact.partial || !fact.effect) {
        recorded.push(fact);
        continue;
      }
      const effect = fact.effect;
      if (effect.kind === 'need' && typeof healthData.applyNeed === 'function') {
        healthData.applyNeed(effect.type);
        applied.push(fact);
      } else if (effect.kind === 'condition' && typeof healthData.addCondition === 'function') {
        const cond = healthData.addCondition(fact.name, fact.severity);
        if (cond) applied.push(fact);
        else skipped.push({ ...fact, reason: 'unknown-illness' });
      } else if (effect.kind === 'resolve' && typeof healthData.removeCondition === 'function') {
        healthData.removeCondition(fact.name);
        applied.push(fact);
      } else if (effect.kind === 'advance' && typeof healthData.advanceHours === 'function') {
        healthData.advanceHours(fact.hours != null ? fact.hours : effect.hours);
        applied.push(fact);
      } else {
        skipped.push({ ...fact, reason: 'effect-unsupported' });
      }
    } catch (e) {
      // [v4.31.0 · R5-O4] 保留原事实的身份字段（name/note/hours）：只留 type 会让「失败的那条」
      //   和原事实算出的键对不上，重试时被当成已处置 —— 正是「可重试」退化成「静默丢事实」的入口。
      skipped.push({ ...(fact && typeof fact === 'object' ? fact : {}), reason: 'apply-error' });
    }
  }
  return { applied, recorded, skipped };
}

function factKey(fact) {
  return [fact.type, fact.name || '', fact.note || '', fact.hours != null ? fact.hours : ''].join('|');
}

/**
 * [v4.31.0 · R5-O4] 交接事件的**内容指纹**（纯算术、无随机、无时钟）。
 *   用途：区分「同一条消息被重放」与「同一条消息的正文被改过（编辑 / 重生成）」——
 *   两者处置相反：前者静默跳过（幂等），后者必须**报出来**（不静默屏蔽、也不重复应用）。
 *   只取已校验事实的规范串：改标点/改排版而事实不变的编辑，不算换了一件事。
 */
export function fingerprintOf(facts) {
  const rows = (Array.isArray(facts) ? facts : []).map((f) => factKey(f || {})).sort();
  const s = rows.join('\u0001');
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = (h * 16777619) >>> 0;
  }
  return ('fp' + h.toString(16) + ':' + rows.length + ':' + s.length);
}

/**
 * [v4.31.0 · R5-O4] 事件身份键（**同一件事的唯一归属**）。
 *   取值优先级（可证边界，不猜）：
 *     ① 宿主给的消息身份（`meta.eventKey`，如 `msg:12`）⇒ 用它 ——
 *        同一楼层重发 / 重开重放都是同一条；不同楼层同文则是两件事，各计一次；
 *     ② 宿主给不出身份 ⇒ 回落内容指纹（`fp@...`）：只能证明「同样的事实来过一次」，
 *        故结果里 `identified:false` 如实标出，**不假装按事件去重**。
 *   ★ 身份里**不含** swipe / 版本号：重生成会换 swipe，若把它算进身份，
 *     同一条消息的两次生成会被当成两件事各自生效（正是本版要防的双计）。
 */
export function eventKeyOf(meta, fingerprint) {
  const m = (meta && typeof meta === 'object') ? meta : {};
  const given = String(m.eventKey == null ? '' : m.eventKey).trim();
  // 宿主把空值拼进身份（`msg:undefined` / `msg:null` / `msg:NaN`）时**不得当身份用**：
  //   那会让所有取不到 id 的消息共用同一个身份，把几件不同的事去重成一件（静默丢事实）。
  //   这类输入与「宿主给不出身份」同等处置 —— 回落内容指纹，identified:false。
  if (given && !/:(?:undefined|null|NaN)$/.test(given)) return { key: given.slice(0, 120), identified: true };
  return { key: ('fp@' + String(fingerprint || '')).slice(0, 120), identified: false };
}

/**
 * 交接账本：去重 + 上限，随会话隔离存储。
 * 账本只记录「发生过什么」，不保存任何可执行内容。
 */
export class HandoffLedger {
  constructor(storage, key) {
    this.storage = storage;
    // 键名以 storageKey 赋值形态声明：keys 门禁（K3）据此识别使用点
    this.storageKey = 'ruby_health_handoff';
    this.key = key || this.storageKey;
  }

  load() {
    try {
      const raw = this.storage?.get?.(this.key);
      if (raw && Array.isArray(raw.entries)) {
        // [v4.31.0 · R5-O4] 事件账与事实账**同住一个键**（不新增持久化键、不造第二份真源），
        //   两者各自裁剪、互不挤占：事实账满了不挤掉事件痕迹，反之亦然。
        if (!Array.isArray(raw.events)) raw.events = [];
        return raw;
      }
    } catch (e) { /* 降级为空账本 */ }
    return { version: BRIDGE_VERSION, entries: [], events: [] };
  }

  /**
   * [v4.31.0 · R5-O4] 取该**事件**的既有痕迹（没有则 null）。
   *   用途：`processReply` 的**应用前**幂等闸——先认这件事处理到哪一步，再决定投递什么。
   *   判据只认身份键本身（不做相似度、不按事实内容猜），判不了就是判不了。
   *   返回 `{ key, fp, settled: string[] , ...}`；`settled` 是该事件里**已处置过**的事实键。
   */
  eventOf(eventKey) {
    const key = clampStr(eventKey || '', 120);
    if (!key) return null;
    const state = this.load();
    const hit = state.events.find((e) => e && e.key === key);
    if (!hit) return null;
    if (!Array.isArray(hit.settled)) hit.settled = [];
    return hit;
  }
  /**
   * 记录一批事实。重复事实（同类型+同说明）不重复入账。
   * [v4.31.0 · R5-O4] 同时登记**事件**（同一件事只记一次），供应用前幂等闸查询。
   *   事实账与事件账同住一个键、**各自裁剪**：事实账满了不挤掉事件痕迹，反之亦然
   *   （旧实现只有一个数组，上限一到就把最早的记录连同「这件事发生过」一起裁掉）。
   * @param {object[]} facts
   * @param {object} meta
   * @param {object} opts
   *   `opts.eventKey` —— 由 `eventKeyOf` 算出的身份键（单一出处）；缺省时回落内容指纹；
   *   `opts.settled`  —— 本事件里**已处置过**的事实键清单。给了它，本次只对「尚未处置」
   *     的那部分事实入账；不给则视为全量（旧调用点语义逐字不变）。
   *   `opts.held`     —— 本事件里**投递没成功**的事实键清单（如 `apply-error`）。
   *     它们既不入事实账、也**不算已处置**：留在「待处置」里等重试。
   * @returns {number} 新增条数
   */
  record(facts, meta = {}, opts = {}) {
    const state = this.load();
    const all = Array.isArray(facts) ? facts : [];
    // [v4.31.0 · R5-O4] 幂等的落点在**事实粒度**而非整条消息：
    //   中途失败（第二条事实抛错）时重试，第一条不能再来一遍，
    //   而没成功的那些必须仍然算「待处置」——否则「可重试」就变成了「静默丢事实」。
    const settled = new Set(Array.isArray(opts.settled) ? opts.settled : []);
    const held = new Set(Array.isArray(opts.held) ? opts.held : []);
    const pending = all.filter((f) => {
      const k = factKey(f || {});
      return !settled.has(k) && !held.has(k);
    });
    const seenFacts = new Set(state.entries.map((e) => e.key));
    let added = 0;
    for (const fact of pending) {
      const key = factKey(fact);
      if (seenFacts.has(key)) continue;
      seenFacts.add(key);
      state.entries.push({
        key,
        type: fact.type,
        label: fact.label || fact.type,
        name: fact.name || '',
        note: fact.note || '',
        partial: fact.partial === true,
        source: clampStr(meta.source || '', 40),
        at: Date.now(),
      });
      added += 1;
    }
    if (state.entries.length > LEDGER_LIMIT) {
      state.entries = state.entries.slice(state.entries.length - LEDGER_LIMIT);
    }
    const fp = fingerprintOf(all);
    const key = clampStr(opts.eventKey || eventKeyOf({}, fp).key, 120);
    const hit = state.events.find((e) => e && e.key === key);
    const merged = new Set([
      ...(hit && Array.isArray(hit.settled) ? hit.settled : []),
      ...pending.map((f) => factKey(f || {})),
    ]);
    const row = {
      key,
      fp,
      rows: all.length,
      // 「这条身份是不是宿主给的可证身份」与 eventKeyOf 同源判据：回落指纹一律带 fp@ 前缀。
      identified: !/^fp@/.test(key),
      settled: [...merged],
      source: clampStr(meta.source || '', 40),
      at: Date.now(),
    };
    if (hit) Object.assign(hit, row);
    else state.events.push(row);
    if (state.events.length > LEDGER_EVENT_LIMIT) {
      state.events = state.events.slice(state.events.length - LEDGER_EVENT_LIMIT);
    }
    state.version = BRIDGE_VERSION;
    try { this.storage?.set?.(this.key, state); } catch (e) { /* 持久化失败不阻断 */ }
    return added;
  }
}

/**
 * 端到端处理一条回复：提取 → 规范化 → **应用前幂等闸** → 应用 → 入账。
 * 没有任何交接块时返回 null（调用方据此跳过）。
 *
 * [v4.31.0 · R5-O4] 幂等落在**事件 + 事实**双层：
 *   ① 事件层：同一件事（同 `eventKey`）重放 ⇒ 已处置的事实**不再投递**（`duplicate:true`，静默）；
 *      不同消息即使正文相同也是**两件不同的事**（`eventKey` 不同、`fp` 相同）⇒ 各计一次；
 *   ② 事实层：投递抛错的那条**不算已处置**（进 `held`），重试时只补它，成功过的不会重来。
 * 身份从 `meta` 传入（见 `eventKeyOf`）；调用方给不出身份时如实回落内容指纹并标 `identified:false`，
 * **不假装按事件去重**。适配层仍然只投递事件、不计算任何生理数值。
 *
 * @param {string} text
 * @param {object} healthData
 * @param {object} ledger
 * @param {object} [meta] 宿主可证身份，如 `{ eventKey: 'msg:12', source: 'chat' }`
 */
export function processReply(text, healthData, ledger, meta = {}) {
  let extracted;
  try {
    extracted = extractStateHandoff(text);
  } catch (e) {
    return { blocks: 0, accepted: [], rejected: [{ reason: 'extract-error' }], applied: [], recorded: [], skipped: [], ledgerAdded: 0, duplicate: false, eventKey: '', identified: false, deferred: 0, held: [] };
  }
  if (!extracted.blocks) return null;
  const { accepted, rejected } = normalizeFacts(extracted.facts);
  const fp = fingerprintOf(accepted);
  const { key: eventKey, identified } = eventKeyOf(meta, fp);
  // 应用前幂等闸：先认这件事处理到哪一步。账本缺失/查询抛错 ⇒ 当作「没有痕迹」，
  //   宁可重复一次也不静默吞掉事实（只读不抛：这里不向外抛任何异常）。
  let settled = [];
  if (ledger && typeof ledger.eventOf === 'function') {
    try {
      const hit = ledger.eventOf(eventKey);
      if (hit && Array.isArray(hit.settled)) settled = hit.settled;
    } catch (e) { settled = []; }
  }
  const settledSet = new Set(settled);
  const pending = accepted.filter((f) => !settledSet.has(factKey(f || {})));
  const duplicate = accepted.length > 0 && pending.length === 0;
  const { applied, recorded, skipped } = applyFacts(healthData, pending);
  // 投递失败的（apply-error）**不算已处置**：留给重试补投，否则「可重试」等于「静默丢事实」。
  //   确定性结论（未知病症 / 效果不支持）重试也不会变，按已处置处理，避免无限重试。
  const heldKeys = [];
  const noData = skipped.some((s) => s && s.reason === 'no-health-data');
  if (noData) for (const f of pending) heldKeys.push(factKey(f || {}));
  else for (const s of skipped) if (s && s.reason === 'apply-error') heldKeys.push(factKey(s || {}));
  let ledgerAdded = 0;
  // 没有任何**已校验事实**时不落事件：全部被拒（意图/未知类型）的回复不是一件事，
  //   给它留事件痕迹只会灌满 LEDGER_EVENT_LIMIT、把真事件挤掉（上限是 50，很窄）。
  if (ledger && accepted.length > 0 && typeof ledger.record === 'function') {
    try {
      ledgerAdded = ledger.record(pending, meta, { eventKey, settled, held: heldKeys });
    } catch (e) { ledgerAdded = 0; }
  }
  return {
    blocks: extracted.blocks,
    accepted,
    rejected,
    applied,
    recorded,
    skipped,
    ledgerAdded,
    // ★ 新字段（只增不改）：调用方据此区分「静默跳过」与「真的没内容」，不需要猜。
    duplicate,
    eventKey,
    identified,
    deferred: accepted.length - pending.length,
    held: heldKeys,
  };
}
