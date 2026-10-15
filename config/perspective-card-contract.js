/* ============================================================
 * config/perspective-card-contract.js — [第三期 R3-O2] 角色**可知范围**的
 *   消费侧单一真源(上游 **perspectiveCard** 面)
 * ------------------------------------------------------------
 *
 * 【计划原文 R3-O2】
 *   「…区分亲历、听说、推测,不再把所有召回都措辞成共同经历;**角色可知范围
 *     优先消费上游现有能力**。」
 *   验收原文四条里与本题直接相关的两条:
 *     · 「提到某人不等于该人知道」;
 *     · 「单聊 / 群聊 / 蜜语实际请求一致」。
 *
 * 【修前实测的缺口(不是推演)】
 *   上游在 v3.323.0(M3-X4)交付了视角卡面(`perspective-card.js`),它的契约里
 *   **明写一条禁令**:「不得把降级读成确实不知道」。而本仓
 *   `tests/audit/upstream_face_unconsumed.json` 里 perspectiveCard 一格逐字写着
 *   `consumer = none@0`,理由是我们**还没有一处能分辨「未知道」与「面不在场」**——
 *   先接会把降级误读成事实。这正是本仓最贵的那类老账(「读不到」与「空」同形),
 *   只不过这次它挡在跨仓面上。
 *
 * 【本模块只做三件事(而不重算任何上游口径)】
 *   1 **五态分形**:模块未装 / 面不在场(version=0)/ 出口抛错或形态不对 /
 *      真跑过但该角色无轨迹 / 读到四格 —— 五态**处置相反**,压平任意两态即把
 *      「还没装插件」显示成「这个角色什么都不知道」;
 *   2 **四格原样透传**:lived / heard / misled / unknown 逐格照搬上游的判定
 *      (**不在这里重算一份** —— 重算就是第二套可知范围口径);
 *   3 **`unrecorded` 与 `unknown` 严格分开**:上游把「判不开的动作」
 *      (doubt / correct / retract)单独落进 `unrecorded`,并逐字提醒
 *      「**不当『不知道』用**」。本模块把这条提醒变成**结构上不可混读**:
 *      读数里两者各有各的格子与各的人读字样,且 `silentCapable` 只对
 *      「四格齐且 unrecorded 可数」的面为真 —— 它就是「这一面能不能替沉默作证」的唯一判据。
 *
 * 【五态(本仓最贵的老账:缺席与空必须不同形)】
 *   · 插件不在场 / 模块未加载        ⇒ engine-absent(等装插件)
 *   · 插件在场但无该面(旧版,version=0)⇒ face-absent(等上游升级)
 *   · 出口在但抛错 / 面形态不对        ⇒ unusable(本机读不出)
 *   · 真跑过、该角色无轨迹            ⇒ empty(**真读数**)
 *   · 读到四格                       ⇒ ok
 *
 * 【边界(如实登记,不装)】
 *   · 本模块**不读存储、不写状态、不派事件、不碰 DOM**;输入由调用方嗂入。
 *   · 本模块**不替角色下「知道 / 不知道」的结论** —— 它只把上游的判定
 *     逐格端出来,并明确标出哪一格**不构成**「不知道」的证据。
 *   · 「优先消费上游现有能力」在本模块的落地形态是:上游在就给四格;上游不在就
 *     如实报缺席,**不退回本地猜一个**。
 * ============================================================ */
/* ★ 数值取值门走**全仓唯一实现**(config/num-gate.js),不在本文件就地再写一份。
 *   本模块要读的 `floor` 恰是「没给」与「给了 0」必须分开的那种读数
 *   (`Number(null) === 0` 会把两者塌成同一个数),故引用 `numOrNull` 并局部
 *   命名为 `floorOrNull` 以保留楼层语义(实现唯一,名字本地)。
 *   配套门禁 scripts/weak-coercion-audit.mjs 会守这一面。 */
import { numOrNull as floorOrNull } from './num-gate.js';
/** 上游插件全局名(与其它契约模块读的是同一个) */
const LONSHA_PLUGIN_GLOBAL = 'LonShaMemory';
/** 上游视角卡模块的全局名(上游 `_perspectiveCardLib()` 取的就是它) */
const PERSPECTIVE_MODULE_GLOBAL = 'LonShaPerspectiveCard';
/** 上游面 id(与 open_face_registry.tsv / crossrepo-registry.js 同一口径) */
export const PERSPECTIVE_FACE_ID = 'perspectiveCard';

/** 五态 */export const PERSPECTIVE_STATES = Object.freeze({
    ENGINE_ABSENT: 'engine-absent',
    FACE_ABSENT: 'face-absent',
    UNUSABLE: 'unusable',
    EMPTY: 'empty',
    OK: 'ok'
});
/** 六个归因词(两个同形即失败) */
export const PERSPECTIVE_REASONS = Object.freeze({
    ok: '视角卡就绪(四格可分)',
    'no-subject': '没给要看的人',
    'engine-absent': '记忆插件未装或未加载(等装插件)',
    'face-absent': '插件在场但这版没有视角卡面(需插件 v3.323.0+)',
    unusable: '出口在但读不出或形态不对(本机读不出,不是这个角色什么都不知道)',
    empty: '真跑过、这个角色没有轨迹(**不是**「他确实不知道」)'
});
/**
 * 四格 + 一格「不可用格」的人读字样。
 *
 * 为什么 `unrecorded` 必须与 `unknown` 分列:
 *   上游 `slotOf()` 只把 action ∈ {misbelieve→misled, unaware→unknown, 获取类→lived/heard}
 *   归格;`doubt / correct / retract` **不落任何一格**,单独计入 `unrecorded`
 *   (= 本卡对这一格**没有可写的内容**)。把它并进 `unknown` 就是把「我们没记过」
 *   读成「该角色确实不知道」—— 与上游「不根据沉默推断」的口径正面冲突。
 */
export const PERSPECTIVE_SLOTS = Object.freeze({
    lived: '亲历',
    heard: '听说',
    misled: '误信(勿当世界真相)',
    unknown: '未记录认知(账里明确记着不知道)',
    unrecorded: '本模块不知道(**不当「不知道」用**)'
});
/** 上限(冻结):单卡每格条目上限与卡数上限,防止一次读数把长聊天整段拉回内存 */
export const PERSPECTIVE_LIMITS = Object.freeze({
    cards: 24,
    perSlot: 40,
    fact: 120
});
function str(v) { return String(v == null ? '' : v).trim(); }
/** 宿主窗口(注入优先,回落全局) */
function resolveWin(win) {
    if (win && typeof win === 'object') return win;
    try { return (typeof globalThis !== 'undefined' && globalThis) ? globalThis : null; }
    catch (_e) { return null; }
}
/** 取上游模块本体:先看注入的 win 上有没有模块全局,再回落插件引擎的方法面。 */
function resolveModule(w) {
    if (!w) return null;
    const direct = w[PERSPECTIVE_MODULE_GLOBAL];
    if (direct && typeof direct.build === 'function') return direct;
    const plugin = w[LONSHA_PLUGIN_GLOBAL];
    const engine = plugin ? (plugin.engine || plugin.memoryEngine || null) : null;
    if (engine && typeof engine.perspectiveCard === 'function') return { engine: engine };
    return null;
}
/** 恒定键面的读数模板(读者不必再判 undefined) */
function face(state, reason, extra) {
    return Object.assign({
        kind: 'ruby_phone_perspective',
        version: 1,
        state: state,
        reason: reason,
        text: PERSPECTIVE_REASONS[reason] || PERSPECTIVE_REASONS['engine-absent'],
        ok: state === PERSPECTIVE_STATES.OK,
        degraded: state === PERSPECTIVE_STATES.ENGINE_ABSENT
            || state === PERSPECTIVE_STATES.FACE_ABSENT
            || state === PERSPECTIVE_STATES.UNUSABLE,
        /* ★ 本面**能不能替沉默作证**:只有真读到四格 + unrecorded 可数时才为真。
         *   调用方拿它当闸门 —— 为 false 时任何「他没说话 ⇒ 他不知道」的推断都是
         *   把降级读成事实,那正是上游明令禁止的一条。 */
        silentCapable: false,
        character: '',
        cards: [],
        counts: { cards: 0, lived: 0, heard: 0, misled: 0, unknown: 0, unrecorded: 0, viaUnknown: 0, ambiguousIdentity: 0 },
        writesNothing: true
    }, extra || {});
}
/**
 * 把上游一张卡逐格归一(**不重算判定**,只做形状收敛与截断)。
 *   上游卡片形状: { character, lived:[], heard:[], misled:[], unknown:[], counts, unrecorded, viaUnknown, ambiguousIdentity }
 */
function normCard(raw) {
    const character = str(raw && raw.character);
    if (!character) return null;
    const out = {
        character: character,
        lived: [], heard: [], misled: [], unknown: [],
        unrecorded: Number(raw && raw.unrecorded) || 0,
        viaUnknown: Number(raw && raw.viaUnknown) || 0,
        ambiguousIdentity: raw && raw.ambiguousIdentity === true
    };
    let truncated = 0;
    for (const slot of ['lived', 'heard', 'misled', 'unknown']) {
        const list = Array.isArray(raw && raw[slot]) ? raw[slot] : [];
        for (const it of list) {
            if (out[slot].length >= PERSPECTIVE_LIMITS.perSlot) { truncated += 1; continue; }
            const fact = str(it && it.fact).slice(0, PERSPECTIVE_LIMITS.fact);
            if (!fact) continue;
            out[slot].push({
                fact: fact,
                floor: floorOrNull(it && it.floor),
                via: str(it && it.via),
                from: str(it && it.from),
                evidenceKey: str(it && it.evidenceKey),
                traceId: str(it && it.traceId),
                revoked: !!(it && it.revoked),
                correctedBy: str(it && it.correctedBy)
            });
        }
    }
    out.truncated = truncated;
    return out;
}
/**
 * 读上游视角卡面(只读、不重算、不抛)。
 *
 * @param {object} win 宿主 window(注入,便于无头测试)
 * @param {{character?:string, at?:number, cards?:number}} [opts]
 *   · character —— 只看该角色(不给则按角色分组,每角色一张卡)
 *   · at        —— 时点楼层(给了就只收 floor ≤ at 的轨迹;读不到楼号的轨迹不进任何时点)
 * @returns 恒定键面读数(永不抛)
 */
export function readPerspectiveFace(win, opts = {}) {
    const w = resolveWin(win);
    const mod = resolveModule(w);
    if (!mod) return face(PERSPECTIVE_STATES.ENGINE_ABSENT, 'engine-absent');
    /* 两种取数路:模块直调 build(traces, opts) / 引擎方法 perspectiveCard(opts)。
     *   引擎路要求调用方自己把轨迹喂进引擎状态,故本模块对引擎路只做**调用与归因**,
     *   不替它准备输入(那是装配点的事)。 */
    let got = null;
    try {
        if (typeof mod.build === 'function') {
            /* 模块路:轨迹从 opts.traces 来(调用方给;不给即空数组 = 真读数「无轨迹」)。 */
            got = mod.build(Array.isArray(opts.traces) ? opts.traces : [], {
                character: str(opts.character) || undefined,
                at: (opts.at === undefined || opts.at === null || opts.at === '') ? undefined : Number(opts.at),
                maxItems: Number(opts.cards) || undefined
            });
        } else if (typeof mod.engine.perspectiveCard === 'function') {
            got = mod.engine.perspectiveCard(Object.assign({}, opts, { traces: Array.isArray(opts.traces) ? opts.traces : [] }));
        }
    } catch (_e) {
        return face(PERSPECTIVE_STATES.UNUSABLE, 'unusable');
    }
    /* 面形态:必须是对象且带 kind。形态不对与「没有轨迹」不同形。 */
    if (!got || typeof got !== 'object' || got.kind !== 'perspective_card') {
        return face(PERSPECTIVE_STATES.UNUSABLE, 'unusable');
    }
    /* version === 0 = 「这一面不在场」(上游常恒键面写法:模块未加载时给同键降级面)。 */
    if (Number(got.version) === 0) {
        return face(PERSPECTIVE_STATES.FACE_ABSENT, 'face-absent');
    }
    /* 输入畸形:上游用 malformedInput 标记而非静默空 —— 如实转成 unusable,不冒充空读数。 */
    if (got.malformedInput === true) {
        return face(PERSPECTIVE_STATES.UNUSABLE, 'unusable');
    }
    const rawCards = Array.isArray(got.cards) ? got.cards : [];
    const lim = Math.max(1, Math.min(200, Number(opts.cards) || PERSPECTIVE_LIMITS.cards));
    const cards = [];
    for (const rc of rawCards) {
        const c = normCard(rc);
        if (c) cards.push(c);
        if (cards.length >= lim) break;
    }
    const counts = { cards: cards.length, lived: 0, heard: 0, misled: 0, unknown: 0, unrecorded: 0, viaUnknown: 0, ambiguousIdentity: 0 };
    for (const c of cards) {
        counts.lived += c.lived.length;
        counts.heard += c.heard.length;
        counts.misled += c.misled.length;
        counts.unknown += c.unknown.length;
        counts.unrecorded += c.unrecorded;
        counts.viaUnknown += c.viaUnknown;
        if (c.ambiguousIdentity) counts.ambiguousIdentity += 1;
    }
    if (!cards.length) {
        /* ★ 真读数:跑过了、这个角色没有轨迹。**不是**「他确实不知道」——
         *   故 silentCapable 仍为 false(面没给出任何可作证的格)。 */
        return face(PERSPECTIVE_STATES.EMPTY, 'empty', {
            character: str(opts.character), counts: counts, writesNothing: true
        });
    }
    /* ★ 只有真拿到卡片时,silentCapable 才可能为真:四格齐 + unrecorded 可数。
     *   上游的 unrecorded 就是「我们没记过」的落点,它在场才是「这一面能分辨
     *   未知道与面不在场」的充分条件。 */
    return face(PERSPECTIVE_STATES.OK, 'ok', {
        silentCapable: true,
        character: str(opts.character),
        cards: cards,
        counts: counts,
        writesNothing: true
    });
}
/**
 * 就一条事实问「这个角色此刻知不知道」——**只在上游给得出四格时才回答**。
 *
 * 返回值里 `verdict` 的三种取值刻意**不可混读**:
 *   · 'known'      —— 落在 lived / heard / misled(曾当真)任一格;
 *   · 'unaware'    —— 落在 unknown(账里**明确记着**这角色不知道);
 *   · 'cannot-say' —— 其余一切:unrecorded(我们没记过)/ 面不在场 / 出口读不出 / 没这一条。
 *     `cannot-say` **不区分**「没记过」与「面不在场」这两个成因,但 `reason` 会逐字说明;
 *     这正是「不得把降级读成确实不知道」的落地形态 —— 两者都不许答成 unaware。
 *
 * @returns {{verdict:'known'|'unaware'|'cannot-say', reason:string, slot:string, card:object|null, state:string}}
 */
export function knowsFact(win, character, factText, opts = {}) {
    const who = str(character);
    const want = str(factText);
    const base = { verdict: 'cannot-say', reason: '', slot: '', card: null, state: '' };
    if (!who) return Object.assign({}, base, { reason: 'no-subject' });
    if (!want) return Object.assign({}, base, { reason: 'no-subject' });
    const read = readPerspectiveFace(win, Object.assign({}, opts, { character: who }));
    base.state = read.state;
    if (read.state === PERSPECTIVE_STATES.ENGINE_ABSENT
        || read.state === PERSPECTIVE_STATES.FACE_ABSENT
        || read.state === PERSPECTIVE_STATES.UNUSABLE) {
        return Object.assign({}, base, { reason: read.reason });
    }
    if (read.state === PERSPECTIVE_STATES.EMPTY) {
        return Object.assign({}, base, { reason: 'empty' });
    }
    const card = (read.cards || []).find((c) => c.character === who) || null;
    if (!card) return Object.assign({}, base, { reason: 'no-card-for-character' });
    const hit = (list) => list.find((it) => it.fact === want) || null;
    const inLived = hit(card.lived), inHeard = hit(card.heard);
    const inMisled = hit(card.misled), inUnknown = hit(card.unknown);
    if (inLived) return { verdict: 'known', reason: 'lived', slot: 'lived', card: card, state: read.state };
    if (inHeard) return { verdict: 'known', reason: 'heard', slot: 'heard', card: card, state: read.state };
    /* 误信**算知道**(他确实把这当真了),但 slot 如实标 misled ——
     *   调用方据此可以写「他以为…」,而**不得**当世界真相写。 */
    if (inMisled) return { verdict: 'known', reason: 'misled', slot: 'misled', card: card, state: read.state };
    if (inUnknown) return { verdict: 'unaware', reason: 'unknown', slot: 'unknown', card: card, state: read.state };
    /* ★ 剩下的只有两种:这条事实没在任何格出现(可能是 unrecorded,也可能压根没这事实)
     *   —— 都不许答成 unaware。 */
    return Object.assign({}, base, { reason: 'not-in-any-slot', slot: 'none', card: card });
}
/** 一行读数(五态各占一格;四格**分开说**,合并任意两格都会误导「该怎么写」)。 */
export function perspectiveLine(read) {
    const r = read || {};
    if (r.state === PERSPECTIVE_STATES.ENGINE_ABSENT) return '视角卡:' + PERSPECTIVE_REASONS['engine-absent'];
    if (r.state === PERSPECTIVE_STATES.FACE_ABSENT) return '视角卡:' + PERSPECTIVE_REASONS['face-absent'];
    if (r.state === PERSPECTIVE_STATES.UNUSABLE) return '视角卡:' + PERSPECTIVE_REASONS['unusable'];
    if (r.state === PERSPECTIVE_STATES.EMPTY) return '视角卡:' + PERSPECTIVE_REASONS['empty'];
    const c = r.counts || {};
    const parts = ['角色 ' + (c.cards || 0), '亲历 ' + (c.lived || 0), '听说 ' + (c.heard || 0)];
    if (c.misled) parts.push('**误信 ' + c.misled + '(勿当世界真相)**');
    if (c.unknown) parts.push('明确不知 ' + c.unknown);
    /* ★ 这一格必须**永远报出来**:它是「我们没记过」的落点,吞掉它就会把
     *   「没记录」读成「确实不知道」。 */
    if (c.unrecorded) parts.push('未记录 ' + c.unrecorded + '(本模块不知道,**不当「不知道」用**)');
    if (c.viaUnknown) parts.push('来源不明 ' + c.viaUnknown);
    if (c.ambiguousIdentity) parts.push('身份歧义 ' + c.ambiguousIdentity);
    return parts.join(' · ');
}
/**
 * 自检:四条口径当场自证(纯函数式,不抛)——
 *   一 插件不在场 ⇒ engine-absent,**不是** empty(两态不同形);
 *   二 面 version=0 ⇒ face-absent;
 *   三 出口抛错 ⇒ unusable;
 *   四 ★ 核心:喂一张**只有 unrecorded** 的卡 ⇒ ok 且 counts.unknown 为 0
 *      (「我们没记过」绝不落进 unknown)。
 */
export function perspectiveSelfCheck() {
    const problems = [];
    const absent = readPerspectiveFace(null, {});
    if (absent.state !== PERSPECTIVE_STATES.ENGINE_ABSENT) problems.push('插件不在场应报 engine-absent');
    if (absent.silentCapable !== false) problems.push('降级面不得 silentCapable');
    const faceAbsent = readPerspectiveFace({
        [PERSPECTIVE_MODULE_GLOBAL]: { build: () => ({ kind: 'perspective_card', version: 0, cards: [] }) }
    }, {});
    if (faceAbsent.state !== PERSPECTIVE_STATES.FACE_ABSENT) problems.push('version=0 应报 face-absent');
    const thrown = readPerspectiveFace({
        [PERSPECTIVE_MODULE_GLOBAL]: { build: () => { throw new Error('boom'); } }
    }, {});
    if (thrown.state !== PERSPECTIVE_STATES.UNUSABLE) problems.push('出口抛错应报 unusable');
    const onlyUnrecorded = readPerspectiveFace({
        [PERSPECTIVE_MODULE_GLOBAL]: {
            build: () => ({
                kind: 'perspective_card', version: 1, cards: [{
                    character: '探针', lived: [], heard: [], misled: [], unknown: [], unrecorded: 2
                }]
            })
        }
    }, {});
    if (onlyUnrecorded.state !== PERSPECTIVE_STATES.OK) problems.push('有卡应报 ok');
    if (onlyUnrecorded.counts.unknown !== 0) problems.push('unrecorded 不得计入 unknown(「我们没记过」不是「他不知道」)');
    if (onlyUnrecorded.counts.unrecorded !== 2) problems.push('unrecorded 必须如实计数');
    const verdict = knowsFact({
        [PERSPECTIVE_MODULE_GLOBAL]: {
            build: () => ({
                kind: 'perspective_card', version: 1, cards: [{
                    character: '探针', lived: [], heard: [], misled: [], unknown: [], unrecorded: 1
                }]
            })
        }
    }, '探针', '某件没记过的事');
    if (verdict.verdict !== 'cannot-say') problems.push('没记过的事不得答成 unaware');
    return { problems: problems };
}
export default {
    PERSPECTIVE_FACE_ID,
    PERSPECTIVE_STATES,
    PERSPECTIVE_REASONS,
    PERSPECTIVE_SLOTS,
    PERSPECTIVE_LIMITS,
    readPerspectiveFace,
    knowsFact,
    perspectiveLine,
    perspectiveSelfCheck
};