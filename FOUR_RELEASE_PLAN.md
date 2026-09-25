# 双项目四批交付跟踪

状态：实施中，未发布。用户已授权四批及后续自主迭代；不把代码、自动化、实机验收混同。
基线：LonSha 3.212.0 / RubyPhone 3.0.0，工作区原始干净；1673断言+42审计、835测试+九门日志通过。旧启动未记录退出码，新门禁必须记录。
当前：LonSha 3.223.0（**O-1 优化批**：场所面「没给」与「给了 0」的真判开 —— R3-D 声称的
「`import()` 七格改走 `numOrNull`」实测只是**改名**（`numOrNull(null) === null` ⇒ `null ?? 0 === 0`，
与修前 `num(null) === 0` 同值）；本轮把**门本体**改成「先看类型」并连同同族六面一次收干净）/
当前：LonSha 3.224.0（**O-2 优化批**：楼道取值门同族普查 —— 上游把「用 `Number()` 结果当门」这条根因在
**回放 / 前移层**（`ledger-replay.js`）连同同族六面一次收干净，修前实测 `replayShift(host, '')` 会把 `floor: 9`
的条目搬成 8）/
RubyPhone 3.3.0（O-2 消费侧**本轮抬版** —— 与 R3-E / O-1 两轮的「不抬版」判定相反：外供 `skipped` 字段确实
零消费，但**同一条根因在本仓删楼回滚链路独立发病三处**，判定依据见下 Gate O-2 节）。
上一轮基线：LonSha 3.223.0 / RubyPhone 3.2.0（O-1 消费侧**仍不抬版** —— 上游本轮**未新增外供键**，
变的是既有键的**取值域**（`presence[].atFloor` / `visits[].firstFloor|lastFloor` / `tree[].floor` /
`currentChain[].floor` 由「总是 number」变 `number | null`）；而本仓**早就在读这一态**：
`apps/place/place-data.js` 各消费点全部过 `numOrNull`，`apps/place/place-view.js` 第 235-236 / 266 行
本就按 `null ⇒ 不出行`、`0 ⇒ 第 0 楼` 分流，故**无需改代码**）。

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
- 证据：`_lastProjectionEnvelope` 的归属（conversationId + revision）只在 `readWorldLedger()`→`_buildProjectionEnvelope()` 写入的那一刻成立。
  切聊（CHAT_CHANGED）换 chatId、回滚/恢复（`_bumpEpoch`）只递增 `_mutationEpoch`，两条路径**都不清该缓存**；
  `buildBridgeSnapshot()` 于是把旧会话/旧代数的投影当作当下读数导出（不报错、只错结果）。
- 契约：同会话同代数 ⇒ 照常导出；会话或代数不符 ⇒ 不导出（`projection` 为 undefined ⇒ 自述 present=false）并留痕；
  取不到 chatId ⇒ 放行，原契约不变（拿不到判据不等于证伪）。`generatedAt` 只记生成时刻、不携带归属，改时间戳等于把陈旧内容伪装成新鲜，故只比对会话+代数。
- 允许：index.js（buildBridgeSnapshot 新鲜度守卫 + `snap.meta.projectionFreshness` 归因字段）、tests/v3213_projection_cache_freshness.test.mjs、catalog_reference_consumers.tsv 一行、本计划文档。上游预算 3 文件 / 60 行。
- 验证：新回归先红后绿（首跑 4a/4b/4c 因锚点不存在报红，实现后转绿）、v3212/v3174/projection-absence 联合35项通过、全量 test:audit RC=0；不删除功能。
- 回滚：仅逆转该小补丁及新增测试；出现历史契约冲突回 AUDIT，不放宽门禁。
- 子agent：DeepSeek R1-C 提供候选（主张**读取期校验**而非新增清理点：`_mutationEpoch` 递增点十处以上，逐点清缓存必漏；用 undefined 表「不可用」以与「无会话」区分），我方逐行复核并在真实模块上复现。API Key 不写入仓库。
- 「扔掉了」与「本来就没这面」分开：前者等宿主重跑、后者等上游升级，处置相反，压成一态即错读数。

## Gate R1-E：九账只读对账面（工作台与证据查询的上游出口）
- Structural: Local Fix；Execution: Local Fix Only；授权：approved local fix（四批授权内）。
- 证据：本仓九本账（伏笔 seed / 约定 commitment / 平行事实 parallel / 秘密 secret / 回扣 recall-echo /
  回声 echo / 事实版本 fact-version / 事件完整性 event-completeness / 修复闭环 repair）各自有
  `list()` / `summarize()`，但**对外是一排孤立文本行**：`ledger-replay.js` 的 `FLOOR_OWNERS` 只登记
  「谁有楼层归属」，不含条目正文、状态与引用键；快照 15 字段里**无一本账**（`worldProg` 只带四本账的
  原始状态，且不含 `_factVersionState` / `_eventThreadState` / `_repairState`）。下游要回答
  「她现在住哪里 / 这个承诺是哪一楼说的」只能逐 App 翻，且**拿不到出处**（无楼层、无来源账、无修订）。
- 契约：新增 `evidence-workbench.js`（纯函数、零依赖、双导出），把九账收成**一份可查对账面**：
  · `LEDGERS` 登记表是单一真源（id / label / 取状态 / 取账本 API / 列表过滤 / 引用前缀）；
  · 每账三态 `ok` / `empty` / `absent`（模块未挂载、状态取不到、条目为空**三者不得同形**）；
  · 每条条目带 `ref`（稳定引用键，如 `seed:sp_3`）+ `ledger`（来自哪本账）+ `floor`（出处楼层，
    取不到即 `null`，**不写 0** —— 0 是「第 0 楼」这个真实读数）；
  · `search()` 纯函数在面内检索，返回命中**与未命中的账**（「这本账里没有」≠「这本账不存在」）。
  不改既有账本 API、不改 `ledger-replay` 登记表、不写任何账本状态。
- 允许：evidence-workbench.js（新增）、index.js（`_evidenceWorkbench()` + 快照 `evidence` 字段）、
  manifest.json（extra_js 一行）、tests/v3214_evidence_workbench.test.mjs、
  tests/audit/catalog_reference_consumers.tsv 一行、dead_code_budget.json 抬 ceiling、本计划文档。预算 4 文件 / 260 行。
- 验证：新回归先红后绿；v3212/v3213/projection-absence 联合通过；全量 test:audit RC=0；不删除功能。
- 回滚：仅逆转该新增模块与快照接线；出现历史契约冲突回 AUDIT，不放宽门禁。

## Gate R1-F：修复预览与受控写入回执
- Structural: Local Fix；Execution: Local Fix Only；授权：approved local fix（四批授权内）。
- 证据：`repair-loop.js` 三类修复动作（retarget / split / revoke）与宿主 `requestRepair` / `settleRepair`
  已实现（v3.194），但**零真实调用点**：全库 grep `requestRepair` 只有两处定义与一条测试扫签名
  （`tests/v3194` 的字符串断言），产品代码**没有任何一处调用**。于是「撤销一条错误事实」在用户面前
  不存在入口，而它正是本仓治理过多轮的「源头改了、下游没跟着改」的唯一收口。
  另：`request()` **不幂等**（同一次修复重试会新增一条记录），且桥无写入口，下游无从发起。
- 契约：
  · `preview(rawState, input)`（新增纯函数）：只算 `affectedBy` 命中面，**不落账**、不改 state；
  · `request()` 增 `dedupeKey` 幂等（同键且未 abandoned ⇒ `replayed:true`，不新增记录；缺键时行为逐字同旧版）；
  · 桥新增**受控写入面** `window.lonsha_memory_bridge_v1.repair`（与只读 `snapshot` 分离）：
    `preview(input)` 只读预览；`apply(input, {idempotencyKey, expectRevision})` 落账并返回回执；
    `settle(input)` / `abandon(input)` 逐项落定与放弃。
  · 回执形状恒定：`{ok, reason, repairId, action, affected, total, revision, replayed, at}`；
    `expectRevision` 不符即拒（`reason='revision-mismatch'`）且**不改账**；缺 `idempotencyKey` 即拒
    （`reason='missing-idempotency-key'`）。
  · 只读面不变：`snapshot` 仍是只读，不含任何写入方法（既有注释纪律保持）。
- 允许：repair-loop.js（preview + dedupeKey）、index.js（previewRepair + 桥 repair 命名空间）、
  tests/v3215_repair_write_channel.test.mjs、catalog_reference_consumers.tsv 一行、dead_code_budget.json、本计划文档。
  预算 3 文件 / 220 行。
- 验证：新回归先红后绿（先证 request 不幂等、preview 不改账、修订不符拒写）；v3194/v3202 回归；全量 test:audit RC=0。
- 回滚：仅逆转本补丁；出现历史契约冲突回 AUDIT，不放宽门禁。
- 边界：**不自动改派生件**（改哪一处是产品决定，自动改会累积幻觉删改 —— repair-loop 原注释已立）。
  人工点「纠正归属」≠ 正文已发生；回执只记「账上落定了什么」，不推断剧情已经发生。

## Gate R2-A：注入读数真实性（**已完成**，v3.215.0）

主题：**最终实际注入**的读数只能由生成路径写；诊断必须另存；代际过期必须留痕；
零块必须有读数；注入面必须外供。

- 修前实测四条真缺陷：①**归属塌陷**（`_lastInjection` 被真注入与 selfCheck 的
  「召回管线 dry-run（**不注入**，只验证链路通）」同时写，而面板文案是「即 AI 真实所见」）；
  ②**迟到污染**（代际守卫在 await 之后判定，写入点在 await 内部无条件执行，过期只打一行日志）；
  ③**零块未定义**（`if (inj2)` 短路使「本轮 0 块」与「还没跑」同形）；
  ④**注入面不外供**（快照 15 字段里没有注入面）。
- 收口：唯一构造点 `_injectionRecord`（恒定 10 键）/ 诊断 `_diagnostics.dryRun` /
  零块落地（`blocks:[] total:0` 且 `round` 照常推进）/ 逐块读数 `_injectionBlocksOf`
  （`kept` vs `dropped-budget`）/ 块引用键 `_injectionRefOf` / 过期留痕 `_injectionDiscardStale`
  （**不碰读数**）/ 外供面 `buildInjectionReadout()` 进快照 + 桥 `injectionRefOf`。
- 验证：v3216（T1-T10 + N1-N4，先红后绿；负控制一律真源码破坏 → 载入破坏副本 → 重跑同款判据）；
  全量 196/196 文件、1721 断言、42/42 审计 RC=0。
- 边界：**不声称**消除「过期代在 await 期间已写脏」——那要把记录延迟到 await 之后，属 R2-B；
  本 Gate 只保证「过期必留读数」与「读数只有一个构造点」成立且可分。
- 回滚：仅逆转本补丁；门禁失败只回滚不放宽。

## Gate R2-B：迟到隔离（读数落地不早于代际确认）（**已完成**，v3.216.0）

主题：R2-A 已如实声明的那条边界的收口 —— 迟到的结果不得写脏读数。

- 修前实测：`onBeforeGeneration()` 在 `await` **内部**无条件落地 `_injectionRecord`，
  而代际守卫在 await **之后**才判定。快速连发时先发那一轮已写脏读数，守卫只拦住
  `writeInjectSlot`，拦不住读数；面板上「最近一次实际注入」可能是**一次从未生效的注入**，
  而旁边写槽位的结果恰说明这轮没生效 —— 两行读数互相矛盾。
- 收口：`_injectionStage`（await 内只**暂存** `_injectionPending`，绝不动 `_lastInjection`）
  + `_injectionCommit(myGen)`（守卫**之后**的唯一落地点，内部再做一道代际核对，
  不符即返回 null 不静默落别的代的载荷）；**轮次号只由提交推进**（被丢弃那代不占号，
  于是「第 N 轮」恒等于「真正生效过的第 N 次注入」）；过期分支**必须清暂存**
  （不清则下一轮捡起旧载荷落成读数 —— 张冠李戴比不落地更坏），并把被丢弃载荷读数
  （`pendingDiscarded`/`payloadChars`/`payloadBlocks`）记进 `_lastInjectionDiscard`。
- 验证：v3217（11 条，先红后绿）；全量 197/197 文件、1732 断言、42/42 审计 RC=0。
- 边界：只保证「读数落地不早于代际确认」与「过期载荷不得被下一轮捡起」；
  **不声称**消除注入槽位之外的其它迟到写（charMem / 各账本），属后续 Gate。
- 回滚：仅逆转本补丁；门禁失败只回滚不放宽。

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

## Gate R2-F：双向关系对账 + 知情网络（**已完成**，lonsha v3.219.0）
- 修前实测（真源码重放）：
  ① 关系边单向主观，注入侧只原样列出召回边，**没有一格说「对侧那条在不在」**——
  「乙对甲是警惕」与「乙对甲从未登记」同形，而后者是提取漏了一条（该补记）。
  「对侧不在」有三种来源（本轮被披露条件挡下 / 已失效 / 压根没登记），压成一态会让模型去补一条不该补的关系。
  ② 认知隔离用 includes / !== 逐字比较：同一件事三种措辞记 **3 条**，用告知式措辞去解除**一条都清不掉**（认知隔离永不解除）；
  getReEntryNotice 只取前 3 条，前 3 格被旧措辞占死，真实新增的认知边界永远挤不进去。
- 收口：新增 `relation-mutual.js`（四态对账 mutual / mutualGated / mutualExpired / oneSided，只有末态该补记，注入只标 one-sided）与
  `knowledge-network.js`（三级同一性判据，判不开一律判不同；疑似档只报候选不合并）。
  宿主接线：markUnaware 同事实不重复登记、已知侧有同事实不再登记为「不知道」；revealKnowledge 按下标删；模块缺席回落逐字口径。
  诊断面增「双向对账」「知情网络」两行，报警只认真损失（oneSided / suspect）。
- 测试：`tests/v3220_relation_mutual_knowledge.test.mjs` 18 条（含四条真源码破坏负控制）；既有 v341 / v3184 全绿。
- 门禁：全量 200/200 文件 / 1772 断言 0 失败、42/42 审计 RC=0。
- 跨仓：本 Gate **无新增外供字段**（读数落在插件内诊断面），故下游本轮不接入、不抬版。

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

## Gate R3-A：场所三面外供（**已完成**，lonsha v3.220.0 + RubyPhone v3.1.0）

主题：R3（长线生活与社交生态）第一批次的第一项。场所图景在账本**内部**早就有三面能力，
`summary()` 却只外供「当前链末级字符串 + 规模四数」—— 手机端由此成为「有表无实」。

- 归属仓：**lonsha-memory-plugin**（外供面）+ **ruby-phone**（消费侧，跨仓纪律同轮抬版）。
- 侦察（先证再改）：`scene-book.js` 内部已有层级树（`outlineOf` / `chainOf`）、到访史
  （`visitsOf` / `visitsList`，含次数 / 首末楼层 / 重访标记）、本楼场景头（`headerAt` / `headerLine`，
  含日期 / 时段 / 天气）；而 `summary()` 只返回 `current`（**末级键字符串**）+ `scale` 四数。
  ⇒ 只读快照桥 `snapshot.scene` 里**没有任何一格**能回答「这店在市里哪一区」「去过哪些、去过几次」
  「那天什么天气」。三问全部答不出，而数据就在手边 —— 这是「做了不外供」，不是没做。
- 上游收口（v3.220.0）：
  · 新增 `tree(limit)`（pre-order 扁平，逐行 key / path / name / **真实 depth** / desc / floor / visited / visits）、
    `visitHistory(limit)`（key / path / count / firstFloor / lastFloor / revisit / registered / desc）、
    `headerFace(floor)`（{floor, date, period, weather} 或 `null`）；三者只读、不抛、有界；
  · 新增上限常量 `MAX_TREE_ROWS = 240`（防单次读数无界，同 `MAX_BRIEF_LINES` 一类）；
  · `summary()` 外供面 7 → 11 键（增 `currentChain` **结构化数组** / `tree` / `visits` / `header`），
    **旧键一个未动** —— 旧消费方读数不变；
  · 新增 `numOrNull(v)`：`null` / `undefined` / `''` 三态直返 `null`，把「没给」与「给了 0」判开
    （`Number(null) === 0` 是 v3.212 线已吃过一次的老账），`tree.floor` 与
    `visitHistory` 的三个数值格全部改走它并按 `null` 排序（不当作第 0 楼）；
  · 宿主 `SceneBookFallback` 补 `tree()` / `visitHistory()` / `headerFace()` 三个**同形空方法**
    并同步补齐 `summary()` 四格 —— 模块缺席时必须与真实现同形，否则「这版没这面」在下游又塌成「这面是空的」。
- 下游同轮接上（v3.1.0）：`projectScene` 增 `tree` / `history` / `header` / `chainFace` 四块与
  `hasTreeFace` / `hasVisitFace` / `hasHeaderFace` 三格（判**格子在不在**，不判内容非空）；
  视图新增「场所层级」「到访史」「本楼场景头」三卡，三面各自分开「上游这版没这面…」与
  「有这面但这个会话是空的」两种相反文案；`registered:false` 的孤儿到访显式标「未登记」。
- 跨仓纪律的判据化：上游 v3221 组 B/G 守「三面均外供 + 退路同形」；下游 v310 组 B/D 守
  「三面分域 + 每面都有真消费点」——任一侧改名或摘掉一格，两侧各有一处会红。
- 本轮当场捐到并修掉的真缺陷（两处，均在下游）：
  ① `apps/place/place-data.js` 取数函数名 `num`，实现 `Number.isFinite(Number(v)) ? Number(v) : null`
     —— `Number(null) === 0` 与 `Number('') === 0` 双踩，「没给」与「给了 0」塌成同一读数
     （同文件注释写的就是「非数值如实 null，不编 0」，实现漏了这一格）。到访史正踩在上面：
     `firstFloor: null`（未跨楼层）被渲染成「第 0 楼」。改名 `numOrNull` 并补三态直返。
  ② 三张新卡的样式**只写进源文件 `apps/place/place.css`，没合并进运行时载体 `phone.css`**
     —— 运行时真正载入的是后者，实机会渲染成无样式裸标记。由 v246-A8「源文件不得多于运行时载体」
     当场捐到（修前 src=43 / phone=35，缺 8 类）。
- 验证：上游 v3221 17/17（先红后绿）；全量 **201/201 文件 / 1789 断言 0 失败、42/42 审计 RC=0**。
  下游 v310 19/19（先红后绿，含 F0 阳性对照 + 3 条镜像破坏负控制）；`npm run check` 九门全绿
  （首跑 8 红，均为抬版触发的既有当版锚与文档一致性守卫，已按仓内交棒口径逐条接管）。
- 边界如实声明：① 上游只把三面**外供**，未改场所图景内部语义（事实 / 覆盖度不动）；
  ② `count` 口径是**去过的不同楼层数**、`depth` 是**真实层级**（不按路径长度推断），
  这是如实外供而非新口径，「按楼层累加的次数」若要另开一格；
  ③ 真实 SillyTavern 宿主实机未验，无头门禁只证明模块间契约。
- 回滚：仅逆转本补丁；门禁失败只回滚不放宽。

## Gate R3-D：场所三面的回滚面收口（**已完成**，lonsha v3.221.0 + RubyPhone v3.2.0）

主题：R3（长线生活与社交生态）第一批次的第二项。R3-A 只把层级树 / 到访史 / 本楼场景头
「写出去」，而三面在 **import / 删楼 / 前移 / 重建** 四条路径上全部脱钩 —— 后果是**读数撒谎**
（`headerAt(7)` 照样答「8月2日 · 暴雨」而那一天已被删掉），比缺读数更糟。

- 归属仓：**lonsha-memory-plugin**（回读与回滚面）+ **ruby-phone**（诊断面，跨仓纪律同轮）。
- 侦察（先证再改，逐条在真模块上实测）：七项真缺陷 ——
  ① `import()` 全路径 `num(x) ?? 0` 把「没给」编成第 0 楼（`Number(null) === 0`），
     `headers` 的 `[null, ...]` / `['', ...]` 键同病；
  ② `setHeader(null)` 返回 `true` 并真写进第 0 楼、`headerAt('')` 读得出第 0 楼；
  ③ 删楼时 `headers` 一格不动，而宿主无条件 `clearPresence?.()` 把在场**整表全清**
     （单楼语义被悄悄扩成全清）；
  ④ 前移时 `headers` / `presence` 不跟，且不认「被删楼自身的残留」——第 8 楼前移成 7 楼后
     与残留撞成两条 7 楼（连做两次得 `track=[3,7,7]`）；
  ⑤ 导入旧格式存档（无 `opsLog`）后第一次单楼编辑把**整棵树清成 0 个节点**；
  ⑥ `coverage()` 不含任何场景头读数 ⇒ 删楼/前移对 `headers` 的处理**没有任何判据面**；
  ⑦ 退路 `SceneBookFallback.coverage()` 与真实现键面不同形（真 15 键 / 退路 13 键）。
- 上游收口（v3.221.0）：
  · 新增 `clearHeader(floor)`（单楼撤场景头，非数值如实 `false`）与
    `shiftFloorRefs(deleted)`（先清被删楼自身在 `track` / `opsLog` 的残留，再**同时**平移
    `track` / `opsLog` / `headers` / `presence` 四面；非有限数如实返回 0）；
  · `rollbackFloorOnly` / `rollbackFrom` 按同一语义撤场景头（单楼 / 级联），
    `setHeader` / `headerAt` / `import` 全路径改走 `numOrNull`；
  · `_rebuild(removedFloor)` 在**无 `opsLog` 真源**时不再清空式重建（如实降级：只摘掉被删那楼的登记）；
  · 场景头上限提为常量 `MAX_HEADERS = 400`（**载入侧此前无上限**）并进导出面；
  · `coverage()` 增 `headerFloors` / `headerCount`；宿主 `index.js` 删掉 `clearPresence?.()` 全清一句，
    `ledger-replay.js` 的 `scene` 登记项 drop 走 `rollbackFloorOnly`、shift 走 `shiftFloorRefs`
    （不再手抄循环 —— 手抄的那份必然漏掉后来新增的面）。
- 下游同轮接上（v3.2.0）：`coverageLines` 增场景头楼层行（第 N 楼逐楼列号，`headerCount` 只当前者缺位时的
  兜底），`projectScene` 增 `hasHeaderFloorsFace`（判**格子在不在**）并把覆盖度键面单列一格，
  诊断卡据此分开「上游这版没有场景头覆盖度」与「这版有面、这个会话还没有场景头」两种相反文案。
- 跨仓纪律的判据化：上游 `tests/v3222` 的 G3 守「退路覆盖度与真实现**逐键**同形」；
  下游 `tests/system-v311` 的 B/D 组守「场景头覆盖度真读进来 + 面缺席不与空同形」。
- 同轮接管的既有判据（**收紧，未放宽**）：`v3181` E2 由「宿主全清是在场清理方式」改为
  两条更强的正/反判据；`scan_v3181` N1 的 scene 面锚点随语义搬家并新增两组接线判据；
  `v39` 对 scene 面由「字面提到字段名」改为**真加载真跑一次 shift** 的行为验证；
  `v3203` todo 指针随抬版前移。
- 验证：上游 `v3222` 25/25（先 19/24 红 → 全绿）；全量 **202/202 文件 / 1814 断言 0 失败、42/42 审计 RC=0**
  （`dead_code_budget` 余量内，无需 `--bump`）。下游 `system-v311` 全绿；`npm run check` 九门全绿。
- 边界如实声明：① 上游只修**回读 / 回滚 / 重建**三条路径，未改场所图景对外语义
  （`count` 仍是「去过的不同楼层数」、`depth` 仍是真实层级、三面键面与 R3-A 一致）；
  ② 重复调用 `shiftFloorRefs` 仍会**再次平移**（平移语义，非 drop 侧幂等契约；`scan_v3190` 明确
  「不断言 shift 幂等」），已登记为观察项 T17；
  ③ 真实 SillyTavern 宿主实机未验，无头门禁只证明模块间契约。
- 回滚：仅逆转本补丁；门禁失败只回滚不放宽。

## Gate R3-E：下游**不抬版**（上游 lonsha v3.222.0；本仓按跨仓纪律逐条判定后不随轮抬版）

上游 R3-E 修的是**长期记忆（stm-ltm）在前移路径上的脱钩**：`ledger-replay.js` 的登记表里
`stm-ltm` 那一项 `shift` 写死为 `null`，于是「前移」对它完全无效（删楼那一侧早就清过了）。
上游新增 `stm-ltm.shiftFloorRefs(state, deleted)` 并把登记项改为真调用。

- 为什么本仓**不**随轮抬版（跨仓纪律不是「上游一动就抬」，而是「上游外供了就必须有人读」）：
  ① **本轮没有新增外供面**。改动落在 `ledger-replay.js` 与 `stm-ltm.js` 的**内部**：
     登记项的 `shift` 实现与模块新增方法；`summary()` 的键面、快照携带的键面均**未见变化**
     （对照 R3-D：那一轮上游新增了 `coverage.headerFloors` / `headerCount` 两格，故本仓必须同轮接）。
  ② **本仓根本不消费这条路径**。全仓实测（排除 `node_modules`）：
     `ledger-replay` / `LedgerReplay` / `replayShift` / `replayDrop` / `stmLtm` / `短期长期` /
     `shiftFloorRefs` **七串全部 0 命中**。
  ③ **同名不同面，勿混**。本仓 `apps/place/place-data.js` 的 `coverageLines()` 消费的是
     `LonShaFloorLedger.coverage(chat, opts)`（上游另一本账 `floor-ledger.js`），
     与 `ledger-replay.js` 的 `coverage(host, registry)` 不是同一面 —— 判据是「七串零命中」，
     不是「名字里没有 ledger」。
  ④ **风险面已被前两轮覆盖**。R3-E 若导致外供位移读数变化，会先经过 R3-A（场所三面）与
     R3-D（回滚面）两轮已经逐键对账过的面；本轮没有新增面，故没有新的待读之物。
- 本仓本版**无代码改动**（版本号不动，`package.json` / `update-log.json` 均不变）。
- 反向自证（不是「没找到就说不抬」）：`tests/system-v311.test.mjs` 的 C2 组仍会因上游
  「旧版不撒谎」文案（`需插件 v3.221 或更新`）翻红 —— 说明本仓对**确实外供了的面**是有人读的，
  这条纪律在 R3-D 轮已实证生效；本轮判「无待读之物」正是因为**没有新增面**，而非没在找。
- 门禁：本仓 `npm run check` 九门不受本轮上游改动影响（上游改动不进本仓运行时）；
  仍照常跑一次作为「不抬版」的回归对照。
- 边界如实声明：真实 SillyTavern 宿主实机未验；本判定只覆盖「上游本轮外供面的变化」，
  不承诺上游**内部**语义变化对本仓投影零影响（本仓不读那条路径，故无从受影响）。

## Gate O-1：场所面取值域由「总是 number」变 `number | null`（上游 lonsha v3.223.0；本仓**仍不抬版**）

主题：**优化方向**第一批次第一项。上游 R3-D（v3.221.0）在 CHANGELOG 里声称「`import()` 七格 +
`headers` 键统一改走 `numOrNull`，把『没给』与『给了 0』判开」—— `headers` 键那一半是真的，
而 `import()` 七格那一半**是改名**：`numOrNull(null) === null` ⇒ `null ?? 0 === 0`，
与修前 `num(null) === 0`（`Number(null) === 0` 且有限）**同值**。本轮上游把**门本体**
（`numOrNull` / `num` 由 `Number.isFinite(Number(v))` 改为先看类型：只认数字与非空数字字符串）
连同同族残留六面（列号 / 外供 `tree` + `currentChain` / 回滚三法 / `visits.floors`）一次收干净，
修前实测 `[] → 0`、`true → 1`、`'  ' → 0`、`false → 0`；最贵的一处是 `rollbackFrom(null)`
被读成「删第 0 楼及以上」，把 `opsLog` / `track` / `headers` 一次清空且返回正数。

- 为什么本仓**不**随轮抬版（跨仓纪律是「上游外供了就必须同轮有人读」，不是「上游一动就抬」）：
  ① **本轮未新增外供键**。`summary()` / `tree()` / `visitHistory()` / `headerFace()` / `coverage()`
     的键面与 R3-A / R3-D 逐字一致；变的是**既有键的取值域**：`presence[].atFloor`、
     `visits[].firstFloor|lastFloor`、`tree[].floor`、`currentChain[].floor` 由「总是 number」
     变为 `number | null`（「没给」不再冒充第 0 楼）。
  ② **本仓已经在读这一态，且 `null` 与 `0` 本就分开渲染**（逐点实测，不是「大概没问题」）：
     · 取数（`apps/place/place-data.js`）：第 232 行 `floor: numOrNull(n.floor)`（层级树）、
       第 255-256 行 `firstFloor` / `lastFloor`（到访史）、第 343 行 `floor: numOrNull(n && n.floor)`
       （当前链）、第 140 行 `atFloor: numOrNull(rec.atFloor)`（在场分组）、
       第 157 / 175 行 `floors` / `headerFloors`（覆盖度列号，且 `filter(f => numOrNull(f) !== null)`）。
     · 渲染（`apps/place/place-view.js`）：第 235-236 行 `v.firstFloor !== null && v.lastFloor !== null`
       才出行（`null` 如实不出行、`0` 照常出「第 0 楼」）、第 266 行
       `(g.atFloor === null || g.atFloor === undefined) ? '' : '第' + g.atFloor + '楼'`。
     即：上游这一版把「没给」如实标成 `null` 之后，下游**恰好**按既有写法分流。
  ③ **风险面已被前几轮对账过**。R3-A（接三面）与 R3-D（接覆盖度补面）已把场所面的键逐一对过；
     本轮只改取值口径，故**没有新的待读之物**。
- 本仓本版**无代码改动**（`package.json` / `manifest.json` / `update-log.json` / `index.js` 均不动）。
- **同轮核到的一条不对称（如实登记，非本轮缺陷）**：本仓同名函数 `numOrNull` 有三份实现 ——
  `config/projection-contract.js`（第 95 行）与 `config/injection-contract.js`（第 118 行）是**强口径**
  （`typeof` 先挡非 number / 非 string，故 `'  '` / `[]` / `true` 一律 `null`），而
  `apps/place/place-data.js`（第 99 行）那份是**弱一格**（只挡 `null` / `undefined` / `''`），
  实测 `'  ' → 0`、`[] → 0`、`true → 1`、`false → 0`、`[3] → 3`。
  本轮判**可达性为零**故不动它：这些怪值只能来自上游外供面，而上游 v3.223.0 的场所面已收口为
  `number | null`（旧版上游即便给怪值也会被它自己的 `Number()` 强转成数字，吐不出数组 / 布尔）。
  已登记为**观察项**：交 O-8（下游 keys / 取值域判据化）或同族普查批次把三份实现对齐，
  并让本仓**自带**的行为判据把「怪值 ⇒ 不得出数」钉住（不靠上游自觉）。
- 门禁：`tests/system-v311.test.mjs`（消费点下限 / 两态分域）与 `npm run check` 九门不受本轮上游改动影响
  （上游改动不进本仓运行时）；仍照常跑一次作为「不抬版」的回归对照 —— 本判定不是「没找到就说不抬」。
- 边界如实声明：真实 SillyTavern 宿主实机未验；上游宿主侧各子系统自己的 `removeByFloor` 系列
  （`charMem` / `diary` / `cards` / `status` / …）仍是各自的 `Number()` 门、**不在**本轮外供面内，
  本仓无从受影响；本判定只覆盖「上游本版外供面」的变化，不承诺上游**内部**语义变化对本仓投影零影响。

## Gate O-2：取值门同族普查（**已完成**，lonsha v3.224.0 + **RubyPhone v3.3.0**）

主题：**优化方向**第二项 —— 「用一个被 `Number()` 强转过的值当门」这条根因，在全仓还有几处。
0 在两侧都是**合法楼层**（SillyTavern 楼层 0 基），而 `Number(null) === Number('') === Number('  ') === Number([]) === 0`、
`Number(true) === 1` ⇒ 「没给」与「就在第 0 楼」必然塌成同形。

- 归属仓：**lonsha-memory-plugin**（回放 / 前移层）+ **ruby-phone**（删楼回滚链路，本轮实测需修）。
- 上游收口（v3.224.0，见 `ITERATION_LOG` 迭代 38 前半）：唯一取值门 `floorOrNull(v)`（先看类型）；`replaySide`
  入口对「没给」落 `skipped: 'floor-not-given'` 且逐字节不动；同族六面（`ledgerOwner` 工厂 drop/shift、
  `shiftLedgerItemFloors`、`floor-ledger` / `archived` / `inject-cursor` 的 drop+shift 入参）一次收干净；
  宿主四处（`numOr` 增对象回退、`rollbackFloor` / `shiftFloorsFrom` 走门、`MESSAGE_DELETED` 走门）。
- **下游判定（本轮结论与上游自述相反，逐条写明）**：
  上游 CHANGELOG 的结论是「下游不抬版（新增外供面只有 `skipped` 字段，下游无消费点）」。
  核实后：**前半成立、结论不成立** ——
  ① 成立：「`skipped` 字段下游零消费」，全仓实测 0 命中；
  ② 不成立：**同一条根因在本仓独立发病三处**，与上游给不给 `skipped` 无关（外供面没变，是本仓自己的门没做对）：
     · `apps/memory/memory-data.js` `invalidateFloorAt('')` 实测把 longTerm 5 条 + shortTerm 2 条**全清**
       （n=6，只剩 `floor === null` 那条）—— 一次误调用清空整份记忆（判据 `Number(f) >= Number(floor)` 恒真）；
     · `index.js` 的 `MESSAGE_DELETED` 是**半收口**（`Number(...)` + `Number.isFinite(...)`），
       实测 `''` / `'  '` / `[]` 全部通关被读成**第 0 楼**、`true` 读成第 1 楼；
     · `apps/memory/lonsha-bridge.js` 的 `onFloorRollback(floor)` 用 `Number(floor)` 直通 memoryCore，是同一半收口的第一道。
- 下游修复（v3.3.0）：三处各持一份本地 `floorOrNull`（**各边界自持同口径门**，不跨层共享以避免
  `index.js` ↔ `apps/*` 循环依赖；宿主侧 `stFloorOrNull` 前缀防混同，有判据锁着），与 `config/*` 的 `numOrNull` 逐字同口径。
  **判开双向**：真给 `0` / `'5'` / `' 5 '` 一律照常动手（实测真给 0 仍清 6 条、真给 5 清 2 条）。
- 测试：新增 `tests/system-v312.test.mjs`（A 门本体 / B 数据层真模块 / C 桥层真模块 / D 宿主入口形态 /
  E 版本四源同源 / F 负控制含整仓镜像与三条同款判据的破坏副本对照），**先 12/16 红、三轮自纠后 16/16 全绿**；
  九道门 `npm run check` RC=0。
- **同轮捐到三处测试侧缺陷**：抬版键序（`versions` 首键即当前版本，append 到末尾 ⇒ 32 条既有判据翻红）/
  观测错对象（判据读**原数组**而非被改写的接收者 ⇒ 假绿，由负控制抓出）/ 断言过严（禁模块**提及**宿主门名，
  改为只判**定义**）。
- **为什么本轮抬版（与 R3-E / O-1 两轮口径的差异）**：那两轮上游改的是内部与取值域，本仓「无待读之物」⇒ 不抬版；
  本轮上游收的是**「取门」这件事本身的写法**，而门写错**下游自己也有一份**。
  「上游给了就必须有人读」管的是外供面，管不到「本仓自己有没有把同一处写对」——后者本轮单独立成判据（不靠上游自觉）。
- 边界如实声明：① 真实 SillyTavern 宿主实机未验（无头门禁只证明模块间契约，不证明宿主真会传怪值进来）；
  ② 三处门只覆盖本仓**删楼回滚链路**的取值点；`apps/place/place-data.js:99` 的弱口径 `numOrNull` 仍挂 O-8；
  ③ 上游宿主侧其余 `removeByFloor` 系列各有自己的 `Number()` 门，不在本轮外供面内。

## Gate O-8：三份同名 `numOrNull` 口径统一（**已完成**，RubyPhone v3.3.1）

主题：**同一条口径不许在一个仓里存在两种严格度**。本仓三份同名函数里，`apps/place/place-data.js:99`
那份是**弱一格**的：只挡 `null` / `undefined` / `''` —— 实测 `'  ' → 0`、`[] → 0`、`true → 1`、
`false → 0`、`[5] → 5`（`Number([5])`），即「上游没给这格」被编成 0，而 0 在本仓是合法楼层/合法计数。

- **为什么 O-1 轮没动、本轮要动**（口径必须写清，否则后人照旧结论抄）：
  O-1 轮判它「可达性为零」（怪值只能来自上游外供面，而上游已收口为 `number | null`）；
  O-8 收它的理由：**本仓不该靠上游自觉** —— 「可达性为零」是**上游的状态**、不是本仓的保证，
  而同一个仓里两种严格度的同名函数会让读者无法判断该信哪一份。
- 落地：`place-data.js` 的 `numOrNull` 改为与 `config/projection-contract.js:95` /
  `config/injection-contract.js:118` **逐字同形**的金强口径（先看类型），三份仍**各自持门**
  （不跨层共享，避免 `apps/*` ↔ `config/*` 反向依赖）。
- **判开是双向的**：真给 `0` / `'0'` / `5` / `'5'` / `' 5 '` / `3.5` 一律照常出数（真模块实测）。
- 测试：新增 `tests/system-v313.test.mjs`（10 项）：A 三份同口径 / B 真模块行为（走导出面）/
  C 结构面 / D 版本四源同源 / E 三条破坏副本负控制（弱口径复活 / 三份之一退化 / 互不掩护）。
- **同轮交棒**：`tests/system-v310.test.mjs` 的 N3 破坏锚点即本次修掉的那行弱口径 ⇒ 锚点消失（正常交棒）；
  改为更彻底的破坏形态（把门换成 `Number()` 兜底）。
- 边界如实声明：① 真实宿主实机未验；② 统一的是**口径**而非实现位置（三份仍各自持门）；
  ③ `apps/health/medical-core.js:101` 的 `numOrNull` 属**另一族**（医疗天数的宽松取数，入参先 `String(v).trim()`），
  本轮**不动**，文档里已区分。

## 状态检查点
- **O-8：已完成**（RubyPhone v3.3.1，上游侧无对应改动）—— 取值域判据化：三份同名 `numOrNull`
  统一为强口径（`place-data.js` 原为弱一格，实测 `'  ' → 0`、`[] → 0`、`true → 1`）；
  新增 v313（10 项，含三条破坏副本负控制）；同轮交棒 v310 N3 的破坏锚点（原锚点即本次修掉的弱口径行）。
- **O-2：已完成**（lonsha v3.224.0 + **RubyPhone v3.3.0**）—— 楼道取值门同族普查：上游收「回放 / 前移层」六面
  ＋宿主四处；下游判定**与上游自述结论相反**（外供 `skipped` 确实零消费，但同族根因在本仓删楼回滚链路独立发病三处：
  `invalidateFloorAt('')` 一次清空整份记忆 / `MESSAGE_DELETED` 半收口把 `''` `[]` 读成第 0 楼 / 桥层 `Number()` 直通），
  已修三处（各持本地 `floorOrNull`，宿主侧 `stFloorOrNull` 前缀）＋新增 v312（16 项，先红后绿）＋九门全绿；
  同轮捐到三处测试侧缺陷（抬版键序 / 观测错对象 / 断言过严）。
- **O-1：已完成**（lonsha v3.223.0；下游**仍不抬版**，判定依据见上 Gate O-1 节）；
  上游场所面全路径真判开「没给」与「给了 0」：门本体（`numOrNull` / `num` 改先看类型）+ `import` 七格如实 `null`
  + 写侧三处「取不到即拒绝」+ 同族残留六面（列号 / 外供 `tree`+`currentChain` / 回滚三法 / `visits.floors`）。
  上游验证：五套件 144/144；全量 204 文件 / 1881 断言 0 失败、42/42 审计 RC=0；版本守卫 0 问题。
  本仓**无代码改动**；同期核到本仓同名函数三份实现**强弱不一**（`config/*` 强、`place-data.js` 弱一格，
  怪值会出数），可达性为零故本轮不动，已登记为观察项交 O-8 批次。
- **R3-D：已完成**（lonsha v3.221.0 + RubyPhone v3.2.0）；三面在 import / 删楼 / 前移 / 重建四条路径上
  收口：新增 `clearHeader(floor)` / `shiftFloorRefs(deleted)`（先清被删楼残留，再同时平移四面），
  `rollbackFloorOnly` / `rollbackFrom` 按同一语义撤场景头，`_rebuild` 无真源时不再清空式重建，
  `numOrNull` 铺到 `import` 七格 + `headers` 键，新增 `MAX_HEADERS`（载入侧此前无上限），
  `coverage()` 增 `headerFloors` / `headerCount`，宿主不再全清在场，登记表 scene 面交给模块。
  验证：上游 v3222 25/25；全量 202/202 文件 / 1814 断言 0 失败、42/42 审计 RC=0。
  下游 system-v311 全绿；`npm run check` 九门全绿。
  边界：不改对外语义（三面键面与 R3-A 逐字一致）；`shiftFloorRefs` 重复调用仍会再次平移（T17）；宿主实机未验。
- **R3-A：已完成**（lonsha v3.220.0 + RubyPhone v3.1.0）；`summary()` 外供面 7 → 11 键
  （增 `currentChain` / `tree` / `visits` / `header`，旧键未动），新增 `tree()` / `visitHistory()` /
  `headerFace()` 三方法与上限 `MAX_TREE_ROWS=240`，新增 `numOrNull()` 把「没给」与「给了 0」判开，
  宿主 `SceneBookFallback` 补三个同形空方法；下游同轮接三面并渲染三卡（缺席 / 空两种文案分开）。
  验证：上游 v3221 17/17；全量 201/201 文件 / 1789 断言 0 失败、42/42 审计 RC=0。
  下游 v310 19/19；`npm run check` 九门全绿（两处真缺陷由既存判据当场捐到并修掉：
  `num(null) === 0`、新样式未合并进 `phone.css`）。
  边界：不改场所内部语义；真实宿主实机未验。
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

- **R2-B：已完成**（v3.216.0）；`_injectionStage` / `_injectionCommit` 两段式（暂存 → 代际确认后提交），
  轮次只由提交推进，过期清暂存并记载荷读数；v3217（11 条，先红后绿）；
  全量 197/197 文件 / 1732 断言 0 失败、42/42 审计 RC=0。
- **R2-A：已完成**（v3.215.0）；注入读数收口到唯一构造点 `_injectionRecord`（恒定 10 键），
  逐块读数 `_injectionBlocksOf`（kept/dropped-budget 两态）、代际过期留痕 `_injectionDiscardStale`
  （累计计数、刻意不碰读数）、外供面 `buildInjectionReadout()` 进快照 + 桥 `injectionRefOf(i)`；
  面板为真生成读数作证并单独一格展示诊断（明写「没有进入 AI 上下文」）；v3216（14 项，先红后绿）；
  全量 196/196 文件 / 1721 断言 0 失败、42/42 审计 RC=0（新测试已登记进参考基准）。
  边界：**不声称**消除「过期代在 await 期间已写脏」（记录延迟到 await 之后属 R2-B）。
- R1-E：**已完成**；新增 evidence-workbench.js（413 行）+ 宿主接线 + v3214（11 项，先红后绿）；
  全量 194/194 文件、42/42 审计 RC=0（新测试已登记进参考基准）。
- R1-F：**已完成**；repair-loop preview/validate + dedupeKey 幂等；index.js abandonRepair /
  repairRevision / 桥 `repair` 受控写入面（恒定回执 9 键 + 两道门）；v3215（12 项，先红后绿）；
  全量 195/195 文件 / 1705 断言 0 失败、42/42 审计 RC=0。
- R1-A：已修复；先红后绿22项定向通过；全量1675断言、42审计通过（补齐测试登记后RC=0）。
- R1-B：已修复；先红后绿32项定向通过；手机838项测试及九门RC=0。
- R1-C：已修复；先红后绿35项定向通过；全量193文件/1682断言/0失败、42审计RC=0（新测试已登记进参考基准）。
- R1业务投影/工作台/证据修复：**读面（R1-A/C/E）与写面（R1-F）均已落地**。
- R2（准确记忆与受控行动）：**已落四段** —— R2-A 注入读数真实性（lonsha v3.215.0）、
  R2-B 迟到隔离（lonsha v3.216.0）、R2-C 注入读数消费侧接入（RubyPhone v3.0.2）、
  R2-D 无主暂存不得被别的代捡起（lonsha v3.217.0）、R2-E 取消留痕（lonsha v3.218.0 + RubyPhone v3.0.3）。
  R2-F 双向关系对账 + 知情网络（lonsha v3.219.0）。
  **R2 剩余（已取证、待实施）**：
  ① **取消留痕**：**已完成**（R2-E，lonsha v3.218.0 + RubyPhone v3.0.3）——
     详见上文 Gate R2-E 与状态检查点。
  ② **双向关系 / 知情网络**：**已完成**（R2-F，lonsha v3.219.0）——
     详见下文 Gate R2-F 与状态检查点。
- R3：**已启动** —— 第一批次 A 项（场所三面外供）**已完成**（R3-A，见上）；
  B 项（三面的回滚与回读面收口）**已完成**（R3-D，见上）；
  其余（到访冲突、跨平台事件、O5 性能、F5/F6）待实施。
- 优化方向（O 批）：**已启动** —— O-1（场所面「没给」与「给了 0」的真判开）**已完成**（上游 v3.223.0，见上）；
  下游侧同轮判定**不抬版**（本轮无新增外供键、既有键取值域变化已被既有读法覆盖），
  并核出一条同名函数口径不对称观察项（`place-data.js` 弱于 `config/*`，可达性为零未动，交 O-8）；
  O-2（同族普查：取值门这条根因在全仓还有几处）**已完成**（上游 v3.224.0 + **本仓 v3.3.0**，见上）——
  下游判定推翻了上游自述的「下游不抬版」：下游同族真缺陷三处，已修 + 新增 v312（16 项，先红后绿）+ 九门全绿；
  **O-8（取值域判据化：三份同名 `numOrNull` 口径统一）已完成**（本仓 v3.3.1，见上）——
  把 `apps/place/place-data.js` 那份弱一格的实现对齐 `config/*` 的强口径（同一口径不许两种严格度）。
  其余（O-3 / O-4 / O-5 / O-6 的下游侧）待实施 —— 这四项上游侧已完成，下游侧需按「本仓有没有同类面」逐条判定。
- R4：待实施。
- 真实SillyTavern宿主验证：未验（写入面的两道门与回执形状已在无头环境逐条验证，宿主侧实机未验）。

- R1-A追加GATE：全量失败根因为新增测试未按仓内纪律登记，允许catalog_reference_consumers.tsv追加一行；不放宽守卫。上游预算4文件/150行。
