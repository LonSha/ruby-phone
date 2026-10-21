/* ============================================================
 * tests/system-v4430.test.mjs -- [v4.43.0 · 第五期 R5-X3 多人行踪时间带与会面证据]
 *
 * 验收口径（计划原文 R5-X3）：
 *   「选两到五名角色与时间窗，按角色展示有据的在场片段、未知区间和互斥地点；
 *     点击片段打开出处或地点，寻找可能会面的重叠区间但**不自动认定见面**。」
 *   验收旅程：「**两人相同场所在不同时间不显示已见面**；**重叠但无互动证据仅标可能共处**；
 *     **未知区间不画连续线**；320/375px 下可切人物和时段，返回保持视窗。」
 *   不做：**不接现实定位/地图API**；**不用动画代替准确时间**。
 *
 * 【修前实测的缺口（读码可复算，不是推演）】
 *   全仓零 `band` / `overlap` / `coPresence` 命中：在场判定只有「某一刻有谁」
 *   （`place-roam.js::presenceAt`），没有任何一格能表达「甲 10:00–12:00 在钟楼、
 *   乙 11:00–13:00 也在钟楼」。于是「两人同一地点但**不同时间**」与「真的碰上过」
 *   在界面上**完全同形**。
 *
 * 【本版落的三件】
 *   （一）契约件 `config/presence-band-contract.js`：片段四态（present / unknown /
 *   conflict / absent）+ 会面四态（possible / evidenced / unknown / none）；
 *   **未知不参与重叠判定**；**可能共处 ≠ 已见面**（要互动证据）；互斥地点单列；
 *   不认的时刻串不猜；十项自证。
 *   （二）控制器 `place-app.js`：`bandCharsFromScene` / `presenceBand` /
 *   `presenceBandLineOf` / `presenceBandSelfCheck`。
 *   （三）视图 `place-view.js`：行踪时间带卡（与「同楼同刻」并列：前者瞬时、后者时间窗）+
 *   点人名加/移出选择 + 互动证据开关；样式双侧（place.css 与 phone.css）。
 *
 * 判据面（六组）：
 *   A 口径：片段四态与会面四态互不同形 / 判定唯一出处 / 纯契约零副作用 / 视图接线
 *   B 内核行为：同地不同时间不算见面、重叠无证据只标可能共处、未知不参与重叠、
 *            互斥地点单列、不认时刻不猜
 *   C 接线行为：真 App 走完整旅程（无 ref 判未知 / 一个角色 too-few / 自检真消费）
 *   D 负控制：真源码定点破坏 ⇒ 同款判据必转红（每条配原版必真的反向对照）
 *   E 版本锚：五源同源 + 当版条目点名 R5-X3
 *
 * 【为什么负控制破坏副本而不是原仓】见 tests/system-v4120.test.mjs 档头（同规）。
 * 【为什么窄屏可切人物不在本套件判】那属**真 DOM/浏览器**读数，归浏览器门
 *   `tests/browser/gate.mjs`；本套件判它的可判定前件（选人名可加/移出、读数如实）。
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

const KERNEL_REL = 'config/presence-band-contract.js';
const APP_REL = 'apps/place/place-app.js';
const VIEW_REL = 'apps/place/place-view.js';
const VIEW_CSS_REL = 'apps/place/place.css';
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
const B = K.BAND_STATES;
const M = K.MEET_STATES;

/* ══════════ 假件 ══════════ */
/** 造一个真 App 实例（按真原型建；只补本版方法用到的字段）。 */
function mkApp(presence) {
    globalThis.window = { VirtualPhone: {} };
    const app = Object.create(APP.PlaceApp.prototype);
    app.projection = () => ({ proj: { ok: true, presence: Array.isArray(presence) ? presence : [] } });
    return app;
}
function clearWin() { delete globalThis.window; }

const seg = (from, to, place, ref, extra) => Object.assign({ from: from, to: to, place: place, ref: ref }, extra || {});

/* ══════════ A ── 口径面 ══════════ */

test('A1 片段四态与会面四态各自互不同形；「可能共处」与「有互动证据」必须分形', () => {
    const st = Object.values(B);
    assert.equal(new Set(st).size, st.length, '★ 片段各态必须唯一');
    assert.notEqual(B.UNKNOWN, B.PRESENT, '★★「未知」与「有据在场」处置相反');
    assert.notEqual(B.CONFLICT, B.PRESENT, '「互斥地点（数据冲突）」与「普通在场」处置相反');
    assert.notEqual(B.ABSENT, B.UNKNOWN, '「明确不在」与「未知」处置相反');
    const ms = Object.values(M);
    assert.equal(new Set(ms).size, ms.length, '★ 会面各态必须唯一');
    assert.notEqual(M.POSSIBLE, M.EVIDENCED, '★★「可能共处」与「有互动证据」处置相反');
    assert.notEqual(M.UNKNOWN, M.NONE, '「判不了」与「没见」处置相反');
});

test('A2 判定只有一处出处：视图与控制器都不自己判重叠', () => {
    assert.ok(kernelCode.indexOf('function coPresenceOf(') >= 0, '唯一判定点必须真存在');
    assert.ok(kernelCode.indexOf('function buildPresenceBand(') >= 0, '唯一装配点必须真存在');
    assert.equal(viewCode.indexOf('minutesOf'), -1, '★ 视图不得自己算时间重叠');
    assert.equal(viewCode.indexOf("'possible'"), -1, '★ 视图不得自持会面状态字面量');
    assert.ok(appCode.indexOf('buildPresenceBand(') >= 0, '控制器必须转交契约件');
    assert.ok(viewCode.indexOf('presenceBand?.(') >= 0, '视图必须走 app.presenceBand()');
    assert.ok(viewCode.indexOf('presenceBandLineOf?.(') >= 0, '视图必须走控制器读数口');
});

test('A3 纯契约：零 DOM / 零存储 / 零联网 / 零时钟', () => {
    for (const bad of ['document.', 'window.', 'localStorage', 'sessionStorage', 'indexedDB',
        'fetch(', 'XMLHttpRequest', 'setTimeout', 'setInterval', 'new Date(', 'dispatchEvent']) {
        assert.equal(kernelCode.indexOf(bad) >= 0, false, '纯契约件不得出现 ' + bad);
    }
    for (const bad of ['plugin.', 'LonShaMemory', 'memoryCore']) {
        assert.equal(kernelCode.indexOf(bad) >= 0, false, '★ 本件不得自己取数：' + bad);
    }
});

test('A4 视图接线：行踪带卡在场、事件真投递、样式双侧都写', () => {
    assert.ok(viewSrc.indexOf('行踪时间带') >= 0, '视图缺行踪带卡标题');
    assert.ok(viewSrc.indexOf('pl-band-row') >= 0, '视图缺重叠行容器');
    assert.ok(viewSrc.indexOf('data-band-name') >= 0, '缺人物选择按钮');
    assert.ok(viewSrc.indexOf('pl-band-evidenced') >= 0, '缺互动证据开关');
    assert.ok(viewCode.indexOf("el.querySelectorAll('[data-band-name]')") >= 0, '人物选择必须真接线');
    assert.ok(viewCode.indexOf("q('#pl-band-evidenced')?.addEventListener") >= 0, '开关必须真接线');
    /* 卡必须真被渲染（不是建好没挂）。 */
    assert.ok(viewCode.indexOf('this._presenceBandCard()') >= 0, '行踪带卡必须真被渲染');
    /* 与「同楼同刻」并列（前者瞬时、后者时间窗），不能合并。 */
    assert.ok(viewCode.indexOf('this._coPresenceCard(proj, face)') >= 0, '既有同楼同刻卡必须在场');
    /* 样式两侧投递。 */
    for (const cls of ['.pl-band-chips', '.pl-band-chip', '.pl-band-actions', '.pl-band-ev', '.pl-band-row']) {
        assert.ok(appCssSrc.indexOf(cls) >= 0, '源样式缺 ' + cls);
        assert.ok(bundleCssSrc.indexOf(cls) >= 0, 'phone.css 运行时投递面缺 ' + cls);
    }
});

/* ══════════ B ── 内核行为面 ══════════ */

test('B1 ★★★★★ 两人相同场所在不同时间不显示已见面', () => {
    const a = { id: 'a', name: '甲', segments: [seg('10:00', '12:00', '钟楼', 'f:10')] };
    const b = { id: 'b', name: '乙', segments: [seg('13:00', '15:00', '钟楼', 'f:20')] };
    const co = K.coPresenceOf(a, b);
    assert.equal(co.state, M.NONE, '★★ 同地不同时间 ⇒ 不算见面');
    assert.equal(co.pairs.length, 0, '不重叠就不该有重叠对');
    assert.ok(co.why.indexOf('没有重叠') >= 0, '必须说清没有重叠：' + co.why);
    /* 不同地点同一时间 ⇒ 也不算。 */
    const c = { id: 'c', name: '丙', segments: [seg('10:00', '12:00', '茶楼', 'f:30')] };
    assert.equal(K.coPresenceOf(a, c).state, M.NONE, '★ 同时间不同地点 ⇒ 不算见面');
});

test('B2 ★★★★★ 重叠但无互动证据仅标「可能共处」，不认定见面', () => {
    const a = { id: 'a', name: '甲', segments: [seg('10:00', '12:00', '钟楼', 'f:10')] };
    const b = { id: 'b', name: '乙', segments: [seg('11:00', '13:00', '钟楼', 'f:21')] };
    const co = K.coPresenceOf(a, b);
    assert.equal(co.state, M.POSSIBLE, '★★ 重叠无证据 ⇒ 只能说可能共处');
    assert.ok(co.why.indexOf('没有互动证据') >= 0, '必须说清没有互动证据：' + co.why);
    assert.ok(co.why.indexOf('不认定见面') >= 0, '必须说清不认定见面');
    assert.equal(co.pairs[0].evidenced, false, '无证据时 evidenced 必须为 false');
    /* 重叠区间与**各自**出处。 */
    assert.equal(co.pairs[0].from, 660, '重叠起点应是 11:00');
    assert.equal(co.pairs[0].to, 720, '重叠终点应是 12:00');
    assert.equal(co.pairs[0].aRef, 'f:10');
    assert.equal(co.pairs[0].bRef, 'f:21');
    /* 有互动证据 ⇒ 才算见面，且两态不同形。 */
    const ev = K.coPresenceOf(a, b, { evidenced: true });
    assert.equal(ev.state, M.EVIDENCED, '有证据 ⇒ evidenced');
    assert.notEqual(ev.state, co.state, '★★ 两态必须不同形');
});

test('B3 ★★★★★ 未知区间不参与重叠判定（不画连续线）', () => {
    const a = { id: 'a', name: '甲', segments: [seg('10:00', '12:00', '钟楼', 'f:10')] };
    /* 没 ref ⇒ 那一段是「没读到」。 */
    const b = { id: 'b', name: '乙', segments: [{ from: '11:00', to: '13:00', place: '钟楼' }] };
    const nb = K.normalizeBand(b);
    assert.equal(nb.segments[0].state, B.UNKNOWN, '★ 没 ref 又没标 absent ⇒ 判未知');
    assert.ok(nb.segments[0].why.indexOf('没读到') >= 0, '必须说清没读到：' + nb.segments[0].why);
    const co = K.coPresenceOf(a, b);
    assert.equal(co.state, M.UNKNOWN, '★★ 有人未知 ⇒ 判不了（不是「没见」）');
    assert.equal(co.pairs.length, 0, '★★ 未知片段不得参与重叠判定（把不知道当在场是最贵的错读数）');
    assert.ok(co.why.indexOf('不是「没见」') >= 0, '必须说清不是「没见」：' + co.why);
    /* 行读数也要说清「不画连续线」。 */
    const face = K.buildPresenceBand({ chars: [a, b] });
    assert.ok(face.line.indexOf('不画连续线') >= 0, '读数必须说清未知不画连续线：' + face.line);
});

test('B4 互斥地点单列（不是「同时在两处」）；明确不在与未知分形', () => {
    const cfl = K.normalizeBand({ id: 'c', name: '丙', segments: [seg('09:00', '10:00', '钟楼', 'f:1', { conflictWith: 'f:2' })] });
    assert.equal(cfl.segments[0].state, B.CONFLICT, '★ 两处都报了 ⇒ conflict');
    assert.ok(cfl.segments[0].why.indexOf('互斥地点') >= 0, '必须说清是互斥地点：' + cfl.segments[0].why);
    assert.ok(cfl.segments[0].why.indexOf('数据冲突') >= 0, '必须点明是数据冲突');
    assert.notEqual(cfl.segments[0].state, B.PRESENT, '★ 冲突不得读成普通在场');
    /* 有据不在（absent + ref）⇒ absent，与未知不同形。 */
    const ab = K.normalizeBand({ id: 'd', segments: [{ from: '01:00', to: '02:00', place: 'x', absent: true, ref: 'f:9' }] });
    assert.equal(ab.segments[0].state, B.ABSENT, '有据不在 ⇒ absent');
    assert.notEqual(ab.segments[0].state, B.UNKNOWN, '★「不在」与「未知」必须不同形');
});

test('B5 一个角色只有行踪没有会面；不认的时刻串不猜；自检零问题', () => {
    const a = { id: 'a', name: '甲', segments: [seg('10:00', '12:00', '钟楼', 'f:10')] };
    const one = K.buildPresenceBand({ chars: [a] });
    assert.equal(one.state, 'too-few', '★ 一个角色 ⇒ 只有行踪，没有会面');
    assert.ok(one.line.indexOf('两个或以上') >= 0, '必须说清要选两个或以上：' + one.line);
    /* 不认的时刻串 ⇒ 不判重叠（不猜）。 */
    const badTime = K.coPresenceOf(a, { id: 'e', segments: [seg('上午', '中午', '钟楼', 'f:5')] });
    assert.equal(badTime.pairs.length, 0, '★ 时刻串认不出 ⇒ 不判重叠（不猜）');
    /* 读不到与没选人分形。 */
    const bad = K.buildPresenceBand({ thrown: true });
    const none = K.buildPresenceBand({});
    assert.equal(bad.state, 'unreadable');
    assert.notEqual(bad.line, none.line, '★★「读不到」与「没选人」必须不同句');
    assert.deepEqual(K.presenceBandSelfCheck().problems, [], '★ 内核自检必须零问题');
});

/* ══════════ C ── 接线面（真 App） ══════════ */

test('C1 真 App：无 ref 的在场记录如实判未知（不读成「一直在」）', () => {
    const app = mkApp([
        { name: '甲', key: '钟楼', from: '10:00', to: '12:00', ref: 'f:10' },
        { name: '乙', key: '钟楼', from: '11:00', to: '13:00' },
    ]);
    try {
        const chars = app.bandCharsFromScene(['甲', '乙']);
        assert.equal(chars.length, 2, '两个角色都要在');
        assert.equal(chars[0].segments[0].ref, 'f:10', '带 ref 的照旧带');
        assert.equal(chars[1].segments[0].unread, true, '★ 没 ref 的必须标 unread');
        const face = app.presenceBand(['甲', '乙']);
        assert.equal(face.state, 'ready');
        assert.equal(face.chars[1].unknown, 1, '★ 乙那一段必须落未知');
        assert.equal(face.pairs[0].state, M.UNKNOWN, '★ 有人未知 ⇒ 那对判不了');
        assert.deepEqual(app.presenceBandSelfCheck().problems, []);
    } finally { clearWin(); }
});

test('C2 真 App：两人都有据且重叠 ⇒ 可能共处（默认不带互动证据）', () => {
    const app = mkApp([
        { name: '甲', key: '钟楼', from: '10:00', to: '12:00', ref: 'f:10' },
        { name: '乙', key: '钟楼', from: '11:00', to: '13:00', ref: 'f:20' },
    ]);
    try {
        const face = app.presenceBand(['甲', '乙']);
        assert.equal(face.pairs[0].state, M.POSSIBLE, '★ 默认（无互动证据）⇒ 可能共处');
        assert.ok(face.line.indexOf('可能共处') >= 0, '读数必须说可能共处：' + face.line);
        /* 开关打开 ⇒ 才算见面。 */
        const ev = app.presenceBand(['甲', '乙'], { evidenced: true });
        assert.equal(ev.pairs[0].state, M.EVIDENCED, '开关打开 ⇒ 有互动证据');
        assert.notEqual(ev.line, face.line, '★ 两种读数必须不同句');
    } finally { clearWin(); }
});

test('C3 真 App：一个角色 too-few；没选角色也 too-few（不假装「没有会面」）', () => {
    const app = mkApp([{ name: '甲', key: '钟楼', from: '10:00', to: '12:00', ref: 'f:10' }]);
    try {
        assert.equal(app.presenceBand(['甲']).state, 'too-few');
        assert.equal(app.presenceBand([]).state, 'too-few');
        assert.ok(app.presenceBand(['甲']).line.indexOf('两个或以上') >= 0);
    } finally { clearWin(); }
});

test('C4 取数抛了：如实报「读不到」，不假装「这几个人没行踪」', () => {
    const app = Object.create(APP.PlaceApp.prototype);
    app.projection = () => { throw new Error('boom'); };
    globalThis.window = { VirtualPhone: {} };
    try {
        const face = app.presenceBand(['甲', '乙']);
        /* 取数抛了 ⇒ 契约件判「没读到那两段」而不是崩（本层不抛）。 */
        assert.equal(face.state, 'ready', '本层不抛，仍给得出一面');
        assert.equal(face.chars[0].unknown, 1, '★ 取不到 ⇒ 那一段如实落未知（不是「不在」）');
        assert.equal(face.chars[0].present, 0, '★★ 取不到不得读成「有据在场」');
        const bad = K.buildPresenceBand({ thrown: true });
        assert.equal(bad.state, 'unreadable');
        assert.ok(bad.line.indexOf('读不到') >= 0, '必须说「读不到 ≠ 这几个人没行踪」：' + bad.line);
    } finally { clearWin(); }
});

test('C5 视图不直摸契约件；取数全走控制器', () => {
    assert.equal(viewSrc.indexOf('presence-band-contract'), -1, '★ 视图不得直接 import 契约件');
    assert.equal(viewCode.indexOf('coPresenceOf('), -1, '★ 视图不得自己判重叠');
    assert.equal(viewCode.indexOf('buildPresenceBand('), -1, '★ 视图不得自己装配');
    assert.ok(viewCode.indexOf('this.app.presenceBand?.(') >= 0, '视图必须走控制器');
});

/* ══════════ D ── 负控制（真源码定点破坏 ⇒ 同一判据必转红） ══════════ */
const temps = [];
function makeMirror() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rp_v4430_'));
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
    const a = { id: 'a', name: '甲', segments: [seg('10:00', '12:00', '钟楼', 'f:10')] };
    const b = { id: 'b', name: '乙', segments: [seg('13:00', '15:00', '钟楼', 'f:20')] };
    assert.equal(K.coPresenceOf(a, b).state, M.NONE, '原版：同地不同时间不算见面');
    const b2 = { id: 'b', name: '乙', segments: [seg('11:00', '13:00', '钟楼', 'f:21')] };
    assert.equal(K.coPresenceOf(a, b2).state, M.POSSIBLE, '原版：重叠无证据 ⇒ 可能共处');
    assert.equal(K.normalizeBand({ segments: [{ from: '1:00', to: '2:00', place: 'x' }] }).segments[0].state, B.UNKNOWN, '原版：没 ref ⇒ 未知');
    assert.equal(K.normalizeBand({ segments: [seg('1:00', '2:00', 'x', 'f:1', { conflictWith: 'f:2' })] }).segments[0].state, B.CONFLICT, '原版：互斥地点单列');
});

test('D1 ★★★★★ 破坏「未知不参与重叠」⇒ 同款判据必转红（把不知道当在场）', async () => {
    /* ★ 破坏落点必须**真的让未知走进重叠分支**：首版只去掉那一条 `continue`，
     *   但后面还有 `x.state !== PRESENT` 一条挡着 ⇒ 计数不变，红得落点不对。
     *   真落点是「未知被当成在场」这一步（把 unknown 归进 present 分支）。 */
    const dir = breakCopy(KERNEL_REL,
        '        else if (unread) state = BAND_STATES.UNKNOWN;',
        '        else if (unread) state = BAND_STATES.PRESENT;');
    const mk = await loadKernel(dir, 'd1');
    const a = { id: 'a', name: '甲', segments: [seg('10:00', '12:00', '钟楼', 'f:10')] };
    const b = { id: 'b', name: '乙', segments: [{ from: '11:00', to: '13:00', place: '钟楼' }] };
    const co = mk.coPresenceOf(a, b);
    assert.notEqual(co.pairs.length, 0,
        '★★ 破坏副本：未知片段被当成在场 ⇒ 「不知道」被读成「他一直在」（给出根本没证据的会面）');
    assert.equal(K.coPresenceOf(a, b).pairs.length, 0, '原版必须不拿未知算重叠');
});

test('D2 ★★★★★ 破坏「可能共处 ≠ 已见面」⇒ 同款判据必转红（无证据也认定见面）', async () => {
    const dir = breakCopy(KERNEL_REL,
        "    out.state = o.evidenced === true ? MEET_STATES.EVIDENCED : MEET_STATES.POSSIBLE;",
        '    out.state = MEET_STATES.EVIDENCED;');
    const mk = await loadKernel(dir, 'd2');
    const a = { id: 'a', name: '甲', segments: [seg('10:00', '12:00', '钟楼', 'f:10')] };
    const b = { id: 'b', name: '乙', segments: [seg('11:00', '13:00', '钟楼', 'f:21')] };
    assert.equal(mk.coPresenceOf(a, b).state, mk.MEET_STATES.EVIDENCED,
        '★★ 破坏副本：没有互动证据也认定见面 ⇒ 用户以为两人碰过面');
    assert.equal(K.coPresenceOf(a, b).state, M.POSSIBLE, '原版必须只标可能共处');
});

test('D3 ★★★★ 破坏「没 ref 判未知」⇒ 同款判据必转红（没数据被读成一直在）', async () => {
    const dir = breakCopy(KERNEL_REL,
        '        const unread = e.unread === true || (!ref && e.absent !== true);',
        '        const unread = false;');
    const mk = await loadKernel(dir, 'd3');
    const nb = mk.normalizeBand({ id: 'b', segments: [{ from: '11:00', to: '13:00', place: '钟楼' }] });
    assert.notEqual(nb.segments[0].state, mk.BAND_STATES.UNKNOWN,
        '★★ 破坏副本：没 ref 不再判未知 ⇒ 被读成「有据在场」（用户以为他一直在那儿）');
    assert.equal(nb.segments[0].state, mk.BAND_STATES.PRESENT, '破坏副本：它落进了有据在场');
    assert.equal(K.normalizeBand({ segments: [{ from: '1:00', to: '2:00', place: 'x' }] }).segments[0].state, B.UNKNOWN,
        '原版必须判未知');
});

test('D4 ★★★★ 破坏「互斥地点单列」⇒ 同款判据必转红（数据冲突被读成普通在场）', async () => {
    const dir = breakCopy(KERNEL_REL,
        '        if (conflictWith) state = BAND_STATES.CONFLICT;',
        '        if (false) state = BAND_STATES.CONFLICT;');
    const mk = await loadKernel(dir, 'd4');
    const cfl = mk.normalizeBand({ id: 'c', segments: [seg('09:00', '10:00', '钟楼', 'f:1', { conflictWith: 'f:2' })] });
    assert.notEqual(cfl.segments[0].state, mk.BAND_STATES.CONFLICT,
        '★ 破坏副本：两处都报了却不再单列 ⇒ 数据冲突被读成普通在场（用户以为数据没问题）');
    assert.equal(K.normalizeBand({ segments: [seg('1:00', '2:00', 'x', 'f:1', { conflictWith: 'f:2' })] }).segments[0].state,
        B.CONFLICT, '原版必须单列');
});

test('D5 ★★★★ 破坏「不认时刻不猜」⇒ 同款判据必转红（拿认不出的时刻硬算）', async () => {
    /* ★ 破坏落点：把「不认出的时刻不算重叠」的两道闸**一起**去掉 ——
     *   `minutesOf` 认不出会返回 null，而 `Math.max(null, 600)` 会把它当 0
     *   （JS 的隐式转换），于是**只要没有闸**就会推出一个倒挂的假重叠区间。
     *   首版只去掉其中一道 ⇒ 另一道仍挡着 ⇒ 计数不变，**红得落点不对**
     *   （与 R5-X1 的 D5、R5-O9 的 D1 同族）。 */
    const dir = breakCopy(KERNEL_REL,
        '            if (xf === null || xt === null || yf === null || yt === null) continue;\n'
        + '            const from = Math.max(xf, yf);\n'
        + '            const to = Math.min(xt, yt);\n'
        + '            if (to < from) continue;',
        '            const from = Math.max(xf, yf);\n'
        + '            const to = Math.min(xt, yt);');
    const mk = await loadKernel(dir, 'd5');
    const a = { id: 'a', name: '甲', segments: [seg('10:00', '12:00', '钟楼', 'f:10')] };
    const b = { id: 'e', segments: [seg('上午', '中午', '钟楼', 'f:5')] };
    let n = -1;
    try { n = mk.coPresenceOf(a, b).pairs.length; } catch (_e) { n = -1; }
    assert.notEqual(n, 0,
        '★★ 破坏副本：认不出的时刻被硬算 ⇒ 推出一个倒挂的假重叠区间（「上午」被当成 00:00 那一格）');
    assert.equal(K.coPresenceOf(a, b).pairs.length, 0, '原版必须不拿认不出的时刻算重叠');
});

/* ══════════ E ── 版本锚 ══════════ */
test('E1 五源同源 + 当版条目点名 R5-X3', () => {
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
    assert.ok(items.indexOf('R5-X3') >= 0, '当版条目必须点名 R5-X3');
    assert.ok(items.indexOf('第五期') >= 0, '当版条目必须点名第五期');
    assert.ok(items.indexOf('版本升至 ' + ver) >= 0, '当版条目必须带收口条目');
    assert.ok(read('index.js').indexOf("const ST_PHONE_VERSION = '" + ver + "';") >= 0, 'index.js 版本常量必须同源');
});