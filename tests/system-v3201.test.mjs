// tests/system-v3201.test.mjs — 全量门禁落文件执行器（计划一「共同配套」第 4 条）[v3.20.1]
//
//   计划原文：「手机跑 `npm run check` 十道检查。**全量输出落文件**，真宿主项目另留实机记录。」
//
//   本套件为什么长这样（两种判据分工，别互相替代）：
//     · **行为判据**：在**临时 mini 仓**里跑**真执行器**（`node <仓>/scripts/check-file.mjs`）。
//       mini 仓自带假门（四个，名字故意取真门同名），产出与真门**同形的主读数行** ——
//       于是「零管道」「落文件」「读回来对账」「读不到拒判」「退出码三档」都能在几秒内真跑出来，
//       而不必跑真全链（约 3 分钟；那不属于判据，属于发布流程）。
//     · **接口判据**：对真仓做静态锚点（默认日志位置 / fd 而非管道 / 门清单来源 / 别名在场）。
//   两种都不是「注释里写着」：前者断言子进程行为，后者断言真源码。
//
//   ★ 夹具必须用**真的链形**（`npm run <name>`），这是本版第一轮踩到的坑：
//     初版夹具把 `scripts.check` 写成裸门名（`syntax && import-resolve`），而执行器对链形
//     是 fail-closed 的（不认识的段一律拒判 exit 2）⇒ 七条判据齐齐变红。
//     **红的原因不是执行器坏了，是夹具写了一个真源不会有的链形。** 判据照实修夹具，不改执行器。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const SCRIPT_REL = 'scripts/check-file.mjs';
const SCRIPT = path.join(ROOT, SCRIPT_REL);
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const SRC = read(SCRIPT_REL);
const pkg = JSON.parse(read('package.json'));
// 默认日志路径由执行器动态唯一命名；N1 从执行器回报中取本次真实路径。
/* 剥注释：本仓口径「注释里的提及不算消费」（E6 / v299 A4 / v3190 A4 / v3200 D1 同款）。
 *   ★ 这一版工具是**当场被自己的假红换来的**（本版抓到的第二个缺陷）：
 *     初版偷懒按**行的前缀**剥注释（` *` / `//` 开头就整行丢掉），可 ` * ` 这种续行里
 *     仍有正文 —— 本文件上方注释正好引用了那条真实事故命令（`| grep … | sort | head`），
 *     于是 A3 的「产品路径不得出现 shell 管道」把**注释里的事故描述**读成了产品代码，当场假红。
 *     修法：按字符状态机剥（与 v3200 同款），并补 A5 两向自证「剥注释必须真的剥掉了东西」。 */
function stripComments(src) {
    let out = '';
    let i = 0;
    const n = src.length;
    let state = 'code';
    while (i < n) {
        const c = src[i];
        const d = src[i + 1];
        if (state === 'code') {
            if (c === '/' && d === '/') { state = 'line'; i += 2; continue; }
            if (c === '/' && d === '*') { state = 'block'; i += 2; continue; }
            if (c === "'" || c === '"' || c === '`') { state = c; out += c; i += 1; continue; }
            out += c; i += 1; continue;
        }
        if (state === 'line') { if (c === '\n') { state = 'code'; out += c; } i += 1; continue; }
        if (state === 'block') { if (c === '*' && d === '/') { state = 'code'; i += 2; continue; } i += 1; continue; }
        if (c === '\\') { out += c + (d || ''); i += 2; continue; }
        out += c; i += 1;
        if (c === state) state = 'code';
    }
    return out;
}

const temps = [];
function tmp(prefix) {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    temps.push(d);
    return d;
}
process.on('exit', () => {
    for (const d of temps) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (_e) { /* 忽略 */ } }
});

/* ══════════ 夹具：mini 仓（假门产出与真门同形的主读数行） ══════════ */
/**
 * chain 必须是真链形（`npm run <name>`）；
 * 门名取真门同名，故执行器的读数登记表对它们是**同一份**（不给夹具开后门）。
 * auditExit 让「审计门」报 exit 2；silentSyntax 让语法假门不报读数（读不到 ⇒ 必须拒判）；
 * noSyntaxScript 删掉语法假门脚本（产物自证：执行器不许「永远绿」）。
 */
function miniRepo(opts = {}) {
    const {
        chain = 'npm run syntax && npm run import-resolve && npm run test && npm run weak-coercion',
        testFail = false, auditExit = 0, silentSyntax = false, noSyntaxScript = false
    } = opts;
    const dir = tmp('rp_cf_');
    fs.mkdirSync(path.join(dir, 'scripts'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'tests'), { recursive: true });
    const scripts = {
        'check': chain,
        'syntax': 'node scripts/syntax-check.mjs',
        'import-resolve': 'node scripts/import-resolve-check.mjs',
        'test': 'node --test tests/mini.test.mjs',
        'weak-coercion': 'node scripts/fake-audit.mjs'
    };
    fs.writeFileSync(path.join(dir, 'package.json'),
        JSON.stringify({ name: 'mini', version: '9.9.9', private: true, type: 'module', scripts }, null, 2) + '\n');
    if (!noSyntaxScript) {
        fs.writeFileSync(path.join(dir, 'scripts/syntax-check.mjs'), silentSyntax
            ? '/* 假门：故意不报读数 —— 执行器读不到时必须拒判 */\n'
            : 'console.log("\u2713 语法门通过：444 个文件均可按 ES Module 解析");\n');
    }
    fs.writeFileSync(path.join(dir, 'scripts/import-resolve-check.mjs'),
        'console.log("[import-resolve] 扫描 253 个文件 \u00b7 静态相对导入 398 条 \u00b7 动态 import(98) 条");\n' +
        'console.log("[import-resolve] \u2713 全部静态相对导入均可解析");\n');
    fs.writeFileSync(path.join(dir, 'scripts/fake-audit.mjs'),
        'console.log("[weak-coercion] 枚举面 274 文件 \u00b7 唯一实现被引用 16 文件");\n' +
        (auditExit ? 'process.exit(' + auditExit + ');\n' : ''));
    fs.writeFileSync(path.join(dir, 'tests/mini.test.mjs'),
        'import { test } from "node:test";\n' +
        'import assert from "node:assert/strict";\n' +
        (testFail ? 'test("mini", () => { assert.equal(1, 2); });\n' : 'test("mini", () => {});\n'));
    return dir;
}

/** 跑真执行器（对 mini 仓），日志一律显式落**仓外**临时目录 —— 与默认行为同一纪律 */
function runExec(repo, extra = []) {
    const log = path.join(tmp('rp_cf_log_'), 'cf.log');
    const r = spawnSync(process.execPath, [SCRIPT, '--root', repo, '--log', log, ...extra],
        { cwd: ROOT, encoding: 'utf8', timeout: 300000 });
    let text = '';
    try { text = fs.readFileSync(log, 'utf8'); } catch (_e) { /* 缺失由断言负责 */ }
    return { status: r.status, out: String(r.stdout || ''), err: String(r.stderr || ''), log, text };
}

function treeOf(dir) {
    const out = [];
    (function walk(d) {
        for (const n of fs.readdirSync(d)) {
            const a = path.join(d, n);
            if (fs.statSync(a).isDirectory()) walk(a); else out.push(path.relative(dir, a));
        }
    })(dir);
    return out.sort();
}

/* ══════════ A 工具存在与口径（静态锚点） ══════════ */
test('A1 执行器的默认日志必须落在**仓外**（包住门禁的工具不得改动门禁观测的树）', () => {
    assert.ok(fs.existsSync(SCRIPT), '执行器必须在场：' + SCRIPT_REL);
    assert.match(SRC, /argOf\('--log'\)\s*\|\|\s*path\.join\(os\.tmpdir\(\)/,
        '默认日志位置必须走 os.tmpdir()（仓内默认会触发本仓隔离判据）');
    assert.equal(/argOf\('--log'\)[^\n]*path\.join\(ROOT/.test(SRC), false,
        '★ 默认位置不得拼进仓根（本版初版即栽在这里）');
    assert.match(SRC, /包住门禁的工具不得改动门禁正在观测的树/,
        '这条设计约束必须写在源码里（防后人把默认值改回仓内）');
    assert.match(SRC, /Date\.now\(\).*process\.pid/,
        '默认日志名必须含时间戳与进程号，避免嵌套/并发运行争用同一路径');
    const code = stripComments(SRC);
    assert.match(code, /path\.join\(os\.tmpdir\(\),\s*'rp-check-'/,
        '默认日志必须落在系统临时目录');
});

test('A2 门清单来自 package.json 的 scripts.check，执行器不另存一份清单', () => {
    assert.match(SRC, /pkg\.scripts[\s\S]{0,40}check/, '链必须从 package.json 读');
    assert.equal(/\[[^\]]*'weak-coercion'[^\]]*\]/.test(SRC), false,
        '\u2605 门清单不得硬编码（那就是第二份清单，会与真源脱节）');
    assert.match(SRC, /没有登记主读数/, '未登记主读数的门必须拒判（不许漏网）');
    /* 读回来的对象必须是**落盘那份**：先删旧日志再追加写，否则陈旧读数可能冒充本次结果 */
    assert.match(SRC, /rmSync\(LOG/, '写之前必须删掉上一次的日志（否则对账对象可能是陈旧的）');
    assert.ok(pkg.scripts.check && /npm run/.test(pkg.scripts.check), '真源链形必须可解析');
});

test('A3 全程零管道：子进程的 fd 只许接日志文件（不许任何消费者进程参与）', () => {
    const code = stripComments(SRC);
    assert.match(code, /stdio:\s*\['ignore',\s*fd,\s*fd\]/, 'spawn 必须把 stdout/stderr 直接接日志 fd');
    assert.equal(/\bspawn\w*\(\s*'sh'|\|\s*(grep|head|sort)\b/.test(code), false,
        '\u2605 产品路径不得出现 shell 管道（本版两条事故都出在这里）');
});
test('A4 npm 脚本别名在场且指向执行器；既有 check 链一字未动', () => {
    assert.equal(pkg.scripts['check:file'], 'node scripts/check-file.mjs',
        'package.json 必须给 check:file 别名（否则「全量落文件」没有人会记得手敲）');
    assert.match(String(pkg.scripts.check),
        /^npm run syntax && npm run import-resolve && npm run test && npm run dead-exports && npm run lifecycle && npm run registry && npm run keys && npm run source-derivation && npm run bridge-contract && npm run weak-coercion && npm run upstream-face$/,
        'check 链不得被本版改动（执行器是**包住**它，不是替换它）');
});

test('A5 剥注释工具两向自证（否则 A2/A3 可能把注释读成代码）', () => {
    /* 正向：真源码里那句事故命令只存在于注释中 —— 剥完后必须查不到 */
    assert.match(SRC, /\| grep … \| sort -u \| head/, '前提：真源码注释里确实引用了那条事故命令');
    assert.equal(/\| grep … \| sort -u \| head/.test(stripComments(SRC)), false,
        '\u2605 剥注释必须真的把注释里的管道命令剥掉（本版初版按行前缀剥 ⇒ 假红）');
    /* 反向：代码里的锚点不得被剥掉（否则判据变成「永远为真」） */
    assert.match(stripComments(SRC), /stdio:\s*\['ignore',\s*fd,\s*fd\]/, '代码侧的锚点必须留下');
    /* 字符串内的 `//` 不得被当成行注释起点（否则会误剥代码） */
    const probe = 'const u = "https://example.com/x"; const y = 1; // gone\n';
    const out = stripComments(probe);
    assert.match(out, /https:\/\/example\.com/, '字符串里的 // 必须留下');
    assert.equal(/gone/.test(out), false, '真注释必须被剥掉');
});

test('A6 执行器必须剥掉测试运行器上下文（否则内层 node --test 门会「绿着不跑」）', () => {
    const code = stripComments(SRC);
    assert.match(code, /delete childEnv\.NODE_TEST_CONTEXT/, '必须剥掉 NODE_TEST_CONTEXT');
    assert.match(code, /delete childEnv\.NODE_TEST_WORKER_ID/, '必须剥掉 NODE_TEST_WORKER_ID');
    assert.match(code, /env:\s*childEnv/, 'spawn 必须显式传剥过的环境（不能照抄 process.env）');
    /* 正向自证：本套件自己就跑在 `node --test` 里 —— 上下文标记必须在场，
     * 否则「剥掉它」这件事在判据里根本测不到（那是假绿）。 */
    assert.equal(typeof process.env.NODE_TEST_CONTEXT, 'string',
        '前提：本套件必须真跑在测试运行器子进程里（否则 A6 测不到东西）');
});

/* ══════════ B 行为：落文件 + 读回来对账 ══════════ */
test('B1 全链在 mini 仓上真跑：日志落盘、主读数逐条读回来、退出码 0', () => {
    const repo = miniRepo();
    const r = runExec(repo);
    assert.equal(r.status, 0, '全绿链必须 exit 0（stderr：' + r.err.slice(0, 200) + '）');
    assert.ok(r.text.length > 0, '日志必须真写出文件');
    for (const [label, re] of [
        ['语法文件数', /语法门通过：444 个文件/],
        ['导入条数', /静态相对导入 398 条/],
        ['门小节标题', /^===== \[test\] npm run test =====$/m],
        ['门退出码行', /^----- \[test\] 退出码 0 /m]
    ]) assert.match(r.text, re, '日志必须含 ' + label);
    assert.match(r.out, /syntax\.files = 444/, '汇总必须报出语法文件数');
    assert.match(r.out, /import-resolve\.specs = 398/, '汇总必须报出导入条数');
    assert.match(r.out, /test\.fail = 0/, '汇总必须报出判据失败数');
    assert.match(r.out, /全部门通过（4 道）/, '汇总必须说清跑了几道门');
    assert.equal(/拒判/.test(r.out), false, '全绿时不得出现拒判字样');
});

test('B2 对账对象是**本仓落盘那份**，不是真仓的数（mini 报 444 就必须是 444）', () => {
    const repo = miniRepo();
    const r = runExec(repo);
    assert.equal(r.status, 0, '前提：这条链全绿');
    /* 真仓语法面此刻 ≠ 444（本版新增脚本后变了）；执行器只许报它自己那份日志里的数 */
    assert.match(r.out, /syntax\.files = 444/, '必须报 mini 仓日志里的数');
    assert.equal(/syntax\.files = 445/.test(r.out), false, '不得把真仓的数混进来（那是另一棵树）');
});

test('B3 单门链也成立（链从真源解析，不假设一定是十道）', () => {
    const repo = miniRepo({ chain: 'npm run test' });
    const r = runExec(repo);
    assert.equal(r.status, 0, '单门全绿必须 exit 0');
    assert.match(r.out, /test\.tests = 1/, '单门链也要报出该门读数');
    assert.match(r.out, /全部门通过（1 道）/, '门数须按真源链报');
});

/* ══════════ C 退出码三档 ══════════ */
test('C1 有门报红 ⇒ exit 1（与「拒判」分开，红不等于判不了）', () => {
    const repo = miniRepo({ chain: 'npm run test', testFail: true });
    const r = runExec(repo);
    assert.equal(r.status, 1, '判据门失败必须整体 exit 1');
    assert.match(r.out, /有门报红/, '汇总必须把「红」与「拒判」分开说');
    assert.match(r.out, /test\.fail = 1/, '必须报出真实的失败数');
});

test('C2 有门 exit 2 ⇒ 整体 exit 2（拒判不得被读成通过）', () => {
    const repo = miniRepo({ chain: 'npm run test && npm run weak-coercion', auditExit: 2 });
    const r = runExec(repo);
    assert.equal(r.status, 2, '链上有 exit 2 必须整体 exit 2');
    assert.match(r.out, /拒判/, '汇总必须点名拒判');
    assert.match(r.out, /weak-coercion\s+exit=2/, '必须点名是哪道门拒判的');
});

test('C3 链形不认识 ⇒ exit 2 且不猜（真源被写成花式时必须停下）', () => {
    const repo = miniRepo({ chain: 'npm run syntax && node something-else.mjs' });
    const r = runExec(repo);
    assert.equal(r.status, 2, '不认识的段必须拒判');
    assert.match(r.err, /不认识的段/, '必须说清哪一段不认识');
    assert.equal(r.text, '', '链形不认识时不得产出「跑过了」的日志（不许装作跑过）');
});

test('C4 根下没有 package.json ⇒ exit 2（门清单真源不在场时不许跑）', () => {
    const dir = tmp('rp_cf_empty_');
    const r = spawnSync(process.execPath, [SCRIPT, '--root', dir], { cwd: ROOT, encoding: 'utf8', timeout: 60000 });
    assert.equal(r.status, 2, '真源不在场必须拒判');
    assert.match(String(r.stderr), /package\.json/, '必须点名缺的是什么');
});

/* ══════════ D 读数读不到 ⇒ 拒判（fail-closed，不许「缺输入仍判通过」） ══════════ */
test('D1 门跑绿了但读数行被改掉 ⇒ 必须 exit 2 拒判（不许判通过）', () => {
    const repo = miniRepo({ chain: 'npm run syntax', silentSyntax: true });
    const r = runExec(repo);
    assert.equal(r.status, 2, '\u2605 读不到主读数必须 exit 2（判通过就是把对账变成摆设）');
    assert.match(r.out, /读不到/, '汇总必须明说哪条读数读不到');
    assert.match(r.out, /syntax\.files/, '必须点名是哪道门的哪条读数');
    assert.match(r.text, /退出码 0/, '门自己确实是绿的（拒判只能因为读数读不到）');
});

test('D2 登记缺失的门 ⇒ 拒判并点名（新门不许悄悄进链）', () => {
    const repo = miniRepo({ chain: 'npm run syntax && npm run audit-y' });
    fs.writeFileSync(path.join(repo, 'scripts/audit-y.mjs'), 'console.log("y");\n');
    /* 该门脚本本身也要在场，否则拒判理由会退化成「模块找不到」，测不到登记缺失这一条 */
    const pj = JSON.parse(fs.readFileSync(path.join(repo, 'package.json'), 'utf8'));
    pj.scripts['audit-y'] = 'node scripts/audit-y.mjs';
    fs.writeFileSync(path.join(repo, 'package.json'), JSON.stringify(pj, null, 2) + '\n');
    const r = runExec(repo);
    assert.equal(r.status, 2, '未登记主读数的门必须拒判');
    assert.match(r.err, /audit-y/, '必须点名是哪道门没登记');
    assert.match(r.err, /主读数/, '拒判理由须是「没登记主读数」而非别的');
});

test('D3 陈旧日志不得冒充本次结果（先把旧日志删掉，再读回本次那份）', () => {
    const repo = miniRepo({ chain: 'npm run syntax', silentSyntax: true });
    const logDir = tmp('rp_cf_stale_');
    const log = path.join(logDir, 'cf.log');
    /* 预先放一份**读数齐全**的旧日志：本轮语法假门一个字都不报，
     * 若执行器不删旧日志 / 或对账对象不是本次那份，就会把陈旧读数当成本次结果而报绿。 */
    fs.writeFileSync(log, '✓ 语法门通过：444 个文件均可按 ES Module 解析\n');
    const r = spawnSync(process.execPath, [SCRIPT, '--root', repo, '--log', log],
        { cwd: ROOT, encoding: 'utf8', timeout: 300000 });
    assert.equal(r.status, 2, '\u2605 陈旧读数不得冒充本次结果（必须拒判）');
    assert.match(String(r.stdout), /读不到/, '必须明说本次没读到读数');
    assert.match(fs.readFileSync(log, 'utf8'), /# check-file 全量门禁日志/, '日志必须是本次重写的');
});

/* ══════════ N 负控制（判据对破坏有反应 + 隔离自证 + 产物自证） ══════════ */
test('N1 ★★ 隔离自证：执行器跑完仓内文件集合逐字不变（日志必须落仓外）', () => {
    const repo = miniRepo();
    const before = treeOf(repo);
    /* 走**默认日志位置**这一步是关键：默认值若被改回仓内，这条立刻红 */
    const r = spawnSync(process.execPath, [SCRIPT, '--root', repo], { cwd: ROOT, encoding: 'utf8', timeout: 300000 });
    const after = treeOf(repo);
    assert.equal(r.status, 0, '前提：这条链必须全绿（stderr：' + String(r.stderr || '').slice(0, 200) + '）');
    assert.deepEqual(after, before, '\u2605 执行器不得往被观测的仓里写任何文件（本版初版即栽在这里）');
    assert.equal(fs.readdirSync(repo, { recursive: true }).some((p) => /rp-check-.*\.log$/.test(String(p))), false,
        '\u2605 仓内不得生成任何执行器日志（默认日志路径必须在仓外）');
    /* 反向自证：日志确实写在**别处**（不是「没写」），且默认位置在仓外。
     * 若本判据处于 node:test worker 中，执行器会按自己的 pid 给默认日志隔离命名，
     * 因此从 stdout 取真实路径，不能在判据里硬编码普通入口文件名。 */
    const logMatch = /日志：(.+?)（\d+ 字节）/.exec(String(r.stdout || ''));
    assert.ok(logMatch, '执行器必须报告实际日志路径');
    const actualLog = path.resolve(logMatch[1]);
    assert.equal(actualLog.startsWith(path.resolve(repo) + path.sep), false,
        '默认日志必须在被观测仓库之外：' + actualLog);
    assert.ok(fs.existsSync(actualLog) && fs.statSync(actualLog).size > 0,
        '默认日志必须真写出：' + actualLog);
    assert.match(String(r.stdout || ''), /syntax\.files = 444/, '默认通道也要真报读数（不是空跑）');
});

test('N2 ★★ 工具两向自证：把「零管道」破坏成管道写法 ⇒ A3 同款判据必须转红', () => {
    const dir = tmp('rp_cf_neg_');
    const anchor = "stdio: ['ignore', fd, fd]";
    assert.equal(SRC.split(anchor).length - 1, 1, '破坏锚点必须恰中 1 次（先自证）');
    const broken = SRC.split(anchor).join("stdio: ['ignore', 'pipe', 'pipe']");
    fs.writeFileSync(path.join(dir, 'check-file.mjs'), broken);
    const bsrc = fs.readFileSync(path.join(dir, 'check-file.mjs'), 'utf8');
    assert.equal(/stdio:\s*\['ignore',\s*fd,\s*fd\]/.test(stripComments(bsrc)), false,
        '\u2605 破坏后同款判据必须转红');
    assert.equal(/stdio:\s*\['ignore',\s*fd,\s*fd\]/.test(stripComments(SRC)), true,
        '对照：真源码上同款判据必须为真');
});

test('N3 ★★ 产物自证：删掉一个 mini 门脚本 ⇒ 真执行器必须真的失败（不是「永远绿」）', () => {
    const repo = miniRepo({ chain: 'npm run syntax && npm run weak-coercion', noSyntaxScript: true });
    const r = runExec(repo);
    assert.notEqual(r.status, 0, '门脚本不在场时执行器必须非 0（否则这条链是空跑）');
    assert.match(r.text + r.out + r.err, /Cannot find module|MODULE_NOT_FOUND|读不到/,
        '失败必须可归因（缺模块 / 读数读不到），而不是静默');
});

test('N4 ★★ 变异自证：把 mini 的语法读数改成 999 ⇒ 执行器必须报 999（读数不是写死的）', () => {
    const repo = miniRepo({ chain: 'npm run syntax' });
    fs.writeFileSync(path.join(repo, 'scripts/syntax-check.mjs'),
        'console.log("\u2713 语法门通过：999 个文件均可按 ES Module 解析");\n');
    const r = runExec(repo);
    assert.equal(r.status, 0, '读数在新措辞下仍可解析，门也是绿的');
    assert.match(r.out, /syntax\.files = 999/, '执行器必须报日志里那个数（否则读数与真跑脱节）');
    assert.equal(/syntax\.files = 444/.test(r.out), false, '不得仍报旧数');
});

test('N5 ★★ 上下文自证：把「剥上下文」这一行破坏掉 ⇒ 内层 node --test 门真的会「绿着不跑」', () => {
    const repo = miniRepo({ chain: 'npm run test' });
    /* ① 真执行器（剥过上下文）：判据门真跑，读数在场 */
    const good = runExec(repo);
    assert.equal(good.status, 0, '剥掉上下文时，判据门必须真跑（stderr：' + good.err.slice(0, 200) + '）');
    assert.match(good.out, /test\.tests = 1/, '必须读到判据数');
    /* ② 真源码破坏 → 副本：把剥上下文那一行删掉（本套件此刻就在 `node --test` 子进程里，
     *    所以副本会把 NODE_TEST_CONTEXT 照抄给门 ⇒ 门自跳 ⇒ exit 0 且零读数）。
     *    ★ 这一条是**真源码破坏 + 真进程**，不是模拟常量：破坏的正是判据对象本身的行为。 */
    const anchor = 'delete childEnv.NODE_TEST_CONTEXT;';
    assert.equal(SRC.split(anchor).length - 1, 1, '破坏锚点必须恰中 1 次（先自证）');
    const dir = tmp('rp_cf_n5_');
    const broken = path.join(dir, 'check-file-broken.mjs');
    fs.writeFileSync(broken, SRC.split(anchor).join('/* 破坏：不再剥上下文 */'));
    assert.equal(typeof process.env.NODE_TEST_CONTEXT, 'string',
        '前提：本套件必须真跑在测试运行器子进程里，否则这条破坏测不到东西');
    const bad = spawnSync(process.execPath, [broken, '--root', repo, '--log', path.join(dir, 'x.log')],
        { cwd: ROOT, encoding: 'utf8', timeout: 300000 });
    assert.equal(bad.status, 2, '\u2605 不剥上下文时门会「绿着不跑」⇒ 必须 fail-closed（exit 2）而不是报绿');
    assert.match(String(bad.stdout || ''), /读不到/, '必须明说读数读不到（这正是 fail-closed 挡住假绿的那一下）');
    assert.match(fs.readFileSync(path.join(dir, 'x.log'), 'utf8'), /skipping running files/,
        '破坏副本的日志里必须真的出现「自跳」那条 warning（否则这条破坏没打中要害）');
    /* ③ 对照：真源码上同款判据为真（不是「破坏不存在」的假绿） */
    assert.match(stripComments(SRC), /delete childEnv\.NODE_TEST_CONTEXT/, '对照：真源码确实剥了上下文');
});

/* ══════════ E 版本锚 ══════════ */
const VNUM = (s) => String(s).split('.').reduce((a, x) => a * 1000 + Number(x), 0);

test('E1 版本锚（下限形）+ 五源同源 + 弹窗逐字同源', () => {
    const idx = read('index.js');
    const man = JSON.parse(read('manifest.json'));
    const log = JSON.parse(read('update-log.json'));
    const codeVer = (/const ST_PHONE_VERSION = '([^']+)'/.exec(idx) || [])[1];
    assert.equal(codeVer, man.version, '入口 == manifest');
    assert.equal(pkg.version, man.version, 'package == manifest');
    assert.equal(log.latest, man.version, 'update-log.latest == manifest');
    assert.equal(Object.keys(log.versions)[0], man.version, '当版条目须在首位');
    assert.ok(VNUM(man.version) >= VNUM('3.20.1'), '本套件自 3.20.1 起成立；当前 ' + man.version);
    const m = idx.match(/const ST_PHONE_CURRENT_UPDATE = {[\s\S]*?\n};/);
    assert.ok(m, '公告块可提取');
    const items = log.versions[log.latest].items;
    for (const it of items) assert.ok(m[0].includes(JSON.stringify(it)), '弹窗逐字同源：' + String(it).slice(0, 24));
    assert.match(m[0], new RegExp('date: "' + log.versions[log.latest].date + '"'), 'date 同源');
    /* 形态锚（不绑专有词）：本版落点 / 本版自己抓到的缺陷 / 交棒改写 */
    assert.equal(items.some((v) => new RegExp('版本升至 ' + log.latest + '（五源同源）').test(v)), true,
        '当版条目须点名本版落点（形态锚）');
    assert.equal(items.some((v) => /自己抓到的缺陷|本版自己抓到|缺陷形态/.test(v)), true,
        '当版条目须如实记录本版自己抓到的缺陷（形态锚）');
    assert.equal(items.some((v) => /交棒改写|主动改写|下限形/.test(v)), true,
        '当版条目须如实记录对旧判据的交棒改写（形态锚）');
});

test('E2 边界文档与当版同源（复校标记在场 + 两道真门读数逐项一致）', () => {
    const doc = read('docs/runtime-verification-boundary.md');
    assert.ok(doc.includes('v' + pkg.version + ' 复校'), '边界文档必须带当版复校标记');
    const syn = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'syntax-check.mjs')],
        { cwd: ROOT, encoding: 'utf8', timeout: 120000 });
    assert.equal(syn.status, 0, '语法门必须能跑通');
    const live = (/语法门通过：(\d+) 个文件/.exec(syn.stdout || '') || [])[1];
    const docN = (/语法 (\d+) 文件/.exec(doc) || [])[1];
    assert.ok(live && docN, '两侧都必须有语法文件数');
    assert.equal(Number(docN), Number(live), '文档读数（' + docN + '）必须等于真跑（' + live + '）');
    const imp = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'import-resolve-check.mjs')],
        { cwd: ROOT, encoding: 'utf8', timeout: 120000 });
    assert.equal(imp.status, 0, '导入门必须能跑通');
    const mi = /扫描 (\d+) 个文件 · 静态相对导入 (\d+) 条/.exec(imp.stdout || '');
    assert.ok(mi, '导入门必须报出扫描面与条数');
    const docImp = /导入 (\d+) 文件 (\d+) 条/.exec(doc);
    assert.ok(docImp, '文档必须写明导入面读数');
    assert.equal(Number(docImp[1]), Number(mi[1]), '文档导入文件数必须等于真跑');
    assert.equal(Number(docImp[2]), Number(mi[2]), '文档导入条数必须等于真跑');
});
