/* ============================================================
 * [v2.8.13] set/remove 第三参数 immediate 行为回归测试
 * ------------------------------------------------------------
 * 背景：该参数历史上被 set(key, value) 签名静默丢弃，全仓库 18 处
 * 调用点的「立即持久化」意图从未生效。本测试锁定实现后的真实行为，
 * 并确保把落盘体抽成 _runSaveChat 时未破坏防抖/合并/跨会话守卫语义。
 *
 * ── mock 设计要点（均为实测踩坑后确定，勿随意改动）──────────────
 * 1. 会话落盘分支顺序：window.saveChatDebounced → context.saveChatDebounced
 *    → context.saveChat。mock **不得**提供 saveChatDebounced，否则
 *    计数点 context.saveChat 永不触发，断言全部失效。
 * 2. 全局落盘分支顺序：context.saveSettingsDebounced → saveSettingsDebounced
 *    → saveSettings → _manualSaveSettings。
 *    原代码里缺省分支的 saveSettings **不带 await**，用它做观测点无法
 *    区分「立即」与「排队后稍后」（实测第一轮变异 V2 因此存活）。
 *    → 本 mock 按真实 ST 行为提供 context.saveSettingsDebounced 作为
 *      缺省路径落点，并让全局 saveSettings 只被 immediate 路径调用，
 *      两个观测点互斥，从而可判定「是否真的绕过了队列/防抖」。
 * ============================================================ */
import assert from 'node:assert/strict';

const results = [];
const failures = [];
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const ok = async (name, fn) => {
  try { await fn(); results.push(`✓ ${name}`); }
  catch (e) {
    results.push(`✗ ${name} :: ${(e.message || String(e)).split('\n')[0]}`);
    failures.push(name);
  }
};

const { PhoneStorage } = await import('../config/storage.js');
const NS = 'st_virtual_phone';

function makeHost() {
  const host = {
    saveChatCalls: 0,
    saveSettingsDebouncedCalls: 0,   // 缺省全局路径落点
    saveSettingsCalls: 0,            // immediate 全局路径落点
    chatMetadata: { [NS]: {} },
    extensionSettings: { [NS]: {} },
  };
  host.context = {
    chatId: '1',
    chatMetadata: host.chatMetadata,
    extensionSettings: host.extensionSettings,
    characters: [],
    name2: 'Ruby',
    saveChat: async () => { host.saveChatCalls++; },
    // 不提供 saveChatDebounced（要点 1）；提供 saveSettingsDebounced（要点 2）
    saveSettingsDebounced: () => { host.saveSettingsDebouncedCalls++; },
  };
  global.window = { SillyTavern: { getContext: () => host.context } };
  global.SillyTavern = { getContext: () => host.context };
  global.saveSettings = async () => { host.saveSettingsCalls++; };
  return host;
}

function makeStorage(host, delay = 40) {
  const s = new PhoneStorage();
  s._saveChatDelay = delay;
  s.getContext = () => host.context;
  s._getChatMetadataStore = () => host.chatMetadata[NS];
  s._getExtensionSettingsStore = () => host.extensionSettings[NS];
  return s;
}

// ========== 1. immediate 会话写：await 返回时必须已落盘 ==========
{
  const host = makeHost(); const s = makeStorage(host);
  await ok('immediate 会话写：saveChat 已完成且无残留定时器', async () => {
    await s.set('memory_core_v1', JSON.stringify({ longTerm: [] }), true);
    assert.ok(host.saveChatCalls >= 1, `saveChatCalls=${host.saveChatCalls}`);
    assert.equal(s._saveChatTimer, null, '不应残留待触发定时器');
  });
}

// ========== 2. 缺省第三参数仍走防抖（向后兼容） ==========
{
  const host = makeHost(); const s = makeStorage(host);
  await ok('缺省会话写：await 返回时尚未落盘', async () => {
    await s.set('memory_core_v1', 'v1');
    assert.equal(host.saveChatCalls, 0, `saveChatCalls=${host.saveChatCalls}`);
    assert.ok(s._saveChatTimer, '应已排入防抖定时器');
  });
  await sleep(120);
  await ok('防抖到期后落盘确实发生', () => {
    assert.ok(host.saveChatCalls >= 1, `saveChatCalls=${host.saveChatCalls}`);
  });
}

// ========== 3. 防抖合并语义未被抽函数破坏 ==========
{
  const host = makeHost(); const s = makeStorage(host);
  await s.set('memory_core_v1', 'a');
  await s.set('memory_core_v1', 'b');
  await s.set('memory_core_v1', 'c');
  await sleep(120);
  await ok('连续 3 次防抖写仅触发 1 次落盘', () => {
    assert.equal(host.saveChatCalls, 1, `saveChatCalls=${host.saveChatCalls}`);
  });
  await ok('内存值为最后一次写入', () => {
    assert.equal(host.chatMetadata[NS].memory_core_v1, 'c');
  });
}

// ========== 4. immediate 取消先前防抖（不排两次队） ==========
{
  const host = makeHost(); const s = makeStorage(host);
  await s.set('memory_core_v1', 'x');
  await s.set('memory_core_v1', 'y', true);
  await sleep(150);
  await ok('immediate 取消了待触发防抖（总落盘=1 而非 2）', () => {
    assert.equal(host.saveChatCalls, 1, `saveChatCalls=${host.saveChatCalls}`);
  });
}

// ========== 5. 全局键 immediate：必须绕过防抖队列 ==========
{
  const host = makeHost(); const s = makeStorage(host);
  await ok('缺省全局写走 saveSettingsDebounced（防抖）', async () => {
    await s.set('phone-prompts', 'queued');
    assert.equal(host.saveSettingsDebouncedCalls, 1, `debounced=${host.saveSettingsDebouncedCalls}`);
    assert.equal(host.saveSettingsCalls, 0, `非防抖 saveSettings 不应被调用=${host.saveSettingsCalls}`);
  });
  await ok('immediate 全局写绕过防抖、走非防抖 saveSettings', async () => {
    await s.set('phone-prompts', 'now', true);
    assert.ok(host.saveSettingsCalls >= 1,
      `immediate 未绕过队列：saveSettingsCalls=${host.saveSettingsCalls}`);
    assert.equal(host.saveSettingsDebouncedCalls, 1, 'immediate 不应再排防抖队列');
  });
  await ok('immediate 全局写的值落在 extensionSettings', () => {
    assert.equal(host.extensionSettings[NS]['phone-prompts'], 'now');
  });
  await ok('immediate 全局写不触发聊天落盘', () => {
    assert.equal(host.saveChatCalls, 0, `saveChatCalls=${host.saveChatCalls}`);
  });
}

// ========== 6. 关键不变量：第三参数不得改变存储落点 ==========
{
  const host = makeHost(); const s = makeStorage(host);
  await s.set('games_poker_ai_prompt', 'p', true);
  await s.set('memory_core_v1', 'c', true);
  await ok('全局键未被 immediate 搬进会话', () => {
    assert.ok('games_poker_ai_prompt' in host.extensionSettings[NS]);
    assert.ok(!('games_poker_ai_prompt' in host.chatMetadata[NS]));
  });
  await ok('会话键未被 immediate 搬进全局', () => {
    assert.ok('memory_core_v1' in host.chatMetadata[NS]);
    assert.ok(!('memory_core_v1' in host.extensionSettings[NS]));
  });
}

// ========== 7. remove(key, true) 与 set 对齐 ==========
{
  const host = makeHost(); const s = makeStorage(host);
  await s.set('memory_core_v1', 'z', true);
  const before = host.saveChatCalls;
  await ok('remove(key, true) 立即落盘', async () => {
    await s.remove('memory_core_v1', true);
    assert.ok(host.saveChatCalls > before, `before=${before} after=${host.saveChatCalls}`);
  });
  await ok('remove 后已从 chatMetadata 删除', () => {
    assert.ok(!('memory_core_v1' in host.chatMetadata[NS]));
  });
  // 独立 host：验证 remove 缺省仍走防抖（避免受上面 immediate 写干扰基线）
  {
    const h2 = makeHost(); const s2 = makeStorage(h2);
    await s2.set('memory_core_v1', 'w', true);        // 先落盘，建立计数基线
    const b0 = h2.saveChatCalls;
    await ok('remove(key) 缺省走防抖：已排队且尚未落盘', async () => {
      await s2.remove('memory_core_v1');
      assert.ok(s2._saveChatTimer, '应已排入防抖定时器');
      assert.equal(h2.saveChatCalls, b0, `不应立即落盘：${b0} -> ${h2.saveChatCalls}`);
    });
    await sleep(150);
    await ok('remove 防抖到期后落盘并已从 chatMetadata 删除', () => {
      assert.ok(h2.saveChatCalls > b0, `saveChatCalls=${h2.saveChatCalls}`);
      assert.ok(!('memory_core_v1' in h2.chatMetadata[NS]));
    });
  }
}

// ========== 8. 跨会话守卫（内层）：排队后切会话不得串写 ==========
// 注意：_runSaveChat 有内外两道守卫，单独去掉任一道仍被另一道拦截
// （等价变异），因此本用例只验证「两道都在」时的行为。
{
  const host = makeHost(); const s = makeStorage(host);
  await s.set('memory_core_v1', 'keep', true);   // 第 1 次落盘
  await s.set('memory_core_v1', 'pending');      // 排入防抖
  assert.ok(s._saveChatTimer, '前置条件：防抖已排队');
  s.currentConversationId = '__switched__';
  await sleep(150);
  await ok('会话切换后旧队列被丢弃（防跨会话串写）', () => {
    assert.equal(host.saveChatCalls, 1, `saveChatCalls=${host.saveChatCalls}`);
  });
}

// ========== 9. 显式 false 等价缺省 ==========
{
  const host = makeHost(); const s = makeStorage(host);
  await ok('显式 false 走防抖，不立即落盘', async () => {
    await s.set('wechat_data', 'v', false);
    assert.equal(host.saveChatCalls, 0, `saveChatCalls=${host.saveChatCalls}`);
    assert.ok(s._saveChatTimer, '应已排入防抖');
  });
  await sleep(150);
}

// ========== 10. 熔断对两条路径都生效 ==========
{
  const host = makeHost(); const s = makeStorage(host);
  const big = () => 'data:image/png;base64,' + 'A'.repeat(PhoneStorage.BASE64_IMAGE_CEILING + 10);
  await ok('immediate 路径经过防膨胀熔断', async () => {
    await s.set('diary_entries', big(), true);
    assert.equal(host.chatMetadata[NS].diary_entries, '[BLOCKED_LARGE_BASE64_IMAGE]');
  });
  await ok('防抖路径经过熔断', async () => {
    await s.set('diary_entries', big());
    assert.equal(host.chatMetadata[NS].diary_entries, '[BLOCKED_LARGE_BASE64_IMAGE]');
  });
}

// ========== 11. immediate 仍不得绕过队列锁的原子性（并发安全） ==========
{
  const host = makeHost(); const s = makeStorage(host);
  await ok('并发 immediate 会话写不抛异常且都完成落盘', async () => {
    await Promise.all([
      s.set('memory_core_v1', 'p1', true),
      s.set('memory_core_v1', 'p2', true),
      s.set('memory_core_v1', 'p3', true),
    ]);
    assert.ok(host.saveChatCalls >= 3, `saveChatCalls=${host.saveChatCalls}`);
  });
}

results.forEach(r => console.log(r));
if (failures.length) {
  console.error(`\n[storage-immediate] ${failures.length}/${results.length} 项失败：${failures.join(' | ')}`);
  process.exit(1);
}
console.log(`\n[storage-immediate] ${results.length} 项断言全部通过`);