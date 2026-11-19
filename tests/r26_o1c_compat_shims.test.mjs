/**
 * tests/r26_o1c_compat_shims.test.mjs — 旧 WebView 兼容垫片层判据 [R26-O1c]
 *
 * 守的到底是哪几件事（不是「函数能跑」）：
 *   A1 旧引擎面五项全垫，裁定必须 degraded —— 垫过就不许自称 ok
 *   A2 全原生面裁定 ok，且一项都不装 —— 不无病呻吟
 *   A3 isShim 逐项分辨原生/垫片 —— 不冒充；未知 id 抛错，不猜
 *   A4 原生实现不许被覆盖（哨兵函数同一引用）
 *   A5 幂等：装两次，第二次零安装
 *   A6 structuredClone 垫片保真边界：普通对象深拷贝；Date/Map/Set/RegExp/函数/
 *      循环引用/共享引用一律抛错并点名 —— 静默丢字段视为缺陷
 *   A7 allSettled 垫片：顺序与输入一致、三态齐全、永不 reject（入参不可迭代除外）
 *   A8 arrayAt / findLast / objectHasOwn 语义逐条对齐规范
 *   A9 不可垫项（crypto.getRandomValues）点名登记，绝不伪造实现
 *   A10 SHIM_IDS 与产品面新 API 观测表一一对应（闭集守卫，多一条少一条都红）
 *   A11 产品面接线：index.js 早于日志闸安装、结果挂诊断面、自检进总表
 *   N1 破坏副本：Date 守卫改假 → 静默丢 Date（证明 A6 靠的是这段真代码）
 *   N2 破坏副本：跳过原生那一行改假 → 哨兵被覆盖（证明 A4 不是空过）
 *   Z  收尾：本套件不污染宿主全局
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  SHIM_IDS,
  installCompatShims,
  compatShimText,
  isShim,
  compatShimSelfCheck,
} from '../config/compat-shims.js';

const ROOT = path.resolve(new URL('.', import.meta.url).pathname, '..');
const SRC = path.join(ROOT, 'config', 'compat-shims.js');
const SOURCE = fs.readFileSync(SRC, 'utf8');

/** 造「旧引擎面」：有 Promise / Array / Object 本体，但缺全部新 API。 */
function makeLegacyScope() {
  const LegacyArray = function LegacyArray() {};
  LegacyArray.prototype = {};
  const LegacyObject = function LegacyObject() {};
  const LegacyPromise = function LegacyPromise() {};
  return { Array: LegacyArray, Object: LegacyObject, Promise: LegacyPromise, crypto: {} };
}

/** 造「全原生面」：直接引用宿主真实实现（不装任何东西）。 */
function makeNativeScope() {
  return {
    structuredClone: globalThis.structuredClone,
    Array: globalThis.Array,
    Object: globalThis.Object,
    Promise: globalThis.Promise,
    crypto: globalThis.crypto || {},
  };
}

/* ---------------------------------------------------------------- A1 / A2 */

test('A1 旧引擎面：五项全垫，裁定必须是 degraded（不是 ok）', () => {
  const scope = makeLegacyScope();
  const r = installCompatShims(scope);
  assert.deepEqual([...r.installed].sort(), [...SHIM_IDS].sort(), '缺的必须全垫上');
  assert.equal(r.native.length, 0, '旧引擎面不该有原生项');
  assert.deepEqual(r.failed, [], '不该有安装失败');
  assert.equal(r.state, 'degraded', '垫过之后必须判 degraded，判 ok 就是冒充');
  assert.ok(!compatShimText(r).includes('全部原生'), '文案不许在垫过时报全部原生');
});

test('A2 全原生面：裁定 ok，且一项都不装', () => {
  const scope = makeNativeScope();
  const r = installCompatShims(scope);
  assert.deepEqual(r.installed, [], '全原生时不许再装');
  assert.equal(r.state, 'ok', `全原生应判 ok，实际 ${r.state}`);
  assert.equal(r.native.length, SHIM_IDS.length);
  assert.equal(compatShimText(r), `兼容垫片：${SHIM_IDS.length} 项全部原生（无需垫片）`);
});

/* ------------------------------------------------------------- A3 / A4 / A5 */

test('A3 isShim 分辨原生与垫片；未知 id 抛错不猜', () => {
  const legacy = makeLegacyScope();
  installCompatShims(legacy);
  for (const id of SHIM_IDS) {
    assert.equal(isShim(id, legacy), true, `${id} 垫过之后 isShim 必须答 true`);
  }
  const native = makeNativeScope();
  for (const id of SHIM_IDS) {
    assert.equal(isShim(id, native), false, `${id} 原生时 isShim 必须答 false`);
  }
  assert.throws(() => isShim('noSuchShim', native), /未知垫片 id/, '未知 id 必须抛，不许默认 false');
});

test('A4 原生实现不许被覆盖（哨兵同一引用）', () => {
  const sentinel = () => 'native-sentinel';
  const scope = makeLegacyScope();
  scope.structuredClone = sentinel;
  const r = installCompatShims(scope);
  assert.equal(scope.structuredClone, sentinel, '原生 structuredClone 被覆盖了');
  assert.ok(r.native.includes('structuredClone'));
  assert.ok(!r.installed.includes('structuredClone'));
});

test('A5 幂等：装两次，第二次零安装', () => {
  const scope = makeLegacyScope();
  const first = installCompatShims(scope);
  const second = installCompatShims(scope);
  assert.equal(first.installed.length, SHIM_IDS.length);
  assert.deepEqual(second.installed, [], '第二次不该再装任何一项');
  assert.equal(second.failed.length, 0, '幂等装不能报失败');
});

/* ---------------------------------------------------------------------- A6 */

test('A6 structuredClone 垫片：普通对象保真，不可保真的形态一律抛错点名', () => {
  const scope = makeLegacyScope();
  installCompatShims(scope);
  const clone = scope.structuredClone;

  // 普通对象/数组：深拷贝，改副本不影响源
  const src = { a: 1, b: ['x', { c: true }] };
  const copy = clone(src);
  assert.deepEqual(copy, src);
  assert.notEqual(copy, src, '必须是新对象');
  copy.b[1].c = false;
  assert.equal(src.b[1].c, true, '改副本不许影响源');

  // 不可保真的形态：逐条指名
  const cases = [
    ['Date', { at: new Date(0) }, /Date/],
    ['RegExp', { re: /x/ }, /RegExp/],
    ['Map', { m: new Map([['k', 1]]) }, /Map/],
    ['Set', { s: new Set([1]) }, /Set/],
    ['函数', { fn: () => 1 }, /函数/],
    ['二进制', { buf: new Uint8Array([1, 2]) }, /二进制/],
  ];
  for (const [label, value, pattern] of cases) {
    assert.throws(() => clone(value), pattern, `${label} 必须抛错并点名`);
  }

  // 循环引用 / 共享引用：抛错，不许死循环也不许悄悄复制成两份
  const cyc = { name: 'c' };
  cyc.self = cyc;
  assert.throws(() => clone(cyc), /循环引用或共享引用/);
  const shared = { v: 1 };
  assert.throws(() => clone({ x: shared, y: shared }), /共享引用/, '同一对象出现两次会破坏同一性，必须抛');
});

/* ---------------------------------------------------------------------- A7 */

test('A7 allSettled 垫片：顺序一致 / 三态齐全 / 永不 reject', async () => {
  const scope = makeLegacyScope();
  installCompatShims(scope);
  const allSettled = scope.Promise.allSettled;

  const order = [];
  const res = await allSettled([
    Promise.resolve('a'),
    Promise.reject(new Error('b-boom')),
    'c',
  ]);
  assert.equal(res.length, 3, '结果条数必须等于输入条数');
  assert.deepEqual(res.map((r) => r.status), ['fulfilled', 'rejected', 'fulfilled'], '顺序与状态必须与输入一一对应');
  assert.equal(res[0].value, 'a');
  assert.equal(res[2].value, 'c', '非 promise 值也要包成 fulfilled');
  assert.equal(String(res[1].reason.message), 'b-boom');
  order.push(res.length);

  // 入参不可迭代：这是要用 reject 说的事，不许吞成空数组（空数组=假装「零个任务全成功」）
  await assert.rejects(() => allSettled(123), /可迭代/, '不可迭代入参必须 reject');
  await assert.rejects(() => allSettled(undefined), /可迭代/);
  await assert.rejects(() => allSettled({ length: 0 }), /可迭代/, '类数组也不算可迭代');
});

/* ---------------------------------------------------------------------- A8 */

test('A8 arrayAt / findLast / objectHasOwn 语义对齐规范', () => {
  const scope = makeLegacyScope();
  installCompatShims(scope);
  const at = scope.Array.prototype.at;
  const findLast = scope.Array.prototype.findLast;
  const hasOwn = scope.Object.hasOwn;

  assert.equal(at.call(['a', 'b', 'c'], -1), 'c', 'at(-1) 取尾');
  assert.equal(at.call(['a', 'b', 'c'], 0), 'a');
  assert.equal(at.call(['a', 'b', 'c'], 9), undefined, '越界给 undefined');
  assert.equal(at.call(['a', 'b', 'c'], -9), undefined);
  assert.equal(at.call('xyz', -1), 'z', '字符串也要能取');
  assert.equal(at.call([], 0), undefined, '空数组给 undefined');

  const nums = [{ n: 1 }, { n: 2 }, { n: 3 }, { n: 2 }];
  assert.deepEqual(findLast.call(nums, (it) => it.n === 2), { n: 2 }, 'findLast 必须从尾往前找');
  assert.equal(findLast.call(nums, (it) => it.n === 9), undefined, '找不到给 undefined');
  assert.equal(findLast.call([1, 2, 3], (it, i) => i === 0), 1, '索引参数必须传');

  const proto = { inherited: 1 };
  const own = Object.create(proto);
  own.ownKey = 2;
  assert.equal(hasOwn(own, 'ownKey'), true);
  assert.equal(hasOwn(own, 'inherited'), false, '原型链上的键不算自有');
});

/* ---------------------------------------------------------------------- A9 */

test('A9 不可垫项点名登记，绝不伪造实现', () => {
  const scope = makeLegacyScope();
  const r = installCompatShims(scope);
  const row = r.unshimmable.find((u) => u.id === 'cryptoRandom');
  assert.ok(row, 'cryptoRandom 必须在不可垫台账里');
  assert.equal(row.ok, false, '旧引擎面必须报缺失');
  assert.equal(typeof scope.crypto.getRandomValues, 'undefined', '不许给不可垫项伪造实现');
  assert.equal(r.state, 'degraded', '有不可垫缺项时裁定至少 degraded');
  assert.ok(compatShimText(r).includes('不可垫'), '文案必须把不可垫说清楚');
});

/* --------------------------------------------------------------------- A10 */

test('A10 SHIM_IDS 与产品面新 API 观测表一一对应（闭集守卫）', () => {
  /* 观测表：本仓产品面真实用到的、且有旧 WebView 崩点的 API。
   * 表外新增一条 → 红（说明有人又用了没垫的新 API）；
   * 表内某项从 SHIM_IDS 消失 → 红（说明垫片被悄悄撤掉）。 */
  const WATCHED = ['structuredClone', 'allSettled', 'arrayAt', 'objectHasOwn', 'findLast'];
  assert.deepEqual([...SHIM_IDS].sort(), [...WATCHED].sort(), '垫片闭集与观测表必须逐项一致');

  const faces = ['config', 'apps'];
  const hits = {};
  for (const face of faces) {
    const dir = path.join(ROOT, face);
    if (!fs.existsSync(dir)) continue;
    const walk = (d) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) walk(p);
        else if (e.name.endsWith('.js') && p !== SRC) {
          const text = fs.readFileSync(p, 'utf8');
          if (/\bstructuredClone\s*\(/.test(text)) hits.structuredClone = (hits.structuredClone || 0) + 1;
          if (/Promise\.allSettled\s*\(/.test(text)) hits.allSettled = (hits.allSettled || 0) + 1;
          if (/\.at\(\s*-?\d/.test(text)) hits.arrayAt = (hits.arrayAt || 0) + 1;
          if (/Object\.hasOwn\s*\(/.test(text)) hits.objectHasOwn = (hits.objectHasOwn || 0) + 1;
          if (/\.findLast\s*\(/.test(text)) hits.findLast = (hits.findLast || 0) + 1;
        }
      }
    };
    walk(dir);
  }
  assert.ok(Object.keys(hits).length > 0, '产品面应至少命中一类新 API（否则观测表过期）');
  for (const id of Object.keys(hits)) {
    assert.ok(SHIM_IDS.includes(id), `产品面用到 ${id} 但垫片闭集里没有 —— 旧 WebView 会直接抛`);
  }
});

/* --------------------------------------------------------------------- A11 */

test('A11 产品面接线：早于日志闸安装、挂诊断面、自检进总表', () => {
  const indexSrc = fs.readFileSync(path.join(ROOT, 'index.js'), 'utf8');
  assert.ok(
    /import\s*\{[^}]*installCompatShims[^}]*\}\s*from\s*'\.\/config\/compat-shims\.js'/.test(indexSrc),
    'index.js 必须静态导入 installCompatShims'
  );
  const installAt = indexSrc.indexOf('installCompatShims(');
  assert.ok(installAt > 0, 'index.js 必须有安装调用点');
  const logBridgeAt = indexSrc.indexOf('installConsoleBridge(');
  assert.ok(logBridgeAt > 0, '日志闸安装点应在（用于比较先后）');
  assert.ok(installAt < logBridgeAt, '垫片必须在日志闸与后续装配之前装好，否则首屏前的调用无法兜底');
  assert.ok(/VirtualPhone\.compatShims\s*=/.test(indexSrc), '结果必须挂诊断面（否则读数无人可见）');
  assert.ok(/['"]_r26O1c['"]/.test(indexSrc), '自检必须进启动自检总表 _r26O1c');
  assert.ok(/compatShimText\(/.test(indexSrc), '诊断面必须给一行裁定文案');
});

test('A11b 自检自身为绿（产品面同一份逻辑）', () => {
  const r = compatShimSelfCheck();
  assert.deepEqual(r.bad, [], `自检不该有问题：${JSON.stringify(r.bad)}`);
  assert.equal(r.ok, true);
});

/* ------------------------------------------------------------- N1 / N2 负控制 */

/** 把源码按确定性替换落成临时模块再 import（不碰仓库真文件）。 */
async function loadMutant(replacements, tag) {
  let text = SOURCE;
  for (const [from, to] of replacements) {
    assert.ok(text.includes(from), `负控制锚点失效（源码变了要同步改判据）：${from}`);
    text = text.split(from).join(to);
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `rp_compat_${tag}_`));
  const file = path.join(dir, 'compat-shims.js');
  fs.writeFileSync(file, text, 'utf8');
  return import(pathToFileURL(file).href + `?t=${Date.now()}`);
}

test('N1 负控制：拆掉 Date 守卫 → 垫片静默丢 Date（证明 A6 靠真代码）', async () => {
  const broken = await loadMutant(
    [['if (v instanceof Date) throw', 'if (false && v instanceof Date) throw']],
    'dateguard'
  );
  const scope = makeLegacyScope();
  broken.installCompatShims(scope);
  const out = scope.structuredClone({ at: new Date(0) });
  assert.equal(out.at instanceof Date, false, '守卫被拆后必须不再抛（否则说明守卫不在起作用）');
  assert.deepEqual(out.at, {}, 'JSON 式退化会把 Date 变成空对象 —— 正是要防的静默丢字段');
});

test('N2 负控制：拆掉「跳过原生」→ 哨兵被垫片覆盖（证明 A4 不是空过）', async () => {
  const broken = await loadMutant(
    [['if (present) {', 'if (false && present) {']],
    'skipnative'
  );
  const sentinel = () => 'native-sentinel';
  const scope = makeLegacyScope();
  scope.structuredClone = sentinel;
  broken.installCompatShims(scope);
  assert.notEqual(scope.structuredClone, sentinel, '跳过逻辑被拆后原生必须被覆盖（否则 A4 是空过）');
});

/* ------------------------------------------------------------------------ Z */

test('Z 收尾：本套件不污染宿主全局', () => {
  assert.equal(isShim('structuredClone', globalThis), false, '宿主 structuredClone 必须仍是原生');
  assert.equal(typeof globalThis.structuredClone, 'function');
  const probe = { a: 1 };
  const cloned = globalThis.structuredClone(probe);
  assert.notEqual(cloned, probe);
  assert.deepEqual(cloned, probe);
});
