# TODO / 迭代积压

> 自主迭代模式下的待办清单。按「先修缺陷 → 再优化体验 → 后加功能」排序。
> 每轮迭代完成后更新（完成项移入 `ITERATION_LOG.md` 对应迭代并在此删除）。

---

## P0 · 缺陷 / 防回归（优先做）

- [x] **上游桥读取面的「同一口径被抄 7 份」—— v2.97.0 收口**
      —— 联动侧查到真缺陷：`clock` / `ledger` 的 `probeBridge()` 把**推送型**桥的
      `snapshot`（对象）当函数调用（`bridge.snapshot ? bridge.snapshot() : null`），
      必然抛 TypeError 并被 catch 吞掉 ⇒ snap 恒为 null ⇒ 两个 App 永久显示
      「桥在但没快照」，而桥里躺着完整快照（修前实测 `桥梁实际有快照: true`）。
      根因是「桥有两种发布方式」这件事没人在机制上防：lonsha 桥 = 推送型（对象）、
      WorldAxis 桥 = 拉取型（函数），于是 9 个消费方各写一遍读取。
      收口为单一真源 `config/world-bridge.js` 的 `readPushProbe(win)`（形态判定只此一份、
      两台桥都探、如实带出上游 `sourceState` / `lastError`），9 个消费方全部改走，
      并新增**第九道门** `scripts/bridge-contract-audit.mjs` 把「同一口径只许一份实现」
      变成常驻判据（桥名单一真源 / 禁 `.snapshot(` 调用式 / 出口真被消费 / 禁自写形态判据 /
      扫描面 fail-closed）。实测：桥名自持点 9 → 0、调用式 2 → 0、自写形态 7 → 0，
      消费点 9。详见 `ITERATION_LOG.md` 迭代 29。

- [x] **上游字段三态零消费 + 归因文案表键形漂移 —— v2.98.0 收口**
      —— 沿「上游桥读取面」继续往下看自述面：上游 lonsha（v3.174 起）已在
      `snapshot.meta.fieldTypes` 里为每个顶层字段声明 `{present, kind}`，明确区分
      「源里根本没这项」与「源里给了这项、值是空」，而本仓实测**零消费**：7 个消费方一律
      写成「按对象形取值、取不到就 null」，两种处境压成同一个 `no-*-face`，
      文案还告诉用户「需插件较新版本」（对后一种处境是事实错误的归因）。
      同族第二处更隐蔽：`clock-view` / `ledger-view` 的 `FACE_META` 键写作
      `no_clock_face`（下划线形），真源常量值是 `no-clock-face`（连字符形），
      兜底又指 bridge_absent ⇒ 三种不同处境**一律显示「桥未连接」**，而当时判据全绿。
      落地：真源新增 `readPushField` / `faceFieldState`（面级裁定优先级
      present > absent > legacy-unknown > declared-empty，旧版桥如实报 legacy-null），
      7 个内核接入（粗态 state 为 empty + 细态 reason 为 upstream-empty），
      视图键改计算属性名 + 兜底如实报未知态，门禁追加 J6/J7。
      详见 `ITERATION_LOG.md` 迭代 30。

- [x] **跨仓投影契约（L-F5）—— v3.0.1 收口（下游一半，含两条遗留观察项）**
      上游侧：lonsha-memory-plugin v3.208.0 已有投影管线（声明式 `PROJECTIONS` 表 +
      三态 `ok`/`empty`/`absent` + `reason` 归因），但读数退化成 `this._lastProjection`
      之后**零外供**；**v3.212.0** 补上出口（`buildEnvelope()` + `_buildProjectionEnvelope()`，
      随桥快照 `projection` 字段外供），提交 `a6bdc56`，全量门禁 191/191 文件、1673 断言、
      审计 42/42。
      下游侧（本版）：新增 `config/projection-contract.js` 作为**消费侧单一真源**，把 envelope
      读成手机端可用的面（`contractOf` 五态 / `readProjection` 结构恒定 / given 与 withheld
      **分面** / `projectionValue` 只对 given 面给值 / `projectionLine` 总述），并落成诊断中心
      **第六面**（`collectDiagnose` 的 `projection` + `projItems`、`summarizeDiagnose` 的投影坏消息、
      视图 `_projHtml()`）。字段清单在下游**有意重复一份**（跨仓不能 import + 消费者必须能独立判
      「我认不认得这份结构」），并由 `tests/system-v300.test.mjs` 当跨仓契约快照锁住。
      套件当场捐到一个真缺陷：数值归一 `Number.isFinite(Number(x))` 会把上游**没给**的
      `revision` / `generatedAt` / `expiresAt`（null）报成 **0**（0 全是合法值 ⇒「没给」与「给了 0」
      塌成同形，「从没给过有效期」被算成已过期），已单列 `numOrNull()` 修掉。
      **两条遗留观察项已于 v3.0.1 收口**（详见 `ITERATION_LOG.md` 迭代 33）：① 业务 App
      （place / chars / plotline / clock）各增 `sourceFace()` 归属面并把读数并入 `projection()`，
      四个视图各增「数据来源」卡 —— 迁移形态是「**补归属面**」而不是「换数据源」（上游投影只外供
      6 项窄面，整面塞进投影等于把跨仓稳定契约变成上游内部结构的镜像），数据面与三态归因一个字未动；
      并补上「投影真被业务面消费」的判据（第九道门 J8，消费点下限 4）；② `readPushProbe` 的
      `sourceState` / `lastError` 已收成结构化面 `probeSelf`（诊断页第七卡 + 坏消息先说 + J9 判
      「真读出并落下成面」），与 `bridgeReport` 的账本汇总面刻意不重复。

- [x] **源头变更后的下游对齐普查（v2.77.0 只做了生活事件这一支）** ——
      **已于 v2.96.0 收口**：不再逐轮手查，改为常驻门禁
      `scripts/source-derivation-audit.mjs`（第八道门）+ 三层台账（派生库 3 / 非派生库 7），
      持续回答「枚举面有没有新增未登记的库 / 登记出口是否仍在 / 条目是否仍存活」。
      详见 `ITERATION_LOG.md` 迭代 28。以下为逐轮手查期的过程记录（保留以便追溯）。
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
      进度（v2.91.0）：已查**桌面角标**（各 App 看板未读计数的重算时机）。
      真缺陷不是「重算时机」，而是持久真源 `currentApps` 与渲染副本 `home.apps` 两套数组：
      `loadData()` 换新数组后，微信/微博/扑克写渲染副本、`updateAppBadge`/`saveData` 写真源，
      后写者抹掉未读或留下幽灵红点，下一次 `saveData()` 还可能用过期数组覆盖存储。
      已收口为唯一写出口 `setAppBadge`、只读真源的 `getAppBadge`、以及重建/清数据后的
      `mirrorBadgesToHome`（通知中心、微信、微博、扑克分享、打开 App 清零全部改走写出口），
      固化为 `tests/system-v291.test.mjs`。
      进度（v2.92.0）：继续查按 sourceId 去重的派生库，抓到日历这一支的漏网路径——
      `deleteMemo` 与约定投影移除都会 `forgetDomainLifeEvent`，但 `clearExpiredAutoMemos`
      批量删过期自动备忘时只改备忘数组。领域类型（work/study/travel）的过期条目被清掉后，
      时间线仍持有 `calendar:<id>:<type>`。已改走同一条回收出口，固化为 `tests/system-v292.test.mjs`。
      仍未查：日历以外、按 sourceId 去重的其余派生库。

      进度（v2.93.0）：继续摸这一支，但换了**判定入口**：不再只看「删除路径是否回收」，
      而是先问「这条派生库的源身份是否稳定」。约定支因此露馅——源键写作
      `commitment:<id>:<status>:<revision>`，把状态与修订号写进了身份：
      同一条约定每推进一次状态就换一个源身份，时间线上最多并存 5 条同源条目，
      且由于键漂移，预先写好的回收调用根本找不到它们（终态也不回收）。
      已修：源键改回 `commitment:<id>`，store 补 `removeBySourceBase`（基名或 `基名:` 族，
      兼容旧档带后缀的源键），app/data 两条出口接通，并刻意拒绝「凡不在投影里的约定事件
      一律撒掉」（proposed 本来就不进投影，那样写会误删）。
      固化为 `tests/system-v293.test.mjs`（10 条，含两条真源码破坏型负控制）；
      同时修正 `system-v274` 一条把缺陷当预期的历史判据（原先断言「应有 3 条」，
      改为断言「全程恰 1 条 + 正文跟随 + 终态回收」）。
      教训（已进本文件）：**派生库的源键里不放可变状态**——只要身份会随状态漂移，
      「新增/改写/回收三条出口」写得再齐也全是死的。

      进度（v2.94.0）：本轮主线换到**解析面**（不是派生读数，也不是存储层）：缝合「符号级 JSON
      修复器」（来源 atonal519/ST-MyriadKnots 千千结），治的是本仓最贵的那类形态 —— 模型输出的
      半合规 JSON（缺分隔逗号 / 缺冒号 / 裸键 / 尾逗号）此前只有一句朴素正则兜底，一旦不匹配就
      **整批丢数据且不报错**。四个消费点接线：健康状态桥的交接块、蜜语的弹幕/榜单、通话接听判定、
      设置页图片预设导入。
      同轮**自查修掉缝合自带的一处错读缺陷**（本仓典型的「缝合即引入」）：括号配平器原先在首个
      容器未配平时会继续往后跳，于是被截断的大对象会被读成它内层的某个小对象 —— 形状合法、
      不报错、只是内容错位。改为 fail-closed：容器没配平即整体拒判，绝不退读内层。
      固化为 `tests/system-v294.test.mjs`（16 条），含三条真源码破坏型负控制（抽掉截断闸门 /
      拆掉 fail-closed / 删掉重复键纪律，都在破坏副本上重跑同款真判据并断言转红）。
      教训（已进本文件）：**缝合进来的容错器必须自己也过一遍「只错数据」的审计** ——
      它的错法比原缺陷更隐蔽：原缺陷会丢数据（可发现），它会把数据读错成别的形状（难发现）。

      进度（v2.95.0）：这一支继续往**万象（任务/订单/背包）**摸，五条候选逐条跑真宿主探针定性：
      ① 删订单**记录**不回收背包 —— 视图文案「删除这条订单记录？此操作不会退款或恢复库存」
      判定为**设计本意**（删的是记录，不是已到手的物品），**不修**，并立下守卫防误「修」；
      ② 500 条上限与补发出口「打架」跨重载实测稳定（500→500、丢 0 增 0），**未证实**不列缺陷；
      ③ **证实**：剧情回滚移除已完成任务后，奖励物品 `task:<id>:<index>` 全部残留
      （任务已不存在、派生物品无人回收），与 v2.77→v2.93 主线完全同形；
      ④ 同口径 `abandonTask` 也不回收（该出口当前被 UI 挡住，但口径必须一致）。
      已修：新增**整族回收**出口 `_removeInventoryItemsBySourceBase(base)`（收基名本身或 `基名:` 族 ——
      一条任务最多 10 份奖励各占一键，精确键回收凑不出 `<index>`，等于一条都收不掉），
      两条路径接通并落盘，保留精确键出口给进度回滚（快照里有真键）。
      固化为 `tests/system-v295.test.mjs`（11 条，含破坏树自证 + 三条真源码破坏型负控制）。

      进度（v2.82.0）：本轮普查**换了失效面**（从「派生读数」转到「加载链与资源沉淀」），
      抓到三类新形态，已修并固化：① 静态 import 路径指错（`apps/games/sudoku/sudoku-view.js`
      少退一层 ⇒ 游戏大厅 App 打不开；新增第七道门 `npm run import-resolve`，289 条说明符
      全解析）；② 构造期全局监听器重建即沉淀（GamesApp/PokerApp 实测 5 轮 +10，已修至 0）；
      ③ prompt 钩子幂等 guard 不一致（MemoryCore 是六处里唯一缺守卫的，已补齐）。
      下游对齐这条主线本身仍在（看板计数重算时机已于 v2.91.0 收口，见上）。

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

- [x] **剩余「构造期裸全局监听器」逐项收口（v2.85.0 收口）** ——
      v2.82.0 修的是 GamesApp / PokerApp。同形态四处于 v2.85.0 收进
      `onceFlag + globalRuntime.addListener + 动态取活实例`：
      `apps/achievement/achievement-app.js`（`ruby:unlockAchievement`）、
      `apps/diary/diary-app.js`（`phone:swipeBack`）、
      `apps/wangxiang/wangxiang-app.js`（`phone:swipeBack` + `phone:timeUpdated`）、
      `apps/phone/phone-app.js`（`phone:incomingCall` + `phone:swipeBack`）。
      收口前这四个槽位没有置 null 的重建点，属潜伏而非已泄漏。
      源码面判据在 `tests/system-v285.test.mjs` 第 4 条（四文件不得再有裸 `window.addEventListener`）。
      原「会话键前缀宽匹配收紧」已于 **v2.69.0** 落地（见下方归档）。

- [x] **存储层其余「同义出口」普查（v2.85.0 收口键空间）** ——
      v2.84.0 修掉了 `set(key, null)` 与 `remove(key)` 这一对。剩下的真分歧是
      `localStorage` 兜底的键空间不对齐：写入侧只在 `!isChatData` 时写，删除侧此前无条件 `removeItem`。
      **设计意图已定：会话键不该有 localStorage 兜底。** `remove()` 对会话键显式跳过
      `localStorage.removeItem`，不再靠「键本来就不存在」碰巧无害。全局键仍写仍删。
      判据是键表前后对比（`tests/system-v285.test.mjs` 第 5 条），不是注释。

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
        - [x] **跨会话残留**：夹具可切 `chatId`/`chatMetadata` 实例，属可做项。**v2.90.0 已落地**：`CalendarData.clearCache()` 补清 `_lifeEvents`，`tests/system-v290.test.mjs` B1 固化。
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
