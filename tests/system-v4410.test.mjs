/* ============================================================
 * tests/system-v4410.test.mjs -- [v4.41.0 · 第五期 R5-X8 周期日程、单次例外与多人空档选择]
 *
 * 验收口径（计划原文 R5-X8）：
 *   「在原日历增加每周/每月重复时段、单次改期/跳过、持续时间及参与者冲突提示；
 *     选择共同空档后确认新安排，旅行复用该选择器而非另存日程表。」
 *   验收旅程：「**四周安排中改第二周、跳过第三周不改全系列**；两名参与者冲突提供可解释空档；
 *     **未知日程显示未知非空闲**；从旅行页改期后相关日历引用一致，提醒不重复。」
 *   不做：**不接系统日历/闹钟**；**不后台常驻轮询**；不重做旅行分工和结算。
 *
 * 【修前实测的缺口（读码可复算，不是推演）】
 *   `apps/calendar/calendar-data.js::isRecurringType` 的实现是
 *   `normalized === 'birthday' || normalized === 'anniversary'` —— **只认生日/纪念日**。
 *   于是「每周三晚八点的固定时段」在手机里没有落点；更硬的是
 *   「四周安排里改第二周、跳过第三周」这件事：修前只有「全系列一起改」或
 *   「整条删掉」两种处置。
 *
 * 【本版落的三件】
 *   （一）契约件 `config/recurrence-contract.js`：周期三态（absent / single / recurring /
 *   unreadable）+ 单次例外三类（move / skip / cancel，**skip 与 cancel 分形**）+
 *   空档三态（free / busy / unknown，**未知不算空闲**）；不认识的周期名/动作名如实具名；
 *   十项自证。
 *   （二）控制器 `calendar-app.js`：`recurrenceFace` / `recurrenceWithExceptions` /
 *   `isWeeklyMonthly` / `commonSlots` / `recurrenceContractSelfCheck`。
 *   （三）视图 `calendar-view.js`：日程详情里的「周期与单次例外」区块 + 三个动作按钮 +
 *   样式双侧（calendar.css 与 phone.css）。
 *
 * 判据面（六组）：
 *   A 口径：三类各态互不同形 / 展开与例外唯一出处 / 纯契约零副作用 / 视图接线
 *   B 内核行为：四周里改第二周只动那一期、跳过与取消不同形、未知不算空闲、
 *            不认识的周期名与动作名如实具名
 *   C 接线行为：真 App 走完整旅程（周期展开 / 例外应用 / 非周期不画块 / 取数抛了 / 自检真消费）
 *   D 负控制：真源码定点破坏 ⇒ 同款判据必转红（每条配原版必真的反向对照）
 *   E 版本锚：五源同源 + 当版条目点名 R5-X8
 *
 * 【为什么负控制破坏副本而不是原仓】见 tests/system-v4120.test.mjs 档头（同规）。
 * 【为什么「提醒不重复」不在本套件判到底】那属**提醒调度**面读数；本套件判它的
 *   可判定前件：例外只动点名那一期（其余逐字不变）—— 那是「不重复」的前提。
 * ========================================================== */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { copyTreeSafe } from './_mirror_tree.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const KERNEL_REL = 'config/recurrence-contract.js';
const APP_REL = 'apps/calendar/calendar-app.js';
const VIEW_REL = 'apps/calendar/calendar-view.js';
const VIEW_CSS_REL = 'apps/calendar/calendar.css';
const BUNDLE_CSS_REL = 'phone.css';
const NL = String.fromCharCode(10);

const K = await import(pathToFileURL(path.join(ROOT, KERNEL_REL)).href);
const APP = await import(pathToFileURL(path.join(ROOT, APP_REL)).href);

const kernelSrc = read(KERNEL_REL);
const appSrc = read(APP_REL);
const viewSrc = read(VIEW_REL);
const appCssSrc = read(VIEW_CSS_REL);
const bundleCssSrc = read(BUNDLE_CSS_REL);

/** 去注释后的源码：判据只认代码，不认注释里的自述。 */
function stripComments(src) {
    let out = '';
    let i = 0;
    let state = 'code';
    let quote = '';
    while (i < src.length) {
        const c = src[i];
        const d = src[i + 1];
        if (state === 'code') {
            if (c === '/' && d === '*') { state = 'block'; i += 2; continue; }
            if (c === '/' && d === '/') { state = 'line'; i += 2; continue; }
            if (c === '"' || c === "'" || c === '`') { state = 'str'; quote = c; out += c; i += 1; continue; }
            out += c; i += 1; continue;
        }
        if (state === 'block') { if (c === '*' && d === '/') { state = 'code'; i += 2; continue; } i += 1; continue; }
        if (state === 'line') { if (c === NL) { state = 'code'; out += c; } i += 1; continue; }
        if (c === String.fromCharCode(92)) { out += c + (d || ''); i += 2; continue; }
        if (c === quote) { state = 'code'; out += c; i += 1; continue; }
        out += c; i += 1;
    }
    return out;
}
const kernelCode = stripComments(kernelSrc);
const appCode = stripComments(appSrc);
const viewCode = stripComments(viewSrc);
const S = K.REC_STATES;
const SL = K.SLOT_STATES;
const EX = K.REC_EXCEPTION;

/* ══════════ 假件 ══════════ */
function mkStorage() {
    const mem = new Map();
    return { get: (k, d) => (mem.has(k) ? mem.get(k) : d), set: (k, v) => { mem.set(k, v); }, has: (k) => mem.has(k) };
}
/**
 * 造一个真 App 实例。
 *   ★ 不走 `new CalendarApp(...)`：真构造期要 phoneShell（夹具缺件，非本版缺陷）。
 *   按真原型建实例 —— 方法体本身仍是**真源码**。
 */
function mkApp() {
    globalThis.window = { VirtualPhone: {} };
    return Object.create(APP.CalendarApp.prototype);
}
function clearWin() { delete globalThis.window; }

/* ══════════ A ── 口径面 ══════════ */

test('A1 三类各态互不同形：「跳过」vs「取消」、「空闲」vs「未知」必须分形', () => {
    const ex = Object.values(EX);
    assert.equal(new Set(ex).size, ex.length, '★ 例外动作必须互不相同');
    assert.notEqual(EX.SKIP, EX.CANCEL, '★★「这次跳过（系列仍在）」与「这次取消（不再生成）」处置相反');
    const slots = Object.values(SL);
    assert.equal(new Set(slots).size, slots.length, '★ 空档各态必须互不相同');
    assert.notEqual(SL.FREE, SL.UNKNOWN, '★★「空闲」与「未知」处置相反（把未知当空闲会约到已排满的时间）');
    assert.notEqual(SL.BUSY, SL.UNKNOWN, '「冲突」与「未知」处置相反');
    const states = Object.values(S);
    assert.equal(new Set(states).size, states.length, '★ 周期各态必须互不相同');
    assert.notEqual(S.SINGLE, S.RECURRING, '「一次性」与「周期」处置相反');
    assert.notEqual(S.ABSENT, S.UNREADABLE, '「没有这一条」与「读不到」处置相反');
});

test('A2 展开与例外只有一处出处：视图与控制器都不自己算规则', () => {
    assert.ok(kernelCode.indexOf('function expandOccurrences(') >= 0, '唯一展开点必须真存在');
    assert.ok(kernelCode.indexOf('function applyExceptions(') >= 0, '唯一例外装配点必须真存在');
    assert.equal(appCode.indexOf('REC_FREQ.WEEKLY ==='), -1, '★ 控制器不得自己比周期词表');
    assert.ok(appCode.indexOf('expandOccurrences(') >= 0, '控制器必须转交契约件');
    assert.ok(appCode.indexOf('applyExceptions(') >= 0, '控制器必须转交契约件');
    assert.ok(viewCode.indexOf('recurrenceFace?.(') >= 0, '视图必须走 app.recurrenceFace()');
    assert.ok(viewCode.indexOf('recurrenceWithExceptions?.(') >= 0, '视图必须走 app.recurrenceWithExceptions()');
    /* 空档那一句也只许契约件一处拼。 */
    assert.ok(kernelCode.indexOf('function commonSlotLine(') >= 0, '唯一出处必须真存在');
});

test('A3 纯契约：零 DOM / 零存储 / 零联网 / 零时钟（计划原文「不后台常驻轮询」）', () => {
    for (const bad of ['document.', 'window.', 'localStorage', 'sessionStorage', 'indexedDB',
        'fetch(', 'XMLHttpRequest', 'setTimeout', 'setInterval', 'new Date(', 'dispatchEvent']) {
        assert.equal(kernelCode.indexOf(bad) >= 0, false, '纯契约件不得出现 ' + bad);
    }
    for (const bad of ['plugin.', 'LonShaMemory', 'memoryCore']) {
        assert.equal(kernelCode.indexOf(bad) >= 0, false, '★ 本件不得自己取数：' + bad);
    }
});

test('A4 视图接线：周期区块在场、三个动作按钮真投递、样式双侧都写', () => {
    assert.ok(viewSrc.indexOf('yzp-calendar-recur-block') >= 0, '视图缺周期区块');
    assert.ok(viewSrc.indexOf('周期与单次例外') >= 0, '区块标题必须在场');
    for (const act of ['move', 'skip', 'cancel']) {
        assert.ok(viewSrc.indexOf('data-recur-act="' + act + '"') >= 0, '缺动作按钮 ' + act);
    }
    assert.ok(viewCode.indexOf("root.querySelectorAll('[data-recur-act]')") >= 0, '动作必须真接线');
    assert.ok(viewCode.indexOf('this._recurrenceExceptions') >= 0, '例外必须真存进预览');
    /* 非周期日程不画这一块。 */
    assert.ok(viewCode.indexOf("face.state !== 'recurring'") >= 0, '非周期不画块的条件必须在场');
    /* 样式两侧投递：源面 + 运行时投递面。 */
    for (const cls of ['.yzp-calendar-recur-block', '.yzp-calendar-recur-title',
        '.yzp-calendar-recur-row', '.yzp-calendar-recur-actions', '.yzp-calendar-recur-btn']) {
        assert.ok(appCssSrc.indexOf(cls) >= 0, '源样式缺 ' + cls);
        assert.ok(bundleCssSrc.indexOf(cls) >= 0, 'phone.css 运行时投递面缺 ' + cls);
    }
});

/* ══════════ B ── 内核行为面 ══════════ */

test('B1 ★★★★★ 四周安排里改第二周、跳过第三周：其余各期逐字不变', () => {
    const w = K.expandOccurrences({ freq: 'weekly', weekday: 3, seriesKey: 'w1' }, 4);
    assert.equal(w.state, S.RECURRING);
    assert.equal(w.occurrences.length, 4, '四周应展开四期');
    const applied = K.applyExceptions(w, [
        { index: 1, action: 'move', at: '周五 20:00' },
        { index: 2, action: 'skip' },
    ]);
    assert.equal(applied.moved, 1);
    assert.equal(applied.skipped, 1);
    assert.equal(applied.cancelled, 0);
    assert.equal(applied.occurrences[1].action, 'move', '第二期应被改');
    assert.equal(applied.occurrences[2].action, 'skip', '第三期应被跳过');
    /* ★ 其余各期（第 1、4 期）**逐字不变**。 */
    assert.equal(applied.occurrences[0].action, '', '★ 第一期不得被改动');
    assert.equal(applied.occurrences[3].action, '', '★ 第四期不得被改动');
    assert.equal(applied.occurrences[0].key, w.occurrences[0].key, '★ 未被点名的期连 key 都不变');
    assert.equal(applied.occurrences[3].key, w.occurrences[3].key);
});

test('B2 ★★★★★ 跳过与取消不同形（系列仍在 vs 不再生成）', () => {
    const w = K.expandOccurrences({ freq: 'weekly', seriesKey: 'w1' }, 3);
    const skipped = K.applyExceptions(w, [{ index: 1, action: 'skip' }]);
    const cancelled = K.applyExceptions(w, [{ index: 1, action: 'cancel' }]);
    assert.equal(skipped.skipped, 1);
    assert.equal(cancelled.cancelled, 1);
    assert.ok(skipped.occurrences[1].why.indexOf('系列仍在') >= 0, '跳过必须说清「系列仍在」：' + skipped.occurrences[1].why);
    assert.ok(cancelled.occurrences[1].why.indexOf('不再生成') >= 0, '取消必须说清「不再生成」：' + cancelled.occurrences[1].why);
    assert.notEqual(skipped.occurrences[1].why, cancelled.occurrences[1].why, '★★ 两者必须不同句');
    assert.notEqual(skipped.occurrences[1].action, cancelled.occurrences[1].action, '动作名也必须不同');
});

test('B3 ★★★★★ 未知不算空闲（把未知当空闲会约到已排满的时间）', () => {
    const slots = [{ key: 'a' }, { key: 'b' }];
    const mixed = K.findCommonSlots(slots, [
        { name: '甲', busy: ['a'] },
        { name: '乙', busy: [], unread: true },
    ]);
    assert.equal(mixed.busy.length, 1, '「a」有冲突');
    assert.equal(mixed.unknown.length, 1, '★ 「b」判不了（有人没读到）');
    assert.equal(mixed.free.length, 0, '★★ 未知**不得**读成空闲');
    assert.ok(mixed.unknown[0].why.indexOf('不是「空闲」') >= 0, '逐格理由必须说清：' + mixed.unknown[0].why);
    assert.ok(mixed.line.indexOf('未知**不算**空闲') >= 0, '总读数必须说清：' + mixed.line);

    /* 全都没读到 ⇒ 一个都确定不了。 */
    const allUnread = K.findCommonSlots(slots, [{ name: '甲', busy: [], unread: true }]);
    assert.equal(allUnread.free.length, 0);
    assert.equal(allUnread.state, SL.UNKNOWN, '一个都确定不了 ⇒ 组级态记 unknown');

    /* 有人真忙、有人真闲 ⇒ 空闲那格仍是空闲（不因别人未知而全否）。 */
    const ok = K.findCommonSlots(slots, [{ name: '甲', busy: ['a'] }, { name: '乙', busy: [] }]);
    assert.equal(ok.free.length, 1, '真空闲必须照旧报空闲');
    assert.equal(ok.free[0].key, 'b');
});

test('B4 冲突逐人给理由；没选人时如实说（不是「都空闲」）', () => {
    const found = K.findCommonSlots([{ key: 'a' }], [{ name: '甲', busy: ['a'] }, { name: '乙', busy: ['a'] }]);
    assert.deepEqual(found.busy[0].who, ['甲', '乙'], '★ 冲突必须点名是谁（可解释空档）');
    assert.ok(found.busy[0].why.indexOf('已有日程') >= 0, '必须给出理由：' + found.busy[0].why);
    const none = K.findCommonSlots([{ key: 'a' }], []);
    assert.equal(none.state, S.ABSENT, '没选人 ⇒ absent');
    assert.ok(none.line.indexOf('还没选人') >= 0, '必须说清还没选人：' + none.line);
    assert.notEqual(none.line, found.line, '两者的话必须不同句');
});

test('B5 不认识的周期名与动作名都如实具名；读不到与没有这一条分形；不产定时器', () => {
    const weird = K.expandOccurrences({ freq: 'biweekly' }, 2);
    assert.equal(weird.state, S.SINGLE, '不认识的周期名 ⇒ 按一次性处理');
    assert.ok(weird.why.indexOf('biweekly') >= 0, '必须点名那个不认识的周期名：' + weird.why);
    assert.ok(weird.why.indexOf('不认识') >= 0, '必须说清「不认识」');
    const w = K.expandOccurrences({ freq: 'weekly' }, 2);
    const weirdEx = K.applyExceptions(w, [{ index: 0, action: 'mystery' }]);
    assert.equal(weirdEx.occurrences[0].action, 'unknown', '不认识的例外动作 ⇒ 记 unknown');
    assert.ok(weirdEx.occurrences[0].why.indexOf('mystery') >= 0, '必须点名那个不认识的动作');
    assert.ok(weirdEx.occurrences[0].why.indexOf('没被改动') >= 0, '必须说清这一次没被改动');
    /* 读不到 / 没有这一条 / 一次性 分形。 */
    assert.equal(K.expandOccurrences({ thrown: true }, 1).state, S.UNREADABLE);
    assert.equal(K.expandOccurrences(null, 1).state, S.ABSENT);
    assert.equal(K.expandOccurrences({ freq: 'none' }, 1).state, S.SINGLE);
    assert.deepEqual(K.recurrenceSelfCheck().problems, [], '内核自检必须零问题');
});

/* ══════════ C ── 接线面（真 App） ══════════ */

test('C1 真 App：周期展开与例外应用走契约件', () => {
    const app = mkApp();
    try {
        const face = app.recurrenceFace({ freq: 'weekly', weekday: 3, seriesKey: 'w1' }, 4);
        assert.equal(face.state, S.RECURRING);
        assert.equal(face.occurrences.length, 4);
        assert.equal(app.isWeeklyMonthly({ freq: 'weekly' }), true, '周期日程必须认得出来');
        assert.equal(app.isWeeklyMonthly({ type: 'daily' }), false, '非周期日程不该被认成周期');
        const applied = app.recurrenceWithExceptions({ freq: 'weekly', seriesKey: 'w1' }, [{ index: 1, action: 'skip' }], 4);
        assert.equal(applied.skipped, 1);
        assert.equal(applied.occurrences[0].action, '', '★ 其余各期逐字不变');
        assert.deepEqual(app.recurrenceContractSelfCheck().problems, []);
    } finally { clearWin(); }
});

test('C2 空档出口：未知不算空闲（真 App 转交）', () => {
    const app = mkApp();
    try {
        const r = app.commonSlots([{ key: 'a' }], [{ name: '甲', busy: [], unread: true }]);
        assert.equal(r.free.length, 0, '★ 真 App 出口也不得把未知读成空闲');
        assert.equal(r.unknown.length, 1);
    } finally { clearWin(); }
});

test('C3 取数抛了：如实报「读不到」，不假装「没有这一条」', () => {
    const app = mkApp();
    try {
        const face = app.recurrenceFace({ thrown: true }, 1);
        assert.equal(face.state, S.UNREADABLE, '★ 取数抛了必须记 unreadable');
        assert.ok(face.why.indexOf('读不到') >= 0, '必须说「读不到 ≠ 没有这一条」：' + face.why);
    } finally { clearWin(); }
});

test('C4 视图不直摸契约件；取数全走控制器', () => {
    assert.equal(viewSrc.indexOf('recurrence-contract'), -1, '★ 视图不得直接 import 契约件');
    assert.equal(viewCode.indexOf('expandOccurrences('), -1, '★ 视图不得自己展开');
    assert.equal(viewCode.indexOf('applyExceptions('), -1, '★ 视图不得自己应用例外');
    assert.ok(viewCode.indexOf('this.app?.recurrenceFace?.(') >= 0, '视图必须走控制器');
});

test('C5 例外只留在内存预览（不落盘：计划原文「不接系统日历/闹钟」）', () => {
    /* 视图把例外记在实例字段上，**不写 storage**。
     *   ★ 切片必须**只圈本版新增的那一段**（到下一段既有代码开始为止）：
     *   `calendarData` 在既有的 1284 行 view 里别处也有；切宽了会把既有形态算成本版缺陷。 */
    const i0 = viewCode.indexOf("root.querySelectorAll('[data-recur-act]')");
    const i1 = viewCode.indexOf("root.querySelectorAll('[data-holiday-settings-delete]')");
    assert.ok(i0 > 0 && i1 > i0, '必须能切出周期动作那一段');
    const seg = viewCode.slice(i0, i1);
    assert.ok(seg.indexOf('this._recurrenceExceptions = rest;') >= 0, '例外必须记在实例字段');
    assert.equal(seg.indexOf('calendarData'), -1, '★ 周期动作那一段不得写日程存储（只作预览）');
    /* 契约件也不写存储（A3 已判，这里再钉一次「没有 storage 键」）。 */
    assert.equal(kernelCode.indexOf('storage'), -1, '契约件不得摸存储');
});

/* ══════════ D ── 负控制（真源码定点破坏 ⇒ 同一判据必转红） ══════════ */
const temps = [];
function makeMirror() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rp_v4410_'));
    temps.push(dir);
    copyTreeSafe(path.join(ROOT, 'config'), path.join(dir, 'config'));
    copyTreeSafe(path.join(ROOT, 'apps'), path.join(dir, 'apps'));
    return dir;
}
process.on('exit', () => {
    for (const d of temps) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (_e) { /* 忽略 */ } }
});
function breakCopy(rel, anchor, replacement) {
    const dir = makeMirror();
    const src = read(rel);
    const hits = src.split(anchor).length - 1;
    assert.equal(hits, 1, '破坏锚点必须恰中 1 次（实测 ' + hits + '）：' + anchor.slice(0, 70));
    fs.writeFileSync(path.join(dir, rel), src.split(anchor).join(replacement));
    return dir;
}
async function loadKernel(dir, tag) {
    return await import(pathToFileURL(path.join(dir, KERNEL_REL)).href + '?' + tag + '=' + Date.now());
}
async function loadApp(dir, tag) {
    return await import(pathToFileURL(path.join(dir, APP_REL)).href + '?' + tag + '=' + Date.now());
}

test('D0 ★★★ 阳性对照：未破坏时四条判据必须全为真（否则 D 组是假绿）', () => {
    const w = K.expandOccurrences({ freq: 'weekly', seriesKey: 'w1' }, 4);
    const a = K.applyExceptions(w, [{ index: 1, action: 'move', at: 'x' }]);
    assert.equal(a.occurrences[0].action, '', '原版：未点名的期不变');
    const u = K.findCommonSlots([{ key: 'a' }], [{ name: '甲', busy: [], unread: true }]);
    assert.equal(u.free.length, 0, '原版：未知不算空闲');
    const s = K.applyExceptions(w, [{ index: 1, action: 'skip' }]);
    const c = K.applyExceptions(w, [{ index: 1, action: 'cancel' }]);
    assert.notEqual(s.occurrences[1].why, c.occurrences[1].why, '原版：跳过与取消不同句');
});

test('D1 ★★★★★ 破坏「单次例外只动那一期」⇒ 同款判据必转红（改第二周动了全系列）', async () => {
    const dir = breakCopy(KERNEL_REL,
        '        const hit = ex.filter((e) => e && Number(e.index) === Number(o.index))[0] || null;',
        '        const hit = ex[0] || null;');
    const mk = await loadKernel(dir, 'd1');
    const w = mk.expandOccurrences({ freq: 'weekly', seriesKey: 'w1' }, 4);
    const a = mk.applyExceptions(w, [{ index: 1, action: 'move', at: 'x' }]);
    assert.notEqual(a.occurrences[0].action, '',
        '★★ 破坏副本：例外被套到**每一期**上 ⇒ 用户只想改第二周，结果四周全变了');
    assert.equal(a.moved, 4, '破坏副本：四期全被改');
    const good = K.expandOccurrences({ freq: 'weekly', seriesKey: 'w1' }, 4);
    assert.equal(K.applyExceptions(good, [{ index: 1, action: 'move', at: 'x' }]).occurrences[0].action, '',
        '原版必须只动点名那一期');
});

test('D2 ★★★★★ 破坏「未知不算空闲」⇒ 同款判据必转红（约到已排满的时间）', async () => {
    const dir = breakCopy(KERNEL_REL,
        "        if (unknown.length) {\n            return { key: key, state: SLOT_STATES.UNKNOWN, who: unknown, why: '「' + unknown.join('/') + '」的日程**没读到** ⇒ 判不了（不是「空闲」）' };\n        }",
        '        void 0;');
    const mk = await loadKernel(dir, 'd2');
    const r = mk.findCommonSlots([{ key: 'a' }], [{ name: '甲', busy: [], unread: true }]);
    assert.notEqual(r.unknown.length, 1,
        '★★ 破坏副本：没读到的那一格不再判「未知」⇒ 被读成「空闲」（会把人约到已排满的时间）');
    assert.equal(r.free.length, 1, '破坏副本：它落进了空闲');
    const good = K.findCommonSlots([{ key: 'a' }], [{ name: '甲', busy: [], unread: true }]);
    assert.equal(good.free.length, 0, '原版必须不把未知当空闲');
});

test('D3 ★★★★ 破坏「跳过与取消分形」⇒ 同款判据必转红（跳过被读成取消）', async () => {
    const dir = breakCopy(KERNEL_REL,
        "        if (action === REC_EXCEPTION.SKIP) { skipped += 1; return Object.assign({}, o, { action: 'skip', at: '', durationMin: null, why: '这一次跳过（**系列仍在**，下一期照旧）' }); }",
        "        if (action === REC_EXCEPTION.SKIP) { skipped += 1; return Object.assign({}, o, { action: 'skip', at: '', durationMin: null, why: '这一次不办且**不再生成**（与「跳过」不同）' }); }");
    const mk = await loadKernel(dir, 'd3');
    const w = mk.expandOccurrences({ freq: 'weekly', seriesKey: 'w1' }, 3);
    const s = mk.applyExceptions(w, [{ index: 1, action: 'skip' }]);
    assert.equal(s.occurrences[1].why.indexOf('系列仍在'), -1,
        '★★ 破坏副本：「跳过」不再说清「系列仍在」⇒ 用户以为整个安排被取消了');
    assert.ok(K.applyExceptions(K.expandOccurrences({ freq: 'weekly', seriesKey: 'w1' }, 3), [{ index: 1, action: 'skip' }])
        .occurrences[1].why.indexOf('系列仍在') >= 0, '原版必须说清');
});

test('D4 ★★★★ 破坏「空件判定」⇒ 同款判据必转红（没有这一条被读成一次性）', async () => {
    const dir = breakCopy(KERNEL_REL,
        '    const isAbsent = !raw || typeof raw !== \'object\' || Array.isArray(raw);',
        '    const isAbsent = false;');
    const mk = await loadKernel(dir, 'd4');
    /* ★ 破坏后空件会**当场抛**（`raw.rule` 在 null 上取值）—— 那正是「没有这一条」
     *   这条分支被拆掉后的必然结果。判据必须**接住抛**并判红（不接住的话测试会以
     *   非断言错误中断，红得看不出落点）。 */
    let state = 'thrown';
    try { state = mk.expandOccurrences(null, 1).state; } catch (_e) { state = 'thrown'; }
    assert.notEqual(state, mk.REC_STATES.ABSENT,
        '★ 破坏副本：空件不再判「没有这一条」⇒ 要么抛、要么被读成「一次性」（两者都不是 absent）');
    assert.equal(K.expandOccurrences(null, 1).state, S.ABSENT, '原版必须判 absent');
});

test('D5 ★★★★ 破坏「本机例外不写盘」⇒ C5 同款判据必转红', async () => {
    const dir = breakCopy(VIEW_REL,
        '                this._recurrenceExceptions = rest;',
        '                this._recurrenceExceptions = rest; this.app.calendarData.setRecurrenceException?.(idx, act);');
    /* ★ 副本文件用**绝对路径**直接读（`read()` 是「相对仓根」的取数口，
     *   拿它读绝对路径会拼成 `/home/user/ruby-phone/tmp/...` —— 本仓明记过这条）。 */
    const src = fs.readFileSync(path.join(dir, VIEW_REL), 'utf8');
    assert.notEqual(src.indexOf('calendarData.set'), -1,
        '★ 破坏副本：例外被直接写进日程存储 ⇒ 与「这一屏只是预览、不接系统日历」相反');
    assert.equal(read(VIEW_REL).indexOf('calendarData.setRecurrenceException'), -1, '原版不得直接写日程存储');
});

/* ══════════ E ── 版本锚 ══════════ */
test('E1 五源同源 + 当版条目点名 R5-X8', () => {
    const pkg = JSON.parse(read('package.json'));
    const man = JSON.parse(read('manifest.json'));
    const log = JSON.parse(read('update-log.json'));
    const ver = pkg.version;
    assert.match(ver, /^\d+\.\d+\.\d+$/, '版本号形态必须正常:' + ver);
    assert.equal(man.version, ver, 'manifest 与 package 必须同版');
    assert.equal(log.latest, ver, 'update-log.latest 必须同版');
    assert.equal(log.head, ver, 'update-log.head 必须同版');
    assert.ok(log.versions[ver], '当版条目必须存在');
    const items = (log.versions[ver].items || []).join(NL);
    assert.ok(items.indexOf('R5-X8') >= 0, '当版条目必须点名 R5-X8');
    assert.ok(items.indexOf('第五期') >= 0, '当版条目必须点名第五期');
    assert.ok(items.indexOf('版本升至 ' + ver) >= 0, '当版条目必须带收口条目');
    assert.ok(read('index.js').indexOf("const ST_PHONE_VERSION = '" + ver + "';") >= 0, 'index.js 版本常量必须同源');
});