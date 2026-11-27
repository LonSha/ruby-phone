/* ============================================================
 * tests/apps-worldpulse-v4.test.mjs — 世界脉搏·照现实（v4.213.0）
 * ------------------------------------------------------------
 * 本套件只钉「结构面」，不钉像素：底栏三分区与单一真源、面判定只有一处、
 *   底栏排在内容层之后、热区与滚动层纪律、内联样式已迁出、两种空态分开说、
 *   筛片只重画列表、@import 真投递。
 * 负控制（N1/N2/N3）把源码替换后**跑同一组断言**：破坏必须让对应判据转红，
 *   否则判据只是自述（本仓 E6 同族纪律）。
 * ============================================================ */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const VIEW = read('apps/worldpulse/worldpulse-view.js');
const CSS = read('apps/worldpulse/worldpulse.v4.css');
const ENTRY = read('phone/design/rp-entry.css');
const countOf = (src, lit) => src.split(lit).length - 1;

/** 取某个选择器的声明块（第一个匹配）。 */
function blockOf(css, selector) {
    const i = css.indexOf(selector);
    if (i < 0) return '';
    const open = css.indexOf('{', i);
    const close = css.indexOf('}', open);
    return (open < 0 || close < 0) ? '' : css.slice(open + 1, close);
}

function pxOf(block, prop) {
    const m = block.match(new RegExp(prop + '\\s*:\\s*(\\d+)px'));
    return m ? Number(m[1]) : NaN;
}

/* ---------- 结构断言组（负控制复用同一组） ---------- */
function assertFacesSingleSource(src) {
    const i = src.indexOf('export const WP_FACES');
    const def = (i < 0) ? '' : src.slice(i, src.indexOf(']);', i) + 3);
    for (const id of ['feed', 'bridge', 'settings']) {
        assert.ok(def.includes("id: '" + id + "'"), 'WP_FACES 缺一格：' + id);
    }
    assert.ok(/WP_FACES\.map\(/.test(src), '底栏必须从 WP_FACES 渲染（不许另写一份标签表）');
    assert.equal(countOf(src, "id: 'bridge',"), 1, 'bridge 这一格只许定义一次');
}

function assertFaceDispatchSingle(src) {
    assert.equal(countOf(src, "this._face === 'bridge'"), 1,
        '面判定只许在 _renderFaceBody 一处（两处就会漂移成「切了格但内容没换」）');
    assert.equal(countOf(src, "this._face === 'settings'"), 1,
        'settings 的面判定也只许一处');
    assert.ok(src.includes('_renderFaceBody('), '面分派函数必须在场');
    assert.ok(src.includes('data-wp-face='), '当前格要落到 DOM 属性上（读数与样式都要用它）');
}

function assertNavAria(src) {
    assert.ok(src.includes('aria-current="page"'), '当前格要标 aria-current="page"（不是只靠颜色）');
    assert.ok(/aria-selected="\$\{on \? 'true' : 'false'\}"/.test(src), 'aria-selected 必须跟随当前格');
}

function assertCssDiscipline(cssRaw) {
    /* 先剥注释再判：文件头里写着「不用 position: fixed」这句**说明**本身会被
     *   子串判据当成违规 —— 这正是本仓反复付代价的「证据面混入非证据」
     *   （v2.68.0 dead-export E6 / registry 机制 B / 相册 A5 同族）。 */
    const css = cssRaw.replace(/\/\*[\s\S]*?\*\//g, ' ');
    const btn = blockOf(css, '.wp-app .wp-nav-btn {');
    assert.ok(btn, '.wp-nav-btn 规则必须在场');
    assert.ok(pxOf(btn, 'min-height') >= 44, '底栏格热区下限必须 ≥44（实测 ' + pxOf(btn, 'min-height') + '）');
    const body = blockOf(css, '.wp-app .wp-body {');
    assert.ok(/min-height:\s*0/.test(body), '滚动层必须自己写 min-height: 0（否则底栏被挤出可视区）');
    assert.equal(/position:\s*fixed/.test(css), false, '底栏不许用 position: fixed（会跑到手机壳外面）');
    const layerIdx = css.indexOf('@layer rp.apps {');
    const btnIdx = css.indexOf('.wp-app .wp-nav-btn {');
    assert.ok(layerIdx >= 0 && btnIdx > layerIdx, '按钮规则必须在 @layer rp.apps 内（否则被宿主 all: revert-layer 回滚成 UA 默认）');
}

/* ---------- A 组 ---------- */
test('A1 底栏三分区与 WP_FACES 单一真源', () => {
    assertFacesSingleSource(VIEW);
});

test('A2 面判定只有一处 + 当前格落到 DOM 属性', () => {
    assertFaceDispatchSingle(VIEW);
});

test('A3 底栏排在内容层之后且只出现一次', () => {
    const bodyAt = VIEW.indexOf('<div class="wp-body">');
    const navAt = VIEW.indexOf('${this.renderBottomNav()}');
    assert.ok(bodyAt > 0 && navAt > bodyAt, '底栏必须排在内容层之后（进正常流，不许压内容）');
    assert.equal(countOf(VIEW, 'renderBottomNav()'), 2, '底栏渲染点：一次定义 + 一次调用');
});

test('A4 当前格的 aria 双标（aria-current + aria-selected）', () => {
    assertNavAria(VIEW);
});

test('A5 样式纪律：热区 ≥44 / 滚动层 min-height:0 / 无 fixed / 按钮在 rp.apps 层', () => {
    assertCssDiscipline(CSS);
});

test('A6 视图不再输出内联 <style>（样式唯一来源是 v4.css）', () => {
    /* 为什么钉这条：无层内联规则会压过 @layer rp.apps 里的底栏规则，
     *   宿主 data-rp-ds=2 时还会被 all: revert-layer 打回 UA 默认 ——
     *   改造前这一屏正是靠一整段内联 <style> 画出来的。 */
    assert.equal(VIEW.includes('<style>'), false, '视图里不许再有内联 <style>');
    assert.equal(VIEW.includes('</style>'), false, '视图里不许再有内联 </style>');
    assert.equal(/_css\(\)/.test(VIEW), false, '_css() 内联样式出口必须已删除（别留半条死路）');
});

test('A7 动态两种空态分开说（一条都没有 ≠ 这颗筛片没有）', () => {
    assert.ok(VIEW.includes('data-wp-empty="none"'), '一条动态都没有要有自己的面');
    assert.ok(VIEW.includes('data-wp-empty="filtered"'), '筛片下没有命中要有自己的面');
    const none = VIEW.slice(VIEW.indexOf('data-wp-empty="none"'), VIEW.indexOf('data-wp-empty="none"') + 260);
    const filt = VIEW.slice(VIEW.indexOf('data-wp-empty="filtered"'), VIEW.indexOf('data-wp-empty="filtered"') + 260);
    assert.notEqual(none, filt, '两种空态不许用同一句话');
    assert.ok(filt.includes('${history.length}'), '筛空时要报出总条数（别让人以为世界空了）');
});

test('A8 筛片只重画列表（不整页重绘，否则滚动位置被顶回顶部）', () => {
    const at = VIEW.indexOf('chips.forEach(');
    assert.ok(at > 0, '筛片绑定必须在场');
    const end = VIEW.indexOf('/* 设置格 */', at);
    const seg = VIEW.slice(at, end > at ? end : at + 900);
    assert.ok(seg.includes("'wp-feed-list'"), '筛片切换要重画列表区');
    assert.equal(seg.includes('this.render()'), false, '筛片切换不许整页重绘');
});

test('A9 样式经入口 @import 投递（第三种机制，registry 门同源）', () => {
    assert.ok(/@import url\("\.\.\/\.\.\/apps\/worldpulse\/worldpulse\.v4\.css"\)/.test(ENTRY),
        'worldpulse.v4.css 必须由 phone/design/rp-entry.css 的 @import 引入');
});

test('A10 纪律面：视图不走原生 alert / confirm / prompt，且不自己起定时器', () => {
    for (const bad of ['alert(', 'window.confirm(', 'window.prompt(']) {
        assert.equal(VIEW.includes(bad), false, '不许出现 ' + bad + '（走 config/phone-feedback.js）');
    }
    for (const bad of ['setInterval(', 'setTimeout(']) {
        assert.equal(VIEW.includes(bad), false, '视图不许自己起 ' + bad + '（帧推进由调用方显式给）');
    }
});

/* ---------- N 组：破坏副本 ---------- */
test('N1 破坏：删掉「设置」这一格 ⇒ A1 必须转红', () => {
    const broken = VIEW.replace("    { id: 'settings', label: '设置', icon: 'fa-sliders', hint: '脉搏怎么跳：频率 / 风格 / 手动脉冲' },\n", '');
    assert.notEqual(broken, VIEW, '负控制锚点不存在（判据与本档脱钩）');
    assert.throws(() => assertFacesSingleSource(broken), /缺一格|只许定义一次/);
});

test('N2 破坏：把底栏热区压到 30px ⇒ A5 必须转红', () => {
    const broken = CSS.replace('.wp-app .wp-nav-btn {\n    min-height: 48px;', '.wp-app .wp-nav-btn {\n    min-height: 30px;');
    assert.notEqual(broken, CSS, '负控制锚点不存在');
    assert.throws(() => assertCssDiscipline(broken), /热区下限必须 ≥44/);
});

test('N3 破坏：把面判定再复制一份 ⇒ A2 必须转红', () => {
    const broken = VIEW.replace('return this._renderFeedFace();',
        "return this._face === 'bridge' ? this._renderBridgeFace() : this._renderFeedFace();");
    assert.notEqual(broken, VIEW, '负控制锚点不存在');
    assert.throws(() => assertFaceDispatchSingle(broken), /只许在 _renderFaceBody 一处/);
});