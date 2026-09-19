/* ============================================================
 * RubyPhone v2.35.0 —— 对外世界桥消费面
 *
 * 本版问题（同一个剧情里两个世界对不上）：
 *   这套三插件体系里有**两个同规格的只读世界桥**：
 *     · window.lonsha_memory_bridge_v1  —— 记忆插件的剧情记忆/召回账本
 *     · window.worldaxis_bridge_v1      —— WorldAxis 的世界状态（世界钟/权威事实/暗流/舆情）
 *   而 RubyPhone 实测**只消费了前者**（apps/timeweaver/timeweaver-collector.js 读
 *   lonsha_memory_bridge_v1.snapshot.recallAudit），全库 grep `WorldAxis|worldaxis`
 *   在产品代码里零命中。后果是真现场：
 *     · apps/worldpulse 自己队列化楼层、按阈值触发、调 LLM**现编**平行事件
 *       ——与 WorldAxis 已经推演出的真世界状态毫无关联，等于凭空发明一个平行世界；
 *     · config/time-manager.js 从正文/世界书**猜**时间，而 WorldAxis 的世界钟
 *       （决策时间，进存档、参与判定）就摆在那里没人读。
 *
 * 本版把两个桥收敛成 config/world-bridge.js 单一真源，并让两个消费者真的读它。
 *
 * 本文件的判据形态（对齐 system-v234.test.mjs 规范）：
 *   · 锚点字面量全文件**只声明一次**（A 表），判据与破坏共用（H5 判据纯度）；
 *   · 每个核心判据配一次负控制，形态为「真源码破坏 → 加载副本 → 同款判据翻红」；
 *   · 负控制分文本级与**行为级**两种，行为级在破坏副本上真执行场景；
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
/* ---------- 行级剥注释（文本判据一律在代码行上做） ---------- */
function codeLines(src) {
    const out = [];
    let inBlock = false;
    for (const raw of String(src).split('\n')) {
        let line = raw;
        if (inBlock) {
            const e = line.indexOf('*/');
            if (e === -1) continue;
            line = line.slice(e + 2); inBlock = false;
        }
        for (;;) {
            const s = line.indexOf('/*');
            if (s === -1) break;
            const e = line.indexOf('*/', s + 2);
            if (e === -1) { line = line.slice(0, s); inBlock = true; break; }
            line = line.slice(0, s) + line.slice(e + 2);
        }
        const lc = line.indexOf('//');
        if (lc !== -1) line = line.slice(0, lc);
        if (line.trim()) out.push(line);
    }
    return out;
}
const codeOf = (src) => codeLines(src).join('\n');

/* ---------- 最小宿主桩：让被改造的文件能在无头环境里导入 ---------- */
globalThis.window = { VirtualPhone: {} };
globalThis.document = {
    createElement: () => ({
        style: {}, dataset: {}, classList: { add() { }, remove() { }, toggle() { }, contains() { return false; } },
        appendChild() { }, setAttribute() { }, removeAttribute() { }, addEventListener() { },
        querySelector: () => null, querySelectorAll: () => [], remove() { },
    }),
    getElementById: () => null, addEventListener() { }, removeEventListener() { },
    head: { appendChild() { } }, createTextNode: () => ({}),
};

const WB_SRC = read('config/world-bridge.js');
const EN_SRC = read('apps/worldpulse/worldpulse-engine.js');
const APP_SRC = read('apps/worldpulse/worldpulse-app.js');
const TM_SRC = read('config/time-manager.js');
const WB_CODE = codeOf(WB_SRC);
const EN_CODE = codeOf(EN_SRC);
const APP_CODE = codeOf(APP_SRC);
const TM_CODE = codeOf(TM_SRC);
const IDX_SRC = read('index.js');

const WB = await import('../config/world-bridge.js');
const WP = await import('../apps/worldpulse/worldpulse-engine.js');

/* ============================================================
 * 锚点字面量（全文件只声明一次）+ 判据（与破坏共用同一份）
 * ============================================================ */
const A = {
    wbClock: 'export function readWorldClock(snapshot) {',
    wbIso: "const ISO_RE = /^(\\d{4})-(\\d{1,2})-(\\d{1,2})(?:[T ](\\d{1,2}):(\\d{2}))?/;",
    wbDisabled: "reason = 'disabled';",
    wbRange: 'if (!(year >= 1 && month >= 1 && month <= 12 && day >= 1 && day <= 31)) return null;',
    enDedupe: 'if (seen.has(full)) return;',
    enRumor: "const mark = claim ? `（${claim}）` : '（传闻）';",
    enSort: 'out.sort((a, b) => (b.at || 0) - (a.at || 0));',
    appRealFirst: 'const real = this._renderRealWorld(ev);',
    appReturnReal: 'if (real) return real;',
    appBranch: "if (it.source === 'worldaxis') {",
    appMerge: 'h = WP.mergeWorldAxisHistory(h, [it]);',
    appImport: "from '../../config/world-bridge.js';",
    tmImport: "from './world-bridge.js';",
    tmSource4: 'const worldAxisTime = this.getWorldAxisTime();',
    tmEraGate: 'if (this._isSameStoryEra(worldAxisTime, eraRef)) {',
};
const judges = {
    /* 世界钟解析：函数 + iso 正则 + 日期范围校验，三者缺一不可。
       范围校验是**唯一的**非法月日防线：ISO_RE 的 \d{1,2} 本来就允许 13 月 / 40 日。 */
    clock: (code) => code.includes(A.wbClock) && code.includes(A.wbIso) && code.includes(A.wbRange),
    /* 降级可归因：「未启用」必须单独成态，不得与「未安装」同形 */
    disabled: (code) => code.includes(A.wbDisabled),
    /* 投影去重：历史已有的条目不得重复投递 */
    dedupe: (code) => code.includes(A.enDedupe) && code.includes(A.enSort),
    /* 传闻标注：forum 来源必须显式标「传闻」（与已核实新闻强度不同） */
    rumor: (code) => code.includes(A.enRumor),
    /* 真世界优先：_generate 先试真世界，成功即返回（不调 LLM） */
    realFirst: (code) => {
        const a = code.indexOf(A.appRealFirst);
        const b = code.indexOf(A.appReturnReal);
        return a > 0 && b > a;
    },
    /* 落地分支：真世界条目走 merge（id 去重），LLM 条目走 pushHistory */
    landBranch: (code) => code.includes(A.appBranch) && code.includes(A.appMerge),
    /* 消费者真的 import 了桥（不是定义了不用）——两个消费者各自判：
       同一判据里要求两个 import 会让「只断一个」的负控制永远测不出差异（首版踩过）。 */
    wiredApp: (code) => code.includes(A.appImport),
    wiredTm: (code) => code.includes(A.tmImport),
    /* 世界钟接成权威源之一，且受纪元相容门控（不让公历 ISO 污染古历） */
    clockSource: (code) => {
        const a = code.indexOf(A.tmSource4);
        const b = code.indexOf(A.tmEraGate);
        return a > 0 && b > a;
    },
};

/* 锚点唯一性自证：锚点漂移时先在此处翻红，而不是让后面的破坏静默失配 */
{
    const uniq = [
        ['wbClock', WB_SRC, A.wbClock], ['wbIso', WB_SRC, A.wbIso],
        ['wbDisabled', WB_SRC, A.wbDisabled], ['wbRange', WB_SRC, A.wbRange],
        ['enDedupe', EN_SRC, A.enDedupe], ['enRumor', EN_SRC, A.enRumor], ['enSort', EN_SRC, A.enSort],
        ['appRealFirst', APP_SRC, A.appRealFirst], ['appReturnReal', APP_SRC, A.appReturnReal],
        ['appBranch', APP_SRC, A.appBranch], ['appMerge', APP_SRC, A.appMerge],
        ['appImport', APP_SRC, A.appImport],
        ['tmImport', TM_SRC, A.tmImport], ['tmSource4', TM_SRC, A.tmSource4], ['tmEraGate', TM_SRC, A.tmEraGate],
    ];
    for (const [n, src, an] of uniq) {
        ok(`锚点唯一性 · ${n}（恰 1 次）`, src.split(an).length - 1 === 1,
            `got=${src.split(an).length - 1}`);
    }
}

/* ============================================================
 * A. 桥消费面：在场归因、只读、不抛
 * ============================================================ */
{
    /* A1 未安装：与「装了但没开」必须**不同形**（本版批评的静默降级形态） */
    const none = { };
    const r1 = WB.readWorldAxisSnapshot({ win: none });
    ok('A1a 桥未安装 → ok=false 且 reason=not-mounted',
        r1.ok === false && r1.reason === 'not-mounted', JSON.stringify(r1.reason));
    ok('A1b 桥未安装时 source.mounted 如实为 false（不是猜测）',
        r1.source && r1.source.mounted === false);
    /* A2 装了但默认休眠（WorldAxis v2.16 的真实默认态）：reason 必须是 disabled */
    const sleeping = { worldaxis_bridge_v1: {
        settings: () => ({ enabled: false }),
        stat: () => ({ refused: 3, lastRefusal: { reason: 'disabled' } }),
        snapshot: () => null,
    } };
    const r2 = WB.readWorldAxisSnapshot({ win: sleeping });
    ok('A2a 桥已装但未启用 → reason=disabled（不是 not-mounted / 不是 no-snapshot）',
        r2.ok === false && r2.reason === 'disabled', JSON.stringify(r2.reason));
    ok('A2b 「未启用」与「未安装」是两种可归因的处境（本版核心：降级不得同形）',
        r1.reason !== r2.reason && r2.source.mounted === true);
    /* A3 已就绪：真取到快照 */
    const live = { worldaxis_bridge_v1: {
        settings: () => ({ enabled: true }),
        stat: () => ({ refused: 0, lastRefusal: null }),
        snapshot: () => ({ worldClock: { iso: '2026-09-18T21:30', label: '第三日夜', source: 'engine' },
            facts: [{ key: 'k1', value: 'v1', scope: 'world' }] }),
    } };
    const r3 = WB.readWorldAxisSnapshot({ win: live });
    ok('A3a 就绪态拿到快照', r3.ok === true && r3.reason === 'ok' && !!r3.snapshot);
    ok('A3b 快照里的 worldClock 被如实透传（桥不做二次加工）',
        r3.snapshot.worldClock.iso === '2026-09-18T21:30');
    /* A4 宿主怪癖不抛：snapshot() 抛异常 → 归因 pull-failed，不把异常抛给调用方 */
    const thrower = { worldaxis_bridge_v1: {
        settings: () => ({ enabled: true }),
        stat: () => ({ refused: 0 }),
        snapshot: () => { throw new Error('boom'); },
        refresh: () => { throw new Error('boom'); },
    } };
    let threw = false;
    let r4 = null;
    try { r4 = WB.readWorldAxisSnapshot({ win: thrower }); } catch (_e) { threw = true; }
    ok('A4a 宿主抛异常时不外抛（只读消费面必须吞得下去）', threw === false);
    ok('A4b 异常归因 pull-failed（不伪装成「世界是空的」）', r4 && r4.ok === false && r4.reason === 'pull-failed',
        JSON.stringify(r4 && r4.reason));
    /* A5 getter 抛异常的极端宿主：取桥本身也不得抛 */
    const evilWin = {};
    Object.defineProperty(evilWin, 'worldaxis_bridge_v1', { get() { throw new Error('getter boom'); } });
    let threw2 = false;
    let r5 = null;
    try { r5 = WB.readWorldAxisSnapshot({ win: evilWin }); } catch (_e) { threw2 = true; }
    ok('A5 桥取值 getter 抛异常时同样不外抛（getBridge 有守卫）',
        threw2 === false && r5 && r5.ok === false);
    /* A6 两个桥的在场一览：一次给全，供诊断面用 */
    const av = WB.worldBridgeAvailability(live);
    ok('A6a 在场一览含两个桥的 id 与归因',
        av && av.worldaxis && av.lonsha
        && av.worldaxis.id === 'worldaxis_bridge_v1' && av.lonsha.id === 'lonsha_memory_bridge_v1');
    ok('A6b 上游 id 常量逐字一致（改一处即两端同时失联）',
        WB.WORLDAXIS_BRIDGE_ID === 'worldaxis_bridge_v1'
        && WB.LONSHA_BRIDGE_ID === 'lonsha_memory_bridge_v1'
        && live.worldaxis_bridge_v1 !== undefined);
}

/* ============================================================
 * B. 世界钟解析：合法/非法/边界
 * ============================================================ */
{
    const ws = (iso, extra = {}) => ({ worldClock: { iso, label: 'L', source: 's', ...extra } });
    /* B1 合法 ISO（含时间）→ 同形时间对象 */
    const t1 = WB.readWorldClock(ws('2026-09-18T21:30'));
    ok('B1a 合法 ISO 解析出日期与时间',
        t1 && t1.date === '2026年09月18日' && t1.time === '21:30', JSON.stringify(t1 && t1.date));
    ok('B1b 返回值带 fromWorldClock 标记（调用方可据此归因来源）', t1 && t1.fromWorldClock === true);
    ok('B1c 解析成 TimeManager 可消费形态（有 timestamp / weekday / isAncient）',
        t1 && Number.isFinite(t1.timestamp) && typeof t1.weekday === 'string' && t1.isAncient === false);
    ok('B1d 世界钟的 label/source 被保留（供 UI 说明「时间从哪来」）',
        t1 && t1.label === 'L' && t1.source === 's');
    /* B2 只有日期（无时间）→ 时间补 00:00，不抛 */
    const t2 = WB.readWorldClock(ws('2026-09-18'));
    ok('B2 仅日期时时间补 00:00', t2 && t2.time === '00:00' && t2.date === '2026年09月18日');
    /* B3 空格分隔也认（ISO 的两种常见写法） */
    const t3 = WB.readWorldClock(ws('2026-09-18 07:05'));
    ok('B3 空格分隔的时间同样解析', t3 && t3.time === '07:05');
    /* B4 非法/缺失一律 null（调用方退回原路径，不猜） */
    const bad = [undefined, null, {}, { worldClock: null }, { worldClock: {} },
        ws(''), ws('不是时间'), ws('2026/09/18'), ws('2026-13-40'), ws('0000-00-00')];
    ok('B4 非法/缺失输入全部返回 null（不抛、不编）',
        bad.every(v => {
            try { return WB.readWorldClock(v) === null; } catch (_e) { return false; }
        }));
    /* B5 古历世界钟：非 ISO 串（大明纪年）→ null，绝不被误当公历 */
    const t5 = WB.readWorldClock(ws('大明永乐十二年九月初八日'));
    ok('B5 古历世界钟（非 ISO）返回 null（不会把古历误读成公历）', t5 === null);
    /* B6 越界时间被夹取（23:99 → 23:59），不产生 Invalid Date */
    const t6 = WB.readWorldClock(ws('2026-09-18T29:99'));
    ok('B6 越界时分被夹取而非产生 Invalid Date',
        t6 && t6.time === '23:59' && Number.isFinite(t6.timestamp), JSON.stringify(t6 && t6.time));
    /* B7 月份/日非法（如 2 月 31 日）不抛，Date 自行归一 */
    const t7 = WB.readWorldClock(ws('2026-02-31'));
    ok('B7 月末溢出日期不抛（由 Date 归一）', t7 !== null && Number.isFinite(t7.timestamp));
}

/* ============================================================
 * C. 真世界投影：条目形态、去重、传闻标注、上限
 * ============================================================ */
{
    const snap = {
        floor: 42, exportedAt: 1000,
        facts: [{ key: '城北大火', value: '已扑灭', scope: 'world' }],
        currents: [{ id: 'c1', title: '商会改组', summary: '三位理事退位', visibility: 'partial', stage: 'ongoing' }],
        pulse: { note: '舆论转向', trend: 'up', at: 900 },
        opinion: {
            canon: [{ title: '市政公告', body: '新规生效', claim: '已核实', at: 800 }],
            forum: [{ board: '本地论坛', topic: '关于商会的小道消息', claim: '', at: 700 }],
            sandbox: [{ kind: '日常', text: '街口有人议论', mood: '微妙' }],
        },
    };
    const p = WP.projectWorldAxis(snap, { maxEntries: 20, existingIds: [] });
    ok('C1a 投影成功且条数 = 六类各 1 条', p.ok === true && p.entries.length === 6, String(p.entries.length));
    ok('C1b counts 如实记数（每类 1）',
        JSON.stringify(p.counts) === JSON.stringify({ fact: 1, current: 1, pulse: 1, news: 1, rumor: 1, sandbox: 1 }));
    ok('C1c 条目 id 带 wa: 前缀（与 LLM 的 wp… 天然不撞）',
        p.entries.every(e => String(e.id).startsWith('wa:')));
    ok('C1d 条目带 source=worldaxis 标记（落地分支据此走 merge）',
        p.entries.every(e => e.source === 'worldaxis'));
    /* C2 传闻必须显式标注 —— 「已核实」与「纯传闻」在读者侧是两种事实强度 */
    const rumor = p.entries.find(e => e.kind === 'rumor');
    const news = p.entries.find(e => e.kind === 'news');
    ok('C2a 论坛传闻条目显式带「（传闻）」标注',
        rumor && rumor.content.includes('（传闻）'), rumor && rumor.content);
    ok('C2b 已核实新闻条目**不得**被标成传闻',
        news && !news.content.includes('（传闻）'), news && news.content);
    ok('C2c 传闻条目 style 与新闻不同（读者可据 style 分辨强度）', rumor.style !== news.style,
        `${rumor.style} / ${news.style}`);
    /* C3 去重：历史已有的 id 不再投递 */
    const again = WP.projectWorldAxis(snap, { maxEntries: 20, existingIds: p.entries.map(e => e.id) });
    ok('C3a 历史已有的条目不再投递（按 id 去重）', again.entries.length === 0, String(again.entries.length));
    ok('C3b 去重后 counts 仍如实记数（计数与投递是两件事）', again.counts.fact === 1);
    /* C4 上限与截断：dropped 如实报出被截掉几条 */
    const capped = WP.projectWorldAxis(snap, { maxEntries: 2, existingIds: [] });
    ok('C4a 条数被 maxEntries 封顶', capped.entries.length === 2, String(capped.entries.length));
    ok('C4b dropped 如实报出截断量', capped.dropped === 4, String(capped.dropped));
    /* C5 畸形输入不抛：缺字段就少投一条，counts 如实为零 */
    const broken = WP.projectWorldAxis({ facts: [null, 'x', { key: 'k', value: '' }], currents: 'not-array' });
    /* counts 记的是「源里给了几条」（含内容为空的），entries 才是「真投了几条」：
       facts 里 null / 'x' 被跳过，{key,value:''} 记进 counts 但因空内容不投。 */
    ok('C5a 畸形快照不抛：非法项被跳过、空内容不投，counts 如实记源有 1 条事实',
        broken.ok === true && broken.counts.fact === 1 && broken.counts.current === 0
        && broken.entries.length === 0, JSON.stringify(broken.counts));
    ok('C5b 空内容条目不投（与 pushHistory 空内容不入册同规格）',
        broken.entries.filter(e => !e.content).length === 0);
    ok('C5c null/非对象快照 → ok=false（不抛）',
        WP.projectWorldAxis(null).ok === false && WP.projectWorldAxis('x').ok === false);
}

/* ============================================================
 * D. 一致性块与历史并入
 * ============================================================ */
{
    const snap = { exportedAt: 1, facts: [{ key: 'A', value: 'a' }, { key: 'B', value: 'b' }] };
    const blk = WP.worldAxisPromptBlock(snap);
    ok('D1a 一致性块声明「不得与之矛盾」（把真世界事实变成硬约束）',
        blk.includes('本世界已发生的真实动态') && blk.includes('不得与之矛盾'));
    ok('D1b 一致性块逐条列出真动态（LLM 能看到事实清单）',
        blk.includes('- [世界事实] a') && blk.includes('- [世界事实] b'));
    ok('D1c 无内容时返回空串（调用方据此退回纯生成路径）',
        WP.worldAxisPromptBlock(null) === '' && WP.worldAxisPromptBlock({}) === '');
    /* D2 并入历史：按 id 去重、不修改入参、上限沿用 MAX_HISTORY */
    const hist0 = [{ id: 'wa:fact:A', content: 'a', style: '世界事实' }];
    const hist1 = WP.mergeWorldAxisHistory(hist0, [
        { id: 'wa:fact:A', content: 'a', style: '世界事实' },        // 重复 → 不并入
        { id: 'wa:fact:B', content: 'b', style: '世界事实' },        // 新 → 并入
    ]);
    ok('D2a 并入按 id 去重（重复条目不进册）', hist1.length === 2, String(hist1.length));
    ok('D2b 不修改入参（纯函数）', hist0.length === 1, String(hist0.length));
    ok('D2c 新条目带 createdAt（供视图排序）', Number.isFinite(hist1[1].createdAt));
    /* D3 上限：并入超出 MAX_HISTORY 时从头部丢弃 */
    const big = Array.from({ length: 60 }, (_, i) => ({ id: 'old' + i, content: 'c', style: 's' }));
    const merged = WP.mergeWorldAxisHistory(big, [{ id: 'wa:new', content: 'n', style: 's' }]);
    ok('D3a 并入后不超过 MAX_HISTORY（60）', merged.length === 60, String(merged.length));
    ok('D3b 上限截断从头部丢（新的留下）', merged[merged.length - 1].id === 'wa:new');
    /* D4 空内容条目不入册（与 pushHistory 同规格） */
    const e = WP.mergeWorldAxisHistory([], [{ id: 'x', content: '' }, null, { id: 'y', content: 'ok' }]);
    ok('D4 空内容/畸形条目被跳过', e.length === 1 && e[0].id === 'y');
}

/* ============================================================
 * E. 接线：消费者真的读了桥（不是定义了不用）
 * ============================================================ */
{
    ok('E1a 桥消费面的判据（世界钟解析三要素齐备）', judges.clock(WB_CODE));
    ok('E1b 降级可归因判据（disabled 单独成态）', judges.disabled(WB_CODE));
    ok('E2a 投影去重判据（历史已有不重投 + 排序）', judges.dedupe(EN_CODE));
    ok('E2b 传闻标注判据（forum 显式标传闻）', judges.rumor(EN_CODE));
    ok('E3a 真世界优先判据（_generate 先试真世界、成功即返回）', judges.realFirst(APP_CODE));
    ok('E3b 落地分支判据（真世界 merge / LLM pushHistory）', judges.landBranch(APP_CODE));
    ok('E4a 两个消费者都真的 import 了桥',
        judges.wiredApp(APP_CODE) && judges.wiredTm(TM_CODE));
    ok('E4b 世界钟接线判据（来源4 + 纪元门控，顺序正确）', judges.clockSource(TM_CODE));
    /* E5 设置开关：真世界优先可关闭（默认开启），条数可调 */
    const ds = WP.defaultSettings();
    ok('E5a 默认开启真世界优先（凭空发明平行世界本就是该修的缺陷）', ds.useRealWorld === true);
    ok('E5b 真世界条数上限存在且为正整数', Number.isInteger(ds.realWorldMax) && ds.realWorldMax > 0);
    ok('E5c 关掉开关后 _renderRealWorld 立即让路（源码里有 useRealWorld === false 短路）',
        /if \(s\.useRealWorld === false\) return null;/.test(APP_CODE));
    /* E6 只读自证：本版不得给上游桥任何写路径（两桥本就不给写） */
    const writes = [
        /worldaxis_bridge_v1\s*=\s*/, /window\.worldaxis_bridge_v1\s*=/,
        /lonsha_memory_bridge_v1\s*=/, /\.set\(/,
    ].slice(0, 3);
    ok('E6a 桥消费面不含对桥的赋值/写回（只读）',
        writes.every(re => !re.test(WB_CODE)));
    ok('E6b time-manager 读世界钟但不写桥（只读消费）',
        TM_CODE.includes(A.tmSource4) && !/worldaxis_bridge_v1\s*=/.test(TM_CODE));
    /* E7 上游 id 与上游源对齐（跨仓契约：本版从 WorldAxis 源码核对的字面量） */
    ok('E7 桥 id 常量以导出形式集中声明（改一处即知）',
        /export const WORLDAXIS_BRIDGE_ID = 'worldaxis_bridge_v1';/.test(WB_CODE)
        && /export const LONSHA_BRIDGE_ID = 'lonsha_memory_bridge_v1';/.test(WB_CODE));
}

/* ============================================================
 * F. 负控制：文本级 + 行为级（真源码破坏 → 加载副本 → 同款判据翻红）
 * ============================================================ */
function negative(real, broken, label) {
    /* 严格两向：**同一**判据必须在原版为真、在破坏副本上为假。
       只查一侧都会假绿：① 只查原版——破坏没发生也绿；③ 只查副本——破坏把判据
       自己删掉也绿（自我指涉）。两向 + 同款表达式才构成负控制。 */
    ok('F ' + label + ' → 判据必须翻红', real === true && broken === false,
        `real=${real} broken=${broken}`);
}
function breakSrc(src, anchor, repl) {
    const n = src.split(anchor).length - 1;
    if (n !== 1) throw new Error(`锚点命中 ${n} 次（要求恰 1 次）`);
    const broken = src.split(anchor).join(repl);
    if (broken === src) throw new Error('破坏未改字节');
    return broken;
}
let _vseq = 0;
async function loadBroken(src) {
    return await import('data:text/javascript;charset=utf-8;base64,'
        + Buffer.from(src, 'utf8').toString('base64') + '#v' + (++_vseq));
}
{
    /* F1 行为级 + 文本级：世界钟的日期范围校验被去掉 → 非法月日被接受。
       为什么不用「非对象守卫」做负控制：该守卫与函数外层的 try/catch 效果重合
       （无守卫时 `String(wc.iso)` 抛出的异常被 catch 吞掉，仍返回 null），
       行为级两向不可分 —— 首版正是踩到这里（real=null、broken 也=null，负控制恒真）。 */
    {
        const broken = breakSrc(WB_SRC, A.wbRange, 'if (false) return null;');
        const b = await loadBroken(broken);
        const realBad = WB.readWorldClock({ worldClock: { iso: '2026-13-40' } });
        const brokenBad = b.readWorldClock({ worldClock: { iso: '2026-13-40' } });
        ok('F1a 原版拒绝非法月日（iso=2026-13-40 → null）', realBad === null);
        ok('F1b 去掉范围校验后非法月日被接受（判据确实在验范围）', brokenBad !== null);
        negative(judges.clock(WB_CODE), judges.clock(codeOf(broken)), '世界钟丢失日期范围校验');
        ok('F1c 该破坏下合法日期仍正常（破坏只动了越界方向，判据不是恒假）',
            (b.readWorldClock({ worldClock: { iso: '2026-09-18T21:30' } }) || {}).time === '21:30');
    }
    /* F2 行为级：投影去重被去掉 → 历史已有的条目被重复投递 */
    {
        const broken = breakSrc(EN_SRC, A.enDedupe, '');
        const b = await loadBroken(broken);
        const snap = { facts: [{ key: 'k', value: 'v' }] };
        const exist = WP.projectWorldAxis(snap, { existingIds: ['wa:fact:k'] }).entries.length;
        const dup = b.projectWorldAxis(snap, { existingIds: ['wa:fact:k'] }).entries.length;
        negative(exist === 0, dup === 0, '投影去重被移除');
        ok('F2b 该破坏下无历史时不重复（说明破坏只动了去重方向，判据不是恒假）',
            b.projectWorldAxis(snap, { existingIds: [] }).entries.length === 1);
    }
    /* F3 行为级：传闻标注被去掉 → 「纯传闻」与「已核实」在读者侧同形 */
    {
        const broken = breakSrc(EN_SRC, A.enRumor, "const mark = '';");
        const b = await loadBroken(broken);
        const snap = { opinion: { forum: [{ board: 'B', topic: 'T', claim: '', at: 1 }] } };
        const realRumor = WP.projectWorldAxis(snap).entries[0];
        const brokenRumor = b.projectWorldAxis(snap).entries[0];
        ok('F3a 原版传闻条目带标注', realRumor.content.includes('（传闻）'), realRumor.content);
        ok('F3b 去掉标注后传闻与普通动态同形（判据确实在验标注）',
            !brokenRumor.content.includes('（传闻）'), brokenRumor.content);
        negative(judges.rumor(EN_CODE), judges.rumor(codeOf(broken)), '传闻标注被移除');
    }
    /* F4 文本级：真世界优先被去掉（直接调 LLM）→ 接线判据翻红 */
    {
        const broken = breakSrc(APP_SRC, A.appReturnReal, '');
        negative(judges.realFirst(APP_CODE), judges.realFirst(codeOf(broken)),
            '真世界优先短路被移除（退回「全由 LLM 现编」）');
    }
    /* F5 文本级：桥 import 被去掉 → 消费者失去数据源（定义了也没人给数据） */
    {
        const brokenApp = breakSrc(APP_SRC, A.appImport, '');
        negative(judges.wiredApp(APP_CODE), judges.wiredApp(codeOf(brokenApp)), 'worldpulse 与桥的 import 断开');
        const brokenTm = breakSrc(TM_SRC, A.tmImport, '');
        negative(judges.wiredTm(TM_CODE), judges.wiredTm(codeOf(brokenTm)), 'time-manager 与桥的 import 断开');
    }
    /* F6 文本级：世界钟的纪元门控被去掉 → 公历钟直接污染古历剧情 */
    {
        const broken = breakSrc(TM_SRC, A.tmEraGate, 'if (true) {');
        negative(judges.clockSource(TM_CODE), judges.clockSource(codeOf(broken)),
            '世界钟失去纪元门控（公历污染古历）');
    }
    /* F7 文本级：降级不再区分「未启用」与「未安装」→ 归因塌成一种 */
    {
        const broken = breakSrc(WB_SRC, A.wbDisabled, "reason = 'not-mounted';");
        negative(judges.disabled(WB_CODE), judges.disabled(codeOf(broken)),
            '「未启用」被并入「未安装」（降级同形）');
    }
    /* F8 工具两向自证：锚点不存在 / 不唯一 / 未改字节 都必须抛 */
    {
        const bad = (label, fn) => {
            let threw = false;
            try { fn(); } catch (_e) { threw = true; }
            ok('F8 ' + label, threw, '工具未对失效输入抛错（假绿通道）');
        };
        bad('锚点不存在须抛', () => breakSrc(WB_SRC, '__NO_SUCH_ANCHOR__', 'x'));
        bad('锚点不唯一须抛', () => breakSrc(WB_SRC, 'const ', 'const '));
        bad('破坏未改字节须抛', () => breakSrc(WB_SRC, A.wbIso, A.wbIso));
        bad('app 锚点不存在须抛', () => breakSrc(APP_SRC, '__NO_APP_ANCHOR__', 'x'));
        bad('tm 锚点不存在须抛', () => breakSrc(TM_SRC, '__NO_TM_ANCHOR__', 'x'));
    }
    /* F9 判据纯度：剥注释副本不得残留本版注释独有字样 */
    ok('F9a 剥注释副本不残留本版桥注释独有字样',
        !WB_CODE.includes('三个完全不同的处境'));
    ok('F9b 剥注释副本不残留本版引擎注释独有字样',
        !EN_CODE.includes('凭空发明的平行世界'));
    ok('F9c 剥注释不吞代码本体（桥）',
        WB_CODE.includes('export function readWorldClock(snapshot) {')
        && WB_CODE.includes('export function readWorldAxisSnapshot(opts = {}) {'));
    ok('F9d 剥注释不吞代码本体（引擎投影面）',
        EN_CODE.includes('export function projectWorldAxis(snapshot, opts = {}) {'));

    /* F10 负控制不得是「对原文件断言」（假绿第一形态）：破坏副本必须真的与原文不同 */
    {
        const broken = breakSrc(EN_SRC, A.enRumor, "const mark = '';");
        ok('F10 破坏副本与原文确有字节差（不是对原文件断言）', broken !== EN_SRC);
        const b = await loadBroken(broken);
        ok('F10b 破坏副本的口径与原版可观测地不同（并非加载了原模块）',
            b.projectWorldAxis({ opinion: { forum: [{ board: 'B', topic: 'T', claim: '', at: 1 }] } })
                .entries[0].content
            !== WP.projectWorldAxis({ opinion: { forum: [{ board: 'B', topic: 'T', claim: '', at: 1 }] } })
                .entries[0].content);
    }
}

/* ============================================================
 * G. 发布卫生
 * ============================================================ */
{
    const manifest = JSON.parse(read('manifest.json'));
    const pkg = JSON.parse(read('package.json'));
    const log = JSON.parse(read('update-log.json'));
    const v = (/const ST_PHONE_VERSION = '([^']+)'/.exec(IDX_SRC) || [])[1];
    ok('G1 index.js 版本 >= 2.35.0', vnum(v) >= vnum('2.35.0'), v);
    ok('G2 manifest 同版', manifest.version === v, `${manifest.version} vs ${v}`);
    ok('G3 package.json 同版', pkg.version === v, `${pkg.version} vs ${v}`);
    ok('G4 update-log 有本版条目', !!log.versions?.[v]);
    ok('G5 update-log.latest 指向当前版本', log.latest === v, `${log.latest} vs ${v}`);
    ok('G6 versions 头部即当前版本', Object.keys(log.versions || {})[0] === v,
        String(Object.keys(log.versions || {})[0]));
    const items = (log.versions?.[v]?.items) || [];
    const joined = items.join('\n');
    /* [v2.38.0] 交棓：G7a/G7b 原用当前版本条目查 v2.35 特有词，每发一版必翻红。改为钉 2.35.0 历史条目。 */
    const v235Items = ((log.versions?.['2.35.0'] || {}).items || []).join('\n');
    ok('G7a 钉 2.35.0 历史条目覆盖主线（世界桥 / 真世界）',
        /世界桥|世界轴/.test(v235Items) && /真世界|世界钟/.test(v235Items), String(v235Items.length));
    ok('G7b 钉 2.35.0 历史条目点出「两个世界对不上」的原始现场',
        /两个世界|现编|对不上/.test(v235Items), v235Items.slice(0, 60));
    ok('G8 条目数 >= 4', items.length >= 4, String(items.length));
    /* G9 内置公告与日志逐字同源（仓库私有时远端恒 404，公告是用户唯一能看到的说明） */
    const blk = (IDX_SRC.match(/const ST_PHONE_CURRENT_UPDATE = \{[\s\S]*?\n\};/) || [''])[0];
    ok('G9a 内置公告存在且 version 引用常量', blk.length > 0 && /version:\s*ST_PHONE_VERSION/.test(blk));
    const inner = blk.slice(blk.indexOf('items: [') + 'items: ['.length, blk.lastIndexOf(']'));
    let ann = null;
    try { ann = JSON.parse('[' + inner.replace(/,\s*$/, '') + ']'); } catch (_e) { ann = null; }
    ok('G9b 公告可解析为字符串数组', Array.isArray(ann) && ann.every(s => typeof s === 'string'));
    ok('G9c 公告与本版日志逐字同源', Array.isArray(ann) && JSON.stringify(ann) === JSON.stringify(items),
        `ann=${ann ? ann.length : 'null'} log=${items.length}`);
    /* G10 交棒基线：历史主线条目仍钉住（判据要钉不变的历史事实） */
    ok('G10a 2.34.0 历史条目仍在（重复存活域主线）',
        /重复存活/.test(((log.versions?.['2.34.0'] || {}).items || []).join('\n')));
    ok('G10b 2.33.0 历史条目仍在（成因账主线）',
        /成因/.test(((log.versions?.['2.33.0'] || {}).items || []).join('\n')));
    ok('G10c 2.32.0 历史条目仍在（回收口径主线）',
        /回收口径|两本账/.test(((log.versions?.['2.32.0'] || {}).items || []).join('\n')));
    /* G11 既有实现形态不得被本版改写 */
    ok('G11a v2.34 锁定的重复存活原语仍在',
        /export function childRuntimeDuplicates\(/.test(codeOf(read('config/runtime-lifecycle.js'))));
    ok('G11b v2.20 锁定的会话守卫仍在（worldpulse 落地段）',
        /if \(content && stamp === this\._currentSessionStamp\(\)\)/.test(APP_CODE));
    ok('G11c v2.21 锁定的入口乐观出队仍在',
        /const ev = st\.queue\[0\];/.test(APP_CODE));
    /* G12 本版不得引入对上游桥的写路径（只读契约） */
    ok('G12 全版零桥写入（产品代码里无桥赋值）',
        !/window\.worldaxis_bridge_v1\s*=[^=]/.test(read('index.js') + APP_SRC + TM_SRC + WB_SRC));
}
console.log(`\n[v2.35.0] 通过 ${pass} / 失败 ${fail}`);
process.exitCode = fail ? 1 : 0;