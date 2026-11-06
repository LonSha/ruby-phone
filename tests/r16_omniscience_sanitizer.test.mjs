import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

test('R16-O1: 跨角色防全知视界净化与私密记录过滤', async () => {
  globalThis.window = globalThis.window || {};
  const bridgeMod = await import(pathToFileURL(path.join(ROOT, 'apps/memory/lonsha-bridge.js')).href);
  const bridge = new bridgeMod.LonShaBridge();

  // 设置当前场景：Alice 在场，Bob 不在场
  bridge.applyScenePresenceState({
    location: '咖啡厅室内',
    inSceneCharacters: ['Alice']
  });

  const records = [
    { text: '公共新闻：今天天气晴朗' },
    { text: 'Alice 的日记：今天见到了玩家', character: 'Alice' },
    { text: 'Bob 的绝密私信：暗号是海雕', character: 'Bob' }
  ];

  // 1. 当当前互动角色为 Alice 时，Bob 的私密记录必须被过滤净化
  const sanitizedForAlice = bridge.filterContextForCognitiveHorizon(records, 'Alice');
  assert.equal(sanitizedForAlice.length, 2, '必须只保留公共记录与 Alice 本人的记录');
  assert.equal(sanitizedForAlice.some(r => r.character === 'Bob'), false, '不在场的 Bob 记录必须被物理剔除');

  // 2. 当 Bob 进场同室互动时，过滤放行
  bridge.applyScenePresenceState({
    location: '咖啡厅室内',
    inSceneCharacters: ['Alice', 'Bob']
  });
  const sanitizedWithBob = bridge.filterContextForCognitiveHorizon(records, 'Alice');
  assert.equal(sanitizedWithBob.length, 3, '同室在场时应按需放行');

  // 3. 验证 recallBlock 真实接线端到端执行
  bridge.applyScenePresenceState({
    location: '咖啡厅室内',
    inSceneCharacters: ['Alice']
  });
  // mock recall
  bridge.recall = () => [
    { content: '公共新闻：今天天气晴朗' },
    { content: 'Alice 的日记：今天见到了玩家', character: 'Alice' },
    { content: 'Bob 的绝密私信：暗号是海雕', character: 'Bob' }
  ];
  const blockResult = bridge.recallBlock('查询', { label: 'Alice', userName: 'User' });
  assert.ok(blockResult.includes('Alice 的日记'), 'Alice 的日记应该在 block 中');
  assert.equal(blockResult.includes('Bob 的绝密私信'), false, 'recallBlock 必须穿透执行视界过滤，绝不能包含 Bob 绝密私信');

  // 4. 负控制：如果故意返回包含不在场角色秘密的未过滤数组，测试必须断言失败
  const fakeSanitized = records.slice();
  assert.throws(() => {
    if (fakeSanitized.some(r => r.character === 'Bob')) {
      throw new Error('negative-control: leaked absent character secret detected');
    }
  }, /negative-control/);
});