/* ============================================================
 * config/num-gate.js — 全仓唯一的「数值取值门」[v3.12.0]
 * ------------------------------------------------------------
 * 【为什么有这份文件】
 *   本仓最贵的一类错读数是 **`Number(null) === 0`**：
 *     · `Number(null)` / `Number('')` / `Number([])` 全是 `0`
 *     · `Number(true)` 是 `1`、`Number(false)` 是 `0`、`Number([5])` 是 `5`
 *   于是「上游**没给**这一格」与「上游**给了 0**」在 `Number.isFinite(Number(x))`
 *   这个写法下**塌成同一个读数** —— 而两者的处置常常相反
 *   （没给 ⇒ 等升级 / 报「读不到」；给了 0 ⇒ 真读数，0 是合法值）。
 *
 *   本仓为此治过四轮，每一轮都是「就地修那一处」：
 *     v3.3.1（O-8）  三份同名 `numOrNull` 统一为强口径（config/* 两份 + place-data）
 *     v3.3.0（O-2）  楼层取值门 `floorOrNull` 落地（memory-data / lonsha-bridge / index.js）
 *     v3.11.0        删楼回滚预览的「缺失不得兜底成 0」
 *     v3.12.0（本版）实测发现：**同一根因仍在全仓以「本地助手函数」的形态复现** ——
 *                    `function num(v) { return Number.isFinite(Number(v)) ? Number(v) : null; }`
 *                    在 wallet / profile / plotline / memory-insights 各有一份，
 *                    且 v3.11.0 刚改过的 `config/rollback-preview.js` 里仍残留 3 处同族写法。
 *                    这说明**逐处修**不是解 —— 只要「口径」本身没有**单一实现**，
 *                    下一个写取值函数的人（或同一个人的下一次）就会再写一遍弱的那版。
 *
 * 【本版的做法】把口径从「各边界自持同口径门」升级为「**全仓一份实现**」：
 *   · 本文件是**零依赖叶子模块**（不 import 任何东西）⇒ 谁都可引用而不引入循环；
 *   · `numOrNull` 是唯一的数值取值门；`apps/**` 与 `config/**` 一律引用它，
 *     不再各自复制一份（复制件即下一个漏网处）；
 *   · 配套门禁 `scripts/weak-coercion-audit.mjs` 常驻守卫：
 *     全仓出现同族弱口径写法即红灯（详见该脚本文件头）。
 *
 * 【判据面（不是文字主张）】弱口径 `Number.isFinite(Number(v)) ? Number(v) : null`
 *   与强口径的输入对读差，实测 **19 输入 / 10 条分歧**：
 *     ''  → 0    | '  ' → 0    | ' \t ' → 0 | '\n' → 0
 *     []  → 0    | [''] → 0    | [5] → 5    | [3] → 3
 *     true → 1   | false → 0
 *   这 10 条即「要修什么」的判据（已固化在 tests/system-v3120.test.mjs）。
 *   反向面同样要守：`0` / `'0'` / `5` / `'5'` / `' 5 '` / `3.5` 必须**如实出数**
 *   —— 门不得关成「谁都取不到」（反坐实判据）。
 *
 * 【设计约束】
 *   · 只导出 `numOrNull`。需要「楼层」语义的调用方写
 *     `import { numOrNull as floorOrNull } from '…/config/num-gate.js'`，
 *     保留局部命名而实现唯一（不新增第二份实现、不新增第二个门）。
 *   · 本模块**不做取整**（`Math.floor` / `Math.round` 由调用方按语义自行决定）：
 *     取整是业务语义，不是「取值」语义。
 *   · `±Infinity` / `NaN` 一律判「没给」（`Number.isFinite` 兜住）：
 *     畸形数在读数面上与「没给」同形是**有意的** —— 本模块只回答
 *     「这格有没有可用的数」，不回答「为什么没有」。
 * ============================================================ */
/**
 * 数值取值门：只认 `number` 与非空数字字符串，其余一律如实 `null`。
 *
 * @param {*} v 上游读数
 * @returns {number|null} 可用的有限数；无法判定时 `null`（**不编 0**）
 */
export function numOrNull(v) {
    if (typeof v !== 'number' && typeof v !== 'string') return null;
    if (typeof v === 'string' && !v.trim()) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
}
