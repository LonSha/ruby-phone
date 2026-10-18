## 迭代 186 — v4.27.0 · 第四期 R4-X6 可操作的线索与未完事项板
# 占位：下列条目由 tools/bump_v4270.py 写入 ITERATION_LOG.md 与本版 update-log 条目
- 【版本升至 4.27.0（五源同源）：第四期 R4-X6 可操作的线索与未完事项板】
- 【新增 config/causal-board-contract.js：六态分形（插件不在场 / 面不在场 / 本机读不出 / 没给看谁 / 真读数无内容 / 读到）；四收口 unresolved / resolved / cancelled / broken 按上游 id 数组**分列**，不自己重判 closure 字段；已确认边与推测边**两个数组**，推测边只进 speculative 一列、一条都不混进 edges；追溯只走已确认边，not-in-graph 与「追到头了」不同形；行动路由声明式（commitment 去日程 / seed 去剧情线 / event 去记忆 / note 去剧情线）；禁用键深度扫描（百分比 / 置信度 / 优先级一族）】
- 【本版自己抓到的缺陷形态：修前实测「上游名面已在、手机侧零消费」——上游因果面 v3.323.0（M3-X3）的 causal-chain.js 早已有 build / proposeCandidates / traceBack / todos 出口，而手机侧 grep causalChain 零命中，于是「未结约定」与「已解决伏笔」在界面上同形、「仅推测因果」与「已确认因果」也同形，三者处置相反却看不出来】
- 【本版自己抓到的缺陷形态：视图里写了第二份状态判定词与手写归因文案表（b.state === engine-absent 这一族），内核改名那天这些比较会**静默落空**，于是「插件没装」被显示成「读到了一份空图」——两个处置正好相反（该去装插件 vs 该去聊一楼）而没有任何东西会响；补丁把判定收回内核 boardGateOf / traceNoteOf，接线层判定词零残留】
- 【交棒改写：新增 apps/plotline/plotline-board.js 接线件（取数 + 持起点 + 落点形状，只搬不重算；起点是用户显式点选，空值即清空不回落成默认第一条）；plotline-app.js 增十个 board 出口与换会话作废起点；plotline-view.js 增因果板卡片（四收口分组 + 推测边单列 + 三个动作按钮）；plotline.css 增 pn-cb 系列样式】
- 【交棒改写：scripts/bridge-contract-audit.mjs 新增 J20（因果面真源四出口 + 产品侧消费点下限 1）与门禁标签；config/crossrepo-registry.js 新增登记行 lonsha.causalChain（since 取上游 producer_version 3.323.0 同口径）；tests/audit/upstream_face_unconsumed.json 把 causalChain 移出（本表此刻空表是真读数）、tests/audit/upstream_face_lag.json 记入 causalChain / consumer-none 一条分歧（上游账面仍写 none@0）】
- 【运行时验证边界：本版接线为真跑（真契约件 + 真接线件 + 假存储走完整旅程），但真实 SillyTavern 宿主里的点击流、回源事件 phone:causalSource 与去行动事件 phone:openApp 的最终落点**未跑** —— 本卡只派发事件、不执行跳转，其**在真实宿主上的最终效果待实机复核**；登记入 docs/runtime-verification-boundary.md】
- 【本版新增判据 tests/system-v4270.test.mjs，五组覆盖口径 / 内核行为 / 接线行为 / 负控制 / 版本锚】
- 【不做（计划原文三条）：不扩大 MAX_OPEN（上限沿上游既有量级，不新造第二套）；不增加第二套任务事实库（四收口与待办一律搬上游读数）；不把「提醒过」当「履约」（零写面，读数里 writesNothing 恒 true）】