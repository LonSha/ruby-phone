/* [v4.136.0 · V18-R] RubyPhone 演化去重抑制与跨会话落盘闭环测试 */
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

test('R18-O1 演化边跨会话落盘、恢复与演化换代抑制过滤', async () => {
  const mod = await import(pathToFileURL(path.join(ROOT, 'apps/memory/lonsha-bridge.js')).href);
  const store = { data: {}, get(k) { return this.data[k]; }, set(k, v) { this.data[k] = v; } };
  const bridge = new mod.LonShaBridge(store);

  // 1. 记录演化替代边：旧记忆已演化换代为新记忆
  const olderKey = 'sum_10';
  const newerKey = 'sum_25';
  bridge.recordEvolutionLink(olderKey, newerKey, 'evolution');
  assert.equal(bridge.hasSupersedingEvolution(olderKey), true, 'olderKey 必须被标记为已被演化替代');
  assert.equal(bridge.hasSupersedingEvolution(newerKey), false, 'newerKey 是最新节点，不应被演化替代');

  // 2. 跨会话落盘与水合重载
  const reborn = new mod.LonShaBridge(store);
  assert.equal(reborn.hasSupersedingEvolution(olderKey), true, '跨会话恢复后演化替代状态必须完整保留');
  assert.equal(reborn._pyramidEvolutionLinks.length, 1, '演化边表恢复条数一致');

  // 3. 真实 recall() 链路中的演化抑制过滤
  reborn.memoryCore = { dataVersion: -1 };
  reborn._bm25.N = 3;
  reborn._bm25Dirty = false;
  reborn._bm25.search = () => [
    { id: 'sum_10', text: '旧版情报：目标在西区仓库出没', score: 0.90, source: 'summary', floor: 10 },
    { id: 'sum_25', text: '新版情报：目标已转移至北区港口', score: 0.85, source: 'summary', floor: 25 },
    { id: 'fact_99', text: '常规事实：西区港口今日封港', score: 0.70, source: 'bm25', floor: 30 }
  ];

  const results = reborn.recall('目标 情报', 5);
  assert.equal(results.length, 2, '已被演化替代的 sum_10 必须被过滤剔除');
  assert.ok(results.some(r => (r.content || r.text).includes('新版情报')), '新版情报必须保留');
  assert.ok(results.some(r => (r.content || r.text).includes('常规事实')), '无关条目必须保留');
  assert.equal(results.some(r => (r.content || r.text).includes('旧版情报')), false, '旧版情报严禁进入召回面');
  assert.equal(reborn.stats.evolutionFiltered, 1, '演化过滤统计计数必须为 1');
});

test('R18-O2 负控制：非 evolution 类型（如 related）边不触发硬过滤', async () => {
  const mod = await import(pathToFileURL(path.join(ROOT, 'apps/memory/lonsha-bridge.js')).href);
  const bridge = new mod.LonShaBridge();

  const relOlder = 'sum_11';
  const relNewer = 'sum_12';
  bridge.recordEvolutionLink(relOlder, relNewer, 'related');
  assert.equal(bridge.hasSupersedingEvolution(relOlder), false, 'related 仅为关联，不构成演化淘汰');

  bridge.memoryCore = { dataVersion: -1 };
  bridge._bm25.N = 2;
  bridge._bm25Dirty = false;
  bridge._bm25.search = () => [
    { id: 'sum_11', text: '关联事件A：调查启动', score: 0.80, source: 'summary', floor: 11 },
    { id: 'sum_12', text: '关联事件B：找到证据', score: 0.75, source: 'summary', floor: 12 }
  ];

  const results = bridge.recall('调查', 5);
  assert.equal(results.length, 2, 'related 边两端均必须保留');
  assert.equal(Number(bridge.stats.evolutionFiltered || 0), 0, 'related 边不得触发过滤计数');
});
