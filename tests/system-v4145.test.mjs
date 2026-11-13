/* ============================================================
 * tests/system-v4145.test.mjs — [v4.145.0 · 第二十一期批次 C 第一步 R21-O4]
 *   覆盖率读数进账本：「哪些 app 一行测试都没有」现在答得出来。
 *
 * 【修前实测的缺口（读码可复算，不是推演）】
 *   本仓 435 个测试文件、`package.json` 的二十道门里**一道覆盖率门都没有**。
 *   于是这句话从来没有人回答过：「哪个 app 目录一行测试都没有？」
 *   代价不是「覆盖率偏低」，而是**新加的 app 可以永远不写一行测试而没有任何东西会响** ——
 *   本仓治过的同族形态（读数在盘上但没人读、文档面不说谎）都是这一类。
 *
 * 【本版落的三件】一 `scripts/lib/coverage-debt.mjs`（纯函数：spec 表解析 / 行加权 /
 *   三列聚合 / 「不许退步」判决 / TODO 欠账段渲染）；二 `scripts/coverage-report.mjs`
 *   （真跑 `--experimental-test-coverage` 落盘账本，链上跑结构自检、`--verify` 才真量对账）；
 *   三 `tests/audit/coverage_baseline.json` 账本与 `TODO.md` 的欠账段（**由读数派生，不手抄**）。
 *
 * 判据面（五组）：
 *   A 口径：行加权不是百分比平均 / 「零测试」必须结合磁盘（漏算的目录不许算 100%）/
 *           drop_pp 只有一个真源
 *   B 纯函数行为：spec 表解析（含顶层段缩进这一格）/ 未覆盖行清单按行数不按条目 /
 *           三列聚合的边界（全 100% 与全 0 两个极端不塌成 NaN）
 *   C 接线：脚本键 / check 链位次 / 分档表同序 / 预算自算且键序与链逐门对齐 / 主读数已登记
 *   D 真量与负控制：账本与真跑日志逐字一致（离线复算）/ 抬高基线 10pp 必红 /
 *           把某目录从读数里删掉必红（「漏算的目录等于 100%」）/ 零测试目录增多必红
 *   E 版本锚与诚实边界：五源同源且 ≥ 4.145.0 / 账本 note 的两条边界不许被抹掉
 * ============================================================ */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const readJson = (rel) => JSON.parse(read(rel));
const exists = (rel) => fs.existsSync(path.join(ROOT, rel));

const LIB_REL = 'scripts/lib/coverage-debt.mjs';
const GATE_REL = 'scripts/coverage-report.mjs';
const BASE_REL = 'tests/audit/coverage_baseline.json';

const LIB = await import(pathToFileURL(path.join(ROOT, LIB_REL)).href);

/* ═══════════════════════════ A · 口径 ═══════════════════════════ */
test('A1 行加权不是百分比平均（同一份读数，两种算法必须给出不同的数）', () => {
    const rows = [
        /* 3 行的空壳，100%：按「百分比平均」它和 800 行的主体权重相同。 */
        { path: ['apps', 'demo', 'tiny.js'], file: 'tiny.js', linePct: 100, uncovered: 0 },
        /* 大文件，50%：未覆盖 300 行 ⇒ 反解覆盖 300 行、总 600 行。 */
        { path: ['apps', 'demo', 'big.js'], file: 'big.js', linePct: 50, uncovered: 300 }
    ];
    const dirs = LIB.buildAppStats({
        rows,
        diskFilesByApp: new Map([['demo', ['tiny.js', 'big.js']]]),
        appDirs: ['demo']
    });
    const naiveMean = (100 + 50) / 2;
    /* 行加权：tiny 无权重（100% 且 U=0），big 贡献 300/600。
     * ★ 这里是本仓自觉的口径限制：p=100 且无未覆盖行的文件**没有可算的权重**，
     *   所以它按 0 权重参与 —— 于是分母只有 600。账本 note 与 lib 注释都写明这一格。 */
    assert.equal(dirs.demo.line_pct, 50, '行加权结果必须是 300/600=50，实得 ' + dirs.demo.line_pct);
    assert.notEqual(dirs.demo.line_pct, naiveMean, '★ 行加权不得等于百分比平均（否则「3 行空壳 100%」会抬分）');
    assert.ok(dirs.demo.unknown_weight_files >= 1, '100% 且无未覆盖行的文件必须记进 unknown_weight_files，不许静默消失');
});

test('A2 「零测试」必须结合磁盘清单：覆盖表里没出现的文件也算零测试', () => {
    const rows = [{ path: ['apps', 'demo', 'a.js'], file: 'a.js', linePct: 80, uncovered: 20 }];
    const dirs = LIB.buildAppStats({
        rows,
        /* 磁盘上有三个文件，覆盖表里只有一个 ⇒ 另两个是「从未被 import」，必须是零测试。 */
        diskFilesByApp: new Map([['demo', ['a.js', 'never-imported-1.js', 'never-imported-2.js']]]),
        appDirs: ['demo']
    });
    assert.equal(dirs.demo.files_on_disk, 3);
    assert.equal(dirs.demo.zero_test_files, 2, '★ 未被 import 的文件必须算零测试（这正是「一行测试都没有」的主体）');
    assert.deepEqual(dirs.demo.zero_test_names, ['never-imported-1.js', 'never-imported-2.js']);
    assert.equal(dirs.demo.files_unloaded, 2);
});

test('A3 drop_pp 只有一个真源：门脚本的常量与 lib 的默认值必须同值', () => {
    const gate = read(GATE_REL);
    const m = /const DROP_PP = ([\d.]+);/.exec(gate);
    assert.ok(m, '门脚本必须显式声明 DROP_PP 常量（不许散落在判决里）');
    const judge = LIB.judgeNoRegression({ a: { line_pct: 50, files_with_test: 1, zero_test_files: 0 } },
        { a: { line_pct: 49.4, files_with_test: 1, zero_test_files: 0 } });
    assert.equal(judge.dropPp, 0.5, 'lib 的默认阈值必须是 0.5pp，实得 ' + judge.dropPp);
    assert.equal(Number(m[1]), 0.5, '门脚本常量必须与 lib 默认值同值（' + m[1] + ' vs 0.5）');
});

/* ═══════════════════════════ B · 纯函数行为 ═══════════════════════════ */
test('B1 spec 表解析：顶层段 1 格缩进也要认（第一版把 `apps` 当无效行丢掉的形态）', () => {
    /* 这段是**真日志的逐字形态**（ℹ + 空格 + 空格 + 名字）。 */
    const text = [
        '\u2139 ------------------------------------------------',
        '\u2139 file                     | line % | branch % | funcs % | uncovered lines',
        '\u2139 ------------------------------------------------',
        '\u2139 apps                     |        |          |         | ',
        '\u2139  demo                    |        |          |         | ',
        '\u2139   demo-app.js            |  50.00 |    60.00 |   40.00 | 10-19 30',
        '\u2139 all files                |  62.20 |    42.99 |   35.68 | '
    ].join('\n');
    const rows = LIB.parseCoverageSpec(text).filter((r) => r.file !== 'all files');
    assert.equal(rows.length, 1, '必须解析出 1 条文件行（排除 all files 汇总行），实得 ' + rows.length);
    assert.deepEqual(rows[0].path, ['apps', 'demo', 'demo-app.js'], '路径必须带全祖先：' + JSON.stringify(rows[0].path));
    assert.equal(rows[0].linePct, 50);
    assert.equal(rows[0].uncovered, 11, '10-19 是 10 行 + 30 是 1 行 = 11 行');
});

test('B2 未覆盖行清单按**行数**算，不按条目数算', () => {
    assert.equal(LIB.countUncovered('10-19 30'), 11);
    assert.equal(LIB.countUncovered('5'), 1);
    assert.equal(LIB.countUncovered('1-3 7-9'), 6);
    assert.equal(LIB.countUncovered(''), 0);
    assert.equal(LIB.countUncovered('   '), 0);
    /* 反向自证：条目数是 2，行数是 11 —— 两者不同，取错就会把「覆盖 90%」算成「覆盖 50%」。 */
    assert.notEqual(LIB.countUncovered('10-19 30'), '10-19 30'.split(/\s+/).length);
});

test('B3 三列聚合的两个极端不塌成 NaN（全 100% 与全 0）', () => {
    const allHundred = LIB.buildAppStats({
        rows: [{ path: ['apps', 'd', 'x.js'], file: 'x.js', linePct: 100, uncovered: 0 }],
        diskFilesByApp: new Map([['d', ['x.js']]]),
        appDirs: ['d']
    });
    assert.ok(Number.isFinite(allHundred.d.line_pct), '全 100% 不许出 NaN（实得 ' + allHundred.d.line_pct + '）');
    assert.equal(allHundred.d.zero_test_files, 0);

    const allZero = LIB.buildAppStats({
        rows: [{ path: ['apps', 'd', 'x.js'], file: 'x.js', linePct: 0, uncovered: 40 }],
        diskFilesByApp: new Map([['d', ['x.js']]]),
        appDirs: ['d']
    });
    assert.equal(allZero.d.line_pct, 0, '全 0% 必须是 0（不是 NaN、不是 100）');
    assert.equal(allZero.d.zero_test_files, 1, 'line% = 0 的文件必须算零测试');
});

test('B4 「不许退步」判决三态互不同形：pass / fail / refuse', () => {
    const base = {
        a: { line_pct: 60, files_with_test: 2, zero_test_files: 0 },
        b: { line_pct: 30, files_with_test: 0, zero_test_files: 3 }
    };
    const pass = LIB.judgeNoRegression(base, {
        a: { line_pct: 59.6, files_with_test: 2, zero_test_files: 0 },
        b: { line_pct: 30, files_with_test: 0, zero_test_files: 3 }
    });
    assert.equal(pass.verdict, 'pass', '掉 0.4pp 在 0.5pp 阈值内必须 pass');

    const fail = LIB.judgeNoRegression(base, {
        a: { line_pct: 58, files_with_test: 2, zero_test_files: 0 },
        b: { line_pct: 30, files_with_test: 0, zero_test_files: 3 }
    });
    assert.equal(fail.verdict, 'fail', '掉 2pp 必须 fail');
    assert.equal(fail.dropped.length, 1);
    assert.equal(fail.dropped[0].app, 'a');

    /* 现场漏了一个目录：**拒判**，不是「没退步」。漏算的目录等于 100% 是最坏的假绿。 */
    const refuse = LIB.judgeNoRegression(base, { a: { line_pct: 60, files_with_test: 2, zero_test_files: 0 } });
    assert.equal(refuse.verdict, 'refuse', '★ 现场缺目录必须 refuse（不是 pass）');
    assert.deepEqual(refuse.missing, ['b']);
});

test('B5 零测试目录增加 ⇒ fail（新增 app 不写测试必须被拦）', () => {
    const base = { a: { line_pct: 50, files_with_test: 1, zero_test_files: 0 } };
    const live = {
        a: { line_pct: 50, files_with_test: 1, zero_test_files: 0 },
        brandnew: { line_pct: 0, files_with_test: 0, zero_test_files: 4 }
    };
    const j = LIB.judgeNoRegression(base, live);
    assert.equal(j.verdict, 'fail', '★ 零测试目录从 0 涨到 1 必须 fail');
    assert.deepEqual(j.addedZero, ['brandnew']);
    assert.equal(j.baseZeroCount, 0);
    assert.equal(j.liveZeroCount, 1);
});

test('B6 TODO 欠账段是**读数派生**的：同输入必同输出，且穿接幂等', () => {
    const dirs = {
        a: { line_pct: 12.34, files_with_test: 1, zero_test_files: 2 },
        b: { line_pct: 88.8, files_with_test: 3, zero_test_files: 0 }
    };
    const s1 = LIB.renderDebtSection(dirs, { version: '9.9.9' });
    const s2 = LIB.renderDebtSection(JSON.parse(JSON.stringify(dirs)), { version: '9.9.9' });
    assert.equal(s1, s2, '同一份读数必须渲染出逐字相同的段（不手抄的意思就是可复算）');
    assert.ok(s1.includes('9.9.9'), '段里必须写版本锚');

    const once = LIB.spliceDebtSection('# 标题\n\n正文\n', s1);
    const twice = LIB.spliceDebtSection(once, s1);
    assert.equal(once, twice, '★ 穿接必须幂等（跑两次不许出来两段）');
    assert.equal(once.split(LIB.DEBT_BEGIN).length - 1, 1, '段只能有一处');

    const replaced = LIB.spliceDebtSection(once, LIB.renderDebtSection({ a: dirs.a }, { version: '9.9.9' }));
    assert.equal(replaced.split(LIB.DEBT_BEGIN).length - 1, 1, '替换后仍只能有一处');
    assert.ok(!replaced.includes('`b`'), '替换必须把旧表整段换掉（不许留旧行）');
});

/* ═══════════════════════════ C · 接线 ═══════════════════════════ */
test('C1 产物在位，且门不自己重写判决（它 import lib）', () => {
    for (const rel of [LIB_REL, GATE_REL, BASE_REL]) assert.ok(exists(rel), '必须在位：' + rel);
    const gate = read(GATE_REL);
    assert.ok(/from '\.\/lib\/coverage-debt\.mjs'/.test(gate), '门必须 import lib（判决只有一份实现）');
    assert.ok(/judgeNoRegression/.test(gate), '门必须真调判决函数');
    /* 反向自证：门里不得再出现「就地写一遍阈值比较」的痕迹。 */
    assert.equal(/drop\s*>\s*0\.5/.test(gate), false, '★ 门里不得自己写 `drop > 0.5` —— 那就是第二份判决');
});

test('C2 链上那一档必须是**结构自检**，不是 11 分钟真量（否则整条链没人愿意跑）', () => {
    const gate = read(GATE_REL);
    assert.ok(/if \(!WRITE && !VERIFY\) \{\s*\n\s*return selfCheck\(\);/.test(gate),
        '★ 默认档（无 --write / 无 --verify）必须走 selfCheck，不许默认真跑全量覆盖');
    const pkg = readJson('package.json');
    assert.equal(pkg.scripts['coverage-debt'], 'node scripts/coverage-report.mjs',
        'package.json 脚本键必须是**无参数**形态（无参数 = 结构自检）');
    assert.ok(!/--verify/.test(pkg.scripts['coverage-debt']), '★ 链上脚本键不得带 --verify');
});

test('C3 五处接线齐：脚本键 / 链位次 / 分档同序 / 预算键序逐门对齐 / 主读数登记', () => {
    const pkg = readJson('package.json');
    const chain = pkg.scripts.check.split('&&').map((s) => s.trim());
    assert.ok(chain.includes('npm run coverage-debt'), '★ 覆盖率欠账门必须在 check 链上');
    const at = chain.indexOf('npm run coverage-debt');
    assert.equal(chain[at - 1], 'npm run memory-trend', '必须紧跟 memory-trend 之后（位置即口径，判据钉住它）');
    assert.equal(chain[chain.length - 1], 'npm run upstream-face', '链尾 upstream-face 是不变量');

    const tiers = readJson('config/gate-tiers.json');
    const staticCmds = tiers.tiers.static.commands;
    assert.ok(staticCmds.includes('npm run coverage-debt'), '静态档必须列本门');
    const chainOrder = chain.filter((c) => staticCmds.includes(c));
    assert.deepEqual(chainOrder, staticCmds.filter((c) => chain.includes(c)),
        '★ 分档表静态档顺序必须与 check 链同序');

    const budget = readJson('config/gate-budget.json');
    /* v3201 F1 钉住：预算表键序必须与 check 链**逐门**对齐。本门插在中间，键序也必须跟着插。 */
    const chainGates = chain.map((c) => c.replace('npm run ', ''));
    assert.deepEqual(Object.keys(budget.gates), chainGates, '★ 预算表键序必须与 check 链逐门对齐（本门不得被追加到末尾）');
    const g = budget.gates['coverage-debt'];
    assert.ok(g, 'gate-budget.json 必须补入本门预算');
    assert.equal(g.limit_ms, Math.round(g.ms * (1 + budget.margin_pct / 100)), 'limit_ms 必须由 margin_pct 自算');
    assert.ok(g.ms > 0 && g.ms < 5000, '链上这档是秒级自检，预算必须落在秒级（实测 ' + g.ms + 'ms）');
    const sum = Object.values(budget.gates).reduce((a, x) => a + x.ms, 0);
    assert.equal(budget.total_ms, sum, 'total_ms 必须等于各门 ms 之和：' + sum);

    const checker = read('scripts/check-file.mjs');
    assert.ok(/'coverage-debt': \[/.test(checker), '★ check-file 必须为本门登记主读数（未登记 ⇒ 执行器 exit 2 拒判）');
    const seg = checker.slice(checker.indexOf("'coverage-debt': ["), checker.indexOf("'coverage-debt': [") + 400);
    assert.ok(seg.includes('app 目录 ('), '主读数必须钉住「app 目录 N 个」：' + JSON.stringify(seg.slice(0, 240)));
    assert.ok(seg.includes('零测试目录 ('), '主读数必须钉住「零测试目录 N 个」');
});

test('C4 文档写的门数与顺序必须与真源逐字同构（CONTEXT.md 那一行）', () => {
    const real = (readJson('package.json').scripts.check.match(/npm run [a-z-]+/g) || []).map((s) => s.slice(8));
    const doc = read('CONTEXT.md');
    const at = doc.indexOf('道子门**串联：');
    assert.ok(at > 0, 'CONTEXT.md 的检查脚本总述行不见了（判据不该静默通过）');
    const seg = doc.slice(at, doc.indexOf('。', at));
    const docNames = (seg.match(/`([a-z-]+)`/g) || []).map((s) => s.slice(1, -1));
    assert.deepEqual(docNames, real, '文档门名/顺序与真源不同：文档 ' + JSON.stringify(docNames) + ' 真源 ' + JSON.stringify(real));
    const cn = /([一二三四五六七八九十]+)道子门/.exec(doc.slice(Math.max(0, at - 40), at + 10));
    assert.ok(cn, '文档必须写门数量词');
    const CN = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
    const toNum = (s) => {
        if (s === '十') return 10;
        if (s.length === 1) return CN.indexOf(s);
        const i = s.indexOf('十');
        if (i === 0) return 10 + (CN.indexOf(s[1]));
        if (i === s.length - 1) return CN.indexOf(s[0]) * 10;
        return CN.indexOf(s[0]) * 10 + CN.indexOf(s[2]);
    };
    assert.equal(toNum(cn[1]), real.length, '★ 数量词必须与真源门数一致（文档写 ' + cn[1] + '，真源 ' + real.length + ' 道）');
});

/* ═══════════════════════════ D · 真量与负控制 ═══════════════════════════ */
test('D1 账本三列与**真跑日志**逐字一致（离线复算，不重复跑 11 分钟）', () => {
    /* 用本版落盘时的同一份覆盖日志复算：账本必须是它的纯函数结果。
     * 日志不在场时本判据**拒判**（不是跳过）—— 跳过会让这条变成永远不会响的判据。 */
    const LOG_REL = 'tests/audit/coverage_source.log';
    if (!exists(LOG_REL)) {
        assert.fail('拒判：' + LOG_REL + ' 不在场。覆盖率账本必须留下**可复算的源日志**，'
            + '否则「读数与真跑一致」这句话就没有第二个证人。请 node scripts/coverage-report.mjs --write --keep-log');
    }
    const rows = LIB.parseCoverageSpec(read(LOG_REL));
    assert.ok(rows.length > 1000, '源日志必须解析出上千条文件行（实测 2483 条），实得 ' + rows.length);
    const base = readJson(BASE_REL);
    const appDirs = Object.keys(base.dirs).sort();
    /* 只复算「登录在册的目录」，磁盘扫描面在 D 组是另一条判据的事。 */
    const dirs = LIB.buildAppStats({
        rows,
        diskFilesByApp: new Map(appDirs.map((a) => [a, base.dirs[a].zero_test_names.concat(
            /* 有测试的文件名不需要精确复原：这一格只用 zero_test_files 与 line_pct 对账。 */
            []
        )])),
        appDirs
    });
    for (const app of appDirs) {
        const b = base.dirs[app];
        assert.equal(dirs[app].line_pct, b.line_pct, '目录 ' + app + ' 的 line% 必须与源日志复算一致（账本 ' + b.line_pct + ' vs 复算 ' + dirs[app].line_pct + '）');
    }
});

test('D2 负控制：把基线抬高 10pp ⇒ 判决必须转红（门在退步时会响）', () => {
    const base = readJson(BASE_REL);
    const dirs = base.dirs;
    /* 现场 = 账本本身（必然无退步）。 */
    const clean = LIB.judgeNoRegression(dirs, dirs);
    assert.equal(clean.verdict, 'pass', '前提：账本对自身必须 pass');

    /* 真破坏：把账本里三个**还有抬升空间**的目录各抬 10pp，再拿同一份现场去比。
     * 反面教训（本判据第一版）：直接取覆盖率最高的三个目录时，它们多为 100%，
     * `Math.min(100, p+10)` 抬不动 ⇒ drop=0 ⇒ 负控制假装通过。
     * 故必须挑「抬得动」的目录：20% < p <= 80%。 */
    const tampered = JSON.parse(JSON.stringify(dirs));
    const picks = Object.keys(tampered)
        .filter((d) => Number.isFinite(tampered[d].line_pct) && tampered[d].line_pct > 20 && tampered[d].line_pct <= 80)
        .sort((a, b) => tampered[b].line_pct - tampered[a].line_pct)
        .slice(0, 3);
    assert.equal(picks.length, 3, '必须有三个可抬的目录（否则这条负控制失去意义）');
    for (const d of picks) tampered[d].line_pct = Math.min(100, tampered[d].line_pct + 10);
    const bad = LIB.judgeNoRegression(tampered, dirs);
    assert.equal(bad.verdict, 'fail', '★ 基线被人为抬高 10pp 后，同款判决必须转红（实得 ' + bad.verdict + '）');
    assert.ok(bad.dropped.length >= 1, '必须点名是哪几个目录退步了');
    assert.ok(bad.dropped.every((x) => x.drop > 0.5), '每个被点名的目录退步幅度都必须超阈值');
});

test('D3 负控制：把某 app 目录从读数里删掉 ⇒ 必须拒判（防「漏算的目录等于 100%」）', () => {
    const base = readJson(BASE_REL);
    const dirs = base.dirs;
    const victim = Object.keys(dirs).sort()[0];
    assert.ok(victim, '前提：账本里必须有目录');
    const hollow = JSON.parse(JSON.stringify(dirs));
    delete hollow[victim];
    const j = LIB.judgeNoRegression(dirs, hollow);
    assert.equal(j.verdict, 'refuse', '★ 漏算一个目录必须拒判，不得读成「没退步」（实得 ' + j.verdict + '）');
    assert.deepEqual(j.missing, [victim], '必须点名缺了哪个目录');
});

test('D4 负控制：零测试目录数增加 ⇒ 必须红（含「新 app 不写测试」这条真形态）', () => {
    const base = readJson(BASE_REL);
    const dirs = base.dirs;
    const hollow = JSON.parse(JSON.stringify(dirs));
    /* 真形态：新加一个 app 目录，四个文件一行测试都没有。 */
    hollow['zz-new-app'] = { line_pct: 0, files_on_disk: 4, files_with_test: 0, zero_test_files: 4, zero_test_names: ['a.js', 'b.js', 'c.js', 'd.js'], files_unloaded: 4, unknown_weight_files: 0 };
    const j = LIB.judgeNoRegression(dirs, hollow);
    assert.equal(j.verdict, 'fail', '★ 零测试目录从 N 涨到 N+1 必须红');
    assert.ok(j.addedZero.includes('zz-new-app'), '必须点名新增的零测试目录');
});

/* ═══════════════════════════ E · 版本锚与诚实边界 ═══════════════════════════ */
test('E1 五源同源且 ≥ 4.145.0', () => {
    const pkg = readJson('package.json');
    const man = readJson('manifest.json');
    const ul = readJson('update-log.json');
    const idx = read('index.js');
    assert.equal(pkg.version, man.version, 'package.json 与 manifest.json 必须同版');
    assert.equal(ul.latest, pkg.version, 'update-log latest 必须同版');
    assert.ok(idx.includes("const ST_PHONE_VERSION = '" + pkg.version + "'"), 'index.js 版本常量必须同版');
    /* 版本比较必须按数字三段比，不用正则猜区间：v4.145.0 的次段是 145，
     * 猜区间的写法在 4.145.0 上会当场判错（本判据第一版正是这样错的）。 */
    const num = pkg.version.split('.').map((x) => Number(x));
    assert.equal(num.length, 3, '版本必须是三段数字：' + pkg.version);
    assert.ok(num.every((x) => Number.isInteger(x)), '版本三段必须都是整数：' + pkg.version);
    const ok = num[0] > 4 || (num[0] === 4 && (num[1] > 145 || (num[1] === 145 && num[2] >= 0)));
    assert.ok(ok, '版本必须 ≥ 4.145.0（实得 ' + pkg.version + '）');
});

test('E2 账本的诚实边界不许被抹掉（浏览器层 / 行不是行为）', () => {
    const base = readJson(BASE_REL);
    const note = String(base.note || '');
    assert.ok(/不覆盖浏览器层/.test(note), '★ note 必须写明 Node 覆盖不覆盖浏览器层（那一面归 tests/browser/）');
    assert.ok(/tests\/browser\//.test(note), 'note 必须指出浏览器侧归谁');
    assert.ok(/行被执行过/.test(note), '★ note 必须写明它量的是「行被执行过」，不是质量');
    assert.ok(/不许退步|只做「不许退步」/.test(note), 'note 必须写明门禁只做不许退步（不设绝对下限）');
    assert.equal(base.schema, 'coverage-baseline@1');
    assert.equal(base.drop_pp, 0.5, '账本 drop_pp 必须与门常量同值');
});

test('E3 账本的目录集合必须与磁盘逐项相等（自检档与账本不许各说各话）', () => {
    const base = readJson(BASE_REL);
    const disk = fs.readdirSync(path.join(ROOT, 'apps'), { withFileTypes: true })
        .filter((d) => d.isDirectory()).map((d) => d.name).sort();
    assert.deepEqual(Object.keys(base.dirs).sort(), disk,
        '账本目录集合与磁盘 apps/ 必须逐项相等 —— 新 app 不许「自动」以 0% 混进账本还读成没退步');
    assert.equal(base.totals.app_dirs, disk.length, 'totals.app_dirs 必须等于磁盘目录数');
});

test('E4 TODO.md 的欠账段必须与账本同源（手改 ⇒ 红）', () => {
    const base = readJson(BASE_REL);
    const todo = read('TODO.md');
    const want = LIB.renderDebtSection(base.dirs, { version: base.version });
    assert.ok(todo.includes(want), '★ TODO.md 的欠账段必须是账本派生的逐字结果（手抄/旧版都会被这条抓住）');
    assert.equal(todo.split(LIB.DEBT_BEGIN).length - 1, 1, '欠账段只能有一处');
});