/* ============================================================
 * config/loose-str-face.js — 全仓唯一的「宽松文本规整面」实现 [v4.197.0]
 * ------------------------------------------------------------
 * 【为什么有这份文件（实测起点，不是推演）】
 *   本版做了一次全仓同名函数体指纹扫描（v4.196.0 后新基线），实测结果：
 *     · 下面这个函数体在 apps 与 config 里有 **24 份逐字相同**：
 *         function str(v) { return String(v == null ? '' : v).trim(); }
 *       涉及 apps/reading/reading-attachment.js 与 config 的 affair-state /
 *       branch-canon-contract / causal-board-contract / comm-thread / consume-once /
 *       gathering-plan / goal-tree-contract / group-vote-contract / item-custody-contract /
 *       library-backup / material-board-contract / material-board-handoff /
 *       memory-ask-thread / perspective-card-contract / perspective-contrast-contract /
 *       presence-band-contract / recurrence-contract / relation-album-contract /
 *       rumor-source-contract / setting-rewrite-contract / share-fragment /
 *       shared-past-contract / topic-dossier-contract，共 24 个文件，
 *       调用点合计 **449 处**（单文件 2~76 处，全部有真实调用点，无零调用死定义）。
 *     · 另有 **10 种不同口径**（不属本次收敛，刻意未动）：9 份 `v == null ? '' : String(v)`
 *       （不 trim）、3 份带 max 截断形、以及若干 `??` / `===` / 不 trim 的变体。
 *       十一种口径混在一处收敛就是造假等价，故本文件只收变体 [0]。
 *
 *   同一口径复制 24 遍，就是「第 25 处会写错」的现场。这与 config/text-face.js 治的
 *   31 份 toStr 复制件、config/array-face.js 治的 16 份 safeArr 复制件、
 *   config/str-face.js 治的 15 份 safeStr 复制件是同一个病。
 *
 * 【本模块的裁定】
 *   · str 是这条「宽松文本规整」口径的**唯一实现**；一律引用它，不再各自复制。
 *   · 口径**宽松**：`String(v == null ? '' : v).trim()` —— 数字 5 会变成 '5'、
 *     布尔 true 会变成 'true'、对象会变成 '[object Object]'。
 *     这里**刻意不**收紧成 `(typeof v === 'string') ? v.trim() : ''` ——
 *     那会让原本显示 '5' 的地方变成空串，是**收紧口径**，同样不是等价转调。
 *   · **trim 在本口径之内**：这 24 份复制件本来就 trim，收敛时并进来是等价的。
 *
 * 【与 text-face.js / str-face.js 的分工（这是本文件存在的全部理由）】
 *   text-face.js（toStr）      ：严格 —— 只收 string，非串一律空串，**不 trim**。
 *   str-face.js（safeStr）     ：严格 —— 只收 string，非串一律空串，**trim**。
 *   loose-str-face.js（str）   ：宽松 —— 非串也 String() 成串，**trim**。
 *   三者的差别只在两格：「非串给什么」与「要不要 trim」——
 *     · toStr  = 空串 + 不 trim（保留原文）
 *     · safeStr = 空串 + trim
 *     · str    = String() + trim
 *   **正因为三者不等价，才必须分成三个名字、三份实现**：把 str 并进 safeStr 会让
 *   449 个调用点里原本显示 '5' 的全部变成空串；把 safeStr 并进 str 会让原本空串的
 *   全部显示 '[object Object]'。合成即造假等价，这是本仓反复付过代价的一条。
 *
 * 【为什么文件名叫 loose-str-face 而不是 str-face】
 *   config/str-face.js 已被 safeStr 占用（v4.196.0）。本文件治的是 **str** 这个名字，
 *   但导出名保持 `str`（调用侧 `str(x)` 一字不改，转调才是纯搬移）。
 *   文件名加 loose 前缀是为了让人一眼看出「这是宽松那份」，不与严格那份混淆。
 *
 * 【为什么没有 export default】
 *   本仓纪律（v4.193.0 立的）：内核不许留零消费出口。default 面若只有测试经
 *   `.default` 取它，就是「仅测试消费的 default 面」—— dead-exports 门的 E11
 *   判据会当场报红并要求二选一（产品端真接线，或登记进 TEST_ONLY_DEFAULT_LEDGER）。
 *   本文件只有一条口径、一个具名导出，产品端全部走具名导入，
 *   没有任何真实路径需要 default 面。故**刻意不设** default 出口。
 * ============================================================ */

/**
 * 宽松文本规整（**非串也 String() 成串，且 trim**，与那 24 份复制件逐字等价）。
 * 注意与另两份的分工：toStr（严格不 trim）/ safeStr（严格 trim）/ 本函数（宽松 trim）。
 * 把本函数并进 safeStr 会让数字 5 从 '5' 变成空串 —— 那不是收敛，是行为变更。
 * @param {*} v 上游读数
 * @returns {string}
 */
export function str(v) {
    return String(v == null ? '' : v).trim();
}