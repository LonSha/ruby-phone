/**
 * tests/system-v295.test.mjs — 万象背包：任务奖励的「源头消失即回收」 [v2.95.0]
 *
 * 探针实证（真宿主 + 真 PhoneStorage + 真 WangxiangApp，五条候选逐条定性）：
 *   [候选 4 · ★证实] 剧情回滚移除**已完成**任务后，奖励物品仍留在背包：
 *       回滚前 1 → 回滚后 1，`rollbackWechatAssignmentsToFloor` 返回 true，
 *       剩余键 `task:task_rb_1:0`。任务已不存在，派生条目无人回收 ——
 *       与 v2.77→v2.93 主线（源头变更后下游未对齐）**完全同形**。
 *       对照组（回滚未完成任务 → 0 物品；范围外任务 → 不动）均正常。
 *   [候选 2 · 同口径] abandonTask 删除 managedTasks 任务时同样不回收 ——
 *       该出口当前被 UI 挡住（completed 任务不渲染放弃按钮），但**口径必须一致**：
 *       同一种「任务消失、奖励留下」不能在这条路上漏。
 *   [候选 1 · 证伪为设计本意] 删订单**记录**不回收 `order:` 背包条目。
 *       视图文案为据（`删除这条订单记录？此操作不会退款或恢复库存。`）——
 *       删的是记录，不是已到手的物品。本套件为它立**守卫**，防止以后被误「修」。
 *   [候选 3 · 未证实] 500 条上限与补发出口互相打架：跨重载条数 500→500、丢 0 增 0，
 *       按纪律不列缺陷，故本套件不涉及。
 *
 * 修法（与 v2.93.0 立的判据同口径）：
 *   · 新增**整族回收**出口 `_removeInventoryItemsBySourceBase(base)`：收基名本身
 *     或 `基名:` 族 —— 任务奖励键是 `task:<id>:<index>`，最多 10 份
 *     （`_parseTaskInventoryRewards`），精确键回收凑不出 `<index>`，等于一条都收不掉；
 *   · 回滚路径：只对**确实被移除**的任务逐条整族回收，范围外一条不动；
 *   · abandonTask：同口径回收，并落盘背包。
 *
 * 覆盖：
 *   A 结构面：族回收出口在场；两条路径都接线；设计本意守卫（删订单记录不动背包）
 *   B 行为面（真宿主 + 真 storage + 真 WangxiangApp）：回滚 / 放弃 / 防误伤 / 设计本意
 *   C 负控制：真源码破坏 → 在副本上重跑**同款真判据**必须转红（且破坏是定向的）
 *   D 版本下限
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { installRuntimeHost, resetHostFlags } from './_runtime_host.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const APP_SRC = read('apps/wangxiang/wangxiang-app.js');
const VIEW_SRC = read('apps/wangxiang/wangxiang-view.js');
const url = (rel) => 'file://' + path.join(ROOT, rel);

/* ============================================================
 * A. 结构面
 * ============================================================ */
test('v295 A1. 整族回收出口在场：认基名本身与 `基名:` 族', () => {
  assert.match(APP_SRC, /_removeInventoryItemsBySourceBase\(base\)\s*\{/,
    '缺整族回收出口');
  const at = APP_SRC.indexOf('_removeInventoryItemsBySourceBase(base) {');
  const body = APP_SRC.slice(at, at + 700);
  assert.match(body, /sid !== b && !sid\.startsWith\(head\)/,
    '回收须同时收基名本身与 `基名:` 族（任务奖励键带 `:<index>` 后缀）');
  assert.match(body, /const head = b \+ ':'/, '族前缀须由基名构造');
  // 基名为空一律不收（防「参数没传好把整包清空」）
  assert.match(body, /if \(!b\) return false;/, '空基名必须直接拒绝');
});

test('v295 A2. 两条路径都接线：回滚逐条回收、abandonTask 同口径回收', () => {
  // 回滚：只能收「确实被移除」的那些任务
  assert.match(APP_SRC,
    /for \(const taskId of removedIds\) \{[\s\S]{0,200}_removeInventoryItemsBySourceBase\(`task:\$\{taskId\}`\)/,
    '回滚路径须对 removedIds 逐条整族回收');
  assert.equal(/removedIds\.size\s*\)\s*return progressRolledBack/.test(APP_SRC), true,
    '没有任务被移除时不得做任何回收');
  // abandonTask：删除 managedTasks 任务时同口径
  const abandonAt = APP_SRC.indexOf('async abandonTask(taskId) {');
  const abandonBody = APP_SRC.slice(abandonAt, abandonAt + 1600);
  assert.match(abandonBody, /_removeInventoryItemsBySourceBase\(`task:\$\{id\}`\)/,
    '放弃任务须回收该任务的奖励族');
  assert.match(abandonBody, /inventoryChanged \? this\._saveInventoryItems\(\) : Promise\.resolve\(\)/,
    '回收后须落盘（否则重启又回来）');
  const rollbackAt = APP_SRC.indexOf('rollbackWechatAssignmentsToFloor(targetTavernIndex, exact = false) {');
  const rollbackBody = APP_SRC.slice(rollbackAt, rollbackAt + 2400);
  assert.match(rollbackBody, /inventoryChanged \? this\._saveInventoryItems\(\) : Promise\.resolve\(\)/,
    '回滚路径同样须落盘');
  // 精确键出口仍保留（进度回滚用快照里的真实键，那里不缺 index）
  assert.match(APP_SRC, /_removeInventoryItemsBySourceKeys\(snapshot\.grantedInventorySourceKeys\)/,
    '精确键出口不得被整族回收取代');
});

test('v295 A3. 设计本意守卫：删订单「记录」不回收背包物品', () => {
  // 视图文案是真依据：删的是记录，不是已到手的物品。
  assert.match(VIEW_SRC, /删除这条订单记录？此操作不会退款或恢复库存。/,
    '设计本意文案不得被改动（它是本条的判据来源）');
  const at = APP_SRC.indexOf('async removeMarketplaceOrder(orderId) {');
  const body = APP_SRC.slice(at, at + 500);
  assert.equal(/removeInventoryItems|inventoryItems\s*=/.test(body), false,
    '删订单记录不得顺手清背包（那是设计本意，不是缺陷）');
});

/* ============================================================
 * B. 行为面（真宿主 + 真 PhoneStorage + 真 WangxiangApp）
 * ============================================================ */
async function boot(root) {
  resetHostFlags();
  const host = installRuntimeHost({ chatMetadata: {}, settings: {} });
  const { PhoneStorage } = await import('file://' + path.join(root, 'config/storage.js'));
  const { WangxiangApp } = await import('file://' + path.join(root, 'apps/wangxiang/wangxiang-app.js'));
  const st = new PhoneStorage();
  host.context.chatMetadata['st_virtual_phone'] = {};
  host.window.VirtualPhone = host.window.VirtualPhone || {};
  host.window.VirtualPhone.storage = st;
  const app = new WangxiangApp(null, st);
  return { host, app, st };
}
const keysOf = (items) => items.map((i) => String(i.sourceKey || '')).sort();
const savedKeys = (st) => {
  const raw = st.get('wangxiang_inventory_items', '[]');
  const parsed = typeof raw === 'string' ? JSON.parse(raw || '[]') : (raw || []);
  return keysOf(Array.isArray(parsed) ? parsed : []);
};
const rollbackTask = (id, floor = 42, extra = {}) => ({
  id, title: id, status: 'completed', progress: 100,
  extraReward: '金币x3、药水x1', completedAt: '2026-09-25 10:00',
  assignmentSource: { kind: 'wechat_invitation', fromMainChatTag: true, tavernMessageIndex: floor },
  ...extra,
});

/**
 * 真判据（供负控制复用）：一次跑完两条路径，返回读数。
 *   回滚：已完成任务（主聊天派发·楼层 42）+ 范围外任务（手动来源）
 *   放弃：另一条已完成任务
 */
export async function inventoryTrace(root) {
  const rolled = await (async () => {
    const { host, app, st } = await boot(root);
    try {
      app.managedTasks = [
        rollbackTask('task_rb_1'),
        rollbackTask('task_out', 7, {
          title: '范围外任务', extraReward: '徽章x1',
          assignmentSource: { kind: 'manual', fromMainChatTag: false, tavernMessageIndex: 7 },
        }),
      ];
      app.managedTasks.forEach((t) => app._grantTaskRewardsToInventory(t));
      const before = keysOf(app.inventoryItems);
      const ok = app.rollbackWechatAssignmentsToFloor(42);
      return {
        before,
        after: keysOf(app.inventoryItems),
        saved: savedKeys(st),
        ok,
        remainingTasks: app.managedTasks.map((t) => t.id).sort(),
      };
    } finally {
      host.uninstall();
    }
  })();

  const abandoned = await (async () => {
    const { host, app, st } = await boot(root);
    try {
      app.managedTasks = [rollbackTask('task_ab')];
      app._grantTaskRewardsToInventory(app.managedTasks[0]);
      const before = keysOf(app.inventoryItems);
      await app.abandonTask('task_ab');
      return {
        before,
        after: keysOf(app.inventoryItems),
        saved: savedKeys(st),
        remainingTasks: app.managedTasks.map((t) => t.id),
      };
    } finally {
      host.uninstall();
    }
  })();

  return { rolled, abandoned };
}

function assertInventoryFloor(t, where) {
  // 回滚：被回滚任务的奖励整族收掉，范围外一条不动
  assert.deepEqual(t.rolled.before, ['task:task_out:0', 'task:task_rb_1:0', 'task:task_rb_1:1'],
    where + ' 前置：两条任务共 3 份奖励（受控任务两件）');
  assert.deepEqual(t.rolled.after, ['task:task_out:0'],
    where + ' 被回滚任务的奖励必须整族回收（含多份），范围外不动');
  assert.deepEqual(t.rolled.saved, ['task:task_out:0'],
    where + ' 回收结果必须落盘（否则重启又回来）');
  assert.equal(t.rolled.ok, true, where + ' 回滚应返回 true');
  assert.deepEqual(t.rolled.remainingTasks, ['task_out'], where + ' 只移除受控任务');
  // 放弃：同口径
  assert.deepEqual(t.abandoned.before, ['task:task_ab:0', 'task:task_ab:1'],
    where + ' 前置：一条任务两份奖励');
  assert.deepEqual(t.abandoned.after, [], where + ' 放弃任务须回收其奖励族');
  assert.deepEqual(t.abandoned.saved, [], where + ' 放弃路径同样须落盘');
  assert.deepEqual(t.abandoned.remainingTasks, [], where + ' 任务已移除');
}

test('v295 B1. 回滚已完成任务：奖励整族回收且落盘；范围外一条不动', async () => {
  assertInventoryFloor(await inventoryTrace(ROOT), '真仓库');
});

test('v295 B2. 防误伤：未授奖励的任务不产生假改动（仍返回 true 但背包零变化）', async () => {
  const { host, app, st } = await boot(ROOT);
  try {
    app.managedTasks = [
      rollbackTask('task_no_reward', 42, { extraReward: '', status: 'active', progress: 30 }),
      rollbackTask('task_keep', 7, { assignmentSource: { kind: 'manual', fromMainChatTag: false, tavernMessageIndex: 7 } }),
    ];
    app.managedTasks.forEach((t) => app._grantTaskRewardsToInventory(t));
    assert.deepEqual(keysOf(app.inventoryItems), ['task:task_keep:0', 'task:task_keep:1'],
      '只有范围外任务有奖励');
    const before = keysOf(app.inventoryItems);
    app.rollbackWechatAssignmentsToFloor(42);
    assert.deepEqual(keysOf(app.inventoryItems), before, '回收不得误伤范围外任务');
    // 未授奖励 ⇒ 没有可回收的东西 ⇒ 落盘键表保持原样。
    //   注意本仓有意不自动补录：背包只由「完成」/「送达」两条路径写入，
    //   测试里手工入包不会落盘，故这里的期望值是「落盘仍为空」而不是 before。
    assert.deepEqual(savedKeys(st), [],
      '未授奖励时不得产生任何背包落盘（更不得被清空成坏状态）');
    assert.deepEqual(before, ['task:task_keep:0', 'task:task_keep:1'], '内存中范围外奖励不动');
  } finally {
    host.uninstall();
  }
});

test('v295 B3. 设计本意：删订单记录后 `order:` 物品仍在背包（不回收）', async () => {
  const { host, app } = await boot(ROOT);
  try {
    app.marketplaceOrders = [{
      id: 'order_1', name: '压缩饼干', status: 'delivered', quantity: 2,
      categoryIndex: 1, deliveredAt: '2026-09-25 09:00',
    }];
    app._grantDeliveredOrderToInventory(app.marketplaceOrders[0]);
    assert.deepEqual(keysOf(app.inventoryItems), ['order:order_1'], '前置：订单已入包');
    const removed = await app.removeMarketplaceOrder('order_1');
    assert.ok(removed, '记录应被删除');
    assert.equal(app.marketplaceOrders.length, 0, '订单记录已删');
    assert.deepEqual(keysOf(app.inventoryItems), ['order:order_1'],
      '已到手的物品不得被顺手清掉（视图文案：不会退款或恢复库存）');
  } finally {
    host.uninstall();
  }
});

/* ============================================================
 * C. 负控制：真源码破坏 → 在副本上重跑同款真判据必须转红
 * ============================================================ */
const SKIP_IMPORT = /^\./;
/** 从种子文件递归收集相对导入闭包（破坏树要能真的加载起来） */
function collectClosure(root, seeds) {
  const files = { 'package.json': read('package.json') };
  const queue = [...seeds];
  while (queue.length) {
    const rel = queue.shift();
    if (Object.prototype.hasOwnProperty.call(files, rel)) continue;
    const abs = path.join(root, rel);
    if (!fs.existsSync(abs)) continue;
    const src = fs.readFileSync(abs, 'utf8');
    files[rel] = src;
    for (const m of src.matchAll(/from\s+'([^']+)'/g)) {
      if (!SKIP_IMPORT.test(m[1])) continue;
      const next = path.normalize(path.join(path.dirname(rel), m[1])).split(path.sep).join('/');
      if (!Object.prototype.hasOwnProperty.call(files, next)) queue.push(next);
    }
  }
  return files;
}
function stageTree(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v295-tree-'));
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
  return dir;
}
const replaceOnce = (s, from, to) => {
  const n = s.split(from).length - 1;
  assert.equal(n, 1, `锚点应恰好命中 1 次，实际 ${n}：${String(from).slice(0, 70)}`);
  return s.replace(from, to);
};
const CLOSURE = () => collectClosure(ROOT, [
  'apps/wangxiang/wangxiang-app.js',
  'config/storage.js',
]);

test('v295 C0. 破坏树自身可加载（否则负控制是假绿）', async () => {
  const dir = stageTree(CLOSURE());
  try {
    const t = await inventoryTrace(dir);
    assertInventoryFloor(t, '未破坏的副本树');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('v295 C1. 负控制：整族回收退化成只认精确键 → 多份奖励收不掉（判据转红）', async () => {
  const broken = replaceOnce(APP_SRC,
    'return sid !== b && !sid.startsWith(head);',
    'return sid !== b;');
  const dir = stageTree({ ...CLOSURE(), 'apps/wangxiang/wangxiang-app.js': broken });
  try {
    const t = await inventoryTrace(dir);
    assert.deepEqual(t.rolled.after, ['task:task_out:0', 'task:task_rb_1:0', 'task:task_rb_1:1'],
      '只认精确键时 `task:<id>:<index>` 一条都收不掉 —— 正是修前实测的残留形态');
    let threw = null;
    try { assertInventoryFloor(t, '破坏树'); } catch (e) { threw = e; }
    assert.ok(threw, '同款真判据在破坏树上必须抛');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('v295 C2. 负控制：抽掉回滚路径的回收调用 → 奖励残留（判据转红，放弃路径仍绿）', async () => {
  const broken = replaceOnce(APP_SRC,
    '            if (this._removeInventoryItemsBySourceBase(`task:${taskId}`)) inventoryChanged = true;',
    '            /* 回滚路径的回收被抽掉 */');
  const dir = stageTree({ ...CLOSURE(), 'apps/wangxiang/wangxiang-app.js': broken });
  try {
    const t = await inventoryTrace(dir);
    assert.deepEqual(t.rolled.after, ['task:task_out:0', 'task:task_rb_1:0', 'task:task_rb_1:1'],
      '抽掉调用后必然残留（判据转红）');
    assert.deepEqual(t.abandoned.after, [], '破坏是定向的：放弃路径仍应回收');
    let threw = null;
    try { assertInventoryFloor(t, '破坏树'); } catch (e) { threw = e; }
    assert.ok(threw, '同款真判据在破坏树上必须抛');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('v295 C3. 负控制：抽掉 abandonTask 的回收调用 → 残留（判据转红，回滚路径仍绿）', async () => {
  const broken = replaceOnce(APP_SRC,
    '        const inventoryChanged = this._removeInventoryItemsBySourceBase(`task:${id}`);',
    '        const inventoryChanged = false;');
  const dir = stageTree({ ...CLOSURE(), 'apps/wangxiang/wangxiang-app.js': broken });
  try {
    const t = await inventoryTrace(dir);
    assert.deepEqual(t.abandoned.after, ['task:task_ab:0', 'task:task_ab:1'],
      '抽掉调用后「任务消失、奖励留下」（判据转红）');
    assert.deepEqual(t.rolled.after, ['task:task_out:0'], '破坏是定向的：回滚路径仍应收干净');
    let threw = null;
    try { assertInventoryFloor(t, '破坏树'); } catch (e) { threw = e; }
    assert.ok(threw, '同款真判据在破坏树上必须抛');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
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
test('v295 D. 版本不低于 2.95.0 且五源同源', () => {
  const log = JSON.parse(read('update-log.json'));
  const manifest = JSON.parse(read('manifest.json'));
  const pkg = JSON.parse(read('package.json'));
  const m = read('index.js').match(/const ST_PHONE_VERSION = '([^']+)'/);
  assert.ok(m, 'ST_PHONE_VERSION 必须存在');
  assert.equal(log.latest, manifest.version);
  assert.equal(manifest.version, pkg.version);
  assert.equal(pkg.version, m[1]);
  assert.equal(atLeast(log.latest, '2.95.0'), true, `版本 ${log.latest} < 2.95.0`);
  const entry = log.versions[log.latest];
  assert.ok(entry && Array.isArray(entry.items) && entry.items.length > 0, '当前版本节须有条目');
});
