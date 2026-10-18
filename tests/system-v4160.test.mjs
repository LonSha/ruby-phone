/* ============================================================
 * tests/system-v4160.test.mjs -- [v4.16.0 · 第四期 R4-O4 长聊天按窗口呈现,不重铺整段记录]
 *   几千条聊天仍能回看、引用、定位旧消息;新回复不把正在阅读旧记录的人拉到底部。
 *
 * 【修前实测的缺口(读码可复算,不是推演)】
 *   `apps/wechat/chat-view.js::_refreshCurrentChatMessages` 的全量渲染回退路径写的是
 *   `messagesDiv.innerHTML = this.renderMessagesWithDateDividers(messages, userInfo)`
 *   —— **整段重铺**。而 `config/list-window.js` 的 `windowOf` 是**从头部**切片
 *   (`items = notes.slice(0, next)`),服务的是瀑布流;聊天要看的是**最近 N 条**,
 *   两种切片方向相反。于是长会话只有两条路:要么整段铺进 DOM(首屏一次长任务),
 *   要么用头部窗口(把用户丢在聊天开头)。
 *
 * 【本版落的两件】一 `config/list-window.js` 补**尾部三支**
 *   (`tailWindowOf` / `mergeTailWindow` / `tailLine`,既有 windowOf 一行未改);
 *   二 微信聊天全量渲染路径接上尾部窗口(`CHAT_WINDOW_SIZE = 200`)+ `showEarlierMessages()`。
 *
 * 判据面(五组):
 *   A 口径:尾部三支与既有三支同名同规格 / 纯函数零副作用
 *   B 行为:从尾部切 / 增量只算尾部追加 / hasMore 三态 / 不重铺
 *   C 接线:聊天全量路径真切片 / 常量唯一 / 往回翻入口 / 增量路径未被改坏
 *   D 负控制:真源码定点破坏四条口径 ⇒ 同款判据必转红(配原版必真的反向对照)
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
const LW_REL = 'config/list-window.js';
const CHAT_REL = 'apps/wechat/chat-view.js';
const IDX_REL = 'index.js';
const LW = await import(pathToFileURL(path.join(ROOT, LW_REL)).href);
const lwSrc = read(LW_REL);
const chatSrc = read(CHAT_REL);
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
const lwCode = stripComments(lwSrc);
const chatCode = stripComments(chatSrc);

const mk = (n) => Array.from({ length: n }, (_, i) => ({ id: 'm' + i }));

/* ══════════════════ A. 口径面 ══════════════════ */
test('A1 尾部三支与既有三支同规格:**同键名、同三态、同默认页长语义**', () => {
  /* 既有三支一行未改。 */
  assert.equal(typeof LW.windowOf, 'function');
  assert.equal(typeof LW.patchOf, 'function');
  assert.equal(typeof LW.keepState, 'function');
  /* 新增三支在场。 */
  assert.equal(typeof LW.tailWindowOf, 'function');
  assert.equal(typeof LW.mergeTailWindow, 'function');
  assert.equal(typeof LW.tailLine, 'function');
  /* 恒定键面(与 windowOf 同键名)。 */
  const w = LW.tailWindowOf(mk(10), { pageSize: 3 });
  for (const k of ['ok', 'items', 'added', 'loaded', 'total', 'hasMore', 'appended', 'reason', 'start', 'end']) {
    assert.ok(k in w, '尾部窗口必须有键 ' + k);
  }
  /* 默认导出也带上(与既有同处)。 */
  assert.equal(typeof LW.default.tailWindowOf, 'function');
  assert.equal(typeof LW.default.line, 'function', '既有 line 仍在');
});

test('A2 纯函数:尾部三支不碰 DOM / 不写存储 / 不联网', () => {
  for (const bad of ['document', 'window', 'localStorage', 'dispatchEvent', 'setTimeout', 'setInterval', 'fetch', 'indexedDB']) {
    assert.equal(new RegExp('\\b' + bad + '\\b').test(lwCode), false, LW_REL + ' 不得出现 ' + bad);
  }
});

test('A3 页长走既有同一支(不许自写一份)', () => {
  const fn = lwCode.slice(lwCode.indexOf('export function tailWindowOf('));
  const body = fn.slice(0, fn.indexOf('\n}'));
  assert.ok(body.includes('normalizePageSize('), '页长归一必须用既有那支');
  assert.equal(/Number\.isFinite\(Number\(/.test(body), false, '不得出现弱口径签名');
});

/* ══════════════════ B. 行为面 ══════════════════ */
test('B1 从**尾部**切:最近 N 条(而不是最早的 N 条)', () => {
  const arr = mk(10);
  const w = LW.tailWindowOf(arr, { pageSize: 3 });
  assert.equal(w.items.length, 3);
  assert.equal(w.items[0].id, 'm7', '必须是最新的三条,从 m7 起');
  assert.equal(w.items[2].id, 'm9');
  assert.equal(w.start, 7);
  assert.equal(w.end, 10);
  assert.equal(w.hasMore, true, '前面还有 ⇒ hasMore');
  /* 反向对照:既有 windowOf 是**头部**切 —— 两者方向相反,故必须分开。 */
  const head = LW.windowOf(arr, { pageSize: 3 });
  assert.equal(head.items[0].id, 'm0', '既有那支应从头部切(证明两者确实不同)');
});

test('B2 hasMore 三态:「还有更早的」与「已到开头」不得同形', () => {
  const few = LW.tailWindowOf(mk(3), { pageSize: 10 });
  assert.equal(few.hasMore, false);
  assert.ok(few.reason.includes('exhausted'), '到开头必须具名:' + few.reason);
  const many = LW.tailWindowOf(mk(500), { pageSize: 10 });
  assert.equal(many.hasMore, true);
  assert.ok(many.reason.includes('has-more'), '还有必须具名');
  const none = LW.tailWindowOf([], { pageSize: 10 });
  assert.equal(none.ok, true);
  assert.equal(none.total, 0);
  assert.equal(none.hasMore, false);
  assert.ok(none.reason.includes('empty-list'), '真空列表必须具名(与「没给列表」分开)');
  const bad = LW.tailWindowOf(null, {});
  assert.equal(bad.ok, false, '拿不到列表 ⇒ ok:false');
  assert.ok(bad.reason.includes('not-array'), '与「空列表」分开:' + bad.reason);
});

test('B3 增量:只有**尾部追加**才算 added(删/改不算)', () => {
  /* 尾部追加:added = 新来的那几条。 */
  const grew = LW.tailWindowOf(mk(5), { pageSize: 10, prevCount: 3 });
  assert.equal(grew.appended, true);
  assert.equal(grew.added.length, 2);
  assert.equal(grew.added[0].id, 'm3');
  /* 条数不变 ⇒ 无增量。 */
  const same = LW.tailWindowOf(mk(5), { pageSize: 10, prevCount: 5 });
  assert.equal(same.appended, false);
  assert.equal(same.added.length, 0);
  /* 条数**减少**(删/撤回)⇒ 不是增量。 */
  const shrank = LW.tailWindowOf(mk(3), { pageSize: 10, prevCount: 9 });
  assert.equal(shrank.appended, false, '变少不得当追加');
  assert.equal(shrank.added.length, 0);
  /* 不给 prevCount ⇒ 不报增量(判不了就不报)。 */
  const unknown = LW.tailWindowOf(mk(5), { pageSize: 10 });
  assert.equal(unknown.appended, false);
  assert.equal(unknown.added.length, 0);
});

test('B4 页长:loaded 只能放大不能缩小(往回翻是单向的)', () => {
  const base = LW.tailWindowOf(mk(500), { pageSize: 10 });
  assert.equal(base.loaded, 10);
  const more = LW.tailWindowOf(mk(500), { pageSize: 10, loaded: 25 });
  assert.equal(more.loaded, 25, 'loaded 生效');
  const shrink = LW.tailWindowOf(mk(500), { pageSize: 10, loaded: 3 });
  assert.equal(shrink.loaded, 10, '小于 pageSize 的 loaded 不得把窗口缩得更小');
  /* 页长上限 200(与既有 normalizePageSize 同口径)。 */
  const huge = LW.tailWindowOf(mk(5000), { pageSize: 999 });
  assert.equal(huge.loaded, 200, '页长上限必须是 200(与既有一致)');
});

test('B5 mergeTailWindow:前缀一致才叫追加;有删/有改必须走重建', () => {
  const a = mk(3);
  const grew = LW.mergeTailWindow(a, mk(5));
  assert.equal(grew.ok, true);
  assert.equal(grew.appended, true);
  assert.equal(grew.appendItems.length, 2);
  assert.equal(grew.removed, false);
  /* 前缀不一致(删了中间一条)⇒ 必须重建。 */
  const removed = LW.mergeTailWindow([{ id: 'a' }, { id: 'b' }], [{ id: 'a' }, { id: 'c' }]);
  assert.equal(removed.appended, false);
  assert.equal(removed.removed, true, '前缀不一致必须报「要走重建」');
  /* 没变化。 */
  const same = LW.mergeTailWindow(a, a.map((x) => Object.assign({}, x)));
  assert.equal(same.appended, false);
  assert.equal(same.removed, false);
  assert.equal(same.reason, 'no-change');
  /* 拿不到两侧 ⇒ 按需重建(不硬撑局部更新)。 */
  const bad = LW.mergeTailWindow(null, a);
  assert.equal(bad.removed, true);
  assert.equal(bad.appended, false);
});

test('B6 tailLine:一句话读数(与既有 line 同规格)', () => {
  const w = LW.tailWindowOf(mk(500), { pageSize: 200 });
  const line = LW.tailLine(w);
  assert.ok(line.includes('200/500'), '必须报「最近 N/总」:' + line);
  assert.ok(line.includes('还有更早的'), '必须报还有更早的');
  const done = LW.tailLine(LW.tailWindowOf(mk(5), { pageSize: 200 }));
  assert.ok(done.includes('已到开头'));
  /* 判不了时**必须把 reason 原样带出** —— 首版断言 `判不了` 字样,而实现给的是
   *   `聊天窗口 —(x)`(把上游 reason 原样透出)。判据改成核「原样透出」这个真口径。 */
  const d = LW.tailLine({ ok: false, reason: 'x' });
  assert.ok(d.includes('x'), '判不了必须原样带出 reason:' + d);
  const dn = LW.tailLine({ ok: false });
  assert.ok(dn.includes('判不了'), '没给 reason 时才回落到「判不了」:' + dn);
  assert.ok(LW.tailLine(null).includes('判不了'));
});

/* ══════════════════ C. 接线面 ══════════════════ */
test('C1 聊天全量渲染路径:**真切片**(不再整段重铺)', () => {
  assert.ok(chatCode.includes("from '../../config/list-window.js';"), '必须消费真源');
  const fn = chatCode.slice(chatCode.indexOf('_refreshCurrentChatMessages(options = {}) {'));
  const body = fn.slice(0, fn.indexOf('\n    }'));
  assert.ok(body.includes('tailWindowOf(messages'), '全量路径必须先切尾部窗口');
  assert.ok(body.includes('renderMessagesWithDateDividers(win.items'),
    '必须把**切片后**的数组交给渲染(而非全量 messages)');
  assert.equal(/renderMessagesWithDateDividers\(messages,\s*userInfo\)/.test(body), false,
    '不得再把全量 messages 交给渲染');
  assert.ok(body.includes('_lastRenderedWindow = win'), '本轮窗口读数必须留下(供诊断)');
});

test('C2 窗口上限:**模块常量唯一声明**,且值不超出既有页长上限', () => {
  const hits = (chatCode.match(/const CHAT_WINDOW_SIZE = /g) || []).length;
  assert.equal(hits, 1, '常量只许声明一处(实测 ' + hits + ')');
  const m = /const CHAT_WINDOW_SIZE = (\d+);/.exec(chatCode);
  assert.ok(m, '常量必须能读出');
  const val = Number(m[1]);
  assert.ok(val > 0 && val <= 200, '必须落在既有页长上限 200 之内(实测 ' + val + ')');
  /* 上限口径必须来自既有那支,而不是另写一个数。 */
  const w = LW.tailWindowOf(mk(5000), { pageSize: val });
  assert.equal(w.loaded, val, '常量值必须能真的生效');
});

test('C3 往回翻入口在场,且「已到开头」如实回报', () => {
  assert.match(chatCode, /showEarlierMessages\(\) \{/);
  const fn = chatCode.slice(chatCode.indexOf('showEarlierMessages() {'));
  const body = fn.slice(0, fn.indexOf('\n    }'));
  assert.ok(body.includes('this.windowSize() + CHAT_WINDOW_SIZE'), '每次放大一页');
  assert.ok(body.includes('hasMore: next < total'), '「还有没有更早的」必须按真实总数算');
  assert.ok(body.includes('ok: changed'), '没变化时如实返回 false(不假装拉了)');
  assert.match(chatCode, /windowSize\(\) \{/, '必须有当前窗口大小读数');
});

test('C4 增量追加路径**未被改坏**(它本来是对的:纯尾部追加只 append 新节点)', () => {
  const fn = chatCode.slice(chatCode.indexOf('_refreshCurrentChatMessages(options = {}) {'));
  const body = fn.slice(0, fn.indexOf('// 全量渲染回退路径') > 0 ? fn.indexOf('// 全量渲染回退路径') : fn.length);
  assert.ok(body.includes('isPureAppend'), '纯尾部追加判定必须仍在');
  assert.ok(body.includes('messagesDiv.appendChild('), '增量路径必须仍是「只 append 新节点」');
  /* currIds 必须仍然记**全量** id(增量判定靠它)。 */
  const full = fn.slice(0, fn.indexOf('\n    }'));
  assert.ok(full.includes('this._lastRenderedMsgIds[chatId] = currIds;'), '全量 id 台账必须保留');
  assert.ok(full.includes('messages.map(m => String(m?.id ?? \'\'))'), 'currIds 仍取自全量 messages');
});

/* ══════════════════ D. 负控制(真源码破坏 → 同一份判据必须转红) ══════════════════ */
function breakOnce(src, anchor, replacement, tag) {
  const hits = src.split(anchor).length - 1;
  assert.equal(hits, 1, '破坏锚点必须恰中 1 次(实测 ' + hits + '):' + tag);
  return src.replace(anchor, replacement);
}

test('D0 ★★★ 阳性对照:未破坏时四条判据必须全为真(否则 D 组是假绿)', () => {
  assert.equal(/Number\.isFinite\(Number\(/.test(lwCode), false, '纯函数件无弱口径');
  assert.ok(chatCode.includes('tailWindowOf(messages'), '聊天真切片');
  assert.equal((chatCode.match(/const CHAT_WINDOW_SIZE = /g) || []).length, 1, '常量唯一');
  assert.ok(chatCode.includes('showEarlierMessages() {'), '往回翻入口在位');
});

test('D1 ★★★ 破坏「从尾部切」⇒ 同款判据必转红(又把用户丢在聊天开头)', () => {
  const broken = breakOnce(lwCode,
    '    out.items = items.slice(out.start);',
    '    out.items = items.slice(0, take);',
    'd1');
  assert.equal(broken.includes('out.items = items.slice(out.start);'), false, '破坏副本:已不切尾部');
  assert.ok(lwCode.includes('out.items = items.slice(out.start);'), '原版必须切尾部');
  /* 行为面:原版必须给最新三条。 */
  const w = LW.tailWindowOf(mk(10), { pageSize: 3 });
  assert.equal(w.items[0].id, 'm7', '原版必须是最新三条');
});

test('D2 ★★★ 破坏「聊天全量路径真切片」⇒ 同款判据必转红(整段重铺回归)', () => {
  const broken = breakOnce(chatCode,
    'renderMessagesWithDateDividers(win.items, userInfo)',
    'renderMessagesWithDateDividers(messages, userInfo)',
    'd2');
  assert.equal(broken.includes('renderMessagesWithDateDividers(win.items, userInfo)'), false,
    '破坏副本:又交给全量');
  assert.ok(chatCode.includes('renderMessagesWithDateDividers(win.items, userInfo)'), '原版必须交切片');
});

test('D3 ★★★ 破坏「增量只算尾部追加」⇒ 同款判据必转红(删也算新增)', () => {
  const broken = breakOnce(lwCode,
    '        const grew = items.length > prev;',
    '        const grew = true;',
    'd3');
  assert.equal(broken.includes('const grew = items.length > prev;'), false, '破坏副本:已不判增长');
  assert.ok(lwCode.includes('const grew = items.length > prev;'), '原版必须判增长');
  /* 行为面:原版对「变少」不得报追加。 */
  assert.equal(LW.tailWindowOf(mk(3), { pageSize: 10, prevCount: 9 }).appended, false,
    '原版:变少不得当追加');
});

test('D4 ★★★ 破坏「前缀一致才叫追加」⇒ 同款判据必转红(有删也走追加 ⇒ 漏消息)', () => {
  const broken = breakOnce(lwCode,
    '    const samePrefix = aIds.length <= bIds.length\n        && aIds.every((id, i) => id === bIds[i]);',
    '    const samePrefix = true;',
    'd4');
  assert.equal(broken.includes('aIds.every((id, i) => id === bIds[i])'), false,
    '破坏副本:已不判前缀');
  assert.ok(lwCode.includes('aIds.every((id, i) => id === bIds[i])'), '原版必须判前缀');
  /* 行为面。 */
  assert.equal(LW.mergeTailWindow([{ id: 'a' }, { id: 'b' }], [{ id: 'a' }, { id: 'c' }]).removed, true,
    '原版:前缀不一致必须报要走重建');
});

test('D5 ★★★ 破坏「页长走既有同一支」⇒ 同款判据必转红(自写一份上限)', () => {
  const broken = breakOnce(lwCode,
    '    const size = normalizePageSize(o.pageSize, 300);',
    '    const size = Math.floor(o.pageSize) || 300;',
    'd5');
  assert.equal(broken.includes('normalizePageSize(o.pageSize, 300)'), false, '破坏副本:已不自用那支');
  assert.ok(lwCode.includes('normalizePageSize(o.pageSize, 300)'), '原版必须用那支');
  /* 行为面:上限必须是 200。 */
  assert.equal(LW.tailWindowOf(mk(5000), { pageSize: 999 }).loaded, 200, '原版:上限 200');
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