// tests/system-v3120.test.mjs — 全仓取数口径收干（`Number(null) === 0` 族）[v3.12.0]
//
//   主题：**「没给」与「给了 0」不许同形**。
//   本仓最贵的一类错读数是 `Number.isFinite(Number(x)) ? Number(x) : null`：实测 19 输入 / 10 分歧
//   （`''` / `'  '` / `' \t '` / `'\n'` / `[]` / `['']` 读成 0，`true` 读成 1，`false` 读成 0，`[3]` 读成 3）。
//   根因治过四轮（v3.3.1 / v3.3.0 / v3.11.0 / 本版），前四轮都是**就地修那一处**，于是本版先取证：
//   同一写法仍在 14 个文件里活着（三形态：本地助手 / 内联表达式 / v3.11.0 那文件的残留）。
//   本版换做法：口径收敛为**单一实现** `config/num-gate.js`，并立第十道门常驻守。
//
//   覆盖：
//     A 口径本体（19 输入对读 + 6 条反坐实）
//     B 真模块行为（走导出面；不重写谓词）
//     C 结构面（唯一实现在场 / 调用命名保留 / 四种复发形态各自被守）
//     D 真源码破坏负控制（破坏落真文件文本 → 同款真判据在破坏副本上必须转红）
//     E 第十道门两向自证（原版必须绿 / 破坏必须红 / 工具自身锚点异常必须抛）
//     F 版本锚（五源同源，下限形）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const readRel = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const GATE_REL = 'config/num-gate.js';
const NG = await import('../config/num-gate.js');
const WALLET = await import('../apps/wallet/wallet-data.js');
const PROFILE = await import('../apps/profile/profile-data.js');
const PLOTLINE = await import('../apps/plotline/plotline-data.js');
const LEDGER = await import('../apps/ledger/ledger-data.js');
const RP = await import('../config/rollback-preview.js');
const DD = await import('../apps/diagnose/diagnose-data.js');

/** 弱口径（本版要治的那一式）——只用于**对照**，不用于实现。 */
const WEAK = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);
/** 「没给」样本：19 输入里弱口径读错的那 10 个。 */
const NOT_GIVEN = [
    ["''", ''], ["'  '", '  '], ["' \\t '", ' \t '], ["'\\n'", '\n'],
    ['[]', []], ["['']", ['']], ['[3]', [3]],
    ['true', true], ['false', false],
    ['null', null], ['undefined', undefined], ['{}', {}], ['NaN', NaN],
    ["'甲'", '甲'], ["'1a'", '1a'], ['Infinity', Infinity], ['-Infinity', -Infinity]
];
/** 「真给了数」样本（反坐实：门不得关成「谁都取不到」）。 */
const GIVEN = [
    ['0', 0], ["'0'", '0'], ['5', 5], ["'5'", '5'], ["' 5 '", ' 5 '], ['3.5', 3.5], ['-2', -2]
];

/* ══════════ A ── 口径本体 ══════════ */
test('A1 ★★★ 弱口径与强口径的对读差 ≥ 10 条（证明「要修什么」不是文字主张）', () => {
    const diffs = [];
    for (const [label, v] of NOT_GIVEN) {
        if (WEAK(v) !== NG.numOrNull(v)) diffs.push(label + '：弱=' + JSON.stringify(WEAK(v)));
    }
    assert.ok(diffs.length >= 10, '对读差必须 ≥ 10 条，实得 ' + diffs.length + '：' + diffs.join(' / '));
});

test('A2 ★★★ 「没给」一律如实 null（弱口径下会出 0 / 1 / 3）', () => {
    for (const [label, v] of NOT_GIVEN) {
        assert.equal(NG.numOrNull(v), null, label + ' 必须判「没给」，实得 ' + JSON.stringify(NG.numOrNull(v)));
    }
});

test('A3 ★★★ 反坐实：真给了数照常出数（门不得关成「谁都取不到」）', () => {
    for (const [label, v] of GIVEN) {
        assert.equal(NG.numOrNull(v), Number(v), label + ' 必须如实给 ' + Number(v));
    }
});

test('A4 ★★ 唯一实现只此一份口径：导出面恰为一个键，且本体是强口径', () => {
    const keys = Object.keys(NG).sort();
    assert.deepEqual(keys, ['numOrNull'], '导出面应恰为 [numOrNull]，实测 [' + keys.join(',') + ']');
    /* ★ 只扫**函数本体**：文件头注释里逐字引着那句弱口径写法（说明它为什么错），
     *   扫全文就会把散文当实现 —— 本仓那条「判据面不得被散文侵入」的老账，
     *   本版在自己的新判据上又踩了一次，故此处显式只取函数体。 */
    const src = readRel(GATE_REL);
    const body = (/export function numOrNull\(v\) \{[\s\S]*?\n\}/.exec(src) || [''])[0];
    assert.ok(body, '本体可提取');
    assert.ok(/typeof v !== 'number' && typeof v !== 'string'/.test(body), '本体须先看类型');
    assert.ok(!/Number\.isFinite\(Number\(/.test(body), '本体不得用弱口径写法');
});

/* ══════════ B ── 真模块行为（走导出面） ══════════ */
test('B1 ★★★ 钱包：没给楼层的流水不得被读成「第 0 楼」（弱口径下会命中并按 0 楼显示）', () => {
    for (const bad of ['', '  ', [], true]) {
        const ledger = { moneyLog: [{ name: '甲', desc: 'x', delta: -3, floor: bad, timestamp: null }] };
        const proj = WALLET.projectWallet(ledger);
        assert.equal(proj.tx.length, 1, '条目本身仍应投影出来（不因取值奇怪而整条消失）');
        assert.equal(proj.tx[0].floor, null, '★ floor 必须如实 null，实得 ' + JSON.stringify(proj.tx[0].floor));
        assert.ok(!/第0楼/.test(proj.tx[0].time), '★ 时间串不得出现「第0楼」，实得 ' + JSON.stringify(proj.tx[0].time));
    }
    /* 反坐实：真给 0 楼照常显示（0 是合法楼层） */
    const proj0 = WALLET.projectWallet({ moneyLog: [{ name: '甲', delta: 1, floor: 0 }] });
    assert.equal(proj0.tx[0].floor, 0, '真给 0 必须仍是 0');
    assert.ok(/第0楼/.test(proj0.tx[0].time), '真给 0 楼必须显示「第0楼」');
});

test('B2 ★★ 档案 / 支线：零调用弱口径助手已删（留着的代价是「下一个读代码的人以为已经有门了」）', () => {
    for (const rel of ['apps/profile/profile-data.js', 'apps/plotline/plotline-data.js']) {
        const src = readRel(rel);
        assert.ok(!/Number\.isFinite\(Number\(/.test(src), rel + ' 不得再有弱口径写法');
        assert.ok(!/^function num\(v\)/m.test(src), rel + ' 的零调用弱口径助手 num 应已删除');
    }
    assert.equal(typeof PROFILE.readProfileFace, 'function', '档案面导出仍在');
    assert.equal(typeof PLOTLINE.readPlotlineFace, 'function', '支线面导出仍在（readPlotlineFace）');
});

test('B3 ★★★ 世界账本：读不出的计数不得编 0（「暗流 0」是个结论，不是缺省值）', () => {
    const bare = LEDGER.projectLedger({ ok: true, counts: {} });
    assert.equal(bare.counts.currents, null, '★ counts.currents 读不出必须如实 null（修前是 0）');
    assert.equal(bare.counts.facts, null, '★ counts.facts 同上');
    /* 兼失的合计格：`num(a) + num(b)` 修前会得到 0（缺失参与算术） */
    const both = LEDGER.projectLedger({ ok: true, counts: {} });
    assert.equal(both.counts.opinion, null, '★ 两个格位都没给时，合计格须仍为 null（修前 null+null=0）');
    /* 反坐实：给了 0 照常是 0；给了一个就只算一个 */
    const zero = LEDGER.projectLedger({ ok: true, counts: { currents: 0, facts: 0 } });
    assert.equal(zero.counts.currents, 0, '真给 0 必须仍是 0');
    const half = LEDGER.projectLedger({ ok: true, counts: { opinionCanon: 3 } });
    assert.equal(half.counts.opinion, 3, '只给一格时按 0 补另一格（3 + 0）');
});

test('B4 ★★ 回滚预览：没给楼层 ⇒ floorOk=false 且五域 no-floor（不得退化成「第 0 楼不影响」）', () => {
    for (const bad of [null, undefined, '', '  ', [], true]) {
        const pv = RP.previewRollback({}, bad, { exact: false });
        assert.equal(pv.floorOk, false, '★ ' + JSON.stringify(bad) + ' ⇒ 不可算');
        assert.equal(pv.floor, null, 'floor 字段须为 null');
        assert.equal(pv.total, null, '不得退化成 0 条（0 条是个结论）');
        assert.ok(pv.domains.every((d) => d.state === 'no-floor'), '各域都该 no-floor');
    }
    const zero = RP.previewRollback({}, 0, { exact: false });
    assert.equal(zero.floorOk, true, '0 是合法楼层，必须仍可算');
});

test('B5 ★★ 诊断面文案：没楼层时必须说「楼层不可算」，而不是「没影响」', () => {
    const f = RP.rollbackPreviewFace({});
    assert.equal(f.floorOk, false, '无宿主 ⇒ 没楼层可算');
    assert.ok(/楼层不可算/.test(DD.rollbackPreviewFaceText(f.rollback)), '文案必须说清是「没楼层」');
});

/* ══════════ C ── 结构面 ══════════ */
test('C1 ★★★ 第十道门在 check 链上（否则等于没做）', () => {
    const pkg = JSON.parse(readRel('package.json'));
    assert.match(pkg.scripts.check, /weak-coercion/, 'check 链未包含 weak-coercion');
    assert.equal(pkg.scripts['weak-coercion'], 'node scripts/weak-coercion-audit.mjs', '门脚本路径');
});

test('C2 ★★ 四种「复制回弱口径」的形态各自被守（不看名字看形态）', () => {
    const helperWeak = "function num(v) { return Number.isFinite(Number(v)) ? Number(v) : null; }";
    const helperZero = "function num(v) { const n = Number(v); return Number.isFinite(n) ? n : 0; }";
    const inlineWeak = "const x = Number.isFinite(Number(a)) ? Number(a) : null;";
    const shadowWeak = "const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);";
    const out = runGate({
        'apps/demo/helper-weak.js': helperWeak,
        'apps/demo/helper-zero.js': helperZero,
        'apps/demo/inline-weak.js': inlineWeak,
        'apps/demo/shadow-weak.js': shadowWeak
    });
    assert.equal(out.status, 1, '★ 四种形态都必须被判红（实得 exit ' + out.status + '）');
    /* 命中的条目是**报错**，走 stderr；stdout 只有读数行（file 名在 stderr 里点名）。 */
    for (const p of ['helper-weak', 'helper-zero', 'inline-weak', 'shadow-weak']) {
        assert.ok(out.stderr.includes(p), '点名须含 ' + p + '：' + out.stderr.slice(0, 240));
    }
});

test('C3 ★★ 注释与字符串里的写法不算命中（判据面不得被散文侵入）', () => {
    const out = runGate({
        'apps/demo/prose.js': [
            '// 修前这里写的是 Number.isFinite(Number(v)) ? Number(v) : null，现已改走唯一实现',
            '/* 同上：Number.isFinite(Number(x)) 是弱口径 */',
            "const s = 'Number.isFinite(Number(y))';",
            "import { numOrNull } from '../../config/num-gate.js';",
            'export const z = numOrNull(s);'
        ].join('\n')
    });
    assert.equal(out.status, 0, '★ 只有散文提到该写法时不得判红（实得 exit ' + out.status + '）：' + out.stderr.slice(0, 200));
    assert.ok(/口径卫生/.test(out.stdout), '应报口径卫生');
});

test('C4 ★★ 真仓库读数：唯一实现被 ≥ 12 个文件引用，枚举面 > 180（自证防线不得失效）', () => {
    /* ★ 这一条必须跑在**真仓库**上（不是夹具）：夹具只有 1 处强口径本体，
     *   用夹具量「下游引用面」等于用玩具量真田 —— 首版就写错了这一处。 */
    const out = spawnSync(process.execPath,
        [path.join(ROOT, 'scripts', 'weak-coercion-audit.mjs'), '--list'],
        { cwd: ROOT, encoding: 'utf8', timeout: 120000 });
    assert.equal(out.status, 0, '真仓库 --list 应可跑通：' + out.stderr.slice(0, 200));
    const m = /枚举面 (\d+) 文件 · 强口径本体 (\d+) 处 · 唯一实现被引用 (\d+) 文件/.exec(out.stdout);
    assert.ok(m, '读数行在场（口径不得静默变更）：' + out.stdout.slice(0, 200));
    assert.ok(Number(m[1]) > 180, '枚举面须 > 180 文件，实测 ' + m[1]);
    assert.ok(Number(m[2]) >= 3, '强口径本体须 ≥ 3 处（合法形态）');
    assert.ok(Number(m[3]) >= 12, '唯一实现被引用文件数须 ≥ 12，实测 ' + m[3]);
});

/* ══════════ D ── 真源码破坏负控制 ══════════ */
function mutateOnce(src, from, to) {
    const n = src.split(from).length - 1;
    assert.equal(n, 1, '锚点应恰中 1 次，实际 ' + n + '：' + String(from).slice(0, 70));
    return src.replace(from, to);
}
function mirror(mut) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v3120-mir-'));
    fs.mkdirSync(path.join(dir, 'config'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'apps'), { recursive: true });
    fs.copyFileSync(path.join(ROOT, GATE_REL), path.join(dir, GATE_REL));
    for (const [rel, fn] of Object.entries(mut)) {
        const dst = path.join(dir, rel);
        fs.mkdirSync(path.dirname(dst), { recursive: true });
        const body = fn(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
        fs.writeFileSync(dst, body);
    }
    return dir;
}
/** J1 数据层判据（与 A/B 同款）：唯一实现本体 + 钱包真模块行为。 */
async function dataJudge(mod, gateSrc) {
    const gate = /export function numOrNull\(v\) \{[\s\S]*?\n\}/.exec(gateSrc);
    if (!gate) return false;
    const fn = new Function('return (' + gate[0].replace('export function', 'function') + ')')();
    for (const [, v] of NOT_GIVEN) if (fn(v) !== null) return false;
    for (const [, v] of GIVEN) if (fn(v) !== Number(v)) return false;
    for (const bad of ['', '  ', []]) {
        const proj = mod.projectWallet({ moneyLog: [{ name: '甲', delta: 1, floor: bad }] });
        if (proj.tx[0].floor !== null) return false;
        if (/第0楼/.test(proj.tx[0].time)) return false;
    }
    return true;
}

test('D0 镜像树自证 + 阳性对照：未破坏时 J1 为真（否则 D 组是假绿）', async () => {
    assert.equal(await dataJudge(WALLET, readRel(GATE_REL)), true, 'J1 在原件上必须为真');
    const dir = mirror({});
    try {
        assert.ok(fs.existsSync(path.join(dir, GATE_REL)), '镜像里必须带上唯一实现本体');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('D1 ★★★ 负控制·唯一实现退回弱口径 ⇒ J1 必转红，且差异可观测', async () => {
    const STRONG = "    if (typeof v !== 'number' && typeof v !== 'string') return null;";
    const WEAK_BACK = '    // 破坏：退回弱口径\n    return Number.isFinite(Number(v)) ? Number(v) : null;';
    const dir = mirror({ [GATE_REL]: (s) => mutateOnce(s, STRONG, WEAK_BACK) });
    try {
        const broken = await import(pathToFileURL(path.join(dir, GATE_REL)).href + '?m=' + Date.now());
        const bsrc = fs.readFileSync(path.join(dir, GATE_REL), 'utf8');
        assert.equal(broken.numOrNull('  '), 0, '破坏后空白串确实被读成 0（差异可观测）');
        assert.equal(await dataJudge(WALLET, bsrc), false, '★ J1 在破坏副本上必须为 false');
        assert.equal(await dataJudge(WALLET, readRel(GATE_REL)), true, '对照：原件上仍为真');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('D2 ★★ 负控制·门脚本被摘掉 ⇒ 门必须拒判（exit 2），而不是「零命中 = 全绿」', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v3120-nogate-'));
    try {
        /* 造一个「有文件、但没有唯一实现」的树：W3 必须报出来。 */
        fs.mkdirSync(path.join(dir, 'config'), { recursive: true });
        fs.mkdirSync(path.join(dir, 'apps'), { recursive: true });
        for (let i = 0; i < 200; i++) fs.writeFileSync(path.join(dir, 'apps', 'f' + i + '.js'), 'export const x = 1;\n');
        /* 补一个**合法强口径助手**：否则 W4 判据自证先触发（exit 2），
         *   报的是「判据被改坏」而不是「唯一实现不在场」—— 那是另一条判据的活。 */
        fs.writeFileSync(path.join(dir, 'apps', 'helper.js'),
            "function floorOrNull(v) { if (typeof v !== 'number' && typeof v !== 'string') return null;\n"
            + "    if (typeof v === 'string' && !v.trim()) return null;\n"
            + "    const n = Number(v); return Number.isFinite(n) ? n : null; }\nexport const h = floorOrNull(1);\n");
        const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts/weak-coercion-audit.mjs'), '--root', dir],
            { encoding: 'utf8', timeout: 60000 });
        assert.equal(r.status, 1, '缺唯一实现时必须判红，实测 exit ' + r.status + '：' + r.stderr.slice(0, 200));
        assert.ok(/num-gate\.js 不在场/.test(r.stderr), '必须点名唯一实现不在场');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

/* ══════════ E ── 第十道门两向自证 ══════════ */
function runGate(extraFiles, args) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v3120-gate-'));
    try {
        fs.mkdirSync(path.join(dir, 'config'), { recursive: true });
        fs.mkdirSync(path.join(dir, 'apps'), { recursive: true });
        /* 镜像真实现 + 真门脚本所需的枚举体量（> MIN_FILES）与引用面（> MIN_REF）。 */
        fs.copyFileSync(path.join(ROOT, GATE_REL), path.join(dir, GATE_REL));
        for (let i = 0; i < 190; i++) fs.writeFileSync(path.join(dir, 'apps', 'f' + i + '.js'), 'export const x = 1;\n');
        for (let i = 0; i < 13; i++) {
            fs.writeFileSync(path.join(dir, 'apps', 'u' + i + '.js'),
                "import { numOrNull } from '../config/num-gate.js';\nexport const y = numOrNull(1);\n");
        }
        for (const [rel, body] of Object.entries(extraFiles || {})) {
            const dst = path.join(dir, rel);
            fs.mkdirSync(path.dirname(dst), { recursive: true });
            fs.writeFileSync(dst, body);
        }
        return spawnSync(process.execPath,
            [path.join(ROOT, 'scripts', 'weak-coercion-audit.mjs'), '--root', dir].concat(args || []),
            { encoding: 'utf8', timeout: 60000 });
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

test('E1 ★★ 原版上必须为真（阳性对照：门不是恒红）', () => {
    const out = runGate({});
    assert.equal(out.status, 0, '干净树必须绿，实测 exit ' + out.status + '：' + out.stderr.slice(0, 200));
    assert.ok(/✓ 取数口径卫生/.test(out.stdout), '应报口径卫生');
});

test('E2 ★★★ 真源码破坏必须可观测地改变行为（W1 命中 ⇒ 必须判红）', () => {
    const out = runGate({ 'apps/demo/weak.js': 'const a = Number.isFinite(Number(b)) ? Number(b) : null;\n' });
    assert.equal(out.status, 1, '弱口径写法在场必须判红，实测 exit ' + out.status);
    assert.ok(/W1/.test(out.stderr), '必须点名 W1：' + out.stderr.slice(0, 200));
});

test('E3 ★★ 结构漂移必须 exit 2 拒判（枚举面塌成个位数时不得发合格证）', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v3120-thin-'));
    try {
        fs.mkdirSync(path.join(dir, 'config'), { recursive: true });
        fs.copyFileSync(path.join(ROOT, GATE_REL), path.join(dir, GATE_REL));
        const r = spawnSync(process.execPath,
            [path.join(ROOT, 'scripts', 'weak-coercion-audit.mjs'), '--root', dir],
            { encoding: 'utf8', timeout: 60000 });
        assert.equal(r.status, 2, '枚举面过小时必须 exit 2，实测 exit ' + r.status);
        assert.ok(/结构漂移/.test(r.stderr), '必须说明是结构漂移：' + r.stderr.slice(0, 200));
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('E4 ★★★ 工具两向自证：锚点不存在 / --root 不存在必须抛（不得静默通过）', () => {
    const r = spawnSync(process.execPath,
        [path.join(ROOT, 'scripts', 'weak-coercion-audit.mjs'), '--root', '/nonexistent-v3120-dir'],
        { encoding: 'utf8', timeout: 60000 });
    assert.equal(r.status, 2, '--root 指向不存在路径必须 exit 2，实测 exit ' + r.status);
    assert.ok(/不存在的路径/.test(r.stderr), '必须说明原因：' + r.stderr.slice(0, 160));
});

/* ══════════ F ── 版本锚 ══════════ */
const VNUM = (s) => Number(String(s).split('.').reduce((a, x) => a * 1000 + Number(x), 0));
test('F1 ★ 版本五源同源（下限形：自 3.12.0 起成立，不钉死某一版）', () => {
    const man = JSON.parse(readRel('manifest.json'));
    const pkg = JSON.parse(readRel('package.json'));
    const log = JSON.parse(readRel('update-log.json'));
    const idx = readRel('index.js');
    const codeVer = (/const ST_PHONE_VERSION = '([^']+)'/.exec(idx) || [])[1];
    assert.ok(codeVer, '入口版本常量在场');
    assert.equal(codeVer, man.version, '入口 == manifest');
    assert.equal(pkg.version, man.version, 'package == manifest');
    assert.equal(log.latest, man.version, 'update-log.latest == manifest');
    assert.equal(Object.keys(log.versions)[0], man.version, 'versions 首键 == manifest（仓内约定）');
    assert.ok(VNUM(codeVer) >= VNUM('3.12.0'), '本套件自 3.12.0 起成立；当前 ' + codeVer);
});
