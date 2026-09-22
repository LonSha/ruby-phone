// system-v254.test.mjs -- [v2.54.0] 世界账本深化（舆情强度三分 + 事实对读差集）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const read = (p) => readFileSync(resolve(root, p), 'utf-8');
const manifest = JSON.parse(read('manifest.json'));

test('A1 opinionDetail projection (canon/forum/sandbox + verified/rumor/unknown)', async () => {
  const { projectLedger } = await import('../apps/ledger/ledger-data.js');
  const p = projectLedger({ ok: true, opinion: { present: true, canon: 3, forum: 2, sandbox: 1, verified: 4, rumor: 1, unknown: 0 } });
  assert.equal(p.opinionDetail.present, true);
  assert.equal(p.opinionDetail.canon, 3);
  assert.equal(p.opinionDetail.forum, 2);
  assert.equal(p.opinionDetail.sandbox, 1);
  assert.equal(p.opinionDetail.verified, 4);
  assert.equal(p.opinionDetail.rumor, 1);
});
test('A2 opinionDetail null when absent', async () => {
  const { projectLedger } = await import('../apps/ledger/ledger-data.js');
  assert.equal(projectLedger({ ok: true }).opinionDetail, null);
});
test('A3 factsDetail projection (worldOnly/localOnly/shared)', async () => {
  const { projectLedger } = await import('../apps/ledger/ledger-data.js');
  const p = projectLedger({ ok: true, factsDiff: { hasWorld: true, hasLocal: true, shared: 5, worldOnly: ['a', 'b'], worldOnlyTotal: 9, localOnly: ['c'], localOnlyTotal: 2 } });
  assert.equal(p.factsDetail.shared, 5);
  assert.equal(p.factsDetail.worldOnlyTotal, 9);
  assert.equal(p.factsDetail.localOnlyTotal, 2);
  assert.deepEqual(p.factsDetail.worldOnly, ['a', 'b']);
  assert.deepEqual(p.factsDetail.localOnly, ['c']);
});
test('A4 factsDetail caps lists at 6', async () => {
  const { projectLedger } = await import('../apps/ledger/ledger-data.js');
  const big = Array.from({ length: 20 }, (_, i) => 'k' + i);
  const p = projectLedger({ ok: true, factsDiff: { worldOnly: big, worldOnlyTotal: 20, localOnly: [], localOnlyTotal: 0 } });
  assert.equal(p.factsDetail.worldOnly.length, 6);
  assert.equal(p.factsDetail.worldOnlyTotal, 20);
});
test('A5 factsDetail null-safe', async () => {
  const { projectLedger } = await import('../apps/ledger/ledger-data.js');
  assert.equal(projectLedger({ ok: true }).factsDetail, null);
});

test('B1 promptBlock includes opinion strength', async () => {
  const { ledgerPromptBlock } = await import('../apps/ledger/ledger-data.js');
  const blk = ledgerPromptBlock({ ok: true, opinion: { present: true, canon: 1, forum: 1, sandbox: 0, verified: 3, rumor: 2, unknown: 1 } });
  assert.ok(blk.includes('舆情强度'));
  assert.ok(blk.includes('已核实 3'));
  assert.ok(blk.includes('传闻 2'));
});
test('B2 promptBlock includes facts diff when non-empty', async () => {
  const { ledgerPromptBlock } = await import('../apps/ledger/ledger-data.js');
  const blk = ledgerPromptBlock({ ok: true, factsDiff: { worldOnly: ['x'], worldOnlyTotal: 3, localOnly: ['y'], localOnlyTotal: 1, shared: 4 } });
  assert.ok(blk.includes('事实对读'));
  assert.ok(blk.includes('世界侧独有 3'));
  assert.ok(blk.includes('本机侧独有 1'));
});
test('B3 promptBlock omits facts diff when both empty', async () => {
  const { ledgerPromptBlock } = await import('../apps/ledger/ledger-data.js');
  const blk = ledgerPromptBlock({ ok: true, factsDiff: { worldOnly: [], worldOnlyTotal: 0, localOnly: [], localOnlyTotal: 0, shared: 2 } });
  assert.ok(!blk.includes('事实对读'));
});
test('B4 defaultSettings has showDiff true', async () => {
  const { defaultLedgerSettings } = await import('../apps/ledger/ledger-data.js');
  assert.equal(defaultLedgerSettings().showDiff, true);
});

test('C1 view renders opinion bars + facts diff', () => {
  const src = read('apps/ledger/ledger-view.js');
  assert.match(src, /lg-bar/);
  assert.match(src, /lg-diff-row/);
  assert.match(src, /showDiff/);
});
test('C2 phone.css has new segments', () => {
  const src = read('phone.css');
  assert.match(src, /\.lg-card/);
  assert.match(src, /\.lg-bar-ok/);
  assert.match(src, /\.lg-chipx/);
});

test('C3 clock-app uses eventSource hook (not dead ST_API.registerHook)', () => {
  const src = read('apps/clock/clock-app.js');
  assert.match(src, /eventSource/);
  assert.match(src, /payload\.prompt\.push/);
  assert.ok(!/registerHook/.test(src), 'should not use non-existent registerHook');
});
test('C4 ledger-app uses eventSource hook (not dead ST_API.registerHook)', () => {
  const src = read('apps/ledger/ledger-app.js');
  assert.match(src, /eventSource/);
  assert.match(src, /payload\.prompt\.push/);
  assert.ok(!/registerHook/.test(src), 'should not use non-existent registerHook');
});
test('C5 no app uses payload.systemMessages', () => {
  const src = read('apps/clock/clock-app.js') + read('apps/ledger/ledger-app.js');
  assert.ok(!/payload\.systemMessages/.test(src));
});

test('D1 version sync 2.54', () => {
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
  // [v2.69.0 修复] 原用 /"([^"]+)"/g 全局取引号内容：条目内自带引号（如 ".get(\"active\")"）
  //   会把一条 item 劈成多段 ⇒ strs 错位 ⇒ 假红灯。改为逐行 JSON.parse 真解析字符串字面量。
  const strs = m[1].split('\n').map((l) => l.trim())
    .filter((l) => l.startsWith('"'))
    .map((l) => JSON.parse(l.replace(/,\s*$/, '')))
    .filter((s) => s !== log.versions[String(manifest.version)].date);
  assert.equal(strs.length, logItems.length);
  for (let i = 0; i < logItems.length; i++) assert.equal(strs[i], logItems[i]);
});
