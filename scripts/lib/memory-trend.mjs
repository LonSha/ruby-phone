/* ============================================================
 * scripts/lib/memory-trend.mjs — 趋势门的纯函数面（R21-O6）[v4.144.0]
 * ------------------------------------------------------------
 * 为什么把它从 `scripts/memory-trend-check.mjs` 里抽出来：
 *   判据（tests/system-v4144.test.mjs）要直接断言「越界会不会红」「未强制回收会不会拒判」，
 *   而它不能靠跑一次门来猜。若把判据写在 check 脚本里，导入它就会跑 CLI
 *   （真启子进程），那是「判据靠意外作用才能断言」；而若判据自己又写一份判决逻辑，
 *   两份必然漂移（本仓已在多处立过这条纪律：判据在场景里、格式化在库里，不许各抄一份）。
 *   故把纯函数面下沉到 lib：门跑它们下判，判据也跑它们下判，同一份实现。
 *
 * 两件事的分工（不得坍成一件）：
 *   `judgeTrendReadings` —— “读数越没越界”（业务判决）；
 *   `guardProbeOutput`  —— “这份读数能不能拿来判”（可比性前置）。
 *   后者不通过时前者的结论一律不采用 —— 「不可比」与「通过」不得同形。
 * ============================================================ */
import { numOrNull } from '../../config/num-gate.js';
/* 上界：当前实测 tail 2KB / total 15KB，留 4 倍余量。改这两个数字就是改口径，必须同时改测量报告。 */
export const TAIL_LIMIT_KB = 8;
export const TOTAL_LIMIT_KB = 64;
export const MIN_ROUNDS = 6;
/* ---------- 纯函数一：两根数的判决（两侧各管一面，任一越界即红） ---------- */
export function judgeTrendReadings(readings, limits) {
  const L = limits || {};
  const tailMax = numOrNull(L.tail) !== null ? L.tail : TAIL_LIMIT_KB;
  const totalMax = numOrNull(L.total) !== null ? L.total : TOTAL_LIMIT_KB;
  const tail = numOrNull(readings && readings.heap_tail_growth_kb);
  const total = numOrNull(readings && readings.heap_total_growth_kb);
  const over = [];
  if (tail !== null && tail > tailMax) over.push('尾段增长 ' + tail + 'KB > 上界 ' + tailMax + 'KB');
  if (total !== null && total > totalMax) over.push('总增长 ' + total + 'KB > 上界 ' + totalMax + 'KB');
  return { verdict: over.length ? 'over-limit' : 'pass', over, tail, total, tail_max: tailMax, total_max: totalMax };
}
/* ---------- 纯函数二：输入面自证（三态互不同形：就绪 / 不可比 / 读不到） ----------
 *   返回 { ok, why, code }；`code` 是给判据拿来做负控制对读的机读名，不靠中文字去匹。
 *   七种拒判理由互不相同（不得坍成一个「不行」）。 */
export function guardProbeOutput(live, limits) {
  const minRounds = numOrNull(limits && limits.minRounds) !== null ? limits.minRounds : MIN_ROUNDS;
  if (!live || typeof live !== 'object') return { ok: false, code: 'empty', why: '探针输出为空' };
  if (live.gc_forced !== true) {
    return { ok: false, code: 'gc-not-forced',
      why: '未强制回收（gc_forced=' + String(live.gc_forced) + '）：这样的读数里含未回收垃圾，不可比' };
  }
  const rd = live.readings;
  if (!rd || typeof rd !== 'object') return { ok: false, code: 'no-readings', why: '探针输出缺 readings 段' };
  const samples = rd.heap_samples_kb;
  if (!Array.isArray(samples)) return { ok: false, code: 'samples-not-array', why: 'heap_samples_kb 不是数组：趋势无从读起' };
  if (samples.length < minRounds) {
    return { ok: false, code: 'samples-too-few',
      why: '样本点只有 ' + samples.length + ' 个（下限 ' + minRounds + '）：不足以判跨轮趋势' };
  }
  const roundsLive = numOrNull(live.rounds);
  if (roundsLive === null || roundsLive < minRounds) {
    return { ok: false, code: 'rounds-too-few',
      why: 'rounds 读不到或过小（' + String(live.rounds) + '，下限 ' + minRounds + '）' };
  }
  if (numOrNull(rd.heap_tail_growth_kb) === null || numOrNull(rd.heap_total_growth_kb) === null) {
    return { ok: false, code: 'rise-missing',
      why: '主读数缺格（heap_tail_growth_kb=' + String(rd.heap_tail_growth_kb)
        + '，heap_total_growth_kb=' + String(rd.heap_total_growth_kb) + '）' };
  }
  return { ok: true, code: 'ready', why: '', samples: samples.length, rounds: roundsLive };
}
