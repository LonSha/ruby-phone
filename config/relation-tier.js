/* ========================================================
 *  RubyPhone · 关系七级与好感底色（B2）
 * ========================================================
 *
 * 【为什么有这个模块】
 *   本仓从「联系方式洞察」（`config/contact-insight.js`：谁最近聊过、谁沉了多久）
 *   到「关系面」（角色卡里的关系条目）之间，**中间那一层是空的**：
 *     · 角色卡里有关系，但那是**作者写死的**：一张卡说「她是你的青梅」，另一张说
 *       「她是你前女友」，第三张说「你们只是同事」—— 而在手机里，玩家与同一个人
 *       可能已经聊了两百条、转过三笔账、发过九条朋友圈评论。
 *     · 手机侧能读到**行为**（条数 / 最近时间 / 转账 / 评论），却**没有任何一处**
 *       把行为落成一句可注入的「关系处境」。于是副模型要写人设时，只能照抄卡里的
 *       静态设定，与玩家自己玩出来的那段历史无关。
 *
 *   本模块补的就是这一层：把**可观测的行为读数**落成
 *   ① 关系七级（一个离散刻度）+ ② 好感底色（长期的正负倾向）+ ③ 信任落点
 *   （一个**只在受检验时才会换**的判据）。
 *
 * 【三条裁定口径（每条都对应一个具体的错法）】
 *   ① **兑现率不是条数**：一个人可以发两千条消息而从不接住你的难处。
 *      把「聊得多」当成「关系好」是最容易被做出来的错分类（读数好看、语义全错）。
 *      故七级的**主判据**是「承压时的兑现率 + 信任落点是否被验过」，
 *      条数只进**底色**（长期倾向的一个面），且底色**不得翻级**。
 *   ② **信任落点换得比好感慢得多**：好感可以因为一次帮忙上调，信任落点不行 ——
 *      它只在**该角色受检验的那一次**才允许改写（`TRUST_CHALLENGES` 里的四种检验），
 *      且必须有**读数**（`trustLog`）。没有读数就换落点，等于把「我觉得」写成了「发生过」。
 *   ③ **三态互不同形**：
 *      `graded`（有足够行为读数、真判出了级）/ `thin`（读数太少，**不给级**）/
 *      `absent`（连人都没有）。把 `thin` 报成一个低等级是最坏的处置 ——
 *      它会让「刚认识」与「聊过两次」看起来一样，而这两者该做的事完全不同。
 * ============================================================ */

import { numOrNull } from './num-gate.js';

/** 关系七级（由疏到亲）。数字是**刻度**，不是评分：只用于排序与比较，不对外展示为分数。 */
export const RELATION_TIERS = Object.freeze([
    { id: 'stranger', level: 0, label: '陌生人', note: '没有可观测的往来读数' },
    { id: 'acquaintance', level: 1, label: '点头之交', note: '有过往来，但没有一次承压互动' },
    { id: 'contact', level: 2, label: '熟人', note: '往来稳定，仍未承压' },
    { id: 'friend', level: 3, label: '朋友', note: '至少接过一次难处' },
    { id: 'close', level: 4, label: '挚友', note: '多次接住，且信任落点未被验倒' },
    { id: 'intimate', level: 5, label: '亲密', note: '承压兑现率高 + 底色为正' },
    { id: 'bonded', level: 6, label: '羁绊', note: '高兑现 + 落点经受住检验 + 双向投入' }
]);

/** 好感底色（长期倾向）。**不是**当前情绪：情绪归台词，底色归关系。 */
export const AFFECTION_TONES = Object.freeze({
    WARM: 'warm',       // 长期为正
    NEUTRAL: 'neutral', // 没偏过任何一边（**不等于 0 分**，而是「没有读数说它偏了」）
    COLD: 'cold'        // 长期为负
});

/** 信任落点的四种检验。**只有这四种**允许改写落点 —— 其余互动一律只动底色。 */
export const TRUST_CHALLENGES = Object.freeze({
    ASKED_FOR_HELP: 'asked-for-help',       // 求过助（对方接没接）
    KEPT_SECRET: 'kept-secret',             // 托付过秘密（对方守没守）
    CONFLICT: 'conflict',                   // 起过冲突（对方怎么收的尾）
    STOOD_UP: 'stood-up'                    // 缺席过约定（对方来没来）
});

/** 把 tier id 换成对象；不认识的一律如实 null（不兜底成「陌生人」——
 *  「不认识这个级别名」与「他是陌生人」是两件事）。 */
export function tierOf(id) {
    const key = String(id ?? '').trim();
    if (!key) return null;
    return RELATION_TIERS.find((t) => t.id === key) || null;
}

function num(v) {
    return numOrNull(v);
}

/** 底色：由**长线**读数算（条数 / 跨度 / 净投入），**不看**承压次数。
 *  刻意与七级分开：底色回答「总体上偏哪边」，七级回答「能托付到什么程度」。 */
export function affectionTone(readings = {}) {
    const msgs = num(readings.messages);
    const days = num(readings.spanDays);
    const sent = num(readings.sentByMe);
    const recv = num(readings.sentByThem);
    const help = num(readings.helped);
    const friction = num(readings.friction);
    const partial = [];
    /* 三项都有读数才算「读到了」：缺一项就如实报 partial，不拿剩下的硬算。 */
    const warmVotes = [];
    const coldVotes = [];
    if (msgs !== null || days !== null) {
        const volume = (msgs || 0) + (days || 0) * 2;
        if (volume > 0) warmVotes.push(volume);
        else if (msgs === 0 && days === 0) coldVotes.push(1);
    } else partial.push('messages/spanDays');
    if (sent !== null && recv !== null) {
        const total = sent + recv;
        if (total > 0) {
            if (recv >= sent) warmVotes.push(1);
            else coldVotes.push(1);
        }
    } else partial.push('sentByMe/sentByThem');
    if (help !== null || friction !== null) {
        if ((help || 0) > (friction || 0)) warmVotes.push(1);
        else if ((friction || 0) > (help || 0)) coldVotes.push(1);
    } else partial.push('helped/friction');
    let tone = AFFECTION_TONES.NEUTRAL;
    if (warmVotes.length && !coldVotes.length) tone = AFFECTION_TONES.WARM;
    else if (coldVotes.length && !warmVotes.length) tone = AFFECTION_TONES.COLD;
    else if (warmVotes.length && coldVotes.length) tone = AFFECTION_TONES.NEUTRAL;
    return length_of({ tone: tone, warmVotes: warmVotes.length, coldVotes: coldVotes.length, partial: partial });
}

/** 内部：把对象原样带出一个长度字段（供读数使用；不改变语义）。 */
function length_of(o) {
    o.readings = o.warmVotes + o.coldVotes;
    return o;
}

/** 信任落点：**只在受检验时换**。返回新的落点与「是否换了」。
 *  `challenge` 必须是 `TRUST_CHALLENGES` 里的四种之一，且必须带 `observed`（读数）。
 *  没有读数 ⇒ 不换（如实报 `unobserved`）—— 「我觉得他大概会守着」不是读数。 */
export function reviewTrust(current = {}, event = {}) {
    const kind = String(event.challenge ?? '').trim();
    const known = Object.values(TRUST_CHALLENGES).includes(kind);
    const observed = event.observed === true || event.observed === false;
    const prev = String(current.point ?? '').trim();
    if (!kind) return { point: prev, changed: false, reason: 'no-challenge' };
    if (!known) return { point: prev, changed: false, reason: 'unknown-challenge' };
    if (!observed) return { point: prev, changed: false, reason: 'unobserved' };
    const fulfilled = event.fulfilled === true;
    let next = prev;
    if (kind === TRUST_CHALLENGES.KEPT_SECRET) {
        next = fulfilled ? 'bonded-secret' : 'burned-secret';
    } else if (kind === TRUST_CHALLENGES.ASKED_FOR_HELP) {
        next = fulfilled ? 'counted-on' : 'shrugged-off';
    } else if (kind === TRUST_CHALLENGES.CONFLICT) {
        next = fulfilled ? 'fair-fight' : 'cheap-shot';
    } else if (kind === TRUST_CHALLENGES.STOOD_UP) {
        next = fulfilled ? 'showed-up' : 'no-show';
    }
    return { point: next, changed: next !== prev, reason: next !== prev ? 'challenged' : 'held' };
}

/** 关系处境：七级 + 底色 + 落点，三态互不同形（`graded` / `thin` / `absent`）。 */
export function buildRelation(input = {}, opts = {}) {
    const minReadings = num(opts.minReadings) !== null ? num(opts.minReadings) : 3;
    const name = String(input.name ?? '').trim();
    if (!name) {
        return { state: 'absent', tier: null, tone: null, trust: '', why: '没有对象名' };
    }
    const readings = input.readings && typeof input.readings === 'object' ? input.readings : {};
    const msgs = num(readings.messages);
    const holds = num(readings.helped);        // 承压兑现次数（接住过几次难处）
    const breaks = num(readings.shrugged);     // 承压失约次数
    const observed = num(readings.challenges);  // 受检验次数（有读数的）
    /* 读数够不够：条数与承压都必须有读数，且总读数不低于下限。缺一项就报 `thin`，
     *  不给级 —— 把「刚认识」与「聊过两次」都压成「点头之交」是这里最坏的处置。 */
    const haveAny = msgs !== null || holds !== null || breaks !== null;
    const enough = msgs !== null && (holds !== null || breaks !== null) && minReadings >= 0
        && ((msgs || 0) + (holds || 0) + (breaks || 0)) >= minReadings;
    if (!haveAny || !enough) {
        return {
            state: 'thin', tier: null, tone: affectionTone(readings), trust: '',
            why: !haveAny ? '没有任何行为读数' : '读数低于下限（' + minReadings + '）'
        };
    }
    const fulfilled = (holds || 0);
    const failed = (breaks || 0);
    const challenges = (observed || 0) || (fulfilled + failed);
    let level = 0;
    if ((msgs || 0) > 0) level = 1;
    if ((msgs || 0) >= 10) level = 2;
    if (fulfilled >= 1 && fulfilled > failed) level = 3;
    if (fulfilled >= 2 && failed === 0) level = 4;
    if (fulfilled >= 3 && failed === 0 && (msgs || 0) >= 30) level = 5;
    if (fulfilled >= 5 && failed === 0 && (readings.bidirectional === true)) level = 6;
    /* 逆行：失约多于兑现时，级不得停留在「朋友」以上 —— 但也不降到 2 以下
     *  （往来事实仍在：把人一路降成陌生人，读数上是撒谎）。 */
    if (failed > fulfilled && level > 2) level = 2;
    const tone = affectionTone(readings);
    const trust = String(input.trust ?? '').trim();
    const tier = RELATION_TIERS[Math.max(0, Math.min(RELATION_TIERS.length - 1, level))];
    return {
        state: 'graded', tier: tier, tone: tone, trust: trust,
        challenges: challenges, fulfilled: fulfilled, failed: failed,
        why: ''
    };
}

/** 一行读数（诊断 / 提示）。三态各占一格。 */
export function relationLine(result, name = '') {
    const who = name ? '（' + name + '）' : '';
    if (!result || typeof result !== 'object') return '关系处境' + who + '：无读数';
    if (result.state === 'absent') return '关系处境' + who + '：没有对象';
    if (result.state === 'thin') return '关系处境' + who + '：读数不足，不给级 —— ' + result.why;
    return '关系处境' + who + '：' + result.tier.label + '（第 ' + (result.tier.level + 1) + ' 级）· '
        + '底色 ' + result.tone.tone + ' · 承压兑现 ' + result.fulfilled + '/' + (result.fulfilled + result.failed)
        + (result.trust ? ' · 落点 ' + result.trust : '');
}

export default {
    RELATION_TIERS, AFFECTION_TONES, TRUST_CHALLENGES,
    tierOf, affectionTone, reviewTrust, buildRelation, relationLine
};