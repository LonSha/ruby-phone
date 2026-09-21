/* ========================================================
 * calendar-grid.js — 资产引擎（移植自 LA-0.7.68 拓展版 src/calendar-grid.js）
 *
 * 【移植纪律：零转录】
 *   本文件的正文**逐字**来自上游源文件，包含它原有的 `(function(){ ... })();` 外壳。
 *   外壳之内一个字都没有改写 —— 只在外层套了三个自由变量的兼容层：
 *     · `module`  → 让上游末尾的 `module.exports = api` 照常执行，工厂再把它交出来；
 *     · `require` → 按 __REQ 映射表返回静态 import 进来的依赖模块（上游是惰性取）；
 *     · `window`  → 置为 undefined，屏蔽上游的浏览器全局挂载分支（不污染宿主 window.parent）。
 *   因此本模块的导出面与上游**逐字等价**，无需重读逻辑即可信任。
 *
 * 【依赖】无（纯函数层）
 * 【上游定位】calendar-grid.js
 * ======================================================== */
'use strict';

const __REQ = {};

export default (function () {
  const module = { exports: {} };
  const window = undefined;
  const require = function (p) {
    const f = __REQ[p];
    if (typeof f !== 'function') throw new Error('[asset-engine] unmapped require: ' + p);
    return f();
  };

(function(){
/* src/util/calendar-grid.js */
'use strict';

// ============================================================================
// 月格日历（纯函数，可在 Node 中测）
// ----------------------------------------------------------------------------
// 用途：孕育「受孕日」选择器 —— **自绘月格**（不依赖原生 `<input type="date">`），
// 并把该角色已有的周期/孕期事实画在格子上（经期开始 / 预测经期 / 预测排卵 / 孕期里程）。
//
// 边界：只算日期与标记，**不碰 DOM**；生育页按返回的 weeks/cells 照画即可。
// 坐标系：一律 'YYYY-MM-DD' 日期键（UTC 计算，避免时区把日期推错一天）；周一起始。
// 上限：可选区间与 `pregnancy-core` 的引擎硬边界一致（294 天 = 42 周）。
// ============================================================================

const MAX_DAYS = 294;                                  // 与 pregnancy-core.MAX_DAYS 同源口径
const WEEK_LABELS = ['一', '二', '三', '四', '五', '六', '日'];
const MARK_LABELS = {
  period: '经期开始',
  predicted: '预测经期',
  ovulation: '预测排卵',
  conceive: '受孕日',
  mid: '孕中期起点',
  late: '孕晚期起点',
  due: '预产期',
};
const CYCLE_MARK_KINDS = ['period', 'predicted', 'ovulation'];
const PREGNANCY_MARK_KINDS = ['conceive', 'mid', 'late', 'due'];

function pad2(n) { return String(n).padStart(2, '0'); }
function toKey(year, month, day) { return year + '-' + pad2(month) + '-' + pad2(day); }

function parseKey(key) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(key == null ? '' : key));
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return { year: y, month: mo, day: d };
}

function daysInMonth(year, month) { return new Date(Date.UTC(year, month, 0)).getUTCDate(); }

function addDays(key, days) {
  const p = parseKey(key);
  if (!p) return null;
  const dt = new Date(Date.UTC(p.year, p.month - 1, p.day + Math.floor(Number(days) || 0)));
  return toKey(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

function dayDiff(fromKey, toKey2) {
  const a = parseKey(fromKey);
  const b = parseKey(toKey2);
  if (!a || !b) return null;
  const ta = Date.UTC(a.year, a.month - 1, a.day);
  const tb = Date.UTC(b.year, b.month - 1, b.day);
  return Math.round((tb - ta) / 86400000);
}

function addMonths(year, month, delta) {
  const total = year * 12 + (month - 1) + Math.floor(Number(delta) || 0);
  return { year: Math.floor(total / 12), month: (total % 12) + 1 };
}

// 周一起始的 6×7 月格（含上下月补位），返回 cell 数组的二维数组。
function monthMatrix(year, month) {
  const first = new Date(Date.UTC(year, month - 1, 1));
  const lead = (first.getUTCDay() + 6) % 7;            // 周一 = 0
  const weeks = [];
  for (let w = 0; w < 6; w += 1) {
    const row = [];
    for (let i = 0; i < 7; i += 1) {
      const dt = new Date(Date.UTC(year, month - 1, 1 - lead + w * 7 + i));
      const y = dt.getUTCFullYear();
      const mo = dt.getUTCMonth() + 1;
      const d = dt.getUTCDate();
      row.push({ key: toKey(y, mo, d), day: d, inMonth: (y === year && mo === month) });
    }
    weeks.push(row);
  }
  return weeks;
}

// 可选区间：受孕日不得晚于今天、不早于 今天 −(MAX_DAYS − 1)。
// 与 pregnancy-core 的校验同源（那边按「孕期第 N 天」1–294 判，这里按日期判）。
function selectableRange(today) {
  if (!parseKey(today)) return { min: null, max: null };
  return { min: addDays(today, -(MAX_DAYS - 1)), max: today };
}

function bump(map, key, kind) {
  if (!key || !parseKey(key)) return;
  const list = map.get(key) || [];
  if (list.indexOf(kind) === -1) list.push(kind);
  map.set(key, list);
}

// 周期标记：历史经期开始日（rec.periodHistory）+ 预测经期 + 预测排卵（按 cycleLength 递推）。
function cycleMarks(rec, opts = {}) {
  const map = new Map();
  const cycles = Math.max(1, Math.min(24, Math.floor(Number(opts.cycles) || 12)));
  if (!rec || typeof rec !== 'object') return map;
  const history = Array.isArray(rec.periodHistory) ? rec.periodHistory.filter(k => parseKey(k)) : [];
  for (const k of history) bump(map, k, 'period');
  const length = Math.max(21, Math.min(45, Math.floor(Number(rec.cycleLength) || 28)));
  const start = parseKey(rec.lastPeriodStart) ? rec.lastPeriodStart : (history.length ? history[history.length - 1] : null);
  if (!start) return map;
  let cursor = start;
  for (let i = 1; i <= cycles; i += 1) {
    cursor = addDays(cursor, length);
    if (!cursor) break;
    bump(map, cursor, 'predicted');
    bump(map, addDays(cursor, -14), 'ovulation');   // 预测排卵 = 下次经期前 14 天
  }
  return map;
}

// 孕期标记：受孕日 / 孕中期起点（+84 天，与引擎里程碑一致）/ 孕晚期起点（+189 天）/ 预产期（+gap）。
function pregnancyMarks(pregnancy, opts = {}) {
  const map = new Map();
  const conceiveDate = pregnancy && pregnancy.conceiveDate;
  if (!parseKey(conceiveDate)) return map;
  const gap = Math.max(1, Math.floor(Number(opts.gap != null ? opts.gap : pregnancy.gap) || 266));
  bump(map, conceiveDate, 'conceive');
  bump(map, addDays(conceiveDate, 84), 'mid');
  bump(map, addDays(conceiveDate, 189), 'late');
  bump(map, addDays(conceiveDate, gap), 'due');
  return map;
}

function mergeMarks(maps) {
  const out = new Map();
  for (const map of (Array.isArray(maps) ? maps : [])) {
    if (!map || typeof map.forEach !== 'function') continue;
    map.forEach((list, key) => { for (const kind of list) bump(out, key, kind); });
  }
  return out;
}

// 组装一个月：DOM 只要照 weeks 画格子、照 marks 打标记。
function buildMonth(input = {}) {
  const year = Math.floor(Number(input.year));
  const month = Math.floor(Number(input.month));
  const today = parseKey(input.today) ? input.today : null;
  const selected = parseKey(input.selected) ? input.selected : null;
  const range = input.range && parseKey(input.range.min) && parseKey(input.range.max)
    ? input.range
    : selectableRange(today || '1970-01-01');
  const marks = input.marks instanceof Map ? input.marks : new Map();
  const weeks = monthMatrix(year, month).map(row => row.map(cell => {
    const list = marks.get(cell.key) || [];
    return {
      key: cell.key,
      day: cell.day,
      inMonth: cell.inMonth,
      isToday: !!today && cell.key === today,
      isSelected: !!selected && cell.key === selected,
      disabled: !!(range.min && range.max) && (cell.key < range.min || cell.key > range.max),
      marks: list.slice(),
    };
  }));
  return {
    year,
    month,
    title: year + ' 年 ' + month + ' 月',
    weekLabels: WEEK_LABELS.slice(),
    weeks,
    prev: addMonths(year, month, -1),
    next: addMonths(year, month, 1),
    range,
  };
}

// 生命周期标签（图例 / 格子 title 共用一处）
function markLabel(kind) { return MARK_LABELS[kind] || kind; }

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    MAX_DAYS, WEEK_LABELS, MARK_LABELS, CYCLE_MARK_KINDS, PREGNANCY_MARK_KINDS,
    toKey, parseKey, addDays, dayDiff, addMonths, daysInMonth, monthMatrix, selectableRange,
    cycleMarks, pregnancyMarks, mergeMarks, buildMonth, markLabel,
  };
}
if (typeof window !== 'undefined') {
  (window.parent || window).__LA_CALENDAR_GRID__ = {
    MAX_DAYS, WEEK_LABELS, MARK_LABELS, CYCLE_MARK_KINDS, PREGNANCY_MARK_KINDS,
    toKey, parseKey, addDays, dayDiff, addMonths, daysInMonth, monthMatrix, selectableRange,
    cycleMarks, pregnancyMarks, mergeMarks, buildMonth, markLabel,
  };
}

})();

  return module.exports;
})();
