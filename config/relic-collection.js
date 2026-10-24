/* ========================================================
 * config/relic-collection.js — [R7-X6 · 第七期拓展规划] 关系纪念物与共同收藏（纯函数）
 * --------------------------------------------------------
 * 【这一刀治的是什么】
 *   角色之间共同保存的旧车票、合照、歌单或手写便签，传统系统往往将其当成
 *   单一用户的背包物品，忽视了物件承载的多方回忆分歧、转赠轨迹与丢失修复。
 *   关系纪念物与共同收藏建立“多人多视角解读、所有权流转与物态可溯”机制：
 *     ① 多视角主观诠释(annotationsByRole)：同一物件由不同角色分别写下专属回忆批注，
 *        系统正视认知差异，绝不强求单一标准解释；
 *     ② 所有权流转追踪(transferRelicOwnership)：转赠后记录现任所有人与历史持有链，
 *        转赠不等于抹除往昔；
 *     ③ 撤销共享不伪造遗忘(revokeRelicSharing)：收紧共享权限时，
 *        其他角色的主观记忆与批注留在本地，绝不发生“单方面修改让对方失忆”；
 *     ④ 物态异动留痕(markRelicState)：记录物件的完好、磨损、遗失与修复痕迹。
 * ======================================================== */
'use strict';

/** 物件状态 */
export const RELIC_STATUS = Object.freeze({
    INTACT: 'intact',           // 完好保存
    WORN: 'worn',               // 岁月磨损
    DAMAGED: 'damaged',         // 破损受损
    REPAIRED: 'repaired',       // 经修缮复原
    MISSING: 'missing'          // 遗失下落不明
});

/** 纪念物类别 */
export const RELIC_CATEGORY = Object.freeze({
    PAPER_EPHEMERA: 'paper',    // 车票/信函/便签/门票
    PHOTO: 'photo',             // 胶片合影/立拍得
    KEEPSAKE: 'keepsake',       // 钥匙扣/首饰/纽扣/手办
    MEDIA: 'media'              // 录音带/随身听歌单
});

function safeStr(val, fallback = '') {
    return (typeof val === 'string') ? val.trim() : fallback;
}

function safeNum(val, fallback = 0) {
    const n = Number(val);
    return Number.isFinite(n) ? n : fallback;
}

/**
 * 规范化纪念物对象
 */
export function normalizeRelic(raw = {}) {
    if (!raw || typeof raw !== 'object') return null;
    const relicId = safeStr(raw.relicId || raw.id, `relic_${Date.now().toString(36)}`);
    const title = safeStr(raw.title, '未命名纪念物');
    const categoryValues = Object.values(RELIC_CATEGORY);
    const category = categoryValues.includes(raw.category) ? raw.category : RELIC_CATEGORY.PAPER_EPHEMERA;
    const statusValues = Object.values(RELIC_STATUS);
    const status = statusValues.includes(raw.status) ? raw.status : RELIC_STATUS.INTACT;

    const initialOwnerId = safeStr(raw.initialOwnerId, 'owner_anon');
    const currentOwnerId = safeStr(raw.currentOwnerId, initialOwnerId);

    const ownershipHistory = Array.isArray(raw.ownershipHistory)
        ? raw.ownershipHistory.map(h => ({
            fromOwnerId: safeStr(h.fromOwnerId),
            toOwnerId: safeStr(h.toOwnerId),
            transferredAt: safeNum(h.transferredAt, Date.now()),
            note: safeStr(h.note)
        }))
        : [];

    const sharedRoleIds = Array.isArray(raw.sharedRoleIds)
        ? raw.sharedRoleIds.map(safeStr).filter(Boolean)
        : [currentOwnerId];

    const annotationsByRole = raw.annotationsByRole && typeof raw.annotationsByRole === 'object'
        ? { ...raw.annotationsByRole }
        : {};

    return Object.freeze({
        relicId,
        title,
        category,
        status,
        initialOwnerId,
        currentOwnerId,
        ownershipHistory: Object.freeze(ownershipHistory),
        sharedRoleIds: Object.freeze(Array.from(new Set(sharedRoleIds))),
        annotationsByRole: Object.freeze(annotationsByRole),
        associatedEventRef: safeStr(raw.associatedEventRef, ''),
        createdAt: safeNum(raw.createdAt, Date.now()),
        updatedAt: safeNum(raw.updatedAt, Date.now())
    });
}

/**
 * 角色为物件添加或更新其个人主观回忆批注
 */
export function annotateRelic(relic, roleId, annotationText, now = Date.now()) {
    const norm = normalizeRelic(relic);
    if (!norm) return null;
    const rid = safeStr(roleId);
    const text = safeStr(annotationText);
    if (!rid || !text) return norm;

    const nextAnnotations = {
        ...norm.annotationsByRole,
        [rid]: text
    };

    return Object.freeze({
        ...norm,
        annotationsByRole: Object.freeze(nextAnnotations),
        updatedAt: now
    });
}

/**
 * 转赠物件（更新所有权并记录历史流转链）
 */
export function transferRelicOwnership(relic, toOwnerId, transferNote = '', now = Date.now()) {
    const norm = normalizeRelic(relic);
    if (!norm) return null;
    const newOwner = safeStr(toOwnerId);
    if (!newOwner || newOwner === norm.currentOwnerId) return norm;

    const transferLog = {
        fromOwnerId: norm.currentOwnerId,
        toOwnerId: newOwner,
        transferredAt: now,
        note: safeStr(transferNote, '转赠留念')
    };

    const nextShared = new Set(norm.sharedRoleIds);
    nextShared.add(newOwner);

    return Object.freeze({
        ...norm,
        currentOwnerId: newOwner,
        ownershipHistory: Object.freeze([...norm.ownershipHistory, transferLog]),
        sharedRoleIds: Object.freeze(Array.from(nextShared)),
        updatedAt: now
    });
}

/**
 * 撤销共享权限（保护隐私，但不伪造历史失忆）
 */
export function revokeRelicSharing(relic, revokedRoleId, now = Date.now()) {
    const norm = normalizeRelic(relic);
    if (!norm) return null;
    const rid = safeStr(revokedRoleId);
    if (!rid || rid === norm.currentOwnerId) return norm;

    const nextShared = norm.sharedRoleIds.filter(id => id !== rid);

    return Object.freeze({
        ...norm,
        sharedRoleIds: Object.freeze(nextShared),
        // 保留已有的历史批注作为客观存证，仅在可见列表中排除
        updatedAt: now
    });
}

/**
 * 标记物件物理状态变化（破损、修缮、遗失）
 */
export function markRelicStatus(relic, newStatus, conditionNote = '', now = Date.now()) {
    const norm = normalizeRelic(relic);
    if (!norm) return null;
    const statusValues = Object.values(RELIC_STATUS);
    const status = statusValues.includes(newStatus) ? newStatus : norm.status;

    return Object.freeze({
        ...norm,
        status,
        conditionNote: safeStr(conditionNote, norm.conditionNote || ''),
        updatedAt: now
    });
}

/**
 * 模块自检函数
 */
export function relicCollectionSelfCheck() {
    const problems = [];
    if (Object.keys(RELIC_STATUS).length !== 5) {
        problems.push('RELIC_STATUS 必须恰好为 5 类状态');
    }
    if (Object.keys(RELIC_CATEGORY).length !== 4) {
        problems.push('RELIC_CATEGORY 必须恰好为 4 种类型');
    }

    try {
        let relic = normalizeRelic({
            relicId: 'relic_train_ticket',
            title: '2016年开往省城的特快硬座车票',
            category: RELIC_CATEGORY.PAPER_EPHEMERA,
            initialOwnerId: 'char_luojia',
            sharedRoleIds: ['char_luojia', 'char_shuyun']
        });

        // 1. 两人分别进行主观批注
        relic = annotateRelic(relic, 'char_luojia', '那天车窗外下着大雨，我一直在听同一首歌。');
        relic = annotateRelic(relic, 'char_shuyun', '他在发车前把车票塞进我包里，我一直夹在日记里。');
        if (Object.keys(relic.annotationsByRole).length !== 2) {
            problems.push('多角色主观诠释批注未能正确并存');
        }

        // 2. 转赠测试
        relic = transferRelicOwnership(relic, 'char_shuyun', '正式赠予舒芸留作青春见证');
        if (relic.currentOwnerId !== 'char_shuyun' || relic.ownershipHistory.length !== 1) {
            problems.push('物件转赠所有权流转异常');
        }
        if (relic.ownershipHistory[0].fromOwnerId !== 'char_luojia') {
            problems.push('转赠历史前任所有人记录错误');
        }

        // 3. 撤销第三人共享测试
        relic = revokeRelicSharing(relic, 'char_luojia');
        if (relic.sharedRoleIds.includes('char_luojia')) {
            problems.push('撤销共享后角色仍保留在共享列表中');
        }
        if (!relic.annotationsByRole['char_luojia']) {
            problems.push('撤销共享错误地删除了历史批注，伪造了失忆');
        }

        // 4. 物态受损与修缮
        relic = markRelicStatus(relic, RELIC_STATUS.DAMAGED, '车票边缘被水渍晕开');
        if (relic.status !== RELIC_STATUS.DAMAGED) {
            problems.push('物态受损标记异常');
        }
        relic = markRelicStatus(relic, RELIC_STATUS.REPAIRED, '用塑封膜重新做了防潮固化');
        if (relic.status !== RELIC_STATUS.REPAIRED) {
            problems.push('物态修缮复原标记异常');
        }
    } catch (err) {
        problems.push(`自检运行异常: ${err && err.message ? err.message : String(err)}`);
    }

    return { problems };
}