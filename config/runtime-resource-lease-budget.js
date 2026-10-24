/* ============================================================
 * config/runtime-resource-lease-budget.js — [R9-O8 · 第九期规划]
 * 手机运行时多 App 资源租约与生命周期预算管理器（纯函数内核）
 * ------------------------------------------------------------
 * 【核心设计】
 *   针对 89 个 App 切换产生的实例膨胀与性能损耗：
 *     - 为活跃 App 授予有限生命周期的资源租约 (Resource Lease)
 *     - 超出最大并发活跃实例上限 (如 5 个) 时，自动释放最久未使用的非核心实例
 *     - 保留关键持久化数据，仅清理 DOM 渲染树与临时订阅
 * ============================================================ */
let leaseCounter = 0;

export function allocateAppLease(activeLeases, appId, options = {}) {
    const list = Array.isArray(activeLeases) ? activeLeases.slice() : [];
    const maxActive = Number(options.maxActive) || 5;
    const now = Date.now();
    leaseCounter++;
    const existingIdx = list.findIndex(l => l.appId === appId);
    if (existingIdx >= 0) {
        list[existingIdx] = {
            ...list[existingIdx],
            lastActiveAt: now,
            seq: leaseCounter,
            renewCount: (list[existingIdx].renewCount || 0) + 1
        };
    } else {
        list.push({
            appId: String(appId).trim(),
            allocatedAt: now,
            lastActiveAt: now,
            seq: leaseCounter,
            renewCount: 0,
            pinned: Boolean(options.pinned)
        });
    }
    // 排序：置顶保留，其余按 seq 降序（最新访问在前）
    list.sort((a, b) => {
        if (a.pinned && !b.pinned) return -1;
        if (!a.pinned && b.pinned) return 1;
        return (b.seq || 0) - (a.seq || 0);
    });
    const kept = list.slice(0, maxActive);
    const evicted = list.slice(maxActive).map(l => l.appId);
    return {
        activeCount: kept.length,
        evictedCount: evicted.length,
        kept,
        evicted
    };
}