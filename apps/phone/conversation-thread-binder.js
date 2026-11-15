/* ============================================================
 * apps/phone/conversation-thread-binder.js — [R21-X5 · 通话与消息的「同一段对话」串联]
 * ------------------------------------------------------------
 * 【修前实测的缺口（读码可复算，不是推演）】
 *   先微信聊 20 分钟、再打个电话 5 分钟 —— 玩家心里这是一段交流；而本仓两本账
 *   各记各的：`apps/wechat/wechat-data.js` 只记消息（`getMessages(chatId)`），
 *   `apps/phone/phone-data.js` 只记通话（`addCallRecord` 落 `{caller,date,time,duration,status,transcript}`），
 *   **没有任何一处回答「这通电话接着哪段聊天」**。后果三件都不报错：
 *     ① 通话详情页只有独立的一段 transcript，看不出前面还有若干条微信；
 *     ② 玩家想回看「打电话之前说了什么」只能自己翻会话、靠记忆对时间；
 *     ③ 跨天的两件事（昨晚的微信 / 今早的电话）在界面上同形 ——
 *        而处置相反（前者该并成一段，后者本就该分开）—— 这正是本件唯一一处
 *        「宁可保守」的判据：**跨天一律不串**。
 *
 * 【与 config/comm-thread.js 的分工（不许合并口径）】
 *   `comm-thread`（R6-O2）是**写入型台账**：它把接触点 append 进自己的存储键
 *   （`comm_threads_v1`），回答「我们这一段聊到哪、断在哪、有没有没回的」。
 *   本件是**严格纯读**：不写任何存储、不 append 任何接触点，输入是「一通电话 +
 *   一批已存在的消息」，输出是「它们是不是同一段」——**只报事实，不落账**。
 *   合并二者会把「读一次就改一次台账」（打开详情页即产生副作用）带进来，
 *   与 comm-thread 的「误合比漏合更伤」纪律直接冲突。故两件各自持口径，互不引用。
 *
 * 【三条铁律（违反即红，判据里有负控制）】
 *   ① 三态由**候选数唯一决定**：0 条候选 ⇒ standalone；1 条 ⇒ threaded；
 *      ≥2 条 ⇒ ambiguous 且**候选全列**（不许只取第一条 —— 与 R21-O8 同款纪律）。
 *   ② 跨天不串：通话日与消息日（各按剧情钟取年月日）不同 ⇒ 一律不参与候选。
 *      剧情钟读不出的那一侧**不猜**：通话时刻读不出 ⇒ 整体 `standalone` +
 *      明确 reason，绝不拿墙钟顶替（与 chat-read-cursor / comm-time 同源）。
 *   ③ 只读：本模块零 import 存储层、零写路径；判据用「调用计数守卫」证明它
 *      一次都没碰过 storage（与 R21-X2 的纯读硬证据同规格）。
 * ============================================================ */
'use strict';
import { numOrNull } from '../../config/num-gate.js';
/* 话题词口径**不新造第二份**：中文 bigram 集合来自 config/search-facets.js
 *   （R14 立的口径，词序无关），本件只做交集计数，不重写分词。 */
import { bigramsOf } from '../../config/search-facets.js';

/* ---------- 词表（全部冻结；判据按词表核，不按实现核） ---------- */
/** 串联三态。★ 刻意不压平：ambiguous 与 standalone 处置相反（前者要人挑，后者不用）。 */
export const THREAD_STATES = Object.freeze({
    THREADED: 'threaded',       // 唯一候选：这一段就是接着那批消息
    AMBIGUOUS: 'ambiguous',     // 多条候选：全列出，不替用户挑
    STANDALONE: 'standalone'    // 没有候选：这通电话就是独立一件事
});
/** 归因（诊断面与判据共用；空串 = 顺利串成）。 */
export const BIND_REASONS = Object.freeze({
    OK: '',
    CALL_CLOCK_ABSENT: 'call-clock-absent',         // 通话时刻读不出（不猜）
    NO_MESSAGE_POINTS: 'no-message-points',         // 一条可比消息都没有
    OUT_OF_WINDOW: 'out-of-window',                 // 有消息但都不在时间窗内
    OTHER_DAY: 'other-day',                         // 有邻近消息但跨天（保守不串）
    OTHER_PARTICIPANT: 'other-participant',         // 时间邻近但不是同一个人
    NO_TOPIC_OVERLAP: 'no-topic-overlap',           // 同人同窗但话题无重叠
    MULTIPLE_CANDIDATES: 'multiple-candidates'      // 多条候选并列（全列）
});
/** 阈值（一张显式表；调它即调判据）。 */
export const BIND_LIMITS = Object.freeze({
    windowMinutes: 90,   // 剧情钟邻近窗（对称：距通话 <= 90 分钟）
    maxCandidates: 8,    // 最多列几条候选（防一次串出几十条把界面压垮）
    minTopicGrams: 1     // 话题重叠下限（bigram 交集个数）
});

/* ---------- 取值助手：全仓唯一实现，不就地写第二份 ---------- */
const textOf = (v) => (typeof v === 'string' ? v.trim() : '');
const stampOf = (v) => {
    const n = numOrNull(v);
    return (n !== null && n > 0) ? n : null;
};
/**
 * 剧情日的日键（`YYYY-MM-DD`）。
 * ★ 为什么用**本地**日期分量：剧情钟是「用户看见的那个墙上时刻」，与 storyClock 的
 *   显示口径同一坐标系；用 UTC 取分量会让 0 点前后的通话与消息跨日错位。
 * @returns {string|null} 读不出（非有限数）⇒ null，不猜
 */
export function dayKeyOf(ms) {
    const n = stampOf(ms);
    if (n === null) return null;
    const d = new Date(n);
    const pad = (x) => String(x).padStart(2, '0');
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

/**
 * 归一一条消息接触点（只持**引用**：id / chatId / 时刻 / 文本摘要，不持整条消息对象）。
 * @returns {{id:string, chatId:string, participant:string, storyAt:number, text:string}|null}
 */
export function normalizeMessagePoint(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const storyAt = stampOf(raw.storyAt);
    if (storyAt === null) return null;             // 没有剧情时刻 ⇒ 不参与串联（不猜墙钟）
    const id = textOf(raw.id);
    if (!id) return null;                          // 没有身份 ⇒ 无法回源，丢弃
    return {
        id: id,
        chatId: textOf(raw.chatId),
        participant: textOf(raw.participant),
        storyAt: storyAt,
        text: textOf(raw.text)
    };
}

/**
 * 归一通话接触点。`storyAt` 必须由调用方**显式**给出（它得先在 App 侧用
 *   `config/comm-time.js` 的 `stampOfCall` 把文本时间解析成毫秒 —— 读不出就是 null）。
 * ★ 本件刻意**不**在这里解析文本时间：那会让「通话时间解析」有第二份实现，
 *   而 comm-time 已经是本仓那一格的唯一出口（同 R21-X2 的「口径单一实现」纪律）。
 */
export function normalizeCallPoint(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const storyAt = stampOf(raw.storyAt);
    if (storyAt === null) return null;
    const participant = textOf(raw.participant);
    if (!participant) return null;
    const dur = numOrNull(raw.durationSec);
    return {
        id: textOf(raw.id),
        participant: participant,
        storyAt: storyAt,
        durationSec: (dur !== null && dur > 0) ? Math.round(dur) : 0,
        status: textOf(raw.status) || 'answered',
        text: textOf(raw.text)
    };
}

/** 话题重叠读数：两侧文本的中文 bigram 交集个数（任一侧空文本 ⇒ 0，不猜）。 */
export function topicOverlapOf(a, b) {
    const ga = bigramsOf(textOf(a));
    const gb = bigramsOf(textOf(b));
    if (!ga.length || !gb.length) return 0;
    const setB = new Set(gb);
    let hit = 0;
    const seen = new Set();
    for (const g of ga) {
        if (seen.has(g)) continue;   // 同一 bigram 重复出现只计一次（防长文本靠复读刷分）
        seen.add(g);
        if (setB.has(g)) hit += 1;
    }
    return hit;
}

/** 通话时长读数（与判据共用；界面与线行不许各写一份）。 */
export function durationTextOf(seconds) {
    const s = numOrNull(seconds);
    if (s === null || s <= 0) return '';
    const m = Math.floor(s / 60);
    const r = s % 60;
    return m > 0 ? (m + '分' + r + '秒') : (r + '秒');
}

/** 一句话读数（「本段交流：微信 N 条 → 通话 5 分钟」的唯一实现）。 */
export function conversationLine(bound) {
    const b = (bound && typeof bound === 'object') ? bound : {};
    const dur = durationTextOf(b.durationSec);
    if (b.state === THREAD_STATES.THREADED) {
        const n = Number(b.transcriptCount) || 0;
        return '本段交流：微信 ' + String(n) + ' 条 → 通话 ' + (dur || '已接通');
    }
    if (b.state === THREAD_STATES.AMBIGUOUS) {
        const k = Array.isArray(b.candidates) ? b.candidates.length : 0;
        return '本段交流：有 ' + String(k) + ' 段候选会话，请挑一段（不替用户选）';
    }
    return '本段交流：独立一件事（前面没有可归入的对话）';
}

/**
 * 串联判定（本件唯一入口）。
 * @param {object} call 通话（`normalizeCallPoint` 的入参形状，须带显式 storyAt）
 * @param {Array} messages 已存在的消息接触点（`normalizeMessagePoint` 的入参形状）
 * @param {{windowMinutes?:number, maxCandidates?:number, minTopicGrams?:number}} [opts]
 */
export function bindConversationThread(call, messages, opts = {}) {
    const o = (opts && typeof opts === 'object') ? opts : {};
    const win = (() => {
        const n = numOrNull(o.windowMinutes);
        return (n !== null && n > 0) ? n : BIND_LIMITS.windowMinutes;
    })();
    const maxC = (() => {
        const n = numOrNull(o.maxCandidates);
        return (n !== null && n > 0) ? Math.floor(n) : BIND_LIMITS.maxCandidates;
    })();
    const minGrams = (() => {
        const n = numOrNull(o.minTopicGrams);
        return (n !== null && n >= 0) ? n : BIND_LIMITS.minTopicGrams;
    })();

    const c = normalizeCallPoint(call);
    /**
     * 单态返回体的**唯一**构造点。
     * ★ `topicComparable` 必须在这一层就带上（本判据 A5 当场抓到过首版漏了它）：
     *   它是「话题面**比过没有**」的读数，而调用方要靠它区分
     *   「没比过」（无转写 / 无消息 ⇒ 不该据此拦下）与「比过了、不重叠」
     *   （明确拦下）—— 两者在界面上同形、处置完全相反，缺这一格就是把它们压平。
     * @param {string} reason 归因
     * @param {boolean} compared 这一路是不是**真的做过**话题比较
     */
    const empty = (reason, compared = false) => ({
        state: THREAD_STATES.STANDALONE,
        reason: reason,
        participant: c ? c.participant : '',
        storyAt: c ? c.storyAt : null,
        durationSec: c ? c.durationSec : 0,
        transcriptCount: 0,
        window: { minutes: win, start: c ? c.storyAt - win * 60000 : null, end: c ? c.storyAt + win * 60000 : null },
        candidate: null,
        candidates: [],
        dayKey: c ? dayKeyOf(c.storyAt) : null,
        topicComparable: !!compared
    });
    /* 通话时刻读不出 ⇒ 整体不串（绝不拿墙钟顶替）。 */
    if (!c) return empty(BIND_REASONS.CALL_CLOCK_ABSENT);

    const points = (Array.isArray(messages) ? messages : []).map(normalizeMessagePoint).filter(Boolean);
    if (!points.length) return empty(BIND_REASONS.NO_MESSAGE_POINTS);

    const callDay = dayKeyOf(c.storyAt);
    const lo = c.storyAt - win * 60000;
    const hi = c.storyAt + win * 60000;
    const callWho = c.participant.toLowerCase();

    /* 三面筛：①同人 ②同窗 ③同天。每一步的失败都留下**可归因**的计数 ——
     *   否则界面上只会看到「没串上」，而没串上的原因是四种完全不同的事。 */
    let nearCount = 0;      // 落在时间窗内（不论人 / 天）
    let otherDayCount = 0;  // 时间窗内但跨天
    let otherWhoCount = 0;  // 时间窗内但不是同一个人

    const byChat = new Map();
    for (const p of points) {
        if (p.storyAt < lo || p.storyAt > hi) continue;
        nearCount += 1;
        const pDay = dayKeyOf(p.storyAt);
        if (callDay === null || pDay === null || pDay !== callDay) { otherDayCount += 1; continue; }
        if (p.participant && callWho && p.participant.toLowerCase() !== callWho) { otherWhoCount += 1; continue; }
        const key = p.chatId || ('#' + p.participant);
        if (!byChat.has(key)) byChat.set(key, []);
        byChat.get(key).push(p);
    }

    if (!nearCount) return empty(BIND_REASONS.OUT_OF_WINDOW);
    if (!byChat.size) {
        /* 时间窗内有消息，但全被后两面挡下 —— 按**主因**归因（跨天优先：它更保守也更贵）。 */
        return empty(otherDayCount > 0 ? BIND_REASONS.OTHER_DAY : BIND_REASONS.OTHER_PARTICIPANT);
    }

    /* 话题面：按会话分组统计重叠。通话侧文本 = transcript 文本（无则空 ⇒ 不可比）。 */
    const grouped = [];
    for (const [chatId, list] of byChat.entries()) {
        const sorted = list.slice().sort((a, b) => a.storyAt - b.storyAt);
        const joined = sorted.map((x) => x.text).filter(Boolean).join(' ');
        grouped.push({
            chatId: chatId,
            count: sorted.length,
            from: sorted[0].storyAt,
            to: sorted[sorted.length - 1].storyAt,
            ids: sorted.map((x) => x.id),
            overlap: topicOverlapOf(c.text, joined),
            hasText: joined.length > 0
        });
    }
    /* 通话侧没有文本 ⇒ 话题面**不可比**，如实标出而不是当成「重叠 0」：
     *   前者是「没法比」，后者是「比过了、不一样」—— 处置相反（不可比时不该据此拦下）。 */
    const topicComparable = c.text.length > 0 && grouped.some((g) => g.hasText);
    const passing = topicComparable
        ? grouped.filter((g) => g.overlap >= minGrams)
        : grouped.slice();
        if (!passing.length) return empty(BIND_REASONS.NO_TOPIC_OVERLAP, topicComparable);

    const ranked = passing
        .slice()
        .sort((a, b) => (b.overlap - a.overlap) || (Math.abs(b.to - c.storyAt) - Math.abs(a.to - c.storyAt)));

    const project = (g) => ({
        chatId: g.chatId,
        transcriptCount: g.count,
        from: g.from,
        to: g.to,
        ids: g.ids.slice(0, 40),
        overlap: g.overlap
    });
    const base = {
        reason: BIND_REASONS.OK,
        participant: c.participant,
        storyAt: c.storyAt,
        durationSec: c.durationSec,
        transcriptCount: 0,
        window: { minutes: win, start: lo, end: hi },
        candidates: [],
        dayKey: callDay,
        topicComparable: topicComparable,
        nearCount: nearCount,
        otherDayCount: otherDayCount,
        otherWhoCount: otherWhoCount
    };

    if (ranked.length === 1) {
        const g = ranked[0];
        return Object.assign(base, {
            state: THREAD_STATES.THREADED,
            transcriptCount: g.count,
            candidate: project(g),
            candidates: [project(g)]
        });
    }
    /* 多条候选：**全列**（按相关度排序但一个都不丢），不替用户挑。 */
    const all = ranked.slice(0, maxC).map(project);
    return Object.assign(base, {
        state: THREAD_STATES.AMBIGUOUS,
        reason: BIND_REASONS.MULTIPLE_CANDIDATES,
        candidate: null,
        candidates: all
    });
}

/** 自检：三态各一条 + 跨天不串 + 读不出不猜（与判据同源，供诊断面调用）。 */
export function conversationBinderSelfCheck() {
    const problems = [];
    const at = (h, m) => new Date(2026, 9, 22, h, m, 0, 0).getTime();
    const call = { id: 'c1', participant: '林昭', storyAt: at(15, 0), durationSec: 300, status: 'answered', text: '方案的事 明天给你答复' };
    const msgs = [
        { id: 'm1', chatId: 'chat-1', participant: '林昭', storyAt: at(14, 40), text: '方案我改了第三版 你看下行不行' },
        { id: 'm2', chatId: 'chat-1', participant: '林昭', storyAt: at(14, 45), text: '方案里那句我再想想 明天给你答复' }
    ];
    const one = bindConversationThread(call, msgs);
    if (one.state !== THREAD_STATES.THREADED) problems.push('唯一候选应判 threaded');
    if (one.transcriptCount !== 2) problems.push('候选条数应等于该会话的消息条数');
    /* 跨天用例必须落在**时间窗内**（相隔一天必然出 90 分钟窗，那属 out-of-window，
     *   不是「跨天」这一面）—— 这是本自检首版自己踩的坑：用例写错会被读成实现错。
     *   取「当天 00:30 的通话 + 前一日 23:50 的消息」：相距 40 分钟（窗内）、跨天。 */
    const dayBefore = { id: 'c1d', participant: '林昭', storyAt: at(0, 30), durationSec: 300, status: 'answered', text: '方案的事 明天给你答复' };
    const priorDayMsgs = [
        { id: 'm9', chatId: 'chat-1', participant: '林昭', storyAt: at(23, 50) - 86400000, text: '方案我改了第三版 你看下行不行' }
    ];
    const noneDay = bindConversationThread(dayBefore, priorDayMsgs);
    if (noneDay.state !== THREAD_STATES.STANDALONE) problems.push('跨天必须不串');
    if (noneDay.reason !== BIND_REASONS.OTHER_DAY) problems.push('窗内跨天必须归因 other-day');
    /* 窗外：如实报 out-of-window（与跨天分列 —— 「离太远」与「隔了天」不是同一件事）。 */
    const farAway = bindConversationThread(call, msgs.map((m) => Object.assign({}, m, { storyAt: at(9, 0), id: m.id + 'f' })));
    if (farAway.reason !== BIND_REASONS.OUT_OF_WINDOW) problems.push('窗外必须归因 out-of-window');
    const noClock = bindConversationThread({ id: 'c2', participant: '林昭', storyAt: null }, msgs);
    if (noClock.reason !== BIND_REASONS.CALL_CLOCK_ABSENT) problems.push('通话时刻读不出必须如实归因，不猜');
    const two = bindConversationThread(call, msgs.concat([
        { id: 'm3', chatId: 'chat-2', participant: '林昭', storyAt: at(14, 50), text: '方案我看了 明天答复你' }
    ]));
    if (two.state !== THREAD_STATES.AMBIGUOUS) problems.push('两条候选应判 ambiguous');
    if (two.candidates.length !== 2) problems.push('ambiguous 必须全列候选');
    const otherWho = bindConversationThread(call, msgs.map((m) => Object.assign({}, m, { participant: '周柠', id: m.id + 'w' })));
    if (otherWho.reason !== BIND_REASONS.OTHER_PARTICIPANT) problems.push('同窗不同人必须归因 other-participant');
    return { ok: problems.length === 0, problems: problems };
}