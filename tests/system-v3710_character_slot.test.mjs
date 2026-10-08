/**
 * tests/system-v3710_character_slot.test.mjs — [v3.71.0 · X7] 多角色生图操作深化
 *
 * A面 协议（表自检 / 常量 / 导出面）
 * B面 槽位解析与序列化（parseSlotModel / serializeSlotModel）
 * C面 槽位编辑（add / remove / swap / reorder / 超上限 / 空输入）
 * D面 payload 预检（正常 / 重复别名 / 坐标越界 / 空模型）
 * E面 幂等回执账本（幂等键 / 去重 / 截断 / diff / apply）
 * F面 位置工具（gridToCoords / coordsToGrid / validatePosition）
 * V面 版本与导出面
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
    MAX_CHARACTER_SLOTS,
    IMAGE_RECEIPT_LEDGER_LIMIT,
    validatePosition,
    gridToCoords,
    coordsToGrid,
    parseSlotModel,
    serializeSlotModel,
    addSlot,
    removeSlot,
    swapSlots,
    reorderSlots,
    buildPayloadPreview,
    imageReceiptIdemKey,
    normalizeImageReceiptEntry,
    normalizeImageReceiptLedger,
    diffImageReceiptLedger,
    applyImageReceiptLedger,
    characterSlotSelfCheck,
} from '../config/character-slot-manager.js';

const mod = await import('../config/character-slot-manager.js');
const allExports = Object.keys(mod).filter(k => k !== 'default');

const MANIFEST = JSON.parse(
    await import('node:fs').then(m => m.promises.readFile(new URL('../manifest.json', import.meta.url), 'utf-8'))
);

describe('[A] 协议 · 表自检', () => {
    test('A1: 表自检全绿', () => {
        const { problems } = characterSlotSelfCheck();
        assert.deepEqual(problems, []);
    });

    test('A2: MAX_CHARACTER_SLOTS 是 6', () => {
        assert.equal(MAX_CHARACTER_SLOTS, 6);
    });

    test('A3: IMAGE_RECEIPT_LEDGER_LIMIT 是 200', () => {
        assert.equal(IMAGE_RECEIPT_LEDGER_LIMIT, 200);
    });
});

describe('[B] 槽位解析与序列化', () => {
    test('B1: 解析两个角色块（带位置）', () => {
        const model = parseSlotModel(
            '{人物 1girl, black hair, {位置 B2} 人物}, {人物 1boy, blond hair, {位置 D4} 人物}',
            'lowres'
        );
        assert.equal(model.slots.length, 2);
        assert.equal(model.useCoords, true);
        assert.equal(model.slots[0].charCaption, '1girl, black hair');
        assert.equal(model.slots[1].charCaption, '1boy, blond hair');
        assert.equal(model.slots[0].centerGrid, 'B2');
        assert.equal(model.slots[1].centerGrid, 'D4');
        assert.equal(model.baseCaption, '');
        assert.equal(model.negativeBaseCaption, 'lowres');
    });

    test('B2: 无位置时 useCoords=false，位置全部清空', () => {
        const model = parseSlotModel('{人物 1girl 人物}, {人物 1boy, {位置 C3} 人物}');
        assert.equal(model.useCoords, false);
        assert.equal(model.slots[0].center, null);
        assert.equal(model.slots[1].center, null);
    });

    test('B3: 空字符串 → 空模型', () => {
        const model = parseSlotModel('');
        assert.equal(model.slots.length, 0);
        assert.equal(model.useCoords, false);
        assert.equal(model.baseCaption, '');
    });

    test('B4: ntags 分离到 negativeCaption', () => {
        const model = parseSlotModel('{人物 1girl, ntags=lowres, bad anatomy 人物}');
        assert.equal(model.slots[0].charCaption, '1girl');
        assert.equal(model.slots[0].negativeCaption, 'lowres, bad anatomy');
    });

    test('B5: serializeSlotModel 产出含人物块的字符串', () => {
        const model = parseSlotModel(
            '{人物 1girl, black hair, {位置 B2} 人物}, {人物 1boy, blond hair, {位置 D4} 人物}'
        );
        const serialized = serializeSlotModel(model);
        assert.ok(serialized.includes('{人物'));
        assert.ok(serialized.includes('1girl'));
        assert.ok(serialized.includes('1boy'));
    });

    test('B6: 最多 6 个槽位', () => {
        let prompt = '';
        for (let i = 0; i < 8; i++) {
            prompt += '{人物 char' + i + ' 人物}, ';
        }
        const model = parseSlotModel(prompt);
        assert.equal(model.slots.length, MAX_CHARACTER_SLOTS);
    });

    test('B7: 深度标签解析（前/后）', () => {
        const model = parseSlotModel('{人物 1girl, {位置 前} 人物}, {人物 1boy, {位置 后} 人物}');
        assert.equal(model.slots[0].depthTag, 'foreground');
        assert.equal(model.slots[1].depthTag, 'background');
    });
});

describe('[C] 槽位编辑', () => {
    const baseModel = parseSlotModel('{人物 1girl, {位置 B2} 人物}, {人物 1boy, {位置 D4} 人物}');

    test('C1: addSlot 正常添加', () => {
        const r = addSlot(baseModel, { charCaption: '1cat', center: { x: 0.5, y: 0.5 } });
        assert.equal(r.error, '');
        assert.equal(r.model.slots.length, 3);
    });

    test('C2: addSlot 超上限 → max-slots-exceeded', () => {
        let m = { baseCaption: '', negativeBaseCaption: '', slots: [], useCoords: false };
        for (let i = 0; i < MAX_CHARACTER_SLOTS; i++) {
            m = addSlot(m, { charCaption: 'c' + i }).model;
        }
        const r = addSlot(m, { charCaption: 'overflow' });
        assert.ok(r.error.startsWith('max-slots-exceeded'));
    });

    test('C3: addSlot 空标题 → empty-caption', () => {
        const r = addSlot(baseModel, { charCaption: '' });
        assert.equal(r.error, 'empty-caption');
    });

    test('C4: removeSlot 正常移除', () => {
        const r = removeSlot(baseModel, 0);
        assert.equal(r.error, '');
        assert.equal(r.model.slots.length, 1);
        assert.equal(r.model.slots[0].charCaption, '1boy');
    });

    test('C5: removeSlot 越界 → index-out-of-range', () => {
        const r = removeSlot(baseModel, 99);
        assert.ok(r.error.startsWith('index-out-of-range'));
    });

    test('C6: swapSlots 交换内容', () => {
        const r = swapSlots(baseModel, 0, 1);
        assert.equal(r.error, '');
        assert.equal(r.model.slots[0].charCaption, '1boy');
        assert.equal(r.model.slots[1].charCaption, '1girl');
    });

    test('C7: reorderSlots 重排', () => {
        const r = reorderSlots(baseModel, [1, 0]);
        assert.equal(r.error, '');
        assert.equal(r.model.slots[0].charCaption, '1boy');
        assert.equal(r.model.slots[1].charCaption, '1girl');
    });

    test('C8: reorderSlots 长度不匹配 → order-length-mismatch', () => {
        const r = reorderSlots(baseModel, [0]);
        assert.equal(r.error, 'order-length-mismatch');
    });

    test('C9: reorderSlots 重复索引 → invalid-order', () => {
        const r = reorderSlots(baseModel, [0, 0]);
        assert.equal(r.error, 'invalid-order');
    });
});

describe('[D] payload 预检', () => {
    test('D1: 正常 payload 预检全绿', () => {
        const model = parseSlotModel('{人物 1girl, {位置 B2} 人物}, {人物 1boy, {位置 D4} 人物}');
        const r = buildPayloadPreview(model);
        assert.ok(r.valid, '应 valid: ' + r.issues.join('; '));
        assert.equal(r.preview.charCaptions.length, 2);
        assert.equal(r.preview.useCoords, true);
        assert.equal(r.preview.slotCount, 2);
        assert.equal(r.preview.duplicateAliases.length, 0);
    });

    test('D2: 重复别名 → 不 valid', () => {
        const model = parseSlotModel('{人物 1girl, red hair 人物}, {人物 1girl, red hair 人物}');
        const r = buildPayloadPreview(model);
        assert.ok(!r.valid);
        assert.ok(r.issues.some(i => i.startsWith('duplicate-alias')));
        assert.equal(r.preview.duplicateAliases.length, 1);
    });

    test('D3: 坐标越界 → 不 valid', () => {
        const model = {
            baseCaption: '',
            negativeBaseCaption: '',
            slots: [{ index: 0, charCaption: 'test', negativeCaption: '', center: { x: 0.05, y: 0.5 }, centerGrid: null, depthTag: '', rawBlock: '' }],
            useCoords: true
        };
        const r = buildPayloadPreview(model);
        assert.ok(!r.valid);
        assert.ok(r.issues.some(i => i.startsWith('position-out-of-bounds')));
        assert.equal(r.preview.outOfBoundsPositions.length, 1);
    });

    test('D4: 无效模型 → invalid-model', () => {
        const r = buildPayloadPreview(null);
        assert.ok(!r.valid);
        assert.equal(r.preview, null);
        assert.ok(r.issues.includes('invalid-model'));
    });

    test('D5: 空槽位 → valid（空但无问题）', () => {
        const model = { baseCaption: 'test', negativeBaseCaption: '', slots: [], useCoords: false };
        const r = buildPayloadPreview(model);
        assert.ok(r.valid);
        assert.equal(r.preview.slotCount, 0);
    });
});

describe('[E] 幂等回执账本', () => {
    test('E1: imageReceiptIdemKey 格式', () => {
        const key = imageReceiptIdemKey('sess1', 'charA', 'scene1');
        assert.equal(key, 'sess1:charA:scene1');
    });

    test('E2: 同参数幂等键稳定', () => {
        const k1 = imageReceiptIdemKey('s', 'c', 'sc');
        const k2 = imageReceiptIdemKey('s', 'c', 'sc');
        assert.equal(k1, k2);
    });

    test('E3: normalizeImageReceiptEntry 拒绝无 idemKey', () => {
        const e = normalizeImageReceiptEntry({ sessionKey: 's' });
        assert.equal(e, null);
    });

    test('E4: normalizeImageReceiptLedger 去重', () => {
        const raw = [
            { idemKey: 's:c1:sc1', sessionKey: 's', characterId: 'c1', sceneTag: 'sc1', status: 'completed', at: 1 },
            { idemKey: 's:c1:sc1', sessionKey: 's', characterId: 'c1', sceneTag: 'sc1', status: 'completed', at: 2 },
            { idemKey: 's:c2:sc1', sessionKey: 's', characterId: 'c2', sceneTag: 'sc1', status: 'pending', at: 3 },
        ];
        const norm = normalizeImageReceiptLedger(raw);
        assert.equal(norm.entries.length, 2);
        assert.equal(norm.dropped, 1);
    });

    test('E5: normalizeImageReceiptLedger 截断', () => {
        const raw = [];
        for (let i = 0; i < IMAGE_RECEIPT_LEDGER_LIMIT + 10; i++) {
            raw.push({ idemKey: 'k' + i, sessionKey: 's', characterId: 'c' + i, sceneTag: 'sc', status: 'pending', at: i });
        }
        const norm = normalizeImageReceiptLedger(raw);
        assert.equal(norm.entries.length, IMAGE_RECEIPT_LEDGER_LIMIT);
    });

    test('E6: normalizeImageReceiptLedger 空输入', () => {
        const norm = normalizeImageReceiptLedger(null);
        assert.equal(norm.entries.length, 0);
        assert.equal(norm.dropped, 0);
    });

    test('E7: diffImageReceiptLedger 标记陈旧', () => {
        const ledger = [
            { idemKey: 's:c1:sc1', sessionKey: 's', characterId: 'c1', sceneTag: 'sc1', status: 'completed', at: 1 },
            { idemKey: 's:c2:sc1', sessionKey: 's', characterId: 'c2', sceneTag: 'sc1', status: 'completed', at: 2 },
        ];
        const diff = diffImageReceiptLedger(ledger, ['c1']);
        assert.equal(diff.stale.length, 1);
        assert.equal(diff.active.length, 1);
    });

    test('E8: applyImageReceiptLedger 移除陈旧 + 写入新', () => {
        const prev = [
            { idemKey: 's:c_old:sc1', sessionKey: 's', characterId: 'c_old', sceneTag: 'sc1', status: 'completed', at: 1 },
        ];
        const newEntries = [
            { idemKey: 's:c_new:sc1', sessionKey: 's', characterId: 'c_new', sceneTag: 'sc1', status: 'pending', at: 2 },
        ];
        const result = applyImageReceiptLedger(prev, newEntries, ['c_old']);
        assert.ok(!result.entries.some(e => e.characterId === 'c_old'));
        assert.ok(result.entries.some(e => e.characterId === 'c_new'));
        assert.equal(result.count, 1);
    });

    test('E9: applyImageReceiptLedger 空输入不崩溃', () => {
        const result = applyImageReceiptLedger(null, null, null);
        assert.equal(result.count, 0);
    });
});

describe('[F] 位置工具', () => {
    test('F1: gridToCoords A1 → {0.1, 0.1}', () => {
        const r = gridToCoords('A1');
        assert.deepEqual(r, { x: 0.1, y: 0.1 });
    });

    test('F2: gridToCoords C3 → {0.5, 0.5}', () => {
        const r = gridToCoords('C3');
        assert.deepEqual(r, { x: 0.5, y: 0.5 });
    });

    test('F3: gridToCoords E5 → {0.9, 0.9}', () => {
        const r = gridToCoords('E5');
        assert.deepEqual(r, { x: 0.9, y: 0.9 });
    });

    test('F4: gridToCoords 非法格式 → null', () => {
        assert.equal(gridToCoords('Z9'), null);
        assert.equal(gridToCoords(''), null);
        assert.equal(gridToCoords('ABC'), null);
    });

    test('F5: coordsToGrid {0.1,0.1} → A1', () => {
        assert.equal(coordsToGrid({ x: 0.1, y: 0.1 }), 'A1');
    });

    test('F6: coordsToGrid {0.5,0.5} → C3', () => {
        assert.equal(coordsToGrid({ x: 0.5, y: 0.5 }), 'C3');
    });

    test('F7: validatePosition 正常坐标 → valid', () => {
        assert.equal(validatePosition({ x: 0.5, y: 0.5 }).valid, true);
        assert.equal(validatePosition({ x: 0.1, y: 0.9 }).valid, true);
    });

    test('F8: validatePosition 越界 → invalid', () => {
        assert.equal(validatePosition({ x: 0.05, y: 0.5 }).valid, false);
        assert.equal(validatePosition({ x: 0.5, y: 0.95 }).valid, false);
    });

    test('F9: validatePosition null → valid（无位置）', () => {
        assert.equal(validatePosition(null).valid, true);
        assert.equal(validatePosition(undefined).valid, true);
    });

    test('F10: validatePosition 非对象 → invalid', () => {
        assert.equal(validatePosition('not object').valid, false);
    });
});

describe('[V] 版本与导出面', () => {
    test('V1: 版本下限 3.71.0', () => {
        const ver = MANIFEST.version;
        const parts = ver.split('.').map(Number);
        assert.ok(parts[0] === 3 && parts[1] >= 71, '版本应 >= 3.71.0，实际 ' + ver);
    });

    test('V2: 导出函数恰好 18 项', () => {
        const expected = [
            'MAX_CHARACTER_SLOTS',
            'IMAGE_RECEIPT_LEDGER_LIMIT',
            'validatePosition',
            'gridToCoords',
            'coordsToGrid',
            'parseSlotModel',
            'serializeSlotModel',
            'addSlot',
            'removeSlot',
            'swapSlots',
            'reorderSlots',
            'buildPayloadPreview',
            'imageReceiptIdemKey',
            'normalizeImageReceiptEntry',
            'normalizeImageReceiptLedger',
            'diffImageReceiptLedger',
            'applyImageReceiptLedger',
            'characterSlotSelfCheck',
        ];
        for (const name of expected) {
            assert.ok(typeof mod[name] !== 'undefined', '应导出 ' + name);
        }
        assert.equal(allExports.length, expected.length,
            '导出数应为 ' + expected.length + '，实际 ' + allExports.length + '：' + allExports.join(', '));
    });
});