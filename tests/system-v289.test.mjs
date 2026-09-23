/**
 * tests/system-v289.test.mjs — 存储层「版本落后」缺口固化 [v2.89.0]
 *
 * 背景（TODO P2「storage 损坏与版本落后」）：
 *   损坏自愈已于 v2.83.0 落地；「版本落后」一直缺 —— 本仓存储层**没有**统一
 *   schema 版本号，且旧架构迁移**不留痕、不清旧键**，于是 `get(旧键)` 每次都
 *   重走迁移分支、重复搬运同一份旧值。
 *
 * 本轮修两件（探针 probe_v289b.mjs 实测锚定）：
 *   D1 迁移留痕 + 清旧键：迁移成功 → 在命名空间写 __migration_ledger（version+keys）
 *      → 清 localStorage 旧键 → 后续 get 账本命中即短路（不再重搬）。
 *   D2 localStorage 读出解析：写入侧 JSON.stringify，读取侧此前原样返回字符串，
 *      类型漂移（写对象、读字符串）。补 _parseLegacyValue：结构/字面量才解析，
 *      纯文本保持原样。
 *
 * 覆盖：
 *   A 源码面：STORAGE_SCHEMA_VERSION / 账本键 / 三辅助方法存在且被接线
 *   B 行为面（真宿主）：首迁留痕、清旧键、二次 get 短路、旧值再塞不影响读数
 *   C 读出解析面：对象/数组/数字/布尔解析、纯文本保持、null 透传
 *   D 负控制（真源码破坏 → 在副本上重跑真判据必须转红）
 *   E 版本锚点
 */
import test from 'node:test';
import assert from 'node:assert';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { installRuntimeHost, resetHostFlags } from './_runtime_host.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const read = (f) => readFileSync(path.join(ROOT, f), 'utf8');
const STORAGE_SRC = read('config/storage.js');

/** 把 config/storage.js 去掉 export 前缀后落盘成模块，返还其导出类（真源码，不手抄） */
async function loadStorage(mutator) {
  let src = STORAGE_SRC.replace(/^export\s+class\s+/m, 'class ') + '\nexport { PhoneStorage };\n';
  if (typeof mutator === 'function') src = mutator(src);
  const dir = mkdtempSync(path.join(os.tmpdir(), 'v289-storage-'));
  const file = path.join(dir, 'storage_mod.mjs');
  writeFileSync(file, src);
  const mod = await import('file://' + file);
  return mod.PhoneStorage;
}

/** 装宿主 + 造一个 PhoneStorage 实例，返回 { st, host, lsMap } */
async function freshStorage(PhoneStorage) {
  resetHostFlags();
  const host = installRuntimeHost({ chatMetadata: {}, settings: {} });
  const st = new PhoneStorage();
  // 夹具的 localStorage stub 在 host.localStorage（= globalThis.localStorage）
  return { st, host };
}

/* ============================================================
 * A. 源码面
 * ============================================================ */
test('v289 A. 源码面：版本常量/账本键/辅助方法齐备并被接线', () => {
  assert.match(STORAGE_SRC, /this\.STORAGE_SCHEMA_VERSION\s*=\s*2/, 'schema 版本常量为 2');
  assert.match(STORAGE_SRC, /this\.MIGRATION_LEDGER_KEY\s*=\s*'__migration_ledger'/, '账本键定义');
  assert.match(STORAGE_SRC, /_readMigrationLedger\s*\(/, '_readMigrationLedger 定义');
  // [重要] 读端必须与写端同构按 isChatData 选 store：
  //   修前 `_getChatMetadataStore() || _getExtensionSettingsStore()` 因 chatMetadata
  //   命名空间恒为真值对象而短路，全局键账本读不到 → 短路形同虚设（D2 阳性对照暴露）。
  assert.match(STORAGE_SRC, /_readMigrationLedger\s*\(\s*isChatData\s*=\s*false\s*\)/, '读端接受 isChatData');
  assert.ok(
    !/_readMigrationLedger\(isChatData\s*=\s*false\)\s*\{[\s\S]{0,300}?this\._getChatMetadataStore\(\)\s*\|\|/.test(STORAGE_SRC),
    '读端不得用 `chatMetadata || extensionSettings` 选 store（会读错全局键账本）',
  );
  assert.match(STORAGE_SRC, /const store = isChatData \? this\._getChatMetadataStore\(\) : this\._getExtensionSettingsStore\(\);/, '读端按 isChatData 三目选 store');
  assert.match(STORAGE_SRC, /_isKeyMigrated\s*\(\s*key\s*,\s*isChatData\s*=\s*false\s*\)/, '_isKeyMigrated 透传 isChatData');
  assert.match(STORAGE_SRC, /_writeMigrationLedger\s*\(/, '_writeMigrationLedger 定义');
  assert.match(STORAGE_SRC, /_isKeyMigrated\s*\(/, '_isKeyMigrated 定义');
  assert.match(STORAGE_SRC, /_parseLegacyValue\s*\(/, '_parseLegacyValue 定义');
  // 接线：get 的迁移分支须带账本短路 + 解析
  assert.match(STORAGE_SRC, /if\s*\(!isChatData\s*&&\s*!this\._isKeyMigrated\(key,\s*isChatData\)\)/, 'get 迁移分支带账本短路（透传 isChatData）');
  assert.match(STORAGE_SRC, /this\._parseLegacyValue\(rawLegacy\)/, 'get 用 _parseLegacyValue 解析');
  // 迁移出口须留痕 + 清旧键
  const migBlock = STORAGE_SRC.split('_migrateToNewArchitecture(key, value, isChatData)')[1] || '';
  assert.ok(migBlock.includes('_writeMigrationLedger'), '迁移出口写账本');
  assert.ok(migBlock.includes('removeItem(legacyKey)'), '迁移出口清旧键');
});

/* ============================================================
 * B. 行为面（真宿主 + 真 PhoneStorage）
 * ============================================================ */
test('v289 B1. 首迁：留痕 + 清旧键 + 返回值正确', async () => {
  const PhoneStorage = await loadStorage();
  const { st, host } = await freshStorage(PhoneStorage);
  try {
    const KEY = 'zzprobe_b1';
    const legacyKey = `virtual_phone_global_${KEY}`;
    host.localStorage.setItem(legacyKey, JSON.stringify({ v: 'legacy', n: 1 }));

    const v = st.get(KEY, null);
    assert.deepEqual(v, { v: 'legacy', n: 1 }, '旧值读出并解析为对象');

    const ns = host.context.extensionSettings.st_virtual_phone || {};
    const ledger = ns.__migration_ledger;
    assert.ok(ledger && ledger.keys && ledger.keys[KEY], '账本登记该键');
    assert.equal(ledger.version, 2, '账本记录 schema 版本');
    assert.equal(host.localStorage.getItem(legacyKey), null, '旧 localStorage 键已清除');
  } finally {
    host.uninstall();
  }
});

test('v289 B2. 账本命中后短路：不再重走迁移、旧键不再被搬运', async () => {
  const PhoneStorage = await loadStorage();
  const { st, host } = await freshStorage(PhoneStorage);
  try {
    const KEY = 'zzprobe_b2';
    const legacyKey = `virtual_phone_global_${KEY}`;
    host.localStorage.setItem(legacyKey, JSON.stringify({ v: 'first' }));
    const first = st.get(KEY, null);
    assert.deepEqual(first, { v: 'first' }, '首读取旧值');

    // 故意再塞一份「不同的」旧值：账本命中则不应被搬运，读数保持首次结果
    host.localStorage.setItem(legacyKey, JSON.stringify({ v: 'CHANGED' }));
    const second = st.get(KEY, null);
    assert.deepEqual(second, { v: 'first' }, '账本命中 → 不重搬 → 读数仍是新架构里的值');
    assert.deepEqual(host.context.extensionSettings.st_virtual_phone[KEY], { v: 'first' }, '新架构值未被旧键覆盖');
    assert.ok(host.localStorage.getItem(legacyKey) !== null, '短路时旧键不被清（未走迁移分支）');
  } finally {
    host.uninstall();
  }
});

/* ============================================================
 * C. 读出解析面
 * ============================================================ */
test('v289 C. _parseLegacyValue：结构/字面量解析，纯文本保持，null 透传', async () => {
  const PhoneStorage = await loadStorage();
  const { st, host } = await freshStorage(PhoneStorage);
  try {
    assert.deepEqual(st._parseLegacyValue('{"a":1}'), { a: 1 }, '对象串 → 对象');
    assert.deepEqual(st._parseLegacyValue('[1,2]'), [1, 2], '数组串 → 数组');
    assert.equal(st._parseLegacyValue('42'), 42, '数字串 → 数字');
    assert.equal(st._parseLegacyValue('true'), true, '布尔串 → true');
    assert.equal(st._parseLegacyValue('hello world'), 'hello world', '纯文本保持原样');
    assert.equal(st._parseLegacyValue('{不是合法JSON'), '{不是合法JSON', '坏 JSON 保持原样（不抛）');
    assert.equal(st._parseLegacyValue(null), null, 'null 透传');
    assert.equal(st._parseLegacyValue(undefined), undefined, 'undefined 透传');
    assert.deepEqual(st._parseLegacyValue({ already: 'obj' }), { already: 'obj' }, '非字符串原样返回');
  } finally {
    host.uninstall();
  }
});

/* ============================================================
 * D. 负控制（真源码破坏 → 在副本上重跑真判据必须转红）
 * ============================================================ */
test('v289 D1. 负控制：抽掉迁移端「清旧键」→ 旧键残留 → 每次 get 重搬', async () => {
  // 真源码破坏：迁移端点掉 removeItem(legacyKey)——恰中 1 次（get 端已无 removeItem，见 A 组）
  const hits = (STORAGE_SRC.match(/localStorage\.removeItem\(legacyKey\);/g) || []).length;
  assert.equal(hits, 1, '锚点恰中 1 次（防误伤）');
  const PhoneStorage = await loadStorage((s) =>
    s.replace('localStorage.removeItem(legacyKey);', '/* 破坏：不清旧键 */'));
  const { st, host } = await freshStorage(PhoneStorage);
  try {
    const KEY = 'zzprobe_d1';
    const legacyKey = `virtual_phone_global_${KEY}`;
    host.localStorage.setItem(legacyKey, JSON.stringify({ v: 'first' }));
    st.get(KEY, null);
    // 破坏后：旧键残留 → 真判据「迁移后旧键已清」在副本上转红
    assert.ok(host.localStorage.getItem(legacyKey) !== null, '破坏后旧键残留（判据转红）');
  } finally {
    host.uninstall();
  }
});

/**
 * D2 判据设计说明（为什么不能只「再塞一份旧值」）：
 *   首迁后新架构 store 已持有该键（get 第 0 优先级直接命中并 return），
 *   故「再塞旧值」这条路根本走不到迁移分支 —— 破坏账本短路也观测不到，
 *   属「破坏与判据不对齐」的假绿。
 *   正确做法：先让新架构里的键**消失**（模拟读数丢失 / 命名空间被清），
 *   此时 get 会一路下探：账本命中 → 短路 → 返回 default；账本失效 → 重搬旧键 → 返回旧值。
 *   这样「账本」的存在与否才有唯一可观测差异。
 */
test('v289 D2. 负控制：账本短路失效 → 新架构读数缺失时旧键被重搬（判据转红）', async () => {
  // 真源码破坏：让 _isKeyMigrated 恒返回 false（等价于「无留痕」→ get 永不短路）
  const hits = (STORAGE_SRC.match(/Object\.prototype\.hasOwnProperty\.call\(ledger\.keys, key\)/g) || []).length;
  assert.equal(hits, 1, '锚点恰中 1 次（防误伤）');
  const PhoneStorage = await loadStorage((s) =>
    s.replace('Object.prototype.hasOwnProperty.call(ledger.keys, key)', 'false'));
  const { st, host } = await freshStorage(PhoneStorage);
  try {
    const KEY = 'zzprobe_d2';
    const legacyKey = `virtual_phone_global_${KEY}`;
    host.localStorage.setItem(legacyKey, JSON.stringify({ v: 'first' }));
    const first = st.get(KEY, null);
    assert.deepEqual(first, { v: 'first' }, '首迁：旧值入新架构');

    // 让新架构读数消失，并把旧键重新塞回（账本仍在 → 原版必须短路）
    delete host.context.extensionSettings.st_virtual_phone[KEY];
    host.localStorage.setItem(legacyKey, JSON.stringify({ v: 'RESURRECTED' }));

    const second = st.get(KEY, null);
    // 破坏后：短路失效 → 走回迁移分支 → 旧键被重搬（判据转红）
    assert.deepEqual(second, { v: 'RESURRECTED' }, '短路失效后旧键被重搬（判据转红）');
  } finally {
    host.uninstall();
  }

  // ── 阳性对照（判据纯度）：同一场景在原版源码上必须走另一条路 ──
  // 原版账本命中 → 短路 → 不重搬 → 返回 default（这里传 'DEFAULT' 以便区分）
  const PhoneStorageOk = await loadStorage();
  const { st: stOk, host: hostOk } = await freshStorage(PhoneStorageOk);
  try {
    const KEY = 'zzprobe_d2';
    const legacyKey = `virtual_phone_global_${KEY}`;
    hostOk.localStorage.setItem(legacyKey, JSON.stringify({ v: 'first' }));
    stOk.get(KEY, null);
    delete hostOk.context.extensionSettings.st_virtual_phone[KEY];
    hostOk.localStorage.setItem(legacyKey, JSON.stringify({ v: 'RESURRECTED' }));
    const secondOk = stOk.get(KEY, 'DEFAULT');
    assert.equal(secondOk, 'DEFAULT', '原版：账本命中 → 短路 → 不重搬 → 返回 default（判据真的测到了账本）');
    assert.equal(hostOk.context.extensionSettings.st_virtual_phone[KEY], undefined, '原版：短路时不写回新架构');
  } finally {
    hostOk.uninstall();
  }
});

/* ============================================================
 * E. 版本锚点（动态锚定 latest，下限 2.89.0）
 * ============================================================ */
test('v289 E. 版本不低于 2.89.0（本套件接管版本锚点）', () => {
  const log = JSON.parse(read('update-log.json'));
  const v = log.latest;
  const vnum = (s) => Number(String(s).split('.').reduce((a, x) => a * 1000 + Number(x), 0));
  assert.ok(vnum(v) >= vnum('2.89.0'), `版本 ${v} < 2.89.0`);
});
