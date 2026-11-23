// SYS-V4195 数组读取面收敛：16 份 safeArr 复制件 → config/array-face.js
// 为什么做这一件：本版重做全仓同名函数体指纹扫描（v4.194.0 后新基线），实测保持。写判据测试。
//   `function safeArr(v) { return Array.isArray(v) ? v : []; }` 在 apps 与 config 里有
//   **16 份逐字相同**（1 变体，零分簇成本），调用点合计 49 处。其中两处是零调用死定义
//   （recovery-hub.js / response-cadence.js），全仓无任何门禁会发现「这个函数没人用」。
// 实现纪律：本档不用正则做源码断言，一律 indexOf / 花括号配平（生成链会吃反斜杠）。
// 等价性纪律：转调前后必须**逐用例零差异**，且保持「原样返回不拷贝」。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const NL = String.fromCharCode(10);

const AF = await import('../config/array-face.js');
const CORE = 'config/array-face.js';

/** 语义化版本比较：a > b 给 1，相等 0，a < b 给 -1（版本锚下限形用）。 */
const cmp = (a, b) => {
    const pa = String(a).split('.').map(Number);
    const pb = String(b).split('.').map(Number);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
        const x = pa[i] || 0;
        const y = pb[i] || 0;
        if (x !== y) return x > y ? 1 : -1;
    }
    return 0;
};

/* 14 处转调（16 处定义 − 2 处零调用死定义，见 B3）。 */
const CONVERTED = [
    'apps/wallet/economy-store.js',
    'config/action-stack.js',
    'config/character-dwelling.js',
    'config/creator-bundle-ecosystem.js',
    'config/diff-editor-desk.js',
    'config/economy-face-bridge.js',
    'config/joint-media-studio.js',
    'config/life-program-replay.js',
    'config/living-assets.js',
    'config/resume-anchor.js',
    'config/rule-theatre.js',
    'config/urban-economy.js',
    'config/usage-paradigm.js',
    'config/user-work-package.js'
];
/* 2 处零调用死定义：整条定义与 import 一并清掉（与 v4.193.0 sullydesk 同病）。 */
const DEAD = [
    'config/recovery-hub.js',
    'config/response-cadence.js'
];

/* ══════════ A 组 · 内核纯度与等价性 ══════════ */
test('A1 内核源码面零副作用、零类、不自己取随机与时钟', () => {
    const src = read(CORE).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    for (const bad of ['Math.random', 'Date.now', 'class ', 'this.', 'localStorage', 'sessionStorage', 'window.', 'document.', 'fetch(', 'import.meta.url']) {
        assert.equal(src.indexOf(bad), -1, '内核不许出现 ' + bad);
    }
});

test('A2 safeArr 与原 16 份复制件逐用例等价（16 例 0 diff）', () => {
    const OLD = (v) => { return Array.isArray(v) ? v : []; };
    const cases = [
        null, undefined, [], [1, 2], {}, { length: 3 }, 'abc', 0, 1,
        true, false, NaN, Infinity, () => {}, new Array(3), Array.from({ length: 2 })
    ];
    let diff = 0;
    for (const c of cases) {
        const a = JSON.stringify(OLD(c));
        const b = JSON.stringify(AF.safeArr(c));
        if (a !== b) { diff++; console.log('  DIFF', String(c), a, b); }
    }
    assert.equal(diff, 0, 'safeArr 必须与原复制件逐用例等价');
});

test('A3 safeArr 三条立场（只认真数组 / 不拷贝 / 空数组不是兜底值）', () => {
    /* ① 只认真数组：类数组、有 items 的包装对象一律不收（与 listOf 的宽口径不同族）。 */
    assert.deepEqual(AF.safeArr({ length: 3 }), []);
    assert.deepEqual(AF.safeArr({ items: [1, 2] }), []);
    assert.deepEqual(AF.safeArr('abc'), []);
    assert.deepEqual(AF.safeArr(null), []);
    assert.deepEqual(AF.safeArr(undefined), []);
    /* ② **原样返回，不拷贝** —— 改成 .slice() 是性能口径变更，不是等价转调。 */
    const orig = [1, 2, 3];
    assert.equal(AF.safeArr(orig), orig, '数组必须原样返回（同一引用）');
    /* ③ 空数组是如实回答。 */
    assert.deepEqual(AF.safeArr([]), []);
});

test('A4 内核只导出被真消费的面（一个具名出口，且不许有 default 面）', () => {
    const named = Object.keys(AF).filter((k) => k !== 'default');
    assert.deepEqual(named.sort(), ['safeArr'], '本版只收敛一条口径，只许一个具名出口');
    assert.equal('default' in AF, false, '不许有 default 出口（零消费面）');
    assert.equal(typeof AF.safeArrLoose, 'undefined', '不许造宽松口径副本');
    assert.equal(typeof AF.arrOr, 'undefined', '不许造带兜底值的变体');
    assert.equal(typeof AF.safeList, 'undefined', '不许造与 listOf 混淆的别名');
});

/* ══════════ B 组 · 源文件转调 ══════════ */
test('B1 14 个转调文件：本地定义已删、import 内核、仍有调用点', () => {
    const callpat = /(^|[^A-Za-z0-9_$.])safeArr\(/;
    for (const rel of CONVERTED) {
        const raw = read(rel);
        assert.equal(raw.indexOf('function safeArr(v)'), -1, rel + ' 的 safeArr 定义必须已删');
        assert.ok(raw.indexOf('array-face.js') >= 0, rel + ' 必须 import 内核');
        const body = raw.split(NL).filter((l) => l.indexOf('array-face.js') < 0).join(NL);
        assert.ok(callpat.test(body), rel + ' 必须仍有 safeArr 调用点');
    }
});

test('B2 每个转调文件的 import 都落在注释块之外（v4.194.0 踩过：插进块注释会被吞）', () => {
    for (const rel of CONVERTED) {
        const lines = read(rel).split(NL);
        for (let i = 0; i < lines.length; i++) {
            if (lines[i].indexOf('array-face.js') < 0) continue;
            let inblock = false;
            for (let k = 0; k < i; k++) {
                if (lines[k].indexOf('/*') >= 0) inblock = true;
                if (lines[k].indexOf('*/') >= 0) inblock = false;
            }
            assert.equal(inblock, false, rel + ' 的 array-face import 不许落在块注释内');
            /* 也不许落在另一条 import 语句的多行块中间。 */
            assert.ok(!/^import\s*\{?\s*$/.test(lines[i]) || lines[i].indexOf('array-face') >= 0,
                rel + ' 的 import 必须是完整语句');
            break;
        }
    }
});

test('B3 两处零调用死定义：定义与 import 一并清净（v4.193.0 sullydesk 同病）', () => {
    for (const rel of DEAD) {
        const raw = read(rel);
        assert.equal(raw.indexOf('function safeArr(v)'), -1, rel + ' 的死定义必须已删');
        assert.equal(raw.indexOf('array-face.js'), -1, rel + ' 本零调用，不该留 import（不留零消费导入）');
        assert.equal(raw.indexOf('safeArr'), -1, rel + ' 全文不该再出现 safeArr');
    }
});

/* ══════════ C 组 · 全仓不再有第二份同族实现 ══════════ */
test('C1 apps 与 config 下不再有 safeArr 本地定义', () => {
    const roots = [path.join(ROOT, 'apps'), path.join(ROOT, 'config')];
    const leftovers = [];
    const stack = roots.slice();
    while (stack.length) {
        const dir = stack.pop();
        if (!fs.existsSync(dir)) continue;
        for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
            const p = path.join(dir, ent.name);
            if (ent.isDirectory()) { stack.push(p); continue; }
            if (!ent.name.endsWith('.js')) continue;
            const rel = path.relative(ROOT, p);
            if (rel === CORE) continue;
            const raw = fs.readFileSync(p, 'utf8');
            if (/(^|\n)\s*(?:export\s+)?function\s+safeArr\s*\(/.test(raw)) leftovers.push(rel);
        }
    }
    assert.deepEqual(leftovers, [], 'apps 与 config 下不许再有 safeArr 本地定义');
});

test('C2 listOf 的宽口径变体刻意未动（解包 items 的不是同一语义）', () => {
    /* 仓内 listOf 有 4 变体，其中 2 个会把 { items: [...] } 解包成数组 —— 那是更宽的口径，
     *   与 safeArr 的「只认真数组」不是同一语义，本版不动它们。 */
    const roots = [path.join(ROOT, 'apps'), path.join(ROOT, 'config')];
    const stack = roots.slice();
    const wide = [];
    while (stack.length) {
        const dir = stack.pop();
        if (!fs.existsSync(dir)) continue;
        for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
            const p = path.join(dir, ent.name);
            if (ent.isDirectory()) { stack.push(p); continue; }
            if (!ent.name.endsWith('.js')) continue;
            const rel = path.relative(ROOT, p);
            const raw = fs.readFileSync(p, 'utf8');
            if (raw.indexOf('Array.isArray(v.items)') >= 0) wide.push(rel);
        }
    }
    assert.ok(wide.length >= 2, '应至少仍有 2 处 listOf 宽口径变体在场：' + wide.join(', '));
});

/* ══════════ V 组 · 版本锚 ══════════ */
test('V1 五源版本号不低于 4.195.0', () => {
    const man = JSON.parse(read('manifest.json'));
    const pkg = JSON.parse(read('package.json'));
    assert.ok(cmp(man.version, '4.195.0') >= 0, 'manifest.json 必须不低于 4.195.0，当前 ' + man.version);
    assert.equal(pkg.version, man.version, 'package.json 必须与 manifest 同版');
    const ul = JSON.parse(read('update-log.json'));
    assert.equal(ul.latest, man.version, 'update-log.json latest 必须与 manifest 同版');
    assert.ok(ul.versions['4.195.0'], 'update-log.json 必须有 4.195.0 条目（本版交付物）');
    assert.ok(ul.versions[man.version], 'update-log.json 必须有当版条目');
    const idx = read('index.js');
    assert.ok(idx.indexOf("'" + man.version + "'") >= 0, 'index.js 必须出现当版号');
    const iter = read('ITERATION_LOG.md');
    assert.ok(iter.indexOf(man.version) >= 0, 'ITERATION_LOG.md 必须出现当版号');
});