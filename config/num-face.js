/* ============================================================
 * config/num-face.js — 全仓唯一的「数值展示面」实现 [v4.193.0]
 * ------------------------------------------------------------
 * 【为什么有这份文件（实测起点，不是推演）】
 *   本版做了一次全仓同名函数体指纹扫描，实测结果：
 *     · 下面这个函数体在 apps 下各个 *-view.js 里有 **13 份逐字相同**：
 *         function num(v) { return (typeof v === 'number' && Number.isFinite(v)) ? String(v) : DASH; }
 *       涉及 annidate / cardtable / freehome / gacha / lexiscore / memtable / periodmath /
 *       socialguard / stickerdesk / sullydesk / summdesk / traveldesk / xhs，调用点合计 92 处。
 *     · 另一个函数体在 app 层有 **5 份逐字相同**：
 *         function numOrSelf(v, self) { const n = numOrNull(v); return n === null ? self : n; }
 *       涉及 kettle / musicdesk / needsim / recall / sourcebook。
 *     · 其中 apps/sullydesk/sullydesk-view.js 那一份 num **零调用**（死定义），
 *       而仓里没有任何一道门禁会发现「这个函数没人用」——
 *       它是靠本次指纹比对才露出来的。
 *
 *   同一口径复制 18 遍，就是「第 19 处会写错」的现场；而已经写错的那一处
 *   （死定义）没有任何东西会响。这与 config/num-clamp.js 治的 boundedInt
 *   11 份复制是**同一个病**：口径没有单一实现，维护半径就不是 1。
 *
 * 【本模块的裁定】
 *   · numeralText / numOrSelf / moneyText 是这三条展示口径的**唯一实现**；
 *     apps 与 config 一律引用它，不再各自复制一份。
 *   · 展示串口径**只认真数**（typeof v === number 且 Number.isFinite），字符串数字一律给占位符。
 *     这里**刻意不**改用 numOrNull 的字符串解析 —— 本版实测过：改用它会让
 *     字符串“5”从占位符变成“5”、“0x10”变成“16”，共 6 类行为差异。
 *     虽然本次 92 个调用点传的全是 .length、数字常量或数字表达式（**没有一处传字符串**，
 *     等价性成立），但「碰巧没传」不是保证 —— 收敛口径的目标是让第 19 处
 *     写不错，不是让第 1 处变松。
 *   · 同理：numOrSelf 那 5 份复制件**本来就是** numOrNull 的一层包装，逐字等价，
 *     直接转调无行为差异。
 *   · **占位符不是 0**：读不出给 DASH，绝不给 0。把「没给」画成 0
 *     是「把没给画成给了」，比不画更贵。
 *   · DASH 由调用方给（默认两个连字符），与各视图既有的
 *     const DASH = String.fromCharCode(45, 45) 同值 —— 本文件只做同一口径的
 *     落点，不引入第二种占位符来源。
 *
 * 【与 num-clamp.js 的分工（不许互相顶替）】
 *   num-clamp.js 回答「取到的数该怎么夹」；本文件回答「画给人看的串长什么样」。
 *   一个是算的，一个是看的。
 * ============================================================ */

import { numOrNull } from './num-gate.js';

/** 默认占位符：两个连字符。与各视图既有的 String.fromCharCode(45, 45) 同值。 */
export const NUMERAL_DASH = '--';

/**
 * 数值 → 展示串（**只认真数**，与那 13 份复制件逐字等价）。
 * 取不到数给占位符（默认两个连字符），**绝不给 0**。
 * @param {*} v 上游读数
 * @param {string} [dash] 占位符
 * @returns {string}
 */
export function numeralText(v, dash = NUMERAL_DASH) {
    return (typeof v === 'number' && Number.isFinite(v)) ? String(v) : String(dash);
}

/**
 * 取不到数时落回调用方给的默认值（**原样返回，不加工**）。
 * 与 numeralText 的分工：numeralText 给「画给人看的串」，本函数给「接着算的数」。
 * 与那 5 份复制件逐字等价（它们本来就是 numOrNull 的一层包装）。
 * @param {*} v 上游读数
 * @param {*} self 取不到时的落回值
 * @returns {number|*}
 */
export function numOrSelf(v, self) {
    const n = numOrNull(v);
    return n === null ? self : n;
}

/**
 * 金额展示：四舍五入到分（两位小数形态），**只认真数**（与 traveldesk-view.js
 * 既有的 money(v) 逐字等价）。取不到数给占位符，**不画 0.00**。
 * @param {*} v 上游读数
 * @param {string} [dash] 占位符
 * @returns {string}
 */
export function moneyText(v, dash = NUMERAL_DASH) {
    if (!(typeof v === 'number' && Number.isFinite(v))) return String(dash);
    return String(Math.round(v * 100) / 100);
}

export default { NUMERAL_DASH, numeralText, numOrSelf, moneyText };
