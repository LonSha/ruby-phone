/**
 * tests/system-v4320.test.mjs — [v4.32.0 · R5-O5] 自然语言搜索：日期、类型与主题**同时**生效
 *
 * 验收口径（R5-O5 计划原文，三条缺一不可）：
 *   ① 固定时钟：「昨天还款」只出**昨天**的财务还款 —— 今天还款与昨天日记**都排除**；
 *   ② 类型缺失不得默认满足：抽得出的类型条件必须**真参与筛选**；
 *   ③ 候选阶段用主题 / 结构化条件，**不是机械整句**（否则候选集整句零命中，
 *      过滤器再准也是在空集上筛）。
 *
 * 【本版治的缺陷形态（三条，都不报错）】
 *   ① 闭区间把今天算进来：`facetsOf` 对「昨天」给 from=昨天、to=**今天**，
 *      而 `matchFacets` 用 `day > to` 判 —— 今天无关日记因此**通过**（计划原文点名）；
 *   ② 类型条件抽了不用：`facetsOf` 抽出 `kinds:['finance']`，而 `matchFacets`
 *      **一格都没读它** —— 界面写着「类型 财务」，结果里照样混进日记；
 *   ③ 候选阶段机械整句：`search-app` 把「昨天 林安安 还款」整串交给引擎，
 *      而 `scoreHit` 是**连续包含**判定 —— 候选集整句零命中，筛的是空集。
 *
 * 判据面（六组）：
 *   A 时间区间：闭开上界 / 今天与未来被排除 / 昨天在内 / 显式 ISO 仍是闭区间 /
 *              跨月与午夜边界 / 读不出时间的行不因时间被筛掉
 *   B 类型条件：抽得出即真参与筛选 / 多类型取并集 / 未知源不因类型被筛掉 / 逐条可归因
 *   C 三条旅程端到端（固定时钟 + 真 search-app + 假引擎/假存储）：昨天还款旅程、
 *              今天还款被排除、昨天日记被排除（类型）、清除日期后合理扩展
 *   D 候选召回：整句零命中时逐词仍召回 / 不传词表行为一字不改 / 分片档同款
 *   E 负控制：真源码定点破坏 ⇒ 同款判据必转红（每条配原版必真的反向对照）
 *   F 接线与版本锚：视图如实显示闭开上界 / 召回词表唯一出处 / 版本同源
 *
 * 【为什么负控制破坏副本而不是原仓】见 tests/system-v4120.test.mjs 档头（同规）。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
let pass = 0;
const ok = (name, cond, extra) => {
  assert.ok(cond, extra ? name + ' — ' + extra : name);
  pass += 1;
};
const S = await import('../config/search-facets.js');
const ENG = await import('../apps/memory/global-search-engine.js');
const { SearchApp } = await import('../apps/search/search-app.js');

/* 固定时钟：2026-10-12T12:00:00Z（本地时区基准由 isoOf 决定，判据一律用 isoOf 复算）。 */
const NOW = Date.parse('2026-10-12T12:00:00Z');
const DAY = 86400000;
const dayOf = (ms) => S.isoOf(new Date(ms));
const YESTERDAY = dayOf(NOW - DAY);
const TODAY = dayOf(NOW);

// ========== A. 时间区间（闭开上界） ==========
{
  const f = S.facetsOf('昨天 还款', { now: NOW });
  ok('A1 「昨天」给出区间', !!f.from && !!f.to, f.from + ' ~ ' + f.to);
  ok('A1b from 就是昨天', f.from === YESTERDAY, f.from);
  ok('A1c 上界走闭开（toExcl = 今天，不含今天）', f.toExcl === TODAY, String(f.toExcl));
  ok('A2 昨天的行在内', S.matchFacets({ ts: NOW - DAY, sourceId: 'wallet', body: '还款' }, f).pass === true);
  ok('A2b 昨天 23:xx 的行也在内（闭开而非单日闭区间）',
    S.matchFacets({ ts: NOW - DAY + 11 * 3600000, sourceId: 'wallet', body: '还款' }, f).pass === true);
  const todayRow = S.matchFacets({ ts: NOW, sourceId: 'wallet', body: '还款' }, f);
  ok('A3 今天的行被排除', todayRow.pass === false, JSON.stringify(todayRow));
  ok('A3b 且具名为 time', todayRow.reasons.includes('time'), JSON.stringify(todayRow.reasons));
  ok('A3c 明天的行也被排除（未来不进「昨天」）',
    S.matchFacets({ ts: NOW + DAY, sourceId: 'wallet', body: '还款' }, f).pass === false);
  /* 跨月：以 2026-11-01 为「今天」，「昨天」= 10-31。 */
  const crossMonth = S.facetsOf('昨天 还款', { now: Date.parse('2026-11-01T12:00:00Z') });
  ok('A4 跨月边界正确', crossMonth.from === S.isoOf(new Date(Date.parse('2026-11-01T12:00:00Z') - DAY)),
    crossMonth.from);
  /* 午夜：把基准放在 00:30，「昨天」仍是完整前一天。 */
  const midnight = S.facetsOf('昨天 还款', { now: Date.parse('2026-10-12T00:30:00Z') });
  ok('A5 午夜基准下 from 仍是前一天', midnight.from === S.isoOf(new Date(Date.parse('2026-10-12T00:30:00Z') - DAY)),
    midnight.from);
  /* 显式 ISO 区间：闭区间（用户写死两端）⇒ 无 toExcl，两端都含。 */
  const iso = S.facetsOf('@2026-10-01..2026-10-03 还款', { now: NOW });
  ok('A6 显式 ISO 区间两端都在', iso.from === '2026-10-01' && iso.to === '2026-10-03', iso.from + ' ~ ' + iso.to);
  ok('A6b 显式区间不带闭开上界', iso.toExcl === null, String(iso.toExcl));
  /* ★ 行必须带**财务源**：问句里的「还款」抽得出类型条件，白名单语义下
   *   没带 sourceId 的行会被类型筛掉（那是对的），量到的就不是时间边界了。 */
  ok('A6c 显式区间右端当天在内',
    S.matchFacets({ ts: Date.parse('2026-10-03T10:00:00Z'), sourceId: 'wallet', body: '还款' }, iso).pass === true);
  ok('A6d 显式区间右端次日不在内',
    S.matchFacets({ ts: Date.parse('2026-10-04T10:00:00Z'), sourceId: 'wallet', body: '还款' }, iso).pass === false);
  ok('A7 读不出时间的行不因时间被筛掉',
    S.matchFacets({ ts: null, createdAt: '', sourceId: 'wallet', body: '还款' }, f).reasons.includes('time') === false);
  ok('A8 「上周」也走闭开（不把今天算进来）', (() => {
    const w = S.facetsOf('上周 还款', { now: NOW });
    return w.toExcl === TODAY
      && S.matchFacets({ ts: NOW, body: '还款' }, w).pass === false;
  })());
  ok('A9 「上次」仍不给区间（不猜时间）', (() => {
    const v = S.facetsOf('上次 还款', { now: NOW });
    return v.from === null && v.toExcl === null && v.gaps.some((g) => g.kind === 'time-vague');
  })());
}

// ========== B. 类型条件真参与筛选 ==========
{
  ok('B1 类型→源表在场且四个类型都有落点',
    ['finance', 'calendar', 'story', 'memory'].every((k) => Array.isArray(S.FACET_KIND_SOURCES[k]) && S.FACET_KIND_SOURCES[k].length));
  ok('B2 财务落在三个既有源上（钱袋 / 旅行费用 / 世界账本）',
    S.FACET_KIND_SOURCES.finance.join(',') === 'wallet,traveldesk-expense,ledger',
    S.FACET_KIND_SOURCES.finance.join(','));
  ok('B3 行的类型可读', S.kindOfRow({ sourceId: 'wallet' }).join(',') === 'finance', S.kindOfRow({ sourceId: 'wallet' }).join(','));
  ok('B3b 一源可多属（总结记忆同时属剧情与记忆）',
    S.kindOfRow({ sourceId: 'summdesk-memory' }).join(',') === 'story,memory',
    S.kindOfRow({ sourceId: 'summdesk-memory' }).join(','));
  ok('B3c 未知源 ⇒ 空数组（不猜）', S.kindOfRow({ sourceId: 'nope' }).length === 0);
  ok('B3d 没有 sourceId ⇒ 空数组', S.kindOfRow({}).length === 0);

  const f = S.facetsOf('昨天 还款', { now: NOW });
  ok('B4 「还款」抽得出财务类型', f.kinds.indexOf('finance') >= 0, f.kinds.join(','));
  const wallet = S.matchFacets({ ts: NOW - DAY, sourceId: 'wallet', body: '还款' }, f);
  ok('B5 财务行通过（类型相符）', wallet.pass === true, JSON.stringify(wallet));
  const diary = S.matchFacets({ ts: NOW - DAY, sourceId: 'diary', body: '还款' }, f);
  ok('B6 日记行**因类型被筛掉**（修前它会通过）', diary.pass === false, JSON.stringify(diary));
  ok('B6b 且具名为 kind', diary.reasons.includes('kind'), JSON.stringify(diary.reasons));
  /* 白名单语义：未知源（不属任何已知类型）也**因类型被筛掉** —— 与时间的
     「读不出就放过」有意不同：时间读不出只是没标时间，而「类型」是用户显式
     限定的范围（说财务就只要财务那几处）。判据在此锁住这个差异。 */
  ok('B7 未知源也因类型被筛掉（白名单语义，与时间不同）',
    S.matchFacets({ ts: NOW - DAY, sourceId: 'unknown-src', body: '还款' }, f).reasons.includes('kind'));
  /* 多类型条件取并集。 */
  const multi = S.facetsOf('剧情 记忆 发生', { now: NOW });
  ok('B8 多类型条件抽得出两个类型',
    multi.kinds.indexOf('story') >= 0 && multi.kinds.indexOf('memory') >= 0, multi.kinds.join(','));
  ok('B8b 并集语义：属剧情**或**属记忆都通过',
    S.matchFacets({ sourceId: 'plotline', body: '发生' }, multi).pass === true
    && S.matchFacets({ sourceId: 'memory', body: '发生' }, multi).pass === true);
  ok('B8c 两者都不属才被筛掉',
    S.matchFacets({ sourceId: 'wallet', body: '发生' }, multi).reasons.includes('kind'));
  /* 逐条可归因 */
  const applied = S.applyFacets([
    { ts: NOW - DAY, sourceId: 'wallet', body: '还款' },
    { ts: NOW - DAY, sourceId: 'diary', body: '还款' },
    { ts: NOW, sourceId: 'wallet', body: '还款' }
  ], f);
  ok('B9 保留 / 筛掉计数正确', applied.kept === 1 && applied.dropped === 2, applied.kept + '/' + applied.dropped);
  ok('B9b 归因分列（kind 一条、time 一条）',
    applied.byReason.kind === 1 && applied.byReason.time === 1, JSON.stringify(applied.byReason));
  ok('B9c 条件读数含闭开上界', applied.conditions.toExcl === TODAY, String(applied.conditions.toExcl));
}

// ========== C. 三条旅程端到端（真 SearchApp + 假引擎 / 假存储） ==========
{
  /* 假引擎：只做「按召回词并集召回」，比中判定交给真 facets 层（与真引擎同形）。
     这样旅程量的是 search-app 的接线与筛选口径，不掺引擎实现。 */
  const makeFakeEngine = (rows) => ({
    MAX_SCAN_PER_SOURCE: 600,
    listSources: () => [{ id: 'wallet' }, { id: 'diary' }],
    scanSummary: () => ({ scanned: rows.length, scope: { truncatedSources: [] } }),
    invalidate: () => {},
    build: () => rows,
    scanScope: () => ({ truncatedSources: [] }),
    query: (kw, opts = {}) => {
      const terms = Array.isArray(opts.terms) && opts.terms.length ? opts.terms : [kw];
      const results = [];
      for (const r of rows) {
        let best = -1;
        for (const t of terms) {
          const s = ENG.scoreHit(r.title, String(r.body || ''), t);
          if (s > best) best = s;
        }
        if (best >= 0) results.push(Object.assign({}, r, { score: best, snippet: String(r.body || '').slice(0, 40) }));
      }
      results.sort((a, b) => b.score - a.score);
      return { query: kw, results, groups: [], total: results.length, scanned: rows.length, errors: [], scope: { truncatedSources: [] } };
    }
  });
  const makeApp = (rows) => {
    /* ★ 固定时钟经 deps.now 注入（生产路径仍取本机现在）——
     *   否则「昨天」的区间随跑测时刻漂移，判据不可复跑。 */
    const app = new SearchApp({}, { get: () => undefined, set: () => {}, currentConversationId: 'c1' }, { now: () => NOW });
    app.engine = makeFakeEngine(rows);
    app._knownActors = () => ['林安安'];
    app.view = { _scope: '', _restored: null };
    return app;
  };
  /* 数据面：昨天财务还款 / 今天财务还款 / 昨天日记 / 昨天别人的还款 / 昨天无关行。 */
  const rows = [
    { sourceId: 'wallet', sourceLabel: '钱袋', title: '还款', body: '林安安 还款 200', ts: NOW - DAY, icon: '💰', score: 0 },
    { sourceId: 'wallet', sourceLabel: '钱袋', title: '还款', body: '林安安 还款 300', ts: NOW, icon: '💰', score: 0 },
    { sourceId: 'diary', sourceLabel: '日记', title: '今天', body: '林安安 还款 心情', ts: NOW - DAY, icon: '📔', score: 0 },
    { sourceId: 'wallet', sourceLabel: '钱袋', title: '还款', body: '周砚 还款 100', ts: NOW - DAY, icon: '💰', score: 0 },
    { sourceId: 'diary', sourceLabel: '日记', title: '今天', body: '写日记', ts: NOW - DAY, icon: '📔', score: 0 }
  ];
  const app = makeApp(rows);
  /* ① 旅程一：固定时钟 + 「昨天 林安安 还款」⇒ 只剩昨天那笔财务还款。 */
  const r1 = app.search('昨天 林安安 还款').result;
  ok('C1 候选召回不为空（修前整句零命中 ⇒ 筛的是空集）', r1.results.length > 0, String(r1.results.length));
  ok('C2 结果只剩昨天那笔财务还款', r1.results.length === 1, JSON.stringify(r1.results.map((x) => x.body)));
  ok('C2b 留下的正是那条', /林安安 还款 200/.test(String(r1.results[0] && r1.results[0].body)), String(r1.results[0] && r1.results[0].body));
  ok('C3 今天还款被排除', !r1.results.some((x) => x.ts === NOW), '今天的行仍在结果里');
  ok('C4 昨天日记被排除（类型条件真参与）', !r1.results.some((x) => x.sourceId === 'diary'), '日记仍在结果里');
  ok('C5 昨天别人的还款被排除（人名条件）', !r1.results.some((x) => /周砚/.test(String(x.body))));
  ok('C6 读数里条件与筛掉数都在', !!r1.facets && r1.facets.conditions && r1.facets.dropped >= 1,
    JSON.stringify(r1.facets && { c: r1.facets.conditions, d: r1.facets.dropped }));
  ok('C6b 条件里带闭开上界（视图据此说「不含今天」）', r1.facets.conditions.toExcl === TODAY,
    String(r1.facets.conditions.toExcl));
  /* ② 旅程二：清除日期条件后结果合理扩展（不再是单条）。 */
  const r2 = app.search('林安安 还款').result;
  ok('C7 去掉日期后结果扩展', r2.results.length > r1.results.length, r2.results.length + ' vs ' + r1.results.length);
  ok('C7b 扩展后仍受人名与类型约束（日记仍不在）', !r2.results.some((x) => x.sourceId === 'diary'));
  /* ③ 旅程三：**完全抽不出条件**的问句 ⇒ 不筛（没听懂不显示成「都匹配」）。
     ★ 「嗯嗯」有关键词条件（ok 真）⇒ 会走筛选、并如实报「认不出人名」缺口；
     量「不筛」要用**真·空条件**的问句（空串）。两条都锁，语义才不含糊。 */
  const r3 = app.search('').result;
  ok('C8 空问句 ⇒ 不筛且如实标注', r3.facets.conditions === null
    && r3.facets.gaps.some((g) => g.kind === 'no-condition'),
    JSON.stringify(r3.facets.gaps));
  const r4 = app.search('嗯嗯').result;
  ok('C8b 有关键词但认不出人名 ⇒ 仍筛选且具名「不按人名筛」',
    !!r4.facets.conditions && r4.facets.gaps.some((g) => g.kind === 'actor-unrecognized'),
    JSON.stringify(r4.facets.gaps));
}

// ========== D. 候选召回（逐词，非机械整句） ==========
{
  const f = S.facetsOf('昨天 林安安 还款', { knownActors: ['林安安'], now: NOW });
  const terms = S.recallTermsOf(f);
  ok('D1 召回词含人名', terms.indexOf('林安安') >= 0, terms.join(','));
  ok('D1b 召回词含残余主题词', terms.indexOf('还款') >= 0, terms.join(','));
  ok('D1c 时间词不进召回词表（它不是内容词）', terms.indexOf('昨天') < 0, terms.join(','));
  ok('D2 空条件 ⇒ 空词表（调用方据此沿用整句）', S.recallTermsOf(S.facetsOf('', {})).length === 0);
  /* 真引擎行为：不传词表 ⇒ 整句零命中；传词表 ⇒ 召回。 */
  const src = { id: 'wallet', label: '钱袋', icon: '💰', appId: 'wallet', weight: 1, items: () => [
    { title: '还款', body: '林安安 还款 200', ts: NOW - DAY }
  ] };
  const eng = new ENG.GlobalSearchEngine({ sources: [src] });
  const plain = eng.query('昨天 林安安 还款');
  ok('D3 不传词表 ⇒ 整句零命中（修前形态）', plain.results.length === 0, String(plain.results.length));
  const withTerms = eng.query('昨天 林安安 还款', { terms: terms });
  ok('D4 传词表 ⇒ 逐词召回成功', withTerms.results.length === 1, String(withTerms.results.length));
  ok('D4b 摘要落在命中的那个词上', !!withTerms.results[0].snippet, String(withTerms.results[0].snippet));
  ok('D5 不传词表时既有行为一字不改（普通整句仍命中）',
    eng.query('还款').results.length === 1, String(eng.query('还款').results.length));
  /* 分片档同款 */
  const all = await eng.searchAll('昨天 林安安 还款', { full: true, terms: terms });
  ok('D6 分片档同样按词召回', all.results.length === 1, String(all.results.length));
  const allPlain = await eng.searchAll('昨天 林安安 还款', { full: true });
  ok('D6b 分片档不传词表同样整句零命中', allPlain.results.length === 0, String(allPlain.results.length));
  /* 未命中的词不影响：词表里有一条真命中即可 */
  ok('D7 词表含无关词也能召回', eng.query('昨天 林安安 还款', { terms: ['zzz', '还款'] }).results.length === 1);
}

// ========== E. 负控制（真源码定点破坏 ⇒ 同款判据必转红） ==========
{
  const facetSrc = read('config/search-facets.js');
  const engSrc = read('apps/memory/global-search-engine.js');
  const loadFacetBroken = async (from, to) => {
    const hits = facetSrc.split(from).length - 1;
    assert.equal(hits, 1, '锚点必须恰好命中一次: ' + from);
    const numUrl = pathToFileURL(path.join(root, 'config/num-gate.js')).href;
    const broken = facetSrc.replace(from, to)
      .split("'./num-gate.js'").join(JSON.stringify(numUrl));
    return import('data:text/javascript;base64,' + Buffer.from(broken, 'utf8').toString('base64'));
  };
  /* 同款判据：给定行集，量「今天还款 / 昨天日记」是否漏过。 */
  const leakOf = (mod) => {
    const f = mod.facetsOf('昨天 林安安 还款', { knownActors: ['林安安'], now: NOW });
    const rows = [
      { sourceId: 'wallet', body: '林安安 还款 200', ts: NOW - DAY },
      { sourceId: 'wallet', body: '林安安 还款 300', ts: NOW },
      { sourceId: 'diary', body: '林安安 还款 心情', ts: NOW - DAY }
    ];
    return mod.applyFacets(rows, f).rows.map((r) => r.sourceId + '@' + (r.ts === NOW ? 'today' : 'yesterday')).join(',');
  };
  /* 反向对照：原版只留一条（昨天财务）。 */
  ok('E0 原版：只留昨天那条财务', leakOf(S) === 'wallet@yesterday', leakOf(S));

  /* E1 上界退回闭区间（`day > to`）⇒ 今天漏过 */
  const closed = await loadFacetBroken(
    'if (f.toExcl) { if (day >= f.toExcl) reasons.push(\'time\'); }\n                else if (f.to && day > f.to) reasons.push(\'time\');',
    'if (f.to && day > f.to) reasons.push(\'time\');',
  );
  ok('负控制 E1：闭区间则今天漏过', /today/.test(leakOf(closed)), leakOf(closed));
  ok('负控制 E1：原版不漏', !/today/.test(leakOf(S)));

  /* E2 类型条件退回「抽了不用」⇒ 昨天日记漏过 */
  const noKind = await loadFacetBroken(
    "if (!mine.some((k) => f.kinds.indexOf(k) >= 0)) reasons.push('kind');",
    "if (false) reasons.push('kind');",
  );
  ok('负控制 E2：类型不参与则日记漏过', /diary/.test(leakOf(noKind)), leakOf(noKind));
  ok('负控制 E2：原版不漏日记', !/diary/.test(leakOf(S)));

  /* E3 召回退回机械整句（引擎不认词表）⇒ 候选整句零命中 */
  const hits = engSrc.split('const terms = Array.isArray(opts.terms) ? opts.terms.map(norm).filter(Boolean) : [];').length - 1;
  assert.equal(hits, 2, '引擎里召回词取用点应为 2（同步档 + 分片档），实得 ' + hits);
  const engBroken = engSrc.split('const terms = Array.isArray(opts.terms) ? opts.terms.map(norm).filter(Boolean) : [];').join('const terms = [];');
  const depFixes = [
    ["'../../data/cheat-index.js'", pathToFileURL(path.join(root, 'data/cheat-index.js')).href],
    ["'../../data/dirtytalk-index.js'", pathToFileURL(path.join(root, 'data/dirtytalk-index.js')).href],
    ["'../../config/world-bridge.js'", pathToFileURL(path.join(root, 'config/world-bridge.js')).href],
    ["'../../config/open-ref.js'", pathToFileURL(path.join(root, 'config/open-ref.js')).href],
    ["'../../config/num-gate.js'", pathToFileURL(path.join(root, 'config/num-gate.js')).href]
  ];
  let engBrokenSrc = engBroken;
  for (const [a, b] of depFixes) engBrokenSrc = engBrokenSrc.split(a).join(JSON.stringify(b));
  const ENG_BROKEN = await import('data:text/javascript;base64,' + Buffer.from(engBrokenSrc, 'utf8').toString('base64'));
  const src2 = { id: 'wallet', label: '钱袋', icon: '💰', appId: 'wallet', weight: 1, items: () => [
    { title: '还款', body: '林安安 还款 200', ts: NOW - DAY }
  ] };
  const engPlain = new ENG_BROKEN.GlobalSearchEngine({ sources: [src2] });
  ok('负控制 E3：不认词表则候选整句零命中',
    engPlain.query('昨天 林安安 还款', { terms: ['林安安', '还款'] }).results.length === 0,
    String(engPlain.query('昨天 林安安 还款', { terms: ['林安安', '还款'] }).results.length));
  const engGood = new ENG.GlobalSearchEngine({ sources: [src2] });
  ok('负控制 E3：原版按词表召回成功',
    engGood.query('昨天 林安安 还款', { terms: ['林安安', '还款'] }).results.length === 1);
}

// ========== F. 接线与版本锚 ==========
{
  const facetSrc = read('config/search-facets.js');
  const appSrc = read('apps/search/search-app.js');
  const viewSrc = read('apps/search/search-view.js');
  ok('F1 词表拆分只许一份（search-app 不自己切句）',
    /recallTermsOf/.test(appSrc) && (appSrc.match(/split\(\/\\s\+\//g) || []).length === 0,
    'search-app 里的切词次数: ' + (appSrc.match(/split\(\/\\s\+\//g) || []).length);
  ok('F2 两档都接上召回词（快速档与全历史档同源）',
    (appSrc.match(/recallOpt/g) || []).length >= 4, String((appSrc.match(/recallOpt/g) || []).length));
  ok('F3 视图如实显示闭开上界（不说成含今天）',
    /c\.toExcl \? '时间 '/.test(viewSrc) && /（不含 /.test(viewSrc));
  ok('F4 契约件导出召回与类型两个出口',
    /export function recallTermsOf/.test(facetSrc) && /export function kindOfRow/.test(facetSrc)
    && /FACET_KIND_SOURCES/.test(facetSrc));
  ok('F5 契约件仍只导入全仓唯一取值实现',
    (facetSrc.match(/^import /gm) || []).length === 1, String((facetSrc.match(/^import /gm) || []).length));
  ok('F6 不请求外部 API / 不直接写盘',
    !/fetch\s*\(|XMLHttpRequest|axios/.test(facetSrc) && !/localStorage|indexedDB/.test(facetSrc));
}

console.log('system-v4320: pass=' + pass);