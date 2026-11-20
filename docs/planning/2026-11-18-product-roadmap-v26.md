# 第二十六期路线图 · RubyPhone（R26-O1~O9 / R26-X1~X9）

> **状态：排队中，非现行排序。** 现行是第二十四期；第二十五期见 `docs/planning/2026-11-18-product-roadmap-v25.md`。
> 本期是「超大更新到 26」的后半。**它建立在 R25 拆骨完成之上**——单体没拆开就做本期，等于在流沙上盖楼。

## 0. 本期判断：从「能跑」到「能移交」

R21~R25 做完之后，这台手机具备了整机能力、也有了失败面。剩下的问题换了一种：

> **别人接手时，怎么知道这台手机有什么、坏在哪、能不能带走。**

三个具体证据面：

1. **能力清单不可枚举**：101 个 `apps/` 目录 + 345 个 `config/` 模块，没有任何一处能回答「本机有哪些能力、谁是 dormant」。R23 的 `config/v23-trace.js` 九座是**追踪**不是**清单**。
2. **改动无法回归**：`config/boot-timing.js` 能测启动，但没有「这一版比上一版慢了多少」的预算基线。
3. **数据搬走之后是半条命**：R24-X4 做导出/导入，但快照、回滚、跨插件互通都还没有。

本期九项优化 + 九项拓展都落在这三件事上。状态标记沿用 R25：`【实读】` / `【待复核】`。

## 1. 优化九项（R26-O1~O9）

| 编号 | 项 | 为什么它是最缺的（带状态） | 验收口径 |
|---|---|---|---|
| O1 | 首屏可交互预算 | R25-O4 给的是**读数**，不是**预算**；没有阈值就没有回归 `【待复核】` | 给出预算值；超预算时给出「超了哪一段」；连续三版趋势可看 |
| O2 | 依赖与包体瘦身 | R25-O1 拆完单体后，依赖关系才第一次看得清；现在无人知道哪些模块只被测试引用 `【待复核】` | 输出「只被测试引用」清单并逐条处置；处置后全门绿 |
| O3 | 内存压力与回收阈值 | 与 R24-X8 的生命周期四态联动，但阈值与回收顺序未定 `【待复核】` | 阈值可配；触发回收有回执；草稿永不自动回收（可复跑） |
| O4 | 日志分级与采样 | 现有输出无级别、无采样，出问题只能翻全量 `【待复核】` | 四级（error/warn/info/debug）+ 采样率可调；error 永不采样 |
| O5 | 默认值单一真源 | 同一默认值在多处各写一遍，改一处忘一处 `【待复核】` | 默认值只有一处声明；界面显示值与声明值逐项一致 |
| O6 | 数据迁移兼容矩阵 | `config/storage.js` 有 schema v2 与迁移台账 `【实读】`，但**哪版数据能升到哪版**没有矩阵 | 矩阵逐格有测试；不可升的组合**明确拒载**而不是静默降级 |
| O7 | 多语言全量落地与缺键面 | 依赖 R24-X6 的两语言包；缺键目前在运行时才暴露 `【待复核】` | 两包键集合相等；缺键面能看到「哪个 App 缺哪个键」 |
| O8 | 主题包全量接线收尾 | R24-O4 让令牌生效，但每 App 的私有色板仍硬编码 `【待复核】` | 换主题后全 App 观感一致；私有硬编码逐条清零 |
| O9 | 能力清单自生成 | 与 §0 证据面 1 对应：清单必须**从代码生成**，不许手抄 | 一条命令生成「本机能力清单」，含 dormant 与理由；手抄版删除 |

## 2. 拓展九项（R26-X1~X9）

| 编号 | 项 | 为什么它是最缺的 | 验收口径 |
|---|---|---|---|
| X1 | 整机快照与多版本回滚 | 有导出/导入（R24-X4），但没有「先存一份、坏了退回上一份」 | 快照自动+手动；回滚后逐字段与快照一致；回滚本身可再回滚 |
| X2 | 与记忆插件互操作 | 手机里的记忆与 `lonsha-memory-plugin` 是两套世界，同一个角色两边记的不一样 | 一条消息在两边都能查到；差异可列出（**不静默覆盖**） |
| X3 | 关系与时间线可视化 | 有联系人、有聊天、有关系读数，但没有一张图能看「谁和谁什么时候变的」 | 时间轴可拖、可筛、可点到具体消息；无数据时显示「还没有」而非空图 |
| X4 | App 清单模板 | R24-X3 打通第三方装载后，缺「装什么」的分发面 | 模板可导入导出、可校验；装失败给出原因而非静默 |
| X5 | 朗读与语音 | 全程纯视觉；宿主有 TTS 能力但未接 | 消息可朗读、可停止；无 TTS 时 `absent` 而非假装成功 |
| X6 | 数据健康看板 | 用户看得见聊天，看不见「我的手机数据健康吗」 | 一眼看出占用、异常增长、损坏项；每项可点进去处理 |
| X7 | 剪贴板与拖放 | 跨 App 搬内容只能靠重打 | 支持应用内拖放与剪贴板互转；类型不符给出可读拒绝理由 |
| X8 | 通知中心深化 | 有通知与分级（R24/R25），但无分组、批量处理、摘要 | 同源通知自动分组；批量已读/清除；每日摘要可关 |
| X9 | 系统更新语义 | 扩展有版本号，但用户侧没有「系统升级」这件事 | 升级有变更说明、迁移步骤、可延后；跨大版本必须先备份（强制） |

## 3. 批次与依赖

- **A 批（度量先立）**：`O1` → `O4` → `O6`（先有预算、日志、迁移矩阵，后面才敢动）
- **B 批（收口 R24/R25 尾巴）**：`O2` / `O3` / `O7` / `O8` / `O9`
- **C 批（可移交）**：`X1` → `X6` → `X9`
- **D 批（互通与可视化）**：`X2` / `X3` / `X7` / `X8`
- **E 批（分发）**：`X4` / `X5`

## 4. 本期纪律

1. **本期的每一项都必须能在「别人刚 clone 下来」的环境里复跑**，不许依赖某台机器的现场状态。
2. **O9 的自生成清单是本期唯一允许的「清单类交付」**，其余各项不许拿清单交差。
3. `X2` 与 lonsha 侧 `L26-X2` 是**同一件事的两端**，两仓必须同轮验收，单边完成不算交付。
## 5. 交付登记（2026-11-20，随第三方小手机缝入推进）

> 口径：只登记**已接线且有判据**的，未开工的照实列在下面第 5.2 节，不许读成「本期已完」。

### 5.1 已交付（24 件）

**第一批（2026-11-19，12 件）**

| 编号 | 交付件 | 判据 | 一句话口径 |
|---|---|---|---|
| O1 | `config/boot-budget.js` | `tests/r26_o1_boot_budget.test.mjs` | 首屏可交互预算；超预算点名「超了哪一段」 |
| O1b | `config/boot-fallback.js` | `tests/r26_o1b_boot_fallback.test.mjs` | 缝 Dream fish `Promise.race` 兜底；超时一律 `degraded`，绝不判 `ok` |
| **O1c** | `config/compat-shims.js` | `tests/r26_o1c_compat_shims.test.mjs` | 缝雪穗机垫片层：只补缺、不覆盖原生、垫过即 `degraded`、保不住就抛 |
| O4 | `config/log-gate.js` | `tests/r26_o4_log_level.test.mjs` | 四级 + 采样；error 永不采样 |
| O6 | `config/migration-matrix.js` | `tests/r26_o6_migration_matrix.test.mjs` | 迁移兼容矩阵，不可升组合明确拒载 |
| O6b | 同件报数面 | `tests/r26_o6b_migration_counts.test.mjs` | 返回 `{moved, archived, skipped}`；静默改数据即红 |
| O6c | 同件排除面 | `tests/r26_o6c_test_key_skip.test.mjs` | 缝雪穗机 `__migrated`：测试键 `__t` 不许当真数据搬走 |
| X1a | `config/export-redact.js` | `tests/r26_x1a_export_redact.test.mjs` | 缝 Lumière `snapshot()`：backup 留钥 / share 脱敏 / 未知策略拒载；只动副本 |
| X2b | 消费面 | `tests/r26_x2_consume_once.test.mjs` | 缝 myworld `pullViewer()`：读完即标记已消费，防同一投稿进两次剧情 |
| X4b | `config/share-fragment.js` | `tests/r26_x4_share_fragment.test.mjs` | 缝 myworld `shareCode()`：凭证走 URL fragment，不走 query |
| X5 | `config/random-source.js` | `tests/r26_x5_random_source.test.mjs` | 缝 myworld `forceGlitch`：随机面可被外部强制，序列耗尽必抛不许回落原生 |
| X5b | 同件迁移面 | `tests/r26_x5b_random_migration.test.mjs` | `config/` + `index.js` 87 处 `Math.random` 全量迁到 `rand()`；零 import 契约件实名豁免 |

**第二批（2026-11-20，12 件）**

| 编号 | 交付件 | 判据 | 一句话口径 |
|---|---|---|---|
| O2 | `config/dependency-slimming.js` | `tests/r26_o2_dependency_slimming.test.mjs` | 三档处置 `wired`/`exempt`/`remove`——**没有「先放着」**；零未处置才 `ok`，未登记项点名 |
| O3 | `config/memory-reclaim.js` | `tests/r26_o3_memory_reclaim.test.mjs` | 软/硬阈值非法一律抛；草稿层**结构上没有**回收口；字节降序 + id 升序保证可复跑；失败不计 `freedBytes` |
| O5 | `config/default-source.js` | `tests/r26_o5_default_source.test.mjs` | 默认值单一真源：UI 与 `export const DEFAULT_*` 双向对拍；非字面量单列 `nonLiteral`，不许并进 `ok` |
| O7 | `config/i18n-coverage.js` | `tests/r26_o7_i18n_coverage.test.mjs` | 两语言包缺键面：期望键由 `APPS`/`CORE_KEYS` **现算不手抄**；`parity` 双向差集 + `coreGaps` |
| O8 | `config/theme-hardcode.js` | `tests/r26_o8_theme_hardcode.test.mjs` | 主题私有色板清零：只认 hex/rgb/hsl（`var(--token)` 不算）；豁免逐条对拍，未用豁免单列 |
| O9 | `config/capability-manifest.js` | `tests/r26_o9_capability_manifest.test.mjs` | 能力清单自生成：四档 `wired`/`test-only`/`self-only`/`dormant`；`dormant` 必须给理由；点名非 `wired` |
| X1 | `config/version-snapshot.js` | `tests/r26_x1_snapshot_rollback.test.mjs` | 快照 + 多版本回滚：`stableStringify` 键排序、键级 `diffFields`、回滚只复核 `covered` 覆盖过的键 |
| X3 | `config/relation-timeline.js` | `tests/r26_x3_relation_timeline.test.mjs` | 关系时间线：六种事件、时间升序同刻 id 升序、`unanchored`/`truncated` 均为读数；空时间线明说「还没有」 |
| X6 | `config/health-board.js` | `tests/r26_x6_health_board.test.mjs` | 数据健康看板：损坏优先于增长、无基线判 `unknown` 不判 `ok`、增长比 ≤1 直接抛 |
| X7 | `config/clipboard-dnd.js` | `tests/r26_x7_clipboard_dnd.test.mjs` | 剪贴板与拖放：五种载荷、落点白名单四选一、拒绝必带人话理由、空载荷不算搬过去 |
| X8 | `config/notification-digest.js` | `tests/r26_x8_notification_digest.test.mjs` | 通知中心深化：`groupNotifications` 只按 `appId`；批量已读/清除返回**真实** `changed`/`removed`；关闭时返回 `{enabled:false, reason}` |
| X9 | `config/system-update.js` | `tests/r26_x9_system_update.test.mjs` | 系统更新语义：三段数值比版本、跨大版本 `backup` 强制排第一步、未备份直接抛、步骤失败 `break` |

### 5.2 未开工（0 项）

本轮 12 项（O2 / O3 / O5 / O7 / O8 / O9 / X1 / X3 / X6 / X7 / X8 / X9）**全部落地**：均有实现件、均有正反例判据、均已接入 `index.js` 的 `window.VirtualPhone` 与 `_bridgeChecks` 自检总表。

> 但「本期已完」仍不成立：§3 里 `X2`（与 lonsha 侧 `L26-X2` 同轮验收）等**跨仓项**只能等对端，不在本表计数内。

### 5.3 本轮五条实测教训

1. **垫片不是「补上就算好」**：首版 `Promise.allSettled` 垫片用 `Array.from` 兜非可迭代入参，结果 `allSettled(123)` 返回空数组 = 假装「零个任务全成功」。判据 A7 当场抓住，改成按规范 reject。
2. **全量测试不许并行跑读数面**：`node --test` 默认并发，`system-v3204`（worktree 脏读）与 `system-v3730`（台账逐格对账）会互相抢现场状态出 2 条假红；`--test-concurrency=1` 即 1830/1830 全绿。读数面天生要独占现场。此条已**从经验升级为配置**：`package.json` 的 `test` 脚本固定 `--test-concurrency=1`。
3. **方向类判据必须成对写正反例**：`X9` 首版把 `compareVersion(from,to) < 0` 当成「降级」——实际 `< 0` 是 from 更旧即正常升级，方向写反了 5 条判据全红（7/12）。同理 `X1` 的回滚复核把「快照里本没有的面」也算不一致。凡「大/小/新/旧」类断言，正例与反例必须同时存在，否则只是把 bug 写成期望值。
4. **负控制的依赖闭包必须整份拷贝**：`loadMutant` 用 `mkdtemp` 复制被测文件再 `import`，若被测件有静态 import，必须把叶子依赖一起 `copyFileSync` 过去，否则报 `ERR_MODULE_NOT_FOUND`——负控制退化成「加载失败」而不是「判据真红」，看着红其实什么都没测到。本轮 `O7`（漏拷 `num-gate.js`）与 `X3`（补了 `numOrNull` 后漏拷）各踩一次。
5. **长跑假红的真凶可能是别人的僵尸进程**：第二次 `npm run check` 跑到 1800 秒被杀、`ae` 分片红出十几条 `Promise resolution is still pending but the event loop has already resolved`，真因是**上一轮另一个仓（worldaxis）回归留下的三个挂死 node 进程**（其中一个常驻 1.8GB RSS）。`kill -9` 之后同一分片 829 秒全绿。教训：读数面出批量的「事件循环已结束但 promise 未决」时，先看 `ps` 里有没有不属于本仓的残留进程，别急着怀疑自己的代码。
6. **台账数字要一次改到「现值」而不是「上一步的值」**：`system-v327` 的 `files 835→846`，第一轮只改成 846 又红（真值已被后续改动推到 847）；`file_size_ceiling` 也是 389749 之后又到 389762。凡数字类台账，改完必须**立刻重跑该条判据**确认收敛，不能凭推算。
