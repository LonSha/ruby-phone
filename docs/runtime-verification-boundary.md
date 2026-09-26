# ruby-phone 运行时验证边界（v2.82.0 起；**v3.10.0 复校**）

> 本文件回答一个容易被含糊过去的问题：**哪些结论有证据，哪些没有。**
> 写它的直接动机是 `计划.txt` 建议「新增一个浏览器运行时冒烟层」——
> 而本仓库当前的运行环境**跑不了浏览器**。与其假装，不如把边界写清楚。
>
> **面向用户的读者入口**：本文件的结论会以一句话形式出现在版本更新说明里
> （`update-log.json` 当前版本条目 → App 内「本版更新」弹窗）。
> 这是 TODO P2 ④ 要求的「工程事实也要对用户说清楚」。
> **每次复校都必须同步那条用户可见说明**（判据：`tests/system-v328.test.mjs`）。

## 一、当前环境实测结论（不是推测）

| 项 | 实测（v3.10.0 复校） | 命令 |
| --- | --- | --- |
| node_modules | 不存在 | `ls node_modules` |
| Playwright / Puppeteer / jsdom | 产品侧零命中（仅本文档与更新说明提及） | `grep -rl 'playwright\|puppeteer\|jsdom' .` |
| 网络 | 不可用 | `npx --no-install playwright --version` → missing packages |
| Node 版本 | v24.18.0 | `node -v` |
| 仓库依赖声明 | **刻意为零** | `package.json` 不声明任何 dependencies（注释里写明「避免宿主尝试安装」） |

**结论**：`计划.txt` 建议的「使用独立的 Playwright / 浏览器环境运行」在本环境
**不可执行**。因此本版本**不声称**跑过浏览器，而是把可验证的部分做扎实、
把不可验证的部分显式登记。

## 二、当前已具备的验证层

### L0 语法门 · `npm run syntax`

- 工具：`scripts/syntax-check.mjs`
- 判据：每个 `.js` / `.mjs` 能被 **按 ES Module** 解析（`node --check`）。
- **覆盖面**：文件自身的语法正确性。
- **盲区（重要）**：`import` 的**路径**不检查。文件可以语法 100% 正确、
  却 import 一个不存在的模块 —— 本版 v2.82.0 修的 D1 正是这种：
  `apps/games/sudoku/sudoku-view.js` 写 `'../../config/runtime-lifecycle.js'`，
  实际需三层 `'../../../config/…'`。语法门对此**完全沉默**。

### L1 静态导入可解析门 · `npm run import-resolve`（v2.82.0 新增）

- 工具：`scripts/import-resolve-check.mjs`
- 判据：产品侧（`apps/` `phone/` `config/` `index.js` `workers/` `assets/vendor/`）
  的**静态**相对导入说明符必须解析到真实文件。
- 实测规模（v3.10.0 复校）：**242 个文件 / 345 条静态相对导入**（另 97 条动态 import 不计入判据）。
- 刻意排除：带缓存串（`./x.js?v=…`）、裸说明符、**动态** `import('…')`
  （本仓用它写多路兜底，设计上允许失败）。
- fail-closed：找不到 `index.js`、枚举面低于下限 → exit 2 拒判（不发合格证）。
- 负控制：真源码破坏 → 整树副本 → 重跑真门禁 → 必须 exit 1；复原后必须回 0。

### L2 模块级运行时验证 · `tests/_runtime_host.mjs`（v2.82.0 新增）

- 形态：**进程内最小宿主夹具**，加载**真实模块**（不是重写一份逻辑）。
- 提供：`window` / `document` / `CustomEvent` / `MutationObserver` /
  `SillyTavern.getContext()`（含 `chat` `chatMetadata` `chatId` `eventSource`
  `event_types`）/ `localStorage` 替身。
- **观测面**：登记每一次 `addEventListener` / `removeEventListener`，
  于是「重建 N 轮后 window 上还剩几个监听器」可以被直接断言。
- 实测例证（v2.82.0 的 D2）：修前 5 轮「构造 → `deactivate` → `sudokuView.destroy`」
  在 window 上沉淀 **10** 个监听器（每轮 2 个，线性增长）；修后 0 增长。
- 约束：静态 import 依赖**真实模块路径**，故本夹具在 node 下直接 `import` 仓库源码。
- **v3.9.3 复校的新增能力（世界书干跑取数层 + 长会话取数观测）**：本夹具自 v3.9.1 起可用于驱动
  **长会话取数路径**——`tests/audit/long_chat_probe.cjs` 用 10/100/400/1000/2000 楼的
  合成宿主动真模块，量出「全表物化站点 8 个 / 物化对象数 == 楼层数 / 引擎侧上限 600
  作用在物化之后」。这属于本层能给出的读数：**形态与计数**，仍然**不是**性能读数。

- **v3.10.0 复校的新增读数（知情边界约束面 + 跨 App 时间编排 + 内存/耗时取证）**：
  本层新增三条可观测读数，都属「形态与计数」，**都不是**性能结论。
  ① **知情边界**（`config/knowledge-contract.js`）：上游投影里的「谁知道什么」从**列表出口**
  升级为**约束面**。本层可验的是**三档分形**（`silent` / `unaware` / `unrecorded` 互不混淆，
  且 `unrecorded` 只计数不列名）与**五态分形**（`ok` / `declared-empty` / `face-absent` /
  `no-snapshot` / `bridge-absent`）；**不能**验真机上主 AI 是否真的遵守了这段约束
  —— 约束是提示词层的，遵从度取决于模型。
  ② **跨 App 时间编排**（`config/story-clock.js`）：三源（WorldAxis 世界钟 / lonsha `clock` 面 /
  日历当天）对照。本层可验的是**一致性三态分形**（`agree === null` 没能比 / `true` 比过且一致 /
  `false` 且 `conflict` 比过且不一致）与**绝不猜**（三源全缺时 `primary === null`，
  `Date.now()` 在剥注释的源码里严格只出现一次，绝不用现实时间顶替剧情时间）；
  **不能**验真机上三个来源是否真的指向同一条时间线 —— 那取决于上游投影的实际内容。
  ③ **内存 / 耗时取证**（`tests/audit/memory_growth_probe.cjs`）：模块面堆趋势、事件源 handler
  回收、串生成单次耗时。★ 这一条比前两条更受限：**堆读数在本环境噪声远大于信号**
  （见第三节「仍不能验」那一行的既有登记），故本探针只判**跨轮趋势**（预热后按后半段斜率判
  `linear-acceptable` / `leak-candidate`），**单次字节数不作结论**；事件源读数必须自证
  「峰值高于基线」以排除「根本没订上」的假绿；串生成读数显式带 `not_render: true`，
  标明它不是 DOM 渲染耗时。
  真实 DOM 渲染排版、宿主注入对象内存、小时级堆增长、V8 之外运行时内存四条
  **诚实登记为不可测**（见 `memory_growth_baseline.json` 的 `unmeasurable` 段）。

- **v3.9.3 复校的新增读数（世界书干跑取数层）**：新增 `config/worldbook-dryrun.js`，
  经宿主 `getWorldInfoPrompt` **干跑一次**，取回「此刻真正会被触发的」世界书条目 ——
  与 `WorldbookManager.appendWorldbookMessages` 那条「用户在设置里手选的设定集」是两件事。
  四态分形：`ok` / `activated-fallback`（干跑失败但有 `WORLD_INFO_ACTIVATED` 兜底）/
  `unavailable` / `unsupported`；取不到时 `entries` 为 `null` 而非 `[]`
  （「没给」与「给了 0 条」必须不同形）。
  本层可验的是**取数形状与三态分形**（`tests/system-v329.test.mjs`，14 项）；
  **不能**验真机上这道接口返回的条目与主 AI 实际所见是否逐字一致。

### L3 既有行为门（本版未改，仍在）

`dead-exports`（零消费导出基线）、`lifecycle`（生命周期接线 L1–L4）、
`registry`（注册三方对账）、`keys`（会话键归属）。四道门职责见各自脚本头部。

## 三、本版本**不能**验证的东西（诚实登记）

以下来自 `计划.txt` 的运行时验证六问，本环境**无法给出证据**。
写明「未验证」比写「看起来没问题」有用得多。

| 计划里的问题 | 本版状态 | 为什么不能验 |
| --- | --- | --- |
| 切角色后各 App 状态是否真的清理 | **未验证** | 需要真实宿主 + 真 DOM 渲染路径；夹具的 `querySelector` 恒返回 null |
| 清除数据后是否有残留 | **未验证** | 同上；且涉及 IndexedDB / 宿主文件，夹具没有这些面 |
| 页面重开权限监听器是否重复注册 | **部分可验** | 「模块构造期的 window 监听器」已可计数（L2）；但「面板 DOM 重开产生的监听器」不可验 |
| API 三条路径是否一致 | **未验证** | 需要真实网络/宿主 API |
| 多 App 同听 `MESSAGE_RECEIVED` 是否互相影响 | **部分可验** | `eventSource` 计数面可观测注册数；但真实派发顺序与副作用需真环境 |
| localStorage / chatMetadata / 楼层数据跨会话串味 | **未验证** | 需要真实宿主存储层 |
| 窄屏长文本深色主题是否溢出 | **不可能** | 需要真实排版引擎；夹具没有布局 |
| 长会话（1000 楼）下单次渲染耗时 / 内存快照增长 | **仍不能验** | 夹具不渲染 DOM；`process.memoryUsage()` 在本环境噪声远大于信号。**已验的是「形态与计数」**（全文物化站点数、物化对象数是否 == 楼层数、引擎侧上限是否生效），见 `tests/audit/long_chat_probe.cjs` 与 `tests/audit/long_chat_baseline.json` |
| 世界书干跑取数是否与主 AI 实际所见逐字一致 | **未验证** | 夹具的 `getWorldInfoPrompt` 是替身；真接口的条目裁剪/排序/深度需真宿主 |

**因此**：本版本的判据一律落在「静态结构 + 模块级可观测读数」上。
任何依赖真实浏览器排版/网络/宿主存储的结论，请勿以本仓库的门禁为据。

### 三·附：一句话版本（给不读源码的读者）

> 本扩展的自动化门禁能保证**结构正确与接线完整**（语法 / 导入可解析 / 无死导出 /
> 生命周期与键归属 / 契约对账），以及在**无浏览器的最小宿主**里能观测到的行为读数
> （监听器数量、存储幂等、长会话取数形态）。
> 它**不能**保证真机上的视觉排版、真实网络往返、宿主存储迁移与渲染帧耗时。
> 遇到「看起来没坏但显示不对」的问题，属于本文登记的第二类，需在真机复现后再修。

## 四、运行方式

```bash
npm run check            # 全套本地门禁（含 import-resolve）
npm run import-resolve   # 只跑导入可解析门
npm run test             # 只跑测试套件
node scripts/import-resolve-check.mjs --list    # 列出全部静态导入与解析结果
```

## 五、当版实测数字（**每次复校必须同步**，判据 `tests/system-v328.test.mjs`）

下面两行是**机器可读**的复校契约：门禁会真跑 `syntax` / `import-resolve` 两道门，
把它们的读数与这两行逐项比对，不一致即转红（防「文档写了实测、其实是抄的旧数」）。

- 语法 417 文件
- 导入 242 文件 345 条

未来若拿到可运行浏览器的环境，建议按 `计划.txt` 的四步法补真实层：
① 加载真实或最小宿主夹具 → ② 打开扩展 → ③ 触发切换/清理/收发/重载
→ ④ 采集控制台异常、监听器数量、DOM 状态、存储快照 → 写成可复核报告。
本文件的表格可直接作为「补齐前后」的对照基线。
