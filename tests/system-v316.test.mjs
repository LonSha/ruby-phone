// tests/system-v316.test.mjs — 性能取证与量级基线（O-5 下游侧）[v3.3.4]
//
//   本版只取证与立基线：**任何优化都要先有可比基线**，否则改完不知道是快了还是碰巧。
//   口径纪律（两条，都是被教训换来的）：
//     · 探针是**合成数据 + 真模块** —— 无浏览器、无宿主、无真实长会话，读数不代表实机性能；
//     · **setup 不计时**（上游 O-5 的 290 倍教训）**且先预热**（首版把 JIT 冷启动算进首测，
//       于是「200 在场」3.335ms 反而比「1000 在场」1.328ms 慢 —— 那不是算法特征）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const BASE = path.join(ROOT, 'tests', 'perf_baseline.json');
const PROBE = path.join(ROOT, 'tests', 'perf_probe.mjs');
const read = (p) => fs.readFileSync(p, 'utf8');
const base = JSON.parse(read(BASE));
const probeSrc = read(PROBE);

// ══════════ A 基线本体与口径 ══════════
test('v316 A1. ★★ 基线四件齐备：读数 / 缩放 / 口径修正 / 没做什么', () => {
    for (const k of ['readings_ms', 'scaling', 'corrections', 'not_done']) assert.ok(base[k], '缺面：' + k);
    assert.ok(Object.keys(base.readings_ms).length >= 6, '读数至少 6 项');
    for (const [k, v] of Object.entries(base.readings_ms)) assert.ok(Number.isFinite(v) && v >= 0, k + ' 必须是有限非负数');
    assert.ok(Array.isArray(base.corrections) && base.corrections.length >= 2, '两条口径修正都要记');
    assert.ok(base.not_done.length >= 4, '没做什么至少 4 条');
});

test('v316 A2. ★★★ 口径不得被当成实机：须写明「合成数据 / 非实机 / 无浏览器·宿主」', () => {
    const txt = JSON.stringify(base);
    assert.ok(/合成数据/.test(txt), '必须写明合成数据');
    assert.ok(/非实机|不代表实机/.test(txt), '必须写明不代表实机性能');
    assert.ok(/浏览器|宿主/.test(txt), '必须写明无浏览器/宿主参与');
    assert.ok(/IO|网络|LLM/.test(base.not_done.join(' ')), '必须写明未覆盖 IO 与网络路径');
    assert.ok(/渲染|DOM/.test(base.not_done.join(' ')), '必须写明未覆盖 UI 渲染路径');
});

test('v316 A3. ★★ 缩放读数自洽（大输入不得比小输入更快；反例正是首版没预热）', () => {
    const a = base.readings_ms.projectScene_200_presence;
    const b = base.readings_ms.projectScene_1000_presence;
    assert.ok(b >= a, '1000 在场的耗时不得小于 200 在场（否则读数不可信）');
    assert.ok(b <= a * 20, 'projectScene 在 5 倍输入下超 20 倍耗时，需重新取证');
    assert.ok(/超线性|亚毫秒|线性/.test(base.scaling.verdict), '结论须如实');
    assert.ok(base.warmup === true, '基线须声明已预热');
});

// ══════════ B 探针口径（结构 + 行为） ══════════
test('v316 B1. ★★★ 探针必须预热且 setup 不计时（两条都是教训）', () => {
    assert.ok(/预热/.test(probeSrc), '探针须有预热段');
    assert.ok(/const hosts/ .test(probeSrc) || /const hosts =/.test(probeSrc), '须先建 hosts 数组');
    const ts = probeSrc.indexOf('const t0=process.hrtime.bigint()');
    const te = probeSrc.indexOf('const ms=Number(process.hrtime.bigint()-t0)');
    assert.ok(ts > 0 && te > ts, '计时区间可定位');
    const region = probeSrc.slice(ts, te);
    assert.ok(!/bigFace\(|bigBlocks\(/.test(region), '★ 计时区间内不得构造夹具（bigFace / bigBlocks）');
    // 预热段必须在计时之前
    const warm = probeSrc.indexOf('// 预热（不计时）');
    assert.ok(warm > 0 && warm < ts, '预热必须排在第一次计时之前');
});

test('v316 B2. ★★ 行为面：真跑探针，读数与基线同量级（允许 5 倍抖动）', () => {
    const r = spawnSync(process.execPath, [PROBE], { cwd: ROOT, encoding: 'utf8', timeout: 600000 });
    assert.equal(r.status, 0, '探针必须能跑通：' + String(r.stderr).slice(0, 200));
    let got;
    try { got = JSON.parse(r.stdout); } catch (e) { assert.fail('探针输出必须是 JSON：' + r.stdout.slice(0, 120)); }
    assert.ok(got.synth === true, '探针自己必须声明是合成数据');
    const rows = {};
    for (const row of got.rows) rows[row.label] = row.per_op_ms;
    const pairs = [['projectScene 1000 在场', base.readings_ms.projectScene_1000_presence],
                   ['injectionBlocksOf 2000 块', base.readings_ms.injectionBlocksOf_2000_blocks],
                   ['makeSnippet x2000 文档', base.readings_ms.makeSnippet_2000_docs]];
    for (const [label, want] of pairs) {
        assert.ok(Number.isFinite(rows[label]), '探针输出须含 ' + label);
        assert.ok(rows[label] <= want * 5 + 2, label + ' 实测 ' + rows[label] + 'ms 超基线 ' + want + 'ms 的 5 倍（量级漂移）');
    }
});

// ══════════ C 版本四源同源 ══════════
const vnum = (s) => Number(String(s).split('.').reduce((a, x) => a * 1000 + Number(x), 0));

test('v316 C1. ★ 版本四源同源（入口 / manifest / update-log.latest / update-log 首键）', () => {
    const manifest = JSON.parse(read(path.join(ROOT, 'manifest.json')));
    const log = JSON.parse(read(path.join(ROOT, 'update-log.json')));
    const codeVer = (/const ST_PHONE_VERSION = '([^']+)'/.exec(read(path.join(ROOT, 'index.js'))) || [])[1];
    assert.ok(codeVer, '入口版本常量在场');
    assert.equal(codeVer, manifest.version);
    assert.equal(log.latest, manifest.version);
    assert.equal(Object.keys(log.versions)[0], manifest.version, '★ update-log.versions 首键必须是当版');
    assert.ok(vnum(codeVer) >= vnum('3.3.4'), '本套件只在 3.3.4 及以后成立；当前 ' + codeVer);
});

// ══════════ D 负控制 ══════════
test('v316 N1. ★★ 负控制·夹具计入：把 bigFace(1000) 写进计时区 ⇒ B1 的结构判据必须转红', () => {
    /* 破坏点必须落在**计时区间内部**。首稿按 `const t0=...` 的偏移 +30 字符插桩，
     *   而那 30 字符还在 `const t0 = process.hrtime.bigint();` 这一行**里面** ⇒
     *   破坏落在计时起点之前，计时区里当然找不到 bigFace（负数控制当场转红）。
     *   改为锚在「计时区间内的第一条语句」上：for 循环体。 */
    const rowsLine = '  for(let i=0;i<reps;i++) sum+=fn(hosts[i])||0;';
    assert.equal(probeSrc.split(rowsLine).length - 1, 1, '锚点须恰中 1 次（计时区内的循环体）');
    const broken = probeSrc.replace(rowsLine, '  projectScene(bigFace(1000));   // 破坏：把夹具成本塞进计时区' + String.fromCharCode(10) + rowsLine);
    const bts = broken.indexOf('const t0=process.hrtime.bigint()');
    const bte = broken.indexOf('const ms=Number(process.hrtime.bigint()-t0)');
    const region = broken.slice(bts, bte);
    assert.match(region, /bigFace\(/, '★ 破坏后计时区内确实出现了夹具构造（同款判据会转红）');
    assert.ok(!/bigFace\(/.test(probeSrc.slice(probeSrc.indexOf('const t0=process.hrtime.bigint()'), probeSrc.indexOf('const ms=Number(process.hrtime.bigint()-t0)'))),
        '对照：原件计时区内不得有夹具构造');
});

test('v316 N2. ★★ 负控制·去掉预热 ⇒ A3 的「大输入不得更快」自洽性会暴露（读数不可信）', () => {
    // 基线里记着未预热时的实测值（3.335 / 1.328）—— 那正是 A3 要拦的形态
    const bad = { projectScene_200_presence: 3.335, projectScene_1000_presence: 1.328 };
    assert.ok(bad.projectScene_1000_presence < bad.projectScene_200_presence,
        '未预热读数确实是「大输入更快」的矛盾形态（A3 会转红）');
    assert.ok(base.readings_ms.projectScene_1000_presence >= base.readings_ms.projectScene_200_presence,
        '对照：基线里的（已预热）读数必须自洽');
});

test('v316 N3. ★★ 负控制·把合成探针讲成实机 ⇒ A2 必须转红', () => {
    const strip = (t) => t.replace(/合成数据/g, '生产数据').replace(/非实机|不代表实机/g, '即实机').replace(/浏览器|宿主/g, '本机');
    const polluted = strip(JSON.stringify(base));
    assert.ok(!/合成数据/.test(polluted), '污染后确实失去合成数据声明');
    assert.ok(/合成数据/.test(JSON.stringify(base)), '对照：原件上必须有');
});
