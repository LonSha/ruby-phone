/* ============================================================
 * RubyPhone v2.44.0 —— 零消费导出门禁 E8：枚举面必须覆盖「解构转出」与「枚举源」
 *
 * 本版问题（两个缺口，形态不同、后果同一：导出的名字在门禁眼里**根本不存在**，
 *   于是既不报红灯也不进账本 —— fail-open 静默放行）：
 *
 *   ① 解构转出整块 0 枚举：
 *        export const {
 *          parseStatusPayload,
 *          findStatusUpdates,
 *        } = defaultParser;
 *      DECL_RE 只认 `const NAME`，`const {` 直接落下，整块导出被无视。
 *      实测 apps/phone/status-tracker.js:286 转出 5 个名字全是隐形。
 *
 *   ② 枚举源跑在**原文**上（消费判定却跑在真代码上）：
 *      被判据剥离掉的注释里若留着
 *        /* 历史备份：export { ghostA, ghostB }; *\/
 *      ghostA / ghostB 会被当成本模块的**真实导出**（幽灵导出）。
 *      修法：枚举与消费判定共用同一份真代码 —— 「判据的输入面与结论面必须是同一件事」。
 *
 * 同轮附带加固：真代码文本缺失时**不得静默回退原文口径**（`codeTexts.get(rel) || src` 这种写法
 *   会让 stripNonCode 失效后门禁照常出结论，跨文件消费整片消失却无人报警）。改为 fail-closed exit 2。
 *
 * 本版开发中真实踩到过这条：补丁误删 stripNonCode 后，跨文件消费 191 → 0，
 *   门禁照样打印「✓ 无新增零消费导出」—— 探测器坏了比缺陷更危险。
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
const GATE_REL = 'scripts/dead-export-check.mjs';
const GATE = path.join(root, GATE_REL);
const runGate = (args, env = {}) => spawnSync(process.execPath, [GATE, ...args],
    { encoding: 'utf8', env: { ...process.env, ...env } });
const FIX = { RP_DEAD_EXPORT_FIXTURE: '1' };
const mkFixture = (files) => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dex244-'));
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
const summary = (out) => {
    let m = /扫描 (\d+) 个文件 \/ (\d+) 个 export 声明（内部消费 (\d+) · 跨文件消费 (\d+) · 零消费 (\d+)）/.exec(out);
    if (m) return { files: +m[1], total: +m[2], internal: +m[3], cross: +m[4], dead: +m[5] };
    const h = /扫描 (\d+) 个文件 \/ (\d+) 个 export 声明/.exec(out);
    const t = /内部消费 (\d+) · 跨文件消费 (\d+) · 零消费 (\d+)/.exec(out);
    if (h && t) return { files: +h[1], total: +h[2], internal: +t[1], cross: +t[2], dead: +t[3] };
    return null;
};
/** 从**门禁真源码**里拔出枚举器与剥离器（对真源码断言，不用复刻实现） */
const extract = (src) => {
    const l = src.split('\n');
    const a = l.findIndex(x => x.startsWith('const DECL_RE'));
    const b = l.findIndex(x => x.startsWith('const wordRe'));
    if (a < 0 || b < 0 || b <= a) throw new Error('marker not found');
    return new Function(`${l.slice(a, b).join('\n')}\nreturn { exportsOf, stripNonCode };`)();
};

/* ========== A. 门禁结构：E8 落地 ========== */
{
    const src = read(GATE_REL);
    ok('A1 文档头登记了 E8（解构转出 + 枚举源）', /E8（v2\.44\.0）/.test(src));
    ok('A2 解构转出有独立识别式 DESTRUCT_RE', /const DESTRUCT_RE =/.test(src) && /export\\s\+\(\?:const\|let\|var\)\\s\*\(\[\\\[\{\]\)/.test(src));
    ok('A3 跨行块累积器 collectBlock（花括号/方括号配对）', /const collectBlock = \(i, open, close\)/.test(src));
    ok('A4 解构重命名 `A: B` 取右侧本地名', /lastIndexOf\(':'\)/.test(src));
    ok('A5 枚举源改为真代码（不再直接喂原文）', /exportsOf\(codeTexts\.get\(f\.rel\)\)/.test(src));
    ok('A6 不再有 `|| src` 静默回退原文口径', !/codeTexts\.get\(f\.rel\) \|\| src/.test(src));
    ok('A7 真代码文本缺失时 fail-closed', /codeTexts\.size !== texts\.size/.test(src) && /fail-closed/.test(src));
}

/* ========== B. 夹具负控制：解构转出必须被枚举、块内死导出必须判死 ========== */
{
    const LIB = [
        'const bag = buildBag();',
        'export const {',
        '  usedOne,',
        '  deadOne,',
        '} = bag;',
    ].join('\n') + '\n';
    const USER = "import { usedOne } from './m/lib.js';\nconsole.log(usedOne);\n";
    const tmp = mkFixture({ 'm/lib.js': LIB, 'main.js': USER });

    const listed = runGate(['--list', '--root', tmp], FIX);
    const out = listed.stdout + listed.stderr;
    const s = summary(out);
    ok('B1 多行解构转出被枚举（此前整块 0 声明）', !!s && s.total === 2, out.split('\n')[0]);
    ok('B2 块内真死成员被判零消费（此前 fail-open 静默放行）', /deadOne/.test(out), out.split('\n').slice(0, 3).join(' | '));
    ok('B3 有真消费的成员不判死', !/^\s*m\/lib\.js:\d+\s+usedOne\b/m.test(out));
    ok('B4 零消费恰为 1（成员行不得被算作消费）', !!s && s.dead === 1, s ? `dead=${s.dead}` : 'no summary');

    const judged = runGate(['--root', tmp], FIX);
    ok('B5 未登记时红灯 exit 1（熔断生效）', judged.status === 1, `status=${judged.status}`);
    ok('B6 --update 可在夹具下登记', runGate(['--update', '--root', tmp], FIX).status === 0);
    ok('B7 登记后同判据转通过（红灯非固定）', runGate(['--root', tmp], FIX).status === 0);
    fs.rmSync(tmp, { recursive: true, force: true });
}

/* ========== C. 解构的另两种写法：单行 / 数组 ========== */
{
    const t1 = mkFixture({
        'a/one.js': 'const o = buildOne();\nexport const { singleA } = o;\n',
    });
    const o1 = runGate(['--list', '--root', t1], FIX).stdout;
    ok('C1 单行 `export const { X } = expr` 被枚举', !!summary(o1) && summary(o1).total === 1, o1.split('\n')[0]);
    ok('C2 单行解构的零消费成员判死', /singleA/.test(o1));

    const t2 = mkFixture({
        'a/arr.js': 'const arr = buildArr();\nexport const [firstA, secondB] = arr;\n',
    });
    const o2 = runGate(['--list', '--root', t2], FIX).stdout;
    ok('C3 数组解构 `export const [a, b] = arr` 被枚举（2 项）',
        !!summary(o2) && summary(o2).total === 2, o2.split('\n')[0]);
    fs.rmSync(t1, { recursive: true, force: true });
    fs.rmSync(t2, { recursive: true, force: true });
}

/* ========== D. 枚举源 = 真代码：注释里的伪声明不得成为导出（幽灵导出） ========== */
{
    const ghostSrc = [
        '/* 历史备份（旧路径转出，已废弃）：',
        'export {',
        '  ghostA,',
        '  ghostB,',
        '};',
        '*/',
        'export {',
        '  realX,',
        '  realY,',
        '};',
    ].join('\n') + '\n';
    const tmp = mkFixture({
        'm/lib.js': ghostSrc,
        'main.js': "import { realX } from './m/lib.js';\nconsole.log(realX);\n",
    });
    const exposed = extract(read(GATE_REL));
    const rawNames = exposed.exportsOf(ghostSrc).map(e => e.name);
    const codeNames = exposed.exportsOf(exposed.stripNonCode(ghostSrc)).map(e => e.name);
    ok('D1 枚举摘要在原文上会把注释里的伪声明算成导出（4 项）', rawNames.length === 4, rawNames.join(','));
    ok('D2 枚举摘要在真代码上只剩 2 项（幽灵导出被剥离）',
        codeNames.length === 2 && !codeNames.includes('ghostA') && !codeNames.includes('ghostB'),
        codeNames.join(','));
    ok('D3 门禁行为：注释里的 ghostA/ghostB 不出现在导出面',
        (() => { const o = runGate(['--list', '--root', tmp], FIX).stdout; return !/ghostA|ghostB/.test(o); })());
    ok('D4 门禁行为：真块里的 realY 仍被判死（剥离不伤真声明）',
        /realY/.test(runGate(['--list', '--root', tmp], FIX).stdout));
    fs.rmSync(tmp, { recursive: true, force: true });
}

/* ========== E. fail-closed 自证：stripNonCode 失效即拒判，不得静默退回原文口径 ========== */
{
    const tmp = mkFixture({
        'm/lib.js': 'export function lonely() { return 1; }\n',
        'main.js': 'console.log(1);\n',
    });
    ok('E1 原版门禁在该夹具下正常出结论（exit 0）',
        runGate(['--list', '--root', tmp], FIX).status === 0);

    // 真源码破坏：删掉 codeTexts 的填充（等价于剥离器失效）
    const src = read(GATE_REL);
    const ANCHOR = '    codeTexts.set(f.rel, stripNonCode(raw));';
    ok('E2 破坏锚点在真源码中恰中 1 次', src.split(ANCHOR).length - 1 === 1);
    const broken = src.replace(ANCHOR, '    /* 剥离器被破坏：codeTexts 不再填充 */');
    ok('E3 破坏确实改变了产物（非空转）', broken !== src && broken.length < src.length);
    const bdir = fs.mkdtempSync(path.join(os.tmpdir(), 'dex244b-'));
    const bpath = path.join(bdir, 'gate-broken.mjs');
    fs.writeFileSync(bpath, broken);
    const r = spawnSync(process.execPath, [bpath, '--root', tmp],
        { encoding: 'utf8', env: { ...process.env, ...FIX } });
    ok('E4 剥离器失效 ⇒ fail-closed exit 2（不再静默出结论）', r.status === 2, `status=${r.status}`);
    ok('E5 报错可读（指明真代码文本缺失/拒判）',
        /fail-closed|真代码文本/.test(r.stdout + r.stderr));
    // 对照：同一判据在原版上必须真（否则「破坏可观测」无意义）
    ok('E6 同判据在原版上不成立（原版 exit 0 ≠ 2）', runGate(['--root', tmp], FIX).status !== 2);
    fs.rmSync(bdir, { recursive: true, force: true });
    fs.rmSync(tmp, { recursive: true, force: true });
}

/* ========== F. 真实仓库：解构转出已纳入枚举面 ========== */
{
    const live = runGate([]);
    const s = summary(live.stdout + live.stderr);
    ok('F1 真实仓库扫描面可解析', !!s, (live.stdout + live.stderr).split('\n')[0]);
    if (s) {
        ok('F2 口径完备（内部 + 跨文件 + 零消费 = 声明总数）',
            s.internal + s.cross + s.dead === s.total, `${s.internal}+${s.cross}+${s.dead} vs ${s.total}`);
        // v2.44.0 前为 516：新增的 5 项正是 status-tracker 解构块里的导出
        ok('F3 扫描面 ≥ 521（解构转出已纳入枚举，不得退回 516）', s.total >= 521, `${s.total}`);
        ok('F4 零消费不因枚举面扩大而虚增', s.dead <= 25, `${s.dead}`);
    }
    ok('F5 真实仓库在门禁下通过（exit 0）', live.status === 0, `status=${live.status}`);

    // 现场锚点：解构块确实存在，且 5 个名字已被枚举
    const st = read('apps/phone/status-tracker.js');
    ok('F6 现场：apps/phone/status-tracker.js 存在跨行 `export const { ... } = defaultParser;`',
        /^export const \{\s*$/m.test(st) && /^\} = defaultParser;\s*$/m.test(st));
    const names = extract(read(GATE_REL)).exportsOf(st).map(e => e.name);
    const want = ['parseStatusPayload', 'findStatusUpdates', 'findLatestStatus', 'applyStatusUpdate', 'createInitialStatus'];
    ok('F7 现场：解构块 5 个名字均已被枚举（此前 0 个）',
        want.every(n => names.includes(n)), `got=${names.length} 名`);
    ok('F8 现场：该文件枚举数 ≥ 11（6 个普通导出 + 5 个解构转出）', names.length >= 11, `${names.length}`);
    ok('F9 现场：枚举无重复（解构块不得与普通声明重复计数）',
        new Set(names).size === names.length, names.join(','));
}

/* ========== G. 账本：无 TODO 占位、键唯一、条目数不虚增 ========== */
{
    const raw = JSON.parse(read('scripts/dead-export-baseline.json'));
    const key = e => `${e.file}::${e.name}`;
    ok('G1 账本结构齐备', typeof raw.note === 'string' && Array.isArray(raw.entries));
    ok('G2 每条都有非空理由（无 TODO 占位）',
        raw.entries.every(e => typeof e.reason === 'string' && !/^TODO/.test(e.reason)));
    ok('G3 条目键唯一', new Set(raw.entries.map(key)).size === raw.entries.length);
    ok('G4 本版未新增账本条目（E8 修的是枚举面，不引入新死导出）',
        raw.entries.length === 25, `${raw.entries.length}`);
}

console.log(`\n\u7ed3\u679c: ${pass} \u901a\u8fc7, ${fail} \u5931\u8d25`);
process.exit(fail > 0 ? 1 : 0);