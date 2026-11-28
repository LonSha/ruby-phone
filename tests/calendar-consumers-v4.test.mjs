import test from 'node:test';
import assert from 'node:assert/strict';
import { MusicdeskApp } from '../apps/musicdesk/musicdesk-app.js';
import { SummdeskApp } from '../apps/summdesk/summdesk-app.js';
import { stampOf } from '../apps/diagdesk/diagdesk-data.js';
import { matchReminders } from '../apps/annidate/annidate-data.js';
import { formatClock } from '../apps/line/line-data.js';
import { parseDateInput, startOfLocalDay } from '../apps/date/date-data.js';

test('receipts and summaries use the supplied epoch, not the wall clock', () => {
    const d = new Date(0);
    const y = d.getFullYear(), m = d.getMonth() + 1, day = d.getDate();
    const key = [y, m, day].map(v => String(v).padStart(2, '0')).join('-');
    const music = new MusicdeskApp(null, null);
    music.probe(0);
    assert.equal(music._receipt({}).at, key);
    const summary = new SummdeskApp({ now: () => 0 }, null);
    summary.intakeSummary('A summary', '1~2');
    assert.ok(summary._memories[0].title.endsWith(` 1-2 ${y}/${m}/${day}`));
    assert.equal(summary._memories[0].timestamp, 0);
    assert.equal(stampOf(0).slice(0, 10), key);
    assert.equal(stampOf(null), '');
});

test('New Year anniversary eve uses the anniversary year, not the current year', () => {
    const item = { date: Date.UTC(2024, 0, 1), reminders: { yearlyDayBefore: true } };
    const result = matchReminders(item, Date.UTC(2024, 11, 31));
    assert.deepEqual(result.map(r => [r.kind, r.years]), [['yearlyDayBefore', 1]]);
});

test('chat and date input use local calendar days across the spring clock change', () => {
    const at = new Date(2026, 2, 8, 1, 15).getTime();
    const next = new Date(2026, 2, 9, 0, 5).getTime();
    assert.equal(formatClock(at, next), '昨天 01:15');
    assert.equal(parseDateInput('2026-03-08'), startOfLocalDay(at));
    assert.equal(parseDateInput('2026-02-30'), null);
});
