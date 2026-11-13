# Agent Note: RubyPhone 第二十一期优化提升计划 (R21-O1 ~ R21-O9)
Status: proposed
Baseline: v4.140.0 / 827ecdc
Date: 2026-11-11
Depends-on: R13-O4 时间单源 / R18 虚拟化底座 / R17-O2（承诺未兑现）/ v4.140.0 时间轴收口

## Problem（每一条都是本次实勘的机器读数，不是感觉）

> 实勘命令与读数见 `docs/planning/2026-11-11-product-evidence-v21.md`。以下四项为**本仓当前最缺的东西**。

1. **「60fps 虚拟滚动」是承诺，不是实现。** `apps/wechat/chat-view.js` 19775 行，
   在 `smartUpdateMessages`（第 3618–3651 行）里确实调用了 `ui-virtual-list-scroller-60fps`，
   但代码注释自己写着「★ 只做**并行读数**，不改渲染」——`computeVirtualSlice()` 的产物
   只写进 `window.VirtualPhone._chatSliceRead`，**没有任何一条消息气泡因此被虚拟化**。
   R17-O2 验收写的「DOM 恒定在 20 个以内、上千条飞速滑动不卡顿、零白屏」**至今无一条被机器守住**。
   `longlist_scale_baseline.json` 的 `note` 也自认「读数不代表实机渲染耗时」。
   ⇒ **本仓最缺的第一件东西：一个真正做窗口化的渲染通道，加上能证明「DOM 节点数有上界」的判据。**

2. **时间单源欠债还剩 10 个文件 180 处裸 `Date.now()`，其中 6 处属 story 档。**
   `tests/fixtures/bare-now-whitelist.json`（204 条登记）里仍标「批次 2 待收口」的有 10 个文件；
   逐行扫 `timestamp: Date.now()` 形态共 6 处真·内容时间轴：
   `loverspace-app.js:368/378`（问答的 `timestamp`）、`music-app.js:252`、
   `piggy-app.js:140`（`time`）、`chat-view.js:8447/18639`。
   v4.140.0 只收口了 moments 两个引擎，**这批仍在排队**。
   ⇒ **第二件东西：把这 6 处内容时间轴收口，并把「收口进度」做成一列可算的机器读数。**
   （`chat-view.js` 那 85 处绝大多数是渲染节奏属 wall 档，不能一刀切 —— 这正是必须逐处分类的理由。）

3. **`chat-view.js` 19775 行 / `settings-app.js` 12286 行已经是单文件不可维护级。**
   全仓 101 个 app、40.9 万行 JS；10 个文件占了 8.6 万行。
   `apps/wechat/` 一个目录 4.15 万行。这些文件里 8 个已有单测，但**没有一个判据守「单文件行数上界」**，
   于是它们能无限膨胀 —— 这是结构性风险，不是风格问题。
   ⇒ **第三件东西：拆分最钝的三个文件，并把「超大文件不许再长」变成判据。**

4. **「建好没接」的只剩 2 个纯转发层，但「零测试覆盖」的面是黑的。**
   `audit-orphan-modules.mjs` 实测 `DEAD=0 / TESTONLY=0 / FORWARD=2`
   （`apps/games/games-data.js`、`apps/games/games-view.js`）—— 静态接线面已经干净。
   但 431 个测试文件对 101 个 app，覆盖率**从未被机器读过**（`--experimental-test-coverage` 不在门禁里）。
   ⇒ **第四件东西：覆盖率读数进账本，「哪些 app 一行测试都没有」必须能答。**

## Proposal

九项优化 + 九项拓展，全部咬在上述四个缺口上。
纪律沿用本仓既有三条：判据不许恒绿（负控制必须真源码破坏）、读数不许手抄（走 `tools/` 生成）、
文档面不许说谎（未验就标未验）。

### R21-O1 · 真·窗口化消息流渲染通道（把 R17-O2 的承诺兑现）
- **现有底座与差距**：`ui-virtual-list-scroller-60fps.js`（84 行）会算切片，但只出读数不改 DOM。
- **本期交付**：新增 `apps/wechat/chat-view-windowed-stream.js`，接管 `renderMessages` 的
  **尾窗渲染通道**：按 `computeVirtualSlice()` 的 `startIndex/endIndex` 只物化可见区间 +
  上下各 1 屏缓冲，滚出缓冲区的节点移入 `DocumentFragment` 池复用（**不是删了重建**）。
  与既有 `tailWindowOf` 共存：`tailWindowOf` 管「取多少条数据」，本模块管「物化多少节点」，
  两个上界各管一层，不许合并成一个常量。
- **玩家入口**：静默生效；设置面板「⚙ 高级实验室 → 📜 消息流渲染方式」可切「窗口化 / 全量」，
  切全量时如实标注「长会话会变卡」。
- **本地测量与通过标准**：新增 `tests/browser/scenarios/r21-windowed-stream.scen.js`：
  1000 / 3000 条消息，断言**真实 DOM 节点数 ≤ 40**（不是估算、是 `querySelectorAll` 真数）、
  滚动到顶/底/中间三处后仍 ≤ 40、**消息内容与全量模式逐条等价**（防止「省了节点丢了消息」）。
  负控制：把窗口上界改成 `Infinity` ⇒ 必须红；把缓冲改成 0 ⇒ 必须红（会白屏）。

### R21-O2 · 内容时间轴收口（story 档 6 处）+ 收口进度机器读数
- **现有底座与差距**：`config/time-source.js` 提供 `storyNow / storyNowWallFallback / stampPair`；
  白名单 204 条里 10 个文件仍标「批次 2 待收口」。
- **本期交付**：收口 6 处内容时间轴 —— `loverspace-app.js:368/378`、
  `music-app.js:252`、`piggy-app.js:140`、`chat-view.js:8447/18639`。
  一律走 `storyNowWallFallback`（与 v4.140.0 同口径：这些字段是必填数字、参与排序）。
  其余 174 处 wall 档**不动**（渲染节流/幂等键/真实经过时间，改了反而坏）。
  新增 `tools/gen_time_debt_readings.mjs`：扫白名单里每条理由文本，
  输出「story 档已收口 / story 档待收口 / wall 档合法」三列计数，写进 `tests/audit/time_debt_readings.json`。
- **玩家入口**：无 UI 变化（正确的时间文案本身就是入口）；诊断台新增一行「📅 时间轴收口进度：x/y」。
- **本地测量与通过标准**：判据 `tests/system-v4141.test.mjs`：
  ① 白名单里不存在任何「待收口」字样（欠债清零，登记与实现同源）；
  ② 6 处收口点逐一真跑假宿主（给 UTC 2044 剧情钟）验证落点跟剧情走；
  ③ 负控制：把 `storyNowWallFallback` 换回 `Date.now()` ⇒ 必须红；
  ④ 生成器读数与磁盘扫描逐字一致（防手抄）。

### R21-O3 · 三个巨型文件的按域拆分（带"拆完行为不变"的等价性判据）
- **现有底座与差距**：`chat-view.js` 19775 / `settings-app.js` 12286 / `wechat-app.js` 8613 行。
- **本期交付**：只拆 `chat-view.js` 一个（**不贪多**），按「渲染 / 事件 / 选择与引用 / 数据同步」
  四域拆成 `chat-view.js`（编排壳 ≤ 3000 行）+ `chat-view-render.js` + `chat-view-events.js`
  + `chat-view-selection.js` + `chat-view-sync.js`。**只做移动，不改逻辑**：
  每个导出符号的签名与 `this` 绑定关系逐字不变，用 `tools/relocate_method_baseline` 同族工具
  生成「方法 → 新宿主文件」映射表落盘。
- **玩家入口**：无（纯内部重构）。
- **本地测量与通过标准**：判据 `tests/system-v4120.test.mjs`：
  ① 拆分后 431 个既有测试**一条都不许改**且全绿（等价性的最强证据）；
  ② 映射表里每个方法在目标文件恰存在一次（防「拆丢了」）；
  ③ `chat-view.js` 行数 ≤ 3000 且**下界 > 800**（防「拆成空壳换个名字过关」——
     这是本仓 15 簇副本账教过的：只断上界是假绿）；
  ④ 负控制：故意删掉 `chat-view-sync.js` 里一个方法 ⇒ ①必须红。

### R21-O4 · 覆盖率读数进账本（"哪些 app 一行测试都没有"必须能答）
- **现有底座与差距**：431 个测试文件，`package.json` 的 19 门里**没有覆盖率门**；从未读过。
- **本期交付**：新增 `scripts/coverage-report.mjs`（`node --experimental-test-coverage` +
  解析 `--test-reporter=spec` 的 coverage 段，落盘 `tests/audit/coverage_baseline.json`），
  输出三列：每个 app 目录的 `line%` / `有测试的文件数` / `零测试文件数`。
  门禁口径**只做"不许退步"**（新增硬下限会立刻变恒红）：新增读数不许比 baseline 低超过 0.5pp，
  且「零测试 app 目录数」不许增加。
- **玩家入口**：无 UI；`TODO.md` 里新增一节「覆盖率欠账清单」由生成器写，不手抄。
- **本地测量与通过标准**：判据 `tests/system-v4130.test.mjs`：
  ① 读数与真跑 `--experimental-test-coverage` 输出逐字一致；
  ② 负控制：把 baseline 人为抬高 10pp ⇒ 必须红；把某 app 目录从读数里删掉 ⇒ 必须红
     （防「漏算的目录等于 100%」）；
  ③ 诚实边界写在读数文件 `note` 里：Node coverage 不覆盖浏览器层，浏览器侧归 `tests/browser/`。

### R21-O5 · 玩家可见时间文案的「双钟并显」统一口径
- **现有底座与差距**：`FIELD_CLOCKS` 把字段分成 story / wall 两档，但**用户看到的文案**
  没有统一规则 —— 有的地方显示剧情日期，有的显示「3 分钟前」（墙钟相对量），
  剧情回拨后两者会互相矛盾（记忆里 11 月 10 日，气泡显示「刚刚」）。
- **本期交付**：新增 `config/time-caption.js`（无业务层依赖，复用 time-source 与 num-gate）：
  `captionOf(field, value, ctx)` 按 `fieldClockOf(field)` 分派 —— story 档出剧情日期，
  wall 档出相对量，**跨档比较时显式拒答并给 `cross-clock` 原因码**（不许硬算出一个看起来合理的差值）。
  只接 3 个位置（朋友圈 / 微信气泡 / 日记行），**不铺全仓**。
- **玩家入口**：时间文案统一；剧情回拨后不再出现「11月10日 · 刚刚」这种自相矛盾。
- **本地测量与通过标准**：判据 `tests/system-v4142.test.mjs`：
  ① 剧情钟与墙钟差 2 年时，story 档文案只出剧情日期、不出相对量；
  ② `cross-clock` 三态可判（拒答时给原因码，不返回空串）；
  ③ 负控制：让 `captionOf` 在跨档时强行算差值 ⇒ 必须红。

- **实施事实（v4.142.0）**：三处接线只消费记录自身 face，拒绝用当前剧情钟冒充历史；微信常规分隔符与手工标记同源。定点七条通过含真源码负控制，未做酒馆实机验收。
- **取舍**：当前剧情 face 易取得但会让历史随回拨改写，故不用；只有 timestamp 而无剧情文案的旧记录占位，不猜历法。规格原判据名 v4140 已被旧版占用，改用 v4142。

### R21-O6 · 长会话内存增长的跨轮趋势门（把 baseline 变成门）
- **现有底座与差距**：`memory_growth_baseline.json` 实测 8 轮 heap 4362→4378 KB，
  `note` 自认「单点仍不可判泄漏，只判**跨轮趋势**」——但**没有任何门在读这个读数**。
- **本期交付**：把 `memory_growth_probe.cjs` 接进 `npm run check`：
  断言 `heap_tail_growth_kb ≤ 8`（当前实测 2）、`heap_total_growth_kb ≤ 64`（当前 16）。
  两个上界都**留 4 倍余量**（这是趋势门不是精确门，环境噪声必须容得下）。
- **玩家入口**：无。
- **本地测量与通过标准**：判据 `tests/system-v4150.test.mjs`：
  ① 真跑探针三次，三次读数都过门（防单次侥幸）；
  ② 负控制：夹具里故意 keep 一个 1MB 数组 ⇒ 必须红；
  ③ 探针自身的 `gc_forced: true` 必须在场（否则读数不可比，判据要拦）。

### R21-O7 · 纯转发层清零（FORWARD=2 的最后两笔）
- **现有底座与差距**：`audit-orphan-modules.mjs` 报 `apps/games/games-data.js` 与
  `apps/games/games-view.js` 是纯转发兼容层。该工具的 `policy` 原文写着
  「delete or replace only after confirming no dynamic constructor path」。
- **本期交付**：先查两文件是否有动态构造路径（`import(` / `require(` 拼串 / 全局名字符串）；
  无 ⇒ 删除并让调用方直连真模块；有 ⇒ 如实登记到 `tests/audit/forward_layer_ledger.json` 并给理由。
  **两条路都算完成**，不许为了「DEAD=0」好看而假删。
- **玩家入口**：无。
- **本地测量与通过标准**：判据 `tests/system-v4160.test.mjs`：
  ① `FORWARD` 分档为 0（删掉）或全部在台账里有理由（留存）——**两态互斥**；
  ② 删掉后游戏大厅真跑冒烟（开大厅 → 进 2048 → 返回）不报错；
  ③ 负控制：把删掉的文件名加回一个 import ⇒ 必须红。

### R21-O8 · 跨 App「同一件事」的实体归并（防一物多账）
- **现有底座与差距**：101 个 app 各自记账。同一件事在 3 个 app 里有 3 个 id
  （例：一次外卖 = `apps/shop` 的 `orderId` + `apps/accounting` 的一条支出 + `apps/delivery` 的 `tripId`）。
  全仓有 `crossapp-transaction-stack.js`，但**没有"这 3 条是同一件事"的归一化面**。
- **本期交付**：新增 `config/entity-link.js`：`linkOf(appId, localId) → {entityId, sources[]}`，
  以「时间窗 + 金额/文本指纹」双向匹配，**只读、不写任何 app 的账**（写归各 owner）。
  输出三态：`linked`（有据同一）/ `ambiguous`（多个候选，列出全部候选不猜）/ `unlinked`。
- **玩家入口**：记账 App 的支出行旁显示「本次关联：外卖 #xxxx / 行程 #yyyy」，可点开对照。
- **本地测量与通过标准**：判据 `tests/system-v4170.test.mjs`：
  ① 三态互斥且 `ambiguous` 必须给候选清单（不许挑一个）；
  ② 只读性：调用前后 3 份账本字节级相同；
  ③ 负控制：把指纹匹配改成"取第一个" ⇒ ⑦必须红。

### R21-O9 · 事件契约的"派发无订阅"收口
- **现有底座与差距**：v4.139.0 补登记了锁屏/解锁/翻扣静音/隐私风险四项 `PHONE_EVENTS`。
  但**反方向没查过**：登记了的事件里，有多少是 `emit` 了却全仓零 `on`？
  （与 "建好没接" 同族，方向相反。）
- **本期交付**：新增 `tools/audit-event-subscribers.mjs` 与读数 `tests/audit/event_subscribers.json`：
  逐事件列 `emit 次数 / on 次数 / 订阅方清单`。`on === 0` 且 `emit > 0` 的进欠账清单。
- **玩家入口**：无。
- **本地测量与通过标准**：判据 `tests/system-v4180.test.mjs`：
  ① 读数与真扫一致；② 每条"零订阅"事件必须在台账里给出「为什么故意没人听」或已被接上；
  ③ 负控制：删掉一个订阅点 ⇒ 读数必须变化（防扫描器恒返回空）。

---

## 批次与依赖

| 批次 | 内容 | 依赖 |
|---|---|---|
| A | R21-O2（时间欠债）→ R21-O5（文案口径） | 无（先做，风险最低、收益最直接） |
| B | R21-O1（窗口化）→ R21-O6（内存趋势门） | O1 会改渲染，O6 才能量得准 |
| C | R21-O4（覆盖率）→ R21-O3（拆巨型文件） | 先有覆盖率，拆完才知道有没有掉 |
| D | R21-O7 / R21-O8 / R21-O9（三笔结构性收尾） | 相互独立 |
| E | R21-X1 / X2 / X5（时间与串联族） | 依赖 O5 的口径 |
| F | R21-X3 / X4 / X6 / X7 / X8 / X9 | 相互独立 |

## 明确不做（如实登记）
- 不重做 chat-view 的**全部** 19775 行（只拆一个文件，其余留观察）。
- 不给 174 处 wall 档 `Date.now()` 做任何改动（改了会坏真实计时/幂等）。
- 不引入任何"精确 Token 预算"宣称（仓内既有口径就是字符预算，不许混说）。
- 不承诺实机 SillyTavern 表现（本环境无真机，边界归 `docs/runtime-verification-boundary.md`）。
