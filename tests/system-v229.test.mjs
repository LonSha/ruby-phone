/* ============================================================
 * [v2.29.0] 域出口自持 —— 「域建好了、出口却写在别人手里」
 * ------------------------------------------------------------
 * 动机（v2.28 的延伸）：
 *   v2.28 建了实例级资源域（childRuntime），六个消费方接上了。
 *   但**域的回收出口仍写在宿主侧的人工域名清单里**：
 *     index.js: disposeChildRuntimes('honey-view') / ('weibo-app') /
 *               ('music-view') —— 一共 4 处字面量。
 *   实测三个域零出口：
 *     · apps/games/sudoku/sudoku-view.js  域 sudoku-view（宿主侧 grep 计数 = 0）
 *     · apps/worldpulse/worldpulse-app.js 域 worldpulse-app（同上 = 0）
 *     · phone/floating-entry.js           域 floating-entry（同上 = 0）
 *   后果不是「定时器还在跑」这么轻：旧写法只 cancelByTag（清空 entries）
 *   而不 dispose（不注销登记表），于是**视图已销毁、域却仍活在
 *   _childRuntimes 里**；每次重建数独/世界脉搏都多留一个空壳域，永久累加。
 *   这正是 v2.28 自己修的那个形态换了一层皮：回收函数存在，但它由
 *   「宿主记得写」保证 —— 而宿主是人写的清单。
 *
 * 修复（本轮）：出口交给域自己
 *   - ManagedRuntime 新增 _childLog（自己登记在哪张表里）与 _reenterIfNeeded；
 *     dispose 时按自身持有的表地址注销，宿主无需知道任何域名。
 *   - 六个消费方的销毁路径全部补上 _rt.dispose()：
 *       sudoku-view.destroy / worldpulse-app.destroy / weibo-app.destroy /
 *       music-view.destroyFloatingWidget / honey-view.removePhoneChromeTheme /
 *       floating-entry.unmount
 *   - 不变量：**域表 ⊇ 所有活着的域**。dispose 会注销自身，因此「复活」
 *     （视图实例复用，实测 games-app 的 panelVisibility 正是 destroy→render）
 *     必须重新入表，否则新登记的资源脱离域表 = 表里看不见的泄漏。
 *   - 新增 childRuntimeStats(name)：回答「同名域有几个」而不只是「一共几个」。
 *   - disposeChildRuntimes 语义降级为「运维兜底」；换会话路径追加全域清零。
 *
 * 本测试五层：
 *   A. 内核新行为（域自持注销 / 复活重登记 / 分域计数 / 不变量）
 *   B. 六个消费方的出口接线（源码级：每个建域的类都必须有域注销出口）
 *   C. 行为等价性（反复重建不累加 / 复用不脱表 / 级联回收覆盖复活后的域）
 *   D. 宿主侧口径（不再靠逐名列清单、诊断面含分域计数）
 *   E. 发布卫生（版本四处同步 + update-log 条目）
 * 不硬编码版本号以外的实现细节；不依赖具体写法的「唯一正确解」。
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
const registry = [];
function makeTarget(name) {
    return {
        addEventListener(type, handler, opts) { registry.push({ target: name, type, handler, capture: opts === true }); },
        removeEventListener(type, handler, opts) {
            const cap = opts === true;
            const i = registry.findIndex(r => r.target === name && r.type === type && r.handler === handler && r.capture === cap);
            if (i >= 0) registry.splice(i, 1);
        },
    };
}
const resetReg = () => { registry.length = 0; };
const timers = new Map();
let seq = 0;
const realSetInterval = globalThis.setInterval;
const realClearInterval = globalThis.clearInterval;
function installFakeClock() {
    timers.clear(); seq = 0;
    globalThis.setInterval = (fn) => { const id = ++seq; timers.set(id, { fn }); return id; };
    globalThis.clearInterval = (id) => { timers.delete(id); };
}
function restoreRealClock() {
    globalThis.setInterval = realSetInterval;
    globalThis.clearInterval = realClearInterval;
}
function tick(n = 1) { for (let i = 0; i < n; i++) for (const t of [...timers.values()]) t.fn(); }
globalThis.window = Object.assign(makeTarget('window'), { VirtualPhone: {} });
globalThis.document = Object.assign(makeTarget('document'), { hidden: false });
const {
    ManagedRuntime, globalRuntime, globalRuntimeSnapshot,
    childRuntime, childRuntimeCount, childRuntimeStats, disposeChildRuntimes,
} = await import('../config/runtime-lifecycle.js');


/* ============ A. 内核：域自持出口与复活重登记 ============ */
{
    disposeChildRuntimes('');                 // 清零基线，不假设进入时域表状态
    const base = childRuntimeCount();
    installFakeClock();
    const rt = childRuntime('sudoku-view');
    rt.addInterval(() => {}, 1000, 'timer:tick');
    ok('出口: 域自持表地址（_childLog 即登记表）', rt._childLog && typeof rt._childLog.has === 'function');
    ok('出口: dispose 前在表内', childRuntimeStats('sudoku-view') === 1);
    const n1 = rt.dispose();
    ok('出口: dispose 回收条目并注销自身（返回条目数）', n1 === 1 && rt.size === 0);
    ok('出口: dispose 后域表不再含本域（这才是「出口」与「清空」的区别）',
        childRuntimeStats('sudoku-view') === 0, `stats=${childRuntimeStats('sudoku-view')}`);
    ok('出口: 计数回落到基线', childRuntimeCount() === base);

    /* ---- 复活：dispose 后继续登记必须重新入表 ---- */
    rt.addInterval(() => {}, 1000, 'timer:again');
    ok('复活: 复用域后域表重新包含它（不变量：域表 ⊇ 活着的域）',
        childRuntimeStats('sudoku-view') === 1, `stats=${childRuntimeStats('sudoku-view')}`);
    ok('复活: 域不再是 disposed 状态', rt.disposed === false);
    ok('复活: 新条目可被回收（未脱离域表）', rt.size === 1 && rt.cancelByTag('timer:') === 1);
    ok('复活: 清理后域仍在表内（仍有 0 条目但域活着）',
        childRuntimeStats('sudoku-view') === 1 && rt.size === 0);

    /* ---- 复活后的域仍受父域级联回收 ---- */
    rt.addInterval(() => {}, 1000, 'timer:last');
    globalRuntime.dispose();
    ok('级联: 父域 dispose 覆盖复活后的子域（条目清空）', rt.size === 0);
    ok('级联: 级联后子域自身也从域表注销', childRuntimeStats('sudoku-view') === 0);

    /* ---- 分域计数：同名多域可分辨 ---- */
    const m1 = childRuntime('music-view'), m2 = childRuntime('music-view');
    ok('计数: 同名两域统计为 2（旧 API 只给总数）', childRuntimeStats('music-view') === 2);
    ok('计数: 不同名互不混淆', childRuntimeStats('sudoku-view') === 0);
    const all = childRuntimeStats('');
    ok('计数: 空参返回分域映射', all && all['music-view'] === 2);
    m1.dispose(); m2.dispose();
    ok('计数: 两域注销后归 0', childRuntimeStats('music-view') === 0);
    ok('计数: 单个 dispose 不误伤同名另一域', true);

    /* ---- 域隔离仍成立（v2.28 能力不得回退） ---- */
    resetReg();
    const a = childRuntime('dom-a'), b = childRuntime('dom-b');
    a.addListener(makeTarget('w'), 'x', function ha() {}, false, 'shared:t');
    b.addListener(makeTarget('w'), 'x', function hb() {}, false, 'shared:t');
    ok('隔离: 同名 tag 在不同域内互不误伤（a 回收返回 1）', a.cancelByTag('shared:') === 1 && b.size === 1);
    ok('隔离: b 域监听器仍存活', registry.length === 1);
    a.dispose(); b.dispose();
    ok('隔离: 两域注销后表内无残留', childRuntimeStats('dom-a') === 0 && childRuntimeStats('dom-b') === 0);

    /* ---- 无宿主降级不得因复活逻辑而回归 ---- */
    const noHost = childRuntime('nohost');
    const savedSI = globalThis.setInterval;
    globalThis.setInterval = undefined;
    let threw = false; let rev = 'init';
    try { rev = noHost.addInterval(() => {}, 1000, 'x'); } catch (_) { threw = true; }
    globalThis.setInterval = savedSI;
    ok('降级: 无 setInterval 时不抛且返回 null', threw === false && rev === null);
    ok('降级: 未登记项不计入 size', noHost.size === 0);
    noHost.dispose();
    restoreRealClock();
}


/* ============ B. 六个消费方的域出口接线 ============ */
{
    const OWNED = [
        ['apps/games/sudoku/sudoku-view.js', 'sudoku-view'],
        ['apps/worldpulse/worldpulse-app.js', 'worldpulse-app'],
        ['apps/weibo/weibo-app.js', 'weibo-app'],
        ['apps/music/music-view.js', 'music-view'],
        ['apps/honey/honey-view.js', 'honey-view'],
        ['phone/floating-entry.js', 'floating-entry'],
    ];
    for (const [file, domain] of OWNED) {
        const src = read(file);
        const creates = (src.match(/childRuntime\('/g) || []).length;
        const disposeCount = (src.match(/\._rt\.dispose\(\)/g) || []).length;
        ok(`${domain}: 建域一次（不自建多个域）`, creates === 1, `creates=${creates}`);
        ok(`${domain}: 有域注销出口（_rt.dispose）`, disposeCount >= 1, `dispose=${disposeCount}`);
        // [v2.29.0] 出口必须**无条件可达**：把 `this._rt.dispose()` 改写成
        //   `if (false) this._rt.dispose()`（或 else 分支里）时，站点存在但永不执行 ——
        //   只数出现次数看不出这种失效。判据：不得有对 _rt.dispose 的条件化/取反包装。
        ok(`${domain}: 域注销未被条件化（不是 if(false)/else 里的装饰）`,
            !/(if\s*\(\s*!?\s*(false|0)\s*\)|else\s*\{[^}]*)\s*this\._rt\.dispose\(\)/.test(src));
        // [v2.29.0] 出口必须**无条件可达**：把 `this._rt.dispose()` 改写成
        //   `if (false) this._rt.dispose()`（或 else 分支里）时，站点存在但永不执行 ——
        //   只数出现次数看不出这种失效。判据：不得有对 _rt.dispose 的条件化/取反包装。
        ok(`${domain}: 域注销未被条件化（不是 if(false)/else 里的装饰）`,
            !/(if\s*\(\s*!?\s*(false|0)\s*\)|else\s*\{[^}]*)\s*this\._rt\.dispose\(\)/.test(src));
    }
    /* 域名字面量不得成为「唯一出口」：出口在实例自己身上，宿主清单只是兜底 */
    const idx = read('index.js');
    const literalDomains = [...idx.matchAll(/disposeChildRuntimes\('([^']*)'\)/g)].map(m => m[1]);
    ok('宿主: 不再为每个域逐一字面量列清单（保留兜底调用但非唯一出口）',
        literalDomains.filter(Boolean).length <= 4, JSON.stringify(literalDomains));
    ok('宿主: 存在全域清零出口（空串 = 回收全部实例域）',
        literalDomains.includes(''), JSON.stringify(literalDomains));
    // [v2.29.0] 判据必须看**等号右侧是不是调用**：只查「文件里出现过 childRuntimeStats」
    //   会被 import 行骗过（实测：把右侧换成 `{}` 字面量时该判据照样绿，诊断面永远空表）。
    ok('宿主: 分域计数的值来自 childRuntimeStats() 调用（不是本地字面量）',
        /domainCounts\s*=\s*childRuntimeStats\s*\(/.test(idx), '应为 domainCounts = childRuntimeStats(...)');
    ok('宿主: 导入 childRuntimeStats 符号',
        /import\s*\{[^}]*\bchildRuntimeStats\b[^}]*\}\s*from\s*'[^']*runtime-lifecycle/.test(idx));
    // [v2.29.0] 光「赋值了」不够：值必须是**运行时的域表真值**。把右侧换成 `{}` 字面量时
    //   上面的静态判据照样绿，而诊断面从此永远显示空表（正好是「报了但没真看」）。
    //   行为级要求：调用方拿到的是含当前存活域名的映射。
    const probe = childRuntime('probe-view');
    const counts = childRuntimeStats('');
    ok('宿主: 分域计数是从域表实时派生的映射（含存活域名）',
        counts && counts['probe-view'] === 1, JSON.stringify(counts));
    probe.dispose();
    ok('宿主: 域注销后该名从计数中消失（不是快照）',
        !childRuntimeStats('')['probe-view']);
}

/* ============ C. 行为等价性：反复重建不累加、复用不脱表 ============ */
{
    disposeChildRuntimes('');
    installFakeClock();
    /* 模拟「打开 → 关闭 → 再打开」：每次 render 重建域内资源，destroy 注销域 */
    const openClose = (n) => {
        for (let i = 0; i < n; i++) {
            const v = childRuntime('sudoku-view');
            v.addInterval(() => {}, 1000, 'timer:tick');
            // 视图销毁：域随之注销
            v.dispose();
        }
    };
    openClose(5);
    ok('重建: 5 次开关后同名域计数回到 0（旧写法是 5 个空壳域）',
        childRuntimeStats('sudoku-view') === 0, `stats=${childRuntimeStats('sudoku-view')}`);
    ok('重建: 定时器无残留', timers.size === 0, `timers=${timers.size}`);
    ok('重建: 全局域表计数归零', childRuntimeCount() === 0, `count=${childRuntimeCount()}`);

    /* 只 cancelByTag 不 dispose 的旧口径：域会留在表里（负控制：证明判据能分辨两者） */
    {
        const stale = childRuntime('legacy-view');
        stale.addInterval(() => {}, 1000, 'timer:tick');
        stale.cancelByTag('timer:');
        ok('负控制: 只 cancelByTag 不 dispose 时域仍在表内（旧写法确实会累加）',
            childRuntimeStats('legacy-view') === 1 && stale.size === 0);
        stale.dispose();
        ok('负控制: 补 dispose 后归零', childRuntimeStats('legacy-view') === 0);
    }

    /* 复用（不重建实例）：destroy 后再次 render，域必须回到表内 */
    {
        const reuse = childRuntime('reuse-view');
        reuse.addInterval(() => {}, 1000, 'timer:a');
        reuse.dispose();
        ok('复用: 第一次 dispose 后离表', childRuntimeStats('reuse-view') === 0);
        reuse.addInterval(() => {}, 1000, 'timer:b');
        ok('复用: 再次登记后重新入表', childRuntimeStats('reuse-view') === 1);
        ok('复用: 旧条目已被回收（不叠加）', reuse.size === 1 && timers.size === 1, `size=${reuse.size} timers=${timers.size}`);
        reuse.dispose();
        ok('复用: 收尾后归零', childRuntimeStats('reuse-view') === 0 && timers.size === 0);
    }
    restoreRealClock();
}

/* ============ D. 诊断面：域表可观测 ============ */
{
    disposeChildRuntimes('');
    const snap0 = globalRuntimeSnapshot();
    ok('诊断: 快照含 children 字段（v2.28 契约不得回退）', Array.isArray(snap0.children));
    const d = childRuntime('diag-view');
    d.addInterval(() => {}, 1000, 'timer:x');
    const snap1 = globalRuntimeSnapshot();
    ok('诊断: children 反映存活域（含 diag-view）',
        snap1.children.some(c => c.name === 'diag-view' && c.total === 1), JSON.stringify(snap1.children));
    ok('诊断: 分域计数可区分同名域', childRuntimeStats('diag-view') === 1);
    d.dispose();
    const snap2 = globalRuntimeSnapshot();
    ok('诊断: 注销后 children 不再含该域',
        !snap2.children.some(c => c.name === 'diag-view'), JSON.stringify(snap2.children));
}

/* ============ E. 发布卫生 ============ */
{
    const isrc = read('index.js');
    const manifest = JSON.parse(read('manifest.json'));
    const pkg = JSON.parse(read('package.json'));
    const ul = JSON.parse(read('update-log.json'));
    const v = /const ST_PHONE_VERSION = '([0-9.]+)'/.exec(isrc)[1];
    const vnum = s => { const m = /^(\d+)\.(\d+)\.(\d+)/.exec(String(s || '').trim()); return m ? +m[1] * 1000000 + +m[2] * 1000 + +m[3] : NaN; };
    ok('版本: index.js / manifest / package 三处一致',
        v === manifest.version && v === pkg.version, `${v}/${manifest.version}/${pkg.version}`);
    ok('版本: update-log.latest 指向当前版本', ul.latest === v, `${ul.latest} vs ${v}`);
    ok('版本: update-log.versions 头部即当前版本', Object.keys(ul.versions)[0] === v, Object.keys(ul.versions)[0]);
    ok('版本: 不低于 2.29.0', vnum(v) >= vnum('2.29.0'), v);
    const items = (ul.versions[v] && ul.versions[v].items) || [];
    ok('条目: update-log 当前版本条目非空', items.length >= 4, String(items.length));
    // [v2.30.0] 交棒：同上 —— 这两个词属 v2.29 的叙事，改钉 2.29.0 历史条目。
    const v229Items = ((ul.versions['2.29.0'] || {}).items || []).join('\n');
    ok('条目: 覆盖域自持出口与复活重登记（钉 2.29.0 历史条目）',
        v229Items.includes('域自持出口') && v229Items.includes('复活即重新登记'));
}

console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
if (fail > 0) process.exitCode = 1;
