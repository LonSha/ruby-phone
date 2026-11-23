/* ============================================================
 * config/str-face.js — 全仓唯一的「字符串规整读取面」实现 [v4.196.0]
 * ------------------------------------------------------------
 * 【为什么有这份文件（实测起点，不是推演）】
 *   本版做了一次全仓同名函数体指纹扫描（v4.195.0 后新基线），实测结果：
 *     · 下面这个函数体在 apps 与 config 里有 **15 份逐字相同**：
 *         function safeStr(v) { return (typeof v === 'string') ? v.trim() : ''; }
 *       涉及 apps/wallet/economy-store.js 与 config 的 action-receipt / action-stack /
 *       auth-expiration / character-dwelling / economy-face-bridge / intent-relay /
 *       living-assets / recovery-hub / response-cadence / resume-anchor / rule-theatre /
 *       theme-pack / urban-economy / usage-paradigm，共 15 个文件，调用点约 166 处。
 *     · 另有 **3 份不同口径**（不属本次收敛，刻意未动）：
 *         · 11 份带 fallback 形：`(typeof val === 'string') ? val.trim() : fallback`
 *           —— 多一个「读不出时给什么」的入参，与本口径不是同一签名；
 *         · 9 份宽口径：`String(v == null ? '' : v).trim()` —— 会把数字 5 变成 '5'；
 *         · 1 份空串也走 fallback 的严格形：`(typeof val === 'string' && val.trim().length > 0) ? ...`
 *           四种口径混在一处收敛就是造假等价，故本文件只收变体 [0]。
 *
 *   同一口径复制 15 遍，就是「第 16 处会写错」的现场。这与 config/text-face.js
 *   治的 31 份 toStr 复制件、config/array-face.js 治的 16 份 safeArr 复制件是同一个病。
 *
 * 【本模块的裁定】
 *   · safeStr 是这条「字符串规整读取」口径的**唯一实现**；一律引用它，不再各自复制。
 *   · 口径**类型严格**：只收 string，非串（含 null / undefined / 数字 / 布尔 / 对象）一律空串。
 *     这里**刻意不**改成 `String(v == null ? '' : v).trim()` —— 那会让数字 5 变成 '5'、
 *     对象变成 '[object Object]'，是放宽口径不是等价转调。
 *   · **trim 在本口径之内**：本函数与 toStr 的唯一差别就是这一条。仓内这 15 份复制件
 *     本来就 trim（这是它们与 toStr 分工的原因），收敛时把 trim 并进来是**等价**的；
 *     反之若为了「与 toStr 一致」而把 trim 拿掉，那才是行为变更。
 *     调用侧**不许**再写 `.trim()`（会变成双重 trim）—— 需要不 trim 的原文，用 toStr。
 *   · 空串是**如实回答**，不是兜底值：读不出字符串就给空串，让调用侧自己判。
 *     「读不出时该给什么」若真有业务含义，那是 fallback 形（带第二个入参）的事，
 *     不在本文件口径内 —— 强行并进来会让两种语义共用一条实现。
 *
 * 【与 text-face.js / array-face.js 的分工（不许互相顶替）】
 *   text-face.js 回答「这一格是不是字符串」（不 trim，保留原文）；
 *   本文件回答「这一格是不是字符串，是就给它规整后的样子」（trim）；
 *   array-face.js 回答「这一格是不是数组」。三者是读入面的三种格子，不是三份可互换的实现。
 *
 * 【为什么没有 export default】
 *   本仓纪律（v4.193.0 立的）：内核不许留零消费出口。default 面若只有测试经
 *   `.default` 取它，就是「仅测试消费的 default 面」—— dead-exports 门的 E11
 *   判据会当场报红并要求二选一（产品端真接线，或登记进 TEST_ONLY_DEFAULT_LEDGER）。
 *   本文件只有一条口径、一个具名导出，产品端全部走具名导入，
 *   没有任何真实路径需要 default 面。故**刻意不设** default 出口，
 *   也不为「与 text-face.js 看起来一致」而补一个 —— 一致性是消费面的一致，不是装饰的一致。
 * ============================================================ */

/**
 * 字符串规整读取（**只收字符串且 trim**，与那 15 份复制件逐字等价）。
 * 非串一律给空串 —— 空串表示「这里没有字符串」，不是兜底值。
 * 注意：本函数自带 trim，调用侧不要再 .trim()（那会变成双重 trim）。
 * @param {*} v 上游读数
 * @returns {string}
 */
export function safeStr(v) {
    return (typeof v === 'string') ? v.trim() : '';
}
