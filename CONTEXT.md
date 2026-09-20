# RubyPhone 工程宪法 (Project Context)

## 项目定位
RubyPhone 是 SillyTavern 原生第三方扩展，三方整合：yuzuki-phone 物理手势底座 + 瑟瑟小手机社媒生态 + 色色灵感状态栏玩法/成就体系，并新增健康生理推演、音乐微信联动。

## 零数据库铁律 (Zero-Database Iron Rule)
1. 禁止调用 AutoCardUpdaterAPI / querySql / executeSql 等任何外部数据库接口。
2. 玩法库 (data/plays.json, 458条) 与成就库 (data/achievements.json, 666条) 为内置静态事实源，禁止改为外部模板。
3. 运行时状态（已选玩法/已解锁成就/生理周期/社媒内容）统一持久化到 chatMetadata 命名空间 ruby_*，随会话隔离。

## App 架构规范
- 每个App独立目录 apps/<name>/，含 <name>-app.js (控制器) / <name>-data.js (数据) / <name>-view.js (视图) / <name>.css (样式)。
- 新增App必须完成四处注册：config/apps.js 桌面图标、phone.css 样式合并、index.js phone:openApp 路由分支、（可选）AI标签解析监听。
- 样式采用深色毛玻璃现代风，遵循各App既定主色：灵感工坊紫(#9333ea)/成就簿金(#f59e0b)/小红书红(#ff2442)/贴吧蓝(#2563eb)/健康粉(#f43f5e)/地点图景青(#14b8a6)/金手指鎏金(#d4af37)/撩语品红(#e879f9)。

## AI 联动标签协议
- 小红书：<RED>{JSON}</RED> 或 <xhs>{JSON}</xhs>
- 贴吧：<Tieba>{JSON}</Tieba>
- 生理状态：由健康App经 GENERATE_BEFORE_COMBINE_PROMPTS 钩子注入 <Physiological_Status> 块
- 玩法注入：由灵感工坊经同一钩子注入 <Scene_Inspiration> 块，发后自清开关控制 MESSAGE_RECEIVED 清空

## 发布链路
- 修改后必须通过 `npm run syntax`（即 `node scripts/syntax-check.mjs`）全量语法校验，再跑 `npm test`；`npm run check` 一次跑完两者。
- `npm run check` = 三道子门串联：`syntax` → `test` → `dead-exports`。
  - **零消费导出门禁**（v2.41.0 建，v2.42.0 加 E6，`scripts/dead-export-check.mjs`）：判据为「本模块内部零使用 **且** 其它非测试文件零引用」。
    **E6（v2.42.0）消费判定必须基于真代码**：`stripNonCode()` 剔除注释与字符串字面量后再做词匹配。此前裸词正则扫全文 = 「注释/字符串里提一嘴就算已消费」，真死导出会被一句 `// TODO: call X` 掩盖（漏报）。口径要点：模板串 `${...}` 插值**按真代码**处理（本仓大量 `${fn()}` 真调用，整串清空会误抹消费）、正则字面量起始须识别 `return`/`typeof`/`case` 等关键词。回归锁在 `tests/system-v242.test.mjs`。
    **E7（v2.43.0）导出枚举必须覆盖跨行 export 大括号块**：此前单行正则让多行成块转出**整块 0 枚举**，块内死导出既不报红灯也不进账本（fail-open）。实测 `config/drives-engine.js` 真实 7 项只枚举到 1 项。配套两处咬合静默点：跨行块须跳过**整段语句区间**（成员行自身含名字，只跳首行会让块内名字全部被算成已消费）、「声明行」不等于「export 行」（先声明后成块转出的写法里，声明行不算消费）。回归锁在 `tests/system-v243.test.mjs`。
    **E8（v2.44.0）导出枚举必须覆盖「解构转出」与「枚举源」**：① `export const { A, B } = expr`（对象/数组解构，可跨行）此前**整块 0 枚举**——`DECL_RE` 只认 `const NAME`，`const {` 直接落下。实测 `apps/phone/status-tracker.js:286` 转出 5 个名字全是隐形（该模块除测试外零引用＝产品端零消费，正是本仓欠债形态）。② 枚举此前跑在**原文**上而消费判定跑在真代码上，被剥离掉的注释里若留着历史备份的整块转出，那些并不存在的名字会被当成本模块真实导出（幽灵导出）。修法：枚举与消费判定共用**同一份真代码**——「判据的输入面与结论面必须是同一件事」。扫描面 516 → 521。回归锁在 `tests/system-v244.test.mjs`。
    另：真代码文本缺失时**不得静默回退原文口径**（`codeTexts.get(rel) || src` 这类写法会让剥离器失效后门禁照常出结论），已改为显式 fail-closed（两侧文本数不等即 exit 2）。本版开发中真实踩到：误删剥离器后跨文件消费 191 → 0，门禁照样打印通过。
     本仓反复出现「机制建好却零消费」的欠债（v2.12 首 chunk 屏障 / v2.26-2.27 运行时登记制 / v2.34 重复存活域 / v2.35 对外世界桥 / v2.38 世界书随机 / v2.39 群聊发言调度），此前**没有任何一道门能拦住新的一例**。
    **E9（v2.45.0）枚举面完整性必须由门禁自证**：E7（跨行成块转出）与 E8（解构转出）本是同一缺口类别的两个个案——某条抽取路径没覆盖某种写法，该写法导出的名字在门禁眼里就根本不存在，既不报红灯也不进账本（fail-open）。补掉个案不等于补掉类别：下一次用上第三种写法会原样重演。本版判据：真代码里每条 `export` 语句必须被 `HANDLED_LINE_PATHS`（block / decl / destruct，与 `DECL_RE`/`DESTRUCT_RE` 共用同一份正则）中任一条命中，否则 **fail-closed 拒判**（exit 2）；确无具名成员可对账的（当前仅 `export default`）须进 `UNHANDLED_ALLOWLIST` 并写明理由。实测现场 179 文件 / 567 条导出语句全部被识别（未识别 0），故本版不改扫描面（521 声明 / 零消费 25 / 账本 25 条均不变）——只把「已经成立的事实」变成「跑不掉的门槛」。注意：**新增导出写法要么补抽取路径、要么进白名单**，否则门禁直接拒判。回归锁在 `tests/system-v245.test.mjs`。
  - 退出码三档：`0` 通过 / `1` 出现未登记的零消费导出 / `2` 结构漂移（扫描面低于下限 `MIN_EXPORTS` 或路径不存在）——后者 fail-closed，防探测器失效后以全绿通过。
  - 冻结账本 `scripts/dead-export-baseline.json`：已知零消费导出须逐条登记理由（接线预留 / 主动放弃 / 可删除兼容壳）。
    新增未登记即红灯；条目被消费或删除只提示不判错（**漏报比误报更伤**，清理账本是洁癖、不阻塞发布）。
  - 消费域不含 `tests/`（只有测试引用 = 产品端零消费，正是本仓欠债的共同形态）； `assets/vendor/**` 与 `workers/**` 因消费者不在仓库内整体豁免。
  - 新增真正需要对外暴露的导出时，先接线；确属对外接口则跑 `node scripts/dead-export-check.mjs --update` 并**写明理由**。
- ⚠️ 不要再单独依赖裸 `node --check <文件>.js`。实测：仓库缺少 package.json（或无 `"type": "module"`）时，它会把 `.js` 按脚本/CommonJS 解析，对 ES Module 的结构性损坏返回退出码 0（假绿）。index.js 曾据此"校验通过"，实际根本无法解析、插件全量不可加载，并连续发布了约 9 个版本（v2.1.0 → v2.8.9）。
  - 语法门以 `--input-type=module` 从 stdin 强制按 ESM 解析，不依赖该配置；根目录 package.json 的 `"type": "module"` 则让裸 `node --check` 也恢复有效。两者由 `tests/syntax-gate.test.mjs` 的负控制用例共同锁定。
  - 性能层（v2.40.0）：门改为**本进程内 vm 批量解析**（251 文件单次 ~0.6s，旧逐文件 spawn 为 ~16.7s），仅对快筛失败的文件回退 per-file `--check` 取精确 stderr。`vm.SourceTextModule` 需 `--experimental-vm-modules`，缺标志时门自 re-exec 一次（`RP_SYNTAX_GATE_REEXEC` 防递归）。判定等价性由 `tests/syntax-gate-perf.test.mjs`（含负控制）锁定，改动门时须重跑。
  - 注：显式写 `"type": "commonjs"` 并不等价于"没有 package.json"——含 `export` 的文件会因模块语法直接报错（另一种失败机制）。
- 新增/改动 App 时同步三处版本号：`manifest.json`、`index.js` 的 `ST_PHONE_VERSION`、`package.json`；`update-log.json` 需含当前版本条目且 `latest` 指向它。版本跨源自洽由测试断言锁定，不要把具体版本号硬编码进测试。
- release 附带离线 zip。
- README.md 安装指引指向 GitHub 仓库 LonSha/ruby-phone。

## 候选技术储备（已侦察未移植）
- moyunphone（墨韵手机）：核心代码 JS 混淆，无法直接移植；其 NovelAI v4 多角色生图 + 角色一致性、上下文总结、hooks 生命周期、host-performance 宿主性能守护为后续演进方向。
- Anrrow-phone-music：GD Studio 多源引擎与 TMUSIC 标签协议已全量移植（见 music-data.js / index.js）。

## 记忆系统 (apps/memory/)
- memory-engine.js：纯算法内核（EmotionTagger 本地词典 / calculateDecayScore / consolidateMemories / searchMemories / buildMemorySummary）
- memory-pool.js：四层记忆池，三级触发（sensory→keyword→semantic）
- memory-data.js：MemoryCore 编排 + PhoneStorage 持久化（KEY=memory_core_v1）+ attachPromptHook
- memory-app.js / memory-view.js / memory.css：iOS 风格 App
- 数据流：onMessageReceived(user/ai) → record() → 短期 → sleep() → 长期+池 → recall() → buildPromptDirective() → GENERATE_BEFORE_COMBINE_PROMPTS

### 跨端记忆协同（LonSha 插件 ⇄ RubyPhone）
- **ruby → lonsha**（内存桥 `window.VirtualPhone.lonshaBridge`，apps/memory/lonsha-bridge.js）：`recall(query, topN)` 取剧情记忆 / `onFloorRollback(floor)` 删楼回滚 / `applyCoordinatedInjection` / `onChatChanged`。
- **lonsha → ruby**（两条通路）：① 官方门面 `window.LonShaMemory.getPublicData()`（图谱/摘要/日记/POV/时间线/状态/账本/向量，由 apps/memory/graph-bridge.js 消费）；② 只读快照桥 `window.lonsha_memory_bridge_v1.snapshot`（v3.88 起，含 protagonist / lifeDetails / characters / moneyLedger / outline / worldProg / clock / recallAudit）。
- **注入格式化单一真源**：`LonShaBridge.prototype.recallBlock(queryText, opts)` —— `opts = { topN, label, userName, actors, strictActors }`。统一块头、首 24 字去重、每条裁 80 字、最多 3 条；`strictActors: true` 只保留提及在场人物的记忆（群聊防串味）；无命中返回 `''`（不产生空块）。**新增注入点必须走此方法，禁止在调用方另拼格式**（微信单聊 / 微信群聊 / 蜜语 honey 三处已统一）。

## 织光机 (apps/timeweaver/)
- timeweaver-engine.js：纯函数内核（collectFragments 聚合 / composeLetter 本地规则成信），零 LLM、零副作用。
- timeweaver-app.js：控制器（composeAILetter LLM 升华 / saveLetter+listLetters 收藏册 / autoWeaveIfDue 定期织信 / shareLetterToMoments 朋友圈分享）。
- timeweaver-collector.js：从聊天痕迹采样（含 collectLonshaRecall 读快照桥 recallAudit）。
- timeweaver-view.js：视图（织信 / 收藏册 📚 / 回望 🔁 三个 tab）。
- 持久化：`tw_letters`（收藏册）、`tw_last_auto`（定期游标）—— 由 config/storage.js 的 `CHAT_DATA_PATTERNS` 的 `/^tw_/` 判定为聊天数据，随会话隔离。
- 宿主兼容：App 控制器内取 `window.VirtualPhone` 一律经 `this._vp()`（`typeof window !== 'undefined' ? window : globalThis`），保证单测 / 非浏览器宿主下不抛 ReferenceError。

## 地点图景 (apps/place/，v2.46.0)
- 消费上游记忆插件（lonsha-memory-plugin v3.181.0）外供的场所图景面：只读桥 `window.lonsha_memory_bridge_v1.snapshot.scene`（`SceneBook.summary()` 的 `deep()` 拷贝）。**本仓此前对该面全库零消费**——上游把「地点」做成可查询面并外供了，手机端却看得到剧情、看不到「人在哪儿」。
- 与 `config/world-bridge.js`（上游世界桥）同规格的三条纪律：**只读**（只取 snapshot 对象，对象缺失才回落 `refresh()`，绝不写上游状态）、**不抛**（桥未装/无快照/面畸形一律降级为归因文案）、**不猜**（拿不到就如实说拿不到，绝不编造地点或人数顶替）。
- **归因六态必须分开报**（`readSceneFace()`）：`bridge-absent`（插件未装）/ `no-snapshot`（装了但还没产出快照）/ `no-scene-face`（快照是旧版没有场所面，**只有这一态能给「去升级」的指引**）/ `module-absent`（A 侧 `SceneBookFallback` 在跑，读数一律为空而非「没有场所」）/ `empty`（这个会话还没登记过场所）/ `ready`。六种完全不同的处境不得在界面上同形（本仓反复治理的静默降级）。视图对未知 reason **如实显示原值，不吞**。
- **不变量三态不得塌两态**：`ok` / `warn` / `broken` 三种字样互不相同，`absent` 单列第四态并明写「不算通过」（缺席不得伪装成 ok）；违例逐条按 kind 可读化（八种 kind），未知 kind 如实显示原始 kind。
- **覆盖度拒绝只报百分比**：逐楼列号 + 缺口 steps（「第 N 楼 → 第 M 楼之间缺几楼」）+ 未登记到访单列。「有缺口」无法行动，「缺哪几楼、缺多少」才能直接去补。
- **读数不落库、每次现取**：本 App **不持有任何读数副本**，`onChatChanged()` 只丢弃旧会话的探针归因（任何实例级缓存在换会话/删楼回滚后必成陈旧数据）。非数值如实 `null`（不补 0 冒充「世界是空的」）、位置链缺失给 `[]`（不编一条）。
- 生成侧一致性注入：`scenePromptBlock()` 经 `GENERATE_BEFORE_COMBINE_PROMPTS` 注入「【本世界已登记的场所与在场…】」system 块，让正文地点与记忆插件记的地点是同一个。与 worldpulse 的 `worldAxisPromptBlock` 同规格：**内容为空返回 `''`**（不产生空块）、注入失败静默且绝不阻断生成。
- 设置：`place_settings_v1`（`injectToPrompt` / `maxInject` 1–20 / `showDiagnostics`），由 `config/storage.js` 的 `/^place_/` 判定为会话数据。桌面主色地理青 `#14b8a6`；样式合并进 `phone.css` 并保留 `apps/place/place.css` 源文件（与 bilibili / theater 同规）。
- 回归锁：`tests/system-v246.test.mjs`（98 项，含真源码破坏负控制）。

## 金手指 (apps/cheat/，v2.47.0)
- 消费上游外供的《万界武库V4》世界书（185 条 / 508,555 字）。形态判定先于实现：174/185 条带 `disable=true`，它是**武库**（可选外挂目录）而非人设——**「拥有」与「生效」拆开**：157 个可抽卡包 + 3 个装配位（1–5 可调）+ 生成前一次性注入；全量注入 500K 字等于自杀，装配上限是核心机制。
- **同源契约双文件**：`data/cheats.js`（1.36MB 全量正文，只给金手指 App）/ `data/cheat-index.js`（36KB 轻量索引，抽卡侧 + 品阶权重单一真源）。`CHEAT_ITEM_PREFIX = 'cheat_'` 只在索引定义一次，抽卡背包 id 与反解都经 `cheat-data.js` re-export（`CHEAT_ITEM_PREFIX` 本身不导出，否则被零消费门禁判死导出）；任何地方手写前缀截取都算漂移。
- **品阶按包总字数分六档**（≥6000 神话 8 / ≥4500 传说 19 / ≥3500 史诗 12 / ≥2600 稀有 44 / ≥1800 优秀 48 / <1800 普通 26），权重即品阶权重（神话 1 … 普通 30）；185 条按 `·` 切分取主条归并（`sub > 1` 的 8 条为家族条）。
- **装配语义**：到顶如实拒绝不静默替换；读取时重跑归一（去重 / 丢未知 / 保次序）；`toggleInstall` **写入前**校验 id（写脏 + 读时净化是终将被绕过的兜底），未知 id 如实拒绝不落存储。
- **生成侧注入**：`buildCheatPromptBlock()` 经 `GENERATE_BEFORE_COMBINE_PROMPTS` 注入 system 块，语义是「已装配外挂是**既定事实**」（非许可，堵「怎么会这个」的自作解释链）；块头 `〔品阶·名称〕`、正文逐字不改写；空清单返回**空串**（有双重防线：装配归一空 / 块拼装空各一道，破坏须两道全破才可观测——负控制按此锁）。
- **抽卡联动**：以 `cheat_<packId>` 入包（`unique:true` / `stackable:false`，重复抽不再入包）；外挂池 `includeInAll:false`；`getItemsOfPool('all')` **按池表推导排除集**（新池标 false 即自动生效），「列出」与「抽取」两路同时收敛——本版修掉「全部池混入外挂」的自相矛盾。
- **工程纪律**：只持久化 `cheat_state_v1`（`/^cheat_/` 会话隔离）；不持武库副本、背包现取；`onChatChanged()` 只丢浏览位置不动装配；index.js 三处清理路径（换会话 + clearCurrentData + clearAllData）同步接入。
- **四处注册**：`config/apps.js` 桌面条目（鎏金 `#d4af37`，与既有 29 主色唯一不撞）/ `phone.css` 合并 `.ch-*`（保留 `apps/cheat/cheat.css` 源文件，与 bilibili / theater / place 同规）/ `phone:openApp` 懒加载单例路由（失败兜底提示）/ `CHAT_DATA_PATTERNS` 增 `/^cheat_/`。
- **顺手修复的两处真实缺陷**：① `esc()` 双引号「转义」成转义成自身 = 无转义（cheat-view 与既有 gacha-view 同修）。根因经探针实测：**写入路径把 HTML 具名实体解码成裸字符，数字实体（`&#34;` / `&#39;`）才原样保留**——转义函数一律用数字实体。② v223 / v246 两条钉死字符距离/紧邻关系的门禁判据改为「结构化区间成员核对」（锁语义：重绑调用落在换会话清理块内且在 `wechatApp = null` 之前）；v238/v239 的公告同源判据改为对公告对象字面量整体求值后逐字比对（裸引号对扫描会被正文里的引号多抓条目）；v246 K3 的版本专属词判据改为版本无关自洽性。**新判据必须附负控制：篡改一字须被抓到。**
- 回归锁：`tests/system-v247.test.mjs`（98 项，A–H 八组，含真源码破坏负控制）。
- 数据再生成：`scripts/gen-cheats.mjs`（源世界书路径经 argv 传入 → cheats.js + cheat-index.js 双输出同源；改源后重跑并由 v247 的 A 组同源断言把关）。


## 撩语 (apps/dirtytalk/，v2.48.0)
- 消费上游外供的《Adult Romance DirtyTalk》世界书（673 条 / 71.3 万字）。形态判定先于实现：0 禁用 / 0 常驻，key 全为精确方括号绿灯标签——它是**词库**（可选说话方式目录）而非人设。**「拥有」与「生效」拆开**：199 个可抽模块 + 4 个装配位（1–8 可调）+ 生成前一次性注入；全量注入 26.2 万字等于自杀，装配上限是核心机制。
- **同源契约三文件**：`data/dirtytalk.js`（全量正文，只给撩语 App）/ `data/dirtytalk-index.js`（轻量索引，抽卡侧 + 档位权重单一真源）/ `data/dirtytalk-corpus.js`（语料档只读参考，不参与注入）。`DT_ITEM_PREFIX = 'dt_'` 只在索引定义一次，抽卡背包 id 与反解都经 `dt-data.js` re-export；非 `dt_` 前缀反解为空串（不猜）。
- **归并与档位**：DT_STYLE 8 风格 force=0 拼合；HUM_METHOD+OTHER 去编号归并；PLAY_*/ACTION_* 进 play；QUOTE_BANK 进 quote；机制条丢弃。档位按模块总字数：≥1200 重 34 / ≥600 中 107 / 其余轻 58。扭蛋六档映射：重→稀有 / 中→优秀 / 轻→普通。
- **装配语义**：到顶如实拒绝不静默替换；读取时重跑归一；`toggleInstall` **写入前**校验 id，未知 id 如实拒绝不落存储。默认上限 4 条（1–8）。
- **生成侧注入**：`buildDtPromptBlock()` 经 `GENERATE_BEFORE_COMBINE_PROMPTS` 注入 system 块，语义是「已装配说话方式是**既定风格**」；块头 `〔类别·名称〕`、正文逐字不改写；空清单返回**空串**（双重防线：装配归一空 / 块拼装空各一道）。
- **抽卡联动**：以自身 `dt_<hash>` id 入包（`unique:true` / `stackable:false`）；池 `pool_dt` `includeInAll:false`；道具表从轻量索引派生，不拖 686KB 正文。
- **工程纪律**：只持久化 `dt_state_v1`（`/^dt_/` 会话隔离）；不持词库副本、背包现取；`onChatChanged()` 只丢浏览位置不动装配；index.js 三处清理路径同步接入。
- **四处注册**：`config/apps.js` 桌面条目（品红 `#e879f9`）/ `phone.css` 合并 `.dt-*`（保留 `apps/dirtytalk/dt.css` 源文件）/ `phone:openApp` 懒加载单例路由（失败兜底提示）/ `CHAT_DATA_PATTERNS` 增 `/^dt_/`。
- 回归锁：`tests/system-v248.test.mjs`（A–H 八组，含真源码破坏负控制）。
- 数据再生成：`tools/gen-dirtytalk.py`（默认源 `.sourcematerial/Adult_Romance_DirtyTalk_WorldInfo_v927.json` → dirtytalk.js + dirtytalk-index.js + dirtytalk-corpus.js 三输出同源；改源后重跑并由 v248 的 A 组同源断言把关）。
## 系统层 (v2.16.0：通知 / 搜索 / 控制中心)
- **通知落账层 `config/system-notifications.js`**：`NotificationLog`（KEY=`sys_notifs`，LIMIT=200，MERGE_WINDOW_MS=180000）。契约：`push()` 返回 `{id, merged}`；同 `senderKey` 3 分钟内合并累加 `count`，**合并不重置已读**；落盘 800ms 防抖 + `flushNow()` 兜底；`_normalize` 净化脏数据并倒序裁剪；**全部失败路径返回 `{error}`，绝不抛**。
- **落账单一真源**：`index.js` 的 `showUnifiedPhoneNotification` 在展示前统一落账，`_resolveLog()` 优先复用 `window.VirtualPhone.notificationLog`，实例缺失时 App 自建。**新增通知入口必须走此函数，禁止绕过落账直接弹横幅**（否则历史会漏记）。
- **落账在展示之前 + DND 门在落账之后**：顺序为 `落账 → isDndOn(storage) 早退 → 展示`。免打扰只拦横幅，**通知仍入账不丢**。
- **检索内核 `apps/memory/global-search-engine.js`**：`scoreHit`（标题全等 +100 / 前缀 +80 / 包含 +60 / 仅正文 +30，再按位置与长度加权）/ `makeSnippet`（命中居中开窗）/ `GlobalSearchEngine`（`sourceIds` 过滤、`invalidate`、`lastErrors`）。每源独立 `try/catch`，坏源不拖垮整体。
- **索引源必须与真实存储键/字段对齐**（写错即成死代码，测试已锁定）：微信消息**不在** `chats[].messages`，而在分片键 `wechat_msg_<chatId>`（大厅模式 `phone_wechat_msg_lobby_<chatId>`）；世界脉搏历史键 `worldpulse_history_v1`；阅读书架键 `ruby_reading_shelf`（字段 `title/author/addedAt/chapterCount`）；已解锁成就是 `{成就id: 时间戳}` **对象映射**（名称/说明需从 `data/achievements.json` 目录补全）；朋友圈字段 `name/text/commentList[{name,text}]/timestamp`；日历备忘无 `content`（只有 `title/dateKey/time`）；音乐歌单字段为 `name`。
- **系统开关单一真源 `config/system-controls.js`**：`SYS_KEYS` = `sys_dnd` / `sys_shell_scale` / `sys_flashlight` / `sys_wifi`；缩放 SCALE_MIN 80 / MAX 120 / DEFAULT 100，**新键 `sys_shell_scale` 优先、旧键 `phone-shell-scale` 回落**（与设置页同一套 `--phone-shell-*` 通路，双向一致）。`musicControl` / `currentTrack` 直接操作 `MusicApp.musicData`（MusicData 实例）——**方法名 `next()/prev()/resume()/pause()`、曲目字段 `name`**，锁屏 `_nowPlaying()` 复用 `currentTrack()`，不重复实现。
- **顶部下拉双热区分流**：`bindNotificationCenterPullDown` 按状态栏中线 `getBoundingClientRect()` 判定 —— 左半 → 控制中心（`controlCenter.toggle()`），右半与药丸 → 通知中心；统一 **46px 位移阈值**，故药丸的 click 锁屏（`_bindLockGesture`）不受影响。
- **`/^sys_/` 归入聊天数据域**：`sys_notifs` / `sys_dnd` / `sys_shell_scale` / `sys_flashlight` / `sys_wifi` 随会话隔离，换角色不带上一角色的系统状态。
- **锁屏速览层 `phone/lock-screen.js`**：`_greeting` / `_recentNotifications` / `_nowPlaying` 全部**可选缺失降级**，通知层或音乐层不存在时静默回落到原锁屏。
- **文件名合规**：`apps/<dir>/` 控制器必须命名为 `<dir>-app.js`（bilibili 特例 `bili-app.js`），由 `tests/audit.test.mjs` 强制；`notifications` App 的控制器为 `notifications-app.js`，视图为 `notification-center-view.js`。
- **防死代码防线**：`tests/system-v216.test.mjs` 用**真实形态 seed 数据**断言索引源可命中，另有一组「接线门」断言（模块必须被实例化并挂到 `window.VirtualPhone`、样式类名必须存在、`esc()` 不得退化为 no-op）。

## 钱袋 / 档案 / 剧情线 (apps/wallet/ apps/profile/ apps/plotline/，v2.49.0)
- **起点**：记忆插件桥 `lonsha_memory_bridge_v1` 外供 13 资源，手机侧此前仅消费 scene/recallAudit/clock/floor；moneyLedger / protagonist / lifeDetails / outline / worldProg 全库零消费——「上游做了面、下游一个消费点都没有」是本仓最典型欠债形态。
- **三 App 均为 place 同规四件套**：`*-data.js` 纯函数内核（`read*Face` 五态归因 / 投影 / `*PromptBlock`）、`*-app.js` 控制器（probeBridge → face → projection；`_initHook` 挂 GENERATE_BEFORE_COMBINE_PROMPTS；`onChatChanged` 只丢探针归因）、`*-view.js`（归因卡先说读不到）、`*.css`（合并进 phone.css 尾部，源文件保留）。
- **五态 vs 六态**：place 有 `module-absent`（上游 SceneBookFallback 带 absent:true）；三个新面上游无退路对象，故为五态。`profile` 内审修过一处：`hasFace` 与 `empty` 判定曾互斥导致 empty 不可达，现 `hasFace = protagonist||Array.isArray(lifeDetails)`，`hasContent` 单独判。
- **注册**：apps.js 36 条目（新色 #eab308 / #818cf8 / #b08d57）；storage `/^wallet_/ /^profile_/ /^plotline_/`；index.js 路由 3 分支 + 三处 onChatChanged 各 +3 行。v224「bilibili→wechatApp=null」窗口随接线增长 400→600（实测 500/572/569）。
- **撩语场景联动**：`dt-data.js` 增 `SCENE_STYLE_MAP` + `sceneStyleHints(chain)` 纯函数；控制器 `sceneStyleHints()` 读桥 `snapshot.scene` 经 `currentChainOf`（import 自 place-data，不造第二套）；视图 `_sceneCard()` 置词库页顶部，无链整卡隐藏。
- **微信注入补口**：`chat-view.js buildMessagesArray` 在 lonsha recallBlock 之后补 push `dtApp.promptBlock()` / `cheatApp.promptBlock()`（取已存在实例，不触发懒加载；空块不 push；try/catch 静默）。**注意**：place/wallet/profile/plotline 的 promptBlock 尚未接入微信链路（下一轮候选）。
- **门禁**：tests/system-v249.test.mjs 11 项；`npm run check` 287 文件 / 276 测试 / 无新增零消费。

