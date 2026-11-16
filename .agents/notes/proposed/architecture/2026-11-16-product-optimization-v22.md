# Agent Note: RubyPhone 第二十二期优化提升计划 (R22-O1 ~ R22-O9)
Status: proposed
Baseline: v4.156.0 / 9a8adcf
Date: 2026-11-16
Depends-on: R21-O3 上界判据 / R21-O2 时间单源 / R21-X1 阅读游标 / R21-O9 事件订阅

## Problem

> 实勘命令与读数见 docs/planning/2026-11-16-product-evidence-v22.md。以下九项为**本仓当前最缺的东西**。
> 判据套件/台账刷新是每项交付的默认纪律，不占本计划的项名额。

1. **chat-view.js 19931 行还在长，R21-O3 只出读数没拆。** v21 立项 19775，现在 19931。
  ⇒ R22-O1
2. **设置页 12317 行零搜索。** grep 设置搜索 = 0。⇒ R22-O2
3. **无障碍面稀薄。** aria-label 30 / role 27 / tabindex 10，101 个 app。⇒ R22-O3
4. **微信无消息全文搜索。** grep message-search = 0。⇒ R22-O4
5. **chat-view.js 仍 82 处裸 Date.now()。** R21-O2 只收 6 处内容轴。⇒ R22-O5
6. **10 个 app 目录零测试。** 115 个零覆盖文件。⇒ R22-O6
7. **事件订阅欠账 5 条。** emit>0 且 on===0。⇒ R22-O7
8. **通知横幅散落。** ⇒ R22-O8
9. **未读角标可能多口径。** 未读判定已收口到 chat-read-cursor，角标绘制未收。⇒ R22-O9

## Proposal

### 批次 A（结构性收尾）
- **R22-O1 拆分 chat-view.js 渲染内核**：把消息渲染/更新逻辑抽成 `apps/wechat/chat-render-core.js`（暂定名），行为等价靠快照对拍（同一批 fixture 消息，抽前抽后 DOM 结构字符串零差异）。拆解只搬不改，禁重写。判据钉：抽出后 chat-view.js 行数下降、新模块被 import、快照零差异、上界门（若已存在）继续绿。
- **R22-O2 设置页即时过滤**：单一搜索框，跨分区过滤标题+条目，命中高亮。空查询全显；无命中如实显示「没有匹配的设置项」。纯前端过滤，不建第二份设置索引。
- **R22-O3 无障碍补齐**：核心交互（按钮/输入/列表项）补 aria-label/role/tabindex，键盘 Tab 可达。做成可数读数（判据读 aria/role/tabindex 覆盖文件数与基线对比不下滑）。

### 批次 B（玩家可见缺口）
- **R22-O4 微信消息搜索**：搜索 App 接 wechat 消息源，按 storyAt 排序、命中高亮、点击跳回原会话并定位到该条。复用 chat-read-cursor 定位能力。
- **R22-O5 chat-view 裸钟分类收口**：82 处逐处标 wall/story，story 档改走统一剧情钟出口，wall 档留原样并在 whitelist 注明理由。产出「收口进度」机器读数。
- **R22-O6 十个零测试目录补最小判据**：accessdesk/caphealth/cardtable/freehome/lexiscore/mofo/periodmath/playbook/stickerdesk/sullydesk 逐个至少「模块可 import、关键投影函数对、不抛」。不追行数。

### 批次 C（一致性收口）
- **R22-O7 事件欠账 5 条处置**：逐条真接订阅，或改判为对外遥测/跨仓转交并移出 debt。判据读 event_subscribers.json 的 debt 变化。
- **R22-O8 通知横幅单一出口**：收成 `incoming-banner` 唯一实现，App 只声明内容。文案唯一实现纪律。
- **R22-O9 未读角标单口径**：角标数一律取 chat-read-cursor 唯一出口，App 层不许自数。判据扫 App 层不得出现自算未读。

## 纪律（每项的默认，不占名额）
- 文案唯一实现：同一句人话不在 App 层与桥里各拼一份。
- 读不到 ≠ 没事：不同失败态不塌陷。
- 纯函数零 IO 的桥只 import num-gate。
- 每项自带判据套件（正反两面 + 负控制），台账/版本五源同源，提交推送。

## 验收（每项的「两面」）
每项验收语都写正反两面：做到的证据（读数/快照）与「没做到时怎么被抓」（负控制）。详见证证据书的复跑命令。
