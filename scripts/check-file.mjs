#!/usr/bin/env node
/* ============================================================
 * scripts/check-file.mjs — 全量门禁落文件执行器（计划一「共同配套」第 4 条）[v3.20.1]
 * ------------------------------------------------------------
 * 【为什么有它】
 *   计划一「共同配套」第 4 条原文：「记忆插件发布跑 `npm test`，…；手机跑 `npm run check`
 *   十道检查。**全量输出落文件**，真宿主项目另留实机记录。」
 *   仓内实测：全量输出落文件**零落地**（`package.json` 只有裸 `&&` 串联的 check，
 *   输出直落终端）。这不是「少个方便」，而是一次**真实事故**：
 *     `npm run check 2>&1 | grep … | sort -u | head -10` 在本环境（proot）里
 *     管道写入报 `Function not implemented` ⇒ 下游 `head` 提前退出 ⇒ `grep` 写已关闭的
 *     管道 ⇒ **`npm run check` 整条命令卡死**，会话被占住、结果取不到，
 *     而外层看起来只是「命令没输出」。
 *   同族形态在一分钟内又出现第二次：另一次全量跑改用重定向落文件，**成功**了；
 *   但第二条全量跑与前一条**并发**，两棵树抢同一个临时探针文件
 *   （`tests/audit/.tmp_v315_probe_<ts>.js`），把一条判据刷成
 *   `ENOENT: lstat …` 的**假红**（单跑 10/10 全绿）。
 *   两条教训都指向同一个机制缺口：**跑法不该由人手拼**。
 *
 * 【它做什么】
 *   ① **全程零管道**：每道门 spawn 时把 stdout/stderr 直接接到**日志文件 fd**，
 *      不经过任何消费者进程 —— 消费者提前退出就不可能再把门卡住。
 *   ② **落文件即断言对象**：日志文件写出后，**重新读回它**解析读数
 *      （语法门文件数 / 导入门文件数与条数 / 判据门的 tests·pass·fail / 各审计门的主读数），
 *      与逐门退出码一起进汇总行 —— 「文档里说的」与「机器真跑的」由此同源。
 *   ③ **汇总也落文件**：一条命令之后，结果在文件里、在终端上各有一份。
 *
 * 【判据（fail-closed）】
 *   G1 读不到主读数 ⇒ **拒判 exit 2**，不判通过。理由与第九道门同款：
 *      「缺输入仍判通过」是本仓治过的形态（v3.3.2 O-3）；一道门的读数行被改写、
 *      而执行器照旧报绿，等于把「读数对账」变成摆设。
 *   G2 门退出码 1 ⇒ 整体 exit 1（真有红）；退出码 2 ⇒ 整体 exit 2（拒判，与红分开）。
 *   G3 链形不认识（`scripts.check` 里出现非 `npm run <name>` 的段）⇒ exit 2，不猜。
 *
 * 【口径：门清单的真源是 `package.json` 的 `scripts.check`，本文件不另存一份】
 *   （与 `CONTEXT.md` 那行的纪律同款：入口本身是唯一真源，其余都是转写。）
 *
 * 【为什么主读数只登记一条（不是「全都要」）】
 *   每道门的读数行不止一处，全登记会让门的**措辞改进**变成红灯，从而逼人为了消红
 *   去改执行器 —— 那是「为了让门变绿而削判据」的方向。故每门只钉**一条主读数**：
 *   它必须与门真跑的数一致；其余读数仍逐字落文件里可查。
 *
 * 用法：
 *   node scripts/check-file.mjs                      # 跑 scripts.check 全链，日志落系统临时目录
 *   node scripts/check-file.mjs --log <path>         # 指定日志路径（跑全链时别指仓内，见上）
 *   node scripts/check-file.mjs --root <dir>         # 指定仓库根（夹具通道）
 *   node scripts/check-file.mjs --show               # 跑完把日志尾部打到终端
 * 退出码：0=全绿  1=有门报红  2=拒判（读不到读数 / 链形不认识 / 有门 exit 2）
 * ============================================================ */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const argOf = (name) => (args.indexOf(name) >= 0 ? args[args.indexOf(name) + 1] : null);
const ROOT = path.resolve(argOf('--root') || path.join(HERE, '..'));
const SHOW = args.includes('--show');
/* ★ 日志**默认落在仓外**（系统临时目录），不是仓内 —— 这条是本版实跑换来的：
 *   执行器把日志写进仓内（`tests/check-last.log`）时，它一边跑 `npm run check`、
 *   一边往仓里写文件，于是**本仓自己的隔离判据**（v315 B1「跑批不得改动仓库，
 *   文件集合 / size / mtime 逐项快照 + git status 干净」）当场转红，点名那份日志。
 *   那条判据是对的：**包住门禁的工具不得改动门禁正在观测的树**。
 *   要入库的证据请显式 `--log <仓内路径>`，但那只能在**不跑全链**时用
 *   （跑全链时写仓内必然触发隔离判据 —— 这是设计，不是缺陷）。 */
/* 每次默认日志用时间戳 + pid 唯一命名，而不是共用一个 last 文件：
 *   ① 全量 `npm run test` 内部会真跑本工具做隔离自证；若内外层共用路径，内层 rmSync 会 unlink 外层日志，
 *      外层 fd 仍写旧 inode、却从路径读到内层日志，主读数串台并拒判。
 *   ② 两个独立 check:file 并发时也不应抢同一个日志路径。
 * 输出汇总始终打印实际路径，调用方无需猜；想固定路径可显式传 --log。 */
const LOG = path.resolve(argOf('--log') || path.join(os.tmpdir(), 'rp-check-' + Date.now() + '-' + process.pid + '.log'));

if (!fs.existsSync(path.join(ROOT, 'package.json'))) {
    console.error('✗ 拒判：' + ROOT + ' 下没有 package.json（门清单的真源不在场）');
    process.exit(2);
}

/* ── 每道门的主读数：id / 标签 / 正则 / 取第几组 ──
 *  正则在**日志全文**上找（读回来那一次），不是拿内存里的字符串 —— 对账对象就是落盘那份。 */
const READS = {
    syntax: [{ id: 'files', label: '语法文件数', re: /语法门通过：(\d+) 个文件均可按 ES Module 解析/, g: 1 }],
    'import-resolve': [
        { id: 'files', label: '扫描文件数', re: /扫描 (\d+) 个文件/, g: 1 },
        { id: 'specs', label: '静态导入条数', re: /静态相对导入 (\d+) 条/, g: 1 }
    ],
    test: [
        { id: 'tests', label: '判据数', re: /^ℹ tests (\d+)$/m, g: 1 },
        { id: 'pass', label: '通过', re: /^ℹ pass (\d+)$/m, g: 1 },
        { id: 'fail', label: '失败', re: /^ℹ fail (\d+)$/m, g: 1 }
    ],
    'dead-exports': [
        { id: 'exports', label: '导出声明数', re: /(\d+) 个 export 声明/, g: 1 },
        { id: 'zero', label: '零消费导出', re: /零消费 (\d+)）/, g: 1 }
    ],
    lifecycle: [
        { id: 'apps', label: '含出口的 App 类', re: /扫描 (\d+) 个含生命周期出口的 App 类/, g: 1 },
        { id: 'slots', label: '实例槽位', re: /(\d+) 个实例槽位/, g: 1 }
    ],
    registry: [
        { id: 'apps', label: 'App id 数', re: /APPS id (\d+)/, g: 1 },
        { id: 'lazy', label: '懒加载分支', re: /懒加载分支 (\d+)/, g: 1 }
    ],
    keys: [
        { id: 'uses', label: '键使用点', re: /storage 键使用点 (\d+) 个/, g: 1 },
        { id: 'registered', label: '登记条数', re: /登记 (\d+) 条/, g: 1 }
    ],
    'source-derivation': [{ id: 'files', label: '枚举面文件数', re: /枚举面命中 (\d+) 个文件/, g: 1 }],
    'bridge-contract': [{ id: 'face_points', label: 'faceFieldState 消费点', re: /faceFieldState 消费点 (\d+) 个/, g: 1 }],
    'weak-coercion': [
        { id: 'files', label: '枚举面文件数', re: /枚举面 (\d+) 文件/, g: 1 },
        { id: 'refs', label: '唯一实现被引用', re: /唯一实现被引用 (\d+) 文件/, g: 1 }
    ]
};

/* ── 链：从真源解析（不另存一份门清单） ── */
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const chainRaw = String((pkg.scripts || {}).check || '');
if (!chainRaw) {
    console.error('✗ 拒判：package.json 的 scripts.check 不在场（门清单真源缺失）');
    process.exit(2);
}
const GATES = [];
for (const seg of chainRaw.split('&&').map((s) => s.trim()).filter(Boolean)) {
    const m = /^npm run ([a-z0-9-]+)$/.exec(seg);
    if (!m) {
        console.error('✗ 拒判：scripts.check 里有本执行器不认识的段「' + seg + '」（不猜，先对齐真源）');
        process.exit(2);
    }
    GATES.push(m[1]);
}
/* 每道门都必须有主读数登记（未登记 ⇒ 拒判：读数对账不许有漏网的门） */
for (const g of GATES) {
    if (!READS[g]) {
        console.error('✗ 拒判：门 `' + g + '` 没有登记主读数 —— 新门要么补登记，要么它就不进 scripts.check');
        process.exit(2);
    }
}

fs.mkdirSync(path.dirname(LOG), { recursive: true });
try { fs.rmSync(LOG, { force: true }); } catch (_e) { /* 上一次的日志留着也没意义 */ }
const fd = fs.openSync(LOG, 'a');

/* ★ 子进程环境必须**剥掉测试运行器的上下文标记**（本版实跑换来的第三条，也是被自己的判据抓到的）：
 *   `node --test` 会给每个测试文件注入 `NODE_TEST_CONTEXT=child-v8` / `NODE_TEST_WORKER_ID`。
 *   执行器若照抄这两项，则链上任何**本身就是 `node --test`** 的门会打印
 *   `Warning: node:test run() is being called recursively within a test file. skipping running files.`
 *   然后 **exit 0 且一条读数都不报** —— 门看起来「绿了」，实际一个文件都没跑。
 *   本版第一次端到端跑判据时就是这个形态：七条判据齐齐变红，而执行器的 fail-closed
 *   （读不到读数即拒判）替我们挡住了它，没让它变成假绿。
 *   这与上面那条日志位置是同一个纪律的两面：**包住门禁的工具不得把自己的上下文塞给门禁**。 */
const childEnv = { ...process.env };
delete childEnv.NODE_TEST_CONTEXT;
delete childEnv.NODE_TEST_WORKER_ID;

const line = (s) => { const b = Buffer.from(s + String.fromCharCode(10)); fs.writeSync(fd, b); };
const say = (s) => { console.log(s); };
const nodev = process.version;

line('# check-file 全量门禁日志');
line('# 仓库：' + ROOT);
line('# 版本：' + String(pkg.version || '?') + ' · node ' + nodev);
line('# 开始：' + new Date().toISOString());
line('# 链（真源 package.json scripts.check）：' + GATES.join(' -> '));
line('');

const results = [];
let worst = 0; // 0 全绿 / 1 有红 / 2 拒判

for (const gate of GATES) {
    const t0 = Date.now();
    line('');
    line('===== [' + gate + '] npm run ' + gate + ' =====');
    /* ★ 全程零管道：子进程的 fd 1/2 直接就是日志文件，没有中间消费者 */
    const r = spawnSync('npm', ['run', gate], { cwd: ROOT, stdio: ['ignore', fd, fd], env: childEnv, timeout: 1800000 });
    const ms = Date.now() - t0;
    const code = typeof r.status === 'number' ? r.status : (r.error ? -1 : 1);
    line('');
    line('----- [' + gate + '] 退出码 ' + code + ' · ' + ms + 'ms -----');
    results.push({ gate, code, ms, reads: [] });
    if (code === 1) worst = Math.max(worst, 1);
    if (code === 2) worst = Math.max(worst, 2);
    if (code !== 0 && code !== 1 && code !== 2) {
        line('# ⚠ 退出码 ' + code + ' 不是 0/1/2 三档之一（可能是被信号杀掉或 npm 自身失败）');
        worst = Math.max(worst, 2);
    }
}

/* ── 读回日志（对账对象 = 落盘那份），解析主读数 ── */
const text = fs.readFileSync(LOG, 'utf8');
const parseFails = [];
for (const res of results) {
    for (const spec of READS[res.gate]) {
        const m = spec.re.exec(text);
        if (!m) { parseFails.push(res.gate + '.' + spec.id + '（' + spec.label + '）'); continue; }
        res.reads.push({ id: spec.id, label: spec.label, value: Number(m[spec.g]) });
    }
}
if (parseFails.length) worst = Math.max(worst, 2);

/* ── 汇总（既落文件也上终端） ── */
const summary = [];
summary.push('');
summary.push('===== check-file 汇总 =====');
for (const res of results) {
    const tag = res.code === 0 ? '✓' : (res.code === 1 ? '✗' : '‼');
    const body = res.reads.map((x) => x.id + '=' + x.value).join(' · ');
    summary.push('  ' + tag + ' ' + res.gate.padEnd(18) + ' exit=' + res.code + ' ' + String(res.ms + 'ms').padStart(8) + '  ' + body);
}
summary.push('');
summary.push('  读数（主读数，逐门）：');
for (const res of results) for (const x of res.reads) summary.push('    ' + res.gate + '.' + x.id + ' = ' + x.value + '   # ' + x.label);
if (parseFails.length) {
    summary.push('');
    summary.push('  ‼ 拒判：以下主读数在日志里读不到（门措辞改了？）⇒ **不判通过**：');
    for (const p of parseFails) summary.push('      ' + p);
}
summary.push('');
summary.push('  日志：' + LOG + '（' + Buffer.byteLength(text) + ' 字节）');
summary.push('  结论：' + (worst === 0 ? '全部门通过（' + GATES.length + ' 道）' : worst === 1 ? '**有门报红**' : '拒判（读数读不到 / 有门 exit 2 / 链或退出码异常）'));
for (const s of summary) line(s);
fs.closeSync(fd);
for (const s of summary) say(s);
if (SHOW) say(text.split(String.fromCharCode(10)).slice(-40).join(String.fromCharCode(10)));
process.exit(worst);
