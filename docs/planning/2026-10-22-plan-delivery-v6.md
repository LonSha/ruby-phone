# 第六期规划交付检查（2026-10-22）

## 交付范围

四份计划各9项，合计36项；全部保持proposed。新增源码证据、可复跑模块观察脚本与六个产品批次；更新PLAN/README导航与第五期历史指针。RubyPhone的CONTEXT仅修一段与recallBlock源码不符的旧描述。

**业务源码、manifest、package、update-log和版本号均未改动。本轮不是功能发布。** 生产基线：记忆插件v3.353.0 / a6025ba；RubyPhone v4.47.0 / 6184b21。

## 本轮已执行

- 两仓 `node --check docs/planning/2026-10-22-product-probe-v6.mjs` 通过。
- 两仓 `node docs/planning/2026-10-22-product-probe-v6.mjs` 各3个场景通过，直接运行生产模块；不证明新计划已实现。
- 四份提案恰9×4条、36个唯一编号；六批次36/36各出现一次；明示依赖顺序通过，无倒置。
- 新提案相对链接/锚点与明确源码路径逐项核验；双仓联合证据页逐字相同。
- Skill原版格式检查器对本轮四份提案的隔离副本全部通过（两仓各2篇）。全笔记树检查保留历史失败：记忆仓format 23条、tree 1条；手机仓format 21条、tree 0条。对改动前HEAD同样运行，失败集合完全相同。本轮未清洗历史笔记，也未新增CI。
- 记忆仓 `node tests/audit/scan_plan_currency.mjs` 和 `node tests/audit/scan_doc_truthfulness.mjs` 通过；本轮没有重跑记忆仓全量。前次333文件/4031断言的结果与登记滞后见证据页，不能算成本轮测试。

## RubyPhone全量检查：未通过，不能宣称全绿

为执行仓库提交前检查，本轮在规划收口运行一次 `npm run check`：

| 阶段 | 结果 |
|---|---|
| syntax | 通过，872个文件可解析 |
| import-resolve | 通过，489文件、860静态导入、79动态导入记录 |
| test | 4900 tests，4871 pass，29 fail，0 cancelled/skipped/todo，约255.7秒 |
| 后续串联静态门 | 因test退出1而未继续，不计为通过 |
| check整体 | exit 1 |

额外定向运行 `scripts/source-derivation-audit.mjs` 也报告既有的item-custody-contract枚举登记缺口。没有因此修改守卫/台账来制造全绿。

### 基线复核

用 `git archive 6184b21` 解出独立副本，不checkout当前树、不建硬链接、不改原业务代码；对全量中失败涉及的14个套件做一次定向复验：

`node --test --test-concurrency=2 <下面14个套件>`

结果：**改动前基线同样29项失败，失败名称多重集合与当前全量完全相同，无仅当前存在的失败。** 这证明本轮规划改动没有引入这些失败，不证明所有失败的具体根因都已诊断，更不把失败转为通过。

- `tests/system-v290.test.mjs`
- `tests/system-v293.test.mjs`
- `tests/system-v296.test.mjs`
- `tests/system-v310.test.mjs`
- `tests/system-v311.test.mjs`
- `tests/system-v3120.test.mjs`
- `tests/system-v3201.test.mjs`
- `tests/system-v325.test.mjs`
- `tests/system-v326.test.mjs`
- `tests/system-v327.test.mjs`
- `tests/system-v328.test.mjs`
- `tests/system-v3570.test.mjs`
- `tests/system-v3730.test.mjs`
- `tests/system-v3770.test.mjs`

### 失败项（保留追溯，不启动修复项目）

- v290 D2. 负控制：恢复 app 自持第二个 store → lost update 复现（B2 判据转红）
- v293 D. 负控制：源键退回「含状态与 revision」→ 全程多条并存（判据转红）
- v293 D2. 负控制：抽掉整族回收 → 终态幽灵复现（B 判据转红）
- v296 A2. 真仓库上全绿（枚举面全部登记 / 出口在场 / 条目存活）
- v310 C1. ★ 视图真渲染三张卡（卡名 + 真数据都出现）
- v310 C2. ★ 上游旧版时不撒谎：三卡各自说「这版没有这个面」
- v310 C3. ★ 到访但未登记的条目显式标注（真缺陷不问不响）
- v311 C1. ★ 诊断卡真渲染场景头覆盖度行（真数据进 DOM）
- v311 C2. ★ 上游旧版时不撒谎：如实说「需插件 v3.221 或更新」
- v311 C3. ★ 有面为空时不撒谎：说「尚未登记」而不是「上游没这面」
- v311 N4. ★ 负控制：视图不渲染该行 ⇒ 判据（DOM 含真数据）转红
- C4 ★★ 真仓库读数：唯一实现被 ≥ 12 个文件引用，枚举面 > 180（自证防线不得失效）
- E2 边界文档与当版同源（复校标记在场 + 两道真门读数逐项一致）
- A2 探针读数与基线逐项一致（读数可复算，防转写漂移）
- A2 探针读数与基线逐项一致（读数可复算，防转写漂移）
- A2 探针读数与基线逐项一致（读数零手抄；枚举面与上限自证）
- FM1 判据散文可复算（零手抄）＋ 负控制：手抄漂移必须转红
- A2 用户在弹窗里真的读得到边界（本版不再只把边界写在工程文档里）
- B1 两侧同源：文档句子与用户可见条共用同一句标志语
- C1 文档里的实测数字必须与当前门禁真跑的一致
- D2 把用户可见条里的边界说明抹掉 ⇒ A2/B1 同款判据必须转红
- R1 门自证：真仓门全绿，且族名定义 / 探针实跑计数非零
- N1 门负控制：唯一实现被弱化 ⇒ 门必须转红（W5b 本体探针拦下）
- S3 落盘台账与现场取数逐格一致（漂移即红 —— 这就是「判据看守」）
- v3770 B2. 位置无关：镜像根上跑出**同一份**计数段
- v3770 D1. 摘掉消息图片的懒加载 ⇒ L1/L2/L7 必须转红，且不得带红 L3~L6（定点性）
- v3770 D2. 摘掉全部懒加载（两处） ⇒ 媒体指令契约回归失败
- v3770 D3. 把时间分隔条改成每楼一条 ⇒ L6 必须转红
- v3770 D5. 真源码破坏 phone.css 的装饰类覆盖 ⇒ L8（按动画名）必须点名转红

## 提交与验收边界

用户要求本轮规划上传远端，因此仅提交本轮规划与证据文件，明确保留上述基线失败；不声称已满足RubyPhone“check全绿”的代码发布条件，不打版本、不发Release、不修改门禁豁免。运行失败的修复不混入本轮36项，也不在本次擅自扩成守卫治理项目。

真实SillyTavern点击流、手机音频/后台行为与模型内容对照本轮均未执行；它们属于36项未来实施时的验收。新机制的效益、成本与首创性未作外部验证，不以规划文档代替产品证明。

最终推送是否成功以提交后 `git ls-remote origin refs/heads/main` 与本地HEAD一致为准；提交前本页不预写“推送成功”。

## 本地日志指纹

- `ruby_v6_planning_check.log`：SHA-256 `a979184590bab743c7518753f1f362ab097834c05e5cb8248f633ccfd48e2cee`（临时原始日志不保证长期保存）。
- `ruby-v6-all-failed-baseline.log`：SHA-256 `040b2f488589716c812f15e9a244ab1974ef63bf30cd76da71bae9398b8ef2af`（临时原始日志不保证长期保存）。
- `ruby-v6-baseline-comparison.json`：SHA-256 `d28ba7561c6dd5a2559e696718d6cb886d09bbaba7fdc669c9d16f7b764daf30`（临时原始日志不保证长期保存）。
