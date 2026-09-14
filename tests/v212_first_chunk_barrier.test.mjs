// tests/v212_first_chunk_barrier.test.mjs — [v2.12.0] Luker 首 chunk 屏障缝合测试
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFirstChunkBarrier } from '../apps/phone/first-chunk-barrier.js';

test('同 key 并发：首到为 lead，其余为 follower', () => {
    const b = createFirstChunkBarrier();
    const lead = b.acquire('p');
    const f1 = b.acquire('p');
    const f2 = b.acquire('p');
    assert.equal(lead.role, 'lead');
    assert.equal(f1.role, 'follower');
    assert.equal(f2.role, 'follower');
    assert.equal(b.pendingFollowers('p'), 2);
    assert.equal(b.activeLeadCount(), 1);
});

test('不同 key 各自独立 lead', () => {
    const b = createFirstChunkBarrier();
    const a = b.acquire('A');
    const c = b.acquire('B');
    assert.equal(a.role, 'lead');
    assert.equal(c.role, 'lead');
    assert.equal(b.activeLeadCount(), 2);
});

test('follower 等待 lead 首 chunk 后放行', async () => {
    const b = createFirstChunkBarrier();
    const lead = b.acquire('p');
    const f = b.acquire('p');
    let done = false;
    const p = f.wait.then(() => { done = true; });
    assert.equal(done, false);
    lead.signalFirstChunk();
    await p;
    assert.equal(done, true);
});

test('signalFirstChunk 幂等（多次调用安全）', async () => {
    const b = createFirstChunkBarrier();
    const lead = b.acquire('p');
    const f = b.acquire('p');
    lead.signalFirstChunk();
    lead.signalFirstChunk();
    lead.signalFirstChunk();
    await f.wait; // 不挂起即通过
    assert.ok(true);
});

test('release 清槽，新 acquire 成为新 lead', () => {
    const b = createFirstChunkBarrier();
    const l1 = b.acquire('p');
    l1.release();
    assert.equal(b.activeLeadCount(), 0);
    const l2 = b.acquire('p');
    assert.equal(l2.role, 'lead');
});

test('fail-open：lead 未 signal 直接 release，follower 仍 resolve', async () => {
    const b = createFirstChunkBarrier();
    const lead = b.acquire('p');
    const f = b.acquire('p');
    let done = false;
    const p = f.wait.then(() => { done = true; });
    lead.release(); // 未 signal
    await p;
    assert.equal(done, true);
});

test('follower 的 release 是 no-op（不清 lead 槽位）', () => {
    const b = createFirstChunkBarrier();
    const lead = b.acquire('p');
    const f = b.acquire('p');
    f.release(); // no-op
    assert.equal(b.activeLeadCount(), 1); // lead 槽位仍在
    lead.release();
    assert.equal(b.activeLeadCount(), 0);
});

test('伪 key 完全退出协调（全 lead 无槽位）', () => {
    const b = createFirstChunkBarrier();
    assert.equal(b.acquire('').role, 'lead');
    assert.equal(b.acquire(null).role, 'lead');
    assert.equal(b.acquire(undefined).role, 'lead');
    assert.equal(b.activeLeadCount(), 0);
});

test('迟到的 lead release 不破坏后续批次的新 lead', () => {
    const b = createFirstChunkBarrier();
    const l1 = b.acquire('p');
    l1.release();
    const l2 = b.acquire('p'); // 新批次
    const f = b.acquire('p');  // follower
    l1.release();              // 迟到 release
    assert.equal(b.activeLeadCount(), 1); // l2 槽位未被破坏
    l2.signalFirstChunk();
    return f.wait.then(() => l2.release());
});

test('并发 fan-out 串行 acquire 无竞态（lead 保持槽位期间仅一 lead）', async () => {
    const b = createFirstChunkBarrier();
    // 同 key 并发：acquire 同步串行，首到为 lead，其余为 follower
    const slots = Array.from({ length: 5 }, () => b.acquire('p'));
    const roles = slots.map(s => s.role);
    assert.equal(roles.filter(r => r === 'lead').length, 1);      // 恰好一 lead
    assert.equal(roles.filter(r => r === 'follower').length, 4);  // 其余 follower

    const lead = slots.find(s => s.role === 'lead');
    const followers = slots.filter(s => s.role === 'follower');
    // follower 等待 lead 首 chunk
    lead.signalFirstChunk();
    await Promise.all(followers.map(f => f.wait)); // 全部放行
    lead.release();
    assert.equal(b.activeLeadCount(), 0);
});