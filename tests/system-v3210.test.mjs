// tests/system-v3210.test.mjs — 知情边界三层下游化 + 跨 App 时间编排 + 内存取证（v3.10.0）
//
//   本版治两个**「建好了却没人用」**（本仓反复出现的形态）与一个**唯一悬挂 TODO**：
//     ① 上游 v3.219.0 的知情网络（`worldProg.knowledge`）在本仓此前只有「列表出口」
//        （`knowledgeList()` 把账里有什么列出来），**「谁不知道某件事」零消费**；
//     ② 三处时间读数（WorldAxis 世界钟 / 插件剧情日期 / 手机日历当天）**没有任何出口
//        把它们摆在一起**，用户只能看到互相矛盾的日期而无从判断哪个是「现在」；
//     ③ TODO 唯一悬挂的「内存快照增长 / 单次渲染耗时」此前登记为「本环境不可测」——
//        本版把它拆成**能测的那一段**（堆趋势 + 订阅回收 + 串生成耗时）并显式登记
//        不能测的那一段。
//
//   ★ 本仓的老账（写进判据，防止再犯）：
//     ① **「没记录」与「不知道」必须不同形** —— 三档分形（known / unaware / silent），
//        且「一条认知记录都没有的人」不得被并进 `unaware`（那是把沉默当事实）。
//     ② **「没能比」与「比过、一致」必须不同形** —— `agree === null`（来源不足两个）
//        ≠ `agree === true`（比过且一致）；三源冲突时必须 `conflict === true`。
//     ③ **时间不许猜** —— 三源全缺时 `primary === null`，**绝不**用现实时间顶替剧情时间。
//     ④ **快照形态判定只许一份**（第九道门 J4）—— 消费侧不得自写 `x.snapshot && typeof …`。
//     ⑤ 内存读数必须带**噪声声明**，且只判跨轮趋势（单点 heapUsed 不可判泄漏）。
//
//   覆盖：
//     A 知识面：三档分形 / 五态归因 / 匹配强度 / 不推断 / 不抛
//     B 知识面的产品消费（三处真接线：剧情线内核 + 视图 + 诊断中心）
//     C 时间面：三源在场性 / 一致性三态 / 确定性 primary / 不猜
//     D 干跑取数的第二消费方（日记）与陈旧读数防护
//     E 内存/耗时探针：基线在场、读数分块、诚实边界
//     F 负控制四条（真源码破坏 → 加载破坏副本 → 同款真判据必须转红）
//     G 版本与接线
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { installRuntimeHost, resetHostFlags } from './_runtime_host.mjs';
import * as KC from '../config/knowledge-contract.js';
import * as SC from '../config/story-clock.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const KC_SRC = path.join(ROOT, 'config', 'knowledge-contract.js');
const SC_SRC = path.join(ROOT, 'config', 'story-clock.js');
const KC_TXT = fs.readFileSync(KC_SRC, 'utf8');
const SC_TXT = fs.readFileSync(SC_SRC, 'utf8');
const readRel = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

/** 三源样本：甲知道 A、乙明确不知道 A、丙有记录但 A 两边都没记、丁一条记录都没有 */
const SAMPLE_KN = {
    knowledge: {
        '甲': { known: ['钟楼在城东', '已签约'], unaware: [] },
        '乙': { known: ['已签约'], unaware: ['钟楼在城东'] },
        '丙': { known: ['已签约'], unaware: ['别的事'] },
        '丁': { known: [], unaware: [] }
    }
};
const peopleOf = (kn) => KC.knowledgeFace({ worldProg: kn || SAMPLE_KN, faceState: 'present' }).people;

/* ══════════ A ── 知识面 ══════════ */
test('A1 三档分形：known / unaware / silent 互不混淆，且「没记录的人」单独计数', () => {
    const w = KC.whoKnows(peopleOf(), '钟楼在城东');
    assert.equal(w.known.length, 1, '甲必须进 known');
    assert.equal(w.known[0].character, '甲');
    assert.equal(w.unaware.length, 1, '乙必须进 unaware');
    assert.equal(w.unaware[0].character, '乙');
    assert.deepEqual(w.silent, ['丙'], '★ 丙有认知记录但这条事实两边都没记 ⇒ silent（不是 unaware）');
    assert.equal(w.unrecorded, 1, '★ 丁一条认知记录都没有 ⇒ 单独计数，不得进 silent（更不得进 unaware）');
    assert.equal(w.silent.includes('丁'), false, '丁不得出现在 silent 里');
});

test('A2 匹配强度如实报：exact 与 substring 必须可分（防「宽泛命中当逐字结论」）', () => {
    const ex = KC.matchFact(['钟楼在城东'], '钟楼在城东');
    assert.equal(ex.matched, 'exact', '逐字相同 ⇒ exact');
    const sub = KC.matchFact(['钟楼在城东的老槐树下'], '钟楼在城东');
    assert.equal(sub.matched, 'substring', '互为子串 ⇒ substring');
    assert.equal(KC.matchFact(['无关'], '钟楼在城东').matched, 'none', '不命中 ⇒ none');
    /* whoKnows 的 matched 取**最弱**结论：一侧 exact、另一侧 substring ⇒ 整体 substring */
    const mixed = KC.whoKnows([
        { character: '甲', known: ['钟楼在城东'], unaware: [], knownCount: 1, unawareCount: 0 },
        { character: '乙', known: [], unaware: ['钟楼在城东那棵树下'], knownCount: 0, unawareCount: 1 }
    ], '钟楼在城东');
    assert.equal(mixed.matched, 'substring', '★ 混合强度必须取最弱（否则会把宽泛命中当逐字结论）');
});

test('A3 五态分形（读不到 ≠ 空）：桥缺 / 无快照 / 面无这面 / 声明为空 / 就绪', () => {
    assert.equal(KC.knowledgeFace({ mounted: false }).state, 'bridge-absent');
    assert.equal(KC.knowledgeFace({ hasSnapshot: false }).state, 'no-snapshot');
    assert.equal(KC.knowledgeFace({ faceState: 'absent' }).state, 'face-absent');
    assert.equal(KC.knowledgeFace({ faceState: 'declared-empty' }).state, 'declared-empty');
    assert.equal(KC.knowledgeFace({ worldProg: SAMPLE_KN, faceState: 'present' }).state, 'ok');
    /* ★「没给」与「给了 0」不同形：knowledge 非对象 ⇒ 这版没这面，**不是**「零条认知」 */
    assert.equal(KC.knowledgeFace({ worldProg: { knowledge: null }, faceState: 'present' }).state, 'face-absent');
    assert.equal(KC.knowledgeFace({ worldProg: {}, faceState: 'present' }).state, 'face-absent');
    /* 有面但每个角色都空 ⇒ 实为「没有可用的认知记录」 */
    assert.equal(KC.knowledgeFace({ worldProg: { knowledge: { 甲: {} } }, faceState: 'present' }).state, 'ok');
    /* 空对象 ⇒ declared-empty（有面、但一个角色都没登记） */
    assert.equal(KC.knowledgeFace({ worldProg: { knowledge: {} }, faceState: 'present' }).state, 'declared-empty');
    for (const s of ['bridge-absent', 'no-snapshot', 'face-absent', 'declared-empty']) {
        const f = KC.knowledgeFace(s === 'bridge-absent' ? { mounted: false } : { faceState: s === 'face-absent' || s === 'declared-empty' ? s : undefined, hasSnapshot: s !== 'no-snapshot' });
        assert.equal(Array.isArray(f.people) && f.people.length, 0, s + ' 时 people 必须是空数组（键面恒定）');
        assert.equal(f.silentCapable, false, s + ' 时 silentCapable 必须 false');
    }
});

test('A4 silentCapable：账里一条 unaware 都没有 ⇒ 必须自报「回答不了」，不冒充「没人不知道」', () => {
    const none = KC.knowledgeFace({ worldProg: { knowledge: { 甲: { known: ['x'], unaware: [] } } }, faceState: 'present' });
    assert.equal(none.state, 'ok');
    assert.equal(none.silentCapable, false, '★ 零 unaware ⇒ 回答不了「谁不知道」');
    const line = KC.knowledgeLine(none);
    assert.ok(/没记录|暂无/.test(line.detail), '文案必须点明「暂无不知情记录」：' + line.detail);
    const some = KC.knowledgeFace({ worldProg: SAMPLE_KN, faceState: 'present' });
    assert.equal(some.silentCapable, true, '有一条 unaware ⇒ 有能力回答');
});

test('A5 边界性格面与生成侧约束块：只列**有记录**的，绝不含 silent / unrecorded', () => {
    const ppl = peopleOf();
    const bB = KC.boundaryOf(ppl, '乙');
    assert.equal(bB.boundary, 'recorded');
    assert.deepEqual(bB.unaware, ['钟楼在城东']);
    const bD = KC.boundaryOf(ppl, '丁');
    assert.equal(bD.boundary, 'unrecorded', '★ 一条记录都没有 ⇒ 性格面是 unrecorded（不是 unaware）');
    assert.equal(KC.boundaryOf(ppl, '不存在的人').boundary, 'unrecorded', '不在账里 ⇒ 同样 unrecorded（不猜）');
    const block = KC.unawareBlock(ppl, '钟楼在城东');
    assert.ok(/乙/.test(block), '约束块必须列出乙');
    assert.equal(/丙|丁/.test(block), false, '★ 约束块不得出现 silent（丙）或没记录的人（丁）—— 那会把沉默写成事实');
    assert.equal(KC.unawareBlock(ppl, '没人知道的事'), '', '无人明确不知情 ⇒ 空串（不产生空块）');
});

test('A6 只读面不抛：任何畸形输入一律降级，绝不外抛', () => {
    for (const bad of [null, undefined, 0, '', 'x', [], { worldProg: 'str' }, { worldProg: { knowledge: 5 } }, { faceState: 1 }]) {
        assert.doesNotThrow(() => KC.knowledgeFace(bad), 'knowledgeFace 不得抛：' + JSON.stringify(bad));
    }
    for (const bad of [null, undefined, 5, {}, 'x']) {
        assert.doesNotThrow(() => KC.whoKnows(bad, 'f'), 'whoKnows 不得抛');
        assert.doesNotThrow(() => KC.unawareBlock(bad, 'f'), 'unawareBlock 不得抛');
        assert.doesNotThrow(() => KC.knowledgeLine(bad), 'knowledgeLine 不得抛');
    }
    assert.equal(KC.whoKnows(null, 'f').known.length, 0, '垃圾入参 ⇒ 空结果而不是异常');
});

/* ══════════ B ── 知识面的产品消费 ══════════ */
test('B1 知识面已真接入三处产品面（不是「建好不消费」）', () => {
    const plotData = readRel('apps/plotline/plotline-data.js');
    const plotApp = readRel('apps/plotline/plotline-app.js');
    const plotView = readRel('apps/plotline/plotline-view.js');
    const diagData = readRel('apps/diagnose/diagnose-data.js');
    const diagView = readRel('apps/diagnose/diagnose-view.js');
    assert.ok(/knowledgeBoundary/.test(plotData), '剧情线内核必须导出 knowledgeBoundary');
    assert.ok(/characterBoundary/.test(plotApp), '剧情线 App 必须真消费 characterBoundary');
    assert.ok(/boundaries/.test(plotView), '剧情线视图必须渲染边界格');
    assert.ok(/knowledgeBoundary/.test(diagData), '诊断内核必须接知识面');
    assert.ok(/_knowledgeHtml|knowledgeFaceText/.test(diagView), '诊断视图必须有知识面卡片');
    /* ★ 三档分形的**用户可见性**：视图必须把「账里未记录」单独画出来 */
    assert.ok(/账里未记录/.test(plotView), '★ 视图必须区分「账里未记录」与「未意识到」');
    assert.ok(/无从分辨/.test(plotView), '视图必须点明 unrecorded 的含义是「无从分辨」');
});

test('B2 生成侧约束：剧情线一致性块必须带上知情边界（只列有记录的）', async () => {
    const PL = await import('../apps/plotline/plotline-data.js');
    const block = PL.plotlinePromptBlock({
        outline: null,
        worldProg: { promises: [], plotArcs: [], knowledge: { 乙: { known: [], unaware: ['钟楼在城东'] } } }
    }, { maxLines: 20 });
    assert.ok(/知情边界/.test(block), '★ 生成块必须带知情边界段：' + block.slice(0, 120));
    assert.ok(/乙/.test(block), '必须列出明确不知情的角色');
    /* 无 unaware 记录时该段整体消失（块与接线前逐字相同） */
    const empty = PL.plotlinePromptBlock({ outline: null, worldProg: { promises: [], plotArcs: [], knowledge: { 甲: { known: ['x'], unaware: [] } } } }, { maxLines: 20 });
    assert.equal(/知情边界/.test(empty), false, '零 unaware ⇒ 不得产生空段');
});

/* ══════════ C ── 时间面 ══════════ */
test('C1 三源在场性如实分档：桥缺 / 无快照 / 面无这面 / 这一层没给 / 就绪', () => {
    assert.equal(SC.worldAxisClock(null).state, 'bridge-absent', '无 win 且无桥 ⇒ bridge-absent');
    assert.equal(SC.calendarClock(null).state, 'source-missing', '未注入取数口 ⇒ source-missing');
    assert.equal(SC.calendarClock(() => null).state, 'source-missing', '取数返回 null ⇒ source-missing');
    assert.equal(SC.calendarClock(() => ({ date: '3月15日' })).state, 'ok');
    assert.equal(SC.lonshaClock(null).state, 'bridge-absent');
    /* 抛错的取数口：unusable（**不是** source-missing —— 「读出错」与「这一层没给」处置相反） */
    assert.equal(SC.calendarClock(() => { throw new Error('boom'); }).state, 'unusable');
});

/** WorldAxis 桥的**最小真形态桩**（拉取型：`snapshot` 是函数、`stat()` 自述已发布）。
 *  ★ 桩必须照真接口写：`readPublished()` 对拉取型只认 `stat().published`，
 *    直接把 `snapshot` 挂成对象会被判成 unknown（那是「没物」，不是「有物」）。
 *    首版桩写成对象形，导致 C2 的「两源在位」恒为 1 —— 桩错会伪装成产品缺陷。 */
const waWin = (iso, label) => ({
    worldaxis_bridge_v1: {
        version: '1',
        bridge: 'worldaxis_bridge_v1',
        snapshot: () => ({ worldClock: { iso, label: label || iso } }),
        stat: () => ({ published: true, invalidated: false })
    }
});

test('C2 一致性三态：一致 / 冲突 / 无法验证 —— 三者在机制上必须不同形', () => {
    const ok = SC.storyClock({ calendarSource: () => ({ date: '3月15日' }) });
    assert.equal(ok.present, 1, '只有日历一源 ⇒ present 1');
    assert.equal(ok.agree, null, '★ 来源不足两个 ⇒ agree 必须是 null（不是 true）');
    assert.equal(ok.conflict, false, '无法比较时不得报冲突');
    assert.ok(/无法交叉验证/.test(ok.text), '文案必须点明「无法验证」：' + ok.text);

    /* 两源一致（同一天的不同写法必须能对上：世界钟出 ISO 形、日历出中文形） */
    const same = SC.storyClock({ calendarSource: () => ({ date: '3月15日' }), win: waWin('2026-03-15') });
    assert.equal(same.present, 2, '两源在位（实测 ' + same.present + '）');
    assert.equal(same.agree, true, '同一天的不同写法必须判为一致：' + JSON.stringify([same.sources.worldaxis.date, same.sources.calendar.date]));
    assert.equal(same.conflict, false);

    /* 两源冲突 */
    const bad = SC.storyClock({ calendarSource: () => ({ date: '2026年06月01日' }), win: waWin('2026-03-15') });
    assert.equal(bad.agree, false, '★ 两源日期不同 ⇒ agree false');
    assert.equal(bad.conflict, true, '★ 必须显式报冲突（用户要能知道）');
    assert.ok(/不一致/.test(bad.text), '文案必须报不一致：' + bad.text);
    assert.ok(/2026-03-15|2026年03月15日/.test(bad.text), '文案必须列出各源原值：' + bad.text);
});

test('C3 不猜：三源全缺 ⇒ primary 为 null，绝不用现实时间顶替剧情时间', () => {
    const none = SC.storyClock({});
    assert.equal(none.present, 0);
    assert.equal(none.primary, null, '★ 三源全缺 ⇒ primary 必须 null');
    assert.equal(none.primaryDate, null);
    assert.equal(none.agree, null, '比都没得比 ⇒ null');
    assert.ok(/全缺/.test(none.text), '文案必须说「全缺」而不是给一个日期：' + none.text);
    /* ★ 判据必须钉住「不得拿现实时间顶替剧情时间」：`Date.now()` 只允许出现在 `at` 字段，
     *   且来源对象里不得出现任何被回填的日期。判据在**剥注释**的源码上跑 ——
     *   注释里讨论这条纪律（含写出 `Date.now()`）是允许且必要的，裸数会把说明算成违规。 */
    const strip = (s) => s.split('\n').filter((l) => !l.trim().startsWith('*') && !l.trim().startsWith('/*') && !l.trim().startsWith('//')).join('\n');
    const code = strip(SC_TXT);
    assert.equal(/sources\[primary\]\.date\s*=/.test(code), false, '不得给来源回填日期');
    const nowHits = code.split('Date.now()').length - 1;
    assert.equal(nowHits, 1, '★ 真代码里 Date.now() 只允许出现 1 次（`at` 时间戳）；实测 ' + nowHits);
    /* 行为面：全缺时返回对象里不得有 `today` / `now` 这类顶替字段 */
    assert.equal('today' in none, false, '不得自造 today 字段');
    assert.equal('now' in none, false, '不得自造 now 字段');
});

test('C4 确定性 primary 规则：规则可读且按来源顺序取第一个有日期的', () => {
    assert.deepEqual([...SC.CLOCK_SOURCES], ['worldaxis', 'lonsha', 'calendar'], 'primary 规则由这份顺序定义');
    const win = {};
    const sc = SC.storyClock({ win, calendarSource: () => ({ date: '6月1日' }) });
    assert.equal(sc.primary, 'calendar', '只有日历有日期 ⇒ primary 就是日历');
    const only = SC.storyClock({ calendarSource: () => ({ date: '1月1日' }) });
    assert.equal(only.primaryDate, '1月1日', 'primaryDate 必须是该源的原值');
    const line = SC.storyClockLine(sc);
    assert.ok(/calendar:6月1日/.test(line.detail), '一行总述必须带各源在场性：' + line.detail);
    assert.equal(line.verdict, '无法验证', '只有一源 ⇒ verdict 是「无法验证」');
});

/* ══════════ D ── 干跑取数的第二消费方（日记） ══════════ */
test('D1 日记侧真接入干跑取数，且读不到时请求与接线前逐字相同', async () => {
    const diarySrc = readRel('apps/diary/diary-data.js');
    assert.ok(/worldbook-dryrun/.test(diarySrc), '★ 日记必须复用同一份干跑实现（不得另写一份）');
    assert.ok(/_buildDiaryDryRunBlock/.test(diarySrc), '日记必须有干跑块构造器');
    const DIARY = await import('../apps/diary/diary-data.js');
    const d = new DIARY.DiaryData({ get: () => undefined, set() {} });
    /* 无宿主 ⇒ 取不到 ⇒ null（请求不变） */
    const block = await d._buildDiaryDryRunBlock();
    assert.equal(block, null, '★ 取不到时必须返回 null（请求与接线前逐字相同）');
    /* 陈旧快照必须被弃用（本仓抓过的「跨会话串味」同族） */
    const stale = d._isStaleDryRun({ at: 1000 });
    assert.equal(typeof stale, 'boolean', '_isStaleDryRun 必须给布尔结论');
    assert.equal(d._isStaleDryRun({}), false, '无时间戳 ⇒ 不据此丢弃（拿不到证据不硬猜）');
});

test('D2 干跑开关是会话级键，且已在键门禁登记（防跨会话串味）', () => {
    const diarySrc = readRel('apps/diary/diary-data.js');
    assert.ok(/'diary_dryrun_enabled'/.test(diarySrc), '开关键必须用 diary_ 前缀（会话级）');
    assert.equal(/ruby_diary_dryrun_enabled/.test(diarySrc), false, '★ 不得用 ruby_ 前缀（那是全局桶）');
    const keysSrc = readRel('scripts/keys-audit.mjs');
    assert.ok(/diary_dryrun_enabled/.test(keysSrc), '必须在 keys-audit 的 KEY_REGISTRY 登记');
});

/* ══════════ E ── 内存/耗时探针 ══════════ */
test('E1 探针与基线在场，读数分块且带噪声声明', () => {
    const probe = readRel('tests/audit/memory_growth_probe.cjs');
    const base = JSON.parse(readRel('tests/audit/memory_growth_baseline.json'));
    assert.ok(/--expose-gc|global\.gc/.test(probe), '探针必须支持强制回收（否则读数不可判）');
    assert.ok(/noise_note/.test(probe), '探针必须带噪声声明');
    assert.ok(base.noise_note && /趋势/.test(base.noise_note), '基线的噪声声明必须点明「只判趋势」');
    assert.ok(Array.isArray(base.readings.heap_samples_kb) && base.readings.heap_samples_kb.length >= 2, '基线必须有多轮堆样本');
    assert.ok(base.listeners && typeof base.listeners.event_peak === 'number', '基线必须含事件源读数');
    assert.ok(base.timings && base.timings.string_build && base.timings.string_build.not_render === true,
        '★ 计时段必须显式标记 not_render（它不是实机渲染耗时）');
    assert.ok(Array.isArray(base.unmeasurable) && base.unmeasurable.length >= 3, '必须登记不可测项');
});

test('E2 基线读数与当版机制一致：无泄漏候选、订阅被收净、串生成不退化', () => {
    const base = JSON.parse(readRel('tests/audit/memory_growth_baseline.json'));
    assert.equal(['linear-acceptable'].includes(base.verdict.module_heap), true,
        '★ 堆趋势必须是 linear-acceptable（实测 ' + base.verdict.module_heap + ' / '
        + base.readings.heap_tail_kb_per_round + 'KB per round）—— 若变 leak-candidate 需单独立项');
    assert.equal(base.verdict.event_source, 'ok', '★ 构造-启动-停止后事件源 handler 必须回到基线');
    assert.ok(base.listeners.event_peak > base.listeners.event_base,
        '★ 峰值必须**高于**基线 —— 否则是「根本没订上」的假绿（本探针首版就踩过：只看全局监听器得恒 0）');
    assert.ok(base.timings.string_build.per_op_ms < 5,
        '串生成必须仍是亚毫秒级（实测 ' + base.timings.string_build.per_op_ms + 'ms）');
});

/* ══════════ F ── 负控制（真源码破坏 → 加载破坏副本 → 同款真判据必须转红） ══════════ */
/**
 * 把真源码里的一处锚点换掉，落到**临时目录下的同构副本**后动态 import。
 * 副本必须带上被改文件所在目录的**同目录依赖**（`story-clock.js` import 了 `./world-bridge.js`）
 * —— 否则破坏副本会因解析失败而 red，那是「环境没搭好」的红，不是「判据真转红」。
 * 破坏的是**真源码文本**，判据也是同一套函数（避开本仓 v324/v327 抓过的三种假绿）。
 */
async function loadDamaged(srcPath, txt, anchor, replacement) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rp_v3210_'));
    const hits = txt.split(anchor).length - 1;
    assert.equal(hits, 1, '破坏锚点必须恰中 1 次（实测 ' + hits + '）：' + anchor.slice(0, 70));
    const srcDir = path.dirname(srcPath);
    /* 连同目录依赖一起复制（只复制 .js，跳过子目录；本仓 config/ 的依赖都在同目录） */
    for (const f of fs.readdirSync(srcDir)) {
        if (!f.endsWith('.js')) continue;
        fs.copyFileSync(path.join(srcDir, f), path.join(dir, f));
    }
    fs.writeFileSync(path.join(dir, path.basename(srcPath)), txt.split(anchor).join(replacement));
    return import(pathToFileURL(path.join(dir, path.basename(srcPath))).href + '?t=' + Date.now());
}

test('F1 把 silent 并进 unaware ⇒ 「三档不同形」判据必须转红', async () => {
    const M = await loadDamaged(KC_SRC, KC_TXT, "silent.push(p.character);", "unaware.push({ character: p.character, via: '', matched: 'none' });");
    const w = M.whoKnows(peopleOf(), '钟楼在城东');
    assert.equal(w.silent.includes('丙'), false, '★ 破坏后丙不再进 silent ⇒ 同款判据转红');
    assert.ok(w.unaware.some((x) => x.character === '丙'), '破坏把 silent 冒充成 unaware（正是本仓要挡的形态）');
    const live = KC.whoKnows(peopleOf(), '钟楼在城东');
    assert.deepEqual(live.silent, ['丙'], '对照：真源码下丙在 silent');
});

test('F2 把「来源不足两个 ⇒ agree null」改成 true ⇒ 「无法验证」判据必须转红', async () => {
    /* ★ 锚点用单行（H5 判据纯度：锚点字面量只准出现一次）；不要带上后面的 `let basis`——
     * 本仓 story-clock.js 后续插过行，带上下文的长锚点会因无关改动失配（本轮 F2 就踩过）。 */
    const M = await loadDamaged(SC_SRC, SC_TXT, 'let agree = null;', 'let agree = true;');
    const sc = M.storyClock({ calendarSource: () => ({ date: '3月15日' }) });
    assert.equal(sc.agree, true, '★ 破坏后单源也报「一致」⇒ 同款判据（agree 必须 null）转红');
    const live = SC.storyClock({ calendarSource: () => ({ date: '3月15日' }) });
    assert.equal(live.agree, null, '对照：真源码下单源是 null');
});

test('F3 把三源冲突时不报 conflict ⇒ 「冲突必须说出」判据必须转红', async () => {
    const M = await loadDamaged(SC_SRC, SC_TXT, 'conflict = agree === false;', 'conflict = false;');
    const arg = { calendarSource: () => ({ date: '2026年06月01日' }), win: waWin('2026-03-15') };
    const sc = M.storyClock(arg);
    assert.equal(sc.agree, false, '（破坏后仍算出不一致）');
    assert.equal(sc.conflict, false, '★ 破坏后不再报冲突 ⇒ 同款判据转红');
    assert.equal(/不一致/.test(sc.text), false, '★ 破坏后文案也不再报不一致（正是本仓要挡的「静默采用其中一个」）');
    const live = SC.storyClock(arg);
    assert.equal(live.conflict, true, '对照：真源码下报冲突');
});

test('F4 把约束块里的 silent 也塞进去 ⇒ 「只列有记录的」判据必须转红', async () => {
    const M = await loadDamaged(KC_SRC, KC_TXT, 'const names = w.unaware.map((x) => x.character);', 'const names = w.unaware.map((x) => x.character).concat(w.silent);');
    const block = M.unawareBlock(peopleOf(), '钟楼在城东');
    assert.ok(/丙/.test(block), '★ 破坏后 silent（丙）被写进约束 ⇒ 同款判据（不得含丙/丁）转红');
    const live = KC.unawareBlock(peopleOf(), '钟楼在城东');
    assert.equal(/丙/.test(live), false, '对照：真源码下丙不进块');
});

/* ══════════ G ── 版本与接线 ══════════ */
test('G1 版本五源同源（下限形），且当版条目非空', () => {
    /* [v3.10.1 交棒] 原判据硬写 '3.10.0' —— 那是**当版精确读数**，抬版即过期，
     *   而本套件要守的是「五源同源 + 当版条目非空」这条**口径**，不是某个版本字面量。
     *   同族前例（仓内已记录四次脆性）：v326-B1 / v327-E1 / v328-B2 / v268-P1。
     *   命中本类脆性时的自检问句：**这条断言在正常抬版后还会成立吗？** 不会 ⇒ 形状错。
     *   精确版本判定交给当版套件（v3211-E1）接管。 */
    const man = JSON.parse(readRel('manifest.json'));
    const pkg = JSON.parse(readRel('package.json'));
    const log = JSON.parse(readRel('update-log.json'));
    const idx = readRel('index.js');
    const mv = String(man.version);
    const parts = mv.split('.').map(Number);
    assert.ok(parts[0] > 3 || (parts[0] === 3 && parts[1] >= 10),
        '本套件成立于 RubyPhone 3.10.0 及以后，当前 ' + mv);
    assert.equal(pkg.version, mv, 'package 与 manifest 同源');
    assert.equal(log.latest, mv, 'update-log latest 与 manifest 同源');
    assert.ok(log.versions[mv], 'update-log 必须有当版条目');
    assert.ok(Array.isArray(log.versions[mv].items) && log.versions[mv].items.length >= 4,
        '当版条目至少 4 条说明（App 内更新弹窗读它）');
    assert.ok(new RegExp("const ST_PHONE_VERSION = '" + mv + "'").test(idx), '入口版本常量与 manifest 同源');
});

test('G2 消费侧不自写快照形态判据（第九道门 J4：同一口径只许一份实现）', () => {
    const kc = readRel('config/knowledge-contract.js');
    const sc = readRel('config/story-clock.js');
    /* 剥注释后再查（注释里讨论这条纪律是允许且必要的） */
    const strip = (s) => s.split('\n').filter((l) => !l.trim().startsWith('*') && !l.trim().startsWith('/*') && !l.trim().startsWith('//')).join('\n');
    const re = /\.snapshot\s*&&\s*typeof\s+[A-Za-z_$][\w$.]*\.snapshot\s*===\s*'object'/;
    assert.equal(re.test(strip(kc)), false, '★ 知识面不得自写快照形态判据');
    assert.equal(re.test(strip(sc)), false, '★ 时间面不得自写快照形态判据');
});

test('G3 时间面只经真源出口读桥（不得自摸桥全局）', () => {
    const sc = readRel('config/story-clock.js');
    assert.ok(/from '\.\/world-bridge\.js'/.test(sc), '必须从 world-bridge 真源导入');
    assert.ok(/readPushProbe/.test(sc), '拉取型读口走 readPushProbe');
    assert.ok(/readWorldAxisSnapshot/.test(sc), 'WorldAxis 面走 readWorldAxisSnapshot');
    assert.equal(/globalThis\.\w*[Bb]ridge/.test(sc), false, '不得自摸桥全局名');
    assert.equal(/LonSha/.test(sc), false, '不得自持桥名/插件名');
});
