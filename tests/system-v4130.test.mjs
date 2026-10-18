/* ============================================================
 * tests/system-v4130.test.mjs -- [v4.13.0 · 第四期 R4-O1 往事答案真正可点开出处]
 *   从「相信一行摘要」变成「点开原文核对」。
 *
 * 【修前实测的缺口(读码可复算,不是推演)】
 *   `apps/memory/memory-view.js::_askFaceHtml` 把答案行的出处渲染成一个**普通 div**
 *   ——`出处:承诺 · 第 12 楼` 只是一行字,**答案行上没有任何跳转按钮**。
 *   而 `config/memory-qa-contract.js::qaRefOf`(能把出处归一)与
 *   `config/open-ref.js::applyOpenRef`(能投跨 App 靶心)**早在仓里**:
 *   全仓实测 `qaRefOf` 只被测试与门禁清单引用,**产品面零命中**。
 *   更根的一层:仓库里**根本没有**「跳到主聊天第 N 楼」这一口
 *   (`grep scrollToFloor / gotoFloor / jumpToFloor` 零命中)——
 *   于是即便视图长出按钮,也没地方可去。
 *
 * 【本版落的三件】一 `config/source-locator.js`(纯函数:六态归一 + 定位手);
 *   二 宿主 `index.js::locateChatFloor`(唯一一口:滚到该楼 + 短促高亮 + 收起手机面板);
 *   三 视图出处行的跳转按钮与它的事件落点(`_srcHtml` / `_goSource`)。
 *
 * 判据面(五组):
 *   A 口径:六态互不同形 / `0` 是合法楼层而「没给」不塌成 0 / 纯函数零副作用
 *   B 行为:normalizeSource 六态 / locateTarget 的「不回报=没成」/ sourceOpenRef 归属
 *   C 接线:宿主口按契约名挂载 / 视图按钮与事件绑定 / 控制器取数口 / 样式两侧投递
 *   D 负控制:真源码定点破坏三条口径 ⇒ 同款判据必转红(配原版必真的反向对照)
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
const LOC_REL = 'config/source-locator.js';
const VIEW_REL = 'apps/memory/memory-view.js';
const APP_REL = 'apps/memory/memory-app.js';
const IDX_REL = 'index.js';
const CSS_REL = 'phone.css';
const APP_CSS_REL = 'apps/memory/memory.css';
const S = await import(pathToFileURL(path.join(ROOT, LOC_REL)).href);
const locSrc = read(LOC_REL);
const viewSrc = read(VIEW_REL);
const appSrc = read(APP_REL);
const idxSrc = read(IDX_REL);
const cssSrc = read(CSS_REL);
const appCssSrc = read(APP_CSS_REL);
/** 去注释后的源码(**判据只认代码,不认注释里的自述** —— 本仓档头纪律要求把设计写进注释,
 *   用裸 includes 扫全文会把「守则」读成「违规」,这是已登记过的假红形态)。 */
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
const viewCode = stripComments(viewSrc);
const appCode = stripComments(appSrc);
const idxCode = stripComments(idxSrc);
const locCode = stripComments(locSrc);

/* ══════════════════ A. 口径面 ══════════════════ */
test('A1 六态**互不同形**:任意两态的字面量都不相同(压平即造出处置相反的处境长得一样)', () => {
  const vals = Object.values(S.LOCATOR_STATES);
  assert.equal(vals.length, 6, '六态:' + vals.join(' / '));
  assert.equal(new Set(vals).size, 6, '六态值必须唯一');
  assert.equal(Object.values(S.LOCATE_METHODS).length, 3);
  assert.equal(new Set(Object.values(S.LOCATE_METHODS)).size, 3);
  /* 各自的人读句子也必须两两不同 —— 「等升级」与「去翻历史楼」压成同一句是本版治的形态。
   *   ★ 传参必须先 `normalizeSource`:`sourceLocatorLine` 吃的是**已归一的靶心**
   *     (`_srcHtml` 里就是这么调的),直接塞原始 `{floor}` 会落进 default 分支 ——
   *     首版判据就是这么写的,当场得到 3 而不是 6(判据自己错了,不是实现错了)。 */
  const lines = new Set([
    S.sourceLocatorLine(S.normalizeSource({ floor: 3, ledger: '约定' })),
    S.sourceLocatorLine(S.normalizeSource({ ref: 'a', ledger: '约定' })),
    S.sourceLocatorLine(S.normalizeSource({ ledger: '约定' })),
    S.sourceLocatorLine(S.normalizeSource({})),
    S.locateResultLine({ ok: false, method: 'none', reason: 'location-unavailable' }),
    S.locateResultLine({ ok: false, method: 'chat-floor', reason: 'not-found' })
  ]);
  assert.equal(lines.size, 6, '六句归因文案必须互不相同:' + Array.from(lines).join(' | '));
});

test('A2 `0` 是**合法楼层**而「没给」不塌成 0(全仓唯一取值门 numOrNull)', () => {
  const zero = S.normalizeSource({ floor: 0, ledger: '约定' });
  assert.equal(zero.state, 'chat');
  assert.equal(zero.floor, 0);
  const zeroStr = S.normalizeSource({ floor: '0' });
  assert.equal(zeroStr.state, 'chat');
  assert.equal(zeroStr.floor, 0);
  for (const missing of [null, undefined, '', '  ', [], {}]) {
    const t = S.normalizeSource({ floor: missing, ledger: '' });
    assert.equal(t.floor, null, '「没给」必须是 null(实测 ' + JSON.stringify(missing) + ')');
    assert.equal(t.state, 'no-target');
  }
  /* 反向面:真给数照常出数(门不得关成「谁都取不到」)。 */
  for (const [v, want] of [[5, 5], ['5', 5], [' 5 ', 5], [3.5, 3.5]]) {
    assert.equal(S.normalizeSource({ floor: v }).floor, want, String(v));
  }
  assert.match(locCode, /import \{ numOrNull \} from '\.\/num-gate\.js';/,
    '楼层取值必须走全仓唯一实现,不得自持一份');
  assert.equal(/Number\.isFinite\(Number\(/.test(locCode), false, '不得出现弱口径签名');
});

test('A3 纯函数:零副作用(不碰 DOM / 不写存储 / 不派事件)', () => {
  for (const bad of ['document', 'window', 'localStorage', 'dispatchEvent', 'setTimeout', 'fetch', 'indexedDB']) {
    assert.equal(new RegExp('\\b' + bad + '\\b').test(locCode), false,
      LOC_REL + ' 不得出现 ' + bad + '(本件是纯函数)');
  }
  /* 反向对照:宿主那一侧**必须**有 DOM 与滚动(它才是执行者)。 */
  assert.ok(idxCode.includes('scrollIntoView'), '宿主定位口必须真滚');
});

test('A4 该去哪 / 去成了没有 —— 两张词表分开,不压成一张', () => {
  assert.equal(S.LOCATOR_STATES.CHAT, 'chat');
  assert.equal(S.LOCATOR_STATES.MEMORY, 'memory');
  assert.equal(S.LOCATOR_STATES.NO_TARGET, 'no-target');
  assert.equal(S.LOCATOR_STATES.REF_INVALID, 'ref-invalid');
  assert.equal(S.LOCATOR_STATES.LOCATION_UNAVAILABLE, 'location-unavailable');
  assert.equal(S.LOCATOR_STATES.NOT_FOUND, 'not-found');
  assert.equal(S.HOST_LOCATE_METHOD, 'locateChatFloor', '宿主契约名是两侧唯一的接线名');
  assert.equal(S.SOURCE_VIEWER.appId, 'summdesk', 'memory 靶心的归属必须是已登记的 summdesk');
});

/* ══════════════════ B. 行为面 ══════════════════ */
test('B1 normalizeSource 六态逐条', () => {
  assert.equal(S.normalizeSource({ floor: 12, ledger: '承诺' }).state, 'chat');
  assert.equal(S.normalizeSource({ ref: 'commit:prom_7', ledger: '承诺' }).state, 'memory');
  assert.equal(S.normalizeSource({ ledger: '承诺' }).state, 'ref-invalid');
  assert.equal(S.normalizeSource({}).state, 'no-target');
  assert.equal(S.normalizeSource(null).state, 'no-target');
  assert.equal(S.normalizeSource([]).state, 'no-target', '数组不是答案项');
  /* 有楼层**优先**跳 chat(楼层是原文本体,九账行只是索引)。 */
  const both = S.normalizeSource({ ref: 'x', floor: 7, ledger: '约定' });
  assert.equal(both.state, 'chat');
  assert.equal(both.floor, 7);
  /* 账名兜底:有账名用账名,没有不臆造翻译。 */
  assert.equal(S.ledgerLabelOf('承诺'), '承诺');
  assert.equal(S.ledgerLabelOf('  '), S.LEDGER_FALLBACK);
  assert.equal(S.normalizeSource({ ref: 'a' }).label, S.LEDGER_FALLBACK);
});

test('B2 isLocatable:只有 chat / memory 两态能去(其余四态一律不能)', () => {
  assert.equal(S.isLocatable(S.normalizeSource({ floor: 3 })), true);
  assert.equal(S.isLocatable(S.normalizeSource({ ref: 'a' })), true);
  assert.equal(S.isLocatable(S.normalizeSource({ ledger: '承诺' })), false);
  assert.equal(S.isLocatable(S.normalizeSource({})), false);
  assert.equal(S.isLocatable(null), false);
});

test('B3 locateTarget 的「**不回报 = 没成**」(本仓最贵的缺陷形态)', () => {
  const target = S.normalizeSource({ floor: 5 });
  /* 宿主口不存在 ⇒ 明说「本版没有定位口」,**不是**「这一楼没了」。 */
  assert.deepEqual(S.locateTarget(target, null),
    { ok: false, method: S.LOCATE_METHODS.NONE, reason: S.LOCATOR_STATES.LOCATION_UNAVAILABLE });
  assert.equal(S.locateTarget(target, {}).reason, S.LOCATOR_STATES.LOCATION_UNAVAILABLE);
  /* 宿主跑了、点了,但没找到 ⇒ not-found(与「没有口」分开)。 */
  const hostMiss = { locateChatFloor: () => ({ ok: false, reason: 'not-found' }) };
  assert.deepEqual(S.locateTarget(target, hostMiss),
    { ok: false, method: S.LOCATE_METHODS.CHAT_FLOOR, reason: 'not-found' });
  /* 宿主**没回报**(返回 undefined / 非对象 / 缺 ok / ok 非布尔)⇒ 一律算没成。 */
  for (const silent of [undefined, null, 42, 'ok', {}, { ok: 'yes' }, { ok: 1 }]) {
    const r = S.locateTarget(target, { locateChatFloor: () => silent });
    assert.equal(r.ok, false, '没回报不得判成: ' + JSON.stringify(silent));
    assert.equal(r.reason, 'host-silent');
  }
  /* 宿主抛错 ⇒ 如实归因,不冒泡。 */
  assert.equal(S.locateTarget(target, { locateChatFloor: () => { throw new Error('boom'); } }).reason, 'thrown');
  /* 成了:只有 ok === true 才算。 */
  const hostOk = { locateChatFloor: (f, o) => ({ ok: true, f, o }) };
  const ok = S.locateTarget(target, hostOk);
  assert.equal(ok.ok, true);
  assert.equal(ok.method, S.LOCATE_METHODS.CHAT_FLOOR);
});

test('B4 locateTarget 把 floor 与账名原样交给宿主(不在这里替它判什么)', () => {
  const seen = [];
  const host = { locateChatFloor: (f, o) => { seen.push([f, o]); return { ok: true }; } };
  S.locateTarget(S.normalizeSource({ floor: 0, ledger: '约定', ref: 'x' }), host);
  assert.deepEqual(seen[0], [0, { ref: 'x', ledger: '约定' }], '0 楼必须原样交出去');
});

test('B5 locateTarget 对 memory 靶心只回报「走 open-ref 通道」,**不假装投过**', () => {
  const r = S.locateTarget(S.normalizeSource({ ref: 'commit:prom_7' }), null);
  assert.equal(r.ok, true);
  assert.equal(r.method, S.LOCATE_METHODS.OPEN_REF);
  /* 非可投态一律 none + 该态名(不与「没口」混)。 */
  const bad = S.locateTarget(S.normalizeSource({ ledger: '承诺' }), null);
  assert.equal(bad.ok, false);
  assert.equal(bad.reason, S.LOCATOR_STATES.REF_INVALID);
});

test('B6 sourceOpenRef 照登记面写字(归属一致,否则 open-ref 会判 mismatch 不投)', () => {
  const ref = S.sourceOpenRef(S.normalizeSource({ ref: 'commit:prom_7' }));
  assert.deepEqual(ref, { appId: 'summdesk', kind: 'memory', id: 'commit:prom_7' });
  assert.equal(S.sourceOpenRef(S.normalizeSource({ floor: 3 })), null, 'chat 靶心不走跨 App');
  assert.equal(S.sourceOpenRef(S.normalizeSource({})), null);
  /* 与登记面交叉核对:kind 'memory' 的归属必须真的是 summdesk。 */
  const openRefSrc = read('config/open-ref.js');
  assert.match(openRefSrc, /memory:\s*Object\.freeze\(\{\s*appId:\s*'summdesk'/,
    "kind 'memory' 的归属必须在 config/open-ref.js 登记为 summdesk");
});

/* ══════════════════ C. 接线面 ══════════════════ */
test('C1 宿主侧:`locateChatFloor` 真实现,且按**契约常量**挂载(不手写字面量)', () => {
  assert.match(idxCode, /function locateChatFloor\(floor, opts = \{\}\) \{/,
    '宿主必须有这一口的真实实现');
  assert.match(idxCode, /import \{ HOST_LOCATE_METHOD \} from '\.\/config\/source-locator\.js';/,
    '挂载名必须取自契约常量');
  assert.match(idxCode, /window\.VirtualPhone\[HOST_LOCATE_METHOD\] = locateChatFloor;/,
    '挂载点只有一处,且用常量做键');
  assert.equal((idxCode.match(/window\.VirtualPhone\[HOST_LOCATE_METHOD\]/g) || []).length, 1,
    '挂载点不得重复(重复即两处各写一份口径)');
  /* 宿主口必须过楼层取值门:0 是合法楼层。 */
  const body = idxCode.slice(idxCode.indexOf('function locateChatFloor('));
  const fnBody = body.slice(0, body.indexOf('\n    }'));
  assert.ok(fnBody.includes('stFloorOrNull(floor)'), '必须过楼层取值门');
  assert.ok(fnBody.includes('mesid="'), '必须真按楼层找 DOM 元素');
  assert.ok(fnBody.includes("reason: 'chat-unavailable'"), '取不到上下文要与「楼没了」分开');
  assert.ok(fnBody.includes("reason: 'not-rendered'"), '未渲染要与「楼没了」分开');
});

test('C2 视图侧:出处行给按钮,且按钮**真的被绑定**(不是渲染出来没人管)', () => {
  /* 渲染侧:按钮 + data-src 载荷。 */
  assert.ok(viewCode.includes('mem-src-go'), '出处行必须有跳转按钮');
  assert.ok(viewCode.includes('data-src="'), '按钮必须携带原始出处载荷');
  assert.ok(viewCode.includes('_srcHtml(normalizeSource(a || {}), a)'), '答案行必须经归一后排版');
  /* 只有能去的两态才给按钮。 */
  assert.ok(viewCode.includes('if (isLocatable(target))'), '不可投态不得给按钮');
  /* 事件侧:容器级委托里真消费。 */
  assert.ok(viewCode.includes("const srcBtn = e.target.closest('.mem-src-go');"),
    '按钮必须有事件落点');
  assert.ok(viewCode.includes('this._goSource(srcBtn);'), '落点必须真调处理函数');
  assert.equal((viewCode.match(/_goSource\(btn\) \{/g) || []).length, 1, '_goSource 只许一份实现');
});

test('C3 视图侧:两类靶心分派互不相同(memory 走跨 App 事件 / chat 走控制器取数口)', () => {
  const go = viewCode.slice(viewCode.indexOf('_goSource(btn) {'));
  const goBody = go.slice(0, go.indexOf('_doSearch()'));
  assert.ok(goBody.includes("target.state === 'memory'"), 'memory 靶心走跨 App 事件');
  assert.ok(goBody.includes('phone:openApp'), 'memory 靶心派 openApp');
  assert.ok(goBody.includes('sourceOpenRef(target)'), '必须用真源那支笔写 ref');
  assert.ok(goBody.includes('this.app.locateSource?.(raw)'), 'chat 靶心走控制器取数口');
  /* 失败必须出声:静默吞掉即「点了没反应」。 */
  assert.ok(goBody.includes('locateResultLine('), '定位失败必须念出那一态的原话');
});

test('C4 控制器侧:`locateSource` 是一口,且只转交(不自己判形态、不碰 DOM)', () => {
  assert.match(appCode, /locateSource\(raw\) \{/, '控制器必须有这一口');
  assert.ok(appCode.includes("from '../../config/source-locator.js';"),
    '控制器必须消费真源,不自写一份');
  const body = appCode.slice(appCode.indexOf('locateSource(raw) {'));
  const fnBody = body.slice(0, body.indexOf('\n  }'));
  assert.ok(fnBody.includes('normalizeSource(raw'), '归一走真源');
  assert.ok(fnBody.includes('locateTarget(target, host)'), '定位走真源');
  assert.equal(/document\./.test(fnBody), false, '取数层不得碰 DOM(视图纪律)');
});

test('C5 跨 App 靶心的派发**不手写 ref 字面量**(归属登记面只有一处)', () => {
  const go = viewCode.slice(viewCode.indexOf('_goSource(btn) {'));
  const goBody = go.slice(0, go.indexOf('_doSearch()'));
  assert.equal(/kind:\s*'memory'/.test(goBody), false, '不得在视图里手写 kind(那会与登记面漂开)');
  assert.match(locCode, /return \{ appId: SOURCE_VIEWER\.appId, kind: 'memory', id: t\.id \};/,
    '唯一一处手写归属必须在纯函数件里,且取 SOURCE_VIEWER 常量');
});

test('C6 样式两侧投递 + 宿主高亮类名与样式同名', () => {
  for (const [name, src] of [['phone.css', cssSrc], ['apps/memory/memory.css', appCssSrc]]) {
    assert.ok(src.includes('.mem-src-go'), name + ' 必须投递 .mem-src-go 样式');
  }
  assert.ok(cssSrc.includes('#chat .mes.mes-located-flash'), '宿主高亮样式必须在 phone.css 里');
  assert.ok(cssSrc.includes('@keyframes rp-locate-flash'), '高亮动画必须真定义');
  /* 宿主侧真加上这个类名(样式与行为必须同一名)。 */
  assert.ok(idxCode.includes('mes-located-flash'), '宿主必须真加高亮类');
});

/* ══════════════════ D. 负控制(真源码破坏 → 同一份判据必须转红) ══════════════════ */
/** 真源码破坏:锚点必须**恰中一次**;破坏落在**副本字符串**上(绝不动真仓)。 */
function breakOnce(src, anchor, replacement, tag) {
  const hits = src.split(anchor).length - 1;
  assert.equal(hits, 1, '破坏锚点必须恰中 1 次(实测 ' + hits + '):' + tag);
  return src.replace(anchor, replacement);
}

test('D0 ★★★ 阳性对照:未破坏时三条判据必须全为真(否则 D 组是假绿)', () => {
  /* 判据1:纯函数件不得出现弱口径签名。 */
  assert.equal(/Number\.isFinite\(Number\(/.test(locCode), false);
  /* 判据2:宿主挂载必须走契约常量。 */
  assert.ok(idxCode.includes('window.VirtualPhone[HOST_LOCATE_METHOD] = locateChatFloor;'));
  /* 判据3:视图必须有真事件落点。 */
  assert.ok(viewCode.includes('this._goSource(srcBtn);'));
});

test('D1 ★★★ 破坏「楼层取值走唯一门」⇒ 同款判据必转红(弱口径回归)', () => {
  const broken = breakOnce(locCode,
    "import { numOrNull } from './num-gate.js';",
    "const numOrNull = (v) => Number.isFinite(Number(v)) ? Number(v) : null;",
    'd1');
  assert.equal(/Number\.isFinite\(Number\(/.test(broken), true, '破坏副本必须出现弱口径签名');
  assert.equal(/Number\.isFinite\(Number\(/.test(locCode), false, '原版必须干净');
  /* 行为面同款判据:弱口径下「没给」会塌成 0 楼 —— 那正是本版要拦的形态。 */
  const WeakPain = (v) => Number.isFinite(Number(v)) ? Number(v) : null;
  assert.equal(WeakPain(null), 0, '弱口径把 null 读成 0(与「就在第 0 楼」同形)');
  assert.equal(S.normalizeSource({ floor: null }).floor, null, '真源必须如实 null');
});

test('D2 ★★★ 破坏「宿主口按契约常量挂载」⇒ 同款判据必转红(手写字面量)', () => {
  const broken = breakOnce(idxCode,
    'window.VirtualPhone[HOST_LOCATE_METHOD] = locateChatFloor;',
    'window.VirtualPhone.locateChatFloor = locateChatFloor;',
    'd2');
  assert.equal(broken.includes('window.VirtualPhone[HOST_LOCATE_METHOD]'), false,
    '破坏副本:已不再用契约常量');
  assert.ok(idxCode.includes('window.VirtualPhone[HOST_LOCATE_METHOD]'), '原版必须用常量');
  /* 交叉核对:常量值必须真是那个名字,否则「用常量」也只是形式。 */
  assert.equal(S.HOST_LOCATE_METHOD, 'locateChatFloor');
});

test('D3 ★★★ 破坏「不回报 = 没成」⇒ 同款判据必转红(静默当成功)', () => {
  const broken = breakOnce(locSrc,
    "    return { ok: false, method: LOCATE_METHODS.CHAT_FLOOR, reason: 'host-silent' };",
    "    return { ok: true, method: LOCATE_METHODS.CHAT_FLOOR, reason: '' };",
    'd3');
  assert.equal(broken.includes("reason: 'host-silent'"), false, '破坏副本:已不再有静默态');
  assert.ok(locSrc.includes("reason: 'host-silent'"), '原版必须有静默态');
  /* 真源码行为面同款判据:在原版模块上,宿主没回报必须算没成。 */
  const silentHost = { locateChatFloor: () => undefined };
  assert.equal(S.locateTarget(S.normalizeSource({ floor: 3 }), silentHost).ok, false,
    '原版:宿主没回报必须算没成');
});

test('D4 ★★★ 破坏「只有能去的两态才给按钮」⇒ 同款判据必转红(不可投也给按钮)', () => {
  const broken = breakOnce(viewCode,
    'if (isLocatable(target)) {',
    'if (target) {',
    'd4');
  assert.equal(broken.includes('if (isLocatable(target))'), false, '破坏副本:已不再判可投性');
  assert.ok(viewCode.includes('if (isLocatable(target))'), '原版必须判可投性');
  /* 同款判据:不可投态确实不该给按钮。 */
  assert.equal(S.isLocatable(S.normalizeSource({ ledger: '承诺' })), false,
    '「有账名没有引用键」不得可点(它去了也没落点)');
});

test('D5 ★★★ 破坏「memory 靶心不假装投过」⇒ 同款判据必转红', () => {
  const broken = breakOnce(locSrc,
    '        return { ok: true, method: LOCATE_METHODS.OPEN_REF, reason: \'\' };',
    '        return { ok: false, method: LOCATE_METHODS.OPEN_REF, reason: \'open-ref\' };',
    'd5');
  assert.equal(broken.includes("method: LOCATE_METHODS.OPEN_REF, reason: ''"), false,
    '破坏副本:已不再回报「交给 open-ref 通道」');
  assert.ok(locSrc.includes("method: LOCATE_METHODS.OPEN_REF, reason: ''"), '原版必须这一形');
});

/* ══════════════════ E. 版本锚(下限形) ══════════════════ */
test('E1 版本锚:三源一致且当版条目存在(不锁死具体版本号)', () => {
  const pkg = JSON.parse(read('package.json'));
  const man = JSON.parse(read('manifest.json'));
  const log = JSON.parse(read('update-log.json'));
  const ver = pkg.version;
  assert.match(ver, /^\d+\.\d+\.\d+$/);
  assert.equal(man.version, ver, 'manifest 必须与 package 同版');
  assert.equal(log.latest, ver, 'update-log.latest 必须与 package 同版');
  assert.equal(log.head, ver);
  assert.ok(log.versions[ver], '当版条目必须存在');
  assert.ok(Array.isArray(log.versions[ver].items) && log.versions[ver].items.length >= 8,
    '当版条目数不得低于下限');
  assert.ok(idxSrc.includes("const ST_PHONE_VERSION = '" + ver + "';"), 'index.js 常量必须同版');
});