/** R-X5 execution coordinator. Ports own all I/O; no user code is interpreted.
 * Checkpoint before effects, receipts after effects. Unknown effects never auto-retry. */
import { WF_RUNS_MAX, wfRunsOf, wfAppendRun, wfSameScope, previewFlow, planFlow,
    applyFlowPlan, pauseFlow, rollbackFlow, wfAfterRollback, readbackFlow, wfSummaryLine } from './workflow.js';

export function createWorkflowRunner(ports) {
    let active = null;
    const result = (ok, note, run = null, kind = '') => ({ ok, note, state: run ? run.state : '', run, kind });
    const live = (scope, token) => wfSameScope(scope, ports.scope()) && token === ports.token();
    const checkpoint = (rec, token) => {
        if (!live(rec.scope, token)) return false;
        const current = ports.readRuns();
        const next = wfAppendRun(current, rec, WF_RUNS_MAX);
        if (!next.runs || ports.writeRuns(next.runs) === false) return false;
        if (!live(rec.scope, token)) return false;
        const back = ports.readRuns();
        const same = JSON.stringify(back) === JSON.stringify(next.runs);
        rec.readback = readbackFlow(rec, { readOk: Array.isArray(back), same });
        ports.publish(rec);
        return same;
    };
    async function act(action = {}) {
        const kind = action.action || 'preview';
        if (!['preview', 'run', 'pause', 'resume', 'rollback'].includes(kind)) return result(false, '未知动作');
        const scope = ports.scope();
        const token = ports.token();
        const input = ports.inputs();
        const raw = ports.readRuns();
        const norm = wfRunsOf(raw);
        const flowId = String(action.flowId || '');
        if (kind === 'preview') {
            const pv = previewFlow({ flowId, scope, inputs: input });
            return result(!pv.blocked, pv.blocked ? pv.problems.join(' / ') : '预览就绪，不写入', pv, kind);
        }
        if (!wfSameScope(action.scope, scope) || action.token !== token) return result(false, '会话或世代已变，请重新预览并确认');
        if (kind === 'pause') {
            if (!active || active.flowId !== flowId || !live(active.scope, active.token)) return result(false, '没有执行中的同段流程');
            active.paused = true;
            return result(true, '暂停已请求：当前步骤结束后停止，未运行步骤保留', active.run, kind);
        }
        if (action.confirm !== true) return result(false, '默认 dry-run：写操作需显式确认');
        if (active) return result(false, '已有流程执行中，请等待或暂停');
        if (!norm.readable || norm.dropped) return result(false, '运行台账不可可靠读取，不自动重跑');
        const previous = norm.entries.find(r => r.flowId === flowId && (!action.runKey || r.runKey === action.runKey));
        if (previous && !wfSameScope(previous.scope, scope)) return result(false, '旧运行不属于当前会话或分支');
        if ((kind === 'resume' || kind === 'rollback') && !previous) return result(false, '没有可恢复的运行');
        const runKey = String(action.runKey || (previous && previous.runKey) || ports.newKey());
        const lock = { flowId, scope, token, paused: false, run: previous || null };
        active = lock;
        try {
            if (kind === 'rollback') {
                if (previous.steps.some(s => s.state === 'running')) return result(false, '存在结果未知的步骤，先人工核对');
                const rb = rollbackFlow(previous);
                if (!rb.count) return result(false, '没有可撤销的写步', previous, kind);
                let rec = previous;
                for (const undo of rb.undo) {
                    if (!live(scope, token)) return result(false, '会话已变，停止回滚');
                    const before = rec;
                    rec = Object.assign({}, rec, { state: 'running', steps: rec.steps.map(s =>
                        s.stepId === undo.stepId ? Object.assign({}, s, { state: 'running' }) : s) });
                    if (!checkpoint(rec, token)) return result(false, '回滚检查点未确认，未继续撤销', rec, kind);
                    let out;
                    try { out = await ports.invoke(undo.owner, { rollback: true, receipt: undo.receipt, scope, token, stepId: undo.stepId }); }
                    catch (e) { return result(false, '回滚结果未知：' + String(e.message || e), rec, kind); }
                    if (!live(scope, token)) return result(false, '会话已变，旧回执未写入新会话');
                    if (!out || out.ok !== true) {
                        rec = before; checkpoint(rec, token);
                        return result(false, (out && out.note) || 'owner 拒绝撤销', rec, kind);
                    }
                    rec = wfAfterRollback(before, [undo.stepId]);
                    if (!rollbackFlow(rec).count) rec.state = 'rolledback';
                    if (!checkpoint(rec, token)) return result(false, '撤销检查点未确认，停止', rec, kind);
                }
                return result(true, '已按收据逆序撤销本次写步', rec, kind);
            }
            const plan = planFlow({ flowId, scope, inputs: input, runs: raw, runKey, confirm: true, at: ports.now() });
            plan.runKey = runKey;
            if (plan.kind === 'reject') return result(false, '开不了工：' + plan.why, null, plan.kind);
            if (plan.kind === 'replay') {
                const rec = previous || applyFlowPlan(plan, []);
                ports.publish(rec);
                return result(rec.state === 'done', '已有运行记录，不重复执行', rec, plan.kind);
            }
            const results = [];
            const available = Object.assign({}, input);
            let rec = applyFlowPlan(plan, results);
            rec.state = 'running';
            lock.run = rec;
            if (!checkpoint(rec, token)) return result(false, '运行检查点未确认，未调用 owner', rec, kind);
            for (const it of plan.steps) {
                if (!it.run) { available[it.out] = it.previous && it.previous.value; continue; }
                if (!live(scope, token)) return result(false, '会话已变，停止后续写入');
                if (lock.paused) break;
                const reads = {};
                for (const key of it.in) reads[key] = available[key];
                if (it.in.some(key => reads[key] === undefined || reads[key] === null)) break;
                const pending = Object.assign({}, rec, { state: 'running', steps: rec.steps.map(s =>
                    s.stepId === it.stepId ? Object.assign({}, s, { state: 'running' }) : s) });
                if (!checkpoint(pending, token)) return result(false, '写前检查点未确认，停止', pending, kind);
                let out;
                try {
                    out = await ports.invoke(it.owner, { payload: { reads }, stepId: it.stepId,
                        flowId, scope, token, idemKey: plan.idemKey + ':' + it.stepId });
                } catch (e) { out = { ok: false, uncertain: it.writes, note: 'owner 抛错：' + String(e.message || e) }; }
                if (!live(scope, token)) return result(false, '会话已变，旧回执未写入新会话');
                const ok = !!out && out.ok === true;
                results.push({ stepId: it.stepId, ok, uncertain: !!out && out.uncertain === true,
                    detail: (out && out.note) || 'owner 未完成', value: out && out.value, receipt: out && out.receipt });
                rec = applyFlowPlan(plan, results); lock.run = rec;
                if (!checkpoint(rec, token)) return result(false, '步骤结果未确认，停止后续执行', rec, kind);
                if (!ok) break;
                available[it.out] = out.value;
                // Yield between synchronous owners so pause clicks can be delivered.
                await ports.yieldStep();
            }
            if (lock.paused && rec.state !== 'done') rec = pauseFlow(rec);
            if (!live(scope, token)) return result(false, '会话已变，旧运行未回写');
            if (!checkpoint(rec, token)) return result(false, '最终台账未确认', rec, kind);
            return result(rec.state === 'done', wfSummaryLine(rec), rec, kind);
        } finally { if (active === lock) active = null; }
    }
    return { act };
}
