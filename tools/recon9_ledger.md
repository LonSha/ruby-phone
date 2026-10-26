# 第九批（v4.89.0）侦察台账 —— 第二轮全量重扫

## 口径

第一轮（v4.88.0）是「机制形态正则 + 文件名指纹 + 本仓差集」三重全量重扫。本轮换成**不靠名字**的三条机制判据，理由：上一轮的词表漏掉了一批「文件名平平、体内是机制」的文件（`diffusion.js`、`source-permission.js`、`timeRel.ts` 都不含任何机制词）。

判据（全部只看结构，不看文件名）：

- M1 纯函数内核形态：文件内 ≥2 个 `export function` / `export const x = (…) =>`；
- M2 有常量表（`const XXX = [` / `{`）**且**有判定函数（阈值 / 优先级 / 状态机族）；
- M3 有自检或断言入口（`selfCheck` / `invariant` / `verdict` / `assert` 族）；
- M4 与本仓差集：导出名一个都不在本仓出现过才算真新（`config/*.js` 模块名拆词 + 全仓已有导出名双向比对）。

脚本 `/tmp/recon7.py`：扫 934 件命中 931 件，按 `score × (0.4 + novelty)` 排序落 `/tmp/recon7.tsv`。

## 结论：8 件真缺口（本仓对应位置全空）

逐件都读穿过导出面与实现，逐件都在本仓用 `grep` 确证过「零消费」：

| # | 源 | 机制本体 | 本仓现状（实测） |
|---|---|---|---|
| 1 | `stbme/retrieval/diffusion.js` | PEDSA：每步 `E×W×decay`、抑制边传负能量、每步 TopK 剪枝、能量钳位 ±2、PPR 回拉、提前终止 | `graph-bridge.search` 只有一跳邻居 + 固定 `_score 0.5`；`grep propagateActivation` 零命中 |
| 2 | `stbme/retrieval/recall-injection-plan.js` | 五注入角色 / 五策略 / 优先级 1–5 / 80 条上限 / 重复与非法值进 issues / 角色→优先级→原序三段比较器 | `recall-filter` 只有权限分级；`grep RECALL_INJECTION` 零命中 |
| 3 | `stbme/runtime/concurrency.js` | 满队列 drop 计数并返 reason、attempts 线性退避、AbortError 单独终止不重试、snapshot 四态、三档模式归一 + `runLimited`（preserveOrder / failFast） | 只有 `dream-guard` 的 maxRetries；`grep runLimited` 零命中 |
| 4 | `ttx/src/tauri/main/kernel/upstream-failure.js` | 八类网络失败码表、嵌套挖掘 details/data/error/cause（深 4）、单键 `UpstreamFailure` 拆包、endpoint 附注 | `api-manager._formatError` 无码表；`grep UPSTREAM_FAILURE_FALLBACKS` 零命中 |
| 5 | `ST-MyriadKnots/src/source-permission.js` | 2000 书 / 1200 字双上限、NFKD 去重音 + 简中小写规范化、`world::uid` 键与 locator 回退、非 worldbook 直通、inspect 前后身份比对判 stale | `grep sourcePermission` 零命中 |
| 6 | `baibai/src/memory/timeRel.ts` | standard / fantasy 双型日期、带历法前缀跳过公历口语档、天/月/年降级、解析不出返回空串 | `comm-time` 只解析绝对戳 |
| 7 | `memorybooks/addlore.js` | 受控字段白名单、position 合法集 `{0,1,2,3,5,6,7}`、order 自动分档 + clamp、标题模板 `[000]` 序号填充 | `worldbook-manager` 只有 class，无 entry 设置归一 |
| 8 | `ttx/src/scripts/util/command-error-utils.js` | 七类错误前缀**循环**剥离（剥到稳定为止）、单键 enum 解包、string/Error/object 三形提取 | 无前缀剥离 |

7 并入 2（世界书条目设置面），8 并入 4（错误可读面）。

## 逐件否决的（留痕，免得下一轮重走）

- `stbme/graph/schema.js`：本仓 `graph-bridge` 的节点没有 schema 面，但 `memory-block.js` 的 `MEMORY_KINDS` 已覆盖「类型白名单」，且 schema 自带大段中文 hint，缝进来是搬运文案不是搬运机制 —— 留待有节点写入侧时再谈。
- `stbme/ui/message-render-limit.js`：`{enabled, render_last_n}` 与 `config/list-window.js` 的分页窗口语义重叠，缝进来会出现两套上限。
- `stbme/prompting/injection-sanitizer.js`：依赖 `mvu-compat.js` 与 `task-regex.js` 两个本仓没有的模块，单缝要连拖两件，性价比低于先缝 1–6。
- `baibai/src/memory/apply.ts`、`ne-memory/src/engine/update.js`：都是「记忆写入编排」，本仓 `phone-chat-memory.js` 已是同一位置，属替换不属新增。
- `stbme/retrieval/retriever.js`、`authority-*` 系列：强依赖 authority 后端（HTTP + SQL），本仓零后端，属媒介级差异。

## 纪律

- 每件都先读穿再落，落完必带 `*SelfCheck()` 接进 `runSelfChecks`；
- 每件都配真源码破坏负控制（锚点恰中 1 次 + 两向自证）；
- 判据面扩了，`tests/system-v3770.test.mjs` 的 `MIRROR_FILES` 就得跟着扩（本轮已吃过一次：漏 `entity-candidates-contract.js` 让 v3770 五条红）。
