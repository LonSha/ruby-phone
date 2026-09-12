/* supersede-engine 回归测试 (Paramecium 移植) */
import assert from 'node:assert';
import {
  SUPERSEDE_STATUS, isProtected, jaccardSimilarity,
  isHighConfidenceConflict, shouldSupersede, markSuperseded,
  reviveMemory, scanSupersede, reviveSuperseded
} from '../config/supersede-engine.js';

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log('  ✓ ' + name); }
  catch (e) { fail++; console.error('  ✗ ' + name + '\n    ' + e.message); }
}

const oldLikeMilk = {
  id: 'a1', content: '她很喜欢喝奶茶，最爱茉莉奶绿', importance: 5,
  createdAt: '2026-01-01T00:00:00.000Z'
};
const newQuitMilk = {
  id: 'b2', content: '她决定戒奶茶了，再也不喝茉莉奶绿', importance: 8,
  createdAt: '2026-01-10T00:00:00.000Z'
};

console.log('== jaccardSimilarity ==');
t('空输入返回 0', () => assert.strictEqual(jaccardSimilarity('', 'x'), 0));
t('相同文本相似度高', () => assert.ok(jaccardSimilarity('她喜欢喝奶茶', '她喜欢喝奶茶') > 0.7));
t('完全无关文本低相似', () => assert.ok(jaccardSimilarity('今天天气很好', '她辞职了') < 0.2));
t('奶茶同话题相似度中等', () => {
  const s = jaccardSimilarity('她很喜欢喝奶茶', '她决定戒奶茶');
  assert.ok(s > 0.2 && s < 0.8, 's=' + s);
});

console.log('== isHighConfidenceConflict ==');
t('奶茶旧爱新戒 → 冲突', () => assert.ok(isHighConfidenceConflict(oldLikeMilk.content, newQuitMilk.content)));
t('同话题无立场反转 → 不冲突', () => {
  assert.ok(!isHighConfidenceConflict('她喜欢喝奶茶，最爱茉莉奶绿', '她今天又喝了一杯茉莉奶绿，还是喜欢'));
});
t('完全无关 → 不冲突', () => {
  assert.ok(!isHighConfidenceConflict('她喜欢喝奶茶', '她今天去爬山了，山顶风很大'));
});
t('搬家 (旧住新搬) → 冲突', () => {
  assert.ok(isHighConfidenceConflict('她一直住在城南的老房子', '她后来搬走了，离开城南老房子'));
});
t('旧负新正 → 冲突成立(复活场景可检)', () => {
  assert.ok(isHighConfidenceConflict('她戒奶茶很久了', '她最近又开始喝奶茶了'));
});

console.log('== isProtected ==');
t('pinned 受保护', () => assert.ok(isProtected({ metadata: { pinned: true } })));
t('permanent 受保护', () => assert.ok(isProtected({ metadata: { type: 'permanent' } })));
t('剧情条目受保护', () => assert.ok(isProtected({ content: '[剧情]主角登场' })));
t('普通条目不受保护', () => assert.ok(!isProtected({ content: '普通记忆' })));
t('null 不受保护', () => assert.ok(!isProtected(null)));

console.log('== shouldSupersede ==');
t('新重要性不足 → 不换代', () => {
  const lowNew = { content: '她决定戒奶茶', importance: 3 };
  assert.ok(!shouldSupersede(oldLikeMilk, lowNew));
});
t('重要性足够 + 冲突 → 换代', () => {
  assert.ok(shouldSupersede(oldLikeMilk, newQuitMilk));
});
t('旧受保护 → 永不换代', () => {
  const pinned = { ...oldLikeMilk, metadata: { pinned: true } };
  assert.ok(!shouldSupersede(pinned, newQuitMilk));
});
t('重要性足够但无冲突 → 不换代', () => {
  const unrelated = { content: '她今天去爬山了，山顶风很大', importance: 9 };
  assert.ok(!shouldSupersede(oldLikeMilk, unrelated));
});

console.log('== markSuperseded / reviveMemory ==');
t('markSuperseded 填标不删内容', () => {
  const m = markSuperseded(oldLikeMilk, newQuitMilk);
  assert.strictEqual(m.metadata._superseded, SUPERSEDE_STATUS.SUPERSEDED);
  assert.strictEqual(m.metadata.supersededBy, 'b2');
  assert.ok(m.content.includes('奶茶')); // 原文不动
});
t('reviveMemory 清除标', () => {
  const m = reviveMemory(markSuperseded(oldLikeMilk, newQuitMilk));
  assert.ok(!m.metadata._superseded);
  assert.ok(!m.metadata.supersededBy);
  assert.ok(m.metadata._revivedAt);
});

console.log('== scanSupersede ==');
t('新条目压过旧条目 → 旧条目标换代', () => {
  const existing = [{ ...oldLikeMilk }];
  const res = scanSupersede([newQuitMilk], existing);
  assert.strictEqual(res.superseded.length, 1);
  assert.strictEqual(existing[0].metadata._superseded, SUPERSEDE_STATUS.SUPERSEDED);
});
t('无关新条目 → 无换代', () => {
  const existing = [{ ...oldLikeMilk }];
  const res = scanSupersede([{ content: '她今天去爬山了', importance: 9 }], existing);
  assert.strictEqual(res.superseded.length, 0);
  assert.ok(!existing[0].metadata?._superseded);
});
t('空池/空新条目 → 安全返回', () => {
  assert.deepStrictEqual(scanSupersede([], [{ ...oldLikeMilk }]).superseded, []);
  assert.deepStrictEqual(scanSupersede([newQuitMilk], []).superseded, []);
});
t('已 superseded 条目可被更新状态替换(链式换代), 更新 supersededBy', () => {
  const oldQuit = { id: 'q1', content: '她已经戒掉了奶茶，再也不喝了', importance: 6, metadata: { _superseded: SUPERSEDE_STATUS.SUPERSEDED, supersededBy: 'old-suppressor' } };
  const newer = { id: 'c3', content: '她又开始喝奶茶了，重新爱上了茉莉奶绿', importance: 8 };
  const res = scanSupersede([newer], [oldQuit]);
  assert.strictEqual(res.superseded.length, 1);
  assert.strictEqual(res.superseded[0].metadata.supersededBy, 'c3', 'supersededBy 应更新为新压制方');
});
t('pinned 旧条目不被换代', () => {
  const existing = [{ ...oldLikeMilk, metadata: { pinned: true } }];
  const res = scanSupersede([newQuitMilk], existing);
  assert.strictEqual(res.superseded.length, 0);
});

console.log('== reviveSuperseded ==');
t('压制方还存在 → 保持换代', () => {
  const oldM = { ...oldLikeMilk, id: 'a1', metadata: { _superseded: 'superseded', supersededBy: 'b2' } };
  const newM = { ...newQuitMilk, id: 'b2' };
  const out = reviveSuperseded([oldM, newM]);
  assert.strictEqual(out[0].metadata._superseded, 'superseded');
});
t('压制方已被换代 → 复活旧条目', () => {
  const oldM = { ...oldLikeMilk, id: 'a1', metadata: { _superseded: 'superseded', supersededBy: 'b2' } };
  const newM = { ...newQuitMilk, id: 'b2', metadata: { _superseded: 'superseded' } };
  const out = reviveSuperseded([oldM, newM]);
  assert.ok(!out[0].metadata._superseded);
});
t('压制方消失 → 复活旧条目', () => {
  const oldM = { ...oldLikeMilk, id: 'a1', metadata: { _superseded: 'superseded', supersededBy: 'b2' } };
  const out = reviveSuperseded([oldM]);
  assert.ok(!out[0].metadata._superseded);
});
t('非 superseded 不受影响', () => {
  const m = { ...oldLikeMilk };
  const out = reviveSuperseded([m]);
  assert.strictEqual(out[0], m);
});

console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail > 0 ? 1 : 0);
