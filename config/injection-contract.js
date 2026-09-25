/* ========================================================
 * injection-contract.js — [v3.0.2] 上游注入读数（R2-A/R2-B）的消费侧单一真源
 *
 * 【这一版治的欠债（本仓第七次「建好不消费」的翻版）】
 *   上游记忆插件 v3.215.0（Gate R2-A）把「AI 这一轮实际看到了什么」做成读数：
 *   快照新增 `injection` 字段（9 键恒定：origin / round / ts / tokens / chars / html /
 *   total / kept / blocks，逐块 6 键 ref / id / label / kept / chars / reason）；
 *   v3.216.0（Gate R2-B）又把**落地时机**收紧到代际确认之后（轮次号只由提交推进、
 *   过期载荷不许被下一轮捡起）。而本仓实测：`snapshot.injection` **全库零消费** ——
 *   下游看不出一轮生成里「AI 到底收到几块」，也看不出「哪几块被预算裁掉了」。
 *
 * 【为什么下游要自己再判一次「零块」的两义（本 Gate 的核心，不是洁癖）】
 *   上游 R2-A 已做到的第一层分态：「跑过、真的 0 块」与「还没跑过」不是一回事
 *   （前者 `round >= 1`；后者 `buildInjectionReadout()` 返回 null、自述 kind='null'）。
 *   但**「0 块」内部还有第二层两义**，而上游只给数据、不给裁定：
 *     · 候选本身就是 0 块（`total === 0`）—— 召回没给出任何可用素材；
 *     · 候选有 N 块、**全被预算裁掉**（`total > 0 && kept === 0`）—— 素材有，是预算关了门。
 *   两者处置方向相反（前者查召回键 / 上游编辑 / 键漂移，后者调 `injectionBudget`
 *   或看预算策略），压成一态正是本仓反复点名的错读数形态。
 *   上游逐块读数里的 `reason`（`kept` / `dropped-budget`）恰好够下游把它判开 ——
 *   这就是「消费侧接入」的真价值：不是把数字搬过来，而是把上游已给、
 *   但**没人读**的那层分态读出来。
 *
 * 【为什么取快照经 config/world-bridge.js 的统一探针（不在这里自己摸桥全局）】
 *   第九道门（scripts/bridge-contract-audit.mjs）的 J1/J4：桥名字面量只允许出现在真源里；
 *   「自写形态判据」是 8 份重复实现的种子（clock / ledger 那两份照早期规格抄成了
 *   「把推送型对象当函数调」，TypeError 被 catch 吞掉 ⇒ 永久显示「桥在但没快照」）。
 *   故取快照一律经 `readPushProbe()`，形态判定只写那一眼。
 *
 * 【三条纪律（与 config/world-bridge.js / config/projection-contract.js 同规格）】
 *   ① 只读：只读快照字段，绝不写上游任何状态；
 *   ② 不抛：桥未装 / 无快照 / 旧版无注入面 / 读数畸形，一律降级为归因；
 *   ③ 不猜：「没这面」「没跑过」「跑了但候选空」「跑了但全被裁」四者**必须分开报**；
 *      判不开的一律 null，不给冒充值。
 *
 * 【[v3.0.3] R2-E：接上游 v3.218.0 的 `outcome`】
 *   上游修前「被中止」与「正常完成」同形（`GENERATION_ENDED` 只复位一个标志），
 *   v3.218.0 给读数加了结局并为它立了三态。下游按**跨仓纪律**同轮接上：
 *   读出面增 `outcome` / `outcomeAt` / `faceDrift`，并把结局写进总述与诊断坏消息首行 ——
 *   「被中止」是用户真正需要立刻知道的（回复没出稿，该重发），
 *   而「已完成」不是坏消息（不占首行）。
 *
 * 【为什么不提供 export default】
 *   本文件与 config/projection-contract.js 并列，但**不**跟着加 `export default`：
 *   本面没有 default 形态的产品侧消费者（同仓 dead-export 门禁的 E11 专门对 default 面
 *   的消费通道对账，加一个没有消费者的 default 面等于凭空欠一条账目）。
 * ======================================================== */
'use strict';

import { readPushProbe } from './world-bridge.js';

/* 【跨仓契约快照】上游 `injection` 面的**顶层键**（v3.218.0 起 10 键）。
 *   为什么在下游有意重复一份：跨仓不能 import（上游是酒馆插件、本仓是扩展），
 *   消费者必须能**独立判**「我认不认得这份结构」。上游改字段 ⇒ 本仓据此现形，
 *   而不是把新字段读成 undefined 当成「没有这项」（与 config/projection-contract.js
 *   的 ENVELOPE_FIELDS 同动机）。
 *   v3.215.0（R2-A）9 键；v3.218.0（R2-E）追加 `outcome` —— 中止与完成必须可分。 */
const INJECTION_FACE_KEYS = Object.freeze([
    'origin', 'outcome', 'round', 'ts', 'tokens', 'chars', 'html', 'total', 'kept', 'blocks'
]);

/**
 * 面级归因（**五态**，处置方向互不相同；这是本模块的对外裁定面之一）。
 * 刻意**不导出**：文案的唯一出口是 `injectionStateText()`，
 * 免得第二个消费方拿这张表去自己拼结论。
 */
const INJECTION_REASONS = Object.freeze({
    'ready': '注入读数就绪（上游已外供本轮的最终实际注入）',
    'bridge-absent': '记忆插件未安装',
    'no-snapshot': '桥在，但还没产出过快照',
    'no-injection-face': '这版快照没有注入面（需记忆插件 v3.215+）',
    'never-run': '尚未真生成过（**不是**「注入了 0 块」）'
});

/**
 * 读数裁定（**三态**，只在 reason='ready' 时非 null）。
 * 「零块」的两义在这里判开 —— 上游给数据，下游给裁定，方向不可互换。
 */
const INJECTION_VERDICTS = Object.freeze({
    'injected': '有块进入了上下文',
    'candidates-empty': '真生成跑了，但**读到 0 块候选**（召回没给出可用素材）',
    'all-dropped': '真生成跑了，候选**全部**被预算裁掉（0 块进入上下文）'
});

/**
 * 读数的**结局**三态（[v3.0.3] 接入上游 v3.218.0 的 `outcome`）。
 *
 *   为什么必须单独成面：上游修前**中止与完成同形**（`GENERATION_ENDED` 只复位一个标志），
 *   于是下游只能看到「最近一次实际注入」而读不出「这一轮到底有没有出稿」——
 *   而两者处置相反：**被中止 ⇒ 该重发；已完成 ⇒ 该看回复**。
 *   压成一态正是本仓反复点名的错读数形态，故下游把它做成独立一格并进坏消息首行。
 */
const OUTCOME_TEXT = Object.freeze({
    'completed': '已完成（回复已落层）',
    'aborted': '被中止（本轮无回复，可重发）',
    'pending': '结局未定（生成进行中，或宿主未发结束事件）'
});

/** 逐块读数的两态（上游 `reason` 的两个取值；未知取值如实输出原值，不静默兜底） */
const BLOCK_REASONS = Object.freeze({
    'kept': '进了上下文',
    'dropped-budget': '被预算裁掉'
});

function isPlainObject(v) {
    return !!v && typeof v === 'object' && !Array.isArray(v);
}

/**
 * 数值归一：**null / undefined / 空串 / 非数值一律 null**。
 *
 * 与 config/projection-contract.js 的 `numOrNull` 同因同法（那条教训在本仓是 v3.0.0
 * 由套件当场捐到的真缺陷）：`Number.isFinite(Number(x))` 会把上游**没给**的
 * `round` / `ts` / `tokens`（null）如实报成 **0**，而这些 0 全是合法值 ——
 * `round` 0 表示有效注入 0 次、`ts` 0 表示 1970（于是 `ageMs` 会被算成一个荒唐的大数）。
 * 「没给」与「给了 0」塌成同形，正是本仓最贵的那一类错读数。
 */
function numOrNull(v) {
    if (typeof v !== 'number' && typeof v !== 'string') return null;
    if (typeof v === 'string' && !v.trim()) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
}

/**
 * 逐块读数归一（**上游读数 → 本仓可读面**，键面恒定 7 项）。
 *
 * 纯函数、不抛；输入畸形一律返回 `[]`（不返回半成品 —— 半成品会让视图渲染出
 * 一格「有块」但每列都是空的，与「真的没有块」同形）。
 *
 * @param {*} src 上游 `injection` 读数对象（或本模块已归一的面，二者都从 `.blocks` 取）
 * @returns {Array<{ref:string,id:number,label:string,kept:boolean,chars:number,reason:string,dropped:boolean}>}
 */
export function injectionBlocksOf(src) {
    try {
        const list = (src && Array.isArray(src.blocks)) ? src.blocks : [];
        const out = [];
        for (let i = 0; i < list.length; i++) {
            const b = list[i];
            if (!isPlainObject(b)) continue;
            const kept = b.kept === true;
            const idn = numOrNull(b.id);
            out.push({
                ref: String(b.ref || ''),
                id: (idn === null) ? i : idn,
                label: String(b.label || ''),
                kept,
                chars: numOrNull(b.chars) || 0,
                reason: String(b.reason || ''),
                // 派生一格，仅供 UI 分色：**判据仍是 `kept` 本身**，这里不替代它。
                dropped: !kept
            });
        }
        return out;
    } catch (_e) { return []; }
}

/** 逐块归因文案（未知原因如实输出原值 —— 静默兜底成「未知」会把两种处境说成同一句话） */
export function blockReasonText(reason) {
    return BLOCK_REASONS[reason] || String(reason || '未知');
}

/** 面级归因文案（未知原因如实输出原值） */
export function injectionStateText(reason) {
    return INJECTION_REASONS[reason] || String(reason || '未知');
}

/** 裁定文案（未知裁定如实输出原值） */
export function injectionVerdictText(verdict) {
    return INJECTION_VERDICTS[verdict] || String(verdict || '未知');
}

/**
 * 结局文案（未知结局**如实输出原值**）。
 *   刻意不把未知值兜底成 'pending'：那会把「上游给了个没见过的结局」伪装成
 *   「正常的进行中」，让本仓失去发现上游契约变更的能力。
 */
export function outcomeText(outcome) {
    return OUTCOME_TEXT[outcome] || String(outcome || '未知');
}

/** 【跨仓契约快照】只读一份副本（测试据此钉住上游键面；改上游键此值必须同步） */
export function injectionFaceKeys() {
    return INJECTION_FACE_KEYS.slice();
}

/**
 * 读上游注入读数（本仓一切注入面消费的唯一入口）。
 *
 * @param {object} [win] 显式注入 window（无头测试用；不传取全局）
 * @param {object} [opts] { now?:number, snapshot?:object }
 *   now      —— `ageMs` 的基准（不传取 Date.now()，注入以便可测）
 *   snapshot —— 调用方**已有**的快照（避免二次取桥；不传则自己经 readPushProbe 取）
 * @returns {object} 结构恒定（缺字段一律给空形，消费方不必判 undefined）
 */
export function readInjection(win, opts = {}) {
    const empty = {
        state: 'absent',
        reason: 'bridge-absent',
        mounted: false,
        hasSnapshot: false,
        present: false,
        declaredAbsent: null,
        declaredPresent: null,
        declaredKind: null,
        strayOrigin: false,
        origin: null,
        /* [v3.0.3] R2-E：结局面（上游 v3.218.0 起外供）。未就绪时如实 null，
         *   不预填 'pending' —— 那会把「没读到这一格」伪装成「正在进行中」。 */
        outcome: null,
        outcomeAt: null,
        faceDrift: [],
        round: null,
        ts: null,
        ageMs: null,
        tokens: null,
        chars: null,
        html: '',
        total: null,
        kept: null,
        dropped: null,
        verdict: null,
        blocks: [],
        text: INJECTION_REASONS['bridge-absent']
    };
    try {
        const w = win || ((typeof window !== 'undefined') ? window : null);
        let snap = isPlainObject(opts.snapshot) ? opts.snapshot : null;
        let mounted = false;
        let hasSnapshot = false;
        if (!snap) {
            const probe = readPushProbe(w);
            mounted = probe.mounted === true;
            hasSnapshot = probe.hasSnapshot === true;
            if (!mounted) return empty;
            snap = isPlainObject(probe.snapshot) ? probe.snapshot : null;
        } else {
            mounted = true;
            hasSnapshot = true;
        }
        if (!snap) {
            return { ...empty, mounted, hasSnapshot: false, reason: 'no-snapshot', text: INJECTION_REASONS['no-snapshot'] };
        }
        /* 「源里没这项」与「给了这项、值是 null」必须可分（上游 v3.174 起有 meta.fieldTypes）。
         *   这两态在注入面上恰好对应两件处置方向完全不同的事：
         *     present=false        ⇒ 本版宿主没有注入读取面（等上游升级）；
         *     present=true + null  ⇒ 面在、但一次真生成都没跑过（等生成跑一轮）。
         *   第三态（旧版桥无 fieldTypes、值又是 undefined）**无从分辨**，如实按「没这面」报
         *   并置 declaredAbsent=false，不硬猜成任何一边。 */
        let declaredPresent = null;
        let declaredKind = null;
        try {
            const ft = (snap.meta && isPlainObject(snap.meta.fieldTypes)) ? snap.meta.fieldTypes.injection : null;
            if (isPlainObject(ft) && typeof ft.present === 'boolean') {
                declaredPresent = ft.present;
                declaredKind = String(ft.kind || '');
            }
        } catch (_e) { declaredPresent = null; }
        const raw = snap.injection;
        if (raw === undefined || raw === null) {
            /* 裁定规则（三段，全部可判而不猜）：
             *   · fieldTypes 明说 present=false ⇒ 这版宿主没这面；
             *   · fieldTypes 明说 present=true（kind='null'）⇒ 面在、值空 ⇒ **还没真生成过**；
             *   · 没有 fieldTypes 自述（旧版桥，或这份快照不自述）⇒ 无从分辨，
             *     按**较保守**的一边报「没这面」并置 declaredAbsent=false，不硬猜成「没跑过」。
             *   为什么保守边选「没这面」：把它误报成「没跑过」会让用户白等一轮生成；
             *   而误报成「没这面」只会让他去核对插件版本 —— 后者的错代价小且可自证。 */
            const faceAbsent = (declaredPresent !== true);
            const reason = faceAbsent ? 'no-injection-face' : 'never-run';
            return {
                ...empty,
                mounted, hasSnapshot: true, present: false,
                declaredAbsent: faceAbsent,
                declaredPresent,
                declaredKind,
                state: faceAbsent ? 'absent' : 'never-run',
                reason,
                text: INJECTION_REASONS[reason]
            };
        }
        if (!isPlainObject(raw)) {
            // 面在、但形状读不懂：如实报畸形，不按「就绪」处理也不按「没跑过」处理。
            return {
                ...empty,
                mounted, hasSnapshot: true, present: true, declaredPresent, declaredKind,
                state: 'unusable', reason: 'no-injection-face',
                text: '注入面结构畸形（不是对象）—— 本机读不懂，请升级手机端或核对上游'
            };
        }
        const blocks = injectionBlocksOf(raw);
        const total = numOrNull(raw.total);
        const keptRaw = numOrNull(raw.kept);
        const kept = (keptRaw === null) ? blocks.filter(b => b.kept).length : keptRaw;
        const totalEff = (total === null) ? blocks.length : total;
        /* 裁定：**只做能从上游数据判开的那三种**。
         *   判据顺序刻意为「先 kept、再 total」：kept > 0 是「真有块进了上下文」，
         *   它比任何计数都硬（同 config/projection-contract.js 的「有值总是最强证据」）。 */
        let verdict;
        if (kept > 0) verdict = 'injected';
        else if (totalEff > 0) verdict = 'all-dropped';
        else verdict = 'candidates-empty';
        const ts = numOrNull(raw.ts);
        const injected = numOrNull(opts.now);
        const now = (injected === null) ? Date.now() : injected;
        const origin = String(raw.origin || '');
        return {
            state: 'ready',
            reason: 'ready',
            mounted: true,
            hasSnapshot: true,
            present: true,
            declaredAbsent: false,
            declaredPresent: true,
            declaredKind,
            /* 归属复核（消费侧独立再判一次，不因为上游说了就信）：
             *   上游 R2-A 把诊断读数搬去了 `_diagnostics.dryRun`，故经快照外供的读数
             *   `origin` **只该是** `'generation'`。这一格一旦非 generation，说明上游归属又塌陷了
             *   （诊断路径写回了「AI 真实所见」）—— 必须在下游现形，而不是当成正常读数用。 */
            strayOrigin: !!(origin && origin !== 'generation'),
            origin: origin || null,
            /* [v3.0.3] R2-E：结局面。缺 `outcome`（旧版上游，v3.217 及以前）⇒ 如实 null
             *   并计入 `faceDrift` —— 「这版上游没这格」与「这格是空的」必须分开，
             *   前者等升级、后者等生成跑完，处置相反。 */
            outcome: (typeof raw.outcome === 'string' && raw.outcome) ? raw.outcome : null,
            outcomeAt: numOrNull(raw.outcomeAt),
            faceDrift: INJECTION_FACE_KEYS.filter((k) => !Object.prototype.hasOwnProperty.call(raw, k)),
            round: numOrNull(raw.round),
            ts,
            ageMs: (ts === null) ? null : (now - ts),
            tokens: numOrNull(raw.tokens),
            chars: numOrNull(raw.chars),
            html: String(raw.html == null ? '' : raw.html),
            total: totalEff,
            kept,
            dropped: Math.max(0, totalEff - kept),
            verdict,
            blocks,
            text: INJECTION_REASONS['ready']
        };
    } catch (_e) {
        return { ...empty, reason: 'bridge-absent', text: '注入读数异常（已降级，不外抛）' };
    }
}

/**
 * 一句话总述（供 UI 头部 / 诊断总述 / 宿主通知）。
 *
 * **四类处境四句话，且互不相同** —— 这是本模块存在的理由本身：
 *   · 没这面（等上游升级）  · 没跑过（等生成跑一轮）
 *   · 跑了但候选空（查召回） · 跑了但全被裁（查预算）
 * 把它们压成任何两句相同的话，这一面就白做了。
 */
export function injectionLine(inj) {
    const p = inj || {};
    if (p.reason !== 'ready') return injectionStateText(p.reason);
    const round = (p.round === null) ? '?' : p.round;
    const parts = ['第 ' + round + ' 轮真生成'];
    if (p.verdict === 'injected') {
        parts.push('实际注入 ' + p.kept + ' 块（候选 ' + p.total + ' · 裁掉 ' + p.dropped + '）');
    } else if (p.verdict === 'all-dropped') {
        parts.push('候选 ' + p.total + ' 块**全部被预算裁掉**：0 块进入上下文');
    } else if (p.verdict === 'candidates-empty') {
        parts.push('**读到 0 块候选**：召回没给出可用素材（0 块进入上下文）');
    } else {
        parts.push('读数不完整（kept / total 均读不出）');
    }
    if (p.chars !== null) parts.push(p.chars + ' 字符');
    if (p.tokens !== null) parts.push('约 ' + p.tokens + ' token');
    /* [v3.0.3] R2-E：结局必须进总述 —— 「被中止（本轮无回复，可重发）」与
     *   「已完成（回复已落层）」处置相反，不写出来用户就要自己去别处推断。 */
    if (p.outcome) parts.push('结局：' + outcomeText(p.outcome));
    else parts.push('结局：未提供（上游这版还没外供 outcome）');
    if (p.strayOrigin) parts.push('【注意】该读数不是真生成写的（origin=' + String(p.origin) + '）');
    return parts.join(' · ');
}

/** 逐块一行（供诊断/视图直接显示；未知原因如实输出原值） */
export function blockLine(b) {
    const x = b || {};
    const head = x.label ? String(x.label) : (x.ref ? String(x.ref) : '（无标签）');
    return head + ' · ' + (x.chars || 0) + ' 字符 · ' + blockReasonText(x.reason);
}
