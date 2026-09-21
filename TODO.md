# TODO / 迭代积压

> 自主迭代模式下的待办清单。按「先修缺陷 → 再优化体验 → 后加功能」排序。
> 每轮迭代完成后更新（完成项移入 `ITERATION_LOG.md` 对应迭代并在此删除）。

---

## P0 · 缺陷 / 防回归（优先做）

- [ ] **注册联动审计固化**（迭代 4 候选，v2.66.0 目标）
  - 现状：迭代 1 的 `audit_registrations.mjs`（APPS id ↔ `index.js` 懒加载分支 ↔
        `config/storage.js` 会话键前缀，三方对账）只在 `/tmp/`，一次性。
  - 目标：并入 `scripts/lifecycle-audit.mjs` 或另立 `scripts/registry-audit.mjs` 并串进 check。
  - 难点：`/^ruby_/`、`/^games_*/` 等**宽匹配**覆盖过多，逐项对账会被判「无前缀」；
        需先把宽匹配展开为等价字面量集合（或允许前缀到 APPS id 的多对一映射）。

## P1 · 体验 / 一致性

- [ ] **README 版本段落补账**：README 现有段落止于 v2.60.0，v2.61.0（资产 App）/
      v2.62.0（搜索补源 + 覆盖度分页）/ v2.63.0（会话生命周期接线收口）/
      v2.64.0（槽位审计 + 万象隔离缺口）/ v2.65.0（生命周期接线门禁）五段未收录。
      补账时保持既有「功能小节 + 要点列表」体例。
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
- [x] **v2.65.0** 生命周期接线门禁固化：`scripts/lifecycle-audit.mjs`（L1 方法出口 / L2 槽位覆盖 /
      L3 白名单源码派生 / L4 枚举面自证）+ `tests/system-v265.test.mjs`（10 条，含 5 例真源码破坏）

---

## ⚠️ 事故与纪律（务必遵守）

- **血泪教训（v2.65.0 开发期）**：**绝不对真仓库执行 `cp -al` / 硬链接复制**。
  本环境该操作会把已跟踪文件替换成指向临时 l2s 收容所名字的符号链接，造成工作区大面积损坏
  （本次 425 个文件；`git status` 全报 `Operation not permitted`）。
  - 需要副本做破坏性负控制时：走**夹具通道**（合成最小仓库 + `RP_*_FIXTURE=1`），
    与 `scripts/dead-export-check.mjs` / `scripts/lifecycle-audit.mjs` 同款；
  - 确实需要整树副本时先 `tar` 备份，并优先只用判据的真实输入面（如 `index.js` + `apps/**/*-app.js`）；
  - 恢复路径：`git status` 若只显示 `T`（类型变化）而无 `M`（内容修改），
    内容可信，可直接 `git checkout -- .` 从索引恢复。
