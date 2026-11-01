/* ========================================================
 * system-v4112.test.mjs — [v4.111.0 · 第十三期 R13-X8] 复述「我们之前聊过什么」
 * --------------------------------------------------------
 * 本套件守的是 R13-X8 的验收（计划书 §1 该项原文 + §5 共同验收）：
 *   A 口径：停用词只有虚词、长度不倒序就必然分歧、限额与排序写在数据里；
 *   B 引用必须真：`msgs` 每一项都只能来自真聊天里**真有 id** 的行，无 id 行当场丢弃并记账；
 *   C 归并：只有两条规则（楼层间隔 / 时间差），conclusion 是**截取**不是生成，排序确定性；
 *   D 三态与接线：empty 与 unreadable **不同形**、App 在渲染前过引用核对、跳转走唯一出处定位路；
 *   E 负控制（真源码破坏）：把「无 id 行当场丢弃」摘掉 ⇒ 判据必须转红。
 *
 * 【本期最关键的一条在 B4 / E1】
 *   计划书点名的验收是「负控制往 msgs 里塞一个不存在的 id，判据须转红」。
 *   本套件做了两层：B4 手工塞（证明判据这一侧认得出），E1 真源码破坏
 *   （证明这条规矩**真的在代码里**，不是只在判据里写了一遍）。
 *   只做 B4 的话，代码把 id 检查删掉、判据照样绿 —— 那是最典型的假绿。
 * ============================================================ */
'use strict';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temps = [];
process.on('exit', () => { for (const d of temps) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (_e) { /* 清理失败不影响结论 */ } } });

const N = await import(path.join(ROOT, 'config', 'recall-narrative.js'));
const T = await import(path.join(ROOT, 'config', 'recall-narrative-terms.js'));
const L = await import(path.join(ROOT, 'config', 'source-locator.js'));
const AppMod = await import(path.join(ROOT, 'apps', 'recall', 'recall-app.js'));
const ViewMod = await import(path.join(ROOT, 'apps', 'recall', 'recall-view.js'));

/** 固定时刻（本机本地时间构造：`Date.parse` 带 Z 会因时区让 getHours 漂）。 */
const T0 = new Date(2026, 9, 1, 10, 0, 0).getTime();
const MIN = 60000;
const HOUR = 3600000;

/**
 * 主 fixture（六条，含一条**没有 id** 的行）。
 *   楼层 0 a1 ← 命中；1 a2 ← 命中（与 a1 楼近、时间 5min ⇒ 同段）
 *   楼层 2 无 id ← 命中但**必须被丢弃**
 *   楼层 3 a3 ← 不命中
 *   楼层 4 a4 ← 命中（与 a2 楼近但时间差 3h ⇒ 断段）
 *   楼层 5 a5 ← 命中（与 a4 楼近但时间差 40 天 ⇒ 断段）
 * ⇒ 预期 3 段：最新 a5 / 次新 a4 / 最早 a1+a2，共 4 条原话。
 */
function fixture() {
    return [
        { id: 'a1', mes: '她说要搬家，问我哪天有空', timestamp: T0 },
        { id: 'a2', mes: '我说周末吧，那天搬家正好', timestamp: T0 + 5 * MIN },
        { id: '', mes: '这条没有 id，可它确实提到了搬家', timestamp: T0 + 6 * MIN },
        { id: 'a3', mes: '后来聊了点别的，天气不错', timestamp: T0 + 7 * MIN },
        { id: 'a4', mes: '真的搬家了，累了一整天', timestamp: T0 + 3 * HOUR },
        { id: 'a5', mes: '搬家那天下了雨', timestamp: T0 + 40 * 86400000 }
    ];
}

/** 楼层远、时间近：只用来分辨「楼层间隔」这一条规则到底在不在。 */
function fixtureFarFloors() {
    const rows = [{ id: 'm1', mes: '搬家的事', timestamp: T0 }];
    for (let i = 0; i < 7; i += 1) rows.push({ id: 'g' + i, mes: '闲聊一句', timestamp: T0 + 1000 * (i + 1) });
    rows.push({ id: 'm2', mes: '搬家那天下了雨', timestamp: T0 + 1 * MIN });
    return rows;
}

/** 时间不可知的那一条：用来分辨「at=0 排在后面」这条规矩。
 * ★ 必须是**三段**：两段时无论把 at=0 当成最小值还是最大值，
 *   排序比较的结果在符号上都不变 —— 规矩坏没坏看不出来（破坏选错方向＝判据白写）。
 *   三段布局（楼层各隔 8 层 ⇒ 三条规则各自断开）：
 *     floor 0  x1 无时间  ⇒ at=0      （原版排最后 / 破坏后排最前）
 *     floor 8  x2 T0      ⇒ 最新
 *     floor 16 x3 T0-10天 ⇒ 次新 */
function fixtureNoTs() {
    const rows = [{ id: 'x1', mes: '搬家那事我都忘了是哪天' }];
    for (let i = 0; i < 7; i += 1) rows.push({ id: 'g' + i, mes: '闲聊一句' });
    rows.push({ id: 'x2', mes: '搬家那天下了雨', timestamp: T0 });
    for (let i = 0; i < 7; i += 1) rows.push({ id: 'h' + i, mes: '闲聊一句' });
    rows.push({ id: 'x3', mes: '搬家前后忙了三天', timestamp: T0 - 10 * 86400000 });
    return rows;
}

/* ══════════ A 口径 ══════════ */

test('A1 词表件是零 import 叶子，三态与五因由各自闭集且互不重名', () => {
    assert.deepEqual([...Object.values(T.RECALL_NARRATIVE_STATES)].sort(), ['empty', 'ok', 'unreadable']);
    assert.deepEqual([...Object.values(T.RECALL_NARRATIVE_GAPS)].sort(),
        ['bad-id', 'no-chat', 'no-match', 'no-merge', 'no-topic']);
    /* 词表一旦引了别处，改一个停用词就可能连带改算法 —— 故它必须是叶子。 */
    const src = fs.readFileSync(path.join(ROOT, 'config', 'recall-narrative-terms.js'), 'utf8');
    assert.equal(/^\s*import\s/m.test(src), false, '词表件不许 import 任何东西');
    /* 两套闭集不许重叠：同一个词不能既是「结局」又是「因由」。 */
    const st = new Set(Object.values(T.RECALL_NARRATIVE_STATES));
    for (const g of Object.values(T.RECALL_NARRATIVE_GAPS)) assert.equal(st.has(g), false, '两套闭集不许重叠：' + g);
});

test('A2 停用词只剥虚词、且必须长度倒序（两处排序必然分歧）', () => {
    assert.deepEqual(N.topicWordsOf('我们之前聊过搬家的事吗'), ['搬家'], '口水词要剥净，只留实义');
    /* 表自身必须按长度倒序：否则「那时候」会先被短词切碎，剥出一地残渣。
     * 这条不是风格偏好 —— terms 件里排过一次，算法件不再重排（注释明写），排序一错就无第二道防线。 */
    const list = T.RECALL_STOPWORDS;
    for (let i = 1; i < list.length; i += 1) {
        assert.ok(list[i - 1].length >= list[i].length, '停用词表必须长度倒序：' + list[i - 1] + ' / ' + list[i]);
    }
    /* 单字不当主题词：「雨」在每一段聊天里都可能出现，拿它当条件等于没筛。 */
    assert.deepEqual(N.topicWordsOf('雨'), []);
    assert.deepEqual(N.topicWordsOf('我们之前聊过的事'), []);
});

test('A3 主题全是口水词 ⇒ no-topic（不是「没找到」，两件事处置相反）', () => {
    const res = N.narrate('我们之前聊过的事', fixture());
    assert.equal(res.state, 'empty');
    assert.deepEqual(res.gaps, ['no-topic']);
    assert.equal(res.episodes.length, 0);
    /* 宿主没给聊天数组是另一件事：no-chat，不与 no-topic 同形。 */
    const noChat = N.narrate('搬家', null);
    assert.deepEqual(noChat.gaps, ['no-chat']);
});

test('A4 限额与排序写在数据里（算法件不许自己写死一份）', () => {
    assert.equal(T.RECALL_LIMITS.minMsgs, 1, '一条也算「提过」（宁可复述得笨）');
    assert.equal(T.RECALL_LIMITS.maxMsgs, 12, '一段引用太多条就不是复述了');
    assert.equal(T.RECALL_LIMITS.minTopicLen, 2);
    assert.equal(T.RECALL_LIMITS.mergeGapFloors, 6);
    assert.equal(T.RECALL_LIMITS.mergeGapMs, 45 * MIN);
    assert.equal(T.RECALL_LIMITS.conclusionMaxChars, 120);
    assert.equal(T.RECALL_ORDER.byRecentFirst, true);
    /* 算法件把这些常量**读自** terms，不许在本地再写一遍数字。 */
    const src = fs.readFileSync(path.join(ROOT, 'config', 'recall-narrative.js'), 'utf8');
    assert.equal(/45\s*\*\s*60\s*\*\s*1000/.test(src), false, 'mergeGapMs 不许在算法件里重算一遍');
});

/* ══════════ B 引用必须真 ══════════ */

test('B1 每个 episode 的 msgs 必须全部是从真聊天里取得的真实 id', () => {
    const chat = fixture();
    const res = N.narrate('搬家', chat);
    assert.equal(res.state, 'ok');
    const live = new Set(chat.map((m) => m.id).filter(Boolean));
    assert.ok(res.episodes.length > 0);
    for (const ep of res.episodes) {
        for (const id of ep.msgs) {
            assert.equal(typeof id, 'string');
            assert.ok(id.length > 0, 'msgs 里不许出现空串（那等于编了一条点不回去的）');
            assert.ok(live.has(id), '这个 id 在真聊天里不存在：' + id);
        }
    }
});

test('B2 没有 id 的行当场丢弃并记 bad-id（不给空串充数，也不假装没看见）', () => {
    const chat = fixture();
    const res = N.narrate('搬家', chat);
    assert.ok(res.gaps.includes('bad-id'), '丢弃要记账：用户得知道少了一条');
    /* 那条行确实被扫过（scanned 含它），但一条都没交出去。 */
    assert.equal(res.scanned, 6);
    const all = res.episodes.reduce((a, e) => a.concat(e.msgs), []);
    assert.equal(all.includes(''), false);
    assert.equal(all.length, 4, '5 条命中有 id 的里，段内合计应为 4 条（a1/a2/a4/a5）');
});

test('B3 引用核对：正常结果通过，且数得出核过几条', () => {
    const chat = fixture();
    const res = N.narrate('搬家', chat);
    const audit = N.auditCitations(res.episodes, chat);
    assert.equal(audit.ok, true);
    assert.equal(audit.checked, 4);
    assert.deepEqual(audit.bad, []);
});

test('B4 ★负控制（手工塞）：往 msgs 里塞一个不存在的 id，引用核对该转红', () => {
    const chat = fixture();
    const res = N.narrate('搬家', chat);
    const cloned = JSON.parse(JSON.stringify(res));
    cloned.episodes[0].msgs.push('ghost-9999');
    const audit = N.auditCitations(cloned.episodes, chat);
    assert.equal(audit.ok, false, '塞了不存在的 id 必须转红');
    assert.deepEqual(audit.bad, ['ghost-9999']);
    assert.equal(audit.checked, 5, '塞进去的那一条也要被数进去核');
    /* 原结果仍通过 —— 证明转红是「塞」导致的，不是核对面本身有问题。 */
    assert.equal(N.auditCitations(res.episodes, chat).ok, true);
});

test('B5 空结果与重复引用：不许因空而假红，也不许因重复而假红', () => {
    assert.deepEqual(N.auditCitations([], fixture()), { ok: true, checked: 0, bad: [] });
    const chat = fixture();
    const res = N.narrate('搬家', chat);
    const dup = JSON.parse(JSON.stringify(res));
    dup.episodes[0].msgs.push(dup.episodes[0].msgs[0]);
    const audit = N.auditCitations(dup.episodes, chat);
    assert.equal(audit.ok, true, '重复引用仍是真 id，不该转红');
    assert.equal(audit.checked, 5, '重复的也要数');
});

/* ══════════ C 归并 ══════════ */

test('C1 两条规则合起来定段：楼近 + 时间近才算同一段', () => {
    const res = N.narrate('搬家', fixture());
    assert.equal(res.episodes.length, 3, '应当收成 3 段');
    /* 时间倒序：最新那段在最前。 */
    assert.deepEqual(res.episodes[0].msgs, ['a5']);
    assert.deepEqual(res.episodes[1].msgs, ['a4']);
    assert.deepEqual(res.episodes[2].msgs, ['a1', 'a2'], '楼近且时间近的两条合成一段');
    /* floors 与 msgs 一一对应（跳转要用它，错位就点到别的楼）。 */
    for (const ep of res.episodes) assert.equal(ep.floors.length, ep.msgs.length);
    assert.deepEqual(res.episodes[2].floors, [0, 1]);
});

test('C2 楼层间隔是硬条件：隔得远的两条，时间再近也不许并成一段', () => {
    const res = N.narrate('搬家', fixtureFarFloors());
    assert.equal(res.episodes.length, 2, '楼层隔了 8 层：不许并');
    assert.equal(res.episodes.length === 2 && res.episodes[0].msgs.length === 1, true);
});

test('C3 时间差也是硬条件：楼挨着但隔了 46 分钟就断开', () => {
    const near = [
        { id: 'n1', mes: '搬家的事', timestamp: T0 },
        { id: 'n2', mes: '搬家那天', timestamp: T0 + 44 * MIN }
    ];
    assert.equal(N.narrate('搬家', near).episodes.length, 1, '44 分钟内算同一段');
    const far = [
        { id: 'f1', mes: '搬家的事', timestamp: T0 },
        { id: 'f2', mes: '搬家那天', timestamp: T0 + 46 * MIN }
    ];
    assert.equal(N.narrate('搬家', far).episodes.length, 2, '46 分钟外断开');
});

test('C4 conclusion 是截取不是生成：取该段最后一条原话，超长加省略号，取不到交空串', () => {
    const res = N.narrate('搬家', fixture());
    const seg = res.episodes.find((e) => e.msgs.length === 2);
    assert.equal(seg.conclusion, '我说周末吧，那天搬家正好', '结论必须是该段最后一条的原话');
    /* 超长：截到上限 + 一个省略号（不是缩写成一句新话）。 */
    const longBody = '搬家'.repeat(100);
    const one = N.conclusionOf([{ body: longBody }]);
    assert.equal(one.length, T.RECALL_LIMITS.conclusionMaxChars + 1);
    assert.equal(one.slice(-1), '…');
    assert.equal(longBody.startsWith(one.slice(0, -1)), true, '省略号前必须是原文前缀，不许改写');
    /* 取不到就交空串 —— 空 conclusion 是允许的（不知结论 ≠ 没有这段回忆）。 */
    assert.equal(N.conclusionOf([]), '');
    assert.equal(N.conclusionOf(null), '');
    assert.equal(N.conclusionOf([{ body: '   ' }]), '');
});

test('C5 排序确定性：同一份数据跑两次逐字相同；时间不可知的排在后面（不替用户编日期）', () => {
    const a = JSON.stringify(N.narrate('搬家', fixture()));
    const b = JSON.stringify(N.narrate('搬家', fixture()));
    assert.equal(a, b, '同一份数据两次必须逐字相同');
    const res = N.narrate('搬家', fixtureNoTs());
    assert.equal(res.episodes.length, 3);
    assert.ok(res.episodes[0].at > 0, '知道时间的那段排在前');
    assert.equal(res.episodes[res.episodes.length - 1].at, 0, '时间不可知的排最后（混进时间序＝编日期）');
    /* 顺便钉住中间那段也按时间倒序，而不是按楼层。 */
    assert.ok(res.episodes[1].at > res.episodes[2].at, '次新在前、未知在后');
});

/* ══════════ D 三态与接线 ══════════ */

test('D1 三态互不同形：读不出来不等于没聊过', () => {
    const empty = N.narrativeLine({ state: 'empty', episodes: [], scanned: 12 });
    const bad = N.narrativeLine({ state: 'unreadable', episodes: [], scanned: 0 });
    const ok = N.narrativeLine(N.narrate('搬家', fixture()));
    assert.equal(new Set([empty, bad, ok]).size, 3, '三态必须三种说法');
    assert.ok(bad.includes('这不等于没有聊过'), '读不出来的文案必须明说「不等于没有」');
    assert.equal(bad.includes('没找到'), false, '读不出来不许说成「没找到」');
    assert.ok(ok.includes('收成 3 段'));
});

test('D2 App 层：空主题报 no-topic，聊天读不出来报 unreadable 且带 readError', () => {
    const app = newApp();
    const blank = app.narrate('   ');
    assert.equal(blank.state, 'empty');
    assert.deepEqual(blank.gaps, ['no-topic']);
    const saved = globalThis.SillyTavern;
    try {
        globalThis.SillyTavern = { getContext: () => ({}) };
        const res = app.narrate('搬家');
        assert.equal(res.state, 'unreadable');
        assert.deepEqual(res.gaps, ['no-chat']);
        assert.ok(res.readError.includes('这不等于没有聊过'));
        assert.equal(res.episodes.length, 0);
    } finally {
        if (saved === undefined) delete globalThis.SillyTavern; else globalThis.SillyTavern = saved;
    }
});

test('D3 App 层：正常复述给出读数行，且每一段都带得住出处', () => {
    const app = newApp();
    const saved = globalThis.SillyTavern;
    try {
        globalThis.SillyTavern = { getContext: () => ({ chat: fixture() }) };
        const res = app.narrate('我们之前聊过搬家的事吗');
        assert.equal(res.state, 'ok');
        assert.equal(res.readError, '');
        assert.ok(res.line.includes('翻过 6 条'), '要报翻了多少条：' + res.line);
        assert.ok(res.line.includes('收成 3 段'));
        assert.ok(res.line.includes('共 4 条原话'));
        assert.equal(res.gaps.includes('bad-id'), true, '无 id 那条被丢弃要如实记账');
    } finally {
        if (saved === undefined) delete globalThis.SillyTavern; else globalThis.SillyTavern = saved;
    }
});

test('D4 App 在渲染前过引用核对：不过就一条都不交（这条不许只写在判据里）', () => {
    const src = fs.readFileSync(path.join(ROOT, 'apps', 'recall', 'recall-app.js'), 'utf8');
    const iAudit = src.indexOf('if (!audit.ok)');
    const iGive = src.indexOf('return { state: res.state, episodes: res.episodes');
    assert.ok(iAudit > 0, 'App 要真的核一遍引用');
    assert.ok(iGive > 0);
    assert.ok(iAudit < iGive, '核对必须在交结果之前');
    const seg = src.slice(iAudit, iGive);
    assert.ok(seg.includes('episodes: []'), '不过就交空 list');
    assert.ok(seg.includes('一条都不给'), '要说清「这次一条都不给」');
});

test('D5 视图接线：第五页签 + 输入框 + 每条原话可点，且输入时只记不跑', () => {
    const src = fs.readFileSync(path.join(ROOT, 'apps', 'recall', 'recall-view.js'), 'utf8');
    assert.ok(src.includes("{ key: 'narrate', label: '复述' }"), '必须有复述页签');
    assert.ok(src.includes('data-act="nar-run"'), '必须有「问一句」按钮');
    assert.ok(src.includes('data-act="nar-jump"'), '每条原话必须可点');
    assert.ok(src.includes('data-nar-id=') && src.includes('data-nar-floor='), '要挂靶心属性');
    /* 输入时只记不跑：每键都跑等于每键扫一遍整段聊天。 */
    const iCh = src.indexOf("if (k === 'nar-topic')");
    const seg = src.slice(iCh, iCh + 420);
    assert.equal(seg.includes('app.narrate'), false, 'change 里不许跑复述');
    /* 渲染实算：把真结果塞进去看一眼 HTML。 */
    const app = newApp();
    const saved = globalThis.SillyTavern;
    try {
        globalThis.SillyTavern = { getContext: () => ({ chat: fixture() }) };
        const view = new ViewMod.RecallView(app, {}, { get: () => null, set: () => true });
        view._narrate = app.narrate('搬家');
        const html = view._narratePanel();
        assert.ok(html.includes('data-nar-id="a1"'), '第一条原话要挂真 id');
        assert.ok(html.includes('data-nar-floor="0"'), '第一条原话要挂真楼层（0 是合法楼层）');
        assert.ok(html.includes('第 1 条'), '人话要按 1 起数（内部 0 起，界面不摊给用户）');
        assert.ok(html.includes('当时说到：'), '结论要摆出来');
    } finally {
        if (saved === undefined) delete globalThis.SillyTavern; else globalThis.SillyTavern = saved;
    }
});

test('D6 跳回原位置走唯一出处定位路：楼层未知不编 0，而 0 本身是合法楼层', () => {
    /* 0 是第 1 楼 —— 拿 0 顶替「不知道」会把用户送到错的地方。 */
    assert.equal(L.normalizeSource({ ref: 'a1', floor: 0 }).state, 'chat');
    assert.equal(L.normalizeSource({ ref: 'a1', floor: null }).state, 'memory');
    assert.equal(L.normalizeSource({ ref: 'a1' }).state, 'memory');
    /* 宿主没有定位口 ⇒ 报 location-unavailable，不许报成功。 */
    const noHost = L.locateTarget(L.normalizeSource({ ref: 'a1', floor: 3 }), {});
    assert.equal(noHost.ok, false);
    assert.equal(noHost.reason, 'location-unavailable');
    /* 宿主不回报 ⇒ 也算没成（本仓最贵的缺陷形态：不报错、只默默没生效）。 */
    const silent = L.locateTarget(L.normalizeSource({ ref: 'a1', floor: 3 }), { locateChatFloor: () => undefined });
    assert.equal(silent.ok, false);
    assert.equal(silent.reason, 'host-silent');
    const ok = L.locateTarget(L.normalizeSource({ ref: 'a1', floor: 3 }), { locateChatFloor: () => ({ ok: true }) });
    assert.equal(ok.ok, true);
    /* 视图侧不许自己造第二条路：必须用这两件，且楼层空串时给 null。 */
    const src = fs.readFileSync(path.join(ROOT, 'apps', 'recall', 'recall-view.js'), 'utf8');
    assert.ok(src.includes('normalizeSource(') && src.includes('locateTarget('));
    assert.ok(src.includes("(flRaw === '') ? null : Number(flRaw)"), '楼层未知要给 null，不给 0');
    assert.equal(src.includes("buildOpenDetail('wechat'"), false, '不许另开一条跳转路');
});

test('D7 时间人话：不可知就说不可知，不编日期', () => {
    const app = newApp();
    const view = new ViewMod.RecallView(app, {}, { get: () => null, set: () => true });
    assert.equal(view._dayLabel(0), '时间不可知');
    assert.equal(view._dayLabel(null), '时间不可知');
    assert.equal(view._dayLabel(-1), '时间不可知');
    assert.equal(view._dayLabel(T0), '2026-10-01 10:00');
});

/* ══════════ E 负控制（真源码破坏） ══════════ */

/** 造一棵真目录结构的暂存树（副本按真相对路径落盘，相对 import 才解得了）。
 * ★ 依赖清单是**手工白名单**：本组要测的两件内核所 import 的每一件都得在树里，
 *   少一件就是 MODULE_NOT_FOUND —— 那时判据根本没跑到，破坏有没有发生已经不重要了（典型假红）。 */
function stageTree() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rp_v4112_'));
    temps.push(dir);
    fs.mkdirSync(path.join(dir, 'config'), { recursive: true });
    for (const f of ['num-gate.js', 'recall-narrative.js', 'recall-narrative-terms.js']) {
        fs.copyFileSync(path.join(ROOT, 'config', f), path.join(dir, 'config', f));
    }
    return dir;
}

/** 定点破坏：锚点必须恰中一次，否则「破坏」本身就不确定在破什么。 */
function damage(rel, from, to) {
    const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    const n = src.split(from).length - 1;
    assert.equal(n, 1, '破坏锚点必须恰中一次：' + rel + ' -> ' + String(n) + ' 次');
    const dir = stageTree();
    fs.writeFileSync(path.join(dir, rel), src.split(from).join(to), 'utf8');
    return dir;
}

test('E1 破坏「无 id 行当场丢弃」⇒ 产出 msgs 含空串，引用核对必须转红（本期最关键）', async () => {
    /* 这是本期唯一不许退让的一条：归并得笨没人受损，交出一条点不回去的原话就是编。
     * 破坏的是真源码里那一行 `continue` —— 摘掉它，无 id 的行就会带着空串进 hits。 */
    const dir = damage('config/recall-narrative.js',
        'if (!id) { gaps.push(RECALL_NARRATIVE_GAPS.BAD_ID); continue; }',
        'if (!id) { gaps.push(RECALL_NARRATIVE_GAPS.BAD_ID); }');
    const broke = await import(path.join(dir, 'config', 'recall-narrative.js'));
    const chat = fixture();
    /* 原版：一条空串都不交，核对通过。 */
    const real = N.narrate('搬家', chat);
    const realAudit = N.auditCitations(real.episodes, chat);
    assert.equal(realAudit.ok, true);
    assert.equal(real.episodes.reduce((a, e) => a.concat(e.msgs), []).includes(''), false);
    /* 破坏版：空串被交出去了 —— 引用核对**必须转红**，否则这条判据是摆设。 */
    const bad = broke.narrate('搬家', chat);
    const all = bad.episodes.reduce((a, e) => a.concat(e.msgs), []);
    assert.ok(all.includes(''), '破坏后空串进了 msgs（证明破坏生效）');
    const badAudit = broke.auditCitations(bad.episodes, chat);
    assert.equal(badAudit.ok, false, '★ 交出不存在的 id 必须转红 —— 这条不红，本期等于白做');
    assert.ok(badAudit.bad.includes(''), '要把那一条点不回去的 id 报出来');
});

test('E2 破坏「时间不可知的排在后面」⇒ 它会跑到最前（等于替用户编了个日期）', async () => {
    /* ★ 破坏必须**两支同时**改：比较器是对称的，只把 `ta` 换成最大值会让
     *   `cmp(a,b)` 与 `cmp(b,a)` 给出相反的符号（不对称比较器），排序结果依赖
     *   引擎的调用顺序 —— 那时「破坏生效了没」测得出来，「破坏的后果」测不出来。
     *   这类「破坏只改了一半」是本仓假绿第四形：判据红了，红的原因却不是它要守的东西。 */
    const dir = damage('config/recall-narrative.js',
        '        const ta = a.at > 0 ? a.at : -1;\n        const tb = b.at > 0 ? b.at : -1;',
        '        const ta = a.at > 0 ? a.at : Number.MAX_SAFE_INTEGER;\n        const tb = b.at > 0 ? b.at : Number.MAX_SAFE_INTEGER;');
    const broke = await import(path.join(dir, 'config', 'recall-narrative.js'));
    const rows = fixtureNoTs();
    const real = N.narrate('搬家', rows);
    assert.equal(real.episodes.length, 3);
    assert.equal(real.episodes[0].at > 0, true, '原版：知道时间的在前');
    assert.equal(real.episodes[2].at, 0, '原版：不知道时间的在最后');
    const bad = broke.narrate('搬家', rows);
    assert.equal(bad.episodes[0].at, 0, '破坏版：不知道时间的被当成最新（证明破坏生效）');
    assert.equal(real.episodes[2].at, 0, '原版仍为 0，差异只来自排序');
});

test('E3 破坏「楼层间隔」这条规则 ⇒ 隔了八层的两条会被并成一段', async () => {
    const dir = damage('config/recall-narrative.js',
        'const gapFloors = h.floor - prev.floor;',
        'const gapFloors = 0;');
    const broke = await import(path.join(dir, 'config', 'recall-narrative.js'));
    const rows = fixtureFarFloors();
    assert.equal(N.narrate('搬家', rows).episodes.length, 2, '原版：楼层隔得远必须断开');
    assert.equal(broke.narrate('搬家', rows).episodes.length, 1, '破坏版：并成一段（证明这条规则真管事）');
});

test('E4 破坏「停用词剥离」⇒ 口水词会被当成主题词，命中面立刻失真', async () => {
    /* 破坏对象只能是**表本身**：往 topicWordsOf 里加一行注释不改行为，那不叫破坏
     * （本仓已记的假绿三形之一：破坏写死成常量，真判据根本没被调用）。
     * 故本件不走 damage()，直接按真文件把表掏空后落进暂存树。 */
    const dir2 = stageTree();
    const termsSrc = fs.readFileSync(path.join(ROOT, 'config', 'recall-narrative-terms.js'), 'utf8');
    const anchor = 'export const RECALL_STOPWORDS = Object.freeze([';
    assert.equal(termsSrc.split(anchor).length - 1, 1, '锚点必须恰中一次');
    const gutted = termsSrc.replace(/export const RECALL_STOPWORDS = Object\.freeze\(\[[\s\S]*?\]\.sort\(\(a, b\) => b\.length - a\.length\)\);/,
        'export const RECALL_STOPWORDS = Object.freeze([].sort((a, b) => b.length - a.length));');
    fs.writeFileSync(path.join(dir2, 'config', 'recall-narrative-terms.js'), gutted, 'utf8');
    const broke = await import(path.join(dir2, 'config', 'recall-narrative.js'));
    /* 原版：口水词剥净，只剩「搬家」。 */
    assert.deepEqual(N.topicWordsOf('我们之前聊过搬家的事吗'), ['搬家']);
    /* 破坏版：一个词都没剥，**整句**成了一个主题词 —— 因为切分只按标点与空白，
     * 而这句话里没有标点。于是匹配从「认搬家」退化成「要整句原样出现」。 */
    const words = broke.topicWordsOf('我们之前聊过搬家的事吗');
    assert.deepEqual(words, ['我们之前聊过搬家的事吗'], '破坏后整句成了一个主题词（证明破坏生效）');
    assert.equal(words.includes('我们'), false, '整句成词时「我们」不会单独出现 —— 本条的失真形是「整句成词」，不是「留下单个虚词」');
    /* 失真后果要实测出来：同一份聊天，原版收成 3 段，破坏版一条都命中不了。 */
    const chat = fixture();
    assert.equal(N.narrate('我们之前聊过搬家的事吗', chat).episodes.length, 3, '原版：能收出段');
    assert.equal(broke.narrate('我们之前聊过搬家的事吗', chat).episodes.length, 0, '破坏版：整句成词后一条都命中不了');
});

/* ══════════ 造 App（不碰 DOM：本套件只验数据与串） ══════════ */

function newApp() {
    const store = new Map();
    const storage = {
        get: (k) => (store.has(k) ? store.get(k) : null),
        set: (k, v) => { store.set(k, v); return true; },
        remove: (k) => { store.delete(k); return true; }
    };
    return new AppMod.RecallApp({}, storage);
}
