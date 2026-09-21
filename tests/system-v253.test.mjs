// system-v253.test.mjs -- [v2.53.0] 世界账本 App
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const read = (p) => readFileSync(resolve(root, p), 'utf-8');
const manifest = JSON.parse(read('manifest.json'));

test('A1 ledger-data exports', async () => {
  const mod = await import('../apps/ledger/ledger-data.js');
  assert.ok(mod.LEDGER_REASONS);
  assert.ok(mod.readLedgerFace);
  assert.ok(mod.projectLedger);
  assert.ok(mod.ledgerPromptBlock);
  assert.ok(mod.defaultLedgerSettings);
});
test('A2 ledger-app exports LedgerApp', () => {
  const src = read('apps/ledger/ledger-app.js');
  assert.match(src, /export class LedgerApp/);
});
test('A3 ledger-view exports LedgerView', () => {
  const src = read('apps/ledger/ledger-view.js');
  assert.match(src, /export class LedgerView/);
});
test('A4 ledger.css exists', () => {
  const src = read('apps/ledger/ledger.css');
  assert.match(src, /lg-root/);
});
test('A5 phone.css has .lg- segment', () => {
  const src = read('phone.css');
  assert.match(src, /\.lg-root/);
  assert.match(src, /\.lg-face-ok/);
});
test('A6 apps.js has ledger', () => {
  const src = read('config/apps.js');
  assert.match(src, /id: 'ledger'/);
});
test('A7 storage has ledger pattern', () => {
  const src = read('config/storage.js');
  assert.match(src, /ledger_/);
});

test('B1 bridge_absent (no probe)', async () => {
  const { readLedgerFace, LEDGER_REASONS } = await import('../apps/ledger/ledger-data.js');
  assert.equal(readLedgerFace(null), LEDGER_REASONS.bridge_absent);
  assert.equal(readLedgerFace({ hasBridge: false }), LEDGER_REASONS.bridge_absent);
});
test('B2 no_snapshot', async () => {
  const { readLedgerFace, LEDGER_REASONS } = await import('../apps/ledger/ledger-data.js');
  assert.equal(readLedgerFace({ hasBridge: true, hasSnapshot: false }), LEDGER_REASONS.no_snapshot);
});
test('B3 no_ledger_face (undefined/null)', async () => {
  const { readLedgerFace, LEDGER_REASONS } = await import('../apps/ledger/ledger-data.js');
  assert.equal(readLedgerFace({ hasBridge: true, hasSnapshot: true, ledger: null }), LEDGER_REASONS.no_ledger_face);
  assert.equal(readLedgerFace({ hasBridge: true, hasSnapshot: true, ledger: undefined }), LEDGER_REASONS.no_ledger_face);
});
test('B4 no_worldaxis (reader-unavailable/not-mounted/disabled/refused)', async () => {
  const { readLedgerFace, LEDGER_REASONS } = await import('../apps/ledger/ledger-data.js');
  for (const r of ['reader-unavailable', 'not-mounted', 'disabled', 'refused']) {
    assert.equal(readLedgerFace({ hasBridge: true, hasSnapshot: true, ledger: { ok: false, reason: r } }), LEDGER_REASONS.no_worldaxis, r);
  }
});
test('B5 empty (ok:false other reason)', async () => {
  const { readLedgerFace, LEDGER_REASONS } = await import('../apps/ledger/ledger-data.js');
  assert.equal(readLedgerFace({ hasBridge: true, hasSnapshot: true, ledger: { ok: false, reason: 'no-ledger' } }), LEDGER_REASONS.empty);
});
test('B6 ready', async () => {
  const { readLedgerFace, LEDGER_REASONS } = await import('../apps/ledger/ledger-data.js');
  assert.equal(readLedgerFace({ hasBridge: true, hasSnapshot: true, ledger: { ok: true } }), LEDGER_REASONS.ready);
});
test('B7 projectLedger full', async () => {
  const { projectLedger } = await import('../apps/ledger/ledger-data.js');
  const p = projectLedger({ ok: true, reason: '', describe: '三方对读完成', counts: { currents: 12, facts: 30, people: 4, opinionCanon: 5, opinionForum: 3 }, gap: { verdict: 'gapped', notMarkedCount: 2 }, peopleDiff: { mismatched: [1, 2] }, at: 123 });
  assert.equal(p.ok, true);
  assert.equal(p.counts.currents, 12);
  assert.equal(p.counts.opinion, 8);
  assert.equal(p.gap.notMarkedCount, 2);
  assert.equal(p.peopleMismatch, 2);
});
test('B8 projectLedger null-safe', async () => {
  const { projectLedger } = await import('../apps/ledger/ledger-data.js');
  assert.equal(projectLedger(null).ok, false);
  assert.equal(projectLedger({}).counts, null);
});
test('B9 promptBlock empty when not ok', async () => {
  const { ledgerPromptBlock } = await import('../apps/ledger/ledger-data.js');
  assert.equal(ledgerPromptBlock(null), '');
  assert.equal(ledgerPromptBlock({}), '');
  assert.equal(ledgerPromptBlock({ ok: false, reason: 'x' }), '');
});
test('B10 promptBlock valid includes counts', async () => {
  const { ledgerPromptBlock } = await import('../apps/ledger/ledger-data.js');
  const blk = ledgerPromptBlock({ ok: true, describe: 'D', counts: { currents: 1, facts: 2, people: 3, opinionCanon: 4, opinionForum: 1 }, gap: { verdict: 'gapped', notMarkedCount: 5 } });
  assert.ok(blk.includes('世界账本'));
  assert.ok(blk.includes('暗流 1'));
  assert.ok(blk.includes('未外供缺口'));
});

test('C1 wechat has ledgerApp', () => {
  const src = read('apps/wechat/chat-view.js');
  assert.match(src, /ledgerApp/);
  assert.match(src, /SYSTEM \(世界账本\)/);
});
test('C2 index.js 3 onChatChanged', () => {
  const src = read('index.js');
  const count = (src.match(/ledgerApp\?\.onChatChanged/g) || []).length;
  assert.equal(count, 3);
});
test('C3 index.js ledger route', () => {
  const src = read('index.js');
  assert.match(src, /appId === 'ledger'/);
});

test('D1 version format (latest pinned by newest suite)', () => {
  const v = String(manifest.version);
  assert.match(v, /^\d+\.\d+\.\d+$/, 'got ' + v);
});
test('D2 ST_PHONE_VERSION matches manifest', () => {
  const src = read('index.js');
  const m = src.match(/const ST_PHONE_VERSION = '([^']+)'/);
  assert.ok(m, 'ST_PHONE_VERSION not found');
  assert.equal(m[1], String(manifest.version));
});
test('D3 update-log head = current version', () => {
  const log = JSON.parse(read('update-log.json'));
  assert.equal(String(log.latest), String(manifest.version));
  assert.equal(String(Object.keys(log.versions)[0]), String(manifest.version));
});
test('D4 current-update items match log', () => {
  const src = read('index.js');
  const log = JSON.parse(read('update-log.json'));
  const logItems = log.versions[String(manifest.version)].items;
  const m = src.match(/const ST_PHONE_CURRENT_UPDATE = \{([\s\S]*?)\n\};/);
  assert.ok(m, 'current-update block not found');
  const strs = [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]).filter((s) => s !== log.versions[String(manifest.version)].date);
  assert.equal(strs.length, logItems.length);
  for (let i = 0; i < logItems.length; i++) assert.equal(strs[i], logItems[i]);
});
