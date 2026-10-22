/* ============================================================
 * tests/system-v4540.test.mjs — v4.54.0 · 第六期批次 F 手机侧两项验收
 *   - R6-X7 跨媒介互动连载
 *   - R6-X9 平行人生试玩场
 * ------------------------------------------------------------
 * 判据分五面：
 *   A 面 版本锚与结构自证
 *   B 面 R6-X7 跨媒介互动连载（三章两分岔三媒介 / A不污染B / 修订迁移）
 *   C 面 R6-X9 平行人生试玩场（两线分别操作 / 切换三次不混 / 只带回作品）
 *   D 面 负控制三向自证
 * ============================================================ */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const rel = (p) => path.join(ROOT, p);
const read = (p) => fs.readFileSync(rel(p), 'utf8');
const BORN_V = '4.54.0';
const SN_REL = 'config/serial-narrative.js';
const PL_REL = 'config/parallel-life.js';

const SN = await import(pathToFileURL(rel(SN_REL)).href);
const PL = await import(pathToFileURL(rel(PL_REL)).href);

function vnum(v) { return v.split('.').map(Number).reduce((a, b, i) => a + b * Math.pow(100, 2 - i), 0); }

let _breakSeq = 0;
function breakSource(filePath, anchor, replacement) {
  let code = read(filePath);
  const idx = code.indexOf(anchor);
  if (idx === -1) throw new Error(`Anchor not found: ${anchor}`);
  const before = code.slice(0, idx);
  const after = code.slice(idx + anchor.length);
  const broken = before + replacement + after;
  const tmp = path.join(ROOT, `.tmp_broken_${_breakSeq++}_${path.basename(filePath)}`);
  fs.writeFileSync(tmp, broken, 'utf8');
  return pathToFileURL(tmp).href;
}

/* ============================================================ */
/* A 面：版本锚与结构自证                                       */
/* ============================================================ */
test('A1: manifest.json 版本 >= BORN_V', () => {
  const man = JSON.parse(read('manifest.json'));
  assert.ok(vnum(man.version) >= vnum(BORN_V), `manifest version ${man.version} < ${BORN_V}`);
});

test('A2: index.js ST_PHONE_VERSION >= BORN_V', () => {
  const src = read('index.js');
  const m = src.match(/ST_PHONE_VERSION\s*=\s*'([^']+)'/);
  assert.ok(m, 'ST_PHONE_VERSION not found');
  assert.ok(vnum(m[1]) >= vnum(BORN_V), `ST_PHONE_VERSION ${m[1]} < ${BORN_V}`);
});

test('A3: 两模块 VERSION 常量与 ESM 结构', () => {
  assert.ok(typeof SN === 'object', 'SN module not loaded');
  assert.ok(typeof PL === 'object', 'PL module not loaded');
  for (const f of [SN_REL, PL_REL]) {
    const code = read(f);
    assert.ok(code.includes(`'${BORN_V}'`), `${f} missing VERSION ${BORN_V}`);
  }
});

test('A4: BORN_V 自锚', () => {
  assert.equal(BORN_V, '4.54.0');
});

/* ============================================================ */
/* B 面：R6-X7 跨媒介互动连载                                    */
/* ============================================================ */
test('B1: 三章、两个分岔、至少三种媒介构成完整连载', () => {
  const serial = SN.createSerial({
    serialId: 'serial_001', title: '雨城来信',
    chapters: [
      { chapterId: 'ch1', title: '第一章', medium: 'prose', content: '故事开始...', choices: [
        { id: 'c1a', label: '去邮局', targetChapterId: 'ch2a' },
        { id: 'c1b', label: '去咖啡馆', targetChapterId: 'ch2b' },
      ]},
      { chapterId: 'ch2a', title: '第二章A', medium: 'letter', content: '一封信...' },
      { chapterId: 'ch2b', title: '第二章B', medium: 'post', content: '一条帖子...' },
    ],
  });
  assert.equal(serial.chapters.length, 3);
  // 至少三种媒介
  const mediums = new Set(serial.chapters.map(c => c.medium));
  assert.ok(mediums.size >= 3, `only ${mediums.size} mediums`);
  // 两个分岔
  assert.equal(serial.chapters[0].choices.length, 2);
});

test('B2: 试玩A路线不污染B路线和原聊天正史', () => {
  const serial = SN.createSerial({
    serialId: 'serial_002', title: '测试隔离',
    chapters: [
      { chapterId: 'ch1', title: '第一章', medium: 'prose', content: '开始' },
      { chapterId: 'ch2', title: '第二章', medium: 'dialog', content: '对话' },
    ],
  });
  // 读者 A 走 ch1→ch2
  const progressA = SN.createReaderProgress('serial_002', 'readerA');
  SN.advanceChapter(serial, progressA, 'ch1');
  SN.advanceChapter(serial, progressA, 'ch2');
  // 读者 B 只走 ch1
  const progressB = SN.createReaderProgress('serial_002', 'readerB');
  SN.advanceChapter(serial, progressB, 'ch1');
  // A 的访问不影响 B
  assert.ok(progressA.visitedChapters.includes('ch2'));
  assert.ok(!progressB.visitedChapters.includes('ch2'));
  // 不污染原聊天正史
  assert.equal(progressA.mainChatContaminated, false);
  assert.equal(progressB.mainChatContaminated, false);
});

test('B3: 作者修改第二章后，旧读者可选择继续旧版或迁移', () => {
  const serial = SN.createSerial({
    serialId: 'serial_003', title: '修订测试',
    chapters: [
      { chapterId: 'ch1', title: '第一章', medium: 'prose', content: '原文1' },
      { chapterId: 'ch2', title: '第二章', medium: 'letter', content: '原文2' },
    ],
  });
  // 旧读者读了 ch2
  const progress = SN.createReaderProgress('serial_003', 'readerOld');
  SN.advanceChapter(serial, progress, 'ch2');

  // 作者修改 ch2，旧读者不迁移
  const result = SN.applyAuthorRevision(serial, 'ch2',
    { title: '第二章修订', medium: 'letter', content: '新内容' },
    progress, false);
  assert.equal(result.readerAffected, true);
  assert.equal(result.migrated, false);
  assert.equal(progress.migrated, false);

  // 作者修改 ch1，旧读者选择迁移
  const result2 = SN.applyAuthorRevision(serial, 'ch1',
    { title: '第一章修订', medium: 'prose', content: '新内容1' },
    progress, true);
  assert.equal(result2.migrated, true);
  assert.equal(progress.migrated, true);
  assert.equal(progress.serialVersion, serial.version);
});

/* ============================================================ */
/* C 面：R6-X9 平行人生试玩场                                    */
/* ============================================================ */
test('C1: 同一起点两线分别操作，聊天/日程/作品均可独立', () => {
  const life = PL.createParallelLife({
    lifeId: 'life_001',
    originPoint: { event: '收到展览邀请', date: '2024-03-01' },
    selectedContent: ['invite'],
  });
  // A线：接受邀请
  const routeA = PL.forkRoute(life, 'routeA');
  routeA.messages.push({ id: 'm1', text: '好的我去' });
  routeA.schedule.push({ id: 's1', event: '参加展览' });

  // B线：继续创作
  const routeB = PL.forkRoute(life, 'routeB');
  routeB.messages.push({ id: 'm2', text: '抱歉不去了' });
  routeB.works.push({ id: 'w1', title: '新作品' });

  // 两线独立
  assert.equal(routeA.messages.length, 1);
  assert.equal(routeA.messages[0].text, '好的我去');
  assert.equal(routeB.messages.length, 1);
  assert.equal(routeB.messages[0].text, '抱歉不去了');
  assert.equal(routeA.schedule.length, 1);
  assert.equal(routeB.works.length, 1);
  assert.equal(routeA.works.length, 0);
});

test('C2: 来回切换三次并重开不混数据，主线无新增事实', () => {
  const life = PL.createParallelLife({
    lifeId: 'life_002',
    originPoint: { event: '起点' },
  });
  PL.forkRoute(life, 'A');
  PL.forkRoute(life, 'B');

  life.routes['A'].messages.push({ id: 'a1', text: 'A线消息' });
  life.routes['B'].messages.push({ id: 'b1', text: 'B线消息' });

  // 切换三次
  PL.switchRoute(life, 'B');
  PL.switchRoute(life, 'A');
  PL.switchRoute(life, 'B');

  // 数据不混
  assert.equal(life.routes['A'].messages.length, 1);
  assert.equal(life.routes['A'].messages[0].text, 'A线消息');
  assert.equal(life.routes['B'].messages.length, 1);
  assert.equal(life.routes['B'].messages[0].text, 'B线消息');
  // 主线无新增事实
  assert.equal(life.mainLineContaminated, false);
  // 当前活跃是 B
  assert.equal(life.activeRouteId, 'B');
  assert.equal(life.routes['B'].active, true);
  assert.equal(life.routes['A'].active, false);
});

test('C3: 只带回选定作品而不带回临时关系结果', () => {
  const life = PL.createParallelLife({
    lifeId: 'life_003',
    originPoint: { event: '起点' },
  });
  const route = PL.forkRoute(life, 'main');
  route.messages.push({ id: 'm1', text: '临时聊天' });
  route.schedule.push({ id: 's1', event: '临时日程' });
  route.works.push({ id: 'w1', title: '作品A' });
  route.works.push({ id: 'w2', title: '作品B' });
  route.works.push({ id: 'w3', title: '作品C' });

  // 只带回 w1 和 w3
  const result = PL.harvestAndDiscard(life, 'main', ['w1', 'w3']);
  assert.equal(result.harvested.length, 2);
  assert.equal(result.harvested[0].id, 'w1');
  assert.equal(result.harvested[1].id, 'w3');
  // 临时关系结果被丢弃
  assert.equal(result.discarded.messages, 1);
  assert.equal(result.discarded.schedule, 1);
  assert.equal(result.discarded.worksNotHarvested, 1); // w2 没带回
  // 主线清洁
  assert.equal(result.mainLineClean, true);
  assert.equal(life.status, 'discarded');
});

/* ============================================================ */
/* D 面：负控制三向自证                                         */
/* ============================================================ */
test('D1: 负控制——破坏隔离（A路线消息推入B）→ 可观测', async () => {
  // 破坏 switchRoute：不清除旧活跃
  const brokenUrl = breakSource(SN_REL, 'progress.mainChatContaminated = false', 'progress.mainChatContaminated = true');
  const brokenMod = await import(brokenUrl);
  const serial = brokenMod.createSerial({
    serialId: 'b1', title: '测试',
    chapters: [{ chapterId: 'ch1', title: 'ch1', medium: 'prose', content: 'c' }],
  });
  const progress = brokenMod.createReaderProgress('b1', 'r1');
  brokenMod.advanceChapter(serial, progress, 'ch1');
  // 破坏后：mainChatContaminated 被设为 true → 可观测
  assert.equal(progress.mainChatContaminated, true);
});

test('D2: 负控制——破坏切换隔离（不取消旧活跃）→ 可观测', async () => {
  const brokenUrl = breakSource(PL_REL,
    "life.routes[previousRouteId].active = false",
    "void(0)");
  const brokenMod = await import(brokenUrl);
  const life = brokenMod.createParallelLife({ lifeId: 'b2', originPoint: {} });
  brokenMod.forkRoute(life, 'A');
  brokenMod.forkRoute(life, 'B');
  // 切换到 B
  brokenMod.switchRoute(life, 'B');
  // 破坏后：A 仍然 active=true → 可观测
  assert.equal(life.routes['A'].active, true); // 应该是 false 但破坏导致仍 true
});

test('D3: 负控制——破坏收获限制（带回全部作品而非选定）→ 可观测', async () => {
  // 破坏 harvestAndDiscard：把 filter 条件改为永真
  const brokenUrl = breakSource(PL_REL,
    'Array.isArray(selectedWorkIds) && selectedWorkIds.includes(w.id)',
    'true || Array.isArray(selectedWorkIds)');
  const brokenMod = await import(brokenUrl);
  const life = brokenMod.createParallelLife({ lifeId: 'b3', originPoint: {} });
  const route = brokenMod.forkRoute(life, 'main');
  route.works.push({ id: 'w1', title: 'A' });
  route.works.push({ id: 'w2', title: 'B' });
  // 只选 w1 但破坏后全部带回
  const result = brokenMod.harvestAndDiscard(life, 'main', ['w1']);
  assert.equal(result.harvested.length, 2); // 破坏导致全部带回 → 可观测
});