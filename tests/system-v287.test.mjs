/**
 * tests/system-v287.test.mjs — 剧情线接前文回扣与回声账本投影 [v2.87.0]
 *
 * 素材：日月西预设第三批机制（└🔸前文回扣 / 🪶ta的物品组件）→ 记忆插件 3.197.0
 * 两账本（recall-echo.js / echo-ledger.js）→ 小手机只读投影。
 *
 * 覆盖：
 *   1  recallEchoList / echoLifeList 投影取数（pending 过滤、畸形容错、账本缺失返回 []）
 *   2  plotlinePromptBlock 注入行口径（回扣纪律 / 回声氛围标注）
 *   3  面板防剧透（回声卡不泄 fields/os 本体；_echoCard 已接线）
 *   4  v286 硬等号改下限锚点（防旧套件卡死版本）
 *   5  五源同源 2.87.0
 */
import test from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import path from 'node:path';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const read = (f) => readFileSync(path.join(ROOT, f), 'utf8');
const dataSrc = read('apps/plotline/plotline-data.js');
const appSrc = read('apps/plotline/plotline-app.js');
const viewSrc = read('apps/plotline/plotline-view.js');

const { recallEchoList, echoLifeList, plotlinePromptBlock } = await import('file://' + path.join(ROOT, 'apps/plotline/plotline-data.js'));

test('v287 1. 两投影取数', () => {
  // recallEchoList：只透传 pending
  const wp = {
    recallEcho: { items: [
      { id: 'echo_1', detail: '她说她怕黑', kind: 'behavior', status: 'pending', floor: 10 },
      { id: 'echo_2', detail: '停电', kind: 'clue', status: 'echoed', floor: 5 },
      { id: 'echo_3', detail: '伞', kind: 'item', status: 'skipped', floor: 9 }
    ] },
    echoLedger: { items: [
      { mode: 'pocket', char: '林晚', floor: 20, fields: { '物品': '薄荷糖' }, os: '甜的' }
    ] }
  };
  const e = recallEchoList(wp);
  assert.equal(e.length, 1, '只透传 pending');
  assert.equal(e[0].detail, '她说她怕黑');
  const l = echoLifeList(wp);
  assert.equal(l.length, 1);
  assert.equal(l[0].mode, 'pocket');
  assert.equal(l[0].char, '林晚');
  // 账本缺失/畸形 → []
  assert.deepEqual(recallEchoList(null), []);
  assert.deepEqual(recallEchoList({}), []);
  assert.deepEqual(echoLifeList({ recallEcho: null, echoLedger: 'junk' }), []);
  // 世界推进面缺失
  assert.deepEqual(recallEchoList({ worldProg: null }), []);
});

test('v287 2. 注入行口径', () => {
  const face = { outline: null, worldProg: {
    recallEcho: { items: [{ id: 'e1', detail: '她说她怕黑', kind: 'behavior', status: 'pending', floor: 10 }] },
    echoLedger: { items: [{ mode: 'pocket', char: '林晚', floor: 20 }] }
  } };
  const block = plotlinePromptBlock(face, { maxLines: 12 });
  assert.ok(block.includes('前文可回扣'), '回扣行');
  assert.ok(block.includes('不篡改原意'), '回扣纪律标注');
  assert.ok(block.includes('她说她怕黑'), '回扣细节进生成侧');
  assert.ok(block.includes('角色生活回声'), '回声行');
  assert.ok(block.includes('不得改写为剧情既定事实'), '回声氛围标注');
  // 回声 fields/os 本体不进一致性块（本体只在插件注入面）
  assert.ok(!block.includes('薄荷糖'), '回声本体不进 plotlinePromptBlock');
});

test('v287 3. 面板防剧透', () => {
  // _echoCard 已接线进渲染列表
  assert.ok(viewSrc.includes('this._echoCard('), 'echoCard 接线');
  // 回声卡显模式中文标签，但生活回声行不渲染 fields/os 值
  const cardFn = viewSrc.slice(viewSrc.indexOf('_echoCard(face, recallEchoes, echoLives)'));
  assert.ok(cardFn.includes('提问箱') && cardFn.includes('口袋小物'), '模式中文标签');
  assert.ok(!/x\.os|x\.fields|e\.os|e\.fields/.test(cardFn), '回声本体不进面板');
  // 回扣候选显 detail（回扣是玩家可见面）
  assert.ok(cardFn.includes('e.detail'), '回扣候选显细节');
});

test('v287 4. v286 五源断言已改下限锚点', () => {
  const t = read('tests/system-v286.test.mjs');
  assert.ok(!t.includes("const version = '2.86.0'"), 'v286 硬等号已摘除');
  assert.ok(t.includes('vnum') && t.includes('2.86.0'), '下限锚点保留');
});

test('v287 5. 五源同源 2.87.0', () => {
  const version = '2.87.0';
  const idxSrc = read('index.js');
  assert.match(read('package.json'), new RegExp(`"version": "${version}"`));
  assert.match(read('manifest.json'), new RegExp(`"version": "${version}"`));
  assert.match(idxSrc, new RegExp(`const ST_PHONE_VERSION = '${version}'`));
  const log = JSON.parse(read('update-log.json'));
  assert.equal(log.latest, version);
  assert.equal(Object.keys(log.versions)[0], version);
  assert.ok(log.versions[version], '本版条目存在');
  assert.match(idxSrc, new RegExp(`版本升至 ${version.replace(/\./g, '\\.')}（五源同源）`));
  // 弹窗逐字同源
  const m = idxSrc.match(/const ST_PHONE_CURRENT_UPDATE = \{[\s\S]*?\n\};/);
  assert.ok(m, 'ST_PHONE_CURRENT_UPDATE 可提取');
  for (const item of log.versions[version].items) {
    assert.ok(m[0].includes(JSON.stringify(item)), '弹窗 items 逐字同源：' + item.slice(0, 20) + '…');
  }
  // 数据源登记
  assert.ok(dataSrc.includes('recallEchoList') && dataSrc.includes('echoLifeList'), '两投影已定义');
  assert.ok(appSrc.includes('recallEchoList') && appSrc.includes('echoLifeList'), 'app 层接入两投影');
});