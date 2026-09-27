/* ============================================================
 * config/boot-timing.js — 启动耗时的**可观测面** [v3.13.0]
 * ------------------------------------------------------------
 * 【治的欠债（先取证，再动手）】
 *   计划 #14「启动速度优化：追加启动耗时分析工具，识别哪个模块拖慢了启动」。
 *   取证前的真实处境（实测，不是推测）：
 *     · 启动期**只有两句** `console.log` 汇总（核心模块合计 / UI 模块合计），
 *       每句是一个总数 —— 读得出「慢不慢」，读不出**谁慢**；
 *     · `index.js` 里 **78 处** `import(...)` 动态加载点**零时计**：
 *       用户点了某个 App、某个面板才现加载，慢在哪一步只有卡顿感，没有读数；
 *     · 全仓 `performance.now()` 只有 4 处（都在 `index.js` 的两段里，
 *       即上面那两句汇总的来源）；
 *     · **没有任何面向用户的可见面** —— 即计划里说的「追加分析工具」这一半根本不存在。
 *
 * 【本模块是什么 / 不是什么（边界写死，免得被当性能优化读）】
 *   ✅ 是**读数层**：把「启动各阶段各花了多少 ms、每个动态加载点各花了多少、有没有重复加载」
 *      记下来并给出可读面。零依赖叶子模块（不 import 任何东西）⇒ 谁都可引用而不成环。
 *   ❌ **不是**优化：本版**一条加载路径都不改**（不改顺序、不改并发、不拆包、不预加载）。
 *      读数是优化的**前置条件**而不是替代品；先能看见，再谈改哪（本仓一条老账：
 *      「没有读数的优化是把直觉当证据」）。
 *
 * 【判据面（与 §「没给与给了 0 不许同形」同族，是本仓 v3.12.0 刚立的门）】
 *   · 耗时一律走唯一取数门 `config/num-gate.js` 的口径语义：**非有限数如实 null，不编 0**。
 *     为什么这条在这里特别要紧：`performance.now()` 在无宿主环境可能不存在，
 *     `t0` 缺了却把耗时算成 `now - undefined = NaN`，再 `|| 0` 就变成「这一步耗时 0ms」——
 *     一个**看起来完美的假零**（本仓在回滚预览那轮专门治过这个形态）。
 *     故：起止任一时钟缺失 ⇒ 该段读数 `ms: null`（`state:'unmeasurable'`），
 *     **不得**报 0ms，也不得让整份报告因此塌掉。
 *   · 重复加载点（同一 specifier 被 import 多次）**单独计数**：那是真开销
 *     （浏览器有模块缓存，但每次仍要过一遍 promise/解析）也是真线索。
 *   · 纯本地、零网络、零宿主写入：只在内存里攒一份读数，诊断面自己去取。
 *   · 「无钟」这一路必须**能被显式构造出来**（`now: null`），否则它永远只活在推理里：
 *     本仓纪律「测不到的边界等于没写」。省略 `now` ⇒ 自动探测；`now: null` ⇒ 明确认无钟。
 *
 * 【两种「没有 ms」必须分得开（本案最易混的一处，写死在类型里）】
 *   · `state:'unmeasurable'` —— **记了这段账**，但钟缺失/钟坏了，ms 拿不到（有 span、ms=null）；
 *   · **缺席** —— 根本没记账（连 span 都没有，例如某段在收尾前抛了错）。
 *   前者是「测不出」，后者是「没发生完」。把两者渲染成同一句话，就是拿「读不到」
 *   冒充「很快」（本仓最贵的错读数形态）。消费侧查 `segments` 与 `measured + unmeasurable` 即可分辨。
 *
 * 【读出口为什么叫 `collect()` 而不是 `snapshot()`（命名服从门禁口径，非风格偏好）】
 *   本仓第九道门（bridge-contract）J2 把**产品代码**（apps/** 与 config/**）里一切
 *   `.snapshot(` 视为「调用式读桥」—— 那条判据的起因是 clock/ledger 两份抄错的实现
 *   把推送型桥的 `snapshot`（对象）当函数调，必然抛 TypeError 并被 catch 吞掉，
 *   于是两个 App 永久显示「桥在但没快照」。新模块沿用那个名字，会让**真违规被噪声淹没**
 *   （诊断页的 `DiagnoseApp.collect()` 正是因此得名，见 apps/diagnose/diagnose-app.js 同名注释）。
 *   故本模块的读出口一律叫 `collect()`：让它与那条判据**永不混读**。
 *
 * 用法（调用侧只有四个动词，全部不抛）：
 *   const bt = createBootTiming();          // 或 inject 一个时钟（测试/无宿主环境）
 *   const end = bt.begin('core-modules');   // 返回一个收尾函数：end() 会把该段记账
 *   ... 工作 ...
 *   end();
 *   import('./apps/x/y.js')  →  bt.instrumentImport(import('./apps/x/y.js'), './apps/x/y.js')
 *   bt.collect()                            // 结构化读数（供诊断面渲染）
 * ============================================================ */

/** 阶段记账的默认上限（防长会话无限膨胀；超出后新段一律**计数**但不留明细）。 */
export const MAX_SPANS = 120;

/** specifier 取短名（去掉 cache-busting query，只在读数里显示；meta.spec 保留原串）。 */
function shortSpec(spec) {
    const s = String(spec == null ? '' : spec);
    const q = s.search(/[?#]/);
    return q >= 0 ? s.slice(0, q) : s;
}

/**
 * 建一个启动计时器。
 *
 * @param {{ now?: () => number, log?: (msg: string) => void }} [opts]
 *   `now` 注入时钟（默认 `performance.now()`；两者都不可用时整份面退化为
 *   「可记账但不可测时」—— 见 `collect().clock === 'absent'`）；
 *   `log` 注入日志（默认 `console.log`；刻意可注入，免得测试把噪声打进真实控制台）。
 * @returns {{
 *   begin: (name: string, meta?: object) => () => number|null,
 *   mark: (name: string, meta?: object) => number|null,
 *   span: (name: string, ms: number|null, meta?: object) => void,
 *   instrumentImport: (promise: Promise<any>, spec?: string) => Promise<any>,
 *   collect: () => object,
 *   reset: () => void
 * }}
 */
export function createBootTiming(opts) {
    const o = (opts && typeof opts === 'object') ? opts : {};
    /* 三态（刻意分得开，否则「无钟」这一路永远只活在推理里）：
     *   · 省略 `now`（属性不存在）⇒ 自动探测 performance.now，探不到才算无钟；
     *   · `now: null`            ⇒ 调用方**明确声明无钟**（测试要能构造这条边界）；
     *   · `now: fn`              ⇒ 用注入的钟（注入的钟抛错/返回非有限数时按「读不到」处理，见 readNow）。 */
    const explicitNoClock = 'now' in o && !o.now;
    const nowFn = (typeof o.now === 'function')
        ? o.now
        : (explicitNoClock
            ? null
            : (typeof performance !== 'undefined' && performance && typeof performance.now === 'function'
                ? () => performance.now()
                : null));
    const clock = nowFn ? 'ok' : 'absent';

    /** 有序段表（同一 name 可多次出现：重复加载要靠次数看出来）。 */
    const spans = [];
    /** 同一 name 出现次数（含未留明细的溢出段）。 */
    const counts = new Map();
    /** 加载点 specifier → 引用次数（重复加载线索）。 */
    const specs = new Map();
    let overflowNames = 0;
    const startedAt = readNow();

    /** 读时钟：不可用一律 null（**不编 0**）。 */
    function readNow() {
        if (!nowFn) return null;
        try {
            const n = nowFn();
            return Number.isFinite(n) ? n : null;
        } catch (_e) { return null; }
    }
    /** 自 t0 起的耗时；任一端缺 ⇒ null（**不编 0**）。 */
    function since(t0) {
        if (t0 === null) return null;
        const t1 = readNow();
        if (t1 === null) return null;
        return t1 - t0;
    }
    /** 段记账（唯一写入口；`ms` 为 null 表示「可记账但不可测时」，不是 0）。 */
    function record(name, ms, meta, extra) {
        const key = String(name == null ? '' : name);
        counts.set(key, (counts.get(key) || 0) + 1);
        const m = (meta && typeof meta === 'object') ? meta : {};
        if (typeof m.spec === 'string' && m.spec) {
            const s = m.spec;
            specs.set(s, (specs.get(s) || 0) + 1);
        }
        if (spans.length >= MAX_SPANS) { overflowNames += 1; return; }
        spans.push(Object.assign({
            name: key,
            ms: (typeof ms === 'number' && Number.isFinite(ms)) ? ms : null,
            state: (typeof ms === 'number' && Number.isFinite(ms)) ? 'measured' : 'unmeasurable'
        }, extra && typeof extra === 'object' ? extra : {}, m.spec ? { spec: m.spec } : {}));
    }

    return {
        /**
         * 开一段并返回收尾函数。**收尾函数可安全重复调用**（第二次起返回 null、不重复记账）：
         * 启动路径里 `try/finally` 与显式收尾常常都会调一次，重复记账会把读数做假。
         */
        begin(name, meta) {
            if (clock === 'absent') {
                /* 时钟缺失：仍然记账（次数与顺序是真信息），只是 ms 一律 null。 */
                let done = false;
                return function endWithoutClock() {
                    if (done) return null;
                    done = true;
                    record(name, null, meta);
                    return null;
                };
            }
            const t0 = readNow();
            let done = false;
            return function end() {
                if (done) return null;
                done = true;
                record(name, since(t0), meta);
                return null;
            };
        },
        /** 直接记一个**已量好**的耗时（调用方自己有更准的钟时用；非有限数如实记 null）。 */
        span(name, ms, meta) {
            const ok = typeof ms === 'number' && Number.isFinite(ms);
            record(name, ok ? ms : null, meta);
            return ok ? ms : null;
        },
        /** 只记一次「到这里了」（用于给顺序打点；不产生 ms 读数）。 */
        mark(name, meta) {
            record(name, null, meta, { kind: 'mark' });
            return null;
        },
        /**
         * **给一个已在进行的动态 import 记账**（调用点写法：
         * `bt.instrumentImport(import('./x.js'), './x.js')`）。
         *
         * 为什么是这个形状（三条都是刻意的）：
         *   ① 收的是**已经在跑的那个 promise**，不是 specifier 字符串 ——
         *      模块内部绝不去 `import(spec)` 现拼。用变量 import 会让加载路径从
         *      「宿主/打包器可静态分析的写法」变成「纯运行时解析」，那是**改加载路径**，
         *      而本版一条都不改（见文件头边界）。
         *   ② 原样转发 resolve/reject（`throw err` 而非吞掉）：加载失败要让原调用链
         *      照旧走它自己的 `.catch`，本模块只旁听。**吞错会让失败变成静默**。
         *   ③ 失败也记账（`name` 后缀 `!failed`）：`import` 抛错本身是启动耗时里
         *      最值得看见的一段（重试、降级、白屏都从这里开始）。
         *
         * 注意：`spec` 带 cache-busting query（`?v=...`）时，读数里的短名会去掉 query
         * （`meta.spec` 保留原串）—— 于是「同一模块不同 query 被加载了两次」这件事
         * 在 `repeatSpecs` 里看得出来。
         */
        instrumentImport(promise, spec) {
            const t0 = readNow();
            const hasSpec = typeof spec === 'string' && !!spec;
            const base = 'import:' + (hasSpec ? shortSpec(spec) : 'unknown');
            const meta = hasSpec ? { spec } : undefined;
            return Promise.resolve(promise).then(
                (mod) => { record(base, since(t0), meta); return mod; },
                (err) => { record(base + '!failed', since(t0), meta, { failed: true }); throw err; }
            );
        },
        /** 结构化读数（每次现算；调用方不得缓存 —— 启动过程中会反复取样）。 */
        collect() {
            const measured = spans.filter((s) => s.state === 'measured');
            const unmeasurable = spans.length - measured.length;
            const total = measured.reduce((a, s) => a + s.ms, 0);
            const slowest = measured.slice().sort((a, b) => b.ms - a.ms).slice(0, 8)
                .map((s) => ({ name: s.name, ms: s.ms, spec: s.spec || '' }));
            const repeated = [...counts.entries()].filter(([, n]) => n > 1)
                .map(([name, n]) => ({ name, times: n }))
                .sort((a, b) => b.times - a.times || a.name.localeCompare(b.name));
            const repeatedSpecs = [...specs.entries()].filter(([, n]) => n > 1)
                .map(([spec, n]) => ({ spec, times: n }))
                .sort((a, b) => b.times - a.times || a.spec.localeCompare(b.spec));
            return {
                clock: clock,
                startedAt: startedAt,
                spans: spans.length,
                measured: measured.length,
                /* 「可记账但不可测时」的段数：> 0 时**任何** ms 读数都不完整，
                 * 消费侧必须显式说出来（本仓「读数不完整要说出来」同族纪律）。 */
                unmeasurable: unmeasurable,
                overflow: overflowNames,
                totalMs: measured.length ? total : null,
                segments: spans.map((s) => ({
                    name: s.name, ms: s.ms, state: s.state, spec: s.spec || '',
                    kind: s.kind || 'span', failed: s.failed === true
                })),
                slowest: slowest,
                repeated: repeated,
                repeatedSpecs: repeatedSpecs
            };
        },
        reset() {
            spans.length = 0;
            counts.clear();
            specs.clear();
            overflowNames = 0;
        }
    };
}

/** 一行读数（供日志 / 卡片共用同一实现；赔上「不可测时」与「读数不完整」两态）。 */
export function bootTimingLine(snap) {
    const s = (snap && typeof snap === 'object') ? snap : null;
    if (!s) return '启动耗时：无读数';
    if (s.clock === 'absent') return '启动耗时：**不可测时**（本环境无 performance.now）—— 只记了 ' + s.spans + ' 段的顺序';
    const parts = ['共 ' + s.measured + ' 段 / ' + Math.round(s.totalMs || 0) + 'ms'];
    if (s.slowest && s.slowest.length) {
        parts.push('最慢：' + s.slowest.slice(0, 3).map((x) => x.name + ' ' + Math.round(x.ms) + 'ms').join(' · '));
    }
    if (s.unmeasurable > 0) parts.push('★ 另有 ' + s.unmeasurable + ' 段**不可测时**（不得算进合计）');
    if (s.repeatedSpecs.length) parts.push('重复加载点 ' + s.repeatedSpecs.length + ' 个');
    return '启动耗时：' + parts.join(' · ');
}