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
- `npm run check` = 三道子门串联：`syntax` → `test` → `dead-exports`。
  - **零消费导出门禁**（v2.41.0 建，v2.42.0 加 E6，`scripts/dead-export-check.mjs`）：判据为「本模块内部零使用 **且** 其它非测试文件零引用」。
    **E6（v2.42.0）消费判定必须基于真代码**：`stripNonCode()` 剔除注释与字符串字面量后再做词匹配。此前裸词正则扫全文 = 「注释/字符串里提一嘴就算已消费」，真死导出会被一句 `// TODO: call X` 掩盖（漏报）。口径要点：模板串 `${...}` 插值**按真代码**处理（本仓大量 `${fn()}` 真调用，整串清空会误抹消费）、正则字面量起始须识别 `return`/`typeof`/`case` 等关键词。回归锁在 `tests/system-v242.test.mjs`。
    **E7（v2.43.0）导出枚举必须覆盖跨行 export 大括号块**：此前单行正则让多行成块转出**整块 0 枚举**，块内死导出既不报红灯也不进账本（fail-open）。实测 `config/drives-engine.js` 真实 7 项只枚举到 1 项。配套两处咬合静默点：跨行块须跳过**整段语句区间**（成员行自身含名字，只跳首行会让块内名字全部被算成已消费）、「声明行」不等于「export 行」（先声明后成块转出的写法里，声明行不算消费）。回归锁在 `tests/system-v243.test.mjs`。
    本仓反复出现「机制建好却零消费」的欠债（v2.12 首 chunk 屏障 / v2.26-2.27 运行时登记制 / v2.34 重复存活域 / v2.35 对外世界桥 / v2.38 世界书随机 / v2.39 群聊发言调度），此前**没有任何一道门能拦住新的一例**。
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
