# ruby-phone 运行时验证边界（v2.82.0）

> 本文件回答一个容易被含糊过去的问题：**哪些结论有证据，哪些没有。**
> 写它的直接动机是 `计划.txt` 建议「新增一个浏览器运行时冒烟层」——
> 而本仓库当前的运行环境**跑不了浏览器**。与其假装，不如把边界写清楚。

## 一、当前环境实测结论（不是推测）

| 项 | 实测 | 命令 |
| --- | --- | --- |
| node_modules | 不存在 | `ls node_modules` |
| Playwright / Puppeteer / jsdom | 全仓零命中 | `grep -rln 'playwright\|puppeteer\|jsdom' .` |
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
- 实测规模：230 个文件 / 289 条静态相对导入。
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

**因此**：本版本的判据一律落在「静态结构 + 模块级可观测读数」上。
任何依赖真实浏览器排版/网络/宿主存储的结论，请勿以本仓库的门禁为据。

## 四、运行方式

```bash
npm run check            # 全套本地门禁（含 import-resolve）
npm run import-resolve   # 只跑导入可解析门
npm run test             # 只跑测试套件
node scripts/import-resolve-check.mjs --list    # 列出全部静态导入与解析结果
```

未来若拿到可运行浏览器的环境，建议按 `计划.txt` 的四步法补真实层：
① 加载真实或最小宿主夹具 → ② 打开扩展 → ③ 触发切换/清理/收发/重载
→ ④ 采集控制台异常、监听器数量、DOM 状态、存储快照 → 写成可复核报告。
本文件的表格可直接作为「补齐前后」的对照基线。
