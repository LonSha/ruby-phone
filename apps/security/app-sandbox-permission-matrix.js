/* ============================================================
 * app-sandbox-permission-matrix.js — [v4.139.0 · 第十八期全新内核底座]
 * 应用沙盒权限多维动态赋权与越权拦截器 (App Sandbox Permission Matrix)
 * ------------------------------------------------------------
 * 【核心机制与安全隐私体系】
 * 解决流氓 App 随心所欲窃取隐私定位的痛点：
 *   - 权限动态申请: CAMERA, MICROPHONE, LOCATION, CONTACTS, STORAGE；
 *   - 伪数据投毒保护 (Mocked Poisoning): 当用户拒绝授予定位权限时，系统向应用返回模糊偏移坐标（如偏移5公里外的湖心），保护现实隐私。
 * ============================================================ */

export class AppSandboxPermissionMatrix {
    constructor(options = {}) {
        this.options = Object.assign({
            enforceStrictSandbox: true
        }, options);
        // appId -> Map(permissionName -> 'granted' | 'denied' | 'ask_once')
        this.permissionStore = new Map();
        this.accessAuditLogs = [];
    }

    setPermission(appId, permission, status = "granted") {
        if (!this.permissionStore.has(appId)) {
            this.permissionStore.set(appId, new Map());
        }
        this.permissionStore.get(appId).set(permission.toUpperCase(), status);
    }

    /**
     * 校验权限并在越权时进行动态防御
     */
    checkAndEnforce(appId, permission, rawSensitiveData = null) {
        const perm = permission.toUpperCase();
        const appPerms = this.permissionStore.get(appId);
        const status = appPerms ? appPerms.get(perm) : "denied";

        const log = {
            appId,
            permission: perm,
            status,
            timestamp: Date.now()
        };
        this.accessAuditLogs.push(log);

        if (status === "granted") {
            return { allowed: true, data: rawSensitiveData };
        }

        // 越权拦截并提供伪装保护数据
        let poisonedData = null;
        if (perm === "LOCATION") {
            poisonedData = { lat: 39.9042 + 0.05, lng: 116.4074 - 0.06, isMocked: true, note: "隐私模糊坐标" };
        } else if (perm === "CONTACTS") {
            poisonedData = [{ name: "未知联系人", phone: "13800000000" }];
        }

        return {
            allowed: false,
            reason: "PERMISSION_DENIED",
            poisonedData
        };
    }

    exportState() {
        const store = [];
        for (const [appId, pmap] of this.permissionStore.entries()) {
            store.push([appId, Array.from(pmap.entries())]);
        }
        return { store, accessAuditLogs: [...this.accessAuditLogs] };
    }

    hydrateState(state) {
        if (!state) return;
        if (Array.isArray(state.store)) {
            this.permissionStore.clear();
            for (const [appId, perms] of state.store) {
                this.permissionStore.set(appId, new Map(perms));
            }
        }
        if (Array.isArray(state.accessAuditLogs)) {
            this.accessAuditLogs = [...state.accessAuditLogs];
        }
    }
}

export default AppSandboxPermissionMatrix;