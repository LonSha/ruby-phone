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

export const BRIDGE_VERSION = '1';
const HANDOFF_TAG = 'state_handoff';
export const LEDGER_LIMIT = 50;

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
      skipped.push({ type: fact && fact.type, reason: 'apply-error' });
    }
  }
  return { applied, recorded, skipped };
}

function factKey(fact) {
  return [fact.type, fact.name || '', fact.note || '', fact.hours != null ? fact.hours : ''].join('|');
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
      if (raw && Array.isArray(raw.entries)) return raw;
    } catch (e) { /* 降级为空账本 */ }
    return { version: BRIDGE_VERSION, entries: [] };
  }

  /**
   * 记录一批事实。重复事实（同类型+同说明）不重复入账。
   * @returns {number} 新增条数
   */
  record(facts, meta = {}) {
    const state = this.load();
    const seen = new Set(state.entries.map((e) => e.key));
    let added = 0;
    for (const fact of Array.isArray(facts) ? facts : []) {
      const key = factKey(fact);
      if (seen.has(key)) continue;
      seen.add(key);
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
    state.version = BRIDGE_VERSION;
    try { this.storage?.set?.(this.key, state); } catch (e) { /* 持久化失败不阻断 */ }
    return added;
  }
}

/**
 * 端到端处理一条回复：提取 → 规范化 → 应用 → 入账。
 * 没有任何交接块时返回 null（调用方据此跳过）。
 */
export function processReply(text, healthData, ledger) {
  let extracted;
  try {
    extracted = extractStateHandoff(text);
  } catch (e) {
    return { blocks: 0, accepted: [], rejected: [{ reason: 'extract-error' }], applied: [], recorded: [], skipped: [], ledgerAdded: 0 };
  }
  if (!extracted.blocks) return null;
  const { accepted, rejected } = normalizeFacts(extracted.facts);
  const { applied, recorded, skipped } = applyFacts(healthData, accepted);
  let ledgerAdded = 0;
  if (ledger && typeof ledger.record === 'function') {
    try { ledgerAdded = ledger.record(accepted); } catch (e) { ledgerAdded = 0; }
  }
  return {
    blocks: extracted.blocks,
    accepted,
    rejected,
    applied,
    recorded,
    skipped,
    ledgerAdded,
  };
}
