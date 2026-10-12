# 第三期产品主线：代码证据与双项目执行包

取证日：2026-10-12。基线：RubyPhone v3.95.0 / `8ef9398`；LonSha Memory v3.319.0 / `b36c73a`。起点两仓工作树均干净。

## 交付范围

本轮只有规划：每仓优化9项+拓展9项，共36项。没有实现这些功能，没有抬版，没有添加审计脚本或运行时模块。计划的价值由后续用户旅程衡量，不由守卫数量衡量。

## 证据等级

- **实测**：本轮Node v24.18.0对真实纯函数的合成输入探针，可复跑，代码附后。
- **源码事实**：读当前生产函数、调用处及约束；只证明实现形态，不证明用户遇到故障的概率。
- **产品提案**：基于现有形态与用户长期RP需求提出，不冒充用户实测反馈；开工先复走旅程，已有等效能力则直接复用、缩项，不为凑计划造第二套。
- **历史证据**：既有测试/浏览器探针/版本记录只作为带版本的快照。本轮未跑全量、未调用真实模型、未执行真宿主交互，不能宣称当前功能全绿。

## 过时内容裁定

| 旧说法 | 本轮代码核对 | 规划处理 |
|---|---|---|
| 手机全历史搜索不让出事件循环 | `global-search-engine.js::_yieldTurn/searchAll` 已有宏任务让出与取消 | 不重做取消框架；改搜索相关性与消息落点 |
| 手机没有工作流/创作/备份/能力中心/窄屏设置 | `workflow-runtime.js`、`creation-workbench.js`、`data-backup.js`及workflow/creationdesk/backupdesk/caphealth/accessdesk均已在；已存在对应实现笔记 | 现能力复用；新需求是可编排流程、编辑体验、重启阅读 |
| 记忆第二期 M-X1～M-X8 未做 | 当前有 memory-center、repair-settle、fact-lifecycle、memory-package、phone-fact-bridge、knowledge-preview、extract-feedback、project-registry；有v3310～v3317测试，center还有settings-ui接线 | 旧勾选为v3.309历史快照；不能据此重建功能 |
| 没有真实浏览器能力/从未验证设置 | 当前有手机tests/browser与记忆`_mo2_realbrowser_probe.mjs`；v3.318记录真浏览器设置流程33条读数 | 不复活为建设一套浏览器守卫；新功能仍需对应旅程实机验收 |
| 浏览器切片完成=所有生成/删楼/双扩展共装已验证 | 记忆PLAN自己保留这些流程未执行 | 不据“全部交付”抹去缺口；结合实际功能批次验收，不单开第37项 |
| 手机已接全部上游面 | 手机历史表停在5面；上游登记现7面，memoryToolsEnvelope/phoneFactReceipt consumer=none@0；手机生产搜索命中仅index公告，没有消费点 | R3-X1/X2 做真实消费；登记与剩余v3204 B2对齐为附带收口 |
| 记忆缺混合检索/别名/分层摘要/修复 | 当前hybridMerge含RRF并接rerank；entity-semantic、SummarySystem、repair链均已在 | 只改质量、时段身份与用户操作深度，不把旧能力改名充新项 |
| 继续做文档与门禁收口是主线 | PLAN现行排序仍有O8/旧X收口措辞，与用户最新要求不符 | 新计划接管产品排序；旧决定保留为历史，不改写旧理由 |

## 本轮实测：不是凭注释推断

真实模块探针代码见 `2026-10-12-product-probe.mjs`，从本仓根执行：

```sh
node docs/planning/2026-10-12-product-probe.mjs <ruby-phone仓库路径>
```

输出摘要：

```json
{"ambiguousMemberChosen":"a","recallInputCount":2,"recallOutputCount":1,"contactCallCounts":[{"id":"a","calls":1},{"id":"b","calls":0}]}
```

1. `matchMemberByName` 面对两个同名成员选首个，不返回歧义。此为内核行为；实际群消息还需验证上层如何传成员ID。
2. `recallBlock` 对前24字相同、结尾事实不同的两条记忆只保留一条。此为可复现有损行为，不是单纯界面问题。
3. `buildContactInsight` 将仅含名字的通话归给首个同名联系人。初读循环时曾疑似重复累加，继续读到break并实测后纠正：**并非两人各加一次，而是歧义时静默认给第一人**。

## 关键源码锚点

以下为基线定位，后续行号可能变化，按符号复核：

- Ruby：`group-scheduler.js::matchMemberByName`（约34行）；`contact-insight.js::buildContactInsight`（约68/149行）；`lonsha-bridge.js::recallBlock`（约298行）。
- Ruby：`global-search-engine.js::scoreHit/_yieldTurn/searchAll`；`xhs-view.js::_renderMasonry`（约62行）；`chat-view.js::_injectApps`（约11640行，取`_vp.*App`已建实例）。
- Ruby：`ReadingData.addBook`（约278行）明文规定正文驻内存；`workflow.js::WF_FLOWS`（约258行）两条固定流程；`creation-pipeline.js::buildCreationDraft`与`creation-workbench.js::cwPlanPublish`。
- Memory：`unified-recall.js::nodeToCandidate`（约43行）200字候选；`index.js::hybridMerge`（约7805行）RRF；`memory-organs.js::rerank`（约505行）已有模型重排。
- Memory：`entity-semantic.js::createRegistry/resolveEntity`；`stm-ltm.js::_rolloverToLtm`（约307行）40/24窗口与尾裁；`memory-core.js::SummarySystem`已有卷摘要，不得将STM-LTM局部窗口等同整个插件只能存24条。
- Memory：`evidence-query.js::universeOf/query`（约322/477行）每次物化筛选排序；`extract-feedback.js::suggest`（约305行）key/from/to为null。
- Memory：`extraction-cadence.js::computeActiveTypes`和`smart-trigger.js`已有双层节奏底座；`memory-center.js::rowsHtml`（约334行）及settings-ui约656行是真实用户入口。

## 双项目共同执行顺序（六个大包，不是36次零碎抬版）

| 执行包 | RubyPhone项 | 记忆插件项 | 玩家拿到的完整结果 |
|---|---|---|---|
| A 身份、时态与聊天记忆 | R3-O1/O2/O6 | M3-O2/O3/O9 | 聊对人、记对事，闪回不改坏当前事实，重开后配置仍有效 |
| B 长篇记忆与往事查询 | R3-O4/X1/X2 | M3-O1/O4/O6/X1 | 长聊记忆不只剩最近内容，手机事件可确认入记忆，问题能回到出处 |
| C 群像与关系体验 | R3-O3/X3/X5 | M3-X2/X3/X4 | 群聊各有立场，约定可推进，关系变化与伏笔可追踪 |
| D 纠错与日常操作 | R3-O5/O9/X8 | M3-O5/O7/O8/X9 | 手机更顺手、阅读可续；用户能直接修一处错记，不必重建全库 |
| E 创作与剧情资料 | R3-O7/O8/X4 | M3-X5/X7 | 图文语音可续作，同事件跨社媒一致，设定与章节回顾可用 |
| F 世界漫游与长期玩法 | R3-X6/X7/X9 | M3-X6/X8 | 多人旅行、个人流程、地点探索，与分支正史和旧事触发相连 |

执行包是集成顺序，不强迫整包等齐才能验收。B内先做M侧查询优化再接手机问答；D内先可比方案再接局部重提；E的创作完成后回验D的阅读摘录→作品流程。数据安全问题优先处理，P2不挤占尚未完成的P0。阅读附件存储是明确需确认的实施决策，不在计划阶段擅改持久化铁律。

## 防元工作挤占（人工执行约定，不新造机器守卫）

- 36项全部是产品项。新增守卫、测试重构、自动台账、README重写、版本号治理均不占名额。
- 每包以1～3条完整用户旅程验收；维护投入建议≤20%，功能与体验≥80%。安全缺陷可例外，但要说清它阻塞的具体功能，不能开展无限横向审计。
- 优先复用现有入口/owner/查询/工作流/存储；禁止为“接口导出有消费”而加无意义调用或为了“全绿”伪造跨仓消费。
- 计划不是冻结规格；开工发现目标已达成时删减而不是重复实现。大包不等于同时重写所有模块。
- 当前已知Ruby全量残余v3204 B2在本轮不修；待R3-X1/X2实际消费时连同对账收口。仅改计划文档允许提交/推送，依用户本轮明确授权；不声明仓库全量通过。

## 历史笔记分类

- 两仓第一期四份：历史证据，部分重叠，不变更当年决定。
- 两仓第二期四份：基线与勾选已过时，后续排序由第三期替代；加互链，保留未验边界，不能凭新计划将其标成implemented。
- 手机implemented的workflow/creation/backup/caphealth/access五份：既有能力直接复用；不归档、不删除，也不宣称本期又交付一次。
- 记忆doc-truthfulness-split提案：非本期产品工作，既有纪律保留但不列为实施目标。

## 本轮交付复核

- 四份新计划：各9个唯一编号，合计36项；现状/增量/验收/依赖字段完整；相对链接存在；新增文件凭据扫描无命中。
- Skill原有脚本：两仓note tree均rc=0；四份新计划单独运行format均rc=0。全库format仍rc=1，问题来自历史笔记缺标准头块/章节，非本轮新计划；不趁机重写历史。
- 记忆既有定向套件v3310/v3314/v3316/v3317：60/60通过。手机既有定向套件v3860～v3900：104/104通过。仅证明相关既有行为，不代表新提案已实现。
- 记忆既有plan-currency、doc-truthfulness均rc=0；两仓git diff --check通过。没有运行全量，没有刷新测试/跨仓baseline，没有修改版本和运行时代码。
