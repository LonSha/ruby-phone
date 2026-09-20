/* ============================================================
 * RubyPhone v2.41.0 —— 零消费导出门禁 + 两处接线 + 事件落账
 *
 * 本版问题：本仓反复出现「机制建好却零消费」的欠债（v2.12 首 chunk 屏障 /
 *   v2.26-2.27 运行时登记制 / v2.34 重复存活域 / v2.35 对外世界桥 /
 *   v2.38 世界书随机 / v2.39 群聊发言调度），每一次都是事后治，
 *   而**没有任何一道门能拦住新的一例**。
 *
 * 本版三件事：
 *   ① scripts/dead-export-check.mjs —— 零消费导出门禁（冻结账本，防静默腐烂）
 *   ② 两处低风险接线：severityLabel 单一真源 / makePhoneEvent 派发侧接入
 *   ③ phone-events 落账 + 契约报告，并接进 index.js 诊断面
 * ============================================================ */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import os from 'node:os';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
    if (cond) { pass++; console.log(`\u2713 ${name}`); }
    else { fail++; console.log(`\u2717 ${name} ${detail}`); }
};
const read = f => fs.readFileSync(path.join(root, f), 'utf8');

const PE = await import(path.join(root, 'config/phone-events.js'));

/* ========== A. 门禁脚本存在且结构健康 ========== */
{
    const src = read('scripts/dead-export-check.mjs');
    ok('A1 门禁脚本存在且非空', src.length > 3000, `${src.length}`);
    ok('A2 三档退出语义齐备（0 通过 / 1 新增死导出 / 2 结构漂移）',
        /process\.exit\(0\)/.test(src) && /process\.exit\(fail\)/.test(src) && /process\.exit\(2\)/.test(src));
    ok('A3 有结构下限（防探测器失效后以全绿通过）', /MIN_EXPORTS/.test(src));
    ok('A4 有夹具通道（负控制可跑）', /RP_DEAD_EXPORT_FIXTURE/.test(src));
    ok('A5 基线账本为冻结账本（新增未登记即红灯）', /无新增零消费导出/.test(src));
    ok('A6 scripts/ 参与扫描（它是产品侧基建，不是豁免区）',
        !/SKIP_DIRS\s*=\s*\[[^\]]*'scripts'/.test(src));
}

/* ========== B. 冻结账本可用且有理由 ========== */
{
    const raw = JSON.parse(read('scripts/dead-export-baseline.json'));
    ok('B1 账本结构齐备', typeof raw.note === 'string' && Array.isArray(raw.entries));
    ok('B2 账本条目 ≥ 1（真实仓库确有已知死导出）', raw.entries.length >= 1, `${raw.entries.length}`);
    ok('B3 每条都写了非空理由', raw.entries.every(e => typeof e.reason === 'string' && e.reason.trim().length > 4));
    ok('B4 无 TODO 占位残留', !raw.entries.some(e => /^TODO/.test(e.reason)));
    ok('B5 条目键唯一（file::name 不重复）',
        new Set(raw.entries.map(e => `${e.file}::${e.name}`)).size === raw.entries.length);
}

/* ========== C. 负控制：真源码破坏 → 在副本上重跑同款判据 ========== */
{
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'deq-'));
    fs.mkdirSync(path.join(tmp, 'scripts'), { recursive: true });
    fs.mkdirSync(path.join(tmp, 'a'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'scripts/dead-export-baseline.json'),
        JSON.stringify({ note: '', entries: [] }));
    // 真源码破坏：新增一个零消费导出
    fs.writeFileSync(path.join(tmp, 'a/mod.js'),
        'export const USED_ONE = 1;\nexport const DEAD_ONE = 2;\n');
    fs.writeFileSync(path.join(tmp, 'main.js'),
        'import { USED_ONE } from "./a/mod.js";\nconsole.log(USED_ONE);\n');
    const run = extraEnv => spawnSync(process.execPath,
        [path.join(root, 'scripts/dead-export-check.mjs'), '--root', tmp],
        { encoding: 'utf8', env: { ...process.env, ...extraEnv } });

    const r1 = run({ RP_DEAD_EXPORT_FIXTURE: '1' });
    ok('C1 合成夹具检出未登记零消费导出 → exit 1', r1.status === 1, `status=${r1.status}`);
    ok('C2 报出具体符号名（可定位，不是只报数）', /DEAD_ONE/.test(r1.stdout + r1.stderr));
    ok('C3 已消费的导出不被误报（无假阳性）', !/USED_ONE/.test(r1.stdout + r1.stderr));

    // 破坏遍历/抽取器：抬高下限即可模拟「探测器失效」
    const r2 = run({});
    ok('C4 结构下限生效：扫描面过小 → exit 2 fail-closed', r2.status === 2, `status=${r2.status}`);

    const r3 = spawnSync(process.execPath,
        [path.join(root, 'scripts/dead-export-check.mjs'), '--root', path.join(tmp, 'nope')],
        { encoding: 'utf8' });
    ok('C5 路径不存在 → exit 2（不静默通过）', r3.status === 2, `status=${r3.status}`);

    // 登记之后应当转绿（证明红灯来自「未登记」本身，而非固定红）
    const upd = spawnSync(process.execPath,
        [path.join(root, 'scripts/dead-export-check.mjs'), '--update', '--root', tmp],
        { encoding: 'utf8', env: { ...process.env, RP_DEAD_EXPORT_FIXTURE: '1' } });
    ok('C6 --update 在夹具下可登记', upd.status === 0, `status=${upd.status}`);
    const r4 = run({ RP_DEAD_EXPORT_FIXTURE: '1' });
    ok('C7 登记后同判据转通过（红灯非固定）', r4.status === 0, `status=${r4.status}`);
    fs.rmSync(tmp, { recursive: true, force: true });

    const live = spawnSync(process.execPath,
        [path.join(root, 'scripts/dead-export-check.mjs')], { encoding: 'utf8' });
    ok('C8 真实仓库在门禁下通过', live.status === 0, `status=${live.status}`);
    ok('C9 真实仓库扫描面 ≥ 170 文件（防遍历退化）',
        /\u626b\u63cf (\d+) \u4e2a\u6587\u4ef6/.test(live.stdout) &&
        Number(/(\d+) \u4e2a\u6587\u4ef6/.exec(live.stdout + live.stderr)[1]) >= 170,
        live.stdout.split('\n')[0]);
}

/* ========== D. 接线①：severityLabel 单一真源 ========== */
{
    const mc = read('apps/health/medical-core.js');
    ok('D1 medical-core 导出 severityLabel', /export function severityLabel\b/.test(mc));
    const hv = read('apps/health/health-view.js');
    const hd = read('apps/health/health-data.js');
    ok('D2 health-view 已 import severityLabel', /import \{[^}]*severityLabel[^}]*\} from '\.\/medical-core\.js'/.test(hv));
    ok('D3 health-data 已 import severityLabel', /import \{[^}]*severityLabel[^}]*\} from '\.\/medical-core\.js'/.test(hd));
    ok('D4 health-view 不再手写严重度三元链', !/'mild'\s*\?\s*'\u8f7b\u5ea6'/.test(hv));
    ok('D5 health-data 不再手写严重度三元链', !/'mild'\s*\?\s*'\u8f7b\u5ea6'/.test(hd));
    const mod = await import(path.join(root, 'apps/health/medical-core.js'));
    ok('D6 severityLabel 行为：已登记档位中文化', mod.severityLabel('mild') === '\u8f7b\u5ea6' && mod.severityLabel('critical') === '\u5371\u91cd');
    ok('D7 severityLabel 行为：未知档位回落「未定」（不吐英文原文）', mod.severityLabel('zzz') === '\u672a\u5b9a');
}

/* ========== E. 接线②：派发侧接入契约 ========== */
{
    const idx = read('index.js');
    ok('E1 index.js 已导入 makePhoneEvent', /import \{[^}]*makePhoneEvent[^}]*\} from '\.\/config\/phone-events\.js'/.test(idx));
    ok('E2 index.js 无残留手写 phone: 派发字面量（注释除外）',
        !/new CustomEvent\('phone:/.test(idx.replace(/\/\/.*$/gm, '')));
    const disp = idx.match(/makePhoneEvent\((PHONE_EVENTS\.[A-Z_]+)/g) || [];
    ok('E3 派发侧全部走契约常量（不再手写字面量）', disp.length >= 7 && disp.every(d => /^makePhoneEvent\(PHONE_EVENTS\./.test(d)), `sites=${disp.length}`);
}

/* ========== F. 落账 + 契约报告 ========== */
{
    PE.resetPhoneEventFireLog();
    const ev = PE.makePhoneEvent(PE.PHONE_EVENTS.OPEN_APP, { appId: 'x' });
    ok('F1 makePhoneEvent 仍产出正确 type', ev && ev.type === PE.PHONE_EVENTS.OPEN_APP);
    ok('F2 makePhoneEvent detail 恒为对象', typeof ev.detail === 'object' && ev.detail !== null);

    let rep = PE.phoneEventFireReport();
    ok('F3 报告结构齐备',
        typeof rep.contractSize === 'number' && typeof rep.fired === 'object' &&
        Array.isArray(rep.neverFired) && typeof rep.unknownFired === 'object' &&
        Array.isArray(rep.unknownDomains) && Array.isArray(rep.targetDomains) &&
        typeof rep.ok === 'boolean');
    ok('F4 contractSize 等于契约事件数', rep.contractSize === Object.keys(PE.PHONE_EVENTS).length);
    ok('F5 已登记派发进 fired', rep.fired[PE.PHONE_EVENTS.OPEN_APP] === 1);
    ok('F6 neverFired 列出契约内未派发的其余事件',
        rep.neverFired.length === rep.contractSize - 1 &&
        !rep.neverFired.includes(PE.PHONE_EVENTS.OPEN_APP));
    ok('F7 干净态 ok=true（无未登记派发）', rep.ok === true);

    PE.makePhoneEvent('phone:\u672a\u767b\u8bb0\u540d', {});
    rep = PE.phoneEventFireReport();
    ok('F8 未登记名落入 unknownFired（可定位谁在私自扩大协议）',
        rep.unknownFired['phone:\u672a\u767b\u8bb0\u540d'] === 1);
    ok('F9 有未登记派发时 ok=false', rep.ok === false);
    ok('F10 unknownDomains 给出未登记名清单',
        rep.unknownDomains.includes('phone:\u672a\u767b\u8bb0\u540d'));

    PE.resetPhoneEventFireLog();
    rep = PE.phoneEventFireReport();
    ok('F11 resetPhoneEventFireLog 清空落账',
        Object.keys(rep.fired).length === 0 && Object.keys(rep.unknownFired).length === 0);
    ok('F12 复位后 ok 回到 true', rep.ok === true);

    // 落账不得阻断派发（派发路径在 UI 热路径上）
    PE.resetPhoneEventFireLog();
    const before = PE.phoneEventFireReport().contractSize;
    const e2 = PE.makePhoneEvent(PE.PHONE_EVENTS.GO_HOME, {});
    ok('F13 落账不改变派发返回值（契约面不阻断运行）', e2.type === PE.PHONE_EVENTS.GO_HOME && before > 0);
    PE.resetPhoneEventFireLog();
}

/* ========== G. 诊断面接入 ========== */
{
    const idx = read('index.js');
    ok('G1 index.js 导入 phoneEventFireReport', /import \{[^}]*phoneEventFireReport[^}]*\}/.test(idx));
    ok('G2 index.js 导入 resetPhoneEventFireLog', /import \{[^}]*resetPhoneEventFireLog[^}]*\}/.test(idx));
    ok('G3 getRuntimeStats 提升 eventContract 字段', /snap\.eventContract\s*=\s*phoneEventFireReport\(\)/.test(idx));
    ok('G4 诊断入口异常时字段恒在（消费方不必判 undefined）',
        /eventContract: \{ contractSize: 0/.test(idx));
    ok('G5 两处清数据路径都复位落账（否则污染下一会话）',
        (idx.match(/try \{ resetPhoneEventFireLog\(\); \}/g) || []).length === 2);
}

console.log(`\n\u7ed3\u679c: ${pass} \u901a\u8fc7, ${fail} \u5931\u8d25`);
process.exit(fail > 0 ? 1 : 0);
