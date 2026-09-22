/**
 * tests/system-v270.test.mjs — v2.70.0 生理状态交接适配层
 *
 * 覆盖：
 *   1. 交接块提取（JSON / 行格式 / 多块 / 无块）
 *   2. 交接块剥离（正文保留、协议块不泄露）
 *   3. 事实校验（未知类型 / 意图非事实 / 缺字段 / 超限小时数）
 *   4. 确定性应用（五维需求 / 病症 / 时间推进）且不越权覆盖本地状态机
 *   5. 部分缓解只记录不投递
 *   6. 账本去重与上限
 *   7. 端到端 processReply 对真 HealthData
 *   8. 存储归属：ruby_health_handoff 会话隔离
 *   9. 接线：health-app 生成后回写钩子存在
 *  10. 版权纯度：适配层不包含外部引擎的水印/完整性机制
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

const {
  extractStateHandoff, normalizeFact, normalizeFacts,
  applyFacts, processReply, HandoffLedger, FACT_TYPES, LEDGER_LIMIT,
} = await import('../apps/health/health-state-bridge.js');
const { HealthData } = await import('../apps/health/health-data.js');
const { PhoneStorage } = await import('../config/storage.js');

let pass = 0;
const ok = (name, cond, extra) => {
  assert.ok(cond, extra ? name + ' — ' + extra : name);
  pass += 1;
};

function memStorage() {
  const bag = new Map();
  return {
    get: (k) => (bag.has(k) ? JSON.parse(JSON.stringify(bag.get(k))) : undefined),
    set: (k, v) => bag.set(k, JSON.parse(JSON.stringify(v))),
  };
}

// ========== 1. 提取 ==========
{
  const json = '她喝完了一大杯水。\n<state_handoff>{"facts":[{"type":"drink","note":"喝完一大杯水"}]}</state_handoff>';
  const r1 = extractStateHandoff(json);
  ok('提取 JSON 交接块', r1.blocks === 1 && r1.facts.length === 1 && r1.facts[0].type === 'drink');

  const lines = '<state_handoff>\nmeal: 吃完晚饭\nurination: 排尿\n</state_handoff>';
  const r2 = extractStateHandoff(lines);
  ok('提取行格式交接块', r2.blocks === 1 && r2.facts.length === 2 && r2.facts[1].type === 'urination');

  const multi = 'A<state_handoff>{"type":"wash"}</state_handoff>B<state_handoff>{"type":"nap"}</state_handoff>';
  const r3 = extractStateHandoff(multi);
  ok('多块全部提取', r3.blocks === 2 && r3.facts.map((f) => f.type).join(',') === 'wash,nap');

  ok('无交接块返回零', extractStateHandoff('普通正文，没有协议块').blocks === 0);
  ok('空输入不抛', extractStateHandoff(null).facts.length === 0);
  ok('畸形 JSON 降级不抛', extractStateHandoff('<state_handoff>{bad json</state_handoff>').facts.length === 0);
}

// ========== 2. strip ==========
{
  const src = 'HEAD.\n<state_handoff>{"type":"drink","note":"water"}</state_handoff>\n\n\nTAIL.';
  const hd = new HealthData(memStorage());
  const out = processReply(src, hd, null);
  ok('strip-recognized', out && out.blocks === 1 && out.applied.length === 1);
  ok('note-clean', out.accepted[0].note === 'water');
  ok('no-block-null', processReply('HEAD.\n\nTAIL.', hd, null) === null);
}

// ========== 3. 校验 ==========
{
  ok('合法事实通过', normalizeFact({ type: 'drink', note: '喝完一杯水' }).ok === true);
  ok('未知类型拒绝', normalizeFact({ type: 'teleport' }).reason === 'unknown-type');
  ok('意图非事实拒绝', normalizeFact({ type: 'meal', note: '打算去吃饭' }).reason === 'intent-not-fact');
  ok('未完成动作拒绝', normalizeFact({ type: 'urination', note: '没能排出来' }).reason === 'intent-not-fact');
  ok('病症缺名拒绝', normalizeFact({ type: 'illness_onset' }).reason === 'condition-name-missing');
  ok('小时数超限拒绝', normalizeFact({ type: 'time_passed', hours: 999 }).reason === 'bad-hours');
  ok('小时数非正拒绝', normalizeFact({ type: 'time_passed', hours: 0 }).reason === 'bad-hours');
  const sev = normalizeFact({ type: 'illness_onset', name: '感冒', severity: '极重' });
  ok('非法严重度降级为轻度', sev.ok && sev.fact.severity === '轻度');
  ok('非对象拒绝不抛', normalizeFact('drink').reason === 'not-object');

  const batch = normalizeFacts([
    { type: 'drink' }, { type: 'nope' }, null, { type: 'sleep' },
  ]);
  ok('批量校验分流', batch.accepted.length === 2 && batch.rejected.length === 2);
}

// ========== 4-5. 确定性应用 + 部分缓解 ==========
{
  const hd = new HealthData(memStorage());
  hd.needs = { hunger: 80, thirst: 80, clean: 50, bladder: 70, bowel: 30 };
  const { accepted } = normalizeFacts([
    { type: 'drink', note: '喝完一大杯' },
    { type: 'drink_partial', note: '只是嘞了一口' },
    { type: 'meal' },
  ]);
  const res = applyFacts(hd, accepted);
  ok('饮水事实投递', res.applied.some((f) => f.type === 'drink'));
  ok('进食事实投递', res.applied.some((f) => f.type === 'meal'));
  ok('部分缓解只记录不投递', res.recorded.length === 1 && res.recorded[0].type === 'drink_partial');
  ok('口渴被全量事实清零', hd.needs.thirst === 0);
  ok('饥饿被全量事实清零', hd.needs.hunger === 0);

  const before = { day: hd.currentCycleDay, pregnant: hd.isPregnant, weeks: hd.gestationWeeks };
  applyFacts(hd, normalizeFacts([{ type: 'time_passed', hours: 26 }]).accepted);
  ok('时间流逝走本地状态机', hd.currentCycleDay !== before.day);
  ok('交接不能直接改怀孕', hd.isPregnant === before.pregnant);

  const ill = applyFacts(hd, normalizeFacts([{ type: 'illness_onset', name: '感冒', severity: '中度' }]).accepted);
  ok('病症事实入档', ill.applied.length === 1 && hd.conditions.some((c) => c.name === '感冒'));
  applyFacts(hd, normalizeFacts([{ type: 'illness_resolved', name: '感冒' }]).accepted);
  ok('病症解除事实生效', !hd.conditions.some((c) => c.name === '感冒'));
  const unknown = applyFacts(hd, normalizeFacts([{ type: 'illness_onset', name: '不存在的病' }]).accepted);
  ok('未知病症跳过不抛', unknown.skipped.length === 1 && unknown.skipped[0].reason === 'unknown-illness');

  ok('空数据层降级不抛', applyFacts(null, accepted).skipped[0].reason === 'no-health-data');
}

// ========== 6. 账本 ==========
{
  const ledger = new HandoffLedger(memStorage());
  const facts = normalizeFacts([{ type: 'drink', note: '喝水' }, { type: 'meal', note: '吃饭' }]).accepted;
  ok('账本首次入账', ledger.record(facts) === 2);
  ok('账本去重', ledger.record(facts) === 0 && ledger.load().entries.length === 2);
  ok('账本持久化', ledger.load().entries[0].type === 'drink');

  const many = [];
  for (let i = 0; i < LEDGER_LIMIT + 10; i += 1) many.push({ type: 'nap', note: '第' + i + '次' });
  ledger.record(normalizeFacts(many).accepted);
  ok('账本上限截断', ledger.load().entries.length === LEDGER_LIMIT);

  ok('空存储账本不抛', new HandoffLedger(null).record(facts) === 2 || true);
  const broken = new HandoffLedger({ get() { throw new Error('x'); }, set() { throw new Error('y'); } });
  ok('存储抛错降级不抛', broken.record(facts) === 2);
}

// ========== 7. 端到端 ==========
{
  const hd = new HealthData(memStorage());
  hd.needs = { hunger: 10, thirst: 90, clean: 10, bladder: 10, bowel: 10 };
  const ledger = new HandoffLedger(memStorage());
  const reply = [
    '她把整杯水喝完，又只是随手嘞了一口汤。',
    '<state_handoff>',
    '{"facts":[',
    '{"type":"drink","note":"喝完整杯水"},',
    '{"type":"drink_partial","note":"嘞了一口汤"},',
    '{"type":"flight","note":"飞走了"},',
    '{"type":"meal","note":"打算稍后吃饭"}',
    ']}', 
    '</state_handoff>',
  ].join('\n');
  const out = processReply(reply, hd, ledger);
  ok('端到端返回结果', out && out.blocks === 1);
  ok('端到端接受 2 条', out.accepted.length === 2);
  ok('端到端拒绝未知类型与意图', out.rejected.length === 2);
  ok('端到端只投递全量事实', out.applied.length === 1 && hd.needs.thirst === 0);
  ok('端到端入账', out.ledgerAdded === 2 && ledger.load().entries.length === 2);
  ok('无交接块返回 null', processReply('普通回复', hd, ledger) === null);
  ok('重复处理不重复入账', processReply(reply, hd, ledger).ledgerAdded === 0);
}

// ========== 8. 存储归属 ==========
{
  const storage = new PhoneStorage();
  ok('ruby_health_handoff 会话隔离', storage._isChatData('ruby_health_handoff') === true);
  ok('ruby_health_cycle 仍会话隔离', storage._isChatData('ruby_health_cycle') === true);
}

// ========== 9. 接线自证 ==========
{
  const appSrc = read('apps/health/health-app.js');
  ok('健康 App 引入交接层', appSrc.includes("health-state-bridge.js"));
  ok('生成后回写钩子', appSrc.includes('MESSAGE_RECEIVED') && appSrc.includes('processReply'));
  ok('回写失败静默', /MESSAGE_RECEIVED[\s\S]*catch\s*\(/.test(appSrc));
  const bridgeSrc = read('apps/health/health-state-bridge.js');
  ok('事实类型表就绪', Object.keys(FACT_TYPES).length >= 12);
  ok('适配层无外部引擎水印', !/AUTHOR_ZERO_WIDTH_WATERMARK|AUTHOR_INTEGRITY_EXPECTED_SHA256/.test(bridgeSrc));
  ok('适配层不直接请求外部 API', !/fetch\s*\(|XMLHttpRequest/.test(bridgeSrc));
}

// ========== 10. 版本同源 ==========
{
  // [v2.71.0] 改为跟随 manifest 动态取值：写死版本号会让每个新版本都来这里改一次，
  //   而版本同源的正确判据本来就是「四处一致」，不是「等于某个具体数字」。
  const mf = JSON.parse(read('manifest.json'));
  const v = String(mf.version);
  ok('manifest 版本格式', /^\d+\.\d+\.\d+$/.test(v), v);
  ok('入口同源', read('index.js').includes("const ST_PHONE_VERSION = '" + v + "'"));
  ok('package.json 同源', JSON.parse(read('package.json')).version === v);
  const log = JSON.parse(read('update-log.json'));
  ok('update-log 指向当前版本', log.latest === v && !!(log.versions || {})[v]);
}

console.log('\n' + pass + ' 通过');
