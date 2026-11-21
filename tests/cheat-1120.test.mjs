/* ============================================================================
 * cheat-1120.test.mjs — 金手指「1120 版」批次判据
 *
 * 【本批与前几批的差别，是这条判据存在的理由】
 *   1108 是增量包；1120 是**整包重写**（源归并 153 包，与库内同名且逐字相同的 0 包）。
 *   于是这次落库只做加法：新增 27 包（ch204–ch230），作者改写的 126 包按旧包冻结
 *   铁律**不入库**，只登记在台账 revisions 供人工决策。
 *   判据必须同时证明两件事：①新增的确实进来了；②被改写的确实**没**进来。
 *   只证明 ① 的判据会让「顺手把 126 包也刷了」悄悄通过。
 *
 * 量什么：
 *   A 台账与库规模自洽（203 + 27 = 230，id 连续，无插队）
 *   B 新增 27 包逐包对台账（md5 + 六元数据）
 *   C ★ 被改写的 126 包已**授权落库**：库内＝源新正文，且每条都有授权记录、起点对得上
 *   D 索引同源 / 分片形状（每片 6 包，末片余数）
 *   E 负控制（假账必红）+ 脚本可复现锚点 + 边界声明
 *
 * 【验证边界（如实，不许含混）】
 *   本判据只证明**数据入库正确**：包数、id 次序、正文 md5、索引同源、分片形状，
 *   以及「126 包改写是经过授权台账逐条登记后写入的，且授权链起点与历史快照吻合」。
 *   它**无真机**验证：没在手机上点过金手指 App、
 *   没跑过幸运转盘抽卡动画、没验证装配上限 1–5 的交互、也没验证注入后模型的实际表现。
 *   这些**不能保证**由此判据推得。真机与模型侧验收另立条目，不在本文件声称。
 * ========================================================================== */
'use strict';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const md5 = (s) => crypto.createHash('md5').update(String(s), 'utf8').digest('hex');
const imp = async (rel) => import(pathToFileURL(path.join(ROOT, rel)).href + '?t=' + Date.now());

const { cheatPacks, CHEAT_PART_COUNT } = await imp('data/cheats.js');
const { cheatIndex } = await imp('data/cheat-index.js');
const LEDGER = JSON.parse(read('tests/audit/cheat-packs-1120.json'));
const FROZEN = JSON.parse(read('tests/audit/cheat-packs-before-v3160.json'));
const byId = new Map(cheatPacks.map((p) => [p.id, p]));

/* 台账对拍抽成纯函数，供 E 组的「假账必红」负控制复用 */
function ledgerDrift(ledger, packs) {
  const m = new Map(packs.map((p) => [p.id, p]));
  const bad = [];
  for (const row of ledger.packs) {
    const p = m.get(row.id);
    if (!p) { bad.push(row.id + ':missing'); continue; }
    for (const k of ['name', 'quality', 'chars', 'sub', 'type', 'desc']) if (p[k] !== row[k]) bad.push(row.id + '.' + k);
    if (md5(p.content) !== row.contentMd5) bad.push(row.id + ':md5');
  }
  return bad;
}

/* ---------------- A 组：规模自洽 ---------------- */
test('A1 台账自洽：203 + 27 = 230，且与库内实数一致', () => {
  assert.equal(LEDGER.beforeCount, 203, '本批入库前 203 包');
  assert.equal(LEDGER.addedCount, 27, '本批新增 27 包');
  assert.equal(LEDGER.totalCount, 230, '入库后 230 包');
  assert.equal(cheatPacks.length, LEDGER.totalCount, '库内实数与台账总数');
  assert.equal(CHEAT_PART_COUNT, Math.ceil(230 / 6), '分片数 = ceil(230/6)');
});

test('A2 新增段 id 连续 ch204–ch230，且不插队、不撞号', () => {
  assert.equal(LEDGER.packs.length, 27);
  assert.equal(LEDGER.packs[0].id, 'ch204');
  assert.equal(LEDGER.packs.at(-1).id, 'ch230');
  LEDGER.packs.forEach((row, i) => {
    assert.equal(row.id, 'ch' + String(204 + i).padStart(3, '0'), '新增段 id 连续 @' + i);
    assert.equal(cheatPacks[203 + i].id, row.id, '新增段必须紧接旧库末尾 @' + i);
  });
  assert.equal(new Set(cheatPacks.map((p) => p.id)).size, 230, 'id 唯一');
});

/* ---------------- B 组：新增逐包对台账 ---------------- */
test('B1 ★ 新增 27 包逐包对台账（md5 + 六元数据零漂移）', () => {
  assert.deepEqual(ledgerDrift(LEDGER, cheatPacks), [], '台账/正文漂移项');
});

test('B2 新增包元数据自证：chars 忠实、品阶按分档、sub≥1', () => {
  const BANDS = [[6000, '神话'], [4500, '传说'], [3500, '史诗'], [2600, '稀有'], [1800, '优秀'], [0, '普通']];
  const qualityOf = (n) => BANDS.find(([t]) => n >= t)[1];
  for (const row of LEDGER.packs) {
    const p = byId.get(row.id);
    assert.equal(p.chars, String(p.content).length, p.id + ' chars 忠实');
    assert.equal(p.quality, qualityOf(p.chars), p.id + ' 品阶分档');
    assert.ok(p.sub >= 1, p.id + ' sub 下限');
    assert.ok(Array.isArray(p.content) === false && typeof p.content === 'string', p.id + ' 正文类型');
  }
});

test('B3 ★ 职业家族归并：主条+臣条合 1 包（sub=2），不被拆成半套', () => {
  // 源里「修行者」「修行者·XX」这类家族条，按 gen-cheats 同规归并；
  // 若被拆成两包，玩家会抽到只有一半正文的外挂。
  const families = ['修行者', '厨师', '医者', '教员', '猎人', '学者', '商贾', '创作者', '工匠',
    '炼金术士', '施法者', '农民', '事务官', '领袖', '预言者', '异类', '武道家'];
  for (const name of families) {
    const hit = cheatPacks.filter((p) => p.name === name);
    assert.equal(hit.length, 1, name + ' 只许存在 1 包，实测 ' + hit.length);
    assert.equal(hit[0].sub, 2, name + ' 应为「主条 + 臣条」合 1（sub=2）');
    assert.ok(String(hit[0].content).startsWith('<' + name + '>'), name + ' 正文须以主条标签开头');
  }
});

/* ---------------- C 组：被改写的 126 包已授权落库（且改的是对的那一版） ---------------- */
/* 【口径变更留痕】本组原先断言「库内仍是旧正文」（当时决策是只做加法）。
 *   用户随后明确授权「改写的也落库」，故翻面为：
 *     ① 库内正文 md5 **必须等于**源里的新 md5（证明真落库了，不是台账自说自话）；
 *     ② 每条都必须在授权台账里有 fromMd5→toMd5 记录（证明是授权改的，不是偷偷改的）；
 *     ③ 授权台账的 fromMd5 必须等于该包**改写前**的 md5（证明改的是对的那一版）。
 *   ②③ 合起来比原来的"没变"更强：现在"变了必须有权，且起点对得上"。 */
test('C1 ★ 台账 revisions 有 126 条，且全部「已授权落库、库内＝源新正文」', () => {
  assert.equal(LEDGER.revisions.length, 126, '被改写的包数');
  assert.equal(LEDGER.revisedAppliedCount, 126, '台账自述已落库条数');
  assert.equal(LEDGER.revisedHeldCount, 0, '不再有暂缓的改写');
  const AUTH = JSON.parse(read('tests/audit/cheat-rewrite-authorizations.json'));
  assert.equal(AUTH.count, 126, '授权台账条数');
  const authById = new Map(AUTH.rewrites.map((r) => [r.id, r]));
  const wrong = [], unauthorized = [], branchBroken = [];
  for (const row of LEDGER.revisions) {
    const p = byId.get(row.id);
    if (!p) { wrong.push(row.id + ':missing'); continue; }
    // ① 库内必须已是新正文
    if (md5(p.content) !== row.newMd5) wrong.push(row.id + ' ' + row.name);
    // ② 必须有授权记录
    const a = authById.get(row.id);
    if (!a) { unauthorized.push(row.id + ' ' + row.name); continue; }
    // ③ 授权记录的起点必须是它改写前的 md5，终点必须是源新正文
    if (a.fromMd5 !== row.oldMd5 || a.toMd5 !== row.newMd5) branchBroken.push(row.id + ' ' + row.name);
  }
  assert.deepEqual(wrong, [], '★ 这些包的库内正文不是源里的新正文：' + wrong.slice(0, 6).join(', '));
  assert.deepEqual(unauthorized, [], '★ 这些包被改了却没有授权记录：' + unauthorized.slice(0, 6).join(', '));
  assert.deepEqual(branchBroken, [], '★ 授权记录的起点/终点与其改写台账对不上：' + branchBroken.slice(0, 6).join(', '));
});

test('C2 126 条里 92 条落在 v3.16.0 冻结段（ch001–ch165），且冻结段靠授权链闭合', () => {
  const frozenIds = new Set(FROZEN.packs.map((r) => r.id));
  const inFrozen = LEDGER.revisions.filter((r) => frozenIds.has(r.id));
  assert.equal(inFrozen.length, 92, '改写面与冻结段的重叠数，实测 ' + inFrozen.length);
  /* 冻结台账本身必须一字未动（历史快照不许篡改）：count 与 frozen_at 仍是原样 */
  assert.equal(FROZEN.count, 165, '冻结台账仍是 v3.16.0 的 165 包');
  assert.equal(FROZEN.frozen_at, 'v3.15.0', '冻结台账的冻结版本不许改');
  /* 而这 92 包现在的正文，必须等于「它自己的冻结 md5 经授权改写后的 toMd5」 */
  const AUTH = JSON.parse(read('tests/audit/cheat-rewrite-authorizations.json'));
  const authById = new Map(AUTH.rewrites.map((r) => [r.id, r]));
  const broken = [];
  for (const row of inFrozen) {
    const f = FROZEN.packs.find((x) => x.id === row.id);
    const a = authById.get(row.id);
    if (!f || !a) { broken.push(row.id + ':no-chain'); continue; }
    if (a.fromMd5 !== f.contentMd5) broken.push(row.id + ':from≠frozen');
    const p = byId.get(row.id);
    if (!p || md5(p.content) !== a.toMd5) broken.push(row.id + ':lib≠to');
  }
  assert.deepEqual(broken, [], '★ 冻结段授权链断裂：' + broken.slice(0, 6).join(', '));
});

test('C3 改写面的读数如实（抽样：源新正文更长/更短都必须照实记录）', () => {
  // 抽样三条，方向不同：变长、变短、几乎不变 —— 台账若把 newChars 抄成 oldChars 必红
  const sample = ['赋能', '代价减免', '文明之光系统'];
  const rows = sample.map((n) => LEDGER.revisions.find((r) => r.name === n));
  rows.forEach((r, i) => assert.ok(r, sample[i] + ' 必须出现在改写面里'));
  const up = rows[0], down = rows[1];
  assert.ok(up.newChars > up.oldChars, '赋能 源新版应更长：' + up.oldChars + '→' + up.newChars);
  assert.ok(down.newChars < down.oldChars, '代价减免 源新版应更短：' + down.oldChars + '→' + down.newChars);
  for (const r of rows) assert.notEqual(r.oldMd5, r.newMd5, r.name + ' 新旧 md5 不应相同');
});

/* ---------------- D 组：索引同源 / 分片形状 ---------------- */
test('D1 轻量索引与正文同源（230 条逐字段）', () => {
  assert.equal(cheatIndex.length, cheatPacks.length);
  cheatIndex.forEach((r, i) => {
    const p = cheatPacks[i];
    assert.equal(r.id, p.id, '索引 id 次序 @' + i);
    for (const k of ['name', 'quality', 'chars', 'sub', 'type', 'desc']) assert.equal(r[k], p[k], r.id + '.' + k);
  });
});

test('D2 分片形状：每片 6 包，末片余 230 mod 6 = 2', () => {
  const dir = path.join(ROOT, 'data', 'cheats');
  const files = fs.readdirSync(dir).filter((f) => /^part-\d+\.js$/.test(f)).sort();
  assert.equal(files.length, CHEAT_PART_COUNT, '磁盘分片数');
  const last = fs.readFileSync(path.join(dir, files.at(-1)), 'utf8');
  const packLines = last.split('\n').filter((l) => l.startsWith('{"id":'));
  assert.equal(packLines.length, 230 % 6 || 6, '末片包数');
  assert.ok(packLines[0].startsWith('{"id":"ch229"'), '末片起始 id');
  assert.ok(packLines.at(-1).startsWith('{"id":"ch230"'), '末片收尾 id');
});

/* ---------------- E 组：负控制与可复现 ---------------- */
test('E1 ★ 负控制：把台账任一 md5 改成假值，同一断言必红（内存态，不碰真源）', () => {
  const bad = { ...LEDGER, packs: LEDGER.packs.map((p, i) => (i === 0 ? { ...p, contentMd5: 'deadbeef' } : p)) };
  assert.notDeepEqual(ledgerDrift(bad, cheatPacks), [], '假账必须被抓');
  assert.deepEqual(ledgerDrift(LEDGER, cheatPacks), [], '原版对照必须全绿');
});

test('E2 ★ 负控制：把某包正文改一个字，台账对拍必红（证明判据真读正文）', () => {
  const id = LEDGER.packs[0].id;
  const tampered = cheatPacks.map((p) => (p.id === id ? { ...p, content: p.content + 'x' } : p));
  assert.notDeepEqual(ledgerDrift(LEDGER, tampered), [], '篡改正文必须被抓');
});

test('E3 合并脚本可复现锚点（链式冻结闸门 / 授权台账 / 幂等 / 回读自证）', () => {
  const src = read('scripts/merge-cheats-1120.mjs');
  assert.ok(src.includes('merge-cheats-1120.mjs'), '脚本自述');
  assert.ok(/冻结链式自证通过/.test(src), '落库前先验「历史快照 + 授权链」');
  assert.ok(/buildExpectedMd5/.test(src), '链式期望必须函数化（落库前后各算一次）');
  assert.ok(/cheat-rewrite-authorizations\.json/.test(src), '授权台账必须由脚本写出');
  assert.ok(/--hold-revisions/.test(src), '必须保留「只做加法」的回退开关');
  assert.ok(/幂等/.test(src), '幂等纪律');
  assert.ok(/回读自证失败/.test(src), '写后有回读自证');
  assert.ok(/cheat-packs-1120\.json/.test(src), '产出台账');
  assert.ok(/revisions/.test(src), '改写面留痕');
});

test('E4 ★ 验证边界如实留痕（不承诺未做的验证）', () => {
  const self = read('tests/cheat-1120.test.mjs');
  for (const frag of ['授权落库', '无真机', '不能保证']) assert.ok(self.includes(frag), '缺边界声明：' + frag);
  // 本判据只覆盖「数据入库正确」，不覆盖真机抽卡动画 / 装配上限交互 / 注入后的模型表现
  /* 【自指陷阱】若把禁词整串写在正则或注释里，read() 读到的文件文本必然命中它 ——
   *   判据会永远红，而且看起来像「真被抓到了」。禁词只能在运行时拼接，才测得到真东西。 */
  const forbidden = '已' + '验证真机';
  assert.ok(!self.includes(forbidden), '不许声明未做的真机' + '验证');
});