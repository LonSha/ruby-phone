/* ============================================================
 * tests/system-v4460.test.mjs -- [v4.46.0 · 第五期 R5-X6 作者改设定的影响预览]
 *
 * 验收口径（计划原文 R5-X6）：
 *   「作者改了设定（住所 / 身份 / 关系 / 时间 / 钱款）时，先看清会牵动哪些既有引用：
 *     受影响 / **明确不受影响** / 判不了 三态各列；逐项由人决定保留或重算；
 *     取消零写；确认过闸才落台账；确认后重开与撤销可回读。」
 *   不做：「不批量覆写」「不展示『全库无遗漏』」「不猜语义相似」。
 *
 * 【本件治的缺陷形态（读码可复算，不是推演）】
 *   本仓反复治过的那一类：**看起来没坏但显示不对**。改设定的射程在本版之前
 *   没有任何落点 —— 用户改了「住在城西」，而会面、人物档案、章节正文、约定
 *   四类里挂着他旧住处的那些条目一条都不会说话；他要么全改（改到无关的财务），
 *   要么全不改（漏掉该改的）。两种都**不可见**。
 *
 * 【本件判什么（六组）】
 *   A 口径：五态与四态互不同形 / 口径表穷尽性 / 判定顺序（spares 先于 tracked）/
 *           纯契约零副作用 / 状态字面量唯一出处
 *   B 契约件内核：四态拒收（缺原事实·坏种类·缺新设定·新旧同文）/ 拒收零写零列 /
 *               幂等键 / 去重限量 / 覆盖诚实性（未追踪必须说出来，全覆盖不许含糊）/
 *               类目受影响却一条条目都没取到必须单列并拦确认 / 逐项不许默认 /
 *               撤销三态分形 / 空件不抛 / 自检真跑
 *   C 台账读写：登记→回读→重开可查 / 坏存储降级不抛 / 空台账如实说
 *   D 宿主落笔：过闸才写 / 重复确认不双插 / 缺材料整单拒收 / 目标缺席不报成功 /
 *               台账上限丢最旧且说出来 / 只落本机不发送
 *   E 接线：视图按钮与预览真投递 / App 出口 / 样式双侧投递（源 + phone.css）/
 *           不做面可判（无发布、无网络、无自动生成）
 *   F 负控制 + 版本锚：真源码副本定点破坏 ⇒ 同款判据必转红；五源同源
 *
 * 【为什么负控制破坏副本而不是原仓】见 tests/system-v4120.test.mjs 档头（同规）。
 * 【为什么「不受影响」必须与「判不了」分形】两者处置相反：前者是口径的必然
 *   （这次改写不会碰它），后者是数据的运气（本机没接上那一面）。
 *   压平之后「不误改无关财务」与「未追踪明确标未知覆盖」两句会变成一句。
 * ========================================================== */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { copyTreeSafe } from './_mirror_tree.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const KERNEL_REL = 'config/setting-rewrite-contract.js';
const APP_REL = 'apps/memory/memory-app.js';
const VIEW_REL = 'apps/memory/memory-view.js';
const VIEW_CSS_REL = 'apps/memory/memory.css';
const BUNDLE_CSS_REL = 'phone.css';
const HOST_REL = 'index.js';

const K = await import(pathToFileURL(path.join(ROOT, KERNEL_REL)).href);
const APP = await import(pathToFileURL(path.join(ROOT, APP_REL)).href);

const kernelSrc = read(KERNEL_REL);
const appSrc = read(APP_REL);
const viewSrc = read(VIEW_REL);
const appCssSrc = read(VIEW_CSS_REL);
const bundleCssSrc = read(BUNDLE_CSS_REL);

/** 去注释后的源码：判据只认代码，不认注释里的自述（本仓旧病：注释里的名字被当成代码）。 */
function stripComments(src) {
    let out = '';
    let i = 0;
    let state = 'code';
    let quote = '';
    while (i < src.length) {
        const c = src[i];
        const d = src[i + 1];
        if (state === 'code') {
            if (c === '/' && d === '*') { state = 'block'; i += 2; continue; }
            if (c === '/' && d === '/') { state = 'line'; i += 2; continue; }
            if (c === '"' || c === "'" || c === '`') { state = 'str'; quote = c; out += c; i += 1; continue; }
            out += c; i += 1; continue;
        }
        if (state === 'block') {
            if (c === '*' && d === '/') { state = 'code'; i += 2; continue; }
            i += 1; continue;
        }
        if (state === 'line') {
            if (c === '\n') { state = 'code'; out += c; }
            i += 1; continue;
        }
        /* state === 'str' */
        if (c === '\\') { out += c + (d === undefined ? '' : d); i += 2; continue; }
        if (c === quote) { state = 'code'; out += c; i += 1; continue; }
        out += c; i += 1; continue;
    }
    return out;
}
const kernelCode = stripComments(kernelSrc);
/** 去字符串字面量（内容清空、引号保留）：负向判据必须用它 ——
 *  被检查的套件里写着同款判据自身的锚点字符串（如 `'log.versions[ver]'`），
 *  只去注释会让判据**自指**、把正确写法判红（本仓负控制假绿/假红三形之一）。 */
function stripStrings(src) {
    let out = '';
    let i = 0;
    let state = 'code';
    let quote = '';
    while (i < src.length) {
        const c = src[i];
        if (state === 'code') {
            if (c === '"' || c === "'" || c === '`') { state = 'str'; quote = c; out += c; i += 1; continue; }
            out += c; i += 1; continue;
        }
        if (c === '\\') { i += 2; continue; }
        if (c === quote) { state = 'code'; out += c; i += 1; continue; }
        i += 1; continue;
    }
    return out;
}
const appCode = stripComments(appSrc);
const viewCode = stripComments(viewSrc);

/** 取 App 的 SR 块（收窄判据靶子：App 里别处也有 absent/empty 等字面量，
 *  那是导入面 / 覆盖面的读数，不是本版 SR 的交接态 —— 裸判会误伤）。 */
function srBlockOf(src) {
    /* 入参是**已去注释**的源码 ⇒ 边界必须用代码锚（注释锚在这里已经不存在了）。 */
    const a = src.indexOf('_srPlugin() {');
    const b = src.indexOf('_lorePlugin() {');
    assert.ok(a >= 0 && b > a, 'App 的 SR 块必须可定位（判据靶子收窄的前提）');
    return src.slice(a, b);
}
const appSrCode = srBlockOf(appCode);

const S = K.SR_STATES;
const IS = K.SR_ITEM_STATES;
const R = K.SR_REASONS;

/* ══════════ 假件 ══════════ */
function mkStorage(seed) {
    const mem = new Map();
    if (seed) for (const k of Object.keys(seed)) mem.set(k, seed[k]);
    return {
        get: (k, d) => (mem.has(k) ? mem.get(k) : d),
        set: (k, v) => { mem.set(k, v); },
        has: (k) => mem.has(k),
        __mem: mem
    };
}
function mkApp(storage) {
    globalThis.window = { VirtualPhone: {}, LonShaMemory: undefined };
    return new APP.MemoryApp(null, storage || mkStorage());
}
function clearWin() { delete globalThis.window; }

/** 一份能过闸的旅程现场：日历备忘里字面挂着「旧居」（commitment 有数据源）。 */
function seededStorage(extra) {
    return mkStorage(Object.assign({
        calendar_memos: [{ title: '去旧居取东西', dateKey: '2026-03-01', time: '10:00' }]
    }, extra || {}));
}
/** 走一趟：预览 → 逐项决定 → 确认。 */
function journey(app, opts) {
    const o = opts || {};
    const face = app.settingImpactPreview(
        { kind: o.kind || 'residence', text: o.from || '旧居' }, o.to || '城南新居');
    const rows = app.settingImpactRows();
    const need = rows.filter((r) => r.needDecision);
    if (o.decide !== false) {
        for (const r of need) app.settingImpactDecide(r.id, o.decision || 'keep');
    }
    return { face: face, rows: rows, need: need };
}

/* ══════════ A ── 口径面 ══════════ */
test('A1 五态与四态互不同形：读不到 / 没有数据源 / 拒收 / 这一类没有 / 有得判 各自成格', () => {
    const states = Object.values(S);
    assert.equal(new Set(states).size, states.length, '★ 五态值必须唯一（压平即造出处置相反的处境长得一样）');
    assert.notEqual(S.UNREADABLE, S.ABSENT, '「读不到」与「没有数据源」处置相反（再试 vs 先接数据源）');
    assert.notEqual(S.ABSENT, S.EMPTY, '「没有任何一类数据源」与「这一类里一条都没有」处置相反（判不了 vs 真读数）');
    assert.notEqual(S.REFUSED, S.ABSENT, '「输入不合格」与「没数据源」处置相反（补输入 vs 接数据源）');
    const items = Object.values(IS);
    assert.equal(new Set(items).size, items.length, '★ 四态值必须唯一');
    assert.notEqual(IS.UNAFFECTED, IS.UNTRACKED, '「明确不受影响」与「判不了」处置相反（别碰 vs 看不见）');
    assert.notEqual(IS.UNTRACKED, IS.NO_FACT, '「类目判不了」与「这一条没说是哪类」处置相反');
    /* 两种决定必须分列（不许合并成一个「更新」）。 */
    assert.equal(Object.keys(K.SR_DECISIONS).length, 2, '决定必须恰两种');
    assert.equal(new Set(Object.values(K.SR_DECISION_LABEL)).size, 2, '两种决定的标签必须不同形');
});

test('A2 判定顺序：spares 先于 tracked（顺序倒了财务会被读成判不了）', () => {
    /* 夹具：财务**没有数据源**、且改的是住所（财务在 spares）。 */
    const f = K.buildImpactPreview({
        fact: { kind: 'residence', text: '旧居' }, next: '新居',
        trackedKinds: ['meeting'], refs: [{ id: 'a1', kind: 'meeting', label: '搬家' }]
    });
    assert.ok(f.faceUnaffected.indexOf('finance') >= 0,
        '★ 财务必须落在「明确不受影响」—— 这是口径的必然，与有没有数据源无关');
    assert.equal(f.faceUntracked.indexOf('finance'), -1,
        '★ 顺序倒了：财务会因没有数据源被读成「判不了」，「不误改无关财务」这句就读不出来了');
    assert.ok(f.line.indexOf('明确不受影响') >= 0, '不受影响必须在读数里看得见');
    /* 源码级自证：spares 判定必须写在 tracked 判定之前。 */
    const iSpares = kernelCode.indexOf('if (inSpares)');
    const iTracked = kernelCode.indexOf('if (tracked.indexOf(kind) < 0)');
    assert.ok(iSpares >= 0 && iTracked > iSpares, '★ 判定顺序必须是 spares 先于 tracked');
});

test('A3 口径表穷尽性：每类引用在每个事实种类下恰在一侧', () => {
    const factKinds = Object.values(K.SR_FACT_KINDS);
    const refKinds = Object.values(K.SR_REF_KINDS);
    for (const fk of factKinds) {
        const t = K.SR_TOUCH[fk];
        assert.ok(t, '口径表缺这一类：' + fk);
        for (const rk of refKinds) {
            const a = t.affects.indexOf(rk) >= 0;
            const s = t.spares.indexOf(rk) >= 0;
            assert.ok(a !== s, '★ ' + fk + ' 的「' + rk + '」必须恰在一侧（当前 affects=' + a + ' spares=' + s + '）');
        }
    }
    /* 私人笔记恒豁免（不自动覆写用户手写内容）。 */
    for (const fk of factKinds) {
        assert.equal(K.SR_TOUCH[fk].affects.indexOf('note'), -1, '★ ' + fk + ' 不得把私人笔记算进受影响面');
    }
    /* 钱款只动财务面。 */
    assert.equal(K.SR_TOUCH.money.affects.join(), 'finance', '★ 改钱款必须恰影响财务面');
});

test('A4 纯契约零副作用 + 状态字面量唯一出处（收窄到 SR 块，不误伤导入面读数）', () => {
    /* 纯函数：连调两次结果一致，且不改动入参。 */
    const input = {
        fact: { kind: 'residence', text: '旧居' }, next: '新居',
        trackedKinds: ['meeting'], refs: [{ id: 'a1', kind: 'meeting', label: '搬家' }]
    };
    const snap = JSON.stringify(input);
    const f1 = K.buildImpactPreview(input);
    const f2 = K.buildImpactPreview(input);
    assert.equal(f1.line, f2.line, '纯函数：同样输入必须同样读数');
    assert.equal(JSON.stringify(input), snap, '★ 契约件不得改动入参（零副作用）');
    assert.equal(f1.writesNothing, true, '预览面恒为只读（一个字都不写）');
    /* 唯一出处：契约件是五态/四态/决定/归因词的唯一声明处。 */
    for (const name of ['SR_STATES', 'SR_ITEM_STATES', 'SR_DECISIONS', 'SR_REASONS']) {
        assert.equal(kernelCode.split('export const ' + name + ' =').length - 1, 1,
            name + ' 只许有一个装配点');
    }
    /* App 的 SR 块只许**引用**这些常量，不许自持第二份状态表（裸字面量即第二份真源）。 */
    for (const lit of ["'refused'", "'unreadable'", "'absent'", "'affected'", "'unaffected'", "'untracked'", "'no-fact'"]) {
        assert.equal(appSrCode.indexOf(lit), -1, '★ App 的 SR 块不得自持状态字面量 ' + lit + '（须走契约件常量）');
    }
    assert.ok(appSrCode.indexOf('SR_LIMITS') >= 0 || appSrCode.indexOf('SR_DECISION_LABEL') >= 0
        || appSrCode.indexOf('SR_FACT_LABEL') >= 0,
        'App 的 SR 块必须真引用契约件的常量表（不自持第二份）');
    /* 视图不许自己判态（只转交 App 的读数）。 */
    assert.equal(viewCode.indexOf('buildImpactPreview'), -1, '★ 视图不得直接调契约件内核（判定只在 App 层取数后由契约件出）');
});

/* ══════════ B ── 契约件内核 ══════════ */
test('B1 四态拒收各归其因，且一个字都不写', () => {
    const noFact = K.buildImpactPreview({ next: 'X' });
    const badKind = K.buildImpactPreview({ fact: { kind: 'nope', text: 'A' }, next: 'B' });
    const noNext = K.buildImpactPreview({ fact: { kind: 'residence', text: 'A' } });
    const same = K.buildImpactPreview({ fact: { kind: 'residence', text: 'A' }, next: 'A' });
    assert.equal(noFact.reason, R.NO_FACT, '缺原事实必须按 rewrite-no-fact 拒收');
    assert.equal(badKind.reason, R.BAD_FACT_KIND, '坏种类必须按 rewrite-bad-fact-kind 拒收');
    assert.equal(noNext.reason, R.NO_NEXT, '缺新设定必须按 rewrite-no-next 拒收');
    assert.equal(same.reason, R.SAME_TEXT, '新旧同文必须按 rewrite-same-text 拒收');
    for (const [nm, f] of [['noFact', noFact], ['badKind', badKind], ['noNext', noNext], ['same', same]]) {
        assert.equal(f.state, S.REFUSED, nm + ' 必须报拒收');
        assert.equal(f.writesNothing, true, nm + ' 必须零写');
        assert.equal(f.items.length, 0, nm + ' 必须零列');
        assert.ok(f.line.indexOf('一个字都没写') >= 0, '★ ' + nm + ' 的读数必须明说零写（空读数在界面上就是一片空白）');
    }
    /* 归因词表是闭集（防随口新词）。 */
    assert.equal(Object.keys(R).length, 5, '拒收归因词表必须恰 5 个键（含 OK 空串）');
});

test('B2 幂等键与去重限量：同一份改写同键、引用最多 60 条、标签最多 60 字', () => {
    const k1 = K.rewriteKeyOf({ kind: 'residence', text: '旧居' }, '新居');
    const k2 = K.rewriteKeyOf({ kind: 'residence', text: '旧居' }, '新居');
    const k3 = K.rewriteKeyOf({ kind: 'residence', text: '旧居' }, '另一处');
    assert.equal(k1, k2, '同一份改写必须同键（重复确认据此不双建）');
    assert.notEqual(k1, k3, '新设定不同必须换键');
    assert.notEqual(K.factKeyOf({ kind: 'residence', text: 'A' }), K.factKeyOf({ kind: 'role', text: 'A' }),
        '事实指纹必须含种类');
    const many = [];
    for (let i = 0; i < 80; i += 1) many.push({ id: 'r' + i, kind: 'meeting', label: '会面 ' + i });
    const f = K.buildImpactPreview({
        fact: { kind: 'residence', text: '旧居' }, next: '新居', trackedKinds: ['meeting'], refs: many
    });
    assert.equal(f.refs.length, K.SR_LIMITS.refs, '★ 逐项行必须截到上限（' + K.SR_LIMITS.refs + '）');
    const longLabel = K.impactRows(K.buildImpactPreview({
        fact: { kind: 'residence', text: '旧居' }, next: '新居', trackedKinds: ['meeting'],
        refs: [{ id: 'x', kind: 'meeting', label: '标'.repeat(200) }]
    }));
    const refRow = longLabel.find((r) => r.rowKind === 'ref');
    assert.ok(refRow.line.length < 400, '★ 单条标签必须截到上限（防一条引用把整行读数顶爆）');
    assert.equal(K.SR_LIMITS.label, 60, '标签上限的唯一出处');
});

test('B3 覆盖诚实性：未追踪必须说出来，全覆盖不许含糊，也绝不展示「全库无遗漏」', () => {
    const part = K.buildImpactPreview({
        fact: { kind: 'residence', text: '旧居' }, next: '新居',
        trackedKinds: ['meeting'], refs: [{ id: 'a1', kind: 'meeting', label: '搬家' }]
    });
    assert.ok(part.faceUntracked.length > 0, '夹具：会受影响却没数据源的类必须判不了');
    assert.equal(part.coverage.complete, false, '覆盖不完整时 complete 必须为假');
    assert.ok(part.line.indexOf('未追踪') >= 0, '★ 覆盖不足必须在读数里说出来');
    assert.ok(part.line.indexOf('别当成') >= 0, '★ 覆盖不足必须点明「别当成都追到了」');
    assert.equal(part.line.indexOf('全库无遗漏'), -1, '★ 验收原文点名不做：不许展示「全库无遗漏」');
    const allAff = K.SR_TOUCH.residence.affects.slice();
    const full = K.buildImpactPreview({
        fact: { kind: 'residence', text: '旧居' }, next: '新居', trackedKinds: allAff,
        refs: allAff.map((k, i) => ({ id: 'r' + i, kind: k, label: K.SR_REF_LABEL[k] }))
    });
    assert.equal(full.coverage.complete, true, '全覆盖时 complete 必须为真');
    assert.equal(full.line.indexOf('未追踪'), -1, '全覆盖时不得报未追踪');
    assert.ok(full.line.indexOf('都接上了数据源') >= 0, '★ 全覆盖也要明说（不许含糊其辞）');
});

test('B4 类目受影响却一条条目都没取到 ⇒ 必须单列并拦住确认（防漏报，比误改更隐蔽）', () => {
    const allAff = K.SR_TOUCH.residence.affects.slice();
    const gap = K.buildImpactPreview({
        fact: { kind: 'residence', text: '旧居' }, next: '新居', trackedKinds: allAff,
        refs: [{ id: 'a1', kind: 'meeting', label: '搬家' }]
    });
    assert.ok(gap.faceAffectedNoRefs.indexOf('person') >= 0, '★ 受影响却没条目的类必须单列出来');
    assert.ok(gap.line.indexOf('一条具体引用都没取到') >= 0, '★ 读数必须点明这一格');
    const g = K.commitGate(gap, K.planDecisions(gap, { a1: 'keep' }));
    assert.equal(g.ok, false, '★ 有类没取到条目必须拦住确认（逐项决定不足以覆盖）');
    assert.equal(g.reason, 'affected-not-listed', '归因必须是 affected-not-listed');
    /* 一条条目都没有时同样拦住（不能凭一个类名去改）。 */
    const none = K.buildImpactPreview({
        fact: { kind: 'residence', text: '旧居' }, next: '新居', trackedKinds: allAff, refs: []
    });
    assert.equal(K.commitGate(none, K.planDecisions(none, {})).reason, 'affected-not-listed',
        '一条具体引用都没有时不得放行');
    /* 没有身份的引用单列（判不了该改哪一条）。 */
    const un = K.buildImpactPreview({
        fact: { kind: 'residence', text: '旧居' }, next: '新居', trackedKinds: ['meeting'],
        refs: [{ kind: 'meeting', label: '无身份的会面' }]
    });
    assert.ok(un.unnamed.length > 0, '★ 没有身份的引用必须单列');
    assert.equal(un.state, S.EMPTY, '只有未具名引用时面态是 empty（真读数，不是读不到）');
    assert.ok(un.line.indexOf('没有身份') >= 0, '未具名必须在读数里说出来');
});

test('B5 逐项不许默认：未决定拦住、认不出的决定算未决定、给不该改的项下决定报出来', () => {
    const f = K.buildImpactPreview({
        fact: { kind: 'residence', text: '旧居' }, next: '新居', trackedKinds: ['meeting', 'person'],
        refs: [
            { id: 'a1', kind: 'meeting', label: '搬家' },
            { id: 'p1', kind: 'person', label: '档案：住处' }
        ]
    });
    const p0 = K.planDecisions(f, {});
    assert.equal(p0.ok, false, '★ 一项都没决定必须拦住（不许默认保留，也不许默认重算）');
    assert.equal(p0.counts.undecided, 2, '未决定项数必须如实');
    const p1 = K.planDecisions(f, { a1: 'keep', p1: 'recompute' });
    assert.equal(p1.ok, true, '两项都定了必须放行');
    assert.equal(p1.counts.keep, 1, '「保留原样」与「重算」必须分列');
    assert.equal(p1.counts.recompute, 1, '「保留原样」与「重算」必须分列');
    const p2 = K.planDecisions(f, { a1: 'keep', p1: 'delete' });
    assert.equal(p2.ok, false, '认不出的决定必须算未决定');
    assert.equal(p2.counts.undecided, 1, '认不出的决定必须计进未决定');
    /* 给「明确不受影响」的项下决定必须报出来（那就是「顺手改无关财务」的写法）。 */
    const g = K.buildImpactPreview({
        fact: { kind: 'residence', text: '旧居' }, next: '新居', trackedKinds: ['meeting'],
        refs: [{ id: 'a1', kind: 'meeting', label: '搬家' }]
    });
    assert.equal(K.planDecisions(g, { a1: 'keep' }).ignored.length, 0, '台账外的 id 不算乱决定');
    /* 没有逐项行的面直接可确认。 */
    const bare = K.buildImpactPreview({
        fact: { kind: 'residence', text: '旧居' }, next: '新居', trackedKinds: ['meeting'], refs: []
    });
    assert.equal(K.planDecisions({ items: [], state: S.READY }, {}).ok, true, '没有逐项行的面必须直接可确认');
    assert.ok(bare, '（bare 仅用于占位，不参与断言）');
});

test('B6 撤销三态分形：可撤 / 已经撤过 / 台账里没有这一次（三者互不同形）', () => {
    const led = { entries: [{ key: 'k1', factKind: 'residence', from: 'A', to: 'B', rows: [{ id: 'r1' }], undone: false }] };
    const u1 = K.planUndo(led, 'k1');
    const u2 = K.planUndo({ entries: [{ key: 'k1', undone: true }] }, 'k1');
    const u3 = K.planUndo(led, 'k9');
    const u4 = K.planUndo(led, '');
    assert.equal(u1.state, 'applied', '台账里有且未撤必须可撤');
    assert.equal(u2.state, 'noop', '★ 已经撤过必须报「不用撤」（不许报撤成功）');
    assert.equal(u3.state, 'refused', '★ 台账里没有这一次必须报「没见过」（不许报撤过了）');
    assert.equal(u4.state, 'refused', '没说撤哪一次必须拒收');
    assert.equal(new Set([u1.state, u2.state, u3.state]).size, 3, '★ 撤销三态必须互不同形');
    assert.ok(u2.line.indexOf('已经撤过') >= 0, '撤过必须明说');
    assert.ok(u3.line.indexOf('没有这一次') >= 0, '没见过必须明说');
});

test('B7 台账读数与空件：空台账如实说、已撤与只落本机分列、空件一律不抛', () => {
    assert.ok(K.srLedgerLine(null).indexOf('还没确认过') >= 0, '★ 空台账必须如实说');
    const ll = K.srLedgerLine({
        entries: [
            { key: 'k1', undone: false, localOnly: true },
            { key: 'k2', undone: true, localOnly: false }
        ]
    });
    assert.ok(ll.indexOf('已撤 1') >= 0 && ll.indexOf('只落本机 1') >= 0, '台账必须分列已撤与只落本机');
    assert.ok(ll.indexOf('重开可查') >= 0, '台账读数必须点明重开可查');
    assert.equal(K.impactLine(null), '改设定：读不到', '空面读数必须如实');
    assert.equal(K.impactRows(null).length, 0, '空面不得凭空出行');
    for (const [nm, fn] of [
        ['impactLine', () => K.impactLine(null)],
        ['impactRows', () => K.impactRows(null)],
        ['srLedgerLine', () => K.srLedgerLine(null)],
        ['planUndo', () => K.planUndo(null, 'x')],
        ['planDecisions', () => K.planDecisions(null, null)],
        ['commitGate', () => K.commitGate(null, null)],
        ['buildImpactPreview', () => K.buildImpactPreview(null)]
    ]) {
        let threw = null;
        try { fn(); } catch (e) { threw = e; }
        assert.equal(threw, null, '★ 空件不得抛：' + nm);
    }
});

test('B8 契约件自检真跑（十六项全绿，且不是自评）', () => {
    const sc = K.srSelfCheck();
    assert.deepEqual(sc.problems, [], '★ 契约件自检必须全绿：' + JSON.stringify(sc.problems).slice(0, 400));
    assert.equal(sc.factKinds, Object.keys(K.SR_FACT_KINDS).length, '自检必须真数事实种类');
    assert.equal(sc.refKinds, Object.keys(K.SR_REF_KINDS).length, '自检必须真数引用类');
    assert.ok(kernelCode.indexOf('function srSelfCheck(') >= 0, '自检必须是真函数（不是常量）');
    /* 自检必须真调内核（防「返回空 problems 的假自检」）。 */
    assert.ok(kernelCode.indexOf('buildImpactPreview({ next:') >= 0, '自检必须真跑拒收夹具');
});

/* ══════════ C ── 台账读写 ══════════ */
test('C1 登记→回读→重开可查（台账键是本机唯一真源）', () => {
    const st = seededStorage();
    const app = mkApp(st);
    journey(app);
    const res = app.settingImpactConfirm();
    assert.equal(res.ok, true, '过闸后必须能确认：' + res.note);
    assert.equal(res.saved, true, '台账必须真写进去');
    /* 回读：同一 storage（等价于重开）必须看得到。 */
    const again = mkApp(st);
    assert.equal(again.settingRewriteLedger().entries.length, 1, '★ 重开必须读得到那一笔（本机唯一真源）');
    assert.ok(again.settingRewriteLedgerLine().indexOf('本机记了 1 次') >= 0, '台账行必须如实计数');
    assert.ok(again.settingRewriteLedgerLine().indexOf('只落本机 1') >= 0, '本版无上游出口 ⇒ 必须分列只落本机');
    clearWin();
});

test('C2 坏存储降级不抛：读不出给空台账、写不进如实说', () => {
    const broken = {
        get: () => { throw new Error('x'); },
        set: () => { throw new Error('x'); }
    };
    globalThis.window = { VirtualPhone: {} };
    const app = new APP.MemoryApp(null, broken);
    const led = app.settingRewriteLedger();
    assert.deepEqual(led.entries, [], '读不出必须给空台账（不许抛）');
    assert.ok(app.settingRewriteLedgerLine().indexOf('还没确认过') >= 0, '空台账如实说');
    /* 写不进：预览/决定都照常，确认时如实报没写进去。 */
    const face = app.settingImpactPreview({ kind: 'residence', text: '旧居' }, '城南新居');
    assert.ok(face, '取数失败也不得抛');
    clearWin();
});

test('C3 台账键只许有一个装配点（两个真源迟早分叉）', () => {
    assert.equal(appCode.split("'setting_rewrite_ledger_v1'").length - 1, 1,
        '★ 台账键只许有一个装配点（`_srLedgerKey`）');
    assert.ok(appSrCode.indexOf('_srLedgerKey()') >= 0, '台账键必须由唯一出口给');
});

/* ══════════ D ── 宿主落笔 ══════════ */
test('D1 过闸才落笔：闸不放行时台账一个字节都不写', () => {
    const st = seededStorage();
    const app = mkApp(st);
    /* 未决定 ⇒ 闸不放行。 */
    journey(app, { decide: false });
    const gate = app.settingImpactGate();
    assert.equal(gate.ok, false, '未决定时闸必须不放行');
    const res = app.settingImpactConfirm();
    assert.equal(res.ok, false, '闸不放行时确认必须失败');
    assert.equal(app.settingRewriteLedger().entries.length, 0, '★ 闸不放行时台账必须零写（取消零写）');
    assert.ok(res.note.length > 0, '失败必须给得出原因（不许静默）');
    /* 补上决定后再确认 ⇒ 落笔。 */
    for (const r of app.settingImpactRows().filter((x) => x.needDecision)) app.settingImpactDecide(r.id, 'keep');
    assert.equal(app.settingImpactConfirm().ok, true, '补齐决定后必须能确认');
    assert.equal(app.settingRewriteLedger().entries.length, 1, '落笔后台账必须恰一笔');
    clearWin();
});

test('D2 重复确认不双插（连点不许把台账计数刷大）', () => {
    const st = seededStorage();
    const app = mkApp(st);
    journey(app);
    const r1 = app.settingImpactConfirm();
    const r2 = app.settingImpactConfirm();
    assert.equal(r1.ok, true, '第一次必须成功');
    assert.equal(r2.ok, true, '第二次仍应成功（幂等）');
    assert.equal(app.settingRewriteLedger().entries.length, 1, '★ 同一份改写重复确认必须只留一笔（不双插）');
    assert.ok(r2.note.indexOf('本来就在台账里') >= 0, '★ 必须如实说「没有新增」（不许让用户以为记了两笔）');
    clearWin();
});

test('D3 缺材料整单拒收：缺原事实 / 缺新设定 / 认不出种类 ⇒ 不落笔、不报成功', () => {
    const st = seededStorage();
    const app = mkApp(st);
    for (const [nm, fact, next] of [
        ['缺原事实', { kind: 'residence', text: '' }, '城南新居'],
        ['缺新设定', { kind: 'residence', text: '旧居' }, ''],
        ['认不出种类', { kind: 'nope', text: '旧居' }, '城南新居']
    ]) {
        const face = app.settingImpactPreview(fact, next);
        assert.equal(face.state, S.REFUSED, nm + ' 必须整单拒收');
        const res = app.settingImpactConfirm();
        assert.equal(res.ok, false, nm + ' 不得确认');
        assert.equal(app.settingRewriteLedger().entries.length, 0, nm + ' 必须零写');
    }
    assert.ok(app.settingImpactLine().indexOf('一个字都没写') >= 0, '拒收读数必须明说零写');
    clearWin();
});

test('D4 目标缺席不报成功：台账里没有这一次 ⇒ 撤销必须报没见过（不许报撤成功）', () => {
    const st = seededStorage();
    const app = mkApp(st);
    const miss = app.settingImpactUndo('residence|从没确认过→X');
    assert.equal(miss.ok, false, '★ 台账里没有这一次必须失败');
    assert.equal(miss.undo.state, 'refused', '★ 必须归因 refused（不许报撤过了）');
    assert.equal(app.settingRewriteLedger().entries.length, 0, '没见过的撤销不得凭空写台账');
    /* 走一趟完整旅程后：可撤 → 再撤报 noop（不是撤成功）。 */
    journey(app);
    const key = app.settingImpactConfirm().key;
    const u1 = app.settingImpactUndo(key);
    assert.equal(u1.ok, true, '确认过的必须可撤');
    assert.equal(app.settingRewriteLedger().entries[0].undone, true, '撤销必须留痕（重开看得到）');
    const u2 = app.settingImpactUndo(key);
    assert.equal(u2.ok, false, '★ 已经撤过必须失败');
    assert.equal(u2.undo.state, 'noop', '★ 必须归因 noop（不许报撤成功）');
    clearWin();
});

test('D5 台账上限：超出只留最近 N 次，且丢最旧必须说出来', () => {
    const N = K.SR_LIMITS.ledger;
    const seeded = [];
    for (let i = 0; i < N + 5; i += 1) {
        seeded.push({ key: 'old' + i, seq: i + 1, factKind: 'residence', from: 'A' + i, to: 'B' + i, undone: false, localOnly: true, rows: [], cov: {} });
    }
    const st = seededStorage({ setting_rewrite_ledger_v1: { entries: seeded } });
    const app = mkApp(st);
    journey(app);
    const res = app.settingImpactConfirm();
    assert.equal(res.ok, true, '必须能确认');
    const entries = app.settingRewriteLedger().entries;
    assert.equal(entries.length, N, '★ 台账必须截到上限 ' + N + '（本仓「导出了 API 但零调用」的形态）');
    assert.ok(res.note.indexOf('丢了最旧的') >= 0, '★ 丢最旧必须说出来（静默丢会让用户把「被裁掉」读成「没记过」）');
    assert.equal(entries[entries.length - 1].key.indexOf('residence|') >= 0, true, '最近这一次必须在场（裁的是最旧的）');
    clearWin();
});

test('D6 只登记不发送：SR 块不发消息、不发请求、不生成正文', () => {
    for (const bad of ['chat.push', 'setChatMessages', 'updateMessage', 'saveChat', 'deleteMessage',
        'fetch(', 'XMLHttpRequest', 'generateQuietPrompt', 'Generate(']) {
        assert.equal(appSrCode.indexOf(bad), -1, '★ 改设定面不得出现 ' + bad + '（只登记，不发不生成）');
    }
    /* 上游出口不存在时**必须**如实降级（本版实测没有 R5-X6 出口）。 */
    assert.ok(appSrCode.indexOf('settingImpactHasUpstream') >= 0, '必须有上游出口探测口');
    assert.ok(appSrCode.indexOf('localOnly: true') >= 0, '★ 本机降级必须如实标 localOnly');
});

/* ══════════ E ── 接线 ══════════ */
test('E1 视图接线：元素在场、事件真投递、读数全部来自 App 出口', () => {
    for (const id of ['mem-sr-host', 'mem-sr-kind', 'mem-sr-from', 'mem-sr-to', 'mem-sr-preview',
        'mem-sr-face', 'mem-sr-rows', 'mem-sr-gate', 'mem-sr-confirm', 'mem-sr-undo', 'mem-sr-ledger', 'mem-sr-note']) {
        assert.ok(viewSrc.indexOf('"' + id + '"') >= 0, '视图缺元素 ' + id);
    }
    for (const fn of ["e.target.closest('#mem-sr-preview')", "e.target.closest('#mem-sr-confirm')",
        "e.target.closest('#mem-sr-undo')", "e.target.closest('.mem-sr-dec')", "e.target.closest('.mem-sr-undec')"]) {
        assert.ok(viewCode.indexOf(fn) >= 0, '缺事件落点 ' + fn);
    }
    /* 视图读数必须全部来自 App 出口（视图不自判、不自己拼一句）。 */
    for (const outlet of ['settingImpactLine', 'settingImpactRows', 'settingImpactGate',
        'settingImpactState', 'settingRewriteLedgerLine']) {
        assert.ok(viewCode.indexOf(outlet) >= 0, '视图必须真读 App 出口：' + outlet);
    }
    assert.ok(viewCode.indexOf('this._srPreview()') >= 0, '「看影响」必须真调到取数口');
    assert.ok(viewCode.indexOf('this._srConfirm()') >= 0, '「确认」必须真调到落笔口');
    /* 空输入必须先拦在视图（一个字都不写）。 */
    assert.ok(viewCode.indexOf('先填原事实与新设定') >= 0, '空输入必须拦在视图并如实说');
});

test('E2 App 出口齐备：取数 / 决定 / 闸 / 落笔 / 撤销 / 台账 / 自检', () => {
    const st = seededStorage();
    const app = mkApp(st);
    for (const fn of ['settingImpactPreview', 'settingImpactLine', 'settingImpactState', 'settingImpactRows',
        'settingImpactFactOptions', 'settingImpactDecisionOptions', 'settingImpactPicks',
        'settingImpactDecide', 'settingImpactUndecide', 'settingImpactPlan', 'settingImpactGate',
        'settingImpactConfirm', 'settingImpactUndo', 'settingRewriteLedger', 'settingRewriteLedgerLine',
        'settingRewriteSelfCheck', 'settingImpactHasUpstream']) {
        assert.equal(typeof app[fn], 'function', 'App 缺出口 ' + fn);
    }
    /* 事实种类与决定的清单必须来自契约件（视图下拉的唯一出处）。 */
    assert.deepEqual(app.settingImpactFactOptions().map((x) => x.kind).sort(),
        Object.keys(K.SR_FACT_LABEL).sort(), '事实种类清单必须与契约件同源');
    assert.deepEqual(app.settingImpactDecisionOptions().map((x) => x.decision).sort(),
        Object.keys(K.SR_DECISION_LABEL).sort(), '决定清单必须与契约件同源');
    assert.deepEqual(app.settingRewriteSelfCheck().problems, [], 'App 的自检口必须真跑契约件自检');
    clearWin();
});

test('E3 样式双侧投递：源样式与 phone.css 打包侧逐类同投', () => {
    for (const cls of ['.mem-sr-section', '.mem-sr-face', '.mem-sr-rows', '.mem-sr-row', '.mem-sr-tag',
        '.mem-sr-decrow', '.mem-sr-dec', '.mem-sr-undec', '.mem-sr-cur', '.mem-sr-gate',
        '.mem-sr-ledger', '.mem-sr-note-text']) {
        assert.ok(appCssSrc.indexOf(cls) >= 0, '源样式缺 ' + cls);
        assert.ok(bundleCssSrc.indexOf(cls) >= 0, '★ phone.css 打包侧缺 ' + cls + '（只写一侧等于打包环境里裸奔）');
    }
    /* 五态各色（三态在口径上处置相反，在屏上也不许长成一样）。 */
    for (const st of ['refused', 'unreadable', 'absent', 'ready', 'empty']) {
        assert.ok(appCssSrc.indexOf('.mem-sr-state-' + st) >= 0, '缺面态配色 ' + st);
    }
    for (const st of ['affected', 'unaffected', 'untracked', 'no-fact']) {
        assert.ok(appCssSrc.indexOf('.mem-sr-' + st) >= 0, '缺逐行态配色 ' + st);
    }
    /* 段头必须独立成行（本仓踩过粘连坑），且打包侧与源段逐字同源。 */
    const seg = (src) => {
        const i = src.indexOf('[v4.46.0 · R5-X6]');
        assert.ok(i >= 0, '缺本版段头');
        return src.slice(i).trim();
    };
    assert.equal(seg(bundleCssSrc), seg(appCssSrc), '★ phone.css 的本版段必须与 apps/memory/memory.css 逐字同源');
});

test('E4 不做面可判：不发布、不联网、不批量覆写、不自动生成', () => {
    for (const bad of ['fetch(', 'XMLHttpRequest', 'WebSocket', 'https://', 'http://']) {
        assert.equal(appSrCode.indexOf(bad), -1, 'SR 块不得出现 ' + bad);
    }
    /* 确认只写台账与既有键，不写正文（正文改写是 owner 的事）。 */
    assert.equal(appSrCode.split('_srLedgerSave(').length - 1, 3,
        '★ 台账写入口只许被确认 / 撤销用到（3 次 = 定义 + 两处调用）');
    /* 本版是只读面 + 台账：契约件恒不写。 */
    assert.equal(kernelCode.indexOf('localStorage'), -1, '★ 契约件不得碰存储（纯函数）');
    assert.equal(kernelCode.indexOf('window.'), -1, '★ 契约件不得碰宿主');
});

/* ══════════ F ── 负控制 + 版本锚 ══════════ */
const temps = [];
function makeMirror() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rp_v4460_'));
    temps.push(dir);
    copyTreeSafe(path.join(ROOT, 'config'), path.join(dir, 'config'));
    copyTreeSafe(path.join(ROOT, 'apps', 'memory'), path.join(dir, 'apps', 'memory'));
    copyTreeSafe(path.join(ROOT, 'apps', 'reading'), path.join(dir, 'apps', 'reading'));
    return dir;
}
process.on('exit', () => {
    for (const d of temps) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (_e) { /* 忽略 */ } }
});
function breakCopy(rel, anchor, replacement) {
    const dir = makeMirror();
    const src = read(rel);
    const hits = src.split(anchor).length - 1;
    assert.equal(hits, 1, '破坏锚点必须恰中 1 次（实测 ' + hits + ' 次）：' + anchor.slice(0, 70));
    fs.writeFileSync(path.join(dir, rel), src.split(anchor).join(replacement));
    return dir;
}
const loadAt = async (dir, rel, tag) =>
    await import(pathToFileURL(path.join(dir, rel)).href + '?' + tag + '=' + Date.now());
const expectRed = (fn, tag) => {
    let problems = null;
    try { problems = fn(); } catch (e) { problems = ['抛了:' + String((e && e.message) || e)]; }
    assert.ok(problems.length > 0, tag + '：破坏副本上同款判据必须转红（实测全绿 ⇒ 判据空转）');
};

test('F0 ★★★ 阳性对照：未破坏时下列各条判据必须全为真（否则 F 组是假绿）', () => {
    const f = K.buildImpactPreview({
        fact: { kind: 'residence', text: '旧居' }, next: '新居',
        trackedKinds: ['meeting'], refs: [{ id: 'a1', kind: 'meeting', label: '搬家' }]
    });
    assert.ok(f.faceUnaffected.indexOf('finance') >= 0, '原版：财务必须明确不受影响');
    assert.equal(K.planUndo({ entries: [{ key: 'k1', undone: true }] }, 'k1').state, 'noop', '原版：撤过报 noop');
    assert.deepEqual(K.srSelfCheck().problems, [], '原版：自检全绿');
    const st = seededStorage();
    const app = mkApp(st);
    journey(app);
    app.settingImpactConfirm();
    app.settingImpactConfirm();
    assert.equal(app.settingRewriteLedger().entries.length, 1, '原版：重复确认只留一笔');
    clearWin();
});

test('F1 ★★★ 破坏「spares 先于 tracked」⇒ 同款判据必转红（财务被读成判不了）', async () => {
    const dir = breakCopy(KERNEL_REL,
        '    if (inSpares) {',
        '    if (false && inSpares) {');
    const k2 = await loadAt(dir, KERNEL_REL, 'f1');
    const f = k2.buildImpactPreview({
        fact: { kind: 'residence', text: '旧居' }, next: '新居',
        trackedKinds: ['meeting'], refs: [{ id: 'a1', kind: 'meeting', label: '搬家' }]
    });
    assert.equal(f.faceUnaffected.indexOf('finance'), -1,
        '破坏副本：同款判据必转红（财务不再落在「明确不受影响」）');
    assert.ok(f.faceUntracked.indexOf('finance') >= 0, '破坏副本：财务掉进了「判不了」（这就是那条错读数）');
});

test('F2 ★★★ 破坏「重复确认不双插」⇒ 同款判据必转红（连点刷大台账）', async () => {
    const dir = breakCopy(APP_REL,
        '    if (dup) {',
        '    if (false && dup) {');
    const a2 = await loadAt(dir, APP_REL, 'f2');
    globalThis.window = { VirtualPhone: {} };
    const app = new a2.MemoryApp(null, seededStorage());
    journey(app);
    app.settingImpactConfirm();
    app.settingImpactConfirm();
    const rows = app.settingRewriteLedger().entries;
    assert.equal(rows.length, 2, '破坏副本：同款判据必转红（同一份改写被插了两笔）');
    clearWin();
});

test('F3 ★★★ 破坏「撤过报 noop」⇒ 同款判据必转红（撤过被当成撤成功）', async () => {
    const dir = breakCopy(KERNEL_REL,
        '    if (hit.undone === true) {',
        '    if (false) {');
    const k2 = await loadAt(dir, KERNEL_REL, 'f3');
    const u = k2.planUndo({ entries: [{ key: 'k1', undone: true }] }, 'k1');
    assert.notEqual(u.state, 'noop', '破坏副本：同款判据必转红（撤过不再报不用撤）');
    assert.equal(u.state, 'applied', '破坏副本：已经撤过的被报成「可以撤销」（这就是那条谎报）');
});

test('F4 ★★★ 破坏「台账上限」⇒ 同款判据必转红（台账无限长）', async () => {
    const dir = breakCopy(APP_REL,
        '    while (ledger.entries.length > SR_LIMITS.ledger) { ledger.entries.shift(); trimmed += 1; }',
        '    while (false) { ledger.entries.shift(); trimmed += 1; }');
    const a2 = await loadAt(dir, APP_REL, 'f4');
    const N = K.SR_LIMITS.ledger;
    const seeded = [];
    for (let i = 0; i < N + 5; i += 1) seeded.push({ key: 'old' + i, seq: i + 1, factKind: 'residence', from: 'A', to: 'B', undone: false, localOnly: true, rows: [], cov: {} });
    globalThis.window = { VirtualPhone: {} };
    const app = new a2.MemoryApp(null, seededStorage({ setting_rewrite_ledger_v1: { entries: seeded } }));
    journey(app);
    app.settingImpactConfirm();
    const rows = app.settingRewriteLedger().entries;
    assert.equal(rows.length, N + 6, '破坏副本：同款判据必转红（台账没被截到上限）');
    clearWin();
});

test('F5 版本锚：五源同源 + 当版条目在场 + 迭代段条目数达标', () => {
    const pkg = JSON.parse(read('package.json'));
    const manifest = JSON.parse(read('manifest.json'));
    const log = JSON.parse(read('update-log.json'));
    const idxVer = (read(HOST_REL).match(/ST_PHONE_VERSION = '([^']+)'/) || [])[1];
    const ledger = JSON.parse(read('tests/audit/status-ledger.json'));
    const vers = [pkg.version, manifest.version, log.latest, idxVer, ledger.version];
    assert.equal(new Set(vers).size, 1, '五源版本必须一致：' + JSON.stringify(vers));
    assert.equal(log.head, log.latest, 'update-log 的 head 必须跟上 latest');
    assert.ok(Object.prototype.hasOwnProperty.call(log.versions, log.latest), '当版条目必须在 versions 里');
    /* 当版条目必须点名 R5-X6（防「抬了版却没落本版内容」）。 */
    const entry = JSON.stringify(log.versions['4.46.0']);
    assert.ok(entry.indexOf('R5-X6') >= 0, '★ 本版条目必须点名 R5-X6');
    /* 迭代段在场且条目数达标。 */
    const iter = read('tools/iter205_seg.md');
    const countOf = (s, sub) => s.split(sub).length - 1;
    assert.ok(countOf(iter, '- 【') >= 8, '迭代段条目数不足（须 ≥ 8）');
});

test('F6 ★ 历史套件的版本锚不被抬版连带转红（沿用 v4.45.0 接管口径）', () => {
    /* 负向检查必须用**去字符串**版本：被检查的套件里含同款判据自身的锚点字符串
     *   （`'log.versions[ver]'` 写在断言里）—— 只去注释会让判据自指、假红。 */
    const own = {
        v4360: '4.36.0', v4400: '4.40.0'
    };
    for (const [suite, ver] of Object.entries(own)) {
        const code = stripStrings(stripComments(read('tests/system-' + suite + '.test.mjs')));
        /* ★ 红线只在「把 ver 动态绑到 pkg.version」时才成立：那时拿 ver 索引当版条目
         *   会随抬版漂移。ver 是**字面量**（锁自己那一版）时索引无害 ——
         *   不分青红皂白地判会误伤正确写法（v4360/v4400 正是这种）。 */
        const dynBound = code.indexOf('const ver = pkg.version') >= 0;
        if (dynBound) {
            assert.ok(code.indexOf('log.versions[ver]') < 0 && code.indexOf('ul.versions[ver]') < 0,
                suite + ' 不得拿 pkg.version 去索引当版条目（抬版连带转红的根因）');
        }
        const raw = stripComments(read('tests/system-' + suite + '.test.mjs'));
        assert.ok(raw.indexOf("versions['" + ver + "']") >= 0 || raw.indexOf("ver = '" + ver + "'") >= 0,
            suite + ' 必须锁自己那一版：' + ver);
        assert.ok(raw.indexOf('pkg.version') >= 0, suite + ' 仍必须断言五源一致（跟随当前版）');
    }
    /* v4450 走的是**另一条正确接管**：一致性用 pkg.version，当版条目用 log.latest
     *   （不锁字面量）⇒ 抬版后依然成立，不得被判红。 */
    const v4450 = stripStrings(stripComments(read('tests/system-v4450.test.mjs')));
    assert.ok(v4450.indexOf('pkg.version') >= 0, 'v4450 一致性必须跟随当前版');
    assert.equal(v4450.indexOf('log.versions[pkg.version]'), -1, 'v4450 不得拿当前版去索引当版条目');
    assert.ok(v4450.indexOf('log.latest') >= 0, 'v4450 当版条目必须由 latest 给（跟随当前版）');
});
