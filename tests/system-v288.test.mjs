/* [v2.88.0] 万界武库 V4.1 合并式更新门禁
 *
 * [v3.16.0 交棒] 本套件原先把「165 包」当作**当版精确读数**硬写进 A1/A2（抬版即过期）。
 *   按本仓既定两式改写：库规模改**下限形**（只锁「库不得塌缩」），
 *   同源改**结构形**（id 唯一 + 索引与正文逐条对齐，不锁具体数），
 *   另补一条**当版增量锚**（ch166 就位）承担「新包真的进来了」这件事。
 * A 数据面：157 → 165 包（v2.88.0 读数），id 稳定性（不砍原有、不重排）；
 * B 更新面：V4.1 同名包正文确实覆盖（旧字数特征消失、新字数特征就位）；
 * C 新增面：8 新包就位且内容特征正确；
 * D 同源面：index 与 packs 元数据逐字一致（含新包）。
 */
import { strict as A } from 'node:assert';
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cheatPacks } from '../data/cheats.js';
import { cheatIndex, cheatItemId, cheatPackIdOfItem } from '../data/cheat-index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const md5 = (s) => crypto.createHash('md5').update(String(s), 'utf8').digest('hex');
/* 1120 批次的改写授权台账（旧包正文换版必须在这里留痕） */
const AUTH_DOC = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests', 'audit', 'cheat-rewrite-authorizations.json'), 'utf8'));
const AUTH_BY_ID = new Map((AUTH_DOC.rewrites || []).map((r) => [r.id, r]));

const results = [];
const ok = (name, cond, detail = '') => results.push({ name, cond, detail });

const byName = new Map(cheatPacks.map((p) => [p.name, p]));
const byId = new Map(cheatPacks.map((p) => [p.id, p]));

/* A 数据面 */
ok('A1 库规模不得塌缩（下限形：v2.88.0 实测 165 包，只锁下限）',
  cheatPacks.length >= 165, String(cheatPacks.length));
ok('A2 id 唯一且 index 逐条对齐（结构形，不锁具体条数）',
  byId.size === cheatPacks.length && cheatIndex.length === cheatPacks.length,
  `${byId.size}/${cheatIndex.length}/${cheatPacks.length}`);
ok('A3 旧锚点包保留（ch001 赋能 / ch096 万界武库 / ch128 思维链V1 / ch157 与共者）',
  byId.get('ch001')?.name === '赋能' && byId.get('ch096')?.name === '万界武库' &&
  byId.get('ch128')?.name === '万界武库思维链' && byId.get('ch157')?.name === '与共者');
ok('A4 前 157 包 id 连续无漂移（ch001..ch157）',
  cheatPacks.slice(0, 157).every((p, i) => p.id === 'ch' + String(i + 1).padStart(3, '0')));
ok('A5 正文全部非空且 chars 忠实',
  cheatPacks.every((p) => String(p.content || '').trim().length > 0 && p.chars === p.content.length));

/* B 更新面（覆盖特征）
 * [1120 改写] 原先把 V4.1 的字数硬写死（5662 / 8121 / 3872 / 10562）。作者整包重写后
 *   这些字数必然变 —— 写死等于「不许作者再改」。B 组要证明的性质其实是
 *   「同名包的正文确实被新版本覆盖了，不是还留着旧版」，所以改成对照授权台账：
 *     · 有授权记录 ⇒ chars / md5 必须等于授权终点，且字数**必须与旧读数不同**（真被换了）；
 *     · 无授权记录 ⇒ 字数必须仍等于旧读数（说明它确实没被覆盖，而不是被悄悄改了）。 */
const LEGACY_CHARS = { '源堡': 5662, '神圣几何': 8121, '点石成金': 3872, '文明之光系统': 10562 };
for (const [name, oldChars] of Object.entries(LEGACY_CHARS)) {
  const p = byName.get(name);
  if (!p) { ok('B·' + name + ' 必须在场', false, '缺包'); continue; }
  const a = AUTH_BY_ID.get(p.id);
  if (a) {
    ok('B·' + name + ' 已换版（chars＝授权终点 ' + a.toChars + '）', p.chars === a.toChars, '实测 ' + p.chars);
    ok('B·' + name + ' 正文＝授权终点 md5', md5(p.content) === a.toMd5);
    ok('B·' + name + ' 必须真的被覆盖（字数不等旧版 ' + oldChars + '）', p.chars !== oldChars, '仍是旧字数');
  } else {
    ok('B·' + name + ' 未被改写（chars 保持旧读数 ' + oldChars + '）', p.chars === oldChars, '实测 ' + p.chars);
  }
}
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
/* C4 [1120 改写] 原先把品阶写死（神圣几何=神话 / 武魂=传说）。作者整包重写后字数变了，
 *   品阶按分档规则自然落档也会变 —— 写死品阶名等于测"字数有没有变"，不是测"品阶合不合法"。
 *   改为：品阶必须等于它自己字数的分档结果。 */
const QUALITY_BANDS = [[6000, '神话'], [4500, '传说'], [3500, '史诗'], [2600, '稀有'], [1800, '优秀'], [0, '普通']];
const qualityOf = (n) => QUALITY_BANDS.find(([t]) => n >= t)[1];
ok('C4 新包品阶合法（按其字数落档，不写死品阶名）',
  ['神圣几何', '武魂'].every((n) => { const p = byName.get(n); return !!p && p.quality === qualityOf(p.chars); }),
  ['神圣几何', '武魂'].map((n) => n + '=' + byName.get(n)?.quality + '@' + byName.get(n)?.chars).join(' / '));

/* C5 当版增量锚（[v3.16.0]）—— 库规模改下限形后，由本条承担「新包真的进来了」 */
ok('C5 ch166 位移就位（个人型 / 含 WJWK-settle 结算段）',
  byId.get('ch166')?.name === '位移' && byId.get('ch166')?.type === '个人型'
  && String(byId.get('ch166')?.content || '').includes('<位移>')
  && String(byId.get('ch166')?.content || '').includes('<WJWK-settle>')
  && String(byId.get('ch166')?.content || '').includes('<必要边界>'),
  String(byId.get('ch166')?.name));

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