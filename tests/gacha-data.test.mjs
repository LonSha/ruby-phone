// Gacha 抽卡数据层测试
import { GachaData, QUALITY_META, SINGLE_COST, TEN_COST } from '../apps/gacha/gacha-data.js';
import { gachaPools, gachaItems } from '../data/gacha-items.js';
// [v2.47.0] 金手指：外挂池并入扭蛋，判据需读轻量索引与外挂 id 映射（不重复硬编码 'cheat_'）
import { cheatIndex, cheatItemId, cheatPackIdOfItem } from '../data/cheat-index.js';

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
// [v2.47.0] 不再钉死池数量：`getPools()` 是运行时合并面（内置 5 池 + 金手指「万界武库」池），
//   钉死具体数字会让合法增长变成红灯（v2.45.0 D2 同类修正：门禁只可能拒判、不可能放行）。
//   改为下界 + 不重复 + 必须含外挂池，既容忍增长又锁住「外挂池真的被合并进来了」。
const pools = g.getPools();
assert('getPools 至少含 5 个内置池', pools.length >= 5, String(pools.length));
assert('getPools 含外挂池 pool_cheat', pools.some(p => p.id === 'pool_cheat'));
assert('getPools 池 id 不重复', new Set(pools.map(p => p.id)).size === pools.length);
assert('getPools 按 order 排序', pools.every((p, i) => i === 0
  || (Number(pools[i - 1].order) || 0) <= (Number(p.order) || 0)));
// 外挂池必须独立：不进「全部」混杂池（否则 157 个外挂会稀释既有 630 道具概率）
assert('外挂池 includeInAll=false', pools.find(p => p.id === 'pool_cheat').includeInAll === false);
assert('「全部」不混入外挂', !g.getItemsOfPool('all').some(i => String(i.id).startsWith('cheat_')));
assert('外挂池道具数 == 外挂包数', g.getItemsOfPool('pool_cheat').length === cheatIndex.length);
assert('外挂池道具 id 均带 cheat_ 前缀',
  g.getItemsOfPool('pool_cheat').every(i => i.id === cheatItemId(cheatPackIdOfItem(i.id))));

console.log(`\n${pass} 通过, ${fail} 失败`);
process.exit(fail > 0 ? 1 : 0);