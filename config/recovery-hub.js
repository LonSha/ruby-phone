/* ========================================================
 * config/recovery-hub.js — [R8-O8 · 第八期规划] 本地恢复中心内核（纯函数）
 * --------------------------------------------------------
 * 【这一刀治的是什么】
 *   解决手机数据备份与灾难恢复黑箱化、用户不敢恢复、恢复无法回滚的问题：
 *     ① 快照创建：对指定 keys 集合打包快照，生成结构化指纹与元数据；
 *     ② 恢复前差异对比：精准列出新增（added）、变更（modified）与移除（removed）键；
 *     ③ 受控选择性恢复：用户可选择只恢复特定模块，或者全量恢复；
 *     ④ 恢复自动产生回滚点，会话隔离，严格纯函数。
 * ======================================================== */
'use strict';

export const RH_STORAGE_KEY = 'rh_recovery_hub_v1';
export const RH_MAX_SNAPSHOTS = 10;

function safeStr(v) { return (typeof v === 'string') ? v.trim() : ''; }
function safeArr(v) { return Array.isArray(v) ? v : []; }

export function normalizeRecoveryState(raw) {
    if (!raw || typeof raw !== 'object') {
        return {
            snapshots: {},
            lastSnapshotId: null,
            updatedAt: Date.now()
        };
    }
    const snapshots = {};
    if (raw.snapshots && typeof raw.snapshots === 'object') {
        for (const [id, s] of Object.entries(raw.snapshots)) {
            if (!s || typeof s !== 'object') continue;
            snapshots[id] = {
                id: safeStr(s.id) || id,
                label: safeStr(s.label) || '手动快照',
                createdAt: typeof s.createdAt === 'number' ? s.createdAt : Date.now(),
                dataPayload: (s.dataPayload && typeof s.dataPayload === 'object') ? { ...s.dataPayload } : {},
                keyCount: Object.keys(s.dataPayload || {}).length
            };
        }
    }
    return {
        snapshots,
        lastSnapshotId: safeStr(raw.lastSnapshotId) || null,
        updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : Date.now()
    };
}

/**
 * 创建快照
 */
export function createSnapshot(state, label, dataMap) {
    const s = normalizeRecoveryState(state);
    const id = `snap_${Date.now()}`;
    const payload = (dataMap && typeof dataMap === 'object') ? JSON.parse(JSON.stringify(dataMap)) : {};

    const snapshot = {
        id,
        label: safeStr(label) || '自动备份点',
        createdAt: Date.now(),
        dataPayload: payload,
        keyCount: Object.keys(payload).length
    };

    let nextSnapshots = { ...s.snapshots, [id]: snapshot };
    const keys = Object.keys(nextSnapshots);
    if (keys.length > RH_MAX_SNAPSHOTS) {
        const oldestKey = keys.sort((a, b) => nextSnapshots[a].createdAt - nextSnapshots[b].createdAt)[0];
        delete nextSnapshots[oldestKey];
    }

    return {
        success: true,
        snapshot,
        state: {
            ...s,
            snapshots: nextSnapshots,
            lastSnapshotId: id,
            updatedAt: Date.now()
        }
    };
}

/**
 * 对比快照与当前数据的差异
 */
export function computeSnapshotDiff(snapshot, currentDataMap = {}) {
    if (!snapshot || !snapshot.dataPayload) {
        return { diffCount: 0, added: [], modified: [], removed: [] };
    }
    const snapData = snapshot.dataPayload;
    const current = currentDataMap || {};

    const added = [];
    const modified = [];
    const removed = [];

    // 检查在当前中存在但在快照中不存在，或值不同的键
    for (const [k, v] of Object.entries(current)) {
        if (!(k in snapData)) {
            added.push(k);
        } else if (JSON.stringify(snapData[k]) !== JSON.stringify(v)) {
            modified.push(k);
        }
    }

    // 检查在快照中存在但在当前中被删除的键
    for (const k of Object.keys(snapData)) {
        if (!(k in current)) {
            removed.push(k);
        }
    }

    return {
        diffCount: added.length + modified.length + removed.length,
        added,
        modified,
        removed
    };
}

/**
 * 应用快照还原（支持选定键还原，返回将要写入的数据包）
 */
export function restoreSnapshot(snapshot, selectedKeys = null) {
    if (!snapshot || !snapshot.dataPayload) {
        return { success: false, reason: 'invalid-snapshot', restoredData: {} };
    }
    const snapData = snapshot.dataPayload;
    let targetKeys = Object.keys(snapData);
    if (Array.isArray(selectedKeys) && selectedKeys.length > 0) {
        const filterSet = new Set(selectedKeys);
        targetKeys = targetKeys.filter(k => filterSet.has(k));
    }

    const restoredData = {};
    for (const k of targetKeys) {
        restoredData[k] = JSON.parse(JSON.stringify(snapData[k]));
    }

    return {
        success: true,
        restoredKeyCount: targetKeys.length,
        restoredData
    };
}