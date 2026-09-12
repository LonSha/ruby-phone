// RubyPhone 记忆跨会话隔离与协调注入测试
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`✓ ${name}`); }
  else { fail++; console.log(`✗ ${name} ${detail}`); }
};

// 1. 静态检查
const memDataSrc = fs.readFileSync(path.join(root, 'apps/memory/memory-data.js'), 'utf8');
const bridgeSrc = fs.readFileSync(path.join(root, 'apps/memory/lonsha-bridge.js'), 'utf8');
const idxSrc = fs.readFileSync(path.join(root, 'index.js'), 'utf8');

ok('MemoryCore 含有 reload 方法', memDataSrc.includes('reload() {'));
ok('onChatChanged 包含 memoryCore.reload 调用', idxSrc.includes('window.VirtualPhone.memoryCore.reload?.()'));
ok('onChatChanged 包含 lonshaBridge.onChatChanged 调用', idxSrc.includes('window.VirtualPhone.lonshaBridge.onChatChanged?.()'));
ok('clearCurrentData 包含 memoryCore.clearCurrentChat 调用', idxSrc.includes('window.VirtualPhone?.memoryCore?.clearCurrentChat?.()'));
ok('applyCoordinatedInjection 在无 directive 时清空槽位', bridgeSrc.includes("ctx.setExtensionPrompt('rubyphone_memory_coord', '', 1, 0)"));

// 2. 运行时行为模拟：MemoryCore.reload
class MockStorage {
  constructor(initData = null) {
    this.data = initData ? { memory_core_v1: JSON.stringify(initData) } : {};
  }
  get(k) { return this.data[k] || null; }
  set(k, v) { this.data[k] = v; }
  remove(k) { delete this.data[k]; }
}

// 动态导入 MemoryCore 测试真实类
const { MemoryCore } = await import('../apps/memory/memory-data.js');
const storage = new MockStorage({ longTerm: [{ id: 'm1', content: '聊天A的记忆' }], shortTerm: [] });
const core = new MemoryCore(storage);

ok('初始加载成功', core.longTerm.length === 1 && core.longTerm[0].content === '聊天A的记忆');

// 模拟切换聊天：底层 storage 换成聊天 B 的空数据
storage.data = { memory_core_v1: JSON.stringify({ longTerm: [{ id: 'm2', content: '聊天B的记忆' }], shortTerm: [] }) };
core.reload();
ok('reload 后隔离成功，加载聊天B记忆', core.longTerm.length === 1 && core.longTerm[0].content === '聊天B的记忆');

// 模拟切换到无记忆聊天
storage.data = {};
core.reload();
ok('reload 空聊天后内存清空', core.longTerm.length === 0);

console.log(`
[memory-isolation] ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
