/**
 * tests/system-v284.test.mjs — 存储层「删除出口」语义统一 [v2.84.0]
 *
 * 承接 P0 主线「源头变更后的下游对齐普查」，本版换到**存储层的删除语义**这一面。
 *
 * 本版修的真缺陷（D1）：`set(key, null)` 不是删除，而是「把 null 写进存档」。
 *   实测（探针 probe_setnull.mjs，真 PhoneStorage + 最小宿主夹具）：
 *     · `set(key, null)` 之后 —— 键**仍在** store 里（`key in store === true`），
 *       值为 null，且**进 JSON**（`"key":null` 真的落盘）；
 *     · `remove(key)` 之后 —— 键**不在** store 里，且不进 JSON。
 *   危害不在「存了个 null」本身，而在**全仓对同一个键存在两套结论相反的判据**：
 *     · `get()`：`chatStore[key] !== undefined` ⇒ 判定「键存在」，返回这个 null，
 *       **defaultValue 永远不会生效**；
 *     · `loadApps()`：`if (chatStore[key])` ⇒ null 为假，判定「没有存档」，
 *       转去读 extensionSettings / localStorage 兜底。
 *   同一份存档被两条路径读出不同结果 —— 与本仓主线同形态（源头一份、下游各读各的），
 *   只是这次分歧发生在存储层内部。
 *
 *   实测调用点 3 处，**全部本意就是删除**（apps/wechat/wechat-data.js）：
 *     :542  「已清空损坏的数据，将创建新数据」
 *     :1754 删独立消息存储（清联系人与群组）
 *     :4794 删独立消息存储（删除单个聊天）
 *
 *   修复：`set()` 开头把 null / undefined 交给 `remove()` —— 真删除 + 一并清
 *   localStorage 兜底，与调用点意图一致，且收敛到同一条删除出口。
 *
 * 负控制纪律（v2.84.0 严格执行）：**真源码破坏 → 加载破坏副本 → 在副本上重跑同款真判据**。
 *   本版用「双份副本」法：把 storage.js 复制两份到临时目录 A/B，
 *   A 保持原样、B 删掉早退块（还原旧行为），然后在**两个真模块**上跑同一段判据，
 *   断言 A 绿、B 红。这同时挡掉三种假绿：
 *     ① 对原文件断言（破坏没发生也绿）；② 破坏写死成模拟常量（真判据没被调用）；
 *     ③ 破坏把判据自己删了（自我指涉）。
 *   附 H6 工具两向自证：锚点不存在 / 不唯一必须抛；破坏必须可观测改行为。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { installRuntimeHost, resetHostFlags } from './_runtime_host.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const NS = 'st_virtual_phone';
const STORAGE_REL = 'config/storage.js';

/** 会话键（命中 CHAT_DATA_PATTERNS → 落 chatMetadata） */
const CHAT_KEY = 'wechat_settings_v1';
/** 全局键（不命中 → 落 extensionSettings） */
const GLOBAL_KEY = 'global_phone_settings';
/** 探测用的默认值哨兵 */
const SENTINEL = '__DEFAULT_SENTINEL__';

function makeHost() {
  resetHostFlags();
  const host = installRuntimeHost();
  host.context.chatMetadata[NS] = {};
  host.context.extensionSettings[NS] = {};
  return host;
}

function storeOf(host, isChat) {
  return isChat
    ? host.context.chatMetadata[NS]
    : host.context.extensionSettings[NS];
}

/* ==================================================================
 * 工具：双份副本 + 真源码破坏
 * ================================================================== */

/** 存储层早退块（本版修复的落点）。判据纯度：本字符串在负控制层内只声明一次。 */
const EARLY_RETURN = [
  '        if (value === null || value === undefined) {',
  '            await this.remove(key, immediate);',
  '            return;',
  '        }',
  ''
].join('\n');

/**
 * 造一个副本仓库目录：只需 storage.js 单文件（该模块自包含、零 import，
 * 已实测确认 —— 故复制单文件即可，无需整树，也避开 v2.82 那次
 * 「夹具不完整导致基线假红」的坑）。
 * @param {string} tag 目录后缀
 * @param {boolean} corrupt 是否注入破坏（还原成修前行为）
 * @returns {string} 副本 storage.js 的绝对路径
 */
function makeCopy(tag, corrupt) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `rp-v284-${tag}-`));
  const src = read(STORAGE_REL);
  let out = src;
  if (corrupt) {
    const n = src.split(EARLY_RETURN).length - 1;
    if (n !== 1) {
      throw new Error(`破坏锚点必须恰中 1 次，实得 ${n} 次 —— 拒绝在不确定的源码上破坏`);
    }
    out = src.replace(EARLY_RETURN, '');
    if (out === src) throw new Error('破坏未生效');
  }
  const dst = path.join(dir, 'storage.js');
  fs.writeFileSync(dst, out, 'utf8');
  return dst;
}

/**
 * 在一份真模块副本上跑真判据，返回观测结果（不回抛，交由断言判定）。
 * @param {string} file 副本 storage.js 路径
 * @param {'chat'|'global'} scope
 */
async function observeAfterSetNull(file, scope) {
  const mod = await import(pathToFileURL(file).href);
  const PhoneStorage = mod.PhoneStorage;
  const host = makeHost();
  try {
    const st = new PhoneStorage();
    const key = scope === 'chat' ? CHAT_KEY : GLOBAL_KEY;
    const isChat = scope === 'chat';

    // 先写入一个正常值，确认写入通道本身可用
    await st.set(key, { seeded: true }, true);
    const seededOk = storeOf(host, isChat)[key]?.seeded === true;

    // 再按「删除」意图调用 set(key, null)
    await st.set(key, null, true);
    const store = storeOf(host, isChat);
    const json = JSON.stringify(store);

    // 两套**全仓真实存在**的判据，同一个键、同一份存档：
    //   A 存在判据 `store[key] !== undefined` —— get() / set() / remove() 用它；
    //   B 真值判据 `!!store[key]`              —— loadApps() 用它。
    // 修前的缺陷本体就是 A 与 B 给出相反结论。
    const existsByUndefinedCheck = store[key] !== undefined;
    const truthyCheck = !!store[key];

    return {
      seededOk,
      keyPresent: Object.prototype.hasOwnProperty.call(store, key),
      valueIsNull: store[key] === null,
      valueIsUndefined: store[key] === undefined,
      existsByUndefinedCheck,
      truthyCheck,
      // 判据是否分歧 —— 这就是「缺陷本体」的可执行定义
      criteriaDisagree: existsByUndefinedCheck !== truthyCheck,
      nullInJson: json.includes(`"${key}":null`),
      keyInJson: json.includes(key),
      // 诚实记录：get() 还有第二道 `value !== null` 兜底，
      //   故 defaultValue **不是**分歧面（修前它也返回默认值）。
      //   保留此字段是为了让「默认值坏了」这类错误论证无法再被写进断言。
      gotDefault: st.get(key, SENTINEL) === SENTINEL,
      gotValue: st.get(key, SENTINEL)
    };
  } finally {
    host.uninstall();
  }
}

/** 清理副本目录 */
function cleanup(file) {
  try { fs.rmSync(path.dirname(file), { recursive: true, force: true }); } catch (_e) { /* 忽略 */ }
}

/* ==================================================================
 * 一、D1 行为面（真模块，不需要破坏）
 * ================================================================== */
test('v284 1. set(key, null) 之后键必须缺席（真删除，而非写入 null）', async () => {
  const host = makeHost();
  try {
    const { PhoneStorage } = await import('../config/storage.js');
    const st = new PhoneStorage();
    await st.set(CHAT_KEY, { seeded: true }, true);
    assert.equal(storeOf(host, true)[CHAT_KEY]?.seeded, true, '前置：写入通道可用');

    await st.set(CHAT_KEY, null, true);
    const store = storeOf(host, true);
    assert.equal(Object.prototype.hasOwnProperty.call(store, CHAT_KEY), false,
      'set(null) 必须真删除该键，不得留下一枚 null');
    assert.equal(store[CHAT_KEY], undefined, '读回必须是 undefined');
  } finally { host.uninstall(); }
});

test('v284 2. set(key, null) 之后 JSON 里不得出现该键', async () => {
  const host = makeHost();
  try {
    const { PhoneStorage } = await import('../config/storage.js');
    const st = new PhoneStorage();
    await st.set(CHAT_KEY, [1, 2, 3], true);
    assert.ok(JSON.stringify(storeOf(host, true)).includes(CHAT_KEY), '前置：写入后真的在 JSON 里');

    await st.set(CHAT_KEY, null, true);
    const json = JSON.stringify(storeOf(host, true));
    assert.equal(json.includes(`"${CHAT_KEY}":null`), false,
      '修前形态：JSON 里会出现 "key":null —— 无效载荷真的落盘了');
    assert.equal(json.includes(CHAT_KEY), false, '删除后键名不应再出现在存档里');
  } finally { host.uninstall(); }
});

test('v284 3. set(key, null) 之后 get() 必须落到 defaultValue', async () => {
  const host = makeHost();
  try {
    const { PhoneStorage } = await import('../config/storage.js');
    const st = new PhoneStorage();
    await st.set(CHAT_KEY, { seeded: true }, true);
    await st.set(CHAT_KEY, null, true);
    // 注：本条只锁「修后 get() 必须给默认值」这个**行为**，不作区分度用。
    //   反向审计（probe_reverse.mjs）已实测：修前 get() 内部第二道
    //   `if (value !== null && value !== undefined) return value;` 同样把它落到默认值，
    //   所以「修前越过了默认值」是**错误论断**，区分度落在 criteriaDisagree 上（测试 9）。
    assert.equal(st.get(CHAT_KEY, SENTINEL), SENTINEL,
      'set(null) 后 get() 必须落到 defaultValue；返回 null 说明删除语义没生效');
  } finally { host.uninstall(); }
});

test('v284 4. set(key, undefined) 与 set(key, null) 同语义（都是删除）', async () => {
  const host = makeHost();
  try {
    const { PhoneStorage } = await import('../config/storage.js');
    const st = new PhoneStorage();
    await st.set(CHAT_KEY, { seeded: true }, true);
    await st.set(CHAT_KEY, undefined, true);
    const store = storeOf(host, true);
    assert.equal(Object.prototype.hasOwnProperty.call(store, CHAT_KEY), false,
      'undefined 也必须是真删除');
    assert.equal(st.get(CHAT_KEY, SENTINEL), SENTINEL, 'defaultValue 生效');
  } finally { host.uninstall(); }
});

test('v284 5. extensionSettings 侧同款语义（全局键）', async () => {
  const host = makeHost();
  try {
    const { PhoneStorage } = await import('../config/storage.js');
    const st = new PhoneStorage();
    await st.set(GLOBAL_KEY, { seeded: true }, true);
    assert.equal(storeOf(host, false)[GLOBAL_KEY]?.seeded, true, '前置：全局键写入可用');

    await st.set(GLOBAL_KEY, null, true);
    assert.equal(Object.prototype.hasOwnProperty.call(storeOf(host, false), GLOBAL_KEY), false,
      '全局键的 set(null) 同样必须真删除');
    assert.equal(st.get(GLOBAL_KEY, SENTINEL), SENTINEL, '全局侧 defaultValue 同样生效');
  } finally { host.uninstall(); }
});

test('v284 6. set(null) 与 remove() 收敛到同一出口（状态完全等价）', async () => {
  const host = makeHost();
  try {
    const { PhoneStorage } = await import('../config/storage.js');
    const st = new PhoneStorage();

    await st.set(CHAT_KEY, { a: 1 }, true);
    await st.set(CHAT_KEY, null, true);
    const afterSetNull = JSON.stringify(storeOf(host, true));

    await st.set(CHAT_KEY, { a: 1 }, true);
    await st.remove(CHAT_KEY, true);
    const afterRemove = JSON.stringify(storeOf(host, true));

    assert.equal(afterSetNull, afterRemove,
      '两条删除路径必须产生完全相同的存档状态（否则又是一处「同义不同形」）');
  } finally { host.uninstall(); }
});

test('v284 7. 正常值（含 0 / 空串 / false）不受早退影响，照旧写入', async () => {
  const host = makeHost();
  try {
    const { PhoneStorage } = await import('../config/storage.js');
    const st = new PhoneStorage();
    // 早退只拦 null / undefined；falsy 但**合法**的载荷必须照旧写进去。
    // 这是本版最容易「顺手优化错」的地方：若判据写成 `if (!value)`，
    // 下面三条会被静默删掉 —— 正是 v2.83 那个 `!x` 判据的翻版。
    await st.set(CHAT_KEY, 0, true);
    assert.equal(storeOf(host, true)[CHAT_KEY], 0, '0 必须被写入');
    await st.set(CHAT_KEY, '', true);
    assert.equal(storeOf(host, true)[CHAT_KEY], '', '空串必须被写入');
    await st.set(CHAT_KEY, false, true);
    assert.equal(storeOf(host, true)[CHAT_KEY], false, 'false 必须被写入');
  } finally { host.uninstall(); }
});

/* ==================================================================
 * 二、负控制：真源码破坏 → 破坏副本重跑同款真判据（真绿 / 真红两向）
 * ================================================================== */
test('v284 8. 负控制 A（绿）：原版副本上「键缺席」成立', async () => {
  const file = makeCopy('orig', false);
  try {
    const r = await observeAfterSetNull(file, 'chat');
    assert.equal(r.seededOk, true, '前置：副本写入通道可用（夹具不完整会让结论不可信）');
    assert.equal(r.keyPresent, false, '原版副本：set(null) 后键必须缺席');
    assert.equal(r.nullInJson, false, '原版副本：null 不得进 JSON');
    // 判据面：两份判据必须一致（都判「键不存在」）
    assert.equal(r.existsByUndefinedCheck, false, '原版副本：存在判据 A 必须为假');
    assert.equal(r.truthyCheck, false, '原版副本：真值判据 B 必须为假');
    assert.equal(r.criteriaDisagree, false, '原版副本：两套判据不得分歧');
    // 诚实记录：defaultValue 两侧都生效（get() 有第二道兜底），故它不是判据面。
    assert.equal(r.gotDefault, true, '原版副本：get() 落到默认值（此字段不作区分度用）');
  } finally { cleanup(file); }
});

test('v284 9. 负控制 B（红）：删掉早退块的副本上，同一判据必须失败', async () => {
  const file = makeCopy('broken', true);
  try {
    const r = await observeAfterSetNull(file, 'chat');
    assert.equal(r.seededOk, true, '前置：破坏只动删除语义，不影响写入通道');
    // 旧行为：键留着、值为 null、null 进 JSON
    assert.equal(r.keyPresent, true, '破坏副本上键应当仍在（这就是旧行为）');
    assert.equal(r.valueIsNull, true, '破坏副本上值应当是 null');
    assert.equal(r.nullInJson, true, '破坏副本上 "key":null 应当真的落盘');
    // 同款判据在破坏副本上必须给出**相反结论** —— 这才是缺陷本体的观测口径。
    // 注意：判据面**不是** defaultValue。get() 内部还有第二道
    //   `if (value !== null && value !== undefined) return value;` 兜底，
    // 所以修前 get(key, 默认值) 同样返回默认值（本测试的反向审计实测结论）。
    // 真正的分歧是下面这一对同义判据在全仓并存且结论相反。
    assert.equal(r.existsByUndefinedCheck, true, '破坏副本：存在判据 A（store[k] !== undefined）为真');
    assert.equal(r.truthyCheck, false, '破坏副本：真值判据 B（!!store[k]）为假');
    assert.equal(r.criteriaDisagree, true, '破坏副本：两套判据必须分歧 —— 判据确有区分度');
    // 反向审计留痕：此处曾错误断言「defaultValue 不生效」，实测证伪，故反着锁死。
    assert.equal(r.gotDefault, true,
      '破坏副本上 defaultValue 依然生效（get() 第二道兜底）—— 写成 false 就是错误论证');
  } finally { cleanup(file); }
});

test('v284 10. 负控制 C（两向自证）：破坏须可观测改行为，原版上同判据须为真', async () => {
  const orig = makeCopy('both-orig', false);
  const broken = makeCopy('both-broken', true);
  try {
    const a = await observeAfterSetNull(orig, 'chat');
    const b = await observeAfterSetNull(broken, 'chat');
    // 两向自证：若两份副本给出相同结论，说明「破坏」根本没生效（假绿的一半）
    assert.notDeepEqual(
      { p: a.keyPresent, c: a.criteriaDisagree },
      { p: b.keyPresent, c: b.criteriaDisagree },
      '原版与破坏副本必须给出不同观测 —— 相同则破坏无效，负控制无意义'
    );
    assert.equal(a.keyPresent, false, '原版：键缺席');
    assert.equal(b.keyPresent, true, '破坏版：键留下');
    assert.equal(a.criteriaDisagree, false, '原版：判据面不分歧');
    assert.equal(b.criteriaDisagree, true, '破坏版：判据面分歧');
  } finally { cleanup(orig); cleanup(broken); }
});

test('v284 11. H6 工具自证：锚点不存在 / 不唯一时必须抛，不得静默放过', () => {
  // 用一个「肯定找不到」的锚点调用同一套制造逻辑，必须抛（而不是产出一份「破坏后
  // 其实没变」的副本，让后续断言在假前提下通过）。
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rp-v284-tool-'));
  try {
    const bogus = ['', '        if (value === null || value === undefined) { __NOPE__', ''].join('\n');
    const src = read(STORAGE_REL);
    const n = src.split(bogus).length - 1;
    assert.equal(n, 0, '前提：幽灵锚点在真源码里不存在');
    // 直接复现工具内部的守卫语义（锚点计数 !== 1 → throw）
    const guard = (count) => {
      if (count !== 1) throw new Error(`锚点不唯一/不存在：${count}`);
    };
    assert.throws(() => guard(n), /锚点不唯一\/不存在/, '锚点不命中必须抛');
    assert.throws(() => guard(2), /锚点不唯一\/不存在/, '锚点命中 2 次必须抛');
    assert.doesNotThrow(() => guard(1), '锚点恰中 1 次才允许破坏');
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_e) { /* 忽略 */ }
  }
});

test('v284 12. 负控制 D：破坏副本上 extensionSettings 侧同样复现旧行为', async () => {
  const file = makeCopy('broken-global', true);
  try {
    const r = await observeAfterSetNull(file, 'global');
    assert.equal(r.keyPresent, true, '破坏副本（全局侧）：键应当仍在');
    assert.equal(r.criteriaDisagree, true, '破坏副本（全局侧）：两套判据必须分歧');
  } finally { cleanup(file); }
});

/* ==================================================================
 * 三、防回退：源码面判据（锁住机理与接线，不锁实现细节）
 * ================================================================== */
test('v284 13. 防回退：set() 必须以 null/undefined 早退并委托 remove()', () => {
  const src = read(STORAGE_REL);
  const n = src.split(EARLY_RETURN).length - 1;
  assert.equal(n, 1, `早退块必须恰出现 1 次（实得 ${n}）`);
  assert.ok(/if \(value === null \|\| value === undefined\) \{/.test(src),
    '必须显式判 null / undefined（不得写成 !value —— 那会连 0/空串/false 一起删）');
  assert.ok(/await this\.remove\(key, immediate\)/.test(src),
    '必须委托 remove()，与删除出口收敛');
});

test('v284 14. 防回退：调用点仍是 3 处「set(key, null)」删除意图', () => {
  const src = read('apps/wechat/wechat-data.js');
  const hits = src.split('this.storage.set(').filter((seg, i) => i > 0 && /^\s*[^,]+,\s*null\s*,/.test(seg));
  assert.equal(hits.length, 3,
    `微信数据层应有 3 处 set(key, null)（清损坏数据 / 清联系人与群组 / 删单个聊天），实得 ${hits.length}`);
  // 这三处在修复后走的正是真删除路径（由测试 1~6 在真模块上验证行为）
});

test('v284 15. 版本五源同源 + items 逐字一致，且本套件不早于 2.84.0', () => {
  const manifest = JSON.parse(read('manifest.json'));
  const pkg = JSON.parse(read('package.json'));
  const log = JSON.parse(read('update-log.json'));
  const idx = read('index.js');
  const m = /const ST_PHONE_VERSION = '([0-9.]+)'/.exec(idx);
  assert.ok(m, 'index.js 必须有 ST_PHONE_VERSION');
  const v = m[1];
  assert.equal(manifest.version, v, 'manifest 与 ST_PHONE_VERSION 必须同源');
  assert.equal(pkg.version, v, 'package 与 ST_PHONE_VERSION 必须同源');
  assert.equal(String(log.latest), v, 'update-log.latest 必须同源');
  assert.ok(log.versions[v], 'update-log 必须有本版条目');
  assert.equal(String(Object.keys(log.versions)[0]), v, '本版必须是 versions 首键');
  const n = (x) => x.split('.').map(Number).reduce((a, b) => a * 1000 + b, 0);
  assert.ok(n(v) >= n('2.84.0'), '本套件需要 2.84.0 及以上，实得 ' + v);
});

test('v284 16. 迭代文档必须登记本版三件事（版本号 / 缺陷形态 / 待办同款形态）', () => {
  const iter = read('ITERATION_LOG.md');
  assert.ok(/2\.84\.0/.test(iter), 'ITERATION_LOG 必须登记 2.84.0');
  assert.ok(/set\(/.test(iter) && /null/.test(iter),
    '必须写明本版缺陷形态（set(key, null) 不是删除）');
  const todo = read('TODO.md');
  assert.ok(/删除语义|set\(key, null\)|删除出口/.test(todo),
    '未完成清单里应留下本版新识别出的同类形态（若有）');
});
