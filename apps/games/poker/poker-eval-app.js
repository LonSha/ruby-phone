/* ========================================================
 * poker-eval-app.js — [v4.189.0] 牌型评估 · 控制器
 *
 * 职责：把 poker-eval.js 的纯函数接到「一手牌怎么算」这件事上，
 *   并提供界面要的「算一手、贴一副牌试算」两个口。
 * 为什么不动 poker-data.js 那个 1038 行的类：那个类持 this.state 做
 *   下注轮/盲注/AI/侧池/摊牌，是**有副作用的编排**，本件只包**无副作用**的评估面。
 * 落盘：本件没有需要落盘的读数（评估是一次性的），所以零写盘、零定时器、零网络。
 * ======================================================== */
'use strict';
import {
    SUITS, RANKS, HAND_SCORES, HAND_NAMES, EVAL_LIMITS, EVAL_REJECT,
    createDeck, shuffleDeck, drawCards, combinations, rankFive,
    straightHigh, handLabel, compareHands, evaluateBestHand, formatCards,
} from './poker-eval.js';
import { writeReceipt } from '../../../config/write-receipt.js';

/** 内置一副确定性牌组（不洗，供「试算」用；要随机由调用方传 rng）。 */
const STATE_KEY = 'games_poker_eval_v1';

const DEMO_HAND = [
    { suit: 'spades', value: 10, label: '10' },
    { suit: 'hearts', value: 10, label: '10' },
    { suit: 'clubs', value: 7, label: '7' },
    { suit: 'diamonds', value: 4, label: '4' },
    { suit: 'spades', value: 2, label: '2' }
];

export class PokerEvalApp {
    constructor(shell, storage) {
        this.shell = shell;
        this.storage = storage;
        this._initFromStorage();
    }

    /**
     * 构造与换会话共用同一条重取路径（v4.199.0 从构造函数抽出，只为让 onChatChanged 不抄一份）。
     * 读的是**本会话**的存储快照，所以换会话 = 回构造态再读一次。
     */
    _initFromStorage() {
        this.lastResult = null;
        this._picked = this._readSnapshot() || [];
        this._view = null;
    }

    /**
     * [v4.199.0] 换会话：试算牌组是**会话数据**（落盘键按会话隔离），
     * 不重取的话，上一会话的读数会原样出现在新会话里（v255 的 A5 盯的就是这个口）。
     */
    onChatChanged() {
        this._initFromStorage();
    }


    /** 算一手（5~7 张）。少五张 / 有坏牌都拒答。算成功即存快照。 */
    evaluate(cards) {
        const r = evaluateBestHand(cards);
        if (!r) return { ok: false, reason: EVAL_REJECT.notEnoughCards };
        this.lastResult = r;
        this._picked = Array.isArray(cards) ? cards.slice() : [];
        this._saveSnapshot();
        return { ok: true, reason: null, result: r };
    }

    _readSnapshot() {
        try {
            const raw = this.storage ? this.storage.get(STATE_KEY) : null;
            if (typeof raw !== 'string') return null;
            const parsed = JSON.parse(raw);
            return Array.isArray(parsed) ? parsed : null;
        } catch (_e) { return null; }
    }

    _saveSnapshot() {
        try {
            if (!this.storage) return false;
            const r = writeReceipt(this.storage, STATE_KEY, JSON.stringify(this._picked));
            return r.saved === true;
        } catch (_e) { return false; }
    }

    /** 试算：用内置那副，可复现（判据与界面共用同一结果）。 */
    demo() {
        const r = evaluateBestHand(DEMO_HAND);
        this.lastResult = r;
        return { ok: true, reason: null, result: r, hand: DEMO_HAND.slice() };
    }

    /** 牌面文本（视图用）。 */
    fmt(cards) { return formatCards(cards); }

    /** 一副 52 张（供界面点数牌张）。 */
    deck() { return createDeck(); }

    destroy() { this._view = null; }
}

export { SUITS, RANKS, HAND_SCORES, HAND_NAMES, EVAL_LIMITS, EVAL_REJECT, createDeck, evaluateBestHand, formatCards };
export default PokerEvalApp;
