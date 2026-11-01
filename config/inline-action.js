/* ========================================================
 * config/inline-action.js — [v4.113.0 · R13-X3] 从一句话里认出「可以就地办的那件事」
 * --------------------------------------------------------
 * 【它治的缝】聊天里对方说「周六有空吗」，用户要加日程得切 App、重打一遍、还要自己算哪天是周六。
 *   本件只做一件事：**从一条消息里认出一个候选动作**，认出来之后由玩家点才执行。
 *   ★ 只生成候选，不自动执行 —— 这是本项最强的一条边界。自动执行一旦写错，用户
 *     发现不了（他根本没点），而那正是本仓最贵的缺陷形态「静默生效」。
 *
 * 【为什么双重门槛】判据定在误报率上而不是召回率上（计划书原文）。
 *   误报 = 用户点一下多出一条错数据；漏报 = 用户自己手动加一次。代价不对称，故：
 *   **时间词与意向词必须同时命中**。只命中一个的句子一律 `none`，不出条。
 *   例：「今天天气不错」有时间词（今天）无意向词 ⇒ 不出条；
 *       「一起吃饭」有意向词无时间词 ⇒ 只出「记到备忘」（日期待定），不出「加日程」。
 *
 * 【本件不读时钟、不写盘、不发请求】
 *   `now`（剧情当下）由调用方算好传进来 —— 读钟是 App 的事（`config/time-source.js` 是唯一取数口）。
 *   这样本件可以在判据里用固定时刻复跑，两次跑逐字相同。
 *
 * 【三条不变量】
 *   ① 没有 id 的消息**一律不办**（回不了源、也无法撤销 —— 与 X8 引用必须真同一条）；
 *   ② 每个候选都带 `sourceMsgId` 与 `why`（为什么给它），界面必须把 why 写出来；
 *   ③ 标题只从原句**剔词**得到，不生成新句子：生成要模型，模型会编。
 * ============================================================ */
'use strict';
import {
    INLINE_ACTION_KINDS, INLINE_ACTION_STATES, INLINE_ACTION_WHY,
    INLINE_ACTION_LIMITS, INLINE_ACTION_WEEKDAYS,
    INLINE_ACTION_INTENT_WORDS, INLINE_ACTION_ASK_MARKS, INLINE_ACTION_DRAFTS
} from './inline-action-terms.js';
import { pickTime, stripTimeWords } from './inline-action-time.js';

/** 意向词命中（返回命中的那一个词，没命中返回空串 —— 界面要写「因为哪几个字」）。 */
export function intentOf(text) {
    const s = String(text == null ? '' : text);
    for (const w of INLINE_ACTION_INTENT_WORDS) {
        if (s.includes(w)) return w;
    }
    return '';
}

/** 是不是在问（问句标记）。 */
export function isAsk(text) {
    const s = String(text == null ? '' : text).trim();
    if (!s) return false;
    for (const m of INLINE_ACTION_ASK_MARKS) {
        if (m === '吗' || m === '呢' || m === '吧') { if (s.includes(m)) return true; }
        else if (s.endsWith(m)) return true;
    }
    return false;
}

/**
 * 标题：把命中过的时间词与意向词**剔掉**，剩下的就是「这件事本身」。
 *   ★ 剔词而不是另生成一句：生成要模型，模型会编（本仓 X8 已立过同一条规矩）。
 *   ★ 剔完什么都不剩 ⇒ 空串，调用方据此丢弃（记 `no-title`）。
 */
export function titleOf(text) {
    /* ★ 时间词表由时间件独有（两处各编一份就会「算得出日子、却删不掉那个字」）。 */
    let s = stripTimeWords(text);
    for (const w of INLINE_ACTION_INTENT_WORDS) s = s.split(w).join(' ');
    s = s.replace(/[吗呢吧呀啊哦]+/g, ' ').replace(/[\s,，。.！!？?、;；:：~～]+/g, ' ').trim();
    /* ★ 剔完什么都不剩 ≠ 没法办：像「周六有空吗」这种句子，剔掉时间与意向之后就没了，
     *   而它恰恰是本项最典型的一句。此时**退回原句本身**（只去标点与问句尾巴）——
     *   退回不是编，是把用户原话当标题；编一句新的才是编。
     *   计划书要求「no-title 因由非空」，因由仍在：原句也剔空的才丢弃（见下）。 */
    if (!s) {
        s = String(text == null ? '' : text)
            .replace(/[吗呢吧呀啊哦]+/g, ' ')
            .replace(/[\s,，。.！!？?、;；:：~～]+/g, ' ')
            .trim();
    }
    if (!s) return '';
    return s.length <= INLINE_ACTION_LIMITS.titleMaxChars
        ? s : (s.slice(0, INLINE_ACTION_LIMITS.titleMaxChars) + '…');
}

/** 回一句的草稿：按命中词挑一句现成的（不生成）。挑不到 ⇒ 空串。 */
export function draftOf(text) {
    const s = String(text == null ? '' : text);
    for (const d of INLINE_ACTION_DRAFTS) {
        for (const w of d.when) {
            if (s.includes(w)) return d.text;
        }
    }
    return '';
}

/**
 * 主出口：一条消息 → 候选动作。
 *
 * @param {{id?:*, content?:string, from?:string}} msg 一条微信消息
 * @param {{storyMs?:number}} now 剧情当下（由调用方取好）
 * @returns {{state:string, actions:Array, why:string}}
 *   · `state: 'unreadable'` 且 `why: 'no-msg-id'` ⇒ 这条消息没有 id，**什么都不办**；
 *   · `state: 'none'` ⇒ 读得到、但这句里没有可办的事（界面不许多出一块空白）。
 */
export function scanMessage(msg, now) {
    const out = { state: INLINE_ACTION_STATES.none, actions: [], why: '' };
    if (!msg || typeof msg !== 'object') { out.state = INLINE_ACTION_STATES.unreadable; out.why = INLINE_ACTION_WHY.tooLong; return out; }
    const id = String(msg.id == null ? '' : msg.id).trim();
    if (!id) { out.state = INLINE_ACTION_STATES.unreadable; out.why = INLINE_ACTION_WHY.noMsgId; return out; }
    const text = String(msg.content == null ? msg.mes == null ? '' : msg.mes : msg.content);
    if (!text.trim()) return out;
    const t = pickTime(text, now);
    const intent = intentOf(text);
    const ask = isAsk(text);
    /* ★ 双重门槛：只命中一个的句子一律不出条（误报率优先，见文件头）。 */
    if (!intent) { out.why = INLINE_ACTION_WHY.noIntent; return out; }
    if (!t.hasTime) { out.why = INLINE_ACTION_WHY.noTime; return out; }
    const title = titleOf(text);
    if (!title) { out.why = INLINE_ACTION_WHY.noTitle; return out; }
    const actions = [];
    /* 一档：算得出具体日子 ⇒ 加日程（唯一真写盘的一档）。 */
    if (t.dateKey && !t.vague) {
        actions.push({
            kind: INLINE_ACTION_KINDS.schedule,
            sourceMsgId: id,
            title: title,
            payload: { dateKey: t.dateKey, time: t.time, title: title },
            why: '碰上「' + intent + '」与时间「' + (t.time || t.dateKey) + '」'
        });
    }
    /* 二档：记到备忘（日子没定也能记下来）。 */
    actions.push({
        kind: INLINE_ACTION_KINDS.memo,
        sourceMsgId: id,
        title: title,
        payload: { dateKey: '', time: '', title: title },
        why: '这句在约一件「' + intent + '」的事，日子' + (t.dateKey && !t.vague ? '已算出（' + t.dateKey + '）' : '还没定')
    });
    /* 三档：问句 ⇒ 给一句草稿（只填输入框，**不替你发**）。 */
    if (ask) {
        const draft = draftOf(text);
        if (draft) {
            actions.push({
                kind: INLINE_ACTION_KINDS.reply,
                sourceMsgId: id,
                title: draft,
                payload: { text: draft },
                why: '这句在问你，草稿是「' + draft + '」—— 只填进输入框，发不发你决定'
            });
        }
    }
    out.actions = actions.slice(0, INLINE_ACTION_LIMITS.maxPerMsg);
    out.state = out.actions.length ? INLINE_ACTION_STATES.ok : INLINE_ACTION_STATES.none;
    if (!out.actions.length) out.why = INLINE_ACTION_WHY.noTitle;
    return out;
}

/** 内部一致：星期表与人话标签必须同长（改了表忘了改字，界面会写成 undefined）。 */
if (INLINE_ACTION_WEEKDAYS.length !== 7) {
    throw new Error('INLINE_ACTION_WEEKDAYS must have 7 entries');
}
