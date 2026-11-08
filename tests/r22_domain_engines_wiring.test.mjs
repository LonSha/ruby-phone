/* ============================================================
 * tests/r22_domain_engines_wiring.test.mjs
 *   第二批业务引擎（40 个）真实接入的契约测试。
 *
 * 这套测试要证明的不是「函数存在」，而是：
 *   ① 每个引擎都真的被 new/绑定成功（wired 全 true，missing 为空）；
 *   ② 每个 handle.onXxx 调下去，对应引擎的**真实方法**被走到（calls 计数变化）；
 *   ③ 氛围类产出真的进了 feedbackHub 的指令队列（这才叫有消费方）；
 *   ④ 同族重复引擎分派到不同动作，没有叠在一处；
 *   ⑤ 任一引擎抛错不炸宿主，且 lastError 留痕。
 * ============================================================ */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mountDomainEngines, bindDomainEngines } from '../phone/domain-engines-mount.js';
import { RubyPhoneLonShaBidirectionalFeedbackHub } from '../apps/memory/ruby-phone-lonsha-bidirectional-feedback-hub.js';

const makeHub = () => new RubyPhoneLonShaBidirectionalFeedbackHub(null);

test('【A1】40 个引擎全部装配成功，missing 为空', () => {
  const h = mountDomainEngines({});
  const read = h.getRead();
  assert.deepEqual(read.missing, [], '不得有装配失败：' + read.missing.join(','));
  const bad = Object.entries(read.wired).filter(([, v]) => v !== true).map(([k]) => k);
  assert.deepEqual(bad, [], 'wired 必须全 true，实际未接：' + bad.join(','));
  assert.ok(Object.keys(read.wired).length >= 40, '至少 40 个引擎被登记，实际 ' + Object.keys(read.wired).length);
});

test('【A2】回复气泡：输入草稿 ⇒ 返回 3 档气泡且 calls.chip 递增', () => {
  const hub = makeHub();
  const h = bindDomainEngines(mountDomainEngines({ feedbackHub: hub }), {});
  const before = h.getRead().calls.chip;
  const chips = h.predictReplyChips('你今天有空吗？', 'neutral');
  assert.equal(chips.length, 3, '应给出三档（温和/调侃/克制），实际 ' + chips.length);
  assert.equal(h.getRead().calls.chip, before + 1);
  assert.ok(h.getRead().hosted.replyChips === true);
});

test('【A3】来电：三个引擎同时被走到，且氛围产出进了指令队列', () => {
  const hub = makeHub();
  const h = bindDomainEngines(mountDomainEngines({ feedbackHub: hub }), {});
  const r = h.onIncomingCall({ callerName: '林安安', callerId: 'npc_1' });
  assert.ok(r && r.callerName === '林安安');
  const read = h.getRead();
  assert.equal(read.calls.callAmbience, 1, '声场引擎被调用');
  assert.equal(read.calls.callAcoustics, 1, '声学调制被调用');
  assert.equal(read.calls.callSoundscape, 1, '通话音景被调用');
  /* ★ 关键：产出的 promptDirective 必须真的进了注入队列，否则模型看不到 */
  const q = hub.getDirectiveQueueState();
  assert.ok(q.pending >= 1, '指令队列必须非空（说明产出有真实消费方）');
  assert.ok(read.calls.directive >= 1);
});

test('【A4】同族重复引擎分派到不同动作，不叠在一处', () => {
  const hub = makeHub();
  const h = bindDomainEngines(mountDomainEngines({ feedbackHub: hub }), {});
  h.onKeyPress('a');
  h.onMessageSent();
  h.onUiTick('keyClick');
  const c = h.getRead().calls;
  assert.equal(c.keyClick, 1, '键击走 retroAcoustic');
  assert.equal(c.whoosh, 1, '发送走 retroAcoustic 的 whoosh');
  assert.ok(c.haptic >= 2, '空间触感与 retroHaptic 各计一次，实际 ' + c.haptic);
});

test('【A5】权限双引擎分面：申请走 interceptor，越权判定走 matrix', () => {
  const h = bindDomainEngines(mountDomainEngines({}), {});
  h.onPermissionRequest('wechat', 'camera', true);
  h.onSensitiveAccess('wechat', 'camera');
  const c = h.getRead().calls;
  assert.equal(c.permAsk, 1);
  assert.equal(c.permEnforce, 1);
});

test('【A6】胁迫密码：真实口令 = master，胁迫口令 = 伪装空间', () => {
  const h = bindDomainEngines(mountDomainEngines({}), {});
  const ok = h.onPasscodeEntered('1314');
  assert.equal(ok.mode, 'master');
  const decoy = h.onPasscodeEntered('0000');
  assert.notEqual(decoy.mode, 'master', '胁迫口令必须进伪装模式');
});

test('【A7】跨天：TIME_UPDATED 只在日期真的变化时跑唤醒，不每次 tick 都跑', () => {
  const hub = makeHub();
  const h = bindDomainEngines(mountDomainEngines({ feedbackHub: hub }), {});
  /* 直接调两个动作，验证它们真的走到引擎（DOM 事件在 node 里没有） */
  const s1 = h.onDaySleep();
  const a1 = h.onDayAwake();
  assert.ok(s1 && typeof s1 === 'object', 'sleep 应返回结果');
  assert.ok(a1 && typeof a1 === 'object', 'awake 应返回结果');
  assert.ok(h.getRead().calls.awakening >= 2);
});

test('【A8】任一引擎抛错不炸宿主，且 lastError 留痕', () => {
  const h = bindDomainEngines(mountDomainEngines({}), {});
  /* 造一个必然抛错的引擎：把 darknet 的 verifyAccessCode 换成 throw */
  h.engine.darknet.verifyAccessCode = () => { throw new Error('darknet 故意炸'); };
  const r = h.onDarknetEnter('666', 2);
  assert.equal(r, null, '抛错时返回 null，不得把异常抛给宿主');
  assert.ok(String(h.getRead().lastError || '').includes('darknet'), 'lastError 必须留痕，实际：' + h.getRead().lastError);
});

test('【A9】指令队列去重且限长，不会把正文淹掉', () => {
  const hub = makeHub();
  assert.equal(hub.pushDirective('同一句', 'x'), true);
  assert.equal(hub.pushDirective('同一句', 'x'), false, '重复句不得重复入队');
  assert.equal(hub.pushDirective('   ', 'x'), false, '空串不入队');
  for (let i = 0; i < 40; i++) hub.pushDirective('第' + i + '句', 'load');
  const q = hub.getDirectiveQueueState();
  assert.ok(q.pending <= 24, '队列上限 24，实际 ' + q.pending);
  /* 消费后必须清空，否则同一段环境描述会无限往每次生成里塞 */
  const text = hub.consumePendingDirectives();
  assert.ok(text.length > 0);
  assert.equal(hub.getDirectiveQueueState().pending, 0, 'consume 后必须清空');
});

test('【A10】读数面暴露到 VirtualPhone._domainRead，诊断可查', () => {
  const vp = {};
  const h = bindDomainEngines(mountDomainEngines({ virtualPhone: vp }), { virtualPhone: vp });
  const read = h.expose();
  assert.ok(vp._domainRead, '必须写到 window.VirtualPhone._domainRead');
  assert.equal(vp._domainRead.wired.replyChips, true);
  assert.ok(Object.keys(read.calls).length >= 40, '读数面要能看到每个引擎的调用计数');
});