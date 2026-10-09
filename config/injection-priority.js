/* ========================================================
 *  RubyPhone · 注入块优先级与预算保护（A5）
 * ========================================================
 *
 * 【为什么有这个模块】
 *   上游记忆插件给的是**已经裁完**的逐块读数（`kept` / `dropped-budget`），
 *   本仓此前只把它读出来显示（见 config/injection-contract.js），
 *   **从不参与裁剪** —— 于是「超预算时谁该让位」这件事没有任何本地口径：
 *   预算由上游的字符上限决定，裁掉的顺序由上游的遍历顺序决定，
 *   而遍历顺序与「这块有多重要」毫无关系。
 *
 *   活标本形态：把一段**规则 / 底线**（世界观铁律、角色禁则）与一段
 *   **氛围白描**（今天天气、街边气味）放在同一个预算里，
 *   两者都是「一块」，谁先被遍历到谁进上下文。这既不稳、也不可解释。
 *
 * 【本模块的裁定口径（两条，互不合并）】
 *   ① **底线与规则不压**：`floor` 类块（规则、底线、人设骨架）不参与压缩，
 *      它要么整块进，要么整块出，且**优先进**（先占额度）。
 *      「压」在这里的含义是删字 —— 删掉一条禁则的后半句，等于把禁则变成了
 *      一句语气词。本仓不接受这种「省字」。
 *   ② **人设可压但有下限**：`persona` 类块允许被压到 `minChars`，
 *      **不得压穿**。压穿的表现是：人设只剩一句「她是温柔的」，
 *      而下游正文里所有具体行为都失去依据 —— 这比裁掉整块更坏，
 *      因为裁掉是可见的（读数里 `dropped`），压穿是不可见的。
 *
 * 【与上游的关系（方向不可互换）】
 *   上游给**数据**（每块多少字、进了没有），本仓给**裁定**（谁让位、压到哪）。
 *   本模块不读桥、不碰宿主、不做 IO：纯函数进纯函数出，
 *   故它可被 config/injection-contract.js 与任何注入方共用，且可被负控制直接破坏。
 *
 * 【三态互不同形（本仓反复点名的形态纪律）】
 *   `keptChars`（进了多少）/ `dropped`（整块没进）/ `squeezed`（进了但被压）
 *   三者**必须**能同时分得开：一块被压过的人设块同时是 kept 且 squeezed，
 *   而一块被预算整块挡掉的氛围块是 dropped 且 keptChars=0 —— 若把 squeezed
 *   也记成 dropped，诊断页就再也答不出「人设是没了还是短了」。
 * ============================================================ */

import { numOrNull } from './num-gate.js';

/** 分类：块的语义优先级（数字越小越优先）。未命中的一律落 `ambient`（最后让位）。 */
export const INJECTION_TIERS = Object.freeze({
    RULE: 'rule',           // 规则 / 底线 / 禁则：不压，优先占额
    PERSONA: 'persona',     // 人设 / 关系：可压，但有下限
    FACT: 'fact',           // 事实 / 记忆 / 承诺：可压，下限更松
    AMBIENT: 'ambient'      // 氛围 / 白描 / 装饰：预算不足时首先让位
});

/** 让位顺序（最后被裁的在前面）。刻意显式成数组：顺序是本模块的对外契约之一。 */
export const INJECTION_ORDER = Object.freeze([
    INJECTION_TIERS.RULE,
    INJECTION_TIERS.PERSONA,
    INJECTION_TIERS.FACT,
    INJECTION_TIERS.AMBIENT
]);

/** 关键词 → 档位。命中判定用**包含**而非全等：调用方送进来的多是自己拼的标签
 *  （如 `'世界观规则'` / `'角色底线'`），全等匹配会一条也命不中，于是全部落到
 *  `ambient` —— 那是「看起来有分类、实际全部同类」的假分类，比不做分类更坏。 */
const TIER_HINTS = Object.freeze([
    [INJECTION_TIERS.RULE, ['rule', '规则', '底线', '禁', '铁律', 'must-not', 'forbid']],
    [INJECTION_TIERS.PERSONA, ['persona', '人设', '角色', '关系', 'relationship', 'character']],
    [INJECTION_TIERS.FACT, ['fact', '事实', '记忆', 'memory', '承诺', 'promise', '承诺', 'knowledge', '知识']],
    [INJECTION_TIERS.AMBIENT, ['ambient', '氛围', '白描', '装饰', '天气', 'scene', 'mood']]
]);

/** 每档的默认下限（字符）。`rule` 无下限可言（不压），故用 Infinity 表达「不许压」。
 *  用 Infinity 而不是 0：0 会被 `Math.max(0, ...)` 之类写法当成「可以压到 0」，
 *  而这里要表达的是「压缩这条路根本不适用」。 */
export const DEFAULT_FLOORS = Object.freeze({
    [INJECTION_TIERS.RULE]: Number.POSITIVE_INFINITY,
    [INJECTION_TIERS.PERSONA]: 120,
    [INJECTION_TIERS.FACT]: 60,
    [INJECTION_TIERS.AMBIENT]: 0
});

/* 数值门：**转发**全仓唯一实现 `num-gate.numOrNull`，不在这里自己写一份。
 *  为什么必须转发而不是内联一个 `Number(v)`：本仓 weak-coercion 门（W2b）明令
 *  「族名（num/floor/finite 前缀）且体内含 Number( 的函数，必须是强形态或纯转发」——
 *  自己写一份就会把「没给」读成 0，与「给了 0」塌成同形（本仓最贵的那类错读数）。
 *  函数名刻意**不**用族名：它不是门，只是把 numOrNull 的 null 语义补一个默认值。 */
function nonNeg(v, fallback = 0) {
    const n = numOrNull(v);
    return (n === null || n < 0) ? fallback : n;
}

function textOf(block) {
    if (block === null || block === undefined) return '';
    if (typeof block === 'string') return block;
    if (typeof block === 'object') {
        if (typeof block.content === 'string') return block.content;
        if (typeof block.text === 'string') return block.text;
    }
    return '';
}

/**
 * 判定一块属于哪一档。**只认调用方显式给的 tier / kind，其次认标签词**；
 * 两者都没有 ⇒ `ambient`（保守：未知的东西不占额，但也不丢 —— 见 planInjection 的
 * `probe` 输出，未知档位会被点名，免得「全部落到 ambient」无人发现）。
 *
 * @param {*} block 字符串或 {content?, tier?, kind?, label?, tags?}
 * @returns {string} INJECTION_TIERS 之一
 */
export function tierOf(block) {
    if (block && typeof block === 'object') {
        const explicit = String(block.tier || block.kind || '').toLowerCase();
        if (INJECTION_ORDER.includes(explicit)) return explicit;
        const bag = [block.label, block.id, block.ref, ...(Array.isArray(block.tags) ? block.tags : [])]
            .map((v) => String(v ?? '').toLowerCase()).join(' ');
        if (bag.trim()) {
            for (const [tier, hints] of TIER_HINTS) {
                if (hints.some((h) => bag.includes(h))) return tier;
            }
        }
    }
    if (typeof block === 'string') {
        const low = block.toLowerCase();
        for (const [tier, hints] of TIER_HINTS) {
            if (hints.some((h) => low.includes(h))) return tier;
        }
    }
    return INJECTION_TIERS.AMBIENT;
}

/**
 * 单块裁定：它能不能进、进多少字。
 *
 * @param {*} block
 * @param {number} budget 剩余额度（字符）
 * @param {object} floors 档位 → 下限（默认 DEFAULT_FLOORS）
 * @returns {{tier:string, chars:number, wanted:number, kept:boolean, squeezed:boolean, dropped:boolean, reason:string}}
 */
export function judgeBlock(block, budget, floors = DEFAULT_FLOORS) {
    const tier = tierOf(block);
    const wanted = textOf(block).length || nonNeg(block && block.chars, 0);
    const left = nonNeg(budget, 0);
    const floor = Number.isFinite(floors[tier]) ? floors[tier] : 0;

    if (wanted === 0) {
        /* 空块不是「被裁」——它与「被预算挡掉」处置方向相反（前者查上游为什么给了空块）。 */
        return { tier: tier, chars: 0, wanted: 0, kept: false, squeezed: false, dropped: false, reason: 'empty' };
    }
    if (!Number.isFinite(floors[tier])) {
        /* 不压档：要么整块进，要么整块不进；且不得为它做任何截断。 */
        return wanted <= left
            ? { tier: tier, chars: wanted, wanted: wanted, kept: true, squeezed: false, dropped: false, reason: 'kept-floor' }
            : { tier: tier, chars: 0, wanted: wanted, kept: false, squeezed: false, dropped: true, reason: 'dropped-floor-nofit' };
    }
    if (wanted <= left) {
        return { tier: tier, chars: wanted, wanted: wanted, kept: true, squeezed: false, dropped: false, reason: 'kept' };
    }
    if (left >= floor && left > 0) {
        return { tier: tier, chars: left, wanted: wanted, kept: true, squeezed: true, dropped: false, reason: 'squeezed-to-budget' };
    }
    /* 剩余额度还不到下限 ⇒ **整块不进**，而不是压穿下限。
     * 这是本模块最容易被「优化」掉的一条：看起来「还剩 30 字，压一压也能进」，
     * 但那 30 字的人设不是人设，是残句。宁可整块不进（可见），不要压穿（不可见）。 */
    return {
        tier: tier, chars: 0, wanted: wanted, kept: false, squeezed: false, dropped: true,
        reason: floor > 0 ? 'dropped-below-floor' : 'dropped-budget'
    };
}

/**
 * 全量裁定：按 INJECTION_ORDER 逐档配额，档内保持调用方给的**原序**（稳定）。
 *
 * 稳定性的理由：同一份输入必须给同一份输出，否则诊断页两次读数不一致，
 * 而「不一致的读数」比「错的读数」更难查 —— 后者可复现，前者不可。
 *
 * @param {Array} blocks
 * @param {{budgetChars?:number, floors?:object}} options
 * @returns {{kept:Array, dropped:Array, order:Array, used:number, budget:number, unknownTier:string[]}}
 */
export function planInjection(blocks = [], options = {}) {
    const budget = nonNeg(options.budgetChars, 0);
    const floors = { ...DEFAULT_FLOORS, ...(options.floors || {}) };
    const list = Array.isArray(blocks) ? blocks : [];
    const unknownTier = [];

    /* 分档（带原始下标，安定序用） */
    const buckets = new Map(INJECTION_ORDER.map((t) => [t, []]));
    list.forEach((block, index) => {
        const tier = tierOf(block);
        if (tier === INJECTION_TIERS.AMBIENT) {
            /* 显式声明成 ambient 的不算未知；两者都落 ambient，靠这个名单分开。 */
            const declared = block && typeof block === 'object'
                && String(block.tier || block.kind || '').toLowerCase() === INJECTION_TIERS.AMBIENT;
            if (!declared) unknownTier.push(String((block && (block.ref || block.id || block.label)) || ('#' + index)));
        }
        buckets.get(tier).push({ block: block, index: index });
    });

    let used = 0;
    const kept = [];
    const dropped = [];
    for (const tier of INJECTION_ORDER) {
        for (const slot of buckets.get(tier)) {
            const verdict = judgeBlock(slot.block, budget - used, floors);
            const row = { ...verdict, index: slot.index, ref: String((slot.block && (slot.block.ref || slot.block.id || slot.block.label)) || ('#' + slot.index)) };
            if (verdict.kept) {
                used += verdict.chars;
                kept.push(row);
            } else if (verdict.dropped) {
                dropped.push(row);
            } else {
                /* empty：既不进 kept 也不进 dropped，单独归零 —— 三态不同形。 */
                dropped.push({ ...row, dropped: false, reason: 'empty' });
            }
        }
    }
    /* 输出顺序统一为**原序**：调用方拿它直接拼上下文，不必再排一次。 */
    kept.sort((a, b) => a.index - b.index);
    dropped.sort((a, b) => a.index - b.index);
    return {
        kept: kept, dropped: dropped, order: INJECTION_ORDER.slice(),
        used: used, budget: budget, unknownTier: unknownTier
    };
}

/** 一行读数（面向诊断页；三态各占一格，不得压成一格）。 */
export function injectionPriorityLine(plan) {
    if (!plan || typeof plan !== 'object') return '注入预算：无读数';
    const squeezed = plan.kept.filter((r) => r.squeezed).length;
    const droppedFloor = plan.dropped.filter((r) => r.reason === 'dropped-floor-nofit').length;
    return '注入预算：' + plan.used + '/' + plan.budget + ' 字 · 进 ' + plan.kept.length
        + ' 块（其中被压 ' + squeezed + '）· 让位 ' + plan.dropped.filter((r) => r.dropped).length
        + (droppedFloor ? '（含规则/底线让位 ' + droppedFloor + ' —— 须调预算或减块）' : '');
}

export default {
    INJECTION_TIERS, INJECTION_ORDER, DEFAULT_FLOORS,
    tierOf, judgeBlock, planInjection, injectionPriorityLine
};
