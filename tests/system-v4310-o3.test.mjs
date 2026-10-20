/**
 * tests/system-v4310-o3.test.mjs — [v4.31.0 · R5-O3] 群聊投票：**同群多张票不串议题、不串轮次**
 *
 * 验收口径（R5-O3 计划原文）：
 *   `readings` 遍历整群、保留**首个**问题、**合并所有选项**、取**最大** round ——
 *   于是同群里两张同时开放的票被混成「第一题的两个选项」，计票结果张冠李戴。
 *
 * 【本版治的缺陷形态（三条，都不报错）】
 *   ① 串议题：同群两张票（周一午餐/面、周五郊游/公园）被读成一题四项，领先项与支持者全错；
 *   ② 串轮次：两票各自的 round 取最大值，第二轮的那张把第一轮那张一起抬成第二轮；
 *   ③ 串确认史：活动只按「选项 + 参与名单」派生 id，两票同选项同参与人时**会撞**，
 *      于是「确认过 A 票」在 B 票的卡上显示成已确认。
 *   故本版给每张票一个稳定 `pollId`，选项 / 表态 / 活动 / 轮次一律**按票归属**，
 *   归属只走可证边界，判不了就如实进 `unattributed*`（**不按名字猜、不并入第一张票**）。
 *
 * 判据面（七组）：
 *   A 票身份：显式 ID 优先 / 无 ID 按消息 id 稳定派生 / 都没有 ⇒ 空串 / 截断 / 逐票列举
 *   B 逐票读数：问题、轮次、选项、表态、活动各归各票；兼容面取第一张；指名不存在的票如实 pollFound=false
 *   C 归属边界：同名选项不猜（unattributed + poll-ambiguous）/ 显式票号归得对 /
 *              无票号活动在单票群归它、多票群如实不归 / 带票号活动只进那张票
 *   D 三条旅程：退出重开仍定位同一票 / 删掉一票不抹另一票 / 改票只影响本票
 *   E 单票群零回归：既有旧消息（无 pollId）行为逐字不变
 *   F 负控制：真源码定点破坏 ⇒ 同款判据必转红（每组配原版必真的反向对照）
 *   G 接线与纯度：视图只认接线件出口 / 票号算法只许一份 / 不写盘、不请求网络
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
const WIRE = await import('../apps/wechat/group-vote.js');
const { GroupVote } = WIRE;

/* ── 合成数据面（零真实聊天 / 零存储 / 零网络） ── */
const MEMBERS = [{ id: 'c1', name: '甲' }, { id: 'c2', name: '乙' }, { id: 'c3', name: '丙' }];
/* ★ 假数据层按 chatId 分流（'g1' 之外读到空面）：否则「消息不在该群」这条判据
 *   量到的是「假件忽略了群号」，而不是被测代码的归属逻辑（第一版正是这么打偏的）。 */
const mkData = (msgs) => ({
  getMessages: (chatId) => (!chatId || chatId === 'g1' ? msgs : []),
  getGroupMembers: () => MEMBERS,
  getUserInfo: () => ({ name: '我' }),
  addMessage: (_id, m) => { msgs.push(m); }
});
const poll = (id, q, opts, round) => ({
  id: id, from: 'system', type: 'group_vote', content: '[群投票]',
  groupVote: { question: q, round: round || 1, options: opts.map((l) => ({ id: l, label: l, kind: 'other' })) }
});
const say = (id, memberId, option, choice) => ({
  id: id, from: 'c', type: 'group_vote_statement', content: '[投票]',
  groupVote: { memberId: memberId, optionId: option, choice: choice }
});
const sayP = (id, memberId, option, choice, pollId) => ({
  id: id, from: 'c', type: 'group_vote_statement', content: '[投票]',
  groupVote: { memberId: memberId, optionId: option, choice: choice, pollId: pollId }
});

// ========== A. 票身份 ==========
{
  const w = new GroupVote({ wechatData: mkData([]) });
  ok('A1 显式票号优先于消息 id', w.pollIdOf({ id: 'm1' }, { pollId: 'poll@explicit' }) === 'poll@explicit');
  ok('A2 无显式票号 ⇒ 按消息 id 稳定派生', w.pollIdOf({ id: 'm1' }, {}) === 'poll@m1');
  ok('A3 两者都没有 ⇒ 空串（不并入第一张票）', w.pollIdOf({}, {}) === '');
  ok('A3b id 为空串也算没有', w.pollIdOf({ id: '  ' }, {}) === '');
  const longId = 'x'.repeat(200);
  ok('A4 票号截断到 80 以内', w.pollIdOf({ id: longId }, {}).length <= 80, String(w.pollIdOf({ id: longId }, {}).length));
  ok('A5 显式票号也走同一截断', w.pollIdOf({}, { pollId: longId }).length <= 80);
  // 无数据层：各出口如实降级，不抛
  const naked = new GroupVote({});
  ok('A6 无数据层 ⇒ pollIds 空数组', Array.isArray(naked.pollIds('g1')) && naked.pollIds('g1').length === 0);
  ok('A6b 无数据层 ⇒ pollIdOfMessage 空串', naked.pollIdOfMessage('g1', 'p1') === '');
  ok('A6c 空消息 id ⇒ 空串', w.pollIdOfMessage('g1', '') === '');
  ok('A6d 认不出的消息 id ⇒ 空串（不抛）', w.pollIdOfMessage('g1', 'nope') === '');
}
{
  const data = mkData([poll('p1', '周一午餐', ['面', '饭']), poll('p2', '周五郊游', ['公园']),
    poll('p3', '周日读书', ['线上'])]);
  const w = new GroupVote({ wechatData: data });
  const ids = w.pollIds('g1');
  ok('A7 逐票列举按出现顺序', ids.join(',') === 'poll@p1,poll@p2,poll@p3', ids.join(','));
  ok('A7b 票数正确（不再混成一张）', ids.length === 3, String(ids.length));
  ok('A8 按消息 id 取票号', w.pollIdOfMessage('g1', 'p2') === 'poll@p2');
  ok('A8b 消息不在该群 ⇒ 空串', w.pollIdOfMessage('g2', 'p2') === '');
}

// ========== B. 逐票读数（不串议题、不串轮次、不串选项） ==========
{
  const data = mkData([
    poll('p1', '周一午餐', ['面', '饭']),
    poll('p2', '周五郊游', ['公园', '影院']),
    say('s1', 'c1', '面', 'support'),
    say('s2', 'c2', '公园', 'support')
  ]);
  const w = new GroupVote({ wechatData: data });
  const a = w.tally('g1', { pollId: 'poll@p1' });
  const b = w.tally('g1', { pollId: 'poll@p2' });
  ok('B1 两张票各自的问题不串', a.question === '周一午餐' && b.question === '周五郊游', a.question + ' / ' + b.question);
  ok('B2 每张票选项数各为 2（不合并）', a.tally.length === 2 && b.tally.length === 2, a.tally.length + ' / ' + b.tally.length);
  ok('B3 第一张票里不出现第二张票的选项', a.tally.map((r) => r.label).join(',') === '面,饭', a.tally.map((r) => r.label).join(','));
  ok('B3b 第二张票里不出现第一张票的选项', b.tally.map((r) => r.label).join(',') === '公园,影院', b.tally.map((r) => r.label).join(','));
  ok('B4 两票各自的领先项正确', a.leader === '面' && b.leader === '公园', a.leader + ' / ' + b.leader);
  ok('B5 支持者各归各票', a.participants.filter((x) => x.optionId === '面')[0].members.join() === '甲'
    && b.participants.filter((x) => x.optionId === '公园')[0].members.join() === '乙');
  const compat = w.readings('g1');
  ok('B6 兼容面（不传票号）取第一张票', compat.options.map((o) => o.id).join(',') === '面,饭', compat.options.map((o) => o.id).join(','));
  ok('B6b 兼容面逐票分列仍在', compat.polls.length === 2, String(compat.polls.length));
  ok('B6c 兼容面票号字段如实', compat.pollId === 'poll@p1' && compat.pollFound === true, compat.pollId);
  const r = w.readings('g1', 'poll@none');
  ok('B7 指名不存在的票 ⇒ pollFound=false', r.pollFound === false);
  ok('B7b 不拿别的票顶上来冒充', r.statements.length === 0 && r.options.length === 0);
  ok('B8 读不出 ⇒ no-options（不是 empty）', w.tally('g1', { pollId: 'poll@none' }).state === 'no-options',
    w.tally('g1', { pollId: 'poll@none' }).state);
}
{
  const data = mkData([
    poll('p1', '周一午餐', ['面', '饭'], 2),
    poll('p2', '周五郊游', ['公园', '影院'], 1)
  ]);
  const w = new GroupVote({ wechatData: data });
  const a = w.tally('g1', { pollId: 'poll@p1' });
  const b = w.tally('g1', { pollId: 'poll@p2' });
  ok('B9 轮次按票各算（不取最大）', a.round === 2 && b.round === 1, a.round + ' / ' + b.round);
  ok('B9b 兼容面轮次取第一张票的轮次', w.tally('g1').round === 2, String(w.tally('g1').round));
}
{
  const data = mkData([
    poll('p1', '周一午餐', ['面'], 1),
    poll('p2', '周五郊游', ['公园'], 3)
  ]);
  const w = new GroupVote({ wechatData: data });
  ok('B10 兼容面不因他票第三轮被抬成三轮', w.tally('g1').round === 1, String(w.tally('g1').round));
}

// ========== C. 归属边界（判不了就不归） ==========
{
  const data = mkData([
    poll('p1', '周一午餐', ['面', '饭']),
    poll('p2', '周五午餐', ['面', '粥']),
    say('s1', 'c1', '面', 'support')
  ]);
  const w = new GroupVote({ wechatData: data });
  const r = w.readings('g1');
  ok('C1 同名选项命中多票 ⇒ 计入 unattributed', r.unattributedStatements.length === 1, String(r.unattributedStatements.length));
  ok('C1b 归因如实报 poll-ambiguous', r.unattributedStatements[0].why === 'poll-ambiguous', r.unattributedStatements[0].why);
  ok('C1c 不猜归属：两票都不算这条', w.tally('g1', { pollId: 'poll@p1' }).state === 'empty'
    && w.tally('g1', { pollId: 'poll@p2' }).state === 'empty');
  ok('C1d 两票支持数都是 0', w.tally('g1', { pollId: 'poll@p1' }).tally.every((x) => x.support === 0)
    && w.tally('g1', { pollId: 'poll@p2' }).tally.every((x) => x.support === 0));
}
{
  const data = mkData([
    poll('p1', '周一午餐', ['面', '饭']),
    poll('p2', '周五午餐', ['面', '粥']),
    sayP('s1', 'c1', '面', 'support', 'poll@p1'),
    sayP('s2', 'c2', '面', 'support', 'poll@p2')
  ]);
  const w = new GroupVote({ wechatData: data });
  ok('C2 带票号的表态不再判不了', w.readings('g1').unattributedStatements.length === 0);
  ok('C2b 同名选项各归各票（A）', w.tally('g1', { pollId: 'poll@p1' }).tally.filter((x) => x.optionId === '面')[0].support === 1);
  ok('C2c 同名选项各归各票（B）', w.tally('g1', { pollId: 'poll@p2' }).tally.filter((x) => x.optionId === '面')[0].support === 1);
  ok('C2d 支持者不串（甲 / 乙）',
    w.tally('g1', { pollId: 'poll@p1' }).participants.filter((x) => x.optionId === '面')[0].members.join() === '甲'
    && w.tally('g1', { pollId: 'poll@p2' }).participants.filter((x) => x.optionId === '面')[0].members.join() === '乙');
}
{
  // 显式指名一张**不存在**的票：不并入别的票
  const data = mkData([
    poll('p1', '周一午餐', ['面']),
    poll('p2', '周五郊游', ['公园']),
    sayP('s1', 'c1', '面', 'support', 'poll@ghost')
  ]);
  const w = new GroupVote({ wechatData: data });
  const r = w.readings('g1');
  ok('C3 指名不存在的票 ⇒ 不并入第一张票', w.tally('g1', { pollId: 'poll@p1' }).state === 'empty',
    w.tally('g1', { pollId: 'poll@p1' }).state);
  ok('C3b 该条如实进 unattributed', r.unattributedStatements.length === 1, String(r.unattributedStatements.length));
}
{
  const act = { id: 'a1', optionId: '面', label: '面', round: 1, participants: ['甲'] };
  const one = mkData([poll('p1', '周一午餐', ['面']), sayP('s1', 'c1', '面', 'support', 'poll@p1')]);
  const w1 = new GroupVote({ wechatData: one });
  const c1 = w1.confirm('g1', '面', 'poll@p1');
  ok('C4 确认把票号写进活动', c1.ok === true && c1.activity.pollId === 'poll@p1', String(c1.activity && c1.activity.pollId));
  const many = mkData([poll('p1', '周一午餐', ['面']), poll('p2', '周五郊游', ['公园']),
    { id: 'x', type: 'group_vote_activity', groupVoteActivity: act, content: 'x' }]);
  const w2 = new GroupVote({ wechatData: many });
  ok('C5 多票群无票号活动 ⇒ 如实不归', w2.readings('g1').unattributedActivities.length === 1, String(w2.readings('g1').unattributedActivities.length));
  const many2 = mkData([poll('p1', '周一午餐', ['面']), poll('p2', '周五郊游', ['公园']),
    { id: 'x', type: 'group_vote_activity', groupVoteActivity: Object.assign({}, act, { pollId: 'poll@p2' }), content: 'x' }]);
  const w3 = new GroupVote({ wechatData: many2 });
  ok('C5b 带票号的活动归得对（不归 unattributed）', w3.readings('g1').unattributedActivities.length === 0);
  ok('C5c 活动只进它那张票', w3.readings('g1', 'poll@p2').activities.length === 1);
  ok('C5d 别的票看不到这条活动', w3.readings('g1', 'poll@p1').activities.length === 0);
}

// ========== D. 三条旅程 ==========
{
  const msgs = [poll('p1', '周一午餐', ['面', '饭']), poll('p2', '周五郊游', ['公园']),
    sayP('s1', 'c1', '面', 'support', 'poll@p1')];
  const first = new GroupVote({ wechatData: mkData(msgs.slice()) });
  const second = new GroupVote({ wechatData: mkData(msgs.slice()) });
  ok('D1 退出重开票号一致', first.pollIds('g1').join(',') === second.pollIds('g1').join(','), first.pollIds('g1').join(','));
  ok('D1b 重开后同一票的领先项一致',
    first.tally('g1', { pollId: 'poll@p1' }).leader === second.tally('g1', { pollId: 'poll@p1' }).leader);
  const kept = msgs.filter((m) => String(m.id) !== 'p2');
  const w2 = new GroupVote({ wechatData: mkData(kept) });
  const before = first.tally('g1', { pollId: 'poll@p1' });
  const after = w2.tally('g1', { pollId: 'poll@p1' });
  ok('D2 删另一票后本票读数不变', before.leader === after.leader && before.tally.length === after.tally.length);
  ok('D2b 只剩一张票', w2.pollIds('g1').join(',') === 'poll@p1', w2.pollIds('g1').join(','));
}
{
  const data = mkData([
    poll('p1', '周一午餐', ['面', '饭'], 2),
    poll('p2', '周五郊游', ['公园', '影院'], 1),
    sayP('s1', 'c1', '面', 'support', 'poll@p1'),
    sayP('s2', 'c1', '面', 'oppose', 'poll@p1')
  ]);
  const w = new GroupVote({ wechatData: data });
  const aRow = w.tally('g1', { pollId: 'poll@p1' }).tally.filter((x) => x.optionId === '面')[0];
  ok('D3 改票只认最后一条', aRow.support === 0 && aRow.oppose === 1, '支持 ' + aRow.support + ' 反对 ' + aRow.oppose);
  ok('D3b 改票不影响别票', w.tally('g1', { pollId: 'poll@p2' }).state === 'empty');
}

// ========== E. 单票群零回归 ==========
{
  const data = mkData([
    poll('m1', '周末去哪', ['周六下午', '周日晚上'], 2),
    say('e1', 'c1', '周六下午', 'support'),
    say('e2', 'c2', '周六下午', 'support'),
    say('e3', 'c3', '周日晚上', 'oppose')
  ]);
  const w = new GroupVote({ wechatData: data });
  const t = w.tally('g1');
  ok('E1 单票群问题与轮次不变', t.question === '周末去哪' && t.round === 2, t.question + ' / ' + t.round);
  ok('E2 单票群领先项与判定不变', t.leader === '周六下午' && t.verdict === 'decided', t.leader + ' / ' + t.verdict);
  ok('E3 单票群选项数不变', t.tally.length === 2, String(t.tally.length));
  ok('E4 单票群参与名单不变', t.participants.filter((p) => p.optionId === '周六下午')[0].members.join('、') === '甲、乙');
  ok('E5 单票群零 unattributed（旧消息零改动）',
    w.readings('g1').unattributedStatements.length === 0 && w.readings('g1').unattributedActivities.length === 0);
  const act = w.confirm('g1', '周六下午');
  ok('E6 单票群不传票号确认语义不变', act.ok === true && act.activity && act.activity.pollId === undefined,
    String(act.activity && act.activity.pollId));
}

// ========== F. 负控制（真源码定点破坏 ⇒ 同款判据必转红） ==========
{
  const src = read('apps/wechat/group-vote.js');
  const contractUrl = pathToFileURL(path.join(root, 'config/group-vote-contract.js')).href;
  const numGateUrl = pathToFileURL(path.join(root, 'config/num-gate.js')).href;
  const loadBroken = async (from, to) => {
    const hits = src.split(from).length - 1;
    assert.equal(hits, 1, '锚点必须恰好命中一次: ' + from);
    const broken = src.replace(from, to)
      .split("'../../config/group-vote-contract.js'").join(JSON.stringify(contractUrl))
      .split("'../../config/num-gate.js'").join(JSON.stringify(numGateUrl));
    return import('data:text/javascript;base64,' + Buffer.from(broken, 'utf8').toString('base64'));
  };
  /* 破坏版上的同款判据（读的是「两张票是否被混成一题」） */
  /* ★ 读**兼容面**（不传票号 ⇒ 第一张票的选项）：破坏版下指名 'poll@p1' 会如实
   *   报「不存在」（那本身是正确行为），拿它去比「混没混」量到的不是本件事。
   *   兼容面在原版读第一张票、在「不派生票号」的破坏版读**唯一那个合并桶**，
   *   两边同款判据 —— 这正是修前「两票混成一题」的读数。 */
  const mixedQuestion = (mod) => {
    const data = mkData([poll('p1', '周一午餐', ['面', '饭']), poll('p2', '周五郊游', ['公园', '影院']),
      say('s1', 'c1', '面', 'support'), say('s2', 'c2', '公园', 'support')]);
    const w = new mod.GroupVote({ wechatData: data });
    return w.readings('g1').options.map((o) => o.id).join(',');
  };
  const ambiguousKept = (mod) => {
    const data = mkData([poll('p1', '周一午餐', ['面', '饭']), poll('p2', '周五午餐', ['面', '粥']),
      say('s1', 'c1', '面', 'support')]);
    const w = new mod.GroupVote({ wechatData: data });
    return w.readings('g1').unattributedStatements.length;
  };
  const otherPollSees = (mod) => {
    const act = { id: 'a1', optionId: '面', label: '面', round: 1, participants: ['甲'] };
    const data = mkData([poll('p1', '周一午餐', ['面']), poll('p2', '周五郊游', ['公园']),
      { id: 'x', type: 'group_vote_activity', groupVoteActivity: Object.assign({}, act, { pollId: 'poll@p2' }), content: 'x' }]);
    const w = new mod.GroupVote({ wechatData: data });
    return w.readings('g1', 'poll@p1').activities.length;
  };
  // 反向对照：原版同款判据必须为真，否则下面的「转红」没有意义
  ok('F0 原版：第一张票只有自己的选项', mixedQuestion(WIRE) === '面,饭', mixedQuestion(WIRE));
  ok('F0b 原版：同名选项如实不归', ambiguousKept(WIRE) === 1, String(ambiguousKept(WIRE)));
  ok('F0c 原版：别票看不到这条活动', otherPollSees(WIRE) === 0, String(otherPollSees(WIRE)));

  // F1 拆掉按消息 id 派生票号 ⇒ 整群票落进同一个空桶（修前形态：两票混成一题）
  const noDerive = await loadBroken("if (msgId) return ('poll@' + msgId).slice(0, 80);", "if (msgId) return '';");
  ok('负控制 F1：不派生票号则两票混成一题', mixedQuestion(noDerive) === '面,饭,公园,影院', mixedQuestion(noDerive));
  ok('负控制 F1：原版不混', mixedQuestion(WIRE) === '面,饭');

  // F2 同名选项命中多票时按名字猜（取第一张）⇒ unattributed 消失、票被张冠李戴
  const guess = await loadBroken('if (hits.length > 1) return null;', 'if (hits.length > 1) return hits[0];');
  ok('负控制 F2：按名字猜则 unattributed 消失', ambiguousKept(guess) === 0, String(ambiguousKept(guess)));
  ok('负控制 F2：原版如实不归', ambiguousKept(WIRE) === 1);

  // F3 活动归属退回「总归第一张票」⇒ 别票看到不属于它的确认史
  const actLoose = await loadBroken(
    'const owner = actPoll ? (byPoll.get(actPoll) || null) : (polls.length === 1 ? polls[0] : null);',
    'const owner = polls.length ? polls[0] : null;',
  );
  ok('负控制 F3：活动总归第一张票则串确认史', otherPollSees(actLoose) === 1, String(otherPollSees(actLoose)));
  ok('负控制 F3：原版不串', otherPollSees(WIRE) === 0);
}

// ========== G. 接线与纯度 ==========
{
  const wireSrc = read('apps/wechat/group-vote.js');
  const viewSrc = read('apps/wechat/chat-view.js');
  const appSrc = read('apps/wechat/wechat-app.js');
  ok('G1 接线件有逐票列举出口', /pollIds\s*\(chatId\)/.test(wireSrc));
  ok('G2 接线件有按消息取票号出口', /pollIdOfMessage\s*\(chatId,\s*messageId\)/.test(wireSrc));
  ok('G3 App 层三个出口在场',
    /votePollIds\s*\(/.test(appSrc) && /votePollIdOfMessage\s*\(/.test(appSrc) && /voteConfirm\s*\(chatId,\s*optionId,\s*pollId\)/.test(appSrc));
  ok('G4 视图把票号写进按钮（data-poll-id）', /data-poll-id="\$\{this\._escapeHtml\(pollId\)\}"/.test(viewSrc));
  ok('G5 视图把票号带下确认口', /confirmGroupVote\(btn\.dataset\.pollId \|\| ''\)/.test(viewSrc));
  ok('G6 票号派生只许接线件一份（视图不写第二份派生规则）',
    (viewSrc.match(/['"]poll@['"]\s*\+/g) || []).length === 0,
    '视图里的 poll@ 拼接次数: ' + (viewSrc.match(/['"]poll@['"]\s*\+/g) || []).length);
  /* 票号缓存键含票号：同一次渲染里两张票各取各的（共用一格会把后一张读数顶掉前一张） */
  ok('G7 读数缓存键含票号', /_votePackCached\(chatId, msgs, pollId\)/.test(viewSrc)
    && /list\.length \+ '\|' \+ last \+ '\|' \+ pid/.test(viewSrc));
  ok('G8 本件不请求外部 API', !/fetch\s*\(|XMLHttpRequest|axios/.test(wireSrc));
  ok('G9 本件不直接写盘（只经数据层）', !/localStorage|indexedDB|PhoneStorage/.test(wireSrc));
  ok('G10 无外部引擎水印', !/LonShaMemory|window\.top|parent\.document/.test(wireSrc));
  ok('G11 本版出口与消息类别常量仍只此一份', /GV_MESSAGE_KINDS/.test(wireSrc)
    && /GV_MESSAGE_KINDS/.test(viewSrc) === false);
}

console.log('system-v4310-o3: pass=' + pass);
