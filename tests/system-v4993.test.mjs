/* ============================================================
 * tests/system-v4993.test.mjs — R11-X2 验收：交易与资产面
 *   （经济链 / 跨 App 事务栈 / 活体资产 → 钱包 App 真读写）
 * ------------------------------------------------------------
 * 【这一项为什么单列】
 *   四件经济内核（urban-economy / crossapp-transaction-stack / living-assets /
 *   lineage-living-assets）早就 import 进了 orchestrator，两把落盘键
 *   （ue_urban_economy_v1 / la_living_assets_v1）也早在 keys-audit 登记 —— 但全仓
 *   `apps/` 零命中：**有键、有门禁、有内核，没有出口**。更糟的是 orchestrator 里
 *   那四个「消费者」把纯函数签名当别的签名调：
 *     · transactEconomy 把 executeTransaction({source,target,...}) 当 (state, spec) 调
 *       ⇒ evaluateTransaction 判 invalid-spec；
 *     · transferAsset 被当 (state, assetId, from, to) 调、transitionLivingAsset 被塞 'active'。
 *   ⇒ 「钱包里发起一笔转账」这条路在本仓此前**一次都没走通过**。
 *
 * 【X2 的验收语（计划原文）】
 *   发起 → 提交 → 撤销三步各留一条可见记录；撤销后余额与归属回到原值；
 *   中途失败时状态是「部分完成」而不是「成功」；**回滚必须留可见痕迹**（不许静默恢复）。
 *
 * 【覆盖】
 *   A 纯映射：事务行的 undoState 判定（已撤销/部分/可撤/待提交/失败）与资产行形状
 *   B 三态不同形：读到有 N 条 / 读到 0 条 / **读不到** —— 压成同一形即粉饰
 *   C 桥是纯读：不碰 storage、不写任何键（剥注释后判**代码**）
 *   D 真源往返：serialize → restore 逐字等值；三键一次写齐 / 一次读回
 *   E 三步真走通：发起 → 提交 → 撤销；**撤销后余额与归属回到原值**
 *   F 接线自证：视图真走 app.economyFace()、视图不 import 桥、App 不碰 subsystems
 *   G 负控制：真破坏源码 → 在副本上重跑同款判据必须转红
 * ============================================================ */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  mapTransactionRow, mapAssetRow, mapBalanceRow, mergeEconomyFaces, previewUndo as bridgePreviewUndo,
  TX_STATUS, UNDO_STATE,
} from '../config/economy-face-bridge.js';
import { EconomyStore, ECONOMY_KEYS } from '../apps/wallet/economy-store.js';
import { WalletApp } from '../apps/wallet/wallet-app.js';
const __dir = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dir, '..');
const BRIDGE_REL = 'config/economy-face-bridge.js';
const STORE_REL = 'apps/wallet/economy-store.js';
const APP_REL = 'apps/wallet/wallet-app.js';
const VIEW_REL = 'apps/wallet/wallet-view.js';
function mkStorage() {
  const mem = new Map();
  const writes = [];
  return {
    _mem: mem, _writes: writes,
    get: (k, d) => (mem.has(k) ? mem.get(k) : d),
    set: (k, v) => { mem.set(k, v); writes.push({ key: k, value: v }); },
    has: (k) => mem.has(k),
    remove: (k) => mem.delete(k),
  };
}
const withWin = async (obj, fn) => {
  const backup = Object.getOwnPropertyDescriptor(globalThis, 'window');
  globalThis.window = obj;
  try { return await fn(); } finally {
    if (backup) Object.defineProperty(globalThis, 'window', backup);
    else delete globalThis.window;
  }
};
function mkApp(storage) {
  const shell = { showNotification: () => {}, screen: null, layerHost: () => null };
  return new WalletApp(shell, storage || mkStorage());
}
/* 剥注释后的**代码**（判「桥有没有碰 storage」时不能把注释里的字眼算成证据） */
function codeOf(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}
/* ══════════ A ── 纯映射：事务行 / 资产行的形状必须显式 ══════════ */
test('A1 事务行映射：undoState 五态判定（已撤销必须压过其余，部分不许说成可全撤）', () => {
  const committed = mapTransactionRow({
    id: 't1', label: '转账给林薇', status: 'committed', amount: 100, from: 'user', to: '林薇',
    steps: [{ stepId: 's1', app: 'wallet', action: 'economy.spend', compensator: { app: 'wallet', action: 'x' } }],
    createdAt: 1,
  });
  assert.equal(committed.undoState, UNDO_STATE.UNDOABLE, '全可补偿 ⇒ undoable');
  assert.equal(committed.compensableCount, 1);

  const partial = mapTransactionRow({
    id: 't2', status: 'committed', amount: 50,
    steps: [
      { stepId: 's1', app: 'wallet', compensator: { app: 'wallet', action: 'x' } },
      { stepId: 's2', app: 'asset', irreversible: true },
    ],
  });
  assert.equal(partial.undoState, UNDO_STATE.PARTIAL, '含不可逆步骤 ⇒ partial（不许说成可全撤）');
  assert.equal(partial.irreversibleCount, 1);

  /* ★ 已撤销压过一切：即便仍有 compensator，状态必须是 undone */
  const undone = mapTransactionRow({
    id: 't3', status: 'rolled_back', rolledBackAt: 123, compensationCount: 2,
    steps: [{ stepId: 's1', app: 'wallet', compensator: { app: 'wallet', action: 'x' } }],
  });
  assert.equal(undone.undoState, UNDO_STATE.UNDONE);
  assert.equal(undone.undone, true, '回滚过的行必须带 undone 标记（这是「看得见」的实现面）');
  assert.equal(undone.rolledBackAt, 123);
  assert.equal(undone.compensationCount, 2);

  assert.equal(mapTransactionRow({ id: 't4', status: 'pending' }).undoState, UNDO_STATE.PENDING);
  assert.equal(mapTransactionRow({ id: 't5', status: 'failed' }).undoState, UNDO_STATE.FAILED);
  assert.equal(mapTransactionRow({ id: 't6', status: 'BOGUS' }).undoState, UNDO_STATE.PENDING,
    '认不出的状态回落 pending（不许猜成 committed —— 那会让界面给一个撤不掉的按钮）');
});
test('A2 不合格行不补空壳（空壳＝假装有东西）+ 资产行形状', () => {
  assert.equal(mapTransactionRow(null), null);
  assert.equal(mapTransactionRow(undefined), null);
  assert.equal(mapTransactionRow(42), null);
  assert.equal(mapTransactionRow({}), null, '没有 id 的行必须丢（丢了才有 id 可点撤销）');
  const onlyId = mapTransactionRow({ id: 'x' });
  assert.ok(onlyId);
  assert.equal(onlyId.label, '未命名事务', '缺失字段给中性占位，不是编一个名字');
  assert.equal(onlyId.from, '未记');
  assert.equal(onlyId.to, '未记');
  assert.equal(onlyId.amount, 0);

  const asset = mapAssetRow({
    id: 'a1', title: '旧怀表', kind: 'relic', currentOwner: '林薇',
    provenanceChain: [{ event: 'mint', to: 'user' }, { event: 'transfer', to: '林薇' }],
  });
  assert.ok(asset);
  assert.equal(asset.currentOwner, '林薇');
  assert.equal(asset.provenanceLen, 2);
  assert.equal(asset.lastEvent, 'transfer', '最近事件取**末条**，不是首条');
  assert.equal(mapAssetRow({}), null, '没有 id 的资产行必须丢（转赠按钮靠它定位）');
});
test('A3 余额映射：一个可信数都没有时返回 null（不编 0 顶替）', () => {
  assert.equal(mapBalanceRow({}), null, '既无 currency 又无 trust ⇒ 不是「0 元」，是「读不到」');
  assert.equal(mapBalanceRow(null), null);
  const ok = mapBalanceRow({ currency: 0, trust: 50, locationReputation: { a: 1 } });
  assert.ok(ok, '0 元是**可信的数**（与「没有数」不同形）');
  assert.equal(ok.currency, 0);
  assert.equal(ok.locationCount, 1);
});
/* ══════════ B ── 三态不同形：读到有 / 读到空 / 读不到 ══════════ */
test('B1 中枢缺席 ⇒ 三面 null + mustShowWhy（读不到不许与「还没有」同形）', () => {
  const out = mergeEconomyFaces(null);
  assert.deepEqual(out.faces, { balances: null, transactions: null, assets: null });
  assert.equal(out.notes.mustShowWhy, true, '读不到必须要求视图明写');
  assert.notEqual(out.notes.why, 'ok');
  for (const k of ['balances', 'transactions', 'assets']) {
    assert.equal(out.faces[k], null, k + ' 面读不到必须是 null（不是 []）');
    assert.equal(out.counts[k], 0);
  }
});
test('B2 真源在场但空 ⇒ 三面为**空数组**（「还没有」），mustShowWhy 为假', () => {
  const store = new EconomyStore(mkStorage());
  const out = mergeEconomyFaces(store);
  assert.deepEqual(out.faces.transactions, [], '读到 0 笔 ⇒ 空数组（与 null 不同形）');
  assert.deepEqual(out.faces.assets, []);
  assert.ok(out.faces.balances, '真源初始有 1000 元 / 信任 50 ⇒ 余额面读得到');
  assert.equal(out.notes.mustShowWhy, false, '「还没有」不要求明写读不到');
  assert.equal(out.notes.why, 'ok');
});
test('B3 单面缺件与读抛错的归因**分开**（不许压成一句「坏了」）', () => {
  /* 只有 balance()，没有 list* ⇒ 事务/资产面记 no_store，余额面正常 */
  const partial = { balance: () => ({ currency: 5, trust: 1 }) };
  const a = mergeEconomyFaces(partial);
  assert.ok(a.faces.balances);
  assert.equal(a.faces.transactions, null);
  assert.equal(a.notes.perFace.transactions, 'no_store');
  assert.equal(a.notes.perFace.balances, 'ok', '在场的那一面不该被别面的缺件牵连');
  assert.equal(a.notes.mustShowWhy, true);

  /* 读取抛错 ⇒ read_threw（与 no_store 不同因） */
  const thrower = {
    balance: () => ({ currency: 1, trust: 1 }),
    listTransactions: () => { throw new Error('boom'); },
    listAssets: () => [],
  };
  const b = mergeEconomyFaces(thrower);
  assert.equal(b.faces.transactions, null);
  assert.equal(b.notes.perFace.transactions, 'read_threw', '抛错必须与「没有这个方法」分开归因');
  assert.notEqual(b.notes.perFace.transactions, b.notes.perFace.assets);
});
test('B4 撤销预览：未提交 / 已撤销的账**如实拒绝**，不装作能撤', () => {
  const pending = bridgePreviewUndo({ id: 't', status: 'pending', steps: [] });
  assert.equal(pending.canUndo, false);
  assert.match(pending.reason, /not-committed/);

  const done = bridgePreviewUndo({ id: 't', status: 'rolled_back', steps: [] });
  assert.equal(done.canUndo, false);
  assert.equal(done.reason, 'already-rolled-back', '已撤销的账不能二次撤销（那会把补偿执行两遍）');

  const ok = bridgePreviewUndo({
    id: 't', status: 'committed',
    steps: [{ stepId: 's1', app: 'wallet', compensator: { app: 'wallet', action: 'x' } }],
  });
  assert.equal(ok.canUndo, true);
  assert.equal(ok.reason, 'full-rollback');
  assert.equal(ok.compensationCount, 1);
});
/* ══════════ C ── 桥是纯读：不碰 storage、不写键 ══════════ */
test('C1 桥代码不碰 storage（剥注释后判动作，并用真源源码做分辨力对照）', () => {
  const bridge = codeOf(BRIDGE_REL);
  assert.ok(!/storage/.test(bridge), '桥里不得出现 storage');
  assert.ok(!/\.set\s*\(/.test(bridge), '桥里不得有写动作');
  assert.ok(!/new\s+EconomyStore/.test(bridge), '桥不得 new 真源（真源是活体，桥只是映射）');
  /* 分辨力对照：真源里**必须**有 storage —— 否则上面那条断言在「任何文件都不含」时也成立 */
  const store = codeOf(STORE_REL);
  assert.match(store, /storage/, '真源必须碰 storage（否则 C1 无分辨力）');
  assert.ok(!/^\s*import\s+.*economy-face-bridge/m.test(store), '真源不得反向依赖桥（依赖只能单向）');
});
test('C2 合并不改写入参、且产出新对象', () => {
  const store = new EconomyStore(mkStorage());
  const before = JSON.stringify(store.serialize());
  const out = mergeEconomyFaces(store);
  assert.notEqual(out, store, '桥不得把真源实例当返回值');
  assert.equal(JSON.stringify(store.serialize()), before, '读一遍不得改动真源（纯读）');
});
/* ══════════ D ── 持久化往返：三键一次写齐 / 一次读回 ══════════ */
test('D1 三键一次写齐（半截持久化会让「钱扣了资产没登记」）', () => {
  const st = mkStorage();
  const store = new EconomyStore(st);
  const r = store.startTransfer({ amount: 100, to: '林薇' });
  assert.equal(r.ok, true, '发起必须成功：' + r.reason);
  store.save();
  const keys = st._writes.map((w) => w.key);
  for (const k of [ECONOMY_KEYS.economy, ECONOMY_KEYS.assets, ECONOMY_KEYS.transactions]) {
    assert.ok(keys.includes(k), '三键必须都写：缺 ' + k);
  }
});
test('D2 冷启一次读回：余额/事务/资产逐字往返，脏行跳过不抛', () => {
  const st = mkStorage();
  const a = new EconomyStore(st);
  a.startTransfer({ amount: 200, to: '林薇' });
  a.startPurchase({ price: 300, assetTitle: '旧怀表' });
  a.save();

  const b = new EconomyStore(st);
  assert.equal(b.restore(), true);
  assert.equal(b.balance().currency, a.balance().currency, '余额必须逐字往返');
  assert.equal(b.listTransactions().length, a.listTransactions().length, '事务条数必须往返');
  assert.equal(b.listAssets().length, a.listAssets().length, '资产件数必须往返');

  /* 脏行：给个畸形存档，必须跳过而不是抛 */
  st.set(ECONOMY_KEYS.transactions, JSON.stringify([{ nope: 1 }, { txId: 'good' }, null]));
  const c = new EconomyStore(st);
  assert.equal(c.restore(), true, '脏存档不得抛');
  assert.equal(c.listTransactions().length, 1, '只有带 txId 的行留下');
});
/* ══════════ E ── 三步真走通：发起 → 提交 → 撤销 ══════════ */
test('E1 转账三步：发起真扣钱 → 提交 → 撤销后余额回到原值', () => {
  const store = new EconomyStore(mkStorage());
  const before = store.balance().currency;
  const started = store.startTransfer({ amount: 150, to: '林薇' });
  assert.equal(started.ok, true, '发起失败：' + started.reason);
  assert.equal(store.balance().currency, before - 150, '发起就该真扣钱（不是提交才扣）');
  const txId = started.tx.txId;

  /* 未提交的账不得撤销 */
  const early = store.previewUndo(txId);
  assert.equal(early.canUndo, false, '未提交不许撤销');
  assert.match(early.reason, /not-committed/);

  const committed = store.commit(txId);
  assert.equal(committed.ok, true, '提交失败：' + committed.reason);
  assert.equal(store.getTransaction(txId).status, 'committed');

  const pv = store.previewUndo(txId);
  assert.equal(pv.canUndo, true, '提交后可撤');
  assert.equal(pv.reason, 'full-rollback');

  const rb = store.rollback(txId);
  assert.equal(rb.ok, true, '撤销失败：' + rb.reason);
  assert.equal(rb.tx.partialRollback, false, '全可补偿的账撤销后不得标 partial');
  assert.equal(store.balance().currency, before, '★ 撤销后余额必须回到原值');
  /* ★ 撤销过的行**仍在列表里**（不许静默恢复） */
  const listed = store.listTransactions().find((t) => t.txId === txId);
  assert.ok(listed, '★ 撤销后行必须仍在列表（从列表消失＝静默恢复，计划明令禁止）');
  assert.equal(listed.status, 'rolled_back');
  assert.equal(listed.rolledBackAt > 0, true, '必须带撤销时间（用户看得见「这笔被撤销了」）');
});
test('E2 转赠：资产归属变更，撤销后归属回到原主（谱系留痕不抹）', () => {
  const store = new EconomyStore(mkStorage());
  const bought = store.startPurchase({ price: 100, assetTitle: '旧怀表' });
  assert.equal(bought.ok, true, '购置失败：' + bought.reason);
  const assetId = bought.tx.assetId;
  assert.equal(store.getAsset(assetId).currentOwner, 'user');

  const gift = store.startGift({ assetId, to: '林薇' });
  assert.equal(gift.ok, true, '转赠失败：' + gift.reason);
  assert.equal(store.getAsset(assetId).currentOwner, '林薇', '转赠后归属必须变更');
  const chainAfterGift = store.getAsset(assetId).provenanceChain.length;
  assert.equal(chainAfterGift, 2, 'mint + transfer 共两条');

  store.commit(gift.tx.txId);
  const rb = store.rollback(gift.tx.txId);
  assert.equal(rb.ok, true, '撤销转赠失败：' + rb.reason);
  assert.equal(store.getAsset(assetId).currentOwner, 'user', '★ 撤销后归属必须回到原主');
  assert.equal(store.getAsset(assetId).provenanceChain.length, 3,
    '★ 谱系留痕：撤销是**再加一条**归还记录，不是抹掉中间那条（抹掉就是静默恢复）');
});
test('E3 含不可逆步骤 ⇒ 撤销记「部分完成」，钱退回来但已铸的来历撤不掉', () => {
  const store = new EconomyStore(mkStorage());
  const before = store.balance().currency;
  const bought = store.startPurchase({ price: 400, assetTitle: '手稿' });
  assert.equal(bought.ok, true, '购置失败：' + bought.reason);
  const txId = bought.tx.txId;
  assert.equal(store.getTransaction(txId).steps.filter((s) => s.irreversible).length, 1,
    '购置必须含一步不可逆（铸资产会上链留谱系）');

  store.commit(txId);
  const pv = store.previewUndo(txId);
  assert.equal(pv.reason, 'partial-rollback', '含不可逆步骤 ⇒ 预告就说「只能部分撤」');
  assert.equal(pv.irreversibleCount, 1);

  const rb = store.rollback(txId);
  assert.equal(rb.ok, true, '部分撤销也必须成功：' + rb.reason);
  assert.equal(rb.reason, 'partial', '★ 中途失败/不可逆 ⇒ 状态是「部分完成」而不是「成功」');
  assert.equal(rb.tx.partialRollback, true, '★ 必须显式标 partialRollback');
  assert.equal(rb.tx.irreversibleSteps.length, 1, '不可逆步骤必须列出来（用户要知道哪一步撤不掉）');
  assert.equal(store.balance().currency, before, '钱这一面仍要退回来');
  assert.ok(store.getAsset(bought.tx.assetId), '★ 已铸资产的来历撤不掉 —— 这正是「部分」的含义');
});
test('E4 发起即落盘：三步各自的记录都要能扛过一次重载', () => {
  const st = mkStorage();
  const store = new EconomyStore(st);
  const r = store.startTransfer({ amount: 88, to: '林薇' });
  assert.equal(r.ok, true);
  /* ★ 发起这一步必须已经写盘 —— 否则重载后「发起」这条记录凭空消失，
   *   验收要求的三步各留一条可见记录就少了一步（本版实测修掉的缺陷）。 */
  const reopened = new EconomyStore(st);
  assert.equal(reopened.restore(), true);
  assert.equal(reopened.listTransactions().length, 1, '★ 发起后立即重载，那条记录必须还在');
  assert.equal(reopened.listTransactions()[0].status, 'pending', '重载后仍是待提交');
});
test('E5 失败路径如实回因，不静默成功', () => {
  const store = new EconomyStore(mkStorage());
  assert.equal(store.startTransfer({ amount: 0, to: 'x' }).ok, false);
  assert.equal(store.startTransfer({ amount: 0, to: 'x' }).reason, 'amount-must-be-positive');
  assert.equal(store.startTransfer({ amount: 999999, to: 'x' }).ok, false, '钱不够时必须失败');
  assert.equal(store.startTransfer({ amount: 999999, to: 'x' }).reason, 'insufficient-currency');
  assert.equal(store.startPurchase({ price: 1 }).reason, 'missing-asset-title');
  assert.equal(store.startGift({ assetId: 'nope', to: 'x' }).reason, 'asset-not-found');
  assert.equal(store.commit('nope').ok, false);
  assert.equal(store.rollback('nope').ok, false);
  /* 失败不得改动余额 */
  const before = store.balance().currency;
  store.startTransfer({ amount: 999999, to: 'x' });
  assert.equal(store.balance().currency, before, '失败的交易不得扣钱');
});
/* ══════════ F ── 接线自证 ══════════ */
test('F1 视图走 App 的 economyFace()，且视图不 import 桥、不碰真源', () => {
  const view = fs.readFileSync(path.join(ROOT, VIEW_REL), 'utf8');
  assert.match(view, /economyFace\(\)/, '视图必须经 App 的读口拿读数');
  assert.match(view, /economyStartTransfer|economyRollback/, '视图必须有可操作点（计划不许只读）');
  assert.ok(!/economy-face-bridge/.test(view), '视图不得 import 桥');
  assert.ok(!/economy-store/.test(view), '视图不得直接引用真源');
  assert.ok(!/subsystems/.test(view), '视图不得引用 subsystems');
});
test('F2 App 侧：读口/写口齐备，且三键字面量与 keys-audit 登记一致', () => {
  const app = fs.readFileSync(path.join(ROOT, APP_REL), 'utf8');
  for (const m of ['economyFace', 'economyPreviewUndo', 'economyGetAsset',
    'economyStartTransfer', 'economyStartPurchase', 'economyStartGift',
    'economyCommit', 'economyRollback']) {
    assert.match(app, new RegExp('\\b' + m + '\\s*\\('), 'App 缺 ' + m);
  }
  const src = fs.readFileSync(path.join(ROOT, STORE_REL), 'utf8');
  for (const k of ['ue_urban_economy_v1', 'la_living_assets_v1', 'et_economy_tx_v1']) {
    assert.ok(src.includes(k), '真源必须声明键 ' + k);
    assert.ok(fs.readFileSync(path.join(ROOT, 'scripts/keys-audit.mjs'), 'utf8').includes(k),
      '键 ' + k + ' 必须在 keys-audit 登记（未登记 ⇒ K1 红灯）');
  }
  /* 键必须写成 XXX_KEY 常量形式：写成对象属性会被 K3 判幽灵放行条 */
  assert.match(src, /const\s+ET_TX_STORAGE_KEY\s*=\s*'et_economy_tx_v1'/,
    '键必须按 XXX_KEY 常量形式声明（keys-audit 抽取器认这个形式）');
});
test('F3 换会话时真源作废重挂（三键随会话隔离，不带着上一角色的账本）', () => {
  const app = fs.readFileSync(path.join(ROOT, APP_REL), 'utf8');
  /* ★ 取**真方法定义**那一处，不是头注里提到的第一次出现：
   *   用 indexOf 会切到头注中间（实测踩到：注释里也写了 onChatChanged()）。 */
  const from = app.indexOf('    onChatChanged() {');
  assert.ok(from > 0, '必须找到 onChatChanged 的真定义');
  const seg = app.slice(from, from + 500);
  assert.match(seg, /_economyStore\s*=\s*null/, '换会话必须丢弃真源实例');
  assert.match(seg, /_economyLoaded\s*=\s*false/, '换会话必须允许重新读盘');
});
/* ══════════ G ── 负控制：真破坏源码，副本上重跑同款判据必须转红 ══════════ */
/** 递归复制同目录相对依赖（只抄单文件会 ERR_MODULE_NOT_FOUND）。 */
function copyWithRelDeps(rel, dstRoot) {
  const seen = new Set();
  const walk = (relPath) => {
    if (seen.has(relPath)) return;
    seen.add(relPath);
    const srcAbs = path.join(ROOT, relPath);
    const dstAbs = path.join(dstRoot, relPath);
    fs.mkdirSync(path.dirname(dstAbs), { recursive: true });
    fs.copyFileSync(srcAbs, dstAbs);
    const text = fs.readFileSync(srcAbs, 'utf8');
    const re = /from\s+'(\.[^']+)'/g;
    let m;
    while ((m = re.exec(text)) !== null) {
      const spec = m[1];
      /* ★ 必须同时收 `./x.js` 与 `../config/x.js`：只认 `./` 会让
       *   apps/ 下的副本缺 config/ 依赖 ⇒ ERR_MODULE_NOT_FOUND，
       *   负控制就变成「夹具坏了」而不是「判据转红」（实测踩到）。 */
      if (!spec.startsWith('.')) continue;
      const depRel = path.posix.normalize(path.posix.join(path.posix.dirname(relPath), spec));
      if (fs.existsSync(path.join(ROOT, depRel))) walk(depRel);
    }
  };
  walk(rel);
  return seen.size;
}
/** 破坏副本：anchor 必须**恰中 1 次**（中 0 次＝破坏写死在错处，中多次＝判据不纯）。 */
function cloneBroken(rel, anchor, repl) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rp_x2_'));
  const depCount = copyWithRelDeps(rel, dir);
  assert.ok(depCount >= 1, '夹具必须至少解析出一个依赖');
  const srcPath = path.join(ROOT, rel);
  const src = fs.readFileSync(srcPath, 'utf8');
  const hits = src.split(anchor).length - 1;
  assert.equal(hits, 1, '破坏锚点必须恰中 1 次，实中 ' + hits + ' 次');
  const broken = src.replace(anchor, repl);
  assert.notEqual(broken, src, '破坏必须真的改到源码');
  const dst = path.join(dir, rel);
  fs.writeFileSync(dst, broken, 'utf8');
  return { dir, file: dst };
}
const rmDir = (d) => { try { fs.rmSync(d, { recursive: true, force: true }); } catch (_e) { /* 忽略 */ } };

test('G1 负控制：抹掉「已撤销」压过其余 ⇒ E1 的「行仍在列表且带痕迹」判据转红', async () => {
  /* 锚点取 mapTransactionRow 里那一行（实中 1 次）：把 rolled_back 的判定挪到最后，
   *   于是已撤销的行会被判成 undoable —— 界面就会给一个「已撤销却还能再撤」的按钮。 */
  const { dir, file } = cloneBroken(BRIDGE_REL,
    "    if (status === TX_STATUS.ROLLED_BACK) undoState = UNDO_STATE.UNDONE;",
    "    if (false) undoState = UNDO_STATE.UNDONE; /* 破坏：已撤销不再压过其余 */");
  try {
    const mod = await import('file://' + file + '?v=' + Date.now());
    const row = mod.mapTransactionRow({ id: 't', status: 'rolled_back', steps: [] });
    /* ★ 负控制判据：破坏后**同款判据必须转红** —— 即不再是 undone（原版为 undone） */
    assert.notEqual(row.undoState, UNDO_STATE.UNDONE,
      '★ 破坏后已撤销的行不再判为 undone（实得 ' + row.undoState + '）—— 同款判据在副本上已转红');
    assert.equal(row.undoState, UNDO_STATE.UNDOABLE, '破坏后落到 undoable：界面会给出「已撤销却还能再撤」的按钮');
    /* 原版上同款判据必须仍为真（防怎么查都红） */
    const good = mapTransactionRow({ id: 't', status: 'rolled_back', steps: [] });
    assert.equal(good.undoState, UNDO_STATE.UNDONE, '原版必须是 undone');
  } finally { rmDir(dir); }
});
test('G2 负控制：撤销时把状态改了但**不退钱** ⇒ E1 的余额回原值判据转红', async () => {
  /* 模拟本仓最典型的形态：「状态对了、账没动」。锚点取 _applyCompensations 里退款那一行。 */
  const { dir, file } = cloneBroken(STORE_REL,
    "                            currency: safeNum(bal.currency, 0) + cur,",
    "                            currency: safeNum(bal.currency, 0) + 0, /* 破坏：退款不真退 */");
  try {
    const mod = await import('file://' + file + '?v=' + Date.now());
    const store = new mod.EconomyStore(mkStorage());
    const before = store.balance().currency;
    const r = store.startTransfer({ amount: 120, to: '林薇' });
    store.commit(r.tx.txId);
    const rb = store.rollback(r.tx.txId);
    assert.equal(rb.ok, true, '撤销本身仍应成功（状态改了）');
    assert.notEqual(store.balance().currency, before, '★ 破坏后余额没退回去（这就是「静默恢复」）');
    /* 原版上同款判据必须为真 */
    const good = new EconomyStore(mkStorage());
    const gb = good.balance().currency;
    const gr = good.startTransfer({ amount: 120, to: '林薇' });
    good.commit(gr.tx.txId);
    good.rollback(gr.tx.txId);
    assert.equal(good.balance().currency, gb, '原版必须退回原值');
  } finally { rmDir(dir); }
});
test('G3 负控制：撤销后把行从列表删掉 ⇒ 「不许静默恢复」判据转红', async () => {
  /* 锚点取 rollback 里替换事务行那一行：改成「过滤掉这一行」。 */
  const { dir, file } = cloneBroken(STORE_REL,
    "        this._txs = this._txs.map((t) => (t.txId === tx.txId ? rec : t));\n        this.save();\n        return { ok: true, reason: rec.partialRollback ? 'partial' : 'full', tx: rec, applied, failed };",
    "        this._txs = this._txs.filter((t) => t.txId !== tx.txId); /* 破坏：撤销＝从列表消失 */\n        this.save();\n        return { ok: true, reason: rec.partialRollback ? 'partial' : 'full', tx: rec, applied, failed };");
  try {
    const mod = await import('file://' + file + '?v=' + Date.now());
    const store = new mod.EconomyStore(mkStorage());
    const r = store.startTransfer({ amount: 30, to: '林薇' });
    store.commit(r.tx.txId);
    store.rollback(r.tx.txId);
    const listed = store.listTransactions().find((t) => t.txId === r.tx.txId);
    assert.equal(listed, undefined, '★ 破坏后撤销的行从列表消失了（正是计划禁止的静默恢复）');
    /* 原版上同款判据必须为真 */
    const good = new EconomyStore(mkStorage());
    const gr = good.startTransfer({ amount: 30, to: '林薇' });
    good.commit(gr.tx.txId);
    good.rollback(gr.tx.txId);
    assert.ok(good.listTransactions().find((t) => t.txId === gr.tx.txId), '原版必须留着那行');
  } finally { rmDir(dir); }
});
test('G4 负控制：视图自己 import 桥 ⇒ F1 的同款判据转红', async () => {
  const { dir, file } = cloneBroken(VIEW_REL,
    "export class WalletView {",
    "import { mergeEconomyFaces } from '../../config/economy-face-bridge.js'; /* 破坏：视图自己映射 */\nexport class WalletView {");
  try {
    const src = fs.readFileSync(file, 'utf8');
    assert.match(src, /economy-face-bridge/, '破坏后视图自己 import 了桥');
    const good = fs.readFileSync(path.join(ROOT, VIEW_REL), 'utf8');
    assert.ok(!/economy-face-bridge/.test(good), '原版视图不得 import 桥');
  } finally { rmDir(dir); }
});