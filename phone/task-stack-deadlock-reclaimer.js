/* ============================================================
 * task-stack-deadlock-reclaimer.js — 掌机多任务栈无死锁调度与内存惰性回收器
 * [v4.140.0 · 掌机视窗任务栈管理、前后台生命周期与防挂死守卫]
 * ============================================================ */

export class TaskStackDeadlockReclaimer {
    constructor(options = {}) {
        this.options = Object.assign({
            maxTaskDepth: 6,
            inactivityTimeoutMs: 120000
        }, options);
        
        this.taskStack = []; // [ { appId, instanceState, foregroundTime, backgroundTime } ]
        this.reclaimedLog = [];
    }

    launchApp(appId, initialParams = {}) {
        if (!appId) return null;
        // 将已存在同类型 App 提到栈顶
        const existingIdx = this.taskStack.findIndex(t => t.appId === appId);
        let taskRecord = null;

        if (existingIdx >= 0) {
            taskRecord = this.taskStack.splice(existingIdx, 1)[0];
            taskRecord.foregroundTime = Date.now();
            taskRecord.instanceState = Object.assign(taskRecord.instanceState || {}, initialParams);
        } else {
            taskRecord = {
                appId,
                instanceState: initialParams,
                launchedAt: Date.now(),
                foregroundTime: Date.now()
            };
        }

        this.taskStack.push(taskRecord);

        // 检查栈深度并回收陈旧任务
        let reclaimedTask = null;
        if (this.taskStack.length > this.options.maxTaskDepth) {
            reclaimedTask = this.taskStack.shift();
            this.reclaimedLog.push({
                appId: reclaimedTask.appId,
                reclaimedAt: Date.now(),
                durationAliveMs: Date.now() - reclaimedTask.launchedAt
            });
            if (this.reclaimedLog.length > 30) this.reclaimedLog.shift();
        }

        return {
            activeAppId: appId,
            currentStackDepth: this.taskStack.length,
            reclaimedAppId: reclaimedTask?.appId || null
        };
    }

    pressBack() {
        if (this.taskStack.length <= 1) {
            return { handled: false, activeAppId: this.taskStack[0]?.appId || "home" };
        }
        const popped = this.taskStack.pop();
        const currentTop = this.taskStack[this.taskStack.length - 1];
        return {
            handled: true,
            poppedAppId: popped.appId,
            activeAppId: currentTop.appId
        };
    }

    getStackSummary() {
        return {
            activeApp: this.taskStack[this.taskStack.length - 1] || null,
            stack: this.taskStack.map(t => t.appId),
            reclaimedHistory: this.reclaimedLog
        };
    }
}
if (typeof globalThis !== "undefined") { globalThis.TaskStackDeadlockReclaimer = TaskStackDeadlockReclaimer; }
if (typeof window !== "undefined") { window.TaskStackDeadlockReclaimer = TaskStackDeadlockReclaimer; }
if (typeof module !== "undefined" && module.exports) { module.exports = TaskStackDeadlockReclaimer; }
export default TaskStackDeadlockReclaimer;