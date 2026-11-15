/* tests/system-v4153.test.mjs — R21-X5 通话与消息的「同一段对话」串联
 * 重点：直接导入真实内核，验证三态、四个归因面、跨天保守与纯读契约。
 * 断言读的是**返回值与副作用计数**，不是源码里有没有某句话。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    THREAD_STATES,
    BIND_REASONS,
    BIND_LIMITS,
    bindConversationThread,
    normalizeMessagePoint,
    normalizeCallPoint,
    topicOverlapOf,
    durationTextOf,
    conversationLine,
    dayKeyOf,
    conversationBinderSelfCheck
} from '../apps/phone/conversation-thread-binder.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const numeric = (value) => String(value).split('.').map((part) => Number(part) || 0)
    .reduce((acc, part, index) => acc + part / Math.pow(1000, index), 0);
/* 一份**同一天**的坐标系：2026-10-22 本地时刻（与内核 dayKeyOf 的本地口径一致）。 */
const at = (h, m) => new Date(2026, 9, 22, h, m, 0, 0).getTime();
const CALL = { id: 'c1', participant: '林昭', storyAt: at(15, 0), durationSec: 300, status: 'answered', text: '方案的事 明天给你答复' };
const MSGS = [
    { id: 'm1', chatId: 'chat-1', participant: '林昭', storyAt: at(14, 40), text: '方案我改了第三版 你看下行不行' },
    { id: 'm2', chatId: 'chat-1', participant: '林昭', storyAt: at(14, 45), text: '方案里那句我再想想 明天给你答复' }
];

test('v4153 A1. 归一：没有剧情时刻 / 没有身份一律丢弃，绝不回退墙钟', () => {
    assert.equal(normalizeMessagePoint({ id: 'm', storyAt: null, text: 'x' }), null, '无剧情时刻必须丢弃（不猜墙钟）');
    assert.equal(normalizeMessagePoint({ id: '', storyAt: at(10, 0) }), null, '无身份必须丢弃（无法回源）');
    assert.equal(normalizeMessagePoint({ id: 'm', storyAt: 'abc' }), null, '弱类型不认');
    assert.equal(normalizeCallPoint({ participant: '林昭', storyAt: 0 }), null, '0 不是合法时刻');
    assert.equal(normalizeCallPoint({ participant: '', storyAt: at(10, 0) }), null, '无对手方不认');
    const kept = normalizeMessagePoint({ id: 'm', chatId: 'c', participant: '林昭', storyAt: at(10, 0), text: ' hi ' });
    assert.equal(kept.text, 'hi', '文本必须去空白');
    const call = normalizeCallPoint({ participant: '林昭', storyAt: at(10, 0), durationSec: '120' });
    assert.equal(call.durationSec, 120, '时长走强口径归一');
    const badDur = normalizeCallPoint({ participant: '林昭', storyAt: at(10, 0), durationSec: '' });
    assert.equal(badDur.durationSec, 0, '空时长不得读成有效秒数');
});

test('v4153 A2. 三态互斥且由候选数唯一决定（0/1/多）', () => {
    const one = bindConversationThread(CALL, MSGS);
    assert.equal(one.state, THREAD_STATES.THREADED);
    assert.equal(one.reason, '');
    assert.equal(one.transcriptCount, 2, '唯一的候选 → 条数如实');
    assert.ok(one.candidate && one.candidate.chatId === 'chat-1');
    assert.equal(one.candidates.length, 1);

    const many = bindConversationThread(CALL, MSGS.concat([
        { id: 'm3', chatId: 'chat-2', participant: '林昭', storyAt: at(14, 50), text: '方案我看了 明天答复你' }
    ]));
    assert.equal(many.state, THREAD_STATES.AMBIGUOUS);
    assert.equal(many.reason, BIND_REASONS.MULTIPLE_CANDIDATES);
    assert.equal(many.candidates.length, 2, 'ambiguous 必须全列候选');
    assert.equal(many.candidate, null, 'ambiguous 不许替用户挑一个');

    const none = bindConversationThread(CALL, []);
    assert.equal(none.state, THREAD_STATES.STANDALONE);
    assert.equal(none.reason, BIND_REASONS.NO_MESSAGE_POINTS);
    /* 三态互不同形：每态至少有一格与另两态不同。 */
    const shapes = [one, many, none].map((r) => [r.state, r.transcriptCount, r.candidates.length].join('|'));
    assert.equal(new Set(shapes).size, 3, '三态形状必须互不同形');
});

test('v4153 A3. 跨天一律不串，且与「窗外」「不同人」分列归因', () => {
    /* 窗内跨天：当天 00:30 的通话 vs 前一日 23:50 的消息（相距 40 分钟）。 */
    const dayBefore = { id: 'c1d', participant: '林昭', storyAt: at(0, 30), durationSec: 300, status: 'answered', text: CALL.text };
    const priorMsgs = [{ id: 'm9', chatId: 'chat-1', participant: '林昭', storyAt: at(23, 50) - 86400000, text: '方案我改了第三版' }];
    const crossed = bindConversationThread(dayBefore, priorMsgs);
    assert.equal(crossed.state, THREAD_STATES.STANDALONE, '跨天必须不串（宁可保守）');
    assert.equal(crossed.reason, BIND_REASONS.OTHER_DAY);
    /* 窗外：同一批消息整体挪到 6 小时前。 */
    const far = bindConversationThread(CALL, MSGS.map((m) => Object.assign({}, m, { storyAt: at(9, 0) })));
    assert.equal(far.reason, BIND_REASONS.OUT_OF_WINDOW);
    /* 同窗不同人。 */
    const otherWho = bindConversationThread(CALL, MSGS.map((m) => Object.assign({}, m, { participant: '周柠' })));
    assert.equal(otherWho.reason, BIND_REASONS.OTHER_PARTICIPANT);
    /* 三种「没串上」必须三个不同归因 —— 处置完全不同。 */
    assert.equal(new Set([crossed.reason, far.reason, otherWho.reason]).size, 3, '四种没串上的原因不许压平成一态');
});

test('v4153 A4. 时间窗对称且窗口可显式指定（阈值走同一张表）', () => {
    assert.equal(BIND_LIMITS.windowMinutes, 90);
    const inside = bindConversationThread(CALL, [{ id: 'x', chatId: 'c', participant: '林昭', storyAt: at(15, 0) - 90 * 60000, text: CALL.text }]);
    assert.equal(inside.state, THREAD_STATES.THREADED, '边界上（正好 90 分钟）算窗内');
    const outside = bindConversationThread(CALL, [{ id: 'x', chatId: 'c', participant: '林昭', storyAt: at(15, 0) - 91 * 60000, text: CALL.text }]);
    assert.equal(outside.reason, BIND_REASONS.OUT_OF_WINDOW, '超出一分钟即窗外');
    /* 未来方向同样受窗约束（窗是对称的）。 */
    const future = bindConversationThread(CALL, [{ id: 'x', chatId: 'c', participant: '林昭', storyAt: at(16, 40), text: CALL.text }]);
    assert.equal(future.reason, BIND_REASONS.OUT_OF_WINDOW, '窗必须对称（未来方向也受约束）');
    const narrow = bindConversationThread(CALL, MSGS, { windowMinutes: 5 });
    assert.equal(narrow.reason, BIND_REASONS.OUT_OF_WINDOW, '显式窗口必须生效');
    const wide = bindConversationThread(CALL, MSGS, { windowMinutes: '60' });
    assert.equal(wide.state, THREAD_STATES.THREADED, '窗口走强口径归一（数字串合法）');
});

test('v4153 A5. 话题面：不可比与不比是两件事，绝不压平', () => {
    /* 手算：'方案我改了第三版' bigram = 方案/案我/我改/改了/了第/第三/三版；
     *       '方案里那句我再想想' bigram = 方案/案里/里那/那句/句我/我再/再想/想想；
     *       交集只有「方案」一条 —— 判据写 3 是首版自己算错，按真值改。 */
    assert.equal(topicOverlapOf('方案我改了第三版', '方案里那句我再想想'), 1, 'bigram 交集如实计数');
    assert.equal(topicOverlapOf('', '任意'), 0, '一侧空 ⇒ 0');
    assert.equal(topicOverlapOf('完全一样', '完全一样'), 3, '两侧同文本 ⇒ 全交集');
    /* 通话侧无文本 ⇒ 话题面**不可比**：不得据此拦下（否则没转写就永远串不上）。 */
    const noText = bindConversationThread(Object.assign({}, CALL, { text: '' }), MSGS);
    assert.equal(noText.state, THREAD_STATES.THREADED, '通话无文本时仍可串（话题面不可比不等于不重叠）');
    assert.equal(noText.topicComparable, false, '不可比必须如实标出');
    /* 两侧都有文本但话题不沾边 ⇒ 明确拦下，且归因与「没人」「窗外」分列。 */
    const offTopic = bindConversationThread(CALL, [
        { id: 'o1', chatId: 'chat-1', participant: '林昭', storyAt: at(14, 40), text: '天气不错 出去走走吗' }
    ]);
    assert.equal(offTopic.reason, BIND_REASONS.NO_TOPIC_OVERLAP, '话题无重叠必须归因');
    assert.equal(offTopic.topicComparable, true, '比过了就是比过了（与不可比不同形）');
    /* minTopicGrams 是显式旋钮：调到 2 时上面那条 3 交集仍过，调到 99 时全拦。 */
    assert.equal(bindConversationThread(CALL, MSGS, { minTopicGrams: 99 }).reason, BIND_REASONS.NO_TOPIC_OVERLAP);
    assert.equal(bindConversationThread(Object.assign({}, CALL, { text: '' }), MSGS, { minTopicGrams: 99 }).state,
        THREAD_STATES.THREADED, '不可比时 minTopicGrams 不参与（否则等于拿阈值当「没有就是不一样」）');
});

test('v4153 A6. 剧情钟读不出时整体不串，绝不回落现在', () => {
    const r = bindConversationThread({ id: 'c', participant: '林昭', storyAt: null }, MSGS);
    assert.equal(r.reason, BIND_REASONS.CALL_CLOCK_ABSENT);
    assert.equal(r.state, THREAD_STATES.STANDALONE);
    assert.equal(r.storyAt, null, '读不出就如实交 null');
    assert.equal(r.dayKey, null);
    const undef = bindConversationThread({ id: 'c', participant: '林昭' }, MSGS);
    assert.equal(undef.reason, BIND_REASONS.CALL_CLOCK_ABSENT, '缺字段与 null 同处置');
    const junk = bindConversationThread({ id: 'c', participant: '林昭', storyAt: '昨天' }, MSGS);
    assert.equal(junk.reason, BIND_REASONS.CALL_CLOCK_ABSENT, '弱类型不认，不当成有效时刻');
    /* 真实内核里不得出现「回落 Date.now」这一形态。 */
    const src = read('apps/phone/conversation-thread-binder.js');
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    assert.ok(!/storyAt\s*:\s*Date\.now\(\)/.test(code), '内核不得把读不出的时刻补成现在');
    assert.ok(!/\|\|\s*Date\.now\(\)/.test(code), '内核不得用 || Date.now() 兜底时刻');
});

test('v4153 A7. 严格纯读：零存储 import、零写路径，storage 调用计数为 0', () => {
    const src = read('apps/phone/conversation-thread-binder.js');
    assert.ok(!/from\s+['"][^'"]*storage[^'"]*['"]/.test(src), '内核不得 import 存储层');
    assert.ok(!/\.storage\b/.test(src), '内核不得持有 storage 句柄');
    const calls = { get: 0, set: 0, remove: 0 };
    const spy = {
        get() { calls.get += 1; return null; },
        set() { calls.set += 1; },
        remove() { calls.remove += 1; }
    };
    /* 真跑一遍全部分支面（含四个归因面），确认一次都没碰过宿主句柄。 */
    const probe = { storage: spy };
    bindConversationThread(CALL, MSGS);
    bindConversationThread(CALL, []);
    bindConversationThread({ id: 'c', participant: '林昭', storyAt: null }, MSGS);
    bindConversationThread(CALL, MSGS.map((m) => Object.assign({}, m, { storyAt: at(9, 0) })));
    bindConversationThread(CALL, MSGS.map((m) => Object.assign({}, m, { participant: '周柠' })));
    bindConversationThread(Object.assign({}, CALL, { text: '' }), MSGS);
    conversationLine(bindConversationThread(CALL, MSGS));
    const before = JSON.stringify(probe);
    assert.deepEqual(calls, { get: 0, set: 0, remove: 0 }, '纯读硬证据：storage 读写一次都没发生');
    assert.equal(JSON.stringify(probe), before, '宿主对象不得被改动');
    /* 输入对象也不得被就地改写（归一必须返回新对象）。 */
    const frozenMsg = Object.freeze({ id: 'm', chatId: 'c', participant: '林昭', storyAt: at(10, 0), text: 'x' });
    assert.doesNotThrow(() => bindConversationThread(CALL, [frozenMsg]), '归一不得就地改写入参');
});

test('v4153 A8. 读数行与时长文案各只有一份实现，且三态各自成型', () => {
    assert.equal(durationTextOf(300), '5分0秒');
    assert.equal(durationTextOf(45), '45秒');
    assert.equal(durationTextOf(0), '', '0 秒不编出一个读数');
    assert.equal(durationTextOf(''), '', '空值不得读成 0 秒文案');
    const one = conversationLine(bindConversationThread(CALL, MSGS));
    assert.match(one, /微信 2 条/);
    assert.match(one, /5分0秒/);
    const many = conversationLine(bindConversationThread(CALL, MSGS.concat([
        { id: 'm3', chatId: 'chat-2', participant: '林昭', storyAt: at(14, 50), text: '方案我看了 明天答复你' }
    ])));
    assert.match(many, /候选/);
    assert.match(many, /不替用户选/, '多候选必须写明不代挑');
    const none = conversationLine(bindConversationThread(CALL, []));
    assert.match(none, /独立一件事/);
    assert.equal(new Set([one, many, none]).size, 3, '三态读数必须三句不同的话');
});

test('v4153 A9. 候选全列不截断丢身份，且 ids 可回源', () => {
    const msgs = [];
    for (let i = 0; i < 6; i += 1) {
        msgs.push({ id: 'mA' + i, chatId: 'chat-1', participant: '林昭', storyAt: at(14, 30) + i * 60000, text: '方案第三版 明天给你答复' });
    }
    msgs.push({ id: 'mB0', chatId: 'chat-2', participant: '林昭', storyAt: at(14, 50), text: '方案第三版 明天答复你' });
    const r = bindConversationThread(CALL, msgs);
    assert.equal(r.state, THREAD_STATES.AMBIGUOUS);
    assert.equal(r.candidates.length, 2, '两个会话 ⇒ 两条候选（不按条数膨胀）');
    const byId = new Map(r.candidates.map((c) => [c.chatId, c]));
    assert.equal(byId.get('chat-1').transcriptCount, 6, '条数如实');
    assert.equal(byId.get('chat-1').ids.length, 6, 'ids 必须可回源');
    assert.ok(byId.get('chat-1').ids.includes('mA3'));
    assert.ok(byId.get('chat-1').from < byId.get('chat-1').to, '区间两端如实');
    /* 上限只截「候选条数」，不截身份。 */
    const capped = bindConversationThread(CALL, msgs, { maxCandidates: 1 });
    assert.equal(capped.candidates.length, 1, 'maxCandidates 生效');
    assert.equal(capped.state, THREAD_STATES.AMBIGUOUS, '截断不得把它降级成 threaded（否则等于替用户挑）');
});

test('v4153 A10. 产品侧真有调用方（不是建好没人喂）', () => {
    const view = read('apps/phone/phone-view.js');
    assert.match(view, /import\s*\{[^}]*bindConversationThread[^}]*\}\s*from\s*'\.\/conversation-thread-binder\.js'/, '视图未接线内核');
    assert.match(view, /bindConversationThread\(points\.call, points\.messages\)/, '视图未真调用串联判定');
    assert.match(view, /conversationLine\(bound\)/, '视图未消费读数行');
    assert.match(view, /stampOfCall\(record, null\)/, '通话时刻必须走 comm-time 唯一出口');
    assert.match(view, /phone-call-thread-row/, '详情页未渲染「本段交流」行');
    assert.match(view, /threadRowHtml/, '读数行未进详情页模板');
    assert.match(view, /_resolveWechatContact\(who\)/, '消息侧必须按联系人定位会话');
    assert.match(view, /storyTsOf\(\{ storyAt: m\.storyAt, timestamp: m\.timestamp \}\)/, '消息时刻必须走全仓唯一出口');
    /* 自检导出不得建好没人用：产品侧必须原样转发（与 comms-app 同款）。 */
    assert.match(view, /conversationThreadSelfCheck\(\)\s*\{\s*return conversationBinderSelfCheck\(\)/, '内核自检必须被产品侧真转发，不得零消费');
    /* 视图侧不得自己判态、不得自己造第二份窗口口径。 */
    assert.ok(!/windowMinutes\s*[:=]\s*\d+/.test(view), '视图不得自造第二份时间窗口');
    const css = read('phone.css');
    assert.ok(css.includes('.phone-call-thread-row'), '样式未落地');
});

test('v4153 A11. 内核自检与判据同源，正控必真', () => {
    const self = conversationBinderSelfCheck();
    assert.equal(self.ok, true, '内核自检必须全绿：' + JSON.stringify(self.problems));
    assert.equal(self.problems.length, 0);
    /* dayKeyOf 的本地口径：同一天同一键、隔天不同键。 */
    assert.equal(dayKeyOf(at(0, 5)), dayKeyOf(at(23, 55)), '同一天必须同键');
    assert.notEqual(dayKeyOf(at(0, 5)), dayKeyOf(at(0, 5) - 86400000), '隔天必须不同键');
    assert.equal(dayKeyOf(null), null, '读不出就是 null');
});

test('v4153 A12. 与 comm-thread 的分工：本件零写、不落账（对照台账仍由它持有）', () => {
    const src = read('apps/phone/conversation-thread-binder.js');
    /* 判据面必须基于**真代码**（本仓 E6 纪律）：散文里提到 comm-thread 是设计说明，
     *   不是口径合并。首版用裸词匹配，把注释里那一行读成了引用 —— 与 dead-export 门
     *   当年踩的「注释/字符串里的提及不算消费」是同一族，故这里同样先剥注释与字符串。 */
    const code = src
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '')
        .replace(/'(?:[^'\\]|\\.)*'/g, "''")
        .replace(/"(?:[^"\\]|\\.)*"/g, '""');
    assert.ok(!/comm-thread/.test(code), '两件不许互相引用（口径合并会带来「读一次写一次」的副作用）');
    assert.ok(!/writeThreads|openThread|appendPoint|storage/.test(code), '本件不得落账、不得持存储句柄');
    /* 对照：comm-thread 仍是写入型台账（它的写入口在场，未被本件取代）。 */
    const comm = read('config/comm-thread.js');
    assert.match(comm, /export function writeThreads/);
    assert.match(comm, /export function appendPoint/);
});

test('v4153 A13. 版本锚：五源同源且不低于 4.152.0（下限形）', () => {
    const pkg = JSON.parse(read('package.json'));
    const man = JSON.parse(read('manifest.json'));
    const ul = JSON.parse(read('update-log.json'));
    const idx = read('index.js');
    assert.equal(pkg.version, man.version, 'package 与 manifest 必须同源');
    assert.equal(ul.latest, pkg.version, 'update-log 的 latest 必须同源');
    assert.equal(ul.head, pkg.version, 'update-log 的 head 必须同源');
    assert.ok(Object.prototype.hasOwnProperty.call(ul.versions, pkg.version), '本版必须在版本表里');
    assert.ok(idx.includes("const ST_PHONE_VERSION = '" + pkg.version + "'"), 'index.js 版本常量必须同源');
    assert.ok(numeric(pkg.version) >= numeric('4.152.0'), '版本低于本版下限：' + pkg.version);
    assert.ok(Object.prototype.hasOwnProperty.call(ul.versions, '4.152.0'), '本版条目必须在版本表里');
    const items = ul.versions['4.152.0']?.items || [];
    assert.ok(items.some((it) => it.includes('R21-X5')), '本版公告必须点名 R21-X5');
    assert.ok(items.some((it) => it.includes('版本升至 4.152.0')), '本版公告必须带收口项');
});
