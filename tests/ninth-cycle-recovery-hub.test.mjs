import test from 'node:test';
import assert from 'node:assert/strict';

import { inspectBackupPayload } from '../config/portable-recovery-hub.js';

test('R9-O7 · 本地备份包校验与作用域解析', () => {
    const payload = {
        version: '4.60.0',
        timestamp: 1700000000000,
        data: {
            wechat: [{ id: 'm1' }, { id: 'm2' }],
            backpack: [{ id: 'item-key' }]
        }
    };

    const res = inspectBackupPayload(payload);
    assert.equal(res.ok, true);
    assert.equal(res.version, '4.60.0');
    assert.equal(res.totalAppScopes, 2);
    assert.equal(res.totalEntries, 3);
});