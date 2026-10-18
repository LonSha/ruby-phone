/* ============================================================
 * crossrepo-registry.js — 跨仓功能登记面 [v3.19.0 · 计划一「共同配套」第 2 条]
 * ------------------------------------------------------------
 * 【治的欠债（修前实测处境）】
 *   本仓与两个上游（lonsha-memory-plugin / world-axis）之间有十几条**面级契约**：
 *   对外投影 / 注入读数 / 九账证据 / 事件来源构成 / 知情网络 / 场所三面 / 世界钟 / 暗流……
 *   每一条都是「上游在某个版本开始产出、下游某个版本开始消费」，但**没有任何一处登记过它们**：
 *   归属仓是哪个、从哪个版本起产出、契约形状是什么、本仓哪些文件在消费、什么条件下会失效、
 *   以及**只装一个插件时会发生什么** —— 这些问题此前只能逐个文件读注释回答，而注释不随对面漂移。
 *
 *   代价是本仓反复出现的那一类错读数：把「上游还没就绪」（等一轮生成即可）与
 *   「本版根本没这一面」（等升级）显示成同一句话；把「闸门关着」（用户自己能开）
 *   显示成「功能坏了」。本面把这几件事分开陈列。
 *
 * 【本模块只做判定组合，不做取数】
 *   取数一律由调用方（诊断中心内核）注入 —— 与 `config/rollback-preview.js` 同族分工：
 *   调用方从**既有真源**取好数据（统一探针的快照 / 字段三态读取口 / 桥可观测面报告），
 *   本模块只把「桥在场 + 生产者版本 + 面级三态」组合成状态。两个理由：
 *     ① 本模块**零 import** ⇒ 结构上不可能自持桥名、不可能自写形态判据
 *        （第九道门 J1/J4 的纪律在这里是结构成立的，不靠人记得）；
 *     ② 同一轮里不会出现第二个取数点（本仓「同一读数的两个来源必然漂移」的根因形态）。
 *
 * 【七态（为什么不止计划原文的四态）】
 *   计划原文写「缺席、旧版、不产出和空数据分别呈现」—— 四态在这里逐字保留
 *   （absent / outdated / not-produced / empty）。另三态是本仓实测**压不进那四态**的：
 *     · gated        —— 桥在场、闸门关着（上游默认休眠 / 明确拒绝读取）。它既不是「缺席」
 *                       （桥就在那儿），也不是「不产出」（开了就有），处置是**用户去开开关**；
 *     · unverifiable —— 旧版桥没有字段三态自述、且值为空 ⇒「源里没这项」与「有这项、值是空」
 *                       **本就无从分辨**，如实标出来，不硬猜成任一方；
 *     · ok           —— 有值。
 *   压平任何两态都会造出本仓最贵的那类读数：两种处置相反的处境长得一模一样。
 *
 * 【登记表不得与真源脱节（判据面）】
 *   这是**展示面**，但每一条都必须能被真源码核对：`consumers` 点名的文件必须真存在、
 *   且真含对应消费 token（不是注释里提一嘴）；`fieldKeys` 必须真出现在真源的字段读取口调用里；
 *   上游 id 必须是已知的两个桥之一。由 `tests/system-v3190.test.mjs` 的 A 组逐条对账。
 *   理由：本仓有过「展示面自己给出错读数」的先例（v299 的 `chars` vs `characters` 那处），
 *   而登记面比那更容易腐坏 —— 它天生是手写的。
 * ============================================================ */
'use strict';

/* ── 归属仓（不导出：登记表里的值就是这些字面量；导出即须被消费，本仓死导出门禁会拦） ── */
const OWNER_LONSHA = 'lonsha-memory-plugin';
const OWNER_WORLDAXIS = 'world-axis';

/* ── 状态集（不导出：文案由本模块的 stateText 唯一实现，消费方只转发） ── */
const STATE = Object.freeze({
    ABSENT: 'absent',
    GATED: 'gated',
    OUTDATED: 'outdated',
    NOT_PRODUCED: 'not-produced',
    EMPTY: 'empty',
    UNVERIFIABLE: 'unverifiable',
    OK: 'ok'
});

/* 状态 → 文案（唯一实现；每一句都要说清「该谁动手」，这是本面存在的理由） */
const STATE_TEXT = Object.freeze({
    absent: '缺席：对方桥不在场，或还没有产出过快照',
    gated: '闸门关着：桥在场但未开启，需在对方插件里打开',
    outdated: '生产者版本偏低：对面在产出旧形状，等升级',
    'not-produced': '本版不产出这一面：等对面升级',
    empty: '面在、明确为空：这是真读数，不是读不到',
    unverifiable: '无从分辨：旧版桥无三态自述，且值为空',
    ok: '就绪'
});

/**
 * 跨仓功能登记表。
 *
 * 【每条字段的语义（**不是**可选装饰，逐条都被判据核对）】
 *   id            —— 登记标识（用于判据点名与去重，不参与展示排序）
 *   label         —— 人读的名字
 *   owner         —— 归属仓（生产者）。只能是两个已知上游之一
 *   since         —— 生产者**开始产出这一面**的版本；WorldAxis 侧为 null（见下）
 *   sinceSource   —— since 的**出处**（人读）。这个字段不是装饰：since 是本面唯一会
 *                    指使读者去「升级」的读数，写高了就会对装了新版的人说「你的版太低」。
 *                    故每个版本号都要能回答「你从哪知道这条在这一版开始产出」。
 *                    `tests/system-v3190.test.mjs` 的 A5 按出处分两种核法：
 *                    「本仓 …」⇒ 去那个真文件里找 'vX.Y.Z' 字面量；
 *                    「上游 …」⇒ 该版本本仓还没留档，证据在上游真源（如实标明，不假装是本仓查到的）。
 *   fieldKeys     —— 这一面在快照里的顶层字段名；必须与真源的字段读取口调用逐字一致
 *   keySites      —— 该字段名**在哪被真读到**：`{ file, token }` 列表（剥注释后核对）。
 *                    与 consumers 的分工：keySites 回答「这面在哪被读进来」，
 *                    consumers 回答「读进来之后谁在用它办事」——
 *                    两者都不可省：只有 keySites 会漏掉「读了但没人用」，反之会漏掉
 *                    「登记了一个根本不存在的字段名」（v299 的真缺陷就是后者）。
 *   contract      —— 契约形状（人读；点名的字段名必须能在真源里找到）
 *   consumers     —— 本仓**文件级**消费点；每项是 `{ file, token }`，
 *                    判据会**剥注释**后在真码里找 token（注释里提一嘴不算消费）；
 *                    写成 `{file, token}` 而不是裸文件名的理由：初版只写文件名，
 *                    判据就只能断言「文件存在」，那是本仓治过多次的假绿形态 ——
 *                    文件在、里面什么都没消费，登记面照样显示「有人在用」。
 *   invalidation  —— 什么情况下这一面会失效/被扣下（决定「重跑一轮」还是「查桥」）
 *   standalone    —— **只装一个插件**时的行为（三插件体系最常见的用户处境）
 *
 * 【since 的来源与纪律】
 *   每条的版本都逐条对齐**上游真源**（`/home/user/lonsha-memory-plugin` 的
 *   `git log -S"<快照字段赋值>" -- index.js`，与仓内消费侧注释的版本互相印证：
 *   如 `scene` 上游首见 v3.181.0 ↔ 本仓 `place-data.js:77` 写「v3.181 起」）。
 *   写高了会造出假的「版本偏低」读数（用户明明装了够新的版，却被指去升级），
 *   所以宁可引用仓内已有的版本字面量，也不凭印象写一个。
 *
 * 【为什么 WorldAxis 两条的 since 是 null、fieldKeys 是空数组】
 *   该桥的 `stat()` 只记账（publishes / publishedFloor / refused / externalReads / …），
 *   **不自述扩展版本**（桥对象上的 `version` 是契约版本，恒为 1，不是扩展版本）。
 *   既然读不到生产者版本，就不立版本判据 —— 只判在场、闸门与发布记账。
 *   如实少一条判据，好过拿一个恒为 1 的数字去比版本：
 *   而 `fieldKeys` 是**本仓 push 三态读取口**（`readPushField` 的键）的清单，
 *   对方是拉取型桥，其键（`worldClock` / `currents`）不经那条通道，
 *   故此处为空 —— 但它们的**真源读取点**照样登记在 `keySites` 里，判据一视同仁。
 */
export const CROSSREPO_FEATURES = Object.freeze([
    {
        id: 'lonsha.projection',
        label: '账本对外投影（L-F5）',
        owner: OWNER_LONSHA,
        since: '3.212.0',
        sinceSource: '本仓 config/projection-contract.js（v3.212）',
        fieldKeys: ['projection'],
        contract: '快照顶层 `projection`（envelope：contract / visibility / value）+ `meta.projectionFreshness`',
        keySites: [
            { file: 'config/projection-contract.js', token: 'snap.projection' }
        ],
        consumers: [
            { file: 'config/projection-contract.js', token: 'readProjection(' },
            { file: 'apps/diagnose/diagnose-data.js', token: 'readProjection(' }
        ],
        invalidation: '切聊 / 回滚 / 编辑后 `_mutationEpoch` 与 envelope 代际不符 ⇒ 上游新鲜度守卫扣下（reason `stale-conversation` / `stale-revision`）；**重发一轮即可**，不是升级问题',
        standalone: '未装上游 ⇒ 桥缺席；装了但早于 3.212.0 ⇒ 字段三态声明 absent（本面报 not-produced，不报「没有投影」）',
        /* ── 跨仓面对账三件套（[v3.20.3] 第十一道门 upstream-face-audit.mjs 逐格核对）──
         * upstreamFace     —— 上游 `tests/audit/open_face_registry.tsv` 里的 face 标识；
         *                     有它才谈得上「本仓这一条 ↔ 上游那一行」的一一对应。
         * declaredConsumer —— 上游表 `consumer` 列的出口名（本仓消费侧真源导出的那个口）。
         * declaredFloor    —— 上游表 `consumer` 列声明的产品侧消费点下限。
         * 为什么要在本仓**再写一遍**（而不是运行时去读上游表）：上游 `scan_cross_repo_binding`
         *   的 P2 禁止在役面引用兄弟仓；故上游表以**冻读取**进本仓
         *   （`tests/audit/upstream_face_cache.json`），本门拿「冻读取 / 本仓这行 / 门禁标签」
         *   三方对差 —— 任一侧漂移都会响。这三格不是装饰，是那场对差的输入。 */
        upstreamFace: 'projectionEnvelope',
        declaredConsumer: 'readProjection',
        declaredFloor: 4
    },
    {
        id: 'lonsha.injection',
        label: '注入读数（本轮实际注入）',
        owner: OWNER_LONSHA,
        since: '3.215.0',
        sinceSource: '本仓 config/injection-contract.js（v3.215）',
        fieldKeys: ['injection'],
        contract: '快照顶层 `injection`（9 键 + 逐块 6 键；落地不早于代际确认）',
        keySites: [
            { file: 'config/injection-contract.js', token: 'snap.injection' }
        ],
        consumers: [
            { file: 'config/injection-contract.js', token: 'readInjection(' },
            { file: 'apps/diagnose/diagnose-data.js', token: 'readInjection(' },
            { file: 'config/silence-guard.js', token: '.injection' }
        ],
        invalidation: '代际确认前不落地（迟到隔离）；禁用条目注入量为零，不计入实际注入成本',
        standalone: '旧版无此面 ⇒ not-produced；有面但本轮零块 ⇒ empty（与「没这面」处置相反）',
        upstreamFace: 'injectionReadout',
        declaredConsumer: 'readInjection',
        declaredFloor: 2
    },
    {
        id: 'lonsha.evidence',
        label: '九账证据工作台',
        owner: OWNER_LONSHA,
        /* [v3.97.0 · R3-B 包] 上游 B 包推送后，上游登记表的 evidenceWorkbench 行把
         *   producer_version 抬到 **v3.307.0**（M-O8 第二刀：九账行上恒定两列 scope/masked、
         *   `EVIDENCE_VERSION` 2 → 3、秘密正文收口）。本仓口径随之对齐到**完整契约形状**
         *   齐备的那一版（与上游 `checkpointCompare` 行「取完整契约形状齐备的那一版」同纪律）——
         *   否则 R4「producer_version 与 since 必须同口径」会常红，而红的原因在上游那份账里。 */
        since: '3.307.0',
        sinceSource: '上游 index.js 的 _evidenceWorkbench,searchEvidence（行上恒定两列 scope/masked 自 v3.307.0 起）；上游版本本仓未留档，证据在上游真源',
        fieldKeys: ['evidence'],
        contract: '快照顶层 `evidence`（ledgers / items / summary / selfConsistent / reason）',
        keySites: [
            { file: 'config/world-bridge.js', token: 'snapshot.evidence' }
        ],
        consumers: [
            { file: 'config/world-bridge.js', token: 'evidenceFaceOf(' },
            { file: 'apps/memory/global-search-engine.js', token: 'evidenceFaceOf(' },
            { file: 'apps/diagnose/diagnose-data.js', token: 'evidenceFaceOf(' }
        ],
        invalidation: '九账模块未就位 ⇒ 面在但 `reason: module-unavailable`（等升级）；账在位但零条目 ⇒ empty（等剧情推进）',
        standalone: '未装上游 ⇒ 缺席；装了但早于 3.214.0 ⇒ not-produced',
        upstreamFace: 'evidenceWorkbench',
        declaredConsumer: 'readLonshaEvidence',
        declaredFloor: 3
    },
    {
        id: 'lonsha.checkpointContent',
        label: '检查点内容级只读对照（F7 首阶段）',
        owner: OWNER_LONSHA,
        since: '3.252.0',
        sinceSource: '上游 snapshot-checkpoint.js 的 diffPayloadsDeep（v3.252.0 F7 首阶段）；上游版本本仓未留档，证据在上游真源',
        fieldKeys: [],
        contract: '引擎方法族：`compareBranchCheckpointsDeep(nameA, nameB, chatId, opts)`（键面读数 + 内容级 changes[]/sets[]/capped[]/cycles[]）与多行文案 `checkpointContentDiffLines`；模块面 `diffPayloadsDeep`',
        keySites: [
            { file: 'config/checkpoint-content-contract.js', token: 'compareBranchCheckpointsDeep' }
        ],
        consumers: [
            { file: 'config/checkpoint-content-contract.js', token: 'readLonshaCheckpointFace(' },
            { file: 'apps/diagnose/diagnose-data.js', token: 'readLonshaCheckpointFace(' }
        ],
        invalidation: '引擎方法不全 ⇒ `deep-unavailable`（仍给键面读数，**不是**「内容一样」）；任一侧缺失/载荷损坏 ⇒ `corrupt`；清单读不到（`items === null`）⇒ unusable（**不是**「还没有检查点」）',
        standalone: '未装上游 ⇒ engine-absent；装了但早于 3.252.0 ⇒ face-absent（检查点族未交付或只有键面读数）',
        upstreamFace: 'checkpointCompare',
        declaredConsumer: 'readLonshaCheckpointFace',
        declaredFloor: 1
    },
    {
        id: 'lonsha.eventPlatforms',
        label: '事件来源构成（跨平台）',
        owner: OWNER_LONSHA,
        since: '3.233.0',
        sinceSource: '本仓 config/world-bridge.js（v3.233）',
        fieldKeys: ['eventPlatforms'],
        contract: '快照顶层 `eventPlatforms`（ok / reason / platforms[] / segments / countedEvents / unlabeled）',
        keySites: [
            { file: 'config/world-bridge.js', token: 'snap.eventPlatforms' }
        ],
        consumers: [
            { file: 'config/world-bridge.js', token: 'readLonshaEventPlatforms(' },
            { file: 'apps/worldpulse/worldpulse-app.js', token: 'readLonshaEventPlatforms(' },
            { file: 'apps/timeweaver/timeweaver-view.js', token: '.eventPlatforms' }
        ],
        invalidation: '上游模块未就位 ⇒ 面在、`ok !== true`（读不出，与「还没有事件线」相反）',
        standalone: '未装上游 ⇒ 缺席；装了但早于 3.233.0 ⇒ not-produced',
        upstreamFace: 'eventPlatforms',
        declaredConsumer: 'readLonshaEventPlatforms',
        declaredFloor: 1
    },
    {
        id: 'lonsha.qaAnswer',
        label: '往事问答（带证据的自然语言记忆问答）',
        owner: OWNER_LONSHA,
        since: '3.322.0',
        sinceSource: '上游 lonsha-memory-plugin/index.js 的 askMemoryQuestion（v3.322.0 B 包 · M3-X1）；上游版本本仓未留档，证据在上游真源',
        fieldKeys: [],
        contract: '引擎方法族：`askMemoryQuestion(question, opts)` 返回**恒定 15 键**（version / question / intents / actor / answer[] / gaps[] / refs[] / plans[] / masked / truncated / resourced / total / knownActors / reason / writesNothing），每句 answer 带 kind / planId / text / ref / floor / ledger；`gaps[]` 具名「为什么答不出」（查不到 / 没跑 / 翻过头三者分列）；plans 只带读数**不带 rows**',
        keySites: [
            { file: 'apps/memory/memory-app.js', token: 'readMemoryQaAnswer' }
        ],
        consumers: [
            { file: 'apps/memory/memory-app.js', token: 'readMemoryQaAnswer(' },
            { file: 'apps/memory/memory-view.js', token: 'askPast' }
        ],
        invalidation: '内核缺席 ⇒ version=0 + reason + gaps 具名 module 类缺口（**不是**「没有答案」）；旧版无此出口 ⇒ face-absent（等升级）；问了但没命中 ⇒ answer 空 + gaps 具名（**真读数**，与「没这功能」相反）',
        standalone: '未装上游 ⇒ 缺席；装了但早于 3.322.0 ⇒ face-absent（问答族未交付）',
        upstreamFace: 'memoryQaAnswer',
        declaredConsumer: 'readMemoryQaAnswer',
        declaredFloor: 1
    },
    {
        id: 'lonsha.memoryTools',
        label: '记忆工具信封（五能力的统一只读面）',
        owner: OWNER_LONSHA,
        since: '3.305.0',
        sinceSource: '上游 lonsha-memory-plugin/memory-tools-api.js 的五能力出口（v3.305.0 M-X9 交付、**该面供给模块此后零改动**）；★ 本格此前写着 3.322.0 —— 那是**照抄上游失真账面**的连带:上游那张表该列自 v3.319.0 起被每一次抬版脚本机械改写,本仓跟着抄成了「抬版幻影」,而上游 v3.328.1 已把账面回真（判据改绑供给模块诞生版,不再绑宿主版）；上游版本本仓未留档，证据在上游真源',
        fieldKeys: [],
        contract: '引擎方法族：`memoryToolsDescribe()`（自述缺哪一格）+ `queryEvidence(spec, opts)` 恒定 14 键信封（kind / api / apiVersion / toolVersion / state / stateLabel / reason / source{module,symbol,path} / revision / revisionSource / scope / data / notes / writesNothing）+ 五态词表 ok|empty|unknown|unavailable|partial',
        keySites: [
            { file: 'apps/memory/memory-app.js', token: 'readMemoryToolsEnvelope' }
        ],
        /* [v3.97.0 · 自抓缺陷] 初版在这里登记了 `memory-view.js` 消费 `memoryToolsFace` ——
         *   真码里根本没有这一句（v3190 A3 当场点名：「声称在消费，真码里找不到」）。
         *   修法不是去视图里补一句无意义调用（计划明文禁止「为让接口有消费而加调用」），
         *   而是**把不真实的声明拿掉**：view 真消费的是问答出口与事实面自述（另有其条目登记）。 */
        consumers: [
            { file: 'apps/memory/memory-app.js', token: 'readMemoryToolsEnvelope(' }
        ],
        invalidation: '能力未注入 ⇒ module-absent / 注入但缺符号 ⇒ symbol-absent / 内核模块未加载 ⇒ 宿主降级信封 unavailable（data=null 且 notes 写明成因）；能力在场、真跑过、明确没有 ⇒ empty（data 为真读数）——**「没记录」不等于「他知道没有」**',
        standalone: '未装上游 ⇒ 缺席；装了但早于 3.319.0 ⇒ face-absent（工具信封族未抬版）',
        upstreamFace: 'memoryToolsEnvelope',
        declaredConsumer: 'readMemoryToolsEnvelope',
        declaredFloor: 1
    },
    {
        id: 'lonsha.phoneFact',
        label: '手机事实回执（确认 / 撤回 / 双向回执）',
        owner: OWNER_LONSHA,
        since: '3.314.0',
        sinceSource: '上游 lonsha-memory-plugin/phone-fact-bridge.js 的 receiptFor / lifecycleOf / handleFact / planEdit（v3.314.0 M-X6）；上游版本本仓未留档，证据在上游真源',
        fieldKeys: [],
        contract: '引擎方法族：`handleFact(fact, ctx)` / `handleBatch(facts, ctx)` / `planEdit(action, fact)` / `bridgeState(bridge)`；回执恒定九键 eventId / rootEventId / state / reason / decidable / accepted / nextStep / reasonText / version + 生命周期四态 accepted|rejected|pending|revoked + 十条穷尽回执理由 + 桥能力三态 absent|legacy|capable',
        keySites: [
            { file: 'apps/memory/memory-app.js', token: 'readPhoneFactReceipt' }
        ],
        consumers: [
            { file: 'apps/memory/memory-app.js', token: 'readPhoneFactReceipt(' },
            { file: 'apps/traveldesk/traveldesk-view.js', token: 'phoneFactReceiptFor' },
            { file: 'apps/calendar/calendar-app.js', token: 'phoneFactReceiptFor' }
        ],
        invalidation: '桥缺席 ⇒ state=absent（整条分支不进入，**非**「没事实」）；准入内核缺格 ⇒ decidable:false + admission-unavailable（**不假装 pending、不假装 rejected**）；空批 ⇒ rows 为空数组（不是「有但全被挡」）——★ pending（等用户确认）与 rejected（明确未进账）**刻意不同形**',
        standalone: '未装上游 ⇒ 缺席；装了但早于 3.314.0 ⇒ face-absent（事实桥族未交付）',
        upstreamFace: 'phoneFactReceipt',
        declaredConsumer: 'readPhoneFactReceipt',
        declaredFloor: 1
    },
    {
        id: 'lonsha.entityMapping',
        label: '实体映射（与主聊天共用的同一份实体注册表）',
        owner: OWNER_LONSHA,
        since: '3.317.0',
        sinceSource: '上游 lonsha-memory-plugin/index.js 的 resolveEntityAt / entityCandidatesFor（v3.317.0 M3-O3）；上游版本本仓未留档，证据在上游真源与 open_face_registry.tsv 的 face=entityMapping 行',
        fieldKeys: [],
        contract: '引擎方法族：`resolveEntityAt(kind, value, ctx, carry)` 返回 {ok, reason, entity{id,kind,name}}（未命中 ok:false + 具名 reason，含 registry-unavailable）；`entityCandidatesFor(kind, value, ctx)` 返回**候选数组**（每项 id|name|via|matchedAlias|blockedBy），**多条不并成一条**',
        keySites: [
            { file: 'config/entity-candidates-contract.js', token: 'readEntityCandidates' }
        ],
        consumers: [
            { file: 'apps/wechat/wechat-data.js', token: 'readEntityCandidates(' }
        ],
        invalidation: '插件不在场 ⇒ engine-absent（等装插件）；插件在、本版无此出口 ⇒ face-absent（等升级）；出口在但抛错 / 注册表未建 ⇒ unusable（registry-unavailable，本机读不出）；注册表在场、真查过、确实无候选 ⇒ empty（**真读数**）——四态处置相反，压平即把「还没装插件」显示成「查无此人」',
        standalone: '未装上游 ⇒ 缺席；装了但早于 3.317.0 ⇒ face-absent（实体读面未交付）',
        upstreamFace: 'entityMapping',
        declaredConsumer: 'readEntityCandidates',
        declaredFloor: 1
    },
    {
        id: 'lonsha.relationAlbum',
        label: '人物关系变化史(回忆册的转折面)',
        owner: OWNER_LONSHA,
        since: '3.323.0',
        sinceSource: '上游 lonsha-memory-plugin/index.js 的 relationHistory / relationHistoryAt(v3.323.0 M3-X2)与内核 relation-history.js;证据在上游真源与 open_face_registry.tsv 的 face=relationHistory 行',
        fieldKeys: [],
        contract: '引擎方法族:`relationHistory(opts)` 返回 kind=relation_history 的读数(pairs / counts / truncated / turnsTruncated / byName / malformedInput / writesNothing / degraded);`relationHistoryAt(floor)` 给指定时点快照(时点读不到如实标 floor=null,不猜 0 楼);缺席面给恒定键面且 version=0(「不在场」与「一个都没有」不同形)',
        keySites: [
            { file: 'config/relation-album-contract.js', token: 'engine.relationHistory' }
        ],
        consumers: [
            { file: 'config/relation-album-contract.js', token: 'readRelationHistory(' }        ],
        invalidation: '插件不在场 ⇒ engine-absent(等装插件);插件在、本版无此出口 ⇒ face-absent(等升级);出口在但调用抛错 / 面形态不对 ⇒ unusable(本机读不出);读到了、真的没有转折 ⇒ empty(真读数)——四态处置相反,压平即把「还没装插件」显示成「你们没什么可回忆的」',
        standalone: '未装上游 ⇒ 回忆册照常出册(事件面是本仓自己的),但转折面如实标不在场——不拿一个空转折列表冒充「你们关系没变过」',
        upstreamFace: 'relationHistory',
        declaredConsumer: 'readRelationHistory',
        declaredFloor: 1
    },
    {
        id: 'lonsha.perspectiveCard',
        label: '角色可知范围(视角卡:亲历 / 听说 / 误信 / 明确不知)',
        owner: OWNER_LONSHA,
        since: '3.323.0',
        sinceSource: '上游 lonsha-memory-plugin/index.js 的 perspectiveCard 出口(v3.323.0 M3-X4)与 perspective-card.js;证据在上游真源与 open_face_registry.tsv 的 face=perspectiveCard 行',
        fieldKeys: [],
        contract: '引擎方法 / 模块出口两路:`engine.perspectiveCard(opts)` 或 `LonShaPerspectiveCard.build(traces, opts)`,返回 kind=perspective_card 的读数(lived / heard / misled / unknown 四格 + unrecorded 不可用格 + version / truncated / malformedInput);上游契约里**明写一条禁令**「不得把降级读成确实不知道」,故缺席面给恒定键面且 version=0(「不在场」与「这个角色什么都不知道」不同形)',
        keySites: [
            { file: 'config/perspective-card-contract.js', token: 'engine.perspectiveCard' }
        ],
        consumers: [
            { file: 'apps/diagnose/diagnose-data.js', token: 'readPerspectiveFace(' }
        ],
        invalidation: '插件不在场 / 模块未加载 ⇒ engine-absent(等装插件);插件在、本版无此面 ⇒ face-absent(等升级到 v3.323.0+);出口在但调用抛错 / 面形态不对 ⇒ unusable(本机读不出,不是这个角色什么都不知道);真跑过、该角色无轨迹 ⇒ empty(**真读数**);读到四格 ⇒ ok——五态处置相反,压平即把「还没装插件」显示成「他确实不知道」',
        standalone: '未装上游 ⇒ 诊断面照常出卡,但视角面如实标不在场;**不退回本地猜一份可知范围**——上游不在就不给四格,也绝不把 `misled`(曾误信)或 `unrecorded`(本模块无判定)读成世界真相或「不知道」',
        upstreamFace: 'perspectiveCard',
        declaredConsumer: 'readPerspectiveFace',
        declaredFloor: 1
    },
    {
        id: 'lonsha.testimonyBoard',
        label: '证词对照（同一事件的多方说法与争议未裁决三档）',
        owner: OWNER_LONSHA,
        since: '3.343.0',
        sinceSource: '上游 lonsha-memory-plugin/testimony-board.js（v3.343.0 M4-X5）与 index.js 的 testimonyBoard / testimonyRevoke 出口；证据在上游真源与 open_face_registry.tsv 的 face=testimonyBoard 行（本版三处同批补登记）',
        fieldKeys: [],
        contract: '引擎方法 / 模块出口两路：`engine.testimonyBoard(opts)` 或 `LonShaTestimonyBoard.build(traces, opts)`，返回 kind=testimony_board 的读数（boards[] / counts / version / malformedInput / degraded）；每板带 eventKey / state / testimonies[] / disputes{items[],kinds{ambiguous,below-threshold,transmittal-only}} / identities{surface,revealed,homonym,unspecified,split}。★ 面状态四态 supported|contested|undecided|withdrawn 与未裁决三档**必须分列**（合成一格就分不出「为什么暂不能下结论」）；★ 撤回走 `engine.testimonyRevoke(dropped, opts)` 或 `LonShaTestimonyBoard.revokeEvidence(read, dropped)`，撤到无独立支持 ⇒ undecided / withdrawn，**不退化成 contested**（不静默留一个没人能举证的争议）',
        keySites: [
            { file: 'config/perspective-contrast-contract.js', token: 'eng.testimonyBoard' }
        ],
        consumers: [
            { file: 'apps/chars/chars-perspective.js', token: 'readTestimonyBoard(' }
        ],
        invalidation: '插件不在场 / 模块未加载 ⇒ engine-absent（等装插件）；插件在、本版无此面 ⇒ face-absent（等升级到 v3.343.0+）；出口在但调用抛错 / degraded / malformedInput ⇒ unusable（本机读不出，**不是**「他们都没说法」）；真跑过、没有同事件的多方说法 ⇒ empty（**真读数**）——四态处置相反，压平即把「还没装插件」显示成「他们都没说法」',
        standalone: '未装上游 ⇒ 群像页的证词面对照区如实标不在场，**不退回本地猜一份对照**；四态与未裁决三档原样端出，**不以一票多数裁真相**（谁也不投谁的票）',
        upstreamFace: 'testimonyBoard',
        declaredConsumer: 'readTestimonyBoard',
        declaredFloor: 1
    },
    {
        id: 'lonsha.causalChain',
        label: '因果线索与未完事项（未结约定 / 伏笔 / 已收口 / 仅推测）',
        owner: OWNER_LONSHA,
        since: '3.323.0',
        sinceSource: '上游 lonsha-memory-plugin/causal-chain.js（v3.323.0 M3-X3）与 index.js 的 causalChainGraph / causalChainTodos / causalChainTrace / causalChainProposals 四出口；证据在上游真源与 open_face_registry.tsv 的 face=causalChain 行（该行上游早已登记，本版补的是**下游两处**：本登记行与本门 J20 标签）',
        fieldKeys: [],
        contract: '引擎方法 / 模块出口两路：`engine.causalChainGraph(opts)` 或 `LonShaCausalChain.build(sources, opts)`，返回 kind=causal_chain 的读数（nodes[] / edges[] / speculative[] / unresolved[] / resolved[] / cancelled[] / broken[] / counts / truncated / malformedInput / writesNothing / degraded）。★ **推测边与已确认边是两个数组**（结构上不可混读，并入 edges 即等于把「猜的」当「有据的」）；★ 四收口 resolved|cancelled|broken|unresolved **分列**（合成一格就分不出「不用再提」与「还没做」）；★ 追溯走 `engine.causalChainTrace(id, opts)`，**只走已确认边**，图外 id ⇒ known=false + reason=not-in-graph（**不是**「追到了头」）；★ 候选边走 `engine.causalChainProposals(opts)`，恒为推测、手机端不替用户确认',
        keySites: [
            { file: 'config/causal-board-contract.js', token: 'eng.causalChainGraph' }
        ],
        consumers: [
            { file: 'apps/plotline/plotline-board.js', token: 'readCausalBoard(' }
        ],
        invalidation: '插件不在场 / 模块未加载 ⇒ engine-absent（等装插件）；插件在、本版无此面（上游降级面 version=0）⇒ face-absent（等升级到 v3.323.0+）；出口在但调用抛错 / malformedInput / degraded ⇒ unusable（本机读不出，**不是**「这条线没有前因」）；没给要追的起点 ⇒ no-subject（**不是**「追到头了」，更不许默认挑一条线）；真跑过、图里零节点 ⇒ empty（**真读数**）——五态处置相反，压平即把「还没装插件」显示成「故事里没有任何线索」',
        standalone: '未装上游 ⇒ 剧情线页照常出卡（大纲/承诺/支线是本仓自己的），但因果板如实标不在场，**不退回本地猜一份因果**；四收口与推测边原样端出，**不替用户标已解决**（零写面，writesNothing 恒 true）——「提醒过」不等于「履约」，确认与收口动作归上游 owner',
        upstreamFace: 'causalChain',
        declaredConsumer: 'readCausalBoard',
        declaredFloor: 1
    },
    {
        id: 'lonsha.branchCanon',
        label: '支线结局接续（选哪条成为正史 / 其余支线留痕 / 撤销只撤本次接续）',
        owner: OWNER_LONSHA,
        since: '3.342.0',
        sinceSource: '上游 lonsha-memory-plugin/branch-canon.js（v3.342.0 M4-X3）与 index.js 的 branchCanonState / branchCanonPlan / branchCanonPreview / branchCanonRevoke / storyCanonAdoptPlan / storyCanonAdoption / storyCanonRevokeGuard / storyCanonAdoptConfirm 出口；证据在上游真源与 open_face_registry.tsv 的 face=branchCanon 行（该行上游在 v3.342.0 漏登，本版三处同批补齐）',
        fieldKeys: [],
        contract: '引擎方法 / 模块出口两路：`engine.branchCanonState(opts)` 或 `LonShaBranchCanon.build(sources, opts)`，返回 kind=branch_canon 的读数（rows[] / counts / version / malformedInput / writesNothing / degraded）；每冲突位带 key / verdict / branches[] / titles[] / terminalCount / decision。★ 选择计划走 `engine.branchCanonPlan(opts)`，chosen|coexisted|excluded|pending **四档分列**、provenance 覆盖每一条结局（未被选中的历史必须留痕）；★ 交接预览走 `engine.branchCanonPreview(opts)`，只读不给凭据；★ 落卷面走 `engine.storyCanonAdoptPlan(opts)` / `storyCanonAdoption(opts)`，verdict 三态 ready|blocked|empty **不许压平**（blocked 与 empty 处置相反：一个回去选、一个去补结局条文），unmapped 缺格三因 no-face|no-owner|no-key 分列；★ 撤销走 `engine.branchCanonRevoke(opts)` 或 `storyCanonRevokeGuard(opts)`，revocable|keptForeign|keptManual|keptLater 四表分列、deletesManual 与 branchWrites 写成读数（**撤销只撤本次接续，原分支原文不动**）；★ 唯一有写动作的是 `storyCanonAdoptConfirm(opts)`，归上游 owner',
        keySites: [
            { file: 'config/branch-canon-contract.js', token: 'eng.branchCanonState' }
        ],
        consumers: [
            { file: 'apps/archive/archive-canon.js', token: 'readBranchCanonState(' }
        ],
        invalidation: '插件不在场 / 模块未加载 ⇒ engine-absent（等装插件）；插件在、本版无此面（上游降级面 version=0）⇒ face-absent（等升级到 v3.342.0+）；出口在但调用抛错 / judged:false 装配未到 / degraded / malformedInput ⇒ unusable（本机读不出，**不是**「两条结局没有冲突」）；没给要落卷的范围 ⇒ no-scope（**不是**「这次接续没事可做」）；真跑过、一个冲突位都没有 ⇒ empty（**真读数**）——五态处置相反，压平即把「还没装插件」显示成「这批结局没有冲突」',
        standalone: '未装上游 ⇒ 存档台照常出卡（包页/面貌/重置/台账是本仓自己的），但第五页签「支线结局」如实标不在场，**不退回本地猜一份选择**；三态与四表原样端出，**不替用户拍板哪条故事更好**（零写盘，writesNothing 恒 true）——分卷写入与撤销归上游 owner，手机端只把上游给的凭据经 storyCanonAdoptConfirm 原样转交',
        upstreamFace: 'branchCanon',
        declaredConsumer: 'readBranchCanonState',
        declaredFloor: 1
    },
    {
        id: 'lonsha.knowledge',
        label: '知情网络（谁不知道某件事）',
        owner: OWNER_LONSHA,
        since: '3.219.0',
        sinceSource: '本仓 config/knowledge-contract.js（v3.219）',
        fieldKeys: ['worldProg'],
        contract: '快照 `worldProg.knowledge`（known / unaware 两类记录，按角色分桶）',
        keySites: [
            { file: 'config/knowledge-contract.js', token: 'p.worldProg' }
        ],
        consumers: [
            { file: 'config/knowledge-contract.js', token: 'knowledgeFace(' },
            { file: 'apps/plotline/plotline-data.js', token: 'knowledgeFace(' },
            { file: 'apps/diagnose/diagnose-data.js', token: 'knowledgeBoundary(' },
            { file: 'config/context-compose.js', token: "'worldProg'" }
        ],
        invalidation: '账里零 `unaware` 记录 ⇒ 「谁不知道」在数据上**无从回答**（`silentCapable === false`，不是「没人不知道」）',
        standalone: '未装上游 ⇒ 缺席；面在但 knowledge 缺 ⇒ 本仓如实报「这版没这面」'
    },
    {
        id: 'lonsha.scene',
        label: '场所三面（层级树 / 到访史 / 本楼场景）',
        owner: OWNER_LONSHA,
        since: '3.181.0',
        sinceSource: '本仓 apps/place/place-data.js（v3.181）',
        fieldKeys: ['scene'],
        contract: '快照顶层 `scene`（current / presence[] / coverage / observationNotes）',
        keySites: [
            { file: 'apps/place/place-data.js', token: 'snap.scene' }
        ],
        consumers: [
            { file: 'apps/place/place-data.js', token: '.scene' },
            { file: 'apps/diagnose/diagnose-data.js', token: "'scene'" }
        ],
        invalidation: '取值域为 `number | null`（O-1）：`presence[].atFloor` 等格「没给」与「给了 0」是两件事',
        standalone: '未装上游 ⇒ 缺席；装了但早于 3.220.0 ⇒ not-produced'
    },
    {
        id: 'lonsha.clock',
        label: '剧情时钟（对方账本侧）',
        owner: OWNER_LONSHA,
        since: '3.174.0',
        sinceSource: '本仓 config/world-bridge.js（v3.174）',
        fieldKeys: ['clock'],
        contract: '快照顶层 `clock`（date / 可含自由标签形态）',
        keySites: [
            { file: 'config/story-clock.js', token: 'readPushField(p.snapshot, \'clock\')' }
        ],
        consumers: [
            { file: 'config/story-clock.js', token: "'clock'" },
            { file: 'apps/diagnose/diagnose-data.js', token: "'clock'" }
        ],
        invalidation: '对方未记录时间 ⇒ `lonsha-empty`（等它即可），与「记了但读不出」（两套历法，`unparsable`）处置相反',
        standalone: '未装上游 ⇒ 缺席；此时跨 App 时间面退回「本机日历 + 世界钟」两源'
    },
    {
        id: 'lonsha.outline',
        label: '大纲（当前阶段 / 节点 / 回合）',
        owner: OWNER_LONSHA,
        since: '3.174.0',
        sinceSource: '本仓 config/world-bridge.js（v3.174）',
        fieldKeys: ['outline'],
        contract: '快照顶层 `outline`（stage 结构）',
        keySites: [
            { file: 'apps/plotline/plotline-data.js', token: 'snap.outline' }
        ],
        consumers: [
            { file: 'apps/plotline/plotline-data.js', token: "'outline'" }
        ],
        invalidation: '与 `worldProg` 同属「剧情面」：两者都缺才是面缺席',
        standalone: '未装上游 ⇒ 剧情线 App 报缺席并给出归因'
    },
    {
        id: 'lonsha.worldProg',
        label: '世界推进（承诺 / 支线 / 认知）',
        owner: OWNER_LONSHA,
        since: '3.174.0',
        sinceSource: '本仓 config/world-bridge.js（v3.174）',
        fieldKeys: ['worldProg'],
        contract: '快照顶层 `worldProg`（承诺表 / 支线 / 认知边界）—— 上游在快照构造里把这三合一',
        /* 【措辞纪律 · 本行触发过一条门禁，留档】
         *   初版本行原文是把上游那三个字段名**逐个用英文列出来**。
         *   结果 `tests/audit/schedule_conflict_probe.cjs` 把**承诺到期面**的消费点读数从 22 抬到 23、
         *   消费文件从 4 抬到 5（多出来的那一处就是本行），v325/v326 的 A2 与 v325 的 D3 因此转红。
         *   探针的判据是**按子串计行**（它拿几个英文 token 逐个 `indexOf`），分不清
         *   「真的在校验承诺期限」与「只是把上游字段名列在描述里」。这正是本仓那条口径的实况：
         *   **注释与描述里的提及不算消费**，而粗粒度扫描器做不到这一点。
         *   处置：改**自己的描述措辞**（改用中文语义）—— 而不是改探针的 token 表、也不是改基线读数：
         *   那条读数要守的是「有没有人真的消费承诺期限」，本行一个字节都不消费它。
         *   ★ 二代踩坑（本注释自身）：留档时我又在**这段注释里**写了一遍那个英文 token，
         *     读数当场从 23 涨到 24（同一个文件被同一个 token 命中第二行）。
         *     结论：这类读数的正确写法是**一个 token 字面量都不要留下**，包括解释它的注释。 */
        keySites: [
            { file: 'apps/plotline/plotline-data.js', token: 'snap.worldProg' }
        ],
        consumers: [
            { file: 'apps/plotline/plotline-data.js', token: "'worldProg'" },
            { file: 'config/context-compose.js', token: "'worldProg'" }
        ],
        invalidation: '与 `outline` 并列成「剧情面」；支线为空是 empty，不是缺席',
        standalone: '未装上游 ⇒ 缺席'
    },
    {
        id: 'lonsha.worldLedgerRead',
        label: '对推演侧世界的读数（含未外供缺口）',
        owner: OWNER_LONSHA,
        since: '3.176.0',
        sinceSource: '上游 lonsha-memory-plugin/index.js git log（v3.176.0 世界账本读者面）',
        fieldKeys: ['worldLedgerRead'],
        contract: '快照顶层 `worldLedgerRead`（GameClock 侧读到的世界账）',
        keySites: [
            { file: 'apps/ledger/ledger-data.js', token: 'faceFieldState(snapshot, [\'worldLedgerRead\'])' }
        ],
        consumers: [
            { file: 'apps/ledger/ledger-data.js', token: "'worldLedgerRead'" }
        ],
        invalidation: '上游明确为空 ⇒ `upstream-empty`（真读数）；读不到 ⇒ 另一态',
        standalone: '未装上游 ⇒ 账本 App 报缺席'
    },
    {
        id: 'lonsha.characters',
        label: '角色状态表',
        owner: OWNER_LONSHA,
        since: '3.88.0',
        sinceSource: '本仓 CONTEXT.md（v3.88 起快照含角色状态表）',
        fieldKeys: ['characters'],
        contract: '快照 `characters`（字段名就是 `characters`，**不是** `chars`）',
        keySites: [
            { file: 'apps/chars/chars-data.js', token: 'faceFieldState(snap, [\'characters\'])' }
        ],
        consumers: [
            { file: 'apps/chars/chars-data.js', token: "'characters'" }
        ],
        invalidation: 'v299 真缺陷留档：登记面初版写 `chars`，真消费点是 `characters` ⇒ 展示面自己给出错读数',
        standalone: '未装上游 ⇒ 群像 App 报缺席'
    },
    {
        id: 'lonsha.moneyLedger',
        label: '金钱账',
        owner: OWNER_LONSHA,
        since: '3.88.0',
        sinceSource: '本仓 CONTEXT.md（v3.88 起快照含金钱账）',
        fieldKeys: ['moneyLedger'],
        contract: '快照 `moneyLedger`',
        keySites: [
            { file: 'apps/wallet/wallet-data.js', token: 'faceFieldState(snap, [\'moneyLedger\'])' }
        ],
        consumers: [
            { file: 'apps/wallet/wallet-data.js', token: "'moneyLedger'" }
        ],
        invalidation: '上游声明空 ⇒ 钱包报「空」，不报「读不到」',
        standalone: '未装上游 ⇒ 钱包退回本机账'
    },
    {
        id: 'lonsha.profile',
        label: '主角档案（protagonist + lifeDetails）',
        owner: OWNER_LONSHA,
        since: '3.88.0',
        sinceSource: '本仓 CONTEXT.md（v3.88 起快照含主角档案）',
        fieldKeys: ['protagonist', 'lifeDetails'],
        contract: '快照 `protagonist` 与 `lifeDetails`（合成一个「档案面」）',
        keySites: [
            { file: 'apps/profile/profile-data.js', token: 'snap.protagonist' },
            { file: 'apps/profile/profile-data.js', token: 'snap.lifeDetails' }
        ],
        consumers: [
            { file: 'apps/profile/profile-data.js', token: "'protagonist'" },
            { file: 'apps/profile/profile-data.js', token: "'lifeDetails'" }
        ],
        invalidation: '两者**任缺其一**都仍是同一面：字段级三态按面合成（present 优先）',
        standalone: '未装上游 ⇒ 档案 App 报缺席'
    },
    {
        id: 'lonsha.recallAudit',
        label: '召回自检摘要',
        owner: OWNER_LONSHA,
        since: '3.88.0',
        sinceSource: '本仓 CONTEXT.md（v3.88 起快照含召回自检）',
        fieldKeys: ['recallAudit'],
        contract: '快照 `recallAudit`（本轮召回了什么）',
        keySites: [
            { file: 'apps/timeweaver/timeweaver-collector.js', token: 'snap.recallAudit' }
        ],
        consumers: [
            { file: 'apps/timeweaver/timeweaver-collector.js', token: '.recallAudit' }
        ],
        invalidation: '与注入读数分工：本面说「召回了什么」，注入面说「最终送进上下文的是什么」',
        standalone: '未装上游 ⇒ 织光机报缺席'
    },
    {
        id: 'worldaxis.clock',
        label: '世界钟（决策时间）',
        owner: OWNER_WORLDAXIS,
        since: null,
        sinceSource: '不适用：对方桥不自述扩展版本，本面不立版本判据',
        fieldKeys: [],
        contract: '桥快照 `clock`（拉取型：`WorldAxis.bridge.refresh()` 取，`stat()` 记账）',
        keySites: [
            { file: 'config/world-bridge.js', token: 'snapshot.worldClock' }
        ],
        consumers: [
            { file: 'config/world-bridge.js', token: 'readWorldClock(' },
            { file: 'config/story-clock.js', token: "'worldaxis'" }
        ],
        invalidation: '桥默认**休眠**（`enabled === false` ⇒ 闸门态）；快照被作废后第一次拉取会重建',
        standalone: '未装 WorldAxis ⇒ 跨 App 时间面退回「插件日期 + 本机日历」两源，并在总述里点名'
    },
    {
        id: 'worldaxis.currents',
        label: '暗流 / 舆情外供',
        owner: OWNER_WORLDAXIS,
        since: null,
        sinceSource: '不适用：对方桥不自述扩展版本，本面不立版本判据',
        fieldKeys: [],
        contract: '桥快照 `currents[]`（仅显式 `public` / `public_trace` 进外供）+ `notMarked` 计数',
        keySites: [
            { file: 'apps/worldpulse/worldpulse-engine.js', token: 'snapshot.currents' }
        ],
        consumers: [
            { file: 'apps/worldpulse/worldpulse-engine.js', token: 'snapshot.currents' }
        ],
        invalidation: '未标记可见性的暗流**不进外供**但计数如实报出（「一条都没进」与「进的都是不该进的」必须可分）',
        standalone: '未装 WorldAxis ⇒ 世界脉搏退回本机队列（本仓已有归因面，不假装有世界状态）'
    }
]);

/* ── 版本比较（**唯一实现**，不导出） ──
 * 只认十进制段：`3.255.0-beta` ⇒ [3,255,0]，遇到第一个非纯数字段即**截断**。
 *   为什么是截断、而不是「带非数字就整串读不出」：预发布后缀（`3.212.0-beta.3`）与正式版
 *   `3.212.0` 是**同一个十进制版本**。把后缀当成第 5 个版本段会得出
 *   `[3,212,0,0,3] > [3,212,0]` ⇒ 对装了 beta 的人说「你的版太低」，即指使去升级一个已是新版的插件
 *   —— 这正是本面要治的那类错读数（本面是唯一会指使读者「去升级」的地方，所以它的版本比较
 *   宁可少判，也不许错判）。
 *   为什么不是「跳过非数字段继续往后取」：那会把 `3.212.0-beta.3` 读成 `[3,212,0,3]`，同样错。
 * 任一侧读不出（空串 / 首段就不是数字）即返回 null —— **不猜**谁更新
 *   （本仓纪律：拿一个读不到的版本去比，比出来的「旧版」是个编造的结论）。 */
function versionParts(v) {
    const s = String(v == null ? '' : v).trim();
    if (!s) return null;
    const out = [];
    for (const seg of s.split('.')) {
        if (!/^\d+$/.test(seg)) break;          /* 预发布后缀（`-beta.3`）⇒ 到此截断 */
        out.push(parseInt(seg, 10));
    }
    return out.length ? out : null;
}
function cmpVersion(a, b) {
    const pa = versionParts(a);
    const pb = versionParts(b);
    if (!pa || !pb) return null;
    const n = Math.max(pa.length, pb.length);
    for (let i = 0; i < n; i += 1) {
        const x = pa[i] || 0;
        const y = pb[i] || 0;
        if (x !== y) return x < y ? -1 : 1;
    }
    return 0;
}

/** 缺表时的恒定形（读者不必判 undefined；与全仓「键面恒定」同规格） */
function blankRow() {
    return {
        id: '', label: '', owner: '', since: null, sinceSource: '', fieldKeys: [], keySites: [],
        contract: '', consumers: [], invalidation: '', standalone: '',
        state: STATE.UNVERIFIABLE, stateText: STATE_TEXT[STATE.UNVERIFIABLE],
        reason: 'feature-missing', producerVersion: null, comparable: null
    };
}
function toRow(feature, verdict) {
    if (!feature || typeof feature !== 'object') return blankRow();
    const v = (verdict && typeof verdict === 'object') ? verdict : {};
    const state = STATE_TEXT[v.state] ? String(v.state) : STATE.UNVERIFIABLE;
    return {
        id: String(feature.id || ''),
        label: String(feature.label || ''),
        owner: String(feature.owner || ''),
        since: feature.since == null ? null : String(feature.since),
        sinceSource: String(feature.sinceSource || ''),
        fieldKeys: Array.isArray(feature.fieldKeys) ? feature.fieldKeys.slice() : [],
        keySites: Array.isArray(feature.keySites) ? feature.keySites.map((s) => ({
            file: String((s && s.file) || ''), token: String((s && s.token) || '')
        })) : [],
        contract: String(feature.contract || ''),
        consumers: Array.isArray(feature.consumers) ? feature.consumers.map((c) => ({
            file: String((c && c.file) || ''), token: String((c && c.token) || '')
        })) : [],
        invalidation: String(feature.invalidation || ''),
        standalone: String(feature.standalone || ''),
        state,
        stateText: STATE_TEXT[state],
        reason: String(v.reason || ''),
        producerVersion: v.producerVersion == null ? null : String(v.producerVersion),
        comparable: (v.comparable === null || v.comparable === undefined) ? null : v.comparable
    };
}

/**
 * lonsha 侧判定：**桥在场 → 闸门 → 版本 → 字段三态** 的顺序不可换。
 *   顺序本身就是判据：先问「桥在不在」（不在就无从谈版本），再问「这版产不产出这一面」，
 *   最后才用版本解释「产出的是不是旧形状」。反过来的写法（先比版本）会把「桥缺席」
 *   报成「版本偏低」—— 那是本仓治过的那类编造归因。
 */
function judgeLonsha(feature, side) {
    const s = (side && typeof side === 'object') ? side : {};
    const producerVersion = (typeof s.producerVersion === 'string' && s.producerVersion) ? s.producerVersion : null;
    const order = cmpVersion(producerVersion, feature.since);
    const outdated = (order === null) ? null : (order < 0);
    if (s.mounted !== true) {
        return { state: STATE.ABSENT, reason: 'bridge-absent', producerVersion, comparable: order };
    }
    const keys = Array.isArray(feature.fieldKeys) ? feature.fieldKeys : [];
    if (!keys.length) {
        /* [v3.20.2] 无字段键的面（如检查点内容级对照：它是**引擎方法族**，不是快照顶层字段）。
         *   此前一律判 `unverifiable / no-field-keys` —— 那让「全绿探针」永远凑不出「全部就绪」，
         *   而 C2 那条判据（「没有缺席项时不得写缺席」）要的正是**真造出一个没有缺席的世界**。
         *   如实修法：无字段键的面**只按版本判**（since 是生产者版本，见 cmpVersion 语义）——
         *     读不到生产者版本 ⇒ 不猜（unverifiable，nothing to compare）；
         *     版本低于 since      ⇒ outdated（这一面那时还没产出）；
         *     版本达标（或无版本账）⇒ ok（本面**没有**可判字段的格，故不存在「空读数」这一态）。
         *   刻意**不**改任何既有面的判定路径（有字段键的一律走下面原逻辑，逐字未动）。 */
        if (order === null) {
            return { state: STATE.UNVERIFIABLE, reason: 'no-field-keys-no-version', producerVersion, comparable: order };
        }
        return outdated === true
            ? { state: STATE.OUTDATED, reason: 'producer-behind:' + String(feature.since), producerVersion, comparable: order }
            : { state: STATE.OK, reason: 'ok', producerVersion, comparable: order };
    }
    const reads = keys.map((k) => {
        const r = (s.fields && s.fields[k]) ? s.fields[k] : null;
        return (r && typeof r === 'object') ? r : { present: false, kind: null, reason: 'no-snapshot' };
    });
    const reasons = reads.map((r) => String(r.reason || ''));
    if (reasons.includes('no-snapshot')) {
        return { state: STATE.ABSENT, reason: 'no-snapshot', producerVersion, comparable: order };
    }
    if (reasons.includes('value')) {
        return outdated === true
            ? { state: STATE.OUTDATED, reason: 'producer-behind:' + String(feature.since), producerVersion, comparable: order }
            : { state: STATE.OK, reason: 'ok', producerVersion, comparable: order };
    }
    if (reasons.every((r) => r === 'absent')) {
        return outdated === true
            ? { state: STATE.OUTDATED, reason: 'producer-behind:' + String(feature.since), producerVersion, comparable: order }
            : { state: STATE.NOT_PRODUCED, reason: 'face-absent', producerVersion, comparable: order };
    }
    if (reasons.every((r) => r === 'declared-null')) {
        return outdated === true
            ? { state: STATE.OUTDATED, reason: 'producer-behind:' + String(feature.since), producerVersion, comparable: order }
            : { state: STATE.EMPTY, reason: 'declared-empty', producerVersion, comparable: order };
    }
    /* 旧版桥无字段三态自述、且值为空 ⇒ 「源里没这项」与「有这项、值是空」**无从分辨**。
     *   即使生产者版本已满足 since，那也不是我们替它下结论的理由（自述缺失是对方的事），
     *   故如实报 unverifiable，并把版本读数一并带出让读者自己判断。 */
    return { state: STATE.UNVERIFIABLE, reason: 'legacy-no-fieldtypes', producerVersion, comparable: order };
}

/**
 * WorldAxis 侧判定：无版本判据（对方不自述扩展版本），只判在场 / 闸门 / 发布与拉取记账。
 *   `read-failed` 刻意**不**归闸门：那是「对方说它有、实际拉不到」，
 *   与「闸门关着」（用户去开）处置不同 —— 压成一态就是错读数。
 */
function judgeWorldaxis(feature, side) {
    const s = (side && typeof side === 'object') ? side : {};
    if (s.mounted !== true) {
        return { state: STATE.ABSENT, reason: 'bridge-absent', producerVersion: null, comparable: null };
    }
    if (s.gated === true) {
        return { state: STATE.GATED, reason: String(s.gatedReason || 'gated'), producerVersion: null, comparable: null };
    }
    if (s.hasSnapshot !== true) {
        return { state: STATE.NOT_PRODUCED, reason: 'no-snapshot-published', producerVersion: null, comparable: null };
    }
    if (s.readOk === true) {
        return { state: STATE.OK, reason: 'ok', producerVersion: null, comparable: null };
    }
    if (s.readOk === false) {
        return { state: STATE.UNVERIFIABLE, reason: 'read-failed:' + String(s.readReason || 'unknown'), producerVersion: null, comparable: null };
    }
    return { state: STATE.UNVERIFIABLE, reason: 'read-not-attempted', producerVersion: null, comparable: null };
}

/**
 * 单条判定（展示/判据两用；纯函数、不抛、键面恒定）。
 * @param {object} feature CROSSREPO_FEATURES 里的一条
 * @param {{lonsha?:object, worldaxis?:object}} [probe] 调用方**已取好**的探针
 */
export function featureState(feature, probe) {
    try {
        if (!feature || typeof feature !== 'object') return blankRow();
        const p = (probe && typeof probe === 'object') ? probe : {};
        const owner = String(feature.owner || '');
        if (owner === OWNER_LONSHA) return toRow(feature, judgeLonsha(feature, p.lonsha));
        if (owner === OWNER_WORLDAXIS) return toRow(feature, judgeWorldaxis(feature, p.worldaxis));
        return toRow(feature, { state: STATE.UNVERIFIABLE, reason: 'owner-unknown', producerVersion: null, comparable: null });
    } catch (_e) {
        return blankRow();
    }
}

/** 按状态分组计数（消费方不自己数 —— 自己数就会与行数据漂移） */
function countByState(rows) {
    const out = {};
    for (const key of Object.values(STATE)) out[key] = 0;
    for (const r of rows) {
        if (out[r.state] === undefined) out[r.state] = 0;
        out[r.state] += 1;
    }
    return out;
}

/**
 * 一次算齐全部登记项（诊断中心/测试的唯一取数口）。
 * @param {{lonsha?:object, worldaxis?:object}} [probe]
 * @returns {{total:number, rows:Array, counts:object, ok:number, attention:Array}}
 *   `attention` —— 非 ok 的行（**按登记顺序**，不重排：本仓跳转页/列表一律按原始顺序）
 */
export function registryFace(probe) {
    let rows;
    try {
        rows = CROSSREPO_FEATURES.map((f) => featureState(f, probe));
    } catch (_e) {
        rows = [blankRow()];
    }
    const counts = countByState(rows);
    const attention = rows.filter((r) => r.state !== STATE.OK);
    return {
        total: rows.length,
        rows,
        counts,
        ok: counts[STATE.OK] || 0,
        attention
    };
}

/**
 * 一行总述（**唯一实现**：诊断视图不再自己拼，拼第二遍就是同一口径两份实现）。
 * 零项就绪时**不写「全部就绪」** —— 那是把一个未发生的好消息当结论。
 */
export function registryLine(face) {
    const f = (face && typeof face === 'object') ? face : {};
    const rows = Array.isArray(f.rows) ? f.rows : [];
    if (!rows.length) return '跨仓功能：登记表为空（无面可判）';
    const c = (f.counts && typeof f.counts === 'object') ? f.counts : countByState(rows);
    const parts = [];
    if (c[STATE.OK]) parts.push('就绪 ' + c[STATE.OK]);
    if (c[STATE.EMPTY]) parts.push('空读数 ' + c[STATE.EMPTY]);
    if (c[STATE.ABSENT]) parts.push('缺席 ' + c[STATE.ABSENT]);
    if (c[STATE.GATED]) parts.push('闸门 ' + c[STATE.GATED]);
    if (c[STATE.OUTDATED]) parts.push('版本偏低 ' + c[STATE.OUTDATED]);
    if (c[STATE.NOT_PRODUCED]) parts.push('待升级 ' + c[STATE.NOT_PRODUCED]);
    if (c[STATE.UNVERIFIABLE]) parts.push('无从分辨 ' + c[STATE.UNVERIFIABLE]);
    return '跨仓功能：登记 ' + rows.length + ' 项 / ' + (parts.length ? parts.join(' · ') : '无可判项');
}

/* ============================================================
 * 反向面登记（**本仓产出 → 上游消费**）[v3.23.4 · T1]
 * ------------------------------------------------------------
 * 【治的欠债（修前实测，不是推测）】
 *   本仓 `PLAN.md` 与上游 `PLAN.md` 在 v3.20.x~v3.25x 期间**都写着**同一句：
 *   「下游→上游 **0 面**」。而本仓实测：
 *     · `apps/memory/lonsha-bridge.js` 导出 `mountLonShaBridge`，在 `index.js:1420` 挂载；
 *     · **上游 `index.js` 真在消费它** —— `window.VirtualPhone?.lonshaBridge` 出现 4 处
 *       （`backfill` / `onFloorCommitted` / `onFloorRollback` / `recall`），
 *       另有 `memoryCore.record` 与 `timeManager.getCurrentStoryTime` 各呈一族。
 *   也就是说：**功能早就在跑，而登记面写着 0 面**。
 *   这正是本仓最贵形态（「声明没有判据 ⇒ 声明会漂移」）在反向尺度上的翻版 ——
 *   只不过这次漂的是**两仓的规划文档**，两边都没人说错话，两边也都没人核过。
 *
 * 【为什么不塞进 CROSSREPO_FEATURES】
 *   那个数组的每一条都是**消费侧**语义（`since` = 上游开始产出这一面的版本 /
 *   `upstreamFace` / `fieldKeys` / `keySites`）。把产出侧塞进去，`R3 面 ↔ 条目双向`
 *   会立刻把它判成「声称对应上游面、而表里没这一面」—— 一条**假红**。
 *   ⇒ 另起一个导出，形态按产出侧设计，由 `scripts/upstream-face-audit.mjs` 的 **R12** 逐格对账。
 *
 * 【每格都要能被真码核（与 CROSSREPO_FEATURES 同纪律）】
 *   id                    —— 登记标识（R12 查重）
 *   owner                 —— 归属仓 = 产出方 = **本仓**
 *   since                 —— 本仓**开始产出这一面**的版本（挂载点落地的版本）
 *   mountSite             —— `<本仓文件>#<符号>`：R12 去那个文件里找该符号的定义
 *                            （挂载点退役而登记未删 = 表在绿、面已没 —— 必须响）
 *   upstreamConsumerFile  —— 上游**消费方文件**（须在上游分发面；`--upstream` 时复核）
 *   upstreamConsumerFloor —— 上游消费点下限（**声明值**，本仓数不到上游的调用点；
 *                            故 R12 只判它在场与 >=1，不假装是本仓实测的）
 *   upstreamConsumers     —— 上游读了哪些出口名（人读 + 供上游复核）
 *   exports               —— 本仓**模块导出**的名字（R12 在挂载点文件里按导出三态核对）
 *   methods               —— 本仓**类体方法**的名字（R12 在挂载点文件的类体里核方法定义）
 * ============================================================ */
export const CROSSREPO_PRODUCED_FACES = Object.freeze([
    {
        id: 'ruby.lonshaBridge',
        owner: 'ruby-phone',
        since: '2.2.0',
        sinceSource: '本仓 apps/memory/lonsha-bridge.js 的 [v2.2] 楼层提交盖章注释'
            + '（上游 index.js 同处注释也写 [v2.2] RB: 楼层提交盖章 → 桥同步手机侧楼层状态）',
        label: '手机记忆桥（LonShaBridge）：回填 / 召回 / 注入协调 / 楼层生命周期',
        mountSite: 'apps/memory/lonsha-bridge.js#mountLonShaBridge',
        upstreamConsumerFile: 'index.js',
        upstreamConsumerFloor: 4,
        upstreamConsumers: ['backfill', 'recall', 'onFloorCommitted', 'onFloorRollback'],
        exports: ['LonShaBridge', 'LONSHA_BRIDGE_KEY', 'mountLonShaBridge'],
        methods: ['backfill', 'recall', 'recallBlock', 'applyCoordinatedInjection',
            'onChatChanged', 'onFloorCommitted', 'onFloorRollback', 'getStats',
            'setEnabled', 'setCoordinated'],
        /* 上游消费的三族（人读；R12 不逐条核上游代码 —— 那需要读兄弟仓，本门只读上游 manifest） */
        usedBy: '上游 index.js 三族：① LLM 提取结果回填手机库（backfill，含 clock / diaries 双端互通）；'
            + '② 手机记忆作为一路召回源（recall，rubyPhoneRecall 闸门）；'
            + '③ 楼层生命周期（onFloorCommitted 盖章 / onFloorRollback 删楼回滚）',
        absentVsEmpty: '桥未挂载（上游取不到 window.VirtualPhone）时上游**静默跳过**（try 包住、'
            + '不抛不报）；而「桥在但这次没有可回填的提取结果」与前者**不同形** —— '
            + '前者 `bridge` 为 undefined、后者 `bridge.backfill(payload)` 真被调用了一次。'
            + '上游侧对「桥不在场」有兜底分支（写 `memoryCore.record`），对「空结果」没有分支。',
        standalone: '只装本仓（上游缺席）⇒ 桥照常挂载但**无人消费**：'
            + '`window.VirtualPhone.lonshaBridge` 在位、`getStats()` 可读，'
            + '而回填 / 召回 / 楼层联动三族的驱动方（上游）不在场 ⇒ 这三族不跑。'
            + '本仓侧不报错、不降级成假读数（桥的能力面与「谁在调它」分开）。'
    }
]);

export default {
    CROSSREPO_FEATURES,
    CROSSREPO_PRODUCED_FACES,
    featureState,
    registryFace,
registryLine
};
