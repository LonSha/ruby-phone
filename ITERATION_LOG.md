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

## 迭代 3 — v2.65.0 生命周期审计门禁固化（待启动）

- **类型**：测试基建 / 防回归
- **动机**：迭代 1、2 各修了一类会话生命周期缺陷，但**能力本身没留在仓里**——
  两个探针都在 `/tmp/`，下一次同类缺陷仍要重写脚本。本仓已有成熟范式可照抄：
  `scripts/dead-export-check.mjs` + `dead-export-baseline.json`（冻结基线 + 零新增判定 +
  枚举面完整性自证 + `--list` / `--update` / `--root` 三态）。
- **计划改动**：
  1. `scripts/lifecycle-audit.mjs`——合并迭代 1（方法出口）与迭代 2（槽位覆盖）两个判据：
     出口枚举 + 单例 key 反查 + 槽位 × 三路径矩阵 + 三张白名单
     （**数组泛化调用** `appEntries`、**更强出口覆盖** `deactivate ⊃ destroy`、
     **咽喉点收口** `reloadPhoneSurface → retireSessionScopedSlots`）；
  2. `scripts/lifecycle-baseline.json`——冻结「已知缺口」基线（预期 0 条真缺陷）；
  3. `package.json` 的 `check` 串进门禁（与 syntax / test / dead-exports 并列）；
  4. `tests/system-v265.test.mjs`——审计器自身的正/负控制。
- **负控制纪律（源自既有教训，必须遵守）**：
  真源码破坏（锚点恰中 1 次）→ 加载破坏副本 → **在副本上重跑同款真判据**；
  禁止「对原文件断言」（破坏没发生也绿）、禁止「破坏写死成模拟常量」（真判据没被调用）、
  禁止「破坏把判据自己删了」（自我指涉）。另加判据纯度自证：负控制层内锚点字面量只准声明一次。
- **状态**：待启动（`TODO.md` P0-1）。

---

## 迭代 4 — 其它已知方向（待评估）

- **README 版本段落补账**：README 段落止于 v2.60.0，v2.61.0 / v2.62.0 / v2.63.0 / v2.64.0 未收录。
- **会话键前缀宽匹配收紧**：`/^ruby_/`、`/^games_*/` 覆盖过宽，使「APPS id ↔ 会话键前缀」
  对账无法逐项核对（长期靠人工辨伪）。收紧前须先盘点存量键。
- **生命周期出口声明式注册**（架构级）：让 App 自声明出口与覆盖关系，框架统一调用，
  从根上消除「写了出口没人调」与「槽位没人回收」两类形态。

---

## 元信息

- **仓库**：`/home/user/ruby-phone`（`LonSha/ruby-phone`，SillyTavern 原生第三方扩展）
- **当前版本**：`2.64.0`（四源同源）
- **门禁基线**：语法 334 文件 / 测试 **482 pass · 0 fail** / 死导出零新增（冻结 24 条）
- **三条硬纪律**：只读（不写上游、不造双份真相）/ 不抛（畸形数据降级不阻断）/ 不猜（取不到如实分态报告）
