# 双项目四批交付跟踪

状态：实施中，未发布。用户已授权四批及后续自主迭代；不把代码、自动化、实机验收混同。
基线：LonSha 3.212.0 / RubyPhone 3.0.0，工作区原始干净；1673断言+42审计、835测试+九门日志通过。旧启动未记录退出码，新门禁必须记录。
当前：LonSha 3.218.0（R2-E 取消留痕：读数增结局面 + 唯一标注入口 + 外供面 9→10 键）/
RubyPhone 3.0.3（R2-E 消费侧同轮接入：结局面 + 契约快照 + 坏消息首行）。

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

## Gate R2-C：消费侧接入注入面读数（**已完成**，RubyPhone v3.0.2）

主题：上游 R2-A/R2-B 做出来的「最终实际注入」读数，下游必须有人读 ——
且读的价值不在搬数字，而在**把上游已给、但没人读的那层分态读出来**。

- 归属仓：**ruby-phone**（消费侧）。上游两段（读数真实性 / 迟到隔离）已交付；
  本段是只读消费面，**不涉及** RubyPhone 侧写入授权（R1 结论：写面授权仍待确认）。
- 侦察（先证再改）：`snapshot.injection` 在 `apps/**` + `config/**` 全库零消费；
  上游读数形状逐键核对（顶层 9 键、逐块 6 键）与上游 `tests/v3216` 组 9 的键面锁一致。
- 裁定面（本 Gate 的核心）：上游做到了第一层分态（「跑过、真的 0 块」≠「还没跑过」），
  而**「0 块」内部还有第二义** —— `total === 0` 是「召回没给出可用素材」，
  `total > 0 && kept === 0` 是「素材有、全被注入预算裁掉」。两者处置方向相反
  （前者查召回键 / 上游编辑 / 键漂移，后者调 `injectionBudget` / 看预算策略），
  压成一态即错读数。故本版拆成 `candidates-empty` / `all-dropped` 两态，
  连总述文案也不许同形（有判据守）。
- 四类处境四句话互不相同：`no-injection-face`（等上游升级）/ `never-run`（等生成跑一轮）/
  `candidates-empty`（查召回）/ `all-dropped`（查预算）。缺席两态按 `fieldTypes` 自述判；
  无自述时按**较保守**的一边报，不硬猜。数值归一「没给」≠「给了 0」（`round` / `ts` / `tokens`）。
- 另加**归属复核** `strayOrigin`：经快照外供的读数只该由真生成写（`origin === 'generation'`）；
  非 generation 即上游归属又塌陷，本仓标红而不是当正常读数用（消费侧对上游 R2-A 的独立再判）。
- 落地：`config/injection-contract.js`（新增，消费侧单一真源）+ 诊断中心注入读数卡
  （七卡变八卡）+ 织光机回望页送达侧区块 + 第九道门 **J10**（消费点下限 2）+ `tests/system-v302`（21 条）。
- 边界：只读消费面；真实 SillyTavern 宿主实机未验；上游 R2-B 已声明的边界照旧
  （**不声称**消除注入槽位之外的其它迟到写）。
- 回滚：仅逆转本补丁；门禁失败只回滚不放宽。

## Gate R2-D：无主暂存不得被别的代捡起（**已完成**，lonsha v3.217.0）

主题：R2-B 已如实声明的那条边界的**另一半** —— 不是「同一条路径内的迟到」，
而是「载荷由 A 路径留下、被 B 路径提交」。

- 归属仓：**lonsha-memory-plugin**（上游注入面）。下游 R2-C 已完成（消费侧读数）。
- 修前实测两处：① `_injectionCommit(myGen)` 只核对「调用者传进来的代」与当前代，
  **从不核对载荷自己的代**（`p.gen`）⇒ 任何「留下暂存却没提交」的路径，其载荷会被
  **下一轮的提交**当成自己的载荷落成读数（`round` 照常前进，`gen` 停在旧代）；
  ② `window.lonsha_memory_interceptor`（保留的兼容发布路径）调完 `onBeforeGeneration()`
  只写注入槽位、**从不提交/丢弃** ⇒ 暂存永久悬空，成为 ① 的现成供体
  （该路径在真宿主上确实会被走到：「部分 ST 版本通过 manifest generate_interceptor 调用」）。
- 收口：`_injectionCommit` 增**载荷自身代核对**（不符即不落地 + 按过期收尾，既不落成读数也不静默消失，
  `Number.isFinite` 守卫使「无代」视同当代）；新增**收尾唯一入口** `_injectionClose(myGen)`
  （有暂存则提交，提交不成即按过期收尾且不重复留痕；`had` 在提交**之前**读，
  防「本来就没有」与「刚刚提交掉了」同形）；两条发布路径（事件 / interceptor）各占一代并共用它。
- 验证：v3218 11 条先红后绿（负控制一律真源码破坏 → 载入破坏副本 → 重跑同款判据，
  破坏点取**整块**守卫以防「只删条件行、留下块体」的假绿）；全量 198/198 文件、
  1743 断言 0 失败、42/42 审计 RC=0。
- 边界如实声明：只保证「每条发布路径的读数只属于它自己那一次」与「无主载荷不得被另一路径捡起」；
  **不声称**解决「两条发布路径同时活跃时谁赢」（宿主集成面，取决于 ST 版本实际走哪条路），
  也不声称消除注入槽位之外的其它迟到写（charMem / 各账本写入）。
- 回滚：仅逆转本补丁；门禁失败只回滚不放宽。

## Gate R2-E：取消留痕（**已完成**，lonsha v3.218.0 + RubyPhone v3.0.3）

主题：R2-A 的读数只回答了「AI 这一轮看到了什么」，没有回答「**这一轮到底有没有出稿**」——
用户按 Esc 中止与正常完成，在读数上**同形**。

- 归属仓：**lonsha-memory-plugin**（上游注入面）+ **ruby-phone**（消费侧，跨仓纪律同轮抬版）。
- 侦察（先证再改）：`GENERATION_ENDED` 处理器（`_h6`）当前只做一件事 ——
  复位 `_generationActive = false`（v3.12 兜底，防自愈永久延后）；
  于是**中止那一轮同样留下 `_lastInjection`**（注入确实发生过：STARTED 已写槽位、
  模型也确实收到了 prompt），而**没有任何格子说「这一轮没产出回复」**。
  两者处置相反 —— **被中止 ⇒ 该重发；已完成 ⇒ 该看回复**；压成一态即本仓最贵的错读数。
- 上游收口（v3.218.0）：
  · `_injectionRecord` 键面 10 → 11（增 `outcome`，缺省 `'pending'`）；
  · 新增 `_injectionEnd(kind)` 作为**唯一** outcome 标注入口 —— 只从 `'pending'` 迁出
    （幂等门：ST 正常次序是 `MESSAGE_RECEIVED` 先于 `GENERATION_ENDED`，
    已判定的不再被后到的事件改写），无读数计 `noReadout`、已判定计 `afterReadout`；
  · 接线两处：`_h1`（MESSAGE_RECEIVED）落 `received → completed`；
    `_h6`（GENERATION_ENDED）落 `ended → aborted`（**先复位标志后标结局**，两步都不省）；
  · 外供面 `buildInjectionReadout()` 9 → 10 键（带出 `outcome`）；
  · 自检行与面板加结局徽标（✓已完成 / ⚠️被中止，零块分支同样带结局）。
- 下游同轮接上（v3.0.3，跨仓纪律：**上游给了就必须同一轮有人读**）：
  · `config/injection-contract.js` 读出面增 `outcome` / `outcomeAt` / `faceDrift`，
    新增 `outcomeText()`（未知结局**如实输出原值**，不兜底 `pending` ——
    那会把「上游给了个没见过的结局」伪装成「正常的进行中」，让本仓失去发现契约变更的能力）
    与 `injectionFaceKeys()`（跨仓契约快照：上游注入面 10 键）；
  · 「上游没给这格」与「给了 pending」严格分开：缺格如实 `null` 并计入 `faceDrift`，
    总述写「结局：未提供（上游这版还没外供 outcome）」，两者文案不许同形；
  · 诊断中心：**被中止进坏消息首行**（该重发），**已完成不进**（回复已在那儿，写进去只会
    稀释「需要用户做的事」）；注入卡结局单独一格（完成绿 / 中止红 / 未定灰）+ 契约漂移对账提示；
  · 织光机回望页「送达侧观测」带出并显示结局。
- 跨仓纪律的判据化：上游 `tests/v3219` 组 6 守「外供面带出 outcome」；
  下游 `tests/system-v303` A2 把**同一份键面**钉成契约快照逐键核对 ——
  任一侧改名，两侧各有一处会红。
- 验证：上游 v3219 11/11 先红后绿；全量 **199/199 文件 / 1754 断言 0 失败、42/42 审计 RC=0**。
  下游 v303 17/17 先红后绿（含镜像树自证 C0 + 6 条负控制）；`npm run check` 九门全绿。
- 本轮当场捐到并修掉的真缺陷（下游，由 dead-export 门禁捐到）：
  **契约快照 `injectionFaceKeys` 建好、导出、测试也引，但产品端零消费** ——
  正是本仓「建好不消费」的**第八次**形态（只有测试引用不算消费）。
  修法**不是**登记进冻结账本，而是让产品面真读它：诊断卡的契约漂移提示现在会列出
  **本机认得的整份注入面键面**（用户据此才能自证「是上游旧版，还是本机认错了格子」），
  并补 C6 负控制守它（破坏产品面消费 ⇒ 同款判据必须转红）。
- 边界如实声明：只保证「结局三态在读数上可分」与「标注入口唯一、幂等」；
  **不声称**覆盖宿主未发 `GENERATION_ENDED` 的情形（那仍是 `pending`，如实报「未定」），
  也不声称解决注入槽位之外的其它迟到写。真实 SillyTavern 宿主实机未验。
- 回滚：仅逆转本补丁；门禁失败只回滚不放宽。

## 状态检查点
- **R2-E：已完成**（lonsha v3.218.0 + RubyPhone v3.0.3）；`_injectionRecord` 键面 10 → 11（增 `outcome`），
  新增 `_injectionEnd(kind)` 唯一标注入口（只从 `'pending'` 迁出，幂等），
  `_h1` 落 `received → completed`、`_h6` 落 `ended → aborted`（先复位标志后标结局），
  外供面 9 → 10 键；下游同轮接 `outcome` / `outcomeAt` / `faceDrift` + `outcomeText()` +
  `injectionFaceKeys()` 契约快照，被中止进坏消息首行（已完成不进）。
  验证：上游 v3219 11/11；全量 199/199 文件 / 1754 断言 0 失败、42/42 审计 RC=0。
  下游 v303 17/17；`npm run check` 九门全绿（dead-export 同轮捐到并修掉契约快照产品面零消费）。
  边界：宿主未发 `GENERATION_ENDED` 时如实为 `pending`（不猜结局）；宿主实机未验。

- **R2-D：已完成**（lonsha v3.217.0）；`_injectionCommit` 增载荷自身代核对（`p.gen !== gen`
  ⇒ 不落地 + 按过期收尾）、新增收尾唯一入口 `_injectionClose(myGen)`（提交不成即收尾、不重复留痕、
  `had` 前置读），两条发布路径（GENERATION_STARTED 事件 / interceptor 兼容入口）各占一代并共用它。
  验证：v3218 11/11（含破坏点取**整块**守卫的负控制）；全量 198/198 文件 / 1743 断言 0 失败、
  42/42 审计 RC=0（新测试已登记进参考基准）。
  边界：**不声称**解决两条发布路径同时活跃时谁赢（宿主集成面），也不声称消除注入槽位之外的其它迟到写。

- **R2-C：已完成**（RubyPhone v3.0.2）；注入读数消费侧单一真源 `config/injection-contract.js`
  （`readInjection` 结构恒定 22 键 / `injectionBlocksOf` 逐块归一 / `injectionLine` 四类处境四句话 /
  文案表未知原因如实输出原值），缺席两态按 `fieldTypes` 自述判（无自述取保守边），
  数值「没给」≠「给了 0」，另加归属复核 `strayOrigin`；接入诊断中心（七卡变八卡）与
  织光机回望页（送达侧观测）；第九道门新增 **J10**（`readInjection` 消费点下限 2，实测 2）。
  验证：v302 21/21（含镜像树自证 C0 + 5 条负控制）；`npm run check` 全绿。
  边界：只读消费面、不涉及写入授权；宿主实机未验；注入槽位之外的迟到写属后续 Gate。

- R1-A：已修复；先红后绿22项定向通过；全量1675断言、42审计通过（补齐测试登记后RC=0）。
- R1-B：已修复；先红后绿32项定向通过；手机838项测试及九门RC=0。
- R1-C：已修复（上游 lonsha，提交 `012bd2f`）；先红后绿35项定向通过；全量193文件/1682断言/0失败、
  42审计RC=0（新测试已登记进参考基准）。消费侧配套见下条。
- R1-D（下游归属面落地）：**已交付并推送**（RubyPhone v3.0.1，提交 `d6c1041`）。做的是把投影的
  **归属面**补进四个业务面而不是换数据源（理由见 Gate 段），并收口探针自述面、新增第九道门 J8/J9。
  验证：v301 18/18、v297+v298+v299+v301 93/93、`npm run check` EXIT 0（856 pass / 0 fail）。
- R1-E（上游九账只读对账面）：**已交付并推送**（lonsha-memory-plugin v3.214.0，提交 `579bcd9`）。
  新增 `evidence-workbench.js`（413 行，九账登记表单一真源 + 三态读数 ok/empty/absent 且 absent 分
  `module-unavailable` / `state-missing` + 出处投影 ref/ledger/floor，楼层取不到一律 `null` 不写 0）
  + 宿主接线（`_evidenceWorkbench` / `searchEvidence` / `_ledgerApis` + 快照 `evidence` 字段）。
  验证：v3214 11 项先红后绿；全量 194/194 文件、42/42 审计 RC=0。
- R1-F（上游修复预览与受控写入面）：**已交付并推送**（lonsha-memory-plugin v3.214.0，提交 `579bcd9`）。
  `repair-loop.js` 新增 `preview(input)`（签名无 rawState，结构上只算不改）与 `validate(input)`
  （request/preview 共用判据）；`request()` 增 `dedupeKey` 幂等（只按「未放弃」判重）。
  桥**分两面**：只读面逐字未动；受控写入面只收在**唯一命名空间** `repair`
  （`preview` / `apply` / `settle` / `abandon`），写入过两道门（`idempotencyKey` 必填 +
  `expectRevision` 对表），拒即不改账；回执 9 键恒定。
  验证：v3215 14 项先红后绿；全量 195/195 文件、1707 断言 0 失败、42/42 审计 RC=0。
  逆向审计补口（提交 `a2187a7`）：`settle` / `abandon` 同为写动作，一样过修订门——记录 id 是每条
  state 自己的 seq（`rp_1`），切聊后新会话的 `rp_1` 与旧会话同号，陈旧 settle 会把新会话那条标成 done。
- R1业务投影/工作台/证据修复：**上游读面（R1-A/C/E）与写面（R1-F）均已落地**；下游侧
  业务投影一半已完成（R1-D，v3.0.1）。
  **消费侧待办（未授权，不在本档范围内）**：手机端尚未消费上游快照的 `evidence` 字段（九账对账面），
  也尚未接入桥的 `repair` 受控写入面（发起 / 预览 / 落定 / 放弃）。这两项若要落地，须先取得
  RubyPhone 侧的写入授权与预算，并按本仓「先红后绿 + 九门」口径推进。
- R2（准确记忆与受控行动）：**已落四段** —— R2-A 注入读数真实性（lonsha v3.215.0）、
  R2-B 迟到隔离（lonsha v3.216.0）、R2-C 注入读数消费侧接入（RubyPhone v3.0.2）、
  R2-D 无主暂存不得被别的代捡起（lonsha v3.217.0）、R2-E 取消留痕（lonsha v3.218.0 + RubyPhone v3.0.3）。
  **R2 剩余（已取证、待实施）**：
  ① **取消留痕**：**已完成**（R2-E，lonsha v3.218.0 + RubyPhone v3.0.3）——
     详见上文 Gate R2-E 与状态检查点。
  ② **双向关系 / 知情网络**：属 R2 原始范围，未启动。
- R3/R4：待实施。
- 真实SillyTavern宿主验证：未验（上游写入面的两道门与回执形状已在无头环境逐条验证，宿主侧实机未验；
  下游两仓同步跑过 `npm run check`：lonsha 全量 RC=0、RubyPhone 九门 RC=0）。
- 两仓计划书同步：本档为 RubyPhone 侧副本，R1-C 段与 R1-D 记录已补齐（此前缺 R1-C 段）。

## Gate R1-B：消费侧输入收紧
- Local Fix / Local Fix Only。已授权；三条真实回归在旧代码全部失败。
- 只允许given公开值；未知可见性归withheld/invalid-visibility；时间和修订只认有限数字或非空数字串；三对象字段类型须正确。
- 允许config/projection-contract.js和tests/projection-input-contract.test.mjs；局部预算100行，连计划文档总预算150行/3文件。
- 不改结构版/公开函数形状/过期只报告语义，不加依赖、不动业务存储。
- 门禁：新测试先红后绿、v300、全量九门。失败回退本补丁，不删旧测试。
