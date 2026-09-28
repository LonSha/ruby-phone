/* v3.20.0 冒烟：真模块驱动续玩简报（内核 + 收集器 + 视图块），逐项打印读数。 */
import assert from 'node:assert/strict';
import { resumeBrief, resumeBriefText, RESUME_FACES } from '../../config/resume-brief.js';
import { collectResumeBrief } from '../../apps/timeweaver/timeweaver-collector.js';

let fails = 0;
const t = (name, fn) => {
  try { fn(); console.log('  ✔ ' + name); }
  catch (e) { fails++; console.log('  ✖ ' + name + ' :: ' + (e && e.message)); }
};

console.log('— 内核 —');
t('空输入：零项不给绿灯', () => {
  const r = resumeBrief({});
  assert.equal(r.present, false);
  assert.equal(/全部就绪/.test(r.headline), false);
  assert.match(r.headline, /还没有可续的剧情/);
  assert.equal(r.gaps.length, RESUME_FACES.length, '五个面都应记缺口');
});

t('面在但确实为空 ⇒ 不是缺口（真读数）', () => {
  const r = resumeBrief({
    commitments: { version: 1, items: [] },
    worldProgress: [],
    evidence: { state: 'empty', items: [] },
    storyClock: { present: true, verdict: '一致' },
    updateGap: { state: 'clear' },
    floorCount: 10, at: 1
  });
  assert.equal(r.present, false);
  assert.equal(r.gaps.length, 0, '面在且为空不得记缺口（与「读不到」相反）');
});

t('未完成约定进「未完成的约定」节；终态不进', () => {
  const r = resumeBrief({
    commitments: { version: 1, items: [
      { id: 'apt_1', actor: '甲', content: '周六看展', dateKey: '2026-10-03', status: 'confirmed' },
      { id: 'apt_2', actor: '乙', content: '已办的事', dateKey: '2026-10-01', status: 'fulfilled' }
    ] },
    worldProgress: [], evidence: { state: 'empty', items: [] },
    storyClock: { present: true, verdict: '一致' }, updateGap: { state: 'clear' }, floorCount: 5, at: 1
  });
  const sec = r.sections.find((s) => s.key === 'open');
  assert.ok(sec && sec.rows.length === 1, '只应有 1 条未完成');
  assert.match(sec.rows[0].text, /周六看展/);
  assert.equal(r.present, true);
});

t('挡未来事实：楼层 >= floorCount 的行丢掉并计数', () => {
  const r = resumeBrief({
    evidence: { state: 'ok', items: [
      { title: '早先的一楼', floor: 2, ledger: 'promise', ledgerLabel: '伏笔账' },
      { title: '回档后不存在的一楼', floor: 30, ledger: 'promise', ledgerLabel: '伏笔账' }
    ] },
    commitments: { version: 1, items: [] }, worldProgress: [],
    storyClock: { present: true, verdict: '一致' }, updateGap: { state: 'clear' },
    floorCount: 10, at: 1
  });
  assert.equal(r.dropped.staleFloors, 1);
  const sec = r.sections.find((s) => s.key === 'recent');
  assert.equal(sec.rows.length, 1);
  assert.equal(r.complete, false, '丢过行 ⇒ 不完整');
  assert.match(r.headline, /已挡下 1 条不可达楼层/);
});

t('楼层取不到 ⇒ null（不补 0）', () => {
  const r = resumeBrief({
    evidence: { state: 'ok', items: [{ title: 'x', floor: null, ledger: 'a', ledgerLabel: 'A' }] },
    commitments: null, worldProgress: null, storyClock: null, updateGap: null, floorCount: null, at: null
  });
  const sec = r.sections.find((s) => s.key === 'recent');
  assert.equal(sec.rows[0].floor, null);
  assert.equal(r.at, null, 'at 没给 ⇒ null，不是 0');
});

t('at 走唯一取值门：null / "" / [] 都不出数', () => {
  for (const bad of [null, '', [], {}, true]) {
    const r = resumeBrief({ at: bad, evidence: { state: 'empty', items: [] }, commitments: [], worldProgress: [], storyClock: { present: true, verdict: 'x' }, updateGap: { state: 'clear' } });
    assert.equal(r.at, null, 'at=' + JSON.stringify(bad) + ' 应判没给');
  }
});

t('逐面台账与 RESUME_FACES 一一对应', () => {
  const r = resumeBrief({ evidence: null, commitments: null, worldProgress: null, storyClock: null, updateGap: null });
  assert.equal(r.faceLedger.length, RESUME_FACES.length);
  for (const f of r.faceLedger) assert.equal(RESUME_FACES.includes(f.face), true);
  assert.equal(r.faceLedger.every((f) => f.missing), true);
});

t('超过上限只报 more，不静默截断', () => {
  const items = Array.from({ length: 9 }, (_, i) => ({ title: 't' + i, floor: i, ledger: 'a', ledgerLabel: 'A' }));
  const r = resumeBrief({ evidence: { state: 'ok', items }, commitments: [], worldProgress: [], storyClock: { present: true, verdict: 'x' }, updateGap: { state: 'clear' }, floorCount: 100, at: 1 });
  const sec = r.sections.find((s) => s.key === 'recent');
  assert.equal(sec.rows.length, 5);
  assert.equal(sec.more, 4);
});

console.log('— 收集器（真模块 + 合成宿主）—');
const fakeStorage = (keys) => ({ get: (k) => (k in keys ? keys[k] : undefined) });
t('无宿主：全部面读不到 ⇒ 不抛、有无缺口台账', () => {
  const r = collectResumeBrief(fakeStorage({}), { at: 1 });
  assert.ok(r && typeof r === 'object');
  assert.ok(r.gaps.length >= 1);
  assert.equal(typeof r.line, 'string');
});

t('约定面：真读 storage 键并复用内核分类', () => {
  const payload = { version: 1, items: [{ id: 'apt_1', actor: '甲', content: '爬山', dateKey: '2026-10-09', status: 'proposed' }] };
  const r = collectResumeBrief(fakeStorage({ calendar_commitments: JSON.stringify(payload) }), { at: 5, updateGap: { state: 'clear' }, storyClock: { present: true, verdict: '一致' }, worldProg: [], evidence: { state: 'empty', items: [] } });
  const sec = r.sections.find((s) => s.key === 'open');
  assert.ok(sec && /爬山/.test(sec.rows[0].text));
});

t('宿主给 chat ⇒ floorCount 参与挡未来', () => {
  const r = collectResumeBrief(fakeStorage({ calendar_commitments: '[]' }), {
    at: 1, updateGap: { state: 'clear' }, storyClock: { present: true, verdict: '一致' },
    worldProg: [], evidence: { state: 'ok', items: [{ title: 'x', floor: 99, ledger: 'a', ledgerLabel: 'A' }] },
    context: { chat: new Array(4).fill(0) }
  });
  assert.equal(r.floorCount, 4);
  assert.equal(r.dropped.staleFloors, 1);
});

t('updateGap 三态：unknown 记缺口 / behind 建行 / clear 不建行', () => {
  const base = { commitments: [], worldProgress: [], evidence: { state: 'empty', items: [] }, storyClock: { present: true, verdict: '一致' }, at: 1, floorCount: 3 };
  assert.ok(resumeBrief({ ...base, updateGap: { state: 'unknown', text: '未知' } }).gaps.some((g) => g.face === 'updateGap'));
  assert.ok(resumeBrief({ ...base, updateGap: { state: 'behind', count: 2, text: '落后正文 2 楼' } }).sections.some((s) => s.key === 'stale'));
  assert.equal(resumeBrief({ ...base, updateGap: { state: 'clear' } }).sections.some((s) => s.key === 'stale'), false);
});

console.log(fails ? ('\n✖ 失败 ' + fails + ' 项') : '\n✔ 全部通过');
process.exit(fails ? 1 : 0);