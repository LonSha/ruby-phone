/* ============================================================
 * cardtable-data.js — [v3.51.0 / v4.200.0] 牌桌案头 · 内核入口（兼容壳）
 * ------------------------------------------------------------
 * v3.51.0 时这一件就是内核本身（牌组与状态机一族）。
 * v4.200.0 把它拆成两件，本件只剩「历史导出面 + 三件小事」：
 *   · 真正的牌组逻辑搬到 `cardtable-core.js`（随机源注入形，纯函数、零副作用）；
 *   · 本件 `export * from './cardtable-core.js'` 保住 v3.51.0 以来的全部导出名，
 *     下游与历史判据（cardtable_min / system-v4194 / system-v3570）不用改。
 *
 * 为什么还要留着这一件（不直接把调用方改到 core）：
 *   `cardtable-data.js` 被三份历史判据按**文件名**钉着 ——
 *   `system-v3570` 的十三处取数逃逸点清单、`system-v4194` 的 toStr 转调清单、
 *   `tests/cardtable_min.test.mjs` 的直接 import。改文件名等于同时改三份判据，
 *   而这三份判据守的是别的事（数值取值门 / 文本读取面 / 导出面），不该被本版拖下水。
 *   薄壳的成本只有几十行，比改三份判据便宜，也比让它们静默失守安全。
 *
 * 本件仍然要做的三件小事（都不属于「牌组逻辑」）：
 *   ① `toStr` 薄转发 —— v4.194.0 把 31 份 toStr 收进 config/text-face.js 后，
 *      本件的导出名必须留着（下游按命名空间 import 取它）；
 *   ② `numOrNullOf` 薄转发 —— v3.57.0 的十三处逃逸点要求本文件引用唯一取值门；
 *   ③ `isPlain` / `listOf` / `trimRows` —— 台账裁剪面，控制器在用。
 * ============================================================ */
'use strict';
/* [v3.57.0·O3] 数值取值走**全仓唯一实现**（`config/num-gate.js`）。
 *   本件此前的 `numOrNullOf` 只给 `number` 放行、其余一律 `Number(v)` —— 牌序 0 是
 *   **合法读数**（第一张牌），而 `''` / `[]` / `false` 会被读成同一个 0。 */
import { numOrNull } from '../../config/num-gate.js';
import { toStr } from '../../config/text-face.js';

export { toStr };
/* 牌组逻辑全部搬去 cardtable-core.js；这里原样转出，导出面与 v3.51.0 逐字相同。 */
export * from './cardtable-core.js';

export function isPlain(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
export function listOf(v) { return Array.isArray(v) ? v : []; }
export function trimRows(list, cap) {
    const arr = listOf(list);
    const c = (typeof cap === 'number' && cap > 0) ? Math.floor(cap) : arr.length;
    if (arr.length <= c) return { rows: arr.slice(), dropped: 0 };
    return { rows: arr.slice(0, c), dropped: arr.length - c };
}

/* 薄转发：保住 v3.57.0 立下的导出名，实现只有 num-gate 一份。 */
export function numOrNullOf(v) { return numOrNull(v); }
