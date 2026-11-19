/**
 * tests/r26_x5_random_source.test.mjs — R26-X5 可强制随机源判据
 *
 * 【咬点】全仓 81 处 Math.random 零可强制口；任何「偶尔才出现」的现象都只能靠反复刷。
 * 缝自 myworld 的 `G.forceGlitch || Math.random()*100 < S.glitch`。
 *
 * 验收口径：
 *   A1 默认就是原生：activeMode()=native、isForced()=false、rand() 在 [0,1)
 *   A2 强制可撤销：setSource 后读数变 forced；undo 回原生；重复 undo 返回 false
 *   A3 序列耗尽必须报错（绝不静默回落原生——那会让“复现”变成假的）
 *   A4 参数不对就炸：chance 越界 / randInt min>max / pick 空数组；边界 0 与 100 不许走随机
 *   A5 同种子同序列（能复现）；种子源模式可辨识
 *   A6 接线：index 真消费 + sharing-boundary 真改了随机口（不是只加了个模块）
 *
 * 负控制：
 *   N1 序列耗尽改成回落 Math.random ⇒ A3 转红
 *   N2 undo 失效 ⇒ A2 转红
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
    RANDOM_MODE, isForced, activeMode, setSource, resetSource, rand, randInt,
    chance, pick, forcedSequence, useSequence, seededSequence, useSeed, randomSourceText, randomSourceSelfCheck
} from '../config/random-source.js';
import { buildShareDraft } from '../config/sharing-boundary.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(root, 'config', 'random-source.js');
const INDEX = path.join(root, 'index.js');
const SHARING = path.join(root, 'config', 'sharing-boundary.js');
let seq = 0;
const tmpFiles = [];
async function loadBroken(mutate) {
    const src = fs.readFileSync(SRC, 'utf8');
    const out = mutate(src);
    assert.notEqual(out, src, '负控制没改到源码：mutator 失配（判据会假绿）');
    seq += 1;
    const tmp = path.join(root, 'config', '.tmp_x5_broken_' + seq + '.mjs');
    fs.writeFileSync(tmp, out, 'utf8');
    tmpFiles.push(tmp);
    return await import(pathToFileURL(tmp).href);
}
test.after(() => { for (const f of tmpFiles) { try { fs.unlinkSync(f); } catch (e) { /* 已删 */ } } resetSource(); });

test('A1 默认就是原生 Math.random', () => {
    resetSource();
    assert.equal(activeMode(), RANDOM_MODE.NATIVE);
    assert.equal(isForced(), false);
    for (let i = 0; i < 16; i += 1) {
        const v = rand();
        assert.ok(v >= 0 && v < 1, '原生源越界：' + v);
    }
    assert.ok(randomSourceText().includes('原生'));
});

test('A2 强制可撤销，撤销后回原样', () => {
    resetSource();
    const undo = setSource(() => 0.25);
    assert.equal(isForced(), true);
    assert.equal(activeMode(), RANDOM_MODE.FORCED);
    assert.equal(rand(), 0.25);
    assert.ok(randomSourceText().includes('已被强制'), '读数必须看得出被强制');
    assert.equal(undo(), true);
    assert.equal(isForced(), false, 'undo 后必须回原生');
    assert.equal(undo(), false, '重复 undo 必须报 false');
});

test('A3 序列耗尽必须报错，绝不回落原生', () => {
    resetSource();
    const s = useSequence([0.1, 0.2]);
    assert.equal(rand(), 0.1);
    assert.equal(rand(), 0.2);
    assert.equal(s.remaining(), 0);
    assert.throws(() => rand(), /耗尽/, '序列耗尽必须抛错（静默回落=假复现）');
    s.undo();
    assert.equal(isForced(), false);
    assert.throws(() => forcedSequence([]), TypeError);
    assert.throws(() => forcedSequence(['a']), TypeError);
});

test('A4 参数不对就炸，边界不走随机', () => {
    resetSource();
    const undo = setSource(() => 0.5);
    assert.equal(chance(0), false);
    assert.equal(chance(100), true);
    assert.equal(chance(1), false);
    assert.equal(chance(99), true);
    assert.throws(() => chance(101), RangeError);
    assert.throws(() => chance(-1), RangeError);
    assert.throws(() => chance('x'), TypeError);
    assert.throws(() => randInt(3, 1), RangeError);
    assert.throws(() => randInt(1.5, 3), TypeError);
    assert.equal(randInt(1, 1), 1);
    assert.throws(() => pick([]), TypeError);
    assert.equal(pick(['only']), 'only');
    undo();
    assert.equal(isForced(), false);
    /* 自检必须从原生态开始跑（它自己会验这一点） */
    assert.equal(randomSourceSelfCheck().ok, true, JSON.stringify(randomSourceSelfCheck().bad));
});

test('A5 同种子同序列，模式可辨识', () => {
    resetSource();
    const a = seededSequence(42);
    const b = seededSequence(42);
    assert.deepEqual([a(), a(), a(), a()], [b(), b(), b(), b()]);
    const c = seededSequence(7);
    assert.notEqual(seededSequence(42)(), c(), '不同种子不该同序列');
    const undo = useSeed(42);
    assert.equal(activeMode(), RANDOM_MODE.SEEDED);
    assert.equal(rand(), seededSequence(42)(), '挂上种子源后应走该序列');
    undo();
    assert.equal(isForced(), false);
});

test('A6 接线：index 真消费 + 分享 id 走随机口', () => {
    const idx = fs.readFileSync(INDEX, 'utf8');
    assert.ok(idx.includes("from './config/random-source.js'"), 'index.js 必须 import');
    assert.ok(idx.includes('window.VirtualPhone.randomSource = {'), '必须挂载');
    assert.ok(idx.includes("['_r26X5', randomSourceSelfCheck]"), '自检必须登记');
    assert.ok(idx.includes('useSequence: useSequence'), '挂载面必须真消费 useSequence');

    const sh = fs.readFileSync(SHARING, 'utf8');
    assert.ok(sh.includes("from './random-source.js'"), 'sharing-boundary 必须走随机口');
    assert.equal(sh.includes('Math.random()'), false, '分享面不许再直连 Math.random');

    resetSource();
    const s = useSequence([0.5]);
    const d = buildShareDraft({ snippet: 'hi' }, 1700000000000);
    assert.equal(d.id, 'share_1700000000000_i', '分享 id 必须真用上强制源');
    s.undo();
});

test('N1 负控制：序列耗尽回落原生 ⇒ A3 转红', async () => {
    const m = await loadBroken((s) => s.replace(
        "if (i >= seq.length) throw new Error('random-source: 强制序列已耗尽（remaining=0），拒绝回落原生');",
        'if (i >= seq.length) return Math.random();'));
    const s = m.useSequence([0.1]);
    assert.equal(m.rand(), 0.1);
    const v = m.rand();
    assert.ok(v >= 0 && v < 1, '打坏后本该回落原生（若抛错说明负控制没生效）');
    s.undo();
});

test('N2 负控制：undo 失效 ⇒ A2 转红', async () => {
    const m = await loadBroken((s) => s.replace('if (used) return false;', 'if (true) return false;'));
    const undo = m.setSource(() => 0.25);
    assert.equal(m.rand(), 0.25);
    assert.equal(undo(), false, '打坏后 undo 本该失效（若仍 true 说明负控制没生效）');
    assert.equal(m.isForced(), true, '打坏后强制状态撤不掉');
});
