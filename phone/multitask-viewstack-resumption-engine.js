/**
 * 掌机多任务悬浮窗、原位续办与视图栈防死锁回收器 (Multitask Viewstack Resumption Engine)
 * 管理 App 切换、来电强打断时的草稿原位暂存、光标位置保护与异常死锁兜底回收
 */
export class MultitaskViewstackResumptionEngine {
    constructor() {
        this.appStack = [];
        this.draftSnapshots = new Map(); // appId -> { draftText, cursorPosition, scrollOffset, savedAt }
        this.activeApp = 'home';
    }

    /**
     * 进入/切换应用，前置应用自动保存原位草稿与视口
     */
    switchApp(targetAppId, outgoingDraft = null) {
        if (this.activeApp && outgoingDraft) {
            this.draftSnapshots.set(this.activeApp, {
                ...outgoingDraft,
                savedAt: Date.now()
            });
        }

        // 视口栈防死锁：若已存在目标App则移至栈顶，避免循环堆叠
        const existingIdx = this.appStack.indexOf(targetAppId);
        if (existingIdx !== -1) {
            this.appStack.splice(existingIdx, 1);
        }
        this.appStack.push(targetAppId);
        this.activeApp = targetAppId;

        return {
            activeApp: this.activeApp,
            restoredDraft: this.draftSnapshots.get(targetAppId) || null,
            stackDepth: this.appStack.length
        };
    }

    /**
     * 系统强打断（如来电、锁屏），紧急保护当前草稿
     */
    handleInterrupt(currentDraft) {
        if (this.activeApp && currentDraft) {
            this.draftSnapshots.set(this.activeApp, {
                ...currentDraft,
                interrupted: true,
                savedAt: Date.now()
            });
        }
        return {
            success: true,
            interruptedApp: this.activeApp,
            draftProtected: true
        };
    }

    /**
     * 返回上一层应用
     */
    popApp() {
        if (this.appStack.length <= 1) {
            this.activeApp = 'home';
            this.appStack = ['home'];
            return { activeApp: 'home', restoredDraft: null };
        }
        this.appStack.pop();
        const prevApp = this.appStack[this.appStack.length - 1];
        this.activeApp = prevApp;
        return {
            activeApp: prevApp,
            restoredDraft: this.draftSnapshots.get(prevApp) || null
        };
    }

    getDraft(appId) {
        return this.draftSnapshots.get(appId) || null;
    }
}

export default MultitaskViewstackResumptionEngine;