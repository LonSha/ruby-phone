# Agent Note: RubyPhone 第十一期拓展与独有机制计划
Status: proposed

> 与 [第十一期优化提升计划](../../architecture/2026-10-29-product-optimization-v11.md) 同一期号口径
> （R9 = 第九期、R10 已被 v4.85.0 占用、本份为**第十一期**，文件名 v11）。
>
> **分工**：优化侧（R11-O*）治「已建的东西没人用」的**判定与清账**；本份（R11-X*）治
> 「把已建的东西接成**用户碰得到的产品面**」，一律**不开新机制、不缝新上游**。
> 依据：`config/*.js` 264 件里 76 件产品端零 import、15 件零 import 完全孤岛 ——
> 这不是缺功能，是缺入口。每条都写明「接哪个已建件 → 落在哪个 App → 用户看到什么」。

## Problem

本仓已建成的能力面比产品面大得多。实测（2026-10-29，复算命令见证据页）：

- `config/*.js` **76 件**只被 `subsystem-orchestrator.js` + 测试引，**产品端零 import**；
  **15 件**零 import 完全孤岛（`club-coop`/`mystery-engine`/`reading-studio`/`time-env`/`voice-narrative` 等）。
- 那些件不是空壳：`inventory-backpack`（背包）、`character-dossier`（人物档案）、
  `volume-chronicle`（卷宗）、`urban-economy`（城市经济）、`living-assets`（活体资产）、
  `usage-paradigm`（使用范式）、`sharing-boundary`（分享边界）、`spotlight-universal-search`（全局搜索）、
  `system-notification-dispatcher`（通知派发）、`smart-gallery-vault`（相册保险箱）、
  `life-program-replay`（人生回放）……每一件都是完整实现。
- 而**用户侧一个入口都没有**：`subsystems` 在全库只出现 2 处（`index.js:2050` 装配 / `2070` 取自检），
  **没有一处读业务能力**；25 个实例里 19 个连 orchestrator 内部都没用过。

⇒ 本仓这一期的拓展，正确形态不是「再做十八项」，而是**把已建的十八项接出可见入口**。
九项按「用户能一口气摸到的一族能力」分组，每族一个落点 App，组内件必须能串起来讲一件事。

## Proposal

### R11-X1 · 人物档案面：背包 / 档案 / 卷宗三件接成「档案 App」

- **接**：`config/inventory-backpack.js`（`InventoryBackpackManager`）、
  `config/character-dossier.js`（`CharacterDossierManager`）、`config/volume-chronicle.js`（`VolumeChronicleManager`）
  —— 三个类共 0 产品读、0 内部使用。
- **落点**：`apps/chars/`（角色 App）新增「档案」二级页；`apps/diary/` 的卷宗视图复用 `VolumeChronicleManager`。
- **用户看到什么**：点开角色 → 看到该角色的随身物（背包）、关系与关键记录（档案）、
  按时间切卷的回顾（卷宗，`第N卷 / 时间范围 / 重大事件数`）。
- **不许**：把它做成一个只读列表塞到设置里。每块要有**可操作点**（背包可增减、档案可标注、卷宗可跳转到对应楼层）。
- **验收**：真机从角色 App 点进三级页能看到三块数据且均非空；改角色数据后重进即变；
  破坏任一处装配 ⇒ 当版套件红。
- **规模**：**2 天**。

### R11-X2 · 交易与资产面：经济链 / 交易栈 / 活体资产接成「钱包 App」

- **接**：`config/urban-economy.js`（`executeTransaction`）、
  `config/crossapp-transaction-stack.js`（`createTransaction/appendTransactionStep/commitTransaction/executeRollback`）、
  `config/living-assets.js`（`mintAsset/transferAsset`）、`config/lineage-living-assets.js`（`transitionLivingAsset`）。
- **落点**：`apps/wallet/`、`apps/ledger/`、`apps/asset/` 三处共用一条账单真源。
- **用户看到什么**：一笔转账在钱包里发起 → 台账里有一行 → 资产页对应物件归属变了 → **可以撤销**（回滚留下痕迹）。
- **独特机制**：`crossapp-transaction-stack` 的「跨 App 事务 + 回滚」是全仓少有的真机制；
  它现在的处境是「import 进 orchestrator 然后没人调」。本项把它变成**用户能点的撤销按钮**。
- **不许**：把回滚做成静默恢复（用户看不见）。回滚必须留下可见的「已撤销」痕迹。
- **验收**：发起→提交→撤销三步在真机各留一条可见记录；撤销后余额与归属回到原值；
  中途失败时状态是「部分完成」而不是「成功」。
- **规模**：**2 天**。

### R11-X3 · 生活流真运行：自驱日程 / 日历引擎 / 日常节律 / 响应节律接成「会自己动的手机」

- **接**：`config/autonomous-life-scheduler.js`、`config/calendar-autonomous-life.js`、
  `config/daily-rhythm.js`、`config/response-cadence.js`。
- **现状**：这 4 件被 `advanceAutonomousLifeStep` 驱动，而该方法**产品端零调用、全库只有测试 1 处**。
  ⇒ 手机永远不会自己推进时间，所谓「自驱生活」只在测试里存在。
- **落点**：手机外壳一个**低频时钟**（前台可见的「今日已推进 N 步」指示）+ `apps/calendar/` 的今日视图。
- **用户看到什么**：放着不动一段时间后，日历上多出按节律生成的事件，通知中心出现对应提醒；
  点历史能看到「这一步为什么发生」（读 `advanceAutonomousLifeStep` 的返回形状）。
- **不许**：用 `setInterval` 无节制推进（会污染存档）；必须**可暂停**且推进量落盘可查。
- **验收**：静置 30 分钟 → 日历真多出事件且能说出触发来源；暂停后不再增长；
  存档重载后推进计数连续；破坏时钟装配 ⇒ 套件红。
- **规模**：**2.5 天**（本期最重一件：涉及存档与时间语义）。

### R11-X4 · 分享与迁移面：分享边界 / 恢复中枢 / 创作包接成「可审阅的出口」

- **接**：`config/sharing-boundary.js`（`buildShareDraft/previewRecipientView/markRecipientRead/revokeShare`）、
  `config/portable-recovery-hub.js`（`inspectBackupPayload`）、`config/recovery-hub.js`
  （`createSnapshot/computeSnapshotDiff/restoreSnapshot`）、`config/offline-creator-bundle-pipeline.js`、
  `config/creator-bundle-ecosystem.js`。
- **落点**：`apps/backupdesk/`（备份）、`apps/accessdesk/`（权限）、新增一条「分享」出口（挂在被分享内容所在 App）。
- **用户看到什么**：分享前能看到**收件人视角预览**；分享后可撤销；导入备份前能看到
  「会影响哪些消息/角色/分支」的影响范围（`resume-workbench` 已有此形态，可直接借用口径）。
- **独特机制**：`sharing-boundary` 的「受众名单 / 已读账 / 未看不许互动」是缝自上游熟人动态的知情治理一族，
  产品端一次没用过。
- **不许**：导入直接覆盖（无预览、无 diff）。
- **验收**：预览页真能显示收件人可见范围；撤销后对方入口消失；导入前 diff 列出将改动的键数；
  拒绝导入时原数据逐字节不变。
- **规模**：**2 天**。

### R11-X5 · 全局搜索接出：Spotlight 跨域搜索接进搜索 App

- **接**：`config/spotlight-universal-search.js`（`SpotlightUniversalSearch` + `SEARCH_DOMAINS`）。
- **现状**：这是一个带域清单的完整搜索内核，产品端零 import。
- **落点**：`apps/search/`（搜索 App）；同时作为 `R11-O7`「应用库」搜索的后端（若选 A）。
- **用户看到什么**：一处输入框，命中聊天 / 角色 / 日记 / 相册 / 台账 / 世界书多域，
  结果按域分组并标出命中位置；空结果与**域缺席**（某域无数据）**不同形**。
- **不许**：三态同形（无结果 / 未搜到 / 域不可用 都显示「没有匹配」）。
- **验收**：至少 4 个域真出结果；某域数据被清空时显示「该域暂无数据」而非「无匹配」；
  200 条以上结果时首屏 < 300ms（可读分页或虚拟滚动）。
- **规模**：**1.5 天**。

### R11-X6 · 通知汇聚：派发器接进通知中心（先让中枢这一个实例真活）

- **接**：`config/system-notification-dispatcher.js`（`SystemNotificationDispatcher`）。
- **现状**：它是 25 个实例里**唯二**在 orchestrator 内部有使用的（`advanceAutonomousLifeStep` 里 2 处），
  但产品端Notifications App **没读中枢那个实例**。
- **为什么单列**：这是本期**最小、最快能证明「中枢能通向产品」**的一件 ——
  做完它，`R11-O3` 的清账就有了可复制的模板（装配点 / 触发时机 / 可见反馈三件套）。
- **落点**：`apps/notifications/`。
- **用户看到什么**：中枢派发的通知出现在通知中心，带优先级、可聚簇、可标记已读；
  `URGENT` 级能穿透免打扰。
- **不许**：在 App 侧另建一个数组冒充（那会变成两份真源）。
- **验收**：中枢派发一条 ⇒ App 里出现一条（同一个对象，不是副本）；标记已读回写中枢；
  清空后 `getClusteredNotifications` 返回空且不抛。
- **规模**：**1 天**。

### R11-X7 · 使用范式：按场景切桌面与通知过滤

- **接**：`config/usage-paradigm.js`（`resolveActiveParadigm/switchParadigm/saveCustomParadigm/
  resolveAppOrder/filterNoticesByParadigm`）。
- **落点**：`apps/settings/` 一个「使用范式」入口 + 桌面排序生效。
- **用户看到什么**：切到「工作范式」后桌面 App 顺序变了、通知按范式过滤；自定义范式可存可删。
- **与 O7/O6 的关系**：范式提供的是**用户侧**的桌面组织能力，与聚合壳（分类）是两套正交机制 ——
  头注里必须写清「壳管分类、范式管优先级、库管全量搜索」，否则三套会互相打架。
- **验收**：切换范式 ⇒ 桌面顺序真变且重载保留；被过滤的通知在中心里显示「已按范式隐藏」而非消失；
  未知范式回落默认且不抛。
- **规模**：**1 天**。

### R11-X8 · 拟真读数面：电池 / 信号 / 手环接成状态栏与健康 App 的真数据

- **接**：`config/battery-thermodynamics.js`、`config/cellular-signal-sim.js`、`config/smart-band-biometrics.js`。
- **现状**：三件都在 `advanceAutonomousLifeStep` 里被驱动（`battery@668`/`cellular@671`/`smartBand@676`），
  但产品端零读 —— 状态栏的电池仍是 `phone-shell.js:218` 自己算的**另一套**。
- **落点**：状态栏（`phone/phone-shell.js`）+ `apps/health/`。
- **用户看到什么**：状态栏电量百分比与中枢模型一致；弱网时状态栏真降级；
  健康 App 能看到手环心率随「情境」（`PANIC` 等）变化的历史曲线。
- **不许**：两套电量并存（现状）。必须先定**唯一真源**再改，否则是制造第二个不一致。
- **验收**：状态栏读数与 `battery` 实例读数恒等（同一渲染帧）；弱网态可见；
  健康 App 曲线有 ≥10 个点且可回溯；把中枢实例换成桩 ⇒ 状态栏报「数据缺失」而不是显示旧值。
- **规模**：**1.5 天**。

### R11-X9 · 记忆与回放面：人生回放 / 可回放程序 / 相册保险箱接成「回看」

- **接**：`config/life-program-replay.js`（`recordLifeProgram/getActPerspective/playbackProgramSummary`）、
  `config/replayable-phone-program.js`（`createReplayableProgram/replayProgramStepByPerspective`）、
  `config/smart-gallery-vault.js`（`SmartGalleryVault`）。
- **落点**：`apps/album/` 新增「回看」页 + `apps/memory/` 的幕次视图。
- **用户看到什么**：按「幕」回看一段时间里发生的程序（聊天/日程/交易），可切**视角**
  （本人 / 对方 / 旁观）；影像按事件归组并有保险箱分区。
- **独特机制**：`getActPerspective` 的「同一段经历的多视角」是本仓独有的表达，
  但产品端零读 —— 这一项把它变成用户真能翻的东西。
- **不许**：回看时重新生成内容（会与存档不一致）；必须是**读取已落盘记录**。
- **验收**：任一幕能切三视角且内容不同；回看内容与存档逐字段一致；保险箱内容不出现在普通相册列表。
- **规模**：**2 天**。

## Delivery sequence

1. **先做 X6**（1 天）：最小可证的「中枢 → 产品」通道，给后面 8 项定装配模板。
2. **再做 X1 / X2 / X5**（5.5 天）：三族最"有物可看"的已建资产（档案 / 钱 / 搜索）。
3. **然后 X3 / X8**（4 天）：让手机**自己动起来**并把读数收敛成唯一真源。
4. **最后 X4 / X7 / X9**（5 天）：出口（分享与迁移）、组织（范式）、回看。

**依赖**：X6 必须先于其余各项（模板）；X3 必须先于 X8（X8 的读数来自 X3 的推进）。
**与优化侧的关系**：优化侧 O1/O2 是**判据**前提，本份 X* 是**内容**；两边可并行，
但 X* 的验收**必须**用 O1/O2 之后的新判据跑一遍，否则会重演「接完仍判绿」。

## Alternatives considered

- **再做一批新机制**：否决。76 件已建件产品端零 import，再加机制只是把分母做大。
- **把九项合成一个「超级面板 App」**：否决。用户碰不到的东西堆在一个面板里等于没接；
  每族必须落在**用户本来就会打开的那个 App**。
- **只接 X6 就收工**：否决但可作阶段性交付。X6 证明通道，剩下八项才是产品收益。
- **让 orchestrator 直接渲染 UI**：否决。中枢是数据层，UI 归 App；跨层会重演上游「大对象串味」的老病。

## Acceptance criteria

- 每项都要有**真机可点的入口**（不是 API、不是控制台）；
- 每项都要写清「数据从哪来、落到哪、用户看到什么」三句；
- 每项都要带**破坏负控制**：把装配点破坏 ⇒ 当版套件红且**界面显示「数据缺失」**（不是一个空列表）；
- 不允许新增第二份真源（X8 的电量、X6 的通知数组是两个必须守住的例子）。

## Risks

- **X3 是最大风险**：自主推进涉及存档与时间语义，写坏会污染用户数据。
  纪律：先落盘「推进日志」，再改状态；暂停必须真停；不允许无上限推进。
- **X2 / X4 涉及不可逆操作**（转账、导入）：必须先做预览与回滚，再做提交路径。
- **X8 撞两套真源**：改状态栏前必须先确认 `battery-thermodynamics` 的输出形状够渲染，
  否则会把不一致从「两套数」变成「一套坏数」。
- **X9 的「多视角」是表达层创新**：替身与门禁只能证结构一致，观感必须真机核。
- **本期依赖优化侧判据**：若 O1/O2 未落地就交付 X*，验收会退化成「数一数 UI 元素在不在」。