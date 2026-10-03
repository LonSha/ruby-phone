/* ============================================================
 * RubyPhone v2.36.0 —— 桥可观测面
 *
 * 本版问题：桥只在**被用到的那一刻**才读一次（世界脉搏生成时、TimeManager 取时间时），
 *   那一刻是业务路径，读不到就静默退回旧路，用户看不到任何痕迹。
 *   v2.35.0 留下的 `worldBridgeAvailability()` 与 `WorldpulseApp.bridgeStatus()` 是
 *   **零消费**：前者只被后者调用，后者全库无人调用（grep 实测，本测试 A5 有钉）。
 *   于是「桥是不是通着」在手机上完全不可观测——用户只看到「世界脉搏又是编的」这个结果。
 *
 * 本版把可观测面收敛为 `config/world-bridge.js` 的 `bridgeReport()`（含 lonsha 来源态映射
 * 与两个钟的对账），并让它**真被消费**：
 *   · apps/worldpulse/worldpulse-view.js 新增桥卡片（读 app.bridgeStatus()）
 *   · apps/worldpulse/worldpulse-app.js 的 bridgeStatus() 带上 report/summary
 *   · apps/timeweaver/timeweaver-collector.js 的桥读取改走单一真源（消除第二份实现）
 *
 * 判据形态（对齐 system-v235.test.mjs 规范）：
 *   · 锚点字面量全文件只声明一次（BR 表），判据与破坏共用（判据纯度 H5）；
 *   · 每个核心判据配一次负控制：真源码破坏 → 独立加载副本 → 同款判据翻红（含原版对照）；
 *   · 文本判据一律跑在**剥注释**的代码行上（避免被说明文字满足）。
 * ============================================================ */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
    if (cond) { pass++; console.log(`✓ ${name}`); }
    else { fail++; console.log(`✗ ${name} ${detail}`); }
};
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
const vnum = (s) => {
    const m = /^([0-9]+)\.([0-9]+)\.([0-9]+)/.exec(String(s || '').trim());
    return m ? Number(m[1]) * 1000000 + Number(m[2]) * 1000 + Number(m[3]) : NaN;
};
/** 剥注释（块 + 行），文本判据一律跑在代码行上 */
const codeOf = (src) => String(src).replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').map(l => l.replace(/\/\/.*$/, '')).join('\n');

const WB_SRC = read('config/world-bridge.js');
const WB_CODE = codeOf(WB_SRC);
const VIEW_SRC = read('apps/worldpulse/worldpulse-view.js');
const VIEW_CODE = codeOf(VIEW_SRC);
const APP_SRC = read('apps/worldpulse/worldpulse-app.js');
const APP_CODE = codeOf(APP_SRC);
const COL_SRC = read('apps/timeweaver/timeweaver-collector.js');
const COL_CODE = codeOf(COL_SRC);
const IDX_SRC = read('index.js');
const LOG = JSON.parse(read('update-log.json'));
const V = '2.36.0';

const WB = await import('../config/world-bridge.js');

/* ---------- 桥夹具（行为判据与破坏判据共用） ---------- */
const bridgeWin = (over = {}) => Object.assign({
    worldaxis_bridge_v1: {
        settings: () => ({ enabled: true }), stat: () => ({}),
        snapshot: () => ({ worldClock: { iso: '2026-09-13T21:45', label: '薄暮' } })
    },
    lonsha_memory_bridge_v1: {
        sourceState: 'ready', lastError: null,
        snapshot: { pluginVersion: '3.175.0', clock: { date: '2026-09-13' }, recallAudit: { rounds: 3 } }
    }
}, over);

/* ══════════ A 桥可观测面：在场与归因 ══════════ */
{
    const missing = WB.bridgeReport({});
    ok('A1 两个桥都不在时，报告仍成形且如实报未装',
        missing && missing.worldaxis.reason === 'not-mounted' && missing.lonsha.reason === 'not-mounted'
        && missing.anyReadable === false, JSON.stringify(missing && missing.worldaxis));
    ok('A2 报告带一句话总述（供 UI 直接显示）',
        typeof missing.summary === 'string' && missing.summary.length > 0 && !/undefined/.test(missing.summary),
        missing.summary);

    const dormant = WB.bridgeReport({
        worldaxis_bridge_v1: {
            settings: () => ({ enabled: false }), stat: () => ({ refused: 2, lastRefusal: { reason: 'disabled' } }),
            snapshot: () => null
        }
    });
    ok('A3 ★ 未装与未开不得同形（用户要知道该去开哪个开关）',
        dormant.worldaxis.mounted === true && dormant.worldaxis.enabled === false
        && dormant.worldaxis.reason === 'disabled' && dormant.worldaxis.reason !== missing.worldaxis.reason,
        dormant.worldaxis.reason);
    ok('A4 报告带出对方的记账自述（外部集成到底在没在跑）',
        WB.bridgeReport(bridgeWin()).worldaxis.stat
        && typeof WB.bridgeReport(bridgeWin()).worldaxis.stat.refused === 'number',
        JSON.stringify(WB.bridgeReport(bridgeWin()).worldaxis.stat));

    /* A5 零消费已消除：bridgeStatus 必须被视图真的调用 */
    ok('A5 ★ 可观测面真被消费（防「声明了却零消费」）',
        /this\.app\.bridgeStatus\(\)/.test(VIEW_CODE),
        '视图须真调 app.bridgeStatus()');
    ok('A6 bridgeStatus 交出可观测面报告与总述',
        /bridgeReport\(\)/.test(APP_CODE) && /summary:\s*\(report && report\.summary\)/.test(APP_CODE));

    /* A7 lonsha 来源态：对方自述优先，五种处境逐一对映 */
    const stCases = [
        ['engine-absent', 'engine-absent'], ['engine-empty', 'engine-empty'],
        ['thrown', 'thrown'], ['idle', 'no-snapshot'], ['ready', 'ready']
    ];
    let srcAll = true;
    for (const [st, want] of stCases) {
        const snap = st === 'ready' ? { clock: {} } : null;
        const r = WB.lonshaSource(WB.LONSHA_BRIDGE_ID,
            { lonsha_memory_bridge_v1: { sourceState: st, snapshot: snap, lastError: st === 'thrown' ? 'boom' : null } });
        if (r.reason !== want) { srcAll = false; console.log(`    · ${st} 期望 ${want} 实 ${r.reason}`); }
    }
    ok('A7 对方 sourceState 五态逐一对映（未就绪与坏了不同形）', srcAll);
    ok('A8 对方 lastError 不吞（thrown 时如实带出）',
        WB.lonshaSource(WB.LONSHA_BRIDGE_ID,
            { lonsha_memory_bridge_v1: { sourceState: 'thrown', lastError: 'engine boom', snapshot: null } }).lastError === 'engine boom');

    /* A9 不抛：宿主怪异 getter / 桥对象畸形 */
    let threw = false;
    try {
        WB.bridgeReport({ get worldaxis_bridge_v1() { throw new Error('x'); } });
        WB.bridgeReport({ worldaxis_bridge_v1: { settings() { throw new Error('s'); }, stat() { throw new Error('t'); }, snapshot() { throw new Error('p'); } } });
        WB.lonshaSource(WB.LONSHA_BRIDGE_ID, { get lonsha_memory_bridge_v1() { throw new Error('y'); } });
    } catch (_e) { threw = true; }
    ok('A9 宿主怪异 getter / 桥内部抛错 ⇒ 一律降级不外抛（含对方抛异常的极端宿主）', !threw);

    /* A10 只读：读报告不写任何一方 */
    const w = bridgeWin();
    const before = JSON.stringify(w);
    WB.bridgeReport(w);
    ok('A10 ★ 只读契约：生成报告不改两个桥的任何字段（不代对方记账）', JSON.stringify(w) === before);
}

/* ══════════ B 两个钟的对账 ══════════ */
{
    const same = WB.diffClocks('2026-09-13', '2026-09-13');
    ok('B1 同日 ⇒ same（days=0）', same.comparable && same.verdict === 'same' && same.days === 0);
    const ahead = WB.diffClocks('2026-09-13', '2026-09-18');
    ok('B2 对方记的日期在后 ⇒ world-ahead(+5)', ahead.verdict === 'world-ahead' && ahead.days === 5, JSON.stringify(ahead));
    const behind = WB.diffClocks('2026-09-13', '2026-09-08');
    ok('B3 对方记的日期在前 ⇒ world-behind(-5)', behind.verdict === 'world-behind' && behind.days === -5);
    ok('B4 ★ 本机无公历钟 ⇒ world-uncomparable（本就不该比，绝不硬比出假的不一致）',
        WB.diffClocks('', '2026-09-13').verdict === 'world-uncomparable');
    ok('B5 ★ 对方未记录 ⇒ lonsha-empty（与「读不出」分开：前者等它，后者是两套历法）',
        WB.diffClocks('2026-09-13', '').verdict === 'lonsha-empty'
        && WB.diffClocks('2026-09-13', '天顺三年春').verdict === 'unparsable');
    ok('B6 非法月日不硬比（13 月/40 日不得被当成合法日期）',
        WB.diffClocks('2026-09-13', '2026-13-40').verdict === 'unparsable'
        && WB.diffClocks('2026-13-40', '2026-09-13').verdict === 'unparsable');
    ok('B7 纯函数：对账不读全局（同一入参恒同出参）',
        JSON.stringify(WB.diffClocks('2026-01-01', '2026-01-02')) === JSON.stringify(WB.diffClocks('2026-01-01', '2026-01-02')));
    /* B8 报告里的对账真的接上了两边（不是恒空） */
    const full = WB.bridgeReport(bridgeWin());
    ok('B8 报告的对账取到了两边的真日期',
        full.clock.comparable === true && full.clock.verdict === 'same'
        && full.clock.worldDate === '2026-09-13T21:45' && full.clock.lonshaDate === '2026-09-13',
        JSON.stringify(full.clock));
    const noWa = WB.bridgeReport({ lonsha_memory_bridge_v1: { sourceState: 'ready', snapshot: { clock: { date: '2026-09-13' } } } });
    ok('B9 只有一边时对账如实说不可比（缺 WorldAxis ⇒ world-uncomparable）',
        noWa.clock.verdict === 'world-uncomparable', JSON.stringify(noWa.clock));
}

/* ══════════ C 消费侧接线 ══════════ */
{
    ok('C1 世界脉搏视图有桥卡片（渲染真实可观测面）',
        /_bridgeCard\(\)/.test(VIEW_CODE) && /\$\{this\._bridgeCard\(\)\}/.test(VIEW_CODE));
    ok('C2 桥卡片样式随卡片一并声明（不靠宿主样式）',
        /\.wp-bridge-line\{/.test(VIEW_CODE) && /\.wp-bridge-ok\{/.test(VIEW_CODE));
    ok('C3 ★ timeweaver 桥读取走单一真源（消除第二份实现，两份必然漂移）',
        /from '\.\.\/\.\.\/config\/world-bridge\.js'/.test(COL_CODE)
        && !/window\s*\.\s*lonsha_memory_bridge_v1/.test(COL_CODE),
        'collector 不得自己摸桥全局');
    ok('C4 collector 仍从快照取 recallAudit（业务数据不变）',
        /const ra = snap\.recallAudit;/.test(COL_CODE));
    ok('C5 桥可观测面不得引入对上游桥的写路径（只读契约）',
        !/window\.(worldaxis|lonsha)_[a-z_]*bridge_v1\s*=[^=]/.test(WB_CODE + VIEW_CODE + APP_CODE + COL_CODE));
}

/* ══════════ D 负控制：真源码破坏 → 独立加载副本 → 同款判据翻红 ══════════ */
{
    /* 锚点字面量集中声明一次（判据纯度：judges 里不得复述这些串） */
    const BR = {
        /* 闸门判定（在 bridgeSource 内——bridgeReport 的来源态正来自这里）：拆掉它 ⇒ 未装与未开塌成一态。
             ★ 锚点纪律：判据（gateDistinct）读的是 bridgeReport().worldaxis.reason，其来源是
               bridgeSource 的归因链；若把锚点打在 readWorldAxisSnapshot 的闸门上，破坏打得再真
               也永远到不了判据（这正是 v3.174 / v2.17 记过的负控制恒真形态）。 */
        gate: "    if (enabled === false) reason = 'disabled';",
        /* 对账的「本机无公历钟」分支：拆掉它 ⇒ 会硬比出假的不一致 */
        uncomparable: "        if (!wRaw) { out.verdict = 'world-uncomparable'; return out; }",
        /* lonsha 来源态的 thrown 分支：拆掉它 ⇒ 「对方坏了」被并进「还没就绪」 */
        thrown: "        if (sourceState === 'thrown') reason = 'thrown';",
        /* 报告的外层兜底（catch 块开头）：改成先重抛 ⇒ 宿主怪异 getter 会外抛。
             ★ 锚点必须落在**重抛能生效的位置**：若把 `throw` 加在 catch 块的 `return` 之后，
               那是一句不可达代码——破坏没真正改变行为，负控制就是假的。
               [v2.37.0] 交棒：锚点随兜底分支形状升级同步（该分支补齐 read/hasSnapshot，语义不变）。 */
        swallow: "    catch (_e) {\n        return {\n            worldaxis: { id: WORLDAXIS_BRIDGE_ID, mounted: false, enabled: null, hasSnapshot: false, reason: 'report-threw', stat: null, read: null },"
    };
    /** 用给定源码独立装载世界桥模块（ESM 外壳 + 正则剥 import/export，只留纯逻辑） */
    const loadWB = (src) => {
        const body = src
            .replace(/^import[\s\S]*?;$/gm, '')
            .replace(/\bexport\s+default\s*\{/g, 'const __default = {')
            .replace(/\bexport\s+(function|const)\s/g, '$1 ');
        const names = ['WORLDAXIS_BRIDGE_ID', 'LONSHA_BRIDGE_ID', 'getBridge', 'bridgeSource',
            'readWorldAxisSnapshot', 'readWorldClock', 'readLonshaSnapshot', 'worldBridgeAvailability',
            'lonshaSource', 'diffClocks', 'bridgeReport'];
        const fn = new Function(body + '\nreturn { ' + names.join(', ') + ' };');
        return fn();
    };
    /** 破坏副本（锚点必须恰中 1 次，且必须真的改变源码） */
    const broken = (anchor, to) => {
        const hits = (WB_SRC.match(new RegExp(anchor.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;
        if (hits !== 1) throw new Error('锚点命中 ' + hits + ' 次（须 1）');
        const out = WB_SRC.replace(anchor, to);
        if (out === WB_SRC) throw new Error('替换未改变源码（负控制是假的）');
        return out;
    };
    /** 集中判据（只断言行为，不复述锚点字面量） */
    const judges = {
        gateDistinct: (api) => {
            const miss = api.bridgeReport({});
            const off = api.bridgeReport({
                worldaxis_bridge_v1: { settings: () => ({ enabled: false }), stat: () => ({}), snapshot: () => null }
            });
            return miss.worldaxis.reason !== off.worldaxis.reason && off.worldaxis.reason === 'disabled';
        },
        noHardCompare: (api) => api.diffClocks('', '2026-09-13').verdict === 'world-uncomparable',
        thrownDistinct: (api) => {
            const r = api.lonshaSource(api.LONSHA_BRIDGE_ID,
                { lonsha_memory_bridge_v1: { sourceState: 'thrown', snapshot: null } });
            return r.reason === 'thrown' && r.reason !== 'no-snapshot';
        },
        noThrow: (api) => {
            // ★ 输入必须真能到达**报告层**：桥对象上的抛错 getter 会在 bridgeSource 内层就被吞掉，
            //   走不到报告层；而 `stat()` 返回带抛错 getter 的对象，其读取发生在报告层，无人保护。
            let t = false;
            try {
                api.bridgeReport({
                    worldaxis_bridge_v1: {
                        settings: () => ({ enabled: true }),
                        stat: () => ({ get publishes() { throw new Error('stat-boom'); } }),
                        snapshot: () => null
                    }
                });
            } catch (_e) { t = true; }
            return !t;
        }
    };
    const real = loadWB(WB_SRC);
    ok('D1 （负向自证·原版对照）真源码上四条判据全部干净——否则下面的「破坏后现形」可能只是判据恒真',
        judges.gateDistinct(real) && judges.noHardCompare(real) && judges.thrownDistinct(real) && judges.noThrow(real),
        JSON.stringify({ g: judges.gateDistinct(real), c: judges.noHardCompare(real), t: judges.thrownDistinct(real), n: judges.noThrow(real) }));

    const jG = judges;   // 破坏判据与真判据同源
    const bGate = loadWB(broken(BR.gate, "    if (false) reason = 'disabled';"));
    ok('D2 拆掉闸门判定 ⇒ 未装与未开塌成一态（用户不知道该去开哪个开关）',
        jG.gateDistinct(bGate) === false, '破坏后仍可分辨 = 判据没走在被破坏的路上');
    ok('D3 破坏闸门不连坐对账口径', jG.noHardCompare(bGate) === true);

    const bUnc = loadWB(broken(BR.uncomparable, "        if (false) { return out; }"));
    ok('D4 拆掉「本机无公历钟」分支 ⇒ 会硬比出一个假的不一致',
        jG.noHardCompare(bUnc) === false);
    ok('D5 破坏对账不连坐来源态', jG.thrownDistinct(bUnc) === true);

    const bThr = loadWB(broken(BR.thrown, "        if (false) reason = 'thrown';"));
    ok('D6 拆掉 thrown 分支 ⇒ 「对方坏了」被并进「还没就绪」',
        jG.thrownDistinct(bThr) === false);

    const bSw = loadWB(broken(BR.swallow, BR.swallow.replace('    catch (_e) {', '    catch (_e) {\n        throw _e;')));
    ok('D7 把报告外层兜底换成重抛 ⇒ 宿主怪异 getter 会把异常抛给调用方',
        jG.noThrow(bSw) === false);
    ok('D8 破坏兜底不连坐对账口径', jG.noHardCompare(bSw) === true);

    /* 工具两向自证：锚点不存在 / 不唯一必须抛；判据纯度 */
    let toolOk = true;
    try { broken('THIS_ANCHOR_DOES_NOT_EXIST_IN_SOURCE', ''); toolOk = false; } catch (_e) { /* 应抛 */ }
    ok('D9 工具自证：不存在的锚点必须抛（假破坏不得静默通过）', toolOk);
    const judgeSrc = fs.readFileSync(path.join(root, 'tests/system-v236.test.mjs'), 'utf8');
    const judgePart = judgeSrc.slice(judgeSrc.indexOf('const judges = {'), judgeSrc.indexOf('const real = loadWB'));
    ok('D10 判据纯度：集中判据里不得复述破坏锚点字面量',
        !judgePart.includes("reason: 'disabled', source: src") && !judgePart.includes("verdict = 'world-uncomparable'"));
}

/* ══════════ E 发布卫生 ══════════ */
{
    const v = (IDX_SRC.match(/const ST_PHONE_VERSION = '([\d.]+)'/) || [])[1];
    ok('E1 index.js 版本不低于本版', vnum(v) >= vnum(V), String(v));
    ok('E2 package.json 与入口同源', JSON.parse(read('package.json')).version === v);
    ok('E3 manifest.json 与入口同源', JSON.parse(read('manifest.json')).version === v);
    ok('E4 update-log 有本版条目', !!LOG.versions?.[V]);
    // [v2.37.0] 交棒：latest 不再钉死本版——改为「latest 与 versions 头部一致」的自洽性不变量
    const HEADV = Object.keys(LOG.versions || {})[0];
    ok('E5 update-log.latest 与 versions 头部一致（自洽）', LOG.latest === HEADV, `${LOG.latest} vs ${HEADV}`);
    ok('E6 versions 头部不低于本版', vnum(String(HEADV)) >= vnum(V), String(HEADV));
    const items = (LOG.versions?.[V]?.items) || [];
    const joined = items.join('\n');
    ok('E7a 本版条目覆盖主线（可观测面 / 桥）', /可观测/.test(joined) && /桥/.test(joined), String(items.length));
    ok('E7b 本版条目点出「零消费」这一原始现场', /零消费|无人调用/.test(joined), joined.slice(0, 60));
    ok('E8 条目数 >= 4', items.length >= 4, String(items.length));
    const blk = (IDX_SRC.match(/const ST_PHONE_CURRENT_UPDATE = \{[\s\S]*?\n\};/) || [''])[0];
    ok('E9a 内置公告存在且 version 引用常量', blk.length > 0 && /version:\s*ST_PHONE_VERSION/.test(blk));
    const inner = blk.slice(blk.indexOf('items: [') + 'items: ['.length, blk.lastIndexOf(']'));
    let ann = null;
    try { ann = JSON.parse('[' + inner.replace(/,\s*$/, '') + ']'); } catch (_e) { ann = null; }
    ok('E9b 公告可解析为字符串数组', Array.isArray(ann) && ann.every(s => typeof s === 'string'));
    // [v2.37.0] 交棒：公告随头部版本走（当前版本条目由该版自己的测试锁逐字同源）
    const headItems = (LOG.versions?.[HEADV]?.items) || [];
    ok('E9c 公告与头部版本日志逐字同源', Array.isArray(ann) && headItems.every(it => ann.includes(it)),
        `ann=${ann ? ann.length : 'null'} log=${headItems.length}`);
    ok('E10a 2.35.0 历史条目仍在（世界桥消费面主线）',
        /两个世界|世界桥/.test(((LOG.versions?.['2.35.0'] || {}).items || []).join('\n')));
    ok('E10b 2.34.0 历史条目仍在（重复存活域主线）',
        /重复存活/.test(((LOG.versions?.['2.34.0'] || {}).items || []).join('\n')));
    ok('E10c 2.33.0 历史条目仍在（成因账主线）',
        /成因/.test(((LOG.versions?.['2.33.0'] || {}).items || []).join('\n')));
    ok('E11a v2.35 锁定的 world-bridge 六导出形态仍在',
        ['readWorldAxisSnapshot', 'readWorldClock', 'readLonshaSnapshot', 'worldBridgeAvailability', 'bridgeSource', 'getBridge']
            .every(n => WB_CODE.includes(n)),
        '既有导出一律不得被本版摘除');
    ok('E11b v2.35 锁定的真世界优先接线仍在（worldpulse）',
        /_renderRealWorld/.test(APP_CODE));
    ok('E11c v2.35 锁定的世界钟权威源仍在（time-manager）',
        /getWorldAxisTime\(\)/.test(codeOf(read('config/time-manager.js'))));
    ok('E12 本版新增出口全部真被消费（无新一轮零消费）',
        /bridgeReport/.test(VIEW_CODE + APP_CODE) && /lonshaSource/.test(WB_CODE)
        && /diffClocks/.test(WB_CODE));
}
console.log(`\n[v2.36.0] 通过 ${pass} / 失败 ${fail}`);
if (fail) process.exit(1);