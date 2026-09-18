/* ============================================================
 * RubyPhone v2.33.0 —— 过早回收「成因账」
 *
 * 本版问题（v2.32 的下一层）：v2.32 把「回收了几次」与「其中几次过早」
 *   并列读出，却从未记录**成因**。后果（探针在域上真执行取证）：
 *     · 设计内的闲置出口 + 复用（honey-view 式：离开界面 dispose → 重进登记
 *       → 再离开）3 次进出记 2 笔过早，而真正的宿主过早回收记 1 笔 ——
 *       两者除域名外完全同形；
 *     · honey-view 的 exitHoneySurface 9 个调用点里 6 个是界面内返回/回首页，
 *       全部计入过早回收 → 控制中心那句「N 个域名过早回收 · 全部发生在实例
 *       销毁后」在健康装机上**恒为假**。
 *   没有按成因分开读，这本账在正常用法下永远非零，读者只能学会忽略它。
 *
 * 本版修法（刻意保守）：**不动过早判据本身**（v2.32 的 A2/A3/A4/A6 语义原样
 *   保留），只新增「成因账」，且成因在**唯一咽喉点内部**推导 ——
 *   `disposeChildRuntimes` 内部自造 host-*；自持出口按角色推断 tidy/shutdown。
 *   理由：初版让每个调用点声明成因（dispose(cause) / {cause:'host-prefix'}），
 *   结果撞上 6 个既有测试（v225/v226/v228/v229/v230/v231 都把调用点字面量钉成
 *   实现契约）。本文件因此**不钉任何调用点字面量**，只钉行为与推导结果。
 *
 * 判据绑不变量，不绑具体写法；每个核心判据都配一次负控制。
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
/* 与 D4 / D5 **同款**的判据表达式：E 段复用它们，保证破坏真的动到被断言的那条式子
   （若 E 段另写一套判据，就会退化成「只证明另一套代码会红」的形式假绿）。 */
const judgeCardFlaws = (code) => /filter\(\(\[k\]\)\s*=>\s*k\.startsWith\('host-'\)\)/.test(code)
    && /hostile\s*>?\s*0/.test(code);
const judgeTally = (code) => /data-release-tally="\$\{flaws\.length \? 'premature' : 'clean'\}"/.test(code);
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
    const el = {
        tagName: tag, style: {}, dataset: {}, className: '', innerHTML: '', textContent: '',
        classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
        children: [],
        setAttribute() {}, removeAttribute() {},
        remove() { const p = el.parentNode; if (p) { const i = p.children.indexOf(el); if (i >= 0) p.children.splice(i, 1); } },
        appendChild(c) { el.children.push(c); c.parentNode = el; return c; },
        querySelector() { return makeEl(); }, querySelectorAll() { return []; },
        addEventListener() {}, removeEventListener() {},
        getBoundingClientRect() { return { width: 100, height: 100, left: 0 }; },
    };
    return el;
}
globalThis.window = Object.assign(makeTarget('window'),
    { VirtualPhone: { storage: { get: () => null, set: () => { } } } });
globalThis.document = Object.assign(makeTarget('document'), {
    hidden: false, createElement: (t) => makeEl(t), getElementById: () => null,
});
const {
    childRuntime, childRuntimeCount, childRuntimePrematureLog, childRuntimePrematureBy,
    childRuntimeReleaseLog, disposeChildRuntimes, globalRuntime,
} = await import('../config/runtime-lifecycle.js');
import * as KERNEL from '../config/runtime-lifecycle.js';
const idx = read('index.js');
const idxCode = codeOf(idx);
const t = { addEventListener() { }, removeEventListener() { } };
const sumCauses = (h) => Object.values(h || {}).reduce((s, v) => s + Number(v || 0), 0);
const sumAllCauses = (by) => Object.keys(by || {}).reduce((s, n) => s + sumCauses(by[n]), 0);
const sumAllPremature = (pre) => Object.keys(pre || {}).reduce((s, n) => s + Number(pre[n] || 0), 0);
const hostCount = (h) => Object.keys(h || {}).filter(k => k.startsWith('host-'))
    .reduce((s, k) => s + Number(h[k] || 0), 0);

/* ============================================================
 * A. 内核：五类成因各归各位
 * ============================================================ */
{
    disposeChildRuntimes('');
    /* A1 自持出口（'tidy'）：界面内正常返回，不计缺陷 */
    {
        const rt = childRuntime('a-tidy');
        for (let i = 0; i < 3; i++) { rt.addListener(t, 'click', () => { }, false, 'a:' + i); rt.dispose(); }
        const by = childRuntimePrematureBy('a-tidy');
        ok('A1a 自持出口归因到 tidy', by.tidy === 2, JSON.stringify(by));
        ok('A1b 自持出口不产出 host-* 缺陷（界面正常返回不是缺陷）', hostCount(by) === 0, JSON.stringify(by));
        ok('A1c 首次回收无「上一次」可归因，故只记 2 笔而非 3 笔',
            childRuntimePrematureLog('a-tidy') === 2 && by.tidy === 2, JSON.stringify(by));
    }
    /* A2 宿主按名回收（'host-prefix'）：真过早 */
    {
        const rt = childRuntime('a-host');
        rt.addListener(t, 'click', () => { }, false, 'x');
        disposeChildRuntimes('a-host');            // 宿主收掉仍在用的域
        rt.addListener(t, 'click', () => { }, false, 'y');
        rt.dispose();
        ok('A2a 宿主按名回收归因到 host-prefix',
            JSON.stringify(childRuntimePrematureBy('a-host')) === JSON.stringify({ 'host-prefix': 1 }),
            JSON.stringify(childRuntimePrematureBy('a-host')));
    }
    /* A3 按名精确回收（'host-exact'），且不误伤前缀域 */
    {
        const a = childRuntime('a-exact');
        const b = childRuntime('a-exact-extra');
        a.addListener(t, 'x', () => { }, false, '1');
        b.addListener(t, 'x', () => { }, false, '2');
        disposeChildRuntimes('a-exact', { exact: true });
        a.addListener(t, 'x', () => { }, false, '3');
        a.dispose();
        ok('A3a exact 归因到 host-exact',
            JSON.stringify(childRuntimePrematureBy('a-exact')) === JSON.stringify({ 'host-exact': 1 }));
        ok('A3b exact 不误伤同前缀的另一个域（其成因账为空）',
            JSON.stringify(childRuntimePrematureBy('a-exact-extra')) === '{}');
    }
    /* A4 全域清零（'host-all'） */
    {
        const rt = childRuntime('a-all');
        rt.addListener(t, 'y', () => { }, false, '1');
        disposeChildRuntimes('');
        rt.addListener(t, 'y', () => { }, false, '2');
        rt.dispose();
        ok('A4 全域清零归因到 host-all',
            JSON.stringify(childRuntimePrematureBy('a-all')) === JSON.stringify({ 'host-all': 1 }),
            JSON.stringify(childRuntimePrematureBy('a-all')));
    }
    /* A5 宿主级域级联（'shutdown'） */
    {
        const rt = childRuntime('a-cascade');
        rt.addListener(t, 'z', () => { }, false, '1');
        globalRuntime.dispose();
        rt.addListener(t, 'z', () => { }, false, '2');
        rt.dispose();
        ok('A5 级联回收归因到 shutdown',
            JSON.stringify(childRuntimePrematureBy('a-cascade')) === JSON.stringify({ shutdown: 1 }),
            JSON.stringify(childRuntimePrematureBy('a-cascade')));
    }
    /* A6 不变式：Σ成因 === Σ过早 —— 一笔 premature 必须对应一次可指认的成因 */
    {
        const pre = childRuntimePrematureLog('');
        const by = childRuntimePrematureBy('');
        ok('A6 不变式：成因总笔数 === 过早总笔数',
            sumAllCauses(by) === sumAllPremature(pre),
            `Σ成因=${sumAllCauses(by)} Σ过早=${sumAllPremature(pre)}`);
    }
    /* A7 未过早的回收不在成因账上留痕（账本只在真的过早时入账） */
    {
        const rt = childRuntime('a-clean');
        rt.addListener(t, 'e', () => { }, false, '1');
        rt.dispose();
        ok('A7 正常销毁不留成因痕迹', JSON.stringify(childRuntimePrematureBy('a-clean')) === '{}');
    }
    /* A8 单名口径与全表口径一致（避免两套读取路径各说各话） */
    {
        const one = childRuntimePrematureBy('a-host');
        const all = childRuntimePrematureBy('')['a-host'];
        ok('A8 单名与全表口径一致', JSON.stringify(one) === JSON.stringify(all), JSON.stringify({ one, all }));
    }
    disposeChildRuntimes('');
}
/* ============================================================
 * B. 内核：成因的**时点**（本版最容易写错的一处）
 * ============================================================ */
{
    disposeChildRuntimes('');
    /* B1 真过早不得被事后那次正常回收洗掉 —— 这就是初版的实测缺陷。
       初版取「本次调用的 cause」，于是 host-prefix 之后的那次 dispose('tidy')
       把成因改写成 tidy，真凶消失。判据：宿主成因必须留下。 */
    {
        const rt = childRuntime('b-timing');
        rt.addListener(t, 'c', () => { }, false, '1');
        disposeChildRuntimes('b-timing');     // 上一次：宿主（真过早）
        rt.addListener(t, 'c', () => { }, false, '2');
        rt.dispose();                          // 本次：自持出口（正常）
        const by = childRuntimePrematureBy('b-timing');
        ok('B1 真过早不被事后那次正常回收改写（宿主成因留存）',
            by['host-prefix'] === 1 && !by.tidy, JSON.stringify(by));
    }
    /* B2 反向：全是自持出口复用（无任何宿主介入）→ 不得凭空产出宿主成因 */
    {
        const rt = childRuntime('b-tidy-only');
        for (let i = 0; i < 4; i++) { rt.addListener(t, 'c', () => { }, false, 'x' + i); rt.dispose(); }
        const by = childRuntimePrematureBy('b-tidy-only');
        ok('B2 纯复用路径不凭空产出宿主成因', hostCount(by) === 0 && by.tidy === 3, JSON.stringify(by));
    }
    /* B3 成因与「实际回收次数」可互相解释：releases >= premature + 1 */
    {
        disposeChildRuntimes('');
        const rt = childRuntime('b-cohere');
        rt.addListener(t, 'c', () => { }, false, '1');
        disposeChildRuntimes('b-cohere');
        rt.addListener(t, 'c', () => { }, false, '2');
        disposeChildRuntimes('b-cohere');
        rt.addListener(t, 'c', () => { }, false, '3');
        rt.dispose();
        const rel = childRuntimeReleaseLog('b-cohere');
        const pre = childRuntimePrematureLog('b-cohere');
        ok('B3 过早笔数 < 实际回收次数（过早必留下一次后续回收）',
            pre < rt.releaseCount() && rt.releaseCount() === 3, `rel=${rel} pre=${pre} n=${rt.releaseCount()}`);
    }
    disposeChildRuntimes('');
}
/* ============================================================
 * C. 宿主接线：诊断入口与一行入口给出成因
 * ============================================================ */
{
    ok('C1 诊断入口暴露成因账', /snap\.releasedPrematureBy = childRuntimePrematureBy\(/.test(idxCode));
    ok('C2 判词函数接受第三参（成因），且缺省可省',
        /function explainReleaseTally\(released,\s*premature,\s*prematureBy\)/.test(idxCode));
    ok('C3 判词每行给出 causes 与 hostPremature',
        /hostPremature/.test(idxCode) && /causes/.test(idxCode));
    ok('C4 降级分支与主路径字段对齐（否则异常时字段消失）',
        /releasedPrematureBy:\s*\{\}/.test(idxCode));
    ok('C5 一行入口暴露给控制台', /window\.VirtualPhone\.releaseTally\s*=/.test(idxCode));
    ok('C6 成因可单独取（测试钩子）', /window\.VirtualPhone\.prematureCauses\s*=/.test(idxCode));

    /* C7 判词函数真实执行：成因可选、hostPremature 正确、旧的两参调用仍可用 */
    {
        const src = codeOf(idx);
        const at = src.indexOf('function explainReleaseTally');
        const open = src.indexOf('{', at);
        let depth = 0, body = '';
        for (let i = open; i < src.length; i++) {
            if (src[i] === '{') depth++;
            else if (src[i] === '}') { depth--; if (depth === 0) { body = src.slice(at, i + 1); break; } }
        }
        ok('C7a 判词函数体抽取成功', body.length > 100, String(body.length));
        const fn = new Function('return (' + body + ')')();
        /* 旧签名（两参）—— v2.32 的 D7 正是这样调的，必须仍可用 */
        const rOld = fn({ 'x-view': 3 }, { 'x-view': 1 });
        ok('C7b 两参旧调用仍可用（向后兼容 v2.32 的 D7）',
            rOld.rows.length === 1 && rOld.rows[0].premature === 1 && rOld.rows[0].ok !== false,
            JSON.stringify(rOld));
        /* 三参：成因进判词 */
        const rNew = fn({ 'x-view': 3 }, { 'x-view': 1 },
            { 'x-view': { 'host-prefix': 1 } });
        ok('C7c 三参时给出成因与 hostPremature',
            rNew.rows.length === 1 && rNew.rows[0].hostPremature === 1
            && rNew.rows[0].causes['host-prefix'] === 1, JSON.stringify(rNew));
        /* 自持成因 → hostPremature 为 0（不该报成缺陷） */
        const rTidy = fn({ 'y-view': 4 }, { 'y-view': 2 }, { 'y-view': { tidy: 2 } });
        ok('C7d 自持成因不计入 hostPremature', rTidy.rows[0].hostPremature === 0, JSON.stringify(rTidy));
        /* fail-closed 保持：读数自相矛盾时报出来 */
        const rBad = fn({ 'z-view': 2 }, { 'z-view': 2 }, { 'z-view': { tidy: 2 } });
        ok('C7e 自洽检查保持（矛盾读数仍报出）', rBad.ok === false && rBad.rows.length === 1, JSON.stringify(rBad));
        /* 非法输入不抛 */
        const rNull = fn(null, undefined, null);
        ok('C7f 非法输入不抛（诊断入口不得因读数异常而炸）', rNull.ok === true && rNull.rows.length === 0);
    }
}
/* ============================================================
 * D. 呈现层：控制中心卡片「读数诚实化」
 * ============================================================ */
{
    const cc = read('phone/control-center.js');
    const ccCode = codeOf(cc);
    ok('D1 控制中心从内核导入成因账',
        /import \{[^}]*childRuntimePrematureBy[^}]*\} from '\.\.\/config\/runtime-lifecycle\.js'/.test(ccCode));
    ok('D2 卡片渲染方法存在且被插进面板',
        /_releaseHtml\(\)\s*\{/.test(ccCode) && /\$\{this\._releaseHtml\(\)\}/.test(ccCode));
    ok('D3 卡片读第三本账（成因）', /childRuntimePrematureBy\(/.test(ccCode));
    ok('D4 缺陷判据只看宿主成因（tidy 不算缺陷）', judgeCardFlaws(ccCode));
    ok('D5 data-release-tally 由缺陷数决定（不是由笔数决定）', judgeTally(ccCode),
        (ccCode.match(/data-release-tally="[^"]*"/) || [''])[0]);
    ok('D6 卡片读取仍包在 try 里（任何一块坏掉不拖垮面板）', (() => {
        const at = ccCode.indexOf('_releaseHtml() {');
        const box = ccCode.slice(at, at + 900);
        return (box.match(/try \{/g) || []).length >= 3;
    })());
    ok('D7 样式仍可区分两种形态（未破坏 v2.32 的 E7）', (() => {
        const css = read('phone.css');
        return /\.sys-cc-rel-warn/.test(css) && /\[data-release-tally="premature"\]/.test(css);
    })());
    /* D8 「无提前回收」这个健康态文案必须存在 —— 否则健康装机仍显示缺陷语气 */
    ok('D8 健康态有专门文案（无提前回收 / 自持回收正常）',
        /无提前回收/.test(cc) || /自持回收（正常）/.test(cc));
}
/* ============================================================
 * E. 负控制：每个核心判据配一次故意破坏
 *
 * 形式要求（本仓库已知的假绿三形，v2.33 逐条避开）：
 *   ① 对**原文件**断言 —— 破坏没发生也绿；
 *   ② 破坏写死成模拟常量 —— 真判据根本没被调用；
 *   ③ 破坏把判据自己删了 —— 自我指涉。
 * 统一修法：**真源码破坏（锚点恰中 1 次）→ 动态加载破坏副本 → 在副本上重跑同款真判据**。
 * 内核是零 import 的自包含模块，故可直接用 data: URL 加载破坏副本。
 * ============================================================ */
function negative(real, broken, label) {
    /* 严格两向形式：**同一**判据必须在原版上为真、在真源码破坏副本上为假。
       只查一侧都会假绿：① 只查原版 —— 破坏没发生也绿；③ 只查副本 —— 破坏把判据
       自己删掉也绿（自我指涉）。两向 + 同款表达式才构成负控制。 */
    ok('E ' + label + ' → 判据必须翻红', real === true && broken === false,
        `real=${real} broken=${broken}`);
}
const KERNEL_SRC = read('config/runtime-lifecycle.js');
/** 真源码破坏：锚点必须恰中 1 次，否则抛（H6 工具两向自证）。 */
function breakKernel(anchor, repl) {
    const n = KERNEL_SRC.split(anchor).length - 1;
    if (n !== 1) throw new Error(`锚点命中 ${n} 次（要求恰 1 次）`);
    const broken = KERNEL_SRC.split(anchor).join(repl);
    if (broken === KERNEL_SRC) throw new Error('破坏未改字节');
    return broken;
}
let _vseq = 0;
async function loadBroken(src) {
    return await import('data:text/javascript;charset=utf-8;base64,'
        + Buffer.from(src, 'utf8').toString('base64') + '#v' + (++_vseq));
}
const hostOf = (h) => Object.keys(h || {}).filter(k => k.startsWith('host-'))
    .reduce((s2, k) => s2 + Number(h[k] || 0), 0);
/* 同一场景在「原版模块 / 破坏副本模块」上各跑一遍；判据表达式只有一份。 */
const SC_E1 = (m) => {                       // B1 同款：宿主成因必须留存且不被洗成自持
    const rt = m.childRuntime('e1');
    rt.addListener(t, 'c', () => { }, false, '1');
    m.disposeChildRuntimes('e1');
    rt.addListener(t, 'c', () => { }, false, '2');
    rt.dispose();
    const by = m.childRuntimePrematureBy('e1');
    const r = by['host-prefix'] === 1 && !by.tidy;
    m.disposeChildRuntimes('');
    return r;
};
const SC_E2 = (m) => {                       // A1b 同款：纯自持路径不得有宿生成因
    const rt = m.childRuntime('e2');
    rt.addListener(t, 'c', () => { }, false, '1');
    rt.dispose();
    rt.addListener(t, 'c', () => { }, false, '2');
    rt.dispose();
    const r = hostOf(m.childRuntimePrematureBy('e2')) === 0;
    m.disposeChildRuntimes('');
    return r;
};
const SC_E5 = (m) => {                       // A3 同款：exact 只收精确匹配的那一个
    m.childRuntime('e5');
    m.childRuntime('e5-extra');
    const n = m.disposeChildRuntimes('e5', { exact: true });
    m.disposeChildRuntimes('');
    return n === 1;
};
const SC_E6 = (m) => {                       // A2a 同款：宿主路径必须留下宿生成因
    const rt = m.childRuntime('e6');
    rt.addListener(t, 'c', () => { }, false, '1');
    m.disposeChildRuntimes('e6');
    rt.addListener(t, 'c', () => { }, false, '2');
    rt.dispose();
    const r = hostOf(m.childRuntimePrematureBy('e6')) === 1;
    m.disposeChildRuntimes('');
    return r;
};
{
    /* E1 真破坏：成因时点退回「看本次调用的 cause」→ 真过早被事后那次回收洗掉 */
    {
        const b = await loadBroken(breakKernel(
            "_bumpPrematureBy(this.name, this._lastDisposeCause || cause);",
            "_bumpPrematureBy(this.name, cause);"));
        negative(SC_E1(KERNEL), SC_E1(b), '成因时点退回「本次调用」（真过早被事后回收洗掉）');
    }
    /* E2 真破坏：成因被硬写成宿主 → 纯自持路径被误报成缺陷 */
    {
        const b = await loadBroken(breakKernel(
            "_bumpPrematureBy(this.name, this._lastDisposeCause || cause);",
            "_bumpPrematureBy(this.name, 'host-prefix');"));
        negative(SC_E2(KERNEL), SC_E2(b), '自持出口被误算成宿主缺陷');
    }
    /* E3 真破坏：卡片缺陷判据退回「笔数即缺陷」→ D4 同款判据必须翻红 */
    {
        const code = codeOf(read('phone/control-center.js'));
        const anchor = "const flaws = rows.filter(r => r.hostile > 0);";
        if (code.split(anchor).length - 1 !== 1) throw new Error('E3 锚点失配');
        const brokenCode = code.split(anchor).join('const flaws = rows.filter(r => r.premature > 0);');
        if (brokenCode === code) throw new Error('E3 破坏未改字节');
        negative(judgeCardFlaws(code), judgeCardFlaws(brokenCode), '卡片缺陷判据退回「笔数即缺陷」');
    }
    /* E4 真破坏：data-release-tally 退回按 rows.length 决定 → D5 同款判据必须翻红 */
    {
        const code = codeOf(read('phone/control-center.js'));
        const anchor = "data-release-tally=\"${flaws.length ? 'premature' : 'clean'}\"";
        if (code.split(anchor).length - 1 !== 1) throw new Error('E4 锚点失配');
        const brokenCode = code.split(anchor)
            .join("data-release-tally=\"${rows.length ? 'premature' : 'clean'}\"");
        if (brokenCode === code) throw new Error('E4 破坏未改字节');
        negative(judgeTally(code), judgeTally(brokenCode), 'data-release-tally 退回按笔数决定');
    }
    /* E5 真破坏：exact 语义退回前缀 → 同前缀的另一个域被连带收掉 */
    {
        const b = await loadBroken(breakKernel(
            "const exact = !!(opts && opts.exact);",
            "const exact = false;"));
        negative(SC_E5(KERNEL), SC_E5(b), 'exact 语义退回前缀匹配');
    }
    /* E6 真破坏：宿主路径不再声明成因（reason 恒空）→ 宿主成因消失 */
    {
        const b = await loadBroken(breakKernel(
            "const reason = !p ? 'host-all' : (exact ? 'host-exact' : 'host-prefix');",
            "const reason = '';"));
        negative(SC_E6(KERNEL), SC_E6(b), '宿主路径不再声明成因（回落成自持）');
    }
    /* E7 H6 工具两向自证：破坏工具本身必须对「锚点不存在 / 不唯一 / 未改字节」抛错 */
    {
        const bad = (label, fn) => {
            let threw = false;
            try { fn(); } catch (_e) { threw = true; }
            ok('E7 ' + label, threw, '工具未对失效输入抛错（假绿通道）');
        };
        bad('锚点不存在须抛', () => breakKernel('__NO_SUCH_ANCHOR__', 'x'));
        bad('锚点不唯一须抛', () => breakKernel('const ', 'const '));
        const anchorOk = "const exact = !!(opts && opts.exact);";
        bad('破坏后未改字节须抛', () => breakKernel(anchorOk, anchorOk));
        let cnt = 0;
        try {
            const bl = breakKernel(anchorOk, 'const exact = false;');
            if (bl !== KERNEL_SRC) cnt = 1;
        } catch (_e) { /* 保持 0 */ }
        ok('E7 工具正向：合法破坏确实改字节', cnt === 1);
    }

    /* E8 工具自证：剥注释若失灵，文本判据就会被注释字样满足 */
    {
        const rlCode = codeOf(read('config/runtime-lifecycle.js'));
        ok('E8a 剥注释副本不得残留本版注释独有字样（内核）',
            !rlCode.includes('成因的**时点**：过早是「下一次回收」时才被认定的事实'));
        ok('E8b 剥注释不得吞掉代码本体（内核）',
            rlCode.includes('_bumpPrematureBy') && rlCode.includes('_lastDisposeCause'));
        ok('E8c 剥注释副本不得残留本版注释独有字样（宿主）',
            !idxCode.includes('成因账（与过早笔数分列两行'));
        ok('E8d 剥注释不得吞掉代码本体（宿主）',
            idxCode.includes('childRuntimePrematureBy') && idxCode.includes('prematureCauses'));
    }
}
/* ============================================================
 * F. 不回归：v2.32 锁定的过早判据语义一字未改
 * ============================================================ */
{
    disposeChildRuntimes('');
    /* F1 v2.32 A2d 的形态原样成立：两次回收 / 账本一笔 / 过早一次 */
    {
        const rt = childRuntime('f-core');
        rt.addListener(t, 'c', () => { }, false, '1');
        const n1 = disposeChildRuntimes('f-core');
        rt.addListener(t, 'c', () => { }, false, '2');
        const n2 = rt.dispose();
        ok('F1 v2.32 口径原样保留（两次回收各 1 项 / 账本 1 笔 / 过早 1 次）',
            n1 === 1 && n2 === 1 && childRuntimeReleaseLog('f-core') === 1
            && rt.prematureReleases() === 1 && rt.releaseCount() === 2,
            `n1=${n1} n2=${n2} rel=${childRuntimeReleaseLog('f-core')} pre=${rt.prematureReleases()}`);
    }
    /* F2 v2.32 A3b 的形态原样成立：幂等空调用不是过早回收 */
    {
        const rt = childRuntime('f-idem');
        rt.addListener(t, 'c', () => { }, false, '1');
        rt.dispose(); rt.dispose(); rt.dispose();
        ok('F2 幂等空调用仍不产生过早（v2.32 A3b 不变）',
            rt.prematureReleases() === 0 && JSON.stringify(childRuntimePrematureBy('f-idem')) === '{}');
    }
    /* F3 v2.32 A4d 的形态原样成立：过早账本在域死后仍可查 */
    {
        const rt = childRuntime('f-after');
        rt.addListener(t, 'c', () => { }, false, '1');
        disposeChildRuntimes('f-after');
        rt.addListener(t, 'c', () => { }, false, '2');
        rt.dispose();
        ok('F3 域死后过早账本仍可查（v2.32 A4d 不变）', childRuntimePrematureLog('f-after') === 1);
        ok('F3b 域死后成因账同样可查（本版新增面）',
            childRuntimePrematureBy('f-after')['host-prefix'] === 1,
            JSON.stringify(childRuntimePrematureBy('f-after')));
    }
    /* F4 dispose 仍返回回收项数（既有消费方依赖） */
    {
        const rt = childRuntime('f-ret');
        rt.addListener(t, 'c', () => { }, false, '1');
        ok('F4 dispose 仍返回回收项数', rt.dispose() === 1);
    }
    disposeChildRuntimes('');
    ok('F5 全域清零后域表为空（既有语义不变）', childRuntimeCount() === 0, String(childRuntimeCount()));
}
/* ============================================================
 * G. 发布卫生
 * ============================================================ */
{
    const manifest = JSON.parse(read('manifest.json'));
    const pkg = JSON.parse(read('package.json'));
    const log = JSON.parse(read('update-log.json'));
    const v = (/const ST_PHONE_VERSION = '([^']+)'/.exec(idx) || [])[1];
    ok('G1 index.js 版本 >= 2.33.0', vnum(v) >= vnum('2.33.0'), v);
    ok('G2 manifest 同版', manifest.version === v, `${manifest.version} vs ${v}`);
    ok('G3 package.json 同版', pkg.version === v, `${pkg.version} vs ${v}`);
    ok('G4 update-log 有本版条目', !!log.versions?.[v]);
    ok('G5 update-log.latest 指向当前版本', log.latest === v, `${log.latest} vs ${v}`);
    ok('G6 versions 头部即当前版本', Object.keys(log.versions || {})[0] === v,
        String(Object.keys(log.versions || {})[0]));
    const items = (log.versions?.[v]?.items) || [];
    ok('G7 本版条目覆盖主线（成因 / 归因 / 读数诚实化）',
        items.join('\n').includes('成因'), JSON.stringify(items.slice(0, 1)));
    ok('G8 条目数 >= 4', items.length >= 4, String(items.length));
    /* G9 内置公告与日志逐字同源 */
    const blk = (idx.match(/const ST_PHONE_CURRENT_UPDATE = \{[\s\S]*?\n\};/) || [''])[0];
    ok('G9a 内置公告存在且 version 引用常量', blk.length > 0 && /version:\s*ST_PHONE_VERSION/.test(blk));
    const inner = blk.slice(blk.indexOf('items: [') + 'items: ['.length, blk.lastIndexOf(']'));
    let ann = null;
    try { ann = JSON.parse('[' + inner.replace(/,\s*$/, '') + ']'); } catch (_e) { ann = null; }
    ok('G9b 公告可解析为字符串数组', Array.isArray(ann) && ann.every(s => typeof s === 'string'));
    ok('G9c 公告与本版日志逐字同源', Array.isArray(ann) && JSON.stringify(ann) === JSON.stringify(items),
        `ann=${ann ? ann.length : 'null'} log=${items.length}`);
    /* G10 交棒基线：历史主线条目仍钉住 */
    ok('G10a 2.32.0 历史条目仍在（回收口径主线）',
        /回收口径|两本账/.test(((log.versions?.['2.32.0'] || {}).items || []).join('\n')));
    ok('G10b 2.31.0 历史条目仍在（回收账本主线）',
        /账本|releasedAt/.test(((log.versions?.['2.31.0'] || {}).items || []).join('\n')));
    /* G11 既有 v2.32/e2e 锁定的实现形态不得被本版改写 */
    ok('G11a 账本按对象只记一笔的实现仍在',
        /if \(!this\._releaseLogged\)/.test(read('config/runtime-lifecycle.js')));
    ok('G11b 过早判据本体一字未改（仍是计数比较式）',
        /_reenteredAfterDispose > this\._prematureReleases/.test(read('config/runtime-lifecycle.js')));
}
console.log(`\n[v2.33.0] 通过 ${pass} / 失败 ${fail}`);
process.exitCode = fail ? 1 : 0;