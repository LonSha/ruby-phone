// tests/lonsha-bridge-contract.test.mjs
// RubyPhone v2.14.0 —— LonSha 记忆桥契约测试（双向审计）
// 覆盖：桥方法行为契约（onFloorRollback/recall/applyCoordinatedInjection/onChatChanged）
//       + 微信 buildMessagesArray 的 lonsha 记忆注入接线 + 双端 onFloorRollback 调用对称
import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bridgeSrc = fs.readFileSync(path.join(root, 'apps/memory/lonsha-bridge.js'), 'utf-8');
const wechatSrc = fs.readFileSync(path.join(root, 'apps/wechat/chat-view.js'), 'utf-8');
const idxSrc = fs.readFileSync(path.join(root, 'index.js'), 'utf-8');

function ok(cond, msg) { assert.ok(cond, msg); }

test('=== 1. 桥方法行为契约（onFloorRollback / recall / applyCoordinatedInjection） ===', async () => {
    const mod = await import('../apps/memory/lonsha-bridge.js');
    ok(mod.LonShaBridge, 'LonShaBridge 类可导入');
    ok(typeof mod.mountLonShaBridge === 'function', 'mountLonShaBridge 可导入');
    ok(typeof mod.LonShaBridge.prototype.onFloorRollback === 'function', 'onFloorRollback 是原型方法');
    ok(typeof mod.LonShaBridge.prototype.recall === 'function', 'recall 是原型方法');
    ok(typeof mod.LonShaBridge.prototype.applyCoordinatedInjection === 'function', 'applyCoordinatedInjection 是原型方法');
    ok(typeof mod.LonShaBridge.prototype.onChatChanged === 'function', 'onChatChanged 是原型方法');
    // recall 在桥禁用时应安全返回空数组（不抛异常）
    const bridge = new mod.LonShaBridge();
    bridge.enabled = false;
    bridge.memoryCore = null;
    const res = bridge.recall('测试查询', 3);
    assert.deepStrictEqual(res, [], '桥禁用时 recall 返回 []');
});

test('=== 2. 微信 buildMessagesArray 的 lonsha 记忆注入接线 ===', () => {
    // 注入代码块存在且调 lonshaBridge.recall
    ok(wechatSrc.includes('window.VirtualPhone?.lonshaBridge'), '微信引用 lonshaBridge');
    ok(wechatSrc.includes('_lb.recall('), '微信调 lonshaBridge.recall');
    ok(wechatSrc.includes('【角色记忆 · 来自剧情】'), '注入角色记忆 system 块');
    // 注入点落在 buildMessagesArray 内（charName 定义之后、callAI 之前）
    const bmIdx = wechatSrc.indexOf('async buildMessagesArray(');
    const injectIdx = wechatSrc.indexOf('【角色记忆 · 来自剧情】');
    ok(bmIdx > 0 && injectIdx > bmIdx, '注入在 buildMessagesArray 内');
    // 静默失败不阻断发送
    ok(wechatSrc.includes('lonsha 记忆注入静默失败'), '注入静默失败兜底');
});

test('=== 3. 双端 onFloorRollback 契约对称（ruby 定义 / lonsha 调用） ===', () => {
    // ruby 端定义
    ok(bridgeSrc.includes('onFloorRollback(floor)'), 'ruby 端定义 onFloorRollback(floor)');
    // lonsha 端调用（index.js 删楼路径）
    ok(idxSrc.includes('lonshaBridge?.onFloorRollback(deletedFloor)'), 'index.js 删楼调 lonshaBridge.onFloorRollback(deletedFloor)');
    // 契约对称：方法签名 floor 参数一致
    ok(bridgeSrc.includes('onFloorRollback(floor)'), '签名 onFloorRollback(floor)');
});

test('=== 4. recall 返回结构契约 ===', () => {
    // recall 返回 [{content, score, layer, floor}] —— 微信注入依赖 content 字段
    ok(bridgeSrc.includes('content: r.text') || bridgeSrc.includes('content: r.content'), 'recall 返回含 content 字段');
    ok(bridgeSrc.includes('score:'), 'recall 返回含 score 字段');
    ok(bridgeSrc.includes('layer:'), 'recall 返回含 layer 字段');
});