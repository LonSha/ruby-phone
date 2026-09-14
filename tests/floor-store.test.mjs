// floor-store.js 单元测试（影子层降级路径，无 TH 环境）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FloorStore, floorStore } from '../config/floor-store.js';

test('floor-store: 影子层 append/readAll 按时间排序', async () => {
    const fs = new FloorStore();
    assert.equal(fs.isLive, false, '无 TH 环境应降级影子层');
    await fs.append('wechat_log', { role: 'send', name: '我', content: '在吗', timestamp: 1000, target: '张三' });
    await fs.append('wechat_log', { role: 'recv', name: '张三', content: '在', timestamp: 500, target: '张三' });
    const all = fs.readAll('wechat_log');
    assert.equal(all.length, 2);
    assert.ok(all[0].timestamp <= all[1].timestamp, '应按时间升序');
    assert.equal(all[0].content, '在');
});

test('floor-store: readByTarget 过滤', async () => {
    const fs = new FloorStore();
    await fs.append('wechat_log', { role: 'recv', name: '张三', content: 'a', timestamp: 1, target: '张三' });
    await fs.append('wechat_log', { role: 'recv', name: '李四', content: 'b', timestamp: 2, target: '李四' });
    assert.equal(fs.readByTarget('wechat_log', '张三').length, 1);
    assert.equal(fs.readByTarget('wechat_log', '李四').length, 1);
    assert.equal(fs.readByTarget('wechat_log', '王五').length, 0);
});

test('floor-store: appendBatch 两阶段批量 + id 自动生成', async () => {
    const fs = new FloorStore();
    const res = await fs.appendBatch('pyq_log', [
        { role: 'recv', name: 'A', content: 'x', timestamp: 1 },
        { role: 'recv', name: 'B', content: 'y', timestamp: 2 }
    ], { target: '朋友圈' });
    assert.equal(res.length, 2);
    assert.ok(res[0].id && res[1].id, '应自动生成 id');
    assert.notEqual(res[0].id, res[1].id);
    const all = fs.readAll('pyq_log');
    assert.equal(all.length, 2);
    assert.ok(all.every(r => r.target === '朋友圈'), 'opts.target 应统一打上');
});

test('floor-store: removeById 撤回', async () => {
    const fs = new FloorStore();
    const r = await fs.append('wechat_log', { role: 'send', name: '我', content: '撤回我', timestamp: 1, target: '张三' });
    assert.equal(fs.readAll('wechat_log').length, 1);
    const ok = await fs.removeById('wechat_log', r.id);
    assert.equal(ok, true);
    assert.equal(fs.readAll('wechat_log').length, 0);
    const again = await fs.removeById('wechat_log', r.id);
    assert.equal(again, false, '已删除的 id 再删应返回 false');
});

test('floor-store: removeByFloor 楼层级回收', async () => {
    const fs = new FloorStore();
    await fs.append('wechat_log', { role: 'recv', name: 'A', content: 'm1', timestamp: 1 });
    await fs.append('wechat_log', { role: 'recv', name: 'B', content: 'm2', timestamp: 2 });
    // 影子层全部落在虚拟楼层 -1
    const n = await fs.removeByFloor('wechat_log', -1);
    assert.equal(n, 2);
    assert.equal(fs.readAll('wechat_log').length, 0);
});

test('floor-store: mergeWithExternal 双源合并打标', async () => {
    const fs = new FloorStore();
    await fs.append('wechat_log', { role: 'send', name: '我', content: '手动发', timestamp: 100, target: '张三' });
    const ext = [
        { role: 'recv', name: '张三', content: '正文提取', timestamp: 50, target: '张三' }
    ];
    const merged = fs.mergeWithExternal('wechat_log', ext);
    assert.equal(merged.length, 2);
    assert.equal(merged[0].type, 'external', '时间早的外部记录排前');
    assert.equal(merged[1].type, 'floor');
    assert.ok(merged[1]._stId !== undefined || merged[1].id, 'floor 记录应有来源标记');
});

test('floor-store: 单例可读且不串实例', async () => {
    const a = new FloorStore();
    const b = new FloorStore();
    await a.append('ns1', { role: 'recv', name: 'X', content: 'c', timestamp: 1 });
    assert.equal(a.readAll('ns1').length, 1);
    assert.equal(b.readAll('ns1').length, 0, '不同实例影子层隔离');
    assert.ok(floorStore, '默认单例应导出');
});