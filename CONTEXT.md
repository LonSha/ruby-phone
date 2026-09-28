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
- 修改后必须通过 `npm run syntax`（即 `node scripts/syntax-check.mjs`）全量语法校验，再跑 `npm test`；`npm run check` 一次跑完全部门。
- `npm run check` = **十道子门**串联：`syntax` → `import-resolve` → `test` → `dead-exports` → `lifecycle`
  → `registry` → `keys` → `source-derivation` → `bridge-contract` → `weak-coercion`。
  > 【本行订正 · v3.19.0】此前本行写「**五道子门**：syntax → test → dead-exports → lifecycle → registry」——
  > 那是本行写下时的实况，而 `package.json` 的 `scripts.check` **早已是十道**（v3.19.0 实现工具包时实测）。
  > 这类「文档写五道、真门禁跑十道」正是本仓治过的形态：**口径与真源脱节，而脱节的那一处是给人读的那一处**。
  > 订正为真读数（照 `package.json` 抄，不凭印象）：入口本身仍是唯一真源，
  > 后续若增删门禁，**须同时改本行**（这条纪律比数字本身重要）。
  > 判据：`tests/system-v3190.test.mjs` 的 D 组钉的是「登记面取数复用了哪一份真源」；
  > 门禁数量与顺序的真源是 `package.json`，本行只是它的转写。
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

## 生命周期与注册门禁（v2.65.0 ~ v2.68.0）
- **动机**：本仓最贵的缺陷形态是「**不报错、不崩溃、只错数据或只漏资源**」。v2.63/v2.64 两轮审计（写脚本枚举全仓缺口）一次性挖出 4 处真缺陷，此后把审计能力固化为常驻门禁，杜绝「下次同类缺陷仍要人肉排查」。
- **`scripts/lifecycle-audit.mjs`**（v2.65.0，`npm run lifecycle`）：三条会话路径 = **P1 换会话**（`function onChatChanged()`）、**P2 清当前数据**、**P3 清全部数据**（两个 `addEventListener`）。区间边界必须按函数/监听器边界精确划定（用近似区间会导致 P1/P2 重叠而漏判）。
  - **L1 方法出口**：App 类定义了生命周期出口（`onChatChanged`/`clearCache`/`destroy`/`deactivate`/`reload`）且能反查到 `VirtualPhone.X = new module.Class` 的，必须至少有一处接线（REBIND 表 / 显式调用 / 泛化调用清单）。
  - **L2 槽位覆盖**：槽位若在 P1 被回收，P2/P3 至少须有一处覆盖，或落在咽喉点清单。
  - **L3 白名单从真源码派生**：泛化调用清单 ← `releasePhoneInactiveResources` 的 `appEntries`；咽喉点清单 ← `retireSessionScopedSlots` 函数体。**派生前提消失即 fail-closed（exit 2）**——写死的白名单会在机制被删除后继续放行，门禁变吉祥物。
  - 踩坑：`explicitCall` 正则须匹配真实书写（`?.()` 与局部句柄 `phone.xxx` 都要认）；函数体抽取用**花括号配平**而非缩进假设。
- **`scripts/registry-audit.mjs`**（v2.66.0，`npm run registry`）：新增 App 的注册三件套 = APPS 桌面条目（`config/apps.js`）/ 懒加载分支（`index.js` 的 `appId === 'xxx'`）/ 会话键前缀（`config/storage.js`）。
  - **R1 双向覆盖（零豁免）**：两侧集合互为子集；有 App 无分支 = 点击无反应，有分支无 App = 死代码或改名漏改。实测真仓库 40 ↔ 40。
  - **R2 宽匹配登记**：键前缀里带量词/字符类/分组/或的条目须登记理由（宽匹配吞多键，逐 App 对账不适用）；`^` `$` 是锚定符不计入。**明确不判「App 缺前缀」**——读侧聚合器与 `ruby_` 共享桶成员属设计内，硬判即假阳性，故只报告不判定。
  - **R3 样式投递覆盖**（v2.67.0）：每个 App 的样式表必须被两种投递机制之一覆盖——
    **A 全局打包**（类前缀族合并进 `phone.css`）、**B App 内自注入**（App 内按文件名建 `<link>`），
    或登记进 `CSS_DELIVERY_EXEMPT` 并写明理由。三者皆无 = 样式从不生效、界面裸奔且不报错。
    **判据必须按实测机制而定，而非从文档措辞推出**——只认机制 A 会把 4 个自注入 App 判成缺口（假阳性）。
  - **准入清单存活自证**（v2.68.0，E10 / R2b / R3b / R3c）：**白名单是准入闸，不是放行条**。
    三张硬编码清单（`UNHANDLED_ALLOWLIST` / `REGEX_WIDE_ALLOWLIST` / `CSS_DELIVERY_EXEMPT`）
    此前只有准入校验——新条目必须登记，否则红灯——却**没有任何东西检查登记的是否还活着**。
    条目所指对象一旦消失就静默退化为**幽灵放行条**，为不存在的情形背书而门禁永不报警。
    - **E10**（`dead-export` 门）：每条未处理导出写法的白名单条目**认领数必须 ≥ 1**，零命中即拒判。
      刻意**不设固定数字**——数字漂移无害，写死 90 会导致每次新增平台入口都要改门禁。
    - **R2b**：每条宽匹配前缀必须仍能在 `CHAT_DATA_PATTERNS` 找到对应条目。
    - **R3b**：样式豁免清单**双向**自证——指向的文件必须存在，且**反向判定「理由已失效」**
      （该文件若其实已被 `phone.css` 打包或已有 JS 引用，说明它本可进入正常判定，豁免应撤掉）。
    - **R3c**：样式文件内部的本地 `url()` / `@import` 目标必须真实存在，**豁免项同样在射程内**。
      此前豁免项被 R3 直接 `continue`，其**内容是判定盲区**——转发目标一旦改名，壳会静默指向虚空。
    - 上述判据一律 **exit 2（拒判）而非 exit 1**：这不是数据缺陷，是**门禁自己的账目错了**，
      与 L3「派生前提消失即 fail-closed」同族。夹具模式下跳过（清单是内置真仓库对象，合成夹具天然不含）。
  - **证据面纯度纪律**（v2.68.0 实测踩到，E6 纪律的第三次复现）：判定「某文件是否被消费/投递」时，
    判据的输入面必须**排除非证据**——`index.js` 的更新说明**散文**曾把从未被任何 JS 引用的
    `games.css` 伪装成「已投递」；`scripts/` 下门禁**自己的豁免清单字面量**曾把同一文件读成
    「有 JS 引用它」（**自指伪证**）。修法：判据收紧为**路径字面量**（文件名须处在路径边界 `(^|/)`、
    后接 `?查询串` 或结束），并把 `scripts/` 排除出引用面——**那里的路径是描述，不是引用**。
  - **注释如实性纪律**：注释里的数字与形态必须与实测一致。v2.68.0 开发期现场自我纠错两次
    （`export default` 多行对象字面量 17 → **9** 处；白名单注释 61 → **90** 处），
    两者恰是所要治的病（注释与实测脱节）的现场演示。**边界外覆盖也要写清**，不许用「不适用」含糊过去。
- **负控制纪律（两道门共用，测试节强制）**：真源码破坏（锚点恰中 1 次）→ 在**夹具副本**上重跑**真门禁进程**。夹具走环境变量通道（`RP_LIFECYCLE_FIXTURE` / `RP_REGISTRY_FIXTURE`），只放宽最低计数闸、不放宽结构锚点。三种假绿必须全部排掉：对原文件断言 / 破坏写成模拟常量 / 判据自指。
- ⚠️ **禁止对真仓库执行 `cp -al`（血泪教训）**：本环境该操作会把已跟踪文件替换为指向临时 l2s 收容所名字的符号链接（实测 425 个文件损坏，靠 `git checkout -- .` 恢复）。需要副本请用合成夹具；恢复判据是 `git status` **只显示 `T`（类型变化）而无 `M`（内容修改）**，此时内容可信。

## 会话键归属门禁（v2.69.0，第六道门）
- **动机**：`config/storage.js` 的 `CHAT_DATA_PATTERNS` 决定每个 storage 键**落在哪里**——命中 → 当前会话的
  `chatMetadata`（会话隔离）；不命中 → 全局 `extensionSettings`。判错的后果是本仓最贵的形态：
  **不报错、不崩溃、只错数据**（该隔离漏配 → 换角色/换会话串味，v2.8.10 事故；不该隔离误配 →
  本该全局的设置跟着会话走，切角色后"莫名丢了"）。此前**没有任何地方能回答「这个键归谁、该不该隔离」**。
- **兜底桶收紧（v2.69.0，数据面）**：原 `/^ruby_/` 一条兜底吞 12 个键，**归属不可知**。
  已改为 **11 条精确键 + 1 条前缀型**（`ruby_reading_progress_`，reading-view 按 bookId 拼接）。
  安全性依据：① 全仓 `ruby_` 字面量键可完全穷举（零动态生成）；② `get()` 的「历史误存修正」分支
  只在键判为会话键时生效，收紧后这 12 个键仍全判为会话键 ⇒ 旧档搬迁能力不变；
  ③ 逐键枚举的防串味强度与兜底**等价**，差别只在「可核对」。
- **`scripts/keys-audit.mjs`（`npm run keys`，已串进 `npm run check`）三条判据**：
  - **K1 登记完整**：真仓库每个 storage 键必须在 `KEY_REGISTRY` 登记并声明 scope，未登记即红灯（exit 1）。
    这条把「新增键」从「随手写」变成「必须先回答归属」。
  - **K2 归类一致（核心价值）**：登记声明必须与 `CHAT_DATA_PATTERNS` 的**实际匹配结果**一致，
    不一致即红灯。它把「意图」与「机制」钉在一起——任一侧改动而另一侧未跟上都会被抓住。
  - **K3 清单存活**：每条登记必须仍能在真仓库找到使用点，零命中即 exit 2 拒判（同 E10/R2b/R3b 纪律）。
  - 实测：**139 个键全登记**（会话隔离 92 · 全局 45 · 历史键 2），K2 零分歧。
- **`legacy` 类别（历史误存键）**：`games_catbox_state` / `games_werewolf_state` 是「读旧档 → 迁移 → 删除」
  的迁移键，迁移后已无写方。这类键仍须活着（K3），但**不参与 K2**——硬判会逼人为消红灯改正则，
  反而丢掉旧档迁移能力。**新增 legacy 必须写明「为什么它的 scope 由当年决定」**。
- **抽取面纯度（三类混杂 + 一类收编）**：
  ① 只认 **storage 句柄**上的 set/get/remove（宽口径会把 `Map.get('active')`、`.set('loading')` 当键，
     实测 86 个里 40 个假阳性）；② 排除 `scripts/`（那里是**描述**不是**使用**，同 v2.68.0 自指伪证）；
  ③ 排除形似键名的 JSON 字段（`const WORTH_KEY = 'worth'` 读的是 `stock.worth`，源码显式登记为唯一例外）；
  ④ **收编本地包装层**：`const get = (key, dflt) => storage?.get?.(key, dflt)` 之后的裸 `get('...')`
     也是真实读取（不收编会把真键误报成「登记失效」，实测 `ruby_reading_books` 即此形；
     收编后新暴露 3 个此前未被枚举的真键：`calendar_memos` / `sys_notifs` / `memory_core`）。
- **结构守卫（fail-closed，连夹具也不放宽）**：patterns 解析 < 40 条 / 键使用点 < 40 个 / 登记表 < 60 条，
  一律拒判而非静默全绿。开发期它当场救了一次假绿（解析正则要求行尾闭合 → 50 条只认出 15 条）。
- ⚠️ **判据必须真解析，不得做文本剥取**（v2.69.0 实测踩到）：四处 items 同源判据曾用「逐行剥引号 / `/"([^"]+)"/g`」实现，隐含假设「条目内不含引号」。
  内容一旦含引号（如 `.get("active")`）就会劈段错位 ⇒ **假红灯**；条目跨行时还会**漏比** ⇒ **假绿灯**。
  **凡涉及转义语义的比对，必须交给语言（`JSON.parse`）而不是自己写正则。**
- ⚠️ **测试不得依赖「会自然过期的前置数据」**（v2.69.0 实测踩到）：某负控制原本拿**当版公告**里
  的散文串当伪证据，换一次公告即失效变假红灯。**证据必须自造**（夹具内置），
  否则用例的生命周期被无关内容绑架。同族修法：给门禁补「夹具可覆盖内置清单」通道，
  使机制代码在合成仓库上也能被负控制覆盖（而不是整段跳过）。
- ⚠️ **负控制纪律（本门新增一条）**：破坏必须覆盖**全部**抽取路径。首版负控制只破坏句柄前缀，
  而常量层与 `local-get` 两条路径仍在收键 ⇒ 红灯不出现（**空的负控制**）。
  改为让收集函数空转后才真正触发守卫。
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
  **取值门纪律（v3.3.0 起）**：楼层类入参在每个边界**入口**过一份本地 `(st)floorOrNull`（先看类型：只认数字与非空数字字符串，其余如实「没给」）—— `0` 是**合法楼层**，而 `Number(null) === Number('') === Number([]) === 0`，故「没给」与「就在第 0 楼」不得塌成同形；宿主 `index.js` 用 `stFloorOrNull` 前缀，`apps/*` 各持同名 `floorOrNull`，判据见 `tests/system-v312.test.mjs`。
  另：`numOrNull` 三份实现（`config/projection-contract.js` / `config/injection-contract.js` /
  `apps/place/place-data.js`）自 v3.3.1 起**逐字同口径**（强：先看类型），判据见 `tests/system-v313.test.mjs`。
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
- **微信注入补口**：`chat-view.js buildMessagesArray` 在 lonsha recallBlock 之后补 push 装配类 App 的 promptBlock（v2.49 初版只补 dt/cheat 两 App）。
- **v2.50.0 演进为表驱动**：同一注入块重构为 `_injectApps` 表（撩语/金手指/地点/钱袋/档案/剧情线 6 项）+ for 循环统一 push，补齐 v2.46-v2.49 四个新 App 的微信链路（它们此前和撩语当年一样是「孤岛」——只挂主钩子、微信独立路径失效）。取已存在实例不触发懒加载；`promptBlock()` 受各自 `injectToPrompt` 开关控制；空块不 push；try/catch 静默。后续新增装配类 App 只需在表里加一行。
- **门禁**：tests/system-v249.test.mjs 11 项；`npm run check` 287 文件 / 276 测试 / 无新增零消费。

## 微信链路表驱动注入 (chat-view.js buildMessagesArray，v2.50.0)

- **背景**：v2.49 只把 dt/cheat 的 promptBlock 补进微信独立路径；place/wallet/profile/plotline 四个 v2.46-v2.49 新 App 的 promptBlock 仍只挂 `GENERATE_BEFORE_COMBINE_PROMPTS` 主钩子，微信 `buildMessagesArray` 路径完全失效——与撩语 v2.48 前的「孤岛 App」形态一模一样。
- **表驱动重构**：注入块从「逐 App 堆写」改为单一 `_injectApps` 表（6 项：dtApp/cheatApp/placeApp/walletApp/profileApp/plotlineApp，各带 `SYSTEM (名称)` 标签）+ for 循环统一 push。从 `window.VirtualPhone` 取已存在实例（未打开 App 则无实例、不触发懒加载）；`promptBlock()` 受各自 `injectToPrompt` 开关控制、空块不 push、注入失败静默不影响发送。
- **空块契约**：四新 App 纯函数（`scenePromptBlock`/`walletPromptBlock`/`profilePromptBlock`/`plotlinePromptBlock`）对 null 与空对象一律返回空串、不抛，由 v250 B 组逐函数逐入参实测锁定。
- **测试**：v249 E 组演进为表驱动断言（dt/cheat 仍在表 + 位置正确）；v249 G 组版本同源改动态跟随当前版（对齐 v246 模式，不再硬编码版本号）；新增 tests/system-v250.test.mjs（A 表驱动补齐四新 App / B 四纯函数空内容返回空串 / C 版本同源 2.50.0）。
## 群像 App (apps/chars/，v2.51.0)
- **起点**：`snapshot.characters` 是 13 个外供面中唯一的多角色动态状态表（结构 `{角色名: {fields, todos, updatedAt, floor}}`），此前全库零消费。与 `profile`（投影主角单人 `snapshot.protagonist`）互补：profile 管主角、chars 管其他被追踪角色。
- **四件套同构**：`chars-data.js`（`CHARS_REASONS` 五态 / `readCharsFace(probe)` / `projectChars(chars)` 活动度打分排序 / `charsPromptBlock(chars)`）、`chars-app.js`（`CharsApp` 控制器：probeBridge → charsFace → projection → summaryLine → promptBlock → _initHook → onChatChanged → render）、`chars-view.js`（归因卡 + 角色卡列表 + 设置卡）、`chars.css`（主色天空蓝 #38bdf8，`.cs-*` 前缀，合并进 phone.css 尾部）。
- **五态**：ready / empty / no-chars-face（旧版快照无该面）/ no-snapshot / bridge-absent。与 wallet/profile/plotline 同规格（五态），与 place 区分（place 独有第六态 module-absent）。
- **活动度打分**：每角色 score = min(fieldsCount, 5) + min(todosCount * 2, 4)。活跃角色优先展示；空角色沉底。
- **接线**：apps.js 第 37 条目（icon 🎭、color #38bdf8）；storage `/^chars_/`；index.js 路由分支在 plotline 后（懒加载单例）；三处 onChatChanged（换会话/clearCurrentData/clearAllData）；微信 `_injectApps` 表第 7 项 `{app:_vp.charsApp, name:'SYSTEM (群像)'}`。
- **纯函数契约**：`charsPromptBlock(null)` 和 `charsPromptBlock({})` 均返回 `''`（空注入不产生无意义 SYSTEM 消息）。v251 B 组逐态逐入参实测锁定。
- **测试**：tests/system-v251.test.mjs（A 四件套+注册 37 条目 / B 内核纯函数五态+排序+注入块 / C 微信注入表+三处 onChatChanged / D 版本同源 2.51.0）。
## 时计 App (apps/clock/，v2.52.0)
- **起点**：`snapshot.clock` 是 GameClock.export() 的结构化输出（日期/时段/精确度/楼层/闪回/时间标签统计/世界钟对读/锚点），此前全库零消费。用户不具体感到剧情时间推进——本版补上可视化面板。
- **四件套**：`clock-data.js`（五态归因 + 投影 + promptBlock）/ `clock-app.js`（控制器）/ `clock-view.js`（归因卡 + 时间卡 + 诊断卡 + 设置卡）/ `clock.css`（主色蓝 #60a5fa，`.cl-*` 前缀）。
- **五态**：ready / empty / no-clock-face / no-snapshot / bridge-absent。判定逻辑：有 date 或 label 为非空字符串则 ready，否则 empty。
- **接线**：apps.js 第 38 条目（icon 🕓️、color #60a5fa）；storage `/^clock_/`；index.js 路由分支；三处 onChatChanged；微信 `_injectApps` 表第 8 项。
- **测试**：tests/system-v252.test.mjs（A 四件套+注册 / B 内核纯函数五态+投影+注入块 / C 微信注入+接线 / D 版本同源）。v251 D 组同步改为动态跟随。v224 窗口从 600 扩到 1000。

## v2.53.0 世界账本（Ledger）

- 消费面：`snapshot.worldLedgerRead`（`{ok, reason, describe, shape, gap, opinion, counts, peopleDiff, factsDiff, at}`）
- 内核：`apps/ledger/ledger-data.js`（六态归因 `LEDGER_REASONS` + `projectLedger` + `ledgerPromptBlock`）
- 控制器/视图：`ledger-app.js` / `ledger-view.js`（`.lg-*` 类），主色 `#c084fc`
- 接线：`config/apps.js`（第 39 条）· `config/storage.js`（`/^ledger_/`）· `index.js` 路由 + 三处 onChatChanged · 微信注入表第 9 项
- 测试：`tests/system-v253.test.mjs`（24 用例）

## v2.54.0 世界账本深化

- `projectLedger` 增补 `opinionDetail`（canon/forum/sandbox + verified/rumor/unknown）与 `factsDetail`（shared/worldOnly*/localOnly*，明细前 6 条）
- `ledgerPromptBlock` 增补舆情强度与事实对读两行（差集为空时省略）
- view 增补舆情强度条 + 事实对读明细卡；设置新增 `showDiff`（默认开）
- apps.js 桌面图标去重：tieba 📌 / dirtytalk 💋 / cheat ⚡ / tarot 🃏 / chars 👥
- 测试：`tests/system-v254.test.mjs`（15 用例）
## v2.55.0 懒加载单例重绑单一真源
- 缺陷形态：19 个懒加载单例 App 的 `onChatChanged` 重绑清单在 index.js 中**硬编码重复三份**（换会话 / 清当前数据 / 清全部数据）；每加一个 App 要人手补三处，漏改任一处 = 该 App 在对应路径静默串味（不报错、不崩溃、只错数据）。与 v2.54 修的钩子接线失效同属一类。
- 修法：index.js 顶部新增 `ST_PHONE_REBIND_APP_KEYS`（19 键）+ 函数 `rebindLazyApps()`（逐 App try/catch 容错），三处路径一律只调 `rebindLazyApps()`；index.js 净减 60 行。
- 测试：`tests/system-v255.test.mjs`（13 用例，含「表内 key 必须映射到真实单例构造点」与「旧硬编码清单已清零」两条逆向审计）。历史九套 onChatChanged 接线用例（v223/v224/v246/v247/v248/v249/v251/v252/v253）由「硬编码三处」改判为「表成员 + 三处调用点」。
- 钩子接线全局复核：22 处 `onChatChanged` 定义、`place/cheat/dirtytalk` 走 `onChatChanged`、`health/peek/playbook/memory` 走 `_initHooks`，全部挂在真实 `SillyTavern.getContext().eventSource(GENERATE_BEFORE_COMBINE_PROMPTS)`；全仓已无不存在的 `window.ST_API`。
## v2.56.0 注入钩子活性修复 + 序列化器收敛
- 缺陷形态（同一「静默失效」族第三例）：
  1. `playbook-app.js` 的 `_initHooks()` 把 `this._boundGenerationHook = true;` 放在检查 `SillyTavern.getContext()` **之前** —— 构造期宿主未就绪时 guard 已锁死，此后 `render()` 重试也被 `return` 挡掉，注入**永久静默失效**。
  2. `health-app.js` / `peek-app.js` 守卫置位位置正确（在 `if (eventSource && event_types)` 分支内），但**没有任何重试路径** —— 构造期未就绪即永久不挂载。
  三者共同特征：不报错、不崩溃、只失效。
- 修法：playbook 把置位语句移到「两条 `eventSource.on` 都挂载成功之后」；health / peek 在 `render()` 开头幂等重试一次 `_initHooks()`（App 首次被用户打开时宿主必然就绪）。
- 顺带收敛：`stringifyState` / `stringifyValue` 三份逐字相同的就地定义（离线提示词拼装 / 用户态拼装 / 作用域 token 生成）合并为模块级 `stStringifyState` 单一实现，避免三处各自漂移出不一致的 null / undefined / object 处理。
- 测试：`tests/system-v256.test.mjs`（14 用例）：A 钩子活性（置位顺序 / 置位次数 / 置位晚于最后一条 on / 重试路径 / 置位在宿主分支内 / 注入目标为 `payload.prompt` 且不写 `systemMessages`）、B 序列化器单一真源（内联定义清零 / 唯一实现 / 三处引用）、C 版本四源同源。
- 维护惯例落实：`system-v255.test.mjs` 的 C4 由「读当前版本条目」改为**显式锚定 `log.versions['2.55.0']`**，历史套件不再随升版漂移；v254 D1 版本断言改为格式正则 `/^\d+\.\d+\.\d+$/`。
## v2.57.0 记忆洞察（Memory Insights）
- 动机：记忆引擎侧能力远厚于界面 —— `MemoryPool.getSensoryArchive()`（五感归档）与 `getSceneTags()`（场景聚合）在产品代码**全仓零调用**；生命周期四段（active/cooling/frozen/tombstone）、换代压制（superseded，可逆）、回忆权限三级（cite/cautious/associate-only）无任何 UI 落点，视图只显示 4 个计数 + 1 个列表。本版把六面「数据已在内存里、只是没人显示」的读数全部做出界面。
- 新增 `apps/memory/memory-insights.js`（纯函数洞察层，六面投影，三条纪律写进注释：纯函数/时间由参数注入、畸形输入降级不抛、算不出就 0/空不猜）：
  - `senseRows`（消费 getSensoryArchive，空感维不出现、按条数降序）· `sceneRows`（消费 getSceneTags，未标注地点归「未标注地点」不丢数据）
  - `lifecycleRows`（**只调纯读 `lifecycleStage()`，绝不调会墓碑化的 `pruneByLifecycle()`** —— 立「看一眼 vs 改一把」纪律：界面渲染绝不触发巩固管线副作用）· `supersedePairs`（旧↔新配对，压制方不在池如实报 byMissing）
  - `emotionTrace`（按天分桶 arousal/importance 均值，空白天不补零 —— 补零会把「没聊」画成「情绪为零」）· `auditMemory`（七类确定性判据 + 可执行建议）· `insightSummary`
- 重写 `memory-app.js`（49→168）：`insights()` 单一取数出口，六面**逐面独立 try/catch**（任一面失败只空该面、不连坐整页）；`sleepNow()` 巩固唯一入口；`onChatChanged` 重新指向 memoryCore 且不持有数据副本（防缓存陈旧）。
- 重写 `memory-view.js`（136→344）：`MemoryView.TABS` 静态冻结四分页（概览/五感/场景/体检）+ 时间线常驻；条目行新增降温/冻结/墓碑/已换代徽标；检索结果带回忆权限标签；容器级委托 + `_delegated` 幂等标志。
- 踩坑当场抓回：重写视图时 `_esc` 的双引号转义一度退化成「转义成自身」（`" → "`，等于没转，v246 J15 同款缺陷），已修回 `"`，F3 用例立回归锁断言四转义齐备且禁止「引号→引号」形态。
- 测试：`tests/system-v257.test.mjs`（23 用例）：A-E 组**直接 ESM 导入纯内核做真功能测试**（非只 grep 源码），F 组源码不变量锁定（消费闭环 / 六面容错 / 转义 / 分页 / 巩固单一入口 / CSS 落点 / 不缓存副本），G 组版本四源同源。
- 维护惯例落实：`system-v256.test.mjs` 的 C4 同款「读动态当前版本」漂移缺陷，锚定 `log.versions['2.56.0']`（C2/C3 的动态版本断言是「index items 与 update-log 头部同源」检查，升版后两边同升、天然通过，保留不动）。
## v2.58.0 育种推演（Breeding Simulator）
- **动机**：移植上游 `Liuuuu54/st_bs_biotracker` v0.9.9 的异种繁殖算法链，把「自然受精 / 后代核型 / 衍生遗传」三组**只读推演**落到健康 App——纯本地数学、零 LLM、不写状态，与既有 `bio-engine.js`（28 天周期 + 妊娠/产程/种族孕速）同规格。
- **新增 `apps/health/bio-propagation.js`**（468 行纯算法层，`SPERM_DECAY_PER_DAY=10` / `CROSS_RACE_DIFFICULTY_MULTIPLIER=1.5` / `DERIVED_INHERITANCE_THRESHOLD=75`）：
  - `calculateSpermExposure(value, elapsedDays, decayPerDay)` —— 精液衰减，返回**对象** `{startingValue, endingValue, exposureDays, exposureAmountDays}`（非裸数字，读 `.endingValue`）。
  - `calculateFertilizationPreview({spermSources:[{race,value}], ...})` —— 多精源归属概率 / 受孕率（`spermSources` 是**数组**，传裸 `spermValue` 会默认 `[]` 走空）。
  - `calculateOffspringPreview` / `calculateClutchPreview` —— 后代核型 + 卵群规模推演。
  - `calculateDerivedInheritancePreview` —— 12 类衍生类型遗传进度 / 到判定线天数。
  - `calculateImplantationPreview` / `calculateRaceImplantationDays` —— 着床窗口。
- **卵群字典增量缝合**：本地 `RACE_PHYSIOLOGY` 无 `clutchSizeMean` 字段，卵群推演恒退化 1。从远程 v0.9.9 `race_config.js` 移植 `RACE_CLUTCH_SIZE_MEANS`（25 个多产种族 → 过滤为 21 个本地存在种族）注入本文件，`getClutchSizeMeanByRace` 改为**字典优先、回落内置字段**。
- **UI 第 5 页签「育种」**：`health-view.js` 新增 `breedBox`（5 张推演卡：同种后代 / 跨种推演 / 受精窗口 / 着床窗口 / 衍生遗传），`body` 三元加 `tab === "breeding"` 分支，tabs 加育种按钮；`health.css` 补 `.hl-breed-*` + `.hl-tabs { flex-wrap: wrap }`。
- **死导出全真接线**：5 个算法 API（`calculateImplantationPreview` / `calculateRaceImplantationDays` / `getFetusInheritanceTag` / `getDerivedInheritanceSeed` / `DERIVED_TYPE_FLUX_PROFILES+METABOLISM_EXEMPTIONS`）全部接进育种页（着床天数卡 / 核型标签行 / 亲和种子行 / 流变+代谢豁免计数），跨文件消费 241→246，**不走账本豁免**。`MENSTRUAL_STAGE_DAYS` 因被 `calculateRaceImplantationDays` 消费而清理（账本 25→24）。
- **顺带修复既有 bug**：`setHealthTab` 白名单原为 `['cycle','needs','family']`，漏 `medical`——「健康」页签点击被强制回 cycle。补齐为 `['cycle','needs','medical','family','breeding']`。
- **测试**：`tests/system-v258.test.mjs`（167 行，13 用例）——A1-A7 直接 import 纯内核做真功能测试（精液衰减对象结构 / 多精源受精 / 后代核型 / 卵群字典 / 衍生遗传越线 / 混血 / 着床），F1-F5 源码不变量（算法导出 / 字典注入 / 零退化 / 5 页签白名单 / view 消费闭环），G1 版本四源。
- **旧锚点接管**：升版四源（index.js `ST_PHONE_VERSION` + `ST_PHONE_CURRENT_UPDATE` 5 条 / manifest / package.json / update-log 新版本插头部）后，v243 E4 / v244 G4（账本 25→24）、v245 D3/D4（零消费+账本 25→24）、v257 G1/G2（改锚定 `update-log[2.57.0]` 条目，不随升版漂移）。
- **门禁**：全量 2683 pass / 0 真回归（v246 99 pass 确认非回归）；死导出 ✓ 无新增。
- **踩坑**：终端 `node --test` 触发 spawn 隔离建临时目录偶发 `Failed to create directory: Current ROOT unavailable`——解法复制为 `tests/_xxx_run.mjs` 单进程直跑。写入通道对 `"` 实体解码不一致破坏 JS 引号——一律 Python 脚本落盘执行（`ast.parse` 校验）。
## v2.59.0 对弈棋种扩列（Chess + Shogi）
- **动机**：games/board 对弈数据层自 V0.1.0 起移植五子/象棋/斗兽棋，本轮把上游瑟瑟小手机游戏扩展 V0.2.0 的 `ChessEngine` / `ShogiEngine` 两个**自包含引擎**（alpha-beta + 置换表 + 残局搜索，纯 JS 零宿主依赖）纯本地移植接入，对弈棋种 3 → 5。
- **引擎落盘**：从源 JSON 按 `class XXX {` 括号配平切片提取原始字节，前置 header 注释 + `export` 关键字落盘（`chess-engine.js` 18KB / `shogi-engine.js` 19KB），零转录风险。
  - 国际象棋：完整走法（王车易位 / 吃过路兵 / 升变 Q/R/B/N）+ 将军检测 + 三次重复判和，8×8，turn W/B（大写白=用户下方）。
  - 日本将棋：完整走法 + 打步詰 / 二歩禁止 + 成桂（成/不成双选项）+ 落子（drop）+ 千日手判和，9×9，turn S/G，含 `hand` 手牌计数。
- **board-data 类型感知**：`BOARD_GAMES` 3→5；快照/恢复保留 chess `castling`+`enPassantTarget`、shogi `hand`、两者 `positionCount`（判和累计）；`createEngine`/`_applyMove`/`playAi` 按类型路由（升变 `promo` / 成桂 `promote` / 落子 `makeDrop`）；新增 `userColor()` / `shogiHand()` / `legalDrops(pieceKey)`；`legalTargets` 按格子去重（chess 升变多候补同格 / shogi 成桂双选项同格）。
- **board-view 扩渲染**：`CHESS_PIECE`（Unicode ♔♕♖♗♘♙/♚♛♜♝♞♟）+ 深浅棋盘；`SHOGI_LABEL`（王/玉/飞/角/银/桂/香/金/步/龙/马/成银/成桂/成香）；将棋手牌栏（点选手牌→点盘面落子，`.gb-shogi-hand`）；升变/成桂选择条（`.gb-promo`，chess 出 Q/R/B/N、shogi 出 成/不成，单一候选直接走不弹条）；`_pendingPromo`/`_selectedDrop` 两态机。
- **CSS**：`.gb-chs.light/.dark` + `.cpc.white/.black` + `.gb-shg.odd/.even` + `.gb-shogi-hand`/`.gb-hand`/`.gb-hand.em` + `.gb-promo` 系列。
- **踩坑当场抓回**：① 引擎 header 注释里直写 `localStorage / fetch / SillyTavern` 等词，朴素 `includes` 门禁判据误判为「含依赖」——改中性措辞「纯 JS 类，不引用任何浏览器对象/存储/网络 API」（引擎本就零引用，audit「新增模块零外部请求」独立通过）。② 冒烟断言初版把 e1 白王走法写成 2（实为 0，被己方兵/马围死）、b1 马写成 3（实为 2，a3/c3 被兵占）、shogi 手牌 P 写成 9（实为 0，兵全在盘面）——全是断言写错非引擎 bug，探针实测修正。
- **测试**：`tests/system-v259.test.mjs`（16 用例）——A1-A7 两引擎真功能（走法/升变/成桂/二歩/判和），B1-B4 BoardData 集成（5 棋种/快照/手牌/非将棋手牌 null），F1-F4 源码不变量（引擎零宿主依赖 / data 注册+类型路由 / view 消费闭环 / CSS 落点），G1 版本四源动态跟随 + G2 锚定 2.59.0 条目。
- **旧锚点接管**：`system-v258.test.mjs` G1 由「版本四源同源为 2.58.0」（硬编码 index.js 含 2.58.0）改锚定 `update-log.versions['2.58.0']` 条目（不随升版漂移，对齐 v256 C4 / v257 G1 模式）。
- **门禁**：全量 `npm run check` EXIT=0，各套件 0 失败，死导出 24 无新增，audit「新增模块零外部请求」✓。
## v2.60.0 起名台 + 手术库（LA 纯数据模块移植）
- **动机**：把上游 LA-0.7.68 拓展版（单文件 IIFE 大插件，2.9MB content，67 虚拟模块靠 `/* src/xxx.js */` 注释分界、模块间靠 `__LA_XXX__` 全局单例耦合）中**零宿主依赖纯数据**模块解耦移植进 health App。本轮落两块最纯的：人名库 + 手术术式库。
- **解耦手法（可复用）**：① 按 `/* src/xxx.js */` 注释分界定位模块字节边界；② 括号配平切片提取；③ 剥 IIFE 外壳 `(function(){…})();` 与尾部 `if(typeof module…)`/`window.__LA_*__` 导出段；④ 前置 `export` 落盘为 ESM；⑤ 加 service 封装层统一 LA 数据结构差异后接进现有 view。全程 Python 脚本生成（零转录风险），`node --check` 验 ESM 语法。
- **起名台（家谱页签）**：`name-data.js`（NAME_DATA 人名库，chinese/japanese/western 三语言，姓池 499/2925/1557；给名 western/japanese 扁平 `{female,male}`、chinese 嵌套 `{female:{single,double}}`）+ `name-service.js`（`nameLangs/nameStats/generateName`，`_givenPool` 把 chinese nested 展平统一成池）。view 用 `this._nameLang/_nameGender/_lastName` 存 UI 态，不写 storage。
- **手术库（健康页签）**：`surgery-library.js`（SURGERY_LIBRARY 59 术式，ICD 编码/章节/类目/分级1-4/麻醉/恢复期/stages/complications；stages 由 `stageTable(template,mainName,{drop,rename,minutes,add})` 生成）+ `surgery-service.js`（`surgeryChapters/surgeryByChapter/surgeryStats/surgerySummary`）。view 用 `this._surgChapter/_surgOpen` 存章节+展开态，点击条目展开阶段+并发症。
- **死导出治理（关键）**：门禁 `scripts/dead-export-check.mjs` 口径——**tests/ 不算消费，仅 apps/ 产品端消费计**。故 service 导出面必须收紧到恰好被 view 消费的集合，view 不直接调的 API 降级为文件内私有（surgerySearch/surgeryStageMinutes/GRADE_LABELS/SURGERY_CATALOGS 等），否则报零消费新增。LA 源文件里 SURGERY_CATALOGS 只是 2 个标题字符串、非数据本体，直接删。
- **版本四源同源铁律（踩坑）**：旧测试 v255/v256 C3 要求 index.js `ST_PHONE_CURRENT_UPDATE.items` 与 update-log 当前版本条目 items **逐字同源**（C3 判据：index.js items 行须双引号开头 + 含 `。`，rstrip 尾逗号后与 update-log 逐字比对）。升版脚本若两处 items 措辞不一致会触发 13 处「items 未逐字同源」失败——必须从 update-log 反推 index.js 的 items 数组（双引号 JS 字符串）。
- **测试**：`tests/system-v260.test.mjs`（15 用例）—— A 组起名真数据（池规模/三语言/固定姓/50 次稳定）/ B 组手术库真数据（59 条 schema/stageTable 纯函数/章节分组自洽/分级之和）/ F 组不变量（数据零宿主依赖 + LA 血缘注释 + view 消费闭环 + CSS 落点）/ G 组版本锚定（2.60.0 条目记起名+手术 + 2.59.0 历史条目保留）。
- **门禁**：全量 `npm run check` EXIT=0，440 测试 0 失败，死导出 24 无新增。
## LA-0.7.68 剩余模块解耦面评估（已侦察未移植，v2.60.0 结论）
- **判定口径**：本项目移植门槛 = 纯本地 / 零宿主依赖 / 真接线（非登记账本豁免）。达标才搬，否则记录判断依据避免重复评估。
- **已移植（v2.60.0）**：`family/name-data.js`（74KB 纯数据，零依赖）✓ / `medical/surgery-library.js`（80KB 纯数据+纯函数，零依赖）✓。
- **已移植（v2.61.0）——asset 资产经济**：引擎 13 文件已零转录进 `apps/asset/engine/`（IIFE 外层只套 module/require/window=undefined）。本版补 App 层接线（data/app/view/css）与四处注册。与钱袋分工：钱袋显示记忆插件金钱账，资产 App 管理本地角色账本 / 行情 / 投影 / 结算；公开层走 `renderAssetText`，结算走 `planSettlement`，剧情日只认 TimeManager 转 ISO。
- **未移植——批次 C 地图/事件/日程/饮食**：① 各 `*-theme.js` 顶层仅 `const CSS`（纯 CSS 字符串，无逻辑，单独搬无意义）；② `map-core`/`event-core` 顶层是 `_xxxRuntime`+`STATE_KEY/CONFIG_KEY`，耦合 **localStorage 状态机**（非纯数据，搬来要重写持久层）；③ event-core 还依赖 `__LA_ACTOR_DYNAMICS__`（actor-dynamics 模块，又一环）；④ `util/calendar-grid`（7KB）虽可独立但价值极低（仅日历格子辅助）。→ **不搬**。
- **结论（v2.61.0 更正）**：name-data + surgery-library 已在 v2.60.0 以纯数据路径落地；asset 引擎簇随后以零转录 IIFE 包装移植，并在本版接到 App 层。批次 C 地图/事件/日程/饮食仍不达门槛（localStorage 状态机 / 纯 CSS / actor-dynamics 环）。
## v2.61.0 资产 App（引擎接到桌面）
- **动机**：引擎层已锁定，本版把投影 / 结算签名接到 App 层并完成四处注册，推翻 v2.60.0「asset 不搬」旧结论。
- **App 四件套**：`asset-data.js`（纯函数：剧情日转 ISO / 四态归因 / 面板投影 / 公开层注入块 / due→appendFlow）+ `asset-app.js`（store 宿主桥、引导、建条目、结算、行情推进、生成前钩子）+ `asset-view.js`（词从 terms 来）+ `asset.css`（`.as-*`，主色 `#34d399`）。
- **四处注册**：`config/apps.js` 桌面图标 / `index.js` 懒加载单例+`ST_PHONE_REBIND_APP_KEYS` / `config/storage.js` `/^asset_/`+`/^__la_asset_/` / 微信 `_injectApps` / `phone.css` 尾部。
- **测试**：`tests/system-v261.test.mjs`。
