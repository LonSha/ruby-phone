/* ============================================================
 * tests/system-v4995.test.mjs — R11-X5 验收：全局检索接出（Spotlight 跨域搜索进搜索 App）
 * ------------------------------------------------------------
 * 【这一项为什么单列】
 *   `config/spotlight-universal-search.js` 是一个**带域清单（四域）、带倒排索引、
 *   还带快捷意图语法**（发微信:Alice:明天见 / 转账:Bob:200 / 便签:开会）的完整搜索内核，
 *   但**产品端零 import**：全仓实测 `SpotlightUniversalSearch` 只出现在
 *   orchestrator（第 146 行 new 出来之后没人调）与 tests/ 一处，apps/ 下零命中。
 *   ⇒ 用户一次也没见过这个内核。
 *
 * 【X5 的验收语（计划原文）】
 *   至少 4 个域真出结果；某域数据被清空时显示「该域暂无数据」而非「无匹配」；
 *   200 条以上结果时首屏 < 300ms（可读分页或虚拟滚动）。
 *   不许：三态同形（无结果 / 未搜到 / 域不可用 都显示「没有匹配」）。
 *
 * 【覆盖】
 *   A 映射：行形状 / 分值 / 派发载荷（走 config/app-open-detail.js 同一支笔）
 *   B 四域真出结果：四域各有一条真源 → 灌进内核 → 四域都有命中行
 *   C 三态不同形：域空 / 域缺席 / 整块读不到 —— 三句话必须互不相同
 *   D 接线自证：search-app 真 import 内核与桥；视图真走 app.spotlightFace；不自己做第二套映射
 *   E 意图行：三门口诀各出一条意图行，且**只派发打开、不代用户执行**
 *   F 性能面：200+ 条命中时映射仍在预算内（映射是纯函数，这里是它的上界读数）
 *   G 负控制：真破坏源码 ⇒ 在副本上重跑同款判据必须转红
 * ============================================================ */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  SPOTLIGHT_DOMAIN_META, SPOTLIGHT_FEED_REASONS, SPOTLIGHT_FACE_LIMIT,
  domainMetaOf, mapDomainCoverage, mapSpotlightRows, spotlightLine, domainNotes
} from '../config/spotlight-face-bridge.js';
import { SpotlightUniversalSearch, SEARCH_DOMAINS } from '../config/spotlight-universal-search.js';
import { buildOpenDetail } from '../config/app-open-detail.js';

const __dir = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dir, '..');
const BRIDGE_REL = 'config/spotlight-face-bridge.js';
const APP_REL = 'apps/search/search-app.js';
const VIEW_REL = 'apps/search/search-view.js';
/* [v4.99.5] 宿主带的 Buffer 在部分环境缺 readFileSync 的 utf8 默认；统一显式编码。 */
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/** 造一个 search-app 夹具（只带 spotlightFace 真正需要的那几件依赖）。 */
function mkApp(store = {}) {
  /* 真实 App 侧取数依赖：storage.get / window.VirtualPhone.cachedWechatData / APPS。
   *   夹具只造最小面 —— 四域里 SETTINGS 走代码里的注册表（APPS），其余三域走 storage。 */
  const mem = new Map(Object.entries(store));
  return {
    storage: {
      get: (k, d) => (mem.has(k) ? mem.get(k) : d),
      set: (k, v) => mem.set(k, v)
    }
  };
}

/** 四域齐全的落盘样本。 */
function fullStore() {
  return {
    phone_call_contacts: [{ name: '林安安' }, { name: '孙翌童' }],
    wechat_data: { chats: [{ id: 'c1', name: '与林安安的会话', lastMessage: '晚上去图书馆吗' }] },
    diary_entries: [{ id: 'd1', date: '2026-10-30', title: '十月三十', content: '今天在图书馆待了很久' }]
  };
}

/* ── A 映射 ───────────────────────────────────────────────── */

test('A1 桥接层导出面：四域元信息齐 + 归因词表齐 + 上限为正整数', () => {
  assert.equal(Object.keys(SPOTLIGHT_DOMAIN_META).length, 4);
  for (const d of ['CONTACTS', 'WECHAT', 'DIARY', 'SETTINGS']) {
    assert.ok(SPOTLIGHT_DOMAIN_META[d], '缺域元信息：' + d);
    assert.ok(SPOTLIGHT_DOMAIN_META[d].label, '域缺中文名：' + d);
    assert.ok(SPOTLIGHT_DOMAIN_META[d].emptyLine, '域缺「暂无数据」文案：' + d);
  }
  assert.ok(Number.isInteger(SPOTLIGHT_FACE_LIMIT) && SPOTLIGHT_FACE_LIMIT > 0);
  /* 归因词表：七态各有一个**非空且互不相同**的词（同一句归因两处用 = 无法分辨根因）。 */
  const words = Object.values(SPOTLIGHT_FEED_REASONS).filter(Boolean);
  assert.equal(new Set(words).size, words.length, '归因词必须互不相同');
  assert.ok(words.includes('no_spotlight') && words.includes('read_threw'));
});

test('A2 未知域如实回落：不凭空造中文名，也仍给一句「没有登记」', () => {
  const m = domainMetaOf('UNKNOWN_DOMAIN');
  assert.equal(m.domain, 'UNKNOWN_DOMAIN');
  assert.equal(m.label, 'UNKNOWN_DOMAIN');
  assert.ok(m.emptyLine);
  assert.equal(domainMetaOf('').label, '未知域');
});

test('A3 行形状：必填字段齐 + 派发载荷走同一支笔（不手写对象字面量）', () => {
  const raw = {
    query: '图书馆',
    results: [
      { id: 'DIARY:d1', rawId: 'd1', domain: 'DIARY', title: '十月三十', subtitle: '日记', content: '在图书馆待了很久', relevanceScore: 7 }
    ],
    intentAction: null
  };
  const feed = mapSpotlightRows(raw, { buildOpenDetail });
  assert.equal(feed.ok, true);
  assert.equal(feed.rows.length, 1);
  const r = feed.rows[0];
  for (const k of ['sourceId', 'sourceLabel', 'icon', 'appId', 'title', 'score', 'openDetail']) {
    assert.ok(k in r, '行缺字段：' + k);
  }
  assert.equal(r.domain, 'DIARY');
  assert.equal(r.score, 7);
  /* 载荷与 buildOpenDetail 的输出**逐字段同形**（同一支笔：本件不自己拼）。 */
  assert.deepEqual(r.openDetail, buildOpenDetail('diary', null, null));
  assert.equal(r.openDetail.appId, 'diary');
  assert.ok(!('tab' in r.openDetail), '没页签时不该写出 tab 字段');
  /* 不伪造靶心：本件没登记任何 kind ⇒ openDetail 里不许出现 ref。 */
  assert.ok(!('ref' in r.openDetail), '桥接层不得凭空声称能定位到某一条');
});

test('A4 只读不改入参：映射后内核那份结果本体逐字段不变', () => {
  const item = { id: 'SETTINGS:wechat', rawId: 'wechat', domain: 'SETTINGS', title: '微信', subtitle: '应用', content: 'wechat', relevanceScore: 3 };
  const raw = { query: '微', results: [item], intentAction: null };
  const before = JSON.stringify(raw);
  mapSpotlightRows(raw, { buildOpenDetail });
  assert.equal(JSON.stringify(raw), before, '映射改动了入参');
});

test('A5 坏输入：非对象 → ok:false + bad_result；结果不是数组 → 当 0 条（不抛）', () => {
  const bad = mapSpotlightRows(null, { buildOpenDetail });
  assert.equal(bad.ok, false);
  assert.equal(bad.why, SPOTLIGHT_FEED_REASONS.BAD_RESULT);
  const odd = mapSpotlightRows({ results: 'nope' }, { buildOpenDetail });
  assert.equal(odd.ok, true);
  assert.equal(odd.rows.length, 0);
});

/* ── B 四域真出结果 ────────────────────────────────────────── */

test('B1 四域都灌得进、都搜得到（计划原文「至少 4 个域真出结果」）', () => {
  const s = new SpotlightUniversalSearch();
  s.indexEntities(SEARCH_DOMAINS.CONTACTS, [{ id: '林安安', title: '林安安', content: '林安安' }]);
  s.indexEntities(SEARCH_DOMAINS.WECHAT, [{ id: 'c1', title: '与林安安的会话', content: '图书馆', deepLink: { targetApp: 'wechat', view: 'chat' } }]);
  s.indexEntities(SEARCH_DOMAINS.DIARY, [{ id: 'd1', title: '十月三十', content: '图书馆' }]);
  s.indexEntities(SEARCH_DOMAINS.SETTINGS, [{ id: 'library', title: '应用库', content: 'library' }]);
  const res = s.search('图书馆');
  const doms = new Set(res.results.map(r => r.domain));
  assert.ok(doms.has(SEARCH_DOMAINS.WECHAT) && doms.has(SEARCH_DOMAINS.DIARY), '微信/日记两域必须真出结果');
  /* 四域**各有一条能搜到**（用四个各自的关键词各验一次，不靠同一条命中充数）。 */
  for (const [kw, dom] of [['林安安', 'CONTACTS'], ['会话', 'WECHAT'], ['图书馆', 'DIARY'], ['应用库', 'SETTINGS']]) {
    const r2 = s.search(kw);
    assert.ok(r2.results.some(x => x.domain === dom), '域 ' + dom + ' 在关键词「' + kw + '」下零命中');
  }
});

test('B2 域覆盖三态由真读数推：灌了 N 条 → ready + N；灌 0 条 → empty；取不到 → missing', () => {
  const cov = mapDomainCoverage([
    { domain: 'CONTACTS', count: 2, ok: true },
    { domain: 'WECHAT', count: 0, ok: true },
    { domain: 'DIARY', count: 0, ok: false, why: 'read_threw' },
    { domain: 'SETTINGS', count: 89, ok: true }
  ]);
  const by = Object.fromEntries(cov.map(d => [d.domain, d]));
  assert.equal(by.CONTACTS.state, 'ready');
  assert.equal(by.CONTACTS.count, 2);
  assert.equal(by.WECHAT.state, 'empty');
  assert.equal(by.DIARY.state, 'missing');
  assert.equal(by.SETTINGS.state, 'ready');
  assert.equal(by.DIARY.why, 'read_threw');
});

/* ── C 三态不同形 ─────────────────────────────────────────── */

test('C1 三句话必须互不相同（计划原文点名「不许三态同形」）', () => {
  const off = spotlightLine({ ok: false, why: SPOTLIGHT_FEED_REASONS.NO_SPOTLIGHT });
  const emptyDom = domainNotes(mapDomainCoverage([{ domain: 'WECHAT', count: 0, ok: true }]));
  const missDom = domainNotes(mapDomainCoverage([{ domain: 'WECHAT', count: 0, ok: false, why: 'read_threw' }]));
  assert.ok(off.length > 0 && emptyDom.length === 1 && missDom.length === 1);
  assert.notEqual(off, emptyDom[0].line, '「没接上」与「域空」不同形');
  assert.notEqual(emptyDom[0].line, missDom[0].line, '「域空」与「域缺席」不同形');
  assert.notEqual(off, missDom[0].line);
  /* 关键：读不到的那两条都必须**明写**这不是「没有内容」。 */
  assert.ok(missDom[0].line.includes('不是没有内容'), '域缺席必须明写不是没有内容');
  assert.ok(off.includes('不是「没有结果」'), '整块读不到必须明写不是没有结果');
  assert.equal(emptyDom[0].kind, 'empty');
  assert.equal(missDom[0].kind, 'missing');
});

test('C2 零命中但四域都接上 ⇒ 一句话里不许出现「没接上」这类归因', () => {
  const domains = mapDomainCoverage([
    { domain: 'CONTACTS', count: 1, ok: true },
    { domain: 'WECHAT', count: 1, ok: true },
    { domain: 'DIARY', count: 1, ok: true },
    { domain: 'SETTINGS', count: 89, ok: true }
  ]);
  const feed = mapSpotlightRows({ results: [], intentAction: null }, { coverage: [], buildOpenDetail });
  const line = spotlightLine({ ok: true, counts: feed.counts, domains });
  assert.ok(line.includes('没有命中'), '零命中要说「没有命中」');
  assert.ok(!line.includes('没接上'), '四域都在场时不许说「没接上」');
  assert.ok(line.includes('4/4'), '要说清几域接上了');
});

/* ── D 接线自证 ───────────────────────────────────────────── */

test('D1 search-app 真 import 内核与桥（产品端不再零 import）', () => {
  const src = read(APP_REL);
  assert.ok(/import\s*\{[^}]*SpotlightUniversalSearch/.test(src), 'search-app 必须真 import Spotlight 内核');
  assert.ok(/from\s+'\.\.\/\.\.\/config\/spotlight-universal-search\.js'/.test(src), '内核 import 路径必须对');
  assert.ok(/from\s+'\.\.\/\.\.\/config\/spotlight-face-bridge\.js'/.test(src), '必须走桥接层（唯一映射出处）');
  assert.ok(/spotlightFace\s*\(/.test(src), 'App 必须给出读数口 spotlightFace');
  assert.ok(/indexEntities\s*\(/.test(src), 'App 必须真把四域数据灌进内核');
});

test('D2 视图真走 app.spotlightFace，不自己做第二套读赏', () => {
  const src = read(VIEW_REL);
  const code = stripComments(src);
  assert.ok(/this\.app\.spotlightFace\??\.\(/.test(code), '视图必须调 App 的读数口');
  assert.ok(/_spotlightHtml\s*\(\)/.test(code), '视图必须有读数条的渲染口');
  assert.ok(/\$\{this\._spotlightHtml\(\)\}/.test(code), '读数条真插进渲染块');
  /* 视图不许自己 import 内核（那是第二份取数与映射的来源）。 */
  assert.ok(!/SpotlightUniversalSearch/.test(code), '视图不得自己 import 内核');
  assert.ok(!/mapSpotlightRows\s*\(/.test(code), '视图不得自己做映射（映射的唯一出处是桥）');
});

test('D3 映射唯一出处：桥接层不含 storage、不 new 实例、不写盘', () => {
  const src = read(BRIDGE_REL);
  const code = stripComments(src);
  assert.ok(!/\bstorage\b/.test(code), '桥接层不得持有 storage');
  assert.ok(!/\bnew\s+[A-Za-z_$]/.test(code), '桥接层不得 new 任何实例');
  assert.ok(/numOrNull/.test(code), '取数口径必须走 config/num-gate.js 的 numOrNull');
});

test('D4 键面：本版**不新增任何存储键**（X5 只读既有键）', () => {
  const src = read(APP_REL);
  const code = stripComments(src);
  /* 四域取数只允许读这四个既有键（写死在判据里，改名即红）。 */
  for (const k of ['phone_call_contacts', 'wechat_data', 'diary_entries']) {
    assert.ok(code.includes("'" + k + "'"), '四域取数必须读既有键：' + k);
  }
  /* 不许出现本版新造的键前缀（X5 不落地任何新键）。 */
  assert.ok(!/'sp_[a-z_]*'/.test(code), '本版不得新造存储键');
  assert.ok(!/'spotlight_[a-z_]*'/.test(code), '本版不得新造存储键');
});

/* ── E 意图行 ─────────────────────────────────────────────── */

test('E1 三门口诀各出一条意图行，且各带自己的落点（只到 App / 到页签）', () => {
  const s = new SpotlightUniversalSearch();
  const cases = [
    ['发微信:Alice:明天见', 'WECHAT_CHAT', 'wechat', 'chat'],
    ['转账:Bob:200', 'FINANCE_TRANSFER', 'wallet', 'transfer'],
    ['便签:开会', 'DIARY_NEW', 'diary', 'compose']
  ];
  for (const [q, type, app, tab] of cases) {
    const res = s.search(q);
    assert.ok(res.intentAction, '「' + q + '」必须解析出意图');
    assert.equal(res.intentAction.type, type);
    const feed = mapSpotlightRows(res, { buildOpenDetail });
    assert.ok(feed.intentAction, '映射后仍要有意图行');
    assert.equal(feed.intentAction.appId, app);
    assert.equal(feed.intentAction.tab, tab);
    assert.deepEqual(feed.intentAction.openDetail, buildOpenDetail(app, tab, null));
  }
});

test('E2 意图行**只派发打开**：视图里不出现任何「代用户执行」的调用面', () => {
  const code = stripComments(read(VIEW_REL));
  const idx = code.indexOf('#gs-intent');
  assert.ok(idx > 0, '意图行必须绑事件');
  const tail = code.slice(idx, idx + 900);
  assert.ok(tail.includes('phone:openApp'), '意图行点击必须派发打开');
  /* 不许在意图行里直接调业务动作（转账 / 发消息 / 写日记）。 */
  for (const bad of ['executeTransaction', 'sendMessage', 'appendTransactionStep', 'mintAsset']) {
    assert.ok(!tail.includes(bad), '意图行不得代用户执行：' + bad);
  }
});

/* ── F 性能面（映射是纯函数；这里是它的上界读数） ──────────── */

test('F1 200+ 条命中时映射仍在预算内，且行数被上限截住', () => {
  const results = [];
  for (let i = 0; i < 240; i++) {
    results.push({ id: 'SETTINGS:a' + i, rawId: 'a' + i, domain: 'SETTINGS', title: '应用' + i, content: 'app' + i, relevanceScore: 1 });
  }
  const t0 = Date.now();
  const feed = mapSpotlightRows({ results, intentAction: null }, { buildOpenDetail });
  const ms = Date.now() - t0;
  assert.equal(feed.counts.total, 240, '计数必须是**全部**命中数（不是截断后的）');
  assert.equal(feed.rows.length, SPOTLIGHT_FACE_LIMIT, '行数被上限截住');
  assert.ok(ms < 300, '映射 240 条耗时 ' + ms + 'ms，超 300ms 预算');
});

/* ── G 负控制（真源码破坏 ⇒ 在副本上重跑同款判据必须转红） ──── */

/**
 * 把桥接层源码**真破坏**后落到临时目录，返回可 import 的 URL。
 * 纪律（与 X3/X2 同款）：
 *   · 锚点必须恰中 1 次（否则破坏没发生，负控制会假绿）；
 *   · **相对依赖必须一并复制进副本目录**（否则副本载不起来，负控制退化成「剪具坏了」）。
 */
function brokenBridgeCopy(pairs) {
  let src = read(BRIDGE_REL);
  for (const [from, to] of pairs) {
    const n = src.split(from).length - 1;
    assert.equal(n, 1, '负控制锚点必须恰中一次：' + JSON.stringify(String(from).slice(0, 70)));
    src = src.replace(from, to);
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rp_x5_'));
  const deps = new Set();
  const re = /from\s+'\.\/([^']+)'/g;
  let m;
  while ((m = re.exec(src)) !== null) deps.add(m[1]);
  for (const dep of deps) {
    const from = path.join(ROOT, 'config', dep);
    if (fs.existsSync(from)) fs.copyFileSync(from, path.join(dir, dep));
  }
  const file = path.join(dir, 'spotlight-face-bridge.broken.js');
  fs.writeFileSync(file, src, 'utf8');
  return 'file://' + file;
}

/**
 * **同款真判据**（纯谓词）：接收任意一版桥接层模块，返回「这一版行为正确」。
 * 负控制必须做到「同一份判据在原版上真、在破坏副本上假」——
 *   若只在副本上跑一次断言「等于正确值」，那就是把判据写成了**对破坏结果的期待**，
 *   破坏没发生时反而会绿（本版首跑踩到的形态：三条负控制全红而方向反了）。
 */
const faceCriterion = {
  /* 三态必须互不同形：域空 = empty、域缺席 = missing、且都不许塌成 ready。 */
  triState(B) {
    const cov = B.mapDomainCoverage([
      { domain: 'CONTACTS', count: 1, ok: true },
      { domain: 'WECHAT', count: 0, ok: true },
      { domain: 'DIARY', count: 0, ok: false, why: 'read_threw' },
      { domain: 'SETTINGS', count: 5, ok: true }
    ]);
    return cov.map(d => d.state).join(',') === 'ready,empty,missing,ready';
  },
  /* 域缺席必须**单列**且明写「不是没有内容」（塌进「暂无数据」即判假）。 */
  missingIsSpoken(B) {
    const notes = B.domainNotes(B.mapDomainCoverage([{ domain: 'DIARY', count: 0, ok: false, why: 'read_threw' }]));
    return notes.length === 1 && notes[0].kind === 'missing' && notes[0].line.includes('不是没有内容');
  },
  /* 行数被上限截住，而计数报的是**全部**命中数（截断不许把总数也改小）。 */
  limitHolds(B) {
    const results = [];
    for (let i = 0; i < 240; i++) results.push({ id: 'SETTINGS:a' + i, domain: 'SETTINGS', title: 'a' + i, content: 'a', relevanceScore: 1 });
    const feed = B.mapSpotlightRows({ results, intentAction: null }, {});
    return feed.rows.length === B.SPOTLIGHT_FACE_LIMIT && feed.counts.total === 240;
  }
};

for (const [name, pairs, crit] of [
  ['G1 三态塌成一格（missing 被当成 empty）',
    [["            state: !ok ? 'missing' : (count > 0 ? 'ready' : 'empty'),", "            state: count > 0 ? 'ready' : 'empty',"]],
    'triState'],
  ['G2 域缺席被说成「暂无数据」',
    [["        if (d.state === 'missing') out.push({ domain: d.domain, label: d.label, kind: 'missing', line: d.label + '：数据源没取到（不是没有内容）' });",
      "        /* broken: missing 那一档被抹掉 */"]],
    'missingIsSpoken'],
  ['G3 行数上限被抹掉（240 条全放出来）',
    [['        if (rows.length >= lim) continue;', '        /* broken: 上限被抹掉 */']],
    'limitHolds'],
]) {
  test('负控制 · ' + name, async () => {
    /* ① 同款判据在**原版**上必须为真（否则「副本上假」可能是判据本身假，与破坏无关）。 */
    assert.equal(faceCriterion[crit]({ mapDomainCoverage, mapSpotlightRows, domainNotes, SPOTLIGHT_FACE_LIMIT }), true,
      '同款判据在原版上必须为真');
    /* ② 同款判据在**破坏副本**上必须为假。 */
    const B = await import(brokenBridgeCopy(pairs));
    assert.equal(faceCriterion[crit](B), false, '破坏后同款判据必须转红');
  });
}

test('G4 负控制自证：锚点不存在 / 不唯一时必须抛（防止假绿）', () => {
  assert.throws(() => brokenBridgeCopy([['这段代码在桥接层里根本不存在', 'x']]), /恰中一次/);
});
