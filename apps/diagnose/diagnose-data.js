/* ========================================================
 * diagnose-data.js — 诊断中心 · 数据内核 [v2.99.0]
 * --------------------------------------------------------
 * 【本 App 治的欠债】用户计划书里 ruby-phone 的 v2.99 落点写的是
 *   「派生库登记表、源键规则和统一诊断」。前两项落成了
 *   `scripts/source-derivation-audit.mjs`（v2.96 台账）与
 *   `config/source-key-rules.js`（v2.99 新增）；这一份是第三项：
 *   把散在多个 App 里的「归因/健康」读数收敛到**一个可看的出口**。
 *   现状是：桥归因只活在 worldpulse 的卡片里、字段三态只在 7 个内核的 reason 里、
 *   返回栈与源键规则**根本没有界面出口** —— 用户看不见，工程师也不容易看见。
 *
 * 【三条纪律（与 config/world-bridge.js 同规格）】
 *   ① 只读：只调各真源的**读出口**（bridgeReport / backGuardReport / auditSourceKeys），
 *      绝不写任何状态；
 *   ② 不抛：每个面单独 try/catch，一个面坏不拖垮其余；
 *   ③ 不猜：拿不到就如实说「拿不到」，并以**归因**区分不同原因。
 *
 * 【刻意不做的事（不是遗漏，是纪律）】
 *   · 不显示构建期门禁（npm run check）的结果：那是「上一次构建的结论」，
 *     不是此刻的运行时事实。把它摆在诊断页上就是**拿旧结论当新事实**。
 *   · 不缓存读数：每次 render 现取（本仓治理过多轮的陈旧读数形态）。
 * ======================================================== */
'use strict';

import {
    bridgeReport,
    worldBridgeAvailability,
    readPushProbe,
    readPushField,
    faceFieldState,
    evidenceFaceOf,
    evidenceFaceLine,
    readProjectionFreshness,
    projectionFreshnessText
} from '../../config/world-bridge.js';
import { backGuardReport } from '../../config/back-guard.js';
/* [v3.58.0 · 计划 O4] 会话世代栅栏的**被挡回信账本**（唯一真源 `config/session-gate.js`）。
 *   计划验收要求「旧响应有可读拒绝原因」—— 那条要求正落在这里：
 *   栅栏在写回口挡下旧会话回信时只 `console.warn`（不抛、不弹窗，见该模块文件头），
 *   若没有这一面，用户与工程师都**看不到**它挡过谁 —— 「安静地知道」需要有人读账本。 */
import { sessionDropLog } from '../../config/session-gate.js';
import { validateSourceKey, auditSourceKeys, sourceKeyRulebook } from '../../config/source-key-rules.js';
/* [v3.0.0] 上游投影契约（L-F5 的消费侧）：把记忆插件 v3.212.0 新外供的投影 envelope
 *   读成手机端可看的面。接在这里的理由：本仓一切「上游读数」的可见出口就是诊断中心，
 *   而投影此前**全库零消费**——出口做出来了，下游没人读，等于白做（本仓六次欠债的同形）。 */
import { readProjection, projectionValue, projectionLine } from '../../config/projection-contract.js';
/* [v3.0.2] R2-C 上游注入读数的消费侧单一真源（Gate R2-A/R2-B 的外供面）。
 *   接在这里的理由与本仓一切「上游读数」的可见出口相同：投影接诊断、探针自述接诊断，
 *   注入面同族 —— 而它此前**全库零消费**（上游 v3.215.0 做出来，下游没人读）。 */
import { readInjection, injectionLine, injectionVerdictText, outcomeText, blockLine, injectionPriorityLine } from '../../config/injection-contract.js';
/* ★ 真浏览器逐开 82 入口实测抓到的真缺陷：本文件对外**只有 default 导出对象**里带着
 *   injectionLine / injectionVerdictText / blockLine，没有具名导出；而 diagnose-view.js 写的是
 *   `import { ... blockLine } from './diagnose-data.js'` ⇒ **模块整体加载失败**（SyntaxError:
 *   does not provide an export named 'blockLine'），连带 diagnose 入口点开后永远是空白（外壳不崩、日志一行错）。
 *   修法：把它们原样转出（不新造第二份实现）—— 与 default 对象共用同一个来源。 */
export { injectionLine, injectionVerdictText, blockLine };

/* [v3.10.0 · G-3] 知情网络的消费侧真源（上游 worldProg.knowledge 的「谁不知道」面）。
 *   接在诊断中心的理由与投影面/注入面/证据面**同一族**：本仓一切「上游读数」的
 *   可见出口就是这里。修前实测：`worldProg.knowledge` 只有 plotline 的列表出口在读，
 *   而「这条事实谁不知道」**全库零消费** —— 于是用户永远看不到「为什么某个角色
 *   表现得像是知道了一件他本不该知道的事」。 */
import { knowledgeLine } from '../../config/knowledge-contract.js';
/* [v3.10.0 · G-3] 面级三态的**唯一入口**走剧情线内核的 `knowledgeBoundary()` —— 那里
 *   已经把 `faceFieldState` 与知识面拼好了；诊断侧不再自己拼一次（否则「同一口径两份实现」
 *   会在某一天分叉，而分叉是无声的）。本文件只消费它的输出。 */
import { knowledgeBoundary } from '../plotline/plotline-data.js';
/* [v3.10.0 · G-4] 跨 App 时间编排：把三处「时间」收成**单一当前剧情时刻读数面**。
 *   修前：世界钟（WorldAxis）、插件剧情日期（lonsha `clock` 面）、手机日历三者各说各的，
 *   没有任何出口回答「现在到底是哪一天」，更不会告诉用户「它们互相矛盾」。
 *   本模块只归一与陈述（两源/三源对比 + 确定性 primary 规则），不选边、不猜。 */
import { storyClock, storyClockLine, storyClockProbe } from '../../config/story-clock.js';
/* [v3.11.0 · F-1 替代轴] 回滚影响的**只算不执行**预览面（消费侧）。
 *   接在诊断中心的理由与投影面 / 注入面 / 证据面 / 知识面 / 剧情时刻面**同一族**：
 *   本仓一切「按楼层作废会连带丢掉什么」的读数，可见出口就是这里。
 *   修前实测：v3.9.0 的 F-1 取证判定 not_now，但同轮留下了一条有读数支持的替代轴
 *   （下游 41 个回滚点已有确定的按楼层作废语义，缺的是**读前即知**）。
 *   本模块只**转发**真源文案，不自己算一遍（自己再算一次就是同一口径两份实现）。 */
import {
    rollbackPreviewFace,
    rollbackPreviewLine,
    rollbackPreviewTable
} from '../../config/rollback-preview.js';
/* [v3.13.0 · 计划 #14] 启动耗时的可观测面（消费侧）。
 *   接在诊断中心的理由与投影面 / 注入面 / 证据面 / 知识面 / 剧情时刻面 / 回滚预览面**同一族**：
 *   本仓一切「读数」的可见出口就是这里。修前实测：启动期只有两句 `console.log` 总数汇总，
 *   78 处动态 import 零时计，**没有任何面向用户的可见面** —— 计划 #14 要的
 *   「追加启动耗时分析工具，识别哪个模块拖慢了启动」里，分析工具这一半根本不存在。
 *   本文件只**转发**真源读数（一行文案的唯一实现在 config/boot-timing.js），
 *   不在视图里重新拼一次（自己再拼一次就是同一口径两份实现）。 */
import { bootTimingLine } from '../../config/boot-timing.js';
/* [v3.20.2] 上游检查点**内容级只读对照**的消费侧（上游 v3.252.0 F7 首阶段的外供面）。
 *   接在诊断中心的理由与投影面 / 注入面 / 证据面 / 知识面 / 剧情时刻面 / 删楼影响预览面**同一族**：
 *   本仓一切「上游读数」的可见出口就是这里。
 *   修前实测：上游 v3.237.0 交付检查点族、v3.252.0 补上 `diffPayloadsDeep` 与引擎侧
 *   `compareBranchCheckpointsDeep` / `checkpointContentDiffLines`，而本仓
 *   `grep -RIn 'compareCheckpoints|diffPayloads|snapshot-checkpoint|LonShaSnapshot' apps config`
 *   **零命中** —— 于是「同键同长度但值不同」（计划二 F7 点名的「余额 100→900、朋友→仇人」）
 *   在手机端**零读数**，用户看到的只有「键一样、字节差不多」。
 *   本文件只**转发**真源读数（五态判定与一句话文案的唯一实现在 checkpoint-content-contract.js），
 *   不在这里重算对照（下游再算一份就是同一口径的第二份实现）。 */
import {
    readLonshaCheckpointFace,
    readCheckpointContentDiff,
    checkpointFaceLine,
    checkpointContentLines
} from '../../config/checkpoint-content-contract.js';
/* [v3.19.0 · 计划一「共同配套」第 2 条] 跨仓功能登记面。
 *   计划原文：「跨仓功能登记拥有者、生产者版本、契约形状、消费者、失效条件和单独安装行为。
 *   缺席、旧版、不产出和空数据分别呈现。」
 *   修前实测：本仓与两个上游之间有十几条面级契约，**没有任何一处登记过它们** ——
 *   归属仓 / 起始版本 / 契约形状 / 本仓消费点 / 失效条件 / 只装一个插件会怎样，
 *   全都要逐个文件读注释（而注释不随对面漂移）。
 *   ★ 取数**复用本文件已有的两份读数**（统一探针的 `probe`/`snapshot` 与桥可观测面 `report`），
 *     不新增任何取数点 —— 本仓治理过多轮的「同一读数的两个来源必然漂移」。
 *     判定组合在 config/crossrepo-registry.js（该模块**零 import**，结构上不可能自持桥名）。 */
import { registryFace, registryLine, CROSSREPO_FEATURES } from '../../config/crossrepo-registry.js';
/* [v3.63.0 · X8 第二切片] 受控恢复交接面（预检 → 执行 → 回读 三段闸门）。
 *   接在诊断中心的理由与「会话世代栅栏」同族：本仓一切「被挡下的回信」的可见出口就是这里。
 *   与 session-gate 面**分列**（两者常被混为一谈，是两个不同的问题）：
 *     会话栅栏说「换会话/清数据之后，旧回信有没有被挡」；
 *     交接栅栏说「**恢复过数据**之后，恢复前飞出的回信有没有被挡」—— 恢复不改会话身份，
 *     故前者对这类回信**完全无感**，必须单列。
 *   ★ 只调真源读出口（本内核不复算判定、不另数一遍条数）。 */
import { precheckLine, handoffLine, handoffGateLine, handoffDropLog } from '../../config/resume-handoff.js';
/* [v3.55.0 · 计划 A2] App 消费面矩阵面（80 件 App × 六条平台级消费面）。
 *   接在诊断中心的理由与投影面 / 注入面 / 知识面 / 跨仓登记面同一族：本仓一切「平台级覆盖读数」的可见出口就是这里。
 *   ★ 本内核只**陈列**矩阵模块的读数，不在这里复算第二份：六个布尔值的真源复算在判据套件里
 *     （声明与事实分开存放，两者不一致时才有判别力）；内核再算一份就变成同源自述、必然恒绿。 */
import { FACE_KEYS, FACE_META, NA, MATRIX, faceCounts } from '../../config/app-consumption-matrix.js';
/* [v3.66.0 · 拓展计划 X2 第一切片] 跨 App「定位引用」协议面的**运行时可见出口**。
 *   为什么要接在这里：本切片新造了七条靶心（旅行费用 / 总结记忆 / 纪念日条目 / 曲库曲目 /
 *   Pixiv 作品 / Pixiv 插画 / 老福特文章），消费侧散在六个 App 里。协议件自己的登记表
 *   与「同一支笔写出的两条 ref 必须自等」这两件事，此前**只有测试在跑** ——
 *   而本仓的纪律是「一切读数的可见出口就是诊断中心」：表坏了（kind 漂、归属写错、
 *   同一 kind 挂两个 App）应当**在手机上看得见**，而不是只在 CI 里红。
 *   与矩阵卡的分工：矩阵答「哪些 App 接上了哪些平台面」（静态接线面），
 *   本面答「投靶心这套协议**自身**现在还自洽吗」（表自检 + 自等自证）。 */
import { OPEN_REF_KINDS, OPEN_REF_REASONS, openRefSelfCheck, buildOpenRef, normalizeOpenRef, sameRef } from '../../config/open-ref.js';
/* [v3.86.0 · 拓展计划 R-X2] 来源链协议面：与 openRefFace 同一族——协议件自身现在还自洽吗。
 *   与靶心协议面的分工（两面常被混为一谈，是两个不同的问题）：
 *     靶心面答「这条结论**能不能落到**那一条上」（单点定位能力）；
 *     本面答「这条结论**是从哪来的、中途经过了谁、上游没了会怎样**」（多点关系与失效传播）。
 *   为什么必须有这一面：全局搜索能找到内容，但用户此前**看不到**一条信息如何从原始记录
 *   流转到通知 / 草稿 / 记忆 / 生成请求 —— 关系只活在代码里，不在界面上。 */
import { provenanceSelfCheck, pgSummaryLine, PG_NODE_KINDS, PG_EDGE_KINDS, PG_STATES, PG_BLOCK_REASONS } from '../../config/provenance-graph.js';
/* [v3.67.0 · 拓展计划 X3] 日程提醒协议面：与 openRefFace 同一族——协议件自身现在还自洽吗。
 *   四源归一结果、账本状态、缺口、投递计划，在此面陈列（不重算，只读缓存）。 */
import { scheduleBridgeSelfCheck, scheduleLedgerSelfCheck, scheduleAdviceLine, SCHEDULE_SOURCES } from '../../config/schedule-bridge.js';
/* [v3.68.0 · 拓展计划 X4] 财务总览协议面：与 scheduleFace 同一族——协议件自身现在还自洽吗。
 *   七源归一结果、结算草稿状态、提交账本状态、缺口，在此面陈列（不重算，只读缓存）。 */
import { financeSourceSelfCheck, financeLedgerSelfCheck, FINANCE_SOURCES, FINANCE_LEDGER_LIMIT } from '../../config/finance-overview.js';
/* [v3.87.0 · 拓展计划 R-X3] 财务提交向导协议面：与 financeFace **分工明确**——
 *   财务总览面答「这台机器上各个来源各有多少钱，各自算准了吗」；
 *   本面答「有哪些『建议』还没变成『已确认』、确认了会不会重复扣款」。 */
import { FC_STATE_KEYS, FC_STATES, fcSummaryLine, financeCommitSelfCheck, FINANCE_COMMIT_LEDGER_KEY } from '../../config/finance-commit.js';
/* [v3.69.0 · 拓展计划 X5] 社媒知情边界协议面：与 scheduleFace / financeFace 同一族——协议件自身现在还自洽吗。
 *   可见性判定结果、知情账本状态、通知过滤、缺口，在此面陈列（不重算，只读缓存与自检）。 */
import { knowledgeSelfCheck, KNOWLEDGE_LEDGER_LIMIT } from '../../config/social-knowledge-bridge.js';
/* [v3.70.0 · 拓展计划 X6] 创作素材到发布草稿协议面：与 knowledgeBridgeFace 同一族。
 *   来源登记表 + 草稿账本状态 + 表自检。 */
import { creationSelfCheck, CREATION_LEDGER_LIMIT } from '../../config/creation-pipeline.js';
import { characterSlotSelfCheck, IMAGE_RECEIPT_LEDGER_LIMIT, normalizeImageReceiptLedger } from '../../config/character-slot-manager.js';
/* [v3.82.0 · B 清单] 写作面八张卡的**唯一消费口**：氛围池（B1）/ 关系七级（B2）/
 *   判定与平行线（B3+B4）/ 状态字段（B5）/ 二级摘要（B6）/ 事实表（B7）/ 人工纠错（B8）。
 *   接在诊断中心的理由与投影面 / 注入面 / 证据面**同一族**：本仓一切「上游读数」
 *   的可见出口就是这里 —— 八份纯函数若没有这一个消费点，就是本仓被点过六次的
 *   「内核建好了、导出挂出来了、产品端零消费」。 */
import { craftFaces, craftLine } from '../../config/craft-cards.js';
import { numOrNull } from '../../config/num-gate.js';
/* [v3.83.0 · 计划 R-O7] 诊断处置面：把「有读数」翻成「能处置」。
 *   五态互不同形（empty / unknown / absent / failed / partial）+ 每个失败五项必答
 *   + 按域登记的稳定错误码 + 一步到处置入口（复用既有 open-ref 口径）。 */
import { DIAG_STATES, DIAG_DOMAINS, CODE_TABLE, buildDisposal, disposalLine, canJump, codeTableSelfCheck } from '../../config/diagnose-action.js';

/** [v3.13.0] 启动耗时面：从宿主读实例读数。
 *  为什么走 `window.VirtualPhone.bootTiming` 而不是自己新建一个实例：
 *  新建的那个只会看见「诊断页打开之后」发生的事 —— 读启动耗时却从页打开时起算，
 *  是一个看起来完美、实际毫无意义的读数（本仓「读数必须来自真源」同族纪律）。
 *  取不到就如实 null：那是「宿主没挂」（旧版插件 / 无宿主），不是「启动很快」。 */
export function bootTimingFace(win) {
    const w = hostWindow(win);
    const host = w && w.VirtualPhone ? w.VirtualPhone : null;
    const inst = host && host.bootTiming ? host.bootTiming : null;
    if (!inst || typeof inst.collect !== 'function') return null;
    try {
        const face = inst.collect();
        return (face && typeof face === 'object') ? face : null;
    } catch (_e) { return null; }
}

/**
 * 上游快照里**已被本仓消费**的字段清单（每个字段对应一个真实 App 面）。
 * 为什么写在这里而不是从代码扫：这是「展示面」，需要中文名与归属 App；
 * 但它不得与真消费点脱节 —— `tests/system-v299.test.mjs` 逐条核对
 * 清单里的 key 确实在对应文件的 `faceFieldState(...)` / `readPushField(...)`
 * 调用里出现，多一个少一个即红灯。
 */
export const CONSUMED_FIELDS = Object.freeze([
    { key: 'protagonist', face: 'profile', app: '个人档案' },
    { key: 'lifeDetails', face: 'profile', app: '个人档案' },
    { key: 'moneyLedger', face: 'wallet', app: '钱包' },
    /* 【实测修】这里原写 `chars`，而真实消费点（apps/chars/chars-data.js:72）
     *   写的是 `faceFieldState(snap, ['characters'])`——上游契约里的字段名就是 `characters`。
     *   后果：诊断中心会把一个**根本不存在的字段**显示成 absent / 无快照，而真正的
     *   `characters` 反而不在清单里 —— 诊断页自己给出一个错读数，正是本仓最贵形态。
     *   同样漏了 plotline 的 `worldProg`（plotline-data.js:81 的两键调用只登了 outline）。
     *   两处已按真源清单修正；并由 tests/system-v299.test.mjs 的 A组**逐键对账**
     *   （扫描各内核的 faceFieldState 调用，与本清单逐键比对），防下一次漂移。 */
    { key: 'characters', face: 'chars', app: '角色图鉴' },
    { key: 'scene', face: 'place', app: '地点图景' },
    { key: 'outline', face: 'plotline', app: '剧情线' },
    { key: 'worldProg', face: 'plotline', app: '剧情线' },
    { key: 'clock', face: 'clock', app: '时钟' },
    { key: 'worldLedgerRead', face: 'ledger', app: '账本' }
]);

/**
 * 源键现场（与 `scripts/source-derivation-audit.mjs` 台账同源）。
 * `sample` 是**已实例化**的形（不是 `<memoId>` 这类占位符），因为校验器要拿真键跑；
 * `mustContain` 是它在真源码里的字面量锚点 —— 测试用它撑住「清单与真仓库不脱节」。
 */
export const SOURCE_KEY_SITES = Object.freeze([
    { file: 'apps/calendar/calendar-data.js', mustContain: "'calendar:'", sample: 'calendar:m1:work', note: '日历备忘 → 生活事件（尾段是领域类型，固定枚举）' },
    { file: 'apps/wangxiang/wangxiang-app.js', mustContain: '`task:${', sample: 'task:t1:0', note: '万象任务奖励物品（尾段是第几份奖励下标）' },
    { file: 'apps/wangxiang/wangxiang-app.js', mustContain: '`order:${', sample: 'order:o1', note: '万象订单送达物品' }
]);

function safe(fn, fallback) {
    try { return fn(); } catch (_e) { return fallback; }
}

function hostWindow(win) {
    if (win) return win;
    return (typeof window !== 'undefined') ? window : null;
}

/**
 * 一次取齐五个面。每个面单独降级，返回值**结构恒定**（缺字段一律给空形，
 * 消费方不必判 undefined —— 与 index.js getRuntimeStats 的降级契约同规格）。
 *
 * @param {object} [win]
 * @returns {{ bridges, bridgeReport, fields, backStack, sourceKeys, rulebook, at }}
 */
export function collectDiagnose(win, storage) {
    /* [v3.5.1 · F-8] 第二个入参是 storage（PhoneStorage 实例）。
     *   为什么放在诊断内核而不是让视图自己取：本文件头三条纪律的第一条就是
     *   「只读真源出口」—— 诊断中心是**本仓一切读数面的唯一可见出口**，
     *   存储健康面（P-4 的裁定读数）同理。 */
    const w = hostWindow(win);
    const at = Date.now();

    const fallbackReport = {
        worldaxis: { mounted: false, reason: 'report-threw' },
        lonsha: { mounted: false, reason: 'report-threw' },
        clock: { verdict: 'unparsable', days: null },
        consistent: false,
        summary: '桥可观测面读取失败（已降级）',
        anyReadable: false
    };
    const report = safe(() => bridgeReport(w), fallbackReport) || fallbackReport;
    const bridges = safe(() => worldBridgeAvailability(w), {}) || {};

    // ── 上游自述面：字段三态（v2.98 的消费面，这里把它变得可见）──
    const probe = safe(() => readPushProbe(w), {}) || {};
    const snapshot = probe.snapshot || null;
    /* [v3.0.1] 探针自述面收口：`readPushProbe` 的 `sourceState` / `lastError` 自 v2.97.0 起
     *   挂账至今**零消费**（第九道门文件头「本门不说的事」里点名的那一条）。这里把它收成
     *   **结构化的一面**，而不是散着塞进桥面或字段面：
     *     · 不新开读数通路 —— 复用同一份 `probe`（该探针已是取快照的唯一真源）；
     *     · 与 `bridgeReport` 的 `sourceState` 不重复：那份是**账本汇总**（含 enabled/read 等
     *       合成字段），这一面是**裸探针自述**（id/mounted/reason/sourceState/lastError），
     *       用途不同：账本面答「这台桥现在什么样」，本面答「这次读快照时它说了什么」。
     *   取不到一律 null（旧版桥无此字段 ⇒ 如实 null，不伪造）——与下游一贯纪律同源。 */
    const probeSelf = {
        id: (typeof probe.id === 'string') ? probe.id : null,
        mounted: probe.mounted === true,
        reason: String(probe.reason || 'not-mounted'),
        sourceState: (typeof probe.sourceState === 'string') ? probe.sourceState : null,
        lastError: probe.lastError ? String(probe.lastError) : null
    };
    const fields = CONSUMED_FIELDS.map((f) => {
        const r = safe(() => readPushField(snapshot, f.key), { present: false, kind: null, reason: 'no-snapshot' });
        const faceState = safe(() => faceFieldState(snapshot, [f.key]), 'legacy-unknown');
        return {
            key: f.key, face: f.face, app: f.app,
            present: r.present === true, kind: r.kind || null, reason: String(r.reason || ''), faceState: String(faceState)
        };
    });

    // ── 返回栈（v2.99 新增能力，本仓此前无任何界面出口）──
    const backStack = safe(() => backGuardReport(w), {
        mounted: false, armed: false, bound: false, closers: 0, tags: [], dropped: 0, lastClose: null, sentinelTop: false
    }) || { mounted: false, armed: false, bound: false, closers: 0, tags: [], dropped: 0, lastClose: null, sentinelTop: false };

    // ── 源键规则（把 v2.93 的教训变成可看的规则 + 现场自检）──
    const rulebook = safe(() => sourceKeyRulebook(), { knownTypes: [], volatileSegments: [], allowedTail: [] })
        || { knownTypes: [], volatileSegments: [], allowedTail: [] };
    const sourceKeys = SOURCE_KEY_SITES.map((s) => {
        const v = safe(() => validateSourceKey(s.sample), { ok: false, reason: 'validator-threw' });
        return { ...s, ok: v.ok === true, reason: String(v.reason || '') };
    });
    const audit = safe(() => auditSourceKeys(SOURCE_KEY_SITES.map((s) => s.sample)), { total: 0, ok: 0, bad: [], reasons: {} })
        || { total: 0, ok: 0, bad: [], reasons: {} };

    // ── [v3.0.0] 投影契约面（L-F5 消费侧）──
    //   刻意**只经 readProjection**：它内部走 readPushProbe 取快照（形态判定唯一真源），
    //   故这里不再自摸桥全局、也不自判推/拉型（第九道门 J1/J4 的纪律）。
    //   投影的「有值 / 空 / 缺席」三态由上游给，本仓只做**分面展示**：given 显值、
    //   withheld 显原因（绝不把缺席渲染成「这里没人」——那是最贵的错读数形态）。
    const projection = safe(() => readProjection(w), null) || null;
    const projItems = [];
    if (projection && projection.reason === 'ready') {
        for (const id of Object.keys(projection.visibility || {})) {
            const r = safe(() => projectionValue(projection, id), { present: false, value: undefined, reason: 'read-threw' });
            projItems.push({
                id,
                visibility: String(projection.visibility[id] || 'given'),
                present: r.present === true,
                kind: (r.present ? kindOf(r.value) : 'withheld'),
                reason: String(r.reason || '')
            });
        }
        for (const x of (projection.withheld || [])) {
            if (!projItems.some((p) => p.id === x.id)) {
                projItems.push({ id: x.id, visibility: 'withheld', present: false, kind: 'withheld', reason: String(x.reason || '') });
            }
        }
    }

    /* ── [v3.0.2] R2-C：上游**注入读数**面（本轮实际注入，此前零消费）──
     *   为什么接在诊断中心：这里是本仓所有「上游读数」的可见出口。
     *   与「召回自检」的分工（两面常被混为一谈，是两个不同的问题）：
     *     召回自检说「召回了什么」（读 recallAudit，织光机面）；
     *     本面说「**最终送进上下文的是什么**」—— 中间隔着预算裁剪与去重。
     *   四类处境必须分开（没这面 / 没跑过 / 候选空 / 全被裁），故只透传归一后的面，
     *   不在这里再拼结论（结论的唯一真源是 config/injection-contract.js）。 */
    const injection = safe(() => readInjection(w), null) || null;
    const injBlocks = (injection && Array.isArray(injection.blocks)) ? injection.blocks : [];

    /* ── [v3.4.2 · F-5] 快照导出时刻（供「沉默降级」判「久未更新」用）──
     *   为什么要在这里取、而不是让 silence-guard 自己摸桥：诊断中心是**本仓一切上游读数的
     *   唯一取数口**（本文件头三条纪律之一「只读真源出口」）。让告警模块自己去读快照，
     *   就会多出第二个取数点 —— 而「同一口径被抄 N 份」正是 v2.97.0 收敛掉的那条路径。
     *   如实取不到即 null（silence-guard 见到 null 就不判，不猜）。 */
    const snapshotAt = (() => {
        try {
            const exp = snapshot && snapshot.exportedAt;
            const n = Number(exp);
            return Number.isFinite(n) ? n : null;
        } catch (_e) { return null; }
    })();

/* ── F-6 上游口径自述（`observationNotes`）──
     *   上游 v3.232.0 把两条一直只写在注释里的观察项做成了**机器可读自述**
     *   （T17 `shiftFloorRefs` 重复调用会再次平移 / T16 未收结局事件时如实 pending）。
     *   本仓把它如实转述在这里：如实声明的价值在于「读者能看到」——
     *   留在上游注释里，下游用户一辈子看不到。**只转述，不改口径**（上游明确不改，
     *   因为 T17 加重去重需要「记住哪些楼层已平移过」，那份记忆会成为第二个真源）。 */
    const obsNotes = (() => {
        try {
            const s = readPushField(snapshot, 'scene');
            const v = s && s.present ? s.value : null;
            const notes = (v && typeof v === 'object' && v.observationNotes && Array.isArray(v.observationNotes.notes))
                ? v.observationNotes.notes : null;
            if (!notes) return null;
            return notes.map((x) => ({
                id: String((x && x.id) || ''),
                subject: String((x && x.subject) || ''),
                kind: String((x && x.kind) || ''),
                statement: String((x && x.statement) || ''),
                callerDuty: String((x && x.caller_duty) || ''),
                severity: String((x && x.severity) || '')
            })).filter((x) => x.id);
        } catch (_e) { return null; }
    })();

    /* ── [v3.6.0 · R1-E] 九账证据面（上游 v3.214.0 的对账面，此前**全库零消费**）──
     *   上游把九本账（伏笔/约定/平行事实/秘密/前文回扣/回声/事实版本/事件完整性/修复闭环）
     *   收成一份可查表并写进快照 `evidence`；下游全仓无 `.evidence` 读取 ——
     *   「建好不消费」，与投影面 / 注入面 / 探针自述面**同一族**（本仓第九次）。
     *   只经真源出口读（`readLonshaEvidence` 内部走统一探针，本文件不自摸桥全局）。 */
    const evidence = safe(() => evidenceFaceOf(snapshot), null)
        || evidenceFaceOf(null);

    /* ── [v3.20.2] 上游检查点「内容级只读对照」面（上游 v3.252.0 F7 首阶段）──
     *   为什么接在诊断中心：与投影面 / 注入面 / 证据面 / 知识面 / 剧情时刻面 / 删楼影响预览面
     *   同一族 —— 本仓一切「上游读数」的可见出口就是这里。
     *   与「删楼影响预览」的分工（两面常被混为一谈，是两个不同的问题）：
     *     删楼影响预览说「这次删楼会让**本仓自己的五个域**各丢几条」（下游数据）；
     *     本面说「上游记忆插件的**两份检查点**之间，内容级差了什么」（上游账本）。
     *   三态纪律：五态（缺席 / 没这面 / 读不出 / 空 / 有）各有各的话，全在真源里分好；
     *   本文件只搬运，不在这里再判一次（再判一次就是同一口径两份实现）。
     *   对照只对**前两份**做（不是把全部两两组合跑一遍）：`count >= 2` 才出对照，
     *   否则 `null` —— 「只有一份，没什么可比」与「比比看，结果一样」是两件事。 */
    const checkpoint = (() => {
        try {
            const face = readLonshaCheckpointFace(w);
            const line = checkpointFaceLine(face);
            let diff = null;
            let diffLines = null;
            if (face && face.state === 'ok' && face.names.length >= 2) {
                const [a, b] = face.names;
                diff = readCheckpointContentDiff(w, a, b, null);
                diffLines = checkpointContentLines(w, a, b, null);
            }
            return {
                state: face.state, reason: face.reason,
                names: face.names, count: face.count,
                hasContentDiff: face.hasContentDiff === true,
                engineVersion: face.engineVersion,
                line, pair: (face && face.names.length >= 2) ? { a: face.names[0], b: face.names[1] } : null,
                diff, diffLines
            };
        } catch (_e) { return null; }
    })();

    /* ── [v3.6.0 · R1-C] 投影的**导出期新鲜度归因**（上游 `meta.projectionFreshness`）──
     *   修前的真实错读数：上游 v3.213.0 的新鲜度守卫把「切聊 / 回滚后的旧缓存」扣下，
     *   `projection` 缺席、`fieldTypes.projection.present` 也为 false ⇒ 下游一律报
     *   `no-projection-face`（文案「需记忆插件 v3.212+」）——把「有面但被扣下了」
     *   （等宿主重跑一轮）**谎报成**「本版没这面」（等上游升级）。两者处置相反。
     *   本面把真因读出来，并让它在总述首行可见（那是用户能做的事）。 */
    const freshness = safe(() => readProjectionFreshness(snapshot), null)
        || { present: false, dropped: false, reason: '', from: null, to: null };

    /* ── [v3.5.1 · F-8] 存档健康面（P-4 的两个裁定读数，此前**零消费**）──
     *   P-4 落了 `schemaFace` / `migrationLedgerFace` 两个裁定出口，但全库只有测试在读：
     *   用户看不到「这份存档属于哪个存储时代」「一共搬过几条旧键、有没有时间戳坏掉的」。
     *   **机制做完却没人看**，与「建好不消费」同形 —— 本项只做**呈现**，不做任何判定与迁移。
     *   三条约束与全页一致：
     *     ① 只读：只用 storage 的两个裁定出口（它们本就不写）；证据是 F8 组的「零写入」判据；
     *     ② 不抛：storage 不可用 / 接口缺失 / 抛错，一律降级成 `ok:false` + 归因；
     *     ③ 不猜：两个**分域**（本会话档 / 全局档）分开报 —— 它们是两本不同的账，
     *        合成一个读数就会出现「聊天档旧、全局档当」这类互相矛盾的结论被抹平。
     */
    const storageFace = (() => {
        const one = (isChatData) => {
            const s = safe(() => storage.schemaFace(isChatData), null);
            const l = safe(() => storage.migrationLedgerFace(isChatData), null);
            if (!s || !l) return { ok: false, reason: 'storage-absent', schema: null, ledger: null };
            return {
                ok: true, reason: 'ok',
                schema: {
                    state: String(s.state || 'unknown'),
                    version: Number(s.version) || 0,
                    current: Number(s.current) || 0,
                    absent: s.absent === true,
                    corrupt: s.corrupt === true
                },
                ledger: {
                    count: Number(l.count) || 0,
                    unparsableAt: Number(l.unparsableAt) || 0,
                    version: Number(l.version) || 0,
                    absent: l.absent === true,
                    corrupt: l.corrupt === true
                }
            };
        };
        if (!storage) return { ok: false, reason: 'no-storage', chat: null, global: null };
        return { ok: true, reason: 'ok', chat: one(true), global: one(false) };
    })();

    /* ── [v3.10.0 · G-3] 知情网络面（上游 v3.219.0 的 `worldProg.knowledge`）──
     *   修前的真实处境：`knowledgeList()` 把账里的认知列出来了（有渲染出口），
     *   但**「谁不知道某件事」全库零消费** —— 手机里的对话/动态只凭「角色名出现了」说话，
     *   不看账里明确记着的 `unaware`。本面把三档边界（known / unaware / silent）
     *   与**能不能回答这个问题**（`silentCapable`）一并摆出来：
     *     · silent —— 这人有认知记录，但这条事实两边都没记 ⇒ **无从分辨**，不是「不知道」；
     *     · silentCapable === false —— 账里一条 unaware 记录都没有，
     *       此时「谁不知道」在数据上无从回答（与「没人不知道」是两件事，处置相反）。
     *   面级三态仍走 `faceFieldState`（同一个快照、同一份真源），本文件不自写形状判据。 */
    const knowledge = (() => {
        try { return knowledgeBoundary(snapshot); }
        catch (_e) { return knowledgeBoundary(null); }
    })();

    /* ── [v3.10.0 · G-4] 当前剧情时刻（跨 App 时间编排的**单一读数面**）──
     *   为什么接在诊断中心：三处时间读数（世界钟 / 插件剧情日期 / 日历当天）
     *   修前**没有任何一处把它们摆在一起**，用户只能看到互相矛盾的日期而无从判断。
     *   本面把「一致性」与「谁是当前」一次说清，并在不一致时**显式报冲突**。
     *   日历取数走真源 `storyClockProbe()`（本内核不 import 任何 App）：宿主没提供该面就如实
     *   报 `source-missing` —— 那是「这一层没给」，不是「读不到」。
     *   [v3.10.2] 探针上收到 `config/story-clock.js`（本版世界脉搏与织光机读同一面）。 */
    const clockSc = (() => {
        /* [v3.10.2] 探针**上收到真源** `storyClockProbe()`：G-4 首版把这段日历取数写在
         *   本内核里，本版世界脉搏与织光机也要读同一面 —— 三处各写一份必然漂移
         *   （本仓 v2.97 的教训：7 份 probeBridge 各自为政，同一读数三个说法）。 */
        try {
            const probe = storyClockProbe(w);
            return storyClock({ win: probe.win, calendarSource: probe.calendarSource });
        } catch (_e) { return storyClock({}); }
    })();

    /* [v3.11.0 · F-1 替代轴] 回滚影响预览面：**本内核调取数口**（不在视图里取）。
     *   与剧情时刻面同一条纪律 —— 本项目里凡「取数」都在内核、视图只渲染；
     *   视图自己去读宿主单例的形态，本仓治理过多次（同一读数两个取数口 = 会长歪的读数）。
     *   ★ 刻意**不**把五个域的原始数据放进返回值：卡片只需要读数（条数 / 四态 / 归因），
     *   把几万条消息塞进诊断包会让整份读数在其它消费方那里变重（且那些数据本就有自己的出口）。 */
    const previewSc = (() => { try { return rollbackPreviewFace(w); } catch (_e) { return null; } })();
    /* [v3.13.0 · 计划 #14] 启动耗时面：**从宿主实例读**（本内核不自建实例 —— 见 bootTimingFace 注释）。 */
    const bootSc = safe(() => bootTimingFace(w), null) || null;
    /* ── [v3.19.0 · 计划一「共同配套」第 2 条] 跨仓功能登记面 ──
     *   ★ 取数**全部复用本函数已经取到的两份读数**，一个新取数点都不开：
     *     · lonsha 侧  ← `probe`（统一探针：mounted / reason / sourceState / lastError）+ `snapshot`
     *     · worldaxis 侧 ← `report.worldaxis`（桥可观测面：mounted / enabled / stat / read）
     *   字段三态一律走 `readPushField()`（本仓唯一真源）—— 本内核不自写形状判据。
     *   `producerVersion` 取 `snapshot.pluginVersion`（上游快照里就有）；取不到即 null，
     *   由登记面如实报「无从分辨」，**绝不拿本仓版本去代替对面版本**。 */
    const repoProbe = (() => {
        try {
            const wa = (report && report.worldaxis) ? report.worldaxis : null;
            const lonshaMounted = !!(probe && probe.mounted === true);
            const producerVersion = (() => {
                try {
                    const v = snapshot && snapshot.pluginVersion;
                    return (typeof v === 'string' && v) ? v : null;
                } catch (_e) { return null; }
            })();
            /* 登记面用到的字段键：从真源推导（不在这里手抄一份键名清单 ——
             *   手抄的键名清单就是下一个「展示面与真源脱节」的种子）。 */
            const keys = new Set();
            for (const f of CROSSREPO_FEATURES) {
                for (const k of (Array.isArray(f.fieldKeys) ? f.fieldKeys : [])) if (k) keys.add(k);
            }
            const fields = {};
            for (const k of keys) {
                fields[k] = safe(() => readPushField(snapshot, k), { present: false, kind: null, reason: 'no-snapshot' });
            }
            return {
                lonsha: {
                    mounted: lonshaMounted,
                    producerVersion,
                    fields
                },
                worldaxis: {
                    mounted: !!(wa && wa.mounted === true),
                    /* 「闸门关着」只认**上游自述的开关位**：`enabled === false` 或明确拒绝读取。
                     *   绝不把「没有快照」也算成闸门 —— 那是两件处置相反的事。 */
                    gated: !!(wa && (wa.enabled === false || wa.reason === 'disabled' || wa.reason === 'refused')),
                    gatedReason: wa ? String(wa.reason || 'gated') : 'bridge-absent',
                    hasSnapshot: !!(wa && wa.hasSnapshot === true),
                    readOk: (wa && wa.read) ? (wa.read.ok === true) : null,
                    readReason: (wa && wa.read) ? String(wa.read.reason || '') : ''
                }
            };
        } catch (_e) { return null; }
    })();
    const repoFace = safe(() => registryFace(repoProbe), null);
    /* ── [v3.63.0 · X8 第二切片] 受控恢复交接面 ──
     *   摆的是什么：当前交接世代号、**被挡下的恢复前回信**（与 session-gate 面分列 ——
     *   恢复不改会话身份，会话栅栏对这类回信完全无感）。
     *   三条纪律与全页一致：
     *     ① 只读：只调真源读出口 `handoffDropLog()`（它返回快照副本），本内核不自摸栅栏内部状态；
     *     ② 不抛：读不到 / 抛错 ⇒ `ok:false` + 归因，不伪造一张空表；
     *     ③ 不猜：**账本在位但一条都没挡过 ⇒ 那是正常读数**（本轮没做过恢复），
     *        绝不能渲染成「栅栏没生效」—— 把「没有异常」谎报成「机制坏了」是本仓最忌的反向错读数。 */
    const handoff = (() => {
        try {
            const log = handoffDropLog();
            if (!log || typeof log !== 'object') return { ok: false, reason: 'gate-absent', epoch: null, count: 0, rows: [] };
            const rows = Array.isArray(log.rows) ? log.rows.map((r) => ({
                domain: String((r && r.domain) || 'unknown'),
                reason: String((r && r.reason) || 'unknown'),
                text: String((r && r.text) || ''),
                at: Number((r && r.at) || 0) || 0
            })) : [];
            return { ok: true, reason: 'ok', epoch: Number(log.epoch) || 0, count: rows.length, rows };
        } catch (_e) { return { ok: false, reason: 'gate-threw', epoch: null, count: 0, rows: [] }; }
    })();
    /* ── [v3.55.0 · 计划 A2] App 消费面矩阵面 ──
     *   修前实测：第 1~3 层共缝入三十余件 App，每件都做到了「四层齐备 + 六处接线 + 判据带负控制」，
     *   但缝完之后「这些 App 有没有被平台级六面覆盖」全仓没有一处能回答 ——
     *   要么逐文件读注释（注释不随对面漂移），要么人肉 review。而本仓最贵的缺陷形态正是这一类：
     *   不报错、不崩溃、只是**默默不生效**（App 打不开全局搜索、发不出通知、换会话后数据落旧会话）。
     *   取不到即 null（模块缺失 / 抛错 ⇒ 如实报降级，不伪造一张全空的表）。 */
    const appFaces = (() => {
        try {
            const total = MATRIX.length;
            const cons = faceCounts(MATRIX);
            const faces = FACE_KEYS.map((k) => ({
                key: k,
                label: String((FACE_META[k] && FACE_META[k].label) || k),
                count: Number(cons[k] || 0)
            }));
            const rows = MATRIX.map((r) => {
                const on = FACE_KEYS.filter((k) => !!(r.faces && r.faces[k] === true));
                return { appId: String(r.appId), name: String(r.name), count: on.length, faces: on };
            });
            const na = Object.keys(NA).map((id) => {
                const row = MATRIX.find((r) => r.appId === id);
                return { appId: String(id), name: row ? String(row.name) : String(id), reason: String(NA[id] || '') };
            });
            const zero = rows.filter((r) => r.count === 0).length;
            return {
                total: total,
                faces: faces,
                rows: rows,
                na: na,
                zeroCount: zero,
                line: '消费面矩阵：' + String(total) + ' 件 App × ' + String(FACE_KEYS.length)
                    + ' 条平台级消费面（逐面命中数见下）；六面全无 ' + String(zero)
                    + ' 件已入「不适用」台账（逐条附理由）。'
            };
        } catch (_e) { return null; }
    })();
    /* ── [v3.66.0 · X2 第一切片] 跨 App 靶心协议面（表自检 + 自等自证）──
     *   摆的是什么：七个 kind 各自挂在哪个 App（逐条 label 可读）、表的自检结论、
     *   以及一条**真跑出来的自等自证** —— 用同一支笔 `buildOpenRef` 造两条 ref，
     *   经 `normalizeOpenRef` 归一后用 `sameRef` 比对必须为真；再造一条改一个字段的，
     *   比对必须为假（这一对「真 + 假」才是证明；只报一边等于没报）。
     *   为什么必须带上「必须为假」那一边：本仓最贵的形态是**恒真判据**
     *   （写完发现它对任何输入都点头），只报「自等为真」时，一个永远返回 true 的
     *   `sameRef` 也会让这面全绿。
     *   三条纪律与全页一致：只读（不投任何 ref、不碰任何 App 实例）、不抛（单面 try/catch）、
     *   不猜（取不到即 null，如实说取不到，不伪造一张空表）。 */
    const openRefFace = (() => {
        try {
            const kinds = Object.keys(OPEN_REF_KINDS || {});
            if (!kinds.length) return { ok: false, reason: 'table-empty', problems: [], kinds: [], apps: [], line: '' };
            const self = openRefSelfCheck();
            const problems = Array.isArray(self && self.problems) ? self.problems.map(String) : [];
            const rows = kinds.map((k) => {
                const rec = OPEN_REF_KINDS[k] || {};
                return { kind: String(k), appId: String(rec.appId || ''), label: String(rec.label || '') };
            });
            const apps = Array.from(new Set(rows.map((r) => r.appId))).sort();
            /* 自等自证（真 + 假两侧都跑）：任一侧不成立即 problems 里记一条，
             *   绝不把「只跑通真的一侧」当成协议自洽的证据。 */
            const probe = rows[0];
            const a = buildOpenRef(probe.kind, 'diag-probe-id', probe.appId);
            const same = buildOpenRef(probe.kind, 'diag-probe-id', probe.appId);
            const other = buildOpenRef(probe.kind, 'diag-probe-other', probe.appId);
            const na = normalizeOpenRef(a);
            if (!na.ok) problems.push('自等自证：同一支笔写出的 ref 归一必须成立（' + String(na.why) + '）');
            if (!sameRef(a, same)) problems.push('自等自证：同一支笔写出的两条 ref 必须判等');
            if (sameRef(a, other)) problems.push('自等自证：id 不同却判等 ⇒ 判等口径坏了（恒真）');
            const reasons = Object.keys(OPEN_REF_REASONS || {}).filter((k) => k !== 'OK').length;
            return {
                ok: problems.length === 0,
                reason: 'ok',
                problems: problems,
                kinds: rows,
                apps: apps,
                reasonStates: reasons,
                line: '跨 App 靶心协议：' + String(rows.length) + ' 个 kind 挂在 ' + String(apps.length)
                    + ' 个 App 上；归因 ' + String(reasons) + ' 态；表自检与自等自证'
                    + (problems.length ? '**有 ' + String(problems.length) + ' 条问题**（见下）' : '全部通过') + '。'
            };
        } catch (_e) { return null; }
    })();
    /* ── [v3.86.0 · 拓展计划 R-X2] 来源链协议面（一条信息从哪来、经过谁、上游没了会怎样）──
     *   摆的是什么：五类节点表 / 四类边表 / 三态表的自检，加上**宿主这一轮的来源图读数**
     *   （节点数、边数、已失效、悬空、被隔离、不可长期定位、派生、未取到的源、转述链）。
     *   与靶心协议面的分工：靶心面答「能不能落到那一条上」，本面答「这条是从哪来的」。
     *   三条纪律与全页一致：
     *     ① 只读：只读自检出口与宿主缓存 `_provenanceCache`／`_provenanceLine`（唯一读数出口），
     *        不自己查图、不自己数第二遍；
     *     ② 不抛：单面 try/catch，读不到即 null；
     *     ③ 不猜：**「宿主这一轮还没取数」与「取到了、确实空」是两件事** ——
     *        图不在位就说「尚未取数」，绝不说「没有来源关系」（本仓最忌的反向错读数）；
     *        被隔离的节点只报**壳与原因**（跨段 / 不可见），内容一个字不带（验收④）。 */
    const provenanceFace = (() => {
        try {
            const self = provenanceSelfCheck();
            const problems = Array.isArray(self && self.problems) ? self.problems.map(String) : [];
            const nodeKinds = Object.keys(PG_NODE_KINDS || {}).map((k) => {
                const rec = PG_NODE_KINDS[k] || {};
                return { kind: String(k), label: String(rec.label || ''), icon: String(rec.icon || ''), durable: rec.durable === true };
            });
            const edgeKinds = Object.keys(PG_EDGE_KINDS || {}).map((k) => ({
                kind: String(k), label: String((PG_EDGE_KINDS[k] || {}).label || '')
            }));
            const states = Object.keys(PG_STATES || {}).map((k) => String(PG_STATES[k]));
            const w = hostWindow();
            const vp = (w && w.VirtualPhone) ? w.VirtualPhone : null;
            const graph = vp ? vp._provenanceCache : null;
            const line = vp ? vp._provenanceLine : null;
            const hasGraph = !!(graph && typeof graph === 'object' && Array.isArray(graph.nodes));
            const rawCounts = (hasGraph && graph.counts && typeof graph.counts === 'object') ? graph.counts : {};
            const counts = {};
            for (const k of ['nodes', 'edges', 'live', 'withdrawn', 'dangling', 'blocked', 'notDurable', 'derived', 'gaps', 'chains', 'retoldChains']) {
                counts[k] = Number(rawCounts[k]) || 0;
            }
            const rawBlocked = (hasGraph && Array.isArray(graph.blocked)) ? graph.blocked : [];
            const blocked = rawBlocked.map((b) => ({
                key: String((b && b.key) || ''), kind: String((b && b.kind) || ''),
                reason: String((b && b.reason) || ''), hasRef: !!(b && b.hasRef === true)
            }));
            /* 按原因归类（跨段 / 跨段边 / 不可见）—— 读的人才知道**被拦下的是哪一类**，
             *   而不是笼统一句「有一些被挡了」。 */
            const blockedByReason = {};
            for (const b of blocked) blockedByReason[b.reason] = (blockedByReason[b.reason] || 0) + 1;
            /* 归因文案从**内核词表**拿（本视图不自己造第二份原因表）：
             *   跨段 / 跨段边 / 不可见 —— 三者处置不同（前两者去切会话或分支，后者去查可见性）。 */
            const BLOCK_TEXT = {};
            BLOCK_TEXT[PG_BLOCK_REASONS.CROSS_SCOPE] = '跨会话/跨分支';
            BLOCK_TEXT[PG_BLOCK_REASONS.CROSS_SCOPE_EDGE] = '跨段的边';
            BLOCK_TEXT[PG_BLOCK_REASONS.NOT_VISIBLE] = '这条对当前角色不可见';
            const rawGaps = (hasGraph && Array.isArray(graph.gaps)) ? graph.gaps : [];
            const gaps = rawGaps.map((g) => ({ source: String((g && g.source) || ''), reason: String((g && g.reason) || '') }));
            const tablesText = '五类节点 ' + String(nodeKinds.length) + ' · 四类边 ' + String(edgeKinds.length)
                + ' · 三态 ' + String(states.length) + ' 态';
            const readText = hasGraph
                ? String(line || pgSummaryLine(graph))
                : '尚未取数（宿主这一轮还没跳跑来源图刷新）';
            const blockedText = blocked.length
                ? ('；被隔离/不可见 ' + String(blocked.length) + ' 条（'
                    + Object.keys(blockedByReason).map((k) => String(BLOCK_TEXT[k] || k) + ' ' + String(blockedByReason[k])).join(' / ') + '）')
                : '';
            const gapText = gaps.length ? ('；未取到的源 ' + gaps.map((g) => g.source).join(' / ')) : '';
            return {
                ok: problems.length === 0,
                reason: 'ok',
                problems: problems,
                nodeKinds: nodeKinds,
                edgeKinds: edgeKinds,
                states: states,
                hasGraph: hasGraph,
                counts: counts,
                blocked: blocked,
                blockedByReason: blockedByReason,
                blockText: BLOCK_TEXT,
                gaps: gaps,
                chainText: hasGraph ? String(graph.chainText || '') : '',
                readLine: hasGraph ? String(line || '') : null,
                text: '来源链协议：' + tablesText + '；' + readText + blockedText + gapText
                    + (problems.length ? '**有 ' + String(problems.length) + ' 条问题**（见下）' : '；表自检与自等自证全部通过') + '。'
            };
        } catch (_e) { return null; }
    })();
    /* ── [v3.58.0 · 计划 O4] 会话世代栅栏面（**被挡下的旧会话回信**）──
     *   摆的是什么：当前世代号、被挡下的回信条数、以及每一条的（域 / 拒绝原因 / 中文文案 / 时刻）。
     *   与「App 消费面矩阵」的分工（两面常被混为一谈，是两个不同的问题）：
     *     矩阵说「哪些 App **接上了**平台面」（接线在场）；
     *     本面说「这些接线**真的挡下过谁**」（行为发生过）。
     *   三条纪律与全页一致：
     *     ① 只读：只调真源读出口 `sessionDropLog()`（它返回快照副本），本内核不自摸栅栏内部状态、
     *        也不自己再数一遍条数（数第二遍就是同一口径两份实现）；
     *     ② 不抛：读不到 / 抛错 ⇒ `ok:false` + 归因，不伪造一张空表；
     *     ③ 不猜：**账本在位但一条都没挡过 ⇒ 那是正常读数**（本轮没有跨会话回信），
     *        绝不能渲染成「栅栏没生效」—— 把「没有异常」谎报成「机制坏了」是本仓最忌的反向错读数。 */
    const sessionGate = (() => {
        try {
            const log = sessionDropLog();
            if (!log || typeof log !== 'object') return { ok: false, reason: 'gate-absent', epoch: null, count: 0, rows: [] };
            const rows = Array.isArray(log.rows) ? log.rows.map((r) => ({
                domain: String((r && r.domain) || 'unknown'),
                reason: String((r && r.reason) || 'unknown'),
                text: String((r && r.text) || ''),
                at: Number((r && r.at) || 0) || 0
            })) : [];
            return { ok: true, reason: 'ok', epoch: Number(log.epoch) || 0, count: rows.length, rows };
        } catch (_e) { return { ok: false, reason: 'gate-threw', epoch: null, count: 0, rows: [] }; }
    })();
    const scheduleFace = (() => {
        try {
            const bridgeSelf = scheduleBridgeSelfCheck();
            const ledgerSelf = scheduleLedgerSelfCheck();
            const problems = []
                .concat(Array.isArray(bridgeSelf && bridgeSelf.problems) ? bridgeSelf.problems.map(String) : [])
                .concat(Array.isArray(ledgerSelf && ledgerSelf.problems) ? ledgerSelf.problems.map(String) : []);
            const sources = Object.keys(SCHEDULE_SOURCES || {}).map((k) => {
                const reg = SCHEDULE_SOURCES[k] || {};
                return { source: String(k), label: String(reg.label || ''), timeBasis: String(reg.timeBasis || ''), deliver: String(reg.deliver || '') };
            });
            /* 从宿主读缓存（index.js 的 checkCalendarScheduleReminders 投递后写入；未跑即 null） */
            const w = hostWindow();
            const advice = (w && w.VirtualPhone) ? w.VirtualPhone._scheduleAdviceCache : null;
            const ledgerCache = (w && w.VirtualPhone) ? w.VirtualPhone._scheduleLedgerCache : null;
            const line = advice ? scheduleAdviceLine(advice) : null;
            const ledgerEntries = (ledgerCache && Array.isArray(ledgerCache.entries)) ? ledgerCache.entries : [];
            const delivered = ledgerEntries.filter((e) => e.state === 'delivered').length;
            const withdrawn = ledgerEntries.filter((e) => e.state === 'withdrawn').length;
            const gaps = (advice && Array.isArray(advice.gaps)) ? advice.gaps.map((g) => ({ source: String(g.source || ''), reason: String(g.reason || '') })) : [];
            return {
                ok: problems.length === 0,
                reason: 'ok',
                problems: problems,
                sources: sources,
                adviceLine: line,
                gaps: gaps,
                ledger: { total: ledgerEntries.length, delivered: delivered, withdrawn: withdrawn },
                text: '日程提醒协议：' + String(sources.length) + ' 个源（'
                    + sources.map((s) => s.label).join(' / ') + '）；'
                    + (line ? line.detail : '尚未取数')
                    + '；账本 ' + String(ledgerEntries.length) + ' 条（投递 ' + String(delivered) + ' · 撤回 ' + String(withdrawn) + '）'
                    + (problems.length ? '**有 ' + String(problems.length) + ' 条问题**' : '；表自检与账本自检全部通过') + '。'
            };
        } catch (_e) { return null; }
    })();
    /* [v3.68.0 · 拓展计划 X4] 财务总览协议面：与 scheduleFace 同范式——
     * 只读自检 + 来源登记表 + 宿主缓存读数 + 缺口。 */
    const financeFace = (() => {
        try {
            const sourceSelf = financeSourceSelfCheck();
            const ledgerSelf = financeLedgerSelfCheck();
            const problems = []
                .concat(Array.isArray(sourceSelf && sourceSelf.problems) ? sourceSelf.problems.map(String) : [])
                .concat(Array.isArray(ledgerSelf && ledgerSelf.problems) ? ledgerSelf.problems.map(String) : []);
            const sources = FINANCE_SOURCES.map((s) => ({
                source: String(s.source), label: String(s.label), currency: String(s.currency),
                certainty: String(s.certainty), openable: s.openable, ownerWrite: s.ownerWrite
            }));
            const w = hostWindow();
            const overview = (w && w.VirtualPhone) ? w.VirtualPhone._financeOverviewCache : null;
            const ledgerCache = (w && w.VirtualPhone) ? w.VirtualPhone._financeLedgerCache : null;
            const ledgerEntries = (ledgerCache && Array.isArray(ledgerCache.entries)) ? ledgerCache.entries : [];
            const committed = ledgerEntries.filter((e) => e.action === 'commit').length;
            const gaps = (overview && Array.isArray(overview.gaps)) ? overview.gaps.map((g) => ({ source: String(g.source || ''), reason: String(g.reason || '') })) : [];
            return {
                ok: problems.length === 0,
                reason: 'ok',
                problems: problems,
                sources: sources,
                readyCount: overview ? overview.readyCount : null,
                notOpenedCount: overview ? overview.notOpenedCount : null,
                gaps: gaps,
                ledger: { total: ledgerEntries.length, committed: committed, limit: FINANCE_LEDGER_LIMIT },
                text: '财务总览：' + String(sources.length) + ' 个来源（'
                    + sources.map((s) => s.label).join(' / ') + '）；'
                    + (overview ? String(overview.readyCount) + ' 就绪 · ' + String(overview.notOpenedCount) + ' 未打开' : '尚未取数')
                    + '；账本 ' + String(ledgerEntries.length) + ' 条（提交 ' + String(committed) + ' / 上限 ' + String(FINANCE_LEDGER_LIMIT) + '）'
                    + (problems.length ? '**有 ' + String(problems.length) + ' 条问题**' : '；表自检与账本自检全部通过') + '。'
            };
        } catch (_e) { return null; }
    })();
    /* [v3.87.0 · 拓展计划 R-X3] 财务提交向导协议面：与 financeFace 同范式——
     *   只读自检 + 四态表 + 宿主缓存读数（草稿/账本/预览）+ 缺口。
     *   ★ 本面与 financeFace 的读数**不是重复**：总览面量余额，本面量「建议 → 确认」这条路通不通。 */
    const financeCommitFace = (() => {
        try {
            const self = financeCommitSelfCheck();
            const problems = Array.isArray(self && self.problems) ? self.problems.map(String) : [];
            const states = FC_STATE_KEYS.map((k) => ({
                key: String(k), label: String(FC_STATES[k].label), text: String(FC_STATES[k].text),
            }));
            const w = hostWindow();
            const cache = (w && w.VirtualPhone && w.VirtualPhone._financeCommitCache) ? w.VirtualPhone._financeCommitCache : null;
            const draft = cache ? cache.draft : null;
            const ledgerRead = cache ? (cache.ledgerRead === true) : false;
            const preview = cache ? cache.preview : null;
            const ledgerEntries = (cache && Array.isArray(cache.ledger)) ? cache.ledger : [];
            const committed = ledgerEntries.filter((e) => e.action === 'commit').length;
            const hasDraft = !!(draft && draft.lines && draft.lines.length);
            const duplicate = !!(preview && preview.duplicate && preview.duplicate.isDuplicate);
            const stateKey = preview ? String(preview.state || '') : '';
            const line = cache ? String(cache.line || '') : fcSummaryLine(null);
            return {
                ok: problems.length === 0,
                reason: 'ok',
                problems: problems,
                states: states,
                draftPresent: hasDraft,
                draftLineCount: (draft && Array.isArray(draft.lines)) ? draft.lines.length : 0,
                draftOwnerWritable: draft ? (draft.ownerWritable === true) : null,
                ledgerRead: ledgerRead,
                ledger: { total: ledgerEntries.length, committed: committed },
                previewState: stateKey,
                previewStateLabel: stateKey ? String(FC_STATES[stateKey].label) : '',
                duplicate: duplicate,
                line: line,
                text: '财务提交：四态（' + states.map((x) => x.label).join(' / ') + '）；'
                    + (cache ? (hasDraft ? '草稿 ' + String((draft.lines || []).length) + ' 行 · 态 ' + String(stateKey || '—') : '这一轮没取到结算草稿') : '尚未取数')
                    + '；' + (ledgerRead ? '账本 ' + String(ledgerEntries.length) + ' 条（提交 ' + String(committed) + '）' : '账本读不到（**不是「没有提交」**）')
                    + (duplicate ? '；已提交过（幂等命中，不重复记账）' : '')
                    + (problems.length ? '**有 ' + String(problems.length) + ' 条问题**' : '；四态互不同值 / 幂等 / 多币种守卫自检全部通过') + '。'
            };
        } catch (_e) { return null; }
    })();
    /* [v3.69.0 · 拓展计划 X5] 社媒知情边界协议面：与 financeFace 同范式——
     * 只读自检 + 知情账本状态 + 宿主缓存读数 + 缺口。 */
    const knowledgeBridgeFace = (() => {
        try {
            const self = knowledgeSelfCheck();
            const problems = Array.isArray(self && self.problems) ? self.problems.map(String) : [];
            const w = hostWindow();
            const ledgerCache = (w && w.VirtualPhone) ? w.VirtualPhone._knowledgeLedgerCache : null;
            const ledgerEntries = (ledgerCache && Array.isArray(ledgerCache.entries)) ? ledgerCache.entries : [];
            const active = ledgerEntries.filter((e) => e.state === 'active').length;
            const stale = ledgerEntries.filter((e) => e.state === 'stale').length;
            return {
                ok: problems.length === 0,
                reason: 'ok',
                problems: problems,
                ledger: { total: ledgerEntries.length, active: active, stale: stale, limit: KNOWLEDGE_LEDGER_LIMIT },
                text: '社媒知情边界：知情账本 ' + String(ledgerEntries.length) + ' 条（活跃 '
                    + String(active) + ' · 陈旧 ' + String(stale) + ' / 上限 ' + String(KNOWLEDGE_LEDGER_LIMIT) + '）'
                    + (problems.length ? '**有 ' + String(problems.length) + ' 条问题**' : '；表自检全部通过') + '。'
            };
        } catch (_e) { return null; }
    })();
    /* [v3.70.0 · 拓展计划 X6] 创作素材到发布草稿协议面：与 knowledgeBridgeFace 同范式。 */
    const creationFace = (() => {
        try {
            const self = creationSelfCheck();
            const problems = Array.isArray(self && self.problems) ? self.problems.map(String) : [];
            const w = hostWindow();
            const ledgerCache = (w && w.VirtualPhone) ? w.VirtualPhone._creationLedgerCache : null;
            const ledgerEntries = (ledgerCache && Array.isArray(ledgerCache.entries)) ? ledgerCache.entries : [];
            const draft = ledgerEntries.filter((e) => e.status === 'draft').length;
            const published = ledgerEntries.filter((e) => e.status === 'published').length;
            return {
                ok: problems.length === 0,
                reason: 'ok',
                problems: problems,
                ledger: { total: ledgerEntries.length, draft: draft, published: published, limit: CREATION_LEDGER_LIMIT },
                text: '创作草稿：来源 8 · 目标 6；账本 ' + String(ledgerEntries.length) + ' 条（草稿 '
                    + String(draft) + ' · 已发布 ' + String(published) + ' / 上限 ' + String(CREATION_LEDGER_LIMIT) + '）'
                    + (problems.length ? '**有 ' + String(problems.length) + ' 条问题**' : '；表自检全部通过') + '。'
            };
        } catch (_e) { return null; }
    })();
    const characterSlotFace = (() => {
        try {
            const self = characterSlotSelfCheck();
            const problems = Array.isArray(self && self.problems) ? self.problems.map(String) : [];
            const w = hostWindow();
            const ledgerCache = (w && w.VirtualPhone) ? w.VirtualPhone._imageReceiptLedgerCache : null;
            const ledgerEntries = (ledgerCache && Array.isArray(ledgerCache.entries)) ? ledgerCache.entries : [];
            const pending = ledgerEntries.filter((e) => e.status === 'pending').length;
            const completed = ledgerEntries.filter((e) => e.status === 'completed').length;
            return {
                ok: problems.length === 0,
                reason: 'ok',
                problems: problems,
                ledger: { total: ledgerEntries.length, pending: pending, completed: completed, limit: IMAGE_RECEIPT_LEDGER_LIMIT },
                text: '多角色生图：槽位上限 6；回执账本 ' + String(ledgerEntries.length) + ' 条（待出 '
                    + String(pending) + ' · 已完成 ' + String(completed) + ' / 上限 ' + String(IMAGE_RECEIPT_LEDGER_LIMIT) + '）'
                    + (problems.length ? '**有 ' + String(problems.length) + ' 条问题**' : '；表自检全部通过') + '。'
            };
        } catch (_e) { return null; }
    })();
    /* [v3.82.0 · B 清单] 写作面：八张卡的结构面读数（每张自带一行活读数）。
     *  取不到一律 null（与其余面同纪律：**不伪造**）。 */
    const craftFace = (() => {
        try {
            const faces = craftFaces();
            const problems = [];
            for (const f of faces) {
                /* 取数一律走全仓唯一口径 `numOrNull`（不得写 `Number.isFinite(Number(x))` ——
                 *  那不是「更宽松」，而是把 null/''/[] 全读成 0，属本仓点名的弱口径形态）。 */
                if (!f || !f.line || numOrNull(f.rows) === null) {
                    problems.push('写作面读数缺失：' + String(f && f.id));
                }
            }
            return {
                ok: problems.length === 0,
                reason: 'ok',
                problems: problems,
                cards: faces.map((f) => ({ id: f.id, label: f.label, rows: f.rows, kinds: f.kinds, line: f.line })),
                text: craftLine(faces) + (problems.length ? '**有 ' + String(problems.length) + ' 条问题**' : '；八张卡全部给出活读数')
            };
        } catch (_e) { return null; }
    })();
    /* [v3.83.0 · 计划 R-O7] 诊断处置面：把各面**已经取到的读数**翻成五态处置。
     *  为什么在这里做而不在视图里：本仓纪律 —— 视图纯渲染，一切结论由内核给出；
     *  且「处置」必须与读数**同一次取数**（分两次取会读到不同的现场）。
     *  这里不做任何新的 IO，只把上面已取到的 face 读数当输入。 */
    const disposalFace = (() => {
        try {
            const self = codeTableSelfCheck(CODE_TABLE);
            const items = [];
            /* ① 续玩交接：预检三态 → 处置（有真实回执才报失败，没跑过一律 unknown）。 */
            (() => {
                const face = handoff && typeof handoff === 'object' ? handoff : null;
                if (!face) {
                    items.push(buildDisposal({
                        domain: 'resume-handoff', symptom: 'precheck-blocked', present: false,
                        action: { appId: 'diagnose' }
                    }));
                    return;
                }
                const pre = face.precheck || face.pre || null;
                const state = String((pre && pre.state) || '');
                if (!state) {
                    items.push(buildDisposal({ domain: 'resume-handoff', symptom: 'epoch-stale', unknown: true, reason: '未跑过预检' }));
                    return;
                }
                if (state === 'unusable' || state === 'blocked') {
                    items.push(buildDisposal({
                        domain: 'resume-handoff', symptom: 'precheck-blocked', failed: true,
                        stage: '预检', scope: '受控恢复交接（回档前的可测性）',
                        retry: true, hostSwitch: false, needConfirm: true,
                        action: { appId: 'diagnose' }, reason: String(pre.why || '')
                    }));
                    return;
                }
                items.push(buildDisposal({ domain: 'resume-handoff', symptom: 'readback-mismatch' }));
            })();
            /* ② 注入面：两种「0 块」不同处置（候选空 ⇒ 查召回；全被裁 ⇒ 调预算）。 */
            (() => {
                const inj = (typeof injection === 'object' && injection) ? injection : null;
                if (!inj || inj.reason !== 'ready') {
                    items.push(buildDisposal({ domain: 'injection', symptom: 'candidates-empty', present: inj ? true : false, unknown: !!inj }));
                    return;
                }
                if (inj.verdict === 'all-dropped') {
                    items.push(buildDisposal({
                        domain: 'injection', symptom: 'all-dropped', failed: true,
                        stage: '预算裁剪', scope: '注入上下文（本轮 0 块进入）',
                        retry: true, hostSwitch: false, needConfirm: false,
                        action: { appId: 'settings' }, reason: '候选 ' + String(inj.total || 0) + ' 块全被裁'
                    }));
                    return;
                }
                if (inj.verdict === 'candidates-empty') {
                    items.push(buildDisposal({
                        domain: 'injection', symptom: 'candidates-empty', failed: true,
                        stage: '召回取数', scope: '注入候选（召回没给出素材）',
                        retry: true, hostSwitch: true, needConfirm: false,
                        action: { appId: 'memory' }
                    }));
                    return;
                }
                items.push(buildDisposal({ domain: 'injection', symptom: 'stray-origin', absent: true, present: true }));
            })();
            /* ③ 世界书写回：本仓一次真失败才报失败，其余如实空。 */
            (() => {
                /* 真回执来源：宿主的 WorldbookManager 实例（v3.83.0 起把每次写入的结论留一份
                 *   在实例的 _lastWriteReceipt 上）。**没有回执就说没跑过**，不编失败。 */
                const host = hostWindow();
                const inst = (host && host.VirtualPhone && host.VirtualPhone.worldbookManager) || null;
                const wb = (inst && inst._lastWriteReceipt) ? inst._lastWriteReceipt : null;
                if (!wb || typeof wb !== 'object') {
                    items.push(buildDisposal({ domain: 'worldbook', symptom: 'write-failed', present: false }));
                    return;
                }
                if (wb.ok === false) {
                    items.push(buildDisposal({
                        domain: 'worldbook', symptom: 'write-failed', failed: true,
                        stage: '写回', scope: '世界书条目（本机记忆写不进去）',
                        retry: true, hostSwitch: true, needConfirm: true,
                        action: { appId: 'settings' }, reason: String(wb.reason || '')
                    }));
                    return;
                }
                items.push(buildDisposal({ domain: 'worldbook', symptom: 'duplicate-content' }));
            })();
            /* ④ 存储与搜索、生命周期：本版只登记码面与「面在不在」（无回执的**不编失败**）。 */
            for (const [domain, symptom, present] of [
                ['storage', 'key-unregistered', !!(storageFace && storageFace.ok !== undefined)],
                ['search', 'source-threw', false],
                ['lifecycle', 'no-exit-wired', true]
            ]) {
                items.push(buildDisposal({ domain: domain, symptom: symptom, present: present }));
            }
            const counts = {};
            for (const s of Object.values(DIAG_STATES)) counts[s] = 0;
            for (const it of items) counts[it.state] += 1;
            const needAction = items.filter((it) => it.state === DIAG_STATES.FAILED);
            const jumpable = needAction.filter((it) => canJump(it).ok);
            return {
                ok: self.ok && items.every((it) => it.ok),
                reason: 'ok',
                problems: (self.ok ? [] : self.problems).concat(items.filter((it) => !it.ok).map((it) => it.why)),
                domains: DIAG_DOMAINS.length,
                codes: self.count,
                counts: counts,
                items: items.map((it) => ({
                    state: it.state, code: it.code, ok: it.ok, why: it.why,
                    appId: it.action.appId, kind: it.action.kind, id: it.action.id,
                    line: disposalLine(it)
                })),
                text: '诊断处置：' + DIAG_DOMAINS.length + ' 域 · ' + self.count + ' 个码面 · 五态 '
                    + Object.values(DIAG_STATES).map((s) => s + ' ' + counts[s]).join(' / ')
                    + '；需要动的 ' + needAction.length + ' 项（可一步跳转 ' + jumpable.length + '）'
                    + (needAction.length === jumpable.length ? '' : '**有 ' + (needAction.length - jumpable.length) + ' 项跳不过去**')
            };
        } catch (_e) { return null; }
    })();
    return { at, snapshotAt, bridges, bridgeReport: report, probeSelf, fields, backStack, sourceKeys, rulebook, audit, projection, projItems, injection, injBlocks, obsNotes, storageFace, evidence, freshness, knowledge, storyClock: clockSc, rollbackPreview: previewSc, checkpoint, bootTiming: bootSc, crossRepo: repoFace, appFaces, openRefFace, provenanceFace, scheduleFace, financeFace, financeCommitFace, knowledgeBridgeFace, creationFace, characterSlotFace, craftFace, disposalFace, handoff, sessionGate };
}

/** [v3.83.0 · 计划 R-O7] 诊断处置面的一行读数（视图不自拼）。
 *  三态：面缺席说「读不到」；有问题逐条点名；就绪则把五态分布与「需要动的项」说出来。 */
export function disposalFaceText(face) {
    const f = (face && typeof face === 'object') ? face : null;
    if (!f) return '诊断处置：读不到（诊断内核未取到这一面）';
    if (f.ok !== true) {
        return '诊断处置：**有 ' + String((f.problems || []).length) + ' 条问题** —— '
            + (f.problems || []).map(String).join(' · ');
    }
    return String(f.text || '诊断处置：无读数');
}

/** [v3.82.0 · B 清单] 写作面的一行读数（**唯一实现**在 `collectDiagnose` 内取的那一面）。
 *  这里只做转发与文案：视图不自己拼。三态互不相同：
 *   · 面缺席 → 说「读不到」并给归因，**不说**「八张卡都在」；
 *   · 面在场但有问题 → 逐条点名（读的人才知道是哪一张）。 */
export function craftFaceText(face) {
    const f = (face && typeof face === 'object') ? face : null;
    if (!f) return '写作面：读不到（诊断内核未取到这一面）';
    if (f.ok !== true) {
        return '写作面：**有 ' + String((f.problems || []).length) + ' 条问题** —— '
            + (f.problems || []).map(String).join(' · ');
    }
    const cards = Array.isArray(f.cards) ? f.cards : [];
    return String(f.text || '写作面：无读数') + ' —— ' + cards.map((c) => c.line).join(' | ');
}
/** [v3.58.0 · 计划 O4] 会话世代栅栏面的一行读数（**唯一实现**在本文件 `collectDiagnose` 内取的那一面）。
 *  这里只做转发与文案：视图不自己拼（拼第二遍就是同一口径两份实现）。
 *  三态文案必须互不相同（本仓老规矩）：
 *    · 读不到账本 → 说「读不到」并给归因，**不说**「没挡过」；
 *    · 读到但零条 → 说「本轮没有被挡下的回信」——这是**好读数**，不是坏消息。 */
export function sessionGateFaceText(face) {
    try {
        const f = (face && typeof face === 'object') ? face : null;
        if (!f || f.ok !== true) {
            return '会话世代栅栏：读不到账本（归因 ' + String((f && f.reason) || 'unknown')
                + '）—— 这不是「没有被挡下的回信」';
        }
        if (!f.count) return '会话世代栅栏：当前世代 ' + String(f.epoch) + '，本轮未被挡下任何回信（正常）。';
        return '会话世代栅栏：当前世代 ' + String(f.epoch) + '，已挡下 ' + String(f.count) + ' 条旧会话回信。';
    } catch (_e) { return '会话世代栅栏：读取异常（已降级）—— 这不是「没有被挡下的回信」'; }
}
/** [v3.67.0 · 拓展计划 X3] 日程提醒协议面的一行读数（唯一实现在本文件 `collectDiagnose` 内取的那一面）。
 *  与 sessionGateFaceText 同范式：只做转发与文案，视图不自己拼。 */
export function scheduleFaceText(face) {
    try {
        const f = (face && typeof face === 'object') ? face : null;
        if (!f) return '日程提醒协议：读取异常（已降级）—— 这不是「没有到期项」';
        return String(f.text || '日程提醒协议：无读数');
    } catch (_e) { return '日程提醒协议：读取异常（已降级）'; }
}
/** [v3.68.0 · 拓展计划 X4] 财务总览协议面的一行读数（唯一实现在本文件 `collectDiagnose` 内取的那一面）。
 *  与 scheduleFaceText 同范式：只做转发与文案，视图不自己拼。 */
export function financeFaceText(face) {
    try {
        const f = (face && typeof face === 'object') ? face : null;
        if (!f) return '财务总览协议：读取异常（已降级）—— 这不是「没钱」';
        return String(f.text || '财务总览协议：无读数');
    } catch (_e) { return '财务总览协议：读取异常（已降级）'; }
}
/** [v3.87.0 · 拓展计划 R-X3] 财务提交向导协议面的一行读数（与 financeFaceText 同范式）。
 *  三态不同形：面缺席 / 尚未取数 / 有读数。 */
export function financeCommitFaceText(face) {
    try {
        const f = (face && typeof face === 'object') ? face : null;
        if (!f) return '财务提交向导：读取异常（已降级）—— 这不是「没有待确认的提交」';
        return String(f.text || '财务提交向导：无读数');
    } catch (_e) { return '财务提交向导：读取异常（已降级）'; }
}
/** [v3.86.0 · 拓展计划 R-X2] 来源链协议面的一行读数（唯一实现在本文件 `collectDiagnose` 内取的那一面）。
 *  与 financeFaceText 同范式：只做转发与文案，视图不自己拼。
 *  三态必须互不同形（这是验收①与③在读数上的落点）：
 *   · 面缺席 → 说「读不到」并给归因，**不说**「没有来源关系」；
 *   · 图未跑 → 说「尚未取数」（这一轮还没跳）—— 它**不是**「查无此物」；
 *   · 有读数 → 报五类/四类/三态表规模 + 分列计数 + 被隔离归类。 */
export function provenanceFaceText(face) {
    try {
        const f = (face && typeof face === 'object') ? face : null;
        if (!f) return '来源链协议：读取异常（已降级）—— 这不是「本机没有来源关系」';
        return String(f.text || '来源链协议：无读数');
    } catch (_e) { return '来源链协议：读取异常（已降级）—— 这不是「本机没有来源关系」'; }
}
/** [v3.69.0 · 拓展计划 X5] 社媒知情边界协议面的一行读数（与 financeFaceText 同范式）。 */
export function knowledgeBridgeFaceText(face) {
    try {
        const f = (face && typeof face === 'object') ? face : null;
        if (!f) return '社媒知情边界：读取异常（已降级）—— 这不是「没有帖子」';
        return String(f.text || '社媒知情边界：无读数');
    } catch (_e) { return '社媒知情边界：读取异常（已降级）'; }
}
/** [v3.70.0 · 拓展计划 X6] 创作草稿协议面的一行读数（与 knowledgeBridgeFaceText 同范式）。 */
export function creationFaceText(face) {
    try {
        const f = (face && typeof face === 'object') ? face : null;
        if (!f) return '创作草稿协议：读取异常（已降级）—— 这不是「没有素材」';
        return String(f.text || '创作草稿协议：无读数');
    } catch (_e) { return '创作草稿协议：读取异常（已降级）'; }
}
/** [v3.71.0 · 拓展计划 X7] 多角色生图协议面的一行读数（与 creationFaceText 同范式）。 */
export function characterSlotFaceText(face) {
    try {
        const f = (face && typeof face === 'object') ? face : null;
        if (!f) return '多角色生图协议：读取异常（已降级）—— 这不是「没有角色槽位」';
        return String(f.text || '多角色生图协议：无读数');
    } catch (_e) { return '多角色生图协议：读取异常（已降级）'; }
}
/** [v3.20.2] 上游检查点面的一行读数（**唯一实现**在真源 `config/checkpoint-content-contract.js`）。
 *  这里只做转发 —— 视图不再自己拼（拼第二遍就是同一口径两份实现）。 */
export function checkpointFaceText(cp) {
    try {
        const c = (cp && typeof cp === 'object') ? cp : null;
        if (!c) return '检查点面：读取异常（已降级）—— 这不是「还没有检查点」';
        return String(c.line || checkpointFaceLine(c));
    } catch (_e) { return '检查点面：读取异常（已降级）'; }
}
/** [v3.19.0] 跨仓登记面的一行总述（**唯一实现**在真源：`config/crossrepo-registry.js` 的 `registryLine`）。
 *  这里只做转发 —— 视图不再自己拼（拼第二遍就是同一口径两份实现）。 */
/** [v3.63.0 · X8 第二切片] 受控恢复交接面的一行读数（**唯一实现**在真源 `config/resume-handoff.js`）。
 *  这里只做转发 —— 视图不再自己拼（拼第二遍就是同一口径两份实现）。
 *  三态文案必须互不相同（本仓老规矩）：
 *    · 读不到账本 → 说「读不到」并给归因，**不说**「没挡过」；
 *    · 读到但零条 → 说「本轮无恢复，未被挡下任何回信」——这是**好读数**，不是坏消息。 */
export function handoffFaceText(face, pre, hand) {
    try {
        const lines = [];
        if (pre) lines.push(precheckLine(pre));
        if (hand) lines.push(handoffLine(hand));
        lines.push(handoffGateLine(face));
        return lines.join('　');
    } catch (_e) { return '受控恢复交接：读取异常（已降级）—— 这不是「没有被挡下的回信」'; }
}
export function crossRepoFaceText(face) {
    try { return registryLine(face); }
    catch (_e) { return '跨仓功能：读取异常（已降级）'; }
}

/** [v3.13.0] 启动耗时一行读数（**唯一实现**在真源：`config/boot-timing.js` 的 `bootTimingLine`）。
 *  这里只做转发：诊断内核持有读数面，视图不再自己拼文案（拼第二遍就是同一口径两份实现）。 */
export function bootTimingFaceText(face) {
    return bootTimingLine(face);
}

/** [v3.13.0] 启动耗时逐段明细（**排序与截断在内核**，视图只渲染）。
 *  排序口径：可测时按耗时降序在前 ⇒ 「谁拖慢了启动」一眼可见；不可测时的段按原顺序排在后面
 *  （它们没有 ms，混进耗时排序里会把「测不出」伪装成「很快」）。 */
export function bootTimingRows(face, limit) {
    const f = (face && typeof face === 'object') ? face : null;
    if (!f || !Array.isArray(f.segments)) return [];
    const cap = (typeof limit === 'number' && limit > 0) ? limit : 24;
    const measured = f.segments.filter((s) => s.state === 'measured')
        .slice().sort((a, b) => b.ms - a.ms);
    const unknown = f.segments.filter((s) => s.state !== 'measured');
    return measured.concat(unknown).slice(0, cap).map((s) => ({
        name: String(s.name || ''),
        ms: (typeof s.ms === 'number') ? s.ms : null,
        state: String(s.state || 'unmeasurable'),
        spec: String(s.spec || ''),
        failed: s.failed === true,
        kind: String(s.kind || 'span'),
        /* 「这段是不是 mark」在视图要分开渲染（mark 没有耗时语义，不该进耗时表）。 */
        isMark: String(s.kind || 'span') === 'mark'
    }));
}

/** [v3.10.0 · G-4] 当前剧情时刻一行读数（**唯一实现**在真源：`storyClockLine`）。 */
/** [v3.11.0 · F-1 替代轴] 回滚影响预览的一行读数（**唯一实现**在真源 `rollbackPreviewLine`）。
 *  这里只做转发 —— 本内核持有读数面，视图不再自己拼文案。 */
export function rollbackPreviewFaceText(pv) {
    return rollbackPreviewLine(pv);
}
/** [v3.11.0 · F-1 替代轴] 回滚影响预览的逐域明细（**唯一实现**在真源 `rollbackPreviewTable`）。 */
export function rollbackPreviewRows(pv) {
    return rollbackPreviewTable(pv);
}
/** [v3.10.0 · G-4] 当前剧情时刻一行读数（**唯一实现**在真源：`storyClockLine`）。 */
export function storyClockFaceText(sc) {
    return storyClockLine(sc);
}

/** [v3.10.0 · G-3] 知情网络一行读数（**唯一实现**在真源：`knowledgeLine`）。
 *  这里只做转发 —— 诊断内核持有 face，视图不再重取快照（同轮两个取数口即「错读数记录」形态）。 */
export function knowledgeFaceText(face) {
    return knowledgeLine(face);
}

/** 存储时代的中文（未知取值**如实输出原值**，不静默兜底成某个具体结论） */
export function schemaStateText(state) {
    return SCHEMA_STATES[state] || String(state == null ? '' : state) || '未知';
}

const SCHEMA_STATES = Object.freeze({
    current: '当前代',
    legacy: '旧档（本方法只上报，不做迁移）',
    future: '更新版插件写的档（按当前口径读可能误读）',
    unknown: '无从判断（账本缺失或损坏）'
});

/** 存档健康面的一行读数（**不拼结论**：只做单位与分隔，判断归读者） */
export function storageFaceLine(face) {
    const f = face || {};
    if (f.ok !== true) return '存档健康：读不到（' + String(f.reason || 'unknown') + '）';
    const one = (x) => {
        if (!x || x.ok !== true) return '读不到';
        const s = x.schema || {}, l = x.ledger || {};
        return schemaStateText(s.state) + ' · 已搬 ' + (l.count || 0) + ' 条键'
            + (l.unparsableAt ? '（其中 ' + l.unparsableAt + ' 条时间戳坏了）' : '');
    };
    return '本会话档：' + one(f.chat) + ' ／ 全局档：' + one(f.global);
}

/** 值形状（与 readPushField 的 kind 同族；只用于展示，不参与判定） */
function kindOf(v) {
    try {
        if (v === null) return 'null';
        if (Array.isArray(v)) return 'array';
        return typeof v;
    } catch (_e) { return 'unknown'; }
}

const BRIDGE_REASON_TEXT = Object.freeze({
    'not-mounted': '未安装', 'ready': '就绪', 'disabled': '休眠（未开闸）',
    'refused': '拒绝读取（未开闸 / 无授权）', 'no-snapshot': '在但尚无快照',
    'engine-absent': '插件在、记忆引擎未就位', 'engine-empty': '引擎在位但返回空',
    'thrown': '取快照抛错', 'probe-threw': '探针异常'
});

const FIELD_REASON_TEXT = Object.freeze({
    'value': '有值', 'declared-null': '上游明说：这面是空', 'absent': '上游明说：源里没这项',
    'legacy-null': '旧版桥：读不出（不硬猜）', 'legacy-value': '旧版桥：有值', 'no-snapshot': '无快照'
});

/** 中文归因文案（供视图直接显示；未知原因**如实输出原值**，不静默兜底） */
export function fieldReasonText(reason) {
    return FIELD_REASON_TEXT[reason] || String(reason || '未知');
}
/** 桥归因文案（未知原因如实输出原值） */
export function bridgeReasonText(reason) {
    return BRIDGE_REASON_TEXT[reason] || String(reason || '未知');
}

/** [v3.0.0] 投影缺席原因文案（上游 sourceLedger.absent 的 reason；未知原因如实输出原值） */
const PROJ_ABSENT_TEXT = Object.freeze({
    'no-provider': '上游没注册这个投影的取值器（不是「没有数据」，是这项压根没接）',
    'thrown': '上游取值器抛错（读数已降级，原因见上游）',
    'skipped': '本会话关掉了这个投影（配置面，不是故障）',
    'absent': '上游标为缺席（未给原因）'
});

export function projAbsentText(reason) {
    return PROJ_ABSENT_TEXT[reason] || String(reason || '未知');
}

/** [v3.0.1] 桥**自述态**文案（上游 v3.174 的 `sourceState`；未知原因如实输出原值）。
 *  键必须是带连字符的**字面量**（真源值形），不得写作裸标识符形 —— 那是 J7 拦下的
 *  「查不到就静默走兜底、多种处境显示成同一句话」的种子（v2.98 的 clock-view 实例）。 */
const SOURCE_STATE_TEXT = Object.freeze({
    'idle': '未开始（尚未取过快照）',
    'ready': '就绪（上游说这轮读数可用）',
    'engine-absent': '记忆引擎未就位（桥在，引擎不在）',
    'engine-empty': '引擎在位但返回空（不是故障）',
    'thrown': '取值抛错（原因见 lastError）'
});

export function sourceStateText(state) {
    return SOURCE_STATE_TEXT[state] || String(state || '未知');
}


/**
 * 一句话总述（供视图头部与宿主诊断）。
 * **有坏消息先说坏消息**（本仓 v2.36 桥卡片学到的教训：首行报好消息会误导）。
 */
export function summarizeDiagnose(pkg) {
    const p = pkg || {};
    const bad = [];
    const rep = p.bridgeReport || {};
    if (rep.consistent !== true) bad.push('桥自述与实际读取不一致');
    // [v3.0.0] 投影面的坏消息（有坏消息先说坏消息）：
    //   · 投影在场却结构超前/畸形 ⇒ 本机读不懂，必须说（不是「没数据」）
    //   · 管线缺席（上游明说没跑）⇒ 与「跑了但空」处置相反，必须分开说
    //   · 有投影被扣下 ⇒ 用户会看到「这项没有」，必须说清是上游没给
    const pj = p.projection || null;
    if (pj) {
        if (pj.reason === 'contract-ahead') bad.push('上游投影结构版高于本机（请升级手机端）');
        else if (pj.reason === 'contract-malformed') bad.push('上游投影结构不完整：缺 ' + ((pj.contract && pj.contract.missing) || []).join('、'));
        else if (pj.reason === 'pipeline-absent') bad.push('上游投影管线缺席（没跑，不是空的）');
        else if (pj.reason === 'ready' && Array.isArray(pj.withheld) && pj.withheld.length) {
            bad.push('上游扣下 ' + pj.withheld.length + ' 项投影（' + pj.withheld.map((x) => x.id).join('、') + '）');
        }
    }
    /* [v3.0.1] 探针自述面的坏消息也要先说：上游 v3.174 起把「记忆引擎没就位 / 返回空 / 取值抛错」
     *   写进了桥自己的 `sourceState`，并让 `lastError` 不吞。这两件事此前**零消费** ⇒ 用户只能
     *   看到一个笼统的「不可读」。既然自述就在手上，坏消息必须进首行（与投影面同规格）。 */
    const ps = p.probeSelf || null;
    if (ps) {
        if (ps.lastError) bad.push('上游桥自报错误：' + ps.lastError);
        else if (ps.sourceState === 'thrown') bad.push('上游桥自述：取快照抛错');
        else if (ps.sourceState === 'engine-absent') bad.push('上游桥自述：记忆引擎未就位');
        else if (ps.sourceState === 'engine-empty') bad.push('上游桥自述：引擎在位但返回空');
    }
    /* [v3.0.2] R2-C 注入面的坏消息也要先说，且**两种「0 块」措辞必须不同**：
     *   · 候选空  ⇒ 召回没给出素材（查召回键 / 上游编辑 / 键漂移）
     *   · 全被裁  ⇒ 素材有、预算关门（调注入预算）
     *   两者处置方向相反，压成同一句话就是错读数 —— 这正是本 Gate 要治的形态。
     *   另：「没这面」「没跑过」**不构成坏消息**（那是等升级 / 等跑一轮），不入首行。 */
    const inj = p.injection || null;
    if (inj && inj.reason === 'ready') {
        if (inj.verdict === 'all-dropped') bad.push('最近一轮注入：候选 ' + inj.total + ' 块全部被注入预算裁掉（0 块进入上下文）');
        else if (inj.verdict === 'candidates-empty') bad.push('最近一轮注入：读到 0 块候选（召回没给出可用素材，0 块进入上下文）');
        if (inj.strayOrigin) bad.push('注入读数不是真生成写的（origin=' + String(inj.origin) + '）');
        /* [v3.0.3] R2-E：**被中止**是坏消息 —— 用户看到「最近一次实际注入」会以为回复在路上，
         *   其实那一轮被 Esc 中止了（该重发）。而「已完成」不是坏消息（回复已经在那儿了），
         *   刻意不进首行 —— 那会把「需要用户做的事」稀释掉（本仓「坏消息先说」纪律的反面）。
         *   「结局未定」同样不入：它是等宿主发事件，不是用户该做的事。 */
        if (inj.outcome === 'aborted') bad.push('最近一轮生成被中止：注入已发生但回复未产出（可重发）');
    }
    /* [v3.6.0 · R1-C] 投影**被新鲜度守卫扣下**必须进首行：这是用户**能处理**的处境
     *   （重发一轮 / 切回原会话），而「本版没这面」只能等升级 —— 两者此前同形。
     *   注：「管线缺席 / 投影空 / 没这面」都不是坏消息（等上游或等跑一轮），不入首行。 */
    if (p.freshness && p.freshness.dropped === true) {
        const ftxt = projectionFreshnessText(p.freshness);
        bad.push(ftxt || '投影被新鲜度守卫扣下（原因未给）');
    }
    /* [v3.6.0 · R1-E] 九账证据面的坏消息：**九本账一本也读不到**必须说
     *   （模块没挂 = 上游/宿主的事）；而「账在位但没条目」是**真读数**，不是坏消息 ——
     *   把后者塞进首行会把「需要用户做的事」稀释掉（本仓「坏消息先说」纪律的反面）。 */
    const ev = p.evidence || null;
    if (ev && ev.state === 'unusable') {
        bad.push('九账证据面：一本账也读不到（归因 ' + String(ev.reason || 'unknown') + '）');
    }
    if (Number(p.backStack && p.backStack.dropped) > 0) bad.push('返回栈压入被拒 ' + p.backStack.dropped + ' 次');
    /* [v3.13.0 · 计划 #14] 启动耗时的坏消息：**有段加载失败**进首行（那是用户能处理的：
     *   某个 App 的资源没加载到 ⇒ 打开它会白屏）；「不可测时」不进首行（那是环境事实，
     *   用户做不了什么）—— 但它在卡片里必须显式可见（本仓「坏消息先说，但不制造噪声」）。 */
    const bt = p.bootTiming || null;
    if (bt && Array.isArray(bt.segments)) {
        const failed = bt.segments.filter((s) => s.failed === true);
        if (failed.length) bad.push('启动期有 ' + failed.length + ' 个模块加载失败（' + failed.map((s) => s.name).slice(0, 3).join('、') + '）');
    }
    if (p.audit && Array.isArray(p.audit.bad) && p.audit.bad.length) bad.push('源键规则违规 ' + p.audit.bad.length + ' 处');
    if (bad.length) return '需注意：' + bad.join(' · ');
    const ok = [];
    if (rep.anyReadable) ok.push('至少一台上游桥可读');
    ok.push('源键规则零违规');
    return '正常：' + ok.join(' · ');
}

/** [v3.6.0 · R1-E] 九账证据面的一行读数（**唯一实现**在真源：`evidenceFaceLine`）。
 *  这里只做转发 —— 诊断内核持有 face，不再重取快照（同轮两个取数点即错记录形态）。 */
export function evidenceFaceText(face) {
    return evidenceFaceLine(face);
}

export default {
    CONSUMED_FIELDS,
    schemaStateText,
    storageFaceLine,
    evidenceFaceText,
    SOURCE_KEY_SITES,
    collectDiagnose,
    fieldReasonText,
    bridgeReasonText,
    projAbsentText,
    sourceStateText,
    injectionLine,
    injectionPriorityLine,
    injectionVerdictText,
    blockLine,
    rollbackPreviewFaceText,
    rollbackPreviewRows,
    bootTimingFace,
    bootTimingFaceText,
    bootTimingRows,
    checkpointFaceText,
    sessionGateFaceText,
    handoffFaceText,
    summarizeDiagnose,
    scheduleFaceText,
    financeFaceText,
    financeCommitFaceText,
    provenanceFaceText,
    knowledgeBridgeFaceText,
    creationFaceText,
    characterSlotFaceText
};
