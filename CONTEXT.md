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
- 样式采用深色毛玻璃现代风，遵循各App既定主色：灵感工坊紫(#9333ea)/成就簿金(#f59e0b)/小红书红(#ff2442)/贴吧蓝(#2563eb)/健康粉(#f43f5e)。

## AI 联动标签协议
- 小红书：<RED>{JSON}</RED> 或 <xhs>{JSON}</xhs>
- 贴吧：<Tieba>{JSON}</Tieba>
- 生理状态：由健康App经 GENERATE_BEFORE_COMBINE_PROMPTS 钩子注入 <Physiological_Status> 块
- 玩法注入：由灵感工坊经同一钩子注入 <Scene_Inspiration> 块，发后自清开关控制 MESSAGE_RECEIVED 清空

## 发布链路
- 修改后必须通过 `npm run syntax`（即 `node scripts/syntax-check.mjs`）全量语法校验，再跑 `npm test`；`npm run check` 一次跑完两者。
- ⚠️ 不要再单独依赖裸 `node --check <文件>.js`。实测：仓库缺少 package.json（或无 `"type": "module"`）时，它会把 `.js` 按脚本/CommonJS 解析，对 ES Module 的结构性损坏返回退出码 0（假绿）。index.js 曾据此"校验通过"，实际根本无法解析、插件全量不可加载，并连续发布了约 9 个版本（v2.1.0 → v2.8.9）。
  - 语法门以 `--input-type=module` 从 stdin 强制按 ESM 解析，不依赖该配置；根目录 package.json 的 `"type": "module"` 则让裸 `node --check` 也恢复有效。两者由 `tests/syntax-gate.test.mjs` 的负控制用例共同锁定。
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
