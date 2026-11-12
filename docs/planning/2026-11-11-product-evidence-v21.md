# 第二十一期产品证据（2026-11-11）

> 本文件是 R21/L21 三十六项的**立项依据留档**。每条结论都附可复跑的命令与真实读数。
> 纪律：**读数不手抄**（本文数字全部来自下列命令的真实输出），未跑过的不写。

## 0. 现场基线

```
ruby-phone             main = 827ecdc  dirty=0   v4.140.0
lonsha-memory-plugin   main = 9a6e158  dirty=0   v3.461.0
```

两仓 `feat/*` 分支**全部**已合入 main（`git merge-base --is-ancestor` 逐个确认）：

- ruby-phone：10 个 feat 分支全 MERGED
- lonsha：12 个 feat 分支全 MERGED

⇒ 第二十一期是**新立期号**，不与 v17/v18/v19/v20 重复。
`ui-a11y-settings` / `ui-u2-dialogs` / `ui-u4-settings-ia` 三个 UI 分支按用户决定**保持不动**。

## 1. rubyphone：四个真实缺口

### 1.1 「60fps 虚拟滚动」只出读数，不改渲染

命令：

```bash
grep -n '只做\*\*并行读数\*\*' apps/wechat/chat-view.js
sed -n '3618,3651p' apps/wechat/chat-view.js
wc -l apps/wechat/chat-view.js
```

读数：

- `apps/wechat/chat-view.js` **19775 行**
- 第 3624–3627 行原文：
  > ★ 只做**并行读数**，不改渲染：本仓已有 tailWindowOf 尾部窗口机制
  > （5000 条实测已降到窗口大小），再叠一层 DOM 复用属于重复实现……
  > 引擎的价值在这里是「量化」，不是「再渲染一遍」。

⇒ R17-O2 验收原文「DOM 恒定在 20 个以内、上千条飞速滑动不卡顿、零白屏」
**至今无一条被机器守住**。`tests/audit/longlist_scale_baseline.json` 的 `note` 自认
「读数不代表实机渲染耗时」。

项目判断：**保留 tailWindowOf（数据层）是对的**，缺的是**渲染层的 DOM 节点上界**。
故 R21-O1 的设计是与 tailWindowOf 共存、各管一层，不是推翻它。

### 1.2 时间单源欠债：10 个文件 180 处，其中 6 处属 story 档

命令：

```bash
python3 - <<'PY'
import json,re
wl=json.load(open('tests/fixtures/bare-now-whitelist.json'))['files']
for f,w in wl.items():
    if '待收口' in w:
        src=open(f).read(); print(src.count('Date.now()'), f)
PY
```

读数（白名单登记 204 条，`Date.now()` 合计 **905** 处）：

| 文件 | 文件内裸 `Date.now()` |
|---|---|
| `apps/wechat/chat-view.js` | 85 |
| `apps/wechat/wechat-data.js` | 27 |
| `apps/weibo/weibo-data.js` | 22 |
| `apps/loverspace/loverspace-app.js` | 17 |
| `apps/games/games-app.js` | 17 |
| `apps/honey/honey-data.js` | 13 |
| `apps/wangxiang/wangxiang-app.js` | 11 |
| `apps/moments/moments-dynamic-interaction-network.js` | 9 |
| ... | ... |

**真·内容时间轴（`timestamp: Date.now()` 形态）只有 6 处**：

```
apps/loverspace/loverspace-app.js:368  timestamp: Date.now()
apps/loverspace/loverspace-app.js:378  timestamp: Date.now()
apps/music/music-app.js:252            timestamp: Date.now()
apps/piggy/piggy-app.js:140            time: Date.now()
apps/wechat/chat-view.js:8447          timestamp: Date.now()
apps/wechat/chat-view.js:18639         timestamp: Date.now()
```

⇒ 关键判断：**不能一刀切**。180 处里绝大多数是渲染节流/幂等键/真实经过时间（wall 档），
改了会坏真实计时。R21-O2 只收口这 6 处，其余如实留在白名单并保留理由。

### 1.3 巨型文件无上界判据

```
408825 total            （全仓 js 总行数）
22665 ./data/cheats.js
19775 ./apps/wechat/chat-view.js
14486 ./index.js
12286 ./apps/settings/settings-app.js
11925 ./data/gacha-items.js
 9488 ./apps/honey/honey-view.js
 8613 ./apps/wechat/wechat-app.js
```

各 app 目录规模：

```
33 20071 apps/games/
23  8180 apps/health/
19 41503 apps/wechat/
16  9370 apps/asset/
14  8898 apps/memory/
```

101 个 app / 431 个测试文件。**没有任何判据守单文件行数上界**。

### 1.4 静态接线已干净，覆盖率是黑的

```
[AUDIT] 孤儿模块扫描（生产侧引用缺口）
参与判定文件数：798   测试文件数：493
✅ [DEAD] 无
✅ [TESTONLY] 无
🧹 [FORWARD] 2 个纯转发兼容层：
  - apps/games/games-data.js
  - apps/games/games-view.js
汇总：DEAD=0  TESTONLY=0  FORWARD=2
```

⇒ 「建好没接」在 rubyphone **已经基本收干净**。
真正的空白是：`package.json` 的 19 门门禁里**没有覆盖率门**，
`--experimental-test-coverage` 从未跑过 ⇒ 「哪些 app 一行测试都没有」**答不出来**。

## 2. lonsha：四个真实缺口

### 2.1 19 个模块 `prod_call_sites = 0`，而它们全在 `extra_js` 真加载

命令：读 `tests/audit/module_consumption_ledger.json`

```
schema module-consumption-ledger@1
generated_at 2026-11-05T20:57:47.056Z
total_modules 263
zero_consumption_count 19
why 分布：244 active / 19「存量独立算法库或工作台套件（待后续阶段接线或降级）」
```

19 条清单：

```
config-effect-registry.js              modules_combined.js
graph_algorithms.js                    world-clock-reader.js
world-ledger-reader.js                 cse-engine.js
api-channels.js                        fact-unified-lifecycle-bench.js
evidence-conflict-adjudication-bench.js unified-narrative-clock-axis.js
recall-route-feedback-bench.js         generation-material-budget-plan.js
fact-postgen-replay-receipt.js         maintenance-cold-warm-session.js
project-migration-boundary-bench.js    memory-task-workbench.js
meaning-evolution-map.js               multi-perspective-theater-bench.js
memory-action-symbiosis-circuit.js
```

**19 条理由全部是同一句话** ⇒ "待后续阶段"没有具体说明，是欠债标记而非理由。

### 2.2 消费台账覆盖 263 / 365 —— 102 个模块是审计盲区

```
根级 .js            366
manifest.extra_js   365
台账 modules        263
差集（在仓、真加载、不在台账）  102
```

102 个盲区里包含（节选）：

```
memory-symphony-orchestrator.js          1509 行  ← 总调度器本身不在台账
hierarchical-pyramid-evolution.js         339 行
memory-resonance-consolidation.js         265 行
anti-confusion-matrix-disambiguator.js    232 行
cognitive-horizon-bucket-filter.js        192 行
engine-symphony-wave-scheduler.js         183 行
counterfactual-firewall-engine.js         182 行
hypergraph-causal-backtracking-hub.js     173 行
...
worldaxis-objective-to-subjective-assimilator.js  61 行
```

⇒ **最讽的是 `memory-symphony-orchestrator.js`（1509 行，总调度器）自己不在台账里。**
这意味着"它有没有被用"这件事从来没有被审计过。

### 2.3 真机验证从未成立

`tests/audit/realhost_readings.json` 全文：

```json
{
  "schema": "realhost-readings@1",
  "generatedAt": "2026-11-09T10:41:08.357Z",
  "version": "3.461.0",
  "verdict": "environment-unavailable",
  "reason": "ST 未就绪（http://127.0.0.1:1/ ⇒ 0）—— 先起 SillyTavern",
  "source": "tests/audit/_realhost_suite.mjs bail"
}
```

三个真机套件（`v3428_l12_o5_realhost_suite` / `v3433_l13_o1_realhost` /
`l18_e2e_mind_symphony_fusion`）在本环境全部只能 bail。
**且没有任何门在读这份读数** ⇒ 真机不可用这件事既没有被记录成可算的三态，也没被守。

### 2.4 持久化字段靠手写枚举，漏过两次

`memory-organs.js` 3053 行，`WorldProgress` 挂 **74 个字段**：

```
absenceExpectations active autobiographies beliefs branchComparison cfExperiments
commitmentLedger config dimension echoLedger embedCache eraTransitions experiences
growthBundles habitRepos institutions items knowledge knowledgeTraces max memories
opLog parallelLedger pending plotArcs promises recallEcho recallSessions
relationDynamics researchInquiries resolutionLadder returnGate revision scenes
seasonState secretLedger seedLedger solverThreads symbolicEntities timeCoords
tombstones topicSeasons vectors worldline _branchSemanticsRead _confirmed ...
```

`grep -c 'toJSON|fromJSON|serialize|deserialize'` ⇒ **0**。导出/导入是手写枚举。

历史缺陷（本仓 TODO 原文）：

- v3.441.0：`seasonState` / `topicSeasons` 在构造/导出/导入三处**一次都没出现**
  ⇒ 「静音存盘即丢、读档即空」
- v3.442.0：同类补三处

⇒ 两次都是事后发现，**没有判据守「新增字段必须进三处枚举」**。

## 3. 两仓已有的、本期要复用的能力（不是为了"看起来有底座"）

| 能力 | 位置 | 状态 |
|---|---|---|
| 时间单源内核 | `ruby-phone/config/time-source.js` | 已用（v4.140.0 收口 moments） |
| 虚拟滚动切片计算 | `ruby-phone/phone/ui-virtual-list-scroller-60fps.js` | 已加载，只出读数 |
| 浏览器真跑层 | `ruby-phone/tests/browser/` | 已可用（真 Chromium 131） |
| 内存增长探针 | `ruby-phone/tests/audit/memory_growth_probe.cjs` | 有读数，无门 |
| 心理防御引擎 | `lonsha/ego-defense-mechanisms-engine.js` | 已加载，`prod=0` |
| 伏笔引擎 | `lonsha/latent-plot-foreshadowing-engine.js` | 已加载，`prod=0` |
| 默契暗号引擎 | `lonsha/tacit-intimacy-code-engine.js` | 已加载，`prod=0` |
| 创伤防线引擎 | `lonsha/trauma-taboo-defense-matrix.js` | 已加载，`prod=0` |
| 谣言异化引擎 | `lonsha/rumor-mutation-entropy-engine.js` | 已加载，`prod=0` |
| 起居节律引擎 | `lonsha/circadian-shared-routine-engine.js` | 已加载，`prod=0` |
| 世界线记忆 | `lonsha/worldline-memory.js` | 已接入 |
| 证据缺口工作台 | `lonsha/memory-archaeology-gap-bench.js` | 已接入（L13-X4） |
| 面板 27 视图 | `lonsha/settings-ui.js` | 27/27 静态可达 |

## 4. 三十六项的缺口对应表

| 项 | 咬的缺口 | 证据小节 |
|---|---|---|
| R21-O1 窗口化渲染 | 1.1 | §1.1 |
| R21-O2 时间轴收口 | 1.2 | §1.2 |
| R21-O3 拆巨型文件 | 1.3 | §1.3 |
| R21-O4 覆盖率入账 | 1.4 | §1.4 |
| R21-O5 时间文案口径 | 1.2 | §1.2 |
| R21-O6 内存趋势门 | §3 内存探针有读数无门 | §3 |
| R21-O7 转发层清零 | 1.4 | §1.4 |
| R21-O8 跨 app 实体归并 | v17/X 计划原文「应用孤岛」 | §3 |
| R21-O9 事件零订阅 | v4.139.0 补登记事件的另一面 | §3 |
| R21-X1 阅读游标 | 1.2（同一批改） | §1.2 |
| R21-X2 双仓时钟对齐 | 两仓各有剧情钟，从不互核 | §3 |
| R21-X3 静音解释 | 系统状态 → 叙事 | §3 |
| R21-X4 EXIF 校准 | 相册分组从未被读 | §1.3 |
| R21-X5 对话串联 | 消息账 × 通话账互不通 | §3 |
| R21-X6 变动摘要 | 无"离开再回来"记忆 | §3 |
| R21-X7 物理反馈 | `battery-thermodynamics` 已有 | §3 |
| R21-X8 恢复预览 | `backupdesk` 无预览 | §3 |
| R21-X9 本周回顾 | 跨 app 无聚合 | §3 |
| L21-O1 19 项定性 | 2.1 | §2.1 |
| L21-O2 台账覆盖 | 2.2 | §2.2 |
| L21-O3 替代证据链 | 2.3 | §2.3 |
| L21-O4 持久化登记 | 2.4 | §2.4 |
| L21-O5 注入回执全分面 | 既有门射程不足 | §3 |
| L21-O6 视图真开 | 27/27 静态可达 ≠ 能打开 | §3 |
| L21-O7 冻读取新鲜度 | 冻读取会过期 | §2.3 |
| L21-O8 写了不读扫描 | 历史两次偶然发现 | §2.4 |
| L21-O9 取库口对账 | v3.444.0 同名覆盖 | §2.1 |
| L21-X1~X6 | 6 个 `prod=0` 引擎接成闭环 | §2.1 / §3 |
| L21-X7 世界线自检 | 解析器只报坏行，不报语义错 | §3 |
| L21-X8 操作回声 | `oplog` 只记改了什么 | §3 |
| L21-X9 话题级不记得 | 条目级 ≠ 话题级 | §3 |

## 5. 复跑方式

```bash
# rubyphone
cd /home/user/ruby-phone
node tools/audit-orphan-modules.mjs
grep -n '只做\*\*并行读数\*\*' apps/wechat/chat-view.js
wc -l apps/wechat/chat-view.js apps/settings/settings-app.js
grep -c 'Date.now()' $(python3 -c "import json;print(' '.join(json.load(open('tests/fixtures/bare-now-whitelist.json'))['files']))")

# lonsha
cd /home/user/lonsha-memory-plugin
python3 -c "
import json
d=json.load(open('tests/audit/module_consumption_ledger.json'))
print('total',d['total_modules'],'zero',d['zero_consumption_count'])
e=json.load(open('manifest.json'))['extra_js']
print('extra_js',len(e),'ledger',len(d['modules']))
"
cat tests/audit/realhost_readings.json
```

## 6. 本期入口守卫已跑通（2026-11-12 实测）

### 6.1 rubyphone：10 个读 PLAN/TODO 的套件全绿

```bash
cd /home/user/ruby-phone
for t in tests/system-v280.test.mjs tests/system-v284.test.mjs tests/system-v300.test.mjs \
         tests/system-v301.test.mjs tests/system-v3210.test.mjs tests/system-v3290.test.mjs \
         tests/system-v3300.test.mjs tests/system-v3310.test.mjs tests/system-v4107.test.mjs \
         tests/system-v4980.test.mjs; do
  echo "$(timeout 200 node --test $t 2>&1 | grep -cE '^✖') fail | $t"
done
```

读数：**10 / 10 全 0 fail**。其中两条是本轮真正被修红的：

- `system-v4107`（13 条，含 5 条负控制）：本轮首跑红 3 处，逐条归因后全绿
  - A4/B2 红 ⇒ `## 优先级` 节仍是 R17 旧排序 ⇒ 换挡为 R21 18 个编号（带反引号，`includes` 才命中）
  - **C4 红是真缺陷**：`...optimization-v21.md` 里被多复制了一整段「拓展创新（九项）」，
    9 个 `### R21-X*` 长在 O 计划书里 ⇒ 删掉全部 `R21-O*` 后编号总数仍 18，
    fail-closed 负控制无从触发。删掉重复段 58 行（`### 拓展创新（九项）` 到 `## 批次与依赖` 之前）后转绿。
  - C2 红是写法问题：篡改锚点是带反引号的 `` `R21-X9` ``，裸编号命中不了 ⇒ 改回反引号。
- `system-v4980`（11 条，含 4 条负控制）：首跑红 `B1` / `C1`，根因是**本期 13 条新路径声明未登记**：

```bash
cd /home/user/ruby-phone
node scripts/doc-path-claim-audit.mjs   # 修前：发现 13 处未登记的路径落空声明
```

修法（两类分开，不混登）：

- **8 条是本仓未来交付物**（`tests/browser/scenarios/r21-windowed-stream.scen.js`、
  `tools/gen_time_debt_readings.mjs`、`tests/audit/time_debt_readings.json`、
  `scripts/coverage-report.mjs`、`tests/audit/coverage_baseline.json`、
  `tests/audit/forward_layer_ledger.json`、`tools/audit-event-subscribers.mjs`、
  `tests/audit/event_subscribers.json`）⇒ 登记进 `scripts/doc-path-claim-planned-deliverables.json`，
  带 `epoch: R21` / `land_version: v4.150.0` / 六字段齐全 ⇒ **到期自锁**（落地或到版本即报红要求撤账）。
- **3 条是 lonsha 上游真实文件**（`tests/audit/module_consumption_ledger.json`、
  `tests/audit/realhost_readings.json`、`tests/audit/_realhost_suite.mjs`；
  已用 `[ -f ]` 在 lonsha 仓逐个确认真实存在）⇒ 登记进 `scripts/doc-path-claim-baseline.json` 的
  `upstream_allowed`。**没有**给本仓不存在的文件开绿灯。

修后读数：`共扫描 4234 处声明（本仓 4095 / 上游 33 / 计划交付物 11），0 未登记落空`。

### 6.2 lonsha：77 个 audit 脚本，74 绿 / 3 红（3 红为本轮之前既有）

```bash
cd /home/user/lonsha-memory-plugin
for s in tests/audit/*.mjs; do
  case "$(basename $s)" in _*) continue;; esac
  timeout 200 node "$s" >/dev/null 2>&1 || echo "RED $s"
done
```

**3 条红与本期改动无关的机器证据**（不是"我觉得"，是把本期改动整体撤掉再跑）：

```bash
cd /home/user/lonsha-memory-plugin
git stash push -u -q -m "v21-plan-wip"
for s in scan_audit_lib_consolidation.mjs scan_v3193_host_matrix.mjs scan_v3193_host_matrix_negctl.mjs; do
  node tests/audit/$s >/dev/null 2>&1; echo "exit=$? | $s"
done
git stash pop -q
```

读数（**干净 main 上同样 exit=1**）：

```
exit=1 | scan_audit_lib_consolidation.mjs
exit=1 | scan_v3193_host_matrix.mjs
exit=1 | scan_v3193_host_matrix_negctl.mjs
```

另证：这 3 个脚本源码里 `PLAN` / `TODO` / `plan_currency` 的引用计数**全为 0**，
即它们根本不读本期改动的任何文件。⇒ **存量缺陷，记入下期观察，不算本期账**（不谎报成"全绿"）。

其中 `scan_v3193_host_matrix` 的 M3 实测信息：36 个脚本第二次加载抛
`SyntaxError: Identifier 'Tem…' has already been declared`（`temporal-flashbulb-dilation-engine.js`），
是模块重复加载不幂等的真问题 —— 已作为 **L21-O2 台账可信度**的旁证记入，不在本期顺手改。

### 6.3 lonsha 计划卫生门（本轮改动后转绿）

```bash
cd /home/user/lonsha-memory-plugin
node tests/audit/scan_plan_currency.mjs; echo "EXIT=$?"
```

读数：`✓ 计划陈旧口径卫生：现行节 1 个 · 排序型节 6 个（旧节全带陈旧标记）· 执行状态 v3.461.0`，EXIT=0。

改法（**判据倒逼文档，不是为绿而改判据**）：本条门 P1 要求「唯一现行排序」节**恰有一个**。
原 PLAN 第 168 行 `## 当前优先级（唯一现行排序 · 判据 scan_plan_currency.mjs）` 在新节插入后
成为**第二个**自称"唯一"的节 —— 这确实是文档自相矛盾。处置：

- 第 168 行第六期节 ⇒ 标题去掉"唯一现行排序"字样，改为
  `## 当前优先级（第六期 · 陈旧节：本期排序以文首「## 优先级」节为准）`，
  并在标题后 3 行内写入「陈旧标记」（P2 要求）；
- 新 `## 优先级` 节保留「唯一现行排序」⇒ 成为全仓唯一现行排序；
- `tests/audit/plan_currency.tsv` 同步：删掉退位项 `优先级`，登记新节名与改名后的历史节名（P5 双向齐全）。

## 7. 诚实边界

- 本文件所有读数采于 **2026-11-11**，两仓 main 分别为 `827ecdc` / `9a6e158`。
  若主线继续推进，读数需重采（**不许把旧读数当当前事实引用**）。
- **真机 SillyTavern 未执行**，本环境 `realhost_readings.verdict = environment-unavailable`。
  所有"玩家入口 / 验收旅程"描述的是**设计意图**，不是已验证结论。
- 浏览器层（真 Chromium 131）在 rubyphone **可用**，故 R21-O1 的 DOM 节点数可以被机器证实；
  lonsha 侧无同等级浏览器层，其视图验收走最小 DOM shim，**不等价于真浏览器**。