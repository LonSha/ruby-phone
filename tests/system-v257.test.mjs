/**
 * system-v257.test.mjs — v2.57.0 记忆洞察（Memory Insights）
 *
 * 【背景】记忆 App 的引擎侧能力远厚于界面：MemoryPool.getSensoryArchive()（五感归档）
 *   与 getSceneTags()（场景聚合）在产品代码**全仓零调用**；生命周期四段
 *   （active/cooling/frozen/tombstone）、换代压制（superseded，可逆）、回忆权限三级
 *   （cite/cautious/associate）全部无任何 UI 落点。视图只显示 4 个计数 + 一个列表。
 *   本版新增 apps/memory/memory-insights.js 纯函数洞察层（六面投影），视图改分页结构，
 *   控制器提供 insights() 单一取数出口。
 *
 * 【为什么可以直接 import 内核】memory-insights.js 及其依赖（recall-filter.js /
 *   supersede-engine.js）均为纯 ESM、零 window / storage 依赖 —— 本套件直接导入做
 *   **真功能测试**（不是只 grep 源码），App/视图层做源码不变量锁定（宿主 window 依赖无法无头实例化）。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const idx = read('index.js');

import {
  SENSE_META, LIFECYCLE_META, AUDIT_GRADE,
  senseRows, sceneRows, lifecycleRows, supersedePairs, emotionTrace, auditMemory, insightSummary
} from '../apps/memory/memory-insights.js';

const DAY = 86400000;

// ============================================================
// A. 纯内核：五感归档
// ============================================================
test('A1 senseRows: 投影归档，空感维不出现，按条数降序', () => {
  const archive = {
    smell: [{ content: '咖啡香', weights: { smell: 0.9 }, createdAt: new Date().toISOString() }],
    touch: [
      { content: '指尖的体温', weights: { touch: 0.8 }, createdAt: new Date().toISOString() },
      { content: '粗糙的布料', weights: { touch: 0.5 }, createdAt: new Date().toISOString() }
    ],
    sight: [], sound: [], taste: []
  };
  const rows = senseRows(archive, { perSense: 4, now: Date.now() });
  assert.equal(rows.length, 2, '空感维不得出现');
  assert.equal(rows[0].sense, 'touch', '应按条数降序');
  assert.equal(rows[0].count, 2);
  assert.equal(rows[0].label, '触觉');
  assert.equal(rows[0].items.length, 2);
  assert.equal(rows[0].items[0].content, '指尖的体温');
});

test('A2 senseRows: perSense 截断 + 畸形输入降级为空数组（不抛）', () => {
  const archive = { taste: [1, 2, 3, 4, 5].map((i) => ({ content: 't' + i, createdAt: new Date().toISOString() })) };
  const rows = senseRows(archive, { perSense: 2 });
  assert.equal(rows[0].items.length, 2);
  assert.equal(senseRows(null).length, 0);
  assert.equal(senseRows(undefined).length, 0);
  assert.equal(senseRows('garbage').length, 0);
  assert.equal(senseRows({ smell: 'not-an-array' }).length, 0);
});

test('A3 SENSE_META 键与引擎 SENSE_HINTS 五感键逐字一致（缺键即该感维静默消失）', () => {
  const poolSrc = read('apps/memory/memory-pool.js');
  for (const key of Object.keys(SENSE_META)) {
    assert.ok(new RegExp(key + '\\s*:').test(poolSrc), `引擎缺少感维 ${key}`);
  }
  assert.equal(Object.keys(SENSE_META).length, 5);
});

// ============================================================
// B. 纯内核：场景聚合
// ============================================================
test('B1 sceneRows: 未标注地点的条目归入「未标注地点」，不丢数据', () => {
  const scenes = [
    { place: '海边', items: [{ content: '浪声' }, { content: '咸风' }], senses: { sound: 2 } },
    { place: '', items: [{ content: '走廊里的脚步声' }], senses: {} },
    { place: '未命名', items: [], senses: {} }   // 空 items 不产出行
  ];
  const rows = sceneRows(scenes, { perScene: 2 });
  assert.equal(rows.length, 2, '空 items 的场景不得产出行');
  assert.equal(rows[0].place, '海边');
  assert.equal(rows[1].place, '未标注地点');
  assert.equal(rows[1].count, 1);
  assert.equal(sceneRows(null).length, 0);
});

// ============================================================
// C. 纯内核：生命周期（只读，绝不触发墓碑化）
// ============================================================
test('C1 lifecycleRows: 四段分桶计数正确', () => {
  const now = Date.now();
  const memories = [
    { id: 'a', content: '昨天的事', createdAt: new Date(now - 1 * DAY).toISOString() },
    { id: 'b', content: '20 天前的事', createdAt: new Date(now - 20 * DAY).toISOString() },
    { id: 'c', content: '45 天前的事', createdAt: new Date(now - 45 * DAY).toISOString() },
    { id: 'd', content: '120 天前的事', createdAt: new Date(now - 120 * DAY).toISOString() }
  ];
  const out = lifecycleRows(memories, { now, perStage: 3 });
  assert.equal(out.total, 4);
  const byStage = Object.fromEntries(out.rows.map((r) => [r.stage, r.count]));
  assert.equal(byStage.active, 1);
  assert.equal(byStage.cooling, 1);
  assert.equal(byStage.frozen, 1);
  assert.equal(byStage.tombstone, 1);
});

test('C2 lifecycleRows: 只读 —— 超期条目正文原样保留（绝不调 pruneByLifecycle）', () => {
  const now = Date.now();
  const OLD = '这段旧记忆的正文必须原样保留';
  const out = lifecycleRows(
    [{ id: 'x', content: OLD, createdAt: new Date(now - 200 * DAY).toISOString() }],
    { now }
  );
  const tomb = out.rows.find((r) => r.stage === 'tombstone');
  assert.ok(tomb, '200 天前的条目应落在 tombstone 桶');
  assert.equal(tomb.stale[0].content, OLD, '纯读路径不得清空正文（墓碑化是巩固管线的副作用，界面渲染绝不触发）');
});

test('C3 lifecycleRows: 受保护条目单独计数', () => {
  const now = Date.now();
  const out = lifecycleRows([
    { id: 'p', content: '[剧情] 回填的剧情记忆', createdAt: new Date(now - 100 * DAY).toISOString() },
    { id: 'q', content: '普通旧记忆', createdAt: new Date(now - 100 * DAY).toISOString() }
  ], { now });
  assert.equal(out.protectedCount, 1);
});

// ============================================================
// D. 纯内核：换代对读
// ============================================================
test('D1 supersedePairs: 旧↔新配对 + 压制方缺失如实报 byMissing', () => {
  const now = Date.now();
  const memories = [
    { id: 'old1', content: '她喜欢喝奶茶', createdAt: new Date(now - 30 * DAY).toISOString(),
      metadata: { _superseded: 'superseded', supersededBy: 'new1', supersededAt: new Date(now - 2 * DAY).toISOString() } },
    { id: 'new1', content: '她已经戒了奶茶', createdAt: new Date(now - 1 * DAY).toISOString() },
    { id: 'old2', content: '他住老房子', createdAt: new Date(now - 40 * DAY).toISOString(),
      metadata: { _superseded: 'superseded', supersededBy: 'gone-id', supersededAt: new Date(now - 5 * DAY).toISOString() } }
  ];
  const pairs = supersedePairs(memories, { now });
  assert.equal(pairs.length, 2);
  assert.equal(pairs[0].oldId, 'old1');
  assert.equal(pairs[0].byText, '她已经戒了奶茶');
  assert.equal(pairs[0].byMissing, false);
  assert.equal(pairs[1].byId, 'gone-id');
  assert.equal(pairs[1].byMissing, true, '压制方不在池中必须如实报，不得假装它还压着');
});

// ============================================================
// E. 纯内核：情感轨迹 + 体检
// ============================================================
test('E1 emotionTrace: 按天分桶，空白天不补零，均值正确', () => {
  const now = Date.now();
  const mk = (daysAgo, arousal, imp) => ({
    content: 'm', createdAt: new Date(now - daysAgo * DAY).toISOString(),
    emotion: { arousal }, importance: imp
  });
  const trace = emotionTrace([mk(0, 0.8, 7), mk(0, 0.4, 5), mk(2, 0.2, 3)], { days: 14, now });
  assert.equal(trace.length, 2, '只有 2 天有条目，中间空白天不得补零');
  // 桶按日期 key 升序：2 天前在前(count=1)，今天在后(count=2)
  assert.equal(trace[0].count, 1);
  assert.equal(trace[0].avgArousal, 0.2);
  assert.equal(trace[1].count, 2);
  assert.equal(trace[1].avgArousal, 0.6);
  assert.equal(trace[1].avgImportance, 6);
  assert.equal(emotionTrace([]).length, 0);
});

test('E2 auditMemory: 空态 → empty + 建议；未巩固 → warn；零收藏 → warn', () => {
  const empty = auditMemory({ longTerm: [], shortTerm: [], poolStats: {} });
  assert.equal(empty.grade, 'empty');
  assert.ok(empty.issues[0].advice.length > 0, '空态也要给可执行建议');

  const notConsolidated = auditMemory({ longTerm: [], shortTerm: [{ content: 'x' }], poolStats: {} });
  assert.ok(notConsolidated.issues.some((i) => i.kind === 'not-consolidated' && i.level === 'warn'));
  assert.equal(notConsolidated.grade, 'warn');

  const long = Array.from({ length: 25 }, (_, i) => ({
    id: 'm' + i, content: '记忆' + i, createdAt: new Date(Date.now() - 2 * DAY).toISOString()
  }));
  const noPin = auditMemory({ longTerm: long, shortTerm: [], poolStats: {} });
  assert.ok(noPin.issues.some((i) => i.kind === 'no-pin'), '≥20 条长期但零收藏必须亮 warn');
  assert.equal(noPin.grade, 'warn');
});

test('E3 auditMemory: 畸形输入不抛，返回 empty 档', () => {
  for (const bad of [null, undefined, 'x', 42, {}]) {
    const r = auditMemory(bad);
    assert.ok(r && typeof r.grade === 'string', '畸形输入必须降级为合法读数');
  }
});

test('E4 insightSummary: 空态与正常态文案可区分', () => {
  assert.equal(insightSummary({}), '还没有可洞察的记忆');
  const s = insightSummary({
    senses: [{ count: 3 }, { count: 1 }],
    scenes: [{ count: 2 }],
    lifecycle: { total: 10, rows: [] },
    audit: { gradeLabel: '状况良好' }
  });
  assert.ok(s.includes('2 个感官维度') && s.includes('1 个场景') && s.includes('长期 10 条') && s.includes('状况良好'));
});

// ============================================================
// F. 零消费欠债闭环（本版的核心动机）
// ============================================================
test('F1 五感归档与场景聚合已被产品代码消费（此前全仓零调用）', () => {
  const appSrc = read('apps/memory/memory-app.js');
  assert.ok(appSrc.includes('getSensoryArchive'), '控制器必须消费 getSensoryArchive');
  assert.ok(appSrc.includes('getSceneTags'), '控制器必须消费 getSceneTags');
  assert.ok(appSrc.includes('senseRows') && appSrc.includes('sceneRows'));
});

test('F2 insights() 单一出口：六面逐面容错（任一面失败只空该面）', () => {
  const appSrc = read('apps/memory/memory-app.js');
  // 六面各有独立 try/catch —— 不允许一面抛错连坐整页
  const faces = ['getSensoryArchive', 'getSceneTags', 'lifecycleRows', 'supersedePairs', 'emotionTrace', 'auditMemory'];
  for (const f of faces) {
    const at = appSrc.indexOf(f + '(');   // 带左括号 = 真实调用点，跳过文件头注释与 import
    assert.ok(at > 0, `缺少面 ${f}`);
    const seg = appSrc.slice(at, at + 400);
    assert.ok(seg.includes('try') || appSrc.slice(Math.max(0, at - 200), at).includes('try'), `${f} 取数须在 try 保护内`);
  }
});

test('F3 视图 _esc 四转义齐备（引号转成实体，不得转义成自身）', () => {
  const viewSrc = read('apps/memory/memory-view.js');
  assert.ok(viewSrc.includes('this.app.insights('), '视图必须经 insights() 取数');
  // 目标串用 charCode 运行时拼接，源码不含任何实体序列（写入工具会解码实体）
  const A = String.fromCharCode(38);   // &
  const DQ = String.fromCharCode(34);  // "
  const SQ = String.fromCharCode(39);  // '
  const SP = String.fromCharCode(32);  // space
  const repl = (ch, ent) => '.replace(/' + ch + '/g,' + SP + SQ + A + ent + SQ + ')';
  assert.ok(viewSrc.includes(repl(A, 'amp;')), '_esc 必须把 & 转成实体');
  assert.ok(viewSrc.includes(repl('<', 'lt;')), '_esc 必须把 < 转成实体');
  assert.ok(viewSrc.includes(repl('>', 'gt;')), '_esc 必须把 > 转成实体');
  assert.ok(viewSrc.includes(repl(DQ, 'quot;')), '_esc 必须把 " 转成实体（v246 J15 回归锁）');
  assert.ok(!viewSrc.includes('.replace(/' + DQ + '/g,' + SP + SQ + DQ + SQ + ')'), '" 到 " 是无转义（转义成自身=没转）');
});

test('F4 分页结构：四页 id 唯一 + 非法分页回落 overview', () => {
  const viewSrc = read('apps/memory/memory-view.js');
  const ids = [...viewSrc.matchAll(/id:\s*'([a-z]+)'/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(ids)].sort(), ['audit', 'overview', 'scene', 'sense'].sort());
  assert.ok(viewSrc.includes("this._tab = 'overview'"), '非法 _tab 必须回落 overview');
});

test('F5 事件不累积：委托监听有幂等标志', () => {
  const viewSrc = read('apps/memory/memory-view.js');
  assert.ok(viewSrc.includes('_delegated'), '重复 render 不得叠加监听');
});

test('F6 巩固单一入口：视图经 app.sleepNow()，不直摸 core.sleep', () => {
  const viewSrc = read('apps/memory/memory-view.js');
  const appSrc = read('apps/memory/memory-app.js');
  assert.ok(viewSrc.includes('sleepNow()'), '视图应调 app.sleepNow()');
  assert.ok(!/data\?\.\s*sleep\?\.\(/.test(viewSrc), '视图不得直摸 core.sleep（两处各写一遍必然漂移）');
  assert.ok(appSrc.includes('sleepNow()'), '控制器提供 sleepNow 单一入口');
});

test('F7 CSS 落点：分页条 + 三页卡片样式齐备', () => {
  const css = read('apps/memory/memory.css');
  for (const cls of ['.mem-tabs', '.mem-tab.on', '.mem-body', '.mem-sense-card', '.mem-scene-card', '.mem-audit-card', '.mem-lc-card', '.mem-sup-card', '.mem-trace-bar', '.mem-issue']) {
    assert.ok(css.includes(cls), `缺少样式 ${cls}`);
  }
});

test('F8 onChatChanged 不持有数据副本（防缓存陈旧）', () => {
  const appSrc = read('apps/memory/memory-app.js');
  const at = appSrc.indexOf('onChatChanged()');
  assert.ok(at > 0, '缺少 onChatChanged');
  const body = appSrc.slice(at, appSrc.indexOf('}', appSrc.indexOf('onChatChanged()') + 20) + 1);
  assert.ok(!/this\._cache|this\._snapshot/.test(body), '不得缓存数据副本');
});

// ============================================================
// G. 版本四源同源
// ============================================================
test('G1 2.57.0 条目在账且结构完整（锚定自身版本，不随升版漂移）', () => {
  const log = JSON.parse(read('update-log.json'));
  assert.ok(log.versions['2.57.0'], 'update-log 缺 2.57.0 条目');
  assert.equal(log.versions['2.57.0'].version, '2.57.0');
  const items = log.versions['2.57.0'].items;
  assert.ok(Array.isArray(items) && items.length >= 4, `n=${items && items.length}`);
  assert.ok(items.every((it) => typeof it === 'string' && it.length > 0), 'items 含空项');
});

test('G2 2.57.0 条目首条为功能本体（主菜置顶，锚定自身版本不漂移）', () => {
  const items = JSON.parse(read('update-log.json')).versions['2.57.0'].items;
  assert.ok(items[0].includes('[新功能]') || items[0].includes('记忆洞察'), '首条非主菜');
});

test('G3 2.57.0 条目记录了洞察功能本体（防只记杂项不记主菜）', () => {
  const items = JSON.parse(read('update-log.json')).versions['2.57.0'].items.join('\n');
  assert.match(items, /memory-insights|记忆洞察/);
  assert.match(items, /五感|感官/);
});
