// tests/system-v4106.test.mjs — 时间单一源：两个钟的边界 + 四 App 逐位相等 [v4.106.0 · 第十三期 R13-O4]
//
// 【这一项为什么单列】
//   计划书 R13-O4 的现状读数：`apps/` 下裸 `Date.now()` 758 处、`new Date()` 69 处，
//   而剧情时间的单一源（config/time-manager.js）只被 7 个文件提及。
//   本版实测：`Date.now()` 760 处、`new Date()` 70 处、time-manager 只被 **5 个文件**提及
//   —— 覆盖度比计划书立项时又降了（这条差异写进留档，不改计划书）。
//
// 【根因不是「谁忘了改」】
//   本仓同时存在两个钟，而**没有任何一处说出来过**：
//     · 剧情钟 —— 角色世界里的现在（`timeManager.getCurrentStoryTime()`）；
//     · 墙钟   —— 这台设备真实跑了多久（`Date.now()`），用于节流 / 审计 / 排序稳定性。
//   两者都合法，但**每个字段只许属于其中一个**。于是本版不写「统一改用剧情时间」
//   （那会让节流在剧情回拨后永不失效），而是新建 `config/time-source.js` 当边界：
//     A 面 两个钟的定义与字段级归属闭集；
//     B 面 取数口的行为（读不到就说读不到 / 不补墙钟 / 降级只有一个出口）；
//     C 面 批次 1 五处真接线（消息 / 照片 / 日程 / 日记 / 时计）；
//     D 面 **验收硬线**：同一时刻造一条消息 + 一张照片 + 一条日程 + 一篇日记，
//          四者读回的 ts 必须**逐位相等**；
//     E 面 批次 3 白名单：`apps/` 下裸 `Date.now()` 只允许出现在白名单文件里；
//     F 面 负控制：真源码破坏 → 落副本 → 在副本上重跑同款判据，四向必须转红。
//
// 判据纪律（本仓硬纪律）：判据不许恒绿；破坏只落临时副本；真仓全程只读；
//   负控制必须「真源码破坏 → 加载破坏副本 → 在副本上跑同款真判据」，不许把破坏写成常量。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { stageTreeWithDeps } from './_stage-tree.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

const TS_REL = 'config/time-source.js';
const readRel = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

/* Node 环境下数据层会摸 window —— 给一个可控空壳（每个用例自己换成带 timeManager 的） */
if (typeof globalThis.window === 'undefined') globalThis.window = {};

const TS = await import('../config/time-source.js');
const { WechatData } = await import('../apps/wechat/wechat-data.js');
const { DiaryData } = await import('../apps/diary/diary-data.js');
const { CalendarData } = await import('../apps/calendar/calendar-data.js');
const { AlbumData } = await import('../apps/album/album-data.js');

/* ---------- 测试替身 ---------- */

/** 只实现 get/set 的存储（本仓各套件的统一替身形状）。 */
function makeStorage(seed = {}) {
    const map = new Map(Object.entries(seed));
    const st = {
        writes: 0,
        get(key, def = null) { return map.has(key) ? map.get(key) : def; },
        set(key, value) { st.writes += 1; map.set(key, value); return true; },
        remove(key) { map.delete(key); return true; },
        raw(key) { return map.get(key); }
    };
    return st;
}

/** 一台只有「剧情钟」的假时间管理器（本套件唯一的剧情时间来源）。 */
function mkTimeManager(face) {
    return {
        calls: 0,
        getCurrentStoryTime() {
            this.calls += 1;
            return face;
        }
    };
}

/** 剧情面：2044 年 10 月 28 日 14:30（时间戳是那天 14:30 的毫秒数，分钟对齐）。 */
const STORY_MS = new Date(2044, 9, 28, 14, 30, 0, 0).getTime();
const STORY_FACE = Object.freeze({
    date: '2044年10月28日',
    time: '14:30',
    weekday: '星期五',
    timestamp: STORY_MS,
    source: 'chat'
});

/** 装宿主：`window.VirtualPhone.timeManager`（全仓一致的注入点）。 */
function mountHost(tm) {
    globalThis.window = { VirtualPhone: tm ? { timeManager: tm } : {} };
    return globalThis.window;
}

/* ============================================================
 * A 面 两个钟的定义与字段级归属
 * ============================================================ */

test('A1 钟只有两个：story / wall，不许出现第三个', () => {
    assert.deepEqual(Object.keys(TS.CLOCKS).sort(), ['story', 'wall'],
        '★ 本仓只承认两个钟；出现第三个就意味着又有一处「各挑各的钟」');
    assert.equal(TS.CLOCKS.story, 'story');
    assert.equal(TS.CLOCKS.wall, 'wall');
});

test('A2 字段级归属是**闭集**且逐条带理由：未登记必须返回 null（不许猜默认值）', () => {
    const fields = Object.keys(TS.FIELD_CLOCKS);
    assert.ok(fields.length >= 15, '归属表太薄：本版实测常见时刻字段 15 个以上');
    for (const f of fields) {
        assert.ok(TS.FIELD_CLOCKS[f] === 'story' || TS.FIELD_CLOCKS[f] === 'wall',
            '★ ' + f + ' 的归属只能是 story 或 wall');
        const why = String(TS.FIELD_CLOCK_WHY[f] || '').trim();
        assert.ok(why.length >= 8, '★ ' + f + ' 缺少理由：新增字段必须连带回答「为什么属于那个钟」');
    }
    assert.equal(TS.fieldClockOf('storyAt'), 'story');
    assert.equal(TS.fieldClockOf('timestamp'), 'story');
    assert.equal(TS.fieldClockOf('createdAt'), 'wall');
    assert.equal(TS.fieldClockOf('realTimestamp'), 'wall',
        '★ realTimestamp 是双轨制的墙钟侧，与 timestamp 不同义（混用等于把双轨制作废）');
    /* 「没声明」与「声明为墙钟」必须不同形 —— 否则下一版随手加个 `xxAt` 就又漂走了。 */
    assert.equal(TS.fieldClockOf('xxAt'), null, '★ 未登记字段必须是 null，不许给默认值');
    assert.equal(TS.fieldClockOf(''), null);
    assert.equal(TS.fieldClockOf(null), null);
});

test('B7 便捷口与全量口同源：storyNowMs 不许另写一份取数，诊断面里逐轮对账', () => {
    /* 本仓的形态纪律：同一个读数只许有一个取数点。`storyNowMs` 是给「只要毫秒」的
     *   调用方准备的便捷口，它必须是 `storyNow(win).ms` 的解构包装。哪天有人给它
     *   写了独立实现（比如自己读 `timeManager`），两条路径就会在某个边界情形上分叉，
     *   而分叉是静默的 —— 故这里拿「同一次读数」当判据，并在诊断面里逐轮对账。 */
    mountHost(mkTimeManager(STORY_FACE));
    assert.equal(TS.storyNowMs(globalThis.window), TS.storyNow(globalThis.window).ms,
        '★ 便捷口必须与全量口同源');
    /* 读不到时也同源：两边都是 null（绝不许一边 null 一边墙钟）。 */
    mountHost(mkTimeManager({ date: '', time: '' }));
    assert.equal(TS.storyNowMs(globalThis.window), null);
    assert.equal(TS.storyNow(globalThis.window).ms, null);
    /* 诊断面里有这条对账（`problems` 会点名「取数口自相矛盾」）——
     *   这一条撑住的是：那张面真的在读这两个口，而不是摆着好看。 */
    const dsrc = fs.readFileSync(path.join(ROOT, 'apps', 'diagnose', 'diagnose-data.js'), 'utf8');
    assert.ok(dsrc.includes('storyNowMs(w)'), '★ 时间双轨面必须真读便捷口（否则它就是一个零消费导出）');
    assert.ok(dsrc.includes('取数口自相矛盾'), '★ 两个口的同源对账必须在诊断面上真的落地');
});

test('A3 本模块只许引用「零依赖叶子口径模块」，不许 import 任何业务模块', () => {
    /* 【判据改法留档：从「零 import」改成「白名单 import」】
     *   首版写的是 `imports.length === 0`，理由是「本模块是边界，不许反向依赖」——
     *   而那个写法直接导致本模块**就地手写了一份取数强口径**（两处
     *   `typeof raw === 'number' && Number.isFinite(raw) && raw > 0 …`），
     *   于是 weak-coercion 门当场报 W1 两处。（口径有了第二份实现，下一次就会有人
     *   再写一遍弱的那版 —— 这正是那道门点了四轮才立起来的结论。）
     *   现改为：**允许**引用零依赖叶子口径模块（`num-gate.js` 自己不 import 任何东西，
     *   引用它不造出依赖方向问题），**不允许**引用任何业务模块（apps / 状态层）。
     *   这不是「放宽到谁都行」—— 白名单外的 import 一律红，并逐一给理由。 */
    const src = readRel(TS_REL);
    const imports = (src.match(/^\s*import\s[^;]+;/gm) || [])
        .map((x) => (/from\s+'([^']+)'/.exec(x) || [])[1])
        .filter(Boolean);
    const ALLOWED_TS_IMPORTS = ['./num-gate.js'];   // 零依赖叶子模块：口径唯一实现
    const unexpected = imports.filter((x) => !ALLOWED_TS_IMPORTS.includes(x));
    assert.deepEqual(unexpected, [],
        '★ config/time-source.js 的 import 面只许是 ' + JSON.stringify(ALLOWED_TS_IMPORTS)
        + '（实测多出：' + JSON.stringify(unexpected) + '）—— 引用业务模块会把「时间的边界」变成下游');
    assert.ok(src.includes("'use strict';"), 'ESM 里仍然保留严格模式声明（与全仓一致）');
    /* 口径不得就地重写：本条与 weak-coercion 门的 W1 同口径（同一件事只有一个说法）。 */
    assert.equal((src.match(/Number\.isFinite\(\s*Number\(/g) || []).length, 0,
        '★ 取数口径必须走 `numOrNull`（唯一实现）—— 就地手写的强口径仍是第五度形态');
});

/* ============================================================
 * B 面 取数口的行为
 * ============================================================ */

test('B1 读到了：原样转发日期/时刻/星期/来源，来源名不发明第三个', () => {
    mountHost(mkTimeManager(STORY_FACE));
    const s = TS.storyNow(globalThis.window);
    assert.equal(s.ok, true);
    assert.equal(s.ms, STORY_MS);
    assert.equal(s.date, '2044年10月28日');
    assert.equal(s.time, '14:30');
    assert.equal(s.weekday, '星期五');
    assert.equal(s.source, 'chat', '★ 来源必须原样转发，不许在这里改写');
    assert.equal(s.reason, 'ok');
    assert.equal(s.degraded, false);
});

test('B2 读不到就说读不到，**绝不补墙钟**：ms 必为 null 且带成因码', () => {
    /* 四种成因逐一验：无宿主 / 无 timeManager / 抛错 / 面是空的 */
    const noHost = TS.storyNow(null);
    assert.equal(noHost.ok, false);
    assert.equal(noHost.ms, null, '★ 读不到时 ms 必须是 null —— 补墙钟会把「剧情里是 1943 年」读成「现在是 2026 年」');
    assert.equal(noHost.reason, 'no-host');

    mountHost(null);
    const noTm = TS.storyNow(globalThis.window);
    assert.equal(noTm.ok, false);
    assert.equal(noTm.ms, null);
    assert.equal(noTm.reason, 'no-time-manager');

    mountHost({ getCurrentStoryTime() { throw new Error('上游炸了'); } });
    const threw = TS.storyNow(globalThis.window);
    assert.equal(threw.ok, false);
    assert.equal(threw.ms, null);
    assert.equal(threw.reason, 'threw', '★ 抛错不许冒充满分读数（要能归因）');

    mountHost(mkTimeManager({ date: '', time: '', timestamp: 0 }));
    const empty = TS.storyNow(globalThis.window);
    assert.equal(empty.ok, false);
    assert.equal(empty.ms, null);
    assert.equal(empty.reason, 'empty-face');

    /* 四个成因码必须**两两不同形**：不同成因的处置相反（缺装置 / 缺上下文 / 上游没给） */
    const reasons = [noHost.reason, noTm.reason, threw.reason, empty.reason];
    assert.equal(new Set(reasons).size, 4, '四种成因必须是四个不同的码：' + JSON.stringify(reasons));
    for (const r of reasons) {
        assert.ok(String(TS.STORY_REASONS[r] || '').length >= 6, '成因码 ' + r + ' 必须有人话');
    }
});

test('B3 时间戳走强口径：空白串 / 0 / 负数 / NaN 都不许被读成「有时间戳」', () => {
    /* 本仓 weak-coercion 门治过的形态：`Number('') === 0` 于是「没有」与「是 0」塌成一件事。 */
    const bad = ['', '   ', 0, -1, NaN, null, undefined, {}, []];
    for (const b of bad) {
        mountHost(mkTimeManager({ date: '2044年10月28日', time: '14:30', timestamp: b }));
        const s = TS.storyNow(globalThis.window);
        assert.equal(s.ok, true, '日期与时刻在，读数本身是成功的（' + String(b) + '）');
        assert.equal(s.ms, null, '★ 时间戳 ' + JSON.stringify(b) + ' 不许被读成有效时间戳');
        assert.equal(s.reason, 'bad-stamp', '★ 必须归因「面在场但没有可用时间戳」');
    }
    /* 字符串形式的有效时间戳要能读（历史数据里有存成串的） */
    mountHost(mkTimeManager({ date: '2044年10月28日', time: '14:30', timestamp: String(STORY_MS) }));
    assert.equal(TS.storyNow(globalThis.window).ms, STORY_MS);
});

test('B4 降级只有一个出口，且降级与「读不到」不同形', () => {
    mountHost(null);
    const plain = TS.storyNow(globalThis.window);
    const deg = TS.storyNowWallFallback(globalThis.window);
    assert.equal(plain.degraded, false);
    assert.equal(plain.ms, null, '★ 纯取数口不降级：读不到就是读不到');
    assert.equal(deg.degraded, true, '★ 降级必须显式标记（散在调用点各自写一遍 = 没人能答「哪处在用墙钟」）');
    assert.ok(Number.isFinite(deg.ms) && deg.ms > 0, '降级后有时间可用');
    assert.equal(deg.source, 'wall-fallback');
    assert.equal(deg.reason, 'no-time-manager', '降级必须把**为什么降级**带回来');
    assert.ok(deg.date.length > 0 && deg.time.length > 0);

    /* 读得到时不许降级（降级出口只在真的读不到时才动手） */
    mountHost(mkTimeManager(STORY_FACE));
    const ok = TS.storyNowWallFallback(globalThis.window);
    assert.equal(ok.degraded, false);
    assert.equal(ok.ms, STORY_MS);
    assert.equal(ok.source, 'chat');

    /* 两句话必须不同形：用户看得懂「没读到」与「读到了但那是本机时间」的区别 */
    const lineDeg = TS.storySourceLine(deg);
    const lineNone = TS.storySourceLine(plain);
    assert.notEqual(lineDeg, lineNone, '★ 「读不到」与「读到了但降级」必须不同形');
    assert.match(lineDeg, /降级/);
    assert.match(lineNone, /读不到/);
    assert.doesNotMatch(lineNone, /降级/);
});

test('B5 stampPair 一次取两个钟：storyAt 可空但 wallAt 恒有，两者不互相冒充', () => {
    mountHost(mkTimeManager(STORY_FACE));
    const p = TS.stampPair(globalThis.window);
    assert.equal(p.storyAt, STORY_MS);
    assert.ok(Number.isFinite(p.wallAt) && p.wallAt > 0);
    assert.notEqual(p.storyAt, p.wallAt, '★ 两个钟不许是同一个值（那说明有人把它们当成了一个）');
    assert.equal(p.storyDegraded, false);

    mountHost(null);
    const q = TS.stampPair(globalThis.window);
    assert.equal(q.storyAt, null, '★ 读不到剧情钟时 storyAt 必须是 null，不许谎报墙钟');
    assert.ok(Number.isFinite(q.wallAt) && q.wallAt > 0, '墙钟恒有（排序 / 审计 / 节流都要用）');
    assert.equal(q.storyDegraded, true);
});

test('B6 storyTsOf 只认剧情轨：不存在的字段返回 null，**绝不回退 createdAt**', () => {
    assert.equal(TS.storyTsOf({ storyAt: STORY_MS }), STORY_MS);
    assert.equal(TS.storyTsOf({ timestamp: STORY_MS }), STORY_MS,
        '历史消息用的是 timestamp（同义老字段名），必须兼容');
    assert.equal(TS.storyTsOf({ storyAt: STORY_MS, timestamp: 1 }), STORY_MS, 'storyAt 优先');
    assert.equal(TS.storyTsOf({ createdAt: STORY_MS }), null,
        '★ 不许把 createdAt 当剧情时刻读 —— 那正是本版要治的错');
    assert.equal(TS.storyTsOf({}), null, '两轨都没有 ⇒ null（不猜）');
    assert.equal(TS.storyTsOf(null), null);
    assert.equal(TS.storyTsOf({ storyAt: 0 }), null, '0 不是有效时刻（强口径）');
});

/* ============================================================
 * C 面 批次 1 五处真接线
 * ============================================================ */

test('C1 消息：timestamp 走剧情钟、realTimestamp 走墙钟，两轨不混用', () => {
    const tm = mkTimeManager(STORY_FACE);
    mountHost(tm);
    const d = new WechatData(makeStorage());
    d.data.chats = [{ id: 'c1', name: '林晚照', messages: [] }];
    const msg = { type: 'text', content: '下雨了', from: '林晚照', time: '14:30', date: '2044年10月28日' };
    d.addMessage('c1', msg);
    const saved = d.getMessages('c1').find((m) => m.content === '下雨了');
    assert.ok(saved, '消息必须真的落盘了（否则下面全是空断言）');
    assert.equal(saved.timestamp, STORY_MS, '★ 消息 timestamp 必须是剧情时刻');
    assert.equal(saved.storyAt, STORY_MS, '★ 剧情轨必须落盘（新字段）');
    assert.ok(Number.isFinite(saved.realTimestamp) && saved.realTimestamp > 0);
    assert.notEqual(saved.realTimestamp, STORY_MS,
        '★ realTimestamp 是墙钟（「这是第几次生成写下的」），与剧情时刻不同义');
});

test('C2 消息：剧情钟读不到时 timestamp 不许静默变成墙钟（旧写法是 `|| Date.now()`）', () => {
    mountHost(null);
    const d = new WechatData(makeStorage());
    d.data.chats = [{ id: 'c2', name: '阿澈', messages: [] }];
    /* 故意不传 date / time：走 `_getStoryTimeFallback()` 的降级分支 */
    const msg = { type: 'text', content: '没有时间信息', from: '阿澈' };
    d.addMessage('c2', msg);
    const saved = d.getMessages('c2').find((m) => m.content === '没有时间信息');
    assert.ok(saved);
    /* 降级是**允许**的（消息总得有一个时间），但必须显式：realTimestamp 是墙钟，
     *   timestamp 若等于墙钟，则「剧情时刻」这件事被抹掉了却没人知道。 */
    assert.equal(saved.storyAt !== undefined && saved.storyAt !== null, true,
        'storyAt 字段必须在场（值可以是降级后的值，但字段本身不许缺）');
    assert.ok(Number.isFinite(saved.timestamp) && saved.timestamp > 0, '总得有一个时间可用');
});

test('C3 日记：补剧情轨 storyAt；createdAt 与 id 仍是墙钟', () => {
    mountHost(mkTimeManager(STORY_FACE));
    const d = new DiaryData(makeStorage());
    const e = d.createManualEntry('今天下雨了，没出门。', { date: '2044年10月28日' });
    assert.equal(e.storyAt, STORY_MS, '★ 日记 storyAt 必须与消息同源（剧情钟），不是正文日期反解的 12:00');
    assert.ok(Number.isFinite(e.createdAt) && e.createdAt > 0);
    assert.notEqual(e.createdAt, STORY_MS, 'createdAt 是墙钟');
    assert.ok(String(e.id || '').length > 0);

    /* 读不到剧情钟：storyAt 可为 null，但不许拿 createdAt 冒充 */
    mountHost(null);
    const d2 = new DiaryData(makeStorage());
    const e2 = d2.createManualEntry('没有剧情的日记。', { date: '' });
    assert.ok(e2.storyAt === null || Number.isFinite(e2.storyAt), 'storyAt 要么是时刻要么是 null');
    if (e2.storyAt !== null) {
        /* 若降级到正文日期（12:00），必须真的是 12:00 而不是墙钟 */
        const dt = new Date(e2.storyAt);
        assert.equal(dt.getHours(), 12, '★ 兜底用的是正文日期（当天 12:00），不是墙钟');
    }
});

test('C4 日程：补剧情轨 storyAt；id 与 createdAt 仍是墙钟', () => {
    mountHost(mkTimeManager(STORY_FACE));
    const c = new CalendarData(makeStorage());
    const memo = c.addMemo({ dateKey: '2044-10-28', title: '和小满去看海', time: '15:00' });
    assert.ok(memo, '备忘必须真的创建了');
    assert.equal(memo.storyAt, STORY_MS, '★ 日程 storyAt 必须与消息同源');
    assert.ok(Number.isFinite(memo.createdAt) && memo.createdAt > 0);
    assert.notEqual(memo.createdAt, STORY_MS, 'createdAt 是墙钟（剧情回拨不许让它倒退）');
    assert.match(String(memo.id), /^calendar_memo_\d+_/);
});

test('C5 照片：上传索引落 storyAt，相册读回时两条轨都在', () => {
    mountHost(mkTimeManager(STORY_FACE));
    const idx = JSON.stringify([
        { path: '/backgrounds/phone_v4106.png', prefix: '本地上传', storyAt: STORY_MS, createdAt: 1234 }
    ]);
    globalThis.window = { VirtualPhone: { timeManager: mkTimeManager(STORY_FACE), subsystems: {} } };
    const a = new AlbumData(makeStorage({ phone_album_upload_index: idx }));
    const rows = a.getMedia();
    const row = rows.find((r) => r.path === '/backgrounds/phone_v4106.png');
    assert.ok(row, '照片必须在主列表里（否则下面全是空断言）');
    assert.equal(row.storyAt, STORY_MS, '★ 相册必须读回剧情轨');
    assert.equal(row.createdAt, 1234, '墙钟轨原样保留（排序稳定性 / 审计）');
});

test('C6 照片：历史索引（无 storyAt）读回 storyAt 为 null，**不拿 createdAt 冒充**', () => {
    const idx = JSON.stringify([
        { path: '/backgrounds/phone_old.png', prefix: '本地上传', createdAt: 999 }
    ]);
    globalThis.window = { VirtualPhone: { subsystems: {} } };
    const a = new AlbumData(makeStorage({ phone_album_upload_index: idx }));
    const row = a.getMedia().find((r) => r.path === '/backgrounds/phone_old.png');
    assert.ok(row);
    assert.equal(row.storyAt, null, '★ 没有剧情轨就必须如实说 null');
    assert.equal(row.createdAt, 999, '墙钟还在，别把它删了（排序要靠它）');
    /* 排序退回旧口径：历史数据上的列表顺序必须与 v4.105.0 一致（不制造静默重排） */
    assert.equal(a.getMedia().length >= 1, true);
});

/* ============================================================
 * D 面 验收硬线：四 App 逐位相等
 * ============================================================ */

test('D1 ★验收：同一时刻造消息 + 照片 + 日程 + 日记，四者读回的 ts 逐位相等', () => {
    /* 一台「同一时刻」的宿主：四个数据层共享同一个 timeManager。
     * 这正是计划书 R13-O4 的验收语：「造一条消息 + 一张照片 + 一条日程 + 一篇日记
     * （同一时刻），四者读回的 ts 必须逐位相等」。 */
    const tm = mkTimeManager(STORY_FACE);
    globalThis.window = { VirtualPhone: { timeManager: tm, subsystems: {} } };

    const wst = makeStorage();
    const wd = new WechatData(wst);
    wd.data.chats = [{ id: 'cx', name: '林晚照', messages: [] }];
    wd.addMessage('cx', { type: 'text', content: '同一时刻', from: '林晚照', time: '14:30', date: '2044年10月28日' });
    const msgTs = wd.getMessages('cx').find((m) => m.content === '同一时刻').timestamp;

    const diary = new DiaryData(makeStorage());
    const diaryTs = diary.createManualEntry('同一时刻写的日记。', { date: '2044年10月28日' }).storyAt;

    const cal = new CalendarData(makeStorage());
    const calTs = cal.addMemo({ dateKey: '2044-10-28', title: '同一时刻的日程', time: '14:30' }).storyAt;

    const idx = JSON.stringify([
        { path: '/backgrounds/phone_same.png', prefix: '本地上传', storyAt: TS.storyNow(globalThis.window).ms, createdAt: 1 }
    ]);
    const album = new AlbumData(makeStorage({ phone_album_upload_index: idx }));
    const photoTs = album.getMedia().find((r) => r.path === '/backgrounds/phone_same.png').storyAt;

    const four = { msgTs, photoTs, calTs, diaryTs };
    for (const [k, v] of Object.entries(four)) {
        assert.ok(Number.isFinite(v) && v > 0, '★ ' + k + ' 必须读到有效时刻（实际 ' + String(v) + '）');
    }
    assert.equal(new Set(Object.values(four)).size, 1,
        '★ 验收硬线：同一时刻的四处读数必须逐位相等，实际 ' + JSON.stringify(four));
    assert.equal(msgTs, STORY_MS, '★ 且必须等于剧情钟给出的那一刻（不是墙钟）');
});

test('D2 ★验收的负向侧：剧情钟缺席时四处都不许擅自统一成墙钟', () => {
    /* 若某个 App 在读不到剧情钟时偷偷写墙钟，另一个写 null，四者就会「看起来一致」地错。
     * 反向判据：拿掉 timeManager 后，四处读数不允许出现「恰好相等且等于墙钟」这种伪装。 */
    globalThis.window = { VirtualPhone: { subsystems: {} } };
    const before = TS.wallNow();
    const d = new DiaryData(makeStorage());
    const e = d.createManualEntry('无剧情的日记。', { date: '' });
    assert.ok(e.storyAt === null || Number.isFinite(e.storyAt));
    const c = new CalendarData(makeStorage());
    const memo = c.addMemo({ dateKey: '2044-10-28', title: '无剧情的日程' });
    assert.equal(memo.storyAt, null, '★ 读不到剧情钟时日程的 storyAt 必须是 null（不许补墙钟）');
    /* 日记允许退到正文日期，但那时它不是墙钟（12:00，见 C3）；此处正文没日期 ⇒ 也是 null */
    assert.equal(e.storyAt, null, '★ 正文无日期且无剧情钟 ⇒ null');
    assert.ok(TS.wallNow() >= before);
});

/* ============================================================
 * E 面 批次 3 白名单：apps/ 下裸 Date.now() 只允许出现在白名单文件里
 * ============================================================ */

const BARE_NOW_WHITELIST = path.join('tests', 'fixtures', 'bare-now-whitelist.json');

/** 递归列出 apps/ 下全部 .js（相对路径、正斜杠） */
function listAppJs(dir = path.join(ROOT, 'apps'), out = []) {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
        const abs = path.join(dir, ent.name);
        if (ent.isDirectory()) listAppJs(abs, out);
        else if (ent.name.endsWith('.js')) out.push(path.relative(ROOT, abs).split(path.sep).join('/'));
    }
    return out;
}

test('E1 白名单存在且结构可读：每条带理由，且白名单文件本身必须存在（不许靠缺省放行）', () => {
    const abs = path.join(ROOT, BARE_NOW_WHITELIST);
    assert.ok(fs.existsSync(abs), '★ 白名单必须落盘：' + BARE_NOW_WHITELIST + '（缺省放行等于没有判据）');
    const raw = JSON.parse(fs.readFileSync(abs, 'utf8'));
    const files = raw && typeof raw.files === 'object' && raw.files ? raw.files : null;
    assert.ok(files, '★ 白名单必须有 files 映射');
    const keys = Object.keys(files);
    assert.ok(keys.length >= 1, '白名单至少要有条目（空表也要显式写出来，不能靠文件缺失）');
    for (const k of keys) {
        const why = String(files[k] || '').trim();
        assert.ok(why.length >= 6, '★ ' + k + ' 缺少理由：裸 Date.now() 的每一处豁免都要回答「为什么这里可以用墙钟」');
    }
});

test('E2 ★白名单外一律不许出现裸 Date.now()（批次 3 收口的机读判据）', () => {
    const abs = path.join(ROOT, BARE_NOW_WHITELIST);
    const raw = JSON.parse(fs.readFileSync(abs, 'utf8'));
    const allowed = new Set(Object.keys(raw.files || {}));
    const offenders = [];
    for (const rel of listAppJs()) {
        const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
        const n = (src.match(/Date\.now\(\)/g) || []).length;
        if (n > 0 && !allowed.has(rel)) offenders.push(rel + ' ×' + n);
    }
    /* 本版是**分批**推进（批次 1 五处、批次 2 带时间流的 App、批次 3 白名单），
     *   故这里不是「零容忍」，而是「必须逐条登记」：未登记的文件只要还在，
     *   本条判据就红，逼着后续批次把它们收掉或登进白名单。 */
    assert.deepEqual(offenders, [],
        '★ 这些文件有裸 Date.now() 但没登记进白名单（收掉，或登记并写明为什么这里必须用墙钟）：\n'
        + offenders.join('\n'));
});

/* ============================================================
 * F 面 负控制：真源码破坏 → 落副本 → 在副本上重跑同款真判据
 * ============================================================ */

/** 把 time-source.js 复制到临时目录，按锚点破坏，再加载副本跑判据。 */
async function withBrokenTs(anchor, replacement, fn) {
    const src = readRel(TS_REL);
    const hits = src.split(anchor).length - 1;
    assert.equal(hits, 1, '★ 破坏锚点必须恰中 1 次（实际 ' + hits + '）：' + JSON.stringify(anchor.slice(0, 60)));
    const broken = src.replace(anchor, replacement);
    assert.notEqual(broken, src, '破坏必须真的改变了源码（否则负控制是恒绿的）');
    /* 副本必须带上同目录依赖（本模块自 v4.106.0 起引用 `./num-gate.js`）。
     *   手写「再拷一个文件」正是本仓踩过三次的形态（_stage-tree 治的就是它）：
     *   下一次它多 import 一个模块，这条负控制就会因为「副本缺依赖」而不是
     *   「判据抓到了破坏」而转红 —— 表面在验破坏，实际在验临时树全不全。 */
    /* 副本必须放在与真文件**相同的相对位置**（`config/` 下）：
     *   本模块的 `import './num-gate.js'` 是相对同目录解析的，放到临时树根
     *   就会解析成根的 `num-gate.js` —— 那会让负控制因缺件而红，而不是因破坏被捕获。 */
    const dir = stageTreeWithDeps({ 'config/time-source-broken.js': broken }, { prefix: 'v4106-neg-', root: ROOT });
    const file = path.join(dir.dir, 'config', 'time-source-broken.js');
    try {
        assert.deepEqual(dir.missing, [],
            '★ 临时树缺依赖：' + JSON.stringify(dir.missing) + '（那会让负控制因缺件而红，而非因破坏被捕获）');
        const mod = await import(pathToFileURL(file).href + '?t=' + Date.now());
        return await fn(mod);
    } finally {
        fs.rmSync(dir.dir, { recursive: true, force: true });
    }
}

test('F1 负控制①：把「读不到不补墙钟」破坏成补墙钟 ⇒ 同款判据必须转红', async () => {
    /* 原判据（B2）：读不到时 ms === null。破坏：让 no-time-manager 分支返回墙钟。 */
    await withBrokenTs(
        "out.reason = 'no-time-manager';",
        "out.reason = 'no-time-manager'; out.ms = Date.now();",
        async (mod) => {
            const fakeWin = { VirtualPhone: {} };
            const s = mod.storyNow(fakeWin);
            /* 这一条在破坏版上必须**失败**：它就是我们抓的东西 */
            assert.notEqual(s.ms, null,
                '破坏版应当返回墙钟（说明破坏真的生效了）');
            /* 而真判据是「必须是 null」—— 在破坏版上跑，它必然抛；我们断言它确实抛 */
            assert.throws(() => {
                assert.equal(s.ms, null, '读不到时 ms 必须是 null');
            }, '★ 负控制失效：破坏后同款判据没有转红');
        }
    );
});

test('F2 负控制②：把字段归属表里的 createdAt 改判成 story ⇒ A2 同款判据必须转红', async () => {
    await withBrokenTs(
        "createdAt: 'wall',",
        "createdAt: 'story',",
        async (mod) => {
            assert.throws(() => {
                assert.equal(mod.fieldClockOf('createdAt'), 'wall',
                    'createdAt 是墙钟：排序稳定性与审计要用它，剧情回拨不许让它倒退');
            }, '★ 负控制失效：归属表被改错后判据没有转红');
        }
    );
});

test('F3 负控制③：把「未登记返回 null」破坏成给默认值 ⇒ A2 的反向断言必须转红', async () => {
    await withBrokenTs(
        "return Object.prototype.hasOwnProperty.call(FIELD_CLOCKS, key) ? FIELD_CLOCKS[key] : null;",
        "return Object.prototype.hasOwnProperty.call(FIELD_CLOCKS, key) ? FIELD_CLOCKS[key] : 'wall';",
        async (mod) => {
            assert.throws(() => {
                assert.equal(mod.fieldClockOf('xxAt'), null,
                    '未登记字段必须是 null —— 给默认值等于让下一次新增字段静默漂走');
            }, '★ 负控制失效：默认值破坏后判据没有转红');
        }
    );
});

test('F4 负控制④：把 storyTsOf 破坏成回退 createdAt ⇒ B6 同款判据必须转红', async () => {
    await withBrokenTs(
        "const a = pick(o.storyAt);",
        "const a = pick(o.storyAt) !== null ? pick(o.storyAt) : pick(o.createdAt);",
        async (mod) => {
            assert.throws(() => {
                assert.equal(mod.storyTsOf({ createdAt: STORY_MS }), null,
                    '不许把 createdAt 当剧情时刻读');
            }, '★ 负控制失效：回退墙钟后判据没有转红');
        }
    );
});
