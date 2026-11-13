#!/usr/bin/env node
/* ============================================================
 * scripts/coverage-report.mjs — 覆盖率读数进账本 + 只判「不许退步」的门（R21-O4）[v4.145.0]
 * ------------------------------------------------------------
 * 【为什么有它】
 *   `package.json` 的二十道门里**没有覆盖率门**，本仓 435 个测试文件从没被问过
 *   「哪个 app 目录一行测试都没有」。这句话不是修辞：答案要真跑一次全量覆盖才拿得到，
 *   而跑一次的代价是 11 分钟 —— 于是没有任何版本去跑，于是「哪个 app 缺测试」永远答不出来。
 *   本门把这一次真跑变成**可复算的读数**，落盘成 `tests/audit/coverage_baseline.json`。
 *
 * 【口径一：只判「不许退步」，绝不设绝对下限】
 *   本仓整体行覆盖 60.95%。设一条「必须 ≥ 80%」会立刻变恒红门（每版都红，
 *   于是人人学会忽略它）—— 那是噪声门，比没有门更坏。
 *   所以门只判两件：① 任一 app 目录 line% 不得比基线低超过 0.5pp；
 *   ② 「零测试目录数」不得增加。两条都是**相对退步**。
 *   判决实现只有一份，在 `scripts/lib/coverage-debt.mjs`（判据也 import 它，不各写一遍）。
 *
 * 【口径二：读数与真跑输出必须逐字对得上（判据 A 组钉住这一点）】
 *   本门不是「另算一套」：它真跑 `node --test --experimental-test-coverage`，
 *   解析 spec 报告器打出来的那张表，把每行原样搬进账本（含未覆盖行清单的行数）。
 *   `--json` 只把同一次读数机读化，不重算。
 *
 * 【口径三：读不到 ⇒ 拒判 exit 2，绝不发合格证】
 *   覆盖表不在场 / 文件行 0 条 / 各 app 目录集合与磁盘不一致 ⇒ exit 2。
 *   与仓内既有纪律同族：「读不到就 fail-closed」。
 *
 * 【口径四：账本是「欠账」，不是「成绩单」】
 *   `note` 里逐字写着两条诚实边界：Node 覆盖不覆盖浏览器层（浏览器侧归 `tests/browser/`），
 *   以及它量的是**行**不是**行为**。这两条不许被后来的版本顺手抹掉（判据 E 组钉住）。
 *
 * 【口径五：链上跑「结构自检」，不跑 11 分钟的真量】
 *   `npm run check` 是**每版都跑**的链，而真跑一次全量覆盖要 11 分钟 —— 把它塞进链里
 *   会让整条链从分钟级涨到十几分钟，于是人人开始 `SKIP`，门等于没有。
 *   所以链上这一档只做**结构自检**（秒级）：
 *     · 账本在场、schema 对、`drop_pp` 与 lib 常量同源；
 *     · 磁盘上 `apps/` 的目录集合与账本目录集合**逐项相等**（新增/删除 app 必须显式 `--write` 刷新，
 *       不许让新 app 「自动」以 0% 混进账本还读成没退步）；
 *     · `TODO.md` 的欠账段与账本**同源**（段被手改过 ⇒ 红）；
 *     · `note` 的两条诚实边界仍在（不许后来的版本顺手抹掉）。
 *   真量对账走 `--verify`（读已落盘日志或真跑），归 full 档与判据套件。
 *
 * 用法：
 *   node scripts/coverage-report.mjs                  # 结构自检（链上这一档，秒级）
 *   node scripts/coverage-report.mjs --json           # 机读读数
 *   node scripts/coverage-report.mjs --write          # 真跑并**重写**账本与 TODO 欠账段
 *   node scripts/coverage-report.mjs --verify         # 真跑一次并与账本比对（判退步，约 11 分钟）
 *   node scripts/coverage-report.mjs --verify --from <log>  # 用已落盘日志代替真跑（离线复算）
 *   node scripts/coverage-report.mjs --root <dir>     # 指定仓根（夹具用）
 * 退出码：0=无退步/自检通过  1=有退步或结构不符  2=拒判
 * ============================================================ */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
    parseCoverageSpec,
    buildAppStats,
    judgeNoRegression,
    zeroTestDirs,
    renderDebtSection,
    spliceDebtSection
} from './lib/coverage-debt.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const argOf = (n) => (argv.indexOf(n) >= 0 ? argv[argv.indexOf(n) + 1] : null);
const JSON_MODE = argv.includes('--json');
const WRITE = argv.includes('--write');
const VERIFY = argv.includes('--verify');
const FROM = argOf('--from');
const ROOT = path.resolve(argOf('--root') || path.join(HERE, '..'));
const BASE_REL = 'tests/audit/coverage_baseline.json';
const TODO_REL = 'TODO.md';
const DROP_PP = 0.5;
const ROW_RE_GUARD = 1;

const say = (s) => { if (!JSON_MODE) console.log(s); };

function readJson(rel) {
    return JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
}

function exists(rel) {
    return fs.existsSync(path.join(ROOT, rel));
}

/** 磁盘上的 app 目录（`apps/` 下的一级目录名，排除文件）。 */
function appDirsOnDisk() {
    const base = path.join(ROOT, 'apps');
    if (!fs.existsSync(base)) return [];
    return fs.readdirSync(base, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name)
        .sort();
}

/** 每个 app 目录下的 .js 全集（**递归**，因为 app 目录里可能有子目录）。 */
function diskFilesByApp(appDirs) {
    const map = new Map();
    for (const app of appDirs) {
        const root = path.join(ROOT, 'apps', app);
        const out = [];
        (function walk(dir, prefix) {
            let ents;
            try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
            for (const e of ents) {
                const rel = prefix ? prefix + '/' + e.name : e.name;
                if (e.isDirectory()) walk(path.join(dir, e.name), rel);
                else if (/\.js$/.test(e.name)) out.push(rel);
            }
        })(root, '');
        map.set(app, out);
    }
    return map;
}

/** 真跑一次全量覆盖，返回 { text, ms }。日志落仓外（不在门禁观测的树里写文件）。 */
function runCoverage() {
    const t0 = Date.now();
    const r = spawnSync(process.execPath, [
        '--test',
        '--experimental-test-coverage',
        'tests/'
    ], { cwd: ROOT, encoding: 'utf8', maxBuffer: 512 * 1024 * 1024, timeout: 60 * 60 * 1000 });
    const ms = Date.now() - t0;
    /* `tests/` 目录形式 Node 不接受（实测 MODULE_NOT_FOUND），改用与 package.json 同款的 glob。 */
    if (r.status !== 0 && !r.stdout) {
        const r2 = spawnSync(process.execPath, [
            '--test', '--experimental-test-coverage'
        ].concat(globTestFiles()), { cwd: ROOT, encoding: 'utf8', maxBuffer: 512 * 1024 * 1024, timeout: 60 * 60 * 1000 });
        return { text: (r2.stdout || '') + (r2.stderr || ''), ms: Date.now() - t0, code: r2.status };
    }
    return { text: (r.stdout || '') + (r.stderr || ''), ms, code: r.status };
}

function globTestFiles() {
    const dir = path.join(ROOT, 'tests');
    return fs.readdirSync(dir)
        .filter((f) => f.endsWith('.test.mjs'))
        .map((f) => 'tests/' + f)
        .sort();
}

function buildLive(text) {
    const rows = parseCoverageSpec(text);
    const appDirs = appDirsOnDisk();
    const disk = diskFilesByApp(appDirs);
    const dirs = buildAppStats({ rows, diskFilesByApp: disk, appDirs });
    return { rows, dirs, appDirs };
}

/**
 * 结构自检（链上跑这一档，秒级）。**不判覆盖率高低**，只判「读数这套东西还是活的」：
 * 账本与磁盘是否同源、TODO 段是否是账本派生出来的、诚实边界是否还在。
 * 这四件任何一件坏了，`--verify` 跑出来的「无退步」都是假话。
 */
function selfCheck() {
    const problems = [];
    let base;
    try {
        base = readJson(BASE_REL);
    } catch (e) {
        console.error('[coverage] 拒判：账本读不出来（' + e.message + '）—— 读不到 ≠ 没退步');
        return 2;
    }
    if (base.schema !== 'coverage-baseline@1') problems.push('账本 schema 不符：' + base.schema);
    if (!base.dirs || typeof base.dirs !== 'object') problems.push('账本没有 dirs 块');
    if (base.drop_pp !== DROP_PP) problems.push('账本 drop_pp=' + base.drop_pp + ' 与工具常量 ' + DROP_PP + ' 不同源');

    /* ① 目录集合必须与磁盘逐项相等 —— 新 app 不许「自动」以 0% 混进账本还读成没退步。 */
    const disk = appDirsOnDisk();
    const inBase = Object.keys(base.dirs || {}).sort();
    const added = disk.filter((d) => !inBase.includes(d));
    const gone = inBase.filter((d) => !disk.includes(d));
    if (added.length) problems.push('磁盘新增 app 目录未进账本 ' + added.length + ' 个（' + added.join('、') + '）—— 请 `--write` 刷新读数');
    if (gone.length) problems.push('账本里的 app 目录在磁盘上已不存在 ' + gone.length + ' 个（' + gone.join('、') + '）—— 请 `--write` 刷新读数');

    /* ② TODO 欠账段必须是账本派生的（手改 ⇒ 红）。 */
    const todoPath = path.join(ROOT, TODO_REL);
    if (fs.existsSync(todoPath)) {
        const todo = fs.readFileSync(todoPath, 'utf8');
        const want = renderDebtSection(base.dirs || {}, { version: base.version });
        if (todo.indexOf(want) < 0) {
            problems.push('TODO.md 的欠账段与账本不同源（被手改过，或用旧版生成）—— 请 `--write` 重生成');
        }
    } else {
        problems.push('TODO.md 不在场');
    }

    /* ③ 两条诚实边界必须仍在（不许后来的版本顺手抹掉）。 */
    const note = String(base.note || '');
    if (!/不覆盖浏览器层/.test(note)) problems.push('note 里「不覆盖浏览器层」这条诚实边界丢了');
    if (!/不是\*\*行为被断言过\*\*|不是\*\*行为被断言过|行为被断言/.test(note) && !/行被执行过/.test(note)) {
        problems.push('note 里「量的是行不是行为」这条诚实边界丢了');
    }

    const zeros = zeroTestDirs(base.dirs || {});
    const payload = {
        ver: base.version,
        measured_at: base.measured_at,
        totals: base.totals,
        zero_test_dirs: zeros,
        problems
    };
    if (JSON_MODE) {
        console.log(JSON.stringify(payload, null, 2));
    } else {
        console.log('[coverage] 账本 v' + base.version + '（量于 ' + base.measured_at + '）· app 目录 ' +
            Object.keys(base.dirs || {}).length + ' 个 · 零测试目录 ' + zeros.length + ' 个');
        if (!problems.length) {
            console.log('[coverage] v 覆盖率账本结构自检通过（账本与磁盘同源、TODO 段同源、两条诚实边界都在）');
            console.log('[coverage] 说明：本档**不判覆盖率高低**，真量对账走 `node scripts/coverage-report.mjs --verify`。');
        } else {
            console.log('[coverage] x 覆盖率账本结构不符 ' + problems.length + ' 处：');
            for (const p of problems) console.log('        · ' + p);
        }
    }
    return problems.length ? 1 : 0;
}

function main() {
    if (!exists(BASE_REL) && !WRITE) {
        console.error('[coverage] 拒判：账本 ' + BASE_REL + ' 不在场，且没有 --write —— 没有基线就没有「不许退步」这回事');
        return 2;
    }

    /* ── 默认档：结构自检（秒级，链上跑这一档） ── */
    if (!WRITE && !VERIFY) {
        return selfCheck();
    }

    let text = null;
    let runMs = null;
    if (FROM) {
        if (!exists(FROM)) {
            console.error('[coverage] 拒判：--from 指定的日志 ' + FROM + ' 不在场');
            return 2;
        }
        text = fs.readFileSync(path.join(ROOT, FROM), 'utf8');
    } else {
        say('[coverage] 真跑全量覆盖（约 11 分钟）……');
        const r = runCoverage();
        text = r.text;
        runMs = r.ms;
        if (!text || text.trim() === '') {
            console.error('[coverage] 拒判：覆盖真跑没有任何输出');
            return 2;
        }
    }

    const live = buildLive(text);
    if (!live.rows.length) {
        console.error('[coverage] 拒判：覆盖表里一条文件行都没解析到 —— 证据全无，不得读成「覆盖率 100%」');
        return 2;
    }
    if (!live.appDirs.length) {
        console.error('[coverage] 拒判：磁盘上 apps/ 下没有任何 app 目录（扫描根不对）');
        return 2;
    }
    if (live.rows.length < ROW_RE_GUARD) {
        console.error('[coverage] 拒判：读数行异常偏少（' + live.rows.length + '）');
        return 2;
    }

    const totalZero = live.appDirs.reduce((a, d) => a + live.dirs[d].zero_test_files, 0);
    const totalFiles = live.appDirs.reduce((a, d) => a + live.dirs[d].files_on_disk, 0);

    if (WRITE) {
        const pkg = readJson('package.json');
        const doc = {
            schema: 'coverage-baseline@1',
            version: pkg.version,
            measured_at: new Date().toISOString().slice(0, 10),
            measured_by: 'node scripts/coverage-report.mjs --write',
            drop_pp: DROP_PP,
            note: [
                '这是**欠账账本**，不是成绩单：它记的是「哪些 app 目录缺测试」，不是「我们做得多好」。',
                '诚实边界一：Node 的 --experimental-test-coverage **不覆盖浏览器层** —— tests/browser/ 下的'
                + '场景（20 个正式场景 × 4 档视口）不计入本表任何一格，那一面归 tests/browser/gate.mjs 与'
                + ' tests/audit/browser_readings.json。',
                '诚实边界二：它量的是**行被执行过**，不是**行为被断言过**。一行被 import 进测试进程就算覆盖，'
                + '哪怕没有任何断言碰它。所以本表只用来找「一行都没跑的角落」，不用来宣称质量。',
                '口径：line% 是**行加权**（Σ覆盖行/Σ总行，由 line% 与未覆盖行清单联立解出），不是各文件百分比的平均；'
                + '「零测试」= 磁盘上有这个文件、量出来一行都没覆盖，含从未被 import 的那些。',
                '门禁只做「不许退步」：任一 app 目录 line% 不得比本账本低超过 drop_pp，且零测试目录数不得增加。'
                + '不设绝对下限 —— 本仓整体行覆盖 60.95%，设 80% 会立刻变恒红噪声门。'
            ].join(' '),
            totals: {
                app_dirs: live.appDirs.length,
                files_on_disk: totalFiles,
                zero_test_files: totalZero,
                zero_test_dirs: zeroTestDirs(live.dirs).length,
                coverage_rows: live.rows.length
            },
            dirs: live.dirs
        };
        fs.writeFileSync(path.join(ROOT, BASE_REL), JSON.stringify(doc, null, 2) + '\n');
        say('[coverage] 账本已写盘：' + BASE_REL + '（app 目录 ' + live.appDirs.length +
            ' 个 · 盘上文件 ' + totalFiles + ' · 零覆盖文件 ' + totalZero + '）');

        /* TODO.md 的欠账段由读数派生，不手抄。 */
        const section = renderDebtSection(live.dirs, { version: pkg.version });
        const todoPath = path.join(ROOT, TODO_REL);
        if (fs.existsSync(todoPath)) {
            const before = fs.readFileSync(todoPath, 'utf8');
            const after = spliceDebtSection(before, section);
            if (after !== before) {
                fs.writeFileSync(todoPath, after);
                say('[coverage] TODO.md 欠账段已由读数重写（不手抄）');
            } else {
                say('[coverage] TODO.md 欠账段已同源，未改动');
            }
        }
        return 0;
    }

    const base = readJson(BASE_REL);
    const judge = judgeNoRegression(base.dirs || {}, live.dirs, { dropPp: DROP_PP });
    const payload = {
        ver: base.version,
        run_ms: runMs,
        judge,
        live: {
            totals: {
                app_dirs: live.appDirs.length,
                files_on_disk: totalFiles,
                zero_test_files: totalZero,
                zero_test_dirs: zeroTestDirs(live.dirs).length
            },
            dirs: live.dirs
        }
    };

    if (JSON_MODE) {
        console.log(JSON.stringify(payload, null, 2));
    } else {
        const t = payload.live.totals;
        console.log('[coverage] app 目录 ' + t.app_dirs + ' 个 · 盘上文件 ' + t.files_on_disk +
            ' 个 · 一行都没覆盖 ' + t.zero_test_files + ' 个');
        console.log('[coverage] 零测试目录：基线 ' + judge.baseZeroCount + ' → 现场 ' + judge.liveZeroCount +
            ' 个（口径 ' + judge.dropPp + 'pp）');
        if (judge.verdict === 'pass') {
            console.log('[coverage] v 覆盖率无退步（既没有目录掉超过 ' + judge.dropPp + 'pp，零测试目录也没有增加）');
        } else if (judge.verdict === 'refuse') {
            console.log('[coverage] ? 拒判：' + judge.reasons.join('；'));
        } else {
            console.log('[coverage] x 覆盖率退步：');
            for (const r of judge.reasons) console.log('        · ' + r);
        }
    }

    if (judge.verdict === 'pass') return 0;
    if (judge.verdict === 'fail') return 1;
    return 2;
}

process.exit(main());