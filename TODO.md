# TODO / 迭代积压

> 自主迭代模式下的待办清单。按「先修缺陷 → 再优化体验 → 后加功能」排序。
> 每轮迭代完成后更新（完成项移入 `ITERATION_LOG.md` 对应迭代并在此删除）。

---

## P0 · 缺陷 / 防回归（优先做）

- [ ] **生命周期审计门禁固化**（迭代 3，v2.65.0 目标）
  - 现状：迭代 1/2 的三个探针（`probe_lifecycle.mjs` / `probe_slots.mjs` / `probe_slots2.mjs`）
        仅存在于 `/tmp/`，一次性。
  - 目标：`scripts/lifecycle-audit.mjs` + `scripts/lifecycle-baseline.json`，
        串进 `npm run check`（与 `syntax` / `test` / `dead-exports` 并列）。
  - 判据合并两个审计面：**方法出口**（迭代 1）+ **槽位 × 三路径矩阵**（迭代 2）。
  - **难点（已实测）**：需先建三张白名单，否则常驻假阳性：
    1. **数组泛化调用**：`releasePhoneInactiveResources()` 的 `appEntries` 数组
       （wechat / phone / honey / games / music / weibo / diary / calendar / album / mofo / settings）
       以 `[id, app]` 元组形式间接调用 `deactivate`，静态正则识别不到；
    2. **更强出口覆盖**：`deactivate` ⊃ `destroy`（如 `honeyApp`）；
    3. **咽喉点收口**：`gamesApp` / `worldpulseApp` 由 P2/P3 的
       `reloadPhoneSurface() → retireSessionScopedSlots()` 统一回收，不在本处三路径写字面量。
  - **区间边界必须精确**：探针首版用近似区间导致 P2 与 P1 重叠、把 P1 的行误算成 P2 命中。
    P1 的锚点是 `function onChatChanged()` → `function getContext()`（P1 是被调用的函数，不是监听器）。
  - 附加要求（源自既有教训）：负控制必须是**真源码破坏 → 在破坏副本上重跑同款真判据**，
    不得对原文件断言、不得把破坏写成模拟常量、判据不得引用锚点串（三种假绿形态）。

## P1 · 体验 / 一致性

- [ ] **README 版本段落补账**：README 现有段落止于 v2.60.0，v2.61.0（资产 App）/
      v2.62.0（搜索补源 + 覆盖度分页）/ v2.63.0（会话生命周期接线收口）/
      v2.64.0（槽位审计 + 万象隔离缺口）四段未收录。补账时保持既有「功能小节 + 要点列表」体例。
- [ ] **`config/storage.js` 会话键前缀宽匹配收紧**：`/^ruby_/` 与 `/^games_*/` 覆盖过多，
      使注册对账审计（APPS id ↔ 键前缀）无法逐项精确核对，长期靠人工辨伪。
      收紧前须先盘点存量键，避免把历史数据判为「无前缀」而误清。

## P2 · 功能 / 架构

- [ ] （待评估）会话切换生命周期出口的**声明式注册**：让每个 App 自声明其出口与
      覆盖关系（如 `static lifecycleExits = { onChatChanged: {...} }`），
      由框架统一调用，从根上消除「写了出口但没人调」与「槽位没人回收」两类形态。
      与 v2.55 的 REBIND 表驱动同源思路，但覆盖面从「重绑」扩到「回收」。

---

## 已完成（归档，详见 ITERATION_LOG.md）

- [x] **v2.63.0** 会话生命周期接线收口：`memoryApp` 接线 + `timeweaverApp.onChatChanged` +
      `_calendarReminderApp` 回收单一真源（含两处实例覆盖点前置回收）
- [x] **v2.64.0** 会话级「槽位 × 三路径」审计：修 `wangxiangApp` 只在换会话路径被清理
      （补 `onChatChanged` 并接入 REBIND 单一真源，收敛 P1 重复显式调用）
