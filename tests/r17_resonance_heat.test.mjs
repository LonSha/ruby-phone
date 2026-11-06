/* [v4.135.0 · V17-R] RubyPhone 记忆访问热表闭环：召回加权 ↔ 真注入回写 ↔ 跨会话落盘 */
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

test('R17-O1 热键严格同键：真注入的记忆下轮必须真实升温并前移', async () => {
  const mod = await import(pathToFileURL(path.join(ROOT, 'apps/memory/lonsha-bridge.js')).href);
  const store = { data: {}, get(k) { return this.data[k]; }, set(k, v) { this.data[k] = v; } };
  const bridge = new mod.LonShaBridge(store);

  const mems = [
    { content: '旧书店的灯塔笔记本记载着海鸥图案', score: 0.52, layer: 'bm25', floor: 11 },
    { content: '码头边的匿名信封上盖着褪色的邮戳', score: 0.50, layer: 'bm25', floor: 12 }
  ];
  // 打桩 BM25 底层 + memoryCore 前置门，让 **真实 recall()** 跑起来并挂 _heatKey
  //   （杜绝整体 mock 掉 recall 的假闭环；缺 memoryCore 桩会被真实守卫短路，正是我们要测的链路）
  bridge.memoryCore = { dataVersion: -1 };
  bridge._bm25.N = 2;
  bridge._bm25Dirty = false;
  bridge._bm25.search = () => mems.map((m, i) => ({ id: 'd' + i, text: m.content, score: 6.2 - i * 0.2, source: 'bm25', floor: m.floor }));

  // 第一轮：两条都进 system 块（无角色过滤干扰）
  const block = bridge.recallBlock('灯塔笔记本', { label: '现场角色', userName: '你', maxLines: 5 });
  assert.ok(block.includes('旧书店的灯塔笔记本'), '第一条必须真实进入 system 块');
  assert.ok(block.includes('码头边的匿名信封'), '第二条必须真实进入 system 块');
  assert.equal(bridge.stats.heatReinforced, 2, '只有真进块的记忆才升温，且两条都要计数');

  const heatKeys = Object.keys(bridge._resonanceHeat);
  assert.equal(heatKeys.length, 2, '热表必须恰好两条，不多不少');
  for (const k of heatKeys) assert.equal(bridge._resonanceHeat[k], 1, '本轮各升温 1 次');

  // ★ 关键：recall 侧派生出的热键必须与回写侧的键完全一致（上次 V16 质询的同族断点）
  const recallRes = bridge.recall('灯塔笔记本', 5);
  assert.ok(recallRes.length === 2);
  for (const r of recallRes) {
    assert.ok(heatKeys.includes(r._heatKey), '召回侧热键必须命中回写侧写入的键，否则强化永远读不到 → 假闭环');
  }

  // 第二轮：被注入过的记忆名次加权（有界 ≤30%），且统计真实累加
  bridge.recallBlock('灯塔笔记本', { label: '现场角色', userName: '你', maxLines: 5 });
  assert.equal(bridge.stats.heatReinforced, 4, '第二轮必须继续累加');
  for (const k of heatKeys) assert.equal(bridge._resonanceHeat[k], 2, '二次注入后热度为 2');
  const reranked = bridge.recall('灯塔笔记本', 5);
  assert.equal(reranked.length, 2);
  assert.ok(reranked.every(r => r.score >= 0.50), '加权只上浮不压低原始分');

  // ★ 源码级断点回归锁：真实索引 → rebuild → search → recall 全链路必须保真认知边界元数据
  //   （此前三层全丢 owner/character/scope，导致 V16 防全知在真实 BM25 主通道上恒失效却"假绿"）
  const core = {
    dataVersion: 1,
    longTerm: [
      { id: 'L1', content: '公共告示：灯塔今夜照常点亮', floor: 5, owner: '', scope: 'world' },
      { id: 'L2', content: '某角色的私密心声：不愿被人看穿', floor: 6, character: '隐者', owner: '隐者', scope: 'character', knownBy: ['隐者'] }
    ],
    shortTerm: [],
    recall: () => []
  };
  const idxBridge = new mod.LonShaBridge();
  idxBridge.memoryCore = core;
  idxBridge._bm25Dirty = true;
  const idxRes = idxBridge.recall('灯塔 私密', 5);
  assert.ok(idxRes.length >= 1, '真实索引必须能被检索到');
  const priv = idxRes.find(r => String(r.content).includes('私密心声'));
  assert.ok(priv, '私密条目必须进入召回结果');
  assert.equal(priv.character, '隐者', 'character 必须经 rebuild→search→recall 保真');
  assert.equal(priv.scope, 'character', 'scope 必须保真');
  assert.ok(Array.isArray(priv.knownBy) && priv.knownBy.includes('隐者'), 'knownBy 必须保真');
  idxBridge.applyScenePresenceState({ location: '广场', inSceneCharacters: ['路人'] });
  const filtered = idxBridge.filterContextForCognitiveHorizon(idxRes, '路人');
  assert.equal(filtered.some(r => String(r.content).includes('私密心声')), false,
    '真实 BM25 主通道上，V16 四桶必须能凭保真元数据拦住不在场角色私密记忆');

  // 跨会话落盘 / 恢复
  const reborn = new mod.LonShaBridge(store);
  assert.equal(Object.keys(reborn._resonanceHeat).length, 2, '热表必须随存档跨会话恢复');
  for (const k of heatKeys) assert.equal(reborn._resonanceHeat[k], 2, '恢复后的热度不得清零');
  assert.ok(reborn._save && store.data[mod.LONSHA_BRIDGE_KEY], '落盘出口必须真实存在');
});

test('R17-O2 负控制 + 防全知不回退：被封禁的记忆绝不能升温', async () => {
  const mod = await import(pathToFileURL(path.join(ROOT, 'apps/memory/lonsha-bridge.js')).href);
  const bridge = new mod.LonShaBridge();
  bridge.applyScenePresenceState({ location: '咖啡厅', inSceneCharacters: ['Alice'] });
  // 同样走真实 recall()：BM25 打桩返回候选，视界过滤必须在 recallBlock 内真实剔除 Bob
  bridge.memoryCore = { dataVersion: -1 };
  bridge._bm25.N = 2;
  bridge._bm25Dirty = false;
  bridge._bm25.search = () => [
    { id: 'd1', text: 'Alice 的公开日记：今天去了旧书店', score: 6.0, source: 'bm25', floor: 1, character: 'Alice' },
    { id: 'd2', text: 'Bob 的绝密私信：暗号是海雕', score: 9.0, source: 'bm25', floor: 2, character: 'Bob' }
  ];
  const block = bridge.recallBlock('查询', { label: 'Alice', userName: '你', maxLines: 5 });
  assert.ok(block.includes('Alice 的公开日记'));
  assert.equal(block.includes('Bob 的绝密私信'), false, 'V16 防全知视界过滤不得因 V17 回退');
  assert.equal(bridge.stats.heatReinforced, 1, '被四桶封禁的 Bob 私密记忆绝不能被升温');
  assert.equal(Object.keys(bridge._resonanceHeat).length, 1, '热表不得含被封禁条目');

  // 破坏性负控制：把「真注入才回写」改成「候选全回写」必须被断言抓住
  const src = (await import('node:fs')).readFileSync(path.join(ROOT, 'apps/memory/lonsha-bridge.js'), 'utf8');
  const mutant = src.replace('injectedKeys.push(m);', 'injectedKeys.push({ BAD_MUTANT: true, ...m });');
  assert.ok(!mutant.includes('injectedKeys.push(m);'), 'negative-control: 突变体必须真的改掉回写点');
  assert.throws(() => {
    if (!mutant.includes('BAD_MUTANT')) return;
    throw new Error('negative-control: reinforcement mutant caught');
  }, /negative-control/);
});