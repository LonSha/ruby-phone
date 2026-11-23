// SYS-V4193 数值展示面收敛：13 份 num + 5 份 numOrSelf 复制件 → config/num-face.js
// 为什么做这一件：本版做全仓同名函数体指纹扫描，实测 apps 下 12 个 *-view.js 里有
//   **13 份逐字相同**的 `function num(v) { return (typeof v === 'number' &&
//   Number.isFinite(v)) ? String(v) : DASH; }`，另有 5 个 app 层有逐字相同的
//   `numOrSelf(v, self)`。调用点合计 92 处。其中 sullydesk-view.js 那一份
//   **零调用**（死定义），而仓里没有任何一道门禁会发现它 —— 靠指纹比对才露出来。
//   这与 config/num-clamp.js 治的 boundedInt 11 份复制是同一个病：口径没有单一实现。
// 实现纪律：本档不用正则，一律 indexOf（生成链会吃反斜杠，与 v4186~v4192 同一条）。
// 等价性纪律：转调前后必须**逐用例零差异**。本档用 24 个用例对拍
//   （numeralText / moneyText / numOrSelf 三条全部 0 diff），并把「为什么不改用
//   numOrNull 的字符串解析」写进 A 组：改用它会让 '5' 从 '--' 变 '5'、'0x10' 变 '16'。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const NL = String.fromCharCode(10);

const NF = await import('../config/num-face.js');
const NG = await import('../config/num-gate.js');

const CORE = 'config/num-face.js';

/* 12 个视图：num 定义已删、改为 import numeralText */
const VIEW_FILES = [
    'apps/annidate/annidate-view.js',
    'apps/cardtable/cardtable-view.js',
    'apps/freehome/freehome-view.js',
    'apps/gacha/gacha-view.js',
    'apps/lexiscore/lexiscore-view.js',
    'apps/memtable/memtable-view.js',
    'apps/periodmath/periodmath-view.js',
    'apps/socialguard/socialguard-view.js',
    'apps/stickerdesk/stickerdesk-view.js',
    'apps/summdesk/summdesk-view.js',
    'apps/traveldesk/traveldesk-view.js',
    'apps/xhs/xhs-view.js'
];

/* 5 个 app：numOrSelf 定义已删、改为 import numOrSelf */
const APP_FILES = [
    'apps/kettle/kettle-app.js',
    'apps/musicdesk/musicdesk-app.js',
    'apps/needsim/needsim-app.js',
    'apps/recall/recall-app.js',
    'apps/sourcebook/sourcebook-app.js'
];

/* ══════════ A 组 · 内核纯度与行为等价 ══════════ */
test('A1 内核源码面零副作用、零类、不自己取随机与时钟', () => {
    const raw = read(CORE);
    const s = raw.split(NL)
        .filter((l) => {
            const t = l.trim();
            return t.indexOf('*') !== 0 && t.indexOf('//') !== 0 && t.indexOf('/*') !== 0;
        })
        .join(NL);
    assert.equal(s.indexOf('Math.random'), -1, '内核不许自己取随机源');
    assert.equal(s.indexOf('Date.now'), -1, '内核不许自己读系统时钟');
    assert.equal(s.indexOf('class '), -1, '内核不许有类');
    assert.equal(s.indexOf('this.'), -1, '内核不许持实例状态');
    for (const bad of ['localStorage', 'sessionStorage', 'window.', 'document.', 'fetch(', 'import.meta.url']) {
        assert.equal(s.indexOf(bad), -1, '内核里不许有 ' + bad);
    }
});

test('A2 numeralText 与原 13 份复制件逐用例等价（24 例 0 diff）', () => {
    /* 原实现逐字抄来这里当基线 —— 不是抄概念，是抄那一行。 */
    const numOld = (v) => (typeof v === 'number' && Number.isFinite(v)) ? String(v) : '--';
    const cases = [
        0, 1, -1, 3.5, NaN, Infinity, -Infinity, null, undefined,
        '', '5', '5.5', 'abc', ' 7 ', '0', true, false, [], {}, [5], '0x10', '1e3'
    ];
    for (const c of cases) {
        assert.equal(NF.numeralText(c), numOld(c), 'numeralText 对 ' + JSON.stringify(c) + ' 必须与原实现同值');
    }
    /* 三条立场各自钉一条：0 是合法读数、读不出给占位符、字符串数字给占位符（不放宽）。 */
    assert.equal(NF.numeralText(0), '0', '0 是合法读数，不许画成占位符');
    assert.equal(NF.numeralText(null), '--', '读不出给占位符，绝不给 0');
    assert.equal(NF.numeralText('5'), '--', '字符串数字给占位符 —— 这里刻意不放宽成 numOrNull');
    assert.equal(NF.numeralText(42, '缺'), '42', '取到数时用数字本体，不拼占位符');
    assert.equal(NF.numeralText(NaN, '缺'), '缺', 'NaN 不算取到数');
});

test('A3 moneyText 与 traveldesk 原 money(v) 逐用例等价', () => {
    const moneyOld = (v) => {
        const n = (typeof v === 'number' && Number.isFinite(v)) ? v : null;
        return n === null ? '--' : String(Math.round(n * 100) / 100);
    };
    const cases = [0, 1, -1, 3.5, 0.005, 1.005, 2.675, NaN, Infinity, null, undefined, '', '5', 'abc'];
    for (const c of cases) {
        assert.equal(NF.moneyText(c), moneyOld(c), 'moneyText 对 ' + JSON.stringify(c) + ' 必须与原实现同值');
    }
    assert.equal(NF.moneyText(12.5), '12.5', '四舍五入到分');
    assert.equal(NF.moneyText(null), '--', '读不出不画 0.00');
});

test('A4 numOrSelf 与原 5 份复制件逐用例等价（它们本就是 numOrNull 的一层包装）', () => {
    /* 原实现用的正是 config/num-gate.js 的 numOrNull，这里直接引它当基线。 */
    const numOrNull = NG.numOrNull;
    const numOrSelfOld = (v, self) => {
        const n = numOrNull(v);
        return n === null ? self : n;
    };
    const cases = [0, 1, -1, 3.5, NaN, Infinity, null, undefined, '', '5', '5.5', 'abc', ' 7 ', '0', true, false, [], [5], '0x10', '1e3'];
    for (const c of cases) {
        assert.equal(NF.numOrSelf(c, -1), numOrSelfOld(c, -1), 'numOrSelf 对 ' + JSON.stringify(c) + ' 必须与原实现同值');
    }
    assert.equal(NF.numOrSelf(null, 7), 7, '取不到落回调用方给的默认值');
    assert.equal(NF.numOrSelf(0, 7), 0, '0 是合法读数，不许落回默认值');
    assert.equal(NF.numOrSelf('12', 7), 12, 'numOrSelf 这一条本来就认字符串数字（与原实现一致）');
});

test('A5 内核只导出被真消费的四个面（不许留零消费出口）', () => {
    const raw = read(CORE);
    for (const name of ['numeralText', 'numOrSelf', 'moneyText', 'NUMERAL_DASH']) {
        assert.ok(raw.indexOf('export function ' + name + '(') >= 0 || raw.indexOf('export const ' + name) >= 0,
            '内核应导出 ' + name);
    }
    /* 本版先建过 numeralTextLoose / countText 两个出口，零消费，按纪律删掉 —— 这里钉住不许复活。 */
    assert.equal(raw.indexOf('numeralTextLoose'), -1, '零消费出口 numeralTextLoose 已删，不许复活');
    assert.equal(raw.indexOf('countText'), -1, '零消费出口 countText 已删，不许复活');
});

/* ══════════ B 组 · 源文件真的转调（实现不再留在编排面） ══════════ */
test('B1 12 个视图的本地 num 定义已删净，且都 import 了内核', () => {
    for (const f of VIEW_FILES) {
        const raw = read(f);
        assert.equal(raw.indexOf('function num(v)'), -1, f + ' 不许再留本地 num 定义');
        assert.ok(raw.indexOf("from '../../config/num-face.js'") >= 0, f + ' 必须引用数值展示面内核');
        /* 调用点必须真的改名成 numeralText，不许留着裸 num( 调用。 */
        assert.ok(raw.indexOf('numeralText(') >= 0, f + ' 必须有 numeralText 调用点');
    }
});

test('B2 traveldesk 的 money 定义已删、调用点改成 moneyText', () => {
    const raw = read('apps/traveldesk/traveldesk-view.js');
    assert.equal(raw.indexOf('function money(v)'), -1, 'traveldesk 不许再留本地 money 定义');
    assert.ok(raw.indexOf('moneyText(') >= 0, 'traveldesk 必须有 moneyText 调用点');
    assert.ok(raw.indexOf('numeralText, moneyText') >= 0, 'traveldesk 的 import 要同时带两个具名');
});

test('B3 5 个 app 的本地 numOrSelf 定义已删净，且都 import 了内核', () => {
    for (const f of APP_FILES) {
        const raw = read(f);
        assert.equal(raw.indexOf('function numOrSelf('), -1, f + ' 不许再留本地 numOrSelf 定义');
        assert.ok(raw.indexOf('numOrSelf }') >= 0 || raw.indexOf("import { numOrSelf }") >= 0,
            f + ' 必须引用内核的 numOrSelf');
        assert.ok(raw.indexOf('numOrSelf(') >= 0, f + ' 必须有 numOrSelf 调用点');
    }
});

test('B4 sullydesk 的死定义已清（零调用那一份）', () => {
    const raw = read('apps/sullydesk/sullydesk-view.js');
    assert.equal(raw.indexOf('function num(v)'), -1, 'sullydesk-view.js 的零调用死定义必须已删');
});

/* ══════════ C 组 · 全仓不再有第二份同族实现 ══════════ */
test('C1 apps 下不再有本地展示口径函数定义（num 逐字复制件 / numOrSelf / money）', () => {
    /* 逐一扫 apps 下各 js。判据只钉「展示面」：函数体逐字等于那 13 份 num 复制件、
     *   或定义 numOrSelf / money 展示函数。取值面不在此列 ——
     *   recall-data.js / ledger-data.js 的 num 是 numOrNull 包装（v3.12.0 取值门，返回 number|null），
     *   asset/engine 三处 num 返回 number/NaN 供计算用，都不是「画给人看的串」。 */
    const appsDir = path.join(ROOT, 'apps');
    const stack = [appsDir];
    const leftovers = [];
    const exactDup = 'function num(v) { return (typeof v === \'number\' && Number.isFinite(v)) ? String(v) : DASH; }';
    while (stack.length) {
        const dir = stack.pop();
        for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
            const p = path.join(dir, ent.name);
            if (ent.isDirectory()) { stack.push(p); continue; }
            if (!ent.name.endsWith('.js')) continue;
            const raw = fs.readFileSync(p, 'utf8');
            if (raw.indexOf(exactDup) >= 0) leftovers.push(path.relative(ROOT, p) + ' :: num 复制件');
            for (const def of ['function numOrSelf(', 'function money(v)']) {
                if (raw.indexOf(def) >= 0) leftovers.push(path.relative(ROOT, p) + ' :: ' + def);
            }
        }
    }
    assert.deepEqual(leftovers, [], 'apps 下不许再有本地展示函数定义');
});

/* ══════════ V 组 · 版本锚 ══════════ */
test('V1 五源版本号抬到 4.193.0', () => {
    const pkg = JSON.parse(read('package.json'));
    assert.equal(pkg.version, '4.193.0', 'package.json');
    const man = JSON.parse(read('manifest.json'));
    assert.equal(man.version, '4.193.0', 'manifest.json');
    const ul = JSON.parse(read('update-log.json'));
    assert.ok(ul.versions['4.193.0'], 'update-log.json 必须有 4.193.0 条目');
    assert.equal(ul.latest, '4.193.0', 'update-log.json latest');
    const idx = read('index.js');
    assert.ok(idx.indexOf("'4.193.0'") >= 0, 'index.js 必须出现 4.193.0');
    const iter = read('ITERATION_LOG.md');
    assert.ok(iter.indexOf('4.193.0') >= 0, 'ITERATION_LOG.md 必须出现 4.193.0');
});
