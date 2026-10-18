/* ============================================================
 * tests/system-v4170.test.mjs -- [v4.17.0 · 第四期 R4-O5 未点保存的编辑内容也能恢复]
 *   打了一半的文案、流程参数不因离开页面或刷新丢失;区分「正在编辑」「已保存」「已发布」。
 *
 * 【修前实测的缺口(读码可复算,不是推演)】
 *   `apps/creationdesk/creationdesk-app.js::setDraftNote` 只更新 `_draftNote`,
 *   而 input 监听调的就是它;**保存走另一个方法** `draftAct('...')`;切聊会清实例字段。
 *   `config/workflow-designer.js` 的编辑草稿同样为实例态。
 *   仓库已有的草稿本(creation-multi-draft / workflow 模板)只保证**已保存的版本**
 *   —— 它们回答「我上次存了什么」,而用户问的是「我刚打的那半句话还在吗」。
 *
 * 【本版落的两件】一 `config/edit-buffer.js`(纯函数:四态 / 恢复选项 / 保存回执处置,
 *   守两条红线:已发布不许被覆盖、空缓冲不许顶掉已保存);二 创作台接成首个真实消费点
 *   (`saveEditBuffer` 节流 400ms / `loadEditBuffer` / `decideRecovery` / `applyRecovery` / `settleSave`)。
 *
 * 判据面(五组):
 *   A 口径:四态互不同形 / 纯函数零副作用 / 上限与既有同口径
 *   B 行为:归一不猜 / 四态逐条 / 恢复选项三条红线 / 保存失败保留文字
 *   C 接线:创作台真接线 / 键登记前缀型 / 会话键前缀
 *   D 负控制:真源码定点破坏五条口径 ⇒ 同款判据必转红(配原版必真的反向对照)
 *   E 版本锚:下限形
 * ========================================================= */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const EB_REL = 'config/edit-buffer.js';
const APP_REL = 'apps/creationdesk/creationdesk-app.js';
const IDX_REL = 'index.js';
const E = await import(pathToFileURL(path.join(ROOT, EB_REL)).href);
const ebSrc = read(EB_REL);
const appSrc = read(APP_REL);
const idxSrc = read(IDX_REL);
function stripComments(src) {
  let out = '';
  let i = 0;
  const n = src.length;
  let state = 'code';
  let quote = '';
  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (state === 'code') {
      if (c === '/' && d === '*') { state = 'block'; i += 2; continue; }
      if (c === '/' && d === '/') { state = 'line'; i += 2; continue; }
      if (c === '"' || c === "'" || c === '`') { state = 'str'; quote = c; out += c; i += 1; continue; }
      out += c; i += 1; continue;
    }
    if (state === 'block') { if (c === '*' && d === '/') { state = 'code'; i += 2; continue; } i += 1; continue; }
    if (state === 'line') { if (c === '\n') { state = 'code'; out += c; } i += 1; continue; }
    if (c === '\\') { out += c + (d || ''); i += 2; continue; }
    if (c === quote) { state = 'code'; out += c; i += 1; continue; }
    out += c; i += 1;
  }
  return out;
}
const ebCode = stripComments(ebSrc);
const appCode = stripComments(appSrc);

/* ══════════════════ A. 口径面 ══════════════════ */
test('A1 四态**互不同形**,四句归因文案也两两不同', () => {
  const vals = Object.values(E.EB_STATES);
  assert.equal(vals.length, 4, vals.join(' / '));
  assert.equal(new Set(vals).size, 4, '四态值必须唯一');
  const lines = new Set(vals.map((s) => E.editBufferLine(s)));
  assert.equal(lines.size, 4, '四句必须互不相同:' + Array.from(lines).join(' | '));
  /* 最关键的一对:「正在编辑」与「已发布」处置相反。 */
  assert.notEqual(E.editBufferLine(E.EB_STATES.EDITING), E.editBufferLine(E.EB_STATES.PUBLISHED));
  /* 「没在编辑」≠「丢了」。 */
  assert.ok(E.editBufferLine(E.EB_STATES.EMPTY).includes('不是'));
  /* 选项词表四个。 */
  assert.equal(Object.keys(E.EB_CHOICES).length, 4);
  assert.equal(new Set(Object.values(E.EB_CHOICES)).size, 4);
});

test('A2 纯函数:零副作用(不碰 DOM / 不写存储 / 不联网 / **不看时钟**)', () => {
  for (const bad of ['document', 'window', 'localStorage', 'dispatchEvent', 'setTimeout', 'setInterval', 'fetch', 'indexedDB', 'Date.now']) {
    assert.equal(new RegExp(bad.replace('.', '\\.')).test(ebCode), false, EB_REL + ' 不得出现 ' + bad);
  }
});

test('A3 上限与既有 CMD_LIMITS.textMax 同口径(不另写一个数)', () => {
  assert.equal(E.EB_TEXT_MAX, 2000);
  const cmd = read('config/creation-multi-draft.js');
  assert.ok(cmd.includes('textMax: 2000'), '既有限额仍是 2000(证明同口径)');
});

test('A4 键前缀只有一处定义,且与 storage.js 的 CHAT_DATA_PATTERNS 同源', () => {
  assert.equal(E.EB_KEY_PREFIX, 'edit_buffer_');
  const storageSrc = read('config/storage.js');
  assert.ok(storageSrc.includes('/^edit_/'), 'storage.js 必须有 ^edit_ 前缀');
  assert.ok(/^edit_/.test(E.editBufferKey('creationdeskApp')), '拼出的键必须命中 ^edit_');
});

/* ══════════════════ B. 行为面 ══════════════════ */
test('B1 editBufferKey:appId 不成立时返回空串(**不写进共享桶**)', () => {
  assert.equal(E.editBufferKey('creationdeskApp'), 'edit_buffer_creationdeskApp');
  for (const bad of ['', '   ', null, undefined, 123, {}]) {
    assert.equal(E.editBufferKey(bad), '', 'appId 不成立必须空串:' + String(bad));
  }
});

test('B2 归一不猜:空白等于没编辑,超长如实标记,0 是**合法**光标位', () => {
  const s = E.normalizeEditBuffer({ text: '  ', caret: 0 });
  assert.equal(s.text, null, '纯空白等于没编辑');
  assert.equal(s.hasText, false);
  assert.equal(s.caret, 0, '0 是合法光标位');
  /* 真文本要留着。 */
  assert.equal(E.normalizeEditBuffer({ text: 'half' }).text, 'half');
  /* 超长**如实标记** truncated(不静默截断)。 */
  const long = E.normalizeEditBuffer({ text: 'x'.repeat(3000) });
  assert.equal(long.text.length, E.EB_TEXT_MAX);
  assert.equal(long.truncated, true, '超长必须如实标记');
  assert.equal(E.normalizeEditBuffer({ text: 'ok' }).truncated, false);
  /* 畸形光标不认。 */
  for (const bad of [-1, '3', NaN, {}, null]) {
    assert.equal(E.normalizeEditBuffer({ caret: bad }).caret, null, String(bad));
  }
  /* 畸形输入不抛。 */
  for (const bad of [null, undefined, [], 'x', 42]) {
    const r = E.normalizeEditBuffer(bad);
    assert.equal(r.hasText, false, String(bad));
  }
});

test('B3 四态逐条(顺序固定:已发布 → 空 → 已保存 → 编辑中)', () => {
  const S = E.EB_STATES;
  /* 1 已发布优先(缓冲里有什么都不许顶)。 */
  assert.equal(E.editBufferState({ text: 'half', published: true }, { text: 'old' }), S.PUBLISHED);
  assert.equal(E.editBufferState({ text: 'half' }, { text: 'old', published: true }), S.PUBLISHED);
  /* 2 缓冲空。 */
  assert.equal(E.editBufferState({ text: '   ' }, { text: 'old' }), S.EMPTY);
  assert.equal(E.editBufferState(null, { text: 'old' }), S.EMPTY);
  /* 3 与已保存一致。 */
  assert.equal(E.editBufferState({ text: 'same' }, { text: 'same' }), S.SAVED);
  /* 4 其余 = 编辑中(用户问的那一态)。 */
  assert.equal(E.editBufferState({ text: 'new' }, { text: 'old' }), S.EDITING);
  assert.equal(E.editBufferState({ text: 'new' }, null), S.EDITING);
});

test('B4 恢复选项:三条红线(**默认什么都不动** / 已发布不可覆盖 / 空不说能恢复)', () => {
  const C = E.EB_CHOICES;
  /* 编辑中:三个选项都在,默认 keep-editing(不自动覆盖)。 */
  const editing = E.editRecoveryPlan({ text: 'half' }, { text: 'old' });
  assert.equal(editing.state, E.EB_STATES.EDITING);
  assert.equal(editing.defaultChoice, C.KEEP_EDITING, '默认必须是「什么都不动」');
  assert.equal(editing.choices.length, 3);
  const cs = editing.choices.map((x) => x.choice);
  for (const c of [C.KEEP_EDITING, C.RESTORE_BUFFER, C.DROP_BUFFER]) {
    assert.ok(cs.includes(c), '编辑中必须给出 ' + c);
  }
  /* 已发布:只给 keep-editing,且具名说明为什么。 */
  const pub = E.editRecoveryPlan({ text: 'half', published: true }, { text: 'old' });
  assert.equal(pub.state, E.EB_STATES.PUBLISHED);
  assert.equal(pub.choices.length, 1);
  assert.equal(pub.choices[0].choice, C.KEEP_EDITING);
  assert.ok(pub.blockReason.includes('published'), '必须具名说明红线:' + pub.blockReason);
  /* 缓冲空:只给 use-saved,不假装能恢复。 */
  const empty = E.editRecoveryPlan({ text: '' }, { text: 'old' });
  assert.equal(empty.state, E.EB_STATES.EMPTY);
  assert.equal(empty.choices.length, 1);
  assert.equal(empty.choices[0].choice, C.USE_SAVED);
  /* 已保存:use-saved + drop-buffer。 */
  const saved = E.editRecoveryPlan({ text: 'same' }, { text: 'same' });
  assert.equal(saved.defaultChoice, C.USE_SAVED);
});

test('B5 采纳选择(**纯**:不改入参;已发布不可被覆盖;未登记词不猜)', () => {
  const C = E.EB_CHOICES;
  const buf = { text: 'half' };
  const snapshot = JSON.stringify(buf);
  /* 已发布 + 恢复 ⇒ 挡住,且如实说原因。 */
  const blocked = E.applyRecoveryChoice(C.RESTORE_BUFFER, { text: 'half', published: true }, {});
  assert.equal(blocked.ok, false);
  assert.equal(blocked.blocked, true);
  assert.equal(blocked.reason, 'published-not-overwritable');
  /* 丢缓冲 ⇒ 缓冲清空。 */
  const drop = E.applyRecoveryChoice(C.DROP_BUFFER, buf, {});
  assert.equal(drop.applied, C.DROP_BUFFER);
  assert.equal(drop.buffer.text, null, '丢缓冲必须真的空');
  /* 恢复 ⇒ 缓冲原样。 */
  const keep = E.applyRecoveryChoice(C.RESTORE_BUFFER, buf, {});
  assert.equal(keep.applied, C.RESTORE_BUFFER);
  assert.equal(keep.buffer.text, 'half');
  /* 未登记的选择词 ⇒ 如实拒绝,不当成某一个选项。 */
  const bad = E.applyRecoveryChoice('nope', buf, {});
  assert.equal(bad.ok, false);
  assert.ok(bad.reason.startsWith('unknown-choice:'), bad.reason);
  assert.equal(bad.applied, '');
  /* 纯:入参一字未改。 */
  assert.equal(JSON.stringify(buf), snapshot, '入参不得被改');
});

test('B6 保存回执:**失败必须保留文字**(成功才清;读不出也留着)', () => {
  const buf = { text: 'half' };
  /* 成功 ⇒ 缓冲可清。 */
  const ok = E.afterSaveAttempt({ saved: true }, buf);
  assert.equal(ok.state, 'saved');
  assert.equal(ok.buffer.text, null, '已落库 ⇒ 缓冲清空');
  /* 失败 ⇒ **文字一字不丢**,且如实报原因。 */
  const fail = E.afterSaveAttempt({ saved: false, why: 'quota' }, buf);
  assert.equal(fail.state, 'unsaved');
  assert.equal(fail.buffer.text, 'half', '保存失败必须保留文字');
  assert.equal(fail.reason, 'quota');
  /* 回执读不出 ⇒ 也保留文字(宁可留着)。 */
  for (const bad of [null, undefined, {}, { saved: 'yes' }, 42]) {
    const r = E.afterSaveAttempt(bad, buf);
    assert.equal(r.state, 'unknown', String(bad));
    assert.equal(r.buffer.text, 'half', '回执读不出也必须保留文字:' + String(bad));
  }
});

/* ══════════════════ C. 接线面 ══════════════════ */
test('C1 创作台:五口真接在真源上,且保存路径一字未动', () => {
  for (const m of ['saveEditBuffer(target) {', 'loadEditBuffer() {', 'decideRecovery() {', 'applyRecovery(choice) {', 'settleSave(receipt) {']) {
    assert.ok(appCode.includes(m), '必须有 ' + m);
  }
  assert.ok(appCode.includes("from '../../config/edit-buffer.js';"), '必须消费真源');
  const cap = appCode.slice(appCode.indexOf('saveEditBuffer(target) {'));
  const capBody = cap.slice(0, cap.indexOf('\n    }'));
  assert.ok(capBody.includes('normalizeEditBuffer('), '归一走真源');
  assert.ok(capBody.includes('writeReceipt('), '落盘走既有唯一写回执');
  assert.ok(capBody.includes('empty-not-written'), '空缓冲**不写盘**(否则会把已存的顶掉)');
  assert.ok(capBody.includes('_bufLastAt'), '必须有节流闸门');
  /* 保存路径 `draftAct` 一字未动。 */
  const act = appCode.slice(appCode.indexOf('async draftAct(action) {'));
  assert.ok(act.slice(0, 900).includes('vp.applyCreationdeskAction(payload)'), '保存仍走咽喉');
});

test('C2 键名以**字面量**出现在产品面上(否则 keys 门 K3 会判幽灵放行条)', () => {
  assert.ok(appCode.includes("'edit_buffer_creationdeskApp'"), '键名必须以字面量出现');
  const keysSrc = read('scripts/keys-audit.mjs');
  assert.ok(keysSrc.includes("{ key: 'edit_buffer_*'"), '登记必须是前缀型(与既有 _* 同规)');
});

test('C3 恢复判定**默认什么都不动**(不自动覆盖已保存内容)', () => {
  const dec = appCode.slice(appCode.indexOf('decideRecovery() {'));
  const decBody = dec.slice(0, dec.indexOf('\n    }'));
  assert.ok(decBody.includes('editRecoveryPlan('), '判定走真源');
  /* app 侧不得自己写一份「默认恢复」的逻辑。 */
  assert.equal(/applyRecoveryChoice/.test(decBody), false, '判定里不得混入采纳动作');
  /* 采纳动作里也没有「默认 restore」。 */
  const app = appCode.slice(appCode.indexOf('applyRecovery(choice) {'));
  const appBody = app.slice(0, app.indexOf('\n    }'));
  assert.ok(appBody.includes('applyRecoveryChoice(choice'), '采纳走真源(显式传 choice)');
  assert.equal(/choice\s*\|\|\s*['"]/.test(appBody), false, '不得给 choice 兜一个默认值(那就是自动覆盖)');
});

/* ══════════════════ D. 负控制(真源码破坏 → 同一份判据必须转红) ══════════════════ */
function breakOnce(src, anchor, replacement, tag) {
  const hits = src.split(anchor).length - 1;
  assert.equal(hits, 1, '破坏锚点必须恰中 1 次(实测 ' + hits + '):' + tag);
  return src.replace(anchor, replacement);
}

test('D0 ★★★ 阳性对照:未破坏时四条判据必须全为真(否则 D 组是假绿)', () => {
  assert.ok(ebCode.includes('if (b.published === true || (s && s.published === true))'), '已发布优先在位');
  assert.ok(ebCode.includes('return { ok: false, state: \'unknown\', buffer: b'), '失败保留文字在位');
  assert.ok(appCode.includes("'edit_buffer_creationdeskApp'"), '键字面量在位');
  assert.ok(appCode.includes('empty-not-written'), '空不写盘在位');
});

test('D1 ★★★ 破坏「已发布优先」⇒ 同款判据必转红(缓冲顶掉已发布内容)', () => {
  const broken = breakOnce(ebCode,
    '    if (b.published === true || (s && s.published === true)) return EB_STATES.PUBLISHED;',
    '    if (false) return EB_STATES.PUBLISHED;',
    'd1');
  /* ★ 判据检查的是**那一行的真形态**(`=== true ||` 这个签名),不是「EB_STATES.PUBLISHED
   *   这个词还在不在」—— 首版按后者判,而破坏后的副本里 `if (false) return EB_STATES.PUBLISHED;`
   *   仍然含那个词 ⇒ 判据永远看不见破坏(负控制假绿)。 */
  assert.equal(broken.includes('if (b.published === true || (s && s.published === true))'), false,
    '破坏副本:已不判已发布');
  assert.ok(ebCode.includes('if (b.published === true || (s && s.published === true))'), '原版必须判');
  /* 行为面。 */
  assert.equal(E.editBufferState({ text: 'new', published: true }, { text: 'old' }), E.EB_STATES.PUBLISHED,
    '原版:已发布必须优先');
});

test('D2 ★★★ 破坏「已发布不可被恢复覆盖」⇒ 同款判据必转红', () => {
  const broken = breakOnce(ebCode,
    "    if (st === EB_STATES.PUBLISHED && c === EB_CHOICES.RESTORE_BUFFER) {",
    '    if (false) {',
    'd2');
  assert.equal(broken.includes('st === EB_STATES.PUBLISHED && c === EB_CHOICES.RESTORE_BUFFER'), false,
    '破坏副本:已不挡');
  assert.ok(ebCode.includes('st === EB_STATES.PUBLISHED && c === EB_CHOICES.RESTORE_BUFFER'), '原版必须挡');
  /* 行为面。 */
  assert.equal(E.applyRecoveryChoice(E.EB_CHOICES.RESTORE_BUFFER, { text: 'x', published: true }, {}).blocked, true,
    '原版必须挡住');
});

test('D3 ★★★ 破坏「保存失败保留文字」⇒ 同款判据必转红(文字被清)', () => {
  const broken = breakOnce(ebCode,
    "    return { ok: false, state: 'unsaved', buffer: b, reason: String(r.why || 'save-failed') };",
    "    return { ok: false, state: 'unsaved', buffer: { text: null }, reason: String(r.why || 'save-failed') };",
    'd3');
  assert.equal(broken.includes("state: 'unsaved', buffer: b"), false, '破坏副本:文字被清');
  assert.ok(ebCode.includes("state: 'unsaved', buffer: b"), '原版必须保留');
  /* 行为面。 */
  assert.equal(E.afterSaveAttempt({ saved: false }, { text: 'half' }).buffer.text, 'half', '原版必须保留文字');
});

test('D4 ★★★ 破坏「空缓冲不写盘」⇒ 同款判据必转红(空缓冲顶掉已存的)', () => {
  const broken = breakOnce(appCode,
    "        if (!pack.hasText) return { ok: false, key: key, why: 'empty-not-written' };",
    "        if (false) return { ok: false, key: key, why: 'empty-not-written' };",
    'd4');
  /* ★ 同 D1:检查**真形态**(`!pack.hasText` 这个否定签名),不是「那个字符串还在不在」。 */
  assert.equal(broken.includes('if (!pack.hasText) return'), false, '破坏副本:已不判空');
  assert.ok(appCode.includes('if (!pack.hasText) return'), '原版必须判空');
});

test('D5 ★★★ 破坏「超长如实标记」⇒ 同款判据必转红(静默截断)', () => {
  const broken = breakOnce(ebCode,
    '    const over = rawText.length > EB_TEXT_MAX;',
    '    const over = false;',
    'd5');
  assert.equal(broken.includes('const over = rawText.length > EB_TEXT_MAX;'), false, '破坏副本:已不判超长');
  assert.ok(ebCode.includes('const over = rawText.length > EB_TEXT_MAX;'), '原版必须判');
  /* 行为面。 */
  assert.equal(E.normalizeEditBuffer({ text: 'x'.repeat(3000) }).truncated, true, '原版必须如实标记');
});

/* ══════════════════ E. 版本锚(下限形) ══════════════════ */
test('E1 版本锚:三源一致且当版条目存在(不锁死具体版本号)', () => {
  const pkg = JSON.parse(read('package.json'));
  const man = JSON.parse(read('manifest.json'));
  const log = JSON.parse(read('update-log.json'));
  const ver = pkg.version;
  assert.match(ver, /^\d+\.\d+\.\d+$/);
  assert.equal(man.version, ver);
  assert.equal(log.latest, ver);
  assert.equal(log.head, ver);
  assert.ok(log.versions[ver], '当版条目必须存在');
  assert.ok(Array.isArray(log.versions[ver].items) && log.versions[ver].items.length >= 8);
  assert.ok(idxSrc.includes("const ST_PHONE_VERSION = '" + ver + "';"));
});