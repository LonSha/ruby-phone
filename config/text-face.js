/* ============================================================
 * config/text-face.js — 全仓唯一的「文本读取面」实现 [v4.194.0]
 * ------------------------------------------------------------
 * 【为什么有这份文件（实测起点，不是推演）】
 *   本版做了一次全仓同名函数体指纹扫描，实测结果：
 *     · 下面这个函数体在 apps 与 config 里有 **31 份逐字相同**：
 *         function toStr(v) { return (typeof v === 'string') ? v : ''; }
 *       涉及 annidate / archive / cardtable / cotdesk / diagdesk / doujin / freehome /
 *       kettle / lexiscore / memtable / musicdesk / needsim / periodmath / pvdesk /
 *       recall / socialguard / sourcebook / stickerdesk / sullydesk / summdesk /
 *       traveldesk / uterus 的 data/app/plan/view 层，加 config/task-entry.js
 *       与 config/group-vote-handoff.js，调用点合计 545 处。
 *     · 另有 **2 份不同口径**（不属本次收敛，未动）：
 *         apps/affairs/affairs-app.js 与 apps/comms/comms-app.js 用的是
 *         `String(v == null ? '' : v).trim()`（会把数字 5 变成 '5'），
 *         与本口径「非串一律空串」不是同一语义，混在一处收敛就是造假等价。
 *
 *   同一口径复制 31 遍，就是「第 32 处会写错」的现场。这与 config/num-face.js
 *   治的 13 份 num 复制件、config/num-clamp.js 治的 11 份 boundedInt 复制件
 *   是同一个病：口径没有单一实现，维护半径就不是 1。
 *
 * 【本模块的裁定】
 *   · toStr 是这条「文本读取」口径的**唯一实现**；apps 与 config 一律引用它，
 *     不再各自复制一份。
 *   · 口径**类型严格**：只收 string，非串（含 null / undefined / 数字 / 对象）一律给空串。
 *     这里**刻意不**改成 `String(v == null ? '' : v)` —— 那会让数字 5 变成 '5'、
 *     对象变成 '[object Object]'，是放宽口径不是等价转调。
 *     本次 545 个调用点实参全部是属性访问、变量或逻辑表达式（从存储读出来的字段），
 *     等价性成立；但「碰巧没传数字」不是保证 —— 收敛口径的目标是让第 32 处
 *     写不错，不是让第 1 处变松。
 *   · **不 trim**：调用侧若需要去空白，自己 .trim()。仓内既有调用点
 *     （如 archive-app.js 的 `toStr(o.projectId).trim()`）就是显式 trim 的，
 *     把 trim 并进来会让「调用侧已 trim」变成「双重 trim」——那是行为变更。
 *   · 空串是**如实回答**，不是兜底值：读不出字符串就给空串，让调用侧自己判。
 *
 * 【与 num-face.js 的分工（不许互相顶替）】
 *   num-face.js 回答「数画给人看的串长什么样」；本文件回答「这一格到底是不是字符串、
 *   不是就当作没有」。一个是数的脸，一个是串的门。
 *
 * 【为什么没有 export default】
 *   本仓纪律（v4.193.0 立的）：内核不许留零消费出口。default 面若只有测试经
 *   `.default` 取它，就是「仅测试消费的 default 面」—— dead-exports 门的 E11
 *   判据会当场报红并要求二选一（产品端真接线，或登记进 TEST_ONLY_DEFAULT_LEDGER）。
 *   本文件只有一条口径、一个具名导出，产品端 31 个文件全部走具名导入，
 *   没有任何真实路径需要 default 面。故**刻意不设** default 出口，
 *   也不为「与 num-face.js 看起来一致」而补一个 —— 一致性是消费面的一致，不是装饰的一致。
 * ============================================================ */

/**
 * 文本读取（**只收字符串**，与那 31 份复制件逐字等价）。
 * 非串一律给空串 —— 空串表示「这里没有字符串」，不是兜底值。
 * @param {*} v 上游读数
 * @returns {string}
 */
export function toStr(v) {
    return (typeof v === 'string') ? v : '';
}
