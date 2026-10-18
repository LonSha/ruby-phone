/* ============================================================
 * tests/system-v4150.test.mjs -- [v4.15.0 · 第四期 R4-O3 跨 App 返回恢复实际页面状态]
 *   搜索→详情→聊天→返回后继续原任务;原查询与选中项不丢;切到另一会话不恢复旧状态。
 *
 * 【修前实测的缺口(读码可复算,不是推演)】
 *   1 **返回键只回桌面**:`phone/phone-shell.js::bindBackButton` 的 click 分支写着
 *      `if (this.isAtHomeScreen()) return; this.goHome();` —— 从搜索跳进某个 App
 *      再按返回,用户被**直接丢回桌面**;而右滑那条路(SWIPE_BACK)是逐层退。
 *      两条路给出两个语义,而用户看到的是**同一个「返回」**。
 *   2 **状态没人捕获**:`apps/taskentry/taskentry-app.js::markLeft` 的注释逐字写着
 *      「本件**不做恢复动作**」;全仓 `restorePlan` 的唯一消费点是「给恢复读数」。
 *      读数是「恢复了没有」,不是「恢复」。
 *
 * 【本版落的三件】一 `config/view-state.js`(纯函数:四格归一 / 会话围栏 / 五态);
 *   二 宿主 `backOneLayer()` + 返回键改逐层退(包装既有真源,不重写);
 *   三 全局搜索接成首个真实消费点(captureState / restoreState + 视图先读后画)。
 *
 * 判据面(五组):
 *   A 口径:五态互不同形 / 四格登记 / 纯函数零副作用
 *   B 行为:归一不猜 / 会话围栏 / 五态逐条 / 0 是合法滚动位
 *   C 接线:返回键逐层退优先 / 包装而非重写 / 搜索 App 两侧真接线 / 换会话作废
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
const VS_REL = 'config/view-state.js';
const SHELL_REL = 'phone/phone-shell.js';
const APP_REL = 'apps/search/search-app.js';
const VIEW_REL = 'apps/search/search-view.js';
const IDX_REL = 'index.js';
const V = await import(pathToFileURL(path.join(ROOT, VS_REL)).href);
const vsSrc = read(VS_REL);
const shellSrc = read(SHELL_REL);
const appSrc = read(APP_REL);
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
const vsCode = stripComments(vsSrc);
const shellCode = stripComments(shellSrc);
const appCode = stripComments(appSrc);
const viewCode = stripComments(viewSrc);

/* ══════════════════ A. 口径面 ══════════════════ */
test('A1 五态**互不同形**,五句归因文案也两两不同', () => {
  const vals = Object.values(V.VIEW_STATE_STATES);
  assert.equal(vals.length, 5, vals.join(' / '));
  assert.equal(new Set(vals).size, 5, '五态值必须唯一');
  const lines = new Set(vals.map((s) => V.viewStateLine(s)));
  assert.equal(lines.size, 5, '五句必须互不相同:' + Array.from(lines).join(' | '));
  /* 最关键的一对:「第一次打开」与「属于另一个会话」处置相反(前者没什么可做,后者是拒绝贴错)。 */
  assert.notEqual(V.viewStateLine(V.VIEW_STATE_STATES.NO_SNAPSHOT),
    V.viewStateLine(V.VIEW_STATE_STATES.WRONG_SESSION));
  /* 读不出 ≠ 没保存过。 */
  assert.notEqual(V.viewStateLine(V.VIEW_STATE_STATES.UNREADABLE),
    V.viewStateLine(V.VIEW_STATE_STATES.NO_SNAPSHOT));
});

test('A2 四格登记表与既有 DF_RESTORE_FIELDS 同名同序(不各写一份词表)', async () => {
  assert.deepEqual(V.VIEW_STATE_KEYS.slice(), ['tab', 'query', 'anchor', 'scroll']);
  const desk = read('config/desk-focus.js');
  assert.ok(desk.includes("DF_RESTORE_FIELDS = Object.freeze(['tab', 'query', 'scroll', 'draft'])"),
    '既有词表仍在(本版不改它)');
  /* 同名前四格必须一致:tab / query / scroll 三格在两边同名。 */
  const df = await import(pathToFileURL(path.join(ROOT, 'config/desk-focus.js')).href);
  const dfKeys = df.DF_RESTORE_FIELDS.slice();
  for (const k of ['tab', 'query', 'scroll']) {
    assert.ok(V.VIEW_STATE_KEYS.includes(k), '本版四格必须含 ' + k);
    assert.ok(dfKeys.includes(k), '既有词表必须含 ' + k);
  }
  /* anchor 是本版新增(既有词表用 draft 表示「正在编辑的内容」,属 R4-O5 的活)。 */
  assert.ok(V.VIEW_STATE_KEYS.includes('anchor'));
  assert.equal(V.VIEW_STATE_KEYS.includes('draft'), false, 'draft 属 R4-O5,本版不接管');
});

test('A3 纯函数:零副作用(不碰 DOM / 不写存储 / 不联网)', () => {
  for (const bad of ['document', 'window', 'localStorage', 'dispatchEvent', 'setTimeout', 'setInterval', 'fetch', 'indexedDB']) {
    assert.equal(new RegExp('\\b' + bad + '\\b').test(vsCode), false, VS_REL + ' 不得出现 ' + bad);
  }
});

test('A4 键前缀只有一处定义,且与 storage.js 的 CHAT_DATA_PATTERNS 同源', () => {
  assert.equal(V.VIEW_STATE_KEY_PREFIX, 'view_state_');
  const storageSrc = read('config/storage.js');
  assert.ok(storageSrc.includes('/^view_/'), 'storage.js 必须有 ^view_ 前缀');
  /* 键拼法必须真落在那个前缀里(否则会落到全局 extensionSettings)。 */
  assert.ok(V.viewStateKey('search').startsWith(V.VIEW_STATE_KEY_PREFIX));
  assert.ok(/^view_/.test(V.viewStateKey('search')), '拼出的键必须命中 ^view_');
});

/* ══════════════════ B. 行为面 ══════════════════ */
test('B1 viewStateKey:appId 不成立时返回空串(**不写进共享桶**)', () => {
  assert.equal(V.viewStateKey('search'), 'view_state_search');
  for (const bad of ['', '   ', null, undefined, 123, {}]) {
    assert.equal(V.viewStateKey(bad), '', 'appId 不成立必须空串:' + String(bad));
  }
});

test('B2 归一不猜:四格恒定存在,空白串等于没给,0 是**合法**滚动位', () => {
  const s = V.normalizeViewSnapshot({ tab: '  list  ', query: '  ', anchor: '', scroll: 0 });
  assert.equal(s.tab, 'list', '字符串要 trim');
  assert.equal(s.query, null, '纯空白等于没查询');
  assert.equal(s.anchor, null);
  assert.equal(s.scroll, 0, '0 是合法滚动位(不得读成「没给」)');
  assert.equal(s.hasAny, true);
  const empty = V.normalizeViewSnapshot({});
  assert.equal(empty.hasAny, false);
  for (const k of V.VIEW_STATE_KEYS) assert.ok(k in empty, '四格必须恒定存在:' + k);
  /* 畸形输入不抛。 */
  for (const bad of [null, undefined, [], 'x', 42]) {
    const r = V.normalizeViewSnapshot(bad);
    assert.equal(r.hasAny, false, String(bad));
  }
  /* 滚动位的真值面:数字串也认,畸形不认。 */
  assert.equal(V.normalizeViewSnapshot({ scroll: '320' }).scroll, 320);
  for (const bad of ['', '  ', 'abc', NaN, Infinity, {}]) {
    assert.equal(V.normalizeViewSnapshot({ scroll: bad }).scroll, null, String(bad));
  }
});

test('B3 捕获:appId 不成立返回 null;会话身份原样带上', () => {
  assert.equal(V.captureViewState('', { tab: 'a' }, 'c1'), null);
  const p = V.captureViewState('search', { tab: 'list', query: '水壶' }, 'chatA');
  assert.equal(p.appId, 'search');
  assert.equal(p.chatId, 'chatA');
  assert.equal(p.snapshot.tab, 'list');
  assert.equal(p.hasAny, true);
  /* 会话身份取不到 ⇒ 空串(恢复时会判 wrong-session,fail-closed)。 */
  const q = V.captureViewState('search', { tab: 'list' }, undefined);
  assert.equal(q.chatId, '');
});

test('B4 恢复五态逐条(顺序固定:读不出 → 没捕获 → 会话不符 → 全空 → ok)', () => {
  const S = V.VIEW_STATE_STATES;
  /* 1 形态读不出。 */
  assert.equal(V.restoreViewState('search', '{bad json', 'c').state, S.UNREADABLE);
  assert.equal(V.restoreViewState('search', '{bad json', 'c').why, 'bad-json');
  assert.equal(V.restoreViewState('search', [1, 2], 'c').state, S.UNREADABLE);
  assert.equal(V.restoreViewState('search', 'x', 'c').state, S.UNREADABLE, '字符串但非 JSON');
  assert.equal(V.restoreViewState('', {}, 'c').state, S.UNREADABLE, 'appId 不成立');
  /* 2 从来没捕获过。 */
  assert.equal(V.restoreViewState('search', null, 'c').state, S.NO_SNAPSHOT);
  assert.equal(V.restoreViewState('search', undefined, 'c').state, S.NO_SNAPSHOT);
  /* 3 会话不符 ⇒ 拒绝恢复(**不是**「没有快照」)。 */
  const pack = V.captureViewState('search', { tab: 'list' }, 'chatA');
  const wrong = V.restoreViewState('search', pack, 'chatB');
  assert.equal(wrong.state, S.WRONG_SESSION);
  assert.equal(wrong.ok, false);
  assert.equal(wrong.snapshot, null, '拒绝恢复时不得把快照交出去');
  assert.notEqual(wrong.state, S.NO_SNAPSHOT, '会话不符与「没捕获」不得同形');
  /* 4 捕获过但全空。 */
  const empty = V.captureViewState('search', {}, 'chatA');
  assert.equal(V.restoreViewState('search', empty, 'chatA').state, S.EMPTY);
  /* 5 成了。 */
  const ok = V.restoreViewState('search', pack, 'chatA');
  assert.equal(ok.state, S.OK);
  assert.equal(ok.ok, true);
  assert.equal(ok.snapshot.tab, 'list');
  /* appId 不符 ⇒ 读不出(不是「没有快照」)。 */
  const other = V.captureViewState('memory', { tab: 'x' }, 'chatA');
  assert.equal(V.restoreViewState('search', other, 'chatA').state, S.UNREADABLE);
  assert.equal(V.restoreViewState('search', other, 'chatA').why, 'app-mismatch');
});

test('B5 会话围栏:空串对空串算一致(调用方拿不到身份时唯一不产生错贴的选择)', () => {
  const p = V.captureViewState('search', { tab: 'list' }, '');
  assert.equal(V.restoreViewState('search', p, '').state, V.VIEW_STATE_STATES.OK);
  /* 但「空串 vs 有身份」必须判不符。 */
  assert.equal(V.restoreViewState('search', p, 'chatA').state, V.VIEW_STATE_STATES.WRONG_SESSION);
  const q = V.captureViewState('search', { tab: 'list' }, 'chatA');
  assert.equal(V.restoreViewState('search', q, '').state, V.VIEW_STATE_STATES.WRONG_SESSION);
});

test('B6 needsRequery:只问「有没有查询词」(tab 与它无关)', () => {
  assert.equal(V.needsRequery({ query: '水壶' }), true);
  assert.equal(V.needsRequery({ query: '水壶', tab: 'list' }), true);
  assert.equal(V.needsRequery({ tab: 'list' }), false);
  assert.equal(V.needsRequery({}), false);
  assert.equal(V.needsRequery(null), false);
});

/* ══════════════════ C. 接线面 ══════════════════ */
test('C1 宿主:返回键**逐层退优先**,退不动才回桌面', () => {
  assert.match(shellCode, /backOneLayer\(\) \{/, '必须有 backOneLayer');
  const bind = shellCode.slice(shellCode.indexOf("btn.addEventListener('click'"));
  const bindBody = bind.slice(0, bind.indexOf('});') + 3);
  assert.ok(bindBody.includes('this.backOneLayer()'), '返回键必须先试逐层退');
  assert.ok(bindBody.includes('this.goHome()'), '退不动仍要回桌面(回桌面是最后一档,不取消)');
  /* 顺序:逐层退在前。 */
  assert.ok(bindBody.indexOf('backOneLayer') < bindBody.indexOf('goHome'), '逐层退必须排在回桌面之前');
});

test('C2 宿主:backOneLayer 是**包装既有真源**,不重写返回逻辑', () => {
  const fn = shellCode.slice(shellCode.indexOf('backOneLayer() {'));
  const fnBody = fn.slice(0, fn.indexOf('\n    }'));
  assert.ok(fnBody.includes('this._dispatchSwipeBackWithFallback('),
    '必须调既有真源(压栈/弹栈 + 250/550ms 兜底都在那里)');
  /* 不得自己动 viewHistory(那是真源的活)。 */
  assert.equal(/viewHistory\.pop\(/.test(fnBody), false, '不得自己弹栈');
  assert.equal(/viewHistory\.push\(/.test(fnBody), false, '不得自己压栈');
  /* 归因:覆盖四种情形。 */
  for (const r of ['at-home', 'last-layer', 'no-current-layer', 'dispatch-threw']) {
    assert.ok(fnBody.includes("'" + r + "'"), '必须有归因 ' + r);
  }
  assert.ok(fnBody.includes('ok: true'), '成了必须有回报');
});

test('C3 搜索 App:captureState / restoreState 两口都真接在真源上', () => {
  assert.match(appCode, /captureState\(raw\) \{/);
  assert.match(appCode, /restoreState\(\) \{/);
  assert.ok(appCode.includes("from '../../config/view-state.js';"), '必须消费真源');
  const cap = appCode.slice(appCode.indexOf('captureState(raw) {'));
  const capBody = cap.slice(0, cap.indexOf('\n    }'));
  assert.ok(capBody.includes('captureViewState('), '捕获走真源');
  assert.ok(capBody.includes('this.storage?.set?.'), '真落盘');
  assert.ok(capBody.includes('VIEW_STATE_KEY'), '键名取自字面量常量');
  const res = appCode.slice(appCode.indexOf('restoreState() {'));
  const resBody = res.slice(0, res.indexOf('\n    }'));
  assert.ok(resBody.includes('restoreViewState('), '判定走真源');
  assert.ok(resBody.includes('this.storage?.get?.'), '真读盘');
});

test('C4 搜索视图:**先读快照再画**,且同一会话内重绘不重读', () => {
  const r = viewCode.slice(viewCode.indexOf('render() {'));
  const rBody = r.slice(0, r.indexOf('this._bind();'));
  assert.ok(rBody.includes('this.app.restoreState?.()'), '必须先读快照');
  /* ★ 锚点用 `shell.setContent(`:**首版写 'setContent' 时命中的是守卫行**
   *   `if (!shell?.setContent) return;`(它排在 restoreState 之前)⇒ 判据当场假红。
   *   又一次「判据自己错了,不是实现错了」——故这里取**调用点**而不是那个词。 */
  assert.ok(rBody.indexOf('this.app.restoreState?.()') < rBody.indexOf('shell.setContent('),
    '读快照必须排在画之前(画完再贴会先闪一下空面)');
  assert.ok(rBody.includes('this._restored === null'), '同一会话内不得重读(否则会顶掉用户刚改的词)');
  /* 恢复后把页签与查询词贴回。 */
  assert.ok(rBody.includes('this._scope = s.tab'), '页签要贴回');
  assert.ok(rBody.includes('this._keyword = s.query'), '查询词要贴回');
});

test('C5 搜索视图:输入与来源切换后真的捕获(节流,不用定时器)', () => {
  assert.match(viewCode, /_capture\(\) \{/);
  const cap = viewCode.slice(viewCode.indexOf('_capture() {'));
  const capBody = cap.slice(0, cap.indexOf('\n    }'));
  assert.ok(capBody.includes('this.app.captureState?.('), '捕获走控制器');
  assert.ok(capBody.includes('_lastCaptureAt'), '必须有节流闸门');
  assert.equal(/setTimeout/.test(capBody), false, '不得用定时器(view 不持未登记定时器)');
  /* 两处触发点都在。 */
  const input = viewCode.slice(viewCode.indexOf("input?.addEventListener('input'"));
  assert.ok(input.slice(0, 1200).includes('this._capture()'), '输入后必须捕获');
  const chip = viewCode.slice(viewCode.indexOf("'.gs-chip'"));
  assert.ok(chip.slice(0, 500).includes('this._capture()'), '来源切换后必须捕获');
});

test('C6 换会话必须作废视图里那份内存快照(键前缀只管存储位置)', () => {
  const onChat = appCode.slice(appCode.indexOf('onChatChanged() {'));
  const body = onChat.slice(0, onChat.indexOf('\n    }'));
  assert.ok(body.includes('_restored = null'), '换会话必须丢内存快照');
});

test('C7 键登记:前缀型登记 + 产品面字面量(否则 K3 会判幽灵放行条)', () => {
  const keysSrc = read('scripts/keys-audit.mjs');
  assert.ok(keysSrc.includes("{ key: 'view_state_*'"), '登记必须是前缀型(与既有 _* 同规)');
  assert.ok(appCode.includes("export const VIEW_STATE_KEY = 'view_state_search';"),
    '键名必须以字面量出现在产品面上(抽取器认这一形态)');
});

/* ══════════════════ D. 负控制(真源码破坏 → 同一份判据必须转红) ══════════════════ */
function breakOnce(src, anchor, replacement, tag) {
  const hits = src.split(anchor).length - 1;
  assert.equal(hits, 1, '破坏锚点必须恰中 1 次(实测 ' + hits + '):' + tag);
  return src.replace(anchor, replacement);
}

test('D0 ★★★ 阳性对照:未破坏时四条判据必须全为真(否则 D 组是假绿)', () => {
  assert.equal(/Number\.isFinite\(Number\(/.test(vsCode), false, '纯函数件无弱口径');
  assert.ok(vsCode.includes('if (saved !== cur) {'), '会话围栏在位');
  assert.ok(shellCode.includes('this.backOneLayer()'), '返回键逐层退在位');
  assert.ok(viewCode.includes("this.app.captureState?.("), '捕获真接线');
});

test('D1 ★★★ 破坏「会话围栏」⇒ 同款判据必转红(把上一段的词贴到新会话)', () => {
  const broken = breakOnce(vsCode, '    if (saved !== cur) {', '    if (false) {', 'd1');
  assert.equal(broken.includes('if (saved !== cur)'), false, '破坏副本:已不判会话');
  assert.ok(vsCode.includes('if (saved !== cur)'), '原版必须判会话');
  /* 行为面:原版对阵 A 的快照 + 会话 B 必须拒。 */
  const pack = V.captureViewState('search', { query: '水壶' }, 'chatA');
  assert.equal(V.restoreViewState('search', pack, 'chatB').ok, false, '原版必须拒绝跨会话贴回');
});

test('D2 ★★★ 破坏「返回键逐层退优先」⇒ 同款判据必转红(又直接丢回桌面)', () => {
  const broken = breakOnce(shellCode,
    '            const back = this.backOneLayer();\n            if (!back || back.ok !== true) this.goHome();',
    '            this.goHome();',
    'd2');
  assert.equal(broken.includes('const back = this.backOneLayer();'), false, '破坏副本:已不逐层退');
  assert.ok(shellCode.includes('const back = this.backOneLayer();'), '原版必须逐层退');
});

test('D3 ★★★ 破坏「先读快照再画」⇒ 同款判据必转红(画完再贴会闪)', () => {
  const broken = breakOnce(viewCode,
    "        if (this._restored === null || this._restored === undefined) {",
    '        if (false) {',
    'd3');
  assert.equal(broken.includes('this._restored === null || this._restored === undefined'), false,
    '破坏副本:已不读快照');
  assert.ok(viewCode.includes('this._restored === null || this._restored === undefined'), '原版必须读');
});

test('D4 ★★★ 破坏「换会话作废内存快照」⇒ 同款判据必转红(跨会话串味)', () => {
  /* ★ 锚点取**去注释后的代码**:首版带着行尾那句块注释,
   *   而 stripComments 已把注释剥掉 ⇒ 零命中(破坏锚点必须恰中一次这条纪律当场抛)。 */
  const broken = breakOnce(appCode,
    'if (this.view) this.view._restored = null;',
    'void 0;', 'd4');
  assert.equal(broken.includes('this.view._restored = null'), false, '破坏副本:已不作废');
  assert.ok(appCode.includes('this.view._restored = null'), '原版必须作废');
});

test('D5 ★★★ 破坏「读不出与没保存过分开」⇒ 同款判据必转红', () => {
  const broken = breakOnce(vsCode,
    "        return { ok: false, state: VIEW_STATE_STATES.UNREADABLE, snapshot: null, why: 'bad-json' };",
    "        return { ok: false, state: VIEW_STATE_STATES.NO_SNAPSHOT, snapshot: null, why: 'bad-json' };",
    'd5');
  assert.equal(broken.includes("state: VIEW_STATE_STATES.UNREADABLE, snapshot: null, why: 'bad-json'"), false,
    '破坏副本:读不出已与没保存同形');
  assert.ok(vsCode.includes("state: VIEW_STATE_STATES.UNREADABLE, snapshot: null, why: 'bad-json'"),
    '原版必须分开');
  /* 行为面同款判据。 */
  assert.notEqual(V.restoreViewState('search', '{bad', 'c').state, V.VIEW_STATE_STATES.NO_SNAPSHOT,
    '原版必须把「读不出」与「没保存过」分开');
});

test('D6 ★★★ 破坏「0 是合法滚动位」⇒ 同款判据必转红(读成没给)', () => {
  const broken = breakOnce(vsCode,
    '        if (typeof v === \'number\') return Number.isFinite(v) ? v : null;',
    '        if (typeof v === \'number\') return v ? v : null;',
    'd6');
  assert.equal(broken.includes("return v ? v : null;"), true, '破坏副本:已把 0 读成没给');
  assert.equal(vsCode.includes("return v ? v : null;"), false, '原版必须如实出 0');
  assert.equal(V.normalizeViewSnapshot({ scroll: 0 }).scroll, 0, '原版:0 必须如实出数');
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