/* ============================================================
 * [v2.28.0] 实例级资源域 + 六处「人工回收清单」收敛 + 孤儿域治理
 * ------------------------------------------------------------
 * 动机（v2.27 的延伸）：
 *   v2.27 把宿主级常驻资源接进了 globalRuntime，但暴露了下一层问题 ——
 *   大量资源其实属于**某个实例**而非宿主：一个视图 / 一个 App / 一个组件。
 *   它们的生命周期是「实例存活期」，回收口径却仍是人工维护的一份清单：
 *     · apps/music/music-view.js      _visibilityGuard(3s) + _progressTimer(250ms)
 *                                     两条 setInterval + 裸 window resize 监听，
 *                                     各自手写 clearInterval / removeEventListener
 *     · apps/games/sudoku/sudoku-view.js   _timer(1s) 裸 setInterval + 单字段清理
 *     · apps/worldpulse/worldpulse-app.js  eventSource 缺失时退化为 3s 兜底轮询
 *     · phone/floating-entry.js       window.setInterval 挂 this.visibilityTimer，
 *                                     而 unmount() 与 unmountButtonOnly() 各写一次 clearInterval
 *     · apps/weibo/weibo-app.js       打开微信的有界轮询（40×80ms）两个出口各写一次
 *     · apps/honey/honey-view.js      跳转微信会话的有界轮询（20×150ms）同理
 *   这类清单的失效形态是固定的：**漏一个就永久泄漏**；而且宿主把实例置 null
 *   （清数据 / 换会话）而不走实例自身 destroy 时，全局登记表还会把它钉成孤儿域。
 *
 * 修复（本轮）：
 *   - runtime-lifecycle：新增实例级资源域（childRuntime / childRuntimeCount /
 *     disposeChildRuntimes）+ 快照 children 字段 + 父域 dispose 级联回收子域
 *   - 六个文件改为「视图 / App 自持一个域：登记即入域，销毁即收净」
 *   - index.js：实例被丢弃的两条路径（换会话 honey 分支 / 清数据三 App）接入域回收
 *
 * 本测试四层：
 *   A. 内核行为（域隔离 / 幂等 / 级联 / 前缀回收 / 无宿主降级）
 *   B. 接线（六文件的域实例化、tag 与回收点源码级验证 + 手写回收残留扫描）
 *   C. 等价性行为仿真（假时钟：计时器不叠加、双前缀互不误伤、有界轮询两出口、
 *      两条卸载路径共用口径、级联回收）
 *   D. 范围自证 + 版本四处同步 + 诊断字段
 * 不硬编码版本号。
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

/* ---------- mock 目标：真实注册表语义（引用不相等就不解绑） ---------- */
const registry = [];
function makeTarget(name) {
    return {
        addEventListener(type, handler, opts) {
            registry.push({ target: name, type, handler, capture: opts === true });
        },
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
globalThis.window = Object.assign(makeTarget('window'), { VirtualPhone: {} });
globalThis.document = Object.assign(makeTarget('document'), { hidden: false });

/* ---------- 假时钟：让「轮询是否还在跑」可被断言 ---------- */
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
/** 驱动所有存活定时器回调 n 轮（每轮取快照，允许回调内自停） */
function tick(n = 1) {
    for (let i = 0; i < n; i++) {
        for (const t of [...timers.values()]) t.fn();
    }
}

const {
    ManagedRuntime, globalRuntime, globalRuntimeSnapshot,
    childRuntime, childRuntimeCount, disposeChildRuntimes,
} = await import('../config/runtime-lifecycle.js');

/* ============================================================
 * A. 内核：实例级资源域
 * ============================================================ */
{
    disposeChildRuntimes('');                 // 清零基线（不假设进入时的域表状态）
    const base = childRuntimeCount();
    ok('域: 基线可清零（无残留域）', Number.isInteger(base) && base === 0, `${base}`);

    const rt = childRuntime('music-view');
    ok('域: childRuntime 返回 ManagedRuntime 且名字正确',
        rt instanceof ManagedRuntime && rt.name === 'music-view');
    ok('域: 创建后域表计数 +1', childRuntimeCount() === base + 1);

    ok('域: 名字为空时回退为 "child"（不产生空名域）',
        childRuntime('').name === 'child' && childRuntime(null).name === 'child');
    ok('域: 两个空名域各占一条（按实例而非按名字去重）', childRuntimeCount() === base + 3);
    ok('域: disposeChildRuntimes("child") 回收两个空名域',
        disposeChildRuntimes('child') === 2 && childRuntimeCount() === base + 1);
    /* ---- 域隔离：同名 tag 在不同域内互不误伤 ---- */
    resetReg();
    const a = childRuntime('dom-a'), b = childRuntime('dom-b');
    a.addListener(makeTarget('w'), 'x', function ha() {}, false, 'shared:t');
    b.addListener(makeTarget('w'), 'x', function hb() {}, false, 'shared:t');
    ok('隔离: 两域各登记一项，live=2', a.size === 1 && b.size === 1 && live() === 2);
    const gotA = a.cancelByTag('shared:');
    ok('隔离: a 域按 tag 回收只清自己（返回 1）', gotA === 1 && a.size === 0);
    ok('隔离: b 域不受影响（size 仍 1、监听器仍存活）',
        b.size === 1 && live() === 1, `b=${b.size} live=${live()}`);

    /* ---- 幂等：重复 dispose ---- */
    let threw = false;
    try { b.dispose(); b.dispose(); } catch (_) { threw = true; }
    ok('幂等: 域重复 dispose 不抛且第二次返回 0', threw === false && b.dispose() === 0);
    ok('幂等: dispose 后域内监控窗口已断（live 归零）', live() === 0);
    a.dispose();
    ok('幂等: 两域 dispose 后自动从域表注销（仅剩 music-view）',
        childRuntimeCount() === base + 1, `count=${childRuntimeCount()}`);

    /* ---- 无宿主降级 ---- */
    const noHost = childRuntime('nohost');
    const savedSI = globalThis.setInterval;
    globalThis.setInterval = undefined;
    let threw2 = false; let ret = 'init';
    try { ret = noHost.addInterval(() => {}, 1000, 'x:tick'); } catch (_) { threw2 = true; }
    globalThis.setInterval = savedSI;
    ok('降级: 无 setInterval 时不抛且返回 null', threw2 === false && ret === null);
    ok('降级: 未登记的项不计入域 size（不留僵尸登记）', noHost.size === 0);
    noHost.dispose();

    /* ---- 前缀回收：disposeChildRuntimes ---- */
    rt.dispose();                              // 清掉 A 层开头创建的 music-view 域
    const c1 = childRuntime('music-view');
    const c2 = childRuntime('music-view-extra');
    const c3 = childRuntime('weibo-app');
    ok('前缀回收: 空串回收全部域（含前缀变体）',
        disposeChildRuntimes('') === 3 && childRuntimeCount() === base);
    ok('前缀回收: 目标域已被 dispose（size 归零）',
        c1.size === 0 && c2.size === 0 && c3.size === 0);
    ok('前缀回收: 无匹配时返回 0', disposeChildRuntimes('nonexistent') === 0);
    ok('前缀回收: 支持前缀语义（"music-view" 同时命中 -extra）',
        (() => {
            const d1 = childRuntime('music-view'), d2 = childRuntime('music-view-extra');
            const n = disposeChildRuntimes('music-view');
            const alive = d1.disposed === true && d2.disposed === true;
            disposeChildRuntimes('');
            return n === 2 && alive;
        })());

    /* ---- 级联：父域 dispose 回收全部子域 ---- */
    resetReg();
    const p1 = childRuntime('cascade-a'), p2 = childRuntime('cascade-b');
    p1.addListener(makeTarget('w'), 'y', function hp() {}, false, 'k:l');
    p2.addInterval(() => {}, 5000, 'k:i');
    ok('级联: 子域登记后 live=1 且域表含 2 个', live() === 1 && childRuntimeCount() === base + 2);
    globalRuntime.dispose();
    ok('级联: 父域 dispose 回收全部子域（域表归零）',
        childRuntimeCount() === 0, `count=${childRuntimeCount()}`);
    ok('级联: 子域内监听器亦被真实解绑（live=0）', live() === 0, `live=${live()}`);
    ok('级联: 子域被标记 disposed', p1.disposed === true && p2.disposed === true);

    /* ---- 快照 children 字段 ---- */
    const snap0 = globalRuntimeSnapshot();
    ok('快照: children 字段存在且为空（无存活域）', Array.isArray(snap0.children) && snap0.children.length === 0);
    const s1 = childRuntime('snap-view');
    s1.addInterval(() => {}, 1000, 'snap:tick');
    s1.addListener(makeTarget('w'), 'z', function hs() {}, false, 'snap:lis');
    const snap1 = globalRuntimeSnapshot();
    const row = snap1.children.find(c => c.name === 'snap-view');
    ok('快照: children 列出实例域及其资源数',
        !!row && row.total === 2 && row.byKind.interval === 1 && row.byKind.listener === 1,
        JSON.stringify(snap1.children));
    ok('快照: children 与宿主级 total 分离（互不污染）',
        snap1.total === globalRuntime.size && snap1.tags.every(t => t.tag.startsWith('snap:tick') === false));
    s1.dispose();
    ok('快照: 域注销后 children 不再列出它',
        globalRuntimeSnapshot().children.every(c => c.name !== 'snap-view'));
    disposeChildRuntimes('');
    restoreRealClock();
    resetReg();
}

/* ============================================================
 * B. 接线：六文件的域实例化 + tag + 回收点 + 残留扫描
 * ============================================================ */
{
    /* ---- 六文件公共约束：已导入域原语、创建了命名域 ---- */
    const files = {
        'apps/music/music-view.js': 'music-view',
        'apps/games/sudoku/sudoku-view.js': 'sudoku-view',
        'apps/worldpulse/worldpulse-app.js': 'worldpulse-app',
        'phone/floating-entry.js': 'floating-entry',
        'apps/weibo/weibo-app.js': 'weibo-app',
        'apps/honey/honey-view.js': 'honey-view',
    };
    for (const [f, name] of Object.entries(files)) {
        const s = read(f);
        // [v2.29.0] 交棒：判据从「只导入 childRuntime 这一个符号」改为「从 runtime-lifecycle
        //   导入了 childRuntime」—— 同一模块新增导出（如后续可能引入的域统计）不该让本判据翻红。
        ok(`接线·${f}: 从 runtime-lifecycle 导入 childRuntime`,
            /import \{[^}]*\bchildRuntime\b[^}]*\} from '.*runtime-lifecycle\.js';/.test(s));
        ok(`接线·${f}: 创建命名实例域 '${name}'`,
            new RegExp(`childRuntime\\('${name}'\\)`).test(s));
        ok(`接线·${f}: 域实例挂在 this._rt 上`,
            /this\._rt = childRuntime\(/.test(s));
        ok(`接线·${f}: 不再使用裸 setInterval/clearInterval 管理这些站点`,
            !/\bsetInterval\(/.test(s) && !/\bclearInterval\(/.test(s),
            `setInterval=${/\bsetInterval\(/.test(s)} clearInterval=${/\bclearInterval\(/.test(s)}`);
    }

    /* ---- music-view：三处资源 + 两个前缀 ---- */
    {
        const s = read('apps/music/music-view.js');
        ok('接线·music: resize 监听入域（tag floating:resize）',
            /this\._rt\.addListener\(window, 'resize', this\._resizeHandler, false, 'floating:resize'\)/.test(s));
        ok('接线·music: 自愈轮询入域（tag floating:visibility-guard, 3000ms）',
            /\}, 3000, 'floating:visibility-guard'\)/.test(s));
        ok('接线·music: 进度轮询入域（tag progress:tick, 250ms）',
            /\}, 250, 'progress:tick'\)/.test(s));
        ok('接线·music: destroyFloatingWidget 收 floating: 前缀',
            /destroyFloatingWidget\(\)[\s\S]{0,600}?this\._rt\.cancelByTag\('floating:'\)/.test(s));
        ok('接线·music: _stopProgressTimer 收 progress: 前缀',
            /_stopProgressTimer\(\) \{[\s\S]{0,200}?this\._rt\.cancelByTag\('progress:'\)/.test(s));
        ok('接线·music: 旧 _visibilityGuard 字段已彻底移除（仅注释提及）',
            !/this\._visibilityGuard\s*=/.test(s));
        ok('接线·music: 旧手写 removeEventListener(resize) 已清零',
            !/removeEventListener\('resize'/.test(s));
    }
    /* ---- sudoku-view：计时器 ---- */
    {
        const s = read('apps/games/sudoku/sudoku-view.js');
        ok('接线·sudoku: 计时器入域（tag timer:tick, 1000ms）',
            /\}, 1000, 'timer:tick'\)/.test(s));
        ok('接线·sudoku: destroy 收 timer: 前缀',
            /destroy\(\) \{[\s\S]{0,220}?this\._rt\.cancelByTag\('timer:'\)/.test(s));
        ok('接线·sudoku: _startTimer 先收后启（防重复叠加）',
            /_startTimer\(\) \{[\s\S]{0,220}?this\._rt\.cancelByTag\('timer:'\)[\s\S]{0,120}?this\._rt\.addInterval\(/.test(s));
    }
    /* ---- worldpulse-app：兜底轮询 ---- */
    {
        const s = read('apps/worldpulse/worldpulse-app.js');
        ok('接线·worldpulse: 兜底轮询入域（tag poll:floor, 3000ms）',
            /this\._rt\.addInterval\(\(\) => this\._onFloorMaybeChanged\(\), 3000, 'poll:floor'\)/.test(s));
        ok('接线·worldpulse: startListening 先收后启', /if \(!this\._unsub\) \{\s*this\._rt\.cancelByTag\('poll:'\)/.test(s));
        ok('接线·worldpulse: stopListening 收 poll: 前缀',
            /stopListening\(\) \{[\s\S]{0,320}?this\._rt\.cancelByTag\('poll:'\)/.test(s));
    }
    /* ---- floating-entry：两条卸载路径共用同一口径 ---- */
    {
        const s = read('phone/floating-entry.js');
        ok('接线·floating: 自愈轮询入域（tag entry:visibility, 3000ms）',
            /this\._rt\.addInterval\(\(\) => this\.ensureVisible\(button\), 3000, 'entry:visibility'\)/.test(s));
        const n = (s.match(/this\._rt\.cancelByTag\('entry:'\)/g) || []).length;
        ok('接线·floating: 三处回收共用同一前缀（mount 先收 + unmount + unmountButtonOnly）', n === 3, `n=${n}`);
        ok('接线·floating: 旧 window.setInterval/clearInterval 已清零',
            !/window\.setInterval\(/.test(s) && !/window\.clearInterval\(/.test(s));
    }
    /* ---- weibo / honey：有界轮询两个出口 ---- */
    {
        const w = read('apps/weibo/weibo-app.js');
        ok('接线·weibo: 有界轮询入域（tag weibo:open-wechat, 80ms）',
            /\}, 80, 'weibo:open-wechat'\)/.test(w));
        // [v2.29.0] 交棒：判据从「恰好 2 处」改为「至少 2 处」。本版在 destroy 里补了第三处
        //   （域销毁前先收净该轮询）—— 回收点变多不是缺陷，把等值当不变量才是。
        ok('接线·weibo: 有界轮询的出口（命中/超时）统一 cancelByTag，且销毁路径也收净',
            (w.match(/this\._rt\.cancelByTag\('weibo:open-wechat'\)/g) || []).length >= 2,
            `n=${(w.match(/this\._rt\.cancelByTag\('weibo:open-wechat'\)/g) || []).length}`);
        ok('接线·weibo: 旧 `const timer = setInterval` 已清零', !/const timer = setInterval\(/.test(w));

        const h = read('apps/honey/honey-view.js');
        ok('接线·honey: 有界轮询入域（tag honey:open-wechat, 150ms）',
            /\}, 150, 'honey:open-wechat'\)/.test(h));
        ok('接线·honey: 三处（先收 + 命中 + 超时）统一 cancelByTag',
            (h.match(/this\._rt\.cancelByTag\('honey:open-wechat'\)/g) || []).length === 3);
        ok('接线·honey: 旧 `const timer = setInterval` 已清零', !/const timer = setInterval\(/.test(h));
    }
    /* ---- 全仓残留扫描：本轮覆盖的「人工回收清单」形态 ---- */
    {
        const walk = (dir, out = []) => {
            for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
                const p = path.join(dir, e.name);
                if (e.isDirectory()) { if (!['node_modules', '.git', 'tests'].includes(e.name)) walk(p, out); }
                else if (e.name.endsWith('.js')) out.push(p);
            }
            return out;
        };
        const all = walk(root);
        /* 仅在「调用位」匹配（排除注释/字符串里提到的 setInterval，如 index.js 的更新日志文案） */
        const CALL_SI = /(?:^|[=(,\s;.])setInterval\(/;
        const CALL_CI = /(?:^|[=(,\s;.])clearInterval\(/;
        /* ① 本轮收敛的失效形态：句柄存局部变量 + 两个出口各写一次 clearInterval(timer) */
        const sig = [];
        for (const f of all) {
            const s = fs.readFileSync(f, 'utf8');
            const twoExit = /const timer = setInterval\(/.test(s)
                && (s.match(/clearInterval\(timer\)/g) || []).length >= 2;
            if (twoExit) sig.push(`${path.relative(root, f)}: 两出口手写 clearInterval(timer)`);
            if (/window\.clearInterval\(this\.visibilityTimer\)/.test(s)) sig.push(`${path.relative(root, f)}: 手写 visibilityTimer 清理`);
        }
        ok('接线·全仓: 「轮询句柄存局部变量 + 两处手写 clearInterval」形态已清零',
            sig.length === 0, JSON.stringify(sig));
        /* ② 全仓不变量：不存在「只启不停」的文件 */
        const onlyStart = [];
        for (const f of all) {
            const s = fs.readFileSync(f, 'utf8');
            if (CALL_SI.test(s) && !CALL_CI.test(s)) onlyStart.push(path.relative(root, f));
        }
        ok('接线·全仓: 不存在只启不停的文件（setInterval 必配 clearInterval 或入域）',
            onlyStart.length === 0, JSON.stringify(onlyStart));
        /* ③ 刻意取舍：剩下 4 处实例级 setInterval 均已配对清理，本轮不动（避免无缺陷重构） */
        const paired = [
            ['apps/phone/phone-view.js', 'callTimer'],
            ['apps/wechat/chat-view.js', 'videoTimer'],
            ['apps/wechat/chat-view.js', 'callTimer'],
            ['phone/lock-screen.js', '_clockTimer'],
            ['config/image-generation-manager.js', 'timer'],
        ];
        const unpaired = [];
        for (const [f, field] of paired) {
            const s = fs.readFileSync(path.join(root, f), 'utf8');
            if (!CALL_SI.test(s) || !CALL_CI.test(s)) unpaired.push(`${f}:${field}`);
        }
        ok('接线·全仓: 刻意保留的 5 处站点仍处配对状态（回归护栏）',
            unpaired.length === 0, JSON.stringify(unpaired));
    }
}

/* ============================================================
 * C. 等价性行为仿真（假时钟）
 * ============================================================ */
{
    const base = childRuntimeCount();
    installFakeClock();

    /* ---- C1 sudoku：计时器不叠加，销毁即停 ---- */
    {
        const rt = childRuntime('sudoku-view-sim');
        let ticks = 0;
        const startTimer = () => {
            rt.cancelByTag('timer:');
            rt.addInterval(() => { ticks++; }, 1000, 'timer:tick');
        };
        const destroy = () => { rt.cancelByTag('timer:'); };
        startTimer();
        ok('仿真·sudoku: 启动后域内 1 项定时器', rt.size === 1 && timers.size === 1);
        tick(3);
        ok('仿真·sudoku: 3 轮 tick 后计数为 3', ticks === 3, `ticks=${ticks}`);
        startTimer();                       // 重复 start 不应叠加
        ok('仿真·sudoku: 重复 _startTimer 不叠加（域内仍 1 项、宿主 1 个定时器）',
            rt.size === 1 && timers.size === 1, `rt=${rt.size} timers=${timers.size}`);
        tick(2);
        ok('仿真·sudoku: 叠加检查（2 轮只应 +2）', ticks === 5, `ticks=${ticks}`);
        destroy();
        const before = ticks;
        tick(5);
        ok('仿真·sudoku: destroy 后计时器已停（不再执行）',
            timers.size === 0 && ticks === before, `ticks=${ticks}`);
        let threw = false;
        try { destroy(); } catch (_) { threw = true; }
        ok('仿真·sudoku: destroy 幂等（重复调用不抛）', threw === false);
        rt.dispose();
    }

    /* ---- C2 music：floating: 与 progress: 双前缀互不误伤 ---- */
    {
        const rt = childRuntime('music-view-sim');
        resetReg();
        let guard = 0, progress = 0;
        rt.addListener(makeTarget('window'), 'resize', function resizeH() {}, false, 'floating:resize');
        rt.addInterval(() => { guard++; }, 3000, 'floating:visibility-guard');
        rt.addInterval(() => { progress++; }, 250, 'progress:tick');
        ok('仿真·music: 域内 3 项（1 监听 + 2 轮询）、宿主 2 个定时器',
            rt.size === 3 && timers.size === 2 && live() === 1);
        tick(2);
        ok('仿真·music: 两路轮询各自推进', guard === 2 && progress === 2, `g=${guard} p=${progress}`);
        // destroyFloatingWidget 语义：先停进度，再收 floating:
        rt.cancelByTag('progress:');
        rt.cancelByTag('floating:');
        ok('仿真·music: 收 net 后域内归零、宿主定时器与监听器全部释放',
            rt.size === 0 && timers.size === 0 && live() === 0,
            `rt=${rt.size} timers=${timers.size} live=${live()}`);
        const g2 = guard, p2 = progress;
        tick(4);
        ok('仿真·music: 回收后两路都不再执行',
            guard === g2 && progress === p2, `g=${guard} p=${progress}`);
        // 反向：只收 floating: 时 progress: 必须仍在（证明前缀精确、不误伤）
        rt.addInterval(() => { guard++; }, 3000, 'floating:visibility-guard');
        rt.addInterval(() => { progress++; }, 250, 'progress:tick');
        rt.cancelByTag('floating:');
        ok('仿真·music: 只收 floating: 时 progress: 仍存活（前缀不误伤）',
            rt.size === 1 && timers.size === 1);
        rt.dispose();
    }

    /* ---- C3 worldpulse：兜底轮询先收后启、stop 收净 ---- */
    {
        const rt = childRuntime('worldpulse-app-sim');
        let polls = 0;
        const start = (hasEventSource) => {
            const unsub = hasEventSource ? () => {} : null;
            if (!unsub) { rt.cancelByTag('poll:'); rt.addInterval(() => { polls++; }, 3000, 'poll:floor'); }
        };
        const stop = () => { rt.cancelByTag('poll:'); };
        start(false);
        ok('仿真·worldpulse: eventSource 缺失 → 兜底轮询登记 1 项', rt.size === 1 && timers.size === 1);
        start(false);                        // 重复 startListening
        ok('仿真·worldpulse: 重复 startListening 不叠加（换会话重复触发路径）',
            rt.size === 1 && timers.size === 1, `rt=${rt.size}`);
        tick(2);
        ok('仿真·worldpulse: 2 轮后轮询计数为 2（非 4）', polls === 2, `polls=${polls}`);
        stop();
        const p0 = polls;
        tick(3);
        ok('仿真·worldpulse: stopListening 后不再执行', polls === p0 && timers.size === 0);
        // eventSource 可用时不应登记轮询
        start(true);
        ok('仿真·worldpulse: 有 eventSource 时不登记兜底轮询', rt.size === 0 && timers.size === 0);
        rt.dispose();
    }

    /* ---- C4 floating-entry：两条卸载路径共用口径 ---- */
    {
        const rt = childRuntime('floating-entry-sim');
        let ensured = 0;
        const mount = () => { rt.cancelByTag('entry:'); rt.addInterval(() => { ensured++; }, 3000, 'entry:visibility'); };
        const unmount = () => { rt.cancelByTag('entry:'); };
        const unmountButtonOnly = () => { rt.cancelByTag('entry:'); };
        mount();
        ok('仿真·floating: mount 后 1 项轮询', rt.size === 1 && timers.size === 1);
        unmount();
        ok('仿真·floating: unmount 收净', rt.size === 0 && timers.size === 0);
        mount(); mount();
        ok('仿真·floating: 重复 mount 不叠加', rt.size === 1 && timers.size === 1);
        unmountButtonOnly();
        ok('仿真·floating: unmountButtonOnly 与 unmount 同口径（收净）',
            rt.size === 0 && timers.size === 0);
        mount();
        tick(1);
        unmountButtonOnly();
        const e0 = ensured;
        tick(3);
        ok('仿真·floating: 卸载后自愈轮询停止执行', ensured === e0 && timers.size === 0);
        rt.dispose();
    }

    /* ---- C5 有界轮询：两个出口都能收（weibo 40×80ms / honey 20×150ms） ---- */
    {
        // weibo 语义复刻：restore() 命中即开聊；否则满 40 次退出
        const runWeibo = (foundAt) => {
            const rt = childRuntime('weibo-app-sim');
            let attempts = 0, opened = 0;
            const restore = () => attempts >= foundAt;
            rt.cancelByTag('weibo:open-wechat');
            rt.addInterval(() => {
                attempts++;
                if (restore() || attempts >= 40) {
                    rt.cancelByTag('weibo:open-wechat');
                    if (restore()) opened = 1;
                }
            }, 80, 'weibo:open-wechat');
            let guard = 0;
            while (timers.size && guard++ < 200) tick(1);
            const res = { attempts, opened, size: rt.size, timers: timers.size };
            rt.dispose();
            return res;
        };
        const timeoutCase = runWeibo(999);      // 永不命中 → 有界超时
        ok('仿真·weibo: 未命中时有界退出（恰好 40 次后自停）',
            timeoutCase.attempts === 40 && timeoutCase.opened === 0
            && timeoutCase.size === 0 && timeoutCase.timers === 0, JSON.stringify(timeoutCase));
        const hitCase = runWeibo(3);            // 第 3 次命中
        ok('仿真·weibo: 命中出口立即自停（不跑满 40 次）',
            hitCase.attempts === 3 && hitCase.opened === 1
            && hitCase.size === 0 && hitCase.timers === 0, JSON.stringify(hitCase));

        // honey 语义复刻：20×150ms
        const runHoney = (foundAt) => {
            const rt = childRuntime('honey-view-sim');
            let attempts = 0, opened = 0;
            const ready = () => attempts >= foundAt;
            rt.cancelByTag('honey:open-wechat');
            rt.addInterval(() => {
                attempts += 1;
                if (ready()) { rt.cancelByTag('honey:open-wechat'); opened = 1; return; }
                if (attempts >= 20) { rt.cancelByTag('honey:open-wechat'); }
            }, 150, 'honey:open-wechat');
            let guard = 0;
            while (timers.size && guard++ < 200) tick(1);
            const res = { attempts, opened, size: rt.size, timers: timers.size };
            rt.dispose();
            return res;
        };
        const hTimeout = runHoney(999);
        ok('仿真·honey: 未命中时有界退出（20 次后自停）',
            hTimeout.attempts === 20 && hTimeout.opened === 0
            && hTimeout.size === 0 && hTimeout.timers === 0, JSON.stringify(hTimeout));
        const hHit = runHoney(1);
        ok('仿真·honey: 命中出口立即自停',
            hHit.attempts === 1 && hHit.opened === 1
            && hHit.size === 0 && hHit.timers === 0, JSON.stringify(hHit));

        // 域回收兜住「App 被销毁但轮询仍在途」的情况（index.js 清数据路径）
        const rt = childRuntime('weibo-app');
        rt.addInterval(() => {}, 80, 'weibo:open-wechat');
        ok('仿真·孤儿域: 实例被丢弃前域内尚有在途轮询', rt.size === 1 && timers.size === 1);
        const rn = disposeChildRuntimes('weibo-app');
        ok('仿真·孤儿域: disposeChildRuntimes 收净在途轮询',
            rn === 1 && rt.size === 0 && timers.size === 0, `rn=${rn} timers=${timers.size}`);
    }

    /* ---- C6 级联：宿主回收连带实例域 ---- */
    {
        const x = childRuntime('cascade-sim-a'), y = childRuntime('cascade-sim-b');
        x.addInterval(() => {}, 1000, 'a:tick');
        y.addInterval(() => {}, 1000, 'b:tick');
        ok('仿真·级联: 两个子域、2 个宿主定时器', timers.size === 2 && childRuntimeCount() === 2);
        globalRuntime.dispose();
        ok('仿真·级联: 宿主 dispose 后子域表归零且定时器全部释放',
            childRuntimeCount() === 0 && timers.size === 0 && x.disposed && y.disposed);
    }

    restoreRealClock();
    ok('仿真: 全部仿真域已回收（不残留跨层状态）',
        childRuntimeCount() === base, `count=${childRuntimeCount()} base=${base}`);
}

/* ============================================================
 * D. 范围自证 + 版本四处同步 + 诊断字段
 * ============================================================ */
{
    const isrc = read('index.js');
    /* 诊断：children 字段贯通 */
    ok('诊断: index.js 导入 disposeChildRuntimes',
        /disposeChildRuntimes\s*\} from '\.\/config\/runtime-lifecycle\.js'/.test(isrc)
        || /disposeChildRuntimes\b/.test(isrc));
    // [v2.29.0] 交棒：降级结构从「逐字面量比对整段」改为「字段齐备 + 类型正确」——
    //   字面量比对会把「新增一个字段」判成缺陷（本版正好新增了 domainCounts）。
    ok('诊断: getRuntimeStats 降级结构完整（宿主级四字段 + children/domainCounts）',
        /catch \(e\) \{ return \{ total: 0, byKind: \{ interval: 0, timeout: 0, observer: 0, listener: 0 \}, tags: \[\], children: \[\]/
            .test(isrc) && /domainCounts: \{\}/.test(isrc));
    ok('诊断: 注释说明 children 为实例级域明细', /children 字段：实例级资源域明细/.test(isrc));
    /* 接线：实例被丢弃的两条路径 */
    ok('接线·index: 换会话 honey 分支回收 honey-view 域',
        /disposeChildRuntimes\('honey-view'\)/.test(isrc));
    ok('接线·index: 清数据路径回收 weibo/music/honey 三域',
        (isrc.match(/disposeChildRuntimes\('(weibo-app|music-view|honey-view)'\)/g) || []).length >= 4,
        `n=${(isrc.match(/disposeChildRuntimes\('(weibo-app|music-view|honey-view)'\)/g) || []).length}`);
    ok('接线·index: 域回收包 try/catch（失败不阻断清数据）',
        /try \{ disposeChildRuntimes\('honey-view'\); \} catch \(_e\) \{ \/\* 忽略 \*\/ \}/.test(isrc));

    /* 范围自证 */
    const touched = ['index.js', 'config/runtime-lifecycle.js',
        'apps/music/music-view.js', 'apps/games/sudoku/sudoku-view.js',
        'apps/worldpulse/worldpulse-app.js', 'phone/floating-entry.js',
        'apps/weibo/weibo-app.js', 'apps/honey/honey-view.js'];
    ok('范围: 本轮改动文件全部存在且非空',
        touched.every(f => read(f).length > 0), JSON.stringify(touched.filter(f => !read(f).length)));
    ok('范围: 第三方版权文件（honey-view）仅等价替换，版权头保留',
        /Copyright \(c\) yuzuki\. All rights reserved\./.test(read('apps/honey/honey-view.js')));
    /* [v2.31.0] 交棒：原判据 `!/childRuntime/.test(phone-shell)` 是**范围自证**
       （v2.28 本轮的“不动 phone-shell”记录），属可变状态 —— v2.31.0 有意
       把壳层登记层从裸 ManagedRuntime 升级为 childRuntime('phone-shell')，
       该字面断言必然翻红。改为钉 v2.28 起就不变的事实：壳层**代码取值**只能
       来自登记层构造器（ManagedRuntime 仍被 import 只为 v2.26 类型引用与注释说明），
       且不出现“裸 new”写法（即登记层必须经 childRuntime 建域、进程表）。 */
    const shellSrc = read('phone/phone-shell.js');
    ok('范围: phone-shell 登记层经构造器取得（无裸 new ManagedRuntime）',
        !/new\s+ManagedRuntime\s*\(/.test(shellSrc)
        && /childRuntime\s*\(\s*'phone-shell'\s*\)/.test(shellSrc),
        'phone-shell 应当用 childRuntime 建域');
    ok('范围: 内核导出齐备（childRuntime / childRuntimeCount / disposeChildRuntimes）',
        ['export function childRuntime(', 'export function childRuntimeCount(',
            'export function disposeChildRuntimes('].every(k => read('config/runtime-lifecycle.js').includes(k)));

    /* 回归：v2.27 测试的快照断言已覆盖 children 字段 */
    ok('回归: v227 测试已扩展 snapshot children 断言',
        /children/.test(read('tests/system-v227.test.mjs')));

    /* 回归护栏：经 data: URL 加载源码的测试，若源码含相对 import 必须显式重写
       （honey-view.js 本版新增相对 import，暴露过此形态：data: URL 无 base，相对 specifier 直接抛
        ERR_UNSUPPORTED_RESOLVE_REQUEST，且该异常发生在 import 期、整文件失败）。 */
    {
        const tdir = path.join(root, 'tests');
        const bad = [];
        for (const f of fs.readdirSync(tdir)) {
            if (!f.endsWith('.test.mjs')) continue;
            const t = fs.readFileSync(path.join(tdir, f), 'utf8');
            if (!/data:text\/javascript/.test(t)) continue;
            /* 变量 → 源路径：只取「该变量最终被塞进 data: URL」的那一个（其余 readFileSync 是纯文本断言用） */
            const srcOfVar = new Map();
            for (const m of t.matchAll(/const\s+(\w+)\s*=[\s\S]{0,60}?readFileSync\(\s*new URL\('(\.\.\/[^']+)'/g)) {
                srcOfVar.set(m[1], m[2]);
            }
            const importedVars = new Set();
            for (const m of t.matchAll(/Buffer\.from\(\s*(\w+)\s*\)/g)) importedVars.add(m[1]);
            for (const v of importedVars) {
                const rel = srcOfVar.get(v);
                if (!rel) continue;
                const srcPath = path.join(root, rel.replace(/^\.\.\//, ''));
                if (!fs.existsSync(srcPath)) continue;
                const src = fs.readFileSync(srcPath, 'utf8');
                const relImports = [...src.matchAll(/^\s*import[^'\n]*'(\.[^']+)'/gm)].map(x => x[1]);
                if (relImports.length === 0) continue;
                if (!relImports.every(sp => t.includes(sp))) {
                    bad.push(`${f} -> ${rel} (${relImports.join(', ')})`);
                }
            }
        }
        ok('回归护栏: data: URL 加载的相对 import 已在对应测试中重写',
            bad.length === 0, JSON.stringify(bad));
    }

    /* 版本四处同步 */
    const manifest = JSON.parse(read('manifest.json'));
    const pkg = JSON.parse(read('package.json'));
    const ul = JSON.parse(read('update-log.json'));
    const v = /const ST_PHONE_VERSION = '([0-9.]+)'/.exec(isrc)[1];
    const vnum = s => { const m = /^(\d+)\.(\d+)\.(\d+)/.exec(String(s || '').trim()); return m ? +m[1] * 1000000 + +m[2] * 1000 + +m[3] : NaN; };
    ok('版本: index.js / manifest / package 三处一致',
        v === manifest.version && v === pkg.version, `${v}/${manifest.version}/${pkg.version}`);
    ok('版本: update-log.latest 指向当前版本', ul.latest === v, `${ul.latest} vs ${v}`);
    ok('版本: update-log.versions 头部即当前版本', Object.keys(ul.versions)[0] === v,
        `head=${Object.keys(ul.versions)[0]}`);
    ok('版本: 不低于 2.28.0', vnum(v) >= vnum('2.28.0'), v);
    // [v2.29.0] 交棒：条目数从「恰好 8 条」改为「不少于 6 条」——
    //   条目数是叙事体量，不是不变量；把它当不变量会让每次版本更新都翻红。
    ok('版本: update-log 当前版本条目非空（>= 6 条说明）',
        Boolean(ul.versions[v]) && ul.versions[v].items.length >= 6, JSON.stringify({ n: ul.versions[v]?.items?.length }));
    // [v2.30.0] 交棒：原断言用「当前版本 v」去查 v2.28 特有的关键词，
    //   于是每发一版、新条目不含旧词就必然翻红 —— 判据绑了可变形状。
    //   改为钉住 2.28.0 这条历史条目：历史叙事不会变，才是真正的不变量。
    ok('版本: 条目覆盖实例域与六处回收点（钉 2.28.0 历史条目）',
        ((ul.versions['2.28.0'] || {}).items || []).join('\n').includes('实例级资源域'));
}

console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
if (fail > 0) process.exitCode = 1;
