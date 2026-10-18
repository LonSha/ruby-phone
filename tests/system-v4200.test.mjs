/* ============================================================
 * tests/system-v4200.test.mjs -- [v4.20.0 . 第四期 R4-O8 流程编排用对象选择器]
 *   验收口径(计划原文):不输入任何内部 ID,完成「整理记录→存草稿→提醒」
 *   与「结算→日历」两条流程;已删对象明确要求重新选择;写步骤仍逐项确认。
 *
 * 【修前实测的缺口(读码可复算)】
 *   apps/workflow/workflow-design.js 的参数那一行直接把内部键 toString 给用户看:
 *   wfl-pkey 里是 note / title,条件下拉里是 resume-face / settlement-draft。
 *   用户看到的是机器话,「会替谁做什么」得靠猜 —— 计划点名的就是这个。
 *
 * 判据面(五组):
 *   A 口径:四态互不同形 / 面名表覆盖且不造面 / 登记表只登记真实参数 / 纯函数零副作用
 *   B 行为:中文名 / 认不出即说认不出 / 读不到≠没有 / 表外键要求重选 / 预览人话
 *   C 接线:视图不直出裸键 / 真消费四个口 / 候选下拉真绑定 / 读不到传 null / 预览块真渲染
 *   D 端到端:宿主读数装配 / 点选真写进草稿 / 渲染不露键 / 台账读不到亮态
 *   G 负控制:真源码定点破坏 ⇒ 同款判据必转红(配原版必真的反向对照)
 *   E 版本锚:五源同源
 * ========================================================= */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const OP_REL = 'config/object-picker.js';
const WDD_REL = 'config/workflow-designer.js';
const VIEW_REL = 'apps/workflow/workflow-design.js';
const CSS_REL = 'apps/workflow/workflow.css';
const OP = await import(pathToFileURL(path.join(ROOT, OP_REL)).href);
const WDD = await import(pathToFileURL(path.join(ROOT, WDD_REL)).href);
const VIEW = await import(pathToFileURL(path.join(ROOT, VIEW_REL)).href);
const opSrc = read(OP_REL);
const viewSrc = read(VIEW_REL);
const cssSrc = read(CSS_REL);
const ST = OP.OP_PARAM_STATES;
const ALL_FACES = [];
for (const k of WDD.WD_ACTION_KEYS) {
    for (const f of WDD.WD_ACTIONS[k].in) ALL_FACES.push(f);
}
const OUT_FACES = WDD.WD_ACTION_KEYS.map((k) => WDD.WD_ACTIONS[k].out);

/* ---------- 判据(原版与突变副本上跑同一份) ---------- */
function judgeFaceCoverage(m) {
    return ALL_FACES.every((f) => {
        const l = m.opFaceLabel(f);
        return !!l && l !== f && l.indexOf('认不出') < 0;
    });
}
function judgeNoInventedFace(m) {
    const keys = Object.keys(m.OP_FACES);
    if (!keys.length) return false;
    const known = ALL_FACES.concat(OUT_FACES);
    return keys.every((k) => known.indexOf(k) >= 0);
}
function judgeParamLabels(m) {
    const pairs = [['save-draft', 'note'], ['notify', 'title'], ['add-memo', 'title']];
    return pairs.every((p) => {
        const x = m.opParamMeta(p[0], p[1]);
        return x.known === true && !!x.label && x.label !== p[1];
    });
}
function judgeReadableVsEmpty(m) {
    return m.normalizeOptions(null) === null && Array.isArray(m.normalizeOptions([]));
}
function judgeStatesDistinct(m) {
    const vals = Object.keys(m.OP_PARAM_STATES).map((k) => m.OP_PARAM_STATES[k]);
    return vals.length === 4 && new Set(vals).size === 4 && vals.every((v) => !!v);
}
function judgeViewNoRawKey(s) {
    return s.indexOf('st.paramRows') >= 0 && s.indexOf('st.faceOptions') >= 0 &&
        s.indexOf("esc(st.params[k] || '')") < 0;
}
function judgePickWired(s) {
    /* 判据只押在「选择器生成」与「改变处理器」两处 data-wf-pick 上:
       若押在方法名上,负控制只破坏选择器属性时方法名仍在,判据假绿。 */
    return s.indexOf('data-wf-pick="\'') >= 0 &&
        s.indexOf("on('[data-wf-pick]', 'change'") >= 0 &&
        s.indexOf('pick(index, key, value)') >= 0;
}
function judgePreviewBlock(s) {
    return s.indexOf('previewRows') >= 0 && s.indexOf('previewText') >= 0;
}

/* ---------- 突变副本加载器(data: URL;相对导入换绝对) ---------- */
async function loadMutant(mutate, label) {
    const body0 = mutate(opSrc);
    assert.notEqual(body0, opSrc, '负控制必须真破坏源码(' + label + ')');
    const abs = pathToFileURL(path.join(ROOT, WDD_REL)).href;
    const body = body0.replace("from './workflow-designer.js'", "from '" + abs + "'");
    assert.ok(body.indexOf(abs) >= 0, '相对导入必须换成绝对 URL 才能在 data: 里跑');
    return import('data:text/javascript;base64,' + Buffer.from(body, 'utf8').toString('base64'));
}

/* ================= A 口径 ================= */
test('A1 四种参数态互不同形(不许压平成一个「未填」)', () => {
    assert.ok(judgeStatesDistinct(OP));
});

test('A2 面名表覆盖 WD_ACTIONS 的每一个输入面(续玩读数 / 继续摘要都有人话)', () => {
    assert.ok(ALL_FACES.length >= 4);
    assert.ok(judgeFaceCoverage(OP));
});

test('A3 面名表不许造面:每个键都是有效作表里真用过的 in / out', () => {
    assert.ok(judgeNoInventedFace(OP));
});

test('A4 参数登记表只登记真存在的动作与它声明的参数键', () => {
    const keys = Object.keys(OP.OP_PARAMS);
    assert.ok(keys.length >= 3);
    for (const full of keys) {
        const p = full.split(':');
        const act = WDD.WD_ACTIONS[p[0]];
        assert.ok(act, '登记了一个不存在的动作:' + p[0]);
        assert.ok(act.params.indexOf(p[1]) >= 0, '登记了这个动作没声明的参数:' + full);
        assert.ok(!!OP.OP_PARAMS[full].label);
    }
});

test('A5 纯函数零副作用:源码里没有 DOM / storage / 时钟', () => {
    const bad = ['localStorage', 'sessionStorage', 'document.', 'window.', 'Date.now', 'new Date', 'setTimeout'];
    for (const b of bad) assert.equal(opSrc.indexOf(b), -1, '纯内核里出现了 ' + b);
});

/* ================= B 行为 ================= */
test('B1 三处参数都有中文名,不再是裸键', () => {
    assert.equal(OP.opParamMeta('save-draft', 'note').label, '草稿备注');
    assert.equal(OP.opParamMeta('notify', 'title').label, '提醒标题');
    assert.equal(OP.opParamMeta('add-memo', 'title').label, '备忘标题');
    assert.ok(judgeParamLabels(OP));
});

test('B2 认不出的东西如实说认不出(不猜一个很像的名字)', () => {
    const x = OP.opParamMeta('notify', 'zzz');
    assert.equal(x.known, false);
    assert.ok(x.label.indexOf(OP.OP_UNKNOWN_LABEL) >= 0);
    assert.ok(OP.opFaceLabel('zzz-face').indexOf('认不出') >= 0);
    assert.equal(OP.opFaceLabel(''), '未指定');
});

test('B3 候选:读不到与一个都没有不同形', () => {
    assert.ok(judgeReadableVsEmpty(OP));
});

test('B4 候选归一:去重去空 + 裸值补标签 + 超长截断', () => {
    const o = OP.normalizeOptions(['a', '', 'a', { value: 'b', label: 'B 项' }, 'x'.repeat(200)]);
    assert.equal(o.length, 3);
    assert.equal(o[0].label, 'a');
    assert.equal(o[1].label, 'B 项');
    assert.equal(o[2].value.length, OP.OP_TEXT_MAX);
    assert.equal(OP.opFaceOptions(null).readable, false);
    assert.equal(OP.opFaceOptions([]).readable, true);
});

test('B5 已填与可留空两态分开', () => {
    const a = OP.stepParamsOf({ action: 'notify', params: { title: '周结算' } }, null, { templates: [] });
    assert.equal(a.rows[0].state, ST.filled);
    assert.ok(a.rows[0].line.indexOf('周结算') >= 0);
    const b = OP.stepParamsOf({ action: 'notify', params: {} }, null, { templates: [] });
    assert.equal(b.rows[0].state, ST.empty);
    assert.notEqual(a.rows[0].line, b.rows[0].line);
});

test('B6 候选读不到 ⇒ candidates-missing;候选是空数组 ⇒ 不算缺(读不到不等于没有)', () => {
    const miss = OP.stepParamsOf({ action: 'notify', params: {} }, null, { templates: null });
    const none = OP.stepParamsOf({ action: 'notify', params: {} }, null, { templates: [] });
    assert.equal(miss.rows[0].state, ST.candidatesMissing);
    assert.equal(none.rows[0].state, ST.empty);
    assert.equal(miss.missing.length, 1);
    assert.equal(none.missing.length, 0);
    assert.ok(miss.rows[0].line.indexOf('读不到') >= 0);
});

test('B7 表外键 ⇒ 明说要求重新选择;空值的表外键不生成垃圾行', () => {
    const r = OP.stepParamsOf({ action: 'save-draft', params: { note: '记账', ghost: '旧对象' } }, null, {});
    const ghost = r.rows.filter((x) => x.key === 'ghost')[0];
    assert.ok(ghost);
    assert.equal(ghost.state, ST.unknownKey);
    assert.ok(ghost.line.indexOf('重新选择') >= 0);
    const r2 = OP.stepParamsOf({ action: 'save-draft', params: { ghost: '' } }, null, {});
    assert.equal(r2.rows.length, 1);
    assert.equal(r2.missing.length, 0);
});

test('B8 四态的人话互不相同(状态词表不许两处同文)', () => {
    const lines = [ST.filled, ST.empty, ST.candidatesMissing, ST.unknownKey].map((s) => OP.paramStateLine({ key: 'title', label: '提醒标题', value: s === ST.filled ? 'v' : '', state: s }));
    assert.equal(new Set(lines).size, 4);
});

test('B9 预览:写步计数 / 条件中文 / 认不出的动作如实说', () => {
    const pv = OP.flowPreviewOf({ steps: [
        { action: 'read-brief' },
        { action: 'save-draft', params: { note: '记账' }, when: { face: 'brief', state: 'present' } },
        { action: 'nope' },
    ] }, { templates: [] });
    assert.equal(pv.rows.length, 3);
    assert.equal(pv.writes, 1);
    assert.ok(pv.rows[1].sentence.indexOf('续玩摘要') >= 0);
    assert.ok(pv.rows[1].sentence.indexOf('在场时跑') >= 0);
    assert.ok(pv.rows[1].sentence.indexOf('草稿备注') >= 0);
    assert.ok(pv.rows[2].sentence.indexOf('认不出') >= 0);
    assert.ok(pv.text.indexOf('写动作 1 步') >= 0);
});

test('B10 空草稿是「没得预览」而不是「读不到」', () => {
    const pv = OP.flowPreviewOf({ steps: [] }, {});
    assert.equal(pv.readable, true);
    assert.equal(pv.rows.length, 0);
    assert.ok(pv.text.indexOf('没得预览') >= 0);
    const bad = OP.flowPreviewOf({ steps: 'x' }, {});
    assert.equal(bad.readable, false);
});

/* ================= C 接线 ================= */
test('C1 视图不再直出裸键名(参数走 paramRows / 面走 faceOptions)', () => {
    assert.ok(judgeViewNoRawKey(viewSrc));
    assert.equal(viewSrc.indexOf("<span class=\"wfl-pkey\">' + esc(k) + '</span>"), -1);
});

test('C2 视图真消费选择器四个口(导出不是挂名)', () => {
    for (const name of ['stepParamsOf', 'opFaceOptions', 'flowPreviewOf', 'OP_PARAM_STATES']) {
        assert.ok(viewSrc.indexOf(name) >= 0, '视图没用到 ' + name);
    }
});

test('C3 候选下拉真绑定:选择器 + 处理器 + design.pick 三件齐全', () => {
    assert.ok(judgePickWired(viewSrc));
    assert.ok(cssSrc.indexOf('.wfl-prow') >= 0, '参数行样式未落');
    assert.ok(cssSrc.indexOf('.wfl-pstate-bad') >= 0, '重选提示的样式未落');
});

test('C4 候选读不到时传 null,不是补一个空数组冒充没有', () => {
    assert.ok(viewSrc.indexOf('(tpl.readable === false) ? null') >= 0);
});

test('C5 预览块真渲染', () => {
    assert.ok(judgePreviewBlock(viewSrc));
});

/* ================= D 端到端(宿主读数 → 草稿 → 渲染) ================= */
function fakeHost(over) {
    return Object.assign({
        scope: { chatId: 'c', branchKey: 'main' }, token: 't1',
        actionFaces: WDD.WD_ACTION_KEYS.map((k) => ({ key: k, label: WDD.WD_ACTIONS[k].label, hint: WDD.WD_ACTIONS[k].hint, writes: WDD.WD_ACTIONS[k].writes, params: WDD.WD_ACTIONS[k].params.slice() })),
        limits: WDD.WD_LIMITS,
        templates: { readable: true, templates: [{ id: 'wd_t_1', name: '周结算', steps: [] }], dropped: 0 },
        designs: [],
    }, over || {});
}
function withHost(h) {
    globalThis.window = { VirtualPhone: { workflowDesignFace: () => h } };
}
function dropHost() { delete globalThis.window; }

test('D1 装配:参数行给中文名与候选,条件给中文名', () => {
    withHost(fakeHost());
    try {
        const d = new VIEW.WorkflowDesign({ render() {} });
        assert.equal(d.add('notify'), true);
        const vm = d.vm();
        const row = vm.draftSteps[0].paramRows[0];
        assert.equal(row.label, '提醒标题');
        assert.equal(row.value, '');
        assert.deepEqual(row.options.map((o) => o.value).slice(0, 1), ['周结算']);
        assert.equal(vm.draftSteps[0].faceOptions[0].label, '续玩摘要');
        assert.ok(vm.previewText.indexOf('会替本项目做 1 步') >= 0);
        assert.ok(vm.draftSteps[0].previewText.indexOf('发提醒') >= 0);
    } finally { dropHost(); }
});

test('D2 点选候选真的写进草稿参数(走同一个绑定口)', () => {
    withHost(fakeHost());
    try {
        const d = new VIEW.WorkflowDesign({ render() {} });
        d.add('save-draft');
        assert.equal(d.pick(0, 'note', '周结算核对'), true);
        assert.equal(d.draft().steps[0].params.note, '周结算核对');
        assert.equal(d.pick(0, 'ghost', 'x'), false, '表外键居然绑上了');
        assert.equal(d.draft().steps[0].params.ghost, undefined);
    } finally { dropHost(); }
});

test('D3 渲染出来的参数行不露裸键名,且点选框在位', () => {
    withHost(fakeHost());
    try {
        const d = new VIEW.WorkflowDesign({ render() {} });
        d.add('add-memo');
        d.pick(0, 'title', '周结算');
        const h = VIEW.designHtml(d.vm());
        assert.ok(h.indexOf('备忘标题') >= 0);
        assert.ok(h.indexOf('data-wf-pick="0:title"') >= 0);
        assert.equal(h.indexOf('wfl-pkey">title<'), -1);
        assert.ok(h.indexOf('已填:「周结算」') >= 0);
    } finally { dropHost(); }
});

test('D4 模板台账读不到时亮「候选读不到」而不是「一个都没有」', () => {
    withHost(fakeHost({ templates: { readable: false, templates: [], dropped: 0 } }));
    try {
        const d = new VIEW.WorkflowDesign({ render() {} });
        d.add('notify');
        const vm = d.vm();
        assert.equal(vm.draftSteps[0].paramRows[0].state, ST.candidatesMissing);
        assert.equal(vm.draftSteps[0].paramRows[0].options.length, 0);
        assert.ok(vm.draftSteps[0].paramRows[0].line.indexOf('读不到') >= 0);
    } finally { dropHost(); }
});

/* ================= G 负控制(同一判据在突变副本上必转红) ================= */
test('G0 反向对照:原版上四条判据必真(否则后面转红不算证据)', () => {
    assert.ok(judgeFaceCoverage(OP));
    assert.ok(judgeReadableVsEmpty(OP));
    assert.ok(judgeViewNoRawKey(viewSrc));
    assert.ok(judgePickWired(viewSrc));
});

test('G1 负控制:把面名表破坏掉 ⇒ 覆盖判据必转红', async () => {
    const m = await loadMutant((s) => s.replace("'resume-face': '", "'resume-face-typo': '"), 'face-table');
    assert.equal(judgeFaceCoverage(m), false);
});

test('G2 负控制:把「读不到」写成空数组 ⇒ 读不到/没有判据必转红', async () => {
    const m = await loadMutant((s) => s.replace('    if (!list) return null;', '    if (!list) return [];'), 'options-null');
    assert.equal(judgeReadableVsEmpty(m), false);
    const r = m.stepParamsOf({ action: 'notify', params: {} }, null, { templates: null });
    assert.equal(r.rows[0].state, ST.empty, '突变后「读不到」竟被当成「没有」,原版判据本应拦住');
});

test('G3 负控制:把中文名表改成裸键回显 ⇒ 参数名判据必转红', async () => {
    const m = await loadMutant((s) => s.replace("label: '提醒标题'", 'label: \'title\''), 'param-label');
    assert.equal(judgeParamLabels(m), false);
});

test('G4 负控制:把视图里的候选下拉删掉 ⇒ 接线判据必转红', () => {
    const broken = viewSrc.split('data-wf-pick').join('data-wf-pick-gone');
    assert.notEqual(broken, viewSrc);
    assert.equal(judgePickWired(broken), false);
});

/* ================= E 版本锚 ================= */
test('E1 五源同源', () => {
    const pkg = JSON.parse(read('package.json'));
    const man = JSON.parse(read('manifest.json'));
    const log = JSON.parse(read('update-log.json'));
    const ver = pkg.version;
    assert.match(ver, /^\d+\.\d+\.\d+$/);
    assert.equal(man.version, ver);
    assert.equal(log.latest, ver);
    assert.equal(log.head, ver);
    assert.ok(log.versions[ver], '当版条目必须存在');
    assert.ok(Array.isArray(log.versions[ver].items) && log.versions[ver].items.length >= 8);
    assert.ok(read('index.js').indexOf("const ST_PHONE_VERSION = '" + ver + "';") >= 0);
});
