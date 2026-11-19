# R25-O5 设置面信息架构：证据页

> 版本 v4.157.0（未抬版）。判据分三层：**内核**（node，13 条）、**DOM 面**（node 假 DOM 真挂载，1 条）、
> **浏览器**（真排版引擎，44 条读数 / 单场景 4 视口）。本页只写**量出来的东西**，不写「应该没问题」。

## 1. 开工前的实读（欠债三条，不是「感觉乱」）

| 欠债 | 实读证据 |
|---|---|
| 设置项靠位置记忆 | `apps/settings/settings-app.js` 12,798 行（改后 12,802）；`bindEvents` 一个方法就 5,374 行 |
| 搜索「搜到了 ≠ 看得见」 | R22-O2 的 `filterSettings` 只能把当前 DOM 里的 `.setting-item` 加 `hidden`；而设置页**六个 tab 的 HTML 同时存在**，只是 `hidden`。命中项很可能正躺在看不见的 tab 里，用户看到的是一片空白 |
| 恢复默认散在八颗按钮上 | 2808 / 2867 / 2889 / 5002 / 6743 / 7038 / 7098 / 7275 行，各管一段 DOM，没有「改过哪几项」的总账，也没有统一入口 |

另有一条**贯穿本仓的老毛病**在动手前被发现并记下：

- `config/settings-registry.js`（R24-O6 交付，196 行）自称「设置中心重构」，`SETTING_ENTRIES` 13 项、六分组、
  `defaults()/changed()/summary()` 一应俱全 —— 但全仓唯一消费点是 `index.js:166` 的
  `settingsRegistrySelfCheck()`（自检）。**设置页一行都没用它。** 这就是「模块在盘 ≠ 机制生效」的又一例。
  本轮**没有**把 registry 强行接上去（它登记的 13 个语义项里有 12 个在设置页根本没有对应的真键，
  接上去等于造一批假开关），而是改走「真键 + 真默认值」的路子，见第 2 节。

## 2. 这次交了什么

### 2.1 内核 `config/settings-ia.js`（311 行，纯函数）

- `IA_GROUPS`：**分组真源 = 设置页真有的六个 tab**（`general / memory / llm / tts / image / lobby`），
  不是另造一套语义分组（`api → tab llm`）。
- `buildIaIndex(snapshot)`：分区快照 → 组索引。重复标签去重、空标签不入索引（不许拿占位符冒充一项设置）、
  空组如实报（`absentGroups`）、未登记 tab 如实报（`unknownTabs`）。
- `iaSearch(index, query)`：复用 `settings-filter.js#filterSettings`（一处实现两处用），
  但把命中变成**带 tab 的扁平列表** —— 这样「搜到了但看不见」不会发生。
- `iaResetPlan(entries, read, scope)`：恢复默认的**差异预览**。四件硬事：
  `noop`（都是默认值）/ `preview`（带原值）/ `unknown`（读不到，**不许塌成 noop**）/ 空作用域判 `unknown`；
  每条带 `fromSet` —— **「没设过」与「设成了 0」不同形**。
- `iaResetReceipt(results)`：四态 `applied / partial / failed / unknown`；`ok` 只认 `=== true`；
  零条结果 → `unknown`（不拿「没报错」冒充「改成功」）。
- `IA_RESET_ENTRIES`（10 项）：进这张表的代价是三条硬要求 —— 键在设置页**真读真写**、
  默认值与**源码里那行读取的默认字面量一致**、`effect` 说人话。第 8/9 条判据就是去源码里逐条对账的。

### 2.2 DOM 面 `apps/settings/settings-ia-panel.js`（437 行）

- 组目录：六颗 chip（各组项数），空组 chip `disabled` 且虚线灰显；点一颗就切 tab 并滚到该组第一项。
- 搜索可见：**复用设置页原有搜索框** `#r22-settings-filter`（不新建第二个索引，只挂一个 `input` 监听），
  命中结果画在面板的可见区，每条带「组 · 分区」，点一条跨 tab 跳过去。
- 恢复默认：统一入口 → 差异预览层（逐项 `140 → 100`、没设过的写「（没设过）」）→ 勾选 → 真写回 → 回执。
- 读数上屏：`document.body.dataset.iaItems / iaGroups / iaEmptyGroups`（写真实 DOM 节点 —— 写 JS 对象是写进虚空，R25-O4 踩过）。

### 2.3 接线 `apps/settings/settings-app.js`：**净 +4 行**

```
import { mountIaPanel } from './settings-ia-panel.js?v=...';        // +1
this._r25IaMount = mountIaPanel(this._getActiveSettingsRoot(), {...}); // +1（含 onAfterReset 一行内联）
/* 2 行注释 */
```

O5 自带「新增行数有上限（不许再造一个巨型文件）」这条验收，所以它被写成一条**正面判据**（O5-10）：
主文件里**不许出现** `iaResetPlan(` / `iaSearch(` / `buildIaIndex(` / `iaResetReceipt(` ——逻辑一行都不许搬进那 12,802 行。

## 3. 判据与结果

### 3.1 node 层（`tests/r25_o5_settings_ia.test.mjs`，13 条，全过）

| # | 判据 | 关键读数 |
|---|---|---|
| O5-1 | 内核自检零违规 | `{ok:true, bad:[]}` |
| O5-2 | 六组 = 设置页真 tab | 源码抽 `data-tab` = `general,image,llm,lobby,memory,tts` ≡ 六组映射 |
| O5-3 | 索引形状 | 重复/空标签 → 只 1 项；`unknownTabs=['zzz']`；空组如实 |
| O5-4 | 跨组搜索带真 tab | 搜「字号」命中 `tab=general`；无命中 `noMatch` |
| O5-5 | 预览四件事 | noop / preview（原值 130）/ unknown（读抛错 ⇒ **不塌成 noop**） |
| O5-6 | 「没设过」≠「设成 0」 | `fromSet:false/from:null` vs `fromSet:true/from:0`；`false≠true` 算改动；字符串 `'true'` 当同值 |
| O5-7 | 回执四态 | 零条 `unknown` / 全成 `applied` / 部分 `partial` / `ok:'yes'` ⇒ `failed` |
| O5-8 | 真键对账 | 10 项的 `storage.get(...)` 与 `storage.set(...)` 两侧都在 |
| O5-9 | **真默认值对账** | 10 项逐条与源码读取行的默认字面量相等（含 `PHONE_FONT_SCALE_DEFAULT=100`、`!== false` 走隐式默认 `true`） |
| O5-10 | 接线 + 逻辑不进主文件 | import/mount 都在；四个内核函数名在主文件中**零出现** |
| O5-11 | 面板真挂载（迷你假 DOM） | 6 颗 chip、4 组标空且 `disabled`、搜「字号」出 1 行、点恢复默认 **真写出 `['phone-font-scale', 100]`**、回执 `applied` |
| O5-12 | 负控制：读挂掉 | 状态行「未知」、预览层不弹、**写入 0 次** |
| O5-13 | 负控制：判据自己会红 | 零条→`unknown`、`ok:'yes'`→`failed`、读抛错→`unknown` |

### 3.2 浏览器层（`tests/browser/scenarios/o5-settings-ia.scen.js`，10 条读数 × 4 视口）

| 读数 | 320x568 | 390x844 | 768x1024 | 1280x800 |
|---|---|---|---|---|
| `o5-shell-up` | ok | ok | ok | ok |
| `o5-panel-mounted` | ok | ok | ok | ok |
| `o5-group-chips` | ok | ok | ok | ok |
| `o5-search-visible` | ok | ok | ok | ok |
| `o5-search-cleared` | ok | ok | ok | ok |
| `o5-reset-preview` | ok | ok | ok | ok |
| `o5-reset-applied` | ok | ok | ok | ok |
| `o5-reset-noop` | ok | ok | ok | ok |
| `o5-read-fail-unknown` | ok | ok | ok | ok |
| `o5-group-jump` | ok | ok | ok | ok |

真读数（四视口一致，故列一份）：

- `o5-group-chips`：组 chip=6、空组=1 且空组 chip 全 `disabled=true`、
  状态行 `共 154 项设置 · 空组 大厅`、`dataset.iaItems=154 iaGroups=6 iaEmptyGroups=1`
  —— **154 项**是设置页真实存在的 `.setting-item` 数量（不是账本上的数）。
- `o5-search-visible`：搜「字号」→ 命中行=2、结果区 `getBoundingClientRect().height > 0`（真可见，不是只看 `hidden`）、
  状态行 `找到 2 项设置（跨 2 个分组）`。
- `o5-reset-preview`：改前 `phone-font-scale=140`，预览层文字含 `界面字号 140 → 100`、
  `手机外壳缩放 （没设过） → 100`、`桌面布局 （没设过） → icons`。
- `o5-reset-applied`：确认后 `storage.get('phone-font-scale') === 100`，状态行 `上次：已恢复 1 项默认值`。
- `o5-reset-noop`：再点一次 → `都是默认值，没有要恢复的`，预览层未弹。
- `o5-read-fail-unknown`：把 `storage.get` 打成抛错 → 状态行 `读不到当前值（10 项未知），不敢动`、
  **写入 0 次**、预览层未弹。
- `o5-group-jump`：点「生图」chip → `tab-image` 的 `aria-selected=true`、面板在重渲后重建、状态行 `已跳到「启用全局生图」`。

## 4. 这一轮抓到的四个假结论（都是我自己造出来的，如实写）

1. **场景跳过起壳**：直接派发 `phone:openApp` 打开设置页 → `this.phoneShell.setContent` 抛 null，
   20 条读数全红。这不是产品缺陷，是场景没走真实链路（应先点 `#phoneDrawerToolEntry` 起壳 → 再点桌面图标）。
   已改成与 `o1-settings-save` 同口径。
2. **把 `waitFor` 的返回值当元素用**：`waitFor` 回的是布尔，我却拿它读 `.textContent` →
   预览层「出现了但文字为空串」，读数 `140 →` 判红。修：内容一律重新从 DOM 取。
   教训与 R25-O4 同源：**读数空白 ≠ 机制没生效，先怀疑量它的方式**。
3. **内核自己把 `llm` 标成脏数据**：`unknownTabs` 原本拿「分组 key」去比 tab 值，而 `api.tab === 'llm'`，
   于是面板状态行出现 `未登记分组 llm` —— 一个完全正常的分组被自己判成野数据。
   修：按**真 tab 值集合**判，并补了自检一条（`llm 是真 tab，不许被判成未登记分组`）。
4. **负控制注入面太宽**：把 `storage.get` 打成长期抛错 → 设置页其它组件也在读 storage，
   场景自己摄出一条 `window-error`；即便缩成「只覆盖点击那一段同步执行」，冒泡的 click 仍会撞上
   `document` 上的全局委托。最终修法：注入窗口内用 **不冒泡点击**（`bubbles:false`），
   patch 与还原紧贴同一次同步执行。**负控制也要有纪律：不许用污染被测面的方式去证它。**

## 5. 行数账（台账 note 同步更新）

| 项 | 行数 | 说明 |
|---|---|---|
| `config/settings-ia.js` | +313 | 新件（判据面） |
| `apps/settings/settings-ia-panel.js` | +441 | 新件（DOM 面） |
| `apps/settings/settings-app.js` | **+4**（12798 → 12802） | import 1 + mount 1 + 注释 2 |
| `tests/r25_o5_settings_ia.test.mjs` | +474 | 判据 13 条（含迷你假 DOM） |
| `tests/browser/scenarios/o5-settings-ia.scen.js` | +198 | 浏览器读数 10 条（四视口 44 条读数） |
| 全仓合计 | 384875 → **385634**（907 个 .js） | `tests/audit/file_size_ceiling.json` 已按实测重压两次，棘轮方向未变 |

## 6. 边界（这一轮**没做**的事，别读成做了）

1. **可恢复项只有 10 项**（字号 / 外壳缩放 / 桌面布局 / 内联回复 / 六类条数上限）。其余设置项
   **没有可对账的默认值**，所以面板里不给按钮 —— 宁可少，不造「点了没反应」的假开关。
   下一批要扩，必须先为那些键在源码里确立默认值真源，再进 `IA_RESET_ENTRIES`。
2. **`config/settings-registry.js` 仍是「只有自检在用的账本」**。本轮没有把它和 IA 合并：
   它登记的 13 个语义项里，12 个在设置页没有对应真键（`general.playerName` / `appearance.theme` /
   `notification.quietHours` / `privacy.archiveExport` …）。合并的前提是先把这些设置**真做出来**，
   或者把账本改成「只登记已实现的项」。这条留给下一期，不在这里假装做完。
3. **`大厅` 组当前是空组**（`iaEmptyGroups=1`）：`lobby` tab 只在 lobby 模式下出现且没有 `.setting-item`。
   面板如实标空组 + chip 禁用，没有拿它凑数。
4. **没有做「组内折叠」的持久化**：`<details data-settings-fold-key>` 的开关仍归设置页自己管
   （已有落盘逻辑），面板只管「跳过去 + 展开」。

## 7. `npm run check` 全链结论：57 红里只有 5 项是本轮引入的（已全部修掉）

第一次全链跑完是 **EXIT:1 / 6988 项、6931 过、57 红**。红不能凭关键词定性，所以做了两件事：

**(a) 台账/文档漂移（本轮引入，4 项）**

| 红项 | 症状 | 为什么红 | 修法 |
|---|---|---|---|
| `r23_o1` 真仓读数 | 台账天花板 385624 但实测 385634 | 我压台账之后又动了两个新文件的行数（`+7`/`+3`），台账没跟上 | `scan_file_size_ceiling.mjs --write` 重压到 **385634**，断言同步 |
| `r23_o1` 元信息自洽 | `total_lines_max` 与 `stats.total` 不等 | 同上 | 同上 |
| `r23_o1` 进程级闸 | `R4` 合计超天花板 | 同上 | 同上 |
| `system-v4980` A1 | `config **382**` / `tests **507**` 未对齐 | 本轮新增 1 个 config 件 + 1 个 test 套件，PLAN.md 基线表没复算 | 改成 **383** / **508**（`computePlanBaseline()` 现场复算值） |

顺手把 PLAN.md 门禁行里那句「**507 套件实跑全绿**」改掉了 —— 它不是判据项，但它是**谎报**：
真实状态是 508 套件里有一批存量红。改成「508 套件实跑（存量红在案，逐项见本节）」。

**(b) 浏览器台账覆盖（本轮引入，1 项）**

`system-v4100` C2 红：我新增了 `o5-settings-ia.scen.js`，但没重生成 `tests/audit/browser_readings.json`
（台账仍写着 `on_disk: 23`，磁盘实际 24）。修法不是手改 JSON，而是**真跑一次**：

```
node tools/browser-readings.mjs        # 自己 spawn gate.mjs 全矩阵，边跑边搬读数
→ 24 场景 / 992 条读数 / fail=0 / scene_coverage.complete=true
→ o5-settings-ia.scen.js: reads=44, fail=0
```

**(c) 其余 52 项：做了基线对照，确认是存量红**

用 `git worktree add /tmp/rp-base HEAD`（HEAD = `72f5525`，即上一提交 R25-O4）建干净树，
把那 26 个失败文件**逐个串行**在基线树与当前树上各跑一遍，按失败项名（剥掉耗时括注）比对：

- **24 个文件失败项逐条一致**（`base=cur`），即 O5 没往里加任何红；
- `system-v3160` 基线 **6** 项 / 当前 **2** 项 —— 存量红本身就 flaky，当前比基线更少；
- 只有 `system-v4100`（上文 b）与 `system-v4980`（上文 a）是「当前多出来」的，都已修掉。

存量红的主干是 **R25-O4「9 个 App 样式搬出 phone.css」** 留下的样式同源类判据
（`C2 六处接线落点` / `C3 样式段头独立成行` / `C4 源文件与 phone.css 段逐字同源` / `N5 样式逐字同源投递`
跨 `system-v325/v326/v327/v328/v3370/v3390/v3400/v3410/v3420/v3430/v3440` 十一个套件），
外加 `r22_o1` 渲染快照的 `bubble.emojiToken` / `emojiPanel` 两个 hash 漂移。
**这批红在本轮开始前就存在**（同一 HEAD 的干净树同样红），本轮不修 —— 它们属于样式搬运那一项的收尾，
修法与 O5 无关，混进来只会让这一提交同时动两件事。

诚实边界：本节只证明「O5 没新增红」，**不证明全链绿**。全链当前是红的（存量 52 项）。
