/* ========================================================
 * asset-terms.js — 资产引擎（移植自 LA-0.7.68 拓展版 src/asset-terms.js）
 *
 * 【移植纪律：零转录】
 *   本文件的正文**逐字**来自上游源文件，包含它原有的 `(function(){ ... })();` 外壳。
 *   外壳之内一个字都没有改写 —— 只在外层套了三个自由变量的兼容层：
 *     · `module`  → 让上游末尾的 `module.exports = api` 照常执行，工厂再把它交出来；
 *     · `require` → 按 __REQ 映射表返回静态 import 进来的依赖模块（上游是惰性取）；
 *     · `window`  → 置为 undefined，屏蔽上游的浏览器全局挂载分支（不污染宿主 window.parent）。
 *   因此本模块的导出面与上游**逐字等价**，无需重读逻辑即可信任。
 *
 * 【依赖】无（纯函数层）
 * 【上游定位】asset-terms.js
 * ======================================================== */
'use strict';

const __REQ = {};

export default (function () {
  const module = { exports: {} };
  const window = undefined;
  const require = function (p) {
    const f = __REQ[p];
    if (typeof f !== 'function') throw new Error('[asset-engine] unmapped require: ' + p);
    return f();
  };

(function(){
/* src/modules/asset/asset-terms.js */
'use strict';

// =====================================================================
// 资产模块 · 三档用语词表（唯一取词口）
// ---------------------------------------------------------------------
// 背景：0.7.49 预览页出来后，用户指出「三种主体下的用语还没改成三套」——
//       资产类目、行情标的、字段标签当时全是现代腔（股票 / 基金 / 账户）。
//
// 为什么要有这个词表（照 `medical-core.ERA_UI` + `test/era-ui83.test.js` 的四件套）
//   ① 词表自洽（三档 key 集合相同、值非空、除刻意同词外两两不等）
//   ② 取词口回落（认不出的档位 = modern）
//   ③ **反硬编码扫描**：面板上的这些词在别处不许再写成字面量
//   ④ 渲染层三档真生效 + **现代档逐字不变**
//
// ⚠️ 换皮边界（与医疗同一条口径）：**换皮只发生在屏幕上与投影给人的字**。
//    · 换：面板标题 / 表头 / 按钮 / 栏目标签；投影正文里的**类目名与量级词**
//    · **不换**：用户与 AI 自定义的分类名、资产条目名（「临湖别墅」就是「临湖别墅」）、
//      标的代码、金额数字、剧情日、历史流水里的原文
//
// ⚠️ 抽象层词（`稳健 / 成长 / 投机 / 冷门`）**刻意不进这张表**：
//    它们是**数据分层**（像 `itemType` 一样是分类，不是文案），投影与面板都直接显示；
//    某档想换个说法，由**标的表自己**去取（`sectorWords(era)` 的另一层，不在本表）。
// =====================================================================

const ERAS = ['modern', 'ancient', 'xianxia'];

// ---- 分类名（面板卡头 + 投影正文的类目前缀；**同一个词两处共用**）----
const CATEGORY_WORDS = {
  modern: { liquid: '流动资金', estate: '不动产', business: '经营资产', invest: '投资', debt: '负债' },
  ancient: { liquid: '现银', estate: '田产', business: '铺面', invest: '放贷', debt: '欠债' },
  xianxia: { liquid: '灵石', estate: '洞府', business: '坊铺', invest: '灵债', debt: '业债' },
};

// ---- 面板 / 表单 / 投影文案 ----
const ERA_UI = {
  modern: {
    sideHead: '角色', sideNote: '按资产规模',
    assetTab: '资产', marketTab: '行情',
    onboardTitle: '启用资产模块', onboardStart: '开始', onboardSkip: '先不启用',
    emptyLedger: '还没有角色账本', panelPlaceholder: '资产页与行情页的内容在后续批次接进来。',
    totalAssets: '总资产', netWorth: '净资产', debtTotal: '负债',
    investValue: '投资市值', unvalued: '另有无法估值', sinceLast: '较上期', today: '今日', inArrears: '笔在还',
    code: '代码', name: '名称', qty: '数量', cost: '成本', price: '现价', pnl: '盈亏',
    // ★ **面板批次修复轮（0.7.63）补的第六个列名**：行情表第六列（涨跌%）的表头。
    //   ⚠️ 不进 `move`（=「涨跌」，三档只有两种取值）—— 列名要**三档两两不等**
    //      （`test/asset-terms.test.js` ① 那条自洽判据 + 面板 `M1 ⑥` 的三档读文本都盯着它）。
    //   ⚠️ 值全进反硬编码扫描面（`asset-terms.test.js` ③ 的 `MIGRATED`）：面板里只许 `tw(T, 'pct', '')`。
    pct: '涨跌幅',
    position: '持仓', holding: '我的持仓',
    txn: '交易', buy: '买入', sell: '卖出', trade: '买卖',
    trend: '行情走势', trendPending: '走势图（后续版本）', basis: '基准价', move: '涨跌',
    quote: '行情', ticker: '标的', priceList: '标的表', promote: '提升为标的',
    close: '休市', open: '开市',
    // ★ 行情停用后的持仓降级（§8.2 `:880` 逐字要的那一句）：持仓**保留**、显示**最后已知价**
    //   + 这一句。本批（G3）**只出数据**（`valueHoldings` 的 `stale: true` + `notice: 'marketOff'`
    //   这个**词键**），**不上屏** —— 上屏是后续面板批次的事。
    //   ⚠️ **三档必须两两不同**（F6 复审 Minor-3：面板那条判据只查 `modern ≠ ancient`，
    //      **仙侠抄现代也能过**）⇒ 三档各写自己那一档的话，别抄。
    marketOff: '行情未启用，此价不再更新',
    // ★ **面板轮（行情页只读面）补的四个词键**。都是**行情页上必须印、而词表里一直没有**的话：
    //   ① `marketUnknown`：某一格**算不出来**时的字（铁律 6 / §3.9：「绝不许回落 0 或编数」）。
    //      预览页那一屏画的是 `—`，但那是**预览的画法**；brief §1 第 1 条明写"**算不出来就明说**"
    //      ⇒ 出的是这个词，不是破折号（破折号说不出"这一格为什么空着"）。
    //   ② `marketEmpty`：这一位名下一只持仓都没有（与"有持仓但算不出"必须分得开）。
    //   ③ `marketGap`：§3.8 三方对账的读数标签（`valueHoldings` 报出的 `gap` **照原样印**，
    //      面板一个字都不替它改 —— "不静默修正"）。**它不是错误信息**，是一个差值名。
    //   ④ `marketNoteEmpty`：行情注记那一张表还是空的（§5.6）。
    //   ⚠️ **四档一律不许三档同词**：`test/asset-terms.test.js` ① 的白名单**不给新键开口子**
    //      （同词 = 那一档实际上没换皮，用户报的正是「切了档面板没变」）。
    //   ⚠️ 这四个词键同时也是 `asset-terms.test.js` ③ 反硬编码扫描面的候选：
    //      它们的字面量**只许留在本文件**，面板里一律 `tw(T, 'marketUnknown', …)`。
    marketUnknown: '算不出',
    marketEmpty: '名下还没有持仓',
    marketGap: '对账差额',
    marketNoteEmpty: '还没有行情注记',
    //   ⑤ `marketChartEmpty`：走势图**空占位**里那一行（brief §1 第 6 条：照预览页留一个空框）。
    //      ⚠️ **不许用 `trendPending`**（=「走势图（后续版本）」）：§11 第 14 条禁的是
    //      「用户无法据以行动的措辞」，「后续版本」正是"你什么也做不了、只能等"这一类
    //      （0.7.61 那一句还被写死成三档同词 —— `asset-terms.test.js` ① 的白名单里
    //      `trendPending` 那条理由自己写着"落地那轮连词一起换"）。所以这里另起一个键，
    //      **三档各说各的**（不进白名单）。框里**只有这一行**，没有日期、没有曲线、没有结论。
    marketChartEmpty: '价格逐日走势',
    // ★★ **I1（0.7.64）· 行情投影（§5.9）那一族词键** —— 世界书里那条常驻条目的**每一个中文字**
    //    都从这里取（`asset-project.js` 的 `marketText` 只许 `tw(T, key)`，一个字面量都不许写）。
    //    形状（§5.9 逐字）：
    //        [金融市场]
    //        · 近况：{趋势综述} —— {主角持有部分的总市值量级 + 涨跌方向}
    //        · 近期波动：{上次最大波动标的} {涨跌幅度}（{持有/未持有}）
    //    分五组：
    //      ① 头部与两个标签：`mktHead`（方括号里那个词）/ `mktRecent` / `mktMove`；
    //      ② 趋势综述三档：`mktTrendUp/Flat/Down`（整条窗口的走向）；
    //      ③ 持有标记：`mktHeld` / `mktNotHeld`（**只对主角**判，§5.9 细节 1）；
    //      ④ 无关标的的代称：`mktAnonymous`（§5.9 细节 1「不点全名」—— 省 token，
    //         也贴合"你不关心的事不该占上下文"）；
    //      ⑤ 涨跌方向与两档幅度：`mktDirUp/Flat/Down`（持仓那一侧的走向）+
    //         `mktRiseBig/Small`、`mktFallBig/Small`（波动那一条的幅度词）。
    //    ⚠️ **幅度用词、不用数字**：公开层是"不许出现阿拉伯数字"的（`asset-project.test.js` ①），
    //       写成「+3.2%」会把那条安全判据当场撞红 —— 而且投影要的是"大不大"，不是"几个点"。
    //       「大 / 小」的分界是**可配的阈值**（`asset-project.js` 的 `MARKET_BIG_MOVE` 默认 3%），
    //       排名口径（近 N 日最大者）才是默认主口径（§5.9 细节 2 / 决策 25）。
    //    ⚠️ 全部 17 个键**三档两两不等**（`asset-terms.test.js` ① 那条自洽判据不给新键开口子），
    //       且三档的值**全部**要进 ③ 的反硬编码扫描面（只禁现代档的话，把古代 / 仙侠档
    //       整句写回面板源码照样绿 —— 同 `marketUnknown` 那一族的先例）。
    mktHead: '金融市场',
    mktRecent: '近况',
    mktMove: '近期波动',
    mktTrendUp: '整体走高', mktTrendFlat: '整体走平', mktTrendDown: '整体走低',
    mktHeld: '持有', mktNotHeld: '未持有',
    mktAnonymous: '某科技股',
    mktDirUp: '走高', mktDirFlat: '走平', mktDirDown: '走低',
    mktRiseBig: '大幅上涨', mktRiseSmall: '小幅上涨',
    mktFallBig: '大幅下跌', mktFallSmall: '小幅下跌',
    // 投影设置那一屏里新增的那一行勾选（**放在资产子页，不放行情页**）。
    // ⚠️ H1（0.7.65）更正：这一句从前写着"行情页是只读面" —— 现在的口径是**以规格 §6.1 为准**：
    //    行情页上**有** §5.5 那两档「行情裁判」开关（H1 落地），它**只写行情状态**；
    //    而「投影设置」仍然只挂资产子页（投影属资产那一侧，总开关也在那边）。
    //    "行情页不许写**账**"与"行情页能不能有自己的开关"是两件事，别混。
    // `projMarket` = 勾选框旁边的字；`projMarketNote` = 它下面那一句说明（要能照做：
    // 它说的是"开了之后世界书里多什么"，以及"与总开关的关系"）。
    projMarket: '行情投影',
    projMarketNote: '开启后世界书里会常驻一条行情条目：只写走势与最近一次最大波动，与主角无关的标的不点全名。总开关关着时，这一条也不投。',
    // ★★ **H1（0.7.65）· §5.4 大盘情绪系数 + §5.5 行情裁判的那一族词键**（9 个）。
    //    三档两两不等、三档的值**全部**进 `asset-terms.test.js` ③ 的 `MIGRATED` 扫描面
    //    （口径同 `pct` / I1 那一族：只禁现代档的话，把古代 / 仙侠档写回面板源码照样绿）。
    //    分组：
    //      ① 系数那一栏：`moodTitle`（这一栏叫什么）/ `moodDay`（「本日」那一格）/
    //         `moodEmpty`（还没有任何一条系数记录时那一句）；
    //         §5.4 那一行说明的形状 = `moodDay + 本日涨跌% + moodTitle + 系数%`
    //         （例：本日 −2.1%，大盘情绪 −3%）—— **数字由面板算，字从这里取**。
    //      ② 裁判那一栏（§5.5 两档）：`mgmtTitle`（这一栏叫什么）/ `mgmtBaseline` / `mgmtAi`
    //         （两档各自的名字）/ `mgmtHintBaseline` / `mgmtHintAi`（两档各自的代价提示，
    //         照生理模块 `mgmtSwitchHtml` 的形状：「每层一次裁判调用（耗 API）」）/
    //         `mgmtNote`（标题下面那一句：开启意味着什么、以及那条铁律）。
    //    ⚠️ 值里**不许有阿拉伯数字**（同 I1 那一族的理由：这一族的面板字不许夹数字，
    //       数字由面板在运行时算出来拼上去）。
    moodTitle: '大盘情绪',
    moodDay: '本日',
    moodEmpty: '尚无大盘记录',
    mgmtTitle: '行情裁判',
    mgmtBaseline: '随势自走',
    mgmtAi: 'AI 管理',
    mgmtHintBaseline: '按日自推，不调用模型',
    mgmtHintAi: '每层一次裁判调用（耗 API）',
    mgmtNote: '开启后按正文改盘，结果不再逐字可复现。裁判能动市场，不能动你的账。',
    // ★★ **H2（0.7.66）· §5.6 行情注记那一族的 14 个词键**（注记 = 缓冲带）。
    //    面板上这一族要印的字一共四类：
    //      ① 「未匹配」那个标记 + 两个动作的按钮（`unmatched` / `promoteNew` / `mountExisting`）；
    //      ② 两个自绘确认框的正文（`promoteBody` / `mountBody`）；
    //      ③ 挂完那一问「要不要记进别名」（`aliasTitle` / `aliasBody` / 两档答复 `aliasYes` / `aliasNo`）；
    //      ④ 两个必填格的验收话（`needBasePrice` / `needStoryDate`）+ 通用取消（`cancelAction`）
    //         + 提升表单里那两个数据层的标签（`tierLabel` / `volLabel`）。
    //    ⚠️ **三档两两不等**（`asset-terms.test.js` 的 `①·H2`）+ 值里**不许有阿拉伯数字**；
    //       45 个取值**全部**进 ③ 的 `MIGRATED` 扫描面（口径同 H1 那一族）。
    //    ⚠️ ★ **新键的值不许撞已有字面量**（I1 踩过：词键值当条目名会打架）——
    //       本轮进扫描面前**当场实测命中 0**（逐个新值扫过资产模块源码、剥注释后全 0）。
    //    ⚠️ `confirm`（那是既有的「确认 / 入账」那一格）**复用**，不另起一个提交键名。
    unmatched: '未匹配',
    promoteNew: '提升为新标的',
    mountExisting: '挂到已有标的',
    promoteBody: '把它收编成标的表里的一条真标的。基准价要你自己填 —— 系统不替你编价。',
    mountBody: '把这条注记挂到一只已有标的上。挂完可以把它记进那只标的的别名，下次自动对得上。',
    aliasTitle: '记进别名？',
    aliasBody: '记进之后，以后遇到同一句话就自动对得上这只标的；不记就只这一次。',
    aliasYes: '记进别名',
    aliasNo: '只这一次',
    cancelAction: '算了',
    needBasePrice: '请填一个正的基准价 —— 这一格不给，新的标的就没有起算价。',
    needStoryDate: '还没有剧情日期：先去别处把今天是哪一天定下来，再提升为标的。',
    needCodeFree: '换一个代码：标的表里已经有这一个了。',
    tierLabel: '类别',
    volLabel: '起伏',
    ledger: '流水', confirm: '确认', pending: '待确认', reject: '不要',
    // ---- 记账表单（B3 手动记一笔）：§9 点名的五个格 —— 谁 / 何时 / 方向 / 多少 / 什么事由。
    // 「谁」复用上面的 sideHead（角色 / 人物 / 修士），不另起一个 key。 ----
    entryTitle: '记一笔', entryAt: '时间', entryDirection: '方向',
    entryIn: '收入', entryOut: '支出', entryTransfer: '转移', entryTo: '转给',
    entryAmount: '金额', entryKind: '这一笔算什么',
    kindBalance: '净额变动', kindCashflow: '现金收支', kindReserve: '储备金',
    entryItem: '条目', entryNone: '不指定条目', entryReason: '事由', entrySubmit: '记上',
    entryNeedReason: '请先写下事由：这一笔从哪儿来、到哪儿去。',
    entryNeedTo: '转移要写清是转给谁。',
    entryNeedAmount: '请先填金额：进出多少钱，是这一笔的账。',
    entryNeedDate: '请先选好时间：这一笔是哪天发生的。',
    entryRecent: '最近两笔',
    // ---- C1 实例详情（§3.11.2 的三块）+ 实例列表 + 周期吞吐 ----
    // 三块各有一个**区块标题**：state 只描述、stock 是值、flows 是按周期的吞吐。
    // 三个标题分开叫，本身就是「三块必须分开」在屏幕上的那一眼。
    instListTitle: '资产条目', instEmpty: '这个角色还没有资产条目 —— 先记一笔，或加一条。',
    instUnpriced: '不计价', instValueNone: '暂无可估的值',
    // ★ **负债 / 透支那一格**（§3.9 `:260`：「条目变负数：**允许**，但面板与投影都必须
    //   **显式标**「负债 / 透支」」）。判定格（`holding.overdrawn`）与读口（`H.isOverdrawn`）
    //   在 G3 就就绪了，**三档词表里一直没有这句话** —— 面板批次没有词可印。本键补上。
    //   与 `instUnpriced` / `instValueNone` 同族（都是**条目身上那一格的标记词**，不是句子），
    //   且**三档两两不同**（`test/asset-terms.test.js` 有一条 `Set(...).size === 3` 钉着）。
    //   ⚠️ 它是**标记**不是诊断：判"这一条是不是负债"只许读 `H.isOverdrawn`（§11 第 1 条单一来源），
    //      面板自己写 `declared < 0` 就是第二份口径。
    instOverdrawn: '负债 / 透支',
    detailState: '状态', detailStock: '存量', detailFlows: '吞吐（按周期）',
    // 三块各自的空态：**不复用账本级的那两句**（`emptyLedger` 是"还没有角色账本"，
    // `instValueNone` 是"暂无可估的值"）—— 空 state / 空 flows 说的是这一条自己的事，
    // 借账本级的词会印出语义错位的句子（如"吞吐：暂无可估的值"）。
    detailStateEmpty: '这一条暂无状态可记', detailFlowsEmpty: '这一条还没有吞吐',
    detailBack: '← 回到列表',
    // 周期吞吐的量词（`flows[].period`）。认不出的周期一律按月说（第一版的结算周期就是月）。
    periodDay: '日', periodWeek: '周', periodMonth: '月', periodQuarter: '季', periodYear: '年',
    // ---- E1 周期账计划（§15.4 到点出提示 / §15.9 每条 flow 自己声明周期）----
    // 这一族是**结算这一层的用户可见文本**，三样东西：
    //   `settleReason` 一笔周期账的**事由**（`appendFlow` 的第一道闸就是事由必填，
    //      空的会被挡下 ⇒ 事由必须能自动生成，且是**有意义的短句**，不是空串）；
    //   `settleNothing` / `settleAlready` / `settleNoToday` / `settleNoBaseline`
    //      四种"这次没有该记的账"的说法。⚠️ 它们**分得开**（不是同一句万金油）：
    //      「这一期没有到点的账」与「今天已经结过」「今天拿不到剧情日」「没有上次结算日」
    //      是**四件不同的事** —— 混成一句，调用方就分不出"该推进时间戳"与"根本算不了"。
    //      尤其 `settleNoToday`：那是**不推进**那一条纪律在屏幕上的那句话
    //      （拿不到剧情日期就宁可不结，绝不用系统日期给一笔账编个日子）。
    settleReason: '周期进账到点', settleNothing: '这一期没有到点的周期进账',
    settleAlready: '今天已经结过了，这一期不再重复记',
    settleNoToday: '还没拿到剧情日期，这一期先不结（不改日期、不推进进度）',
    settleNoBaseline: '还差一个上次结算日，这一期先不结',
    // ---- E2 经营总览（§15.3 一眼四问）----
    // ⚠️ **这一屏是"行动屏"，不是"日志屏"**（§15.3 的那句：它报的不是内部错误，是用户能据此
    //    行动的经营结果）。所以这一族里**每一句都是"我接下来能做什么"**，没有一个字是
    //    "系统出了什么事"。`test/asset-panel.test.js` 的 E2 铁律 9 扫描钉着这件事。
    // ⚠️ **`亏损` 这个词刻意不在扫描词表里**：它是本屏的**核心信息**（"哪条在亏"就是第二问），
    //    扫它等于把这一屏要报的东西一起扫掉。
    ovTitle: '经营总览',
    // 第一问：本周期净额 + 与上周期对比。★ **对比要说得出一句话，不是并排两个数让人自己减**。
    ovThisPeriod: '本周期净额', ovPrevPeriod: '上周期净额',
    ovMore: '比上周期多', ovLess: '比上周期少', ovSame: '与上周期持平', ovNoPrior: '上周期还没有记账',
    // 第三问：**两个维度各自带名**（§14.3 #4 / 决策 46）—— 净资产变化 (=`balance`) 与
    // 月净现金流 (=`cashflow`) 是两件事，分开才写得出它们之间的关系。
    ovWorth: '净资产变化', ovCash: '月净现金流',
    // 第四问：亏损项旁的**可行动作**。★ 这里**没有**「重试 / 未就绪 / 不一致 / 失败」那一族字
    //   （铁律 9），也没有「卖掉」（§15.2：关停 ≠ 卖掉，那是资产层动作，本批不做）。
    //   `ovStop` 是**关停那一门**（§15.2 的 ⑥，与详情页的「摘经营」同一件事的两个入口）；
    //   `ovFix` 是"这一条没有在跑的经营"时的入口（进详情去挂/升级 —— 那才是能动手的事）。
    ovStop: '关停这一门', ovFix: '去处置',
    ovNoBiz: '名下还没有在经营的条目 —— 先挂一门经营，这一屏才数得出赚亏。',
    // 逐条那一行印的形态：`折合 3200 两/月` —— `ovRate` 是"折成一个月"那个动词。
    // ⚠️ 它**只是个前缀**，值本身走账本层那唯一一份求和（`sumFlows` / `flowSigned`）。
    //    三档各有各的说法（`asset-terms.test.js` ① 钉着"同词 = 那一档没换皮"）。
    ovRate: '折合',
    // ---- E3 视角（§15.9：日/周/季/月/年）----
    // ⚠️ **视角名本身走上面那五个既有量词**（`periodDay` … `periodYear`）——
    //    §15.9 点名的"日/周/季/月/年"就是这五档，**不另起一份**（三档各一份，周→旬→候）。
    // 这一族只补视角屏上**另外**那几个字：
    ovView: '视角',
    // `ovCash` 上面那一格的名字是**月**（§15.3 原文"月净现金流"）——
    // 视角一切到日/周/季/年，那个名字与窗口就对不上了（标签与数不符是本仓点过名的毛病）。
    // 所以非月视角另取这一格：**不点月份**的同一件事。
    ovCashPeriod: '本周期净现金流',
    // ★ **`0` 与"无记录"是两件事**（本条是 E3 的核心立场）：
    //    一格里有账、净额恰好是 0 ⇒ 照旧印 `0`；这一段**本来就没有记录** ⇒ 印这一句。
    //    拿 `0` 冒充"有账"，与"补出来的 0 被当成真价""估不出来印成净资产：0"是同一个错。
    ovNoRecord: '本期无记录',
    // 不完整周期（§15.9 要求②）：当前这一段还没走完 ⇒ 面板上明说这一句 + 哪一天算的。
    // 判定在 `aggregateFlows`（锚点 + 粒度算出的期末与"今天"比），**不读系统时钟**。
    ovAsOf: '截至今日',
    // ★ 两个对比基准（§15.9 要求①）各一族：**环比**（本段 vs 上一段）用上面
    //    `ovMore` / `ovLess` / `ovSame` / `ovNoPrior`；**同比**（本段 vs 去年同一段）用下面这一族。
    //    ⚠️ 两族**用词必须分得开**：合成一族，同比那句就会印出"比上周期多"，而它比的是去年。
    //    ⚠️ 两族的字面量也**不许互为子串**（上面两句是 `includes` 判据，子串会让两档混印）。
    ovYoy: '同比', ovYoyMore: '比去年同期多', ovYoyLess: '比去年同期少', ovYoySame: '与去年同期持平',
    ovYoyNone: '去年同期还没有记录',
    // ---- C2 动作区（§15.2 ② 部署）：挂经营 / 换模式 / 摘经营 ----
    // ⚠️ 这里**没有**「卖掉」这个词：关停 ≠ 卖掉 —— 卖掉是**资产层**动作（进账 + 条目消失），
    //    本任务不实现它，词表也就不给它留位置（灯下黑比"忘了接线"更坏：键在，按键却不在）。
    actAttach: '挂经营…', actSwitch: '换模式…', actDetach: '摘经营',
    actNoTemplate: '手边还没有可挂的经营模板 —— 先在分类里添一个，或给这一条挂一份分类模板，再来挂。',
    // ---- C3 纵向升级（§15.5）：升级入口 + 那一张升级表格 ----
    // ⚠️ 这里**没有**任何"等级 / 经验 / 进度条"的词：§15.5 末条（用户裁定「里程碑暂时不加」）——
    //    升级是"有成本的品质提升"，不是把条目养成一个进度条。词表不给进度条留位置，
    //    比"留着键但没接线"更安全（灯下黑比"忘了接线"更坏）。
    actUpgrade: '升级…', actUpAdd: '再加经营位…',
    upTitle: '升级', upConfirm: '确认升级', upNeedValue: '请先填上升级后的值：升到什么是你定的，系统不替你猜。',
    upNeedCost: '这一处还没有升级成本 —— 先在分类模板里给它写上 cost（没有成本的升级就是白送），再来升。',
    upNeedField: '这一条的分类模板里没有这一处字段（模板可能换过了）—— 先在分类里添上它，再来升。',
    upCost: '升级需 ', upMat: '还要耗 ', upEffect: '升级之后：',
    // ---- C4 转移（§15.8①）：详情页动作区的「转移…」+ 那一张转移表格 + 归属自检的读数 ----
    // ⚠️ 这里**没有**「卖掉 / 变卖」那种词：转移是**换主**（实例还在、条目还在，
    //    只是 `ownerKey` 换了个人），与"卖掉"（资产层动作：进账 + 条目消失）是两件事（§15.2）。
    //    词表不给"卖掉"留位置，比留着键却不接线更安全（灯下黑比"忘了接线"更坏）。
    actTransfer: '转移…', transferTitle: '转移给谁',
    transferTo: '转给', transferReason: '事由', transferSubmit: '确认转移',
    // 「归属已失」= §15.8① 的 "标'归属已失'"：`ownerKey` 指向的角色已经不在角色表里，
    // 而且历史里也找不回上一个真实的主（`auditOwnership` 回 `'lost'`）。
    // 它是一个**状态词**（那一行的读数），不是错误 —— 铁律 9：这一屏上没有一个字是"用户无从下手的"。
    ownerLost: '归属已失',
    transferNeedTarget: '请先选一位新主：这一处资产要转到谁名下。',
    transferNeedReason: '请先写下事由：这一处资产为什么换到他名下。',
    // 转给自己：明确无操作（core 回 `LA_ASSET_TRANSFER_SELF`）—— 这句是**能照做**的话：
    // 换一个人选，或者什么都不做（这处资产本来就是他的）。
    transferSelf: '这处资产已经记在这位名下了，不用再转一次。',
    marketScope: '大盘', note: '行情注记', history: '历史',
    // ---- D2 投影设置（§4.2 的三级闸门）----
    // ① 总开关 / ② 逐角色「参与并投影」 / ③ 逐字段「投影可见性」。
    // ⚠️ `projNotReady` **不是报错**（铁律 9：面板上不许有用户无从下手的字）——
    //    它是"还没到时候，已经自己排上了"那句话，与 family `family.script.js:328` 同族。
    // ★★ **E2 改了它的用词（D2 遗留，本批并入）**：原文是「世界书尚未就绪，已延后重试」——
    //    里面两个词（未就绪 / 重试）正是铁律 9 点名的那一族。它当年的立论（"这句是
    //    **说明**不是报错"）**是对的**，但用词没跟上：用户看到「未就绪」第一反应还是
    //    "是不是哪里没弄好"，而这一句真正要说的是"**已经自己排上了，你什么都不用做**"。
    //    所以只换词、不换语义，也**不换语气**（仍然是"我方已经处理了"那一档）。
    //    `test/asset-panel.test.js` 的 E2 铁律 9 扫描因此能把整个资产模块源码都扫进去
    //    （不必为这一句开一个例外 —— 例外会掩盖下一条真违规）。
    projTitle: '投影设置', projMaster: '参与投影', projMasterNote: '关掉就不再往世界书写一个字，账本一条都不删。',
    projRoleLabel: '参与并投影', projRoleNote: '关掉的人不进投影、也不进总览；他的账本照旧在面板上。',
    projFieldsLabel: '投影可见性', projFieldsNote: '同类条目全表生效；关掉的字段，面板与查看态一起隐藏 —— 投影本来就只投模糊量级，不含这些字段。',
    projFieldsEmpty: '还没有可关的字段 —— 先记一笔，这里才有可选的格子。',
    projOff: '整块投影现在是关着的。', projNotReady: '世界书还没到能写的时候，这一趟先跳过，后面几趟会自动接着来。',
    // ---- F4 提取二级面板（§6.2 / §6.3 / §6.4 / §7.3 / §9）----
    // ⚠️ 这一族里**没有**「已忽略」那一栏的名字：§6.2 的决策 13 明写"刻意不做第三栏"，
    //    词表也就不给它留位置（灯下黑比"忘了接线"更坏：键在、按键却不在）。
    // `extractNote` 是**唯一**那份落点说明（§7.4 第 5 条：清单里只放一条只读说明，
    // 不摆第二份落点 UI —— 两份必然漂移）。三个档位各说各的。
    extractTitle: '从正文提取',
    extractParse: '读一读这一层',
    extractConfirm: '纳入',
    extractBadReply: '模型这一趟没有按格式回（账本一个字节都没动）—— 可以再点一次「读一读这一层」。',
    extractNote: '读完先摆在这儿逐项定：点「确认」才落账；点「待确认」只进池子（不进总资产、不进投影）；点「不要」就把这一项的内容清掉。落点只有这一处，别处不再摆第二份清单。',
    extractEmpty: '这一段里没有读出已经发生的资产事实。',
    extractPoolTitle: '待确认池',
    extractBatchTitle: '最近一批',
    voidTitle: '整批撤回',
    voidReason: '撤回事由',
    voidNeedReason: '请先写一句事由：这一批为什么撤回。',
    voidDone: '已撤回',
    voidNotFound: '这一批在账上指认不到了（多半是落位已经对不上）—— 回到正文那一层重新读一遍，再撤回一次。',
    voidAmbiguous: '这一批里混着同一天的其他流水，没法整批撤回 —— 请先处置那一笔。',
    // ---- F6 新建一条资产（**与「记一笔」并列的第二个显式动作** · §7.4 #6）----
    // 「新增一条资产 vs 修改已有余额，必须是两个显式动作」—— 这一族就是"新增"那一个动作
    // 在屏幕上的字：一张自己的卡、三个必填格、一句自己的落点说明。
    // ⚠️ 三个必填格的**称呼分得开**（归属 / 分类 / 名字），缺哪一格就印哪一格那一句
    //    （铁律 9：给一句能照做的话，不说"表单不完整"这种用户无从下手的字）。
    // ⚠️ `caFor` 就是**归属**那一格的名字，它**不复用** `sideHead`（「角色」）—— 左栏那一列
    //    说的是"在看谁"，这一格说的是"这条资产记在谁名下"，两件事（转移换主那族已经点过名）。
    caTitle: '新建一条',
    caFor: '归属', caCat: '分类', caName: '名字',
    caSubmit: '建这一条',
    caNeedOwner: '请先选一条归属：这条资产记在谁名下。',
    caNeedCat: '请先选一个分类：这一条算哪一类。',
    caNeedName: '请先写下名字：这一条在账上叫什么。',
    extractNeedActor: '这一笔还不知道记在谁账上 —— 先在左栏点一位。',
    extractTotal: '合计',
    extractWorthWord: '新增估值',
    extractUnvaluedUnit: '项',
    worthUnit: '元', scaleWan: '万', scaleYi: '亿',
    // ---- 量级词（投影正文的**模糊量级**，§4.3：「千万级」而不是「1,842,000」）----
    // ⚠️ **一律只用汉字数字**：公开层的安全判据是"正文里不许出现阿拉伯数字"（扫 `[0-9]`）。
    //    写成「10万」那一格就会被自己那条判据抓住 —— 判据与词表当场打架。
    // ⚠️ 分档规则（D1 自定裁定，见 `asset-project.js` 的 `SCALE_TIERS`）：十一档，
    //    千 / 万 / 十万 / 百万 / 千万 / 亿 / 十亿 / 百亿 / 千亿 / 万亿；小于千不给量级。
    //    这里是**词头**（不是整词）：十 / 百 / 千 / 万 / 亿 五个字数，
    //    由 `scaleOf` 按档拼（「十」+「万」= 十万）—— 这样"三档词表 key 集合相同"
    //    那条自洽判据不必为每一种组合再造一个 key。
    //    `scaleWan` / `scaleYi` 是 0.7.49 就有的两个（口径没动）；其余是 D1 补的
    //    ——§4.3 的例子里点名了「千万级」，一个「万」不够用。
    scaleThousand: '千', scaleTenWan: '十', scaleHundredWan: '百', scaleThousandWan: '千',
    scaleTenYi: '十', scaleHundredYi: '百', scaleThousandYi: '千', scaleTenThousandYi: '万亿',
  },
  ancient: {
    sideHead: '人物', sideNote: '按家私厚薄',
    assetTab: '家私', marketTab: '行情',
    onboardTitle: '开个体己账', onboardStart: '就这样立账', onboardSkip: '这回先搁着',
    emptyLedger: '账上还没人', panelPlaceholder: '家私页与行市页的条目，待后续再添。',
    totalAssets: '总家私', netWorth: '净家私', debtTotal: '欠债',
    investValue: '放贷本息', unvalued: '另有无法估值', sinceLast: '较上回', today: '今日', inArrears: '笔未清',
    code: '牌号', name: '名目', qty: '数目', cost: '本钱', price: '时价', pnl: '盈亏',
    // 第六个列名（涨跌%）古代档：说「成数」（几成）—— **不许抄现代档**（抄了那一档就没换皮）
    pct: '涨落成数',
    position: '囤货', holding: '我的囤货',
    txn: '交割', buy: '买进', sell: '卖出', trade: '买卖',
    trend: '行情走势', trendPending: '走势图（后续版本）', basis: '常价', move: '涨落',
    quote: '行市', ticker: '货色', priceList: '行市单', promote: '录为货色',
    close: '收市', open: '开市',
    // 行情停用后的持仓降级（§8.2）：这一档说「未开 / 更动」（现代档那一句是「未启用 / 更新」，
    // 仙侠档是「未启 / 自此不动」）—— 三档各说各的，谁也不抄谁。
    marketOff: '行情未开，此价不再更动',
    // 面板轮补的四个词键（理由见现代档那一族；三档两两不同，别抄现档）
    marketUnknown: '未能算出',
    marketEmpty: '名下尚无囤货',
    marketGap: '对账长短',
    marketNoteEmpty: '尚无市面琐记',
    marketChartEmpty: '逐日行市',
    // ★ I1（0.7.64）行情投影那一族（古代档）。分组与理由见现代档那一族的注释；
    //   三档两两不等（这一档不许抄现代档 —— 抄了就红在 `asset-terms.test.js` ①）。
    mktHead: '市井行市',
    mktRecent: '近日光景',
    mktMove: '近日起落',
    mktTrendUp: '市面看涨', mktTrendFlat: '市面平缓', mktTrendDown: '市面看跌',
    mktHeld: '在手上', mktNotHeld: '不在手上',
    mktAnonymous: '某家商号',
    mktDirUp: '见涨', mktDirFlat: '持平', mktDirDown: '见跌',
    mktRiseBig: '大涨', mktRiseSmall: '微涨',
    mktFallBig: '大跌', mktFallSmall: '微跌',
    projMarket: '市面投影',
    projMarketNote: '开启后世界书里会常驻一条市面条目：只写市面走势与近日最大的一回起落，与自家无关的商号不点全名。总开关关着时，这一条也不投。',
    // ★ H1（0.7.65）那一族（古代档）。分组与理由见现代档那一族的注释；三档不许互抄。
    moodTitle: '市面气象',
    moodDay: '今日',
    moodEmpty: '尚无市面气象',
    mgmtTitle: '市面判官',
    mgmtBaseline: '顺其自然',
    mgmtAi: '灵机代断',
    mgmtHintBaseline: '按日自推，不请旁人',
    mgmtHintAi: '每层一请判官（耗 API）',
    mgmtNote: '开启后按正文改市，结果不再逐字可复现。判官能动市面，不能动你的账。',
    // H2（0.7.66）· §5.6 那一族（理由见现代档那一块注释）：三档各说各的，别抄。
    unmatched: '未对上',
    promoteNew: '另立新货',
    mountExisting: '归入已有货',
    promoteBody: '把它收进市面那本册子里，成一条真货。本钱要你自己写 —— 账房不替你编。',
    mountBody: '把这一条记挂到一条已有货上。挂完可以把它记进那货的别称，下次自会对上。',
    aliasTitle: '记进别称？',
    aliasBody: '记进之后，往后遇上同一句话就自会对上这条货；不记就只这一回。',
    aliasYes: '记进别称',
    aliasNo: '就这一回',
    cancelAction: '罢了',
    needBasePrice: '请写一个正的本钱 —— 这一格不写，新货就没有起算的价。',
    needStoryDate: '还没见着剧情时日：先去别处把今日定下来，再另立新货。',
    needCodeFree: '换一个代码：册子里已经记着这一个了。',
    tierLabel: '行当',
    volLabel: '起落',
    ledger: '账目', confirm: '入账', pending: '待核', reject: '剔去',
    entryTitle: '添一笔', entryAt: '时日', entryDirection: '进出',
    entryIn: '进项', entryOut: '出项', entryTransfer: '转手', entryTo: '转与',
    entryAmount: '银钱', entryKind: '这一笔记哪门',
    kindBalance: '家底增减', kindCashflow: '现钱进出', kindReserve: '积存',
    entryItem: '物件', entryNone: '不指某一条', entryReason: '缘由', entrySubmit: '入账',
    entryNeedReason: '请先写下缘由：这一笔打哪儿来、往哪儿去。',
    entryNeedTo: '转手要写清是转与谁。',
    entryNeedAmount: '请先把银钱数目填上：进出多少，这笔账才立得住。',
    entryNeedDate: '请先择定时日：这一笔是哪一天的事。',
    entryRecent: '近两笔',
    instListTitle: '名下物件', instEmpty: '这一位名下还没有物件 —— 先添一笔，或记上一条。',
    instUnpriced: '不计价', instValueNone: '暂无估得出的值',
    // 负债 / 透支那一格的古代档说法（理由见现代档那一族；三档两两不同，别抄现档）
    instOverdrawn: '倒欠 / 空底',
    detailState: '情形', detailStock: '存项', detailFlows: '进项（按期）',
    detailStateEmpty: '这一件没记下什么情形', detailFlowsEmpty: '这一件还没有进项',
    detailBack: '← 回到名册',
    periodDay: '日', periodWeek: '旬', periodMonth: '月', periodQuarter: '季', periodYear: '岁',
    // E1 周期账计划：四句"这次没有该记的账"分得开（理由见现代档那一族）
    settleReason: '周期进项到点', settleNothing: '这一期没有到点的周期进项',
    settleAlready: '今日已结过，这一期不再重记',
    settleNoToday: '尚未见着剧情时日，这一期先不结（不改时日、不推进进度）',
    settleNoBaseline: '还缺一个上次结算之日，这一期先不结',
    // ---- E2 经营总览（§15.3 一眼四问）—— 理由见现代档那一族 ----
    ovTitle: '营生总目',
    ovThisPeriod: '这一段进项', ovPrevPeriod: '上一段进项',
    ovMore: '比上一段多', ovLess: '比上一段少', ovSame: '与上一段持平', ovNoPrior: '上一段还没有账',
    ovWorth: '家底增减', ovCash: '月净现钱',
    ovStop: '歇了这一门', ovFix: '去打理',
    ovNoBiz: '名下还没有在做的营生 —— 先起一门，这一屏才数得出赔赚。',
    ovRate: '折作',
    // ---- E3 视角（§15.9）—— 理由见现代档那一族 ----
    ovView: '看账的口径', ovCashPeriod: '这一段净现钱',
    ovNoRecord: '这一段没有账', ovAsOf: '算到今日',
    ovYoy: '较去年同时', ovYoyMore: '较去年同时多', ovYoyLess: '较去年同时少', ovYoySame: '与去年同时持平',
    ovYoyNone: '去年同时还没有账',
    actAttach: '起营生…', actSwitch: '改营生…', actDetach: '歇营生',
    actNoTemplate: '手边还没有可起的营生 —— 且先在类目里添一门，再来说营生。',
    actUpgrade: '精进…', actUpAdd: '再添一处营生…',
    upTitle: '精进', upConfirm: '定下精进', upNeedValue: '请先写下精进之后的值：精进到哪一步是你定的，账上不替你猜。',
    upNeedCost: '这一处还没定下精进的使费 —— 先在类目里给它写上 cost（不花本钱的精进便是白得），再来精进。',
    upNeedField: '这一条的名目里没有这一处（名目兴许换过了）—— 先在类目里添上它，再来精进。',
    upCost: '精进需 ', upMat: '另耗 ', upEffect: '精进之后：',
    actTransfer: '过到别家…', transferTitle: '过给谁',
    transferTo: '过与', transferReason: '缘由', transferSubmit: '定下过契',
    ownerLost: '已无主',
    transferNeedTarget: '请先择一位新主：这一件要过到谁名下。',
    transferNeedReason: '请先写下缘由：这一件因何过到他名下。',
    transferSelf: '这一件本就在他名下，不必再过一回。',
    marketScope: '大势', note: '市面琐记', history: '旧账',
    projTitle: '外传之设', projMaster: '录入外传', projMasterNote: '一关，外传上一个字也不再添；账簿一笔不删。',
    projRoleLabel: '录入外传', projRoleNote: '关掉的人不录外传、也不入总目；他的账簿照旧在册上。',
    projFieldsLabel: '外传所见', projFieldsNote: '同类之物一并生效；关掉的格子，册上与查看之处一起隐去 —— 外传本来就只说个大概，不载这些格子。',
    projFieldsEmpty: '眼下没有可关的格子 —— 先记一笔，这里才有得选。',
    projOff: '外传整块眼下是关着的。', projNotReady: '外传之处还没到能落笔的时候，这一趟先搁下，后面几趟自会接着来。',
    extractTitle: '自正文录出',
    extractParse: '把这层读一遍',
    extractConfirm: '收进',
    extractBadReply: '这一趟没有按格式回话（账目一个字节都没动）—— 可以再点一回「把这层读一遍」。',
    extractNote: '读罢先摆在此处逐项定夺：点「入账」才落账；点「待核」只入池子（不进总家私、不录外传）；点「剔去」便将这一项的内容清去。落点只此一处，别处不再另摆一份清单。',
    extractEmpty: '这一段里没有录出已经发生的家私事实。',
    extractPoolTitle: '待核之数',
    extractBatchTitle: '新近一宗',
    voidTitle: '整宗追回',
    voidReason: '追回缘由',
    voidNeedReason: '请先写下缘由：这一宗因何追回。',
    voidDone: '已追回',
    voidNotFound: '这一宗在账上指认不出了（多半是落位已经对不上）—— 回正文那一层重读一遍，再追回一次。',
    voidAmbiguous: '这一宗里混着同一天别的流水，整宗追回不得 —— 请先处置那一笔。',
    // ---- F6 新建一条资产 —— 理由见现代档那一族 ----
    caTitle: '另添一件',
    caFor: '归谁', caCat: '门类', caName: '名目',
    caSubmit: '添上',
    caNeedOwner: '请先择一位归谁：这一件记在谁家的账上。',
    caNeedCat: '请先择一门类：这一件算哪一门。',
    caNeedName: '请先写下名目：这一件在账上叫什么。',
    extractNeedActor: '这一笔还不知道记在谁家的账上 —— 先在左栏点一位。',
    extractTotal: '通计',
    extractWorthWord: '新添之值',
    extractUnvaluedUnit: '宗',
    worthUnit: '两', scaleWan: '万', scaleYi: '亿',
    scaleThousand: '千', scaleTenWan: '十', scaleHundredWan: '百', scaleThousandWan: '千',
    scaleTenYi: '十', scaleHundredYi: '百', scaleThousandYi: '千', scaleTenThousandYi: '万亿',   // 量级词，同现代档
  },
  xianxia: {
    sideHead: '修士', sideNote: '按身家厚薄',
    assetTab: '身家', marketTab: '行市',
    onboardTitle: '开一册身家簿', onboardStart: '就此开簿', onboardSkip: '暂且封着',
    emptyLedger: '簿上还没有人', panelPlaceholder: '身家页与行市页的内容，待后续再录。',
    totalAssets: '总身家', netWorth: '净身家', debtTotal: '业债',
    investValue: '灵债本息', unvalued: '另有无法估值', sinceLast: '较上回', today: '今日', inArrears: '笔未偿',
    code: '符印', name: '名目', qty: '份数', cost: '本命价', price: '现价', pnl: '盈亏',
    // 第六个列名（涨跌%）仙侠档：说「盈虚之数」—— 与古代档（涨落成数）也**不许同词**
    pct: '盈虚之数',
    position: '持仓', holding: '我的灵仓',
    txn: '易物', buy: '购入', sell: '出让', trade: '买卖',
    trend: '走势天机', trendPending: '走势图（后续版本）', basis: '定基价', move: '涨落',
    quote: '行市', ticker: '灵货', priceList: '行市谱', promote: '录入灵货',
    close: '闭市', open: '开市',
    // 行情停用后的持仓降级（§8.2）：这一档自己说（行市未启 / 自此不动），
    // **不许抄现代档**（面板那条"两两不等"的判据只查现代 vs 古代，抄了也看不出来）。
    marketOff: '行市未启，此价自此不动',
    // 面板轮补的四个词键（理由见现代档那一族；三档两两不同，别抄现档）
    marketUnknown: '推算不出',
    marketEmpty: '名下未有灵仓',
    marketGap: '对账出入',
    marketNoteEmpty: '未有行市琐记',
    marketChartEmpty: '逐日天机',
    // ★ I1（0.7.64）行情投影那一族（仙侠档）。分组与理由见现代档那一族的注释；
    //   三档两两不等（这一档不许抄任何一档 —— 抄了就红在 `asset-terms.test.js` ①）。
    mktHead: '灵市行情',
    mktRecent: '近日气象',
    mktMove: '近日盈虚',
    mktTrendUp: '灵潮上涌', mktTrendFlat: '灵潮平稳', mktTrendDown: '灵潮退落',
    mktHeld: '纳在囊中', mktNotHeld: '未纳囊中',
    mktAnonymous: '某处坊铺',
    mktDirUp: '上涌', mktDirFlat: '平稳', mktDirDown: '退落',
    mktRiseBig: '暴涨', mktRiseSmall: '略涨',
    mktFallBig: '暴跌', mktFallSmall: '略跌',
    projMarket: '灵市投影',
    projMarketNote: '开启后世界书里会常驻一条灵市条目：只写灵市气象与近日最大的一回盈虚，与自身无关的坊铺不点全名。总开关关着时，这一条也不投。',
    // ★ H1（0.7.65）那一族（仙侠档）。分组与理由见现代档那一族的注释；三档不许互抄。
    moodTitle: '灵潮气数',
    moodDay: '是日',
    moodEmpty: '未有灵潮气数',
    mgmtTitle: '灵市司命',
    mgmtBaseline: '听其自化',
    mgmtAi: '天机代断',
    mgmtHintBaseline: '按日自推，不卜天机',
    mgmtHintAi: '每层一卜天机（耗 API）',
    mgmtNote: '开启后按正文改天机，结果不再逐字可复现。司命能动灵市，不能动你的账。',
    // H2（0.7.66）· §5.6 那一族（理由见现代档那一块注释）：三档各说各的，别抄。
    unmatched: '无着落',
    promoteNew: '另立灵标',
    mountExisting: '归入已有灵标',
    promoteBody: '把它收进灵市名册，成一条真灵标。本值要你自己定 —— 司命不替你编。',
    mountBody: '把这一条记归入一条已有灵标。归完可以把它记进那标的异名，下次自会认上。',
    aliasTitle: '记进异名？',
    aliasBody: '记进之后，往后遇上同一句话就自会认上这条灵标；不记就仅此一遭。',
    aliasYes: '记进异名',
    aliasNo: '仅此一遭',
    cancelAction: '作罢',
    needBasePrice: '请定一个正的本值 —— 这一格不定，新灵标就没有起算之数。',
    needStoryDate: '尚未见着剧情时日：先去别处定下是日，再另立灵标。',
    needCodeFree: '换一个代码：名册里已经有这一个了。',
    tierLabel: '品类',
    volLabel: '盈虚',
    ledger: '灵账', confirm: '入账', pending: '待核', reject: '除去',
    entryTitle: '录一笔', entryAt: '天时', entryDirection: '去来',
    entryIn: '入项', entryOut: '耗散', entryTransfer: '移交', entryTo: '移授',
    entryAmount: '数额', entryKind: '这一笔归哪一道',
    kindBalance: '身家消长', kindCashflow: '灵石进出', kindReserve: '蓄积',
    entryItem: '物事', entryNone: '不指某一项', entryReason: '因果', entrySubmit: '录上',
    entryNeedReason: '请先写下因果：这一笔自何处来、归何处去。',
    entryNeedTo: '移交要写清是移授谁。',
    entryNeedAmount: '请先录下数额：出入多少，这一笔才落得实。',
    entryNeedDate: '请先定下天时：这一笔是哪一日的事。',
    entryRecent: '近两录',
    instListTitle: '身家条目', instEmpty: '这一位还没有身家条目 —— 先录一笔，或添上一项。',
    instUnpriced: '不计价', instValueNone: '暂无可算之值',
    // 负债 / 透支那一格的仙侠档说法（理由见现代档那一族；三档两两不同，别抄现档）
    instOverdrawn: '亏空 / 逆差',
    detailState: '本相', detailStock: '存量', detailFlows: '来去（按劫）',
    detailStateEmpty: '这一项还没有录下本相', detailFlowsEmpty: '这一项还没有来去',
    detailBack: '← 回到名录',
    periodDay: '日', periodWeek: '候', periodMonth: '月', periodQuarter: '季', periodYear: '载',
    // E1 周期账计划：四句"这次没有该记的账"分得开（理由见现代档那一族）
    settleReason: '周期来去到点', settleNothing: '这一段没有到点的周期来去',
    settleAlready: '今日已结过，这一段不再重录',
    settleNoToday: '天时未至，这一段先不结（不改天时、不推进进度）',
    settleNoBaseline: '还少一个上次结算之日，这一段先不结',
    // ---- E2 经营总览（§15.3 一眼四问）—— 理由见现代档那一族 ----
    ovTitle: '营生总览',
    ovThisPeriod: '这一段进益', ovPrevPeriod: '上一段进益',
    ovMore: '比上一段多', ovLess: '比上一段少', ovSame: '与上一段相平', ovNoPrior: '上一段尚无录',
    ovWorth: '身家消长', ovCash: '月净灵流',
    ovStop: '止了这一门', ovFix: '去料理',
    ovNoBiz: '名下还没有在营生的条目 —— 先起一门，这一屏才数得出盈亏。',
    ovRate: '折为',
    // ---- E3 视角（§15.9）—— 理由见现代档那一族 ----
    ovView: '观照之档', ovCashPeriod: '这一段净灵流',
    ovNoRecord: '这一段尚无录', ovAsOf: '止于今日',
    ovYoy: '较去年此段', ovYoyMore: '较去年此段多', ovYoyLess: '较去年此段少', ovYoySame: '与去年此段相平',
    ovYoyNone: '去年此段尚无录',
    actAttach: '启道业…', actSwitch: '易道业…', actDetach: '收道业',
    actNoTemplate: '手边还没有可启的道业 —— 先添一门类目，再来启道业。',
    actUpgrade: '淬炼…', actUpAdd: '再开一处道业…',
    upTitle: '淬炼', upConfirm: '行此淬炼', upNeedValue: '请先录下淬炼之后的本相：淬到哪一重是你定的，天机不替你猜。',
    upNeedCost: '这一处还没定下淬炼的代价 —— 先在类目里给它写上 cost（不付代价的淬炼便是白得），再来淬炼。',
    upNeedField: '这一条的名录里没有这一处（名录许是换过了）—— 先在类目里添上它，再来淬炼。',
    upCost: '淬炼需 ', upMat: '另耗 ', upEffect: '淬炼之后：',
    actTransfer: '易主…', transferTitle: '易与谁',
    transferTo: '易与', transferReason: '因果', transferSubmit: '定下易主',
    ownerLost: '主已渺',
    transferNeedTarget: '请先择一位新主：这一项要易与谁。',
    transferNeedReason: '请先写下因果：这一项因何易与他。',
    transferSelf: '这一项本就在他名下，不必再易一回。',
    marketScope: '天道大势', note: '坊市见闻', history: '旧账',
    projTitle: '传道之设', projMaster: '入传道', projMasterNote: '一闭，传道之文一字不出；身家簿一页不损。',
    projRoleLabel: '入传道', projRoleNote: '闭了的人不入传道、也不上总录；他的簿子照旧在手。',
    projFieldsLabel: '传道所见', projFieldsNote: '同类之物一体生效；闭了的格子，簿上与查看之处一同隐去 —— 传道本来就只传大概，不带这些格子。',
    projFieldsEmpty: '眼下没有可闭的格子 —— 先录一笔，这里才有所选。',
    projOff: '传道整块眼下是闭着的。', projNotReady: '传道之处还没到能动的时候，这一趟先按下，后面几趟自会接上。',
    extractTitle: '自正文溯出',
    extractParse: '将此层参详一番',
    extractConfirm: '纳取',
    extractBadReply: '这一趟没有按格式回话（簿子一页未动）—— 可以再点一回「将此层参详一番」。',
    extractNote: '读罢先陈于此处逐项定夺：点「入账」方落账；点「待核」只入池子（不上总身家、不入传道）；点「除去」即将此项内容清去。落点只此一处，别处不再另陈一份清单。',
    extractEmpty: '这一段里没有溯得已经发生的身家事实。',
    extractPoolTitle: '待核之录',
    extractBatchTitle: '新近一录',
    voidTitle: '整录追回',
    voidReason: '追回因果',
    voidNeedReason: '请先写下因果：这一录因何追回。',
    voidDone: '已溯回',
    voidNotFound: '这一录在簿上指认不出了（多半是落位已经对不上）—— 回正文那一层重读一遍，再溯回一次。',
    voidAmbiguous: '这一录里混着同一天别的流水，整录追回不得 —— 请先处置那一笔。',
    // ---- F6 新建一条资产 —— 理由见现代档那一族 ----
    caTitle: '另立一录',
    caFor: '归主', caCat: '名录', caName: '名号',
    caSubmit: '立下',
    caNeedOwner: '请先择一位归谁：这一录记在谁的簿上。',
    caNeedCat: '请先择一本名录：这一录算哪一门。',
    caNeedName: '请先写下名号：这一录在簿上叫什么。',
    extractNeedActor: '这一笔还不知道记在谁的簿上 —— 先在左栏点一位。',
    extractTotal: '合算',
    extractWorthWord: '新得之值',
    extractUnvaluedUnit: '件',
    worthUnit: '灵石', scaleWan: '万', scaleYi: '亿',
    scaleThousand: '千', scaleTenWan: '十', scaleHundredWan: '百', scaleThousandWan: '千',
    scaleTenYi: '十', scaleHundredYi: '百', scaleThousandYi: '千', scaleTenThousandYi: '万亿',   // 量级词，同现代档
  },
};

// ---- D1（投影）补的三格：负债有无 + 量级词 ----
// 「负债：有 / 无」是公开层的**半句**（§4.3 的"负债有无"，例：「手头不算紧」）。
// 判据是 `sumNetWorth` 的归属侧（core 那一份口径），不是拿类目 id 硬认「debt」。
// 三档同词是有理由的（与 `scaleWan` / `scaleYi` 同一族：中文三档里"有/无"就是这两个字）。
for (const era of ERAS) {
  ERA_UI[era].debtYes = '有';
  ERA_UI[era].debtNo = '无';
}

// ---- 取词口：认不出的档位回落 modern（与 `uiTerms` / `eraTerms` 同一口径）----
function normalizeEra(era) {
  const id = String(era == null ? '' : era);
  return ERAS.indexOf(id) >= 0 ? id : 'modern';
}
function uiTerms(era) { return ERA_UI[normalizeEra(era)]; }
function categoryWords(era) { return CATEGORY_WORDS[normalizeEra(era)]; }

// 合并成一份完整词表（分类名 + 文案），同一个 key 集合三档一致 —— 供测试①直接断言
function termsOf(era) { return Object.assign({}, categoryWords(era), uiTerms(era)); }

const api = { ERAS, ERA_UI, CATEGORY_WORDS, normalizeEra, uiTerms, categoryWords, termsOf };
if (typeof module !== 'undefined' && module.exports) module.exports = api;
if (typeof window !== 'undefined') (window.parent || window).__LA_ASSET_TERMS__ = api;

})();

  return module.exports;
})();
