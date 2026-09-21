/**
 * system-v260.test.mjs — v2.60.0 起名台 + 手术库（LA 纯数据模块移植）
 *
 * 【背景】上游 LA-0.7.68 拓展版是单文件 IIFE 大插件（67 个虚拟模块靠 `/* src/xxx.js *\/`
 *   注释分界、模块间靠 `__LA_XXX__` 全局单例耦合）。本轮把其中两块**零宿主依赖纯数据**
 *   模块解耦移植进 health App：
 *     - src/modules/family/name-data.js   → name-data.js（NAME_DATA 人名库，纯数据）
 *     - src/modules/medical/surgery-library.js → surgery-library.js（SURGERY_LIBRARY 59 术式）
 *   各加一个 service 封装层，落到「家谱」页签起名台 + 「健康」页签手术库，只读、不写状态。
 *
 * 【为什么可以直接 import 内核】name-data / surgery-library / name-service / surgery-service
 *   均纯 ESM、零 window/DOM/localStorage/fetch 依赖，本套件直接导入做**真功能测试**。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
import { NAME_DATA } from '../apps/health/name-data.js';
import { SURGERY_LIBRARY, stageTable, STAGE_TEMPLATES } from '../apps/health/surgery-library.js';
import { nameLangs, nameStats, generateName } from '../apps/health/name-service.js';
import { surgeryChapters, surgeryByChapter, surgeryStats, surgerySummary } from '../apps/health/surgery-service.js';

// ============================================================
// A. 起名：NAME_DATA 真数据 + service 生成
// ============================================================
test('A1 NAME_DATA 结构完整：3 语言姓池 + 给名池', () => {
  assert.deepEqual(Object.keys(NAME_DATA.surnames).sort(), ['chinese', 'japanese', 'western']);
  assert.equal(NAME_DATA.surnames.chinese.length, 499, '中文姓 499');
  assert.equal(NAME_DATA.surnames.western.length, 1557, '西姓 1557');
  assert.equal(NAME_DATA.surnames.japanese.length, 2925, '日姓 2925');
  // 给名：western/japanese 扁平，chinese 按 single/double 分组
  assert.equal(NAME_DATA.given.western.female.length, 542, '西女名 542');
  assert.equal(NAME_DATA.given.japanese.male.length, 2110, '日男名 2110');
  assert.ok(Array.isArray(NAME_DATA.given.chinese.female.single), '中女名 single 组');
  assert.ok(Array.isArray(NAME_DATA.given.chinese.female.double), '中女名 double 组');
});

test('A2 nameLangs/nameStats 规模一致', () => {
  assert.equal(nameLangs().length, 3);
  const st = nameStats();
  assert.equal(st.chinese.surnames, 499);
  assert.equal(st.western.female, 542);
  assert.equal(st.japanese.male, 2110);
  assert.equal(st.chinese.male, NAME_DATA.given.chinese.male.single.length + NAME_DATA.given.chinese.male.double.length, '中文男名展平');
});

test('A3 generateName 随机 + 固定姓 + 三语言均能出名', () => {
  for (const lang of ['chinese', 'japanese', 'western']) {
    for (const gender of ['male', 'female']) {
      const n = generateName({ lang, gender });
      assert.ok(n, lang + ' ' + gender + ' 出名');
      assert.equal(n.lang, lang);
      assert.equal(n.gender, gender);
      assert.ok(n.surname.length >= 1, '有姓');
      assert.ok(n.full.indexOf(n.surname) === 0, 'full 以姓开头');
    }
  }
});

test('A4 generateName 固定姓生效 + 池内约束', () => {
  const fixed = generateName({ lang: 'chinese', surname: '赵' });
  assert.equal(fixed.surname, '赵', '固定姓赵');
  assert.ok(NAME_DATA.surnames.chinese.indexOf('赵') >= 0, '赵在姓池');
  const n = generateName({ lang: 'western', gender: 'female' });
  assert.ok(NAME_DATA.given.western.female.indexOf(n.given) >= 0, '给名在池内');
});

test('A5 generateName 50 次随机稳定不抛且姓必在池', () => {
  for (let i = 0; i < 50; i++) {
    const n = generateName({ lang: 'chinese', gender: i % 2 ? 'male' : 'female' });
    assert.ok(n && n.full, '第 ' + i + ' 次出名');
    assert.ok(NAME_DATA.surnames.chinese.indexOf(n.surname) >= 0, '姓在池');
  }
});

// ============================================================
// B. 手术库：SURGERY_LIBRARY 真数据 + service 分组
// ============================================================
test('B1 SURGERY_LIBRARY 59 术式 + 每条目 schema 完整', () => {
  assert.equal(SURGERY_LIBRARY.length, 59, '59 条');
  for (const s of SURGERY_LIBRARY) {
    assert.ok(s.id && s.name, '有 id/name：' + s.id);
    assert.ok(s.chapter, '有章节：' + s.id);
    assert.ok(s.category, '有类目：' + s.id);
    assert.ok([1, 2, 3, 4].indexOf(s.grade) >= 0, '分级 1-4：' + s.id);
    assert.ok(Array.isArray(s.stages) && s.stages.length > 0, '有阶段：' + s.id);
    for (const st of s.stages) {
      assert.ok(typeof st.id === 'string' && typeof st.typicalMinutes === 'number', '阶段结构：' + s.id);
    }
  }
});

test('B2 stageTable 纯函数：模板段 + 去段 + 改名 + 补段', () => {
  const open = stageTable('open');
  assert.ok(open[0].id === 'room_in' && open[0].typicalMinutes === 0, '首段 room_in 0min');
  const last = open[open.length - 1];
  assert.ok(last.id === 'wake' || last.id === 'out', '末段 wake|out');
  // 去段
  const dropped = stageTable('open', undefined, { drop: ['anesthesia'] });
  assert.equal(dropped.filter((s) => s.id === 'anesthesia').length, 0, '去麻醉段');
  // 改名
  const renamed = stageTable('open', undefined, { rename: { incision: '切皮' } });
  assert.equal(renamed.filter((s) => s.id === 'incision')[0].name, '切皮', '改名生效');
  // 模板段 id 都在词表
  for (const tpl of Object.values(STAGE_TEMPLATES)) {
    assert.ok(Array.isArray(tpl) && tpl.length > 0, '模板非空');
  }
});

test('B3 surgeryChapters/surgeryByChapter 分组自洽', () => {
  const chs = surgeryChapters();
  assert.ok(chs.length > 1, '多章');
  assert.equal(chs.reduce((a, c) => a + c.count, 0), 59, '各章 count 之和 = 59');
  for (const c of chs) {
    assert.equal(surgeryByChapter(c.name).length, c.count, '章节 ' + c.name + ' 一致');
  }
  assert.equal(surgeryByChapter().length, 59, '不传章节=全部');
});

test('B4 surgerySummary/surgeryStats 只读派生正确', () => {
  const app = surgeryByChapter('第九章 消化系统手术').find((s) => s.id === '47.0');
  assert.ok(app, '阑尾切除术存在');
  assert.equal(app.name, '阑尾切除术');
  const sum = surgerySummary(app);
  assert.equal(sum.id, '47.0');
  assert.equal(sum.gradeLabel, '二级');
  assert.ok(sum.stageCount > 0 && sum.stageMinutes > 0, '阶段分钟合计 >0');
  const stats = surgeryStats();
  assert.equal(stats.total, 59);
  assert.equal(stats.chapters, surgeryChapters().length);
  assert.equal(stats.byGrade[1] + stats.byGrade[2] + stats.byGrade[3] + stats.byGrade[4], 59, '分级之和 = 59');
  assert.ok(stats.avgStageMinutes > 0, '均值 >0');
});

// ============================================================
// F. 源码不变量：数据自包含 + service 封装 + view 消费闭环
// ============================================================
test('F1 数据/服务零宿主依赖：不引用 window/document/localStorage/fetch', () => {
  for (const f of ['apps/health/name-data.js', 'apps/health/surgery-library.js', 'apps/health/name-service.js', 'apps/health/surgery-service.js']) {
    const src = read(f);
    assert.ok(src.length > 500, f + ' 非空');
    for (const bad of ['window.', 'document.', 'localStorage', 'fetch(', 'SillyTavern']) {
      assert.ok(!src.includes(bad), f + ' 不得包含 ' + bad);
    }
  }
});

test('F2 数据文件保留 LA 移植血缘注释 + 手术库 59 条目', () => {
  const nd = read('apps/health/name-data.js');
  assert.ok(nd.includes('LA-0.7.68') && nd.includes('name-data.js'), 'name-data 血缘注释');
  const sl = read('apps/health/surgery-library.js');
  assert.ok(sl.includes('LA-0.7.68') && sl.includes('surgery-library.js'), 'surgery 血缘注释');
  assert.equal((sl.match(/chapter: /g) || []).length, 59, '59 个 chapter 字段');
});

test('F3 view 消费闭环：起名台 + 手术库均接进 health-view', () => {
  const src = read('apps/health/health-view.js');
  assert.ok(src.includes("from './name-service.js'"), 'import name-service');
  assert.ok(src.includes("from './surgery-service.js'"), 'import surgery-service');
  assert.ok(src.includes('generateName'), '消费 generateName');
  assert.ok(src.includes('surgeryByChapter') || src.includes('surgeryChapters'), '消费手术分组');
  assert.ok(src.includes('hl-name-gen'), '起名生成按钮');
  assert.ok(src.includes('data-surg-id'), '手术条目落点');
  assert.ok(src.includes('hl-surg-ch'), '手术章节选择器');
});

test('F4 CSS 落点：起名台 + 手术库样式', () => {
  const src = read('apps/health/health.css');
  assert.ok(src.includes('.hl-name-box'), '起名台容器');
  assert.ok(src.includes('.hl-name-result'), '起名结果');
  assert.ok(src.includes('.hl-surg-box'), '手术库容器');
  assert.ok(src.includes('.hl-surg-item'), '手术条目');
});

// ============================================================
// G. 版本锚定：2.60.0 条目记录起名台+手术库（防只记杂项不记主菜）
// ============================================================
test('G1 版本四源同源（当前版本由 index.js 定义，动态跟随）', () => {
  const idx = read('index.js');
  const m = idx.match(/ST_PHONE_VERSION\s*=\s*'(\d+\.\d+\.\d+)'/);
  assert.ok(m, 'index.js 定义 ST_PHONE_VERSION');
  const v = m[1];
  assert.equal(JSON.parse(read('manifest.json')).version, v, 'manifest 同源');
  assert.equal(JSON.parse(read('package.json')).version, v, 'package 同源');
  const log = JSON.parse(read('update-log.json'));
  assert.equal(log.latest, v, 'update-log.latest 同源');
  assert.ok(Object.prototype.hasOwnProperty.call(log.versions, v), 'update-log 含当前版本条目');
});

test('G2 2.60.0 条目记录了起名台 + 手术库移植', () => {
  const log = JSON.parse(read('update-log.json'));
  assert.ok(log.versions['2.60.0'], 'update-log 缺 2.60.0 条目');
  const items = log.versions['2.60.0'].items.join('\n');
  assert.ok(items.includes('起名') || items.includes('人名库'), '条目提及起名/人名库');
  assert.ok(items.includes('手术') || items.includes('术式'), '条目提及手术/术式');
});

test('G3 旧锚点 2.59.0 仍保留（升版后历史条目不丢失）', () => {
  const log = JSON.parse(read('update-log.json'));
  assert.ok(log.versions['2.59.0'], '2.59.0 历史条目丢失');
  assert.ok(log.versions['2.59.0'].items.join('\n').includes('国际象棋') || log.versions['2.59.0'].items.join('\n').includes('将棋'), '2.59.0 仍记棋种');
});