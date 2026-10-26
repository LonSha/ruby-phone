/* ============================================================
 * tests/system-v4900.test.mjs — v4.90.0 第十批缝入（三件内核）
 * ------------------------------------------------------------
 * 判据分六面：
 *   A 面 版本锚（五源同源）+ 三件内核自检自包含
 *   B 面 来源许可：规范化两向 / 双上限 / 四类归因 / 非 worldbook 直通 / inspect 三因
 *   C 面 剧情时间相对化：双型解析 / 半月边界 / 历法前缀跳口语档 / 三态归因
 *   D 面 条目设置：夹紧两向 / 枚举回落 / 三色语义 / outletName 条件写 / 标题回环
 *   E 面 接线：注入吃排除表 / 写入吃设置面 / 记忆块前缀与时间线 storyAge
 *   F 面 中枢与负控制：三件在同步表且各有现场读数；真源码破坏两向
 *
 * 【为什么这三件必须进同步表（本版最容易被写成假绿的地方）】
 *   三件都零 IO、不看时钟、不 await。挂进 `_kernelAsyncChecks` 会让 `res.ok === true`
 *   恒不成立 —— 不是报错，是**真绿变假红**（v4.89.0 已付过一次代价）。本套件钉住两件事：
 *   ① 三件在 `_kernelChecks()` 里（同步表）；② 三件各自产出**非空现场读数**（空参调用
 *   只会得到「无读数」，那等于没读数）。
 *
 * 【负控制形式纪律（本仓三形假绿，逐条避开）】
 *   ① 对原文件断言 ② 破坏写死成模拟常量 ③ 破坏把判据自己删了。
 *   统一修法：真源码破坏（锚点恰中 1 次）→ data: URL 装载破坏副本 → 在副本上重跑同款判据，
 *   并对原版跑同一判据证明判据真、对破坏副本证明它假。两向都要。
 * ============================================================ */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const rel = (p) => path.join(ROOT, p);
const read = (p) => fs.readFileSync(rel(p), 'utf8');
const BORN_V = '4.90.0';
/* 三件内核（前两件零 import，可 data: URL 装载副本；第三件引 num-gate，走临时文件装载） */
import * as SP from '../config/source-permission.js';
import * as TR from '../config/story-time-rel.js';
import * as ES from '../config/worldbook-entry-settings.js';
import { SubsystemOrchestrator } from '../config/subsystem-orchestrator.js';
import { WorldbookManager } from '../config/worldbook-manager.js';

/* ══════════════════ A 版本锚与自包含 ══════════════════ */
test('A1: 五源版本同源且不低于 4.90.0', () => {
  /* [v4.91.0 交棒改写] 本版出生时五源都是 4.90.0，原判据写的是等值锚 —— 抬版即红（那是抬版仪式，
   *   不是缺陷）。按仓内既定口径换成**下限形**：五源必须彼此一致、且都不低于诞生版（不回退即可），
   *   「当版是否等于某值」由当版套件（tests/system-v4910.test.mjs 的 A1）接管。 */
  const sem = (v) => String(v).split('.').map(Number).reduce((a, x) => a * 1000 + x, 0);
  const pkg = JSON.parse(read('package.json')).version;
  const man = JSON.parse(read('manifest.json')).version;
  const log = JSON.parse(read('update-log.json'));
  const idx = read('index.js');
  const led = JSON.parse(read('tests/audit/status-ledger.json'));
  const five = [pkg, man, log.latest, log.head, led.version];
  assert.equal(new Set(five).size, 1, '五源必须彼此一致：' + five.join('/'));
  for (const v of five) assert.ok(sem(v) >= sem(BORN_V), '不得低于诞生版 ' + BORN_V + '，实得 ' + v);
  assert.match(idx, new RegExp("const ST_PHONE_VERSION = '" + pkg.replace(/\./g, '\\.') + "';"), '入口常量必须与五源一致');
  assert.equal(led.version_same, true, '账本自评必须为同源');
  for (const [k, v] of Object.entries(led.version_sources)) {
    assert.equal(v, pkg, '账本来源 ' + k + ' 必须与五源同源');
  }
  /* 公告块装的是**当版**条目，抬版后本版条目自然不在里面了 —— 故这里不逐条比对，
   *   只锁两件不回退的事实：本版台账条目仍在、本版迭代段不可抹；公告块只查当版形态。
   *   「当版条目与公告块逐条一致」由当版套件 A1 接管。 */
  const items = (log.versions[BORN_V] || {}).items || [];
  assert.ok(items.length >= 8, '本版台账条目不得缩水，实得 ' + items.length);
  assert.ok(read('ITERATION_LOG.md').includes('## 迭代 216 · v4.90.0'), '本版迭代段不可抹');
  assert.ok(idx.includes('版本升至 ' + pkg), '公告块必须带当版收尾条');
  const annBody = idx.slice(idx.indexOf('items: [')).split('\n    ]')[0];
  assert.ok(annBody.split('\n        "').length - 1 >= 8, '当版公告块至少 8 条');
});

test('A2: 三件内核自检自绿且零问题', () => {
  for (const [m, name] of [[SP, 'sourcePermissionSelfCheck'], [TR, 'storyTimeRelSelfCheck'], [ES, 'worldbookEntrySettingsSelfCheck']]) {
    const r = m[name]();
    assert.equal(r.ok, true, name + ' 必须自绿：' + JSON.stringify(r.problems));
    assert.deepEqual(r.problems, [], name + ' 不得有问题项');
  }
});

test('A3: 前两件零 import（故可 data: URL 装副本），第三件只引数值门', () => {
  assert.ok(!/^import\s/m.test(read('config/source-permission.js')), '来源许可必须零 import');
  assert.ok(!/^import\s/m.test(read('config/story-time-rel.js')), '相对时间必须零 import');
  const imports = read('config/worldbook-entry-settings.js').match(/^import .*$/gm) || [];
  assert.equal(imports.length, 1, '条目设置只该引一个模块，实得 ' + imports.length);
  assert.ok(imports[0].includes('num-gate'), '且必须是数值门（W1 单一实现）');
});

/* ══════════════════ B 来源许可 ══════════════════ */
test('B1: 规范化两向 —— 全角 / 重音 / 大小写同键，中间空白不被吃', () => {
  assert.equal(SP.canonicalBookName('ＴＯＭＢ'), SP.canonicalBookName('tomb'));
  assert.equal(SP.canonicalBookName('Émile'), SP.canonicalBookName('Emile'));
  assert.equal(SP.canonicalBookName('  海 边  '), SP.canonicalBookName('海 边'));
  assert.notEqual(SP.canonicalBookName('a b'), SP.canonicalBookName('ab'));
});

test('B2: 排除表归一 —— 去空 / 去重 / 剔超长 / 截断到 2000', () => {
  const norm = SP.normalizeExcludedBooks(['A', '', ' a ', null, 7, 'x'.repeat(1300), 'B']);
  assert.deepEqual(norm, ['A', 'B'], '空 / 重复 / 非字符串必须剔，首现原文保留');
  const many = SP.normalizeExcludedBooks(Array.from({ length: 2100 }, (_, i) => 'b' + i));
  assert.equal(many.length, SP.SOURCE_PERMISSION_LIMITS.excludedBooks, '必须截断到上限');
});

test('B3: 过滤四类归因各自可分，非 worldbook 直通，认不出书名排除', () => {
  const res = SP.filterSourcesByPermission({
    excludedBooks: ['Bad Book'],
    candidates: [
      { kind: 'worldbook', world: 'Bad Book' },
      { kind: 'worldbook', world: 'Good Book' },
      { kind: 'memory', world: 'Bad Book' },
      { kind: 'worldbook' },
      { kind: 'worldbook', world: 'Off', hostEnabled: false },
      { kind: 'worldbook', world: 'Off2', availability: 'disabled' },
      null
    ]
  });
  assert.equal(res.kept.length, 2, '只该留 Good Book 与 memory 条，实得 ' + res.kept.length);
  assert.ok(res.kept.some((c) => c.kind === 'memory'), '非 worldbook 必须直通（它有书名也不行）');
  const reasons = res.dropped.map((d) => d.reason).sort();
  assert.deepEqual(reasons, ['excluded-book', 'host-disabled', 'host-disabled', 'no-book', 'not-object'],
    '四类因必须各自留痕：' + reasons.join(','));
});

test('B4: 空表全通 / 书名过滤按规范化 / 读数分态', () => {
  const pass = SP.filterSourcesByPermission({ candidates: [{ kind: 'worldbook', world: 'X' }] });
  assert.equal(pass.kept.length, 1);
  assert.equal(pass.dropped.length, 0);
  const names = SP.filterBookNamesByPermission({ bookNames: ['A', 'a', 'B'], excludedBooks: ['B'] });
  assert.deepEqual(names, ['A', 'a'], '只按规范化排 B，大小写两个 A 都留');
  const line = SP.sourcePermissionLine(SP.filterSourcesByPermission({ excludedBooks: ['X'], candidates: [{ kind: 'worldbook', world: 'X' }] }));
  assert.match(line, /按书名排除 1/, '读数必须报出排除数：' + line);
  assert.match(line, /留下 0/, '读数必须报出留下数');
});

test('B5: inspect 三因分形（换会话 / 换宿主 / 缺号）', () => {
  assert.equal(SP.inspectVerdict({ chatId: 'c1', hostChatId: 'h1' }, { chatId: 'c1', hostChatId: 'h1' }).status, 'ready');
  assert.equal(SP.inspectVerdict({ chatId: 'c1' }, { chatId: 'c2' }).reason, 'chat-changed');
  assert.equal(SP.inspectVerdict({ chatId: 'c1', hostChatId: 'h1' }, { chatId: 'c1', hostChatId: 'h2' }).reason, 'host-chat-changed');
  assert.equal(SP.inspectVerdict({}, { chatId: 'c1' }).reason, 'no-chat-id');
});

test('B6: 许可键三级回退（直给 / world::uid / locator 末段）', () => {
  assert.equal(SP.permissionKeyOf({ permissionKey: 'x::1' }), 'x::1');
  assert.equal(SP.permissionKeyOf({ world: 'w', uid: '3' }), 'w::3');
  assert.equal(SP.permissionKeyOf({ locator: 'file:9:u' }), 'file:9::u');
  assert.equal(SP.bookNameOf({ locator: 'file:9:u' }), 'file:9');
});

/* ══════════════════ C 剧情时间相对化 ══════════════════ */
test('C1: 中文数字两向（该认的认，超范围与空不硬凑）', () => {
  assert.equal(TR.parseStoryDate('元持十二年八月二十一日').day, 21, '中文纪年必须解析到日');
  assert.equal(TR.parseStoryDate('元持十二年八月二十一日').calendarPrefix, '元持');
  assert.equal(TR.parseStoryDate('霜月3日').type, 'fantasy');
  assert.equal(TR.parseStoryDate('3727年★9月30日'), null, '写了年份残欠缺月日必须 null');
});

test('C2: 天数差与档位边界（含 29 / 30 天成对）', () => {
  assert.equal(TR.calculateRelativeDays('2024/3/1', '2024/3/1'), 0);
  assert.equal(TR.calculateRelativeDays('2023/3/1', '2024/3/1'), 366, '闰年必须精确');
  assert.equal(TR.relativeTimeLabel('2024/3/30', '2024/3/1'), '29天后', '未满 30 天仍是天档');
  assert.equal(TR.relativeTimeLabel('2024/3/31', '2024/3/1'), '1个月后', '满 30 天必须翻月档');
  assert.equal(TR.relativeTimeLabel('2024/3/4', '2024/3/1'), '大后天');
});

test('C3: 历法前缀跳过周 / 月 / 年口语档，近距仍是天档', () => {
  assert.equal(TR.relativeTimeLabel('元持十一年三月一日', '元持十二年三月一日'), '1年前', '带前缀跨年走通用年档');
  assert.equal(TR.relativeTimeLabel('元持十一年三月一日', '元持十一年三月九日'), '8天前', '带前缀近距仍是天档');
  assert.equal(TR.weekdayLabel('元持十二年八月二十一日'), '', '带前缀不给周几');
  assert.match(TR.weekdayLabel('2024/3/1'), /^周[日一二三四五六]$/, '公历带年才给周几');
});

test('C4: 三态归因互不同形，读数不说谎', () => {
  assert.equal(TR.storyTimeAge('', '2024/3/1').reason, 'no-event-time');
  assert.equal(TR.storyTimeAge('2024/3/1', '').reason, 'no-now-time');
  assert.equal(TR.storyTimeAge('霜月3日', '雪月9日').reason, 'cross-fantasy-month');
  assert.equal(TR.storyTimeAge('乱写', '2024/3/1').reason, 'event-unparsed');
  assert.ok(TR.reasonLabel('event-unparsed') !== TR.reasonLabel('cross-fantasy-month'));
  assert.match(TR.storyTimeLine({}), /没跑过/);
  assert.match(TR.storyTimeLine({ labeled: 0, skipped: 0 }), /没跑过/);
  assert.match(TR.storyTimeLine({ labeled: 2, skipped: 1, byReason: { ok: 2, 'event-unparsed': 1 } }), /事件时间解析不出 1/);
});

/* ══════════════════ D 条目设置 ══════════════════ */
test('D1: order 与 reverseStart 夹紧两向，不可判定回 fallback', () => {
  assert.equal(ES.clampOrderValue(99999), ES.ORDER_MAX);
  assert.equal(ES.clampOrderValue(-5), ES.ORDER_MIN);
  assert.equal(ES.clampOrderValue('37'), 37, '数字串必须同形');
  assert.equal(ES.clampOrderValue('  '), 100, '空串回 fallback（不得当 0）');
  assert.equal(ES.clampReverseStart(1), ES.REVERSE_START_MIN);
  assert.equal(ES.clampReverseStart(500), 500);
});

test('D2: 位置合法集与 fallback，非线性枚举回落', () => {
  assert.equal(ES.normalizePosition(7), 7);
  assert.equal(ES.normalizePosition(4), 0, '空档位 4 必须回 0');
  assert.equal(ES.normalizePosition(4, 7), 7, '合法 fallback 必须被用');
  assert.equal(ES.normalizePosition(4, 44), 0, '非法 fallback 回 0');
  assert.equal(ES.normalizeOrderMode('MANUAL'), 'manual');
  assert.equal(ES.normalizeOrderMode('乱写'), 'auto');
});

test('D3: 三色语义与 outletName 条件写（非 outlet 位必须删）', () => {
  const blue = {}; ES.applyLorebookEntrySettings(blue, { constVectMode: 'blue' }, { orderNumber: 1 });
  assert.equal(blue.constant, true); assert.equal(blue.vectorized, false);
  const green = {}; ES.applyLorebookEntrySettings(green, { constVectMode: 'green' }, { orderNumber: 1 });
  assert.equal(green.constant, false); assert.equal(green.vectorized, false);
  const link = {}; ES.applyLorebookEntrySettings(link, {}, { orderNumber: 1 });
  assert.equal(link.vectorized, true);
  const outlet = {}; ES.applyLorebookEntrySettings(outlet, { position: 7, outletName: ' 出口 ' }, { orderNumber: 1 });
  assert.equal(outlet.outletName, '出口');
  const noOutlet = { outletName: '残留' };
  ES.applyLorebookEntrySettings(noOutlet, { position: 1 }, { orderNumber: 1 });
  assert.ok(!('outletName' in noOutlet), '非 outlet 位必须删字段');
});

test('D4: 标题占位按源表（单层方括号被吃、双层退单层），格式化→反解回环', () => {
  assert.equal(ES.formatEntryTitleAtNumber('[000] - {{title}}', 7), '007 - {{title}}');
  assert.equal(ES.formatEntryTitleAtNumber('[[000]] - {{title}}', 7), '[007] - {{title}}');
  assert.equal(ES.formatEntryTitleAtNumber('[[000]] / [[000]] - {{title}}', 3), '[003] / [003] - {{title}}', '同写法必须全换');
  assert.equal(ES.formatEntryTitleAtNumber('无占位', 7, { forceNumber: true }), '[007] 无占位');
  for (const [fmt, seq] of [['[[000]] - {{title}}', 7], ['[000] - {{title}}', 12], ['#[000] - {{title}}', 3]]) {
    const gen = ES.formatEntryTitleAtNumber(fmt, seq);
    assert.equal(ES.numberFromFormattedTitle(gen, fmt), seq, '必须反解自己生成的标题：' + gen);
  }
  assert.equal(ES.nextEntryNumber([{ comment: '3 - a' }, { comment: '7 - b' }], '[000] - {{title}}'), 8);
  assert.equal(ES.nextEntryNumber([{ comment: '第一次约会' }], '[000] - {{title}}'), 1, '内容数字不得当序号');
});

test('D5: 净化剥控制字符、保 Unicode、剥空兜底；正文与 uid 不被碰', () => {
  assert.equal(ES.sanitizeEntryTitle('a\u0001b\u009Fc'), 'abc');
  assert.equal(ES.sanitizeEntryTitle('汉字🎐全角（）'), '汉字🎐全角（）');
  assert.equal(ES.sanitizeEntryTitle(''), '自动记忆');
  const kept = { content: '正文', uid: 9, comment: '标题' };
  ES.applyLorebookEntrySettings(kept, {}, { orderNumber: 1 });
  assert.equal(kept.content, '正文'); assert.equal(kept.uid, 9); assert.equal(kept.comment, '标题');
});

test('D6: 白名单铺默认（数组拷贝、null 默认写进去）', () => {
  const e = {}; ES.applyLorebookEntrySettings(e, {}, { orderNumber: 1 });
  assert.equal(e.depth, 4);
  assert.ok(Array.isArray(e.keysecondary) && e.keysecondary !== ES.CONTROLLED_FIELD_DEFAULTS.keysecondary);
  assert.ok(Object.prototype.hasOwnProperty.call(e, 'scanDepth') && e.scanDepth === null);
  assert.equal(e.displayIndex, 1); assert.equal(e.stmemorybooks, true);
});

/* ══════════════════ E 接线 ══════════════════ */
function probeManager() {
  const m = new WorldbookManager(null);
  const store = new Map();
  m.storage = { get: (k, d) => (store.has(k) ? store.get(k) : d), set: async (k, v) => { store.set(k, v); } };
  m.getEnabled = () => true;
  m._getCharacterScopeKey = () => 't';
  m._loadWorldContent = async (s) => ({ ...s, allEntries: [{ uid: 1, content: 'x', comment: 'c', enabled: true }] });
  m.listAvailableWorldbooks = async () => [{ id: 'world:A', name: 'A书' }, { id: 'world:B', name: 'B书' }];
  m.getSelectionState = () => ({ initialized: true, ids: ['world:A', 'world:B'], entryIdsBySource: {} });
  m.matchesSelection = (s, ids) => ids.includes(s.id);
  return m;
}
test('E1: 排除表真拦住注入（排一本少一本，恢复即回来）', async () => {
  const m = probeManager();
  await m.setBookExcluded('t', 'A书', true);
  assert.equal((await m.buildWorldbookMessages('t')).length, 1, '排掉一本后只该出另一本');
  await m.setBookExcluded('t', 'A书', false);
  assert.equal((await m.buildWorldbookMessages('t')).length, 2, '恢复后两本都回来');
  await m.setExcludedBooks('t', ['A书']);
  assert.equal(m.getExcludedBooks('t').length, 1);
  assert.equal((await m.buildWorldbookMessages('t')).length, 1);
});

test('E2: 未做条目级选择时整本放行（勾了却零注入是既有缺陷）', () => {
  const m = probeManager();
  const src = { id: 'world:B', name: 'B书', allEntries: [{ uid: 1, content: 'x', comment: 'c', enabled: true }, { uid: 2, content: 'y', comment: 'd', enabled: false }] };
  const r = m._resolveSourceEntrySelection({ initialized: true, ids: ['world:B'], entryIdsBySource: {} }, src);
  assert.deepEqual(r.selectedIds, ['1'], '未显式配置时必须放行全部启用条目（禁用条目除外）');
  const r2 = m._resolveSourceEntrySelection({ initialized: true, ids: ['world:B'], entryIdsBySource: { 'world:B': ['2'] } }, src);
  assert.deepEqual(r2.selectedIds, ['2'], '显式配置后以配置为准');
});

test('E3: 写入过设置面（标题带序号、设置位落位），replaced 不动', async () => {
  const m = probeManager();
  let saved = null;
  m._loadWorldInfoViaFrontendModule = async () => ({ entries: { 0: { uid: 0, comment: '用户手写', content: '老内容', position: 5 } } });
  m._saveWorldInfo = async (_n, d) => { saved = d; return true; };
  m._refreshWorldInfoCache = async () => true;
  const res = await m.writeMemoryEntries('书', [{ comment: '第一件事', content: '内容一' }]);
  assert.equal(res.ok, true);
  const added = Object.values(saved.entries).find((e) => e.uid !== 0);
  assert.match(added.comment, /^001 - 第一件事$/, '标题必须带序号且保留原标题');
  assert.equal(added.position, 0);
  assert.equal(added.order, 1);
  assert.equal(added.displayIndex, 1);
  const user = Object.values(saved.entries).find((e) => e.uid === 0);
  assert.equal(user.position, 5, '用户手写条目的 position 不得被设置面重铺');
  assert.match(m._lastEntrySettingsLine, /条目设置：/, '设置读数必须留格');
});

test('E4: 记忆块前缀剧情距离、算不出不写前缀、时间线给 storyAge', async () => {
  const { MemoryCore } = await import('../apps/memory/memory-data.js');
  const store = new Map();
  const storage = { get: (k, d) => (store.has(k) ? store.get(k) : d), set: async (k, v) => { store.set(k, v); }, getContext: () => ({ chat: [] }) };
  const prevWin = globalThis.window;
  globalThis.window = { VirtualPhone: { timeManager: { getCurrentStoryTime: () => ({ date: '2024年6月1日', time: '上午' }) } } };
  try {
    const c = new MemoryCore(storage);
    c.longTerm = [
      { id: 'm1', content: '旧约', importance: 9, createdAt: new Date(0).toISOString(), storyTime: '1994年6月1日' },
      { id: 'm2', content: '昨天的事', importance: 9, createdAt: new Date(1e12).toISOString(), storyTime: '2024年5月31日' },
      { id: 'm3', content: '没时间的事', importance: 9, createdAt: new Date(1e12).toISOString(), storyTime: null },
      { id: 'm4', content: '架空跨月', importance: 9, createdAt: new Date(1e12).toISOString(), storyTime: '霜月3日' }
    ];
    c.recall = () => c.longTerm.map((m, i) => ({ ...m, layer: 'long-term', id: 'rc-' + i, _score: 1 }));
    const block = c.buildPromptDirective([]);
    assert.match(block, /〔30年前〕旧约/, '必须有相对前缀');
    assert.match(block, /〔昨天〕/, '天档必须成立');
    assert.match(block, /- 没时间的事/, '没剧情时间的不带前缀但仍列出');
    assert.doesNotMatch(block, /〔〕/, '空前缀不得写出空方括号');
    assert.match(block, /时间口径/, '有标出时必须留出口径说明');
    assert.match(c.storyAgeLine(), /标出 2 · 未标 2/, '读数必须分态：' + c.storyAgeLine());
    const tl = c.getTimeline();
    assert.equal(tl.find((x) => x.id === 'm2').storyAge, '昨天');
    assert.equal(tl.find((x) => x.id === 'm3').storyAge, '', '算不出时必须是空串而非 undefined');
    assert.equal(tl.find((x) => x.id === 'm4').storyAge, '');
  } finally {
    globalThis.window = prevWin;
  }
});

/* ══════════════════ F 中枢、读数与负控制 ══════════════════ */
test('F1: 三件在同步表里，且各有非空现场读数', async () => {
  const o = new SubsystemOrchestrator(null);
  const syncKeys = Object.keys(o._kernelChecks());
  const asyncKeys = Object.keys(o._kernelAsyncChecks());
  for (const k of ['sourcePermission', 'storyTimeRel', 'worldbookEntrySettings']) {
    assert.ok(syncKeys.includes(k), k + ' 必须在同步表（零 IO 不进异步表）');
    assert.ok(!asyncKeys.includes(k), k + ' 不得在异步表');
  }
  const r = await o.runSelfChecks();
  assert.equal(r.ok, true, '全量自检必须全绿：' + r.problems.join('; '));
  for (const k of ['sourcePermission', 'storyTimeRel', 'worldbookEntrySettings']) {
    assert.ok(r.lines[k] && r.lines[k].length > 6, k + ' 读数必须非空：' + r.lines[k]);
    assert.doesNotMatch(r.lines[k], /无读数|没跑过/, k + ' 不得是空参读数');
  }
  assert.match(r.lines.sourcePermission, /按书名排除 2/, '读数必须现场真算（全角与半角同键都该被排）');
  assert.match(r.lines.worldbookEntrySettings, /调整 1 处/, '读数必须报出夹紧');
});

test('F2: 同步入口对三件如实计入通过（skipped 只属于异步件）', () => {
  const r = new SubsystemOrchestrator(null).runSelfChecksSync();
  assert.equal(r.skippedChecks, 4, '四件异步件才该被标 skipped');
  for (const k of ['sourcePermission', 'storyTimeRel', 'worldbookEntrySettings']) {
    assert.equal(r.skippedChecks !== 0 && !r.problems.join(' ').includes(k), true);
  }
});

/* ── 负控制 ─────────────────────────────────────────────────── */
/** 真源码破坏：锚点必须恰中 1 次、必改字节（H6 工具两向自证）。 */
function breakSrc(src, anchor, repl) {
  const n = src.split(anchor).length - 1;
  if (n !== 1) throw new Error('锚点命中 ' + n + ' 次（要求恰 1 次）：' + anchor.slice(0, 40));
  const out = src.split(anchor).join(repl);
  if (out === src) throw new Error('破坏未改字节');
  return out;
}
let seq = 0;
const loadBroken = async (src) => import(
  'data:text/javascript;charset=utf-8;base64,' + Buffer.from(src, 'utf8').toString('base64') + '#nc' + (++seq));
/** 两向：同一判据在原版上必须真、在破坏副本上必须假。
 *   承载面两种：零 import 的模块可走 data: URL；带相对 import 的必须落临时文件
 *   （data: URL 解析不到 `./num-gate.js`，Node 报 ERR_UNSUPPORTED_RESOLVE_REQUEST）。 */
async function negative(file, anchor, repl, judge, label) {
  const src = read('config/' + file + '.js');
  const brokenSrc = breakSrc(src, anchor, repl);
  const isLeaf = !/^import\s/m.test(src);
  let broken = null;
  let tmp = null;
  if (isLeaf) {
    broken = await loadBroken(brokenSrc);
  } else {
    tmp = rel('config/__nc_' + file + '.js');
    fs.writeFileSync(tmp, brokenSrc, 'utf8');
    broken = await import('../config/__nc_' + file + '.js?' + (++seq));
  }
  try {
    const real = await judge(await import('../config/' + file + '.js'));
    const fake = await judge(broken);
    assert.equal(real, true, label + ' 原版判据不为真（判据写歪了）');
    assert.equal(fake, false, label + ' 破坏副本仍为真（负控制失效＝判据自我指涉）');
  } finally {
    if (tmp) fs.unlinkSync(tmp);
  }
}

test('F3: 排除表被读空 ⇒ 该排的书通不过', async () => {
  /* 该行在 filterSourcesByPermission 与 filterBookNamesByPermission 各出现一次（同口径），
   *   故锚点要带上下行才唯一（H6：锚点不唯一必须抛）。带 `const kept = [];` 锁定前者。 */
  await negative('source-permission',
    '    const excluded = new Set(normalizeExcludedBooks(one.excludedBooks).map(canonicalBookName));\n    const kept = [];',
    '    const excluded = new Set();\n    const kept = [];',
    (m) => m.filterSourcesByPermission({ excludedBooks: ['X'], candidates: [{ kind: 'worldbook', world: 'X' }] }).kept.length === 0,
    'F3');
});

test('F4: 昨天档被拆掉 ⇒ 同一天给不出「昨天」', async () => {
  await negative('story-time-rel',
    "    if (days === 1) return '昨天';",
    "    if (days === 1) return days + '天前';",
    (m) => m.relativeTimeLabel('2024/3/1', '2024/3/2') === '昨天',
    'F4');
});

test('F5: fallback 参数被无视 ⇒ 合法 fallback 也回 0', async () => {
  await negative('worldbook-entry-settings',
    '    const safeFallback = LOREBOOK_POSITIONS.includes(fallback) ? fallback : 0;',
    '    const safeFallback = 0;',
    (m) => m.normalizePosition(4, 7) === 7,
    'F5');
});

test('F6: 注入侧过滤被切掉 ⇒ 排除表等于没接', async () => {
  /* 破坏副本要真正装进来量注入本数：`worldbook-manager.js` 有多条静态 import，
   *   data: URL 装不了（相对导入解析不到），故落一份临时文件再 import。 */
  const src = read('config/worldbook-manager.js');
  const anchor = '        const keptSources = permitted\n            ? selectedSources.filter((source) => permitted.includes(source?.name))\n            : selectedSources;';
  const tmp = rel('config/__nc_wbm.js');
  const countInjected = async (Mod) => {
    const m = new Mod.WorldbookManager(null);
    const store = new Map();
    m.storage = { get: (k, d) => (store.has(k) ? store.get(k) : d), set: async (k, v) => { store.set(k, v); } };
    m.getEnabled = () => true;
    m._getCharacterScopeKey = () => 't';
    m._loadWorldContent = async (s) => ({ ...s, allEntries: [{ uid: 1, content: 'x', comment: 'c', enabled: true }] });
    m.listAvailableWorldbooks = async () => [{ id: 'world:A', name: 'A书' }, { id: 'world:B', name: 'B书' }];
    m.getSelectionState = () => ({ initialized: true, ids: ['world:A', 'world:B'], entryIdsBySource: {} });
    m.matchesSelection = (s, ids) => ids.includes(s.id);
    await m.setBookExcluded('t', 'A书', true);
    return (await m.buildWorldbookMessages('t')).length;
  };
  fs.writeFileSync(tmp, breakSrc(src, anchor, '        const keptSources = selectedSources;'), 'utf8');
  try {
    const broken = await import('../config/__nc_wbm.js?' + (++seq));
    assert.equal(await countInjected(broken), 2, '破坏版：排掉一本后仍是两本');
    assert.equal(await countInjected({ WorldbookManager }), 1, '原版必须是一本');
  } finally {
    fs.unlinkSync(tmp);
  }
});
