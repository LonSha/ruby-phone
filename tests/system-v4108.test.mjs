/* ============================================================
 * tests/system-v4108.test.mjs — R13-O5 验收套件（设置项生效时机）
 * ------------------------------------------------------------
 * 立项现象（计划书原话）：`apps/settings/settings-app.js` 12XXX 行里，写到
 *   「生效时机」四个字的地方只有个位数。用户把开关拨过去，界面没有任何一处
 *   回答「它现在生效了，还是下一轮才生效，还是得重开手机」。这不是文案缺失，
 *   是**语义从未被声明** —— 于是同一个仓库里的开关事实上分成三类，而三类
 *   长得一模一样。
 *
 * 本套件守五件事（三档语义必须由真行为证明，不许只写文案）：
 *   A 组：三档闭集 + 逐项登记 + 未声明与三档**不同形**（不猜默认）
 *   B 组：三档语义**双向**真证明
 *        · immediate    改完立即读回**必须变**
 *        · next-turn    改完立即读回**必须不变**；走过一轮后读回**必须变**
 *        · next-session 改完立即读回**不变**；重建会话后读回**必须变**
 *        · 交叉面：轮次推进**不许**带走 next-session；会话推进**不许**带走 next-turn
 *   C 组：覆盖率 **100%**（设置页真控件逐项登记，缺一项即红；另防幽灵条目虚高）
 *   D 组：待生效区不许回落实源（`peek` 没有就返回 undefined，不拿真源值冒充）
 *   E 组：四向负控制（真源码破坏 → 判据必须转红）
 *
 * 纪律：36 项做完前不跑全量；本套件单点可复现（`node tests/system-v4108.test.mjs`）。
 *
 * 【诚实边界】本组只守「时机声明与执行」，不守「某个开关放在哪一档更合理」——
 *   那是对产品的判断。故 C3 只断言三档各自都有真控件，不断言具体某项非在某档不可。
 * ============================================================ */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  EFFECT_AT,
  EFFECT_AT_TEXT,
  EFFECT_AT_UNKNOWN,
  SETTING_EFFECT,
  effectAtOf,
  effectWhyOf,
  effectLine,
  PendingEffects,
  applyChange
} from '../config/setting-effect.js';
import { stageTreeWithDeps } from './_stage-tree.mjs';

const __dir = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dir, '..');
const rd = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

/* ------------------------------------------------------------
 * A 组：闭集 + 登记 + 未声明与三档不同形
 * ------------------------------------------------------------ */
test('A1: 三档是闭集，且逐档都有人话（不许出现第四档）', () => {
  const keys = Object.keys(EFFECT_AT);
  assert.deepEqual(keys.sort(), ['immediate', 'next-session', 'next-turn'], '三档闭集不许增删');
  for (const k of keys) {
    assert.equal(EFFECT_AT[k], k, '键值必须同名（否则登记表写的东西与判据读的东西不是一回事）');
    assert.ok(String(EFFECT_AT_TEXT[k] || '').length >= 4, `档 ${k} 必须有人话文案`);
  }
  /* 「时机未声明」不许与任何一档的文案或键名同形 —— 否则界面上「没声明」
     会看起来像「声明了某一档」，黄标就失效了。 */
  const texts = Object.values(EFFECT_AT_TEXT);
  for (const t of texts) assert.notEqual(EFFECT_AT_UNKNOWN, t, '未声明文案不许与任何一档同形');
  for (const k of keys) assert.notEqual(EFFECT_AT_UNKNOWN, k, '未声明文案不许等于档名');
});

test('A2: 登记表逐项带 {at, why}，且未登记项一律返回 null（不猜默认）', () => {
  const rows = Object.entries(SETTING_EFFECT);
  assert.ok(rows.length >= 100, '登记项应达三位数，实测 ' + rows.length);
  for (const [key, row] of rows) {
    assert.ok(key && typeof key === 'string', '键名必须是非空字符串');
    assert.ok(Object.prototype.hasOwnProperty.call(EFFECT_AT, row.at), `${key} 的 at=${row.at} 不在闭集内`);
    assert.ok(String(row.why || '').length >= 6, `${key} 的理由太短（等于没写）：${row.why}`);
    /* 理由里不许出现前向引用（「同上」）—— 读到这一条的人拿不到上一条。 */
    assert.ok(!/同上/.test(row.why), `${key} 的理由用了前向引用「同上」，等于没有说明`);
  }
  assert.equal(effectAtOf('this-key-does-not-exist'), null, '未登记必须返回 null，不许猜 immediate');
  assert.equal(effectWhyOf('this-key-does-not-exist'), '', '未登记不许编理由');
  assert.equal(effectLine('this-key-does-not-exist'), EFFECT_AT_UNKNOWN, '未登记必须给「时机未声明」');
  assert.equal(effectAtOf(''), null, '空键返回 null');
  assert.equal(effectAtOf(null), null, 'null 键返回 null');
});

test('A3: 本模块是零依赖叶子（谁都可引用而不造出环）', () => {
  const src = rd('config/setting-effect.js');
  const imports = [...src.matchAll(/^\s*import\s/gm)];
  assert.equal(imports.length, 0, '不许 import 任何东西（它是叶子，引用它等于引用一个纯字典）');
  assert.ok(!/\brequire\s*\(/.test(src), '不许 require');
});

/* ------------------------------------------------------------
 * B 组：三档语义双向真证明（这是本项的核心，不许只写文案）
 * ------------------------------------------------------------
 * 用一个「真源」变量扮演 storage：reader 读它、writer 写它。
 * 三档的差别只应体现在「writer 有没有被立刻调用」。
 * ------------------------------------------------------------ */
function mkWorld() {
  const store = { 'next-turn-key': 'old', 'next-session-key': 'old', 'immediate-key': 'old', 'unknown-key': 'old' };
  const pending = new PendingEffects();
  const reader = (k) => store[k];
  const writer = (k, v) => { store[k] = v; };
  const flush = (items) => { for (const it of items) store[it.key] = it.value; };
  return { store, pending, reader, writer, flush };
}

/* 三档各挑一个**登记表里真实存在**的键，避免判据自己造出「假档位」。 */
const REAL = {
  immediate: Object.entries(SETTING_EFFECT).find(([, r]) => r.at === 'immediate')[0],
  'next-turn': Object.entries(SETTING_EFFECT).find(([, r]) => r.at === 'next-turn')[0],
  'next-session': Object.entries(SETTING_EFFECT).find(([, r]) => r.at === 'next-session')[0]
};

test('B1: immediate —— 改完立即读回必须变，且待生效区不许留账', () => {
  const w = mkWorld();
  const r = applyChange({ key: REAL.immediate, value: 'new', reader: w.reader, writer: w.writer, pending: w.pending });
  assert.equal(r.at, 'immediate');
  assert.equal(r.wrote, true, 'immediate 必须当场写');
  assert.equal(w.reader(REAL.immediate), 'new', '立即读回必须已经是新值');
  assert.equal(w.pending.has(REAL.immediate), false, 'immediate 不许记账（记账会让读回读到旧值）');
  /* 推进器不许回写 —— 它账上根本没有这一项 */
  assert.deepEqual(w.pending.commitTurn(), [], '轮次推进不许带出 immediate 项');
  assert.deepEqual(w.pending.commitSession(), [], '会话推进不许带出 immediate 项');
});

test('B2: next-turn —— 双向：改完立即不变 → 走一轮后变 → 再推不重复写', () => {
  const w = mkWorld();
  const r = applyChange({ key: REAL['next-turn'], value: 'new', reader: w.reader, writer: w.writer, pending: w.pending, turn: 7 });
  assert.equal(r.at, 'next-turn');
  assert.equal(r.wrote, false, 'next-turn 不许当场写');
  assert.equal(w.reader(REAL['next-turn']), undefined === undefined ? w.store[REAL['next-turn']] : null, '占位断言：读原值');
  assert.notEqual(w.store[REAL['next-turn']], 'new', '★ 改完立即读回必须**不变**（这一半最容易被跳过）');
  assert.equal(w.pending.has(REAL['next-turn']), true, '必须记在待生效区');
  assert.equal(w.pending.peek(REAL['next-turn']), 'new', '待生效区里应是新值');

  const out = w.pending.commitTurn();
  assert.equal(out.length, 1, '走一轮后必须交出一项');
  assert.equal(out[0].key, REAL['next-turn']);
  w.flush(out);
  assert.equal(w.store[REAL['next-turn']], 'new', '★ 走一轮后读回必须**变**');
  assert.deepEqual(w.pending.commitTurn(), [], '同一项不许被重复交出（第二推必须空）');
});

test('B3: next-session —— 双向 + 交叉面：轮次推进不许带走 next-session', () => {
  const w = mkWorld();
  const r = applyChange({ key: REAL['next-session'], value: 'new', reader: w.reader, writer: w.writer, pending: w.pending });
  assert.equal(r.at, 'next-session');
  assert.equal(r.wrote, false, 'next-session 不许当场写');
  assert.notEqual(w.store[REAL['next-session']], 'new', '★ 改完立即读回必须**不变**');

  /* 交叉面：走一轮生成**不该**让 next-session 生效 —— 这是两档最容易串台的地方。 */
  assert.deepEqual(w.pending.commitTurn(), [], '跑一轮不许带走 next-session 项（串台 = 档位形同虚设）');
  assert.notEqual(w.store[REAL['next-session']], 'new', '跑一轮之后仍不许变');

  const out = w.pending.commitSession();
  assert.equal(out.length, 1, '重建会话后必须交出一项');
  w.flush(out);
  assert.equal(w.store[REAL['next-session']], 'new', '★ 重建会话后读回必须**变**');
  assert.deepEqual(w.pending.commitSession(), [], '第二推必须空');
});

test('B4: 两档互不串台 —— 同时挂两笔，各自的推进器只带走自己那一档', () => {
  const w = mkWorld();
  applyChange({ key: REAL['next-turn'], value: 'T', reader: w.reader, writer: w.writer, pending: w.pending });
  applyChange({ key: REAL['next-session'], value: 'S', reader: w.reader, writer: w.writer, pending: w.pending });
  const t = w.pending.commitTurn();
  assert.deepEqual(t.map((x) => x.key), [REAL['next-turn']], '轮次推进只交 next-turn');
  assert.equal(w.pending.has(REAL['next-session']), true, 'next-session 必须还留着');
  const s = w.pending.commitSession();
  assert.deepEqual(s.map((x) => x.key), [REAL['next-session']], '会话推进只交 next-session');
  assert.equal(w.pending.list().length, 0, '两推过后账上应清空');
});

test('B5: 未登记项 —— 按既有行为当场写（不许静默失效），但 at 必须为 null 好挂黄标', () => {
  /* 为什么不是「未登记就拒绝写」：那会让一个漏登记的开关**静默失效**，
     比「立即生效但没声明」糟得多 —— 前者用户以为改了没反应，后者只是少一行提示。 */
  const w = mkWorld();
  const r = applyChange({ key: 'unknown-key', value: 'new', reader: w.reader, writer: w.writer, pending: w.pending });
  assert.equal(r.wrote, true, '未登记必须保持既有行为（当场写），不许静默吞掉');
  assert.equal(w.store['unknown-key'], 'new', '真源必须真的被写');
  assert.equal(r.at, null, '★ at 必须是 null —— 这就是界面上那个黄标的依据');
  assert.equal(w.pending.has('unknown-key'), false, '未登记项不许混进待生效区');
});

/* ------------------------------------------------------------
 * C 组：覆盖率 100%
 * ------------------------------------------------------------
 * 口径（写死在判据里，免得下次重新讨论）：设置页里**用户能拨的控件**才算设置项。
 *   · 用 `<input|select|textarea>` 抽，只认带 `id` 的（id 是它在代码里唯一稳定名字）；
 *   · `type=file` 是文件选择器，选的是「这次要上传的文件」不是设置值 ⇒ 不算；
 *   · `phone-image-preset-share-text` 是导出用的只读展示容器 ⇒ 不算；
 *   · 其余全是设置项，缺一项即红，另防幽灵（登记了但设置页里没有）。
 * ------------------------------------------------------------ */
const NON_SETTING_IDS = [
  'upload-wallpaper', 'upload-card-time-image',
  'phone-tts-nimo-clone-audio', 'phone-tts-volc-clone-audio',
  'phone-image-prompt-preset-import-file', 'phone-image-openai-preset-import-file',
  'phone-image-comfyui-workflow-import-file', 'phone-image-novelai-vibe-file',
  'phone-image-preset-share-text'
];

function collectSettingIds() {
  const src = rd('apps/settings/settings-app.js');
  const ids = new Set();
  for (const m of src.matchAll(/<(input|select|textarea)\b[^>]*>/g)) {
    const tag = m[0];
    const im = tag.match(/\bid\s*=\s*["']([A-Za-z0-9_-]+)["']/);
    if (!im) continue;
    const tm = tag.match(/type\s*=\s*["']([a-z]+)["']/);
    if (tm && tm[1] === 'file') continue;
    if (NON_SETTING_IDS.includes(im[1])) continue;
    ids.add(im[1]);
  }
  return ids;
}

test('C1: 覆盖率 100% —— 设置页每个真控件都必须登记（缺一项即红），且不许幽灵条目', () => {
  const ids = collectSettingIds();
  assert.ok(ids.size >= 100, '设置页真控件应达三位数，实测 ' + ids.size);
  const registered = new Set(Object.keys(SETTING_EFFECT));
  const missing = [...ids].filter((x) => !registered.has(x)).sort();
  const ghost = [...registered].filter((x) => !ids.has(x)).sort();
  assert.deepEqual(missing, [], '这些真控件没有时机声明（缺一项即红）：' + missing.join(' '));
  assert.deepEqual(ghost, [], '这些登记项在设置页里已不存在（幽灵条目会虚高覆盖率）：' + ghost.join(' '));
});

test('C2: 非设置项清单必须逐条真在设置页里存在（防清单过期替真控件的缺失打掩护）', () => {
  const src = rd('apps/settings/settings-app.js');
  for (const id of NON_SETTING_IDS) {
    assert.ok(src.includes(id), `非设置项 ${id} 在设置页里已不存在 ⇒ 清单过期，必须撤掉`);
  }
  /* 八个 file 必须是真 file 输入（不是随便挑的好看名字） */
  const fileIds = [...src.matchAll(/<input\b[^>]*>/g)]
    .filter((m) => /type\s*=\s*["']file["']/.test(m[0]))
    .map((m) => (m[0].match(/\bid\s*=\s*["']([A-Za-z0-9_-]+)["']/) || [])[1])
    .filter(Boolean);
  for (const id of NON_SETTING_IDS.filter((x) => x !== 'phone-image-preset-share-text')) {
    assert.ok(fileIds.includes(id), `${id} 必须是真 type=file 输入`);
  }
  assert.ok(NON_SETTING_IDS.includes('phone-image-preset-share-text'), '分享文本框必须显式进非设置项清单');
});

test('C3: 三档各自都有真控件（不许某档只是空壳闭集）', () => {
  const byAt = { immediate: [], 'next-turn': [], 'next-session': [] };
  for (const [k, r] of Object.entries(SETTING_EFFECT)) byAt[r.at].push(k);
  for (const [at, arr] of Object.entries(byAt)) {
    assert.ok(arr.length >= 3, `档 ${at} 只有 ${arr.length} 项，不足 3 项（该档等于没落地）`);
  }
  const ids = collectSettingIds();
  for (const [at, arr] of Object.entries(byAt)) {
    assert.ok(arr.some((k) => ids.has(k)), `档 ${at} 里一个真控件都没有（全是幽灵条目）`);
  }
});

/* ------------------------------------------------------------
 * D 组：待生效区不许回落实源
 * ------------------------------------------------------------ */
test('D1: peek 没有待生效项时返回 undefined，不拿真源值冒充', () => {
  const p = new PendingEffects();
  assert.equal(p.peek('whatever'), undefined, '待生效区只回答「账上有没有」，读真源是 reader 的事');
  assert.equal(p.has('whatever'), false);
  p.stage('whatever', 1, { at: 'next-turn' });
  assert.equal(p.peek('whatever'), 1);
  p.clear();
  assert.equal(p.peek('whatever'), undefined, '清空后必须回到 undefined');
});

test('D2: list() 给出 atTurn，诊断面看得出来「这是第几轮记下的」', () => {
  const p = new PendingEffects();
  p.stage('k1', 'v1', { at: 'next-turn', turn: 12 });
  p.stage('k2', 'v2', { at: 'next-session' });
  const rows = p.list().sort((a, b) => a.key.localeCompare(b.key));
  assert.equal(rows.length, 2);
  assert.equal(rows[0].key, 'k1');
  assert.equal(rows[0].atTurn, 12);
  assert.equal(rows[1].atTurn, null, '没给轮次就记 null（不编一个 0）');
});

test('D3: 同一项后写覆盖先写（只留一条，不许越记越多）', () => {
  const p = new PendingEffects();
  p.stage('k', 'v1', { at: 'next-turn' });
  p.stage('k', 'v2', { at: 'next-turn' });
  assert.equal(p.list().length, 1, '同一项只留一条');
  assert.equal(p.peek('k'), 'v2', '留的是后写的那个值');
});

/* ------------------------------------------------------------
 * E 组：四向负控制（真源码破坏 → 判据必须转红）
 * ------------------------------------------------------------
 * 副本必须落在 `config/` 下：模块是零 import，但将来若加 import，相对解析
 *   仍按「与原文件同目录」走 —— 位置错了这里会先骗过自己。
 * ------------------------------------------------------------ */
function brokenCopy(transform) {
  const src = rd('config/setting-effect.js');
  const broken = transform(src);
  assert.notEqual(broken, src, '破坏锚点必须命中（不命中等于没破坏）');
  const dir = stageTreeWithDeps({ 'config/setting-effect-broken.js': broken }, { prefix: 'v4108-neg-', root: ROOT });
  assert.deepEqual(dir.missing, [], '临时树必须补齐依赖，否则验的是「树全不全」而不是「判据灵不灵」');
  return { dir, file: path.join(dir.dir, 'config', 'setting-effect-broken.js') };
}

function probeImport(file) {
  return import(pathToFileUrl(file));
}
import { pathToFileURL as _pfu } from 'node:url';
function pathToFileUrl(p) { return _pfu(p).href; }

test('E1: 把 next-turn 的执行当成 immediate（当场写）⇒ B2 那条「立即不变」必须转红', async () => {
  const t = brokenCopy((s) => s.replace("if (at === 'immediate' || at === null) {", "if (at === 'immediate' || at === 'next-turn' || at === null) {"));
  const m = await probeImport(t.file);
  const store = { k: 'old' };
  const pending = new m.PendingEffects();
  const key = Object.keys(m.SETTING_EFFECT).find((x) => m.effectAtOf(x) === 'next-turn');
  m.applyChange({ key, value: 'new', reader: (k) => store.k, writer: (k, v) => { store.k = v; }, pending });
  assert.equal(store.k, 'new', '★ 破坏版必须让 next-turn 当场写（证明判据真的依赖那条分支）');
});

test('E2: 把 commitTurn 改成连 next-session 一起交 ⇒ B3 交叉面必须转红', async () => {
  const t = brokenCopy((s) => s.replace('return this._drain(\'next-turn\');', 'return this._drain(\'next-session\');'));
  const m = await probeImport(t.file);
  const p = new m.PendingEffects();
  const key = Object.keys(m.SETTING_EFFECT).find((x) => m.effectAtOf(x) === 'next-session');
  p.stage(key, 'new', { at: 'next-session' });
  assert.equal(p.commitTurn().length, 1, '★ 破坏版必须让跑一轮就带走 next-session（串台必须被逮到）');
});

test('E3: 把 effectLine 的未登记分支改成与 immediate 同形 ⇒ A2 必须转红', async () => {
  const t = brokenCopy((s) => s.replace('if (at === null) return EFFECT_AT_UNKNOWN;', 'if (at === null) return EFFECT_AT_TEXT.immediate;'));
  const m = await probeImport(t.file);
  assert.equal(m.effectLine('this-key-does-not-exist'), m.EFFECT_AT_TEXT.immediate, '★ 破坏版必须让「未声明」看起来像「立即生效」（黄标失效）');
});

test('E4: 把 stage 的 immediate 分支去掉（连 immediate 也记账）⇒ B1 必须转红', async () => {
  const t = brokenCopy((s) => s.replace("if (at === 'immediate') return { ok: true, mode: 'immediate', key: k };", "if (at === 'never') return { ok: true, mode: 'immediate', key: k };"));
  const m = await probeImport(t.file);
  const p = new m.PendingEffects();
  const key = Object.keys(m.SETTING_EFFECT).find((x) => m.effectAtOf(x) === 'immediate');
  const r = p.stage(key, 'new', { at: 'immediate' });
  assert.equal(r.mode, 'pending', '记账后回执从 immediate 变成 pending（回执与 has() 两个面都应有反应）');
  assert.equal(p.has(key), true, '★ 破坏版必须让 immediate 也进待生效区（B1 的「不许记账」就是抓这个）');
});

/* ------------------------------------------------------------
 * F 组：真接线（本仓反复付费的形态：函数写好了、零调用点）
 * ------------------------------------------------------------ */
test('F1: 设置页真的走统一口（三档各至少一处调用点，不是只有工具函数）', () => {
  const src = rd('apps/settings/settings-app.js');
  assert.ok(src.includes('applyChange'), '必须 import applyChange（否则统一口接不上）');
  assert.ok(src.includes('async _applySettingChange('), '统一口必须有定义');
  const calls = src.split('this._applySettingChange(').length - 1;
  assert.equal(calls, 3, '统一口必须恰好 3 处真接线（三档各一），实测 ' + calls);
  const must = [
    'setting-wechat-message-sound-enabled',
    'phone-user-message-listener-enabled',
    'phone-honey-tts-enabled'
  ];
  for (const k of must) {
    assert.ok(effectAtOf(k) !== null, k + ' 必须已登记（未登记就接线也只是当场写，等于没分档）');
    assert.ok(src.includes(k), k + ' 必须还在设置页里');
    /* 监听的键名形态允许两种：控件 id 字面量，或老常量（真源键与控件 id 不同名是既有事实）*/
    const forms = ['_applySettingChange(' + String.fromCharCode(39) + k + String.fromCharCode(39) + ',', '_applySettingChange(' + k + ','] ;
    assert.ok(forms.some((f) => src.includes(f)), k + ' 的监听器必须走统一口（还是老写法 storage.set 就等于没接）');
  }
  /* 真源键与控件 id 不同名的那些项，必须显式传 storageKey —— 否则登记的分档与真正写的键不是同一个东西 */
  assert.ok(/storageKey:\s*WECHAT_MESSAGE_SOUND_ENABLED_KEY/.test(src), '不同名键必须显式传 storageKey（否则分档只是纸面上的）');
  const ats = must.map((k) => effectAtOf(k));
  assert.deepEqual([...new Set(ats)].sort(), ['immediate', 'next-session', 'next-turn'], '三个接线点必须覆盖三档（只接一档等于另外两档没验）');
});

test('F2: 两个推进器真的挂在生命周期上，不是只定义不挂', () => {
  const ij = rd('index.js');
  assert.ok(ij.includes('pumpSettingEffects ='), 'index.js 必须定义推进器');
  /* 定位真钩子：用 event_types.GENERATION_STARTED，而不是裸的 GENERATION_STARTED。
   *   本版就踩了这个坑 —— 版本公告块里写了这个名字，裸串第一次命中的是公告文本。
   *   同理，「距离多少字符以内」不能当判据：抬版加条目会把距离顶爆、在无关改动上误红。 */
  const gi = ij.indexOf('event_types.GENERATION_STARTED');
  assert.ok(gi > 0, 'index.js 必须真的订阅 GENERATION_STARTED');
  const tail = ij.slice(gi);
  const close = tail.indexOf('});');
  assert.ok(close > 0, '订阅处后面必须有回调闭合');
  const body = tail.slice(0, close);
  assert.ok(body.includes('pumpSettingEffects'), 'next-turn 推进器必须就在 GENERATION_STARTED 的回调体内');
  const iPush = ij.indexOf("pumpSettingEffects('session')");
  const iNew = ij.indexOf('new SettingsAppClass(phoneShell, storage, settings)');
  assert.ok(iPush > 0, 'next-session 推进器必须挂在实例重建处');
  assert.ok(iNew > 0, '必须能找到创建实例那一行');
  assert.ok(iPush < iNew, '★ session 推必须发生在创建新实例**之前**（顺序反了 = 重开手机还是旧值）');
});

test('F3: 界面提示真的逐项挂（黄标 = 漏登记的可见出口）', () => {
  const src = rd('apps/settings/settings-app.js');
  assert.ok(src.includes('_renderEffectBadge'), '必须有挂标函数');
  assert.ok(src.includes('input[id], select[id], textarea[id]'), 'bindEvents 末尾必须扫全部带 id 的控件（只挂登记过的就不叫「漏登记可见」）');
  assert.ok(src.includes('时机未声明'), '未登记必须挂明确文案');
});

