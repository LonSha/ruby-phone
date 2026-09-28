// tests/system-v3212.test.mjs — G-4 余量：剧情时刻面的下游接线 + 单一取数口（v3.10.2）
//
//   本版治一个**「建好不消费」**（本仓第九次同形）与一处**取数口散落**：
//     ① G-4（v3.10.0）把三处时间读数（WorldAxis 世界钟 / 插件剧情日期 / 日历当天）
//        收成单一读数面 `config/story-clock.js`，实测**只有诊断中心在读** —— 业务面零消费；
//        于是「这些事发生在哪一天」在织光机与世界脉搏上无据可判，只能拿现实日期猜；
//     ② 日历取数探针（读 `calendarApp.currentStoryDate()`）写在诊断内核里；本版世界脉搏
//        与织光机也要读同一面 ⇒ 三处各写一份必然漂移（v2.97 的 7 份 probeBridge 各自为政）。
//        故取数口上收到真源 `storyClockProbe()`。
//
//   ★ 本仓的老账（写进判据，防止再犯）：
//     ① **「读到但读不出」必须说出来** —— `unusable`（有面却读不出）不得与
//        「桥没装 / 这一层没给」同形；把前者当后者处置就是静默降级。
//     ② **不建卡 ≠ 显示 0** —— 缺席时不建卡，而不是画一张写着「0」的卡。
//     ③ **同一口径只许一份实现** —— 日历取数探针只许有一个真源。
//     ④ **缺席不并入 empty** —— 剧情侧有时间读数、本机没有生活碎片，不是「什么都没有」。
//     ⑤ **负控制须打在真源码上** —— 破坏必须落在真文件文本、判据在破坏副本上重跑
//        （本仓抓过的三种假绿：对原文件断言 / 破坏写死成常量 / 破坏把判据自己废掉）。
//
//   覆盖：
//     A 真源探针：导出在场 / 真取数 / 不抛 / 不猜
//     B 收集器时间面：建卡与不建卡三态
//     C 一致性三态透传（与真源逐值同源）
//     D 织光机接线（收集器两条路径 + 视图真消费 + 渲染串）
//     E 世界脉动接线（两条返回路径 + 视图真消费）
//     F 取数口唯一（诊断内核不再自写探针）
//     G 负控制两条（真源码破坏 → 破坏副本 → 同款真判据必须转红）
//     H 版本锚
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const readRel = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

/** 收集器测试用的 mock storage（与 tests/timeweaver-collector.test.mjs 同规格）。 */
function mockStorage(map = {}, ctx = null) {
    return { get: (k) => (map[k] ?? null), getContext: () => ctx };
}

/** WorldAxis 桥的**最小真形态桩**（拉取型：`snapshot` 是函数、`stat()` 自述已发布）。
 *  ★ 桩必须照真接口写：`readPublished()` 对拉取型只认 `stat().published`，
 *    直接把 `snapshot` 挂成对象会被判成 unknown（那是「没物」，不是「有物」）。 */
const waWin = (iso, label) => ({
    worldaxis_bridge_v1: {
        version: '1',
        bridge: 'worldaxis_bridge_v1',
        snapshot: () => ({ worldClock: { iso, label: label || iso } }),
        stat: () => ({ published: true, invalidated: false })
    }
});

/** 让 WorldAxis 源落进「**有面**但读不出时间面」的最小桩（实测归因 `face-absent`）。
 *  【为什么不用 `unusable` 桩】实测该态在探针路径上不可达：上游 `readWorldAxisSnapshot` /
 *  `readPushProbe` / `readWorldClock` 每层都有 try/catch 兜底，桩里的异常一律被降成
 *  `face-absent` 或 `pull-failed`。把判据挂在不可达态上就是「空集合上的判据」——
 *  本判据因此改钉「**有面**」这一可验证的档（`snapshot` 在场且自述已发布、
 *  但快照里没有可读的时间面）。 */
const faceAbsentWin = () => ({
    worldaxis_bridge_v1: {
        version: '1',
        bridge: 'worldaxis_bridge_v1',
        snapshot: () => new Proxy({}, { get() { throw new Error('face-unreadable'); } }),
        stat: () => ({ published: true, invalidated: false })
    }
});

/* ══════════ A ── 真源探针 ══════════ */
test('A1 ★ storyClockProbe 在真源且已被 default 导出（取数口上收，不得散落）', async () => {
    const SC = await import('../config/story-clock.js');
    assert.equal(typeof SC.storyClockProbe, 'function', '真源必须导出 storyClockProbe');
    assert.equal(typeof SC.default.storyClockProbe, 'function', '★ default 出口也要带（漏了会静默 undefined）');
    const src = readRel('config/story-clock.js');
    assert.ok(/export function storyClockProbe\(win\)/.test(src), '具名导出在场');
    assert.equal(src.split('export function storyClockProbe(').length - 1, 1,
        '★ 探针只许有一份实现（出现次数实测 ' + (src.split('export function storyClockProbe(').length - 1) + '）');
});

test('A2 ★ 探针真取数（不是空对空）、不抛、不猜', async () => {
    const SC = await import('../config/story-clock.js');

    /* ① 无宿主：如实 null，不抛 */
    const bare = SC.storyClockProbe({});
    assert.ok(bare && typeof bare === 'object', '返回对象');
    assert.equal(typeof bare.calendarSource, 'function', '必须给出取数函数');
    assert.equal(bare.calendarSource(), null, '★ 无宿主 ⇒ null（不是「今天是某天」）');

    /* ② 有宿主：**必须真调用**宿主取数口（防「桩没被调」的假绿 —— 空集合上的判据永远成立） */
    let calls = 0;
    const win = { VirtualPhone: { calendarApp: { currentStoryDate() { calls += 1; return { date: '3月15日', label: '3月15日', source: 'calendar' }; } } } };
    const p = SC.storyClockProbe(win);
    assert.equal(p.win, win, '注入的宿主必须原样带出（调用方据此交给 storyClock）');
    const v = p.calendarSource();
    assert.equal(calls, 1, '★ 探针必须真调用宿主取数口（实测调用 ' + calls + ' 次）');
    assert.deepEqual(v, { date: '3月15日', label: '3月15日', source: 'calendar' }, '形状对齐 calendarClock 契约');

    /* ③ 宿主抛错 ⇒ 如实 null（不抛） */
    const thrown = { VirtualPhone: { calendarApp: { currentStoryDate() { throw new Error('boom'); } } } };
    assert.equal(SC.storyClockProbe(thrown).calendarSource(), null, '★ 宿主抛错不得外抛');

    /* ④ 取到空串 ⇒ null（「取不到」与「取到空」都不算读数） */
    const blank = { VirtualPhone: { calendarApp: { currentStoryDate: () => '   ' } } };
    assert.equal(SC.storyClockProbe(blank).calendarSource(), null, '空串 ⇒ null');

    /* ⑤ 字符串形返回值也要被归一成契约形状（对齐 G-4 首版诊断内核的行为） */
    const strWin = { VirtualPhone: { calendarApp: { currentStoryDate: () => '6月1日' } } };
    const sv = SC.storyClockProbe(strWin).calendarSource();
    assert.equal(sv.date, '6月1日');
    assert.equal(sv.source, 'calendar');

    /* ⑥ 不猜：探针返回体里不得出现被顶替的日期字段 */
    assert.equal('date' in bare, false, '★ 探针不得自造 date（那是「拿现实时间顶替剧情时间」的入口）');
    assert.equal('today' in bare, false, '不得自造 today');
});

/* ══════════ B ── 收集器时间面：建卡与不建卡 ══════════ */
test('B1 ★ 有源给出日期 ⇒ 建卡，且读数与真源同源', async () => {
    const TWC = await import('../apps/timeweaver/timeweaver-collector.js');
    const SC = await import('../config/story-clock.js');
    const win = waWin('2026-03-15');
    const f = TWC.collectStoryClock(win);
    assert.ok(f, '★ 世界钟在场 ⇒ 必须建卡');
    assert.equal(f.present, 1, '一源给出日期（实测 ' + f.present + '）');
    assert.equal(f.primary, 'worldaxis', '确定性 primary：世界钟优先');
    assert.equal(f.primaryDate, '2026-03-15', 'primaryDate 是该源**原值**');
    assert.equal(f.verdict, '无法验证', '★ 只有一处给得出日期 ⇒ 无法交叉验证');
    assert.ok(Array.isArray(f.sources) && f.sources.length === SC.CLOCK_SOURCES.length,
        '★ 逐源行必须齐全（实测 ' + (f.sources || []).length + ' / ' + SC.CLOCK_SOURCES.length + '）'
        + ' —— 少于全量就是「空集合上的判据」');
    /* 逐值同源：同一 win 下与真源出口逐字一致（防消费侧自己重算） */
    const probe = SC.storyClockProbe(win);
    const live = SC.storyClock({ win: probe.win, calendarSource: probe.calendarSource });
    const line = SC.storyClockLine(live);
    assert.equal(f.text, live.text, '★ 文案必须逐字取自真源，不得在消费侧重写');
    assert.equal(f.detail, line.detail, '逐源在场性取自真源');
    assert.equal(f.conflict, live.conflict);
    const wa = f.sources.find((s) => s.key === 'worldaxis');
    assert.equal(wa.state, 'ok', '该源在场');
    assert.equal(wa.date, '2026-03-15', '原值带出');
    assert.ok(wa.reasonText, '★ 归因文案必须带出（取自真源 CLOCK_REASONS，缺项即原样显示 state）');
});

test('B2 ★ 三源全缺且都不是「本机问题面」 ⇒ 不建卡（不写「今天是 0 号」）', async () => {
    const TWC = await import('../apps/timeweaver/timeweaver-collector.js');
    assert.equal(TWC.collectStoryClock({}), null, '★ 桥没装 / 这一层没给 ⇒ 不建卡，而不是画一张空卡');
    assert.equal(TWC.collectStoryClock(undefined), null, '缺省入参同样不建卡');
});

test('B3 ★ 「有面却读不出」必须建卡（unusable 不得被当成「没装」吞掉）', async () => {
    const TWC = await import('../apps/timeweaver/timeweaver-collector.js');
    const f = TWC.collectStoryClock(faceAbsentWin());
    assert.ok(f, '★ 「有面却读不出时间面」是本机/本版的事实，必须建卡说清楚 —— 否则就是静默降级');
    const bad = (f.sources || []).filter((s) => s.state !== 'ok');
    assert.equal(bad.length, 3, '三源都该如实带出归因（实测 ' + bad.length + ' 行非 ok）');
    assert.ok(f.sources.find((s) => s.key === 'worldaxis').state === 'face-absent', 'WorldAxis 归因如实');
    assert.ok(bad.every((s) => s.reasonText && s.reasonText.length > 0), '★ 每行都必须带归因文案（取自真源）');
    assert.equal(f.present, 0, '没有任何一源给出日期');
    /* 反例对照：真·缺席（无宿主）不建卡 —— 两类状态**必须不同形** */
    assert.equal(TWC.collectStoryClock({}), null, '对照：真缺席时不建卡（两类状态不同形）');
});

test('B4 建卡时逐源只带原值与归因，不自造日期（「不猜」在消费侧也成立）', async () => {
    const TWC = await import('../apps/timeweaver/timeweaver-collector.js');
    const f = TWC.collectStoryClock(faceAbsentWin());
    for (const s of f.sources) {
        if (s.state !== 'ok') assert.equal(s.date, null, '★ 未给出日期的源，date 必须是 null（实测 ' + JSON.stringify(s.date) + '）');
    }
    const f2 = TWC.collectStoryClock({});
    assert.equal(f2, null);
});

/* ══════════ C ── 一致性三态透传 ══════════ */
test('C1 ★ 两源一致 / 两源冲突 / 无法验证：三者必须不同形', async () => {
    const TWC = await import('../apps/timeweaver/timeweaver-collector.js');
    const SC = await import('../config/story-clock.js');
    const src = () => ({ date: '3月15日', label: '3月15日', source: 'calendar' });

    /* 两源一致：世界钟出 ISO 形、日历出中文形，同一天必须对上 */
    const winSame = waWin('2026-03-15');
    const f1 = TWC.collectStoryClock(winSame);
    /* 用真源把日历也放进来的写法（收集器只接受 win；此处直接对照真源出口的三态） */
    const live1 = SC.storyClock({ win: SC.storyClockProbe(winSame).win, calendarSource: src });
    assert.equal(live1.present, 2, '两源在位（实测 ' + live1.present + '）');
    assert.equal(live1.agree, true, '同一天的不同写法必须判为一致');
    assert.equal(live1.conflict, false);
    assert.equal(f1.present, 1, '（收集器无日历宿主 ⇒ 一源）');

    /* 两源冲突 */
    const winBad = waWin('2026-03-15');
    const live2 = SC.storyClock({ win: winBad, calendarSource: () => ({ date: '2026年06月01日', source: 'calendar' }) });
    assert.equal(live2.agree, false, '★ 两源日期不同 ⇒ agree false');
    assert.equal(live2.conflict, true, '★ 必须显式报冲突');
    assert.ok(/不一致/.test(live2.text), '文案必须报不一致');

    /* 无法验证 */
    const live3 = SC.storyClock({ calendarSource: src, win: {} });
    assert.equal(live3.agree, null, '★ 来源不足两个 ⇒ agree 必须是 null（不是 true）');
    assert.equal(live3.conflict, false, '没能比 ⇒ 不得报冲突');
});

test('C2 ★ 收集器不重判一致性：verdict 逐字取自真源三态', async () => {
    const TWC = await import('../apps/timeweaver/timeweaver-collector.js');
    const SC = await import('../config/story-clock.js');
    const win = waWin('2026-03-15');
    const f = TWC.collectStoryClock(win);
    const probe = SC.storyClockProbe(win);
    const live = SC.storyClock({ win: probe.win, calendarSource: probe.calendarSource });
    assert.equal(f.verdict, SC.storyClockLine(live).verdict, '★ verdict 只许来自真源');
    const src = readRel('apps/timeweaver/timeweaver-collector.js');
    /* 消费侧不得自写一致性判定（那是「同一口径两份实现」的入口） */
    assert.equal(/conflict\s*=\s*/.test(src), false, '★ 收集器不得自算 conflict');
    assert.equal(/agree\s*=\s*/.test(src), false, '★ 收集器不得自算 agree');
});

/* ══════════ D ── 织光机接线 ══════════ */
test('D1 ★ 两条返回路径都带出时间面，且不并入 empty 判定', async () => {
    const src = readRel('apps/timeweaver/timeweaver-collector.js');
    /* 【v3.20.0 修订】原判据钉「`storyClock: clockFace` 恰出现 2 次」——那是在数**转写**。
     *   v3.20.0 新增第六面（续玩简报）后，两个返回分支各多带一个 `resume` 键 ⇒ 计数变 3，
     *   判据当场红灯。但这**不是**缺陷：时间面在两条路径上仍然都在（这才是它要保的东西）。
     *   故按本仓纪律「旧形态断言按新行为有证据地接管，不直接删除」改写为**语义判据**：
     *   两条返回路径都必须带出 `storyClock` 键（用返回值验，而不是数源码里的字符串）。 */
    const TWC = await import('../apps/timeweaver/timeweaver-collector.js');
    assert.ok(src.split('storyClock: clockFace').length - 1 >= 2, '两条分支都必须出现时间面的传递');
    const empty = TWC.buildNarrative(mockStorage({}), { win: waWin('2026-03-15') });
    assert.equal(empty.empty, true, '无生活碎片 ⇒ empty');
    assert.ok(empty.storyClock, '★ 空分支照样带出时间面');
    const full = TWC.buildNarrative(mockStorage({ diary_entries: JSON.stringify([{ content: '今天', createdAt: 1000 }]) }), { win: waWin('2026-03-15') });
    assert.equal(full.empty, false);
    assert.ok(full.storyClock, '非空分支同样带出');
    /* 未并入 empty：本机无碎片但剧情侧有时间读数 ⇒ 不得被算成「什么都没有」（已由上面两条证明） */
    assert.equal(TWC.buildNarrative(mockStorage({}), {}).storyClock, null, '真缺席 ⇒ 该键为 null（如实）');
});

test('D2 ★ 视图真消费（建好必须有人消费），且渲染串里被调用', () => {
    const view = readRel('apps/timeweaver/timeweaver-view.js');
    assert.match(view, /_storyClockBlock\(m\)\s*\{/, '卡片方法在场');
    assert.match(view, /\$\{this\._injectionBlock\(m\)\}\$\{this\._eventPlatformsBlock\(m\)\}\$\{this\._evidenceBlock\(m\)\}\$\{this\._storyClockBlock\(m\)\}/,
        '★ 须真接进渲染（建好必须有人消费）');
    assert.equal(view.split('_storyClockBlock(m)').length - 1 >= 2, true,
        '方法定义 + 渲染调用（实测 ' + (view.split('_storyClockBlock(m)').length - 1) + ' 次）');
    assert.ok(/CLOCK_SRC_NAME/.test(view), '来源显示名表在场');
    /* 视图只做显示，不做判定：不得出现一致性判定 */
    assert.equal(/conflict\s*=/.test(view), false, '★ 视图不得自算一致性');
});

/* ══════════ E ── 世界脉动接线 ══════════ */
test('E1 ★ bridgeStatus 两条返回路径都带出时间面', () => {
    const src = readRel('apps/worldpulse/worldpulse-app.js');
    assert.equal(src.split('storyClock: clockBlock()').length - 1 >= 2, true,
        '★ 两条返回路径（正常 + 降级）都要带（实测 ' + (src.split('storyClock: clockBlock()').length - 1) + ' 处）');
    assert.match(src, /const clockBlock = \(\) => \{/, '时间侧读数块在场');
    assert.match(src, /storyClockProbe\(\)/, '★ 取数口走真源探针（不得自摸宿主对象）');
    /* 计数只算**真代码行**（注释里讨论这条纪律是允许且必要的，裸数会把说明算成调用） */
    const codeOnly = src.split('\n').filter((l) => !l.trim().startsWith('*') && !l.trim().startsWith('/*') && !l.trim().startsWith('//')).join('\n');
    assert.equal(codeOnly.split('storyClockProbe()').length - 1, 1,
        '★ 取数点唯一（实测 ' + (codeOnly.split('storyClockProbe()').length - 1) + ' 处）');
    assert.equal(/currentStoryDate/.test(src), false, '★ 不得自写日历取数（那是第二份实现）');
});

test('E2 ★ 世界脉动视图真读它（不是躺在 app 里无人消费）', () => {
    const view = readRel('apps/worldpulse/worldpulse-view.js');
    assert.match(view, /st\.storyClock/, '视图真读该面');
    assert.match(view, /\$\{clockHtml\}/, '且真接进渲染串');
    assert.ok(/clockHtml/.test(view));
});

/* ══════════ F ── 取数口唯一 ══════════ */
test('F1 ★ 日历取数探针只许有一个真源（诊断内核不再自写）', () => {
    const diag = readRel('apps/diagnose/diagnose-data.js');
    assert.equal(/currentStoryDate/.test(diag), false,
        '★ 诊断内核不得再自写日历探针（取数口已上收到真源 storyClockProbe）');
    assert.match(diag, /storyClockProbe/, '诊断内核改走真源探针');
    const sc = readRel('config/story-clock.js');
    assert.match(sc, /currentStoryDate/, '真源是唯一持有取数路径的地方');
    /* 全仓扫描：读日历探针的产品文件只许是「真源 + 日历 App 自己」 */
    const hits = [];
    (function walk(dir) {
        for (const name of fs.readdirSync(dir)) {
            const abs = path.join(dir, name);
            if (fs.statSync(abs).isDirectory()) { walk(abs); continue; }
            if (!name.endsWith('.js')) continue;
            const rel = path.relative(ROOT, abs).split(path.sep).join('/');
            if (readRel(rel).includes('currentStoryDate')) hits.push(rel);
        }
    })(path.join(ROOT, 'apps'));
    hits.push(...['config'].flatMap((d) => fs.readdirSync(path.join(ROOT, d))
        .filter((n) => n.endsWith('.js'))
        .map((n) => d + '/' + n)
        .filter((rel) => readRel(rel).includes('currentStoryDate'))));
    const unexpected = hits.filter((f) => !/^(apps\/calendar\/calendar-app\.js|config\/story-clock\.js)$/.test(f));
    assert.deepEqual(unexpected, [], '★ 取数口散落（实测多余文件：' + unexpected.join(', ') + '）');
    assert.equal(hits.length, 2, '只许两处：真源探针 + 日历 App 的持有方（实测 ' + hits.join(', ') + '）');
});

/* ══════════ G ── 负控制（真源码破坏 → 破坏副本 → 同款真判据必须转红） ══════════ */
/**
 * 在临时沙箱里重建 **同层级目录**（`config/` 与 `apps/<app>/`），
 * 再对其中一份真源码文本做破坏 —— 破坏的是真源码，判据是同一套函数。
 * 【为什么不能只复制单目录】收集器 import 的是 `../../config/*`，
 * 单目录副本会因解析失败而红，那是「环境没搭好」的红，不是「判据真转红」。
 */
function sandbox(relDirs) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rp_v3212_'));
    const copy = (src, dst) => {
        fs.mkdirSync(dst, { recursive: true });
        for (const name of fs.readdirSync(src)) {
            const s = path.join(src, name);
            const d = path.join(dst, name);
            if (fs.statSync(s).isDirectory()) copy(s, d);
            else if (name.endsWith('.js')) fs.copyFileSync(s, d);
        }
    };
    for (const rel of relDirs) copy(path.join(ROOT, rel), path.join(root, rel));
    return root;
}

function damage(root, rel, anchor, replacement) {
    const p = path.join(root, rel);
    const txt = fs.readFileSync(p, 'utf8');
    const hits = txt.split(anchor).length - 1;
    assert.equal(hits, 1, '破坏锚点必须恰中 1 次（实测 ' + hits + '）：' + anchor.slice(0, 70));
    fs.writeFileSync(p, txt.split(anchor).join(replacement));
}

test('G1 让「有面」也被当成没读到 ⇒ 同款建卡判据必须转红', async () => {
    /* 【v3.20.0 修订】沙盒补 `apps/plotline`：collector 新增了「上游承诺/支线投影」这一面，
     *   依赖 `../plotline/plotline-data.js`（跨 app 导入，本仓有先例：diagnose → plotline）。
     *   原沙盒只拷 config + apps/timeweaver ⇒ 副本导入即抛 ERR_MODULE_NOT_FOUND，
     *   **判据取到的是「跑不起来」而不是「破坏了」**（本仓点名的假绿/假红形态）。 */
    const root = sandbox(['config', 'apps/timeweaver', 'apps/plotline']);
    /* 破坏：把建卡条件改成「必须真拿到日期」（正是本仓要挡的「有面却看不见」形态） */
    damage(root, 'apps/timeweaver/timeweaver-collector.js',
        'if (!line.present && faceless) return null;',
        'if (!line.present) return null;');
    const M = await import(pathToFileURL(path.join(root, 'apps/timeweaver/timeweaver-collector.js')).href + '?t=' + Date.now());
    const f = M.collectStoryClock(faceAbsentWin());
    assert.equal(f, null, '★ 破坏后「有面却读不出时间面」被吞成没读到 ⇒ 同款判据（必须建卡）转红');
    const LIVE = await import('../apps/timeweaver/timeweaver-collector.js');
    assert.ok(LIVE.collectStoryClock(faceAbsentWin()), '对照：真源码下必须建卡');
});

test('G2 让探针不再吞宿主异常 ⇒ 同款「不抛」判据必须转红', async () => {
    const root = sandbox(['config']);
    /* 锚点带足上下文（H5：判据层里锚点字面量只准出现一次；不要写单行 `} catch` —— 文件里有多处） */
    damage(root, 'config/story-clock.js',
        '        } catch (_e) { return null; }\n    };\n    return { win: w, calendarSource };',
        '        } catch (_e) { throw _e; }\n    };\n    return { win: w, calendarSource };');
    const M = await import(pathToFileURL(path.join(root, 'config/story-clock.js')).href + '?t=' + Date.now());
    const thrown = { VirtualPhone: { calendarApp: { currentStoryDate() { throw new Error('boom'); } } } };
    let escaped = false;
    try { M.storyClockProbe(thrown).calendarSource(); } catch (_e) { escaped = true; }
    assert.equal(escaped, true, '★ 破坏后宿主异常真外抛 ⇒ 同款判据（必须返回 null）转红');
    const SC = await import('../config/story-clock.js');
    assert.equal(SC.storyClockProbe(thrown).calendarSource(), null, '对照：真源码下如实 null');
});

/* ══════════ H ── 版本锚 ══════════ */
test('H1. 版本五源同源（下限形），且当版条目非空', () => {
    /* [v3.11.0 交棒] 原判据硬写 '3.10.2' —— 那是**当版精确读数**，抬版即过期，
     *   而本套件要守的是「五源同源 + 当版条目非空」这条**口径**，不是某个版本字面量。
     *   同族前例（仓内已记录：v326-B1 / v327-E1 / v328-B2 / v268-P1 / v3210-G1 / v3211-E1）。
     *   命中本类脆性时的自检问句：**这条断言在正常抬版后还会成立吗？** 不会 ⇒ 形状错。
     *   精确版本判定交给当版套件（v3213-G1）接管。 */
    const man = JSON.parse(readRel('manifest.json'));
    const pkg = JSON.parse(readRel('package.json'));
    const log = JSON.parse(readRel('update-log.json'));
    const idx = readRel('index.js');
    const mv = String(man.version);
    const parts = mv.split('.').map(Number);
    assert.ok(parts[0] > 3 || (parts[0] === 3 && parts[1] >= 10),
        '本套件成立于 RubyPhone 3.10.2 及以后，当前 ' + mv);
    assert.equal(pkg.version, mv, 'package 与 manifest 同源');
    assert.equal(log.latest, mv, 'update-log latest 与 manifest 同源');
    assert.ok(log.versions[mv], 'update-log 必须有当版条目');
    assert.ok(Array.isArray(log.versions[mv].items) && log.versions[mv].items.length >= 4,
        '当版条目至少 4 条说明');
    assert.ok(/const ST_PHONE_VERSION = '[0-9]+\.[0-9]+\.[0-9]+'/.test(idx),
        '入口版本常量在场（精确值由当版套件判）');
});
