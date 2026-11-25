// SYS-V4194 文本读取面收敛：31 份 toStr 复制件 → config/text-face.js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const TF = await import('../config/text-face.js');
const CORE = 'config/text-face.js';

/* ---------- 转调清单（31 处，实测自全仓同名函数体指纹扫描） ---------- */
/* 12 处 export 形：删定义，import 内核 + re-export（外部经命名空间 import 消费）。 */
const EQ_EXPORT = [
    'apps/annidate/annidate-data.js',
    'apps/cardtable/cardtable-data.js',
    'apps/freehome/freehome-data.js',
    'apps/lexiscore/lexiscore-data.js',
    'apps/memtable/memtable-data.js',
    'apps/periodmath/periodmath-data.js',
    'apps/socialguard/socialguard-data.js',
    'apps/stickerdesk/stickerdesk-data.js',
    'apps/sullydesk/sullydesk-data.js',
    'apps/summdesk/summdesk-data.js',
    'apps/traveldesk/traveldesk-data.js',
    'config/task-entry.js'
];
/* 19 处私有形：删定义，import 内核。 */
const EQ_PRIV = [
    'apps/archive/archive-app.js',
    'apps/cotdesk/cotdesk-app.js',
    'apps/diagdesk/diagdesk-app.js',
    'apps/doujin/doujin-app.js',
    'apps/kettle/kettle-app.js',
    'apps/kettle/kettle-data.js',
    'apps/musicdesk/musicdesk-app.js',
    'apps/needsim/needsim-app.js',
    'apps/needsim/needsim-data.js',
    'apps/pvdesk/pvdesk-app.js',
    'apps/recall/recall-app.js',
    'apps/recall/recall-data.js',
    'apps/sourcebook/sourcebook-app.js',
    'apps/sourcebook/sourcebook-data.js',
    'apps/traveldesk/traveldesk-plan.js',
    'apps/uterus/uterus-app.js',
    'apps/uterus/uterus-data.js',
    'apps/uterus/uterus-view.js',
    'config/group-vote-handoff.js'
];
/* 2 处不同口径，**刻意不动**（见 C2）。 */
const NOT_EQUIV = [
    'apps/affairs/affairs-app.js',
    'apps/comms/comms-app.js'
];

/* ══════════ A 组 · 内核纯度与等价性 ══════════ */
test('A1 内核源码面零副作用、零类、不自己取随机与时钟', () => {
    const src = read(CORE).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    for (const bad of ['Math.random', 'Date.now', 'class ', 'this.', 'localStorage', 'sessionStorage', 'window.', 'document.', 'fetch(', 'import.meta.url']) {
        assert.equal(src.indexOf(bad), -1, '内核不许出现 ' + bad);
    }
});

test('A2 toStr 与原 31 份复制件逐用例等价（22 例 0 diff）', () => {
    /* 原实现逐字：return (typeof v === 'string') ? v : ''; */
    const OLD = (v) => { return (typeof v === 'string') ? v : ''; };
    const cases = [
        null, undefined, '', 'x', ' x ', 0, 1, -1, 3.14, NaN, Infinity,
        true, false, [], {}, { a: 1 }, () => {}, 10n, new String('y'), /re/, Symbol.iterator
    ];
    let diff = 0;
    for (const c of cases) {
        const a = String(OLD(c));
        const b = String(TF.toStr(c));
        if (a !== b) { diff++; console.log('  DIFF', String(c), JSON.stringify(a), JSON.stringify(b)); }
    }
    assert.equal(diff, 0, 'toStr 必须与原复制件逐用例等价');
});

test('A3 toStr 三条立场（类型严格 / 不 trim / 空串不是兜底值）', () => {
    /* ① 类型严格：数字、布尔、对象一律空串，不 String() 化。 */
    assert.equal(TF.toStr(5), '');
    assert.equal(TF.toStr(0), '');
    assert.equal(TF.toStr(true), '');
    assert.equal(TF.toStr({ a: 1 }), '');
    assert.equal(TF.toStr(null), '');
    assert.equal(TF.toStr(undefined), '');
    /* ② 保留原串，**不 trim**（调用侧自己 trim）。 */
    assert.equal(TF.toStr(' x '), ' x ');
    assert.equal(TF.toStr('x'), 'x');
    assert.equal(TF.toStr(''), '');
    /* ③ 非串给空串 —— 空串表示「这里没有字符串」。 */
    assert.equal(TF.toStr([1, 2]), '');
});

test('A4 内核只导出被真消费的面（一个具名出口，且不许有 default 面）', () => {
    const named = Object.keys(TF).filter((k) => k !== 'default');
    assert.deepEqual(named.sort(), ['toStr'], '本版只收敛一条口径，只许一个具名出口');
    /* 刻意不设 export default：default 面若只有测试经 .default 取它，就是「仅测试消费的
     *   default 面」，dead-exports 门的 E11 会报红。本仓纪律是「不许留零消费出口」，
     *   不是「为了一致性补一个装饰出口」。 */
    assert.equal('default' in TF, false, '不许有 default 出口（零消费面）');
    assert.equal(TF.default, undefined, '不许有 default 出口（零消费面）');
    /* 曾建过 numeralTextLoose / countText 一类零消费出口（v4.193.0 教训），本条钉住不许复活。 */
    assert.equal(typeof TF.toStrLoose, 'undefined', '不许造宽松口径副本');
    assert.equal(typeof TF.trimmed, 'undefined', '不许把 trim 并进来');
    assert.equal(typeof TF.strOr, 'undefined', '不许造带兜底值的变体');
});

/* ══════════ B 组 · 源文件转调 ══════════ */
test('B1 12 个 export 形：本地定义已删、import 内核、re-export 在场', () => {
    for (const rel of EQ_EXPORT) {
        const raw = read(rel);
        assert.equal(raw.indexOf('function toStr(v)'), -1, rel + ' 的 toStr 定义必须已删');
        assert.ok(raw.indexOf('text-face.js') >= 0, rel + ' 必须 import 内核');
        assert.ok(raw.indexOf('export { toStr }') >= 0, rel + ' 必须保留 re-export（外部经命名空间 import 消费）');
    }
});

test('B2 19 个私有形：本地定义已删、import 内核、不许再 re-export', () => {
    for (const rel of EQ_PRIV) {
        const raw = read(rel);
        assert.equal(raw.indexOf('function toStr(v)'), -1, rel + ' 的 toStr 定义必须已删');
        assert.ok(raw.indexOf('text-face.js') >= 0, rel + ' 必须 import 内核');
        assert.equal(raw.indexOf('export { toStr }'), -1, rel + ' 本是私有形，不该新增 export 面');
    }
});

/* [v4.200.0] 纯兼容壳：自己不调 toStr，而是转出给下游用。
 *   B3 的原意是「不是删了没人用的死定义」，而「同文件调用点」在壳上是个**错误代理** ——
 *   壳的调用点天然在下游。故对壳改判「下游必须真有调用点」，比原判据更严（多钉一份文件）。
 *   逐个都写清是谁在调，新加壳必须同时给出下游路径。 */
const RE_EXPORT_SHELL = {
    'apps/cardtable/cardtable-data.js': 'apps/cardtable/cardtable-app.js',
};
test('B3 每个转调文件都真有 toStr 调用点（不是删了没人用的死定义）', () => {
    const callpat = /(^|[^A-Za-z0-9_$.])toStr\(/;
    for (const rel of EQ_EXPORT.concat(EQ_PRIV)) {
        if (Object.prototype.hasOwnProperty.call(RE_EXPORT_SHELL, rel)) {
            const consumer = RE_EXPORT_SHELL[rel];
            const cbody = read(consumer).split('\n')
                .filter((l) => l.indexOf('text-face.js') < 0 && l.indexOf('export { toStr }') < 0).join('\n');
            const fromShell = cbody.indexOf('./' + path.basename(rel)) >= 0;
            assert.ok(fromShell, consumer + ' 必须真的从本壳导入（否则下游调用点与壳无关）');
            assert.ok(callpat.test(cbody), consumer + ' 必须真有 toStr 调用点（壳的调用点在下游）');
            continue;
        }
        const raw = read(rel);
        /* 扣掉 import 行与 re-export 行之后再数。 */
        const body = raw.split('\n').filter((l) => l.indexOf('text-face.js') < 0 && l.indexOf('export { toStr }') < 0).join('\n');
        assert.ok(callpat.test(body), rel + ' 必须仍有 toStr 调用点');
    }
});

test('B4 转调文件里 import 语句落在注释块之外（v4.194.0 踩过：插进块注释会被吞）', () => {
    for (const rel of EQ_EXPORT.concat(EQ_PRIV)) {
        const lines = read(rel).split('\n');
        for (let i = 0; i < lines.length; i++) {
            if (lines[i].indexOf('text-face.js') < 0) continue;
            let inblock = false;
            for (let k = 0; k < i; k++) {
                if (lines[k].indexOf('/*') >= 0) inblock = true;
                if (lines[k].indexOf('*/') >= 0) inblock = false;
            }
            assert.equal(inblock, false, rel + ' 的 text-face import 不许落在块注释内');
            break;
        }
    }
});

/* ══════════ C 组 · 全仓不再有第二份同族实现 ══════════ */
test('C1 apps 与 config 下不再有 toStr 本地定义（两处 trim 口径按 C2 排除）', () => {
    /* 判据只钉「与本内核逐字等价的同一口径」：`(typeof v === 'string') ? v : ''`。
     *   affairs / comms 的 `String(v == null ? '' : v).trim()` 是**不同语义**（见 C2），
     *   在此排除 —— 把它们算进来就是「用宽形态冒充等价」。 */
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
            if (NOT_EQUIV.indexOf(rel) >= 0) continue;
            const raw = fs.readFileSync(p, 'utf8');
            if (/(^|\n)\s*(?:export\s+)?function\s+toStr\s*\(/.test(raw)) leftovers.push(rel);
        }
    }
    assert.deepEqual(leftovers, [], 'apps 与 config 下不许再有 toStr 本地定义');
});

test('C2 两处不同口径刻意未动（affairs / comms 的 trim 形不是同一语义）', () => {
    for (const rel of NOT_EQUIV) {
        const raw = read(rel);
        assert.ok(/function\s+toStr\s*\(/.test(raw), rel + ' 的 trim 口径必须原样保留');
        assert.equal(raw.indexOf('text-face.js'), -1, rel + ' 不许被错误收敛');
    }
});

/* ══════════ V 组 · 版本锚 ══════════ */
// [v4.195.0 修正] 刚性版本锚改成下限形（同 v4.193.0 那次）：
//   原来写死 assert.equal(pkg.version, '4.194.0')，于是每往后抬一版，
//   这条就红一次 —— 判据钉的是「本版已交付」这个历史事实，不该随
//   后续抬版漂移。改为「不低于 4.194.0」，用语义化版本逐段比较。
function cmp(a, b) {
    const pa = String(a).split('.').map(Number);
    const pb = String(b).split('.').map(Number);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
        const x = pa[i] || 0, y = pb[i] || 0;
        if (x !== y) return x < y ? -1 : 1;
    }
    return 0;
}

test('V1 五源版本号不低于 4.194.0', () => {
    const pkg = JSON.parse(read('package.json'));
    assert.ok(cmp(pkg.version, '4.194.0') >= 0, 'package.json 必须不低于 4.194.0，当前 ' + pkg.version);
    const man = JSON.parse(read('manifest.json'));
    assert.ok(cmp(man.version, '4.194.0') >= 0, 'manifest.json 必须不低于 4.194.0，当前 ' + man.version);
    const ul = JSON.parse(read('update-log.json'));
    assert.ok(ul.versions['4.194.0'], 'update-log.json 必须有 4.194.0 条目');
    assert.ok(cmp(ul.latest, '4.194.0') >= 0, 'update-log.json latest 必须不低于 4.194.0');
    const idx = read('index.js');
    const mVer = idx.match(/ST_PHONE_VERSION\s*=\s*'([^']+)'/);
    assert.ok(mVer, 'index.js 必须能取到 ST_PHONE_VERSION 常量');
    assert.ok(cmp(mVer[1], '4.194.0') >= 0, 'index.js 的 ST_PHONE_VERSION 必须不低于 4.194.0，当前 ' + mVer[1]);
    const iter = read('ITERATION_LOG.md');
    assert.ok(iter.indexOf('4.194.0') >= 0, 'ITERATION_LOG.md 必须出现 4.194.0');
});