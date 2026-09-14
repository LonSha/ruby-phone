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
