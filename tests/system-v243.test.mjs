/* ============================================================
 * RubyPhone v2.43.0 —— 零消费导出门禁 E7：`export { ... }` 跨行块必须被枚举
 *
 * 本版问题：v2.42.0 把消费判定修成「基于真代码」，但**枚举面**还漏着一整类写法。
 *   `exportsOf` 用单行正则 `export\s*\{([^}]*)\}` 取键，于是
 *     export {
 *       a,
 *       b,
 *     };
 *   这种多行成块转出**整块 0 枚举**——文件里声明的导出在门禁眼里根本不存在，
 *   块内的死导出既不报红灯也不进账本（fail-open 静默放行）。
 *
 * 实测：config/drives-engine.js 真实导出 7 项，门禁只枚举到 1 项（多行块里 6 项全隐形）。
 * 夹具：导出 2 项（1 真消费 + 1 真死）的多行块文件被报成「0 个 export 声明」并 exit 0。
 *
 * 同轮还修掉两个与它咬合的静默点（都属「判据的输入面必须与结论面同一件事」）：
 *   ① 跨行块只跳首行 ⇒ 成员行 `a,` / `b,` 自身含名字，块内每个名字都被算成「已消费」；
 *   ② 「声明行」不等于「export 行」⇒ `function X(){} export { X }` 里 X 的声明行把它自己
 *      算成「内部消费」，零消费的真死导出被静默隐藏。
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
const GATE = path.join(root, 'scripts/dead-export-check.mjs');
const runGate = (args, env = {}) => spawnSync(process.execPath, [GATE, ...args],
    { encoding: 'utf8', env: { ...process.env, ...env } });
const FIX = { RP_DEAD_EXPORT_FIXTURE: '1' };
const mkFixture = (files) => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dex243-'));
    fs.mkdirSync(path.join(tmp, 'scripts'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'scripts/dead-export-baseline.json'),
        JSON.stringify({ note: '', entries: [] }));
    for (const [rel, body] of Object.entries(files)) {
        const p = path.join(tmp, rel);
        fs.mkdirSync(path.dirname(p), { recursive: true });
        fs.writeFileSync(p, body);
    }
    return tmp;
};
/** 汇总行解析（普通判定模式带括号统计） */
const summary = (out) => {
    // 普通判定模式：一行带括号统计
    let m = /扫描 (\d+) 个文件 \/ (\d+) 个 export 声明（内部消费 (\d+) · 跨文件消费 (\d+) · 零消费 (\d+)）/.exec(out);
    if (m) return { files: +m[1], total: +m[2], internal: +m[3], cross: +m[4], dead: +m[5] };
    // --list 模式：统计拆成两行（扫描面 / 消费面）
    const h = /扫描 (\d+) 个文件 \/ (\d+) 个 export 声明/.exec(out);
    const t = /内部消费 (\d+) · 跨文件消费 (\d+) · 零消费 (\d+)/.exec(out);
    if (h && t) return { files: +h[1], total: +h[2], internal: +t[1], cross: +t[2], dead: +t[3] };
    return null;
};

/* ========== A. 门禁结构：E7 落地 ========== */
{
    const src = read('scripts/dead-export-check.mjs');
    ok('A1 已废弃单行 brace 正则（BRACE_RE 不再存在）', !/BRACE_RE/.test(src));
    ok('A2 见到 `export {` 即向后累积到 `}`（跨行块）',
        /\/\^\\s\*export\\s\*\\\/\{\//.test(src) || /acc\.indexOf\('\}'\) < 0/.test(src));
    ok('A3 记录整段导出语句区间 declEnd', /declEnd/.test(src));
    ok('A4 内部消费扫描跳过整个语句区间（含跨行块成员行）',
        /i >= e\.declLine && i <= stmtEnd/.test(src));
    ok('A5 跳过本名字的声明行（声明不算消费）', /declRe\.test\(codeLines\[i\]\)/.test(src));
    ok('A6 文档头登记了 E7 与两个配套静默点',
        /E7/.test(src) && /跨行/.test(src) && /声明行/.test(src));
}

/* ========== B. 夹具负控制：跨行 export {} 里的死导出必须被判死 ========== */
{
    const LIB = [
        'function used() { return 1; }',
        'function deadMultiline() { return 2; }',
        'export {',
        '  used,',
        '  deadMultiline,',
        '};',
    ].join('\n') + '\n';
    const USER = "import { used } from './m/lib.js';\nconsole.log(used());\n";
    const tmp = mkFixture({ 'm/lib.js': LIB, 'main.js': USER });

    const listed = runGate(['--list', '--root', tmp], FIX);
    const out = listed.stdout + listed.stderr;
    const s = summary(out) || summary(runGate(['--root', tmp], FIX).stdout + runGate(['--root', tmp], FIX).stderr);
    ok('B1 跨行块被枚举（此前整块 0 声明）', !!s && s.total === 2, out.split('\n')[0]);
    ok('B2 块内的死导出被判为零消费（此前 fail-open 静默放行）',
        /deadMultiline/.test(out), out.split('\n').slice(0, 3).join(' | '));
    ok('B3 有真消费的成员不判死（used 不在零消费清单里）',
        !/^\s*m\/lib\.js:\d+\s+used\b/m.test(out));
    ok('B4 零消费恰为 1（成员行不得被算作消费）', !!s && s.dead === 1, s ? `dead=${s.dead}` : 'no summary');

    const judged = runGate(['--root', tmp], FIX);
    ok('B5 未登记时红灯 exit 1（熔断生效）', judged.status === 1, `status=${judged.status}`);

    // 登记后应转绿（证明红灯来自「未登记」而非固定红）
    const upd = runGate(['--update', '--root', tmp], FIX);
    ok('B6 --update 可在夹具下登记', upd.status === 0, `status=${upd.status}`);
    ok('B7 登记后同判据转通过（红灯非固定）',
        runGate(['--root', tmp], FIX).status === 0);
    fs.rmSync(tmp, { recursive: true, force: true });
}

/* ========== C. 配套静默点：声明行 / 成员行不得算作消费 ========== */
{
    // ① 声明行自身消费：`function X(){} export { X }`，X 全仓无消费 ⇒ 必须判死
    const t1 = mkFixture({
        'a/decl.js': 'function declOnly() { return 1; }\nexport {\n  declOnly,\n};\n',
    });
    const o1 = runGate(['--list', '--root', t1], FIX).stdout;
    ok('C1 只有声明行 + 块转出的名字判死（声明行不算消费）',
        /declOnly/.test(o1), o1.split('\n')[0]);

    // ② 单行声明 + 块转出：同名成员行不得被算作消费
    const t2 = mkFixture({
        'a/single.js': 'const singleOnly = 1;\nexport { singleOnly };\n',
    });
    const o2 = runGate(['--list', '--root', t2], FIX).stdout;
    ok('C2 单行 `export { X }` 形式同样判死（X 无真实消费）',
        /singleOnly/.test(o2), o2.split('\n')[0]);

    // ③ 反向：块外有真调用 ⇒ 不判死（判据真在跑，非一律判死）
    const t3 = mkFixture({
        'a/live.js': 'function liveOne() { return 1; }\nfunction call() { return liveOne(); }\nexport {\n  liveOne,\n  call,\n};\n',
    });
    const o3 = runGate(['--list', '--root', t3], FIX).stdout;
    ok('C3 块外有同文件真调用 ⇒ 被调用者不判死（非一律判死）',
        !/^\s*a\/live\.js:\d+\s+liveOne\b/m.test(o3), o3.split('\n').slice(0, 4).join(' | '));
    ok('C4 而调用者自身全仓零调用 ⇒ 仍应判死（判据不是「块内一律免死」）',
        /^\s*a\/live\.js:\d+\s+call\b/m.test(o3), o3.split('\n').slice(0, 4).join(' | '));
    fs.rmSync(t1, { recursive: true, force: true });
    fs.rmSync(t2, { recursive: true, force: true });
    fs.rmSync(t3, { recursive: true, force: true });
}

/* ========== D. 真实仓库：多行块已纳入枚举面 ========== */
{
    const live = runGate([]);
    const s = summary(live.stdout + live.stderr);
    ok('D1 真实仓库扫描面可解析', !!s, (live.stdout + live.stderr).split('\n')[0]);
    if (s) {
        ok('D2 口径完备（内部 + 跨文件 + 零消费 = 声明总数）',
            s.internal + s.cross + s.dead === s.total, `${s.internal}+${s.cross}+${s.dead} vs ${s.total}`);
        // v2.43.0 前为 510：新增的 6 项正是 config/drives-engine.js 多行块里的导出
        ok('D3 扫描面 ≥ 516（多行 export {} 已纳入枚举，不得退回 510）', s.total >= 516, `${s.total}`);
        ok('D4 零消费不因枚举面扩大而虚增（多行块里的导出都有真实消费）', s.dead <= 25, `${s.dead}`);
    }
    ok('D5 真实仓库在门禁下通过（exit 0）', live.status === 0, `status=${live.status}`);

    // 现场锚点：drives-engine 的多行块确实存在（判据的输入面存在）
    const de = read('config/drives-engine.js');
    ok('D6 现场：config/drives-engine.js 存在跨行 export {} 块（6 个成员）',
        /^export \{\s*$/m.test(de) && /^\s*buildDisplay,\s*$/m.test(de) && /^\s*DIM_LABELS_ZH,\s*$/m.test(de));
    // 这 6 个在门禁眼里必须已成「已声明」（若仍隐形，文件内声明数=1，与 7 个真实导出不符）
    ok('D7 现场：多行块成员均有真实消费（buildDisplay/DIMS/DIM_LABELS_ZH 不被误判死）',
        /\bbuildDisplay\(/.test(de) && /Object\.keys\(DIMS\)/.test(de) && /DIM_LABELS_ZH\[k\]/.test(de));
}

/* ========== E. 账本：无 TODO 占位、键唯一 ========== */
{
    const raw = JSON.parse(read('scripts/dead-export-baseline.json'));
    const key = e => `${e.file}::${e.name}`;
    ok('E1 账本结构齐备', typeof raw.note === 'string' && Array.isArray(raw.entries));
    ok('E2 每条都有非空理由（无 TODO 占位）',
        raw.entries.every(e => typeof e.reason === 'string' && !/^TODO/.test(e.reason)));
    ok('E3 条目键唯一', new Set(raw.entries.map(key)).size === raw.entries.length);
    ok('E4 本版未新增账本条目（E7 修的是枚举面，不引入新死导出）',
        raw.entries.length === 25, `${raw.entries.length}`);
}

console.log(`\n\u7ed3\u679c: ${pass} \u901a\u8fc7, ${fail} \u5931\u8d25`);
process.exit(fail > 0 ? 1 : 0);