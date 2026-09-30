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
import { spawnSync } from 'node:child_process';
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
/**
 * [E2.5 判据本体]「不可判时不得发判定」的**唯一实现**（G2：同一口径只许一份实现）。
 *
 * 为什么要抽成函数：不加负控制的判据 = 没人见过它红一次，最可能是空转。
 * 本仓登记过三种假绿形态，本函数专为避开它们而抽出来：
 *   ① 对原文件断言（破坏没发生也绿）→ 故判据收**文本入参**，可喂破坏副本；
 *   ② 破坏写死成模拟常量 → 故破坏由调用方从**真源码**按锚点 split/join 产出；
 *   ③ 破坏把判据自己删了 → 故本函数只做判定，不含任何写文件/改常量动作。
 *
 * ⚠ H5 判据纯度：下面的锚点字面量在本文件里**只准出现一次**（破坏点即声明处）。
 */
const PROBE_REL = 'tests/audit/memory_growth_probe.cjs';
const ANCHOR_OLD = "    out.verdict.module_heap = perRoundKB >= 32 ? 'leak-candidate' : 'linear-acceptable';\n";
const NEW_OK = "    out.verdict.module_heap = !GC_FORCED\n        ? 'inconclusive'\n        : (perRoundMedKB >= 32 ? 'leak-candidate' : 'linear-acceptable');\n";
function judgeProbe(txt) {
    return {
        /* ① 拒判分支在场：**模块面那一份形态**（NEW_OK）必须以 GC_FORCED 为条件、且给出 inconclusive。
         *   ★ [v3.23.4] 本锚点已随探针「判决下移到跨次中位数」同步（perRoundKB → perRoundMedKB）：旧锚点不同步会使本判据恒假红。
         *   ★ [v3.23.2] 原写法只查「文件里出现过 !GC_FORCED」—— 探针新增第 ③b 段（宿主往返）
         *     后文件里有了**第二处**拒判，于是破坏模块面那一处之后本判据仍为真（负控制不转红，
         *     即弱口径）。改锚到 NEW_OK：字面量仍只在声明处出现一次（H5 纯度不破），
         *     且三种情形都实测过（真源码 true / 破坏 false / 逆向 false）。 */
        hasGuard: txt.indexOf(NEW_OK) >= 0 && txt.indexOf("'inconclusive'") >= 0,
        /* ② 旧的「无条件按斜率判定」写法必须已不存在（否则 ① 可能恒真） */
        oldFormGone: txt.indexOf(ANCHOR_OLD) < 0
    };
}
test('E1 探针与基线在场，读数分块且带噪声声明', () => {
    const probe = readRel(PROBE_REL);
    const base = JSON.parse(readRel('tests/audit/memory_growth_baseline.json'));
    assert.ok(/--expose-gc|global\.gc/.test(probe), '探针必须支持强制回收（否则读数不可判）');
    /* ★ v3.22.0：**不可判时不得发判定**。
     *   实证：同一份代码，不带 --expose-gc 得 166.75KB/轮（⇒ leak-candidate），带 gc 得 0.75KB/轮
     *   （⇒ linear-acceptable）—— 差 300 倍。前者量的是未回收垃圾，不是泄漏。
     *   本仓已有同族纪律「读不到就 fail-closed（exit 2），绝不发合格证」；此处是它的镜像：
     *   **不可判就不发不合格证**。判据本体见上方 judgeProbe（唯一实现，负控制见 F5 的反向自证）。 */
    const jp = judgeProbe(probe);
    assert.ok(jp.hasGuard,
        '★ 未强制回收时探针必须**拒判**（inconclusive），不得按不可信的斜率发 leak-candidate');
    assert.ok(jp.oldFormGone,
        '★ 旧的「无条件按斜率判定」写法必须已不存在 —— 否则上一条断言可能恒真（判据纯度）');
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

    /* ★ [v3.23.4] 同族：模块面的判决也必须来自**跨次中位数**且可从 samples 复算。
     *   单次采样不可判 —— 同一份代码 12 连跑出现过 0.5KB/轮 与 55.25KB/轮 两个档次。 */
    const ms = base.readings.heap_tail_kb_per_round_samples;
    assert.ok(Array.isArray(ms) && ms.length >= 3,
        '★ 模块面判决必须来自跨次中位数（≥3 跑），不能押在单次采样上');
    const msorted = ms.slice().sort((x, y) => x - y);
    const mm = Math.floor(msorted.length / 2);
    const mmed = msorted.length % 2 ? msorted[mm]
        : Math.round(((msorted[mm - 1] + msorted[mm]) / 2) * 100) / 100;
    assert.equal(base.verdict.module_heap, mmed >= 32 ? 'leak-candidate' : 'linear-acceptable',
        '★ 模块面判决必须等于由 samples 中位数复算的结果（实测中位数 ' + mmed + 'KB/轮）');
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

/* ══════════ F5 ── 探针判据的负控制（三向自证） ══════════ */
/**
 * F5 与 F1–F4 同族，但破坏的是**探针源码**（不是产品模块），故不 import、只做文本判定。
 * 三次对照证明判据**不是空转**：
 *   ① 真源码上判据必须真；
 *   ② **真·破坏**（把旧写法换回去）后判据必须转红 —— 破坏由真源码 split/join 产出，
 *      锚点恰中 1 次（中 0 次即 fail，避免「破坏没发生也绿」）；
 *   ③ **逆向破坏**（把拒判分支整段删掉、只留旧写法）后判据也必须红 —— 证明两条断言互补，
 *      不是「只要文件里出现过 inconclusive 字样就算过」。
 */
test('F5★ 探针判据的负控制：真源码破坏 ⇒ 同款判据必须转红（且不得假绿）', () => {
    const src = readRel(PROBE_REL);
    /* ① 真源码：两条都真 */
    const live = judgeProbe(src);
    assert.ok(live.hasGuard && live.oldFormGone, '① 真源码上判据必须为真');

    /* ② 真·破坏：把 v3.22.0 的拒判三目换回「无条件按斜率判定」 */
    const hits = src.split(NEW_OK).length - 1;
    assert.equal(hits, 1, '② 破坏锚点必须恰中 1 次（实测 ' + hits + '）—— 中等 0 次意味着破坏没发生');
    const damaged = src.split(NEW_OK).join(ANCHOR_OLD);
    assert.notEqual(damaged, src, '② 破坏必须真的改变了文本');
    const j2 = judgeProbe(damaged);
    assert.equal(j2.hasGuard, false, '② ★ 破坏后「拒判分支在场」判据必须转红');
    assert.equal(j2.oldFormGone, false, '② ★ 破坏后「旧写法已不存在」判据必须转红');

    /* ③ 逆向破坏：只留旧写法、整个拒判分支不存在（模拟「只是把字样写进注释充数」）——
     *    这一向专挡「文件里出现过 inconclusive 字样就算过」的假绿。 */
    const stripped = src.replace(/!GC_FORCED/g, 'trueValue').replace(/'inconclusive'/g, 'REPLACED');
    assert.notEqual(stripped, src, '③ 逆向破坏必须真的改变了文本');
    const j3 = judgeProbe(stripped);
    assert.equal(j3.hasGuard, false, '③ ★ 摘掉拒判分支后判据必须转红（不得只看字样）');
});

/* ══════════ H ── 新 App（focus / accounting）取证面 ══════════ */
/**
 * 为什么有这一段：基线 v3.22.0 的 `not_done` 里逐字写着「新 App（focus/accounting）**单独的**堆/监听器面：
 *   本轮探针驱动的是 knowledge/story-clock/dryrun/plotline 四个模块面，未覆盖新 App 的视图构造」。
 * 本段补的是其中**能测且该测**的两条结构性事实：① 宿主钩子幂等；② tick 清退。
 *
 * 【为什么把「钩子幂等」当判据（而不是「监听器泄漏」）】
 *   本仓 App 实例槽位是**懒加载单例**（`index.js` 里 `if (!window.VirtualPhone.focusApp)`），
 *   进程内重复构造最多一次 ⇒ 「每实例订阅一次」在进程层面不是泄漏。真正会静默变坏的是
 *   **幂等哨兵**（`if (this._hookBound) return;`）：它一坏，用户每打开一次 App，
 *   发给模型的注入就多一份，而全仓**没有任何一道门会响**。
 *   ★ 本段首版测出了**假红**：夹具的 `eventSource.count()` 是全局累计、不按实例分，
 *   测 accounting 时把 focus 的 1 条一起算成 2 ⇒ 误判 not-idempotent。
 *   修法：每个 App 测量前先 `reset()`（同一量必须在同一窗口内比）。
 */
const PROBE_REL_H = 'tests/audit/memory_growth_probe.cjs';
/** 小树：只含探针跑得起来所需的目录（整仓 67MB/777 文件，小树 ~5MB）。 */
function mkProbeTree(dir) {
    fs.mkdirSync(path.join(dir, 'tests', 'audit'), { recursive: true });
    fs.copyFileSync(path.join(ROOT, 'index.js'), path.join(dir, 'index.js'));
    fs.copyFileSync(path.join(ROOT, 'manifest.json'), path.join(dir, 'manifest.json'));
    for (const [src, dst] of [['config', ['config']], ['apps/focus', ['apps', 'focus']],
        ['apps/accounting', ['apps', 'accounting']], ['apps/plotline', ['apps', 'plotline']],
        ['apps/worldpulse', ['apps', 'worldpulse']]]) {
        const to = path.join(dir, ...dst);
        fs.mkdirSync(to, { recursive: true });
        for (const f of fs.readdirSync(path.join(ROOT, src))) {
            if (f.endsWith('.js')) fs.copyFileSync(path.join(ROOT, src, f), path.join(to, f));
        }
    }
    fs.copyFileSync(path.join(ROOT, 'tests', '_runtime_host.mjs'), path.join(dir, 'tests', '_runtime_host.mjs'));
    fs.copyFileSync(path.join(ROOT, PROBE_REL_H), path.join(dir, 'tests', 'audit', 'memory_growth_probe.cjs'));
    return path.join(dir, 'tests', 'audit', 'memory_growth_probe.cjs');
}
/** 在给定小树里真跑探针（--json），返回解析后的读数。跑不起来 ⇒ 抛（不静默降级）。 */
function runProbeIn(dir) {
    const p = path.join(dir, 'tests', 'audit', 'memory_growth_probe.cjs');
    const r = spawnSync(process.execPath, ['--expose-gc', p, '--json'],
        { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
    assert.equal(r.status, 0, '探针必须 exit 0（stderr: ' + String(r.stderr || '').slice(0, 300) + '）');
    return JSON.parse(r.stdout);
}
test('H1 探针导出「新 App 结构性事实」取证面（文本面在场，且不是空壳）', () => {
    const probe = readRel(PROBE_REL_H);
    for (const k of ['out.facts', 'focus_hook', 'accounting_hook', 'focus_tick', 'new_app_hooks']) {
        assert.ok(probe.includes(k), '探针必须导出：' + k);
    }
    /* 读数必须在**探针里算**（不是由基线手写）：hydrated 的判定条件必须在源码中可见 */
    assert.ok(/hydrated: \(first === 1 && second === 1\)/.test(probe),
        '★ 幂等的判定必须是「首开与再开都恰 1 条」（判据在探针里，不在基线里）');
});
test('H2 基线读数与探针**现场**一致（当场重跑、当场比 —— 零手抄）', () => {
    const base = JSON.parse(readRel('tests/audit/memory_growth_baseline.json'));
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rp_v3210h_'));
    try {
        mkProbeTree(dir);
        const live = runProbeIn(dir);
        assert.ok(live.facts, '探针必须输出 facts 段');
        assert.equal(live.verdict.new_app_hooks, 'ok',
            '★ 两个新 App 的宿主钩子必须幂等（重复 render 后订阅数不变）—— 实测 '
            + live.verdict.new_app_hooks + '：' + live.verdict.new_app_hooks_note);
        assert.equal(live.facts.focus_hook.on_first_open, 1, 'focus 首开恰 1 条订阅');
        assert.equal(live.facts.focus_hook.on_second_open, 1, 'focus 再开仍是 1 条（幂等哨兵在场）');
        assert.equal(live.facts.accounting_hook.on_first_open, 1, 'accounting 首开恰 1 条订阅');
        assert.equal(live.facts.accounting_hook.on_second_open, 1, 'accounting 再开仍是 1 条');
        assert.equal(live.facts.focus_tick.started, true, '前置：倒计时任务真启动了（否则 tick 清退测不到）');
        assert.equal(live.facts.focus_tick.tick_while_running, true,
            '★ 前置：tick 在跑 —— 否则「切走后被清」是「本来就没有」的假绿');
        assert.equal(live.facts.focus_tick.tick_after_deactivate, true, '★ deactivate 必须把 tick 真清掉');
        /* 基线必须落着同一批读数（防「探针改了、基线还是旧数」）。
         * ★ [v3.23.4] 只比**确定性**字段：`facts.host_roundtrip.verdict` 由浮点斜率派生，
         *   逐字比会让本判据**间歇性翻面**（实测同一份代码 12 连跑出现 0.5 与 55.25 两个档次）。
         *   verdict 已移出 facts（归 readings/verdict）；此处仍逐字比 facts 的**全部**内容。 */
        assert.equal(Object.keys(base.facts).sort().join(','), Object.keys(live.facts).sort().join(','),
            '基线与现场的 facts 键集必须一致（防「探针加了字段、基线没跟」）');
        assert.equal(JSON.stringify(base.facts), JSON.stringify(live.facts),
            '★ 基线的 facts 必须等于探针现场输出（不一致 ⇒ 基线是手抄的或探针改了没复校）');
        assert.equal('verdict' in live.facts.host_roundtrip, false,
            '★ facts 里不得再嵌**浮点派生**的判决（它会随 GC 时机翻面 ⇒ 判据间歇假红）');
        /* ★ 判决必须取**跨次中位数**，不是某一次采样：单次读数不可判
         *   （同一份代码实测 0.5 / 0.75 / 1 / 1.25 / 1.5 / 2.25 / 4 / 55.25 KB/轮）。 */
        const hs = live.readings.host_roundtrip_per_round_kb_samples;
        assert.ok(Array.isArray(hs) && hs.length >= 3,
            '★ 判决必须来自跨次中位数（≥3 跑）：单次采样的斜率是噪声，不是机制');
        const hsorted = hs.slice().sort((x, y) => x - y);
        const hm = Math.floor(hsorted.length / 2);
        const hmed = hsorted.length % 2 ? hsorted[hm]
            : Math.round(((hsorted[hm - 1] + hsorted[hm]) / 2) * 100) / 100;
        assert.equal(live.readings.host_roundtrip_per_round_median_kb, hmed,
            '★ 落进判决的中位数必须能从 samples **复算**（防「中位数手写」）');
        assert.equal(live.verdict.host_injection,
            (!live.facts.host_roundtrip.globals_restored_all ? 'globals-not-restored'
                : (hmed >= 32 ? 'leak-candidate' : 'linear-acceptable')),
            '★ 判决必须由【中位数】与【同一性还原】两个**可复算量**唯一决定');
        assert.equal(base.verdict.host_injection, live.verdict.host_injection, '迁移判决必须与现场同源');
        assert.equal(base.verdict.new_app_hooks, live.verdict.new_app_hooks, '基线与现场的新 App 判决必须同源');
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});
test('H3★ 负控制：摘掉幂等哨兵 ⇒ 同款真判据必须转红（真源码破坏 + 真跑）', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rp_v3210h3_'));
    try {
        mkProbeTree(dir);
        /* ★ 破坏必须打在**决定行为的那个文件**上：哨兵在产品 App 里，不在探针里。
         *   本测试首版把破坏打在探针源码上（锚点 0 命中）—— 那正是「锚点选错靶子」。 */
        const anchor = '            this._hookBound = true;\n';
        let total = 0;
        for (const rel of [['apps', 'focus', 'focus-app.js'], ['apps', 'accounting', 'accounting-app.js']]) {
            const p = path.join(dir, ...rel);
            const s = fs.readFileSync(p, 'utf8');
            const hits = s.split(anchor).length - 1;
            assert.equal(hits, 1, rel.join('/') + ' 的哨兵必须恰 1 处，实测 ' + hits);
            total += hits;
            fs.writeFileSync(p, s.split(anchor).join(''));
        }
        assert.equal(total, 2, '两个 App 合计 2 处哨兵被摘，实测 ' + total);
        const live = runProbeIn(dir);
        assert.equal(live.verdict.new_app_hooks, 'not-idempotent',
            '★ 哨兵被摘掉后同款判据必须转红（实测仍是 ' + live.verdict.new_app_hooks + '）');
        /* 反向：读数字面也必须变硬（不是只换了一句话） */
        assert.ok(live.facts.focus_hook.on_second_open > live.facts.focus_hook.on_first_open,
            '★ 破坏后每开一次就多一条订阅（first ' + live.facts.focus_hook.on_first_open
            + ' → second ' + live.facts.focus_hook.on_second_open + '）');
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});
/* ══════════ I ── B2 迁移取证面（宿主注入对象 · **桩宿主近似**） ══════════ */
/**
 * 为什么有这一段：基线 v3.23.1 的 `unmeasurable` 里有一条「宿主（SillyTavern）注入对象的内存占用」，
 *   `PLAN.md` 的 B2 验收是「`unmeasurable` 计数下降，迁移条目转为**有读数的断言**」。
 * 本段守的是迁移的三条底线（缺一条，迁移就成了拿「近似」冒充「测过」）：
 *   ① 有**可复跑的读数**（不是「以后再说」）；
 *   ② 如实写明**还剩什么不可测**（`still_unmeasurable`）；
 *   ③ 判据**有负控制**（I3：真源码破坏后必须转红）。
 * ★ 还原判定用**对象同一性** `===`：夹具不还原时 `typeof globalThis.window` 仍是 'object'，
 *   弱判定会给出恒真的假绿 —— 故展示字段与判定字段必须是同一个 `===`。
 */
test('I1 探针导出「宿主注入对象往返（桩宿主近似）」取证面，且不是空壳', () => {
    const probe = readRel(PROBE_REL_H);
    for (const k of ['host_roundtrip', 'host_roundtrip_samples_kb', 'host_roundtrip_per_round_kb',
        'host_roundtrip_restored', 'globals_same_obj', 'globals_restored_all', 'host_injection']) {
        assert.ok(probe.includes(k), '探针必须导出：' + k);
    }
    assert.ok(/globals_same_obj: RESTORE_KEYS\.map\(\(k\) => globalThis\[k\] === baseGlobals\[k\]\)/.test(probe),
        '★ 展示字段必须与判定**同源**（都用 ===）；typeof 在未还原时仍是 object ⇒ 假绿');
    assert.equal(/globals_after/.test(probe), false,
        '弱口径字段 globals_after 不得残留（展示面不得弱于判定面）');

    const b = JSON.parse(readRel('tests/audit/memory_growth_baseline.json'));
    assert.ok(Array.isArray(b.approx_measurable) && b.approx_measurable.length === 1,
        '必须恰有 1 条从 unmeasurable 迁出的「近似可测」登记');
    const am = b.approx_measurable[0];
    assert.ok(am.readings && typeof am.readings.host_roundtrip_per_round_kb === 'number',
        '① 迁移条目必须带**真读数**（不是「以后再说」）');
    assert.ok(typeof am.still_unmeasurable === 'string' && /真宿主/.test(am.still_unmeasurable),
        '② ★ 迁移条目必须如实写明**还剩什么不可测**（真宿主本体那一份）');
    assert.equal(b.unmeasurable.some((u) => /宿主（SillyTavern）注入对象/.test(u.item)), false,
        '★ 宿主注入对象这条必须已从 unmeasurable 迁出（B2 验收：计数下降）');
    assert.ok(b.unmeasurable.length >= 3, '其余不可测项仍须登记（不得顺手抹掉）');
});

test('I2 迁移读数与探针**现场**逐字同源（当场重跑、当场比 —— 零手抄）', () => {
    const b = JSON.parse(readRel('tests/audit/memory_growth_baseline.json'));
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rp_v3210i_'));
    try {
        mkProbeTree(dir);
        const live = runProbeIn(dir);
        assert.equal(live.unmeasurable.length, 3, '★ 探针现场的 unmeasurable 必须是 3 条（4 → 3）');
        assert.equal(live.approx_measurable.length, 1, '探针现场必须导出 1 条近似可测项');
        assert.equal(live.verdict.host_injection, 'linear-acceptable',
            '★ 桩宿主往返必须判为无沉淀（实测 ' + live.verdict.host_injection + '：'
            + String(live.verdict.host_injection_note).slice(0, 90) + '）');
        assert.equal(live.facts.host_roundtrip.globals_restored_all, true,
            '★ 装/卸 8 轮后四个宿主全局必须按**同一性**逐轮还原');
        assert.equal(live.readings.host_roundtrip_restored.every(Boolean), true,
            '逐轮布尔数组也必须全 true（不能只看聚合值）');
        /* 设备无关的**确定性**字段逐字同源；浮点斜率/样本绝对值归 readings 的面，不在此比 */
        assert.equal(JSON.stringify(b.facts.host_roundtrip), JSON.stringify(live.facts.host_roundtrip),
            '★ 基线的 facts.host_roundtrip 必须等于探针现场输出（否则基线是手抄的 / 探针改了没复校）');
        assert.equal(JSON.stringify(b.unmeasurable), JSON.stringify(live.unmeasurable),
            '★ 基线的 unmeasurable 必须与现场逐字同源');
        /* ★ 这一处**只比确定性的那一半**：`readings.host_roundtrip_per_round_kb` 与样本数组
         *   本来就随机器抖动（本仓口径：确定性面比字面、浮点面比量级 —— 见 E2 与 H2）。
         *   本套件首版把整条 approx_measurable 逐字比，当场被真跑推翻：基线 1 vs 现场 0.5 ——
         *   那不是「不同源」，是口径错（拿浮点当字面比）。 */
        const stripVol = (arr) => arr.map((x) => ({
            item: x.item, how: x.how, still_unmeasurable: x.still_unmeasurable,
            globals_restored_all: x.readings.globals_restored_all
            /* ★ [v3.23.4] verdict 已移出 facts（浮点派生）⇒ 不再纳入逐字比；
             *   它的同源性由 H2 的「可复算」断言接管。 */
        }));
        assert.equal(JSON.stringify(stripVol(b.approx_measurable)), JSON.stringify(stripVol(live.approx_measurable)),
            '★ 迁移条目的**文本面**（item/how/still_unmeasurable）与确定性读数必须与现场同源');
        assert.ok(typeof b.approx_measurable[0].readings.host_roundtrip_per_round_median_kb === 'number'
            && b.approx_measurable[0].readings.host_roundtrip_per_round_median_kb < 32,
            '★ 落进基线的**中位数**必须与判决同档（< 32KB/轮 才配叫 linear-acceptable）');
        assert.equal(b.verdict.host_injection, live.verdict.host_injection, '迁移判决必须与现场同源');
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('I3★ 负控制：破坏夹具的还原 ⇒ 同款判据必须转红（真源码破坏 + 真跑）', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rp_v3210i3_'));
    try {
        mkProbeTree(dir);
        /* 破坏打在**决定行为的那个文件**上：夹具 `uninstall()` 的还原循环（不是探针）。 */
        const hp = path.join(dir, 'tests', '_runtime_host.mjs');
        const s = fs.readFileSync(hp, 'utf8');
        const anchor = '        if (v === undefined) delete globalThis[k];\n        else globalThis[k] = v;\n';
        const hits = s.split(anchor).length - 1;
        assert.equal(hits, 1, '还原循环锚点必须恰中 1 次（实测 ' + hits + '）—— 中 0 次意味着破坏没发生');
        fs.writeFileSync(hp, s.split(anchor).join('        void v; /* 破坏：不还原 */\n'));
        const live = runProbeIn(dir);
        assert.equal(live.verdict.host_injection, 'globals-not-restored',
            '★ 夹具不还原后同款判据必须转红（实测仍是 ' + live.verdict.host_injection + '）');
        assert.equal(live.facts.host_roundtrip.globals_restored_all, false,
            '★ 破坏后 globals_restored_all 必须为 false（不是只换了一句话）');
        assert.equal(live.readings.host_roundtrip_restored.some((x) => x === false), true,
            '★ 逐轮数组里必须真的出现 false');
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

/* ══════════ N ── 判决面的负控制（v3.23.4） ══════════ */
/**
 * 为什么有这一段：本版把**裁决面**从「单次采样的浮点斜率」下移到「跨次中位数」。
 *   这是一条**可以被打回**的纪律（退回单次采样代码仍能跑、仍能出判决），故它必须有判据 + 负控制 ——
 *   否则下一个人把 medianOf 去掉，全仓不会有任何一道门响。
 *
 * ⚠ H5 判据纯度：下面的锚点字面量在本文件内**只准出现一次**（即下面这个正则里那一次）。
 */
const SINGLE_SAMPLE_FORM = /(?:perRound|hostPerRound) >= 32/;
function judgeMedianForm(txt) {
    return {
        /* ① 两处判决都取自中位数（模块面 + 宿主面） */
        byMedian: /medianOf\(out\.readings\.heap_tail_kb_per_round_samples\)/.test(txt)
            && /medianOf\(hostPerRoundSamples\)/.test(txt),
        /* ② 旧的「拿单次采样直接比阈值」写法必须已不存在（否则 ① 可能恒真） */
        singleGone: !SINGLE_SAMPLE_FORM.test(txt),
        /* ③ 中位数必须能从落盘的 samples 复算（样本数组在场） */
        samplesKept: /heap_tail_kb_per_round_samples/.test(txt)
            && /host_roundtrip_per_round_kb_samples/.test(txt)
    };
}
test('N1★ 判决必须取自跨次中位数（判据 + 两向负控制：退回单次采样必须转红）', () => {
    const src = readRel(PROBE_REL);
    const live = judgeMedianForm(src);
    assert.ok(live.byMedian && live.singleGone && live.samplesKept,
        '① 真源码上三条必须全真（实测 ' + JSON.stringify(live) + '）');
    /* ② 真·破坏：把模块面的中位数换回单次采样 */
    const anchorA = 'medianOf(out.readings.heap_tail_kb_per_round_samples)';
    assert.equal(src.split(anchorA).length - 1, 1, '② 锚点 A 必须恰中 1 次');
    const d2 = src.split(anchorA).join('perRoundKB');
    assert.notEqual(d2, src, '② 破坏必须真的改变了文本');
    assert.equal(judgeMedianForm(d2).byMedian, false, '② ★ 破坏后 byMedian 必须转红');
    /* ③ 逆向破坏：判决行退回「单次采样直接比阈值」 */
    const anchorB = 'hostPerRoundMedKB >= 32';
    assert.equal(src.split(anchorB).length - 1, 1, '③ 锚点 B 必须恰中 1 次');
    const d3 = src.split(anchorB).join('hostPerRound >= 32');
    assert.equal(judgeMedianForm(d3).singleGone, false, '③ ★ 退回单次采样后 singleGone 必须转红');
    /* ④ 拿掉样本数组（中位数不可复算） */
    const d4 = src.split('host_roundtrip_per_round_kb_samples').join('host_roundtrip_x');
    assert.equal(judgeMedianForm(d4).samplesKept, false, '④ ★ 去掉样本数组后 samplesKept 必须转红');
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
