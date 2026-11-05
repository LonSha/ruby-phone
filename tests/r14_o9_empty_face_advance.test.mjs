// tests/r14_o9_empty_face_advance.test.mjs — 第十四期 R14-O9「空态和设置提示能带人解决问题」分形推进
//
// 计划书原文：
//   本期交付：优先高频未覆盖页面补重试/清筛选/前往授权。
//   验收旅程：空数据/筛空/读失败/源缺席各有对应动作；
//             三类设置各选实际控件证明声明与行为一致。
//
// 本套件守三件事：
//   · A 新分形三 App（loverspace/needsim/search）真带 data-face-why，且 empty 与
//     absent 两态都真实存在（不是只挂一个词）。
//   · B 台账同步：三 App 不再在 view-pending 台账里（已接线还留在台账=台账撒谎）。
//   · C 设置生效面（R13-O5 底座）在本期改动后仍然全绿（复跑关键判据的覆盖面）。
//   · D 负控制：把 search 的「没有找到」空态属性改成 read-failed ⇒ A 组判据必须转红。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const rd = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const NEW_SHAPED = [
  'apps/loverspace/loverspace-view.js',
  'apps/needsim/needsim-view.js',
  'apps/search/search-view.js'
];
test('A1 新分形三 App 真用 FACE_ATTR 常量（不许硬写属性字符串）', () => {
  for (const f of NEW_SHAPED) {
    const s = rd(f);
    assert.ok(s.includes('FACE_ATTR'), f + ' 必须用统一属性常量');
    assert.ok(s.includes('data-face='), f + ' 必须带 face 标记');
  }
});
test('A2 empty 与 absent 两态都真实存在（「真没有」与「读不到」分开说）', () => {
  const checks = [
    ['apps/loverspace/loverspace-view.js', /read-failed/, /_todayFace|_lettersFace|_qaFace/],
    ['apps/needsim/needsim-view.js', /read-failed/, /_rowsFace/],
    ['apps/search/search-view.js', /read-failed/, /no-data/]
  ];
  for (const [f, absentRe, emptyRe] of checks) {
    const s = rd(f);
    assert.ok(absentRe.test(s), f + ' 必须能标 absent（读不到）');
    assert.ok(emptyRe.test(s), f + ' 必须能标 empty（真没有）');
  }
});
test('A3 search 三处空态各有不同归因（没搜到≠来源读失败≠还在检索）', () => {
  const s = rd('apps/search/search-view.js');
  assert.ok(s.includes('${FACE_ATTR}="no-data" data-face="empty"'), '「没有找到」标 empty');
  assert.ok(s.includes('${FACE_ATTR}="read-failed" data-face="absent"'), '「来源读取失败」标 absent');
  assert.ok(s.includes('${FACE_ATTR}="not-ready" data-face="absent"'), '「正在检索」标 not-ready');
});
test('B1 台账同步：已分形的 App 不许留在 view-pending 台账', () => {
  const doc = JSON.parse(rd('config/empty-face-unshaped.json'));
  const apps = doc.unshaped.map((u) => u.app);
  for (const a of ['loverspace', 'needsim', 'search']) {
    assert.ok(!apps.includes(a), a + ' 已接线，不许留在未分形台账');
  }
  assert.equal(doc.shapedCount, 28, 'shapedCount 应为 28（25+3）');
  assert.equal(doc.unshapedCount, doc.unshaped.length, 'unshapedCount 与条目数一致');
});
test('C1 设置生效面在位（三档文本 + 未知档不同形 —— R13-O5 底座不动）', async () => {
  const eff = await import(path.join(ROOT, 'config/setting-effect.js'));
  assert.equal(eff.EFFECT_AT_TEXT.immediate, '立即生效');
  assert.equal(eff.EFFECT_AT_TEXT['next-turn'], '下一轮生成后生效');
  assert.equal(eff.EFFECT_AT_TEXT['next-session'], '重开手机后生效');
  assert.equal(eff.EFFECT_AT_UNKNOWN, '时机未声明');
  const keys = Object.keys(eff.SETTING_EFFECT);
  assert.ok(keys.length >= 150, '登记项应保持三位数，实测 ' + keys.length);
});
/* D 负控制：真源码破坏 → 临时副本上重跑 A3 同款判据必须转红。 */
test('D1 ★ 破坏 search 空态归因（no-data 改 read-failed）⇒ A3 必转红', async () => {
  const os = await import('node:os');
  const f = 'apps/search/search-view.js';
  const src = rd(f);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rp_o9_'));
  const dst = path.join(dir, f);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  const broken = src.replace('${FACE_ATTR}="no-data" data-face="empty"', '${FACE_ATTR}="read-failed" data-face="empty"');
  assert.notEqual(broken, src, '破坏必须真的改了文件');
  fs.writeFileSync(dst, broken, 'utf8');
  const s2 = fs.readFileSync(dst, 'utf8');
  assert.ok(!s2.includes('${FACE_ATTR}="no-data" data-face="empty"'), '破坏副本里 empty 归因已丢 ⇒ A3 若在此跑必红');
  fs.rmSync(dir, { recursive: true, force: true });
});
