/* ============================================================
 * tests/system-v3780.test.mjs — 硬链接安全门（第十五段）与其真实根因 [v3.78.0]
 * ------------------------------------------------------------
 * 本版把一件**发生过两次、却只写在文档里**的事故变成**机器可验的门**：
 *   本容器的 proot `--link2symlink` 把**任何硬链接创建**模拟成
 *   「源文件改名成 `.l2s.*` 别名 + 原名处建符号链接」。受害者是**创建者自己的源树**。
 *
 * 两次实测（都不是推演）：
 *   ① v2.65.0：某负控制 `cp -al <真仓>` ⇒ 425 个已跟踪文件退化成悬空链接（`git checkout -- .` 恢复）。
 *   ② v3.77.0：`git clone` 自身在 `.git/objects/pack` 建硬链 ⇒ `pack-*.{pack,idx,rev}` 被改名，
 *      规范名变成**绝对路径**符号链接；仓库一旦 `mv` / 原地重建 ⇒ `git log` 报 `bad object HEAD`。
 *
 * 本套件守五件事（全部在**真源码 / 真进程 / 真磁盘**上成立，不看注释）：
 *   A 接线：门脚本在场、进 `scripts.check` 链、预算/分档/主读数三处登记齐全（缺一处等于没接上）；
 *   B 判据面：H1 真调用面 / H2 工作树 / H3 `.git` 可用 / H4 HEAD 可达 —— 四条都在源码里点火；
 *   C 正控制：一个干净夹具（≥50 源文件 + 可用 .git）必须 **exit 0**（防「永远红的门」）；
 *   D 负控制四条：扫描面塌陷 ⇒ exit 2；H1 真调用 ⇒ exit 1；H2 工作树别名 / 符号链接 ⇒ exit 1；HEAD 不可解 ⇒ exit 1；
 *   E 冻结口径：`.git/objects` 里的 `tmp_obj_*` **不算**红灯（实测：健康仓一次提交就有 3 对）
 *     —— 这条是**被自己抓到的错**（最初版判据拿它判红，门会在每次提交后自红）。
 *
 * 分工：
 *   · 本套件回答「门有没有接上、判据会不会真红、会不会假红」；
 *   · `scripts/hardlink-safety-check.mjs` 本身回答「当前这棵树安全吗」。
 * ============================================================ */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const GATE_REL = 'scripts/hardlink-safety-check.mjs';
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const GATE_SRC = read(GATE_REL);
const pkg = JSON.parse(read('package.json'));
const VNUM = (v) => Number(String(v).replace(/[^0-9]/g, ''));

/* -------------------- 夹具 -------------------- */
/** 造一个「干净夹具」：≥50 个源文件 + 一个可用 .git（有提交，HEAD 可解）。 */
function cleanFixture(tag) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hls-' + tag + '-'));
    const sc = path.join(dir, 'scripts');
    fs.mkdirSync(sc, { recursive: true });
    for (let i = 1; i <= 60; i += 1) fs.writeFileSync(path.join(sc, 'a' + i + '.mjs'), 'export const a' + i + ' = 1;\n');
    const g = (args) => spawnSync('git', args, { cwd: dir, encoding: 'utf8', env: Object.assign({}, process.env, { GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' }) });
    g(['init', '-q', '.']);
    g(['add', '-A']);
    g(['commit', '-qm', 'init']);
    return dir;
}
const runGate = (root) => spawnSync(process.execPath, [path.join(ROOT, GATE_REL), '--root', root],
    { cwd: ROOT, encoding: 'utf8', timeout: 120000 });
const rm = (d) => { try { fs.rmSync(d, { recursive: true, force: true }); } catch (_e) { /* 忽略 */ } };

/* ================= A 接线 ================= */
test('A1 门脚本在场，且已进 scripts.check 链（未进链的门形同不存在）', () => {
    assert.ok(fs.existsSync(path.join(ROOT, GATE_REL)), '门脚本必须在场：' + GATE_REL);
    const chain = (String(pkg.scripts.check).match(/npm run ([a-z0-9-]+)/g) || []).map((s) => s.replace('npm run ', ''));
    assert.ok(chain.includes('hardlink-safety'), 'scripts.check 链必须含 hardlink-safety（当前：' + chain.join(' → ') + '）');
    assert.match(String(pkg.scripts['hardlink-safety'] || ''), /hardlink-safety-check\.mjs/,
        'npm run hardlink-safety 必须指向本门脚本（不许指向别的东西）');
});

test('A2 三处登记齐全：预算表 / 分档表 / check-file 主读数（缺一处则链路要么报错要么静默降级）', () => {
    /* ① 预算表：check-file 跑链时按它逐门对账，缺此门 ⇒ 与 scripts.check 链错位 */
    const budget = JSON.parse(read('config/gate-budget.json'));
    assert.ok(budget.gates['hardlink-safety'], 'gate-budget.json 必须登记本门');
    const g = budget.gates['hardlink-safety'];
    assert.ok(Number.isInteger(g.ms) && g.ms > 0, 'ms 必须是正整数（实测基线）');
    assert.equal(g.limit_ms, Math.round(g.ms * (1 + budget.margin_pct / 100)), 'limit_ms 必须 = ms × (1+margin)（口径同源）');
    assert.ok(String(g.why || '').length > 10, '必须写清「为什么这个量级」（否则后人无法判断超预算是否异常）');

    /* ② 分档表：静态档清单必须含本门 */
    const tiers = JSON.parse(read('config/gate-tiers.json'));
    const cmds = tiers.tiers.static.commands.map((c) => String(c));
    assert.ok(cmds.some((c) => /hardlink-safety/.test(c)), 'gate-tiers.json 静态档必须含本门');

    /* ③ check-file 主读数：未登记 ⇒ check-file 直接 exit 2 拒判（这是设计，不是缺陷） */
    const cf = read('scripts/check-file.mjs');
    assert.match(cf, /'hardlink-safety':\s*\[/, 'check-file.mjs 的 READS 必须登记本门主读数');
    assert.match(cf, /主读数：硬链接违规 \(\\d\+\) 项/, '主读数正则必须与门实际输出对齐（对不上就是静默拒判）');
});

/* ================= B 判据面 ================= */
test('B1 四条判据都在源码里点火（不是只写在注释里）', () => {
    /* 剥掉注释后再找：**注解里提到**不算点火（本仓纪律：判据必须落在真代码上）。
     *   用 includes 而非正则 —— 要找的字符串本身就含正则元字符（`\s` / `\(`），
     *   用正则去匹配它们极易写出「看起来对、实则匹配不到」的假判据。 */
    const code = GATE_SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    for (const needle of [
        'CALL_PATTERNS',            // H1：模式表
        'linkSync',                 // H1：拦 fs.linkSync
        "'exec ln'",                // H1：拦 exec ln（模式表里的 id 字符串）
        "'exec cp'",                // H1：拦 exec cp（`cp -al` 的形态）
        "startsWith('.l2s.')",      // H2：按键名数别名（不 deref）
        'isSymbolicLink()',         // H2：数工作树符号链接
        "'--porcelain'",            // H3：真跑 git status
        "'-t'",                     // H4：cat-file -t
        "'HEAD'",                   // H4：验 HEAD
    ]) {
        assert.ok(code.includes(needle), '源码里必须真出现：' + needle);
    }
});

test('B2 H2 只扫工作树侧、显式跳过 .git（`.git` 里的 tmp_obj 是正常提交产物，见 E 组）', () => {
    /* 判据输入面必须与结论面一致：H2 的结论是「工作树被改写」，
     *   那么它的输入面就不该包含 `.git`（那里的 tmp_obj 与工作树无关）。 */
    assert.match(GATE_SRC, /scanWorktree/, 'H2 必须有专门的工作树扫描');
    assert.match(GATE_SRC, /isRoot && e\.name === '\.git'/, 'H2 必须在根处跳过 .git');
});

test('B3 门自带「扫描面下限」拒判（扫描目录写错时 0 命中与干净同形）', () => {
    assert.match(GATE_SRC, /SCAN_FLOOR/, '必须有扫描面下限常量');
    const seg = GATE_SRC.slice(GATE_SRC.indexOf('files.length < SCAN_FLOOR'));
    assert.ok(seg.length > 0, '必须有「扫描面 < 下限」这一支');
    assert.match(seg.slice(0, 400), /process\.exit\(2\)/, '扫描面不足必须走 exit 2（拒判），不是 exit 0');
});

test('B4 旁证统计有界（门不许自己拖垮迭代节奏）', () => {
    assert.match(GATE_SRC, /dirCap/, '旁证递归必须有目录数上限');
    assert.match(GATE_SRC, /capped/, '截断必须被记录下来（不许把截断后的数冒充精确值）');
    /* 实测：ROOT 父目录若递归会走进兄弟仓库的 `.git`，那一步单独就能吃掉几十秒。
     *   故父目录只列顶层 —— 这条把「哪天有人把它改成递归」钉住。 */
    assert.match(GATE_SRC, /shallow/, '父目录旁证必须是浅扫（防递归进兄弟仓库）');
});

/* ================= C 正控制 ================= */
test('C1 干净夹具 ⇒ exit 0（防「永远红的门」）', () => {
    const dir = cleanFixture('clean');
    try {
        const r = runGate(dir);
        assert.equal(r.status, 0, '干净夹具应 exit 0，实得 ' + r.status + '：' + (r.stderr || r.stdout).slice(0, 300));
        assert.match(r.stdout, /主读数：硬链接违规 0 项/, '主读数必须真打出来（check-file 靠它取数）');
    } finally { rm(dir); }
});

/* ================= D 负控制（四条，真破坏 → 同款判据必须改结论） ================= */
test('D1 扫描面塌陷 ⇒ exit 2 拒判（不是 exit 0）', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hls-floor-'));
    try {
        fs.mkdirSync(path.join(dir, 'scripts'), { recursive: true });
        fs.writeFileSync(path.join(dir, 'scripts', 'only.mjs'), 'export const a = 1;\n');
        const r = runGate(dir);
        assert.equal(r.status, 2, '扫描面不足必须拒判（实得 ' + r.status + '）');
        assert.match(r.stderr, /拒判：扫描面只有 1 个文件/, '必须把「扫了几个」如实报出来');
    } finally { rm(dir); }
});

test('D2 H1：夹具里写入真调用 fs.linkSync ⇒ 必须转红', () => {
    const dir = cleanFixture('h1');
    try {
        const f = path.join(dir, 'scripts', 'bad.mjs');
        fs.writeFileSync(f, 'import fs from "node:fs";\nexport function bad(a, b) { fs.linkSync(a, b); }\n');
        const g = spawnSync('git', ['add', '-A'], { cwd: dir, encoding: 'utf8' });
        void g;
        const r = runGate(dir);
        assert.equal(r.status, 1, '真调用必须转红（实得 ' + r.status + '）');
        assert.match(r.stderr, /H1 真调用硬链接/, '必须点名 H1 与文件');
        assert.match(r.stderr, /bad\.mjs/, '必须指出是哪个文件');
    } finally { rm(dir); }
});

test('D3 H1 只在**真代码**上判：注释 / 字符串里提到 `fs.linkSync(` 不得转红', () => {
    /* 本仓大量文档在**记录**这起事故（CONTEXT.md / system-v265 / system-v3770）。
     *   把「提到」也算违规，就是把记录本身当成了病 —— 判据输入面必须剥掉注释与字面量。 */
    const dir = cleanFixture('h1n');
    try {
        fs.writeFileSync(path.join(dir, 'scripts', 'doc.mjs'),
            '/* 事故记录：曾经有人写 `fs.linkSync(a, b)` 与 `cp -al`，害得整棵树退化 */\n'
            + 'export const NOTE = "fs.linkSync( 出现在字符串里";\nexport const ok = 1;\n');
        const r = runGate(dir);
        assert.equal(r.status, 0, '注释/字符串里提到不得转红（实得 ' + r.status + '）：' + (r.stderr || '').slice(0, 300));
    } finally { rm(dir); }
});

test('D4 H2：工作树出现 `.l2s.*` 别名 ⇒ 必须转红', () => {
    const dir = cleanFixture('h2a');
    try {
        fs.writeFileSync(path.join(dir, 'scripts', '.l2s.a1.mjs0001'), 'junk\n');
        const r = runGate(dir);
        assert.equal(r.status, 1, '工作树别名必须转红（实得 ' + r.status + '）');
        assert.match(r.stderr, /H2 工作树侧残留 1 个 \.l2s\.\* 别名/, '必须点名 H2 与数量');
    } finally { rm(dir); }
});

test('D5 H2：工作树出现符号链接（`cp -al` 事故签名）⇒ 必须转红', () => {
    const dir = cleanFixture('h2b');
    try {
        fs.symlinkSync(os.hostname ? '/etc/hostname' : '/etc/passwd', path.join(dir, 'scripts', 'link1'));
        const r = runGate(dir);
        assert.equal(r.status, 1, '工作树符号链接必须转红（实得 ' + r.status + '）');
        assert.match(r.stderr, /H2 工作树侧有 1 个符号链接/, '必须点名 H2 与数量');
        assert.ok(r.stderr.includes('cp -al') && r.stderr.includes('事故签名'),
            '必须把形态说清（后人要能一眼认出这是什么事故）');
    } finally { rm(dir); }
});

test('D6 H4：HEAD 不可解 ⇒ 必须转红（对象库被改写的签名）', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hls-h4-'));
    try {
        fs.mkdirSync(path.join(dir, 'scripts'), { recursive: true });
        for (let i = 1; i <= 60; i += 1) fs.writeFileSync(path.join(dir, 'scripts', 'a' + i + '.mjs'), 'export const a = 1;\n');
        spawnSync('git', ['init', '-q', '.'], { cwd: dir, encoding: 'utf8' }); // 无提交 ⇒ HEAD 不可解
        const r = runGate(dir);
        assert.equal(r.status, 1, 'HEAD 不可解必须转红（实得 ' + r.status + '）');
        assert.match(r.stderr, /H4 `git rev-parse HEAD` 失败|H4 HEAD 不是可达的 commit 对象/, '必须点名 H4');
    } finally { rm(dir); }
});

/* ================= E 冻结口径（被自己抓到的错） ================= */
test('E1 ★ `.git/objects` 里的 `tmp_obj_*` **不算**红灯（最初判据就在这自红过一次）', () => {
    /* 实测：本容器的 proot 在**任何一次正常提交**里都会留下 `tmp_obj_NNNN + tmp_obj_NNNN.0001`
     *   这一对（全新 `git init` + 一次 commit 即产生 3 对，而 git 一切正常）。
     *   最初版本把「`.git` 里有 `.l2s.*`」当红灯 ⇒ 这门会在每次提交后自红。
     *   本组把「判红域不含 `.git`」钉住：正控制夹具里**已含**这些 tmp_obj（提交产生了它们），
     *   而 C1 要求 exit 0 —— 两条一起就证明了这条口径。 */
    const dir = cleanFixture('e1');
    try {
        let n = 0;
        const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { if (e.name.startsWith('.l2s.')) n += 1; if (e.isDirectory()) walk(path.join(d, e.name)); } };
        walk(path.join(dir, '.git'));
        assert.ok(n > 0, '前提：夹具的 .git 里**应当**有 tmp_obj 别名（否则这条判据测不到东西）—— 实得 ' + n);
        const r = runGate(dir);
        assert.equal(r.status, 0, '.git 里的 tmp_obj 不得让门转红（实得 ' + r.status + '）：' + (r.stderr || '').slice(0, 300));
        assert.doesNotMatch(r.stderr, /H2/, 'H2 的判红域必须不含 .git');
    } finally { rm(dir); }
});

test('E2 门对真仓读数：本仓必须 exit 0（工作树侧零别名零链接）', () => {
    const r = spawnSync(process.execPath, [path.join(ROOT, GATE_REL)], { cwd: ROOT, encoding: 'utf8', timeout: 120000 });
    assert.equal(r.status, 0, '本仓应 exit 0，实得 ' + r.status + '：' + (r.stderr || r.stdout).slice(0, 400));
    assert.match(r.stdout, /主读数：硬链接违规 0 项/);
});

/* ================= F 版本锚（下限形） ================= */
test('F1 版本锚（下限形）：本套件自 3.78.0 起成立', () => {
    const man = JSON.parse(read('manifest.json'));
    assert.ok(VNUM(man.version) >= VNUM('3.78.0'), '本套件自 3.78.0 起成立；当前 ' + man.version);
});

console.log('\nv3780 done');
