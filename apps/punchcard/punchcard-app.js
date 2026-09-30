/* ========================================================
 * punchcard-app.js — [v3.26.0] 打卡 App 控制器
 * 照抄 focus / piggy / regexfilter 规格：取数 → 纯函数 → 视图；注入走表驱动。
 *
 * 缝合自 MyPhone（src_myphone/punchcard.js）。源的三块操作面本仓不能有（见 punchcard-data 文件头）：
 *   自建 IndexedDB、`fetch` 角色 API 生成作息表（两轮重试）、把世界书拼成上下文。
 * 本件只留**主叫侧的账**：用户填表 → 打卡 → 统计 → 注入事实；零数据库、零网络、零碰会话数据。
 *
 * 【为什么「不替用户叫模型」不等于少了东西】源用模型生成的是「角色那一半作息表」——
 *   那是**生成侧**的活（本机的正文生成本来就走宿主）。本件把事实（今天几项 / 完成几项 /
 *   连续几天 / 还没做哪些）交给生成侧，让角色在**它自己的回合**里回话；
 *   这比在打卡 App 里额外开一个对话框更像本仓（v3250 存钱罐同理：只给事实，不给台词模板）。
 * ======================================================== */
'use strict';
import {
    PUNCH_REASONS, PUNCH_ITEM_KINDS, PUNCH_LIMITS,
    defaultPunchSettings, normalizePunchSettings,
    normalizeCards, createCard, patchItem, removeCard, removeItem,
    projectPunch, streakOf, readPunchFace, pendingItems, punchPromptBlock, dayKey,
} from './punchcard-data.js';
import { PunchcardView } from './punchcard-view.js';

/* 会话键：必须匹配 config/storage.js 的 CHAT_DATA_PATTERNS 中 `/^punchcard_/`，否则跨会话串味 */
const SETTINGS_KEY = 'punchcard_settings';
const CARDS_KEY = 'punchcard_cards';

export class PunchcardApp {
    constructor(phoneShell, storage) {
        this.shell = phoneShell;
        this.storage = storage;
        this.settings = { ...defaultPunchSettings() };
        this.cards = [];
        this.face = PUNCH_REASONS.storage_absent;
        this._proj = null;
        this._view = null;
        this._hookBound = false;
        this._loadSettings();
    }

    _win() {
        try { return (typeof window !== 'undefined') ? window : globalThis; } catch (_e) { return globalThis; }
    }

    /* ---------- 取数 ---------- */

    /** 现取（每次 render / refresh 都重取，不持跨轮副本 —— 防陈旧）。 */
    probe() {
        let storageOk = !!this.storage;
        let raw = null;
        try {
            raw = this.storage ? this.storage.get(CARDS_KEY) : null;
            const obj = (typeof raw === 'string') ? JSON.parse(raw) : raw;
            this.cards = normalizeCards(obj);
        } catch (_e) {
            storageOk = false;
            this.cards = [];
        }
        this.face = readPunchFace({ storageOk, hasCards: this.cards.length > 0 });
        this._proj = storageOk ? projectPunch(this.cards, Date.now()) : null;
    }

    faceReason() { return this.face; }
    projection() { return this._proj; }
    limits() { return PUNCH_LIMITS; }
    itemKinds() { return PUNCH_ITEM_KINDS; }

    cardsList() {
        return Array.isArray(this.cards) ? this.cards.slice() : [];
    }

    /** 今天这张卡的 id（没有则空串）。 */
    todayCardId() {
        const p = this._proj || projectPunch(this.cards, Date.now());
        return p.todayCardId;
    }

    /* ---------- 打卡 ---------- */

    /** 记一张卡（同一天再记会并项）。返回实际加进去的项数。 */
    addCard(opts) {
        const o = (opts && typeof opts === 'object') ? opts : {};
        const r = createCard(this.cards, {
            date: o.date,
            targetName: o.targetName,
            items: o.items,
        }, Date.now());
        if (r.added > 0) {
            this.cards = r.cards;
            this._write(this.cards);
            this.probe();
        }
        return r.added;
    }

    /** 勾选一项（**按 id 定位**，不按下标 —— 见数据层文件头偏离第 2 条）。返回是否真改到。 */
    toggleItem(cardId, itemId, done) {
        const r = patchItem(this.cards, cardId, itemId, { done });
        if (r.changed > 0) {
            this.cards = r.cards;
            this._write(this.cards);
            this.probe();
            return true;
        }
        return false;
    }

    /** 写一项的备注。返回是否真改到。 */
    setItemRemark(cardId, itemId, remark) {
        const r = patchItem(this.cards, cardId, itemId, { remark });
        if (r.changed > 0) {
            this.cards = r.cards;
            this._write(this.cards);
            this.probe();
            return true;
        }
        return false;
    }

    /** 删一张卡。返回实际删掉的张数。 */
    deleteCard(cardId) {
        const r = removeCard(this.cards, cardId);
        if (r.removed > 0) {
            this.cards = r.cards;
            this._write(this.cards);
            this.probe();
        }
        return r.removed;
    }

    /** 删一项。返回实际删掉的条数。 */
    deleteItem(cardId, itemId) {
        const r = removeItem(this.cards, cardId, itemId);
        if (r.removed > 0) {
            this.cards = r.cards;
            this._write(this.cards);
            this.probe();
        }
        return r.removed;
    }

    /* ---------- 注入 ---------- */

    /** 生成侧注入块：只注入聚合事实（见 punchcard-data.punchPromptBlock）。 */
    promptBlock() {
        if (!this.settings.injectToPrompt) return '';
        const proj = this._proj || projectPunch(this.cards, Date.now());
        return punchPromptBlock(proj, this.settings, pendingItems(this.cards, Date.now()));
    }

    summaryLine() {
        const p = this._proj;
        if (!p) return '读不到打卡';
        if (!p.hasAny) return '还没有打卡记录';
        return '连续 ' + p.streak + ' 天 · 今天 ' + p.todayDoneCount + '/' + p.todayItemCount + ' 项';
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

    /** 唯一写盘口。写前按 settings.maxCards 裁掉最旧的卡。 */
    _write(cards) {
        try {
            if (!this.storage) return;
            const keep = this.settings.maxCards;
            let next = cards;
            if (Array.isArray(cards) && cards.length > keep) {
                next = cards.slice(0, keep);
                this.cards = next;
            }
            this.storage.set(CARDS_KEY, next);
        } catch (_e) { /* silent */ }
    }

    _loadSettings() {
        try {
            const raw = this.storage ? this.storage.get(SETTINGS_KEY) : null;
            const obj = (typeof raw === 'string') ? JSON.parse(raw) : raw;
            this.settings = normalizePunchSettings(obj);
        } catch (_e) { this.settings = { ...defaultPunchSettings() }; }
    }

    saveSettings() {
        try {
            if (this.storage) this.storage.set(SETTINGS_KEY, JSON.stringify(this.settings));
        } catch (_e) { /* silent */ }
    }

    patchSettings(patch) {
        this.settings = normalizePunchSettings({ ...this.settings, ...(patch || {}) });
        this.saveSettings();
    }

    /* ---------- 生命周期 ---------- */

    /** 换会话：打卡是「本会话的作息」，故只重取读数，不持跨轮缓存。 */
    onChatChanged() {
        this._loadSettings();
        this.probe();
        if (this._view) this._view.refresh();
    }

    render() {
        this.probe();
        this._initHook();
        if (!this._view) {
            this._view = new PunchcardView(this, this.shell, this.storage);
        }
        this._view.render();
    }
}