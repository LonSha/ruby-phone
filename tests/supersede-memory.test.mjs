/* memory-data + supersede-engine 集成测试: 记忆换代端到端 */
import assert from 'node:assert';
import { MemoryCore } from '../apps/memory/memory-data.js';
import { SUPERSEDE_STATUS } from '../config/supersede-engine.js';

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log('  ✓ ' + name); }
  catch (e) { fail++; console.error('  ✗ ' + name + '\n    ' + e.message); }
}

// mock storage (可挂到 MemoryCore)
class MockStorage {
  constructor() { this.data = {}; }
  get(k) { return this.data[k] ?? null; }
  set(k, v) { this.data[k] = v; }
}

function newCore() {
  return new MemoryCore(new MockStorage());
}

console.log('== 端到端: 记忆换代流程 ==');
t('冲突换代: 戒奶茶压过爱奶茶', () => {
  const core = newCore();
  // 第一批: 先记忆"爱奶茶"并巩固
  core.record('user', '她特别爱喝奶茶，最喜欢茉莉奶绿的清淡香气，每周都要喝好几杯，连她自己都说戒不掉这个习惯', {}, {});
  core.sleep();
  assert.ok(core.longTerm.find(x => x.content.includes('爱喝奶茶')), '第一批应有爱奶茶条目');
  // 第二批: "戒奶茶"新记忆, 应压过"爱奶茶"
  core.record('user', '不过其实她现在不爱喝奶茶了，现在已经彻底戒掉了奶茶，改喝白开水了，说是这样对身体更好', {}, {});
  core.sleep();
  const oldOne = core.longTerm.find(x => x.content.includes('爱喝奶茶'));
  const newOne = core.longTerm.find(x => x.content.includes('戒掉了'));
  assert.ok(oldOne, '旧爱奶茶条目应仍在');
  assert.ok(newOne, '应有戒奶茶新条目');
  assert.strictEqual(oldOne.metadata._superseded, SUPERSEDE_STATUS.SUPERSEDED, '旧条目应被标 superseded');
  assert.strictEqual(newOne.metadata._superseded, undefined, '新条目应保持 active');
  // recall 时应排出 superseded (唯一定位旧条: 完整短语「连她自己都说戒不掉这个习惯」)
  const recalls = core.recall('奶茶', 10);
  assert.ok(!recalls.some(r => r.content.includes('连她自己都说戒不掉这个习惯')), 'superseded 条目不应出现在召回');
  assert.ok(recalls.some(r => r.content.includes('戒掉了')), '新条目应出现在召回');
});

t('无关记忆不误判换代', () => {
  const core = newCore();
  core.record('user', '她非常喜欢喝奶茶，尤其是各种口味的都爱尝试', {}, {});
  core.record('user', '她今天去爬山了，山顶风很大，风景非常好', {}, {});
  core.sleep();
  assert.strictEqual(core.longTerm.filter(m => m.metadata?._superseded === 'superseded').length, 0, '无关记忆不得互标 superseded');
});

t('pinned 条目不可被换代', () => {
  const core = newCore();
  core.pool.initialize?.();
  // 直接塞一条 pinned 长期记忆
  const pinned = {
    id: 'p1', content: '她永爱喝奶茶，这是她的本命', importance: 5,
    pinned: true, metadata: { pinned: true }, createdAt: new Date().toISOString(), role: 'user', emotion: { arousal: 0.5, valence: 0.5 }
  };
  core.longTerm.push(pinned);
  core.record('user', '她已经彻底戒掉奶茶了，再也不碰，改喝白开水了，说她再也不喝这个了', {}, {});
  core.sleep();
  const p = core.longTerm.find(x => x.id === 'p1');
  assert.ok(p, 'pinned 条目应还在');
  assert.strictEqual(p.metadata._superseded, undefined, 'pinned 条目不得被换代');
});

t('换代后复活: 压制方被再次换代时, 旧条目解除压制', () => {
  const core = newCore();
  // 第一批: 爱奶茶
  core.record('user', '她特别爱喝奶茶，最喜欢茉莉奶绿的清淡香气，每周都要喝好几杯，连她自己都说戒不掉这个习惯', {}, {});
  core.sleep();
  // 第二批: 戒奶茶 (压过爱奶茶)
  core.record('user', '不过其实她现在不爱喝奶茶了，现在已经彻底戒掉了奶茶，改喝白开水了，说是这样对身体更好', {}, {});
  core.sleep();
  const oldOne = core.longTerm.find(x => x.content.includes('爱喝奶茶'));
  assert.ok(oldOne, '第一步: 应有爱奶茶旧条目');
  assert.strictEqual(oldOne.metadata._superseded, SUPERSEDE_STATUS.SUPERSEDED, '第一步: 旧条目应先被压制');
  // 第三批: 她又喝回奶茶 (压过戒奶茶; 此时爱奶茶解除压制)
  core.record('user', '不过她现在又重新开始喝奶茶了，还是她最爱的茉莉奶绿，说是戒了这么久反而更想喝了，每天都想来一杯', {}, {});
  core.sleep();
  const revived = core.longTerm.find(x => x.content.includes('爱喝奶茶'));
  assert.ok(revived, '旧条目应仍存在');
  // 戒掉条应被又喝条换代, 爱奶茶条解除压制
  const quitOne = core.longTerm.find(x => x.content.includes('戒掉了'));
  assert.strictEqual(quitOne.metadata._superseded, SUPERSEDE_STATUS.SUPERSEDED, '戒掉条应被又喝条换代');
  assert.strictEqual(core.longTerm.find(x => x.content.includes('爱喝奶茶')).metadata._superseded, undefined, '爱奶茶条应解除压制');
});

console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail > 0 ? 1 : 0);