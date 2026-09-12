/* ========================================================
 * 心境 (Mood) App — 聚合情绪引擎 / 积温主动 / 记忆系统 可视化
 *
 * 把 ruby-phone 已移植的三大后台引擎在手机里做成可感知界面:
 *   1. Drivesoid 情绪动力学 (config/drives-engine.js) → 情绪色卡 + 三维度链
 *   2. jiwen 积温 (config/jiwen-engine.js) → 五轴状态 + 当前触发档位
 *   3. 记忆系统 (apps/memory) → 记忆规模 + 召回权限 + 换代统计
 *
 * 只读聚合, 不直接写引擎状态(引擎状态由 index.js 统一推进)。
 * ======================================================== */
'use strict';
import { MoodView } from './mood-view.js';

export class MoodApp {
    constructor(phoneShell, storage) {
        this.phoneShell = phoneShell;
        this.storage = storage;
        this.view = new MoodView(this);
    }

    // 读取 drives 状态 (chatMetadata['st_virtual_phone_drives'].state)
    _getDrivesState() {
        try {
            const ctx = this.storage?.getContext?.();
            if (!ctx?.chatMetadata) return null;
            const store = ctx.chatMetadata['st_virtual_phone_drives'];
            return (store && store.state) || null;
        } catch (e) { return null; }
    }

    // 读取积温状态 (window.VirtualPhone.jiwen.state) + chatMetadata 里的触发档
    _getJiwenState() {
        try {
            const jw = (window.VirtualPhone && window.VirtualPhone.jiwen) || null;
            const state = (jw && jw.state) || null;
            const ctx = this.storage?.getContext?.();
            const jStore = (ctx && ctx.chatMetadata && ctx.chatMetadata['st_virtual_phone_jiwen']) || null;
            return {
                state,
                triggeredAt: (jStore && jStore.triggeredAt) || null,
                proactive: (jStore && jStore.proactive) || null
            };
        } catch (e) { return { state: null, triggeredAt: null, proactive: null }; }
    }

    // 读取记忆系统统计 (window.VirtualPhone.memoryCore)
    _getMemoryStats() {
        try {
            const core = (window.VirtualPhone && window.VirtualPhone.memoryCore) || null;
            if (!core) return null;
            const st = core.stats || {};
            const longTerm = Array.isArray(core.longTerm) ? core.longTerm : [];
            const supersededCount = longTerm.filter(m => m && m.metadata && m.metadata._superseded === 'superseded').length;
            const tier = { cite: 0, cautious: 0, associate: 0 };
            for (const m of longTerm) {
                const perm = m.metadata && m.metadata._permission;
                if (perm === 'cite') tier.cite++;
                else if (perm === 'cautious') tier.cautious++;
                else if (perm === 'associate-only') tier.associate++;
            }
            return {
                longTermCount: longTerm.length,
                shortTermCount: Array.isArray(core.shortTerm) ? core.shortTerm.length : 0,
                consolidated: st.consolidated || 0,
                superseded: st.superseded || 0,
                tombstoned: st.tombstoned || 0,
                tier
            };
        } catch (e) { return null; }
    }

    render() {
        if (!this.phoneShell?.setContent) return;
        const drives = this._getDrivesState();
        const jiwen = this._getJiwenState();
        const memory = this._getMemoryStats();
        this.view.render(drives, jiwen, memory);
    }
}

export default MoodApp;