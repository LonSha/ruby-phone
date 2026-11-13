#!/usr/bin/env node
/* ============================================================================
 * merge-cheats-1108.mjs — 金手指「1108 扩库」可复现合并脚本
 *
 * 源（作者本次交付的四份世界书导出，逐字内置，不改写正文）：
 *   - 1013 V4.1 全量包   attachment_1557575794632465350.json
 *   - 1026 升级包         attachment_7375563858467993178.json
 *   - 1108 更新包         attachment_9062188402301171461.json
 *   - 漫漫长路             attachment_145286129588258533.json
 * 上游 https://github.com/feiluoze/wanjie-wuku 1.7.3 仅作权威原文对照，
 *   本轮**不**从上游追加附件未交付的词条（不猜、不替作者扩写）。
 *
 * 三条纪律（与 scripts/append-cheat.mjs / merge-cheats-v41.mjs 同规格）：
 *   ① id 稳定：旧 ch001–ch166 的 id、次序、正文、元数据**一字不动**；
 *      新增包只从 max+1 顺延追加（cheat_<packId> 已进玩家抽卡存档）。
 *   ② 同源：data/cheats.js 与 data/cheat-index.js 由本脚本一次写出，
 *      同一 escTpl / JSON_ESC，回读逐字段自证。
 *   ③ 家族归并：同一批里「主条 + ·子条」拼成**一个**外挂（主条在前），
 *      避免同一外挂被抽两次却只生效一半；漫漫长路 21 段按上游模块形状
 *      归为一个「漫漫长路」包（sub=21），不拆成 21 张半套卡。
 *
 * 【本轮明确的边界】1013 附件里 6 条「熟练度状态栏· / 人生模拟· /
 *   文明之光系统·」子条，其主包 ch026 / ch043 / ch067 已被
 *   tests/audit/cheat-packs-before-v3160.json 逐字冻结。并入它们必须改旧包
 *   正文，属另一个「家族补全」版本，本轮**如实排除并打印清单**，
 *   不为「附件全用上」的读数好看而破坏冻结台账。
 *
 * 用法：node scripts/merge-cheats-1108.mjs [--src-dir <附件目录>]
 * 幂等：已存在 ch167+ 且内容一致时原地覆盖（不新增、不重排）。
 * 产物：data/cheats.js、data/cheat-index.js、tests/audit/cheat-packs-1108.json
 * ========================================================================== */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FULL = path.join(ROOT, 'data', 'cheats.js');
const IDX = path.join(ROOT, 'data', 'cheat-index.js');
const LEDGER = path.join(ROOT, 'tests', 'audit', 'cheat-packs-1108.json');
const FROZEN = path.join(ROOT, 'tests', 'audit', 'cheat-packs-before-v3160.json');

const argv = process.argv.slice(2);
const srcDir = argv.includes('--src-dir')
  ? argv[argv.indexOf('--src-dir') + 1]
  : '/storage/emulated/0/Download/Operit/cleanOnExit';
const FILES = {
  v41: 'attachment_1557575794632465350.json',
  up1026: 'attachment_7375563858467993178.json',
  up1108: 'attachment_9062188402301171461.json',
  mmlc: 'attachment_145286129588258533.json',
};

/* ---------- 通用口径（与 gen-cheats.mjs / append-cheat.mjs 逐字同规） ---------- */
const BANDS = [[6000, '神话'], [4500, '传说'], [3500, '史诗'], [2600, '稀有'], [1800, '优秀'], [0, '普通']];
const qualityOf = (chars) => BANDS.find(([t]) => chars >= t)[1];
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
  const rawAx = pick(head, '主收益轴') + ' ' + pick(head, '核心收益');
  const m = rawAx.match(/(个人与平台复合型|平台兼个人复合型|个人型|平台型)/);
  if (m) return m[1].includes('复合') ? '复合型' : m[1];
  if (/平台|店铺|商城|领地|据点|界域/.test(rawAx + head.slice(0, 400))) return '平台型';
  if (/个人/.test(rawAx)) return '个人型';
  return '外挂';
}
const JSON_ESC = (s) => JSON.stringify(String(s));
const escTpl = (s) => String(s).replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${');
const md5 = (s) => crypto.createHash('md5').update(String(s), 'utf8').digest('hex');
const norm = (s) => String(s == null ? '' : s).replace(/\r\n/g, '\n').trim();

/* ---------- 1) 读四份附件 → 有序条目 ---------- */
function readEntries(file) {
  const p = path.join(srcDir, file);
  if (!fs.existsSync(p)) throw new Error('附件缺失：' + p + '（用 --src-dir 指定目录）');
  const j = JSON.parse(fs.readFileSync(p, 'utf8'));
  const es = j.entries || j;
  return Object.keys(es)
    .sort((a, b) => (Number(a) || 0) - (Number(b) || 0))
    .map((k) => ({ key: k, comment: String(es[k]?.comment || '').trim(), content: norm(es[k]?.content) }))
    .filter((e) => e.comment && e.content);
}
const ATT = {};
for (const [k, f] of Object.entries(FILES)) ATT[k] = readEntries(f);
console.log('附件条目:', Object.entries(ATT).map(([k, v]) => k + '=' + v.length).join(' '));

/* ---------- 2) 读旧库（真源：node 导入） ---------- */
const { cheatPacks: oldPacks } = await import(pathToFileURL(FULL).href + '?v=' + Date.now());
const { cheatIndex: oldIdx } = await import(pathToFileURL(IDX).href + '?v=' + Date.now());
const before = oldPacks.map((p) => ({ ...p }));
const baseline = before.slice(0, 166);           // 冻结前 166 包（重跑时不把新包当旧包）
const oldByName = new Set(baseline.map((p) => p.name));
if (before.length < 166) throw new Error('基线库不足 166 包，拒绝合并（实测 ' + before.length + '）');

/* ---------- 3) 组装「新增家族」 ---------- */
/* 3a) 1013/1026/1108：按 · 前缀归并；base 已在旧库 → 整组排除（冻结，不覆盖） */
const frozenSubs = [];
const families = new Map();
for (const tag of ['v41', 'up1026', 'up1108']) {
  for (const e of ATT[tag]) {
    const base = e.comment.split('·')[0].trim();
    if (!base) continue;
    if (oldByName.has(base)) {
      if (e.comment !== base) frozenSubs.push({ tag, name: e.comment, base });
      continue; // 旧包一字不动
    }
    if (!families.has(base)) families.set(base, { base, items: new Map(), tag });
    const g = families.get(base);
    const prev = g.items.get(e.comment);
    if (!prev || e.content.length > prev.length) g.items.set(e.comment, e.content);
  }
}
/* 3b) 漫漫长路：21 段按原顺序合成一个家族包（不拆半套） */
const mmlcItems = ATT.mmlc.map((e) => [e.comment, e.content]);
if (mmlcItems.length !== 21) throw new Error('漫漫长路条目数不是 21（实测 ' + mmlcItems.length + '）');
families.set('漫漫长路', { base: '漫漫长路', items: new Map(mmlcItems), tag: 'mmlc' });

/* 3c) 家族 → pack（主条在前，其余按附件原序） */
function buildPack(fam, id) {
  const items = [...fam.items.entries()];
  if (fam.tag === 'mmlc') {
    // 21 段平级章节，无独立主条：按 uid 原序拼接
  } else {
    items.sort((a, b) => (a[0] === fam.base ? 0 : 1) - (b[0] === fam.base ? 0 : 1));
  }
  const body = items.map(([, c]) => c).join('\n\n');
  const head = items[0]?.[1] || '';
  return {
    id, name: fam.base,
    quality: qualityOf(body.length), chars: body.length, sub: items.length,
    type: axisTag(head), desc: firstSentence(pick(head, '简介'), 60) || firstSentence(pick(head, '本质'), 60),
    content: body, source: fam.tag,
  };
}
let nextId = 167; // 固定锚：基于冻结 166 基线，幂等重跑不得把 ch167–ch203 重编成 ch204+
const added = [];
for (const fam of families.values()) {
  added.push(buildPack(fam, 'ch' + String(nextId).padStart(3, '0')));
  nextId += 1;
}
added.sort((a, b) => parseInt(a.id.slice(2), 10) - parseInt(b.id.slice(2), 10));
console.log('新增家族包:', added.length, '| id 区间', added[0]?.id, '→', added[added.length - 1]?.id);
console.log('冻结排除的 ·子条 (' + frozenSubs.length + '):', frozenSubs.map((x) => x.name).join(' | ') || '(无)');

/* ---------- 4) 合并 + 语义校验 ---------- */
/* 幂等：脚本重跑时，若 ch167+ 已存在且逐字一致，原地覆盖而不是再追加 */
const existAdded = before.slice(166);               // 重跑时已有新增包（不参与 oldByName 排除）
if (existAdded.length && existAdded.length !== added.length) {
  throw new Error('已有新增包数量与本次不符（' + existAdded.length + ' vs ' + added.length + '），拒绝重排');
}
// 恒等替换：out = 冻结基线 166 + 本轮 37 包（ch167–ch203），重跑逐字一致
const out = baseline.map((p) => ({ ...p }));
for (const p of added) out.push(p);
if (new Set(out.map((p) => p.id)).size !== out.length) throw new Error('id 冲突');
if (out.some((p) => !String(p.content || '').trim())) throw new Error('空 content');
for (let i = 0; i < 166; i++) {
  const a = out[i], b = baseline[i];
  for (const k of ['id', 'name', 'quality', 'chars', 'sub', 'type', 'desc', 'content']) {
    if (a[k] !== b[k]) throw new Error('旧包漂移 ' + b.id + '.' + k);
  }
}
/* 冻结台账交叉核对（v3.16.0 的 165 包 md5 必须仍成立） */
if (fs.existsSync(FROZEN)) {
  const ledger = JSON.parse(fs.readFileSync(FROZEN, 'utf8'));
  for (const row of ledger.packs || []) {
    const p = out.find((x) => x.id === row.id);
    if (!p || md5(p.content) !== row.contentMd5) throw new Error('冻结台账失配：' + row.id);
  }
}

/* ---------- 5) 同源写两份文件 ---------- */
function readHeader(file, decl) {
  const s = fs.readFileSync(file, 'utf8');
  const at = s.indexOf(decl);
  if (at < 0) throw new Error('找不到声明：' + decl + ' @ ' + file);
  return { src: s, header: s.slice(0, at), tailAt: s.indexOf('/** 品阶元数据') };
}
const STAMP = ' * [1108 扩库] scripts/merge-cheats-1108.mjs 追加 ' + added.length
  + ' 包（1013 V4.1 主条 / 1026 家族 / 1108 / 漫漫长路 21 段合 1 包）；旧 166 包逐字冻结。\n';
const fh = readHeader(FULL, 'export const cheatPacks = [');
let fullHeader = fh.header;
if (!fullHeader.includes('[1108 扩库]')) {
  const anchor = fullHeader.lastIndexOf(' * ======================================================== */');
  fullHeader = fullHeader.slice(0, anchor) + STAMP + fullHeader.slice(anchor);
}
const fullBody = out.map((p) => [
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
fs.writeFileSync(FULL, fullHeader + 'export const cheatPacks = [\n' + fullBody + '\n];\nexport default { cheatPacks };\n', 'utf8');

const ih = readHeader(IDX, 'export const cheatIndex = [');
let idxHeader = ih.header;
if (!idxHeader.includes('[1108 扩库]')) {
  const anchor = idxHeader.lastIndexOf(' * ======================================================== */');
  idxHeader = idxHeader.slice(0, anchor) + STAMP + idxHeader.slice(anchor);
}
const idxTail = ih.src.slice(ih.tailAt);
const idxBody = out.map((p) => [
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
fs.writeFileSync(IDX, idxHeader + 'export const cheatIndex = [\n' + idxBody + '\n];\n\n' + idxTail, 'utf8');

/* ---------- 6) 新增包台账（判据自包含，不依赖外部附件路径） ---------- */
fs.mkdirSync(path.dirname(LEDGER), { recursive: true });
fs.writeFileSync(LEDGER, JSON.stringify({
  note: '1108 扩库新增包冻结台账；contentMd5 对照 data/cheats.js 逐字正文，判据不读外部附件。',
  source: Object.fromEntries(Object.entries(FILES).map(([k, f]) => [k, f])),
  frozenSubEntries: frozenSubs,
  beforeCount: 166, addedCount: added.length, totalCount: out.length,
  packs: added.map((p) => ({
    id: p.id, name: p.name, quality: p.quality, chars: p.chars, sub: p.sub,
    type: p.type, desc: p.desc, source: p.source, contentMd5: md5(p.content),
    firstTag: (p.content.match(/^<([^>]+)>/) || [])[1] || '',
  })),
}, null, 2) + '\n', 'utf8');

/* ---------- 7) 回读自证 ---------- */
const after = (await import(pathToFileURL(FULL).href + '?v=' + Date.now())).cheatPacks;
const idxAfter = (await import(pathToFileURL(IDX).href + '?v=' + Date.now())).cheatIndex;
if (after.length !== out.length) throw new Error('回读条数不符');
for (let i = 0; i < out.length; i++) {
  const p = after[i], o = out[i];
  for (const k of ['id', 'name', 'quality', 'chars', 'sub', 'type', 'desc', 'content']) {
    if (p[k] !== o[k]) throw new Error('回读不一致 ' + o.id + '.' + k);
  }
  if (p.chars !== String(p.content).length) throw new Error('chars 不忠实 ' + o.id);
}
if (idxAfter.length !== after.length) throw new Error('索引与正文条数不符');
for (const r of idxAfter) {
  const p = after.find((x) => x.id === r.id);
  if (!p) throw new Error('索引含正文没有的 id：' + r.id);
  for (const k of ['name', 'quality', 'chars', 'sub', 'type', 'desc']) {
    if (r[k] !== p[k]) throw new Error('同源不一致 ' + r.id + '.' + k);
  }
}
console.log('OK: 旧 166 包逐字不动 | 新增 ' + added.length + ' 包 | 总库 ' + after.length + ' 包 | 台账 ' + path.relative(ROOT, LEDGER));
console.log('新增清单:', added.map((p) => p.id + ' ' + p.name + '(sub' + p.sub + '/' + p.chars + '字/' + p.quality + ')').join(', '));
