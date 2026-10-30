# Agent Note: RubyPhone 第十一期优化提升计划
Status: proposed

> **期号口径**：V9（2026-10-24）是「第九期」提案；「第十期」已由 v4.85.0 承接（R10 十八项机制）。本份为**第十一期**，文件名取 v11（不占用 v10）。
>
> **取证纪律**：本份每一条「真实现场」都在 2026-10-29 于本仓磁盘实读，命令与读数写在
> [第十一期证据与边界](../../../docs/planning/2026-10-29-product-evidence-v11.md)。凡标注
> **（名字级假绿）** 的读数，都是自检/门禁报绿但实际不成立的那一类 —— 本份的立项核心就是它。

## Problem

当前基线 **v4.92.0 / 3c23a90**（V9 提案基线 `v4.57.0 / 7ae54a8`，已漂 35 版）。

本仓这几版最刺眼的事实，是**「机制建成 + 自检绿 + 单测绿 + 产品零消费」已长成稳定形态**，
而现有的三道门（`dead-export-check` / `registry-audit` / `upstream-face-audit`）**没有一道扫这个面**。
逐条实测（全部可复算）：

1. **编排中枢整体不可达。** `config/subsystem-orchestrator.js`（709 行）构造期 `new` 出
   **25 个子系统实例**；其中 **19 个在 orchestrator 内部一次都没被用过**（`this.<prop>.` 零命中），
   剩下 7 个全部只被**同一个方法** `advanceAutonomousLifeStep` 驱动。
   而那个方法：**产品端零调用，全库只有测试 1 处**。⇒ 25 个实例里 19 个是纯 `new` 出来的对象。
2. **中枢的 41 个类方法对任何门都不可见。** `SubsystemOrchestrator` 有 41 个类方法
   （37 公开 + 4 私有），产品端外部调用数**只有 2 个非零**：`runSelfChecks` / `runSelfChecksSync`
   （`index.js:2070-2073` 那个自检读数口）。**34 个方法在产品端 + 测试 + 内部三处全零**。
   根因：`scripts/dead-export-check.mjs` 只抽 `export function|const|let|var|class NAME`，
   **类内方法完全不在扫描面** ⇒ 中枢再空，门也不会红。
3. **「18 项机制全量落地」这句声明的消费面是假的。** 上一版计划我写「notifications=1 / moments=14」，
   那是**名字级假绿**：那 14 次 `moments` 命中是 `phone.moments`（相册）、`sg_` 会话键（社交守卫）
   等同名不同体。按中枢句柄（`subsystems.X`）严格扫描：**产品端 0 命中**；
   `subsystems` 全库只有 2 处 —— `index.js:2050` 装配、`2070` 取自检。**没有一处读业务能力。**
4. **死代码门按名字判，实测可复现。** `config/diff-review-pipeline.js:21 computeParagraphDiff`
   （R9-O6 产物）是**真孤儿**（该文件产品端零 import，只被 `tests/ninth-cycle-diff-review` 引），
   但 `config/diff-editor-desk.js:47` 有同名函数被 orchestrator import ⇒ 门判绿。
   在 `/tmp/rp_probe2` 副本里把 desk 版改名后，门立刻报出**两条**未登记零消费，其中一条就是那个真孤儿。
5. **264 件 `config/*.js` 里，76 件产品端零 import**（只被 orchestrator + 测试引），
   **2 件只被测试引**（`diff-review-pipeline`、`floor-store`），**15 件零 import 完全孤岛**
   （`club-coop`/`mystery-engine`/`reading-studio`/`time-env`/`voice-narrative` 等）。
   76 件之所以没被门抓到，因为 orchestrator 那一行 `import` 就算「已消费」。
6. **文档声称有判据看守的两处，判据文件不存在。** `config/app-library.js:21` 与
   `config/app-surfaces.js:17` 都写「`tests/system-v4870.test.mjs` 会校验/会复核」——
   磁盘上**没有这个文件**（`tests/` 只有 `system-v4860/v4880/v4890/v4920`）。
   全仓 `tests/|scripts/|tools/` 路径声明 410 处，**50 处磁盘不存在**。
7. **`PLAN.md:48-50` 的现状基线表停在 v3.74.0**（漂 118 版），表下自述「本表仍没有判据看守」；
   而 `tests/audit/status-ledger.json` 早就有全套机器读数（`version 4.92.0`、`tests 339`、
   `app_dirs 88`、`apps_ids 89`、`index_lines 13979`、`css_bytes 697022`、`check_chain 15`）。
8. **应用库整个不可达（本轮最重的新发现）。** v4.87.0 交付的「应用库」（`_libraryApps` /
   `openLibrary` / `bindLibraryEvents` / `renderLibraryApp` 共约 143 行 + `phone.css` 22 条规则）
   在 v4.92.0 桌面改「8 核心 + 7 聚合壳」后**失去入口**：`buildDesktopTiles` 的 15 格里没有库入口，
   `_libraryEntry()` **全库仅定义处 1 处、零调用**，`openLibrary()` 唯一调用点是
   `openApp(APP_LIBRARY_ENTRY_ID)` 分支，而那个伪 id 已不再出现在任何一张图标上。
   ⇒ 143 行死代码 + 一个功能面的静默消失，**没有任何门或测试提到它**（`tests/` 零命中）。
9. **分类语义三层分叉，且已造成用户可见错分。** `CORE_APP_IDS` 实为 **21 个**（文档写 20），
   `CORE_DESKTOP_IDS` **8 个**；`appZone()` 判 21 个为 `desktop`、实际平铺 8 个 ⇒ 13 个分叉。
   更要紧的是 `APP_CATEGORY` 只登记 68 键，**21 个核心 App 全部未登记**（靠 fallback `'system'`），
   于是这 13 个非核心核心 App 被塞进 **system 聚合壳**：`weibo/music/health/wallet/memory/xhs/
   tieba/bilibili/worldpulse/search/notifications/mofo/wangxiang` 全部躺在「系统与诊断」文件夹里，
   该壳 **20 个成员**（真系统 App 只有 7 个）。
10. **声明「统一像素图标」但覆盖率 8/89。** `phone/icons/` 只有 9 个 SVG（8 核心 + 文件夹），
    89 个 App 里**81 个落到 emoji/PNG 兜底**。
11. **主题包是死链。** `config/theme-pack.js` 产品端零 import；唯一引用是
    `subsystem-orchestrator.js` 的 `rollbackTheme`，而 orchestrator 零调用 ⇒ 全链断。
12. **门禁预算表过期 169 版。** `config/gate-budget.json` 的 `measured_at` 是 **v3.23.1**，
    有执行器读它、有测试测它形态，**没有判据看它是否还准**。

结论：本仓与兄弟仓同一病、同一位置 —— **建成即交付，接线没人管**；
而两仓的门都只判「导出有没有人叫名字」，不判「类方法有没有人叫」「模块有没有人 import」。
本期九项全部对准这条，**不开新 App、不加新机制**。

## Proposal

### R11-O1 · 死代码门：名字级判定升级为绑定级

- **真实现场**：见 Problem 4。破坏实验可复现：改名被消费那个 ⇒ 门报两条未登记零消费（含真孤儿）。
- **工作包**：把 `scripts/dead-export-check.mjs` 的消费单位从「全仓任何叫 X 的」改成 `模块::绑定`：
  - `import { X } from './m.js'` ⇒ 记 `m.js::X`；
  - 同名跨模块**不算消费**，报告显式写「`m.js::X` 与 `n.js::X` 同名不同体」；
  - 保留现有 E1~E11 全部口径（测试不算消费、E6 去注释、E7/E8 跨行与解构、E9 枚举面自证）。
    本轮**只换消费判定的单位**，不动枚举面 —— 枚举面已经 4809 条 0 未识别，是最健康的一层。
- **禁止的解法**：`--update` 抬基线；把同名加进白名单；只在报告里加一句提示而判定仍按名字。
- **验收**：夹具「A 有同名孤儿 / B 的同名被消费」⇒ 旧口径绿、新口径红；反方向（真接线但同名）两口径都绿。
  **负控制用真源码破坏**：`sed 's/computeParagraphDiff/computeParagraphDiffX/g' config/diff-editor-desk.js`
  后新口径必须单独点名 `diff-review-pipeline.js::computeParagraphDiff`（现在它混在两条里，靠人看）。
- **规模**：**1.5 天**。

### R11-O2 · 类方法与模块级消费纳入扫描面

- **真实现场**：见 Problem 2、5。`dead-export-check` 报「扫描 673 文件 / 4641 个 export 声明 / 零消费 96」
  —— **一个类方法都没算**。而本仓最大的窟窿恰在类方法（orchestrator 41 个）与模块级（76 件 config）。
- **工作包**两段：
  - **类方法面**：枚举 `export class` 的公开方法，登记 `class::method`，判据同 O1（绑定级）；
    台账 `scripts/dead-method-baseline.json`（冻结账本口径：新增未消费即红、已消费的账本项只提示）。
  - **模块面**：`config/*.js` 与 `phone/*.js` 的**入度**单独成表（谁 import 它），
    并区分三档：`product` / `orchestrator-only` / `test-only` / `zero`。
    判据只判「新增件落入 orchestrator-only 或 zero」即红 —— **存量 15+2+76 一次登记为冻结基线**，
    不许一次性清零（会牵连整批 App）。
- **扫描面塌陷守卫**：类数 < 下限、模块数 < 下限 ⇒ `exit 2`（沿用 E5 的思路）。
- **验收**：把 orchestrator 任一类方法的调用点归零 ⇒ 红；把某 config 件从产品 import 里删掉
  ⇒ 落入 `orchestrator-only` 且未登记 ⇒ 红；扫描面塌陷 ⇒ `exit 2`。
- **规模**：**2 天**。
- **✅ 落地（v4.94.0 / 迭代 220）**：`scripts/lib/dead-surface.mjs` + `scripts/method-consumption-audit.mjs`
  + 两份冻结账本（`scripts/dead-method-baseline.json` 332 条、`scripts/dead-module-baseline.json` 94 件），
  接入 `npm run check` 第 17 段（紧跟 `bind-consuming`）。当版档 `tests/system-v4940.test.mjs` 22 条。
- **实测与计划的偏差（如实记）**：
  - 计划写「76 件只被中枢引 + 17 件零 import + 2 件只被测试引」，实测 **79 orchestrator-only + 15 zero = 94 件弱档**。
    差异来自扫描面 `skipDirs` 与 `test-only` 档的处理方式：实现取**含 tests 的视角**分档（真仓 274 件顶层模块，
    product 180 / orchestrator-only 79 / zero 15），计划那组数按排除 tests 的视角数。**结论方向一致**（弱档占三成），
    具体数字以账本为准。
  - 计划写「判据同 O1（绑定级）」，实做**没有**按绑定级做方法面。原因是实测反证：App 方法大量由框架回调调用
    （view 里写 `app.某方法`，而 view 与 app 之间没有 import 边），按类级绑定面判会把整批 App 方法判死 ——
    实测 `GamesApp` 一次假报 77 条、人工核对 0 条真死。故改用**最保守口径**：方法名在全仓真代码（掩码面 + 原文面并集）
    除声明行外零出现才判死。这条口径是**下界**，宁可漏报不出假红。
  - 计划写「类方法面首次纳入会一次翻出大量旧账」—— 实测 4803 条公开方法里 332 条零提及（6.9%），
    与计划 Problem 2 里「orchestrator 41 个方法中 34 个零消费」的比例吻合（实测正是 34 条）。
- **本条给 O3 的前提已就位**：O3 要求「41 个方法逐个定生死」，现在门能看见这 34 条了；下一步 R11-O3 可直接按账本逐条处置。

### R11-O3 · 中枢清账：25 实例 / 41 方法逐个定生死

- **真实现场**：见 Problem 1、2、3。这是本期最大一笔，也是最容易被写成「加白名单就绿」的一笔。
- **工作包**：对 **25 个实例**与 **41 个方法**逐个三选一：
  - **接线**：指定 owner App（`apps/<x>/`）+ 触发时机（打开 / 动作 / 定时）+ 可见反馈（界面变化或落盘数据）；
  - **合并**：同一能力的多方法包装合成一个对外入口（`trackCadenceThread` / `checkResponseCadence` /
    `relayIntent` 看着就是一族；`executeCompositeAction` / `rollbackCompositeAction` 与
    `crossapp-transaction-stack` 的 `createTransaction/commitTransaction` 疑似重复，须核对后定）；
  - **退役**：删方法 + 删对应 import + 在 `ITERATION_LOG` 写明「v4.85.0 的哪项声明据此降级为虚」。
- **禁止的解法**：`--update`；把方法名塞白名单；写 `void this.xxx()` 这类假驱动；
  只加 `window.VirtualPhone.subsystems.xxx = () => this.xxx()` 却无人调用（那只是把死代码搬了个家）。
- **产品结果**：v4.85.0 承诺的十八项（拟真通信 / 常驻通知 / 光影 / 全局搜索 / 智能相册 / 电池 /
  弱网 / 虚拟文件系统 / 触感输入法 / 网盘 / 短视频 / 朋友圈 / 外卖 / 窃听 / 手环 / 分身 / 日程 / 梦境）
  **每一项都要么在真机点得开，要么从声明里撤掉**。
- **验收**：41 个方法不再有「产品端 0」且未退役的项；25 个实例不再有「内部也从未使用」且未退役的项；
  破坏任一接线点 ⇒ 当版套件红。
- **规模**：**4~5 天**。
- **【落地记录 · 第一批 v4.95.0 / 迭代 221】**
  - **判活口径先定（计划未写、实测必需）**：「产品端可达」= **产品文件里存在真 import 语句**
    指向该模块，而不是「名字在产品面出现过」。首版探针按名字判，33 条全判「应接线」——
    那次 1 命中就是声明文件自己；排除声明文件后反向全绿、34 条全判「应退役」，
    因为聚合器里的调用也被一并排除。两版失败都留在 `/home/user/rp_o3_triage*.mjs` 作对照。
  - **实测结论**：34 个 orchestrator 方法产品端零提及（与账本完全一致）；
    34 条链里 **33 条产品端不可达**（底层模块 importers 只有 `config/subsystem-orchestrator.js`，
    部分另有 tests），仅 `auditReadability` 可达。与 Problem 2 的描述吻合。
  - **第一批只处置 1 条**：`manageUsageParadigm` → `config/usage-paradigm.js` → 主屏 + 洞察 App。
    - 洞察 App 新增读写口 6 个（`readParadigmState` / `activeParadigm` / `paradigmOptions` /
      `switchTo` / `saveParadigm` / `copyToCustomParadigm`），View 新增范式面板与事件绑定；
    - 主屏 `buildIconPages` 真调 `resolveAppOrder`，且**壳的次序由壳内最靠前成员的名次决定**
      —— 范式里的优先项绝大多数是聚合壳内部成员，只排 15 个桌面格子的话换挡几乎无变化；
    - 存储新键 `usage_paradigm_v1`，与 `usage_settings_v1` 分键（清设置不该重置全局范式）；
    - 门读数：模块入度 orchestrator-only 79 → 78、product 180 → 182；账本手工摘 1 条（94 → 93），**未用 `--update`**。
  - **验收现状**：`tests/system-v4950.test.mjs` 16 条（含「四档必须给出四个不同桌面序」
    「换挡前后格子集合恒等」「未知 id 不改盘」「写盘抛错不谎报成功」与接线自证），
    F4 的负控制抓出过一次判据自身写错字段名（账本条目叫 `rel`，首版写成 `module || file`，
    在账本里明明还有这条时照样绿）——已改为先钉字段名再下结论。
  - **未处置（如实）**：余 32 条链与 34 条零消费方法一条未动；10 个产品面零消费实例类
    （mutexGuard / mimicComm / autonomousScheduler / galleryVault / vfs / cloudDrive /
    shortVideo / smartBand / personaSpaces / calendarLife）未逐个定生死；
    `filterNoticesByParadigm` 仍未接产品端（缺一个真读通知等级的消费点，不做半截）。

### R11-O4 · 文档声明的路径必须存在（410 声明 / 50 落空）

- **真实现场**：见 Problem 6。其中**有意义的一类**是「散文声称有判据看守，但文件不存在」：
  `system-v4870.test.mjs` 被两处点名却无此文件。另一类是**上游路径声明**（
  `tests/audit/scan_cross_repo_binding.mjs`、`scan_open_faces.mjs` 属上游仓，正当引用）——
  判据必须能区分这两类，否则会误杀。
- **工作包**：写 `scripts/doc-path-claim-audit.mjs`：
  - 抽取 `tests/|scripts/|tools/` 形态路径；
  - 分两类：**本仓声明**（必须存在）/ **他仓声明**（显式标注 `upstream:` 前缀或命中已知上游清单才算通过）；
  - 存量 50 条一次性分类入台账（本仓缺失：修或改文案；他仓引用：标 `upstream:`）；
  - 新增未登记即红。
- **验收**：把 `app-library.js:21` 那句「`tests/system-v4870` 会校验」改成真判据文件 **或** 改文案 ⇒
  两种都通过（但需在台账写明选了哪种）；新造一条引用不存在本仓文件 ⇒ 红；引用上游路径 ⇒ 绿。
- **规模**：**1 天**。

### R11-O5 · PLAN 基线表接机器台账（消灭 v3.74.0）

- **真实现场**：见 Problem 7。
- **工作包**：`tools/gen_plan_baseline.mjs` 复用 `tools/gen_status_ledger.mjs` 的取数函数
  **直接改写** `PLAN.md` 那三行（版本 / 门禁 / 体量）；配套轻判据「表内数字 ≠ 台账即红」。
- **验收**：手改表内任一数字 ⇒ 红；`--write` / `--check` 双向通过；
  三处陈旧读数（`v3.74.0` / `apps 81` / `config 67`）修正为 `4.92.0` / `89`（`app_dirs 88` 另注）/ `264`。
- **规模**：**0.5 天**。

### R11-O6 · 分类语义三层收敛（已造成用户可见错分）

- **真实现场**：见 Problem 9。不是纸面分叉 —— system 壳 20 个成员里 13 个是「图片/音乐/健康/钱包/
  记忆/搜索/通知/微博/贴吧/B站/小红书/世界脉搏/摩佛」，用户点开「系统与诊断」会看到一堆内容类 App。
- **工作包**：
  - 概念定死写进 `CONTEXT.md`：`CORE_APP_IDS` = **预装不可删**（21）、`CORE_DESKTOP_IDS` = **桌面首屏**（8）、
    `APP_CATEGORY` = **库类目**（须覆盖全部 89 而非 68）；三者的关系与优先级一句话说清；
  - `APP_CATEGORY` 补齐 21 个核心 App 的类目（即使它们不进壳，也要有类目，供搜索/库使用）；
  - 13 个「zone=desktop 但不平铺」的 App 给出明确落法（进对应内容壳 + 从 system 壳移出）；
  - 补判据：`APP_CATEGORY` 必须覆盖 APPS 全集；任一壳成员数超过阈值（如 12）须显式登记理由。
- **验收**：system 壳成员 ≤ 12 且全部是系统/诊断类；`APP_CATEGORY` 覆盖 89/89；
  把两表合并成一张 ⇒ 判据红（防又混回去）。
- **规模**：**1.5 天**。

### R11-O7 · 应用库不可达修复（143 行零入口）

- **真实现场**：见 Problem 8。`_libraryEntry()` 零调用；`openLibrary()` 唯一入口是伪 id 分支，
  而伪 id 已不在任何图标上；`tests/` 对 `openLibrary|_libraryEntry|__library|_libraryApps` **零命中**。
- **工作包**（必须先定产品决策，二选一，不许含糊）：
  - **A 复活**：把「应用库」作为桌面上第 16 格（或 dock 入口）接回，库内保留搜索 + 7 类目分组；
    与聚合壳分工写进头注：**壳 = 分类浏览，库 = 全量搜索**。
  - **B 退役**：删 `_libraryApps/_libraryEntry/openLibrary/renderLibraryApp/bindLibraryEvents` 与
    `phone.css` 那 22 条规则，`APP_LIBRARY_ENTRY_ID` 一并从 `app-library.js` 删除，
    并在 `ITERATION_LOG` 写明「v4.87.0 的应用库被 v4.92.0 桌面重绘取代」。
- **禁止**：留着代码不接（现状），或只加一个隐藏入口让门看不到。
- **验收**：选 A ⇒ 真机点得到、搜索能命中 89 项、`tests/` 新增覆盖；选 B ⇒ 相关标识符全仓零命中。
- **规模**：A 1.5 天 / B 0.5 天（**建议 A**：搜索是聚合壳缺的能力，删了要重做一遍）。

### R11-O8 · 图标覆盖补齐（声明「统一像素」实为 8/89）

- **真实现场**：见 Problem 10。
- **工作包**：按 `tools/gen_pixel_icons.py` 既有生成器扩到 89 个 id（16 色盘 + 整数几何 + `lintPixelSvg` 必须过）；
  分批交付：先补 13 个「曾平铺的核心」+ 7 壳内最大类目的前 20 个，其余按使用频次排。
  允许分批，但**每批都要有覆盖率读数**，且判据从「≥9 个」改为「覆盖率单调不减」。
- **禁止**：把判据从 `>=9` 调成 `>=9` 就算完（现状）；用 emoji 冒充像素图。
- **验收**：覆盖率从 8/89 提到 ≥50/89 且每张过 `lintPixelSvg`；`system-v4920` 的图标断言改为覆盖率断言。
- **规模**：**1.5 天**（生成器已存在，主要是配色与几何打磨）。

### R11-O9 · 时效判据：预算表与台账的「上次测量」必须可见

- **真实现场**：见 Problem 12。`gate-budget.json` 的 `measured_at` = **v3.23.1**（漂 169 版），
  15 门全登记、执行器真读、测试真测形态 —— 就是没人问「这数还准吗」。
- **工作包**：给 `gate-budget.json` 与 `status-ledger.json` 各加一条**时效**判据：
  - 预算：`measured_at` 落后当版超过 N（先取 20）⇒ **告警不红**（沿用 fail-open 纪律），
    并在 `npm run check` 输出一行「预算基线 v3.23.1，已落后 169 版，建议复测」；
  - 台账：`generated_by` 的产物与磁盘读数不一致 ⇒ 红（这条其实已在 `--check` 里，补 PLAN 侧接线，见 O5）。
- **验收**：把 `measured_at` 改成 `v0.0.1` ⇒ 输出落后告警、退出码不变；改成当版 ⇒ 无告警；
  台账读数与磁盘不符 ⇒ 红（不是告警）。
- **规模**：**0.5 天**。

## Delivery sequence

1. **先让门能看见（O1 → O2）** —— 绑定级与类方法面是**前提**：不做这两件，O3 的「已接线」
   会被同一批名字级假绿误判成绿（本期一开始就踩过一次，见 Problem 3）。
2. **最大一笔清账（O3）** —— 25 实例 + 41 方法定生死。
3. **再修三类静默损失（O7 → O6 → O4）** —— 功能面消失（应用库）、分类错分、判据幽灵。
4. **最后收口文档与读数（O5 / O8 / O9）** —— 基线表、图标覆盖率、时效告警。

## Alternatives considered

- **直接开 R9/R10 的新工作包**：否决。25 个实例里 19 个连 orchestrator 内部都没用过，
  此时开新包等于在不可达的中枢上再叠一层。
- **把 41 个方法一次性全接到 UI**：否决。同族方法（`trackCadenceThread`/`checkResponseCadence`/
  `relayIntent`）先合并再接，否则面板会多出十几个语义重叠的按钮。
- **O7 选 B（删库）**：可行但不推荐。聚合壳二级页现在**无搜索无排序**（system 壳 20 项挤一屏），
  库的搜索正是缺的那块；删掉后 O8 的等价物还得重做。
- **O2 一次性清零 76+15 件悬空 config**：否决。会牵连整批 App，且其中相当一部分是上游缝入的
  运行时资产（`reading-studio`/`time-env` 等被产品端以字符串方式使用）。**只判增量**。
- **用 `--update` 抬死代码基线**：否决，等于把「没人用」合法化，而 v4.85.0 的声明还挂在更新日志里。

## Acceptance criteria

九项都必须：

- 给出**可复算命令与读数**（写进该项正文或证据页）；
- 带至少一条**真源码破坏负控制**（不是对原文件断言，也不是写死模拟常量）；
- 产品端改动要有**真机可点的入口**（O3 / O7 尤其），不能只出 API；
- 诚实边界如实写：哪些只有结构证明、哪些真机验过。

## Risks

- **O3 是本期最大风险**：25+41 逐个定生死，最容易「接成假驱动」。纪律：每接一个必须给
  **一个能看见的结果**（界面变化 / 落盘数据 / 诊断读数），否则算没接。
- **O2 会一次翻出大量旧账**：类方法面首次纳入，`apps/*/*.js` 里 class 极多。
  策略：先出**存量清单**一次性冻结，**只判增量**。
- **O6 是产品决策**：13 个 App 该进哪个壳没有唯一正解，需与用户确认一次分档，不许自己拍。
- **O7 必须先定 A/B**：不定就动手 = 又留一批悬空代码。
- **O8 是观感活**：替身与门禁只能证「有图且过 lint」，不能证「看着对」，须真机核一次。
