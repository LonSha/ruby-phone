#!/usr/bin/env node
/* ============================================================
 * tests/audit/memory_growth_probe.cjs
 * 探针：内存快照增长 / 单次渲染耗时取证 —— 只量，不改。
 * ------------------------------------------------------------
 * 【要回答的问题】（TODO 唯一悬挂项）
 *   ① 反复调用本仓的**纯模块面**，堆内存是「机制级泄漏」（有东西被留住了）还是
 *      「线性增长」（只是分配 + GC 未及时回收）？
 *   ② 真模块的**监听器/实例槽位**在反复构造-释放后是否回到基线？（这是本仓历史上
 *      最真实的泄漏形态：构造期全局监听器重建即沉淀）
 *   ③ 单次渲染耗时：**在本环境可测的部分**是什么？（无 DOM ⇒ 只测「HTML 串生成」这一段）
 *
 * 【本环境能测什么、不能测什么（诚实边界，与 docs/runtime-verification-boundary.md 同源）】
 *   能测：
 *     · `process.memoryUsage().heapUsed` 的**趋势**（同进程内、同一批操作、逐步取样）；
 *     · 模块面「反复构造 N 轮后监听器数量」—— 夹具提供登记面（`listenerCount()`）；
 *     · 视图层的 `render()` 产物长度与**串生成**耗时（**这不是 DOM 渲染耗时**）。
 *   不能测：
 *     · 真实排版/绘制/合成耗时（无布局引擎）；
 *     · V8 之外的运行时内存、**真宿主**注入对象的内存。
 *       （桩宿主近似见下方 ③b 段 —— 迁出的是「反复装/卸是否有沉淀」，不是「真宿主占多少」。）
 *   **本探针的所有计时读数都不是实机渲染耗时** —— 报告中每个计时段都带 `not_render: true` 标记。
 *
 * 【口径纪律（沿用 long_chat_probe 的五条）】
 *   · 只读：不写任何文件、不改宿主；基线由调用方重定向 stdout 落盘（读数零手抄）。
 *   · 计数段可复算；计时段与内存段**不可复算**（GC / 调度会动它）⇒ 分块，套件只比同量级。
 *   · 位置无关：根走 --root 或 __dirname/../..，代码里不得出现绝对路径字面量。
 *   · 读不到就 fail-closed（exit 2），绝不以 0 发合格证。
 *   · **内存读数必须带「噪声声明」**：单点 heapUsed 不可判泄漏，只看**跨轮趋势**；
 *     且必须先跑预热轮并在取样前 `global.gc?.()`（无 --expose-gc 时如实标注未强制回收）。
 *
 * 【本版只取证】不改产品代码。
 * ============================================================ */
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const argv = process.argv.slice(2);
const argVal = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : null; };
const JSON_MODE = argv.includes('--json');
const rootArg = argVal('--root');
const ROOT = rootArg ? path.resolve(rootArg) : path.resolve(__dirname, '..', '..');

const ROUNDS = Math.max(2, Number(argVal('--rounds')) || 8);
const PER_ROUND = Math.max(10, Number(argVal('--ops')) || 400);
/* ★ [v3.23.4] 判决取**跨次中位数**：连跑 TRIALS 次（各自独立采样窗口），
 *   中位数进判决，单次读数只落 readings。理由见下方 ① 段与 ③b 段的注释。 */
const TRIALS = Math.max(1, Math.min(9, Number(argVal('--trials')) || 3));

const IDX = path.join(ROOT, 'index.js');
const APPS = path.join(ROOT, 'apps');
const CONFIG = path.join(ROOT, 'config');
const HOSTF = path.join(ROOT, 'tests', '_runtime_host.mjs');
for (const [p, label] of [[IDX, 'index.js'], [APPS, 'apps/'], [CONFIG, 'config/'], [HOSTF, 'tests/_runtime_host.mjs']]) {
    if (!fs.existsSync(p)) {
        console.error('[mem] 读不到 ' + label + ' —— fail-closed 拒判');
        process.exit(2);
    }
}
const MANIFEST = (() => {
    try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8')); } catch (_e) { return null; }
})();
if (!MANIFEST || !MANIFEST.version) {
    console.error('[mem] 读不到 manifest.json 的 version —— fail-closed 拒判');
    process.exit(2);
}
const MEASURED_AT = 'v' + MANIFEST.version;
const GC_FORCED = typeof global.gc === 'function';

/** 取样：先（可选）强制回收，再读 heapUsed。 */
function heapKB() {
    if (GC_FORCED) { try { global.gc(); } catch (_e) { /* 忽略 */ } }
    return Math.round(process.memoryUsage().heapUsed / 1024);
}

const NL = String.fromCharCode(10);
/** 中位数（四舍五入到两位小数）。同一口径只许一份实现 —— 模块面与宿主面共用本函数。 */
function medianOf(arr) {
    const a = arr.slice().sort((x, y) => x - y);
    const m = Math.floor(a.length / 2);
    return a.length % 2 ? a[m] : Math.round(((a[m - 1] + a[m]) / 2) * 100) / 100;
}
const out = {
    file: 'tests/audit/memory_growth_probe.cjs',
    note: '内存快照增长 / 渲染耗时取证。**无浏览器 / 无 DOM**：计时读数一律不是实机渲染耗时。',
    measured_at: MEASURED_AT,
    node_version: process.version,
    gc_forced: GC_FORCED,
    noise_note: GC_FORCED
        ? '已用 --expose-gc 强制回收后取样；单点仍不可判泄漏，只判**跨轮趋势**。'
        : '**未**强制回收（无 --expose-gc）：单点 heapUsed 噪声很大，只能看趋势斜率是否显著为正。',
    rounds: ROUNDS,
    trials: TRIALS,
    ops_per_round: PER_ROUND,
    readings: {},
    timings: {},
    listeners: {},
    verdict: {}
};

(async () => {
    const HOST = await import(pathToFileURL(HOSTF).href);
    const KC = await import(pathToFileURL(path.join(CONFIG, 'knowledge-contract.js')).href);
    const SC = await import(pathToFileURL(path.join(CONFIG, 'story-clock.js')).href);
    const DR = await import(pathToFileURL(path.join(CONFIG, 'worldbook-dryrun.js')).href);
    const PL = await import(pathToFileURL(path.join(APPS, 'plotline/plotline-data.js')).href);

    /* ---------- 夹具数据（合成，与实机无关） ---------- */
    const people = (() => {
        const kn = {};
        for (let c = 0; c < 24; c++) {
            kn['角色' + c] = {
                known: Array.from({ length: 12 }, (_, i) => '事实' + c + '-' + i),
                unaware: Array.from({ length: 4 }, (_, i) => '秘密' + c + '-' + i)
            };
        }
        return KC.knowledgeFace({ worldProg: { knowledge: kn }, faceState: 'present' });
    })();

    /* ---------- ① 模块面：反复调用的堆增长 ---------- */
    const samples = [];
    /* 预热（不计入趋势）：JIT 与首次分配都发生在这一轮 */
    for (let i = 0; i < PER_ROUND; i++) {
        KC.whoKnows(people.people, '事实0-1');
        PL.plotlinePromptBlock({ worldProg: { knowledge: { 甲: { known: ['x'], unaware: ['y'] } } } }, { maxLines: 10 });
    }
    for (let r = 0; r < ROUNDS; r++) {
        for (let i = 0; i < PER_ROUND; i++) {
            /* 三面混合调用：知识面（匹配 + 三档分形）/ 时间面 / 干跑投影 */
            KC.whoKnows(people.people, '事实' + (i % 24) + '-' + (i % 12));
            KC.boundaryOf(people.people, '角色' + (i % 24));
            SC.storyClock({});
            DR.dryRunLoreBlock({ entries: [{ comment: 'c' + i, content: 'x'.repeat(64) }] }, { maxChars: 500 });
            PL.plotlinePromptBlock({ worldProg: { knowledge: { 甲: { known: ['x'], unaware: ['y'] } } } }, { maxLines: 10 });
        }
        samples.push(heapKB());
    }
    const first = samples[0];
    const last = samples[samples.length - 1];
    const growthKB = last - first;
    /* 趋势判定：用**后半段斜率**（前半段含 JIT/缓存填充，不是泄漏） */
    const half = Math.floor(samples.length / 2) || 1;
    const tailFirst = samples[half];
    const tailGrowth = last - tailFirst;
    const perRoundKB = Math.round((tailGrowth / Math.max(1, samples.length - half)) * 100) / 100;
    out.readings.heap_samples_kb = samples;
    out.readings.heap_first_kb = first;
    out.readings.heap_last_kb = last;
    out.readings.heap_total_growth_kb = growthKB;
    out.readings.heap_tail_growth_kb = tailGrowth;
    out.readings.heap_tail_kb_per_round = perRoundKB;
    /* ★ [v3.23.4] 单次采样的斜率**本身就是噪声**：8 轮里只要 GC 迟到一轮，末轮就多背 50~270KB
     *   （实测同一份代码 12 连跑：0.5 / 0.75 / 1 / 1.25 / 1.5 / 2.25 / 4 / **55.25** KB/轮 ——
     *   差一个半数量级）。按单次读数发判决 = 「把抖动当机制」，且会让下游判据（H2/I2 逐字比
     *   facts）**间歇性翻面**。修法：判决下移到**跨次中位数**（TRIALS 份独立采样窗口各自算
     *   斜率，取中位数）；单次读数一律只落 readings。与 noise_note 的既有口径同族：单点不可判，只判趋势。 */
    out.readings.heap_tail_kb_per_round_samples = [perRoundKB];
    for (let t = 1; t < TRIALS; t++) {
        const ts = [];
        for (let r = 0; r < ROUNDS; r++) {
            for (let i = 0; i < PER_ROUND; i++) {
                KC.whoKnows(people.people, '事实' + (i % 24) + '-' + (i % 12));
                KC.boundaryOf(people.people, '角色' + (i % 24));
                SC.storyClock({});
                DR.dryRunLoreBlock({ entries: [{ comment: 'c' + i, content: 'x'.repeat(64) }] }, { maxChars: 500 });
                PL.plotlinePromptBlock({ worldProg: { knowledge: { 甲: { known: ['x'], unaware: ['y'] } } } }, { maxLines: 10 });
            }
            ts.push(heapKB());
        }
        const th = Math.floor(ts.length / 2) || 1;
        out.readings.heap_tail_kb_per_round_samples.push(
            Math.round(((ts[ts.length - 1] - ts[th]) / Math.max(1, ts.length - th)) * 100) / 100);
    }
    const perRoundMedKB = medianOf(out.readings.heap_tail_kb_per_round_samples);
    /* 阈值是**量级判据**：每轮 < 32KB 视为「线性且微小」；≥ 32KB/轮 才立泄漏候选。
     * ★ v3.22.0：**未强制回收时一律拒判**（inconclusive）。
     *   理由：不带 --expose-gc 时读数含未回收垃圾 —— 实测 166.75KB/轮 vs 带 gc 的 0.5KB/轮，
     *   差 300 倍。按这个斜率判 leak-candidate，等于「拿噪声当证据」。
     *   同族纪律：读不到就 fail-closed（exit 2），绝不发合格证；此处是它的镜像 ——
     *   不可判就不发**不合格**证。方向不是「把阈值调宽」，而是让非决定面说自己是非决定的。 */
    out.verdict.module_heap = !GC_FORCED
        ? 'inconclusive'
        : (perRoundMedKB >= 32 ? 'leak-candidate' : 'linear-acceptable');
    out.verdict.module_heap_median_kb_per_round = perRoundMedKB;
    out.verdict.module_heap_trials = TRIALS;
    out.verdict.module_heap_note = !GC_FORCED
        ? '**未**强制回收（无 --expose-gc）：' + perRoundKB + 'KB/轮 里含未回收垃圾，**不可判** —— '
          + '请用 `node --expose-gc tests/audit/memory_growth_probe.cjs` 复跑后再下结论'
        : (perRoundMedKB >= 32
            ? '后半段每轮仍在增长 ' + perRoundMedKB + 'KB（' + TRIALS + ' 跑中位数）—— 需要单独立项定位'
            : '后半段每轮增长 ' + perRoundMedKB + 'KB（' + TRIALS + ' 跑中位数，< 32KB/轮）—— 属「线性且微小」');

    /* ---------- ② 监听器：反复构造-释放后是否回到基线 ---------- */
    const host = HOST.installRuntimeHost({ chatLength: 4 });
    try {
        /* 口径：本仓 App 的常驻订阅走**宿主事件源**（`ctx.eventSource.on`），
         *   不是 `window.addEventListener` —— 故两条面都要看：
         *     · `listenerCount()` = 全局监听器（window/document/visualViewport）；
         *     · `eventSource.total()` = 事件源上的 handler 数。
         *   只看前者会得到恒 0 的假读数（本探针首版就是这么错的，已修）。 */
        const base = host.listenerCount();
        const baseEs = host.eventSource.total();
        let peak = base;
        let peakEs = baseEs;
        for (let r = 0; r < ROUNDS; r++) {
            const wpMod = await import(pathToFileURL(path.join(APPS, 'worldpulse/worldpulse-app.js')).href);
            const app = new wpMod.WorldpulseApp({ showNotification() {} }, { get: () => null, set() {} });
            try { app.startListening(); } catch (_e) { /* 夹具可能无事件源：如实继续 */ }
            peak = Math.max(peak, host.listenerCount());
            peakEs = Math.max(peakEs, host.eventSource.total());
            try { app.stopListening(); } catch (_e) { /* 忽略 */ }
        }
        const after = host.listenerCount();
        const afterEs = host.eventSource.total();
        out.listeners = {
            base, peak, after, leaked: after - base,
            event_base: baseEs, event_peak: peakEs, event_after: afterEs, event_leaked: afterEs - baseEs,
            rounds: ROUNDS
        };
        out.verdict.listeners = (after - base) === 0 ? 'ok' : 'leak';
        out.verdict.listeners_note = (after - base) === 0
            ? '构造-启动-停止 ' + ROUNDS + ' 轮后全局监听器回到基线（' + base + '）'
            : '构造-启动-停止 ' + ROUNDS + ' 轮后仍多出 ' + (after - base) + ' 个全局监听器 —— 真泄漏';
        out.verdict.event_source = (afterEs - baseEs) === 0 ? 'ok' : 'leak';
        out.verdict.event_source_note = (afterEs - baseEs) === 0
            ? '构造-启动-停止 ' + ROUNDS + ' 轮后事件源 handler 回到基线（' + baseEs + '）'
              + '；峰值 ' + peakEs + ' ⇒ 订阅确实发生了，且被收净（不是「没订上」的假绿）'
            : '构造-启动-停止 ' + ROUNDS + ' 轮后事件源仍多出 ' + (afterEs - baseEs) + ' 个 handler —— 真泄漏';

        /* ---------- ③ 新 App（focus / accounting）结构性事实 ----------
         * 基线 v3.22.0 的 not_done 逐字写着「新 App 单独的面未覆盖」。本段补的是**能测且该测**
         * 的那两条：钩子幂等 / tick 清退。单 App 的「堆趋势」不可判（样本太小），如实留在 not_done。
         * ★ 为什么把「钩子幂等」当判据：本仓 App 实例槽位是懒加载单例（index.js 里 `if (!slot)`），
         *   所以那不是「泄漏」问题；真正会静默变坏的是**幂等哨兵** —— 一旦坏了，用户每打开一次
         *   设置，发给模型的注入就多一份，而全仓没有任何一道门会响。 */
        try {
            host.eventSource.reset();
            const EVT = 'generate_before_combine_prompts';
            const FOCUSM = await import(pathToFileURL(path.join(APPS, 'focus/focus-app.js')).href);
            const ACCM = await import(pathToFileURL(path.join(APPS, 'accounting/accounting-app.js')).href);
            const mkStorage = () => {
                const m = new Map();
                return {
                    get: (k) => (m.has(k) ? m.get(k) : null),
                    set: (k, v) => { m.set(k, v); return true; }
                };
            };
            const mkShell = () => {
                const c = {
                    innerHTML: '', style: {},
                    appendChild() {}, querySelector: () => null, addEventListener() {},
                    classList: { add() {}, remove() {} }
                };
                return { getContentContainer: () => c };
            };
            const open = (App) => {
                const a = new App(mkShell(), mkStorage());
                a.render();          /* 首开：_initHook + probe + view 构造 */
                return a;
            };
            const hookFactsFor = (App) => {
                /* ★ 必须在**本 App 自己的窗口内**计数：夹具的 count() 是全局累计、不按实例分，
                 *   不先清空就会把上一个 App 的订阅算进来（本段首版就是这样造出一处假红的：
                 *   focus 1 条 + accounting 1 条 ⇒ 读成 2，被误判 not-idempotent）。 */
                host.eventSource.reset();
                const a = open(App);
                const first = host.eventSource.count(EVT);
                a.render();          /* 重复打开（手机上是「再点一次」） */
                const second = host.eventSource.count(EVT);
                const bound = (a._hookBound === true);
                try { a.deactivate?.(); } catch (_e) { /* 无 tick：忽略 */ }
                return { on_first_open: first, on_second_open: second, hydrated: (first === 1 && second === 1), bound_flag: bound };
            };
            const focusFacts = hookFactsFor(FOCUSM.FocusApp);
            const accFacts = hookFactsFor(ACCM.AccountingApp);
            /* 上面每个 App 的读数都取自「清空后本 App 窗口」—— 两值各自独立可判。 */
            /* tick 清退：倒计时启动 → 确认 tick 在跑 → deactivate → 必须真被清 */
            let tickFacts;
            try {
                const f = open(FOCUSM.FocusApp);
                const task = f.addTask('探针夹具任务', 'countdown', 25);
                const started = !!(task && f.start(task.id));
                const running = (f._tickTimer !== null && f._tickTimer !== undefined);
                f.deactivate();
                const cleared = (f._tickTimer === null);
                tickFacts = { started, tick_while_running: running, tick_after_deactivate: cleared };
            } catch (e) {
                tickFacts = { started: false, tick_while_running: false, tick_after_deactivate: false, err: String((e && e.message) || e) };
            }
            out.facts = {
                note: '新 App（focus/accounting）的**结构性事实**：钩子幂等 + tick 清退。'
                    + '不测单 App 堆趋势（样本太小不可判，留 not_done）。',
                focus_hook: focusFacts,
                accounting_hook: accFacts,
                focus_tick: tickFacts
            };
            out.verdict.new_app_hooks = (focusFacts.hydrated && accFacts.hydrated) ? 'ok' : 'not-idempotent';
            out.verdict.new_app_hooks_note = (focusFacts.hydrated && accFacts.hydrated)
                ? '两个新 App 重复 render 后宿主订阅数不变（各恰 1 条）—— 幂等哨兵在场'
                : '★ 重复 render 后订阅数变了（focus ' + focusFacts.on_first_open + '→' + focusFacts.on_second_open
                  + ' / accounting ' + accFacts.on_first_open + '→' + accFacts.on_second_open + '）—— 会成倍注入，需单独立项';
            host.eventSource.reset();
        } catch (e) {
            out.facts = { note: '取证失败（如实登记，不假装测过）', err: String((e && e.message) || e) };
            out.verdict.new_app_hooks = 'unmeasurable';
            out.verdict.new_app_hooks_note = '夹具搭不起来：' + String((e && e.message) || e) + '（未在真宿主核对，收在 not_done）';
        }

        /* ---------- ③b 宿主注入对象（**桩宿主近似**）：反复装载/卸载的堆与全局面 ----------
         * 基线 v3.23.1 的 unmeasurable 里有一条「宿主（SillyTavern）注入对象的内存占用 / 无真实宿主」。
         * 本段把它**能近似的那一半**迁进可测面（对应 PLAN.md 的 B2）：
         *   · 可测：install → 使用（造视图元素 / 挂全局监听 / 挂事件源 handler / 写 storage）
         *     → uninstall → resetHostFlags 之后 ① 四个宿主全局**按同一性**回到上一轮那一个；
         *     ② 堆的**跨轮趋势**（带 gc 判斜率；不带 gc 拒判 —— 与 ① 段同纪律）。
         *   · 仍不可测：**真宿主**里那一份注入对象的实际占用 —— 夹具是零依赖替身，不是 SillyTavern 本体。
         * ★ 还原判定用 `===` 比**对象同一性**：夹具若不还原，`typeof globalThis.window` 仍是 'object'，
         *   弱判定会给出恒真的假绿（本段首版就是这么写的，已修）。 */
        const RESTORE_KEYS = ['window', 'document', 'SillyTavern', 'localStorage'];
        const baseGlobals = RESTORE_KEYS.map((k) => globalThis[k]);
        const hostSamples = [];
        const hostRestored = [];
        /* ★ [v3.23.4] 与模块面同因：宿主往返的单次斜率也是噪声（实测 12 连跑 0.5~4KB/轮、偶发 55KB/轮）。
         *   判据同样下移到**跨次中位数**；驱动抽成 hostRoundOnce（不在两处写第二份采样实现）。 */
        const hostRoundOnce = () => {
            const h = HOST.installRuntimeHost({ chatLength: 4 });
            const mk = h.document.createElement;
            for (let i = 0; i < 200; i++) {
                const el = mk('div');
                el.addEventListener('click', () => {});
                h.document.body.appendChild(el);
            }
            for (let i = 0; i < 20; i++) h.window.addEventListener('resize', () => {});
            h.eventSource.on('probe_host_round', () => {});
            try { h.localStorage.setItem('probe_round', String(r)); } catch (_e) { /* 忽略 */ }
            void h.context.chatId;
            h.uninstall();
            HOST.resetHostFlags();
            hostRestored.push(RESTORE_KEYS.every((k, i2) => globalThis[k] === baseGlobals[i2]));
            hostSamples.push(heapKB());
        };
        for (let t = 0; t < TRIALS; t++) {
            for (let r = 0; r < ROUNDS; r++) hostRoundOnce();
        }
        const hostPerRoundSamples = [];
        for (let t = 0; t < TRIALS; t++) {
            const seg = hostSamples.slice(t * ROUNDS, (t + 1) * ROUNDS);
            const hHalf = Math.floor(seg.length / 2) || 1;
            hostPerRoundSamples.push(
                Math.round(((seg[seg.length - 1] - seg[hHalf]) / Math.max(1, seg.length - hHalf)) * 100) / 100);
        }
        const hostPerRound = hostPerRoundSamples[0];
        const hostPerRoundMedKB = medianOf(hostPerRoundSamples);
        const hostRestoredAll = hostRestored.every(Boolean);
        const hostVerdict = !hostRestoredAll
            ? 'globals-not-restored'
            : (!GC_FORCED
                ? 'inconclusive'
                : (hostPerRoundMedKB >= 32 ? 'leak-candidate' : 'linear-acceptable'));
        out.readings.host_roundtrip_samples_kb = hostSamples;
        out.readings.host_roundtrip_per_round_kb = hostPerRound;
        out.readings.host_roundtrip_per_round_kb_samples = hostPerRoundSamples;
        out.readings.host_roundtrip_per_round_median_kb = hostPerRoundMedKB;
        out.readings.host_roundtrip_restored = hostRestored;
        /* ★ facts 段只放**确定性**字段：v3210-H2 会逐字比 `baseline.facts` 与探针现场 facts，
         *   样本数组/浮点斜率放进去会让 H2 永远红 —— 那不是判据坏，是口径错（读数归 readings）。 */
        out.facts.host_roundtrip = {
            note: '**桩宿主近似**：反复 install → 使用 → uninstall 后 (a) 四个宿主全局按**同一性**还原；'
                + '(b) 堆跨轮趋势。**真宿主**（SillyTavern 本体）里那一份注入对象的占用仍不可测。',
            rounds: ROUNDS,
            globals_same_obj: RESTORE_KEYS.map((k) => globalThis[k] === baseGlobals[k]),
            /* ★ 上一条与判定**同源**（都用同一性 `===`）：先前写 typeof 是弱口径 ——
             *   夹具不还原时 `typeof globalThis.window` 仍是 'object'，展示面会给出
             *   「看起来正常」的读数，而判定面其实已经红了。展示面不得弱于判定面。 */
            globals_restored_all: hostRestoredAll,
            trials: TRIALS
            /* ★ [v3.23.4] `verdict` **已移出 facts**：它由浮点斜率派生 ⇒ 跨进程/跨机器不可逐字复现，
             *   H2 与 I2 的「基线与现场逐字同源」会因此**间歇性翻面**（本版实测同一份代码 12 连跑里
             *   出现 0.5 与 55.25 两个档次）。facts 只放**确定性**字段；斜率与判决归 readings/verdict。
             *   这条纪律本探针 ③ 段注释早已写明（「样本数组/浮点斜率放进去会让 H2 永远红」） ——
             *   本版把它贯彽到底：派生判决也在浮点面上。 */
        };
        out.verdict.host_injection = hostVerdict;
        out.verdict.host_injection_note = !hostRestoredAll
            ? '★ 装/卸 ' + ROUNDS + ' 轮后有宿主全局**没回到上一轮那一个** —— 夹具会污染同进程的后续测试'
            : (!GC_FORCED
                ? '**未**强制回收：' + hostPerRoundMedKB + 'KB/轮 含未回收垃圾，**不可判** —— 请带 --expose-gc 复跑'
                : '装/卸 ' + ROUNDS + ' 轮后四个宿主全局逐轮还原，堆后端每轮 ' + hostPerRound
                  + 'KB（' + TRIALS + ' 跑中位数，< 32KB/轮）⇒ 桩宿主下无沉淀；真宿主占用仍不可测（见 unmeasurable）');

        /* ---------- ③c 从「不可测」迁出的**近似可测**项（B2 迁移 · 附读数） ----------
         * 口径：一条从 unmeasurable 迁出的项必须同时满足两点 ——
         *   ① 有一份**可复跑的真读数**（不是「以后再说」）；
         *   ② **如实写明它还剩什么不可测**。
         * 只写「已覆盖」而不给读数、不给残余边界，等于把「近似」冒充成「测过」——
         * 那正是本仓最贵的错读数形态（与「不许把读不到渲染成很快」同族）。 */
        out.approx_measurable = [
            {
                item: '宿主（SillyTavern）注入对象的内存占用（**桩宿主近似**）',
                how: '反复 install → 使用（造视图元素 / 挂全局监听 / 挂事件源 handler / 写 storage）'
                    + ' → uninstall → resetHostFlags；判 (a) 四个宿主全局按**同一性**还原，'
                    + ' (b) 堆的跨轮趋势（带 gc 才判，不带 gc 拒判）',
                readings: {
                    host_roundtrip_per_round_kb: hostPerRound,
                    host_roundtrip_per_round_kb_samples: hostPerRoundSamples,
                    host_roundtrip_per_round_median_kb: hostPerRoundMedKB,
                    host_roundtrip_samples_kb: hostSamples,
                    globals_restored_all: hostRestoredAll,
                    verdict: hostVerdict
                },
                still_unmeasurable: '**真宿主**（SillyTavern 本体）里那一份注入对象的**实际占用** —— '
                    + '夹具是零依赖替身，不是宿主本体；真机读数归 R-O3（真宿主实机验证）'
            }
        ];

        /* ---------- ③ 串生成耗时（**明确不是 DOM 渲染耗时**） ---------- */
        const viewMod = await import(pathToFileURL(path.join(APPS, 'plotline/plotline-view.js')).href);
        const fakeApp = { storage: null, getSettings: () => ({ injectToPrompt: true, maxInject: 10 }), phoneShell: null, plotlineFace: () => ({ reason: 'ready', outline: null, worldProg: null, state: 'ready' }) };
        const view = new viewMod.PlotlineView(fakeApp);
        const pkg = {
            face: { reason: 'ready', text: 'ok' },
            stage: { hasStage: false },
            promises: Array.from({ length: 6 }, (_, i) => ({ character: '甲' + i, content: '承诺' + i, status: 'open', deadline: '' })),
            arcs: Array.from({ length: 4 }, (_, i) => ({ title: '支线' + i, status: 'active', clue: '线索' + i })),
            knowledge: [
                { character: '甲', known: ['a', 'b'], unaware: ['c'] },
                { character: '乙', known: ['d'], unaware: [] }
            ],
            boundaries: [
                { character: '甲', boundary: 'recorded', recorded: true, known: ['a'], unaware: ['c'], knownCount: 2, unawareCount: 1 },
                { character: '乙', boundary: 'recorded', recorded: true, known: ['d'], unaware: [], knownCount: 1, unawareCount: 0 }
            ],
            parallels: [], secrets: [], recallEchoes: [], echoLives: [], src: null
        };
        const container = () => ({ innerHTML: '', appendChild() {}, querySelector: () => null, addEventListener() {}, classList: { add() {}, remove() {} } });
        /* 预热 */
        for (let i = 0; i < 20; i++) { try { view.render(container()); } catch (_e) { /* 见下 */ } }
        const reps = Math.max(20, PER_ROUND);
        const c0 = 0;
        void c0;
        const t0 = process.hrtime.bigint();
        let len = 0;
        let threw = 0;
        for (let i = 0; i < reps; i++) {
            try { const c = container(); view.render(c); len = String(c.innerHTML || '').length; }
            catch (_e) { threw += 1; }
        }
        const ms = Number(process.hrtime.bigint() - t0) / 1e6;
        out.timings.string_build = {
            not_render: true,
            warn: '★ 这是「视图串生成」耗时，**不是 DOM 渲染耗时** —— 本环境无布局引擎。',
            reps,
            total_ms: Math.round(ms * 1000) / 1000,
            per_op_ms: Math.round((ms / reps) * 1000) / 1000,
            html_chars: len,
            threw
        };
        out.verdict.render = threw ? 'string-build-threw' : 'string-build-ok';
    } finally {
        try { host.uninstall(); } catch (_e) { /* 忽略 */ }
        try { HOST.resetHostFlags(); } catch (_e) { /* 忽略 */ }
    }

    /* ---------- ⑤ 明确**不能**测的（登记，不假装测过） ---------- */
    out.unmeasurable = [
        { item: '真实 DOM 渲染 / 排版 / 合成耗时', why: '无布局引擎；夹具不渲染 DOM' },
        { item: '跨会话长时间运行的堆增长（小时级）', why: '本探针只跑分钟级；长时应由真机观测' },
        { item: 'V8 之外的运行时内存', why: 'process.memoryUsage 只覆盖当前进程' }
    ];

    if (JSON_MODE) {
        process.stdout.write(JSON.stringify(out, null, 1) + NL);
    } else {
        process.stdout.write('[mem] 版本 ' + MEASURED_AT + ' · ' + process.version + ' · 强制GC=' + GC_FORCED + NL);
        process.stdout.write('[mem] 堆样本(KB)：' + samples.join(' → ') + NL);
        process.stdout.write('[mem] 后半段每轮增长 ' + perRoundMedKB + 'KB（' + TRIALS + ' 跑中位数）⇒ '
            + out.verdict.module_heap + NL);
        process.stdout.write('[mem] 全局监听器：基线 ' + out.listeners.base + ' · 峰值 ' + out.listeners.peak
            + ' · ' + ROUNDS + ' 轮后 ' + out.listeners.after + ' ⇒ ' + out.verdict.listeners + NL);
        process.stdout.write('[mem] 事件源 handler：基线 ' + out.listeners.event_base + ' · 峰值 ' + out.listeners.event_peak
            + ' · ' + ROUNDS + ' 轮后 ' + out.listeners.event_after + ' ⇒ ' + out.verdict.event_source + NL);
        process.stdout.write('[mem] 宿主注入对象往返（桩宿主近似）：' + ROUNDS + ' 轮 × ' + TRIALS
            + ' 跑 · 全局按同一性还原=' + out.facts.host_roundtrip.globals_restored_all + ' · '
            + out.readings.host_roundtrip_per_round_median_kb
            + 'KB/轮（中位数）⇒ ' + out.verdict.host_injection + '（真宿主占用仍不可测）' + NL);
        process.stdout.write('[mem] 串生成 ' + out.timings.string_build.per_op_ms + 'ms/次（' + out.timings.string_build.html_chars
            + ' 字符）★ 不是 DOM 渲染耗时' + NL);
        process.stdout.write('[mem] 不可测项 ' + out.unmeasurable.length + ' 条（已登记，不假装测过）· '
            + '其中 1 条已迁为**近似可测**（带读数，见 approx_measurable）' + NL);
    }
})().catch((e) => {
    console.error('[mem] 探针自身抛错 —— fail-closed：' + String((e && e.message) || e));
    process.exit(2);
});
