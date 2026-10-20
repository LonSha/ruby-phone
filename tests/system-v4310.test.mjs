/**
 * tests/system-v4310.test.mjs — [v4.31.0 · R5-O4] 生理状态交接：**事件级幂等**
 *
 * 验收口径（R5-O4 三条旅程，缺一条就不算做完）：
 *   ① 同一条消息被**重放**（同 eventKey）⇒ 不双计，且静默跳过（不是报错、不是悄悄再来一遍）；
 *   ② **不同消息**即使正文完全相同 ⇒ 各计一次（两件事，不是一件事）；
 *   ③ 中途失败（第二条事实抛错）后**重试** ⇒ 已成功的那条不重来，没成功的那条仍算待处置。
 *
 * 【本版治的缺陷形态（三条，都不报错）】
 *   ① 重放双计：同一条回复被宿主重放一次，「喝了一杯水」就被记成两杯 —— 数值悄悄翻倍；
 *   ② 跨消息误去重：两条不同楼层正文恰好一样（模板化回复），第二件真事被当成重复吞掉；
 *   ③ 「可重试」退化成「静默丢事实」：整条消息粒度做闸时，中途抛错后重试被判定为「已处理过」，
 *      失败的那条**永远不会再投递**，而界面显示一切正常。
 *   故本版把幂等下沉到**事件 + 事实**双层，且三条旅程在本套件里都是**可判的**。
 *
 * 判据面（五组）：
 *   A 事件身份：身份优先级 / 空值身份不当身份用 / 回落指纹如实标 identified:false /
 *              身份不含 swipe / 指纹纯算术且与事实顺序无关
 *   B 事件账：老数据迁移 / 事实账与事件账同键共存、**各自裁剪互不挤占** / settled 合并 / 上限
 *   C 三条旅程端到端（对真 HealthData 与真 PhoneStorage 各走一遍）
 *   D 负控制：真源码定点破坏 ⇒ 同款判据必转红（每条配原版必真的反向对照）
 *   E 接线与纯度：宿主传可证身份 / 适配层不请求外部 API / 无外部引擎水印 / 版本同源
 *
 * 【为什么负控制破坏副本而不是原仓】见 tests/system-v4120.test.mjs 档头（同规）。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

let pass = 0;
const ok = (name, cond, extra) => {
  assert.ok(cond, extra ? name + ' — ' + extra : name);
  pass += 1;
};

const bridge = await import('../apps/health/health-state-bridge.js');
const {
  BRIDGE_VERSION, LEDGER_LIMIT, LEDGER_EVENT_LIMIT, FACT_TYPES,
  extractStateHandoff, normalizeFacts, applyFacts, processReply,
  fingerprintOf, eventKeyOf, HandoffLedger,
} = bridge;
const { HealthData } = await import('../apps/health/health-data.js');
const { PhoneStorage } = await import('../config/storage.js');

function memStorage() {
  const bag = new Map();
  return {
    get: (k) => (bag.has(k) ? JSON.parse(JSON.stringify(bag.get(k))) : undefined),
    set: (k, v) => bag.set(k, JSON.parse(JSON.stringify(v))),
    _bag: bag,
  };
}
/** 投递桩：可指定「第一次推进时间时抛错」，用于旅程③。 */
function makeStub(opts = {}) {
  const s = {
    calls: [],
    throwOnceOnAdvance: opts.throwOnceOnAdvance === true,
    applyNeed(t) { s.calls.push('need:' + t); },
    advanceHours(h) {
      if (s.throwOnceOnAdvance) { s.throwOnceOnAdvance = false; throw new Error('advance-boom'); }
      s.calls.push('adv:' + h);
    },
    addCondition(n) { s.calls.push('cond:' + n); return { name: n }; },
    removeCondition(n) { s.calls.push('rm:' + n); },
  };
  return s;
}
const REPLY_ONE = '<state_handoff>{"facts":[{"type":"drink","note":"喝完一杯水"}]}</state_handoff>';
const REPLY_TWO = '<state_handoff>{"facts":[{"type":"drink","note":"喝完一杯水"},{"type":"time_passed","hours":3}]}</state_handoff>';

// ========== A. 事件身份 ==========
{
  const e1 = eventKeyOf({ eventKey: 'msg:12' }, 'x');
  ok('宿主给身份则用宿主身份', e1.key === 'msg:12' && e1.identified === true);
  const e2 = eventKeyOf({}, 'x');
  ok('宿主给不出身份回落指纹', e2.key === 'fp@x' && e2.identified === false);
  ok('空 eventKey 回落指纹', eventKeyOf({ eventKey: '' }, 'y').identified === false);
  // 宿主把空值拼进身份时**不得当身份用**：否则所有取不到 id 的消息共用一个身份、静默丢事实
  ok('msg:undefined 不当身份', eventKeyOf({ eventKey: 'msg:undefined' }, 'z').key === 'fp@z');
  ok('msg:null 不当身份', eventKeyOf({ eventKey: 'msg:null' }, 'z').identified === false);
  ok('msg:NaN 不当身份', eventKeyOf({ eventKey: 'msg:NaN' }, 'z').identified === false);
  ok('msg:0 仍是合法身份', eventKeyOf({ eventKey: 'msg:0' }, 'z').identified === true);
  ok('身份长度截断', eventKeyOf({ eventKey: 'm'.repeat(400) }, '').key.length === 120);
  ok('meta 畸形不抛', eventKeyOf(null, 'q').key === 'fp@q' && eventKeyOf('x', 'q').identified === false);
  // 身份里不含 swipe：重生成换 swipe，若算进身份会把同一条消息的两次生成当成两件事
  const a = eventKeyOf({ eventKey: 'msg:5', swipe: 0 }, '1');
  const b = eventKeyOf({ eventKey: 'msg:5', swipe: 3 }, '1');
  ok('身份不含 swipe', a.key === b.key);

  // 指纹：纯算术、与顺序无关、事实变了才变
  const f = normalizeFacts([{ type: 'drink', note: '水' }, { type: 'meal', note: '饭' }]).accepted;
  const g = normalizeFacts([{ type: 'meal', note: '饭' }, { type: 'drink', note: '水' }]).accepted;
  ok('指纹与事实顺序无关', fingerprintOf(f) === fingerprintOf(g));
  ok('指纹可复算（无随机无时钟）', fingerprintOf(f) === fingerprintOf(f));
  ok('事实变了指纹就变', fingerprintOf(f) !== fingerprintOf(normalizeFacts([{ type: 'drink', note: '水' }]).accepted));
  ok('空事实指纹稳定', fingerprintOf([]) === fingerprintOf([]));
  ok('指纹格式可读', /^fp[0-9a-f]+:\d+:\d+$/.test(fingerprintOf(f)), fingerprintOf(f));
}

// ========== B. 事件账 ==========
{
  // 老数据迁移：只有 entries、没有 events
  const st = memStorage();
  st.set('ruby_health_handoff', { version: '2', entries: [{ key: 'drink|||', type: 'drink', label: '饮水' }] });
  const lg = new HandoffLedger(st);
  const loaded = lg.load();
  ok('老账本迁移补 events', Array.isArray(loaded.events) && loaded.events.length === 0);
  ok('老账本不丢事实', loaded.entries.length === 1);
  ok('空键查询返回 null', lg.eventOf('') === null && lg.eventOf(null) === null);
  ok('未登记事件返回 null', lg.eventOf('msg:404') === null);

  const st2 = memStorage();
  const lg2 = new HandoffLedger(st2);
  const facts = normalizeFacts([{ type: 'drink', note: '一杯' }, { type: 'drink_partial', note: '一口' }]).accepted;
  const added1 = lg2.record(facts, { source: 'chat' }, { eventKey: 'msg:1' });
  ok('首次登记全部入账', added1 === 2 && lg2.load().entries.length === 2);
  const ev1 = lg2.eventOf('msg:1');
  ok('事件痕迹落账', ev1 && ev1.key === 'msg:1' && ev1.identified === true && ev1.rows === 2);
  ok('settled 记下已处置事实', ev1.settled.length === 2);

  // 同事件重放：不重复入账、settled 不膨胀
  const added2 = lg2.record(facts, {}, { eventKey: 'msg:1', settled: ev1.settled });
  ok('重放不重复入账', added2 === 0 && lg2.load().entries.length === 2);
  ok('重放不新增事件行', lg2.load().events.length === 1);

  // 事实粒度：只补未处置的那条（用干净账本，避免被事实账去重掩盖）
  const lg2b = new HandoffLedger(memStorage());
  const added3 = lg2b.record(facts, {}, { eventKey: 'msg:1', settled: [ev1.settled[0]] });
  ok('事实粒度只补未处置', added3 === 1 && lg2b.load().entries.length === 1);
  ok('事实粒度 settled 只记本次处置', lg2b.eventOf('msg:1').settled.length === 1);

  // held：投递失败的既不入账、也不算已处置
  const st3 = memStorage();
  const lg3 = new HandoffLedger(st3);
  const two = normalizeFacts([{ type: 'drink', note: 'a' }, { type: 'meal', note: 'b' }]).accepted;
  lg3.record(two, {}, { eventKey: 'msg:9', held: ['meal||b|'] });
  const ev3 = lg3.eventOf('msg:9');
  ok('held 不入事实账', lg3.load().entries.length === 1 && lg3.load().entries[0].type === 'drink');
  ok('held 不算已处置', ev3.settled.length === 1 && ev3.settled[0] === 'drink||a|');

  // 回落身份的账：identified 如实为 false，不假装按事件去重
  const st4 = memStorage();
  const lg4 = new HandoffLedger(st4);
  const fpKey = eventKeyOf({}, fingerprintOf(two)).key;
  lg4.record(two, {}, { eventKey: fpKey });
  ok('回落身份事件标 identified:false', lg4.eventOf(fpKey).identified === false);

  // 双账各自裁剪、互不挤占（旧实现只有一个数组，上限一到会把「这件事发生过」一起裁掉）
  const st5 = memStorage();
  const lg5 = new HandoffLedger(st5);
  const many = [];
  for (let i = 0; i < LEDGER_LIMIT + 15; i += 1) many.push({ type: 'drink', note: 'n' + i });
  lg5.record(many, {}, { eventKey: 'msg:big' });
  const s5 = lg5.load();
  ok('事实账受 LEDGER_LIMIT 裁剪', s5.entries.length === LEDGER_LIMIT);
  ok('事件账不被事实账挤掉', s5.events.length === 1 && s5.events[0].key === 'msg:big');
  ok('事件账上限独立', LEDGER_EVENT_LIMIT === 50 && LEDGER_LIMIT === 50);

  const st6 = memStorage();
  const lg6 = new HandoffLedger(st6);
  for (let i = 0; i < LEDGER_EVENT_LIMIT + 12; i += 1) {
    lg6.record([{ type: 'drink', note: 'e' + i }], {}, { eventKey: 'msg:' + i });
  }
  ok('事件账受 LEDGER_EVENT_LIMIT 裁剪', lg6.load().events.length === LEDGER_EVENT_LIMIT);
  ok('裁剪保留最近的事件', lg6.eventOf('msg:' + (LEDGER_EVENT_LIMIT + 11)) !== null);

  // 只读不抛：存储抛错也不外抛
  const boom = { get() { throw new Error('x'); }, set() { throw new Error('y'); } };
  const lg7 = new HandoffLedger(boom);
  ok('存储抛错降级不抛', lg7.load().entries.length === 0);
  ok('写入抛错不阻断', (() => { try { lg7.record([{ type: 'drink' }], {}, { eventKey: 'k' }); return true; } catch (e) { return false; } })());
}

// ========== C. 三条旅程（真 HealthData + 真账本） ==========
{
  // 会话归属：账本键必须是按会话隔离的（跨会话不共用事件账，否则 A 会话的事会挡掉 B 会话的事）
  ok('账本键按会话隔离', new PhoneStorage()._isChatData('ruby_health_handoff') === true);
  // ① 重放不双计
  const hd = new HealthData(memStorage());
  const lg = new HandoffLedger(memStorage());
  const r1 = processReply(REPLY_ONE, hd, lg, { eventKey: 'msg:1', source: 'chat' });
  const thirstAfterFirst = hd.needs.thirst;
  const r2 = processReply(REPLY_ONE, hd, lg, { eventKey: 'msg:1', source: 'chat' });
  ok('旅程①首次生效', r1.applied.length === 1 && r1.duplicate === false);
  ok('旅程①重放静默跳过', r2.applied.length === 0 && r2.duplicate === true);
  ok('旅程①重放不改状态', hd.needs.thirst === thirstAfterFirst);
  ok('旅程①重放不新增账', r2.ledgerAdded === 0 && lg.load().entries.length === 1);
  ok('旅程①重放报出身份', r2.identified === true && r2.eventKey === 'msg:1');

  // ② 不同消息同文各计一次
  const hd2 = new HealthData(memStorage());
  const lg2 = new HandoffLedger(memStorage());
  const a1 = processReply(REPLY_ONE, hd2, lg2, { eventKey: 'msg:1' });
  const a2 = processReply(REPLY_ONE, hd2, lg2, { eventKey: 'msg:2' });
  ok('旅程②两条消息都生效', a1.applied.length === 1 && a2.applied.length === 1);
  ok('旅程②都算真事不判重复', a2.duplicate === false && a2.deferred === 0);
  // 事实账按**内容**去重（v2.70 起既定语义：同类型+同说明只留一行），
  //   所以「各计一次」的判据落在**投递次数**与**事件账行数**上，不在事实账行数上。
  ok('旅程②事件账各记一行', lg2.load().events.length === 2);
  ok('旅程②事实账仍按内容去重', lg2.load().entries.length === 1);
  ok('旅程②同文同指纹', a1.eventKey !== a2.eventKey && fingerprintOf(a1.accepted) === fingerprintOf(a2.accepted));

  // ③ 中途失败后重试：成功的不重来、失败的仍待处置
  const stub = makeStub({ throwOnceOnAdvance: true });
  const lg3 = new HandoffLedger(memStorage());
  const b1 = processReply(REPLY_TWO, stub, lg3, { eventKey: 'msg:7' });
  ok('旅程③第一条已投递', b1.applied.length === 1 && b1.applied[0].type === 'drink');
  ok('旅程③第二条进 held', b1.held.length === 1 && b1.held[0] === 'time_passed|||3');
  ok('旅程③失败的不算已处置', lg3.eventOf('msg:7').settled.length === 1);
  ok('旅程③失败的没入事实账', lg3.load().entries.length === 1);
  ok('旅程③首次不算重复', b1.duplicate === false);
  const b2 = processReply(REPLY_TWO, stub, lg3, { eventKey: 'msg:7' });
  ok('旅程③重试只补失败的那条', b2.applied.length === 1 && b2.applied[0].type === 'time_passed');
  ok('旅程③成功过的不重来', stub.calls.filter((c) => c === 'need:drink').length === 1);
  ok('旅程③重试补投成功', stub.calls.filter((c) => c === 'adv:3').length === 1);
  ok('旅程③重试后全部处置', lg3.eventOf('msg:7').settled.length === 2 && lg3.load().entries.length === 2);
  const b3 = processReply(REPLY_TWO, stub, lg3, { eventKey: 'msg:7' });
  ok('旅程③再重放彻底静默', b3.duplicate === true && b3.applied.length === 0 && stub.calls.length === 2);

  // ③' 没有数据层时：全部 held，重试能补上（不是静默丢）
  const lg4 = new HandoffLedger(memStorage());
  const c1 = processReply(REPLY_ONE, null, lg4, { eventKey: 'msg:8' });
  ok('无数据层全进 held', c1.held.length === 1 && lg4.load().entries.length === 0);
  const stub2 = makeStub();
  const c2 = processReply(REPLY_ONE, stub2, lg4, { eventKey: 'msg:8' });
  ok('无数据层后重试补投', c2.applied.length === 1 && stub2.calls.length === 1);

  // 身份缺失时如实回落：不假装按事件去重
  const lg5 = new HandoffLedger(memStorage());
  const d1 = processReply(REPLY_ONE, makeStub(), lg5, {});
  ok('无身份回落指纹', d1.identified === false && /^fp@/.test(d1.eventKey));
  const d2 = processReply(REPLY_ONE, makeStub(), lg5, {});
  ok('无身份重放仍幂等', d2.duplicate === true && d2.applied.length === 0);

  // 旧调用点（三参）语义不变
  const hdOld = new HealthData(memStorage());
  const old1 = processReply(REPLY_ONE, hdOld, new HandoffLedger(memStorage()));
  ok('三参调用语义不变', old1.applied.length === 1 && old1.ledgerAdded === 1);
  ok('无交接块仍返回 null', processReply('普通回复', hdOld, new HandoffLedger(memStorage()), { eventKey: 'msg:1' }) === null);
  // 拒绝面不受幂等影响：意图非事实照样拒绝、且不产生事件
  const lgR = new HandoffLedger(memStorage());
  const rj = processReply('<state_handoff>{"facts":[{"type":"meal","note":"打算去吃饭"}]}</state_handoff>', makeStub(), lgR, { eventKey: 'msg:r' });
  ok('意图仍被拒且不落事件', rj.rejected.length === 1 && lgR.load().events.length === 0);
}

// ========== D. 负控制（真源码定点破坏 ⇒ 同款判据必转红） ==========
{
  const src = read('apps/health/health-state-bridge.js');
  const depUrl = pathToFileURL(path.join(root, 'config/json-symbol-repair.js')).href;
  const loadBroken = async (from, to) => {
    const hits = src.split(from).length - 1;
    assert.equal(hits, 1, '锚点必须恰好命中一次: ' + from);
    const broken = src.replace(from, to).split("'../../config/json-symbol-repair.js'").join(JSON.stringify(depUrl));
    return import('data:text/javascript;base64,' + Buffer.from(broken, 'utf8').toString('base64'));
  };
  const replayApplied = (mod) => {
    const hd = makeStub();
    const lg = new mod.HandoffLedger(memStorage());
    mod.processReply(REPLY_ONE, hd, lg, { eventKey: 'msg:1' });
    return mod.processReply(REPLY_ONE, hd, lg, { eventKey: 'msg:1' }).applied.length;
  };
  const retryApplied = (mod) => {
    const hd = makeStub({ throwOnceOnAdvance: true });
    const lg = new mod.HandoffLedger(memStorage());
    mod.processReply(REPLY_TWO, hd, lg, { eventKey: 'msg:7' });
    return mod.processReply(REPLY_TWO, hd, lg, { eventKey: 'msg:7' }).applied.length;
  };

  // 反向对照：原版同款判据必须为真，否则下面的「转红」没有意义
  ok('原版：重放零投递', replayApplied(bridge) === 0);
  ok('原版：重试补投一条', retryApplied(bridge) === 1);

  // D1 拆掉应用前幂等闸（pending 恒等于全部事实）⇒ 重放必然双计
  const noGate = await loadBroken(
    'const pending = accepted.filter((f) => !settledSet.has(factKey(f || {})));',
    'const pending = accepted.slice();',
  );
  ok('负控制 D1：无闸则重放双计', replayApplied(noGate) > 0, String(replayApplied(noGate)));
  ok('负控制 D1：原版不双计', replayApplied(bridge) === 0);

  // D2 让 held 失效（失败的那条被当成已处置）⇒ 重试再也补不上
  const noHeld = await loadBroken('ledger.record(pending, meta, { eventKey, settled, held: heldKeys });', 'ledger.record(pending, meta, { eventKey, settled, held: [] });');
  ok('负控制 D2：held 失效则重试丢事实', retryApplied(noHeld) === 0, String(retryApplied(noHeld)));
  ok('负控制 D2：原版重试补得上', retryApplied(bridge) === 1);

  // D3 拆掉空值身份判据 ⇒ msg:undefined 被当成可证身份（不同消息共用一个身份）
  const loose = await loadBroken('if (given && !/:(?:undefined|null|NaN)$/.test(given))', 'if (given)');
  ok('负控制 D3：无判据则空值身份被采信', loose.eventKeyOf({ eventKey: 'msg:undefined' }, 'fp@x').identified === true);
  ok('负控制 D3：原版不采信', eventKeyOf({ eventKey: 'msg:undefined' }, 'fp@x').identified === false);

  // D4 事件账与事实账合并回一个数组（旧形态）⇒ 事实账满会挤掉事件痕迹
  const merged = await loadBroken('if (state.events.length > LEDGER_EVENT_LIMIT) {', 'if (false) {');
  const lgM = new merged.HandoffLedger(memStorage());
  for (let i = 0; i < 60; i += 1) lgM.record([{ type: 'drink', note: 'z' + i }], {}, { eventKey: 'msg:' + i });
  ok('负控制 D4：无上限则事件账膨胀', lgM.load().events.length > 50, String(lgM.load().events.length));
  const lgO = new HandoffLedger(memStorage());
  for (let i = 0; i < 60; i += 1) lgO.record([{ type: 'drink', note: 'z' + i }], {}, { eventKey: 'msg:' + i });
  ok('负控制 D4：原版受上限约束', lgO.load().events.length === 50);
}

// ========== E. 接线与纯度 ==========
{
  const appSrc = read('apps/health/health-app.js');
  ok('接线：宿主传可证身份', appSrc.includes("'msg:' + messageId"));
  ok('接线：身份与来源一并下传', /processReply\(text, this\.data, ledger, \{ eventKey, source: 'chat' \}\)/.test(appSrc));
  ok('接线：身份不含 swipe', !/eventKey[^\n]*swipe/.test(appSrc));
  ok('接线：回写失败静默', /MESSAGE_RECEIVED[\s\S]*catch\s*\(/.test(appSrc));

  const bridgeSrc = read('apps/health/health-state-bridge.js');
  ok('适配层四参签名', /export function processReply\(text, healthData, ledger, meta = \{\}\)/.test(bridgeSrc));
  ok('适配层有应用前幂等闸', bridgeSrc.includes('eventOf(eventKey)') && bridgeSrc.includes('duplicate'));
  ok('事实类型表就绪', Object.keys(FACT_TYPES).length >= 12);
  ok('适配层无外部引擎水印', !/AUTHOR_ZERO_WIDTH_WATERMARK|AUTHOR_INTEGRITY_EXPECTED_SHA256/.test(bridgeSrc));
  ok('适配层不直接请求外部 API', !/fetch\s*\(|XMLHttpRequest/.test(bridgeSrc));
  ok('适配层不写生理数值（只投递事件）', !/needs\.\w+\s*=[^=]/.test(bridgeSrc) && !/isPregnant\s*=[^=]/.test(bridgeSrc));
  ok('桥接版本号在场', BRIDGE_VERSION === '2');
}

// ========== F. 版本同源 ==========
{
  const mf = JSON.parse(read('manifest.json'));
  const v = String(mf.version);
  ok('manifest 版本格式', /^\d+\.\d+\.\d+$/.test(v), v);
  ok('入口同源', read('index.js').includes("const ST_PHONE_VERSION = '" + v + "'"));
  ok('package.json 同源', JSON.parse(read('package.json')).version === v);
  const log = JSON.parse(read('update-log.json'));
  ok('update-log 指向当前版本', log.latest === v && !!(log.versions || {})[v]);
}

console.log('\n' + pass + ' 通过');
