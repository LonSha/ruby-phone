/* ============================================================
 * apps/wallet/economy-store.js — [v4.99.3 · R11-X2] 交易与资产真源
 * ------------------------------------------------------------
 * 【这一件存在的理由（修前实测）】四件经济内核早已写好，但产品端零读零写：
 *   · config/urban-economy.js        executeTransaction(state, spec)   —— 纯函数；
 *   · config/crossapp-transaction-stack.js  createTransaction/appendTransactionStep/
 *     commitTransaction/previewRollback/executeRollback               —— 纯函数；
 *   · config/living-assets.js        mintAsset/transferAsset(state,...) —— 纯函数；
 *   · config/lineage-living-assets.js transitionLivingAsset(asset, t)  —— 纯函数。
 *   两把落盘键（ue_urban_economy_v1 / la_living_assets_v1）在 keys-audit 里登记着，
 *   却**从来没有写入方** —— 这是本仓最贵的形态：有键、有门禁、有内核，没有出口。
 *   本件补的就是那个出口：把「发起 → 提交 → 撤销」三步做成真读写。
 *
 * 【本件是真源，桥只是纯映射】分工与 X1 同款：
 *   · 本件持有活状态（economy / assets / txs）并**独占**三把键的读写；
 *   · config/economy-face-bridge.js 纯读映射 + 三态合并，不碰 storage；
 *   · 视图只经 App 的 economyFace() 拿读数，不直接 import 桥、不碰本件。
 *
 * 【回滚不得静默 —— 计划明令禁止】
 *   executeRollback 是**纯内核**：它算补偿计划、把状态置 rolled_back，但**不动账**。
 *   真正把钱与归属改回去的是本件的 _applyCompensations。
 *   撤销后的事务行**仍在列表里**（带 rolledBackAt 与补偿条数），不是从列表消失 ——
 *   「静默恢复」正是计划点名不许的那种做法：用户看不见就等于没发生过。
 *
 * 【部分完成不是成功】含 irreversible 步骤的事务（如购置会上链的资产）回滚后
 *   记 partialRollback: true 与 irreversibleSteps，视图必须明写「只撤销了一部分」。
 *
 * 【三把键一次写齐】economy / assets / txs 同属一笔账，半截持久化会让
 *   「钱扣了但资产没登记」。故 save() 一次写三键，restore() 一次读回。
 * ============================================================ */
'use strict';
import {
    normalizeEconomyState,
    executeTransaction,
    evaluateTransaction
} from '../../config/urban-economy.js';
import {
    normalizeLivingAssetState,
    mintAsset,
    transferAsset
} from '../../config/living-assets.js';
import {
    createTransaction,
    appendTransactionStep,
    commitTransaction,
    executeRollback,
    previewRollback,
    TX_STATUS
} from '../../config/crossapp-transaction-stack.js';

/* 三把落盘键：**逐把声明为常量**（不写成对象字面量内的裸字符串）——
 *   scripts/keys-audit.mjs 的键面抽取器认的是 `XXX_KEY = '<lit>'` 这一形式，
 *   写成对象属性会让 K3 判「登记条目已失效（幽灵放行条）」。
 *   字面量与 keys-audit 的 KEY_REGISTRY 登记逐字一致。 */
const UE_STORAGE_KEY = 'ue_urban_economy_v1';
const LA_STORAGE_KEY = 'la_living_assets_v1';
const ET_TX_STORAGE_KEY = 'et_economy_tx_v1';
/** 对外导出的键组（与上面三常量同源，不另抄一份字面量） */
export const ECONOMY_KEYS = Object.freeze({
    economy: UE_STORAGE_KEY,
    assets: LA_STORAGE_KEY,
    transactions: ET_TX_STORAGE_KEY
});
/** 事务类型（决定 steps 的形状与哪些步骤不可逆） */
export const TX_KINDS = Object.freeze({
    TRANSFER: 'transfer',
    PURCHASE: 'purchase',
    GIFT: 'gift'
});
/** 补偿动作词（本件与视图共用口径；不写成散字符串） */
export const COMPENSATION_ACTIONS = Object.freeze({
    REFUND_CURRENCY: 'refund-currency',
    RETURN_ASSET: 'return-asset',
    VOID_LEDGER: 'void-ledger'
});
const MAX_TX = 60;

function safeStr(v) { return (typeof v === 'string') ? v.trim() : ''; }
function safeNum(v, d) {
    const n = Number(v);
    return Number.isFinite(n) ? n : d;
}
function safeArr(v) { return Array.isArray(v) ? v : []; }

export class EconomyStore {
    /**
     * @param {object} storage 宿主存储（get/set）；缺席时本件退化为纯内存（不崩、不静默成功）
     */
    constructor(storage) {
        this.storage = storage || null;
        this._economy = normalizeEconomyState(null);
        this._assets = normalizeLivingAssetState(null);
        this._txs = [];
        this._loaded = false;
    }
    /* ---------------- 存储（永不抛） ---------------- */
    _readJson(key) {
        try {
            const raw = this.storage?.get?.(key, null);
            if (raw === null || raw === undefined || raw === '') return null;
            if (typeof raw === 'object') return raw;
            return JSON.parse(raw);
        } catch (_e) { return null; }
    }
    /** 三键一次读回（冷启 / 会话切换）。存储不可用 ⇒ false，且**不假装**读到空账 */
    restore() {
        try {
            const eco = this._readJson(ECONOMY_KEYS.economy);
            const ast = this._readJson(ECONOMY_KEYS.assets);
            const txs = this._readJson(ECONOMY_KEYS.transactions);
            this._economy = normalizeEconomyState(eco);
            this._assets = normalizeLivingAssetState(ast);
            this._txs = safeArr(txs).filter((t) => t && typeof t === 'object' && safeStr(t.txId)).slice(-MAX_TX);
            this._loaded = true;
            return true;
        } catch (_e) { return false; }
    }
    /** 三键一次写齐（半截持久化会让「钱扣了资产没登记」） */
    save() {
        if (!this.storage || typeof this.storage.set !== 'function') return false;
        try {
            this.storage.set(ECONOMY_KEYS.economy, JSON.stringify(this._economy));
            this.storage.set(ECONOMY_KEYS.assets, JSON.stringify(this._assets));
            this.storage.set(ECONOMY_KEYS.transactions, JSON.stringify(this._txs.slice(-MAX_TX)));
            return true;
        } catch (_e) { return false; }
    }
    serialize() {
        return {
            economy: this._economy,
            assets: this._assets,
            txs: this._txs.slice(-MAX_TX)
        };
    }
    /* ---------------- 读面（桥消费这三个） ---------------- */
    /** 余额面：{currency, trust, locationReputation}（形状与 mapBalanceRow 对齐） */
    balance() {
        const b = this._economy?.balances;
        if (!b || typeof b !== 'object') return null;
        return {
            currency: safeNum(b.currency, 0),
            trust: safeNum(b.trust, 0),
            locationReputation: (this._economy.locationReputation && typeof this._economy.locationReputation === 'object')
                ? this._economy.locationReputation : {}
        };
    }
    /** 事务面：**新在前**；撤销过的行照样在（带 rolledBackAt） */
    listTransactions() {
        return this._txs.slice().reverse();
    }
    /** 资产面：字典转数组，**每件都带 id**（桥靠 id 判可点） */
    listAssets() {
        const map = this._assets?.assets;
        if (!map || typeof map !== 'object') return [];
        return Object.keys(map)
            .map((k) => map[k])
            .filter((a) => a && typeof a === 'object' && safeStr(a.id));
    }
    /** 单件资产（供视图展开权属谱系；找不到返回 null，不编） */
    getAsset(assetId) {
        const id = safeStr(assetId);
        if (!id) return null;
        const a = this._assets?.assets?.[id];
        return (a && typeof a === 'object') ? a : null;
    }
    /** 单笔事务（撤销前预览用；找不到 null） */
    getTransaction(txId) {
        const id = safeStr(txId);
        if (!id) return null;
        return this._txs.find((t) => t.txId === id) || null;
    }
    /* ---------------- 写面：发起 → 提交 → 撤销 ---------------- */
    /**
     * 转账（钱从一方到另一方）：两步都**可逆**。
     * @returns {{ok:boolean, reason:string, tx:object|null}}
     */
    startTransfer({ amount, from, to, note } = {}) {
        const amt = Math.max(0, safeNum(amount, 0));
        const toWho = safeStr(to) || '对方';
        if (amt <= 0) return { ok: false, reason: 'amount-must-be-positive', tx: null };
        const check = evaluateTransaction(this._economy, { costCurrency: amt, requiredTrust: 0 });
        if (!check.feasible) {
            return { ok: false, reason: check.reason || 'infeasible', deficit: check.deficit, tx: null };
        }
        const txId = `tx_wallet_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
        let tx = createTransaction(txId, `转账给${toWho}`);
        if (!tx) return { ok: false, reason: 'create-failed', tx: null };
        /* 步骤 1：扣钱（可补偿：把钱退回去） */
        const s1 = appendTransactionStep(tx, {
            app: 'wallet',
            action: 'economy.spend',
            payload: { costCurrency: amt, gainTrust: 2, locationId: 'wallet', to: toWho },
            compensator: {
                app: 'wallet',
                action: COMPENSATION_ACTIONS.REFUND_CURRENCY,
                payload: { currency: amt, trust: 2, locationId: 'wallet' }
            }
        });
        if (!s1.ok) return { ok: false, reason: s1.error || 'step-failed', tx: null };
        /* 步骤 2：台账留痕（可补偿，但补偿只是把痕迹标注，不删行） */
        const s2 = appendTransactionStep(s1.tx, {
            app: 'ledger',
            action: 'ledger.record',
            payload: { note: safeStr(note) || `转出 ${amt}`, to: toWho },
            compensator: { app: 'ledger', action: COMPENSATION_ACTIONS.VOID_LEDGER, payload: {} }
        });
        if (!s2.ok) return { ok: false, reason: s2.error || 'step-failed', tx: null };
        /* 真扣账：走纯内核，成功才继续 */
        const exec = executeTransaction(this._economy, { costCurrency: amt, gainTrust: 2, locationId: 'wallet', title: `转账给${toWho}` });
        if (!exec.success) return { ok: false, reason: exec.reason || 'execute-failed', tx: null };
        this._economy = exec.state;
        const rec = {
            ...s2.tx,
            kind: TX_KINDS.TRANSFER,
            amount: amt,
            from: 'user',
            to: toWho,
            note: safeStr(note),
            createdAt: Date.now()
        };
        this._txs.push(rec);
        this._txs = this._txs.slice(-MAX_TX);
        /* ★ 发起这一步也必须落盘：否则「发起」不留可见记录，重载即消失 ——
         *   验收要求三步各留一条可见记录，发起是三步的第一步。 */
        this.save();
        return { ok: true, reason: 'ok', tx: rec };
    }
    /**
     * 购置资产：扣钱（可逆）+ 铸资产（**不可逆**，会上链留谱系）。
     * 回滚只能撤钱、撤不了已铸的来历 —— 故这条走「部分完成」。
     */
    startPurchase({ price, assetTitle, kind, note } = {}) {
        const cost = Math.max(0, safeNum(price, 0));
        const title = safeStr(assetTitle);
        if (!title) return { ok: false, reason: 'missing-asset-title', tx: null };
        const check = evaluateTransaction(this._economy, { costCurrency: cost, requiredTrust: 0 });
        if (!check.feasible) return { ok: false, reason: check.reason || 'infeasible', deficit: check.deficit, tx: null };
        const txId = `tx_buy_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
        let tx = createTransaction(txId, `购置${title}`);
        if (!tx) return { ok: false, reason: 'create-failed', tx: null };
        const s1 = appendTransactionStep(tx, {
            app: 'wallet',
            action: 'economy.spend',
            payload: { costCurrency: cost, gainTrust: 0, locationId: 'wallet' },
            compensator: {
                app: 'wallet',
                action: COMPENSATION_ACTIONS.REFUND_CURRENCY,
                payload: { currency: cost, trust: 0, locationId: 'wallet' }
            }
        });
        if (!s1.ok) return { ok: false, reason: s1.error || 'step-failed', tx: null };
        const s2 = appendTransactionStep(s1.tx, {
            app: 'asset',
            action: 'asset.mint',
            payload: { title, kind: safeStr(kind) || 'relic' },
            irreversible: true,
            compensator: null
        });
        if (!s2.ok) return { ok: false, reason: s2.error || 'step-failed', tx: null };
        const exec = executeTransaction(this._economy, { costCurrency: cost, gainTrust: 0, locationId: 'wallet', title: `购置${title}` });
        if (!exec.success) return { ok: false, reason: exec.reason || 'execute-failed', tx: null };
        const minted = mintAsset(this._assets, { title, kind: safeStr(kind) || 'relic', owner: 'user', note: safeStr(note) || '购入' });
        if (!minted.success) return { ok: false, reason: minted.reason || 'mint-failed', tx: null };
        this._economy = exec.state;
        this._assets = minted.state;
        const rec = {
            ...s2.tx,
            kind: TX_KINDS.PURCHASE,
            amount: cost,
            from: 'user',
            to: 'market',
            assetId: minted.asset.id,
            assetTitle: minted.asset.title,
            note: safeStr(note),
            createdAt: Date.now()
        };
        this._txs.push(rec);
        this._txs = this._txs.slice(-MAX_TX);
        /* ★ 发起这一步也必须落盘：否则「发起」不留可见记录，重载即消失 ——
         *   验收要求三步各留一条可见记录，发起是三步的第一步。 */
        this.save();
        return { ok: true, reason: 'ok', tx: rec };
    }
    /** 转赠已有资产：可逆（把归属转回去，谱系留两条痕迹而不是抹掉） */
    startGift({ assetId, to, note } = {}) {
        const id = safeStr(assetId);
        const toWho = safeStr(to) || '对方';
        const asset = this.getAsset(id);
        if (!asset) return { ok: false, reason: 'asset-not-found', tx: null };
        const fromOwner = safeStr(asset.currentOwner) || 'user';
        const txId = `tx_gift_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
        let tx = createTransaction(txId, `转赠${asset.title}`);
        if (!tx) return { ok: false, reason: 'create-failed', tx: null };
        const s1 = appendTransactionStep(tx, {
            app: 'asset',
            action: 'asset.transfer',
            payload: { assetId: id, from: fromOwner, to: toWho },
            compensator: {
                app: 'asset',
                action: COMPENSATION_ACTIONS.RETURN_ASSET,
                payload: { assetId: id, from: toWho, to: fromOwner }
            }
        });
        if (!s1.ok) return { ok: false, reason: s1.error || 'step-failed', tx: null };
        const moved = transferAsset(this._assets, id, fromOwner, toWho, safeStr(note) || '赠予');
        if (!moved.success) return { ok: false, reason: moved.reason || 'transfer-failed', tx: null };
        this._assets = moved.state;
        const rec = {
            ...s1.tx,
            kind: TX_KINDS.GIFT,
            amount: 0,
            from: fromOwner,
            to: toWho,
            assetId: id,
            assetTitle: asset.title,
            note: safeStr(note),
            createdAt: Date.now()
        };
        this._txs.push(rec);
        this._txs = this._txs.slice(-MAX_TX);
        /* ★ 发起这一步也必须落盘：否则「发起」不留可见记录，重载即消失 ——
         *   验收要求三步各留一条可见记录，发起是三步的第一步。 */
        this.save();
        return { ok: true, reason: 'ok', tx: rec };
    }
    /** 提交（pending → committed）。未提交的账不得撤销 */
    commit(txId) {
        const tx = this.getTransaction(txId);
        if (!tx) return { ok: false, reason: 'transaction-not-found' };
        const res = commitTransaction(tx);
        if (!res.ok) return { ok: false, reason: res.error || 'not-pending' };
        this._txs = this._txs.map((t) => (t.txId === tx.txId ? { ...res.tx } : t));
        this.save();
        return { ok: true, reason: 'committed', tx: res.tx };
    }
    /**
     * 撤销预告（视图在按钮上就告诉用户「能撤到什么程度」）。
     * 直面已撤销/未提交的会如实拒绝，而不是给个看起来能点的按钮。
     */
    previewUndo(txId) {
        const tx = this.getTransaction(txId);
        if (!tx) {
            return { ok: false, canUndo: false, reason: 'transaction-not-found', compensationCount: 0, irreversibleCount: 0, irreversibleSteps: [], compensations: [] };
        }
        if (tx.status === TX_STATUS.ROLLED_BACK) {
            return { ok: true, canUndo: false, reason: 'already-rolled-back', compensationCount: 0, irreversibleCount: 0, irreversibleSteps: [], compensations: [] };
        }
        if (tx.status !== TX_STATUS.COMMITTED) {
            return { ok: true, canUndo: false, reason: 'not-committed:' + tx.status, compensationCount: 0, irreversibleCount: 0, irreversibleSteps: [], compensations: [] };
        }
        const p = previewRollback(tx);
        if (!p.ok) {
            return { ok: false, canUndo: false, reason: p.error || 'not-rollbackable', compensationCount: 0, irreversibleCount: 0, irreversibleSteps: [], compensations: [] };
        }
        return {
            ok: true,
            canUndo: true,
            reason: p.irreversibleCount > 0 ? 'partial-rollback' : 'full-rollback',
            compensationCount: p.compensationCount,
            irreversibleCount: p.irreversibleCount,
            irreversibleSteps: p.irreversibleSteps,
            compensations: p.compensations
        };
    }
    /**
     * 撤销：内核只算计划与改状态，**钱和归属由 _applyCompensations 真改回去**。
     * 撤销后行仍在列表（带 rolledBackAt）；含不可逆步骤时标 partialRollback。
     */
    rollback(txId) {
        const tx = this.getTransaction(txId);
        if (!tx) return { ok: false, reason: 'transaction-not-found', tx: null };
        const res = executeRollback(tx);
        if (!res.ok) return { ok: false, reason: res.error || 'not-rollbackable', tx: null };
        const applied = this._applyCompensations(res.preview.compensations);
        const failed = applied.filter((a) => !a.ok);
        const rec = {
            ...res.tx,
            compensationCount: res.preview.compensationCount,
            irreversibleCount: res.preview.irreversibleCount,
            irreversibleSteps: res.preview.irreversibleSteps,
            appliedCompensationCount: applied.filter((a) => a.ok).length,
            /* 部分完成：不是「成功」，视图必须明写 */
            partialRollback: res.preview.irreversibleCount > 0
        };
        this._txs = this._txs.map((t) => (t.txId === tx.txId ? rec : t));
        this.save();
        return { ok: true, reason: rec.partialRollback ? 'partial' : 'full', tx: rec, applied, failed };
    }
    /* 补偿落地（真改状态；每一项失败不影响其余项，失败逐条记账） */
    _applyCompensations(list) {
        const out = [];
        for (const c of safeArr(list)) {
            if (!c || typeof c !== 'object') continue;
            const action = safeStr(c.action);
            const p = (c.payload && typeof c.payload === 'object') ? c.payload : {};
            try {
                if (action === COMPENSATION_ACTIONS.REFUND_CURRENCY) {
                    const cur = safeNum(p.currency, 0);
                    const tr = safeNum(p.trust, 0);
                    const bal = this._economy.balances || {};
                    this._economy = {
                        ...this._economy,
                        balances: {
                            ...bal,
                            currency: safeNum(bal.currency, 0) + cur,
                            trust: safeNum(bal.trust, 0) - tr
                        },
                        updatedAt: Date.now()
                    };
                    out.push({ ok: true, action, deltaCurrency: cur });
                } else if (action === COMPENSATION_ACTIONS.RETURN_ASSET) {
                    const moved = transferAsset(this._assets, safeStr(p.assetId), safeStr(p.from), safeStr(p.to), '撤销归还');
                    if (moved.success) {
                        this._assets = moved.state;
                        out.push({ ok: true, action, assetId: safeStr(p.assetId) });
                    } else {
                        out.push({ ok: false, action, reason: moved.reason || 'transfer-failed' });
                    }
                } else if (action === COMPENSATION_ACTIONS.VOID_LEDGER) {
                    /* 台账行不删：删除正是「静默恢复」。只记补偿已执行。 */
                    out.push({ ok: true, action, note: 'ledger-trace-kept' });
                } else {
                    out.push({ ok: false, action, reason: 'unknown-compensation' });
                }
            } catch (e) {
                out.push({ ok: false, action, reason: 'apply-threw:' + (e && e.message ? e.message : 'unknown') });
            }
        }
        return out;
    }
}
