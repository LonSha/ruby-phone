# RubyPhone 第十三期计划 · 基线、证据与验收边界

> 配套文档：优化提升 [2026-10-31-product-optimization-v13.md](../../.agents/notes/proposed/architecture/2026-10-31-product-optimization-v13.md) · 拓展创新 [2026-10-31-product-expansion-v13.md](../../.agents/notes/proposed/feature/2026-10-31-product-expansion-v13.md)
> 期号：**R13**（跳过 R12，理由见第一节末尾）。记忆侧配套 `L13`。
> 本页所有读数均为 **2026-10-31** 现场实测。本页**只记录证据**，不代表任何功能已实施。

---

## 一、基线读数（复算命令逐条给出）

| 量 | 读数 | 复算命令 |
|---|---|---|
| 版本 | **v4.99.9** | `node -e "console.log(require('./package.json').version)"` + `update-log.json` latest |
| HEAD | **e057a4d** | `git rev-parse --short HEAD` |
| `index.js` | **14107 行** | `wc -l index.js` |
| `phone.css` | **708497 字节** | `wc -c phone.css` |
| Apps 目录 | **88** | `ls apps \| wc -l` |
| `config/apps.js` 条目 | **89** | `node -e "import('./config/apps.js').then(m=>console.log(m.APPS.length))"` |
| `config/` 件数 | **276** | `ls config \| wc -l` |
| `tests/*.test.mjs` | **355** | `ls tests/*.test.mjs \| wc -l` |
| `scripts/` 件数 | **28** | `ls scripts \| wc -l` |
| 图标 | **90 个 svg**（89 app + 1 文件夹） | `ls phone/icons/*.svg \| wc -l` |
| 静态门 | **十八道全过** | `npm run check` |
| 最大文件 | `apps/wechat/chat-view.js` **1006838 字节** | `find apps -name '*.js' -printf '%s %p\n' \| sort -rn \| head` |

**「apps 88 目录 vs apps.js 89 条 id」的差 1 是既有事实**，不是本期引入：`config/apps.js` 里有一条 id 不对应独立目录（历史上已知）。本页如实登记，不解释成对齐。

### 期号裁定（为什么是 R13 而不是 R12）

```
$ grep -rn 'R12' --include=*.md --include=*.js --include=*.mjs .
./docs/runtime-verification-boundary.md:380  →  「第十二条判据 R12」
./update-log.json                            →  R12-d 本版说明
```

`R12` 已被「第十二条判据」（挂在 `scripts/upstream-face-audit.mjs` 内的反向面「声明 ↔ 真码」对账）占用。若本轮占用 R12，后续读到 `R12` 的人无法判断它指期号还是指判据——这正是记忆侧第十一期被迫改名 L12 的同一类事故。**故跳过 R12**。

---

## 二、门禁全绿读数（十八道）

```
$ npm run check
syntax → import-resolve → test → dead-exports → bind-consuming → method-consuming
→ lifecycle → registry → keys → source-derivation → bridge-contract → weak-coercion
→ named-import → screen-host → session-writeback → hardlink-safety → doc-path-claim
→ upstream-face      全部通过
```

三门审计定量读数（R11-O2/O3 的成果，本期作为「不重复开刀」的依据）：

```
[dead-export] 扫描 695 文件 / 4754 export 声明（内部消费 3323 · 跨文件消费 1350 · 零消费 81）
[dead-export] 枚举面完整性：4922 条 export 语句全部被识别 · 未识别 0
[dead-export] ✓ 无新增零消费导出

[method-audit] 扫描 695 文件 / 282 个带方法类 / 4954 条公开方法
[method-audit] 死方法 311（类被 new 过 175 / 类从未 new 136）/ 基线 311 / 新增 0
[method-audit] 模块入度 284 件：product=207 / orchestrator-only=65 / zero=12；弱档 77 / 基线 77 / 新增 0

[bind-audit] 扫描 695 文件 / 4743 导出 / 绑定级死 113 / 基线 113 / 新增 0
```

⇒ 三项「新增 0」，说明 R11 的判定升级已稳定。**本期不重开这一刀**。

---

## 三、真浏览器门：假绿的完整证据链

### 3.1 门本身是好的

`tests/browser/gate.mjs` 三层 fail-closed，注释逐字：

- `:17` 环境层：无浏览器 ⇒ 未执行（exit 2），**不得计通过**
- `:18` 结构层：场景数与视口数低于下限 ⇒ 拒判（exit 2）
- `:19` 读数层：任一条判据 FAIL ⇒ exit 1
- `:70-73` `MIN_SCENES=7` / `MIN_VIEWPORTS=4` / `MIN_READS_PER_SCENE=2`
- `:96` 「场景被删/glob 写错会让本门『零失败』而全绿，属 fail-open，必须拒判」

### 3.2 但它没接在链上

```
$ node -e "const p=require('./package.json');for(const k of Object.keys(p.scripts))console.log(k)"
check / syntax / test / dead-exports / lifecycle / registry / keys / source-derivation
/ bridge-contract / import-resolve / weak-coercion / upstream-face / doc-path-claim
/ check:file / named-import / screen-host / session-writeback / hardlink-safety
/ bind-consuming / method-consuming
```

**没有任何 `browser` / `gate` 键。** `check` 拼的十八道门里没有浏览器层。

### 3.3 而且内容已过期 —— 真跑必红

```
$ grep -rn 'ok: .*=== [0-9]\{2,\}' tests/browser/scenarios/*.scen.js
tests/browser/scenarios/o1-app-enumeration.scen.js:22:
  report({ name: 'enumeration-source', ok: ids.length === 83,
           detail: 'config/apps.js 条目 = ' + ids.length + '（判据要求 83）' });

$ node -e "import('./config/apps.js').then(m=>console.log('APPS len=',m.APPS.length))"
APPS len= 89
```

⇒ **这条判据只要真跑就必然转红**。它至今没红，唯一解释是它没跑过。

### 3.4 覆盖面：2 / 88

`tests/browser/scenarios/` **37 个文件**：

- `_diag*` **25 个**（`_diag2` ~ `_diag26`）
- 命名场景 **12 个**：`o1-*` 7 个（`app-data-states` / `app-enumeration` / `chat-switch` / `core-flow` / `search-cancel` / `settings-save` / `shell-smoke`）· `o6-*` 3 个（`longlist-extreme` / `longlist-perf` / `motion-throttle`）· `o7-*` 2 个（`perf-probe` / `reopen-leak`）

按 `apps/<x>` 反查，只命中 **`apps/calendar`（6 次）** 与 **`apps/clock`（1 次）**。⇒ **88 个 App 目录里 86 个从没被真排版引擎打开过一次**。

而 `docs/runtime-verification-boundary.md` 里 `R-O3` 出现 **26 次** —— 它是这份文件里最常出现的「这件事归别人」。

### 3.5 这条证据链的意义

本仓文档反复讲「看起来没坏但显示不对」这一形态。**浏览器门本身是该形态的顶层实例**：它有一整套严格的自检、有 37 个场景文件、有 fail-closed 三档 —— 而它没有接在链上，所以它的绿是假的。这不是「门不够多」，是**门后面没有人**。

---

## 四、12 件零入度模块与产品面的真实距离

`scripts/dead-module-baseline.json` 头部的 `rule` 逐字：

> 「只判增量：已建件只有中枢引、或完全孤岛，是存量债（计划 O2 明令不许一次性清零），不是本版引入的问题。」

`entries` 共 **77 条**（`orchestrator-only` 65 + `zero` 12）。`zero` 12 件逐项实测 `apps/` 引用数：

| 模块 | 声明标签（ITERATION_LOG.md） | `apps/` 引用 | 字节 |
|---|---|---|---|
| `club-coop` | R6-X3 社团共营 | **0** | 11755 |
| `daily-theater` | R6-X1 共同生活剧场 | **0** | 9519 |
| `mentorship-colearn` | R6-X8 师友共学 | **0** | 3387 |
| `multi-activity-reroute` | （改道多人活动） | **0** | 13076 |
| `mystery-engine` | R6-X6 手机原生推理剧 | **0** | 9134 |
| `parallel-life` | R6-X9 平行人生试玩场 | **0** | 5676 |
| `relation-revisit` | （可重访关系往事） | **0** | 6884 |
| `serial-narrative` | R6-X7 跨媒介连载 | **0** | 5725 |
| `social-ecosystem` | （持续社媒生态） | **0** | 9125 |
| `story-reentry` | （续玩再入场） | **0** | 10044 |
| `time-env` | — | **2**（`apps/memory/memory-data.js` / `apps/settings/settings-app.js`） | 5195 |
| `voice-narrative` | R6-X5 可演出声音叙事 | **0** | 8803 |

**唯一成活的对照件**：`commission-pipeline`（R6-X4 委托创作）**已被** `apps/creationdesk/creationdesk-app.js` 消费。

### 结论与它推翻的那句话

`PLAN.md:6` 的表格头写「第六期编号（**历史已承接**）」。对这批模块而言，**在 `apps/` 层面这句话不成立** —— 九件里只有一件有产品面入口。

这不是「还没做」，是「做了、进库了、用户碰不到」。而 `dead-module-baseline.json` 的 `rule` 又明令不许一次性清零，所以本期的处置只能是**逐件 A/B 决策**（优化面 O3），不是一刀切。

---

## 五、撤销面实测

```
$ grep -rn 'undo\|撤销' --include=*.js apps index.js config | wc -l
336
$ grep -rln 'undo\|撤销' --include=*.js apps index.js config | wc -l
…
$ # 逐 app 统计（13 个 app 有命中，75 个 app 为零）
```

有命中的 13 个 app 里，`apps/games/board/` 的 chess / gomoku / jungle / shogi / xiangqi 五个 **engine** 全在列表 —— 那是**棋盘 AI 的悔棋**，不是「用户改坏了能回」。

同期 `deleteItem|removeItem|clearAll|清空` 命中 **323 处**。

⇒ 「可逆」这条产品主轴在当前代码里**只对棋类成立**。

---

## 六、时间源分裂实测

```
$ grep -rn 'Date.now()' --include=*.js apps | wc -l
758
$ grep -rn 'new Date()' --include=*.js apps | wc -l
69
$ grep -rln 'worldClock\|nowSource\|clockNow' --include=*.js config apps index.js | head
config/crossrepo-registry.js
config/time-manager.js
config/world-bridge.js
apps/clock/clock-data.js
apps/clock/clock-view.js
apps/worldpulse/worldpulse-engine.js
```

⇒ 单一 now 源（`config/time-manager.js`）只被 7 个文件提及，而 `apps/` 下有 758 + 69 处裸取时间。对一个拟真手机，这意味着**照片时间戳与消息时间戳可能对不上** —— 玩家最容易察觉、最难描述的一类错。

---

## 七、空态、设置时机、入口陈旧的读数

### 7.1 空态

```
$ grep -rn '没有内容\|暂无\|空' --include=*.js apps/*/*-view.js | wc -l
543
$ grep -rn 'empty-state\|空态\|loading' --include=*.js apps index.js | wc -l
147
```

数量不缺，缺**分形**：空相册可能是「真的没照片」「筛选滤空了」「存储读失败」三种处境，界面上长得一样。

### 7.2 设置生效时机

```
$ grep -rn 'next-turn\|立即生效\|重启后生效' --include=*.js apps config | wc -l
3
```

而 `apps/settings/settings-app.js` 是 **747560 字节 / 11871 行**。⇒ 用户改了开关**不知道何时生效**。

### 7.3 入口陈旧

```
$ head -1 TODO.md
> **最近更新：v4.54.0**
```

`TODO.md:4` 的「现行产品待办（2026-10-15）」指向**第四期 R4**。实际 v4.99.9 —— **差 45 个版本**。

`PLAN.md` 顶部仍指「第九期产品计划（2026-10-24）」，规划基线写 `v4.57.0 / 7ae54a8`（实际 v4.99.9 / `e057a4d`）。

**已落的一半**：`tests/system-v4980.test.mjs` 的 A1 把「现状基线」表三行与 `tools/gen_plan_baseline.mjs` 逐项比对，A3 有负控制 —— 即**基线表有机器看守，入口与优先级节没有**。

---

## 八、本期不做什么（逐条带依据）

| 候选 | 裁定 | 依据 |
|---|---|---|
| 再扫死方法/弱档 | 不做 | 三门「新增 0」，见第二节 |
| 一次接线 65 件 orchestrator-only | 不做 | `dead-module-baseline.json` 的 `rule` 明令不许一次性清零 |
| 刷新 `gate-budget.json` | 不做 | R11-O9 已落：`measured_at` = **v4.94.0** |
| 补图标 | 不做 | R11-O8 已落：90 个 svg，覆盖 89/89 |
| 重写 PLAN | 不做 | 只换挡三处（O7） |
| 把 R6 八件孤儿接到界面上充当拓展 | 不做 | 那是优化面 O3，不是新能力 |

---

## 九、本页自身的方法局限与诚实边界

1. **「zero 12 件」这个口径有已知缺口（沿用记忆侧同期的发现方式）**：本仓的 `dead-module-baseline.json` 用 `productImporters` 判产品面入度，而**产品面入口的定义是「`apps/` 下被 import」**。若某件被 `apps/` 之外的启动路径（如 `index.js` 直接调）消费，它仍会被判 `zero`。本页未逐件反查 `index.js` 的消费情况，因此「12 件零入度」应读作「**`apps/` 零入度**」，不是「全库零入度」。这个措辞差异在实施 O3 时必须先消掉。
2. **`_diag*` 25 个场景文件未读正文**。只读了 `o1-app-enumeration.scen.js` 一个。它们是否已被取代、是否仍该留在仓里，属 O1 实施时的侦察项，本页不下结论。
3. **`chat-view.js`（1MB）与 `settings-app.js`（747560 B）未通读**。本页所有关于它们的论断都基于**体积与 grep 命中数**，不基于逻辑理解。拓展计划里标注为「大概率」的地方属推断，不是实测。
4. **浏览器门「真跑必红」是静态推断，不是实跑结论**。本页没有执行 `node tests/browser/gate.mjs`（当前环境未确认可用 Chromium），结论来自「判据源码写死 83 且真源为 89」这一静态比对 —— 这个推断在逻辑上成立（等式两边都是常量），但**没有实跑证据**。O1 实施时必须先实跑一次确认。
5. **`R-O3` 的 26 次点名未逐条分类**。本页只统计了出现次数，没有把它们分成「静态排版类」与「真模型/真存储类」。后者即使浏览器门跑通也无法消掉。这个分类是 O1 的附带工作。
6. **本页不做趋势判断**。「死方法 311」「零消费 81」这些数字是**存量**，本页不声称它们「在变好」或「在变坏」——只有「新增 0」这一条能说明方向。
7. **本页与两份计划的关系**：计划里的每条「现状」都指向本页某一节；本页不重复计划的验收标准，只提供读数与复算命令。