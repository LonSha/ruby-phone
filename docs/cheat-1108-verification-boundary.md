# 金手指「1108 扩库」运行时验证边界

本文件记录 `scripts/merge-cheats-1108.mjs` / `tests/cheat-1108.test.mjs` 这一批**数据批次增强**的验证边界，按项目纪律显式写清「量到了什么」与「**不能保证**什么」，避免把静态读数包装成真机验收。

## 量到了什么（静态扫描面 + 纯函数接线）

- 静态扫描面：`data/cheats.js` 与 `data/cheat-index.js` 回读同源，203 包逐字段一致；旧 166 包对 `tests/audit/cheat-packs-before-v3160.json` 的 165 条 md5 全部仍成立；新增 37 包对 `tests/audit/cheat-packs-1108.json` 逐条 md5 与六元数据一致。
- 纯函数接线：`cheatGachaItems()` 产出 203 个 `cheat_<packId>` item、`cheatGachaPool()` 仍为独立 `pool_cheat`（不进「全部」混杂池）；`searchCheats` / `getCheatById` / `cheatsGroupedByQuality` / `sanitizeInstalled` / `buildCheatPromptBlock` 对新 id 的命中与**未知 id 如实丢弃**均在 Node 测试进程内跑通。
- 负控制：把台账任一条 md5 改成假账，同一断言必转红；删掉唯一真实 id 后注入块不得凭空出现任何外挂正文。负控制在**内存态**完成，不改写真源、不碰 `cleanOnExit` 附件。
- 可复现：`node scripts/merge-cheats-1108.mjs` 幂等重跑不会重排 id，也不新增第二批重复包。

## 不能保证什么（**无真机**）

- 本环境**无真机**、无真实 SillyTavern 宿主、无真实生成模型。判据跑的是 Node 侧静态数据与纯函数，**不能保证**浏览器里金手指 App 的 DOM 渲染、滚动、点击装配、悬浮入口、手机视口适配，也**不能保证** `tests/browser/` 下桌面/手机场景与多视口表现。
- **不能保证**真实宿主的 `eventSource` 生成前钩子、提示词注入顺序、模型对 45,736 字「漫漫长路」等长正文的读取与遵循；这里只证明注入块**真带原文**，不证明模型照做。
- **不能保证**幸运转盘在真实存档里的旧 `cheat_ch001`–`cheat_ch166` item 与新增 `cheat_ch167`–`cheat_ch203` item 的权重/库存/回滚行为：静态层只守住 id 不重排、不删除，动态抽卡、装配持久化与跨会话隔离需真机试用。
- **不能保证**四份世界书附件与上游 `feiluoze/wanjie-wuku` 未来版本的继续一致性；本轮只按作者本次交付的四份 JSON 逐字内置，上游仅作原文对照，不自动追新。
- 读数只对**仓内已落盘的静态事实源**与**纯函数接线**一言；对真宿主里动态拼串、运行时注册、AI 语义理解与玩家实际手感，本判据一言未发。

## 与在途版本的关系

本批是数据增强，**不抬主版本**、不占 `system-vNNNN` 判据指纹、不写 `update-log.json` / `manifest.json` / `index.js` / `ITERATION_LOG.md` / `docs/runtime-verification-boundary.md` 等 R21-O9 在途六源；边界独立留在本文件，由 `tests/cheat-1108.test.mjs` 的 E 组常驻判据守住，不许为了「全绿」删掉本节。

## 明确排除项（不假删、不假并）

1013 附件里 6 条 `熟练度状态栏·` / `人生模拟·` / `文明之光系统·` 子条，其主包 `ch026` / `ch043` / `ch067` 已被 v3.16.0 台账逐字冻结。本轮**如实排除并留清单**，不为「附件全用上」的读数好看而改旧包正文；如需家族补全，应另开一版并同步刷新冻结台账与历史判据口径。