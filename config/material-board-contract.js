/* ============================================================
 * material-board-contract.js — [v4.30.0 · 第四期 R4-X9]
 *   「面向下一幕的写作取材板」纯契约件（**只读**：选目标 → 预览取材集合 → 交给既有 owner）
 *
 * 【计划原文（R4-X9）】
 *   「选择人物、地点、时间和写作目标，预览该用的旧事、尚未兑现的约定及禁知内容边界，
 *     再选择用于主聊天或创作草稿。」
 *   落点与依赖：creationdesk 复用 context-compose / 注入预算 owner；**M4-X8 负责按任务组织事实，
 *     手机负责取舍和目标选择**。引用动态重取，不存第二套世界状态。
 *   验收四条：① 同一人物分别准备「重逢」「赴约」「冲突后和解」三幕，材料有任务差异且均可回源；
 *     ② 取消不触发生成；③ 选定时点之后的事实不提前进入；④ 最终生成需真宿主/真模型体验核验。
 *   不做三条：不自动编造未发生事件、不替用户推进时间、不新建导演代理或注入框架。
 *
 * 【修前实测的缺口（读码可复算，不是推演）】
 *   上游 lonsha-memory-plugin 在 v3.346.0（M4-X8）交付了取材面（`material-pack.js`）：
 *   任务四类 `meet / reunion / advance / resolve`，四份 `TASK_PRIORITY` 各是同一 `FACETS`
 *   十格的**不同排法**；`resolveConflicts` 同组只留楼层最新一条、其余具名 `superseded`；
 *   `restricted` / `future` 两条闸默认闭且**分别计数**；`gaps` 逐面具名、关键面另进
 *   `gapsCritical`；入参畸形（`malformedInput` + `judged:false`）与池空**不同形**。
 *   而这一面**上游当时漏登外供表**（`open_face_registry.tsv` 此前只登记到 branchCanon），
 *   本仓 `grep -RIn 'materialPack' apps config`（消费者侧）此前同样零命中
 *   ⇒「按下一幕目标组织取材集合」这条旅程**断在中间**：
 *   用户能看两支线差在哪、能看证词与因果，却没有一处能把「这一幕该带哪几样材料」做完。
 *   后果三件，都不是报错：
 *     ① 「这一幕没有材料」与「插件没装」在界面上**同形**（都读成「取材板空着」），
 *        而两者处置相反：前者该去补事实或换一幕，后者该去装插件；
 *     ② 「池里有材料但一条都没进包」（全被两条闸挡住 / 全部未归面）与「池里就是空的」
 *        **同形** —— 而前者要去看 held 里被挡住的是谁，后者才是真没有；
 *     ③ 手机侧没有「时点」这一格：选定的材料里混进**选定之后才发生**的事实，
 *        等于把没发生的剧情当成已发生交出去，而**一个字符都不报错**。
 *
 * 【本件只做四件事（不重算任何上游判定）】
 *   1 **取数**：四路读数（取材集合 / 逐面明细 / 被挡住的三类 / 选定集合）一律转上游出口；
 *      本件**不另写一份任务优先级表、不另判一次矛盾取代、不另算一次缺口**
 *      （两份实现必然漂移）；
 *   2 **分列**：任务四类、材料面十格、包内条目、逐面明细、缺口（关键面另列）、
 *      被取代者（具名）、被挡住四类（受限 / 未发生 / 被取代 / 未归面）、越预算名单 ——
 *      全部**结构上分开**；
 *   3 **不压平**：「插件没装」与「这一幕没有材料」不同形；「池空」与「池有但零进包」不同形；
 *      「未发生」与「受限」不同形；「不在包里」（无从取）与「时点之后」（不该取）不同形；
 *   4 **零写面**：本件一个字节都不落盘（`writesNothing` 恒 true）—— 装配归上游 owner、
 *      裁剪归注入预算 owner、落笔归草稿 owner；手机侧只做**取舍与目标选择**。
 *
 * 【边界（如实登记，不装）】
 *   · 本件**不装配材料池**：池由上游 `_materialInventory` 逐源收（取不到记 absent、
 *     抛错记 thrown，**缺席绝不冒充空**）。手机侧只给「用户选的时点 / 目标」与 `budget`；
 *   · 本件**不裁到 token**：只如实搬运上游的条数预算与越预算名单（裁剪归既有预算 owner）；
 *   · 本件**不判哪条材料更好**（不排序、不评分、不给推荐 —— 禁用键深度扫描守这一条，
 *     与 R4-X4 的清单有一处**有意差异**，见 `MB_FORBIDDEN_KEYS` 的注释）；
 *   · 本件**不替用户推进时间**：时点只用来**分列**（选定之后的事实如实报 `after-as-of`
 *     并具名），本件不自行改写材料池、不伪造楼层；
 *   · 上游不在就如实报缺席，**不退回本地猜一份材料清单**。
 * ============================================================ */
'use strict';
/* ★ 数值取值门走**全仓唯一实现**（config/num-gate.js），不在本文件就地再写一份。 */
import { numOrNull as floorOrNull } from './num-gate.js';
/** 上游插件全局名（与其它契约模块读的是同一个） */
const LONSHA_PLUGIN_GLOBAL = 'LonShaMemory';
/** 上游取材模块全局名（模块路：engine 路缺席时用于「面在不在场」的判定） */
const MATERIAL_MODULE_GLOBAL = 'LonShaMaterialPack';
/** 上游面 id（与上游 open_face_registry.tsv / 本仓 crossrepo-registry.js 同一口径） */
export const MB_FACE_ID = 'materialPack';
/** 五态（没装插件 / 这一面不在场 / 本机读不出 / 真跑过零材料 / 读到）。 */
export const MB_STATES = Object.freeze({
    ENGINE_ABSENT: 'engine-absent',
    FACE_ABSENT: 'face-absent',
    UNUSABLE: 'unusable',
    EMPTY: 'empty',
    OK: 'ok'
});
/** 归因词（两两不同形；「没装插件」与「这一幕没有材料」各有各的词，不许压成一句「取材板空着」）。 */
export const MB_REASONS = Object.freeze({
    ok: '取材面就绪',
    'engine-absent': '记忆插件未装或未加载（等装插件）',
    'face-absent': '插件在场但这版没有取材面（需插件 v3.346.0+）',
    unusable: '出口在但读不出或形态不对（本机读不出，**不是**「这一幕没有材料」）',
    empty: '真跑过、材料池里一条可用材料都没有（**不是**「插件没装」）',
    'no-deps': '本机没拿到材料池（装配归上游宿主）——读不出，不是没有材料',
    malformed: '材料池入参畸形（上游如实报 malformedInput）——无从选材，**不是**「这次没有材料」'
});
/** 各态的**给用户看的一句处置建议**（与 MB_REASONS 的短归因分工不同：那条进一行读数，这条进卡片） */
export const MB_STATE_HINT = Object.freeze({
    'engine-absent': '未检测到 LonSha 记忆插件的取材面 —— 装上（或升级）后本板自动可用',
    'face-absent': '插件在，但这一版没有取材面：需要较新版本',
    unusable: '取材面在，但本机读不出（出口报错 / 面畸形 / 装配未到）—— 这不是「这一幕没有材料」',
    empty: '取材面真跑过了，材料池里一条可用材料都没有 —— 聊几楼让事实长出来，或换一个写作目标'
});
/** 下一幕任务四类（**穷尽**：与上游 TASKS 同一份词表，不另造第五类）。 */
export const MB_TASKS = Object.freeze(['meet', 'reunion', 'advance', 'resolve']);
export const MB_TASK_LABEL = Object.freeze({
    meet: '赴约',
    reunion: '重逢',
    advance: '推进',
    resolve: '收束'
});
/** 材料面十格（**穷尽**：与上游 FACETS 同一份词表；不归属者进 unclassified，**不硬塞**）。 */
export const MB_FACETS = Object.freeze([
    'appointment', 'place', 'participants', 'relation', 'sharedPast',
    'promise', 'pov', 'item', 'constraint', 'setting'
]);
export const MB_FACET_LABEL = Object.freeze({
    appointment: '约定',
    place: '地点',
    participants: '参与者',
    relation: '关系变化',
    sharedPast: '共同往事',
    promise: '未闭承诺',
    pov: '视角约束',
    item: '物品',
    constraint: '硬约束',
    setting: '资料设定'
});
/** 被挡住的三类 + 被取代（**四格分列**：压成一格就分不出「不该带」与「该带但没轮到」）。 */
export const MB_HELD = Object.freeze(['restricted', 'future', 'unclassified', 'superseded']);
export const MB_HELD_LABEL = Object.freeze({
    restricted: '受限（越界知情，不喂）',
    future: '未发生（计划不当成已发生）',
    unclassified: '未归面（不硬塞成约束或设定）',
    superseded: '被取代（同组旧值，具名留痕）'
});
/** 材料来源（**出处**，不是「已验真」的印章；与上游 SOURCES 同表）。 */
export const MB_SOURCES = Object.freeze([
    'continuity', 'recall', 'scene-book', 'relation', 'promise',
    'pov', 'fated-recall', 'lore', 'note', 'caller', 'unknown'
]);
/** 选定集合的两类未取（**分列**：「不在包里」是**无从取**，「时点之后」是**不该取**）。 */
export const MB_PICK_HELD = Object.freeze(['not-in-pack', 'after-as-of']);
export const MB_PICK_HELD_LABEL = Object.freeze({
    'not-in-pack': '不在本幕的包里（无从取：它没被选进这一场，不是被禁）',
    'after-as-of': '在所选时点之后（不该取：未发生的事实不许提前进入）'
});
/**
 * 读数里**不得出现**的键名（推荐 / 评分 / 置信一族）。
 *   计划原文「不自动编造未发生事件、不新建导演代理」与本板「不判哪条材料更好」——
 *   本件把它变成对自己读数的一次深度扫描（自检里真跑）。
 *   ★ 与 R4-X4 的 `BC_FORBIDDEN_KEYS` 有一处**有意差异**：本清单**不含** `rank` / `priority` /
 *     `index`。理由逐字写清 —— 本面必须**如实搬运上游的确定性排序键**（顶层 `priority` 是
 *     「按任务排面序」的可复算顺序表、每条材料的 `facetRank` 与 `order` 是它在其中的位次），
 *     那三样是**可解释的顺序**而不是给材料打的分；把它们列进禁用键会让本面无法如实呈现上游读数，
 *     也会让「按任务优先级排序」这条立身之本变成不可判。差异是**有意的**，不是漏写。
 */
export const MB_FORBIDDEN_KEYS = Object.freeze([
    'better', 'best', 'worse', 'worst', 'score', 'rating', 'preference',
    'recommend', 'percent', 'percentage', 'confidence', 'weight', 'probability', 'prob'
]);
/** 上限（冻结）：**沿上游既有上限，不新造第二套** */
export const MB_LIMITS = Object.freeze({
    /** 包内条目上限（沿上游 PACK_MAX = 14） */
    pack: 14,
    /** 逐面明细上限（材料面十格 + 余量） */
    sheet: 12,
    /** 被挡住各类的呈现上限 */
    held: 30,
    /** 缺口上限 */
    gaps: 12,
    /** 被取代者上限 */
    superseded: 20,
    /** 单条标题上限（沿上游 SNIPPET_MAX = 80） */
    title: 80,
    label: 160,
    reason: 200,
    note: 200
});function str(v) { return String(v == null ? '' : v).trim(); }
function arr(v) { return Array.isArray(v) ? v : []; }
function obj(v) { return (v && typeof v === 'object' && !Array.isArray(v)) ? v : null; }
function clip(s, max) {
    const t = str(s);
    const m = Math.max(8, Number(max) || MB_LIMITS.label);
    return t.length <= m ? t : (t.slice(0, m - 1) + String.fromCharCode(8230));
}
/** 宿主窗口（注入优先，回落全局） */
function resolveWin(win) {
    if (win && typeof win === 'object') return win;
    try { return (typeof window !== 'undefined') ? window : globalThis; } catch (_e) { return globalThis; }
}
/** 上游引擎对象（与其它契约模块同一套取法） */
function engineOf(w) {
    if (!w) return null;
    const plugin = w[LONSHA_PLUGIN_GLOBAL];
    if (!plugin || typeof plugin !== 'object') return null;
    const engine = plugin.engine || plugin.memoryEngine || null;
    return (engine && typeof engine === 'object') ? engine : null;
}
/** 上游模块对象（模块路：全局挂载） */
function moduleOf(w) {
    if (!w) return null;
    const mod = w[MATERIAL_MODULE_GLOBAL];
    return (mod && typeof mod === 'object') ? mod : null;
}
/** 恒定键面的读数模板（读者不必再判 undefined） */
function faceOf(state, reason, extra) {
    return Object.assign({
        kind: 'ruby_phone_material_board',
        version: 1,
        state: state,
        reason: reason,
        text: MB_REASONS[reason] || MB_REASONS['engine-absent'],
        ok: state === MB_STATES.OK,
        degraded: state === MB_STATES.ENGINE_ABSENT
            || state === MB_STATES.FACE_ABSENT
            || state === MB_STATES.UNUSABLE,
        /** 本面能不能替沉默作证：只有**真跑过**（读到 / 零材料）才为真 */
        silentCapable: state === MB_STATES.OK || state === MB_STATES.EMPTY,
        /** ★ 零写面：本件在任何态下都不落盘（写成读数，不靠注释承诺） */
        writesNothing: true,
        /** ★ 不代写未发生剧情（计划原文「不自动编造未发生事件」） */
        devisesNothing: true,
        /** 任务（四类之一；认不出 ⇒ 按推进并**说明**，与上游同一口径） */
        task: 'advance',
        taskLabel: MB_TASK_LABEL.advance,
        taskGiven: false,
        taskKnown: false,
        taskWhy: '',
        /** 材料面十格与标签（**同一份词表**，不另造） */
        facets: MB_FACETS.slice(),
        facetLabels: Object.assign({}, MB_FACET_LABEL),
        /** 本幕的面优先级（**搬上游的**，本件不另排一份） */
        facetOrder: [],
        criticalFacets: [],
        /** 包内条目（带上哪几条；**有序**，越靠前越该先带） */
        pack: [],
        packIds: [],
        /** 逐面明细（每面几条、是否关键面、都是谁） */
        sheet: [],
        /** 缺口（逐面具名）与关键面缺口（另列，不混进 gaps 压平） */
        gaps: [],
        gapsCritical: [],
        /** 被挡住的三类 + 被取代（**四格分列**） */
        held: { restricted: [], future: [], unclassified: [], superseded: [] },
        /** 预算（条数）与越预算名单（**有序候补**；裁剪归既有预算 owner） */
        budget: { given: false, perItem: 0, budgetRaw: null },
        overBudget: [],
        /** 成本读数（字数估计，不是 token 裁决） */
        cost: { items: 0, estChars: 0, estCharsAll: 0, estCharsSkipped: 0 },
        counts: {
            inventory: 0, usable: 0, packed: 0, restricted: 0, future: 0,
            unclassified: 0, superseded: 0, truncated: 0, dropped: 0, truncatedIn: 0
        },
        reasons: [],
        /** 池里有没有材料（**与「包里有几条」是两件事**：池有而包空 ⇒ 去看 held） */
        poolHasMaterial: false,
        /** 排序即准备（与上游同一口径） */
        orderIsRank: true
    }, extra || {});
}
/** 任务归一（**缺省 advance**；给了但不认识 ⇒ 按 advance 并**说明**，与上游同一口径）。 */
function normTask(v) {
    const t = str(v);
    if (MB_TASKS.indexOf(t) >= 0) return { task: t, known: true, given: true, why: '' };
    const given = (v !== undefined && v !== null && str(v) !== '');
    return {
        task: 'advance',
        known: false,
        given: given,
        why: given ? 'task 未识别 ⇒ 按推进（不编第五类任务）' : ''
    };
}
/** 把上游一条材料逐格归一（**不重判** usable / why，只收敛形状）。 */
function normMaterial(raw) {
    const o = obj(raw);
    if (!o) return null;
    const id = str(o.id);
    if (!id) return null;
    const facet = str(o.facet);
    return {
        id: id.slice(0, 120),
        facet: MB_FACETS.indexOf(facet) >= 0 ? facet : '',
        facetLabel: MB_FACET_LABEL[facet] || '未归面',
        title: clip(o.title, MB_LIMITS.title),
        snippet: clip(o.snippet, MB_LIMITS.title),
        source: MB_SOURCES.indexOf(str(o.source)) >= 0 ? str(o.source) : (str(o.source) || 'unknown'),
        /** 楼层（可回源的定位格；**缺则 null，不编 0**） */
        floor: floorOrNull(o.floor),
        subject: str(o.subject).slice(0, 120),
        conflictGroup: str(o.conflictGroup).slice(0, 120),
        /** 位次（上游给的可复算顺序；缺则 null） */
        order: floorOrNull(o.order),
        facetRank: floorOrNull(o.facetRank),
        /** 这一条是怎么归面的（explicit / kind / none）——「为什么在这格」要可解释 */
        facetVia: str(o.facetVia).slice(0, 20),
        why: str(o.why).slice(0, 40),
        usable: o.usable === true,
        restricted: o.restricted === true,
        future: o.future === true
    };
}
/** 把上游一条缺口行逐格归一（**关键面另列**，不混进普通缺口）。 */
function normGap(raw) {
    const o = obj(raw);
    if (!o) return null;
    const facet = str(o.facet);
    if (!facet) return null;
    return {
        facet: facet.slice(0, 40),
        facetLabel: str(o.facetLabel) || MB_FACET_LABEL[facet] || facet,
        critical: o.critical === true
    };
}
/** 把上游一条逐面明细行逐格归一。 */
function normSheetRow(raw) {
    const o = obj(raw);
    if (!o) return null;
    const facet = str(o.facet);
    if (!facet) return null;
    return {
        facet: facet.slice(0, 40),
        facetLabel: str(o.facetLabel) || MB_FACET_LABEL[facet] || facet,
        count: Number(o.count) || 0,
        critical: o.critical === true,
        ids: arr(o.ids).map((x) => str(x).slice(0, 120)).filter(Boolean).slice(0, MB_LIMITS.pack)
    };
}
/** 被挡住的一行（三类共用形状；`why` 逐类不同字，**不许压成一句**）。 */
function normHeldRow(raw, why) {
    const o = obj(raw);
    if (!o) return null;
    const id = str(o.id);
    if (!id) return null;
    const facet = str(o.facet);
    return {
        id: id.slice(0, 120),
        facet: MB_FACETS.indexOf(facet) >= 0 ? facet : '',
        facetLabel: MB_FACET_LABEL[facet] || '未归面',
        facetRaw: str(o.facetRaw).slice(0, 40),
        title: clip(o.title, MB_LIMITS.title),
        why: str(o.why) || why,
        /** 被取代者多带一格：被谁取代（具名，不是「已丢弃」三个字） */
        supersededBy: str(o.supersededBy).slice(0, 120),
        conflictGroup: str(o.conflictGroup).slice(0, 120),
        floor: floorOrNull(o.floor),
        source: str(o.source).slice(0, 40)
    };
}
/** 越预算候补行（**有序**：越靠前越该先补进预算）。 */
function normOverBudget(raw) {
    const o = obj(raw);
    if (!o) return null;
    const id = str(o.id);
    if (!id) return null;
    const facet = str(o.facet);
    return {
        id: id.slice(0, 120),
        facet: MB_FACETS.indexOf(facet) >= 0 ? facet : '',
        facetLabel: MB_FACET_LABEL[facet] || '未归面',
        order: floorOrNull(o.order),
        title: clip(o.title, MB_LIMITS.title)
    };
}/** 上游读数 → 本件读数（**只搬运与收敛形状，不重判任何一格**）。 */
function fromUpstream(g, task) {
    const pack = arr(g.pack).map(normMaterial).filter(Boolean).slice(0, MB_LIMITS.pack);
    const sheet = arr(g.sheet).map(normSheetRow).filter(Boolean).slice(0, MB_LIMITS.sheet);
    const gaps = arr(g.gaps).map(normGap).filter(Boolean).slice(0, MB_LIMITS.gaps);
    const gapsCritical = arr(g.gapsCritical).map(normGap).filter(Boolean).slice(0, MB_LIMITS.gaps);
    const h = obj(g.held) || {};
    const held = {
        restricted: arr(h.restricted).map((x) => normHeldRow(x, 'restricted')).filter(Boolean).slice(0, MB_LIMITS.held),
        future: arr(h.future).map((x) => normHeldRow(x, 'future')).filter(Boolean).slice(0, MB_LIMITS.held),
        unclassified: arr(h.unclassified).map((x) => normHeldRow(x, 'unclassified')).filter(Boolean).slice(0, MB_LIMITS.held),
        superseded: arr(h.superseded).map((x) => normHeldRow(x, 'superseded')).filter(Boolean).slice(0, MB_LIMITS.held)
    };
    const overBudget = arr(g.overBudget).map(normOverBudget).filter(Boolean).slice(0, MB_LIMITS.held);
    const c = obj(g.counts) || {};
    const b = obj(g.budget) || {};
    const cost = obj(g.cost) || {};
    const counts = {
        inventory: Number(c.inventory) || 0,
        usable: Number(c.usable) || 0,
        packed: Number(c.packed) || pack.length,
        restricted: Number(c.restricted) || held.restricted.length,
        future: Number(c.future) || held.future.length,
        unclassified: Number(c.unclassified) || held.unclassified.length,
        superseded: Number(c.superseded) || held.superseded.length,
        truncated: Number(c.truncated) || overBudget.length,
        dropped: Number(c.dropped) || 0,
        truncatedIn: Number(c.truncatedIn) || 0
    };
    return {
        task: MB_TASKS.indexOf(str(g.task)) >= 0 ? str(g.task) : task.task,
        taskLabel: str(g.taskLabel) || MB_TASK_LABEL[str(g.task)] || MB_TASK_LABEL.advance,
        taskGiven: (g.taskGiven === undefined ? task.given : g.taskGiven === true),
        taskKnown: (g.taskKnown === undefined ? task.known : g.taskKnown === true),
        taskWhy: clip(task.why || '', MB_LIMITS.reason),
        facetOrder: arr(g.priority).map((x) => str(x)).filter((x) => MB_FACETS.indexOf(x) >= 0).slice(0, MB_FACETS.length),
        criticalFacets: arr(g.criticalFacets).map((x) => str(x)).filter((x) => MB_FACETS.indexOf(x) >= 0).slice(0, 4),
        pack: pack,
        packIds: pack.map((m) => m.id),
        sheet: sheet,
        gaps: gaps,
        gapsCritical: gapsCritical,
        held: held,
        budget: {
            given: b.given === true,
            perItem: Number(b.perItem) || 0,
            budgetRaw: floorOrNull(b.budgetRaw)
        },
        overBudget: overBudget,
        cost: {
            items: Number(cost.items) || pack.length,
            estChars: Number(cost.estChars) || 0,
            estCharsAll: Number(cost.estCharsAll) || 0,
            estCharsSkipped: Number(cost.estCharsSkipped) || 0
        },
        counts: counts,
        reasons: arr(g.reasons).map((x) => clip(x, MB_LIMITS.reason)).filter(Boolean).slice(0, 12),
        orderIsRank: g.orderIsRank !== false,
        /* ★ 池里有没有材料：**与「包里有几条」是两件事**（池有而包空 ⇒ 去看 held 里是谁） */
        poolHasMaterial: counts.inventory > 0
    };
}
/* ---------------------------------------------------------------
 * 四路读数（全部转上游出口；本件**不重算**任何一格判定）
 *
 * 为什么是四路而不是一路：这四件回答的是**四个不同的问题**，
 *   合成一路就会把「这一幕没有材料」与「材料全被两条闸挡住」读成同一句话 ——
 *   而这两者的处置相反（去补事实 / 去看 held 里被挡住的是谁）。
 *     · pack    —— 这一幕该带哪几样（有序）+ 缺口 + 被挡住的三类（**主读数**）；
 *     · sheet   —— 逐面明细：每一面几条、哪几面空着、空的是不是关键面；
 *     · held    —— 被挡住的三类逐条具名（受限 / 未发生 / 未归面 / 被取代）；
 *     · pick    —— 用户**选定**的那几条：能交的、不在包里的（无从取）、时点之后的（不该取）。
 *   ★ `state` 说的是「这一面读没读到」，`pick` 说的是「用户选的这几条能不能交」
 *     —— 两者**不同层**：压平即把「读不到」显示成「一条都没选」。
 * ------------------------------------------------------------ */
/**
 * 读上游**取材集合**面（R4-X9 的主读数）。
 *   ★ 只挑材料、不落笔：任务轴与面优先级、矛盾取代、两条闸、缺口计数**全归上游**，
 *     本件照搬读数，**不另判一次**（两份实现必然漂移）。
 * @returns {{state,reason,text,ok,degraded,silentCapable,writesNothing,pack[],sheet[],gaps[],held,counts,...}}
 */
export function readMaterialPack(win, opts = {}) {
    const w = resolveWin(win);
    const eng = engineOf(w);
    const o = obj(opts) || {};
    const task = normTask(o.task);
    const engineHas = !!(eng && typeof eng.materialPack === 'function');
    if (!engineHas) {
        /* 模块在场而宿主没装配出口：这不是「没装插件」，是「这一版没把装配点接出来」。 */
        const mod = moduleOf(w);
        if (mod && typeof mod.build === 'function') {
            return faceOf(MB_STATES.UNUSABLE, 'no-deps', {
                task: task.task, taskLabel: MB_TASK_LABEL[task.task],
                taskGiven: task.given, taskKnown: task.known, taskWhy: task.why
            });
        }
        return faceOf(MB_STATES.ENGINE_ABSENT, 'engine-absent', {
            task: task.task, taskLabel: MB_TASK_LABEL[task.task],
            taskGiven: task.given, taskKnown: task.known, taskWhy: task.why
        });
    }
    const callOpts = {};
    /* 调用方直给的材料（可选）与预算（可选）**原样转交**：本件不替调用方改一个字段。 */
    if (Array.isArray(o.materials)) callOpts.materials = o.materials;
    if (o.budget !== undefined && o.budget !== null && o.budget !== '') callOpts.budget = o.budget;
    let got = null;
    try { got = eng.materialPack(task.task, callOpts); }
    catch (_e) {
        return faceOf(MB_STATES.UNUSABLE, 'unusable', {
            task: task.task, taskLabel: MB_TASK_LABEL[task.task],
            taskGiven: task.given, taskKnown: task.known, taskWhy: task.why
        });
    }
    const g = obj(got);
    if (!g) {
        return faceOf(MB_STATES.UNUSABLE, 'unusable', {
            task: task.task, taskLabel: MB_TASK_LABEL[task.task],
            taskGiven: task.given, taskKnown: task.known, taskWhy: task.why
        });
    }
    if (Number(g.version) === 0) {
        return faceOf(MB_STATES.FACE_ABSENT, 'face-absent', {
            task: task.task, taskLabel: MB_TASK_LABEL[task.task],
            taskGiven: task.given, taskKnown: task.known, taskWhy: task.why
        });
    }
    /* ★ 入参畸形与「池空」**不同形**：前者 judged:false（无从选材），后者 judged:true（合法的「这次没有材料」）。
     *   把两者压成同形会让「判不了」被读成「没有」—— 这正是上游 M4-X8 立身之本的第一条。 */
    if (g.judged === false) {
        return faceOf(MB_STATES.UNUSABLE, g.malformedInput === true ? 'malformed' : 'no-deps', {
            task: task.task, taskLabel: MB_TASK_LABEL[task.task],
            taskGiven: task.given, taskKnown: task.known, taskWhy: task.why
        });
    }
    const norm = fromUpstream(g, task);
    const extra = Object.assign({}, norm, { judged: true });
    /* ★ 真读数「无内容」：跑过了、材料池里一条可用材料都没有（**不是**「插件没装」）。 */
    if (!norm.poolHasMaterial) return faceOf(MB_STATES.EMPTY, 'empty', extra);
    return faceOf(MB_STATES.OK, 'ok', extra);
}
/**
 * 读**逐面明细**面（哪一面几条、哪几面空着、空的是不是关键面）。
 *   ★ 与主读数是**同一份上游读数**（不另跑一次、不另算一份）——
 *     两份口径必然漂移，故这里只把同一份读数里的 sheet / gaps 单独端出来。
 */
export function readMaterialPackSheet(win, opts = {}) {
    const read = readMaterialPack(win, opts);
    const rows = read.sheet || [];
    const critical = read.criticalFacets || [];
    const emptyFacets = rows.filter((r) => r.count === 0);
    return {
        state: read.state,
        reason: read.reason,
        task: read.task,
        taskLabel: read.taskLabel,
        facetOrder: read.facetOrder,
        criticalFacets: critical,
        sheet: rows,
        gaps: read.gaps,
        gapsCritical: read.gapsCritical,
        emptyFacets: emptyFacets,
        /** 关键面里空着的（**与普通空面不同层**：这几格该回去补事实） */
        criticalEmpty: emptyFacets.filter((r) => r.critical === true),
        counts: read.counts,
        writesNothing: true
    };
}
/**
 * 读**被挡住的三类 + 被取代**面（逐条具名）。
 *   ★ 「不该带」（受限 / 未发生）与「没轮到」（被取代 / 越预算）**不同格**：
 *     前者要用户去确认边界，后者要用户去调预算或改目标。
 */
export function readMaterialPackHeld(win, opts = {}) {
    const read = readMaterialPack(win, opts);
    const held = read.held || { restricted: [], future: [], unclassified: [], superseded: [] };
    return {
        state: read.state,
        reason: read.reason,
        task: read.task,
        taskLabel: read.taskLabel,
        buckets: MB_HELD.slice(),
        bucketLabels: Object.assign({}, MB_HELD_LABEL),
        held: held,
        /** 三类计数（**分别报**：压成一格就分不出「不该带」与「没轮到」） */
        restrictedCount: held.restricted.length,
        futureCount: held.future.length,
        unclassifiedCount: held.unclassified.length,
        supersededCount: held.superseded.length,
        /** 越预算的有序候补（**不是**被挡住：它只是没轮到） */
        overBudget: read.overBudget,
        budget: read.budget,
        counts: read.counts,
        writesNothing: true
    };
}/**
 * 读**用户选定集合**面（R4-X9 的落点：手机负责取舍与目标选择）。
 *   ★ 本件**不落笔**：它只算「用户选的这几条里，哪些能交、哪些不能交、为什么」，
 *     真正的交接（进主聊天 / 进创作草稿）归既有 owner（注入预算 owner 与草稿 owner）。
 *   ★ 三类**分列**：
 *     · `items`        —— 能交的（在包里、且不在所选时点之后）；
 *     · `notInPack`    —— 用户勾了但**不在本幕的包里**（无从取：它没被选进这一场，不是被禁）；
 *     · `afterAsOf`    —— 在所选时点**之后**（不该取：未发生的事实不许提前进入）。
 *   把后两类压成一句「选不上」会让「它被闸挡住了」与「它还没发生」变成同一句话。
 * @param {object} opts {task, budget, picked:string[], asOf:number|null}
 * @returns {{ok,items[],ids[],count,chars,notInPack[],afterAsOf[],asOf,asOfGiven,state,reason,writesNothing}}
 */
export function readMaterialPackPick(win, opts = {}) {
    const o = obj(opts) || {};
    const read = readMaterialPack(win, o);
    const picked = arr(o.picked).map((x) => str(x)).filter(Boolean);
    const asOf = floorOrNull(o.asOf);
    const byId = {};
    for (const m of (read.pack || [])) byId[m.id] = m;
    const items = [];
    const notInPack = [];
    const afterAsOf = [];
    for (const id of picked) {
        const m = byId[id];
        if (!m) {
            /* 不在包里 —— **不猜它为什么不在**：如实报「无从取」，具体归因去看 held。 */
            notInPack.push({ id: id.slice(0, 120), why: 'not-in-pack' });
            continue;
        }
        /* ★ 时点闸：**本件只分列，不静默丢**（丢一条用户勾的东西比显示出来更危险）。
         *   楼层缺（null）时**不判**在时点之后 —— 没有定位格就没有判据，不编一个。 */
        if (asOf !== null && m.floor !== null && m.floor > asOf) {
            afterAsOf.push({
                id: m.id, facet: m.facet, facetLabel: m.facetLabel,
                title: m.title, floor: m.floor, why: 'after-as-of'
            });
            continue;
        }
        items.push(m);
    }
    let chars = 0;
    for (const m of items) chars += (m.title || '').length + (m.snippet || '').length;
    return {
        ok: read.state === MB_STATES.OK && items.length > 0,
        state: read.state,
        reason: read.reason,
        task: read.task,
        taskLabel: read.taskLabel,
        items: items,
        ids: items.map((m) => m.id),
        count: items.length,
        chars: chars,
        notInPack: notInPack,
        afterAsOf: afterAsOf,
        pickHeld: MB_PICK_HELD.slice(),
        pickHeldLabels: Object.assign({}, MB_PICK_HELD_LABEL),
        asOf: asOf,
        asOfGiven: asOf !== null,
        /** ★ 零写面：选定集合只是读数，交接归既有 owner（本件不落盘、不发布） */
        writesNothing: true
    };
}
/* ---------------------------------------------------------------
 * 四行读数（视图不写第二套文案；每一行都把「几件事」分开说）
 * ------------------------------------------------------------ */
/**
 * 主行：下一幕是哪个任务、池里几条、带上几条、关键面缺几格、被挡住了哪几类。
 *   ★ 四方**分开说**：合并任意两方都会让人误判「这一幕到底带齐了没有」。
 */
export function packLine(read) {
    const r = read || {};
    if (!r || !r.state) return '取材:读数失败（已降级）';
    if (r.state === MB_STATES.ENGINE_ABSENT) return '取材:记忆插件未装（等装插件）';
    if (r.state === MB_STATES.FACE_ABSENT) return '取材:插件在场但这版没有取材面（需 v3.346.0+）';
    if (r.state === MB_STATES.UNUSABLE) return '取材:本机读不出（' + String(r.reason || '') + '）—— 不是「这一幕没有材料」';
    if (r.state === MB_STATES.EMPTY) return '取材:材料池里一条可用材料都没有（不是「插件没装」）';
    const c = r.counts || {};
    const parts = ['下一幕 ' + String(r.taskLabel || r.task || ''), '池 ' + String(c.inventory || 0), '带上 ' + String(c.packed || 0)];
    if (c.truncated) parts.push('越预算 ' + String(c.truncated));
    if ((r.gapsCritical || []).length) parts.push('**关键面缺 ' + String(r.gapsCritical.length) + '**');
    if (c.superseded) parts.push('被取代 ' + String(c.superseded));
    if (c.restricted) parts.push('受限 ' + String(c.restricted));
    if (c.future) parts.push('未发生 ' + String(c.future));
    if (c.unclassified) parts.push('未归面 ' + String(c.unclassified));
    if (r.budget && r.budget.given === false) parts.push('（缺省预算 ' + String(r.budget.perItem) + ' 条）');
    if (c.dropped) parts.push('认不出 ' + String(c.dropped));
    return parts.join(' · ');
}
/** 逐面行：哪几面有、哪几面空着（关键面另点）。 */
export function sheetLine(sheetRead) {
    const s = sheetRead || {};
    if (!s || !s.state) return '逐面:读数失败（已降级）';
    if (s.state !== MB_STATES.OK && s.state !== MB_STATES.EMPTY) {
        return '逐面:本机读不出（' + String(s.reason || '') + '）';
    }
    const rows = s.sheet || [];
    if (!rows.length) return '逐面:这一版没有逐面明细';
    const have = rows.filter((r) => r.count > 0);
    const empty = rows.filter((r) => r.count === 0);
    const parts = ['有材料的面 ' + String(have.length) + '/' + String(rows.length)];
    if (have.length) parts.push(have.map((r) => r.facetLabel + ' ' + String(r.count)).join('、'));
    if (empty.length) parts.push('空面:' + empty.map((r) => r.facetLabel + (r.critical ? '(关键)' : '')).join('、'));
    return parts.join(' · ');
}
/** 被挡住行：三类**分别报**（压成一格就分不出「不该带」与「没轮到」）。 */
export function heldLine(heldRead) {
    const h = heldRead || {};
    if (!h || !h.state) return '被挡住:读数失败（已降级）';
    if (h.state !== MB_STATES.OK && h.state !== MB_STATES.EMPTY) {
        return '被挡住:本机读不出（' + String(h.reason || '') + '）';
    }
    const parts = [
        '受限 ' + String(h.restrictedCount || 0),
        '未发生 ' + String(h.futureCount || 0),
        '未归面 ' + String(h.unclassifiedCount || 0),
        '被取代 ' + String(h.supersededCount || 0)
    ];
    const ob = (h.overBudget || []).length;
    if (ob) parts.push('越预算候补 ' + String(ob));
    if (h.budget && h.budget.given === false) parts.push('（缺省预算 ' + String(h.budget.perItem) + ' 条）');
    return '被挡住: ' + parts.join(' · ');
}
/** 选定行：用户选了几条、能交几条、两类未取各几条（**分开说**）。 */
export function pickLine(pick) {
    const p = pick || {};
    if (!p || !p.state) return '选定:读数失败（已降级）';
    if (p.state !== MB_STATES.OK && p.state !== MB_STATES.EMPTY) {
        return '选定:本机读不出（' + String(p.reason || '') + '）—— 不是「一条都没选」';
    }
    if (!p.count && !(p.notInPack || []).length && !(p.afterAsOf || []).length) {
        return '选定:还没选（选中之后这里报能交几条）';
    }
    const parts = ['能交 ' + String(p.count || 0) + ' 条', '约 ' + String(p.chars || 0) + ' 字'];
    if ((p.notInPack || []).length) parts.push('不在本幕包里 ' + String(p.notInPack.length));
    if ((p.afterAsOf || []).length) parts.push('**时点之后 ' + String(p.afterAsOf.length) + '**');
    if (p.asOfGiven) parts.push('时点 ' + String(p.asOf));
    return '选定: ' + parts.join(' · ');
}
/* ---------------------------------------------------------------
 * 判定词与说明（**只许本件一份**，视图与接线件只转发）
 * ------------------------------------------------------------ */
/** 这一面能不能读（视图据它决定画不画取材板）。 */
export function mbGateOf(read) {
    const r = read || {};
    const state = str(r.state);
    const readable = (state === MB_STATES.OK || state === MB_STATES.EMPTY);
    return {
        state: state || MB_STATES.ENGINE_ABSENT,
        readable: readable,
        /** 只有**真跑过**才敢替沉默作证（读到 / 零材料） */
        silentCapable: r.silentCapable === true,
        hint: MB_STATE_HINT[state] || MB_STATE_HINT['engine-absent'],
        text: str(r.text) || MB_REASONS[str(r.reason)] || ''
    };
}
/** 读数的一句说明（'' = 没有要说的）。 */
export function mbNoteOf(read) {
    const r = read || {};
    const state = str(r.state);
    if (state === MB_STATES.UNUSABLE) {
        return '本机读不出取材面（' + String(r.reason || '') + '）—— 不要把它读成「这一幕没有材料」';
    }
    if (state === MB_STATES.EMPTY) return '取材面真跑过，池里一条可用材料都没有 —— 不是「插件没装」';
    if (state !== MB_STATES.OK) return '';
    const c = r.counts || {};
    if (c.inventory > 0 && !c.packed) {
        return '池里有 ' + String(c.inventory) + ' 条材料，但一条都没进包 —— 去看「被挡住」里是谁（不是「没有材料」）';
    }
    if ((r.gapsCritical || []).length) {
        return '关键面缺 ' + String(r.gapsCritical.length) + ' 格：' + (r.gapsCritical || []).map((g) => g.facetLabel).join('、');
    }
    return '';
}/**
 * 自检：**九条当场自证**（不是数常量 —— 数常量只能证明表在，不能证明**判得对**）。
 *   1 五态**两两不同形**（没装 / 面不在场 / 读不出 / 真跑过零材料 / 读到）；
 *   2 纯只读：导出名里不得有写面前缀，且读数里 `writesNothing` 恒 true；
 *   3 任务四类齐，且面十格齐、四格被挡住、两类未取各自不同形（不另造词表）；
 *   4 **池空与「池有但零进包」不同形**（后者带 held，前者 held 全空）；
 *   5 **两条闸分开计数**（受限与未发生不许压成一格）；
 *   6 **入参畸形与池空不同形**（前者 unusable，后者 empty）；
 *   7 **时点之后的事实不许提前进入**（pick 里如实进 afterAsOf，且**不静默丢**）；
 *   8 「不在包里」与「时点之后」不同形（无从取 ≠ 不该取）；
 *   9 不产百分比 / 置信 / 推荐一族键（深度扫描），且**不许**误禁本面必须搬运的确定性排序键。
 */
export function mbSelfCheck() {
    const problems = [];
    const states = Object.keys(MB_STATES).map((k) => MB_STATES[k]);
    if (new Set(states).size !== 5) problems.push('五态必须五态不同形');
    /* 1 五态两两不同形（逐态比对归因词，不许两态共用一句） */
    const words = states.map((s) => {
        if (s === MB_STATES.ENGINE_ABSENT) return MB_REASONS['engine-absent'];
        if (s === MB_STATES.FACE_ABSENT) return MB_REASONS['face-absent'];
        if (s === MB_STATES.UNUSABLE) return MB_REASONS.unusable;
        if (s === MB_STATES.EMPTY) return MB_REASONS.empty;
        return MB_REASONS.ok;
    });
    if (new Set(words).size !== 5) problems.push('五态的归因词必须五句不同形');
    /* 2 只读面：导出名里不得有写面前缀 */
    const mutating = ['set', 'put', 'write', 'save', 'update', 'delete', 'clear', 'remove', 'commit', 'apply', 'persist', 'store', 'drop', 'erase', 'inject', 'push'];
    const names = ['readMaterialPack', 'readMaterialPackSheet', 'readMaterialPackHeld', 'readMaterialPackPick',
        'packLine', 'sheetLine', 'heldLine', 'pickLine', 'mbGateOf', 'mbNoteOf', 'mbSelfCheck'];
    const bad = names.filter((n) => mutating.some((m) => n.toLowerCase().indexOf(m) === 0));
    if (bad.length) problems.push('只读面：导出名不得以写面前缀开头（' + bad.join(' / ') + '）');
    /* 3 任务四类齐 + 面十格齐 + 四格被挡住 + 两类未取 */
    if (MB_TASKS.length !== 4) problems.push('任务必须四类（穷尽）');
    if (MB_FACETS.length !== 10) problems.push('材料面必须十格（穷尽）');
    const taskLabels = MB_TASKS.map((t) => MB_TASK_LABEL[t]);
    if (taskLabels.some((x) => !x)) problems.push('四类任务各有标签（不现编态名）');
    const facetLabels = MB_FACETS.map((f) => MB_FACET_LABEL[f]);
    if (facetLabels.some((x) => !x)) problems.push('十格材料面各有标签（不现编面名）');
    if (new Set(MB_HELD).size !== 4) problems.push('被挡住必须四格分列');
    if (new Set(MB_PICK_HELD).size !== 2) problems.push('选定未取必须两类分列');
    if (MB_PICK_HELD_LABEL['not-in-pack'] === MB_PICK_HELD_LABEL['after-as-of']) {
        problems.push('「无从取」与「不该取」不许同形');
    }
    /* 5 禁用键清单在场且非空，且**不许**含本面必须搬运的确定性排序键 */
    if (!MB_FORBIDDEN_KEYS.length) problems.push('禁用键清单不许为空（空清单等于不扫）');
    const mustCarry = ['priority', 'rank', 'index'];
    const over = mustCarry.filter((k) => MB_FORBIDDEN_KEYS.indexOf(k) >= 0);
    if (over.length) problems.push('禁用键清单误含本面必须搬运的确定性排序键（' + over.join(' / ') + '）—— 那三样是可解释的顺序，不是评分');
    /* 6 上限齐备且为正 */
    const limKeys = ['pack', 'sheet', 'held', 'gaps', 'superseded', 'title', 'label', 'reason', 'note'];
    const badLim = limKeys.filter((k) => !(Number(MB_LIMITS[k]) > 0));
    if (badLim.length) problems.push('上限必须齐备且为正：' + badLim.join(' / '));
    /* 7 归因词齐备（每个 reason 都有短归因） */
    const reasonKeys = ['ok', 'engine-absent', 'face-absent', 'unusable', 'empty', 'no-deps', 'malformed'];
    const missReason = reasonKeys.filter((k) => !MB_REASONS[k]);
    if (missReason.length) problems.push('归因词缺格：' + missReason.join(' / '));
    /* 8 假宿主真跑：五态分形 + 时点闸 + 池有而包空 */
    const w = fakeHost();
    const r1 = readMaterialPack(w.none, { task: 'meet' });
    if (r1.state !== MB_STATES.ENGINE_ABSENT) problems.push('未装插件必须报 engine-absent（不报「没有材料」）');
    const r2 = readMaterialPack(w.modOnly, { task: 'meet' });
    if (r2.state !== MB_STATES.UNUSABLE || r2.reason !== 'no-deps') problems.push('模块在场而宿主没装配 ⇒ unusable + no-deps');
    const r3 = readMaterialPack(w.faceAbsent, { task: 'meet' });
    if (r3.state !== MB_STATES.FACE_ABSENT) problems.push('上游降级面（version=0）⇒ face-absent');
    const r4 = readMaterialPack(w.empty, { task: 'meet' });
    if (r4.state !== MB_STATES.EMPTY) problems.push('池里零可用材料 ⇒ empty（**不是** engine-absent）');
    const r5 = readMaterialPack(w.ok, { task: 'meet' });
    if (r5.state !== MB_STATES.OK || !r5.pack.length) problems.push('真读数必须读到包');
    if (new Set([r1.state, r2.state, r3.state, r4.state, r5.state]).size !== 5) problems.push('五态必须两两不同形');
    /* 池有而包空 ⇒ 仍是 ok（**不是** empty），且 held 里有人 */
    const r6 = readMaterialPack(w.allHeld, { task: 'meet' });
    if (r6.state !== MB_STATES.OK) problems.push('池有材料但零进包 ⇒ 仍是 ok（不许读成 empty）');
    if (!r6.held.restricted.length || !r6.held.future.length) problems.push('两条闸必须分别具名');
    /* 任务轴真的改变产物：同一池，赴约与重逢的包**不同序**（顺序由上游给，本件如实搬运） */
    const rMeet = readMaterialPack(w.taskAxis, { task: 'meet' });
    const rReunion = readMaterialPack(w.taskAxis, { task: 'reunion' });
    if (rMeet.packIds.join(',') === rReunion.packIds.join(',')) problems.push('任务轴必须真的改变产物（赴约与重逢不同序）');
    /* 时点闸：选定时点之后的事实进 afterAsOf，**不许静默丢**；
     *   勾一个**不在包里**的 id ⇒ 必须进 notInPack（无从取 ≠ 不该取，两类不许同形）。 */
    const p1 = readMaterialPackPick(w.ok, { task: 'meet', picked: ['m1', 'm2', 'm3', 'mZ'], asOf: 5 });
    if (!p1.afterAsOf.length) problems.push('时点之后的事实必须进 afterAsOf（不许提前进入）');
    if (p1.ids.indexOf('m3') >= 0) problems.push('时点之后的材料不许出现在能交的清单里');
    if (!p1.notInPack.length) problems.push('勾了但不在包里的必须进 notInPack（无从取 ≠ 不该取）');
    if (p1.writesNothing !== true) problems.push('选定集合只是读数：writesNothing 必须恒 true');
    const p2 = readMaterialPackPick(w.ok, { task: 'meet', picked: [], asOf: null });
    if (p2.count !== 0 || p2.afterAsOf.length) problems.push('没选任何东西时不许凭空产出选定集合');
    /* 9 不产百分比：读数里不得出现 percent / confidence / score / 推荐一族键 */
    if (hasForbiddenKey(r5)) problems.push('读数里出现禁用键（推荐 / 评分 / 置信一族）');
    if (r5.writesNothing !== true || r5.devisesNothing !== true) problems.push('零写面与不代写未发生剧情必须写成读数');
    /* 归因：五态各自的 silentCapable 只许在真跑过的两态为真 */
    if (!r4.silentCapable || !r5.silentCapable) problems.push('只有真跑过（读到 / 零材料）才可替沉默作证');
    if (r1.silentCapable || r2.silentCapable || r3.silentCapable) problems.push('没跑过的态不许替沉默作证');
    return { problems: problems };
}
/** 深度扫描读数键：出现推荐 / 评分 / 置信一族即不通过（与 M4-X5 / X6 / X7 / X8 同口径）。 */
export function hasForbiddenKey(o, depth) {
    const d = depth || 0;
    if (d > 6 || !o || typeof o !== 'object') return false;
    if (Array.isArray(o)) {
        for (const it of o) if (hasForbiddenKey(it, d + 1)) return true;
        return false;
    }
    for (const k of Object.keys(o)) {
        const low = String(k).toLowerCase();
        for (const bad of MB_FORBIDDEN_KEYS) if (low.indexOf(bad) >= 0) return true;
        if (hasForbiddenKey(o[k], d + 1)) return true;
    }
    return false;
}/**
 * 假宿主（自检用）：**不 import 上游**，只按上游契约形状造六个窗口。
 *   为什么自检里也要真跑：数常量只能证明表在，不能证明**判得对**。
 */
function fakeHost() {
    /* ★ 假宿主必须按**真取法**造：`engineOf` 读的是 `win.LonShaMemory.engine`
     *   —— 少一层包装，整组自检就会在「未装插件」那一态上全绿（假绿）。 */
    const mkEngine = (fn) => ({ LonShaMemory: { engine: { materialPack: fn } } });
    const okOut = () => ({
        kind: 'material_pack', version: 1, judged: true,
        task: 'meet', taskLabel: '赴约', taskGiven: true, taskKnown: true,
        priority: MB_FACETS.slice(), criticalFacets: ['appointment', 'place', 'participants'],
        pack: [
            { id: 'm1', facet: 'appointment', title: '周三的约', floor: 5, source: 'promise', order: 1, facetRank: 0, usable: true },
            { id: 'm2', facet: 'place', title: '老码头', floor: 4, source: 'scene-book', order: 2, facetRank: 1, usable: true },
            { id: 'm3', facet: 'participants', title: '阿岚到场', floor: 9, source: 'relation', order: 3, facetRank: 2, usable: true }
        ],
        packIds: ['m1', 'm2', 'm3'],
        sheet: MB_FACETS.map((f, i) => ({ facet: f, facetLabel: MB_FACET_LABEL[f], count: i < 3 ? 1 : 0, critical: i < 3, ids: [] })),
        gaps: MB_FACETS.slice(3).map((f) => ({ facet: f, facetLabel: MB_FACET_LABEL[f], critical: false })),
        gapsCritical: [],
        superseded: [], held: { restricted: [], future: [], superseded: [], unclassified: [] },
        budget: { given: false, perItem: 9 }, overBudget: [],
        cost: { items: 3, estChars: 30, estCharsAll: 30, estCharsSkipped: 0 },
        counts: { inventory: 3, usable: 3, packed: 3, restricted: 0, future: 0, unclassified: 0, superseded: 0, truncated: 0, dropped: 0, truncatedIn: 0 },
        reasons: [], orderIsRank: true, writesNothing: true
    });
    const emptyOut = () => Object.assign(okOut(), {
        pack: [], packIds: [],
        counts: { inventory: 0, usable: 0, packed: 0, restricted: 0, future: 0, unclassified: 0, superseded: 0, truncated: 0, dropped: 0, truncatedIn: 0 }
    });
    const allHeldOut = () => Object.assign(okOut(), {
        pack: [], packIds: [],
        held: {
            restricted: [{ id: 'h1', facet: 'place', title: '他不该知道的地方', why: 'restricted' }],
            future: [{ id: 'h2', facet: 'place', title: '打算去的地方', why: 'future' }],
            superseded: [], unclassified: []
        },
        counts: { inventory: 2, usable: 0, packed: 0, restricted: 1, future: 1, unclassified: 0, superseded: 0, truncated: 0, dropped: 0, truncatedIn: 0 }
    });
    /* 任务轴窗口：同一池，两种任务的**包内顺序不同**（上游按各自 TASK_PRIORITY 排）。 */
    const taskAxisOut = (task) => Object.assign(okOut(), {
        task: task, taskLabel: MB_TASK_LABEL[task],
        pack: (task === 'reunion'
            ? [{ id: 'm3', facet: 'relation', title: '和解了', floor: 4, source: 'relation', order: 1, facetRank: 0, usable: true },
               { id: 'm1', facet: 'appointment', title: '周三的约', floor: 5, source: 'promise', order: 2, facetRank: 6, usable: true }]
            : [{ id: 'm1', facet: 'appointment', title: '周三的约', floor: 5, source: 'promise', order: 1, facetRank: 0, usable: true },
               { id: 'm3', facet: 'relation', title: '和解了', floor: 4, source: 'relation', order: 2, facetRank: 5, usable: true }]),
        packIds: (task === 'reunion' ? ['m3', 'm1'] : ['m1', 'm3'])
    });
    return {
        none: {},
        modOnly: { LonShaMaterialPack: { build: function () { return {}; } } },
        faceAbsent: mkEngine(function () { return { kind: 'material_pack', version: 0, judged: false }; }),
        empty: mkEngine(function () { return emptyOut(); }),
        ok: mkEngine(function () { return okOut(); }),
        allHeld: mkEngine(function () { return allHeldOut(); }),
        taskAxis: mkEngine(function (task) { return taskAxisOut(task); })
    };
}
export default {
    MB_FACE_ID,
    MB_STATES,
    MB_REASONS,
    MB_STATE_HINT,
    MB_TASKS,
    MB_TASK_LABEL,
    MB_FACETS,
    MB_FACET_LABEL,
    MB_HELD,
    MB_HELD_LABEL,
    MB_SOURCES,
    MB_PICK_HELD,
    MB_PICK_HELD_LABEL,
    MB_FORBIDDEN_KEYS,
    MB_LIMITS,
    readMaterialPack,
    readMaterialPackSheet,
    readMaterialPackHeld,
    readMaterialPackPick,
    packLine,
    sheetLine,
    heldLine,
    pickLine,
    mbGateOf,
    mbNoteOf,
    mbSelfCheck,
    hasForbiddenKey
};