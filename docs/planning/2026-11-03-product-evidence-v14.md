# RubyPhone 第十四期：源码证据、差异化与执行批次

日期：2026-11-03。规划快照：v4.118.0 / `4d3420acf6b97296acdcbcd146aa5ccadd556230`，顶层测试文件370个。创建前`git status --short`为空。这里只记录本地已读事实；本轮未复跑全量测试、未联网核对远端、未验证真实酒馆宿主。

[优化九项](../../.agents/notes/proposed/architecture/2026-11-03-product-optimization-v14.md) · [拓展九项](../../.agents/notes/proposed/feature/2026-11-03-product-expansion-v14.md)

## 现场复核与旧信息纠偏

- v4.118.0与提交`4d3420a`一致；88个App目录对应89个登记App，不把差1报为本期新增缺陷。
- 已提交`browser_readings.json`是组合回放：14场景/596读数/138失败。上一轮最终check记录是608读数/140已知失败/新增0；两组证据来源不同，本轮未复跑，不合并成单次全绿。
- 组合回放中search-cancel有48失败、data-states有16失败，长列表两场景各16失败。这些是读数数量，不能等同缺陷数量；O1/O2/O7须分产品根因、驱动根因和稳定性。
- `open-ref.js`与`source-locator.js`已实现精确打开协议；O3核查五条真实消费路径，不再创建另一套导航协议。
- `inline-action-commit.js`已有真日历提交和undo，`edit-buffer.js`已有未保存保护。O4/O5补多场景覆盖和持续回执，不将旧能力算新增。
- `undo-capability.js`明确声明“有回退入口不保证每个恢复器都正确”；O6做逐类恢复旅程。
- `setting-effect.js`已有176项声明，上一轮说明只有三种设置各一个真控件走统一口；O9必须追读写行为，不以覆盖表100%代替生效证明。
- R13-X9只读反向投影已落地；对方备注absent、第三人会话无源、未读/拉黑方向不成立继续保留。本期不扩成无源设备模拟。

## 历史提案审计与增量分类

已按模块、机制词和历次拓展标题检索活跃笔记，排除archived。以下是本次规划相关性分类，不修改历史实施状态；没有把旧提案整体吸收或宣布失效。

- [2026-10-04-optimization-plan](../../.agents/notes/proposed/architecture/2026-10-04-optimization-plan.md)：部分重叠：保留底座理由；本期仅承接有新增验收的用户旅程，旧待办不自动重开。
- [2026-10-08-optimization-plan-v2](../../.agents/notes/proposed/architecture/2026-10-08-optimization-plan-v2.md)：部分重叠：保留底座理由；本期仅承接有新增验收的用户旅程，旧待办不自动重开。
- [2026-10-12-product-optimization-v3](../../.agents/notes/proposed/architecture/2026-10-12-product-optimization-v3.md)：部分重叠：保留底座理由；本期仅承接有新增验收的用户旅程，旧待办不自动重开。
- [2026-10-15-product-optimization-v4](../../.agents/notes/proposed/architecture/2026-10-15-product-optimization-v4.md)：部分重叠：保留底座理由；本期仅承接有新增验收的用户旅程，旧待办不自动重开。
- [2026-10-20-product-optimization-v5](../../.agents/notes/proposed/architecture/2026-10-20-product-optimization-v5.md)：部分重叠：保留底座理由；本期仅承接有新增验收的用户旅程，旧待办不自动重开。
- [2026-10-22-product-optimization-v6](../../.agents/notes/proposed/architecture/2026-10-22-product-optimization-v6.md)：部分重叠：保留底座理由；本期仅承接有新增验收的用户旅程，旧待办不自动重开。
- [2026-10-24-product-optimization-v7](../../.agents/notes/proposed/architecture/2026-10-24-product-optimization-v7.md)：部分重叠：保留底座理由；本期仅承接有新增验收的用户旅程，旧待办不自动重开。
- [2026-10-24-product-optimization-v8](../../.agents/notes/proposed/architecture/2026-10-24-product-optimization-v8.md)：部分重叠：保留底座理由；本期仅承接有新增验收的用户旅程，旧待办不自动重开。
- [2026-10-24-product-optimization-v9](../../.agents/notes/proposed/architecture/2026-10-24-product-optimization-v9.md)：部分重叠：保留底座理由；本期仅承接有新增验收的用户旅程，旧待办不自动重开。
- [2026-10-29-product-optimization-v11](../../.agents/notes/proposed/architecture/2026-10-29-product-optimization-v11.md)：部分重叠：保留底座理由；本期仅承接有新增验收的用户旅程，旧待办不自动重开。
- [2026-10-31-product-optimization-v13](../../.agents/notes/proposed/architecture/2026-10-31-product-optimization-v13.md)：部分重叠：第十三期交付底座和遗留边界，双向链接接管后续排序。
- [2026-10-04-expansion-plan](../../.agents/notes/proposed/feature/2026-10-04-expansion-plan.md)：部分重叠：保留底座理由；本期仅承接有新增验收的用户旅程，旧待办不自动重开。
- [2026-10-08-expansion-plan-v2](../../.agents/notes/proposed/feature/2026-10-08-expansion-plan-v2.md)：部分重叠：保留底座理由；本期仅承接有新增验收的用户旅程，旧待办不自动重开。
- [2026-10-12-product-expansion-v3](../../.agents/notes/proposed/feature/2026-10-12-product-expansion-v3.md)：部分重叠：保留底座理由；本期仅承接有新增验收的用户旅程，旧待办不自动重开。
- [2026-10-15-product-expansion-v4](../../.agents/notes/proposed/feature/2026-10-15-product-expansion-v4.md)：部分重叠：保留底座理由；本期仅承接有新增验收的用户旅程，旧待办不自动重开。
- [2026-10-20-product-expansion-v5](../../.agents/notes/proposed/feature/2026-10-20-product-expansion-v5.md)：部分重叠：保留底座理由；本期仅承接有新增验收的用户旅程，旧待办不自动重开。
- [2026-10-22-product-expansion-v6](../../.agents/notes/proposed/feature/2026-10-22-product-expansion-v6.md)：部分重叠：保留底座理由；本期仅承接有新增验收的用户旅程，旧待办不自动重开。
- [2026-10-24-product-expansion-v7](../../.agents/notes/proposed/feature/2026-10-24-product-expansion-v7.md)：部分重叠：保留底座理由；本期仅承接有新增验收的用户旅程，旧待办不自动重开。
- [2026-10-24-product-expansion-v8](../../.agents/notes/proposed/feature/2026-10-24-product-expansion-v8.md)：部分重叠：保留底座理由；本期仅承接有新增验收的用户旅程，旧待办不自动重开。
- [2026-10-24-product-expansion-v9](../../.agents/notes/proposed/feature/2026-10-24-product-expansion-v9.md)：部分重叠：保留底座理由；本期仅承接有新增验收的用户旅程，旧待办不自动重开。
- [2026-10-29-product-expansion-v11](../../.agents/notes/proposed/feature/2026-10-29-product-expansion-v11.md)：部分重叠：保留底座理由；本期仅承接有新增验收的用户旅程，旧待办不自动重开。
- [2026-10-31-product-expansion-v13](../../.agents/notes/proposed/feature/2026-10-31-product-expansion-v13.md)：部分重叠：第十三期交付底座和遗留边界，双向链接接管后续排序。

同词表重叠是有意复用：如记忆传播/口述史/改观/承诺/资料更新/分席/修复/传承/季候，以及手机交流/邀约/规则/清单/织信/分享/旅行/事务/离线均已有底座。X面逐项新增的是可操作的过程、状态和跨步骤结果；若现有产品已完整满足验收则合并该子项，不另造同名引擎。

## 六个大批次

| 批次 | 用户结果 | 记忆侧三项 | 手机侧三项 |
|---|---|---|---|
| A | 可靠地留下与返回 | L14-O1 / L14-O8 / L14-O5 | R14-O1 / R14-O2 / R14-O3 |
| B | 改错与办事可以放心 | L14-O2 / L14-O6 / L14-O9 | R14-O4 / R14-O5 / R14-O6 |
| C | 长篇与长用都流畅 | L14-O3 / L14-O4 / L14-O7 | R14-O7 / R14-O8 / R14-O9 |
| D | 交流与约定形成过程 | L14-X1 / L14-X2 / L14-X4 | R14-X1 / R14-X2 / R14-X4 |
| E | 准备下一幕与持续活动 | L14-X3 / L14-X5 / L14-X6 | R14-X3 / R14-X7 / R14-X8 |
| F | 回访、交接与体验收口 | L14-X7 / L14-X8 / L14-X9 | R14-X5 / R14-X6 / R14-X9 |

A–F覆盖全部36项且每项只分配一次。每批每仓三项，预计3–5个有效开发日、双仓并行；总容量约18–30日。工时依赖真实缺陷和宿主可用性，实施前再拆任务，不按一次小版本只改一行分散交付。跨仓不共建公共库、不互相写内部状态；桥版本、会话身份、来源id、权限缺席和操作回执逐边界核对。

## 验证与范围

本轮只改计划和导航，不升版本、不改运行时代码、不提交推送。验证四份计划各九项、双向相对链接、36项批次完整性、现有规划基线生成器与git diff。实施期间按仓库纪律做定向测试；整期收口再跑本仓全量，不把两仓测试入口混用。历史浏览器红点和真实宿主未验保留，不能靠更新计划文件消除。

侦察完整读取了手机AGENTS/CONTEXT；对巨大宿主文件按相关函数/调用点阅读，对旧提案按相关章节和标题做去重，未通读两仓全部源码。因此此处“已有底座”由已见符号及调用支撑；潜在行为缺口是实施假设，须先重现，不写成已证实缺陷。

## 本轮规划交付核验

- 四份计划各9项；六批覆盖36项且每项只出现一次，两仓批次表一致。
- 两仓 `node tools/gen_plan_baseline.mjs --check` 通过；PLAN/TODO当期入口、基线及编号已核对。
- 第十四期新笔记以字节副本通过技能原版format/tree校验；实际页面相对链接另由本轮检查器检查，不以副本校验代替仓内链接核验。
- 全库笔记校验仍不通过：历史笔记存在头块/必备章节格式遗留；记忆侧另有旧feature生命周期目录及v12断链，手机侧有v11断链。本轮不扩成历史治理，未声称全库校验通过。已修正本轮触及的记忆侧v13证据页和优化笔记链接。
- 改动仅Markdown文档；版本文件、更新日志、运行时代码和测试源码未改，未执行全量回归、真实酒馆测试或提交推送。
