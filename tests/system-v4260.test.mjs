/* ============================================================
 * tests/system-v4260.test.mjs -- [v4.26.0 · 第四期 R4-X5 角色信息差与证词对照]
 *
 * 验收口径（计划原文 R4-X5）：
 *   「chars/memory 中增加并排视角，已有视角出口先交付；证词冲突深读接 M4-X5。
 *     作者与角色模式显式选择，切换不把全知正文塞入角色生成上下文。」
 *   验收四条：① 三人信息差案例，同一事件三种认知各自对应来源；② 时间拉回揭穿之前
 *   不显示后来真名；③ 作者比较不改变知识账；④ 手机窄屏改为逐人切换而非挤成三列。
 *   不做三条：不再造知识权限规则 / 不新增好感度算法 / 不以一票多数裁真相。
 *
 * 【修前实测的缺口（读码可复算，不是推演）】
 *   上游视角卡面（v3.323.0 M3-X4）与证词面（v3.343.0 M4-X5）**早已交付**，
 *   而手机侧 `apps/chars/` 里 `grep -n 'perspective'` **零命中**，
 *   全仓 `grep -n 'perspectiveContrast|testimonyBoard'`（消费者侧）同样零命中。
 *   后果三件，都不是报错：
 *     ① 写群像 / 悬疑时，作者看不到「甲亲历、乙听说、丙误信」的**并排**对照 ——
 *        只能一人一人查，而「查过谁、漏了谁」在读数上同形；
 *     ② 「同一事件的多种说法」无从聚合，更看不出**未裁决的三档成因**
 *        （三人都说但没人亲历 / 证据太弱 / 真正对立）——「未决」被压成一个布尔；
 *     ③ 撤回一条证据之后争议状态该跟着变（不静默留一个没人能举证的 contested），
 *        而手机侧根本没有这条通路。
 *   另：证词面**上游交付时漏登外供表**，故本版走「三处同批」补齐 ——
 *   上游表行 / 本仓登记行 / 本门标签。本套件判的是**下游这三处已闭合**。
 *
 * 【跨仓分工（本版全部判据都建立在这条上）】
 *   权限、身份分面、四态与三档一律**走上游口径**（本件不判哪个名字是真名）；
 *   手机只做三件上游没有的事：并排呈现、模式闸下的上下文截断、窄屏逐人切换。
 *   故「不裁真相」「不合成信息差分数」在本套件里是**可判的**：读数里不许出现
 *   百分比 / 置信度一族键（PCX_FORBIDDEN_KEYS 深度扫描，真跑）。
 *
 * 判据面（五组）：
 *   A 口径：六态两两不同形 / 纯契约零副作用 / 出口名与状态字面量唯一出现点 /
 *          视图不直呼内核 / 禁用键清单在场
 *   B 内核行为：六态分形逐态 / 并排四格原样透传 / 误信侧单列 / 四态与三档分列 /
 *              身份面闸（同名异人不许挡）/ 模式显式选择不猜 / 角色模式块不塞对方独有 /
 *              窄屏边界（720 恰好宽屏）/ 撤回状态重算不谎报 / 自检真跑
 *   C 接线行为：真接线件 + 真 App + 假宿主走完整旅程（未装插件 → 装插件 → 切模式 →
 *              切身份视图 → 取生成块 → 换会话作废现场 → 真视图渲染与绑定）
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
const KERNEL_REL = 'config/perspective-contrast-contract.js';
const WIRE_REL = 'apps/chars/chars-perspective.js';
const APP_REL = 'apps/chars/chars-app.js';
const VIEW_REL = 'apps/chars/chars-view.js';
const DATA_REL = 'apps/chars/chars-data.js';
const K = await import(pathToFileURL(path.join(ROOT, KERNEL_REL)).href);
const WIRE = await import(pathToFileURL(path.join(ROOT, WIRE_REL)).href);
const APP = await import(pathToFileURL(path.join(ROOT, APP_REL)).href);
const VIEW = await import(pathToFileURL(path.join(ROOT, VIEW_REL)).href);
const kernelSrc = read(KERNEL_REL);
const wireSrc = read(WIRE_REL);
const appSrc = read(APP_REL);
const viewSrc = read(VIEW_REL);
const dataSrc = read(DATA_REL);
const S = K.PCX_STATES;
const countOf = (hay, needle) => hay.split(needle).length - 1;
/* 本面独有的状态字面量：**只许契约件一份**（接线层零命中；改一处即全仓同改）。
 *   ★ `'ok'` / `'empty'` 不进这一档：它们与 chars 既有归因词同字
 *     （`face.reason === 'ready' ? 'ok'`），算进来是**误报**，不是漏检。 */
const KERNEL_ONLY = ["'engine-absent'", "'face-absent'", "'unusable'", "'no-subject'",
    "'mode-invalid'", "'misled'", "'supported'", "'contested'", "'withdrawn'",
    "'ambiguous'", "'below-threshold'", "'transmittal-only'", "'paged'", "'columns'"];
/* ══════════ 假件 ══════════ */
/** storage 假件：只实现数据层用到的 get/set/has。 */
function mkStorage() {
    const mem = new Map();
    return {
        _mem: mem,
        get: (k, d) => (mem.has(k) ? mem.get(k) : d),
        set: (k, v) => { mem.set(k, v); },
        has: (k) => mem.has(k),
        version: '1.19.0'
    };
}
/** 假宿主 window 的安装/还原（必须 async-aware：见 tests/system-v297.test.mjs 的 B 组档头）。 */
const withWin = async (obj, fn) => {
    const backup = Object.getOwnPropertyDescriptor(globalThis, 'window');
    globalThis.window = obj;
    try { return await fn(); } finally {
        if (backup) Object.defineProperty(globalThis, 'window', backup);
        else delete globalThis.window;
    }
};
/** 上游并排对照的裸读数（**原形**：onlyLeft / onlyRight / shared / misledSide 四格）。 */
function CT(a, b) {
    return {
        kind: 'perspective_card@contrast', version: 1, leftPresent: true, rightPresent: true,
        left: { character: a }, right: { character: b },
        diff: {
            onlyLeft: [{ fact: '甲自己在场', left: ['lived'], right: [] }],
            onlyRight: [{ fact: '乙独有的事', left: [], right: ['lived'] }],
            shared: [{ fact: '两人都知道', left: ['heard'], right: ['heard'] }],
            misledSide: [{ fact: '丙误信了', left: ['misled'], right: [] }]
        }
    };
}
/** 上游证词板（含身份四面 / 争议三档 / 三方支持计数）。 */
function mkBoard() {
    return {
        eventKey: 'e1', state: 'contested', reason: 'unresolved-dispute',
        testimonies: [{ character: '甲', statement: '我看见了', side: 'affirm', state: 'witnessed', strength: 'strong', floor: 3, identity: 'surface', evidenceKey: 'k1' }],
        supports: { independentCount: 1, transmittalCount: 2, firsthandCount: 1 },
        disputes: {
            contested: true,
            items: [{ character: '甲', statement: 'x', kind: 'ambiguous' }],
            kinds: { 'ambiguous': 1, 'below-threshold': 0, 'transmittal-only': 0 }
        },
        identities: {
            surface: [{ character: '明面', statement: 'a' }],
            revealed: [{ character: '真名', statement: 'b' }],
            homonym: [{ character: '同名者', statement: 'c' }],
            unspecified: [{ character: '没标', statement: 'd' }],
            split: true
        },
        counts: { testimonies: 1, independent: 1, transmittals: 2, firsthand: 1, unresolved: 1 }
    };
}
/** 上游假件（按 testimony-board.js / perspective-card.js 的口径缩微）。 */
function mkUp(opt) {
    const o = opt || {};
    return {
        LonShaMemory: {
            engine: {
                perspectiveContrast: (a, b) => (typeof o.contrast === 'function' ? o.contrast(a, b) : CT(a, b)),
                testimonyBoard: () => ({ kind: 'testimony_board', version: 1, boards: o.boards || [mkBoard()] }),
                testimonyRevoke: (d) => ({
                    version: 1, droppedCount: (d || []).length,
                    revokedItems: [{ character: '甲', evidenceKey: 'k1', traceId: 't1', was: 'witnessed' }],
                    unchanged: 0, stateBefore: 'contested', stateAfter: 'undecided', changed: true
                })
            }
        }
    };
}
/** 真 App + 假存储（宿主 window 由 withWin 装）。 */
function mkApp(win, storage) {
    const shell = { showNotification: () => {}, screen: null, layerHost: () => null };
    return new APP.CharsApp(shell, storage || mkStorage());
}
/** 接线件的 App 假件（只提供它真正用到的三个面）。 */
function fakeApp(win, settings) {
    const s = Object.assign({ perspectiveMode: 'author' }, settings || {});
    return {
        _s: s,
        _win: () => win,
        getSettings: () => Object.assign({}, s),
        saveSettings: (p) => { Object.assign(s, p || {}); return Object.assign({}, s); }
    };
}
/* 最小 DOM 替身（只提供视图真正用到的面；不仿真浏览器）。 */
function mkEl(sel, val) {
    const ls = {};
    return {
        sel: sel, val: val, _ls: ls,
        addEventListener: (t, fn) => { (ls[t] || (ls[t] = [])).push(fn); },
        getAttribute: (n) => ((n === 'data-px-mode' || n === 'data-px-face') ? val : null),
        fire: (t) => { for (const fn of (ls[t] || [])) fn({ target: { value: val } }); }
    };
}
function mkContainer(width, els) {
    const list = els || [];
    /* 选择器替身：视图用的是 `[data-px-mode]` 这种**属性选择器**形态，
     *   而替身里每个元素的 `sel` 记的是裸属性名 ⇒ 必须把方括号剥掉再比。
     *   （首版按精确相等比，绑定循环一个都没拿到 ⇒ C9 红得像产品缺陷。） */
    const hit = (x, sel) => (sel.charAt(0) === '[' ? x.sel === sel.slice(1, -1) : x.sel === sel);
    const c = {
        _html: '', clientWidth: width, _list: list,
        addEventListener: () => {},
        querySelector: (sel) => list.filter((x) => hit(x, sel))[0] || null,
        querySelectorAll: (sel) => list.filter((x) => hit(x, sel))
    };
    /* ★ 写 innerHTML = **重建子节点**（真实 DOM 语义）：旧元素连同其监听器一起作废。
     *   写成普通字段的话，视图 `_draw → _bind` 会反复给同一元素挂监听器：
     *   fire 一次执行 N 个 handler、每个 handler 又 `_draw` ⇒ 指数增长（首版直接 OOM）。 */
    Object.defineProperty(c, 'innerHTML', {
        get() { return this._html; },
        set(v) {
            this._html = v;
            for (const x of list) {
                for (const k of Object.keys(x._ls || {})) x._ls[k].length = 0;
            }
        }
    });
    return c;
}
/* ══════════ A ── 口径 ══════════ */
test('A1 六态两两不同形（没装插件 ≠ 这一面不在场 ≠ 本机读不出 ≠ 没给看谁 ≠ 真读数空）', () => {
    const vals = Object.keys(S).map((k) => S[k]);
    assert.equal(new Set(vals).size, vals.length, '状态各格必须互不相同');
    assert.notEqual(S.ENGINE_ABSENT, S.EMPTY, '「插件不在场」与「真读数无内容」必须不同形');
    assert.notEqual(S.NO_SUBJECT, S.EMPTY, '「没给看谁」与「他们都没说法」必须不同形');
    assert.notEqual(S.FACE_ABSENT, S.ENGINE_ABSENT, '「这一面不在场」与「插件不在场」必须不同形');
    assert.notEqual(S.UNUSABLE, S.EMPTY, '「本机读不出」与「真读数无内容」必须不同形');
    /* 未记录 ≠ 不知道：两格结构上不可混读（沿 R3-O2 口径）。 */
    assert.notEqual(K.PCX_SLOTS.unrecorded, K.PCX_SLOTS.unknown);
    assert.ok(K.PCX_SLOTS.unrecorded.indexOf('不当') >= 0, 'unrecorded 必须逐字提醒「不当『不知道』用」');
    assert.ok(K.PCX_SLOTS.misled.indexOf('勿当世界真相') >= 0, '误信格必须逐字提醒「勿当世界真相」');
});
test('A2 纯契约零副作用：不碰 DOM / 存储 / 网络 / 时钟，且只依赖唯一取数门', () => {
    for (const bad of ['localStorage', 'sessionStorage', 'document.', 'fetch(',
        'XMLHttpRequest', 'Date.now', 'Math.random', 'setTimeout', 'setInterval',
        'innerHTML', 'writeFile', 'process.env']) {
        assert.equal(countOf(kernelSrc, bad), 0, '契约件不得出现 ' + bad);
    }
    const imports = (kernelSrc.match(/^import .*$/gm) || []);
    assert.equal(imports.length, 1, '契约件只许一条静态导入（走全仓唯一取数门）');
    assert.ok(imports[0].indexOf('num-gate.js') >= 0, '唯一导入必须是 config/num-gate.js');
    assert.equal(countOf(kernelSrc, "from './num-gate.js'"), 1, '数值取值门不许就地再写一份');
    /* 零写面自证：读数里 writesNothing 恒 true（真跑一遍三路读数）。 */
    assert.equal(K.readPerspectiveContrast(mkUp(), '甲', '乙').writesNothing, true);
    assert.equal(K.readTestimonyBoard(mkUp()).writesNothing, true);
    assert.equal(K.readTestimonyRevoke(mkUp(), ['k1']).writesNothing, true);
});
test('A3 出口名与状态字面量唯一出现点：改一处即全仓同改（防改名后静默退化）', () => {
    const outlets = ['readPerspectiveContrast', 'readTestimonyBoard', 'readTestimonyRevoke',
        'planPerspectiveMode', 'modeAllowedSlots', 'gateContrastByMode', 'visibleAtFace',
        'layoutOf', 'perspectiveModePromptBlock', 'contrastLine', 'testimonyLine',
        'pcxSelfCheck', 'PCX_IDENTITY_VIEWS'];
    for (const name of outlets) {
        assert.ok(countOf(kernelSrc, name) >= 2, '出口 ' + name + ' 必须在契约件里定义并被 default 转出');
        /* ★ default export 的**末项不带尾逗号**（`    name` + 换行 + `};`）：
         *   只认 `    name,` 会把末项判成「没进 default」（本判据首版就这么误报过）。 */
        const inDefault = countOf(kernelSrc, '    ' + name + ',') + countOf(kernelSrc, '    ' + name + NL + '};');
        assert.ok(inDefault >= 1, '出口 ' + name + ' 必须进 default export');
    }
    /* 状态字面量：接线层（apps/chars/**）**零命中** —— 判定词只许契约件一份。 */
    const wiringAll = wireSrc + appSrc + viewSrc + dataSrc;
    for (const lit of KERNEL_ONLY) {
        assert.equal(countOf(wiringAll, lit), 0, '接线层不得再写一份判定词 ' + lit);
    }
});
test('A4 视图不直呼内核：判定全由 App 转交（同一口径只许一份实现）', () => {
    assert.equal(countOf(viewSrc, 'perspective-contrast-contract.js'), 0, '视图不得 import 契约件');
    /* 带括号：判的是**调用**，不是注释里提到名字（裸计数会把说明字样算成命中，是误报）。 */
    for (const fn of ['planPerspectiveMode(', 'gateContrastByMode(', 'visibleAtFace(',
        'layoutOf(', 'contrastLine(', 'testimonyLine(', 'readTestimonyBoard(',
        'readPerspectiveContrast(', 'pcxSelfCheck(']) {
        assert.equal(countOf(viewSrc, fn), 0, '视图不得直呼内核函数 ' + fn);
    }
    /* 视图只经 App 出口取数（三取数口 + 版式口 + 两份选项清单）。 */
    for (const fn of ['perspectiveMode()', 'perspectiveFace()', 'perspectiveCurrent()',
        'perspectiveLayout(', 'perspectiveModeIds()', 'perspectiveFaceIds()']) {
        assert.ok(countOf(viewSrc, fn) >= 1, '视图必须经 App 出口取数：' + fn);
    }
});
test('A5 禁用键清单在场且非空：读数里不得出现百分比 / 置信度一族（深度扫描，真跑）', () => {
    const keys = K.PCX_FORBIDDEN_KEYS;
    assert.ok(Array.isArray(keys) && keys.length >= 5, '禁用键清单必须非空');
    for (const k of ['percent', 'percentage', 'confidence', 'score', 'probability']) {
        assert.ok(keys.indexOf(k) >= 0, '禁用键清单必须含 ' + k);
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
    const hits = scan([K.readPerspectiveContrast(mkUp(), '甲', '乙'), K.readTestimonyBoard(mkUp()),
        K.readTestimonyRevoke(mkUp(), ['k1'])], []);
    assert.deepEqual(hits, [], '读数里出现了禁用键：' + hits.join('/'));
});/* ══════════ B ── 内核行为 ══════════ */
test('B1 六态分形逐态实测：插件不在场 / 面不在场 / 本机读不出 / 没给看谁 / 真读数空 / 读到', () => {
    assert.equal(K.readPerspectiveContrast(null, '甲', '乙').state, S.ENGINE_ABSENT, '没插件');
    assert.equal(K.readPerspectiveContrast(mkUp({ contrast: () => ({ version: 0 }) }), '甲', '乙').state,
        S.FACE_ABSENT, 'version=0 ⇒ 这一面不在场');
    assert.equal(K.readPerspectiveContrast(mkUp({ contrast: () => { throw new Error('boom'); } }), '甲', '乙').state,
        S.UNUSABLE, '出口抛错');
    assert.equal(K.readPerspectiveContrast(mkUp(), '', '').state, S.NO_SUBJECT, '没给两个人');
    assert.equal(K.readPerspectiveContrast(mkUp({
        contrast: () => ({ version: 1, leftPresent: false, rightPresent: false, diff: {} })
    }), '甲', '乙').state, S.EMPTY, '真跑过、两侧都没卡');
    assert.equal(K.readPerspectiveContrast(mkUp(), '甲', '乙').state, S.OK, '读到');
    /* 降级面（缺席 / 不在场 / 读不出）不得 silentCapable —— 它们不能替沉默作证。 */
    for (const bad of [null, { LonShaMemory: { engine: { perspectiveContrast: () => ({ version: 0 }) } } }]) {
        assert.equal(K.readPerspectiveContrast(bad, '甲', '乙').silentCapable, false);
        assert.equal(K.readPerspectiveContrast(bad, '甲', '乙').degraded, true);
    }
    assert.equal(K.readPerspectiveContrast(mkUp(), '甲', '乙').silentCapable, true, '双侧在场才可替沉默作证');
    /* 证词面同规格六态（同一套分形不许在两路出口上走样）。 */
    assert.equal(K.readTestimonyBoard({}).state, S.ENGINE_ABSENT);
    assert.equal(K.readTestimonyBoard({ LonShaMemory: { engine: { testimonyBoard: () => ({ version: 0 }) } } }).state, S.FACE_ABSENT);
    assert.equal(K.readTestimonyBoard({ LonShaMemory: { engine: { testimonyBoard: () => ({ version: 1, boards: [] }) } } }).state, S.EMPTY);
    assert.equal(K.readTestimonyBoard({ LonShaMemory: { engine: { testimonyBoard: () => ({ version: 1, degraded: true }) } } }).state, S.UNUSABLE);
});
test('B2 并排对照原样透传：四格逐条搬运，**不合成信息差分数**', () => {
    const r = K.readPerspectiveContrast(mkUp(), '甲', '乙');
    assert.deepEqual(r.diff.onlyLeft.map((x) => x.fact), ['甲自己在场']);
    assert.deepEqual(r.diff.onlyRight.map((x) => x.fact), ['乙独有的事']);
    assert.deepEqual(r.diff.shared.map((x) => x.fact), ['两人都知道']);
    assert.deepEqual(r.diff.misledSide.map((x) => x.fact), ['丙误信了']);
    assert.deepEqual(r.chars, ['甲', '乙'], '两侧人名原样带回');
    assert.deepEqual(Object.keys(r.diff).sort(), ['misledSide', 'onlyLeft', 'onlyRight', 'shared'],
        '四格**分列**：合成一格就再也说不出「谁独有、谁误信」');
    const keys = Object.keys(r.diff).concat(Object.keys(r.counts));
    for (const bad of ['score', 'percent', 'distance', 'similarity', 'gap']) {
        assert.equal(keys.indexOf(bad), -1, '不得合成信息差分数键 ' + bad);
    }
    /* 上游没有格位语义时如实给空数组，不拿别的东西顶替。 */
    const bare = K.readPerspectiveContrast(mkUp({ contrast: () => ({ version: 1, leftPresent: true, rightPresent: true, diff: {} }) }), '甲', '乙');
    assert.deepEqual(bare.diff, { onlyLeft: [], onlyRight: [], shared: [], misledSide: [] });
});
test('B3 误信侧必须永远报出来（「别把误信写成世界真相」的落点）', () => {
    const line = K.contrastLine(K.readPerspectiveContrast(mkUp(), '甲', '乙'));
    assert.ok(line.indexOf('误信侧 1') >= 0, '一行读数必须报出误信侧条数：' + line);
    assert.ok(line.indexOf('勿当世界真相') >= 0, '必须逐字带上「勿当世界真相」');
    /* 有一侧没卡时也必须说（不许与「两人都没说法」同形）。 */
    const one = K.contrastLine(K.readPerspectiveContrast(mkUp({
        contrast: () => ({ version: 1, leftPresent: true, rightPresent: false, diff: { onlyLeft: [{ fact: 'x', left: ['lived'] }] } })
    }), '甲', '乙'));
    assert.ok(one.indexOf('有一侧没有卡') >= 0, '单侧在场必须如实报：' + one);
    /* 六态各有各的话，合并任意两态都会误导「该怎么写」。 */
    const texts = [null, { LonShaMemory: { engine: { perspectiveContrast: () => ({ version: 0 }) } } },
        { LonShaMemory: { engine: { perspectiveContrast: () => { throw new Error('x'); } } } }]
        .map((w) => K.contrastLine(K.readPerspectiveContrast(w, '甲', '乙')));
    texts.push(K.contrastLine(K.readPerspectiveContrast(mkUp(), '', '')));
    texts.push(K.contrastLine(K.readPerspectiveContrast(mkUp({
        contrast: () => ({ version: 1, leftPresent: false, rightPresent: false, diff: {} })
    }), '甲', '乙')));
    assert.equal(new Set(texts).size, texts.length, '六态的读数文案必须两两不同形');
});
test('B4 证词四态与未裁决三档**逐格端出**（合成一格就分不出「为什么暂不能下结论」）', () => {
    const tb = K.readTestimonyBoard(mkUp());
    assert.equal(tb.state, S.OK);
    assert.deepEqual(Object.keys(tb.counts.states).sort(), ['contested', 'supported', 'undecided', 'withdrawn']);
    assert.equal(tb.counts.states.contested, 1, '争议未决必须如实计数');
    const b = tb.boards[0];
    assert.deepEqual(Object.keys(b.disputes.kinds).sort(), ['ambiguous', 'below-threshold', 'transmittal-only']);
    assert.equal(b.disputes.kinds['ambiguous'], 1);
    assert.equal(b.counts.independent + '/' + b.counts.transmittals + '/' + b.counts.firsthand, '1/2/1',
        '三方支持分开报（合成一格就说不出「为什么这条更硬」）');
    const line = K.testimonyLine(tb);
    for (const seg of ['事件 1', '说法 1', '争议未决 1', '未决·ambiguous 1']) {
        assert.ok(line.indexOf(seg) >= 0, '一行读数缺「' + seg + '」：' + line);
    }
    const mk = (st) => ({
        LonShaMemory: {
            engine: {
                testimonyBoard: () => ({
                    version: 1, boards: [{
                        eventKey: 'e', state: st,
                        disputes: { items: [{ kind: 'ambiguous', statement: 'x' }], kinds: {} }
                    }]
                })
            }
        }
    });
    assert.ok(K.testimonyLine(K.readTestimonyBoard(mk('supported'))).indexOf('有据 1') >= 0);
    assert.ok(K.testimonyLine(K.readTestimonyBoard(mk('withdrawn'))).indexOf('已撤回 1') >= 0);
    assert.ok(K.testimonyLine(K.readTestimonyBoard(mk('undecided'))).indexOf('判不开 1') >= 0);
    /* 三档**分列**报出（不只报一档）。 */
    const three = K.readTestimonyBoard({
        LonShaMemory: {
            engine: {
                testimonyBoard: () => ({
                    version: 1, boards: [{
                        eventKey: 'e', state: 'undecided',
                        disputes: {
                            items: [{ kind: 'ambiguous', statement: 'a' }, { kind: 'below-threshold', statement: 'b' }, { kind: 'transmittal-only', statement: 'c' }],
                            kinds: { 'ambiguous': 1, 'below-threshold': 1, 'transmittal-only': 1 }
                        }
                    }]
                })
            }
        }
    });
    const l3 = K.testimonyLine(three);
    for (const seg of ['未决·ambiguous 1', '未决·below-threshold 1', '未决·transmittal-only 1']) {
        assert.ok(l3.indexOf(seg) >= 0, '三档必须分列报出，缺：' + seg);
    }
});
test('B5 身份面闸（验收第②条）：未揭穿挡 revealed，homonym 与 unspecified **照常可见**', () => {
    const b = K.readTestimonyBoard(mkUp()).boards[0];
    const vis = K.visibleAtFace(b, 'surface');
    const names = vis.visible.map((x) => x.character);
    assert.equal(names.indexOf('真名'), -1, '未揭穿视图泄漏了后来真名');
    assert.equal(vis.hiddenRevealed, 1, '挡掉几条必须如实计数');
    assert.ok(names.indexOf('同名者') >= 0, '同名异人被挡掉（会把两人读成一人）');
    assert.ok(names.indexOf('没标') >= 0, '未标身份的条目被挡掉（会被读成「没这人」）');
    const rev = K.visibleAtFace(b, 'revealed');
    assert.ok(rev.visible.map((x) => x.character).indexOf('真名') >= 0, '已揭穿视图必须给真名');
    assert.equal(rev.hiddenSurface, 1, '已揭穿视图挡掉明面几条必须如实计数');
    const all = K.visibleAtFace(b, 'all');
    assert.equal(all.visible.length, 4, '全呈视图四面齐给');
    assert.equal(all.hiddenRevealed + all.hiddenSurface, 0);
    assert.equal(K.visibleAtFace(b).face, 'surface', '默认视图是未揭穿（不给 face 参数也不许端出真名）');
    assert.equal(K.visibleAtFace(null, 'surface').visible.length, 0, '板畸形不抛、如实给空');
    assert.equal(K.visibleAtFace({ identities: { revealed: [{ character: '真名' }], split: true } }, 'surface').hiddenRevealed, 1);
});
test('B6 作者 / 角色模式**显式选择**：空串按作者，非法值报 mode-invalid 且不猜', () => {
    assert.equal(K.planPerspectiveMode('').mode, 'author', '空串按作者处置');
    assert.equal(K.planPerspectiveMode('author').ok, true);
    assert.equal(K.planPerspectiveMode('CHARACTER').mode, 'character', '大小写归一');
    const bad = K.planPerspectiveMode('omnipotent');
    assert.equal(bad.ok, false);
    assert.equal(bad.reason, 'mode-invalid');
    assert.equal(bad.mode, '', '非法值不得猜一个默认模式');
    assert.deepEqual(K.modeAllowedSlots('character'), ['lived', 'heard', 'misled'],
        '角色模式只给「他知道的内容」三格（元信息不进上下文）');
    assert.equal(K.modeAllowedSlots('author').length, 5, '作者模式给账本本身（四格 + 不可用格）');
    assert.equal(K.perspectiveModePromptBlock('omnipotent', K.readPerspectiveContrast(mkUp(), '甲', '乙')), '',
        '模式非法 ⇒ **不给生成块**（宁可少一块上下文，也不拿猜的模式喂全知正文）');
    assert.equal(K.PCX_MODES.AUTHOR, 'author');
    assert.equal(K.PCX_MODES.CHARACTER, 'character');
});
test('B7 角色模式块不塞对方独有的事实（验收第③条的语义落点）；作者模式可见', () => {
    const r = K.readPerspectiveContrast(mkUp(), '甲', '乙');
    const ch = K.perspectiveModePromptBlock('character', r, { current: '甲' });
    assert.equal(ch.indexOf('乙独有的事'), -1, '角色模式把对方独有的事实塞进了生成上下文');
    assert.ok(ch.indexOf('甲自己在场') >= 0, '角色模式漏掉了当前角色自己的可知内容');
    assert.ok(ch.indexOf('两人都知道') >= 0, '共有内容必须给');
    assert.ok(ch.indexOf('世界真相') >= 0, '块头必须逐字说明「不是世界真相」');
    const au = K.perspectiveModePromptBlock('author', r, { current: '甲' });
    assert.ok(au.indexOf('乙独有的事') >= 0, '作者模式必须能看到对方独有的事实（全知面）');
    assert.equal(K.perspectiveModePromptBlock('author', { state: S.EMPTY, diff: {} }), '',
        '读数不 OK ⇒ 不给块（不产生空块挤占生成预算）');
    /* 闸函数只读输入：调用前后输入一个字节不动（验收第③条「作者比较不改变知识账」）。 */
    const before = JSON.stringify(r);
    K.gateContrastByMode('character', r);
    K.perspectiveModePromptBlock('character', r, { current: '甲' });
    assert.equal(JSON.stringify(r), before, '模式切换不得改动知识账');
    const gated = K.gateContrastByMode('character', r);
    assert.equal(gated.othersHidden, 1, '角色模式必须如实报「少看了几条」');
    assert.equal(gated.onlyMine.length, 1);
    assert.equal(gated.sharedFacts.length, 1);
    assert.equal(K.gateContrastByMode('author', r).othersHidden, 0, '作者模式不隐藏任何东西');
    assert.equal(K.gateContrastByMode('omnipotent', r).ok, false, '模式非法时闸口如实报错');
});
test('B8 窄屏逐人切换（验收第④条）：读不出按窄屏，**720 恰好按宽屏**（边界钉死）', () => {
    assert.equal(K.layoutOf(null).layout, 'paged', '宽度读不出 ⇒ 按窄屏保守处置');
    assert.equal(K.layoutOf(null).width, null, '读不出不许伪造成 0');
    assert.equal(K.layoutOf(0).layout, 'paged', '0 不是合法宽度');
    assert.equal(K.layoutOf(-5).layout, 'paged');
    assert.equal(K.layoutOf(320).layout, 'paged');
    assert.equal(K.layoutOf(719).layout, 'paged');
    assert.equal(K.layoutOf(720).layout, 'columns', '恰好等于阈值 ⇒ 按宽屏（否则同一台设备两版不同）');
    assert.equal(K.layoutOf(1280).layout, 'columns');
    assert.equal(K.layoutOf(1280).perPage, 3, '宽屏最多 3 人同屏');
    assert.equal(K.layoutOf(320).perPage, 1, '窄屏一次只看一人');
    assert.equal(K.PCX_LIMITS.narrowWidth, 720, '阈值常量必须是 720');
    assert.notEqual(K.layoutOf(320).text, K.layoutOf(1280).text, '两版文案必须不同形');
});
test('B9 撤回后状态重算：撤到无独立支持不退化成 contested，且不把未登记状态当合法态', () => {
    const rv = K.readTestimonyRevoke(mkUp(), ['k1']);
    assert.equal(rv.ok, true);
    assert.equal(rv.stateBefore, 'contested');
    assert.equal(rv.stateAfter, 'undecided', '撤到无独立支持 ⇒ undecided / withdrawn，**不退化成 contested**');
    assert.equal(rv.changed, true);
    assert.equal(rv.droppedCount, 1);
    assert.equal(rv.revokedItems.length, 1, '命中的条目不删不静默：如实列进 revokedItems');
    assert.equal(rv.revokedItems[0].was, 'witnessed', '撤回前状态原样带回');
    const weird = K.readTestimonyRevoke({
        LonShaMemory: { engine: { testimonyRevoke: () => ({ version: 1, stateBefore: 'weird', stateAfter: 'weirder', changed: true }) } }
    }, ['k'], {});
    assert.equal(weird.stateBefore, '', '未登记状态不得当作合法态端出');
    assert.equal(weird.stateAfter, '');
    assert.equal(K.readTestimonyRevoke({}, ['k']).reason, 'engine-absent', '撤回面缺席如实报（不编「没变化」）');
    assert.equal(K.readTestimonyRevoke({}, ['k']).ok, false);
    assert.equal(K.readTestimonyRevoke({ LonShaMemory: { engine: { testimonyRevoke: () => { throw new Error('x'); } } } }, ['k']).reason, 'unusable');
});
test('B10 自检真跑判据（不是数常量）：pcxSelfCheck 当场自证且零问题', () => {
    const r = K.pcxSelfCheck();
    assert.ok(Array.isArray(r.problems), '自检必须回 {problems:[]} 形状');
    assert.deepEqual(r.problems, [], '自检必须零问题：' + r.problems.join(' / '));
    /* 自检**真的在跑判据**（这几条是它在自检体里真跑的证据，不是表在场）。 */
    assert.ok(countOf(kernelSrc, "if (blk.indexOf('乙独有的事') >= 0)") >= 1, '自检必须真跑「角色模式块不得含对方独有」');
    assert.equal(countOf(kernelSrc, 'const hits = scan(sample, []);'), 1, '自检必须真跑一次禁用键深度扫描');
    assert.equal(countOf(kernelSrc, 'if (vis.hiddenRevealed !== 1)'), 1, '自检必须真跑身份面闸');
    assert.ok(countOf(kernelSrc, 'if (layoutOf(null).layout !==') >= 1, '自检必须真跑窄屏版式');
    assert.ok(countOf(kernelSrc, 'if (absent.writesNothing !== true') >= 1, '自检必须真跑零写面');
});/* ══════════ C ── 接线行为（真接线件 + 真 App + 假宿主） ══════════ */
test('C1 未装插件：如实报「插件不在场」，不编一份对照冒充', async () => {
    const store = mkStorage();
    await withWin({}, async () => {
        const app = mkApp({}, store);
        assert.ok(app.perspectiveContrastLine(app.perspectivePack('甲', '乙').read).indexOf('未装或未加载') >= 0,
            '未装插件必须如实报缺席');
        const p = app.perspectivePack('甲', '乙', { width: 375 });
        assert.equal(p.read.state, S.ENGINE_ABSENT);
        assert.equal(p.tb.state, S.ENGINE_ABSENT);
        assert.equal(p.boards.length, 0, '插件不在场不得编出板');
        assert.equal(p.layout.layout, 'paged', '结构恒定（版式照样给）');
        assert.equal(p.gated.mode, 'author', '结构恒定（模式照样给）');
        assert.equal(app.perspectivePromptBlock('甲', '乙'), '', '缺席时不给生成块');
        assert.equal(app.perspectiveCurrent(), '');
        assert.equal(app.perspectiveFace(), 'surface');
    });
});
test('C2 完整旅程：装插件后 pack 四面同源（模式 / 对照 / 证词 / 版式）', async () => {
    const store = mkStorage();
    await withWin(mkUp(), async () => {
        const app = mkApp({}, store);
        const p = app.perspectivePack('甲', '乙', { width: 1280 });
        assert.equal(p.mode.mode, 'author', '默认作者模式');
        assert.equal(p.read.state, S.OK);
        assert.equal(p.tb.state, S.OK);
        assert.equal(p.face, 'surface', '默认未揭穿视图');
        assert.equal(p.current, '', '当前角色未选（不猜）');
        assert.equal(p.layout.layout, 'columns');
        assert.ok(p.contrastLine.indexOf('信息差:') >= 0);
        assert.ok(p.testimonyLine.indexOf('证词:') >= 0);
        assert.equal(p.boards.length, 1);
        assert.equal(p.boards[0].visible.hiddenRevealed, 1, '同一份 pack 上的身份面闸必须已生效');
        /* 同一份读数上的四面：切模式不改读数的 diff（作者比较不改变知识账）。 */
        app.setPerspectiveMode('character');
        const p2 = app.perspectivePack('甲', '乙', { width: 375 });
        assert.equal(p2.mode.mode, 'character');
        assert.equal(p2.gated.othersHidden, 1);
        assert.deepEqual(p2.read.diff, p.read.diff, '切模式不得改动知识账');
        assert.equal(p2.layout.layout, 'paged');
    });
});
test('C3 模式切换：写设置 + 走内核归一口径；非法值**不写设置、不改呈现**', async () => {
    const store = mkStorage();
    await withWin(mkUp(), async () => {
        const app = mkApp({}, store);
        assert.equal(app.perspectiveMode().mode, 'author');
        assert.deepEqual(app.setPerspectiveMode('character'), { ok: true, mode: 'character' });
        assert.equal(app.perspectiveMode().mode, 'character', '设置写入后读数跟上');
        const saved = JSON.parse(store.get('chars_settings_v1', '{}'));
        assert.equal(saved.perspectiveMode, 'character', '必须写进 chars_ 键（随会话隔离）');
        const bad = app.setPerspectiveMode('omnipotent');
        assert.equal(bad.ok, false);
        assert.equal(bad.reason, 'mode-invalid');
        assert.equal(app.perspectiveMode().mode, 'character', '非法值不得改写设置');
        assert.equal(JSON.parse(store.get('chars_settings_v1', '{}')).perspectiveMode, 'character');
        /* 设置键仍在 storage 白名单里（跨会话隔离的前提）。 */
        assert.ok(read('config/storage.js').indexOf('/^chars_/') >= 0, 'chars_ 键必须在 storage 白名单');
        assert.ok(dataSrc.indexOf('perspectiveMode:') >= 0, '默认值必须带这一格');
        assert.equal(countOf(dataSrc, 'perspectiveMode'), 1, '不新增第二份模式默认值');
    });
});
test('C4 身份视图三态：取值清单走内核，非法值被拒且不改现场', async () => {
    const store = mkStorage();
    await withWin(mkUp(), async () => {
        const app = mkApp({}, store);
        assert.equal(app.perspectiveFace(), 'surface', '默认未揭穿（验收第②条）');
        assert.deepEqual(app.setPerspectiveFace('revealed'), { ok: true, face: 'revealed' });
        assert.equal(app.perspectiveFace(), 'revealed');
        assert.deepEqual(app.setPerspectiveFace('all'), { ok: true, face: 'all' });
        const bad = app.setPerspectiveFace('later');
        assert.equal(bad.ok, false);
        assert.equal(bad.reason, 'face-invalid');
        assert.equal(app.perspectiveFace(), 'all', '非法值不得改写现场');
        assert.deepEqual(app.perspectiveFaceIds(), ['surface', 'revealed', 'all'], '界面选项清单必须与内核同一份');
        assert.deepEqual(app.perspectiveModeIds(), ['author', 'character']);
    });
});
test('C5 生成侧块：角色模式对方独有的事实一条都不进块（验收第③条）', async () => {
    const store = mkStorage();
    await withWin(mkUp(), async () => {
        const app = mkApp({}, store);
        const read0 = app.perspectivePack('甲', '乙').read;
        app.setPerspectiveMode('character');
        app.setPerspectiveCurrent('甲');
        const blk = app.perspectivePromptBlock('甲', '乙', { read: read0 });
        assert.equal(blk.indexOf('乙独有的事'), -1, '角色模式把对方独有的事实塞进了生成上下文');
        assert.ok(blk.indexOf('甲自己在场') >= 0);
        app.setPerspectiveMode('author');
        const au = app.perspectivePromptBlock('甲', '乙', { read: read0 });
        assert.ok(au.indexOf('乙独有的事') >= 0, '作者模式（全知面）必须能看到');
        /* 未选当前角色时也不许把「对方独有」当默认给出去。 */
        app.setPerspectiveMode('character');
        app.setPerspectiveCurrent('');
        const blk2 = app.perspectivePromptBlock('甲', '乙', { read: read0 });
        assert.equal(blk2.indexOf('乙独有的事'), -1, '没选主体也绝不外泄对方独有事实');
    });
});
test('C6 撤回通路：手机只搬上游重算结果，零写上游（不发撤回）', async () => {
    const store = mkStorage();
    await withWin(mkUp(), async () => {
        const app = mkApp({}, store);
        const rv = app.perspectiveRevoke(['k1']);
        assert.equal(rv.ok, true);
        assert.equal(rv.stateAfter, 'undecided');
        assert.equal(rv.writesNothing, true);
        /* 手机端不得出现「发起撤回」的写口（撤回是上游控制面的动作）。 */
        for (const bad of ['fetch(', 'localStorage', 'bridge.write', 'commitRevoke']) {
            assert.equal(countOf(wireSrc, bad), 0, '接线件不得出现写口 ' + bad);
        }
        assert.equal(countOf(wireSrc, 'revokeEvidence('), 0, '手机端不自己重算撤回（搬上游读数）');
    });
});
test('C7 换会话作废现场：清当前角色与身份视图，**不清模式**（那是设置不是读数）', async () => {
    const store = mkStorage();
    await withWin(mkUp(), async () => {
        const app = mkApp({}, store);
        app.setPerspectiveMode('character');
        app.setPerspectiveCurrent('甲');
        app.setPerspectiveFace('revealed');
        assert.equal(app.perspectiveCurrent(), '甲');
        app.onChatChanged();
        assert.equal(app.perspectiveCurrent(), '', '换会话必须作废上一会话选中的角色名（否则进新会话的生成块）');
        assert.equal(app.perspectiveFace(), 'surface', '身份视图回到未揭穿（保守）');
        assert.equal(app.perspectiveMode().mode, 'character', '模式是随会话隔离的设置，不作废');
        assert.equal(app.resetPerspectiveScene().ok, true);
    });
});
test('C8 真视图渲染：三组控件在场，宽 / 窄屏文案各按内核给', async () => {
    const store = mkStorage();
    await withWin(mkUp(), async () => {
        const app = mkApp({}, store);
        const wide = mkContainer(1280, []);
        app.view.render(wide);
        const html = wide.innerHTML;
        for (const seg of ['cs-px', '信息差与证词对照', '视角模式', '身份视图', '当前角色',
            'data-px-mode="author"', 'data-px-mode="character"', 'data-px-face="surface"',
            'data-px-face="revealed"', 'data-px-face="all"', 'id="cs-px-cur"']) {
            assert.ok(html.indexOf(seg) >= 0, '视图缺控件：' + seg);
        }
        assert.ok(html.indexOf('并排') >= 0, '宽屏文案应由内核给');
        const narrow = mkContainer(375, []);
        app.view.render(narrow);
        assert.ok(narrow.innerHTML.indexOf('逐人切换') >= 0, '窄屏文案应由内核给');
        /* 无宿主容器 / 宽度读不出也不抛（读不出 ⇒ 按窄屏）。 */
        assert.doesNotThrow(() => app.view.render(null));
        assert.doesNotThrow(() => app.view.render(mkContainer(NaN, [])));
        assert.ok(mkContainer(NaN, []).innerHTML === '', '容器替身初始为空（口径核对）');
    });
});
test('C9 真视图绑定：模式 / 身份 / 当前角色三处点击都走 App 出口（视图不自己改状态）', async () => {
    const store = mkStorage();
    await withWin(mkUp(), async () => {
        const app = mkApp({}, store);
        /* 视图必须**经 App 出口**改写：记下它调了哪个出口、传了什么值。
         *   只看「App 状态变了」是弱判据 —— 视图自己改状态也能过。 */
        const calls = [];
        const realSetCur = app.setPerspectiveCurrent.bind(app);
        app.setPerspectiveCurrent = (v) => { calls.push(['current', String(v)]); return realSetCur(v); };
        const realSetMode = app.setPerspectiveMode.bind(app);
        app.setPerspectiveMode = (v) => { calls.push(['mode', String(v)]); return realSetMode(v); };
        const modeBtn = mkEl('data-px-mode', 'character');
        const faceBtn = mkEl('data-px-face', 'revealed');
        const curEl = mkEl('cs-px-cur', '甲');
        curEl.sel = '#cs-px-cur';
        const c = mkContainer(375, [modeBtn, faceBtn, curEl]);
        app.view.render(c);
        modeBtn.fire('click');
        assert.equal(app.perspectiveMode().mode, 'character', '点模式按钮必须经 App 出口改写');
        faceBtn.fire('click');
        assert.equal(app.perspectiveFace(), 'revealed', '点身份按钮必须经 App 出口改写');
        curEl.fire('change');
        assert.equal(app.perspectiveCurrent(), '甲', '当前角色必须经 App 出口改写');
        assert.deepEqual(calls, [['mode', 'character'], ['current', '甲']],
            '视图必须把**控件上的取值原样**交给 App 出口（不自己改状态、不自己拼值）');
        assert.equal(JSON.parse(store.get('chars_settings_v1', '{}')).perspectiveMode, 'character');
    });
});
test('C10 本版三条「不做」在代码上可判：不造权限规则 / 不新增好感度算法 / 不以票数裁真相', async () => {
    /* ★ 扫描前先把「不做」的**登记句**剔掉：如实登记「不新增好感度算法」本身含「好感」二字，
     *   算进来是误报（把「声明不做」读成「做了」）。判的是**引入形态**，不是字面出现。 */
    const stripDecl = (s) => s.split(NL).filter((ln) => ln.indexOf('不做') < 0).join(NL);
    const all = stripDecl(kernelSrc + wireSrc + appSrc + viewSrc);
    for (const bad of ['affectionOf', 'affectionDelta', 'voteOf', 'majorityOf', '好感度计分']) {
        assert.equal(countOf(all, bad), 0, '本版不得引入 ' + bad);
    }
    /* 不造知识权限规则：本件只按上游给的 identity 分面过滤，不自己判「谁该知道」。 */
    assert.equal(countOf(kernelSrc, 'canKnow'), 0);
    assert.equal(countOf(kernelSrc, 'permission'), 0);
    /* 不以一票多数裁真相：四态与三档**原样端出**，读数里没有「谁赢了」的键。 */
    for (const bad of ['winner', 'verdict', 'truthScore']) {
        assert.equal(countOf(kernelSrc, bad), 0, '不得出现裁决键 ' + bad);
    }
    /* 接线件只搬不重算：没有任何「重新判定四态」的分支。 */
    assert.equal(countOf(wireSrc, "=== 'supported'"), 0);
    assert.equal(countOf(wireSrc, "=== 'contested'"), 0);
});/* ══════════ D ── 负控制（真源码定点破坏 ⇒ 同款判据必转红） ══════════
 * 【为什么破坏副本而不是原仓】见 tests/system-v4120.test.mjs 档头（同规）：
 *   破坏原仓会让「跑这一套」与「跑全量」互相污染；副本跑完即删。
 *   且 `breakCopy` 断言**锚点恰中一次** —— 锚点漂了（改过名 / 写成两处）当场转红，
 *   不会静默退化成「破坏没发生，于是判据照样通过」（本仓治过的假绿形态）。
 * 【每条都配反向对照】「破坏副本转红」只证明判据会响；必须同时证明
 *   **原版同款判据为真**，否则那条判据可能本来就恒红（假绿的反面）。
 * 【本组全部真跑】破坏后的副本用 `?tag=` 绕开模块缓存重新 import（不读假件、不 mock）。
 */
const temps = [];
function makeMirror() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rp_v4260_'));
    temps.push(dir);
    /* 只镜像判据真正碰到的两棵子树（apps 侧只取 chars）。 */
    copyTreeSafe(path.join(ROOT, 'apps', 'chars'), path.join(dir, 'apps', 'chars'));
    copyTreeSafe(path.join(ROOT, 'config'), path.join(dir, 'config'));
    return dir;
}
process.on('exit', () => {
    for (const d of temps) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (_e) { /* 忽略 */ } }
});
/** 真源码定点破坏：锚点必须**恰中一次**；破坏的是**副本**（绝不动真仓）。 */
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
async function loadApp(dir, tag) {
    return await import(pathToFileURL(path.join(dir, APP_REL)).href + '?' + tag + '=' + Date.now());
}
const NL = String.fromCharCode(10);
test('D0 ★★★ 阳性对照：未破坏时下列各条判据必须全为真（否则 D 组是假绿）', () => {
    /* 逐条对应下面 D1~D10 要破坏的那一条，全部打在**真模块**上。 */
    assert.equal(K.readPerspectiveContrast(mkUp(), '', '').state, S.NO_SUBJECT, '原版：没给看谁单独一格');
    const b = K.readTestimonyBoard(mkUp()).boards[0];
    assert.equal(K.visibleAtFace(b, 'surface').visible.map((x) => x.character).indexOf('真名'), -1, '原版：未揭穿挡 revealed');
    const r0 = K.readPerspectiveContrast(mkUp(), '甲', '乙');
    assert.equal(K.perspectiveModePromptBlock('character', r0, { current: '甲' }).indexOf('乙独有的事'), -1, '原版：角色模式不给对方独有');
    assert.equal(K.perspectiveModePromptBlock('omnipotent', r0), '', '原版：模式非法不给块');
    assert.equal(K.layoutOf(720).layout, 'columns', '原版：720 恰好宽屏');
    assert.equal(K.readTestimonyRevoke({
        LonShaMemory: { engine: { testimonyRevoke: () => ({ version: 1, stateBefore: 'weird', stateAfter: 'weirder', changed: true }) } }
    }, ['k']).stateBefore, '', '原版：未登记状态不当合法态');
    assert.ok(K.contrastLine(r0).indexOf('误信侧 1') >= 0, '原版：误信侧报出');
    assert.equal(K.readPerspectiveContrast(null, '甲', '乙').state, S.ENGINE_ABSENT, '原版：插件不在场单独一格');
    /* 接线层两条（真接线件，非副本）。 */
    const wp = new WIRE.CharsPerspective(fakeApp(null));
    assert.deepEqual(wp.setFace('later'), { ok: false, reason: 'face-invalid' }, '原版：非法身份视图被拒');
    assert.deepEqual(wp.setFace('revealed'), { ok: true, face: 'revealed' }, '原版：合法身份视图放行');
    wp.setCurrent('甲');
    wp.resetScene();
    assert.equal(wp.current(), '', '原版：换会话作废当前角色');
    assert.equal(wp.face(), 'surface', '原版：换会话身份视图回到未揭穿');
});
test('D1 ★★★ 破坏「没给看谁单独一格」⇒ B1 同款判据必转红（把「还没给主体」显示成「读到了」）', async () => {
    const dir = breakCopy(KERNEL_REL,
        "    if (!a || !b) return faceOf(PCX_STATES.NO_SUBJECT, 'no-subject', { chars: [a, b].filter(Boolean) });",
        "    if (false) return faceOf(PCX_STATES.NO_SUBJECT, 'no-subject');");
    const M = await loadKernel(dir, 'd1');
    const r = M.readPerspectiveContrast(mkUp(), '', '');
    assert.notEqual(r.state, S.NO_SUBJECT, '破坏副本：没给看谁不再单独一格');
    assert.equal(r.state, S.OK,
        '★★★ 破坏副本：「还没给谁看」被显示成「读到了」⇒ 用户以为这两人都有说法，实际连主体都没选');
    assert.equal(K.readPerspectiveContrast(mkUp(), '', '').state, S.NO_SUBJECT, '原版必须单独一格');
});
test('D2 ★★★ 破坏「未揭穿挡 revealed」⇒ B5 同款判据必转红（剧透后来真名）', async () => {
    const dir = breakCopy(KERNEL_REL,
        '        visible: surface.concat(unspecified, homonym),',
        '        visible: surface.concat(unspecified, homonym, revealed),');
    const M = await loadKernel(dir, 'd2');
    const mb = M.readTestimonyBoard(mkUp()).boards[0];
    assert.ok(M.visibleAtFace(mb, 'surface').visible.map((x) => x.character).indexOf('真名') >= 0,
        '★★★ 破坏副本：未揭穿视图把 later 的真名端出来了 ⇒ 验收第②条「时间拉回揭穿之前不显示后来真名」落空');
    assert.equal(K.visibleAtFace(K.readTestimonyBoard(mkUp()).boards[0], 'surface')
        .visible.map((x) => x.character).indexOf('真名'), -1, '原版必须挡住');
});
test('D3 ★★★ 破坏「角色模式不给对方独有」⇒ B7 同款判据必转红（全知正文进角色上下文）', async () => {
    const dir = breakCopy(KERNEL_REL,
        '        for (const x of gated.onlyMine) {',
        '        for (const x of gated.onlyMine.concat(arr(obj(r.diff) && obj(r.diff).onlyRight))) {');
    const M = await loadKernel(dir, 'd3');
    const blk = M.perspectiveModePromptBlock('character', M.readPerspectiveContrast(mkUp(), '甲', '乙'), { current: '甲' });
    assert.ok(blk.indexOf('乙独有的事') >= 0,
        '★★★ 破坏副本：角色模式把对方独有的事实塞进了生成上下文 ⇒ 验收第③条「切换不把全知正文塞入角色生成上下文」落空');
    assert.ok(blk.indexOf('甲自己在场') >= 0, '破坏副本：正文还在（转红不是因为这条）');
    assert.equal(K.perspectiveModePromptBlock('character', K.readPerspectiveContrast(mkUp(), '甲', '乙'), { current: '甲' })
        .indexOf('乙独有的事'), -1, '原版必须一条都不给');
});
test('D4 ★★★ 破坏「模式非法不给块」⇒ B6 同款判据必转红（拿猜的模式喂全知正文）', async () => {
    const dir = breakCopy(KERNEL_REL, "        if (!plan.ok) return '';", '        if (false) return \'\';');
    const M = await loadKernel(dir, 'd4');
    const bad = M.perspectiveModePromptBlock('omnipotent', M.readPerspectiveContrast(mkUp(), '甲', '乙'), { current: '甲' });
    assert.notEqual(bad, '', '破坏副本：模式非法照样给块');
    assert.ok(bad.indexOf('甲自己在场') >= 0,
        '★★★ 破坏副本：用户选错了模式，手机照样按某个模式给上下文 ⇒ 把「用户选错了」显示成「用户选了作者」');
    assert.equal(K.perspectiveModePromptBlock('omnipotent', K.readPerspectiveContrast(mkUp(), '甲', '乙')), '', '原版必须不给块');
});
test('D5 ★★★ 破坏「720 恰好宽屏」⇒ B8 同款判据必转红（同一台设备两版不同）', async () => {
    const dir = breakCopy(KERNEL_REL,
        '    const narrow = !known || w < PCX_LIMITS.narrowWidth;',
        '    const narrow = !known || w <= PCX_LIMITS.narrowWidth;');
    const M = await loadKernel(dir, 'd5');
    assert.equal(M.layoutOf(720).layout, 'paged',
        '★★★ 破坏副本：边界从「<」变「<=」⇒ 720px 上两版手机给出两种版式（一版三列、一版逐人）');
    assert.equal(M.layoutOf(1280).layout, 'columns', '破坏副本：宽屏还是三列（转红不是因为这条）');
    assert.equal(K.layoutOf(720).layout, 'columns', '原版：恰好等于阈值按宽屏');
});
test('D6 ★★★ 破坏「未登记状态不当合法态」⇒ B9 同款判据必转红（把上游没登记的状态端出去）', async () => {
    const dir = breakCopy(KERNEL_REL,
        "        stateBefore: PCX_TB_STATES.indexOf(before) >= 0 ? before : '',",
        '        stateBefore: before,');
    const M = await loadKernel(dir, 'd6');
    const rv = M.readTestimonyRevoke({
        LonShaMemory: { engine: { testimonyRevoke: () => ({ version: 1, stateBefore: 'weird', stateAfter: 'weirder', changed: true }) } }
    }, ['k']);
    assert.equal(rv.stateBefore, 'weird',
        '★★★ 破坏副本：上游没登记的状态被当合法态端出 ⇒ 四态表之外的值混进界面（「为什么是这一态」再也说不清）');
    assert.equal(K.readTestimonyRevoke({
        LonShaMemory: { engine: { testimonyRevoke: () => ({ version: 1, stateBefore: 'weird', stateAfter: 'weirder', changed: true }) } }
    }, ['k']).stateBefore, '', '原版必须收敛成空串');
});
test('D7 ★★★ 破坏「误信侧单列」⇒ B3 同款判据必转红（误信被写成世界真相）', async () => {
    const dir = breakCopy(KERNEL_REL, '        misledSide: clip(d.misledSide)', '        misledSide: []');
    const M = await loadKernel(dir, 'd7');
    const line = M.contrastLine(M.readPerspectiveContrast(mkUp(), '甲', '乙'));
    assert.equal(line.indexOf('误信侧 1'), -1, '破坏副本：误信侧不再报出');
    assert.equal(line.indexOf('勿当世界真相'), -1,
        '★★★ 破坏副本：误信格没了警示 ⇒ 写手会把「丙误信了」当既定事实写进正文（这正是「不裁真相」要防的）');
    assert.ok(K.contrastLine(K.readPerspectiveContrast(mkUp(), '甲', '乙')).indexOf('误信侧 1') >= 0, '原版必须报出');
});
test('D8 ★★★ 破坏「接线层不写第二份身份视图清单」⇒ C4 同款判据必转红（内核放行的视图被接线层拒掉）', async () => {
    const dir = breakCopy(WIRE_REL,
        "        if (PCX_IDENTITY_VIEWS.indexOf(f) < 0) return { ok: false, reason: 'face-invalid' };",
        "        if (['surface'].indexOf(f) < 0) return { ok: false, reason: 'face-invalid' };");
    const W = await loadWire(dir, 'd8b');
    const wp = new W.CharsPerspective(fakeApp(null));
    assert.equal(wp.setFace('revealed').ok, false,
        '★★★ 破坏副本：接线层自写清单把内核放行的「已揭穿」拒掉 ⇒ 界面少一档，且与内核口径分叉（改一处不会同改）');
    assert.deepEqual(W.CharsPerspective ? wp.faceIds() : [], ['surface', 'revealed', 'all'], '破坏副本：清单出口仍报内核那三档（错在闸口）');
    const wp0 = new WIRE.CharsPerspective(fakeApp(null));
    assert.deepEqual(wp0.setFace('revealed'), { ok: true, face: 'revealed' }, '原版必须放行');
    assert.deepEqual(wp0.faceIds(), ['surface', 'revealed', 'all'], '原版清单与内核同一份');
});
test('D9 ★★★ 破坏「换会话作废现场」⇒ C7 同款判据必转红（旧会话选的角色带进新会话）', async () => {
    const anchor = [
        '    resetScene() {',
        "        this._current = '';",
        '        this._face = PCX_IDENTITY_VIEWS[0];'
    ].join(NL);
    const dir = breakCopy(WIRE_REL, anchor, '    resetScene() {' + NL + '        /* 破坏：不清现场 */');
    const W = await loadWire(dir, 'd9');
    const wp = new W.CharsPerspective(fakeApp(null));
    wp.setCurrent('甲');
    wp.setFace('revealed');
    wp.resetScene();
    assert.equal(wp.current(), '甲',
        '★★★ 破坏副本：换会话不作废 ⇒ 上一会话选中的角色名带进新会话的**角色模式生成块**（不报错，只是错上下文）');
    assert.equal(wp.face(), 'revealed', '破坏副本：身份视图也没回未揭穿（剧透风险）');
    const wp0 = new WIRE.CharsPerspective(fakeApp(null));
    wp0.setCurrent('甲');
    wp0.setFace('revealed');
    wp0.resetScene();
    assert.equal(wp0.current(), '', '原版必须作废');
    assert.equal(wp0.face(), 'surface', '原版必须回未揭穿');
});
test('D10 ★★★ 破坏「插件不在场与真读数空不同形」⇒ A1/B1 同款判据必转红（该去装插件 vs 该去聊一楼）', async () => {
    const anchor = [
        "    if (!engineHas && !moduleHas) return faceOf(PCX_STATES.ENGINE_ABSENT, 'engine-absent');",
        '    if (!a || !b)'
    ].join(NL);
    const dir = breakCopy(KERNEL_REL, anchor,
        ["    if (!engineHas && !moduleHas) return faceOf(PCX_STATES.EMPTY, 'empty');", '    if (!a || !b)'].join(NL));
    const M = await loadKernel(dir, 'd10');
    assert.equal(M.readPerspectiveContrast(null, '甲', '乙').state, S.EMPTY,
        '★★★ 破坏副本：没装插件被显示成「真跑过、没有可对照的内容」⇒ 用户以为去聊一楼就能解决，实际该去装插件');
    assert.equal(K.readPerspectiveContrast(null, '甲', '乙').state, S.ENGINE_ABSENT, '原版必须分开报');
    assert.equal(K.readPerspectiveContrast(mkUp({
        contrast: () => ({ version: 1, leftPresent: false, rightPresent: false, diff: {} })
    }), '甲', '乙').state, S.EMPTY, '原版：真读数空仍走 empty（两态并存）');
});
/* ══════════ E ── 版本锚 ══════════ */
test('E1 五源同源（不锁死具体版本值，但必须一致且当版条目在场）', () => {
    const pkg = JSON.parse(read('package.json'));
    const man = JSON.parse(read('manifest.json'));
    const log = JSON.parse(read('update-log.json'));
    const ver = pkg.version;
    assert.match(ver, /^\d+\.\d+\.\d+$/, '版本号形态必须正常:' + ver);
    assert.equal(man.version, ver, 'manifest 与 package 必须同版');
    assert.equal(log.latest, ver, 'update-log.latest 必须同版');
    assert.equal(log.head, ver, 'update-log.head 必须同版');
    assert.ok(log.versions[ver], '当版条目必须存在');
    const items = (log.versions[ver] && log.versions[ver].items) || [];
    assert.ok(Array.isArray(items) && items.length >= 8, '当版公告至少 8 条');
    assert.ok(read('index.js').indexOf("const ST_PHONE_VERSION = '" + ver + "';") >= 0, 'index.js 版本常量必须同源');
    assert.ok(read('ITERATION_LOG.md').indexOf('v' + ver) >= 0, 'ITERATION_LOG 必须记这一版');
    /* ★ 下面这几条断的是「**v4.26.0 这一版**记全了」，故必须锁**自己那一版**的字面量，
     *   不能跟随 `pkg.version`：抬到下一版的那一刻，`ver` 会变成新版，
     *   而新版公告里当然没有本版的件名 ⇒ 判据会因「抬版」而转红 ——
     *   那是判据写错了主语（它想说「这一版记全了」，写成了「当前这一版记全了」）。
     *   五源一致性（上面三条）是全局不变量，继续跟随 `ver` 不受影响。 */
    const own = log.versions['4.26.0'];
    assert.ok(own, 'v4.26.0 条目必须在账上（历史留痕不删）');
    const all = (own.items || []).join(NL);
    assert.ok(all.indexOf('chars-perspective.js') >= 0, 'v4.26.0 公告必须记接线件');
    assert.ok(all.indexOf('J19') >= 0, 'v4.26.0 公告必须记门禁标签');
    assert.ok(all.indexOf('运行时验证边界') >= 0, 'v4.26.0 公告必须记运行时边界');
    assert.ok(all.indexOf('testimonyBoard') >= 0, 'v4.26.0 公告必须记证词面 id');
});
