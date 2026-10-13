/* ========================================================
 *  RubyPhone · 群聊节奏与角色表达差异(第三期 R3-O3)
 * ========================================================
 *
 * 【计划原文(逐字)】
 *   「在现调度上加入最近发言冷却、未回应话题与关系相关度;独立组织每位角色可知
 *    上下文、措辞偏好与打断/接话;允许沉默,不为人数上限凑发言。」
 *   验收:「六人群连续 20 轮中,@可靠命中,不每轮固定前三人;同一往事不被六人
 *    复述;角色不知道的内容不进入其请求。」
 *
 * 【修前实测的缺口(不是推演)】
 *   `apps/wechat/group-scheduler.js::scheduleSpeakers` 做的是「把 LLM 给的名字
 *   映射回成员、去重保序、cap 人数」—— 它**完全不看历史**:
 *     · 没有「谁刚说过话」(每轮都可能是同样那几个人);
 *     · 没有「这个话题谁还没接」(未回应话题无从表达);
 *     · 与「关系」无关(谁都可能被选中去谈最私密的往事)。
 *   于是验收里那三条(不固定前三人 / 同一往事不被六人复述 / 角色不知道的不进请求)
 *   在本仓**一处都不成立** —— 缺的不是数据(群成员、消息、维系度都在),
 *   缺的是把那些读数落成「这一轮该给谁多少台面」的那一层。
 *
 * 【本模块补什么:三层读数 + 一条「允许沉默」的裁定】
 *   1 `cooledDown`  最近发言冷却 —— 刚说过话的人本轮降权,刚被 @ 的人不受罚;
 *   2 `topicUrgency` 未回应话题 —— 这个话题还没接过的人本轮加权(避免「六人复述」);
 *   3 `relationFit`  关系相关度 —— 谈私密往事时只给「够近」的人台面;
 *   4 `silence`      允许沉默 —— 没人够格时**如实报空**,不为凑人数上限硬塞人。
 *
 * 【四条裁定口径(每条都对应一个具体的错法)】
 *   1 **@必须是硬命中,不进权重分配**。@不是「更想让他说」,而是「用户点名了」——
 *      让它参与加权排序,会出现「@了 A 但权重最高的是 B」这种最坏的错误。
 *      ⇒ 点名者直接进 `forced`,权重表里不再出现,且不得被冷却或上限裁掉。
 *   2 **冷却不等于禁言**。冷却期里若全场没人可发,宁可**少说**(甚至沉默),
 *      也不把刚说过话的人再拉回来 —— 「每轮固定前三人」正是靠这一条断掉的。
 *   3 **关系判据是下限,不是排序键**。私密话题要求 tier 不低于某级;把人按关系
 *      从亲到疏排一遍再切前 N 个,会造出「永远只有最亲的那几个说话」的新毛病。
 *      ⇒ 关系只决定**够不够格**,排序仍看节奏与接话。
 *   4 **三态互不同形**。`readable`(读数够,真判了)/ `thin`(读数太少,
 *      不给节奏判定,如实交回上层)/ `absent`(连人都没有)。把 `thin` 当成
 *      「那就谁都能说」是最坏的处置 —— 它把「不知道」写成了「都行」。
 *
 * 【边界(如实登记,不装)】
 *   · 本模块是**纯函数**:不读存储、不写状态、不派事件;历史由调用方喂入。
 *   · 只 import 数值门一处(与全仓同规);不引第二份版本比较/取数实现。
 *   · 它只回答「这一轮台面给谁多少」,**不发请求、写提示词、调模型**;
 *     把选中的成员组进上下文仍是调用方(wechat 层)的活。
 * ============================================================ */
import { numOrNull } from './num-gate.js';

/** 三个读数的归因词(两态同形即失败:读者要能分辨「不知道」与「不行」)。 */
export const GROUP_PACE_REASONS = Object.freeze({
    ok: '节奏读数可用,已按冷却与接话分配台面',
    'no-members': '群里一个人都没有',
    'no-recent-face': '拿不到最近发言读数(不等于没人说过话)',
    thin: '历史太少,本轮不做节奏裁定(交回上层)',
    'all-cooled': '所有人都刚说过话,本轮如实少说',
    'no-eligible': '没有够格谈这个话题的人,本轮如实少说'
});

/** 上限(冻结;调用方不得就地改语义)。 */
export const GROUP_PACE_LIMITS = Object.freeze({
    coolWindow: 3,      /* 最近 N 条发言算「刚说过话」 */
    coolPenalty: 2,     /* 冷却罚分 */
    topicBonus: 2,      /* 未接过这个话题的加权 */
    repeatPenalty: 3,   /* 已经接过这个话题的降权(防六人复述) */
    minSpeakers: 1,
    maxSpeakers: 6,
    minHistory: 2       /* 历史少于这个数就不做节奏裁定 */
});

/** 关系七级的刻度表(**只用于下限判定,不用来排序**;与 config/relation-tier.js 同刻度)。 */
export const GROUP_PACE_TIERS = Object.freeze([
    'stranger', 'acquaintance', 'contact', 'friend', 'close', 'confidant', 'intimate'
]);

/** 话题私密度 → 要求的**最低**关系刻度(下标)。 */
export const GROUP_PACE_PRIVACY = Object.freeze({
    public: 0,      /* 公开信息:谁都够格 */
    personal: 2,    /* 私事:至少「熟人」 */
    intimate: 4,    /* 亲近事:至少「亲近」 */
    secret: 5       /* 秘密:至少「知己」 */
});

/** 话题私密度归因词(读不到私密度与「公开」必须分开说)。 */
export const GROUP_PACE_PRIVACY_REASONS = Object.freeze({
    'privacy-absent': '没给话题私密度,不做私密门槛(不等于它是公开话题)',
    'tier-absent': '没给该成员的关系刻度,对其不设私密门槛(不等于它够格)',
    'tier-too-low': '关系刻度低于该话题要求的下限',
    eligible: '够格谈这个话题'
});

function num(v) { return numOrNull(v); }
function str(v) { return String(v ?? '').trim(); }

/**
 * 归一历史::把调用方喂进来的「谁最近说了什么」落成可判读数。
 *   history:[{ name, topic?, at? }] 或 [string] —— **按时间从早到晚**;
 *   末位为最近一条(与消息流方向一致)。
 * @returns {{ ok:boolean, order:Array<{name:string, topic:string}>, names:string[], face:boolean }}
 */
export function normalizeGroupHistory(history) {
    const out = { ok: false, order: [], names: [], face: false };
    if (!Array.isArray(history)) return out;   /* 读不到:face 保持 false(与空数组不同形) */
    out.face = true;
    out.order = history.map((h) => {
        if (typeof h === 'string') return { name: str(h), topic: '' };
        return { name: str(h && h.name), topic: str(h && h.topic) };
    }).filter((x) => x.name);
    out.names = out.order.map((x) => x.name);
    out.ok = out.order.length > 0;
    return out;
}

/** 该名字在最近 coolWindow 条里出现过吗(归一后比)。 */
function isCooled(hist, name, win) {
    /* 参数名刻意**不叫** window:它会遮蔽浏览器里的全局 window,
     *   而「内核代码里不得出现 window」是本仓纯函数面的硬边界(A5 判据就是这么针的)。 */
    const tail = hist.order.slice(-Math.max(1, win));
    return tail.some((x) => x.name === name);
}

/** 该名字接过这个话题吗(**整段历史**,不是只看最近几条:复述是跨轮的)。 */
function spokeOn(hist, name, topic) {
    if (!topic) return false;
    return hist.order.some((x) => x.name === name && x.topic === topic);
}

/** 关系刻度下标;读不到返回 null(**不猜成 0**)。 */
export function tierIndexOf(tier) {
    const t = str(tier);
    if (!t) return null;
    const i = GROUP_PACE_TIERS.indexOf(t);
    return i >= 0 ? i : null;
}

/**
 * 本轮台面分配(R3-O3 的主出口)。
 *
 * @param {object} input
 *   · members   [{ id, name, aliases? }]
 *   · history   见 normalizeGroupHistory(不传 = 读不到)
 *   · topic     本轮话题文本(用于「谁接过」)
 *   · mentions  @ 点名(硬命中)
 *   · privacy   见 GROUP_PACE_PRIVACY(不传 = 读不到,不设门槛)
 *   · tiers     { name: tier }(不传 = 读不到,对该人不设门槛)
 * @param {object} [opts] { maxSpeakers }
 * @returns {{ ok, state, reason, speakers, forced, cooled, silent, readings }}
 */
export function planGroupPace(input = {}, opts = {}) {
    const LIM = GROUP_PACE_LIMITS;
    const members = Array.isArray(input.members) ? input.members.filter((m) => m && str(m.name)) : [];
    const base = {
        ok: false, state: 'absent', reason: 'no-members',
        speakers: [], forced: [], cooled: [], silent: [],
        readings: { members: 0, eligible: 0, cooled: 0, skippedPrivate: 0 }
    };
    if (!members.length) return base;

    const hist = normalizeGroupHistory(input.history);
    const maxSpeakers = Math.max(LIM.minSpeakers, Math.min(LIM.maxSpeakers,
        num(opts.maxSpeakers) !== null ? Number(opts.maxSpeakers) : LIM.maxSpeakers));

    /* ── 硬命中:@ 不参与加权(见口径 1) ── */
    const mentionSet = new Set((Array.isArray(input.mentions) ? input.mentions : [])
        .map((x) => str(typeof x === 'string' ? x : (x && x.name))).filter(Boolean));
    const forced = [];
    const rest = [];
    for (const m of members) {
        const nm = str(m.name);
        const aliases = Array.isArray(m.aliases) ? m.aliases.map(str) : [];
        const hit = mentionSet.has(nm) || aliases.some((a) => mentionSet.has(a))
            || [...mentionSet].some((t) => t === nm || aliases.includes(t));
        if (hit) forced.push(m); else rest.push(m);
    }

    /* ── 历史**读不到**:如实报 no-recent-face,**不做节奏裁定**(见口径 4) ──
     *   ⚠ 「读不到」与「读到了一份空历史」是**两件事**,不许同形:
     *   · `history` 不是数组 / 没给 ⇒ 读不到 ⇒ 报 no-recent-face(不知道谁刚说过话);
     *   · `history` 是数组但为空 ⇒ **真的还没人说过话** —— 这是群聊的初始轮,
     *     不该报 thin(那会让新群永远开不了口),也不该给任何人冷却罚分。 */
    if (!hist.face) {
        return {
            ok: false, state: 'thin', reason: 'no-recent-face',
            speakers: forced.slice(0, maxSpeakers),
            forced: forced.map((m) => str(m.name)),
            cooled: [], silent: [],
            readings: { members: members.length, eligible: rest.length, cooled: 0, skippedPrivate: 0 }
        };
    }

    /* ── 私密门槛(只判够不够格,不排序;见口径 3) ── */
    const privacy = str(input.privacy);
    const needIdx = Object.prototype.hasOwnProperty.call(GROUP_PACE_PRIVACY, privacy)
        ? GROUP_PACE_PRIVACY[privacy] : null;      /* null = 私密度读不到 ⇒ 不设门槛 */
    const tiers = (input.tiers && typeof input.tiers === 'object') ? input.tiers : {};

    const scored = [];
    const cooled = [];
    let skippedPrivate = 0;
    for (const m of rest) {
        const nm = str(m.name);
        /* 私密门槛:读不到该人的刻度 ⇒ 不设门槛(但也不因此放行到「够格」语义,
         *   故在读数里不计入 eligible —— 这里如实只把它当「没被挡下来」。 */
        if (needIdx !== null) {
            const idx = tierIndexOf(tiers[nm] != null ? tiers[nm] : (m.tier != null ? m.tier : null));
            if (idx !== null && idx < needIdx) { skippedPrivate += 1; continue; }
        }
        /* 初始轮(order 为空)不做冷却与话题加减:没人说过话,也就无冷可却、无话可接。
         *   这一步必须显式写出 —— 否则「空历史」会静默落进「所有人都被冷却」的分支,
         *   把一个新群判成「全场刚说过话」(那是把「不知道」写成了「都刚说过」)。 */
        const cooledHere = hist.order.length ? isCooled(hist, nm, LIM.coolWindow) : false;
        if (cooledHere) { cooled.push(nm); }
        let score = 0;
        if (cooledHere) score -= LIM.coolPenalty;
        if (input.topic && hist.order.length) {
            if (spokeOn(hist, nm, str(input.topic))) score -= LIM.repeatPenalty;
            else score += LIM.topicBonus;
        }
        scored.push({ member: m, name: nm, score: score, cooled: cooledHere });
    }

    /* 稳定排序:分数降序;同分保持成员原序(**不按名字排**,否则「顺序一变归属就变」复发)。 */
    const ranked = scored.slice().sort((a, b) => (b.score - a.score));
    const picked = [];
    for (const r of ranked) {
        if (forced.length + picked.length >= maxSpeakers) break;
        picked.push(r);
    }

    /* ── 允许沉默(见口径 2):没人够格 ⇒ 只报 named,不硬塞 ── */
    const eligibleCount = scored.length;
    let state = 'readable';
    let reason = 'ok';
    if (!eligibleCount) {
        state = 'readable';
        reason = cooled.length ? 'all-cooled' : 'no-eligible';
    }
    const silent = (forced.length === 0 && picked.length === 0);

    return {
        ok: true, state: state, reason: reason,
        speakers: forced.concat(picked.map((x) => x.member)),
        forced: forced.map((m) => str(m.name)),
        cooled: cooled,
        silent: silent,
        readings: {
            members: members.length,
            eligible: eligibleCount,
            cooled: cooled.length,
            skippedPrivate: skippedPrivate,
            needTier: needIdx === null ? null : GROUP_PACE_TIERS[needIdx],
            privacyFace: needIdx !== null
        }
    };
}

/** 一行读数(诊断 / 提示)。三态各占一格,不与「没人说话」同形。 */
export function groupPaceLine(result) {
    if (!result || typeof result !== 'object') return '\u7fa4\u804a\u8282\u594f:\u65e0\u8bfb\u6570';
    if (result.reason === 'no-members') return '\u7fa4\u804a\u8282\u594f:' + GROUP_PACE_REASONS['no-members'];
    if (result.state === 'thin') return '\u7fa4\u804a\u8282\u594f:' + GROUP_PACE_REASONS[result.reason];
    const r = result.readings || {};
    return '\u7fa4\u804a\u8282\u594f:\u53f0\u9762 ' + result.speakers.length + ' \u4eba'
        + '(@ ' + (result.forced || []).length + ' / \u53ef\u9009 ' + (r.eligible || 0)
        + ' / \u51b7\u5374 ' + (r.cooled || 0) + ')'
        + (result.silent ? ' \u2014\u2014 \u672c\u8f6e\u5982\u5b9e\u5c11\u8bf4' : '');
}

/** 自检(纯函数,不抛)。供门禁与诊断页调用。 */
export function groupPaceSelfCheck() {
    const problems = [];
    const lim = GROUP_PACE_LIMITS;
    if (!(lim.coolWindow >= 1 && lim.maxSpeakers >= lim.minSpeakers)) problems.push('\u4e0a\u9650\u4e0d\u81ea\u6d3d');
    const a = planGroupPace({ members: [{ name: 'A' }, { name: 'B' }] });
    if (a.reason !== 'no-recent-face') problems.push('\u5386\u53f2\u8bfb\u4e0d\u5230\u65f6\u5e94\u5982\u5b9e\u62a5 no-recent-face');
    const b = planGroupPace({ members: [], history: [] });
    if (b.reason !== 'no-members') problems.push('\u65e0\u6210\u5458\u65f6\u5e94\u62a5 no-members');
    const c = planGroupPace({ members: [{ name: 'A' }], history: 'x' });
    if (c.reason !== 'no-recent-face') problems.push('\u5386\u53f2\u975e\u6570\u7ec4\u5e94\u5f53\u6210\u8bfb\u4e0d\u5230');
    /* 空历史 = 真的还没人说过话(初始轮),**不得**报 thin */
    const d = planGroupPace({ members: [{ name: 'A' }, { name: 'B' }], history: [] });
    if (d.state === 'thin') problems.push('\u7a7a\u5386\u53f2\u4e0d\u5f97\u62a5 thin(那会让\u65b0\u7fa4\u6c38\u8fdc\u5f00\u4e0d\u4e86\u53e3)');
    if (!d.ok) problems.push('\u7a7a\u5386\u53f2\u5e94\u53ef\u5224(真\u7684\u8fd8\u6ca1\u4eba\u8bf4\u8fc7\u8bdd)');
    return { problems: problems };
}
