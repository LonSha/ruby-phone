#!/usr/bin/env node
/* ============================================================
 * RubyPhone 桥消费面契约门禁（bridge contract gate）— [v2.97.0] 第九道门
 * ------------------------------------------------------------
 * 为什么存在（本仓反复出现的病，这一次长在「上游桥读取」上）：
 *   上游两个只读世界桥（lonsha_memory_bridge_v1 / worldaxis_bridge_v1）是**同规格接口**，
 *   于是每个消费它的 App 都自己写一遍读取，实测得到三处重复：
 *     ① 桥名字面量 **8 处**（5 个 App 各 1 + world-bridge + 搜索 + 撩语），
 *        每一处的注释都写着「改一处即两边失联」—— 也就是说**没有任何机制**防它；
 *     ② `probeBridge()` **7 份**同构实现（place/wallet/profile/plotline/chars/clock/ledger）；
 *     ③ 归因阶梯 5 份同构。
 *   重复实现的代价在本版当场兑现为**一个真缺陷**：clock / ledger 的两份是照着早期
 *   规格抄的，写了 `bridge.snapshot ? bridge.snapshot() : null` —— 把**推送型**桥的
 *   `snapshot`（对象）当函数调用，必然抛 TypeError 并被 catch 吞掉，
 *   于是 snap 恒为 null、两个 App 永久显示「桥在但没快照」，哪怕桥里躺着完整快照。
 *   这与本仓最贵的缺陷形态（不报错、不崩溃、只错结果）完全同形。
 *
 * 判据（[v2.97.0] J1~J5 四条契约 + 一条自证；[v2.98.0] 追加 J6/J7）：
 *   J1（单一真源）两个桥的**全局挂载名字面量**只允许出现在 config/world-bridge.js（各 1 次）。
 *      其余产品文件（apps/**、config/**）一律 0 次 —— 要桥名就 import 真源常量。
 *   J2（形态纪律）产品代码里不得出现 `.snapshot(` 调用式读取，真源里的**拉取型**分支除外。
 *      这一条直接钉住本版修掉的那个缺陷形态：推送型桥的 snapshot 是对象，调用它必然抛。
 *      （WorldAxis 的 snapshot 是函数，所以真源里 `typeof b.snapshot === 'function'`
 *        之后那一处调用是合法且必要的，白名单只放行真源文件。）
 *   J3（出口在场 + 真被消费）真源必须导出 readPushProbe，且产品侧调用点不得少于
 *      PUSH_READER_MIN_CONSUMERS。防的是本仓另一族形态「建好不消费」——
 *      把读取面抽出来却没人用，等于抽了个摆设。
 *   J4（自写形态判据绝迹）不得再出现「x.snapshot && typeof x.snapshot === 'object'」
 *      这种自己判形态的写法（真源除外）。它正是 8 处重复的种子。
 *   J5（扫描面下限）扫到的产品文件少于下限即 exit 2 拒判：探测器失效时不许「零命中=全绿」。
 *      RP_BRIDGE_FIXTURE=1 只放宽本条（负控制副本树用），不放宽 J1~J4。
 *   J6（[v2.98.0] 字段三态出口在场 + 真被消费）真源必须导出 readPushField / faceFieldState，
 *      且产品侧调用点不得少于 FACE_READER_MIN_CONSUMERS。上游 v3.174 专门把
 *      「源里没这项」与「有这项、值是空」写进了 snapshot.meta.fieldTypes，
 *      下游若零消费，那份三态等于白做——而实测修前正是零消费。
 *   J7（[v2.98.0] 归因文案表不得手写键）*_META / *_TEXT 这类「状态→文案」表的键
 *      必须取真源常量的值，不得手写一套标识符形。这一条不是洁癖，是刚兑现的真缺陷：
 *      clock-view / ledger-view 的 FACE_META 键写作 no_clock_face（下划线形），
 *      而 CLOCK_REASONS 的值是 no-clock-face（连字符形）⇒ 五态里三态查不到，
 *      兜底又指向 bridge_absent ⇒「快照不可用」「这版没这面」「桥未连接」
 *      一律显示成「桥未连接」。**而当时的判据全绿**——因为没有任何判据看键形。
 *
 * 判据边界（本门**不**说的事）：
 *   · 不说「归因阶梯对不对」（那是各 App 套件的活：system-v246/v249/v251/v235~v237）；
 *   · 不说「下游有没有消费上游 sourceState / lastError 归因面」（属功能面，见 TODO）；
 *   · [v3.0.2] 起 J10 说「下游有没有消费上游**注入读数**面」——
 *     上游 v3.215.0/v3.216.0（Gate R2-A/R2-B）把「AI 这一轮实际看到了什么」外供成
 *     快照 `injection`（9 键 + 逐块 6 键，落地不早于代际确认），而下游实测**全库零消费**。
 *     这是本仓第七次「建好不消费」，故立为常驻判据。
 *     [v2.98.0] 起只保证 **meta.fieldTypes** 这面被消费（J6），另两面同族同待。
 *   · [v3.5.0] 起 J11 说「下游有没有消费上游**事件来源构成**面」——上游 lonsha v3.233.0
 *     （F-2 跨平台事件）把「这条事件是谁记的」折成受控分级四态并外供 `snapshot.eventPlatforms`，
 *     而下游实测**全库零消费**。这是本仓第八次「建好不消费」，故立为常驻判据。
 *   · [v3.6.0] 起 J12 说两个**同族**的面：
 *     ① 「下游有没有消费上游**九账证据面**」——上游 lonsha v3.214.0（R1-E）把九本账
 *        （伏笔/约定/平行事实/秘密/前文回扣/回声/事实版本/事件完整性/修复闭环）收成
 *        一份可查表并外供 `snapshot.evidence`，而下游实测**全库零 `.evidence` 读取**。
 *        这是本仓第九次「建好不消费」。
 *     ② 「下游有没有消费上游**投影新鲜度归因**」——上游 lonsha v3.213.0（R1-C）把
 *        切聊/回滚时被守卫扣下的旧投影的**原因**外供成 `snapshot.meta.projectionFreshness`，
 *        而下游零消费 ⇒ 「有面但被扣下」（重发一轮即可）与「本版没这面」（等升级）
 *        在诊断页显示成同一句话 —— 这是**实际发生的错读数**，不只是「建好不消费」。
 *     两者共用一个下限（都是同一次下游接线的产物），但**分别判出口在场**：
 *     出口被人删掉与出口没人读是两种故障，压成一条会互相顶替。
 *   · 不扫 tests/** 与 scripts/**（测试与门禁引用桥名是必须的），只扫产品面。
 *
 * 用法：
 *   node scripts/bridge-contract-audit.mjs              # 校验（CI/发布门）
 *   node scripts/bridge-contract-audit.mjs --list       # 列出每个扫描文件的命中明细
 *   node scripts/bridge-contract-audit.mjs --root <dir> # 校验指定目录（负控制测试用）
 * 退出码：0=通过  1=契约漂移  2=门禁账目错（拒判）
 * ============================================================ */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const LIST = args.includes('--list');
const ROOT = (() => {
    const i = args.indexOf('--root');
    if (i >= 0 && args[i + 1]) return path.resolve(args[i + 1]);
    return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
})();
const FIXTURE = process.env.RP_BRIDGE_FIXTURE === '1';
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

/* ------------------------------------------------------------
 * 真源与阈值
 * ------------------------------------------------------------ */
const SOURCE_REL = 'config/world-bridge.js';
const BRIDGE_LITERALS = Object.freeze(['lonsha_memory_bridge_v1', 'worldaxis_bridge_v1']);
const PUSH_READER = 'readPushProbe';
/** 产品侧 readPushProbe( 调用点下限（v2.97.0 实测 9）。
 *  写 7 而不是 9：留出「某个 App 被重构掉」的合理空间，但拦住「抽出来只有两三处用」的摆设形态。 */
const PUSH_READER_MIN_CONSUMERS = 7;
/** 扫描面下限（fail-closed）：产品 .js 文件数低于此即视为扫描器失效。 */
const MIN_PRODUCT_FILES = 100;
/** [v2.98.0] J6：字段三态出口名与产品侧消费点下限（实测 7：五内核 + clock + ledger）。
 *  写 5 而不是 7：留出重构空间，但拦住「出口抽出来只有一两处用」的摆设形态。 */
const FIELD_READER = 'readPushField';
const FACE_STATE_READER = 'faceFieldState';
const FACE_READER_MIN_CONSUMERS = 5;
/** [v2.98.0] J7：归因文案表的命名面（表名后缀）。 */
const META_TABLE_RE = /const\s+([A-Z][A-Z0-9_]*(?:_META|_TEXT|_TABLE|_LABEL|_MAP))\s*=\s*(?:Object\.freeze\()?\s*\{/g;
/** 表内裸标识符形键（下划线形）：*_META 这类表若手写键，几乎一定是这种形状。 */
const BARE_SNAKE_KEY_RE = /^\s+([a-z][A-Za-z0-9]*_[A-Za-z0-9_]+)\s*:/gm;

/* ── [v3.0.1] J8：投影契约的**消费出口**必须真被业务面用起来 ──
 * 【为什么必须有（本仓最贵形态在这里的翻版）】
 *   v3.0.0 把跨仓投影契约的出口做出来了，但只接进**诊断面**：四个业务 App
 *   （place / chars / plotline / clock）仍各自经 `faceFieldState` 读旧面。
 *   若到此为止，「投影」就是第七次「建好不消费」——有读数、有归因、有出口，**没有用户**。
 *   故本门从 v3.0.1 起判「业务面真消费」：`readProjection` 在产品侧（apps/**）的调用点
 *   不得少于下限。注意它**不**要求业务面把投影当数据源（那是错的：投影只外供 6 项窄面，
 *   业务面要的是整面 —— 见上游 README 与 config/projection-contract.js 的 projectionScopeLine
 *   文件头）；本判据要的是「归属面真的接上了」。 */
const PROJECTION_READER = 'readProjection';
/* ↑ 跨仓面对账标签（第十一道门 upstream-face-audit.mjs 按此判「声明 ↔ 计数」一致）。
 * 形态逐字固定：`[face: <上游面 id>] [reader: <本仓消费出口名>] [floor: <产品侧下限>]`。
 * 为什么要有钉子：声明（上游登记表）与计数（本文件各 J 的下限常量）**分居两个文件**，
 * 中间原本没有任何东西把它们钉住 —— 下限抄错一位、出口改名，两边都不会响。 */
/* [face: projectionEnvelope] [reader: readProjection] [floor: 4] */
/** 产品侧 readProjection( 调用点下限（v3.0.1 实测 5：四个业务 App + 诊断内核）。
 *  写 4 = 实测减一：留一个 App 被重构掉的余量，但拦住「只有诊断面一处」的摆设形态。 */
const PROJECTION_READER_MIN_CONSUMERS = 4;

/* ── [v3.0.1] J9：统一探针的**自述面**（sourceState / lastError）必须真被消费 ──
 * 【为什么必须有】本门文件头自 v2.97.0 起就写着「本门**不**说『下游有没有消费上游
 *   sourceState / lastError 归因面』（属功能面，见 TODO）」——那条挂账从 v2.97 挂到 v3.0.0。
 *   上游 v3.174 专门把「记忆引擎没就位 / 返回空 / 取值抛错」写进桥自己的 sourceState，
 *   并让 lastError 不吞；下游零消费 ⇒ 这三种完全不同的处境在手机端同形（只有一句笼统的
 *   「不可读」），正是本仓反复点名的形态。本判据开判：产品侧必须存在读这两个字段的调用点。 */
const PROBE_SELF_FIELDS = Object.freeze(['sourceState', 'lastError']);
/** J9 的判据是「真读出并落下」：必须有一个**结构化面**把两个字段接住（不是只提一句注释）。 */
const PROBE_SELF_RE = /probe\.(sourceState|lastError)\b/g;
const PROBE_SELF_SITES = Object.freeze([
    { rel: 'apps/diagnose/diagnose-data.js', anchor: 'const probeSelf = {' }
]);
const PROBE_SELF_MIN = 1;

/* ── [v3.0.2] J10：上游**注入读数**（Gate R2-A/R2-B 的外供面）必须真被业务面消费 ──
 * 【为什么必须有】上游 v3.215.0 把「AI 这一轮实际看到了什么」做成读数
 *   （快照 `injection`：origin/round/ts/tokens/chars/html/total/kept/blocks 九键，
 *    逐块 ref/id/label/kept/chars/reason 六键），v3.216.0 又把落地时机收紧到
 *   代际确认之后（轮次号只由提交推进）。而下游实测：`snapshot.injection` **零消费** ——
 *   用户既看不出「AI 到底收到几块」，也看不出「哪几块被预算裁掉了」。
 *   出口做出来没人读，等于没做（本仓六次欠债的同形）。
 * 【本判据不说的事】不说「产品面把读数渲染成什么样」（那是各套件的活），
 *   只保证**消费通道在场**：产品侧必须存在读它的调用点。
 * 【为什么下限是 2】实测两个业务面：诊断内核（读数可见出口）与织光机收集器
 *   （送达侧观测）。写 2 不留余量是刻意的 —— 少一个就意味着「某一面又回到零消费」，
 *   而那正是本判据要拦的形态；若将来某一面被重构掉，应当**显式**来改这里并写明理由。 */
const INJECTION_READER = 'readInjection';
/* [face: injectionReadout] [reader: readInjection] [floor: 2] */
const INJECTION_READER_MIN_CONSUMERS = 2;

/* ── [v3.5.0] J11：上游**事件来源构成**（F-2 跨平台事件的外供面）必须真被业务面消费 ──
 * 【为什么必须有】上游 lonsha v3.233.0 把段来源从 40 字自由文本折成受控分级四态
 *   （extract / platform / other / none）并外供 `snapshot.eventPlatforms`；
 *   分级的全部意义在于**让下游能对照「这条是插件从正文提的、还是手机 App 里发生的」**。
 *   下游若零消费，那份分级就等于白做（本仓「建好不消费」的第八例）。
 * 【判据口径】两条同时判：
 *   ① 真源必须导出 `readLonshaEventPlatforms` / `eventPlatformsLine`；
 *   ② 产品面 apps/** 的调用点不得少于下限（config/ 是出口自身，不计）。
 * 【为什么下限是 1】本版刻意只落一个**独立**消费面（织光机来源侧），
 *   与 J10 的注入面同理：少一个就意味着「那一面又回到零消费」。
 *   若将来再落一面（如世界脉动的事件对照），应当把这里显式抬高并写明理由。 */
const EVENT_PLATFORM_READER = 'readLonshaEventPlatforms';
/* [face: eventPlatforms] [reader: readLonshaEventPlatforms] [floor: 1] */
const EVENT_PLATFORM_LINE_READER = 'eventPlatformsLine';
const EVENT_PLATFORM_MIN_CONSUMERS = 1;

/* ── [v3.6.0] J12：上游**九账证据面**与**投影新鲜度归因**必须真被业务面消费 ──
 * 【为什么必须有 · ①证据面】上游 lonsha v3.214.0（R1-E）把九本账收成一份可查表
 *   （`evidence-workbench.js` 的 LEDGERS 登记表 + 三态 + ref/floor 出处）并外供
 *   快照 `evidence`。上游定位它是「这个承诺是哪一楼说的」的唯一答案面；而下游实测
 *   **全库零 `.evidence` 读取** —— 用户点「证据」看到的是空壳。本仓「建好不消费」第九例。
 * 【为什么必须有 · ②新鲜度归因】上游 lonsha v3.213.0（R1-C）给投影加了导出期新鲜度守卫：
 *   切聊 / 回滚后的旧缓存**不再导出**，原因留在 `snapshot.meta.projectionFreshness`。
 *   下游零消费 ⇒ 该字段缺席时 `fieldTypes.projection.present` 同样为 false，
 *   于是 `readProjection()` 一律报 `no-projection-face`（文案「需记忆插件 v3.212+」）
 *   —— 把「有面但被守卫扣下（**重发一轮就好**）」谎报成「本版没这面（只能等升级）」。
 *   这不是「建好不消费」的浪费问题，是**已经发生的错读数**，故一并立为常驻判据。
 * 【判据口径】三条同时判：
 *   ① 真源必须导出 `readLonshaEvidence` / `evidenceFaceLine`；
 *   ② 真源必须导出 `readProjectionFreshness` / `projectionFreshnessText`；
 *   ③ 产品面 apps/** 的消费点不得少于下限（config/ 是出口自身，不计）。
 * 【为什么下限是这两个数】两个读面的消费面**不同**，故下限分别取实测值，**不共用**：
 *   ① 证据面 = 3：实测三个独立业务面 —— 诊断内核（读数可见出口，走纯函数 `evidenceFaceOf`）、
 *      全局搜索源（九账条目可被跨 App 检索，走纯函数 `evidenceFaceOf`）、
 *      织光机出处侧观测（无现成快照，走取数式 `readLonshaEvidence`）。全仓 3 个消费文件。
 *      写 3 不留余量是刻意的 —— 少一个就意味着「某一面又回到零消费」，而那正是本判据要拦的形态。
 *   ② 新鲜度归因面 = 1：实测只有一个独立业务面（诊断内核；它归一后给视图与其他面用）。
 *      写 1 同样不留余量；将来落第二个面（某个业务 App 自己读归因）时应当**显式**抬高这里并写明理由。
 *   出口在场四个函数**分别判**（缺一即 corrupt）：出口被删与出口没人读是两种故障，压成一条会互相顶替。
 *   文案函数（evidenceFaceLine / projectionFreshnessText）只判**出口在场**、**不计入消费点**：
 *   它们是下游自己的呈现层，计入会把「有人读上游面」灌水成「有人用下游文案」。
 * 【计数单位：去重文件数，不是出现次数】本门其余判据（J3/J6/J8/J10/J11）数的是「调用点个数」，
 *   J12 刻意改成「**去重后的产品文件名数**」：诊断内核一个文件里就有两处证据面调用
 *   （主读数 + null 兜底），按次数计等于把同一个业务面数两遍 ⇒ 织光机面被删掉时
 *   计数只从 4 掉到 3，仍在下限之上，而那正是本判据要拦的「某一面回到零消费」。
 *   按文件计则「删掉一个业务面」必然掉到下限之下，判据才真的守得住。
 *   证据面的两个出口（取数式 / 纯函数式）**合并去重**成「哪些产品文件读过这一面」：
 *   一面对外有几个入口是实现选择，判据只问「这一面有没有真被业务面读」。 */
const EVIDENCE_READER = 'readLonshaEvidence';
/* [face: evidenceWorkbench] [reader: readLonshaEvidence] [floor: 3] */
const EVIDENCE_LINE_READER = 'evidenceFaceLine';
const EVIDENCE_FACE_READER = 'evidenceFaceOf';
const EVIDENCE_MIN_CONSUMERS = 3;
const FRESHNESS_READER = 'readProjectionFreshness';
const FRESHNESS_TEXT_READER = 'projectionFreshnessText';
const FRESHNESS_MIN_CONSUMERS = 1;

/* ── [v3.20.2] J13：上游**检查点内容级只读对照**（F7 首阶段的外供面）必须真被业务面消费 ──
 * 【为什么必须有】上游 lonsha v3.237.0（R4-C）交付检查点族、v3.252.0（F7 首阶段）补上
 *   `diffPayloadsDeep` 与引擎侧 `compareBranchCheckpointsDeep` / `checkpointContentDiffLines`
 *   —— 那是「**同键同长度但值不同**」（「余额 100→900」「朋友→仇人」）的**唯一**读数面，
 *   而键面读数在这类改变上完全看不出来（键一样、字节差不多）。
 *   下游此前对 `compareCheckpoints|diffPayloads|snapshot-checkpoint|LonShaSnapshot` 是
 *   **零消费** —— 本仓「建好不消费」的第十例，与投影面 / 注入面 / 证据面同一族。
 * 【判据口径】两条同时判：
 *   ① 真源 `config/checkpoint-content-contract.js` 必须导出四个出口（缺一即 corrupt）；
 *   ② 产品面 apps/** 的消费点不得少于下限（config/ 是出口自身，不计）。
 * 【为什么下限是 1】本版刻意只落一个**独立**消费面（诊断中心内核，它是本仓一切上游读数的
 *   可见出口）。写 1 不留余量是刻意的 —— 少一个就意味着「那一面又回到零消费」，
 *   而那正是本判据要拦的形态；若将来再落一面（如某个业务 App 自己读对照），
 *   应当把这里**显式**抬高并写明理由。 */
const CHECKPOINT_READER = 'readLonshaCheckpointFace';
/* [face: checkpointCompare] [reader: readLonshaCheckpointFace] [floor: 1] */
const CHECKPOINT_DIFF_READER = 'readCheckpointContentDiff';
const CHECKPOINT_LINES_READER = 'checkpointContentLines';
const CHECKPOINT_LINE_READER = 'checkpointFaceLine';
const CHECKPOINT_MIN_CONSUMERS = 1;
const CHECKPOINT_SOURCE_REL = 'config/checkpoint-content-contract.js';

/* ------------------------------------------------------------
 * 注释剥离：J1/J2/J4 都要在**去注释**的源码上判。
 *   为什么必须去注释：本仓大量注释逐字提到桥名与旧写法
 *   （place-data.js 开头就写着 lonsha_memory_bridge_v1.snapshot.scene），
 *   不去注释就会把「文档」判成「实现」，产生本仓明令禁止的文本包含式假红。
 *   只处理三种字符串（单引号/双引号/反引号）与两种注释；不做正则字面量识别（产品面用不到）。
 *   字符串内容**保留**（J1 数的就是字面量），只是不再把字符串内部的 // 当注释。
 * ------------------------------------------------------------ */
function stripComments(src) {
    let out = '';
    let i = 0;
    const n = src.length;
    let state = 'code';
    while (i < n) {
        const c = src[i];
        const d = i + 1 < n ? src[i + 1] : '';
        if (state === 'code') {
            if (c === '/' && d === '/') { state = 'line'; i += 2; continue; }
            if (c === '/' && d === '*') { state = 'block'; i += 2; continue; }
            if (c === "'" || c === '"' || c === '`') { state = c; out += c; i++; continue; }
            out += c; i++; continue;
        }
        if (state === 'line') {
            if (c === '\n') { state = 'code'; out += c; }
            i++; continue;
        }
        if (state === 'block') {
            if (c === '*' && d === '/') { state = 'code'; i += 2; } else i++;
            continue;
        }
        if (c === '\\') { out += c + d; i += 2; continue; }
        if (c === state) state = 'code';
        out += c; i++; continue;
    }
    return out;
}

function walk(absDir, out = []) {
    if (!fs.existsSync(absDir)) return out;
    for (const name of fs.readdirSync(absDir)) {
        const abs = path.join(absDir, name);
        if (fs.statSync(abs).isDirectory()) walk(abs, out);
        else if (name.endsWith('.js')) out.push(path.relative(ROOT, abs).split(path.sep).join('/'));
    }
    return out;
}

const countOf = (hay, needle) => hay.split(needle).length - 1;

/* ------------------------------------------------------------
 * 扫描
 * ------------------------------------------------------------ */
const productFiles = [...walk(path.join(ROOT, 'apps')), ...walk(path.join(ROOT, 'config'))].sort();
const stripped = new Map();
for (const rel of productFiles) {
    try { stripped.set(rel, stripComments(read(rel))); } catch (_e) { stripped.set(rel, ''); }
}

const literalHits = [];
for (const [rel, code] of stripped) {
    for (const lit of BRIDGE_LITERALS) {
        const c = countOf(code, lit);
        if (c > 0) literalHits.push({ rel, literal: lit, count: c });
    }
}
const callStyleHits = [];
for (const [rel, code] of stripped) {
    const c = (code.match(/\.snapshot\s*\(/g) || []).length;
    if (c > 0) callStyleHits.push({ rel, count: c });
}
const selfProbeHits = [];
for (const [rel, code] of stripped) {
    const c = (code.match(/\bsnapshot\s*&&\s*typeof\s+[\w$.]+\.snapshot\s*===\s*'object'/g) || []).length;
    if (c > 0) selfProbeHits.push({ rel, count: c });
}
/* J7：归因文案表的裸标识符键（只扫产品面；真源自己不受此限） */
const bareKeyHits = [];
for (const [rel, code] of stripped) {
    if (rel === SOURCE_REL) continue;
    META_TABLE_RE.lastIndex = 0;
    let m;
    while ((m = META_TABLE_RE.exec(code)) !== null) {
        const open = code.indexOf('{', m.index);
        let depth = 0, j = open;
        for (; j < code.length; j++) {
            if (code[j] === '{') depth++;
            else if (code[j] === '}') { depth--; if (depth === 0) break; }
        }
        const block = code.slice(open, j + 1);
        BARE_SNAKE_KEY_RE.lastIndex = 0;
        let k;
        const keys = [];
        while ((k = BARE_SNAKE_KEY_RE.exec(block)) !== null) keys.push(k[1]);
        if (keys.length) bareKeyHits.push({ rel, table: m[1], keys });
    }
}
const sourceCode = stripped.get(SOURCE_REL) || '';
const sourceHasExport = new RegExp('export\\s+function\\s+' + PUSH_READER + '\\s*\\(').test(sourceCode);
let consumerCount = 0;
const consumerFiles = [];
for (const [rel, code] of stripped) {
    if (rel === SOURCE_REL) continue;
    const c = countOf(code, PUSH_READER + '(');
    if (c > 0) { consumerCount += c; consumerFiles.push(rel); }
}
const sourceLiteralOk = BRIDGE_LITERALS.every((lit) => countOf(sourceCode, lit) === 1);
/* J6：两个字段三态出口各自「恰 1 次 export function」 */
const sourceFieldExportOk = new RegExp('export\\s+function\\s+' + FIELD_READER + '\\s*\\(').test(sourceCode);
const sourceFaceExportOk = new RegExp('export\\s+function\\s+' + FACE_STATE_READER + '\\s*\\(').test(sourceCode);
let faceConsumerCount = 0;
const faceConsumerFiles = [];
for (const [rel, code] of stripped) {
    if (rel === SOURCE_REL) continue;
    const c = countOf(code, FACE_STATE_READER + '(');
    if (c > 0) { faceConsumerCount += c; faceConsumerFiles.push(rel); }
}
const sourceCallCount = (sourceCode.match(/.snapshot\s*\(/g) || []).length;

/* ── [v3.0.1] J8：产品侧 readProjection( 消费点（只扫 apps/**，config/ 是出口自身） ── */
let projConsumerCount = 0;
const projConsumerFiles = [];
for (const [rel, code] of stripped) {
    if (!rel.startsWith('apps/')) continue;
    const c = countOf(code, PROJECTION_READER + '(');
    if (c > 0) { projConsumerCount += c; projConsumerFiles.push(rel); }
}
/* ── [v3.0.1] J9：探针自述面（sourceState / lastError）产品侧消费点 ── */
let probeSelfReads = 0;
const probeSelfFiles = [];
for (const [rel, code] of stripped) {
    PROBE_SELF_RE.lastIndex = 0;
    const n = (code.match(PROBE_SELF_RE) || []).length;
    if (n > 0) { probeSelfReads += n; probeSelfFiles.push(rel); }
}
/* 只「读到」不够，必须**落下成面**：每个登记点须有结构化锚点（否则只是顺手读一眼就丢） */
const probeSelfSites = PROBE_SELF_SITES.filter((s) => {
    const code = stripped.get(s.rel);
    return !!code && code.includes(s.anchor);
});

/* ── [v3.0.2] J10：产品侧 readInjection( 消费点（只扫 apps/**，config/ 是出口自身） ── */
let injConsumerCount = 0;
const injConsumerFiles = [];
for (const [rel, code] of stripped) {
    if (!rel.startsWith('apps/')) continue;
    const c = countOf(code, INJECTION_READER + '(');
    if (c > 0) { injConsumerCount += c; injConsumerFiles.push(rel); }
}

/* ── [v3.5.0] J11：事件来源构成面的出口在场 + 产品侧消费点（只扫 apps/**） ── */
const eventPlatformExportOk = new RegExp('export\\s+function\\s+' + EVENT_PLATFORM_READER + '\\s*\\(').test(sourceCode);
const eventPlatformLineExportOk = new RegExp('export\\s+function\\s+' + EVENT_PLATFORM_LINE_READER + '\\s*\\(').test(sourceCode);
let eventPlatformConsumerCount = 0;
const eventPlatformConsumerFiles = [];
for (const [rel, code] of stripped) {
    if (!rel.startsWith('apps/')) continue;
    const c = countOf(code, EVENT_PLATFORM_READER + "(");
    if (c > 0) { eventPlatformConsumerCount += c; eventPlatformConsumerFiles.push(rel); }
}

/* ── [v3.6.0] J12：九账证据面的出口在场 + 产品侧消费面（只扫 apps/**） ──
 * 【为什么这里数「文件数」而不是「调用点个数」】见常量区注释：诊断内核一个文件里就有两处
 * 证据面调用（主读数 + null 兜底），按次数计会把同一个业务面数两遍，掩盖另一个面归零。
 * 【为什么证据面把两个出口合并去重】`readLonshaEvidence`（取数式）与 `evidenceFaceOf`（纯函数式）
 * 是**同一面**的两个入口，选哪个是调用方的实现选择（已握快照就走纯函数，避免同一轮两个取数点）；
 * 判据只问「这一面有没有真被业务面读」，故两个出口的命中文件合并成一个集合去重。 */
const evidenceExportOk = new RegExp('export\\s+function\\s+' + EVIDENCE_READER + '\\s*\\(').test(sourceCode);
const evidenceFaceExportOk = new RegExp('export\\s+function\\s+' + EVIDENCE_FACE_READER + '\\s*\\(').test(sourceCode);
const evidenceLineExportOk = new RegExp('export\\s+function\\s+' + EVIDENCE_LINE_READER + '\\s*\\(').test(sourceCode);
const evidenceConsumerFiles = [];
for (const [rel, code] of stripped) {
    if (!rel.startsWith('apps/')) continue;
    if (countOf(code, EVIDENCE_READER + '(') > 0 || countOf(code, EVIDENCE_FACE_READER + '(') > 0) {
        evidenceConsumerFiles.push(rel);
    }
}
const evidenceConsumerCount = evidenceConsumerFiles.length;

/* ── [v3.6.0] J12：投影新鲜度归因面的出口在场 + 产品侧消费面（只扫 apps/**） ──
 * 与证据面分别判：出口被删（corrupt）与出口没人读（fail）是两种故障。
 * 这里数与面同规（去重文件数），理由同上 —— 同一面被一个业务面读两处不该算两面。 */
const freshnessExportOk = new RegExp('export\\s+function\\s+' + FRESHNESS_READER + '\\s*\\(').test(sourceCode);
const freshnessTextExportOk = new RegExp('export\\s+function\\s+' + FRESHNESS_TEXT_READER + '\\s*\\(').test(sourceCode);
const freshnessConsumerFiles = [];
for (const [rel, code] of stripped) {
    if (!rel.startsWith('apps/')) continue;
    if (countOf(code, FRESHNESS_READER + '(') > 0) freshnessConsumerFiles.push(rel);
}
const freshnessConsumerCount = freshnessConsumerFiles.length;

/* ── [v3.20.2] J13：检查点内容级对照面的**出口在场**（独立真源文件）+ 产品侧消费点 ──
 * 出口在场与「有人读」分别判：出口被删（corrupt）与出口没人读（fail）是两种故障，
 * 压成一条会互相顶替（与 J12 同规）。 */
const checkpointCode = stripped.get(CHECKPOINT_SOURCE_REL) || '';
const checkpointExportsOk = [
    CHECKPOINT_READER, CHECKPOINT_DIFF_READER, CHECKPOINT_LINES_READER, CHECKPOINT_LINE_READER
].map((fn) => ({ fn, ok: new RegExp('export\\s+function\\s+' + fn + '\\s*\\(').test(checkpointCode) }));
let checkpointConsumerCount = 0;
const checkpointConsumerFiles = [];
for (const [rel, code] of stripped) {
    if (!rel.startsWith('apps/')) continue;
    const c = countOf(code, CHECKPOINT_READER + '(');
    if (c > 0) { checkpointConsumerCount += c; checkpointConsumerFiles.push(rel); }
}

/* ------------------------------------------------------------
 * 开关：--list 只报告不判定
 * ------------------------------------------------------------ */
if (LIST) {
    console.log('[bridge-contract] 扫描面：apps/** + config/** 共 ' + productFiles.length + ' 个 .js');
    console.log('[bridge-contract] 真源：' + SOURCE_REL + '（每个桥名各恰好 1 次字面量：' + (sourceLiteralOk ? '是' : '否') + '）');
    console.log('\n── J1 桥名自持点（真源外应为 0）──');
    for (const h of literalHits) console.log('  ' + h.rel + '  ' + h.literal + '  x' + h.count);
    if (!literalHits.length) console.log('  （无）');
    console.log('\n── J2 .snapshot( 调用式（只允许真源）──');
    for (const h of callStyleHits) console.log('  ' + h.rel + '  x' + h.count + (h.rel === SOURCE_REL ? '（真源·拉取型分支，合法）' : ''));
    if (!callStyleHits.length) console.log('  （无）');
    console.log('\n── J4 自写形态判据（真源外应为 0）──');
    for (const h of selfProbeHits) console.log('  ' + h.rel + '  x' + h.count);
    if (!selfProbeHits.length) console.log('  （无）');
    console.log('\n── J3 ' + PUSH_READER + ' 消费点：' + consumerCount + '（下限 ' + PUSH_READER_MIN_CONSUMERS + '）──');
    for (const f of consumerFiles) console.log('  ' + f);
    console.log('\n── J6 ' + FACE_STATE_READER + ' 消费点：' + faceConsumerCount + '（下限 ' + FACE_READER_MIN_CONSUMERS + '）──');
    for (const f of faceConsumerFiles) console.log('  ' + f);
    console.log('\n── J7 归因文案表的手写键（应为 0）──');
    for (const h of bareKeyHits) console.log('  ' + h.rel + '  ' + h.table + '  x' + h.keys.length + '  [' + h.keys.join(', ') + ']');
    if (!bareKeyHits.length) console.log('  （无）');
    console.log('\n── J8 ' + PROJECTION_READER + ' 消费点（只计 apps/**）：' + projConsumerCount + '（下限 ' + PROJECTION_READER_MIN_CONSUMERS + '）──');
    for (const f of projConsumerFiles) console.log('  ' + f);
    if (!projConsumerFiles.length) console.log('  （无 —— 投影出口没人用就是摆设）');
    console.log('\n── J9 探针自述面（sourceState / lastError）消费点：' + probeSelfReads + ' 处 / 结构化面 ' + probeSelfSites.length + ' 个（下限 ' + PROBE_SELF_MIN + '）──');
    for (const f of probeSelfFiles) console.log('  ' + f);
    if (!probeSelfSites.length) console.log('  （无结构化面 —— 只读一眼就丢不算消费）');
    console.log('\n── J10 ' + INJECTION_READER + ' 消费点（只计 apps/**）：' + injConsumerCount + '（下限 ' + INJECTION_READER_MIN_CONSUMERS + '）──');
    console.log('\n── J11 ' + EVENT_PLATFORM_READER + ' 消费点（只计 apps/**）：' + eventPlatformConsumerCount + '（下限 ' + EVENT_PLATFORM_MIN_CONSUMERS + '）──');
    for (const f of eventPlatformConsumerFiles) console.log('  ' + f);
    if (!eventPlatformConsumerFiles.length) console.log('  （无 —— 上游事件来源构成没人读就是白做）');
    console.log('\n── J12 ' + EVIDENCE_READER + ' / ' + EVIDENCE_FACE_READER + ' 消费面（只计 apps/**，按文件去重）：' + evidenceConsumerCount + '（下限 ' + EVIDENCE_MIN_CONSUMERS + '）──');
    for (const f of evidenceConsumerFiles) console.log('  ' + f);
    if (!evidenceConsumerFiles.length) console.log('  （无 —— 上游九账证据面没人读就是第九次「建好不消费」）');
    console.log('── J12 ' + FRESHNESS_READER + ' 消费面（只计 apps/**，按文件去重）：' + freshnessConsumerCount + '（下限 ' + FRESHNESS_MIN_CONSUMERS + '）──');
    for (const f of freshnessConsumerFiles) console.log('  ' + f);
    if (!freshnessConsumerFiles.length) console.log('  （无 —— 「有面但被扣下」与「本版没这面」又会被显示成同一句话）');
    console.log('\n── J13 ' + CHECKPOINT_READER + ' 消费点（只计 apps/**）：' + checkpointConsumerCount + '（下限 ' + CHECKPOINT_MIN_CONSUMERS + '）──');
    for (const f of checkpointConsumerFiles) console.log('  ' + f);
    if (!checkpointConsumerFiles.length) console.log('  （无 —— 上游检查点内容级对照没人读，第十次「建好不消费」）');
    for (const x of checkpointExportsOk) console.log('  ' + (x.ok ? '·' : 'x') + ' 真源出口 ' + x.fn);
    process.exit(0);
}

/* ------------------------------------------------------------
 * 判定
 * ------------------------------------------------------------ */
let fail = 0;
let corrupt = 0;

if (!FIXTURE && productFiles.length < MIN_PRODUCT_FILES) {
    corrupt = 1;
    console.error('[bridge-contract] x J5 扫描面只命中 ' + productFiles.length + ' 个产品 .js（下限 ' + MIN_PRODUCT_FILES + '）—— 探测器失效，拒判。');
    console.error('  修法：核对 --root 与 apps/**、config/** 是否真的存在；副本树场景请设 RP_BRIDGE_FIXTURE=1。');
}
const offendingLiterals = literalHits.filter((h) => h.rel !== SOURCE_REL);
if (offendingLiterals.length) {
    fail = 1;
    console.error('[bridge-contract] x J1 有 ' + offendingLiterals.length + ' 处产品文件自持桥名（应 import 真源常量）：');
    for (const h of offendingLiterals) console.error('    ' + h.rel + '  x' + h.count);
    console.error('  修法：删掉本地字面量/BRIDGE_ID，改 import { LONSHA_BRIDGE_ID } from config/world-bridge.js。');
}
if (!sourceLiteralOk) {
    corrupt = 1;
    console.error('[bridge-contract] x J1 真源 ' + SOURCE_REL + ' 的桥名常量不是「每个恰好 1 次」—— 拒判。');
}
const offendingCalls = callStyleHits.filter((h) => h.rel !== SOURCE_REL);
if (offendingCalls.length) {
    fail = 1;
    console.error('[bridge-contract] x J2 有 ' + offendingCalls.length + ' 个产品文件仍在用 .snapshot( 调用式读桥：');
    for (const h of offendingCalls) console.error('    ' + h.rel + '  x' + h.count);
    console.error('  说明：lonsha 桥是推送型（snapshot 是对象），调用它必然抛 TypeError；WorldAxis 桥才是拉取型（snapshot 是函数）。');
    console.error('  修法：推型一律走 ' + SOURCE_REL + ' 的 ' + PUSH_READER + '()（或 readLonshaSnapshot()）。');
}
const offendingSelf = selfProbeHits.filter((h) => h.rel !== SOURCE_REL);
if (offendingSelf.length) {
    fail = 1;
    console.error('[bridge-contract] x J4 有 ' + offendingSelf.length + ' 个产品文件又在自写「snapshot 形态判据」：');
    for (const h of offendingSelf) console.error('    ' + h.rel + '  x' + h.count);
    console.error('  修法：形态判定只许有一份，在 ' + SOURCE_REL + '；消费方只读它的返回值。');
}
if (!sourceHasExport) {
    corrupt = 1;
    console.error('[bridge-contract] x J3 真源缺少 export function ' + PUSH_READER + '( 出口 —— 拒判（消费方会全数失联）。');
}
if (consumerCount < PUSH_READER_MIN_CONSUMERS) {
    fail = 1;
    console.error('[bridge-contract] x J3 ' + PUSH_READER + ' 只有 ' + consumerCount + ' 个产品侧调用点（下限 ' + PUSH_READER_MIN_CONSUMERS + '）—— 「抽出来没人用」= 摆设出口：');
    for (const f of consumerFiles) console.error('    ' + f);
}

/* ── J6 / J7 [v2.98.0] ── */
if (!sourceFieldExportOk) {
    corrupt = 1;
    console.error('[bridge-contract] x J6 真源缺少 export function ' + FIELD_READER + '( —— 拒判。');
}
if (!sourceFaceExportOk) {
    corrupt = 1;
    console.error('[bridge-contract] x J6 真源缺少 export function ' + FACE_STATE_READER + '( —— 拒判。');
}
if (faceConsumerCount < FACE_READER_MIN_CONSUMERS) {
    fail = 1;
    console.error('[bridge-contract] x J6 ' + FACE_STATE_READER + ' 只有 ' + faceConsumerCount + ' 个产品侧调用点（下限 ' + FACE_READER_MIN_CONSUMERS + '）');
    console.error('  说明：上游 v3.174 把「源里没这项」与「有这项、值是空」写进了 snapshot.meta.fieldTypes，');
    console.error('        下游不读 ⇒ 两种处境同形，文案还会错误地让用户去升级插件。');
    for (const f of faceConsumerFiles) console.error('    ' + f);
}
if (bareKeyHits.length) {
    fail = 1;
    console.error('[bridge-contract] x J7 有 ' + bareKeyHits.length + ' 张归因文案表在**手写键**（应取真源常量的值）：');
    for (const h of bareKeyHits) console.error('    ' + h.rel + '  ' + h.table + '  [' + h.keys.join(', ') + ']');
    console.error('  说明：手写的标识符形键与真源常量的值形（连字符形）不同 ⇒ 查不到、静默走兜底，');
    console.error('        多种处境会显示成同一句话。修法：键写作 [REASONS.xxx]。');
}

/* ── J8 / J9 [v3.0.1] ── */
if (projConsumerCount < PROJECTION_READER_MIN_CONSUMERS) {
    fail = 1;
    console.error('[bridge-contract] x J8 ' + PROJECTION_READER + ' 只有 ' + projConsumerCount + ' 个产品侧消费点（下限 ' + PROJECTION_READER_MIN_CONSUMERS + '）：');
    for (const f of projConsumerFiles) console.error('    ' + f);
    console.error('  说明：投影出口的全部价值是「让每个业务面说清这份读数是哪来的」；');
    console.error('        只有诊断面在读 = 用户永远在业务页看不到来源，只能倒着去诊断页查，等于没做归属面。');
    console.error('  修法：每个业务 App 的 projection() 出口附上 readProjection + projectionScopeLine 的读数。');
}
const missingProbeSites = PROBE_SELF_SITES.filter((s) => !probeSelfSites.includes(s));
if (missingProbeSites.length) {
    fail = 1;
    console.error('[bridge-contract] x J9 探针自述面缺结构化落点（' + missingProbeSites.length + ' 处）：');
    for (const s of missingProbeSites) console.error('    ' + s.rel + '  缺锚点  ' + s.anchor);
    console.error('  说明：只「读到」 ' + PROBE_SELF_FIELDS.join(' / ') + ' 不够，必须落成一个结构化面把两个字段接住。');
}
if (probeSelfReads < PROBE_SELF_MIN) {
    fail = 1;
    console.error('[bridge-contract] x J9 产品侧没有任何 probe.(' + PROBE_SELF_FIELDS.join('|') + ') 读取点（下限 ' + PROBE_SELF_MIN + '）');
    console.error('  说明：上游桥把「引擎未就位 / 引擎在位但返回空 / 取快照抛错」三类自述写在这两个字段上；');
    console.error('        下游不读 ⇒ 「没挂载」与「挂了但引擎坏了」被说成同一句话，用户会朝错方向修。');
}

/* ── J10 [v3.0.2] ── */
if (injConsumerCount < INJECTION_READER_MIN_CONSUMERS) {
    fail = 1;
    console.error('[bridge-contract] x J10 ' + INJECTION_READER + ' 只有 ' + injConsumerCount + ' 个产品侧消费点（下限 ' + INJECTION_READER_MIN_CONSUMERS + '）：');
    for (const f of injConsumerFiles) console.error('    ' + f);
    console.error('  说明：上游 v3.215.0 起把「AI 这一轮实际看到了什么」外供成快照 injection，');
    console.error('        下游不读 ⇒ 用户永远看不到「哪几块真的进了上下文、哪几块被预算裁掉」，');
    console.error('        也看不到「读到 0 块候选」与「候选全被裁」是两件处置方向相反的事。');
    console.error('  修法：产品面接 config/injection-contract.js 的 readInjection。');
}

/* ── J11 [v3.5.0] ── */
if (!eventPlatformExportOk || !eventPlatformLineExportOk) {
    corrupt = 1;
    console.error('[bridge-contract] x J11 真源缺出口：' + EVENT_PLATFORM_READER + ' / ' + EVENT_PLATFORM_LINE_READER);
}
if (eventPlatformConsumerCount < EVENT_PLATFORM_MIN_CONSUMERS) {
    fail = 1;
    console.error('[bridge-contract] x J11 ' + EVENT_PLATFORM_READER + ' 只有 ' + eventPlatformConsumerCount + ' 个产品侧消费点（下限 ' + EVENT_PLATFORM_MIN_CONSUMERS + '）：');
    for (const f of eventPlatformConsumerFiles) console.error('    ' + f);
    console.error('  说明：上游 lonsha v3.233.0 把「这条事件是谁记的」折成受控分级四态并外供 snapshot.eventPlatforms，');
    console.error('        下游不读 ⇒ 用户永远看不到「事件是哪一侧发生的」，跨平台对照在这台设备上无据可查。');
    console.error('  修法：产品面接 config/world-bridge.js 的 readLonshaEventPlatforms / eventPlatformsLine。');
}

/* ── J12 [v3.6.0] ── */
/* 出口在场**分别判**：四个函数缺一即 corrupt。合成一条会互相顶替 ——
 * 「证据面读不出但新鲜度面在」与「证据面在但新鲜度面读不出」是两种完全不同的故障。 */
const missingExports = [];
if (!evidenceExportOk) missingExports.push(EVIDENCE_READER);
if (!evidenceFaceExportOk) missingExports.push(EVIDENCE_FACE_READER);
if (!evidenceLineExportOk) missingExports.push(EVIDENCE_LINE_READER);
if (!freshnessExportOk) missingExports.push(FRESHNESS_READER);
if (!freshnessTextExportOk) missingExports.push(FRESHNESS_TEXT_READER);
if (missingExports.length) {
    corrupt = 1;
    console.error('[bridge-contract] x J12 真源缺出口（' + missingExports.length + ' 个）：' + missingExports.join(' / '));
    console.error('  说明：这些出口是 v3.6.0 落的下游消费侧入口，被人删掉就等于那一面又回到「读不出」。');
}
if (evidenceConsumerCount < EVIDENCE_MIN_CONSUMERS) {
    fail = 1;
    console.error('[bridge-contract] x J12 ' + EVIDENCE_READER + ' / ' + EVIDENCE_FACE_READER + ' 只被 ' + evidenceConsumerCount + ' 个产品面消费（下限 ' + EVIDENCE_MIN_CONSUMERS + '，按文件去重）：');
    for (const f of evidenceConsumerFiles) console.error('    ' + f);
    console.error('  说明：上游 lonsha v3.214.0 把九本账收成一份可查对账面（引用键 + 出处楼层）并外供快照 evidence，');
    console.error('        下游不读 ⇒ 「这个承诺是哪一楼说的」在这台设备上无据可查，那份对账面等于白做（第九次「建好不消费」）。');
    console.error('  修法：产品面接 config/world-bridge.js 的 readLonshaEvidence（无现成快照）或 evidenceFaceOf（已握快照）。');
}
if (freshnessConsumerCount < FRESHNESS_MIN_CONSUMERS) {
    fail = 1;
    console.error('[bridge-contract] x J12 ' + FRESHNESS_READER + ' 只被 ' + freshnessConsumerCount + ' 个产品面消费（下限 ' + FRESHNESS_MIN_CONSUMERS + '，按文件去重）：');
    for (const f of freshnessConsumerFiles) console.error('    ' + f);
    console.error('  说明：上游 lonsha v3.213.0 给投影加了导出期新鲜度守卫，切聊/回滚时的旧缓存不再导出，');
    console.error('        原因留在 snapshot.meta.projectionFreshness。下游不读 ⇒ 该字段缺席时 fieldTypes.projection.present');
    console.error('        也为 false，于是 readProjection() 一律报 no-projection-face（文案「需记忆插件 v3.212+」）——');
    console.error('        把「有面但被守卫扣下（**重发一轮就好**）」谎报成「本版没这面（只能等升级）」。这是**已发生的错读数**，不是浪费。');
    console.error('  修法：产品面接 config/world-bridge.js 的 readProjectionFreshness / projectionFreshnessText。');
}

/* ── J13 [v3.20.2] ── */
/* 出口在场与「有人读」**分别判**（与 J12 同规）：出口被删 = corrupt，出口没人读 = fail。
 * 合成一条会互相顶替 ——「面读不出但有人在读」与「面在但没人读」是两种完全不同的故障。 */
const missingCheckpointExports = checkpointExportsOk.filter((x) => !x.ok).map((x) => x.fn);
if (missingCheckpointExports.length) {
    corrupt = 1;
    console.error('[bridge-contract] x J13 真源 ' + CHECKPOINT_SOURCE_REL + ' 缺出口（' + missingCheckpointExports.length + ' 个）：' + missingCheckpointExports.join(' / '));
    console.error('  说明：这些出口是 v3.20.2 落的下游消费侧入口，被人删掉就等于那一面又回到「读不出」。');
}
if (checkpointConsumerCount < CHECKPOINT_MIN_CONSUMERS) {
    fail = 1;
    console.error('[bridge-contract] x J13 ' + CHECKPOINT_READER + ' 只有 ' + checkpointConsumerCount + ' 个产品侧消费点（下限 ' + CHECKPOINT_MIN_CONSUMERS + '）：');
    for (const f of checkpointConsumerFiles) console.error('    ' + f);
    console.error('  说明：上游 lonsha v3.252.0（F7 首阶段）把「两份账之间**内容级**差了什么」外供出来');
    console.error('        （diffPayloadsDeep + compareBranchCheckpointsDeep / checkpointContentDiffLines）——');
    console.error('        那是「**同键同长度但值不同**」（「余额 100→900」「朋友→仇人」）的唯一读数面，');
    console.error('        而键面读数在这类改变上完全看不出来（键一样、字节差不多）。');
    console.error('        下游零消费 ⇒ 用户看到的只有「两边的键一样」，那份最要紧的差异零读数（第十次「建好不消费」）。');
    console.error('  修法：产品面接 config/checkpoint-content-contract.js 的 readLonshaCheckpointFace。');
}

if (corrupt) process.exit(2);
if (fail) {
    console.error('[bridge-contract] x 桥消费面契约未通过');
    process.exit(1);
}
console.log('[bridge-contract] 扫描面 apps/** + config/** 共 ' + productFiles.length + ' 个 .js · 桥名自持点 0（真源逐名 1 次）· .snapshot( 调用式 0（真源拉取型分支 ' + sourceCallCount + ' 处）· 自写形态 0');
console.log('[bridge-contract] ' + PUSH_READER + ' 消费点 ' + consumerCount + ' 个（' + consumerFiles.length + ' 文件，下限 ' + PUSH_READER_MIN_CONSUMERS + '）');
console.log('[bridge-contract] ' + FACE_STATE_READER + ' 消费点 ' + faceConsumerCount + ' 个（' + faceConsumerFiles.length + ' 文件，下限 ' + FACE_READER_MIN_CONSUMERS + '）· 归因文案表手写键 ' + bareKeyHits.length + ' 张');
console.log('[bridge-contract] ' + PROJECTION_READER + ' 消费点 ' + projConsumerCount + ' 个（' + projConsumerFiles.length + ' 文件，下限 ' + PROJECTION_READER_MIN_CONSUMERS + '）');
console.log('[bridge-contract] sourceState/lastError 消费点 ' + probeSelfReads + ' 处 · 结构化面 ' + probeSelfSites.length + ' 个（下限 ' + PROBE_SELF_MIN + '）');
console.log('[bridge-contract] ' + EVENT_PLATFORM_READER + ' 消费点 ' + eventPlatformConsumerCount + ' 个（' + eventPlatformConsumerFiles.length + ' 文件，下限 ' + EVENT_PLATFORM_MIN_CONSUMERS + '）');
console.log('[bridge-contract] ' + INJECTION_READER + ' 消费点 ' + injConsumerCount + ' 个（' + injConsumerFiles.length + ' 文件，下限 ' + INJECTION_READER_MIN_CONSUMERS + '）');
console.log('[bridge-contract] ' + EVIDENCE_READER + ' / ' + EVIDENCE_FACE_READER + ' 消费面 ' + evidenceConsumerCount + ' 个（按文件去重，下限 ' + EVIDENCE_MIN_CONSUMERS + '）· ' + FRESHNESS_READER + ' 消费面 ' + freshnessConsumerCount + ' 个（下限 ' + FRESHNESS_MIN_CONSUMERS + '）');
console.log('[bridge-contract] ' + CHECKPOINT_READER + ' 消费点 ' + checkpointConsumerCount + ' 个（' + checkpointConsumerFiles.length + ' 文件，下限 ' + CHECKPOINT_MIN_CONSUMERS + '）· 真源四出口在场 ' + (checkpointExportsOk.every((x) => x.ok) ? '是' : '否'));
console.log('[bridge-contract] v 桥名单一真源 / 调用式绝迹 / 形态判据唯一 / 出口在场且真被消费 / 字段三态被消费 / 文案表键不手写 / 投影归属面被业务面消费 / 探针自述面落下成面 / 注入实际读数被业务面消费 / 事件来源构成被业务面消费 / 九账证据面被业务面消费 / 投影新鲜度归因被业务面消费 / 检查点内容级对照被业务面消费');
process.exit(0);
