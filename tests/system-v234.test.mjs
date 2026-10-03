/* ============================================================
 * RubyPhone v2.34.0 —— 重复存活域 + 会话级槽位唯一出口
 *
 * 本版问题（四条账目的共同盲区）：
 *   v2.31 记「回收过几笔」、v2.32 把**两本账**（回收账本与过早账本）合读、
 *   v2.33 记「是谁造成的」、v2.30 的 overDisposed 记「同一对象被回收后复活」——
 *   **四条账目全部只描述「回收以后」**。而宿主重建路径上还有第四种形态：
 *   **建了同名新域、旧域却没被收掉**（域表里同时活着两个同名域，旧域的定时器/
 *   监听器继续跑、闭包钉住旧 DOM）。此时「回收」一次都没发生，
 *   于是它在上面四本账上完全不可见。
 *
 * 真实触发路径不是假设：chat-view.js 的三处懒加载是 check-then-act
 *   （先判 `if (!VirtualPhone.xxxApp)` → `await import(...)` → **await 之后直接
 *   new 并写回**）——await 期间另一个入口把实例建好时，这里会 new 出第二个同名
 *   实例。本版在三处 await 后补重查（根治），并让重复存活域成为可见读数（兜住）。
 *
 * 本文件的判据形态：
 *   · A 段在**真域上执行**取证「正确重建 vs 重复建域」四本账同形、唯一区分点；
 *   · 锚点字面量全文件**只声明一次**（A 常量表），判据与破坏共用它（H5 判据纯度）；
 *   · 每个核心判据配一次负控制，且负控制为「真源码破坏 → 加载副本 → 同款判据翻红」；
 *   · 负控制分文本级与**行为级**两种，行为级在破坏副本上真执行场景。
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
/* ---------- 行级剥注释（文本判据一律在代码行上做，避免被注释字样满足） ---------- */
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
/* ---------- mock DOM：真实注册表语义（引用不相等就不解绑） ---------- */
const registry = [];
function makeTarget(name) {
    return {
        addEventListener(type, handler, opts) { registry.push({ target: name, type, handler, capture: opts === true }); },
        removeEventListener(type, handler, opts) {
            const cap = opts === true;
            const i = registry.findIndex(r => r.target === name && r.type === type
                && r.handler === handler && r.capture === cap);
            if (i >= 0) registry.splice(i, 1);
        },
    };
}
function makeEl(tag = 'div') {
    return {
        tagName: tag, style: {}, dataset: {}, className: '', innerHTML: '', textContent: '',
        classList: { add() { }, remove() { }, toggle() { }, contains() { return false; } },
        children: [],
        setAttribute() { }, removeAttribute() { },
        remove() { }, appendChild(c) { this.children.push(c); return c; },
        querySelector() { return makeEl(); }, querySelectorAll() { return []; },
        addEventListener() { }, removeEventListener() { },
        getBoundingClientRect() { return { width: 100, height: 100, left: 0 }; },
    };
}
globalThis.window = Object.assign(makeTarget('window'),
    { VirtualPhone: { storage: { get: () => null, set: () => { } } } });
globalThis.document = Object.assign(makeTarget('document'), {
    hidden: false, createElement: (t) => makeEl(t), getElementById: () => null,
});
const K = await import('../config/runtime-lifecycle.js');
import * as KERNEL from '../config/runtime-lifecycle.js';
const t = { addEventListener() { }, removeEventListener() { } };

/* ============================================================
 * 锚点字面量（全文件只声明一次）+ 判据（与破坏共用同一份）
 * ============================================================ */
const A = {
    kernelFloor: 'const floor = Math.max(2, Number(min) || 2);',
    kernelHit: 'if (c >= floor) out[name] = c;',
    kernelSnap: 'duplicates: childRuntimeDuplicates(),',
    ccGate: "if (!dupNames.length) return '';",
    /* 注意：本锚点**不得含块注释** —— codeOf 会剥掉 `/* 忽略 *​/`，锚点就再也匹配不到
       （首版踩过：锚点写成带块注释的整行 → 破坏时命中 0 次直接抛）。 */
    hostExitCall: 'try { retireSessionScopedSlots(); }',
    // 阈值「放宽到 1」必须**同时**放宽默认参数与下界：只改下界（Math.max(1, ... || 2)）
    // 时无参调用走默认 min=2 -> Math.max(1, 2) = 2，破坏实际不生效
    // （首版踩过：负控制假绿，real=true 且 broken=true）。
    kernelFloorLoose: 'export function childRuntimeDuplicates(min = 2) {\n    const floor = Math.max(2, Number(min) || 2);',
    raceMusic: "if (window.VirtualPhone?.musicApp) return window.VirtualPhone.musicApp;\n            window.VirtualPhone.musicApp = new module.MusicApp(",
};
const judges = {
    /* B 同款：阈值口径 = 非法阈值回落 2（两个锚点缺一不可） */
    threshold: (code) => code.includes(A.kernelFloor) && code.includes(A.kernelHit),
    /* C 同款：快照真的带了 duplicates 字段 */
    snap: (code) => code.includes(A.kernelSnap),
    /* C 同款：控制中心告警行的健康态门控（无重复则不渲染节点） */
    ccGate: (code) => code.includes(A.ccGate),
    /* D 同款：唯一出口真的挂在 reloadPhoneSurface 里 */
    hostExit: (code) => /function reloadPhoneSurface\(\)[\s\S]{0,400}retireSessionScopedSlots\(\)/.test(code),
    /* E 同款：chat-view 三处 await 懒建各自在赋值前重查槽位 */
    raceRecheck: (code) => {
        const ms = [...code.matchAll(/await import\('\.\.\/(?:music|honey|weibo)\/[a-z]+-app\.js'\)/g)];
        const hit = ms.filter(m => /VirtualPhone\?\.\w+App/.test(code.slice(m.index, m.index + 700)));
        return ms.length === 3 && hit.length === 3;
    },
};
const KERNEL_SRC = read('config/runtime-lifecycle.js');
const KERNEL_CODE = codeOf(KERNEL_SRC);
const IDX_SRC = read('index.js');
const IDX_CODE = codeOf(IDX_SRC);
// 内置公告是**代码里的字符串字面量**（不是注释），它在正文里点名本版新增的函数名，
// 那是给用户看的说明文字、不是消费点。凡「宿主代码体里有没有……」一类判据
// （C3 零重复记账 / F8b 注释纯度）必须先剥掉公告块，否则判据会被说明文字满足。
const IDX_BODY_SRC = (() => {
    const hit = /const ST_PHONE_CURRENT_UPDATE = \{[\s\S]*?\n\};/.exec(IDX_SRC);
    return hit ? IDX_SRC.slice(0, hit.index) + IDX_SRC.slice(hit.index + hit[0].length) : IDX_SRC;
})();
const IDX_BODY_CODE = codeOf(IDX_BODY_SRC);
ok('锚点前提 · 内置公告块已定位并剥离（剥离前提失效时此处先翻红）',
    IDX_BODY_SRC.length < IDX_SRC.length, `${IDX_SRC.length} -> ${IDX_BODY_SRC.length}`);
const CC_CODE = codeOf(read('phone/control-center.js'));
const CV_CODE = codeOf(read('apps/wechat/chat-view.js'));
/* 锚点唯一性自证：锚点漂移时先在此处翻红，而不是让后面的破坏静默失配 */
{
    const uniq = [
        ['kernelFloor', KERNEL_SRC.split(A.kernelFloor).length - 1, 1],
        ['kernelFloorLoose', KERNEL_SRC.split(A.kernelFloorLoose).length - 1, 1],
        ['kernelHit', KERNEL_SRC.split(A.kernelHit).length - 1, 1],
        ['kernelSnap', KERNEL_SRC.split(A.kernelSnap).length - 1, 1],
        ['ccGate', CC_CODE.split(A.ccGate).length - 1, 1],
        ['hostExitCall', IDX_CODE.split(A.hostExitCall).length - 1, 1],
        ['raceMusic', CV_CODE.split(A.raceMusic).length - 1, 1],
    ];
    for (const [n, got, want] of uniq) {
        ok(`锚点唯一性 · ${n}（恰 ${want} 次）`, got === want, `got=${got}`);
    }
}

/* ============================================================
 * A. 核心取证：正确重建 vs 重复建域，在四本账上是否同形
 * ============================================================ */
const reent = () => K.childRuntimeOverDisposed().reenters;
/* 正确路径：建 3 只，每次**先收后建** */
function runRight() {
    K.disposeChildRuntimes('');
    const re0 = reent();
    let statsMax = 0, dupMax = 0;
    for (let i = 0; i < 3; i++) {
        const rt = K.childRuntime('a-core');
        rt.addListener(t, 'click', () => { }, false, 'a' + i);
        // 两个读数各记一件事：stats 记「同时活着几个」（健康态 = 1），
        // duplicates 记「有没有超过 1」（健康态 = 空，即不出声）。
        statsMax = Math.max(statsMax, K.childRuntimeStats('a-core'));
        dupMax = Math.max(dupMax, K.childRuntimeDuplicates()['a-core'] || 0);
        rt.dispose();
    }
    return {
        released: K.childRuntimeReleaseLog('a-core'),
        premature: K.childRuntimePrematureLog('a-core'),
        by: JSON.stringify(K.childRuntimePrematureBy('a-core')),
        reenters: reent() - re0,
        statsMax, dupMax,
        maxDup: dupMax,
        dupAtEnd: Object.keys(K.childRuntimeDuplicates()).length,
    };
}
/* 错误路径：建 3 只**不收**，事后统一收掉 */
function runWrong() {
    K.disposeChildRuntimes('');
    const re0 = reent();
    const rts = [];
    for (let i = 0; i < 3; i++) {
        const rt = K.childRuntime('b-core');
        rt.addListener(t, 'click', () => { }, false, 'b' + i);
        rts.push(rt);
    }
    const dupInWindow = K.childRuntimeDuplicates()['b-core'] || 0;
    const releasedInWindow = K.childRuntimeReleaseLog('b-core');
    const prematureInWindow = K.childRuntimePrematureLog('b-core');
    rts.forEach(rt => rt.dispose());          // 事后统一收掉
    return {
        dupInWindow, releasedInWindow, prematureInWindow,
        released: K.childRuntimeReleaseLog('b-core'),
        premature: K.childRuntimePrematureLog('b-core'),
        by: JSON.stringify(K.childRuntimePrematureBy('b-core')),
        reenters: reent() - re0,
        maxDup: dupInWindow,
        dupAtEnd: Object.keys(K.childRuntimeDuplicates()).length,
    };
}
const R = runRight();
const W = runWrong();
{
    /* A1 正确路径：域表里始终只有 1 个，收完为 0 */
    ok('A1a 正确路径·同名域从未同时超过 1 个', R.statsMax === 1, `statsMax=${R.statsMax}`);
    ok('A1a2 正确路径·告警读数恒为空（健康态不出声）', R.dupMax === 0, `dupMax=${R.dupMax}`);
    ok('A1b 正确路径·收尾后无重复存活', R.dupAtEnd === 0, `dupAtEnd=${R.dupAtEnd}`);
    ok('A1c 正确路径·三笔回收全部落账', R.released === 3, `released=${R.released}`);
    /* A2 错误路径：窗口期 3 个同名域同时活着，而账本**一笔都没有** */
    ok('A2a 错误路径·窗口期同名域同时存活 3 个', W.dupInWindow === 3, `dup=${W.dupInWindow}`);
    ok('A2b 错误路径·「回收根本没发生过」——窗口期回收账本 0 笔',
        W.releasedInWindow === 0 && W.prematureInWindow === 0,
        `released=${W.releasedInWindow} premature=${W.prematureInWindow}`);
    /* A3 四本账逐项相等：这就是「在 duplicates 之前完全不可见」的直接证据 */
    ok('A3a 回收笔数同形（3 / 3）', R.released === W.released && R.released === 3,
        `${R.released} / ${W.released}`);
    ok('A3b 过早笔数同形（0 / 0）', R.premature === W.premature && R.premature === 0,
        `${R.premature} / ${W.premature}`);
    ok('A3c 成因账同形（{} / {}）', R.by === W.by && R.by === '{}', `${R.by} / ${W.by}`);
    ok('A3d 过度回收遥测同形（0 / 0）', R.reenters === W.reenters && R.reenters === 0,
        `${R.reenters} / ${W.reenters}`);
    /* A4 唯一区分点 = 重复存活 */
    ok('A4 两路的**唯一**区分点是重复存活（正确路径告警恒空 / 错误路径 3 只同时活着）',
        R.dupMax === 0 && R.statsMax === 1 && W.maxDup === 3,
        `right dup=${R.dupMax} stats=${R.statsMax} / wrong dup=${W.maxDup}`);
    /* A5 该读数的语义是「当下同时存活」而非历史累计：事后统一收掉即归零 */
    ok('A5 事后收掉后重复读数归零（不是历史累计）', W.dupAtEnd === 0, `dupAtEnd=${W.dupAtEnd}`);
    /* A6 与账本互补：账本记历史、本读数记当下 —— 错误路径的账本一笔不少 */
    ok('A6 错误路径事后收掉仍是 3 笔回收账（账本只记历史）', W.released === 3, String(W.released));
    K.disposeChildRuntimes('');
}

/* ============================================================
 * B. 口径边界：阈值、非法输入、排序、空态
 * ============================================================ */
{
    K.disposeChildRuntimes('');
    /* B1 单只域名（健康态）不得命中 */
    K.childRuntime('b-one');
    ok('B1 单只域名不命中（空才是正常态）',
        Object.keys(K.childRuntimeDuplicates()).length === 0);
    K.disposeChildRuntimes('');
    /* B2 恰 2 只命中；默认阈值 2 */
    K.childRuntime('b-two'); K.childRuntime('b-two');
    ok('B2 恰 2 只命中且计数为 2',
        K.childRuntimeDuplicates()['b-two'] === 2, JSON.stringify(K.childRuntimeDuplicates()));
    ok('B3 min 可上抬（min=3 时 2 只不命中）',
        Object.keys(K.childRuntimeDuplicates(3)).length === 0);
    /* B4 非法阈值一律**回落 2**（不是放宽到 1）：阈值写坏不得把健康态报成缺陷。
       注意必须先在**健康态**（恰 1 只域名）上测：此刻域表里还留着 B2 建的两只同名域，
       不先清理就会把「阈值回落正确」误判成「报警了」（首版踩过：b-two 混进结果）。 */
    K.disposeChildRuntimes('');
    K.childRuntime('b-single');
    const badMin = [0, 1, -5, NaN, 'x', null, undefined, {}, []];
    ok('B4 非法阈值全部回落 2（单只域名在任何非法阈值下都不报警）',
        badMin.every(v => Object.keys(K.childRuntimeDuplicates(v)).length === 0),
        JSON.stringify(badMin.map(v => K.childRuntimeDuplicates(v))));
    ok('B4b 健康态自证：该单只域名确实在域表里（不是因为域表空才不报警）',
        K.childRuntimeStats('b-single') === 1);
    /* B5 键视图与计数视图同源、按名排序 */
    K.childRuntime('b-two'); K.childRuntime('b-two');   // B4 前清过一次，这里补回
    K.childRuntime('b-zzz'); K.childRuntime('b-zzz');
    K.childRuntime('b-aaa'); K.childRuntime('b-aaa');
    const doms = K.childRuntimeDuplicateDomains();
    ok('B5a 键视图与计数视图一致（同一真源）',
        JSON.stringify(doms) === JSON.stringify(Object.keys(K.childRuntimeDuplicates()).sort()),
        JSON.stringify(doms));
    ok('B5b 键视图按名排序', JSON.stringify(doms) === JSON.stringify(['b-aaa', 'b-two', 'b-zzz']),
        JSON.stringify(doms));
    ok('B5c 只列超阈域名（未超阈的 b-single 不在内）', !doms.includes('b-single'));
    /* B6 空域表安全降级 */
    K.disposeChildRuntimes('');
    ok('B6 空域表返回空对象 / 空数组（不抛）',
        Object.keys(K.childRuntimeDuplicates()).length === 0
        && K.childRuntimeDuplicateDomains().length === 0);
    /* B7 阈值比较必须是 >=floor（不是 >0 之类的粗判） */
    ok('B7 阈值口径：floor 由 Math.max(2, ...) 得来且按 >=floor 命中',
        judges.threshold(KERNEL_CODE));
}

/* ============================================================
 * C. 快照与消费点接线
 * ============================================================ */
{
    K.disposeChildRuntimes('');
    K.childRuntime('c-dup'); K.childRuntime('c-dup');
    const s = K.globalRuntimeSnapshot();
    ok('C1a 快照含 duplicates 字段', s.duplicates && typeof s.duplicates === 'object');
    ok('C1b 快照 duplicates 与直读一致（同一真源，非二次记账）',
        JSON.stringify(s.duplicates) === JSON.stringify(K.childRuntimeDuplicates()),
        JSON.stringify(s.duplicates));
    ok('C1c 快照口径受阈值同款约束（judge 同款式）', judges.snap(KERNEL_CODE));
    K.disposeChildRuntimes('');
    /* C2 诊断面把内核字段提升为契约（字段恒在） */
    ok('C2a 诊断面暴露 duplicates 契约字段', /snap\.duplicates\s*=/.test(IDX_CODE));
    ok('C2b 降级分支也含 duplicates（异常时字段不消失）', /duplicates:\s*\{\s*\}/.test(IDX_CODE));
    /* C3 反冗余自证：宿主**不得**再调内核原语造第二本账（本版批评的形态） */
    ok('C3 宿主零重复记账（宿主代码体内无 childRuntimeDuplicateDomains 消费）',
        !/childRuntimeDuplicateDomains/.test(IDX_BODY_CODE));
    /* C4 控制中心告警行 */
    ok('C4a 控制中心从内核导入重复域原语（告警行的直接消费点）',
        /import\s*\{[^}]*childRuntimeDuplicateDomains[^}]*\}\s*from\s*'\.\.\/config\/runtime-lifecycle\.js'/.test(CC_CODE));
    ok('C4b 告警行渲染方法存在', /_dupHtml\(\)\s*\{/.test(CC_CODE));
    ok('C4c 告警行被插进面板（不是定义了不调用 = 死代码）',
        /\$\{this\._dupHtml\(\)\}/.test(CC_CODE));
    ok('C4d 健康态不出声：无重复时不渲染任何节点', judges.ccGate(CC_CODE));
    ok('C4e 告警受重复数驱动（data-dup-domains 由域名数决定）',
        /data-dup-domains="\$\{dupNames\.length\}"/.test(CC_CODE));
    ok('C4f 读取包在 try 里（面板任何一块坏掉不拖垮整体）', (() => {
        const at = CC_CODE.indexOf('_dupHtml() {');
        const box = CC_CODE.slice(at, at + 600);
        return /try\s*\{/.test(box) && /catch/.test(box);
    })());
    ok('C4g 样式存在（出现即缺陷，无需区分形态）', read('phone.css').includes('.sys-cc-dups'));
}

/* ============================================================
 * D. 宿主：会话级数据槽位的唯一出口
 * ============================================================ */
{
    ok('D1 唯一出口存在', /function retireSessionScopedSlots\s*\(/.test(IDX_CODE));
    ok('D2 出口挂在 reloadPhoneSurface 里（三条路径共用）', judges.hostExit(IDX_CODE));
    ok('D3 出口调**实例自身的出口**而非只置 null',
        /worldpulseApp\.destroy\?\.\(\)/.test(IDX_CODE) && /gamesApp\.deactivate\?\.\(\)/.test(IDX_CODE));
    ok('D4 出口幂等不抛（无宿主时早退 0，整体包 try）', (() => {
        const at = IDX_CODE.indexOf('function retireSessionScopedSlots() {');
        const box = IDX_CODE.slice(at, at + 700);
        return /if \(!phone\) return 0;/.test(box) && /catch\s*\(_e\)\s*\{/.test(box);
    })());
    /* D5 三条清数据路径仍走同一出口（v2.31 契约不得回退） */
    const nReload = (IDX_CODE.match(/try \{ reloadPhoneSurface\(\); \}/g) || []).length;
    ok('D5 三条清数据路径 + 其它界面重建点都走 reloadPhoneSurface（>= 3 处）', nReload >= 3, String(nReload));
    // 注意：本判据必须用**未剥注释**的原文 —— catch 里的块注释会被 codeOf 剥掉，
    // 锚点就恒匹配 0 次（首版踩过：0 !== 3 的假红）。
    ok('D6 所有 reloadPhoneSurface 调用点都在 try/catch 内',
        (IDX_SRC.match(/try \{ reloadPhoneSurface\(\); \} catch \(_e\) \{ \/\* 忽略 \*\/ \}/g) || []).length
        === (IDX_SRC.match(/[^a-zA-Z]reloadPhoneSurface\(\);/g) || []).length,
        `${(IDX_SRC.match(/try \{ reloadPhoneSurface\(\); \}/g) || []).length} / ${(IDX_SRC.match(/[^a-zA-Z]reloadPhoneSurface\(\);/g) || []).length}`);
    /* D7 出口必须在 destroyPhoneSurface **之前**调用：先收数据实例的会话态，
       再收界面槽位（否则界面已重建、数据仍指向旧会话） */
    ok('D7 出口先于 destroyPhoneSurface（收数据 ≈ 界面重生的先后序）',
        (() => {
            const at = IDX_CODE.indexOf('function reloadPhoneSurface() {');
            const box = IDX_CODE.slice(at, at + 300);
            return box.indexOf('retireSessionScopedSlots()') < box.indexOf('destroyPhoneSurface()');
        })());
    /* D8 两条被漏的槽位在注释里有指向（防止后人误以为它们「不需要回收」） */
    ok('D8 P2/P3 指向唯一出口的注释齐备（清单式回收的替代说明）',
        (IDX_SRC.match(/会话级数据槽位/g) || []).length >= 2);
}

/* ============================================================
 * E. 竞态根治：await 之后的 check-then-act
 * ============================================================ */
{
    ok('E1 chat-view 三处 await 懒建均在赋值前重查槽位', judges.raceRecheck(CV_CODE));
    ok('E2 三处懒建入口齐备（music / honey / weibo）',
        ['_ensureMusicAppForInvite', '_ensureHoneyAppReady']
            .every(n => CV_CODE.includes(n))
        && /await import\('\.\.\/weibo\/weibo-app\.js'\)/.test(CV_CODE));
    ok('E3 重查与 index.js 既有正确写法同构（先判后建，不裸建）',
        /if \(!window\.VirtualPhone\.honeyApp\) \{\s*\n\s*window\.VirtualPhone\.honeyApp = new/.test(IDX_CODE)
        && /if \(!window\.VirtualPhone\.honeyApp\) \{\s*\n\s*window\.VirtualPhone\.honeyApp = new/.test(CV_CODE));
}

/* ============================================================
 * F. 负控制：真源码破坏 → 加载副本 → 同款判据必须翻红
 * ============================================================ */
function negative(real, broken, label) {
    /* 严格两向形式：**同一**判据必须在原版上为真、在真源码破坏副本上为假。
       只查一侧都会假绿：① 只查原版 —— 破坏没发生也绿；③ 只查副本 —— 破坏把判据
       自己删掉也绿（自我指涉）。两向 + 同款表达式才构成负控制。 */
    ok('F ' + label + ' → 判据必须翻红', real === true && broken === false,
        `real=${real} broken=${broken}`);
}
/** 真源码破坏：锚点必须恰中 1 次，否则抛（工具两向自证）。 */
function breakSrc(src, anchor, repl) {
    const n = src.split(anchor).length - 1;
    if (n !== 1) throw new Error(`锚点命中 ${n} 次（要求恰 1 次）`);
    const broken = src.split(anchor).join(repl);
    if (broken === src) throw new Error('破坏未改字节');
    return broken;
}
const breakKernel = (a, r) => breakSrc(KERNEL_SRC, a, r);
let _vseq = 0;
async function loadBroken(src) {
    return await import('data:text/javascript;charset=utf-8;base64,'
        + Buffer.from(src, 'utf8').toString('base64') + '#v' + (++_vseq));
}
/* 行为级场景（同款判据只有一份，在原版与破坏副本上各跑一遍） */
const SC_cleanNoAlarm = (m) => {          // B1/B4 同款：单只域名**不得**被报成重复
    m.disposeChildRuntimes('');
    m.childRuntime('sc-clean');
    const r = Object.keys(m.childRuntimeDuplicates()).length === 0
        && m.childRuntimeDuplicateDomains().length === 0;
    m.disposeChildRuntimes('');
    return r;
};
const SC_pairAlarm = (m) => {             // B2 同款：恰 2 只必须命中且计数为 2
    m.disposeChildRuntimes('');
    m.childRuntime('sc-pair'); m.childRuntime('sc-pair');
    const r = m.childRuntimeDuplicates()['sc-pair'] === 2;
    m.disposeChildRuntimes('');
    return r;
};
{
    /* F1 行为级破坏：阈值比较退回「> 0」→ 健康态（单只域名）被误报成重复 */
    {
        const b = await loadBroken(breakKernel(A.kernelHit, 'if (c > 0) out[name] = c;'));
        negative(SC_cleanNoAlarm(KERNEL), SC_cleanNoAlarm(b), '阈值退回「> 0」使健康态报警');
        ok('F1b 该破坏下「2 只命中」仍成立（说明破坏只动了健康态方向，判据不是恒假）',
            SC_pairAlarm(b) === true);
    }
    /* F2 行为级 + 文本级破坏：阈值回落值从 2 放宽到 1。
       必须**同时**放宽默认参数（min = 2 -> 1）与下界：只改下界时无参调用走默认 min=2，
       `Math.max(1, Number(2) || 2)` 仍是 2 —— 破坏不生效（首版踩过：real=true 且
       broken=true 的负控制假绿，判据看起来跑过、其实什么都没验到）。 */
    {
        const brokenSrc = breakKernel(A.kernelFloorLoose,
            'export function childRuntimeDuplicates(min = 1) {\n    const floor = Math.max(1, Number(min) || 1);');
        const b = await loadBroken(brokenSrc);
        negative(SC_cleanNoAlarm(KERNEL), SC_cleanNoAlarm(b), '非法阈值放宽到 1（单只即报警）');
        /* 文本级同款：注意必须对**破坏后的源码字符串**跑判据 —— 把模块命名空间对象
           塞进 codeOf 会抛 `Cannot convert object to primitive value`（首版踩过）。 */
        negative(judges.threshold(KERNEL_CODE), judges.threshold(codeOf(brokenSrc)),
            '阈值口径锚点消失（放宽到 1）');
    }
    /* F3 文本级破坏：快照不再带 duplicates → C 同款判据翻红 */
    {
        const broken = breakKernel(A.kernelSnap, '');
        negative(judges.snap(KERNEL_CODE), judges.snap(codeOf(broken)), '快照丢了 duplicates 字段');
    }
    /* F4 文本级破坏：控制中心健康态门控被去掉 → 恒渲染告警行（噪声遥测） */
    {
        const broken = breakSrc(CC_CODE, A.ccGate, '');
        negative(judges.ccGate(CC_CODE), judges.ccGate(broken), '告警行失去健康态门控（恒出声）');
    }
    /* F5 文本级破坏：唯一出口不再被 reloadPhoneSurface 调用 → 接线断开 */
    {
        const broken = breakSrc(IDX_CODE, A.hostExitCall, '');
        negative(judges.hostExit(IDX_CODE), judges.hostExit(broken), '唯一出口接线断开（三路径失去回收）');
    }
    /* F6 文本级破坏：chat-view 少一处 await 后重查 → 竞态判据翻红 */
    {
        const broken = breakSrc(CV_CODE, A.raceMusic, 'window.VirtualPhone.musicApp = new module.MusicApp(');
        negative(judges.raceRecheck(CV_CODE), judges.raceRecheck(broken), 'await 后不再重查（同名实例竞态复活）');
    }
    /* F7 工具两向自证（H6：锚点不存在 / 不唯一 / 未改字节 都必须抛） */
    {
        const bad = (label, fn) => {
            let threw = false;
            try { fn(); } catch (_e) { threw = true; }
            ok('F7 ' + label, threw, '工具未对失效输入抛错（假绿通道）');
        };
        bad('锚点不存在须抛', () => breakSrc(KERNEL_SRC, '__NO_SUCH_ANCHOR__', 'x'));
        bad('锚点不唯一须抛', () => breakSrc(KERNEL_SRC, 'const ', 'const '));
        bad('破坏未改字节须抛', () => breakSrc(KERNEL_SRC, A.kernelHit, A.kernelHit));
        bad('chat-view 锚点不存在须抛', () => breakSrc(CV_CODE, '__NO_CV_ANCHOR__', 'x'));
    }
    /* F8 判据纯度：剥注释副本不得残留本版注释独有字样 —— 否则判据可被注释满足 */
    ok('F8a 剥注释副本不残留本版内核注释独有字样',
        !KERNEL_CODE.includes('四条账目全部只描述'));
    ok('F8b 剥注释副本不残留本版宿主注释独有字样（公告块已剥离）',
        !IDX_BODY_CODE.includes('会话级数据槽位'));
    ok('F8c 剥注释不吞代码本体（宿主）',
        IDX_CODE.includes('function retireSessionScopedSlots()')
        && IDX_CODE.includes('function reloadPhoneSurface()'));
    ok('F8d 剥注释不吞代码本体（控制中心）', /_dupHtml\(\)\s*\{/.test(CC_CODE));
    K.disposeChildRuntimes('');
}

/* ============================================================
 * G. 发布卫生
 * ============================================================ */
{
    const manifest = JSON.parse(read('manifest.json'));
    const pkg = JSON.parse(read('package.json'));
    const log = JSON.parse(read('update-log.json'));
    const v = (/const ST_PHONE_VERSION = '([^']+)'/.exec(IDX_SRC) || [])[1];
    ok('G1 index.js 版本 >= 2.34.0', vnum(v) >= vnum('2.34.0'), v);
    ok('G2 manifest 同版', manifest.version === v, `${manifest.version} vs ${v}`);
    ok('G3 package.json 同版', pkg.version === v, `${pkg.version} vs ${v}`);
    ok('G4 update-log 有本版条目', !!log.versions?.[v]);
    ok('G5 update-log.latest 指向当前版本', log.latest === v, `${log.latest} vs ${v}`);
    ok('G6 versions 头部即当前版本', Object.keys(log.versions || {})[0] === v,
        String(Object.keys(log.versions || {})[0]));
    const items = (log.versions?.[v]?.items) || [];
    const joined = items.join('\n');
    /* [v2.35.0] 交棒：G7a/G7b 原用**当前版本** v 的条目查本版叙事词 —— 每发一版必翻红。
       改钉 2.34.0 这条历史条目（历史叙事不会变）。 */
    const v234Joined = ((log.versions?.['2.34.0'] || {}).items || []).join('\n');
    ok('G7a 本版条目覆盖主线（钉 2.34.0 历史条目：重复存活 / 同名域）',
        /重复存活/.test(v234Joined) && /同名域/.test(v234Joined), String(v234Joined.length));
    ok('G7b 承接历史主线关键词（回收口径 / 两本账 / 成因 / 重建路径）',
        /回收口径/.test(v234Joined) && /两本账/.test(v234Joined)
        && /成因/.test(v234Joined) && /重建路径|实例被丢弃|回收账本/.test(v234Joined));
    ok('G8 条目数 >= 4', items.length >= 4, String(items.length));
    /* G9 内置公告与日志逐字同源（仓库私有时远端恒 404，公告是用户唯一能看到的说明） */
    const blk = (IDX_SRC.match(/const ST_PHONE_CURRENT_UPDATE = \{[\s\S]*?\n\};/) || [''])[0];
    ok('G9a 内置公告存在且 version 引用常量', blk.length > 0 && /version:\s*ST_PHONE_VERSION/.test(blk));
    const inner = blk.slice(blk.indexOf('items: [') + 'items: ['.length, blk.lastIndexOf(']'));
    let ann = null;
    try { ann = JSON.parse('[' + inner.replace(/,\s*$/, '') + ']'); } catch (_e) { ann = null; }
    ok('G9b 公告可解析为字符串数组', Array.isArray(ann) && ann.every(s => typeof s === 'string'));
    ok('G9c 公告与本版日志逐字同源', Array.isArray(ann) && items.every(it => ann.includes(it)),
        `ann=${ann ? ann.length : 'null'} log=${items.length}`);
    /* G10 交棒基线：历史主线条目仍钉住 */
    ok('G10a 2.33.0 历史条目仍在（成因账主线）',
        ((log.versions?.['2.33.0'] || {}).items || []).join('\n').includes('成因'));
    ok('G10b 2.32.0 历史条目仍在（回收口径 / 两本账主线）',
        /回收口径|两本账/.test(((log.versions?.['2.32.0'] || {}).items || []).join('\n')));
    ok('G10c 2.31.0 历史条目仍在（回收账本主线）',
        /账本|releasedAt/.test(((log.versions?.['2.31.0'] || {}).items || []).join('\n')));
    /* G11 既有实现形态不得被本版改写（v2.31 起被多处钉定的口径） */
    ok('G11a 账本按对象只记一笔的实现仍在',
        /if \(!this\._releaseLogged\)/.test(KERNEL_CODE));
    ok('G11b 过早判据本体一字未改（仍是计数比较式）',
        /_reenteredAfterDispose > this\._prematureReleases/.test(KERNEL_CODE));
    ok('G11c 域自持出口仍在（v2.29 契约：按自持表地址注销，不查全表）',
        /this\._childLog\.delete\(this\)/.test(KERNEL_CODE)
        && /rt\._childLog = _childRuntimes;/.test(KERNEL_CODE));
    /* G12 本版新增读数不得被误当「可写」：内核零 setter（纯读原语） */
    ok('G12 duplicates 原语为纯读（无 _childDuplicates 之类的可写账本）',
        !/_childDuplicates/.test(KERNEL_CODE));
}
console.log(`\n[v2.34.0] 通过 ${pass} / 失败 ${fail}`);
if (fail) process.exitCode = 1;