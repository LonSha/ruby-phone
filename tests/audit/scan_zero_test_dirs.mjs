#!/usr/bin/env node
/* ============================================================
 * tests/audit/scan_zero_test_dirs.mjs —— 「零测试 app 目录」的**便宜读数**（R22-O6）
 * ------------------------------------------------------------
 * 【为什么不直接刷 coverage_baseline.json】
 *   权威口径在 `scripts/coverage-report.mjs`，它要真跑全量覆盖（约 11 分钟，
 *   450+ 测试文件）。本环境跑不动全量 `node --test`，强行 --write 会写出
 *   `zero_test_files=439`（= 全仓未覆盖）这种**假读数**——那是把「没跑成」记成「全没测」，
 *   正是本仓纪律禁止的「用一个补登抹平两种事实」。所以本文件**不动那份账本**。
 *
 * 【本文件的口径（故意与行覆盖不同，写清楚差别）】
 *   问：某个 `apps/<dir>/` 下的源文件，有没有**任何一个测试文件引用过它的模块路径**？
 *   有 = 该目录不是「零测试目录」；没有 = 仍是零测试。
 *   它比行覆盖弱（引用 ≠ 断言覆盖到每一行），但它是**秒级、可复算、不依赖跑全量**的，
 *   足以判「从 0 变到非 0」这件事，也足以当退步门的廉价半边。
 *
 * 用法：
 *   node tests/audit/scan_zero_test_dirs.mjs          # 人读
 *   node tests/audit/scan_zero_test_dirs.mjs --json    # 机读
 *   node tests/audit/scan_zero_test_dirs.mjs --check   # 有零测试目录则 exit 1（判据用）
 * 退出码：0=无零测试目录 1=仍有零测试目录 2=拒判（读不到 apps/ 或 tests/）
 * ============================================================ */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const argv = process.argv.slice(2);
const JSON_MODE = argv.includes('--json');
const CHECK = argv.includes('--check');

/* R22-O6 立项时点名的十个目录。留作对照：本判据若把它们判成「有测试」，才算这项完成。 */
const R22O6_TARGETS = [
    'accessdesk', 'caphealth', 'cardtable', 'freehome', 'lexiscore',
    'mofo', 'periodmath', 'playbook', 'stickerdesk', 'sullydesk'
];

function die(msg) {
    if (JSON_MODE) console.log(JSON.stringify({ ok: false, reason: msg }));
    else console.log(`[zero-test-dirs] 拒判：${msg}`);
    process.exit(2);
}

const appsDir = path.join(ROOT, 'apps');
const testsDir = path.join(ROOT, 'tests');
if (!fs.existsSync(appsDir) || !fs.existsSync(testsDir)) die('读不到 apps/ 或 tests/');

const appNames = fs.readdirSync(appsDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();

/* 测试侧语料：所有 .mjs/.js，拼成一段文本后按目录名找引用。
 * 只认三种形态，避免正则宽到「注释里写个名字就命中」：
 *   ① 相对路径导入：'../apps/<dir>/...'
 *   ② 绝对式引用：'/apps/<dir>/...'
 *   ③ 显式导入那一个目录下的文件名：apps/<dir>/<file>.js
 */
function readAllTests() {
    const out = [];
    (function walk(dir) {
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
            const p = path.join(dir, e.name);
            if (e.isDirectory()) walk(p);
            else if (/\.(mjs|cjs|js)$/.test(e.name)) out.push(p);
        }
    })(testsDir);
    return out;
}

const testFiles = readAllTests();
const corpus = testFiles.map((f) => {
    try { return fs.readFileSync(f, 'utf8'); } catch { return ''; }
}).join('\n');

function filesOfApp(app) {
    const dir = path.join(appsDir, app);
    const out = [];
    (function walk(d, prefix) {
        for (const e of fs.readdirSync(d, { withFileTypes: true })) {
            const rel = prefix ? `${prefix}/${e.name}` : e.name;
            if (e.isDirectory()) walk(path.join(d, e.name), rel);
            else if (/\.js$/.test(e.name)) out.push(rel);
        }
    })(dir, '');
    return out;
}

const zero = [];
const covered = [];
for (const app of appNames) {
    const files = filesOfApp(app);
    if (files.length === 0) continue;
    const referenced = files.some((rel) => {
        const esc = rel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const re = new RegExp(`(?:^|["'\`/])apps/${app}/${esc}`);
        const re2 = new RegExp(`\\.\\./apps/${app}/${esc}`);
        return re.test(corpus) || re2.test(corpus);
    });
    (referenced ? covered : zero).push(app);
}

const targetState = R22O6_TARGETS.map((app) => ({
    app,
    referenced: !zero.includes(app)
}));
const targetsDone = targetState.filter((t) => t.referenced).length;

const result = {
    ok: zero.length === 0,
    appDirs: appNames.length,
    testFilesScanned: testFiles.length,
    zeroTestDirs: zero.length,
    zeroNames: zero,
    coveredDirs: covered.length,
    r22o6: {
        targets: R22O6_TARGETS.length,
        referencedCount: targetsDone,
        pending: R22O6_TARGETS.filter((a) => zero.includes(a))
    }
};

if (JSON_MODE) {
    console.log(JSON.stringify(result, null, 2));
} else {
    console.log(`[zero-test-dirs] app 目录 ${result.appDirs} 个 · 扫描测试文件 ${result.testFilesScanned} 个`);
    console.log(`[zero-test-dirs] 零测试目录 ${result.zeroTestDirs} 个${result.zeroTestDirs ? '：' + zero.join(', ') : ''}`);
    console.log(`[zero-test-dirs] R22-O6 点名十目录：${targetsDone}/${R22O6_TARGETS.length} 已被测试引用` +
        (result.r22o6.pending.length ? `（仍缺：${result.r22o6.pending.join(', ')}）` : '（全数覆盖）'));
    console.log('[zero-test-dirs] 口径说明：引用 = 「有测试碰过这个目录的模块」，比行覆盖弱，不等于每行被断言。');
}

if (CHECK && zero.length > 0) process.exit(1);
process.exit(0);
