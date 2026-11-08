/* ============================================================
 * pixel-cartridge-multitask-swapper.js — [v4.138.0 · V21-R3]
 * 桌面多任务卡带切换流与后台 App 原位悬浮恢复 (Cartridge Multitask Swapper)
 * ------------------------------------------------------------
 * 1. 掌机游戏卡带风格多任务快照管理 (Cartridge Snapshot Vault)
 * 2. App 瞬时 DOM 滚动进度与输入草稿挂起 (Suspended State Preservation)
 * 3. 毫秒级原位悬浮复原与内存限额回收 (Instant Suspension Resume)
 * ============================================================ */
export function createCartridgeSwapper() {
    const suspendedTasks = new Map(); // appId -> { snapshotHtml, scrollPos, formDrafts, updatedAt }
    const MAX_SUSPENDED = 8;

    function suspendApp(appId, state = {}) {
        const id = String(appId || "").trim();
        if (!id) return false;
        if (suspendedTasks.size >= MAX_SUSPENDED) {
            // LRU 淘汰最早的
            const oldestKey = suspendedTasks.keys().next().value;
            suspendedTasks.delete(oldestKey);
        }
        suspendedTasks.set(id, {
            appId: id,
            scrollPos: Number(state.scrollPos || 0),
            formDrafts: state.formDrafts || {},
            updatedAt: Date.now()
        });
        return true;
    }

    function resumeApp(appId) {
        const id = String(appId || "").trim();
        if (!suspendedTasks.has(id)) return null;
        const task = suspendedTasks.get(id);
        suspendedTasks.delete(id); // 唤起即恢复前台
        return task;
    }

    function getActiveTaskList() {
        return Array.from(suspendedTasks.values());
    }

    return {
        suspendApp,
        resumeApp,
        getActiveTaskList,
        getTaskCount: () => suspendedTasks.size
    };
}
