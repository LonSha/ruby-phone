/* [v4.137.0 · V20-R1 & R2] 全息双向共生总线与离线事件定向集成测试 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { LonShaBridge } from '../apps/memory/lonsha-bridge.js';

test('R20-O1 全息双向共生总线事件发射、落盘与排队消费', () => {
  const store = {};
  const fakeStorage = {
    get: (k) => store[k] || null,
    set: (k, v) => { store[k] = typeof v === 'string' ? v : JSON.stringify(v); }
  };

  const bridge = new LonShaBridge(fakeStorage, {});
  assert.equal(Array.isArray(bridge._holographicBusEvents), true);

  // 1. 发射聊天事件
  const evt1 = bridge.emitHolographicEvent('IM_MESSAGE', {
    sender: '艾拉',
    text: '钟楼密谈的信件已被我妥善销毁',
    floor: 28
  });

  assert.ok(evt1.id.startsWith('holo_'));
  assert.equal(bridge._holographicBusEvents.length, 1);

  // 2. 模拟重启与持久化水合
  const restoredBridge = new LonShaBridge(fakeStorage, {});
  assert.equal(restoredBridge._holographicBusEvents.length, 1);
  assert.equal(restoredBridge._holographicBusEvents[0].payload.sender, '艾拉');

  // 3. 消费事件并排空
  const drained = restoredBridge.drainHolographicEvents();
  assert.equal(drained.length, 1);
  assert.equal(restoredBridge._holographicBusEvents.length, 0);

  // 4. 再次重启验证排空后的持久化
  const postDrainBridge = new LonShaBridge(fakeStorage, {});
  assert.equal(postDrainBridge._holographicBusEvents.length, 0);
});