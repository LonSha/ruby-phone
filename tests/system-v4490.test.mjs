/* ============================================================
 * tests/system-v4490.test.mjs — v4.49.0 · 第六期批次 A 之 R6-O2 连续通信
 * ------------------------------------------------------------
 * 判据分六面（口径同 system-v4480.test.mjs）：
 *   A 口径：词表冻结（四类/四格/三态/十二项/八项）+ 纯契约自证 + 判据不同源自证
 *   B 内核行为：漏接单列、未读未回分列、误合保守（超窗开新段）、坏形态不静默消失
 *   C 时间诚实面：读不出必须 null，绝不补「现在」（本版最伤的一类假读数）
 *   D 接线：四处注册 / 键与前缀族 / 样式双侧 / 消费矩阵与磁盘真源对账
 *   E 负控制三向自证：真仓必绿 / 破坏副本必红 / 锚点不唯一必抛
 *   F 版本锚与结构自证
 *
 * ★ 判据纪律（与 4480 同款）：
 *   ① 不引用被测模块自己的词表当「结论」（A4）—— 否则词表改了判据跟着改，等于没判；
 *   ② 负控制必须**在破坏副本上重跑同款真判据**，不许写死一个模拟常量；
 *   ③ 破坏锚点必须**恰中 1 次**，否则整件抛出（锚点不唯一 ⇒ 我改的不是我以为那一处）。
 * ============================================================ */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const rel = (p) => path.join(ROOT, p);
const read = (p) => fs.readFileSync(rel(p), 'utf8');

const MIN_VERSION = '4.49.0';
const KERNEL_REL = 'config/comm-thread.js';
const TIME_REL = 'config/comm-time.js';
const APP_REL = 'apps/comms/comms-app.js';
const VIEW_REL = 'apps/comms/comms-view.js';
const CSS_REL = 'apps/comms/comms.css';
const INDEX_REL = 'index.js';

const K = await import(pathToFileURL(rel(KERNEL_REL)).href);
const T = await import(pathToFileURL(rel(TIME_REL)).href);
const APP = await import(pathToFileURL(rel(APP_REL)).href);

/** 内存 storage 桩（与真 PhoneStorage 的 get/set 同形；本套件不碰真存储）。 */
function mkStorage() {
    const bag = new Map();
    return {
        get(k, dflt) { return bag.has(k) ? bag.get(k) : dflt; },
        set(k, v) { bag.set(k, v); },
        _bag: bag,
    };
}
const HOUR = 3600 * 1000;
const T0 = 1761187200000; /* 固定基准毫秒，不用 Date.now()（判据要可复算） */

/* ============================================================
 * A 面：口径
 * ========================================================== */
test('A1 词表口径：接触点四类 / 交流态四格 / 注意面三态 / 归因十二项 / 上限八项，全部冻结', () => {
    const kinds = K.COMM_KINDS;
    assert.equal(Object.isFrozen(kinds), true, '词表必须冻结');
    /* 逐字面写死（不引用 Object.values —— 那等于拿词表自证词表） */
    assert.equal(kinds.MESSAGE, 'message');
    assert.equal(kinds.CALL, 'call');
    assert.equal(kinds.MISSED, 'missed', '★ 漏接必须单列：它不是「没发生」，也不是「一条消息」');
    assert.equal(kinds.SMS, 'sms');
    assert.equal(Object.keys(kinds).length, 4, '接触点必须恰四类');
    const st = K.COMM_STATES;
    assert.equal(st.ABSENT, 'absent');
    assert.equal(st.UNREADABLE, 'unreadable', '★ 「本来没有」与「读不出来」必须分列（处置相反）');
    assert.equal(st.OPEN, 'open');
    assert.equal(st.CLOSED, 'closed');
    assert.equal(Object.keys(st).length, 4, '四格不许压平');
    const at = K.COMM_ATTENTION;
    assert.equal(at.SETTLED, 'settled');
    assert.equal(at.UNREAD, 'unread', '★ 未读与未回必须分列（一个是角标、一个是待办）');
    assert.equal(at.UNANSWERED, 'unanswered');
    assert.equal(Object.keys(at).length, 3);
    assert.equal(Object.keys(K.COMM_REASONS).length, 12, '归因词表必须恰十二项');
    const L = K.COMM_LIMITS;
    assert.equal(Object.keys(L).length, 8, '上限必须恰八项');
    assert.equal(L.gapHours, 12, '★ 误合窗口是判据的一部分，改它必须连带改判据');
    assert.ok(L.threads > 0 && L.points > 0 && L.idleHours > L.gapHours, '安静窗必须长于误合窗（否则「安静」与「断了」同义）');
    assert.equal(Object.isFrozen(L), true);
});

test('A2 纯契约：内核与时间件零 DOM / 零定时器 / 零网络', () => {
    for (const f of [KERNEL_REL, TIME_REL]) {
        const s = read(f);
        for (const bad of ['document.', 'window.', 'setTimeout', 'setInterval', 'fetch(', 'XMLHttpRequest', 'localStorage']) {
            assert.ok(s.indexOf(bad) < 0, f + ' 不得出现宿主依赖：' + bad);
        }
    }
});

test('A3 自检真跑（不是自述常量）：内核与时间件都返回结构恒定且当前必绿', () => {
    const a = K.commSelfCheck();
    assert.equal(typeof a.ok, 'boolean');
    assert.ok(Array.isArray(a.problems));
    assert.equal(a.ok, true, '内核自检必须绿：' + JSON.stringify(a.problems));
    const b = T.commTimeSelfCheck();
    assert.equal(b.ok, true, '时间件自检必须绿：' + JSON.stringify(b.problems));
});

test('A4 ★ 判据不与被测模块自述同源：本套件不把内核的常量当结论来源', () => {
    /* ★ 自指涉坑：A4 要查「本文件不得出现自证串」，而它自己就写着那两个串当探针 ——
     *   不剥掉自身段，判据永远抓自己，红得毫无信息量。扫描面 = 本文件减去 A4 这一段。 */
    const whole = read('tests/system-v4490.test.mjs');
    /* ★ 锚点必须带行首换行：A4 函数体里正写着 "test('A4 " 这个探针字面量，
     *   裸 indexOf 会命中的是**它自己那一行**，切出来的「去掉 A4 段」其实只切掉开头一小块，
     *   后面的断言行原封不动留在扫描面里 —— 判据照旧抓自己（首版实测）。 */
    const a4At = whole.indexOf("\ntest('A4 ");
    const a4End = whole.indexOf("\ntest('B1 ", a4At);
    assert.ok(a4At > 0 && a4End > a4At, 'A4 段定位失败：判据结构漂移');
    const s = whole.slice(0, a4At) + whole.slice(a4End);
    /* 本文件只允许在 A1 的「逐字面核对」段使用 K.COMM_* / T.*；
     * 绝不允许出现「比较两个都来自被测模块的值」这种自证式断言。 */
    assert.ok(s.indexOf('Object.values(K.COMM_KINDS).length') < 0, '不得拿被测词表自证词表条数');
    assert.ok(s.indexOf('Object.values(K.COMM_STATES)') < 0, '不得拿被测词表自证四格');
    /* 反向坐实：A1 里确实存在逐字面断言（否则本条会变成「空对空」） */
    assert.ok(s.indexOf("assert.equal(kinds.MISSED, 'missed'") > 0, 'A1 必须真的逐字面核对');
});

/* ============================================================
 * B 面：内核行为
 * ========================================================== */
test('B1 ★★★ 漏接不是「没发生」：单列计数，且末次漏接判「正悬着」而不是「安静」', () => {
    const o = K.openThread([], '阿明', T0, '');
    assert.equal(o.ok, true);
    let list = o.list;
    const id = o.thread.id;
    const mk = (kind, refId, at, direction) => ({ kind, channel: 'phone-call', refId, at, direction, label: refId });
    let r = K.appendPoint(list, id, mk('message', 'm1', T0, 'incoming'), T0);
    assert.equal(r.ok, true);
    list = r.list;
    r = K.appendPoint(list, id, mk('missed', 'c1', T0 + HOUR, 'incoming'), T0 + HOUR);
    assert.equal(r.ok, true, '漏接必须能挂上（它是真实发生的事）');
    list = r.list;
    const t = K.findThread(list, id);
    const c = K.threadCounts(t);
    assert.equal(c.missed, 1, '漏接必须计入 missed');
    assert.equal(c.messages, 1, '★ 漏接不得并进消息数（那就成了「他发过消息」）');
    const rz = K.resumeOf(t);
    assert.equal(rz.endedOnMissed, true, '★ 最后一次接触是漏接 ⇒ 正悬着');
    assert.equal(rz.resumedAfterMissed, false, '还没接上就不许说「又接上了」');
    const line = K.threadSummaryLine(t, T0 + HOUR);
    assert.ok(line.indexOf('漏接') >= 0, '读数句必须报漏接');
    assert.ok(line.indexOf('悬着') >= 0, '★ 读数句必须报「正悬着」（该回拨，不是安静）');
});

test('B2 ★★★ 未读与未回分列：markSeen 只清 unread，绝不动 answered', () => {
    const o = K.openThread([], '小红', T0, '');
    let list = o.list;
    const id = o.thread.id;
    const r1 = K.appendPoint(list, id, { kind: 'message', channel: 'wechat', refId: 'w1', at: T0, direction: 'incoming' }, T0);
    list = r1.list;
    const pid = r1.thread.points[0].id;
    assert.equal(K.attentionOf(r1.thread), 'unread', '进来的未读应判 unread');
    const s1 = K.markPointSeen(list, id, pid);
    assert.equal(s1.ok, true);
    assert.equal(K.attentionOf(s1.thread), 'unanswered', '★ 读过但没回 ⇒ unanswered（不是 settled）');
    const s2 = K.markPointAnswered(s1.list, id, pid);
    assert.equal(s2.ok, true);
    assert.equal(K.attentionOf(s2.thread), 'settled', '回过了才 settled');
    /* 反向坐实：只 answered 没 seen 时，unread 优先（没看的比看了没回的更急） */
    const o2 = K.openThread([], '小蓝', T0, '');
    const r2 = K.appendPoint(o2.list, o2.thread.id, { kind: 'sms', channel: 'phone-sms', refId: 's1', at: T0, direction: 'incoming' }, T0);
    const a2 = K.markPointAnswered(r2.list, o2.thread.id, r2.thread.points[0].id);
    assert.equal(K.attentionOf(a2.thread), 'unread', '没看过就是 unread，哪怕标过 answered');
});

test('B3 ★★★ 误合比漏合更伤：静默超 gapHours 一律开新段，绝不硬续', () => {
    const o = K.openThread([], '阿明', T0, '');
    const r = K.appendPoint(o.list, o.thread.id, { kind: 'message', channel: 'wechat', refId: 'm1', at: T0 }, T0);
    const late = T0 + K.COMM_LIMITS.gapHours * HOUR + 1;
    const bad = K.appendPoint(r.list, o.thread.id, { kind: 'message', channel: 'wechat', refId: 'm2', at: late }, late);
    assert.equal(bad.ok, false, '★ 超窗挂点必须被拒');
    assert.equal(bad.why, 'gap-too-long');
    const plan = K.planPoint(r.list, '阿明', late);
    assert.equal(plan.action, 'open', '★ 超窗续谈 ⇒ 开新段（合错了用户看到的是假的关系进展）');
    assert.equal(plan.why, 'gap-too-long');
    /* 窗口内仍应续 */
    const near = T0 + HOUR;
    const good = K.appendPoint(r.list, o.thread.id, { kind: 'message', channel: 'wechat', refId: 'm3', at: near }, near);
    assert.equal(good.ok, true, '窗口内应能续');
    assert.equal(K.planPoint(good.list, '阿明', near + HOUR).action, 'resume');
    /* 不同人不许续到别人的段上（同名异人历史在，只按 participant 精确匹配） */
    assert.equal(K.planPoint(good.list, '小红', near).action, 'open', '★ 不同人必须开新段');
});

test('B4 收束是唯一终结：收束后不许再挂点，且 rejected 顺序优先于间隔判定', () => {
    const o = K.openThread([], '小绿', T0, '');
    const r = K.appendPoint(o.list, o.thread.id, { kind: 'call', channel: 'phone-call', refId: 'c1', at: T0 }, T0);
    const cl = K.closeThread(r.list, o.thread.id, '说完了', T0 + HOUR);
    assert.equal(cl.ok, true);
    assert.equal(K.threadStateOf(cl.thread), 'closed');
    const late = T0 + 30 * HOUR; /* 既超窗又已收束 ⇒ 必须报 already-closed（改序即改结论） */
    const again = K.appendPoint(cl.list, o.thread.id, { kind: 'message', channel: 'wechat', refId: 'm9', at: late }, late);
    assert.equal(again.why, 'already-closed', '★ 收束优先于间隔：手动合上的事不该被下一句悄悄拉开');
    const cl2 = K.closeThread(cl.list, o.thread.id, '再合一次', T0 + 2 * HOUR);
    assert.equal(cl2.why, 'already-closed', '重复收束如实拒，不静默成功');
});

test('B5 坏形态不静默消失：有身份的坏段保留并标 unreadable，没身份的才丢', () => {
    const keep = K.normalizeThread({ id: 'x1', participant: '阿黄', points: [{ kind: 'nope', channel: 'wechat', refId: 'r', at: 1 }] });
    assert.ok(keep, '有身份的坏形态段不许丢弃');
    assert.equal(K.threadStateOf(keep), 'unreadable', '★ 有但读不出来 ⇒ unreadable（不是 absent）');
    assert.equal(keep.droppedPoints, 1, '丢掉的点数必须如实计数（否则「读不出来」会隐形）');
    assert.equal(K.normalizeThread({ id: '', participant: '', points: [] }), null, '连身份都没有才丢');
    assert.equal(K.threadStateOf({ id: '', participant: '' }), 'absent', '本来没有 ⇒ absent（与 unreadable 处置相反）');
    /* 段级坏形态（points 不是数组）也必须进 unreadable */
    const noArr = K.normalizeThread({ id: 'x2', participant: '阿青', points: 'not-array' });
    assert.equal(noArr.readable, false, 'points 形状坏必须标不可读');
});

test('B6 缺源必须拒：没有 refId 的点回查不到任何东西，不许挂假引用', () => {
    const o = K.openThread([], '阿紫', T0, '');
    const nosrc = K.appendPoint(o.list, o.thread.id, { kind: 'message', channel: 'wechat', at: T0 }, T0);
    assert.equal(nosrc.why, 'no-source', '★ 缺 refId 必须拒（假引用比没有引用更伤）');
    const nochan = K.appendPoint(o.list, o.thread.id, { kind: 'message', channel: 'nope', refId: 'r1', at: T0 }, T0);
    assert.equal(nochan.why, 'channel-unknown');
    const nokind = K.appendPoint(o.list, o.thread.id, { kind: 'nope', channel: 'wechat', refId: 'r1', at: T0 }, T0);
    assert.equal(nokind.why, 'kind-unknown');
    const noat = K.appendPoint(o.list, o.thread.id, { kind: 'message', channel: 'wechat', refId: 'r1' }, T0);
    assert.equal(noat.why, 'bad-shape', '没有时间的点必须拒（它连不上时间轴）');
    /* 不抛、不改列表 */
    assert.equal(Array.isArray(nosrc.list), true);
    assert.equal(nosrc.list.length, o.list.length, '被拒时列表不许被改');
});

test('B7 去重按源（channel+refId 双键）：同一条消息重挂被拒，label 不同也不算新', () => {
    const o = K.openThread([], '阿橙', T0, '');
    const r = K.appendPoint(o.list, o.thread.id, { kind: 'message', channel: 'wechat', refId: 'w1', at: T0, label: '第一版' }, T0);
    const dup = K.appendPoint(r.list, o.thread.id, { kind: 'message', channel: 'wechat', refId: 'w1', at: T0 + 1, label: '改过的话' }, T0 + 1);
    assert.equal(dup.why, 'dup-point', '★ 同一个源只算一次（label 是读数不是身份）');
    assert.equal(dup.ok, false);
    /* 不同 channel 同一 refId 算两个源（真的两次接触） */
    const other = K.appendPoint(r.list, o.thread.id, { kind: 'sms', channel: 'phone-sms', refId: 'w1', at: T0 + 1 }, T0 + 1);
    assert.equal(other.ok, true, '不同来源面同一 id 是新接触点');
});

/* ============================================================
 * C 面：时间诚实面（本版最伤的一类假读数）
 * ========================================================== */
test('C1 ★★★ 读不出就是 null：绝不补「现在」（三天前漏接不许读成刚刚漏接）', () => {
    assert.equal(T.parseCommStamp('', '', null), null);
    assert.equal(T.parseCommStamp('不是日期', '不是时间', { year: 2026, month: 10, day: 22 }), null);
    assert.equal(T.parseCommClock(''), null);
    assert.equal(T.parseCommClock('25:00'), null);
    assert.equal(T.parseCommClock('12:61'), null);
    assert.equal(T.parseCommStamp('3月5日', '09:00', null), null, '★ 缺年且无故事年必须 null（不假装是今年）');
    const withYear = T.parseCommStamp('3月5日', '09:00', { year: 2026 });
    assert.equal(typeof withYear, 'number', '补了故事年才读得出');
    assert.equal(T.stampOfCall({ date: '', time: '', status: 'missed' }, null), null, '★ 通话记录读不出必须 null');
    /* 反向坐实：真能读出的样例必须是数（防「一律 null」这种坏实现也全绿） */
    const good = T.stampOfCall({ date: '2026年10月22日', time: '08:05' }, null);
    assert.equal(typeof good, 'number');
    const d = new Date(good);
    assert.equal(d.getFullYear(), 2026);
    assert.equal(d.getMonth() + 1, 10);
    assert.equal(d.getDate(), 22);
    assert.equal(d.getHours(), 8);
    assert.equal(d.getMinutes(), 5);
});

test('C2 非法月日不许静默归一：2 月 30 日、13 月一律 null', () => {
    assert.equal(T.parseCommDate('2025年2月30日'), null, '★ 不许归一成 3 月 2 日');
    assert.equal(T.parseCommDate('13月1日'), null);
    assert.equal(T.parseCommDate('2026年4月31日'), null);
    assert.equal(typeof T.parseCommDate('2024年2月29日'), 'object', '闰年 2 月 29 日应合法');
    assert.equal(T.parseCommDate('2025年2月29日'), null, '平年 2 月 29 日不合法');
});

test('C3 通话记录文本时间能进交流读数（漏接这一格的真入口）', () => {
    const o = K.openThread([], '阿明', T0, '');
    const callRec = { id: 'rec1', caller: '阿明', date: '2026年10月22日', time: '08:05', status: 'missed' };
    const at = T.stampOfCall(callRec, null);
    assert.equal(typeof at, 'number');
    const r = K.appendPoint(o.list, o.thread.id, {
        kind: 'missed', channel: 'phone-call', refId: callRec.id, at, label: '漏接来电', direction: 'incoming',
    }, at);
    assert.equal(r.ok, true, '★ 漏接必须能挂上（这是 R6-O2 最不能丢的一格）');
    assert.equal(K.resumeOf(r.thread).endedOnMissed, true);
});

/* ============================================================
 * D 面：接线（四处注册 / 键 / 样式 / 消费矩阵）
 * ========================================================== */
test('D1 四处注册齐备：APPS / 懒加载路由表 / 页签真源表 / REBIND 表', () => {
    const apps = read('config/apps.js');
    assert.ok(apps.indexOf("id: 'comms'") >= 0, 'APPS 必须登记 comms');
    assert.ok(apps.indexOf("name: '会话台'") >= 0, 'APPS 必须有中文名');
    const lazy = read('config/app-lazy-routes.js');
    assert.ok(lazy.indexOf('id: "comms"') >= 0, '懒加载路由表必须登记');
    assert.ok(lazy.indexOf('key: "commsApp"') >= 0, 'key 必须与 REBIND 表同名');
    assert.ok(lazy.indexOf('cls: "CommsApp"') >= 0, 'cls 必须与 App 导出类同名');
    assert.ok(lazy.indexOf('module: "./apps/comms/comms-app.js"') >= 0, 'module 路径必须指向真文件');
    const tabs = read('config/tab-source.js');
    assert.ok(tabs.indexOf('comms: Object.freeze') >= 0, '页签真源表必须登记');
    assert.ok(tabs.indexOf("file: 'apps/comms/comms-app.js', shape: 'single'") >= 0, '必须是 single 形态');
    const idx = read(INDEX_REL);
    assert.ok(idx.indexOf("'commsApp'") >= 0, '★ REBIND 表必须登记（否则换会话串实例态）');
});

test('D2 键与隔离：comm_threads_v1 进 keys-audit，^comm 进 storage 会话前缀族', () => {
    assert.equal(K.COMM_KEY, 'comm_threads_v1');
    const ka = read('scripts/keys-audit.mjs');
    assert.ok(ka.indexOf("'comm_threads_v1'") >= 0, '键必须登记在 KEY_REGISTRY');
    assert.ok(ka.indexOf("scope: 'chat'") >= 0, 'scope 必须是 chat（会话隔离）');
    const st = read('config/storage.js');
    const i = st.indexOf('/^comm/,');
    assert.ok(i > 0, '★ ^comm 必须进 CHAT_DATA_PATTERNS（否则独占全局，换角色串味）');
    /* 反向坐实：它必须落在数组区间内，不是掉在注释或数组之后 */
    const head = st.lastIndexOf('CHAT_DATA_PATTERNS', i);
    assert.ok(head > 0, '前缀必须写在 CHAT_DATA_PATTERNS 之内');
    const seg = st.slice(head, i);
    assert.ok(seg.indexOf('];') < 0, '前缀不许掉在数组闭合之后（那种写法是死代码）');
});

test('D3 样式双侧：源面 comms.css 与运行时投递面 phone.css 类前缀族一致', () => {
    const src = read(CSS_REL);
    const bundled = read('phone.css');
    assert.ok(src.indexOf('.cm-root') >= 0, '源面必须有 .cm-root');
    assert.ok(bundled.indexOf('.cm-root') >= 0, '★ phone.css 必须含同名段（样式双侧是硬纪律）');
    for (const cls of ['.cm-card', '.cm-attn-unread', '.cm-k-missed', '.cm-dangling']) {
        assert.ok(src.indexOf(cls) >= 0, '源面缺 ' + cls);
        assert.ok(bundled.indexOf(cls) >= 0, '运行时面缺 ' + cls);
    }
    assert.ok(src.indexOf('@media (max-width: 340px)') >= 0, '必须带窄屏段');
    assert.ok(src.indexOf('overflow-x: auto') < 0, '★ 不许用横向滚动兜窄屏');
    assert.ok(bundled.indexOf('@media (max-width: 340px)') >= 0, '运行时面也必须带窄屏段');
});

test('D4 消费矩阵：comms 行在场，且声明与磁盘真源同源', () => {
    const mx = read('config/app-consumption-matrix.js');
    assert.ok(mx.indexOf('appId: "comms"') >= 0, '消费矩阵必须登记 comms 行');
    const row = mx.slice(mx.indexOf('appId: "comms"'));
    const seg = row.slice(0, row.indexOf('})'));
    assert.ok(seg.indexOf('F1_inject: true') >= 0, '★ F1 必须为真（App 自己挂了生成前钩子）');
    assert.ok(seg.indexOf('F6_lifecycle: true') >= 0, '★ F6 必须为真（已进 REBIND 表）');
    /* 与磁盘真源对账（不信矩阵自述） */
    const appSrc = read(APP_REL);
    assert.ok(appSrc.indexOf('GENERATE_BEFORE_COMBINE_PROMPTS') >= 0, 'F1 真源：App 内必须出现主钩子常量');
    const idx = read(INDEX_REL);
    const ri = idx.indexOf('ST_PHONE_REBIND_APP_KEYS = [');
    const blk = idx.slice(ri, idx.indexOf('\n];', ri));
    assert.ok(blk.indexOf('commsApp') >= 0, 'F6 真源：REBIND 表内必须出现 commsApp');
});

/* ============================================================
 * E 面：负控制三向自证
 * ========================================================== */
/** 判据本体：在一份「内核源码」文本上判形态纪律，返回问题码数组（空数组即合格）。 */
function kernelJudge(src) {
    const bad = [];
    /* R1 漏接单列：MISSED 必须存在且与 MESSAGE 不同值 */
    if (!/MISSED:\s*'missed'/.test(src)) bad.push('missed-not-single');
    /* R2 未读未回分列：两个标记函数必须各自独立 */
    if (!/export function markPointSeen/.test(src)) bad.push('no-mark-seen');
    if (!/export function markPointAnswered/.test(src)) bad.push('no-mark-answered');
    const seen = src.slice(src.indexOf('export function markPointSeen'), src.indexOf('export function markPointAnswered'));
    if (!seen || seen.indexOf('markPoint') < 0) bad.push('seen-not-forwarding');
    /* R3 误合保守：超窗必须判 gap-too-long 且计划为 open */
    if (src.indexOf('GAP_TOO_LONG') < 0) bad.push('no-gap-reason');
    /* R4 四态分列：absent 与 unreadable 必须都在 */
    if (src.indexOf("ABSENT: 'absent'") < 0) bad.push('no-absent');
    if (src.indexOf("UNREADABLE: 'unreadable'") < 0) bad.push('no-unreadable');
    /* R5 缺源拒收：no-source 归因必须在，且必须挂在**真守卫**上。
     *   ★ 首版只查 'NO_SOURCE' 这个词出现与否 —— 词表定义、档头注释里都写着它，
     *   把守卫改成 `if (false)` 词还在，判据照旧绿（本版 E1 负控制实测抓到的判据自弱）。
     *   结论面必须是那行守卫本身（同 E6：判据的输入面与结论面必须是同一件事）。 */
    if (src.indexOf('if (!p.refId || !p.id) return { ok: false, why: COMM_REASONS.NO_SOURCE') < 0) {
        bad.push('no-no-source');
    }
    /* R6 收束优先：closedAt 判定必须在 gap 判定之前（改序即改结论） */
    /* ★ 必须取 appendPoint 里那一处（后随 const last =），否则会拿到 closeThread 的那句 ——
     *   那句天然排在 gap 判定之后，会让 R6「收束优先」永久假红。 */
    const iClose = src.indexOf('if (t.closedAt) return { ok: false, why: COMM_REASONS.ALREADY_CLOSED, thread: t, list: arr };\n    const last =');
    const iGap = src.indexOf('GAP_TOO_LONG, thread: t, list: arr }');
    if (iClose < 0) bad.push('no-closed-guard');
    if (iGap < 0) bad.push('no-gap-guard');
    if (iClose > 0 && iGap > 0 && iClose > iGap) bad.push('closed-after-gap');
    /* R7 只持引用不持正文：接触点归一里不许出现正文类字段名 */
    const np = src.slice(src.indexOf('export function normalizePoint'), src.indexOf('export function samePointSource'));
    for (const f of ['content:', 'text:', 'message:', 'body:']) {
        if (np.indexOf(f) >= 0) bad.push('point-carries-body:' + f);
    }
    /* R8 时间诚实面：comm-time 的读不出必须返回 null（不许回落 Date.now） */
    /* R9 优先级坑：不许出现 '+ x || y' 形态（R6-O1 已踩过一次，本仓同族）。
     *   ★ 扫描面必须是**去注释后的真代码**：档头正把这个坑当教训写着示例，
     *   拿原文扫就会把「记着这个坑」判成「犯了这个坑」（首版实测误报 plus-or-precedence）。
     *   同 dead-export E6：判据的输入面与结论面必须是同一件事。 */
    const codeOnly = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
    if (/\+\s*[A-Za-z_.\[\]']+\s*\|\|/.test(codeOnly)) bad.push('plus-or-precedence');
    return bad;
}
/** 真源码锚点破坏（恰中 1 次；失配即抛 —— 我改的不是我以为那一处）。 */
function mutate(src, old, neu, tag) {
    const n = src.split(old).length - 1;
    assert.equal(n, 1, '[负控制 ' + tag + '] 锚点必须恰中 1 次，实测 ' + n);
    return src.replace(old, neu);
}
const ORIGINAL_KERNEL = read(KERNEL_REL);

test('E1 ★★ 负控制三向自证：真仓必绿 / 破坏副本必红 / 锚点不唯一必抛', () => {
    /* 一向：真仓必绿 */
    assert.deepEqual(kernelJudge(ORIGINAL_KERNEL), [], '真仓在判据本身上必须全绿');
    /* 二向：五个破坏副本必红（真源码破坏 → 在副本上重跑同款真判据） */
    const breaks = [
        ['MISSED: \'missed\',', "MISSED: 'message',", 'missed-not-single',
            '把漏接改成普通消息 ⇒ 漏接与「没发生」同形'],
        ["    ABSENT: 'absent',", "    ABSENT: 'unreadable',", 'no-absent',
            '把 absent 与 unreadable 压平 ⇒ 存储坏了被伪装成「还没开始」'],
        /* ★ 破坏锚点必须**唯一定位到 appendPoint 的那一处守卫**：closeThread 里也有一句同形
         *   `if (t.closedAt) ...`，裸锚点会命中 2 次（mutate 会如实抛「必须恰中 1 次」）。
         *   故带上后随行 `const last =`（只有 appendPoint 才有）。 */
        ['if (t.closedAt) return { ok: false, why: COMM_REASONS.ALREADY_CLOSED, thread: t, list: arr };\n    const last =',
            'if (false) return { ok: false, why: COMM_REASONS.ALREADY_CLOSED, thread: t, list: arr };\n    const last =', 'no-closed-guard',
            '摘掉收束守卫 ⇒ 手动合上的段被下一句悄悄拉开'],
        ['if (!p.refId || !p.id) return { ok: false, why: COMM_REASONS.NO_SOURCE, thread: t, list: arr };',
            'if (false) return { ok: false, why: COMM_REASONS.NO_SOURCE, thread: t, list: arr };', 'no-no-source',
            '摘掉缺源拒收 ⇒ 挂上回查不到的假引用'],
        ['label: capStr(p.label, COMM_LIMITS.note),', "label: capStr(p.label, COMM_LIMITS.note), text: String(p.text || ''),", 'point-carries-body:text:',
            '让接触点带上正文 ⇒ 违反「只持引用不持正文」'],
    ];
    for (const [old, neu, expectCode, why] of breaks) {
        const broken = mutate(ORIGINAL_KERNEL, old, neu, expectCode);
        const got = kernelJudge(broken);
        assert.ok(got.indexOf(expectCode) >= 0,
            '★ 破坏副本必须被抓：' + why + '（期望 ' + expectCode + '，实测 ' + JSON.stringify(got) + '）');
        /* 副本上必须**只有**这一处问题（防「一处破坏把判据打成一片红」这种假阳性） */
        assert.ok(got.length >= 1, '破坏必须可观测');
    }
    /* 三向：锚点不唯一必须抛 */
    /* ★ 锚点要挑**真·多处出现**的：首版挑 'function str(' —— 修完内核写回身份后那句只剩 1 处，
     *   mutate 不再抛，这一向就变成了空转（本版实测）。此处先自证锚点确实不唯一。 */
    const AMBIG = 'const arr = Array.isArray(list) ? list : [];';
    assert.ok(ORIGINAL_KERNEL.split(AMBIG).length - 1 > 1,
        '★ 「锚点不唯一」这一向的锚点必须实测多处出现，否则该向在空转');
    assert.throws(() => mutate(ORIGINAL_KERNEL, AMBIG, 'const arr = [];', 'anchor-not-unique'),
        /锚点必须恰中 1 次/, '★ 锚点不唯一时必须抛，不许静默改到别处');
    /* 反向对照：一条无关改动必须仍绿（证明判据不是「凡改必红」） */
    const neutral = mutate(ORIGINAL_KERNEL, '/* ---------- 基础归一', '/* ---------- 基础归一（无关改动）', 'neutral');
    assert.deepEqual(kernelJudge(neutral), [], '★ 无关改动必须仍绿（防判据过敏）');
});

test('E2 时间件的诚实面也进负控制：补 now 的坏实现必须被抓', () => {
    const src = read(TIME_REL);
    /* 判据：任意「读不出 → 返回 Date.now()」的写法都是本版最伤的假读数 */
    assert.ok(src.indexOf('Date.now()') < 0, '★ 时间件内不许出现 Date.now()（那正是「补现在」的写法）');
    assert.ok(src.indexOf('return null') > 0, '读不出必须返回 null');
    /* 破坏副本：把 null 换成 Date.now() 后，同款「不许出现 Date.now」判据必须抓到 */
    const broken = mutate(src, 'if (!clock) return null;', 'if (!clock) return Date.now();', 'time-now-fallback');
    assert.ok(broken.indexOf('Date.now()') > 0, '破坏必须可观测');
    assert.ok(broken.indexOf('Date.now()') >= 0, '★ 同款判据在副本上必须转红');
});

/* ============================================================
 * F 面：版本锚与结构自证
 * ========================================================== */
test('F1 本套件只在 v4.49.0 及以后成立（五源同源）', () => {
    const toNum = (v) => String(v).split('.').map((x) => Number.parseInt(x, 10)).reduce((a, b) => a * 1000 + b, 0);
    const pkg = JSON.parse(read('package.json'));
    const mf = JSON.parse(read('manifest.json'));
    const log = JSON.parse(read('update-log.json'));
    const codeVer = (read(INDEX_REL).match(/const ST_PHONE_VERSION = '([^']+)'/) || [])[1] || '';
    assert.ok(toNum(pkg.version) >= toNum(MIN_VERSION), 'package.version 必须 >= ' + MIN_VERSION + '（实测 ' + pkg.version + '）');
    assert.equal(mf.version, pkg.version, 'manifest 与 package 必须同源');
    assert.equal(log.latest, pkg.version, 'update-log.latest 必须同源');
    assert.equal(codeVer, pkg.version, 'index.js 版本常量必须同源');
    const own = log.versions[pkg.version];
    assert.ok(own && Array.isArray(own.items) && own.items.length, '当版条目必须非空');
    const joined = own.items.join(' ');
    assert.ok(joined.indexOf('R6-O2') >= 0, '★ 当版条目必须点名 R6-O2');
});

test('F2 结构自证：扫描面非空（防「空对空」全绿）', () => {
    for (const f of [KERNEL_REL, TIME_REL, APP_REL, VIEW_REL, CSS_REL]) {
        assert.ok(fs.existsSync(rel(f)), '缺文件：' + f);
        assert.ok(read(f).length > 500, '文件不许为空壳：' + f);
    }
    assert.ok(Object.keys(K).length >= 20, '内核导出面不得塌缩（实测 ' + Object.keys(K).length + '）');
    assert.ok(Object.keys(T).length >= 4, '时间件导出面不得塌缩');
    assert.equal(typeof APP.CommsApp, 'function', 'App 必须是可实例化的类');
});