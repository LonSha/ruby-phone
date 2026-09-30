// tests/system-v313.test.mjs — 三份同名 numOrNull 口径统一（O-8）[v3.3.1]
//
//   主题：**同一条口径不许在一个仓里存在两种严格度**。
//   本仓此前有三份同名 `numOrNull`：
//     · `config/projection-contract.js:95`（强：先看类型，`'  '` / `[]` / `true` 一律 null）
//     · `config/injection-contract.js:118`（强，注释写明「与 projection-contract 同因同法」）
//     · `apps/place/place-data.js:99`（**弱一格**：只挡 `null` / `undefined` / `''`）
//   实测弱口径：`'  ' → 0`、`[] → 0`、`true → 1`、`false → 0`、`[5] → 3`（`Number([5])`）。
//
//   为什么当时没动（v3.3.0·O-1 轮的判定，如实记下）：怪值只能来自上游外供面，而上游已收口为
//   `number | null`，可达性为零。**O-8 收它的理由**：本仓不该靠上游自觉 —— 同一条口径两种严格度，
//   读代码的人无法判断该信哪一份；且「可达性为零」是**上游的状态**，不是本仓的保证。
//
//   层次：A 三份实现同口径（逐条怪值 + 真值）
//         B 真模块行为（走导出面，`projectScene` 的在场分组）
//         C 强口径在场（结构）
//         D 版本四源同源
//         E 负控制（真源码破坏 → 整仓镜像 → 同款真判据必须转红）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { copyTreeSafe } from './_mirror_tree.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

const PC = 'config/projection-contract.js';
const IC = 'config/injection-contract.js';
const PD = 'apps/place/place-data.js';
const PC_SRC = read(PC), IC_SRC = read(IC), PD_SRC = read(PD);
const PD_MOD = await import(pathToFileURL(path.join(ROOT, PD)).href);

/** 强口径的逐字特征（先看类型）。 */
const STRONG = "if (typeof v !== 'number' && typeof v !== 'string') return null;";
const GIVEN = [['null', null], ['undefined', undefined], ["''", ''], ["'  '", '  '], ['[]', []], ['[5]', [5]], ['{}', {}], ['true', true], ['false', false], ['NaN', NaN], ["'1a'", '1a'], ["'甲'", '甲']];
const REAL = [['0', 0], ["'0'", '0'], ['5', 5], ["'5'", '5'], ["' 5 '", ' 5 '], ['3.5', 3.5]];

/** 从源码里抽出门本体并在**本进程**里跑（三份都跑，防某一份悄悄演化）。 */
function gateOf(src) {
    const m = /function numOrNull\(v\) \{[\s\S]*?\n\}/.exec(src);
    assert.ok(m, 'numOrNull 本体可提取');
    return new Function('return (' + m[0] + ')')();
}

// ══════════ A 三份同口径 ══════════
test('v313 A1. ★★★ 三份同名 numOrNull 都是强口径（先看类型）', () => {
    for (const [name, src] of [[PC, PC_SRC], [IC, IC_SRC], [PD, PD_SRC]]) {
        assert.ok(src.includes(STRONG), name + ' 必须用强口径（与另两份逐字同形）');
    }
});

test('v313 A2. ★★★ 三份门本体行为逐条一致：怪值一律 null，真给 0 仍是 0', () => {
    for (const [name, src] of [[PC, PC_SRC], [IC, IC_SRC], [PD, PD_SRC]]) {
        const gate = gateOf(src);
        for (const [label, v] of GIVEN) assert.equal(gate(v), null, name + ' 对 ' + label + ' 须判「没给」');
        for (const [label, v] of REAL) assert.equal(gate(v), Number(v), name + ' 对 ' + label + ' 须如实给数');
    }
});

// ══════════ B 真模块行为（走导出面） ══════════
test('v313 B1. ★★★ 真模块上：脏 atFloor 一律不出数（弱口径下会出 0/1/3）', () => {
    for (const [label, v] of GIVEN) {
        const face = { presence: [{ name: '甲', key: '某地', atFloor: v }], visits: [], tree: [], nodes: [], track: [] };
        const out = PD_MOD.projectScene(face);
        const items = (out && out.presence) || [];
        assert.equal(items.length, 1, label + ' 分组仍应在场（不因取值奇怪而整组消失）');
        assert.equal(items[0].atFloor, null, '★ ' + label + ' 必须如实 null，实得 ' + JSON.stringify(items[0].atFloor));
    }
});

test('v313 B2. ★★ 反坐实：真给 0 / 5 / " 5 " 照常出数（门不得关成「谁都取不到」）', () => {
    for (const [label, v] of REAL) {
        const face = { presence: [{ name: '甲', key: '某地', atFloor: v }], visits: [], tree: [], nodes: [], track: [] };
        const out = PD_MOD.projectScene(face);
        assert.equal(out.presence[0].atFloor, Number(v), '★ ' + label + ' 须如实给 ' + Number(v));
    }
});

// ══════════ C 结构面 ══════════
test('v313 C1. ★ 三处各自持门（不跨层共享），且注释互指同族', () => {
    assert.ok(/同因同法|同口径|口径逐字同/.test(PD_SRC), 'place-data 的注释须与另两份互认同族');
    assert.ok(!/from '.*projection-contract.*'/.test(PD_SRC), 'place-data 不得为了省代码去 import config/*（避免 apps ↔ config 反向依赖）');
});

// ══════════ D 版本四源同源 ══════════
const vnum = (s) => Number(String(s).split('.').reduce((a, x) => a * 1000 + Number(x), 0));

test('v313 D1. ★ 版本四源同源（入口 / manifest / update-log.latest / update-log 首键）', () => {
    const manifest = JSON.parse(read('manifest.json'));
    const log = JSON.parse(read('update-log.json'));
    const idxSrc = read('index.js');
    const codeVer = (/const ST_PHONE_VERSION = '([^']+)'/.exec(idxSrc) || [])[1];
    assert.ok(codeVer, '入口版本常量在场');
    assert.equal(codeVer, manifest.version, '入口 == manifest');
    assert.equal(log.latest, manifest.version, 'update-log.latest == manifest');
    assert.equal(Object.keys(log.versions)[0], manifest.version, '★ update-log.versions 首键必须是当版');
    assert.ok(log.versions[manifest.version], 'update-log 含当版条目');
    assert.ok(vnum(codeVer) >= vnum('3.3.1'), '本套件只在 3.3.1 及以后成立；当前 ' + codeVer);
});

// ══════════ E 负控制（真源码破坏 → 整仓镜像 → 同款真判据转红） ══════════
function mutateOnce(src, from, to) {
    const n = src.split(from).length - 1;
    assert.equal(n, 1, '锚点应恰好命中 1 次，实际 ' + n + '：' + String(from).slice(0, 60));
    return src.replace(from, to);
}
function mirror(mut) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v313-mir-'));
    copyTreeSafe(ROOT, dir, { filter: (s) => !s.split(path.sep).includes('.git') });
    for (const [rel, fn] of Object.entries(mut)) {
        const body = fn(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
        assert.notEqual(body, fs.readFileSync(path.join(ROOT, rel), 'utf8'), '破坏未发生：' + rel);
        fs.writeFileSync(path.join(dir, rel), body);
    }
    return dir;
}
async function withMirror(mut, fn) {
    const dir = mirror(mut);
    try { return await fn(dir); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

/** J1 数据层：三份门本体 + 真模块行为（与 A/B 同款）。 */
async function dataJudge(mod, srcs) {
    for (const src of srcs) {
        const gate = gateOf(src);
        for (const [, v] of GIVEN) if (gate(v) !== null) return false;
        for (const [, v] of REAL) if (gate(v) !== Number(v)) return false;
    }
    for (const [, v] of GIVEN) {
        const face = { presence: [{ name: '甲', key: '某地', atFloor: v }], visits: [], tree: [], nodes: [], track: [] };
        const out = mod.projectScene(face);
        if (!out || !out.presence || out.presence.length !== 1) return false;
        if (out.presence[0].atFloor !== null) return false;
    }
    for (const [, v] of REAL) {
        const face = { presence: [{ name: '甲', key: '某地', atFloor: v }], visits: [], tree: [], nodes: [], track: [] };
        if (mod.projectScene(face).presence[0].atFloor !== Number(v)) return false;
    }
    return true;
}

test('v313 N0. 镜像树自证 + 阳性对照：未破坏时 J1 三条面全真（否则 N 组是假绿）', async () => {
    assert.equal(await dataJudge(PD_MOD, [PC_SRC, IC_SRC, PD_SRC]), true, 'J1 在原件上必须为真');
    const dir = mirror({});
    try {
        assert.ok(fs.existsSync(path.join(dir, PD)), '镜像里必须带上数据层本体');
        assert.ok(fs.existsSync(path.join(dir, 'tests', 'system-v313.test.mjs')), '镜像里必须带上本套件');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('v313 N1. ★★★ 负控制·弱口径复活：place-data 退回「只挡 null/undefined/空串」⇒ 表现必变', async () => {
    const WEAK = "    if (typeof v !== 'number' && typeof v !== 'string') return null;\n    if (typeof v === 'string' && !v.trim()) return null;";
    const BACK = "    if (v === null || v === undefined || v === '') return null;";
    await withMirror({
        [PD]: (s) => mutateOnce(s, WEAK, BACK)
    }, async (dir) => {
        const broken = await import(pathToFileURL(path.join(dir, PD)).href + '?m=' + Date.now());
        const bs = fs.readFileSync(path.join(dir, PD), 'utf8');
        assert.equal(await dataJudge(broken, [bs]), false, '★ J1 在弱口径副本上必须为 false（$\'  \'$ 会出 0）');
        assert.equal(await dataJudge(PD_MOD, [PD_SRC]), true, '对照：原件上仍为真');
        // 并显式证明差异可观测（否则这条负控制只是「换了字符串」）
        const g = gateOf(bs);
        assert.equal(g('  '), 0, '弱口径下 $\'  \'$ 确实被读成 0（差异可观测）');
        assert.equal(gateOf(PD_SRC)('  '), null, '强口径下为 null');
    });
});

test('v313 N2. ★★ 负控制·三份之一退回弱口径 ⇒ A1/A2 必须转红（同一口径不许两种严格度）', async () => {
    const WEAK = "    if (typeof v !== 'number' && typeof v !== 'string') return null;\n    if (typeof v === 'string' && !v.trim()) return null;";
    const BACK = "    if (v === null || v === undefined || v === '') return null;";
    await withMirror({ [PC]: (s) => mutateOnce(s, WEAK, BACK) }, async (dir) => {
        const pcSrc = fs.readFileSync(path.join(dir, PC), 'utf8');
        assert.equal(await dataJudge(PD_MOD, [pcSrc]), false, '★ config 那份退化后 J1 必须转红（三份不再同口径）');
        assert.equal(gateOf(pcSrc)('  '), 0, '弱口径下确实出 0');
    });
});

test('v313 N3. ★★ 负控制·互不掩护：弱口径只打掉「怪值」面，真给 0 面必须仍成立', async () => {
    const WEAK = "    if (typeof v !== 'number' && typeof v !== 'string') return null;\n    if (typeof v === 'string' && !v.trim()) return null;";
    const BACK = "    if (v === null || v === undefined || v === '') return null;";
    await withMirror({ [PD]: (s) => mutateOnce(s, WEAK, BACK) }, async (dir) => {
        const broken = await import(pathToFileURL(path.join(dir, PD)).href + '?m=' + Date.now());
        const face = (v) => ({ presence: [{ name: '甲', key: '某地', atFloor: v }], visits: [], tree: [], nodes: [], track: [] });
        assert.equal(broken.projectScene(face('  ')).presence[0].atFloor, 0, '怪值面确实被读成 0（破坏生效）');
        assert.equal(broken.projectScene(face(0)).presence[0].atFloor, 0, '★ 真给 0 面仍成立（真判断的是「谁该为 null」）');
        assert.equal(broken.projectScene(face(5)).presence[0].atFloor, 5, '★ 真给 5 面仍成立');
    });
});
