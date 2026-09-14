// [v2.8.13] 召回主权改造测试: BM25 索引失效信号全覆盖
// 核心不变量: 任何桥外写入路径 (memoryCore.record/clear/reload 或 pool.add*)
// 之后, 桥的 _ensureIndex 必须通过版本戳或池条目数懒检测触发重建, 索引不陈旧。
import assert from 'node:assert/strict';

const results = [];
const ok = (name, cond, detail = '') => {
  if (cond) { results.push(name); console.log(`✓ ${name}`); }
  else { console.error(`✗ ${name} ${detail}`); process.exitCode = 1; }
};

// ---- MockStorage ----
class MockStorage {
  constructor() { this.data = {}; }
  get(k) { return this.data[k] || null; }
  set(k, v) { this.data[k] = v; }
  remove(k) { delete this.data[k]; }
}

const { MemoryCore } = await import('../apps/memory/memory-data.js');
const { LonShaBridge } = await import('../apps/memory/lonsha-bridge.js');

// ============================================================
// 1. MemoryCore 版本戳: 写入路径递增
// ============================================================
{
  const core = new MemoryCore(new MockStorage());
  ok('构造后 dataVersion 为数值', typeof core.dataVersion === 'number');
  const v0 = core.dataVersion;
  // record 走 _save 防抖 -> 立即化验证: record 内部调 _save(), 防抖延迟 800ms
  // 为同步验证, 直接调 _saveNow 模拟落盘出口
  core._saveNow();
  ok('_saveNow 递增版本戳', core.dataVersion === v0 + 1, `v0=${v0} now=${core.dataVersion}`);
  const v1 = core.dataVersion;
  core.clearCurrentChat();
  ok('clearCurrentChat 递增版本戳', core.dataVersion === v1 + 1, `v1=${v1} now=${core.dataVersion}`);
  const v2 = core.dataVersion;
  core.reload();
  ok('reload 递增版本戳', core.dataVersion > v2, `v2=${v2} now=${core.dataVersion}`);
}

// ============================================================
// 2. 桥懒检测: 版本戳漂移触发重建 (record 桥外写入场景)
// ============================================================
{
  const core = new MemoryCore(new MockStorage());
  // 预置一条长期记忆, 让索引非空
  core.longTerm.push({ id: 'm0', content: '初始记忆 关于咖啡馆的约定', floor: 1 });
  core._saveNow();
  const bridge = new LonShaBridge(new MockStorage(), core);
  bridge.enabled = true;

  // 首次召回: 建立索引并记录基线
  const r1 = bridge.recall('咖啡馆', 5);
  const seenV1 = bridge._seenVersion;
  const docs1 = bridge._bm25.N;
  ok('首次召回后索引非空', docs1 > 0, `N=${docs1}`);
  ok('首次召回命中初始记忆', r1.some(x => String(x.content).includes('咖啡馆')), JSON.stringify(r1).slice(0, 120));

  // 桥外写入: 直接 memoryCore.record (不经过桥) —— 这是此前的盲区
  core.longTerm.push({ id: 'm1', content: '全新记忆 关于图书馆的秘密', floor: 2 });
  core._saveNow(); // 模拟 record 触发的落盘, 版本戳递增
  ok('桥外写入后版本戳已漂移', core.dataVersion !== seenV1, `coreV=${core.dataVersion} seen=${seenV1}`);
  ok('桥外写入后 _bm25Dirty 未被桥置位 (证明是懒检测捕获而非桥置位)', bridge._bm25Dirty === false);

  // 再次召回: _ensureIndex 必须通过懒检测重建, 捕获新记忆
  const r2 = bridge.recall('图书馆', 5);
  ok('懒检测重建后索引条目数增加', bridge._bm25.N === docs1 + 1, `N=${bridge._bm25.N} expect=${docs1 + 1}`);
  ok('懒检测后能召回桥外新写入的记忆', r2.some(x => String(x.content).includes('图书馆')), JSON.stringify(r2).slice(0, 160));
  ok('重建后基线版本戳已同步', bridge._seenVersion === core.dataVersion);
}

// ============================================================
// 3. 池条目数懒检测: pool.add* 内存级变更 (不递增版本戳的盲区)
// ============================================================
{
  const core = new MemoryCore(new MockStorage());
  core.longTerm.push({ id: 'm0', content: '基础记忆', floor: 1 });
  core._saveNow();
  const bridge = new LonShaBridge(new MockStorage(), core);
  bridge.enabled = true;
  bridge.recall('基础', 5); // 建立索引
  const seenPool1 = bridge._seenPoolCount;
  const v1 = core.dataVersion;

  // 桥外直接 pool.addTemporal —— 纯内存变更, 可能不经 _saveNow
  core.pool.addTemporal('[事件] 深夜天台的对峙', { floor: 3 });
  ok('pool.addTemporal 不必然递增版本戳 (池内存级变更)', core.dataVersion === v1, `v=${core.dataVersion} v1=${v1}`);
  ok('pool.addTemporal 后池条目数已漂移', bridge._poolEntryCount() !== seenPool1,
     `pool=${bridge._poolEntryCount()} seen=${seenPool1}`);

  const r = bridge.recall('天台 对峙', 5);
  ok('池懒检测后能召回 pool.addTemporal 写入的事件', r.some(x => String(x.content).includes('天台')),
     JSON.stringify(r).slice(0, 160));
  ok('池懒检测重建后基线已同步', bridge._seenPoolCount === bridge._poolEntryCount());
}

// ============================================================
// 4. 反假接线: 无变更时不重建 (避免每次召回都全量重建)
// ============================================================
{
  const core = new MemoryCore(new MockStorage());
  core.longTerm.push({ id: 'm0', content: '稳定记忆', floor: 1 });
  core._saveNow();
  const bridge = new LonShaBridge(new MockStorage(), core);
  bridge.enabled = true;
  bridge.recall('稳定', 5);
  // 标记: 若 _ensureIndex 误判漂移, rebuild 会被调用
  let rebuildCalls = 0;
  const origRebuild = bridge._rebuildIndex.bind(bridge);
  bridge._rebuildIndex = () => { rebuildCalls++; origRebuild(); };
  bridge.recall('稳定', 5);
  bridge.recall('稳定', 5);
  ok('无数据变更时重复召回不触发重建', rebuildCalls === 0, `rebuildCalls=${rebuildCalls}`);
}

// ============================================================
// 5. 索引内容正确性: 重建后文档源覆盖 long/short/pool 三层
// ============================================================
{
  const core = new MemoryCore(new MockStorage());
  core.longTerm.push({ id: 'L1', content: '长期记忆层条目', floor: 1 });
  core.shortTerm.push({ id: 'S1', content: '短期缓冲层条目', floor: 1 });
  core.pool.addPerception('[关系] 角色A 信任 角色B', { floor: 2 });
  core._saveNow();
  const bridge = new LonShaBridge(new MockStorage(), core);
  bridge.enabled = true;
  const rLong = bridge.recall('长期记忆层', 5);
  const rShort = bridge.recall('短期缓冲层', 5);
  const rPool = bridge.recall('信任', 5);
  ok('索引覆盖长期记忆层', rLong.some(x => String(x.content).includes('长期记忆层')));
  ok('索引覆盖短期缓冲层', rShort.some(x => String(x.content).includes('短期缓冲层')));
  ok('索引覆盖记忆池感知层', rPool.some(x => String(x.content).includes('信任')));
}

console.log(`\n[recall-sovereignty] ${results.length} 项断言全部通过`);