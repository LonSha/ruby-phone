# R14-X1 · 会话台 → 待回应清单（v4.123.0）

- 日期：2026-11-05
- 切片：R14-X1（需求见 `.agents/notes/proposed/feature/2026-11-03-product-expansion-v14.md` 第 13 行起）
- 版本：`4.123.0`（五源同源：package / manifest / index 常量 / update-log.latest / status-ledger）
- 判据：`tests/r14_x1_reply_board.test.mjs`（27 项，A–F 六面）

## 一、这一版补的是哪个真实的洞

`threadCounts` 的 incoming 过滤**显式排除 MISSED**（R6-O2 的既定口径）。后果：

- 漏接悬着（`resumeOf().endedOnMissed === true`）既不进 `unread`，也不进 `unanswered`；
- 会话台上只有一行 `cm-pending` 红字提示，**没有任何可操作的逐项条目**。

也就是说：最该回应的那件事（回拨），在界面上是最不可操作的。

本版新增投影 `replyPointsOf(thread)`，把 `missed` **首次**纳入逐项待回应：

- `missed`：只要 `replyState` 为空就进清单（它没有 seen/answered 按钮可用，回应即回拨决定）；
- `message / call / sms`：`!(seen === true && answered === true)` 才进（旧读数口径不变，只是收进清单）；
- `outgoing` 一律不进；
- `readable !== true` 一律不进（无源不猜）。

`threadCounts` 本身**一个字都没改** —— 读数面与清单面是两个投影，不是一个口径。

## 二、两族状态必须分存（本版最重要的设计约束）

| 字段 | 归属 | 谁写 | 谁读 |
|---|---|---|---|
| `point.seen` / `point.answered` | **系统读数** | `markPointSeen` / `markPointAnswered` | `threadCounts` → unread / unanswered |
| `point.replyState` / `replyAt` / `replyOrigin` | **用户决定** | `markPointReply` | `replyPointsOf` |

- `answered` 动作是**唯一**允许两族交汇的一格，且方向单向：手动回应 ⇒ 同时置 `seen=true`、`answered=true`（用户都决定回应了，读数不该继续挂着未回）。
- 反向**绝不**：`markPointSeen` / `markPointAnswered` 不写 `replyState`。
- 这条约束就是验收③（手动标记与实际消息回执区分）的实现基础。合并成一个字段的话，「系统看到有回执」会被伪装成「用户决定过已回应」。

## 三、本版自己抓到的缺陷形态（真缺陷，已修）

**首版把 `replyState` 只写在 `markPointReply` 的补丁里，漏了归一层。**

`normalizePoint` 是**重建式白名单归一**（逐字段重建对象，不是展开继承）。凡不列出的字段，写回存储再读出时就被静默抹掉：

```
点了「已回应」→ 写入成功 → 刷新 → 又回到待回应清单
```

写进去的是真数据，读出来的却是它不认识的那一格。修法：在 `normalizePoint` 里补接三格，取值只认三动作（`hasReplyAction`），坏值一律读成「没决定过」，时刻读不出就是 `null`（不补现在）。

回归判据：`D1 刷新保留` —— 写回存储后**重新从存储读**，`replyState` 必须还在，且该项仍在清单外。

## 四、回到原处：如实报，不编假靶心

新增：

- `COMM_CHANNEL_APP`：channel → 归属 App 的**唯一**路由表（`wechat → wechat`、`phone-call → phone`、`phone-sms → phone`）；
- `COMM_LANDING`：落地归因**独立词表**（`''` / `no-app` / `no-source` / `no-landing`）；
- `replyLandingOf(point)`：把接触点折成派发载荷的纯函数，不碰 DOM。

**为什么不并进 `COMM_REASONS`**：那张表的十二项是 R6-O2 已冻结的口径（判据按项数核），塞第 13 项会让「接触点判定」与「跳转落地」两个完全不同层的归因混在一张表里，历史判据当场变红。分层存，各自数各自。

**本版 `landed` 恒为 `false`**：wechat / phone 两侧都还没有逐条定位口（`apps/clock/clock-view.js` 头注已记过这笔账）。因此：

- 不造 `ref`（投一个找不到的靶心会让用户以为「这条被删了」，而真相是「本版没有那个定位口」——两件事处置相反）；
- 界面文案写「只打开 X（本版落不到具体那一条）」，由 `App.landingOf()` 一处出，视图不写死。

App 侧 `goto(point)` 走唯一派发链 `phone:openApp` + `buildOpenDetail`，不持有 wechatApp / phoneApp 实例。

## 五、接线清单

| 面 | 文件 | 内容 |
|---|---|---|
| 内核 | `config/comm-thread.js` | `COMM_REPLY_ACTIONS`、`hasReplyAction`、`markPointReply`、`replyPointsOf`、`COMM_CHANNEL_APP`、`COMM_LANDING`、`replyLandingOf`；`normalizePoint` 补接三格 |
| App | `apps/comms/comms-app.js` | `reply(threadId, pointId, action)`、`replyBoard()`（空分组 `continue`）、`goto(point)`、`landingOf(point)` |
| 视图 | `apps/comms/comms-view.js` | `_replySection()`、`_pointOf()`、`_landingTitle()`、`APP_LABEL`；事件分支 `reply` / `goto` |
| 样式 | `apps/comms/comms.css` + `phone.css` | `.cm-reply*` 与 `.cm-pt-go`，**双侧同改**，含 `@media (max-width: 340px)` 窄屏行 |

`replyBoard()` 只遍历 `this.live().concat(this.idle())` —— closed 段已了结，不复出。

## 六、判据（27 项）抓到过什么

写判据时自己踩的两个坑，都记在注释里：

1. **判据抓到自己**：`E5` 用裸正则查 `wechatApp|phoneApp`，而 App 文件的注释里正写着「不持有 wechatApp / phoneApp」——命中的是那句注释。改为 `stripComments()` 后再查。
2. **判据写成愿望**：`E4` 原本要求未登记 channel 归 `no-app`，实测发现 `COMM_CHANNELS` 词表外的 channel 在归一层就被判 `readable:false`，真实入口是 `no-source`。`no-app` 因此是**防御性分支**（词表有、路由表漏），由 `E1` 的「每个 channel 必须有归属」守住不发生。

负控制四向（`F5`）：真仓必绿 / 三处真源码破坏各自被抓 / 锚点不唯一必抛 / 无关改动仍绿。

## 七、交棒

- 后续切片（X2 邀约、X9 复用）若要接逐条定位口，**只改 `replyLandingOf` 一处**，并同步 `COMM_LANDING` 的 `landed` 语义；
- 不得把 `replyState` 与 `seen/answered` 合成一格；
- 不得为让按钮看起来更有用而编造 `ref`。

## 八、验证边界

- 已跑：`tests/r14_x1_reply_board.test.mjs`（27/27）、`tests/system-v4490.test.mjs`（22/22，含 D3 样式双侧）、`tests/system-v3660_open_ref.test.mjs`（23/23）、`scripts/syntax-check.mjs`、`keys-audit`、`dead-export-check`、`bind-consumption-audit`、`method-consumption-audit`、`lifecycle-audit`、`registry-audit`、`source-derivation-audit` —— 新增项均为 0。
- **未跑全量回归**（`npm test`）：按用户口径，全量回归留到双项目双计划全部收口后统一执行。
- 未做浏览器实机验证：本版不宣称覆盖宿主主题差异，「独立浏览器证据不等同酒馆实机」这条边界照旧成立。
