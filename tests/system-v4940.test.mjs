/* ============================================================
 * tests/system-v4940.test.mjs — v4.94.0 类方法面 + 模块入度面判据档（计划 R11-O2）
 * ------------------------------------------------------------
 * 为什么要有这一档：`dead-export-check` 与 `bind-consuming` 枚举的都是**模块级导出**。
 *   于是两整面结构性缺口：
 *     ① `export class SubsystemOrchestrator` 被 index.js import ⇒ 它的 41 个类方法
 *        一次全部白拿「已消费」，实测 34 个在产品面除声明行外零出现，门一次没报过。
 *     ② `config/*.js` 里 79 件只被 orchestrator 引、15 件零 import ——
 *        「中枢那一行 import」就算已消费，整批件长期无人过问。
 *   本档把判定面下沉到**方法级**与**模块入度级**，并用真源码破坏证明新口径看得见旧口径看不见的东西。
 *
 * 判据分六面：
 *   A 库层：掩码保长度保行号（行号坐标系自证）
 *   B 库层：类体枚举（正则量词不吃后继类 / 行号不差 1 / 访问器与私有方法不进面）
 *   C 库层：判死口径（除声明行外零出现才是死；字符串面计入 → 方向是漏报）
 *   D 库层：模块入度分档（product / orchestrator-only / zero；传掩码面必须抛错）
 *   E 真仓：两份冻结账本自洽 + 零新增
 *   F 探测器自证：新死方法 rc=1 / 新孤儿模块 rc=1 / 空面 exit 2 / --fixture 不豁免空面 / 门链接线
 * ============================================================ */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import {
  maskKeepLines, collectClassMethods, buildNameIndex, findDeadMethods,
  buildInstantiationIndex, buildModuleIndegree,
} from '../scripts/lib/dead-surface.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const rel = (p) => path.join(ROOT, p);
const read = (p) => fs.readFileSync(rel(p), 'utf8');
const BORN_V = '4.94.0';
const AUDIT = rel('scripts/method-consumption-audit.mjs');
const M_BASE = rel('scripts/dead-method-baseline.json');
const D_BASE = rel('scripts/dead-module-baseline.json');
const runAudit = (args = []) => spawnSync(process.execPath, [AUDIT, ...args], {
  encoding: 'utf8', cwd: ROOT, timeout: 300000,
});
const cls = (src) => collectClassMethods(new Map([['t.js', maskKeepLines(src)]]));

/* ══════════════════════════════════════════════════════════════
 * A 库层 —— 掩码：保长度、保行号
 * ══════════════════════════════════════════════════════════════ */
test('A1: 掩码保长度且换行位置逐字符一致（行号坐标系不变）', () => {
  const src = [
    '// 注释里有 foo',
    "const s = 'bar baz';",
    'const t = `多行',
    '模板 qux`;',
    'function real() { return 1; }',
  ].join('\n');
  const masked = maskKeepLines(src);
  assert.equal(masked.length, src.length, '掩码必须保长度');
  for (let i = 0; i < src.length; i++) {
    if (src[i] === '\n') assert.equal(masked[i], '\n', `第 ${i} 个字符应是换行（行号不能错位）`);
  }
  assert.ok(!masked.includes('foo'), '注释内容必须被置空');
  assert.ok(!masked.includes('bar'), '字符串内容必须被置空');
  assert.ok(masked.includes('function real'), '真代码必须保留');
});

/* ══════════════════════════════════════════════════════════════
 * B 库层 —— 类体枚举
 * ══════════════════════════════════════════════════════════════ */
test('B1: 正则字面量的量词花括号不得吞掉后继类（首版实测只认出 231/293）', () => {
  const src = [
    'export class Aaa {',
    '    static RE = /\\d{2,4}/;',
    '    m1() { return Aaa.RE; }',
    '}',
    'export class Bbb {',
    '    m2() {}',
    '}',
  ].join('\n');
  const names = cls(src).map((c) => c.cls);
  assert.deepEqual(names, ['Aaa', 'Bbb'], `/d{2,4}/ 里的花括号会让类体配对错位，实得 ${names.join(',')}`);
  const aaa = cls(src).find((c) => c.cls === 'Aaa');
  assert.equal(aaa.methods.length, 1, '类体只应认出 m1（RE 是字段不是方法）');
  assert.equal(aaa.methods[0].name, 'm1');
});

test('B2: 方法行号必须落在真声明行上（首版整体差 1）', () => {
  const src = [
    'export class Kk {',      // 1
    '    constructor() {}',   // 2
    '    alpha() {}',         // 3
    '    static beta() {}',   // 4
    '}',                      // 5
  ].join('\n');
  const m = cls(src)[0].methods;
  const by = Object.fromEntries(m.map((x) => [x.name, x.line]));
  assert.equal(by.alpha, 3, 'alpha 声明在第 3 行');
  assert.equal(by.beta, 4, 'beta 声明在第 4 行');
});

test('B3: 访问器与私有方法不进判死面，静态方法标记正确', () => {
  const src = [
    'export class Pp {',
    '    get value() { return 1; }',
    '    set value(v) {}',
    '    _hidden() {}',
    '    #secret() {}',
    '    static make() {}',
    '}',
  ].join('\n');
  const all = cls(src)[0].methods;
  const pub = all.filter((m) => !m.isAccessor && !m.isPrivate).map((m) => m.name);
  assert.deepEqual(pub, ['value', 'value', 'make'].filter((x) => x === 'make'),
    '访问器（get/set）与 _ / # 私有方法必须被排除，只剩 make；实得 ' + pub.join(','));
  assert.equal(all.find((m) => m.name === 'make').isStatic, true);
});

/* ══════════════════════════════════════════════════════════════
 * C 库层 —— 判死口径
 * ══════════════════════════════════════════════════════════════ */
test('C1: 除声明行外零出现才判死；别处出现过一次即判活', () => {
  const masked = new Map([
    ['a.js', maskKeepLines(['export class Aa {', '    called() {}', '    orphan() {}', '}'].join('\n'))],
    ['b.js', maskKeepLines(['export function useIt(app) { app.called(); }'].join('\n'))],
  ]);
  const raw = new Map([['a.js', ['export class Aa {', '    called() {}', '    orphan() {}', '}'].join('\n')],
    ['b.js', 'export function useIt(app) { app.called(); }']]);
  const classes = collectClassMethods(masked).filter((c) => c.methods.length);
  const names = new Set(classes.flatMap((c) => c.methods.map((m) => m.name)));
  const idx = buildNameIndex(masked, raw, names);
  const dead = findDeadMethods(classes, idx).map((d) => d.name);
  assert.deepEqual(dead, ['orphan'], 'called 在 b.js 被调过 ⇒ 活；orphan 零出现 ⇒ 死；实得 ' + dead.join(','));
});

test('C2: 字符串面并集口径 —— 事件表里以字符串写的名字算活（方向是漏报）', () => {
  const src = ['export class Bb {', '    onTap() {}', '}'].join('\n');
  const masked = new Map([['a.js', maskKeepLines(src)]]);
  const raw = new Map([
    ['a.js', src],
    ['c.js', "[{ ev: 'tap', fn: 'onTap' }]"],
  ]);
  const classes = collectClassMethods(masked).filter((c) => c.methods.length);
  const idx = buildNameIndex(masked, raw, new Set(['onTap']));
  const dead = findDeadMethods(classes, idx);
  assert.equal(dead.length, 0,
    '字符串面里出现名字即判活（本判据是下界，宁可漏报不出假红）');
});

test('C3: 实例化索引只认 `new Cls(`', () => {
  const masked = new Map([
    ['a.js', maskKeepLines('const x = new Aa(1); const y = Aa.of();')],
  ]);
  const idx = buildInstantiationIndex(masked, new Set(['Aa', 'Bb']));
  assert.equal(idx.get('Aa').length, 1, 'Aa 被 new 过一次');
  assert.equal(idx.get('Bb').length, 0, 'Bb 从未被 new');
});

/* ══════════════════════════════════════════════════════════════
 * D 库层 —— 模块入度分档
 * ══════════════════════════════════════════════════════════════ */
test('D1: 分档 product / orchestrator-only / zero 三档判定正确', () => {
  /* ⚠️ 路径必须是**真实相对位置**：`apps/x/x-app.js` 里写 `../config/x.js` 会解析成
   *   `apps/config/x.js`（不是 `config/x.js`）—— 首版夹具就是这么写的，实测被判 zero。
   *   夹具的错在夹具自己，判据没错；这类「夹具路径不真」会让「D1 失败」看起来像库层缺陷。 */
  const bind = new Map([
    ['config/subsystem-orchestrator.js', "import { a } from './only-orch.js';"],
    ['apps/x-app.js', "import { b } from '../config/prod-one.js';"],
    ['config/only-orch.js', 'export const a = 1;'],
    ['config/prod-one.js', 'export const b = 1;'],
    ['config/lonely.js', 'export const c = 1;'],
  ]);
  const rows = buildModuleIndegree(bind);
  const tier = Object.fromEntries(rows.map((r) => [r.rel, r.tier]));
  assert.equal(tier['config/prod-one.js'], 'product', '被产品件 import ⇒ product');
  assert.equal(tier['config/only-orch.js'], 'orchestrator-only', '只被中枢引 ⇒ orchestrator-only');
  assert.equal(tier['config/lonely.js'], 'zero', '零 import ⇒ zero');
});

test('D2: 传进掩码面（说明符已置空）时必须抛错，不许出一张全 zero 的假表', () => {
  const masked = new Map([
    ['config/a.js', maskKeepLines("import { x } from './b.js';")],
    ['config/b.js', 'export const x = 1;'],
  ]);
  assert.throws(() => buildModuleIndegree(masked), /输入面丢了字符串|入度全表 0/,
    '全表零入度但确有 import 语句 ⇒ 探测器失效，必须抛而不是判绿');
});

test('D3: 无 import 的纯计算文件不得误抛（首版在这里误报）', () => {
  /* 这里刻意保留一条真边（apps/y-app.js → config/pure.js）：否则全表零入度会触发
   *   「输入面丢了字符串」自证，测不到「纯计算文件不该误抛」这件事。
   *   注意相对路径：`apps/y-app.js` 的 `../config/pure.js` 才解析到 `config/pure.js`。 */
  const bind = new Map([
    ['config/pure.js', 'export function add(a, b) { return a + b; }'],
    ['apps/y-app.js', "import { add } from '../config/pure.js';"],
  ]);
  const rows = buildModuleIndegree(bind);
  assert.equal(rows.find((r) => r.rel === 'config/pure.js').tier, 'product',
    '不含引号的文件只是没有出边，不等于传错了面');
});

/* ══════════════════════════════════════════════════════════════
 * E 真仓 —— 冻结账本自洽 + 零新增
 * ══════════════════════════════════════════════════════════════ */
test('E1: 方法面账本每条的 (rel, line, name) 必须逐条对得上真源码', () => {
  const b = JSON.parse(fs.readFileSync(M_BASE, 'utf8'));
  assert.equal(b.schema, 'dead-method-baseline@1');
  assert.ok(b.entries.length >= 300, '账本条目数异常偏少：' + b.entries.length);
  const cache = new Map();
  const linesOf = (r) => {
    if (!cache.has(r)) cache.set(r, read(r).split('\n'));
    return cache.get(r);
  };
  const bad = [];
  for (const e of b.entries) {
    const ln = linesOf(e.rel)[e.line - 1] || '';
    if (!ln.includes(e.name)) bad.push(`${e.rel}:${e.line} ${e.cls}.${e.name}`);
  }
  assert.deepEqual(bad.slice(0, 6), [], '账本行号与真源码不一致（行号坐标系或账本陈旧）：' + bad.slice(0, 6).join(' / '));
  for (const e of b.entries) {
    assert.equal(typeof e.classInstantiated, 'boolean', `${e.cls}.${e.name} 缺 classInstantiated 分档标记`);
  }
});

test('E2: 模块面账本只收 config/ 与 phone/ 顶层，且档位只有两个弱档', () => {
  const b = JSON.parse(fs.readFileSync(D_BASE, 'utf8'));
  assert.equal(b.schema, 'dead-module-baseline@1');
  for (const e of b.entries) {
    assert.match(e.rel, /^(config|phone)\/[^/]+\.js$/, '账本只该收顶层模块：' + e.rel);
    assert.ok(['orchestrator-only', 'zero'].includes(e.tier), '弱档只能是这两档：' + e.tier);
  }
  const tally = b.entries.reduce((a, e) => (a[e.tier] = (a[e.tier] || 0) + 1, a), {});
  assert.equal(tally['orchestrator-only'] + tally.zero, b.entries.length, '档位计数必须自洽');
});

test('E3: 真仓零新增（门禁 rc=0）且读数与账本一致', () => {
  const r = runAudit();
  assert.equal(r.status, 0, '真仓必须 rc=0；stderr：' + r.stderr.slice(0, 800));
  const mb = JSON.parse(fs.readFileSync(M_BASE, 'utf8')).entries.length;
  const db = JSON.parse(fs.readFileSync(D_BASE, 'utf8')).entries.length;
  assert.match(r.stdout, new RegExp('死方法 \\d+（.*）/ 基线 ' + mb + ' / 新增 0'), '方法面读数与账本不符：' + r.stdout);
  assert.match(r.stdout, new RegExp('弱档 \\d+ / 基线 ' + db + ' / 新增 0'), '模块面读数与账本不符：' + r.stdout);
});

/* ══════════════════════════════════════════════════════════════
 * F 探测器自证 —— 真源码破坏 / 塌陷 / 接线
 * ══════════════════════════════════════════════════════════════ */
test('F1: 真类里加一个全仓无人调的方法 ⇒ rc=1 且点名（类名.方法名）', () => {
  const target = rel('apps/archive/archive-app.js');
  const backup = fs.readFileSync(target, 'utf8');
  const ANCHOR = '    canonSlot() {';
  const hits = backup.split(ANCHOR).length - 1;
  assert.equal(hits, 1, '破坏点锚点必须在真源码里恰出现 1 次（实得 ' + hits + '）');
  const PROBE = 'zpO2ProbeMethod';
  try {
    fs.writeFileSync(target, backup.replace(ANCHOR, `    ${PROBE}() { return 1; }\n${ANCHOR}`));
    const r = runAudit();
    assert.equal(r.status, 1, '新增死方法必须让门禁 rc=1');
    assert.ok(r.stderr.includes(PROBE), '必须点名探测方法，而不是只说「有新增」');
    assert.match(r.stderr, new RegExp('ArchiveApp\\.' + PROBE), '报告必须带「类名.方法名」定位');
  } finally {
    fs.writeFileSync(target, backup);
  }
  assert.equal(fs.readFileSync(target, 'utf8'), backup, '还原必须逐字节一致（无残留）');
  assert.equal(runAudit().status, 0, '还原后必须复绿');
});

test('F2: 新建一件零 import 的 config 模块 ⇒ rc=1 且标 zero 档', () => {
  const probe = rel('config/zp-o2-probe-orphan.js');
  try {
    fs.writeFileSync(probe, 'export function zpO2OrphanProbe() { return 1; }\n');
    const r = runAudit();
    assert.equal(r.status, 1, '新增零 import 模块必须让门禁 rc=1');
    assert.ok(r.stderr.includes('config/zp-o2-probe-orphan.js'), '必须点名该孤儿模块');
    assert.match(r.stderr, /\[zero\]/, '必须标注档位，而不是只报文件名');
  } finally {
    fs.rmSync(probe, { force: true });
  }
  assert.equal(runAudit().status, 0, '删除后必须复绿');
});

test('F3: 空扫描面 ⇒ exit 2（--fixture 也不豁免）', () => {
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'mempty-'));
  try {
    const r1 = runAudit(['--root', empty]);
    assert.equal(r1.status, 2, '空面必须 fail-closed（0 文件还判绿是探测器失效的经典通道）');
    assert.match(r1.stderr, /扫描面|塌陷/, '必须说明塌陷原因');
    const r2 = runAudit(['--root', empty, '--fixture']);
    assert.equal(r2.status, 2,
      '★ 首版把 --fixture 写成整体绕过下限检查，N3 实测 rc=0 —— 合成夹具可以小，但不可能「零文件还判绿」');
  } finally {
    fs.rmSync(empty, { recursive: true, force: true });
  }
});

test('F4: --fixture 允许小扫描面，且夹具模式不得拿本仓基线去对夹具', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mfix-'));
  try {
    fs.mkdirSync(path.join(dir, 'config'));
    /* 类体必须**多行**：方法枚举按行首匹配（`(^|\n)[ \t]*name(`），
     *   `export class Tt { m() {} }` 这种单行类体的方法不进枚举面 —— 本版实测踩到，
     *   已作为已知边界写进 scripts/lib/dead-surface.mjs 头注释（方向是漏报，不出假红）。 */
    fs.writeFileSync(path.join(dir, 'config/t.js'), 'export class Tt {\n    orphan() {}\n}\n');
    const r = runAudit(['--root', dir, '--fixture']);
    assert.equal(r.status, 0, '显式 --fixture 时才允许小于下限的扫描面；stderr：' + r.stderr.slice(0, 400));
    /* ★ 本版自己抓到的缺陷（F4 首跑命中）：夹具模式下曾照样读本仓基线 ——
     *   332 条基线在合成树上一条都不存在 ⇒ 全被判「已复活」，一次刷 332 条假告警。
     *   判据：夹具输出里不许出现「已被重新消费」这类基线比对面的话。 */
    assert.ok(!/已被重新消费|建议 --update 清理/.test(r.stderr + r.stdout),
      '夹具模式不得做基线比对（否则 332 条基线全判假复活）');
    assert.match(r.stdout, /死方法 1（/, '夹具里那一条孤立方法应如实算出；实际输出：' + r.stdout);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('F4b: 夹具模式禁止 --update（拿合成读数覆盖本仓账本 ⇒ exit 2）', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mfixu-'));
  const before = fs.readFileSync(M_BASE, 'utf8');
  try {
    fs.mkdirSync(path.join(dir, 'config'));
    fs.writeFileSync(path.join(dir, 'config/t.js'), 'export class Tt { m() {} }\n');
    const r = runAudit(['--root', dir, '--fixture', '--update']);
    assert.equal(r.status, 2, '夹具模式带 --update 必须拒绝（一次 --root 指错就把存量账本洗掉）');
    assert.equal(fs.readFileSync(M_BASE, 'utf8'), before, '本仓账本必须逐字节未变');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('F5: check 链已接入方法级门禁，且位置在绑定级之后', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.ok(pkg.scripts['method-consuming'], 'package.json 必须有 method-consuming 脚本');
  assert.match(pkg.scripts.check, /method-consuming/, 'npm run check 必须跑到 method-consuming');
  const chain = pkg.scripts.check.split('&&').map((s) => s.trim());
  const bi = chain.indexOf('npm run bind-consuming');
  const mi = chain.indexOf('npm run method-consuming');
  assert.ok(bi >= 0 && mi >= 0, '两门都必须在链上');
  assert.ok(mi === bi + 1, '方法级应紧跟绑定级（判定单位由粗到细的自然递进），实得 bind=' + bi + ' method=' + mi);
  assert.equal(chain[chain.length - 1], 'npm run upstream-face', '链尾 upstream-face 是不变量');
});

/* ★ 交棒改写（v4.95.0）：本档原本把当版读数钉成等值锚（`assert.equal(pkg, BORN_V)`），
 *   抬版即红 —— 那是抬版仪式不是缺陷。按仓内既定先例（v4930 的 F6 同款改法）改成下限形：
 *   只判「五源一致 + 不低于诞生版」，当版落点判定交给 tests/system-v4950.test.mjs。
 *   旧套件守「不许倒退」这一向，新套件守「当版真的到了这一版」。 */
test('F6: 版本五源同源（含状态账本）且不低于诞生版 ' + BORN_V, () => {
  const sem = (v) => String(v).split('.').map(Number).reduce((a, x) => a * 1000 + x, 0);
  const pkg = JSON.parse(read('package.json')).version;
  const man = JSON.parse(read('manifest.json')).version;
  const ul = JSON.parse(read('update-log.json'));
  const led = JSON.parse(read('tests/audit/status-ledger.json'));
  const idxV = /const ST_PHONE_VERSION = '([^']+)'/.exec(read('index.js'))[1];
  assert.equal(new Set([pkg, man, ul.latest, ul.head, led.version, idxV]).size, 1,
    '五源必须一致：' + JSON.stringify({ pkg, man, latest: ul.latest, head: ul.head, led: led.version, idxV }));
  assert.ok(sem(pkg) >= sem(BORN_V), '版本不得低于本档诞生版 ' + BORN_V + '，实得 ' + pkg);
  for (const [k, v] of Object.entries(led.version_sources)) {
    assert.equal(v, pkg, '状态账本 version_sources.' + k + ' 未同源');
  }
});

test('F7: 三处转写同源 —— 预算表 / 分档表 / 文档门链都点名本门', () => {
  const budget = JSON.parse(read('config/gate-budget.json'));
  assert.ok(budget.gates['method-consuming'], 'gate-budget.json 必须补入本门预算（否则耗时只报不告警）');
  const g = budget.gates['method-consuming'];
  assert.ok(g.limit_ms >= g.ms, 'limit_ms 不得小于 ms');
  assert.equal(g.limit_ms, Math.round(g.ms * (1 + budget.margin_pct / 100)),
    'limit_ms 必须由 margin_pct 自算（不许手写另一个数）');
  const sum = Object.values(budget.gates).reduce((a, x) => a + x.ms, 0);
  assert.equal(budget.total_ms, sum, 'total_ms 必须等于各门 ms 之和：' + sum);
  const tiers = JSON.parse(read('config/gate-tiers.json'));
  assert.ok(tiers.tiers.static.commands.includes('npm run method-consuming'), 'gate-tiers 静态档必须列本门');
  const pkg = JSON.parse(read('package.json'));
  const chain = pkg.scripts.check.split('&&').map((s) => s.trim()).filter((s) => s.startsWith('npm run '));
  const staticCmds = tiers.tiers.static.commands;
  /* 静态档必须与链上顺序**同序**（首版插入位错在 bind-consuming 之前，与链序不一致） */
  const chainOrder = chain.filter((c) => staticCmds.includes(c));
  assert.deepEqual(chainOrder, staticCmds.filter((c) => chain.includes(c)),
    'gate-tiers 静态档顺序必须与 check 链同序');
  assert.match(read('CONTEXT.md'), /`method-consuming`/, 'CONTEXT.md 门链转写必须列本门');
});

test('F8: 状态账本现场取数自洽（静态门文件数 / 链长 / 静态门清单）', () => {
  const led = JSON.parse(read('tests/audit/status-ledger.json'));
  const pkg = JSON.parse(read('package.json'));
  const chain = pkg.scripts.check.split('&&').map((s) => s.trim());
  assert.equal(led.gates.check_chain_len, chain.length, '台账链长必须等于现场链长');
  assert.deepEqual(led.gates.check_chain, chain.map((s) => s.replace(/^npm run /, '')),
    '台账链名与顺序必须与 package.json 逐位一致');
  const tiers = JSON.parse(read('config/gate-tiers.json'));
  assert.equal(led.gates.static_gate_files, tiers.tiers.static.commands.length,
    '台账静态门文件数必须等于分档表静态档条目数');
  for (const f of led.gates.static_gate_list) {
    assert.ok(fs.existsSync(rel('scripts/' + f)), '台账登记的静态门文件必须真实存在：scripts/' + f);
  }
  assert.ok(led.gates.static_gate_list.includes('method-consumption-audit.mjs'), '台账必须登记本门文件');
});
