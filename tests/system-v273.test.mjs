/**
 * system-v273.test.mjs — dead-export **E11：default 面的消费通道对账** 正/负控制
 *
 * 背景（v2.73.0 审计动机）：
 *   `UNHANDLED_ALLOWLIST` 放行 `export default` 的书面依据是「无具名成员可对账」。
 *   v2.73.0 实测该依据**只对 76/90 处成立**：另有 26 处带具名成员（多行对象 9 + 单行对象 8
 *   + 裸标识符等），其中 2 个模块的 default 面是**产品端零消费、仅测试经 `.default` 取**：
 *     apps/cheat/cheat-data.js → QUALITY_META / QUALITY_ORDER
 *     apps/dirtytalk/dt-data.js → TIER_META / TIER_ORDER
 *   这正是本仓六次欠债的共同形态（「只有测试引用 = 产品端零消费」），
 *   却因整条 `export default` 被白名单放行而**既不报红灯、也不进账本** = 白名单的边界外覆盖。
 *   注意 TODO 里那条 P0 的立论（「消费形态是 `import M from './m.js'; M.A`，需数据流分析」）
 *   已被实测**证伪**：这 9 处多行 default 对象的 default 导入点为 **0**，消费全走具名 import；
 *   真实形态是测试经 `await import(...)` 后取 `.default.Y`，是个**可静态对账**的东西。
 *
 * 负控制纪律（沿用 v265/v266/v268，三形态假绿必须全部排掉）：
 *   ① 「对原文件断言」（破坏没发生也绿）；② 「破坏写死成模拟常量」；
 *   ③ 「判据自我指涉」（破坏把判据自己删了）。
 *   统一修法：**真源码破坏（锚点恰中 1 次）→ 加载破坏副本 → 在副本上重跑同款真判据**。
 *
 * 两条通道各自证明一件事：
 *   · **夹具通道**（合成最小仓库 + `--root` + 夹具开关）：证明 D2「未登记面报红灯」与
 *     「账本零命中 fail-closed」真会开火——这两个缺陷可以完全在夹具里被构造出来。
 *   · **真仓库只读 + 破坏门禁副本**：证明「账本成员失去依据」会开火（该条靠「账本指向真仓库的
 *     真实模块」定义，无法在夹具里构造：夹具里模块天然不存在 ⇒ 属无从观测，刻意不判）。
 *     ⚠️ 只读是安全边界：**绝不**复制真仓库文件树（v2.65 的 `cp -al` 事故），也**绝不**对真仓库
 *     写任何字节。夹具版本只写进 os.tmpdir()。
 *
 * ⚠️ 夹具里为什么产品模块用**未被消费**的导出（如 FOO/BAR）：
 *   dead-export 的**主语判据**会把「已导出但产品端零消费」判红（exit 1）。本套件只想验证 E11，
 *   故夹具的产品文件只声明**模块内部使用**的符号（顶层 const 不 export）——这样主语判据干净，
 *   E11 的结论就是「同一次运行里唯一可能变的量」。
 *   反例警告：一旦把 FOO/BAR `export` 出去，N1/N2 会因主语判据先红而**无法区分**是谁红的，
 *   这正是「假绿的三形态」在本套件里的镜像（结论不纯）。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEAD = path.join(ROOT, 'scripts', 'dead-export-check.mjs');

/* ---------- 夹具：合成最小仓库（只写 tmpdir） ---------- */
function makeFixture(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v273-'));
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
  return dir;
}
function runFixture(fixDir) {
  try {
    const out = execFileSync(process.execPath, [DEAD, '--root', fixDir],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, RP_DEAD_EXPORT_FIXTURE: '1' } });
    return { code: 0, out };
  } catch (e) {
    return { code: e.status, out: String(e.stdout || '') + String(e.stderr || '') };
  } finally {
    /* 夹具目录用完即删，避免污染 tmpdir */
  }
}
/** 破坏门禁源码副本，对着**真仓库只读**跑 */
function runWithBrokenCopy(breakFn, args = []) {
  const src = fs.readFileSync(DEAD, 'utf8');
  const broken = breakFn(src);
  assert.notEqual(broken, src, '破坏未改变源码（非空转）');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v273b-'));
  const copy = path.join(dir, 'dead-export-check.mjs');
  fs.writeFileSync(copy, broken);
  try {
    const argv = [copy, ...(args.includes('--root') ? args : ['--root', ROOT, ...args])];
    const out = execFileSync(process.execPath, argv,
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { code: 0, out };
  } catch (e) {
    return { code: e.status, out: String(e.stdout || '') + String(e.stderr || '') };
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* 忽略 */ }
  }
}
function runOriginal(args = []) {
  try {
    const out = execFileSync(process.execPath, [DEAD, '--root', ROOT, ...args],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { code: 0, out };
  } catch (e) {
    return { code: e.status, out: String(e.stdout || '') + String(e.stderr || '') };
  }
}
const countOf = (s, sub) => s.split(sub).length - 1;
/** 夹具：产品模块（符号只在模块内部用，不 export ⇒ 主语判据不会额外报红） */
const PROD_MOD = [
  'function Foo() { return 1; }',
  'function Bar() { return Foo() + 1; }',
  'const __keepAlive = Bar();',
  'export default { Foo, Bar };',
].join('\n');

// ══════════════ 正控制：真仓库上 E11 通过，且读数在场 ══════════════
test('v273-P1 真仓库 E11 通过：本仓 6 个访问点 / 仅测试消费面 4 个 / 账本命中 6 次', () => {
  const r = runOriginal();
  assert.equal(r.code, 0, '真仓库应通过\n' + r.out.slice(0, 800));
  assert.match(r.out, /default 面（E11）：\.default 访问点 \d+ 个（本仓 6 \/ 非本仓扫描面 \d+）· 仅测试消费面 4 个 · 账本 4 条（命中 6 次）/,
    'E11 读数行缺席或数字漂移：\n' + r.out.slice(0, 800));
  assert.match(r.out, /\[dead-export\] ✓ 无新增零消费导出/);
});
test('v273-P2 E11 未破坏 E9 枚举面（未识别仍为 0、白名单仍认领 95 处）', () => {
  const r = runOriginal();
  assert.equal(r.code, 0);
  assert.match(r.out, /· 未识别 0/);
  // 90 → 95：v2.99.0 新增 5 文件（config/back-guard · config/source-key-rules · apps/diagnose ×3）各 1 处
  //   `export default`，形态均为「无具名成员可对账」，故白名单认领数同步上浮。
  assert.match(r.out, /无具名成员 95/);
});
test('v273-P3 真仓库 --list 模式仍可用（E11 不拦列表）', () => {
  const r = runOriginal(['--list']);
  assert.equal(r.code, 0, r.out.slice(0, 400));
  assert.match(r.out, /零消费 \d+/);
});
test('v273-P4 诊断面 --e11-dump：真仓库 4 个面逐条 in-scope / 产品通道无 / 成员依据真', () => {
  const r = runOriginal(['--e11-dump']);
  assert.equal(r.code, 0);
  // 明细总数含测试用例里的合成夹具路径（本套件自身），故只锁定「本仓 6 个」这一读数
  const main = runOriginal();
  assert.match(main.out, /（本仓 6 \//);
  // 四个面各出现，且都标为「在扫描面 Y · 产品通道 无 · 成员依据 true」
  for (const [t, mem] of [['system-v247.test.mjs', 'QUALITY_META'], ['system-v247.test.mjs', 'QUALITY_ORDER'],
    ['system-v248.test.mjs', 'TIER_META'], ['system-v248.test.mjs', 'TIER_ORDER']]) {
    assert.ok(r.out.includes(t) && r.out.includes(`default.${mem}`), '明细缺席：' + t + ' ' + mem);
  }
  assert.match(r.out, /在扫描面 Y · 产品通道 无 · 成员依据 true/);
});

// ══════════════ 负控制 A：D2「仅测试消费的 default 面未登记」必须开火 ══════════════
test('v273-N1 夹具：未登记的仅测试消费面 → exit 1 且点名 FOO', () => {
  const dir = makeFixture({
    'apps/x/m.js': PROD_MOD,
    'tests/use.test.mjs': "const X = await import('../apps/x/m.js');\nconsole.log(X.default.Foo);\n",
  });
  try {
    const r = runFixture(dir);
    assert.equal(r.code, 1, '应报红灯（exit 1），实测 ' + r.code + '\n' + r.out.slice(0, 600));
    assert.match(r.out, /仅测试消费的 default 面」未登记/);
    assert.match(r.out, /apps\/x\/m\.js::Foo/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
test('v273-N2 判据纯度：产品侧有 default 导入时同一形态不报（通道存在即不属「仅测试消费」）', () => {
  const dir = makeFixture({
    'apps/x/m.js': PROD_MOD,
    'apps/x/use.js': "import X from './m.js';\nconsole.log(X.Foo());\n",
    'tests/use.test.mjs': "const X = await import('../apps/x/m.js');\nconsole.log(X.default.Foo);\n",
  });
  try {
    const r = runFixture(dir);
    assert.equal(r.code, 0, '产品侧有通道时不应报红灯：\n' + r.out.slice(0, 600));
    assert.match(r.out, /仅测试消费面 0 个/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// ══════════════ 负控制 B：账本零命中必须 fail-closed（exit 2） ══════════════
test('v273-N3 夹具：账本条目所指模块存在但零访问 → fail-closed exit 2（幽灵放行条）', () => {
  const dir = makeFixture({
    // 模块在场（可观测），但没有测试经 .default 取它 ⇒ 账本条目成幽灵放行条
    'apps/cheat/cheat-data.js': 'function A() { return 1; }\nexport default { A };\n',
    'tests/empty.test.mjs': 'const x = 1;\nconsole.log(x);\n',
  });
  try {
    const r = runFixture(dir);
    assert.equal(r.code, 2, '应 fail-closed（exit 2），实测 ' + r.code + '\n' + r.out.slice(0, 700));
    assert.match(r.out, /default 面账本校验失败/);
    assert.match(r.out, /apps\/cheat\/cheat-data\.js::QUALITY_META/);
    assert.match(r.out, /零命中/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// ══════════════ 负控制 C：账本成员失去依据必须 fail-closed（真仓库只读 + 破坏副本） ══════════════
test('v273-N4 真仓库只读：账本条目被改成无人访问的名字 → exit 2（零命中分支）', () => {
  // 把账本里的一条成员名改成一个没人访问的名字：该条目从此零命中 ⇒ 走「零命中」分支。
  // 这条与 N4b（成员依据分支）分工覆盖同一个校验的两条归因。
  const r = runWithBrokenCopy((src) => {
    const anchor = 'const TEST_ONLY_DEFAULT_LEDGER = [';
    assert.equal(countOf(src, anchor), 1, '锚点应恰中 1 次');
    return src.replace(anchor, anchor +
      "\n  { module: 'apps/cheat/cheat-data.js', member: 'QUALITY_META_GONE', reason: 'negctl' },");
  });
  assert.equal(r.code, 2, '应 fail-closed（exit 2），实测 ' + r.code + '\n' + r.out.slice(0, 700));
  assert.match(r.out, /default 面账本校验失败/);
  assert.match(r.out, /apps\/cheat\/cheat-data\.js::QUALITY_META_GONE/);
  assert.match(r.out, /零命中/);
  assert.doesNotMatch(r.out, /已找不到依据/, '该条目无人访问，应走「零命中」分支');
});
test('v273-N5 原版对照：同一次运行里该判据不响（破坏才响 ⇒ 非恒响）', () => {
  const r = runOriginal();
  assert.equal(r.code, 0);
  assert.doesNotMatch(r.out, /default 面账本校验失败/);
});
test('v273-N4b 真仓库只读：成员依据判定恒假 → 四条账本条目全部被判腐坏（该分支可达且生效）', () => {
  // 让「成员依据」判定恒假：四条账本成员的依据全部消失 ⇒ 必须 exit 2 且点名。
  // 这条证明「成员依据」是一条**可达且会决定结果**的分支（不是写在那里好看的死判据）。
  const r = runWithBrokenCopy((src) => {
    const anchor = 'function strictMemberBacked(moduleRel, member) {';
    assert.equal(countOf(src, anchor), 1, '锚点应恰中 1 次');
    return src.replace(anchor, anchor + '\n  return false;   // negctl：恒假');
  });
  assert.equal(r.code, 2, '应 fail-closed（exit 2），实测 ' + r.code + '\n' + r.out.slice(0, 700));
  assert.match(r.out, /default 面账本校验失败/);
  assert.match(r.out, /apps\/cheat\/cheat-data\.js::QUALITY_META/);
  assert.match(r.out, /apps\/dirtytalk\/dt-data\.js::TIER_ORDER/);
  assert.match(r.out, /已找不到依据/);
});

// ══════════════ 结构锁：E11 的面与账本不许静默消失 ══════════════
test('v273-S1 源码结构锁：E11 段、账本（恰 1 处）、判据输出串、四条账本条目俱在', () => {
  const src = fs.readFileSync(DEAD, 'utf8');
  assert.match(src, /E11：default 面的消费通道对账（v2\.73\.0）/);
  assert.equal(countOf(src, 'const TEST_ONLY_DEFAULT_LEDGER = ['), 1, '账本声明应恰 1 处');
  for (const s of ['default 面账本校验失败', '仅测试消费的 default 面」未登记']) {
    assert.ok(src.includes(s), '判据输出串缺席：' + s);
  }
  for (const [m, mem] of [['apps/cheat/cheat-data.js', 'QUALITY_META'], ['apps/cheat/cheat-data.js', 'QUALITY_ORDER'],
    ['apps/dirtytalk/dt-data.js', 'TIER_META'], ['apps/dirtytalk/dt-data.js', 'TIER_ORDER']]) {
    assert.ok(src.includes(`module: '${m}', member: '${mem}'`), '账本条目缺席：' + m + '::' + mem);
  }
  // strictMemberBacked 必须存在且**不得**含「default 对象成员」依据（自我指涉）
  assert.match(src, /function strictMemberBacked\(moduleRel, member\) \{/);
  const body = src.slice(src.indexOf('function strictMemberBacked(moduleRel, member) {'));
  const cut = body.slice(0, body.indexOf('\n}'));
  assert.equal(cut.includes('defaultObjectMembers'), false,
    'strictMemberBacked 不得以 default 对象成员为依据（自我指涉 ⇒ 账本腐坏抓不到）');
});
test('v273-S2 死判据守卫：E11 不得留一条不起决定作用的独立「访问点无依据」判据', () => {
  const src = fs.readFileSync(DEAD, 'utf8');
  // 该判据的结论总被 D2（未登记）或账本校验（成员依据）先决定 ⇒ 作为独立 fail 分支就是死判据。
  assert.doesNotMatch(src, /default 面访问点无依据/,
    'E11 不应存在独立的「访问点无依据」判据（永不决定结果的死判据）');
});

// ══════════════ 真源码破坏探针：两条核心判据必须真的被调用 ══════════════
test('v273-N6 破坏 hasProdChannel（恒真）→ 仅测试消费面清单塌成 0（证明该判据真在起作用）', () => {
  const r = runWithBrokenCopy((src) => {
    const anchor = 'function hasProdChannel(moduleRel) {';
    assert.equal(countOf(src, anchor), 1, '锚点应恰中 1 次');
    return src.replace(anchor, anchor + '\n  return true;   // negctl：恒真');
  });
  assert.equal(r.code, 0, '恒真后所有面都有「产品通道」⇒ 不报红灯：\n' + r.out.slice(0, 600));
  assert.match(r.out, /仅测试消费面 0 个/);
});
test('v273-N7 破坏 strictMemberBacked（恒真，账本条目从此永远「有依据」）→ 反向证明它在起作用', () => {
  // 恒真 ⇒ 「成员依据」分支永不触发。此时把账本成员改成不存在的名字，**不会**被该分支抓住；
  //   但该条目同时变得零命中 ⇒ 仍被「零命中」分支拦下（这正是两条归因必须同处一个校验的原因）。
  //   故本探针的判据是：恒真后，输出里**不再出现**「已找不到依据」这一归因串。
  const r = runWithBrokenCopy((src) => {
    const anchor = 'function strictMemberBacked(moduleRel, member) {';
    assert.equal(countOf(src, anchor), 1, '锚点应恰中 1 次');
    // 恒真：在函数体首行插入 return true（其余语句不可达）
    return src.replace(anchor, anchor + '\n  return true;   // negctl：恒真');
  });
  assert.equal(r.code, 0, '恒真后账本无问题 ⇒ 通过：\n' + r.out.slice(0, 600));
  assert.doesNotMatch(r.out, /已找不到依据/);
});