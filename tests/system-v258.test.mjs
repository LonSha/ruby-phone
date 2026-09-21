/**
 * system-v258.test.mjs — v2.58.0 育种推演（Breeding Simulator）
 *
 * 【背景】健康 App v2.56 起已缝入 bio-engine/bio-races（妊娠/产程/种族表），本轮结合上游
 *   Liuuuu54/st_bs_biotracker v0.9.9 的增量，新增 apps/health/bio-propagation.js ——
 *   异种繁殖推演纯算法层（自然受精预测 / 后代预测 / 衍生遗传三组只读推演，零 LLM、不写状态）。
 *
 * 【为什么可以直接 import 内核】bio-propagation.js 及其依赖（bio-races.js / bio-engine.js 的
 *   常量）均为纯 ESM、零 window / storage / DOM 依赖，本套件直接导入做**真功能测试**；
 *   App/视图层另做源码不变量锁定（宿主 window 依赖无法无头实例化）。
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
  SPERM_DECAY_PER_DAY, CROSS_RACE_DIFFICULTY_MULTIPLIER, EMBRYO_TYPE_MISMATCH_MULTIPLIER,
  DERIVED_INHERITANCE_THRESHOLD, DERIVED_INHERITANCE_BASELINE_DAYS, DERIVED_TYPE_RACES,
  RACE_CLUTCH_SIZE_MEANS,
  calculateSpermExposure, calculateFertilizationPreview, calculateImplantationPreview,
  calculateOffspringPreview, deriveFetusRace, getFetusInheritanceTag,
  getClutchSizeMeanByRace, getSpermDoseClutchMultiplier, getSpermDoseDifficultyBonus,
  getDerivedInheritanceSeed, calculateDerivedInheritancePreview,
} from '../apps/health/bio-propagation.js';

// ============================================================
// A. 纯内核：三组推演真功能
// ============================================================
test('A1 常量与精液衰减：20 一天剩 10，衰减不为负', () => {
  assert.equal(SPERM_DECAY_PER_DAY, 10);
  assert.equal(CROSS_RACE_DIFFICULTY_MULTIPLIER, 1.5);
  assert.equal(EMBRYO_TYPE_MISMATCH_MULTIPLIER, 1.25);
  assert.equal(DERIVED_INHERITANCE_THRESHOLD, 75);
  assert.equal(DERIVED_INHERITANCE_BASELINE_DAYS, 140);

  const sp1 = calculateSpermExposure(20, 1);
  assert.equal(sp1.endingValue, 10, '精液20一天后剩10');
  assert.ok(sp1.exposureDays > 0, '存在暴露天数');
  const sp2 = calculateSpermExposure(20, 2);
  assert.equal(sp2.endingValue, 0, '衰减到0不为负');
  const sp3 = calculateSpermExposure(5, 100);
  assert.equal(sp3.endingValue, 0, '少量精液长时衰减为0');
});

test('A2 自然受精预测：人类同种有精源、同种族、难度>0', () => {
  const f = calculateFertilizationPreview({ eggRace: '人类', spermSources: [{ race: '人类', value: 20 }] });
  assert.ok(f.sources.length >= 1, '至少一个精源');
  assert.equal(f.sources[0].sameRace, true, '同种族 sameRace');
  assert.ok(f.femaleDifficulty > 0, '女性难度>0');
  assert.ok(f.successChance >= 0 && f.successChance <= 1, '受孕率在0-1');
  assert.ok(f.failureChance >= 0 && f.failureChance <= 1, '失败率在0-1');
  assert.ok(Math.abs(f.successChance + f.failureChance - 1) < 1e-9, '成功+失败=1');
});

test('A3 后代预测：人类×人类 → 人类胎生单卵群 280 天', () => {
  const off = calculateOffspringPreview({ eggRace: '人类', spermRace: '人类' });
  assert.equal(off.fetusRace, '人类', '同人类后代种族');
  assert.equal(off.embryoType, '胎生', '人类胚型胎生');
  assert.equal(off.clutchSizeMean, 1, '人类单卵群');
  assert.equal(off.clutchRange.typical, 1, '人类典型卵数1');
  assert.equal(off.gestationDays, 280, '人类孕期 280 天');
  assert.equal(off.embryoTypeSource, '人类', '胚型来源');
});

test('A4 卵群规模：多产种族经字典生效', () => {
  // 远程 v0.9.9 RACE_CLUTCH_SIZE_MEANS 移植后的多产种族
  assert.equal(getClutchSizeMeanByRace('植物亚人'), 12, '植物亚人卵群12');
  assert.equal(getClutchSizeMeanByRace('蜥蜴人'), 12, '蜥蜴人卵群12');
  assert.equal(getClutchSizeMeanByRace('社会虫族'), 50, '社会虫族50');
  assert.equal(getClutchSizeMeanByRace('蛙人'), 100, '蛙人100');
  // 未列入字典的卵生种族回落单卵群
  assert.equal(getClutchSizeMeanByRace('鸟人'), 1, '鸟人默认单卵群');
  // 胎生恒为单卵群
  assert.equal(getClutchSizeMeanByRace('人类'), 1, '人类单卵群');
  assert.equal(getSpermDoseClutchMultiplier(40), 1.5, '精液40 → 1.5倍卵群');
  assert.equal(getSpermDoseClutchMultiplier(20), 1, '精液20 → 1倍');
  assert.ok(Math.abs(getSpermDoseDifficultyBonus(20) - 1) < 1e-9, '标准量20 → 1倍难度');
});

test('A5 衍生遗传：母方修炼 200 天越过判定线', () => {
  const der = calculateDerivedInheritancePreview({ motherDerivedType: '修炼', fatherDerivedType: null, fetusRace: '人类', affinity: 0 });
  assert.equal(der.direction, 1, '仅母方 → 正向');
  assert.equal(der.activeDerivedType, '修炼', '激活类型修炼');
  assert.ok(der.wholeDaysToInherit !== null && der.wholeDaysToInherit > 0, '有到判定线天数');
  assert.equal(der.inheritedType, null, '未越线不继承');

  const der2 = calculateDerivedInheritancePreview({ motherDerivedType: '修炼', fatherDerivedType: null, fetusRace: '人类', affinity: 0, currentProgress: 0, passedDays: 200 });
  assert.ok(der2.nextProgress > DERIVED_INHERITANCE_THRESHOLD, '推进200天越过判定线 ' + der2.nextProgress);
  assert.equal(der2.inheritedType, '修炼', '越线继承修炼');
});

test('A6 衍生类型注册与遗传种子', () => {
  assert.equal(DERIVED_TYPE_RACES.length, 12, '12 类衍生类型');
  const seed = getDerivedInheritanceSeed('修炼', '修炼');
  assert.equal(seed.affinity, 30, '同衍生同源亲和30');
  assert.equal(seed.progress, 30, '同衍生同源进度30');
});

test('A7 混血后代：人类×精灵 仍是混合胚型胎生', () => {
  const mix = calculateOffspringPreview({ eggRace: '人类', spermRace: '精灵' });
  assert.ok(mix.fetusRace.includes('x') || mix.fetusRace === '人类' || mix.fetusRace === '精灵', '混血后代 ' + mix.fetusRace);
  assert.equal(mix.embryoType, '胎生', '卵胎生族混血胚型胎生');
});

// ============================================================
// F. 源码不变量：文件存在、导出、零退化
// ============================================================
test('F1 bio-propagation.js 存在且可被引，导出关键算法', () => {
  const src = read('apps/health/bio-propagation.js');
  assert.ok(src.length > 1000, '文件非空');
  for (const name of ['calculateFertilizationPreview', 'calculateOffspringPreview', 'calculateDerivedInheritancePreview', 'RACE_CLUTCH_SIZE_MEANS']) {
    assert.ok(src.includes(name), '包含 ' + name);
  }
});

test('F2 RACE_CLUTCH_SIZE_MEANS 已注入（上游增量落地）', () => {
  const src = read('apps/health/bio-propagation.js');
  assert.ok(RACE_CLUTCH_SIZE_MEANS['植物亚人'] === 12, '字典已导出');
});

test('F3 不变量：生物推演不含 window/DOM/openai/MVU 依赖', () => {
  const src = read('apps/health/bio-propagation.js');
  for (const bad of ['window.', 'document.', 'localStorage', 'openai', 'fetch(']) {
    assert.ok(!src.includes(bad), 'bio-propagation 不得包含 ' + bad);
  }
});

test('F4 不变量：setHealthTab 白名单含全部 5 页签（修复 medical 既有 bug + 新增 breeding）', () => {
  const src = read('apps/health/health-data.js');
  const m = src.match(/setHealthTab\(tab\)\s*\{[\s\S]*?\['([^']+)',\s*'([^']+)',\s*'([^']+)',\s*'([^']+)',\s*'([^']+)'\]/);
  assert.ok(m, 'setHealthTab 含 5 项白名单');
  const tabs = m.slice(1).map(s => s.trim());
  for (const t of ['cycle', 'needs', 'medical', 'family', 'breeding']) {
    assert.ok(tabs.includes(t), '白名单含 ' + t);
  }
});

test('F5 不变量：view 第 5 页签「育种」落点 + 三组推演函数被消费', () => {
  const src = read('apps/health/health-view.js');
  assert.ok(src.includes('"breeding"'), '育种 tab 按钮');
  assert.ok(src.includes('calculateOffspringPreview'), 'view 消费 calculateOffspringPreview');
  assert.ok(src.includes('calculateFertilizationPreview'), 'view 消费 calculateFertilizationPreview');
  assert.ok(src.includes('calculateDerivedInheritancePreview'), 'view 消费 calculateDerivedInheritancePreview');
  assert.ok(src.includes('hl-breed-card'), '育种卡片渲染');
});

// ============================================================
// G. 版本锚定（锚定自身 update-log 条目，不随升版漂移）
// ============================================================
test('G1 2.58.0 条目在账且结构完整（锚定自身版本，不随升版漂移）', () => {
  const log = JSON.parse(read('update-log.json'));
  assert.ok(log.versions['2.58.0'], 'update-log 缺 2.58.0 条目');
  assert.equal(log.versions['2.58.0'].version, '2.58.0');
  const items = log.versions['2.58.0'].items;
  assert.ok(Array.isArray(items) && items.length >= 4, '2.58.0 条目含 >=4 条说明');
});
