/**
 * tests/system-v286.test.mjs — 剧情线接入两本新账本 [v2.86.0]
 *
 * 来源：记忆插件 3.196.0 新增 parallelLedger（平行事实）与 secretLedger（秘密）两账本，
 *   手机侧保持只读投影，经桥快照 worldProg 消费。
 *
 * 覆盖：
 *   1  parallelList / secretList 投影取数（缺账本如实 []，畸形条目跳过）
 *   2  plotlinePromptBlock 注入行口径（已传开给全量 / 暗线只给标题地点 / 秘密标注持有者）
 *   3  面板防剧透：暗线卡不显事实正文、秘密卡不显内容
 *   4  五源同源 2.86.0（package / manifest / ST_PHONE_VERSION / update-log latest / versions 首键）
 *   5  弹窗逐字同源（ST_PHONE_CURRENT_UPDATE.items == update-log versions[latest].items）
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parallelList, secretList, plotlinePromptBlock } from '../apps/plotline/plotline-data.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

test('v286 1. 两投影取数：缺账本如实 []，畸形条目跳过', () => {
  assert.deepEqual(parallelList(null), []);
  assert.deepEqual(parallelList({}), []);
  assert.deepEqual(secretList(undefined), []);
  const wp = {
    parallelLedger: { items: [
      { id: 'par_1', title: '船期', fact: '货船改道', place: '外港', audience: 'overheard', status: 'open' },
      { id: 'par_2', title: '密谋', fact: '码头接头', place: '码头', audience: 'hidden', status: 'open' },
      null,
      { title: '' },
      { id: 'par_3', title: '结案', fact: '已了结', place: '巡捕房', audience: 'hidden', status: 'settled' }
    ] },
    secretLedger: { items: [
      { id: 'sec_1', secret: '养女实为仇家之后', keeper: '阿绣', progress: 30, status: 'advancing' },
      { id: 'sec_2', secret: '已揭露', keeper: '老周', progress: 100, status: 'revealed' }
    ] }
  };
  const pl = parallelList(wp);
  assert.equal(pl.length, 3, 'settled 原样透传，null 与空标题被跳过');
  assert.equal(pl[0].audience, 'overheard');
  assert.equal(pl[1].audience, 'hidden');
  assert.equal(pl[2].status, 'settled');
  const sl = secretList(wp);
  assert.equal(sl.length, 2, '投影原样透传，状态过滤留给消费侧');
  assert.equal(sl[0].progress, 30);
  assert.equal(sl[0].keeper, '阿绣');
});

test('v286 2. 注入行口径：已传开全量 / 暗线只给标题地点 / 秘密标注持有者', () => {
  const wp = {
    parallelLedger: { items: [
      { id: 'par_1', title: '船期', fact: '货船改道', place: '外港', audience: 'overheard', status: 'open' },
      { id: 'par_2', title: '密谋', fact: '码头接头', place: '码头', audience: 'hidden', status: 'open' }
    ] },
    secretLedger: { items: [
      { id: 'sec_1', secret: '养女实为仇家之后', keeper: '阿绣', progress: 30, status: 'advancing' }
    ] }
  };
  const block = plotlinePromptBlock({ outline: null, worldProg: wp });
  assert.ok(block.includes('别处已传开：船期（外港）货船改道'), '已传开行给全量事实');
  assert.ok(block.includes('别处暗线'), '暗线行存在');
  assert.ok(block.includes('密谋（码头）'), '暗线给标题地点');
  assert.ok(!block.includes('码头接头'), '暗线不给事实正文');
  assert.ok(block.includes('未揭露秘密（持有者：阿绣，进度 30%'), '秘密行带持有者与进度');
  assert.ok(block.includes('不得无来由泄露'), '秘密行带泄露约束');
  // 已了结条目不进正文
  const wp2 = {
    parallelLedger: { items: [
      { id: 'par_1', title: '结案', fact: '已了结', place: '巡捕房', audience: 'overheard', status: 'settled' }
    ] },
    secretLedger: { items: [
      { id: 'sec_1', secret: '已揭露', keeper: '老周', progress: 100, status: 'revealed' }
    ] }
  };
  assert.equal(plotlinePromptBlock({ outline: null, worldProg: wp2 }), '', 'settled/revealed 不进注入');
});

test('v286 3. 面板防剧透：暗线卡不显事实正文、秘密卡不显内容', () => {
  const src = read('apps/plotline/plotline-view.js');
  // 暗线分支只拼 title+place，不拼 fact
  const m = src.match(/_parallelCard\(face, parallels\) \{[\s\S]*?\n    \}/);
  assert.ok(m, '_parallelCard 可提取');
  assert.ok(m[0].includes('暗线'), '暗线标签存在');
  assert.ok(!/hidden[\s\S]{0,400}p\.fact/.test(m[0]), '暗线分支不引用 p.fact');
  // 秘密卡只拼 keeper+progress，不拼 secret 内容
  const m2 = src.match(/_secretCard\(face, secrets\) \{[\s\S]*?\n    \}/);
  assert.ok(m2, '_secretCard 可提取');
  assert.ok(m2[0].includes('进度'), '秘密卡显示进度');
  assert.ok(!/x\.secret/.test(m2[0]), '秘密卡不引用 x.secret');
  // app 层 projection 带出两投影
  const app = read('apps/plotline/plotline-app.js');
  assert.ok(app.includes('parallelList') && app.includes('secretList'), 'app 层接入两投影');
});

test('v286 4. 五源同源 2.86.0', () => {
  const version = '2.86.0';
  const idxSrc = read('index.js');
  assert.match(read('package.json'), new RegExp(`"version": "${version}"`));
  assert.match(read('manifest.json'), new RegExp(`"version": "${version}"`));
  assert.match(idxSrc, new RegExp(`const ST_PHONE_VERSION = '${version}'`));
  const log = JSON.parse(read('update-log.json'));
  assert.equal(log.latest, version);
  assert.equal(Object.keys(log.versions)[0], version);
  assert.ok(log.versions[version], '本版条目存在');
  assert.match(idxSrc, new RegExp(`版本升至 ${version.replace(/\./g, '\\.')}（五源同源）`));
});

test('v286 5. 弹窗逐字同源', () => {
  const idxSrc = read('index.js');
  const log = JSON.parse(read('update-log.json'));
  const entry = log.versions[log.latest];
  assert.ok(entry, '本版条目存在');
  // ST_PHONE_CURRENT_UPDATE.items 与 update-log 条目逐字一致
  const m = idxSrc.match(/const ST_PHONE_CURRENT_UPDATE = \{[\s\S]*?\n\};/);
  assert.ok(m, 'ST_PHONE_CURRENT_UPDATE 可提取');
  for (const item of entry.items) {
    assert.ok(m[0].includes(JSON.stringify(item)), '弹窗 items 逐字同源：' + item.slice(0, 20) + '…');
  }
  assert.match(m[0], new RegExp('date: "' + entry.date + '"'), 'date 同源');
});