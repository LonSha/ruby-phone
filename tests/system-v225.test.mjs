/* ============================================================
 * [v2.25.0] 懒加载单例重建时的全局监听器泄漏 回归测试。
 * ------------------------------------------------------------
 * 背景（v2.23/v2.24 的另一面）：
 *   v2.23/v2.24 采用「保留实例、仅重建数据层」，注释里点名的理由正是
 *   「避免重建实例导致监听器累积泄漏」。但清数据路径上有三个 App 被
 *   直接置 null（下次打开重新 new），而它们的构造器用匿名函数往
 *   window/document 注册监听器、无幂等 guard、无解绑：
 *     - album    构造期 5 个（phone:swipeBack / albumImageDeleted /
 *                updateWallpaper / panelVisibility + document visibilitychange）
 *     - calendar 构造期 1 个（phone:swipeBack）
 *   另 weibo 类内 destroy() 早已存在（解绑 _swipeHandler），但 index.js
 *   置 null 时从未调用 —— 有解绑能力却没接线，等价于泄漏。
 *   对照安全范式（本轮不改，仅作非回归基线）：
 *     mofo / wechat / honey 用 window._xxxBound 幂等 guard + 动态取实例；
 *     music 用 remove-then-add 幂等重绑。
 *
 * 修复：album/calendar 监听器改由实例字段持有并新增 destroy()；
 *       index.js 四处置 null 站点先 destroy 再置 null。
 *
 * 分工：真实 App 类 + 可配对校验的 mock DOM（记录 add/remove 的
 *       handler 引用，只有引用一致才算真解绑）+ 接线断言。不硬编码版本号。
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

// ---------- mock DOM：真实注册表语义（只有 handler 引用完全相等才解绑）----------
// 关键：若 destroy 里 removeEventListener 传错引用（如又写了个新箭头函数），
// 计数不会下降 —— 从而真正暴露"看似解绑实则泄漏"的缺陷，而非假绿。
const registry = [];   // { target, type, handler, capture }
function makeTarget(name) {
    return {
        addEventListener(type, handler, opts) {
            registry.push({ target: name, type, handler, capture: opts === true });
        },
        removeEventListener(type, handler, opts) {
            const cap = opts === true;
            const i = registry.findIndex(r =>
                r.target === name && r.type === type && r.handler === handler && r.capture === cap);
            if (i >= 0) registry.splice(i, 1);   // 引用不匹配 → 不移除（真实浏览器行为）
        },
    };
}
const liveCount = () => registry.length;
const liveTypes = (target) => registry
    .filter(r => r.target === target)
    .map(r => r.type)
    .reduce((acc, t) => (acc[t] = (acc[t] || 0) + 1, acc), {});
const typeList = (target) => registry.filter(r => r.target === target).map(r => r.type);
const resetRegistry = () => { registry.length = 0; };
const snapshot = () => registry.map(r => ({ ...r }));

globalThis.window = Object.assign(makeTarget('window'), { VirtualPhone: {}, location: { href: 'http://x/' } });
globalThis.document = Object.assign(makeTarget('document'), {
    hidden: false,
    getElementById: () => null,
    createElement: () => ({ setAttribute() {}, addEventListener() {}, style: {}, appendChild() {} }),
    head: { appendChild() {} },
    querySelector: () => null,
    querySelectorAll: () => [],
    documentElement: { style: {}, setAttribute() {}, classList: { add() {}, remove() {} } },
    body: { appendChild() {}, style: {}, classList: { add() {}, remove() {} } },
});

const mem = { get: (k, d) => d, set() {} };
const { CalendarApp } = await import('../apps/calendar/calendar-app.js');
const { AlbumApp } = await import('../apps/album/album-app.js');
const { WeiboApp } = await import('../apps/weibo/weibo-app.js');

// ========== 1. calendar：注册 1 个，destroy 精确解绑 ==========
{
    const before = liveCount();
    const a = new CalendarApp(null, mem);
    ok('calendar: 构造期注册 1 个全局监听器', liveCount() - before === 1, String(liveCount() - before));
    ok('calendar: 监听的是 phone:swipeBack', Object.keys(liveTypes('window')).includes('phone:swipeBack'));
    ok('calendar: 定义 destroy()', typeof a.destroy === 'function');
    a.destroy();
    ok('calendar: destroy 后归零（handler 引用配对正确）', liveCount() === before, JSON.stringify(liveTypes('window')));
}

// ========== 2. album：注册 5 个，destroy 精确解绑（含 document 端）==========
{
    const before = liveCount();
    const b = new AlbumApp(null, mem);
    ok('album: 构造期注册 5 个全局监听器', liveCount() - before === 5, String(liveCount() - before));
    const win = typeList('window').join(','), doc = typeList('document').join(',');
    ok('album: window 端 4 个事件齐全',
        ['phone:swipeBack', 'phone:albumImageDeleted', 'phone:updateWallpaper', 'phone:panelVisibility']
            .every(t => win.includes(t)), win);
    ok('album: document 端 visibilitychange 在位', doc.includes('visibilitychange'), doc);
    ok('album: 定义 destroy()', typeof b.destroy === 'function');
    b.destroy();
    ok('album: destroy 后归零（解绑覆盖全部注册类型）', liveCount() === before,
        JSON.stringify({ win, doc }));
}

// ========== 3. weibo：destroy 早已存在，本轮验证其可用 ==========
{
    const before = liveCount();
    const c = new WeiboApp(null, mem);
    ok('weibo: 构造期注册 1 个监听器', liveCount() - before === 1, String(liveCount() - before));
    c.destroy();
    ok('weibo: destroy 精确解绑（本轮接线的依据）', liveCount() === before);
}

// ========== 4. 泄漏对照：重建不 destroy 会永久累积；配平则恒零 ==========
{
    const ROUNDS = 6;
    const base = liveCount();
    for (let i = 0; i < ROUNDS; i++) { new AlbumApp(null, mem); new CalendarApp(null, mem); }
    ok(`对照: ${ROUNDS} 次重建不 destroy → 净增 ${ROUNDS * 6} 个监听器（修复前形态）`,
        liveCount() - base === ROUNDS * 6, String(liveCount() - base));
    // 之后即使每轮都正确 destroy，早先漏掉的仍永久残留（不可自愈）
    for (let i = 0; i < ROUNDS; i++) {
        const a = new AlbumApp(null, mem); a.destroy();
        const b = new CalendarApp(null, mem); b.destroy();
    }
    ok('对照: 后续配平不能消除历史泄漏（证明"漏一次即永久残留"）',
        liveCount() - base === ROUNDS * 6, String(liveCount() - base));

    // 干净基线上的范式验证：每轮 new→destroy 严格配平，N 轮后净 0
    resetRegistry();
    const clean0 = liveCount();
    for (let i = 0; i < ROUNDS; i++) {
        const a = new AlbumApp(null, mem); a.destroy();
        const b = new CalendarApp(null, mem); b.destroy();
        const c = new WeiboApp(null, mem); c.destroy();
    }
    ok('范式: 干净基线上 N 轮 new→destroy 净 0（修复后形态）',
        liveCount() === clean0, String(liveCount() - clean0));
}

// ========== 5. 接线断言：index.js 四处置 null 站点先 destroy ==========
{
    const isrc = fs.readFileSync(path.join(root, 'index.js'), 'utf8');
    ok('index.js: clearCurrentData 站点 album destroy→null 相邻',
        /window\.VirtualPhone\.albumApp\?\.destroy\?\.\(\);\s*\n\s*window\.VirtualPhone\.albumApp = null;/.test(isrc));
    ok('index.js: clearCurrentData 站点 calendar destroy→null 相邻',
        /window\.VirtualPhone\.calendarApp\?\.destroy\?\.\(\);\s*\n\s*window\.VirtualPhone\.calendarApp = null;/.test(isrc));
    ok('index.js: clearAllData 站点 calendar clearCache→destroy→null 顺序',
        /calendarApp\.clearCache\(\);\s*\n\s*window\.VirtualPhone\.calendarApp\.destroy\?\.\(\);[^\n]*\n\s*window\.VirtualPhone\.calendarApp = null;/.test(isrc));
    ok('index.js: clearAllData 站点 weibo clearCache→destroy→null 顺序',
        /weiboApp\.clearCache\(\);\s*\n\s*window\.VirtualPhone\.weiboApp\.destroy\?\.\(\);[^\n]*\n\s*(?:\/\/[^\n]*\n\s*)?try \{ disposeChildRuntimes\('weibo-app'\); \} catch \(_e\) \{ \/\* 忽略 \*\/ \}\s*\n\s*window\.VirtualPhone\.weiboApp = null;/.test(isrc),
        '[v2.28.0] destroy 与置 null 之间新增实例域回收（顺序不变量保持）');
    // [v2.30.0] 交棒：条数从「恰好 4」改为「不少于 4」。
    //   写死等值是形状而非不变量 —— v2.30 把同一模式推广到原本漏掉的两条路径
    //   （换会话、清全部数据都补了 albumApp 的 destroy→null），条数增长应被允许；
    //   真正要守的是「接线不许变少」。新增的接线点由下面两条显式断言钉住。
    const n = (isrc.match(/(albumApp|calendarApp|weiboApp)\??\.destroy\?\.\(\)/g) || []).length;
    ok('index.js: 三 App destroy 接线不少于 4 处', n >= 4, String(n));
    // [v2.30.0] 新增接线点：换会话站点（P1）与清全部数据站点（P3）的 album destroy→null
    ok('index.js: 换会话站点 album destroy→null 相邻（v2.30 补齐）',
        /window\.VirtualPhone\.albumApp\.destroy\?\.\(\); \} catch \(_e\) \{ \/\* 忽略 \*\/ \}\s*\n\s*window\.VirtualPhone\.albumApp = null;/.test(isrc));
    const clearAllCount = (isrc.match(/window\.VirtualPhone\.albumApp\?\.destroy\?\.\(\);\s*\n\s*window\.VirtualPhone\.albumApp = null;/g) || []).length;
    ok('index.js: album destroy→null 相邻至少 2 处（clearCurrentData + clearAllData）', clearAllCount >= 2, String(clearAllCount));
}

// ========== 6. 非回归：既有安全范式不被本轮改动破坏 ==========
{
    const sui = f => fs.readFileSync(path.join(root, f), 'utf8');
    // [v2.27.0] 断言形式随实现收敛更新：手写 window._xxxBound guard 已迁移到
    //   onceFlag（等价幂等语义）+ 登记层（window 监听器可回收）。此处断言的是
    //   「幂等 guard 依然存在」这一不变量，而非旧的实现载体。
    const mofo = sui('apps/mofo/mofo-app.js');
    ok('mofo: 幂等 guard 保持（onceFlag 形式）',
        /if \(onceFlag\('mofoSwipeBack'\)\) \{/.test(mofo)
        && /globalRuntime\.addListener\(window, PHONE_EVENTS\.SWIPE_BACK/.test(mofo)
        && !/window\._mofoSwipeBackBound = true/.test(mofo));
    const wc = sui('apps/wechat/wechat-app.js');
    ok('wechat: 幂等 guard 保持（onceFlag 形式）',
        /if \(onceFlag\('wechatSwipeBack'\)\) \{/.test(wc)
        && /globalRuntime\.addListener\(window, PHONE_EVENTS\.SWIPE_BACK/.test(wc)
        && !/window\._wechatSwipeBackBound = true/.test(wc));
    const ho = sui('apps/honey/honey-app.js');
    ok('honey: 三个幂等 guard 保持（onceFlag 形式）',
        ['honeySwipeBack', 'honeyPanelVisibility', 'honeyDocumentVisibility']
            .every(g => new RegExp(`if \\(onceFlag\\('${g}'\\)\\)`).test(ho))
        && ['_honeySwipeBackBound', '_honeyPanelVisibilityBound', '_honeyDocumentVisibilityBound']
            .every(g => !new RegExp(`window\\.${g} = true;`).test(ho)));
    const mu = sui('apps/music/music-app.js');
    ok('music: remove-then-add 幂等重绑保持',
        /if \(window\._musicSwipeBackHandler\) \{\s*\n\s*window\.removeEventListener\('phone:swipeBack', window\._musicSwipeBackHandler\)/.test(mu));
    ok('music: 未引入多余 destroy 接线（本轮不改 music）',
        !/musicApp\??\.destroy/.test(sui('index.js')));
}

// ========== 7. 范围自证：只处理"会被置 null 重建"的 App ==========
{
    const isrc = fs.readFileSync(path.join(root, 'index.js'), 'utf8');
    const nulled = new Set([...isrc.matchAll(/window\.VirtualPhone\.(\w+App) = null/g)].map(m => m[1]));
    ok('范围: albumApp/calendarApp/weiboApp 确实在置 null 清单内',
        ['albumApp', 'calendarApp', 'weiboApp'].every(a => nulled.has(a)), JSON.stringify([...nulled]));
    // 仅走 onChatChanged（保留实例）的 App 不应被误加 destroy 接线
    const kept = ['tiebaApp', 'xhsApp', 'gachaApp', 'readingApp', 'tarotApp', 'healthApp',
        'achievementApp', 'playbookApp', 'bilibiliApp', 'theaterApp'];
    for (const a of kept) {
        if (new RegExp(`VirtualPhone\\.${a}\\??\\.destroy`).test(isrc)) {
            ok(`范围: ${a} 不应被加 destroy（保留实例、无监听器）`, false, '发现多余接线');
        }
    }
    ok('范围: 保留实例的 10 个 App 均未被误加 destroy 接线',
        !kept.some(a => new RegExp(`VirtualPhone\\.${a}\\??\\.destroy`).test(isrc)));
    // 无 guard 且被置 null 的 App 必须已有 destroy 站点（防未来新增 App 漏配）
    const noGuardNullSites = [...isrc.matchAll(/window\.VirtualPhone\.(\w+App)\s*=\s*null/g)].map(m => m[1]);
    const handled = new Set(noGuardNullSites.filter(a =>
        new RegExp(`VirtualPhone\\.${a}\\??\\.destroy|VirtualPhone\\.${a}\\.destroy`).test(isrc)
        || /wechatApp|mofoApp|honeyApp|musicApp/.test(a)));
    ok('范围: 所有置 null 站点要么 destroy 要么有幂等 guard',
        new Set(noGuardNullSites).size === handled.size,
        JSON.stringify({ sites: [...new Set(noGuardNullSites)], handled: [...handled] }));
}

console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
if (fail > 0) process.exitCode = 1;