/** R-X5: A structure / A2 purity / B behavior / C real host adapters / D mutants / E version. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as WF from '../config/workflow.js';
import { createWorkflowRunner } from '../config/workflow-runtime.js';
import * as RW from '../config/resume-workbench.js';
import { NotificationLog } from '../config/system-notifications.js';
import { ArchiveApp } from '../apps/archive/archive-app.js';
import { WorkflowView } from '../apps/workflow/workflow-view.js';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const scope = { chatId: 'c', branchKey: 'main' };
const inputs = { 'archive-pack': {}, 'resume-face': { canDraft: true }, 'settlement-draft': { id: 'd' } };
const base = over => Object.assign({ flowId: 'resume-brief', scope, inputs, runs: [], runKey: 'r', confirm: true, at: 0 }, over);
function harness(factory = createWorkflowRunner, over = {}) {
    const h = { rows: [], calls: [], saves: [], published: null, scope: { ...scope }, token: 1 };
    const ports = {
        scope: () => h.scope, token: () => h.token, inputs: () => inputs,
        readRuns: () => h.rows, writeRuns: rows => { h.saves.push(JSON.parse(JSON.stringify(rows))); h.rows = JSON.parse(JSON.stringify(rows)); return true; },
        publish: r => { h.published = r; }, now: () => 42, newKey: () => 'r', yieldStep: async () => {},
        invoke: async (owner, req) => {
            h.calls.push({ owner, req });
            return { ok: true, value: owner === 'resume-workbench' ? { line: 'text' } : { id: owner }, receipt: { id: owner } };
        }, ...over,
    };
    h.ports = ports; h.runner = factory(ports);
    h.act = (action = 'run', extra = {}) => h.runner.act({ action, flowId: 'resume-brief', scope: { ...scope }, token: 1, confirm: true, ...extra });
    return h;
}
function judgeDry(m) {
    assert.equal(m.planFlow(base({ confirm: undefined })).why, 'not-confirmed');
    assert.equal(m.previewFlow(base()).willWrite, false);
    assert.equal(m.planFlow(base()).kind, 'fresh');
}
function judgePayload(m) {
    const plan = m.planFlow(base());
    assert.deepEqual(plan.steps[0].payload.reads['resume-face'], inputs['resume-face']);
    assert.equal(plan.steps[0].run, true);
    assert.deepEqual(plan.steps[1].in, ['brief']);
}
function judgeRetry(m) {
    const plan = m.planFlow(base());
    const half = m.applyFlowPlan(plan, [{ stepId: 'read-brief', ok: true, value: { line: 'x' } }, { stepId: 'save-draft', ok: false }]);
    assert.notEqual(half.state, 'done');
    const row = { ...half, runKey: 'r' };
    const retry = m.planFlow(base({ runs: [row] }));
    assert.equal(retry.kind, 'fresh');
    assert.deepEqual(retry.steps.map(s => s.run), [false, true, true]);
    const unknown = { ...row, steps: [{ stepId: 'save-draft', state: 'running' }] };
    assert.equal(m.planFlow(base({ runs: [unknown] })).kind, 'reject');
}
async function judgeStop(factory) {
    const h = harness(factory);
    h.ports.invoke = async (owner, req) => { h.calls.push({ owner, req }); return { ok: false }; };
    const r = await h.act();
    assert.equal(r.ok, false);
    assert.equal(h.calls.length, 1);
}
async function judgeWrites(factory) {
    const h = harness(factory, { writeRuns: () => false });
    const r = await h.act();
    assert.equal(r.ok, false); assert.equal(h.calls.length, 0);
}
async function judgeRollback(factory) {
    const h = harness(factory);
    await h.act();
    const count = h.calls.length;
    h.ports.invoke = async (owner, req) => { h.calls.push({ owner, req }); return { ok: false }; };
    const r = await h.act('rollback');
    assert.equal(r.ok, false); assert.notEqual(r.state, 'rolledback');
    assert.equal(h.calls.length, count + 1);
    assert.equal(h.calls.at(-1).req.rollback, true);
}

test('v3890 A1 structure, keys, three levels and nine distinct states', () => {
    assert.equal(WF.WF_FLOWS.length, 2);
    assert.equal(WF.WF_STATE_KEYS.length, 9);
    assert.equal(new Set(Object.values(WF.WF_STATES).map(s => s.label)).size, 9);
    assert.deepEqual(WF.WF_LEVEL_KEYS, ['read', 'draft', 'write']);
    assert.equal(WF.WF_LEVELS.draft.writes, false);
    for (const f of WF.WF_FLOWS) for (const st of f.steps) {
        assert.ok(Array.isArray(st.in)); assert.ok(st.out);
        assert.ok(WF.WF_OWNERS[st.owner]);
        if (st.writes) assert.equal(WF.WF_OWNERS[st.owner].writable, true);
    }
    assert.ok(read('scripts/keys-audit.mjs').includes("key: 'wf_runs'"));
    assert.ok(read('config/storage.js').includes('/^wf_/'));
    assert.deepEqual(WF.workflowSelfCheck().problems, []);
});
test('v3890 A2 pure kernel and data-only view', () => {
    const src = read('config/workflow.js').replace(/\/\*[\s\S]*?\*\//g, '');
    for (const bad of ['localStorage', 'sessionStorage', 'document.', 'setTimeout', 'setInterval', 'new Date(', '.setItem(', 'storage.', 'window.', 'VirtualPhone']) assert.ok(!src.includes(bad), bad);
    assert.ok(src.includes("from './num-gate.js'"));
    const view = read('apps/workflow/workflow-view.js').replace(/\/\*[\s\S]*?\*\//g, '');
    for (const bad of ['eval(', 'new Function', 'srcdoc', 'storage.set', 'workflow.js']) assert.ok(!view.includes(bad), bad);
});
test('v3890 B1 same pure judges: dry-run, real payload and retry', () => { judgeDry(WF); judgePayload(WF); judgeRetry(WF); });
test('v3890 B2 unreadable and cross-scope fail closed', () => {
    assert.equal(WF.planFlow(base({ runs: null })).why, 'run-unreadable');
    assert.equal(WF.wfAppendRun(null, {}).runs, null);
    assert.equal(WF.planFlow(base({ scope: {} })).kind, 'reject');
    assert.equal(WF.planFlow(base({ runs: [{ flowId: 'resume-brief', runKey: 'r', state: 'done', scope: { chatId: 'other', branchKey: 'main' } }] })).why, 'scope-changed');
});
test('v3890 B3 real coordinator chains output, persists, replays after reconstruction', async () => {
    const h = harness(); const r = await h.act();
    assert.equal(r.ok, true); assert.equal(r.state, 'done');
    assert.equal(h.calls.length, 3);
    assert.equal(h.calls[1].req.payload.reads.brief.line, 'text');
    assert.equal(h.calls[2].req.payload.reads.brief.line, 'text');
    assert.equal(h.rows.length, 1); assert.equal(h.rows[0].steps.length, 3);
    h.runner = createWorkflowRunner(h.ports);
    assert.equal((await h.act()).ok, true); assert.equal(h.calls.length, 3);
    assert.equal(r.run.readback.phase, 'confirmed');
});
test('v3890 B4 failed step stops descendants and retry only invokes failed/pending', async () => {
    await judgeStop(createWorkflowRunner);
    const h = harness(); const original = h.ports.invoke;
    h.ports.invoke = async (owner, req) => owner === 'archive-draft' ? { ok: false } : original(owner, req);
    assert.equal((await h.act()).ok, false);
    h.ports.invoke = original;
    assert.equal((await h.act('resume')).ok, true);
    assert.deepEqual(h.calls.map(c => c.owner), ['resume-workbench', 'archive-draft', 'notify']);
});
test('v3890 B5 preview and unconfirmed run/undo never write', async () => {
    const h = harness();
    await h.act('preview'); await h.act('run', { confirm: false }); await h.act('rollback', { confirm: false });
    assert.equal(h.calls.length, 0); assert.equal(h.saves.length, 0);
});
test('v3890 B6 bad storage, corruption, owner throw stay fail-closed', async () => {
    await judgeWrites(createWorkflowRunner);
    const h = harness(); h.rows = null; assert.equal((await h.act()).ok, false); assert.equal(h.calls.length, 0);
    h.rows = []; h.ports.invoke = async owner => { if (owner === 'archive-draft') throw Error('unknown'); return { ok: true, value: { line: 'x' } }; };
    await h.act();
    assert.ok(h.rows[0].steps.some(s => s.state === 'running'));
    assert.equal((await h.act('resume')).ok, false);
});

test('v3890 B7 pause during owner await stops remaining steps then resumes', async () => {
    const h = harness(); let release; let started;
    const ready = new Promise(resolve => { started = resolve; });
    const original = h.ports.invoke;
    h.ports.invoke = async (owner, req) => {
        if (owner === 'resume-workbench') { started(); await new Promise(resolve => { release = resolve; }); }
        return original(owner, req);
    };
    const running = h.act(); await ready;
    assert.equal((await h.act('run')).ok, false);
    assert.equal((await h.act('pause')).ok, true); release();
    const paused = await running; assert.equal(paused.state, 'paused'); assert.equal(h.calls.length, 1);
    assert.equal((await h.act('resume')).ok, true); assert.equal(h.calls.length, 3);
});
test('v3890 B8 scope and epoch changes reject stale confirmation and awaited reply', async () => {
    for (const mode of ['scope', 'epoch']) {
        const h = harness(); const original = h.ports.invoke;
        h.ports.invoke = async (owner, req) => {
            const r = await original(owner, req);
            if (mode === 'scope') h.scope = { chatId: 'next', branchKey: 'main' }; else h.token++;
            return r;
        };
        assert.equal((await h.act()).ok, false);
        assert.equal(h.calls.length, 1); assert.equal(h.saves.length, 2);
        assert.equal((await h.act('resume')).ok, false);
    }
});
test('v3890 B9 reverse rollback consumes only explicit success receipts', async () => {
    await judgeRollback(createWorkflowRunner);
    const h = harness(); await h.act();
    assert.equal((await h.act('rollback')).state, 'rolledback');
    assert.deepEqual(h.calls.slice(3).map(c => c.owner), ['notify', 'archive-draft']);
    assert.ok(h.calls.slice(3).every(c => c.req.rollback === true));
    assert.equal((await h.act('resume')).ok, false);
});
test('v3890 B10 partial rollback cannot mark untouched writes undone', () => {
    const run = WF.applyFlowPlan(WF.planFlow(base()), ['read-brief', 'save-draft', 'notify'].map(stepId => ({ stepId, ok: true })));
    const partial = WF.wfAfterRollback(run, ['notify']);
    assert.equal(partial.state, 'partial');
    assert.equal(partial.steps.find(s => s.stepId === 'save-draft').state, 'ok');
    assert.deepEqual(WF.rollbackFlow(partial).undo.map(s => s.stepId), ['save-draft']);
});

// Extract actual host adapter, not a simulated replacement. Controlled context only.
function adapter(extra = {}, source = read('index.js')) {
    const a = source.indexOf('    function wfInvokeOwner(ownerKey, req) {');
    const b = source.indexOf('    function playWechatMessageSound', a);
    assert.ok(a >= 0 && b > a);
    const mem = {};
    const storage = { get: (k, d) => Object.hasOwn(mem, k) ? mem[k] : d, set: (k, v) => { mem[k] = v; return true; } };
    const vp = { _workflow: { scope } };
    const sandbox = { ...WF, ...RW, window: { VirtualPhone: vp }, storage, handoffEpoch: () => 1, refreshWorkflow: () => {}, ...extra };
    vm.createContext(sandbox);
    vm.runInContext(source.slice(a, b) + ';globalThis.invoke = wfInvokeOwner;', sandbox);
    return { mem, storage, vp, invoke: (owner, req = {}) => sandbox.invoke(owner, { scope, token: 1, ...req }) };
}
test('v3890 C1 actual archive owner checks saved, actual notification owner round trip and undo', () => {
    const a = adapter();
    const ar = new ArchiveApp(null, a.storage); a.vp.archiveApp = ar;
    ar.setTarget('old');
    const r = a.invoke('archive-draft', { payload: { reads: { brief: { line: 'new' } } } });
    assert.equal(r.ok, true); assert.equal(JSON.parse(a.mem.archive_draft).target, 'new');
    assert.equal(a.invoke('archive-draft', { rollback: true, receipt: r.receipt }).ok, true);
    assert.equal(JSON.parse(a.mem.archive_draft).target, 'old');
    a.vp.archiveApp = { drafts: () => ({ target: 'new' }), setTarget: () => ({ ok: true, saved: false }) };
    assert.equal(a.invoke('archive-draft', { payload: { reads: { brief: { line: 'new' } } } }).ok, false);
    const log = new NotificationLog(a.storage); a.vp.notificationLog = log;
    try {
        const n = a.invoke('notify', { idemKey: 'r1', payload: { reads: { brief: { line: 'summary' } } } });
        assert.equal(n.ok, true); assert.equal(log.list().length, 1);
        assert.equal(a.invoke('notify', { rollback: true, receipt: n.receipt }).ok, true);
        assert.equal(log.list().length, 0);
    } finally { log.dispose(); }
});
test('v3890 C2 null/error owner returns never count as success; undo cannot dispatch apply', () => {
    const a = adapter(); let pushes = 0;
    a.vp.notificationLog = { list: () => [], push: () => { pushes++; return { error: 'failed' }; } };
    assert.equal(a.invoke('notify', { payload: { reads: { brief: { line: 'x' } } } }).ok, false);
    assert.equal(a.invoke('notify', { rollback: true }).ok, false); assert.equal(pushes, 1);
    a.vp.calendarApp = { calendarView: { getStoryDateParts: () => ({}), toDateKey: () => '2026-01-01' }, calendarData: { getMemos: () => [], addMemo: () => null } };
    assert.equal(a.invoke('calendar', { payload: { reads: { ledger: { idemKey: 'x' } } } }).ok, false);
    assert.equal(a.invoke('constructor').ok, false);
});

/* --------- D 组：真源码定点破坏（破坏副本上同款判据必转红） --------- */
const NEG_SUFFIX = '.__neg__.js';
const madeFiles = [];
function anchorOnce(s, a) {
    assert.equal(s.split(a).length - 1, 1, '负控制锚点字面量必须恰中 1 次：' + JSON.stringify(a.slice(0, 40)));
    return s;
}
async function negCopy(rel, mutate) {
    const srcAbs = path.join(ROOT, rel);
    const dstRel = rel.replace(/\.js$/, NEG_SUFFIX);
    const dstAbs = path.join(ROOT, dstRel);
    const src = fs.readFileSync(srcAbs, 'utf8');
    const next = mutate(src);
    assert.notEqual(next, src, '破坏没有真正发生（锚点未命中）：' + rel);
    fs.writeFileSync(dstAbs, next);
    madeFiles.push(dstAbs);
    return import(pathToFileURL(dstAbs).href + '?neg=' + Date.now());
}
process.on('exit', () => {
    for (const f of madeFiles) { try { fs.rmSync(f); } catch (_e) { /* 忽略 */ } }
});
function runNeg(fn, m) {
    try { return fn(m) || { ok: false, why: '无返回' }; }
    catch (e) { return { ok: false, why: '破坏变体上直接抛：' + String((e && e.message) || e) }; }
}
async function runNegAsync(fn, m) {
    try { return (await fn(m)) || { ok: false, why: '无返回' }; }
    catch (e) { return { ok: false, why: '破坏变体上直接抛：' + String((e && e.message) || e) }; }
}
function judgeCrossScopeRejects(m) {
    const row = { flowId: 'resume-brief', runKey: 'r', state: 'done', scope: { chatId: 'other', branchKey: 'main' } };
    const p = m.planFlow(base({ runs: [row] }));
    if (p.why !== 'scope-changed') return { ok: false, why: '跨段同键没被判 scope-changed：' + p.kind + '/' + p.why };
    return { ok: true };
}
function judgeUnreadableNotZero(m) {
    if (m.planFlow(base({ runs: null })).why !== 'run-unreadable') return { ok: false, why: '台账读不到没被判 run-unreadable' };
    if (m.wfAppendRun(null, { flowId: 'f', runKey: 'k' }).runs !== null) return { ok: false, why: '台账读不到却写回了空账本' };
    return { ok: true };
}
function judgeUnknownNotRetried(m) {
    const plan = m.planFlow(base());
    const run = m.applyFlowPlan(plan, [{ stepId: 'read-brief', ok: true, value: { line: 'x' } }, { stepId: 'save-draft', uncertain: true }]);
    const again = m.planFlow(base({ runs: [{ ...run, runKey: 'r' }] }));
    if (again.kind !== 'reject') return { ok: false, why: '结果未知的运行被允许重跑：' + again.kind };
    return { ok: true };
}
function judgeReceiptsOnly(m) {
    const plan = m.planFlow(base());
    const run = m.applyFlowPlan(plan, ['read-brief', 'save-draft', 'notify'].map(stepId => ({ stepId, ok: true })));
    const ids = m.rollbackFlow(m.wfAfterRollback(run, ['notify'])).undo.map(s => s.stepId);
    if (ids.join(',') !== 'save-draft') return { ok: false, why: '已撤的写步仍被列为可撤：' + ids.join(',') };
    return { ok: true };
}
async function judgePause(factory) {
    const h = harness(factory); let release; let started;
    const ready = new Promise(resolve => { started = resolve; });
    const original = h.ports.invoke;
    h.ports.invoke = async (owner, req) => {
        if (owner === 'resume-workbench') { started(); await new Promise(resolve => { release = resolve; }); }
        return original(owner, req);
    };
    const running = h.act(); await ready;
    await h.act('pause'); release();
    const r = await running;
    if (r.state !== 'paused') return { ok: false, why: '暂停竞态没生效：' + r.state };
    if (h.calls.length !== 1) return { ok: false, why: '暂停后仍跑了后续步骤：' + h.calls.length };
    return { ok: true };
}
const negStop = (m) => judgeStop(m.createWorkflowRunner);
const negPause = (m) => judgePause(m.createWorkflowRunner);
const negWrites = (m) => judgeWrites(m.createWorkflowRunner);

test('v3890 D1. same idemKey across scopes is no longer rejected ⇒ cross-scope judge must go red', async () => {
    const neg = await negCopy('config/workflow.js', (s) => {
        const a = "    if (hit && !wfSameScope(hit.scope, inp.scope)) {";
        anchorOnce(s, a);
        return s.replace(a, "    if (false) {");
    });
    const r = runNeg(judgeCrossScopeRejects, neg);
    assert.equal(r.ok, false, '破坏副本上该判据必须转红，实际未转红：' + JSON.stringify(r));
});
test('v3890 D2. unreadable ledger is treated as empty ⇒ unreadable judge must go red', async () => {
    const neg = await negCopy('config/workflow.js', (s) => {
        const a = "    if (!runs.readable) {";
        anchorOnce(s, a);
        return s.replace(a, '    if (false) {');
    });
    const r = runNeg(judgeUnreadableNotZero, neg);
    assert.equal(r.ok, false, '破坏副本上该判据必须转红，实际未转红：' + JSON.stringify(r));
});
test('v3890 D3. unknown-outcome steps may be retried ⇒ unknown-not-retried judge must go red', async () => {
    const neg = await negCopy('config/workflow.js', (s) => {
        const a = "        if (!hit.steps.length || hit.state === 'rolledback' || hit.steps.some(s => s.state === 'running')) {";
        anchorOnce(s, a);
        return s.replace(a, "        if (!hit.steps.length || hit.state === 'rolledback') {");
    });
    const r = runNeg(judgeUnknownNotRetried, neg);
    assert.equal(r.ok, false, '破坏副本上该判据必须转红，实际未转红：' + JSON.stringify(r));
});
test('v3890 D4. already undone writes stay listed as undoable ⇒ receipts-only judge must go red', async () => {
    const neg = await negCopy('config/workflow.js', (s) => {
        const a = "    const done = steps.filter((s) => s.writes === true && (s.state === WF_STEP_STATES.ok || s.state === WF_STEP_STATES.replayed));";
        anchorOnce(s, a);
        return s.replace(a, "    const done = steps.filter((s) => s.writes === true);");
    });
    const r = runNeg(judgeReceiptsOnly, neg);
    assert.equal(r.ok, false, '破坏副本上该判据必须转红，实际未转红：' + JSON.stringify(r));
});
test('v3890 D5. a failed step no longer stops descendants ⇒ stop judge must go red', async () => {
    const neg = await negCopy('config/workflow-runtime.js', (s) => {
        const a = '                if (!ok) break;';
        anchorOnce(s, a);
        return s.replace(a, '                if (false) break;');
    });
    const r = await runNegAsync(negStop, neg);
    assert.equal(r.ok, false, '破坏副本上该判据必须转红，实际未转红：' + JSON.stringify(r));
});
test('v3890 D6. a requested pause no longer stops remaining steps ⇒ pause judge must go red', async () => {
    const neg = await negCopy('config/workflow-runtime.js', (s) => {
        const a = '                if (lock.paused) break;';
        anchorOnce(s, a);
        return s.replace(a, '                if (false) break;');
    });
    const r = await runNegAsync(negPause, neg);
    assert.equal(r.ok, false, '破坏副本上该判据必须转红，实际未转红：' + JSON.stringify(r));
});
test('v3890 D7. an unconfirmed checkpoint no longer blocks the owner call ⇒ write-gate judge must go red', async () => {
    const neg = await negCopy('config/workflow-runtime.js', (s) => {
        const a = "        if (!next.runs || ports.writeRuns(next.runs) === false) return false;";
        anchorOnce(s, a);
        return s.replace(a, '        if (!next.runs) return false;');
    });
    const r = await runNegAsync(negWrites, neg);
    assert.equal(r.ok, false, '破坏副本上该判据必须转红，实际未转红：' + JSON.stringify(r));
});
test('v3890 D8. self-proof: the mutant copy is really loaded and untouched judges still hold', async () => {
    const neg = await negCopy('config/workflow.js', (s) => {
        const a = '    if (!runs.readable) {';
        anchorOnce(s, a);
        return s.replace(a, '    if (false) {');
    });
    assert.notEqual(neg.WF_FLOWS, WF.WF_FLOWS, '破坏副本必须是真的另一份模块实例');
    assert.equal(neg.WF_FLOWS.length, WF.WF_FLOWS.length);
    /* 这一处破坏恰好能被模块自己的自检抓到：更硬的证据（两份独立判据同源转红）。 */
    assert.ok(neg.workflowSelfCheck().problems.length > 0, '破坏副本的自检必须报出问题');
    assert.deepEqual(WF.workflowSelfCheck().problems, [], '原版自检不得报错');
    const clean = runNeg(judgeCrossScopeRejects, WF);
    assert.equal(clean.ok, true, '未触及的判据在原版上仍须成立：' + JSON.stringify(clean));
});
