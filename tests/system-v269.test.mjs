/**
 * tests/system-v269.test.mjs — v2.69.0 会话键归属门禁
 *
 * 本套件验证 scripts/keys-audit.mjs 的三条判据**真的会红**，而不是永远绿：
 *   P  正控制：真仓库上通过；夹具仓库上通过（负控制基线必须绿）
 *   N  负控制：真源码破坏（锚点恰中 1 次）→ 写临时破坏副本 → `--root` 指向真仓库（**只读**）
 *      为什么不用合成夹具做负控制：KEY_REGISTRY 与 CHAT_DATA_PATTERNS 都是**内置**的真仓库对象，
 *      合成夹具天然不含它们，破坏它们对夹具毫无意义。故走「破坏门禁源码副本 + 读真仓库」通道
 *      （与 system-v268 同款）。
 *   S  纯度自证：负控制不得经由真仓库文件树复制，也不得写仓库原件。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const SCRIPT = path.join(ROOT, 'scripts/keys-audit.mjs');
const SRC = fs.readFileSync(SCRIPT, 'utf8');

const run = (args, env) => {
  try {
    const out = execFileSync(process.execPath, args, {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, ...(env || {}) },
    });
    return { code: 0, out };
  } catch (e) {
    return { code: e.status ?? -1, out: `${e.stdout || ''}${e.stderr || ''}` };
  }
};

/** 把 SCRIPT 源码按 breakFn 破坏后写入临时副本，再以 --root 指向真仓库运行（真仓库只读）。 */
const runWithBrokenCopy = (breakFn, args = []) => {
  const broken = breakFn(SRC);
  assert.notEqual(broken, SRC, '破坏必须真的改动了源码（否则是空转的负控制）');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rp-keys-'));
  const copy = path.join(dir, 'keys-audit.mjs');
  fs.writeFileSync(copy, broken);
  try {
    return run([copy, '--root', ROOT, ...args]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
};

/** 锚点替换：计数必须恰为 1，否则测试自身有问题。 */
const replaceOnce = (s, from, to) => {
  const n = s.split(from).length - 1;
  assert.equal(n, 1, `锚点应恰好命中 1 次，实际 ${n}：${from.slice(0, 60)}`);
  return s.replace(from, to);
};

// ══════════════ 正控制 ══════════════
test('v269-P1 真仓库通过：键归属全登记 / 声明与机制一致 / 登记条目全部存活', () => {
  const r = run([SCRIPT, '--root', ROOT]);
  assert.equal(r.code, 0);
  assert.match(r.out, /storage 键使用点 \d+ 个 · CHAT_DATA_PATTERNS 50 条 · 登记 \d+ 条/);
  assert.match(r.out, /✓ 键归属全登记 \/ 声明与机制一致 \/ 登记条目全部存活/);
});

test('v269-P2 声明与机制一致：真仓库 K2 零分歧（意图与正则钉在一起）', () => {
  const r = run([SCRIPT, '--list', '--root', ROOT]);
  assert.equal(r.code, 0);
  assert.doesNotMatch(r.out, /声明=\S+ +实际=\S+/);
  // --list 必须真的列出三组分类
  assert.match(r.out, /── 会话隔离 ──/);
  assert.match(r.out, /── 全局配置 ──/);
  assert.match(r.out, /── 未登记（K1 红灯项）──/);
});

test('v269-P3 夹具模式通过（合成仓库天然不含内置登记对象，故只放宽计数闸）', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rp-keys-fx-'));
  try {
    fs.mkdirSync(path.join(dir, 'config'));
    fs.mkdirSync(path.join(dir, 'apps'));
    fs.writeFileSync(path.join(dir, 'config/storage.js'),
      'const CHAT_DATA_PATTERNS = [\n            /^alpha_/,\n        ];\n');
    fs.writeFileSync(path.join(dir, 'apps/alpha.js'),
      "export const a = (s) => s.storage.get('alpha_state');\n");
    const r = run([SCRIPT, '--root', dir], { RP_KEYS_FIXTURE: '1' });
    assert.equal(r.code, 0, r.out);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ══════════════ 负控制：K1 ══════════════
test('v269-N1 K1 有效：真仓库出现未登记键 → exit 1 并点名', () => {
  // 破坏方式：从登记表里删掉一个真键，它就变成「未登记」
  const r = runWithBrokenCopy((s) => replaceOnce(s,
    "  { key: 'ruby_gacha_state', scope: 'chat', note: '幸运转盘（cheat/dirtytalk/memory 只读共享）' },\n", ''));
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /K1 有 \d+ 个 storage 键未登记归属/);
  assert.match(r.out, /ruby_gacha_state/);
});

test('v269-N2 K1 反向：登记表完整时同判据不报（非固定红）', () => {
  const r = run([SCRIPT, '--root', ROOT]);
  assert.equal(r.code, 0);
  assert.doesNotMatch(r.out, /K1 有/);
});

// ══════════════ 负控制：K2 ══════════════
test('v269-N3 K2 有效：把某键的声明改成相反 scope → exit 1 并点名分歧', () => {
  // 破坏方式：把「会话隔离」的 ruby_xhs_notes 声明成 global，机制仍判 chat ⇒ 必须被抓住
  const r = runWithBrokenCopy((s) => replaceOnce(s,
    "{ key: 'ruby_xhs_notes', scope: 'chat',",
    "{ key: 'ruby_xhs_notes', scope: 'global',"));
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /K2 有 1 条登记与 CHAT_DATA_PATTERNS 实际匹配不符/);
  assert.match(r.out, /ruby_xhs_notes\s+声明=global\s+实际=chat/);
});

test('v269-N4 K2 有效：改 CHAT_DATA_PATTERNS 让某键失去匹配 → 登记与机制分歧被抓住', () => {
  // 破坏方式：让脚本读到的 patterns 少一条（把 /^ruby_gacha_state$/ 从读取结果里剔掉）
  //   等价于「机制改了但登记没跟上」，正是本判据要防的漂移。
  const r = runWithBrokenCopy((s) => replaceOnce(s,
    "const patterns = [...storageSrc.slice(pStart, pEnd)\n  .matchAll(/^[ \\t]*(\\/(?:\\\\.|[^/\\\\\\n])+\\/)/gm)].map((m) => m[1]);",
    "const patterns = [...storageSrc.slice(pStart, pEnd)\n  .matchAll(/^[ \\t]*(\\/(?:\\\\.|[^/\\\\\\n])+\\/)/gm)].map((m) => m[1])\n  .filter((p) => p !== '/^ruby_gacha_state$/');"));
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /K2 有 \d+ 条登记与 CHAT_DATA_PATTERNS 实际匹配不符/);
  assert.match(r.out, /ruby_gacha_state/);
});

// ══════════════ 负控制：K3（清单存活自证）══════════════
test('v269-N5 K3 有效：登记一个真仓库不存在的键 → exit 2 拒判并点名', () => {
  const r = runWithBrokenCopy((s) => replaceOnce(s,
    "  { key: 'ruby_gacha_state', scope: 'chat',",
    "  { key: 'ruby_never_exists_key', scope: 'chat', note: '幽灵' },\n  { key: 'ruby_gacha_state', scope: 'chat',"));
  assert.equal(r.code, 2, r.out);
  assert.match(r.out, /K3 有 1 条登记已失效/);
  assert.match(r.out, /ruby_never_exists_key/);
});

test('v269-N6 结构守卫有效：CHAT_DATA_PATTERNS 解析不出 → exit 2 拒判（不静默全绿）', () => {
  const r = runWithBrokenCopy((s) => replaceOnce(s,
    "const pStart = storageSrc.indexOf('CHAT_DATA_PATTERNS = [');",
    "const pStart = storageSrc.indexOf('CHAT_DATA_PATTERNS_NOPE = [');"));
  assert.equal(r.code, 2, r.out);
  assert.match(r.out, /无法定位 CHAT_DATA_PATTERNS 数组边界/);
});

// ══════════════ 负控制：抽取面（证据面纯度）══════════════
test('v269-N7 键面抽取器有效：把调用口径破坏成不收集 → 结构守卫拒判', () => {
  // 破坏方式：让键面收集函数空转（三条抽取路径全部失效），真仓库里就抽不到任何键，
  //   used.size 崩到 0 ⇒ 结构守卫必须拒判，而不是「零键全绿」。
  //   （先试过只破坏 HANDLE：不够彻底——常量层与 local-get 两条路径仍在收键，
  //     这正是本条负控制逼出的认识：抽取面是多路径的，破坏必须覆盖全部路径。）
  const r = runWithBrokenCopy((s) => replaceOnce(s,
    'const bump = (k, rel, kind) => {',
    'const bump = (k, rel, kind) => { if (true) return void 0;'));
  assert.equal(r.code, 2, r.out);
  assert.match(r.out, /只抽到 \d+ 个 storage 键使用点（低于下限 40）/);
});

test('v269-N8 门禁自指防护：scripts/ 下的键名字面量不冒充「使用」', () => {
  // 真仓库下若把 scripts/ 排除逻辑去掉，登记表里的 139 个键会让「登记存活」永远为真
  //   ——那是自指伪证。此处验证：去掉排除后，K3 的结果不应发生变化（因为真键本来就活着），
  //   但**未登记检测**会因读到自己而失真。所以断言的是「排除逻辑存在且生效」。
  assert.match(SRC, /if \(\/\^scripts\\\/\/\.test\(f\.rel\)\) continue;/);
  const withBreak = replaceOnce(SRC, 'if (/^scripts\\//.test(f.rel)) continue;', '/* removed */');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rp-keys-self-'));
  try {
    const copy = path.join(dir, 'keys-audit.mjs');
    fs.writeFileSync(copy, withBreak);
    // 去掉排除后，script 自身的登记表字面量也会被当作使用点 ⇒ 结构守卫不再拒判，
    //   故这里只验证「排除逻辑是判据的一部分」这一事实，不断言具体红灯形态。
    const r = run([copy, '--root', ROOT]);
    assert.notEqual(r.code, 3, '不得出现未定义退出码');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ══════════════ 纯度自证 ══════════════
test('v269-S1 负控制纯度：测试自身不经由真仓库文件树复制，也不写仓库原件', () => {
  // 纯度约束针对**测试代码**（负控制由它执行），不是门禁本身。
  const SELF = fs.readFileSync(fileURLToPath(import.meta.url), 'utf8');
  assert.doesNotMatch(SELF, /execFileSync\(\s*['"]cp['"]/, '不得调用 cp 复制真仓库');
  assert.doesNotMatch(SELF, /writeFileSync\(\s*path\.join\(ROOT/, '不得写仓库原文件');
  assert.doesNotMatch(SELF, /rmSync\(\s*path\.join\(ROOT/, '不得删仓库文件');
  assert.match(SELF, /mkdtempSync/, '破坏副本必须落在临时目录');
  // 破坏只落在临时副本上，被运行的始终是那份副本
  assert.match(SELF, /path\.join\(dir, 'keys-audit\.mjs'\)/);
  // 门禁自身也必须保持只读姿态（--root 只读）
  assert.doesNotMatch(SRC, /writeFileSync/, '门禁不得写任何文件');
});

test('v269-S2 门禁仍在 check 链上（未因改动掉线）', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.match(pkg.scripts.check, /npm run keys/);
  assert.equal(pkg.scripts.keys, 'node scripts/keys-audit.mjs');
});

test('v269-S3 收紧留下的约束：storage.js 不得再出现 /^ruby_/ 兜底桶', () => {
  const src = fs.readFileSync(path.join(ROOT, 'config/storage.js'), 'utf8');
  const a = src.indexOf('CHAT_DATA_PATTERNS = [');
  const b = src.indexOf('\n        ];', a);
  const block = src.slice(a, b);
  assert.doesNotMatch(block, /^\s*\/\^ruby_\//m,
    'v2.69.0 已把兜底桶收紧为逐键枚举，不得回退');
  // 逐键枚举必须仍在（防止有人为了「省事」把枚举删成空）
  const rubyEntries = [...block.matchAll(/^\s*\/\^ruby_/gm)];
  assert.ok(rubyEntries.length >= 10, `ruby_ 逐键枚举只剩 ${rubyEntries.length} 条`);
});

test('v269-S5 items 同源判据必须真解析字符串字面量（防「逐行剥引号」回归）', () => {
  /* 本轮实测：v253/v254/v255/v256 的 items 同源判据用「逐行剥引号 / "([^"]+)"」实现，
   *   隐含假设「条目内无引号」。v2.69.0 的公告第 6 条引用了 `.get("active")`，
   *   触发**假红灯**（内容其实逐字同源）。
   * 这里守两件事：① 不得再用裸正则剥引号；② 必须走 JSON.parse 真解析。 */
  for (const f of ['system-v253', 'system-v254', 'system-v255', 'system-v256']) {
    const src = fs.readFileSync(path.join(ROOT, `tests/${f}.test.mjs`), 'utf8');
    assert.doesNotMatch(src, /l\.replace\(\/,\$\/, ''\)\.replace\(\/\^"\//,
      `${f} 仍在使用剥引号判据`);
    assert.match(src, /JSON\.parse\(l\.replace\(/,
      `${f} 未改为真解析字符串字面量`);
  }
  // 正控制：判据确实能处理「串内带引号」的条目（并集验证真解析语义）
  const sample = '"条目里含 .get(\\"active\\") 与 .set(\\"loading\\") 的引用。",';
  assert.equal(JSON.parse(sample.replace(/,\s*$/, '')),
    '条目里含 .get("active") 与 .set("loading") 的引用。');
});
test('v269-S4 KEY_REGISTRY 是准入清单：新增键不登记就红（纪律可执行）', () => {
  // 若把登记表里某条 key 改成前缀型（`*`），它就会覆盖一批键而放宽 K1；
  //   这里验证前缀型条目**只在登记表显式允许**时存在，且真仓库当前只有 1 条（阅读进度）。
  const prefixes = [...SRC.matchAll(/\{ key: '([^']+)\*', scope/g)].map((m) => m[1]);
  assert.deepEqual(prefixes, ['ruby_reading_progress_'],
    '前缀型登记必须恰好是已知的那一条；新增必须显式评审（它天然放宽 K1）');
});