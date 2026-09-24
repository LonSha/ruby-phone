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
    faceFieldState
} from '../../config/world-bridge.js';
import { backGuardReport } from '../../config/back-guard.js';
import { validateSourceKey, auditSourceKeys, sourceKeyRulebook } from '../../config/source-key-rules.js';
/* [v3.0.0] 上游投影契约（L-F5 的消费侧）：把记忆插件 v3.212.0 新外供的投影 envelope
 *   读成手机端可看的面。接在这里的理由：本仓一切「上游读数」的可见出口就是诊断中心，
 *   而投影此前**全库零消费**——出口做出来了，下游没人读，等于白做（本仓六次欠债的同形）。 */
import { readProjection, projectionValue, projectionLine } from '../../config/projection-contract.js';

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
export function collectDiagnose(win) {
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

    return { at, bridges, bridgeReport: report, fields, backStack, sourceKeys, rulebook, audit, projection, projItems };
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
    if (Number(p.backStack && p.backStack.dropped) > 0) bad.push('返回栈压入被拒 ' + p.backStack.dropped + ' 次');
    if (p.audit && Array.isArray(p.audit.bad) && p.audit.bad.length) bad.push('源键规则违规 ' + p.audit.bad.length + ' 处');
    if (bad.length) return '需注意：' + bad.join(' · ');
    const ok = [];
    if (rep.anyReadable) ok.push('至少一台上游桥可读');
    ok.push('源键规则零违规');
    return '正常：' + ok.join(' · ');
}

export default {
    CONSUMED_FIELDS,
    SOURCE_KEY_SITES,
    collectDiagnose,
    fieldReasonText,
    bridgeReasonText,
    projAbsentText,
    summarizeDiagnose
};
