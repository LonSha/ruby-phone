/* ============================================================
 * config/memory-ask-thread.js — [v4.22.0 · 第四期 R4-X1 可追问的往事会话]
 *
 * 【本件是纯契约:只做读数与归一,零 DOM 零存储零联网零时钟】
 *   上游 `askMemoryQuestionFollowUp` 已经实现了「这一轮继承了什么 / 新设了什么」,
 *   本件**不另写查询、不自己算继承**,只把它的回执翻成人能读的那几行,并给出
 *   「该走哪个出口」的派发相判定。上游能力与手机消费分开:上游负责推理与事实,
 *   手机负责交互(`audit: 跨仓分工`原文)。
 *
 * 【修前的缺口(读码可复算,不是推演)】
 *   `apps/memory/memory-app.js::askPast` 每次只传 `question + {}`,回执里的
 *   `actor / topics / timeHints` 一律被当成「这一问的临时结果」;`memory-view` 是
 *   单输入单结果区。于是用户问「那后来呢」「另一个人呢」时,上一轮认下的人与
 *   时点全部丢失 —— 后果不是报错,而是**回答悄悄换了人**:用户以为还在问甲,
 *   实际查的是全库。计划点名的正是这半句:「那后来呢」没有会话语义承接。
 *
 * 【为什么不自己做继承】本仓纪律是「同一口径只许一份实现」。上游 qa-thread 内核
 *   已经带了 chatKey 作废重建(换会话不许暗中继承)与消歧未决不产结论两件硬约束;
 *   手机再写一份,就是把这两条硬约束放在两个地方各判一次。
 * ============================================================ */

/** 追问面四态 + 两格「问不了」(缺件与不认识,与「没开始」分形)。 */
export const ASK_THREAD_PHASES = Object.freeze({
    ABSENT: 'absent',            // 上游插件不在场:没有追问这回事
    UNSUPPORTED: 'unsupported',   // 插件在,但没有追问出口(旧版):如实说,不假装能追
    IDLE: 'idle',                 // 有出口,本会话还没开始追问
    OPEN: 'open',                 // 有 thread,主体已认下
    AWAITING: 'awaiting',         // 消歧未决:等用户选,不许猜
    CLOSED: 'closed',             // 上游说这一场已结束(与「还没开始」处置相反)
});

/** 追问出口派发相(与记忆问答的 ask-request 同规:一处判)。 */
export const ASK_FOLLOWUP_OUTLETS = Object.freeze({
    FOLLOWUP: 'followup-ask',     // 走上游追问出口(带条件继承)
    PLAIN: 'plain-ask',           // 回落普通问答(能做,但**没有**继承 —— 必须如实说)
    NONE: 'none',                 // 连普通问答都没有
});

export const ASK_THREAD_LIMITS = Object.freeze({
    turns: 12,      // 会话里保留的轮数(不问全文,只留可回看的轨迹)
    candidates: 8,  // 消歧候选最多列几个
});

function str(v) { return String(v == null ? '' : v).trim(); }

/**
 * 派发相:有追问出口走追问;只有普通出口回落普通并**如实告知没有继承**;
 *   两样都没有则如实报无。
 * @returns {string} ASK_FOLLOWUP_OUTLETS 里的一个
 */
export function planFollowUpOutlet(hasFollowUp, hasPlain) {
    /* 严格判 true:非 true 一律当「没有」（与 `ask-request.js::planAskPhase` 同口径）——
     *   宽松判会把 'yes' / 1 / {} 读成「有出口」,于是给用户点一个走不通的按钮。 */
    if (hasFollowUp === true) return ASK_FOLLOWUP_OUTLETS.FOLLOWUP;
    if (hasPlain === true) return ASK_FOLLOWUP_OUTLETS.PLAIN;
    return ASK_FOLLOWUP_OUTLETS.NONE;
}

/** 一轮追问的轨迹行(只留可回看的约束,不留答案全文 —— 上游正文由上游持有)。 */
export function traceStepOf(recv, question) {
    const r = (recv && typeof recv === 'object') ? recv : {};
    const inherit = Array.isArray(r.inherit) ? r.inherit : [];
    const condition = Array.isArray(r.condition) ? r.condition : [];
    return {
        question: str(question),
        turn: Number(r.turn) || 0,
        state: str(r.threadState),
        awaiting: r.awaiting === true,
        actor: str(r.actor),
        actors: Array.isArray(r.actors) ? r.actors.map(str).filter(Boolean) : [],
        inheritAxes: inherit.map(function (x) { return str(x && x.axis); }).filter(Boolean),
        conditionAxes: condition.map(function (x) { return str(x && x.axis); }).filter(Boolean),
        /* 候选与时点也要留下:它们**只在回执里**（thread 读数这一格是空的），
         *   不留下来,旧插件上「歧义让用户选」就没得选。 */
        candidates: (Array.isArray(r.candidates) ? r.candidates : []).map(str).filter(Boolean)
            .slice(0, ASK_THREAD_LIMITS.candidates),
        atFloor: (r.atFloor === null || r.atFloor === undefined) ? null : (Number(r.atFloor) || 0),
        refs: Array.isArray(r.refs) ? r.refs.length : 0,
    };
}

/**
 * 把一轨迹步翻回**最小回执形状**（供 `normalizeThreadFace` 读）。
 *   这是**形状翻译**,不是重算:步里的轴与候选都是上游回执原样留下的。
 */
export function receiptOfStep(step) {
    const s = (step && typeof step === 'object') ? step : null;
    if (!s) return null;
    return {
        followUp: true,
        turn: Number(s.turn) || 0,
        threadState: str(s.state) || 'open',
        awaiting: s.awaiting === true,
        actors: Array.isArray(s.actors) ? s.actors.slice() : [],
        candidates: Array.isArray(s.candidates) ? s.candidates.slice() : [],
        atFloor: (s.atFloor === null || s.atFloor === undefined) ? null : (Number(s.atFloor) || 0),
        inherit: (Array.isArray(s.inheritAxes) ? s.inheritAxes : []).map(function (a) { return { axis: a }; }),
        condition: (Array.isArray(s.conditionAxes) ? s.conditionAxes : []).map(function (a) { return { axis: a }; }),
    };
}

/** 追加一轮并**只保留最近 N 轮**(超出的丢掉并如实报数,不静默截断)。 */
export function appendTrace(history, step) {
    const list = Array.isArray(history) ? history.slice() : [];
    /* 累计丢掉的轮数从**上一份轨迹**上取回：裁掉的那些已经不在数组里，
     *   滚动之后再想算总数是算不出来的。故挂一个不可枚举属性带走它
     *   （不可枚举是为了不污染 deepEqual(trace, [...]) 这类结构比对）。 */
    const prevTotal = (history && typeof history === 'object' && Number(history.droppedTotal) > 0)
        ? Number(history.droppedTotal) : 0;
    const s = (step && typeof step === 'object') ? step : null;
    if (s) list.push(s);
    const dropped = Math.max(0, list.length - ASK_THREAD_LIMITS.turns);
    const trace = dropped ? list.slice(dropped) : list;
    const droppedTotal = prevTotal + dropped;
    try {
        Object.defineProperty(trace, 'droppedTotal', { value: droppedTotal, enumerable: false });
    } catch (_e) { /* 冻结数组之类的异常情形：如实退化成没有累计读数 */ }
    return {
        trace: trace, dropped: dropped, droppedTotal: droppedTotal,
        count: Math.min(list.length, ASK_THREAD_LIMITS.turns),
    };
}
/** 累计丢了几轮（读数要用它；轨迹上没有这一格时如实给 0）。 */
export function droppedTotalOf(trace) {
    const t = Array.isArray(trace) ? trace : null;
    if (!t) return 0;
    const n = Number(t.droppedTotal);
    return (Number.isFinite(n) && n > 0) ? n : 0;
}


/**
 * 一轨迹行的人读文案(视图那一屏)。
 *   只写**约束**,不写答案全文 —— 上游正文归上游,本件不长期镜像。
 *   三态必须分句:有沿用 / 没沿用 / 待消歧(**本次没查**)。
 */
export function traceLineOf(step) {
    const s = (step && typeof step === 'object') ? step : null;
    if (!s) return '';
    const bits = [];
    if (s.turn) bits.push('第 ' + String(s.turn) + ' 轮');
    if (s.actor) bits.push('人物 ' + s.actor);
    if (s.awaiting) bits.push('待消歧(本次没查)');
    if (Array.isArray(s.inheritAxes) && s.inheritAxes.length) bits.push('沿用 ' + s.inheritAxes.join('/'));
    if (Array.isArray(s.conditionAxes) && s.conditionAxes.length) bits.push('新设 ' + s.conditionAxes.join('/'));
    if (s.refs) bits.push('出处 ' + String(s.refs) + ' 条');
    const head = s.question ? ('「' + s.question + '」 ') : '';
    return head + (bits.length ? bits.join(' · ') : '无约束');
}

/**
 * 归一上游回执里的追问面。
 * @param {object|null} recv 上游回执(askMemoryQuestionFollowUp 的返回值,或普通问答回执)
 * @returns {{phase:string, turn:number, state:string, awaiting:boolean, accepted:boolean,
 *            candidates:Array<string>, inherit:Array, condition:Array, inheritAxes:Array<string>,
 *            conditionAxes:Array<string>, subjects:Array<string>, atFloor:number|null,
 *            followUp:boolean, why:string}}
 */
export function normalizeThreadFace(recv) {
    const r = (recv && typeof recv === 'object') ? recv : null;
    if (!r) {
        return {
            phase: ASK_THREAD_PHASES.ABSENT, turn: 0, state: '', awaiting: false, accepted: false,
            candidates: [], inherit: [], condition: [], inheritAxes: [], conditionAxes: [],
            subjects: [], atFloor: null, followUp: false, why: '插件不在场:没有追问面',
        };
    }
    /* 追问回执与普通回执的**唯一**分界是上游自己的 `followUp` 标志:
     *   拿「有没有 turn」当分界会把 turn=0 的普通回执读成追问。 */
    const followUp = r.followUp === true;
    const inherit = Array.isArray(r.inherit) ? r.inherit : [];
    const condition = Array.isArray(r.condition) ? r.condition : [];
    const candidates = (Array.isArray(r.candidates) ? r.candidates : [])
        .map(str).filter(Boolean).slice(0, ASK_THREAD_LIMITS.candidates);
    const actors = Array.isArray(r.actors) ? r.actors.map(str).filter(Boolean) : [];
    const awaiting = followUp && r.awaiting === true;
    const state = str(r.threadState);
    let phase = ASK_THREAD_PHASES.IDLE;
    if (awaiting) phase = ASK_THREAD_PHASES.AWAITING;
    /* ★「已结束」必须单列:上游四态里的 closed 落进 IDLE 会被读成「还没开始」,
     *   而两者处置相反 —— 前者是「你结束了它」,后者是「你还没开始」。 */
    else if (followUp && state === 'closed') phase = ASK_THREAD_PHASES.CLOSED;
    else if (followUp && (state === 'open' || actors.length)) phase = ASK_THREAD_PHASES.OPEN;
    else if (!followUp) phase = ASK_THREAD_PHASES.UNSUPPORTED;
    /* 消歧未决时**不产结论**(上游不跑查询),读数必须跟着说清这一步没查。 */
    const why = awaiting
        ? ('指代不定,等你在候选里选一个再问 —— 本次**没有查**(替用户猜一个名字比不查更贵)')
        : (!followUp ? '本次走的是普通问答:上一轮的人与时点**没有被继承**' : '');
    return {
        phase: phase, turn: Number(r.turn) || 0, state: state, awaiting: awaiting,
        /* accepted 只在追问面有意义:普通回执里它无从谈起,默认 true 是把
         * 「没这回事」写成了「认下了」。 */
        accepted: followUp ? (r.accepted !== false) : false, candidates: candidates,
        inherit: inherit, condition: condition,
        inheritAxes: inherit.map(function (x) { return str(x && x.axis); }).filter(Boolean),
        conditionAxes: condition.map(function (x) { return str(x && x.axis); }).filter(Boolean),
        subjects: actors, atFloor: (r.atFloor === null || r.atFloor === undefined) ? null : (Number(r.atFloor) || 0),
        followUp: followUp, why: why,
    };
}

/** 「本次沿用哪些条件」——计划验收原文点名要显示的那一屏。 */
export function carryLineOf(face) {
    const f = (face && typeof face === 'object') ? face : null;
    if (!f) return '还没有追问过';
    const bits = [];
    if (f.subjects.length) bits.push('人物 ' + f.subjects.join('/'));
    if (f.atFloor !== null) bits.push('时点 ≥' + String(f.atFloor) + '楼');
    if (f.inheritAxes.length) bits.push('沿用 ' + f.inheritAxes.join('/'));
    if (f.conditionAxes.length) bits.push('新设 ' + f.conditionAxes.join('/'));
    if (!bits.length) return f.turn ? ('第 ' + String(f.turn) + ' 轮 · 没有沿用任何条件') : '还没有追问过';
    /* 「认不出人」只在**真的说了要沿用主体却没人**时才说 —— 否则如实说没沿用任何条件:
     *   两者处置相反（一个是「名字没认出来」,一个是「这一轮压根没带条件」）。 */
    if (!f.subjects.length && f.inheritAxes.indexOf('subject') >= 0) bits.unshift('人物 (未认下)');
    return '第 ' + String(f.turn) + ' 轮 · ' + bits.join(' · ');
}

/** 一行读数(视图那一屏;三态各占一格,不把「问不了」压成「没开始」)。 */
export function threadFaceLine(face) {
    const f = (face && typeof face === 'object') ? face : null;
    if (!f) return '追问面读不到';
    if (f.phase === ASK_THREAD_PHASES.ABSENT) return '追问:插件不在场';
    if (f.phase === ASK_THREAD_PHASES.UNSUPPORTED) return '追问:本插件没有追问出口(回落普通问答,不继承条件)';
    if (f.phase === ASK_THREAD_PHASES.AWAITING) return '追问:' + carryLineOf(f) + ' · 待消歧(' + f.candidates.join('/') + ')';
    if (f.phase === ASK_THREAD_PHASES.CLOSED) return '追问:这一场已结束(再追会从这一问重新认起条件)';
    if (f.phase === ASK_THREAD_PHASES.IDLE) return '追问:本会话还没开始(第一次追问会从这一问认起)';
    return '追问:' + carryLineOf(f);
}

/** 消歧候选 → 可点的一行行(不猜、不排序出「最可能」的那个)。 */
export function candidateRowsOf(face) {
    const f = (face && typeof face === 'object') ? face : null;
    const list = (f && Array.isArray(f.candidates)) ? f.candidates : [];
    return list.map(function (name) {
        return { name: name, line: '是「' + name + '」' };
    });
}

/** 判据自证(十一项)。 */
export function askThreadSelfCheck() {
    const problems = [];
    const phases = Object.keys(ASK_THREAD_PHASES).map(function (k) { return ASK_THREAD_PHASES[k]; });
    if (new Set(phases).size !== phases.length) problems.push('追问面各态必须互不相同');
    if (ASK_THREAD_PHASES.UNSUPPORTED === ASK_THREAD_PHASES.IDLE) problems.push('「没有追问出口」与「还没开始」必须不同形');
    if (ASK_THREAD_PHASES.CLOSED === ASK_THREAD_PHASES.IDLE) problems.push('「已结束」与「还没开始」必须不同形');

    /* 一 派发相:三种组合三种结果。 */
    if (planFollowUpOutlet(true, true) !== ASK_FOLLOWUP_OUTLETS.FOLLOWUP) problems.push('有追问出口必须优先走追问');
    if (planFollowUpOutlet(false, true) !== ASK_FOLLOWUP_OUTLETS.PLAIN) problems.push('没有追问出口应回落普通问答');
    if (planFollowUpOutlet(false, false) !== ASK_FOLLOWUP_OUTLETS.NONE) problems.push('两样都没有应如实报无');
    for (const bad of [undefined, null, 0, 1, 'yes', {}]) {
        if (planFollowUpOutlet(bad, false) !== ASK_FOLLOWUP_OUTLETS.NONE) problems.push('派发相必须严格判 true(非 true 不得读成有出口):' + String(bad));
    }

    /* 二 继承与不可继承必须分形。 */
    const withFU = normalizeThreadFace({ followUp: true, turn: 2, threadState: 'open', actors: ['甲'], inherit: [{ axis: 'subject' }], condition: [] });
    const noFU = normalizeThreadFace({ turn: 0, actors: [], answer: [] });
    if (withFU.phase !== ASK_THREAD_PHASES.OPEN) problems.push('有 thread 的追问应记 open');
    if (noFU.phase !== ASK_THREAD_PHASES.UNSUPPORTED) problems.push('普通回执应记 unsupported(本次没有继承)');
    if (noFU.phase === withFU.phase) problems.push('「继承了」与「没继承」必须不同形');
    /* 上游第四态:closed 不得被读成 idle（处置相反:结束了 vs 没开始）。 */
    const cl = normalizeThreadFace({ followUp: true, turn: 3, threadState: 'closed', actors: ['甲'] });
    if (cl.phase !== ASK_THREAD_PHASES.CLOSED) problems.push('上游说已结束,本件必须记 closed(实测 ' + cl.phase + ')');
    if (cl.phase === ASK_THREAD_PHASES.IDLE) problems.push('「已结束」不得读成「还没开始」');
    const idleFace = normalizeThreadFace({ followUp: true, turn: 0, threadState: 'idle' });
    if (threadFaceLine(cl) === threadFaceLine(idleFace)) problems.push('「已结束」与「还没开始」的一行读数必须不同句');
    if (!carryLineOf(withFU).includes('甲')) problems.push('沿用读数必须点名人物');
    if (!threadFaceLine(noFU).includes('不继承')) problems.push('普通问答的读数必须明说没有继承');
    if (noFU.accepted !== false) problems.push('普通问答回执不得报「认下了」');

    /* 三 消歧未决:不产结论、候选可点。 */
    const aw = normalizeThreadFace({ followUp: true, turn: 1, threadState: 'awaiting-disambig', awaiting: true, candidates: ['甲', '乙'] });
    if (aw.phase !== ASK_THREAD_PHASES.AWAITING) problems.push('awaiting 应记 awaiting');
    if (!aw.why.includes('没有查')) problems.push('消歧未决必须明说本次没有查');
    if (candidateRowsOf(aw).length !== 2) problems.push('候选应逐个可点');
    if (candidateRowsOf(aw)[0].line === candidateRowsOf(aw)[1].line) problems.push('候选行必须各自可辨认');

    /* 三半 轨迹行:沿用不同条件必须不同句;待消歧不许写成「沿用」。 */
    const t1 = traceLineOf(traceStepOf({ followUp: true, turn: 1, actor: '甲', inherit: [{ axis: 'subject' }] }, '甲后来呢'));
    const t2 = traceLineOf(traceStepOf({ followUp: true, turn: 2, actor: '乙', condition: [{ axis: 'time' }] }, '另一个人呢'));
    if (!t1 || !t2) problems.push('轨迹行必须能读出文案');
    if (t1 === t2) problems.push('不同轮次的轨迹行必须不同句');
    if (!t1.includes('甲')) problems.push('轨迹行必须点名人物');
    if (!t2.includes('乙')) problems.push('轨迹行必须点名第二个人物');
    if (t1.includes('沿用') && t1.includes('新设')) problems.push('沿用与新设不许混成同一行');
    const tAwait = traceLineOf(traceStepOf({ followUp: true, turn: 3, awaiting: true }, '她是谁'));
    if (tAwait.includes('沿用')) problems.push('待消歧的轨迹行不许写成「沿用」');
    if (!tAwait.includes('没查')) problems.push('待消歧的轨迹行必须说清本次没查');
    if (traceLineOf(null) !== '') problems.push('空轨迹行应读成空串');
    /* 步 → 回执的翻译必须**保住候选与沿用轴**（否则旧插件上候选一个都拿不到）。 */
    const stAwait = traceStepOf({ followUp: true, turn: 2, awaiting: true, candidates: ['甲', '乙'], inherit: [{ axis: 'subject' }] }, '她呢');
    const rtAwait = receiptOfStep(stAwait);
    if (!rtAwait) problems.push('步必须能翻回回执形状');
    const faceAwait = normalizeThreadFace(rtAwait);
    if (faceAwait.phase !== ASK_THREAD_PHASES.AWAITING) problems.push('翻回来的回执该是待消歧,实际 ' + faceAwait.phase);
    if (candidateRowsOf(faceAwait).length !== 2) problems.push('翻回来时候选必须还在(实测 ' + String(candidateRowsOf(faceAwait).length) + ')');
    if (faceAwait.inheritAxes.indexOf('subject') < 0) problems.push('翻回来时沿用轴必须还在');
    if (receiptOfStep(null) !== null) problems.push('空步翻不出回执(该给 null)');

    /* 四 轨迹只留最近 N 轮,且丢掉的轮数如实报。 */
    let h = [];
    for (let i = 1; i <= ASK_THREAD_LIMITS.turns + 3; i++) {
        const r = appendTrace(h, traceStepOf({ followUp: true, turn: i, actor: '甲' }, 'q' + String(i)));
        h = r.trace;
        if (i === ASK_THREAD_LIMITS.turns + 3 && r.dropped < 1) problems.push('超出轮数必须如实报丢了几轮');
    }
    if (h.length !== ASK_THREAD_LIMITS.turns) problems.push('轨迹应只留最近 ' + String(ASK_THREAD_LIMITS.turns) + ' 轮,实际 ' + String(h.length));
    if (h[h.length - 1].question !== 'q' + String(ASK_THREAD_LIMITS.turns + 3)) problems.push('轨迹尾必须是最近那一轮');
    /* 累计丢几轮必须能读出来（读数说的是「早前 N 轮不再回看」,那是**总数**不是本次）。 */
    if (droppedTotalOf(h) !== 3) problems.push('累计丢掉的轮数应读成 3,实际 ' + String(droppedTotalOf(h)));
    if (droppedTotalOf([]) !== 0 || droppedTotalOf(null) !== 0) problems.push('没有轨迹时累计应为 0');
    /* 「没有沿用任何条件」与「认不出人」必须分形。 */
    const noCondFace = normalizeThreadFace({ followUp: true, turn: 1, threadState: 'open' });
    const unnamedFace = normalizeThreadFace({ followUp: true, turn: 1, threadState: 'open', inherit: [{ axis: 'subject' }] });
    if (carryLineOf(noCondFace).indexOf('没有沿用任何条件') < 0) problems.push('一轮没带条件时要说「没有沿用任何条件」,实测:' + carryLineOf(noCondFace));
    if (carryLineOf(unnamedFace).indexOf('未认下') < 0) problems.push('说了沿用主体却没人时要说「未认下」,实测:' + carryLineOf(unnamedFace));
    if (carryLineOf(noCondFace) === carryLineOf(unnamedFace)) problems.push('「没带条件」与「认不出人」不许压成同一句');

    /* 五 空件与异常:如实报,不抛。 */
    if (normalizeThreadFace(null).phase !== ASK_THREAD_PHASES.ABSENT) problems.push('空回执应记 absent');
    if (normalizeThreadFace({}).phase !== ASK_THREAD_PHASES.UNSUPPORTED) problems.push('无 followUp 标志应记 unsupported');

    return { problems: problems, phases: phases.length, outlets: Object.keys(ASK_FOLLOWUP_OUTLETS).length };
}

export default {
    ASK_THREAD_PHASES,
    ASK_FOLLOWUP_OUTLETS,
    ASK_THREAD_LIMITS,
    planFollowUpOutlet,
    traceStepOf,
    appendTrace,
    droppedTotalOf,
    traceLineOf,
    receiptOfStep,
    normalizeThreadFace,
    carryLineOf,
    threadFaceLine,
    candidateRowsOf,
    askThreadSelfCheck,
};