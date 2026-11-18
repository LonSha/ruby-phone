/* ============================================================
 * tests/r25_x9_story_clock_fanout.test.mjs — R25-X9 剧情钟推进的全 App 联动
 * ------------------------------------------------------------
 * 【咬点】
 * 1. 四个面**来自同一次计算**：换一个控制项（12/24 制、日期序、时区）四面一起变，
 *    不可能出现「会话是 12 小时制、锁屏是 24 小时制」；
 * 2. 改钟一次四面同时变：毫秒换掉 ⇒ 四个面的文本全部跟着变（逐面判，不是只看一个）；
 * 3. 读不到剧情毫秒 ⇒ `unreadable`，**不回落墙钟**（修前锁屏就是 `new Date()` 拼本机今天）；
 * 4. 锁屏**真接钟**：`_nowParts()` 里不再有 `new Date()` / `getMonth()+1`，
 *    且 `_nowParts` 真的读 `VirtualPhone._storyFanout`；
 * 5. index.js **真的 import 了 storyNow**（修前 5 处 `typeof storyNow === 'function'` 全是死路，
 *    因为没有 import ⇒ 模块作用域里恒为 undefined，静默走空分支）；
 * 6. 广播与首帧都接了：`onTick` 里调 `refreshStoryFanout`，装配期也算一拍；
 * 7. 读回对拍三态：`same` / `mismatch` / `unknown`，`unknown ≠ same`。
 * ============================================================ */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
    FANOUT_SURFACES, SURFACE_LABELS, FANOUT_STATES,
    weekdayOf, fanoutOf, judgeFanout, fanoutText, surfaceOf
} from '../config/story-clock-fanout.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');

/**
 * 剥注释后再扫描。
 * 为什么必须有这一步：本轮把「修前的写法」原文抄进了注释里当证据，直接对全文跑正则
 * 会被注释里的旧代码骗红。但也不能因此去掉断言（那是放宽口径）—— 正确做法是只扫真代码：
 * 块注释整段删，行首是 `*` 或 `//` 的行删。
 */
function codeOf(text) {
    return text
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n')
        .filter((ln) => !/^\s*(\*|\/\/)/.test(ln))
        .join('\n');
}

/* 固定一个「剧情时刻」：2026-11-18 09:05 UTC（= 17:05 东八区）。
 * 用固定值而不是 Date.now()：判据自己就不许有墙钟依赖，否则今天绿明天红。 */
const STORY_MS = Date.UTC(2026, 10, 18, 9, 5, 0);
const ENV = { systemOffsetMinutes: 480 };
const FMT_24 = { hourCycle: 'h24', dateStyle: 'ymd', zone: 'system', zoneOffsetMinutes: 0 };

test('X9-1 四面闭集与中文名一一对应（多处共用同一套名字）', () => {
    assert.deepEqual([...FANOUT_SURFACES], ['chatStamp', 'diaryDate', 'scheduleDate', 'lockscreenSummary']);
    for (const k of FANOUT_SURFACES) {
        assert.equal(typeof SURFACE_LABELS[k], 'string');
        assert.ok(SURFACE_LABELS[k].length > 1, k + ' 必须有中文名');
    }
    assert.equal(new Set(Object.values(SURFACE_LABELS)).size, FANOUT_SURFACES.length, '中文名不许重复');
});

test('X9-2 一次算出四面：四个键都在，且与单面读取口一致', () => {
    const f = fanoutOf(STORY_MS, FMT_24, ENV);
    assert.equal(f.state, FANOUT_STATES.ok);
    assert.equal(f.momentMs, STORY_MS);
    for (const k of FANOUT_SURFACES) {
        assert.equal(typeof f.surfaces[k], 'string');
        assert.ok(f.surfaces[k].length > 0, k + ' 不许为空');
        assert.equal(surfaceOf(f, k), f.surfaces[k], '单面读取口必须与整面一致');
    }
    assert.equal(f.surfaces.chatStamp, f.extras.lockscreenTime, '会话戳与锁屏时间同一时刻同一格式');
    assert.match(f.surfaces.diaryDate, /2026/);
    assert.equal(f.extras.lockscreenHour, 17, '东八区 17:05 ⇒ 小时应来自同一次时区换算');
});

test('X9-3 改钟一次四面同时变（逐面判，不是只看一个）', () => {
    const before = fanoutOf(STORY_MS, FMT_24, ENV);
    const after = fanoutOf(STORY_MS + 26 * 3600 * 1000, FMT_24, ENV);   // +26h ⇒ 跨日
    assert.equal(after.state, FANOUT_STATES.ok);
    for (const k of FANOUT_SURFACES) {
        assert.notEqual(after.surfaces[k], before.surfaces[k], k + ' 没跟着钟变（说明它没读这一份）');
    }
    assert.notEqual(after.surfaces.diaryDate, before.surfaces.diaryDate, '跨日必须换日期');
    assert.notEqual(after.surfaces.chatStamp, before.surfaces.chatStamp, '跨 26 小时必须换时刻');
});

test('X9-4 换时间格式：四面一起换形，不会各显示一套', () => {
    const a = fanoutOf(STORY_MS, FMT_24, ENV);
    const b = fanoutOf(STORY_MS, { ...FMT_24, hourCycle: 'h12' }, ENV);
    const c = fanoutOf(STORY_MS, { ...FMT_24, dateStyle: 'mdy' }, ENV);
    assert.notEqual(a.surfaces.chatStamp, b.surfaces.chatStamp, '12 小时制必须改变时刻文本');
    assert.notEqual(a.surfaces.lockscreenSummary, b.surfaces.lockscreenSummary, '锁屏也跟着 12 小时制');
    assert.notEqual(a.surfaces.diaryDate, c.surfaces.diaryDate, '日期序必须改变日期文本');
    assert.notEqual(a.surfaces.scheduleDate, c.surfaces.scheduleDate, '日程日期同样跟着换');
    /* 负控制：换了日期序，时刻文本**不该**变（否则说明两件事被搅在一起）。 */
    assert.equal(a.surfaces.chatStamp, c.surfaces.chatStamp);
});

test('X9-5 星期几只由剧情毫秒决定，不接受墙钟', () => {
    assert.equal(weekdayOf(Date.UTC(2026, 10, 18, 9, 5, 0)), '星期三');
    assert.equal(weekdayOf(Date.UTC(2026, 10, 19, 0, 0, 0)), '星期四');
    assert.equal(weekdayOf(null), null);
    assert.equal(weekdayOf('abc'), null);
    assert.equal(weekdayOf(-1), null);
    /* 锁屏日期里真的带上了这一天（不是转发一个常量）。 */
    const f = fanoutOf(STORY_MS, FMT_24, ENV);
    assert.match(f.extras.lockscreenDate, /星期三/);
});

test('X9-6 读不到剧情毫秒 ⇒ unreadable，且**不回落墙钟**', () => {
    for (const bad of [null, undefined, '', 'abc', -5]) {
        const f = fanoutOf(bad, FMT_24, ENV);
        assert.equal(f.state, FANOUT_STATES.unreadable, JSON.stringify(bad) + ' 应判 unreadable');
        assert.equal(f.surfaces, null, '读不到时不许给一面假文本');
        assert.match(f.note, /不等于「现在就是本机时间」/);
    }
    assert.match(fanoutText(fanoutOf(null, FMT_24, ENV)), /不是「四处一致」/);
});

test('X9-7 读回对拍三态：same / mismatch / unknown，unknown ≠ same', () => {
    const f = fanoutOf(STORY_MS, FMT_24, ENV);
    const all = {};
    for (const k of FANOUT_SURFACES) all[k] = f.surfaces[k];
    assert.equal(judgeFanout(f, all).verdict, 'same');
    assert.deepEqual(judgeFanout(f, all).diffs, []);
    const one = { ...all, diaryDate: '2026年1月1日' };
    const r = judgeFanout(f, one);
    assert.equal(r.verdict, 'mismatch');
    assert.equal(r.diffs.length, 1);
    assert.equal(r.diffs[0].surface, 'diaryDate');
    /* 一个面都没读回 ⇒ unknown（没比过的东西不能算一致）。 */
    assert.equal(judgeFanout(f, {}).verdict, 'unknown');
    assert.equal(judgeFanout(f, null).verdict, 'unknown');
    assert.equal(judgeFanout(fanoutOf(null, FMT_24, ENV), all).verdict, 'unknown');
});

/* ---------------- 接线 ---------------- */

test('X9-8 index.js 真的 import 了 storyNow（修前 5 处守卫全是死路）', () => {
    const idx = read('index.js');
    assert.match(idx, /import \{ storyNow \} from '\.\/config\/time-source\.js'/,
        'index.js 必须 import storyNow —— 否则 `typeof storyNow === \'function\'` 恒为 false，静默走空分支');
    assert.ok(idx.includes('refreshStoryFanout'), '必须有广播入口');
    assert.ok(/try \{ refreshStoryFanout\(\); \}/.test(idx), 'onTick 里必须调它（钟一跳四面换）');
    /* 装配期也有一拍：不能等第一次 life-clock tick（60s 起步）。 */
    assert.ok(/装配期先算一拍/.test(idx), '首帧必须也算一次（否则锁屏首屏是「读不到」）');
    assert.ok(idx.includes('_storyFanout'), '广播面必须挂宿主（消费面读这一份）');
});

test('X9-9 锁屏真接钟：不再用 new Date() 拼日期，且读 _storyFanout', () => {
    const ls = codeOf(read('phone/lock-screen.js'));
    const start = ls.indexOf('_nowParts() {');
    assert.ok(start > 0, '找不到 _nowParts');
    const body = ls.slice(start, ls.indexOf('\n  }', start));
    assert.ok(!/new Date\(\)/.test(body), '_nowParts 里不许再有 new Date()（那就是「本机今天」）');
    assert.ok(!/getMonth\(\)\s*\+\s*1/.test(body), '_nowParts 里不许再自己拼月日');
    assert.ok(/_storyFanout/.test(body), '必须读广播面');
    assert.ok(/state === 'ok'/.test(body), '必须先判面是否可用（三态）');
    assert.ok(/'--:--'/.test(body), '读不到时必须显式给读不到态，不许回落墙钟');
    assert.ok(/source: 'unreadable'/.test(body), '读不到要留可读回的一态（不是空白）');
});

test('X9-10 广播面挂在宿主上，且带人话与回执口（供诊断/判据读）', () => {
    const idx = read('index.js');
    assert.ok(/_storyFanoutText/.test(idx), '人话必须挂宿主（诊断页不自己拼）');
    assert.ok(/refreshStoryFanout = refreshStoryFanout/.test(idx), '宿主面必须能主动重算（改钟后立即生效）');
    assert.ok(/storyFanoutVerdict/.test(idx), '读回对拍必须有宿主侧结论口');
    assert.ok(/judgeStoryFanout/.test(idx), '结论口必须走内核判定，不自己写一套');
});

test('X9-11 诊断页有联动卡，且读的是锁屏真 DOM', () => {
    const data = read('apps/diagnose/diagnose-data.js');
    assert.ok(data.includes('judgeFanout as judgeStoryFanoutOf'), '诊断必须走内核判定');
    assert.ok(data.includes('storyFanoutTextOf'), '结论行必须走内核文案');
    assert.ok(/storyFanout: storyFanoutSc/.test(data), '必须打包进 pkg');
    assert.ok(/pls-date/.test(data), '读回必须读锁屏真 DOM（#pls-date）');
    assert.ok(/pls-time/.test(data), '读回必须读锁屏真 DOM（#pls-time）');
    const view = read('apps/diagnose/diagnose-view.js');
    assert.ok(view.includes('_storyFanoutHtml'));
    assert.ok(/h\.push\([^\n]*_storyFanoutHtml/.test(view), '卡片必须真进渲染流程');
});

test('X9-12 四面文本同源可验：不存在第二个「自己拼日期」的锁屏路径', () => {
    const ls = codeOf(read('phone/lock-screen.js'));
    /* 全文件里再扫一遍（已剥注释，只扫真代码）：锁屏其它位置也不许出现自己拼「X月Y日」。
     * `weeks[...]` 那份常量已随 _nowParts 改写移除。 */
    assert.ok(!/getMonth\(\)\s*\+\s*1\)\s*\+\s*'月'/.test(ls), '锁屏里不许再有「X月Y日」的拼接');
    assert.ok(!/const weeks = \[/.test(ls), '星期的数组应已搬到 config/story-clock-fanout.js（唯一真源）');
    const fan = read('config/story-clock-fanout.js');
    assert.match(fan, /const WEEKDAYS = Object\.freeze/, '星期表必须在联动内核里');
});