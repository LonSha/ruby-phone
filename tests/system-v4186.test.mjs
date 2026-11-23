// SYS-V4186 智能家居中枢（重构验收）
// 为什么单独立一条：本件是从 40 行内核重构来的，源里三块「本仓不能有」的东西
//   （实例字段当状态 / 自己产叙事与 prompt 指令 / 把叙事口味写进设备描述）必须在代码面上钉住，
//   否则下一次有人「顺手补一句气氛」就把重构的方向改回去了。
// 实现纪律：本档不用正则，一律 indexOf（生成链会把反斜杠吃掉，与 r25_o3 / r27_o1 同一条）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const NL = String.fromCharCode(10);
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const D = await import('../apps/iot/iot-data.js');

/* 叙事词表：这些词只能出现在生成侧，不该出现在 App 的注入面里。 */
const NARRATIVE_WORDS = ['暖黄', '微光', '意境', '私密', '悄然', '微风', '纱帘', '极致安宁', '气氛', '氛围感'];
function narrationHits(text) {
    const hits = [];
    for (const w of NARRATIVE_WORDS) if (String(text).indexOf(w) >= 0) hits.push(w);
    return hits;
}

/* ══════════ A 内核 ══════════ */
test('A1 越界读数被夹取且如实记账（不静默归零）', () => {
    const r = D.setDeviceProp(D.defaultIotState(), 'lamp', 'brightness', 150);
    assert.equal(r.ok, true);
    assert.equal(r.state.devices.lamp.brightness, 100, '夹到上限 100');
    assert.ok(r.notes.length >= 1, '夹取必须记账（notes 非空）');
    const low = D.setDeviceProp(D.defaultIotState(), 'ac', 'setPointC', 5);
    assert.equal(low.state.devices.ac.setPointC, 16, '夹到下限 16');
});

test('A2 认不出的值拒答，不当默认值用', () => {
    const a = D.setDeviceProp(D.defaultIotState(), 'lamp', 'brightness', '亮一点');
    assert.equal(a.ok, false);
    assert.equal(a.reason, 'not_number');
    const b = D.setDeviceProp(D.defaultIotState(), 'tv', 'power', true);
    assert.equal(b.reason, 'unknown_device');
    const c = D.setDeviceProp(D.defaultIotState(), 'lamp', 'volume', 3);
    assert.equal(c.reason, 'unknown_key');
    const d = D.setDeviceProp(D.defaultIotState(), 'ac', 'mode', 'turbo');
    assert.equal(d.reason, 'unknown_mode');
    const e = D.setDeviceProp(D.defaultIotState(), 'lamp', 'power', 'yes');
    assert.equal(e.reason, 'not_boolean');
});

test('A3 场景是真改状态（不是只改一个名字）', () => {
    const r = D.applyScene(D.defaultIotState(), 'cozy_night');
    assert.equal(r.ok, true);
    assert.equal(r.state.scene, 'cozy_night');
    assert.equal(r.state.devices.lamp.colorTempK, 2400);
    assert.equal(r.state.devices.lamp.brightness, 35);
    assert.equal(r.state.devices.blind.closedPercent, 100);
    assert.ok(r.changes.length >= 3, '实际改动清单要报出来');
    const bad = D.applyScene(D.defaultIotState(), 'party');
    assert.equal(bad.ok, false);
    assert.equal(bad.state.scene, D.defaultIotState().scene, '认不出的场景不许动状态');
});

test('A4 纯函数：不改入参', () => {
    const s0 = D.defaultIotState();
    const snapshot = JSON.stringify(s0);
    D.applyScene(s0, 'focus');
    D.setDeviceProp(s0, 'lamp', 'brightness', 10);
    assert.equal(JSON.stringify(s0), snapshot, '调用后入参必须原样');
});

test('A5 归一三态：不是对象就拒判，好数据原样，坏格子记账', () => {
    assert.equal(D.normalizeIotState(null).ok, false);
    assert.equal(D.normalizeIotState('x').ok, false);
    const good = D.defaultIotState();
    assert.equal(D.normalizeIotState(good).ok, true);
    assert.equal(D.normalizeIotState(good).notes.length, 0);
    const bad = { scene: 'ghost', devices: { lamp: { brightness: 999 }, ac: { mode: '??? ' } } };
    const r = D.normalizeIotState(bad);
    assert.equal(r.ok, true);
    assert.equal(r.state.devices.lamp.brightness, 100, '越界被夹');
    assert.ok(r.notes.length >= 2, '越界与认不出都要记账');
});

test('A6 三态面：读不出不等于没设过', () => {
    assert.equal(D.readIotFace(null, false), D.IOT_FACE.storage_absent);
    assert.equal(D.readIotFace(null, true), D.IOT_FACE.empty);
    assert.equal(D.readIotFace(D.defaultIotState(), true), D.IOT_FACE.ready);
});

/* ══════════ B 注入面（本件最关键的一条） ══════════ */
test('B1 注入只给事实，一个叙事词都不许有', () => {
    const text = D.iotPromptBlock(D.applyScene(D.defaultIotState(), 'cozy_night').state);
    assert.ok(text.length > 0);
    assert.deepEqual(narrationHits(text), [], '注入面出现叙事词：' + narrationHits(text).join(','));
    assert.ok(text.indexOf('2400') >= 0, '事实读数必须在');
});

test('B2 注入里三件设备各占一行（可逐条对账）', () => {
    const text = D.iotPromptBlock(D.defaultIotState());
    const lines = text.split(NL).filter((l) => l.indexOf('- ') === 0);
    assert.equal(lines.length, 3, '三件设备三行，实测 ' + lines.length);
});

test('B3 投影与注入同源（同一套读数，不许各说一套）', () => {
    const s = D.defaultIotState();
    const proj = D.projectIot(s);
    const text = D.iotPromptBlock(s);
    for (const row of proj.rows) assert.ok(text.indexOf(row.text) >= 0, '注入缺投影行：' + row.text);
});

/* ══════════ C 负控制（判据不是自己跟自己比） ══════════ */
function variant(patch, tag) {
    const src = read('apps/iot/iot-data.js');
    const out = patch(src);
    assert.notEqual(out, src, '破坏锚点必须真打中：' + tag);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rp_v4186_'));
    const p = path.join(dir, 'iot-data.mjs');
    fs.writeFileSync(p, out);
    return p;
}

test('C1 去掉夹取 ⇒ A1 同款判据必须转红', async () => {
    const p = variant((s) => s.replace(
        '    if (n < lo) { notes.push(label + ' + String.fromCharCode(39) + ' 低于下限 ' + String.fromCharCode(39) + ' + lo + ' + String.fromCharCode(39) + '（实测 ' + String.fromCharCode(39) + ' + n + ' + String.fromCharCode(39) + '）' + String.fromCharCode(39) + '); return lo; }',
        '    if (n < lo) { return n; }'), 'clamp-low');
    const M = await import('file://' + p);
    const r = M.setDeviceProp(M.defaultIotState(), 'ac', 'setPointC', 5);
    assert.notEqual(r.state.devices.ac.setPointC, 16, '夹取被去掉了，读数却还是 16 ⇒ A1 没在测真东西');
});

test('C2 往注入面掺一句叙事 ⇒ B1 同款判据必须转红', async () => {
    const p = variant((s) => s.replace('    return lines.join(String.fromCharCode(10));',
        '    lines.push(' + String.fromCharCode(39) + '室内一片暖黄微光。' + String.fromCharCode(39) + ');' + NL + '    return lines.join(String.fromCharCode(10));'), 'narration');
    const M = await import('file://' + p);
    const text = M.iotPromptBlock(M.defaultIotState());
    assert.ok(narrationHits(text).length > 0, '掺了叙事却没被抓到 ⇒ B1 是假判据');
});

test('C3 叙事词表自证：正常读数一个都不命中', () => {
    assert.deepEqual(narrationHits(D.iotPromptBlock(D.defaultIotState())), []);
    assert.ok(narrationHits('室内一片暖黄微光').length >= 2, '词表必须真能命中');
});

/* ══════════ E 接线 ══════════ */
test('E1 五处接线齐备（图标 / 路由 / 会话前缀 / 键登记 / 重绑表）', () => {
    assert.ok(read('config/apps.js').indexOf("id: 'iot'") >= 0, 'apps.js 未登记');
    assert.ok(read('config/app-lazy-routes.js').indexOf("id: \"iot\"") >= 0 || read('config/app-lazy-routes.js').indexOf("id: 'iot'") >= 0, '路由未登记');
    assert.ok(read('config/storage.js').indexOf('/^iot_/') >= 0, '会话前缀未登记');
    assert.ok(read('scripts/keys-audit.mjs').indexOf("'iot_state'") >= 0, '键未登记归属');
    assert.ok(read('index.js').indexOf("'iotApp'") >= 0, '未进重绑表（换会话会串味）');
});

test('E2 控制器走唯一回执实现，且零定时器零网络', () => {
    const s = read('apps/iot/iot-app.js');
    assert.ok(s.indexOf('writeReceipt') >= 0, '写回执必须走唯一实现');
    assert.equal(s.indexOf('setInterval') < 0, true);
    assert.equal(s.indexOf('setTimeout') < 0, true);
    assert.equal(s.indexOf('fetch(') < 0, true);
});

test('E3 视图：根容器按节点身份去重 + 不动输入控件', () => {
    const s = read('apps/iot/iot-view.js');
    assert.ok(s.indexOf('this._boundRoot === root') >= 0, '缺 _boundRoot 去重');
    assert.equal(s.indexOf("addEventListener('input'") < 0, true, '本件不应用 input 监听');
    assert.ok(s.indexOf('iot.css') >= 0, '样式必须自注入（否则界面裸奔且不报错）');
});

/* ══════════ V 版本锚 ══════════ */
test('V1 版本锚（下限形）', () => {
    const pkg = JSON.parse(read('package.json'));
    const man = JSON.parse(read('manifest.json'));
    assert.equal(pkg.version, man.version);
    assert.ok(Number(pkg.version.split('.')[1]) >= 186, '本套件自 4.186.0 起成立，实测 ' + pkg.version);
});
