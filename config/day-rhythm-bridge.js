/* ============================================================
 * config/day-rhythm-bridge.js — [v4.102.0 · R13-O3]
 *   「一天」桥：把 daily-theater 的纯函数接到日记 App 的可见页上
 * ------------------------------------------------------------
 * 【为什么需要这一层（R13-O3 的 A 类决策）】
 *   `config/daily-theater.js` 自 v4.52.0 起就有完整的「一天的节奏」能力：
 *     安排 → 打断 → 回应 → 余韵（buildDaySchedule / injectInterruption /
 *     buildResponseChain / deriveDayRhythm）。但它自建起那天起**产品端零 import**，
 *   只在 tests/system-v4520.test.mjs 里被消费 —— 也就是「认真做过的孤儿」。
 *   R13-O3 的裁定是 A 类（接线），理由是它的能力只差一个界面。
 *
 * 【本模块只做翻译，不做判定】
 *   内核判「这一天怎么排、被打断后怎么续」，桥只负责：
 *     ① 把存储里的原始记录（日记条目）翻成内核要的 `slots` 形状；
 *     ② 把内核返回的结构翻成视图能直接渲染的行（带 label / 状态字）；
 *     ③ 把「内核没给东西」和「今天本来就没有安排」分成两种不同的话。
 *   不在本层重算任何判据 —— 一旦重算就有两个取数点，必然漂移。
 *
 * 【诚实边界】
 *   · 本桥**不读时钟**：`day` 与 `at` 一律由调用方传入（内核的口径纪律）；
 *   · 本桥**不写存储**：读 diary 的既有条目，不新增写路径；
 *   · 内核返回 reason（如「日程不在场」「打断时段认不出」）时**原样透出**，
 *     不翻译成「暂无内容」—— 那是把「算不出来」说成「本来就没有」。
 * ============================================================ */
import {
  buildDaySchedule,
  injectInterruption,
  buildResponseChain,
  deriveDayRhythm,
  DAY_SLOTS,
  TASK_STATES,
} from './daily-theater.js';

/** 状态 → 中文短标签。未知状态**原样返回**（不吞成「未知」以外的说法）。 */
export function stateLabel(state) {
  const t = String(state === null || state === undefined ? '' : state);
  if (t === TASK_STATES.planned) return '待办';
  if (t === TASK_STATES.in_progress) return '进行中';
  if (t === TASK_STATES.paused) return '被打断';
  if (t === TASK_STATES.completed) return '已完成';
  if (t === TASK_STATES.abandoned) return '已放弃';
  return t || '状态不明';
}

/** 时段 → 中文标签；不认识的时段返回空串（由调用方决定怎么提示）。 */
export function slotLabel(slot) {
  const s = String(slot === null || slot === undefined ? '' : slot);
  return DAY_SLOTS[s] ? DAY_SLOTS[s].label : '';
}

/**
 * 把日记条目翻成「一天」的 slots。
 * 只取**同一天**的条目（按 date 前缀匹配），把标题当 task、正文首句当 expectedOutcome。
 * @param {Array} entries — diary 的条目数组（含 date / title / content）
 * @param {object} opts   — { day, slot }：day 形如 '2026-10-31'；slot 缺省按条目顺序轮转
 * @returns {{ slots:Array, matched:number, skipped:number }}
 */
export function entriesToSlots(entries, opts = {}) {
  const list = Array.isArray(entries) ? entries : [];
  const day = String((opts && opts.day) || '');
  const forcedSlot = String((opts && opts.slot) || '');
  const order = ['morning', 'noon', 'afternoon', 'evening', 'night'];
  const slots = [];
  let matched = 0;
  let skipped = 0;
  for (const e of list) {
    if (!e || typeof e !== 'object') { skipped++; continue; }
    const date = String(e.date || '');
    if (day && !date.startsWith(day)) { skipped++; continue; }
    matched++;
    const title = String(e.title || '').trim();
    const body = String(e.content || '');
    const firstLine = body.split('\n').map((x) => x.trim()).filter(Boolean)[0] || '';
    slots.push({
      slot: forcedSlot && DAY_SLOTS[forcedSlot] ? forcedSlot : order[(matched - 1) % order.length],
      task: title || firstLine.slice(0, 40) || '（未命名）',
      role: '',
      expectedOutcome: firstLine.slice(0, 120),
    });
  }
  return { slots, matched, skipped };
}

/**
 * 构造「今天」页要的全部读数。
 * @param {object} input { day, entries, interruption? }
 * @returns {object} 视图可直接消费的形状（空/错都有明确字段）
 */
export function buildTodayFace(input = {}) {
  const o = (input && typeof input === 'object') ? input : {};
  const day = String(o.day || '').trim();
  const conv = entriesToSlots(o.entries, { day });
  if (!conv.slots.length) {
    return {
      ok: false,
      day,
      reason: day ? ('这一天（' + day + '）没有可排进时间线的记录') : '没有指定剧情日',
      rows: [],
      rhythm: null,
      interrupted: null,
      response: null,
      counts: { matched: conv.matched, skipped: conv.skipped },
    };
  }
  let built = buildDaySchedule({ day, slots: conv.slots });
  let interrupted = null;
  let response = null;
  const ir = o.interruption;
  if (ir && typeof ir === 'object' && DAY_SLOTS[String(ir.slot || '')]) {
    const inj = injectInterruption(built, ir);
    /* 内核的 reason 原样留着：它区分「打断成功」与「认不出这个时段」 */
    if (inj && inj.interruption) {
      built = inj.updatedDay || built;
      interrupted = inj.interruption;
      const chain = buildResponseChain(interrupted, Array.isArray(o.responses) ? o.responses : []);
      response = chain || null;
    } else {
      interrupted = { _rejected: (inj && inj.reason) || '打断未被接受' };
    }
  }
  const rhythm = deriveDayRhythm(built);
  const rows = (Array.isArray(built.schedule) ? built.schedule : []).map((s) => ({
    slot: s.slot,
    label: slotLabel(s.slot),
    task: s.task,
    role: s.role,
    state: s.state,
    stateText: stateLabel(s.state),
    interrupted: Boolean(s.interrupted),
  }));
  return {
    ok: true,
    day,
    reason: '',
    summary: built.summary || '',
    rows,
    rhythm,
    interrupted,
    response,
    counts: { matched: conv.matched, skipped: conv.skipped },
  };
}

/**
 * 把「今天」页的读数压成**一句用户能读的话**。
 * 纪律：算不出来时说算不出来，不说「今天没有安排」。
 */
export function todayHeadline(face) {
  const f = (face && typeof face === 'object') ? face : {};
  if (!f.ok) return f.reason || '没有可排进时间线的记录';
  const rows = Array.isArray(f.rows) ? f.rows : [];
  const paused = rows.filter((r) => r.state === TASK_STATES.paused).length;
  const done = rows.filter((r) => r.state === TASK_STATES.completed).length;
  let s = '这一天排了 ' + rows.length + ' 件';
  if (done) s += '，已完成 ' + done + ' 件';
  if (paused) s += '，被打断 ' + paused + ' 件';
  return s;
}
