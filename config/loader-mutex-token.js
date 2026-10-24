/**
 * config/loader-mutex-token.js - 深度单实例互斥令牌守卫 (Loader Mutex Token Guard)
 * 
 * 机制借鉴与超越：
 * 吸收瑟瑟小手机 V1.303 的 `__ubp_loader_owner` 单实例令牌模式与 `pagehide` 释放机制。
 * 针对 SillyTavern 快速切换聊天卡、iframe 重载或热重载时容易发生的“双重装载/幽灵实例”问题，
 * 提供严格的令牌抢占、持有者识别、心跳延续与优雅交接。
 * 杜绝多个手机容器并存引起的事件重复触发、DOM 污染与内存泄漏。
 */

const DEFAULT_OWNER_KEY = '__rubyphone_loader_owner';

export class LoaderMutexTokenGuard {
    constructor(config = {}) {
        this.ownerKey = config.ownerKey || DEFAULT_OWNER_KEY;
        this.holderId = config.holderId || `holder_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    }

    /**
     * 尝试获取装载权令牌
     * @param {Object} scopeWindow - 目标全局作用域 (如 window 或 parent)
     * @returns {Object} { acquired: boolean, holderId: string, reason?: string }
     */
    acquire(scopeWindow = globalThis) {
        if (!scopeWindow) {
            return { acquired: false, holderId: this.holderId, reason: 'invalid_scope_window' };
        }

        const currentOwner = scopeWindow[this.ownerKey];
        if (currentOwner && currentOwner !== this.holderId) {
            return {
                acquired: false,
                holderId: this.holderId,
                currentOwner,
                reason: 'mutex_held_by_another_instance'
            };
        }

        scopeWindow[this.ownerKey] = this.holderId;
        return {
            acquired: true,
            holderId: this.holderId
        };
    }

    /**
     * 释放装载权令牌
     * @param {Object} scopeWindow 
     * @returns {boolean} 是否成功释放
     */
    release(scopeWindow = globalThis) {
        if (!scopeWindow) return false;
        if (scopeWindow[this.ownerKey] === this.holderId) {
            delete scopeWindow[this.ownerKey];
            return true;
        }
        return false;
    }

    /**
     * 检查当前实例是否仍持有令牌
     * @param {Object} scopeWindow 
     * @returns {boolean}
     */
    isHolding(scopeWindow = globalThis) {
        if (!scopeWindow) return false;
        return scopeWindow[this.ownerKey] === this.holderId;
    }

    /**
     * 注册生命周期自动解绑挂钩（如 pagehide / beforeunload）
     * @param {Object} scopeWindow 
     * @param {Function} onReleasedCallback 
     */
    bindAutoRelease(scopeWindow = globalThis, onReleasedCallback) {
        if (!scopeWindow || typeof scopeWindow.addEventListener !== 'function') return;

        const cleanup = () => {
            if (this.release(scopeWindow)) {
                if (typeof onReleasedCallback === 'function') {
                    onReleasedCallback();
                }
            }
        };

        scopeWindow.addEventListener('pagehide', cleanup, { once: true });
        scopeWindow.addEventListener('beforeunload', cleanup, { once: true });
    }
}