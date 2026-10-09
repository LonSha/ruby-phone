#!/usr/bin/env node
/* ============================================================
 * scripts/hardlink-safety-check.mjs — 硬链接安全门（v3.78.0 起进链的第十五段）
 * ------------------------------------------------------------
 * 【为什么有这道门（两次实测事故，不是推演）】
 *   本仓的验证容器以 proot `--link2symlink` 运行。该模式下**任何硬链接创建**
 *   （`ln` / `cp -al` / 连 `git clone` 内部给 pack 建硬链）都被模拟成
 *   「把**源文件**改名成 `.l2s.*` 别名，再在原名处放一个指向它的符号链接」。
 *   于是受害者不只是「复制目标」—— **创建硬链接的那一方，其源树会被反向改写**。
 *
 *   ① v2.65.0 实测：某个负控制用 `cp -al <真仓库>` 建副本，把 425 个已跟踪文件
 *      变成指向临时别名名字的悬空符号链接（靠 `git checkout -- .` 恢复）。
 *      当时只把「禁止 `cp -al`」写进了 `CONTEXT.md`，**没有任何门拦着它再来一次**。
 *   ② v3.77.0 实测（此前从未登记）：`git clone` **自身**即触发同一模拟 ——
 *      它在 `.git/objects/pack` 建硬链时把 `pack-*.{pack,idx,rev}` 改名成 `.l2s.tmp_*`，
 *      规范名退化为**绝对路径符号链接**（指回克隆当时的路径）。于是仓库一旦被
 *      `mv` / 原地重建，链接全部悬空 ⇒ `git log` 报 `bad object HEAD`、`git fsck` 报
 *      一批 `unable to mmap`。此形态**落在 `.git/` 之内、不在工作树**，
 *      会整个越过「只查工作树有没有 `.l2s`」的旧判据。
 *
 * 【判据（四条，全部在看真源码 / 真磁盘，不看注释）】
 *   ⚠️ 先说清一件**实测纠正过的事**：`.git/objects` 里出现 `.l2s.*` **不是**损坏签名 ——
 *      本容器的 proot 在**任何一次正常提交**里都会留下 `tmp_obj_NNNN + tmp_obj_NNNN.0001`
 *      这一对（实测：全新 `git init` + 一次 commit 即产生 3 对，而 git 一切正常）。
 *      最初版本的判据把「`.git` 里有别名」当红灯，那会让这道门**每次提交后自红**。
 *      真签名是下面 H2 / H4 两条。
 *
 *   H1 **真调用面**：`scripts/` `tools/` `tests/` `apps/` `config/` 下**产品与工具代码**
 *      不得真去建硬链接（`fs.linkSync` / `fs.link(` / `exec*('ln'|'cp')`）。
 *      只拦「调用」，不拦字面提到 —— 本仓大量注释在**记录**这起事故（`CONTEXT.md`、
 *      `tests/system-v265.test.mjs`、`tests/system-v3770.test.mjs`），
 *      把「提到」也算违规就是把记录本身当成了病（本仓治过的形态：判据输入面 ≠ 结论面）。
 *      合法复制走 `fs.cpSync`（`tests/_mirror_tree.mjs` 的 `copyTreeSafe`）—— 它不建硬链。
 *   H2 **工作树被改写**（`cp -al` 事故的签名）：工作树侧（**排除 `.git`**）
 *      零 `.l2s.*`、零符号链接。这条正是 v2.65.0 那 425 个文件坏掉时的形态：
 *      已跟踪文件被改名 + 原名处留下链接。实测对照：事故中的主仓 7538 个链接，健康仓 0。
 *   H3 **`.git` 可用**：`git status --porcelain` 能跑（rc 0）。仓库被损坏时它直接 fatal
 *      （实测：`fatal: not a git repository` / `fatal: bad object HEAD`）。
 *   H4 **HEAD 可达**：`git rev-parse HEAD` 成功**且** `git cat-file -t HEAD` 返回 `commit`。
 *      这条把「pack 索引被改名成 `.l2s.tmp_*`、规范名退化为悬空链接」这一形态钉住 ——
 *      那种仓库 `git status` 可能仍不乱报，但 HEAD 一定取不出来。
 *
 * 【为什么 H2 与 H4 必须都在（只留一条都拦不住）】
 *   两次事故分居两侧：v2.65.0 是**工作树**被改写（H2 抓），v3.77.0 是**对象库**
 *   被改写（H4 抓）。任一条单用都会对另一半完全沉默。
 *
 * 【边界（诚实，四条）】
 *   · 本门**不**回改任何东西：发现残留只报位置与形态，清除是人 / 脚本的显式动作
 *     （v3.77.0 实测：`git prune` 会连带删掉从未提交的松散对象 ⇒ 自动清理是危险动作）。
 *   · 本门**不**覆盖 `ROOT` 之外的任意路径；它守的是「这个仓库还能用吗」，
 *     不是「整台机器干不干净」。`os.tmpdir()` 与 ROOT 父目录只作**旁证**报数，
 *     不判红（本容器里住着别的项目，实测该两处有 27 万余条别名，判红会让这门永远红
 *     —— 而「永远红的门 = 没有门」）。
 *   · `git` 不可用（非仓库 / 未装 git）时，H3/H4 走**拒判（exit 2）**，不判通过。
 *   · 扫描面低于下限（默认 50 个源文件）同样**拒判**：扫描目录写错时
 *     「0 命中」与「干净」同形（本仓 v3.3.2 O-3 同款纪律）。
 * ============================================================ */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
/* `--root <dir>` 夹具通道：本仓所有工具的通行做法（负控制必须在**副本**上跑真判据，
 *   绝不动真仓）。默认仍是本仓。 */
const argv = process.argv.slice(2);
const argOf = (n) => (argv.indexOf(n) >= 0 ? argv[argv.indexOf(n) + 1] : null);
const ROOT = path.resolve(argOf('--root') || path.join(HERE, '..'));

/* 扫描面下限：低于这个数 ⇒ **拒判（exit 2）**，不判通过。
 *   理由同本仓 v3.3.2 O-3：「缺输入仍判通过」是最贵的假绿形态。若 SCAN_DIRS 写错一个
 *   字符、或目录被挪走，扫描面会静默变成 0，而 0 命中看起来与「干净」一模一样。
 *   本仓这五个目录现有约 685 个源文件，下限取 50（留足余量，但仍能拦住「扫了个寂寞」）。 */
const SCAN_FLOOR = 50;

/* 只扫产品与工具代码；不扫 .git / node_modules / 构建产物 */
const SCAN_DIRS = ['scripts', 'tools', 'tests', 'apps', 'config'];
const SCAN_EXT = new Set(['.mjs', '.js', '.cjs', '.ts']);

/** 剥掉注释与字符串字面量：判据必须落在**真代码**上（本仓 E6 同款纪律）。 */
function stripNonCode(src) {
    let out = '';
    let i = 0;
    const n = src.length;
    let mode = 'code'; // code | line | block | sq | dq | tpl
    while (i < n) {
        const c = src[i];
        const c2 = src.slice(i, i + 2);
        if (mode === 'code') {
            if (c2 === '//') { mode = 'line'; i += 2; continue; }
            if (c2 === '/*') { mode = 'block'; i += 2; continue; }
            if (c === "'") { mode = 'sq'; i += 1; continue; }
            if (c === '"') { mode = 'dq'; i += 1; continue; }
            if (c === '`') { mode = 'tpl'; i += 1; continue; }
            out += c; i += 1; continue;
        }
        if (mode === 'line') { if (c === '\n') { mode = 'code'; out += c; } i += 1; continue; }
        if (mode === 'block') { if (c2 === '*/') { mode = 'code'; i += 2; } else i += 1; continue; }
        if (mode === 'sq') { if (c === '\\') { i += 2; continue; } if (c === "'") mode = 'code'; i += 1; continue; }
        if (mode === 'dq') { if (c === '\\') { i += 2; continue; } if (c === '"') mode = 'code'; i += 1; continue; }
        if (mode === 'tpl') { if (c === '\\') { i += 2; continue; } if (c === '`') mode = 'code'; i += 1; continue; }
    }
    return out;
}

/**
 * 真调用面：把「建硬链接」与「跑 ln/cp 命令」两类调用摘出来。
 * ⚠️ 只认**调用形态**（后面紧跟 `(`），字面提到不算 —— 见 H1 的来由。
 */
const CALL_PATTERNS = [
    { id: 'fs.linkSync', re: /\bfs\s*\.\s*linkSync\s*\(/ },
    { id: 'fs.link', re: /\bfs\s*\.\s*link\s*\(/ },
    { id: 'fs.promises.link', re: /\bfs\s*\.\s*promises\s*\.\s*link\s*\(/ },
    { id: 'exec ln', re: /\b(?:execSync|execFileSync|spawnSync|execFile|spawn)\s*\(\s*(?:process\.env\.SHELL\s*\|\|\s*)?['"]ln['"]/ },
    { id: 'exec cp', re: /\b(?:execSync|execFileSync|spawnSync|execFile|spawn)\s*\(\s*(?:process\.env\.SHELL\s*\|\|\s*)?['"]cp['"]/ },
];

function walk(dir, acc) {
    let ents = [];
    try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (_e) { return acc; }
    for (const e of ents) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) {
            if (e.name === 'node_modules' || e.name === '.git' || e.name === '__pycache__') continue;
            walk(p, acc);
        } else if (e.isFile() && SCAN_EXT.has(path.extname(e.name))) {
            acc.push(p);
        }
    }
    return acc;
}

/** 递归数 `.l2s.*`（只作旁证报数，不判红）。
 *  ⚠️ 必须有**截断**：本容器 `/tmp` 实测有 22 万余条别名（别的项目的），
 *     无限深走会让这道门慢到不可用 —— 门自己拖垮迭代节奏是本仓治过的形态。
 *     截断后如实说 `≥N（已截断）`，不冒充精确值（本仓「没给与给了 0 不许同形」同族）。 */
function countAliases(root, dirCap = 500) {
    let n = 0;
    let dirs = 0;
    let capped = false;
    const stack = [root];
    while (stack.length) {
        if (dirs >= dirCap) { capped = true; break; }
        const d = stack.pop();
        dirs += 1;
        let ents = [];
        try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch (_e) { continue; }
        for (const e of ents) {
            if (e.name.startsWith('.l2s.')) n += 1;
            if (e.isDirectory()) stack.push(path.join(d, e.name));
        }
    }
    return { n, capped, dirs };
}

function git(args) {
    const r = spawnSync('git', args, { cwd: ROOT, encoding: 'utf8', timeout: 60000 });
    return { ok: r.status === 0, status: r.status, out: String(r.stdout || ''), err: String(r.stderr || '') };
}

/* ================= 主流程 ================= */
const fails = [];
const notes = [];

/* ---- H1：真调用面 ---- */
const files = [];
for (const d of SCAN_DIRS) walk(path.join(ROOT, d), files);
/* fail-closed：扫描面低于下限 ⇒ 拒判（不判通过）。见文件头 SCAN_FLOOR 的来由。 */
if (files.length < SCAN_FLOOR) {
    console.error('[hardlink-safety] ✗ 拒判：扫描面只有 ' + files.length + ' 个文件（下限 ' + SCAN_FLOOR
        + '）—— 扫描目录写错 / 被挪走时「0 命中」与「干净」同形，故不判通过');
    console.error('[hardlink-safety] 主读数：硬链接违规 — 拒判（扫描面不足）');
    process.exit(2);
}
const callHits = [];
for (const f of files) {
    let src = '';
    try { src = fs.readFileSync(f, 'utf8'); } catch (_e) { continue; }
    const code = stripNonCode(src);
    for (const pat of CALL_PATTERNS) {
        if (pat.re.test(code)) callHits.push({ file: path.relative(ROOT, f), kind: pat.id });
    }
}
if (callHits.length) {
    for (const h of callHits) fails.push('H1 真调用硬链接/复制命令：' + h.file + ' → ' + h.kind);
}
console.log('[hardlink-safety] 扫描 ' + files.length + ' 个文件 · 真调用命中 ' + callHits.length + ' 处'
    + (callHits.length ? '' : '（合法复制走 fs.cpSync / copyTreeSafe，不建硬链）'));

/* ---- H2：工作树被改写（`cp -al` 事故签名） ---- */
/* 判据只落在**工作树侧**（排除 `.git`）：`.git/objects` 里的 `tmp_obj_NNNN*` 是正常提交
 *   的产物（实测：全新 `git init` + 一次 commit 即有 3 对），拿它判红会让门每次提交自红。 */
const wtAliases = [];
const wtLinks = [];
(function scanWorktree(dir, isRoot) {
    let ents = [];
    try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (_e) { return; }
    for (const e of ents) {
        if (isRoot && e.name === '.git') continue;
        const p = path.join(dir, e.name);
        if (e.name.startsWith('.l2s.')) wtAliases.push(path.relative(ROOT, p));
        if (e.isSymbolicLink()) { wtLinks.push(path.relative(ROOT, p)); continue; }
        if (e.isDirectory()) scanWorktree(p, false);
    }
}(ROOT, true));
if (wtAliases.length) {
    fails.push('H2 工作树侧残留 ' + wtAliases.length + ' 个 .l2s.* 别名（例：' + wtAliases.slice(0, 5).join('、') + '）—— 已跟踪文件被改名的签名');
}
if (wtLinks.length) {
    fails.push('H2 工作树侧有 ' + wtLinks.length + ' 个符号链接（例：' + wtLinks.slice(0, 5).join('、') + '）—— `cp -al` 事故签名（v2.65.0 实测 425 文件）');
}
console.log('[hardlink-safety] 工作树侧：.l2s.* 别名 ' + wtAliases.length + ' 个 · 符号链接 ' + wtLinks.length + ' 个');

/* 旁证（不判红）：这两处住着别的项目，实测 27 万余条 ── 报数是为了让「这台机器上
 *   这套模拟正在发生」可见，判红则会让本门永远红。 */
const soft = [];
/* ROOT 父目录只列一层（避免递归进兄弟仓库 —— 它们有 `.git`，会拖慢本门）；
 * os.tmpdir() 递归但有目录数上限（见 countAliases 的截断纪律）。 */
for (const d of [{ name: 'ROOT 父目录', dir: path.dirname(ROOT), shallow: true }, { name: 'os.tmpdir()', dir: os.tmpdir(), shallow: false }]) {
    if (!fs.existsSync(d.dir)) continue;
    if (d.shallow) {
        let n = 0;
        try {
            for (const e of fs.readdirSync(d.dir, { withFileTypes: true })) if (e.name.startsWith('.l2s.')) n += 1;
        } catch (_e) { /* 读不到就报 0 层 */ }
        soft.push(d.name + '（顶层）=' + n);
    } else {
        const r = countAliases(d.dir);
        soft.push(d.name + '=' + (r.capped ? '≥' + r.n + '（已截断，扫了 ' + r.dirs + ' 目录）' : r.n));
    }
}
console.log('[hardlink-safety] 旁证（不判红，责任不在本仓）：' + soft.join(' · '));

/* ---- H3：`.git` 可用 ---- */
let gitUsable = false;
if (fs.existsSync(path.join(ROOT, '.git'))) {
    const st = git(['status', '--porcelain']);
    if (st.ok) {
        gitUsable = true;
        const dirty = st.out.split('\n').filter((l) => l.trim().length > 0);
        if (dirty.length) notes.push('H3 工作树有 ' + dirty.length + ' 项改动（开发常态，不判红）');
    } else {
        fails.push('H3 `git status` 不可用（rc=' + st.status + '）：' + (st.err.trim().split('\n')[0] || '(无 stderr)')
            + ' —— 这是仓库被损坏的签名，不是「有改动」');
    }
} else {
    fails.push('H3 ROOT 下没有 .git —— 版本控制面不在场（不得计通过）');
}

/* ---- H4：HEAD 可达 ---- */
if (gitUsable) {
    const head = git(['rev-parse', 'HEAD']);
    if (!head.ok) {
        fails.push('H4 `git rev-parse HEAD` 失败：' + (head.err.trim().split('\n')[0] || '(无 stderr)'));
    } else {
        const t = git(['cat-file', '-t', 'HEAD']);
        if (!t.ok || t.out.trim() !== 'commit') {
            fails.push('H4 HEAD 不是可达的 commit 对象（cat-file → ' + (t.out || t.err).trim().split('\n')[0]
                + '）—— 对象库被改写的签名（pack 索引被改名 / 链接悬空）');
        } else {
            console.log('[hardlink-safety] HEAD 可达：' + head.out.trim().slice(0, 12) + ' · .git 可用=' + gitUsable);
        }
    }
} else {
    console.log('[hardlink-safety] git 不可用 ⇒ H4 未判（已由 H3 判红）');
}

/* ---- 汇总 ---- */
if (fails.length) {
    console.error('[hardlink-safety] ✗ 不合格 ' + fails.length + ' 项：');
    for (const f of fails) console.error('  · ' + f);
    console.error('[hardlink-safety] 主读数：硬链接违规 ' + fails.length + ' 项');
    process.exit(1);
}
console.log('[hardlink-safety] ✓ 硬链接安全：无真调用 / 本仓无别名孤儿 / .git 完整 / HEAD 可达');
console.log('[hardlink-safety] 主读数：硬链接违规 0 项');
process.exit(0);
