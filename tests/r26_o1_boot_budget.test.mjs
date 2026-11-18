/**
 * r26_o1_boot_budget.test.mjs — R26-O1 首屏可交互预算
 *
 * 【咬点】
 *   1. 预算表是**唯一真源**，判定必须逐段点名（只报总数等于没给线索）；
 *   2. `总预算超但各段都不超` 必须单独占一条（那是"段太多"，不是"某段慢"）；
 *   3. **无钟 ≠ 很快**：无钟 / 有段测不出，都不许落 within；
 *   4. 趋势要三版才谈，容差 ±5%（两版抖动不许宣布变快）；
 *   5. 装配点自检：诊断页真的渲染这张卡。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    BOOT_BUDGET,
    BUDGET_STAGES,
    TREND_TOLERANCE,
    medianOf,
    judgeBoot,
    bootTrend,
    bootBudgetLine
} from '../config/boot-budget.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** 造一份 collect() 形状的读数。 */
function snapOf(segs, extra) {
    const segments = segs.map(([name, ms]) => ({ name, ms, state: ms === null ? 'unmeasurable' : 'measured' }));
    const total = segments.reduce((a, s) => a + (typeof s.ms === 'number' ? s.ms : 0), 0);
    return Object.assign({ clock: 'ok', segments, totalMs: segments.some((s) => s.ms === null) && !segments.some((s) => typeof s.ms === 'number') ? null : total }, extra || {});
}

test('O1-1 预算表四键且阶段名不含 total（唯一真源）', () => {
    assert.deepEqual(Object.keys(BOOT_BUDGET).sort(), ['first-data', 'router', 'shell', 'total']);
    assert.deepEqual([...BUDGET_STAGES].sort(), ['first-data', 'router', 'shell']);
    for (const k of BUDGET_STAGES) assert.ok(typeof BOOT_BUDGET[k] === 'number' && BOOT_BUDGET[k] > 0);
});

test('O1-2 单段超线：逐段点名（不是只说总数），worst 指向该段', () => {
    const j = judgeBoot(snapOf([['shell', 100], ['router', 50], ['first-data', 350]]));
    assert.equal(j.verdict, 'over');
    assert.equal(j.exceeded.length, 1);
    assert.equal(j.worst.stage, 'first-data');
    assert.equal(j.worst.overBy, 50);
    assert.ok(bootBudgetLine(j).includes('first-data'));
});

test('O1-3 多段超线：worst 是超得最多的那一段（按 overBy 排序）', () => {
    const j = judgeBoot(snapOf([['shell', 200], ['router', 100], ['first-data', 310]]));
    assert.equal(j.verdict, 'over');
    assert.equal(j.worst.stage, 'shell', 'shell 超 80 > router 超 20 > first-data 超 10');
    /* 前三项是分段超线（按 overBy 降序）；第 4 项是 total（200+100+310=610 > 600）——
     *  它也在超，这不是噪声：分段超线常伴总预算超，两条都要看得见。 */
    assert.deepEqual(j.exceeded.map((x) => x.stage), ['shell', 'router', 'first-data', 'total']);
});

test('O1-4 各段都不超但合计超：必须单独占一条 total（段太多 ≠ 某段慢）', () => {
    /* shell 110(<120) + router 70(<80) + first-data 280(<300) = 460 < 600，先确认不超 */
    const ok = judgeBoot(snapOf([['shell', 110], ['router', 70], ['first-data', 280]]));
    assert.equal(ok.verdict, 'within');
    /* 再让「合计」超：总预算 600，把 totalMs 抬到 700 */
    const j = judgeBoot(snapOf([['shell', 110], ['router', 70], ['first-data', 280]], { totalMs: 700 }));
    assert.equal(j.verdict, 'over');
    assert.deepEqual(j.exceeded.map((x) => x.stage), ['total']);
    assert.equal(j.worst.stage, 'total');
});

test('O1-5 无钟（clock absent）⇒ unmeasurable，绝不判达标', () => {
    const j = judgeBoot({ clock: 'absent', segments: [{ name: 'shell', ms: null }], totalMs: null });
    assert.equal(j.verdict, 'unmeasurable');
    assert.equal(j.ok, false);
    assert.ok(bootBudgetLine(j).includes('测不了'));
});

test('O1-6 有段测不出但没超 ⇒ incomplete（不是 within）', () => {
    const j = judgeBoot({
        clock: 'ok',
        totalMs: 160,
        segments: [
            { name: 'shell', ms: 100 },   // 100 < 120
            { name: 'router', ms: 60 },    // 60 < 80（刻意不超：本判据只测「有段测不出」）
            { name: 'first-data', ms: null }
        ]
    });
    assert.equal(j.verdict, 'incomplete');
    assert.equal(j.ok, false);
    assert.deepEqual(j.unmeasurableStages, ['first-data']);
    assert.ok(bootBudgetLine(j).includes('测不出'));
});

test('O1-7 全部达标 ⇒ within 且 ok', () => {
    const j = judgeBoot(snapOf([['shell', 90], ['router', 40], ['first-data', 200]]));
    assert.equal(j.verdict, 'within');
    assert.equal(j.ok, true);
    assert.ok(bootBudgetLine(j).includes('达标'));
});

test('O1-8 坏输入不崩：null / 缺 segments 都如实 absent 而不是「0ms 达标」', () => {
    assert.equal(judgeBoot(null).verdict, 'absent');
    assert.equal(judgeBoot({}).verdict, 'unmeasurable', '没有 totalMs 的读数不许当 0');
    assert.doesNotThrow(() => bootBudgetLine(null));
});

test('O1-9 medianOf：奇数取中、偶数取均值、空与脏数据如实 null', () => {
    assert.equal(medianOf([300, 100, 200]), 200);
    assert.equal(medianOf([100, 200]), 150);
    assert.equal(medianOf([]), null);
    assert.equal(medianOf(['x', null, undefined]), null);
    assert.equal(medianOf([100, 'x', 300]), 200, '非数被过滤后取中位');
});

test('O1-10 趋势：升 / 降 / 平三态，且容差之内算平', () => {
    const up = bootTrend([{ version: 'a', totalMs: 400 }, { version: 'b', totalMs: 500 }, { version: 'c', totalMs: 700 }]);
    assert.equal(up.dir, 'up');
    assert.equal(up.delta, 300);
    assert.equal(up.from, 'a');
    assert.equal(up.to, 'c');

    const down = bootTrend([{ version: 'a', totalMs: 700 }, { version: 'b', totalMs: 600 }, { version: 'c', totalMs: 500 }]);
    assert.equal(down.dir, 'down');

    const flat = bootTrend([{ version: 'a', totalMs: 1000 }, { version: 'b', totalMs: 1010 }, { version: 'c', totalMs: 1020 }]);
    assert.equal(flat.dir, 'flat');
    assert.ok(Math.abs(20 / 1000) < TREND_TOLERANCE);
});

test('O1-11 趋势：不足三版如实 insufficient（不许两版就宣布变快）', () => {
    const t = bootTrend([{ version: 'a', totalMs: 900 }, { version: 'b', totalMs: 300 }]);
    assert.equal(t.dir, 'insufficient');
    assert.equal(t.points, 2);
    assert.equal(t.delta, null);
    assert.ok(bootBudgetLine(judgeBoot(snapOf([['shell', 90]])), t).includes('版数不足'));
});

test('O1-12 装配点自检：诊断页有首屏预算卡片且真被调用', () => {
    const view = fs.readFileSync(path.join(root, 'apps/diagnose/diagnose-view.js'), 'utf8');
    assert.ok(view.includes('_bootBudgetHtml(pkg) {'), '要有渲染方法');
    assert.ok(view.includes('this._bootBudgetHtml(pkg)'), '必须在主流程里被调用');
    const data = fs.readFileSync(path.join(root, 'apps/diagnose/diagnose-data.js'), 'utf8');
    assert.ok(data.includes('bootBudgetFace'), '数据层要有取数口');
    assert.ok(data.includes("from '../../config/boot-budget.js'"), '判定必须走内核，不许页面自己算阈值');
});