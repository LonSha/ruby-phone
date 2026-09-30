# ruby-phone 发展规划

> 本文件是当前**前瞻性规划**，分「优化提升」与「拓宽·拓展·拓深」两部分。
> 区别于 `TODO.md`（滚动待办）与 `FOUR_RELEASE_PLAN.md`（历史追加台账）——本文件回答「下一步往哪走」。
> 每条均标注**现状读数**（来自磁盘实读）与**验收口径**。规划以本仓已清理基线为起点。

## 现状基线（规划起点）

| 量 | 读数 | 出处 |
|---|---|---|
| 版本 | v3.23.4（五源同源） | `update-log.json` latest / `package.json` |
| 门禁 | `npm run check` **十一道门全过**，**1584 个 tests / 0 fail** | `package.json` scripts.check |
| 体量 | **261 个 .js / 231337 行**：apps 41 个（190 文件）、config 51 个 | `find` / `wc -l` |
| 跨仓消费 | 已接入上游全部 **5 面**；本仓→上游 **1 面**（`ruby.lonshaBridge` · v3.23.4 登记，R12 对账） | `bridge-contract` 门 / `open_face_registry.tsv` |

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
- **已交付 v3.23.3（第 1 批迁移）**：宿主（SillyTavern）注入对象的内存占用 —— 探针新增第 ③b 段（装 / 卸往返：四全局按**对象同一性**还原 + 堆跨轮趋势）与登记段 `approx_measurable`（带读数 + 残余边界），`unmeasurable` **4 → 3**。判据 `tests/system-v3210.test.mjs` 段 I 三条（含 I3 真源码破坏的负控制）。口径：**只迁能在桩宿主下近似的那一半**（真宿主那一份的实际占用仍不可测）；**展示面不得弱于判定面**（比同一性，不比 `typeof`）；**带 gc 才判**（不带 gc 403.25KB/轮 ⇒ 拒判）。
- **剩余（仍登记在 `unmeasurable` 段）**：真实 DOM 渲染 / 排版 / 合成耗时、跨会话小时级堆增长、V8 之外的运行时内存 —— 三条都依赖真 GPU / 真进程，非桩宿主可近似，仍归 **R-O3**。

### B3 · 门禁成本治理
- **现状**：173 个 tests + 十一道门。随功能增长门时间会膨胀。
- **路径**：给门禁加「自身耗时监控」——哪道门慢了就显形，防止某道门悄悄拖垮迭代节奏。
- **验收**：门禁输出含各道耗时，超阈值告警。
- **已交付 v3.20.6（首段）**：`scripts/check-file.mjs` 汇总增「耗时合计 + 最慢门」一行（各门 `ms` 本已逐行列出）。不改 `scripts.check` 链（A4 硬锁）。
- **已交付 v3.23.2（下段）**：阈值告警落地 —— `config/gate-budget.json`（每门一行 `ms` / `limit_ms` / `why`，真源落仓外文件、执行器不自带阈值）+ `scripts/check-file.mjs` 汇总新增**预算对账**段（逐门 `实测ms ≤ 预算ms`、超预算写告警、末尾给「N 道门超预算 / 全部在预算内」）。口径四条：**fail-open**（预算缺 ⇒ 只报耗时、不告警，且说出原因）、**告警不改判定**（退出码仍 0 / 1 / 2 三档）、**余量与基线分开**（`limit_ms` == round(`ms` * (1 + margin_pct / 100))，本版余量 10）、**真源只此一份**（预算表与 `scripts.check` 链逐门对齐，由判据钉住）。判据 `tests/system-v3201.test.mjs` F1~F5（含 1ms 极紧预算的负向自证与坏输入两向自证）。

---

## 二、拓宽·拓展·拓深

### T1 · 打通「本仓→上游」0 面【**两侧都已交付** · 本仓侧 v3.23.4 / 上游侧 v3.258.0】
- **现状（订正）**：**「0 面」这句已不真。** 两个仓的 PLAN 都写过它，两边都没人核过 —— 而实情是 `ruby.lonshaBridge`（`apps/memory/lonsha-bridge.js` 导出 `mountLonShaBridge`）**早就在跑**：上游 `index.js` 四处调用点（回填 `backfill` / 召回 `recall` / 楼层生命周期 `onFloorCommitted`、`onFloorRollback`）。本仓 41 个 App 沉淀的运行时事实（usage-tracker / life-events / phone-chat-memory / worldbook-dryrun 的选择结果）上游记忆图谱用得上。
- **路径**：按 `contract_shape` 九列范式新增第 6 行，**方向反转**——本仓做 producer、上游做 consumer。第一候选：usage-tracker 使用画像或 worldbook 选择回执。
- **验收**：本仓新增对应 producer 出口 + `bridge-contract` 门消费点，**上游另建对向表 + 对向判据**（不得套用 `open_face_registry.tsv` 的六条判据 —— 见下行「路径修正」）。
- **已交付 v3.23.4（本仓侧一半 · 判据 R12）**：`config/crossrepo-registry.js` 新增 `CROSSREPO_PRODUCED_FACES`（登记 `ruby.lonshaBridge` 一面：`owner` / `since` / `mountSite` / `upstreamConsumerFile` + `upstreamConsumerFloor: 4` / `upstreamConsumers` / `exports` / `methods` / `absentVsEmpty` / `standalone`），R12 作为**第十二条判据**加入既有的第十一道门 `scripts/upstream-face-audit.mjs`（**不新建门** —— 本仓严禁两门共号，新建会同时抬高语法门 / 导入门与边界文档的机器可读读数）。四格判「声明 ↔ 真码」：a 登记行形态、b 产出口名 / 方法名在场（`exports` 三态 / `methods` 类体，**两族分列各自判**）、c `mountSite` 真定义、d 上游消费面在上游分发面（`--upstream`；未给时**如实报未复核**）。判据 `tests/system-v3203.test.mjs` 段 G 11 条（**挂既有套件、不新建套件**）。真仓读数：`5 面（消费侧）/ 1 面（本仓产出侧 · R12）/ 问题 0`。
- **★ 路径修正（本段读取逼出来的）**：「按九列格式在 `open_face_registry.tsv` 新增第 6 行」**行不通** —— 那张表的六条判据（T2 符号必须能在**上游本仓**磁盘上找到定义 / T3 模块在上游分发面 / T4 `consumer` 只许 `name@N` 或 `none@0` / T5 四态 / T6 分态 / v3253-N0 阳性对照「未破坏时全量判据为零问题」）全是为「上游→下游」方向设计的。把反向面塞进去，要么判据全绿而**根本没看**（假绿），要么把表的语义改成「混合方向」而丢掉它的原价值。⇒ **正确形态是另建对向表 + 对向判据**（`upstream_symbol` → 改成「本仓 / 下游的产出面」语义，`consumer` → 改成「上游消费面」）。
- **上游侧同改（已交付 v3.258.0）**：上游新增 `tests/audit/open_face_registry_inbound.tsv`（1 面 × 9 列）+ `scan_inbound_faces.mjs`（六条判据 I1~I6，含方向硬断）+ 常驻套件 `tests/v3258_inbound_face_registry.test.mjs`（A 表本体 / B 真源码面 / C 负控制七例 / D 工具两向自证 / E 版本锚 / F 判据面自防护 / G 两表实时对账）；并订正正向表表头那句「下游→上游方向当前 0 面，故无行」与上游 `PLAN.md` 的基线行/该条目。**闭环读数**：上游 `scan_inbound_faces` rc=0（1 面 / 问题 0）、全量 **241/241 文件 · 2447 断言 · 0 失败**。
- **本仓侧读数（v3.23.4 真跑）**：`5 面 / 1 面 / 问题 0`；R12 四格在既有的第十一道门 `scripts/upstream-face-audit.mjs` 里对账（a 登记行形态 / b 本仓产出口名在场 / c 挂载点真定义 / d 上游消费点下限）。

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

1. **T1（**两侧都已交付**：本仓 v3.23.4 / 上游 v3.258.0）** —— 结构价值最高。本仓侧：`CROSSREPO_PRODUCED_FACES` + R12 四格 + G 段 11 条 + 五源同源已全部落地并真跑（`5 面 / 1 面 / 问题 0`）。**遗留**：① 上游侧另建对向表 + 对向判据（不得套用 `open_face_registry.tsv` 的九列正向契约，理由见上）；② 上游表头那句「**本表只登记上游→下游方向的外供面（下游→上游方向当前 0 面，故无行）**」仍是旧事实 —— 两仓 PLAN 与上游表头三处现在**都还在说「0 面」**，而本仓侧已经把它变成了机器会响的一面：**这条遗留本身就是「声明没有判据 ⇒ 声明会漂移」的当场示例**，故列第一优先。
2. **B1（R-O3）**——价值最高但依赖真宿主，排进下次有真机的窗口。
3. **B2 / B3**（替代覆盖 + 门禁治理）——成本中、回报稳。
4. **W1 / W2 / X1** 拓宽项按兴趣选切，moyunphone 储备是现成抓手。

> 维护规则：条目落地后，在条目末标注「已交付 v3.20.x」并附证据；不删历史条目，保持追加式。
