/* ============================================================
 * config/rumor-source-contract.js — [v4.39.0 · 第五期 R5-X4 传闻源头图与证词回溯]
 *
 * 【本件是纯契约：只做读数与归一，零 DOM 零存储零联网零时钟】
 *   溯源图（`config/provenance-graph.js`，R-X2 已交付）能回答「这条从哪来、
 *   上游还在不在、被谁撤了」；但**没有任何一格能回答本项要的那一问**：
 *   **「这几条到底是一个来源，还是几个独立来源？」**
 *
 * 【修前的缺口（读码可复算，不是推演）】
 *   `retellChains`（context-compose）早就会把「同一传闻三平台转述」归成一条链，
 *   但手机侧零消费：全仓零 `independent` / `corroborat` 命中。
 *   于是「一条消息被转了三次」与「三个目击者各说了一遍」在界面上**完全同形** ——
 *   而这两件事的处置相反（前者仍是孤证、后者才算互相印证）。
 *   计划原文点名要治的正是这半句：**「热度高」与「独立来源多」是不同结果**。
 *
 * 【四件必须分形】
 *   ① **转述 ≠ 独立来源**：同一根下的多处转述只算**一条**来源；
 *   ② **支持 ≠ 反证**：明确反证（`refutes`）必须与支持分开计数，且反证**优先呈现**；
 *   ③ **被撤回的源不消失**：撤回了就如实列出「曾经有过、现在失效」，
 *      不许从清单里悄悄拿掉（那会让用户以为从没人说过）；
 *   ④ **没有证据链就不画线**：只有名字相同/关键词相同**不算**连线 ——
 *      本件**不产**任何凭相似度猜出来的边（`RUMOR_FORBIDDEN_KEYS` 自检真跑）。
 *
 * 【不做（计划原文）】不重复实现舆论热度；**不给人物贴骗子标签**
 *   —— 故本件不产任何「可信度」分数，也不产「说谎者」名单。
 * ============================================================ */

/** 传闻面态（互不相同：压平任意两态即造出处置相反的处境长得一样）。 */
export const RUMOR_STATES = Object.freeze({
    ABSENT: 'absent',            // 没有溯源面（上游不在场 / 没取数）
    NO_CHAIN: 'no-chain',        // 有面，但这一条**没有可回溯的来源**（不是「没人说过」）
    SINGLE: 'single',            // 只有一个来源（**孤证**：转述再多也还是孤证）
    CORROBORATED: 'corroborated', // 有 ≥2 个**独立**来源
    DISPUTED: 'disputed',        // 有明确反证
    UNREADABLE: 'unreadable',    // 取数抛了（如实报，不假装没有）
});

/** 来源条目的来源类别（**独立**判定只认它，不认名字像不像）。 */
export const RUMOR_ORIGINS = Object.freeze({
    WITNESS: 'witness',       // 目击者亲述
    DOCUMENT: 'document',     // 书证 / 记录
    RETELL: 'retell',         // 转述（**不算独立来源**）
    UNKNOWN: 'unknown',       // 上游没标（**不算独立来源**，如实计一格）
});

export const RUMOR_LIMITS = Object.freeze({
    sources: 24,
    rows: 24,
});

/** 读数里**不得出现**的键名（可信度 / 热度 / 评分一族）。 */
export const RUMOR_FORBIDDEN_KEYS = Object.freeze([
    'credibility', 'trust', 'score', 'percent', 'percentage', 'heat', 'hotness',
    'confidence', 'liar', 'rank', 'weight', 'priority',
]);

function str(v) { return String(v == null ? '' : v).trim(); }

/**
 * 派发相：有溯源面才判；没有则如实报「没有可回溯的来源」。
 *   严格判 true（非 true 一律当「没有」）。
 */
export function planRumorState(hasFace, chainCount) {
    if (hasFace !== true) return RUMOR_STATES.ABSENT;
    const n = Number(chainCount);
    if (!Number.isFinite(n) || n <= 0) return RUMOR_STATES.NO_CHAIN;
    return null;   /* 有链 ⇒ 交给 classifyOf 细判（孤证 / 互相印证 / 有争议） */
}

/**
 * 归一一条传闻的**来源集**（本件唯一装配点）。
 *
 * 【独立来源怎么算】只认**来源类别**（witness / document）：
 *   · `retell` 一律不算独立（它按定义就是别人的话又说了一遍）；
 *   · `unknown` 不算独立（上游没标 ⇒ 判不了，**不硬算一条**）；
 *   · 同一 `rootKey` 下的多条**只算一条**（同一件事的不同说法不是不同来源）。
 *
 * @param {object|null} recv 上游回执（或 null）
 * @returns {{state:string, claim:string, sources:Array, independent:number,
 *            retell:number, unknown:number, supports:Array, refutes:Array,
 *            withdrawn:Array, why:string, writesNothing:boolean}}
 */
export function normalizeRumorFace(recv) {
    const r = (recv && typeof recv === 'object') ? recv : null;
    const base = {
        state: RUMOR_STATES.ABSENT, claim: '', sources: [], independent: 0,
        retell: 0, unknown: 0, supports: [], refutes: [], withdrawn: [],
        why: '', writesNothing: true,
    };
    if (!r) {
        return Object.assign({}, base, { why: '没有溯源面：这一条读不到「从哪来」' });
    }
    if (r.unreadable === true || r.thrown === true) {
        return Object.assign({}, base, {
            state: RUMOR_STATES.UNREADABLE, claim: str(r.claim),
            why: '取数失败（已降级）—— 这是「读不到」，**不是**「没有来源」',
        });
    }
    const claim = str(r.claim || r.text);
    const rawSources = Array.isArray(r.sources) ? r.sources : [];
    if (!rawSources.length) {
        return Object.assign({}, base, {
            state: RUMOR_STATES.NO_CHAIN, claim: claim,
            why: '这一条没有可回溯的来源（**不是**「没人说过」—— 只是没记来源）',
        });
    }
    const sources = rawSources.slice(0, RUMOR_LIMITS.sources).map((s) => {
        const e = (s && typeof s === 'object') ? s : {};
        const raw = str(e.origin);
        const origin = Object.values(RUMOR_ORIGINS).indexOf(raw) >= 0 ? raw : RUMOR_ORIGINS.UNKNOWN;
        return {
            id: str(e.id), label: str(e.label), origin: origin,
            originRaw: (origin === RUMOR_ORIGINS.UNKNOWN && raw && raw !== RUMOR_ORIGINS.UNKNOWN) ? raw : '',
            rootKey: str(e.rootKey || e.id),
            ref: str(e.ref), state: str(e.state) || 'live',
        };
    });
    /* 独立来源：按 rootKey 去重，只认 witness / document。 */
    const roots = new Set();
    let independent = 0;
    let retell = 0;
    let unknown = 0;
    for (const s of sources) {
        if (s.origin === RUMOR_ORIGINS.RETELL) { retell += 1; continue; }
        if (s.origin !== RUMOR_ORIGINS.WITNESS && s.origin !== RUMOR_ORIGINS.DOCUMENT) { unknown += 1; continue; }
        if (roots.has(s.rootKey)) continue;    // 同一根下的多条只算一条
        roots.add(s.rootKey);
        independent += 1;
    }
    const supports = (Array.isArray(r.supports) ? r.supports : []).map((x) => str(x)).filter(Boolean).slice(0, RUMOR_LIMITS.rows);
    const refutes = (Array.isArray(r.refutes) ? r.refutes : []).map((x) => str(x)).filter(Boolean).slice(0, RUMOR_LIMITS.rows);
    /* 被撤回的源**如实列出**（不许从清单里拿掉）。 */
    const withdrawn = sources.filter((s) => s.state === 'withdrawn')
        .map((s) => ({ id: s.id, label: s.label, origin: s.origin }));
    let state = RUMOR_STATES.SINGLE;
    if (refutes.length) state = RUMOR_STATES.DISPUTED;
    else if (independent >= 2) state = RUMOR_STATES.CORROBORATED;
    return Object.assign({}, base, {
        state: state, claim: claim, sources: sources,
        independent: independent, retell: retell, unknown: unknown,
        supports: supports, refutes: refutes, withdrawn: withdrawn,
        why: '',
    });
}

/**
 * 一行读数（**唯一出处**）。
 *   五态必须分句：没有来源 / 孤证 / 互相印证 / 有争议 / 读不到。
 */
export function rumorLineOf(face) {
    const f = (face && typeof face === 'object') ? face : null;
    if (!f) return '来源：读不到';
    if (f.state === RUMOR_STATES.ABSENT) return '来源：没有溯源面（读不到「从哪来」）';
    if (f.state === RUMOR_STATES.UNREADABLE) return '来源：取数失败（读不到 ≠ 没有来源）';
    if (f.state === RUMOR_STATES.NO_CHAIN) return '来源：这一条没有可回溯的来源（不是「没人说过」）';
    const bits = ['独立来源 ' + String(f.independent) + ' 条'];
    if (f.retell) bits.push('转述 ' + String(f.retell) + ' 处（**同一来源**，不算独立）');
    if (f.unknown) bits.push('未标注 ' + String(f.unknown) + ' 条（判不了是不是独立）');
    if (f.refutes.length) bits.push('反证 ' + String(f.refutes.length) + ' 条');
    if (f.withdrawn.length) bits.push('已撤回 ' + String(f.withdrawn.length) + ' 条');
    if (f.state === RUMOR_STATES.SINGLE) bits.push('⇒ **孤证**（转述再多也还是孤证）');
    if (f.state === RUMOR_STATES.CORROBORATED) bits.push('⇒ 互相印证');
    if (f.state === RUMOR_STATES.DISPUTED) bits.push('⇒ **有争议**（反证优先呈现）');
    return '来源：' + bits.join(' · ');
}

/**
 * 「热度高 ≠ 独立来源多」那一句（本项验收原文点名的那一问）。
 *   三态分句：**孤证** / **互相印证** / **判不了**。
 */
export function corroborationLineOf(face) {
    const f = (face && typeof face === 'object') ? face : null;
    if (!f) return '判不了（没有这一条）';
    if (f.state === RUMOR_STATES.SINGLE) {
        return '**孤证**：独立来源只有 ' + String(f.independent) + ' 条'
            + (f.retell ? '（另有 ' + String(f.retell) + ' 处转述 —— 那是同一件事被又说了一遍，不是新来源）' : '');
    }
    if (f.state === RUMOR_STATES.CORROBORATED) {
        return '互相印证：有 ' + String(f.independent) + ' 条**独立**来源（转述不计入）';
    }
    if (f.state === RUMOR_STATES.DISPUTED) {
        return '有争议：有 ' + String(f.independent) + ' 条独立来源，但有 ' + String(f.refutes.length) + ' 条**明确反证**';
    }
    return '判不了（' + rumorLineOf(f) + '）';
}

/**
 * 来源 → 可点的一行行（**反证排在最前**：它是用户最该先看的一格）。
 *   没有证据链时**不画编造连线** —— 本函数只列真实存在的来源，不猜。
 */
export function rumorRowsOf(face) {
    const f = (face && typeof face === 'object') ? face : null;
    const list = (f && Array.isArray(f.sources)) ? f.sources : [];
    const LABEL = {
        witness: '目击者亲述', document: '书证 / 记录', retell: '转述', unknown: '未标注来源类别',
    };
    const rows = [];
    for (const ref of ((f && f.refutes) || [])) {
        rows.push({ kind: 'refute', line: '反证：' + ref });
    }
    for (const s of list) {
        const label = LABEL[s.origin] || '未标注来源类别';
        const indep = (s.origin === RUMOR_ORIGINS.WITNESS || s.origin === RUMOR_ORIGINS.DOCUMENT) ? '独立' : '非独立';
        rows.push({
            kind: 'source', origin: s.origin,
            line: '来源 · ' + label + '（' + indep + '）· ' + (s.label || s.id || '(未具名)')
                + (s.rootKey && s.rootKey !== s.id ? ' · 同根 ' + s.rootKey : '')
                + (s.originRaw ? '（上游类别名「' + s.originRaw + '」不认识，按未标注列出）' : '')
                + (s.state === 'withdrawn' ? ' · **已撤回**（曾经有过，现在失效）' : ''),
        });
    }
    for (const w of ((f && f.withdrawn) || [])) {
        /* 被撤回的源若已在上面的清单里出现过（它就在 sources 里），不重复列。 */
        if (list.some((s) => s.id === w.id && s.state === 'withdrawn')) continue;
        rows.push({ kind: 'withdrawn', line: '已撤回：' + (w.label || w.id || '(未具名)') });
    }
    return rows.slice(0, RUMOR_LIMITS.rows);
}

/** 判据自证（十项）。 */
export function rumorSelfCheck() {
    const problems = [];
    const states = Object.values(RUMOR_STATES);
    if (new Set(states).size !== states.length) problems.push('传闻面各态必须互不相同');
    if (RUMOR_STATES.NO_CHAIN === RUMOR_STATES.ABSENT) problems.push('「没有可回溯来源」与「没有溯源面」必须不同形');
    if (RUMOR_STATES.SINGLE === RUMOR_STATES.CORROBORATED) problems.push('「孤证」与「互相印证」必须不同形');

    /* 一 派发相严格判 true。 */
    if (planRumorState(true, 0) !== RUMOR_STATES.NO_CHAIN) problems.push('有面但没链 ⇒ no-chain');
    if (planRumorState(false, 3) !== RUMOR_STATES.ABSENT) problems.push('没面 ⇒ absent（链数不作数）');
    for (const bad of [undefined, null, 0, 1, 'yes', {}]) {
        if (planRumorState(bad, 3) !== RUMOR_STATES.ABSENT) problems.push('派发相必须严格判 true：' + String(bad));
    }

    /* 二 ★ 转述不算独立来源（本项核心口径）。 */
    const oneRoot = normalizeRumorFace({
        claim: '甲搬走了',
        sources: [
            { id: 's1', origin: 'witness', rootKey: 'r1', label: '乙' },
            { id: 's2', origin: 'retell', rootKey: 'r1', label: '丙' },
            { id: 's3', origin: 'retell', rootKey: 'r1', label: '丁' },
        ],
    });
    if (oneRoot.independent !== 1) problems.push('★ 同一根下的多条只算一条独立来源，实测 ' + oneRoot.independent);
    if (oneRoot.retell !== 2) problems.push('转述必须单独计数，实测 ' + oneRoot.retell);
    if (oneRoot.state !== RUMOR_STATES.SINGLE) problems.push('★ 转述再多也还是孤证，实测 ' + oneRoot.state);
    if (corroborationLineOf(oneRoot).indexOf('孤证') < 0) problems.push('孤证必须明说：' + corroborationLineOf(oneRoot));

    /* 三 两个真正独立的来源 ⇒ 互相印证。 */
    const twoRoots = normalizeRumorFace({
        claim: '甲搬走了',
        sources: [
            { id: 's1', origin: 'witness', rootKey: 'r1', label: '乙' },
            { id: 's2', origin: 'document', rootKey: 'r2', label: '物业记录' },
        ],
    });
    if (twoRoots.independent !== 2) problems.push('两个不同根 ⇒ 两条独立来源');
    if (twoRoots.state !== RUMOR_STATES.CORROBORATED) problems.push('≥2 条独立来源 ⇒ corroborated');
    if (corroborationLineOf(twoRoots).indexOf('互相印证') < 0) problems.push('互相印证必须明说');
    if (corroborationLineOf(twoRoots) === corroborationLineOf(oneRoot)) problems.push('★ 两态必须不同句');

    /* 四 同根不同类别：仍算一条（同一件事的两种说法不是两个来源）。 */
    const sameRoot = normalizeRumorFace({
        sources: [{ id: 'a', origin: 'witness', rootKey: 'r' }, { id: 'b', origin: 'document', rootKey: 'r' }],
    });
    if (sameRoot.independent !== 1) problems.push('★ 同一根下不同类别仍只算一条独立来源');

    /* 五 未标注不算独立（判不了不硬算）。 */
    const unknown = normalizeRumorFace({ sources: [{ id: 'a', origin: 'unknown', rootKey: 'r1' }, { id: 'b', origin: 'weird-name', rootKey: 'r2' }] });
    if (unknown.independent !== 0) problems.push('★ 未标注来源不算独立（判不了不硬算）');
    if (unknown.unknown !== 2) problems.push('未标注必须单独计数，实测 ' + unknown.unknown);
    if (unknown.sources[1].originRaw !== 'weird-name') problems.push('不认识的类别名必须如实留下原名');
    /* ★ 判据要判**那条真的带了不认识的类别名**的行（第 2 条），不是「第一行」——
     *   第一条是 `origin:'unknown'`（上游明写未标注），它没有原名可点名。 */
    if (rumorRowsOf(unknown)[1].line.indexOf('weird-name') < 0) problems.push('读数行必须点名那个不认识的类别');

    /* 六 反证优先且独立成态。 */
    const disputed = normalizeRumorFace({
        sources: [{ id: 'a', origin: 'witness', rootKey: 'r1' }, { id: 'b', origin: 'witness', rootKey: 'r2' }],
        refutes: ['甲其实没搬'],
    });
    if (disputed.state !== RUMOR_STATES.DISPUTED) problems.push('有反证 ⇒ disputed');
    const rows = rumorRowsOf(disputed);
    if (rows[0].kind !== 'refute') problems.push('★ 反证必须排在最前（那是用户最该先看的一格）');
    if (corroborationLineOf(disputed).indexOf('有争议') < 0) problems.push('有争议必须明说');

    /* 七 被撤回的源不消失。 */
    const wd = normalizeRumorFace({
        sources: [{ id: 'a', origin: 'witness', rootKey: 'r1', label: '乙', state: 'withdrawn' }],
    });
    if (wd.withdrawn.length !== 1) problems.push('被撤回的源必须如实列出（不许拿掉）');
    if (rumorRowsOf(wd)[0].line.indexOf('已撤回') < 0) problems.push('读数行必须说清「已撤回」：' + rumorRowsOf(wd)[0].line);

    /* 八 没有链与读不到分形。 */
    const none = normalizeRumorFace({ claim: 'x' });
    const bad = normalizeRumorFace({ thrown: true });
    if (none.state !== RUMOR_STATES.NO_CHAIN) problems.push('没有来源 ⇒ no-chain');
    if (bad.state !== RUMOR_STATES.UNREADABLE) problems.push('取数失败 ⇒ unreadable');
    const lines = [none, bad, normalizeRumorFace(null)].map((f) => rumorLineOf(f));
    if (new Set(lines).size !== 3) problems.push('★ 三态「读不到」必须三句不同：' + lines.join(' | '));

    /* 九 不产任何可信度 / 热度（计划原文「不重复实现舆论热度」「不给人物贴骗子标签」）。 */
    const sample = JSON.stringify({ a: oneRoot, b: twoRoots, c: disputed, d: wd, e: unknown });
    for (const k of RUMOR_FORBIDDEN_KEYS) {
        if (sample.indexOf('"' + k + '"') >= 0) problems.push('读数里不得出现可信度/热度键：' + k);
    }

    /* 十 只读面 + 空件不抛。 */
    if (oneRoot.writesNothing !== true) problems.push('本件恒为只读面');
    if (rumorLineOf(null) !== '来源：读不到') problems.push('空面读数必须如实');
    if (rumorRowsOf(null).length !== 0) problems.push('空面不得编出任何来源行');

    return { problems: problems, states: states.length, origins: Object.keys(RUMOR_ORIGINS).length };
}

export default {
    RUMOR_STATES,
    RUMOR_ORIGINS,
    RUMOR_LIMITS,
    RUMOR_FORBIDDEN_KEYS,
    planRumorState,
    normalizeRumorFace,
    rumorLineOf,
    corroborationLineOf,
    rumorRowsOf,
    rumorSelfCheck,
};