# TODO / 迭代积压

> 自主迭代模式下的待办清单。按「先修缺陷 → 再优化体验 → 后加功能」排序。
> 每轮迭代完成后更新（完成项移入 `ITERATION_LOG.md` 对应迭代并在此删除）。

---

## P0 · 缺陷 / 防回归（优先做）

- [~] **源头变更后的下游对齐普查（v2.77.0 只做了生活事件这一支）** ——
      v2.77 修的是「源头改了/删了，下游读数停在旧值」。同一形态在别处可能还有：
      凡是从别处派生出来的读数（生活事件、时间线、搜索索引、看板计数）都要回答
      「源头改了谁负责同步」。建议做法不是逐个手查，而是复用 v2.77 的判据形状：
      给派生层加 `refresh*` / `forget*` 两个出口，逐个源头核对
      「新建 / 编辑 / 删除」三条路径是否都接了。

      进度（v2.79.0）：已查日历备忘（编辑面缺 dateKey，已修）与生活事件库（v2.77 已修）；
      已把「按 sourceId 去重的库必须三条出口齐备」固化为结构判据（system-v279 第 6 条）。

      进度（v2.81.0）：已查**搜索索引** —— `_index` 的失效时机本身没问题（面板每次打开
      `invalidate`），真缺陷在它旁边两条：① 索引**源表**只在构造时建一次，宿主上下文
      （SillyTavern）晚于构造就绪时 `tavern` 源永久缺席、换会话后仍读旧会话数组；
      ② 结果快照 `SearchView._result` 在「重开面板」这条路径上漏了作废，源头改了仍显示旧读数。
      两条均已修，并给出源注册表的「换 / 摘」出口（`replaceSource` / `removeSource`）+
      幂等登记，已固化为 `tests/system-v281.test.mjs`（含真源码破坏型负控制）。
      未查：各 App 看板计数的重算时机；其余按 sourceId 去重的派生库（普查仍在进行中）。

      进度（v2.82.0）：本轮普查**换了失效面**（从「派生读数」转到「加载链与资源沉淀」），
      抓到三类新形态，已修并固化：① 静态 import 路径指错（`apps/games/sudoku/sudoku-view.js`
      少退一层 ⇒ 游戏大厅 App 打不开；新增第七道门 `npm run import-resolve`，289 条说明符
      全解析）；② 构造期全局监听器重建即沉淀（GamesApp/PokerApp 实测 5 轮 +10，已修至 0）；
      ③ prompt 钩子幂等 guard 不一致（MemoryCore 是六处里唯一缺守卫的，已补齐）。
      下游对齐这条主线本身仍在（看板计数重算时机未查）。

      进度（v2.83.0）：换到「存储层损坏恢复」这一面，抓到 D1 —— 命名空间被写成
      **非普通对象**时写入静默丢失（`!x` 判据只挡 undefined/null/''/0/false）。
      实测六场景矩阵：字符串与数字 → `set()` 抛错但只进 console.error（调用方拿到
      已 resolve 的 Promise，**丢掉且不报**）；**数组 → 最危险**：字符串键能赋值、
      能读回（本会话正常），但 `JSON.stringify` 不序列化数组的字符串属性 ⇒ 一落盘全丢。
      已修：共用守卫 `_ensureNamespaceStore`（判据收紧为「必须是普通对象」+ 原值留档
      `__corrupt_backup`），chatMetadata 与 extensionSettings 两处同口径；
      `tests/system-v283.test.mjs` 共 15 条固化。
      进度（v2.84.0）：继续沿存储层再下一层，抓到 **D2 —— 「删除」出口同义不同形**：
      `set(key, null)` 实测**不是删除**，而是把 null 写进存档（键仍在 store 里、
      值为 null、并且**真的进 JSON**）。危害不在多存了个 null，而在全仓对同一个键
      存在**两套结论相反的判据**（同一个键、同一份存档：判据 A 说「在」、判据 B
      说「不在」）：`get()`/`set()`/`remove()` 用 `!== undefined` ⇒ 认为「键存在」；
      `loadApps()` 用 truthy 判据 ⇒ 认为「没有存档」，转去读兜底。
      注意分歧面**不是 defaultValue** —— `get()` 另有第二道 `value !== null` 兜底，
      修前它也返回默认值（初稿论断被负控制测试 9 证伪，已据实改正，
      判据改落 `criteriaDisagree`）。
      调用点实测 3 处（`wechat-data.js:542 / :1754 / :4794`），**全部本意就是删除**。
      已修：`set()` 把 null/undefined 交给 `remove()`，收敛到同一条删除出口，
      并刻意不写成 `if (!value)`（0/''/false 是合法载荷，已用测试 7 锁死）。
      `tests/system-v284.test.mjs` 共 16 条固化。
      同轮**证伪**两条看起来像缺陷的候选（避免后续重复投入，探针 probe_sameexit.mjs）：
      ① `clearCurrentData()` / `clearAllData()` 都**会**清掉命名空间内的
         `__corrupt_backup`（实测清后键表为 `[]`）—— 之前担心的「一处清一处不清」不存在；
      ② `saveExtensionSettings()` 虽然是 `async` 且走队列，但实测**入队即触发**
         （计数 1 → 1，不等 60ms 也已发生），与 `_queuedSaveExtensionSettings(true)`
         在「是否已经发生保存调用」上无差别 —— 不构成「以为保存了其实没保存」。
      同轮第三条候选（`localStorage` 兜底的键空间不对齐）**未被证伪**，
      已提升为 P1 待答项（见下方 P1「存储层其余同义出口普查」）。


- [x] **多行对象字面量的成员对账** —— **已于 v2.73.0 落地（E11）**，原立项理由被实测证伪，见下。
  - **原立项理由（已证伪）**：称消费形态为 `import M from './m.js'; M.A`，
    故「须先解析 default 导入的绑定名再取属性——属需数据流的另一量级分析」。
  - **实测（v2.73.0）**：指向这 9 处多行 default 对象的 **default 导入点为 0 / 9**，
    成员消费**全走具名 import**（如 `import { cheatGachaItems } from '../cheat/cheat-data.js'`）；
    全仓真正经 `.default` 取成员的点只有 6 个（`cheat-data` 与 `dt-data` 各 2 个成员），
    **且只在测试里**。⇒ 该缺口**可静态对账、不需要数据流分析**，原「不能做」的结论建立在错误前提上。
  - **落地形态**：`dead-export-check.mjs` 新增 **E11**（default 面的消费通道对账）——
    ① 登记：模块的产品侧通道为 0 而存在经 `.default` 取的成员时，必须进 `TEST_ONLY_DEFAULT_LEDGER`；
    ② 账本校验：条目须仍命中 ≥1 个访问点（零命中 = 幽灵放行条）、成员须仍有依据（= 账本腐坏），
    两者归因合并 fail-closed（exit 2）。
  - **边界**：属性名**不进导出枚举**（枚举器只抽模块导出名，这一分工不变）；E11 对的是**消费通道**。

## P1 · 体验 / 一致性

- [ ] **剩余「构造期裸全局监听器」逐项收口（v2.82.0 普查出的余量）** ——
      v2.82.0 修的是 GamesApp / PokerApp 两处；同形态（构造函数里内联匿名 handler、
      无 onceFlag、无 globalRuntime 登记、闭包钉住 this）经静态普查在下列位置**仍在**：
      `apps/achievement/achievement-app.js`（`ruby:unlockAchievement`）、
      `apps/diary/diary-app.js`、`apps/wangxiang/wangxiang-app.js`
      （`phone:swipeBack` + `phone:timeUpdated`）、
      `apps/phone/phone-app.js`（`phone:incomingCall` + `phone:swipeBack`）。
      **严重性分层（实测）**：只有会**被重建的槽位**才会真的沉淀。
      `achievementApp` / `diaryApp` / `wangxiangApp` / `phoneApp` 目前全仓
      **没有置 null 的重建点**（逐键 `grep -c` 实测全为 0），故这些属**潜伏**
      （一旦将来某条路径开始重建它们，立刻变成真泄漏）。
      做法：复用 v2.82.0 的 `onceFlag + globalRuntime.addListener + 动态取活实例` 三件套，
      并把 `tests/system-v282.test.mjs` 的源码面判据扩到这份清单（先固化潜伏，再逐个改）。
      原「会话键前缀宽匹配收紧」已于 **v2.69.0** 落地（见下方归档）。

- [ ] **存储层其余「同义出口」普查（v2.84.0 新识别，P0 主线的下一层）** ——
      v2.84.0 修掉了 `set(key, null)` 与 `remove(key)` 这一对同义不同形，并顺手证伪了
      两条候选（`clearCurrentData` 的备份键、`saveExtensionSettings` 的入队语义，见 P0 段）。
      **实测剩下的一条真分歧**：`localStorage` 兜底的**键空间不对齐** ——
        · 写入侧：`_setToLocalStorage()` 只在 `!isChatData` 时被调用（实测：写会话键后
          localStorage 为空；写全局键后出现 `virtual_phone_global_global_phone_settings`）；
        · 删除侧：`remove()` 里的 `localStorage.removeItem(fullKey)` **无条件执行**，
          会话键也会走这一步（实测 `remove(会话键)` 确实尝试删了它）。
      即：**会话键从不写进 localStorage，却会被删** —— 现行为不害人（本来就没有，删不存在的
      键是空操作），但这是「同一个出口对同一个键空间两套规则」。需要回答的是**设计意图**：
      会话键到底该不该有 localStorage 兜底？（若该有，则 `set()` 侧漏写是真缺陷；
      若不该有，则 `remove()` 侧的删除是多余动作，应显式标注「刻意为之」而不是碰巧无害。）
      **注意取证纪律**：这一条结论来自探针实测（键表实际变化），不是读码推断 ——
      后续任何结论都必须同样落在「键表前后对比」这种可执行读数上。

## P2 · 功能 / 架构

- [x] **`计划.txt` 第 386~394 行「四项优先」的落地状态（v2.82.0 结算）**：
      - [x] ① 浏览器运行时冒烟基础设施 —— **已落地但诚实降级**。
        实测无 `node_modules`、无 playwright/puppeteer/jsdom、无网络，真浏览器层
        **不可执行**；改为交付 `tests/_runtime_host.mjs`（进程内零依赖最小宿主夹具
        + 加载真实模块 + 登记每次监听器增删），并在
        `docs/runtime-verification-boundary.md` 里**逐条列出不能验证的东西**。
        将来拿到可运行浏览器的环境，按该文档第四节的四步法补真实层即可。
      - [x] ② 事件监听器 / 生命周期重复注册检测 —— **已落地**：
        `_runtime_host.mjs` 的登记面使「重建 N 轮后还剩几个监听器」可断言；
        `system-v282` 第 7 条即该判据（修前 5 轮 +10，修后 0）。
        余量见 P1 的「剩余构造期裸全局监听器逐项收口」。
      - [~] ③ 关键 App 的存储增长与恢复测试 —— **分维推进中，已交付 2 / 6 维**。
        - [x] **listener 数量**（v2.82.0）：最小宿主夹具登记每次 addEventListener，
          使「重建 N 轮后还剩几个」可断言（修前 5 轮 +10，修后 0）。
        - [x] **chatMetadata 键数 / 字节数**（v2.83.0）：幂等写入 50 次不膨胀、
          数组熔断方向断言（`ruby_xhs_notes` 保留头部）、超大 Base64 拒写、
          损坏自愈幂等且不产生嵌套备份键。
        - [ ] **storage 损坏与版本落后**：损坏的**自愈**已做（v2.83.0）；
          但「版本落后」仍缺 —— 本仓存储层目前**没有 schema 版本号**
          （实测 `config/storage.js` 无 version 字段），无法回答「这份存档是哪个
          格式写的」。需要时先加一个 `storage_schema_v1` 版本戳 + 读侧降级路径。
        - [ ] **1000 楼长会话**（模拟器主项）：需构造 chat 数组并驱动各 App 的
          楼层消费路径；夹具已有 `chatLength` 参数，但消费路径需真实 App 实例。
        - [ ] **流式中断重试 / chatMetadata 保存失败注入**：需在夹具里让
          `saveChat` 可控失败（当前是 `async () => {}`），并观察重试与丢弃行为。
        - [ ] **内存快照增长 / 单次渲染耗时**：需要 `process.memoryUsage()` 与
          真实渲染计时 —— 夹具不渲染 DOM，**渲染耗时这一维在本环境不可测**
          （已登记在 `docs/runtime-verification-boundary.md`）。
        - [ ] **跨会话残留**：夹具可切 `chatId`/`chatMetadata` 实例，属可做项。
        推进原则：一版只做一维、每维都能单独证伪，避免一次性堆庞大模拟器。
      - [ ] ④ 更新文档中的运行时验证边界 —— **未做**（本版只写了
        `docs/runtime-verification-boundary.md`；还没把它接进 `update-log.json`
        面向用户的说明里，因为那属于「对用户说什么」而非「工程事实」，留给下一版）。

- [ ] （待评估）会话切换生命周期出口的**声明式注册**：让每个 App 自声明其出口与
      覆盖关系（如 `static lifecycleExits = { onChatChanged: {...} }`），
      由框架统一调用，从根上消除「写了出口但没人调」与「槽位没人回收」两类形态。
      与 v2.55 的 REBIND 表驱动同源思路，但覆盖面从「重绑」扩到「回收」。

---

## 已完成（归档，详见 ITERATION_LOG.md）

- [x] **v2.63.0** 会话生命周期接线收口：`memoryApp` 接线 + `timeweaverApp.onChatChanged` +
      `_calendarReminderApp` 回收单一真源（含两处实例覆盖点前置回收）
- [x] **v2.64.0** 会话级「槽位 × 三路径」审计：修 `wangxiangApp` 只在换会话路径被清理
      （补 `onChatChanged` 并接入 REBIND 单一真源，收敛 P1 重复显式调用）
- [x] **v2.65.0** 生命周期接线门禁固化：`scripts/lifecycle-audit.mjs`（L1 方法出口 / L2 槽位覆盖 /
      L3 白名单源码派生 / L4 枚举面自证）+ `tests/system-v265.test.mjs`（10 条，含 5 例真源码破坏）
- [x] **v2.66.0** 注册联动门禁固化：`scripts/registry-audit.mjs`（R1 双向覆盖 / R2 宽匹配登记 /
      R3 结构自证）+ `tests/system-v266.test.mjs`（10 条）；README 补 v2.62~v2.65 四段
- [x] **v2.67.0** 注册门禁补第四面：R3 样式投递覆盖（打包 / 自注入 / 显式豁免三选一），
      实测 30 个样式文件零未覆盖；v266 测试扩到 11 条（新增 R3 负控制）
- [x] **v2.68.0** 准入清单存活自证：`dead-export` E10 + `registry` R2b/R3b/R3c
      （三张硬编码白名单零命中即 exit 2 拒判）+ 证据面纯度修复（散文串与门禁自指伪证）
      + `games.css` 版本号修正；`tests/system-v268.test.mjs`（13 条），测试总数 516
- [x] **v2.69.0** 会话键归属显式化：`/^ruby_/` 兜底桶收紧为 11 条精确 + 1 条前缀型；
      新增第六道门 `scripts/keys-audit.mjs`（K1 登记完整 / K2 声明与机制一致 / K3 条目存活，
      一律 fail-closed）+ `tests/system-v269.test.mjs`（16 条，含防「剥引号」回归的守卫）
      + 同轮修四处 items 同源判据的结构缺陷（假红灯/假绿灯）+ v268-N6 去前置数据依赖；
      测试总数 532、六道门全绿

---

## ⚠️ 事故与纪律（务必遵守）

- **血泪教训（v2.65.0 开发期）**：**绝不对真仓库执行 `cp -al` / 硬链接复制**。
  本环境该操作会把已跟踪文件替换成指向临时 l2s 收容所名字的符号链接，造成工作区大面积损坏
  （本次 425 个文件；`git status` 全报 `Operation not permitted`）。
  - 需要副本做破坏性负控制时：走**夹具通道**（合成最小仓库 + `RP_*_FIXTURE=1`），
    与 `scripts/dead-export-check.mjs` / `scripts/lifecycle-audit.mjs` 同款；
  - 确实需要整树副本时先 `tar` 备份，并优先只用判据的真实输入面（如 `index.js` + `apps/**/*-app.js`）；
  - 恢复路径：`git status` 若只显示 `T`（类型变化）而无 `M`（内容修改），
    内容可信，可直接 `git checkout -- .` 从索引恢复。
