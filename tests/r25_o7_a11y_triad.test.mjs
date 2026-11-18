/**
 * r25_o7_a11y_triad.test.mjs — R25-O7 无障碍三档（字号 / 减弱动效 / 高对比）
 *
 * 【咬点】
 *   1. 三轴载体（CSS 变量 / 类名）与默认值必须来自 `touch-readability-baseline.js`
 *      —— 抄一份常量就是「改一处忘一处」（R26-O5 要清的东西）；
 *   2. `unreadable`（读不到）与 `absent`（从没设置）**不同形**，都不许报成「默认档」；
 *   3. 非法值要**点名**且回退默认，不许被 `Boolean('no') === true` 吞掉；
 *   4. 应用后必须**读回对拍**：写了不等于生效，被样式覆盖要落 `mismatch`（不是 applied）；
 *   5. 装配点自检：启动真的 apply、设置页真的能改、诊断页真的渲染这张卡。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    A11Y_AXES, A11Y_TRIAD_STATES, acceptsAxisValue,
    readA11yTriad, applyA11yTriad, a11yTriadFace, a11yTriadText
} from '../config/a11y-triad.js';
import {
    STORAGE_KEY, DEFAULT_READABILITY_SETTINGS, generateReadabilityStyle
} from '../config/touch-readability-baseline.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

/** 造一个够用的假 document（style + classList 都真记账，才能读回对拍）。 */
function fakeDoc() {
    const vars = new Map();
    const classes = new Set();
    const style = {
        setProperty: (k, v) => { vars.set(String(k), String(v)); },
        getPropertyValue: (k) => (vars.has(String(k)) ? vars.get(String(k)) : '')
    };
    const classList = {
        add: (c) => { classes.add(c); },
        remove: (c) => { classes.delete(c); },
        contains: (c) => classes.has(c)
    };
    return { documentElement: { style, classList }, _vars: vars, _classes: classes };
}

/** 造一个只读 storage。`value` 为 undefined 表示键不存在。 */
function fakeStorage(value, opts) {
    return {
        get: (k) => {
            if (opts && opts.throwing) throw new Error('boom');
            return k === STORAGE_KEY ? value : undefined;
        }
    };
}

test('O7-1 三轴载体与默认值都来自 baseline（不许抄第二份）', () => {
    assert.deepEqual(A11Y_AXES.map((a) => a.id), ['font', 'motion', 'contrast']);
    const style = generateReadabilityStyle(DEFAULT_READABILITY_SETTINGS);
    /* 字号轴写的变量名必须真在 baseline 产出的变量里，否则就是「写到没人读的键上」。 */
    const fontAxis = A11Y_AXES.find((a) => a.id === 'font');
    assert.ok(Object.prototype.hasOwnProperty.call(style.cssVars, fontAxis.cssVar));
    /* 两轴的类名必须真在 baseline 的 classList 契约里。 */
    const expectedClasses = ['reduced-motion', 'high-contrast'];
    for (const c of expectedClasses) {
        assert.ok(A11Y_AXES.some((a) => a.kind === 'class' && a.className === c));
    }
    /* 三轴字段名必须在默认值对象里存在（键名漂了就读不到真源）。 */
    for (const a of A11Y_AXES) assert.ok(a.field in DEFAULT_READABILITY_SETTINGS, a.field);
});

test('O7-2 读不到存储 → unreadable，且与 absent 文案不同形', () => {
    const t = readA11yTriad(null);
    assert.equal(t.state, A11Y_TRIAD_STATES.unreadable);
    assert.equal(t.reason, 'no-storage');
    const doc = fakeDoc();
    const faceBad = a11yTriadFace(doc, null);
    assert.equal(faceBad.state, 'unreadable');
    const textBad = a11yTriadText(faceBad);

    const faceAbsent = a11yTriadFace(doc, fakeStorage(null));
    const textAbsent = a11yTriadText(faceAbsent);
    assert.notEqual(textBad, textAbsent);
    assert.ok(textBad.includes('未知'), '读不到必须明说「未知」而不是报成默认档');
    assert.ok(!textAbsent.includes('未知'), '从没设置过不该说「未知」');
});

test('O7-3 从没设置过 → absent，profile 就是真源默认值', () => {
    const t = readA11yTriad(fakeStorage(undefined));
    assert.equal(t.state, 'absent');
    assert.deepEqual(t.rejected, []);
    for (const a of A11Y_AXES) {
        assert.equal(t.profile[a.field], DEFAULT_READABILITY_SETTINGS[a.field]);
    }
});

test('O7-4 storage.get 抛错 → unreadable（不得冒充满意）', () => {
    const t = readA11yTriad(fakeStorage(null, { throwing: true }));
    assert.equal(t.state, 'unreadable');
    assert.equal(t.reason, 'read-threw');
});

test("O7-5 非法布尔值 'no' 被点名拒收，不许塌成「已开启」", () => {
    assert.equal(acceptsAxisValue('reducedMotion', 'no'), false);
    const t = readA11yTriad(fakeStorage({ reducedMotion: 'no' }));
    assert.equal(t.state, 'invalid');
    assert.deepEqual(t.rejected, ['reducedMotion']);
    assert.equal(t.profile.reducedMotion, false, "Boolean('no') 会是 true —— 那是塌陷");
});

test('O7-6 字号越界被夹到真源区间（1.9→1.3，0.5→0.85）', () => {
    const hi = readA11yTriad(fakeStorage({ fontScale: 1.9 }));
    assert.equal(hi.state, 'stored');
    assert.equal(hi.profile.fontScale, 1.3);
    const lo = readA11yTriad(fakeStorage({ fontScale: 0.5 }));
    assert.equal(lo.profile.fontScale, 0.85);
});

test('O7-7 字符串化 JSON 也能读（storage 真有这个历史行为）', () => {
    const t = readA11yTriad(fakeStorage(JSON.stringify({ fontScale: 1.2, highContrast: true })));
    assert.equal(t.state, 'stored');
    assert.equal(t.profile.fontScale, 1.2);
    assert.equal(t.profile.highContrast, true);
    const bad = readA11yTriad(fakeStorage('{not json'));
    assert.equal(bad.state, 'invalid');
    assert.deepEqual(bad.rejected, ['*']);
});

test('O7-8 apply 真写载体，回执逐键可查', () => {
    const doc = fakeDoc();
    const profile = readA11yTriad(fakeStorage({ fontScale: 1.2, reducedMotion: true, highContrast: true })).profile;
    const r = applyA11yTriad(doc, profile);
    assert.equal(r.applied, true);
    assert.equal(doc._vars.get('--phone-font-scale'), '1.2');
    assert.ok(doc._classes.has('reduced-motion'));
    assert.ok(doc._classes.has('high-contrast'));
    assert.ok(Object.keys(r.vars).length >= 3);
});

test('O7-9 apply 幂等：连写两次类不会越加越多', () => {
    const doc = fakeDoc();
    const profile = readA11yTriad(fakeStorage({ reducedMotion: true })).profile;
    applyA11yTriad(doc, profile);
    const first = [...doc._classes].sort();
    applyA11yTriad(doc, profile);
    assert.deepEqual([...doc._classes].sort(), first);
    assert.equal(first.filter((c) => c === 'reduced-motion').length, 1);
});

test('O7-10 无 document → applied:false（不假装成功）', () => {
    const profile = readA11yTriad(fakeStorage({ fontScale: 1.1 })).profile;
    const r = applyA11yTriad(null, profile);
    assert.equal(r.applied, false);
    assert.equal(r.reason, 'no-document');
    const face = a11yTriadFace(null, fakeStorage({ fontScale: 1.1 }));
    assert.notEqual(face.state, 'applied', '没有 document 不许判成 applied');
    assert.ok(face.rows.every((x) => x.status === 'unknown'));
});

test('O7-11 写后对拍：三轴全 applied', () => {
    const doc = fakeDoc();
    const store = fakeStorage({ fontScale: 1.15, reducedMotion: false, highContrast: true });
    applyA11yTriad(doc, readA11yTriad(store).profile);
    const face = a11yTriadFace(doc, store);
    assert.equal(face.state, 'applied');
    assert.equal(face.appliedCount, 3);
    assert.ok(face.rows.every((r) => r.status === 'applied'));
    assert.ok(a11yTriadText(face).includes('读回一致'));
});

test('O7-12 被覆盖的轴落 mismatch（写了 ≠ 生效）', () => {
    const doc = fakeDoc();
    const store = fakeStorage({ fontScale: 1.2, highContrast: true });
    applyA11yTriad(doc, readA11yTriad(store).profile);
    /* 模拟另一张样式表把字号变量顶掉。 */
    doc.documentElement.style.setProperty('--phone-font-scale', '1');
    const face = a11yTriadFace(doc, store);
    const font = face.rows.find((r) => r.id === 'font');
    assert.equal(font.status, 'mismatch');
    assert.equal(face.state, 'partial');
    assert.ok(!a11yTriadText(face).includes('三轴均已写入'));
});

test('O7-13 三轴档位值域互不相同（文案不塌）', () => {
    const doc = fakeDoc();
    const store = fakeStorage({ fontScale: 1.2, reducedMotion: true, highContrast: false });
    applyA11yTriad(doc, readA11yTriad(store).profile);
    const face = a11yTriadFace(doc, store);
    const bands = face.rows.map((r) => r.band);
    assert.equal(new Set(bands).size, bands.length, '三轴 band 用词不得重样');
    assert.deepEqual(bands, ['large', 'reduced', 'normal']);
});

test('O7-14 装配点自检：启动 apply / 设置页可改 / 诊断页有卡', () => {
    const index = read('index.js');
    assert.ok(index.includes('readA11yTriad'), '启动时必须读真源');
    assert.ok(index.includes('applyA11yTriad'), '启动时必须写到 document');
    assert.ok(index.includes('_a11yTriad'), '读数要挂到 VirtualPhone 供诊断取');
    const settings = read('apps/settings/settings-app.js');
    assert.ok(settings.includes('renderA11yTriadSection'), '设置页必须有这一节');
    assert.ok(settings.includes('a11y-triad.js'), '设置页必须走同一内核（不许自己拼变量）');
    const data = read('apps/diagnose/diagnose-data.js');
    assert.ok(data.includes('a11yTriadFace'), '诊断数据必须有这一面');
    const view = read('apps/diagnose/diagnose-view.js');
    assert.ok(view.includes('_a11yTriadHtml'), '诊断视图必须有这张卡');
    assert.ok(/h\.push\([^\n]*_a11yTriadHtml/.test(view), '卡片必须真进渲染流程（不是死方法）');
});
