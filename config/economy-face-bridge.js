/**
 * config/economy-face-bridge.js — [v4.99.3 · R11-X2] 交易与资产面桥接层
 *
 * 【这一件存在的理由（修前实测）】四件经济内核早就写好了、也早就 import 进了
 *   orchestrator，但**产品端零读**（全仓 grep 实测 apps/ 下四处零命中）：
 *     · config/urban-economy.js（executeTransaction）—— 纯函数，签名 (state, spec)；
 *     · config/crossapp-transaction-stack.js（createTransaction/appendTransactionStep/
 *       commitTransaction/previewRollback/executeRollback）—— 纯函数，跨 App 事务栈；
 *     · config/living-assets.js（mintAsset/transferAsset）—— 纯函数，权属谱系；
 *     · config/lineage-living-assets.js（transitionLivingAsset）—— 纯函数，借用/转赠/失约/追回。
 *   而 orchestrator 里那四个「消费者」（transactEconomy / circulateLivingAsset /
 *   executeCompositeAction / rollbackCompositeAction）**全是零调用的空壳**，且装错了：
 *     · transactEconomy 把 executeTransaction({source,target,...}) 当 (state, spec) 调 ——
 *       state 位置上放的是 spec、spec 位置是 undefined ⇒ evaluateTransaction 判 invalid-spec；
 *     · circulateLivingAsset 同样把 mintAsset(assetMeta) 当 (state, spec)、transferAsset(id,owner)
 *       当 (state, assetId, from, to) ⇒ asset-not-found；transitionLivingAsset 还被塞了
 *       第二参 'active'，而它要的是 {action} 且合法值只有 borrowed/gifted/breached/recovered。
 *   ⇒ 「钱包里发起一笔转账」这条路在本仓此前一次都没走通过，而四把落盘键
 *     （ue_urban_economy_v1 / la_living_assets_v1）也从来没有写入方。
 *
 * 【本件只做两件事：纯映射 + 三态合并。持久化不在这里。】
 *   · 纯函数：(输入) => 输出。本件不含 storage、不写任何键、不 new 任何实例；
 *   · 活体真源是 **App 侧的交易存档**（apps/wallet/economy-store.js），本件只把
 *     存量读数映射成三面可渲染的形状。
 *
 * 【三态不同形（与 X1/X6 同款纪律）】
 *   · 读到且有数据 → 正常列表 + counts；
 *   · 读到但空（0 笔 / 0 件）→ 「还没有」（与「读不到」不同形）；
 *   · 读不到 / 读抛错 → 该面 null + notes.mustShowWhy（视图必须明写这是读不到）。
 *
 * 【回滚必须留可见痕迹 —— 本件的判定落点】
 *   `mapTransactionRow` 会给每一笔事务算 `undoState`：
 *     · 'undoable'   —— committed 且有 compensator 且无 irreversible 步骤；
 *     · 'partial'    —— committed 但含不可逆步骤（只能部分撤销，必须明写）；
 *     · 'undone'     —— 已回滚（**不是**从列表里删掉：那正是「静默恢复」，计划明令禁止）；
 *     · 'pending' / 'failed'。
 *   回滚后行**仍在**，带 rolledBackAt 与补偿计划条数 —— 用户看得见「这笔被撤销了」。
 */
'use strict';
import { numOrNull } from './num-gate.js';

/* ---------- 状态词表（判据按此表逐词核，防随口新词） ---------- */
export const TX_STATUS = Object.freeze({
    PENDING: 'pending',
    COMMITTED: 'committed',
    ROLLED_BACK: 'rolled_back',
    FAILED: 'failed'
});

export const UNDO_STATE = Object.freeze({
    UNDOABLE: 'undoable',
    PARTIAL: 'partial',
    UNDONE: 'undone',
    PENDING: 'pending',
    FAILED: 'failed'
});

/** 余额面的三态归因词。 */
export const BALANCE_REASONS = Object.freeze({
    OK: 'ok',
    NO_STORE: 'no_store',
    READ_THREW: 'read_threw',
    BAD_SHAPE: 'bad_shape'
});

function safeStr(v) { return (typeof v === 'string') ? v.trim() : ''; }
function safeNum(v, d) {
    /* [v4.99.4] 走全仓唯一取值门 numOrNull：本地再写一份 `Number.isFinite(Number(v))`
     *   就是弱口径副本（`Number(null) === 0`：「没给」与「给了 0」塔成一个读数），
     *   weak-coercion 门会当场报 W1。默认值语义在这里补，取值口径不重写。 */
    const n = numOrNull(v);
    return n === null ? d : n;
}
function safeArr(v) { return Array.isArray(v) ? v : []; }

/* ---------- 纯映射 ---------- */
/**
 * 事务行 → 视图行。
 * @param {object} raw 交易存档里的 listing 行（形状见 apps/wallet/economy-store.js）
 * @returns {object|null} 不合格返回 null（**不补空壳**：空壳会让界面假装有东西）
 */
export function mapTransactionRow(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const id = safeStr(raw.id);
    if (!id) return null;
    const status = Object.values(TX_STATUS).includes(raw.status) ? raw.status : TX_STATUS.PENDING;
    const steps = safeArr(raw.steps);
    const irreversibleCount = steps.filter((s) => s && s.irreversible).length;
    const compensableCount = steps.filter((s) => s && !s.irreversible && s.compensator).length;
    let undoState;
    if (status === TX_STATUS.ROLLED_BACK) undoState = UNDO_STATE.UNDONE;
    else if (status === TX_STATUS.FAILED) undoState = UNDO_STATE.FAILED;
    else if (status === TX_STATUS.PENDING) undoState = UNDO_STATE.PENDING;
    else if (irreversibleCount > 0) undoState = UNDO_STATE.PARTIAL;
    else undoState = UNDO_STATE.UNDOABLE;
    return {
        id,
        label: safeStr(raw.label) || '未命名事务',
        status,
        undoState,
        amount: safeNum(raw.amount, 0),
        from: safeStr(raw.from) || '未记',
        to: safeStr(raw.to) || '未记',
        assetId: safeStr(raw.assetId),
        assetTitle: safeStr(raw.assetTitle),
        stepCount: steps.length,
        compensableCount,
        irreversibleCount,
        /* ★ 回滚痕迹：撤销过的行**照样在列表里**，带时间与补偿条数 */
        undone: status === TX_STATUS.ROLLED_BACK,
        rolledBackAt: safeNum(raw.rolledBackAt, 0),
        compensationCount: safeNum(raw.compensationCount, 0),
        createdAt: safeNum(raw.createdAt, 0)
    };
}

/**
 * 资产行 → 视图行（living-assets 的 assets 字典 + lineage 的流转字段）。
 */
export function mapAssetRow(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const id = safeStr(raw.id);
    if (!id) return null;
    const chain = safeArr(raw.provenanceChain);
    const holderHistory = safeArr(raw.holderHistory);
    return {
        id,
        title: safeStr(raw.title) || '未命名资产',
        kind: safeStr(raw.kind) || 'relic',
        currentOwner: safeStr(raw.currentOwner) || safeStr(raw.currentHolderId) || 'user',
        lastAction: safeStr(raw.lastAction),
        isUsageActive: raw.isUsageActive !== false,
        provenanceLen: chain.length,
        holderHistoryLen: holderHistory.length,
        lastEvent: chain.length ? safeStr(chain[chain.length - 1].event) || 'mint' : 'mint',
        createdAt: safeNum(raw.createdAt, 0)
    };
}

/**
 * 余额面 → 视图形状（tools 里没有可信数时**不编数**）。
 */
export function mapBalanceRow(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const currency = raw.currency;
    const trust = raw.trust;
    /* 两面都取不到数就不该造一行（这里不用 safeNum：默认值会把「取不到」伪装成 0）。 */
    if (numOrNull(currency) === null && numOrNull(trust) === null) return null;
    return {
        currency: safeNum(currency, 0),
        trust: safeNum(trust, 0),
        locationCount: Object.keys(raw.locationReputation && typeof raw.locationReputation === 'object'
            ? raw.locationReputation : {}).length
    };
}

/* ---------- 三态合并（唯一判据面） ---------- */
/**
 * 合并交易与资产面。
 * @param {object|null} store  交易存档实例（可缺席）：需提供 listTransactions()/
 *                             listAssets()/balance()，三者任一缺失按该面「读不到」记
 * @returns {{faces:{balances:*, transactions:*, assets:*},
 *            counts:{balances:number,transactions:number,assets:number},
 *            notes:{why:string,mustShowWhy:boolean,perFace:object}}}
 *   · faces.X === null 表示该面**读不到**（与空数组不同形）；
 *   · notes.mustShowWhy 为 true 时视图**必须**明写「读不到」。
 */
export function mergeEconomyFaces(store) {
    const faces = { balances: null, transactions: null, assets: null };
    const counts = { balances: 0, transactions: 0, assets: 0 };
    const notes = { why: BALANCE_REASONS.OK, mustShowWhy: false, perFace: {} };
    if (!store || typeof store !== 'object') {
        notes.why = BALANCE_REASONS.NO_STORE;
        notes.mustShowWhy = true;
        notes.perFace = { balances: BALANCE_REASONS.NO_STORE, transactions: BALANCE_REASONS.NO_STORE, assets: BALANCE_REASONS.NO_STORE };
        return { faces, counts, notes };
    }

    /* 余额面 */
    try {
        if (typeof store.balance === 'function') {
            const row = mapBalanceRow(store.balance());
            if (row) {
                faces.balances = row;
                counts.balances = 1;
                notes.perFace.balances = BALANCE_REASONS.OK;
            } else {
                faces.balances = null;
                notes.perFace.balances = BALANCE_REASONS.BAD_SHAPE;
                notes.mustShowWhy = true;
                notes.why = BALANCE_REASONS.BAD_SHAPE;
            }
        } else {
            notes.perFace.balances = BALANCE_REASONS.NO_STORE;
            notes.mustShowWhy = true;
            notes.why = BALANCE_REASONS.NO_STORE;
        }
    } catch (_e) {
        faces.balances = null;
        notes.perFace.balances = BALANCE_REASONS.READ_THREW;
        notes.mustShowWhy = true;
        notes.why = BALANCE_REASONS.READ_THREW;
    }

    /* 交易面 */
    try {
        if (typeof store.listTransactions === 'function') {
            const rows = safeArr(store.listTransactions()).map(mapTransactionRow).filter(Boolean);
            faces.transactions = rows;
            counts.transactions = rows.length;
            notes.perFace.transactions = BALANCE_REASONS.OK;
        } else {
            notes.perFace.transactions = BALANCE_REASONS.NO_STORE;
            notes.mustShowWhy = true;
            if (notes.why === BALANCE_REASONS.OK) notes.why = BALANCE_REASONS.NO_STORE;
        }
    } catch (_e) {
        faces.transactions = null;
        notes.perFace.transactions = BALANCE_REASONS.READ_THREW;
        notes.mustShowWhy = true;
        notes.why = BALANCE_REASONS.READ_THREW;
    }

    /* 资产面 */
    try {
        if (typeof store.listAssets === 'function') {
            const rows = safeArr(store.listAssets()).map(mapAssetRow).filter(Boolean);
            faces.assets = rows;
            counts.assets = rows.length;
            notes.perFace.assets = BALANCE_REASONS.OK;
        } else {
            notes.perFace.assets = BALANCE_REASONS.NO_STORE;
            notes.mustShowWhy = true;
            if (notes.why === BALANCE_REASONS.OK) notes.why = BALANCE_REASONS.NO_STORE;
        }
    } catch (_e) {
        faces.assets = null;
        notes.perFace.assets = BALANCE_REASONS.READ_THREW;
        notes.mustShowWhy = true;
        notes.why = BALANCE_REASONS.READ_THREW;
    }

    return { faces, counts, notes };
}

/**
 * 撤销预告：把「这一笔能不能撤、撤了会怎样」说清楚（不可逆操作必须先预览再提交）。
 * @param {object} raw 交易存档里的事务行
 * @returns {{ok:boolean, canUndo:boolean, reason:string,
 *            compensationCount:number, irreversibleCount:number,
 *            irreversibleSteps:Array, compensations:Array}}
 */
export function previewUndo(raw) {
    if (!raw || typeof raw !== 'object' || !safeStr(raw.id)) {
        return { ok: false, canUndo: false, reason: 'invalid-transaction', compensationCount: 0, irreversibleCount: 0, irreversibleSteps: [], compensations: [] };
    }
    const status = Object.values(TX_STATUS).includes(raw.status) ? raw.status : TX_STATUS.PENDING;
    if (status === TX_STATUS.ROLLED_BACK) {
        return { ok: true, canUndo: false, reason: 'already-rolled-back', compensationCount: 0, irreversibleCount: 0, irreversibleSteps: [], compensations: [] };
    }
    if (status !== TX_STATUS.COMMITTED) {
        return { ok: true, canUndo: false, reason: 'not-committed:' + status, compensationCount: 0, irreversibleCount: 0, irreversibleSteps: [], compensations: [] };
    }
    const steps = safeArr(raw.steps);
    const irreversibleSteps = [];
    const compensations = [];
    /* LIFO：与 executeRollback 的逆序口径一致 */
    for (let i = steps.length - 1; i >= 0; i--) {
        const s = steps[i];
        if (!s || typeof s !== 'object') continue;
        if (s.irreversible) irreversibleSteps.push({ stepId: safeStr(s.stepId), app: safeStr(s.app), action: safeStr(s.action) });
        else if (s.compensator) compensations.push({ targetStepId: safeStr(s.stepId), app: safeStr(s.compensator.app), action: safeStr(s.compensator.action) });
    }
    return {
        ok: true,
        canUndo: true,
        reason: irreversibleSteps.length ? 'partial-rollback' : 'full-rollback',
        compensationCount: compensations.length,
        irreversibleCount: irreversibleSteps.length,
        irreversibleSteps,
        compensations
    };
}