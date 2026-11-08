/* ============================================================
 * app-sandbox-permission-interceptor.js — 跨应用隐私隔离与沙盒权限拦截矩阵
 * [v4.140.0 · 动态权限提示、隐私安全门锁与越权拦截]
 * ============================================================ */

export class AppSandboxPermissionInterceptor {
    constructor() {
        this.grantedRegistry = new Map(); // appId -> Set(permissions)
        this.permissionAuditTrail = [];
    }

    requestPermission(appId, permission = "location", userAllowed = true) {
        if (!appId || !permission) return { granted: false, reason: "参数不全" };
        
        if (!this.grantedRegistry.has(appId)) {
            this.grantedRegistry.set(appId, new Set());
        }
        const permSet = this.grantedRegistry.get(appId);

        if (permSet.has(permission)) {
            return { granted: true, alreadyGranted: true };
        }

        if (userAllowed) {
            permSet.add(permission);
            const audit = {
                appId,
                permission,
                action: "granted",
                timestamp: Date.now()
            };
            this.permissionAuditTrail.push(audit);
            return {
                granted: true,
                alreadyGranted: false,
                promptNotice: `系统弹窗：[${appId}] 请求调用 [${permission}] 权限，玩家已授权放行。`
            };
        } else {
            const audit = {
                appId,
                permission,
                action: "denied",
                timestamp: Date.now()
            };
            this.permissionAuditTrail.push(audit);
            return {
                granted: false,
                alreadyGranted: false,
                promptNotice: `系统弹窗：玩家已拒绝 [${appId}] 获取 [${permission}] 权限，敏感功能已沙盒隔离。`
            };
        }
    }

    checkAccess(appId, permission) {
        return this.grantedRegistry.get(appId)?.has(permission) || false;
    }

    revokePermission(appId, permission) {
        if (this.grantedRegistry.has(appId)) {
            this.grantedRegistry.get(appId).delete(permission);
        }
    }
}
if (typeof globalThis !== "undefined") { globalThis.AppSandboxPermissionInterceptor = AppSandboxPermissionInterceptor; }
if (typeof window !== "undefined") { window.AppSandboxPermissionInterceptor = AppSandboxPermissionInterceptor; }
if (typeof module !== "undefined" && module.exports) { module.exports = AppSandboxPermissionInterceptor; }
export default AppSandboxPermissionInterceptor;