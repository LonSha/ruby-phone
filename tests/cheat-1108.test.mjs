/* ============================================================================
 * cheat-1108.test.mjs — 金手指「1108 扩库」专项判据
 *
 * 【为什么不叫 system-vNNNN】判据号是指纹：R21-O9 正在用 system-v4148.test.mjs
 *   抬 4.148.0，未来 system-v4151 等也会是真实版本。本轮是**数据批次增强**，
 *   不抬主版本、不占版本指纹，故用描述性文件名，避免连续同号两用。
 *
 * 量什么（A～E 五组）：
 *   A 静态数据面：总库＝台账 totalCount / 旧 166 逐字冻结 / 新增 37 包 md5 对台账 / 索引同源。
 *   B 来源与归并：四批来源计数、6 条冻结子条如实排除、家族归并、原文锚点。
 *   C 元数据忠实：chars / quality / desc / 模板字符串往返无损。
 *   D 真接线 + 负控制：抽卡池随库规模、搜索命中、注入块真带新正文；
 *     未知 id 如实丢弃、假账 md5 必被抓（不碰真源的内存态 breakOnce）。
 *   E 可复现与边界：合并脚本/台账在场；显式写明本环境无真机、不能保证的边界。
 *
 * 判据**不读外部附件路径**（cleanOnExit 会被清）：真源对照靠仓内
 *   tests/audit/cheat-packs-1108.json 的 contentMd5 + 判据内硬编码的不可变原文锚点。
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

const { cheatPacks } = await imp('data/cheats.js');
const { cheatIndex } = await imp('data/cheat-index.js');
const CD = await imp('apps/cheat/cheat-data.js');
const LEDGER = JSON.parse(read('tests/audit/cheat-packs-1108.json'));
/* [1120 批次] 库规模的真源从「写死 203」改为「1120 台账的 totalCount」：
 *   A1/D1/D3 原本把 203 当读数指纹，但那等于宣布「以后任何批次都不许入库」。
 *   现在改成：规模必须等于台账登记的总数（多一包或漏一包都红），
 *   而台账本身又由 md5/元数据逐包对拍锁住 ⇒ 比写死数字更强，且能容纳新批次。 */
const LEDGER_1120 = JSON.parse(read('tests/audit/cheat-packs-1120.json'));
const LIB_SIZE = LEDGER_1120.totalCount;
const FROZEN = JSON.parse(read('tests/audit/cheat-packs-before-v3160.json'));
const MERGE = read('scripts/merge-cheats-1108.mjs');

const BANDS = [[6000, '神话'], [4500, '传说'], [3500, '史诗'], [2600, '稀有'], [1800, '优秀'], [0, '普通']];
const qualityOf = (chars) => BANDS.find(([t]) => chars >= t)[1];
const byId = new Map(cheatPacks.map((p) => [p.id, p]));

/* ---------- 改写授权链（1120 批次引入） ----------
 * 事实：1108 批 37 包里 33 包在本轮被作者改写并**经用户授权落库**，只有
 *   ch167 / ch168 / ch177 / ch203 四包未动；ch166（v3.16.0 追加）也被改写。
 * 于是「逐字冻结」这个口径不再成立 —— 但它不能简单地降级成"不查了"。
 * 换成链式：每个旧包都必须落进两种合法状态之一，且状态本身可验：
 *   · held      ：无授权记录 ⇒ 正文 md5 与六元数据必须**逐字等于**台账；
 *   · rewritten ：有授权记录 ⇒ 授权起点必须等于台账 md5（改的是对的那一版），
 *                 授权终点必须等于库内当前 md5（真落了），字数也必须对得上。
 * 任何"变了又没有授权记录"的包依然红。 */
const AUTH = JSON.parse(read('tests/audit/cheat-rewrite-authorizations.json'));
const authById = new Map(AUTH.rewrites.map((r) => [r.id, r]));

function chainStatus(row, p, tag) {
  const a = authById.get(row.id);
  if (!a) {
    for (const k of ['name', 'quality', 'chars', 'sub', 'type', 'desc']) {
      assert.equal(p[k], row[k], tag + '.' + k + ' 漂移（且无授权改写记录）');
    }
    assert.equal(md5(p.content), row.contentMd5, tag + ' 正文 md5 与台账不符（且无授权改写记录）');
    return 'held';
  }
  assert.equal(a.fromMd5, row.contentMd5, tag + ' 授权起点 ≠ 台账 md5（改的不是这一版）');
  assert.equal(a.fromChars, row.chars, tag + ' 授权记的起始字数 ≠ 台账字数');
  assert.equal(md5(p.content), a.toMd5, tag + ' 正文 ≠ 授权终点（授权了却没落库 / 落了别的版本）');
  assert.equal(p.chars, a.toChars, tag + ' chars 与授权终点字数不符');
  return 'rewritten';
}

/* 台账对照抽成纯函数，供 D 组做「假账必转红」的内存态负控制 */
function assertLedgerMatches(ledger, packs) {
  const m = new Map(packs.map((p) => [p.id, p]));
  const stat = { held: 0, rewritten: 0 };
  for (const row of ledger.packs) {
    const p = m.get(row.id);
    assert.ok(p, '台账有而正文没有：' + row.id);
    stat[chainStatus(row, p, row.id)]++;
  }
  return stat;
}

/* ---------------- A 组：静态数据面 ---------------- */
test('A1 库规模＝台账总数：前 166 包 id/次序冻结，其后 id 连续到末位', () => {
  assert.equal(cheatPacks.length, LIB_SIZE, '库规模实测 ' + cheatPacks.length + '，台账 ' + LIB_SIZE);
  for (let i = 0; i < 166; i++) {
    assert.equal(cheatPacks[i].id, 'ch' + String(i + 1).padStart(3, '0'), '旧包 id 次序 @' + i);
  }
  for (let i = 166; i < cheatPacks.length; i++) {
    assert.equal(cheatPacks[i].id, 'ch' + String(i + 1).padStart(3, '0'), '新增包 id 连续 @' + i);
  }
  assert.equal(new Set(cheatPacks.map((p) => p.id)).size, cheatPacks.length, 'id 唯一');
});

test('A2 ★ 旧 165 包账实相符（未被改写的逐字冻结 / 被改写的必须走授权链）', () => {
  assert.equal(FROZEN.count, 165, '冻结台账记的是 165 包');
  assert.equal(FROZEN.frozen_at, 'v3.15.0', '冻结台账的冻结版本不许改（历史快照不许篡改）');
  const stat = { held: 0, rewritten: 0 };
  for (const row of FROZEN.packs) {
    const p = byId.get(row.id);
    assert.ok(p, '冻结台账里的包必须仍在库内：' + row.id);
    stat[chainStatus(row, p, row.id)]++;
  }
  /* 冻结段里 92 包被授权改写、73 包未动 —— 两个数都要如实，不许为了好看全算成"未动" */
  assert.equal(stat.rewritten, 92, '冻结段被授权改写的包数，实测 ' + stat.rewritten);
  assert.equal(stat.held, 73, '冻结段未动的包数，实测 ' + stat.held);
  // ch166「位移」是 v3.16.0 追加包，本轮也被改写过：名称与家族不变，正文尾标签仍完整
  const c166 = byId.get('ch166');
  assert.equal(c166.name, '位移', 'ch166 名称与 id 绑定不变');
  assert.ok(c166.content.endsWith('</位移>'), 'ch166 正文尾标签完整（改写不许把标签弄坏）');
});

test('A3 新增 37 包账实相符（被改写的走授权链，未动的逐字对台账）', () => {
  assert.equal(LEDGER.beforeCount, 166);
  assert.equal(LEDGER.addedCount, 37);
  assert.equal(LEDGER.totalCount, 203);
  assert.equal(LEDGER.packs.length, 37);
  const stat = assertLedgerMatches(LEDGER, cheatPacks);
  assert.equal(stat.rewritten, 33, '1108 批次被改写的包数，实测 ' + stat.rewritten);
  assert.equal(stat.held, 4, '1108 批次未动的包数，实测 ' + stat.held);
  for (const id of ['ch167', 'ch168', 'ch177', 'ch203']) {
    assert.ok(!authById.has(id), id + ' 是 1108 批次里未被改写的四包之一，不该出现在授权台账里');
  }
});

test('A4 轻量索引与正文同源（逐字段）', () => {
  assert.equal(cheatIndex.length, cheatPacks.length, '索引条数');
  for (const r of cheatIndex) {
    const p = byId.get(r.id);
    assert.ok(p, '索引含正文没有的 id：' + r.id);
    for (const k of ['name', 'quality', 'chars', 'sub', 'type', 'desc']) {
      assert.equal(r[k], p[k], '同源不一致 ' + r.id + '.' + k);
    }
  }
});

/* ---------------- B 组：来源与归并 ---------------- */
test('B1 四批来源计数如实（1013 主条 28 / 1026 归并后 4 / 1108 4 / 漫漫长路 1）', () => {
  const c = {};
  for (const p of LEDGER.packs) c[p.source] = (c[p.source] || 0) + 1;
  // 1026 附件 5 条里「骇客」与「骇客·技术与权能详解」归并为 1 包 → 4 包（B3 实证 sub=2）
  assert.deepEqual(c, { v41: 28, up1026: 4, up1108: 4, mmlc: 1 },
    '来源计数实测 ' + JSON.stringify(c));
  for (const [k, f] of Object.entries(LEDGER.source)) {
    assert.ok(String(f).startsWith('attachment_') && String(f).endsWith('.json'), '来源文件名形态 ' + k);
  }
});

test('B2 ★ 6 条冻结 ·子条如实排除（不为「附件全用上」假并旧包）', () => {
  const names = LEDGER.frozenSubEntries.map((x) => x.name);
  assert.equal(names.length, 6, '冻结子条数实测 ' + names.length);
  const expect = ['熟练度状态栏·初始技能', '熟练度状态栏·技能特效样式', '人生模拟·模拟格式',
    '文明之光系统·文明阶段', '文明之光系统·伟大领袖', '文明之光系统·辉煌灿烂'];
  assert.deepEqual(names, expect, '冻结清单逐字');
  const allNames = new Set(cheatPacks.map((p) => p.name));
  for (const n of expect) assert.ok(!allNames.has(n), '冻结子条不许被拆成独立包：' + n);
  // 主包仍在且未被改写
  for (const base of ['熟练度状态栏', '人生模拟', '文明之光系统']) {
    assert.ok(allNames.has(base), '主包丢失：' + base);
  }
});

test('B3 家族归并：骇客主+详解合 1 包；漫漫长路 21 段合 1 包（不拆半套）', () => {
  const hacker = byId.get('ch198');
  assert.equal(hacker.name, '骇客');
  assert.equal(hacker.sub, 2, '骇客须含主条 + 技术与权能详解');
  assert.ok(hacker.content.includes('<骇客>'), '缺主条标签');
  assert.ok(hacker.content.includes('技术与权能详解') || hacker.content.includes('<技术'), '缺详解段');
  const mmlc = byId.get('ch203');
  assert.equal(mmlc.name, '漫漫长路');
  assert.equal(mmlc.sub, 21, '漫漫长路 21 段须合为 1 包');
  const tags = ['求真道基', '求真之法', '八卦与万象', '内修长路', '炼器剑器与阵法',
    '境界法度与施为尺度', '修真工业与文明工程', '灵宝真意与本源研究'];
  for (const t of tags) assert.ok(mmlc.content.includes('<' + t + '>'), '漫漫长路缺段：' + t);
  assert.equal((mmlc.content.match(/^<[^>]+>/gm) || []).length >= 21, true, '一级段标签数下限');
});

test('B4 原文不可变锚点（只取未被改写的四包；被改写的包由 A3 授权链兜住）', () => {
  /* 【口径变更留痕】原锚点里的 ch195 / ch196 / ch199 / ch202 在 1120 批量改写中
   *   已被作者换了正文。继续拿旧句子硬判，等于要求作者回到旧版本 —— 那不是判据，
   *   那是锁死演进。所以锚点只取**未被改写的四包**（ch167/168/177/203），
   *   被改写包的一致性交给 A3 的授权链（起点=台账 md5、终点=库内 md5）。
   *   B4 的独特价值仍是：有一条与外部附件无关、纯文本级的"这包还是这包"的证明。 */
  const anchors = [
    ['ch167', '万界武库思维链（V2.1）', '只读取本次叙事相较上一次结算真正新增的事实'],
    ['ch168', '太始天（精简版，择一开启）', '是与{{user}}生命本源共生的真实内天地'],
    ['ch177', '太始天（完整版，择一开启））', '是由{{user}}生命本源开辟'],
    ['ch203', '漫漫长路', '是与{{user}}本源永久绑定的求真道基'],
  ];
  for (const [id, name, frag] of anchors) {
    const p = byId.get(id);
    assert.equal(p.name, name, id + ' 名称');
    assert.ok(p.content.includes(frag), id + ' ' + name + ' 缺原文锚点「' + frag + '」');
    assert.ok(!authById.has(id), id + ' 用作不可变锚点，就不许出现在授权改写台账里（否则锚点自相矛盾）');
  }
  /* 反向约束：被改写的包不许再被当作"原文锚点"来源，避免以后有人悄悄把锚点搬过去 */
  for (const id of ['ch195', 'ch196', 'ch199', 'ch202']) {
    assert.ok(authById.has(id), id + ' 已被授权改写，必须留在授权台账里可追溯');
  }
});

/* ---------------- C 组：元数据忠实 ---------------- */
test('C1 每包 chars 忠实、quality 按分档、新增 37 包 desc 非空且不超 61', () => {
  for (const p of cheatPacks) {
    assert.equal(p.chars, String(p.content || '').length, p.id + ' chars 忠实');
    assert.equal(p.quality, qualityOf(p.chars), p.id + ' 品阶分档');
  }
  // 只约束新增包：旧库有 3 条历史空 desc（ch128 / ch158 / ch159），逐字冻结不许为
  // 「全库 desc 非空」的读数好看去改旧包；也不把正确的另一条路（旧档原样保留）判死。
  // 新增包里 ch167 / ch169 是 <WJWK-think> 协议条（作者原文无 <简介>/<本质> 段），
  // 同款 pick() 口径抽不出首句，desc 如实为空 —— 不编造简介、不为全绿改写原文。
  const NO_INTRO = new Set(['ch167', 'ch169']);
  for (const row of LEDGER.packs) {
    const p = byId.get(row.id);
    if (NO_INTRO.has(p.id)) {
      assert.ok(p.content.startsWith('<WJWK-think>'), p.id + ' 协议条须真为思维链原文（空 desc 才成立）');
      assert.equal(p.desc, '', p.id + ' 协议条 desc 如实为空');
    } else {
      assert.ok(p.desc.length > 0 && p.desc.length <= 61, p.id + ' 新增包 desc 形态 ' + p.desc.length);
    }
  }
});

test('C2 模板字符串往返无损（反引号 / ${ / 反斜杠不经手改）', () => {
  for (const id of ['ch198', 'ch203', 'ch199']) {
    const p = byId.get(id);
    assert.ok(p.content.includes('{{user}}'), id + ' 宏占位符应原样保留');
    assert.ok(!p.content.includes('\\${'), id + ' 不应残留 \\${ 逃逸字面量');
    assert.ok(!p.content.includes('\\`'), id + ' 不应残留 \\` 逃逸字面量');
  }
});

/* ---------------- D 组：真接线 + 负控制 ---------------- */
test('D1 抽卡池随库规模全量铺开（不进「全部」混杂池的契约不变）', () => {
  const items = CD.cheatGachaItems();
  assert.equal(items.length, cheatPacks.length, '外挂 item 数实测 ' + items.length + '，库 ' + cheatPacks.length);
  const ids = new Set(items.map((x) => x.id));
  assert.ok(ids.has('cheat_ch203'), '新包 ch203 必须进抽卡池');
  assert.ok(ids.has('cheat_ch166'), '旧包 ch166 不许被挤掉');
  assert.equal(CD.cheatGachaPool().id, 'pool_cheat', '卡池 id 不变');
  assert.equal(CD.cheatGachaPool().includeInAll, false, '不污染日常池');
});

test('D2 ★ 负控制：未知 id 如实丢弃 / 假账 md5 必被抓（内存态 breakOnce，不碰真源）', () => {
  // ① 纯函数负控制：未知 id 不许顶替、不许注入任何外挂正文
  const clean = CD.sanitizeInstalled(['ch999', 'ch203'], { limit: 3 });
  assert.deepEqual(clean.ids, ['ch203'], '未知 id 必须如实丢弃，实测 ' + JSON.stringify(clean.ids));
  const badBlock = CD.buildCheatPromptBlock(['ch999'], {});
  assert.ok(!badBlock.includes('<命中注定>'), '未知 id 不许注入任何外挂正文');
  const goodBlock = CD.buildCheatPromptBlock(['ch199'], {});
  assert.ok(goodBlock.includes('<命中注定>'), '真 id 必须注入对应原文');
  assert.ok(goodBlock.includes('万象必然性最终定义权'), '注入块须带真原文而非空壳');
  // ② 假账负控制：改掉台账一条 md5，同一断言必抛（等价「真删真源读数必变」）
  const bad = { ...LEDGER, packs: LEDGER.packs.map((p, i) => i === 0 ? { ...p, contentMd5: 'deadbeef' } : p) };
  assert.throws(() => assertLedgerMatches(bad, cheatPacks), /md5|漂移|台账/, '假账必须转红');
  assert.doesNotThrow(() => assertLedgerMatches(LEDGER, cheatPacks), '原版对照必须全绿');
});

test('D3 搜索 / 分组 / 按 id 取包 三条视图链路都命中新包', () => {
  assert.ok(CD.searchCheats('命中注定').some((p) => p.id === 'ch199'), '搜索命中 ch199');
  assert.ok(CD.searchCheats('漫漫长路').some((p) => p.id === 'ch203'), '搜索命中 ch203');
  assert.equal(CD.getCheatById('ch203').sub, 21, 'getCheatById 取到完整家族包');
  assert.equal(CD.getCheatById('ch999'), null, '未知 id 返回 null（不猜）');
  const groups = CD.cheatsGroupedByQuality();
  const total = groups.reduce((s, g) => s + g.list.length, 0);
  assert.equal(total, cheatPacks.length, '品阶分组覆盖全库，实测 ' + total);
  assert.ok(groups.some((g) => g.list.some((p) => p.id === 'ch203')), '神话组含漫漫长路');
});

/* ---------------- E 组：可复现与验证边界 ---------------- */
test('E1 合并脚本可复现（幂等 / 冻结 / 同源 三锚点在场）', () => {
  assert.ok(MERGE.includes('scripts/merge-cheats-1108.mjs'), '脚本自述');
  assert.ok(/幂等/.test(MERGE) && /原地覆盖|不新增/.test(MERGE), '幂等纪律');
  assert.ok(/逐字冻结|一字不动|旧包漂移/.test(MERGE), '旧包冻结纪律');
  assert.ok(/writeFileSync\(FULL/.test(MERGE) && /writeFileSync\(IDX/.test(MERGE), '两文件同源写出');
  assert.ok(/contentMd5/.test(MERGE), '产出 md5 台账');
});

test('E2 ★ 运行时验证边界显式留痕（不抢 R21-O9 的六源在途文件）', () => {
  const boundary = read('docs/cheat-1108-verification-boundary.md');
  for (const frag of ['无真机', '不能保证', '静态扫描面', '纯函数接线', '抽卡', '装配', '注入']) {
    assert.ok(boundary.includes(frag), '边界文档缺显式声明：' + frag);
  }
  // 判据自身也把边界写在案（E 组常驻，不许为了全绿把它删掉）
  assert.ok(read('tests/cheat-1108.test.mjs').includes('不能保证'), '判据 E 组须保留边界声明');
});
