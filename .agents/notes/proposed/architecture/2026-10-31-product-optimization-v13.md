# Agent Note: RubyPhone 第十三期优化提升计划
Status: proposed

> **期号口径**：本份为**第十三期**，编号 `R13-O*`。与记忆侧 `L13-O*`（`lonsha-memory-plugin`）配套共 36 项。
> **为什么跳号不叫 R12**：实测 `grep -rn 'R12'` 在本仓只命中 `docs/runtime-verification-boundary.md:380` 的「**第十二条判据 R12**」——它是挂在 `scripts/upstream-face-audit.mjs` 内的反向面「声明 ↔ 真码」对账判据编号，**不是期号**；另在 `update-log.json` 有 `R12-d` 的本版说明。历史上两仓都因期号与既有判据/模块编号撞车付过代价（记忆侧第十一期改名 L12 即为此故）。故本期**跳过 R12 直接用 R13**，两仓仍保持同期号配套。
> **本轮只制定计划，不代表功能已实施或升版。** 实施前须针对届时代码复算全部读数。
> **纪律**：守卫、审计、台账、发布和纯重构只随功能收口，不独立占 36 项名额。本份 O1 / O7 两项**占用名额的理由**见各自条目的「为什么它占名额而不是配套」段——它们不是新建守卫，而是**已建守卫当前处于假绿状态**，属产品可信度缺口。

---

## 0. 本期不做什么（先说清楚，免得重复开刀）

| 曾经可能的候选 | 裁定 | 依据（可复算） |
|---|---|---|
| 再扫一轮死方法 / 弱档模块 | **不做** | R11-O2/O3 已收口且零新增：`method-consumption-audit` 报死方法 **311 / 基线 311 / 新增 0**、弱档模块 **77 / 基线 77 / 新增 0**；`bind-consumption-audit` 绑定级死 **113 / 基线 113 / 新增 0**；`dead-export-check` 扫 **695 文件 / 4754 导出 / 零消费 81** 且报「无新增零消费导出」。同一刀再开一遍只会改文案。 |
| 把 `orchestrator-only` 65 件一次性接线 | **不做** | `scripts/dead-module-baseline.json` 的 `rule` 逐字写着「只判增量：已建件只有中枢引、或完全孤岛，是存量债（计划 O2 明令不许一次性清零）」。且 65 件多为中枢编排用算法件，硬接会把中枢职责打散。本期只处置 **zero 那 12 件**里产品侧真该有入口的（见 O3）。 |
| 再刷一次 `gate-budget.json` | **不做** | R11-O9 已落：`measured_at` 是 **v4.94.0**，不再是 v3.23.1。 |
| 补图标覆盖 | **不做** | R11-O8 已落：`phone/icons/*.svg` 实测 **90 个**（89 app + 1 文件夹），覆盖率已到 89/89。 |
| 重写 PLAN 全文 | **不做** | 只换挡入口三处（见 O7），历史段一律留存——历史留痕本身是资产。 |

---

## 1. 九个真实现场（本期的立案依据）

### P1 · 真浏览器门是假绿的典型样本（这是本期最贵的一条）

本仓有 `tests/browser/` 一整套：`browser-runner.mjs`（零 npm 依赖，探测 `RUBY_PHONE_CHROMIUM` 与 Playwright 缓存，用 `--dump-dom` 不走 CDP）、`gate.mjs`（三层 fail-closed）、`host-stub.mjs`、`run-scenario.mjs`、`static-server.mjs`、`scenarios/` **37 个文件**。`gate.mjs` 的注释本身写得极好：

- 第 17~19 行：环境层无浏览器 ⇒ 未执行（**exit 2**），不得计通过；结构层场景数/视口数低于下限 ⇒ 拒判（**exit 2**）；读数层任一 FAIL ⇒ exit 1。
- 第 96~100 行：`MIN_SCENES=7` / `MIN_VIEWPORTS=4`，低于下限「属 fail-open，必须拒判」。

但实测三条读数合起来，说明**这门一次都没真跑过**：

1. **没挂进 check 链**。`package.json` 的 `scripts` 全部键里，**没有任何 browser / gate 键**（实测列出：`check` / `syntax` / `test` / `dead-exports` / `lifecycle` / `registry` / `keys` / `source-derivation` / `bridge-contract` / `import-resolve` / `weak-coercion` / `upstream-face` / `doc-path-claim` / `check:file` / `named-import` / `screen-host` / `session-writeback` / `hardlink-safety` / `bind-consuming` / `method-consuming`）。`check` 拼的十八道门里没有它。⇒ **绿是「没跑」，不是「跑了通过」**。
2. **场景内容已过期，真跑必红**。`tests/browser/scenarios/o1-app-enumeration.scen.js:22` 逐字写着：
   `report({ name: 'enumeration-source', ok: ids.length === 83, detail: ...（判据要求 83） });`
   而实测 `APPS.length` = **89**。⇒ 这门**只要真跑就有一条红**。它没红，只能因为它没跑。
3. **覆盖面只有 2/88**。`scenarios/` 37 个文件里 25 个是 `_diag*`，12 个命名场景是 `o1-*` 7 个 / `o6-*` 3 个 / `o7-*` 2 个。按 `apps/<x>` 反查，只覆盖 `apps/calendar`（6 次）与 `apps/clock`（1 次）。**88 个 App 目录里 86 个从没被真排版引擎打开过一次**。而 `docs/runtime-verification-boundary.md` 里 `R-O3` 出现 **26 次**——「归 R-O3」是这份文件里最常出现的句子。

⇒ 这不是「门不够多」，是**门在、但门后面没有人**。而它自己写的 fail-closed 三档，恰好说明作者知道「跑少了也算绿」有多危险——差的那一步是把它接进 `check` 并让它真跑。

### P2 · 撤销面：88 个 App 里 13 个有，75 个是零

实测：`grep -rl 'undo|撤销'` 命中 **336 处 / 13 个 app**；逐 app 统计得 **75 个 app 的 `undo=0`**（`accessdesk` / `accounting` / `achievement` / `affairs` / `album` / `annidate` / `asset` / `avatarframe` / `bilibili` / `block` / `calendar` / `caphealth` / `cardtable` / `chars` …）。同期 `deleteItem|removeItem|clearAll|清空` 命中 **323 处**。

命中的 13 个里还有相当一部分是**棋盘类 AI 的悔棋**（`apps/games/board/` 的 chess / gomoku / jungle / shogi / xiangqi 五个 engine 全在列表里），不是「用户改坏了能回」。⇒ 「可逆」这条产品主轴，在当前代码里**只对棋类成立**。

### P3 · R6 期九件内核：声明「历史已承接」，实测 11/12 在 `apps/` 零引用

`PLAN.md:6` 的表头写「第六期编号（**历史已承接**）」，列出 R6-X1~X9。但 `scripts/dead-module-baseline.json` 的 `zero` 12 件逐项实测产品面引用：

| 模块 | 声明标签 | `apps/` 引用数 | `config/*.js` 字节 |
|---|---|---|---|
| `club-coop` | R6-X3 社团共营 | **0** | 11755 |
| `daily-theater` | R6-X1 共同生活剧场 | **0** | 9519 |
| `mentorship-colearn` | R6-X8 师友共学 | **0** | 3387 |
| `multi-activity-reroute` | （改道多人活动） | **0** | 13076 |
| `mystery-engine` | R6-X6 手机原生推理剧 | **0** | 9134 |
| `parallel-life` | R6-X9 平行人生试玩场 | **0** | 5676 |
| `relation-revisit` | （可重访关系往事） | **0** | 6884 |
| `serial-narrative` | R6-X7 跨媒介连载 | **0** | 5725 |
| `social-ecosystem` | （持续社媒生态） | **0** | 9125 |
| `story-reentry` | （续玩再入场） | **0** | 10044 |
| `time-env` | — | **2**（`apps/memory/memory-data.js` / `apps/settings/settings-app.js`） | 5195 |
| `voice-narrative` | R6-X5 可演出声音叙事 | **0** | 8803 |

对照：`commission-pipeline`（R6-X4 委托创作）**已被** `apps/creationdesk/creationdesk-app.js` 消费——所以不是全军覆没，是**九件里只成了一件**。

⇒ 「历史已承接」这句话，对这批模块**在 `apps/` 层面是不成立的**。它们不是「还没做」，是「做了、进库了、用户碰不到」。这是本期 O3 的立案依据，也是本仓最贵的一类债：**建好的东西没有门**。

### P4 · 时间源分裂：758 处 `Date.now()` + 69 处 `new Date()`，单一 now 源只有 7 个文件在用

实测 `apps/` 下 `Date.now()` **758 处**、`new Date()` **69 处**；而 `config/time-manager.js`（本仓时间单一源）只被 **7 个文件**提及（`config/crossrepo-registry.js` / `config/world-bridge.js` / `config/life-clock.js` / `apps/clock/clock-data.js` / `apps/clock/clock-view.js` / `apps/worldpulse/worldpulse-engine.js` 等）。

对一个「拟真手机」这不是洁癖问题：**同一场雨在天气 App 与朋友圈里必须落在同一时刻**。时间源分裂的直接后果是「照片时间戳与消息时间戳对不上」，而这正是玩家最容易察觉、又最难描述的一类错。

### P5 · 「没有」与「读不出来」同形（分形缺失）

实测空态相关文案命中 **543 处**（仅 `apps/*/*-view.js`），`empty-state|空态|loading` 命中 **147 处**。数量不缺，缺的是**分形**：一个空相册，可能是「真的还没照片」「筛选条件滤空了」「存储读失败」三种完全不同的处境，而界面上它们长得一样。

这条与记忆侧 `L13-O3` 同构（那边是「24 个只读视图零交互 + 无 reason code」），两仓可共用同一套 reason code 词表，但**各写各的实现**，不跨仓共享代码。

### P6 · 设置项生效时机不可知

实测 `立即生效|重启后生效|next-turn` 全仓仅 **3 处**。而 `apps/settings/settings-app.js` 有 **747560 字节 / 11871 行**——本仓第二大文件，全是设置面。⇒ 用户改了一个开关，**不知道它是下一句话生效、还是下一轮生效、还是重开才生效**。这是「不可逆」之外的第二类不确定。

### P7 · 入口陈旧：`TODO.md` 停在 v4.54.0，PLAN 优先级节还是 v3.x 排期且无判据看守

- `TODO.md:1` 逐字：`> **最近更新：v4.54.0**`；`:4` 的「现行产品待办（2026-10-15）」指向**第四期 R4**。当前实际 v4.99.9，**差 45 个版本**。
- `PLAN.md` 顶部仍指向「第九期产品计划（2026-10-24）」，规划基线写 `v4.57.0 / 7ae54a8`（实际 v4.99.9 / `e057a4d`）；「当前优先级」节仍是 v3.x 时代排序。
- 对照记忆侧：那边有 `scan_plan_currency` 看守。本仓**没有同类判据**。
- 已落的一半：`tests/system-v4980.test.mjs` 的 A1 把「现状基线」表的三个读数行与 `tools/gen_plan_baseline.mjs` 逐项比对，A3 有负控制。⇒ **基线表有机器看守了，但入口与优先级节没有**。

### P8 · 巨兽面：三个文件占全仓最大体量，全是用户最高频的界面

`find apps -name '*.js' -printf '%s %p' | sort -rn` 前五：

| 字节 | 文件 |
|---|---|
| 1006838 | `apps/wechat/chat-view.js` |
| 747560 | `apps/settings/settings-app.js` |
| 474619 | `apps/honey/honey-view.js` |
| 311230 | `apps/wechat/wechat-app.js` |
| 255602 | `apps/honey/honey-data.js` |

`chat-view.js` 单文件 **1MB**——它不是「大」，是**一次改动无人能估风险**。这是 O2 与 O8 的施工约束：本期所有涉及聊天流的改动必须走「新增旁路 + 不动原函数体」，不做体内重构。

### P9 · 消费面里 4 件「六面全无」（沿用 R11 已登记读数）

`config/app-consumption-matrix.js` 的 **82 行 × 六条平台级消费面**矩阵里，**4 件**在六面全无，已入「不适用」台账（`tests/system-v3550.test.mjs` 看守）。⇒ 「每个 App 都接进了手机」这句话对 4 个 App 不成立，且这 4 件是**登记过的**、不是漏的。本期 O9 要处理的是：剩下能接的，接上；不能接的，说清为什么。

---

## 2. 九项优化

### R13-O1 · 真浏览器门从「挂不上链」到「真跑一次」（一次真跑，不是再建门）

**为什么它占名额而不是配套**：`gate.mjs` 已经建好、写得比大多数门都严（三层 fail-closed），它不是「缺守卫」而是「守卫没接电」——而这种状态的危害**大于没有守卫**：它让人以为有。这正是本仓文档里反复讲的「看起来没坏但显示不对」的顶层形态。修的是**已建件的失真**，不是新建门。

- **现状**：见 P1 三条读数（无 browser 键 / `ids.length === 83` vs 实测 89 / 覆盖 2 of 88）。
- **路径**（三步，按可独立回滚的顺序）：
  1. **先把过期判据改成机器读数**：`o1-app-enumeration.scen.js:22` 的 `83` 换成从 `config/apps.js` 真读的长度，并补一条「场景断言数 == 真源长度」的自证——让这条判据**不随 app 数漂移**。这一步单独就能让场景在真跑时不红。
  2. **接进链**：新增 `npm run browser`（`node tests/browser/gate.mjs`），并接进 `npm run check` 的**末尾**（不是中间——真跑要几十秒，末尾失败时前面十八道已给出定位）。`gate.mjs` 的三层 fail-closed **一个字不改**。
  3. **真跑一次并留读数**：跑通后把读数落成 `tests/audit/browser_readings.json`（场景数 / 视口数 / 每场景读数条数 / 耗时 / 浏览器版本），并把 `docs/runtime-verification-boundary.md` 顶部那句「**本仓至今没有可运行浏览器的验证环境**」（v3.35.0 起写了二十多个版本）按实测改写。
- **owner 接线点**：`tests/browser/gate.mjs`（不改逻辑，只被调用）· `package.json` `scripts.check`（追加一项）· `tests/browser/scenarios/o1-app-enumeration.scen.js:22`（唯一要改的判据）· `tools/gen_plan_baseline.mjs`（读数进台账）。
- **用户可见入口**：间接——门转绿意味着 89 个 App 的首屏在真排版引擎下**真被打开过一遍**。这是本仓所有「首屏空白 / 返回键失效 / 入口被遮挡」类缺陷的唯一一次真检测。
- **撤销/降级路径**：`browser` 键可单独 `npm run browser`，不跑也不影响其余十八道；`check` 里留逃生口（`SKIP_BROWSER=1 npm run check`），逃生时**在输出里显式打印「浏览器层本次未执行」**——不允许静默跳过（这是 `gate.mjs` 自己那条纪律的同一口径）。
- **定向回归**：`node tests/browser/gate.mjs` 单独跑必须 exit 0 且读数落盘；`SKIP_BROWSER=1 npm run check` 必须打印未执行声明且 exit 0；负控制：把 `APPS` 临时删一条，枚举场景的 `enumeration-source` 必须转红（证明它真在读真源而不是读常量）。
- **验收**：`npm run check` 输出里出现浏览器层读数行；`tests/audit/browser_readings.json` 存在且 `scenes >= 7`、`viewports = 4`；`runtime-verification-boundary.md` 里「没有可运行浏览器的验证环境」这句话**至少有一处**已被实测读数替换。
- **诚实边界**：真跑一次**不等于** 89 个 App 全验通过——本期只保证「枚举面真开一遍 + 首个红点被如实报出」。内容正确性、跨 App 状态一致性仍不在本项射程。若环境里没有可用 Chromium，本项**如实停在「门已接链、跑不起来」**并在边界文档里写清，不假装绿。

### R13-O2 · 撤销面从 13/88 到「分档可声明」

- **现状**：P2 三条读数（336 处 / 13 app 有 / 75 app 零 / 323 处删除类操作）。
- **路径**：不追求 88 个 app 全上 undo——那是不诚实的目标。改做**分档声明**：每个 app 的数据层导出一个 `undoCapability()`，返回三档之一 `{ mode: 'undo' | 'confirm' | 'irreversible', reason }`。`undo` = 有真回退；`confirm` = 不可回退但**必须二次确认**（且确认框要说清丢什么）；`irreversible` = 既不可回退也不确认的**残留**，必须逐条登记进 `tests/audit/undo_gaps.tsv` 并写明为什么。
- **owner 接线点**：各 `apps/*/<app>-data.js`（新导出）· `config/subsystem-orchestrator.js`（汇总读数）· 新建判据 `tests/system-v4xxx.test.mjs`。
- **用户可见入口**：危险操作按钮旁的一句话提示（「此操作不可撤回」/「可撤销」）；`清空` 类操作强制二次确认。
- **撤销/降级**：`undoCapability` 是**声明面**，不影响原操作行为；某 app 声明错可单条改，不改别家。
- **定向回归**：88/88 app 必须都有该导出（缺一个即红）；`undo_gaps.tsv` 的每条必须在同版本可复算；负控制：把某个 `confirm` 档 app 的确认框绕过写一次，判据必须抓到。
- **验收**：`apps/*/` 下 `undoCapability` 覆盖 **88/88**；`irreversible` 残留从「323 处删除操作无说明」降到「逐条有声明的 N 条」。
- **诚实边界**：声明面**不保证**实现正确——`mode: 'undo'` 只保证「有回退入口」，回退后状态是否真回到原样，由 O8 的软删 tombstone 单独证明。

### R13-O3 · R6 期九件内核：接线或退役，二选一（不许挂账第五年）

- **现状**：P3 的表（11/12 在 `apps/` 零引用，九件 R6-X 只成了一件）。
- **路径**：**逐件 A/B 决策**，一件一决策，登记进 `tests/audit/r6_kernel_disposition.tsv`：
  - **A（接线）**：找到该内核能力最自然的既有 app，加一个真入口。优先三件，因为它们的能力**只差一个界面**：`daily-theater`（9519 B，接 `apps/diary` 或新建「一天」页）、`mystery-engine`（9134 B，接 `apps/games`）、`voice-narrative`（8803 B，接 `apps/album` 的音频面）。
  - **B（退役）**：删文件 + 删 `dead-module-baseline.json` 对应条 + 在 `ITERATION_LOG.md` 写明「当年为什么做、为什么不用」。**不许**「留着以后可能用」——那正是这批债的成因。
  - 无论 A/B，`dead-module-baseline.json` 的 `zero` 12 件本期必须**降到 0**（全部有归宿）。
- **owner 接线点**：`scripts/dead-module-baseline.json`（条数变化）· `scripts/method-consumption-audit.mjs`（会报「N 件基线模块已进入产品面」，R11-X4 已验过此路径）· `PLAN.md:6` 那句「历史已承接」（必须按实测改写）。
- **用户可见入口**：A 类件的新界面（三件各一个）。
- **撤销/降级**：B 类删除走 `git revert` 单提交可回；A 类接线若观感不对可撤掉入口，内核留库但不计产品面（此时必须改回 `zero` 并在 tsv 里写明）。
- **定向回归**：`node scripts/method-consumption-audit.mjs` 的 `zero` 必须为 0；每件 A 类必须有浏览器场景覆盖（依赖 O1 已接链）；每件 B 类必须验证「删了没人炸」= `npm run check` 全绿。
- **验收**：`zero` 12 → 0；`PLAN.md` 的「历史已承接」改为按实测的逐件状态；`r6_kernel_disposition.tsv` 12 行全有决策与理由。
- **诚实边界**：本项**不保证** A 类接线后的体验达标——只保证「能力有了门」。观感与可用性归后续期；B 类退役意味着那部分能力**永久放弃**，这是本项要付的代价，须在条目里逐件写明放弃了什么。

### R13-O4 · 时间单一源收口（同一场雨落在同一时刻）

- **现状**：P4（758 + 69 处 vs 单一源 7 个文件）。
- **路径**：分三批，按「用户可感知程度」排，不按文件大小排：
  1. **批次 1（可感知）**：`apps/wechat`（消息时间戳）· `apps/album`（照片时间）· `apps/calendar`（日程）· `apps/diary`（日记日期）· `apps/clock`（已有源）。这五处必须全部走 `config/time-manager.js`。
  2. **批次 2（间感）**：`apps/weibo` / `apps/honey` / `apps/bilibili` 等「带时间流」的 app。
  3. **批次 3（白名单）**：日志、节流、性能采样、UI 动画**允许**裸 `Date.now()`，逐条进白名单并说明理由。
- **owner 接线点**：`config/time-manager.js`（唯一取数口，不改其语义）· 各 app 数据层 · 新增判据守「`apps/` 下裸 `Date.now()` 只允许出现在白名单文件里」。
- **用户可见入口**：同一事件在消息、相册、日程、日记里的时间**对得上**。
- **撤销/降级**：白名单机制保证任何合法用途不被误杀；某 app 若确有独立的「快照时刻」需求，可在白名单里按文件登记。
- **定向回归**：判据读数为「`apps/` 下裸 `Date.now()` 计数」，批次 1 完成后该计数必须**下降一个可复算的量**（本期目标：从 758 起算，具体终点按届时实测写，不预设）；白名单外新增一处即红。
- **验收**：批次 1 五处全部走真源，且有一条端到端判据：造一条消息 + 一张照片 + 一条日程 + 一篇日记（同一时刻），四者读回的 `ts` 必须逐位相等。
- **诚实边界**：本项**不覆盖**「历史数据的旧时间戳」——已存的错时刻不会被修正（那属于数据迁移，不在本期）。只保证新写入一致。

### R13-O5 · 设置项生效时机自证

- **现状**：P6（`settings-app.js` 747560 字节 / 11871 行，而生效时机说明全仓仅 3 处）。
- **路径**：给设置项加 `effect_at` 三档：`immediate`（下一帧可见）/ `next-turn`（下一轮生成生效）/ `next-session`（重开生效）。三档语义**必须由真判据证明**，不许只写文案：
  - `immediate`：改完立即读回必须变。
  - `next-turn`：改完立即读回**必须不变**，走一轮生成后读回必须变（**双向**，只证一半等于没证）。
  - `next-session`：改完立即读回不变，`dispose + 重建` 后读回必须变。
- **owner 接线点**：`apps/settings/settings-app.js`（读 `effect_at` 渲染提示）· 各设置的 `set/get` 口 · 新增判据（按 `effect_at` 分三组）。
- **用户可见入口**：每个开关/滑杆旁的时机提示；`next-session` 档的项在保存后显式提示「重开手机生效」。
- **撤销/降级**：`effect_at` 缺省 `immediate`（当前多数行为的实际语义），未标注的项不报错、只给「时机未声明」的黄标。
- **定向回归**：三档各至少一个真用例且**双向**（该变的变 / 不该变的不变）；负控制：把某 `next-turn` 项改成 `immediate`，其「立即不变」断言必须转红。
- **验收**：`settings-app.js` 里用户可改项**全部**带 `effect_at`（覆盖率 100%，缺一项即红）；「时机未声明」黄标数为 0。
- **诚实边界**：`next-turn` 的「一轮」依赖宿主生成通道，本项在桩宿主下验的是「生成钩子被调过一次」这个**接口事实**，不证明真模型真生效——那仍归 R-O3 家族。

### R13-O6 · 空态与「零条」分形（reason code 面）

- **现状**：P5（543 处空态文案 / 147 处 loading，但三种处境同形）。
- **路径**：所有列表类视图的空态改为**四态 + reason code**：`ok`（有内容）/ `empty`（真的没有，如新手机）/ `blocked`（有但被挡住，如筛选条件、权限、未解锁）/ `absent`（取数面本身不在，如模块未接、存储读失败）。每个非 `ok` 态必须带 `data-face-why="<code>"` 属性，code 取自固定词表（与记忆侧 `L13-O3` **同词表、各仓各实现**）。
- **owner 接线点**：各 `apps/*/<app>-view.js` 的空态渲染点 · 新建 `config/empty-face.js`（词表 + 归一函数，唯一真源）· 新增判据守「非 ok 态必有 reason code」。
- **用户可见入口**：空相册说「还没有照片」；筛选滤空说「当前筛选没有结果，点这里清除」；读失败说「相册打不开（存储读取失败）」。三句话**互不相同**。
- **撤销/降级**：`data-face-why` 是**属性**，不影响渲染；某个 app 未改时按 `absent` 兜底并进「未分形」台账。
- **定向回归**：判据扫所有 `*-view.js`，非 `ok` 空态缺 `data-face-why` 即红；负控制：把 `blocked` 态文案改成与 `empty` 相同，判据须抓到（**判据断言的是「四句话互不相同」，不是「都非空」**——本仓最贵的老账就是两种处置相反的处境长得一模一样）。
- **验收**：88 个 app 的空态分形覆盖率 ≥ 一个明确下限（建议先做 20 个高频 app，其余进台账）；四态文案互不相同有判据。
- **诚实边界**：分形只解决「说清是哪一种」，**不解决**「为什么挡」的深层归因（例如某个 `blocked` 究竟卡在哪一层）。

### R13-O7 · PLAN / TODO 入口交给机器（三处换挡 + 一处判据）

**为什么它占名额**：`tests/system-v4980.test.mjs` 已经证明了「基线表可以交给机器」（A1 比对 + A3 负控制），而**入口与优先级节没有**。当前 `TODO.md` 停在 v4.54.0（差 45 版）、`PLAN.md` 基线写 v4.57.0。这不是「缺守卫」，是**已建机制只盖了三分之一**。

- **现状**：P7 四条读数。
- **路径**：
  1. 三处换挡：`PLAN.md` 顶部入口（第九期 → 第十三期）· `PLAN.md`「当前优先级」节（v3.x 排序 → R13 排序）· `TODO.md:1` 的「最近更新」（v4.54.0 → 当期）。
  2. 一处判据：把 `tools/gen_plan_baseline.mjs` 的射程从「基线表三行」**扩到这三处**——顶部入口里的期号与日期、优先级节里的编号集合、`TODO.md` 的版本号，全部与真源比对。
  3. 负控制：篡改任一处即红（三种破坏各一条）。
- **owner 接线点**：`tools/gen_plan_baseline.mjs`（扩射程）· `tests/system-vxxxx.test.mjs`（A 组追加）· `PLAN.md` / `TODO.md`（换挡）。
- **用户可见入口**：无（维护面）。
- **撤销/降级**：判据可按「只报不红」起一段时间（先观测），确认无假红后再转硬红——**但必须在条目里写明何时转硬红**，否则就是永久软门。
- **定向回归**：三种破坏（改期号 / 删一个编号 / 改 TODO 版本）各转红一次；原件对照必须绿。
- **验收**：`node tools/gen_plan_baseline.mjs --check` 覆盖三处；`TODO.md` 的「最近更新」与 `update-log.json` 的 latest 相等。
- **诚实边界**：本项只守**入口与数字**，不守「优先级节里排的顺序是否合理」——排序判断永远是人做的。

### R13-O8 · 删除留痕与回收站（软删 tombstone）

- **现状**：P2 的 323 处删除类操作里，`clearAll|清空` 类操作**多数是硬删**；且回收站/恢复相关命中 37 个文件，但分散在各 app 自建（`apps/album`、`apps/calendar`、`apps/diary` 各有一套），**不是同一套语义**。
- **路径**：新建 `config/recycle-bin.js` 作为**唯一软删实现**，供各 app 调用；`清空` 改为两段（先进回收站 → 再真清）。回收站记录 `{ id, app, kind, deletedAt, payload }`，`restore(id)` 后 **id 原样回来**（不是重建新 id）。
- **owner 接线点**：`config/storage.js`（落盘口）· 各 app 数据层的删除函数 · 「回收站」页（新建或在 `apps/settings` 里加分区）· 新增判据。
- **用户可见入口**：设置里的「回收站」分区（按 app 分组、带删除时间、可逐条恢复、可清空）；危险删除按钮旁提示「已移入回收站」。
- **撤销/降级**：回收站不改变既有 `of()` / `list()` 的默认行为（默认**不返回**已删项），这样既有调用方零改动；`recycle-bin` 若出问题可通过开关关闭，关闭后删除退回硬删（行为与今天一致）。
- **定向回归**：删一条 → 列表里没有 → 回收站里有 → `restore` → 列表里有且 **id 逐字相同**；`清空回收站` 前必须二次确认；负控制：把 `restore` 改成重建新 id，判据须转红。
- **验收**：回收站可恢复的 app 数 ≥ 一个下限（建议先做 10 个高频 app）；`of()` 默认行为**逐字不变**（有判据钉住）。
- **诚实边界**：软删的 payload 落在本地存储，**占空间**；不提供跨设备同步，也不承诺在宿主清缓存后仍在。这是刻意取舍：宁可丢了也别假装能恢复。

### R13-O9 · 六面全无的 4 件 App 逐件结案

- **现状**：P9（`config/app-consumption-matrix.js` 里 4 件六面全无，已入「不适用」台账）。
- **路径**：逐件判定「能接但没接」还是「确实不该接」：
  - 能接的：接一面（哪怕只接「系统通知」或「全局搜索」），然后从「不适用」台账移出，进入 product 面。
  - 不该接的：在台账里把 `why` 从「不适用」改成**具体理由**（如「本 App 是纯设置页，无内容可被搜索」），并让判据要求 `why` 非空且长度 ≥ 一个下限（防「不适用」三个字当理由）。
- **owner 接线点**：`config/app-consumption-matrix.js`（真源）· `tests/system-v3550.test.mjs`（判据）· 对应 app 的消费点。
- **用户可见入口**：被接上的 app 出现在全局搜索/通知里。
- **撤销/降级**：接线是**新增**消费点，不动既有面；某件判定错可单条改回并重登台账。
- **定向回归**：矩阵里「六面全无且 why 为『不适用』」的条数必须 = 0；负控制：把某条 `why` 改成「不适用」，判据须转红。
- **验收**：4 件全部有归宿（接上或 reasoned-out），「不适用」占位理由清零。
- **诚实边界**：接上一面**不证明**那一面在真机好用（通知是否真弹、搜索是否真命中），仍归 R-O3 家族。

---

## 3. 交付顺序

```
先让门有电（O1 + O7）
  └ O1 真跑一次 → 才有资格谈「88 个 app 里哪些坏了」
  └ O7 入口换挡 → 后续每项的「已完成」才有地方落
再收存量债（O3 + O9）
  └ O3 决定 12 件零入度件的生死（这决定 X 面还能不能开出新东西）
  └ O9 决定 4 件六面全无件的归宿
再开用户的手（O8 → O2）
  └ O8 先给「删了能回来」，O2 才谈「改错了能退回」
  └ 顺序不能反：回收站是安全网，撤销是操作面
再统一口径（O4 + O5 + O6）
  └ O4 时间 / O5 生效时机 / O6 空态分形，三件都是「同一件事只有一个说法」
```

**排序理由（尤其是「为什么不是反过来」）**：

- **O2 必须排在 O8 之后**：给「改错能撤销」却不给「删了能回来」是自相矛盾的——用户最贵的操作是删除，不是修改。安全网先于操作面。
- **O3 必须排在 O1 之后**：A 类接线**必须**有浏览器场景背书，否则接进去的东西又变成「用户碰不到」——只是换了个位置碰不到。这条是本仓 P3 教训的直接推论。
- **O7 排在第二**：不是因为它重要，是因为它最便宜（半天量级），且后面每项都要往 PLAN/TODO 里记进度。晚做等于九项进度都得手抄。

---

## 4. Alternatives considered

| 方案 | 为什么不选 |
|---|---|
| 先把 65 件 `orchestrator-only` 全接上 | 违反 `dead-module-baseline.json` 的 `rule`（明令不许一次性清零）；且中枢件的职责就是被中枢调，接进 app 会把编排逻辑打散成 65 份。 |
| 直接删掉 12 件零入度模块 | 其中 3 件（`daily-theater` / `mystery-engine` / `voice-narrative`）能力完整、字节数 8.8K~9.5K，只差一个界面。全删等于把第六期真做出来的东西扔掉。 |
| 把 `gate.mjs` 重写成 CDP 版本 | 现版本刻意用 `--dump-dom` 就是为了**零 npm 依赖**（本仓是零依赖仓）。换 CDP 会引入 Playwright 依赖，让整个仓库的门禁在别人机器上装不起来。 |
| 撤销面直接上「全局撤销栈」 | 跨 app 的全局撤销语义无法定义（撤销「发了一条消息」是否要撤回对方已读？）。分档声明是本仓能诚实做到的上限。 |
| 时间源一次性全量收敛 758 处 | 单次改动面过大，`chat-view.js` 1MB 的风险无法评估（P8）。分批 + 白名单是唯一可控路径。 |
| 把 O1 降级成「配套」，不占名额 | 那么它就永远不会做——它已经以「配套」状态存在了二十多个版本，而 `runtime-verification-boundary.md` 里 R-O3 累计点名 26 次。占名额是**逼它还债**的唯一手段。 |

---

## 5. Acceptance criteria

1. `npm run check` 包含浏览器层且**真跑过**，`tests/audit/browser_readings.json` 存在；`runtime-verification-boundary.md` 里「本仓至今没有可运行浏览器的验证环境」至少一处被实测替换。
2. `apps/*/` 的 `undoCapability` 覆盖 **88/88**；`tests/audit/undo_gaps.tsv` 每行可复算。
3. `dead-module-baseline.json` 的 `zero` 从 **12 → 0**，`r6_kernel_disposition.tsv` 12 行全有 A/B 决策。
4. `apps/` 下裸 `Date.now()` 计数从 **758** 下降（终点按届时实测写，不预设），白名单外新增一处即红。
5. 设置项 `effect_at` 覆盖率 **100%**，三档各有一条**双向**判据。
6. 空态四态分形覆盖 ≥ 20 个高频 app，四态文案互不相同有判据。
7. `gen_plan_baseline.mjs --check` 覆盖 PLAN 入口 / 优先级节 / TODO 版本三处，三种破坏各转红一次。
8. 回收站可恢复 app ≥ 10，`restore` 后 id 逐字相同，`of()` 默认行为判据不变。
9. 「六面全无 + why 为『不适用』」条数 = 0。

**全期共同验收**：`npm run check` 十八（+1）道门全绿；`node --test tests/*.test.mjs` 从 **355** 套件起只增不减；`update-log.json` / `package.json` / `manifest.json` 三处版本号同源；`tools/gen_status_ledger.mjs --check` 一致。

---

## 6. Risks

| 风险 | 应对 |
|---|---|
| O1 真跑时炸出一堆既有缺陷，超出本期容量 | 这正是它的价值。读数落盘后**分类登记**，本期只修「首屏打不开 / 返回键失效 / 宽度为零」三类**功能级**缺陷，观感类全部登记不修。 |
| O3 的 B 类退役删错东西 | B 类一律单文件单提交，`npm run check` 全绿才落；删前用 `git log --all -- <file>` 确认无需要回溯的现场。 |
| O4 时间源收敛误杀合法用途 | 白名单机制 + 分批交付，每批单独可回滚；批次 1 只动 5 个 app。 |
| O8 回收站占满本地存储 | 回收站设上限（条数 + 字节），超限时**提示用户**而不是静默淘汰（静默淘汰 = 假的可恢复）。 |
| `chat-view.js` 1MB 在 O2/O8 中被误改 | 两项都走「新增旁路，不改原函数体」；改动前 `wc -c` 记录基线，超出预期增量即停手。 |
| 判据本身假绿（本期最强风险） | 每条新判据必须配**真源码破坏 + 原件对照**的负控制（本仓既有纪律）；负控制禁写恒假断言（本仓曾踩过：`false === true` 是另写一份模拟判据）。 |
| O1 把 `check` 变慢，导致日常不跑 | 逃生口 `SKIP_BROWSER=1` 保留，但**必须打印未执行声明**；同时把浏览器层排在链末，前面十八道先给出定位。 |

---

## 7. 本份自身的诚实边界

- 以上**全部读数为 2026-10-31 实测**（`v4.99.9 / e057a4d`）。实施前须复算；文中标注「按届时实测写」的数字**不许照抄**。
- 本份**只制定计划**，不代表任何一项已实施或已升版。
- 本份不覆盖 `R-O3` 的核心部分——那是记忆侧 `L13-O1` 与本侧 O1 共同的母题，但**两侧的真宿主不是同一个**（记忆侧是 SillyTavern，本侧是浏览器）。本侧 O1 若跑通，也只能消掉 `runtime-verification-boundary.md` 里那 26 处 R-O3 中的一部分（静态排版与交互类），**涉及真模型/真存储的部分仍挂着**。
- 本份**没有**逐条读 `tests/browser/scenarios/` 下 25 个 `_diag*` 文件的正文（只读了 `o1-app-enumeration` 一个）。它们是否已被取代、是否仍该留在仓里，属 O1 实施时的附带侦察项，本份不下结论。
