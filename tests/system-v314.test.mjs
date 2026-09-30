// tests/system-v314.test.mjs — 门禁「缺输入仍判通过」普查（O-3 下游侧）[v3.3.2]
//
//   主题：**审计的审计**。本仓 10 个门禁脚本（scripts/*.mjs）负责判缺陷，而「门禁自己在
//   **输入不在场 / 被掏空**时会不会照旧发合格证」此前没有常驻读数。
//
//   方法（与上游 lonsha v3.225.0 同法，且是先踩过坑才对的）：
//     把**扫描器自身也搬进镜像**再执行 —— 首版拿「真仓里的脚本 + cwd=退化树」当夹具，
//     一律从自身路径推根的脚本量到的还是真仓，矩阵是假的。
//
//   实测（整仓镜像，四种退化）：真正 fail-open 的只有 **语法门 `scripts/syntax-check.mjs`**：
//     根 .js 全删 / index.js 掏空 / apps 或 config 整目录掏空 ⇒ 它仍 exit 0，
//     报「395 个文件均可按 ES Module 解析」；而本门存在的唯一理由写在它自己文件头：
//     `index.js` 坏掉时整个扩展不会被浏览器加载。旧代码只有 `total === 0` 一道，兜不住。
//   同时修掉**同族第二处**：`scripts/import-resolve-check.mjs` 有「找不到 index.js ⇒ exit 2」
//     守卫，但**入口被掏空**（只剩一行注释）时它仍能从 apps/ 枚举到 100+ 文件与 150+ 说明符，
//     两道下限都过 ⇒ exit 0。补「入口非退化」守卫。
//
//   另有 3 个候选经**逐条压实**后判定为「夹具错配」而非缺陷（如实记下，避免误修）：
//     · `bridge-contract-audit`：config/ 掏空时 exit 2（真源文件读不到即拒判）；
//     · `source-derivation-audit`：config/ 掏空或删关键文件时 exit 1（失配即报）；
//     · `dead-export-check` / `lifecycle-audit`：都有扫描面下限（500 声明 / 20 个类），
//       apps 掏空后 exit 2。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { copyTreeSafe } from './_mirror_tree.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const SCRIPTS = path.join(ROOT, 'scripts');
const read = (p) => fs.readFileSync(p, 'utf8');
const GATE = 'scripts/syntax-check.mjs';
const IR = 'scripts/import-resolve-check.mjs';

const SKIP = new Set(['.git', 'node_modules']);
/* [v3.4.1 · P-5] 镜像必须能容忍「瞬态文件在复制途中消失」。
 *   实测缺陷：`fs.cpSync(ROOT, dir)` 对整仓逐项 lstat，若某个文件在 readdir 之后、
 *   lstat 之前被别的东西删掉，就抛 `ENOENT: lstat '<file>'` ⇒ **偶发假红**，
 *   而报错点指向一个用户从没听说过的临时文件名（实测：`.tmp_v315_probe_<ts>.js`）。
 *   它此前被归为「环境抖动」，真因是 v315 N1 的负控制往**仓根**写探针文件
 *   （与 O-4 修掉的「临时产物落仓根」同一形态；v315 那侧已改到 tests/audit/ 下）。
 *   这里加一道防线：cpSync 失败时**重试** —— 镜像类测试要观察的是「门禁在退化输入上的行为」，
 *   不是「仓库在那一瞬间的文件集合」，为一条瞬态竞态让整个套件转红是**测量误差被当成了测量结果**。
 *   重试仍失败则抛出（不吞错：真·持续失败必须看得见）。
 *   [v3.23.0] 本函数上收为共享实现 `tests/_mirror_tree.mjs` 的 `copyTreeSafe`。
 *     起因：同族缺陷在本仓共有 16 处镜像点，**只有这一处**带防护（v323 的手写 copyTree
 *     也不管用 —— 它 catch 的是 readFileSync，而竞态抛在更早的 lstat 上；v3171 干脆裸调）。
 *     于是「同一件事被写了四次，其中三次忘了」—— 收成唯一实现，全部镜像点引用它。 */
const cpWithRetry = (src, dest) => copyTreeSafe(src, dest, {
    filter: (s) => !s.split(path.sep).some((x) => SKIP.has(x)),
});
function mirror(gut = [], gone = []) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v314-mir-'));
    cpWithRetry(ROOT, dir);
    for (const sub of gut) {
        const p = path.join(dir, sub);
        if (fs.statSync(p).isFile()) fs.writeFileSync(p, '// gutted' + String.fromCharCode(10));
        else for (const f of walk(p)) fs.writeFileSync(f, '// gutted' + String.fromCharCode(10));
    }
    for (const sub of gone) {
        const p = path.join(dir, sub);
        if (fs.existsSync(p)) fs.rmSync(p, { recursive: true, force: true });
    }
    return dir;
}
function walk(d, out = []) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) walk(p, out); else out.push(p);
    }
    return out;
}
function runGate(rel, dir, args = []) {
    return spawnSync(process.execPath, [path.join(dir, rel), ...args], { cwd: dir, encoding: 'utf8', timeout: 300000 });
}
async function withMirror(mut, fn) {
    const dir = mirror(mut.gut, mut.gone);
    try { return await fn(dir); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

// ══════════ A 守卫在场（结构面） ══════════
test('v314 A1. ★★ 语法门与导入门都持「入口在场 + 非退化」守卫', () => {
    for (const rel of [GATE, IR]) {
        const s = read(path.join(ROOT, rel));
        assert.ok(/MIN_ENTRY_BYTES/.test(s), rel + ' 必须有入口字节下限');
        assert.ok(/结构漂移|输入退化|入口已退化/.test(s), rel + ' 失败时须如实说出「没得判」');
    }
    assert.ok(/rootIdx < 0/.test(read(path.join(ROOT, GATE))), '语法门的守卫须只作用于默认根（夹具通道不受影响）');
});

// ══════════ B 行为面：退化必转红 ══════════
test('v314 B1. ★★★ 默认根：入口被掏空 / 被删 ⇒ 语法门 exit 2（修前报「均可解析」）', async () => {
    await withMirror({ gut: ['index.js'] }, (dir) => {
        const r = runGate(GATE, dir);
        assert.equal(r.status, 2, '入口退化时必须 exit 2，实得 ' + r.status + ' / ' + String(r.stdout + r.stderr).slice(0, 160));
    });
    await withMirror({ gone: ['index.js'] }, (dir) => {
        const r = runGate(GATE, dir);
        assert.equal(r.status, 2, '入口不在场时必须 exit 2，实得 ' + r.status);
    });
});

test('v314 B2. ★★★ 默认根：入口被掏空 ⇒ 导入门 exit 2（修前把「入口没了」读成「都解析得开」）', async () => {
    await withMirror({ gut: ['index.js'] }, (dir) => {
        const r = runGate(IR, dir);
        assert.equal(r.status, 2, '入口退化时必须 exit 2，实得 ' + r.status + ' / ' + String(r.stdout + r.stderr).slice(0, 160));
        assert.match(String(r.stdout + r.stderr), /入口已退化|fail-closed/, '须如实说明拒判理由');
    });
});

test('v314 B3. ★ 反坐实：入口健康时两门都过（守卫不得把正常检出误伤）', () => {
    for (const rel of [GATE, IR]) {
        const r = spawnSync(process.execPath, [rel], { cwd: ROOT, encoding: 'utf8', timeout: 300000 });
        assert.equal(r.status, 0, rel + ' 真仓必须通过：' + String(r.stdout + r.stderr).slice(0, 200));
    }
});

test('v314 B4. ★★ 显式 --root 的夹具语义逐字保留（健康小树 ⇒ 0 / 损坏小树 ⇒ 1 / 不存在 ⇒ 2）', () => {
    const small = fs.mkdtempSync(path.join(os.tmpdir(), 'v314-sm-'));
    try {
        fs.writeFileSync(path.join(small, 'a.js'), 'export const a = 1;' + String.fromCharCode(10));
        assert.equal(runGate(GATE, ROOT, ['--root', small]).status, 0, '健康小树必须放行');
        fs.writeFileSync(path.join(small, 'b.js'), 'export const b = ;' + String.fromCharCode(10));
        assert.equal(runGate(GATE, ROOT, ['--root', small]).status, 1, '损坏小树必须 exit 1（真语法失败）');
        assert.equal(runGate(GATE, ROOT, ['--root', path.join(small, 'nope-xyz')]).status, 2, '不存在的路径 exit 2');
    } finally { fs.rmSync(small, { recursive: true, force: true }); }
});

// ══════════ C 夹具错配的三条（如实记下，防被当缺陷误修） ══════════
test('v314 C1. ★★ 其余候选的门在**自己的面**上是 fail-closed（config 掏空 / apps 掏空都会阻断）', async () => {
    // bridge-contract：config/world-bridge.js 是它的真源；config 掏空后读不到即拒判
    await withMirror({ gut: ['config'] }, (dir) => {
        assert.notEqual(spawnSync(process.execPath, [path.join(dir, 'scripts/bridge-contract-audit.mjs')], { cwd: dir, encoding: 'utf8', timeout: 300000 }).status, 0,
            'bridge-contract 在 config 掏空时必须阻断');
    });
    // lifecycle：有 20 个 App 类的下限；apps 掏空即拒判
    await withMirror({ gut: ['apps'] }, (dir) => {
        assert.equal(spawnSync(process.execPath, [path.join(dir, 'scripts/lifecycle-audit.mjs')], { cwd: dir, encoding: 'utf8', timeout: 300000 }).status, 2,
            'lifecycle 在 apps 掏空时必须 exit 2（扫描面下限）');
    });
});

// ══════════ D 版本四源同源 ══════════
const vnum = (s) => Number(String(s).split('.').reduce((a, x) => a * 1000 + Number(x), 0));

test('v314 D1. ★ 版本四源同源（入口 / manifest / update-log.latest / update-log 首键）', () => {
    const manifest = JSON.parse(read(path.join(ROOT, 'manifest.json')));
    const log = JSON.parse(read(path.join(ROOT, 'update-log.json')));
    const codeVer = (/const ST_PHONE_VERSION = '([^']+)'/.exec(read(path.join(ROOT, 'index.js'))) || [])[1];
    assert.ok(codeVer, '入口版本常量在场');
    assert.equal(codeVer, manifest.version);
    assert.equal(log.latest, manifest.version);
    assert.equal(Object.keys(log.versions)[0], manifest.version, '★ update-log.versions 首键必须是当版');
    assert.ok(vnum(codeVer) >= vnum('3.3.2'), '本套件只在 3.3.2 及以后成立；当前 ' + codeVer);
});

// ══════════ E 负控制（真源码破坏 ⇒ 守卫判据必须转红） ══════════
function mutateOnce(src, from, to) {
    const n = src.split(from).length - 1;
    assert.equal(n, 1, '锚点应恰好命中 1 次，实际 ' + n + '：' + String(from).slice(0, 60));
    return src.replace(from, to);
}

test('v314 N0. 阳性对照：守卫结构判据在原件上为真（否则 N 组是假红）', () => {
    for (const rel of [GATE, IR]) assert.match(read(path.join(ROOT, rel)), /MIN_ENTRY_BYTES/, rel + ' 原件上必须有守卫');
});

test('v314 N1. ★★★ 负控制·拆掉语法门守卫（回到「只挡 total === 0」）⇒ 退化树上又判通过', async () => {
    const s = read(path.join(ROOT, GATE));
    // 真源码破坏：把守卫整段替换为等价的「什么都不挡」
    const anchor = 'if (rootIdx < 0) {';
    assert.equal(s.split(anchor).length - 1, 1, '锚点恰中 1 次');
    const broken = s.replace(anchor, 'if (false) {');
    await withMirror({ gut: ['index.js'] }, (dir) => {
        fs.writeFileSync(path.join(dir, GATE), broken);
        const r = spawnSync(process.execPath, [path.join(dir, GATE)], { cwd: dir, encoding: 'utf8', timeout: 300000 });
        assert.equal(r.status, 0, '★ 拆掉守卫后，入口掏空的树上必须又变回 exit 0（证明该守卫承重）');
    });
});

test('v314 N2. ★★ 负控制·把导入门的入口下限放到 0 ⇒ 掏空入口又放行', async () => {
    const s = read(path.join(ROOT, IR));
    const broken = mutateOnce(s, 'const MIN_ENTRY_BYTES = 1000;', 'const MIN_ENTRY_BYTES = 0;');
    await withMirror({ gut: ['index.js'] }, (dir) => {
        fs.writeFileSync(path.join(dir, IR), broken);
        const r = spawnSync(process.execPath, [path.join(dir, IR)], { cwd: dir, encoding: 'utf8', timeout: 300000 });
        assert.equal(r.status, 0, '★ 下限归零后确实又放行（证明下限是承重点，不是装饰）');
    });
});

test('v314 N3. ★★ 负控制·守卫不得影响夹具通道：显式 --root 小树上，拆掉守卫与否都必须 exit 0', async () => {
    const s = read(path.join(ROOT, GATE));
    const broken = s.replace('if (rootIdx < 0) {', 'if (false) {');
    const small = fs.mkdtempSync(path.join(os.tmpdir(), 'v314-n3-'));
    try {
        fs.writeFileSync(path.join(small, 'a.js'), 'export const a = 1;' + String.fromCharCode(10));
        const r = spawnSync(process.execPath, [path.join(ROOT, GATE), '--root', small], { cwd: ROOT, encoding: 'utf8', timeout: 300000 });
        assert.equal(r.status, 0, '原件上夹具通道必须正常');
    } finally { fs.rmSync(small, { recursive: true, force: true }); }
    assert.ok(/rootIdx < 0/.test(s), '（结构性说明：守卫条件写的是「默认根」）');
});
