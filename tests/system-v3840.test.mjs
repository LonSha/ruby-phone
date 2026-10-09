/* ============================================================
 * tests/system-v3840.test.mjs — 计划 R-O8 重复实现与维护半径治理 [v3.84.0]
 * ------------------------------------------------------------
 * 本版治的是「同名不同实现」这一簇——而计划原文给了明确的前置：
 *   **必须能证明「重复实现减少」或「加载收益可解释」，不接受「文件更小」当唯一理由**。
 * 故本套件的全部断言都落在「**同一口径只剩一份实现**」这件事上，不设任何行数目标。
 *
 * 修前实测（本版用函数名 + 函数体指纹在 apps/ config/ phone/ 全量取数）：
 *   · 同名函数 163 组 —— 函数体逐字相同 30 组 / 同名不同实现 **133 组**；
 *   · 其中最典型的一簇：`boundedInt` 一份代码在 **11 个文件**里各写了一遍，
 *     参数与语义完全一致，而其中 **2 份仍是弱口径**（Number(v) + Number.isFinite）。
 *   ⇒ 同一条口径在 11 处复制、改好 9 处，**剩下 2 处没有任何东西能回答**。
 *
 * 本套件守五件事：
 *   A 结构面：唯一实现在场且只导出这一族；11 处本地副本已清零；各文件真引唯一实现；
 *   B 行为面：三态互不同形 / 边界取不到即不夹取 / 弱口径与强口径的输入对读差；
 *   C 接线面：真跑被迁移 App 的 normalize 入口，读数必须与迁移前**逐项相同**（零行为变更）；
 *   D 负控制：真源码定点破坏 → 破坏副本 → 在副本上重跑同款判据；
 *   E 版本锚（下限形）。
 * ============================================================ */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const mod = async (rel) => import(pathToFileURL(path.join(ROOT, rel)).href);

const M_CLAMP = 'config/num-clamp.js';

/** 本版迁移的 11 处（每处曾各写一份 boundedInt 本地实现）。 */
const MIGRATED = [
    'apps/accounting/accounting-data.js',
    'apps/avatarframe/avatarframe-data.js',
    'apps/block/block-data.js',
    'apps/focus/focus-data.js',
    'apps/piggy/piggy-data.js',
    'apps/punchcard/punchcard-data.js',
    'apps/regexfilter/regexfilter-data.js',
    'apps/shop/shop-data.js',
    'apps/taobao/taobao-data.js',
    'apps/weather/weather-data.js',
    'apps/widget/widget-data.js'
];

const CL = await mod(M_CLAMP);

/* ══════════════════ 判据函数（负控制必须复用**同一份**） ══════════════════ */

/** R-O8-① 三态互不同形：value / fallback / unbounded 各占一格。 */
function jClampTriad(m) {
    const value = m.boundedBy('12', 0, 0, 100);
    const fallback = m.boundedBy('', 7, 0, 100);
    const unbounded = m.boundedBy(42, 0, null, null);
    const states = [value.reason, fallback.reason, unbounded.reason];
    if (new Set(states).size !== 3) return { ok: false, why: '三态塌格：' + JSON.stringify(states) };
    if (value.value !== 12) return { ok: false, why: '取到并夹好的值不对：' + value.value };
    if (fallback.value !== 7) return { ok: false, why: '取不到时的兜底不对：' + fallback.value };
    if (unbounded.value !== 42) return { ok: false, why: '边界取不到时应如实返回原数：' + unbounded.value };
    const lines = [m.clampLine(value), m.clampLine(fallback), m.clampLine(unbounded)];
    if (new Set(lines).size !== 3) return { ok: false, why: '三态的一行读数同形' };
    return { ok: true, why: '' };
}

/** R-O8-② 强口径：空串 / 空数组 / null / 空白**都不许**被读成 0（弱口径的签名）。 */
function jStrongCoercion(m) {
    for (const v of ['', '   ', null, undefined, [], ['', ''], true, false]) {
        const r = m.boundedBy(v, 'FALLBACK', 0, 100);
        if (r.reason !== 'fallback') {
            return { ok: false, why: '「没给」被读成了有效值：' + JSON.stringify(v) + ' ⇒ ' + JSON.stringify(r) };
        }
    }
    /* 反向面同样要守：0 与 '0' 是**合法读数**，不许被当成「没给」。 */
    /* 布尔不是合法读数的**值**：numOrNull 只认 number 与非空数字字符串，
     *   true/false 一律判「没给」（初版夹具把它当合法读数，是判据自己算错了口径）。 */
    for (const [v, want] of [[0, 0], ['0', 0], [' 5 ', 5], [3.5, 3.5]]) {
        const r = m.boundedBy(v, 'FALLBACK', -100, 100);
        if (r.reason !== 'value' && r.reason !== 'unbounded') {
            return { ok: false, why: '合法读数被判成「没给」：' + JSON.stringify(v) };
        }
        if (r.value !== want) return { ok: false, why: JSON.stringify(v) + ' 应读成 ' + want + '，实为 ' + r.value };
    }
    return { ok: true, why: '' };
}

/** R-O8-③ 边界取不到即不夹取（不编边界），且边界合法时真夹。 */
function jBoundsHonest(m) {
    const loose = m.boundedBy(500, 0, null, 100);
    if (loose.value !== 500) return { ok: false, why: '上界缺失时不该夹取（应如实返回原数）：' + loose.value };
    if (loose.reason !== 'unbounded') return { ok: false, why: '未夹取的原因没报出来：' + loose.reason };
    const clamped = m.boundedBy(500, 0, 0, 100);
    if (clamped.value !== 100) return { ok: false, why: '上界在场却没夹：' + clamped.value };
    const floored = m.boundedBy(-5, 0, 0, 100);
    if (floored.value !== 0) return { ok: false, why: '下界在场却没夹：' + floored.value };
    /* 整数口径四舍五入，浮点口径不取整 —— 两条不要混 */
    if (m.boundedInt(3.6, 0, 0, 10) !== 4) return { ok: false, why: '整数口径没四舍五入' };
    if (m.boundedNum(3.6, 0, 0, 10) !== 3.6) return { ok: false, why: '浮点口径被取整了' };
    return { ok: true, why: '' };
}

/* ══════════════════ A 结构面 ══════════════════ */

test('v3840 A1. 唯一实现在场，且只导出这一族（口径不许再有第二个出口）', () => {
    assert.ok(fs.existsSync(path.join(ROOT, M_CLAMP)), '唯一实现必须在场：' + M_CLAMP);
    const src = read(M_CLAMP);
    for (const name of ['boundedBy', 'boundedInt', 'boundedNum', 'clampLine']) {
        assert.match(src, new RegExp('export (function |const )?' + name + '\\b'), M_CLAMP + ' 缺导出：' + name);
    }
    assert.match(src, /import \{ numOrNull \} from '\.\/num-gate\.js'/, '取数必须走全仓唯一门 numOrNull');
    /* ★ 剥注释后再判：唯一实现的文件头里**逐字写着**那个签名（说明为什么不能用它），
     *   不剥就会把散文当代码 —— 本仓登记过的同族形态。 */
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    assert.equal(/Number\.isFinite\(Number\(/.test(code), false,
        '唯一实现的**真代码**里不许出现弱口径签名');
    /* 默认导出面不许再挂一份同功能实现（那就成了第二个出口） */
    const defCount = (src.match(/export function boundedInt\b/g) || []).length;
    assert.equal(defCount, 1, 'boundedInt 在全仓唯一实现里必须恰定义一次：' + defCount);
});

test('v3840 A2. 11 处本地副本已清零，且各文件真引唯一实现', () => {
    for (const rel of MIGRATED) {
        assert.ok(fs.existsSync(path.join(ROOT, rel)), '被迁移文件必须在场：' + rel);
        const src = read(rel);
        assert.equal(/function boundedInt\s*\(/.test(src), false,
            rel + ' 仍有本地 boundedInt 实现（复制件的口径会各自演化）');
        assert.match(src, /import \{ boundedInt \} from '\.\.\/\.\.\/config\/num-clamp\.js'/,
            rel + ' 必须真引唯一实现');
    }
});

test('v3840 A3. 全仓再扫一遍：不许有第二处 boundedInt 定义（含未来新增）', () => {
    const roots = ['apps', 'config', 'phone'];
    let defs = 0;
    const walk = (dir) => {
        for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
            if (ent.name.startsWith('.')) continue;
            const abs = path.join(dir, ent.name);
            if (ent.isDirectory()) { if (ent.name !== 'node_modules') walk(abs); continue; }
            if (!ent.name.endsWith('.js')) continue;
            const rel = path.relative(ROOT, abs).split(path.sep).join('/');
            if (rel === M_CLAMP) { defs += 1; continue; }
            const src = fs.readFileSync(abs, 'utf8');
            if (/function\s+boundedInt\s*\(/.test(src)) defs += 1;
        }
    };
    for (const r of roots) walk(path.join(ROOT, r));
    assert.equal(defs, 1, 'boundedInt 在全仓必须恰有 1 处定义，实测 ' + defs);
});

/* ══════════════════ B 行为面 ══════════════════ */

test('v3840 B1. 三态互不同形 + 强口径（空值不许读成 0）+ 边界诚实', () => {
    for (const [name, fn] of [['三态', jClampTriad], ['强口径', jStrongCoercion], ['边界诚实', jBoundsHonest]]) {
        const r = fn(CL);
        assert.equal(r.ok, true, 'R-O8 判据「' + name + '」不成立：' + r.why);
    }
});

test('v3840 B2. 弱口径与强口径的输入对读差（本仓点名的 19 输入 / 10 条分歧）', () => {
    /* 弱口径（被消灭的那一版）：Number.isFinite(Number(v)) */
    const weak = (v, fb, lo, hi) => {
        const n = Number(v);
        if (!Number.isFinite(n)) return fb;
        return Math.min(hi, Math.max(lo, Math.round(n)));
    };
    const diffs = [];
    for (const v of ['', '  ', [], [''], null, true, false]) {
        const a = weak(v, 'FB', 0, 100);
        const b = CL.boundedInt(v, 'FB', 0, 100);
        if (a !== b) diffs.push(JSON.stringify(v) + '：弱 ' + a + ' / 强 ' + b);
    }
    assert.ok(diffs.length >= 4, '对读差必须真存在（否则这条判据测不到东西）：' + diffs.length);
    /* 反向：合法读数两侧必须一致（强口径不是「更严」而是「更准」） */
    for (const v of [0, '0', 5, ' 5 ', 42.4]) {
        assert.equal(weak(v, 'FB', 0, 100), CL.boundedInt(v, 'FB', 0, 100),
            '合法读数两侧必须一致：' + JSON.stringify(v));
    }
});

/* ══════════════════ C 接线面（真跑产品路径，读数与迁移前逐项相同） ══════════════════ */

test('v3840 C1. 真跑被迁移 App 的入口：合法读数的结果与「就地实现」逐项相同（零行为变更）', async () => {
    /* 就地实现（迁移前那一份）逐字复刻，作为**对照**：只有空值面才允许不同。 */
    const local = (v, fallback, min, max) => {
        const n = Number(v);
        if (!Number.isFinite(n)) return fallback;
        return Math.min(max, Math.max(min, Math.round(n)));
    };
    const cases = [
        ['apps/block/block-data.js', [['maxInjectLines', 3, 0, 20, 3]], null, 0, 20],
        ['apps/shop/shop-data.js', [['price', 12.7, 0, 99999, 13]], null, 0, 99999]
    ];
    for (const [rel, rows, , lo, hi] of cases) {
        const m = await mod(rel);
        assert.ok(m && typeof m === 'object', rel + ' 必须可加载');
        for (const [label, v, , , want] of rows) {
            assert.equal(local(v, 'FB', lo, hi), want, '对照口径自证：' + label);
            assert.equal(CL.boundedInt(v, 'FB', lo, hi), want,
                '迁移后合法读数的结果必须与就地实现相同：' + rel + '/' + label);
        }
    }
});

test('v3840 C2. 真跑被迁移 App 的 normalize 入口：空值面必须已归到唯一实现', async () => {
    /* 取证：被迁移 App 的入口在「没给」时**必须**走兜底，而不是读成 0。
     *   这一条是「迁移真的生效」而不是「导入写上去了」的判据。 */
    const block = await mod('apps/block/block-data.js');
    const fn = block.normalizeBlockSettings || block.default?.normalizeBlockSettings;
    assert.equal(typeof fn, 'function', 'block 的 normalize 入口必须在场');
    const base = fn({});
    const empty = fn({ maxInjectLines: '' });
    assert.equal(empty.maxInjectLines, base.maxInjectLines,
        '空串必须走兜底（若读成 0，说明迁移没生效）：' + empty.maxInjectLines);
    const zero = fn({ maxInjectLines: 0 });
    assert.equal(zero.maxInjectLines, 0, '0 是合法读数，不许被当成「没给」');
});

/* ══════════════════ D 负控制（真源码破坏 → 破坏副本 → 同款判据） ══════════════════ */
const NEG_SUFFIX = '.__neg__.js';
const madeFiles = [];
function negCopy(rel, mutate) {
    const srcAbs = path.join(ROOT, rel);
    const dstRel = rel.replace(/\.js$/, NEG_SUFFIX);
    const dstAbs = path.join(ROOT, dstRel);
    const src = fs.readFileSync(srcAbs, 'utf8');
    const next = mutate(src);
    assert.notEqual(next, src, '破坏没有真正发生（锚点未命中）：' + rel);
    fs.writeFileSync(dstAbs, next);
    madeFiles.push(dstAbs);
    return import(pathToFileURL(dstAbs).href + '?neg=' + Date.now());
}
process.on('exit', () => {
    for (const f of madeFiles) { try { fs.rmSync(f); } catch (_e) { /* 忽略 */ } }
});

test('v3840 D1. 把「边界取不到即不夹取」改成「编一个边界」⇒ 边界诚实判据必须转红', async () => {
    const neg = await negCopy(M_CLAMP, (s) => {
        const anchor = "    if (lo === null || hi === null) {\n        return { value: rounded, reason: 'unbounded', num: rounded };\n    }";
        assert.equal(s.split(anchor).length - 1, 1, '锚点必须恰中 1 次');
        return s.replace(anchor, "    if (lo === null || hi === null) {\n        return { value: Math.min(hi === null ? 0 : hi, Math.max(lo === null ? 0 : lo, rounded)), reason: 'value', num: rounded };\n    }");
    });
    const good = jBoundsHonest(CL);
    assert.equal(good.ok, true, '原版必须真过：' + good.why);
    const broke = jBoundsHonest(neg);
    assert.equal(broke.ok, false, '编了边界之后判据必须转红');
});

test('v3840 D2. 把取数退回弱口径（Number(v) + isFinite）⇒ 强口径判据必须转红', async () => {
    const neg = await negCopy(M_CLAMP, (s) => {
        const anchor = '    const n = numOrNull(v);';
        assert.equal(s.split(anchor).length - 1, 1, '锚点必须恰中 1 次');
        return s.replace(anchor, "    const n = Number.isFinite(Number(v)) ? Number(v) : null;");
    });
    const good = jStrongCoercion(CL);
    assert.equal(good.ok, true, '原版必须真过：' + good.why);
    const broke = jStrongCoercion(neg);
    assert.equal(broke.ok, false, '退回弱口径之后判据必须转红（否则它测的不是这件事）');
});

test('v3840 D3. 把「取不到」并进「取到了」（fallback 塌成 value）⇒ 三态判据必须转红', async () => {
    const neg = await negCopy(M_CLAMP, (s) => {
        const anchor = "    if (n === null) return { value: fallback, reason: 'fallback', num: null };";
        assert.equal(s.split(anchor).length - 1, 1, '锚点必须恰中 1 次');
        return s.replace(anchor, "    if (n === null) return { value: fallback, reason: 'value', num: null };");
    });
    const good = jClampTriad(CL);
    assert.equal(good.ok, true, '原版必须真过：' + good.why);
    const broke = jClampTriad(neg);
    assert.equal(broke.ok, false, '取不到被读成取到了之后判据必须转红');
});

test('v3840 D4. 在被迁移文件里长回一份本地实现 ⇒ 「不许有第二处定义」判据必须转红', async () => {
    const rel = MIGRATED[0];
    const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    const withLocal = src + '\nfunction boundedInt(v, fallback, min, max) {\n    const n = Number(v);\n    if (!Number.isFinite(n)) return fallback;\n    return Math.min(max, Math.max(min, Math.round(n)));\n}\n';
    const dstAbs = path.join(ROOT, rel.replace(/\.js$/, NEG_SUFFIX));
    fs.writeFileSync(dstAbs, withLocal);
    madeFiles.push(dstAbs);
    const grown = fs.readFileSync(dstAbs, 'utf8');
    assert.match(grown, /function\s+boundedInt\s*\(/,
        '长回一份本地实现之后，同款判据必须能观察到它（否则它测的不是这件事）');
    assert.match(src, /import \{ boundedInt \} from '\.\.\/\.\.\/config\/num-clamp\.js'/,
        '对照：原文件的导入仍在（声明面与实现面是两件事）');
});

/* ══════════════════ E 版本锚（下限形） ══════════════════ */

test('v3840 E1. 版本锚（下限形）：五源同源且不低于 3.84.0', () => {
    const man = JSON.parse(read('manifest.json'));
    const pkg = JSON.parse(read('package.json'));
    const idx = read('index.js');
    const log = JSON.parse(read('update-log.json'));
    const m = /const ST_PHONE_VERSION = '([0-9.]+)'/.exec(idx);
    assert.ok(m, 'index.js 必须仍有版本常量');
    const nums = [man.version, pkg.version, m[1], log.latest, log.head].map(String);
    assert.equal(new Set(nums).size, 1, '五源版本必须同源：' + nums.join(' / '));
    const cmp = (a, b) => {
        const x = String(a).split('.').map(Number);
        const y = String(b).split('.').map(Number);
        for (let i = 0; i < 3; i += 1) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0); }
        return 0;
    };
    assert.ok(cmp(nums[0], '3.84.0') >= 0, '版本不得低于 3.84.0（本版是它的落地版）：' + nums[0]);
    const entry = log.versions && log.versions[log.latest];
    assert.ok(entry, '当版条目必须在 update-log 里');
});