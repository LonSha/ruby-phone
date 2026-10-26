/* ========================================================
 * config/completion-claim-gate.js — 完成断言门（纯函数）[v4.88.0 · 第七批缝入]
 * --------------------------------------------------------
 * 【这一刀治的是什么】
 *   角色/助手在正文里写「我已经帮你把日程改好了」「测试已经全部通过」——
 *   而这一轮其实**只是提议**、工具根本没执行、或者执行失败了。
 *   本仓修前没有任何一层拿回执去核对正文：正文自己说了算。
 *   症状是用户按「已改好」去查，发现根本没动；而正文的措辞与真结果一模一样，
 *   连「看起来像在推进」这件事都是伪的。
 *
 * 【源形态（非描述，按源码判定）】
 *   JasonLiu0826/ackem · src/main/channel/outputGuard.ts
 *     · COMPLETION 正则只认「(我|我们|已|已经|成功) + 完成的动词」；
 *     · 逐句过筛，**先排除**：代码围栏内、引用行（`>`）、条件/假设/标准句；
 *     · 断言句还要按 claim 分域找证据（文件 / 测试 / 部署 / 记忆），
 *       对应域没有回执字段 ⇒ 换成 SAFE_STATUS 里的中性句；
 *     · SAFE_STATUS 是 8 态固定表，未执行 / 排队 / 在跑 / 等权限 / 成功 /
 *       失败 / 中止 / 未知，各一句「以什么为准」。
 *
 * 【本仓差异与后果（照抄会坏的地方）】
 *   · 源把「success + receipt + runId」三者齐备当唯一放行条件；本仓回执分域字段名
 *     不同（write-receipt / action-receipt 用的是 path / target / 域键），
 *     故此处证据域由 CLAIM_DOMAINS 显式声明，**不硬编码字段名**，由调用方传 probe。
 *   · 源只处理英文键；本仓正文是中文，「已经」与「已完成」的粒度都更细，
 *     条件句标记必须扩充（需要 / 应当 / 如果 / 除非 / 才能 / 待……），
 *     否则会把「应该已经改好了」误判成断言。
 *   · 源在 fenced 上用可变 state 跨句传递 —— 本模块保持同形（围栏必须能跨句配对），
 *     故 createScanState() 由调用方持有，一次扫描一个实例，**不得跨消息复用**。
 *
 * 【纪律】
 *   ① 纯函数：不读存储、不碰 DOM、不取回执（回执由调用方经 probe 传进来）；
 *   ② 不抛：任何结构畸形按「没有证据」处理，绝不因门自己坏掉而吞掉正文；
 *   ③ 不猜：判不出来时用中性句，而不是判「在撒谎」——被换掉的句子仍保留原意指向；
 *   ④ 三态互不同形：`asserted`（说了完成）/ `evidenced`（有证据放行）/
 *      `demoted`（被降级成中性句）必须分得开，压成一态就没有诊断价值。
 * ======================================================== */
'use strict';

/** 回执覆盖的断言域。顺序即检查顺序，也是对外契约的一部分。 */
export const CLAIM_DOMAINS = Object.freeze([
    'file',      // 写文件 / 建目录 / 备份
    'test',      // 跑测试 / 验证
    'deploy',    // 部署 / 发布
    'memory',    // 记住 / 长期记忆落库
    'calendar',  // 改期 / 建日程
    'message'    // 已发出 / 已通知
]);

/** 8 态中性替代句。成功态那句刻意写「以回执为准」而不是「成功」：门只核对证据，不担保结果。 */
export const SAFE_STATUS_LINE = Object.freeze({
    not_executed: '这项操作尚未执行。',
    queued: '任务已排队，尚未完成。',
    running: '任务正在处理，完成后会交付结果。',
    waiting_permission: '任务正在等待权限或必要信息。',
    succeeded: '执行结果需以对应回执为准。',
    failed: '这项操作执行失败。',
    aborted: '这项操作已停止。',
    unknown: '目前无法确认这项操作的结果。'
});

/** 降级原因（三态里的 demoted 必须带原因，否则诊断页答不出「为什么被换」）。 */
export const GATE_REASONS = Object.freeze({
    NO_RECEIPT: 'no-receipt',
    MISSING_DOMAIN_EVIDENCE: 'missing-domain-evidence',
    REQUEST_NOT_SUCCEEDED: 'request-not-succeeded',
    NOT_CLAIM: 'not-claim',
    FENCED: 'fenced',
    QUOTED: 'quoted',
    CONDITIONAL: 'conditional',
    EMPTY: 'empty'
});

/* 断言句：必须是「主体 + 成功助词 + 完成动词」，三段都要有。 */
const CLAIM_RE = /(?:我|我们|这边|已经|已|成功)[^。！？!?\n]{0,10}(?:写好|写完|创建|建好|修改|改好|改完|改期|发出|发好|部署|发了|跑完|通过|入库|记住|记下|保存|完成|生成|整理完|读完)/;
/* 硬条件标记：出现即「说的不是事实」，无论句式多像断言（「应该已经改好了」）。 */
const HARD_CONDITION_RE = /应该|应当|如果|假设|例如|比如|除非|若是|假如|按理/;
/* 软条件标记：只有**同时**不像强断言时才降级（避免「已经检查过是否需要」被误杀）。 */
const CONDITION_MARK_RE = /需要|必须|标准|条件|是否|能否|验收|检查|核对|验证|执行后|完成后|可以|如何|怎么|尚未|没有|未完成|无法|不能|不要|不得|待|才能/;
/* 代码围栏行 */
const FENCE_RE = /^\s*(?:```|~~~)/;
/* 引用行 */
const QUOTE_RE = /^\s*>/;
/* 句末切分（保留分隔符） */
const SENTENCE_SPLIT_RE = /(?<=[。！？!?\n])/;
/* 每域的证据探测键名线索：只作 fallback，调用方 probe 优先。 */
const DOMAIN_HINTS = Object.freeze({
    file: /path|file|dir|backup|文件|路径|备份/i,
    test: /test|spec|verification|测试|验证/i,
    deploy: /deploy|release|发布|部署/i,
    memory: /memory|fact|记忆|事实/i,
    calendar: /calendar|schedule|日程|改期/i,
    message: /message|send|msg|消息|发送|通知/i
});
/* 断言句 → 它声称了哪些域。一个句子可以同时声称多域（「改好文件并跑通测试」）。 */
const DOMAIN_CLAIM_RE = Object.freeze({
    file: /写好|写完|创建|建好|修改|改好|改完|文件|目录|备份/,
    test: /测试|跑完|通过|验证/,
    deploy: /部署|发布|上线/,
    memory: /记住|记下|保存|入库/,
    calendar: /改期|日程|约好/,
    message: /发出|发好|发了|通知到|已回复/
});
/* 判定标准的尾巴：断言词后面跟「是标准 / 作为条件 / 以…为准」⇒ 说的是标准不是事实。 */
const META_TAIL_RE = /(?:是|作为)(?:标准|条件|判据|验收项)|以[^。！？!?\n]{0,8}为准/;

/** 一次扫描的围栏状态。**不得跨消息复用**（围栏必须成对维持）。 */
export function createScanState() {
    return { fenced: false };
}

/**
 * 逐句判一句话的断言形态（不做任何替换）。
 * @returns {{kind:'claim'|'not-claim', reason:string, domains:string[]}}
 */
export function classifySentence(sentence, state) {
    const s = (typeof sentence === 'string') ? sentence : '';
    const st = (state && typeof state === 'object') ? state : createScanState();
    if (!s.trim()) return { kind: 'not-claim', reason: GATE_REASONS.EMPTY, domains: [] };
    if (FENCE_RE.test(s)) { st.fenced = !st.fenced; return { kind: 'not-claim', reason: GATE_REASONS.FENCED, domains: [] }; }
    if (st.fenced) return { kind: 'not-claim', reason: GATE_REASONS.FENCED, domains: [] };
    if (QUOTE_RE.test(s)) return { kind: 'not-claim', reason: GATE_REASONS.QUOTED, domains: [] };
    if (!CLAIM_RE.test(s)) return { kind: 'not-claim', reason: GATE_REASONS.NOT_CLAIM, domains: [] };
    /* 判定标准句：「已完成是标准」「以回执为准」—— 先挡掉，再谈条件句。 */
    if (META_TAIL_RE.test(s)) return { kind: 'not-claim', reason: GATE_REASONS.CONDITIONAL, domains: [] };
    /* 硬条件句：命中即不算断言（「应该已经改好了」说的不是事实）。 */
    if (HARD_CONDITION_RE.test(s)) return { kind: 'not-claim', reason: GATE_REASONS.CONDITIONAL, domains: [] };
    /* 软条件句：既有条件标记、又没有「主体+已」的强断言句式 ⇒ 也不算断言。 */
    const strong = /(?:^|[，,。；;、\s])(?:我|我们|这边)(?:已经|已|成功)?[^。！？!?\n]{0,8}(?:写好|写完|改好|改完|发出|部署|跑完|完成|创建|删除|保存|记住)/.test(s) || /(?:已经|已)(?:经)?[^。！？!?\n]{0,6}(?:写好|写完|改好|改完|发出|部署|跑完|完成|生成)/.test(s);
    if (!strong && CONDITION_MARK_RE.test(s)) return { kind: 'not-claim', reason: GATE_REASONS.CONDITIONAL, domains: [] };
    const domains = CLAIM_DOMAINS.filter((d) => DOMAIN_CLAIM_RE[d] && DOMAIN_CLAIM_RE[d].test(s));
    return { kind: 'claim', reason: GATE_REASONS.NOT_CLAIM, domains };
}

/** 某域在回执里有没有证据。probe 优先；probe 不是函数时退回域键名线索。 */
function hasEvidenceForDomain(receipt, domain, probe) {
    if (typeof probe === 'function') {
        try { if (probe(domain, receipt) === true) return true; } catch (_e) { /* 探针坏了按无证据，不抛 */ }
    }
    if (!receipt || typeof receipt !== 'object') return false;
    const hint = DOMAIN_HINTS[domain];
    if (!hint) return false;
    for (const key of Object.keys(receipt)) {
        if (!hint.test(key)) continue;
        const v = receipt[key];
        if (typeof v === 'string' && v.trim()) return true;
        if (Array.isArray(v) && v.length) return true;
        if (v && typeof v === 'object' && Object.keys(v).length) return true;
    }
    return false;
}

/**
 * 过门。
 * @param {string} text 待过门的正文
 * @param {{status?:string, receipt?:object|null, runId?:string|null}} request 回执请求
 * @param {{probe?:Function, state?:object}} [opts]
 * @returns {{text:string, rows:Array, demoted:number, evidenced:number, asserted:number}}
 *   rows 每项 { kind, reason, domains, before, after } —— 诊断页只读这张表，不重跑判据。
 */
export function guardCompletion(text, request, opts = {}) {
    const src = (typeof text === 'string') ? text : '';
    if (!src) return { text: '', rows: [], demoted: 0, evidenced: 0, asserted: 0 };
    const req = (request && typeof request === 'object') ? request : {};
    const status = String(req.status || 'not_executed');
    const receipt = (req.receipt && typeof req.receipt === 'object') ? req.receipt : null;
    const runId = req.runId ? String(req.runId) : '';
    const probe = (typeof opts.probe === 'function') ? opts.probe : null;
    const state = (opts.state && typeof opts.state === 'object') ? opts.state : createScanState();
    const safeLine = SAFE_STATUS_LINE[status] || SAFE_STATUS_LINE.unknown;

    const rows = [];
    let demoted = 0, evidenced = 0, asserted = 0;
    const out = src.split(SENTENCE_SPLIT_RE).map((sentence) => {
        const cls = classifySentence(sentence, state);
        if (cls.kind !== 'claim') {
            if (sentence.trim()) rows.push({ kind: 'plain', reason: cls.reason, domains: [], before: sentence, after: sentence });
            return sentence;
        }
        asserted += 1;
        /* 请求本身没成功、或没有 runId ⇒ 一定降级（回执可能是上一轮的）。 */
        if (status !== 'succeeded' || !runId) {
            const after = safeLine + (sentence.endsWith('\n') ? '\n' : '');
            demoted += 1;
            rows.push({ kind: 'demoted', reason: GATE_REASONS.REQUEST_NOT_SUCCEEDED, domains: cls.domains, before: sentence, after });
            return after;
        }
        /* 每域都要有证据；缺任一域即降级，并如实记缺哪个域。 */
        const missing = cls.domains.filter((d) => !hasEvidenceForDomain(receipt, d, probe));
        if (missing.length) {
            const after = safeLine + (sentence.endsWith('\n') ? '\n' : '');
            demoted += 1;
            rows.push({ kind: 'demoted', reason: GATE_REASONS.MISSING_DOMAIN_EVIDENCE + ':' + missing.join('+'), domains: cls.domains, before: sentence, after });
            return after;
        }
        evidenced += 1;
        rows.push({ kind: 'evidenced', reason: '', domains: cls.domains, before: sentence, after: sentence });
        return sentence;
    }).join('');

    return { text: out, rows, demoted, evidenced, asserted };
}

/** 一行总述（视图与诊断共用同一句话，不各写一份）。 */
export function gateSummaryLine(r) {
    const o = (r && typeof r === 'object') ? r : {};
    const asserted = Number(o.asserted) || 0;
    if (!asserted) return '本轮正文没有完成断言。';
    return '完成断言 ' + String(asserted) + ' 句：放行 ' + String(Number(o.evidenced) || 0)
        + ' · 降级 ' + String(Number(o.demoted) || 0);
}

/** 自检：常量表互不同形 + 判定表可跑通。不依赖任何外部状态。 */
export function completionGateSelfCheck() {
    const bad = [];
    const keys = Object.keys(SAFE_STATUS_LINE);
    if (keys.length !== 8) bad.push('SAFE_STATUS_LINE 必须八态');
    for (const k of keys) if (!SAFE_STATUS_LINE[k]) bad.push('中性句为空: ' + k);
    const st = createScanState();
    if (classifySentence('我已经把文件改好了。', st).kind !== 'claim') bad.push('强断言句未识别');
    if (classifySentence('应该已经改好了。', createScanState()).kind === 'claim') bad.push('条件句被误判为断言');
    if (classifySentence('「已完成」是标准。', createScanState()).kind === 'claim') bad.push('判定标准句被误判为断言');
    const g = guardCompletion('我已经把日程改好了。', { status: 'running', runId: 'r1' });
    if (g.demoted !== 1) bad.push('未成功请求未降级');
    return { ok: bad.length === 0, bad };
}
