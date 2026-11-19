/**
 * tests/r26_o6b_migration_counts.test.mjs — R26-O6b 迁移报数判据
 *
 * 【咬点】迁移只喊「升了」无法对账。必须报数：动几组 / 归档几键 / 跳几条 / 拒几条。
 * 缝自 Dream fish 的「🧩 自动合并 X 组，重指向 Y 条」。
 *
 * 但源的 safeCall 只 console.error = 静默降级，本仓不照抄：
 *   计与 archiveKeys 必须对拍，不自洽就 consistent=false 并点名。
 *
 * 负控制（真打坏源码再验红）：
 *   N1 让 allow 不带归档键 → 对拍必红（报数不能自证）
 *   N2 把 verdict 写成未登记值 → 必须报 unknown-verdict，不许静默计 0
 *   N3 抽掉 skip 计数 → 漏报必暴露
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { planMigration, migrationCounts, migrationCountsText, idempotencyKeyOf } from '../config/migration-matrix.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(root, 'config', 'migration-matrix.js');
const goodEvidence = () => ({
    chatKey: 'chat-a',
    cardKey: 'character:card-1',
    savedChatKey: 'chat-a',
    savedCardKey: 'character-file:card-1'
});
const legacyFace = () => ({ state: 'legacy', version: 1, current: 2 });

let seq = 0;
async function loadBroken(mutate) {
    const src = fs.readFileSync(SRC, 'utf8');
    const out = mutate(src);
    assert.notEqual(out, src, '负控制没改到源码：mutator 失配（判据会假绿）');
    seq += 1;
    const tmp = path.join(root, 'config', '.tmp_r26o6b_broken_' + seq + '.mjs');
    fs.writeFileSync(tmp, out, 'utf8');
    try {
        return await import(pathToFileURL(tmp).href);
    } finally {
        try { fs.unlinkSync(tmp); } catch (_e) { /* 已删 */ }
    }
}

test('O6b-A1 同代：noop 计 1，其余归零', () => {
    const p = planMigration({ face: { state: 'current', version: 2, current: 2 }, evidence: goodEvidence() });
    const c = migrationCounts(p);
    assert.equal(c.noop, 1);
    assert.equal(c.moved + c.skipped + c.refused, 0);
    assert.equal(c.consistent, true);
});

test('O6b-A2 可升：动 1 组、归档 2 键，且与 archiveKeys 对拍', () => {
    const p = planMigration({ face: legacyFace(), evidence: goodEvidence() });
    assert.equal(p.verdict, 'allow');
    const c = migrationCounts(p);
    assert.equal(c.moved, 1);
    assert.equal(c.archived, p.archiveKeys.length);
    assert.equal(c.archived, 2);
    assert.equal(c.consistent, true);
    assert.deepEqual(c.bad, []);
});

test('O6b-A3 已迁过：skip 计 1，不动归档', () => {
    const key = idempotencyKeyOf('chat-a', 'character:card-1', 1, 2);
    const p = planMigration({ face: legacyFace(), evidence: goodEvidence(), migratedChats: [key] });
    assert.equal(p.verdict, 'skip');
    const c = migrationCounts(p);
    assert.equal(c.skipped, 1);
    assert.equal(c.moved, 0);
    assert.equal(c.consistent, true);
});

test('O6b-A4 缺证据：计入拒载而不是静默不计', () => {
    const p = planMigration({ face: legacyFace(), evidence: { chatKey: 'chat-a' } });
    assert.equal(p.verdict, 'need-evidence');
    const c = migrationCounts(p);
    assert.equal(c.refused, 1);
    assert.equal(c.moved, 0);
    assert.equal(c.consistent, true);
});

test('O6b-A5 拒载：future / unknown / 无边界 都计拒载', () => {
    for (const face of [{ state: 'future', version: 3, current: 2 }, { state: 'unknown', version: 0, current: 2 }]) {
        const c = migrationCounts(planMigration({ face, evidence: goodEvidence() }));
        assert.equal(c.refused, 1, JSON.stringify(face));
        assert.equal(c.moved, 0);
    }
    const noEdge = migrationCounts(planMigration({ face: legacyFace(), evidence: goodEvidence(), edges: [] }));
    assert.equal(noEdge.refused, 1);
});

test('O6b-A6 没计划：不许静默归零，必须标不自洽', () => {
    const c = migrationCounts(null);
    assert.equal(c.consistent, false);
    assert.ok(c.bad.includes('no-plan'));
    assert.equal(migrationCounts(undefined).consistent, false);
});

test('O6b-A7 报数文案四项齐全，不自洽要显式写出', () => {
    const p = planMigration({ face: legacyFace(), evidence: goodEvidence() });
    const t = migrationCountsText(p);
    assert.match(t, /动 1 组/);
    assert.match(t, /归档 2 键/);
    assert.match(t, /跳 0/);
    assert.match(t, /拒 0/);
    assert.doesNotMatch(t, /自洽校验失败/);
    const bad = migrationCountsText({ verdict: 'allow', archiveKeys: [] });
    assert.match(bad, /自洽校验失败/);
    assert.match(bad, /allow-without-archive-keys/);
});

test('O6b-N1 负控制：allow 不带归档键 ⇒ 对拍必红', async () => {
    const m = await loadBroken((s) => s.replace(
        "    out.archiveKeys = [archiveKeyOf('card', ev.cardKey), archiveKeyOf('chat', ev.chatKey)];",
        '    out.archiveKeys = [];'
    ));
    const p = m.planMigration({ face: legacyFace(), evidence: goodEvidence() });
    assert.equal(p.verdict, 'allow');
    const c = m.migrationCounts(p);
    assert.equal(c.archived, 0, '打坏后归档数应为 0');
    assert.equal(c.consistent, false, '打坏后必须报不自洽，否则报数是自证');
    assert.ok(c.bad.includes('allow-without-archive-keys'));
});

test('O6b-N2 负控制：未登记裁决值 ⇒ 必须报 unknown-verdict', async () => {
    const m = await loadBroken((s) => s.replace("    out.verdict = 'allow';", "    out.verdict = 'allowed';"));
    const c = m.migrationCounts({ verdict: 'allowed', archiveKeys: [] });
    assert.equal(c.consistent, false);
    assert.ok(c.bad.some((x) => x.startsWith('unknown-verdict')), JSON.stringify(c.bad));
});

test('O6b-N3 负控制：抽掉 skip 计数 ⇒ 漏报必暴露', async () => {
    const m = await loadBroken((s) => s.replace('            out.skipped = 1;\n', ''));
    const c = m.migrationCounts({ verdict: 'skip', archiveKeys: [] });
    assert.equal(c.skipped, 0, '打坏后 skip 数应为 0（漏报）');
    assert.equal(c.consistent, true, '漏报时它自己发现不了 —— 这正是必须用外部断言盯住它的原因');
});
