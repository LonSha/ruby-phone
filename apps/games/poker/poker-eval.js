/* ============================================================
 * poker-eval.js — [v4.189.0] 德州扑克牌型评估的纯函数内核
 * ------------------------------------------------------------
 * 从 apps/games/poker/poker-data.js 那 1038 行类里抽出来的**唯一可纯化部分**：
 *   源的 _createDeck / _shuffle / _draw / _combinations / _rankFive /
 *   _straightHigh / _compareHands / _handLabel / _rankName / evaluateBestHand
 *   十个方法全是「给定牌 -> 给定结论」，不碰 DOM、不碰存储、不碰时间。
 * ------------------------------------------------------------
 * 为什么单独一件：类里其余 69 个方法都在动 this.state（下注轮、盲注、AI 决策、
 *   侧池、摊牌结算、storage 直写），那是**有副作用**的编排，不是可纯化的内核。
 *   把这两类混在一个文件里，判据就只能「跑一遍看看不崩」，不能钉住任何一条不变式。
 *   抽开之后：牌型评估的每条边界（五张怎么都比七张强、A 能当 1 用、
 *   同分怎么比、牌不够怎么拒）都能逐条断言。
 * ------------------------------------------------------------
 * 刻意不做：不持状态、不改入参、不碰 Math.random（洗牌由调用方传 rng，
 *   否则同一副牌每次跑出不同结果，判据没法写）。
 * ============================================================ */

/** 四种花色。id/symbol/color 三栏都在，视图直接用 symbol。 */
export const SUITS = Object.freeze([
    Object.freeze({ id: 'spades', symbol: String.fromCharCode(0x2660), color: 'black' }),
    Object.freeze({ id: 'hearts', symbol: String.fromCharCode(0x2665), color: 'red' }),
    Object.freeze({ id: 'diamonds', symbol: String.fromCharCode(0x2666), color: 'red' }),
    Object.freeze({ id: 'clubs', symbol: String.fromCharCode(0x2663), color: 'black' })
]);

/** 十三种点数。A=14（比大时最大，比顺子时也能当 1，见 straightHigh）。 */
export const RANKS = Object.freeze([
    Object.freeze({ label: '2', value: 2 }),
    Object.freeze({ label: '3', value: 3 }),
    Object.freeze({ label: '4', value: 4 }),
    Object.freeze({ label: '5', value: 5 }),
    Object.freeze({ label: '6', value: 6 }),
    Object.freeze({ label: '7', value: 7 }),
    Object.freeze({ label: '8', value: 8 }),
    Object.freeze({ label: '9', value: 9 }),
    Object.freeze({ label: '10', value: 10 }),
    Object.freeze({ label: 'J', value: 11 }),
    Object.freeze({ label: 'Q', value: 12 }),
    Object.freeze({ label: 'K', value: 13 }),
    Object.freeze({ label: 'A', value: 14 })
]);

/** 牌型类别 -> 0..8（越大越强）。词表封闭，判据逐条钉。 */
export const HAND_SCORES = Object.freeze({
    highCard: 0,
    pair: 1,
    twoPair: 2,
    threeOfAKind: 3,
    straight: 4,
    flush: 5,
    fullHouse: 6,
    fourOfAKind: 7,
    straightFlush: 8
});

export const HAND_NAMES = Object.freeze([
    '高牌', '一对', '两对', '三条', '顺子', '同花', '葫芦', '四条', '同花顺'
]);

export const EVAL_LIMITS = Object.freeze({ handSize: 5, deckSize: 52 });
export const EVAL_REJECT = Object.freeze({
    notEnoughCards: 'not_enough_cards',
    badCard: 'bad_card'
});

function rankName(value) {
    const r = RANKS.filter((x) => x.value === value)[0];
    return r ? r.label : String(value);
}

function isCard(c) {
    return !!c && typeof c === 'object'
        && typeof c.suit === 'string' && SUITS.some((s) => s.id === c.suit)
        && typeof c.value === 'number' && RANKS.some((r) => r.value === c.value);
}

/** 建一副 52 张。牌面 id 唯一（suit+value），不重不漏。 */
export function createDeck() {
    const deck = [];
    for (const s of SUITS) {
        for (const r of RANKS) {
            deck.push({ suit: s.id, value: r.value, label: r.label });
        }
    }
    return deck;
}

/** 洗牌：rng 由调用方给（返回 [0,1) 的数）。不自己取 Math.random。
 *  同一副牌 + 同一个 rng 序列 => 同一个结果（判据可写）。 */
export function shuffleDeck(deck, rng) {
    if (!Array.isArray(deck)) return [];
    const next = rng || (() => 0);
    const out = deck.slice();
    for (let i = out.length - 1; i > 0; i -= 1) {
        const j = Math.floor(next() * (i + 1));
        const t = out[i]; out[i] = out[j]; out[j] = t;
    }
    return out;
}

/** 从牌堆顶抽 n 张。**不改入参**：返回 { drawn, rest } 两份。 */
export function drawCards(deck, n) {
    if (!Array.isArray(deck)) return { drawn: [], rest: [] };
    const k = Math.max(0, Math.floor(n) || 0);
    return { drawn: deck.slice(0, k), rest: deck.slice(k) };
}

/** 组合：从 items 里取 size 张的所有组合（摊牌评估要用）。 */
export function combinations(items, size) {
    const result = [];
    const walk = (start, combo) => {
        if (combo.length === size) { result.push(combo); return; }
        for (let i = start; i < items.length; i += 1) walk(i + 1, [...combo, items[i]]);
    };
    walk(0, []);
    return result;
}

/** 顺子的最高张。A 既能当 14 也能当 1（A-2-3-4-5 是高 5 的顺子）。 */
export function straightHigh(values) {
    const unique = [...new Set(values)].sort((a, b) => b - a);
    if (unique.indexOf(14) >= 0) unique.push(1);
    for (let i = 0; i <= unique.length - 5; i += 1) {
        const window = unique.slice(i, i + 5);
        if (window[0] - window[4] === 4) return window[0] === 1 ? 5 : window[0];
    }
    return 0;
}

/** 评五张牌。ranks 是**有序**的比较键（先比它，逐个比）。 */
export function rankFive(cards) {
    if (!Array.isArray(cards) || cards.length !== EVAL_LIMITS.handSize) return null;
    for (const c of cards) if (!isCard(c)) return null;
    const values = cards.map((c) => c.value).sort((a, b) => b - a);
    const counts = new Map();
    values.forEach((v) => counts.set(v, (counts.get(v) || 0) + 1));
    const groups = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
    const flush = cards.every((c) => c.suit === cards[0].suit);
    const sHigh = straightHigh(values);

    let score = HAND_SCORES.highCard;
    let ranks = values;
    if (flush && sHigh) { score = HAND_SCORES.straightFlush; ranks = [sHigh]; }
    else if (groups[0][1] === 4) {
        score = HAND_SCORES.fourOfAKind;
        ranks = [groups[0][0], ...groups.filter((g) => g[1] === 1).map((g) => g[0])];
    } else if (groups[0][1] === 3 && groups[1] && groups[1][1] === 2) {
        score = HAND_SCORES.fullHouse;
        ranks = [groups[0][0], groups[1][0]];
    } else if (flush) { score = HAND_SCORES.flush; ranks = values; }
    else if (sHigh) { score = HAND_SCORES.straight; ranks = [sHigh]; }
    else if (groups[0][1] === 3) {
        score = HAND_SCORES.threeOfAKind;
        ranks = [groups[0][0], ...groups.filter((g) => g[1] === 1).map((g) => g[0]).sort((a, b) => b - a)];
    } else if (groups[0][1] === 2 && groups[1] && groups[1][1] === 2) {
        score = HAND_SCORES.twoPair;
        const pairs = groups.filter((g) => g[1] === 2).map((g) => g[0]).sort((a, b) => b - a);
        const kickers = groups.filter((g) => g[1] === 1).map((g) => g[0]).sort((a, b) => b - a);
        ranks = [...pairs, ...kickers];
    } else if (groups[0][1] === 2) {
        score = HAND_SCORES.pair;
        ranks = [groups[0][0], ...groups.filter((g) => g[1] === 1).map((g) => g[0]).sort((a, b) => b - a)];
    }
    return { score, ranks, label: handLabel(score, ranks), cards };
}

/** 牌型中文名（含点数）。 */
export function handLabel(score, ranks) {
    const top = rankName(ranks[0]);
    if (score === HAND_SCORES.straightFlush) return top + '高同花顺';
    if (score === HAND_SCORES.fourOfAKind) return '四条' + top;
    if (score === HAND_SCORES.fullHouse) return top + '葫芦';
    if (score === HAND_SCORES.straight) return top + '高顺子';
    if (score === HAND_SCORES.threeOfAKind) return '三条' + top;
    if (score === HAND_SCORES.twoPair) return '两对' + rankName(ranks[0]) + '/' + rankName(ranks[1]);
    if (score === HAND_SCORES.pair) return '一对' + top;
    if (score === HAND_SCORES.flush) return top + '高同花';
    return top + '高牌';
}

/** 比两手牌。>0 a 强，<0 b 强，0 平。 */
export function compareHands(a, b) {
    if (!a || !b) return a ? 1 : b ? -1 : 0;
    if (a.score !== b.score) return a.score - b.score;
    const len = Math.max(a.ranks.length, b.ranks.length);
    for (let i = 0; i < len; i += 1) {
        const diff = (a.ranks[i] || 0) - (b.ranks[i] || 0);
        if (diff !== 0) return diff;
    }
    return 0;
}

/** 从 5~7 张里挑最好的五张。少于五张拒答（不当默认值用）。 */
export function evaluateBestHand(cards) {
    if (!Array.isArray(cards) || cards.length < EVAL_LIMITS.handSize) return null;
    let best = null;
    for (const combo of combinations(cards, EVAL_LIMITS.handSize)) {
        const ranked = rankFive(combo);
        if (ranked && (!best || compareHands(ranked, best) > 0)) best = ranked;
    }
    return best;
}

/** 把牌列成可读文本（视图/分享文案用）。 */
export function formatCards(cards) {
    if (!Array.isArray(cards)) return '';
    const sym = {};
    for (const s of SUITS) sym[s.id] = s.symbol;
    return cards.map((c) => (sym[c.suit] || c.suit) + rankName(c.value)).join(' ');
}
