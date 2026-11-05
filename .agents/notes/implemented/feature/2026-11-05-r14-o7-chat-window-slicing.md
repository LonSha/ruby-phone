# Agent Note: R14-O7 聊天长会话消息窗口切片
Status: implemented
## Problem
计划书原文（`.agents/notes/proposed/architecture/2026-11-03-product-optimization-v14.md`）：
> **本期交付**：基于真实记录修虚拟列表、滚动锚点、后台动画及资源释放；优先核心流畅度。
> **玩家入口**：微信长聊、相册、通知和应用库。

本文只覆盖**微信长聊**入口。底座（`config/list-window.js` 的 `tailWindowOf` /
`CHAT_WINDOW_SIZE=200`）早在 v4.16.0 · R4-O4 就位，`_refreshCurrentChatMessages`
的回退路径也已走窗口。侦察方式是写探针真跑真读（`tests/_dbg_o7*.mjs`，四个，
全部只读真源码、不破坏工作树，验证后已删除）。四处缺陷全部由探针实测暴露。

### 缺陷一：首屏仍是全量铺
`renderChatRoom` 首屏直接 `${this.renderMessagesWithDateDividers(messages, userInfo)}`
—— 探针实测：5000 条的会话，首屏交给渲染函数的数组长度是 **5000**。R4-O4 只修了
回退路径，首屏漏了。

### 缺陷二：主刷新路径（smartUpdateMessages）也是全量
13 处调用方共用的 `smartUpdateMessages` 生成分支里
`newHtml = this.renderMessagesWithDateDividers(messages, userInfo)` —— 探针实测同样
是 5000。用户在长会话里做任一触发回执/删除/重roll 的动作，一次铺全量的长任务
就回来了。

### 缺陷三：窗口深度是全局标量，切会话串味
修前 `_loadedWindow` 是单个标量。探针实测：A 翻 3 页→800；切到只有 10 条的 B
→仍是 800；B 调一次 showEarlierMessages→把标量写成 10；切回 A→A 的 2000 条
只剩 10 条可见。一个会话的浏览深度污染另一个会话 —— 本仓最贵的那类
「不报错、只是默默没生效」。

### 缺陷四：能力写好了、产品端零消费
`showEarlierMessages()` 修前**全仓零调用方**。窗口一旦切成 200 条，用户永远看不到
更早的，界面上也没有「更早的还在，点这里看」的提示 —— 正是本仓反复治理的
「能力写好了、产品端零消费」。
## Solution
全部改动在 `apps/wechat/chat-view.js`（+109/-8）：

1. **首屏走尾部窗口**：`renderChatRoom` 里 `tailWindowOf(messages, { loaded:
   this._windowSizeOf(chat.id), pageSize: CHAT_WINDOW_SIZE })`，渲染改为
   `renderLoadEarlierEntry(win) + renderMessagesWithDateDividers(win.items, userInfo)`。
2. **smartUpdateMessages 走窗口**：生成分支同样取 `win.items`，`cid` 按
   `options.chatId || currentChat?.id` 算；`_lastRenderedMsgIds` 仍记**全量** id，
   增量追加的纯尾部判据（D3/D4）不受影响。
3. **窗口深度按会话隔离**：标量 `_loadedWindow` 改为 `_windowByChat: Map
   (chatId → 深度)`；`windowSize()` 保留为当前会话读数（诊断面兼容），
   `showEarlierMessages` 里 `next = Math.min(total, cur + CHAT_WINDOW_SIZE)`、
   只写本会话条目；`_loadedWindow` 仍同步写**当前会话**的值以兼容旧读数。
4. **「查看更早的消息」真按钮**：`renderLoadEarlierEntry(win)` 在 `win.hasMore`
   时渲染顶部入口；`bindLoadEarlierEvents()` 以事件委托绑在稳定容器
   `#chat-messages`（`_loadEarlierEventsBound` 防重复），拉到头时 toast
   「已经是最早的消息了」。三条渲染路径的绑定点都补了 `bindLoadEarlierEvents()`。

切片只影响**交给渲染函数的数组** —— 不改数据源、不删历史。
## 判据（tests/system-v4160.test.mjs，两处对齐实现）
- C3：断言 `showEarlierMessages` 函数体含 `cur + CHAT_WINDOW_SIZE`（实现改用局部
  变量 `cur` 后，旧断言 `this.windowSize() + CHAT_WINDOW_SIZE` 会误红）。
- D2 重写为「三路径全破坏才留绿」：锚点 `renderMessagesWithDateDividers(win.items,
  userInfo)` 出现 ≥2 处（实测次数打进断言消息），破坏副本把锚点**全部**替换为
  `renderMessagesWithDateDividers(messages, userInfo)` 后不得再含锚点，且原版必须
  含锚点 —— 只坏一处（整段重铺回归）即转红。
## 已知边界（诚实地留着）
- **`windowSize()` 只反映当前会话**。要读指定会话深度需 `_windowSizeOf(chatId)`
  （未导出为公开 API，本期不做诊断面扩展）。
- **`_windowByChat` 无上限回收**。极端多会话下 Map 随「翻过页的会话数」线性增长，
  每项一个数字，量级可忽略；将来要回收属独立一期。
- **「查看更早的消息」加载后不做滚动锚定**。窗口整体重铺、视口回到当前位置附近，
  「锚定用户刚才看到的位置」这档留给相册/通知入口统一做。
- **p95 帧时 / DOM 节点量化记录**（验收旅程原文）需 Chromium 环境，本环境
  `SKIP_BROWSER=1` —— 未执行，不计通过。
## Verification
```
node --test tests/system-v4160.test.mjs    # 20/20
node --test tests/r14_o6_bin_restore_integrity.test.mjs   # 18/18
grep -rln 'chat-view' tests/*.test.mjs | xargs node --test   # 553/553，0 fail
```
门禁：`syntax` · `import-resolve` · `dead-exports` · `weak-coercion` · `named-import`
· `keys` · `registry` · `hardlink-safety` · `lifecycle` · `source-derivation`
· `bridge-contract` · `screen-host` · `doc-path-claim`（4130 处，0 落空）
· `upstream-face` · `bind-consuming` · `method-consuming` · `session-writeback`
—— 全部退出码 0。调试脚本 `tests/_dbg_o7{,b,c,d}.mjs` 已删除，台账
`scripts/doc-path-claim-baseline.json` 对应 fixtures_or_placeholders 条目已一并
移除（保持台账零陈旧）。`browser` 门按 `SKIP_BROWSER=1` 显式跳过（无 Chromium
环境）—— 这是**未执行**，不计通过。
