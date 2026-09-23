/* [v2.88.0] 万界武库 V4.1 合并式更新门禁
 * A 数据面：157 → 165 包，id 稳定性（不砍原有、不重排）；
 * B 更新面：V4.1 同名包正文确实覆盖（旧字数特征消失、新字数特征就位）；
 * C 新增面：8 新包就位且内容特征正确；
 * D 同源面：index 与 packs 元数据逐字一致（含新包）。
 */
import { strict as A } from 'node:assert';
import { cheatPacks } from '../data/cheats.js';
import { cheatIndex, cheatItemId, cheatPackIdOfItem } from '../data/cheat-index.js';

const results = [];
const ok = (name, cond, detail = '') => results.push({ name, cond, detail });

const byName = new Map(cheatPacks.map((p) => [p.name, p]));
const byId = new Map(cheatPacks.map((p) => [p.id, p]));

/* A 数据面 */
ok('A1 库规模 165 包', cheatPacks.length === 165, String(cheatPacks.length));
ok('A2 id 唯一且 index 同步', byId.size === 165 && cheatIndex.length === 165,
  `${byId.size}/${cheatIndex.length}`);
ok('A3 旧锚点包保留（ch001 赋能 / ch096 万界武库 / ch128 思维链V1 / ch157 与共者）',
  byId.get('ch001')?.name === '赋能' && byId.get('ch096')?.name === '万界武库' &&
  byId.get('ch128')?.name === '万界武库思维链' && byId.get('ch157')?.name === '与共者');
ok('A4 前 157 包 id 连续无漂移（ch001..ch157）',
  cheatPacks.slice(0, 157).every((p, i) => p.id === 'ch' + String(i + 1).padStart(3, '0')));
ok('A5 正文全部非空且 chars 忠实',
  cheatPacks.every((p) => String(p.content || '').trim().length > 0 && p.chars === p.content.length));

/* B 更新面（V4.1 覆盖特征：以 diff 实测字数为锚） */
ok('B1 源堡覆盖为 V4.1 版（5662 字）', byName.get('源堡')?.chars === 5662, String(byName.get('源堡')?.chars));
ok('B2 神圣几何覆盖为 V4.1 版（8121 字）', byName.get('神圣几何')?.chars === 8121, String(byName.get('神圣几何')?.chars));
ok('B3 点石成金覆盖为 V4.1 版（3872 字，旧版 1188）', byName.get('点石成金')?.chars === 3872, String(byName.get('点石成金')?.chars));
ok('B4 文明之光系统为 V4.1 版（主条4382+3子条=10562 字，旧版 15065）', byName.get('文明之光系统')?.chars === 10562, String(byName.get('文明之光系统')?.chars));
ok('B5 覆盖包 id 原地保留', byName.get('源堡')?.id === 'ch146' && byName.get('与共者')?.id === 'ch157');

/* C 新增面 */
const adds = [['ch158', '万界武库思维链（V2）'], ['ch159', '万界武库通用选项栏'], ['ch160', '完满与破限'],
  ['ch161', '上位替代'], ['ch162', '武魂'], ['ch163', '神象镇狱劲'], ['ch164', '神圣几何'], ['ch165', '图书馆']];
ok('C1 八新包 id+名称就位', adds.every(([id, name]) => byId.get(id)?.name === name));
ok('C2 思维链V2 内容含 WJWK-think/WJWK-settle 结算格式',
  byName.get('万界武库思维链（V2）')?.content.includes('<WJWK-think>') &&
  byName.get('万界武库思维链（V2）')?.content.includes('<WJWK-settle>'));
ok('C3 通用选项栏内容含四思路', ['光明大道', '技出奇招', '未雨绸缪', '破釜沉舟']
  .every((k) => byName.get('万界武库通用选项栏')?.content.includes(k)));
ok('C4 新包品阶合法（按新字数分档）',
  byName.get('神圣几何')?.quality === '神话' && byName.get('武魂')?.quality === '传说');

/* D 同源面 */
ok('D1 index 与 packs 元数据逐字一致',
  cheatIndex.every((r) => {
    const p = byId.get(r.id);
    return p && r.name === p.name && r.quality === p.quality && r.chars === p.chars &&
      r.sub === p.sub && r.type === p.type && r.desc === p.desc;
  }));
ok('D2 新包 itemId 往返一致',
  adds.every(([id]) => cheatPackIdOfItem(cheatItemId(id)) === id));

/* 汇总 */
const fails = results.filter((r) => !r.cond);
for (const r of results) console.log((r.cond ? '✔' : '✘') + ' ' + r.name + (r.cond ? '' : ' — ' + r.detail));
A.equal(fails.length, 0, `${fails.length} 项失败: ${fails.map((f) => f.name).join('; ')}`);
console.log(`v2.88.0 万界武库合并更新门禁: ${results.length}/${results.length} 全绿`);