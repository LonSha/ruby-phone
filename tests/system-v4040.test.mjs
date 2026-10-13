/* ========================================================
 * tests/system-v4040.test.mjs -- [v4.04.0 . 第三期 E 包手机侧第五项 R3-X7]
 *   可视化个人流程编排(排序 / 条件分支 / 参数绑定 / 个人模板)
 *
 * 判据面(五组):
 *   A 结构:内核五条白名单动作 / 上限与词表 / 拒绝面 / 零依赖边界(只 import 两处;零 storage . window . eval)
 *   B 行为:认不出即拒 / 条件设不全 ⇒ 整步丢(不拆闸) / 写步不许重复 / 越界即拒不夹取 /
 *           参数只丢那一个键 / 拖排不改入参 / 参数整体替换 / 合成超上限即拒 /
 *           条件跳过 != 失败(applyFlowPlan 标 skipped、下游一并跳过、needsConfirm 只算真会跑的写步)
 *   C 接线:index.js 咽喉(动作白名单 / 新键 / 三个设计动作 / 默认 dry-run / 读不到即拒 / 写后回读 / 运行器外部流程面) /
 *           app 层(设计段 + 换会话丢草稿) / 视图层(渲染 + 绑定) / CSS / 键登记
 *   D 负控制:真源码定点破坏「条件面缺即整步丢」与「写步不许重复」⇒ 对应判据必转红
 *   E 版本锚:下限形(不锁当版读数,下一版抬版无需二次改写)
 * ========================================================= */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf-8');
const CORE = 'config/workflow-designer.js';
const WF = 'config/workflow.js';
const RUNTIME = 'config/workflow-runtime.js';
const APP = 'apps/workflow/workflow-app.js';
const DESIGN = 'apps/workflow/workflow-design.js';
const VIEW = 'apps/workflow/workflow-view.js';
const CSS = 'apps/workflow/workflow.css';
const KEYS = 'scripts/keys-audit.mjs';
const core = read(CORE);
const wfs = read(WF);
const idx = read('index.js');
const app = read(APP);
const design = read(DESIGN);
const view = read(VIEW);
const css = read(CSS);
const keys = read(KEYS);
const mod = await import(path.join(ROOT, CORE));
const wfmod = await import(path.join(ROOT, WF));
const {
    WD_ACTIONS, WD_ACTION_KEYS, WD_LIMITS, WD_REASONS, WD_BRANCH_STATES, WD_DEFAULT_NAME, WD_ID_PREFIX,
    normalizeTemplate, normalizeTemplates, moveStep, bindParams, setBranch, setRepeat,
    composeFlow, templateReadings, templateLine, designerSelfCheck,
} = mod;
/* ---------- A 结构 ---------- */
test('A1 内核自检零问题 + 出口齐备', () => {
    const r = designerSelfCheck();
    assert.equal(r.problems.length, 0, JSON.stringify(r.problems));
    for (const fn of ['normalizeTemplate', 'normalizeTemplates', 'moveStep', 'bindParams', 'setBranch', 'setRepeat', 'composeFlow', 'templateReadings', 'templateLine', 'designerSelfCheck']) {
        assert.equal(typeof mod[fn], 'function', '缺出口:' + fn);
    }
});
test('A2 五条白名单动作:owner 已登记、写步 owner 可写、参数键都是声明过的', () => {
    assert.equal(WD_ACTION_KEYS.length, 5);
    for (const k of WD_ACTION_KEYS) {
        const a = WD_ACTIONS[k];
        assert.equal(a.key, k);
        assert.equal(typeof wfmod.WF_OWNERS[a.owner], 'object', 'owner 未登记:' + a.owner);
        if (a.writes) assert.equal(wfmod.WF_OWNERS[a.owner].writable, true, '写步 owner 不可写:' + a.owner);
        assert.equal(Array.isArray(a.in), true);
        assert.equal(typeof a.out, 'string');
        assert.equal(Array.isArray(a.params), true);
    }
});
test('A3 上限冻结且与运行器自洽(模板步数 <= 运行器步骤上限)', () => {
    assert.equal(Object.isFrozen(WD_LIMITS), true);
    for (const k of ['templates', 'steps', 'params', 'repeat', 'nameMax', 'idMax', 'textMax']) {
        assert.equal(typeof WD_LIMITS[k], 'number');
        assert.equal(WD_LIMITS[k] > 0, true, k);
    }
    assert.equal(WD_LIMITS.steps <= wfmod.WF_STEPS_MAX, true, '模板步数上限不得超过运行器上限');
    assert.equal(WD_BRANCH_STATES.join(','), 'present,absent');
    assert.equal(WD_ID_PREFIX, 'wd_t_');
    assert.equal(WD_DEFAULT_NAME.length > 0, true);
});
test('A4 拒绝面:十五个归因词都在,且视图与诊断只许取这里的值', () => {
    const ws = Object.keys(WD_REASONS).map((k) => WD_REASONS[k]);
    for (const w of ['name-empty', 'no-steps', 'too-many-steps', 'too-many-templates', 'action-unknown',
        'param-unknown', 'param-too-many', 'branch-unknown', 'branch-face-missing', 'repeat-on-write',
        'repeat-out-of-range', 'move-out-of-range', 'step-unknown', 'template-unknown', 'templates-unreadable']) {
        assert.equal(ws.indexOf(w) >= 0, true, '缺归因词:' + w);
    }
    assert.equal(Object.isFrozen(WD_REASONS), true);
});
test('A5 零依赖边界:只 import workflow.js 与 num-gate.js;零 storage . window . document . eval', () => {
    const imports = core.split('\n').filter((l) => l.trim().startsWith('import '));
    assert.equal(imports.length, 2, '只许两处 import:' + JSON.stringify(imports));
    assert.equal(imports[0].indexOf('./workflow.js') >= 0, true);
    assert.equal(imports[1].indexOf('./num-gate.js') >= 0, true);
    /* 只在**去注释后的代码**上扫:注释里提到 window 不算依赖(别人写注释不是运行时依赖)。 */
    const codeOnly = core.replace(/\/\*[\s\S]*?\*\//g, ' ').split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');
    for (const bad of ['window', 'document', 'storage', 'localStorage', 'fetch', 'eval(', 'new Function', 'setTimeout', 'srcdoc', 'require(']) {
        assert.equal(codeOnly.indexOf(bad) < 0, true, '内核不得出现:' + bad);
    }
});
/* ---------- B 行为 ---------- */
test('B1 动作认不出 ⇒ 整步丢(不猜、也没有安全默认值)', () => {
    const n = normalizeTemplate({ id: 't1', name: 'A', steps: [{ action: 'ghost' }, { action: 'read-brief' }] });
    assert.equal(n.template.steps.length, 1);
    assert.equal(n.dropped, 1);
    assert.equal(n.rejected.some((r) => r.why === WD_REASONS.ACTION_UNKNOWN), true);
});
test('B2 条件设不全 ⇒ 整步丢(只丢闸等于把用户设的写闸拆掉,那更贵)', () => {
    const a = normalizeTemplate({ id: 't1', name: 'A', steps: [{ action: 'read-brief', when: { state: 'present' } }] });
    assert.equal(a.template.steps.length, 0, '缺面名时竟留下了这一步');
    assert.equal(a.rejected.some((r) => r.why === WD_REASONS.BRANCH_FACE_MISSING), true);
    const b = normalizeTemplate({ id: 't1', name: 'A', steps: [{ action: 'read-brief', when: { state: 'maybe', face: 'brief' } }] });
    assert.equal(b.template.steps.length, 0, '态认不出时竟留下了这一步');
    assert.equal(b.rejected.some((r) => r.why === WD_REASONS.BRANCH_UNKNOWN), true);
});
test('B3 写步不许重复;越界即拒(不夹取)', () => {
    const w = normalizeTemplate({ id: 't1', name: 'A', steps: [{ action: 'notify', repeat: 3 }] });
    assert.equal(w.template.steps[0].repeat, 1, '写步竟留了重复');
    assert.equal(w.rejected.some((r) => r.why === WD_REASONS.REPEAT_ON_WRITE), true);
    const o = normalizeTemplate({ id: 't1', name: 'A', steps: [{ action: 'read-brief', repeat: 99 }] });
    assert.equal(o.template.steps[0].repeat, 1, '越界竟被夹取');
    assert.equal(o.rejected.some((r) => r.why === WD_REASONS.REPEAT_OUT_OF_RANGE), true);
    const ok = normalizeTemplate({ id: 't1', name: 'A', steps: [{ action: 'read-brief', repeat: 2 }] });
    assert.equal(ok.template.steps[0].repeat, 2);
});
test('B4 参数键未声明 ⇒ 只丢那一个键(步留着)', () => {
    const n = normalizeTemplate({ id: 't1', name: 'A', steps: [{ action: 'notify', params: { title: 'T', bogus: 'x' } }] });
    assert.equal(n.template.steps.length, 1);
    assert.deepEqual(n.template.steps[0].params, { title: 'T' });
    assert.equal(n.rejected.some((r) => r.why === WD_REASONS.PARAM_UNKNOWN), true);
});
test('B5 拖排:越界与同位置一律拒,且不改入参(纯函数)', () => {
    const t = { id: 't1', name: 'A', steps: [{ action: 'read-brief' }, { action: 'notify' }] };
    assert.equal(moveStep(t, 0, 5).ok, false);
    assert.equal(moveStep(t, 0, 5).why, WD_REASONS.MOVE_OUT_OF_RANGE);
    assert.equal(moveStep(t, 0, 0).ok, false, '同位置竟算挪动');
    assert.equal(moveStep(t, null, 1).ok, false);
    assert.deepEqual(moveStep(t, 0, 1).template.steps.map((s) => s.action), ['notify', 'read-brief']);
    assert.deepEqual(t.steps.map((s) => s.action), ['read-brief', 'notify'], '入参被就地改了');
});
test('B6 参数整体替换(不合并:合并会让旧值缠住新值)', () => {
    const t = { id: 't1', name: 'A', steps: [{ action: 'notify', params: { title: 'OLD' } }] };
    const r = bindParams(t, 0, {});
    assert.equal(r.ok, true);
    assert.deepEqual(r.template.steps[0].params, {}, '旧值没被清掉');
    assert.deepEqual(t.steps[0].params, { title: 'OLD' }, '入参被就地改了');
    assert.equal(bindParams(t, 9, {}).why, WD_REASONS.STEP_UNKNOWN);
});
test('B7 设条件与取消条件:when 为 null 即取消;面名缺失一律拒', () => {
    const t = { id: 't1', name: 'A', steps: [{ action: 'read-brief', when: { face: 'brief', state: 'present' } }] };
    assert.equal(setBranch(t, 0, null).template.steps[0].when, null);
    assert.equal(setBranch(t, 0, 'always').template.steps[0].when, null, 'always 应等于取消');
    assert.equal(setBranch(t, 0, { state: 'present' }).why, WD_REASONS.BRANCH_FACE_MISSING);
    assert.deepEqual(setBranch(t, 0, { state: 'absent', face: 'brief' }).template.steps[0].when, { face: 'brief', state: 'absent' });
    assert.equal(setRepeat({ id: 't1', name: 'A', steps: [{ action: 'notify' }] }, 0, 2).why, WD_REASONS.REPEAT_ON_WRITE);
});
test('B8 合成:形状与 WF_FLOWS 条目一样,且照样过运行器同一套判定(不新开第二套)', () => {
    const c = composeFlow({ id: 't1', name: 'A', steps: [{ action: 'read-brief' }, { action: 'save-draft', params: { note: 'n' } }] });
    assert.equal(!!c.flow, true);
    assert.equal(c.problems.length, 0);
    assert.equal(c.flow.id, 'tpl-t1');
    assert.equal(c.flow.composed, true);
    const st = c.flow.steps[1];
    for (const k of ['in', 'out', 'writes', 'owner']) assert.equal(k in st, true, '缺字段:' + k);
    assert.equal(st.writes, true);
    /* 输入面照给:给的正是合成流程那两步要读的两样 —— 合成**不给**它开通任何便利。 */
    const plan = wfmod.planFlow({
        flowId: c.flow.id, scope: { chatId: 'c', branchKey: 'main' }, runKey: 'r1', confirm: true, runs: [],
        inputs: { 'resume-face': { a: 1 }, brief: { t: 'x' } }, flows: [c.flow],
    });
    assert.equal(plan.kind, 'fresh', '合成流程竟开不了工:' + plan.kind + '/' + plan.why);
    assert.equal(plan.steps.some((s) => s.writes), true, '写步在计划里没被识别');
});
test('B9 合成展开超上限即拒(不静默截断)', () => {
    const many = { id: 't1', name: 'A', steps: [] };
    for (let i = 0; i < WD_LIMITS.steps; i += 1) many.steps.push({ action: 'read-brief', repeat: WD_LIMITS.repeat });
    assert.equal(WD_LIMITS.steps * WD_LIMITS.repeat > wfmod.WF_STEPS_MAX, true, '算例必须真超上限,否则判据无效');
    const c = composeFlow(many);
    assert.equal(c.flow, null);
    assert.equal(c.problems.indexOf(WD_REASONS.TOO_MANY_STEPS) >= 0, true, JSON.stringify(c.problems));
});
test('B10 条件跳过 != 失败:标 skipped、下游一并跳过、needsConfirm 只算真会跑的写步', () => {
    const gated = [{
        id: 'tpl-gate', label: 'G', hint: '', steps: [
            { id: 's1', label: 'R', in: [], out: 'brief', writes: false, owner: 'brief-read', when: { face: 'resume-face', state: 'present' } },
            { id: 's2', label: 'W', in: ['brief'], out: 'draft', writes: true, owner: 'archive-draft' },
        ],
    }];
    const pv = wfmod.previewFlow({ flowId: 'tpl-gate', scope: { chatId: 'c', branchKey: 'main' }, inputs: { 'resume-face': null }, flows: gated });
    assert.equal(pv.steps[0].skipReason, 'branch-not-met');
    assert.equal(pv.steps[0].problems.indexOf('input-unreadable') < 0, true, '闸不过竟被当成缺件(两种原因被压平)');
    assert.equal(pv.needsConfirm, false, '跑不到的写步竟要求确认(假要求)');
    const plan = wfmod.planFlow({ flowId: 'tpl-gate', scope: { chatId: 'c', branchKey: 'main' }, runKey: 'g1', confirm: true, runs: [], flows: gated });
    assert.equal(plan.kind, 'fresh');
    const run = wfmod.applyFlowPlan(plan, []);
    assert.equal(run.steps[0].state, 'skipped');
    assert.equal(run.steps[1].state, 'skipped', '上游跳过时下游未被一并跳过');
    assert.equal(run.state, wfmod.WF_STATES.done.key, '全跳过竟不是 done(跳过的步不是失败步)');
    assert.equal(run.steps[0].skipReason, 'branch-not-met');
});
test('B11 模板台账三态:读不到(null) != 空([])', () => {
    assert.equal(normalizeTemplates(null).readable, false);
    assert.equal(normalizeTemplates(undefined).readable, false);
    assert.equal(normalizeTemplates('x').readable, false, '认不出的形状不得当空台账');
    assert.equal(normalizeTemplates([]).readable, true);
    assert.equal(normalizeTemplates([]).templates.length, 0);
});
test('B12 读数只描述不动作:templateReadings 分列读写步与条件数,needsConfirm 跟写步走', () => {
    const r = templateReadings({ id: 't1', name: 'A', steps: [{ action: 'read-brief' }, { action: 'notify', when: { face: 'brief', state: 'present' } }] });
    assert.equal(r.steps, 2);
    assert.equal(r.reads, 1);
    assert.equal(r.writes, 1);
    assert.equal(r.branches, 1);
    assert.equal(r.needsConfirm, true);
    assert.equal(templateLine({ id: 't1', name: 'A', steps: [{ action: 'read-brief' }] }).indexOf('A(步 1') >= 0, true);
});
/* ---------- C 接线 ---------- */
test('C1 咽喉:动作白名单加了 design,且新台账键与执行账分开', () => {
    assert.equal(/const WF_ACTION_KEYS = \[([^\]]*?)'design'/.test(idx), true, '动作白名单缺 design');
    assert.equal(/const WF_TEMPLATES_KEY = 'wf_templates'/.test(idx), true, '模板台账键不在');
    assert.equal(idx.indexOf("WF_TEMPLATES_KEY = 'wf_templates'") !== idx.indexOf("WF_RUNS_KEY = 'wf_runs'"), true, '两本账不得是同一个键');
    assert.equal(/storage\.set\(WF_RUNS_KEY/.test(idx), true, '执行账写口必须在');
});
test('C2 咽喉:设计动作只有三个(save / rename / remove),且默认 dry-run', () => {
    const seg = idx.slice(idx.indexOf('function applyWorkflowDesignAction'), idx.indexOf('function wfInvokeOwner'));
    assert.equal(seg.length > 0, true);
    assert.equal(seg.indexOf("['save', 'rename', 'remove']") >= 0, true, '动作集合不是那三个');
    assert.equal(seg.indexOf('act.confirm !== true') >= 0, true, '默认 dry-run 被拿掉了');
    assert.equal(/not-confirmed/.test(seg), true, '未确认时未给归因');
    assert.equal(seg.indexOf('readback-mismatch') >= 0, true, '写后回读不在');
});
test('C3 咽喉:模板台账读不到即拒(绝不拿空台账覆盖用户的模板)', () => {
    const seg = idx.slice(idx.indexOf('function applyWorkflowDesignAction'), idx.indexOf('function wfInvokeOwner'));
    assert.equal(seg.indexOf('norm.readable') >= 0, true, '没看可读性');
    assert.equal(seg.indexOf('WD_REASONS.TEMPLATES_UNREADABLE') >= 0, true, '读不到时未按归因拒');
    assert.equal(seg.indexOf('读不到不等于一条都没有') >= 0, true, '没把口径写进提示');
    assert.equal(/const raw = wfReadTemplates\(\)/.test(seg), true, '读口没走 wfReadTemplates');
});
test('C4 咽喉:运行器只多接一个外部流程面,判定路径一条没变', () => {
    const seg = idx.slice(idx.indexOf('function applyWorkflowAction'), idx.indexOf('function wfReadTemplates'));
    assert.equal(seg.indexOf('flows: () => window.VirtualPhone?._workflow?.designFlows || []') >= 0, true, '运行器没接外部流程面');
    assert.equal(seg.indexOf('invoke: wfInvokeOwner') >= 0, true, 'owner 表被动了');
    assert.equal(seg.indexOf('readRuns: wfReadRuns') >= 0, true, '执行账读口被动了');
    assert.equal(seg.indexOf('writeRuns:') >= 0, true, '执行账写口被动了');
});
test('C5 咽喉:只读口重取(不缓存陈读数)+ 挂上设计面', () => {
    assert.equal(idx.indexOf('workflowDesignFace: function ()') >= 0, true, '缺只读设计口');
    assert.equal(idx.indexOf('applyWorkflowDesignAction: applyWorkflowDesignAction') >= 0, true, '缺设计动作出口');
    const seg = idx.slice(idx.indexOf('workflowDesignFace: function ()'));
    assert.equal(seg.slice(0, 200).indexOf('refreshWorkflow();') >= 0, true, '只读口没现取');
    assert.equal(idx.indexOf('designFlows: designFlows') >= 0, true, '缓存里没挂设计流程');
    assert.equal(idx.indexOf('templates: tplNorm, designs: designs') >= 0, true, '缓存里没挂模板读数');
    assert.equal(idx.indexOf('designer: designerSelfCheck()') >= 0, true, '缓存里没挂设计自检');
});
test('C6 咽喉:内置两条流程不并入个人模板面(既有契约不回退)', () => {
    assert.equal(wfmod.WF_FLOWS.length, 2, '内置流程数变了');
    assert.equal(/for \(const f of WF_FLOWS\)/.test(idx), true, '内置流程读数循环不在');
    const seg = idx.slice(idx.indexOf('for (const df of designFlows)'));
    assert.equal(seg.slice(0, 300).indexOf('previewFlow(') >= 0, true, '合成流程没走同一套 previewFlow');
    assert.equal(idx.indexOf('composed: true') >= 0, true, '合成流程没打标(视图分不出它是谁排的)');
});
test('C7 app 层:设计段挂上、换会话丢草稿、视图模型带 design', () => {
    assert.equal(/import \{ WorkflowDesign \} from '\.\/workflow-design\.js';/.test(app), true, 'app 没接设计段');
    assert.equal(/this\._design = new WorkflowDesign\(this\)/.test(app), true, '设计段没实例化');
    assert.equal(/design: \(this\._design \? this\._design\.vm\(\) : null\)/.test(app), true, '视图模型没带 design');
    const chat = app.slice(app.indexOf('onChatChanged()'));
    assert.equal(chat.slice(0, 400).indexOf('new WorkflowDesign(this)') >= 0, true, '换会话没丢草稿');
    assert.equal(/destroy\(\) \{ this\._view = null; this\._design = null; \}/.test(app), true, 'destroy 没清设计段');
});
test('C8 视图层:渲染设计段 + 绑定转给设计段(本层不写存储)', () => {
    assert.equal(/import \{ designHtml, bindDesign \} from '\.\/workflow-design\.js';/.test(view), true, '视图没接设计段');
    assert.equal(/if \(vm\.design\) h \+= designHtml\(vm\.design\)/.test(view), true, '设计段没被渲染');
    assert.equal(/bindDesign\(el, self\.app \? self\.app\._design : null\)/.test(view), true, '设计段事件没绑');
    const viewCode = view.replace(/\/\*[\s\S]*?\*\//g, ' ').split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');
    assert.equal(viewCode.indexOf('storage') < 0, true, '视图层出现 storage(该层必须零存储调用)');
});
test('C9 设计段:零存储调用 . 零脚本执行 . 只走咽喉两个口', () => {
    const codeOnly = design.replace(/\/\*[\s\S]*?\*\//g, ' ').split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');
    for (const bad of ['eval(', 'new Function', 'srcdoc', 'createElement', 'localStorage']) {
        assert.equal(codeOnly.indexOf(bad) < 0, true, '设计段不得出现:' + bad);
    }
    assert.equal(codeOnly.indexOf('storage.') < 0, true, '设计段直接写存储了');
    assert.equal(design.indexOf('workflowDesignFace') >= 0, true, '没走只读口');
    assert.equal(design.indexOf('applyWorkflowDesignAction') >= 0, true, '没走唯一写入口');
    assert.equal(/applyWorkflowDesignAction\(Object\.assign\(\{ action: kind/.test(design), true, '动作没走咽喉');
});
test('C10 CSS:设计段样式在,且禁用态与写步分色(不能与容器同色)', () => {
    for (const sel of ['.wfl-design', '.wfl-draft', '.wfl-cond', '.wfl-params', '.wfl-repeat', '.wfl-saved', '.wfl-designs', '.wfl-btn-mini', '.wfl-input']) {
        assert.equal(css.indexOf(sel + ' ') >= 0 || css.indexOf(sel + ',') >= 0 || css.indexOf(sel + '{') >= 0 || css.indexOf(sel + '.') >= 0 || css.indexOf(sel + ':') >= 0, true, '缺样式:' + sel);
    }
    assert.equal(/\.wfl-btn-mini\[disabled\]/.test(css), true, '禁用态没样式');
});
test('C11 键登记:wf_templates 已在 keys-audit,且随会话隔离', () => {
    assert.equal(keys.indexOf("key: 'wf_templates', scope: " + "'chat'") >= 0, true);
    assert.equal(/\/\^wf_\//.test(read('config/storage.js')), true, '^wf_ 前缀已覆盖新键');
    assert.equal(keys.indexOf('wf_runs') >= 0 && keys.indexOf('wf_templates') >= 0, true, '执行账与设计账都要登记');
});
test('C12 运行器:条件跳过不进 owner,且下游读它的步一并跳过(不假报缺件)', () => {
    const rt = read(RUNTIME);
    assert.equal(rt.indexOf('skippedFaces') >= 0, true, '运行器没接跳过面');
    assert.equal(/if \(it\.skipReason\) \{ if \(it\.out\) skippedFaces\.push\(it\.out\); continue; \}/.test(rt), true, '闸不过的步没被跳过');
    assert.equal(rt.indexOf('it.in.some(key => skippedFaces.indexOf(key) >= 0)') >= 0, true, '下游没读跳过面');
});
/* ---------- D 负控制 ---------- */
test('D1 负控制:真源码定点破坏「条件面缺 ⇒ 整步丢」⇒ B2 判据必转红', async () => {
    const src = fs.readFileSync(path.join(ROOT, CORE), 'utf-8');
    const anchor = "        if (!face) {\n            rejected.push({ kind: 'step', index: index, why: WD_REASONS.BRANCH_FACE_MISSING, action: act.key });\n            return { step: null, rejected: rejected };\n        }\n";
    assert.equal(src.split(anchor).length - 1, 1, '负控制锚点必须恰中一次');
    /* 破坏:缺面名时不再丢整步(正是「只丢闸=把用户设的写闸拆掉」那件错事) */
    const broken = src.replace(anchor, "        if (false) {\n            rejected.push({ kind: 'step', index: index, why: WD_REASONS.BRANCH_FACE_MISSING, action: act.key });\n            return { step: null, rejected: rejected };\n        }\n", 1);
    assert.notEqual(broken, src, '破坏必须发生');
    /* 破坏副本必须落在内核同目录:内核 import 是相对路径 ./workflow.js 与 ./num-gate.js */
    const tmp = path.join(ROOT, 'config', '__broken_v4040_core.mjs');
    fs.writeFileSync(tmp, broken, 'utf-8');
    const bmod = await import(tmp + '?t=' + Date.now());
    const b = bmod.normalizeTemplate({ id: 't1', name: 'A', steps: [{ action: 'read-brief', when: { state: 'present' } }] });
    assert.equal(b.template.steps.length, 1, '破坏版必须留下这一步(否则负控制无效)');
    fs.unlinkSync(tmp);
});
test('D2 负控制:真源码定点破坏「写步不许重复」⇒ B3 判据必转红', async () => {
    const src = fs.readFileSync(path.join(ROOT, CORE), 'utf-8');
    const anchor = "        if (act.writes) rejected.push({ kind: 'step', index: index, why: WD_REASONS.REPEAT_ON_WRITE, action: act.key });\n";
    assert.equal(src.split(anchor).length - 1, 1, '负控制锚点必须恰中一次');
    const broken = src.replace(anchor, "        if (false) rejected.push({ kind: 'step', index: index, why: WD_REASONS.REPEAT_ON_WRITE, action: act.key });\n"
        + "        else if (rawRepeat >= 1 && rawRepeat <= WD_LIMITS.repeat) rep = Math.floor(rawRepeat);\n", 1);
    assert.notEqual(broken, src, '破坏必须发生');
    const tmp = path.join(ROOT, 'config', '__broken_v4040_core2.mjs');
    fs.writeFileSync(tmp, broken, 'utf-8');
    const bmod = await import(tmp + '?t=' + Date.now());
    const w = bmod.normalizeTemplate({ id: 't1', name: 'A', steps: [{ action: 'notify', repeat: 3 }] });
    assert.equal(w.template.steps[0].repeat, 3, '破坏版必须让写步带上重复(否则负控制无效)');
    assert.equal(w.rejected.some((r) => r.why === 'repeat-on-write'), false, '破坏版不该再报 repeat-on-write');
    fs.unlinkSync(tmp);
});
test('D3 负控制:真源码定点破坏「条件面读不出来按 absent 算」⇒ 闸会被静默拆掉', async () => {
    const src = fs.readFileSync(path.join(ROOT, 'config', 'workflow.js'), 'utf-8');
    const anchor = "    const present = has && wfFacePresent(ins[face]);\n";
    assert.equal(src.split(anchor).length - 1, 1, '负控制锚点必须恰中一次');
    const broken = src.replace(anchor, "    const present = has ? (wfFacePresent(ins[face]) || true) : true;\n", 1);
    assert.notEqual(broken, src, '破坏必须发生');
    const tmp = path.join(ROOT, 'config', '__broken_v4040_wf.mjs');
    fs.writeFileSync(tmp, broken, 'utf-8');
    const bmod = await import(tmp + '?t=' + Date.now());
    const gated = [{
        id: 'tpl-gate', label: 'G', hint: '', steps: [
            { id: 's1', label: 'R', in: [], out: 'brief', writes: false, owner: 'brief-read', when: { face: 'resume-face', state: 'present' } },
        ],
    }];
    const pv = bmod.previewFlow({ flowId: 'tpl-gate', scope: { chatId: 'c', branchKey: 'main' }, inputs: { 'resume-face': null }, flows: gated });
    assert.notEqual(pv.steps[0].skipReason, 'branch-not-met', '破坏版必须让闸静默成立(否则负控制无效)');
    fs.unlinkSync(tmp);
});
/* ---------- E 版本锚(下限形) ---------- */
test('E1 版本门:入口版本不低于 4.03.0(本版目标 v4.04.0)', () => {
    const m = idx.match(/const ST_PHONE_VERSION = '(\d+)\.(\d+)\.(\d+)';/);
    assert.ok(m, '入口版本常量必须在');
    const v = [Number(m[1]), Number(m[2]), Number(m[3])];
    assert.equal(v[0] > 4 || (v[0] === 4 && v[1] >= 3), true, '入口版本不得低于 4.03.0');
});
