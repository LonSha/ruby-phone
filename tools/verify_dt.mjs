import { dirtyTalkModules } from '../data/dirtytalk.js';
import { dirtyTalkIndex, DT_STYLES, DT_ITEM_PREFIX, DT_CAT_ORDER, DT_TIER_META, DT_CAT_LABEL } from '../data/dirtytalk-index.js';
import { dirtyTalkCorpus } from '../data/dirtytalk-corpus.js';

const a = dirtyTalkModules;
console.log('modules', a.length, 'first', a[0].id, a[0].name, a[0].cat, a[0].tier, 'chars', a[0].chars, 'last', a[a.length - 1].name);
const cats = {};
for (const x of a) cats[x.cat] = (cats[x.cat] || 0) + 1;
console.log('cats', JSON.stringify(cats));
const tiers = {};
for (const x of a) tiers[x.tier] = (tiers[x.tier] || 0) + 1;
console.log('tiers', JSON.stringify(tiers));
console.log('idx', dirtyTalkIndex.length, 'styles', JSON.stringify(DT_STYLES), 'prefix', DT_ITEM_PREFIX, 'catOrder', JSON.stringify(DT_CAT_ORDER));
console.log('tierMeta', JSON.stringify(DT_TIER_META), 'catLabel', JSON.stringify(DT_CAT_LABEL));
console.log('corpus', dirtyTalkCorpus.length);
// 一致性：索引 id 序 = 正文 id 序；前缀契约
const idOk = a.every((m, i) => m.id === dirtyTalkIndex[i].id);
console.log('idOrderOk', idOk);
const prefOk = a.every((m) => m.id.startsWith(DT_ITEM_PREFIX));
console.log('prefixOk', prefOk);
// 强度档断言：按字数阈值自洽
const tierOk = a.every((m) => (m.chars >= 1200 ? m.tier === '重' : m.chars >= 600 ? m.tier === '中' : m.tier === '轻'));
console.log('tierSelfConsistent', tierOk);
// 负控制：篡改任一字段应被抓到（同判据）
const bad = [...a]; bad[0] = { ...bad[0], tier: bad[0].tier === '轻' ? '重' : '轻' };
const negTier = bad.every((m) => (m.chars >= 1200 ? m.tier === '重' : m.chars >= 600 ? m.tier === '中' : m.tier === '轻'));
console.log('negativeControlTier', !negTier);
const negId = dirtyTalkIndex.map((x) => (x === dirtyTalkIndex[0] ? { ...x, id: 'zzz' } : x));
const negIdOk = a.every((m, i) => m.id === negId[i].id);
console.log('negativeControlId', !negIdOk);
