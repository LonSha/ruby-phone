# Agent Note: RubyPhone 第二十三期优化提升计划 (R23-O1 ~ R23-O9)

Status: proposed
Baseline: v4.157.0 / 7cac358
Date: 2026-11-17
Depends-on: R22-O1~O9（多数未落地，本期首先补账）/ R21-O3 上界判据 / R21-X1 阅读游标 / chat-read-cursor 唯一出口

## Problem

> 读数见 docs/planning/2026-11-17-product-evidence-v23.md（两仓共用一份证据书）。
> 判据/台账是每项默认纪律，不占名额。
> **本期不新增孤岛引擎**：优化九项全部是「已经登记但没收口」的存量账。

1. `apps/wechat/chat-view.js` **19977 行**（v21 立项 19775，已涨 202）。R22-O1 声称已抽渲染内核，实测 `chat-render-core.js` 不存在。⇒ R23-O1
2. `chat-view.js` 仍 **83 处**裸 `Date.now()`，R22-O5 声称已分类收口。⇒ R23-O2
3. `coverage_baseline.totals`：`zero_test_dirs = 10` / `zero_test_files = 115`，R22-O6 声称已补判据。⇒ R23-O3
4. `event_subscribers.json`：`debt = 5` / `zeroUse = 0`，R22-O7 声称已处置。⇒ R23-O4
5. 未读角标仍散在 **3 个文件**，未收成单口径。⇒ R23-O5
6. 微信**无消息全文搜索**（`message-search` 命中 0）。⇒ R23-O6
7. 无障碍面：`aria-label` 43 文件 / `role=` 33 / `tabindex` 13，**无基线读数守着不下滑**。⇒ R23-O7
8. 巨型数据文件：`data/cheats.js` **27612 行**、`data/gacha-items.js` 11926 行。⇒ R23-O8
9. 通知横幅未收成单一出口（`incoming-banner` 仅 1 文件命中，但横幅拼装仍在多处）。⇒ R23-O9

## Proposal

### 批次 A（结构拆解 —— 只搬不改）

### R23-O1 抽 chat-view.js 消息渲染内核

抽到 `apps/wechat/chat-render-core.js`（暂定名）。
**行为等价三条**：① 同一批 fixture 消息，抽前抽后 DOM 结构字符串**零差异**；② 450 套判据全绿；③ 行数上界判据（若已存在）继续绿。
只搬不改，**禁重写**。出现差异 ⇒ 改搬运方式，不许改判据。
- 做到时的证据：快照对拍零差异 + 450 套绿 + 行数下降。
- 没做到时怎么被抓：任一 DOM 结构字符差异。

### R23-O2 裸钟逐处分类收口

83 处逐处标 `wall`（渲染节奏，可保留）或 `story`（内容时间轴，必须走统一剧情钟出口）。
`story` 档改走统一出口；`wall` 档留在 whitelist 并**逐条写理由**。产出「收口进度」机器读数。
判据：分类总数必须等于文件内实测 `Date.now()` 计数（**不许漏项**），且读数从 0 开始单调上升。
- 做到时的证据：分类数 == 实测 `Date.now()` 数。
- 没做到时怎么被抓：出现未分类项 / 漏项。

### 批次 B（单口径收口）

### R23-O5 未读角标单口径

角标数一律取 `chat-read-cursor` 唯一出口，App 层**不许自算**。
判据扫 App 层：出现 `unread` 自算模式即红。
- 做到时的证据：角标全部取单一出口。
- 没做到时怎么被抓：App 层出现自算未读。

### R23-O9 通知横幅单一出口

收成 `incoming-banner` 唯一实现，App 只声明内容（`{title, body, source}`），不各自拼 DOM。
文案唯一实现纪律：同一句人话不在 App 与桥各拼一份。
- 做到时的证据：横幅只此一处实现。
- 没做到时怎么被抓：任一处 App 自拼 DOM。

### R23-O4 事件欠账 5 条处置

逐条真接订阅，或改判为「对外遥测 / 跨仓转交」并**移出 debt**。
禁止「有理由所以一直挂着」——`debt` 数组里留着的每一条都必须有 `resolution` 字段（`wired` 或 `reclassified`），
且 `reclassified` 必须注明去向。
- 做到时的证据：`debt` 每条有 `resolution`。
- 没做到时怎么被抓：仍留无处置理由的挂账。

### 批次 C（玩家可见与会话外欠账）

### R23-O6 微信消息全文搜索

搜索 App 接 wechat 消息源。按**剧情时间**排序、命中高亮、点击跳回原会话并**定位到该条**（复用 `chat-read-cursor` 定位能力）。
三态：`hit` / `empty`（如实说「没有匹配的消息」）/ `unavailable`（消息源读不到）。
**不许把 `unavailable` 说成 `empty`。**
- 做到时的证据：三条状态各自不同形。
- 没做到时怎么被抓：`unavailable` 说成 `empty`。

### R23-O7 无障碍补齐 + 不下滑门

核心可交互面（按钮 / 输入 / 列表项）补 `aria-label` / `role` / `tabindex`，键盘 Tab 可达。
**做成基线读数**：`a11y_baseline.json` 记三项目前文件数（43 / 33 / 13），判据要求**只许升不许降**。
- 做到时的证据：三读数不下滑。
- 没做到时怎么被抓：任一读数回落。

### R23-O3 十个零测试目录补最小判据

`accessdesk / caphealth / cardtable / freehome / lexiscore / mofo / periodmath / playbook / stickerdesk / sullydesk`
逐个至少三条：模块可 import、关键投影函数对、不抛。**不追行数**。
判据读 `coverage_baseline.totals.zero_test_dirs`，必须从 10 降到 0。
- 做到时的证据：`zero_test_dirs === 0`。
- 没做到时怎么被抓：仍为 10。

### R23-O8 数据文件治理

`data/cheats.js` 27612 行 / `data/gacha-items.js` 11926 行。
**数据与代码分离**：大表迁出为 JSON / 分包按需加载，代码侧只留索引与读取入口。
判据：① 单文件行数上界；② 启动路径**全量加载**必须消失（用调用链证明，不是靠 grep 命中）。
- 做到时的证据：启动路径无全量加载（调用链证明）。
- 没做到时怎么被抓：大表仍在启动时整份载入。

## 批次与依赖

```
A: O1 / O2  （拆解 + 收口，最严等价判据）
B: O5 / O9 / O4（单口径与欠账）
C: O6 / O7 / O3 / O8（玩家可见、无障碍、测试、数据治理）
```

A 独立；B 独立；C 的 O6 依赖 O5（角标/定位口径统一后再接搜索跳转）。

## 纪律（默认，不占名额）

- 判据正反两面 + 负控制；负控制必须**真破坏源码**，不是真值表打勾。
- 文案唯一实现；读不到 ≠ 没事；空就是空。
- 台账读数机器生成，不手抄；版本多源同源。
- **关键词命中数不能当判据**（两仓共用本期纪律）：判定「已交付」只认 ① 判据真跑绿 ② 台账真读数 ③ 真调用链。
  本条起因：立项实勘时用 `grep 设置搜索 = 0` 误判 R22-O2 未做，实为同义实现 `config/settings-filter.js#filterSettings`。
  反面同样成立：**grep 命中也不能当「已做」**（注释里写个名字就命中）。
- 发现账实不符**先记账**，不许用一个「补登」把「没做」与「做了」抹平。
- 每项验收语必须写正反两面（见上，每项条目内已带）。