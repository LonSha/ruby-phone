/* ============================================================
 * tests/r25_x5_layout_breaks.test.mjs — R25-X5 多设备布局（三档断点 + 横竖切换不丢状态）
 * ------------------------------------------------------------
 * 【咬点】
 * 1. 三档**各有明确布局**（不是三个名字）：列数 / 限宽 / 边距缩放必须真的不同；
 * 2. 断点**只有一处真源**：`config/layout-breaks.js` 里定义 compactMax/wideMin，
 *    别处只许引用字段，不许再写一份阈值（修前 phone.css 里有 310/359/360/420/500/501/520/600/768/900 十套）；
 * 3. 量不到 ⇒ `unreadable`，**不冒充 standard**（旧引擎的 `Number(w)||375` 正是这个塌陷）；
 * 4. 在盘的 `ScreenAdaptiveLayoutEngine` 必须**变成消费者**（它从前的 768/480/360 与
 *    `calculateAdaptiveMetrics` 零调用点，是「模块在盘 ≠ 机制在用」的典型）；
 * 5. 外壳真把属性写上去：resize / orientationchange 都经 `bindGlobal` 登记（能回收），
 *    且该方法体**不重建 DOM**（重建就会丢草稿，这正是「切换不丢状态」的兑现方式）；
 * 6. 读回对拍三态：`same` / `mismatch` / `unknown`，`unknown ≠ same`。
 * ============================================================ */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
    LAYOUT_TIERS, BREAKPOINTS, ORIENTATIONS, TIER_TABLE, FACE_STATES, LAYOUT_ATTRS,
    tierOfWidth, orientationOf, layoutFace, layoutAttributes, judgeLayoutApplied, layoutText
} from '../config/layout-breaks.js';
import { ScreenAdaptiveLayoutEngine } from '../phone/screen-adaptive-layout-engine.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');

/* ---------------- 1. 三档语义 ---------------- */

test('X5-1 三档闭集且每档布局真的不同（不是三个名字）', () => {
    assert.deepEqual([...LAYOUT_TIERS], ['compact', 'standard', 'wide']);
    assert.deepEqual([...ORIENTATIONS], ['portrait', 'landscape']);
    assert.equal(BREAKPOINTS.compactMax, 479);
    assert.equal(BREAKPOINTS.wideMin, 900);
    assert.ok(BREAKPOINTS.compactMax < BREAKPOINTS.wideMin, '断点必须单调');
    /* 三档的「布局指纹」两两不同形：列数 / 限宽 / 边距缩放里至少两项不同。 */
    const sig = (t) => {
        const r = TIER_TABLE[t];
        return [r.grid, r.homeGridColumns, String(r.maxContentWidthPx), r.paddingScale].join('|');
    };
    const sigs = LAYOUT_TIERS.map(sig);
    assert.equal(new Set(sigs).size, 3, '三档布局指纹必须互不相同：' + sigs.join(' vs '));
    /* 桌面列数必须真的递增（窄屏挤不下 6 列，宽屏也不该只有 3 列）。 */
    assert.ok(TIER_TABLE.compact.homeGridColumns < TIER_TABLE.standard.homeGridColumns);
    assert.ok(TIER_TABLE.standard.homeGridColumns < TIER_TABLE.wide.homeGridColumns);
    /* 宽屏必须限宽：不限宽就是「更宽的一列」。 */
    assert.ok(TIER_TABLE.wide.maxContentWidthPx > 0);
    assert.ok(TIER_TABLE.wide.maxContentWidthPx > TIER_TABLE.standard.maxContentWidthPx);
    assert.equal(TIER_TABLE.compact.maxContentWidthPx, null, '窄屏不该再限宽（本来就窄）');
});

test('X5-2 判档边界逐格真算：479/480 与 899/900 两侧都验', () => {
    assert.equal(tierOfWidth(320), 'compact');
    assert.equal(tierOfWidth(478), 'compact');
    assert.equal(tierOfWidth(479), 'compact');
    assert.equal(tierOfWidth(480), 'standard');
    assert.equal(tierOfWidth(899), 'standard');
    assert.equal(tierOfWidth(900), 'wide');
    assert.equal(tierOfWidth(1440), 'wide');
    /* 负控制：读不到宽度 ⇒ null，**不回落** standard（这是本项的核心纪律）。 */
    assert.equal(tierOfWidth(null), null);
    assert.equal(tierOfWidth(''), null);
    assert.equal(tierOfWidth('abc'), null);
    assert.equal(tierOfWidth(0), null);
    assert.equal(tierOfWidth(-100), null);
    assert.notEqual(tierOfWidth(null), 'standard');
});

test('X5-3 朝向判定：等宽高算竖屏；读不到任一维 ⇒ null', () => {
    assert.equal(orientationOf(900, 400), 'landscape');
    assert.equal(orientationOf(400, 900), 'portrait');
    assert.equal(orientationOf(600, 600), 'portrait', '相等时按竖屏（避免「正方形随机」）');
    assert.equal(orientationOf(null, 600), null);
    assert.equal(orientationOf(600, undefined), null);
    assert.notEqual(orientationOf(null, 600), 'portrait');
});

/* ---------------- 2. 量测面与三态 ---------------- */

test('X5-4 量测面：字段齐备，属性正好两个键（数据面与 CSS 同名）', () => {
    const f = layoutFace({ width: 1280, height: 800 });
    assert.equal(f.state, FACE_STATES.measured);
    assert.equal(f.tier, 'wide');
    assert.equal(f.orientation, 'landscape');
    assert.equal(f.width, 1280);
    assert.equal(f.height, 800);
    assert.equal(f.homeGridColumns, TIER_TABLE.wide.homeGridColumns);
    const keys = Object.keys(f.attributes).sort();
    assert.deepEqual(keys, ['data-layout', 'data-orientation']);
    assert.equal(f.attributes[LAYOUT_ATTRS.layout], 'wide');
    assert.equal(f.attributes[LAYOUT_ATTRS.orientation], 'landscape');
});

test('X5-5 量不到 ⇒ unreadable 且逐因点名，绝不冒充 standard', () => {
    const noW = layoutFace({ height: 800 });
    assert.equal(noW.state, FACE_STATES.unreadable);
    assert.equal(noW.reason, 'no-width');
    assert.equal(noW.tier, null);
    assert.notEqual(noW.tier, 'standard');

    const noH = layoutFace({ width: 800 });
    assert.equal(noH.reason, 'no-height', '宽读不到 ≠ 高读不到（理由必须分开）');
    assert.notEqual(noH.reason, noW.reason);

    const zero = layoutFace({ width: 0, height: 800 });
    assert.equal(zero.state, FACE_STATES.unreadable);
    assert.equal(zero.attributes && Object.keys(zero.attributes).length, 0);
    assert.deepEqual({ ...layoutAttributes(zero) }, {}, '量不到时不许给属性');
});

test('X5-6 人话文案：读不到与「标准档」不同形', () => {
    const bad = layoutText(layoutFace({}));
    const good = layoutText(layoutFace({ width: 600, height: 844 }));
    assert.match(bad, /这不等于「标准档」/);
    assert.match(good, /标准（手机）/);
    assert.notEqual(bad, good);
});

/* ---------------- 3. 读回对拍三态 ---------------- */

test('X5-7 读回对拍：same / mismatch / unknown 三态不塌', () => {
    const f = layoutFace({ width: 600, height: 844 });
    assert.equal(judgeLayoutApplied(f, { layout: 'standard', orientation: 'portrait' }), 'same');
    assert.equal(judgeLayoutApplied(f, { layout: 'wide', orientation: 'portrait' }), 'mismatch');
    assert.equal(judgeLayoutApplied(f, { layout: 'standard', orientation: 'landscape' }), 'mismatch');
    /* 属性读不到 ⇒ unknown，不是 same，也不是 mismatch。 */
    assert.equal(judgeLayoutApplied(f, {}), 'unknown');
    assert.equal(judgeLayoutApplied(f, null), 'unknown');
    assert.equal(judgeLayoutApplied(f, { layout: '', orientation: 'portrait' }), 'unknown');
    /* 面没量到 ⇒ unknown。 */
    assert.equal(judgeLayoutApplied(layoutFace({}), { layout: 'standard', orientation: 'portrait' }), 'unknown');
    assert.notEqual(judgeLayoutApplied(f, {}), 'same');
});

/* ---------------- 4. 在盘引擎必须变成消费者 ---------------- */

test('X5-8 引擎不再自带阈值：源码里没有第二套 768/480/360 与 ||375 塌陷', () => {
    const src = read('phone/screen-adaptive-layout-engine.js')
        .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    assert.ok(src.includes("from '../config/layout-breaks.js'"), '引擎必须引同一真源');
    assert.ok(/layoutFace/.test(src), '引擎必须走 layoutFace');
    assert.ok(!/768/.test(src), '引擎里不许再写 768（那是第二份阈值）');
    assert.ok(!/\|\|\s*375/.test(src), '不许再有「读不到就当 375」的塌陷');
    assert.ok(!/\b360\b/.test(src), '引擎里不许再写 360');
});

test('X5-9 引擎的投影与内核逐格一致；无参调用如实报 unreadable（不编数）', () => {
    const engine = new ScreenAdaptiveLayoutEngine();
    for (const [w, h] of [[320, 800], [479, 800], [480, 800], [899, 800], [900, 800], [1440, 900]]) {
        const face = layoutFace({ width: w, height: h });
        const m = engine.calculateAdaptiveMetrics(w, h);
        assert.equal(m.state, FACE_STATES.measured);
        assert.equal(m.tier, face.tier, w + 'x' + h + ' 档位必须与内核一致');
        assert.equal(m.gridColumns, face.homeGridColumns);
        assert.equal(m.dataAttributes['data-layout'], face.tier);
    }
    const none = engine.calculateAdaptiveMetrics();
    assert.equal(none.state, FACE_STATES.unreadable, '无参时必须报 unreadable');
    assert.equal(none.gridColumns, null, '不许编一个默认列数');
    assert.equal(none.formFactor, 'unknown', '不许编 formFactor=phone-portrait');
    assert.deepEqual({ ...none.cssProperties }, {}, '不许编 CSS 变量');
});

/* ---------------- 5. 外壳真接线（不重建 DOM） ---------------- */

test('X5-10 外壳：resize 与 orientationchange 都经 bindGlobal 登记，且只写属性不重建', () => {
    const src = read('phone/phone-shell.js');
    assert.ok(src.includes('bindLayoutFace'), '必须有绑定入口');
    assert.ok(src.includes('applyLayoutFace'), '必须有施加入口');
    assert.ok(/this\.bindGlobal\(window, 'resize'/.test(src), 'resize 必须走可回收的登记层');
    assert.ok(/this\.bindGlobal\(window, 'orientationchange'/.test(src), 'orientationchange 同样要登记');
    assert.ok(/if \(this\._layoutFaceBound\) return;/.test(src), '绑定必须幂等（重复 createInPanel 不叠加）');
    assert.ok(src.includes('this.bindLayoutFace();'), 'createInPanel 里必须真的调它（不是死方法）');
    /* 方法体里不许出现 DOM 重建/擦除动作 —— 那正是「切换丢状态」的根因。 */
    const start = src.indexOf('applyLayoutFace(reason) {');
    assert.ok(start > 0, '找不到 applyLayoutFace 方法体');
    const body = src.slice(start, src.indexOf('\n    }', start));
    assert.ok(body.length > 100, '方法体不该是空的');
    assert.ok(!/innerHTML/.test(body), 'applyLayoutFace 里不许重建 innerHTML');
    assert.ok(!/replaceChildren|removeChild/.test(body), 'applyLayoutFace 里不许摘节点');
    assert.ok(/setAttribute/.test(body), '必须真的写属性');
    /* 半个 document 的宿主（有 createElement 没有 getElementById）在本仓测试里真实存在：
     * 修前这里直接调 getElementById，在那种宿主上抛异常，而它挂在 createInPanel 链首，
     * 一抛就把整个壳的创建打断（system-v4996 就是被这条咬红的）。 */
    assert.ok(/typeof doc\.getElementById === 'function'/.test(body), '取根节点必须先判宿主有没有这个能力');
    assert.ok(/judgeLayoutApplied/.test(body), '写完必须读回对拍（写了 ≠ 生效）');
    assert.ok(/_layoutFace = \{/.test(body), '回执必须挂宿主面供诊断读');
    /* 回收后重建：登记层的监听器已经没了，guard 必须一起复位。
     * 漏掉这一条时的真实现象：destroy → createInPanel 的壳会跳过 bindLayoutFace，
     * 适配变成「静默失效」—— 比报错难查得多。 */
    assert.ok(/this\._layoutFaceBound = false;/.test(src), 'destroy 必须复位 _layoutFaceBound（否则重建后不重登）');
});

/* ---------------- 6. CSS 真按属性排 ---------------- */

test('X5-11 CSS：三档各有一段真规则（列数 3/4/6 + 限宽 560/960 + 横屏段）', () => {
    const css = read('phone.css');
    for (const tier of LAYOUT_TIERS) {
        assert.ok(css.includes('#phone-panel[data-layout="' + tier + '"]'), '缺 ' + tier + ' 档的规则');
    }
    assert.match(css, /\[data-layout="compact"\][\s\S]{0,400}repeat\(3, minmax\(0, 1fr\)\)/, 'compact 应是桌面 3 列');
    assert.match(css, /\[data-layout="wide"\][\s\S]{0,400}repeat\(6, minmax\(0, 1fr\)\)/, 'wide 应是桌面 6 列');
    assert.match(css, /--phone-content-max: 560px/, 'standard 限宽必须来自真值');
    assert.match(css, /--phone-content-max: 960px/, 'wide 限宽必须来自真值');
    assert.match(css, /#phone-panel\[data-orientation="landscape"\]/, '横屏段必须存在');
    /* 负控制：不许把 wide 写成「无断点的 max-width」——限宽必须挂在档位选择器下。 */
    assert.ok(!/^\s*\.phone-in-panel\s*\{[^}]*max-width:\s*960px/m.test(css),
        '限宽不许脱离档位选择器（否则所有档位一起被限宽）');
});

/* ---------------- 7. 诊断页有卡 ---------------- */

test('X5-12 诊断页有布局卡，且真进渲染流程', () => {
    const data = read('apps/diagnose/diagnose-data.js');
    assert.ok(data.includes('layoutFace as layoutFaceOf'), '诊断数据必须走同一真源');
    assert.ok(data.includes('judgeLayoutApplied as judgeLayoutAppliedOf'), '对拍判据也必须来自内核');
    assert.ok(/layout: layoutSc/.test(data), '必须打包进 pkg');
    const view = read('apps/diagnose/diagnose-view.js');
    assert.ok(view.includes('_layoutHtml'));
    assert.ok(/h\.push\([^\n]*_layoutHtml/.test(view), '卡片必须真进渲染流程（不是死方法）');
    assert.ok(view.includes('未知') || view.includes('无法判定'), '读回不明时必须出「无法判定」字样');
});

/* ---------------- 8. 断点只有一处定义 ---------------- */

test('X5-13 断点只有一处定义：全仓不许再出现第二份 compactMax/wideMin', () => {
    const hits = [];
    const walk = (dir) => {
        for (const name of readdirSync(dir)) {
            if (name === 'node_modules' || name === '.git' || name === 'dist') continue;
            const abs = path.join(dir, name);
            const st = statSync(abs);
            if (st.isDirectory()) { walk(abs); continue; }
            if (!/\.(js|mjs|css)$/.test(name)) continue;
            const rel = path.relative(ROOT, abs).split(path.sep).join('/');
            if (rel.startsWith('tests/')) continue;          // 判据自己可以写数字做对照
            const txt = readFileSync(abs, 'utf8');
            if (/compactMax\s*:/.test(txt) || /wideMin\s*:/.test(txt)) hits.push(rel);
        }
    };
    walk(ROOT);
    assert.deepEqual(hits.sort(), ['config/layout-breaks.js'],
        '断点定义只允许出现在 config/layout-breaks.js，实际：' + hits.join('、'));
});
