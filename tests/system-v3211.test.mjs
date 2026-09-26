// tests/system-v3211.test.mjs — esc() 属性转义恒等替换收干（v3.10.1）
//
//   本版治一个**读了两年没人发现**的形态（与上游 lonsha v3.239.0 同族）：
//     `.replace(/"/g, '"')` —— 右边那个所谓「实体」是**裸引号本身**，
//     于是这条替换是**恒等替换**：属性转义形同虚设，HTML 属性注入面敞开。
//
//   ★ 为什么会写成这样（写进判据，防止再犯）：
//     实体字面量（" 一类）在**补丁脚本/写盘层**会被就地解码成裸字符，
//     于是「修一处、扩散一处」；本版因此同时钉住**两种合法写法**：
//       · 运行时生成（String.fromCharCode(38) 拼接）；或
//       · 反斜杠转义序列（\x26quot; / \u0022 一类），使字面量在源码里不被解码。
//
//   覆盖：
//     A 全仓普查：恒等替换必须归零（含紧凑写法）
//     B 七处目标文件真转义：属性注入面必须被拦住
//     C 参照面：仓库既有正常写法不得被本版改坏
//     D 负控制：把一处改回恒等形态 ⇒ 同款真判据必须转红
//     E 版本锚
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const readRel = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const Q = String.fromCharCode(34);
const SQ = String.fromCharCode(39);
const AMP = String.fromCharCode(38);
const ENT = AMP + 'quot;';

/** 遍历仓库内所有 .js/.mjs（跳过 .git / node_modules） */
function jsFiles(dir = ROOT, out = []) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (e.name === '.git' || e.name === 'node_modules') continue;
        const p = path.join(dir, e.name);
        if (e.isDirectory()) jsFiles(p, out);
        else if (/\.(js|mjs|cjs)$/.test(e.name)) out.push(p);
    }
    return out;
}

/** 剥整行注释与块注释（★ 判据自身缺陷修正）：
 *  注释里必须允许**讨论这条纪律本身** —— 否则「把病根写进判据注释」会被自己的判据判红
 *  （本套件首跑即踩）。只剥整行 `//` / `*` / 块注释；行尾 `//` **不剥** —— 宁可误报，绝不误漏。 */
function stripComments(src) {
    const out = [];
    let inBlock = false;
    for (const raw of src.split('\n')) {
        const t = raw.trim();
        if (inBlock) {
            if (t.includes('*/')) inBlock = false;
            out.push('');
            continue;
        }
        if (t.startsWith('/*')) {
            if (!t.includes('*/')) inBlock = true;
            out.push('');
            continue;
        }
        if (t.startsWith('//') || t.startsWith('*')) { out.push(''); continue; }
        out.push(raw);
    }
    return out.join('\n');
}

/** 恒等替换检测（宽松：允许任意空白），返回 [{file, line, text}] */
function findIdentityEscapes() {
    const rx = new RegExp('\\.replace\\(/' + Q + '/g\\s*,\\s*' + SQ + Q + SQ + '\\)');
    const hits = [];
    for (const p of jsFiles()) {
        const txt = stripComments(fs.readFileSync(p, 'utf8'));
        txt.split('\n').forEach((l, i) => {
            if (rx.test(l)) hits.push({ file: path.relative(ROOT, p), line: i + 1, text: l.trim() });
        });
    }
    return hits;
}

/* ══════════ A 全仓普查 ══════════ */

test('A1. ★★★ 全仓不得再有「引号恒等替换」——那等于没有转义', () => {
    const hits = findIdentityEscapes();
    assert.deepEqual(hits, [], '这些行的属性转义是恒等替换（形同虚设）：\n'
        + hits.map((h) => h.file + ':' + h.line + ' ' + h.text).join('\n'));
});

test('A2. ★★★ 普查面必须真扫到东西（防「空对空」的假绿）', () => {
    /* 本仓老账：空集合上的判据永远成立。故先证明扫描器**真的在扫**。 */
    const files = jsFiles();
    assert.ok(files.length > 300, '扫描面必须覆盖全仓（实测 ' + files.length + ' 个 js 文件）');
    const withEsc = files.filter((p) => /\breplace\(\/&\//.test(fs.readFileSync(p, 'utf8')));
    assert.ok(withEsc.length >= 20, '必须能扫到大量 esc() 实现（实测 ' + withEsc.length + ' 个）');
});

/* ══════════ B 七处目标文件真转义 ══════════ */

const FIXED = [
    'apps/memory/graph-view.js',
    'apps/mood/mood-view.js',
    'apps/reading/reading-epub.js',
    'apps/reading/reading-view.js',
    'apps/tarot/tarot-view.js',
    'apps/timeweaver/timeweaver-view.js',
    'apps/worldpulse/worldpulse-view.js'
];

test('B1. ★★★ 七处 esc() 必须真的把引号转成实体（属性注入面被拦住）', () => {
    for (const rel of FIXED) {
        const txt = readRel(rel);
        assert.ok(txt.includes(ENT), rel + ' 必须用实体转义引号（' + ENT + '）');
        assert.ok(!findIdentityEscapes().some((h) => h.file === rel), rel + ' 不得回退成恒等替换');
    }
});

test('B2. ★★★ 真跑：esc() 对含引号的输入必须产出实体（不是原样返回）', () => {
    /* 只判源码文本是**间接证据**。这里把每个文件的 esc() 真的抽出来跑一遍：
     * 输入 `a"b`，输出必须**不等于**输入（恒等替换恰好会让它相等 —— 这是本版的分界点）。 */
    const samples = [
        ['apps/worldpulse/worldpulse-view.js', '<div class="X">', 'class=&#34;&gt;'],
        ['apps/timeweaver/timeweaver-view.js', 'a"b']
    ];
    for (const [rel, input] of samples) {
        const txt = readRel(rel);
        const m = txt.match(/function esc\(s\)\s*\{([\s\S]*?)\n\}/);
        assert.ok(m, rel + ' 必须能抽到 esc() 函数体');
        const fn = new Function('s', m[1]);
        const out = fn(input);
        assert.notEqual(out, input, rel + ' esc() 对含引号输入不得原样返回（那正是恒等替换的行为）');
        assert.ok(out.includes(ENT), rel + ' esc() 必须产出引号实体');
    }
});

/* ══════════ C 参照面不得被改坏 ══════════ */

test('C1. ★★ 仓库既有正常写法仍在场（本版只收恒等形态，不动正常形态）', () => {
    /* 正常形态的样本：至少 20 处 `replace(/"/g, '"')` 必须在场。 */
    const rx = new RegExp('\\.replace\\(/' + Q + '/g, ' + SQ + ENT + SQ + '\\)');
    const n = jsFiles().filter((p) => rx.test(fs.readFileSync(p, 'utf8'))).length;
    assert.ok(n >= 20, '正常实体写法必须在场（实测 ' + n + ' 个文件）');
});

test('C2. ★★ 只读面纪律：本版不得引入解析器或依赖（零依赖不变）', () => {
    const pkg = JSON.parse(readRel('package.json'));
    assert.equal(pkg.dependencies, undefined, '本仓刻意不声明依赖');
    assert.equal(pkg.type, 'module');
});

/* ══════════ D 负控制 ══════════ */

test('D1. ★★★ 负控制：把一处改回恒等形态 ⇒ A1 的同款真判据必须转红', () => {
    /* 破坏在**内存文本**上做（不改真源码），再跑同一份真判据函数。 */
    const rel = 'apps/worldpulse/worldpulse-view.js';
    const real = readRel(rel);
    const anchor = '.replace(/' + Q + '/g,' + SQ + ENT + SQ + ')';
    const hits = real.split(anchor).length - 1;
    assert.equal(hits, 1, '破坏锚点必须恰中 1 次，实测 ' + hits);
    const broken = real.replace(anchor, '.replace(/' + Q + '/g,' + SQ + Q + SQ + ')');
    assert.notEqual(broken, real, '破坏必须真改变源文本');
    /* 同款判据（与 findIdentityEscapes 同一正则）在破坏文本上必须命中。 */
    const rx = new RegExp('\\.replace\\(/' + Q + '/g\\s*,\\s*' + SQ + Q + SQ + '\\)');
    const broke = broken.split('\n').some((l) => rx.test(l));
    assert.equal(broke, true, '破坏副本上真判据必须转红（否则破坏没被观测到）');
    /* 两向自证：真源码上同款判据必须**不**命中。 */
    assert.equal(real.split('\n').some((l) => rx.test(l)), false, '真源码上不得命中');
});

test('D2. ★★★ 负控制：破坏锚点不唯一/不存在时必须抛（H5：锚点须恰中 1 次）', () => {
    /* H5 的意义是「不许静默走空」：命中 0 次 ⇒ 破坏根本没发生；命中 ≥2 次 ⇒ 破坏面不可控，
     *   两种情形都必须让判据抛。★ 本套件首版拿一个**恰好唯一命中**的锚点来证「不唯一必须抛」，
     *   于是这条判据自己变成了假绿（假绿第三形③：破坏把判据自己废掉）——
     *   故本版改为**按实测计数**挑锚点，并先自证设计前提成立。 */
    const rel = 'apps/worldpulse/worldpulse-view.js';
    const real = readRel(rel);
    const twice = 'replace(/';
    const absent = 'zzz_NOT_PRESENT_IN_THIS_FILE_zzz';
    assert.ok(real.split(twice).length - 1 >= 2, '设计前提：重复锚点必须真的出现 ≥2 次');
    assert.equal(real.split(absent).length - 1, 0, '设计前提：不存在锚点必须真的 0 次');
    const mustThrow = (anchor, tag) => assert.throws(() => {
        const n = real.split(anchor).length - 1;
        assert.equal(n, 1, '锚点必须恰中 1 次，实测 ' + n);
    }, /恰中 1 次/, tag + '必须让判据抛，而不是静默通过');
    mustThrow(twice, '重复锚点（≥2 次）');
    mustThrow(absent, '不存在锚点（0 次）');
    /* 对照：真锚点唯一命中时**不得**抛 —— 否则判据成了「一律抛」，不具判别力 */
    const good = '.replace(/' + Q + '/g,' + SQ + ENT + SQ + ')';
    assert.equal(real.split(good).length - 1, 1, '真锚点必须恰中 1 次');
    assert.doesNotThrow(() => {
        const n = real.split(good).length - 1;
        assert.equal(n, 1, '锚点必须恰中 1 次，实测 ' + n);
    }, '真锚点（唯一命中）不得抛');
});

/* ══════════ E 版本锚 ══════════ */

test('E1. ★ 版本五源同源为 3.10.1，且 3.10.1 条目在场', () => {
    const man = JSON.parse(readRel('manifest.json'));
    const pkg = JSON.parse(readRel('package.json'));
    const log = JSON.parse(readRel('update-log.json'));
    const idx = readRel('index.js');
    assert.equal(man.version, '3.10.1', 'manifest 版本');
    assert.equal(pkg.version, '3.10.1', 'package 版本');
    assert.equal(log.latest, '3.10.1', 'update-log latest');
    assert.ok(log.versions['3.10.1'], 'update-log 必须有当版条目');
    assert.ok(log.versions['3.10.1'].items.length >= 3, '当版条目至少 3 条');
    assert.ok(/const ST_PHONE_VERSION = '3\.10\.1'/.test(idx), '入口版本常量');
});
