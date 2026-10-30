/* ============================================================
 * tests/system-v4992.test.mjs — R11-X1 验收：人物档案面（背包 / 档案 / 卷宗）
 * ------------------------------------------------------------
 * 【这一项为什么单列】
 *   `InventoryBackpackManager` / `CharacterDossierManager` / `VolumeChronicleManager`
 *   三件早在 v4.57.0 就挂进了 `subsystem-orchestrator`（`subsystems.backpack/.dossiers/.volumes`），
 *   `scripts/keys-audit.mjs` 也逐键登记了三把落盘键 —— 但**产品端零 import、
 *   零 storage.set**（修前全仓 grep 实测）。于是「角色随身物 / 关系记录 / 分卷回顾」
 *   在手机上完全答不出：这不是数据不够，是**数据没有出口**。
 *   X6（notification-hub-bridge）确立了「中枢 → 桥 → 视图」的装配模板，本项是第二个消费者，
 *   也是第一次把**写口**接进产品（X6 只读 + 已读回写）。
 *
 * 【覆盖】
 *   A 纯映射：三件行的形状不同，映射必须显式（id/name/status、formattedAttitudeText、
 *     index/title/timeRange）；不合格行不补空壳
 *   B 三态不同形：读到了有 N 条 / 读到了 0 条 / **读不到** —— 压成同一形即粉饰
 *   C 桥是纯读：不碰 storage、不写任何键（剥注释后判**代码**）
 *   D 持久化往返：serialize → restore 内容逐字等值，且 restore **不重走 registerItem**
 *     （那会把「读档」变成「再次获得」：每重载一次多一条 acquired 历史）
 *   E App 写口：一次写齐三键 / 一次读回三键 / 中枢缺席时不静默成功
 *   F 接线自证：视图真走 app.archiveFace()、视图不 import 桥、不碰 subsystems
 *   G 负控制：真破坏源码 → 在副本上重跑同款判据必须转红
 * ============================================================ */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  mapBackpackRow, mapDossierRow, mapVolumeRow, mergeArchiveFaces,
} from '../config/archive-face-bridge.js';
import { InventoryBackpackManager } from '../config/inventory-backpack.js';
import { CharacterDossierManager } from '../config/character-dossier.js';
import { VolumeChronicleManager } from '../config/volume-chronicle.js';
import { CharsApp } from '../apps/chars/chars-app.js';

const __dir = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dir, '..');
const APP_REL = 'apps/chars/chars-app.js';
const VIEW_REL = 'apps/chars/chars-view.js';
const BRIDGE_REL = 'config/archive-face-bridge.js';

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
/** 真三件 + 假 storage 的中枢夹具（形状与 index.js:2048 的组装一致）。 */
function mkHub() {
  return {
    backpack: new InventoryBackpackManager(),
    dossiers: new CharacterDossierManager(),
    volumes: new VolumeChronicleManager(),
  };
}
function mkApp(hub, storage) {
  const shell = { showNotification: () => {}, screen: null, layerHost: () => null };
  const win = { VirtualPhone: { subsystems: hub } };
  return { app: new CharsApp(shell, storage || mkStorage()), win };
}
/* ══════════ A ── 纯映射：三件行形状不同，必须显式 ══════════ */
test('A1 背包行映射：id/name/status 三样都必须搬到正确字段（搬错 ⇒ 界面显示未命名 / 状态永远 held）', () => {
  const raw = {
    id: 'item_1', name: '旧怀表', owner: 'protagonist', source: '祖父遗物',
    significance: '纪念物', status: 'lost',
    history: [{ action: 'acquired', to: 'protagonist', at: 1 }, { action: 'lost', at: 2 }],
  };
  const row = mapBackpackRow(raw, 'protagonist');
  assert.ok(row);
  assert.equal(row.id, 'item_1', 'id 必须原样带出（转赠/消耗按钮都靠它定位）');
  assert.equal(row.name, '旧怀表');
  assert.equal(row.status, 'lost', 'status 必须原样带出（否则「已遗失」显示成「持有中」）');
  assert.equal(row.historyLen, 2, '历史条数必须带出（界面要能说清它被转过几次）');
  assert.equal(row.lastAction, 'lost', '最后一次动作必须取**末条**，不是首条');
  assert.equal(row.source, '祖父遗物');
});
test('A2 背包行非法状态回落 held，但非法行本身不补空壳（补空壳＝假装有东西）', () => {
  assert.equal(mapBackpackRow({ id: 'x', name: 'n', status: 'BOGUS' }, 'p').status, 'held',
    '认不出的状态回落 held —— 但**必须**在历史里留痕由 D 面管，这里只保证不崩');
  assert.equal(mapBackpackRow(null), null);
  assert.equal(mapBackpackRow(undefined), null);
  assert.equal(mapBackpackRow(42), null);
  assert.equal(mapBackpackRow([]), null);
  assert.equal(mapBackpackRow({}), null, '没有 id 的行必须丢（丢了才有 id 可点按钮）');
  const onlyId = mapBackpackRow({ id: 'x' });
  assert.ok(onlyId, '只有 id 没有 name 的行**保留**并给默认名（丢它会丢失可点条目）');
  assert.equal(onlyId.name, '未命名物品');
});
test('A3 档案行映射：formattedAttitudeText 与偏移说明都要显式搬', () => {
  const raw = {
    name: '林薇', identity: '青梅', formattedAttitudeText: '关系：挚友；态度：信任但有隐瞒',
    personalityShift: { behavior: '避开目光', meaning: '内心有愧', avoidReadingAs: '讨厌对方',
      statement: '避开目光 = 内心有愧 | 不要理解为讨厌对方' },
    recentInteractions: '上周一起看了电影', experienceBrief: '一起长大',
  };
  const row = mapDossierRow(raw);
  assert.equal(row.name, '林薇');
  assert.equal(row.formattedAttitudeText, '关系：挚友；态度：信任但有隐瞒',
    '态度文本必须原样搬（这是档案面唯一的人物关系读数）');
  assert.equal(row.hasShift, true);
  assert.match(row.shiftSummary, /内心有愧/, '偏移说明必须带出（丢了就等于「性格状态稳定」的谎）');
  assert.equal(mapDossierRow(null), null);
  assert.equal(mapDossierRow({}), null, '没有 name 的档案行必须丢（按名直取，无名不可取）');
});
test('A4 卷宗行映射：index/title/timeRange 与两个计数都要显式搬', () => {
  const raw = { index: 3, title: '第三章·雨夜', timeRange: '春季第 12–28 天',
    entryCount: 40, majorEventCount: 5, characters: ['林薇', '陈默'] };
  const row = mapVolumeRow(raw);
  assert.equal(row.index, 3);
  assert.equal(row.title, '第三章·雨夜');
  assert.equal(row.timeRange, '春季第 12–28 天');
  assert.equal(row.entryCount, 40);
  assert.equal(row.majorEventCount, 5);
  assert.deepEqual(row.characters, ['林薇', '陈默']);
  assert.equal(mapVolumeRow(null), null);
  /* 卷宗允许只有 index（title 可派生）—— 这是三件里唯一「缺名不丢」的 */
  assert.equal(mapVolumeRow({ index: 2 }).title, '第2卷');
});
/* ══════════ B ── 三态必须不同形 ══════════ */
test('B1 三态不同形：有数据 / 有中枢但空 / 读不到 —— 三者必须可分辨', () => {
  const full = mkHub();
  full.backpack.registerItem({ name: '钥匙' });
  full.dossiers.upsertDossier({ name: '林薇', identity: '青梅' });
  full.volumes.syncVolumes([{ index: 1, title: '首卷', entryCount: 10 }]);
  const has = mergeArchiveFaces(full);
  assert.equal(has.notes.mustShowWhy, false, '全读到了：不该要求视图明写读不到');
  assert.equal(has.notes.why, 'ok');
  assert.equal(has.counts.backpack, 1);
  assert.equal(has.counts.dossiers, 1);
  assert.equal(has.counts.volumes, 1);
  assert.equal(has.counts.volumeStats.totalEntriesArchived, 10, '卷宗统计必须一起带出');

  const empty = mergeArchiveFaces(mkHub());
  assert.equal(empty.notes.mustShowWhy, false, '中枢在场但全空 —— 是「还没有」，不是「读不到」');
  assert.deepEqual(empty.faces.backpack, [], '空必须是空数组（与 null 不同形）');
  assert.deepEqual(empty.faces.dossiers, []);
  assert.deepEqual(empty.faces.volumes, []);

  const broke = mergeArchiveFaces(null);
  assert.equal(broke.notes.mustShowWhy, true, '中枢缺席必须要求视图明写读不到');
  assert.equal(broke.notes.why, 'no_subsystems');
  assert.equal(broke.faces.backpack, null, '读不到必须是 null（与空数组不同形）');
  assert.equal(broke.faces.dossiers, null);
  assert.equal(broke.faces.volumes, null);
  assert.notDeepEqual(broke.faces.backpack, empty.faces.backpack,
    '★「读不到」与「还没有」在数据结构上必须不同形（压成同一形＝粉饰）');
});
test('B2 单面缺件：只缺背包时另两面照常出数，why 如实说缺哪一面', () => {
  const hub = mkHub();
  delete hub.backpack;
  hub.dossiers.upsertDossier({ name: '林薇' });
  const r = mergeArchiveFaces(hub);
  assert.equal(r.faces.backpack, null, '缺的那面必须是 null');
  assert.equal(r.notes.mustShowWhy, true);
  assert.equal(r.notes.why, 'no_backpack', 'why 必须指名道姓，不许只说「坏了」');
  assert.equal(r.faces.dossiers.length, 1, '另一面不得被连坐');
});
test('B3 读抛错归因独立：某面 listByOwner 抛错不得把整面拖空', () => {
  const hub = mkHub();
  hub.backpack.listByOwner = () => { throw new Error('boom'); };
  hub.dossiers.upsertDossier({ name: '林薇' });
  const r = mergeArchiveFaces(hub);
  assert.equal(r.faces.backpack, null);
  assert.equal(r.notes.why, 'backpack_read_threw', '抛错与「缺件」必须分开归因');
  assert.equal(r.faces.dossiers.length, 1, '抛错面之外的读数必须保住');
});
/* ══════════ C ── 桥是纯读 ══════════ */
test('C1 桥的**代码**不碰 storage（注释里说明不算 —— 判据判动作不判字眼）', () => {
  const raw = fs.readFileSync(path.join(ROOT, BRIDGE_REL), 'utf8');
  const code = raw
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^\s*\/\/.*$/gm, ' ');
  assert.ok(!/\bstorage\b/.test(code), '桥代码里不得出现 storage');
  assert.ok(!/localStorage|indexedDB/.test(code), '桥不得直接摸任何持久化载体');
  assert.ok(!/\.set\(/.test(code), '桥不得写任何键');
  /* 自证判据有分辨力：同一手法用在真会写盘的文件上必须命中 */
  const writer = fs.readFileSync(path.join(ROOT, APP_REL), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');
  assert.ok(/\bstorage\b/.test(writer), '对照：App 代码里确实有 storage（证明上面那条判据不是怎么查都过）');
});
test('C2 合并不改写入参：中枢的 Map 是唯一活实例，桥不许就地加工行对象', () => {
  const hub = mkHub();
  hub.backpack.registerItem({ id: 'i1', name: '钥匙' });
  const before = JSON.stringify(hub.backpack.listByOwner('protagonist', false));
  const r = mergeArchiveFaces(hub);
  assert.equal(JSON.stringify(hub.backpack.listByOwner('protagonist', false)), before,
    '合并过程改写了中枢里的行（那就是在造第二份真源）');
  assert.notEqual(r.faces.backpack[0], hub.backpack.items.get('i1'),
    '映射必须产出**新对象**（同一引用意味着视图能改到中枢本体）');
});
/* ══════════ D ── 持久化往返 ══════════ */
test('D1 背包往返：serialize → restore 内容逐字等值，且历史**不重新生成**', () => {
  const a = new InventoryBackpackManager();
  a.registerItem({ id: 'i1', name: '怀表', status: 'held' });
  a.transferItem('i1', '林薇', '赠予');
  const snap = a.serialize();
  const b = new InventoryBackpackManager();
  assert.equal(b.restore(snap), true);
  const ra = a.listByOwner('林薇', false);
  const rb = b.listByOwner('林薇', false);
  assert.equal(rb.length, 1, '转赠后的持有者必须被恢复（否则读档后东西回到主角身上）');
  assert.equal(rb[0].name, '怀表');
  assert.deepEqual(rb[0].history, ra[0].history,
    '★ 历史必须原样恢复：restore 若重走 registerItem，每次读档都会**多一条 acquired** —— '
    + '那正是「读档」被做成「再次获得」的形态');
  assert.equal(rb[0].history.length, 2, 'acquired + transfer，恰好两条');
});
test('D2 档案往返：走自己的 upsert 语义重建，脏行跳过不抛', () => {
  const a = new CharacterDossierManager();
  a.upsertDossier({ name: '林薇', identity: '青梅' });
  a.recordPersonalityShift('林薇', { behavior: '避开目光', meaning: '有愧', avoidReadingAs: '讨厌' });
  const b = new CharacterDossierManager();
  assert.equal(b.restore(a.serialize()), true);
  const d = b.getDossier('林薇');
  assert.ok(d, '档案必须按名恢复');
  assert.match(d.personalityShift.statement, /有愧/, '偏移说明必须一起恢复');
  assert.equal(b.restore({ version: 1, dossiers: [null, 42, {}] }), true,
    '脏行不抛（读档不该因为一条脏数据整页失败）');
  assert.equal(b.listDossierSummaries().length, 0, '脏行必须被跳过，不许变成一条空档案');
});
test('D3 卷宗往返：直接走 syncVolumes 归一，无卷视为有效载荷', () => {
  const a = new VolumeChronicleManager();
  a.syncVolumes([{ index: 2, title: '第二卷', entryCount: 7, majorEventCount: 2 }]);
  const b = new VolumeChronicleManager();
  assert.equal(b.restore(a.serialize()), true);
  assert.equal(b.getStats().totalVolumes, 1);
  assert.equal(b.getStats().totalEntriesArchived, 7);
  assert.equal(b.restore({ version: 1, volumes: [] }), true, '空数组是有效载荷（不是失败）');
  assert.equal(b.restore(null), false, 'null 必须如实报 false');
});
/* ══════════ E ── App 写口 ══════════ */
test('E1 三键一次写齐：任一操作都落三把键（不做「只写改动的那一件」的半截持久化）', async () => {
  const hub = mkHub();
  const { app, win } = mkApp(hub);
  await withWin(win, async () => {
    const storage = app.storage;
    app.archiveRegisterItem({ name: '钥匙' });
    const keys = storage._writes.map((w) => w.key);
    assert.ok(keys.includes('ibp_inventory_backpack_v1'), '背包键必须写');
    assert.ok(keys.includes('cds_character_dossier_v1'), '档案键必须一起写（三件同源，缺一件就是半截存档）');
    assert.ok(keys.includes('vch_volume_chronicle_v1'), '卷宗键必须一起写');
  });
});
test('E2 三键一次读回：写 → 新建实例 → 读回，数据必须回来', async () => {
  const hub = mkHub();
  const { app, win } = mkApp(hub);
  const storage = app.storage;
  await withWin(win, async () => {
    app.archiveRegisterItem({ id: 'i1', name: '怀表' });
    app.archiveUpsertDossier({ name: '林薇', identity: '青梅' });
    app.archiveTransferItem('i1', '林薇', '赠予');
  });
  /* 换一套全新的中枢（模拟冷启）但同一份 storage */
  const hub2 = mkHub();
  const shell = { showNotification: () => {}, screen: null, layerHost: () => null };
  const app2 = new CharsApp(shell, storage);
  await withWin({ VirtualPhone: { subsystems: hub2 } }, async () => {
    assert.equal(app2._archiveRestoreAll(), true);
    const face = app2.archiveFace();
    /* ★ 转赠后持有者是「林薇」，故 protagonist 面为空 —— 这本身是本套件的判据点：
     *   过滤按 owner 走，读回不得把别处的东西算到主角头上。空数组 ≠ null。 */
    assert.deepEqual(face.faces.backpack, [], '主角面必须为空数组（物品已转赠出去），不是 null');
    const linFace = app2.archiveFace({ owner: '林薇' });
    assert.equal(linFace.counts.backpack, 1, '林薇面必须读回那一件');
    assert.equal(linFace.faces.backpack[0].name, '怀表');
    assert.equal(linFace.faces.backpack[0].owner, '林薇', '转赠后的持有者必须读回');
    assert.equal(face.counts.dossiers, 1, '档案必须读回');
    assert.equal(face.faces.dossiers[0].name, '林薇');
  });
});
test('E3 中枢缺席时不静默成功：写口返回 false、读面 why 如实', async () => {
  const shell = { showNotification: () => {}, screen: null, layerHost: () => null };
  const app = new CharsApp(shell, mkStorage());
  /* ★ 归因分两档：完全没有宿主 VirtualPhone（no_host）与有宿主但没有子系统（no_subsystems）。
   *   两档都要求「写口如实返回 false、读面明写读不到」，但 why 必须**分开**——
   *   把两档压成一句「坏了」正是本仓一直在治的形态。 */
  await withWin({ VirtualPhone: {} }, async () => {
    assert.equal(app._archiveSaveAll(), false, '没有中枢时必须如实返回 false（不许假装写了）');
    const face = app.archiveFace();
    assert.equal(face.faces.backpack, null);
    assert.equal(face.notes.mustShowWhy, true);
    assert.equal(face.notes.why, 'no_host', '宿主上没有 subsystems ⇒ 归因必须是 no_host');
    assert.throws(() => app.archiveRegisterItem({ name: 'x' }), /档案中枢不可用/,
      '写口在没有中枢时必须抛（抛错才有人能看见，返回 undefined 就是静默失败）');
  });
  await withWin({ VirtualPhone: { subsystems: {} } }, async () => {
    assert.equal(app._archiveSaveAll(), false);
    assert.equal(app.archiveFace().notes.why, 'no_subsystems',
      '有子系统容器但三件缺位 ⇒ 归因必须是 no_subsystems（与 no_host 分开）');
  });
});
test('E4 七个写口全在且各自真写：registerItem / transferItem / changeItemStatus / upsertDossier / recordShift / getDossier / getVolume', async () => {
  const hub = mkHub();
  const { app, win } = mkApp(hub);
  await withWin(win, async () => {
    for (const m of ['archiveRegisterItem', 'archiveTransferItem', 'archiveChangeItemStatus',
      'archiveUpsertDossier', 'archiveRecordShift', 'archiveGetDossier', 'archiveGetVolume']) {
      assert.equal(typeof app[m], 'function', m + ' 必须存在（计划要求每块都有可操作点）');
    }
    app.archiveRegisterItem({ id: 'i1', name: '钥匙' });
    app.archiveUpsertDossier({ name: '林薇' });
    app.archiveRecordShift('林薇', { behavior: '沉默', meaning: '不安', avoidReadingAs: '冷漠' });
    assert.match(app.archiveGetDossier('林薇').personalityShift.statement, /不安/);
    app.archiveChangeItemStatus('i1', 'consumed', '用掉了');
    assert.equal(hub.backpack.listByOwner('protagonist', false)[0].status, 'consumed');
    assert.equal(app.archiveGetVolume(1), null, '无此卷必须返回 null（不许造一条空卷）');
    hub.volumes.syncVolumes([{ index: 1, title: '首卷' }]);
    assert.equal(app.archiveGetVolume(1).title, '首卷');
  });
});
/* ══════════ F ── 接线自证 ══════════ */
test('F1 视图真走 App 的 archiveFace()，且视图不 import 桥、不碰 subsystems', () => {
  const appSrc = fs.readFileSync(path.join(ROOT, APP_REL), 'utf8');
  assert.match(appSrc, /import\s*\{\s*mergeArchiveFaces\s*\}\s*from\s*'\.\.\/\.\.\/config\/archive-face-bridge\.js'/,
    'App 必须真 import 桥');
  assert.match(appSrc, /archiveFace\(opts\)\s*\{/, 'App 必须暴露 archiveFace()');
  assert.match(appSrc, /_resolveArchiveHub\(\)/, 'App 必须有中枢解析口');
  /* 能力探测住在**桥**里（与 X6 同款分工：App 只解析实例，桥才判「这一版有没有这一面」），
   * 故这条判据对着桥的源码判，不对着 App 判 —— 对着 App 判就是判一个不存在的动作。 */
  const bridgeSrc = fs.readFileSync(path.join(ROOT, BRIDGE_REL), 'utf8');
  assert.match(bridgeSrc, /typeof hub\.backpack\.listByOwner === 'function'/, '桥必须对背包面做能力探测');
  assert.match(bridgeSrc, /typeof hub\.dossiers\.listDossierSummaries === 'function'/, '桥必须对档案面做能力探测');
  assert.match(bridgeSrc, /typeof hub\.volumes\.getStats === 'function'/, '桥必须对卷宗面做能力探测');
  const viewSrc = fs.readFileSync(path.join(ROOT, VIEW_REL), 'utf8');
  assert.match(viewSrc, /this\.app\.archiveFace\(\)/, '视图必须走 App 的 archiveFace()');
  assert.ok(!/subsystems/.test(viewSrc), '视图不得自己碰中枢（碰了就是第二份「怎么读」的口径）');
  assert.ok(!/archive-face-bridge/.test(viewSrc), '视图不得 import 桥（映射只能有一处）');
  assert.match(viewSrc, /_archiveCard\(/, '视图必须有档案卡');
  assert.match(viewSrc, /不是「读不到」|读不到（这是「读不到」/, '读不到时必须明写它不等于「还没有」');
});
test('F2 视图三态文案都在：读不到 / 还没有 / 正常列表 —— 各有独立措辞', () => {
  const viewSrc = fs.readFileSync(path.join(ROOT, VIEW_REL), 'utf8');
  assert.match(viewSrc, /读不到（这是「读不到」，不是「没有物品」）/, '背包面空/读不到必须不同形');
  assert.match(viewSrc, /读不到（这是「读不到」，不是「没有档案」）/);
  assert.match(viewSrc, /读不到（这是「读不到」，不是「没有卷」）/);
  assert.match(viewSrc, /还没有录入物品/, '空态措辞必须另有一套');
  assert.match(viewSrc, /还没有登记的档案/);
  assert.match(viewSrc, /还没有封存的卷宗/);
});
test('F3 三件管理器各自带 serialize/restore（持久化契约归数据主，不归 App）', () => {
  for (const [rel, cls] of [
    ['config/inventory-backpack.js', 'InventoryBackpackManager'],
    ['config/character-dossier.js', 'CharacterDossierManager'],
    ['config/volume-chronicle.js', 'VolumeChronicleManager'],
  ]) {
    const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    assert.match(src, new RegExp('class\\s+' + cls), rel + ' 必须仍导出 ' + cls);
    assert.match(src, /serialize\(\)\s*\{/, rel + ' 必须有 serialize()');
    assert.match(src, /restore\(data\)\s*\{/, rel + ' 必须有 restore(data)');
  }
});
/* ══════════ G ── 负控制：真破坏源码，副本上重跑同款判据必须转红 ══════════ */
/** 递归复制同目录相对依赖（X6 同款修法：只抄单文件会 ERR_MODULE_NOT_FOUND）。 */
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
      if (!spec.startsWith('./')) continue;
      const depRel = path.posix.normalize(path.posix.join(path.posix.dirname(relPath), spec));
      if (fs.existsSync(path.join(ROOT, depRel))) walk(depRel);
    }
  };
  walk(rel);
  return seen.size;
}
/** 破坏副本：anchor 必须**恰中 1 次**（中 0 次＝破坏写死在错处，中多次＝判据不纯）。 */
function cloneBroken(rel, anchor, repl) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rp_x1_'));
  const depCount = copyWithRelDeps(rel, dir);
  assert.ok(depCount >= 1, '夹具必须至少解析出一个依赖（解析为零说明这段变成了空动作）');
  const srcPath = path.join(ROOT, rel);
  const src = fs.readFileSync(srcPath, 'utf8');
  const hits = src.split(anchor).length - 1;
  assert.equal(hits, 1, '破坏锚点必须恰中 1 次，实中 ' + hits + ' 次（锚点漂了，负控制就成了空动作）');
  const broken = src.replace(anchor, repl);
  assert.notEqual(broken, src, '破坏必须真的改到源码（否则这条负控制是自我实现）');
  const dst = path.join(dir, rel);
  fs.writeFileSync(dst, broken, 'utf8');
  return { dir, file: dst };
}
const rmDir = (d) => { try { fs.rmSync(d, { recursive: true, force: true }); } catch (_e) { /* 忽略 */ } };
test('G1 负控制：把中枢缺席的归因抹掉 ⇒ B1 的 mustShowWhy 判据在副本上转红', async () => {
  /* ★ 锚点用 `notes.mustShowWhy = false;`（实中 1 次）而不是 `= true`（实中 8 次）：
   *   破坏必须**恰中一处**，否则改的是「任意一处」，判据就分不清是哪条坏了。 */
  const { dir, file } = cloneBroken(BRIDGE_REL,
    "const notes = { why: 'ok', mustShowWhy: false };",
    "const notes = { why: 'ok', mustShowWhy: true }; /* 破坏：空表也要求明写读不到 */");
  try {
    const mod = await import('file://' + file + '?v=' + Date.now());
    const out = mod.mergeArchiveFaces(mkHub());
    /* 原版上这条为 false（中枢在场但空 = 「还没有」，不要求明写读不到）；破坏后必须变 true */
    assert.equal(out.notes.mustShowWhy, true, '破坏后「还没有」被冒充成「读不到」');
    const good = mergeArchiveFaces(mkHub());
    assert.equal(good.notes.mustShowWhy, false, '原版上同款判据必须仍为假（防怎么查都红）');
  } finally { rmDir(dir); }
});
test('G2 负控制：把背包的 null 改成 [] ⇒ 「读不到」与「还没有」同形，B1 判据转红', async () => {
  const { dir, file } = cloneBroken(BRIDGE_REL,
    'const faces = { backpack: null, dossiers: null, volumes: null };',
    'const faces = { backpack: [], dossiers: [], volumes: [] }; /* 破坏：读不到与空同形 */');
  try {
    const mod = await import('file://' + file + '?v=' + Date.now());
    const broke = mod.mergeArchiveFaces(null);
    assert.deepEqual(broke.faces.backpack, [], '破坏后读不到与空同形');
    assert.notDeepEqual(broke.faces.backpack, null, '破坏必须可观测地改行为');
    const good = mergeArchiveFaces(null);
    assert.equal(good.faces.backpack, null, '原版上必须是 null');
  } finally { rmDir(dir); }
});
test('G3 负控制：restore 不保留 history ⇒ 每条被重置成空历史，D1 判据转红', async () => {
  /* 锚点取 restore 里那一行（实中 1 次）：把「原样保留历史」换成「恒给空数组」。 */
  const { dir, file } = cloneBroken('config/inventory-backpack.js',
    'history: Array.isArray(it.history) ? it.history : [],',
    'history: [], /* 破坏：读档丢弃历史 */');
  try {
    const mod = await import('file://' + file + '?v=' + Date.now());
    const a = new mod.InventoryBackpackManager();
    a.registerItem({ id: 'i1', name: '怀表' });
    a.transferItem('i1', '林薇', '赠予');
    const b = new mod.InventoryBackpackManager();
    b.restore(a.serialize());
    const row = b.listByOwner('林薇', false)[0];
    assert.equal(row.history.length, 0, '★ 破坏后历史被清空 —— 这正是「读档把被转过这件事抹掉」');
    assert.notEqual(row.history.length, 2, '破坏必须可观测地改行为');
    /* 原版上同款判据仍为真 */
    const a2 = new InventoryBackpackManager();
    a2.registerItem({ id: 'i1', name: '怀表' });
    a2.transferItem('i1', '林薇', '赠予');
    const b2 = new InventoryBackpackManager();
    b2.restore(a2.serialize());
    assert.equal(b2.listByOwner('林薇', false)[0].history.length, 2, '原版上历史必须完整保留');
  } finally { rmDir(dir); }
});
test('G4 负控制：视图自己 import 桥 ⇒ F1 的同款判据在副本上转红', () => {
  /* ★ 视图当前**一个 import 都没有**（自足单文件）：锚点只能取头注后的第一行代码。 */
  const { dir, file } = cloneBroken(VIEW_REL,
    "export class CharsView {",
    "import { mergeArchiveFaces } from '../../config/archive-face-bridge.js'; /* 破坏：视图自己映射 */\nexport class CharsView {");
  try {
    const src = fs.readFileSync(file, 'utf8');
    assert.match(src, /archive-face-bridge/, '破坏后视图自己 import 了桥');
    const good = fs.readFileSync(path.join(ROOT, VIEW_REL), 'utf8');
    assert.ok(!/archive-face-bridge/.test(good), '原版视图不得 import 桥');
  } finally { rmDir(dir); }
});
