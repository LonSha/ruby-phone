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

## 迭代 2 — v2.64.0 生命周期审计门禁固化 + 假阳性白名单

- **日期**：2026-09-22
- **类型**：测试基建 / 防回归（把一次性审计脚本变成常驻门禁）
- **动机**：迭代 1 的审计能力若只活在 `/tmp/`，下一次同类缺陷仍要重写脚本。
  本仓已有 `scripts/dead-export-check.mjs` + `dead-export-baseline.json` 的成熟范式
  （冻结基线 + 零新增判定 + 枚举面完整性自证），生命周期审计宜照此收编。
- **计划改动**：
  1. `scripts/lifecycle-audit.mjs`——重写审计器：出口枚举 + 单例 key 反查 +
     三张白名单（**数组泛化调用**、**更强出口覆盖**、**纯只读聚合无缓存**）；
  2. `scripts/lifecycle-baseline.json`——冻结「已知零调用」基线（预期为 0 条真缺陷）；
  3. `package.json` 的 `check` 串进门禁，与语法/测试/死导出并列；
  4. `tests/system-v264.test.mjs`——审计器自身的正/负控制（真源码破坏 → 副本上判据必须报警；
     判据纯度自证：负控制层内锚点字面量只准声明一次）。
- **状态**：进行中（见 `TODO.md`）。

---

## 迭代 3 — 会话级数据槽位「出口完整性」审计（待启动）

- **方向**：迭代 1 审计的是**方法出口是否被调用**；本迭代审计**槽位是否被完整回收**。
  即：对 `window.VirtualPhone` 上每个持有实例的槽位，核对三条会话路径
  （P1 换会话 / P2 清当前数据 / P3 清全部数据）是否都做了「解绑 → 置 null / 或重绑」。
- **依据**：本次三处真缺陷中有两处（`memoryApp`、`_calendarReminderApp`）正是**槽位级**而非方法级问题；
  若只审方法出口会漏掉「槽位被顶替而旧实例失去引用」这类形态。
- **状态**：待启动。

---

## 元信息

- **仓库**：`/home/user/ruby-phone`（`LonSha/ruby-phone`，SillyTavern 原生第三方扩展）
- **当前版本**：`2.63.0`（四源同源）
- **门禁基线**：语法 333 文件 / 测试 **477 pass · 0 fail** / 死导出零新增（冻结 24 条）
- **三条硬纪律**：只读（不写上游、不造双份真相）/ 不抛（畸形数据降级不阻断）/ 不猜（取不到如实分态报告）
