/* ============================================================
 * config/lineage-living-assets.js — [R9-X6 · 第九期规划]
 * 有来历的生活资产流转与授权履约管理器（纯函数内核）
 * ------------------------------------------------------------
 * 【核心设计】
 *   作品、物件、名额、许可证和信物作为有来历的生活资产：
 *     - 四大生命周期流转状态：
 *       'borrowed' (借用) -> 'gifted' (转赠) -> 'breached' (失约) -> 'recovered' (追回)
 *     - 持有权 (ownership) 与 使用权 (usage_rights) 严格分离
 *     - 撤销授权仅阻断未来使用，永不覆盖历史持有人谱系 (holder_history)
 * ============================================================ */
export const ASSET_TRANSITION = Object.freeze({
    BORROW: 'borrowed',
    GIFT: 'gifted',
    BREACH: 'breached',
    RECOVER: 'recovered'
});

export function transitionLivingAsset(asset, transition = {}) {
    if (!asset || !asset.id) return { success: false, reason: 'invalid_asset' };

    const holderHistory = Array.isArray(asset.holderHistory) ? asset.holderHistory.slice() : [];
    const targetAction = transition.action;

    if (!Object.values(ASSET_TRANSITION).includes(targetAction)) {
        return { success: false, reason: 'invalid_transition_action' };
    }

    const currentOwner = asset.ownerId || 'original_creator';
    const newHolderId = transition.toActorId || currentOwner;

    holderHistory.push({
        holderId: newHolderId,
        action: targetAction,
        fromHolderId: asset.currentHolderId || currentOwner,
        timestamp: Date.now(),
        contractNote: transition.contractNote || ''
    });

    const isUsageActive = targetAction !== ASSET_TRANSITION.BREACH;

    return {
        ...asset,
        currentHolderId: newHolderId,
        lastAction: targetAction,
        isUsageActive,
        holderHistory,
        updatedAt: Date.now()
    };
}