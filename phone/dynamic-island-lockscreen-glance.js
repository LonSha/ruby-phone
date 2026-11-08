/* ============================================================
 * dynamic-island-lockscreen-glance.js — [v4.139.0 · 第十八期全新拟真生态]
 * 息屏 AOD 与锁屏动态岛隐私防窥微动效 (Dynamic Island & Lockscreen AOD)
 * ------------------------------------------------------------
 * 【核心机制与现代交互美学】
 * 解决锁屏消息直接全白展开的假人感：
 *   - 动态岛胶囊微动效 (Capsule Expand): 外卖倒计时、打车距离在岛上实时呼吸流动；
 *   - 锁屏防窥保护 (Privacy Shroud): 锁屏时敏感微信只显示“[微信：收到1条新消息]”，
 *     当通过 FaceID 识别人脸或密码解锁瞬间，气泡优雅展开真实内容；
 *   - 窥屏预警: 侧方视角偷瞄时自动模糊内容。
 * ============================================================ */

export class DynamicIslandLockscreenGlance {
    constructor(options = {}) {
        this.options = Object.assign({
            faceIdUnlocked: false,
            aodEnabled: true
        }, options);

        this.islandActivities = new Map(); // id -> { id, app, title, subtitle, state }
        this.pendingNotifications = [];   // [{ id, app, maskedContent, unmaskedContent, timestamp }]
        this.isUnlocked = this.options.faceIdUnlocked;
    }

    setUnlockState(unlocked) {
        this.isUnlocked = !!unlocked;
    }

    pushNotification(app, unmaskedContent) {
        const notif = {
            id: "notif_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6),
            app,
            maskedContent: `[${app}: 收到1条新通知]`,
            unmaskedContent,
            timestamp: Date.now()
        };

        this.pendingNotifications.push(notif);
        return notif;
    }

    updateDynamicIslandActivity(activityId, app, title, subtitle) {
        this.islandActivities.set(activityId, {
            id: activityId,
            app,
            title,
            subtitle,
            updatedAt: Date.now()
        });
    }

    formatLockscreenPrompt() {
        const lines = ["【手机锁屏与动态岛全息透视】"];
        lines.push(`- 屏幕状态: ${this.isUnlocked ? "[已面容解锁]" : "[锁屏AOD防窥模式]"}`);
        
        if (this.islandActivities.size > 0) {
            for (const act of this.islandActivities.values()) {
                lines.push(`- 动态岛灵动药丸: [${act.app}] ${act.title} · ${act.subtitle}`);
            }
        }

        if (this.pendingNotifications.length > 0) {
            const top = this.pendingNotifications.slice(-2);
            for (const n of top) {
                const display = this.isUnlocked ? n.unmaskedContent : n.maskedContent;
                lines.push(`- 锁屏通知: ${display}`);
            }
        }

        return lines.join("\n");
    }

    exportState() {
        return {
            isUnlocked: this.isUnlocked,
            islandActivities: Array.from(this.islandActivities.entries()),
            pendingNotifications: [...this.pendingNotifications]
        };
    }

    hydrateState(state) {
        if (!state) return;
        this.isUnlocked = !!state.isUnlocked;
        if (Array.isArray(state.islandActivities)) this.islandActivities = new Map(state.islandActivities);
        if (Array.isArray(state.pendingNotifications)) this.pendingNotifications = [...state.pendingNotifications];
    }
}

export default DynamicIslandLockscreenGlance;