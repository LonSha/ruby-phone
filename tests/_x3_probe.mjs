import * as M from '../config/silence-narrative-bridge.js';

const r = M.silenceNarrativeSelfCheck();
console.log('== selfCheck ok =', r.ok);
if (!r.ok) console.log('bad:', JSON.stringify(r.bad, null, 2));

function shape(v) {
  if (Array.isArray(v)) return 'array[' + v.length + ']=' + v.join(',');
  if (v && typeof v === 'object') {
    const ks = Object.keys(v);
    return 'obj[' + ks.length + ']=' + ks.map((k) => k + ':' + v[k]).join(' ');
  }
  return typeof v;
}
console.log('BUCKETS =', shape(M.SILENCE_BUCKETS));
console.log('FACES   =', shape(M.SILENCE_FACES));
console.log('REASONS =', shape(M.SILENCE_REASONS));
console.log('LIMITS  =', shape(M.SILENCE_LIMITS));
console.log('exports =', Object.keys(M).join(','));

function msOf(h, m) {
  return new Date(2026, 10, 15, h, m, 0, 0).getTime();
}

const deepNight = M.silenceNarrative({
  dndOn: true,
  arrivals: 3,
  story: { ok: true, ms: msOf(3, 20), time: '03:20' },
});
const morning = M.silenceNarrative({
  dndOn: true,
  arrivals: 3,
  story: { ok: true, ms: msOf(10, 15), time: '10:15' },
});
console.log('deep-night:', JSON.stringify(deepNight));
console.log('morning   :', JSON.stringify(morning));

const dayText = (morning.candidates || []).join(' ');
const nightText = (deepNight.candidates || []).join(' ');
console.log('day 含"睡"?', /睡/.test(dayText), '|| dayText =', dayText);
console.log('night 含"睡/夜里/静音"?', /睡|夜里|静音/.test(nightText), '|| nightText =', nightText);
console.log('跨桶串供(交集)?', JSON.stringify((morning.candidates || []).filter((s) => (deepNight.candidates || []).includes(s))));

const cases = {
  'dnd-off': { dndOn: false, arrivals: 3, story: { ok: true, ms: msOf(3, 20), time: '03:20' } },
  'arrivals-0': { dndOn: true, arrivals: 0, story: { ok: true, ms: msOf(3, 20), time: '03:20' } },
  'arrivals-undef': { dndOn: true, story: { ok: true, ms: msOf(3, 20), time: '03:20' } },
  'clock-fail': { dndOn: true, arrivals: 3, story: { ok: false, ms: null, time: null } },
  'time-null': { dndOn: true, arrivals: 3, story: { ok: true, ms: null, time: null } },
  'time-vague': { dndOn: true, arrivals: 3, story: { ok: true, ms: null, time: '上午' } },
};
for (const [k, v] of Object.entries(cases)) {
  const out = M.silenceNarrative(v);
  console.log('case', k, '=> face =', out.face, '| reason =', out.reason, '| cands =', (out.candidates || []).length);
}

// 频率门
const g1 = M.silenceFrequencyGate({ lastSpokenMs: null, nowMs: msOf(3, 20) });
const g2 = M.silenceFrequencyGate({ lastSpokenMs: msOf(3, 20), nowMs: msOf(4, 20) });
const g3 = M.silenceFrequencyGate({ lastSpokenMs: msOf(3, 20), nowMs: msOf(3, 20) + 7 * 3600 * 1000 });
const g4 = M.silenceFrequencyGate({ lastSpokenMs: msOf(3, 20), nowMs: msOf(2, 20) });
console.log('gate never =', JSON.stringify(g1));
console.log('gate 1h    =', JSON.stringify(g2));
console.log('gate 7h    =', JSON.stringify(g3));
console.log('gate rewind=', JSON.stringify(g4));

console.log('silenceNote =', typeof M.silenceNote === 'function' ? JSON.stringify(M.silenceNote(deepNight)) : 'MISSING');
console.log('PROBE-DONE');