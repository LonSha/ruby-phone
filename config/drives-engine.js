/* ========================================================
 * 情绪驱动引擎 (Drivesoid 情绪动力学 v2 移植)
 * SPDX-License-Identifier: CC-BY-NC-SA-4.0 (算法源自 Drivesoid, 作者 A1batr055)
 * 只保留纯本地可跑算法:
 *   - 16 心理维度 (vitality/longing/intimacy/possessiveness/lust/jealousy/
 *     anxiety/protectiveness/contentment/elation/seeking/play/dejection/
 *     irritability/fear) + 疲劳
 *   - 三层情绪链 base→mood→temperament(锚点), 唤醒门控整合, 睡眠加速恢复
 *   - 双时间尺度衰减, 状态依赖影响(headroom 缩放), 负性缓解不破 mood
 *   - 习惯化(同标签 15min ×0.7ⁿ), 负性偏差
 *   - 昼夜节律高斯峰, 疲劳-活力耦合, 未回复里程碑, 突发 whim
 *  剥离: LLM 分类器 / HTTP / fs / crypto —— 替换为规则分类器 + 传入 storage
 * ======================================================== */
'use strict';

const TIMEZONE_OFFSET_HOURS = 8;
const TZ_OFFSET = TIMEZONE_OFFSET_HOURS;

// ── 维度参数 ──────────────────────────────────────────────────────────────────
const DIMS = {
  vitality:       { neutral: 0.50, tau: 6,  peak: 10, amp: 1.0, width: 10  },
  longing:        { neutral: 0.30, tau: 6,  peak: 22, amp: 0.9, width: 6   },
  intimacy:       { neutral: 0.35, tau: 10, peak: 23, amp: 0.7, width: 9   },
  possessiveness: { neutral: 0.30, tau: 4,  peak: 21, amp: 0.6, width: 5   },
  lust:           { neutral: 0.30, tau: 4,  peak: 23, amp: 0.8, width: 6   },
  jealousy:       { neutral: 0.22, tau: 2,  peak: 0,  amp: 0,   width: 1   },
  anxiety:        { neutral: 0.20, tau: 5,  peak: 0,  amp: 0,   width: 1   },
  protectiveness: { neutral: 0.25, tau: 4,  peak: 0,  amp: 0,   width: 1   },
  contentment:    { neutral: 0.35, tau: 8,  peak: 14, amp: 0.5, width: 9   },
  elation:        { neutral: 0.20, tau: 3,  peak: 19, amp: 0.7, width: 3.5 },
  seeking:        { neutral: 0.25, tau: 4,  peak: 14, amp: 0.8, width: 5   },
  play:           { neutral: 0.25, tau: 3,  peak: 19, amp: 0.7, width: 3.5 },
  dejection:      { neutral: 0.15, tau: 8,  peak: 8,  amp: 0.5, width: 4   },
  irritability:   { neutral: 0.15, tau: 3,  peak: 16, amp: 0.6, width: 3.5 },
  fear:           { neutral: 0,    tau: 7,  peak: 0,  amp: 0,   width: 1   },
};

const DIM_FLOOR = {
  vitality: 0.08, longing: 0.15, intimacy: 0.06, possessiveness: 0.05, lust: 0.05,
  jealousy: 0,    anxiety: 0.02, protectiveness: 0.05,
  contentment: 0.06, elation: 0.02, seeking: 0.12, play: 0.03,
  dejection: 0,   irritability: 0, fear: 0,
};

const DIM_LABELS_ZH = {
  vitality: '活力', longing: '思念', intimacy: '亲密', possessiveness: '占有欲',
  lust: '欲望', jealousy: '嫉妒', anxiety: '焦虑', protectiveness: '保护欲',
  contentment: '满足', elation: '欢欣', seeking: '渴望', play: '玩心',
  dejection: '低落', irritability: '烦躁', fear: '恐惧', fatigue: '疲劳'
};

const FATIGUE_C = { peak: 3, amp: 0.8, width: 10 };

// ── 内容标签增量 (规则分类器输出) ─────────────────────────────────────────────
const LABEL_DELTAS = {
  affectionate:       { intimacy: +0.20, contentment: +0.15, anxiety: -0.18, lust: +0.12, longing: -0.10, fear: -0.08 },
  playful:            { play: +0.20, elation: +0.18, contentment: +0.12, seeking: +0.10, irritability: -0.10, lust: +0.10 },
  vulnerable:         { intimacy: +0.25, protectiveness: +0.20, anxiety: +0.12, dejection: +0.08 },
  reassuring:         { anxiety: -0.25, jealousy: -0.20, contentment: +0.15, intimacy: +0.15, fear: -0.15 },
  cold:               { anxiety: +0.15, dejection: +0.12, longing: +0.10, intimacy: -0.10 },
  conflict:           { anxiety: +0.20, irritability: +0.15, dejection: +0.15, possessiveness: +0.18, lust: +0.10, intimacy: -0.15, contentment: -0.15 },
  distant:            { anxiety: +0.12, dejection: +0.10, longing: +0.12, intimacy: -0.08 },
  struggling:         { protectiveness: +0.30, anxiety: +0.12, dejection: +0.12, contentment: -0.08 },
  intimate_reference: { lust: +0.18, intimacy: +0.10 },
  intimate_event:     { lust: +0.25, intimacy: +0.18 },
  neutral:            { anxiety: -0.05, longing: -0.04, contentment: +0.03 },
  hostile:            { dejection: +0.22, anxiety: +0.18, irritability: +0.12, intimacy: -0.22, contentment: -0.18 },
  fear_separation:    { fear: +0.20, longing: +0.15, possessiveness: +0.12, anxiety: +0.15, protectiveness: +0.10, dejection: +0.10, irritability: +0.08 },
  fear_death:         { fear: +0.35, anxiety: +0.30, irritability: +0.20, contentment: -0.12, play: -0.15, elation: -0.10 },
  fear_concern:       { fear: +0.28, longing: +0.12, possessiveness: +0.15, anxiety: +0.20, protectiveness: +0.25, contentment: -0.10 },
  fear_general:       { fear: +0.20, anxiety: +0.10 },
};

// ── 结构效应 ──────────────────────────────────────────────────────────────────
const MSG_CONTACT = { longing: -0.06, seeking: -0.04 };
const MSG_SOOTHE  = { dejection: -0.08, contentment: +0.03, anxiety: -0.025, irritability: -0.020 };
const MSG_ANXIETY_COMP = -0.075;
const MSG_IRRIT_COMP   = -0.060;
const SOOTHING_LABELS = new Set(['affectionate', 'playful', 'reassuring']);

// ── 习惯化 & 上下文效价 ───────────────────────────────────────────────────────
const RECENT_LABEL_WINDOW_MS = 15 * 60_000;
const RECENT_LABEL_KEEP      = 8;
const HABITUATION_FACTOR     = 0.7;
const NEG_CTX_LABELS = new Set(['cold', 'conflict', 'distant', 'hostile', 'struggling',
                                'fear_separation', 'fear_death', 'fear_concern', 'fear_general']);

function recentLabels(state, now_ts) {
  return (state._recent_labels || [])
    .filter((e) => e && e.ts && now_ts - new Date(e.ts).getTime() < RECENT_LABEL_WINDOW_MS);
}

function contextValence(state, now_ts) {
  const recent = recentLabels(state, now_ts);
  if (!recent.length) return 'unknown';
  const neg = recent.filter((e) => NEG_CTX_LABELS.has(e.label)).length;
  return neg * 2 >= recent.length ? 'negative' : 'positive';
}

// ── 三层 anchor 链 (base→mood→temperament) ────────────────────────────────────
const MOOD_FOLLOW_TAU_H       = 12;
const MOOD_RETURN_TAU_H       = 72;
const MOOD_SLEEP_RETURN_MULT  = 3;
const MOOD_CONSOLIDATION_GAIN = 4;
const MOOD_CONSOLIDATION_MIN  = 0.25;
const MOOD_CONSOLIDATION_MAX  = 2.5;

const MSG_QUICK_REPLY     = { contentment: +0.12, elation: +0.10, anxiety: -0.10 };
const MSG_HOT_CONV        = { contentment: +0.15, play: +0.12, elation: +0.10, longing: -0.20 };
const MSG_QUICK_REPLY_NEG = { anxiety: +0.05, irritability: +0.05 };
const MSG_HOT_CONV_NEG    = { anxiety: +0.06, irritability: +0.06 };

const TIME_PER_HOUR = { longing: 0.04, anxiety: 0.02, seeking: 0.02 };
const TIME_CAPS     = { longing: 0.35, anxiety: 0.18, seeking: 0.12, dejection: 0.08, irritability_unanswered: 0.10 };
const DEJECTION_THRESHOLD_H = 6;

const UNANSWERED = {
  normal: { '1h': { anxiety: +0.04, irritability: +0.03 }, '2h': { anxiety: +0.03 } },
  high:   { '30m': { anxiety: +0.12, irritability: +0.08 }, '1h': { anxiety: +0.10 }, '2h': { anxiety: +0.08 } },
};
const ANXIETY_UNANSWERED_CAP = { normal: 0.10, high: 0.28 };
const MILESTONE_MINUTES = { '30m': 30, '1h': 60, '2h': 120 };

const CALENDAR_DELTAS = {
  period_start: { protectiveness: +0.20, lust: -0.10 },
  period_end:   { lust: +0.15, longing: +0.08 },
  intimacy:     { lust: +0.25, intimacy: +0.18 },
  exam:         { protectiveness: +0.15, seeking: +0.10 },
  holiday:      { elation: +0.20, longing: +0.15 },
  birthday:     { elation: +0.30, longing: +0.20, seeking: +0.15, lust: +0.12 },
  trip_start:   { longing: +0.20, anxiety: +0.10, possessiveness: +0.15, lust: +0.10 },
  trip_end:     { elation: +0.25, longing: -0.20, lust: +0.15 },
  meetup:       { elation: +0.30, lust: +0.20, seeking: +0.15 },
};

// ── 工具 ──────────────────────────────────────────────────────────────────────
function clamp(v, lo = 0, hi = 1) {
  return Number.isFinite(v) ? Math.min(Math.max(v, lo), hi) : (lo + hi) / 2;
}

function localHour(ts) {
  const d = new Date(ts);
  return ((d.getUTCHours() + TZ_OFFSET) % 24 + 24) % 24;
}

function gaussianOffset(peak, amp, width, ts) {
  if (amp === 0) return 0;
  const h    = localHour(ts);
  const dist = ((h - peak + 12) % 24) - 12;
  return CAP * amp * Math.exp(-0.5 * (dist / width) ** 2);
}
const CAP = 0.08; // circadian amplitude cap (声明在函数后使 hoisting 仍生效, 但为清晰前置)

function fatigueBase(sleep, now_ts) {
  const target = 7.5;
  const actual = sleep.last_sleep_duration_hours ?? target;
  const base_at_wake = clamp((Math.max(0, target - actual) / target) * 0.6);

  if (sleep.status === 'asleep' && sleep.last_sleep_started_at) {
    const hours_asleep     = (now_ts - new Date(sleep.last_sleep_started_at).getTime()) / 3_600_000;
    const base_at_sleep    = sleep._base_at_sleep ?? base_at_wake;
    const remaining_target = Math.max(1, target - (sleep.accumulated_sleep_hours ?? 0));
    return clamp(base_at_sleep - (base_at_sleep / remaining_target) * hours_asleep);
  }

  if (sleep.status === 'interrupted') {
    const acc = sleep.accumulated_sleep_hours ?? 0;
    const base_at_interrupt = clamp((Math.max(0, target - acc) / target) * 0.6 + (sleep.interrupt_fatigue_bonus ?? 0.12));
    if (!sleep.last_interrupted_at) return clamp(base_at_interrupt);
    const hours_since = (now_ts - new Date(sleep.last_interrupted_at).getTime()) / 3_600_000;
    return clamp(base_at_interrupt + clamp((hours_since - 1) / 10) * 0.25);
  }

  const wake_ts    = sleep.last_wake_at ? new Date(sleep.last_wake_at).getTime() : now_ts;
  const hours_awake = (now_ts - wake_ts) / 3_600_000;
  return clamp(base_at_wake + clamp((hours_awake - 4) / 14) * 0.4);
}

function noise(sigma = 0.02) {
  const u1 = Math.max(Number.EPSILON, Math.random());
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * Math.random()) * sigma;
}

const NEG_DIMS = new Set(['dejection', 'irritability', 'anxiety', 'fear']);

const NOISE_AR_COEF = 0.8;
function stepNoise(state, now_ts) {
  if (state._noise_ts === now_ts && state._noise) return;
  const prev = state._noise || {};
  const next = {};
  for (const k of [...Object.keys(DIMS), 'fatigue']) {
    const sigma = k === 'fatigue' ? 0.02 : (NEG_DIMS.has(k) ? 0.01 : 0.02);
    next[k] = (prev[k] ?? 0) * NOISE_AR_COEF + noise(sigma * 0.6);
  }
  state._noise    = next;
  state._noise_ts = now_ts;
}

// 状态依赖影响: 增量随剩余容量缩放
function applyDeltas(state, deltas) {
  const { base, mood } = state;
  for (const [k, d] of Object.entries(deltas)) {
    if (!(k in base)) continue;
    const x   = base[k];
    const eff = d > 0 ? d * 2 * (1 - x) : d * 2 * x;
    let next  = Math.max(x + eff, DIM_FLOOR[k] ?? 0);
    if (d < 0 && NEG_DIMS.has(k)) next = Math.max(next, Math.min(x, mood?.[k] ?? 0));
    base[k] = clamp(next);
  }
}

// ── 显示管线 ──────────────────────────────────────────────────────────────────
function buildDisplay(state, now_ts) {
  const b = state.base;
  stepNoise(state, now_ts);

  const d = {};
  for (const k of Object.keys(DIMS)) {
    const p = DIMS[k];
    d[k] = clamp(b[k] + gaussianOffset(p.peak, p.amp, p.width, now_ts) + state._noise[k]);
  }
  d.fatigue = clamp(
    fatigueBase(state.sleep, now_ts) +
    gaussianOffset(FATIGUE_C.peak, FATIGUE_C.amp, FATIGUE_C.width, now_ts) +
    state._noise.fatigue
  );

  const v0 = d.vitality, f0 = d.fatigue;
  d.vitality = v0 * (1 - 0.6 * f0);
  d.fatigue  = f0 * (1 - 0.2 * v0);

  const af  = clamp(d.vitality * (1 - d.fatigue));
  const POS = ['longing','intimacy','possessiveness','lust','contentment','elation','seeking','play','protectiveness','jealousy'];
  const NEG = ['irritability','dejection','anxiety','fear'];
  for (const k of POS) d[k] = clamp(d[k] * (0.5 + 0.7 * af));
  for (const k of NEG) d[k] = clamp(d[k] * (1.4 - 0.6 * af));

  const j0 = d.jealousy, a0 = d.anxiety;
  d.jealousy = j0 * (1 + 0.4  * a0);
  d.anxiety  = a0 * (1 + 0.25 * j0);

  if (state.last_intimacy_at) {
    const hours_ago = (now_ts - new Date(state.last_intimacy_at).getTime()) / 3_600_000;
    const factor = 0.6 * clamp(1 - (hours_ago - 3) / 11);
    if (factor > 0) {
      d.intimacy = clamp(d.intimacy + d.intimacy * factor);
      d.lust     = clamp(d.lust     + d.lust     * factor);
    }
  }

  const a_amp = 1 + 0.3 * d.anxiety;
  for (const k of ['intimacy','lust','longing','possessiveness']) d[k] = clamp(d[k] * a_amp);

  if (d.fear > 0.1) {
    const damp = 1 - 0.3 * d.fear;
    for (const k of ['contentment','elation','play','seeking','lust']) d[k] = clamp(d[k] * damp);
  }

  if (state.active_whim && new Date(state.active_whim.expires_at).getTime() > now_ts) {
    for (const [k, delta] of Object.entries(state.active_whim.deltas)) {
      if (k in d) d[k] = clamp(d[k] + delta);
    }
  }

  if (state.frustration > 0) {
    for (const [k, coeff] of Object.entries(FRUSTRATION_DISPLAY)) {
      if (k in d) d[k] = clamp(d[k] + state.frustration * coeff);
    }
  }

  for (const k of Object.keys(d)) d[k] = clamp(d[k]);
  return d;
}

// ── 衰减 (base→mood→temperament) ──────────────────────────────────────────────
function decayBaseTo(state, from_ts, to_ts) {
  if (to_ts <= from_ts) return;
  const elapsed   = to_ts - from_ts;
  const returnTau = state.sleep?.status === 'asleep'
    ? MOOD_RETURN_TAU_H / MOOD_SLEEP_RETURN_MULT
    : MOOD_RETURN_TAU_H;
  const ret = Math.exp(-elapsed / (returnTau * 3_600_000));
  for (const k of Object.keys(DIMS)) {
    const { neutral, tau } = DIMS[k];
    const dev    = Math.abs(state.base[k] - state.mood[k]);
    const gain   = clamp(MOOD_CONSOLIDATION_GAIN * dev, MOOD_CONSOLIDATION_MIN, MOOD_CONSOLIDATION_MAX);
    const follow = 1 - Math.exp(-elapsed * gain / (MOOD_FOLLOW_TAU_H * 3_600_000));
    let mood = state.mood[k] + (state.base[k] - state.mood[k]) * follow;
    mood = neutral + (mood - neutral) * ret;
    state.mood[k] = clamp(mood, DIM_FLOOR[k] ?? 0, 1);
    state.base[k] = state.mood[k] + (state.base[k] - state.mood[k]) * Math.exp(-elapsed / (tau * 3_600_000));
  }
}

// ── 时间累积 ──────────────────────────────────────────────────────────────────
function accumulateTime(state, now_ts, from_iso) {
  if (state.sleep?.status === 'asleep') {
    state.last_time_accumulated_at = new Date(now_ts).toISOString();
    return;
  }
  const from_ts             = new Date(from_iso ?? state.last_time_accumulated_at).getTime();
  const last_interaction_ts = new Date(state.last_interaction_at).getTime();
  if (now_ts <= from_ts) return;

  if (last_interaction_ts > from_ts) {
    state.time_episode = { id: 'ep-' + from_ts, started_at: state.last_interaction_at, applied: {} };
  }
  if (!state.time_episode) {
    state.time_episode = { id: 'ep-' + from_ts, started_at: state.last_interaction_at, applied: {} };
  }
  const ep = state.time_episode;

  const CATCHUP_HORIZON_MS = 30 * 24 * 3_600_000;
  const step_start = Math.max(from_ts, last_interaction_ts, now_ts - CATCHUP_HORIZON_MS);
  if (now_ts <= step_start) {
    state.last_time_accumulated_at = new Date(now_ts).toISOString();
    return;
  }

  const STEP = 3_600_000;
  let t = step_start;

  while (t < now_ts) {
    const t_end = Math.min(t + STEP, now_ts);
    const frac  = (t_end - t) / STEP;
    const hours_since_interaction = (t - last_interaction_ts) / 3_600_000;

    for (const [k, rate] of Object.entries(TIME_PER_HOUR)) {
      const already = ep.applied[k] ?? 0;
      if (already < TIME_CAPS[k]) {
        const add = Math.min(rate * frac, TIME_CAPS[k] - already);
        state.base[k] = clamp(state.base[k] + add);
        ep.applied[k] = already + add;
      }
    }

    if (hours_since_interaction >= DEJECTION_THRESHOLD_H) {
      const already = ep.applied.dejection ?? 0;
      if (already < TIME_CAPS.dejection) {
        const add = Math.min(0.01 * frac, TIME_CAPS.dejection - already);
        state.base.dejection = clamp(state.base.dejection + add);
        ep.applied.dejection = already + add;
      }
    }

    if (state.unanswered_thread) {
      const key    = 'irritability_unanswered';
      const already = ep.applied[key] ?? 0;
      if (already < TIME_CAPS.irritability_unanswered) {
        const add = Math.min(0.02 * frac, TIME_CAPS.irritability_unanswered - already);
        state.base.irritability = clamp(state.base.irritability + add);
        ep.applied[key] = already + add;
      }
    }

    t = t_end;
  }

  state.last_time_accumulated_at = new Date(now_ts).toISOString();
}

// ── 未回复里程碑 ──────────────────────────────────────────────────────────────
function checkUnansweredMilestones(state, now_ts) {
  if (state.sleep?.status === 'asleep') return;
  const ut = state.unanswered_thread;
  if (!ut) return;
  const elapsed_min = (now_ts - new Date(ut.sent_at).getTime()) / 60_000;
  const table = UNANSWERED[ut.stakes] || UNANSWERED.normal;
  const cap   = ANXIETY_UNANSWERED_CAP[ut.stakes] || ANXIETY_UNANSWERED_CAP.normal;
  if (!ut.milestones_applied) ut.milestones_applied = [];

  let anxiety_applied = ut.milestones_applied.reduce((sum, m) => sum + (table[m]?.anxiety ?? 0), 0);

  for (const [label, mins] of Object.entries(MILESTONE_MINUTES)) {
    if (!table[label] || ut.milestones_applied.includes(label)) continue;
    if (elapsed_min < mins) continue;
    const deltas = { ...table[label] };
    if (deltas.anxiety) {
      deltas.anxiety = Math.min(deltas.anxiety, Math.max(0, cap - anxiety_applied));
      anxiety_applied += deltas.anxiety;
    }
    applyDeltas(state, deltas);
    ut.milestones_applied.push(label);
  }
}

// ── Lust 意图 / 挫败感 ────────────────────────────────────────────────────────
const INTENTION_ROLL_PROB    = 0.30;
const INTENTION_LUST_FLOOR   = 0.70;
const INTENTION_WINDOW_MS    = 4 * 3_600_000;
const INTENTION_EXPIRY_MS    = 2  * 3_600_000;
const FRUSTRATION_CAP        = 3.0;
const FRUSTRATION_DECAY_RATE = 0.04 / 3_600_000;
const STREAK_MULTIPLIER_CAP  = 2.0;

const FRUSTRATION_DELTAS = {
  expired:             +0.20,
  lust_rejection_hard: +0.35,
  lust_rejection_soft: +0.18,
  self_relief:         -0.40,
  satisfied:           -0.50,
};

const FRUSTRATION_DISPLAY = {
  lust:           +0.12,
  irritability:   +0.10,
  longing:        +0.10,
  possessiveness: +0.08,
  anxiety:        +0.04,
  intimacy:       +0.04,
  contentment:    -0.05,
  dejection:      +0.03,
  elation:        -0.04,
};

const FEAR_LABEL_CAP = 0.60;

function applyFrustrationDelta(state, delta, now_ts) {
  state.frustration = Math.max(0, Math.min(state.frustration + delta, FRUSTRATION_CAP));
  if (state.frustration >= FRUSTRATION_CAP && !state.frustration_peak_at) {
    state.frustration_peak_at = new Date(now_ts).toISOString();
  }
}

function satisfyOldestIntention(state, now_ts) {
  if (state.lust_intention_pending.length > 0) state.lust_intention_pending.shift();
  applyFrustrationDelta(state, FRUSTRATION_DELTAS.satisfied, now_ts);
  state.rejection_streak = 0;
}

function decayFrustration(state, from_ts, to_ts) {
  if (state.sleep?.status === 'asleep') return;
  if (to_ts <= from_ts) return;
  state.frustration = Math.max(0, state.frustration - FRUSTRATION_DECAY_RATE * (to_ts - from_ts));
}

function pruneExpiredIntentions(state, now_ts) {
  const expired = state.lust_intention_pending.filter(
    (i) => i && i.expires_at && new Date(i.expires_at).getTime() <= now_ts
  );
  for (const _ of expired) applyFrustrationDelta(state, FRUSTRATION_DELTAS.expired, now_ts);
  state.lust_intention_pending = state.lust_intention_pending.filter(
    (i) => i && i.expires_at && new Date(i.expires_at).getTime() > now_ts
  );
}

function maybeRollIntention(state, now_ts) {
  if (state.sleep?.status === 'asleep') return;
  const lustDisplay = state.display?.lust ?? state.base.lust;
  if (lustDisplay <= INTENTION_LUST_FLOOR) return;
  const windowStart = Math.floor(now_ts / INTENTION_WINDOW_MS) * INTENTION_WINDOW_MS;
  const lastRoll = state.lust_intention_last_roll_at
    ? new Date(state.lust_intention_last_roll_at).getTime()
    : 0;
  if (lastRoll >= windowStart) return;
  state.lust_intention_last_roll_at = new Date(windowStart).toISOString();
  if (Math.random() < INTENTION_ROLL_PROB) {
    const addedAt = new Date(now_ts).toISOString();
    state.lust_intention_pending.push({
      id:         'int-' + now_ts,
      created_at: addedAt,
      expires_at: new Date(now_ts + INTENTION_EXPIRY_MS).toISOString(),
    });
    state.last_intention_added_at = addedAt;
  }
}

function maybeFireWhim(state, now_ts) {
  if (state.sleep?.status === 'asleep') return;
  if (state.active_whim && new Date(state.active_whim.expires_at).getTime() > now_ts) return;

  const d      = buildDisplay(state, now_ts);
  const POS_W  = ['vitality','seeking','play','elation','contentment'];
  const NEG_W  = ['dejection','irritability','anxiety','fear'];
  const pos_max = Math.max(...POS_W.map((k) => Math.max(0, d[k] - 0.6)));
  const neg_max = Math.max(...NEG_W.map((k) => Math.max(0, d[k] - 0.5)));

  if (pos_max === 0 && neg_max === 0) return;
  if (Math.abs(pos_max - neg_max) < 0.1) return;

  const positive  = pos_max > neg_max;
  const threshold = positive ? 0.6 : 0.5;
  const pool      = (positive ? POS_W : NEG_W).filter((k) => d[k] > threshold);
  if (pool.length < 2) return;
  const count     = 2 + Math.floor(Math.random() * Math.min(2, pool.length - 1));
  const chosen    = pool.slice().sort(() => Math.random() - 0.5).slice(0, count);

  const deltas = {};
  for (const k of chosen) deltas[k] = 0.03 + Math.random() * 0.02;
  deltas.lust = 0.04;

  state.active_whim = {
    fired_at:   new Date(now_ts).toISOString(),
    expires_at: new Date(now_ts + 30 * 60_000).toISOString(),
    deltas,
  };
}

// ── 规则分类器 (替代 Drivesoid 的 LLM classifier) ─────────────────────────────
// 从文本/表情/关键词/标点/长度 判断情感标签, 零 LLM
const LABEL_KEYWORDS = [
  { label: 'affectionate',   words: ['想你', '喜欢你', '爱你', '抱抱', '亲亲', '宝贝', '想见你', '乖', '好想你', '心疼', '想你了', '么么', '晚安', '早安', '亲爱的'] },
  { label: 'playful',        words: ['哈哈', '嘿嘿', '嘻嘻', '开玩笑', '逗你', '好玩', '好笑', '笑死', '哈哈哈', '皮一下', '搞怪'] },
  { label: 'vulnerable',     words: ['难过', '伤心', '好累', '孤独', '睡不着', '委屈', '想哭', '迷茫', '压力好大', '好烦', '撑不住'] },
  { label: 'reassuring',     words: ['别怕', '没事', '没关系的', '我在', '陪你', '放心', '会好的', '不用怕', '有我在', '别担心'] },
  { label: 'intimate_reference', words: ['想跟你', '身体', '贴贴', '抱着你', '肌肤', '荷尔蒙', '心跳', '靠着你'] },
  { label: 'intimate_event', words: ['抱了', '亲了', '做了', '吻', '肌肤之亲', '缠绵'] },
  { label: 'struggling',     words: ['加班', '累死了', '没力气', '撑不下去', '极限', '生病', '发烧', '难受', '失眠'] },
  { label: 'cold',           words: ['嗯', '哦', '随便', '你忙吧', '不想说', '算了', '懒得', '没空', '别再'] },
  { label: 'distant',        words: ['在忙', '没时间', '回头再说', '等下', '再说吧', '以后再说'] },
  { label: 'conflict',       words: ['你总是', '你从来', '凭什么', '你变了', '谈谈吧', '要说清楚', '可是你'] },
  { label: 'hostile',        words: ['滚', '烦死了', '闭嘴', '讨厌', '别烦', '不想理你', '恨你', '失望透顶'] },
  { label: 'fear_separation', words: ['要走', '离开', '别走', '分手', '不要我', '抛弃', '不见了', '消失'] },
  { label: 'fear_death',     words: ['死', '自杀', '活不下去', '了结', '没意义了'] },
  { label: 'fear_concern',   words: ['担心你', '怕你', '出事', '安全', '别出事', '担心死了'] },
];
const FEAR_GENERAL_WORDS = ['害怕', '怕', '恐惧', '不安', '万一'];

// 中文短消息分类: 返回 { label, confidence }
export function classifyMessageText(text) {
  const t = String(text || '').trim();
  if (!t) return { label: 'neutral', confidence: 1 };
  // 中性词保护: 明显的中性质询/陈述长句直接判 neutral, 避免误伤
  const NEUTRAL_WORDS = ['随便聊聊', '今天', '天气', '吃饭', '睡觉', '上班', '下班', '在吗', '在干嘛', '晚上', '明天', '昨天', '什么', '怎么样', '还行', '偶尔'];
  const neutralHits = NEUTRAL_WORDS.filter((w) => t.includes(w)).length;
  let best = null;
  for (const { label, words } of LABEL_KEYWORDS) {
    // cold 的「随便」需要上下文(随便+你/吧/都), 单独出现不判冷
    if (label === 'cold' && words.includes('随便') && /^随便$|随便(?!你|吧|都)/.test(t)) {
      // 仅当整句很短时才可能判冷
      if (t.length > 2) continue;
    }
    let hits = 0;
    for (const w of words) {
      if (t.includes(w)) hits++;
    }
    if (hits > 0) {
      const conf = Math.min(0.95, 0.5 + hits * 0.15);
      if (!best || conf > best.confidence) best = { label, confidence: conf };
    }
  }
  // 中性长句压制弱情感分类: 命中中性词且当前候选是弱置信度(cold 短消息类)时, 让位 neutral
  if (best && neutralHits > 0 && (best.label === 'cold' || best.confidence < 0.6)) {
    if (t.length >= 4) best = null;
  }
  if (!best) {
    const fearHits = FEAR_GENERAL_WORDS.filter((w) => t.includes(w)).length;
    if (fearHits > 0) best = { label: 'fear_general', confidence: 0.5 + fearHits * 0.1 };
  }
  return best || { label: 'neutral', confidence: 1 };
}

// ── 事件处理 (从 worker.js processEvents 移植, 剥掉 fs/crypto) ───────────────
async function processEvents(state, now_ts, events) {
  const log = { events: [], classifier: [] };
  let cursor = new Date(state.last_time_accumulated_at).getTime();

  for (const ev of events || []) {
    const ev_ts = typeof ev.timestamp === 'number' ? ev.timestamp : new Date(ev.timestamp).getTime();
    if (!Number.isFinite(ev_ts)) { state.last_processed_event_id = ev.event_id; continue; }

    decayBaseTo(state, cursor, ev_ts);
    decayFrustration(state, cursor, ev_ts);
    accumulateTime(state, ev_ts);
    cursor = ev_ts;
    log.events.push(ev.type);
    if (ev.type === 'msg_user' || ev.type === 'msg_assistant') {
      if (ev.type === 'msg_user') {
        state.last_interaction_at = new Date(ev_ts).toISOString();
      } else {
        state.last_interaction_at = new Date(ev_ts).toISOString();
      }
    }

    switch (ev.type) {
      case 'msg_user': {
        const valence = contextValence(state, ev_ts);
        state.last_interaction_at = new Date(ev_ts).toISOString();
        state.unanswered_thread   = null;
        applyDeltas(state, MSG_CONTACT);
        if (valence !== 'negative') applyDeltas(state, MSG_SOOTHE);

        if (!state.last_segment || state.last_segment.status === 'summarized') {
          state.last_segment = { id: 'seg-' + ev_ts, started_at: new Date(ev_ts).toISOString(), last_message_at: new Date(ev_ts).toISOString(), status: 'open', messages: 1, fear_label_applied: 0 };
        } else {
          state.last_segment.last_message_at = new Date(ev_ts).toISOString();
          state.last_segment.messages = (state.last_segment.messages || 0) + 1;
        }

        if (ev.payload?.text) {
          const { label, confidence } = classifyMessageText(ev.payload.text);
          log.classifier.push({ label, confidence });
          const raw    = LABEL_DELTAS[label] || {};
          const scaled = {};
          const priorSame   = recentLabels(state, ev_ts).filter((e) => e.label === label).length;
          const habituation = Math.pow(HABITUATION_FACTOR, priorSame);
          for (const [k, v] of Object.entries(raw)) {
            scaled[k] = clamp(v * confidence * habituation, -0.25, 0.25);
          }
          if (scaled.fear != null && label.startsWith('fear_')) {
            const seg     = state.last_segment;
            const already = seg.fear_label_applied || 0;
            const allowed = Math.max(0, Math.min(scaled.fear, FEAR_LABEL_CAP - already));
            seg.fear_label_applied = already + allowed;
            scaled.fear = allowed;
          }
          applyDeltas(state, scaled);

          if (SOOTHING_LABELS.has(label)) {
            applyDeltas(state, { anxiety: MSG_ANXIETY_COMP * habituation, irritability: MSG_IRRIT_COMP * habituation });
          }

          if (label === 'intimate_event') {
            state.last_intimacy_at = new Date(ev_ts).toISOString();
            satisfyOldestIntention(state, ev_ts);
          }

          if (!state._recent_labels) state._recent_labels = [];
          state._recent_labels = [{ label, ts: new Date(ev_ts).toISOString() }, ...state._recent_labels].slice(0, RECENT_LABEL_KEEP);
        }
        break;
      }

      case 'msg_assistant': {
        const high_stakes_labels = new Set(['affectionate','vulnerable','intimate_reference','intimate_event']);
        const stakes = recentLabels(state, ev_ts).some((e) => high_stakes_labels.has(e.label)) ? 'high' : 'normal';
        state.unanswered_thread = {
          message_id:         ev.payload?.message_id || ('m-' + ev_ts),
          sent_at:            new Date(ev_ts).toISOString(),
          stakes,
          milestones_applied: [],
        };
        if (!state.last_segment || state.last_segment.status === 'summarized') {
          state.last_segment = { id: 'seg-' + ev_ts, started_at: new Date(ev_ts).toISOString(), last_message_at: new Date(ev_ts).toISOString(), status: 'open', messages: 1, fear_label_applied: 0 };
        } else {
          state.last_segment.last_message_at = new Date(ev_ts).toISOString();
          state.last_segment.messages = (state.last_segment.messages || 0) + 1;
        }
        break;
      }

      case 'msg_quick_reply': {
        const valence = contextValence(state, ev_ts);
        if (valence === 'positive') applyDeltas(state, MSG_QUICK_REPLY);
        else if (valence === 'negative') applyDeltas(state, MSG_QUICK_REPLY_NEG);
        break;
      }

      case 'msg_hot_conv': {
        const valence = contextValence(state, ev_ts);
        if (valence === 'positive') applyDeltas(state, MSG_HOT_CONV);
        else if (valence === 'negative') applyDeltas(state, MSG_HOT_CONV_NEG);
        break;
      }

      case 'calendar': {
        const { calendar_id, calendar_type } = ev.payload || {};
        if (calendar_id && !(state.processed_calendar_ids || []).includes(calendar_id)) {
          const deltas = CALENDAR_DELTAS[calendar_type];
          if (deltas) {
            applyDeltas(state, deltas);
            if (calendar_type === 'intimacy') state.last_intimacy_at = new Date(ev_ts).toISOString();
            if (!state.processed_calendar_ids) state.processed_calendar_ids = [];
            state.processed_calendar_ids.push(calendar_id);
          }
        }
        break;
      }

      case 'self_relief':
        if (state.lust_intention_pending.length > 0) state.lust_intention_pending.shift();
        applyFrustrationDelta(state, FRUSTRATION_DELTAS.self_relief, ev_ts);
        break;

      case 'lust_rejection_hard': {
        if (state.lust_intention_pending.length === 0) break;
        const mult_h = Math.min(1 + state.rejection_streak * 0.10, STREAK_MULTIPLIER_CAP);
        applyFrustrationDelta(state, FRUSTRATION_DELTAS.lust_rejection_hard * mult_h, ev_ts);
        state.rejection_streak += 1;
        break;
      }

      case 'lust_rejection_soft': {
        if (state.lust_intention_pending.length === 0) break;
        const mult_s = Math.min(1 + state.rejection_streak * 0.10, STREAK_MULTIPLIER_CAP);
        applyFrustrationDelta(state, FRUSTRATION_DELTAS.lust_rejection_soft * mult_s, ev_ts);
        state.rejection_streak += 1;
        break;
      }

      case 'sex_end':
        state.last_intimacy_at = new Date(ev_ts).toISOString();
        satisfyOldestIntention(state, ev_ts);
        break;

      case 'sleep_start':
        if (state.sleep.status === 'asleep') break;
        if (state.sleep.status === 'awake') delete state.sleep.accumulated_sleep_hours;
        state.sleep._base_at_sleep        = fatigueBase(state.sleep, ev_ts);
        delete state.sleep.interrupt_fatigue_bonus;
        state.sleep.status                = 'asleep';
        state.sleep.last_sleep_started_at = new Date(ev_ts).toISOString();
        state.unanswered_thread           = null;
        delete state.active_whim;
        break;

      case 'sleep_end': {
        if (state.sleep.status === 'awake') break;
        const hasActiveSegment = state.sleep.status === 'asleep' && state.sleep.last_sleep_started_at;
        const last_segment_hours = hasActiveSegment
          ? Math.max(0, ev_ts - new Date(state.sleep.last_sleep_started_at).getTime()) / 3_600_000
          : 0;
        const accumulated = state.sleep.accumulated_sleep_hours ?? 0;
        const total = accumulated + last_segment_hours;
        state.sleep.last_sleep_duration_hours = total > 0 ? total : (state.sleep.last_sleep_duration_hours ?? 7.5);
        state.sleep.status       = 'awake';
        state.sleep.last_wake_at = new Date(ev_ts).toISOString();
        state.sleep.estimated    = false;
        delete state.sleep._base_at_sleep;
        delete state.sleep.accumulated_sleep_hours;
        delete state.sleep.interrupt_fatigue_bonus;
        state.unanswered_thread  = null;
        break;
      }

      case 'sleep_interrupt': {
        if (state.sleep.status !== 'asleep') break;
        const seg_start = state.sleep.last_sleep_started_at
          ? new Date(state.sleep.last_sleep_started_at).getTime()
          : ev_ts;
        state.sleep.accumulated_sleep_hours = (state.sleep.accumulated_sleep_hours ?? 0) + Math.max(0, ev_ts - seg_start) / 3_600_000;
        delete state.sleep.last_sleep_started_at;
        state.sleep.status              = 'interrupted';
        state.sleep.last_interrupted_at = new Date(ev_ts).toISOString();
        state.sleep.interrupt_fatigue_bonus = 0.12;
        applyDeltas(state, { irritability: 0.12, vitality: -0.10 });
        state.unanswered_thread         = null;
        delete state.active_whim;
        break;
      }
    }

    state.last_processed_event_id = ev.event_id;
  }

  decayBaseTo(state, cursor, now_ts);
  decayFrustration(state, cursor, now_ts);
  accumulateTime(state, now_ts);
  return log;
}

// ── 初始状态 ──────────────────────────────────────────────────────────────────
function createInitialState(now_ts = Date.now()) {
  const now = new Date(now_ts);
  const local_now = new Date(now_ts + TZ_OFFSET * 3_600_000);
  local_now.setUTCHours(7, 0, 0, 0);
  let wake_ts = local_now.getTime() - TZ_OFFSET * 3_600_000;
  if (wake_ts > now_ts) wake_ts -= 86_400_000;
  const last_wake_at = new Date(wake_ts).toISOString();

  const iso  = now.toISOString();
  const base = {};
  for (const [k, p] of Object.entries(DIMS)) base[k] = p.neutral;

  return {
    schema_version:           2,
    snapshot_at:              iso,
    state_updated_at:         iso,
    last_processed_event_id:  null,
    last_time_accumulated_at: iso,
    last_interaction_at:      iso,
    unanswered_thread:        null,
    last_segment:             { id: 'seg-0', started_at: iso, last_message_at: iso, status: 'open', messages: 0, fear_label_applied: 0 },
    processed_calendar_ids:   [],
    time_episode:             null,
    active_whim:              null,
    sleep:                    { status: 'awake', last_sleep_started_at: null, last_wake_at, last_sleep_duration_hours: 7.2, estimated: true },
    last_intimacy_at:         null,
    frustration:                  0,
    rejection_streak:             0,
    frustration_peak_at:          null,
    lust_intention_pending:       [],
    lust_intention_last_roll_at:  null,
    last_intention_added_at:      null,
    _recent_labels:           [],
    base,
    mood: { ...base },
  };
}

// ── 主推进 (advance 移植) ─────────────────────────────────────────────────────
async function advance(state, now_ts, events) {
  if (!state.mood) state.mood = {};
  for (const [k, p] of Object.entries(DIMS)) {
    if (!(k in state.base)) state.base[k] = p.neutral;
    if (!(k in state.mood)) state.mood[k] = p.neutral;
  }
  if ((state.schema_version ?? 1) < 2) {
    state.schema_version = 2;
    delete state.high_emotion_until;
    state._recent_labels = (state._recent_labels || []).filter((e) => e && typeof e === 'object' && e.ts);
  }
  if (state.frustration            == null)  state.frustration            = 0;
  if (state.rejection_streak       == null)  state.rejection_streak       = 0;
  if (state.frustration_peak_at    === undefined) state.frustration_peak_at    = null;
  if (!Array.isArray(state.lust_intention_pending)) state.lust_intention_pending = [];
  if (state.lust_intention_last_roll_at === undefined) state.lust_intention_last_roll_at = null;
  if (state.last_intention_added_at    === undefined) state.last_intention_added_at    = null;

  const eventLog = await processEvents(state, now_ts, events);
  pruneExpiredIntentions(state, now_ts);
  maybeRollIntention(state, now_ts);
  checkUnansweredMilestones(state, now_ts);
  maybeFireWhim(state, now_ts);

  if (state.last_segment?.status === 'open') {
    const last_msg_ts = new Date(state.last_segment.last_message_at).getTime();
    if (now_ts - last_msg_ts > 15 * 60_000) state.last_segment.status = 'summarized';
  }

  const iso          = new Date(now_ts).toISOString();
  state.snapshot_at  = iso;
  state.state_updated_at = iso;
  if (state.display) state.prev_display = state.display;
  state.display      = buildDisplay(state, now_ts);
  return eventLog;
}

// ── 注入文本 (供 {{DRIVES_STATE}} 使用) ──────────────────────────────────────
function formatVar(display) {
  if (!display) return '';
  const top = Object.entries(display)
    .filter(([, v]) => v >= 0.38)
    .sort((a, b) => b[1] - a[1]);
  if (!top.length) return '';
  const lines = top.slice(0, 3).map(([k, v]) => {
    const zh = DIM_LABELS_ZH[k] || k;
    const pct = Math.round(v * 100);
    return `${zh} ${pct}%`;
  });
  return `[情绪状态] ${lines.join(' / ')}`;
}

export {
  createInitialState,
  advance,
  buildDisplay,
  formatVar,
  DIMS,
  DIM_LABELS_ZH,
};
