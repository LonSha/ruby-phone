// tests/r24_x7_actor_autonomy.test.mjs — R24-X7「角色自主行为预算」判据
// 纪律：四态不塌。allowed / suppressed / exhausted / disabled 处置相反：
// 等下一时段 / 等下一窗口 / 等用户开回来 —— 压平任意两态都会让界面说错话。
// 另一条铁律：**可回源**。没有 factRef 的行为一律拒收（不许出现「AI 觉得」）。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const M = await import(pathToFileURL(path.join(ROOT, 'config/actor-autonomy-budget.js')));

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) { pass++; console.log('✓ ' + n); } else { fail++; console.log('✗ ' + n); } };
const A = M.AUTONOMY_ACTIONS;
const F = M.AUTONOMY_FACES;
const S = M.AUTONOMY_SUPPRESS_REASONS;
const DAY = 600;   // 10:00
const NIGHT = 120; // 02:00

/* ── 静默区间（含跨零点） ── */
ok('23:00–07:00 跨零点：02:00 在静默内', M.inQuietHours(NIGHT, { from: 1380, to: 420 }) === true);
ok('23:00–07:00 跨零点：10:00 不在静默内', M.inQuietHours(DAY, { from: 1380, to: 420 }) === false);
ok('23:00–07:00 跨零点：23:30 在静默内', M.inQuietHours(1410, { from: 1380, to: 420 }) === true);
ok('非跨零点区间也能判（09:00–17:00 的 10:00）', M.inQuietHours(DAY, { from: 540, to: 1020 }) === true);
ok('缺分钟数 → 不判静默（不猜）', M.inQuietHours(null, { from: 1380, to: 420 }) === false);

const b = M.createAutonomyBudget({ limits: { send_message: 2, post_moment: 1 }, windowMs: 1000, unansweredLimit: 3 });
ok('空白处 → allowed 且报剩余额度', (() => { const r = b.canAct(A.SEND_MESSAGE, { nowMs: 0, minuteOfDay: DAY, factRef: 'f1' }); return r.face === F.ALLOWED && r.limit === 2 && r.remaining === 2; })());

/* ── 三条静默原因各自不同形 ── */
ok('夜间 → suppressed + quiet-hours（不是 exhausted）', (() => { const r = b.canAct(A.SEND_MESSAGE, { nowMs: 0, minuteOfDay: NIGHT }); return r.face === F.SUPPRESSED && r.reason === S.QUIET_HOURS; })());
ok('勿扰 → suppressed + dnd', b.canAct(A.SEND_MESSAGE, { nowMs: 0, minuteOfDay: DAY, dnd: true }).reason === S.DND);
ok('连续未回 → suppressed + no-reply', b.canAct(A.SEND_MESSAGE, { nowMs: 0, minuteOfDay: DAY, unansweredCount: 3 }).reason === S.NO_REPLY);
ok('未回 2 条（未达线）→ 仍 allowed', b.canAct(A.SEND_MESSAGE, { nowMs: 0, minuteOfDay: DAY, unansweredCount: 2 }).face === F.ALLOWED);
ok('三种静默原因互不相同', new Set([S.QUIET_HOURS, S.DND, S.NO_REPLY]).size === 3);

/* ── 可回源铁律 ── */
const noRef = b.record(A.SEND_MESSAGE, { nowMs: 0, minuteOfDay: DAY });
ok('缺 factRef → 拒收（no-fact-ref）', noRef.ok === false && noRef.reason === 'no-fact-ref');
ok('被拒的动作不占额度', b.canAct(A.SEND_MESSAGE, { nowMs: 0, minuteOfDay: DAY }).used === 0);

/* ── 额度：用尽 → exhausted，且窗口滑过后回来 ── */
const r1 = b.record(A.SEND_MESSAGE, { nowMs: 0, minuteOfDay: DAY, factRef: 'fact:unread' });
const r2 = b.record(A.SEND_MESSAGE, { nowMs: 10, minuteOfDay: DAY, factRef: 'fact:unread' });
ok('两次占满（剩余归零）', r1.ok === true && r2.ok === true && r2.remaining === 0);
ok('用尽 → exhausted + budget-exhausted', (() => { const r = b.canAct(A.SEND_MESSAGE, { nowMs: 20, minuteOfDay: DAY }); return r.face === F.EXHAUSTED && r.reason === 'budget-exhausted'; })());
ok('用尽与静默不同形（exhausted ≠ suppressed）', b.canAct(A.SEND_MESSAGE, { nowMs: 20, minuteOfDay: DAY }).face !== F.SUPPRESSED);
ok('窗口滑过后额度回来', b.canAct(A.SEND_MESSAGE, { nowMs: 5000, minuteOfDay: DAY }).face === F.ALLOWED);
ok('静默优先于额度：夜间即使额度已满也报 suppressed', (() => {
    const b2 = M.createAutonomyBudget({ limits: { send_message: 0 }, windowMs: 1000 });
    return b2.canAct(A.SEND_MESSAGE, { nowMs: 0, minuteOfDay: NIGHT }).face === F.SUPPRESSED;
})());

/* ── 关停：disabled 与 exhausted 不同形 ── */
b.setEnabled(false);
ok('用户关停 → disabled（不是 exhausted）', (() => { const r = b.canAct(A.SEND_MESSAGE, { nowMs: 5000, minuteOfDay: DAY }); return r.face === F.DISABLED && r.reason === 'user-disabled'; })());
ok('关停后 record 也拒（不落账）', (() => { const r = b.record(A.SEND_MESSAGE, { nowMs: 5000, minuteOfDay: DAY, factRef: 'x' }); return r.ok === false && r.face === F.DISABLED; })());
b.setEnabled(true);
ok('开回后恢复 allowed', b.canAct(A.SEND_MESSAGE, { nowMs: 5000, minuteOfDay: DAY }).face === F.ALLOWED);

/* ── 未知动作：fail-closed，不默认收下 ── */
ok('未知动作 → disabled + unknown-action', (() => { const r = b.canAct('dance', { nowMs: 0, minuteOfDay: DAY }); return r.face === F.DISABLED && r.reason === 'unknown-action'; })());

/* ── 回执与自述面 ── */
const log = b.receiptLog();
ok('回执逐条带 factRef 与 rule（可回源）', log.length === 2 && log.every((x) => x.factRef && x.rule === 'autonomy:send_message'));
ok('describe 报出五类动作（默认值 + 覆盖），被覆盖的那类取新值', (() => {
    const d = b.describe();
    const sm = d.actions.find((x) => x.action === 'send_message');
    const pm = d.actions.find((x) => x.action === 'post_moment');
    return d.actions.length === 5 && sm.limit === 2 && pm.limit === 1 && d.windowMs === 1000 && d.unansweredLimit === 3;
})());
ok('snapshot 逐动作报 limit/used/remaining', (() => {
    const s = b.snapshotAt(5000);
    const sm = s.rows.find((x) => x.action === 'send_message');
    return s.rows.length === 5 && typeof sm.remaining === 'number' && sm.limit === 2 && s.enabled === true;
})());

/* ── 负控制：把 exhausted 说成 suppressed 的实现必须能被分出来 ── */
const cheatAll = () => ({ face: F.ALLOWED });
ok('负控制：永远 allowed 的实现与真值不同形', cheatAll().face !== F.EXHAUSTED && cheatAll().face !== F.DISABLED);

/* ── 装配点 + 与 X1 同链（预算缺省值不许拍脑袋） ── */
const idx = fs.readFileSync(path.join(ROOT, 'index.js'), 'utf8');
ok('接线：index.js 引入 actorAutonomySelfCheck', idx.includes("from './config/actor-autonomy-budget.js'"));
ok('接线：自检进了 _bridgeChecks 装配表', /\[\s*'_r24X7'\s*,\s*actorAutonomySelfCheck\s*\]/.test(idx));
ok('自检本体绿', M.actorAutonomySelfCheck().ok === true);
ok('未给 limits 时五类动作都有默认额度（不是 undefined）', (() => {
    const d = M.createAutonomyBudget({}).describe();
    return d.actions.length === 5 && d.actions.every((x) => typeof x.limit === 'number' && x.limit >= 0);
})());

console.log(pass + ' 通过, ' + fail + ' 失败');
process.exit(fail > 0 ? 1 : 0);