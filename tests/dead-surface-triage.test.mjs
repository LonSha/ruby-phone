import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const method = JSON.parse(fs.readFileSync('scripts/dead-method-baseline.json', 'utf8'));
const bind = JSON.parse(fs.readFileSync('scripts/bind-dead-baseline.json', 'utf8'));

test('dead surface baseline has explicit, non-empty triage evidence', () => {
    assert.equal(method.entries.length, 334);
    assert.equal(method.entries.filter((e) => e.classInstantiated === false).length, 137);
    assert.equal(method.entries.filter((e) => e.classInstantiated === true).length, 197);
    assert.equal(bind.entries.length, 59);
    for (const entry of bind.entries) {
        assert.ok(entry.evidence, `${entry.file}:${entry.name} lacks evidence`);
        if (entry.evidence === 'name-clash') assert.ok(Array.isArray(entry.refs) && entry.refs.length > 0, `${entry.file}:${entry.name} lacks clash refs`);
    }
});

test('dead surface policy does not treat test-only calls as product consumption', () => {
    assert.match(method.rule, /只判增量/);
    assert.match(bind.rule, /新增项必须显式登记理由/);
});