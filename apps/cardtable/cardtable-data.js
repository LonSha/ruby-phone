/* ========================================================
 * cardtable-data.js — [v3.51.0] 牌桌案头 · 纯函数内核
 *
 * 源是 MyPhone 牌桌组件（card-table.js 807 行）的**牌组与状态机一族**：
 * 塔罗 78 张自动拼名（大阿尔卡那 22 + 四花色×14）与雷诺曼 36 牌名表、
 * Fisher-Yates 洗牌、正逆位 50%（雷诺曼恒无正逆）、抽牌状态机（back → selected → back，
 * 翻牌即选中、再点即取消、取消后序号重排）、选牌计数与上限。
 *
 * 与仓内 tarot 权威的裁定差：tarot-data 有 78 张塔罗牌意（up/down/symbol）与牌阵，
 * 本件取它的**雷诺曼 36 牌名表**（仓内没有）与牌桌状态机（翻选取消重排），牌意不重列。
 * 源挂 IndexedDB 出图（getTarotImage），本件零图片零数据库；会话键走 ^ct_ 前缀。
 * ======================================================== */
'use strict';
/* [v3.57.0·O3] 数值取值走**全仓唯一实现**（`config/num-gate.js`）。
 *   本件此前的 `numOrNullOf` 只给 `number` 放行、其余一律 `Number(v)` —— 牌序 0 是
 *   **合法读数**（第一张牌），而 `''` / `[]` / `false` 会被读成同一个 0。 */
import { numOrNull } from '../../config/num-gate.js';
export const CT_MAJOR = Object.freeze(['愚者','魔术师','女祭司','女皇','皇帝','教皇','恋人','战车','力量','隐士','命运之轮','正义','倒吊人','死神','节制','恶魔','塔','星星','月亮','太阳','审判','世界']);
export const CT_SUITS = Object.freeze(['权杖','圣杯','宝剑','星币']);
export const CT_RANKS = Object.freeze(['Ace','二','三','四','五','六','七','八','九','十','侍从','骑士','王后','国王']);
export const CT_LENORMAND = Object.freeze(['','骑士','三叶草','船','房子','树','云','蛇','棺材','花束','镰刀','鞭子','鸟','孩子','狐狸','熊','星星','鹳','狗','塔','花园','山','道路','老鼠','心','戒指','书','信','绅士','女士','百合','太阳','月亮','钥匙','鱼','锚','十字架']);
export const CT_DECK_TYPES = Object.freeze(['all', 'tarot', 'lenormand']);
export const CT_SELECT_MAX = 12;
export const CT_LEDGER_MAX = 120;

export function isPlain(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
export function listOf(v) { return Array.isArray(v) ? v : []; }
export function toStr(v) { return (typeof v === 'string') ? v : ''; }
export function trimRows(list, cap) {
    const arr = listOf(list);
    const c = (typeof cap === 'number' && cap > 0) ? Math.floor(cap) : arr.length;
    if (arr.length <= c) return { rows: arr.slice(), dropped: 0 };
    return { rows: arr.slice(0, c), dropped: arr.length - c };
}

/* 塔罗 78 张自动拼名（源 TAROT_NAMES 生成循环）。 */
export function tarotNameOf(index) {
    const i = numOrNullOf(index);
    if (i === null || i < 0 || i > 77) return '';
    if (i <= 21) return CT_MAJOR[i];
    const r = i - 22;
    const suit = CT_SUITS[Math.floor(r / 14)];
    const rank = CT_RANKS[r % 14];
    return suit + rank;
}

function numOrNullOf(v) { return numOrNull(v); }

export function lenormandNameOf(index) {
    const i = numOrNullOf(index);
    if (i === null || i < 1 || i > 36) return '';
    return CT_LENORMAND[i];
}
/* Fisher-Yates 洗牌（源 shuffle 同源）。 */
export function shuffle(arr) {
    const a = listOf(arr).slice();
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        const tmp = a[i]; a[i] = a[j]; a[j] = tmp;
    }
    return a;
}

/* 建牌组（源 buildDeck）：deckType 三型；塔罗正逆位 50%，雷诺曼恒 none。 */
export function buildDeck(deckType) {
    const t = listOf(CT_DECK_TYPES).indexOf(toStr(deckType)) >= 0 ? deckType : 'all';
    const cards = [];
    if (t === 'all' || t === 'tarot') {
        for (let i = 0; i < 78; i++) {
            cards.push({ type: 'tarot', index: i, name: tarotNameOf(i), orientation: Math.random() < 0.5 ? 'upright' : 'reversed', state: 'back' });
        }
    }
    if (t === 'all' || t === 'lenormand') {
        for (let i = 1; i <= 36; i++) {
            cards.push({ type: 'lenormand', index: i, name: lenormandNameOf(i), orientation: 'none', state: 'back' });
        }
    }
    return shuffle(cards);
}

/* 抽牌状态机（源 handleCardClick）：back → selected（入序）；selected/flipped → back（出序）。
 * 上限 SELECT_MAX：满员再选不许进（返回 full），不许静默挤掉已选。 */
export function pickCard(deck, cardIndex, selectedOrder) {
    const card = listOf(deck)[cardIndex];
    if (!card) return { ok: false, why: 'no_card' };
    if (card.state === 'back') {
        if (listOf(selectedOrder).length >= CT_SELECT_MAX) return { ok: false, why: 'full' };
        const order = listOf(selectedOrder).concat([cardIndex]);
        return { ok: true, why: '', state: 'selected', order: order, picked: true };
    }
    const order = listOf(selectedOrder).filter(function (x) { return x !== cardIndex; });
    return { ok: true, why: '', state: 'back', order: order, picked: false };
}

/* 序号重排（源 refreshOrderBadges）：取消后剩余选牌按原顺序连续编号（1 基）。 */
export function renumber(selectedOrder) {
    return listOf(selectedOrder).map(function (cardIndex, i) { return { cardIndex: cardIndex, order: i + 1 }; });
}

/* 读数面：牌组构成与已选计数。 */
export function readingsOf(deck, selectedOrder) {
    const d = listOf(deck);
    let tarot = 0; let lenormand = 0; let reversed = 0;
    for (const c of d) {
        if (c && c.type === 'tarot') { tarot++; if (c.orientation === 'reversed') reversed++; }
        else if (c && c.type === 'lenormand') lenormand++;
    }
    return { total: d.length, tarot: tarot, lenormand: lenormand, reversed: reversed, selected: listOf(selectedOrder).length, selectedLeft: CT_SELECT_MAX - listOf(selectedOrder).length };
}