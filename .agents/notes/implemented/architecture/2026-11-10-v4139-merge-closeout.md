# Agent Note: ruby-phone v4.139.0 合并前收口 —— 21 条红归因与判据改写

Status: implemented
Date: 2026-11-10
Author: Operit

## Problem

用户要求把 `feat/v18-epic-abyssal-mind-ambient-life` 合并到 `main`。分支本身带 7 个提交
（v17/v18 两期共 18 项引擎 + 接线），但全量套件 `node --test tests/*.test.mjs` 是
**rc=1 / 6344 tests / 21 fail**。直接合并等于把 21 条红推给 main。

关键判断：这 21 条**不是 21 个独立缺陷**。逐条读断言后可以分成四族，四种处置方式完全不同：

| 族 | 条数 | 真实性质 | 正确处置 |
|---|---|---|---|
| A 版本与 release note 形态 | 9 | 抬版后文案没写成判据要求的形状 | 改文案（同源写两处） |
| B 探针读数基线 | 7 | 新增引擎让全仓枚举面从 680 涨到 753 | 现场读数写回基线 |
| C 判据自身把水位当契约 | 4 | 等值锚 / 切片缺陷 / 夹具旧假设 | 改写判据，保留真实判据 |
| D 白名单欠登记 | 1（50 文件 139 处） | 新引擎带进裸 `Date.now()` 未登记 | 逐条登记并写理由 |

## Decision

**四族分开处置，绝不用「改测试让它绿」这一种办法糊过全部。**

### A 族 —— 文案按判据要求的形状写，两处同源

`tests/system-v328`（A2/B1/D2）、`system-v3171`、`system-v3201`、`system-v3213` G3、
`system-v4115` G1 要的是：当版 items 里必须有一条提到「运行时验证边界」、与
`docs/runtime-verification-boundary.md` 共用标志语「看起来没坏但显示不对」、并且
写成「**不能保证**」而不是全绿；另有三条形态锚（本版落点 / 本版自己抓到的缺陷 / 交棒改写）。

做法：新增 `tools/_fix_v4139_release_notes.py`，**由同一份 items 同时写出**
`index.js ST_PHONE_CURRENT_UPDATE` 与 `update-log.json.versions['4.139.0'].items`，
使「逐字同源」成为生成方式而不是人工纪律。产物 11 条，自检输出：
`head 内读不到的条数 = 0`、`含 ASCII 方括号的条数 = 0`。

★ 顺带修掉一个真陷阱：历史判据用 `seg.slice(0, seg.indexOf(']') + 1)` 取「弹窗头部」，
而 `index.js` 的块内注释原写作 `/* [与 update-log 逐字同源] ... versions[ST_PHONE_VERSION] ... */`
—— ASCII 方括号让头部在第 114 个字符处被截断，后半 items 永远读不到 ⇒ **判据假红**。
处置是**改注释**（不用方括号）而不是改判据切片：判据的切片口径已经写在
`tests/system-v324.test.mjs` 的 A4 里当契约（「弹窗文案不得含方括号」），
迁就实现去改它会把契约改没。

### B 族 —— 用探针现场读数写回，零手抄

新增 `tools/refresh_baselines_v4139.py`（由 `refresh_baselines_v4999.py` 逐字派生，
只改 `VER` 与末段来由散文），复用既有的嵌套/异名/派生映射表。漂移 9 处：

- `schedule_conflict` / `branch_play`：`files_scanned 680 → 752`
- `branch_play`：`chat_data_patterns 416 → 418`
- `long_chat`：`scan.files 681 → 753`、`indexed_loop 12 → 14`、`length_read 52 → 54`，
  以及 `criteria[L5].got_text` 散文同步（判据比的是**文本**，散文必须一起写）
- `lifecycle_declarative`：`slots 98 → 99`、`app_slot_share_pct 87.8 → 86.9`

写回后立刻复跑同一脚本，输出「已与现场同源，跳过」×5、合计 0 处 ⇒ **幂等**。
注意两个探针的扫描根口径不同（752 vs 753），这不是不一致，是各自枚举面的定义不同；
脚本按各自的 `readings_from` / `scan_from` 取数，没有强行统一成一个数。

### C 族 —— 只改写「把水位当契约」的那几条，真实判据一律保留

1. `tests/dead-surface-triage.test.mjs`：`method.entries.length === 334` 是等值锚，
   而接 18 引擎 + 工厂替换直接 `new` 让账本涨到 391 —— 正当维护会翻红。
   改为「下限 300 + `classInstantiated` 两档必须穷尽覆盖全表 + 未实例化档不得为空」。
   不变量从「总数是多少」换成「分类是穷尽且互斥的」。
2. `tests/audit.test.mjs`：`apps/` 下 `daily` / `iot` / `social` 是引擎目录（无 `-app.js`、
   不在 `config/apps.js` 的 APPS 表里），判据的排除名单没跟上。补进 `ENGINE_DIRS`。
   **没有**给引擎造空 `app.js` 蒙混 —— 那是用产品假文件换判据绿。
3. `tests/system-v3960.test.mjs` A4：`tier` 数钉死 7，而 `deviceContext` 让表变成 8 条。
   改为「`appId` 条数 == `tier` 处数，且不少于 7」—— 漏声明档位依然立刻红。
4. `tests/system-v3960.test.mjs` 的 `allOn()`：夹具名字是「全开」，但只开了七个，
   `deviceContext` 默认 `injectToPrompt: false` 被算成 `disabled` ⇒ B4 误判。
   这是**夹具旧假设过期**，补上 `device_runtime_v1`。

### D 族 —— 逐条登记，并把欠债如实写出来

50 个文件 / 139 处裸 `Date.now()`。逐文件写明用途，分三档：

- **wall 档（机器时间）**：引擎内部流水、幂等键、新鲜度、审计 `updatedAt`。改走剧情钟
  会让去重失效、审计流水倒序。
- **elapsed 档（真实经过时间）**：录音 `durationSec`、通话 `connectedAt`、死信开关
  `lastHeartbeatAt`。这是产品语义本身（与 `apps/focus` 番茄钟同口径），必须跟墙钟。
- **story 档待收口（如实登记，不宣称已收口）**：`moments-living-social-ecosystem.js`、
  `npc-social-graph-dynamic-moments.js` 的 `timestamp` 会渲染成**用户可见时间**，
  按 `FIELD_CLOCKS` 口径应改走 `storyNow(win)`。本轮没改（要动引擎的 win 注入面），
  故在白名单理由里**明确写成欠债**，而不是伪装成墙钟混过去。

## Alternatives

1. **带红合并，把 21 条当 main 的已知问题。** 否决：其中 9 条是「用户会读到的版本说明
   缺边界声明」，合并即把「门禁全绿」说成「实机已验」——正是本仓反复登记的第二类失败。
2. **把 21 条判据全部删掉/放宽到通过。** 否决：那样得到的是假绿，且失去负控制。
   实际做法对每条改动都跑了负控制（见 Consequences）。
3. **给 `apps/daily`、`apps/iot`、`apps/social` 各补一个空 `app.js`。** 否决：
   用产品侧假文件换判据绿，属于把「假设过期」伪装成「缺陷已修」。
4. **把 `moments` 两处的 `Date.now()` 直接换成 `storyNow(win)`。** 本轮否决（非永久）：
   这两个引擎当前不接收 `win`，改签名会连锁影响装配层；如实登记为欠债比硬改安全，
   下一版按 `FIELD_CLOCKS` 收口。
5. **改历史判据的 `indexOf(']')` 切片方式。** 否决：该口径已被
   `tests/system-v324.test.mjs` A4 当契约钉住（弹窗文案不得含方括号），
   迁就实现改切片等于把契约改没；改注释才是守契约。

## Consequences

- 全量套件收敛路径：`/tmp/rp-all.tap` 127 fail → `/tmp/rp2.tap` 81 → `/tmp/rp3.tap` 21
  → `/tmp/rp5.tap` **6344 tests / 6344 pass / 0 fail, rc=0**（耗时约 456s）。
  删除临时脚本后复校语法门 1347 文件、导入门 794 文件 1400 条，读数已同步。
- 负控制（证明放宽过的判据仍能翻红，不是永远通过）：
  - 清空 `scripts/dead-method-baseline.json` 的 `entries` ⇒ `dead-surface-triage` rc=1。
  - 从 `apps/app-injection.js` 删掉 `ledger` 那一行的 `tier:` ⇒ A4 报
    「每条轻量装配来源都须显式声明档位（appId 8 条 / tier 7 处）」rc=1。
  - 两者恢复后重新 rc=0。
- 保留两个可复用工具：`tools/refresh_baselines_v4139.py`（探针基线对账，幂等、冻结
  `measured_at`）、`tools/_fix_v4139_release_notes.py`（版本说明同源生成）。
  用完即弃的扫描/插入脚本已删除，避免给枚举面留垃圾。
- **边界（未执行不算通过）**：真机 SillyTavern 加载、真实宿主主题差异、真机触摸目标、
  真实 `localStorage` 配额均**未执行**。本轮结论只覆盖「仓库内全量套件 + 审计工具」，
  不宣称实机已验 —— 这句同时写进了 v4.139.0 的用户可见说明里。
- **遗留欠债（已登记、未收口）**：`apps/moments/` 两处内容时间轴仍走墙钟，
  应按 `FIELD_CLOCKS` 改走 `storyNow(win)`；`system-v3750` H1/H2 与
  `system-v3960` B4 在本轮是**因判据/夹具缺陷转红、修好后转绿**，不是产品行为变化。