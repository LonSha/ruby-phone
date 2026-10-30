/**
 * config/archive-face-bridge.js — [v4.99.2 · R11-X1] 人物档案面桥接层
 *
 * 【这一件存在的理由】InventoryBackpackManager（背包）/ CharacterDossierManager（档案）/
 *   VolumeChronicleManager（卷宗）三件在 orchestrator 挂载已久（v4.57.0 起挂到
 *   subsystems.backpack/.dossiers/.volumes），但产品端零读、键登记了零写——
 *   「角色随身物 / 关系记录 / 分卷回顾」在手机上完全答不出。
 *   X6（notification-hub-bridge）已确立装配模板，本件对齐同款形态接入群像 App。
 *
 * 【纯读 + 纯函数：不是第二份真源】本件不含 storage、不含任何持久化：
 *   mapArchiveData / mergeArchiveFaces 全部是 (输入) => 输出 的纯函数。
 *   持久化契约归各数据主自己（serialize/restore 也在各数据主身上）。
 *   App 侧只做「读中枢 → 呈现」，写回各回各家（写口挂在中枢实例上）。
 *
 * 【三态不同形】与 X6 同款纪律：
 *   · 中枢在场且有数据 → 正常呈现（counts 带真数）；
 *   · 中枢在场但空（0 物品 / 0 档案 / 0 卷）→ 「还没有」面（不与「读不到」同形）；
 *   · 中枢缺席 / 读抛错 → 「读不到」面（mustShowWhy，视图必须明写这是读不到）。
 *   空与读不得同形（「显示为空」时必须仍可分辨「中枢在」）。
 *
 * 【与 chars 主面的分工】chars 主面（projection）投影的是上游记忆插件的
 *   角色状态表；本面投影的是手机自己积累的档案三件（背包/档案/卷宗）。
 *   两面互补不重叠：主面答「现在什么状态」，本面答「积累了什么」。
 */
'use strict';

/* ---------- 纯映射 ---------- */

/** 背包行 → 视图行（字段裁剪 + 可读状态） */
export function mapBackpackRow(raw, ownerName) {
    if (!raw || typeof raw !== 'object' || !raw.id) return null;
    return {
        id: String(raw.id),
        name: raw.name || '未命名物品',
        owner: raw.owner || 'protagonist',
        source: raw.source || '剧情获得',
        significance: raw.significance || '随身纪念物',
        status: ['held', 'lost', 'consumed'].includes(raw.status) ? raw.status : 'held',
        historyLen: Array.isArray(raw.history) ? raw.history.length : 0,
        lastAction: (Array.isArray(raw.history) && raw.history.length)
            ? (raw.history[raw.history.length - 1].action || 'acquired')
            : 'acquired'
    };
}

/** 档案行 → 视图行（只带展示面字段；完整档案按名直取） */
export function mapDossierRow(raw) {
    if (!raw || typeof raw !== 'object' || !raw.name) return null;
    return {
        name: raw.name,
        identity: raw.identity || '重要角色',
        formattedAttitudeText: raw.formattedAttitudeText || '关系：朋友；态度：友好相待',
        hasShift: !!raw.personalityShift,
        shiftSummary: raw.personalityShift && raw.personalityShift.statement
            ? raw.personalityShift.statement
            : '性格状态稳定',
        recentInteractions: raw.recentInteractions || '暂无近期特殊互动',
        experienceBrief: raw.experienceBrief || '经历待补充'
    };
}

/** 卷宗行 → 视图行（对齐 renderCardDeck 的卡片形状） */
export function mapVolumeRow(raw) {
    if (!raw || typeof raw !== 'object') return null;
    return {
        index: raw.index || 1,
        title: raw.title || `第${raw.index || 1}卷`,
        timeRange: raw.timeRange || '未知时期',
        recap: raw.recap || '无概述',
        entryCount: raw.entryCount || 0,
        majorEventCount: raw.majorEventCount || 0,
        characters: Array.isArray(raw.characters) ? raw.characters : []
    };
}

/* ---------- 三态合并（唯一判据面） ---------- */

/**
 * 合并三面读数。返回 { faces, counts, notes }：
 *   faces = { backpack: 行数组|null, dossiers: 行数组|null, volumes: 行数组|null }
 *     —— null 表示该面**读不到**（与空数组不同形）；
 *   counts = 每面映射成功条数（含 lastVolumes 统计）；
 *   notes = { why, mustShowWhy } —— mustShowWhy 为 true 时视图必须明写「读不到」。
 *
 * @param {{backpack?:object, dossiers?:object, volumes?:object}} hub 中枢实例（可缺席）
 * @param {{owner?:string}} [opts] owner：背包按持有者过滤（默认 protagonist）
 */
export function mergeArchiveFaces(hub, opts) {
    const o = (opts && typeof opts === 'object') ? opts : {};
    const owner = o.owner || 'protagonist';
    const notes = { why: 'ok', mustShowWhy: false };
    const faces = { backpack: null, dossiers: null, volumes: null };
    const counts = { backpack: 0, dossiers: 0, volumes: 0 };

    /* 三态之一：中枢缺席 */
    if (!hub || typeof hub !== 'object') {
        notes.why = 'no_subsystems';
        notes.mustShowWhy = true;
        return { faces, counts, notes };
    }

    /* 背包面 */
    try {
        if (hub.backpack && typeof hub.backpack.listByOwner === 'function') {
            const rows = hub.backpack.listByOwner(owner, false).map((r) => mapBackpackRow(r, owner));
            faces.backpack = rows.filter(Boolean);
            counts.backpack = faces.backpack.length;
        } else {
            notes.why = 'no_backpack';
            notes.mustShowWhy = true;
        }
    } catch (_e) {
        faces.backpack = null;
        notes.why = 'backpack_read_threw';
        notes.mustShowWhy = true;
    }

    /* 档案面 */
    try {
        if (hub.dossiers && typeof hub.dossiers.listDossierSummaries === 'function') {
            const rows = hub.dossiers.listDossierSummaries().map(mapDossierRow);
            faces.dossiers = rows.filter(Boolean);
            counts.dossiers = faces.dossiers.length;
        } else {
            notes.why = 'no_dossiers';
            notes.mustShowWhy = true;
        }
    } catch (_e) {
        faces.dossiers = null;
        notes.why = 'dossiers_read_threw';
        notes.mustShowWhy = true;
    }

    /* 卷宗面 */
    try {
        if (hub.volumes && typeof hub.volumes.getStats === 'function') {
            const stats = hub.volumes.getStats();
            const rows = (hub.volumes.volumes || []).map(mapVolumeRow);
            faces.volumes = rows.filter(Boolean);
            counts.volumes = faces.volumes.length;
            counts.volumeStats = {
                totalVolumes: stats.totalVolumes,
                totalEntriesArchived: stats.totalEntriesArchived,
                totalMajorEvents: stats.totalMajorEvents
            };
        } else {
            notes.why = 'no_volumes';
            notes.mustShowWhy = true;
        }
    } catch (_e) {
        faces.volumes = null;
        notes.why = 'volumes_read_threw';
        notes.mustShowWhy = true;
    }

    return { faces, counts, notes };
}
