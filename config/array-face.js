/* ============================================================
 * config/array-face.js — 全仓唯一的「数组读取面」实现 [v4.195.0]
 * ------------------------------------------------------------
 * 【为什么有这份文件（实测起点，不是推演）】
 *   本版做了一次全仓同名函数体指纹扫描，实测结果：
 *     · 下面这个函数体在 apps 与 config 里有 **16 份逐字相同**（1 变体，零分簇成本）：
 *         function safeArr(v) { return Array.isArray(v) ? v : []; }
 *       涉及 apps/wallet/economy-store.js 与 config 下 15 个文件
 *       （action-stack / character-dwelling / creator-bundle-ecosystem / diff-editor-desk /
 *        economy-face-bridge / joint-media-studio / life-program-replay / living-assets /
 *        recovery-hub / response-cadence / resume-anchor / rule-theatre / urban-economy /
 *        usage-paradigm / user-work-package），调用点合计 49 处。
 *
 *   同一口径复制 16 遍，就是「第 17 处会写错」的现场。这与 config/num-face.js 治的
 *   13 份 num 复制件、config/text-face.js 治的 31 份 toStr 复制件是同一个病：
 *   口径没有单一实现，维护半径就不是 1。
 *
 * 【本模块的裁定】
 *   · safeArr 是这条「数组读取」口径的**唯一实现**；apps 与 config 一律引用它，
 *     不再各自复制一份。
 *   · 口径**只认真数组**：`Array.isArray(v) ? v : []`。这里**刻意不**改写成
 *     `Array.isArray(v) ? v.slice() : []` —— 那会让每次读取都多一次数组拷贝，
 *     是性能口径变更不是等价转调；也**不**扩展成「类数组 / 有 items 的包装对象也收」
 *     （仓内 listOf 有两个变体正是这么做的，见下）。
 *   · **空数组不是兜底值**：读不出数组就给空数组，让调用侧自己判「是真的空还是没给」。
 *   · 与 listOf 的关系（重要，不许互相顶替）：仓内 `listOf` 有 4 个变体，其中 2 个
 *     会把 `{ items: [...] }` 这类包装对象解包成数组。那是一条**更宽**的口径，
 *     与本文件的「只认真数组」不是同一语义，故本版只收敛 safeArr 这一支，
 *     不去动那 2 个 listOf 变体 —— 把宽窄两种口径合成一个实现，就是造假等价。
 *
 * 【与 text-face.js / num-face.js 的分工（不许互相顶替）】
 *   text-face.js 回答「这一格是不是字符串」；num-face.js 回答「数画成人看的串长什么样」；
 *   本文件回答「这一格是不是数组」。三个都是「读取面的门」，各管一型。
 * ============================================================ */

/**
 * 数组读取（**只认真数组**，与那 16 份复制件逐字等价）。
 * 非数组一律给空数组 —— 空数组表示「这里没有数组」，不是兜底值。
 * @param {*} v 上游读数
 * @returns {Array}
 */
export function safeArr(v) {
    return Array.isArray(v) ? v : [];
}