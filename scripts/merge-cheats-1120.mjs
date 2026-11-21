#!/usr/bin/env node
/* ============================================================================
 * merge-cheats-1120.mjs — 金手指「1120 版」可复现合并脚本
 *
 * 源：作者本次交付的一份世界书导出
 *   万界武库V4.1（1120）  attachment_2151577648521610606.json（177 条 / 578,693 字）
 *
 * 【本轮事实（与 1108 轮不同，必须写清）】
 *   这份 1120 导出是**整包重写**，不是增量包：
 *     · 源归并后 153 包；与现状 203 包比对，**同名且正文逐字相同的 0 包**；
 *     · 同名但正文被改写 126 包（其中 92 包落在 v3.16.0 冻结台账 ch001–ch165 内）；
 *     · 源里有、现状没有 27 包（本轮唯一可安全落库的部分）；
 *     · 现状有、源里没有 77 包（源是子集，据此删包会违反 id 稳定铁律）。
 *
 * 【本脚本做加法 + （可授权）改写】
 *   126 包正文改写**默认落库**（用户明确授权），但落库不是"偷偷改"：
 *     ① 新建 tests/audit/cheat-rewrite-authorizations.json，逐包记 fromMd5 → toMd5、
 *        fromChars → toChars、是否落在 v3.16.0 冻结段；
 *     ② 冻结台账本身**一字不改**（它是 v3.16.0 那一刻的历史快照，改它就等于
 *        宣布"冻结从未存在过"）；
 *     ③ 冻结校验升级成**链式**：当前正文 md5 必须等于「历史 md5 叠加所有授权改写后」
 *        的期望值，且每条授权的 fromMd5 必须等于它覆盖前的链条值 —— 越权改旧包
 *        （没有授权记录）依然中止。
 *   传 --hold-revisions 可回到旧的"只做加法"行为（不落库改写）。
 *
 * 三条纪律：
 *   ① id 稳定：旧 ch001–ch203 的 id、次序、正文、元数据一字不动；新增只从 max+1 顺延。
 *   ② 同源：data/cheats/*.js（正文分片）+ data/cheat-index.js 由本脚本一次写出，回读自证。
 *   ③ 落库前先验冻结：v3.16.0（165 包）与 1108 台账（37 包）的 md5 必须仍然成立，
 *      任何一条漂移即中止——本脚本绝不覆盖已漂移的旧包。
 *
 * 用法：node scripts/merge-cheats-1120.mjs [--src-dir <附件目录>] [--dry-run]
 * 幂等：已在台账里的 id 原地覆盖正文；不在台账里的同名包视为冻结，绝不改写。
 * 产物：data/cheats/part-NN.js、data/cheats.js、data/cheat-index.js、
 *       tests/audit/cheat-packs-1120.json
 * ========================================================================== */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const AGG = path.join(ROOT, 'data', 'cheats.js');
const IDX = path.join(ROOT, 'data', 'cheat-index.js');
const SHARD_DIR = path.join(ROOT, 'data', 'cheats');
const LEDGER = path.join(ROOT, 'tests', 'audit', 'cheat-packs-1120.json');
const FROZEN = path.join(ROOT, 'tests', 'audit', 'cheat-packs-before-v3160.json');
const LEDGER_1108 = path.join(ROOT, 'tests', 'audit', 'cheat-packs-1108.json');
/* 改写授权台账：只记「谁在什么时候被授权把哪个包从哪版改成哪版」，不塞正文。
 * 它是冻结校验链条的延长线，不是冻结台账的替代品。 */
const AUTH = path.join(ROOT, 'tests', 'audit', 'cheat-rewrite-authorizations.json');
const PACKS_PER_PART = 6;

const argv = process.argv.slice(2);
const DRY = argv.includes('--dry-run');
/* 改写是否落库：默认落库（用户明示「改写的也落库」）；--hold-revisions 回到只做加法。 */
const APPLY_REVISIONS = !argv.includes('--hold-revisions');
/* 源默认读仓内缓存（.sourcematerial/ 在 .gitignore 里，cleanOnExit 会被系统清空，
 *   本脚曾经因为源被清而无法复现 —— 先把源拷进仓再跑，是硬纪律）。 */
const srcDir = argv.includes('--src-dir') ? argv[argv.indexOf('--src-dir') + 1]
  : path.join(ROOT, '.sourcematerial');
const SRC_CANDIDATES = [
  path.join(srcDir, 'wuku-v4.1-1120.json'),
  path.join(srcDir, 'attachment_3619474458893374307.json'),
  path.join(srcDir, 'attachment_2151577648521610606.json'),
];
const SRC_FILE = SRC_CANDIDATES.find((f) => fs.existsSync(f)) || SRC_CANDIDATES[0];

/* ---------- 口径（与 gen-cheats.mjs / append-cheat.mjs / merge-cheats-1108.mjs 逐字同规） ---------- */
const BANDS = [[6000, '神话'], [4500, '传说'], [3500, '史诗'], [2600, '稀有'], [1800, '优秀'], [0, '普通']];
const qualityOf = (chars) => BANDS.find(([t]) => chars >= t)[1];
const md5 = (s) => crypto.createHash('md5').update(String(s), 'utf8').digest('hex');
const cleanName = (n) => String(n || '').trim().replace(/[>》]+$/, '').trim();
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

/* ---------- 1) 读源并按 gen-cheats 同规归并 ---------- */
if (!fs.existsSync(SRC_FILE)) {
  console.error('找不到源导出：' + SRC_FILE);
  console.error('用 --src-dir 指到含 attachment_2151577648521610606.json 的目录');
  process.exit(2);
}
const raw = JSON.parse(fs.readFileSync(SRC_FILE, 'utf8'));
const srcEntries = Object.values(raw.entries || {});
const groups = new Map();
for (const e of srcEntries) {
  const name = cleanName(e.comment);
  if (!name) continue;
  const base = name.split('\u00b7')[0].trim();
  if (!groups.has(base)) groups.set(base, new Map());
  const g = groups.get(base);
  const content = String(e.content || '');
  const prev = g.get(name);
  if (!prev || content.length > prev.length) g.set(name, content);
}
const srcPacks = [];
for (const [base, g] of groups) {
  const rows = [...g.entries()].sort((a, b) => (a[0] === base ? -1 : b[0] === base ? 1 : 0));
  const content = rows.map((r) => r[1]).join('\n\n');
  srcPacks.push({
    name: base,
    sub: rows.length,
    chars: content.length,
    quality: qualityOf(content.length),
    type: axisTag(rows.find((r) => r[0] === base)?.[1] || rows[0][1]),
    desc: firstSentence(pick(content, '简介'), 60) || firstSentence(pick(content, '本质'), 60),
    content,
  });
}

/* ---------- 2) 读现状 + 旧包 md5 冻结自证（落库前置闸门） ---------- */
const before = (await import(pathToFileURL(AGG).href + '?t=' + Date.now())).cheatPacks.map((p) => ({ ...p }));
const idxBefore = (await import(pathToFileURL(IDX).href + '?t=' + Date.now())).cheatIndex.map((p) => ({ ...p }));
const frozen = JSON.parse(fs.readFileSync(FROZEN, 'utf8'));
const ledger1108 = JSON.parse(fs.readFileSync(LEDGER_1108, 'utf8'));
const priorAuth = fs.existsSync(AUTH) ? JSON.parse(fs.readFileSync(AUTH, 'utf8')) : { rewrites: [] };
const beforeById = new Map(before.map((p) => [p.id, p]));

/* ---------- 冻结校验（链式） ----------
 * 期望值 = 历史快照（v3.16.0 165 包 → 1108 批 37 包）逐层叠加「授权改写」。
 * 每一步叠加都必须验证 fromMd5 === 当前链条值：
 *   · 若某条授权声明的起点不是链条上的现值 ⇒ 有人在中间偷偷改过 ⇒ 中止；
 *   · 若某包被改了但链条上没有任何授权记录 ⇒ 当前 md5 对不上期望值 ⇒ 中止。
 * 这比"必须等于历史 md5"更强：现在"变了必须有权，且起点必须对得上"。
 *
 * 【为什么要做成函数】同一个链条要在**两个时点**各算一次：
 *   · 落库前：用「已有的授权台账」(priorAuth) 校验当前盘面 —— 防止覆盖来历不明的正文；
 *   · 落库后：用「本次写入后的授权台账」(authDoc) 校验刚写出的盘面 —— 防止写在别处。
 *   第一版把 expectedMd5 只算了一次（落库前），落库后拿旧期望去自证，
 *   结果 126 处全红 —— 那不是数据错，是探针拿错了期望表。 */
function buildExpectedMd5(rewriteRows) {
  const exp = new Map();
  for (const row of frozen.packs) exp.set(row.id, row.contentMd5);
  for (const row of ledger1108.packs) exp.set(row.id, row.contentMd5);
  const breaks = [];
  for (const row of rewriteRows) {
    const prev = exp.get(row.id);
    if (prev === undefined) {
      // 该包不在任何历史快照里：只允许它是本脚本此前新增过的包，链条从它建档时的 toMd5 开始。
      exp.set(row.id, row.toMd5);
      continue;
    }
    if (prev !== row.fromMd5) breaks.push(row.id + '（声明起点 ' + String(row.fromMd5).slice(0, 8) + ' ≠ 链条现值 ' + String(prev).slice(0, 8) + '）');
    exp.set(row.id, row.toMd5);
  }
  return { exp, breaks };
}

const preCheck = buildExpectedMd5(priorAuth.rewrites || []);
if (preCheck.breaks.length) {
  console.error('中止：改写授权台账链条断裂 ' + preCheck.breaks.length + ' 处（不许在未记录的中间态上继续叠加）：\n - ' + preCheck.breaks.slice(0, 8).join('\n - '));
  process.exit(1);
}
let drift = 0;
for (const [id, want] of preCheck.exp) {
  const p = beforeById.get(id);
  if (!p) { drift++; console.error('包缺失：' + id); continue; }
  if (md5(p.content) !== want) { drift++; console.error('正文与期望不符：' + id); }
}
if (drift) {
  console.error('中止：有 ' + drift + ' 包正文与「历史快照 + 授权改写链」的期望值不符');
  console.error('  若是别人手改的，先查 git diff —— 本脚本不覆盖来历不明的正文。');
  process.exit(1);
}
console.log('冻结链式自证通过：历史 ' + (frozen.packs.length + ledger1108.packs.length)
  + ' 条 + 已授权改写 ' + (priorAuth.rewrites || []).length + ' 条，链条无断裂、逐包 md5 全部成立');

/* ---------- 3) 分类：本批新增 / 作者改写（不落库）/ 源外（不删） ---------- */
const priorLedger = fs.existsSync(LEDGER) ? JSON.parse(fs.readFileSync(LEDGER, 'utf8')) : { packs: [] };
const ownedIds = new Set((priorLedger.packs || []).map((p) => p.id));
const byName = new Map(before.map((p) => [cleanName(p.name), p]));
let nextNum = before.reduce((m, p) => Math.max(m, Number(String(p.id).slice(2)) || 0), 0) + 1;
const added = [], revised = [];
for (const p of srcPacks) {
  const cur = byName.get(p.name);
  if (!cur) {
    added.push({ ...p, id: 'ch' + String(nextNum++).padStart(3, '0'), source: '1120' });
    continue;
  }
  if (String(cur.content) === p.content) continue;           // 逐字相同的（本轮实测 0 包）
  revised.push({
    ...p, id: cur.id, inPlace: ownedIds.has(cur.id),
    oldChars: cur.chars, oldMd5: md5(cur.content),
    oldQuality: cur.quality, oldSub: cur.sub, oldType: cur.type, oldDesc: cur.desc,
  });
}
const srcNames = new Set(srcPacks.map((p) => p.name));
const outside = before.filter((p) => !srcNames.has(cleanName(p.name)));
/* 是否落库：默认全部落库；--hold-revisions 时只落「本批此前已经落地过的包」，其余只登记。 */
const toApply = APPLY_REVISIONS ? revised : revised.filter((r) => r.inPlace);
const holdRevised = revised.filter((r) => !toApply.includes(r));

console.log('源归并包 ' + srcPacks.length + '｜现状 ' + before.length + ' 包');
console.log('本批新增 ' + added.length + ' 包（' + (added[0]?.id || '-') + '–' + (added.at(-1)?.id || '-') + '）');
console.log('作者改写 ' + revised.length + ' 包｜本次落库 ' + toApply.length
  + (APPLY_REVISIONS ? '（授权改写全落）' : '｜按 --hold-revisions 暂缓 ' + holdRevised.length));
console.log('源外旧包 ' + outside.length + ' 包（源是子集，不删）');

/* ---------- 4) 合成最终列表 ---------- */
const inPlaceById = new Map(toApply.map((r) => [r.id, r]));
const packs = before.map((p) => {
  const upd = inPlaceById.get(p.id);
  if (!upd) return { ...p };
  /* 改写落库 = 正文 + 六个元数据字段**整体替换**（chars/quality/sub/type/desc 都会随正文变，
   *   只换正文会让索引与正文对不上 —— D1「同源」判据会立刻抓出来）。 */
  return { id: p.id, name: upd.name, quality: upd.quality, chars: upd.chars, sub: upd.sub, type: upd.type, desc: upd.desc, content: upd.content };
});
for (const a of added) {
  packs.push({ id: a.id, name: a.name, quality: a.quality, chars: a.chars, sub: a.sub, type: a.type, desc: a.desc, content: a.content });
}
// id 连续自证（新加的必须是 max+1 起顺延，不许插队）
for (let i = 0; i < packs.length; i++) {
  const want = 'ch' + String(i + 1).padStart(3, '0');
  if (packs[i].id !== want) { console.error('中止：id 次序断裂 @' + i + ' 期望 ' + want + ' 实得 ' + packs[i].id); process.exit(1); }
}

/* 【幂等写法】重跑时那 27 包已经在库里（名字存在、id 也已在台账里），会被归到
 *   「可原地更新」而不是「新增」。若仍按 added 重写台账，第二次跑就会把 addedCount
 *   写成 0、把 packs 清空 —— 台账从「本批落了哪些包」退化成「本次进程新加了哪些包」。
 *   故台账按 id 取并集：先前登记的保留，本次新加的追加。 */
const priorRows = Array.isArray(priorLedger.packs) ? priorLedger.packs : [];
const priorRevised = Array.isArray(priorLedger.revisions) ? priorLedger.revisions : [];
const rowById = new Map(priorRows.map((r) => [r.id, r]));
for (const a of added) {
  rowById.set(a.id, {
    id: a.id, name: a.name, quality: a.quality, chars: a.chars, sub: a.sub, type: a.type, desc: a.desc,
    contentMd5: md5(a.content), source: '1120',
  });
}
const revById = new Map(priorRevised.map((r) => [r.id, r]));
const frozenIds = new Set(frozen.packs.map((p) => p.id));
for (const r of revised) {
  revById.set(r.id, {
    id: r.id, name: r.name,
    oldChars: r.oldChars, newChars: r.chars,
    oldMd5: r.oldMd5, newMd5: md5(r.content),
    oldQuality: r.oldQuality, newQuality: r.quality,
    frozenSegment: frozenIds.has(r.id),
    applied: toApply.includes(r),
  });
}
const ledgerPacks = [...rowById.values()];

/* ---------- 改写授权台账（链条的延长线） ----------
 * 与 1120 批次台账分工不同：
 *   · cheat-packs-1120.json 记「本批新增了哪些包」；
 *   · 本文件记「哪些旧包被授权改了、从哪一版改到哪一版」。
 * 冻结台账（before-v3160）继续是历史快照，永不改写。 */
const authById = new Map((priorAuth.rewrites || []).map((r) => [r.id, r]));
for (const r of toApply) {
  if (authById.has(r.id)) continue;   // 幂等：已建档的改写不再重复登记（链条只延长不重写）
  authById.set(r.id, {
    id: r.id, name: r.name,
    fromMd5: r.oldMd5, toMd5: md5(r.content),
    fromChars: r.oldChars, toChars: r.chars,
    fromQuality: r.oldQuality, toQuality: r.quality,
    frozenSegment: frozenIds.has(r.id),
  });
}
const authRows = [...authById.values()];
const authDoc = {
  note: '旧包正文改写授权台账：逐条记 fromMd5→toMd5。冻结台账 cheat-packs-before-v3160.json 是历史快照、永不改写；'
    + '本文件是它的审计延长线 —— 判据用「历史快照 + 本台账」逐层叠加算出期望 md5，越权改包（无授权记录）必红。',
  authorized_at: (priorAuth.authorized_at || new Date().toISOString().slice(0, 10)),
  authorized_by: (priorAuth.authorized_by || '用户明确授权（"改写的也落库"）'),
  source: {
    file: path.basename(SRC_FILE),
    md5: fs.existsSync(SRC_FILE) ? crypto.createHash('md5').update(fs.readFileSync(SRC_FILE)).digest('hex') : null,
    entries: srcEntries.length,
    mergedPacks: srcPacks.length,
  },
  count: authRows.length,
  frozenSegmentCount: authRows.filter((r) => r.frozenSegment).length,
  rewrites: authRows,
};

const ledger = {
  note: '万界武库 V4.1（1120）批次台账：packs = 本批真正落库的新增包；revisions = 作者改写过的旧包，'
    + 'applied 表示该改写是否已落库（落库者同时登记进 cheat-rewrite-authorizations.json）',
  merged_at: (priorLedger.merged_at || new Date().toISOString().slice(0, 10)),
  beforeCount: priorLedger.beforeCount ?? before.length,
  addedCount: ledgerPacks.length,
  totalCount: packs.length,
  source: { file: path.basename(SRC_FILE), entries: srcEntries.length, mergedPacks: srcPacks.length, chars: srcPacks.reduce((n, p) => n + p.chars, 0) },
  revisedHeldCount: [...revById.values()].filter((r) => !r.applied).length,
  revisedAppliedCount: [...revById.values()].filter((r) => r.applied).length,
  packs: ledgerPacks,
  revisions: [...revById.values()],
};

if (DRY) {
  console.log('[dry-run] 不写盘。台账预览：');
  console.log(JSON.stringify({
    beforeCount: ledger.beforeCount, addedCount: ledger.addedCount, totalCount: ledger.totalCount,
    revisedAppliedCount: ledger.revisedAppliedCount, revisedHeldCount: ledger.revisedHeldCount,
    authCount: authDoc.count, authFrozenSegment: authDoc.frozenSegmentCount,
  }, null, 1));
  process.exit(0);
}

/* ---------- 5) 写分片（PART_SIZE=6，与 split-cheats-v24 同规） ---------- */
const pad = (n) => String(n).padStart(2, '0');
const parts = [];
for (let i = 0; i < packs.length; i += PACKS_PER_PART) parts.push(packs.slice(i, i + PACKS_PER_PART));
for (const f of fs.readdirSync(SHARD_DIR)) if (/^part-\d+\.js$/.test(f)) fs.unlinkSync(path.join(SHARD_DIR, f));
parts.forEach((chunk, idx) => {
  const text = '/** R24-O9 数据分片（由 scripts/split-cheats-v24.mjs 生成，勿手改）。'
    + ' id 顺序即原文件顺序，禁止重排。 */\n'
    + 'export const packs = [\n' + chunk.map((p) => JSON.stringify(p)).join(',\n') + '\n];\n';
  fs.writeFileSync(path.join(SHARD_DIR, 'part-' + pad(idx + 1) + '.js'), text);
});

const imports = parts.map((_, idx) => 'import { packs as p' + pad(idx + 1) + " } from './cheats/part-" + pad(idx + 1) + ".js';");
const aggregator = `/* ========================================================
 * 万界武库 (Cheat Vault) — 数据聚合（R24-O9 数据/代码分离后只剩代码，v4.158.0）
 *
 * 【本文件现在只做三件事】列分片 import、按原顺序拼接、导出同一个 \`cheatPacks\`。
 *   正文本身在 data/cheats/part-NN.js（每包一行 JSON），本文件物理行数 <1000。
 *   【纪律】消费方一行代码都不用改：\`cheatPacks\` 的名字、类型、顺序与分离前逐项一致。
 *
 * 【id 稳定性铁律】分片顺序 = 原文件顺序，id 永不重排/删除；下线包只标记不下架。
 * 【同源】轻量索引仍是 data/cheat-index.js（抽卡侧只读元数据），两文件由测试锁定一致。
 * 【生成】分片由 scripts/split-cheats-v24.mjs（1120 批次由 scripts/merge-cheats-1120.mjs）写出，幂等。
 * ======================================================== */
'use strict';
${imports.join('\n')}

export const cheatPacks = [].concat(${parts.map((_, idx) => 'p' + pad(idx + 1)).join(', ')});

export const CHEAT_PART_COUNT = ${parts.length};
export const CHEAT_PACK_COUNT = cheatPacks.length;

export default { cheatPacks, CHEAT_PART_COUNT, CHEAT_PACK_COUNT };
`;
fs.writeFileSync(AGG, aggregator);

/* ---------- 6) 写轻量索引（保留品阶元数据尾巴） ---------- */
const idxSrc = fs.readFileSync(IDX, 'utf8');
const tailAt = idxSrc.indexOf('/** 品阶元数据');
if (tailAt < 0) { console.error('中止：找不到 cheat-index.js 的品阶元数据尾巴'); process.exit(1); }
const idxHeader = idxSrc.slice(0, idxSrc.indexOf('export const cheatIndex = ['));
const cells = packs.map((p) => ({
  id: p.id, name: p.name, quality: p.quality, chars: p.chars, sub: p.sub, type: p.type, desc: p.desc,
}));
const idxBody = cells.map((c) => '  {\n' + [
  '"id": ' + JSON.stringify(c.id), '"name": ' + JSON.stringify(c.name), '"quality": ' + JSON.stringify(c.quality),
  '"chars": ' + c.chars, '"sub": ' + c.sub, '"type": ' + JSON.stringify(c.type), '"desc": ' + JSON.stringify(c.desc),
].map((line) => '    ' + line + ',').join('\n') + '\n  }').join(',\n');
fs.writeFileSync(IDX, idxHeader + 'export const cheatIndex = [\n' + idxBody + '\n];\n\n' + idxSrc.slice(tailAt));
fs.writeFileSync(LEDGER, JSON.stringify(ledger, null, 1) + '\n');
fs.writeFileSync(AUTH, JSON.stringify(authDoc, null, 1) + '\n');

/* ---------- 7) 回读自证 ---------- */
/* 【为什么在子进程里回读】本进程第 2 步已经 import 过 data/cheats.js，它内部
 *   `import './cheats/part-NN.js'` 的 URL 不带查询串，重写盘面后再 import 聚合器
 *   （即便加了 ?t=）只会重新求值聚合器自身，子模块仍走缓存 ⇒ 读到的是**旧分片**。
 *   实测：第一次落库时回读报 229/230，盘上其实是 230 —— 一个纯属自证机制的假红。
 *   子进程重开一次求值，才是真读数。 */
const probe = (code) => {
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', code], { cwd: ROOT, encoding: 'utf8', maxBuffer: 1024 * 1024 * 64 });
  if (r.status !== 0) return { ok: false, err: String(r.stderr || r.stdout || '').slice(0, 400) };
  try { return { ok: true, value: JSON.parse(String(r.stdout).trim().split('\n').pop()) }; }
  catch (e) { return { ok: false, err: '探针输出不可解析：' + String(r.stdout).slice(0, 200) }; }
};
const aggRel = './data/cheats.js';
const idxRel = './data/cheat-index.js';
/* 落库后的期望表：用「本次写入后的授权台账」重算，而不是落库前那份。 */
const expectedFinal = buildExpectedMd5(authDoc.rewrites || []).exp;
if (expectedFinal.size !== preCheck.exp.size) {
  console.error('中止：落库后期望表条目数变了（' + preCheck.exp.size + ' → ' + expectedFinal.size + '），授权台账可能覆盖了不该改的包');
  process.exit(1);
}
const aggProbe = probe(`
  const { createHash } = await import('node:crypto');
  const m = await import('${aggRel}');
  const i = await import('${idxRel}');
  const s = JSON.stringify(m.cheatPacks);
  console.log(JSON.stringify({
    n: m.cheatPacks.length,
    parts: m.CHEAT_PART_COUNT,
    ids: m.cheatPacks.map((p) => p.id),
    chars: m.cheatPacks.map((p) => p.chars),
    hash: createHash('md5').update(s, 'utf8').digest('hex'),
    idxN: i.cheatIndex.length,
    idxIds: i.cheatIndex.map((p) => p.id),
    idxChars: i.cheatIndex.map((p) => p.chars),
    expectedHolds: ${JSON.stringify([...expectedFinal])}.map(([id, want]) => {
      const p = m.cheatPacks.find((x) => x.id === id);
      return p && createHash('md5').update(String(p.content), 'utf8').digest('hex') === want;
    }),
    authHolds: ${JSON.stringify((authDoc.rewrites || []).map((r) => [r.id, r.toMd5]))}.map(([id, want]) => {
      const p = m.cheatPacks.find((x) => x.id === id);
      return p && createHash('md5').update(String(p.content), 'utf8').digest('hex') === want;
    }),
  }));
`);
const aggLines = fs.readFileSync(AGG, 'utf8').split('\n').length;
const shardCount = fs.readdirSync(SHARD_DIR).filter((f) => /^part-\d+\.js$/.test(f)).length;
const problems = [];
if (!aggProbe.ok) problems.push('回读探针失败：' + aggProbe.err);
const rb = aggProbe.value || {};
const wantHash = md5(JSON.stringify(packs));
if (rb.n !== packs.length) problems.push('回读条数 ' + rb.n + ' != ' + packs.length);
if (rb.hash !== wantHash) problems.push('回读漂移（正文/元数据哈希不符）');
if (rb.parts !== parts.length) problems.push('CHEAT_PART_COUNT ' + rb.parts + ' != ' + parts.length);
if (shardCount !== parts.length) problems.push('磁盘分片数 ' + shardCount + ' != ' + parts.length);
if (rb.idxN !== packs.length) problems.push('索引条数 ' + rb.idxN + ' != ' + packs.length);
if ((rb.idxIds || []).join(',') !== packs.map((p) => p.id).join(',')) problems.push('索引 id 错位');
if ((rb.idxChars || []).join(',') !== packs.map((p) => p.chars).join(',')) problems.push('索引字数与正文不符');
if (!(rb.expectedHolds || []).every(Boolean)) problems.push('正文与「历史快照+授权链」不符（' + (rb.expectedHolds || []).filter((x) => !x).length + ' 处）');
if (!(rb.authHolds || []).every(Boolean)) problems.push('授权台账登记的新正文没真正落库（' + (rb.authHolds || []).filter((x) => !x).length + ' 处）');
if (aggLines >= 1000) problems.push('聚合器 ' + aggLines + ' 行（应 <1000）');
if (problems.length) { console.error('回读自证失败：\n - ' + problems.join('\n - ')); process.exit(1); }

console.log('OK: 包 ' + rb.n + '｜分片 ' + shardCount + '｜聚合器 ' + aggLines + ' 行｜索引 ' + rb.idxN);
console.log('新增 ' + added.map((a) => a.id + ' ' + a.name).join(' / '));
console.log('台账 ' + path.relative(ROOT, LEDGER) + '：added ' + ledger.addedCount
  + '，revisions 已落 ' + ledger.revisedAppliedCount + ' / 暂缓 ' + ledger.revisedHeldCount);
console.log('授权台账 ' + path.relative(ROOT, AUTH) + '：共 ' + authDoc.count
  + ' 条（其中落在 v3.16.0 冻结段 ' + authDoc.frozenSegmentCount + ' 条）');
