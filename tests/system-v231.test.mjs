/* ============================================================
 * [v2.31.0] 重建路径：新界面接上了、旧界面还挂着
 * ------------------------------------------------------------
 * 动机（v2.30 的镜像面）：
 *   v2.30 盯的是「域被回收了、实例还活着」；本版盯同一枚硬币的另一面 ——
 *     「实例被丢弃了、它的资源没人收」。
 *   宿主 createPhoneInPanel() 有四条重入路径（首次打开 / 点击页面横幅直达 App /
 *   微信来电唤醒 / 电话来电），每条都执行 phoneShell?.destroy?.() 后 new PhoneShell()。
 *   壳自己的登记表确实被收净了（v2.26 起），但**同一作用域里还有三个实例被无声丢弃**：
 *     · 旧 homeScreen  —— 4 个 window 监听器彼此用 if (!this._xxxEventBound) 隔离，
 *                        于是没有任何一处能在实例被丢弃时解绑；旧实例会继续响应
 *                        新壳广播的 updateWallpaper / timeUpdated，并渲染进已被摘除的旧 DOM；
 *     · 旧 controlCenter —— 无任何收尾路径，overlay 可能留在废弃容器里，
 *                        用户看到的是「控制器没反应」；
 *     · 旧 phoneShell.lockScreen —— 10s 时钟 + 2 个 window 鼠标监听器，
 *                        不在壳的登记表里（v2.26 只收壳自己登记的）。
 *   另外三条清数据路径（P1 换会话 / P2 清当前数据 / P3 清全部数据）各写各的：
 *   P1 与 P2 只做 homeScreen.render()（实例不换），P3 则完全不碰界面实例。
 *
 * 修复口径（本测试锁定的主张）：
 *   · 收口位置与构造位置同址：宿主里 new 它们的那个函数，必须负责回收它们；
 *   · 界面槽位随会话重生、数据实例复用重绑 —— 收干净不以功能坏掉为代价
 *     （第一版实现把 P1 写成「只收不建」，会让 homeScreen 悬空、桌面时间停更）；
 *   · 壳层登记层从裸 ManagedRuntime 升级为 childRuntime('phone-shell')，
 *     于是「壳重建时旧壳资源收净没有」可见、可计数；
 *   · 新增回收账本 childRuntimeReleaseLog()：v2.29 的 childRuntimeStats 只能回答
 *     「现在有几个域活着」，而「重建前漏回收」与「重建前已回收」在计数上完全同形
 *     （旧域收掉后表里都只剩 1 个），只有账本能分开两者。
 *
 * 本测试五层：
 *   A. 内核回收账本（首次记账 / 幂等不重复计 / 父域级联要记账 / 只回收不复活也记账）
 *   B. 重建总账对账（登记项数 = 现存项数 + 回收项数；重建 N 轮后账本 = N）
 *   C. 壳层与三个实例的出口（存在性 + 真的解绑 + 幂等 + 陈旧实例护栏）
 *   D. 三条清数据路径与界面槽位重建（同一出口 / 别名复位 / 不悬空）
 *   E. 发布卫生（四处版本一致 + latest 指向本版 + 内置公告与日志同源）
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
globalThis.window = Object.assign(makeTarget('window'), { VirtualPhone: { storage: { get: () => null, set: () => {} } } });
globalThis.document = Object.assign(makeTarget('document'), {
    hidden: false,
    createElement: (t) => makeEl(t),
    getElementById: () => null,
});
const {
    childRuntime, childRuntimeCount, childRuntimeStats,
    childRuntimeReleaseLog, childRuntimeOverDisposed, disposeChildRuntimes,
} = await import('../config/runtime-lifecycle.js');

/* ============================================================
 * A. 内核：回收账本
 * ============================================================ */
{
    disposeChildRuntimes('');
    resetReg();
    const name = 'a-ledger';
    const base = childRuntimeReleaseLog(name);
    ok('A1 账本基线：未回收过的域名计数为 0（不假设进入时状态）', base === 0, String(base));

    ok('A2 空串返回全表对象', typeof childRuntimeReleaseLog('') === 'object'
        && childRuntimeReleaseLog('') !== null);
    const table = childRuntimeReleaseLog('');
    ok('A3 全表与单名口径一致', (table[name] || 0) === childRuntimeReleaseLog(name));

    // A4 域随实例生命周期走（销毁时 dispose）→ 账本必须 +1
    {
        const rt = childRuntime(name);
        rt.addListener(window, 'x', () => {});
        rt.dispose();
        ok('A4 首次回收记 1 笔', childRuntimeReleaseLog(name) === 1,
            String(childRuntimeReleaseLog(name)));
    }
    // A5 幂等：重复 dispose 不得重复记账（否则「重建 N 次」与「回收 N 次」无法对账）
    {
        const rt = childRuntime(name);
        rt.addListener(window, 'y', () => {});
        rt.dispose();
        rt.dispose();
        rt.dispose();
        ok('A5 重复 dispose 不重复记账（幂等语义）', childRuntimeReleaseLog(name) === 2,
            String(childRuntimeReleaseLog(name)));
    }
    // A6 账本只增不减：它记录的是历史，不是当前状态
    {
        const rt = childRuntime(name);
        rt.addListener(window, 'z', () => {});
        rt.dispose();
        ok('A6 账本随每次「新实例回收」递增', childRuntimeReleaseLog(name) === 3,
            String(childRuntimeReleaseLog(name)));
    }
    // A7 与「活着的域」分开命名：released 记历史、stats 记现状
    {
        const alive = childRuntime('a-alive');
        alive.addListener(window, 'a', () => {});
        ok('A7a 活着的域：stats 计 1、账本计 0（两者语义不混）',
            childRuntimeStats('a-alive') === 1 && childRuntimeReleaseLog('a-alive') === 0);
        alive.dispose();
        ok('A7b 回收后 stats 归 0、账本变 1', childRuntimeStats('a-alive') === 0
            && childRuntimeReleaseLog('a-alive') === 1);
    }
    // A8 父域级联：被级联回收的子域同样必须记账（否则「重建时漏收的域」仍不可见）
    {
        const child = childRuntime('a-cascade-child');
        child.addListener(window, 'c', () => {});
        const before = childRuntimeReleaseLog('a-cascade-child');
        disposeChildRuntimes('a-cascade-child');
        ok('A8 按名回收（运维兜底）同样记账',
            childRuntimeReleaseLog('a-cascade-child') === before + 1,
            String(childRuntimeReleaseLog('a-cascade-child')));
    }
    // A9 反例对照：只回收、不复活 → 过度回收计数保持 0（两套遥测互不污染）
    {
        const rt = childRuntime('a-clean');
        rt.addListener(window, 'q', () => {});
        rt.dispose();
        const st = rt.overDisposeStats();
        ok('A9 反例：正常销毁不产生过度回收记账（reentered = 0）', st.reentered === 0, JSON.stringify(st));
    }
    // A10 账本口径：**按域对象计一笔**，不是按 dispose 调用计。
    //   同一个域对象被过早回收后复活、又被回收，仍只记一笔 —— 因为「重建」
    //   在宿主里表现为 childRuntime() 新建对象（见 B1：4 轮重建 = 4 笔）。
    //   复活这件事由另一套遥测（overDisposeStats）负责，两套互补不重叠。
    {
        const rt = childRuntime('a-reuse');
        rt.addListener(window, 'r1', () => {});
        rt.dispose();
        const after1 = childRuntimeReleaseLog('a-reuse');
        rt.addListener(window, 'r2', () => {});     // 复活（同一个域对象）
        const n = rt.dispose();
        ok('A10 复活后仍能被回收（行为未退化）', n === 1, String(n));
        ok('A10b 同一域对象只记一笔（按对象计，不按 dispose 计）',
            after1 === 1 && childRuntimeReleaseLog('a-reuse') === 1,
            `after1=${after1} log=${childRuntimeReleaseLog('a-reuse')}`);
        ok('A10c 复活改由「过度回收」遥测记录（两套遥测互补，不重复计量）',
            rt.overDisposeStats().reentered >= 1, JSON.stringify(rt.overDisposeStats()));
        ok('A10d 对照：新建域对象（真正的重建形态）才计新的一笔',
            (() => { const rt2 = childRuntime('a-reuse'); rt2.addListener(window, 'r3', () => {}); rt2.dispose();
                return childRuntimeReleaseLog('a-reuse') === 2; })(),
            String(childRuntimeReleaseLog('a-reuse')));
    }
    disposeChildRuntimes('');
    resetReg();
}

/* ============================================================
 * B. 重建总账对账：登记项数 = 现存项数 + 回收项数
 * ============================================================ */
{
    disposeChildRuntimes('');
    resetReg();
    const name = 'b-rebuild';
    // 模拟宿主重建 4 轮：每轮建域 + 登记 1 个监听器 + 丢弃前 dispose
    for (let i = 0; i < 4; i++) {
        const rt = childRuntime(name);
        rt.addListener(window, 'evt', () => {});
        rt.dispose();
    }
    ok('B1 重建 4 轮 → 账本记 4 笔（漏一轮就会少于 4）',
        childRuntimeReleaseLog(name) === 4, String(childRuntimeReleaseLog(name)));
    ok('B2 同一时刻活着的域为 0（重建后只剩新域，旧域已离表）',
        childRuntimeStats(name) === 0, String(childRuntimeStats(name)));
    ok('B3 监听器净增量 0（每轮 dispose 精确解绑）', live() === 0, String(live()));

    // 反向：漏回收形态 —— 只建不收，账本为 0 而域仍在表内，两者都能看出来
    resetReg(); disposeChildRuntimes('');
    const leaky = childRuntime('b-leaky');
    leaky.addListener(window, 'evt', () => {});
    ok('B4 反例：只建不收 → 账本 0 且域仍在表（漏回收可见）',
        childRuntimeReleaseLog('b-leaky') === 0 && childRuntimeStats('b-leaky') === 1);
    leaky.dispose();
    disposeChildRuntimes('');
    resetReg();
}

/* ============================================================
 * C. 壳层与三个实例的出口
 * ============================================================ */
{
    /* C1 LockScreen：dispose 必须收「时钟 + DOM + 两个 window 监听器」三者 */
    const { LockScreen } = await import('../phone/lock-screen.js');
    resetReg(); installFakeClock();
    const shell = { container: makeEl('host'), batteryLevel: 80, classList: { add() {}, remove() {} } };
    const ls = new LockScreen(shell);
    ls.lock();
    ok('C1a 锁屏后 window 上有 2 个鼠标监听器', registry.filter(r => r.target === 'window').length === 2,
        JSON.stringify(registry.map(r => `${r.target}:${r.type}`)));
    ok('C1b 锁屏后持有时钟定时器', timers.size === 1, String(timers.size));
    ls.dispose();
    ok('C1c dispose 解绑两个 window 监听器（只 remove() DOM 不算收干净）',
        registry.filter(r => r.target === 'window').length === 0,
        JSON.stringify(registry.map(r => `${r.target}:${r.type}`)));
    ok('C1d dispose 清掉时钟定时器', timers.size === 0, String(timers.size));
    ok('C1e dispose 幂等（重复调用不抛、不残留引用）',
        (() => { try { ls.dispose(); return ls._onWinMouseMove === null && ls._onWinMouseUp === null; } catch (_e) { return false; } })());
    restoreRealClock(); resetReg();

    /* C2 壳层域可诊断：childRuntime('phone-shell') + destroy 级联锁屏 */
    const shellSrc = read('phone/phone-shell.js');
    ok('C2a 壳层登记层经 childRuntime 建域（否则域表看不见它）',
        /childRuntime\s*\(\s*'phone-shell'\s*\)/.test(shellSrc)
        && !/new\s+ManagedRuntime\s*\(/.test(shellSrc));
    ok('C2b destroy 级联回收锁屏（lockScreen 不在壳的登记表里）',
        /this\.lockScreen\?\.dispose\?\.\(\)/.test(shellSrc)
        && /this\.lockScreen = null;/.test(shellSrc));
    {
        const { PhoneShell } = await import('../phone/phone-shell.js');
        resetReg(); installFakeClock();
        const s = new PhoneShell();
        s.createInPanel(makeEl('host'));
        s.lockScreen.lock();
        const beforeWin = registry.filter(r => r.target === 'window').length;
        const dn = s.destroy();
        ok('C2c destroy 回收壳自身登记项并返回计数', dn > 0, String(dn));
        ok('C2d destroy 之后锁屏的 window 监听器也归零（级联生效）',
            registry.filter(r => r.target === 'window').length === 0,
            `before=${beforeWin} after=${registry.filter(r => r.target === 'window').length}`);
        ok('C2e 壳域进入全局域表（可被 childRuntimeStats 数到）',
            childRuntimeStats('phone-shell') === 0, String(childRuntimeStats('phone-shell')));
        ok('C2f 壳的回收被记账（childRuntimeReleaseLog 可对账）',
            childRuntimeReleaseLog('phone-shell') >= 1, String(childRuntimeReleaseLog('phone-shell')));
        restoreRealClock(); resetReg();
    }

    /* C3 HomeScreen：4 个 window 监听器登记进实例域，destroy 精确解绑且可重复登记 */
    const { HomeScreen } = await import('../phone/home-screen.js');
    resetReg(); disposeChildRuntimes('');
    const hsShell = {
        container: makeEl('host'), screen: { querySelectorAll: () => [] },
        setContent() {}, classList: { add() {}, remove() {} },
    };
    const hs = new HomeScreen(hsShell, []);
    ok('C3a 实例域名为 home-screen', hs._rt && hs._rt.name === 'home-screen');
    hs.bindEvents();
    ok('C3b bindEvents 在 window 上登记 4 个监听器',
        registry.filter(r => r.target === 'window').length === 4,
        JSON.stringify(registry.map(r => `${r.target}:${r.type}`)));
    const types = registry.filter(r => r.target === 'window').map(r => r.type).sort().join(',');
    ok('C3c 四类事件齐备（壁纸/图标/卡片布局/时间）',
        ['phone:timeUpdated', 'phone:updateAppIcon', 'phone:updateCardLayoutCss', 'phone:updateWallpaper']
            .every(t => types.includes(t.split(':')[1])), types);
    ok('C3d 同实例重复 bindEvents 不重复登记（guard 仍在）',
        (() => { hs.bindEvents(); return registry.filter(r => r.target === 'window').length === 4; })());
    const dn2 = hs.destroy();
    ok('C3e destroy 解绑全部 4 个监听器并返回计数', dn2 === 4 && live() === 0, `n=${dn2} live=${live()}`);
    ok('C3f destroy 复位 guard，使重建后能重新登记',
        (() => { hs.bindEvents(); return registry.filter(r => r.target === 'window').length === 4; })());
    hs.destroy();
    ok('C3g destroy 幂等（第二次返回 0）', hs.destroy() === 0);
    resetReg();

    /* C4 ControlCenter：护栏必须落在能造出界面的入口（show/toggle），而不只 close */
    const { ControlCenter } = await import('../phone/control-center.js');
    const ccShell = { container: makeEl('host'), classList: { add() {}, remove() {} } };
    const storage = { get: () => null, set: () => {} };
    const cc = new ControlCenter(ccShell, storage);
    cc.show();
    ok('C4a show 之后处于打开态', cc.open === true);
    cc.dispose();
    ok('C4b dispose 摘掉 overlay 且标记不可用', cc._root === null && cc._disposed === true);
    cc.show();
    ok('C4c 陈旧实例 show 被挡（否则会挂出无人认领的第二块面板）', cc.open === false);
    cc.toggle();
    ok('C4d 陈旧实例 toggle 也被挡', cc.open === false);
    ok('C4e 护栏覆盖 show/toggle/close 三个入口（只守 close 等于没守）',
        /if \(this\._disposed\) return;\s*if \(this\.open\)/.test(read('phone/control-center.js'))
        && (read('phone/control-center.js').match(/this\._disposed/g) || []).length >= 4);
    resetReg();

    /* C5 NotificationLog：dispose 与 reset 是两个语义（先落盘再丢定时器） */
    const { NotificationLog } = await import('../config/system-notifications.js');
    const writes = [];
    const store = { get: () => null, set: (k, v) => { writes.push({ k, v }); } };
    const nl = new NotificationLog(store, { limit: 200 });
    nl.push({ title: 'T', message: 'M', appId: 'wechat' });
    ok('C5a push 后处于待落盘（脏）状态', nl._dirty === true && nl._flushTimer !== null);
    const flushed = nl.dispose();
    ok('C5b dispose 先把脏缓存落盘（不静默吞掉已入账的通知）',
        flushed === true && writes.length === 1 && writes[0].k === 'sys_notifs',
        `flushed=${flushed} writes=${writes.length}`);
    ok('C5c dispose 再丢定时器', nl._flushTimer === null);
    ok('C5d dispose 幂等：无脏数据时返回 false 且不写盘',
        (() => { const n2 = writes.length; const r = nl.dispose(); return r === false && writes.length === n2; })());
    const src5 = read('config/system-notifications.js');
    ok('C5e dispose 的落盘先于丢定时器（顺序即不变量）',
        /dispose\(\) \{[\s\S]{0,120}?this\.flushNow\(\)[\s\S]{0,160}?clearTimeout\(this\._flushTimer\)/.test(src5));
    ok('C5f reset 与 dispose 并列存在（两语义不合并成一个）',
        /reset\(\) \{/.test(src5) && /dispose\(\) \{/.test(src5));
    ok('C5g reset 仍刻意不落盘（会话切换语义未被本版改写）',
        /本次不落盘|旧缓存写出去即串味/.test(src5));
    resetReg();
}

/* ============================================================
 * D. 宿主侧：三条清数据路径与界面槽位重建
 * ============================================================ */
{
    const idx = read('index.js');
    /* D1 三个统一出口存在且命名分开（v2.30「出口不该藏在名字里」的延续） */
    for (const fn of ['releasePhoneSurface', 'destroyPhoneSurface', 'reloadPhoneSurface',
        'clearPhoneSurfaceAliases']) {
        ok(`D1 出口函数存在: ${fn}`, new RegExp(`function ${fn}\\(`).test(idx));
    }
    /* D2 收口位置与构造位置同址：createPhoneInPanel 里先收旧界面，再收旧壳 */
    const cIdx = idx.indexOf('    async function createPhoneInPanel() {');
    const cEnd = idx.indexOf('\n    }', idx.indexOf('homeScreen.render();', cIdx));
    const body = idx.slice(cIdx, cEnd > cIdx ? cEnd : cIdx + 4000);
    const iSurface = body.indexOf('destroyPhoneSurface();');
    const iShell = body.indexOf('phoneShell?.destroy?.();');
    ok('D2a createPhoneInPanel 先收旧界面实例', iSurface > 0);
    ok('D2b 收界面在收旧壳之前（此刻 phoneShell 仍指旧壳）',
        iSurface > 0 && iShell > 0 && iSurface < iShell, `surface=${iSurface} shell=${iShell}`);
    ok('D2c 收尾调用都被 try/catch 保护（回收失败不阻断重建）',
        /try \{ destroyPhoneSurface\(\); \}/.test(body));
    ok('D2d 壳层重建仍只有一处 new PhoneShell()（单一重建入口）',
        (idx.match(/phoneShell = new PhoneShell\(\);/g) || []).length === 1);

    /* D3 三条清数据路径共用同一出口（此前各写各的） */
    const nReload = (idx.match(/try \{ reloadPhoneSurface\(\); \}/g) || []).length;
    ok('D3a 三条清数据路径 + 其它界面重建点都走 reloadPhoneSurface（>= 3 处）',
        nReload >= 3, String(nReload));
    ok('D3b 所有 reloadPhoneSurface 调用点都在 try/catch 内（清数据不因重建失败而中断）',
        (idx.match(/try \{ reloadPhoneSurface\(\); \} catch \(_e\) \{ \/\* 忽略 \*\/ \}/g) || []).length
        === (idx.match(/[^a-zA-Z]reloadPhoneSurface\(\);/g) || []).length,
        `guarded=${(idx.match(/try \{ reloadPhoneSurface\(\); \}/g) || []).length} all=${(idx.match(/[^a-zA-Z]reloadPhoneSurface\(\);/g) || []).length}`);

    ok('D3c reload 内含重建：收 + 建 + 渲染三件套',
        /function reloadPhoneSurface\(\)[\s\S]{0,900}?new HomeScreen\(phoneShell, currentApps\)[\s\S]{0,400}?homeScreen\.render\(\)/.test(idx));
    ok('D3d reload 对「壳不存在」有兜底（手机从未打开时只收不建，不抛）',
        /function reloadPhoneSurface\(\)[\s\S]{0,260}?if \(!phoneShell \|\| !phoneShell\.container\) return n;/.test(idx));

    /* D4 别名复位：三个宿主级公开引用在销毁点被清掉（不留给重建前窗口） */
    ok('D4a clearPhoneSurfaceAliases 清三个别名',
        /VirtualPhone\.home = null/.test(idx) && /VirtualPhone\.controlCenter = null/.test(idx)
        && /VirtualPhone\.notificationLog = null/.test(idx));
    ok('D4b 它被 destroyPhoneSurface 调用（而非只在重建里）',
        /function destroyPhoneSurface\(\)[\s\S]{0,900}?clearPhoneSurfaceAliases\(\);/.test(idx));

    /* D5 诊断面：runtimeStats 暴露回收账本，降级分支同步 */
    ok('D5a runtimeStats 暴露 released（回收账本）',
        /snap\.released = childRuntimeReleaseLog\(''\)/.test(idx));
    ok('D5b 降级分支含 released 字段', /released:\s*\{\s*\}/.test(idx));
    ok('D5c 账本从内核导入（不是本地造对象）',
        /import\s*\{[^}]*\bchildRuntimeReleaseLog\b[^}]*\}\s*from\s*'[^']*runtime-lifecycle/.test(idx));
    ok('D5d 注释说明账本与 domainCounts 的分工', /漏回收[\s\S]{0,40}已回收/.test(idx));
}

/* ============================================================
 * E. 发布卫生
 * ============================================================ */
{
    const idx = read('index.js');
    const manifest = JSON.parse(read('manifest.json'));
    const pkg = JSON.parse(read('package.json'));
    const log = JSON.parse(read('update-log.json'));
    const v = /const ST_PHONE_VERSION = '([\d.]+)'/.exec(idx)?.[1];
    ok('E1 index.js 版本 >= 2.31.0', vnum(v) >= vnum('2.31.0'), v);
    ok('E2 manifest 同版', manifest.version === v, `${manifest.version} vs ${v}`);
    ok('E3 package.json 同版', pkg.version === v, `${pkg.version} vs ${v}`);
    ok('E4 update-log 有本版条目', !!log.versions?.[v], Object.keys(log.versions || {}).slice(0, 3).join(','));
    ok('E5 update-log.latest 指向当前版本', log.latest === v, `${log.latest} vs ${v}`);
    ok('E6 versions 头部即当前版本', Object.keys(log.versions || {})[0] === v,
        Object.keys(log.versions || {})[0]);
    const items = ((log.versions?.[v] || {}).items) || [];
    ok('E7 本版条目覆盖主线（重建路径与实例回收）',
        /重建路径|实例被丢弃|回收账本/.test(items.join('\n')), String(items.length));

    /* E8 内置公告与日志逐字同源。
       动机：仓库私有时远端更新检查恒 404，内置公告是用户唯一能看到的更新说明；
       v2.30 实测过「版本号对了、内容是旧的」比没有更误导。
       判据不写死关键词：逐条比对 items 文本，随版本自动生效，不需要交棒。 */
    const blk = (idx.match(/const ST_PHONE_CURRENT_UPDATE = \{[\s\S]*?\n\};/) || [''])[0];
    ok('E8a 内置公告存在且 version 引用常量（不硬编码版本号）',
        blk.length > 0 && /version:\s*ST_PHONE_VERSION/.test(blk));
    const inner = blk.slice(blk.indexOf('items: [') + 'items: ['.length, blk.lastIndexOf(']'));
    let ann = null;
    try { ann = JSON.parse('[' + inner.replace(/,\s*$/, '') + ']'); } catch (_e) { ann = null; }
    ok('E8b 内置公告可被解析为字符串数组',
        Array.isArray(ann) && ann.every(s => typeof s === 'string'), ann === null ? 'parse failed' : typeof ann);
    ok('E8c 内置公告与本版日志**逐字同源**（不是关键词抽查）',
        Array.isArray(ann) && JSON.stringify(ann) === JSON.stringify(items),
        `ann=${ann ? ann.length : 'null'} log=${items.length}`);
    ok('E8d 公告条目数 >= 4', Array.isArray(ann) && ann.length >= 4, String(ann ? ann.length : 0));

    /* E9 交棒基线：历史条目仍钉住（判据要钉不变的历史事实，不钉可变的当前状态） */
    ok('E9a 2.30.0 历史条目仍在（过度回收主线）',
        /过度回收|域出口|处置/.test(((log.versions?.['2.30.0'] || {}).items || []).join('\n')));
    ok('E9b 2.29.0 历史条目仍在（域自持出口主线）',
        (((log.versions?.['2.29.0'] || {}).items || []).join('\n')).includes('域自持出口'));

    /* E10 不把版本号硬编码进测试文件本身（本文件的 2.31.0 只出现在判据下界与文案里） */
    ok('E10 测试文件未硬编码「当前版本」以外的实现常量',
        !/ST_PHONE_VERSION = '2\.31\.0'/.test(read('tests/system-v231.test.mjs')));
}

console.log(`\n[v2.31.0] 通过 ${pass} / 失败 ${fail}`);
process.exitCode = fail ? 1 : 0;
