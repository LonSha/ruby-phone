/**
 * tests/r26_o6c_test_key_skip.test.mjs — R26-O6c 迁移面排除测试夹具键
 *
 * 【咬点】缝自雪穗机：迁移扫描永远会把测试夹具当成待迁档，
 * 因为有测试数据与用户数据同形不同名（靠 __t 标记区分），
 * 而本仓迁移面之前完全不认这个标记 ⇒ 跑一次测试就往真档里塞一堆假聊天。
 *
 * 验收口径：
 *   A1 chatKey 带 __t ⇒ skip / test-key，且不给 steps 与 archiveKeys（不是“迁了一半”）
 *   A2 四个证据字段里任意一个带 __t 都能拦住（卡键 / 旧键方向也算）
 *   A3 干净键不被误伤：该 allow 的仍然 allow / edge-ok
 *   A4 这条排在证据门之前：测试键+证据缺 ⇒ 仍然 skip/test-key（不问证据齐不齐）
 *
 * 负控制：N1 去掉该分支 ⇒ 测试键被 allow（键就迁走了）
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { planMigration } from '../config/migration-matrix.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(root, 'config', 'migration-matrix.js');
const face = () => ({ state: 'legacy', version: 1, current: 2 });
const good = () => ({
    chatKey: 'chat-a', cardKey: 'character:card-1',
    savedChatKey: 'chat-a', savedCardKey: 'character-file:card-1'
});
let seq = 0;
const tmpFiles = [];
async function loadBroken(mutate) {
    const src = fs.readFileSync(SRC, 'utf8');
    const out = mutate(src);
    assert.notEqual(out, src, '负控制没改到源码：mutator 失配（判据会假绿）');
    seq += 1;
    const tmp = path.join(root, 'config', '.tmp_r26o6c_broken_' + seq + '.mjs');
    fs.writeFileSync(tmp, out, 'utf8');
    tmpFiles.push(tmp);
    return await import(pathToFileURL(tmp).href);
}
test.after(() => { for (const f of tmpFiles) { try { fs.unlinkSync(f); } catch (e) { /* 已删 */ } } });

test('O6c-A1 测试键 chatKey 带 __t ⇒ skip/test-key，且不给半成品步骤', () => {
    const ev = good();
    ev.chatKey = 'chat-a__t1';
    ev.savedChatKey = 'chat-a__t1';
    const p = planMigration({ face: face(), evidence: ev });
    assert.equal(p.verdict, 'skip');
    assert.equal(p.reason, 'test-key');
    assert.deepEqual(p.steps, [], '拒绝迁移却给了步骤（迁了一半）');
    assert.deepEqual(p.archiveKeys, [], '拒绝迁移却给了归档键');
    assert.deepEqual(p.needs, [], '它不需要补证据，它是根本不归迁移面');
});

test('O6c-A2 四个证据字段任意一个带 __t 都能拦住', () => {
    for (const f of ['chatKey', 'savedChatKey', 'cardKey', 'savedCardKey']) {
        const ev = good();
        ev[f] = ev[f] + '__t';
        const p = planMigration({ face: face(), evidence: ev });
        assert.equal(p.verdict, 'skip', '字段 ' + f + ' 带测试标记却未被拦');
        assert.equal(p.reason, 'test-key');
    }
});

test('O6c-A3 干净键不被误伤', () => {
    const p = planMigration({ face: face(), evidence: good() });
    assert.equal(p.verdict, 'allow');
    assert.equal(p.reason, 'edge-ok');
    assert.ok(p.archiveKeys.length === 2, '干净键的归档键变少了');
    assert.ok(p.steps.length > 0);
    /* 不迁移四种情形不受影响 */
    assert.equal(planMigration({ face: { state: 'current', version: 2, current: 2 }, evidence: good() }).reason, 'current');
    assert.equal(planMigration({ face: { state: 'future', version: 9, current: 2 }, evidence: good() }).reason, 'future-schema');
});

test('O6c-A4 测试键优先于证据门：证据缺也直接 skip', () => {
    const p = planMigration({ face: face(), evidence: { chatKey: 'chat__t9' } });
    assert.equal(p.verdict, 'skip', '测试键应先于证据门被拦住');
    assert.equal(p.reason, 'test-key');
});

test('O6c-N1 负控制：去掉测试键分支 ⇒ 键被 allow 迁走', async () => {
    const m = await loadBroken((s) => s.replace('if (isTestKey(ev.chatKey) || isTestKey(ev.savedChatKey) || isTestKey(ev.cardKey) || isTestKey(ev.savedCardKey)) {', 'if (false) {'));
    const ev = good();
    ev.chatKey = 'chat-a__t1';
    ev.savedChatKey = 'chat-a__t1';
    const p = m.planMigration({ face: face(), evidence: ev });
    assert.equal(p.verdict, 'allow', '打坏后测试键本该被迁走（若仍 skip 说明负控制没生效）');
    assert.equal(p.reason, 'edge-ok');
});
