/* ============================================================
 * pixel-viewstack-b-sentinel.js — [v4.138.0 · V21-R1]
 * 全局掌机视图栈与单键 B 路由生命周期死锁哨兵 (Pixel ViewStack B Sentinel)
 * ------------------------------------------------------------
 * 根治应用库同类返回键死锁与视图残留 Bug：
 * 1. 严格统一视图出入栈状态机 (Unified View Stack State Machine)
 * 2. 避免深度判 1 产生的抖动死锁 (Anti-Deadlock Jitter Guard)
 * 3. 注册组件生命周期 onExit 自动回收 (Self-Healing Teardown Registry)
 * ============================================================ */
export const VIEW_LAYER = Object.freeze({
    DESKTOP: "desktop",
    CLUSTER: "cluster",
    APP: "app",
    MODAL: "modal"
});

export function createPixelViewStackSentinel(phoneShell) {
    const stack = [{ layer: VIEW_LAYER.DESKTOP, id: "home", teardown: null, meta: {} }];

    function pushView(layer, id, teardown = null, meta = {}) {
        const entry = {
            layer: Object.values(VIEW_LAYER).includes(layer) ? layer : VIEW_LAYER.APP,
            id: String(id || "unknown_view"),
            teardown: typeof teardown === "function" ? teardown : null,
            meta: meta || {},
            pushedAt: Date.now()
        };
        stack.push(entry);
        return entry;
    }

    function popView() {
        if (stack.length <= 1) {
            // 已在最外层桌面，安全返回防抖信号
            return { handled: false, layer: VIEW_LAYER.DESKTOP, depth: 1 };
        }
        const top = stack.pop();
        if (top && typeof top.teardown === "function") {
            try {
                top.teardown();
            } catch (err) {
                console.warn("[ViewStackSentinel] teardown error:", err);
            }
        }
        return { handled: true, popped: top, currentDepth: stack.length };
    }

    function peekView() {
        return stack[stack.length - 1];
    }

    function resetToDesktop() {
        while (stack.length > 1) {
            popView();
        }
        return true;
    }

    return {
        pushView,
        popView,
        peekView,
        resetToDesktop,
        getDepth: () => stack.length
    };
}
