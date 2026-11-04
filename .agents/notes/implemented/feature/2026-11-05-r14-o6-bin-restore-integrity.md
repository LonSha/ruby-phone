# Agent Note: R14-O6 回收站真实恢复而不只是声明

Status: implemented

## Problem

计划书原文（`.agents/notes/proposed/architecture/2026-11-03-product-optimization-v14.md`）：

> **现有底座**：recycle-bin / undo-capability 已在役；现有声明明确**不保证**每个恢复器都正确。
> **本期交付**：优先消息、日记、日历、相册、阅读、创作六类高价值数据，修复 id、附件引用、
> 冲突和恢复失败。
> **验收旅程**：逐类删除 / 刷新 / 恢复，id 和关键字段一致；id 冲突不覆盖现存项；
> 达到容量上限先解释可恢复范围。

底座的**结构**已经齐了：`config/recycle-bin.js` 是唯一软删实现，`softDelete` 先落回收站
再调 `hard()`、`restoreById` 有 id 漂移检查、`BIN_MAX=200` 先进先出、`clearBin` 要确认
令牌；12 个 App 注册了 19 个恢复器。**它不缺骨架，缺的是「真的能恢复」**。

侦察方式是写探针真跑真读（`tests/_dbg_o6*.mjs`，五个，全部只读真源码、不破坏工作树），
不是读代码猜结论。三处缺陷全部由探针实测暴露。

### 缺陷一：日记删图当场物理删 ⇒ 恢复出来是坏图

`apps/diary/diary-data.js` 的 `_hardDeleteEntry` 里原本是：

```js
const managedImages = [...]          // photos[].imageUrl + getPageBg(id)
this._cleanupManagedDiaryImages(managedImages);   // → imageManager.deleteManagedBackgroundByPath
```

而回收站 `payload` 里只有 `photos[].imageUrl` 这个**路径字符串**。于是：

```
日记初始: 1  bg: /backgrounds/phone_diary_d1_bg.jpg
删后条目: 0  bg: null  图片清理调用: [delete .../d1_a.jpg, delete .../phone_diary_d1_bg.jpg]
回收站: 1  hasPayload: true
恢复: {"ok":true,"app":"diary","id":"d1","text":"已恢复"}  条目: 1  bg: .../phone_diary_d1_bg.jpg
恢复后图片文件还在吗: [同两条 delete]
```

条目回来了、`bg_d1` 设置键也写回去了，文件早在删除那一刻没了 —— 界面上是一张坏图。
同根因的第二张面孔：`clearAllEntries` 一次性把 `bg_` 键和照片全删光。

### 缺陷二：微信恢复整个会话是「整份覆盖」⇒ 删除之后新写的消息静默消失

`_restoreChatFromBin` 原本是：

```js
this.data.messages[chatId] = msgs;    // 整份覆盖
```

探针实测：

```
1 删会话后 chats: [] 回收站条数: 1
2 恢复结果: {"ok":true,...,"text":"已恢复"}
3 恢复后 chats: [{"id":"c1","name":"A群（新建）"}]
4 恢复后 messages[c1]: [m1, m2]
   >>> 新消息 n1 是否还在? false
```

用户删掉会话后建了同 id 的会话、聊了几句，点恢复 → 那几句静默消失，界面说「已恢复」。

### 缺陷三：id 冲突时恢复器回 `true` ⇒ 原件永久丢失且界面显示成功

所有恢复器原本都是：

```js
if (alreadyExists) return true;    // 想表达「幂等，别造第二份」
```

但 `restoreById` 收到 `true` 就 `writeRaw(storage, next)` 摘掉回收站条目并回「已恢复」。
探针实测（日历 / 阅读）：

```
日历 恢复: {"ok":true,"app":"calendar_memo","id":"cm1","text":"已恢复"}
  现存 memo: [{"id":"cm1","dateKey":"2026-11-05","title":"新写的开会"}]
阅读 恢复: {"ok":true,"app":"reading_book","id":"b1","text":"已恢复"}  shelf: ["新建的书一"]
```

用户删掉的原件**永久消失**，现存的是后来新建的那条，而界面显示成功。这是本仓最贵的那族
形态：不报错、只是默默拿走了本该保留的东西。

## Solution

### 内核（`config/recycle-bin.js`）三件套

1. **`restoreConflict()`** —— 导出冻结对象 `RESTORE_CONFLICT`，作为恢复器的**第三种返回值**。
   `restoreById` 用**身份比较**（`out === RESTORE_CONFLICT`）判定，不是结构比较：
   恢复器随手 `return {...}` 不会被误判成冲突。命中时回
   `{ok:false, reason:'id-conflict', text:...}` 且**不动回收站**（条目是用户的原件、唯一副本）。
   `REASON_TEXT['id-conflict'] = '已有一项和它同 id，没有覆盖。原件仍在回收站，请先处理现有那项'`
   —— 刻意不是 `apply-failed`（「写回去的时候出错了」是错的话术：这里没有出错，是刻意不覆盖）。

2. **`samePayload(a, b)`** —— 稳定序列化比对（键按字典序排、数组保持顺序、循环引用记
   `'[circular]'`）。为什么不直接 `JSON.stringify`：业务对象由不同路径构造时键序常不同，
   那会把「内容一样、键序不同」判成冲突，于是用户每次连点两次恢复都看到一次「冲突」提示。
   `undefined` 与 `null` 都当「没有 payload」判等（恢复器可能传任一）。

3. **处置器 `registerPurger(app, fn)` + 私有 `disposeEntry(row)`** —— 附件类资源必须在
   **真正销毁**时才清。三个销毁口全部接上：`purgeBinEntry` / `clearBin` / FIFO 淘汰
   （`softDelete` 与 `softDeleteMany` 各一处）。全部**先写盘摘条目、再清外部资源**：
   反过来的话中途崩溃 ⇒ 条目还在回收站、附件已经没了 ⇒ 用户再点恢复得到一条坏图，
   而且这次「彻底删除」看起来失败了。`disposeEntry` 用 try/catch 包住，清理失败不抛。
   `binStats().purgerApps` 是诊断读数（没登记的 App = 条目被销毁时没人清外部资源）。

### 日记侧：推迟处置

- `deleteEntry` / `deleteEntries` / `clearAllEntries` 三个入口都往 meta 里记
  `pendingFiles: this._collectEntryManagedFiles(entry, entryId)`（纯数据、可 JSON 序列化）。
- `_hardDeleteEntry` 改成 `if (!this._isInBin(entryId)) this._cleanupManagedDiaryImages(managedImages)`。
  `softDelete` 先写盘回收站再调 `hard`，故 `hard` 被调时「回收站里有没有这条」≈「能不能恢复」。
  `_binMemberIds()` 读失败返回 `null`，此时按「在回收站里」处理 —— 宁可留文件，不可删错。
- 真清理交给 `registerPurger('diary', ...)` → `_purgeEntryFilesFromBin(payload, meta)`，
  清时传 `skipIfReferenced: false`（条目已真销毁，自己就是最后的引用者；若为 true，
  任何「看起来还被引用」的残留都会让文件永远删不掉）。
- `clearAllEntries` 的 `orphanBgs` 过滤只留**真孤儿**（键后缀 id 不在本次条目里
  且 `_isInBin(id) === false`）。
- `meta.extras` 与 `meta.pendingFiles` 分工：extras 是「恢复时要还原的东西」（`bg_` / `lh_` 键），
  pendingFiles 是「条目真销毁时才清的东西」。`_collectEntryManagedFiles` 是两者共用的唯一口径。

### 各恢复器统一改成「幂等 vs 真冲突」

19 个恢复器、12 个 App，全部改为「同 id 存在时用 `samePayload` 区分」：

| App | 恢复器 | 特别纪律 |
| --- | --- | --- |
| calendar | `_restoreMemoFromBin` / `_restoreHolidayFromBin` | 冲突时 `saveMemos` 不调、`refreshDomainLifeEvent` 不调 |
| diary | `_restoreEntryFromBin` | 冲突时 `saveEntries` 不调 |
| reading | `_restoreBookFromBin` | — |
| wechat | `_restoreMomentFromBin` / `_restoreMessageFromBin` / `_restoreChatFromBin` | 会话恢复按 id **合并**；冲突检查在 `chats.unshift` **之前**（否则会话元信息已写进去 = 半恢复） |
| phone | `_restoreCallFromBin` / `_restoreContactFromBin` / `_restoreSmsMessageFromBin` | 联系人 id 被多处引用，静默丢弃 = 「引用还在、人被换成了另一个」 |
| focus | `_restoreTaskFromBin` | 历史统计按 taskId 对齐，静默丢弃会让统计挂到另一条任务上 |
| mofo | `_restoreItemFromBin` | **先判冲突再撤墓碑**，否则用户看到「恢复失败」但条目已能被合并看见 = 半恢复 |
| piggy | `_restoreTxFromBin` / `_restoreCardFromBin` | **在归一化之前返回**，否则余额被动过 |
| punchcard | `_restoreCardFromBin` / `_restoreItemFromBin` | — |
| weibo | `_restoreUserPostFromBin` | **在加计数之前返回**，否则 `profile.posts` 虚高 |
| music | `_restoreSongFromBin` | **刻意不引入冲突**：没有稳定业务 id、判重靠「歌名/歌手」串，同名同歌手多条是合法的，不存在「被顶掉」风险。理由写在注释里 |

会话合并的规则：先收集 `restoredById`（恢复批次按 id 的 Map），遍历 `current` 找同 id
且 `!samePayload` 者 → 立即 `return restoreConflict()`；然后 `chats.unshift`；最后
`msgs.concat(kept)`，`kept = current.filter(m => !id || !restoredById.has(id))`
（无 id 的一律保留 —— 宁可多留，不可静默丢）。

## 判据（`tests/r14_o6_bin_restore_integrity.test.mjs`，18/18）

五面 + 自证，全部用英文串做探针词（本仓 `_tokenize` 把中文切成单字+双字，中文探针词会共享
bigram）：

- **A 面 附件引用**：A1 删除那一刻不许物理删（`deletedCalls === 0`，恢复后 `bg` 键回到删前值）；
  A2 三个销毁口（彻底删除 / 清空 / FIFO 淘汰）都必须真清；A3 处置时 `skipIfReferenced === false`。
- **B 面 id 冲突**：B1 冲突回 `ok:false` + `reason:'id-conflict'`、回收站条目留着、现存那条不变；
  B2 幂等重放（含键序不同）回成功且不出第二份；B3 `samePayload` 判等语义四条。
- **C 面 覆盖式恢复**：C1 恢复整个会话必须合并，`ids === ['m1','m2','n1']`。
- **D 面 纪律**：D1 全仓不许再有 `if (...some(...)) return true` 的写法；
  D2 内核三种销毁口都接到处置器；D3 三个删除入口都记 `pendingFiles`；
  D4 只有 music 可以刻意不做冲突判定（且必须写明理由）。
- **E 面 负控制（必须真变红）**：E1 拿掉「删除时不物理删」的守卫 ⇒ A1 红；
  E2 拿掉冲突判定 ⇒ B1 红；E3 把合并改回整份覆盖 ⇒ C1 红；E4 拿掉 FIFO 处置 ⇒ A2 红。
- **F 面 自证**：F1 四类缺陷都有判据；F2 真仓只读（`writeFileSync` 只出现在 `mkTree` 与
  `mutate` 两处，且都不指向 `ROOT`）；F3 四条负控制在场。

负控制走 `closureOf(entry)` 递归解析 import 闭包的副本树惯例（手写清单每次新增 config
依赖都要补一遍，漏补 = 副本 `ERR_MODULE_NOT_FOUND` = 负控制因缺文件而红；本仓在
v4.05 / v4.20 / v4.99.7 踩过三次）。

## 过程里踩的五个坑（都写进了判据或注释）

1. **`REASON_TEXT` 对象里漏逗号** → `node --check` 报 `SyntaxError: Unexpected string`。
2. **FIFO 淘汰用例的构造顺序**：先灌满 200 条 filler 再删日记 ⇒ 日记是**最新**的，永远不会被
   挤掉，`evicted` 前置断言当场红。正确顺序是把日记先放进去（它当时是最旧的），再灌满。
   实测得到：`前置：evict_me 必须已被 FIFO 挤出去 → false !== true`。
3. **E2 的变异锚点命中 2 次**：日历里备忘与节假日两个恢复器的冲突判定两行**完全一样**，
   光拿那两行会中 2 次。解法是把锚点带上各自身前的 `const exist = ...find(...)` 那一行。
4. **E4 的副本树缺 diary 闭包**：`mutate(RB_REL, ...)` 只复制 recycle-bin 的闭包，判据体却要
   `import DiaryData` ⇒ `ERR_MODULE_NOT_FOUND`。解法是给 `mutate` 加 `extraEntries` 参数
   （副本树按多个入口合并闭包）。
5. **`samePayload(undefined, null)`** 原本判不等 —— 最平凡的幂等重放（两处都没有 payload）
   会被报成冲突。现在 `walk` 里先把 `undefined` 归成 `null`。

## 顺带修的两处既有欠债（都是本轮改动碰出来的红）

- `tests/system-v4104.test.mjs` E1 的破坏锚点原先写的是 `ok = fn(row.payload, row.meta || null) !== false;`，
  本轮把 `restoreById` 改成「先取 `out`、再判冲突标记」后这个锚点**中 0 次**（红）。
  锚点挪到 `const out = fn(row.payload, row.meta || null);`，语义不变（仍然是把 payload 的 id 换掉）。
- `tests/system-v4106.test.mjs` E2：`apps/wechat/inline-action-bar.js` 有两处裸 `Date.now()`
  未登记进 `tests/fixtures/bare-now-whitelist.json`（R14-O5 引入）。两处都是「剧情钟取不到时的
  墙钟兜底」，属 wall 档，已登记并写明理由。

## 已知边界（诚实地留着）

- **音乐刻意不做冲突判定**。理由写在源码注释里；D4 用判据钉住「只有它一个例外」，且要求
  例外理由必须写在源码里（不许静默例外）。
- **相册不在本期修复面**。`config/undo-capability.js` 里 album 明确声明 `irreversible`
  （图片是 base64 大对象，不进回收站）。计划书把相册列进六类，但按现有声明它属于
  「确认+声明不可逆」那一档 —— 若要真做，需要单独一期改存储形态，不在 R14-O6 里顺手改。
- **`meta.pendingFiles` 只是「待清路径」的清单，不是引用计数**。若同一张图被两条日记共用
  （当前实现下不会，但若将来支持「复制条目」就会），彻底删除其中一条会清掉共用文件。
  届时需要把 pendingFiles 升级成引用计数，这是本项明确留给后续的边界。
- **回收站容量上限的「解释可恢复范围」只做到 `binStats().total / limit` 与
  `clearBinPrompt` 的条数提示**。计划书验收旅程里「达到容量上限先解释可恢复范围」这条
  更大的一层（「挤掉之后用户怎么知道丢了什么」）没有做 —— 当前实现只在 FIFO 淘汰里
  静默处置，没有给用户一条「你因为容量丢了 N 条」的读数。这是本项的真实缺口。

## Verification

```
node --test tests/r14_o6_bin_restore_integrity.test.mjs        # 18/18
node --test tests/system-v4104.test.mjs                        # 18/18
node --test tests/system-v4106.test.mjs                        # 24/24
```

受影响既有套件（40 套，全绿）：`audit` 1 · `catbox-storage` 2 · `entry-integrity` 1 ·
`reading-data` 1 · `system-v2161-e2e` 9 · `v223` 1 · `v239` 1 · `v274` 7 · `v277` 8 ·
`v279` 7 · `v284` 16 · `v290` 12 · `v291` 12 · `v292` 5 · `v293` 10 · `v296` 10 ·
`v297` 24 · `v298` 21 · `v3180` 20 · `v3210` 31 · `v3240` 11 · `v3250` 18 · `v3260` 30 ·
`v3580` 9 · `v3740` 8 · `v3770` 19 · `v3970` 28 · `v3992` 14 · `v4070` 23 · `v4080` 23 ·
`v4104` 18 · `v4106` 24 · `v4120` 26 · `v4210` 31 · `v4220` 25 · `v4230` 32 · `v4240` 30 ·
`v4410` 21 · `wechat-background` 5。

门禁：`syntax`（1165 文件）· `import-resolve`（1236 条静态导入全部可解析）· `dead-exports`
（零新增）· `bind-consuming`（新增 0）· `method-consuming`（新增 0）· `lifecycle` ·
`registry` · `keys`（512 条全登记）· `source-derivation` · `bridge-contract` ·
`weak-coercion` · `named-import` · `screen-host` · `session-writeback` · `hardlink-safety`
（违规 0）· `doc-path-claim`（4123 处，0 落空）· `upstream-face`（一致）。
`browser` 门本次按 `SKIP_BROWSER=1` 显式跳过并打印「未执行」（无 Chromium 环境，
真跑 120s 超时）；这是**未执行**，不计通过。
