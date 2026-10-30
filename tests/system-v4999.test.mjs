/* ============================================================
 * tests/system-v4999.test.mjs — R11-X9 验收：把「三件内核」接成用户真能用的「回看」
 * ------------------------------------------------------------
 * 【这一项为什么单列】
 *   三件内核早就写好了、也被 tests/ 逐条消费过，但**产品端零 import**：
 *     · `life-program-replay`      —— 多幕结构 + 同一段经历的多角色视角；
 *     · `replayable-phone-program` —— 手机经历的节目单与「他当时能看到什么」；
 *     · `smart-gallery-vault`      —— 相册保险箱（公开流 / 私密分区 + 解锁冷却）。
 *   用户从来没有「按幕回看一段时间里发生过的事」这个动作，相册里也从来没有保险箱。
 *   计划原文 R11-X9 的验收语：「回看页能按幕显示当时发生过什么、当时谁能看到；
 *   保险箱内容不出现在普通相册列表；解锁前不显示画面；回看时不许重新生成内容。」
 *
 * 【直连为什么不行（本版真抓到的坑）】
 *   ① 三件内核的返回体形状各不相同：
 *      · `getActPerspective` → 永远返回一个 view：没有该角色的主观回忆时回落成
 *        「以旁观者的视角注视着<幕名>」。这个回落若被当成「他当时真这么想」，
 *        就是把「没有记录」演成「有记录」。
 *      · `playbackProgramSummary` → 不可用时只给一句 `无可用节目录`，连 title 都没有。
 *      · `replayProgramStepByPerspective` → 「看不到细节」与「这一步不存在」是两种
 *        不同的失败，压成一句就分不开。
 *      · `SmartGalleryVault` 实例 → 锁着时 `vaultPhotos` 里**还是带 url**，
 *        谁直接读谁就绕过了锁（「锁着」只剩一层 CSS 遮挡）。
 *   ② 三处「两件不同的事」必须不同形：
 *      · 台账：**读不到** ≠ **内容坏了** ≠ **还没录过** ≠ **录了 N 段**；
 *      · 视角：**有该角色的回忆** ≠ **没有（回落成旁观）** ≠ **视角名坏掉**；
 *      · 保险箱：**保险箱读不到** ≠ **锁着** ≠ **空的**。
 *   故本版先加一层形状态翻译（`config/replay-face-bridge.js`），再上产品面。
 *
 * 【本版实测抓到并修掉的三个真缺陷（都不是推演）】
 *   · `AlbumData.programPerspectives` 里少写 `this.` ⇒ 三格取数抛 ReferenceError，
 *     而节目列表 / 幕次列表照常显示（界面看着有内容、只少一格）；
 *   · `MemoryView` 的视角现场态初值写成 `'self'` 字面量 ⇒ 视图在写第二套判据；
 *   · `SubsystemOrchestrator.replayLifeExperience` 四处错参 ⇒ 每次调用都成功返回、
 *     每一项都是空的（本仓最贵的「不报错、只错结果」形态）。
 *
 * 【覆盖】
 *   A 台账四态：missing / bad_json / empty / ok（四句话两两不同）
 *   B 幕次四态：no_program / no_acts_field / empty / ok（含「N 人有回忆」）
 *   C 三视角：self 有回忆 / self 兜底且 isFallback 真 / bystander 取公共叙述 /
 *            坏视角名如实念 / otherId 三级来源
 *   D 保险箱四态：missing / locked（**一条 url 都不给**）/ open / empty
 *   E 接线自证：App 真 import 桥与内核 / 视图不写第二套判据 / 键三处同源 / 桥是纯函数
 *   F 产品面全链：节目台账 → 幕次 → 三视角 → 对白重建 → 入箱后主列表消失
 *   G 负控制：真源码破坏 ⇒ 在副本上重跑**同款判据**必须转红（双向断言）
 * ============================================================ */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  REPLAY_VIEWERS, REPLAY_LEDGER_KEY, viewerLabelOf, viewerKnown,
  replayStateOf, programRowsOf, actRowsOf, perspectiveOf, programSummaryOf,
  stepViewOf, stepRowsOf, actStepsOf, vaultPartitionOf, secrecyLabelOf, secrecyOptions
} from '../config/replay-face-bridge.js';
import { SmartGalleryVault, PHOTO_SECRECY } from '../config/smart-gallery-vault.js';
import { AlbumData } from '../apps/album/album-data.js';

const __dir = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dir, '..');
const BRIDGE_REL = 'config/replay-face-bridge.js';
const ALBUM_DATA_REL = 'apps/album/album-data.js';
const ALBUM_VIEW_REL = 'apps/album/album-view.js';
const MEMORY_APP_REL = 'apps/memory/memory-app.js';
const MEMORY_VIEW_REL = 'apps/memory/memory-view.js';
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/* ── 夹具 ─────────────────────────────────────────────────── */
/** 内存 storage：与真 PhoneStorage 同口径（`get(k, 默认值)`）。 */
function memStorage(init = {}, opts = {}) {
  const mem = new Map(Object.entries(init));
  return {
    _mem: mem,
    get(k, d) {
      if (opts.getThrows) throw new Error('storage_get_boom');
      return mem.has(k) ? mem.get(k) : d;
    },
    set(k, v) { mem.set(k, v); return true; },
    keys: () => [...mem.keys()]
  };
}

/**
 * 一份真节目：两幕。
 *   第 1 幕 3 句对白（第 3 句 `isPrivate`）—— 用来钉「谁能看到细节」；
 *   第 2 幕 0 句对白 —— 用来钉「这一幕没录对白」与「这一幕没录」不同形。
 *   视角只写了 `林晚照` / `阿澈`，**没有** `protagonist` —— 用来钉兜底句。
 */
function programOf() {
  return {
    id: 'prog_a',
    title: '雨夜便利店',
    occasion: '深夜长谈',
    participants: ['林晚照', '阿澈'],
    createdAt: 200,
    acts: [
      {
        actIndex: 1,
        title: '推门进店',
        location: '便利店',
        narrativeSnippet: '雨很大，两人挤在门口抖伞',
        dialogues: [
          { speaker: '林晚照', text: '这雨下得真不巧', isPrivate: false },
          { speaker: '阿澈', text: '我有伞，送你回去', isPrivate: false },
          { speaker: '阿澈', text: '（悄悄把伞往她那边倾）', isPrivate: true }
        ],
        perspectives: { 林晚照: '他把伞全给了我', 阿澈: '不想让她淋到' }
      },
      {
        actIndex: 2,
        title: '结账',
        location: '收银台',
        narrativeSnippet: '两人抢着付钱',
        dialogues: [],
        perspectives: { 林晚照: '他非要请客' }
      }
    ]
  };
}

/** 装一个 AlbumData（数据层不依赖 DOM，只依赖 `window.VirtualPhone.subsystems.galleryVault`）。 */
function mkAlbumData(init = {}, vault = null, opts = {}) {
  globalThis.window = { VirtualPhone: { subsystems: vault ? { galleryVault: vault } : {} } };
  const storage = memStorage(init, opts);
  return { data: new AlbumData(storage), storage };
}
/** 一台真保险箱（两公开 + 一私密；密码 2468）。 */
function mkVault() {
  const vault = new SmartGalleryVault({ storage: memStorage(), vaultPin: '2468' });
  vault.addPhoto({ id: 'p1', url: '/backgrounds/phone_a.png', title: '海边合影', secrecy: PHOTO_SECRECY.PUBLIC, actors: ['林晚照'] });
  vault.addPhoto({ id: 'p2', url: '/backgrounds/phone_b.png', title: '私密自拍', secrecy: PHOTO_SECRECY.INTIMATE, actors: ['林晚照'] });
  return vault;
}
/** 上传索引（相册主列表的数据源之一）。 */
const uploadIndexOf = () => JSON.stringify([
  { path: '/backgrounds/phone_a.png', prefix: '本地上传', createdAt: 10 },
  { path: '/backgrounds/phone_b.png', prefix: '本地上传', createdAt: 20 }
]);

/* ══════════ A ── 台账四态 ══════════ */
test('A1 台账四态四句话：读不到 / 内容坏了 / 没录过 / 录了 N 段，绝不同形', () => {
  const missing = replayStateOf(null);
  assert.equal(missing.state, 'empty', 'null 是「盘上没这一项」⇒ 还没录过');
  assert.match(missing.label, /还没|一段都没录/);

  const bad = replayStateOf('{坏 json');
  assert.equal(bad.state, 'missing', '坏 JSON 是「这份档坏了」，不是「还没录过」');
  assert.match(bad.label, /坏/, '说不出来就变成静默丢档');
  const empty = replayStateOf(JSON.stringify({ programs: {} }));
  assert.equal(empty.state, 'empty');

  const ok = replayStateOf(JSON.stringify({ programs: { prog_a: programOf() } }));
  assert.equal(ok.state, 'ok');
  assert.equal(ok.count, 1);
  assert.match(ok.label, /1 段/);
  /* 三句话两两不同 —— 这句断言才是本条的核心。
   * ★ 注意**不能**写成「坏标签里不许出现『还没』」：桥的那句话本身就是
   *   「回看台账内容坏了（不是「还没录过」）」——它用否定的方式把两件事分开，
   *   恰恰是最清楚的说法。判据要看的是「两句是否同一句」，不是「有没有同一个词」。 */
  const labels = [missing.label, bad.label, ok.label];
  assert.equal(new Set(labels).size, 3, '三句话必须两两不同：' + JSON.stringify(labels));
  assert.notEqual(bad.label, missing.label, '「档坏了」与「还没录过」必须是两句不同的话');
  assert.equal(bad.state, 'missing');
  assert.equal(missing.state, 'empty', '两态还要落在不同的 state 上（界面据此给不同的下一步）');
});

test('A2 台账行的读数由桥拼好：视图不自己拼「X · N 幕」', () => {
  const ok = replayStateOf(JSON.stringify({ programs: { prog_a: programOf() } }));
  const row = ok.rows[0];
  assert.equal(row.title, '雨夜便利店');
  assert.equal(row.actCount, 2);
  assert.equal(row.line, '雨夜便利店 · 2 幕 · 林晚照、阿澈', '一行读数只能有一处实现');
  /* 参与者为空时不许留一个空尾巴。 */
  const solo = programOf();
  solo.participants = [];
  const rows = programRowsOf({ programs: { s: solo } });
  assert.equal(rows.rows[0].line, '雨夜便利店 · 2 幕', '没有参与者时不许拖一个「· 」');
});

test('A3 台账读不到 ≠ 空台账：rawReadable=false 必须落在 missing 且带原因', () => {
  const miss = programRowsOf(null, { rawReadable: false, why: 'read_threw' });
  assert.equal(miss.state, 'missing');
  assert.equal(miss.readable, false);
  assert.equal(miss.why, 'read_threw');
  assert.match(miss.label, /读不到/);
  assert.equal(/还没录过/.test(miss.label), true, '读不到这句话里必须明写「不是还没录过」');
  /* 同一份 null 在「读得到」的前提下一律是 empty —— 这一对是本条的核心分辨力。 */
  assert.equal(programRowsOf(null, { rawReadable: true }).state, 'empty');
});

/* ══════════ B ── 幕次四态 ══════════ */
test('B1 幕次四态：没有节目 / 没有幕次字段 / 零幕 / 有 N 幕，四句不同形', () => {
  const noProg = actRowsOf(null);
  assert.equal(noProg.state, 'missing');
  assert.equal(noProg.why, 'no_program');
  assert.match(noProg.label, /不是「它没有幕」/);

  const noField = actRowsOf({ id: 'x', title: 'x' });
  assert.equal(noField.state, 'missing');
  assert.equal(noField.why, 'no_acts_field');
  assert.match(noField.label, /不是「零幕」/, '「没有幕次字段」不许被念成「零幕」');

  const zero = actRowsOf({ id: 'y', title: 'y', acts: [] });
  assert.equal(zero.state, 'empty');
  assert.match(zero.label, /零幕/);

  const ok = actRowsOf(programOf());
  assert.equal(ok.state, 'ok');
  assert.equal(ok.count, 2);
  assert.match(ok.label, /共 2 幕/);
  assert.equal(new Set([noProg.label, noField.label, zero.label]).size, 3, '三句话两两不同');
});

test('B2 幕次行报「N 人有回忆」，没视角就说没有（不推人数）', () => {
  const ok = actRowsOf(programOf());
  assert.equal(ok.rows[0].line, '推门进店 · 2 人有回忆');
  assert.deepEqual(ok.rows[0].viewpoints.sort(), ['林晚照', '阿澈'].sort());
  assert.equal(ok.rows[1].line, '结账 · 1 人有回忆');
  /* 一幕里谁都没写回忆 ⇒ 明写「没有主观回忆」，不许留空。 */
  const bare = programOf();
  bare.acts[1].perspectives = {};
  assert.match(actRowsOf(bare).rows[1].line, /没有主观回忆/);
});

/* ══════════ C ── 三视角 ══════════ */
test('C1 有回忆就念回忆，没回忆必须 isFallback 且原话是内核的兜底句', () => {
  const withNote = perspectiveOf(programOf(), 1, REPLAY_VIEWERS.OTHER, { otherId: '阿澈' });
  assert.equal(withNote.ok, true);
  assert.equal(withNote.characterId, '阿澈');
  assert.equal(withNote.isFallback, false, '有回忆时不许标兜底');
  assert.equal(withNote.view, '不想让她淋到');

  const fallback = perspectiveOf(programOf(), 1, REPLAY_VIEWERS.SELF);
  assert.equal(fallback.ok, true, '兜底也是一个能显示的 view');
  assert.equal(fallback.isFallback, true, '★ 兜底必须标出来：不标就等于替角色编了一段内心');
  assert.match(fallback.view, /以旁观者的视角注视着/, '兜底句是内核原话，桥不改写');
  assert.equal(fallback.why, 'no_specific_note');
});

test('C2 旁观取公共叙述，不调主观回忆；公共叙述缺失时同样标兜底', () => {
  const by = perspectiveOf(programOf(), 1, REPLAY_VIEWERS.BYSTANDER);
  assert.equal(by.ok, true);
  assert.equal(by.characterId, '', '旁观不对应任何角色');
  assert.equal(by.view, '雨很大，两人挤在门口抖伞');
  assert.equal(by.isFallback, false);

  const bare = programOf();
  bare.acts[1].narrativeSnippet = '';
  const noSnippet = perspectiveOf(bare, 2, REPLAY_VIEWERS.BYSTANDER);
  assert.equal(noSnippet.isFallback, true, '没有公共叙述时不许当「他看到了空白」');
  assert.equal(noSnippet.why, 'no_public_snippet');
});

test('C3 坏视角名如实念、不回落成「本人」；没有这一幕与没有这个节目分得开', () => {
  for (const bad of ['weird', '', null]) {
    const r = perspectiveOf(programOf(), 1, bad);
    assert.equal(r.ok, false);
    assert.equal(r.view, '', '取不到时一个字都不给');
    assert.equal(r.isFallback, false, '取不到不是兜底');
  }
  assert.match(perspectiveOf(programOf(), 1, 'weird').label, /未知视角「weird」/);
  assert.match(perspectiveOf(programOf(), 1, 'weird').label, /weird/, '要说得出是哪个坏值');
  assert.equal(perspectiveOf(programOf(), 1, '').label, '视角未选');
  assert.equal(perspectiveOf(programOf(), 1, 'weird').why, 'bad_viewer');
  assert.equal(perspectiveOf(programOf(), 9, REPLAY_VIEWERS.SELF).why, 'no_act');
  assert.equal(perspectiveOf(null, 1, REPLAY_VIEWERS.SELF).why, 'no_program');
  /* 三格枚举只有一份出处。 */
  assert.deepEqual(Object.values(REPLAY_VIEWERS).sort(), ['bystander', 'other', 'self']);
  assert.equal(viewerKnown('self'), true);
  assert.equal(viewerKnown('weird'), false);
});

test('C4 对方 id 三级来源：指定 → 本幕第一个非本人（插入序）→ 参与者第一个非本人；都没有就如实说没有', () => {
  const explicit = perspectiveOf(programOf(), 1, REPLAY_VIEWERS.OTHER, { otherId: '林晚照' });
  assert.equal(explicit.characterId, '林晚照', '① 调用点指定优先');

  /* ② 本幕主观回忆里的第一个非本人 —— 取的是 `Object.keys` 的**插入序**，
   *   夹具里 `林晚照` 写在前面，故这里就是 `林晚照`。
   *   ★ 这一条刻意不按「谁更像对方」猜：桥的口径是「第一个非本人」，
   *     判据必须照内核真实行为写，不能写成我们希望的顺序。 */
  const fromAct = perspectiveOf(programOf(), 1, REPLAY_VIEWERS.OTHER);
  assert.equal(fromAct.characterId, '林晚照', '② 本幕主观回忆里第一个非本人（插入序）');

  /* 把本人视角换成 `阿澈` 之后，② 应取到 `林晚照` 之外的另一个 —— 证明它真在按「非本人」排除。 */
  const swapped = perspectiveOf(programOf(), 1, REPLAY_VIEWERS.OTHER, { selfId: '林晚照' });
  assert.equal(swapped.characterId, '阿澈', '② 排除本人后取下一个');

  const noPersp = programOf();
  noPersp.acts[0].perspectives = {};
  const fromParts = perspectiveOf(noPersp, 1, REPLAY_VIEWERS.OTHER);
  assert.equal(fromParts.characterId, '林晚照', '③ 回落节目参与者里第一个非本人');

  const nobody = programOf();
  nobody.acts[0].perspectives = {};
  nobody.participants = [];
  const none = perspectiveOf(nobody, 1, REPLAY_VIEWERS.OTHER);
  assert.equal(none.ok, false);
  assert.equal(none.why, 'no_character', '三个来源都没有时如实说没有对方（不拿旁白顶替一个人）');
});

test('C5 三个视角的文案只有一处出处（视图不许手抄）', () => {
  assert.equal(viewerLabelOf(REPLAY_VIEWERS.SELF), '本人视角');
  assert.equal(viewerLabelOf(REPLAY_VIEWERS.OTHER), '对方视角');
  assert.equal(viewerLabelOf(REPLAY_VIEWERS.BYSTANDER), '旁观视角');
  assert.equal(new Set([REPLAY_VIEWERS.SELF, REPLAY_VIEWERS.OTHER, REPLAY_VIEWERS.BYSTANDER].map(viewerLabelOf)).size, 3);
});

/* ══════════ D ── 保险箱四态 ══════════ */
test('D1 保险箱读不到 ≠ 保险箱是空的', () => {
  const miss = vaultPartitionOf(null);
  assert.equal(miss.state, 'missing');
  assert.equal(miss.readable, false);
  assert.equal(miss.locked, true, '读不到时按「拿不到画面」处理（fail-closed）');
  assert.match(miss.label, /不是「保险箱是空的」/);
});

test('D2 锁着时 vaultRows 一条 url 都不给（这是本层对「保险箱」的唯一承诺）', () => {
  const locked = vaultPartitionOf(mkVault());
  assert.equal(locked.state, 'locked');
  assert.equal(locked.locked, true);
  assert.equal(locked.vaultCount, 1, '要能说出「里面有几项」');
  for (const row of locked.vaultRows) {
    assert.equal(row.url, '', '★ 锁着时任何一行都不许带 url：带出来「锁着」就只剩一层 CSS');
  }
  assert.equal(JSON.stringify(locked.vaultRows).includes('/backgrounds/phone_b.png'), false,
    '私密路径连字符串都不许出现在给视图的那一份里');
  assert.match(locked.label, /解锁后才显示画面/);
  /* `publicPaths` 是「能安全画出来的路径集合」：锁着时只有公开流。 */
  assert.deepEqual(locked.publicPaths, ['/backgrounds/phone_a.png']);
  /* `excludedPaths` 只用于过滤，含全部私密路径（与 publicPaths 职责不同）。 */
  assert.deepEqual(locked.excludedPaths, ['/backgrounds/phone_b.png']);
});

test('D3 解锁后才给 url；解锁但空箱是第三种形态', () => {
  const vault = mkVault();
  vault.unlockVault('2468');
  const open = vaultPartitionOf(vault);
  assert.equal(open.state, 'open');
  assert.equal(open.locked, false);
  assert.deepEqual(open.vaultRows.map((r) => r.url), ['/backgrounds/phone_b.png']);
  assert.deepEqual(open.publicPaths.sort(), ['/backgrounds/phone_a.png', '/backgrounds/phone_b.png']);

  const emptyVault = new SmartGalleryVault({ storage: memStorage(), vaultPin: '1' });
  emptyVault.unlockVault('1');
  const empty = vaultPartitionOf(emptyVault);
  assert.equal(empty.state, 'empty');
  assert.match(empty.label, /空/);
  assert.equal(new Set([vaultPartitionOf(null).label, open.label, empty.label]).size, 3, '三句话两两不同');
  /* 「锁着且空」与「解锁且空」也不是同一句。 */
  assert.notEqual(vaultPartitionOf(new SmartGalleryVault({ storage: memStorage(), vaultPin: '1' })).label, empty.label);
});

test('D4 密级文案唯一出处：坏值如实念，可选值由内核枚举转出', () => {
  assert.equal(secrecyLabelOf(PHOTO_SECRECY.PUBLIC), '公开');
  assert.equal(secrecyLabelOf(PHOTO_SECRECY.INTIMATE), '私密');
  assert.equal(secrecyLabelOf(PHOTO_SECRECY.TOP_SECRET), '绝密');
  assert.match(secrecyLabelOf('weird'), /未知密级「weird」/);
  assert.equal(secrecyLabelOf(''), '密级未标');
  assert.equal(/公开/.test(secrecyLabelOf('weird')), false, '坏密级绝不许回落成「公开」');
  const opts = secrecyOptions();
  assert.deepEqual(opts.map((o) => o.value), Object.values(PHOTO_SECRECY));
  assert.equal(new Set(opts.map((o) => o.label)).size, 3);
});

/* ══════════ E ── 接线自证 ══════════ */
test('E1 产品端真的 import 了桥与内核（不是只有 tests/ 在用）', () => {
  for (const rel of [ALBUM_DATA_REL, MEMORY_APP_REL]) {
    const src = read(rel);
    assert.match(src, /from '\.\.\/\.\.\/config\/replay-face-bridge\.js'/, rel + ' 必须真 import 回看桥');
  }
  /* 数据层必须真调用桥的五个取数口（不是只 import 不用）。 */
  const albumSrc = read(ALBUM_DATA_REL);
  for (const fn of ['replayStateOf', 'actRowsOf', 'perspectiveOf', 'programSummaryOf', 'actStepsOf', 'vaultPartitionOf']) {
    assert.match(albumSrc, new RegExp('\\b' + fn + '\\('), '相册数据层必须真调用桥函数 ' + fn);
  }
  const memorySrc = read(MEMORY_APP_REL);
  for (const fn of ['replayStateOf', 'actRowsOf', 'perspectiveOf', 'programSummaryOf', 'viewerLabelOf']) {
    assert.match(memorySrc, new RegExp('\\b' + fn + '\\('), '记忆 App 必须真调用桥函数 ' + fn);
  }
  /* 保险箱这一格：相册侧必须真的把实例取出来交给桥（不是自算「谁在箱里」）。 */
  assert.match(albumSrc, /galleryVault/, '相册必须从子系统取保险箱实例');
  assert.match(albumSrc, /vaultPartitionOf\(this\._vault\(\)\)/, '保险箱分区必须交给桥判');
  /* 三件内核必须真的被桥接上（本版就是把「零 import」变成非零）。 */
  const bridgeSrc = read(BRIDGE_REL);
  for (const dep of ['life-program-replay.js', 'replayable-phone-program.js', 'smart-gallery-vault.js']) {
    assert.match(bridgeSrc, new RegExp("from '\\./" + dep.replace('.', '\\.') + "'"), '桥必须接 ' + dep);
  }
});

test('E2 视图不写第二套判据：三态字面量与三个视角字面量都不许出现在视图里', () => {
  const albumViewSrc = stripComments(read(ALBUM_VIEW_REL));
  const memoryViewSrc = stripComments(read(MEMORY_VIEW_REL));
  for (const lit of ['self', 'other', 'bystander']) {
    for (const [name, src] of [['album-view', albumViewSrc], ['memory-view', memoryViewSrc]]) {
      assert.equal(src.includes("'" + lit + "'"), false,
        name + ' 里出现了视角字面量 ' + lit + '（第二份口径，改判据时必漏）');
      assert.equal(src.includes('"' + lit + '"'), false, name + ' 里出现了视角字面量 ' + lit);
    }
  }
  /* 保险箱那一格：视图不许自己拿 state 字符串比对，也不许绕过桥去读内核字段。
   *   ★ 允许的唯一形态：消费桥给的布尔（`readable` / `locked`）与条数。
   *   禁的是「视图自己记一份状态表」——`state === 'missing'` 这类比对一旦写进视图，
   *   桥以后加第五态时视图必然漏判，而界面不会有任何报错。 */
  assert.equal(/vault\.state\s*===/.test(albumViewSrc), false, 'album 视图不许自己拿保险箱 state 比对');
  assert.equal(/ledger\.state\s*===/.test(albumViewSrc), false, 'album 视图不许自己拿台账 state 比对');
  assert.equal(/ledger\.state\s*===/.test(memoryViewSrc), false, 'memory 视图不许自己拿台账 state 比对');
  assert.match(albumViewSrc, /vault\.readable/, 'album 视图只消费桥给的 readable 布尔');
  assert.match(albumViewSrc, /vault\.locked/, 'album 视图只消费桥给的 locked 布尔');
  assert.match(memoryViewSrc, /ledger\.count/, 'memory 视图用条数判「有没有节目」');
  /* 绕过桥直读内核内部字段是本层最要紧的一条禁令：`vaultPhotos` 锁着时**仍然带 url**。 */
  for (const [name, src] of [['album-view', albumViewSrc], ['memory-view', memoryViewSrc]]) {
    for (const forbidden of ['vaultPhotos', 'isUnlocked', 'programs[', 'subjectiveView', 'narrativeSnippet']) {
      assert.equal(src.includes(forbidden), false,
        name + ' 不许直读内核内部字段 ' + forbidden + '（那是绕开桥，锁着时也拿得到 url）');
    }
  }
  /* 视图不许 import 桥：判据只能有一处（与 chars 侧同纪律）。 */
  for (const [name, rel] of [['album-view', ALBUM_VIEW_REL], ['memory-view', MEMORY_VIEW_REL]]) {
    assert.equal(/from '.*replay-face-bridge/.test(read(rel)), false, name + ' 不许 import 桥（视角文案与枚举都走 App 层）');
  }
  /* 「本人/对方/旁观」这三个词也只许出现在 App 层转出的那一条里。 */
  assert.equal(/本人视角|对方视角|旁观视角/.test(memoryViewSrc), false, 'memory 视图不许手抄视角文案');
  assert.equal(/本人视角|对方视角|旁观视角/.test(albumViewSrc), false, 'album 视图不许手抄视角文案');
  /* 视图必须用 App 层转出的枚举（不然上面那些「不许」就只是空话）。 */
  assert.match(memoryViewSrc, /replayViewerOptions\(\)/, 'memory 视图的视角格子必须来自 App 层枚举');
});

test('E3 台账键三处同源：桥转出的常量 == 内核 STORAGE_KEY == storage 模式 == keys-audit 登记', () => {
  assert.equal(REPLAY_LEDGER_KEY, 'lpr_program_replay_v1');
  const storageSrc = read('config/storage.js');
  const chatBlock = storageSrc.slice(storageSrc.indexOf('CHAT_DATA_PATTERNS'));
  assert.ok(chatBlock.indexOf('/^lpr_/') > 0, '/^lpr_/ 必须写在 CHAT_DATA_PATTERNS 里（随会话隔离）');
  const auditSrc = read('scripts/keys-audit.mjs');
  const at = auditSrc.indexOf("key: 'lpr_program_replay_v1'");
  assert.ok(at > 0, 'keys-audit 必须登记 lpr_program_replay_v1');
  assert.match(auditSrc.slice(at, at + 300), /scope: 'chat'/, '回看台账必须随会话隔离');
  /* 桥不许另写一份字面量（两处写字面量就会有一处先漂）。 */
  const bridgeSrc = read(BRIDGE_REL);
  assert.equal(/['"]lpr_program_replay_v1['"]/.test(bridgeSrc), false, '桥不许手抄台账键字面量，只许从内核转出');
});

test('E4 桥是纯函数层：不 import storage、不写盘、不发网络、不改入参', () => {
  const src = stripComments(read(BRIDGE_REL));
  for (const bad of ['config/storage', 'writeReceipt', 'fs.', 'fetch(', 'localStorage', 'document.']) {
    assert.equal(src.includes(bad), false, '桥层不许出现 ' + bad + '（它是纯形状翻译）');
  }
  const imports = [...src.matchAll(/from '([^']+)'/g)].map((m) => m[1]);
  assert.deepEqual(imports.sort(), [
    './life-program-replay.js', './replayable-phone-program.js', './smart-gallery-vault.js'
  ], '桥只许依赖这三件内核：' + JSON.stringify(imports));
  /* 不改入参：喂进去的节目一个字都不许变。 */
  const p = programOf();
  const before = JSON.stringify(p);
  perspectiveOf(p, 1, REPLAY_VIEWERS.SELF);
  actRowsOf(p);
  actStepsOf(p, 1, '林晚照');
  assert.equal(JSON.stringify(p), before, '桥不许改入参（回看是只读的）');
});

/* ══════════ F ── 产品面全链 ══════════ */
test('F1 一条走到底：台账 → 幕次 → 三视角 → 对白重建（全在 AlbumData 这一层里走通）', () => {
  const { data } = mkAlbumData({
    [REPLAY_LEDGER_KEY]: JSON.stringify({ programs: { prog_a: programOf() }, updatedAt: 1 })
  });
  /* ① 台账 */
  const ledger = data.replayLedger();
  assert.equal(ledger.state, 'ok');
  assert.equal(ledger.rows[0].id, 'prog_a');
  /* ② 幕次 */
  const acts = data.programActs('prog_a');
  assert.equal(acts.state, 'ok');
  assert.equal(acts.count, 2);
  /* ③ 三视角：一次取齐，正好三格，顺序固定 */
  const views = data.programPerspectives('prog_a', 1);
  assert.deepEqual(views.map((v) => v.kind), ['self', 'other', 'bystander'], '三格顺序固定（视图画格子直接用）');
  assert.equal(views.every((v) => v.ok), true, '三格都要取得到');
  assert.equal(views[0].isFallback, true, '本人没写回忆 ⇒ 兜底（要标出来）');
  assert.equal(views[2].characterId, '', '旁观不对应角色');
  /* ④ 对白重建：换视角，可见步数必须变 */
  const asSelf = data.programActSteps('prog_a', 1, '林晚照');
  const asOther = data.programActSteps('prog_a', 1, '阿澈');
  assert.equal(asSelf.state, 'ok');
  assert.equal(asSelf.count, 3);
  assert.equal(asOther.count, 3, '步数不随视角变（说的是同一段经历）');
  assert.ok(asOther.visibleCount > asSelf.visibleCount,
    '★ 视角换了，能看到的步数必须变：不变就说明 isPrivate 根本没进去');
  assert.equal(asSelf.visibleCount, 2);
  assert.equal(asOther.visibleCount, 3);
});

test('F2 「没录对白」与「没这一幕」与「没这个节目」三态在数据层也分得开', () => {
  const { data } = mkAlbumData({
    [REPLAY_LEDGER_KEY]: JSON.stringify({ programs: { prog_a: programOf() }, updatedAt: 1 })
  });
  const noDialogues = data.programActSteps('prog_a', 2, '林晚照');
  assert.equal(noDialogues.state, 'empty');
  assert.equal(noDialogues.why, 'no_dialogues');
  assert.match(noDialogues.label, /不是「谁都看不到」/);

  const noAct = data.programActSteps('prog_a', 9, '林晚照');
  assert.equal(noAct.state, 'missing');
  assert.equal(noAct.why, 'no_act');

  const noProgram = data.programActSteps('nope', 1, '林晚照');
  assert.equal(noProgram.state, 'missing');
  assert.equal(noProgram.why, 'no_program', '「台账里没这个节目」与「这个节目没这一幕」必须分得开');
  assert.equal(new Set([noDialogues.label, noAct.label, noProgram.label]).size, 3, '三句话两两不同');
});

test('F3 入箱即从普通相册列表消失；锁着时画面也拿不到（两条验收一并钉住）', () => {
  const vault = mkVault();
  const { data } = mkAlbumData({ phone_album_upload_index: uploadIndexOf() }, vault);
  /* 夹具状态要说清：`p1` 是公开（在主列表），`p2` 建箱时就是私密（只在保险箱里）。
   *   故入箱前主列表**只有一张** —— 这本身就是「私密图不进主列表」的第一条证据。 */
  const before = data.getMedia().map((m) => m.path);
  assert.deepEqual(before, ['/backgrounds/phone_a.png'],
    '私密那张一开始就不在主列表里（先证明夹具真的能扫出公开那张）');

  const ok = vault.movePhotoSecrecy('p1', true);
  assert.equal(ok, true, '入箱这一步本身要成功（否则下面测的是别的东西）');
  const after = data.getMedia().map((m) => m.path);
  assert.equal(after.includes('/backgrounds/phone_a.png'), false,
    '★ 验收第 3 条：保险箱内容不许出现在普通相册列表');
  assert.equal(after.length, 0, '两张都进箱了 ⇒ 主列表空（不是「只剩公开流」）');
  /* 锁着时那一份给视图的分区，仍然一条 url 都不给。 */
  const face = data.vaultFace();
  assert.equal(face.state, 'locked');
  assert.equal(face.vaultCount, 2);
  for (const row of face.vaultRows) assert.equal(row.url, '');
});

test('F4 保险箱开启时主列表照旧藏；解锁只是「能看画面」，不是「回主列表」', () => {
  const vault = mkVault();
  vault.unlockVault('2468');
  const { data } = mkAlbumData({ phone_album_upload_index: uploadIndexOf() }, vault);
  const paths = data.getMedia().map((m) => m.path);
  assert.equal(paths.includes('/backgrounds/phone_b.png'), false,
    '解锁后私密图也不许进普通相册列表（它只属于保险箱那一格）');
  const face = data.vaultFace();
  assert.equal(face.state, 'open');
  assert.deepEqual(face.vaultRows.map((r) => r.url), ['/backgrounds/phone_b.png'],
    '解锁后才给 url —— 与「回主列表」是两件事');
});

test('F5 保险箱读不到时相册照常出图（不因为保险箱坏了把公开流一起藏掉）', () => {
  const { data } = mkAlbumData({ phone_album_upload_index: uploadIndexOf() }, null);
  assert.equal(data.vaultFace().state, 'missing');
  assert.equal(data._vaultExcludedSet().size, 0, '保险箱缺席时排除集必须是空集');
  assert.equal(data.getMedia().length, 2, '两张都要照常显示');
});

test('F6 台账坏掉 / 读抛错不许让相册白屏：主列表照常，回看那一格单独说原因', () => {
  const bad = mkAlbumData({ phone_album_upload_index: uploadIndexOf(), [REPLAY_LEDGER_KEY]: '{坏 json' });
  assert.equal(bad.data.getMedia().length, 2, '台账坏了不许影响主列表');
  const ledger = bad.data.replayLedger();
  assert.equal(ledger.state, 'missing');
  assert.match(ledger.label, /坏/);

  const threw = mkAlbumData({ phone_album_upload_index: uploadIndexOf() }, null, { getThrows: true });
  const threwLedger = threw.data.replayLedger();
  assert.equal(threwLedger.state, 'missing');
  assert.equal(threwLedger.why, 'storage_get_boom', '读抛错的原因要带出来（不是「空」）');
});

test('F7 节目总述：可用时给 N 幕，不可用时一句「无可用节目录」（不伪造标题）', () => {
  const { data } = mkAlbumData({
    [REPLAY_LEDGER_KEY]: JSON.stringify({ programs: { prog_a: programOf() }, updatedAt: 1 })
  });
  const okSummary = data.programSummary('prog_a');
  assert.equal(okSummary.ok, true);
  assert.equal(okSummary.totalActs, 2);
  assert.match(okSummary.label, /雨夜便利店 · 2 幕/);

  const none = data.programSummary('nope');
  assert.equal(none.ok, false);
  assert.equal(none.label, '无可用节目录');
  assert.equal(none.title, '', '不可用时不许给一个假标题');
  assert.equal(programSummaryOf(null).why, 'invalid_program');
});

/* ══════════ G ── 负控制（双向断言） ══════════ */
/** 真源码破坏（锚点必须恰中一次）。 */
function brokenSource(rel, pairs) {
  let src = read(rel);
  for (const [from, to] of pairs) {
    const n = src.split(from).length - 1;
    assert.equal(n, 1, '负控制锚点必须恰中一次：' + JSON.stringify(String(from).slice(0, 80)));
    src = src.replace(from, to);
  }
  return src;
}
/** 把破坏后的桥落成临时文件（同目录三件内核一并复制），返回 file:// URL。 */
function brokenBridgeCopy(pairs, outName) {
  const src = brokenSource(BRIDGE_REL, pairs);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rp_x9_'));
  for (const dep of ['life-program-replay.js', 'replayable-phone-program.js', 'smart-gallery-vault.js']) {
    fs.copyFileSync(path.join(ROOT, 'config', dep), path.join(dir, dep));
  }
  const file = path.join(dir, outName);
  fs.writeFileSync(file, src, 'utf8');
  return 'file://' + file;
}
/** 把破坏后的 AlbumData 落成临时目录（apps/album 全件 + config 全件），返回模块。 */
async function brokenAlbumModule(pairs) {
  const src = brokenSource(ALBUM_DATA_REL, pairs);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rp_x9app_'));
  const dir = path.join(tmp, 'apps', 'album');
  fs.mkdirSync(dir, { recursive: true });
  for (const f of fs.readdirSync(path.join(ROOT, 'apps', 'album'))) {
    const from = path.join(ROOT, 'apps', 'album', f);
    if (!fs.statSync(from).isFile()) continue;
    if (f === 'album-data.js') { fs.writeFileSync(path.join(dir, f), src, 'utf8'); continue; }
    fs.copyFileSync(from, path.join(dir, f));
  }
  fs.mkdirSync(path.join(tmp, 'config'), { recursive: true });
  for (const f of fs.readdirSync(path.join(ROOT, 'config'))) {
    if (/\.js$/.test(f)) fs.copyFileSync(path.join(ROOT, 'config', f), path.join(tmp, 'config', f));
  }
  return await import('file://' + path.join(dir, 'album-data.js').replace(/\\/g, '/'));
}

test('G1 负控制 · 锁着时把 url 一起给出去 ⇒ 「一条 url 都不给」判据转红（本层最要紧的一条）', async () => {
  const criterion = (mod) => {
    const rows = mod.vaultPartitionOf(mkVault()).vaultRows;
    return rows.length > 0 && rows.every((r) => r.url === '');
  };
  assert.equal(criterion({ vaultPartitionOf }), true, '原版：锁着时一行 url 都没有');
  /* ★ 破坏必须**改行为**。这里注入的是最像真 bug 的那一种：「反正视图会自己按 locked
   *   藏起来，那就把 url 一起给出去」——听起来像省一次判断，实际是把锁交给 CSS。 */
  const B = await import(brokenBridgeCopy([
    ['const vaultRows = vau.map(unlocked ? _photoRow : _lockedRow).filter(Boolean);',
      'const vaultRows = vau.map(_photoRow).filter(Boolean);']
  ], 'replay-face-bridge.leakurl.js'));
  assert.equal(criterion(B), false, '锁着时 url 也带出去 ⇒ 任何一次 DOM 检查都能绕锁，判据必须转红');
});

test('G2 负控制 · 兜底句不标 isFallback ⇒ 「没有回忆必须说出来」判据转红', async () => {
  const criterion = (mod) => {
    const v = mod.perspectiveOf(programOf(), 1, 'self');
    return v.ok === true && v.isFallback === true;
  };
  assert.equal(criterion({ perspectiveOf }), true, '原版：没有回忆时必须标兜底');
  /* 破坏写成「有 view 就算有回忆」：这正是最容易犯的那一版（看着「有内容」就当成有记录）。 */
  const B = await import(brokenBridgeCopy([
    ['isFallback: !hasNote,', 'isFallback: false,']
  ], 'replay-face-bridge.nofallback.js'));
  assert.equal(criterion(B), false, '兜底句被当成记录念出去 ⇒ 等于替角色编内心，判据必须转红');
});

test('G3 负控制 · 「没有这一幕」被念成「这一幕没对白」⇒ 四态分辨力判据转红', async () => {
  const criterion = (mod) => {
    const noAct = mod.actStepsOf(programOf(), 9, '林晚照');
    const empty = mod.actStepsOf(programOf(), 2, '林晚照');
    return noAct.state === 'missing' && noAct.why === 'no_act'
      && empty.state === 'empty' && noAct.label !== empty.label;
  };
  assert.equal(criterion({ actStepsOf }), true, '原版：两态分得开');
  const B = await import(brokenBridgeCopy([
    ["return { state: 'missing', label: '没有这一幕（不是「这一幕没有对白」）', rows: [], count: 0, visibleCount: 0, why: 'no_act' };",
      "return { state: 'empty', label: '这一幕没有记录对白（不是「谁都看不到」）', rows: [], count: 0, visibleCount: 0, why: 'no_dialogues' };"]
  ], 'replay-face-bridge.noact.js'));
  assert.equal(criterion(B), false, '「没这一幕」被压成「没对白」⇒ 用户会去补对白而我们该修数据，判据必须转红');
});

test('G4 负控制 · 三格取数少写 this. ⇒ 「三视角一次取齐」判据转红（产品面）', async () => {
  const criterion = (mod) => {
    globalThis.window = { VirtualPhone: { subsystems: {} } };
    const storage = memStorage({
      [REPLAY_LEDGER_KEY]: JSON.stringify({ programs: { prog_a: programOf() }, updatedAt: 1 })
    });
    try {
      const views = new mod.AlbumData(storage).programPerspectives('prog_a', 1);
      return Array.isArray(views) && views.length === 3 && views.every((v) => v.ok === true);
    } catch (_e) {
      return false;
    }
  };
  assert.equal(criterion({ AlbumData }), true, '原版：三格都取得到');
  const B = await brokenAlbumModule([
    ['rows.push(this.programPerspective(programId, actIndex, kind, opts));',
      'rows.push(programPerspective(programId, actIndex, kind, opts));']
  ]);
  assert.equal(criterion(B), false, '少写 this. ⇒ 三格整块抛错，判据必须转红（本版真踩过这一格）');
});

test('G5 负控制 · 入箱的照片不从主列表剔除 ⇒ 「保险箱内容不出现在相册」判据转红（产品面）', async () => {
  const criterion = (mod) => {
    const vault = mkVault();
    vault.movePhotoSecrecy('p1', true);
    globalThis.window = { VirtualPhone: { subsystems: { galleryVault: vault } } };
    const storage = memStorage({ phone_album_upload_index: uploadIndexOf() });
    const paths = new mod.AlbumData(storage).getMedia().map((m) => m.path);
    return paths.includes('/backgrounds/phone_a.png') === false;
  };
  assert.equal(criterion({ AlbumData }), true, '原版：入箱后主列表少一张');
  const B = await brokenAlbumModule([
    ['if (vaultExcluded.has(normalized)) return;', 'if (vaultExcluded.has(normalized)) { /* 忽略 */ }']
  ]);
  assert.equal(criterion(B), false, '入箱的照片仍在主列表 ⇒ 验收第 3 条整条落空，判据必须转红');
});
/* ══════════ H ── 归档链路（台账的唯一写入口） ══════════ */
/** 宿主对话夹具：9 句真对白 + 1 句系统楼层 + 1 句空正文 —— 三件都要被正确处理。 */
function chatOf() {
  return [
    { is_user: false, name: '林晚照', mes: '这雨下得真不巧' },
    { is_user: true, mes: '我送你回去吧' },
    { is_system: true, mes: '（系统：场景切换）' },
    { is_user: false, name: '林晚照', mes: '不用，我家很近' },
    { is_user: true, mes: '那我陪你走一段' },
    { is_user: false, name: '林晚照', mes: '你这个人真固执' },
    { is_user: true, mes: '嗯，走吧' },
    { is_user: false, name: '林晚照', mes: '' },
    { is_user: false, name: '林晚照', mes: '路灯下他把伞偏了偏' },
    { is_user: true, mes: '到了' },
    { is_user: false, name: '林晚照', mes: '谢谢你' }
  ];
}
/** 装宿主（`SillyTavern.getContext` 是本仓 82 处在用的通用对话读取口）。 */
function withHost(chat) {
  globalThis.SillyTavern = { getContext: () => ({ chat }) };
}
function noHost() { delete globalThis.SillyTavern; }

test('H1 归档四态：宿主读不到 / 没有对话楼层 / 没有可取对白 / 可归档（不许压成一句）', () => {
  try {
    noHost();
    const noCtx = mkAlbumData({}).data.chatArchivePreview();
    assert.equal(noCtx.state, 'missing');
    assert.equal(noCtx.why, 'no_host_context');
    assert.match(noCtx.label, /不是「这段对话是空的」/);

    globalThis.SillyTavern = { getContext: () => ({}) };
    const noArr = mkAlbumData({}).data.chatArchivePreview();
    assert.equal(noArr.state, 'missing');
    assert.equal(noArr.why, 'no_chat_array');

    withHost([]);
    const empty = mkAlbumData({}).data.chatArchivePreview();
    assert.equal(empty.state, 'empty');
    assert.match(empty.label, /不是「读不到」/);

    withHost([{ is_system: true, mes: 'x' }]);
    const onlySystem = mkAlbumData({}).data.chatArchivePreview();
    assert.equal(onlySystem.state, 'empty', '只有系统楼层 ⇒ 没有可取对白（不是「读不到」）');

    withHost(chatOf());
    const ok = mkAlbumData({}).data.chatArchivePreview();
    assert.equal(ok.state, 'ok');
    assert.equal(ok.dialogueCount, 9, '系统楼层与空正文都不许算进对白');
    assert.equal(new Set([noCtx.label, empty.label, ok.label]).size, 3);
  } finally { noHost(); }
});

test('H2 归档真写进台账：落盘 → 回读 → 幕次/三视角/对白全都能取到', () => {
  const { data } = mkAlbumData({});
  try {
    withHost(chatOf());
    const r = data.archiveChat({ title: '雨夜同路', perAct: 3 });
    assert.equal(r.ok, true, '归档要真成功：' + r.note);
    assert.match(r.note, /已归档 3 幕 · 9 句/);
    assert.ok(r.programId, '归档要回报节目 id（界面据此选中它）');

    /* 回读：台账里真的有这一段，且**步数/幕数与归档时一致**（验收「与存档逐字段一致」）。 */
    const ledger = data.replayLedger();
    assert.equal(ledger.state, 'ok');
    assert.equal(ledger.count, 1);
    const prog = data.getProgram(r.programId);
    assert.equal(prog.title, '雨夜同路');
    assert.equal(prog.acts.length, 3);
    assert.equal(prog.acts.reduce((n, a) => n + a.dialogues.length, 0), 9, '9 句原话一句不少、一句不多');
    assert.equal(prog.acts[0].dialogues[0].text, '这雨下得真不巧', '正文必须是原文，不是概述');

    /* 三视角 + 对白重建：归档不写 perspectives ⇒ 主观视角如实标兜底，旁观能念公共叙述。 */
    const self = data.programPerspective(r.programId, 1, 'self');
    assert.equal(self.isFallback, true, '★ 归档不代写内心 ⇒ 本人视角必须标兜底');
    const by = data.programPerspective(r.programId, 1, 'bystander');
    assert.equal(by.view, '这雨下得真不巧', '公共叙述取这一段第一句原文');
    assert.equal(data.programActSteps(r.programId, 1, '林晚照').count, 3);
  } finally { noHost(); }
});

test('H3 归档不覆盖旧记录：第二次归档是「多加一段」，不是「换掉上一段」', () => {
  const { data } = mkAlbumData({});
  try {
    withHost(chatOf());
    const a = data.archiveChat({ title: '第一段' });
    const b = data.archiveChat({ title: '第二段' });
    assert.equal(a.ok, true);
    assert.equal(b.ok, true);
    const ledger = data.replayLedger();
    assert.equal(ledger.count, 2, '两段都必须在（覆盖掉一段等于静默删档）');
    const titles = ledger.rows.map((r) => r.title).sort();
    assert.deepEqual(titles, ['第一段', '第二段'].sort());
  } finally { noHost(); }
});

test('H4 写不下去就如实报失败：存储拒绝 / 台账坏掉，两条都不许说「归档好了」', () => {
  try {
    withHost(chatOf());
    /* ① 存储拒绝 */
    globalThis.window = { VirtualPhone: {} };
    const badStore = {
      _mem: new Map(),
      get(k, d) { return this._mem.has(k) ? this._mem.get(k) : d; },
      set() { return false; }
    };
    const bad = new AlbumData(badStore);
    const r1 = bad.archiveChat({ title: 'x' });
    assert.equal(r1.ok, false, '写不进去必须报失败');
    assert.equal(r1.state, 'write_failed');
    assert.equal(bad.replayLedger().count, 0, '盘上没有就是没有（不许被念成「已归档」）');

    /* ② 台账坏掉时不许盲写：写下去会把一份坏档静默覆盖成「只有这一段」。 */
    const bj = mkAlbumData({ [REPLAY_LEDGER_KEY]: '{坏 json' }).data;
    const r2 = bj.archiveChat({ title: 'y' });
    assert.equal(r2.ok, false);
    assert.equal(r2.state, 'ledger_unreadable');
    assert.match(r2.note, /覆盖/);
  } finally { noHost(); }
});

test('H5 归档只截取、不生成：perspectives 恒空、location 恒空（这两格最容易顺手编）', () => {
  try {
    withHost(chatOf());
    const { data } = mkAlbumData({});
    const r = data.archiveChat({ title: 'z', perAct: 4 });
    const prog = data.getProgram(r.programId);
    for (const act of prog.acts) {
      assert.deepEqual(act.perspectives, {}, '★ 归档不许代写任何人的内心（聊天记录没有这一层）');
      assert.equal(act.location, '', '归档不许编地点（消息里没有位置信息）');
      /* 公共叙述必须是原文的子串，不是概述。 */
      assert.ok(act.dialogues.some((d) => d.text === act.narrativeSnippet),
        '公共叙述必须是这一段里的原文，不许改成概述');
      assert.equal(act.dialogues.every((d) => d.isPrivate === false), true,
        '归档的对白一律按公开叙述处理（录制方口径）');
    }
  } finally { noHost(); }
});
test('H6 归档入口真接在回看页上（不是只有数据层有方法）', () => {
  const viewSrc = stripComments(read(ALBUM_VIEW_REL));
  assert.match(viewSrc, /chatArchivePreview\(\)/, '回看页必须读一次「可归档多少」');
  assert.match(viewSrc, /archiveChat\(\)/, '回看页的归档按钮必须真调归档');
  assert.match(viewSrc, /album-replay-archive/, '归档按钮要有可点到的 id');
  assert.match(viewSrc, /addEventListener\('click'.*archiveFromUI/s, '按钮必须真绑事件');
  /* 数据层必须真接到宿主对话（不然「可归档 N 幕」永远读不到）。 */
  const dataSrc = stripComments(read(ALBUM_DATA_REL));
  assert.match(dataSrc, /SillyTavern\.getContext/, '归档必须从宿主读对话（本仓 82 处在用的通用口）');
  assert.match(dataSrc, /recordLifeProgram\(/, '归档必须真调内核写入（不是自己拼一个台账结构）');
});

test('H7 归档真走中枢的 replayLifeExperience（中枢在场时必须用它，缺席才回落内核）', () => {
  const { data } = mkAlbumData({});
  try {
    withHost(chatOf());
    /* 记录中枢被怎么调的：签名是 `(state, programSpec, actIndex, characterId)`。 */
    let called = null;
    globalThis.window = {
      VirtualPhone: {
        subsystems: {
          replayLifeExperience(state, spec, actIdx, charId) {
            called = { stateKeys: Object.keys(state || {}), title: spec && spec.title, actIdx, charId };
            return { recorded: { success: true, program: { id: 'from_hub', title: spec.title, acts: spec.acts } } };
          }
        }
      }
    };
    const r = data.archiveChat({ title: '走中枢', perAct: 3 });
    assert.equal(r.ok, true, '中枢在场时归档要成功：' + r.note);
    assert.equal(r.programId, 'from_hub', '★ 归档必须用中枢给的 program（不是自己再录一遍）');
    assert.ok(called, '中枢方法必须真的被调用过（这就是「产品端零调用」要解决的那一格）');
    assert.equal(called.title, '走中枢');
    assert.equal(called.actIdx, 1, '取第一幕的视角（归档后默认停在第 1 幕）');
    assert.equal(called.charId, '林晚照', '视角取第一句的说话人');
    assert.deepEqual(called.stateKeys.sort(), ['programs', 'updatedAt'], '交给中枢的是台账状态本体');
  } finally { noHost(); }
});

test('H8 中枢这一步抛错 ⇒ 回落到内核直调，仍然真归档（不是静默失败、也不是静默成功）', () => {
  const { data } = mkAlbumData({});
  try {
    withHost(chatOf());
    globalThis.window = {
      VirtualPhone: { subsystems: { replayLifeExperience() { throw new Error('hub_boom'); } } }
    };
    const r = data.archiveChat({ title: '回落' });
    assert.equal(r.ok, true, '中枢坏了不该让归档整个失败：' + r.note);
    const ledger = data.replayLedger();
    assert.equal(ledger.count, 1, '回落后必须真把这一段写进去');
    assert.equal(ledger.rows[0].title, '回落');
    /* 回落用的是**同一个内核**：幕数/句数与原对话一致。 */
    const prog = data.getProgram(r.programId);
    assert.equal(prog.acts.reduce((n, a) => n + a.dialogues.length, 0), 9);
  } finally { noHost(); }
});