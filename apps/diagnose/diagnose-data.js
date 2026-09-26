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
import { validateSourceKey, auditSourceKeys, sourceKeyRulebook } from '../../config/source-key-rules.js';
/* [v3.0.0] 上游投影契约（L-F5 的消费侧）：把记忆插件 v3.212.0 新外供的投影 envelope
 *   读成手机端可看的面。接在这里的理由：本仓一切「上游读数」的可见出口就是诊断中心，
 *   而投影此前**全库零消费**——出口做出来了，下游没人读，等于白做（本仓六次欠债的同形）。 */
import { readProjection, projectionValue, projectionLine } from '../../config/projection-contract.js';
/* [v3.0.2] R2-C 上游注入读数的消费侧单一真源（Gate R2-A/R2-B 的外供面）。
 *   接在这里的理由与本仓一切「上游读数」的可见出口相同：投影接诊断、探针自述接诊断，
 *   注入面同族 —— 而它此前**全库零消费**（上游 v3.215.0 做出来，下游没人读）。 */
import { readInjection, injectionLine, injectionVerdictText, outcomeText, blockLine } from '../../config/injection-contract.js';
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
import { storyClock, storyClockLine } from '../../config/story-clock.js';

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
     *   日历取数走注入式只读探针（本内核不 import 任何 App）：宿主没提供该面就如实
     *   报 `source-missing` —— 那是「这一层没给」，不是「读不到」。 */
    const clockSc = (() => {
        const calendarSource = () => {
            try {
                const app = w && w.VirtualPhone ? w.VirtualPhone.calendarApp : null;
                const s = (app && typeof app.currentStoryDate === 'function') ? app.currentStoryDate() : null;
                if (!s) return null;
                return (typeof s === 'string') ? { date: s, label: s, source: 'calendar' } : (s && typeof s === 'object' ? s : null);
            } catch (_e) { return null; }
        };
        try { return storyClock({ win: w, calendarSource }); }
        catch (_e) { return storyClock({}); }
    })();

    return { at, snapshotAt, bridges, bridgeReport: report, probeSelf, fields, backStack, sourceKeys, rulebook, audit, projection, projItems, injection, injBlocks, obsNotes, storageFace, evidence, freshness, knowledge, storyClock: clockSc };
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
    injectionVerdictText,
    blockLine,
    summarizeDiagnose
};
