/* ========================================================
 * wallet-app.js — [v2.49.0] 钱袋 App 控制器
 *
 * 消费上游记忆插件的金钱账面（`window.lonsha_memory_bridge_v1.snapshot.moneyLedger`），
 * 把「现在有多少钱 / 最近怎么花的」做成手机里可查询的界面，并把
 * 「当前账上金额」交给生成侧（GENERATE_BEFORE_COMBINE_PROMPTS）。
 *
 * 三条纪律（与 place-app.js 同规格，照抄其消费面先例）：
 *   ① 只读：只取桥的 snapshot（对象）/ refresh()，绝不写上游任何状态；
 *   ② 不抛：桥未装 / 无快照 / 旧版无账面 / 账面畸形，一律降级为归因文案；
 *   ③ 不猜：拿不到就如实说拿不到（五态分开报），绝不编造金额顶替。
 *
 * 【为什么不在实例里缓存读数】本 App 的读数**每次现取**：
 *   会话隔离靠 storage 的 `/^wallet_/` 键（设置），而钱账面本身随会话变——
 *   任何实例级缓存都会在换会话/删楼回滚后变成陈旧数据（本仓治理过多轮的形态）。
 *   故 onChatChanged() 只丢弃上一次的探针归因，不持有任何数据副本。
 * ======================================================== */
'use strict';
import { defaultWalletSettings, readWalletFace, projectWallet, walletPromptBlock } from './wallet-data.js';
import { WalletView } from './wallet-view.js';
import { readPushProbe } from '../../config/world-bridge.js';
/* [v4.99.3 · R11-X2] 交易与资产真源（发起/提交/撤销）。三把键（ue_/la_/et_）的
 *   读写**只此一处**；桥（config/economy-face-bridge.js）只做纯映射，视图不 import 桥。 */
import { EconomyStore } from './economy-store.js';
import { mergeEconomyFaces, previewUndo as bridgePreviewUndo } from '../../config/economy-face-bridge.js';
/** 设置键：必须匹配 config/storage.js 的 CHAT_DATA_PATTERNS 中 `/^wallet_/`，否则跨会话串味 */
const SETTINGS_KEY = 'wallet_settings_v1';
export class WalletApp {
    constructor(phoneShell, storage) {
        this.phoneShell = phoneShell;
        this.storage = storage;
        this.view = new WalletView(this);
        /* [v4.99.3 · R11-X2] 交易与资产真源。构造期不读盘（storage 可能在 App 构造时
         *   尚未就绪）：首次 economyFace() / 写操作前经 _ensureEconomyStore() 懒加载一次。 */
        this._economyStore = null;
        this._economyLoaded = false;
        /** 最近一次探针归因（供诊断显示；不参与渲染数据） */
        this._lastProbe = null;
        this._hooked = false;
        this._initHook();
    }
    /* ========== 设置（随会话隔离，容错读写） ========== */
    getSettings() {
        try {
            const raw = this.storage?.get?.(SETTINGS_KEY, false);
            const obj = raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : {};
            return { ...defaultWalletSettings(), ...(obj && typeof obj === 'object' ? obj : {}) };
        } catch (_e) { return defaultWalletSettings(); }
    }
    saveSettings(patch) {
        try {
            const next = { ...this.getSettings(), ...(patch || {}) };
            this.storage?.set?.(SETTINGS_KEY, JSON.stringify(next), false);
            return next;
        } catch (_e) { return this.getSettings(); }
    }
    _win() {
        try { return (typeof window !== 'undefined') ? window : globalThis; } catch (_e) { return globalThis; }
    }
    /**
     * 探针：把「桥在不在 / 有没有快照」取出来交给纯内核归因（本方法不做任何判断）。
     * 桥快照是**推**型（生成管线里 refresh 覆盖），故对象缺失时退而调 refresh()。
     * @returns {{mounted:boolean, hasSnapshot:boolean, snapshot:object|null}}
     */
    probeBridge() {
        const p = readPushProbe(this._win());
        return { mounted: p.mounted, hasSnapshot: p.hasSnapshot, snapshot: p.snapshot };
    }
    /** 来源归因（五态）：{state, reason, ledger, text} */
    walletFace() {
        const probe = this.probeBridge();
        this._lastProbe = probe;
        return readWalletFace(probe);
    }
    /** 一次取齐「归因 + 投影」（视图用它，保证同一次读数的脸与数据是同一份） */
    projection() {
        const face = this.walletFace();
        const proj = projectWallet(face.ledger, { maxEntries: 30 });
        return { face, proj };
    }
    /** 一行总述（供视图/host 诊断） */
    summaryLine() {
        try {
            const pkg = this.projection();
            const face = pkg.face, proj = pkg.proj;
            if (face.reason !== 'ready' && face.reason !== 'empty') return face.text;
            const n = (v) => (v === null || v === undefined) ? '—' : String(v);
            return `账户 ${n(proj.count)} 个 · 流水 ${n(proj.txCount)} 笔`;
        } catch (_e) { return '钱账总述失败（已降级）'; }
    }
    /**
     * 生成侧一致性块：把「当前账上金额」交给生成侧，
     * 让正文里的钱数与记忆插件记的账**是同一笔**（无内容返回 ''，不产生空块）。
     */
    promptBlock() {
        try {
            const s = this.getSettings();
            if (!s.injectToPrompt) return '';
            const maxLines = Math.max(1, Number(s.maxInject) || 6);
            return walletPromptBlock(this.walletFace().ledger, { maxLines });
        } catch (_e) { return ''; }
    }
    /** 挂生成前钩子（构造期一次；宿主无 eventSource 时静默不挂，不影响 App 本体） */
    _initHook() {
        if (this._hooked) return;
        try {
            const ctx = this._win().SillyTavern?.getContext?.();
            const es = ctx?.eventSource;
            const et = ctx?.event_types;
            if (!es || !et?.GENERATE_BEFORE_COMBINE_PROMPTS) return;
            es.on(et.GENERATE_BEFORE_COMBINE_PROMPTS, (payload) => {
                // 注入失败绝不阻断生成：本块是「一致性约束」，不是必需上下文
                try {
                    if (!payload || !Array.isArray(payload.prompt)) return;
                    const block = this.promptBlock();
                    if (block) payload.prompt.push({ role: 'system', content: block });
                } catch (_e) { /* 静默失败：生成照常进行 */ }
            });
            this._hooked = true;
        } catch (_e) { /* 宿主无事件源：不挂钩子 */ }
    }
    /**
     * 换会话 / 清数据：本 App **不持有任何读数副本**，故无需重绑数据层；
     * 仅丢弃上一次的探针归因（那是旧会话的读数），下一次渲染现取。
     */
    onChatChanged() {
        this._lastProbe = null;
        /* [v4.99.3 · R11-X2] 换会话：真源作废并重挂（三键随会话隔离，不带着上一角色的账本） */
        this._economyStore = null;
        this._economyLoaded = false;
    }

    /* ══════════ [v4.99.3 · R11-X2] 交易与资产面（发起 → 提交 → 撤销） ══════════
     * 【为什么读盘懒加载】storage 在 App 构造期可能尚未可用；构造期读盘会静默拿到
     *   空账并把它当真（最贵的形态）。故首次真正要用时才建实例并读一次。
     * 【为什么视图不碰桥】与 X1/X6 同款分工：视图经 economyFace() 拿读数，
     *   不 import 桥、不引用 subsystems（F 类判据用正则钉住）。 */
    /** 真源实例（懒建 + 懒读一次；存储不可用 ⇒ 实例仍可用，只是不落盘） */
    _ensureEconomyStore() {
        if (!this._economyStore) {
            try { this._economyStore = new EconomyStore(this.storage); } catch (_e) { this._economyStore = null; return null; }
        }
        if (!this._economyLoaded) {
            try { this._economyStore.restore(); } catch (_e) { /* 读失败：保持空态，不假装读到 */ }
            this._economyLoaded = true;
        }
        return this._economyStore;
    }
    /** 三面合并读（视图唯一入口；真源缺席时 faces 全 null + mustShowWhy） */
    economyFace() {
        const store = this._ensureEconomyStore();
        if (!store) {
            return { faces: { balances: null, transactions: null, assets: null },
                     counts: { balances: 0, transactions: 0, assets: 0 },
                     notes: { why: 'no_store', mustShowWhy: true, perFace: {} } };
        }
        return mergeEconomyFaces(store);
    }
    /** 撤销预告（视图在按钮旁就写明「能撤到什么程度」；含不可逆步骤时明写只能部分撤） */
    economyPreviewUndo(txId) {
        const store = this._ensureEconomyStore();
        if (!store) return { ok: false, canUndo: false, reason: 'no_store', compensationCount: 0, irreversibleCount: 0, irreversibleSteps: [], compensations: [] };
        try { return store.previewUndo(txId); }
        catch (_e) { return { ok: false, canUndo: false, reason: 'preview-threw', compensationCount: 0, irreversibleCount: 0, irreversibleSteps: [], compensations: [] }; }
    }
    /** 单件资产详情（含权属谱系；视图展开用） */
    economyGetAsset(assetId) {
        const store = this._ensureEconomyStore();
        if (!store) return null;
        try { return store.getAsset(assetId); } catch (_e) { return null; }
    }
    /* -------- 写口：发起 -------- */
    /** 发起转账（真扣账 → 返 tx；失败返 reason，视图转归因文案，不抛） */
    economyStartTransfer(spec) {
        const store = this._ensureEconomyStore();
        if (!store) return { ok: false, reason: 'no_store', tx: null };
        try { return store.startTransfer(spec || {}); }
        catch (e) { return { ok: false, reason: 'start-threw:' + (e && e.message ? e.message : 'unknown'), tx: null }; }
    }
    /** 发起购置（扣钱可逆 + 铸资产不可逆 ⇒ 撤销走「部分完成」） */
    economyStartPurchase(spec) {
        const store = this._ensureEconomyStore();
        if (!store) return { ok: false, reason: 'no_store', tx: null };
        try { return store.startPurchase(spec || {}); }
        catch (e) { return { ok: false, reason: 'start-threw:' + (e && e.message ? e.message : 'unknown'), tx: null }; }
    }
    /** 发起转赠（改归属并留谱系） */
    economyStartGift(spec) {
        const store = this._ensureEconomyStore();
        if (!store) return { ok: false, reason: 'no_store', tx: null };
        try { return store.startGift(spec || {}); }
        catch (e) { return { ok: false, reason: 'start-threw:' + (e && e.message ? e.message : 'unknown'), tx: null }; }
    }
    /* -------- 写口：提交 / 撤销 -------- */
    /** 提交事务（pending → committed；未提交的账不得撤销） */
    economyCommit(txId) {
        const store = this._ensureEconomyStore();
        if (!store) return { ok: false, reason: 'no_store' };
        try { return store.commit(txId); } catch (_e) { return { ok: false, reason: 'commit-threw' }; }
    }
    /** 撤销（真改余额与归属，行**留在列表里**带 rolledBackAt；含不可逆步骤标 partial） */
    economyRollback(txId) {
        const store = this._ensureEconomyStore();
        if (!store) return { ok: false, reason: 'no_store', tx: null };
        try { return store.rollback(txId); }
        catch (e) { return { ok: false, reason: 'rollback-threw:' + (e && e.message ? e.message : 'unknown'), tx: null }; }
    }
    /* ★ 不提供 economySaveAll()：发起/提交/撤销三处各自落盘，外部没有「手动存一次」的场景。
     *   留一个零调用的写口正是本仓在治的形态（写了但没人用） —— 死方法门当场会抓。 */
    render() {
        this.view.render(this.phoneShell?.layerHost?.('wallet-main') || this.phoneShell?.screen);
    }
}
export default WalletApp;
