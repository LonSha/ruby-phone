// Gacha 抽卡数据层测试
import { GachaData, QUALITY_META, SINGLE_COST, TEN_COST } from '../apps/gacha/gacha-data.js';
import { gachaPools, gachaItems } from '../data/gacha-items.js';

let pass = 0, fail = 0;
const assert = (n, c) => { if (c) { pass++; console.log(`✓ ${n}`); } else { fail++; console.log(`✗ ${n}`); } };

class MockStorage {
  constructor() { this.d = {}; }
  get(k) { return this.d[k] ?? null; }
  set(k, v) { this.d[k] = v; }
  remove(k) { delete this.d[k]; }
}

// 1. 数据完整性
assert('卡池 5', gachaPools.length === 5);
assert('道具 630', gachaItems.length === 630);

// 2. 初始状态
const st = new MockStorage();
const g = new GachaData(st);
assert('初始 1000 币', g.getBalance() === 1000);

// 3. 单抽
const r1 = g.pullOnce('pool_erotic');
assert('单抽成功', r1.ok === true);
assert('单抽 1 件', r1.results.length === 1);
assert('扣 100 币', g.getBalance() === 900);

// 4. 十连
const r2 = g.pullTen('pool_daily_special');
assert('十连成功', r2.ok === true);
assert('十连 10 件', r2.results.length === 10);
assert('十连扣 900', g.getBalance() === 0);

// 5. 余额不足
const r3 = g.pullOnce('all');
assert('余额不足拦截', r3.ok === false && r3.reason.includes('不足'));

// 6. 背包
g.addCoins(3000);
g.pullTen('pool_cosplay');
const inv = g.getInventory();
assert('背包有条目', inv.length > 0);
assert('背包计数≥1', inv.every(i => i.count >= 1));

// 7. 序列化
const raw = st.get('ruby_gacha_state');
assert('保存状态', raw && typeof raw === 'string');
const g2 = new GachaData(st);
assert('重载后余额一致', g2.getBalance() === g.getBalance());
assert('重载后背包一致', Object.keys(g2.inventory).length === Object.keys(g.inventory).length);

// 8. 品质分布合理性（十连含各种品质）
const quals = new Set(r2.results.map(x => x.quality));
assert('十连品质在合法集合', [...quals].every(q => q in QUALITY_META));

// 9. 每池道具数
assert('erotic 池 210', g.getItemsOfPool('pool_erotic').length === 210);

// 10. 卡池输出
assert('getPools 返回 5', g.getPools().length === 5);

console.log(`\n${pass} 通过, ${fail} 失败`);
process.exit(fail > 0 ? 1 : 0);