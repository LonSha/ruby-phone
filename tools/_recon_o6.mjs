/* O6 现场侦察：APP_CATEGORY 覆盖度 / 壳成员分布 / 三表关系 */
import { APP_CATEGORY, CORE_APP_IDS, APP_LIBRARY_CATEGORIES, appCategory, appZone } from '../config/app-library.js';
import { APPS } from '../config/apps.js';
const ids = APPS.map(a => a.id);
const keys = Object.keys(APP_CATEGORY);
const miss = ids.filter(i => !(i in APP_CATEGORY));
const extra = keys.filter(k => !ids.includes(k));
console.log('APPS ids       =', ids.length);
console.log('APP_CATEGORY   =', keys.length);
console.log('CORE_APP_IDS   =', CORE_APP_IDS.length);
console.log('LIB_CATEGORIES =', APP_LIBRARY_CATEGORIES.length, JSON.stringify(APP_LIBRARY_CATEGORIES));
console.log('missing        =', miss.length, miss.join(','));
console.log('orphan         =', extra.length, extra.join(','));
const byCat = {};
for (const i of ids) { const c = appCategory(i); (byCat[c] = byCat[c] || []).push(i); }
for (const kv of Object.entries(byCat).sort((a, b) => b[1].length - a[1].length)) {
  console.log('  cat', kv[0], '=>', kv[1].length, kv[1].slice(0, 40).join(','));
}
const zones = {};
for (const i of ids) { const z = appZone(i); (zones[z] = zones[z] || []).push(i); }
for (const kv of Object.entries(zones)) {
  console.log('  zone', kv[0], '=>', kv[1].length, kv[1].join(','));
}
