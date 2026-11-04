# Agent Note: R14-O5 消息动作的重复点击与后续撤销（幂等台账）

Status: implemented

## Problem

第十四期计划书 R14-O5 原文：「增稳定来源身份、幂等提交回执与重复处理提示；源句变化、日期变化、撤后重办分别处理。玩家入口：微信消息动作条与日历回执。验收旅程：双击只新增一条；刷新后再点不重复；撤销只针对该动作创建项；不撤掉后来人工修改的内容。」

修前实测处境（`config/inline-action-commit.js` 160 行 + `apps/wechat/inline-action-bar.js` 的 `_commit`/`_undo`）：

- `commitAction` **每调一次就 `cal.addMemo(...)` 一次**，没有任何「这件事办过没有」的判据；
- 动作条唯一记录是实例内存 `this._done`（`msgId → 回执`），随界面一起消失；
- 于是四种形态在代码里长得一模一样（都是「调 commitAction」），行为却应当相反：

| 形态 | 该有的处置 | 修前实际行为 |
| --- | --- | --- |
| 双击 | 只新增一条 | 两条一模一样的日程 |
| 刷新 / 重进会话 | 不重复 | `_done` 清空 ⇒ 按钮变回「加入日程」⇒ 再点又一条 |
| 源句被改过（重 roll / 编辑） | 允许新建，但旧条作废且要说清 | 又一条，而且**不告诉用户旧那条还在日历里** |
| 撤后重办 | 合法新建 | 与前三者在代码里不可分 |

撤销侧的问题同样不是「报错」，而是「默默做错」：`undoCommit` 只认 `_done` 里的回执，刷新后没有回执 ⇒ 撤销按钮虽然显示，点了什么都不发生；也没有任何「条目被人工改过」的判据 —— 用户改过的日程会被静默删掉。

⇒ 这一刀治的不是「点不动」，而是**点两下数据错一次**。

## Decision

### 1. 身份与指纹分离（这是本项的地基）

- **身份** `identity = sourceMsgId|kind` —— 稳，跨刷新、跨实例不变，**不含标题**。若把标题算进身份，「源句一改就变成另一件事」，那正是本项要能**看见**的形态（drifted），不能让它悄悄变成新身份。
- **指纹** `fingerprint = title|dateKey|time` —— 回答「这次算出来的内容跟上次一样吗」。三项纯空白按空串收，避免「多一个空格」被判成内容变了。
- 没有 `sourceMsgId` ⇒ `identityOf` 返回 `''`（**不编一个**），`planCommit` 判 `invalid`。没出处的动作本来就不该被办。

### 2. 独立纯函数件 `config/inline-action-ledger.js`（267 行，零 import 叶子）

为什么单独一件而不是塞进 `inline-action-commit.js`：判定要能**逐态单测**（双击 / 刷新 / 漂 / 撤后重办），而这四种形态在 DOM 里跑不动；塞进提交件会让「写盘」与「判定」耦合，判据只能间接验。

导出面：`IA_LEDGER_KEY`('ia_ledger_v1') / `IA_LEDGER_LIMIT`(200) / `IA_RECORD_STATUS`{committed,undone,superseded} / `IA_LEDGER_WHY`{ok,new,replayed,drifted,recommit,nothing-to-undo,entry-missing,modified-since,invalid-action} / `identityOf` / `fingerprintOf` / `normalizeRecord` / `normalizeLedger` / `readLedger` / `writeLedger` / `planCommit` / `appendRecord` / `planUndo` / `iaLedgerSelfCheck`。

关键设计：

- **坏行直接丢**，不补空壳 —— 一条补出来的记录会让「办过没有」答错；
- 读坏了当空台账且**不抛**（台账坏了不该让「加入日程」整个不可用，代价只是可能多写一条重复 —— 比功能直接坏掉轻）；
- `appendRecord` 把被取代的旧记录改键为 `identity#superseded@at` 留在台账里：同身份只能有一条，而旧记录是「上一条已作废」这句话的唯一依据。

### 3. `planCommit` 五态（处置相反，故必须分开）

`new` 正常新建；`replayed` 同身份同指纹不新建（交回旧记录）；`drifted` 同身份指纹变了允许新建且旧记录标 superseded；`recommit` 上次已撤销属合法重办；`invalid` 无身份。

### 4. `planUndo` 三条撤销纪律（判定顺序即优先级）

1. 无记录 / 已 `undone` ⇒ `nothing-to-undo`（不是「撤销失败」）；
2. 条目 id 不等于 `rec.memoId` ⇒ `entry-missing`（**不报成功**，否则回执说已撤销、用户在回收站找不到）；
3. 标题 / 日期 / 时间**任一**与创建快照不同 ⇒ `modified-since`（**不静默删**，那是用户的东西）；
4. 否则改 `status=undone` 并交出 `nextRecords`。

`memoNow` 必须由调用方**现取**（`calendarData.getMemos()`）：拿台账快照跟自己比永远相等，那是恒真判据。

### 5. 提交件接线（`config/inline-action-commit.js`）

- 新增 `ctx.ledger`（`planCommit` 的产物）：`replayed` ⇒ 短路，**一个字节都不写**，旧回执原样交回，且**不刷新时间戳**（回执说的是「什么时候办的」）；
- 短路位置必须在 **kind 分派之前**：`reply` 档虽不写盘，但会把草稿填进输入框 —— 双击两次等于把用户打了一半的字覆盖两遍；
- `drifted` ⇒ 照写，但回执追加「（上一条已作废；它还在日历里，要清掉请手动删）」并回填 `supersededMemoId`。**不替用户删数据**；
- 新增 `INLINE_COMMIT_WHY.replayed`；不传 `ledger` 时行为逐字不变（老调用方零迁移）。

### 6. 动作条接线（`apps/wechat/inline-action-bar.js`）

- `_commit`：`readLedger → planCommit → commitAction({ledger}) → appendRecord/writeLedger`；
- 落账条件 `if (res.ok && res.entryId)` —— 日历不在、数据层拒了都不许落账（落了一条撤不掉的记录比不落更坏）；
- 台账记的是**写进数据的那一版**（`_memoById` 回读）：memo 档标题会被写成「待定 · X」，若台账记原标题，撤销时会把**自己写的前缀**误判成「人工改过」；
- `_done` 键由 `msgId` 改为 `msgId|kind`（`_planSig` / `_renderBar` / `_handleClick` 三处同步）：否则同一条消息上办了一档，另一档也显示成「撤销」；
- 撤销按钮带 `data-ia-undokind`，`_undo(msgId, kind)` 才有足够信息定位到具体哪一档；
- `_undo` 重写为：`readLedger → 按 identity 找 rec → planUndo(ledger, identity, _memoById(rec.memoId)) → undoCommit({ok:true, entryId:rec.memoId}) → writeLedger(plan.nextRecords)`；
- 判定不过 ⇒ **一个字节都不写**（台账与条目都不动，`_done` 也留着 —— 它确实办过，只是这一刻撤不掉），并把三种「不成」翻成三句不同的人话（`_undoWhyText`）。

### 7. 会话隔离与自检（两道门）

- `config/storage.js` 的 `CHAT_DATA_PATTERNS` 加 `/^ia_/`：台账引用的是这段对话里的消息 id 与日历条目 id，落全局会让另一个角色看到别人的办事记录，且那些 id 在那边根本不存在；
- `scripts/keys-audit.mjs` 的 `KEY_REGISTRY` 登记 `ia_ledger_v1`，scope `chat`（K2 会把「意图」与「机制」钉在一起：改正则忘改登记、或反之，都会红）；
- `iaLedgerSelfCheck` 接入 `apps/diagnose/diagnose-data.js` 新增 `inlineActionFace` + `apps/diagnose/diagnose-view.js` 新增 `_inlineActionHtml`：自检不能只活在测试里 —— 它是「协议自身还成立吗」的唯一读数出口。视图面三态文案互不同形（面缺席 ⇒ 说「读不到」，**不说**「没问题」）。

### 8. 顺手修掉一处上一版留下的弱口径

`apps/calendar/calendar-app.js::openRef` 的 `Number.isFinite(Number(parts.year))` 被 `weak-coercion` 门判红（把 null / '' / [] 全读成 0 ⇒ 一条日期坏掉的备忘会把日历翻到 1970 年 0 月，且一个字都不报）。改为走全仓唯一口径 `numOrNull`（`config/num-gate.js`），`day` 缺省取 1 而不是 `Number(undefined)=NaN`。

## Verification

### 定向测试：`node tests/r14_o5_inline_action_idempotent.test.mjs` —— **33/33 通过**

- A 身份与指纹 3 条（跨刷新不变、标题不参与身份、纯空白归一）
- B 幂等判定五态 6 条（含 replayed 不刷新时间戳、drifted 回执写明「上一条已作废」、recommit 合法）
- C 提交面 3 条（reply 重放不再填草稿、不传 ledger 行为不变、日历不在不落账）
- D 撤销面 6 条（按 memoId 删、entry-missing、modified-since 三字段各自拦下、撤后不可再撤、无记录）
- E 接线 6 条（**换实例**后仍判得出重、同实例连点、两档互不串、撤销只撤这一档、撤后重办、待定前缀不算人工改过）
- F 负控制 3 条（真源码破坏：拿掉 replayed 判定 ⇒ 真写出两条；拿掉指纹检测 ⇒ 用户改过的被删；拿掉 sourceMsgId 前置检查 ⇒ 无出处也进台账）
- G 会话隔离与自证 6 条（`/^ia_/`、零 import 叶子、坏行丢弃、上限、自检闭集、计划书四条验收旅程逐条在场）

### 测试基建：抽出唯一一份迷你 DOM

`tests/_inline_action_harness.mjs`（工厂 `makeHarness(storyMs)`）从 `system-v4114` 抽出迷你 DOM + 替身 + 造 App。理由：R14-O5 要在同一块交付物上验四种重复形态，若再抄第二份选择器实现，两套迟早会漂，而「同一条纪律在两份套件里结论不同」这种红点**不指向任何一处源码**。

两处顺带修正：

1. 日历替身从「只记入参」改为**真的存条目**（`getMemos` / `deleteMemo` 真维护 `entries`）：只记入参的替身答不出 `getMemos()`，于是 `entry-missing` 与 `modified-since` 两条判据会**永远绿**；
2. `mkHost` 的剧情钟读数由 `T0` **算出来**，不再写死 `'2026-10-01'/'10:00'` 字面量（写死会让「换一天就日期与时间戳不一致」，而那种不一致不报错，只让「明天」算到错的一天）。

### 历史断言对齐（改断言是因为契约真变了，不是为消红）

- `tests/system-v4114.test.mjs`：`stageTree()` 复制名单补 `inline-action-ledger.js`。理由：动作条现在静态 import 台账件，副本树不够模块加载会以 `ERR_MODULE_NOT_FOUND` **假红** —— 那不是「纪律被破坏」，是「树不全」。改后 30/30。
- 其余未动。`system-v4113`(24) / `system-v3660_open_ref`(23) / `system-v4997`(27) / `system-v4190`(22) / `system-v4992`(23) / `system-v3550`(18) / `system-v41000`(16) / `system-v4116`(9) / `system-v3850`(19) / `system-v3890`(22) / `system-v2161-e2e`(9) / `r14_o1`(2) / `r14_o3`(25) 全绿。
- 诊断页相关 16 套件（`system-v297/298/299/300/301/302/303/319/320/3202/3213/322/3580/3820/3860/4070`）全绿。

### 门禁

`syntax` / `import-resolve` / `named-import` / `dead-exports` / `keys` / `weak-coercion` / `registry` / `lifecycle` / `bind-consuming` / `method-consuming` / `source-derivation` / `bridge-contract` / `screen-host` / `session-writeback` / `hardlink-safety` / `doc-path-claim` / `upstream-face` 全部 OK。

> 全量 `npm test` 未跑：按当前阶段约定，双项目双计划全部收口前只做定向验证与专项门禁。

## 已知边界（不在本项内，留给后续）

- 台账上限 200 条、按 `at` 截断：极端长聊里很靠前的消息，其记录会被挤掉，届时该条再次点击会走 `new`（再写一条）。这是**有意的取舍**（不截则台账无界增长），且截断只发生在很久以前的条目上。
- `drifted` 时旧条目**不自动删**（回执明确说「它还在日历里」）：本项不替用户删数据；清理由用户手删或后续回收站项负责。
- 台账只记「写进日历」的档（`schedule` / `memo`）。`reply` 档不写盘，故不进台账；它的重复保护靠「重放短路发生在 kind 分派之前」这一条（C1 守）。
- `_done` 仍是内存态、仍有 `msgId|kind` 维度的界面语义：刷新后按钮会变回「加入日程」，此时靠台账拦住重复（这是**有意的**——界面态本该跟界面一起消失，持久的是「办过」这件事而不是按钮长相）。
