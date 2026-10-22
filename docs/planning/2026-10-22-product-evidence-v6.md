# 第六期双项目产品证据与实施路线

日期：2026-10-22。**本次交付是36项规划，不是36项实现。**

| 项目 | 本轮生产源码基线 | 现行计划 |
|---|---|---|
| LonSha记忆插件 | v3.353.0 / `a6025ba` | 本仓PLAN.md中的第六期优化9项＋拓展9项 |
| RubyPhone | v4.47.0 / `6184b21` | 对应仓PLAN.md中的第六期优化9项＋拓展9项 |

源码依据优先于注释和计划。两仓在本次规划前均已推送至origin/main；本轮取证开始时工作区干净。没有把本地tracking ref当作本轮已fetch的证明；最后提交推送后另核远端分支哈希。

## 取证口径

- **S：源码观察**——读现役字段、算法、宿主入口及已定位的消费者；只支持所列范围的结论，不把文件名缺失或关键词零命中当全仓不存在。
- **P：模块实跑**——本轮分别运行两仓 `node docs/planning/2026-10-22-product-probe-v6.mjs`，各3个合成场景，均直接加载生产模块，不复制算法。结果在本页记述，脚本可重跑。
- **H：真实宿主旅程**——本轮未运行。所有新计划的真实点击、重开、窄屏及跨App验收均是未来实施要求。
- **Q：生成内容质量**——本轮未运行。计划中的对照故事、两类模型、长期连贯性是未来验收，不得用模块通过冒充。

用户需求由“现有能力边界＋用户明确要求产品大更新”推导；未做用户访谈、市场调研或竞品完整比对，因此不声称全球首创、已验证留存收益、性能提升百分比或确定实施工时。

<a id="memory-evidence"></a>
## Memory evidence

以下路径相对记忆仓；行号是 `a6025ba` 的定位提示，符号比行号稳定。源码可从 [基线目录](https://github.com/LonSha/lonsha-memory-plugin/tree/a6025ba)复核。

| 编号 | 现役路径/符号与调用面 | 本轮确认的事实 | 对新计划的约束 |
|---|---|---|---|
| M-E1 | `unified-recall.js::searchTextParts`（127附近、457附近消费）；`index.js::recallMemory`(7982)、`buildInjection`(9859) | 多源召回、BM25、分支过滤与预算链已存在；第五期已增加长文本分段候选 | O1/O2/O3/O6必须超出调排序/修长度；不能再说4000字之后绝无检索入口。S |
| M-E2 | `memory-organs.js::CharacterMemoryBank`(956–1058)；`memory-core.js::addLifeDetail`(1904附近) | 角色核心/近期文本，近期3版本、文本200字、核心超过50按衰减回收；lifeDetails有topics/anchors/until/tier | 只证明这些组件当前模型，不证明全仓记忆只有这些容量。O4/X2必须新增自传/经验语义，不能声称首次支持偏好。S |
| M-E3 | `fact-version.js::copyFact/readAt/resolveQuery`；`knowledge-trace.js`；`story-clock-parse.js` | 事实from/to/floor、来源、叙事层与修订已在；当前normalize不保留自造occurredAt/learnedAt字段 | P1实跑保留from=10、floor=40，丢弃非契约字段；不据此断言其他模块没有剧情时间/知识时间。O5整合联合时序而非修传参。S+P |
| M-E4 | `relation-history.js`、`perspective-card.js`、`causal-chain.js`、`event-completeness.js`；宿主取库口20675/20684/20692附近 | 关系转折、lived/heard/misled/unknown、事件cause/action/result/followup及有据/推测边区分已在 | O1/O4/O7与X1/X3/X5/X8都必须承认旧语义。`event-chain.js`是agent运行日志，不是本次要造的故事经历层。S |
| M-E5 | `qa-thread.js`、`evidence-query.js`、`testimony-board.js`及宿主问答组合 | 多轮条件、时点操作、证词与结构化证据查询已有 | O2要求跨证据求解与反证组织，不重复申报“自然语言问答”。S |
| M-E6 | `stm-ltm.js`、`node-rollup.js`、`memory-core.js` | 巩固、长期滚动摘要、保底句与分卷金字塔已有 | O3新增可展开粒度和实际查询消费；不叫“首次支持长期记忆”。S |
| M-E7 | `material-pack.js::TASKS/build`；`index.js::_materialInventory`(3346)、3444附近消费 | 四任务meet/reunion/advance/resolve；旧事、关系、视角以及第五期新增scene/open commitments进入材料 | P3实跑核对四任务。O6的创新须是持续场景状态与动态选材，不能只是再添任务名或场所字段。S+P |
| M-E8 | `research-collection.js`、`lore-import.js`、`lore-crosscheck.js`；`index.js::queryResearchCollection`(16957附近) | 已有专题集合、引用、结论、资料变更与查询出口 | O8做持续论点演进，不重复跨资料集合。宿主返回新state是否在所有UI路径落盘未逐一实测，不宣判“无法保存”。S |
| M-E9 | `goal-tracker.js::deriveStatuses/nextSteps`(132/171)；`commitment-ledger.js` | 前置条件由active/revoked/superseded/disputed派生；约定含周期与例外；借还字段已有 | O9新增多路线/代价/改道；X7新增有观察条件的期待，不把现成周期/借还再算一项。S |
| M-E10 | `hypothesis-workspace.js::createWorkspace`；`index.js::queryHypothesisWorkspace`(16940附近)；`branch-canon.js`、`impact-preview.js` | 已有snapshotFloor、假设集合、状态与结果；构造函数返回新state而不写入传入对象 | P2实跑确认该数据形状及纯返回行为，不等于宿主存档验收。X4必须增加多步对照，不仅两份结果。S+P |
| M-E11 | `narrative-pulse.js`、`fated-recall.js`、`recall-echo.js` | 已有情绪词典、张力、启发式弧光、情绪反向召回和旧事重现控频 | O4/X6不是首次做弧光或回忆触发；新增的是人物经历组织与意象意义变迁。S |
| M-E12 | `volume-continuation.js`、`project-registry.js`、`branch-semantics.js` | 项目/卷选择、接续包、选择性导入与来源范围撤销已存在 | X9不是又做迁移/导入；须有时间跨度、继承对象与到期语义。S |

### 记忆模块探针结果

1. fact-version生产normalize可保留已定义楼层字段；未知的两个时间字段不在其契约中。本探针不是故障测试，只限定当前能力。
2. hypothesis生产构造返回含id/label/assumptions/state/snapshotFloor/createdAt/result的工作集，原对象未改；没有测试宿主是否承接state。
3. material生产TASKS精确为四项；没有测模型能否理解它们。

<a id="phone-evidence"></a>
## Phone evidence

以下路径相对RubyPhone；源码可从 [基线目录](https://github.com/LonSha/ruby-phone/tree/6184b21)复核。

| 编号 | 现役路径/符号与调用面 | 本轮确认的事实 | 对新计划的约束 |
|---|---|---|---|
| R-E1 | `config/task-entry.js`、`config/life-events.js::LifeEventStore`、`config/view-state.js`、`config/open-ref.js`、`config/notice-digest.js` | 任务入口、生活事件、返回状态及按事通知已有 | O1需交付持续事务与阶段转移，不再做入口聚合。S |
| R-E2 | `apps/wechat/group-scheduler.js`；`config/group-pace.js` → `apps/wechat/wechat-data.js::planGroupPace`(2541) → `apps/wechat/chat-view.js`(12512附近) | 冷却、接话、@、关系门槛和沉默均已有；投票归属/转日历有第五期提交 | O3必须新增立场、反提案和多轮议题结果；不再申报“群聊有节奏”。S |
| R-E3 | `apps/memory/lonsha-bridge.js::recallBlock`(298)；`config/call-attribution.js`、`config/global-social-store.js`、微信未读/生成链 | recallBlock已改证据身份去重、句读预算收束、来源分档，不再是前24字去重的旧实现 | CONTEXT旧描述滞后，本轮只修相应一段。O2不是修80字或加主动消息；跨渠道连续议题是新目标。S |
| R-E4 | `config/date-playbook.js` → `apps/calendar/calendar-app.js` import(60)、build消费(415)；`apps/traveldesk/`、`config/recurrence-contract.js` | 活动五步、证据推进、多人行程/分账、周期例外已有 | P2核对五步。O4需可替代计划、执行中再协商；实施必须接日历真消费者，不能只改date App。S+P |
| R-E5 | `config/creation-pipeline.js`、`config/creation-multi-draft.js` → `index.js` import(199)、compose消费(4789)；`apps/creationdesk/` | 八来源六目标；多目标独立文案、替图保文、比较、局部重做、第五期取材交接已存在 | P1实跑lofter素材到weibo/magazine两份不同文本。O5只能以作品级/跨章节编排作为新增价值。S+P |
| R-E6 | `apps/reading/`、`config/reading-notes-contract.js`、`config/topic-dossier-contract.js`、`apps/memory/memory-app.js`（资料导入消费者） | 阅读进度、全文找句、摘录、跨书专题及资料版本已有 | O6新增问题驱动研读与写作过程，不再申报搜索/摘录。S |
| R-E7 | `config/relation-album-contract.js`、`config/shared-past-contract.js`、`apps/timeweaver/` | 关系回忆册、共同往事与织信已有 | O7需邀请/对谈/重访的实际互动循环，而不是加展示卡。S |
| R-E8 | `config/resume-workbench.js`、`config/resume-brief.js`、`config/resume-handoff.js`、`config/branch-contrast.js` | 项目选择、回顾、分支对读与接续交接已有 | O8必须提供可选择的剧情再入场；X9必须提供可操作多App试玩，不能仅做分支比较。S |
| R-E9 | `config/topic-echo.js` → `index.js` import(220)、build消费(4479/4485)；社交知识桥 | 话题以rootEventId聚合，支持发布/转载/评论/辟谣及知情反应 | P3实跑两平台同源话题。O9新增持续受众差异与讨论演化，不再申报跨平台话题。S+P |
| R-E10 | `config/drives-engine.js`、`config/goal-tree-contract.js`、`apps/asset/`、`apps/traveldesk/`、`apps/shop/` | 情绪维度/衰减、目标树、资产与分账、商品底座存在 | X1/X3/X4/X8是有状态的生活/组织/创作/共学玩法，不是增加数值条。相关完整旅程尚未本轮实测。S |
| R-E11 | `config/place-roam.js`、`apps/place/`、`config/presence-band-contract.js` | 地点路线提案、到访、在场与多人行踪已在；未知路程不编造 | X2必须产生地方机会与参与结果，不重做地图；X6可复用行踪证据但仍需独立谜题玩法。S |
| R-E12 | `apps/theater/theater-data.js`、`apps/soundkit/soundkit-data.js`、`config/tts-manager.js`、`config/media-task-registry.js`、`config/workflow-runtime.js` | 小剧场提示/续写、WebAudio配方、语音/媒体任务、有限工作流已有 | X5是声部/时间轴演出；X7是作者分支连载。不能把播放器或工作流重新包装。S |
| R-E13 | `config/hypo-trial-contract.js`、`config/causal-board-contract.js`、`config/perspective-contrast-contract.js`、`config/rumor-source-contract.js` | 双栏假设、线索板、证词对照与源图已有 | X6需可解谜游戏闭环；X9需多App分支状态与真实操作，不能只读上游结果。S |

### 手机模块探针结果

1. `composeDrafts('lofter', ..., ['weibo','magazine'])` 生产函数返回两份草稿，分别保存不同note；排除“只能单目标”这个过时判断。
2. 生产 `PLAY_STEPS` 精确为prepare/depart/arrive/interact/wrapUp；排除“活动仅能看不可推进”的旧判断。
3. 生产话题模块把weibo发布与xhs转载按同一事件聚为一个两平台页面；排除“首次支持跨社媒话题”。

## 历史提案的裁定

两仓已检索 `.agents/notes/proposed` / `implemented`（在场者）及各期标题、目标模块关键词。旧内容分三类处理，不搞历史笔记大迁移：

| 旧记录 | 本轮裁定 | 处理 |
|---|---|---|
| 第五期四份九项计划 | 有实现覆盖，已不是全部待办；与第六期部分能力重叠 | 保留历史提案文本，增加第六期互链/历史说明；根导航替换成第六期 |
| 第三/四期关系、因果、视角、问答、阅读、活动、创作、续玩等 | 已有底座；与第六期是深化关系，不是从零新增 | 各新条目明确不重复什么；不删除旧实现理由 |
| 更早守卫/台账/外移/发布路线 | 不属本次产品名额，不能从旧优先级复活 | 历史边界保留；现行排序只指第六期 |
| “4000字后无法检索”“只单目标草稿”“活动不能推进”“前24字去重” | 已被代码推翻的旧判断 | 不列新计划需求；CONTEXT相应过时段落小范围订正 |

### 第五期实现映射（不是完整旅程验收）

- 记忆仓：v3.350.0覆盖M5-O1/O2/O3/O8；v3.351.0覆盖O4/O5/O6/O7/O9；v3.352.0覆盖X1/X2/X4/X5/X8；v3.353.0覆盖X3/X6/X7/X9。依据CHANGELOG与生产入口，不能因旧Status仍为proposed而重报。
- 手机仓：v4.31 O3/O4；4.32 O5；4.33 O6；4.34 O7；4.35 O8；4.36 O9；4.37 X1；4.38 X2；4.39 X4；4.40 X5；4.41 X8；4.42 X9；4.43 X3；4.44 O2；4.45 O1；4.46 X6；4.47 X7。依据提交链与update-log，不能用这些实现主题等同18条真实旅程已通过。
- 记忆仓前次日志 `/tmp/lmp_test9.txt` 记333/333文件、4031断言、0失败、115.3秒；本次调研阶段重新读过该既有结果，**不是本轮重跑**。登记快照仍停v3.349.0，README的“全量待验”是登记口径；两者不应混为一条读数。本轮不为规划启动读数治理项目。

## 差异化与不重复计项

| 产品边界 | 记忆插件独立成果 | 手机独立成果 |
|---|---|---|
| 经历与事务 | O1重建已发生经历，可从原生记忆页查询/校订 | O1承接正在处理的跨App事务，含选择与执行，不重建事实 |
| 场景与通信 | O6决定可用材料和人物视角 | O2/O3组织渠道续谈与多人议事；可用手工输入独立运行 |
| 研究与创作 | O8维护主张、证据与修订含义 | O5/O6组织作品章节、并排研读、批注和编辑成果 |
| 关系与回忆 | O7/X8保存关系动力与回忆解释 | O7提供邀请、对谈、重访的可玩交流 |
| 组织 | X5管理组织实体、规则与继承 | X3提供分工、会议、资源与成果的经营循环 |
| 假设分支 | X4提供多步反事实约束与差异解释 | X9让玩家在分支手机中实际回消息、安排活动和创作 |

若某手机项最终仅显示记忆插件新增字段，则不满足本项验收，不能“上下游各算一次”。跨仓只传现有桥上可版本化的引用与结果；本轮不提前编造API签名。实施时再核真实宿主与接口，不把现计划中的概念词当已存在函数。

## 六个完整产品批次

编号只在此排程中各出现一次；同批内部按依赖先后实施。每批都需交付可用成果，不单独开“全是底座/守卫”的批次。批次数是建议交付组织，不是已承诺的版本号或工期。

| 批次 | 记忆项 | 手机项 | 用户能得到什么 |
|---|---|---|---|
| A 经历与再连接 | M6-O1、M6-O5 | R6-O1、R6-O2 | 查明上次那件事，回到同一事务继续交流 |
| B 理解与创作 | M6-O2、M6-O3、M6-O6 | R6-O3、R6-O5 | 多证据问答、按需展开、群像议事、整部作品编排 |
| C 人物与行动 | M6-O4、M6-O7、M6-O9、M6-X1、M6-X2、M6-X7 | R6-O4、R6-O6、R6-X4、R6-X8 | 人物有经历和等待，活动能改道，研读/委托/共学可持续 |
| D 世界与日常 | M6-O8、M6-X3、M6-X5 | R6-O8、R6-O9、R6-X1、R6-X3 | 持续研究、条件后果、组织记忆，续玩/社媒/共同生活/共营 |
| E 意义与演出 | M6-X6、M6-X8 | R6-O7、R6-X2、R6-X5、R6-X6 | 往事有新意义，街区可参与，声音可演出，推理剧可玩 |
| F 长线与平行路线 | M6-X4、M6-X9 | R6-X7、R6-X9 | 多步反事实、时代传承、互动连载与平行手机试玩 |

本期36项均按XL完整能力包设计，规模标签不等于价值证明。先交付A/B让日常使用受益；C至F逐批扩大长期与创作深度，不要求一次全部实现后才能使用。每项先做必要的内容实验，若新机制不能比现版产生可辨体验差异，应重设方案而不是缩成小按钮凑数。

## 防止元工作挤占产品工作的执行界限

1. 守卫、审计、台账、发布、重构均不独立占36项；相关修复随所属功能完成，不新增长期治理平台。
2. 产出必须包含用户行为与内容成果。纯模块＋测试＋诊断页不算完整产品；也不允许以模型演示片段代替持久化产品。
3. 计划规模不是36次小版本：每批内尽量形成大版本交付，不能靠频繁改版本号制造进展。
4. 不复制事实所有者、不引入外部数据库、不建无限后台代理。手机运行态沿PhoneStorage/chatMetadata，附件沿现有例外。
5. 验证只围绕本批可用结果：定向→真实宿主→内容对照→收口全量；不扩全局测试治理作为新主线。

## 本轮交付检查

两仓模块探针各3场景已运行通过。四份提案需检查9×4编号、相对链接、证据路径、旧能力去重、批次覆盖与依赖顺序；提交前按各仓现行要求验证。具体最终执行结果在随本文件提交的 `2026-10-22-plan-delivery-v6.md` 记录，不能把规划检查解释为36项功能完成。
