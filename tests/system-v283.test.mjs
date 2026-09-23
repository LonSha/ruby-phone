/**
 * tests/system-v283.test.mjs — 存储层损坏恢复 + 长期会话状态增长 [v2.83.0]
 *
 * 承接 `计划.txt` 第 113~142 行（状态增长 / 后台恢复）与第 386~394 行四项优先的 ③。
 *
 * 本版修的真缺陷（D1）：**命名空间被写成非普通对象时，写入静默丢失**。
 *   修前实现（两处同构）：
 *       if (!context.<container>[NAMESPACE]) context.<container>[NAMESPACE] = {};
 *   `!x` 只挡 undefined/null/''/0/false。以下值「非空但不可用」，一律被放行：
 *     字符串 / 数字 → `set()` 抛错（只进 console.error，调用方拿到已 resolve 的 Promise），
 *                    数据既进不了内存也进不了盘 —— **丢掉且不报**；
 *     数组        → 更糟：字符串键挂在数组上**能赋值、能读回**（本会话内一切正常），
 *                    但 `JSON.stringify([1,2,3])` 只序列化下标元素、不序列化字符串属性
 *                    ⇒ **一落盘全丢**，下次开会话读到空。这是最危险的一形：
 *                    既不报错、内存读数也正常，只有重启后才暴露。
 *   修复：抽共用守卫 `_ensureNamespaceStore(container, label)`，判据从 falsy 收紧为
 *   「必须是普通对象（非数组、非 null、typeof 'object'）」，不合格则把原值留档到
 *   `<NAMESPACE>__corrupt_backup` 后重建空对象（不静默丢用户数据）。
 *   同时区分「缺席/空」与「在场但类型错」：前者静默建，后者才出声 ——
 *   避免造出恒非零告警（v2.33 的教训：恒非零的告警会被读者学会忽略）。
 *
 * 负控制纪律：真源码破坏（锚点恰中 1 次）→ 在夹具副本上重跑**真判据**。
 *   本套件的 D1 判据是**行为判据**（调真 PhoneStorage），故负控制直接在
 *   进程内用真模块的副本验证「旧写法确实会丢数据」—— 即先证伪修复没被应用时
 *   行为确实是坏的，再断言修复后的行为是好的。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { installRuntimeHost, resetHostFlags } from './_runtime_host.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const NS = 'st_virtual_phone';

function makeStorageHost(namespaceValue) {
  resetHostFlags();
  const host = installRuntimeHost();
  const ctx = host.context;
  if (namespaceValue === undefined) delete ctx.chatMetadata[NS];
  else ctx.chatMetadata[NS] = namespaceValue;
  return host;
}

async function loadStorage() {
  const mod = await import('../config/storage.js');
  return mod.PhoneStorage;
}

/* ==================================================================
 * 一、D1：命名空间损坏时的读写行为（六个场景，逐一断言）
 * ================================================================== */

test('v283 1. 健康命名空间：写入落地且不被留档', async () => {
  const host = makeStorageHost({});
  try {
    const PhoneStorage = await loadStorage();
    const st = new PhoneStorage();
    await st.set('wechat_settings_v1', { hello: 1 });
    const ns = host.context.chatMetadata[NS];
    assert.deepEqual(ns['wechat_settings_v1'], { hello: 1 });
    assert.equal(ns.__corrupt_backup, undefined, '健康值不得被留档');
  } finally { host.uninstall(); }
});

test('v283 2. 命名空间被写成字符串：必须自愈（修前 set 抛错 + 数据丢失）', async () => {
  const host = makeStorageHost('CORRUPTED');
  try {
    const PhoneStorage = await loadStorage();
    const st = new PhoneStorage();
    await st.set('wechat_settings_v1', { hello: 1 });
    const ns = host.context.chatMetadata[NS];
    assert.equal(typeof ns, 'object');
    assert.ok(!Array.isArray(ns), '自愈后必须是普通对象');
    assert.deepEqual(ns['wechat_settings_v1'], { hello: 1 }, '写入必须真的落地');
    assert.equal(ns.__corrupt_backup, 'CORRUPTED', '原值必须留档（不得静默丢）');
  } finally { host.uninstall(); }
});

test('v283 3. 命名空间被写成数组：最危险的一形 —— 修前「不报错但落盘全丢」', async () => {
  const host = makeStorageHost([1, 2, 3]);
  try {
    const PhoneStorage = await loadStorage();
    const st = new PhoneStorage();
    await st.set('wechat_settings_v1', { hello: 1 });
    const ns = host.context.chatMetadata[NS];
    assert.ok(!Array.isArray(ns), '自愈后不得仍是数组');
    assert.deepEqual(ns['wechat_settings_v1'], { hello: 1 });
    // 关键：数组形态下「内存读得到」是假象 —— JSON 序列化会丢掉字符串键。
    // 这里显式锁住这个事实，防将来有人把判据放宽回「能读就算好」。
    const arr = [1, 2, 3];
    arr['wechat_settings_v1'] = { hello: 1 };
    assert.equal(JSON.stringify(arr), '[1,2,3]',
      '数组的字符串属性不进 JSON —— 这正是「静默落盘丢失」的机理');
    assert.ok(JSON.stringify(ns).includes('hello'),
      '自愈后的对象必须能被 JSON 保住（不是数组那种假象）');
  } finally { host.uninstall(); }
});

test('v283 4. 命名空间被写成数字：必须自愈', async () => {
  const host = makeStorageHost(42);
  try {
    const PhoneStorage = await loadStorage();
    const st = new PhoneStorage();
    await st.set('wechat_settings_v1', { hello: 1 });
    const ns = host.context.chatMetadata[NS];
    assert.equal(typeof ns, 'object');
    assert.deepEqual(ns['wechat_settings_v1'], { hello: 1 });
    assert.equal(ns.__corrupt_backup, 42);
  } finally { host.uninstall(); }
});

test('v283 5. 命名空间为 null 或缺席：正常初值，静默建且**不**留档（防恒非零噪声）', async () => {
  for (const initial of [null, undefined]) {
    const host = makeStorageHost(initial);
    try {
      const PhoneStorage = await loadStorage();
      const st = new PhoneStorage();
      await st.set('wechat_settings_v1', { hello: 1 });
      const ns = host.context.chatMetadata[NS];
      assert.equal(typeof ns, 'object', `initial=${initial} 应自愈为对象`);
      assert.deepEqual(ns['wechat_settings_v1'], { hello: 1 });
      assert.equal(ns.__corrupt_backup, undefined,
        `initial=${initial} 属正常初值，不得被当成损坏留档（否则每次首启都留一条垃圾）`);
    } finally { host.uninstall(); }
  }
});

test('v283 6. extensionSettings 一侧同款自愈（两处必须口径一致）', async () => {
  resetHostFlags();
  const host = installRuntimeHost();
  try {
    host.context.extensionSettings[NS] = '[broken]';
    const PhoneStorage = await loadStorage();
    const st = new PhoneStorage();
    await st.set('phone_global_setting', { a: 1 });   // 非会话键 → 走 extensionSettings
    const ns = host.context.extensionSettings[NS];
    assert.equal(typeof ns, 'object');
    assert.ok(!Array.isArray(ns));
    assert.deepEqual(ns['phone_global_setting'], { a: 1 });
    assert.equal(ns.__corrupt_backup, '[broken]');
  } finally { host.uninstall(); }
});

test('v283 7. 读取面同样自愈：只 get 不 set 也必须拿到可用命名空间', async () => {
  const host = makeStorageHost([9]);
  try {
    const PhoneStorage = await loadStorage();
    const st = new PhoneStorage();
    const v = st.get('wechat_settings_v1', 'DEFAULT');
    assert.equal(v, 'DEFAULT', '损坏时读默认值');
    assert.ok(!Array.isArray(host.context.chatMetadata[NS]),
      'get 路径也走同一守卫（否则 get 会把损坏值继续传播出去）');
  } finally { host.uninstall(); }
});

test('v283 8. 负控制（行为面）：旧写法确实会丢数据 —— 证明修复不是空转', () => {
  // 用**旧实现的等价逻辑**跑一遍，证明「不修就是坏的」。
  // 这不是对原文件断言，而是在证明判据有区分度：同一组用例下，
  // 旧逻辑给出 observable 的坏结果（数组丢数据 / 字符串抛错）。
  const ns = [1, 2, 3];
  const container = { [NS]: ns };
  const NAMESPACE = NS;
  // 旧实现：如果 (!container[NS]) container[NS] = {} —— 数组是真值，故不重建
  if (!container[NAMESPACE]) container[NAMESPACE] = {};
  const store = container[NAMESPACE];
  store['k'] = { v: 1 };
  assert.equal(store['k'].v, 1, '旧实现下内存里读得到（假象成立）');
  assert.equal(JSON.stringify(store), '[1,2,3]',
    '负控制：旧实现下 JSON 序列化确实丢掉字符串键 —— 修复前的行为是坏的');

  // 新实现判据（等价于 _ensureNamespaceStore 的核心判据）
  const cur = [1, 2, 3];
  const usable = cur !== null && typeof cur === 'object' && !Array.isArray(cur);
  assert.equal(usable, false, '新判据必须把数组判为不可用');
});

test('v283 9. 源码面：不得退回 falsy 判据（防回退）', () => {
  const src = read('config/storage.js');
  const code = src.split('\n')
    .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
    .join('\n');
  assert.ok(!/if\s*\(\s*!context\.chatMetadata\[this\.NAMESPACE\]\s*\)/.test(code),
    'chatMetadata 不得退回 `!x` 判据（数组会漏网）');
  assert.ok(!/if\s*\(\s*!context\.extensionSettings\[this\.NAMESPACE\]\s*\)/.test(code),
    'extensionSettings 不得退回 `!x` 判据');
  assert.ok(/_ensureNamespaceStore\(context\.chatMetadata/.test(code),
    'chatMetadata 必须走共用守卫');
  assert.ok(/_ensureNamespaceStore\(context\.extensionSettings/.test(code),
    'extensionSettings 必须走共用守卫（两处口径一致）');
  // 判据必须是「普通对象」（同时排除数组与 null）
  assert.ok(/!Array\.isArray\(cur\)/.test(code), '守卫必须显式排除数组');
});

/* ==================================================================
 * 二、长期会话：状态增长与恢复幂等（计划 ③ 的第一维：chatMetadata 字节数）
 * ================================================================== */

test('v283 10. 写入重复值不产生增长（幂等写入）', async () => {
  resetHostFlags();
  const host = installRuntimeHost();
  try {
    const PhoneStorage = await loadStorage();
    const st = new PhoneStorage();
    const payload = { items: [1, 2, 3], note: 'x'.repeat(50) };
    for (let i = 0; i < 50; i += 1) await st.set('wechat_state_v1', payload);
    const ns = host.context.chatMetadata[NS];
    const bytes = JSON.stringify(ns).length;
    // 幂等写入：50 次同样的写不应当让存档膨胀
    assert.ok(bytes < 400, `50 次相同写入后存档应保持小体积，实得 ${bytes} 字节`);
    // 且只有 1 个键
    const keys = Object.keys(ns).filter((k) => k !== '__corrupt_backup');
    assert.deepEqual(keys, ['wechat_state_v1'], '重复写同一个键不得产生额外键');
  } finally { host.uninstall(); }
});

test('v283 11. 数组型键超限被裁剪（防膨胀熔断仍然生效）', async () => {
  resetHostFlags();
  const host = installRuntimeHost();
  try {
    const PhoneStorage = await loadStorage();
    const st = new PhoneStorage();
    const huge = new Array(500).fill(0).map((_, i) => ({ i }));
    await st.set('ruby_xhs_notes', huge);
    const got = host.context.chatMetadata[NS]['ruby_xhs_notes'];
    assert.ok(Array.isArray(got));
    assert.ok(got.length <= 300, `熔断上限 300，实得 ${got.length}`);
    // 方向断言：该键是 unshift 语义（最新在前），必须保留**头部**
    assert.deepEqual(got[0], { i: 0 }, 'ruby_xhs_notes 必须保留头部（最新在前）');
  } finally { host.uninstall(); }
});

test('v283 12. 超限 Base64 图片被拒写（击穿存档的最后防线仍在）', async () => {
  resetHostFlags();
  const host = installRuntimeHost();
  try {
    const PhoneStorage = await loadStorage();
    const st = new PhoneStorage();
    const big = 'data:image/png;base64,' + 'A'.repeat(200 * 1024);
    await st.set('honey_state_v1', big);
    const got = host.context.chatMetadata[NS]['honey_state_v1'];
    assert.equal(got, '[BLOCKED_LARGE_BASE64_IMAGE]', '超大 Base64 必须被拒写');
  } finally { host.uninstall(); }
});

test('v283 13. 损坏自愈是幂等的：反复读/写不会反复留档、不累积字节', async () => {
  const host = makeStorageHost([1, 2, 3]);
  try {
    const PhoneStorage = await loadStorage();
    const st = new PhoneStorage();
    for (let i = 0; i < 20; i += 1) {
      st.get('wechat_settings_v1', null);
      await st.set('wechat_settings_v1', { round: i });
    }
    const ns = host.context.chatMetadata[NS];
    assert.ok(!Array.isArray(ns));
    // 备份键只应存在一个（幂等自愈；反复自愈不得堆出 __corrupt_backup__corrupt_backup…）
    assert.equal(Array.isArray(ns.__corrupt_backup), true,
      '备份应保留原数组（留档内容可核对）');
    const backupKeys = Object.keys(ns).filter((k) => k.startsWith('__corrupt_backup__'));
    assert.deepEqual(backupKeys, [], '不得出现嵌套备份键（自愈在自愈产物上再自愈）');
    const backups = Object.keys(ns).filter((k) => k.startsWith('__corrupt_backup'));
    assert.deepEqual(backups, ['__corrupt_backup'],
      `反复自愈只能留一份备份，实得 ${JSON.stringify(backups)}`);
  } finally { host.uninstall(); }
});

/* ==================================================================
 * 三、门禁与文档一致性
 * ================================================================== */

test('v283 14. 版本四处同源（manifest / package / ST_PHONE_VERSION / update-log）', () => {
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
  assert.ok(n(v) >= n('2.83.0'), '本套件需要 2.83.0 及以上，实得 ' + v);
});

test('v283 15. 边界文档必须继续存在且声明未验证项（不得被悄悄删掉）', () => {
  const p = path.join(ROOT, 'docs/runtime-verification-boundary.md');
  assert.ok(fs.existsSync(p), '运行时验证边界文档必须存在');
  const doc = fs.readFileSync(p, 'utf8');
  assert.ok(/未验证/.test(doc), '必须保留「未验证」标注（这是该文档存在的理由）');
  assert.ok(/窄屏|排版/.test(doc), '必须登记「需要真实排版」的不可验项');
});