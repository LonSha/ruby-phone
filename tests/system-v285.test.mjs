/**
 * tests/system-v285.test.mjs — 五条机制落地 + 两条 P1 收口 [v2.85.0]
 *
 * 机制（数据结构，不搬提示词）：
 *   · 平行事件近场 / 远场分层
 *   · 好感与信任分列（没有显式信任就不编）
 *   · 剧情线读伏笔账本的未回收条目
 * P1：
 *   · 构造期裸监听器收进 onceFlag + globalRuntime
 *   · 会话键不进 localStorage：删除侧显式跳过，用键表前后对比锁死
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { installRuntimeHost, resetHostFlags } from './_runtime_host.mjs';
import { enqueue, splitLayers } from '../apps/worldpulse/worldpulse-engine.js';
import { buildRelationAxes } from '../apps/timeweaver/timeweaver-engine.js';
import { seedList, plotlinePromptBlock } from '../apps/plotline/plotline-data.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const NS = 'st_virtual_phone';

const LISTENER_FILES = [
  'apps/achievement/achievement-app.js',
  'apps/diary/diary-app.js',
  'apps/wangxiang/wangxiang-app.js',
  'apps/phone/phone-app.js',
];

test('v285 1. 平行事件按近场远场切开，缺层默认近场', () => {
  let q = enqueue([], { id: 'a', layer: 'near', style: '都市日常' });
  q = enqueue(q, { id: 'b', layer: 'far', style: '都市日常' });
  q = enqueue(q, { id: 'c', style: '都市日常' });
  const split = splitLayers(q);
  assert.deepEqual(split.near.map((item) => item.id), ['a', 'c']);
  assert.deepEqual(split.far.map((item) => item.id), ['b']);
  assert.equal(splitLayers(null).near.length, 0);
});

test('v285 2. 好感与信任分列：没有信任样本就是 null，不是 0', () => {
  const rows = buildRelationAxes([
    { actors: ['林夏'], moodScore: 0.8, weight: 2, source: 'honey', extra: { trust: 0.2 } },
    { actors: ['林夏'], moodScore: 0.4, weight: 1, source: 'weibo', extra: {} },
    { actors: ['周宁'], moodScore: 0.9, weight: 3, source: 'honey', extra: {} },
  ]);
  const lin = rows.find((row) => row.name === '林夏');
  const zhou = rows.find((row) => row.name === '周宁');
  assert.ok(lin.affinity > 0);
  assert.equal(lin.trust, 0.2);
  assert.equal(lin.trustSamples, 1);
  assert.ok(zhou.affinity > 0, '相处多应有好感');
  assert.equal(zhou.trust, null, '没有信任样本不得编成 0');
  assert.equal(zhou.trustSamples, 0);
});

test('v285 3. 剧情线只注入未回收伏笔，已回收不进正文块', () => {
  const worldProg = {
    seedLedger: {
      items: [
        { id: 'seed_1', hook: '抽屉里的旧信', layer: 'near', status: 'open' },
        { id: 'seed_2', hook: '海边的旧案', layer: 'far', status: 'advancing' },
        { id: 'seed_3', hook: '已经拆穿的身份', layer: 'near', status: 'recovered' },
      ]
    }
  };
  assert.equal(seedList(worldProg).length, 3);
  assert.equal(seedList(null).length, 0);
  const block = plotlinePromptBlock({ worldProg });
  assert.match(block, /抽屉里的旧信/);
  assert.match(block, /远场/);
  assert.match(block, /海边的旧案/);
  assert.equal(block.includes('已经拆穿的身份'), false);
  const advancingNear = plotlinePromptBlock({
    worldProg: { seedLedger: { items: [{ id: 'n1', hook: '桌上的钥匙', layer: 'near', status: 'advancing' }] } }
  });
  assert.match(advancingNear, /回收中/);
  assert.equal(advancingNear.includes('远场'), false);
});

test('v285 4. 四份潜伏监听器不再留裸 window.addEventListener', () => {
  for (const file of LISTENER_FILES) {
    const code = read(file);
    assert.equal(/window\.addEventListener\s*\(/.test(code), false, file);
    assert.match(code, /onceFlag\(/, file);
    assert.match(code, /globalRuntime\.addListener\(/, file);
  }
});

test('v285 5. 会话键删除不碰 localStorage，全局键删除会清兜底', async () => {
  resetHostFlags();
  const host = installRuntimeHost();
  host.context.chatMetadata[NS] = {};
  host.context.extensionSettings[NS] = {};
  const writes = [];
  const removes = [];
  const store = host.localStorage;
  const origSet = store.setItem.bind(store);
  const origRemove = store.removeItem.bind(store);
  store.setItem = (key, value) => { writes.push(String(key)); origSet(key, value); };
  store.removeItem = (key) => { removes.push(String(key)); origRemove(key); };
  try {
    const { PhoneStorage } = await import('../config/storage.js?v285=' + Date.now());
    const st = new PhoneStorage();
    await st.set('wechat_settings_v1', { seeded: true }, true);
    removes.length = 0;
    await st.remove('wechat_settings_v1', true);
    assert.deepEqual(removes, [], '会话键不得对 localStorage 发删除');

    await st.set('global_phone_settings', { seeded: true }, true);
    removes.length = 0;
    await st.remove('global_phone_settings', true);
    assert.equal(removes.length, 1, '全局键的兜底必须被删掉');
    assert.match(removes[0], /global_phone_settings/);
    assert.ok(writes.some((key) => key.includes('global_phone_settings')), '前置：全局键确实写过兜底');
  } finally {
    host.uninstall();
  }
});

test('v285 6. 五源同源 2.85.0', () => {
  const version = '2.85.0';
  assert.match(read('package.json'), new RegExp(`"version": "${version}"`));
  assert.match(read('manifest.json'), new RegExp(`"version": "${version}"`));
  assert.match(read('index.js'), new RegExp(`const ST_PHONE_VERSION = '${version}'`));
  const log = JSON.parse(read('update-log.json'));
  assert.equal(log.latest, version);
  assert.equal(Object.keys(log.versions)[0], version);
  assert.match(read('index.js'), new RegExp(`版本升至 ${version}`));
});