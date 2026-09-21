/**
 * system-v255.test.mjs — v2.55.0 懒加载单例重绑单一真源
 *
 * 背景：index.js 里「换会话 / 清当前数据 / 清全部数据」三条路径各自硬编码了一份
 *   19 个懒加载单例 App 的 onChatChanged 重绑清单（v2.23 起逐版手抄，v2.24/v2.46/
 *   v2.47/v2.49/v2.51/v2.52/v2.53 每加一个 App 都要记得补三份）。
 *   漏补其中任一份 = 该 App 在对应路径上静默串味（换会话写回旧数据 / 清数据后仍持旧数据），
 *   与 v2.54 修掉的「钩子接线静默失效」同属**不报错、不崩溃、只错数据**的缺陷形态。
 *
 * v2.55 改为表驱动单一真源：index.js 顶部 ST_PHONE_REBIND_APP_KEYS + 函数 rebindLazyApps()，
 *   三处路径一律只调 rebindLazyApps()。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

const idx = read('index.js');
const tblSrc = (idx.match(/ST_PHONE_REBIND_APP_KEYS = \[([\s\S]*?)\];/) || [])[1] || '';
const KEYS = [...tblSrc.matchAll(/'([A-Za-z0-9_]+)'/g)].map((m) => m[1]);

// ---------- A. 单一真源结构 ----------
test('A1 重绑表存在且非空', () => {
  assert.ok(tblSrc.length > 0, 'ST_PHONE_REBIND_APP_KEYS 未找到');
  assert.ok(KEYS.length >= 19, `keys=${KEYS.length}`);
});

test('A2 重绑表 key 无重复', () => {
  assert.equal(new Set(KEYS).size, KEYS.length, 'keys 有重复：' + KEYS.filter((k, i) => KEYS.indexOf(k) !== i));
});

test('A3 每个 key 都能映射到真实单例构造点（防拼写错误静默 no-op）', () => {
  const miss = KEYS.filter((k) => !new RegExp('VirtualPhone\\.' + k + '\\s*=\\s*new\\s+module\\.').test(idx));
  assert.deepEqual(miss, [], '表内有 key 全仓无对应 `window.VirtualPhone.X = new module.Y(...)`：' + miss.join(','));
});

test('A4 rebindLazyApps 定义为函数且逐个安全调用', () => {
  const m = idx.match(/function rebindLazyApps\(\) \{([\s\S]*?)\n    \}/);
  assert.ok(m, 'rebindLazyApps 未定义');
  const body = m[1];
  assert.ok(body.includes('ST_PHONE_REBIND_APP_KEYS'), '未遍历表');
  assert.match(body, /try \{ phone\[key\]\?\.onChatChanged\?\.\(\); \} catch/, '缺少逐 App 容错（单 App 失败不应阻断其余）');
});

test('A5 表中每个 App 自身都实现了 onChatChanged', () => {
  const dirMap = {
    tiebaApp: 'tieba', xhsApp: 'xhs', gachaApp: 'gacha', readingApp: 'reading', tarotApp: 'tarot',
    healthApp: 'health', achievementApp: 'achievement', playbookApp: 'playbook',
    bilibiliApp: 'bilibili', theaterApp: 'theater', placeApp: 'place', cheatApp: 'cheat',
    dtApp: 'dirtytalk', walletApp: 'wallet', profileApp: 'profile', plotlineApp: 'plotline',
    charsApp: 'chars', clockApp: 'clock', ledgerApp: 'ledger', assetApp: 'asset',
    graphApp: 'memory', memoryApp: 'memory',
    timeweaverApp: 'timeweaver'
  };
  // 同一目录下可能有多份 *-app.js（apps/memory/ 下 memory-app.js 与 graph-app.js 并存），
  // 须按 key 精确命中对应文件，否则文件系统顺序可能先命中错的那个而假绿。
  const fileOverride = { graphApp: 'graph-app.js', memoryApp: 'memory-app.js' };
  const missing = [];
  for (const k of KEYS) {
    const dir = dirMap[k];
    assert.ok(dir, `新 App ${k} 未登记 dirMap（本测试需同步扩展）`);
    let f = fileOverride[k];
    if (!f) f = fs.readdirSync(path.join(root, 'apps', dir)).find((n) => n.endsWith('-app.js'));
    assert.ok(f, `${dir} 无 *-app.js`);
    const s = fs.readFileSync(path.join(root, 'apps', dir, f), 'utf8');
    if (!/\n\s*onChatChanged\s*\(/.test(s)) missing.push(k);
  }
  assert.deepEqual(missing, [], '表中 App 未实现 onChatChanged：' + missing.join(','));
});

// ---------- B. 三处路径接线 ----------
test('B1 三处 rebbind 调用点（换会话 / 清当前数据 / 清全部数据）', () => {
  const calls = [...idx.matchAll(/( *)(?:window\.VirtualPhone\.)?rebindLazyApps\(\);/g)];
  assert.equal(calls.length, 3, `实际 ${calls.length}`);
  assert.ok(calls.every((m) => m[1].length % 4 === 0), '缩进均为 4 空格倍数：' + calls.map((m) => m[1].length).join('/'));
});

test('B2 换会话路径：rebindLazyApps 紧邻 wechatApp = null 之前', () => {
  const rb = idx.indexOf('rebindLazyApps();');
  const wx = idx.indexOf('window.VirtualPhone.wechatApp = null;', rb);
  assert.ok(rb > 0, 'rebindLazyApps 未找到');
  assert.ok(wx > rb, 'wechatApp = null 未在 rebind 之后');
  assert.ok(wx - rb < 200, `gap=${wx - rb}，疑似脱离单例缓存清理块`);
});

test('B3 clearCurrentData / clearAllData 路径均接入', () => {
  for (const key of ['clearCurrentData', 'clearAllData']) {
    assert.ok(new RegExp(key + '[\\s\\S]{0,4000}rebindLazyApps\\(\\);').test(idx), `${key} 路径未接入`);
  }
});

test('B4 旧的三份硬编码清单已彻底移除（防回归）', () => {
  const leftovers = [...idx.matchAll(/window\.VirtualPhone\.\w+App\?\.onChatChanged\?\.\(\);/g)].map((m) => m[0]);
  assert.deepEqual(leftovers, [], '仍有硬编码重绑调用：' + leftovers.join(' | '));
});

// ---------- C. 版本同源 ----------
test('C1 version 格式（最新版由最新套件锚定）', () => {
  const v = JSON.parse(read('manifest.json')).version;
  assert.match(String(v), /^\d+\.\d+\.\d+$/);
});

test('C2 四源同源', () => {
  const v = JSON.parse(read('manifest.json')).version;
  assert.equal(JSON.parse(read('package.json')).version, v);
  const m = read('index.js').match(/const ST_PHONE_VERSION = '([^']+)'/);
  assert.ok(m, 'ST_PHONE_VERSION 未找到');
  assert.equal(m[1], v);
  const log = JSON.parse(read('update-log.json'));
  assert.equal(log.latest, v);
  assert.ok(Object.prototype.hasOwnProperty.call(log.versions, v), `update-log 缺 ${v} 条目`);
});

test('C3 items 逐字同源（index.js 与 update-log）', () => {
  const v = JSON.parse(read('manifest.json')).version;
  const log = JSON.parse(read('update-log.json'));
  const from = idx.indexOf('ST_PHONE_CURRENT_UPDATE = {');
  const to = idx.indexOf('防重复加载检查', from);
  assert.ok(from > 0 && to > from, 'ST_PHONE_CURRENT_UPDATE 未找到');
  const body = idx.slice(from, to);
  const items = [...body.split('\n')]
    .map((l) => l.trim())
    .filter((l) => l.startsWith('"') && l.includes('。'))
    .map((l) => l.replace(/,$/, '').replace(/^"/, '').replace(/"$/, ''));
  const logItems = log.versions[v].items;
  assert.ok(items.length > 0, 'index.js items 未解析到');
  assert.deepEqual(logItems.slice(0, items.length), items, 'items 未逐字同源');
});

test('C4 v255 条目记录本轮变更（锚定自身版本，不随升版漂移）', () => {
  const items = JSON.parse(read('update-log.json')).versions['2.55.0'].items.join('\\n');
  assert.match(items, /rebindLazyApps|重绑/);
});

console.log('\\nv255 done');
