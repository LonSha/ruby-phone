/**
 * tests/r26_x5b_random_migration.test.mjs — R26-X5b 随机源逐点迁移判据
 *
 * 【咬点】X5 只开了强制口，产品面 87 处随机点仍直写 `Math.random()`：
 * 强制源开了也管不到它们，等于「有闸门但水管绕过闸门」。
 *
 * 验收口径（文本替换不算证据，只认行为）：
 *   A1 产品面零残留：config/ + index.js 的非注释行 `Math.random()` 为空；
 *      唯一豁免 config/random-source.js（它就是原生本体的落点）；
 *      注释内残留如实报数，不静默（口径：只认行首注释，行尾注释会转红要人工复核）
 *   A2 每个用了 rand() 的产物文件都真导入了它（不许有未声明的全局 rand）
 *   A3 强制源真作用于被迁点：真 TimeManager 方法在强制 0.1 / 0.9 下给出不同结果
 *   A4 被迁点读到的是真 rand：强制序列耗尽时**抛错**，绝不静默回落原生
 *   A5 index.js 走具名别名调用（rand as rndSource），不是自己再抄一份
 *
 * 负控制（证明 A3/A4 不是空判据）：
 *   N1 time-manager 改回 Math.random ⇒ 强制 0.1/0.9 结果相同（A3 转红）
 *   N2 random-source 的 rand 永远走原生 ⇒ 强制失效（A3 转红）
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resetSource, useSequence, RANDOM_MODE, setSource, activeMode } from '../config/random-source.js';
import { TimeManager } from '../config/time-manager.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const NATIVE_ONLY = 'config/random-source.js';
/**
 * 豁免表（不许匿名豁免：每一条都要写死理由，且判据会核对它真的还只剩那一处）。
 *   - affair-state.js：零 import 纯契约件，v4480-A2 明文禁 import；契约优先于强制口。
 */
const ZERO_IMPORT_EXEMPT = new Map([
  ['config/affair-state.js', '零 import 纯契约件（tests/system-v4480.test.mjs A2）：契约 > 强制口']
]);

function walkJs(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const full = path.join(dir, name);
    const st = fs.statSync(full);
    if (st.isDirectory()) walkJs(full, out);
    else if (name.endsWith('.js')) {
      const rel = path.relative(root, full).split(path.sep).join('/');
      out.push(rel);
    }
  }
  return out;
}

const PRODUCT_FILES = walkJs(path.join(root, 'config')).concat(['index.js']);

function scanRandomCalls() {
  const code = [];
  const comment = [];
  for (const rel of PRODUCT_FILES) {
    const src = fs.readFileSync(path.join(root, rel), 'utf8');
    const lines = src.split('\n');
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      if (!line.includes('Math.random')) continue;
      const isLineComment = /^\s*(\*|\/\/|\/\*)/.test(line);
      const rec = rel + ':' + (i + 1) + ' ' + line.trim().slice(0, 80);
      (isLineComment ? comment : code).push(rec);
    }
  }
  return { code, comment };
}

/** 强制一个值，跑一次真 TimeManager 的步进策略，然后还原。 */
function minutesUnder(value, content) {
  const undo = setSource(() => value, RANDOM_MODE.FORCED);
  try {
    return new TimeManager(null).getWechatMessageMinutesToAdd(content);
  } finally {
    undo();
  }
}

/* ══════════ A1 产品面零残留 ══════════ */
test('A1 非注释行 zero `Math.random()`（唯一豁免 random-source.js）', () => {
  const { code, comment } = scanRandomCalls();
  const exemptKeys = [...ZERO_IMPORT_EXEMPT.keys()];
  const isExempt = (rec) => exemptKeys.some((k) => rec.startsWith(k + ':'));
  const offenders = code.filter((rec) => !rec.startsWith(NATIVE_ONLY + ':') && !isExempt(rec));
  assert.deepEqual(offenders, [], '产品面仍有直写 Math.random 的点（绕过闸门）：\n' + offenders.join('\n'));
  /* 豁免不是免单：每个豁免件必须**恰有 1 处**原生残留（多了 = 有人偷偷绕闸；少了 = 豁免表过期）。 */
  for (const [rel, why] of ZERO_IMPORT_EXEMPT) {
    const n = code.filter((rec) => rec.startsWith(rel + ':')).length;
    assert.equal(n, 1, '豁免件 ' + rel + ' 必须恰有 1 处原生随机（理由：' + why + '），实测 ' + n);
    console.log('[X5b] 豁免 ' + rel + ' —— ' + why);
  }
  // 如实报数：注释里提到它是说明文字，不是调用点
  assert.ok(Array.isArray(comment), '注释面必须可区分');
  console.log('[X5b] 注释内残留 ' + comment.length + ' 处（说明文字，非调用点）');
  for (const rec of comment) console.log('    ' + rec);
});

test('A1b 豁免面自身必须仍是原生本体（默认不许自造伪随机）', () => {
  const src = fs.readFileSync(path.join(root, NATIVE_ONLY), 'utf8');
  assert.ok(/if \(_source === null\) return Math\.random\(\);/.test(src),
    'random-source 的原生分支必须直接返回 Math.random() 本体');
});

/* ══════════ A2 导入完备 ══════════ */
test('A2 每个调用 rand() 的文件都真导入了 random-source', () => {
  const users = [];
  const missing = [];
  for (const rel of PRODUCT_FILES) {
    if (rel === NATIVE_ONLY || rel === 'index.js') continue;
    const src = fs.readFileSync(path.join(root, rel), 'utf8');
    const uses = (src.match(/(^|[^\w.$])rand\(/gm) || []).length;
    if (uses === 0) continue;
    users.push({ rel, uses });
    if (!/from '\.\/random-source\.js'/.test(src)) missing.push(rel + '（' + uses + ' 处）');
  }
  assert.deepEqual(missing, [], '有 rand() 调用但没有导入：\n' + missing.join('\n'));
  const total = users.reduce((s, u) => s + u.uses, 0);
  // index.js 走别名 rndSource()，不落上面的正则，单独读数
  const idxUses = (fs.readFileSync(path.join(root, 'index.js'), 'utf8').match(/rndSource\(\)/g) || []).length;
  console.log('[X5b] 迁移面：' + users.length + ' 个 config 文件 · ' + total + ' 处 rand() + index.js ' + idxUses + ' 处 rndSource()');
  assert.ok(users.length >= 47, '迁移面文件数不该少于 47（实测 ' + users.length + '）');
  assert.ok(total >= 77, 'config 面 rand() 调用点不该少于 77（实测 ' + total + '）');
  assert.ok(idxUses >= 10, 'index.js 的 rndSource() 调用点不该少于 10（实测 ' + idxUses + '）');
});

/* ══════════ A3 强制源真作用于被迁点 ══════════ */
test('A3 真被迁点吃强制源：0.1 与 0.9 给出不同分钟数', () => {
  const short = '嗯';
  const low = minutesUnder(0.1, short);
  const high = minutesUnder(0.9, short);
  assert.equal(low, 0, '强制 0.1 时「很短句」不该推进');
  assert.equal(high, 1, '强制 0.9 时「很短句」应推进 1 分钟');
  assert.notEqual(low, high, '两个强制值给出同一结果 ⇒ 该点没走 rand()');
});

test('A3b 同一强制值可复现（这才是「能复现一次偶发」的意义）', () => {
  const content = '今天下午三点我们在楼下那家咖啡馆见面吧，顺便把资料带上';
  const a = minutesUnder(0.5, content);
  const b = minutesUnder(0.5, content);
  assert.equal(a, b, '同一强制值两次结果必须相同');
});

/* ══════════ A4 序列耗尽必须抛错 ══════════ */
test('A4 被迁点读到真 rand：强制序列耗尽即抛错，不静默回落原生', () => {
  const seq = useSequence([0.9]);
  try {
    const tm = new TimeManager(null);
    assert.equal(tm.getWechatMessageMinutesToAdd('嗯'), 1, '第一个强制值应被吃掉');
    assert.throws(() => tm.getWechatMessageMinutesToAdd('嗯'), /强制序列已耗尽/,
      '第二次必须抛错（静默回落原生 = 假复现）');
  } finally {
    seq.undo();
  }
});

/* ══════════ A5 index.js 走具名别名 ══════════ */
test('A5 index.js 用 rand as rndSource 具名别名，不另抄一份', () => {
  const src = fs.readFileSync(path.join(root, 'index.js'), 'utf8');
  assert.ok(/import \{[^}]*rand as rndSource[^}]*\} from '\.\/config\/random-source\.js'/.test(src),
    'index.js 必须以 rand as rndSource 具名导入');
  const uses = (src.match(/rndSource\(\)/g) || []).length;
  assert.ok(uses >= 10, 'index.js 里 rndSource() 调用点应 ≥10（实测 ' + uses + '）');
  assert.ok(!/Math\.random\(\)/.test(src.replace(/^\s*\*.*$/gm, '')), 'index.js 非注释行不该再有 Math.random()');
});

/* ══════════ 负控制 ══════════ */
/**
 * 隔离加载纪律（同一族问题第三次踩到，写死文件清单必挂）：
 * 复制**依赖图**而不是手写文件列表。time-manager 除 random-source 外还 import world-bridge，
 * 下一次再有人给它加静态依赖，手写清单就会以 ERR_MODULE_NOT_FOUND 假红（那不是判据转红）。
 */
function collectDeps(rel, acc) {
  if (acc.has(rel)) return acc;
  acc.set(rel, true);
  const abs = path.join(root, rel);
  if (!fs.existsSync(abs)) return acc;
  const src = fs.readFileSync(abs, 'utf8');
  const re = /from\s+'(\.\.?\/[^']+)'/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    const target = path.posix.normalize(path.posix.join(path.posix.dirname(rel), m[1]));
    if (target.startsWith('..')) continue; // 仓外依赖不在本判据面
    collectDeps(target, acc);
  }
  return acc;
}

function makeFixture(entryRels, edits) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rp_x5b_'));
  const acc = new Map();
  for (const rel of entryRels) collectDeps(rel, acc);
  for (const rel of acc.keys()) {
    const dst = path.join(dir, rel);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(path.join(root, rel), dst);
  }
  for (const [rel, fn] of Object.entries(edits)) {
    const p = path.join(dir, rel);
    assert.ok(fs.existsSync(p), '破坏目标必须在副本依赖图里：' + rel);
    const before = fs.readFileSync(p, 'utf8');
    const after = fn(before);
    assert.notEqual(after, before, '破坏点必须真的改到（没改到就是假负控制）：' + rel);
    fs.writeFileSync(p, after);
  }
  return dir;
}

async function minutesUnderFrom(dir, value, content) {
  const rsMod = await import(pathToFileURL(path.join(dir, 'config', 'random-source.js')).href);
  const tmMod = await import(pathToFileURL(path.join(dir, 'config', 'time-manager.js')).href);
  const undo = rsMod.setSource(() => value, rsMod.RANDOM_MODE.FORCED);
  try {
    return new tmMod.TimeManager(null).getWechatMessageMinutesToAdd(content);
  } finally {
    undo();
    rsMod.resetSource();
  }
}

/**
 * 负控制的破坏方式刻意用**确定性**的「摘掉随机口」（常量），而不是改回 Math.random：
 * 原生随机会让「两个强制值结果相同」本身变成概率事件 —— 那样的负控制会偶发假绿，
 * 等于没有负控制（本仓纪律：负控制必须能稳定转红）。
 */
test('N1 负控制：调用点不读 rand（常量）⇒ 强制源失效（A3 的 notEqual 必红）', async () => {
  const dir = makeFixture(['config/time-manager.js'], {
    'config/time-manager.js': (s) => s.replace('const rnd = rand();', 'const rnd = 0.1;')
  });
  try {
    const low = await minutesUnderFrom(dir, 0.1, '嗯');
    const high = await minutesUnderFrom(dir, 0.9, '嗯');
    assert.equal(low, 0, '常量 0.1 下「很短句」不推进');
    assert.equal(high, 0, '强制 0.9 也改不动它 ⇒ 该点确实没走 rand()（A3 的 notEqual 会转红）');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('N2 负控制：rand 退化成常量 ⇒ 强制源失效（A3 的 notEqual 必红）', async () => {
  const dir = makeFixture(['config/time-manager.js'], {
    'config/random-source.js': (s) => s.replace('if (_source === null) return Math.random();', 'return 0.1;')
  });
  try {
    const low = await minutesUnderFrom(dir, 0.1, '嗯');
    const high = await minutesUnderFrom(dir, 0.9, '嗯');
    assert.equal(low, 0, 'rand 恒 0.1 时不推进');
    assert.equal(high, 0, '强制值不再起作用 ⇒ A3 的 notEqual 会转红');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

/* 收尾：确保本套件不把随机源留在强制态 */
test('Z 收尾：本套件不残留强制态', () => {
  resetSource();
  assert.equal(activeMode(), RANDOM_MODE.NATIVE, '套件跑完必须回原生，否则会污染同进程的其它套件');
});