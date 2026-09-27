// tests/system-v3130.test.mjs — 启动耗时可观测面（计划 #14）[v3.13.0]
//
//   主题：**「测不出」与「很快」不许同形**。
//   计划 #14 的原文是「启动速度优化：追加启动耗时分析工具，识别哪个模块拖慢了启动」。
//   取证到的真实处境（本套件用判据把它钉住，不靠文字主张）：
//     · 启动期只有两句 console.log 总数（核心合计 / UI 合计）—— 读得出「慢不慢」，读不出「谁慢」；
//     · index.js 里 78 处动态 import 零时计；
//     · 没有任何面向用户的可见面（「分析工具」这一半根本不存在）。
//   本版落成三件：真源 `config/boot-timing.js`（读数层）+ index.js 全量接线 + 诊断中心可见面。
//
//   边界写死：**本版是读数层，不是优化**（一条加载路径都不改）。判据同样据此立：
//   任何「改顺序 / 改并发 / 改 spec」都会让 B1 的「旁听包住全部 import 且 spec 逐字不变」转红。
//
//   覆盖：
//     A 口径本体（无钟 / 坏钟 / 幂等收尾 / 转发错误）
//     B 真源码接线（78 处全量旁听 / 两段在场 / 唯一出口 / 零依赖 / 读出口命名）
//     C 可见面（真读宿主实例 / 逐字转发 / 排序口径 / 视图建卡与纪律文案）
//     D 真源码破坏负控制（破坏落真文件 → 副本上重跑**同款真判据**必须转红）
//     E 版本锚（五源同源，下限形）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const readRel = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const SRC_REL = 'config/boot-timing.js';
const BT = await import('../config/boot-timing.js');
const DD = await import('../apps/diagnose/diagnose-data.js');

/** 去注释（判据面不得被散文侵入 —— 本仓 v3.12.0 刚立的老账：
 *  真源文件头逐字引着 `bt.collect()` / `import('./x.js')` 之类写法做说明，
 *  扫全文就会把**说明**当成**实现**。凡「看结构」的判据一律先剥注释。） */
function stripComments(src) {
    return src
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n').map((line) => line.replace(/(^|[^:])\/\/.*$/, '$1')).join('\n');
}

/** 剥成「真代码」（注释 + 字符串字面量一并剥掉；等长空格替换，行号列号不变）。
 *  为什么不能用 stripComments 就够：`stripComments` 只剥注释，而**字符串里**同样能
 *  逐字写出代码（本版当场兑现 —— index.js 的内置公告是字符串数组，面向用户的更新
 *  说明里带着 `import(<spec>)`）。只剥注释 ⇒ 把散文读成真代码。
 *  实现必须一遍过（不能先剥注释再剥字符串）：注释里的**孤立引号**会让后一步把整段
 *  真代码当成字符串吞掉 —— 那正是「判据面被散文侵入」的另一种长相。
 *  fail-closed：模板串（`）里的 `${}` 段**可能含真代码**，若其正文出现 `import(`
 *  就登记 suspect，由调用方拒判 —— 宁可拒判，不可静默放宽。 */
function stripNonCode(src) {
    const out = src.split('');
    const n = src.length;
    const blank = (a, b) => { for (let k = Math.max(0, a); k < Math.min(n, b); k += 1) { if (out[k] !== '\n') out[k] = ' '; } };
    const suspects = [];
    /* `/` 是「除号」还是「正则起始」——按前一有意义字符判（标准启发式）。
     * 这一条**必须有**：不认正则 ⇒ 正则内部的引号（如 /["']/）会被当成字符串起始，
     * 把后面几千字符真代码一起吞掉（本版实测误吞 4 处真 import(，total 78 → 74）。 */
    const REGEX_ALLOW_BEFORE = '(,=:[!&|?{};+-*%^~<>';
    const KEYWORD_BEFORE_REGEX = /(?:^|[^\w$])(?:return|typeof|instanceof|in|of|new|delete|void|case|do|else|yield|await)$/;
    let prev = '';
    let seen = '';
    let i = 0;
    while (i < n) {
        const c = src[i];
        if (c === '/' && src[i + 1] === '/') { const s = i; while (i < n && src[i] !== '\n') i += 1; blank(s, i); continue; }
        if (c === '/' && src[i + 1] === '*') {
            const s = i; i += 2;
            while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i += 1;
            i = Math.min(n, i + 2); blank(s, i); prev = ')'; continue;
        }
        if (c === '"' || c === "'") {
            const s = i; i += 1;
            while (i < n) { if (src[i] === '\\') { i += 2; continue; } if (src[i] === c) { i += 1; break; } i += 1; }
            blank(s, i); prev = ')'; seen = (seen + 'x').slice(-40); continue;
        }
        if (c === '`') {
            const s = i; i += 1;
            while (i < n) { if (src[i] === '\\') { i += 2; continue; } if (src[i] === '`') { i += 1; break; } i += 1; }
            const body = src.slice(s, i);
            if (/\bimport\s*\(/.test(body)) suspects.push(body.slice(0, 80));
            blank(s, i); prev = ')'; seen = (seen + 'x').slice(-40); continue;
        }
        if (c === '/') {
            const allow = prev === '' || REGEX_ALLOW_BEFORE.indexOf(prev) >= 0 || KEYWORD_BEFORE_REGEX.test(seen);
            if (allow) {
                const s = i; i += 1; let inClass = false; let closed = false;
                while (i < n) {
                    const ch = src[i];
                    if (ch === '\\') { i += 2; continue; }
                    if (ch === '[') inClass = true;
                    else if (ch === ']') inClass = false;
                    else if (ch === '/' && !inClass) { i += 1; closed = true; break; }
                    else if (ch === '\n') break;
                    i += 1;
                }
                if (closed) { blank(s, i); prev = ')'; seen = (seen + 'x').slice(-40); continue; }
                i = s;      /* 未闭合 ⇒ 不是正则，按普通字符往下走 */
            }
        }
        if (!/\s/.test(c)) { prev = c; seen = (seen + c).slice(-40); }
        i += 1;
    }
    return { code: out.join(''), suspects };
}

/* ══════════════════════════════════════════════════════════════════
 * 真判据（可复用函数）—— D 组的负控制必须在**破坏副本**上重跑同一份函数，
 * 而不是另写一套「看起来像」的断言（那正是假绿的三种形态之一）。
 * ══════════════════════════════════════════════════════════════════ */

/** 判据 1：无钟/坏钟下，耗时一律如实 null（绝不编 0，且整份读数不塌）。 */
function judgeNoFabricatedZero(mod) {
    const absent = mod.createBootTiming({ now: null });
    assert.equal(absent.collect().clock, 'absent', '显式无钟必须判 absent');
    const end = absent.begin('core-modules');
    end();
    absent.mark('boot:core-requested');
    const f = absent.collect();
    const bad = [];
    if (f.clock !== 'absent') bad.push('clock=' + f.clock);
    if (f.totalMs !== null) bad.push('totalMs=' + JSON.stringify(f.totalMs) + '（应为 null，不得编 0）');
    if (f.measured !== 0) bad.push('measured=' + f.measured);
    if (f.segments.some((s) => s.ms !== null)) bad.push('有段 ms 不是 null');
    if (f.segments.some((s) => s.state !== 'unmeasurable')) bad.push('有段 state 不是 unmeasurable');
    if (f.spans !== 2) bad.push('spans=' + f.spans + '（段数与顺序仍必须如实记下来）');
    /* 坏钟三态：抛错 / NaN / Infinity 与「无钟」同待遇（都不是 0） */
    const thrown = mod.createBootTiming({ now: () => { throw new Error('no clock'); } }).collect();
    if (thrown.clock !== 'ok' || thrown.totalMs !== null) bad.push('坏钟（抛错）未按「读不到」处理：' + JSON.stringify(thrown.totalMs));
    const nanMod = mod.createBootTiming({ now: () => NaN });
    nanMod.span('y', Number.POSITIVE_INFINITY);
    const nanFace = nanMod.collect();
    if (nanFace.segments[0].ms !== null || nanFace.segments[0].state !== 'unmeasurable') bad.push('Infinity 被当成了数');
    return { ok: bad.length === 0, why: bad.join(' / ') };
}

/** 判据 2：instrumentImport 必须原样转发（吞错会把加载失败变成静默）。 */
async function judgeForwardsImport(mod) {
    const bt = mod.createBootTiming({ now: () => 0 });
    const bad = [];
    const okVal = { m: 1 };
    const got = await bt.instrumentImport(Promise.resolve(okVal), './apps/x/a.js');
    if (got !== okVal) bad.push('成功的模块没被原样转发');
    let threw = null;
    try { await bt.instrumentImport(Promise.reject(new Error('boom')), './apps/x/b.js'); }
    catch (e) { threw = e; }
    if (!threw || threw.message !== 'boom') bad.push('失败未被原样抛出（失败会变成静默）');
    const f = bt.collect();
    if (!f.segments.some((s) => s.failed === true && /b\.js/.test(s.name))) bad.push('失败段未记账（!failed）');
    if (!f.segments.some((s) => s.name === 'import:./apps/x/a.js')) bad.push('成功段的短名不对');
    if (!f.segments.some((s) => s.spec === './apps/x/a.js')) {
        bad.push('spec 未进读数面（短名去了 query，没有原串就回溯不到加载点）');
    }
    /* 重复加载必须被看出来 —— 这正是本面立在这里的理由之一：
     * 同一 spec 第二次加载在浏览器里仍要过一遍 promise/解析，是真开销也是真线索。
     * （repeatedSpecs 的口径是「只列出现 >1 次的」，grep 不出来不等于没记。） */
    await bt.instrumentImport(Promise.resolve({}), './apps/x/a.js');
    const g = bt.collect();
    if (!g.repeatedSpecs.some((r) => r.spec === './apps/x/a.js' && r.times === 2)) {
        bad.push('同一 spec 加载两次未被计成重复加载点：' + JSON.stringify(g.repeatedSpecs));
    }
    return { ok: bad.length === 0, why: bad.join(' / ') };
}

/** 判据 3：index.js 的**全部**动态 import 都必须被旁听包住，且 spec 逐字不变。
 *  注意 `instrumentImport(` 自身**不含**小写 `import(`（它是大写 I 的 Import），
 *  所以每个被包的加载点在这里恰好留下 1 个 `import(` 命中。 */
function scanImportWiring(rawSrc) {
    /* 判据面必须是**真代码**（剥注释 + 剥字符串）：内置公告是字符串数组，
     * 面向用户的更新说明里逐字带着 `import(<spec>)` —— 只剥注释会把它读成真代码。 */
    const lit = stripNonCode(rawSrc);
    const src = lit.code;
    const PREFIX = 'instrumentImport(';      // 17 字符
    const bare = [];
    const specs = [];
    let total = 0;
    for (let i = src.indexOf('import('); i >= 0; i = src.indexOf('import(', i + 1)) {
        total += 1;
        const lineNo = src.slice(0, i).split('\n').length;
        if (src.slice(i - PREFIX.length, i) !== PREFIX) { bare.push(lineNo); continue; }
        /* 切到行尾为止：slice 之后还接着整份文件，用 $ 锚定会永不命中（78 处全误判） */
        const nl = src.indexOf('\n', i);
        const m = /^instrumentImport\(import\((.+?)\), (.+?)\)/.exec(src.slice(i - PREFIX.length, nl < 0 ? src.length : nl));
        if (!m) { bare.push(lineNo); continue; }
        specs.push({ raw: m[1], mirror: m[2], line: lineNo });
    }
    return { total, bare, specs, suspects: lit.suspects };
}

/** 判据 4：读出口必须叫 collect（J2 口径：产品代码里不得出现 .snapshot( 调用式）。 */
function judgeReadOutletNaming(mod) {
    const bt = mod.createBootTiming({ now: () => 1 });
    const bad = [];
    if (typeof bt.collect !== 'function') bad.push('读出口不叫 collect');
    if (typeof bt.snapshot === 'function') bad.push('读出口仍叫 snapshot（会撞 J2 判据）');
    return { ok: bad.length === 0, why: bad.join(' / ') };
}

/* ══════════ A ── 口径本体 ══════════ */
test('A1 ★★★ 无钟/坏钟下耗时如实 null（绝不编 0），且整份读数不塌', () => {
    const r = judgeNoFabricatedZero(BT);
    assert.ok(r.ok, '判据 1 在原实现上就红了：' + r.why);
});

test('A2 ★★★ 反坐实：正常钟下耗时如实出数（门不得关成「谁都测不出」）', () => {
    let t = 100;
    const bt = BT.createBootTiming({ now: () => (t += 5) });
    const end = bt.begin('core-modules');
    end();
    const f = bt.collect();
    assert.equal(f.clock, 'ok');
    assert.equal(f.segments[0].ms, 5, '起止各读一次钟 ⇒ 5ms，实得 ' + JSON.stringify(f.segments[0].ms));
    assert.equal(f.totalMs, 5);
    assert.equal(f.unmeasurable, 0);
    assert.equal(f.slowest[0].name, 'core-modules');
});

test('A3 ★★★ 收尾函数幂等：重复调用不得重复记账（try/finally + 显式收尾会各调一次）', () => {
    let t = 0;
    const bt = BT.createBootTiming({ now: () => (t += 3) });
    const end = bt.begin('ui-modules');
    assert.equal(end(), null, '第一次收尾返回值按契约是 null');
    end(); end();
    const f = bt.collect();
    assert.equal(f.spans, 1, '★ 重复收尾把段记了 ' + f.spans + ' 次');
    assert.equal(f.repeated.length, 0, '★ 重复收尾污染了「重复段」读数');
    /* 无钟分支同样幂等（它有独立的收尾实现，必须各判一次） */
    const ab = BT.createBootTiming({ now: null });
    const e2 = ab.begin('x');
    e2(); e2();
    assert.equal(ab.collect().spans, 1, '无钟分支的收尾不幂等');
});

test('A4 ★★★ instrumentImport 原样转发 resolve/reject（吞错 = 失败变静默）', async () => {
    const r = await judgeForwardsImport(BT);
    assert.ok(r.ok, '判据 2 在原实现上就红了：' + r.why);
});

test('A5 ★★ 真源零依赖且不自建 import（`import(` 在真源里即使出现在注释里也不得混进实现面）', () => {
    const code = stripNonCode(readRel(SRC_REL)).code;
    assert.equal(/^import\s/m.test(code), false, '真源必须是零依赖叶子模块（不得有 import 语句）');
    assert.equal(/import\(/.test(code), false, '真源内部不得自己现拼 import() —— 那是改加载路径');
});

test('A6 ★★ 两个「没有 ms」必须可分：records 在场 vs 缺席', () => {
    const bt = BT.createBootTiming({ now: null });
    const end = bt.begin('a');
    end();
    const f = bt.collect();
    assert.equal(f.spans, 1, '收尾过的段在场');
    assert.equal(f.measured + f.unmeasurable, f.spans, 'measured + unmeasurable 必须恒等于 spans（可分性的算术后盾）');
    /* 没记账的段完全不在 spans 里（缺席 ≠ 测不出） */
    assert.equal(f.segments.some((s) => s.name === 'never-begun'), false);
});

/* ══════════ B ── 真源码接线 ══════════ */
test('B1 ★★★ index.js 全部动态 import 都被旁听包住，且 spec 逐字不变（读数层不得改加载路径）', () => {
    const src = readRel('index.js');
    const scan = scanImportWiring(src);
    assert.equal(scan.suspects.length, 0,
        '★ 模板串正文里出现 import( ⇒ 剥面可能吞掉真代码，按 fail-closed 拒判：' + JSON.stringify(scan.suspects));
    assert.equal(scan.bare.length, 0, '★ 有裸 import( 未旁听，行号：' + scan.bare.join(','));
    assert.ok(scan.total >= 78, 'import( 数不得掉底（本版实测 78），实得 ' + scan.total);
    assert.equal(scan.specs.length, scan.total, '每处 import 都应能取出 spec 与镜像');
    /* 字面量 spec：包装里两处必须逐字相同（证「没改 spec」） */
    for (const s of scan.specs) {
        if (/^[A-Za-z_$]/.test(s.raw)) continue;      // 变量形态（唯一一处 honey）
        assert.equal(s.mirror, s.raw, '★ spec 被改写了：' + s.raw + ' → ' + s.mirror);
    }
});

test('B2 ★★ 两个启动大段 + 请求侧标记在场（三态可分：没请求 / 没跑完 / 跑完了）', () => {
    const src = readRel('index.js');
    for (const [anchor, name] of [
        ["bootTiming.begin('core-modules')", 'core-modules 开段'],
        ["bootTiming.begin('ui-modules')", 'ui-modules 开段'],
        ["bootTiming.mark('boot:core-requested')", '请求侧标记'],
        ['endBootCore();', 'core 收段'],
        ['endBootUi();', 'ui 收段']
    ]) {
        assert.equal(src.split(anchor).length - 1, 1, name + ' 应恰好在场 1 次');
    }
    /* 一行汇总必须走真源（不得就地拼一遍文案） */
    assert.ok(/bootTimingLine\(bootTiming\.collect\(\)\)/.test(src), '汇总日志必须消费真源文案');
    assert.equal(/window\.VirtualPhone\s*=[\s\S]{0,400}?bootTiming: bootTiming/.test(src), true,
        '★ 必须挂出 window.VirtualPhone.bootTiming（诊断页读数的唯一出口）');
});

test('B3 ★★ 真源是零依赖叶子模块，且读出口命名服从 J2 口径（不叫 snapshot）', () => {
    const src = readRel(SRC_REL);
    assert.equal(src.split('export function createBootTiming').length - 1, 1);
    assert.equal(src.split('export function bootTimingLine').length - 1, 1);
    assert.equal(src.split('export const MAX_SPANS').length - 1, 1);
    const r = judgeReadOutletNaming(BT);
    assert.ok(r.ok, r.why);
    /* 产品代码里不得出现 `.snapshot(` 调用式（第九道门 J2 的同一判据面）。
     * 扫描面必须**剥注释** —— 第九道门就是这么做的（scripts/bridge-contract-audit.mjs
     * 先把产品文件过 stripComments 再扫），本判据若不剥就比门**更严**：
     * 真源文件头正用这句散文解释「读出口为什么不能叫 snapshot」，
     * 一剥一不剥，同一件事会得到两个答案（v3.12.0 立 stripComments 要治的正是这个形态）。 */
    assert.equal(/\.snapshot\s*\(/.test(stripComments(src)), false, '★ 真源（剥注释后）里出现 .snapshot( 会撞第九道门');
    /* 自证：上面那条断言不是空转 —— 未剥注释的原文里**确实**有这串字面（散文在解释命名理由）。
     * 少了这一条，「注释连同说明一起被删」与「真没违规」会显示成同一个绿。 */
    assert.ok(/\.snapshot\s*\(/.test(src), '文件头那段「为什么不能叫 snapshot」的说明被删了（判据 4 的自证面丢了）');
});

/* ══════════ C ── 可见面 ══════════ */
test('C1 ★★★ 诊断内核从**宿主实例**读（自建实例会把「整段启动」读成「打开页之后」）', () => {
    const marker = { clock: 'ok', segments: [], totalMs: 12 };
    const fakeInst = { collect: () => marker };
    const win = { VirtualPhone: { bootTiming: fakeInst } };
    assert.equal(DD.bootTimingFace(win), marker, '必须原样转发宿主实例的读数（同一份引用）');
    /* 无宿主 / 无实例 / 实例半个 ⇒ 一律如实 null（那是「没这个读数」，不是「启动很快」） */
    assert.equal(DD.bootTimingFace({}), null);
    assert.equal(DD.bootTimingFace({ VirtualPhone: {} }), null);
    assert.equal(DD.bootTimingFace({ VirtualPhone: { bootTiming: {} } }), null);
    assert.equal(DD.bootTimingFace(null), null);
    /* 实例抛错不得把诊断页拖垮 */
    assert.equal(DD.bootTimingFace({ VirtualPhone: { bootTiming: { collect() { throw new Error('x'); } } } }), null);
});

test('C2 ★★ 内核转发与真源逐字同源（同一口径不得两份实现）', () => {
    let t = 0;
    const bt = BT.createBootTiming({ now: () => (t += 4) });
    bt.begin('core-modules')();
    const face = bt.collect();
    assert.equal(DD.bootTimingFaceText(face), BT.bootTimingLine(face), '一行文案必须逐字取自真源');
});

test('C3 ★★★ 段表排序口径：可测时按耗时降序在前，不可测时排在后面（不得把「测不出」混进耗时排序）', () => {
    const face = {
        segments: [
            { name: 'fast', ms: 3, state: 'measured' },
            { name: 'unknown-a', ms: null, state: 'unmeasurable' },
            { name: 'slow', ms: 90, state: 'measured' },
            { name: 'boot:core-requested', ms: null, state: 'unmeasurable', kind: 'mark' }
        ]
    };
    const rows = DD.bootTimingRows(face, 10);
    const names = rows.map((r) => r.name);
    assert.deepEqual(names.slice(0, 2), ['slow', 'fast'], '★ 可测时的段必须按耗时降序在前');
    assert.deepEqual(names.slice(2), ['unknown-a', 'boot:core-requested'], '★ 不可测时的段必须排在后面');
    assert.equal(rows.find((r) => r.name === 'boot:core-requested').isMark, true, 'mark 必须被标出来（视图要分开渲染）');
    assert.equal(DD.bootTimingRows(null, 10).length, 0, '空面给空表（不抛）');
});

test('C4 ★★★ 诊断视图真建卡，且三条纪律都在（逐段 / 不可测时分列 / 只读数不优化）', () => {
    const src = readRel('apps/diagnose/diagnose-view.js');
    assert.ok(/_bootTimingHtml\(pkg\)/.test(src), '★ 必须真建卡');
    assert.ok(/bootTimingFaceText\(face\)/.test(src), '一字汇总必须取自内核转发');
    assert.ok(/bootTimingRows\(face, 40\)/.test(src), '逐段明细必须取自真源（视图不得自己排）');
    assert.ok(/不可测时/.test(src), '★ 「不可测时」这一态必须在界面上显式可见');
    assert.ok(/不是.{0,6}启动很快/.test(src), '★ 读不到必须与「很快」显式区分');
    assert.ok(/只读数，不做优化/.test(src), '★ 口径纪律必须写在卡上（免得被当性能优化读）');
    assert.ok(/没有读数的优化是把直觉当证据/.test(src), '纪律的**理由**也要在卡上');
    /* 视图不得自己排段表（排序口径必须在内核） */
    const code = src.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
    assert.equal(/\.sort\(\(a, b\) => b\.ms/.test(code), false, '★ 视图不得自己排耗时（排序口径属内核）');
});

/* ══════════ D ── 真源码破坏负控制 ══════════ */

/** 造一份微镜像（只含真源所在目录链），把破坏写进副本，再在副本上重跑真判据。 */
async function withBrokenSrc(mutate) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v3130-brk-'));
    try {
        const rel = path.join('config', 'boot-timing.js');
        fs.mkdirSync(path.join(dir, 'config'), { recursive: true });
        const body = mutate(readRel(SRC_REL));
        assert.notEqual(body, readRel(SRC_REL), '破坏未发生（锚点没命中）');
        fs.writeFileSync(path.join(dir, rel), body);
        return { dir, mod: await import(pathToFileURL(path.join(dir, rel)).href + '?b=' + Date.now()) };
    } catch (e) {
        fs.rmSync(dir, { recursive: true, force: true });
        throw e;
    }
}

test('D1 ★★★ 负控制：「不编 0」被拆 ⇒ 判据 1 在破坏副本上转红', async () => {
    const base = await withBrokenSrc((s) => {
        /* 锚点刻意选「无钟分支的收尾记账」，**不是** `since()` 里的 `if (t0 === null) return null;`：
         * 后者在真源里有两处（`since()` 与断点判空同族），按「锚点恰中 1 次」会当场拒判 ——
         * 那条纪律拦的正是「以为改的是 A，实际改的是 B」。
         * 这里把「记 null」改成「记 0」：时钟缺失被编成一个看起来完美的 0ms。 */
        const anchor = 'record(name, null, meta);';
        assert.equal(s.split(anchor).length - 1, 1, '锚点应恰好命中 1 次（多命中 ⇒ 改错地方）');
        return s.replace(anchor, 'record(name, 0, meta);');
    });
    try {
        assert.ok(judgeNoFabricatedZero(BT).ok, '阳性对照：原实现上判据 1 必须为真');
        /* 判据函数的契约是返回 {ok, why}（内部 assert 只守前置条件），不抛 ——
         * 用 assert.throws 包它等于把「转红」与「抛错」混为一谈。 */
        const r = judgeNoFabricatedZero(base.mod);
        assert.equal(r.ok, false, '★ 时钟缺失被编成 0ms，判据 1 却没转红');
        assert.ok(/ms 不是 null|编 0/.test(r.why), '转红原因须指向真因：' + r.why);
    } finally { fs.rmSync(base.dir, { recursive: true, force: true }); }
});

test('D2 ★★★ 负控制：失败不再抛出（吞错）⇒ 判据 2 在破坏副本上转红', async () => {
    const base = await withBrokenSrc((s) => {
        const anchor = "(err) => { record(base + '!failed', since(t0), meta, { failed: true }); throw err; }";
        assert.equal(s.split(anchor).length - 1, 1, '锚点应恰好命中 1 次');
        return s.replace(anchor, "(err) => { record(base + '!failed', since(t0), meta, { failed: true }); return null; }");
    });
    try {
        assert.ok((await judgeForwardsImport(BT)).ok, '阳性对照：原实现上判据 2 必须为真');
        const r = await judgeForwardsImport(base.mod);
        assert.equal(r.ok, false, '★ 加载失败被吞掉，判据 2 却没转红');
        assert.ok(/静默|抛出/.test(r.why), '转红原因须指向真因：' + r.why);
    } finally { fs.rmSync(base.dir, { recursive: true, force: true }); }
});

test('D3 ★★★ 负控制：读出口改名回 snapshot ⇒ 判据 4 在破坏副本上转红', async () => {
    const base = await withBrokenSrc((s) => {
        assert.equal(s.split('        collect() {').length - 1, 1, '锚点应恰好命中 1 次');
        return s.replace('        collect() {', '        snapshot() {');
    });
    try {
        assert.ok(judgeReadOutletNaming(BT).ok, '阳性对照：原实现上判据 4 必须为真');
        const r = judgeReadOutletNaming(base.mod);
        assert.equal(r.ok, false, '★ 读出口改回 snapshot，判据 4 却没转红');
    } finally { fs.rmSync(base.dir, { recursive: true, force: true }); }
});

test('D4 ★★★ 负控制：真源码里拆掉一处 import 旁听 ⇒ 判据 3（B1 同款）转红', () => {
    const src = readRel('index.js');
    const anchor = "bootTiming.instrumentImport(import('./apps/mood/mood-app.js'), './apps/mood/mood-app.js')";
    assert.equal(src.split(anchor).length - 1, 1, '锚点应恰好命中 1 次');
    assert.equal(scanImportWiring(src).bare.length, 0, '阳性对照：原版上必须是 0 处裸 import');
    const broken = src.replace(anchor, "import('./apps/mood/mood-app.js')");
    const scan = scanImportWiring(broken);
    assert.equal(scan.bare.length, 1, '★ 去掉旁听后裸 import 未被发现（判据失效）');
    assert.ok(scan.bare[0] > 0, '转红须指得出行号');
});

/* ══════════ E ── 版本锚 ══════════ */
const VNUM = (s) => Number(String(s).split('.').reduce((a, x) => a * 1000 + Number(x), 0));
test('E1 ★ 版本五源同源（下限形：自 3.13.0 起成立，不钉死某一版）', () => {
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
    assert.ok(VNUM(codeVer) >= VNUM('3.13.0'), '本套件自 3.13.0 起成立；当前 ' + codeVer);
});
