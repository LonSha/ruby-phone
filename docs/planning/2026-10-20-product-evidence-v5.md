# 第五期规划证据 · ruby-phone · 2026-10-20

这是规划时的代码/模块证据，不是36项功能的实现或验收声明。全部输入为合成示例；没有读取真实聊天、修改业务存储或发送模型请求。

## 基线与复跑

- 本仓：4.30.0 / main@5edf59a；对仓：3.349.0 / main@5fdb841。调查阶段两仓 fetch 成功，HEAD...origin/main 均为0/0；推送结果以本次提交后核对为准。
- Node v24.18.0。探针导入真实生产模块，健康例的 storage/状态 owner 与群消息为内存替身。它的 rc=0 只表示探针执行成功，**不表示被测行为正确**。
- 重跑（仓库根目录）：

```sh
node --check docs/planning/2026-10-20-product-probe.mjs
node docs/planning/2026-10-20-product-probe.mjs
```

不接入常驻测试/审计框架；后续实施将相应反例并入已有定向套件。修复后输出改变是预期，不应为守住这份历史读数而改坏实现。

## 本轮模块实跑输出

```json
{
  "search": {
    "facets": {
      "raw": "昨天还款",
      "keyword": "",
      "person": "",
      "known": false,
      "from": "2026-10-19",
      "to": "2026-10-20",
      "kinds": [
        "finance"
      ],
      "gaps": [
        {
          "kind": "no-actors",
          "why": "没有可认的人名清单（宿主未提供 knownActors）⇒ 人名筛选整条不参与"
        }
      ],
      "ok": true
    },
    "todayPass": true
  },
  "health": {
    "hours": 4,
    "firstApplied": 1,
    "secondApplied": 1,
    "ledgerAdded": [
      1,
      0
    ]
  },
  "vote": {
    "question": "周一午餐",
    "round": 1,
    "options": [
      {
        "id": "a",
        "label": "面",
        "kind": "other",
        "round": 1
      },
      {
        "id": "b",
        "label": "公园",
        "kind": "other",
        "round": 1
      }
    ],
    "members": [
      {
        "id": "me",
        "name": "我"
      }
    ],
    "statements": [],
    "activities": []
  }
}
```

## 证据分级与边界

| 计划 | 证据 | 本轮能证明 / 不能证明 |
|---|---|---|
| R5-O1 | creationdesk-view.js:316–318 → creationdesk-app.js:315–318 → creationdesk-board.js::handoff | 读码：点击链未消费返回材料；未在真浏览器点击 |
| R5-O2 | chat-view.js::confirmGroupVote、GROUP_VOTE_CONFIRM 定义/派发及生产接收者检索 | 已查生产目录未找到接收者；不是声称任何未来插件都不能监听 |
| R5-O3 | 上方 vote | 真实模块混合两张票；完整群聊渲染未验 |
| R5-O4 | 上方 health、health-app 的 MESSAGE_RECEIVED | 真实处理函数重复应用；实机重复事件发生频率未测 |
| R5-O5 | 上方 search、search-app::_filterByFacets/searchAll | 过滤过宽已复现；候选阶段还可能整句无命中，不能把函数输出说成UI结果 |
| R5-O6 | memory-app::loreReadSource/loreReadWindow/loreCompareSource | 旧基线可能被新读取覆盖的读码风险；实施前用实际换文件路径复现 |
| R5-O7 | reading-app::searchBook + reading-notes-contract::buildSearchIndex | 每次同步重建已读码；具体耗时/卡顿未测，验收须先记录基线 |
| R5-O8 | reading-app::researchList/bookReadOf + buildResearchList | 研究清单只从内存缓存给正文；冷启动UI影响未验 |
| R5-O9 | memory-ask-thread::carryLineOf | atFloor显示为≥；语义与上游一起改，不能只改文案 |

新X项属于设计增量，不是已复现缺陷。已核对四期标题及相关实现，旅行协作/关系回忆册/地点漫游/时间胶囊/里程碑/研究/投票均已有，不再从零申报。生产代码中已有能力但未沿具体新旅程验证的，计划采用“在现有底座上增加”的口径，避免用关键词零命中下不存在结论。

## 规划验证记录

- 本轮探针语法/执行：rc=0；仅覆盖上述模块行为。
- 全库笔记校验已做改前/改后差分：手机tree通过（16篇），format保留第二期等21行历史问题；记忆tree保留既存feature/层级错误，format保留23行历史问题。两仓新增错误均为0；各仓本次两篇新计划与两篇接续旧计划的定向format均4篇通过。四份新计划各9个唯一编号，相对链接与UTF-8检查通过。历史债未借本轮扩大整理。
- 手机首轮 `npm run check`：rc=1，4527条测试中4525通过、2失败；两条均因新增规划探针后语法面由839增至840、边界文档未同步而报红。未修改测试或放宽判据。通过现有 `tools/refresh_doc_readings.py --write --why=...` 现场取数同步文档，导入面仍为476文件/837条；`system-v3201` 与 `system-v328` 定向复验38条全过。
- 手机修正后完整 `npm run check`：rc=0，15段全部执行完成；4527条测试全过、0失败/取消/跳过；测试阶段228.25秒，全链268.76秒。语法840文件、导入476文件/837条；日志留在仓外 `/tmp/product-plan-v5/ruby-check-final.log`。这是本次规划提交检查，不是36项功能验收。
- 记忆侧本轮 `scan_plan_currency` 与 `scan_doc_truthfulness` 均rc=0；三个相关定向套件共39条全过。本轮没有另跑记忆全量，不引用历史全量充数。
- 手机末门保留既有边界：3条已解释跨仓声明滞后，R9上游实时复核与R12上游分发面因未传 `--upstream` 仍为未复核；本轮未刷新或清除这些历史记录。
- 浏览器/真实宿主/模型：本轮未执行。历史版本全量成绩不作为本次成绩，未实测问题与新功能验收都保留待验。

## 导航

[优化九项](../../.agents/notes/proposed/architecture/2026-10-20-product-optimization-v5.md) · [拓展九项](../../.agents/notes/proposed/feature/2026-10-20-product-expansion-v5.md) · [现行计划](../../PLAN.md)。

## 双仓配对与不双计边界

[对仓现行计划](https://github.com/LonSha/lonsha-memory-plugin/blob/main/PLAN.md)。以下每行是两个不同交付面，不是两个仓各实现一套同功能内核。

| 序号 | 记忆侧M5-X：语义与原生操作 | 手机侧R5-X：实际使用旅程 |
|---|---|---|
| 1 | 借还关系、持有权与约定证据 | 物品卡→查看→归还确认 |
| 2 | 目标依赖与有据达成 | 目标树→受阻原因→下一步入口 |
| 3 | 多人物时空区间与矛盾 | 时间带→出处→地点回访 |
| 4 | 传闻根与独立佐证 | 源头图→原消息→反证 |
| 5 | 群体可共享事实交集 | 换参与者→重算→群聊草稿 |
| 6 | 有意改设定的依赖与重算 | 影响选择→原生确认→撤销 |
| 7 | 假设工作集与正史隔离 | 双栏试写→丢弃或正式采纳 |
| 8 | 周期约定实例与履行 | 周期时段→例外→共同空档 |
| 9 | 专题证据引用与结论生命周期 | 选多书→专题组织→成稿交接 |

优化联动：M5-O1→R5-O9；M5-O4/O5→R5-O1；M5-O6→R5-O6。其余优化各自独立验证，不能因对仓通过而直接标完成。
