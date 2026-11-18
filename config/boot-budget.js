/* ============================================================
 * config/boot-budget.js — 首屏可交互预算 [R26-O1]
 * ------------------------------------------------------------
 * 【治的欠账】
 *   R26-O1 原文：「R25-O4 给的是**读数**，不是**预算**；没有阈值就没有回归」。
 *   验收口径：① 给出预算值；② 超预算时给出「超了哪一段」；③ 连续三版趋势可看。
 *
 * 【本模块的边界（读清楚再改）】
 *   ✅ 预算表 + 判定 + 趋势：纯函数，输入就是 `boot-timing.js` 的 `collect()` 读数。
 *   ❌ 不改任何加载路径：这里只回答「超没超、超在哪、比上一版快了还是慢了」。
 *
 * 【三条必须有名字的形态（否则用户只看到一句「慢」）】
 *   · `over`        —— 超了：`exceeded` 逐段点名（段名、预算、实测、超了多少），
 *                      `worst` 指向最该先修的那一段；**总预算超**也单独占一条（各段都不超
 *                      但加起来超，往往是段太多了 —— 这跟「某一段慢」是两种病）。
 *   · `incomplete`  —— 有段**不可测时**（`ms: null`）：不许判 within（"读不到"不是"很快"）。
 *   · `unmeasurable`—— 整个环境无钟（`clock:'absent'`）：如实说测不了，不编 0。
 *
 * 【趋势怎么算（免得被读成"预测"）】
 *   只看**首尾两版**的 `totalMs` 差：`up` / `down` / `flat`（容差 5%）；少于三版 ⇒
 *   `insufficient` —— 两版之间抖动说明不了趋势，本仓不吃「一版就宣布变快」这套。
 * ============================================================ */

/** 预算表（**唯一真源**：门禁与界面都读这里，不许在别处另写一份阈值）。 */
export const BOOT_BUDGET = Object.freeze({
    shell: 120,        // 壳（面板/样式/壳结构）建起来
    router: 80,        // 路由就位（能识别当前 tab）
    'first-data': 300, // 首屏数据到位（能看见内容而不是骨架）
    total: 600         // 合计上限：各段都合规但段数失控时由它兜底
});

/** 参与分段判定的阶段名（不含 total）。 */
export const BUDGET_STAGES = Object.freeze(Object.keys(BOOT_BUDGET).filter((k) => k !== 'total'));

/** 趋势容差：±5% 之内算平（读数抖动不该被说成涨/跌）。 */
export const TREND_TOLERANCE = 0.05;

/** 中位数（连跑三次取中位数；空 ⇒ null，不编 0）。 */
export function medianOf(samples) {
    const list = Array.isArray(samples)
        ? samples.filter((x) => typeof x === 'number' && Number.isFinite(x))
        : [];
    if (!list.length) return null;
    const s = list.slice().sort((a, b) => a - b);
    const mid = Math.floor(s.length / 2);
    return (s.length % 2) ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** 把 collect() 的段表按阶段名汇总（同名段累加；不可测时的段只计数）。 */
function stageTotals(snap) {
    const sums = new Map();
    const nulls = new Map();
    const segs = (snap && Array.isArray(snap.segments)) ? snap.segments : [];
    for (const seg of segs) {
        const name = String(seg && seg.name ? seg.name : '');
        if (!name) continue;
        if (typeof seg.ms === 'number' && Number.isFinite(seg.ms)) {
            sums.set(name, (sums.get(name) || 0) + seg.ms);
        } else {
            nulls.set(name, (nulls.get(name) || 0) + 1);
        }
    }
    return { sums, nulls };
}

/**
 * 判预算。
 *
 * @param {Object|null} snap boot-timing 的 collect() 读数
 * @param {{budget?:Object}} [opts]
 * @returns {{verdict:string, ok:boolean, totalMs:(number|null), budget:Object,
 *            exceeded:Array<{stage:string,budget:number,actual:number,overBy:number}>,
 *            worst:(Object|null), unmeasurableStages:string[], stages:Array}}
 */
export function judgeBoot(snap, opts) {
    const o = (opts && typeof opts === 'object') ? opts : {};
    const budget = (o.budget && typeof o.budget === 'object') ? o.budget : BOOT_BUDGET;
    const totalBudget = (typeof budget.total === 'number' && Number.isFinite(budget.total)) ? budget.total : BOOT_BUDGET.total;

    if (!snap || typeof snap !== 'object') {
        return { verdict: 'absent', ok: false, totalMs: null, budget: budget, exceeded: [], worst: null, unmeasurableStages: [], stages: [] };
    }
    const { sums, nulls } = stageTotals(snap);
    const unmeasurableStages = [...nulls.keys()].sort();
    const stages = [];
    const exceeded = [];

    for (const stage of BUDGET_STAGES) {
        const limit = (typeof budget[stage] === 'number' && Number.isFinite(budget[stage])) ? budget[stage] : null;
        if (limit === null) continue;
        const actual = sums.has(stage) ? sums.get(stage) : null;
        stages.push({ stage, budget: limit, actual });
        if (actual !== null && actual > limit) {
            exceeded.push({ stage, budget: limit, actual, overBy: actual - limit });
        }
    }

    const totalMs = (typeof snap.totalMs === 'number' && Number.isFinite(snap.totalMs)) ? snap.totalMs : null;
    if (totalMs !== null && totalMs > totalBudget) {
        exceeded.push({ stage: 'total', budget: totalBudget, actual: totalMs, overBy: totalMs - totalBudget });
    }
    exceeded.sort((a, b) => b.overBy - a.overBy);

    /* 无钟：整份读数都不可信 —— 一律 unmeasurable，绝不落 within。 */
    if (snap.clock === 'absent' || totalMs === null) {
        return {
            verdict: 'unmeasurable', ok: false, totalMs: null, budget: budget,
            exceeded: [], worst: null, unmeasurableStages, stages
        };
    }
    if (exceeded.length) {
        return {
            verdict: 'over', ok: false, totalMs, budget: budget,
            exceeded, worst: exceeded[0], unmeasurableStages, stages
        };
    }
    if (unmeasurableStages.length) {
        /* 没超，但有段测不出：不能说「达标」（可能是那一段真慢、只是没钟）。 */
        return {
            verdict: 'incomplete', ok: false, totalMs, budget: budget,
            exceeded: [], worst: null, unmeasurableStages, stages
        };
    }
    return { verdict: 'within', ok: true, totalMs, budget: budget, exceeded: [], worst: null, unmeasurableStages: [], stages };
}

/**
 * 三版趋势。`history` 是 `[{ version, totalMs }]`（按时间升序）。
 * @returns {{dir:string, delta:(number|null), from:(string|null), to:(string|null), points:number}}
 */
export function bootTrend(history) {
    const list = Array.isArray(history)
        ? history.filter((h) => h && typeof h.totalMs === 'number' && Number.isFinite(h.totalMs))
        : [];
    if (list.length < 3) {
        return { dir: 'insufficient', delta: null, from: null, to: null, points: list.length };
    }
    const first = list[0];
    const last = list[list.length - 1];
    const delta = last.totalMs - first.totalMs;
    const base = Math.abs(first.totalMs) || 1;
    const rel = delta / base;
    let dir = 'flat';
    if (rel > TREND_TOLERANCE) dir = 'up';
    else if (rel < -TREND_TOLERANCE) dir = 'down';
    return {
        dir: dir, delta: delta,
        from: (typeof first.version === 'string') ? first.version : null,
        to: (typeof last.version === 'string') ? last.version : null,
        points: list.length
    };
}

/** 一行预算文案（诊断卡与日志共用）。 */
export function bootBudgetLine(judge, trend) {
    const j = (judge && typeof judge === 'object') ? judge : null;
    if (!j) return '首屏预算：无判定';
    let head;
    if (j.verdict === 'absent') head = '首屏预算：没有读数（宿主未安装 boot-timing）';
    else if (j.verdict === 'unmeasurable') head = '首屏预算：**测不了**（本环境无 performance.now）—— 不判达标';
    else if (j.verdict === 'over') {
        const w = j.worst || { stage: '?', actual: 0, budget: 0, overBy: 0 };
        head = '首屏预算：**超了** —— 最该先修的是 ' + w.stage + '（' + Math.round(w.actual) + 'ms / 预算 '
            + w.budget + 'ms，超 ' + Math.round(w.overBy) + 'ms）'
            + (j.exceeded.length > 1 ? '；共 ' + j.exceeded.length + ' 项超线' : '');
    } else if (j.verdict === 'incomplete') {
        head = '首屏预算：没超，但 ' + j.unmeasurableStages.join('、') + ' 段**测不出** —— 不算达标';
    } else {
        head = '首屏预算：达标（合计 ' + Math.round(j.totalMs) + 'ms / 预算 ' + j.budget.total + 'ms）';
    }
    const t = (trend && typeof trend === 'object') ? trend : null;
    if (!t) return head;
    const tail = {
        up: '趋势：比 ' + (t.from || '早版') + ' 慢了 ' + Math.round(t.delta) + 'ms（' + t.points + ' 版）',
        down: '趋势：比 ' + (t.from || '早版') + ' 快了 ' + Math.round(-t.delta) + 'ms（' + t.points + ' 版）',
        flat: '趋势：基本持平（' + t.points + ' 版）',
        insufficient: '趋势：版数不足（' + t.points + ' 版，至少要 3 版才谈趋势）'
    }[t.dir] || '趋势：未知';
    return head + ' · ' + tail;
}