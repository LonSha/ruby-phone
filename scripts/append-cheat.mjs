/* 追加 / 更新单个外挂包：把一份正文文本落成 data/cheats.js 与 data/cheat-index.js 的同源条目。
 *
 * 为什么要有这个脚本：两个数据文件的文件头都写着「由 scripts 生成，勿手改」，
 *   且 id 已进玩家抽卡存档（id 稳定性铁律：永不重排/删除）。手工在两份文件里各插一段
 *   正文，必然出现「两份只改了一份」或「转义不一致」的漂移；脚本把三件事一次做完：
 *   品阶按字数分档、desc 从 <简介> 首句抽、两份文件的转义由**同一个函数**产出。
 *
 * 用法：
 *   node scripts/append-cheat.mjs --id ch166 --name 位移 --src /path/to/body.txt
 *   node scripts/append-cheat.mjs --id ch166 --name 位移 --src /path/to/body.txt --type 个人型
 * 幂等：id 已存在则**原地覆盖正文与元数据**（不新增条目、不改动 id 次序）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FULL = path.join(ROOT, 'data', 'cheats.js');
const IDX = path.join(ROOT, 'data', 'cheat-index.js');

function args() {
  const a = process.argv.slice(2);
  const out = {};
  for (let i = 0; i < a.length; i += 2) {
    const k = String(a[i] || '').replace(/^--/, '');
    if (k) out[k] = a[i + 1];
  }
  return out;
}

/* 品阶分档（与文件头声明同规：神话 >=6000 / 传说 >=4500 / 史诗 >=3500 / 稀有 >=2600 / 优秀 >=1800 / 普通） */
const BANDS = [[6000, '神话'], [4500, '传说'], [3500, '史诗'], [2600, '稀有'], [1800, '优秀'], [0, '普通']];
const qualityOf = (chars) => BANDS.find(([t]) => chars >= t)[1];

/* 从正文抽标签块内容（截到下一个 < 标签为止） —— 与 gen-cheats.mjs 同一口径 */
function pick(text, tag) {
  if (!text) return '';
  const m = text.match(new RegExp('<' + tag + '>[^<]*'));
  if (!m) return '';
  return m[0].slice(tag.length + 2).trim();
}
function firstSentence(s, max) {
  if (!s) return '';
  const cut = s.split(/\n/)[0].trim();
  const seg = cut.split(/(?<=[。！？；])/)[0] || cut;
  const out = seg.replace(/\s+/g, ' ').trim();
  return out.length > max ? out.slice(0, max) + '…' : out;
}
function axisTag(head) {
  const raw = pick(head, '主收益轴') + ' ' + pick(head, '核心收益');
  const m = raw.match(/(个人与平台复合型|平台兼个人复合型|个人型|平台型)/);
  if (m) return m[1].includes('复合') ? '复合型' : m[1];
  if (/平台|店铺|商城|领地|据点|界域/.test(raw + head.slice(0, 400))) return '平台型';
  if (/个人/.test(raw)) return '个人型';
  return '外挂';
}

const JSON_ESC = (s) => JSON.stringify(String(s));
const escTpl = (s) => String(s).replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${');

function readHeader(file, decl) {
  const s = fs.readFileSync(file, 'utf8');
  const at = s.indexOf(decl);
  if (at < 0) throw new Error('找不到声明：' + decl + ' @ ' + file);
  return { src: s, header: s.slice(0, at), decl: decl };
}

function writeFull(packs) {
  const { header } = readHeader(FULL, 'export const cheatPacks = [');
  const body = packs.map((p) => [
    '  {',
    '    "id": ' + JSON_ESC(p.id) + ',',
    '    "name": ' + JSON_ESC(p.name) + ',',
    '    "quality": ' + JSON_ESC(p.quality) + ',',
    '    "chars": ' + p.chars + ',',
    '    "sub": ' + p.sub + ',',
    '    "type": ' + JSON_ESC(p.type) + ',',
    '    "desc": ' + JSON_ESC(p.desc) + ',',
    '    "content": `' + escTpl(p.content) + '`',
    '  }',
  ].join('\n')).join(',\n');
  fs.writeFileSync(FULL, header + 'export const cheatPacks = [\n' + body + '\n];\nexport default { cheatPacks };\n', 'utf8');
}

const CHEAT_QUALITY_META = {
  '神话': { weight: 1, color: '#f59e0b', order: 0 },
  '传说': { weight: 2, color: '#ec4899', order: 1 },
  '史诗': { weight: 4, color: '#a855f7', order: 2 },
  '稀有': { weight: 8, color: '#3b82f6', order: 3 },
  '优秀': { weight: 16, color: '#10b981', order: 4 },
  '普通': { weight: 30, color: '#94a3b8', order: 5 },
};

function writeIdx(idx) {
  const { header } = readHeader(IDX, 'export const cheatIndex = [');
  const body = idx.map((p) => [
    '  {',
    '    "id": ' + JSON_ESC(p.id) + ',',
    '    "name": ' + JSON_ESC(p.name) + ',',
    '    "quality": ' + JSON_ESC(p.quality) + ',',
    '    "chars": ' + p.chars + ',',
    '    "sub": ' + p.sub + ',',
    '    "type": ' + JSON_ESC(p.type) + ',',
    '    "desc": ' + JSON_ESC(p.desc) + ',',
    '  }',
  ].join('\n')).join(',\n');
  const tail = readHeader(IDX, '/** 品阶元数据').src;
  const tailAt = tail.indexOf('/** 品阶元数据');
  fs.writeFileSync(IDX, header + 'export const cheatIndex = [\n' + body + '\n];\n\n'
    + tail.slice(tailAt), 'utf8');
}

const A = args();
if (!A.id || !A.name || !A.src) {
  console.error('用法: node scripts/append-cheat.mjs --id ch166 --name 位移 --src body.txt [--type 个人型]');
  process.exit(2);
}
if (!/^ch[0-9]{3}$/.test(A.id)) { console.error('id 形态必须是 chNNN：' + A.id); process.exit(2); }

const body = fs.readFileSync(A.src, 'utf8').replace(/\r\n/g, '\n').trim();
if (!/<[^>]+>/.test(body)) { console.error('正文必须含 <> 段标签'); process.exit(2); }
const chars = body.length;
const pack = {
  id: A.id,
  name: A.name,
  quality: qualityOf(chars),
  chars: chars,
  sub: 1,
  type: A.type || axisTag(body),
  desc: firstSentence(pick(body, '简介'), 60) || firstSentence(pick(body, '本质'), 60),
  content: body,
};
if (!CHEAT_QUALITY_META[pack.quality]) { console.error('分档失败'); process.exit(2); }

const before = (await import(pathToFileURL(FULL).href + '?v=' + Date.now())).cheatPacks.map((p) => ({ ...p }));
const packs = before.map((p) => ({ ...p }));
const at = packs.findIndex((p) => p.id === A.id);
if (at >= 0) { packs[at] = pack; console.log('原地覆盖', A.id); } else { packs.push(pack); console.log('追加', A.id); }

const idxBefore = (await import(pathToFileURL(IDX).href + '?v=' + Date.now())).cheatIndex.map((p) => ({ ...p }));
const idx = idxBefore.map((p) => ({ ...p }));
const cell = { id: pack.id, name: pack.name, quality: pack.quality, chars: pack.chars, sub: pack.sub, type: pack.type, desc: pack.desc };
const j = idx.findIndex((p) => p.id === A.id);
if (j >= 0) idx[j] = cell; else idx.push(cell);

writeFull(packs);
writeIdx(idx);

/* 回读自证：① 全部旧条目逐字未变（除目标 id）；② 两份文件同源；③ 转义往返无损 */
const after = (await import(pathToFileURL(FULL).href + '?v=' + Date.now())).cheatPacks;
const idxAfter = (await import(pathToFileURL(IDX).href + '?v=' + Date.now())).cheatIndex;
if (after.length !== packs.length) throw new Error('回读条数不符');
for (const p of after) {
  const o = pack.id === p.id ? pack : before.find((x) => x.id === p.id);
  if (!o) throw new Error('回读出现未知 id：' + p.id);
  for (const k of ['name', 'quality', 'chars', 'sub', 'type', 'desc', 'content']) {
    if (p[k] !== o[k]) throw new Error('回读不一致 ' + p.id + '.' + k);
  }
}
if (idxAfter.length !== after.length) throw new Error('索引与正文条数不符');
for (const r of idxAfter) {
  const p = after.find((x) => x.id === r.id);
  if (!p) throw new Error('索引含正文没有的 id：' + r.id);
  for (const k of ['name', 'quality', 'chars', 'sub', 'type', 'desc']) {
    if (r[k] !== p[k]) throw new Error('同源不一致 ' + r.id + '.' + k);
  }
}
console.log('OK: packs=' + after.length + ' 新增/更新 ' + pack.id + ' ' + pack.name
  + ' quality=' + pack.quality + ' chars=' + pack.chars + ' type=' + pack.type);
console.log('desc=' + pack.desc);
