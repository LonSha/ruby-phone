import test from 'node:test';
import assert from 'node:assert/strict';
import { readProjection, contractOf, projectionValue } from '../config/projection-contract.js';
const env = patch => ({ projectionApiVersion: 1, projectionVersion: 1,
    generatedAt: 100, expiresAt: 200, revision: 0, conversationId: 'chat',
    sceneId: null, worldId: null, items: { probe: 'private' },
    visibility: { probe: 'given' }, sourceLedger: { available: true }, ...patch });
const read = patch => readProjection({}, { snapshot: { projection: env(patch) }, now: 150 });
test('visibility explicitly opts in; unknown markers fail closed', () => {
    for (const value of [null, undefined, '', true, false, 0, {}, [], 'hidden', 'future']) {
        const p = read({ visibility: { probe: value } });
        assert.equal(projectionValue(p, 'probe').present, false);
        assert.deepEqual(p.withheld, [{ id: 'probe', reason: 'invalid-visibility' }]);
    }
    for (const value of [0, null, [], {}]) {
        const p = read({ items: { probe: value } });
        assert.equal(projectionValue(p, 'probe').present, true);
        assert.deepEqual(p.items.probe, value);
    }
});
test('non-numeric containers and whitespace cannot masquerade as revision/time zero', () => {
    for (const value of [true, false, [], [0], {}, ' ', '\t', null, undefined, '', Infinity, NaN]) {
        const p = read({ revision: value, generatedAt: value, expiresAt: value });
        assert.equal(p.revision, null);
        assert.equal(p.generatedAt, null);
        assert.equal(p.expiresAt, null);
        assert.equal(p.stale, null);
    }
    for (const value of [0, '0', ' 0 ']) assert.equal(read({ revision: value }).revision, 0);
});
test('required object fields with invalid shapes are malformed, not silently empty', () => {
    for (const key of ['items', 'visibility', 'sourceLedger']) {
        for (const value of [null, [], false, 0, 'text']) {
            assert.equal(contractOf(env({ [key]: value })).state, 'malformed');
            assert.equal(read({ [key]: value }).state, 'unusable');
        }
    }
});