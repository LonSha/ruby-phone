// tests/system-v280.test.mjs
// [v2.80.0] 迭代文档不许静默腐坏。
//   本轮实测到两类文档层缺陷（都不是代码错误，但会让人拿错读数）：
//   ① 迭代日志里出现**同一编号两段**（编号是我上一轮撞号的产物）；
//   ② 迭代日志的元信息还声称旧版本号（2.73.0），而仓库已在 2.79.0——
//      文档说谎不报错，跟「数据错但不抛」是同一个病。
//   本套件把这两条变成红灯：日志不得有重号迭代段；元信息声明的版本
//   必须与真实版本一致；release note 里必须写到本版。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8');
const manifest = JSON.parse(read('manifest.json'));
const log = JSON.parse(read('update-log.json'));
const VERSION = String(manifest.version);
const iter = read('ITERATION_LOG.md');

const num = (v) => v.split('.').map(Number).reduce((a, b) => a * 1000 + b, 0);

test('v280 1. 迭代日志不得有重号迭代段（同编号只应存在一段）', () => {
  const heads = iter.split('\n').filter((l) => /^## 迭代 \d+ — /.test(l));
  assert.ok(heads.length >= 5, '迭代日志必须至少有几段（否则探测器失效）：实得 ' + heads.length);
  const nums = heads.map((l) => Number(/^## 迭代 (\d+) — /.exec(l)[1]));
  const dup = nums.filter((n, i) => nums.indexOf(n) !== i);
  assert.deepEqual(dup, [], '同编号迭代段重复：' + dup.join(','));
});

test('v280 2. 迭代日志的元信息必须声明真实版本（文档不得说谎）', () => {
  const m = /- \*\*当前版本\*\*：`([0-9.]+)`/.exec(iter);
  assert.ok(m, '元信息中必须有「当前版本」一行');
  assert.equal(m[1], VERSION, '元信息声明的版本与 manifest 不一致（文档已腐坏）');
});

test('v280 3. release note 必须写到当前版本（不许只在版本号上打架）', () => {
  const items = (log.versions[String(log.latest)] || {}).items || [];
  assert.ok(items.length > 0, '当前版本的 release note 不得为空');
  assert.ok(items.some((it) => String(it).includes(VERSION)),
    '当前版本的 release note 里必须出现 ' + VERSION + '（版本号与说明同源）');
  assert.ok(items.some((it) => /版本升至/.test(String(it))),
    'release note 必须保留「版本升至 X」的收尾条（仓内一贯格式）');
});

test('v280 4. latest 与 versions 首键一致（门禁 D3 的同类约束在此重申）', () => {
  assert.equal(String(log.latest), VERSION);
  assert.equal(String(Object.keys(log.versions)[0]), VERSION);
  assert.equal(num(VERSION) >= num('2.80.0'), true, '本套件需要 2.80.0 及以上，实得 ' + VERSION);
});

test('v280 5. TODO 里的进行中条目不得同时又被当作已完成（状态不许自相矛盾）', () => {
  const todo = read('TODO.md');
  // [~] 是「进行中」。同一个项不得同时出现在 [~] 与 [x] 里。
  const inProg = [...todo.matchAll(/^- \[~\] \*\*([^*]+)\*\*/gm)].map((m) => m[1].trim());
  const done = [...todo.matchAll(/^- \[x\] \*\*([^*]+)\*\*/gm)].map((m) => m[1].trim());
  const both = inProg.filter((t) => done.includes(t));
  assert.deepEqual(both, [], '同一 TODO 项不得既标进行中又标已完成：' + both.join(' | '));
});
