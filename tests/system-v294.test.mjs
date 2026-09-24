/**
 * tests/system-v294.test.mjs — 缝合「符号级 JSON 修复器」 [v2.94.0]
 *
 * 素材来源：atonal519/ST-MyriadKnots（千千结）的 src/json-symbol-repair.js。
 * 本仓原有容错只有一句尾逗号正则（`replace(/,\s*([\]}])/g,'$1')`），
 * 模型输出一旦是「缺分隔逗号」或「缺冒号」就整批丢弃 —— 而本仓最贵的形态
 * 正是「不报错、不崩溃，只错数据」。本套件修的是这条缝。
 *
 * 从素材保留的是**机制纪律**，不是代码：
 *   1 严格优先（原样能 parse 就绝不动）
 *   2 只在「说完了」时才修（截断语义下不把半截补成「看起来完整」）
 *   3 必须真的改过才算修复（零改动不冒充成功）
 *   4 重复键不得被「修成看起来没事」（修复路径上直接拒判）
 *   5 不补字段、不猜值、不补嵌套括号（修复不得发明内容）
 *
 * 覆盖：
 *   A 纯函数行为面（含每条纪律的正反两面）
 *   B 接线面：四个消费点真的走这条路径（不是新增死模块）
 *   C 负控制：真源码破坏 → 在副本上重跑同款真判据必须转红
 *   D 版本下限
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const read = (f) => readFileSync(path.join(ROOT, f), 'utf8');
const SRC = read('config/json-symbol-repair.js');
const url = (rel) => 'file://' + path.join(ROOT, rel);
const load = () => import(url('config/json-symbol-repair.js'));

/* ============================================================
 * A. 纯函数行为面
 * ============================================================ */
test('v294 A1. 纪律 1「严格优先」：原样能解析就绝不做任何改动', async () => {
  const { parseJsonTolerant } = await load();
  for (const text of ['{"a":1}', '[1,2,3]', '{"a":{"b":[1,2]}}', '"plain"', '42']) {
    const r = parseJsonTolerant(text);
    assert.equal(r.ok, true, text + ' 应可解析');
    assert.equal(r.repaired, false, text + ' 不得被标记为修复过');
    assert.deepEqual(r.operations, [], text + ' 不得产生任何改动记录');
    assert.equal(r.reason, 'strict', text + ' 理由应为 strict');
  }
});

test('v294 A2. 三类允许的改动：补逗号 / 补冒号 / 删尾逗号（含数组形态）', async () => {
  const { parseJsonTolerant } = await load();
  const cases = [
    ['{"a":1,}', { a: 1 }, 'remove-trailing-comma'],
    ['[1,2,]', [1, 2], 'remove-trailing-comma'],
    ['{"a":1 "b":2}', { a: 1, b: 2 }, 'insert-comma'],
    ['[{"a":1} {"a":2}]', [{ a: 1 }, { a: 2 }], 'insert-comma'],
    ['{"a" 1}', { a: 1 }, 'insert-colon'],
  ];
  for (const [text, want, op] of cases) {
    const r = parseJsonTolerant(text);
    assert.equal(r.ok, true, text + ' 应被修复后解析');
    assert.deepEqual(r.value, want, text + ' 修复结果');
    assert.ok(r.operations.some((o) => o.type === op), text + ' 应记录 ' + op);
  }
});

test('v294 A3. 纪律 2「只在说完了时才修」：截断语义下必须拒判', async () => {
  const { parseJsonTolerant } = await load();
  for (const reason of ['length', 'max_tokens', 'max_output_tokens']) {
    const r = parseJsonTolerant('{"a":1 "b":2}', { finishReason: reason });
    assert.equal(r.ok, false, reason + ' 下不得符号修复');
    assert.equal(r.reason, 'truncated-no-repair');
  }
  // 尾逗号是词法问题，不受此限
  const lexical = parseJsonTolerant('{"a":1,}', { finishReason: 'length' });
  assert.equal(lexical.ok, true, '尾逗号兼容不受截断限制');
});

test('v294 A4. 纪律 3「没改过就不算修复」：不把「本来就好」冒充成功', async () => {
  const { parseJsonTolerant } = await load();
  // 文本里有一个可配平的内层对象，且它本身就合规 —— 这是**提取**，不是修复。
  //   纪律 3 的关键在于：不得因为它旁边有脏东西就把它标成「我修好了」。
  const r = parseJsonTolerant('前缀 {"a":1} 后缀');
  assert.equal(r.ok, true, '应能取出其中的对象');
  assert.equal(r.repaired, false, '这是提取，不是修复');
  assert.equal(r.reason, 'strict', '内层对象本身合规，应按严格路径返回');
  assert.deepEqual(r.operations, [], '未做任何改动就不得留下改动记录');
  // 反例：片段本身也脏 ⇒ 那才是修复，须如实标注
  const dirty = parseJsonTolerant('前缀 {"a":1 "b":2} 后缀');
  assert.equal(dirty.ok, true);
  assert.equal(dirty.repaired, true, '片段本身脏才叫修复');
  assert.equal(dirty.reason, 'symbol-repair');
});

test('v294 A5. 纪律 4「重复键不得被修成看起来没事」：修复路径一律拒判', async () => {
  const { parseJsonTolerant } = await load();
  // 需要修复 + 重复键 ⇒ 拒绝（不返一个「后写的值生效」的结果冒充成功）
  const dup = parseJsonTolerant('{"a":1,"a":2,}');
  assert.equal(dup.ok, false, '带重复键的修复请求必须拒判');
  // 严格路径不加码：那是宿主 JSON.parse 的既定行为
  const strict = parseJsonTolerant('{"a":1,"a":2}');
  assert.equal(strict.ok, true, '严格路径不越权改写调用方原有语义');
  assert.equal(strict.reason, 'strict');
});

test('v294 A6. 括号配平：不把后面的正文吃进来，且尊重字符串里的括号', async () => {
  const { extractFirstJsonSpan } = await load();
  const span = extractFirstJsonSpan('结果：{"a":"}","b":{"c":1}} 完毕');
  assert.equal(span.text, '{"a":"}","b":{"c":1}}', '须按字符串感知配平截取');
  assert.equal(extractFirstJsonSpan('没有 JSON'), null);
  assert.equal(extractFirstJsonSpan('{未闭合'), null);
});

test('v294 A7. 围栏与「唯一缺收尾括号」：能修就修，不唯一就拒判', async () => {
  const { parseJsonTolerant } = await load();
  const fenced = parseJsonTolerant('```json\n{"a":1,}\n```');
  assert.equal(fenced.ok, true, '带围栏的输入应能解析');
  assert.deepEqual(fenced.value, { a: 1 });
  const unique = parseJsonTolerant('{"a":{"b":1}');
  assert.equal(unique.ok, true, '只差一个收尾括号时应收尾');
  assert.deepEqual(unique.value, { a: { b: 1 } }, '须收在**外层**，不得读成内层对象');
  assert.equal(unique.reason, 'unique-close-repair');
  // 只差**两个**收尾括号时不能靠补一个救活：这属于「补内容」，必须拒判
  const twoMissing = parseJsonTolerant('{"a":{"b":1,"c":{"d":2}');
  assert.equal(twoMissing.ok, false, '补一个括号救不活就不得声称修好');
  // 数组形态不享受「唯一收尾」兜底（避免把列表尾当成对象收尾）
  const listTail = parseJsonTolerant('[1,2,3');
  assert.equal(listTail.ok, false, '数组缺收尾不在此兜底范围内');
});
test('v294 A8. 空输入与彻底不可修：一律 fail-closed，不抛', async () => {
  const { parseJsonTolerant } = await load();
  for (const bad of ['', '   ', 'not json at all', '{bad key!}', '{"a": /*c*/ 1}']) {
    const r = parseJsonTolerant(bad);
    assert.equal(r.ok, false, JSON.stringify(bad) + ' 应判失败');
    assert.ok(typeof r.reason === 'string' && r.reason.length > 0, '失败必须给理由');
  }
});

test('v294 A9. 纪律 6「首容器没配平就拒判，不得往后跳读」', async () => {
  const { parseJsonTolerant, extractFirstJsonSpan } = await load();
  // 反例（本条的核心）：被截断的**大**对象。往后跳会命中它内层那个已闭合的小对象，
  //   于是「读到了一个形状合法、内容错位的东西」——本仓最贵的「只错数据」形态。
  const truncatedObject = parseJsonTolerant('[{"a":1}');
  assert.equal(truncatedObject.ok, false, '首容器（数组）未配平 ⇒ 必须拒判');
  const inner = parseJsonTolerant('{"a":{"b":1}');
  assert.equal(inner.reason, 'unique-close-repair', '唯一收尾仍应优先（不得被内层对象抢先）');
  assert.deepEqual(inner.value, { a: { b: 1 } }, '须收在**外层**，不得读成内层对象');
  const deepTruncated = parseJsonTolerant('{"a":{"b":1,"c":{"d":2}');
  assert.equal(deepTruncated.ok, false, '深一层截断同样必须拒判，不得退读内层');
  // 正文里先出现别的方括号不该把对象挡掉（起读点优先对象）
  const prose = extractFirstJsonSpan('[注] 结果：{"a":1}');
  assert.equal(prose && prose.text, '{"a":1}', '起读点须优先 `{`，正文 `[...]` 不拦路');
  // 正例：首个容器完整时照常截取
  assert.equal(extractFirstJsonSpan('{"a":{"b":1}} 尾巴').text, '{"a":{"b":1}}');
});


/* ============================================================
 * B. 接线面：新增模块真的被消费（不是又一座死岛）
 * ============================================================ */
test('v294 B1. 四个消费点全部走容错解析，且旧尾逗号正则不再作为唯一手段', () => {
  const sites = {
    'apps/honey/honey-data.js': /parseJsonTolerant\(/, 
    'apps/health/health-state-bridge.js': /parseJsonTolerant\(/, 
    'apps/phone/phone-view.js': /parseJsonTolerant\(raw\)/,
    'apps/settings/settings-app.js': null,
  };
  for (const [file, re] of Object.entries(sites)) {
    const src = read(file);
    assert.match(src, /from '(\.\.\/\.\.\/config|\/config)\/json-symbol-repair\.js'/,
      file + ' 须引用缝合模块');
    if (re) assert.match(src, re, file + ' 须真的调用容错解析');
  }
  // honey 的旧写法（尾逗号正则 + 直接 JSON.parse）不得再作为唯一容错
  const honey = read('apps/honey/honey-data.js');
  assert.equal(honey.includes("replace(/,\\s*([\\]}])/g, '$1')"), false,
    '蜜语的旧尾逗号正则应已由容错解析取代');
});

test('v294 B2. 接线后行为不变式：合规输入仍走严格路径（不因缝合而多改一个字）', () => {
  const src = read('config/json-symbol-repair.js');
  assert.match(src, /try \{\s*\n\s*return \{ ok: true, value: JSON\.parse\(source\)/, '严格路径须在最前');
  assert.match(src, /reason: 'strict'/, '严格路径须标注理由');
});

/* ============================================================
 * C. 负控制：真源码破坏 → 同款真判据在副本上必须转红
 * ============================================================ */
function stageTree(files) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'v294-tree-'));
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }
  return dir;
}
const replaceOnce = (s, from, to) => {
  const n = s.split(from).length - 1;
  assert.equal(n, 1, `锚点应恰好命中 1 次，实际 ${n}：${String(from).slice(0, 70)}`);
  return s.replace(from, to);
};

/** 真判据（供负控制复用）：三类修复都成立，截断下拒判，且**首容器未配平时不得错读内层** */
export async function repairVerdict(root) {
  const mod = await import('file://' + path.join(root, 'config/json-symbol-repair.js'));
  const { parseJsonTolerant } = mod;
  const comma = parseJsonTolerant('{"a":1 "b":2}');
  const colon = parseJsonTolerant('{"a" 1}');
  const trailing = parseJsonTolerant('{"a":1,}');
  const truncated = parseJsonTolerant('{"a":1 "b":2}', { finishReason: 'length' });
  const strict = parseJsonTolerant('{"a":1}');
  const dup = parseJsonTolerant('{"a":1,"a":2,}');
  // 首容器（数组）被截断：**必须整体拒判**，不得退读内层那个已闭合的小对象。
  //   这是本仓最贵形态的判据：错读出的东西形状合法、不报错，只是内容错位。
  const truncatedHead = parseJsonTolerant('[{"a":1}');
  const innerNotMisread = truncatedHead.ok === false;
  return {
    comma: comma.ok && comma.value.b === 2 && comma.operations.some((o) => o.type === 'insert-comma'),
    colon: colon.ok && colon.value.a === 1,
    trailing: trailing.ok && trailing.value.a === 1,
    truncatedBlocked: truncated.ok === false && truncated.reason === 'truncated-no-repair',
    strictUntouched: strict.ok && strict.repaired === false && strict.reason === 'strict',
    duplicateBlocked: dup.ok === false,
    innerNotMisread,
  };
}

function assertRepair(v, where) {
  assert.equal(v.comma, true, where + ' 缺分隔逗号应被修复');
  assert.equal(v.colon, true, where + ' 缺冒号应被修复');
  assert.equal(v.trailing, true, where + ' 尾逗号应被修复');
  assert.equal(v.truncatedBlocked, true, where + ' 截断语义下必须拒判');
  assert.equal(v.strictUntouched, true, where + ' 严格路径不得乱动');
  assert.equal(v.duplicateBlocked, true, where + ' 重复键不得被修成看起来没事');
  assert.equal(v.innerNotMisread, true, where + ' 首容器未配平时不得退读内层');
}

test('v294 C1. 真仓库：七条一律成立', async () => {
  assertRepair(await repairVerdict(ROOT), '真仓库');
});

test('v294 C2. 负控制：抽掉「截断不修」闸门 → 半截数据被补成「看起来完整」', async () => {
  const broken = replaceOnce(SRC,
    'if (truncated) return fail(\'truncated-no-repair\');',
    '// 闸门被抽掉');
  const dir = stageTree({ 'config/json-symbol-repair.js': broken });
  try {
    const v = await repairVerdict(dir);
    assert.equal(v.comma, true, '其余修复仍应工作（破坏是定向的）');
    assert.equal(v.truncatedBlocked, false, '抽掉闸门后截断输入必然被「修好」（判据转红）');
    let threw = null;
    try { assertRepair(v, '破坏树'); } catch (e) { threw = e; }
    assert.ok(threw, '同款真判据在破坏树上必须抛');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('v294 C3. 负控制：拆掉「首容器未配平即拒判」→ 截断的大对象被错读成内层小对象', async () => {
  // 真源码破坏：把 fail-closed 换成「往后跳」（即缝合前的行为）。
  const broken = replaceOnce(SRC, 'if (!span) return null;', 'if (!span) continue;');
  const dir = stageTree({ 'config/json-symbol-repair.js': broken });
  try {
    const v = await repairVerdict(dir);
    assert.equal(v.comma, true, '其余修复仍应工作（破坏是定向的）');
    assert.equal(v.innerNotMisread, false,
      '往后跳之后，被截断的大对象必然被读成内层小对象（判据转红）');
    let threw = null;
    try { assertRepair(v, '破坏树'); } catch (e) { threw = e; }
    assert.ok(threw, '同款真判据在破坏树上必须抛');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('v294 C4. 负控制：删掉「重复键不得被修成看起来没事」→ 后写值静默吃掉前值', async () => {
  const broken = replaceOnce(SRC,
    'if (duplicateKey) return null;',
    'if (duplicateKey) { /* 纪律 4 被删 */ }');
  const dir = stageTree({ 'config/json-symbol-repair.js': broken });
  try {
    const v = await repairVerdict(dir);
    assert.equal(v.comma, true, '其余修复仍应工作（破坏是定向的）');
    assert.equal(v.duplicateBlocked, false, '删掉纪律 4 后带重复键的修复必然被接受（判据转红）');
    let threw = null;
    try { assertRepair(v, '破坏树'); } catch (e) { threw = e; }
    assert.ok(threw, '同款真判据在破坏树上必须抛');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

/* ============================================================
 * D. 版本下限
 * ============================================================ */
function vnum(v) { return String(v || '').split('.').map((n) => Number.parseInt(n, 10) || 0); }
function atLeast(v, floor) {
  const a = vnum(v), b = vnum(floor);
  for (let i = 0; i < 3; i++) {
    if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) > (b[i] || 0);
  }
  return true;
}
test('v294 D. 版本不低于 2.94.0 且五源同源', () => {
  const log = JSON.parse(read('update-log.json'));
  const manifest = JSON.parse(read('manifest.json'));
  const pkg = JSON.parse(read('package.json'));
  const m = read('index.js').match(/const ST_PHONE_VERSION = '([^']+)'/);
  assert.ok(m, 'ST_PHONE_VERSION 必须存在');
  assert.equal(log.latest, manifest.version);
  assert.equal(manifest.version, pkg.version);
  assert.equal(pkg.version, m[1]);
  assert.equal(atLeast(log.latest, '2.94.0'), true, `版本 ${log.latest} < 2.94.0`);
  const entry = log.versions[log.latest];
  assert.ok(entry && Array.isArray(entry.items) && entry.items.length > 0, '当前版本节须有条目');
});
