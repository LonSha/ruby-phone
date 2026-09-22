/**
 * system-v268.test.mjs — 准入清单的**存活自证**（dead-export E10 / registry R2b / R3b）
 *
 * 背景（v2.68.0 审计动机）：
 *   本仓三道门里共有三张**硬编码准入清单**：dead-export 的 `UNHANDLED_ALLOWLIST`、
 *   registry 的 `REGEX_WIDE_ALLOWLIST` 与 `CSS_DELIVERY_EXEMPT`。它们此前**只有准入校验**
 *   ——新增条目必须登记，否则红灯——但**没有任何东西检查登记的是否还活着**。
 *   条目所指对象一旦消失（那条宽匹配被删、那个 css 被删），条目就静默退化为「放行条」：
 *   为不存在的情形背书，门禁永远不报警（R2 只看「有没有未登记的」，R3 只扫真实存在的 .css）。
 *
 *   这不是假想，v2.68.0 开发期实测到三处实证：
 *     ① `UNHANDLED_ALLOWLIST` 注释写「全仓 61 处，均在平台入口/单例位」——实测已 **90 处**，
 *        且其中 9 处是多行对象字面量（成员名其实稳定可对账），**注释本身在说谎**。
 *     ② registry 的机制 B 判据用 `txt.includes(cf)`：`index.js` 里那句更新说明散文
 *        （"…apps/games/games.css 是转发壳…"）把**从未被任何 JS 引用**的文件伪装成「已投递」。
 *     ③ 同一判据把 `scripts/` 下门禁**自己的豁免清单字面量**读成「有 JS 引用它」——自指伪证。
 *   ②③ 是 ① 的同类：**证据面混入了非证据**（本仓 E6 / v2.42.0 已立此纪律）。
 *
 * 本套件为上述四道新判据（E10 / R2b / R3b 存活性 + 证据面收紧）做正/负控制。
 *
 * 负控制纪律（沿用 v265/v266，三形态假绿必须全部排掉）：
 *   ① 「对原文件断言」；② 「破坏写死成模拟常量」；③ 「判据自我指涉」。
 *   统一修法：**真源码破坏（锚点恰中 1 次）→ 加载破坏副本 → 在副本上重跑同款真判据**。
 *
 * ⚠️ 为什么这里**不**用合成夹具做 E10/R2b/R3b 的负控制：
 *   这三张清单是**内置的**，按真仓库的固定对象（前缀名 / 文件路径）写成。合成夹具里那些
 *   对象天然不存在 ⇒ 夹具模式下必须跳过存活闸（否则每个夹具仓库都会被判死，见各脚本注释）。
 *   故其负控制只能走「破坏门禁源码副本 + `--root` 指向**真仓库**（只读）」通道——
 *   **只读**是这里的安全边界：绝不复制真仓库文件树（v265 记录的 `cp -al` 事故），
 *   也绝不对真仓库写任何字节。
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
const REG = path.join(ROOT, 'scripts', 'registry-audit.mjs');

/* ---------- 通用：在临时目录里放一份门禁源码的**破坏副本**，对着真仓库跑 ---------- */
function runWithBrokenCopy(srcPath, breakFn, args = []) {
  const src = fs.readFileSync(srcPath, 'utf8');
  const broken = breakFn(src);
  assert.notEqual(broken, src, '破坏未改变源码（非空转）');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v268-'));
  const copy = path.join(dir, path.basename(srcPath));
  fs.writeFileSync(copy, broken);
  try {
    const stdout = execFileSync(process.execPath, [copy, '--root', ROOT, ...args],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { code: 0, out: stdout };
  } catch (e) {
    return { code: e.status, out: String(e.stdout || '') + String(e.stderr || '') };
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* 忽略 */ }
  }
}
/** 原版（未破坏）跑真仓库，作为「同判据在原版上不成立」的对照 */
function runOriginal(srcPath, args = []) {
  try {
    const stdout = execFileSync(process.execPath, [srcPath, '--root', ROOT, ...args],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { code: 0, out: stdout };
  } catch (e) {
    return { code: e.status, out: String(e.stdout || '') + String(e.stderr || '') };
  }
}
const countOf = (s, sub) => s.split(sub).length - 1;

// ══════════════ 正控制：三张清单在真仓库上都通过 ══════════════
test('v268-P1 真仓库 E10：UNHANDLED_ALLOWLIST 存活（export-default 仍被认领 90 处）', () => {
  const r = runOriginal(DEAD);
  assert.equal(r.code, 0, '死导出门禁在真仓库上未通过：' + r.out);
  assert.match(r.out, /无具名成员 90/, '白名单认领数应为 90（注释与实测必须一致）');
  assert.match(r.out, /未识别 0/);
});

test('v268-P2 真仓库 R2b/R3b：宽匹配白名单与样式豁免清单全部存活', () => {
  const r = runOriginal(REG);
  assert.equal(r.code, 0, '注册门禁在真仓库上未通过：' + r.out);
  assert.match(r.out, /两张准入清单存活/);
  assert.match(r.out, /样式投递 30 个/);
});

// ══════════════ 负控制 A：E10 存活性 ══════════════
test('v268-N1 E10 有效：仓库里已无该语法 → 白名单条目零命中，拒判并点名', () => {
  /* 为什么破坏「被守护的对象」而不是改白名单正则：
   *   若把白名单的 re 改成永不匹配，那 90 条 export default 会掉进 **E9 的未识别分支**
   *   （E9 在 E10 之前），报的是「枚举面不完整」——E10 根本轮不到。实测确认过。
   *   E10 真正覆盖的场景是「该语法已从仓库彻底消失，正则却仍正确」：此时 E9 不红（没有语句
   *   会 unhandled），只有「条目零命中」这一路能发现白名单已成幽灵。
   *   故本用例构造一个**只有具名声明、没有 export default** 的 root（不开夹具 ⇒ E10 启用）。 */
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v268-e10-'));
  fs.writeFileSync(path.join(dir, 'a.js'), 'export const onlyNamed = 1;\n');
  try {
    let code = 0, out = '';
    try {
      out = execFileSync(process.execPath, [DEAD, '--root', dir],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) { code = e.status; out = String(e.stdout || '') + String(e.stderr || ''); }
    assert.equal(code, 2, 'E10 未拒判：' + out);
    assert.match(out, /白名单条目存活自证失败/, '未报出存活自证失败');
    assert.match(out, /export-default/, '未点名失效条目');
    // 反证：本 root 里并没有「未识别写法」，所以红灯只可能来自 E10（而非 E9）
    assert.ok(!/枚举面不完整/.test(out), '红灯来源是 E9 而非 E10，用例失去意义');
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* 忽略 */ }
  }
});

test('v268-N2 E10 对照：同判据在原版上不成立（exit 0，非固定红）', () => {
  const r = runOriginal(DEAD);
  assert.equal(r.code, 0, '原版不应红灯：' + r.out);
  assert.ok(!/存活自证失败/.test(r.out), '原版不应报存活自证失败');
});

// ══════════════ 负控制 B：R2b 宽匹配白名单存活 ══════════════
test('v268-N3 R2b 有效：把某条白名单前缀改成不存在的前缀 → exit 2 并点名', () => {
  const ANCHOR = "{ prefix: 'pending[_-]contacts'";
  const r = runWithBrokenCopy(REG, (src) => {
    assert.equal(countOf(src, ANCHOR), 1, '锚点须恰中 1 次');
    return src.replace(ANCHOR, "{ prefix: 'no_such_prefix_ever_xyz'");
  });
  assert.equal(r.code, 2, 'R2b 未拒判：' + r.out);
  assert.match(r.out, /R2b/, '未报出 R2b');
  assert.match(r.out, /no_such_prefix_ever_xyz/, '未点名失效白名单');
});

// ══════════════ 负控制 C：R3b 样式豁免清单存活 ══════════════
test('v268-N4 R3b 有效：豁免条目指向不存在的文件 → exit 2 并点名', () => {
  // 锚点必须取「代码里那一份」而非注释里的同一串字面量（注释也提过它，实测计数为 2）
  const ANCHOR = "  { file: 'apps/games/games.css', why:";
  const r = runWithBrokenCopy(REG, (src) => {
    assert.equal(countOf(src, ANCHOR), 1, '锚点须恰中 1 次（只该命中代码里那一份）');
    return src.replace(ANCHOR, "  { file: 'apps/games/__no_such__.css', why:");
  });
  assert.equal(r.code, 2, 'R3b 未拒判：' + r.out);
  assert.match(r.out, /R3b/, '未报出 R3b');
  assert.match(r.out, /__no_such__\.css/, '未点名不存在的豁免目标');
});

// ══════════════ 负控制 D：证据面收紧（R3 机制 B 不再被散文/自指伪证污染）══════════════
test('v268-N5 R3 机制 B 证据面：门禁自身账本字面量不得冒充投递证据', () => {
  /* 实测形态：`CSS_DELIVERY_EXEMPT` 里的 `'apps/games/games.css'` 字面量曾被判据读成
   *   「有 JS 引用了它」。判据的修法是两面：① 收紧为路径字面量（名前须是路径边界、
   *   名后须接 `?` 或结束）；② 把 `scripts/` 排除出引用面（那里的路径是**描述**不是**引用**）。
   *   本用例守的是第 ② 面：把排除那行拆掉，games.css 会立刻被自己的账本「引用」到，
   *   于是 R3b 的「理由已失效」分支触发 —— 恰是对该缺陷的**可观测复现**。 */
  const ANCHOR = "        if (/^scripts\\//.test(rel)) continue;";
  const r = runWithBrokenCopy(REG, (src) => {
    assert.equal(countOf(src, ANCHOR), 1, '锚点须恰中 1 次');
    return src.replace(ANCHOR, '        /* 排除行被拆掉（负控制） */');
  });
  assert.equal(r.code, 2, '拆掉自指屏蔽后应当拒判：' + r.out);
  assert.match(r.out, /R3b/, '未报出 R3b');
  assert.match(r.out, /games\.css/, '未点名被自指伪证污染的文件');
});

test('v268-N6 R3 机制 B 证据面：散文串里的文件名不得冒充投递证据', () => {
  /* 判据的两面（见 registry-audit 的 cssLiteralRe / jsRefsCss 注释）：
   *   ① 引用必须出现在**字符串/模板字面量**里（不是任意正文）；
   *   ② 该字面量的**内容本身**必须是一条 css 路径（文件名处在路径边界、后接 `?` 或结束）。
   *   本用例拆掉判据第 ② 面（把「路径边界」正则退化成「子串包含」），验证它确实在起效：
   *   退回后 `index.js` 里那句更新说明散文（含 `apps/games/games.css`）会命中，
   *   games.css 被判「已有 JS 引用」→ R3b 的「理由已失效」分支触发 → 拒判。 */
  const ANCHOR = "  const cssLiteralRe = (base) => new RegExp(";
  const r = runWithBrokenCopy(REG, (src) => {
    assert.equal(countOf(src, ANCHOR), 1, '锚点须恰中 1 次');
    // 退化为「子串包含」：任何提到该文件名的字面量都算命中（散文串因此混入证据面）
    return src.replace(ANCHOR, "  const cssLiteralRe = (base) => ({ test: (s) => String(s).includes(base) }); // ");
  });
  assert.equal(r.code, 2, '退回子串包含语义后应当拒判：' + r.out);
  assert.match(r.out, /R3b/, '未暴露散文串污染路径');
  assert.match(r.out, /games\.css/, '未点名被散文串「引用」的文件');
});

// ══════════════ 负控制 E：R3c 样式内本地引用必须存在 ══════════════
test('v268-N7 R3c 有效：样式内引用不存在的目标 → exit 1 并点名（豁免项同样在射程内）', () => {
  /* 用合成夹具（R3c 不依赖内置清单，夹具模式下同样生效）。
   *   构造一个「有投递、但内容指向虚空」的样式文件——这正是被测形态：投递机制判定为绿，
   *   而内容静默 404。 */
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v268-r3c-'));
  fs.mkdirSync(path.join(dir, 'config'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'apps', 'alpha'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'config', 'apps.js'),
    "export const APPS = [\n    {\n        id: 'alpha',\n        name: '甲',\n        icon: '🅰'\n    }\n];\n");
  fs.writeFileSync(path.join(dir, 'index.js'),
    "const CSS_URL = new URL('./apps/alpha/alpha.css?v=1', import.meta.url).href;\n" +
    "const openApp = (appId) => {\n    if (appId === 'alpha') {\n        return 'alpha';\n    }\n};\n");
  fs.writeFileSync(path.join(dir, 'config', 'storage.js'),
    'export class PhoneStorage {\n    constructor() {\n        this.CHAT_DATA_PATTERNS = [\n            /^alpha_/\n        ];\n    }\n}\n');
  fs.writeFileSync(path.join(dir, 'phone.css'),
    '.alpha-box{} .alpha-btn{} .alpha-head{} .alpha-list{} .alpha-foot{}\n');
  // alpha.css 本体正常投递（类前缀族进 phone.css），但内容 @import 一个不存在的目标
  fs.writeFileSync(path.join(dir, 'apps', 'alpha', 'alpha.css'),
    "@import url('./missing-theme.css');\n.alpha-box{}\n.alpha-btn{}\n.alpha-head{}\n.alpha-list{}\n.alpha-foot{}\n");
  try {
    const env = { ...process.env, RP_REGISTRY_FIXTURE: '1' };
    let code = 0, out = '';
    try {
      out = execFileSync(process.execPath, [REG, '--root', dir],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env });
    } catch (e) { code = e.status; out = String(e.stdout || '') + String(e.stderr || ''); }
    assert.equal(code, 1, 'R3c 未报警：' + out);
    assert.match(out, /R3c/, '未报出 R3c');
    assert.match(out, /missing-theme\.css/, '未点名失效引用');
    assert.match(out, /apps\/alpha\/alpha\.css/, '未点出引用来源文件');
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* 忽略 */ }
  }
});

test('v268-N8 R3c 对照：引用目标存在时不报警（同夹具先绿后红）', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v268-r3c2-'));
  fs.mkdirSync(path.join(dir, 'config'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'apps', 'alpha'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'config', 'apps.js'),
    "export const APPS = [\n    {\n        id: 'alpha',\n        name: '甲',\n        icon: '🅰'\n    }\n];\n");
  fs.writeFileSync(path.join(dir, 'index.js'),
    "const CSS_URL = new URL('./apps/alpha/alpha.css?v=1', import.meta.url).href;\n" +
    "const openApp = (appId) => {\n    if (appId === 'alpha') {\n        return 'alpha';\n    }\n};\n");
  fs.writeFileSync(path.join(dir, 'config', 'storage.js'),
    'export class PhoneStorage {\n    constructor() {\n        this.CHAT_DATA_PATTERNS = [\n            /^alpha_/\n        ];\n    }\n}\n');
  fs.writeFileSync(path.join(dir, 'phone.css'),
    '.alpha-box{} .alpha-btn{} .alpha-head{} .alpha-list{} .alpha-foot{}\n');
  fs.writeFileSync(path.join(dir, 'apps', 'alpha', 'alpha.css'),
    ".alpha-box{}\n.alpha-btn{}\n.alpha-head{}\n.alpha-list{}\n.alpha-foot{}\n.alpha-bg{background:url('./bg.png')}\n");
  fs.writeFileSync(path.join(dir, 'apps', 'alpha', 'bg.png'), 'x');
  try {
    const env = { ...process.env, RP_REGISTRY_FIXTURE: '1' };
    let code = 0, out = '';
    try {
      out = execFileSync(process.execPath, [REG, '--root', dir],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env });
    } catch (e) { code = e.status; out = String(e.stdout || '') + String(e.stderr || ''); }
    assert.equal(code, 0, '引用目标存在时不应报警：' + out);
    assert.match(out, /样式内本地引用失效 0/, '计数应为 0');
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* 忽略 */ }
  }
});

// ══════════════ 纯度 / 接线自证 ══════════════
test('v268-S1 负控制纯度：不经由真仓库文件树复制，也不写仓库原件', () => {
  const src = fs.readFileSync(fileURLToPath(import.meta.url), 'utf8');
  assert.ok(!/execFileSync\(\s*'cp'|spawnSync\(\s*'cp'|'cp',\s*\['/.test(src),
    '出现调用 cp 复制文件树（v265 事故形态）');
  assert.ok(!/writeFileSync\(\s*path\.join\(ROOT/.test(src), '出现对仓库原件的写操作');
  assert.ok(!/rmSync\(\s*path\.join\(ROOT/.test(src), '出现对仓库原件的删除操作');
  assert.ok(/fs\.mkdtempSync\(/.test(src), '缺少临时目录（破坏副本无处安放）');
  // 反向断言：破坏副本确实建在 os.tmpdir()，而不是仓库里
  assert.ok(/os\.tmpdir\(\)/.test(src), '破坏副本未落在系统临时目录');
});

test('v268-S2 门禁仍有夹具跳过分支（内置清单不适用于合成仓库）', () => {
  const reg = fs.readFileSync(REG, 'utf8');
  const dead = fs.readFileSync(DEAD, 'utf8');
  assert.match(reg, /FIXTURE_MODE \? \[\]/, 'R2b/R3b 未做夹具跳过，会把每个夹具仓库判死');
  assert.match(dead, /if \(!FIXTURE_MODE\) \{\n  for \(const f of files\) \{/,
    'E10 未嵌在 !FIXTURE_MODE 内');
});

test('v268-S3 三道门仍串在 npm run check 上（未因改动掉线）', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.match(pkg.scripts['check'], /npm run dead-exports/);
  assert.match(pkg.scripts['check'], /npm run registry/);
  assert.match(pkg.scripts['check'], /npm run lifecycle/);
});
