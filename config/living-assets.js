/* ========================================================
 * config/living-assets.js — [R8-X6 · 第八期规划] 可交易的生活资产内核（纯函数）
 * --------------------------------------------------------
 * 【这一刀治的是什么】
 *   解决作品、信物、名额与契约缺少持有权属与流转历史的问题：
 *     ① 资产分类：artwork（作品手稿）/ relic（纪念信物）/ slot（特定活动名额）/ pledge（承诺书）；
 *     ② 权属流转谱系：每次转让记录发起方、接收方、对价协议与楼层时间；
 *     ③ 交易契约验证：防止未授权伪造所有权转移；
 *     ④ 会话隔离，严格纯函数。
 * ======================================================== */
'use strict';

export const LA_STORAGE_KEY = 'la_living_assets_v1';
export const LA_MAX_ASSETS = 30;

export const LIVING_ASSET_KINDS = Object.freeze({
    ARTWORK: 'artwork',
    RELIC: 'relic',
    SLOT: 'slot',
    PLEDGE: 'pledge'
});

function safeStr(v) { return (typeof v === 'string') ? v.trim() : ''; }
function safeArr(v) { return Array.isArray(v) ? v : []; }

export function normalizeLivingAssetState(raw) {
    if (!raw || typeof raw !== 'object') {
        return {
            assets: {},
            updatedAt: Date.now()
        };
    }
    const assets = {};
    if (raw.assets && typeof raw.assets === 'object') {
        for (const [id, a] of Object.entries(raw.assets)) {
            if (!a || typeof a !== 'object') continue;
            assets[id] = {
                id: safeStr(a.id) || id,
                title: safeStr(a.title) || '未命名资产',
                kind: Object.values(LIVING_ASSET_KINDS).includes(a.kind) ? a.kind : LIVING_ASSET_KINDS.RELIC,
                currentOwner: safeStr(a.currentOwner) || 'user',
                provenanceChain: safeArr(a.provenanceChain),
                createdAt: typeof a.createdAt === 'number' ? a.createdAt : Date.now()
            };
        }
    }
    return {
        assets,
        updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : Date.now()
    };
}

/**
 * 铸造/登记新资产
 */
export function mintAsset(state, spec) {
    const s = normalizeLivingAssetState(state);
    if (!spec || typeof spec !== 'object') {
        return { success: false, reason: 'invalid-spec', state: s };
    }
    const id = safeStr(spec.id) || `asset_${Date.now()}`;
    const title = safeStr(spec.title);
    if (!title) {
        return { success: false, reason: 'missing-title', state: s };
    }

    const kind = Object.values(LIVING_ASSET_KINDS).includes(spec.kind) ? spec.kind : LIVING_ASSET_KINDS.RELIC;
    const initialOwner = safeStr(spec.owner) || 'user';
    const now = Date.now();

    const asset = {
        id,
        title,
        kind,
        currentOwner: initialOwner,
        provenanceChain: [
            {
                event: 'mint',
                from: null,
                to: initialOwner,
                note: safeStr(spec.note) || '初始登记',
                timestamp: now
            }
        ],
        createdAt: now
    };

    return {
        success: true,
        asset,
        state: {
            ...s,
            assets: {
                ...s.assets,
                [id]: asset
            },
            updatedAt: now
        }
    };
}

/**
 * 转让资产所有权
 */
export function transferAsset(state, assetId, fromOwner, toOwner, agreementNote) {
    const s = normalizeLivingAssetState(state);
    const aid = safeStr(assetId);
    const asset = s.assets[aid];
    if (!asset) {
        return { success: false, reason: 'asset-not-found', state: s };
    }

    const from = safeStr(fromOwner);
    const to = safeStr(toOwner);
    if (!to) {
        return { success: false, reason: 'missing-recipient', state: s };
    }
    if (asset.currentOwner !== from) {
        return { success: false, reason: 'owner-mismatch', state: s };
    }

    const now = Date.now();
    const updatedAsset = {
        ...asset,
        currentOwner: to,
        provenanceChain: [
            ...asset.provenanceChain,
            {
                event: 'transfer',
                from,
                to,
                note: safeStr(agreementNote) || '权属转交',
                timestamp: now
            }
        ]
    };

    return {
        success: true,
        asset: updatedAsset,
        state: {
            ...s,
            assets: {
                ...s.assets,
                [aid]: updatedAsset
            },
            updatedAt: now
        }
    };
}