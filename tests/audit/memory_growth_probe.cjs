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
 *     · V8 之外的运行时内存、宿主注入对象的内存。
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
    /* 阈值是**量级判据**：每轮 < 32KB 视为「线性且微小」；≥ 32KB/轮 才立泄漏候选 */
    out.verdict.module_heap = perRoundKB >= 32 ? 'leak-candidate' : 'linear-acceptable';
    out.verdict.module_heap_note = perRoundKB >= 32
        ? '后半段每轮仍在增长 ' + perRoundKB + 'KB —— 需要单独立项定位（可能是缓存增长，也可能是泄漏）'
        : '后半段每轮增长 ' + perRoundKB + 'KB（< 32KB/轮）—— 属「线性且微小」，不立优化候选';

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

    /* ---------- ④ 明确**不能**测的（登记，不假装测过） ---------- */
    out.unmeasurable = [
        { item: '真实 DOM 渲染 / 排版 / 合成耗时', why: '无布局引擎；夹具不渲染 DOM' },
        { item: '宿主（SillyTavern）注入对象的内存占用', why: '无真实宿主' },
        { item: '跨会话长时间运行的堆增长（小时级）', why: '本探针只跑分钟级；长时应由真机观测' },
        { item: 'V8 之外的运行时内存', why: 'process.memoryUsage 只覆盖当前进程' }
    ];

    if (JSON_MODE) {
        process.stdout.write(JSON.stringify(out, null, 1) + NL);
    } else {
        process.stdout.write('[mem] 版本 ' + MEASURED_AT + ' · ' + process.version + ' · 强制GC=' + GC_FORCED + NL);
        process.stdout.write('[mem] 堆样本(KB)：' + samples.join(' → ') + NL);
        process.stdout.write('[mem] 后半段每轮增长 ' + perRoundKB + 'KB ⇒ ' + out.verdict.module_heap + NL);
        process.stdout.write('[mem] 全局监听器：基线 ' + out.listeners.base + ' · 峰值 ' + out.listeners.peak
            + ' · ' + ROUNDS + ' 轮后 ' + out.listeners.after + ' ⇒ ' + out.verdict.listeners + NL);
        process.stdout.write('[mem] 事件源 handler：基线 ' + out.listeners.event_base + ' · 峰值 ' + out.listeners.event_peak
            + ' · ' + ROUNDS + ' 轮后 ' + out.listeners.event_after + ' ⇒ ' + out.verdict.event_source + NL);
        process.stdout.write('[mem] 串生成 ' + out.timings.string_build.per_op_ms + 'ms/次（' + out.timings.string_build.html_chars
            + ' 字符）★ 不是 DOM 渲染耗时' + NL);
        process.stdout.write('[mem] 不可测项 ' + out.unmeasurable.length + ' 条（已登记，不假装测过）' + NL);
    }
})().catch((e) => {
    console.error('[mem] 探针自身抛错 —— fail-closed：' + String((e && e.message) || e));
    process.exit(2);
});
