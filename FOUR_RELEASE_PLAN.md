# 双项目四批交付跟踪

状态：实施中，未发布。用户已授权四批及后续自主迭代；不把代码、自动化、实机验收混同。
基线：LonSha 3.212.0 / RubyPhone 3.0.0，工作区原始干净；1673断言+42审计、835测试+九门日志通过。旧启动未记录退出码，新门禁必须记录。
当前：LonSha 3.212.0（R1-A/R1-C 已落，提交 `9d14ec0` / `012bd2f` 已推送）/ RubyPhone 3.0.1（R1-D 已落，提交 `d6c1041` 已推送）。

## 全范围与验收
1. **可信数据与可查记忆**（O1、O2基础、O6、F1/F2）：业务字段需求表；投影同源身份/修订/时间/权限；工作台与证据查询、修复预览确认及真实传播回执。隐藏不可旧桥回退，缺席≠空，切会话和过期不能冒充当前正常。
2. **准确记忆与受控行动**（O3/O4、O2保存、F3/F4）：固定剧情质量集，最终实际注入/预算/去重，取消和迟到隔离，约定→日历→提醒→处理→回执，双向关系/知情网络。幂等、修订校验；人工计划≠正文事实。
3. **长线生活与社交生态**（O5、O2长线、F5/F6）：先测量再优化、长列表及后台恢复；地点层级与剧情日程冲突；唯一事件传播、渠道权限、误传澄清和频率约束。1000楼压力及增长/监听器检查，不虚报实机性能。
4. **分支与玩法拓宽**（O2隔离增长、O6维护、F7/F8）：持久检查点/回滚预览/分支只读对照；四类可选玩法包及主动候选，暂停预览拒绝；旧分支不召回、关闭无残余注入。不自动合并互斥分支、不默认跨会话共享。

每批：完整用户流程、跨仓兼容、失败重试/回滚/切聊、测试与审计、版本公告同源、离线包；实机缺证必须显式记录。版本号在该批功能和门禁就绪后才抬，不为零散修复凑发布。

## 不动范围
存储归属/外部数据库/依赖体系/用户存档/凭据/原作者仓库；不重造既有事实、秘密、伏笔、迁移和修复机制。Windows结构规范当前不可读，已告知用户，遵循仓内现有规范。

## Gate R1-A：投影缺席语义
- Structural: Local Fix；Execution: Local Fix Only；授权：approved local fix（四批授权内）。
- 证据：真实 runPipeline provider返回undefined，object形状被归为empty，summary.absent=0；null同态；0正常value。
- 契约：undefined保持absent，显式null按声明空形归empty；0不改；API1/函数形状/存储/模块加载不变。
- 允许：projection-pipeline.js 与 tests/projection-absence.test.mjs；预算80行，另本计划文档。
- 验证：新回归先红后绿、旧v3208/v3212、全量test:audit；不删除功能。
- 回滚：仅逆转该小补丁及新增测试；出现历史契约冲突回AUDIT，不放宽门禁。
- 子agent：DeepSeek R1-A提供候选，我方真实模块复现。API Key不写入仓库。

## Gate R1-C：投影的导出期新鲜度（比「归属」，不比「时刻」）
- Structural: Local Fix；Execution: Local Fix Only；授权：approved local fix（四批授权内）。
- 归属仓：**lonsha-memory-plugin**（上游导出侧）。本档在两边同步留痕：该 Gate 的改动面全在上游，
  但**消费侧（RubyPhone）是唯一受害者** —— 下游读到的「谁的投影」由上游导出期决定，故两侧各留一份。
- 证据：`_lastProjectionEnvelope` 的归属（conversationId + revision）只在 `readWorldLedger()` →
  `_buildProjectionEnvelope()` 写入的那一刻成立。切聊（CHAT_CHANGED）换 chatId、回滚/恢复（`_bumpEpoch`）
  只递增 `_mutationEpoch`，两条路径**都不清该缓存**；`buildBridgeSnapshot()` 于是把旧会话/旧代数的
  投影当作当下读数导出（不报错、只错结果）。
- 契约：同会话同代数 ⇒ 照常导出；会话或代数不符 ⇒ 不导出（`projection` 为 undefined ⇒ 自述 present=false）
  并留痕；取不到 chatId ⇒ 放行，原契约不变（拿不到判据不等于证伪）。`generatedAt` 只记生成时刻、
  不携带归属，改时间戳等于把陈旧内容伪装成新鲜，故只比对会话+代数。
- 允许：index.js（buildBridgeSnapshot 新鲜度守卫 + `snap.meta.projectionFreshness` 归因字段）、
  tests/v3213_projection_cache_freshness.test.mjs、catalog_reference_consumers.tsv 一行、本计划文档。
  上游预算 3 文件 / 60 行。
- 验证：新回归先红后绿；v3212/v3174/projection-absence 联合 35 项通过；全量 test:audit RC=0。
- 回滚：仅逆转该小补丁及新增测试；出现历史契约冲突回 AUDIT，不放宽门禁。
- 子agent：DeepSeek R1-C 提供候选（主张**读取期校验**而非新增清理点：`_mutationEpoch` 递增点十处以上，
  逐点清缓存必漏；用 undefined 表「不可用」以与「无会话」区分），我方逐行复核并在真实模块上复现。
- 「扔掉了」与「本来就没这面」分开：前者等宿主重跑、后者等上游升级，处置相反，压成一态即错读数。
- **消费侧配套（RubyPhone v3.0.1 落地）**：下游新增的 `projectionScopeLine()` 正好把这份归属面显式化 ——
  业务视图的「数据来源」卡直接显示「会话 X · 场景 Y · 世界 Z · 修订 N · 未过期/已过期（可重取）」，
  于是上游这条守卫生效时（导出 undefined），下游如实报「桥在但没投影面」而不是继续显示旧会话的读数。
  两侧判据互相独立：上游 v3213 判导出期，下游 system-v301 B3 判消费期。

## 状态检查点
- R1-A：已修复；先红后绿22项定向通过；全量1675断言、42审计通过（补齐测试登记后RC=0）。
- R1-B：已修复；先红后绿32项定向通过；手机838项测试及九门RC=0。
- R1-C：已修复（上游 lonsha，提交 `012bd2f`）；先红后绿35项定向通过；全量193文件/1682断言/0失败、
  42审计RC=0（新测试已登记进参考基准）。消费侧配套见下条。
- R1-D（下游归属面落地）：**已交付并推送**（RubyPhone v3.0.1，提交 `d6c1041`）。做的是把投影的
  **归属面**补进四个业务面而不是换数据源（理由见 Gate 段），并收口探针自述面、新增第九道门 J8/J9。
  验证：v301 18/18、v297+v298+v299+v301 93/93、`npm run check` EXIT 0（856 pass / 0 fail）。
- R1业务投影/工作台/证据修复：**业务投影一半已完成**（R1-D）；工作台与证据查询、修复预览回执未完成。
- R2/R3/R4：待实施。
- 真实SillyTavern宿主验证：未验。
- 两仓计划书同步：本档为 RubyPhone 侧副本，R1-C 段与 R1-D 记录已补齐（此前缺 R1-C 段）。

## Gate R1-B：消费侧输入收紧
- Local Fix / Local Fix Only。已授权；三条真实回归在旧代码全部失败。
- 只允许given公开值；未知可见性归withheld/invalid-visibility；时间和修订只认有限数字或非空数字串；三对象字段类型须正确。
- 允许config/projection-contract.js和tests/projection-input-contract.test.mjs；局部预算100行，连计划文档总预算150行/3文件。
- 不改结构版/公开函数形状/过期只报告语义，不加依赖、不动业务存储。
- 门禁：新测试先红后绿、v300、全量九门。失败回退本补丁，不删旧测试。
