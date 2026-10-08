/**
 * tests/system-v3700_creation.test.mjs — [v3.70.0 · X6] 创作素材到发布草稿实际接入
 *
 * A面 协议（表自检 / 来源登记表 / 目标登记表 / 导出面）
 * B面 草稿构建（正常 / 类型不匹配 / 来源不存在 / 目标不存在 / opts 处理）
 * C面 素材校验（存在 / 不存在 / 来源不存在 / 空列表）
 * D面 幂等账本（幂等键 / 去重 / 截断 / diff 陈旧 / apply 移除+写入）
 * V面 版本与导出面
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
    CREATION_SOURCES,
    CREATION_TARGETS,
    CREATION_LEDGER_LIMIT,
    buildCreationDraft,
    verifyMaterialExists,
    creationIdemKey,
    normalizeCreationEntry,
    normalizeCreationLedger,
    diffCreationLedger,
    applyCreationLedger,
    creationSelfCheck,
} from '../config/creation-pipeline.js';

// Verify no unexpected extra exports
const mod = await import('../config/creation-pipeline.js');
const allExports = Object.keys(mod).filter(k => k !== 'default');

const MANIFEST = JSON.parse(
    await import('node:fs').then(m => m.promises.readFile(new URL('../manifest.json', import.meta.url), 'utf-8'))
);

describe('[A] 协议 · 表自检', () => {
    test('A1: 表自检全绿', () => {
        const { problems } = creationSelfCheck();
        assert.deepEqual(problems, []);
    });

    test('A2: CREATION_SOURCES 恰好 8 条来源', () => {
        assert.equal(CREATION_SOURCES.length, 8);
    });

    test('A3: CREATION_TARGETS 至少 4 条目标', () => {
        assert.ok(CREATION_TARGETS.length >= 4, '目标应至少 4 条，实际 ' + CREATION_TARGETS.length);
    });

    test('A4: 所有来源 source 键唯一', () => {
        const keys = CREATION_SOURCES.map(s => s.source);
        assert.equal(new Set(keys).size, keys.length, '来源 source 键有重复: ' + keys.join(', '));
    });

    test('A5: 所有来源有 label / materialType / idKey / traceable', () => {
        for (const s of CREATION_SOURCES) {
            assert.ok(s.label, s.source + ' 缺 label');
            assert.ok(s.materialType, s.source + ' 缺 materialType');
            assert.ok(s.idKey, s.source + ' 缺 idKey');
            assert.equal(typeof s.traceable, 'boolean', s.source + ' traceable 非布尔');
        }
    });

    test('A6: 所有目标有 label / accepts 非空数组', () => {
        for (const t of CREATION_TARGETS) {
            assert.ok(t.label, t.target + ' 缺 label');
            assert.ok(Array.isArray(t.accepts) && t.accepts.length > 0, t.target + ' accepts 空');
        }
    });

    test('A7: CREATION_LEDGER_LIMIT 是 150', () => {
        assert.equal(CREATION_LEDGER_LIMIT, 150);
    });
});

describe('[B] 草稿构建 · buildCreationDraft', () => {
    test('B1: 正常草稿构建', () => {
        const r = buildCreationDraft('musicdesk', 't1', 'wechat', { tags: ['新歌', '试听'], note: 'hello', version: 2 });
        assert.ok(r.valid, '应 valid: ' + r.reason);
        assert.equal(r.draft.status, 'draft');
        assert.equal(r.draft.source, 'musicdesk');
        assert.equal(r.draft.materialId, 't1');
        assert.equal(r.draft.targetApp, 'wechat');
        assert.equal(r.draft.materialType, 'track');
        assert.deepEqual(r.draft.tags, ['新歌', '试听']);
        assert.equal(r.draft.note, 'hello');
        assert.equal(r.draft.version, 2);
        assert.equal(r.reason, 'ok');
    });

    test('B2: 类型不匹配 → type-mismatch', () => {
        // stickerdesk 素材类型是 sticker，magazine 接受 ['article','work','feature','pv']，不匹配
        const r = buildCreationDraft('stickerdesk', 's1', 'magazine', {});
        assert.ok(!r.valid, '应失败');
        assert.ok(r.reason.startsWith('type-mismatch'), '原因应 type-mismatch: ' + r.reason);
        assert.equal(r.draft, null);
    });

    test('B3: 来源不存在 → source-not-found', () => {
        const r = buildCreationDraft('nonexistent', 'x', 'wechat', {});
        assert.ok(!r.valid);
        assert.ok(r.reason.startsWith('source-not-found'), '原因应 source-not-found: ' + r.reason);
        assert.equal(r.draft, null);
    });

    test('B4: 目标不存在 → target-not-found', () => {
        const r = buildCreationDraft('musicdesk', 't1', 'nonexistent', {});
        assert.ok(!r.valid);
        assert.ok(r.reason.startsWith('target-not-found'), '原因应 target-not-found: ' + r.reason);
        assert.equal(r.draft, null);
    });

    test('B5: opts 为空对象时使用默认值', () => {
        const r = buildCreationDraft('pixiv', 'w1', 'lofter', {});
        assert.ok(r.valid);
        assert.deepEqual(r.draft.tags, []);
        assert.equal(r.draft.note, '');
        assert.equal(r.draft.version, 1);
        assert.equal(r.draft.at, 0);
    });

    test('B6: opts 为 null 不崩溃', () => {
        const r = buildCreationDraft('pixiv', 'w1', 'lofter', null);
        assert.ok(r.valid, 'opts=null 不应崩溃: ' + r.reason);
        assert.deepEqual(r.draft.tags, []);
    });

    test('B7: source/targetApp 为空字符串 → 失败', () => {
        const r = buildCreationDraft('', 'x', 'wechat', {});
        assert.ok(!r.valid);
        assert.ok(r.reason.startsWith('source-not-found'));
    });

    test('B8: 草稿 id 格式 draft:source:materialId:targetApp', () => {
        const r = buildCreationDraft('musicdesk', 't1', 'wechat', {});
        assert.ok(r.valid);
        assert.equal(r.draft.id, 'draft:musicdesk:t1:wechat');
    });
});

describe('[C] 素材校验 · verifyMaterialExists', () => {
    test('C1: 素材存在 → found: true', () => {
        const mats = [{ id: 't1' }, { id: 't2' }];
        const r = verifyMaterialExists('musicdesk', 't1', mats);
        assert.ok(r.found, 't1 应在素材列表中找到');
        assert.equal(r.reason, 'ok');
    });

    test('C2: 素材不存在 → found: false', () => {
        const mats = [{ id: 't1' }];
        const r = verifyMaterialExists('musicdesk', 't9', mats);
        assert.ok(!r.found);
        assert.equal(r.reason, 'material-not-in-source');
    });

    test('C3: 来源不存在 → found: false', () => {
        const r = verifyMaterialExists('nonexistent', 'x', [{ id: 'x' }]);
        assert.ok(!r.found);
        assert.equal(r.reason, 'source-not-found');
    });

    test('C4: 空素材列表 → found: false', () => {
        const r = verifyMaterialExists('musicdesk', 't1', []);
        assert.ok(!r.found);
    });

    test('C5: 非数组素材列表 → found: false（防御性降级）', () => {
        const r = verifyMaterialExists('musicdesk', 't1', null);
        assert.ok(!r.found);
    });

    test('C6: 素材用 idKey 字段也能匹配', () => {
        // soundkit 的 idKey 是 recipeId
        const mats = [{ recipeId: 'r1' }];
        const r = verifyMaterialExists('soundkit', 'r1', mats);
        assert.ok(r.found, 'recipeId=r1 应在素材列表中找到');
    });
});

describe('[D] 幂等草稿账本', () => {
    test('D1: creationIdemKey 格式 <source>:<materialId>:<targetApp>', () => {
        const key = creationIdemKey('musicdesk', 't1', 'wechat');
        assert.equal(key, 'musicdesk:t1:wechat');
    });

    test('D2: 同参数幂等键稳定', () => {
        const k1 = creationIdemKey('pixiv', 'w1', 'lofter');
        const k2 = creationIdemKey('pixiv', 'w1', 'lofter');
        assert.equal(k1, k2);
    });

    test('D3: normalizeCreationEntry 拒绝无 idemKey 条目', () => {
        const e = normalizeCreationEntry({ source: 'musicdesk', materialId: 't1', targetApp: 'wechat' });
        assert.equal(e, null, '无 idemKey 应返回 null');
    });

    test('D4: normalizeCreationEntry 正常归一化', () => {
        const e = normalizeCreationEntry({
            idemKey: 'musicdesk:t1:wechat',
            source: 'musicdesk',
            materialId: 't1',
            targetApp: 'wechat',
            status: 'draft',
            at: 12345,
            note: '测试'
        });
        assert.ok(e);
        assert.equal(e.idemKey, 'musicdesk:t1:wechat');
        assert.equal(e.status, 'draft');
        assert.equal(e.at, 12345);
    });

    test('D5: normalizeCreationLedger 去重（同幂等键只留一条）', () => {
        const raw = [
            { idemKey: 'musicdesk:t1:wechat', source: 'musicdesk', materialId: 't1', targetApp: 'wechat', status: 'draft', at: 1 },
            { idemKey: 'musicdesk:t1:wechat', source: 'musicdesk', materialId: 't1', targetApp: 'wechat', status: 'draft', at: 2 },
            { idemKey: 'pixiv:w1:lofter', source: 'pixiv', materialId: 'w1', targetApp: 'lofter', status: 'draft', at: 3 },
        ];
        const norm = normalizeCreationLedger(raw);
        assert.equal(norm.entries.length, 2, '应去重为 2 条');
        assert.equal(norm.dropped, 1, '应丢弃 1 条重复');
    });

    test('D6: normalizeCreationLedger 截断至上限', () => {
        const raw = [];
        for (let i = 0; i < CREATION_LEDGER_LIMIT + 10; i++) {
            raw.push({ idemKey: 'k' + i, source: 'musicdesk', materialId: 'm' + i, targetApp: 'wechat', status: 'draft', at: i });
        }
        const norm = normalizeCreationLedger(raw);
        assert.equal(norm.entries.length, CREATION_LEDGER_LIMIT, '应截断至 ' + CREATION_LEDGER_LIMIT);
        assert.ok(norm.dropped >= 10, '应至少丢弃 10 条');
    });

    test('D7: normalizeCreationLedger 空输入 → 空账本', () => {
        const norm = normalizeCreationLedger(null);
        assert.equal(norm.entries.length, 0);
        assert.equal(norm.dropped, 0);
    });

    test('D8: normalizeCreationLedger 非数组 → 空账本', () => {
        const norm = normalizeCreationLedger('not array');
        assert.equal(norm.entries.length, 0);
        assert.equal(norm.dropped, 0);
    });

    test('D9: normalizeCreationLedger 过滤无效条目（null/无idemKey）', () => {
        const raw = [
            null,
            { source: 'musicdesk' }, // 无 idemKey
            { idemKey: 'musicdesk:t1:wechat', source: 'musicdesk', materialId: 't1', targetApp: 'wechat', status: 'draft', at: 1 },
        ];
        const norm = normalizeCreationLedger(raw);
        assert.equal(norm.entries.length, 1, '应只有 1 条有效');
        assert.equal(norm.dropped, 2, '应丢弃 2 条无效');
    });

    test('D10: diffCreationLedger 标记陈旧（素材已删）', () => {
        const ledger = [
            { idemKey: 'musicdesk:t1:wechat', source: 'musicdesk', materialId: 't1', targetApp: 'wechat', status: 'published', at: 1 },
            { idemKey: 'musicdesk:t2:wechat', source: 'musicdesk', materialId: 't2', targetApp: 'wechat', status: 'published', at: 2 },
        ];
        const currentMats = [{ id: 't1' }]; // t2 已删
        const diff = diffCreationLedger(ledger, currentMats, 'musicdesk');
        assert.equal(diff.stale.length, 1, '应 1 条陈旧');
        assert.equal(diff.stale[0].materialId, 't2');
        assert.equal(diff.active.length, 1);
        assert.equal(diff.active[0].materialId, 't1');
    });

    test('D11: diffCreationLedger 不判定其他来源的条目', () => {
        const ledger = [
            { idemKey: 'musicdesk:t1:wechat', source: 'musicdesk', materialId: 't1', targetApp: 'wechat', status: 'published', at: 1 },
            { idemKey: 'pixiv:w1:lofter', source: 'pixiv', materialId: 'w1', targetApp: 'lofter', status: 'published', at: 2 },
        ];
        // 查 musicdesk 来源，但素材列表不含 t1 → t1 应 stale；pixiv 条目应直接 active
        const diff = diffCreationLedger(ledger, [], 'musicdesk');
        assert.equal(diff.stale.length, 1, 'musicdesk t1 应 stale');
        assert.equal(diff.stale[0].materialId, 't1');
        assert.equal(diff.active.length, 1, 'pixiv 条目应直接 active');
        assert.equal(diff.active[0].source, 'pixiv');
    });

    test('D12: applyCreationLedger 移除陈旧 + 写入新条目', () => {
        const prev = [
            { idemKey: 'musicdesk:t_old:wechat', source: 'musicdesk', materialId: 't_old', targetApp: 'wechat', status: 'published', at: 1 },
        ];
        const newEntries = [
            { idemKey: 'musicdesk:t_new:wechat', source: 'musicdesk', materialId: 't_new', targetApp: 'wechat', status: 'draft', at: 2 },
        ];
        const result = applyCreationLedger(prev, newEntries, ['t_old']);
        assert.ok(!result.entries.some(e => e.materialId === 't_old'), '陈旧条目应被移除');
        assert.ok(result.entries.some(e => e.materialId === 't_new'), '新条目应被写入');
        assert.equal(result.count, 1);
    });

    test('D13: applyCreationLedger 空输入不崩溃', () => {
        const result = applyCreationLedger(null, null, null);
        assert.equal(result.count, 0);
        assert.equal(result.dropped, 0);
    });
});

describe('[V] 版本与导出面', () => {
    test('V1: 版本下限 3.70.0', () => {
        const ver = MANIFEST.version;
        const parts = ver.split('.').map(Number);
        assert.ok(parts[0] === 3 && parts[1] >= 70, '版本应 >= 3.70.0，实际 ' + ver);
    });

    test('V2: 导出函数恰好 11 项', () => {
        const expected = [
            'CREATION_SOURCES',
            'CREATION_TARGETS',
            'CREATION_LEDGER_LIMIT',
            'buildCreationDraft',
            'verifyMaterialExists',
            'creationIdemKey',
            'normalizeCreationEntry',
            'normalizeCreationLedger',
            'diffCreationLedger',
            'applyCreationLedger',
            'creationSelfCheck',
        ];
        for (const name of expected) {
            assert.ok(typeof mod[name] !== 'undefined', '应导出 ' + name);
        }
        assert.equal(allExports.length, expected.length,
            '导出数应为 ' + expected.length + '，实际 ' + allExports.length + '：' + allExports.join(', '));
    });
});
