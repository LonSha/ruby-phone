/* ============================================================
 * RubyPhone v2.45.0 —— 零消费导出门禁 E9：枚举面**完整性**必须自证
 *
 * 本版问题（不是又一个语法个案，而是**类别的残余**）：
 *   E7（v2.43.0，跨行 export 块）与 E8（v2.44.0，解构转出）修的是同一类缺口的两个个案——
 *
 *     某条抽取路径没覆盖某种写法 ⇒ 该写法导出的名字在门禁眼里**根本不存在**
 *     ⇒ 既不报红灯、也不进账本（fail-open 静默放行）。
 *
 *   补掉两个个案之后，**类别本身依然无守卫**：下一次谁用上第三种写法，
 *   同样的静默漏面会原样重演，而且这一次连「检测器坏了」都算不上——门禁会照常打印通过。
 *
 * 本版判据（不预见更多语法，只**拒绝**预见不到的语法）：
 *   把真代码里每条 `export` 语句与既有抽取路径硬挂钩，凡未被任一路径命中的语句
 *   一律 fail-closed（exit 2 拒判）；确无具名成员可对账的（当前只有 export default）
 *   须进 UNHANDLED_ALLOWLIST 并写明理由。
 *
 * 实测现场：179 文件 / 567 条导出语句全部被识别（未识别 0）⇒ 本版不改扫描面（521 声明、
 *   零消费 25 均不变）、不引入新债务，只把「已经成立的事实」变成「跑不掉的门槛」。
 *
 * 真源码负控制在 G 组：往仓库注入三行门禁不认识的写法后，
 *   —— pre-E9 门禁：扫到 181 个文件、仍报「521 个 export 声明 · ✓ 通过」exit 0（名字不存在）
 *   —— E9 门禁：exit 2 并逐条点名
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
const runGate = (args, env = {}) => spawnSync(process.execPath, [GATE_REL, ...args],
    { cwd: root, encoding: 'utf8', env: { ...process.env, ...env } });
/** 从**门禁真源码**拔出枚举器/剥离器/未处理分类器（对真源码断言，不用复刻实现） */
const extract = (src) => {
    const l = src.split('\n');
    const a = l.findIndex(x => x.startsWith('const DECL_RE'));
    const b = l.findIndex(x => x.startsWith('const wordRe'));
    if (a < 0 || b < 0 || b <= a) throw new Error('marker not found');
    return new Function(`${l.slice(a, b).join('\n')}
return { exportsOf, stripNonCode, unhandledKind, HANDLED_LINE_PATHS, UNHANDLED_ALLOWLIST };`)();
};

/* ========== A. 门禁结构：E9 落地 ========== */
{
    const src = read(GATE_REL);
    ok('A1 文档头登记了 E9（枚举面完整性自证）', /E9（v2\.45\.0）枚举面\*\*完整性\*\*/.test(src));
    ok('A2 抽取路径已集中登记为可回答的清单 HANDLED_LINE_PATHS', /const HANDLED_LINE_PATHS = \[/.test(src));
    ok('A3 清单与 DECL_RE / DESTRUCT_RE 一一对应（同一份正则，不得各自复制）',
        /re: DECL_RE/.test(src) && /re: DESTRUCT_RE/.test(src));
    ok('A4 未处理写法须显式准入（UNHANDLED_ALLOWLIST + why）',
        /const UNHANDLED_ALLOWLIST = \[/.test(src) && /why:/.test(src));
    ok('A5 分类器存在且以 UNHANDLED 为兜底', /function unhandledKind\(line\)/.test(src) && /return 'UNHANDLED'/.test(src));
    ok('A6 未识别即 fail-closed exit 2（不是提示、不是计入账本）',
        /枚举面不完整/.test(src) && /process\.exit\(2\)/.test(src));
    ok('A7 完整性闸只增加红灯：不改动「新增零消费导出」判定',
        /fail = 1;/.test(src) && /fail === 0 \? '\[dead-export\] ✓ 无新增零消费导出'/.test(src));
}

/* ========== B. 分类器语义：认得的放过、不认得的兜住、白名单准入 ========== */
{
    const ex = extract(read(GATE_REL));
    const kind = (s) => ex.unhandledKind(s);
    ok('B1 普通具名声明被认领', kind('export const c1 = 1;') === null && kind('export function f1() {}') === null);
    ok('B2 成块转出被认领', kind('export { x1, y1 as y2 };') === null);
    ok('B3 解构转出被认领', kind('export const { p1, p2 } = obj;') === null && kind('export let [r1, r2] = arr;') === null);
    ok('B4 export default 经白名单准入（刻意不处理，而非不认识）', kind('export default function dn1() {}') === null);
    ok('B5 生成器声明被兜住（DECL_RE 不认 `function*`）', kind('export function* g1() {}') === 'UNHANDLED');
    ok('B6 命名空间转出被兜住（门禁未枚举 export * as）', kind("export * as nsA from './m.js';") === 'UNHANDLED');
    ok('B7 多声明符的第二个名字不影响语句被认领（语句级判定，非成员级）',
        kind('export const m1 = 1, m2 = 2;') === null);
    ok('B8 白名单只含 export-default 一项（准入闸不得被当成放行条）',
        ex.UNHANDLED_ALLOWLIST.length === 1 && ex.UNHANDLED_ALLOWLIST[0].label === 'export-default',
        JSON.stringify(ex.UNHANDLED_ALLOWLIST.map(a => a.label)));
    ok('B9 抽取路径清单含 block/decl/destruct 三条', ex.HANDLED_LINE_PATHS.map(p => p.kind).join(',') === 'block,decl,destruct',
        ex.HANDLED_LINE_PATHS.map(p => p.kind).join(','));
}

/* ========== C. 真实仓库：完整性自证在场且未识别为 0 ========== */
{
    const r = runGate(['--list']);
    const out = r.stdout + r.stderr;
    const m = /导出语句识别 (\d+) 条（声明 (\d+) · 成块 (\d+) · 解构 (\d+) · 无具名成员 (\d+)）· 未识别 (\d+)/.exec(out);
    ok('C1 真实仓库报出枚举面完整性一行', !!m, out.split('\n').slice(0, 3).join(' | '));
    if (m) {
        const [, total, decl, block, destruct, allowed, un] = m.map(Number);
        ok('C2 未识别为 0（现场每条 export 语句都被识别）', un === 0, `unhandled=${un}`);
        ok('C3 四类之和等于语句总数（分账不漏）', decl + block + destruct + allowed === total,
            `${decl}+${block}+${destruct}+${allowed} vs ${total}`);
        ok('C4 语句总数 ≥ 567（不得退回 E8 时代）', total >= 567, `${total}`);
        ok('C5 解构路径确有命中（E8 的成果未丢）', destruct >= 1, `${destruct}`);
    }
    ok('C6 --list 退出码 0', r.status === 0, `status=${r.status}`);
}

/* ========== D. 真实仓库：本版不改扫描面、不引入新债务 ========== */
{
    const r = runGate([]);
    const out = r.stdout + r.stderr;
    ok('D1 真实仓库通过（exit 0）', r.status === 0, `status=${r.status}`);
    // 扫描面下界（不钉具体值）：E9 只可能拒判、不可能放行；后续版本新增 App/导出属合法增长，
    // 钉死具体数字会让「加了一个 App」变成门禁红灯（v2.46 加 apps/place/ 时真实踩到）。
    const declN = Number((out.match(/扫描 \d+ 个文件 \/ (\d+) 个 export 声明/) || [])[1] || 0);
    ok('D2 扫描面不少于 E8 时代的 521 声明（E9 不缩面、不退回旧口径）', declN >= 521, String(declN));
    ok('D3 零消费仍为 24（不新增债务；v2.58 育种接线消费 MENSTRUAL_STAGE_DAYS，账本 25→24）', /零消费 24/.test(out));
    ok('D4 基线账本仍为 24 条冻结项', /基线账本：24 条冻结项/.test(out));
    ok('D5 判定口径未被放宽（仍打印 ✓ 无新增零消费导出）', /✓ 无新增零消费导出/.test(out));
}

/* ========== E. 夹具模式：完整性闸不干扰单测合成仓库 ========== */
{
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dex245-'));
    fs.mkdirSync(path.join(tmp, 'scripts'), { recursive: true });
    fs.mkdirSync(path.join(tmp, 'm'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'scripts/dead-export-baseline.json'), JSON.stringify({ note: '', entries: [] }));
    // 合成本文件里刻意用上门禁不认识的写法：夹具模式必须跳过完整性闸（否则单测无法构造任意语料）
    fs.writeFileSync(path.join(tmp, 'm/lib.js'),
        "export const okOne = 1;\nexport function* genGhost() { yield 1; }\n\nexport { okOne };\n");
    const r = spawnSync(process.execPath, [GATE_REL, '--list', '--root', tmp],
        { cwd: root, encoding: 'utf8', env: { ...process.env, RP_DEAD_EXPORT_FIXTURE: '1' } });
    ok('E1 夹具模式跳过完整性闸（exit 0，未因合成语料拒判）', r.status === 0, `status=${r.status}`);
    ok('E2 夹具模式不打印完整性一行（真实仓库才需要这道闸）',
        !/导出语句识别/.test(r.stdout + r.stderr));
    fs.rmSync(tmp, { recursive: true, force: true });
}

/* ========== F. 真源码破坏：抽掉任一条抽取路径 ⇒ 完整性闸立刻拒判 ========== */
{
    const src = read(GATE_REL);
    const ANCHOR = "  { kind: 'decl', re: DECL_RE },";
    ok('F1 抽取路径锚点（decl）在真源码中恰中 1 次', src.split(ANCHOR).length - 1 === 1);
    // 让 decl 路径永不命中（其余不动）：499 条具名声明立刻变成「未被识别」
    const broken = src.replace(ANCHOR, "  { kind: 'decl', re: /$^/ },");
    ok('F2 破坏确实改变了产物（非空转）', broken !== src && broken.length !== 0);
    const bdir = fs.mkdtempSync(path.join(os.tmpdir(), 'dex245b-'));
    const bpath = path.join(bdir, 'gate-e9-broken.mjs');
    fs.writeFileSync(bpath, broken);
    const r = spawnSync(process.execPath, [bpath, '--root', root], { encoding: 'utf8' });
    const out = r.stdout + r.stderr;
    ok('F3 抽取路径失效 ⇒ fail-closed exit 2（闸真的在把守）', r.status === 2, `status=${r.status}`);
    ok('F4 报错指明「未被任何抽取路径识别」', /未被任何抽取路径识别/.test(out));
    ok('F5 报错点名真实文件与行', /:\d+\s+export (const|function|async function)/.test(out), out.split('\n')[1] || '');
    ok('F6 报错给出两条修法（补抽取路径 / 写进白名单并说明理由）',
        /补抽取路径/.test(out) && /UNHANDLED_ALLOWLIST/.test(out));
    // 对照：同一 root、同一判据在原版上必须不成立（否则「破坏可观测」无意义）
    ok('F7 同判据在原版上不成立（原版 exit 0 ≠ 2）', runGate([]).status === 0);
    fs.rmSync(bdir, { recursive: true, force: true });
}

/* ========== H. 真实场景复现：目标目录里出现门禁不认识的写法 ⇒ 红灯并逐条点名 ==========
 * 与 F 组的分工：F 组证明「抽取路径失效会被闸拦住」（真源码破坏），
 *   H 组证明「文件里出现新写法会被闸拦住」——即 E7/E8 缺口的**通用复现**：
 *   不必等到某种具体语法先出事，任何新写法一出现就当场现形。
 * ⚠️ 纪律：本组**不得**往真实仓库写文件。`node --test` 会并行跑各测试文件，
 *   而 v242/v243/v244 都有「真实仓库当前绿灯 exit 0」的断言——若在真实仓库里插入
 *   红灯文件，会把它们连带打红，制造典型的**探测器自身不确定性**（判据彼此串扰）。
 *   故这里另建独立 root，用**真门禁源文件**去扫（--root 指向合成目录）。 */
const INJECT3 = [
    'export function* genProbeE9() { yield 1; }',
    'export async function* agenProbeE9() { yield 2; }',
    'export /* e9-probe */ const commentProbeE9 = 1;'
];
{
    const probeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dex245h-'));
    fs.mkdirSync(path.join(probeRoot, 'm'), { recursive: true });
    fs.writeFileSync(path.join(probeRoot, 'm/probe.js'), INJECT3.join('\n') + '\n');
    fs.writeFileSync(path.join(probeRoot, 'm/plain.js'), 'export const plainOne = 1;\n');
    // 无 RP_DEAD_EXPORT_FIXTURE：走真实仓库口径（完整性闸在 MIN_EXPORTS 之前先拦）
    const r = spawnSync(process.execPath, [GATE_REL, '--root', probeRoot], { cwd: root, encoding: 'utf8' });
    const out = r.stdout + r.stderr;
    ok('H1 目录里出现未识别写法 ⇒ fail-closed exit 2', r.status === 2, `status=${r.status}`);
    ok('H2 报错指明「未被任何抽取路径识别」', /未被任何抽取路径识别/.test(out));
    ok('H3 逐条点名两条真未识别写法（含文件路径与行号）',
        /m\/probe\.js:1/.test(out) && /m\/probe\.js:2/.test(out), out.split('\n').slice(1, 3).join(' | '));
    ok('H4 两个生成器导出全部被点名', /genProbeE9/.test(out) && /agenProbeE9/.test(out));
    ok('H4b 注释夹在 export 与声明之间**不算**未识别（剥离后归一为普通声明，属已覆盖写法）',
        !/commentProbeE9/.test(out));
    ok('H5 与「新增零消费导出」是两回事：不打印该文案（识别问题 ≠ 接线问题）',
        !/✓ 无新增零消费导出/.test(out) && !/未登记的零消费导出/.test(out));
    // 反证：同一份探针，门禁自己的枚举器（跑在**真代码**上）只看得见归一后的 commentProbeE9，
    //   两个生成器导出是 0 —— 名字在门禁眼里根本不存在（fail-open 的实体证据）。
    const ex2 = extract(read(GATE_REL));
    const strippedNames = ex2.exportsOf(ex2.stripNonCode(INJECT3.join('\n') + '\n')).map(e => e.name);
    ok('H6 剥离后枚举器只认出 commentProbeE9，两个生成器导出枚举为 0',
        strippedNames.join(',') === 'commentProbeE9', JSON.stringify(strippedNames));
    ok('H7 未识别写法是本组唯一的红灯来源（同目录里的普通声明不受牵连）',
        /m\/probe\.js/.test(out) && !/m\/plain\.js/.test(out));
    fs.rmSync(probeRoot, { recursive: true, force: true });
    ok('H8 真实仓库未被本组触碰（仍为绿灯、未识别 0）', (() => {
        const g = runGate([]);
        return g.status === 0 && /未识别 0/.test(g.stdout + g.stderr);
    })());
}

/* ========== G. 类别证明：E9 不是又一个语法个案，而是堵住了「静默漏面」这一类 ========== */
{
    // 反证：若只补个案（不设完整性闸），注入的三行会**完全消失**——
    //   用门禁自己的枚举器跑一遍即可看到：名字在门禁眼里根本不存在。
    const ex = extract(read(GATE_REL));
    const corpus = [
        "export * as nsProbeE9 from './m.js';",
        'export function* genProbeE9() { yield 1; }',
        'export async function* agenProbeE9() { yield 2; }'
    ].join('\n');
    const got = ex.exportsOf(corpus).map(e => e.name);
    ok('G1 三个具名导出在枚举器眼里全部不存在（0 个）—— 这正是 fail-open 静默漏面',
        got.length === 0, JSON.stringify(got));
    ok('G2 三条语句却全部被识别为「我不知道该怎么办」（3 条 UNHANDLED）',
        corpus.split('\n').filter(l => ex.unhandledKind(l) === 'UNHANDLED').length === 3);
    // 方向性：完整性闸只会把「沉默」变成「红灯」，不会反向放行任何真死导出
    const deadProbe = ['export const lonelyProbe = 1;', 'console.log(1);'].join('\n');
    ok('G3 完整性闸不改变真死导出的判定（lonelyProbe 仍被枚举，行为不受 E9 影响）',
        ex.exportsOf(deadProbe).map(e => e.name).join(',') === 'lonelyProbe');
}

console.log(`\n\u7ed3\u679c: ${pass} \u901a\u8fc7, ${fail} \u5931\u8d25`);
process.exit(fail > 0 ? 1 : 0);