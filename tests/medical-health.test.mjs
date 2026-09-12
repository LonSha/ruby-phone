// HealthData 医疗集成测试：addCondition / advanceMedical / 序列化 / 注入
class MockStorage {
  constructor() { this.d = {}; }
  get(k) { return this.d[k] ?? null; }
  set(k, v) { this.d[k] = v; }
  remove(k) { delete this.d[k]; }
}
const { HealthData } = await import('../apps/health/health-data.js');

let pass = 0, fail = 0;
const assert = (n, c) => { if (c) { pass++; console.log(`✓ ${n}`); } else { fail++; console.log(`✗ ${n}`); } };

const st = new MockStorage();
const hd = new HealthData(st);

// 1. 初始状态
assert('初始无病症', (hd.conditions || []).length === 0);

// 2. 添加病症
const c1 = hd.addCondition('感冒', '轻度');
assert('添加感冒成功', !!c1 && c1.name === '感冒');
assert('感冒严重度 mild', c1.severity === 'mild');
assert('conditions 有 1 条', hd.conditions.length === 1);

// 3. 同名覆盖
hd.addCondition('感冒', '中度');
assert('同名覆盖不重复', hd.conditions.length === 1);
assert('覆盖后中度', hd.conditions[0].severity === 'moderate');

// 4. 添加慢性病
const c2 = hd.addCondition('高血压', '中度');
assert('添加高血压', hd.conditions.length === 2);

// 5. 序列化往返
hd.saveState();
const raw = st.get('ruby_health_cycle');
assert('保存有 conditions', raw && Array.isArray(raw.conditions) && raw.conditions.length === 2);

// 6. 重新加载（模拟刷新）
const hd2 = new HealthData(st);
assert('重载后 2 条病症', hd2.conditions.length === 2);

// 7. 每日推进（同一天幂等）
const r1 = hd2.advanceMedical();
const r2 = hd2.advanceMedical();
assert('首次推进返回结果', !!r1);
assert('同天二次推进 reasons=already', r2.reason === 'already');

// 8. 移除
hd2.removeCondition(hd2.conditions[0].id);
assert('移除后 1 条', hd2.conditions.length === 1);

// 9. 注入指令
const directive = hd.buildPromptDirective();
assert('注入含健康档案', !directive || directive.includes('健康档案') || !hd.conditions.length);
assert('注入含病症行', hd.conditions.length > 0 && directive.includes('高血压') || hd.conditions.length === 0);

// 10. 病症库访问
assert('分类 20', (hd.illnessCategories || []).length === 20);
const search = hd.searchIllness('胃', 'all');
assert('搜索胃 ≥4', search.length >= 4);

console.log(`\n${pass} 通过, ${fail} 失败`);
process.exit(fail > 0 ? 1 : 0);