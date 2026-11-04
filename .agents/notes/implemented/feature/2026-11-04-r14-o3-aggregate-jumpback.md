# Agent Note: R14-O3 聚合页点回原条目（日记 / 日历备忘跨 App 靶心）
Status: implemented
## Problem
第十四期计划书 R14-O3 原文：「核对 today、recap、search、通知、档案五条路径，补精确定位与失效说明，**不把打开 App 当定位成功**」。

修前实测处境：
- `config/open-ref.js` 的 `OPEN_REF_KINDS` 只登记 7 个 kind（expense / memory / item / song / novel / illust / article），日记与日历备忘**根本没有登记**；
- `apps/memory/global-search-engine.js` 的 `diary` 与 `calendar` 两条源**只带 `appId`、不带 `meta.ref`** —— 搜索里能搜到，点下去只落在 App 首屏；
- `apps/clock/clock-view.js` 的「今天」四源按钮只能诚实地写「打开日记 / 打开日历」（`TODAY_JUMP_APP` 头注明写「四个源 App 都还没有 openRef 定位口」）；
- `apps/notifications/notification-center-view.js` 点 `.nc-item` 只派发 `{appId}`；`config/system-notifications.js` 的 `push()` 把 `meta` **收成固定的六个字段**，靶心写进去会被丢掉；`config/notification-hub-bridge.js` 只把 `deepLink` 放 `meta.hubDeepLink`。

⇒ 「找到了」与「点得回去」之间没有任何桥。这不是索引不够，是**结果没有靶心**。

## Decision
1. **先登记再接线**（协议面）：`OPEN_REF_KINDS` 增 `diary → diary`（日记条目）与 `calendar → calendar`（日历备忘）。未登记的 kind 一律不投（`ref-kind-unknown`）—— 登记面不动，消费侧怎么接线都是空话。
2. **源侧用唯一一支笔写字**：引擎两条源改为 `map(...).filter(Boolean)`，**条目必须有 `id`**（没 id 的搜到了也点不回去 = 死链，直接不收），靶心统一走 `buildOpenRef(kind, id, appId)`，不手写对象字面量。
3. **消费侧按 id 现找，不按下标**：
   - `apps/diary/diary-app.js::openRef` 在 `diaryData.getEntries()` 里按 id 找，命中只点亮 `currentEntryId` + `currentView='page'`，**本函数不渲染**；找不到如实返回 `{ok:false, reason:'not_found', id, saw}`；`clearRef()` 清定位态并在 page 态退回 toc。
   - `apps/calendar/calendar-app.js::openRef` 在 `calendarData.getMemos()` 里按 id 找，命中后按 `parseDateKey(hit.dateKey)` 翻到那一个月的页面，并点亮 `detailMemoId`（只读态，不进编辑）。文案与实现都强调：`calendar` 靶心认的是 **`calendar_memos`** 而非 `calendar_commitments`（两者 id 前缀不同，改认约定会让引擎靶心一律 not_found）。
4. **行上带靶心（只筛形状）**：`config/today-rows.js` 新增 `refOf(v)`，只留 `{appId, kind, id}` 三字段纯对象；坏值降 `null`。归一再由消费侧 `applyOpenRef` 判一次 —— 两道筛子都要有，本件防「把坏值画在按钮上」，`open-ref` 防「投到没人认的 kind」。
5. **文案由靶心在不在决定**：`apps/clock/clock-view.js` 有靶心 ⇒ 按钮写「打开这一条」+ `data-today-ref`；没靶心 ⇒ 仍只写「打开 X」。**不能按源名写死** —— 写死会出现「某天补了口但文案不改」（或反过来先承诺、口还没补）两类只在使用时暴露的静默缺陷。
6. **装配顺序**：`index.js` 的 `diary` / `calendar` 分支里 `applyOpenDetail` → `applyOpenRef` → `render()`，且**投靶心失败要 `console.warn`**（用户看到的「停在首屏」与「这条没了」长得一样）。
7. **通知中心补齐（本项内收口，不留给后续契约）**：
   - `config/system-notifications.js` 的 `push()` / 合并分支 / `_normalize()` 三处都保留 `meta.ref`（只筛形状，不合形写 `null` 而不是空壳）。写不存等于没写。
   - `config/notification-hub-bridge.js` 把派发器的 `metadata.ref` 带到行上；**明确不把 `deepLink` 当靶心反推**（`deepLink` 是 `{targetApp, view, params}`，不含条目身份，硬猜 ⇒ 永远 not_found）。
   - `apps/notifications/notification-center-view.js` 给 `.nc-item` 写 `data-ref`，点击时解析并走 `buildOpenDetail(appId, null, ref)`；解析失败不静默吞（退为只开 App 并出声）。

## Verification
- 定向测试：`node tests/r14_o3_aggregate_jumpback.test.mjs`（**25/25 通过**）
  - A 协议面 2 条、B 源侧 3 条、C 消费侧 4 条、D 行归一 2 条、E 视图 3 条、F 装配器 1 条、**G 负控制 4 条**（真源码破坏：撤登记 / 去源侧靶心 / 文案写死 / 定位乱指，判据均转红）、H 通知中心 4 条、V 结构自证 2 条。
  - 负控制副本树必须带 `data/`：引擎静态 import `data/cheat-index.js`，副本树缺它会在 ESM 解析处 MODULE_NOT_FOUND，那是判据基建坏了、会被误读成「破坏没反应」。
- 历史断言对齐（**改断言是因为契约真变了，不是为消红**）：
  - `tests/system-v3660_open_ref.test.mjs` A1：由「登记表与七条逐条相等」改为「七条必须在场（子集）+ 多出来的 kind 必须由后续切片套件守（真查盘，不靠口头约定）」。理由：登记表会随切片继续长，写死相等会导致每长一条都要改历史断言。23/23 通过。
  - `tests/system-v4113.test.mjs` D6：由「HTML 一律不许出现『打开这一条』」改为「无靶心不许写、有靶心必须写」，`fakeApp(state, withRef=false)` 补上两面。理由：该断言守的是「不许写做不到的承诺」，`diary`/`calendar` 补了口之后有靶心那条能真落到，一刀切会连真承诺一起禁掉。24/24 通过。
  - `tests/system-v2161-e2e.test.mjs`：seed 里 `diary_entries` / `calendar_memos` 补稳定 `id`。理由：新契约要求条目带 id 才可索引（否则是死链），seed 是手写样例、与真实落盘形态不符。9/9 通过。
- 通知与全局搜索相关既有套件定向复验：`system-v41000`(16) / `system-v4997`(27) / `system-v4116`(9) / `system-v4190`(22) / `system-v4992`(23) / `system-v3550`(18) / `system-v3850`(19) / `system-v3890`(22) 全绿。

## 已知边界（不在本项内，留给后续）
- `wechat` / `album` 两源**仍没有 `openRef`**，按钮照旧只写「打开 X」—— 文案已经按靶心在不在自动决定，补口时无需再改视图。
- `recap`（复述）走的是 `config/source-locator.js` 的 `normalizeSource` + 宿主 `locateChatFloor`，与 `OPEN_REF_KINDS` 是**两套不同契约**（一个定位剧情楼层、一个定位 App 条目），本项未强行合并 —— 合并会把「楼层」硬塞进 kind 语义，两边都失真。
- `archive`（档案）当前无 `openRef`、无跨 App 派发点，本项未纳入。
