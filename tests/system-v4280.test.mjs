/* ============================================================
 * tests/system-v4280.test.mjs -- [v4.28.0 · 第四期 R4-X4 支线结局选择与接续工作区]
 *
 * 验收口径（计划原文 R4-X4）：
 *   「选择哪条结果成为后续正史，保留其他支线供回看；不让两条互斥结局同时进入新卷。」
 *   落点与依赖：archive/memory 既有入口，接 M4-O6、M4-X3；**手机只读选择预览并转原生确认，
 *     分卷写入和撤销归上游 owner**。
 *   验收五条：① 两支线三个冲突位；② 选择部分时不能假装完成；③ 确认后新卷只读选中结局；
 *     ④ 撤回只撤本次接续，原分支原文不变；⑤ 缺上游能力显示不可用。
 *   不做三条：不把游戏存档管理重写一遍、不自动判定哪条故事更好、不暗改原聊天。
 *
 * 【修前实测的缺口（读码可复算，不是推演）】
 *   上游正史面出口齐全（选择面 v3.328.0 · M3-X6 给 branchCanonState / Decide / Plan /
 *   Preview / Revoke；落卷面 v3.342.0 · M4-X3 给 storyCanonAdoptPlan / Adoption /
 *   RevokeGuard），本仓 config/branch-contrast.js 也已能「选两分支 → 看四组语义变化」。
 *   而手机侧 `grep -RIn 'branchCanon' apps config` **零命中** ⇒「比较结局 → 选择 →
 *   创建后续」这条旅程**断在中间**。后果三件，都不是报错：
 *     ① 「还有冲突位没选」与「选了但没东西可接」在界面上**同形**（都读成「还没好」），
 *        而两者处置相反：前者该回去选，后者该去补结局条文；
 *     ② 「撤回」没有范围：没有「哪些是本次接续落的 / 哪些是原分支的 / 哪些是后来手工新增的」
 *        的分列读数，于是「撤回」很容易做成「把这个键上的条目全删」；
 *     ③ 缺上游能力时容易报成「两条结局没有冲突」——**替上游作证**（本仓最贵的老账形态）。
 *
 * 【跨仓分工（本版全部判据都建立在这条上）】
 *   冲突判定 / 计划分档 / 落卷裁决 / 撤销分表一律**走上游口径**；
 *   手机只做三件事：呈现（四档分列 + 三态不压平 + 四表分列）、起点持有（用户显式选择）、
 *   凭据转交（原样派发 `phone:canonAdopt`，**零写盘**）。故「不自动判定哪条故事更好」
 *   「不暗改原聊天」在本套件里是**可判的**：读数里不许出现第二份判定词 / 第二份标签表 /
 *   推荐评分一族键（深度扫描，真跑）。
 *
 * 判据面（五组）：
 *   A 口径：五态两两不同形 / 纯契约零副作用 / 出口名与状态字面量唯一出现点 /
 *          视图不直呼内核 / 禁用键清单在场
 *   B 内核行为：五态分形逐态 / 四档决定穷尽 / 落卷三态**不许压平** / 缺格三因分列 /
 *              撤销四表分列且两条口径写成读数 / 判定词只在 canonGateOf 一处 / 自检真跑
 *   C 接线行为：真接线件 + 真 App + 假宿主走完整旅程（未装插件 → 装插件 → 取包 →
 *              设选位 → 换会话作废 → 真视图渲染与绑定 → 确认派发零写盘）
 *   D 负控制：真源码定点破坏 ⇒ 同款判据必转红（每条配原版必真的反向对照）
 *   E 版本锚：五源同源
 *
 * 【为什么负控制破坏副本而不是原仓】见 tests/system-v4120.test.mjs 档头（同规）。
 * 【为什么自检里也要真跑判据】数常量只能证明表在，不能证明**判得对**。
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
const KERNEL_REL = 'config/branch-canon-contract.js';
const WIRE_REL = 'apps/archive/archive-canon.js';
const APP_REL = 'apps/archive/archive-app.js';
const VIEW_REL = 'apps/archive/archive-view.js';
const K = await import(pathToFileURL(path.join(ROOT, KERNEL_REL)).href);
const WIRE = await import(pathToFileURL(path.join(ROOT, WIRE_REL)).href);
const APP = await import(pathToFileURL(path.join(ROOT, APP_REL)).href);
const VIEW = await import(pathToFileURL(path.join(ROOT, VIEW_REL)).href);
const kernelSrc = read(KERNEL_REL);
const wireSrc = read(WIRE_REL);
const appSrc = read(APP_REL);
const viewSrc = read(VIEW_REL);
const S = K.BC_STATES;
const countOf = (hay, needle) => hay.split(needle).length - 1;
/** 去注释（块注释 + 整行注释）：判据只认代码，不认注释里的自述。 */
const stripAll = (s) => s
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split(NL).filter((l) => !/^\s*\/\//.test(l)).join(NL);
/* 本面独有的状态字面量：**只许契约件一份**（接线层零命中）。
 *   ★ `'ok'` / `'empty'` 不进这一档：它们与别处通用词同字（算进来是误报）。 */
const KERNEL_ONLY = ["'engine-absent'", "'face-absent'", "'unusable'", "'no-deps'",
    "'pending-unresolved'", "'no-adoptable-items'", "'no-scope'", "'both-terminal'", "'divergent'"];
/* ══════════ 假件 ══════════ */
/** storage 假件：只实现存档台数据层用到的 get/set。 */
function mkStorage() {
    const mem = new Map();
    return {
        _mem: mem,
        get: (k, d) => (mem.has(k) ? mem.get(k) : d),
        set: (k, v) => { mem.set(k, v); },
        version: '1.19.0'
    };
}
/** 假宿主 window 的安装/还原（必须 async-aware）。 */
const withWin = async (obj, fn) => {
    const backup = Object.getOwnPropertyDescriptor(globalThis, 'window');
    globalThis.window = obj;
    try { return await fn(); } finally {
        if (backup) Object.defineProperty(globalThis, 'window', backup);
        else delete globalThis.window;
    }
};
/** 上游假件：两个冲突位（一个真冲突 + 一个单选位），一个未选尽的计划。 */
function mkUp(over) {
    const o = over || {};
    const engine = {
        branchCanonState: () => ({
            kind: 'branch_canon', version: 2, ok: true, judged: true,
            groups: 2, blocked: 1, unkeyed: 0, total: 3,
            rows: [
                { key: 'k1', verdict: 'both-terminal', branches: ['b1', 'b2'], titles: ['甲', '乙'],
                    terminalCount: 2, terminalUnknown: 0, count: 2 },
                { key: 'k2', verdict: 'single', branches: ['b1'], titles: ['丙'],
                    terminalCount: 1, terminalUnknown: 0, count: 1 }
            ]
        }),
        branchCanonPlan: () => ({
            kind: 'branch_canon_plan', version: 2, ok: true, judged: true, preview: 'blocked',
            chosen: [{ key: 'k1', branch: 'b1', title: '甲', slot: 's1', floor: 3 }],
            coexisted: [], excluded: [],
            pending: [{ key: 'k2', verdict: 'pending-confirm', branches: ['b1'] }],
            provenance: [
                { key: 'k1', branch: 'b1', verdict: 'chosen', why: '选甲' },
                { key: 'k1', branch: 'b2', verdict: 'excluded', why: 'unselected-sibling' }
            ]
        }),
        branchCanonPreview: () => ({
            kind: 'branch_canon_handoff', version: 2, ok: false, judged: true, preview: 'blocked',
            pack: null, chosenCount: 1, coexistedCount: 0, excludedCount: 1,
            pendingCount: 1, keeperUnknown: false, masked: 0
        }),
        branchCanonRevoke: () => ({
            kind: 'branch_canon_revoke', version: 2, scope: 'handoff-only', branchWrites: 0,
            volumeId: 'v1', packId: '', keys: ['k1'], count: 1
        }),
        storyCanonAdoptPlan: () => ({
            kind: 'branch_canon_adoption', version: 2, ok: true, judged: true,
            verdict: 'ready', reason: '', adoptionId: 'ca_1', volumeId: 'v1',
            pendingCount: 0, pending: [], pack: { packId: 'cp_1', volumeId: 'v1', entryCount: 1 },
            items: [{ face: 'unfinished', key: 'q1', ownerKey: 'id:c1', link: 'by-id', from: 3,
                scope: null, value: '等她回来', sensitive: false,
                canonRef: { collision: 'k1', branch: 'b1', source: 'chosen' } }],
            unmapped: [{ key: 'k2', face: '', ownerKey: '', why: 'no-face', branch: 'b1', source: 'x' }],
            bareOutcomes: [{ key: 'k3', branch: 'b1', title: '丁', why: 'no-items' }]
        }),
        storyCanonAdoption: () => ({
            kind: 'branch_canon_adoption', version: 2, judged: true, adoptionId: 'ca_1',
            verdict: 'ready', preview: 'warn', volumeId: 'v1', packId: 'cp_1',
            itemCount: 1, unmappedCount: 1, bareCount: 1, pendingCount: 0, persisted: false,
            revokeScope: { adoptionId: 'ca_1', packId: 'cp_1', volumeId: 'v1' }, writeNothing: true
        }),
        storyCanonRevokeGuard: () => ({
            kind: 'branch_canon_adoption_revoke_guard', version: 2, judged: true,
            scope: { adoptionId: 'ca_1', packId: 'cp_1', volumeId: 'v1' },
            revocable: [{ key: 'q1', face: 'unfinished', ownerKey: 'id:c1', packId: 'cp_1',
                why: 'in-scope', importedAt: 5 }],
            keptForeign: [{ key: 'q9', face: 'unfinished', ownerKey: 'id:c9', packId: 'cp_9',
                why: 'other-adoption-scope' }],
            keptManual: [{ key: 'm1', face: 'unfinished', ownerKey: 'id:c3', packId: null,
                why: 'no-source-scope' }],
            keptLater: [], revocableCount: 1, foreignCount: 1, manualCount: 1, laterCount: 0,
            deletesManual: false, branchWrites: 0
        })
    };
    return { LonShaMemory: { engine: Object.assign(engine, o.enginePatch || {}) } };
}
/** 真 App + 假存储（宿主 window 由 withWin 装）。 */
function mkApp(win, storage) {
    const shell = { getContentContainer: () => null, showNotification: () => {} };
    return new APP.ArchiveApp(shell, storage || mkStorage());
}
/** 接线件的 App 假件（只提供它真正用到的面）。 */
function fakeApp(win) {
    return {
        _win: () => win,
        canonDecisionIds: () => K.BC_DECISIONS.slice(),
        canonDecisionLabel: (d) => K.BC_DECISION_LABEL[d] || '',
        canonClashLabel: (v) => K.BC_CLASH_LABEL[v] || '',
        canonAdoptLabel: (v) => K.BC_ADOPT_LABEL[v] || '',
        canonProvLabel: (v) => K.BC_PROVENANCE_LABEL[v] || '',
        canonUnmappedLabel: (v) => K.BC_UNMAPPED_LABEL[v] || '',
        canonRevokeLabel: (v) => K.BC_REVOKE_LABEL[v] || '',
        canonStateHint: (s) => K.BC_STATE_HINT[s] || '',
        canonGate: (r) => K.canonGateOf(r),
        canonNote: (r) => K.canonNoteOf(r)
    };
}
/** 最小 DOM 替身（视图绑定用）。 */
function mkEl(sel, val) {
    const ls = {};
    return {
        sel: sel, val: val, _ls: ls,
        addEventListener: (t, fn) => { (ls[t] || (ls[t] = [])).push(fn); },
        getAttribute: (n) => (n === 'data-key' || n === 'data-act') ? val : val,
        fire: (t) => { for (const fn of (ls[t] || [])) fn({ target: { value: val } }); }
    };
}
function mkContainer(width, els) {
    const list = els || [];
    const hit = (x, sel) => (sel.charAt(0) === '[' ? x.sel === sel.slice(1, -1) : x.sel === sel);
    const c = {
        _html: '', clientWidth: width, _list: list,
        addEventListener: () => {},
        querySelector: (sel) => list.filter((x) => hit(x, sel))[0] || null,
        querySelectorAll: (sel) => list.filter((x) => hit(x, sel))
    };
    Object.defineProperty(c, 'innerHTML', {
        get() { return this._html; },
        set(v) {
            this._html = v;
            for (const x of list) for (const k of Object.keys(x._ls || {})) x._ls[k].length = 0;
        }
    });
    return c;
}
const NL = String.fromCharCode(10);
/* ══════════ A ── 口径 ══════════ */
test('A1 五态两两不同形（没装插件 ≠ 面不在场 ≠ 读不出 ≠ 真读数空 ≠ 读到）', () => {
    const vals = Object.keys(S).map((k) => S[k]);
    assert.equal(new Set(vals).size, vals.length, '状态各格必须互不相同');
    assert.notEqual(S.ENGINE_ABSENT, S.EMPTY, '「插件不在场」与「真读数无内容」必须不同形');
    assert.notEqual(S.FACE_ABSENT, S.ENGINE_ABSENT, '「这一面不在场」与「插件不在场」必须不同形');
    assert.notEqual(S.UNUSABLE, S.EMPTY, '「本机读不出」与「真读数无内容」必须不同形');
    assert.notEqual(S.OK, S.EMPTY, '「读到」与「真读数无内容」必须不同形');
    assert.equal(vals.length, 5, '五态口径必须五项');
});
test('A2 纯契约零副作用：不碰 DOM / 存储 / 网络 / 时钟，且只依赖唯一取数门', () => {
    for (const bad of ['localStorage', 'sessionStorage', 'document.', 'fetch(',
        'XMLHttpRequest', 'Date.now', 'Math.random', 'setTimeout', 'setInterval',
        'innerHTML', 'writeFile', 'process.env']) {
        assert.equal(countOf(kernelSrc, bad), 0, '契约件不得出现 ' + bad);
    }
    const imports = (kernelSrc.match(/^import .*$/gm) || []);
    assert.equal(imports.length, 1, '契约件只许一条静态导入');
    assert.ok(imports[0].indexOf('num-gate.js') >= 0, '唯一导入必须是 config/num-gate.js');
    assert.equal(countOf(kernelSrc, "from './num-gate.js'"), 1);
    assert.equal(K.readBranchCanonState(mkUp()).writesNothing, true);
    assert.equal(K.readBranchCanonAdopt(mkUp()).writesNothing, true);
    assert.equal(K.readBranchCanonRevokeGuard(mkUp()).writesNothing, true);
});
test('A3 出口名与状态字面量唯一出现点：改一处即全仓同改', () => {
    const outlets = ['readBranchCanonState', 'readBranchCanonPlan', 'readBranchCanonPreview',
        'readBranchCanonAdopt', 'readBranchCanonAdoption', 'readBranchCanonRevokeGuard',
        'readBranchCanonRevokeScope', 'canonLine', 'planLine', 'adoptLine', 'revokeLine',
        'canonGateOf', 'canonNoteOf', 'bcSelfCheck',
        'BC_STATES', 'BC_DECISIONS', 'BC_PROVENANCE', 'BC_ADOPT', 'BC_CLASH',
        'BC_UNMAPPED', 'BC_REVOKE_BUCKETS', 'BC_FORBIDDEN_KEYS', 'BC_STATE_HINT', 'BC_FACE_ID'];
    for (const name of outlets) {
        assert.ok(countOf(kernelSrc, name) >= 2, '出口 ' + name + ' 必须定义并进 default');
        const inDefault = countOf(kernelSrc, '    ' + name + ',') + countOf(kernelSrc, '    ' + name + NL + '};');
        assert.ok(inDefault >= 1, '出口 ' + name + ' 必须进 default export');
    }
    const wiringAll = wireSrc + appSrc + viewSrc;
    for (const lit of KERNEL_ONLY) {
        assert.equal(countOf(wiringAll, lit), 0, '接线层不得再写判定词 ' + lit);
    }
});
test('A4 视图不直呼内核：判定全由 App 转交', () => {
    assert.equal(countOf(viewSrc, 'branch-canon-contract.js'), 0, '视图不得 import 契约件');
    for (const fn of ['readBranchCanonState(', 'readBranchCanonPlan(', 'readBranchCanonPreview(',
        'readBranchCanonAdopt(', 'readBranchCanonAdoption(', 'readBranchCanonRevokeGuard(',
        'readBranchCanonRevokeScope(', 'canonLine(', 'planLine(', 'adoptLine(', 'revokeLine(',
        'canonGateOf(', 'canonNoteOf(']) {
        assert.equal(countOf(viewSrc, fn), 0, '视图不得直呼内核函数 ' + fn);
    }
    for (const fn of ['canonPack(', 'canonGate(', 'canonNote(', 'canonStateHint(',
        'canonDecisionIds(', 'canonDecisionLabel(', 'canonClashLabel(', 'canonAdoptLabel(',
        'canonProvLabel(', 'canonUnmappedLabel(', 'canonRevokeLabel(', 'canonRevokeBuckets(']) {
        assert.ok(countOf(viewSrc, fn) >= 1, '视图必须经 App 出口取数：' + fn);
    }
    /* ★ 视图不许自己写第二份表名表：撤销四张表的表名只许在核心里一份。
     *   本版判据当场抓到过一例（视图手写了整份四表表名），已由 patch_x4m 收回内核 ——
     *   这一条把「收回」变成跑不掉的约束，连注释里也不许留。
     *   （四档决定同理：视图按内核 id 取，不写第二份顺序表。） */
    for (const lit of ['别批（', '手工补的（', '后来加的']) {
        assert.equal(countOf(viewSrc, lit), 0, '视图不得再写第二份四表表名：' + lit);
    }
    /* 反向对照：视图里那句「手工补的事实绝不删」是**说明句**不是表名表 ——
     *   判据只认「表名（」这一形态，免得把说明句误判成第二份表。
     *   （第一版按裸词判，当场把说明句判成红 —— 判据方向对了，粒度写粗了。） */
    assert.ok(countOf(viewSrc, '手工补的事实') >= 1, '说明句必须在场（上一条判的不是空判据）');
});
test('A5 禁用键清单在场且非空：读数里不得出现推荐 / 评分一族', () => {
    const keys = K.BC_FORBIDDEN_KEYS;
    assert.ok(Array.isArray(keys) && keys.length >= 5);
    for (const k of ['better', 'best', 'score', 'rank', 'percent', 'confidence']) {
        assert.ok(keys.indexOf(k) >= 0, '禁用键必须含 ' + k);
    }
    const scan = (v, hits) => {
        if (v === null || v === undefined) return hits;
        if (Array.isArray(v)) { for (const it of v) scan(it, hits); return hits; }
        if (typeof v !== 'object') return hits;
        for (const k of Object.keys(v)) {
            if (keys.indexOf(String(k).toLowerCase()) >= 0) hits.push(k);
            scan(v[k], hits);
        }
        return hits;
    };
    const hits = scan([K.readBranchCanonState(mkUp()), K.readBranchCanonPlan(mkUp()),
        K.readBranchCanonPreview(mkUp()), K.readBranchCanonAdopt(mkUp()),
        K.readBranchCanonAdoption(mkUp()), K.readBranchCanonRevokeGuard(mkUp()),
        K.readBranchCanonRevokeScope(mkUp())], []);
    assert.deepEqual(hits, [], '读数里出现禁用键：' + hits.join('/'));
});
/* ══════════ B ── 内核行为 ══════════ */
test('B1 五态分形逐态实测（装配未到归 no-deps，不读成「零冲突位」）', () => {
    assert.equal(K.readBranchCanonState(null).state, S.ENGINE_ABSENT);
    assert.equal(K.readBranchCanonState(mkUp({ enginePatch: { branchCanonState: () => ({ version: 0 }) } })).state, S.FACE_ABSENT);
    assert.equal(K.readBranchCanonState(mkUp({ enginePatch: { branchCanonState: () => { throw new Error('x'); } } })).state, S.UNUSABLE);
    const nodeps = K.readBranchCanonState(mkUp({ enginePatch: { branchCanonState: () => ({ version: 2, judged: false, rows: [] }) } }));
    assert.equal(nodeps.state, S.UNUSABLE, '装配未到必须走不可读');
    assert.equal(nodeps.reason, 'no-deps', '装配未到单独一格');
    assert.equal(K.canonLine(nodeps).indexOf('冲突位 0'), -1, '装配未到不得读成「冲突位 0」');
    assert.equal(K.readBranchCanonState(mkUp({ enginePatch: { branchCanonState: () => ({ version: 2, judged: true, rows: [] }) } })).state, S.EMPTY);
    assert.equal(K.readBranchCanonState(mkUp()).state, S.OK);
    assert.equal(K.readBranchCanonState(null).degraded, true);
    assert.equal(K.readBranchCanonState(null).silentCapable, false);
    assert.equal(K.readBranchCanonState(mkUp()).silentCapable, true);
    assert.equal(K.readBranchCanonState(mkUp({ enginePatch: { branchCanonState: () => ({ version: 2, judged: true, rows: [] }) } })).silentCapable, true,
        '真跑过零冲突位也算「能替沉默作证」');
});
test('B2 冲突档与四档决定穷尽：逐位列出，未被选中的留痕', () => {
    const st = K.readBranchCanonState(mkUp());
    assert.equal(st.state, S.OK);
    assert.equal(st.clash.length, 2);
    assert.equal(st.clash[0].verdict, 'both-terminal', '真冲突档必须原样搬上游 verdict');
    assert.equal(st.clash[1].verdict, 'single');
    assert.equal(st.counts.blocked, 1, '未选尽的冲突位单独计数');
    assert.equal(st.counts.clashes, 2);
    const pl = K.readBranchCanonPlan(mkUp());
    assert.equal(pl.state, S.OK);
    assert.equal(pl.reason, 'pending-unresolved', '还有未选尽 ⇒ 单独归因');
    assert.deepEqual(pl.chosen.map((x) => x.key), ['k1']);
    assert.deepEqual(pl.pendingList.map((x) => x.key), ['k2']);
    assert.equal(pl.provenance.length, 2, '未被选中的历史必须留痕');
    assert.equal(pl.provenance[1].verdict, 'excluded');
    assert.equal(K.BC_DECISIONS.length, 4, '四档决定必须穷尽四项');
    assert.deepEqual(K.BC_DECISIONS.slice(), ['canon', 'coexist', 'exclude', 'unset']);
});
test('B3 落卷三态**不许压平**：blocked 与 empty 处置相反', () => {
    const ready = K.readBranchCanonAdopt(mkUp());
    assert.equal(ready.verdict, 'ready');
    assert.equal(ready.reason, '', '可接续就不该有归因');
    assert.equal(ready.adoptionId, 'ca_1', '幂等键必须原样搬');
    const blocked = K.readBranchCanonAdopt(mkUp({ enginePatch: {
        storyCanonAdoptPlan: () => ({ version: 2, judged: true, verdict: 'blocked', adoptionId: '',
            pendingCount: 1, pending: [{ key: 'k2', verdict: 'pending-confirm' }],
            pack: null, items: [], unmapped: [], bareOutcomes: [] }) } }));
    assert.equal(blocked.reason, 'pending-unresolved', '未选尽单独归因');
    const empty = K.readBranchCanonAdopt(mkUp({ enginePatch: {
        storyCanonAdoptPlan: () => ({ version: 2, judged: true, verdict: 'empty', adoptionId: 'ca_2',
            pendingCount: 0, pending: [], pack: null, items: [], unmapped: [],
            bareOutcomes: [{ key: 'k9', branch: 'b1', title: '戊', why: 'no-items' }] }) } }));
    assert.equal(empty.reason, 'no-adoptable-items', '无可接条目单独归因');
    assert.notEqual(empty.reason, blocked.reason, 'empty 与 blocked 的归因不得同形');
    assert.notEqual(K.canonNoteOf(empty), K.canonNoteOf(blocked), '两态的说明不得同形');
    assert.equal(new Set(K.BC_ADOPT).size, 3, '落卷三态必须三态不同形');
});
test('B4 缺格三因分列（压成一条就不知道该补哪一格）', () => {
    const w = mkUp({ enginePatch: { storyCanonAdoptPlan: () => ({ version: 2, judged: true,
        verdict: 'empty', adoptionId: 'ca_3', pendingCount: 0, pending: [], pack: null, items: [],
        unmapped: [
            { key: 'kA', face: '', ownerKey: '', why: 'no-face' },
            { key: 'kB', face: 'unfinished', ownerKey: '', why: 'no-owner' },
            { key: 'kC', face: 'unfinished', ownerKey: 'id:c', why: 'no-key' }
        ], bareOutcomes: [] }) } });
    const r = K.readBranchCanonAdopt(w);
    const whys = new Set(r.unmapped.map((u) => u.why));
    assert.ok(whys.has('no-face') && whys.has('no-owner') && whys.has('no-key'), '三因必须分列');
    assert.equal(K.BC_UNMAPPED.length, 3);
    for (const x of r.unmapped) assert.ok(K.BC_UNMAPPED_LABEL[x.why], '每因必须有各自标签：' + x.why);
});
test('B5 撤销四表分列 + 两条口径写成读数（不靠注释承诺）', () => {
    const rg = K.readBranchCanonRevokeGuard(mkUp());
    const rv = rg.revoke;
    assert.equal(rv.revocableCount, 1);
    assert.equal(rv.foreignCount, 1);
    assert.equal(rv.manualCount, 1);
    assert.equal(rv.laterCount, 0);
    assert.equal(rv.deletesManual, false, '手工补的事实绝不因撤销而消失');
    assert.equal(rv.branchWrites, 0, '原分支零写');
    assert.equal(K.BC_REVOKE_BUCKETS.length, 4, '撤销四张表口径必须四项');
    for (const b of K.BC_REVOKE_BUCKETS) assert.ok(Array.isArray(rv[b]), '四张表必须分列：' + b);
    const line = K.revokeLine(rg);
    assert.ok(line.indexOf('手工') >= 0, '一行读数必须把「必须留住」的表报出来');
    assert.ok(line.indexOf('原分支零写 0') >= 0, '原分支零写必须进读数');
});
test('B6 无范围单独一格：不可撤销，且不许「全删」兜底', () => {
    const w = mkUp({ enginePatch: { storyCanonRevokeGuard: () => ({ version: 2, judged: false,
        scope: { adoptionId: '', packId: '', volumeId: '' }, revocable: [], keptForeign: [],
        keptManual: [], keptLater: [] }) } });
    const r = K.readBranchCanonRevokeGuard(w);
    assert.equal(r.reason, 'no-scope', '没范围单独一格');
    assert.ok(K.canonNoteOf(r).indexOf('全删') >= 0, '说明必须点明「不许全删兜底」');
});
test('B7 凭据面：幂等键与撤销范围在确认之前就定下（本件不提交）', () => {
    const ao = K.readBranchCanonAdoption(mkUp());
    assert.equal(ao.adoptionId, 'ca_1');
    assert.equal(ao.scope.adoptionId, 'ca_1');
    assert.equal(ao.scope.packId, 'cp_1');
    assert.equal(ao.scope.volumeId, 'v1');
    /* ★ 本件绝不传 commit：落笔归上游 owner。
     *   ★ 判据只认代码、不认注释里的自述（本仓旧病：注释里的名字被当成代码判）。
     *   第一版直接数原文，命中的是契约件第 582 行那句「本件不提交（commit 恒不传）」——
     *   判据被注释养着，真代码里多一个 commit 反而不会响。 */
    assert.equal(countOf(stripAll(kernelSrc), 'commit'), 0,
        '契约件代码里不得出现 commit（本件不提交）');
    assert.ok(countOf(kernelSrc, 'commit') >= 1,
        '双向对照：注释里确实提到过 commit（说明上一条判的不是空判据）');
});
test('B8 canonGateOf：读到走 readable=true / 读不到 hint 必非空 / 未知态也走不可读', () => {
    const gOk = K.canonGateOf(K.readBranchCanonState(mkUp()));
    assert.equal(gOk.readable, true);
    assert.equal(gOk.hint, '');
    const gAbsent = K.canonGateOf(K.readBranchCanonState(null));
    assert.equal(gAbsent.readable, false);
    assert.ok(gAbsent.hint.length > 0);
    const gNodeps = K.canonGateOf({ state: S.UNUSABLE, reason: 'no-deps' });
    assert.equal(gNodeps.readable, false);
    assert.ok(gNodeps.hint.indexOf('装配') >= 0, 'no-deps 的建议必须指向宿主装配，不是「去装插件」');
    const gWeird = K.canonGateOf({ state: 'some-future-state' });
    assert.equal(gWeird.readable, false, '未知态也必须走不可读');
    assert.ok(gWeird.hint.length > 0);
});
test('B9 自检真跑判据（不是数常量）', () => {
    const sc = K.bcSelfCheck();
    assert.deepEqual(sc.problems, [], '自检必须零问题：' + (sc.problems || []).join('/'));
});
/* ══════════ C ── 接线行为 ══════════ */
/** 真根元素替身（视图 render 会 document.createElement 建自己那棵子树）。 */
function mkRootEl(els) {
    const list = els || [];
    const hit = (x, sel) => (sel.charAt(0) === '[' ? x.sel === sel.slice(1, -1) : x.sel === sel);
    const r = {
        className: '', _html: '', clientWidth: 375,
        addEventListener: () => {}, appendChild: () => {},
        querySelector: (sel) => list.filter((x) => hit(x, sel))[0] || null,
        querySelectorAll: (sel) => list.filter((x) => hit(x, sel))
    };
    Object.defineProperty(r, 'innerHTML', {
        get() { return this._html; },
        set(v) {
            this._html = v;
            for (const x of list) for (const k of Object.keys(x._ls || {})) x._ls[k].length = 0;
        }
    });
    return r;
}
/** 装一个最小 document（只提供 createElement）；退场时按描述符还原。 */
const withDom = async (els, fn) => {
    const backup = Object.getOwnPropertyDescriptor(globalThis, 'document');
    globalThis.document = { createElement: () => mkRootEl(els || []) };
    try { return await fn(); } finally {
        if (backup) Object.defineProperty(globalThis, 'document', backup);
        else delete globalThis.document;
    }
};
/** 带属性的按钮/输入替身（data-act 与 data-key 必须各归各的，不能同值）。 */
function mkBtn(attrs, sel) {
    const ls = {};
    return {
        _attrs: attrs || {}, _ls: ls, sel: sel || 'data-act',
        addEventListener: (t, fn) => { (ls[t] || (ls[t] = [])).push(fn); },
        getAttribute: (n) => (n in (attrs || {}) ? attrs[n] : null),
        fire: (t) => { for (const fn of (ls[t] || [])) fn({ preventDefault() {} }); }
    };
}
/** 宿主容器替身：render 会 createElement 建**自己那棵子树**再 appendChild 进来。
 *   ★ 不能只给一个 { innerHTML: '' }：那样 render 在 appendChild 上直接抛，
 *     判据根本没跑到（本版实测踩过）。 */
function mkHostBox() {
    const box = { _root: null, _html: '' };
    box.appendChild = (el) => { box._root = el; };
    Object.defineProperty(box, 'innerHTML', {
        get() { return box._root ? box._root.innerHTML : box._html; },
        set(v) { box._html = v; if (box._root) box._root.innerHTML = v; }
    });
    return box;
}
/** 真 App + 真视图 + 假宿主壳（容器口给得出容器，才进得了 render）。 */
function mkAppFull(storage, container) {
    const shell = { getContentContainer: () => container, showNotification: () => {} };
    return new APP.ArchiveApp(shell, storage || mkStorage());
}
test('C1 未装插件：如实报「读不出」，且不画冲突位按钮（不拿空板冒充）', async () => {
    const store = mkStorage();
    const container = mkHostBox();
    await withWin({}, async () => {
        await withDom([], async () => {
            const app = mkAppFull(store, container);
            app.setTab('canon');
            app.render();
            const p = app.canonPack();
            assert.equal(p.state.state, S.ENGINE_ABSENT);
            assert.equal(p.state.degraded, true);
            assert.equal(p.state.silentCapable, false, '没装插件不许替沉默作证');
            assert.equal(app.canonGate(p.state).readable, false);
            const html = app._view._root.innerHTML;
            assert.ok(html.indexOf('支线结局与接续') >= 0, '页签标题必须在场');
            assert.ok(html.indexOf('读不出') >= 0, '未装插件必须如实报读不出');
            assert.equal(countOf(html, 'pick_canon_slot'), 0, '读不到时不许画选位按钮');
            assert.equal(countOf(html, 'canon_confirm'), 0, '读不到时不许画确认按钮');
        });
    });
});
test('C2 装插件走完整旅程：六面同源 + 四行读数非空', async () => {
    const store = mkStorage();
    await withWin(mkUp(), async () => {
        const app = mkAppFull(store, mkHostBox());
        const p = app.canonPack();
        for (const k of ['state', 'plan', 'preview', 'adopt', 'adoption', 'revoke']) {
            assert.equal(p[k].state, S.OK, '六面同源：' + k + ' 必须同为读到');
        }
        for (const k of ['canon', 'plan', 'adopt', 'revoke']) {
            assert.ok(String(p.lines[k]).length > 0, '四行读数不得为空：' + k);
        }
        assert.equal(p.slot, '', '初始无选位');
        assert.equal(p.state.writesNothing, true);
        /* 装配未到（judged:false）走 no-deps，不读成「零冲突位」——接线件同样透传。 */
        const nodeps = mkAppFull(store, mkHostBox());
        await withWin(mkUp({ enginePatch: { branchCanonState: () => ({ version: 2, judged: false, rows: [] }) } }), async () => {
            const q = nodeps.canonPack();
            assert.equal(q.state.state, S.UNUSABLE);
            assert.equal(q.state.reason, 'no-deps');
            assert.equal(nodeps.canonGate(q.state).readable, false);
        });
        void app;
    });
});
test('C3 设选位：用户显式选择，空值即清空（不回落成默认第一位）', async () => {
    const store = mkStorage();
    await withDom([], async () => {
        await withWin(mkUp(), async () => {
            const app = mkAppFull(store, mkHostBox());
            assert.equal(app.canonSlot(), '');
            assert.equal(app.setCanonSlot('k1'), 'k1');
            assert.equal(app.canonSlot(), 'k1');
            assert.equal(app.canonPack().slot, 'k1');
            app.setTab('canon');
            app.render();
            let html = app._view._root.innerHTML;
            assert.ok(html.indexOf('已选这一位') >= 0, '选中位必须画成「已选」');
            assert.ok(html.indexOf('k1') >= 0, '选中位必须在场');
            /* 空值即清空：清空后**不许**回落到「第一位」。 */
            app.setCanonSlot('');
            assert.equal(app.canonSlot(), '', '空值即清空');
            app.render();
            html = app._view._root.innerHTML;
            assert.ok(html.indexOf('（还没选）') >= 0, '清空后必须如实报「还没选」');
            assert.equal(countOf(html, '已选这一位'), 0, '清空后不许再有「已选」');
        });
    });
});
test('C4 换会话作废选位（读数本来就不缓存，只有选位要清）', async () => {
    const store = mkStorage();
    await withWin(mkUp(), async () => {
        const app = mkAppFull(store, mkHostBox());
        app.setCanonSlot('k1');
        assert.equal(app.canonSlot(), 'k1');
        app.onChatChanged();
        assert.equal(app.canonSlot(), '', '换会话必须作废选位');
        assert.equal(app.tab(), 'pack', '换会话回兜底页');
    });
});
test('C5 真视图绑定：选位与清位都经 App 出口（视图不自己记）', async () => {
    const store = mkStorage();
    const pick = mkBtn({ 'data-act': 'pick_canon_slot', 'data-key': 'k1' });
    const clear = mkBtn({ 'data-act': 'clear_canon_slot' });
    await withDom([pick, clear], async () => {
        await withWin(mkUp(), async () => {
            const app = mkAppFull(store, mkHostBox());
            app.setTab('canon');
            app.render();
            const calls = [];
            const realSet = app.setCanonSlot.bind(app);
            app.setCanonSlot = (v) => { calls.push(String(v)); return realSet(v); };
            pick.fire('click');
            assert.deepEqual(calls, ['k1'], '选位必须经 App 出口');
            assert.equal(app.canonSlot(), 'k1');
            clear.fire('click');
            assert.deepEqual(calls, ['k1', ''], '清位必须经 App 出口');
            assert.equal(app.canonSlot(), '');
        });
    });
});
test('C6 真视图渲染：四行读数 + 三态不压平 + 四表分列同屏可辨', async () => {
    const store = mkStorage();
    await withDom([], async () => {
        await withWin(mkUp(), async () => {
            const app = mkAppFull(store, mkHostBox());
            app.setTab('canon');
            app.render();
            const html = app._view._root.innerHTML;
            assert.ok(html.indexOf('四行读数') >= 0, '四行读数区必须在场');
            for (const k of ['结局', '选择', '落卷', '撤回']) {
                assert.ok(html.indexOf(k) >= 0, '读数行必须在场：' + k);
            }
            assert.ok(html.indexOf('未选尽') >= 0, '落卷三态必须报出「未选尽」');
            assert.ok(html.indexOf('撤回会动到哪些') >= 0, '四表分列区必须在场');
            /* 四张表的表名一律来自内核（视图不得手写第二份）——渲染出来的就是内核那四句。 */
            for (const b of K.BC_REVOKE_BUCKETS) {
                assert.ok(html.indexOf(K.BC_REVOKE_LABEL[b]) >= 0, '四表表名必须在场：' + b);
            }
            assert.ok(html.indexOf('原分支零写 0') >= 0, '两条口径必须进版面');
            assert.ok(html.indexOf('绝不删') >= 0, '手工补的事实必须明写留住');
            /* 四档决定的名字同样来自内核。 */
            for (const d of K.BC_DECISIONS) {
                assert.ok(html.indexOf(K.BC_DECISION_LABEL[d]) >= 0, '四档名字必须在场：' + d);
            }
        });
    });
});
test('C7 确认派发：把上游给的凭据原样转出去，本件零写盘', async () => {
    const store = mkStorage();
    const seen = [];
    const win = mkUp();
    win.CustomEvent = function (name, opt) { this.type = name; this.detail = (opt || {}).detail; };
    win.dispatchEvent = (ev) => { seen.push(ev); return true; };
    const btn = mkBtn({ 'data-act': 'canon_confirm' });
    await withDom([btn], async () => {
        await withWin(win, async () => {
            const app = mkAppFull(store, mkHostBox());
            app.setTab('canon');
            app.render();
            const before = JSON.stringify(Array.from(store._mem.entries()));
            btn.fire('click');
            const after = JSON.stringify(Array.from(store._mem.entries()));
            assert.equal(seen.length, 1, '必须派发一次确认事件');
            assert.equal(seen[0].type, 'phone:canonAdopt');
            assert.equal(seen[0].detail.adoptionId, 'ca_1', '凭据必须原样转出');
            assert.equal(seen[0].detail.packId, 'cp_1');
            assert.equal(seen[0].detail.volumeId, 'v1');
            assert.equal(after, before, '★ 本件零写盘：确认不得动存储一个字节');
        });
    });
});
test('C8 凭据没定就不派发（不拿空范围去确认）', async () => {
    const store = mkStorage();
    const seen = [];
    const win = mkUp({ enginePatch: { storyCanonAdoption: () => ({ version: 2, judged: true, adoptionId: '', packId: '', volumeId: '', pendingCount: 0, revokeScope: {} }) } });
    win.CustomEvent = function (name, opt) { this.type = name; this.detail = (opt || {}).detail; };
    win.dispatchEvent = (ev) => { seen.push(ev); return true; };
    const btn = mkBtn({ 'data-act': 'canon_confirm' });
    await withDom([btn], async () => {
        await withWin(win, async () => {
            const app = mkAppFull(store, mkHostBox());
            app.setTab('canon');
            app.render();
            btn.fire('click');
            assert.equal(seen.length, 0, '★ 没有凭据时**一个事件都不许派发**');
        });
    });
});
test('C9 本版三条「不做」在代码上可判', async () => {
    const all = stripAll(kernelSrc + wireSrc + appSrc + viewSrc);
    for (const bad of ['betterThan', 'scoreOf', 'rankOf', 'priorityOf', 'commitConfirm',
        'autoPick', 'secondCanonTable']) {
        assert.equal(countOf(all, bad), 0, '本版不得引入 ' + bad);
    }
    /* 反向对照：禁用键表**本身**就得把这些词写出来（不然 A5 扫什么）——
     *   判据不许它们出现在**读数生成路径**，而不是不许它们在契约件里存在。 */
    for (const k of K.BC_FORBIDDEN_KEYS) {
        assert.equal(countOf(kernelSrc, "'" + k + "'"), 1, '禁用键只许在表里一处：' + k);
    }
    /* 不自动判定哪条更好：接线层与视图都不得写第二份判定词。 */
    assert.equal(countOf(wireSrc, 'BC_STATES.'), 0, '接线件不得比状态字面量');
    assert.equal(countOf(viewSrc, 'BC_STATES.'), 0, '视图不得比状态字面量');
    /* 不暗改原聊天：契约件与接线件都不得出现写口。 */
    for (const bad of ['setItem', 'writeFile', 'localStorage', 'sessionStorage']) {
        assert.equal(countOf(kernelSrc + wireSrc, bad), 0, '零写面不得出现 ' + bad);
    }
});
/* ══════════ D ── 负控制 ══════════ */
const temps = [];
function makeMirror() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rp_v4280_'));
    temps.push(dir);
    copyTreeSafe(path.join(ROOT, 'apps', 'archive'), path.join(dir, 'apps', 'archive'));
    copyTreeSafe(path.join(ROOT, 'config'), path.join(dir, 'config'));
    return dir;
}
process.on('exit', () => {
    for (const d of temps) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (_e) {} }
});
/** 定点破坏真源码副本：锚点必须恰中 1 次（失配即 abort，防「破坏没发生也算红」）。 */
function breakCopy(rel, anchor, replacement) {
    const dir = makeMirror();
    const src = read(rel);
    const hits = src.split(anchor).length - 1;
    assert.equal(hits, 1, '破坏锚点必须恰中 1 次（实测 ' + hits + '）：' + anchor.slice(0, 70));
    fs.writeFileSync(path.join(dir, rel), src.split(anchor).join(replacement));
    return dir;
}
async function loadKernel(dir, tag) {
    return await import(pathToFileURL(path.join(dir, KERNEL_REL)).href + '?' + tag + '=' + Date.now());
}
async function loadWire(dir, tag) {
    return await import(pathToFileURL(path.join(dir, WIRE_REL)).href + '?' + tag + '=' + Date.now());
}
test('D0 ★★★ 阳性对照：未破坏时下列各条判据必须全为真', () => {
    assert.equal(K.readBranchCanonState(null).state, S.ENGINE_ABSENT);
    const nodeps = K.readBranchCanonState(mkUp({ enginePatch: { branchCanonState: () => ({ version: 2, judged: false, rows: [] }) } }));
    assert.equal(nodeps.reason, 'no-deps', '原版：装配未到单独一格');
    const empty = K.readBranchCanonAdopt(mkUp({ enginePatch: {
        storyCanonAdoptPlan: () => ({ version: 2, judged: true, verdict: 'empty', adoptionId: 'ca_2',
            pendingCount: 0, pending: [], pack: null, items: [], unmapped: [],
            bareOutcomes: [{ key: 'k9', branch: 'b1', title: '戊', why: 'no-items' }] }) } }));
    assert.equal(empty.reason, 'no-adoptable-items', '原版：无可接条目单独归因');
    assert.equal(K.readBranchCanonRevokeGuard(mkUp()).revoke.deletesManual, false);
    assert.equal(K.canonGateOf({ state: 'weird-future-state' }).readable, false);
    const w = new WIRE.ArchiveCanon(fakeApp(null));
    w.setSlot('k1');
    assert.equal(w.slot, 'k1');
    w.resetScene();
    assert.equal(w.slot, '', '原版：换会话清空选位');
    w.setSlot('x');
    assert.equal(w.slot, 'x');
    w.setSlot('');
    assert.equal(w.slot, '', '原版：空值即清空');
});
test('D1 ★★★ 破坏「装配未到单独一格」⇒ B1 同款判据必转红', async () => {
    const dir = breakCopy(KERNEL_REL,
        "    if (g.judged === false) return faceOf(BC_STATES.UNUSABLE, 'no-deps');\n    const rows = arr(g.rows).map(normClash)",
        "    const rows = arr(g.rows).map(normClash)");
    const M = await loadKernel(dir, 'd1');
    const r = M.readBranchCanonState(mkUp({ enginePatch: { branchCanonState: () => ({ version: 2, judged: false, rows: [] }) } }));
    assert.notEqual(r.reason, 'no-deps', '破坏副本：装配未到不再单独一格');
    assert.notEqual(r.state, S.UNUSABLE, '破坏副本：装配未到被读成了「零冲突位」');
    const orig = K.readBranchCanonState(mkUp({ enginePatch: { branchCanonState: () => ({ version: 2, judged: false, rows: [] }) } }));
    assert.equal(orig.reason, 'no-deps', '原版必须单独一格');
});
test('D2 ★★★ 破坏「empty 与 blocked 不同形」⇒ B3 同款判据必转红', async () => {
    const dir = breakCopy(KERNEL_REL,
        "        : (verdict === 'empty' || (!items.length && verdict !== 'ready') ? 'no-adoptable-items' : '');",
        "        : '';");
    const M = await loadKernel(dir, 'd2');
    const w = mkUp({ enginePatch: {
        storyCanonAdoptPlan: () => ({ version: 2, judged: true, verdict: 'empty', adoptionId: 'ca_2',
            pendingCount: 0, pending: [], pack: null, items: [], unmapped: [],
            bareOutcomes: [{ key: 'k9', branch: 'b1', title: '戊', why: 'no-items' }] }) } });
    const r = M.readBranchCanonAdopt(w);
    assert.equal(r.reason, '', '破坏副本：无可接条目不再单独归因');
    assert.notEqual(r.reason, 'no-adoptable-items');
    const orig = K.readBranchCanonAdopt(w);
    assert.equal(orig.reason, 'no-adoptable-items', '原版必须单独归因');
});
test('D3 ★★★ 破坏「canonGateOf 未知态走不可读」⇒ B8 同款判据必转红', async () => {
    const dir = breakCopy(KERNEL_REL,
        "    if (r.state === BC_STATES.OK) return { readable: true, state: r.state, hint: '' };",
        "    return { readable: true, state: r.state, hint: '' };");
    const M = await loadKernel(dir, 'd3');
    const g = M.canonGateOf({ state: 'weird-future-state' });
    assert.equal(g.readable, true, '破坏副本：未知态被当成可读');
    assert.equal(K.canonGateOf({ state: 'weird-future-state' }).readable, false, '原版必须走不可读');
});
test('D4 ★★★ 破坏「手工补的事实绝不删写成读数」⇒ B5 同款判据必转红', async () => {
    const dir = breakCopy(KERNEL_REL,
        "    out.deletesManual = o.deletesManual === true;",
        "    out.deletesManual = true;");
    const M = await loadKernel(dir, 'd4');
    const rv = M.readBranchCanonRevokeGuard(mkUp()).revoke;
    assert.equal(rv.deletesManual, true, '破坏副本：撤销会把手工补的事实删掉');
    assert.equal(K.readBranchCanonRevokeGuard(mkUp()).revoke.deletesManual, false, '原版必须为 false');
});
test('D5 ★★★ 破坏「换会话作废选位」⇒ C4 同款判据必转红', async () => {
    const dir = breakCopy(WIRE_REL,
        "    resetScene() { this._slot = ''; }",
        "    resetScene() { /* broken: 不清 */ }");
    const W = await loadWire(dir, 'd5');
    const w = new W.ArchiveCanon(fakeApp(null));
    w.setSlot('k1');
    w.resetScene();
    assert.equal(w.slot, 'k1', '破坏副本：换会话没清选位');
    const orig = new WIRE.ArchiveCanon(fakeApp(null));
    orig.setSlot('k1');
    orig.resetScene();
    assert.equal(orig.slot, '', '原版必须清');
});
test('D6 ★★★ 破坏「空值即清空、不回落」⇒ C3 同款判据必转红', async () => {
    const dir = breakCopy(WIRE_REL,
        "        this._slot = s.slice(0, 120);",
        "        this._slot = s ? s.slice(0, 120) : 'k1';");
    const W = await loadWire(dir, 'd6');
    const w = new W.ArchiveCanon(fakeApp(null));
    w.setSlot('');
    assert.equal(w.slot, 'k1', '破坏副本：清空回落成了默认第一位');
    const orig = new WIRE.ArchiveCanon(fakeApp(null));
    orig.setSlot('');
    assert.equal(orig.slot, '', '原版必须如实清空');
});
/* ══════════ E ── 版本锚 ══════════ */
test('E1 五源同源（不锁死具体版本值，但必须一致且当版条目在场）', () => {
    const pkg = JSON.parse(read('package.json'));
    const man = JSON.parse(read('manifest.json'));
    const log = JSON.parse(read('update-log.json'));
    const ver = pkg.version;
    assert.match(ver, /^\d+\.\d+\.\d+$/);
    assert.equal(man.version, ver);
    assert.equal(log.latest, ver);
    assert.equal(log.head, ver);
    assert.ok(log.versions[ver], '当版条目必须存在');
    const items = (log.versions[ver] && log.versions[ver].items) || [];
    assert.ok(Array.isArray(items) && items.length >= 8, '当版公告至少 8 条');
    assert.ok(read('index.js').indexOf("const ST_PHONE_VERSION = '" + ver + "';") >= 0);
    assert.ok(read('ITERATION_LOG.md').indexOf('v' + ver) >= 0);
    /* ★ 同 v4260 / v4270 的修法：这几条断的是「**v4.28.0 这一版**记全了」，
     *   故锁自己那一版的字面量，不跟随 `pkg.version` ——
     *   否则本套件会在抬到 v4.29.0 时因「新版公告里没有本版件名」而转红。 */
    const own = log.versions['4.28.0'];
    assert.ok(own, 'v4.28.0 条目必须在账上');
    const all = (own.items || []).join(NL);
    assert.ok(all.indexOf('archive-canon.js') >= 0, 'v4.28.0 公告必须记接线件');
    assert.ok(all.indexOf('branch-canon-contract.js') >= 0, 'v4.28.0 公告必须记契约件');
    assert.ok(all.indexOf('J21') >= 0, 'v4.28.0 公告必须记门禁标签');
    assert.ok(all.indexOf('运行时验证边界') >= 0);
    assert.ok(all.indexOf('branchCanon') >= 0, 'v4.28.0 公告必须记面 id');
    /* 本版件名必须真的在仓里（公告不许记不存在的东西）。 */
    for (const rel of [KERNEL_REL, WIRE_REL]) {
        assert.ok(fs.existsSync(path.join(ROOT, rel)), 'v4.28.0 公告记的件必须在仓里：' + rel);
    }
});