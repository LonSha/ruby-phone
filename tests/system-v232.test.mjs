/* ============================================================
 * [v2.32.0] 回收口径面：两本账，谁也没把它们合起来读
 * ------------------------------------------------------------
 * 动机（v2.30 / v2.31 之间的缝）：
 *   v2.30 让「域被回收了、实例还在用」可见（childRuntimeOverDisposed）；
 *   v2.31 让「回收过几次」可对账（childRuntimeReleaseLog）。
 *   本版盯住这两本账**各自为政**这件事：它们在同一个域上口径不同、
 *   分属不同 Map，且没有任何一处代码或面板把它们并列读出。
 *
 *   实测（探针在域上真执行）：
 *     · 同一个域对象 `dispose(); 复活; dispose();` → 回收账本记 1 笔（按对象计），
 *       而它实际被回收了 2 次 —— 「回收了几次」这个数在账面读不出来；
 *     · 过早回收的观测 `_reenteredAfterDispose` **是域对象的实例字段**，
 *       且只有仍在域表里的域才会被 childRuntimeOverDisposed() 数到 ——
 *       实测同一域：活着时 overDisposed=1，dispose 后=0，与「从未发生」同形。
 *       这块遥测的宿主与被观测对象同生共死，却用来回答关于历史的问题；
 *     · `this._releasedAt` 被写入却**全仓零读点**（有字段无消费）；
 *     · globalRuntimeSnapshot().children 每项只有 {name,total,byKind}，
 *       子域回答不了「还剩哪几个 tag 在跑」（宿主级却可以）；
 *     · disposeChildRuntimes 的前缀语义只写在文档里（传短名即多收）。
 *
 * 修复口径（本测试锁定的主张）：
 *   · 三个口径**各自命名、各自可读**：账本（按对象一笔）/ 实际回收次数 / 其中过早次数；
 *   · 过早回收在**回收时刻**落账（_childPrematureLog），域死后仍可查；
 *   · releasedAt 被真正消费；
 *   · 子域口径与宿主级对齐（tags 明细）；
 *   · 按名回收提供 exact 语义（默认前缀，向后兼容）；
 *   · 新增 explainReleaseTally 纯函数把两本账合读，并做读数自洽检查（fail-closed）。
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
const live = () => registry.length;
const resetReg = () => { registry.length = 0; };
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
const timers = new Map();
let seq = 0;
const realSetInterval = globalThis.setInterval;
const realClearInterval = globalThis.clearInterval;
const realSetTimeout = globalThis.setTimeout;
function installFakeClock() {
    timers.clear(); seq = 0;
    globalThis.setInterval = (fn) => { const id = ++seq; timers.set(id, { fn }); return id; };
    globalThis.clearInterval = (id) => { timers.delete(id); };
}
function restoreRealClock() {
    globalThis.setInterval = realSetInterval;
    globalThis.clearInterval = realClearInterval;
    globalThis.setTimeout = realSetTimeout;
}
globalThis.window = Object.assign(makeTarget('window'), { VirtualPhone: { storage: { get: () => null, set: () => { } } } });
globalThis.document = Object.assign(makeTarget('document'), {
    hidden: false,
    createElement: (t) => makeEl(t),
    getElementById: () => null,
});

const {
    childRuntime, childRuntimeCount,
    childRuntimeReleaseLog, childRuntimeOverDisposed,
    childRuntimePrematureLog, childRuntimeReleasedAt,
    disposeChildRuntimes, globalRuntimeSnapshot,
} = await import('../config/runtime-lifecycle.js');

const idx = read('index.js');
const idxCode = codeOf(idx);

/* ============================================================
 * A. 内核：三个口径各自独立可读
 * ============================================================ */
{
    disposeChildRuntimes('');
    resetReg();

    /* A1 基线：三个口径都能回答「什么都不该有」 */
    ok('A1a 过早回收账本基线为 0', childRuntimePrematureLog('a-none') === 0);
    ok('A1b 过早账本空串返回对象（与 released 口径一致）',
        typeof childRuntimePrematureLog('') === 'object' && childRuntimePrematureLog('') !== null);
    ok('A1c 末次回收时刻基线为 0', childRuntimeReleasedAt('a-none') === 0);

    /* A2 核心：同一个域对象「回收 2 次 / 账本 1 笔 / 过早 1 次」三者同时成立 */
    {
        const rt = childRuntime('a-core');
        rt.addTimeout(() => { }, 10, 'first');
        const n1 = disposeChildRuntimes('a-core');      // 宿主过早回收（实例仍在使用）
        const afterFirstRelease = childRuntimeReleaseLog('a-core');
        rt.addTimeout(() => { }, 10, 'second');          // 实例继续用 → 复活
        const n2 = rt.dispose();                         // 再次回收
        ok('A2a 两次回收都真的发生了（各回收 1 项）', n1 === 1 && n2 === 1, `n1=${n1} n2=${n2}`);
        ok('A2b 账本按对象只记一笔（v2.31 语义保留，重建对账口径不变）',
            afterFirstRelease === 1 && childRuntimeReleaseLog('a-core') === 1,
            `afterFirst=${afterFirstRelease} now=${childRuntimeReleaseLog('a-core')}`);
        ok('A2c 实际回收次数可读且为 2（此前读不出来）',
            rt.releaseCount() === 2, String(rt.releaseCount()));
        ok('A2d 其中过早次数为 1（唯一一次「回收时实例还在用」）',
            rt.prematureReleases() === 1, String(rt.prematureReleases()));
        ok('A2e releaseTrace 一行自述三值齐备', (() => {
            const tr = rt.releaseTrace();
            return tr.name === 'a-core' && tr.releases === 2 && tr.premature === 1 && tr.lastAt > 0;
        })(), JSON.stringify(rt.releaseTrace()));
    }

    /* A3 幂等空调用不得被误判为过早回收（判据必须区分「复活」与「重复 dispose」） */
    {
        const rt = childRuntime('a-idem');
        rt.addTimeout(() => { }, 10, 'x');
        rt.dispose(); rt.dispose(); rt.dispose();
        ok('A3a 三次 dispose（无复活）→ 实际次数 3', rt.releaseCount() === 3, String(rt.releaseCount()));
        ok('A3b 但过早次数必须为 0（重复 dispose 不是过早回收）',
            rt.prematureReleases() === 0, String(rt.prematureReleases()));
        ok('A3c 账本仍按对象记一笔', childRuntimeReleaseLog('a-idem') === 1,
            String(childRuntimeReleaseLog('a-idem')));
    }

    /* A4 本版核心：过早回收在域死后仍可查（对照 overDisposed 的归零） */
    {
        const rt = childRuntime('a-after-death');
        rt.addTimeout(() => { }, 10, 'x');
        disposeChildRuntimes('a-after-death');          // 过早回收
        rt.addTimeout(() => { }, 10, 'y');               // 复活
        const aliveNames = childRuntimeOverDisposed().names;
        const alivePremature = childRuntimePrematureLog('a-after-death');
        rt.dispose();                                    // 域离表
        const deadNames = childRuntimeOverDisposed().names;
        const deadPremature = childRuntimePrematureLog('a-after-death');
        ok('A4a 域活着时 overDisposed 能看到它（v2.30 语义仍在）',
            (aliveNames['a-after-death'] || 0) >= 1, JSON.stringify(aliveNames));
        ok('A4b 域死后 overDisposed 归零（这正是必须补账本的理由）',
            (deadNames['a-after-death'] || 0) === 0, JSON.stringify(deadNames));
        // 时机口径：过早回收在**回收时刻**落账 —— 第二次回收发生前读不到（此刻尚无
        //   任何一次回收被证明过早），回收之后域虽已离表仍可查（对照 overDisposed 归零）。
        ok('A4c 过早账本在回收时刻落账（第二次回收前为 0）',
            alivePremature === 0, `alive=${alivePremature}`);
        ok('A4d 域死后过早账本仍可查（本版修复点，对照 overDisposed 的归零）',
            deadPremature === 1
            && !globalRuntimeSnapshot().children.some(x => x.name === 'a-after-death'),
            `dead=${deadPremature}`);
    }

    /* A5 releasedAt 被真正消费（v2.31 写了却全仓零读点） */
    {
        const rt = childRuntime('a-at');
        rt.addTimeout(() => { }, 10, 'x');
        const before = childRuntimeReleasedAt('a-at');
        rt.dispose();
        const after = childRuntimeReleasedAt('a-at');
        ok('A5a 回收前时刻为 0', before === 0, String(before));
        ok('A5b 回收后时刻可读且与域上字段一致',
            after > 0 && after === rt._releasedAt, `after=${after} field=${rt._releasedAt}`);
        ok('A5c 全表口径与单名一致',
            (childRuntimeReleasedAt('')['a-at'] || 0) === after);
    }

    /* A6 反例对照：域随实例生命周期走（销毁时回收）→ 过早恒为 0 */
    {
        const rt = childRuntime('a-clean');
        rt.addListener(window, 'e', () => { });
        rt.dispose();
        ok('A6 正常销毁不产生过早回收（两套语义不互相污染）',
            rt.prematureReleases() === 0 && childRuntimePrematureLog('a-clean') === 0);
    }

    /* A7 父域级联回收同样进入三个口径 */
    {
        const child = childRuntime('a-cascade');
        child.addListener(window, 'c', () => { });
        const preBefore = childRuntimePrematureLog('a-cascade');
        disposeChildRuntimes('a-cascade');
        ok('A7 级联回收记账（账本 +1、实际次数 +1）',
            childRuntimeReleaseLog('a-cascade') === 1 && child.releaseCount() === 1
            && childRuntimePrematureLog('a-cascade') === preBefore);
    }

    disposeChildRuntimes('');
    resetReg();
}

/* ============================================================
 * B. 子域口径与宿主级对齐
 * ============================================================ */
{
    disposeChildRuntimes('');
    const rt = childRuntime('b-child');
    rt.addInterval(() => { }, 1000, 'progress');
    rt.addListener(window, 'resize', () => { }, false, 'floating:resize');
    const snap = globalRuntimeSnapshot();
    const c = snap.children.find(x => x.name === 'b-child');
    ok('B1 子域条目存在', !!c);
    ok('B2 子域带 tags 明细（此前只有 byKind 计数）',
        Array.isArray(c.tags) && c.tags.length === 2, JSON.stringify(c.tags));
    ok('B3 tags 明细含真实 tag 名（可回答「还剩哪几个 tag 在跑」）',
        c.tags.some(t => t.tag === 'progress') && c.tags.some(t => t.tag === 'floating:resize'),
        JSON.stringify(c.tags));
    ok('B4 子域口径与宿主级同构（两边都有 kind+tag 明细）',
        Array.isArray(snap.tags) && snap.tags.length === 0
        && c.tags.every(t => typeof t.kind === 'string' && typeof t.tag === 'string'));
    ok('B5 子域带 releases / premature 两值',
        typeof c.releases === 'number' && typeof c.premature === 'number',
        JSON.stringify({ r: c.releases, p: c.premature }));
    rt.dispose();
    const snap2 = globalRuntimeSnapshot();
    ok('B6 回收后子域离表（口径不滞留）', !snap2.children.some(x => x.name === 'b-child'));
    disposeChildRuntimes('');
}

/* ============================================================
 * C. 按名回收的前缀语义显式化
 * ============================================================ */
{
    disposeChildRuntimes('');
    childRuntime('c-base');
    childRuntime('c-base-extra');
    const nPrefix = disposeChildRuntimes('c-base');
    ok('C1 前缀语义（默认，向后兼容）：1 个名字可收掉同前缀的多个域',
        nPrefix === 2, String(nPrefix));

    disposeChildRuntimes('');
    childRuntime('c-exact');
    childRuntime('c-exact-extra');
    const nExact = disposeChildRuntimes('c-exact', { exact: true });
    ok('C2 exact 语义只收精确匹配的那一个', nExact === 1, String(nExact));
    ok('C3 exact 之后同前缀的另一个域仍在表内',
        globalRuntimeSnapshot().children.some(x => x.name === 'c-exact-extra'));

    disposeChildRuntimes('');
    childRuntime('c-empty');
    ok('C4 空串语义不变（回收全部实例域）', disposeChildRuntimes('') >= 1);
    ok('C5 空串之后域表为空', childRuntimeCount() === 0, String(childRuntimeCount()));
}

/* ============================================================
 * D. 宿主接线：诊断入口把两本账合起来读
 * ============================================================ */
{
    ok('D1 诊断入口暴露过早账本', /snap\.releasedPremature = childRuntimePrematureLog\(/.test(idxCode));
    ok('D2 诊断入口暴露回收时刻', /snap\.releasedAt = childRuntimeReleasedAt\(/.test(idxCode));
    ok('D3 诊断入口产出合读判词', /snap\.releaseVerdict = explainReleaseTally\(/.test(idxCode));
    ok('D4 降级分支与主路径字段对齐（否则异常时字段消失）',
        /releasedPremature:\s*\{\}/.test(idxCode) && /releasedAt:\s*\{\}/.test(idxCode)
        && /releaseVerdict:\s*\{\s*rows:\s*\[\]/.test(idxCode));
    ok('D5 两个新账本从内核导入（不是本地造对象）',
        /childRuntimePrematureLog/.test(idxCode.split('\n').find(l => l.includes("from './config/runtime-lifecycle.js'")) || ''));
    ok('D6 一行入口暴露给控制台', /window\.VirtualPhone\.releaseTally\s*=/.test(idxCode));

    /* D7 判词函数的自洽检查（fail-closed）：真实执行，三种输入都要不抛且结论正确 */
    {
        const src = codeOf(idx);
        const at = src.indexOf('function explainReleaseTally');
        ok('D7a 判词函数存在于宿主', at > 0);
        const body = (() => {
            const open = src.indexOf('{', at);
            let depth = 0;
            for (let i = open; i < src.length; i++) {
                const ch = src[i];
                if (ch === '{') depth++;
                else if (ch === '}') { depth--; if (depth === 0) return src.slice(at, i + 1); }
            }
            return '';
        })();
        ok('D7b 判词函数体抽取成功', body.length > 100, String(body.length));
        const fn = new Function('return (' + body + ')')();
        const r1 = fn({}, {});
        ok('D7c 全洁时无判词且 ok 为真', r1.rows.length === 0 && r1.ok === true, JSON.stringify(r1));
        const r2 = fn({ 'x-view': 3 }, { 'x-view': 1 });
        ok('D7d 有过早时出判词并带上两个数',
            r2.rows.length === 1 && r2.rows[0].releases === 3 && r2.rows[0].premature === 1
            && r2.rows[0].coherent === true, JSON.stringify(r2));
        const r3 = fn({ 'y-view': 2 }, { 'y-view': 2 });
        ok('D7e 读数自相矛盾时报出来而非吞掉（fail-closed）',
            r3.ok === false && r3.rows.length === 1, JSON.stringify(r3));
        const r4 = fn(null, undefined);
        ok('D7f 非法输入不抛（诊断入口不得因读数异常而炸）', r4.ok === true && r4.rows.length === 0);
        const r5 = fn({ 'z-view': 0 }, { 'z-view': 0 });
        ok('D7g 零值域名不出判词（不制造假警报）', r5.rows.length === 0);
    }
}

/* ============================================================
 * E. 呈现层：控制中心「回收口径」卡
 * ============================================================ */
{
    const cc = read('phone/control-center.js');
    const ccCode = codeOf(cc);
    ok('E1 控制中心从内核导入两本账',
        /childRuntimeReleaseLog/.test(ccCode) && /childRuntimePrematureLog/.test(ccCode));
    ok('E2 卡片渲染方法存在', /_releaseHtml\(\)\s*\{/.test(ccCode));
    ok('E3 卡片被插进面板（不是定义了不调用 = 死代码）',
        /\$\{this\._releaseHtml\(\)\}/.test(ccCode));
    ok('E4 卡片把两本账并列读出（同一处同时读 release 与 premature）', (() => {
        const at = ccCode.indexOf('_releaseHtml() {');
        const box = ccCode.slice(at, at + 1600);
        return box.includes('childRuntimeReleaseLog(') && box.includes('childRuntimePrematureLog(');
    })());
    ok('E5 卡片读取包在 try 里（控制中心任何一块坏掉不该拖垮面板）', (() => {
        const at = ccCode.indexOf('_releaseHtml() {');
        const box = ccCode.slice(at, at + 700);
        return (box.match(/try \{/g) || []).length >= 2;
    })());
    ok('E6 样式存在（否则卡片没颜色区分）',
        read('phone.css').includes('.sys-cc-releases'));
    ok('E7 过早回收的样式与全洁形态可区分（CSS 对 premature 形态有专门规则）', (() => {
        const css = read('phone.css');
        return /\.sys-cc-rel-warn/.test(css) && /\[data-release-tally="premature"\]/.test(css);
    })());
}

/* ============================================================
 * F. 负控制：每个核心判据配一次故意破坏
 * ============================================================ */
function negative(fn, label) {
    let fired = false;
    try { fn(); } catch (_e) { fired = true; }
    ok('F ' + label + ' → 判据必须翻红', fired, '判据无反应（假绿）');
}
{
    /* F1 破坏：dispose 不再累计实际回收次数 → A2c 形态必须失效 */
    negative(() => {
        const rt = childRuntime('f1');
        rt.addTimeout(() => { }, 10, 'x');
        rt.dispose();
        // 模拟破坏：假设实现忘记累计（此处直接改字段，等价于删掉那行 `this._releaseCount += 1`）
        rt._releaseCount = 0;
        if (!(rt.releaseCount() === 1)) throw new Error('翻红');
    }, '实际回收次数不再累计');

    /* F2 破坏：过早判定退化为「只要 dispose 过就算过早」→ 幂等空调用会被误判（A3b 会红） */
    negative(() => {
        const rt = childRuntime('f2');
        rt.addTimeout(() => { }, 10, 'x');
        rt.dispose(); rt.dispose(); rt.dispose();
        rt._prematureReleases = rt._releaseCount;      // 破坏形态：把次数当过早数
        if (!(rt.prematureReleases() === 0)) throw new Error('翻红');
    }, '过早判定退化为「回收过就算过早」');

    /* F3 破坏：过早账本改为寄居在域上（不在回收时刻落账）→ A4c 域死后不可查 */
    negative(() => {
        const rt = childRuntime('f3');
        rt.addTimeout(() => { }, 10, 'x');
        disposeChildRuntimes('f3');
        rt.addTimeout(() => { }, 10, 'y');
        rt.dispose();
        if (!(childRuntimePrematureLog('f3') === 0)) throw new Error('翻红');
    }, '过早账本退回「只在活域上可见」（域死后必须归零才算真破坏）');

    /* F4 破坏：子域快照退回只有计数（抹掉 tags 明细字段）→ B2 的源码判据必须失效 */
    negative(() => {
        const src = codeOf(read('config/runtime-lifecycle.js'));
        const anchor = 'tags: rt.entries().map(e => ({ kind: e.kind, tag: e.tag })),';
        if (!src.includes(anchor)) return;               // 锚点失配 → 红（不掩盖）
        const broken = src.replace(anchor, '');
        if (broken === src) return;                     // 破坏未生效 → 红
        if (!broken.includes('tags: rt.entries()')) throw new Error('翻红');
    }, '子域 tags 明细消失');

    /* F5 破坏：exact 语义退回前缀 → C2 形态失效 */
    negative(() => {
        disposeChildRuntimes('');
        childRuntime('f5');
        childRuntime('f5-extra');
        const n = disposeChildRuntimes('f5');
        if (!(n === 1)) throw new Error('翻红');
        disposeChildRuntimes('');
    }, 'exact 语义退回前缀匹配');

    /* F6 破坏：判词函数不再做自洽检查 → D7e 形态失效 */
    negative(() => {
        const src = codeOf(idx);
        const at = src.indexOf('function explainReleaseTally');
        const open = src.indexOf('{', at);
        let depth = 0, body = '';
        for (let i = open; i < src.length; i++) {
            const ch = src[i];
            if (ch === '{') depth++;
            else if (ch === '}') { depth--; if (depth === 0) { body = src.slice(at, i + 1); break; } }
        }
        const broken = body.replace(/coherent:\s*r\s*>\s*p/, 'coherent: true').replace(/rows\.every\(x => x\.coherent\)/, 'true');
        const fn = new Function('return (' + broken + ')')();
        const r = fn({ 'y': 2 }, { 'y': 2 });
        if (!(r.ok === false)) throw new Error('翻红');
    }, '自洽检查被移除（读数矛盾时不再报出）');

    /* F7 破坏：诊断入口不再暴露过早账本 → D1 判据必须失效 */
    negative(() => {
        const broken = idxCode.replace(/snap\.releasedPremature = childRuntimePrematureLog\(''\);/, '');
        if (broken === idxCode) return;                 // 破坏未生效 → 红
        if (!/snap\.releasedPremature = childRuntimePrematureLog\(/.test(broken)) throw new Error('翻红');
    }, '诊断入口不再暴露过早账本');

    /* F8 破坏：控制中心的卡片只定义不插进面板（死代码形态） → E3 判据必须失效 */
    negative(() => {
        const cc0 = codeOf(read('phone/control-center.js'));
        const broken = cc0.replace(/\$\{this\._releaseHtml\(\)\}/, '');
        if (broken === cc0) return;                     // 破坏未生效 → 红
        if (!/\$\{this\._releaseHtml\(\)\}/.test(broken)) throw new Error('翻红');
    }, '卡片被插进面板的接线断开');
    /* F9 工具自证：剥注释若失灵，文本判据就会被注释字样满足
       —— lonsha v3.169 的两处假绿（判据声称在检查、实际没在检查、且不报错）即此形态。 */
    {
        const rlCode = codeOf(read('config/runtime-lifecycle.js'));
        ok('F9a 剥注释副本不得残留本版注释独有字样（宿主）',
            !idxCode.includes('回收口径一句话：控制台执行'));
        ok('F9b 剥注释不得吞掉代码本体（宿主）',
            idxCode.includes('function explainReleaseTally')
            && idxCode.includes('window.VirtualPhone.releaseTally'));
        ok('F9c 剥注释副本不得残留本版注释独有字样（内核）',
            !rlCode.includes('账本口径分账（v2.31 的「按对象计一笔」保留为 released）'));
        ok('F9d 剥注释不得吞掉代码本体（内核）',
            rlCode.includes('this._releaseCount += 1;') && rlCode.includes('_childPrematureLog.set('));
    }
}

/* ============================================================
 * G. 发布卫生
 * ============================================================ */
{
    const manifest = JSON.parse(read('manifest.json'));
    const pkg = JSON.parse(read('package.json'));
    const log = JSON.parse(read('update-log.json'));
    const v = /const ST_PHONE_VERSION = '([\d.]+)'/.exec(idx)?.[1];
    ok('G1 index.js 版本 >= 2.32.0', vnum(v) >= vnum('2.32.0'), v);
    ok('G2 manifest 同版', manifest.version === v, `${manifest.version} vs ${v}`);
    ok('G3 package.json 同版', pkg.version === v, `${pkg.version} vs ${v}`);
    ok('G4 update-log 有本版条目', !!log.versions?.[v]);
    ok('G5 update-log.latest 指向当前版本', log.latest === v, `${log.latest} vs ${v}`);
    ok('G6 versions 头部即当前版本', Object.keys(log.versions || {})[0] === v,
        Object.keys(log.versions || {})[0]);
    const items = ((log.versions?.[v] || {}).items) || [];
    /* [v2.35.0] 交棒：改钉 2.32.0 历史条目（原用当前版本 v 查本版叙事词，每发一版必翻红）。 */
    const v232Items = ((log.versions?.['2.32.0'] || {}).items || []).join('\n');
    ok('G7 本版条目覆盖主线（钉 2.32.0 历史条目：回收口径 / 两本账）',
        /回收口径/.test(v232Items) && /两本账/.test(v232Items), String(v232Items.length));
    ok('G8 条目数 >= 4', items.length >= 4, String(items.length));
    /* G9 内置公告与日志逐字同源（仓库私有时远端恒 404，公告是用户唯一能看到的说明） */
    const blk = (idx.match(/const ST_PHONE_CURRENT_UPDATE = \{[\s\S]*?\n\};/) || [''])[0];
    ok('G9a 内置公告存在且 version 引用常量', blk.length > 0 && /version:\s*ST_PHONE_VERSION/.test(blk));
    const inner = blk.slice(blk.indexOf('items: [') + 'items: ['.length, blk.lastIndexOf(']'));
    let ann = null;
    try { ann = JSON.parse('[' + inner.replace(/,\s*$/, '') + ']'); } catch (_e) { ann = null; }
    ok('G9b 公告可解析为字符串数组', Array.isArray(ann) && ann.every(s => typeof s === 'string'));
    ok('G9c 公告与本版日志逐字同源', Array.isArray(ann) && items.every(it => ann.includes(it)),
        `ann=${ann ? ann.length : 'null'} log=${items.length}`);
    /* G10 交棒基线：历史主线条目仍钉住 */
    ok('G10a 2.31.0 历史条目仍在（回收账本主线）',
        /回收账本/.test(((log.versions?.['2.31.0'] || {}).items || []).join('\n')));
    ok('G10b 2.30.0 历史条目仍在（过度回收主线）',
        /过度回收/.test(((log.versions?.['2.30.0'] || {}).items || []).join('\n')));
    /* G11 既有 v2.31 断言的实现形态不得被本版改写 */
    ok('G11a v2.31 锁定的「账本按对象只记一笔」实现仍在',
        /if \(!this\._releaseLogged\)/.test(codeOf(read('config/runtime-lifecycle.js'))));
    ok('G11b v2.31 锁定的首次记账口径仍在',
        /_childReleaseLog\.set\(this\.name/.test(codeOf(read('config/runtime-lifecycle.js'))));
    ok('G11c dispose 仍返回回收项数（既有消费方依赖）',
        /return ids\.length;/.test(codeOf(read('config/runtime-lifecycle.js'))));
}

console.log(`\n[v2.32.0] 通过 ${pass} / 失败 ${fail}`);
process.exitCode = fail ? 1 : 0;