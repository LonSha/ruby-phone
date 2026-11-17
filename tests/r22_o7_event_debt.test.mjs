// R22-O7 事件欠账移出判据
// 判两件事：①debt 真空了；②移出的 5 条每条都有 kind/why/evidence，且它们仓内确实无订阅方。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const J = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests/audit/event_subscribers.json'), 'utf8'));

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) { pass++; console.log("✓ " + n); } else { fail++; console.log("✗ " + n); } };

const reclass = J.reclassified || [];

ok("debt 已清空", Array.isArray(J.debt) && J.debt.length === 0);
ok("移出条数 = 5", reclass.length === 5);

const kindsOk = reclass.every((r) => r.kind === "telemetry" || r.kind === "cross-repo");
ok("每条都标了 kind（telemetry / cross-repo）", kindsOk);

const whyOk = reclass.every((r) => r.why && String(r.why).trim().length > 0);
ok("每条都有 why", whyOk);

const evOk = reclass.every((r) => r.evidence && String(r.evidence).trim().length > 0);
ok("每条都有 evidence（改判不是免单）", evOk);

// 反向闸：被移出的事件在仓内必须真的没有订阅方，否则「移出」就是掩盖
const byEvent = new Map((J.events || []).map((e) => [e.event, e]));
const cheated = reclass.filter((r) => {
    const row = byEvent.get(r.event);
    return row && row.on > 0;
});
ok("负控制：被移出的事件仓内订阅方仍为 0", cheated.length === 0);

// 旧字段与新结构必须同源（同内容两份账本身就是本仓治过的病）
const legacy = J.debtLedger || {};
const sameContent = reclass.every((r) => legacy[r.event] === r.why);
ok("debtLedger 与 reclassified 同源", sameContent);

// 事件契约没被这次改动改小
ok("契约事件数 ≥ 26", (J.contractSize || 0) >= 26);

console.log(pass + " 通过, " + fail + " 失败");
process.exit(fail > 0 ? 1 : 0);