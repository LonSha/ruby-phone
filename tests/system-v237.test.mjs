/* ============================================================
 * RubyPhone v2.37.0 —— 桥读数自洽性 + 桥形态适配
 *
 * 本版问题（v2.36.0 修净之后仍在的真缺陷）：v2.36.0 建立的桥可观测面 `bridgeReport()`
 *   与它自己渲染的读数**互相矛盾**：
 *     · `bridgeSource()` 用 `!!(b.snapshot && typeof b.snapshot === 'object')` 判「对方有没有物」。
 *       lonsha 桥是**推送型**（snapshot 是对象），这么判是对的；
 *       WorldAxis 桥是**拉取型**（snapshot 是**函数**，外部入口）——这个属性**永远存在**，
 *       于是 `hasSnapshot` 恒为 true、`reason` 恒为 'ready'，**无论它到底发布过没有**。
 *     · 报告的第一行因此永远显示「WorldAxis 桥就绪」，而同一份报告里的读取结果是
 *       `readWorldAxisSnapshot().ok === false`——用户看到的第一句话是假的好消息。
 *   实测（v2.36.0 代码 + 真实形态夹具「开着闸、还没产出过快照」）：
 *       bridgeSource → { hasSnapshot: true, reason: 'ready' }
 *       readWorldAxisSnapshot → { ok: false, reason: 'pull-failed' }
 *       SELF-CONTRADICTION = true
 *   这正是本项目反复治理的两种形态叠加：
 *     ① 「读了一个恒真的判据」——读数看着像真读数，其实被写成了常数；
 *     ② 「可观测面自己谎报」——一个专门用来「让桥通不通可见」的版本，自己的第一行在撒谎。
 *
 * 本版修法（诚实读数，绝不猜）：
 *   · 新增桥形态适配层 `readPublished()`：推送型看 `snapshot` 是不是对象；
 *     拉取型问对方**自己的记账** `stat().published / stat().invalidated`；
 *     都无自述 ⇒ kind='unknown'、has=false（少报胜过多报）。
 *   · `bridgeReport()` 新增 `read`（**这一次真去拉**的结果）与 `consistent`
 *     （来源态说 ready 就必须真读得到）；不一致时如实置 false 并把话写进 `summary`。
 *   · 世界脉搏的桥卡片改用 `bridgeReport()` 的条目（此前用的是只有在场信息的
 *     `worldBridgeAvailability()`），把「说就绪、实际拉不到」摆给用户。
 *
 * 判据形态：锚点字面量集中在 BR 表只声明一次，判据与破坏共用（判据纯度）；
 *   每条破坏：真源码破坏 → 独立装载副本 → 同款判据翻红（配原版对照）。
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
const codeOf = (src) => String(src).replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').map(l => l.replace(/\/\/.*$/, '')).join('\n');

const WB_SRC = read('config/world-bridge.js');
const WB_CODE = codeOf(WB_SRC);
const VIEW_SRC = read('apps/worldpulse/worldpulse-view.js');
const VIEW_CODE = codeOf(VIEW_SRC);
const IDX_SRC = read('index.js');
const LOG = JSON.parse(read('update-log.json'));
const V = '2.37.0';

const WB = await import('../config/world-bridge.js');

/* ---------- 真实形态夹具 ---------- */
/** 拉取型（WorldAxis）：snapshot 是**函数**，有没有物只能问 stat() 自述 */
const pullBridge = (stat, snapFn) => ({
    id: 'worldaxis_bridge_v1', version: 1,
    settings: () => ({ enabled: true }),
    stat: () => stat,
    snapshot: snapFn || (() => null),
    refresh: () => null
});
const PULL_WIN = (stat, snapFn) => ({ worldaxis_bridge_v1: pullBridge(stat, snapFn) });
const PUBLISHED = { published: true, invalidated: false, publishes: 3, externalReads: 1, refused: 0, failures: 0, lastRefusal: null, lastFailure: null, subscribed: true };
const NEVER_PUBLISHED = { published: false, invalidated: false, publishes: 0, externalReads: 0, refused: 0, failures: 0, lastRefusal: null, lastFailure: null, subscribed: false };
const REAL_SNAPSHOT = () => ({ worldClock: { iso: '2026-09-13T21:45', label: '薄暮' } });

/* ══════════ A 桥形态适配：恒真判据必须消失 ══════════ */
{
    /* A1 修前的真现场：真实宿主形态下，未发布过的拉取桥不得被报成就绪 */
    const never = WB.bridgeSource('worldaxis_bridge_v1', PULL_WIN(NEVER_PUBLISHED));
    ok('A1 ★ 拉取型桥从未发布 ⇒ 不得报就绪（hasSnapshot 不得恒真）',
        never.mounted === true && never.hasSnapshot === false && never.reason === 'no-snapshot',
        JSON.stringify(never));

    /* A2 同一个桥，发布过 ⇒ 就绪 */
    const pub = WB.bridgeSource('worldaxis_bridge_v1', PULL_WIN(PUBLISHED, REAL_SNAPSHOT));
    ok('A2 ★ 拉取型桥已发布 ⇒ 就绪（两态可辨，不是一个常数）',
        pub.hasSnapshot === true && pub.reason === 'ready', JSON.stringify(pub));

    /* A3 作废态：已作废待重建 ⇒ 不等于「有物」 */
    const inv = WB.bridgeSource('worldaxis_bridge_v1', PULL_WIN({ published: true, invalidated: true }));
    ok('A3 ★ 已作废（待重建）⇒ 不得报就绪（作废优先于已发布）',
        inv.hasSnapshot === false && inv.reason === 'no-snapshot', JSON.stringify(inv));

    /* A4 旧版桥无自述能力 ⇒ 少报，不硬猜「有」 */
    const legacy = WB.bridgeSource('worldaxis_bridge_v1', PULL_WIN({}));
    ok('A4 ★ 无自述能力的旧桥 ⇒ 不硬猜有物（少报胜过多报）',
        legacy.hasSnapshot === false && legacy.reason === 'no-snapshot');

    /* A5 推送型（lonsha）语义不变：snapshot 是对象就是有物，null 就是没有 */
    ok('A5 推送型桥语义不变（有对象⇒有物 / null⇒无物）',
        WB.lonshaSource(WB.LONSHA_BRIDGE_ID, { lonsha_memory_bridge_v1: { sourceState: 'ready', snapshot: { clock: {} } } }).reason === 'ready'
        && WB.lonshaSource(WB.LONSHA_BRIDGE_ID, { lonsha_memory_bridge_v1: { sourceState: 'idle', snapshot: null } }).reason === 'no-snapshot');

    /* A6 ★ 报告不得自相矛盾：来源态说 ready ⇔ 这一次真读得到 */
    const cases = [
        ['never', PULL_WIN(NEVER_PUBLISHED), true],
        ['published+readable', PULL_WIN(PUBLISHED, REAL_SNAPSHOT), true],
        ['published-but-pull-returns-null', PULL_WIN(PUBLISHED, () => null), false],
        ['invalidated', PULL_WIN({ published: true, invalidated: true }), true]
    ];
    let allOk = true;
    for (const [label, win, wantConsistent] of cases) {
        const rep = WB.bridgeReport(win);
        const r = WB.readWorldAxisSnapshot({ win });
        const selfConsistent = (rep.worldaxis.reason === 'ready') === (r.ok === true);
        if (rep.consistent !== wantConsistent || selfConsistent !== wantConsistent) {
            allOk = false;
            console.log(`    · ${label}: consistent=${rep.consistent} 期望=${wantConsistent} 自洽=${selfConsistent}`);
        }
    }
    ok('A6 ★ 报告自洽：来源态「就绪」必须与「这一次真读到了」同真同假', allOk);

    /* A7 read 字段如实带出这一次的读取结果 */
    const repNever = WB.bridgeReport(PULL_WIN(NEVER_PUBLISHED));
    const repPub = WB.bridgeReport(PULL_WIN(PUBLISHED, REAL_SNAPSHOT));
    ok('A7 报告带出 read（这一次真去拉的结果）',
        repNever.worldaxis.read && repNever.worldaxis.read.ok === false && repNever.worldaxis.read.reason === 'pull-failed'
        && repPub.worldaxis.read && repPub.worldaxis.read.ok === true,
        JSON.stringify([repNever.worldaxis.read, repPub.worldaxis.read]));

    /* A8 ★ 「说就绪、实际拉不到」必须写进 summary（第一行不得是假的好消息） */
    const bad = WB.bridgeReport(PULL_WIN(PUBLISHED, () => null));
    ok('A8 ★ 自述与实拉不一致时，summary 必须点破（不掩盖）',
        bad.consistent === false && /实际拉取失败/.test(bad.summary), bad.summary);
    ok('A9 正常态 summary 不得误报拉取失败（判据不得恒真）',
        !/实际拉取失败/.test(WB.bridgeReport(PULL_WIN(PUBLISHED, REAL_SNAPSHOT)).summary));

    /* A10 报告的 stat 带出拉取型发布自述（区分「从未发布」与「已作废」） */
    const st = WB.bridgeReport(PULL_WIN({ published: true, invalidated: true })).worldaxis.stat;
    ok('A10 报告带出 published / invalidated 两项自述',
        st && st.published === true && st.invalidated === true, JSON.stringify(st));

    /* A11 不抛：桥对象/stat 畸形 */
    let threw = false;
    try {
        WB.bridgeSource('worldaxis_bridge_v1', { worldaxis_bridge_v1: { get snapshot() { throw new Error('x'); } } });
        WB.bridgeReport(PULL_WIN({ get published() { throw new Error('stat-boom'); } }));
        WB.bridgeReport({ get worldaxis_bridge_v1() { throw new Error('win-boom'); } });
    } catch (_e) { threw = true; }
    ok('A11 桥形态探测不得外抛（畸形一律降级）', !threw);

    /* A12 只读契约不因本版放松 */
    const w = PULL_WIN(PUBLISHED, REAL_SNAPSHOT);
    const before = JSON.stringify(w);
    WB.bridgeReport(w);
    ok('A12 ★ 只读契约：生成报告不改桥的任何字段', JSON.stringify(w) === before);
}

/* ══════════ B 兜底分支的形状与语义 ══════════ */
{
    const fallback = {
        worldaxis_bridge_v1: {
            settings: () => ({ enabled: true }),
            stat: () => ({ get publishes() { throw new Error('stat-boom'); } }),
            snapshot: () => null
        }
    };
    let rep = null, threw = false;
    try { rep = WB.bridgeReport(fallback); } catch (_e) { threw = true; }
    ok('B1 报告层任何异常 ⇒ 降级返回且不外抛', !threw && !!rep);
    ok('B2 兜底分支形状与正常分支一致（read / consistent 都在）',
        !!rep && 'read' in rep.worldaxis && typeof rep.consistent === 'boolean',
        JSON.stringify(rep && Object.keys(rep)));
    ok('B3 兜底分支的 consistent 为 false（降级不得自称自洽）',
        !!rep && rep.consistent === false);
    const noBridge = WB.bridgeReport({});
    ok('B4 两个桥都不在 ⇒ 仍自洽（没东西可矛盾）且如实报未装',
        noBridge.consistent === true && noBridge.worldaxis.reason === 'not-mounted' && noBridge.lonsha.reason === 'not-mounted',
        JSON.stringify(noBridge.worldaxis));
}

/* ══════════ C 消费侧：可观测面把矛盾摆给用户 ══════════ */
{
    ok('C1 ★ 桥卡片改读 bridgeReport() 的条目（不再只读只有在场信息的 availability）',
        /const rep = \(st && st\.report\) \|\| null;/.test(VIEW_CODE)
        && /const wi = \(rep && rep\.worldaxis\) \|\| br\.worldaxis \|\| \{\}, lo = \(rep && rep\.lonsha\) \|\| br\.lonsha \|\| \{\};/.test(VIEW_CODE));
    ok('C2 ★ 卡片把「来源态就绪但实际拉取失败」也算读不到',
        /\(wi\.reason === 'ready' && waRead && waRead\.ok === false\)/.test(VIEW_CODE)
        && /\(lo\.reason === 'ready' && loRead && loRead\.ok === false\)/.test(VIEW_CODE));
    ok('C3 卡片把读取结果渲染出来（实际拉取失败：…）',
        /实际拉取失败：/.test(VIEW_SRC) && /wi\.read \|\| null/.test(VIEW_CODE));
    ok('C4 ★ 卡片单独提示「来源态与实际读取不一致」',
        /rep\.consistent === false/.test(VIEW_CODE) && /不一致/.test(VIEW_SRC));
    ok('C5 卡片显示 summary（一句话总述真被用上）', /rep\.summary/.test(VIEW_CODE));
    ok('C6 视图仍只调 app.bridgeStatus()，不自己摸桥全局',
        /this\.app\.bridgeStatus\(\)/.test(VIEW_CODE)
        && !/window\s*\.\s*(worldaxis|lonsha)_[a-z_]*bridge_v1/.test(VIEW_CODE));
}

/* ══════════ D 负控制：真源码破坏 → 独立加载副本 → 同款判据翻红 ══════════ */
{
    /* 锚点字面量集中声明一次（判据纯度：judges 里不得复述这些串） */
    const BR = {
        /* 形态适配：把「作废优先」拆掉 ⇒ 已作废的桥会被报成有物 */
        invalidated: "if (st.invalidated === true) return { kind: 'pull', has: false };",
        /* 形态适配：拉取型自述恒假 ⇒ 已发布的桥也被报成无物（方向相反的恒真） */
        published: "if (st.published === true) return { kind: 'pull', has: true };",
        /* 自洽性出口：拆掉它 ⇒ 报告不再自证矛盾 */
        consistent: "        consistent: ((waSrc.reason === 'ready') === !!(waRead && waRead.ok === true))",
        /* 实际读取的记录：拆掉它 ⇒ 报告再也拿不到「这一次真读到了没」 */
        captureRead: "        if (rwa) waRead = { ok: rwa.ok === true, reason: String(rwa.reason || '') };"
    };
    const loadWB = (src) => {
        const body = src
            .replace(/^import[\s\S]*?;$/gm, '')
            .replace(/\bexport\s+default\s*\{/g, 'const __default = {')
            .replace(/\bexport\s+(function|const)\s/g, '$1 ');
        const names = ['WORLDAXIS_BRIDGE_ID', 'LONSHA_BRIDGE_ID', 'getBridge', 'bridgeSource',
            'readWorldAxisSnapshot', 'readWorldClock', 'readLonshaSnapshot', 'worldBridgeAvailability',
            'lonshaSource', 'diffClocks', 'bridgeReport'];
        return new Function(body + '\nreturn { ' + names.join(', ') + ' };')();
    };
    const broken = (anchor, to) => {
        const hits = (WB_SRC.match(new RegExp(anchor.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;
        if (hits !== 1) throw new Error('锚点命中 ' + hits + ' 次（须 1）');
        const out = WB_SRC.replace(anchor, to);
        if (out === WB_SRC) throw new Error('替换未改变源码（负控制是假的）');
        return out;
    };
    /** 集中判据（只断言行为，不复述锚点字面量） */
    const judges = {
        invalidatedNotReady: (api) => {
            const s = api.bridgeSource('worldaxis_bridge_v1', PULL_WIN({ published: true, invalidated: true }));
            return s.hasSnapshot === false && s.reason === 'no-snapshot';
        },
        publishedIsReady: (api) => {
            const s = api.bridgeSource('worldaxis_bridge_v1', PULL_WIN(PUBLISHED, REAL_SNAPSHOT));
            return s.hasSnapshot === true && s.reason === 'ready';
        },
        selfConsistent: (api) => {
            const win = PULL_WIN(PUBLISHED, () => null);
            const rep = api.bridgeReport(win);
            const r = api.readWorldAxisSnapshot({ win });
            return rep.consistent === false && (rep.worldaxis.reason === 'ready') !== (r.ok === true);
        },
        readReported: (api) => {
            const rep = api.bridgeReport(PULL_WIN(NEVER_PUBLISHED));
            return !!(rep.worldaxis.read && rep.worldaxis.read.ok === false);
        }
    };
    const real = loadWB(WB_SRC);
    ok('D1 （负向自证·原版对照）真源码上四条判据全部干净',
        judges.invalidatedNotReady(real) && judges.publishedIsReady(real)
        && judges.selfConsistent(real) && judges.readReported(real),
        JSON.stringify({ i: judges.invalidatedNotReady(real), p: judges.publishedIsReady(real), s: judges.selfConsistent(real), r: judges.readReported(real) }));

    const j = judges;
    const bInv = loadWB(broken(BR.invalidated, "if (false) return { kind: 'pull', has: false };"));
    ok('D2 拆掉「作废优先」⇒ 已作废的桥被报成有物（用户以为世界还在）',
        j.invalidatedNotReady(bInv) === false);
    ok('D3 破坏「作废优先」不连坐已发布的读数', j.publishedIsReady(bInv) === true);

    const bPub = loadWB(broken(BR.published, "if (false) return { kind: 'pull', has: true };"));
    ok('D4 拆掉「已发布即就绪」⇒ 已发布的桥被报成无物（反方向的恒假）',
        j.publishedIsReady(bPub) === false);

    const bCon = loadWB(broken(BR.consistent, '        consistent: true'));
    ok('D5 ★ 拆掉自洽性出口 ⇒ 报告不再自证矛盾（「说就绪实际拉不到」被吞掉）',
        j.selfConsistent(bCon) === false);
    ok('D6 破坏自洽性不连坐形态适配', j.invalidatedNotReady(bCon) === true);

    const bCap = loadWB(broken(BR.captureRead, '        if (false) waRead = { ok: rwa.ok === true, reason: String(rwa.reason || \'\') };;'));
    ok('D7 拆掉读取记录 ⇒ 报告再也拿不到「这一次真读到了没」',
        j.readReported(bCap) === false);

    let toolOk = true;
    try { broken('THIS_ANCHOR_DOES_NOT_EXIST_IN_SOURCE', ''); toolOk = false; } catch (_e) { /* 应抛 */ }
    ok('D8 工具自证：不存在的锚点必须抛（假破坏不得静默通过）', toolOk);
    const judgeSrc = fs.readFileSync(path.join(root, 'tests/system-v237.test.mjs'), 'utf8');
    const judgePart = judgeSrc.slice(judgeSrc.indexOf('const judges = {'), judgeSrc.indexOf('const real = loadWB'));
    ok('D9 判据纯度：集中判据里不得复述破坏锚点字面量',
        !judgePart.includes("st.invalidated === true") && !judgePart.includes("st.published === true")
        && !judgePart.includes('waRead = { ok: rwa.ok'));
}

/* ══════════ E 发布卫生 ══════════ */
{
    const v = (IDX_SRC.match(/const ST_PHONE_VERSION = '([\d.]+)'/) || [])[1];
    ok('E1 index.js 版本不低于本版', vnum(v) >= vnum(V), String(v));
    ok('E2 package.json 与入口同源', JSON.parse(read('package.json')).version === v);
    ok('E3 manifest.json 与入口同源', JSON.parse(read('manifest.json')).version === v);
    ok('E4 update-log 有本版条目', !!LOG.versions?.[V]);
    ok('E5 update-log.latest 指向当前版本', LOG.latest === V, `${LOG.latest} vs ${V}`);
    ok('E6 versions 头部即当前版本', Object.keys(LOG.versions || {})[0] === V, String(Object.keys(LOG.versions || {})[0]));
    const items = (LOG.versions?.[V]?.items) || [];
    const joined = items.join('\n');
    ok('E7a 本版条目点出「读数自相矛盾」这一原始现场', /矛盾|自洽/.test(joined), String(items.length));
    ok('E7b 本版条目点出两种桥形态（推送型/拉取型）', /拉取|推送/.test(joined));
    ok('E8 条目数 >= 4', items.length >= 4, String(items.length));
    const blk = (IDX_SRC.match(/const ST_PHONE_CURRENT_UPDATE = \{[\s\S]*?\n\};/) || [''])[0];
    ok('E9a 内置公告存在且 version 引用常量', blk.length > 0 && /version:\s*ST_PHONE_VERSION/.test(blk));
    const inner = blk.slice(blk.indexOf('items: [') + 'items: ['.length, blk.lastIndexOf(']'));
    let ann = null;
    try { ann = JSON.parse('[' + inner.replace(/,\s*$/, '') + ']'); } catch (_e) { ann = null; }
    ok('E9b 公告可解析为字符串数组', Array.isArray(ann) && ann.every(s => typeof s === 'string'));
    ok('E9c 公告与本版日志逐字同源', Array.isArray(ann) && JSON.stringify(ann) === JSON.stringify(items),
        `ann=${ann ? ann.length : 'null'} log=${items.length}`);
    ok('E10a v2.36 桥可观测面条目仍在', /可观测/.test(((LOG.versions?.['2.36.0'] || {}).items || []).join('\n')));
    ok('E10b v2.35 世界桥消费面条目仍在', /世界桥/.test(((LOG.versions?.['2.35.0'] || {}).items || []).join('\n')));
    ok('E10c v2.34 重复存活域条目仍在', /重复存活/.test(((LOG.versions?.['2.34.0'] || {}).items || []).join('\n')));
    ok('E11a v2.35/v2.36 锁定的导出六件套仍在',
        ['readWorldAxisSnapshot', 'readWorldClock', 'readLonshaSnapshot', 'worldBridgeAvailability', 'bridgeSource', 'getBridge', 'lonshaSource', 'diffClocks', 'bridgeReport']
            .every(n => WB_CODE.includes(n)));
    ok('E11b v2.35 真世界优先接线仍在（worldpulse）', /_renderRealWorld/.test(codeOf(read('apps/worldpulse/worldpulse-app.js'))));
    ok('E11c v2.36 世界钟权威源仍在（time-manager）', /getWorldAxisTime\(\)/.test(codeOf(read('config/time-manager.js'))));
    ok('E11d 本版新增出口真被消费（无新一轮零消费）',
        /\.consistent/.test(VIEW_CODE) && /\.read \|\| null/.test(VIEW_CODE)
        && /readPublished/.test(WB_CODE));
}
console.log(`\n[v2.37.0] 通过 ${pass} / 失败 ${fail}`);
if (fail) process.exit(1);
