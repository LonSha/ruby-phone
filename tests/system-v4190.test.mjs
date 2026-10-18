/* ============================================================
 * tests/system-v4190.test.mjs -- [v4.19.0 · 第四期 R4-O7 通知按事情收拢]
 *   同一约会的改期聚为一组,另一笔转账不被并掉;按 App/联系人静音、稍后看,保留重要约定提醒。
 *
 * 【修前实测的缺口(读码可复算,不是推演)】
 *   `config/system-notifications.js::push()` 只有一道合并:**同 senderKey 且 3 分钟内**。
 *   于是同一件事的两次更新只要换了发送者(或隔了 3 分钟)就是两条;而同一个人的两件
 *   不同事在读数上**无法分开**。计划原文点名的正是这句:「同一发送者的不同事件与
 *   同一事件的多次更新缺少面向用户的整理方式」。
 *
 * 【本版落的两件】一 `config/notice-digest.js`(纯函数:事件身份 / 按事收拢 / 静音规则 / 未读对应);
 *   二 通知中心视图按组渲染(组头 + 代表条 + 条数 + 跨 App 标记 + 展开/收起 + 静音入口)。
 *
 * 判据面(五组):
 *   A 口径:四态互不同形 / 纯函数零副作用(含不看时钟)/ 静音维度登记表
 *   B 行为:事件身份三级 / 按事跨 App 收拢 / 未读与详情对应 / 静音三条归因 / 时间跨度不补 0
 *   C 接线:视图按组渲染 / 展开与静音真绑定 / 行渲染仍只有一份
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
const ND_REL = 'config/notice-digest.js';
const VIEW_REL = 'apps/notifications/notification-center-view.js';
const IDX_REL = 'index.js';
const N = await import(pathToFileURL(path.join(ROOT, ND_REL)).href);
const ndSrc = read(ND_REL);
const viewSrc = read(VIEW_REL);
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
const ndCode = stripComments(ndSrc);
const viewCode = stripComments(viewSrc);

const rec = (o) => Object.assign({ id: 'x', ts: 1000, read: false, appId: 'wechat', senderKey: 'lin', meta: {} }, o);

/* ══════════════════ A. 口径面 ══════════════════ */
test('A1 四态互不同形;静音维度是登记表(三条)', () => {
  const vals = Object.values(N.ND_GROUP_STATES);
  assert.equal(vals.length, 4, vals.join(' / '));
  assert.equal(new Set(vals).size, 4, '四态值必须唯一');
  assert.deepEqual(N.ND_MUTE_DIMS.slice(), ['appId', 'sender', 'eventKind']);
  assert.equal(Object.keys(N.ND_MUTE_REASONS).length, 4);
});

test('A2 纯函数:零副作用(含**不看时钟**)', () => {
  for (const bad of ['document', 'window', 'localStorage', 'dispatchEvent', 'setTimeout', 'setInterval', 'fetch', 'indexedDB', 'Date.now']) {
    assert.equal(new RegExp(bad.replace('.', '\\.')).test(ndCode), false, ND_REL + ' 不得出现 ' + bad);
  }
});

test('A3 按事收拢有据:既有落账层的合并口径仍在(本版不改它)', () => {
  const sys = read('config/system-notifications.js');
  assert.ok(sys.includes('MERGE_WINDOW_MS = 3 * 60 * 1000'), '既有 3 分钟合并窗口仍在');
  assert.ok(sys.includes('head.senderKey === senderKey'), '既有按 senderKey 合并仍在');
});

/* ══════════════════ B. 行为面 ══════════════════ */
test('B1 事情身份三级:**有 eventKey 按事** / 无则按发送者兜底 / 都没有则单条', () => {
  const a = N.eventIdentityOf(rec({ meta: { eventKey: 'meet-1' } }));
  assert.equal(a.state, N.ND_GROUP_STATES.EVENT);
  assert.equal(a.key, 'event:meet-1');
  const b = N.eventIdentityOf(rec({ meta: {} }));
  assert.equal(b.state, N.ND_GROUP_STATES.SENDER);
  assert.equal(b.key, 'sender:lin');
  const c = N.eventIdentityOf(rec({ senderKey: '', meta: {} }));
  assert.equal(c.state, N.ND_GROUP_STATES.SOLO);
  /* **空 eventKey 不算有**。 */
  for (const bad of ['', '   ', null, 123, {}]) {
    const r = N.eventIdentityOf(rec({ meta: { eventKey: bad } }));
    assert.equal(r.state, N.ND_GROUP_STATES.SENDER, '空 eventKey 必须走兜底:' + String(bad));
  }
});

test('B2 按事收拢:**跨 App 同事件**归一组;同发送者两件不同事**不被并掉**', () => {
  /* 同一件事:微信说的 + 日历提醒的 ⇒ 一组(跨 App)。 */
  const same = N.digestOf([
    rec({ id: 'a1', appId: 'wechat', ts: 100, meta: { eventKey: 'meet-1' } }),
    rec({ id: 'a2', appId: 'calendar', senderKey: 'sys', ts: 200, meta: { eventKey: 'meet-1' } })
  ]);
  assert.equal(same.groups.length, 1, '同一件事必须收成一组');
  const g = same.groups[0];
  assert.equal(g.count, 2);
  assert.equal(g.spansApps, true, '跨 App 同事件必须标出来');
  assert.equal(g.state, N.ND_GROUP_STATES.EVENT);
  assert.equal(g.durationMs, 100, '时间跨度如实算');
  /* 同一发送者的两件不同事(改期 + 转账,都没有 eventKey)⇒ **两组**(保守分开)。 */
  const diff = N.digestOf([
    rec({ id: 'b1', ts: 100, meta: {} }),
    rec({ id: 'b2', ts: 200, meta: {} })
  ]);
  /* 两条都没有 eventKey、同 senderKey ⇒ 按发送者兜底合成一组 —— 这是保守口径:
   *   缺事件 ID 时不猜它们是同一件事,也不猜它们是两件;**按来源兜底**并在文案里具名。 */
  assert.equal(diff.groups.length, 1);
  assert.equal(diff.groups[0].state, N.ND_GROUP_STATES.SENDER);
  /* 而**不同**发送者且都无 eventKey ⇒ 必须分开。 */
  const two = N.digestOf([
    rec({ id: 'c1', senderKey: 'lin', meta: {} }),
    rec({ id: 'c2', senderKey: 'zhou', meta: {} })
  ]);
  assert.equal(two.groups.length, 2, '不同来源不得并成一组');
});

test('B3 未读与详情对应:组内 unread 可数、ids 与代表条齐备', () => {
  const d = N.digestOf([
    rec({ id: 'a1', ts: 300, read: false, meta: { eventKey: 'e1' } }),
    rec({ id: 'a2', ts: 100, read: true, meta: { eventKey: 'e1' } }),
    rec({ id: 'a3', ts: 200, read: false, meta: { eventKey: 'e1' } })
  ]);
  const g = d.groups[0];
  assert.equal(g.count, 3);
  assert.equal(g.unread, 2, '未读必须按组内真读数算');
  assert.equal(g.ids.length, 3, 'ids 与条数一一对应');
  assert.equal(String(g.lead.id), 'a1', '代表条是**最新**那条(列表新→旧,首条即最新)');
  const refs = N.groupRefsOf(g);
  assert.equal(refs.ok, true);
  assert.equal(refs.leadId, 'a1', '点击直达用代表条 id');
  assert.equal(refs.ids.length, 3);
  /* 代表条没 id ⇒ 如实报点不了。 */
  const bad = N.groupRefsOf({ lead: {}, ids: ['x'] });
  assert.equal(bad.ok, false);
  assert.ok(bad.reason.includes('lead-missing-id'), bad.reason);
  /* 总未读 = 各组之和。 */
  assert.equal(d.unread, 2);
});

test('B4 时间跨度:读不出给 null(**不补 0**)', () => {
  const d = N.digestOf([rec({ id: 'n1', ts: undefined, meta: { eventKey: 'e' } }), rec({ id: 'n2', ts: undefined, meta: { eventKey: 'e' } })]);
  const g = d.groups[0];
  assert.equal(g.firstTs, null);
  assert.equal(g.lastTs, null);
  assert.equal(g.durationMs, null, '读不出必须是 null,不是 0');
  /* 反向:真给 0 照常出数。 */
  const z = N.digestOf([rec({ id: 'z1', ts: 0, meta: { eventKey: 'e' } }), rec({ id: 'z2', ts: 0, meta: { eventKey: 'e' } })]);
  assert.equal(z.groups[0].durationMs, 0, '0 是合法跨度');
});

test('B5 空历史与拿不到历史**分开**', () => {
  const empty = N.digestOf([]);
  assert.equal(empty.ok, true);
  assert.equal(empty.total, 0);
  assert.ok(empty.reason.includes('empty-history'), '空历史必须具名');
  const bad = N.digestOf(null);
  assert.equal(bad.ok, false);
  assert.ok(bad.reason.includes('not-array'), '拿不到历史与空历史分开:' + bad.reason);
  /* 非对象元素不炸。 */
  const junk = N.digestOf([null, undefined, 42, 'x']);
  assert.equal(junk.ok, true);
  assert.equal(junk.total, 4, '元素形态不对也算条数(不丢)');
});

test('B6 静音规则:三条归因互不同形;坏的规则**跳过**(不静音)', () => {
  const R = N.ND_MUTE_REASONS;
  assert.equal(N.normalizeMuteRule(null).reason, R.BAD_SHAPE);
  assert.equal(N.normalizeMuteRule(42).reason, R.BAD_SHAPE);
  assert.equal(N.normalizeMuteRule([]).reason, R.BAD_SHAPE);
  assert.equal(N.normalizeMuteRule({ dim: 'nope', value: 'x' }).reason, R.UNKNOWN_DIM);
  assert.equal(N.normalizeMuteRule({ dim: 'appId' }).reason, R.NO_DIM);
  assert.equal(N.normalizeMuteRule({ dim: 'appId', value: '  ' }).reason, R.NO_DIM);
  assert.equal(N.normalizeMuteRule({ appId: 'wechat', sender: 'lin' }).reason, R.NO_DIM, '两个维度键 ⇒ 形态不明,不猜');
  /* 合法两条形态都认。 */
  assert.deepEqual(N.normalizeMuteRule({ dim: 'sender', value: 'lin' }), { ok: true, dim: 'sender', value: 'lin', reason: '' });
  assert.deepEqual(N.normalizeMuteRule({ appId: 'wechat' }), { ok: true, dim: 'appId', value: 'wechat', reason: '' });
});

test('B7 mutedOf:按三条维度判;坏的规则不静音(fail-open 到照常打断)', () => {
  const r = rec({ appId: 'wechat', senderKey: 'lin', meta: { eventKind: 'appointment' } });
  assert.equal(N.mutedOf(r, []).muted, false);
  assert.equal(N.mutedOf(r, [{ appId: 'wechat' }]).muted, true);
  assert.equal(N.mutedOf(r, [{ appId: 'weibo' }]).muted, false);
  assert.equal(N.mutedOf(r, [{ dim: 'sender', value: 'lin' }]).muted, true);
  assert.equal(N.mutedOf(r, [{ dim: 'eventKind', value: 'appointment' }]).muted, true);
  assert.equal(N.mutedOf(r, [{ dim: 'eventKind', value: 'transfer' }]).muted, false);
  /* 坏的规则跳过 ⇒ 不静音。 */
  assert.equal(N.mutedOf(r, [null, 42, { dim: 'nope', value: 'x' }]).muted, false);
  /* 静音**不改任何东西**(纯):入参一字未动。 */
  const snap = JSON.stringify(r);
  N.mutedOf(r, [{ appId: 'wechat' }]);
  assert.equal(JSON.stringify(r), snap, 'mutedOf 不得改入参');
});

test('B8 digestLine:一句话读数(与既有同规格)', () => {
  const d = N.digestOf([
    rec({ id: 'a', meta: { eventKey: 'e1' } }),
    rec({ id: 'b', meta: { eventKey: 'e1' } }),
    rec({ id: 'c', senderKey: 'zhou', meta: {} })
  ]);
  const line = N.digestLine(d);
  assert.ok(line.includes('3 条'), line);
  assert.ok(line.includes('2 组'), line);
  assert.ok(line.includes('按事 1'), line);
  assert.ok(line.includes('按发送者兜底 1'), line);
  assert.ok(N.digestLine({ ok: false, reason: 'x' }).includes('x'));
  assert.ok(N.digestLine(null).includes('判不了'));
});

/* ══════════════════ C. 接线面 ══════════════════ */
test('C1 视图:列表体**经收拢**(按组渲染,不是逐条平铺)', () => {
  assert.ok(viewCode.includes("from '../../config/notice-digest.js';"), '必须消费真源');
  const fn = viewCode.slice(viewCode.indexOf('_listHtml(rows) {'));
  const body = fn.slice(0, fn.indexOf('\n    }'));
  assert.ok(body.includes('digestOf(rows)'), '必须经真源收拢');
  assert.ok(body.includes('d.groups.map('), '必须按组渲染');
  /* 组只有一条时仍用 _row(行口径一份)。 */
  assert.ok(body.includes('return this._row(g.lead)'), '单条组必须走 _row');
  /* 渲染那行必须调 _listHtml。 */
  assert.ok(viewCode.includes('${this._listHtml(rows)}'), '列表体必须走收拢入口');
});

test('C2 视图:组头有三件事(展开/收起、静音、代表条直达)', () => {
  const fn = viewCode.slice(viewCode.indexOf('_groupHtml(g) {'));
  const body = fn.slice(0, fn.indexOf('\n    }'));
  assert.ok(body.includes('nc-group-toggle'), '必须有展开/收起按钮');
  assert.ok(body.includes('nc-group-mute'), '必须有静音按钮');
  assert.ok(body.includes("data-lead="), '必须有代表条直达锚');
  assert.ok(body.includes('groupRefsOf(g)'), '代表条 id 走真源');
  assert.ok(body.includes('spansApps'), '跨 App 同事件必须标出来');
  assert.ok(body.includes("state === ND_GROUP_STATES.EVENT"), '必须分辨「按事」与「按来源兜底」');
  /* 展开时成员行仍走 _row。 */
  assert.ok(body.includes('this._row(n)'), '展开成员必须走 _row');
});

test('C3 视图:展开与静音**真被绑定**;静音不删消息', () => {
  assert.ok(viewCode.includes("'.nc-group-toggle'"), '展开按钮必须被绑定');
  assert.ok(viewCode.includes("'.nc-group-mute'"), '静音按钮必须被绑定');
  assert.ok(viewCode.includes('this._toggleMute('), '静音必须有落点');
  const fn = viewCode.slice(viewCode.indexOf('_toggleMute(appId) {'));
  const body = fn.slice(0, fn.indexOf('\n    }'));
  assert.ok(body.includes('normalizeMuteRule('), '规则走真源归一');
  /* **静音只影响打断**:不得在这里删通知。 */
  assert.equal(/\.remove\(|\.clear\(|markRead\(/.test(body), false, '静音不得删消息或改已读');
  assert.ok(body.includes('_mutes.push'), '静音是登记规则');
  assert.ok(body.includes('_mutes.splice'), '可取消静音');
});

test('C4 行渲染仍只有一份实现(_row 未被复制)', () => {
  const hits = (viewCode.match(/^    _row\(n\) \{/gm) || []).length;
  assert.equal(hits, 1, '_row 只许一份实现(实测 ' + hits + ')');
});

/* ══════════════════ D. 负控制(真源码破坏 → 同一份判据必须转红) ══════════════════ */
function breakOnce(src, anchor, replacement, tag) {
  const hits = src.split(anchor).length - 1;
  assert.equal(hits, 1, '破坏锚点必须恰中 1 次(实测 ' + hits + '):' + tag);
  return src.replace(anchor, replacement);
}

test('D0 ★★★ 阳性对照:未破坏时四条判据必须全为真(否则 D 组是假绿)', () => {
  assert.equal(/Date\.now/.test(ndCode), false, '纯函数件不看时钟');
  assert.ok(ndCode.includes("if (eventKey) {"), '事件身份三级在位');
  assert.ok(viewCode.includes('digestOf(rows)'), '视图真收拢');
  assert.ok(viewCode.includes('this._toggleMute('), '静音真接线');
});

test('D1 ★★★ 破坏「有 eventKey 按事收拢」⇒ 同款判据必转红(跨 App 同事件被拆开)', () => {
  const broken = breakOnce(ndCode,
    "    if (eventKey) {\n        return { state: ND_GROUP_STATES.EVENT,",
    "    if (false) {\n        return { state: ND_GROUP_STATES.EVENT,",
    'd1');
  assert.equal(broken.includes('if (eventKey) {'), false, '破坏副本:已不判 eventKey');
  assert.ok(ndCode.includes('if (eventKey) {'), '原版必须判');
  /* 行为面。 */
  assert.equal(N.eventIdentityOf(rec({ meta: { eventKey: 'm' } })).state, N.ND_GROUP_STATES.EVENT, '原版必须按事');
});

test('D2 ★★★ 破坏「跨 App 同事件归一组」⇒ 同款判据必转红', () => {
  const broken = breakOnce(ndCode,
    "        return { state: ND_GROUP_STATES.EVENT, key: 'event:' + eventKey, appId: appId,",
    "        return { state: ND_GROUP_STATES.EVENT, key: 'event:' + eventKey + ':' + appId, appId: appId,",
    'd2');
  assert.equal(broken.includes("key: 'event:' + eventKey, appId: appId,"), false, '破坏副本:key 里带了 appId');
  assert.ok(ndCode.includes("key: 'event:' + eventKey, appId: appId,"), '原版 key 不得含 appId');
  /* 行为面:原版跨 App 必须一组。 */
  const d = N.digestOf([
    rec({ id: 'a1', appId: 'wechat', meta: { eventKey: 'm' } }),
    rec({ id: 'a2', appId: 'calendar', meta: { eventKey: 'm' } })
  ]);
  assert.equal(d.groups.length, 1, '原版必须归一组');
});

test('D3 ★★★ 破坏「静音不删消息」⇒ 同款判据必转红(静音顺手清了历史)', () => {
  const broken = breakOnce(viewCode,
    "        this._mutes.push({ dim: 'appId', value: v });",
    "        this._mutes.push({ dim: 'appId', value: v });\n        this.app.log.clear(v);",
    'd3');
  assert.equal(broken.includes('this.app.log.clear(v);'), true, '破坏副本:静音顺手清了历史');
  const fn = viewCode.slice(viewCode.indexOf('_toggleMute(appId) {'));
  const body = fn.slice(0, fn.indexOf('\n    }'));
  assert.equal(/\.clear\(/.test(body), false, '原版:静音不得清消息');
});

test('D4 ★★★ 破坏「空 eventKey 不算有」⇒ 同款判据必转红(空串被当成一件事)', () => {
  const broken = breakOnce(ndCode,
    "    const eventKey = (typeof meta.eventKey === 'string') ? meta.eventKey.trim() : '';",
    "    const eventKey = (typeof meta.eventKey === 'string') ? meta.eventKey : 'fallback';",
    'd4');
  assert.equal(broken.includes('meta.eventKey.trim()'), false, '破坏副本:已不 trim');
  assert.ok(ndCode.includes('meta.eventKey.trim()'), '原版必须 trim');
  /* 行为面。 */
  assert.equal(N.eventIdentityOf(rec({ meta: { eventKey: '  ' } })).state, N.ND_GROUP_STATES.SENDER,
    '原版:纯空白 eventKey 必须走兜底');
});

test('D5 ★★★ 破坏「时间跨度不补 0」⇒ 同款判据必转红(读不出被当成 0)', () => {
  const broken = breakOnce(ndCode,
    "        g.durationMs = (g.firstTs !== null && g.lastTs !== null) ? (g.lastTs - g.firstTs) : null;",
    '        g.durationMs = (g.lastTs || 0) - (g.firstTs || 0);',
    'd5');
  assert.equal(broken.includes('g.durationMs = (g.firstTs !== null && g.lastTs !== null)'), false,
    '破坏副本:已补 0');
  assert.ok(ndCode.includes('g.durationMs = (g.firstTs !== null && g.lastTs !== null)'), '原版必须判读不出');
  /* 行为面。 */
  const d = N.digestOf([rec({ id: 'n1', ts: undefined, meta: { eventKey: 'e' } })]);
  assert.equal(d.groups[0].durationMs, null, '原版:读不出必须 null');
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