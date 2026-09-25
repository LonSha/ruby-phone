// tests/system-v315.test.mjs — 门禁隔离与耗时（O-4 下游侧）[v3.3.3]
//
//   两件事各立一条判据：
//     ① **隔离**：跑批不得改动仓库（文件集合 / size / mtime 逐项快照 + git status 干净）；
//     ② **耗时**：读 tests/gate_timing_baseline.json 的基线，子集墙钟不得越过上界
//        （上界刻意宽：本判据拦的是**数量级倒退**，不赌机器的瞬时抖动）。
//
//   本轮实测读数（无头环境）：9 个门禁串行合计 **84.9s**，其中 `test` 段 **70.9s = 83%**，
//   其余 8 门合计 14s。所以「优化门禁耗时」实质就是「优化 tests 段」；
//   而 8 个门禁脚本各自独立、串行仅 14s，段间并行的收益上限就是它的一部分 —— **不值当**。
//   这些「不做什么」逐条写在基线的 `not_done` 里，并由本套件守着（A2）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const BASE = path.join(ROOT, 'tests', 'gate_timing_baseline.json');
const read = (p) => fs.readFileSync(p, 'utf8');
const base = JSON.parse(read(BASE));

// ══════════ A 基线本体 ══════════
test('v315 A1. ★★ 基线四件齐备：逐门耗时 / 主导项 / 隔离方法 / 没做什么', () => {
    for (const k of ['per_gate_s', 'dominant', 'isolation', 'not_done', 'subsets']) assert.ok(base[k], '缺面：' + k);
    assert.ok(Array.isArray(base.gates_all) && base.gates_all.length === 9, '九道门清单');
    for (const g of base.gates_all) assert.ok(Number.isFinite(base.per_gate_s[g]), g + ' 必须有耗时读数');
    assert.ok(base.dominant && base.dominant.gate === 'test', '主导项必须点名 test 段');
    assert.ok(Number(base.serial_total_s) > 0, '必须有串行合计');
});

test('v315 A2. ★★★ 「没做什么」逐条可读（不把「我们量了」讲成「我们优化了」）', () => {
    const txt = base.not_done.join(String.fromCharCode(10));
    assert.ok(/并行/.test(txt), '须写明未做段间并行及理由');
    assert.ok(/耗时优化|只取证/.test(txt), '须写明本版只取证不优化');
    assert.ok(/宿主|浏览器/.test(txt), '须写明无宿主读数');
    assert.ok(/调参|最贵/.test(txt), '须写明未拆 tests 段并行度调参');
});

test('v315 A3. ★★ 口径不得被当成实机：基线须声明「无头环境 / 不代表实机」', () => {
    const txt = JSON.stringify(base);
    assert.ok(/无头环境/.test(txt), '必须写明无头环境');
    assert.ok(/浏览器|宿主/.test(txt), '必须写明无浏览器 / 宿主参与');
});

// ══════════ B 隔离：跑批不得改动仓 ══════════
function snapshot(root) {
    const out = new Map();
    const walk = (d) => {
        for (const e of fs.readdirSync(d, { withFileTypes: true })) {
            if (e.name === '.git' || e.name === 'node_modules') continue;
            const p = path.join(d, e.name);
            if (e.isDirectory()) { walk(p); continue; }
            try { const st = fs.statSync(p); out.set(path.relative(root, p), st.size + ':' + Math.round(st.mtimeMs)); }
            catch (err) { /* 瞬态文件不参与 */ }
        }
    };
    walk(root);
    return out;
}
function diff(before, after) {
    const drift = [];
    for (const k of new Set([...before.keys(), ...after.keys()])) {
        if (before.get(k) !== after.get(k)) drift.push(k);
    }
    return drift;
}

async function withRepoWatch(fn) {
    const before = snapshot(ROOT);
    const g0 = spawnSync('git', ['status', '--porcelain'], { cwd: ROOT, encoding: 'utf8' }).stdout || '';
    let res;
    try { res = await fn(); } finally {
        const after = snapshot(ROOT);
        const g1 = spawnSync('git', ['status', '--porcelain'], { cwd: ROOT, encoding: 'utf8' }).stdout || '';
        res = res || {};
        res.__drift = diff(before, after);
        res.__gitBefore = g0; res.__gitAfter = g1;
    }
    return res;
}
function runOne(rel) {
    return spawnSync(process.execPath, [rel], { cwd: ROOT, encoding: 'utf8', timeout: 300000 });
}

test('v315 B1. ★★★ 隔离：门禁跑完后仓快照与 git status 零差异', async () => {
    const spec = base.subsets.gates;
    const t0 = Date.now();
    const r = await withRepoWatch(async () => {
        for (const rel of ['scripts/syntax-check.mjs', 'scripts/import-resolve-check.mjs', 'scripts/keys-audit.mjs']) {
            const x = runOne(rel);
            if (x.status !== 0) return { status: x.status, out: String(x.stdout + x.stderr).slice(0, 200) };
        }
        return { status: 0, out: '' };
    });
    const wall = (Date.now() - t0) / 1000;
    assert.equal(r.status, 0, '子集必须在健康仓上通过：' + r.out);
    assert.deepEqual(r.__drift, [], '跑批改动了仓库（隔离被破坏）：' + r.__drift.slice(0, 8).join(' | '));
    assert.equal(r.__gitAfter, r.__gitBefore, '跑批后 git status 变了');
    assert.ok(wall <= spec.upper_bound_s, 'gate 子集墙钟 ' + wall.toFixed(1) + 's 越过上界 ' + spec.upper_bound_s + 's');
});

test('v315 B2. ★★ 耗时：两组子集墙钟不得越过各自上界（拦数量级倒退）', () => {
    const t0 = Date.now();
    const rt = spawnSync(process.execPath, ['--test', 'tests/system-v313.test.mjs', 'tests/system-v314.test.mjs'],
        { cwd: ROOT, encoding: 'utf8', timeout: 600000 });
    const wt = (Date.now() - t0) / 1000;
    assert.equal(rt.status, 0, 'tests 子集必须通过：' + String(rt.stdout + rt.stderr).slice(0, 200));
    assert.ok(wt <= base.subsets.tests.upper_bound_s,
        'tests 子集 ' + wt.toFixed(1) + 's > 上界 ' + base.subsets.tests.upper_bound_s + 's');

    const t1 = Date.now();
    for (const rel of base.subsets.gates.cmds.map((c) => c.replace(/^node\s+/, ''))) {
        const x = runOne(rel);
        assert.equal(x.status, 0, rel + ' 必须通过');
    }
    const wg = (Date.now() - t1) / 1000;
    assert.ok(wg <= base.subsets.gates.upper_bound_s,
        'gate 子集 ' + wg.toFixed(1) + 's > 上界 ' + base.subsets.gates.upper_bound_s + 's');
});

// ══════════ C 版本四源同源 ══════════
const vnum = (s) => Number(String(s).split('.').reduce((a, x) => a * 1000 + Number(x), 0));

test('v315 C1. ★ 版本四源同源（入口 / manifest / update-log.latest / update-log 首键）', () => {
    const manifest = JSON.parse(read(path.join(ROOT, 'manifest.json')));
    const log = JSON.parse(read(path.join(ROOT, 'update-log.json')));
    const codeVer = (/const ST_PHONE_VERSION = '([^']+)'/.exec(read(path.join(ROOT, 'index.js'))) || [])[1];
    assert.ok(codeVer, '入口版本常量在场');
    assert.equal(codeVer, manifest.version);
    assert.equal(log.latest, manifest.version);
    assert.equal(Object.keys(log.versions)[0], manifest.version, '★ update-log.versions 首键必须是当版');
    assert.ok(vnum(codeVer) >= vnum('3.3.3'), '本套件只在 3.3.3 及以后成立；当前 ' + codeVer);
});

// ══════════ D 负控制 ══════════
test('v315 N1. ★★ 负控制·隔离：往仓里写一个文件 ⇒ 快照比对必须抓到漂移', () => {
    /* [v3.4.1] 与本套件自己主张的口径对齐：探针文件**不落在仓根**。
     *   原写法 `path.join(ROOT, '.tmp_v315_probe_<ts>.js')` 一边主张「跑批零改仓」，
     *   一边往仓根写文件 —— 跑批期间它确实有零点几秒存在，而并行的整仓镜像类测试
     *   （system-v314 的 `cpSync(ROOT, …)`）正好会 cpSync 到它，碰上它被 unlink 的瞬间
     *   就抛 `ENOENT: lstat '.../.tmp_v315_probe_<ts>.js'` ⇒ **偶发假红**，
     *   与 O-4 修掉的「5 个测试把临时产物落仓根」是**同一个形态**。
     *   注意：本判据点名仓根**不是**为了拦它（那是别的门禁的事），
     *   而是因为要观测的漂移必须发生在被快照的树里。 */
    const victim = path.join(ROOT, 'tests', 'audit', '.tmp_v315_probe_' + Date.now() + '.js');
    const before = snapshot(ROOT);
    fs.writeFileSync(victim, '// probe' + String.fromCharCode(10));
    try {
        const after = snapshot(ROOT);
        const drift = diff(before, after);
        assert.ok(drift.length >= 1, '快照比对必须抓到新增文件（否则 B1 的隔离判据是空跑）');
        assert.ok(drift.some((d) => d.includes('.tmp_v315_probe_')), '抓到的漂移必须就是那个探针文件');
    } finally { fs.unlinkSync(victim); }
});

test('v315 N2. ★★ 负控制·耗时上界：构造越界值 ⇒ 同款越界判据必须为真', () => {
    const spec = base.subsets.tests;
    const probe = spec.upper_bound_s + 1;
    assert.ok(probe > spec.upper_bound_s, '越界判据在构造值上必须为真');
    assert.ok(spec.wall_s <= spec.upper_bound_s, '原件上必须成立（否则基线自相矛盾）');
});

test('v315 N3. ★★ 负控制·把无头读数讲成实机 ⇒ A3 判据必须转红', () => {
    const strip = (t) => t.replace(/无头环境/g, '实机环境').replace(/无浏览器|无宿主|浏览器|宿主/g, '真机');
    const polluted = strip(JSON.stringify(base));
    assert.ok(!/无头环境/.test(polluted), '污染后确实失去「无头环境」声明');
    assert.ok(/无头环境/.test(JSON.stringify(base)), '对照：原件上必须有');
});
