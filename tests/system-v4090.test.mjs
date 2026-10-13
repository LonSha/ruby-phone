/* ========================================================
 * tests/system-v4090.test.mjs -- [v4.09.0 · 第三期 C 包手机侧第二项 R3-X3]
 *   约会与日程的可玩执行流程(五步台面 / 到场等人证 / 回档即作废 / 用剧情时钟)
 *
 * 【计划原文 R3-X3】
 *   「把一条约定扩为准备→出发→到场→互动→结束的可选步骤;可邀请角色、关联地点
 *    与待办,结束生成回顾草稿;使用剧情时钟而非现实闹钟。」
 *   验收四条:用户能从聊天邀请推进一次约会;改期同步待办;
 *   没有正文/用户确认不自动判到场或履约;回档后未来步骤不继续触发。
 *
 * 【修前实测的缺口(不是推演)】
 *   commitment-flow.js 已有五态与事件键幂等,schedule-bridge 与行动中心已有提醒,
 *   但「一条约定」在用户侧仍只是一个**状态**:没有准备/出发/到场/互动/结束这五步,
 *   没有邀请/地点/待办三个挂点,结束之后没有回顾草稿,改期不同步待办,
 *   而**没有任何一处拦住「自动到场」** —— 约定一到日期任何一侧都可以自行把它
 *   当成发生了,而正文里那场约会根本没写。
 *
 * 判据面(五组):
 *   A 结构与口径:五步五态八字归因 / 上限冻结 / 自检零问题 / 零依赖边界
 *   B 行为:到场等人证 / 没互动不给回顾 / 回档即作废 / 改期同步待办 /
 *           邀请读数 / 未确认不推进 / 终态不推进 / 楼层读不到不当证据
 *   C 接线:数据层真读本层账与剧情楼层 / 生成侧可调用 / 诊断面真取数
 *   D 负控制:真源码定点破坏三条口径 ⇒ 对应判据必转红(且破坏可观测改变行为)
 *   E 版本锚:下限形
 *
 * 【为什么断言用 includes 而非正则】本套件锚点里全是括号与星号,
 *   正则转义层数一多「判据自身」会静默失效(本仓已有前例:星号转义退化成
 *   「反斜杠重复零次」而侥幸通过 = 假绿)。
 * ========================================================= */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const CORE = 'config/date-playbook.js';
const APP = 'apps/calendar/calendar-app.js';
const DGD = 'apps/diagnose/diagnose-data.js';
const DGV = 'apps/diagnose/diagnose-view.js';

const core = read(CORE);
const mod = await import(pathToFileURL(path.join(ROOT, CORE)).href);

/** 去注释后扫代码(逐字符扫描,不用正则)。 */
const strip = (s) => {
    const src = String(s);
    let out = '';
    let i = 0;
    while (i < src.length) {
        const ch = src[i];
        const nx = src[i + 1];
        if (ch === '/' && nx === '*') {
            i += 2;
            while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i++;
            i += 2; out += ' '; continue;
        }
        if (ch === '/' && nx === '/') {
            i += 2;
            while (i < src.length && src[i] !== '\n') i++;
            out += ' '; continue;
        }
        out += ch; i++;
    }
    return out;
};

const C = (extra = {}) => Object.assign({
    id: 'apt_1', actor: '我', with: 'B', content: '看电影',
    status: 'confirmed', dateKey: '2026-01-01', time: '19:00', place: 'P'
}, extra);

/* ---------- A 结构与口径 ---------- */
test('A1 自检零问题 + 出口齐备', () => {
    const r = mod.datePlaybookSelfCheck();
    assert.equal(r.problems.length, 0, JSON.stringify(r.problems));
    for (const fn of ['buildDatePlaybook', 'advanceStep', 'datePlaybookLine', 'datePlaybookSelfCheck']) {
        assert.equal(typeof mod[fn], 'function', '缺出口:' + fn);
    }
});
test('A2 五步按序且各有各的字样(两词同形即失败)', () => {
    assert.equal(mod.PLAY_STEPS.length, 5);
    assert.deepEqual(mod.PLAY_STEPS.slice(), ['prepare', 'depart', 'arrive', 'interact', 'wrapUp']);
    const t = mod.PLAY_STEP_TEXT;
    const labels = mod.PLAY_STEPS.map((k) => t[k]);
    for (const k of mod.PLAY_STEPS) assert.equal(typeof t[k], 'string', '缺字样:' + k);
    assert.equal(new Set(labels).size, 5, '五步字样不得塔成同形');
});
test('A3 五态与八词归因齐备,且关键两对不许同形', () => {
    const s = mod.PLAY_STATES;
    const vals = Object.values(s);
    assert.equal(vals.length, 5, '必须五态');
    assert.equal(new Set(vals).size, 5, '五态不得塔成同形');
    const r = mod.PLAY_REASONS;
    const keys = Object.keys(r);
    assert.ok(keys.length >= 8, '至少八词归因,实得 ' + keys.length);
    assert.equal(new Set(keys.map((k) => r[k])).size, keys.length, '归因词不得塔成同形');
    for (const need of ['no-commitment', 'terminal', 'not-started', 'needs-evidence', 'future-step', 'rolled-back', 'wrapup-needs-interact']) {
        assert.equal(typeof r[need], 'string', '缺归因词:' + need);
    }
    assert.notEqual(r['no-commitment'], r['not-started'], '没给约定 与 尚未确认 不许同形');
    assert.notEqual(r['future-step'], r['needs-evidence'], '前置未满足 与 需人证 不许同形');
    assert.ok(Object.isFrozen(s) && Object.isFrozen(r) && Object.isFrozen(mod.PLAY_STEPS)
        && Object.isFrozen(mod.PLAY_STEP_TEXT) && Object.isFrozen(mod.PLAY_LIMITS));
});
test('A4 上限冻结,且步数上限等于五步', () => {
    assert.ok(Object.isFrozen(mod.PLAY_LIMITS));
    for (const k of ['invitationChars', 'todoItems', 'draftChars', 'steps']) {
        assert.equal(typeof mod.PLAY_LIMITS[k], 'number', '缺上限:' + k);
        assert.ok(mod.PLAY_LIMITS[k] >= 1);
    }
    assert.equal(mod.PLAY_LIMITS.steps, 5, '步数上限必须等于五步');
});
test('A5 零依赖零宿主边界(只 import num-gate 一处;不读现实时间)', () => {
    const imports = core.match(/^import .*$/gm) || [];
    assert.equal(imports.length, 1, '内核只许 import 一处,实测 ' + imports.length);
    assert.ok(imports[0].includes("'./num-gate.js'"), '那唯一一处必须是 num-gate:' + imports[0]);
    const c = strip(core);
    for (const bad of ['window', 'document', 'localStorage', 'eval(', 'new Function',
        'setTimeout', 'dispatchEvent', 'Date.now', 'new Date']) {
        assert.equal(c.indexOf(bad), -1, '内核代码里不得出现 ' + bad + '(用现实时间判回档会把「玩家回到旧楼层」误读成「约会已过时」)');
    }
});

/* ---------- B 行为 ---------- */
test('B1 没给约定 ⇒ 如实报 no-commitment(不与「还没开始」同形)', () => {
    const a = mod.buildDatePlaybook({});
    assert.equal(a.ok, false);
    assert.equal(a.reason, 'no-commitment');
    assert.equal(a.steps.length, 0);
    const b = mod.buildDatePlaybook({ commitment: { id: '', content: '' } });
    assert.equal(b.reason, 'no-commitment', '空 id 或空内容一样要如实报');
});
test('B2 已确认的约定:准备与出发都可做(计划原文说的是**可选步骤**),而后三步按序等', () => {
    const r = mod.buildDatePlaybook({ commitment: C(), currentFloor: 10 });
    assert.equal(r.ready, 'prepare', 'ready 口报的必须是**最早还没做的那一步**');
    /* ★ 准备与出发都是「无条件可做」的步骤(计划原文写的是「可选步骤」——
     *   一次约会可以就地出发,不必先做一整套准备)。故这两步同时 ready 是对的;
     *   真正必须按序的是后三步:到场等人证、互动要在到场之后、结束要在互动之后。 */
    assert.equal(r.steps.find((x) => x.key === 'prepare').state, 'ready');
    assert.equal(r.steps.find((x) => x.key === 'depart').state, 'ready');
    for (const k of ['interact', 'wrapUp']) {
        const s = r.steps.find((x) => x.key === k);
        assert.notEqual(s.state, 'ready', k + ' 不该在没做完前一步时就 ready');
    }
    /* 到场永远是「需要人证」而不是 ready —— 它是这条流程里唯一不得自行判定的一步 */
    assert.equal(r.steps.find((x) => x.key === 'arrive').state, 'needs-evidence');
});
test('B3 **到场必须等人证**(验收第三条的核心):无正文/用户确认时不 tự动到场', () => {
    const r = mod.buildDatePlaybook({ commitment: C(), currentFloor: 10,
        marks: { prepare: { floor: 5, eventKey: 'e1' }, depart: { floor: 6, eventKey: 'e2' } } });
    const arr = r.steps.find((x) => x.key === 'arrive');
    assert.equal(arr.state, 'needs-evidence', '到场必须等人证:' + JSON.stringify(arr));
    assert.ok(String(arr.evidence).includes('正文'), '必须说清人证是什么');
    /* advanceStep 不带人证 ⇒ 拒 */
    const bad = mod.advanceStep({ commitment: C(), currentFloor: 10,
        marks: { prepare: { floor: 5, eventKey: 'e1' }, depart: { floor: 6, eventKey: 'e2' } } }, 'arrive');
    assert.equal(bad.ok, false);
    assert.equal(bad.reason, 'needs-evidence', '无人证必须具名拒');
    /* 带人证 ⇒ 放行 */
    const ok = mod.advanceStep({ commitment: C(), currentFloor: 10,
        marks: { prepare: { floor: 5, eventKey: 'e1' }, depart: { floor: 6, eventKey: 'e2' } } }, 'arrive', { userConfirmed: true });
    assert.equal(ok.ok, true, '给了人证必须放行');
    assert.equal(ok.needsWrite, true, '放行后要写(但写由上层做)');
});
test('B4 没互动就不给回顾草稿(否则回顾是空中楼阁)', () => {
    const a = mod.buildDatePlaybook({ commitment: C(), currentFloor: 10,
        marks: { prepare: { floor: 5, eventKey: 'e1' }, depart: { floor: 6, eventKey: 'e2' } } });
    assert.equal(a.draft, '', 'interact 未做时不得给草稿');
    const b = mod.buildDatePlaybook({ commitment: C(), currentFloor: 10, marks: {
        prepare: { floor: 5, eventKey: 'e1' }, depart: { floor: 6, eventKey: 'e2' },
        arrive: { floor: 7, eventKey: 'e3' }, interact: { floor: 8, eventKey: 'e4' } } });
    assert.ok(b.draft.length > 0, 'interact 做过之后必须给草稿');
    assert.ok(b.draft.includes('草稿待编辑'), '草稿必须标明「待编辑」而不是已发布');
});
test('B5 回档后未来步骤不继续触发(验收第四条)', () => {
    const r = mod.buildDatePlaybook({ commitment: C(), currentFloor: 3,
        marks: { prepare: { floor: 5, eventKey: 'e1' }, depart: { floor: 6, eventKey: 'e2' } } });
    assert.equal(r.staleCount, 2, '两条出处在新时间线之后 ⇒ 两步作废');
    assert.equal(r.steps[0].state, 'stale');
    assert.equal(r.steps[1].state, 'stale');
    assert.equal(r.reason, 'rolled-back');
    /* advanceStep 对作废步骤必须拒 */
    const adv = mod.advanceStep({ commitment: C(), currentFloor: 3,
        marks: { prepare: { floor: 5, eventKey: 'e1' } } }, 'prepare');
    assert.equal(adv.ok, false);
    assert.equal(adv.reason, 'rolled-back');
});
test('B6 楼层读不到时**不当证据**:不得因读不到而作废,也不得因读不到而放行', () => {
    const r = mod.buildDatePlaybook({ commitment: C(), currentFloor: null,
        marks: { prepare: { floor: 5, eventKey: 'e1' } } });
    assert.equal(r.staleCount, 0, '当前楼层读不到时不许拿它作废任何步骤');
    assert.equal(r.steps[0].state, 'done', '有出处的步骤照旧算做过');
});
test('B7 未确认的约定不推进(拟议态只等确认)', () => {
    const r = mod.buildDatePlaybook({ commitment: C({ status: 'proposed' }), currentFloor: 10 });
    assert.equal(r.ready, null, '拟议态不该给出可做步骤');
    for (const s of r.steps) {
        assert.equal(s.state, 'waiting');
        assert.equal(s.reason, 'not-started');
    }
});
test('B8 终态(履约/取消)不再推进步骤', () => {
    for (const st of ['fulfilled', 'cancelled']) {
        const r = mod.buildDatePlaybook({ commitment: C({ status: st }), currentFloor: 10 });
        assert.equal(r.ready, null, st + ' 态不该给出可做步骤');
        const s0 = r.steps[0];
        assert.equal(s0.state, 'waiting');
        assert.equal(s0.reason, 'terminal', st + ' 态的归因必须是 terminal');
    }
});
test('B9 邀请读数与待办:三个挂点齐备,且**改期后待办跟着变**(验收第二条)', () => {
    const a = mod.buildDatePlaybook({ commitment: C(), currentFloor: 10 });
    assert.ok(a.invitation, '有对方时必须产出邀请读数');
    assert.ok(a.invitation.text.includes('看电影'), '邀请要带上约定内容:' + a.invitation.text);
    assert.ok(a.invitation.text.includes('2026-01-01'), '邀请要带上日期');
    assert.equal(a.invitation.needsReply, true, '邀请必须标「待回复」');
    assert.equal(a.todos.length, 3, '地点/时间/等回复三个待办齐备:' + JSON.stringify(a.todos));
    /* 改期:换日期与地点 ⇒ 待办文本必须跟着变 */
    const b = mod.buildDatePlaybook({ commitment: C({ dateKey: '2026-02-02', place: 'Q' }), currentFloor: 10 });
    const ta = a.todos.map((x) => x.text).join('|');
    const tb = b.todos.map((x) => x.text).join('|');
    assert.notEqual(ta, tb, '改期后待办必须跟着变(否则就是「不同步」)');
    assert.ok(tb.includes('Q'), '新地点必须出现在待办里');
    assert.ok(tb.includes('2026-02-02'), '新日期必须出现在待办里');
});
test('B10 没有对方时不产出邀请(不编一个收件人)', () => {
    const r = mod.buildDatePlaybook({ commitment: C({ with: '' }), currentFloor: 10 });
    assert.equal(r.invitation, null, '无对方时不得产邀请读数');
    assert.equal(r.todos.length, 2, '待办里也不该有「等回复」那一条');
});
test('B11 纯函数不改入参', () => {
    const raw = { commitment: C(), currentFloor: 10, marks: { prepare: { floor: 5, eventKey: 'e1' } } };
    const snap = JSON.stringify(raw);
    mod.buildDatePlaybook(raw);
    mod.advanceStep(raw, 'prepare');
    assert.equal(JSON.stringify(raw), snap, '入参被改了');
});
test('B12 已做过的步骤重放不得再推进(幂等)', () => {
    const r = mod.advanceStep({ commitment: C(), currentFloor: 10,
        marks: { prepare: { floor: 5, eventKey: 'e1' } } }, 'prepare');
    assert.equal(r.ok, false);
    assert.equal(r.replayed, true, '已做过必须报重放');
});
test('B13 一行读数三态各占一格', () => {
    const ok = mod.datePlaybookLine(mod.buildDatePlaybook({ commitment: C(), currentFloor: 10 }));
    assert.ok(ok.includes('现在能做'), '有读数时要说出现在能做什么:' + ok);
    const noC = mod.datePlaybookLine(mod.buildDatePlaybook({}));
    assert.ok(noC.includes('没给约定'), '没给约定时要说清:' + noC);
    const rolled = mod.datePlaybookLine(mod.buildDatePlaybook({ commitment: C(), currentFloor: 1,
        marks: { prepare: { floor: 5, eventKey: 'e1' } } }));
    assert.ok(rolled.includes('已回档'), '回档时要说清:' + rolled);
    assert.notEqual(noC, rolled, '两种情形不许同形');
    assert.equal(mod.datePlaybookLine(null), '约会流程:无读数');
});

/* ---------- C 接线 ---------- */
test('C1 日历层真读本层账与剧情楼层,且出口永不抛', () => {
    const a = read(APP);
    assert.ok(a.includes('buildDatePlaybook('), '日历层必须真调内核');
    assert.ok(a.includes('commitmentPlaybook(commitmentId)'), '必须有对外出口');
    assert.ok(a.includes('advanceCommitmentStep(commitmentId, stepKey, evidence = {})'), '必须有推进出口');
    assert.ok(a.includes('this.loadCommitments()'), '约定必须从本层已有的账读');
    assert.ok(a.includes('numOrNull'), '取数必须走仓内唯一实现');
    const i = a.indexOf('commitmentPlaybook(commitmentId)');
    const body = a.slice(i, i + 1600);
    assert.ok(body.includes('} catch (_e) {'), '必须兜异常');
    assert.ok(body.includes('读数时抛了'), '异常时必须如实报而不假装没这条约定');
});
test('C2 楼层读的是剧情时钟而不是现实时间(验收原文最后一句)', () => {
    const a = read(APP);
    assert.ok(a.includes('currentStoryFloor()'), '必须有剧情楼层读数口');
    assert.ok(a.includes('_storyClock'), '必须读剧情时钟');
    const i = a.indexOf('currentStoryFloor()');
    const body = a.slice(i, i + 900);
    assert.equal(body.includes('Date.now'), false, '不得用现实时间判回档');
    assert.ok(body.includes('return null'), '读不到必须返回 null 而不是 0');
});
test('C3 诊断面接入:真取数卡 + 一行读数出口', () => {
    const d = read(DGD);
    assert.ok(d.includes('datePlaybookSelfCheck()'), '诊断数据层必须调内核自检');
    assert.ok(d.includes('datePlayFace'), '必须成卡');
    assert.ok(d.includes('export function datePlayFaceText'), '必须有一行读数出口');
    const v = read(DGV);
    assert.ok(v.includes('_datePlayHtml(pkg)'), '视图层必须渲染这张卡');
    assert.ok(v.includes('this._datePlayHtml(pkg)'), '卡必须真被挂进渲染');
    assert.ok(v.includes('face.sample'), '必须渲染样本实测(否则卡是死的)');
});

/* ---------- D 负控制(真源码定点破坏) ---------- */
const brokenFile = (name, src) => {
    const p = path.join(ROOT, 'config', name);
    fs.writeFileSync(p, src, 'utf-8');
    return p;
};
function breakOnce(from, to) {
    const n = core.split(from).length - 1;
    assert.equal(n, 1, '锚点应恰中 1 次,实际 ' + n + ':' + String(from).slice(0, 70));
    return core.replace(from, to);
}
test('D1 破坏「到场等人证」⇒ 对应判据必转红', async () => {
    const bad = breakOnce("                state = PLAY_STATES.NEEDS_EVIDENCE;", "                state = PLAY_STATES.READY;");
    const p = brokenFile('__broken_v4090_d1.mjs', bad);
    try {
        const m = await import(p + '?d1=' + Date.now());
        const r = m.buildDatePlaybook({ commitment: C(), currentFloor: 10,
            marks: { prepare: { floor: 5, eventKey: 'e1' }, depart: { floor: 6, eventKey: 'e2' } } });
        const arr = r.steps.find((x) => x.key === 'arrive');
        assert.equal(arr.state, 'ready', '破坏副本:到场被自动放行了');
        /* 原版同一输入、同款判据必须真 */
        const ok = mod.buildDatePlaybook({ commitment: C(), currentFloor: 10,
            marks: { prepare: { floor: 5, eventKey: 'e1' }, depart: { floor: 6, eventKey: 'e2' } } });
        assert.equal(ok.steps.find((x) => x.key === 'arrive').state, 'needs-evidence', '原版必须等人证');
    } finally { fs.unlinkSync(p); }
});
test('D2 破坏「回档即作废」⇒ 对应判据必转红', async () => {
    const bad = breakOnce('        if (floor !== null && cur !== null && floor > cur) {', '        if (false) {');
    const p = brokenFile('__broken_v4090_d2.mjs', bad);
    try {
        const m = await import(p + '?d2=' + Date.now());
        const r = m.buildDatePlaybook({ commitment: C(), currentFloor: 3,
            marks: { prepare: { floor: 5, eventKey: 'e1' } } });
        assert.equal(r.staleCount, 0, '破坏副本:回档后步骤不再作废');
        assert.equal(r.steps[0].state, 'done', '破坏副本:作废的步骤被读成做过');
        assert.equal(mod.buildDatePlaybook({ commitment: C(), currentFloor: 3,
            marks: { prepare: { floor: 5, eventKey: 'e1' } } }).staleCount, 1, '原版必须作废');
    } finally { fs.unlinkSync(p); }
});
test('D3 破坏「没互动不给回顾」⇒ 对应判据必转红', async () => {
    const bad = breakOnce("    if (inter.state === PLAY_STATES.DONE || inter.state === PLAY_STATES.READY) {", '    if (true) {');
    const p = brokenFile('__broken_v4090_d3.mjs', bad);
    try {
        const m = await import(p + '?d3=' + Date.now());
        const r = m.buildDatePlaybook({ commitment: C(), currentFloor: 10, marks: {
            prepare: { floor: 5, eventKey: 'e1' }, depart: { floor: 6, eventKey: 'e2' } } });
        assert.ok(r.draft.length > 0, '破坏副本:没互动也给了回顾草稿');
        assert.equal(mod.buildDatePlaybook({ commitment: C(), currentFloor: 10, marks: {
            prepare: { floor: 5, eventKey: 'e1' }, depart: { floor: 6, eventKey: 'e2' } } }).draft, '', '原版必须不给');
    } finally { fs.unlinkSync(p); }
});

/* ---------- E 版本锚(下限形) ---------- */
test('E1 版本锚:入口不得低于 4.08.0(下限形,下一版抬版无需二次改写)', () => {
    const v = JSON.parse(read('package.json')).version.split('.').map(Number);
    assert.ok(v[0] > 4 || (v[0] === 4 && v[1] >= 8), '入口版本不得低于 4.08.0,实测 ' + v.join('.'));
});
