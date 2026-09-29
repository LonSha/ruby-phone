# ruby-phone 发展规划

> 本文件是当前**前瞻性规划**，分「优化提升」与「拓宽·拓展·拓深」两部分。
> 区别于 `TODO.md`（滚动待办）与 `FOUR_RELEASE_PLAN.md`（历史追加台账）——本文件回答「下一步往哪走」。
> 每条均标注**现状读数**（来自磁盘实读）与**验收口径**。规划以本仓已清理基线为起点。

## 现状基线（规划起点）

| 量 | 读数 | 出处 |
|---|---|---|
| 版本 | v3.20.5（五源同源） | `update-log.json` latest / `package.json` |
| 门禁 | `npm run check` **十一道门全过**，173 个 tests | `package.json` scripts.check |
| 体量 | **261 个 .js / 231337 行**：apps 41 个（190 文件）、config 51 个 | `find` / `wc -l` |
| 跨仓消费 | 已接入上游全部 **5 面**；本仓→上游 **0 面** | `bridge-contract` 门 / `open_face_registry.tsv` |

---

## 一、优化提升

### B1 · R-O3 真宿主实机验证【最高价值悬挂项】
- **现状**：被 F-1/F-2/F-8/M-O3 及 v3.20.2~v3.20.5 **十余处点名「归 R-O3」**。是下游最大的「测不了所以挂着」债务。
- **路径**：不追求一次全验。先把 `docs/runtime-verification-boundary.md` 里「归 R-O3」条目做成清单，按「可在真宿主单次会话内验证」分组，排最低成本验证批次，每验一批勾掉对应台账行。
- **价值**：把十一道门「逻辑正确」升级为「真宿主行为正确」的唯一通道。
- **验收**：`runtime-verification-boundary.md` 中 R-O3 条目逐批转为「已实机验证 + 版本 + 现象」。

### B2 · 「本环境测不了」三项的替代覆盖
- **现状**：渲染性能/虚拟滚动、长时程堆增长、崩溃上报——已登记不开工。但 `memory_growth_probe.cjs` 已能测部分路径（1.25KB/轮 linear-acceptable）。
- **路径**：把 `memory_growth_baseline.json` 的 `unmeasurable` 段里**能在 jsdom/桩宿主下近似**的条目迁进可测面，只留真正依赖真 GPU/真进程的挂着。
- **验收**：`unmeasurable` 计数下降，迁移条目转为有读数的断言。

### B3 · 门禁成本治理
- **现状**：173 个 tests + 十一道门。随功能增长门时间会膨胀。
- **路径**：给门禁加「自身耗时监控」——哪道门慢了就显形，防止某道门悄悄拖垮迭代节奏。
- **验收**：门禁输出含各道耗时，超阈值告警。

---

## 二、拓宽·拓展·拓深

### T1 · 打通「本仓→上游」0 面【结构空档，最高优先】
- **现状**：`open_face_registry.tsv` 表头明写下游→上游 **0 面**。本仓 41 个 App 沉淀的运行时事实（usage-tracker / life-events / phone-chat-memory / worldbook-dryrun 的选择结果）上游记忆图谱用得上。
- **路径**：按 `contract_shape` 九列范式新增第 6 行，**方向反转**——本仓做 producer、上游做 consumer。第一候选：usage-tracker 使用画像或 worldbook 选择回执。
- **验收**：本仓新增对应 producer 出口 + `bridge-contract` 门消费点，上游登记表增行。

### W1 · NovelAI v4 多角色生图 + 角色一致性【拓宽，候选储备】
- **现状**：`CONTEXT.md:138` 登记 moyunphone 核心混淆无法移植，但 **NovelAI v4 多角色生图与角色一致性**是明确演进方向。本仓已有 `image-generation-manager` / `nai-queue-worker` 底座。
- **路径**：`image-generation-manager` 增「多角色」模式 + 角色一致性锚点（复用 `honey-avatar-selection` 的角色选定），走 `nai-queue-worker` 排队。
- **价值**：把单角色生图拓宽到群像场景。
- **验收**：多角色生图可出图且角色一致性锚点生效。

### W2 · 上下文总结 + hooks 生命周期 + 宿主性能守护【拓宽，候选储备】
- **现状**：同 `CONTEXT.md:138` 登记的三项。本仓已有雏形可承接。
- **路径**：① 上下文总结——`context-compose`/`resume-brief` 对齐 moyunphone 策略增强；② hooks——`runtime-lifecycle` 补更细粒度钩子点；③ host-performance 守护——基于 `perf_baseline.json`/`perf_probe.mjs` 加常驻宿主性能守护（帧率/长任务监测），与 B2 互补。
- **验收**：三项各自形成可测的新出口。

### X1 · 世界书干跑从「取数」走向「预演」【拓展】
- **现状**：F-9 已交付世界书干跑**取数层**（`worldbook-selection` 7 出口）。
- **路径**：加「预演层」——注入前预览「这条世界书占多少 token、挤掉哪条记忆」，把干跑从诊断工具升级为调参工具；与上游 projection 面（`readProjection` 6 消费点）衔接。
- **验收**：干跑结果含容量/挤占预演，前端可见。

---

## 优先级

1. **T1**（本仓→上游第 6 面）——结构价值最高，机制已备。
2. **B1（R-O3）**——价值最高但依赖真宿主，排进下次有真机的窗口。
3. **B2 / B3**（替代覆盖 + 门禁治理）——成本中、回报稳。
4. **W1 / W2 / X1** 拓宽项按兴趣选切，moyunphone 储备是现成抓手。

> 维护规则：条目落地后，在条目末标注「已交付 v3.20.x」并附证据；不删历史条目，保持追加式。
