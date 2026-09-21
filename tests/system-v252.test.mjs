// system-v252.test.mjs -- [v2.52.0] 时计 App
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const read = (p) => readFileSync(resolve(root, p), 'utf-8');
const manifest = JSON.parse(read('manifest.json'));

test('A1 clock-data exports', async () => {
  const mod = await import('../apps/clock/clock-data.js');
  assert.ok(mod.CLOCK_REASONS);
  assert.ok(mod.readClockFace);
  assert.ok(mod.projectClock);
  assert.ok(mod.clockPromptBlock);
});

test('A2 clock-app exports ClockApp', () => {
  const src = read('apps/clock/clock-app.js');
  assert.match(src, /export class ClockApp/);
});

test('A3 clock-view exports ClockView', () => {
  const src = read('apps/clock/clock-view.js');
  assert.match(src, /export class ClockView/);
});

test('A4 clock.css exists', () => {
  const src = read('apps/clock/clock.css');
  assert.match(src, /cl-root/);
});

test('A5 apps.js has clock (>=38)', () => {
  const src = read('config/apps.js');
  assert.match(src, /id: 'clock'/);
  const count = (src.match(/id: '/g) || []).length;
  assert.ok(count >= 38, 'got ' + count);
});

test('A6 storage has clock pattern', () => {
  const src = read('config/storage.js');
  assert.match(src, /clock_/);
});

test('B1 bridge_absent', async () => {
  const { readClockFace, CLOCK_REASONS } = await import('../apps/clock/clock-data.js');
  assert.equal(readClockFace(null), CLOCK_REASONS.bridge_absent);
});

test('B2 no_snapshot', async () => {
  const { readClockFace, CLOCK_REASONS } = await import('../apps/clock/clock-data.js');
  assert.equal(readClockFace({ hasBridge: true, hasSnapshot: false }), CLOCK_REASONS.no_snapshot);
});

test('B3 no_clock_face', async () => {
  const { readClockFace, CLOCK_REASONS } = await import('../apps/clock/clock-data.js');
  assert.equal(readClockFace({ hasBridge: true, hasSnapshot: true, clock: null }), CLOCK_REASONS.no_clock_face);
});

test('B4 empty', async () => {
  const { readClockFace, CLOCK_REASONS } = await import('../apps/clock/clock-data.js');
  assert.equal(readClockFace({ hasBridge: true, hasSnapshot: true, clock: { date: '', label: '' } }), CLOCK_REASONS.empty);
});

test('B5 ready', async () => {
  const { readClockFace, CLOCK_REASONS } = await import('../apps/clock/clock-data.js');
  assert.equal(readClockFace({ hasBridge: true, hasSnapshot: true, clock: { date: '2026-09-13' } }), CLOCK_REASONS.ready);
});

test('B6 projectClock full', async () => {
  const { projectClock } = await import('../apps/clock/clock-data.js');
  const p = projectClock({ date: '2026-01-01', label: 'x', precision: 'day', turn: 5, lastFlashback: { date: '2025-12-25', label: '', floor: 3 }, timeTagStats: { total: 10, paired: 8, unparseable: 2, calibrated: 5 } });
  assert.equal(p.turn, 5);
  assert.equal(p.hasFlashback, true);
});

test('B7 projectClock null', async () => {
  const { projectClock } = await import('../apps/clock/clock-data.js');
  const p = projectClock(null);
  assert.equal(p.date, '');
});

test('B8 promptBlock empty', async () => {
  const { clockPromptBlock } = await import('../apps/clock/clock-data.js');
  assert.equal(clockPromptBlock(null), '');
  assert.equal(clockPromptBlock({}), '');
});

test('B9 promptBlock valid', async () => {
  const { clockPromptBlock } = await import('../apps/clock/clock-data.js');
  const blk = clockPromptBlock({ date: '2026-09-13', label: 'x', precision: 'day', turn: 3 });
  assert.ok(blk.includes('2026-09-13'));
});

test('C1 wechat has clockApp', () => {
  const src = read('apps/wechat/chat-view.js');
  assert.match(src, /clockApp/);
});

test('C2 index.js 3 onChatChanged', () => {
  const src = read('index.js');
  const count = (src.match(/clockApp\?\.onChatChanged/g) || []).length;
  assert.equal(count, 3);
});

test('C3 index.js clock route', () => {
  const src = read('index.js');
  assert.match(src, /appId === 'clock'/);
});

test('D1 version sync (format only, latest pinned by newest suite)', () => {
  const v = String(manifest.version);
  assert.match(v, /^\d+\.\d+\.\d+$/, 'got ' + v);
});
