# 迭代日志 (Iteration Log)

> 本文件记录**自主迭代模式**下每一轮的：做了什么 / 为什么 / 影响范围 / 验证方式 / 遗留项。
>
> 与 `update-log.json` 的分工：`update-log.json` 是面向用户与更新弹窗的**权威变更日志**
> （89 个版本，按版本号索引，`latest` 指针驱动 App 内「本版更新」弹窗，且与
> `index.js` 的 `ST_PHONE_CURRENT_UPDATE.items` 由测试强制**逐字同源**）。
> 本文件是**工程侧的过程记录**，允许包含未发布到更新弹窗的技术细节与已知遗留。
> 不另建 `CHANGELOG.md`，避免与 `update-log.json` 形成两份真相。

---

## 迭代 1 — v2.63.0 会话生命周期接线收口（审计驱动）

- **日期**：2026-09-22
- **类型**：稳定性 / 缺陷修复（会话隔离数据串味 + 资源泄漏）
- **动机**：本仓历史踩坑最密集的类别是「**会话切换生命周期接线**」——
  v2.23 / v2.24 / v2.25 / v2.30 / v2.46 / v2.53 / v2.55 连续七版都在补同一类漏接线。
  与其继续人肉逐个排查，改为**写审计脚本一次性枚举全仓缺口**。

### 审计方法（可复用）

| 脚本 | 口径 |
|---|---|
| `/tmp/audit_lifecycle.mjs` | 对 `apps/*/*-app.js` 提取 class 名 → 在 `index.js` 反查单例赋值点得 key → 检查 `onChatChanged` / `clearCache` / `destroy` / `deactivate` / `reload` 五类出口是否有调用路径（REBIND 表命中或显式调用） |
| `/tmp/audit_registrations.mjs` | 三方对账：`config/apps.js` 的 APPS id ↔ `index.js` 懒加载 `appId === 'xxx'` 分支 ↔ `config/storage.js` 会话键前缀正则 |

审计结果：**总方法出口 43 · 零调用 7**。逐一辨伪后收敛出 **3 处真缺陷**：

| 候选 | 判定 | 依据 |
|---|---|---|
| `albumApp.deactivate`、`musicApp.deactivate`、`phoneApp.deactivate`、`wechatApp.deactivate` | 假阳性 ×4 | 由 `releasePhoneInactiveResources()` 的 `appEntries` **数组泛化调用**，脚本无法识别数组形式 |
| `honeyApp.destroy` | 假阳性 | 被功能更强的 `deactivate`（内含 `exitHoneySurface`）取代 |
| **`memoryApp.onChatChanged`** | **真缺陷** | 定义了出口却**从未接入 REBIND 表**，全仓零调用 |
| **`timeweaverApp.aiLetter` 无出口** | **真缺陷** | 实例级 AI 信缓存，视图直读，三条会话路径均不丢弃 |
| **`_calendarReminderApp` 回收不完整** | **真缺陷** | 三处路径没有一处完整，且槽位顶替后旧实例监听器永久泄漏 |

注册联动审计的 19 个「无会话键前缀」经核实为 `/^ruby_/`、`/^games_*/` 等**宽匹配覆盖**（假阳性），
40 个 APPS id / 40 个懒加载分支**无孤儿、无缺失**。

### 改动

1. **`memoryApp` 接入 REBIND 表**（`index.js` 的 `ST_PHONE_REBIND_APP_KEYS`）。
   该 App 的 `onChatChanged()` 只复位降级标志并重指 `memoryCore`（不持数据副本），全仓零调用属漏接线。
2. **`timeweaverApp` 新增 `onChatChanged()`**（`apps/timeweaver/timeweaver-app.js`）：
   丢弃 `aiLetter`（AI 升华信缓存）与 `composeDraft`，并复位 `_autoChecked`
   （`_maybeAutoWeave()` 靠它保证「每实例生命周期只检查一次」，实例跨会话复用故必须复位，
   否则新会话永远走不到自动织信检查）；随后接入 REBIND 表。
3. **`_calendarReminderApp` 回收收口为单一真源**（`index.js` 新增 `disposeCalendarReminderApp()`）：
   - 三件事齐备：`destroy()` 解绑构造期 SWIPE_BACK 监听器 → 槽位置 `null` → 复位 `_lastCalendarReminderCheckTime`；
   - P1 换会话传 `{ preserveActiveInstance: true }`（活动 `calendarApp` 由上一段负责 `clearCache`，不 destroy）；
   - P2 清当前数据 / P3 清全部数据用无参调用（连提醒实例一起回收，此前对该槽位**零处理**）；
   - **两处「实例覆盖」点补前置回收**：① 自动补全日程写回槽位前，若槽位被独立提醒实例占着则先 `destroy`
     （否则顶替后失去全部引用、监听器永久泄漏）；② 打开日历 App 走「覆盖旧实例」分支前先 `destroy`（v2.25 同型）。
4. **测试同步**：新增 `tests/system-v263.test.mjs`（8 条）；`tests/system-v255.test.mjs` 的 A5
   `dirMap` 补 `timeweaverApp: 'timeweaver'`（该表未登记会直接断言失败，防新 App 漏配）。
5. **版本收口**：manifest / package / `index.js` / `update-log` 四源升 `2.63.0` + 替换 `ST_PHONE_CURRENT_UPDATE` 条目。

### 影响范围

- **用户可见**：换角色后打开织光机不再渲染上一段剧情被 AI 织起的信；换会话后日程提醒不会拿旧会话时间点做比较（漏报/重报）；反复开关日历与切会话不再累积孤儿回退手势监听器。
- **数据面**：无 schema 变更、无存储键变更，纯内存实例域与接线修正。
- **风险面**：`disposeCalendarReminderApp` 只在会话生命周期路径被调用，不触碰正常打开日历的实例复用路径（`preserveActiveInstance` 守护 + 覆盖点守卫双重保护）。

### 验证

- `node --test tests/system-v263.test.mjs` → 8 pass
- `node --test tests/system-v255.test.mjs` → 29 pass（含 A5 同步后）
- `npm run check` → 语法门 **333 文件通过**；全量测试 **477 pass / 0 fail**；死导出 **零新增**（基线 24 条冻结，枚举面完整性 787 条全识别）
- **门禁互锁实测**：落码后 `v225` 的「所有置 null 站点要么 destroy 要么有幂等 guard」静态断言立刻红
  —— 因回收函数初版经局部句柄 `slot.destroy?.()` 调用，检查器按 `VirtualPhone.<name>.destroy` 形态识别不到。
  已改为直接属性链调用（语义等价），该断言转绿。**这是既有关门禁正确履职的实例，记录在案。**

### 遗留项

- `audit_lifecycle.mjs` / `audit_registrations.mjs` 仍是 `/tmp/` 下的一次性脚本，未入仓。
  若要固化为正式审计门禁，须先把「数组泛化调用（如 `appEntries`）」与「更强出口覆盖（`deactivate` ⊃ `destroy`）」
  纳入白名单，否则会产生 5 条常驻假阳性。已记入 `TODO.md`。

---

## 迭代 2 — v2.64.0 会话级「槽位 × 三路径」审计（审计面下沉）

- **日期**：2026-09-22
- **类型**：稳定性 / 缺陷修复（会话隔离数据残留）
- **动机**：迭代 1 审的是「生命周期**方法出口**是否被调用」。但本轮实测证明
  **方法级审计漏得掉**另一类形态：出口被调用了（所以方法级看不见缺口），
  但只在**其中一条**会话路径上被调用。故审计面下沉一层：不看方法，看**槽位**。

### 审计方法（精确判据）

对 `index.js` 上每个持有实例的 App 槽位（`VirtualPhone.X = new ...`），
逐条核对三条会话路径块内是否出现其回收/重绑调用：

| 路径 | 区间锚点 |
|---|---|
| P1 换会话 | `function onChatChanged()` → `function getContext()` |
| P2 清当前数据 | `addEventListener('phone:clearCurrentData')` → 下一个监听器 |
| P3 清全部数据 | `addEventListener('phone:clearAllData')` → 块尾 |

**区间边界必须用函数/监听器边界精确划定**。首版探针用「近似区间」导致 P2 与 P1 区间重叠，
把 P1 的行误算成 P2 命中，差点漏判（踩坑记录）。

### 审计结果

| 槽位 | P1 | P2 | P3 | 判定 |
|---|---|---|---|---|
| albumApp / calendarApp / diaryApp / honeyApp / memoryCore / mofoApp / musicApp / phoneApp / weiboApp | ✓ | ✓ | ✓ | 三路覆盖 |
| gamesApp / worldpulseApp | ✓ | ✓✳ | ✓✳ | **假阳性**：由 P2/P3 咽喉点 `reloadPhoneSurface() → retireSessionScopedSlots()` 统一收口（探针只认本处字面量，故列入白名单） |
| **wangxiangApp** | ✓ | ✗ | ✗ | **真缺陷** ← 本版修复 |

`WangxiangApp` 持有一整套会话级实例数组（`generatedTasks` / `managedTasks` /
`taskProgressHistory` / `marketplace*` / `inventoryItems` / `creditBalance` / `deliveryAddresses`），
`clearCache()` 会逐个清空并 `_syncTaskDataScope()` 重载；
但它**只**在换会话路径被显式调用一次，两条清数据路径对 `wangxiangApp` 零处理 ——
清完数据后手机仍持已删任务与订单，直到某次深层操作偶然触发 `_syncTaskDataScope()`
（比较键取自 storage，故清数据后才会命中去重）才收敛。

### 改动

1. `apps/wangxiang/wangxiang-app.js` 新增 **`onChatChanged()`**（转调 `clearCache()`），
   并写明动机与「为什么不由两条路径各写一次」。
2. `index.js` 的 `ST_PHONE_REBIND_APP_KEYS` 表**补 `'wangxiangApp'`** → 三条路径自动覆盖。
3. `index.js` 换会话路径里原有的 `wangxiangApp.clearCache()` 显式块**收敛掉**
   （否则换会话会跑两遍，且留下与 REBIND 表并存的第二条真相）。
4. 测试：新增 `tests/system-v264.test.mjs`（5 条，含**覆盖矩阵防回归**）；
   `tests/system-v255.test.mjs` 的 A5 `dirMap` 补 `wangxiangApp: 'wangxiang'`。
5. 版本四源升 `2.64.0` + `ST_PHONE_CURRENT_UPDATE` 换条目。

### 影响范围

- **用户可见**：清当前数据 / 清全部数据后，万象 App 的任务、委托、订单、库存、信用余额、
  收货地址不再残留旧会话数据（此前要等到下一次深层操作才收敛）。
- **数据面**：无 schema 变更；修的是「内存副本未被清」，不触碰 storage 清空链路。
- **风险面**：`onChatChanged()` 只是 `clearCache()` 的别名转调，语义与 P1 原调用完全一致；
  收敛 P1 显式块不改变行为（同一次换会话只少跑一遍等价清理）。

### 验证

- `node --test tests/system-v264.test.mjs` → 5 pass（含覆盖矩阵断言）
- `node --test tests/system-v255.test.mjs tests/system-v263.test.mjs` → 无回归
- `npm run check` → 语法门 **334 文件通过**；全量测试 **482 pass / 0 fail**；死导出零新增
- **测试断言与实现语义的对齐（开发中修正两处）**：
  ① 首版测试 seed 带数据，而 `clearCache()` 末尾 `_syncTaskDataScope()` 会从 storage 重载 →
     断言失败。真实时序是**宿主先清 storage**，故测试改为已清 storage，并把这个语义写进注释
     （它恰好解释了为什么「内存那份没被清」是个真问题）。
  ② `marketplaceCategories` 有内置默认类目兜底（清空后返回默认集），不属「必须为空」，
     从断言列表移出、另立「应为数组」断言。

### 遗留项

- 迭代 1 与迭代 2 的审计脚本（`probe_lifecycle.mjs` / `probe_slots.mjs` / `probe_slots2.mjs`）
  仍是 `/tmp/` 下一次性的。**固化门禁**顺延为迭代 3（见 `TODO.md`）。

---

## 迭代 3 — v2.65.0 生命周期接线门禁固化

- **日期**：2026-09-22
- **类型**：测试基建 / 防回归（把一次性审计脚本变成常驻发布门）
- **动机**：迭代 1、2 各修了一类会话生命周期缺陷，但**能力本身没留在仓里**——
  三个探针都在 `/tmp/`，下一次同类缺陷仍要重写脚本。本仓已有成熟范式可照抄：
  `scripts/dead-export-check.mjs` + `dead-export-baseline.json`
  （冻结基线 + 零新增判定 + 枚举面完整性自证 + `--list` / `--update` / `--root` 三态）。

### 改动

1. **`scripts/lifecycle-audit.mjs`**（258 行，零依赖），两条判据：
   - **L1（方法出口）**：凡 App 类定义了 `onChatChanged` / `clearCache` / `destroy` / `deactivate` / `reload`
     且能反查到 `VirtualPhone.X = new module.Class` 单例槽位的，必须至少有一处接线路径
     （REBIND 表 / 显式调用 / 泛化调用清单）。
   - **L2（槽位覆盖）**：若某槽位在**换会话**路径被回收，则两条清数据路径至少须有一处覆盖，
     或落在咽喉点清单里 —— 「只覆盖一条路径」正是迭代 2 修掉的形态。
2. **白名单从真源码派生**（L3），不硬编码：
   - 泛化调用清单 ← 解析 `releasePhoneInactiveResources` 的 `appEntries` 数组（真仓库 11 项）；
   - 咽喉点清单 ← 解析 `retireSessionScopedSlots` 函数体（真仓库 2 项）。
   - **派生前提消失即 fail-closed（exit 2）**：写死的白名单会在机制被删除后继续放行，
     门禁变吉祥物；派生式白名单的语义是「因为这些名字确实出现在回收代码里，所以放行」。
   - 结构守卫（三路径区间锚点、白名单派生前提）**在夹具模式下也不放宽**：
     只放宽「最低计数」闸。锚点缺失时任何判定都不可信，此时出口 0/1 等于用坏探针发合格证。
3. **串进 `npm run check`**（与 `syntax` / `test` / `dead-exports` 并列），新增 `npm run lifecycle`。
4. **`tests/system-v265.test.mjs`**（10 条）：正控制 + 5 例真源码破坏负控制 + 判据纯度自证。
5. 版本四源升 `2.65.0` + `ST_PHONE_CURRENT_UPDATE` 换条目。

### 被负控制逼出的三处判据自身缺陷（全部实测修复）

| 缺陷 | 形态 | 修法 |
|---|---|---|
| `explicitCall` 正则在括号前多写一个必选点 | **所有显式调用都匹配不到**（真仓库恰好被 REBIND/泛化清单兜住而未暴露） | 正则对齐真实书写：`method + '\\s*\\??\\.?\\s*\\('` |
| 只认 `VirtualPhone.` 前缀 | `phone.worldpulseApp.onChatChanged?.()`（局部句柄形态）被漏认 ⇒ **真仓库出现假阳性** | 前缀改为 `(?:VirtualPhone\|[A-Za-z_$][\w$]*)` |
| 函数体抽取用「缩进 4 空格的收尾 `}`」 | 只在函数嵌于 4 空格块内时成立；夹具（顶格）直接误判为「结构漂移」 | 改为**花括号配平**抽取，与缩进无关 |

结论：**负控制不是形式主义**——三条中有两条只在负控制里现形（真仓库上一条静默、一条假阳性）。

### ⚠️ 事故复盘：工作区被 `cp -al` 破坏（严重，已恢复）

- **经过**：为给负控制建副本，执行 `cp -al index.js apps scripts /tmp/lc_probe_$$`。
  该命令在本环境未正常完成：`apps/asset/` 下出现 `.l2s..l2s...0001.00010010` 形态的
  临时收容所产物，并且**425 个已跟踪文件被替换成指向这些临时名字的符号链接**。
  清理那些 `.l2s.*` 收容产物后，符号链接全部变成**悬空链**，工作区实质损坏
  （`git status` 全部报 `Operation not permitted`；`git diff --stat` 显示 12178 行删除）。
- **恢复**：`git status` 全程**只显示类型变化（`T`）与 `??` 垃圾文件，没有任何内容修改（`M`）**
  —— 这是「内容可信、只有文件类型被打乱」的判定依据；由此确认可安全用
  `git checkout -- .` 从索引恢复。恢复后工作区仅剩 1 个未跟踪文件（本轮新增的测试）。
- **教训（已写入 `TODO.md` 与测试自证）**：
  1. 绝不对真仓库使用 `cp -al` / 硬链接复制（判据只需 `index.js` + `apps/**/*-app.js`，
     合成夹具完全够用）；
  2. 负控制一律走**夹具通道**（`RP_LIFECYCLE_FIXTURE=1`），与 `dead-export-check` 同款，
     不触碰真仓库文件树；
  3. `tests/system-v265.test.mjs` 的 S1 现已**自证不再调用 cp 复制文件树**、且不写仓库原件；
  4. 事故前先 `tar` 备份（本次 62MB 备份已做，实际恢复走的是 git 索引）。

### 验证

- `node scripts/lifecycle-audit.mjs` → exit 0（35 App 类 / 48 槽位 / REBIND 24 key）
- `node --test tests/system-v265.test.mjs` → **10 pass / 0 fail**（含 5 例真源码破坏负控制）
- `npm run check` → 四道门全绿：语法 **337 文件** · 测试 **492 pass / 0 fail** ·
  零消费导出零新增 · lifecycle 门通过

### 影响范围

- **用户可见**：无（纯工程门禁）。间接收益：同类接线缺陷在提交前即被拦下。
- **数据面**：无。
- **风险面**：新增门禁的 5 条白名单项均从源码派生，不依赖硬编码名单；判据失准时 fail-closed 拒判。

### 遗留项

- `scripts/lifecycle-baseline.json` 未建：当前真仓库 L1/L2 均为 0 条，无基线可冻结。
  将来若因体积/复杂度确需保留已知项，再补该账本（与 `dead-export-baseline.json` 同款）。

---

## 迭代 5 — v2.66.0 注册联动门禁固化

- **日期**：2026-09-22
- **类型**：测试基建 / 防回归（第三类「静默错数据」形态的守门）
- **动机**：迭代 1~3 修的都是**会话生命周期**接线；本仓还有另一类同型病 ——
  **新增 App 的注册三件套漏配**：`config/apps.js` 的 APPS（桌面图标）、
  `index.js` 的 `phone:openApp` 懒加载分支、`config/storage.js` 的会话键前缀。
  漏 ① 桌面无图标、漏 ② 点击无反应、漏 ③ **数据落全局串味**；
  三处分散在三个文件，且**没有任何一处能回答「配齐了吗」**，一直靠人肉 review。

### 改动

1. **`scripts/registry-audit.mjs`**（零依赖）：
   - **R1（双向覆盖，零豁免硬判据）**：APPS id 集合与懒加载分支集合必须互为子集。
     实测真仓库 **40 ↔ 40，完全干净** —— 故设为零豁免。
   - **R2（宽匹配登记）**：会话键前缀里带量词 / 字符类 / 分组 / 或的条目必须登记理由。
     `^` 与 `$` 是锚定符，**不计入**（`/^games_board_state$/` 是精确键而非宽匹配）。
   - **R3（结构自证）**：三方任一解析面低于下限即 fail-closed（exit 2）。
   - **R2-NOTE（明确不判「App 缺前缀」）**：实测 19 个 App 无自己的前缀，
     但分两类设计内情形——① 读侧聚合器 / 派生投影（mood、graph、peek、timeweaver、search 等不写会话数据）；
     ② `^ruby_` 共享桶成员（achievement、xhs、tieba、health、gacha、tarot、reading…）。
     静态判据无法区分「设计内」与「漏配」，硬判会产生大量假阳性 ⇒ **只报告，不判定**。
2. 串进 `npm run check`（现为**五道门**：syntax / test / dead-exports / lifecycle / registry）。
3. **`tests/system-v266.test.mjs`**（10 条）：正控制 ×2 + 真源码破坏负控制 ×5 + 判据纯度自证。
4. 版本四源升 `2.66.0` + `ST_PHONE_CURRENT_UPDATE` 换条目。

### 被负控制/实测逼出的两处判据修正

| 缺陷 | 形态 | 修法 |
|---|---|---|
| `WIDE_META` 把 `^` `$` 当元字符 | 三个锚定精确键（`/^games_board_state$/` 等）被误判为「未登记宽匹配」 | 元字符集去掉锚定符，只留量词/字符类/分组/或 |
| 白名单用 `new RegExp(...).test(条目源码)` 比对 | 拿正则去测另一段正则**源码文本**，字面 `[` 不在字符类内 ⇒ **登记了却仍报未登记** | 改为按源码片段前缀（`startsWith`）比对 |

### 验证

- `node scripts/registry-audit.mjs` → exit 0（40 App · 40 分支 · 39 前缀，宽匹配 3 条全登记）
- `node --test tests/system-v266.test.mjs` → **10 pass / 0 fail**
- `npm run check` → **五道门全绿**：语法 **339 文件** · 测试 **502 pass / 0 fail** ·
  零消费导出零新增 · lifecycle 门通过 · registry 门通过

### 影响范围

- **用户可见**：无（纯工程门禁）。间接收益：新增 App 漏配注册三件套在提交前被拦下。
- **风险面**：R2 的宽匹配清单是显式白名单（3 条），新增宽匹配会被强制要求写明理由。

---

## 迭代 6 — v2.67.0 注册门禁补第四面（样式投递覆盖）

- **日期**：2026-09-22
- **类型**：测试基建 / 防回归
- **动机**：CONTEXT.md 的「四处注册」里，注册门禁此前只覆盖三面（APPS / 懒加载分支 / 会话键前缀），
  第四面 **`phone.css` 样式合并**尚未纳入。样式漏挂的后果是**界面裸奔且不报错**——
  与既有几类「静默失效」同族。

### 关键判定：本仓**并存两种**样式投递机制（实测）

| 机制 | 含义 | 实例 |
|---|---|---|
| A 全局打包 | 类前缀族合并进 `phone.css` | 25 个样式文件 |
| B 自注入 | App 内按文件名建 `<link>` | diary / honey / music / weibo（4 个） |

- 若只认机制 A，会把四个自注入 App 判成缺口（**假阳性**）。判据必须覆盖真实存在的全部合法机制。
- **「两机制皆无」真的存在**：`apps/games/games.css` 是**有意的转发壳**
  （正文已拆到 `poker/poker.css`，本文件只留 `@import` 防旧缓存路径 404，见文件头注释）。
  它无需被引用即已生效，故登记进 `CSS_DELIVERY_EXEMPT` 并写明理由——**有意识的兼容壳**与**漏挂**必须分开。

### 改动

1. `scripts/registry-audit.mjs` 新增 **R3 样式投递覆盖**：对 `apps/*/*.css` 逐个判定
   「进 phone.css（机制 A）/ 有 JS 按文件名引用（机制 B）/ 显式豁免」，三者皆无即红灯。
   附带结构自证：样式文件数低于下限（夹具模式外 15）即 fail-closed。
2. `--list` 增列 R3 明细与投递方式统计。
3. `tests/system-v266.test.mjs` 扩到 **11 条**：新增 **N6（R3 负控制：抹掉某 App 的样式引用 → 点名该文件并 exit 1）**，
   夹具补齐双机制（alpha 走打包 / beta 走引用），S1 纯度计数同步。
4. 版本四源升 `2.67.0`。

### 验证

- `node scripts/registry-audit.mjs` → exit 0（`样式投递 30 个 · 打包 25 · 自注入 4 · 豁免 1 · 未覆盖 0`）
- `node --test tests/system-v266.test.mjs` → **11 pass / 0 fail**
- `npm run check` → 五道门全绿：语法 339 · 测试 **503 pass / 0 fail** · 死导出零新增 ·
  lifecycle 通过 · registry 通过

### 踩坑记录

- **机制假设本身就是缺陷来源**：首版只在脑子里假设「CSS 必须进 phone.css」，
  若那样落地，四个自注入 App 会被判缺口。**判据必须先从实测机制得出**，而非从文档措辞推出。
- 夹具首版 alpha.css 只有 2 个类（低于前缀族阈值 5），机制 A 判不出 ⇒ 夹具基线红。
  夹具要能代表机制，就必须满足判据的形态要求（补足 5 个同类前缀）。
- 结构调整时误删了 N3 尾部与 N4 主体（一次 replace 覆盖过多），已按 `--test` 报错定位并补齐；
  教训同既有条目：**多点编辑宁可分次小步，改完立刻跑一次该测试文件**。

### 遗留项

- 「AI 标签解析监听」是可选面，难以硬判（并非每个 App 都需要），暂不纳入；
  已在 `TODO.md` 写明判定理由，避免后人重复评估。

---

## 迭代 7 — v2.68.0 准入清单存活自证（白名单不许当放行条）

- **日期**：2026-09-22
- **类型**：测试基建 / 防回归（附一处兼容壳版本号修正）
- **起因（滚动发现）**：本轮原定任务是最低风险的「`games.css` 转发壳去留复核」。复核本身很快结案
  （保留 + 修版本号，见下），但取证过程中读 `registry-audit.mjs` 时注意到 `CSS_DELIVERY_EXEMPT` 是
  **硬编码**的——顺此把三道门里的**全部白名单/账本常量**盘了一遍，挖出一个贯穿三道门的同族缺口，
  价值高于「壳去留」本身，遂改立为本版主任务。

### 缺口：三张准入清单只有「准入」，没有「存活」
| 清单 | 所在门 | 原状 |
|---|---|---|
| `UNHANDLED_ALLOWLIST` | `scripts/dead-export-check.mjs` | 只有准入校验，无存活自证 |
| `REGEX_WIDE_ALLOWLIST` | `scripts/registry-audit.mjs` | 同上 |
| `CSS_DELIVERY_EXEMPT` | `scripts/registry-audit.mjs` | 同上 |
| `dead-export-baseline.json` | `scripts/dead-export-check.mjs` | **已有** stale 提示（仅提示不拒判，作对照） |

- 后果形态：条目所指对象消失后，清单静默退化为**幽灵放行条**——为不存在的情形背书，而门禁永不报警。
- 这正是 v2.65.0 已写进 `CONTEXT.md`、却**始终只是文本**的那条纪律：「白名单是准入闸，不是放行条」。
- 实证漂移：`UNHANDLED_ALLOWLIST` 注释写「全仓 61 处」，**实测已是 90 处**——注释与实测脱节本身就是病征。

### 改动
1. **E10**（`dead-export-check.mjs`）：白名单条目存活自证。在 E9 扫描循环里逐条计数认领数
   （`allowHits` Map），**每条 entry 认领数必须 ≥ 1**，零命中即 `exit 2` 拒判。
   刻意**不用固定数字**——数字漂移无害，写死 90 会导致每次新增平台入口都要改门禁。
2. **R2b**（`registry-audit.mjs`）：每条宽匹配前缀必须仍能在 `CHAT_DATA_PATTERNS` 找到对应条目。
   比对用源码片段 `startsWith`（首版用 `new RegExp(条目源码字符串)` 失败——源码里字面 `[` 不在字符类内）。
3. **R3b**：样式豁免清单**双向**自证——① 豁免条目指向的文件必须存在（`deadCssExempt`）；
   ② 反向判定「理由已失效」（`obsoleteCssExempt`）：该文件其实已被 `phone.css` 打包或已有 JS 引用，
   说明它本可进入正常判定，豁免应撤掉。
4. **R3c**：样式文件内部的本地 `url()` / `@import` 目标必须真实存在。此前豁免项被 R3 直接 `continue`，
   其**内容是判定盲区**——转发目标一旦改名，壳会静默指向虚空而无人察觉（浏览器只 404 掉那个 `@import`，
   属本仓最贵的「不报错、不崩溃、只错结果」形态）。检查点放在豁免 `continue` **之前**，`phone.css` 也纳入。
5. 三者一律 `exit 2`（**拒判**）而非 `exit 1`——理由：这不是数据缺陷，是**门禁自己的账目错了**。
   夹具模式跳过（清单是内置真仓库对象，合成夹具天然不含；不跳过会把每个夹具仓库都判死）。

### 证据面纯度修复（本版最有价值的一处，实测踩到）
- R3b 的反向判据一上线就报 `apps/games/games.css（已有 JS 引用）`，但前一阶段 `grep` 已证明**零 JS 引用它**。
  逐层追查确认是**门禁自指伪证**：`registry-audit.mjs` 豁免清单里的路径**字面量**被自己的机制 B 判据读成了
  「有 JS 引用它」。
- 同族缺陷第二处：`index.js` 那句更新说明**散文**（「… apps/games/games.css 是转发壳 …」）同样冒充投递证据。
- 修法两面：① 判据收紧为**路径字面量**（`cssLiteralRe` 要求文件名处在路径边界 `(^|/)`、后接 `?查询串` 或结束）；
  ② 把 `scripts/` 排除出引用面（那里的路径是**描述**不是**引用**）。
- 与本仓 E6（v2.42.0）「注释/字符串里的提及不算消费」是同一族纪律的**第三次复现**。

### 附带修正：`games.css` 转发壳（原定任务，结论：保留）
- **保留**，不改结构。依据：全仓**零 JS 引用**它、唯一 `@import` 为自指、**无 Service Worker**
  （零 `serviceWorker` / `caches.open` / `workbox` / `precache`，故不存在预缓存清单同步的连带风险）；
  成本仅 2 行，而 graft 边界（`1d7fe8b`）前的历史无法验证「旧缓存路径」是否真的从不存在。
- 但修正其**版本号漂移**：壳内写 `?v=1.0.0`，而 `index.js` 的 `ST_PHONE_GAMES_CSS_URL` 与
  `poker-view.js` 的 `POKER_CSS_URL` 均为 `?v=1.0.2`。转发目标是 1943 行真实内容，版本号必须对齐。

### 注释如实性（现场自我纠错两次）
- 盘点 `export default` 形态时先把「多行对象字面量」误写为 17 处，随即自查改为 **9 处**。
- `UNHANDLED_ALLOWLIST` 注释里的 61 处改为实测 **90 处**。
- 两者恰是本版所要治的病（注释与实测不符）的现场演示；已在注释中写明**边界为何暂不纳入枚举**：
  `export default { A, B }` 的成员是 default 对象的**属性名**而非模块导出名，消费形态为
  `import M from './m.js'; M.A`，按「名字是否出现」判定会命中无关同名符号（假阳性）；
  准确判定需解析 default 导入的绑定名再取属性，属需数据流的另一量级分析。

### 实测形态（90 处 `export default`）
① 裸标识符 **60** 处 + 单行对象字面量 **8** 处（白名单名副其实）；② IIFE **13** 处
（集中在 `apps/asset/engine/`）；③ 多行对象字面量 **9** 处（`cheat-data.js` 18 成员 /
`dt-data.js` 26 成员 / `world-bridge.js` 10 成员 / `medical-core.js` 8 成员等）——
成员名稳定可对账，属本白名单的**边界外覆盖**。

### 验证
- `node scripts/dead-export-check.mjs` → exit 0（`… 无具名成员 90 … 未识别 0`）
- `node scripts/registry-audit.mjs` → exit 0（`… 样式投递 30 个 … 样式内本地引用失效 0` + `两张准入清单存活`）
- `node --test tests/system-v268.test.mjs` → **13 pass / 0 fail**
- `npm run check` → 五道门全绿：语法 339 · 测试 **516 pass / 0 fail** · 死导出零新增 ·
  lifecycle 通过 · registry 通过

### 踩坑记录
- **判据的输入面必须排除非证据**：散文串、门禁自身账本、注释里的提及都不构成投递 / 消费证据。
- **`@import url('x.css')` 被两条正则各匹配一次**导致重复计数 → 改用 `Set` 去重
  （实测：改名 `poker.css` 时报 2 条同样问题，去重后报 1 条）。
- **`const` 声明在 `{ }` 块内、判定段在块外 → `ReferenceError`**，改用 `var` 解决。
- 负控制三处判据修正：**N1** 破坏白名单正则会让 90 条 `export default` 掉进 E9 未识别分支
  （报「枚举面不完整」而非存活失败）→ 改为构造「只有具名声明、无 export default」的 root，并加
  反证断言确保红灯**只**来自 E10；**N4** 锚点计数为 2（注释 + 代码各一处）→ 改用长锚点；
  **N6** 破坏点选错层 → 改为把 `cssLiteralRe` 退化为子串包含语义。
- `edit_file` 对**超长单行**（`index.js` 的 items 字符串）匹配失败，改用 `node -e` 按
  「锚点计数 === 1」校验后精确替换；写入时引入的错字「准2入清单」已归零（`grep -c '准2'` → 0）。

### 遗留项
- **多行对象字面量的成员对账**：9 处（含 `cheat-data.js` / `dt-data.js` 等大对象）成员名稳定可对账，
  但需要解析 `export default` 导入的绑定名再取属性，属数据流分析量级；已写入 `TODO.md`。
- 原方向 (a)「`games.css` 去留」本轮**已结案**（保留 + 修版本号），不再单列。
- 原方向 (b) 会话键前缀宽匹配收紧、方向 (c) 生命周期出口声明式注册，仍在 `TODO.md`。

---
## 迭代 8 — 其它已知方向（待评估）
- **会话键前缀宽匹配收紧**：`/^ruby_/` 覆盖 8+ App 的键，使「键 ↔ App」无法逐项核对。
  属**数据面变更**——收紧后须保证历史数据仍被判为会话隔离，否则旧档串味/丢失。
  须先盘点存量键，并写成一次性迁移核验脚本再动。
- **生命周期出口声明式注册**（架构级）：当前由 lifecycle 门禁兜住，架构级收敛需改动所有 App，
  收益与风险须权衡。
- ~~**`games.css` 转发壳的长期去留**~~ → **迭代 7 已结案**：保留该壳（成本 2 行，防旧缓存路径 404），
  仅修正其版本号漂移（`?v=1.0.0` → `?v=1.0.2`）。该壳的存在理由与「无 Service Worker」的取证结论
  已写入迭代 7 正文；豁免项不再作为「待删除的临时项」，而是有据可查的长期兼容壳。

---

## 元信息

- **仓库**：`/home/user/ruby-phone`（`LonSha/ruby-phone`，SillyTavern 原生第三方扩展）
- **当前版本**：`2.68.0`（四源同源）
- **门禁基线（五道门）**：语法 339 文件 / 测试 **516 pass · 0 fail** / 死导出零新增（冻结 24 条 ·
  枚举面 787 条 export 语句全识别：声明 688 · 成块 8 · 解构 1 · 无具名成员 90）/
  生命周期接线零缺口（35 App 类 · 48 槽位 · REBIND 24 key）/
  注册三方对账无孤儿（40 ↔ 40）+ 样式投递无未覆盖（30 个：打包 25 · 自注入 4 · 豁免 1）+
  两张准入清单存活 + 样式内本地引用失效 0
- **三条硬纪律**：只读（不写上游、不造双份真相）/ 不抛（畸形数据降级不阻断）/ 不猜（取不到如实分态报告）
