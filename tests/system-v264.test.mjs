/**
 * system-v264.test.mjs — v2.64.0 会话级「槽位 × 三路径」覆盖缺口修复回归
 *
 * 背景：v2.63.0 审计的是「生命周期**方法出口**是否被调用」；本轮审计**槽位**——
 *   对每个持有实例的 App 槽位，核对三条会话路径（换会话 / 清当前数据 / 清全部数据）
 *   是否都做了回收或重绑。方法级审计**漏得掉**这类形态：
 *
 *   实测结果（精确判据：三块区间按函数/监听器边界划定）
 *     · 三路覆盖：albumApp / calendarApp / diaryApp / honeyApp / memoryCore / mofoApp /
 *       musicApp / phoneApp / weiboApp / worldpulseApp / gamesApp
 *       —— 后两者不在此处手写，由 P2/P3 咽喉点 retireSessionScopedSlots() 统一收口（白名单项）；
 *     · **仅 P1 覆盖：wangxiangApp** ← 本版修的真缺陷。
 *
 *   `WangxiangApp` 持有一整套会话级实例数组（generatedTasks / managedTasks /
 *   taskProgressHistory / marketplace* / inventoryItems / creditBalance / deliveryAddresses），
 *   但 `clearCache()` 只在换会话路径被显式调用一次；两条清数据路径零处理 ——
 *   清完数据后手机仍持已删任务与订单，直到某次深层操作偶然触发 `_syncTaskDataScope()` 才收敛。
 *
 * 修法遵循本仓既有纪律：**不再往两条路径各补一次手抄调用**，而是给 App 补 `onChatChanged()`
 *   并接入 v2.55 建立的单一真源 ST_PHONE_REBIND_APP_KEYS（三路自动覆盖），
 *   同时把 P1 里原有的显式调用收敛掉（否则换会话会跑两遍 clearCache，且留下第二条真相）。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const idx = read('index.js');
const wx = read('apps/wangxiang/wangxiang-app.js');

/* WangxiangApp 构造期会读 window.VirtualPhone（复用微信数据实例）并注册全局监听器，
   无头环境须给最小宿主 stub；`cachedWechatData` 给一个占位对象可让构造走复用分支、
   跳过 `new WechatData(storage)`（否则会把整条微信数据链拉进单测）。 */
function installHostStub() {
  const listeners = [];
  globalThis.window = globalThis.window || {};
  globalThis.window.addEventListener = (ev) => listeners.push(ev);
  globalThis.window.removeEventListener = () => {};
  globalThis.window.VirtualPhone = { cachedWechatData: { storage: null }, wechatApp: null };
  return listeners;
}

// ══════════════ A. 行为层：wangxiang 实例域 ══════════════
test('v264-A1 万象 clearCache 清空全部会话级实例数组（防「重绑等于没绑」）', async () => {
  const { WangxiangApp } = await import('../apps/wangxiang/wangxiang-app.js');
  // 真实时序：宿主先执行 storage.clearCurrentData()，**之后**才走内存回收。
  //   （clearCache 末尾的 _syncTaskDataScope 会从 storage 重载，故 storage 必须是已清态，
  //    否则重载会把数据读回来 —— 这正是「清数据后内存仍持旧数据」需要修的原因：
  //    内存里那份**没有**被清，只等下一次 scope 变化才收敛。）
  const store = {};
  const storage = {
    get: (k, d = null) => (k in store ? store[k] : d),
    set: (k, v) => { store[k] = v; },
    getStorageKey: () => 'char::chat',
    getContext: () => ({ characterId: 'x', chatId: 'y' })
  };
  installHostStub();
  const app = new WangxiangApp({ setContent() {} }, storage);
  // 污染为「上一段聊天」留下的内存态
  app.generatedTasks = [{ id: 'g1' }];
  app.managedTasks = [{ id: 'm1' }];
  app.taskProgressHistory = [{ id: 'h1' }];
  app.marketplaceCategories = [{ id: 'c1' }];
  app.marketplaceProducts = [{ id: 'p1' }];
  app.marketplaceOrders = [{ id: 'o1' }];
  app.inventoryItems = [{ id: 'i1' }];
  app.creditBalance = 999;
  app.deliveryAddresses = [{ id: 'a1' }];
  app.wangxiangView.currentTaskId = 'g1';
  app.clearCache();
  // marketplaceCategories 有内置默认类目兜底（WANGXIANG_DEFAULT_MARKET_CATEGORIES），
  //   清空后仍返回默认集，故不列入「必须为空」；其余均为纯会话数据，必须清净。
  for (const k of ['generatedTasks', 'managedTasks', 'taskProgressHistory',
    'marketplaceProducts', 'marketplaceOrders', 'inventoryItems', 'deliveryAddresses']) {
    assert.deepEqual(app[k], [], `${k} 未被清空（重绑将等于没绑）`);
  }
  assert.ok(Array.isArray(app.marketplaceCategories), 'marketplaceCategories 应为数组（默认类目兜底）');
  assert.equal(app.creditBalance, 0, 'creditBalance 未归零');
  assert.equal(app.wangxiangView.currentTaskId, '', 'currentTaskId 未清空');
});

test('v264-A2 新增 onChatChanged 承载重绑，且与 clearCache 同语义', async () => {
  const { WangxiangApp } = await import('../apps/wangxiang/wangxiang-app.js');
  const storage = {
    get: (k, d = null) => d, set: () => {},
    getStorageKey: () => 'char::chat', getContext: () => ({ characterId: 'x', chatId: 'y' })
  };
  installHostStub();
  const app = new WangxiangApp({ setContent() {} }, storage);
  assert.equal(typeof app.onChatChanged, 'function', 'WangxiangApp 未实现 onChatChanged（REBIND 表接线会静默 no-op）');
  app.creditBalance = 500;
  app.marketplaceOrders = [{ id: 'o9' }];
  app.onChatChanged();
  assert.equal(app.creditBalance, 0, 'onChatChanged 未清信用余额');
  assert.deepEqual(app.marketplaceOrders, [], 'onChatChanged 未清订单');
});

// ══════════════ B. 接线层：单一真源 ══════════════
test('v264-B1 万象已收编进 REBIND 表（两清数据路径据此自动覆盖）', () => {
  const tbl = (idx.match(/ST_PHONE_REBIND_APP_KEYS = \[([\s\S]*?)\];/) || [])[1] || '';
  assert.ok(/'wangxiangApp'/.test(tbl), 'REBIND 表缺 wangxiangApp');
  // 表内 key 仍须唯一（防手抄重复）
  const keys = [...tbl.matchAll(/'([A-Za-z0-9_]+)'/g)].map((m) => m[1]);
  assert.equal(new Set(keys).size, keys.length, 'REBIND 表出现重复 key');
});

test('v264-B2 防回归：P1 不再保留第二条真相（显式 clearCache 已收敛）', () => {
  const explicit = idx.match(/window\.VirtualPhone\.wangxiangApp\.clearCache\(\)/g) || [];
  assert.equal(explicit.length, 0,
    '换会话路径仍有显式 wangxiangApp.clearCache()（与 REBIND 表形成两条真相，换会话会跑两遍）');
  // 但 wangxiangApp 槽位本身仍须在换会话路径被提到（收敛说明注释须在，防被后人误删理解）
  assert.match(idx, /rebindLazyApps\(\)[\s\S]{0,3000}?wangxiang/i, '收敛说明缺失');
});

test('v264-B3 槽位×三路径覆盖矩阵：仅白名单内允许「不由本处三路径显式处理」', () => {
  const lines = idx.split('\n');
  const find = (re, from = 0) => { for (let i = from; i < lines.length; i++) if (re.test(lines[i])) return i; return -1; };
  const p1s = find(/^    function onChatChanged\(\) \{/);
  const p1e = find(/^    function getContext\(\) \{/);
  const p2s = find(/addEventListener\('phone:clearCurrentData'/);
  const p3s = find(/addEventListener\('phone:clearAllData'/);
  assert.ok(p1s > 0 && p1e > p1s && p2s > p1e && p3s > p2s, '三块区间锚点异常');
  // 清数据两路的咽喉回收（白名单依据：由 reloadPhoneSurface → retireSessionScopedSlots 收口）
  assert.match(idx, /function retireSessionScopedSlots\(\)/, '咽喉回收函数缺失');
  const withExits = [...idx.matchAll(/VirtualPhone\.(\w+App)\s*=\s*new\b/g)].map((m) => m[1]);
  const uniq = [...new Set(withExits)];
  const EXIT = /\.(clearCache|destroy|deactivate|onChatChanged|reload|clearCurrentChat)\??\.?\(/;
  const regionHas = (a, b, name) => {
    for (let i = a; i <= b && i < lines.length; i++) {
      if (new RegExp('\\b' + name + '\\b').test(lines[i]) && EXIT.test(lines[i])) return true;
    }
    return false;
  };
  // 白名单：由咽喉点（P2/P3 都调用 reloadPhoneSurface）统一回收的会话级槽位
  const VIA_RETIRE = new Set(['gamesApp', 'worldpulseApp']);
  const missing = [];
  for (const n of uniq) {
    const inP1 = regionHas(p1s, p1e, n);
    const inP2 = regionHas(p2s, p3s, n);
    const inP3 = regionHas(p3s, p3s + 145, n);
    // 只在 P1 出现、且不在咽喉白名单 → 正是本轮修掉的形态
    if (inP1 && !inP2 && !inP3 && !VIA_RETIRE.has(n)) missing.push(n);
  }
  assert.deepEqual(missing, [], '仍存在「只在换会话路径被回收」的槽位：' + missing.join(', '));
});

console.log('\nv264 done');