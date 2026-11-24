/* ============================================================
 * cardtable-core.js — [v4.200.0] 牌桌案头 · 纯函数内核（随机源注入形）
 * ------------------------------------------------------------
 * 为什么要有这一件（从 `cardtable-data.js` 里抽出来的那部分）：
 *   v3.51.0 的四件套已经把这件 App 的牌组逻辑抽成纯函数了，但**没抽干净**：
 *   `shuffle()` 与 `buildDeck()` 体内各自直接调 `Math.random()`。
 *   后果是三件事，每件都是本仓登记过的老形态：
 *     ① 同一份输入算出不同结果 ⇒ 判据只能断言「牌数对」，断言不了「牌序对」；
 *     ② 想复现一个用户报的「牌不对」只能靠运气 —— 随机源在函数体内，外部无从替换；
 *     ③ 「认不出就悄悄兜默认」的第二种写法：`buildDeck('tarotx')` 静默变成 'all'，
 *        用户点了「只要塔罗」却多出 36 张雷诺曼，且**没有任何一处报错**。
 *
 * 本件的三条改变（判据状态**如实**写在这里 —— v4.200.0 提交时这行原本指向一张
 *   名为「v4200b」的判据文件，而 `tests/` 下**根本没有它**，
 *   是 `doc-path-claim` 门抓到的声明落空。现按真实情况改写：
 *     · ① 随机源显式传入 + `makeRng(seed)` 可复现 —— **判据未写**（口子见文末 TODO）；
 *     · ② 牌组类型封闭（`normalizeDeckType` 返回 null，表外不静默兜 'all'）—— **判据未写**；
 *     · ③ 纯度扫描（内核文本面不出现 Date.now / Math.random / DOM / 存储 / 网络）——
 *       由 `tests/system-v4199.test.mjs` 与 `tests/system-v4199b.test.mjs` 的台账判据钉住。
 *   在那之前 ①② 只有代码承诺、没有机器判据 —— 不许当成已验收。
 *
 * 下面三条依次展开：
 *   1) **随机源必须显式传入**：`shuffle(arr, rng)` / `buildDeck(type, rng)` 的 `rng`
 *      不是函数就**抛错**，不兜 `Math.random` —— 兜底等于把「不可复现」留在原地。
 *      配套 `makeRng(seed)`（mulberry32）给出一条**同 seed 同牌序**的路。
 *   2) **认不出就拒答**：牌组类型走封闭词表，表外抛 `bad_deck_type`，不再静默兜 'all'。
 *   3) **不改入参**：`pickCard` 返回一副**新牌组**（只换被点的那一张），调用方拿返回值替换，
 *      不再「内核算状态、控制器手工回写」——那个写法让「谁改了这张牌」不可追。
 *
 * 刻意不做的事：
 *   · 不取 `Date.now()`（种子由调用方给）；不碰 DOM / 存储 / 网络 / 定时器；
 *   · 不持任何模块级可变状态（`makeRng` 的游标关在闭包里，一份 rng 一份游标）。
 * ============================================================ */
'use strict';
import { numOrNull } from '../../config/num-gate.js';
import { toStr } from '../../config/text-face.js';

/* ── 牌面词表（封闭）──────────────────────────────────────── */
export const CT_MAJOR = Object.freeze(['愚者', '魔术师', '女祭司', '女皇', '皇帝', '教皇', '恋人', '战车', '力量', '隐士', '命运之轮', '正义', '倒吊人', '死神', '节制', '恶魔', '塔', '星星', '月亮', '太阳', '审判', '世界']);
export const CT_SUITS = Object.freeze(['权杖', '圣杯', '宝剑', '星币']);
export const CT_RANKS = Object.freeze(['Ace', '二', '三', '四', '五', '六', '七', '八', '九', '十', '侍从', '骑士', '王后', '国王']);
export const CT_LENORMAND = Object.freeze(['', '骑士', '三叶草', '船', '房子', '树', '云', '蛇', '棺材', '花束', '镰刀', '鞭子', '鸟', '孩子', '狐狸', '熊', '星星', '鹳', '狗', '塔', '花园', '山', '道路', '老鼠', '心', '戒指', '书', '信', '绅士', '女士', '百合', '太阳', '月亮', '钥匙', '鱼', '锚', '十字架']);
export const CT_DECK_TYPES = Object.freeze(['all', 'tarot', 'lenormand']);
export const CT_SELECT_MAX = 12;
export const CT_LEDGER_MAX = 120;

/* ── 拒答理由（每种都能被如实上报，不用一句「失败」盖掉）── */
export const CT_REJECT = Object.freeze({
    rngMissing: 'rng_missing',
    badSeed: 'bad_seed',
    badDeckType: 'bad_deck_type',
    noCard: 'no_card',
    full: 'full'
});

/* ── 取数/列表面（薄转发，保持与 v3.51.0 逐字同义）────────── */
function listOf(v) { return Array.isArray(v) ? v : []; }
function numOrNullOf(v) { return numOrNull(v); }

/** 塔罗 78 张自动拼名：0..21 大阿卡纳，22..77 四花色×14。越界给空串。 */
export function tarotNameOf(index) {
    const i = numOrNullOf(index);
    if (i === null || i < 0 || i > 77) return '';
    if (i <= 21) return CT_MAJOR[i];
    const r = i - 22;
    const suit = CT_SUITS[Math.floor(r / 14)];
    const rank = CT_RANKS[r % 14];
    return suit + rank;
}

/** 雷诺曼 36 张：源表 1 基（0 号是空串占位），越界给空串。 */
export function lenormandNameOf(index) {
    const i = numOrNullOf(index);
    if (i === null || i < 1 || i > 36) return '';
    return CT_LENORMAND[i];
}

/* ── 随机源 ───────────────────────────────────────────────
 * mulberry32：32 位种子的确定性伪随机，同 seed 同序列、跨平台同结果。
 * 为什么不用 crypto：判据要「同 seed 同牌序」，加密级随机会把这条断言打掉。
 * 为什么不用 Math.random：那是本件要拔掉的病根，不是解。
 */

/** 把种子规整成 32 位无符号整数。认不出给 null（不编 0 —— 0 是合法种子）。 */
export function normalizeSeed(seed) {
    if (typeof seed === 'number') {
        if (!Number.isFinite(seed)) return null;
        return Math.floor(Math.abs(seed)) % 4294967296;
    }
    if (typeof seed === 'string') {
        const t = seed.trim();
        if (!/^\d+$/.test(t)) return null;
        const n = Number(t);
        if (!Number.isFinite(n)) return null;
        return Math.floor(n) % 4294967296;
    }
    return null;
}

/** 造一条确定性随机源。种子认不出就抛（不信「随便给个 0」）。 */
export function makeRng(seed) {
    const s = normalizeSeed(seed);
    if (s === null) {
        throw new TypeError('cardtable-core: makeRng(seed) 的种子认不出（' + CT_REJECT.badSeed + '）');
    }
    let t = s >>> 0;
    return function rng() {
        t = (t + 0x6D2B79F5) >>> 0;
        let x = t;
        x = Math.imul(x ^ (x >>> 15), x | 1);
        x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
        return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
    };
}

/** 随机源闸：不是函数就抛，不兜 Math.random。 */
function requireRng(rng, who) {
    if (typeof rng !== 'function') {
        throw new TypeError('cardtable-core: ' + who + ' 必须显式传入随机源 rng（' + CT_REJECT.rngMissing + '）—— 兜 Math.random 会让同一输入算出不同结果，不可测、不可复现');
    }
    return rng;
}

/** Fisher-Yates 洗牌（源 shuffle 同源，唯一差别是随机源从外部来）。不改入参。 */
export function shuffle(arr, rng) {
    const r = requireRng(rng, 'shuffle(arr, rng)');
    const a = listOf(arr).slice();
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(r() * (i + 1));
        const tmp = a[i]; a[i] = a[j]; a[j] = tmp;
    }
    return a;
}

/** 牌组类型闸：表外抛，不静默兜 'all'。 */
export function normalizeDeckType(deckType) {
    const t = toStr(deckType);
    if (CT_DECK_TYPES.indexOf(t) < 0) return null;
    return t;
}

/** 建牌组：三型；塔罗正逆位由 rng 决定（<0.5 逆位），雷诺曼恒 none。 */
export function buildDeck(deckType, rng) {
    const r = requireRng(rng, 'buildDeck(deckType, rng)');
    const t = normalizeDeckType(deckType);
    if (t === null) {
        throw new RangeError('cardtable-core: 牌组类型认不出（' + CT_REJECT.badDeckType + '）：' + toStr(deckType));
    }
    const cards = [];
    if (t === 'all' || t === 'tarot') {
        for (let i = 0; i < 78; i++) {
            cards.push({ type: 'tarot', index: i, name: tarotNameOf(i), orientation: r() < 0.5 ? 'upright' : 'reversed', state: 'back' });
        }
    }
    if (t === 'all' || t === 'lenormand') {
        for (let i = 1; i <= 36; i++) {
            cards.push({ type: 'lenormand', index: i, name: lenormandNameOf(i), orientation: 'none', state: 'back' });
        }
    }
    return shuffle(cards, r);
}

/**
 * 抽牌状态机（源 handleCardClick）：back → selected（入序）；selected → back（出序）。
 * 上限 CT_SELECT_MAX：满员再选不许进（返回 full），不许静默挤掉已选。
 * **返回新牌组**：`deck` 字段是浅拷后只换被点那张；入参一个字节都不改。
 */
export function pickCard(deck, cardIndex, selectedOrder) {
    const d = listOf(deck);
    const card = d[cardIndex];
    if (!card) return { ok: false, why: CT_REJECT.noCard, deck: d.slice(), order: listOf(selectedOrder).slice(), state: '', picked: false };
    if (card.state === 'back') {
        if (listOf(selectedOrder).length >= CT_SELECT_MAX) {
            return { ok: false, why: CT_REJECT.full, deck: d.slice(), order: listOf(selectedOrder).slice(), state: '', picked: false };
        }
        const next = d.slice();
        next[cardIndex] = Object.assign({}, card, { state: 'selected' });
        return { ok: true, why: '', deck: next, state: 'selected', order: listOf(selectedOrder).concat([cardIndex]), picked: true };
    }
    const next = d.slice();
    next[cardIndex] = Object.assign({}, card, { state: 'back' });
    const order = listOf(selectedOrder).filter(function (x) { return x !== cardIndex; });
    return { ok: true, why: '', deck: next, state: 'back', order: order, picked: false };
}

/** 序号重排（源 refreshOrderBadges）：取消后剩余选牌按原顺序连续编号（1 基）。 */
export function renumber(selectedOrder) {
    return listOf(selectedOrder).map(function (cardIndex, i) { return { cardIndex: cardIndex, order: i + 1 }; });
}

/** 读数面：牌组构成与已选计数。 */
export function readingsOf(deck, selectedOrder) {
    const d = listOf(deck);
    let tarot = 0; let lenormand = 0; let reversed = 0;
    for (const c of d) {
        if (c && c.type === 'tarot') { tarot++; if (c.orientation === 'reversed') reversed++; }
        else if (c && c.type === 'lenormand') lenormand++;
    }
    return { total: d.length, tarot: tarot, lenormand: lenormand, reversed: reversed, selected: listOf(selectedOrder).length, selectedLeft: CT_SELECT_MAX - listOf(selectedOrder).length };
}
