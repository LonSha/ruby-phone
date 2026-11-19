/**
 * config/compat-shims.js — 旧 WebView 兼容垫片层 [R26-O1c]
 *
 * 缝自雪穗机（weiguzhi1112.github.io/xuesuiji/）的垫片层：
 * 它给 `structuredClone` / `Promise.allSettled` / `trimStart` 全打 polyfill，逐段包 try/catch，
 * 理由是「旧 WebView 上少一个 API，整块功能直接抛 TypeError，看上去像死机」。
 *
 * 与源实现的**四处有意分歧**（不许照抄）：
 *   ① 只补缺的，绝不覆盖原生。源的垫片是「有就再装一遍」，本模块装之前先探；
 *      覆盖等于冒充 —— 判据用哨兵函数验「原生没被动过」。
 *   ② 装了就不是 ok。垫片能用 ≠ 原生可用：装完的裁定是 `degraded`，
 *      并且 `isShim()` 能逐项回答「这个 API 现在是原生还是垫片」。读数不许冒充。
 *   ③ 垫片必须保真，保不住就抛。源用 JSON 往返糊 `structuredClone`，会悄悄丢
 *      `Date`/`Map`/`Set`/`RegExp` 与循环引用（拿回来是字符串或直接死循环）。
 *      本模块遇到这些形态**直接抛错并点名是哪一样**，绝不返回丢字段的副本。
 *   ④ 垫不了的不伪造。`crypto.getRandomValues` 牵涉真随机质量，垫一个假熵源
 *      比缺了更危险 ⇒ 只登记 `unshimmable` 并让裁定落到 `degraded`，绝不冒充可用。
 *
 * 用法：启动最早处 `installCompatShims()`，把返回的 report 挂到诊断面；
 * 判定面读 `compatShimText(report)` 一行文案，复验面读 `isShim(id)`。
 */

/** 可垫 API 闭集（唯一真源：安装、报告、自检都读这里）。 */
export const SHIM_IDS = ['structuredClone', 'allSettled', 'arrayAt', 'objectHasOwn', 'findLast'];

/** 不可垫 API（只登记现况，永不伪造）。 */
const UNSHIMMABLE_IDS = ['cryptoRandom'];

/** 垫片函数统一打这个标记，`isShim` 与判据都靠它分辨原生/垫片。 */
const SHIM_TAG = '__rubyCompatShim';

function markShim(fn, id) {
  try {
    fn[SHIM_TAG] = id;
  } catch (_e) { /* 冻结函数打不上标记：isShim 会答 false，宁可漏报也不冒充 */ }
  return fn;
}

/* ---------------------------------------------------------------- 垫片实现 */

/**
 * `structuredClone` 垫片：只克隆 JSON 可表达的普通对象 / 数组。
 * 遇到结构化克隆必须保留的东西（日期、映射、集合、正则、二进制、函数、
 * 循环引用、同一对象出现两次）一律**抛错点名**，不退化成丢字段的副本。
 */
function shimStructuredClone(value) {
  const walk = (v, path, seen) => {
    if (v === null) return null;
    const t = typeof v;
    if (t === 'function') throw new Error(`compat-shims: structuredClone 垫片无法保真（函数，路径 ${path || '根'}）`);
    if (t !== 'object') return v;
    if (v instanceof Date) throw new Error(`compat-shims: structuredClone 垫片无法保真（Date，路径 ${path || '根'}）`);
    if (v instanceof RegExp) throw new Error(`compat-shims: structuredClone 垫片无法保真（RegExp，路径 ${path || '根'}）`);
    if (v instanceof Map) throw new Error(`compat-shims: structuredClone 垫片无法保真（Map，路径 ${path || '根'}）`);
    if (v instanceof Set) throw new Error(`compat-shims: structuredClone 垫片无法保真（Set，路径 ${path || '根'}）`);
    if (typeof ArrayBuffer === 'function' && (v instanceof ArrayBuffer || ArrayBuffer.isView(v))) {
      throw new Error(`compat-shims: structuredClone 垫片无法保真（二进制，路径 ${path || '根'}）`);
    }
    if (seen.has(v)) {
      throw new Error(`compat-shims: structuredClone 垫片无法保真（循环引用或共享引用，路径 ${path || '根'}）`);
    }
    seen.add(v);
    const out = Array.isArray(v) ? [] : {};
    for (const key of Object.keys(v)) out[key] = walk(v[key], path ? `${path}.${key}` : key, seen);
    return out;
  };
  return walk(value, '', new Set());
}

/**
 * `Promise.allSettled` 垫片：顺序与输入一致，逐项 `{status, value|reason}`，**永不 reject**
 * （除非入参本身不可迭代 —— 那是要用 reject 说的事）。
 * 只服务「Promise 本体在、allSettled 缺失」的旧引擎，故这里直接用宿主 Promise。
 */
function shimAllSettled(iterable) {
  /* 规范要求入参可迭代：不可迭代必须 reject（TypeError），不许 Array.from 兜成空数组
   * —— 空数组会让调用方以为「零个任务全部成功」，那是静默假绿。 */
  const iterableOk = iterable != null && typeof iterable[Symbol.iterator] === 'function';
  if (!iterableOk) return Promise.reject(new TypeError('compat-shims: Promise.allSettled 需要可迭代入参'));
  return Promise.resolve(iterable).then((items) => {
    const list = Array.from(items);
    return Promise.all(list.map((p) => Promise.resolve(p).then(
      (value) => ({ status: 'fulfilled', value }),
      (reason) => ({ status: 'rejected', reason })
    )));
  });
}

/** `Array.prototype.at` 垫片（负数从尾部数，越界 undefined，字符串也可用）。 */
function shimArrayAt(index) {
  const list = Object(this);
  const len = list.length >>> 0;
  const raw = index === undefined ? 0 : Number(index);
  if (Number.isNaN(raw)) return list[0];
  const k = raw < 0 ? Math.ceil(raw) : Math.floor(raw);
  const i = k < 0 ? len + k : k;
  if (i < 0 || i >= len) return undefined;
  return list[i];
}

/** `Array.prototype.findLast` 垫片（从尾往前，找不到 undefined）。 */
function shimFindLast(predicate, thisArg) {
  const list = Object(this);
  const len = list.length >>> 0;
  for (let i = len - 1; i >= 0; i -= 1) {
    if (predicate.call(thisArg, list[i], i, list)) return list[i];
  }
  return undefined;
}

/** `Object.hasOwn` 垫片（只看自有键，原型链上的不算）。 */
function shimObjectHasOwn(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

/* ------------------------------------------------- 探测 / 安装 / 报告 / 复验 */

function detect(id, scope) {
  try {
    if (id === 'structuredClone') return typeof scope.structuredClone === 'function';
    if (id === 'allSettled') return typeof (scope.Promise && scope.Promise.allSettled) === 'function';
    if (id === 'arrayAt') return typeof (scope.Array && scope.Array.prototype && scope.Array.prototype.at) === 'function';
    if (id === 'objectHasOwn') return typeof (scope.Object && scope.Object.hasOwn) === 'function';
    if (id === 'findLast') return typeof (scope.Array && scope.Array.prototype && scope.Array.prototype.findLast) === 'function';
    return false;
  } catch (_e) {
    return false;
  }
}

function detectUnshimmable(id, scope) {
  try {
    if (id === 'cryptoRandom') return typeof (scope.crypto && scope.crypto.getRandomValues) === 'function';
    return false;
  } catch (_e) {
    return false;
  }
}

function installOne(id, scope) {
  if (id === 'structuredClone') {
    scope.structuredClone = markShim(shimStructuredClone, id);
    return true;
  }
  if (id === 'allSettled') {
    if (!scope.Promise) return false;
    scope.Promise.allSettled = markShim(shimAllSettled, id);
    return true;
  }
  if (id === 'arrayAt') {
    if (!scope.Array || !scope.Array.prototype) return false;
    scope.Array.prototype.at = markShim(shimArrayAt, id);
    return true;
  }
  if (id === 'objectHasOwn') {
    if (!scope.Object) return false;
    scope.Object.hasOwn = markShim(shimObjectHasOwn, id);
    return true;
  }
  if (id === 'findLast') {
    if (!scope.Array || !scope.Array.prototype) return false;
    scope.Array.prototype.findLast = markShim(shimFindLast, id);
    return true;
  }
  return false;
}

/**
 * 装垫片。已存在的**一律跳过**（不覆盖原生），只补缺的；装不上逐条记 `failed` 不吞。
 * @returns {{state:'ok'|'degraded'|'failed', rows:Array, installed:Array, native:Array,
 *            failed:Array, unshimmable:Array, lines:Array}}
 */
export function installCompatShims(scope = globalThis) {
  const rows = [];
  const installed = [];
  const native = [];
  const failed = [];
  for (const id of SHIM_IDS) {
    const present = detect(id, scope);
    if (present) {
      native.push(id);
      rows.push({ id, was: 'native', installed: false, error: null });
      continue;
    }
    let ok = false;
    let error = null;
    try {
      ok = installOne(id, scope) === true && detect(id, scope) === true;
    } catch (e) {
      error = String((e && e.message) || e);
    }
    if (ok) {
      installed.push(id);
      rows.push({ id, was: 'shimmed', installed: true, error: null });
    } else {
      failed.push({ id, error: error || 'install 未生效' });
      rows.push({ id, was: 'missing', installed: false, error: error || 'install 未生效' });
    }
  }
  const unshimmable = UNSHIMMABLE_IDS.map((id) => ({ id, ok: detectUnshimmable(id, scope) }));
  /* 三态：全原生才是 ok；垫过或垫不了是 degraded（能用但非原生）；装失败是 failed。 */
  let state = 'ok';
  if (failed.length) state = 'failed';
  else if (installed.length || unshimmable.some((u) => !u.ok)) state = 'degraded';
  const lines = rows.map((r) => (
    r.was === 'native' ? `· ${r.id}：原生` :
      r.was === 'shimmed' ? `· ${r.id}：已垫（非原生）` : `· ${r.id}：安装失败（${r.error}）`
  ));
  for (const u of unshimmable) lines.push(`· ${u.id}：${u.ok ? '原生' : '缺失且不可垫（不伪造）'}`);
  return { state, rows, installed, native, failed, unshimmable, lines };
}

/** 装不上时给一份同形状的失败报告：宿主只管调用，不让它在 13000 行里手写状态串。 */
export function failedShimReport(error) {
  return {
    state: 'failed',
    rows: [],
    installed: [],
    native: [],
    unshimmable: [],
    lines: [],
    failed: [{ id: 'installCompatShims', error: String((error && error.message) || error) }],
  };
}

/** 某 API 当前是垫片还是原生（未知 id 抛错，不猜）。 */
export function isShim(id, scope = globalThis) {
  if (!SHIM_IDS.includes(id)) throw new RangeError(`compat-shims: 未知垫片 id（${String(id)}）`);
  try {
    if (id === 'structuredClone') return !!(scope.structuredClone && scope.structuredClone[SHIM_TAG] === id);
    if (id === 'allSettled') return !!(scope.Promise && scope.Promise.allSettled && scope.Promise.allSettled[SHIM_TAG] === id);
    if (id === 'arrayAt') return !!(scope.Array && scope.Array.prototype && scope.Array.prototype.at && scope.Array.prototype.at[SHIM_TAG] === id);
    if (id === 'objectHasOwn') return !!(scope.Object && scope.Object.hasOwn && scope.Object.hasOwn[SHIM_TAG] === id);
    if (id === 'findLast') return !!(scope.Array && scope.Array.prototype && scope.Array.prototype.findLast && scope.Array.prototype.findLast[SHIM_TAG] === id);
    return false;
  } catch (_e) {
    return false;
  }
}

/** 一行裁定文案（诊断卡与日志共用）。没装过就直说没装，不许说 ok。 */
export function compatShimText(report) {
  if (!report || typeof report !== 'object') return '兼容垫片：未安装';
  if (report.state === 'ok') return `兼容垫片：${report.native.length} 项全部原生（无需垫片）`;
  if (report.state === 'failed') {
    const first = (report.failed[0] || {}).id || '?';
    return `兼容垫片：安装失败（${report.failed.length} 项，首条：${first}）`;
  }
  const shimmed = report.installed.length;
  const cannot = report.unshimmable.filter((u) => !u.ok).map((u) => u.id);
  const parts = [];
  if (shimmed) parts.push(`已垫 ${shimmed} 项（${report.installed.join('、')}）`);
  if (cannot.length) parts.push(`${cannot.length} 项缺失且不可垫（${cannot.join('、')}）`);
  return `兼容垫片：降级可用 —— ${parts.join('；') || '未探到缺项'}`;
}

/* ------------------------------------------------------------------ 自检面 */

/** 造一个「旧引擎」面：有 Promise / Array / Object 本体，但没有新 API。 */
function makeLegacyScope() {
  const LegacyArray = function LegacyArray() {};
  LegacyArray.prototype = {};
  const LegacyObject = function LegacyObject() {};
  const LegacyPromise = function LegacyPromise() {};
  return { Array: LegacyArray, Object: LegacyObject, Promise: LegacyPromise, crypto: {} };
}

/** 自检：只验纯逻辑与「不冒充」两条纪律，不碰宿主全局。 */
export function compatShimSelfCheck() {
  const bad = [];

  // 1. 旧引擎面：五项全垫，裁定必须 degraded（垫过就不许自称 ok）
  const legacy = makeLegacyScope();
  const r1 = installCompatShims(legacy);
  if (r1.installed.length !== SHIM_IDS.length) bad.push(`旧引擎面应垫 ${SHIM_IDS.length} 项，实际 ${r1.installed.length}`);
  if (r1.state !== 'degraded') bad.push(`垫过之后应判 degraded，实际 ${r1.state}`);

  // 2. 幂等：第二次装不应再装任何一项
  const r2 = installCompatShims(legacy);
  if (r2.installed.length !== 0) bad.push(`重复安装不应再垫，实际 ${r2.installed.length}`);

  // 3. 不覆盖原生：哨兵函数装完必须还是同一引用
  const sentinel = () => 'native';
  const guarded = { structuredClone: sentinel, Array: makeLegacyScope().Array, Object: makeLegacyScope().Object, Promise: makeLegacyScope().Promise, crypto: {} };
  installCompatShims(guarded);
  if (guarded.structuredClone !== sentinel) bad.push('原生 structuredClone 被垫片覆盖了');
  if (isShim('structuredClone', guarded)) bad.push('原生实现被标成了垫片');

  // 4. 保真：垫片遇到 Date 必须抛，不许静默丢字段
  let threw = false;
  try {
    legacy.structuredClone({ at: new Date(0) });
  } catch (_e) {
    threw = true;
  }
  if (!threw) bad.push('structuredClone 垫片对 Date 未抛错（静默降级）');

  // 5. 不可垫项必须点名，且不许伪造 crypto
  const cannot = r1.unshimmable.filter((u) => !u.ok).map((u) => u.id);
  if (!cannot.includes('cryptoRandom')) bad.push('cryptoRandom 缺失未被登记为不可垫');
  if (typeof legacy.crypto.getRandomValues === 'function') bad.push('不可垫项被伪造了实现');

  // 6. 文案不许在垫过时报 ok
  const text = compatShimText(r1);
  if (text.includes('全部原生')) bad.push('垫过之后文案仍称全部原生');

  return { ok: bad.length === 0, bad, sample: text };
}
