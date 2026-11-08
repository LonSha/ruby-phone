/* ============================================================
 * phone/lifecycle-engines-mount.js — [v18 · 未接引擎真实接入层]
 * ------------------------------------------------------------
 * 【为什么存在】
 *   仓里有 14 个 phone/ 引擎自投产起**全仓无人 import**：
 *     accessibility-screen-reader-bridge / ambient-biorhythm-lockscreen /
 *     app-lifecycle-suspend-tombstone / dynamic-island-lockscreen-glance /
 *     i18n-dynamic-locale-engine / ipc-event-bus-backpressure-controller /
 *     multitask-viewstack-resumption-engine / pixel-cartridge-multitask-swapper /
 *     screen-adaptive-layout-engine / screen-privacy-cloak-engine /
 *     sqlite-wasm-zero-copy-indexeddb / task-stack-deadlock-reclaimer /
 *     ui-render-virtual-list-scroller / ui-virtual-list-scroller-60fps /
 *     virtual-slice-scrolling-fps-booster
 *   它们各自都能跑、也有测试，但**没有任何宿主调用点** ——
 *   属于「文件存在、能力为零」的死代码，且同一能力常有多份实现
 *   （虚拟滚动 4 份、多任务 4 份），越积越容易误以为已在用。
 *
 * 【接入纪律】（本文件唯一原则）
 *   1. 只接**真实存在**的宿主时机，不为「看起来已接线」造定时器或假数据；
 *   2. 每个实例都挂在什么时机、产出什么，必须能从读数面看见
 *      （window.VirtualPhone._lifecycleRead），否则等于没接；
 *   3. 应用优先级：**分派给不同真实入口**，不把 4 份虚拟滚动都塞给同一个列表
 *      （那是自欺）。分派见下表：
 *        - ui-render-virtual-list-scroller       → 长通知/日志类列表（分片视口）
 *        - ui-virtual-list-scroller-60fps        → 聊天消息列表（60fps 复用）
 *        - virtual-slice-scrolling-fps-booster   → 极端万条场景兜底切片
 *        - pixel-cartridge-multitask-swapper     → 掌机像素桌面的卡带多任务
 *        - task-stack-deadlock-reclaimer         → 宿主返回键任务栈
 *        - multitask-viewstack-resumption-engine → 草稿/视口原位恢复
 *        - app-lifecycle-suspend-tombstone       → App 挂起墓碑与水合
 *   4. 任何一个引擎抛错都**只记读数、不中断宿主流程**（try 全包）。
 * ============================================================ */

import { AccessibilityScreenReaderBridge } from './accessibility-screen-reader-bridge.js';
import { AmbientBiorhythmLockscreen } from './ambient-biorhythm-lockscreen.js';
import { AppLifecycleSuspendTombstone } from './app-lifecycle-suspend-tombstone.js';
import { DynamicIslandLockscreenGlance } from './dynamic-island-lockscreen-glance.js';
import { I18nDynamicLocaleEngine } from './i18n-dynamic-locale-engine.js';
import { IPCEventBusBackpressureController } from './ipc-event-bus-backpressure-controller.js';
import { MultitaskViewstackResumptionEngine } from './multitask-viewstack-resumption-engine.js';
import { createCartridgeSwapper } from './pixel-cartridge-multitask-swapper.js';
import { ScreenAdaptiveLayoutEngine } from './screen-adaptive-layout-engine.js';
import { ScreenPrivacyCloakEngine } from './screen-privacy-cloak-engine.js';
import { SQLiteWASMZeroCopyIndexedDB } from './sqlite-wasm-zero-copy-indexeddb.js';
import { TaskStackDeadlockReclaimer } from './task-stack-deadlock-reclaimer.js';
import { UIRenderVirtualListScroller } from './ui-render-virtual-list-scroller.js';
import { UIVirtualListScroller60FPS } from './ui-virtual-list-scroller-60fps.js';
import { VirtualSliceScrollingFPSBooster } from './virtual-slice-scrolling-fps-booster.js';

/** 逐个引擎的接线存活读数。缺哪个一目了然。 */
function emptyRead() {
    return {
        at: 0,
        wired: {},
        missing: [],
        calls: {
            suspend: 0, resume: 0, launch: 0, back: 0, switchApp: 0,
            viewport: 0, privacy: 0, a11y: 0, ipcPublished: 0, ipcDropped: 0,
            shardWrite: 0, shardFlush: 0, biorhythm: 0, island: 0, locale: 0,
            listSlice: 0, cartridge: 0
        },
        lastError: null
    };
}

/**
 * 装配全部生命周期引擎并返回句柄。
 * @param {object} deps 宿主依赖：{ shell, virtualPhone, storage, notifyBadge }
 */
export function mountLifecycleEngines(deps = {}) {
    const read = emptyRead();
    const fail = (where, e) => {
        read.lastError = where + ': ' + String((e && e.message) || e);
    };
    const handle = {
        read,
        engine: {},
        /* 便于测试与诊断：本次装配真正 new 成功的引擎名 */
        getRead() { return JSON.parse(JSON.stringify(read)); }
    };

    const makers = {
        accessibility: () => new AccessibilityScreenReaderBridge({ screenReaderActive: true }),
        biorhythm: () => new AmbientBiorhythmLockscreen(),
        tombstone: () => new AppLifecycleSuspendTombstone({ maxTombstones: 12 }),
        dynamicIsland: () => new DynamicIslandLockscreenGlance(),
        i18n: () => new I18nDynamicLocaleEngine(),
        ipc: () => new IPCEventBusBackpressureController({ maxTokens: 60, refillRatePerSec: 30 }),
        multitask: () => new MultitaskViewstackResumptionEngine(),
        cartridge: () => createCartridgeSwapper(),
        adaptive: () => new ScreenAdaptiveLayoutEngine(),
        privacyCloak: () => new ScreenPrivacyCloakEngine(),
        virtualStore: () => new SQLiteWASMZeroCopyIndexedDB({ dbName: 'RubyPhoneVirtualStore' }),
        taskStack: () => new TaskStackDeadlockReclaimer({ maxTaskDepth: 8 }),
        listScroller: () => new UIRenderVirtualListScroller({ itemHeight: 64, overscan: 4 }),
        chatScroller60: () => new UIVirtualListScroller60FPS({ itemHeight: 72 }),
        sliceBooster: () => new VirtualSliceScrollingFPSBooster({ viewportHeight: 640, itemHeight: 72 })
    };

    for (const [key, make] of Object.entries(makers)) {
        try {
            handle.engine[key] = make();
            read.wired[key] = true;
        } catch (e) {
            read.wired[key] = false;
            read.missing.push(key);
            fail('mount:' + key, e);
        }
    }
    /* [契约] 调用面（persistShards / sliceFor* / updateBiorhythm / applyLocale）挂在 handle 上，
     *   不挂在 bindLifecycleEngines 上 —— 前者是「这些引擎能被怎样使用」的稳定接口，
     *   后者只负责「接到宿主事件」。之前的写法把调用面绑在 bind 里，
     *   导致「没绑事件就完全用不了」，也让契约测试与真宿主走成两条路。
     *   这里先给出**只依赖引擎自身**的实现；bind 时若需要宿主上下文再覆盖。 */
    handle.persistShards = (map) => {
        try {
            if (map && typeof map === 'object') {
                for (const [k, v] of Object.entries(map)) {
                    handle.engine.virtualStore?.writeChunk?.(k, v);
                    read.calls.shardWrite += 1;
                }
            }
            const f = handle.engine.virtualStore?.flushDirtyShards?.();
            if (f && f.flushedCount) read.calls.shardFlush += f.flushedCount;
            read.lastShardFlush = f || null;
            return f;
        } catch (e) { fail('virtualStore.flush', e); return null; }
    };
    handle.updateBiorhythm = (input) => {
        try {
            if (!input) return null;
            const st = handle.engine.biorhythm?.updateBiorhythm?.(input);
            read.calls.biorhythm += 1;
            read.lastBiorhythm = st || null;
            return st;
        } catch (e) { fail('biorhythm.update', e); return null; }
    };
    handle.applyLocale = (locale, offsetHours) => {
        try {
            if (locale) { handle.engine.i18n?.setLocale?.(locale); read.calls.locale += 1; }
            if (typeof offsetHours === 'number') { handle.engine.i18n?.setTimezoneOffset?.(offsetHours); read.calls.locale += 1; }
            read.lastLocale = { locale, offsetHours, time: handle.engine.i18n?.getSystemTimeDisplay?.() || null };
            return read.lastLocale;
        } catch (e) { fail('i18n.apply', e); return null; }
    };
    handle.sliceForList = (items, scrollTop) => {
        try {
            handle.engine.listScroller?.setItems?.(items || []);
            const s = handle.engine.listScroller?.calculateVisibleSlice?.(scrollTop || 0);
            read.calls.listSlice += 1;
            return s || null;
        } catch (e) { fail('listScroller.slice', e); return null; }
    };
    handle.sliceForChat60fps = (items, scrollTop) => {
        try {
            handle.engine.chatScroller60?.setDataset?.(items || [], 640);
            handle.engine.chatScroller60?.scrollTo?.(scrollTop || 0);
            const s = handle.engine.chatScroller60?.computeVirtualSlice?.();
            read.calls.listSlice += 1;
            return s || null;
        } catch (e) { fail('chatScroller60.slice', e); return null; }
    };
    handle.sliceForHuge = (total, scrollTop) => {
        try {
            const s = handle.engine.sliceBooster?.computeSlice?.(scrollTop || 0, total || 0);
            read.calls.listSlice += 1;
            return s || null;
        } catch (e) { fail('sliceBooster.slice', e); return null; }
    };
    read.at = Date.now();
    return handle;
}

/**
 * 把装配好的引擎接到宿主的真实生命周期上。
 * 每一个绑定都对应宿主里**已存在**的事件或函数，不新增轮询。
 * @param {object} handle mountLifecycleEngines 的返回
 * @param {object} host   { shell, virtualPhone }
 */
export function bindLifecycleEngines(handle, host = {}) {
    if (!handle || !handle.engine) return handle;
    const { engine, read } = handle;
    /* [契约对齐] fail 原本只定义在 mountLifecycleEngines 里，而 bind 在另一个函数作用域
     *   —— 任一引擎抛错时这里会二次抛出 ReferenceError: fail is not defined，
     *   等于「错误处理本身成了新的错误」。这里补一份同口径的 fail。 */
    const fail = (where, e) => {
        read.lastError = where + ': ' + String((e && e.message) || e);
    };
    const vp = host.virtualPhone || (typeof window !== 'undefined' ? window.VirtualPhone : null);
    const shell = host.shell || (typeof window !== 'undefined' ? window.VirtualPhone?.phoneShell : null);
    const on = (target, type, fn) => {
        try { target?.addEventListener?.(type, fn); } catch (_e) { /* 无 DOM 环境：测试里允许缺席 */ }
    };
    const bump = (k, n = 1) => { if (read.calls[k] !== undefined) read.calls[k] += n; };

    /* ── ① 任务栈 / 墓碑 / 多任务原位恢复：全部挂在 phone:openApp 与 phone:goHome ──
     *    这两个是宿主唯一的开/关咽喉点（index.js 里已经在那里采集使用时长），
     *    所以在这里接入不会漏、也不会重复计数。 */
    if (typeof window !== 'undefined' && window.addEventListener) {
        on(window, 'phone:openApp', (e) => {
            const appId = e && e.detail && e.detail.appId;
            if (!appId) return;
            /* 任务栈：掌机式前后台栈 + 深度回收 */
            try {
                const r = engine.taskStack?.launchApp?.(appId);
                bump('launch');
                if (r && r.reclaimedAppId) bump('back'); // 回收等价于一次隐式出栈
            } catch (e2) { fail('taskStack.launchApp', e2); }
            /* 墓碑：先看有没有可水合的旧态（有则说明这是「回来」而不是「第一次进」） */
            try {
                const resume = engine.tombstone?.resumeApp?.(appId);
                if (resume && resume.freshLaunch === false) bump('resume');
            } catch (e2) { fail('tombstone.resumeApp', e2); }
            /* 多任务：切入目标 App，顺带把上一个 App 的草稿收好 */
            try {
                const sw = engine.multitask?.switchApp?.(appId, null);
                bump('switchApp');
                read.lastSwitch = sw ? { activeApp: sw.activeApp, stackDepth: sw.stackDepth } : null;
            } catch (e2) { fail('multitask.switchApp', e2); }
            /* IPC：把开 App 这件事按 normal 优先级广播给背压总线 */
            try {
                const pub = engine.ipc?.publish?.('app:open', { appId, at: Date.now() }, 'normal');
                if (pub && pub.delivered) bump('ipcPublished'); else bump('ipcDropped');
            } catch (e2) { fail('ipc.publish', e2); }
            /* 无障碍：每次换页把当前界面的语义节点编译成一次旁白，供读屏/低视力用户取用 */
            try {
                const view = shell?.getContentContainer?.();
                const nodes = [];
                if (view && typeof view.querySelectorAll === 'function') {
                    const els = view.querySelectorAll('[data-a11y-label], .app-title, .view-title');
                    for (let i = 0; i < els.length && i < 24; i++) {
                        const el = els[i];
                        nodes.push({
                            role: el.getAttribute?.('data-a11y-role') || '元素',
                            label: el.getAttribute?.('data-a11y-label') || (el.textContent || '').trim().slice(0, 60),
                            selected: el.classList?.contains?.('is-active') || false
                        });
                    }
                }
                if (nodes.length) {
                    const text = engine.accessibility?.compileSemanticVoiceOver?.(nodes);
                    bump('a11y');
                    read.lastVoiceOver = String(text || '').slice(0, 300);
                }
            } catch (e2) { fail('accessibility.compile', e2); }
        });

        on(window, 'phone:goHome', () => {
            /* 回桌面 = 当前 App 退到后台：入墓碑 + 出任务栈 */
            const top = engine.taskStack?.getStackSummary?.()?.activeApp;
            const topId = top && top.appId;
            try {
                if (topId) {
                    const st = engine.tombstone?.suspendApp?.(topId, { at: Date.now() }, 0);
                    if (st) bump('suspend');
                }
            } catch (e2) { fail('tombstone.suspendApp', e2); }
            try {
                const r = engine.taskStack?.pressBack?.();
                if (r && r.handled) bump('back');
            } catch (e2) { fail('taskStack.pressBack', e2); }
            try {
                const r = engine.multitask?.popApp?.();
                read.lastPop = r ? { activeApp: r.activeApp } : null;
            } catch (e2) { fail('multitask.popApp', e2); }
            try {
                engine.ipc?.publish?.('app:home', { at: Date.now() }, 'low');
            } catch (e2) { fail('ipc.publish:home', e2); }
            /* 掌机卡带：回桌面时把当前任务压成卡带快照，供像素桌面多任务面板读取 */
            try {
                if (topId) {
                    engine.cartridge?.suspendApp?.(topId, { at: Date.now() });
                    bump('cartridge');
                }
            } catch (e2) { fail('cartridge.suspendApp', e2); }
        });
    }

    /* ── ② 屏幕自适应排版：挂在真实 resize 上（宿主已有 visualViewport 监听）── */
    const onResize = () => {
        try {
            const w = (typeof window !== 'undefined' && (window.visualViewport?.width || window.innerWidth)) || 375;
            const h = (typeof window !== 'undefined' && (window.visualViewport?.height || window.innerHeight)) || 667;
            const m = engine.adaptive?.calculateAdaptiveMetrics?.(w, h);
            bump('viewport');
            read.lastViewport = m ? { tier: m.tier || m.breakpoint || null, width: w, height: h } : { width: w, height: h };
        } catch (e2) { fail('adaptive.calculate', e2); }
    };
    if (typeof window !== 'undefined' && window.addEventListener) {
        on(window, 'resize', onResize);
        try { window.visualViewport?.addEventListener?.('resize', onResize); } catch (_e) {}
    }
    try { onResize(); } catch (_e) {}

    /* ── ③ 隐私罩：真实触发者是「反扣手机 / 近距离」两个事件（宿主已有冻结记录）── */
    if (typeof window !== 'undefined' && window.addEventListener) {
        on(window, 'phone:screenFlipDown', () => {
            try { engine.privacyCloak?.handleFlipDown?.(); bump('privacy'); read.lastCloak = engine.privacyCloak?.getState?.() || null; } catch (e2) { fail('privacy.flipDown', e2); }
        });
        on(window, 'phone:privacyRisk', (e) => {
            try {
                const mode = (e && e.detail && e.detail.mode) || 'DISGUISE_CLOCK';
                engine.privacyCloak?.activateCloak?.(mode);
                bump('privacy');
                read.lastCloak = engine.privacyCloak?.getState?.() || null;
            } catch (e2) { fail('privacy.activate', e2); }
        });
    }

    /* ── ④ 锁屏相关：动态岛 + 生物节律，挂在真实锁屏开合事件上 ── */
    if (typeof window !== 'undefined' && window.addEventListener) {
        on(window, 'phone:lock', () => {
            try {
                engine.dynamicIsland?.setUnlockState?.(false);
                bump('island');
                /* [隐私罩] 锁屏且有未读 ⇒ 上伪装时钟，遮住真实通知内容。
                 *   判据只用宿主真值（未读数），不猜「旁边有没有人」。
                 *   ★ 真宿主里 lock-screen.js 的 lock() 也会做同一件事：
                 *     两边都做是幂等的（activateCloak 只是赋值 + 时间戳），
                 *     这样无论锁屏是由壳层触发还是由外部事件触发，都不会漏。 */
                const unread = Number(vp && vp.totalNotifications) || 0;
                if (unread > 0) {
                    const st = engine.privacyCloak?.activateCloak?.('DISGUISE_CLOCK');
                    bump('privacy');
                    read.lastCloak = engine.privacyCloak?.getState?.() || st || null;
                    if (vp) vp._privacyRead = read.lastCloak;
                }
            } catch (e2) { fail('island.setUnlockState', e2); }
        });
        on(window, 'phone:unlock', () => {
            try {
                engine.dynamicIsland?.setUnlockState?.(true);
                /* 解锁必须真的撤掉遮蔽：只切动态岛状态而留着隐私罩，
                 *   用户会看到「已解锁但屏幕还是伪装时钟」的矛盾界面。 */
                engine.privacyCloak?.deactivateCloak?.();
                const prompt = engine.dynamicIsland?.formatLockscreenPrompt?.();
                bump('island');
                read.lastLockscreenPrompt = prompt ? String(prompt).slice(0, 200) : null;
                read.lastCloak = engine.privacyCloak?.getState?.() || null;
                if (vp) {
                    vp._lockscreenRead = {
                        at: Date.now(),
                        prompt: read.lastLockscreenPrompt || '',
                        cloak: read.lastCloak
                    };
                }
            } catch (e2) { fail('island.format', e2); }
        });
    }

    /* ── ⑤ 通知：动态岛推一条（隐私遮罩名），并写进虚拟存储分片 ── */
    handle.onNotification = (app, content) => {
        try {
            const r = engine.dynamicIsland?.pushNotification?.(app, content);
            bump('island');
            read.lastIslandNotification = r || null;
        } catch (e2) { fail('island.pushNotification', e2); }
    };

    /* ── ⑩ 读数面：真宿主与测试都从这里取，不靠日志猜 ── */
    handle.expose = () => {
        try {
            if (vp) vp._lifecycleRead = handle.getRead();
        } catch (_e) { /* 全局不可写不阻断 */ }
        return read;
    };
    handle.expose();

    return handle;
}