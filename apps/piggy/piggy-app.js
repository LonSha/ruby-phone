/* ========================================================
 * piggy-app.js — [v3.25.0] 存钱罐 App 控制器
 * 照抄 focus-app 规格：取数 → 纯函数 → 视图；注入走表驱动。
 *
 * 缝合自 EPhone·xINOVO（js/modules/piggy_bank.js）。源的操作面远大于本仓能承载的：
 *   它自带商品下单结算（executeCharacterPurchase：改 chat 消息、写 character.walletLedger、
 *   失败整体回滚）、亲属卡赠送与响应流程（家人卡事件流）、2MB 封面上传。
 * 本仓这些各有归属（消息归微信/日记/剧场，账户与资产归 ledger/asset，用户钱包的仲裁源是
 *   微信零钱），故此处只取**罐本身**：余额 → 记一笔 → 删一笔 → 亲属卡额度周期。
 *   不替用户发消息、不碰角色会话数据、不扣微信零钱。
 *
 * 【为什么罐不接微信零钱】catbox 与 honey 扣的是微信零钱（`spendWalletBalance`），
 *   那条线已有单一仲裁源。本件若也去扣它，同一笔钱会有两个记账者 ⇒ 本仓最贵的
 *   「不报错、只错数据」。所以存钱罐是**另一笔钱**（用户自己攒的），互不干涉，界面文案也写明。
 * ======================================================== */
'use strict';
import {
    PIGGY_REASONS, DEFAULT_PIGGY_BALANCE_CENTS,
    defaultPiggySettings, normalizePiggySettings,
    normalizePiggyState, applyTransaction, removeTransactions,
    createFamilyCard, refreshFamilyCards, projectPiggy,
    readPiggyFace, yuanToCents, piggyPromptBlock,
} from './piggy-data.js';
import { PiggyView } from './piggy-view.js';

/* 会话键：必须匹配 config/storage.js 的 CHAT_DATA_PATTERNS 中 `/^piggy_/`，否则跨会话串味 */
const SETTINGS_KEY = 'piggy_settings';
const STATE_KEY = 'piggy_state';

/* [v4.104.0 · R13-O8] 删流水/销卡先落回收站（唯一软删实现在 config/recycle-bin.js）。
 *   流水删除会**反向调回余额**（见 removeTransactions 的注释）：恢复时余额必须跟着反向，
 *   否则「流水分回来了、罐里的钱没回来」—— 这是本项里最容易做半截的一处，故恢复走
 *   同一个状态归一化出口，不手写一份余额加减。 */
import * as recycleBin from '../../config/recycle-bin.js';

export class PiggyApp {
    constructor(phoneShell, storage) {
        this.shell = phoneShell;
        this.storage = storage;
        this.settings = { ...defaultPiggySettings() };
        this.state = null;
        this.face = PIGGY_REASONS.storage_absent;
        this._proj = null;
        /* 运行态（不落盘）：本次渲染内是否做过额度刷新，供视图提示用 */
        this._lastRefreshedCards = 0;
        /* [v4.104.0 · R13-O8] 向回收站登记两个写回口（流水 / 亲属卡）。**登记必须在构造期**：
         *   回收站是模块级注册表，App 打开过一次才登记得上；没登记的 App 恢复时会明确报
         *   restorer-missing（可读原因），而不是静默失败。 */
        recycleBin.registerRestorer('piggy_tx', (payload, meta) => this._restoreTxFromBin(payload, meta));
        recycleBin.registerRestorer('piggy_card', (payload, meta) => this._restoreCardFromBin(payload, meta));
        this._view = null;
        this._hookBound = false;
        this._loadSettings();
    }

    _win() {
        try { return (typeof window !== 'undefined') ? window : globalThis; } catch (_e) { return globalThis; }
    }

    /* ---------- 取数 ---------- */

    /**
     * 现取（每次 render / refresh 都重取，不持跨轮副本 —— 防陈旧）。
     * 换会话后由 index.js 的 REBIND 表调 onChatChanged()，走的也是这一条路。
     */
    probe() {
        let storageOk = !!this.storage;
        let raw = null;
        try {
            raw = this.storage ? this.storage.get(STATE_KEY) : null;
            const obj = (typeof raw === 'string') ? JSON.parse(raw) : raw;
            this.state = normalizePiggyState(obj);
        } catch (_e) {
            storageOk = false;
            this.state = null;
        }
        /* 额度周期刷新：只在**取数时**做（源同义，它也在 setupPiggyBankApp 入口刷），
         *   且要到期的才动 —— refreshed 为 0 时状态是逐字段重建的新对象，
         *   与存储内容等价，不必回写，避免「每开一次就写一次盘」。 */
        if (storageOk && this.state && this.state.cards.length) {
            const r = refreshFamilyCards(this.state, Date.now());
            this._lastRefreshedCards = r.refreshed;
            if (r.refreshed > 0) {
                this.state = r.state;
                this._write(this.state);
            }
        } else {
            this._lastRefreshedCards = 0;
        }
        const hasState = !!(this.state && Array.isArray(this.state.transactions)
            && (this.state.cards.length > 0 || this.state.transactions.length > 0
                || this.state.balanceCents !== DEFAULT_PIGGY_BALANCE_CENTS));
        this.face = readPiggyFace({ storageOk, hasState });
        this._proj = storageOk ? projectPiggy(this.state, Date.now()) : null;
    }

    faceReason() { return this.face; }
    projection() { return this._proj; }
    lastRefreshedCards() { return this._lastRefreshedCards; }
    defaultBalanceCents() { return DEFAULT_PIGGY_BALANCE_CENTS; }

    /** 流水（最新在前；数据层已按 unshift 排好）。 */
    transactions() {
        return (this.state && Array.isArray(this.state.transactions)) ? this.state.transactions.slice() : [];
    }

    /** 亲属卡（用户发出的那份，源另一半 receivedFamilyCards 不缝：见 piggy-data 文件头）。 */
    cards() {
        return (this.state && Array.isArray(this.state.cards)) ? this.state.cards.slice() : [];
    }

    /* ---------- 开罐 ---------- */

    /** 开罐：本会话第一次落盘。已开过则原样返回 false（不覆盖用户数据）。 */
    openPot() {
        if (this.face === PIGGY_REASONS.ready) return false;
        this.state = normalizePiggyState(null);
        this._write(this.state);
        this.probe();
        if (this._view) this._view.refresh();
        return true;
    }

    /* ---------- 记账 ---------- */

    /**
     * 记一笔。金额从「元」收进来（视图是元，数据层是分），非法一律拒绝并返回 false。
     * 返回 true 才算记上（视图据此决定要不要清空输入框）。
     */
    addTransaction(opts) {
        const o = (opts && typeof opts === 'object') ? opts : {};
        const cents = yuanToCents(o.amountYuan);
        if (cents === null || cents <= 0) return false;
        const base = this.state || normalizePiggyState(null);
        const r = applyTransaction(base, {
            kind: o.kind === 'income' ? 'income' : 'expense',
            amountCents: cents,
            remark: o.remark,
            source: '存钱罐',
            time: Date.now(),
        });
        if (!r) return false;
        this.state = r.state;
        this._write(this.state);
        this.probe();
        return true;
    }

    /** 删一笔（反向调回余额由数据层负责）。返回实际删掉的条数。 */
    removeTransaction(id) {
        if (!this.state) return 0;
        const sid = String(id);
        const tx = Array.isArray(this.state.transactions)
            ? (this.state.transactions.find((t) => String(t?.id || '') === sid) || null)
            : null;
        if (tx) {
            recycleBin.softDelete(this.storage, {
                app: 'piggy_tx',
                kind: 'transaction',
                id: sid,
                label: String(tx?.title || tx?.note || tx?.category || '').slice(0, 40),
                payload: tx,
                meta: { index: this.state.transactions.indexOf(tx) },
                hard: () => {}
            });
        }
        const r = removeTransactions(this.state, [String(id)]);
        if (r.removed > 0) {
            this.state = r.state;
            this._write(this.state);
            this.probe();
        }
        return r.removed;
    }

    /** [v4.104.0 · R13-O8] 回收站写回口：流水放回并**反向调回余额** */
    _restoreTxFromBin(payload, meta) {
        if (!payload || typeof payload !== 'object') return false;
        const sid = String(payload?.id || '').trim();
        if (!sid) return false;
        const base = this.state || normalizePiggyState(null);
        const txs = Array.isArray(base.transactions) ? base.transactions.slice() : [];
        const dup = txs.find((t) => String(t?.id || '') === sid);
        if (dup) {
            /* [v4.121.0 · R14-O6] 幂等重放 vs 真冲突（见 config/recycle-bin.js restoreConflict）。
             *   ★ 这里必须**在归一化之前**返回：归一化会按流水重算余额，
             *   若先归一化再报冲突，余额已经被动过了 —— 用户看到「恢复失败」但钱变了。 */
            if (recycleBin.samePayload(dup, payload)) return true;
            return recycleBin.restoreConflict();
        }
        const at = Number(meta && meta.index);
        if (Number.isFinite(at) && at >= 0 && at <= txs.length) txs.splice(at, 0, payload);
        else txs.push(payload);
        /* 走归一化出口而不是手写余额加减：归一化会按流水重算余额，
         *   这正是删除侧反向调余额的同一套口径（同一件事只许一个实现）。 */
        this.state = normalizePiggyState({ ...base, transactions: txs });
        this._write(this.state);
        this.probe();
        return true;
    }

    /* ---------- 亲属卡 ---------- */

    /** 开一张亲属卡。额度非法（非数 / ≤0）时回落 5000 元（源同义）。 */
    addFamilyCard(opts) {
        const o = (opts && typeof opts === 'object') ? opts : {};
        const limitCents = yuanToCents(o.limitYuan);
        const base = this.state || normalizePiggyState(null);
        const card = createFamilyCard({
            bankName: o.bankName,
            cardHolder: o.cardHolder,
            targetCharName: o.targetCharName,
            limitCents: (limitCents === null || limitCents <= 0) ? 500000 : limitCents,
            refreshPeriod: o.refreshPeriod,
            refreshDays: o.refreshDays,
        }, Date.now());
        this.state = { ...base, cards: base.cards.concat([card]) };
        this._write(this.state);
        this.probe();
        return card;
    }

    /** 销卡。返回实际销掉的张数。 */
    removeCard(id) {
        if (!this.state) return 0;
        const sid = String(id);
        const targetCard = this.state.cards.find((c) => c.id === sid) || null;
        if (targetCard) {
            recycleBin.softDelete(this.storage, {
                app: 'piggy_card',
                kind: 'card',
                id: sid,
                label: String(targetCard?.bankName || targetCard?.cardHolder || '').slice(0, 40),
                payload: targetCard,
                meta: { index: this.state.cards.indexOf(targetCard) },
                hard: () => {}
            });
        }
        const kept = this.state.cards.filter((c) => c.id !== sid);
        const removed = this.state.cards.length - kept.length;
        if (removed > 0) {
            this.state = { ...this.state, cards: kept };
            this._write(this.state);
            this.probe();
        }
        return removed;
    }

    /** [v4.104.0 · R13-O8] 回收站写回口：亲属卡放回原位 */
    _restoreCardFromBin(payload, meta) {
        if (!payload || typeof payload !== 'object') return false;
        const sid = String(payload?.id || '').trim();
        if (!sid) return false;
        const base = this.state || normalizePiggyState(null);
        const cards = Array.isArray(base.cards) ? base.cards.slice() : [];
        const dup = cards.find((c) => String(c?.id || '') === sid);
        if (dup) {
            /* [v4.121.0 · R14-O6] 幂等重放 vs 真冲突（见 config/recycle-bin.js restoreConflict） */
            if (recycleBin.samePayload(dup, payload)) return true;
            return recycleBin.restoreConflict();
        }
        const at = Number(meta && meta.index);
        if (Number.isFinite(at) && at >= 0 && at <= cards.length) cards.splice(at, 0, payload);
        else cards.push(payload);
        this.state = { ...base, cards };
        this._write(this.state);
        this.probe();
        return true;
    }

    /* ---------- 注入 ---------- */

    /** 生成侧注入块：只注入聚合事实（见 piggy-data.piggyPromptBlock）。 */
    promptBlock() {
        if (!this.settings.injectToPrompt) return '';
        return piggyPromptBlock(this._proj, this.settings);
    }

    summaryLine() {
        if (!this._proj) return '读不到存钱罐';
        if (!this._proj.hasHistory) return '罐里 ' + (this._proj.balanceCents / 100) + ' 元，还没有流水';
        return '罐里 ' + (this._proj.balanceCents / 100) + ' 元 · 本月支出 ' + (this._proj.monthExpenseCents / 100) + ' 元';
    }

    _initHook() {
        if (this._hookBound) return;
        try {
            const ctx = this._win().SillyTavern && this._win().SillyTavern.getContext ? this._win().SillyTavern.getContext() : null;
            const es = ctx ? ctx.eventSource : null;
            const et = ctx ? ctx.event_types : null;
            if (!es || !et || !et.GENERATE_BEFORE_COMBINE_PROMPTS) return;
            es.on(et.GENERATE_BEFORE_COMBINE_PROMPTS, (payload) => {
                try {
                    if (!payload || !Array.isArray(payload.prompt)) return;
                    const blk = this.promptBlock();
                    if (blk) payload.prompt.push({ role: 'system', content: blk });
                } catch (_e) { /* 静默失败：生成照常进行 */ }
            });
            this._hookBound = true;
        } catch (_e) { /* 宿主无事件源：不挂钩子 */ }
    }

    /* ---------- 落盘 ---------- */

    /**
     * 唯一写盘口。写前按 settings.maxTransactions 裁掉最旧的流水
     * （源不裁，但本仓存档随会话走，无界增长会顶到 chatMetadata 的体积上）。
     */
    _write(state) {
        try {
            if (!this.storage) return;
            const keep = this.settings.maxTransactions;
            let next = state;
            if (Array.isArray(state.transactions) && state.transactions.length > keep) {
                next = { ...state, transactions: state.transactions.slice(0, keep) };
                this.state = next;
            }
            this.storage.set(STATE_KEY, next);
        } catch (_e) { /* silent */ }
    }

    _loadSettings() {
        try {
            const raw = this.storage ? this.storage.get(SETTINGS_KEY) : null;
            const obj = (typeof raw === 'string') ? JSON.parse(raw) : raw;
            this.settings = normalizePiggySettings(obj);
        } catch (_e) { this.settings = { ...defaultPiggySettings() }; }
    }

    saveSettings() {
        try {
            if (this.storage) this.storage.set(SETTINGS_KEY, JSON.stringify(this.settings));
        } catch (_e) { /* silent */ }
    }

    /** 改设置里的数值项（视图只给原始输入值，钳制与类型收敛都在这里做）。 */
    patchSettings(patch) {
        this.settings = normalizePiggySettings({ ...this.settings, ...(patch || {}) });
        this.saveSettings();
    }

    /* ---------- 生命周期 ---------- */

    /** 换会话：罐是「本会话的钱」，故只重取读数，不动任何缓存（本身也不持缓存）。 */
    onChatChanged() {
        this._loadSettings();
        this.probe();
        if (this._view) this._view.refresh();
    }

    render() {
        this.probe();
        this._initHook();
        if (!this._view) {
            this._view = new PiggyView(this, this.shell, this.storage);
        }
        this._view.render();
    }
}
