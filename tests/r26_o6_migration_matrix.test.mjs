/**
 * r26_o6_migration_matrix.test.mjs — R26-O6 存储迁移兼容矩阵
 *
 * 【咬点（对齐计划书验收口径：矩阵逐格有测试；不可升的组合明确拒载）】
 *   A1 矩阵逐格有说法：每个 from→to 都有「可升/拒载」二选一的文字，不许空格；
 *   A2 四态裁决：current→noop / legacy→allow / future→refuse / unknown→refuse；
 *   A3 证据门（本文件最重要的一条）：**归属证据对不上就不迁**；
 *   A4 幂等键：同 (chat,card,from→to) 只能真跑一次，第二次 skip；
 *   A5 旧键只搬家：archiveKeys 全以 legacy_backup: 开头且步骤含 retain-legacy；
 *   A6 未登记边一律拒载；
 *   A7 接线在不在：storage 薄方法 / index 自检 / 诊断卡。
 *
 * 负控制 N1~N3 真把实现打坏（临时文件 import）再断言原判据转红。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
    MIGRATION_EDGES,
    EVIDENCE_FIELDS,
    LEGACY_PREFIX,
    idempotencyKeyOf,
    archiveKeyOf,
    edgeOf,
    planMigration,
    matrixRows,
    migrationFaceText,
    migrationMatrixSelfCheck
} from '../config/migration-matrix.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(root, 'config', 'migration-matrix.js');

const goodEvidence = () => ({
    chatKey: 'chat-a',
    cardKey: 'character:card-1',
    savedChatKey: 'chat-a',
    savedCardKey: 'character-file:card-1'
});
const legacyFace = () => ({ state: 'legacy', version: 1, current: 2 });

let brokenSeq = 0;
async function loadBroken(mutate) {
    const src = fs.readFileSync(SRC, 'utf8');
    const out = mutate(src);
    assert.notEqual(out, src, '负控制没改到源码：mutator 失配（判据会假绿）');
    brokenSeq += 1;
    const tmp = path.join(root, 'config', '.tmp_r26o6_broken_' + brokenSeq + '.mjs');
    fs.writeFileSync(tmp, out, 'utf8');
    try {
        return await import(pathToFileURL(tmp).href);
    } finally {
        try { fs.unlinkSync(tmp); } catch (_e) { /* 已删 */ }
    }
}

test('O6-A1 矩阵逐格有说法：每一对版本都是「可升」或「拒载」二选一', () => {
    assert.ok(MIGRATION_EDGES.length >= 1, '至少要有一条登记边');
    for (const e of MIGRATION_EDGES) {
        assert.ok(Number(e.from) < Number(e.to), '本仓只登记上升边');
        assert.ok(typeof e.why === 'string' && e.why.length > 8, '每条边要写清为什么能升');
        assert.ok(Array.isArray(e.steps) && e.steps.length > 0, '每条边要有可执行步骤');
    }
    const rows = matrixRows({ current: 2 });
    assert.ok(rows.length >= 2);
    for (const r of rows) {
        assert.ok(typeof r.label === 'string' && r.label.length > 0);
        assert.ok(/可升|拒载|noop/.test(String(r.value)), '每一格必须有明确结论：' + JSON.stringify(r));
    }
    assert.ok(rows.some((r) => r.label === '1 → 2' && String(r.value).indexOf('可升') >= 0));
    assert.ok(rows.some((r) => r.label === '2 → 1' && String(r.value).indexOf('拒载') >= 0), '反向降级必须写明拒载');
});

test('O6-A2 四态裁决：current 不写盘 / future 与 unknown 一律拒载', () => {
    assert.equal(planMigration({ face: { state: 'current', version: 2, current: 2 }, evidence: goodEvidence() }).verdict, 'noop');
    const fut = planMigration({ face: { state: 'future', version: 3, current: 2 }, evidence: goodEvidence() });
    assert.equal(fut.verdict, 'refuse');
    assert.equal(fut.reason, 'future-schema', 'future 档必须具名，不许静默按当前口径读');
    const unk = planMigration({ face: { state: 'unknown', version: 0, current: 2 }, evidence: goodEvidence() });
    assert.equal(unk.verdict, 'refuse');
    assert.equal(unk.reason, 'unknown-schema');
    assert.ok(unk.needs.includes('migration-ledger'));
    const ok = planMigration({ face: legacyFace(), evidence: goodEvidence() });
    assert.equal(ok.verdict, 'allow');
    assert.deepEqual(ok.steps, ['retain-legacy', 'write-isolated', 'advance-ledger']);
    assert.match(migrationFaceText(ok), /可升/);
    assert.match(migrationFaceText(null), /迁移矩阵/);
});

test('O6-A3 证据门：缺证据 / chat 不匹配 / card 不匹配 三种各自具名', () => {
    const miss = planMigration({ face: legacyFace(), evidence: { chatKey: 'chat-a' } });
    assert.equal(miss.verdict, 'need-evidence');
    assert.equal(miss.reason, 'evidence:missing');
    /* 欠的要逐个点名；已提供的那一项不许出现在 needs 里（不许多报）。 */
    for (const f of EVIDENCE_FIELDS) {
        if (f === 'chatKey') assert.ok(!miss.needs.includes(f), '已提供的字段不该被说成欠');
        else assert.ok(miss.needs.includes(f), '欠的字段要点名：' + f);
    }
    const chatBad = planMigration({ face: legacyFace(), evidence: Object.assign(goodEvidence(), { savedChatKey: 'chat-b' }) });
    assert.equal(chatBad.verdict, 'refuse');
    assert.equal(chatBad.reason, 'evidence:chat-mismatch');
    const cardBad = planMigration({ face: legacyFace(), evidence: Object.assign(goodEvidence(), { savedCardKey: 'character:other' }) });
    assert.equal(cardBad.verdict, 'refuse');
    assert.equal(cardBad.reason, 'evidence:card-mismatch');
    const trans = planMigration({ face: legacyFace(), evidence: Object.assign(goodEvidence(), { savedCardKey: 'character-file:anything' }) });
    assert.equal(trans.verdict, 'allow');
    const same = planMigration({ face: legacyFace(), evidence: Object.assign(goodEvidence(), { savedCardKey: 'character:card-1' }) });
    assert.equal(same.verdict, 'allow');
});

test('O6-A4 幂等键：同一次迁移第二次必 skip，换聊天则重算', () => {
    const first = planMigration({ face: legacyFace(), evidence: goodEvidence() });
    assert.equal(first.verdict, 'allow');
    const key = first.idempotencyKey;
    assert.equal(key, idempotencyKeyOf('chat-a', 'character:card-1', 1, 2));
    const second = planMigration({ face: legacyFace(), evidence: goodEvidence(), migratedChats: [key] });
    assert.equal(second.verdict, 'skip');
    assert.equal(second.reason, 'already-migrated');
    const other = planMigration({
        face: legacyFace(),
        evidence: { chatKey: 'chat-b', cardKey: 'character:card-1', savedChatKey: 'chat-b', savedCardKey: 'character:card-1' },
        migratedChats: [key]
    });
    assert.equal(other.verdict, 'allow');
    assert.notEqual(other.idempotencyKey, key);
});

test('O6-A5 旧键只搬家：归档名带 legacy_backup: 前缀，步骤含 retain-legacy', () => {
    const p = planMigration({ face: legacyFace(), evidence: goodEvidence() });
    assert.equal(p.archiveKeys.length, 2);
    for (const k of p.archiveKeys) assert.ok(k.startsWith(LEGACY_PREFIX), '归档名必须以 legacy_backup: 开头：' + k);
    assert.ok(p.archiveKeys.includes('legacy_backup:card:character:card-1'));
    assert.ok(p.steps.includes('retain-legacy'), '必须有「保留旧键」这一步');
    assert.equal(archiveKeyOf('chat', 'chat-a'), 'legacy_backup:chat:chat-a');
    assert.equal(archiveKeyOf('', 'x'), 'legacy_backup:unknown:x', '缺 kind 要如实写 unknown');
});

test('O6-A6 未登记边一律拒载：不许降级成「尽量试试」', () => {
    const p = planMigration({ face: legacyFace(), evidence: goodEvidence(), edges: [] });
    assert.equal(p.verdict, 'refuse');
    assert.equal(p.reason, 'no-edge');
    assert.ok(p.needs.includes('edge:1>2'));
    assert.equal(edgeOf(1, 2), MIGRATION_EDGES[0]);
    assert.equal(edgeOf(9, 10), null, '没登记就是 null，不许造边');
    const jump = planMigration({ face: { state: 'legacy', version: 2, current: 5 }, evidence: goodEvidence() });
    assert.equal(jump.verdict, 'refuse');
    assert.equal(jump.reason, 'no-edge');
});

test('O6-A7 接线在不在：storage 薄方法 / index 自检 / 诊断卡', () => {
    const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
    const st = read('config/storage.js');
    /* storage.js 必须能在隔离环境里单文件加载（v273 / v284 / v289 都把它复制到临时目录
     * 单独 import），所以矩阵依赖**不许**挂在 storage.js 上 —— 真消费在诊断面。 */
    assert.ok(!st.includes("from './migration-matrix.js'"), 'storage.js 不得静态依赖迁移矩阵（会让隔离套件加载失败）');
    const idx = read('index.js');
    assert.ok(idx.includes("['_r26O6', migrationMatrixSelfCheck]"), 'index 启动自检要登记');
    const data = read('apps/diagnose/diagnose-data.js');
    assert.ok(data.includes('migration: migrationSc'), '诊断数据要带迁移面');
    const view = read('apps/diagnose/diagnose-view.js');
    assert.ok(view.includes('_migrationMatrixHtml'), '诊断视图要有卡');
    const sc = migrationMatrixSelfCheck();
    assert.equal(sc.ok, true, JSON.stringify(sc.bad));
});

test('O6-N1 摘掉归属证据对拍 ⇒ A3 必红', async () => {
    const m = await loadBroken((s) => s.replace(
        "    if (str(ev.savedChatKey) !== str(ev.chatKey)) {",
        "    if (false) {"
    ));
    const p = m.planMigration({
        face: { state: 'legacy', version: 1, current: 2 },
        evidence: { chatKey: 'chat-a', cardKey: 'character:c', savedChatKey: 'chat-b', savedCardKey: 'character:c' }
    });
    assert.notEqual(p.reason, 'evidence:chat-mismatch', '打坏后不再具名拒载（若仍拒载说明负控制没生效）');
});

test('O6-N2 摘掉 future 拒载 ⇒ A2 必红', async () => {
    const m = await loadBroken((s) => s.replace(
        "    if (state === 'future') {",
        "    if (false) {"
    ));
    const p = m.planMigration({ face: { state: 'future', version: 3, current: 2 }, evidence: {} });
    assert.notEqual(p.reason, 'future-schema', '打坏后 future 档不再具名拒载');
});

test('O6-N3 摘掉幂等去重 ⇒ A4 必红', async () => {
    const m = await loadBroken((s) => s.replace(
        "    if (done.indexOf(key) >= 0) { out.verdict = 'skip'; out.reason = 'already-migrated'; return out; }",
        "    if (false) { }"
    ));
    const p = m.planMigration({
        face: { state: 'legacy', version: 1, current: 2 },
        evidence: { chatKey: 'c', cardKey: 'character:c', savedChatKey: 'c', savedCardKey: 'character:c' },
        migratedChats: ['mig:1>2@c#character:c']
    });
    assert.notEqual(p.verdict, 'skip', '打坏后仍在去重（说明负控制没生效）');
});
