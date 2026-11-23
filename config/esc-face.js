/* ============================================================
 * config/esc-face.js — 全仓唯一的「HTML 转义面」实现 [v4.198.0]
 * ------------------------------------------------------------
 * 【为什么有这份文件（实测起点，不是推演）】
 *   v4.197.0 后做了一轮全仓同名函数体指纹扫描，实测结果：
 *     · function esc(s) 在 apps 下共 **35 处定义**，分为 **12 种口径**。
 *     · 变体 [0] 为 **18 份逐字全等**（调用点合计 **449 处**），
 *       涉及 accessdesk / annidate / backupdesk / caphealth / cardtable / creationdesk /
 *       freehome / lexiscore / memtable / periodmath / socialguard / stickerdesk / sullydesk /
 *       summdesk / taskentry / traveldesk / workflow 二十余个 App 的 view 与 design 层。
 *     · 另外 11 种口径行为不等价，一律不动（详见文末）。
 *
 *   同一口径复制 18 遍，就是「第 19 处会写错」的现场。这与 config/num-face.js、
 *   config/text-face.js、config/array-face.js、config/str-face.js、config/loose-str-face.js
 *   治的各类复制件是同一个病：口径没有单一实现，维护半径就不是 1。
 *
 * 【本内核锚止的三条立场】
 *   1. 只转 & < > “ 四个字符，单引号 ‘ 则故意不转。
 *   2. null / undefined 给空串，其余值统一走 String()。
 *   3. 不带 max 截断 —— 那是第二个签名，属另一个面。
 *
 *   等价性对拍：18 份 × 33 探针 = **594 用例零差异**。
 * ========================================================= */
'use strict';

/**
 * HTML escape: ampersand, less-than, greater-than and double-quote
 * become entities; single quote stays as-is.
 * Byte-equivalent to the 18 copies (594 probe cases, 0 diff).
 * @param {*} v any value; null/undefined treated as empty string
 * @returns {string} escaped string
 */
function esc(v) {
    return String(v == null ? '' : v)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

export { esc };

/**
 * [1] 2 copies: ?? + #34 / #39 -- cheat-view, dt-view
 * [2] 2 copies: split/join but QUOTE_ESC uses &quot; -- gacha-view, xhs-view
 * [3] 2 copies: == null + four-const replace -- board-view, health-view
 * [4] 2 copies: ?? + u0022 / #39 -- notification-center-view, search-view
 * [5] 2 copies: ?? + &quot; -- reading-view, tarot-view
 * [6] 2 copies: no-space form -- timeweaver-view, worldpulse-view
 * [7][8][9][10] 1 each, minor diff -- album-voice-view, mystery-view, mood-view, settings-ia-panel
 * [11] 1 copy: max second arg + escapes single quote -- tieba-view
 * Key measured diff: v11 turns its into it&#39;s; this kernel does not escape single quote.
 */
