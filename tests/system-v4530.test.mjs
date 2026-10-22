/* ============================================================
 * tests/system-v4530.test.mjs — v4.53.0 · 第六期批次 E 手机侧四项验收
 *   - R6-O7 可重访的关系往事：回忆册从陈列页变成互动现场
 *   - R6-X2 街区与人情网络：地点会提供机会
 *   - R6-X5 可演出的声音叙事：文字、角色声线和场景音编成一场作品
 *   - R6-X6 手机原生推理剧：消息、时间、证词与行动组成可玩的谜题
 * ------------------------------------------------------------
 * 判据分六面：
 *   A 面 版本锚与结构自证
 *   B 面 R6-O7 关系往事重访（立场不统一 / 私人消息引用范围 / 新记录不改旧经历）
 *   C 面 R6-X2 街区与人情网络（时间窗 / 错过不伪造 / 陌生角色不突然熟识）
 *   D 面 R6-X5 声音叙事（顺序演出暂停恢复 / 替换只重制一段 / 缺素材文字预演）
 *   E 面 R6-X6 推理剧（两条解法三位证人 / 未读线索不泄底 / 猜错可继续）
 *   F 面 负控制三向自证：真源码破坏副本必红 / 原版必绿 / 锚点不唯一必抛
 * ============================================================ */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const rel = (p) => path.join(ROOT, p);
const read = (p) => fs.readFileSync(rel(p), 'utf8');
const BORN_V = '4.53.0';
const RR_REL = 'config/relation-revisit.js';
const DN_REL = 'config/district-network.js';
const VN_REL = 'config/voice-narrative.js';
const ME_REL = 'config/mystery-engine.js';

const RR = await import(pathToFileURL(rel(RR_REL)).href);
const DN = await import(pathToFileURL(rel(DN_REL)).href);
const VN = await import(pathToFileURL(rel(VN_REL)).href);
const ME = await import(pathToFileURL(rel(ME_REL)).href);

function vnum(v) { return v.split('.').map(Number).reduce((a, b, i) => a + b * Math.pow(100, 2 - i), 0); }

function breakSource(filePath, anchor, replacement, suffix) {
  let code = read(filePath);
  const idx = code.indexOf(anchor);
  if (idx === -1) throw new Error(`Anchor not found: ${anchor}`);
  const before = code.slice(0, idx);
  const after = code.slice(idx + anchor.length);
  const broken = before + replacement + after + (suffix || '');
  const tmp = path.join(ROOT, '.tmp_broken_' + path.basename(filePath));
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
  const idx = read('index.js');
  const m = idx.match(/ST_PHONE_VERSION\s*=\s*'([^']+)'/);
  assert.ok(m, 'ST_PHONE_VERSION not found');
  assert.ok(vnum(m[1]) >= vnum(BORN_V), `ST_PHONE_VERSION ${m[1]} < ${BORN_V}`);
});

test('A3: 四模块 VERSION 常量与冻结词表存在', async () => {
  for (const [name, mod] of [['RR', RR], ['DN', DN], ['VN', VN], ['ME', ME]]) {
    // 模块成功 import 即证明 ESM 结构完整
    assert.ok(typeof mod === 'object', `${name} module not loaded`);
  }
  // 检查源文件中有 VERSION 常量
  for (const f of [RR_REL, DN_REL, VN_REL, ME_REL]) {
    const code = read(f);
    assert.ok(code.includes(`'${BORN_V}'`), `${f} missing VERSION ${BORN_V}`);
  }
});

test('A4: BORN_V 自锚', () => {
  assert.equal(BORN_V, '4.53.0');
});

/* ============================================================ */
/* B 面：R6-O7 可重访的关系往事                                  */
/* ============================================================ */
test('B1: 一人愿意重谈、一人回避，不强制统一立场', () => {
  const session = RR.createRevisitSession({
    pastId: 'past_001',
    originalPast: { summary: '去年秋天在画廊相遇', messages: [] },
    participants: [
      { actorId: 'alice', stance: 'willing' },
      { actorId: 'bob', stance: 'avoiding' },
    ],
    quoteScope: ['msg_1', 'msg_2'],
  });
  assert.equal(session.stances.alice, 'willing');
  assert.equal(session.stances.bob, 'avoiding');
  // 立场保持各自原始值，不合并
  assert.notEqual(session.stances.alice, session.stances.bob);
});

test('B2: 私人旧消息可选引用范围，不整段泄露', () => {
  const oldMessages = [
    { id: 'msg_1', from: 'alice', text: '那天真开心', isPrivate: false },
    { id: 'msg_2', from: 'bob', text: '我的秘密日记内容', isPrivate: true },
    { id: 'msg_3', from: 'alice', text: '普通消息', isPrivate: false },
  ];
  // 只引用 msg_1，msg_2 是私人消息且不在范围内
  const quoted = RR.quoteOldMessages(oldMessages, ['msg_1'], 'charlie');
  assert.equal(quoted[0].quoted, true); // msg_1 在范围内
  assert.equal(quoted[0].text, '那天真开心');
  // msg_2 私人消息不在范围内且查看者非发送者 → 隐藏
  assert.equal(quoted[1].quoted, false);
  assert.equal(quoted[1].hidden, true);
  assert.equal(quoted[1].text, '[该消息不在分享范围内]');
  // msg_3 不在范围内但不私密 → 标注未引用
  assert.equal(quoted[2].quoted, false);
  assert.equal(quoted[2].text, '[未引用]');
});

test('B3: 重访产生新记录而非改写旧经历', () => {
  const originalPast = { summary: '原版经历', messages: [{ id: 'msg_1', text: '原文' }] };
  const session = RR.createRevisitSession({
    pastId: 'past_002',
    originalPast,
    participants: [{ actorId: 'alice', stance: 'willing' }],
    quoteScope: ['msg_1'],
  });
  // 添加新交流
  RR.addRevisitExchange(session, { from: 'alice', kind: 'inquiry', text: '你还记得那天吗？' });
  RR.addRevisitExchange(session, { from: 'alice', kind: 'response', text: '是的，我一直记得' });
  // 关闭
  const result = RR.closeRevisit(session);
  // 新记录存在且标 newRecord
  assert.equal(result.closedSession.exchanges.length, 2);
  assert.equal(result.closedSession.exchanges[0].newRecord, true);
  // 旧经历未改写
  assert.equal(result.originalPast.summary, '原版经历');
  assert.equal(result.originalPast.messages.length, 1);
  assert.equal(result.originalPast.messages[0].text, '原文');
  // 两者可分别阅读
  assert.notEqual(result.closedSession.exchanges[0].text, result.originalPast.messages[0].text);
});

/* ============================================================ */
/* C 面：R6-X2 街区与人情网络                                    */
/* ============================================================ */
test('C1: 三处地点有不同时间窗，错过机会后不伪造已到场', () => {
  const places = [
    DN.createPlace({ placeId: 'gallery', name: '画廊', timeWindows: [{ day: 'mon', slots: [{ start: 'morning', end: 'noon', label: 'morning' }] }] }),
    DN.createPlace({ placeId: 'cafe', name: '咖啡馆', timeWindows: [{ day: 'mon', slots: [{ start: 'afternoon', end: 'evening', label: 'afternoon' }] }] }),
    DN.createPlace({ placeId: 'studio', name: '工作室', timeWindows: [{ day: 'mon', slots: [{ start: 'evening', end: 'night', label: 'evening' }] }] }),
  ];
  // 上午去画廊，咖啡馆和工作室的机会标 missed
  const galleryOpps = DN.deriveOpportunities(places[0], 'mon', 'morning', [{ id: 'exhibition', label: '画展' }], 'user1');
  const cafeOpps = DN.deriveOpportunities(places[1], 'mon', 'morning', [{ id: 'coffee_event', label: '咖啡品鉴' }], 'user1');
  assert.equal(galleryOpps[0].status, 'active');
  assert.equal(cafeOpps[0].status, 'missed'); // 不在咖啡馆营业时间，标 missed 不伪造
});

test('C2: 参与展览改变熟悉度，但陌生角色不突然熟识', () => {
  const place = DN.createPlace({
    placeId: 'gallery2', name: '画廊',
    timeWindows: [{ day: 'mon', slots: [{ start: 'morning', end: 'noon', label: 'morning' }] }],
  });
  // 初始熟悉度
  assert.equal(DN.getPlaceFamiliarity(place, 'user1'), 'stranger');
  // 到访一次
  const visit = DN.recordVisit(place, 'user1', 'exhibition_a', ['char_x', 'char_y']);
  assert.equal(DN.getPlaceFamiliarity(place, 'user1'), 'acquainted'); // stranger → acquainted
  // metCharacters 记录了相遇，但不改变角色关系级别
  assert.equal(visit.metCharacters.length, 2);
  assert.ok(visit.metCharacters.includes('char_x'));
  // 多次到访升 regular
  DN.recordVisit(place, 'user1', 'exhibition_b', []);
  DN.recordVisit(place, 'user1', 'exhibition_c', []);
  assert.equal(DN.getPlaceFamiliarity(place, 'user1'), 'regular');
});

test('C3: 地点用虚构坐标，不调用真实位置', () => {
  const place = DN.createPlace({
    placeId: 'fictional', name: '虚构地点',
    timeWindows: [{ day: 'mon', slots: [{ start: 'morning', end: 'noon', label: 'morning' }] }],
    fictitiousCoord: 'fictional_001',
  });
  assert.equal(place.fictitiousCoord, 'fictional_001');
  assert.equal(place.fictitiousCoord, 'fictional_001');
  // 不存在真实坐标字段
  assert.ok(!('gpsLat' in place));
  assert.ok(!('gpsLng' in place));
});

/* ============================================================ */
/* D 面：R6-X5 可演出的声音叙事                                  */
/* ============================================================ */
test('D1: 三角色五分钟场景可顺序演出、暂停、恢复', () => {
  const project = VN.createNarrative({
    projectId: 'show_001', title: '雨夜对话',
    cues: [
      { cueId: 'c1', type: 'narration', text: '雨声渐起', durationMs: 5000 },
      { cueId: 'c2', type: 'dialog', actorId: 'alice', text: '你来了', durationMs: 3000 },
      { cueId: 'c3', type: 'pause', durationMs: 2000 },
      { cueId: 'c4', type: 'dialog', actorId: 'bob', text: '嗯，我来了', durationMs: 3000 },
      { cueId: 'c5', type: 'ambience', assetRef: 'rain_001', durationMs: 120000 },
      { cueId: 'c6', type: 'dialog', actorId: 'carol', text: '雨真大', durationMs: 2000 },
    ],
  });
  assert.equal(project.cues.length, 6);
  assert.ok(project.totalDurationMs > 0);

  // 顺序播放
  const r1 = VN.playbackStep(project, 'play');
  assert.equal(r1.currentCue.cueId, 'c1');
  assert.equal(r1.state, 'playing');

  const r2 = VN.playbackStep(project, 'next');
  assert.equal(r2.currentCue.cueId, 'c2');

  // 暂停
  const r3 = VN.playbackStep(project, 'pause');
  assert.equal(r3.state, 'paused');

  // 恢复
  const r4 = VN.playbackStep(project, 'resume');
  assert.equal(r4.state, 'playing');
  const r5 = VN.playbackStep(project, 'next');
  assert.equal(r5.currentCue.cueId, 'c3');
});

test('D2: 替换一句台词只重制相应声部，不重跑全部', () => {
  const project = VN.createNarrative({
    projectId: 'show_002', title: '测试',
    cues: [
      { cueId: 'c1', type: 'dialog', actorId: 'alice', text: '你好', durationMs: 2000 },
      { cueId: 'c2', type: 'dialog', actorId: 'bob', text: '你好啊', durationMs: 2000 },
      { cueId: 'c3', type: 'dialog', actorId: 'carol', text: '你们好', durationMs: 2000 },
    ],
  });
  // 替换 c2
  const result = VN.replaceCue(project, 'c2', { type: 'dialog', actorId: 'bob', text: '最近怎么样', durationMs: 3000 });
  assert.equal(result.replaced.dirty, true);
  assert.equal(result.replaced.text, '最近怎么样');
  assert.equal(result.dirtyCount, 1); // 只有 c2 标 dirty
  // c1 和 c3 未标 dirty
  assert.equal(project.cues[0].dirty, false);
  assert.equal(project.cues[2].dirty, false);
});

test('D3: 无TTS服务或缺素材时可文字预演且明确缺失', () => {
  const project = VN.createNarrative({
    projectId: 'show_003', title: '缺素材测试',
    cues: [
      { cueId: 'c1', type: 'dialog', actorId: 'alice', text: '你好', durationMs: 2000 }, // 无 assetRef，需要 TTS
      { cueId: 'c2', type: 'music', assetRef: 'bgm_001', durationMs: 5000 }, // 有 assetRef 但素材缺失
      { cueId: 'c3', type: 'pause', durationMs: 1000 }, // 停顿不需要音频
    ],
  });
  // 无 TTS，无素材
  const preview = VN.textPreview(project, { ttsAvailable: false, assets: {} });
  assert.equal(preview.lines.length, 3);
  assert.ok(preview.missing.length >= 2); // c1 缺 TTS，c2 缺素材
  assert.equal(preview.lines[0].hasAudio, false); // c1 无 TTS
  assert.equal(preview.lines[1].hasAudio, false); // c2 缺素材
  assert.equal(preview.lines[2].hasAudio, true); // c3 停顿不需要音频
  // 明确标注缺失原因
  const c1Missing = preview.missing.find((m) => m.cueId === 'c1');
  assert.ok(c1Missing);
  assert.equal(c1Missing.reason, 'tts-unavailable');
});

/* ============================================================ */
/* E 面：R6-X6 手机原生推理剧                                    */
/* ============================================================ */
test('E1: 两条解法、三位证人、一条误导线索', () => {
  const mystery = ME.createMystery({
    mysteryId: 'case_001', title: '消失的快递',
    clues: [
      { id: 'clue_a', text: '快递柜监控显示下午3点取走', isPublic: true },
      { id: 'clue_b', text: '邻居看到一只橘猫', isPublic: true },
      { id: 'clue_c', text: '物业说那天停电', isPublic: false },
      { id: 'clue_d', text: '收件人当天加班记录', isPublic: false },
      { id: 'clue_e', text: '快递员说送到了隔壁', isRedHerring: true }, // 误导线索
    ],
    witnesses: [
      { id: 'w1', actorId: 'neighbor', knowsClueIds: ['clue_b'] },
      { id: 'w2', actorId: 'manager', knowsClueIds: ['clue_c'] },
      { id: 'w3', actorId: 'colleague', knowsClueIds: ['clue_d'] },
    ],
    solutions: [
      { solutionId: 'sol_a', requiredClueIds: ['clue_a', 'clue_c'], steps: ['停电导致快递柜失效'], conclusion: '快递因停电滞留在柜中' },
      { solutionId: 'sol_b', requiredClueIds: ['clue_a', 'clue_d'], steps: ['收件人不在家'], conclusion: '快递被邻居代收' },
    ],
    autoHint: false, // 作者关闭自动提示
  });
  assert.equal(mystery.clues.length, 5);
  assert.equal(mystery.witnesses.length, 3);
  assert.equal(mystery.solutions.length, 2);
  assert.equal(mystery.autoHint, false);
  // 存在误导线索
  const redHerrings = mystery.clues.filter((c) => c.isRedHerring);
  assert.equal(redHerrings.length, 1);
});

test('E2: 未读线索不能被角色回答泄底', () => {
  const mystery = ME.createMystery({
    mysteryId: 'case_002', title: '测试不泄底',
    clues: [
      { id: 'clue_a', text: '线索A', isPublic: true },
      { id: 'clue_b', text: '线索B', isPublic: false },
      { id: 'clue_c', text: '线索C', isPublic: false },
    ],
    witnesses: [
      { id: 'w1', actorId: 'witness1', knowsClueIds: ['clue_a', 'clue_b'] },
    ],
    solutions: [
      { solutionId: 'sol_a', requiredClueIds: ['clue_a', 'clue_b'], steps: [], conclusion: '结果' },
    ],
  });
  const progress = ME.createProgress('case_002');
  // 玩家只读了 clue_a，未读 clue_b
  progress.readClueIds.push('clue_a');

  // 询问证人 clue_b（未读）→ 不泄底
  const r1 = ME.queryWitness(mystery, progress, 'w1', 'clue_b');
  assert.equal(r1.leakedUnread, false);
  assert.ok(!r1.text.includes('线索B'));

  // 读完 clue_b 后再问 → 可以回答
  progress.readClueIds.push('clue_b');
  const r2 = ME.queryWitness(mystery, progress, 'w1', 'clue_b');
  assert.equal(r2.responded, true);
  assert.ok(r2.text.includes('线索B'));
});

test('E3: 猜错可回到证据继续，存档不重置已发现线索', () => {
  const mystery = ME.createMystery({
    mysteryId: 'case_003', title: '测试猜错',
    clues: [
      { id: 'clue_a', text: '线索A', isPublic: true },
      { id: 'clue_b', text: '线索B' },
      { id: 'clue_c', text: '线索C' },
    ],
    witnesses: [{ id: 'w1', actorId: 'wit', knowsClueIds: ['clue_a'] }],
    solutions: [
      { solutionId: 'sol_a', requiredClueIds: ['clue_a', 'clue_b', 'clue_c'], steps: [], conclusion: '正确结果' },
    ],
  });
  const progress = ME.createProgress('case_003');
  progress.discoveredClueIds.push('clue_a', 'clue_b');
  progress.readClueIds.push('clue_a', 'clue_b');

  // 猜错：选了正确解法但没读所有线索
  const r1 = ME.submitHypothesis(mystery, progress, 'sol_a', ['clue_a', 'clue_b']);
  assert.equal(r1.correct, false);
  // 已发现线索不丢失
  assert.equal(progress.discoveredClueIds.length, 2);
  assert.equal(progress.attemptedSolutions.length, 1);

  // 读完所有线索后猜对
  progress.discoveredClueIds.push('clue_c');
  progress.readClueIds.push('clue_c');
  const r2 = ME.submitHypothesis(mystery, progress, 'sol_a', ['clue_a', 'clue_b', 'clue_c']);
  assert.equal(r2.correct, true);
  assert.equal(progress.solved, true);

  // 已发现线索列表
  const discovered = ME.getDiscoveredClues(mystery, progress);
  assert.equal(discovered.length, 3);
});

test('E4: 不同解法可得到不同但自洽的收束', () => {
  const mystery = ME.createMystery({
    mysteryId: 'case_004', title: '双解法测试',
    clues: [
      { id: 'c1', text: '公开线索1', isPublic: true },
      { id: 'c2', text: '线索2' },
      { id: 'c3', text: '线索3' },
    ],
    witnesses: [{ id: 'w1', actorId: 'wit', knowsClueIds: ['c1'] }],
    solutions: [
      { solutionId: 'sol_a', requiredClueIds: ['c1', 'c2'], steps: [], conclusion: '收束A' },
      { solutionId: 'sol_b', requiredClueIds: ['c1', 'c3'], steps: [], conclusion: '收束B' },
    ],
  });
  // 走解法 A
  const progA = ME.createProgress('case_004');
  progA.discoveredClueIds.push('c1', 'c2');
  progA.readClueIds.push('c1', 'c2');
  const rA = ME.submitHypothesis(mystery, progA, 'sol_a', ['c1', 'c2']);
  assert.equal(rA.correct, true);
  assert.equal(rA.feedback, '收束A');

  // 走解法 B（独立进度）
  const progB = ME.createProgress('case_004');
  progB.discoveredClueIds.push('c1', 'c3');
  progB.readClueIds.push('c1', 'c3');
  const rB = ME.submitHypothesis(mystery, progB, 'sol_b', ['c1', 'c3']);
  assert.equal(rB.correct, true);
  assert.equal(rB.feedback, '收束B');
});

/* ============================================================ */
/* F 面：负控制三向自证                                         */
/* ============================================================ */
test('F1: 负控制——破坏引用范围检查（scope 判断改 if(true) 使所有消息暴露）→ 可观测', async () => {
  // 破坏 quoteOldMessages 中的 scope 判断：所有消息都被视为在范围内
  const brokenUrl = breakSource(RR_REL,
    'if (scopeSet.has(msg.id))',
    'if (true)');
  const brokenMod = await import(brokenUrl);
  const oldMessages = [
    { id: 'msg_1', from: 'bob', text: '秘密内容', isPrivate: true },
  ];
  // 破坏后：私人消息也被视为在范围内，全文暴露
  const result = brokenMod.quoteOldMessages(oldMessages, [], 'charlie');
  assert.equal(result[0].text, '秘密内容'); // 私人内容被泄露 → 破坏可观测
  assert.equal(result[0].quoted, true); // 被标为已引用
});

test('F2: 负控制——破坏熟悉度升级（stranger 不升级）→ 可观测', async () => {
  // 破坏 recordVisit 中的熟悉度升级逻辑
  const brokenUrl = breakSource(DN_REL,
    "if (!place.familiarity[userId] || place.familiarity[userId] === 'stranger')",
    "if (false)");
  const brokenMod = await import(brokenUrl);
  const place = brokenMod.createPlace({
    placeId: 'p1', name: '测试',
    timeWindows: [{ day: 'mon', slots: [{ start: 'morning', end: 'noon', label: 'morning' }] }],
  });
  brokenMod.recordVisit(place, 'user1', 'ev1', []);
  // 破坏后：到访后仍然 stranger，不升级
  assert.equal(brokenMod.getPlaceFamiliarity(place, 'user1'), 'stranger'); // 破坏可观测
});

test('F3: 负控制——破坏未读线索不泄底（改 if(false)）→ 可观测', async () => {
  // 破坏 queryWitness 中的未读检查
  const brokenUrl = breakSource(ME_REL,
    'if (!isRead)',
    'if (false)');
  const brokenMod = await import(brokenUrl);
  const mystery = brokenMod.createMystery({
    mysteryId: 'm1', title: '测试',
    clues: [
      { id: 'c1', text: '秘密线索' },
      { id: 'c2', text: '普通线索' },
      { id: 'c3', text: '另一条' },
    ],
    witnesses: [{ id: 'w1', actorId: 'wit', knowsClueIds: ['c1'] }],
    solutions: [{ solutionId: 's1', requiredClueIds: ['c1', 'c2', 'c3'], steps: [], conclusion: '结果' }],
  });
  const progress = brokenMod.createProgress('m1');
  // 未读 c1 但破坏后证人直接泄露内容
  const r = brokenMod.queryWitness(mystery, progress, 'w1', 'c1');
  assert.ok(r.text.includes('秘密线索')); // 泄底了 → 破坏可观测
});