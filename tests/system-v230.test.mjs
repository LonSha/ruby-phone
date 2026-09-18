/* ============================================================
 * [v2.30.0] 域出口时机契约 —— 「域被回收了、实例还活着」
 * ------------------------------------------------------------
 * 动机（v2.29 的镜像面）：
 *   v2.29 把出口交给域自己，解决的是**孤儿域**：「域还活着、宿主已经忘了它」。
 *   本版盯住同一枚硬币的另一面：**域已被回收、实例却还在用**。
 *   宿主一条 `disposeChildRuntimes('')`（全域清零）就能做到这件事 ——
 *   它不看实例是否还活着，直接把仍有引用的实例的域一并回收。
 *
 *   实测（scripts 侧探针 / 源码核实）：index.js 换会话路径正是这条写法，
 *   而同一时刻 musicApp / gamesApp / worldpulseApp 都还活着 ——
 *   紧接着就有它们的 onChatChanged() 重绑调用。域被回收后，实例再登记
 *   资源时靠 _reenterIfNeeded 复活，于是同一个实例里
 *   「已被回收的旧资源」与「重新登记的新资源」并存，而旧资源再无回收出口。
 *
 *   这不是假想的连锁：_reenterIfNeeded 是 v2.29 为「视图复用」有意引入的正常路径，
 *   它把「复活」变得**静默成功** —— 于是「过早回收」在门禁与运行期都不可见。
 *
 * 本测试四层：
 *   A. 内核遥测：复活必须被记账（reenteredAfterDispose / overDisposeStats /
 *      childRuntimeOverDisposed）；域随实例生命周期走时该值恒为 0（反例对照）。
 *   B. 宿主侧三条路径的正确性：换会话（会话作用域 ≠ 实例销毁）不得全域清零；
 *      清当前数据必须为 honey 域留出口；三条路径都必须先销毁 albumApp 再置 null。
 *   C. 命名即文档：removePhoneChromeTheme 只做 DOM 主题，域出口另名 exitHoneySurface，
 *      且 9 个调用点全部落在后者上（出口必须能从调用处读出来）。
 *   D. 发布卫生（版本四处同步 + update-log 条目）。
 * 判据绑不变量，不绑具体写法；不假设「唯一正确解」。
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

/* 剥注释（栈式扫描器，长度保持）：
 *   为什么不用正则：honey-view.js 的 HTML 模板串里含「斜杠+星号」这样的
 *   属性值文本（如 accept 的 image 通配），而代码里还有 catch 空块注释的
 *   结束符；正则会把两者配成一对，一次吞掉 159565 字节活代码
 *   （恰好盖住目标调用点），使「raw 6 处 → 剥后 1 处」—— 判据假失败，
 *   而反向断言会假通过。**剥注释器本身必须先自证**。
 *   为什么需要栈：模板插值里可能出现引号/反引号/注释，
 *   必须记住「当前在模板的插值里」，返回时才恢复模板状态。
 *   长度严格不变，便于按偏移定位与切片。
 */
function strip(src) {
    const n = src.length;
    const out = new Array(n);
    const stack = [];               // 模板插值嵌套标记
    let braceDepth = 0;             // 当前插值内的花括号深度
    let mode = 'code';              // code | squote | dquote | tmpl | line | block | regex
    let prevSig = '';
    let i = 0;
    while (i < n) {
        const c = src[i], d = src[i + 1];
        if (mode === 'line') {
            out[i] = (c === '\n') ? '\n' : ' ';
            if (c === '\n') { mode = 'code'; prevSig = ''; }
            i++; continue;
        }
        if (mode === 'block') {
            if (c === '*' && d === '/') { out[i] = ' '; out[i + 1] = ' '; i += 2; mode = 'code'; prevSig = ''; }
            else { out[i] = (c === '\n') ? '\n' : ' '; i++; }
            continue;
        }
        if (mode === 'squote' || mode === 'dquote') {
            out[i] = c;
            if (c === '\\') { out[i + 1] = d || ''; i += 2; continue; }
            if (c === (mode === 'squote' ? "'" : '"')) { mode = 'code'; prevSig = c; }
            i++; continue;
        }
        if (mode === 'tmpl') {
            if (c === '\\') { out[i] = c; out[i + 1] = d || ''; i += 2; continue; }
            if (c === '`') { out[i] = c; mode = 'code'; prevSig = '`'; i++; continue; }
            if (c === '$' && d === '{') { out[i] = '$'; out[i + 1] = '{'; i += 2; mode = 'code'; stack.push('t'); braceDepth = 0; continue; }
            out[i] = c; i++; continue;
        }
        if (mode === 'regex') {
            out[i] = c;
            if (c === '\\') { out[i + 1] = d || ''; i += 2; continue; }
            if (c === '/') { mode = 'code'; prevSig = ''; i++; continue; }
            i++; continue;
        }
        // ---- code ----
        if (c === '/' && d === '/') { mode = 'line'; out[i] = ' '; out[i + 1] = ' '; i += 2; continue; }
        if (c === '/' && d === '*') { mode = 'block'; out[i] = ' '; out[i + 1] = ' '; i += 2; continue; }
        if (c === '`') { mode = 'tmpl'; out[i] = c; i++; continue; }
        if (c === "'") { mode = 'squote'; out[i] = c; i++; continue; }
        if (c === '"') { mode = 'dquote'; out[i] = c; i++; continue; }
        if (c === '/' && /[(,=:[!&|?{};+\-*%~^<>]/.test(prevSig || '(')) { mode = 'regex'; out[i] = c; i++; prevSig = ''; continue; }
        if (stack.length) {
            if (c === '{') braceDepth++;
            else if (c === '}') {
                if (braceDepth === 0) { out[i] = '}'; i++; stack.pop(); mode = 'tmpl'; continue; }
                braceDepth--;
            }
        }
        out[i] = c;
        if (!/\s/.test(c)) prevSig = c;
        i++;
    }
    return out.join('');
}

/* 需要 DOM/定时器宿主：内核在无宿主时应安全降级，这里刻意不装假 DOM 也能加载。 */
/* 剥注释器自证：长度不变 + 代码保留 + 注释被剥（三者缺一，后面的切片全不可信） */
{
    const probe = "const a = '/*x*/'; // y\n/*z*/ const b = `\`/*w*/`; const c = 1/2;";
    ok('剥注释：长度严格不变（偏移不漂）', strip(probe).length === probe.length,
        `${strip(probe).length} vs ${probe.length}`);
    ok('剥注释：字符串内的 /* 不被当注释',
        strip("const a = '/*x*/'; const t = 1;").includes('const t = 1;'));
    // 关键回归：模板串里的 image/* 曾经吞掉 159565 字节活代码
    ok('剥注释：模板串内的 image/* 不被当注释',
        strip('const h = `accept="...image/*"`; const t = 9;').includes('const t = 9;'));
    ok('剥注释：模板插值内的注释被剥、插值外的代码保留',
        !strip('const s = `${/*c*/ x}`; const t = 5;').includes('/*c*/')
        && strip('const s = `${/*c*/ x}`; const t = 5;').includes('const t = 5;'));
    ok('剥注释：正则字面量不被当注释',
        strip("const r = /\\/\\/i; const t = 2;").includes('const t = 2;'));
    ok('剥注释：真注释确实被剥掉',
        !strip('const a = 1; // 后面是注释 \nconst b = 2;').includes('后面是注释')
        && strip('/* 块注释 */ const c = 3;').includes('const c = 3;'));
    // 实测回归：真实文件上剥注释不得让调用点消失
    {
        const rawView = fs.readFileSync(path.join(root, 'apps/honey/honey-view.js'), 'utf8');
        const nRaw = (rawView.match(/this\.exitHoneySurface\(\);/g) || []).length;
        const nStripped = (strip(rawView).match(/this\.exitHoneySurface\(\);/g) || []).length;
        ok('剥注释：真实文件上调用点数不因剥注释减少', nRaw === nStripped && nRaw >= 6, `${nRaw} vs ${nStripped}`);
    }
}
globalThis.window = Object.assign(globalThis.window || {}, { VirtualPhone: {} });
const {
    childRuntime, childRuntimeCount, childRuntimeOverDisposed,
    disposeChildRuntimes, globalRuntime,
} = await import('../config/runtime-lifecycle.js');

/* ══════════ A. 内核遥测 ══════════ */
{
    disposeChildRuntimes('');    // 清零基线，不假设进入时状态
    resetAll();

    // A1 反例对照：域随实例生命周期走（销毁时 dispose）→ 从不复活
    {
        const rt = childRuntime('a1-lifecycle');
        rt.addTimeout(() => {}, 10, 't');
        rt.dispose();
        const st = rt.overDisposeStats();
        ok('A1 未复活的域 reentered 恒为 0（反例对照）', st.reentered === 0, JSON.stringify(st));
    }

    // A2 过早回收：dispose 之后又登记资源 → 必须被记账
    {
        const rt = childRuntime('a2-early');
        rt.addTimeout(() => {}, 10, 'first');
        disposeChildRuntimes('a2-early');          // 宿主全域/按名回收（实例还活着）
        ok('A2a 回收后域表里没有它', childRuntimeCount() === 0 || !childRuntimeOverDisposed().names['a2-early']);
        rt.addTimeout(() => {}, 10, 'second');     // 实例继续用 → 复活
        const st = rt.overDisposeStats();
        ok('A2b 复活被记账（reentered >= 1）', st.reentered >= 1, JSON.stringify(st));
        ok('A2c overDisposed 置位', st.overDisposed === true, JSON.stringify(st));
        const snap = childRuntimeOverDisposed();
        ok('A2d 全域名快照能报出它', (snap.names['a2-early'] || 0) >= 1, JSON.stringify(snap));
        ok('A2e 快照总数一致', snap.total === childRuntimeCount(), `${snap.total} vs ${childRuntimeCount()}`);
    }

    // A3 复活次数累加（反复过早回收 → 次数必须可数）
    {
        const rt = childRuntime('a3-repeat');
        rt.addTimeout(() => {}, 10, 'x');
        disposeChildRuntimes('a3-repeat');
        rt.addTimeout(() => {}, 10, 'y');
        disposeChildRuntimes('a3-repeat');
        rt.addTimeout(() => {}, 10, 'z');
        ok('A3 复活次数累加', rt.overDisposeStats().reentered === 2, JSON.stringify(rt.overDisposeStats()));
    }

    // A4 遥测不改行为：复活的域仍能被回收（回归）
    {
        const rt = childRuntime('a4-still-collectable');
        rt.addTimeout(() => {}, 10, 'p');
        disposeChildRuntimes('a4-still-collectable');
        rt.addTimeout(() => {}, 10, 'q');          // 复活
        const n = disposeChildRuntimes('a4-still-collectable');
        ok('A4 复活后的域仍可被回收', n >= 1, String(n));
    }

    // A5 宿主级域（无 _childLog）不参与过度回收记账
    //   不变量：globalRuntime 没有 _childLog ⇒ _reenterIfNeeded 是空操作
    //   ⇒ 无论怎么 dispose / 再登记，它自己的复活计数恒为 0。
    //   （不要拿 childRuntimeOverDisposed() 的前后差值来验：globalRuntime.dispose()
    //     会**级联**回收全部子域，子域离开域表后不再被计入快照，差值反映的是级联，
    //     不是宿主级域的记账行为。）
    {
        globalRuntime.addTimeout(() => {}, 10, 'g');
        globalRuntime.dispose();                 // 级联回收子域（v2.28 行为）
        globalRuntime.addTimeout(() => {}, 10, 'g2');   // 再登记
        const gs = globalRuntime.overDisposeStats();
        ok('A5 宿主级域复活计数恒为 0（无 _childLog，不参与记账）', gs.reentered === 0, JSON.stringify(gs));
        ok('A5b 它也不被标记为过度回收', gs.overDisposed === false, JSON.stringify(gs));
    }

    resetAll();
    disposeChildRuntimes('');
}

/* ══════════ B. 宿主侧三条路径 ══════════ */
{
    const raw = read('index.js');
    const isrc = strip(raw);

    const slice = (a, b) => {
        const i = isrc.indexOf(a);
        const j = isrc.indexOf(b, i + 1);
        ok(`切片锚点存在: ${a.slice(0, 28)}`, i >= 0 && j > i);
        return isrc.slice(i, j);
    };
    const P1 = slice("    function onChatChanged() {\n", "_lastWechatConversationId = null;");
    const P2 = slice("window.addEventListener('phone:clearCurrentData'", "window.addEventListener('phone:clearAllData'");
    const P3 = slice("window.addEventListener('phone:clearAllData'", "const context = getContext();");

    // B1 换会话是**会话作用域**，不是实例销毁 → 不得全域清零
    ok('B1a 换会话路径已无 disposeChildRuntimes(\'\')（全域清零）',
        !/disposeChildRuntimes\(''\)/.test(P1));
    ok('B1b 换会话路径确有仍被复用的实例（说明不该全域清零）',
        /musicApp\.onChatChanged/.test(P1) && /gamesApp\.onChatChanged/.test(P1) && /worldpulseApp\.onChatChanged/.test(P1));

    // B2 清当前数据：丢弃 honeyApp 前必须留出口（实例出口 或 域名兜底，至少一个）
    ok('B2a 清当前数据 honey 有出口',
        /honeyApp\.deactivate/.test(P2) || /disposeChildRuntimes\('honey-view'\)/.test(P2));
    ok('B2b 清当前数据 honey 置 null 前已回收域',
        /(honeyApp\.deactivate|disposeChildRuntimes\('honey-view'\))[\s\S]{0,260}?window\.VirtualPhone\.honeyApp = null;/.test(P2));

    // B3 albumApp：三条路径都必须先 destroy 再 null（构造期 5 个全局监听器）
    for (const [name, body] of [['换会话', P1], ['清当前数据', P2], ['清全部数据', P3]]) {
        ok(`B3 ${name}站点 album destroy→null 相邻`,
            /window\.VirtualPhone\.albumApp\??\.destroy\??\.\(\);[\s\S]{0,120}?window\.VirtualPhone\.albumApp = null;/.test(body));
    }

    // B4 清全部数据：honey 也要走实例出口（停播放/动画/TTS），不只是域名兜底
    ok('B4 清全部数据 honey 走实例出口', /honeyApp\.deactivate/.test(P3));

    // B5 清当前数据与清全部数据对 imageManager 口径一致
    ok('B5a 清全部数据丢弃 imageManager', /imageManager\s*=\s*null/.test(P3));
    ok('B5b 清当前数据也对齐 imageManager', /imageManager\s*=\s*null/.test(P2));

    // B6 诊断入口暴露过度回收遥测
    ok('B6a runtimeStats 暴露 overDisposed', /snap\.overDisposed = childRuntimeOverDisposed\(\)/.test(isrc));
    ok('B6b 降级分支含 overDisposed 字段', /overDisposed:\s*\{\s*total:\s*0/.test(isrc));
    ok('B6c 遥测从内核导入', /childRuntimeOverDisposed/.test(isrc.split('\n').find(l => l.includes("from './config/runtime-lifecycle.js'")) || ''));
}

/* ══════════ C. 命名即文档 ══════════ */
{
    const view = strip(read('apps/honey/honey-view.js'));
    const app = strip(read('apps/honey/honey-app.js'));

    // C1 removePhoneChromeTheme 不再拥有域生命周期
    const rIdx = view.indexOf('    removePhoneChromeTheme() {');
    ok('C1a removePhoneChromeTheme 存在', rIdx >= 0);
    const rEnd = view.indexOf('\n    }', rIdx);
    const rBody = view.slice(rIdx, rEnd);
    ok('C1b 它不再 dispose 视图域', !/_rt\.dispose\(\)/.test(rBody));
    ok('C1c 它仍然摘掉 DOM 主题（行为未退化）', /classList\.remove\('phone-body-panel-honey'\)/.test(rBody));

    // C2 域出口有独立名字，且确实回收域
    const eIdx = view.indexOf('    exitHoneySurface() {');
    ok('C2a exitHoneySurface 存在', eIdx >= 0);
    const eEnd = view.indexOf('\n    }', eIdx);
    const eBody = view.slice(eIdx, eEnd);
    ok('C2b 它回收视图域', /_rt\.dispose\(\)/.test(eBody));
    ok('C2c 它复用了 DOM 主题清理（不分叉）', /removePhoneChromeTheme\(\)/.test(eBody));

    // C3 调用点全部落在新名字上（出口必须能从调用处读出来）
    //   唯一允许保留的旧名调用是 exitHoneySurface 内部的委派 ——
    //   它让 DOM 清理与域注销共用同一条路径，不产生第二份实现。
    const oldCalls = (view.match(/this\.removePhoneChromeTheme\(\);/g) || []).length;
    ok('C3a 旧名只剩 1 处内部委派', oldCalls === 1, String(oldCalls));
    const newCalls = (view.match(/this\.exitHoneySurface\(\);/g) || []).length;
    ok('C3b 视图内新名调用点 >= 6（导航出口）', newCalls >= 6, String(newCalls));
    // 结构性不变量：唯一的旧名调用必须在 exitHoneySurface 体内
    const eIdx2 = view.indexOf('    exitHoneySurface() {');
    const eEnd2 = view.indexOf('\n    }', eIdx2);
    const oldAt = view.indexOf('this.removePhoneChromeTheme();');
    ok('C3e 那处旧名调用确实在 exitHoneySurface 体内', oldAt > eIdx2 && oldAt < eEnd2);
    const appOld = (app.match(/removePhoneChromeTheme/g) || []).length;
    ok('C3c honey-app 不再引用旧名', appOld === 0, String(appOld));
    const appNew = (app.match(/exitHoneySurface/g) || []).length;
    ok('C3d honey-app 三处（swipe-back/destroy/deactivate）走新出口', appNew === 3, String(appNew));
}

/* ══════════ D. 发布卫生 ══════════ */
{
    const idx = read('index.js');
    const manifest = JSON.parse(read('manifest.json'));
    const pkg = JSON.parse(read('package.json'));
    const log = JSON.parse(read('update-log.json'));
    const v = /const ST_PHONE_VERSION = '([\d.]+)'/.exec(idx)?.[1];
    ok('D1 index.js 版本 >= 2.30.0', vnum(v) >= vnum('2.30.0'), v);
    ok('D2 manifest 同版', manifest.version === v, `${manifest.version} vs ${v}`);
    ok('D3 package.json 同版', pkg.version === v, `${pkg.version} vs ${v}`);
    ok('D4 update-log 有本版条目', !!log.versions?.[v], Object.keys(log.versions || {}).slice(0, 3).join(','));
    /* [v2.30.0] 交棒：D5 原用当前版本 v 查关键词，属同一类可变形状
       （关键词是本版叙事，下一版必然翻红）—— 改钉 2.30.0 历史条目。 */
    const v230Items = ((log.versions?.['2.30.0'] || {}).items || []).join('\n');
    ok('D5 update-log 条目含主线关键词（钉 2.30.0 历史条目）',
        /过度回收|域出口|处置/.test(v230Items));
    /* [v2.30.0] 本版新继承的不变量：本轮实测正是「条目写了、latest 忘了改」
       导致 5 个历史测试文件同时翻红 —— 发布卫生漏一环，下游全都看得见。 */
    ok('D6 update-log.latest 指向当前版本', log.latest === v, `${log.latest} vs ${v}`);
    ok('D7 update-log.versions 头部即当前版本', Object.keys(log.versions || {})[0] === v,
        Object.keys(log.versions || {})[0]);
    /* [v2.30.0] 内置离线公告必须与本版同源。
       动机：本轮实测发现公告三版未更新 —— version 取 ST_PHONE_VERSION（标题
       永远显示当前版本），items 却停在 v2.27 时代。而仓库私有时远端通道
       （raw.githubusercontent）恒 404，local 公告就是用户唯一能看到的更新说明，
       「版本号对了、内容是旧的」比没有更误导。
       判据刻意不写死关键词：从本版 update-log 条目的【标签】里抽词，要求公告命中
       其一 —— 随版本自动换词，既不需要交棒，也不会放过「推进版本却没改公告」。 */
    const ann = (idx.match(/const ST_PHONE_CURRENT_UPDATE = \{[\s\S]*?\n\};/) || [''])[0];
    const labelWords = (((log.versions?.[v] || {}).items) || [])
        .map(s => (/^【([^】]+)】/.exec(s) || [])[1] || '')
        .filter(Boolean)
        .flatMap(t => t.split(/[：:·、\s\-—]+/).filter(w => w.length >= 3));
    ok('D8 内置离线公告与本版更新日志同源', labelWords.length > 0
        && labelWords.some(w => ann.includes(w)),
        `labels=${labelWords.slice(0, 4).join('|')} annLen=${ann.length}`);
    ok('D9 内置离线公告条目数 >= 4',
        (ann.match(/^ {8}["']/gm) || []).length >= 4,
        String((ann.match(/^ {8}["']/gm) || []).length));
}

function resetAll() {
    for (const n of ['a1-lifecycle', 'a2-early', 'a3-repeat', 'a4-still-collectable']) {
        try { disposeChildRuntimes(n); } catch (_) { }
    }
}

console.log(`\n[v2.30.0] 通过 ${pass} / 失败 ${fail}`);
process.exitCode = fail ? 1 : 0;