/* ============================================================
 * config/setting-rewrite-contract.js — [v4.46.0 · 第五期 R5-X6]
 *   作者改设定的**影响预览**（纯契约件：零 DOM / 零存储 / 零网络 / 零时钟）
 * ------------------------------------------------------------
 * 【这一刀治的是什么（读码可复算，不是推演）】
 *   计划原文（R5-X6 现状证据）：
 *     「记忆纠错、导入更新和年鉴编辑已有入口；本项处理**有意修改成立设定及其后续**，
 *       不是又一个纠错面板。」
 *   实测复核：本仓已有的三个入口回答的都是**另外两问** ——
 *     · `config/memory-correction.js`（人工纠错四通道）：**这一条记忆对不对**；
 *     · `config/lore-import-contract.js`（资料导入向导）：**这份资料进不进得来**；
 *     · 年鉴编辑：**这一年记了些什么**。
 *   全仓零命中能回答第三问：**「我把这条设定改了，还有哪些地方挂着旧的那一句？」**
 *   于是作者改一条设定之后，那些引用它的约定、会面、人物档案**没有人会告诉他**，
 *   而它们会继续按旧设定被读出来 —— 不报错、不崩界面，只错读数（本仓最贵的形态）。
 *
 * 【本件与「又一个纠错面板」的分别（计划原文点名的分别）】
 *   · 纠错改的是**抽取**（让副模型重读原文再抽一次）或**单条内容**；
 *   · 本件处理的是**成立设定本身变了**：于是「以它为前件的那些东西要不要跟着变」
 *     必须逐项由人裁决 —— **保留原样**（那件事仍按当时写下来的算）或
 *     **按新设定重算**（那件事要跟着改）。两者处置相反，故不许合并成一个「更新」。
 *
 * 【★ 三态必须分形（验收原文点名的那两格）】
 *   验收旅程：「改人物住所的预览**列出相关会面而不误改无关财务**；……
 *             **未追踪关系明确标未知覆盖，不展示「全库无遗漏」**」。
 *   · `unaffected`（**明确不受影响**）：这一类引用面与该设定种类**无关**
 *     —— 处置是「什么都不做」，而且用户必须**看得见**它没被碰
 *     （否则他会怀疑「你是不是顺手把财务也改了」）。
 *     ★ 它**与有没有数据源无关**：口径表说这次改写碰不到它，就是碰不到
 *       —— 判据把它写在 spares 面，不看 tracked 面（这一条是本件的关键顺序）。
 *   · `untracked`（**判不了**）：这一类**会**受影响，但本机/上游没有它的数据源
 *     —— 处置是「先去把那一面接上」或「知道这次改动的覆盖是不完整的」。
 *   · `affected`（**受影响**）：挂着这条设定、且能取到具体是哪几条
 *     —— 处置是「逐项保留或重算」。
 *   把任意两态压成一格，用户读到的就是「都看过了」，而真实处境是「有一半根本没看」。
 *
 * 【为什么「受影响但没列出具体条目」要单列（`affected-not-listed`）】
 *   类目行说「会面这一类会受影响」而逐项行一条都没取到时，**不能凭一个类名去改**：
 *   那不是「改了一条」，而是「改了一个类」—— 计划原文的「不做：不批量覆写」正是这一格。
 *
 * 【五态（界面文案的唯一出处）】
 *   refused    —— 输入不合格（没说原事实 / 没说新设定 / 新旧一样）⇒ **一个字都不许写**；
 *   absent     —— 没有任何一类引用的数据源 ⇒ 判不了这次改动会碰到什么
 *                 （**不是**「没有受影响的」）；
 *   empty      —— 面能读，但**这一类里一件具体引用都没取到**（真读数，不是读不到）；
 *   ready      —— 有可判的引用面（逐类给态、逐项给行）；
 *   unreadable —— 取数抛了（如实报「读不到」，**不是**「没有受影响的」）。
 *
 * 【不做（计划原文两条 + 本仓既有纪律）】
 *   · 不批量覆写聊天原文（本件没有任何写出口；`writesNothing` 恒真）；
 *   · 不为本功能新建事务服务（本件不 import 任何 store、不落任何账）；
 *   · **不猜**：本机降级只认**字面出现**（见 `apps/memory/memory-app.js` 的
 *     `_localSettingImpact`），语义相似不算命中 —— 猜出来的「受影响」会让用户
 *     去改一件本来无关的事，而那个错误**看不见**。
 * ============================================================ */
'use strict';
function str(v) { return String(v == null ? '' : v).trim(); }
function strList(v, cap) {
    const out = [];
    if (!Array.isArray(v)) return out;
    for (const x of v) { const t = str(x); if (t && out.indexOf(t) < 0) out.push(t); if (out.length >= cap) break; }
    return out;
}

/** 被改的设定属于哪一类（**穷尽闭集**：口径表 `SR_TOUCH` 必须逐类给答案）。 */
export const SR_FACT_KINDS = Object.freeze({
    RESIDENCE: 'residence',
    ROLE: 'role',
    RELATION: 'relation',
    TIMELINE: 'timeline',
    MONEY: 'money'
});
export const SR_FACT_LABEL = Object.freeze({
    residence: '人物住所',
    role: '身份 / 职务',
    relation: '关系',
    timeline: '某件事的时间',
    money: '钱款 / 账目'
});
/** 可能引用它的面（**穷尽闭集**）。 */
export const SR_REF_KINDS = Object.freeze({
    COMMITMENT: 'commitment',
    MEETING: 'meeting',
    PERSON: 'person',
    CHAPTER: 'chapter',
    NOTE: 'note',
    FINANCE: 'finance'
});
export const SR_REF_LABEL = Object.freeze({
    commitment: '约定',
    meeting: '会面',
    person: '人物档案',
    chapter: '章节正文',
    note: '私人笔记',
    finance: '财务账'
});
const REF_KIND_LIST = Object.freeze(Object.keys(SR_REF_KINDS).map((k) => SR_REF_KINDS[k]));
/**
 * 口径表：**事实种类 → 引用面**。
 *
 * `affects` —— 这次改写**会**碰到（逐项由人决定保留或重算）；
 * `spares`  —— **明确不受影响**（口径上无关；用户必须看得见它没被碰）。
 *
 * 【穷尽性是自检项】每一类引用在每个事实种类下必须**恰出现在一侧**：
 *   两侧都写 ⇒ 同一件事两套答案；两侧都不写 ⇒ 那一类静默掉进「判不了」，
 *   而它其实是有答案的（只是没人写下来）。`srSelfCheck` 逐类核。
 *
 * 【为什么 `note` 恒在 spares】私人笔记是用户自己写的记录，不随设定自动改
 *   —— 它不在任何一类改写的射程里（本仓「不自动覆写用户手写内容」的既有口径）。
 */
export const SR_TOUCH = Object.freeze({
    residence: Object.freeze({
        affects: Object.freeze(['meeting', 'person', 'commitment', 'chapter']),
        spares: Object.freeze(['finance', 'note'])
    }),
    role: Object.freeze({
        affects: Object.freeze(['person', 'commitment', 'chapter']),
        spares: Object.freeze(['meeting', 'finance', 'note'])
    }),
    relation: Object.freeze({
        affects: Object.freeze(['person', 'meeting', 'chapter']),
        spares: Object.freeze(['commitment', 'finance', 'note'])
    }),
    timeline: Object.freeze({
        affects: Object.freeze(['commitment', 'meeting', 'chapter']),
        spares: Object.freeze(['person', 'finance', 'note'])
    }),
    money: Object.freeze({
        affects: Object.freeze(['finance']),
        spares: Object.freeze(['commitment', 'meeting', 'person', 'chapter', 'note'])
    })
});
/** 预览面态（五态互不同形）。 */
export const SR_STATES = Object.freeze({
    REFUSED: 'refused',
    ABSENT: 'absent',
    EMPTY: 'empty',
    READY: 'ready',
    UNREADABLE: 'unreadable'
});
/** 单条 / 单类在**这次改写**下的态（四态互不同形）。 */
export const SR_ITEM_STATES = Object.freeze({
    AFFECTED: 'affected',
    UNAFFECTED: 'unaffected',
    UNTRACKED: 'untracked',
    NO_FACT: 'no-fact'
});
/** 逐项决定（两态处置相反，不许合并成一个「更新」）。 */
export const SR_DECISIONS = Object.freeze({
    KEEP: 'keep',
    RECOMPUTE: 'recompute'
});
export const SR_DECISION_LABEL = Object.freeze({
    keep: '保留原样',
    recompute: '按新设定重算'
});
/** 拒收归因词（判据按此表逐词核，防随口新词）。 */
export const SR_REASONS = Object.freeze({
    OK: '',
    NO_FACT: 'rewrite-no-fact',
    BAD_FACT_KIND: 'rewrite-bad-fact-kind',
    NO_NEXT: 'rewrite-no-next',
    SAME_TEXT: 'rewrite-same-text'
});
export const SR_REASON_TEXT = Object.freeze({
    'rewrite-no-fact': '没有给出**原事实**（改的是哪一条都还不知道）—— 一个字都没写',
    'rewrite-bad-fact-kind': '认不出这条设定属于哪一类（本版的口径表里没有它）—— 一个字都没写',
    'rewrite-no-next': '没有给出**新设定**（要改成什么都不清楚）—— 一个字都没写',
    'rewrite-same-text': '新设定与原来**一样**（这不是改写）—— 一个字都没写'
});
export const SR_LIMITS = Object.freeze({
    refs: 60,       // 一次最多列几条引用
    label: 60,      // 单条标签最长
    ledger: 40      // 本机台账最多留几次改写
});

/** 事实指纹（「换了原事实」必须能判出来）。 */
export function factKeyOf(fact) {
    const f = (fact && typeof fact === 'object') ? fact : {};
    return str(f.kind) + '|' + str(f.text);
}
/** 一次改写的**幂等键**：原事实 + 新设定。同一份改写第二次确认即命中，不双建。 */
export function rewriteKeyOf(fact, next) {
    const f = (fact && typeof fact === 'object') ? fact : {};
    return str(f.kind) + '|' + str(f.text) + '→' + str(next);
}

/**
 * 归一**一条引用 / 一个引用类**在这次改写下的态。
 *
 * 【判定顺序是本件的核心（改序即改结论）】
 *   ① 认不出属于哪一类 ⇒ `no-fact`（判不了该不该改）；
 *   ② 口径表两侧都没写 ⇒ `untracked`（口径有缺口，如实说，不硬猜）；
 *   ③ **在 spares 里 ⇒ `unaffected`** —— ★ 这一条**先于** tracked 判定：
 *      与设定无关的引用面**无论有没有数据源都明确不受影响**（那是口径的必然，
 *      不是数据的运气）。放在 tracked 之后，财务就会因「本机没有财务数据源」
 *      被读成「判不了」，而验收原文要的恰恰是「**不误改无关财务**」这句可见的读数；
 *   ④ 在 affects 里但这一类**没有追踪数据源** ⇒ `untracked`（会受影响但判不了）；
 *   ⑤ 在 affects 里且有数据源 ⇒ `affected`（逐项由人决定）。
 *
 * @param {object} raw `{ id, kind, label, ref, place, who }`
 * @param {string} factKind 被改的设定种类
 * @param {Array<string>} trackedKinds 有数据源的引用类
 * @param {string} rowKind `'face'`（类目行）/ `'ref'`（逐项行）
 */
function normalizeImpactRow(raw, factKind, trackedKinds, rowKind) {
    const r = (raw && typeof raw === 'object') ? raw : {};
    const kind = str(r.kind);
    const tracked = Array.isArray(trackedKinds) ? trackedKinds.map(str) : [];
    const touch = SR_TOUCH[str(factKind)] || null;
    const fl = SR_FACT_LABEL[str(factKind)] || str(factKind);
    const base = {
        rowKind: str(rowKind) || 'ref',
        id: str(r.id || r.ref), kind: kind,
        label: str(r.label || r.text).slice(0, SR_LIMITS.label),
        ref: str(r.ref || r.id), place: str(r.place), who: str(r.who),
        state: SR_ITEM_STATES.UNTRACKED, why: '', decision: ''
    };
    if (!kind || !SR_REF_LABEL[kind]) {
        return Object.assign({}, base, {
            state: SR_ITEM_STATES.NO_FACT,
            why: '这一条引用**没有说它属于哪一类** ⇒ 判不了该不该跟着改（不是「不受影响」）'
        });
    }
    const rl = SR_REF_LABEL[kind];
    if (!touch) {
        return Object.assign({}, base, {
            state: SR_ITEM_STATES.UNTRACKED,
            why: '认不出被改的设定属于哪一类 ⇒ 判不了（不是「不受影响」）'
        });
    }
    const inAffects = touch.affects.indexOf(kind) >= 0;
    const inSpares = touch.spares.indexOf(kind) >= 0;
    if (!inAffects && !inSpares) {
        return Object.assign({}, base, {
            state: SR_ITEM_STATES.UNTRACKED,
            why: '「' + rl + '」在口径表里**既不在受影响面也不在豁免面**（口径有缺口）⇒ 判不了'
        });
    }
    if (inSpares) {
        return Object.assign({}, base, {
            state: SR_ITEM_STATES.UNAFFECTED,
            why: '与「' + fl + '」无关的引用面 ⇒ **明确不受影响**（这次改写不会碰它）'
        });
    }
    if (tracked.indexOf(kind) < 0) {
        return Object.assign({}, base, {
            state: SR_ITEM_STATES.UNTRACKED,
            why: '「' + rl + '」会受「' + fl + '」影响，但**本机与上游都没有它的数据源** ⇒ 判不了（不是「不受影响」）'
        });
    }
    return Object.assign({}, base, {
        state: SR_ITEM_STATES.AFFECTED,
        why: '它挂着「' + fl + '」这条设定 ⇒ 要你逐项决定：保留原样还是按新设定重算'
    });
}

/**
 * 一次取齐**整个影响面**（本件唯一装配点）。
 *
 * @param {object} input
 *   · `fact`         `{ kind, text }` 原事实（**必须有 text**：改的是哪一条要说得出来）
 *   · `next`         新设定
 *   · `refs`         取到的引用（每项 `{ id, kind, label, ref }`）
 *   · `trackedKinds` 有数据源的引用类
 *   · `prevKey`      上一次预览的事实指纹（**与本次不同 ⇒ 旧预览整块作废**）
 *   · `unreadable` / `thrown` 取数失败
 * @returns {object} 面读数（`line` 是**唯一**的人读出处）
 */
export function buildImpactPreview(input = {}) {
    const o = (input && typeof input === 'object' && !Array.isArray(input)) ? input : {};
    const fact = (o.fact && typeof o.fact === 'object' && !Array.isArray(o.fact)) ? o.fact : null;
    const factKind = fact ? str(fact.kind) : '';
    const from = fact ? str(fact.text) : '';
    const to = str(o.next);
    const base = {
        state: SR_STATES.ABSENT, factKind: factKind, from: from, to: to,
        key: rewriteKeyOf(fact, to), stale: false, reason: '',
        items: [], refs: [],
        affected: [], unaffected: [], untracked: [], unnamed: [],
        faceAffected: [], faceUnaffected: [], faceUntracked: [],
        coverage: { tracked: [], untracked: [], unaffected: [], complete: false },
        line: '', why: '', writesNothing: true
    };
    /* ★ 早退分支也必须带 `line`：读数的唯一出处就是这里，空读数在界面上就是一片空白
       —— 用户看到的不是「拒收了」，而是「什么都没发生」（自证十六项里
       「拒收读数必须明说零写」「读不到的读数必须说出来」正是钉这一格）。 */
    const finish = (obj) => {
        const f = Object.assign({}, base, obj);
        f.line = impactLine(f);
        return f;
    };
    const refused = (reason) => finish({
        state: SR_STATES.REFUSED, why: SR_REASON_TEXT[reason] || reason, reason: reason
    });
    if (!fact || !from) return refused(SR_REASONS.NO_FACT);
    if (!SR_FACT_LABEL[factKind]) return refused(SR_REASONS.BAD_FACT_KIND);
    if (!to) return refused(SR_REASONS.NO_NEXT);
    if (to === from) return refused(SR_REASONS.SAME_TEXT);
    if (o.unreadable === true || o.thrown === true) {
        return finish({
            state: SR_STATES.UNREADABLE,
            why: '取数失败（已降级）—— 这是「读不到」，**不是**「没有受影响的引用」'
        });
    }
    /* ★ 只认本版口径表里的引用类：传进来的陌生类名**不算数据源**
       （否则一个拼错的类名就能把面抬成 ready，而那一类其实没人认识）。 */
    const tracked = strList(o.trackedKinds, REF_KIND_LIST.length)
        .filter((k) => REF_KIND_LIST.indexOf(k) >= 0);
    if (!tracked.length) {
        return finish({
            state: SR_STATES.ABSENT,
            why: '本机与上游都没有**任何一类**引用的数据源 ⇒ 判不了这次改动会碰到什么（不是「没有受影响的」）'
        });
    }
    const faceRows = REF_KIND_LIST.map((k) =>
        normalizeImpactRow({ id: 'face:' + k, kind: k, label: SR_REF_LABEL[k] }, factKind, tracked, 'face'));
    const refRows = [];
    const unnamed = [];
    const rawRefs = Array.isArray(o.refs) ? o.refs.slice(0, SR_LIMITS.refs) : [];
    for (const r of rawRefs) {
        const row = normalizeImpactRow(r, factKind, tracked, 'ref');
        if (!row.id) unnamed.push(row); else refRows.push(row);
    }
    const faceAffected = faceRows.filter((x) => x.state === SR_ITEM_STATES.AFFECTED).map((x) => x.kind);
    const faceUnaffected = faceRows.filter((x) => x.state === SR_ITEM_STATES.UNAFFECTED).map((x) => x.kind);
    const faceUntracked = faceRows.filter((x) => x.state === SR_ITEM_STATES.UNTRACKED).map((x) => x.kind);
    const prevKey = str(o.prevKey);
    const stale = !!prevKey && prevKey !== factKeyOf(fact);
    const items = faceRows.concat(refRows);
    /* ★ 有类目受影响、但**该类下一条逐项行都没取到**的类。
       这一格必须单独算出来并说出来：只报「受影响 1 条」会让用户以为
       「这次只牵动会面」——而人物档案那一类同样会受影响，只是没取到条目。
       计划原文的「不误改」是双向的：不许改到无关的，也不许**漏报**相关的。 */
    const affectedRefKinds = refRows
        .filter((x) => x.state === SR_ITEM_STATES.AFFECTED).map((x) => x.kind);
    const faceAffectedNoRefs = faceAffected.filter((k) => affectedRefKinds.indexOf(k) < 0);
    const face = Object.assign({}, base, {
        state: refRows.length ? SR_STATES.READY : SR_STATES.EMPTY,
        stale: stale,
        items: items, refs: refRows,
        affected: refRows.filter((x) => x.state === SR_ITEM_STATES.AFFECTED),
        unaffected: refRows.filter((x) => x.state === SR_ITEM_STATES.UNAFFECTED),
        untracked: refRows.filter((x) => x.state === SR_ITEM_STATES.UNTRACKED || x.state === SR_ITEM_STATES.NO_FACT),
        unnamed: unnamed,
        faceAffected: faceAffected, faceUnaffected: faceUnaffected, faceUntracked: faceUntracked,
        faceAffectedNoRefs: faceAffectedNoRefs,
        coverage: {
            tracked: faceAffected,
            untracked: faceUntracked,
            unaffected: faceUnaffected,
            complete: faceUntracked.length === 0
        }
    });
    face.line = impactLine(face);
    return face;
}

/**
 * 一行读数（**唯一出处**）。五态分句 + 三列计数 + 覆盖诚实性 + 作废警告。
 *
 * 【★ 覆盖不足必须说出来】只要有一类受影响面没被追踪，读数就明说「未追踪 N 类」
 *   并点明「判不了」；**不许**出现「都追到了」这种肯定句
 *   （验收原文：不展示「全库无遗漏」）。反过来，全覆盖时也不许含糊其辞。
 */
export function impactLine(face) {
    const f = (face && typeof face === 'object') ? face : null;
    if (!f) return '改设定：读不到';
    if (f.state === SR_STATES.REFUSED) return '改设定：' + (f.why || '输入不合格（一个字都没写）');
    if (f.state === SR_STATES.UNREADABLE) return '改设定：取数失败（**读不到** ≠ 没有受影响的引用）';
    if (f.state === SR_STATES.ABSENT) return '改设定：' + (f.why || '没有任何一类引用的数据源（判不了）');
    const head = '改「' + (SR_FACT_LABEL[f.factKind] || f.factKind) + '」：'
        + (f.from || '(没给原事实)') + ' → ' + (f.to || '(没给新设定)');
    const bits = [];
    if (f.state === SR_STATES.EMPTY) {
        bits.push('这一类里**没有一条引用**（真读数，不是读不到）');
    } else {
        bits.push('受影响 ' + f.affected.length + ' 条');
    }
    const noRefs = Array.isArray(f.faceAffectedNoRefs) ? f.faceAffectedNoRefs : [];
    if (noRefs.length) {
        bits.push('其中 ' + noRefs.length + ' 类会受影响但**一条具体引用都没取到**'
            + '（' + noRefs.map((k) => SR_REF_LABEL[k] || k).join(' / ') + '）—— 不能凭一个类名去改');
    }
    if (f.faceUnaffected.length) {
        bits.push('明确不受影响 ' + f.faceUnaffected.length + ' 类'
            + '（' + f.faceUnaffected.map((k) => SR_REF_LABEL[k] || k).join(' / ') + '）');
    }
    if (f.faceUntracked.length) {
        bits.push('**未追踪 ' + f.faceUntracked.length + ' 类**'
            + '（' + f.faceUntracked.map((k) => SR_REF_LABEL[k] || k).join(' / ') + '）'
            + '—— 判不了，别当成「都追到了」');
    } else {
        bits.push('受影响的引用面**都接上了数据源**');
    }
    if (f.unnamed.length) bits.push('另有 ' + f.unnamed.length + ' 条引用**没有身份**（判不了该改哪一条）');
    if (f.stale) bits.push('· **原事实或新设定已变，旧预览作废 —— 必须重挑**');
    return head + '：' + bits.join(' · ');
}

/** 逐行（**四态各有各的形**；只排版，不重判）。 */
export function impactRows(face) {
    const f = (face && typeof face === 'object') ? face : null;
    const list = (f && Array.isArray(f.items)) ? f.items : [];
    const TAG = {
        affected: '受影响', unaffected: '不受影响',
        untracked: '判不了', 'no-fact': '判不了'
    };
    return list.map(function (x) {
        const isFace = x.rowKind === 'face';
        return {
            id: x.id, kind: x.kind, state: x.state, rowKind: x.rowKind, ref: x.ref,
            needDecision: (!isFace && x.state === SR_ITEM_STATES.AFFECTED),
            tag: TAG[x.state] || x.state,
            line: '【' + (TAG[x.state] || x.state) + '】' + (SR_REF_LABEL[x.kind] || x.kind)
                + (isFace ? '' : ' · ' + (x.label || x.id || '(未具名)'))
                + ' —— ' + x.why
        };
    });
}

/**
 * 逐项决定（**不许默认**）。
 *
 * 【为什么未决定必须拦住】「默认保留」与「默认重算」都会让用户在**没做过决定**的
 *   情况下拿到一份「已经处理好了」的读数 —— 前者丢掉他本想改的，后者改掉他本想留的。
 *   两者都是**不可见**的错，故本函数把未决定项数列出来，闸门据此拦住确认。
 *
 * 【★ 给不该改的项下决定要报出来】那就是「顺手改无关财务」的写法：
 *   明明口径表说这一类不受影响（或判不了），却给了决定 —— 一律进 `ignored`。
 */
export function planDecisions(face, picks) {
    const f = (face && typeof face === 'object') ? face : null;
    const map = (picks && typeof picks === 'object' && !Array.isArray(picks)) ? picks : {};
    const out = { rows: [], counts: { keep: 0, recompute: 0, undecided: 0 }, ignored: [], ok: false, why: '' };
    if (!f) { out.why = '判不了（没有这一面）'; return out; }
    if (f.state !== SR_STATES.READY && f.state !== SR_STATES.EMPTY) {
        out.why = '这一面现在不能做逐项决定（面态：' + str(f.state) + '）';
        return out;
    }
    const items = Array.isArray(f.items) ? f.items : [];
    for (const it of items) {
        if (it.rowKind !== 'ref') continue;
        const d = str(map[it.id]);
        if (it.state === SR_ITEM_STATES.AFFECTED) {
            if (!d) {
                out.counts.undecided += 1;
                out.rows.push({ id: it.id, decision: '', line: '【还没决定】' + (it.label || it.id) });
                continue;
            }
            if (!SR_DECISION_LABEL[d]) {
                out.counts.undecided += 1;
                out.rows.push({ id: it.id, decision: '', line: '【决定认不出】' + (it.label || it.id) + ' —— 「' + d + '」不是本版的两种决定之一' });
                continue;
            }
            if (d === SR_DECISIONS.KEEP) out.counts.keep += 1; else out.counts.recompute += 1;
            out.rows.push({ id: it.id, decision: d, line: '【' + SR_DECISION_LABEL[d] + '】' + (it.label || it.id) });
            continue;
        }
        if (d) {
            out.ignored.push({
                id: it.id, state: it.state, decision: d,
                line: '「' + (it.label || it.id) + '」是'
                    + (it.state === SR_ITEM_STATES.UNAFFECTED ? '**明确不受影响**的' : '**判不了**的')
                    + '引用，却给了「' + (SR_DECISION_LABEL[d] || d) + '」的决定 —— 不顺手改它'
            });
        }
    }
    out.ok = out.counts.undecided === 0 && out.ignored.length === 0;
    if (out.counts.undecided) out.why = '还有 ' + out.counts.undecided + ' 项没决定（**不许默认保留，也不许默认重算**）';
    else if (out.ignored.length) out.why = '有 ' + out.ignored.length + ' 项不该被改却给了决定（见 ignored）';
    return out;
}

/**
 * 确认闸（验收原文「取消零写」的那道闸）。读数分形：可以确认（覆盖不足时必须带出来）/
 * **必须重挑**（stale）/ 一件都不能改（拒收 · 读不到 · 无数据源 · **有类受影响却没取到条目**）。
 */
export function commitGate(face, plan) {
    const f = (face && typeof face === 'object') ? face : null;
    if (!f) return { ok: false, reason: 'no-face', line: '判不了（没有这一面）' };
    if (f.state === SR_STATES.REFUSED) return { ok: false, reason: 'refused', line: '不能确认：' + (f.why || '输入不合格（一个字都没写）') };
    if (f.state === SR_STATES.UNREADABLE) return { ok: false, reason: 'unreadable', line: '不能确认：取数失败（读不到 ≠ 没有受影响的引用）' };
    if (f.state === SR_STATES.ABSENT) return { ok: false, reason: 'absent', line: '不能确认：没有任何一类引用的数据源（判不了）' };
    if (f.stale) return { ok: false, reason: 'stale', line: '**必须重挑**：原事实或新设定已经变了，旧预览作废（不能沿旧预览一键确认）' };
    const affected = Array.isArray(f.affected) ? f.affected.length : 0;
    const noRefs = Array.isArray(f.faceAffectedNoRefs) ? f.faceAffectedNoRefs : [];
    const untrackedFace = Array.isArray(f.faceUntracked) ? f.faceUntracked.length : 0;
    /* ★ 先拦「有类受影响、却没取到该类下任何一条具体引用」。
       这一格有两个身份，缺一不可：
         · 不能凭一个类名去改（计划原文「不批量覆写」）；
         · 已定好的逐项决定**不足以覆盖**这一类 —— 只报「可以确认」会让用户以为
           受影响面全都处理过了，而有一类他连条目都没看见（**漏报**，比误改更隐蔽）。 */
    if (noRefs.length) {
        return {
            ok: false, reason: 'affected-not-listed',
            line: '不能确认：有 ' + noRefs.length + ' 类会受影响，但**一条具体引用都没取到**（'
                + noRefs.map((k) => SR_REF_LABEL[k] || k).join(' / ')
                + '）—— 不能凭一个类名去改'
        };
    }
    /* 【为什么「判不了的面不拦确认」有一条前提】有**至少一条**可裁决条目时，判不了＝
       「本机与上游都没有那一类的数据源」，拦住就等于数据源接上前一件事都改不了
       （与验收相悖）；验收要的是**看得见** —— 它进预览读数、进逐行、进 `coverage`，
       并在下面那句确认读数末尾**带出来**。 */
    if (!affected) {
        /* ★ 但「一件可裁决条目都没有」是另一回事：所有受影响类都判不了
           （或一条具名引用都没取到时已由上面那格拦住）。
           此时确认写下的是一个**空改写**——台账里记了一笔、却没有任何一项决定，
           用户下一次回读会以为「处理过了」。故这一支必须拦，且读数点明「先接数据源」。 */
        if (untrackedFace) {
            return {
                ok: false, reason: 'untracked-face',
                line: '不能确认：受影响面里有 ' + untrackedFace + ' 类**判不了**（'
                    + f.faceUntracked.map((k) => SR_REF_LABEL[k] || k).join(' / ')
                    + '），一件可裁决的条目都没有 —— 先把那一面接上，或者知道这次改动的覆盖是不完整的'
            };
        }
    }
    const p = (plan && typeof plan === 'object') ? plan : null;
    if (!p || p.ok !== true) {
        return { ok: false, reason: 'undecided', line: '不能确认：' + ((p && p.why) || '逐项决定还没做完') };
    }
    /* 确认读数必须把覆盖不足**带出来**：判不了的面不拦确认，但它不许消失
       —— 否则用户在点下确认的那一刻，看到的是一句无保留的「可以确认」。 */
    const covNote = untrackedFace
        ? '；另有 ' + untrackedFace + ' 类**判不了**（'
            + f.faceUntracked.map((k) => SR_REF_LABEL[k] || k).join(' / ')
            + '），这次改动的覆盖**不是**完整的'
        : '';
    return {
        ok: true, reason: '',
        line: '可以确认：' + affected + ' 项逐项都定了（保留 ' + p.counts.keep + ' / 重算 ' + p.counts.recompute + '）'
            + covNote
    };
}

/**
 * 撤销那一格（验收原文「确认后重开与撤销可回读」）。
 *
 * 【三态必须分形】可撤 / **已经撤过**（noop）/ **本机台账里没有这一次改写**（refused）。
 *   把「撤过了」报成「撤成功」，用户会以为刚刚发生了一次撤销；
 *   把「没见过这次改写」报成「撤过了」，他会以为早撤干净了 —— 而其实本机从来没记过它。
 */
export function planUndo(ledger, key) {
    const k = str(key);
    if (!k) return { ok: false, state: 'refused', reason: 'undo-no-key', line: '不能撤销：没有说撤哪一次改写' };
    const rows = (ledger && Array.isArray(ledger.entries)) ? ledger.entries : [];
    const hit = rows.find((e) => e && str(e.key) === k) || null;
    if (!hit) {
        return {
            ok: false, state: 'refused', reason: 'undo-unknown',
            line: '不能撤销：本机台账里**没有这一次改写**（不是「撤过了」）'
        };
    }
    if (hit.undone === true) {
        return {
            ok: false, state: 'noop', reason: 'undo-already',
            line: '不用撤：这一次改写**已经撤过**了（台账里有留痕，重开也看得到）'
        };
    }
    const n = Array.isArray(hit.rows) ? hit.rows.length : 0;
    return {
        ok: true, state: 'applied', reason: '',
        line: '可以撤销：' + (SR_FACT_LABEL[str(hit.factKind)] || str(hit.factKind))
            + '「' + str(hit.from) + ' → ' + str(hit.to) + '」这次改写（' + n + ' 项决定）'
    };
}

/** 本机台账一行（**重开可查**的落点）。 */
export function srLedgerLine(ledger) {
    const l = (ledger && typeof ledger === 'object' && !Array.isArray(ledger)) ? ledger : null;
    const rows = (l && Array.isArray(l.entries)) ? l.entries : [];
    if (!rows.length) return '改写台账：还没确认过任何一次改写（重开也是这个读数）';
    const undone = rows.filter((e) => e && e.undone === true).length;
    const local = rows.filter((e) => e && e.localOnly === true).length;
    return '改写台账：本机记了 ' + rows.length + ' 次'
        + '（已撤 ' + undone + ' · 只落本机 ' + local + '）—— 重开可查';
}
/**
 * 十六项自证（**读码可复算**，不是自评）。每项失败进 `problems`。
 *
 * 【为什么自证要写在契约件里】下面这些不变量就是本件的**语义**本身 ——
 *   判定顺序（spares 先于 tracked）、覆盖诚实性（未追踪必须说出来）、
 *   三态分形（读不到 / 没有 / 拒收、可撤 / 撤过 / 没见过）。
 *   写在契约件里，任何一处被改坏都当场红在最近的地方，而不是等判据套件
 *   或用户读数来发现。
 *
 * @returns {{problems: Array<string>, factKinds: number, refKinds: number}}
 */
export function srSelfCheck() {
    const problems = [];
    const factKinds = Object.keys(SR_FACT_KINDS).map((k) => SR_FACT_KINDS[k]);
    const refKinds = REF_KIND_LIST;

    /* 一 口径表穷尽性：每类引用在每个事实种类下**恰在一侧**（不空、不双写）。 */
    for (const fk of factKinds) {
        const t = SR_TOUCH[fk];
        if (!t) { problems.push('口径表缺这一类：' + fk); continue; }
        for (const rk of refKinds) {
            const a = t.affects.indexOf(rk) >= 0;
            const s = t.spares.indexOf(rk) >= 0;
            if (!a && !s) problems.push('★ ' + fk + ' 的「' + rk + '」两侧都没写（会静默掉进判不了）');
            if (a && s) problems.push('★ ' + fk + ' 的「' + rk + '」两侧都写了（同一件事两套答案）');
        }
    }
    /* 二 每个事实种类至少影响一类（否则确认闸里那两格之外就有了活路径）。 */
    for (const fk of factKinds) {
        const t = SR_TOUCH[fk] || { affects: [] };
        if (!t.affects.length) problems.push('★ ' + fk + ' 一类都不影响（闸门的死码假设被破坏）');
    }
    /* 三 私人笔记恒在豁免面（不自动覆写用户手写内容）。 */
    for (const fk of factKinds) {
        const t = SR_TOUCH[fk] || { affects: [], spares: [] };
        if (t.affects.indexOf('note') >= 0) problems.push('★ ' + fk + ' 把私人笔记算进受影响面（会去改用户手写的东西）');
    }
    /* 四 钱款只动财务面（「不误改无关财务」的反面：改钱款就得动财务）。 */
    if (SR_TOUCH.money.affects.join() !== 'finance') problems.push('★ 改钱款必须恰影响财务面');

    /* 五 拒收四态各归其因，且**一个字都不写**（取消零写的那一半）。 */
    const noFact = buildImpactPreview({ next: 'X' });
    const badKind = buildImpactPreview({ fact: { kind: 'nope', text: 'A' }, next: 'B' });
    const noNext = buildImpactPreview({ fact: { kind: 'residence', text: 'A' } });
    const same = buildImpactPreview({ fact: { kind: 'residence', text: 'A' }, next: 'A' });
    if (noFact.reason !== SR_REASONS.NO_FACT) problems.push('★ 没给原事实必须拒收');
    if (badKind.reason !== SR_REASONS.BAD_FACT_KIND) problems.push('★ 认不出的事实种类必须拒收');
    if (noNext.reason !== SR_REASONS.NO_NEXT) problems.push('★ 没给新设定必须拒收');
    if (same.reason !== SR_REASONS.SAME_TEXT) problems.push('★ 新旧一样必须拒收');
    const refusedList = [['noFact', noFact], ['badKind', badKind], ['noNext', noNext], ['same', same]];
    for (const pair of refusedList) {
        const nm = pair[0], face = pair[1];
        if (face.state !== SR_STATES.REFUSED) problems.push('★ 必须报拒收：' + nm);
        if (face.writesNothing !== true || face.items.length !== 0) problems.push('★ 拒收面必须零写零列：' + nm);
        if (face.line.indexOf('一个字都没写') < 0) problems.push('★ 拒收读数必须明说零写：' + nm);
    }
    /* 六 「读不到」与「没有任何数据源」必须不同形。 */
    const unread = buildImpactPreview({ fact: { kind: 'residence', text: 'A' }, next: 'B', thrown: true });
    const absent = buildImpactPreview({ fact: { kind: 'residence', text: 'A' }, next: 'B' });
    if (unread.state !== SR_STATES.UNREADABLE) problems.push('★ 取数失败必须报读不到');
    if (absent.state !== SR_STATES.ABSENT) problems.push('★ 无数据源必须报判不了');
    if (unread.state === absent.state) problems.push('★「读不到」与「没有数据源」必须不同形');
    if (unread.line.indexOf('读不到') < 0) problems.push('★ 读不到的读数必须说出来');
    /* 七 陌生类名不算数据源（拼错的类名不许把面抬起来）。 */
    const bogus = buildImpactPreview({
        fact: { kind: 'residence', text: 'A' }, next: 'B', trackedKinds: ['nope']
    });
    if (bogus.state !== SR_STATES.ABSENT) problems.push('★ 陌生类名不得当数据源');

    /* 八 ★验收格一：改住所 ⇒ 会面受影响、财务**明确不受影响**（判定顺序不许倒）。 */
    const mv = buildImpactPreview({
        fact: { kind: 'residence', text: '旧居' }, next: '新居',
        trackedKinds: ['meeting', 'person'],
        refs: [{ id: 'apt_1', kind: 'meeting', label: '周五搬家' }]
    });
    if (mv.faceAffected.indexOf('meeting') < 0) problems.push('★ 改住所必须让会面落在受影响面');
    if (mv.faceUnaffected.indexOf('finance') < 0) problems.push('★ 改住所必须让财务明确不受影响（顺序倒了会读成判不了）');
    if (mv.faceUnaffected.indexOf('note') < 0) problems.push('★ 改住所必须让私人笔记明确不受影响');
    if (mv.affected.length !== 1) problems.push('★ 改住所的逐项行必须恰 1 条');
    if (mv.line.indexOf('明确不受影响') < 0) problems.push('★ 不受影响必须在读数里看得见');
    /* 九 ★验收格二：改钱款 ⇒ 财务受影响、会面明确不受影响。 */
    const mn = buildImpactPreview({
        fact: { kind: 'money', text: '借 100' }, next: '借 200',
        trackedKinds: ['finance', 'meeting'],
        refs: [{ id: 'fin_1', kind: 'finance', label: '借款记录' }]
    });
    if (mn.faceAffected.indexOf('finance') < 0) problems.push('★ 改钱款必须让财务落在受影响面');
    if (mn.faceUnaffected.indexOf('meeting') < 0) problems.push('★ 改钱款必须让会面明确不受影响');
    if (mn.affected.length !== 1) problems.push('★ 改钱款的逐项行必须恰 1 条');

    /* 十 覆盖不足必须说出来；全覆盖时不许含糊（验收原文：不展示「全库无遗漏」）。 */
    const allAff = SR_TOUCH.residence.affects.slice();
    const full = buildImpactPreview({
        fact: { kind: 'residence', text: '旧居' }, next: '新居',
        trackedKinds: allAff,
        refs: [
            { id: 'apt_1', kind: 'meeting', label: '周五搬家' },
            { id: 'per_1', kind: 'person', label: '人物档案：住处' },
            { id: 'cmt_1', kind: 'commitment', label: '约定：去他家' },
            { id: 'chp_1', kind: 'chapter', label: '第 12 章正文' }
        ]
    });
    if (full.coverage.complete !== true) problems.push('★ 全覆盖时 coverage.complete 必须为真');
    if (full.line.indexOf('未追踪') >= 0) problems.push('★ 全覆盖时不得报未追踪');
    if (full.line.indexOf('都接上了数据源') < 0) problems.push('★ 全覆盖也要明说（不许含糊）');
    if (full.faceAffectedNoRefs.length) problems.push('★ 全覆盖且条目齐时不得报「有类没取到条目」');
    /* 十之一 全覆盖但某类一条条目都没取到 ⇒ 类级拦截（防漏报）。 */
    const gap = buildImpactPreview({
        fact: { kind: 'residence', text: '旧居' }, next: '新居',
        trackedKinds: allAff,
        refs: [{ id: 'apt_1', kind: 'meeting', label: '周五搬家' }]
    });
    if (gap.faceAffectedNoRefs.indexOf('person') < 0) problems.push('★ 受影响却没条目的类必须单列出来（防漏报）');
    if (gap.line.indexOf('一条具体引用都没取到') < 0) problems.push('★ 读数必须点明「有类会受影响但一条条目都没取到」');
    const gGap = commitGate(gap, planDecisions(gap, { apt_1: 'keep' }));
    if (gGap.ok || gGap.reason !== 'affected-not-listed') problems.push('★ 有类没取到条目必须拦住确认（逐项决定不足以覆盖）');
    const part = buildImpactPreview({
        fact: { kind: 'residence', text: '旧居' }, next: '新居',
        trackedKinds: ['meeting'],
        refs: [{ id: 'apt_1', kind: 'meeting', label: '周五搬家' }]
    });
    if (part.faceUntracked.indexOf('person') < 0) problems.push('★ 会受影响却没数据源的面必须判不了');
    if (part.coverage.complete !== false) problems.push('★ 覆盖不完整时 coverage.complete 必须为假');
    if (part.line.indexOf('未追踪') < 0) problems.push('★ 覆盖不足必须在读数里说出来');
    if (part.line.indexOf('别当成') < 0) problems.push('★ 覆盖不足必须点明「别当成都追到了」');
    if (mv.coverage.complete !== false) problems.push('★ mv 这一面覆盖不完整（commitment/chapter 未追踪）');

    /* 十一 没有身份的引用单列（判不了该改哪一条）。 */
    const un = buildImpactPreview({
        fact: { kind: 'residence', text: '旧居' }, next: '新居',
        trackedKinds: ['meeting'], refs: [{ kind: 'meeting', label: '无身份的会面' }]
    });
    if (!un.unnamed.length) problems.push('★ 没有身份的引用必须单列');
    if (un.state !== SR_STATES.EMPTY) problems.push('★ 只有未具名引用时面态是 empty（真读数）');
    if (un.line.indexOf('没有身份') < 0) problems.push('★ 未具名必须在读数里说出来');

    /* 十二 逐项决定：未决定拦住；认不出的决定算未决定；台账外的 id 不算乱决定。 */
    const p1 = planDecisions(mv, {});
    if (p1.counts.undecided !== 1 || p1.ok !== false) problems.push('★ 未决定必须拦住（不许默认保留/重算）');
    const p2 = planDecisions(mv, { apt_1: 'keep' });
    if (!p2.ok || p2.counts.keep !== 1 || p2.counts.recompute !== 0) problems.push('★ 逐项「保留」必须通过且分列');
    const p3 = planDecisions(mv, { apt_1: 'recompute' });
    if (!p3.ok || p3.counts.recompute !== 1 || p3.counts.keep !== 0) problems.push('★ 逐项「重算」必须通过且分列');
    const p4 = planDecisions(mv, { apt_1: 'delete' });
    if (p4.ok || p4.counts.undecided !== 1) problems.push('★ 认不出的决定必须算未决定');
    if (planDecisions(mv, { fin_9: 'keep' }).ignored.length !== 0) problems.push('★ 台账外的 id 不算「给不该改的项下决定」');
    if (planDecisions({ items: [], state: SR_STATES.READY }, {}).ok !== true) problems.push('★ 没有逐项行的面必须直接可确认');

    /* 十三 确认闸三态分形（stale / 有面没取到条目 / 有面判不了）。 */
    const staleFace = buildImpactPreview({
        fact: { kind: 'residence', text: '旧居' }, next: '新居',
        trackedKinds: ['meeting'], refs: [{ id: 'apt_1', kind: 'meeting', label: '周五搬家' }],
        prevKey: 'residence|另一条原事实'
    });
    if (staleFace.stale !== true) problems.push('★ 换了原事实必须判 stale');
    const gStale = commitGate(staleFace, planDecisions(staleFace, { apt_1: 'keep' }));
    if (gStale.ok || gStale.reason !== 'stale') problems.push('★ stale 必须拦住确认（必须重挑）');
    const notListed = buildImpactPreview({
        fact: { kind: 'residence', text: '旧居' }, next: '新居',
        trackedKinds: allAff, refs: []
    });
    const gNL = commitGate(notListed, planDecisions(notListed, {}));
    if (gNL.ok || gNL.reason !== 'affected-not-listed') problems.push('★ 有面没取到具体条目必须拦住（不能凭类名去改）');
    const noRef = buildImpactPreview({
        fact: { kind: 'residence', text: '旧居' }, next: '新居',
        trackedKinds: ['meeting'], refs: []
    });
    const gUN = commitGate(noRef, planDecisions(noRef, {}));
    if (gUN.ok || gUN.reason !== 'affected-not-listed') problems.push('★ 有类会受影响却一条条目都没有必须拦住');
    /* 十之二 判不了的面**不拦**确认，但确认读数里必须带出来（不许无保留地说可以确认）。
       夹具：受影响的两类都取到了条目，另有两类判不了。 */
    const withUnFace = buildImpactPreview({
        fact: { kind: 'residence', text: '旧居' }, next: '新居',
        trackedKinds: ['meeting', 'person'],
        refs: [
            { id: 'apt_1', kind: 'meeting', label: '周五搬家' },
            { id: 'per_1', kind: 'person', label: '人物档案：住处' }
        ]
    });
    if (withUnFace.faceAffectedNoRefs.length) problems.push('★ 夹具本身必须条目齐（否则测的是另一格）');
    const withUn = commitGate(withUnFace, planDecisions(withUnFace, { apt_1: 'keep', per_1: 'recompute' }));
    if (!withUn.ok) problems.push('★ 判不了的面不该拦住确认（否则数据源接上前一件事都改不了）');
    if (withUn.line.indexOf('判不了') < 0 || withUn.line.indexOf('覆盖') < 0) {
        problems.push('★ 确认读数必须把判不了的面带出来（不许无保留地说可以确认）');
    }
const okFace = buildImpactPreview({
        fact: { kind: 'residence', text: '旧居' }, next: '新居',
        trackedKinds: ['meeting'], refs: [{ id: 'apt_1', kind: 'meeting', label: '周五搬家' }]
    });
    const cleanOk = commitGate(okFace, planDecisions(okFace, { apt_1: 'keep' }));
    if (!cleanOk.ok) problems.push('★ 逐项都定好且每类都有条目必须可确认');
    if (cleanOk.line.indexOf('不是完整的') >= 0) problems.push('★ 全覆盖时不得报「覆盖不是完整的」');
    const gRef = commitGate(noFact, null);
    if (gRef.ok || gRef.reason !== 'refused') problems.push('★ 拒收面不得确认');
    if (commitGate(unread, null).reason !== 'unreadable') problems.push('★ 读不到的面不得确认');
    if (commitGate(absent, null).reason !== 'absent') problems.push('★ 无数据源的面不得确认');

    /* 十四 撤销三态分形（可撤 / 已经撤过 / 台账里没有这一次）。 */
    const led = { entries: [{ key: 'k1', factKind: 'residence', from: 'A', to: 'B', rows: [{ id: 'r1' }], undone: false }] };
    const u1 = planUndo(led, 'k1');
    const u2 = planUndo({ entries: [{ key: 'k1', undone: true }] }, 'k1');
    const u3 = planUndo(led, 'k9');
    const u4 = planUndo(led, '');
    if (u1.state !== 'applied') problems.push('★ 台账里有且未撤必须可撤');
    if (u2.state !== 'noop') problems.push('★ 已经撤过必须报「不用撤」（不许报撤成功）');
    if (u3.state !== 'refused') problems.push('★ 台账里没有这一次必须报「没见过」（不许报撤过了）');
    if (u4.state !== 'refused') problems.push('★ 没说撤哪一次必须拒收');
    if (new Set([u1.state, u2.state, u3.state]).size !== 3) problems.push('★ 撤销三态必须互不同形');

    /* 十五 台账读数：空台账如实说；已撤与只落本机分列；重开可查。 */
    if (srLedgerLine(null).indexOf('还没确认过') < 0) problems.push('★ 空台账必须如实说');
    const ll = srLedgerLine({ entries: [
        { key: 'k1', undone: false, localOnly: true },
        { key: 'k2', undone: true, localOnly: false }
    ] });
    if (ll.indexOf('已撤 1') < 0 || ll.indexOf('只落本机 1') < 0) problems.push('★ 台账必须分列已撤与只落本机');
    if (ll.indexOf('重开可查') < 0) problems.push('★ 台账读数必须点明重开可查');

    /* 十六 只读面 + 空件不抛。 */
    if (mv.writesNothing !== true || noFact.writesNothing !== true) problems.push('本件恒为只读面');
    if (impactLine(null) !== '改设定：读不到') problems.push('★ 空面读数必须如实');
    const empties = [
        ['impactLine', () => impactLine(null)],
        ['impactRows', () => impactRows(null)],
        ['srLedgerLine', () => srLedgerLine(null)],
        ['planUndo', () => planUndo(null, 'x')],
        ['planDecisions', () => planDecisions(null, null)],
        ['commitGate', () => commitGate(null, null)],
        ['buildImpactPreview', () => buildImpactPreview(null)]
    ];
    for (const pair of empties) {
        try { pair[1](); } catch (e) { problems.push('★ 空件不得抛：' + pair[0] + '（' + e.message + '）'); }
    }
    if (impactRows(null).length !== 0) problems.push('★ 空面不得凭空出行');
    return { problems: problems, factKinds: factKinds.length, refKinds: refKinds.length };
}
export default {
    SR_FACT_KINDS,
    SR_FACT_LABEL,
    SR_REF_KINDS,
    SR_REF_LABEL,
    SR_TOUCH,
    SR_STATES,
    SR_ITEM_STATES,
    SR_DECISIONS,
    SR_DECISION_LABEL,
    SR_REASONS,
    SR_REASON_TEXT,
    SR_LIMITS,
    factKeyOf,
    rewriteKeyOf,
    buildImpactPreview,
    impactLine,
    impactRows,
    planDecisions,
    commitGate,
    planUndo,
    srLedgerLine,
    srSelfCheck,
};
