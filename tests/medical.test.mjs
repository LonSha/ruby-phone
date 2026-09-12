// 医疗系统 (medical-core + HealthData 集成) 单元测试
import {
  normalizeCondition, advanceConditions, filterIllnesses, conditionLine,
  IllnessLibrary, courseOf, expiryText, daysLeft,
} from '../apps/health/medical-core.js';

let pass = 0, fail = 0;
const assert = (n, c) => { if (c) { pass++; console.log(`✓ ${n}`); } else { fail++; console.log(`✗ ${n}`); } };

// 1. 病症库完整性
assert('病症库 140 条', IllnessLibrary.illnesses.length === 140);
assert('分类 20 类', IllnessLibrary.categories.length === 20);

// 2. 规范化
{
  const c = normalizeCondition({ name: '感冒', severity: '轻度' });
  assert('感冒属 acute', c.course === 'acute');
  assert('感冒初始阶段=初期', c.stage === '初期');
  assert('严重度映射', c.severity === 'mild' || c.severity === '轻度');
  const c2 = normalizeCondition({ name: '高血压', severity: '中度' });
  assert('高血压属 chronic', c2.course === 'chronic');
  assert('高血压初始阶段=G1/G2 之类', !!c2.stage || !!c2.desc);
}

// 3. 查询
{
  const q = filterIllnesses('胃', 'all');
  assert('搜索"胃"命中≥4', q.length >= 4);
  const q2 = filterIllnesses('', 'respiratory');
  assert('呼吸分类 14 条', q2.length === 14);
}

// 4. 急性病推进
{
  const res = advanceConditions({
    conditions: [{ name: '感冒', stage: '初期', stageStartedAt: '2026-09-01' }],
    today: '2026-09-03',
  });
  assert('急性病推进到下一阶段', res.conditions[0].stageIndex === 1);
}

// 5. 到期康复
{
  const res = advanceConditions({
    conditions: [{ name: '感冒', stage: '恢复期', stageStartedAt: '2026-08-01', stageIndex: 2 }],
    today: '2026-09-12',
  });
  assert('末阶段超时康复', res.conditions[0].outcome === 'recovered');
}

// 6. 慢性病波动（多次推进大概率不越界）
{
  const conds = [{ name: '高血压', stage: 'G1', stageIndex: 0, stageStartedAt: '2026-01-01' }];
  let crashed = false;
  for (let d = 1; d <= 30; d++) {
    const res = advanceConditions({ conditions: conds, today: '2026-02-' + String(d).padStart(2, '0') });
    if (res.conditions[0].stageIndex < 0 || res.conditions[0].stageIndex > 10) { crashed = true; break; }
    conds[0] = res.conditions[0];
  }
  assert('慢性30天推进不越界', !crashed);
}

// 7. 到期文本
{
  assert('剩 8 天', expiryText({ expiresAt: '2026-09-20' }, '2026-09-12') === '剩 8 天');
  assert('今天到期', expiryText({ expiresAt: '2026-09-12' }, '2026-09-12') === '今天到期');
  assert('已过期', expiryText({ expiresAt: '2026-09-01' }, '2026-09-12') === '已过期 11 天');
}

// 8. conditionLine
{
  const line = conditionLine({ name: '感冒', expiresAt: '2026-09-20', course: 'acute' }, { today: '2026-09-12' });
  assert('conditionLine 含病名', line.includes('感冒'));
  assert('conditionLine 含到期', line.includes('剩'));
}

// 9. 无损推进（幂等：无 stages 无 stageStartedAt 时不坏）
{
  const res = advanceConditions({ conditions: [{ name: '感冒' }], today: '2026-09-12' });
  assert('无阶段表不崩溃', res.conditions.length === 1);
}

console.log(`\n${pass} 通过, ${fail} 失败`);
process.exit(fail > 0 ? 1 : 0);