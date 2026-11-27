/* ============================================================
 * tests/apps-place-v4.test.mjs — 地点图景·照客户端形态（v4.215.0）
 * ------------------------------------------------------------
 * 只钉「结构面」，不钉像素：底栏四格与单一真源、面判定只有一处、
 *   底栏排在内容层之后、归因卡进外壳（每格都先说明读不读得到）、
 *   热区与滚动层纪律、切格不写盘、@import 真投递。
 * 负控制（N1/N2/N3）把源码替换后**跑同一组断言**：破坏必须让对应判据转红，
 *   否则判据只是自述。
 * ============================================================ */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const VIEW = read('apps/place/place-view.js');
const CSS = read('apps/place/place.v4.css');
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
    const i = src.indexOf('export const PL_FACES');
    const def = (i < 0) ? '' : src.slice(i, src.indexOf(']);', i) + 3);
    for (const id of ['here', 'who', 'go', 'more']) {
        assert.ok(def.includes("key: '" + id + "'"), 'PL_FACES 缺一格：' + id);
    }
    assert.ok(/PL_FACES\.map\(/.test(src) || /PL_FACES\.length/.test(src), '底栏必须从 PL_FACES 渲染（不许另写一份标签表）');
    assert.equal(countOf(src, "{ key: 'go', label: '去哪'"), 1, '「去哪」这一格只许定义一次');
}

function assertFaceDispatchSingle(src) {
    for (const id of ['who', 'go', 'more']) {
        assert.equal(countOf(src, "this._face === '" + id + "'"), 1,
            '面判定只许在 _renderFaceBody 一处（两处就会漂移成「切了格但内容没换」）：' + id);
    }
    assert.ok(src.includes('_renderFaceBody('), '面分派函数必须在场');
    assert.ok(src.includes('data-pl-face='), '当前格要落到 DOM 属性上');
}

/** 归因卡进外壳：每一格都先说明读不读得到（否则「读不到」会被误读成「没有」）。 */
function assertReasonHeadAlways(src) {
    assert.equal(countOf(src, 'const head = this._reasonCard(face);'), 1,
        '归因卡必须只取一次（写在面分派函数里）');
    const at = src.indexOf('_renderFaceBody(face, proj, src) {');
    assert.ok(at > 0, '面分派函数必须在场');
    const tail = src.indexOf('\n    _showDiag() {', at);
    const seg = src.slice(at, tail > at ? tail : at + 1600);
    const returns = seg.split('return ').slice(1);
    assert.ok(returns.length >= 4, '四格都要有返回分支（实际 ' + returns.length + '）');
    for (const r of returns) {
        assert.ok(r.slice(0, 80).includes('head'), '每一格的返回里都必须带上归因卡（缺的那格会把「读不到」显示成「没有」）');
    }
}

function assertNavAria(src) {
    assert.ok(/' aria-current="' \+ \(on \? 'page' : 'false'\)/.test(src), '当前格要标 aria-current=page（不是只靠颜色）');
    assert.ok(/' aria-selected="' \+ \(on \? 'true' : 'false'\)/.test(src), 'aria-selected 必须跟随当前格');
}

function assertCssDiscipline(cssRaw) {
    /* 先剥注释再判：文件头里写着「不用 position: fixed」这句**说明**本身会被
     *   子串判据当成违规（证据面混入非证据；本仓反复付代价的同族缺陷）。 */
    const css = cssRaw.replace(/\/\*[\s\S]*?\*\//g, ' ');
    const btn = blockOf(css, '.pl-root .pl-btm-btn {');
    assert.ok(btn, '.pl-btm-btn 规则必须在场');
    assert.ok(pxOf(btn, 'min-height') >= 44, '底栏格热区下限必须 ≥44（实测 ' + pxOf(btn, 'min-height') + '）');
    const body = blockOf(css, '.pl-root .pl-body {');
    assert.ok(/min-height:\s*0/.test(body), '滚动层必须自己写 min-height: 0（否则底栏被挤出可视区）');
    assert.equal(/position:\s*fixed/.test(css), false, '底栏不许用 position: fixed');
    const layerIdx = css.indexOf('@layer rp.apps {');
    const btnIdx = css.indexOf('.pl-root .pl-btm-btn {');
    assert.ok(layerIdx >= 0 && btnIdx > layerIdx, '按钮规则必须在 @layer rp.apps 内（否则被宿主 all: revert-layer 回滚成 UA 默认）');
}

/* ---------- A 组 ---------- */
test('A1 底栏四格与 PL_FACES 单一真源', () => {
    assertFacesSingleSource(VIEW);
});

test('A2 面判定只有一处 + 当前格落到 DOM 属性', () => {
    assertFaceDispatchSingle(VIEW);
});

test('A3 底栏排在内容层之后且只出现一次', () => {
    const bodyAt = VIEW.indexOf('<div class="pl-body" id="pl-body">');
    const navAt = VIEW.indexOf('this._btmNavHtml()');
    assert.ok(bodyAt > 0 && navAt > bodyAt, '底栏必须排在内容层之后（进正常流，不许压内容）');
    assert.equal(countOf(VIEW, '_btmNavHtml()'), 2, '底栏渲染点：一次定义 + 一次调用');
});

test('A4 当前格的 aria 双标（aria-current + aria-selected）', () => {
    assertNavAria(VIEW);
});

test('A5 样式纪律：热区 ≥44 / 滚动层 min-height:0 / 无 fixed / 按钮在 rp.apps 层', () => {
    assertCssDiscipline(CSS);
});

test('A6 归因卡进外壳：四格都先说明读不读得到', () => {
    assertReasonHeadAlways(VIEW);
});

test('A7 标题跟着当前格走（不写死一个格名）', () => {
    assert.ok(countOf(VIEW, '_faceLabel()') >= 2, '标题必须取 _faceLabel()（定义 + 调用）');
    assert.equal(VIEW.includes('<h2>地点图景</h2>'), false, '标题不许写死（切格后标题必须跟着变）');
});

test('A8 切格不写盘：底栏点击只改现场态并重画', () => {
    const at = VIEW.indexOf("qa('[data-pl-face]')");
    assert.ok(at > 0, '底栏绑定必须在场');
    const seg = VIEW.slice(at, at + 700);
    assert.equal(/storage/i.test(seg), false, '切格不许碰存储（这一格是现场态，换页即丢）');
    assert.ok(seg.includes('this._face = k'), '切格只改现场态');
    assert.ok(seg.includes('this._draw()'), '切格后重画');
});

test('A9 样式经入口 @import 投递（第三种机制，registry 门同源）', () => {
    assert.ok(/@import url\("\.\.\/\.\.\/apps\/place\/place\.v4\.css"\)/.test(ENTRY),
        'place.v4.css 必须由 phone/design/rp-entry.css 的 @import 引入');
});

test('A10 纪律面：视图不走原生 alert / confirm / prompt，且不自己起定时器', () => {
    for (const bad of ['alert(', 'window.confirm(', 'window.prompt(']) {
        assert.equal(VIEW.includes(bad), false, '不许出现 ' + bad);
    }
    for (const bad of ['setInterval(', 'setTimeout(']) {
        assert.equal(VIEW.includes(bad), false, '视图不许自己起 ' + bad);
    }
});

/* ---------- N 组：破坏副本 ---------- */
test('N1 破坏：删掉「去哪」这一格 ⇒ A1 必须转红', () => {
    const broken = VIEW.replace("    { key: 'go', label: '去哪', icon: 'fa-route' },\n", '');
    assert.notEqual(broken, VIEW, '负控制锚点不存在（判据与本档脱钩）');
    assert.throws(() => assertFacesSingleSource(broken), /缺一格|只许定义一次/);
});

test('N2 破坏：把底栏热区压到 30px ⇒ A5 必须转红', () => {
    const broken = CSS.replace('.pl-root .pl-btm-btn {\n    min-height: 48px;', '.pl-root .pl-btm-btn {\n    min-height: 30px;');
    assert.notEqual(broken, CSS, '负控制锚点不存在');
    assert.throws(() => assertCssDiscipline(broken), /热区下限必须 ≥44/);
});

test('N3 破坏：把面判定再复制一份 ⇒ A2 必须转红', () => {
    const anchor = "        return [\n            head,\n            this._sourceCard(src),";
    const broken = VIEW.replace(anchor, "        if (this._face === 'who') return head;\n" + anchor);
    assert.notEqual(broken, VIEW, '负控制锚点不存在');
    assert.throws(() => assertFaceDispatchSingle(broken), /只许在 _renderFaceBody 一处/);
});
