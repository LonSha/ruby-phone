/* ========================================================
 * config/group-vote-handoff.js — [v4.44.0 · 第五期 R5-O2] 群投票 → 日历事项的**交接凭据**
 * --------------------------------------------------------
 * 【这一刀治的是什么（修前实测处境）】
 *   `apps/wechat/chat-view.js::confirmGroupVote` 在确认后派发 `phone:groupVoteConfirm`，
 *   然后**立刻**弹一句「已转交日历确认」——可全仓对 `GROUP_VOTE_CONFIRM` 的接收者
 *   实测为 **0 个**：`grep -rn 'GROUP_VOTE_CONFIRM' apps/ config/ index.js` 只命中
 *   派发点本身与事件登记表。日历侧一个监听器都没有，而且日历是**懒加载** App ——
 *   用户没打开过日历时，连实例都不存在。
 *   ⇒ 「已转交」是**谎报**：既没有接收者，也没有任何入口能让这件事变成日历上的一条。
 *   这与本仓反复治过的「看起来没坏但显示不对」同族：不报错、不崩界面，
 *   只是把「没人接」显示成了「已经交出去了」。
 *
 * 【本件的位置】纯契约：把派发出来的 `detail` **归一成一份可落笔的凭据**，
 *   并给出「这次交接到了哪一步」的四态与一句话读数。它不碰 DOM、不碰存储、
 *   不读时钟（与同族 `*-contract.js` 同规格）—— 存草稿与建事项是日历 owner 的事。
 *
 * 【为什么「投票胜出」不等于「已约好」（本项核心）】
 *   投票只说明「大家倾向哪个选项」；它**不是承诺**。故本件把凭据分成两段：
 *     · `received` —— 日历**收到了**这份凭据（还没落笔，用户在表单上补日期/时段/地点）；
 *     · `created`  —— 用户**显式提交**后，日历上真的多了一条事项。
 *   中间那一步（补日期时段地点）**必须由用户做**，本件与日历都不替它猜日期。
 *
 * 【「重复转交不双建」怎么落】
 *   幂等键 = `activityId`（由内核按「选项 + 参与名单」确定性派生，同一份活动恒同 id）。
 *   日历侧记一份 `applied` 台账：同一 `activityId` 第二次转交**不重复建事项**，
 *   如实报 `replayed` 而不是假装又建了一条。
 * ======================================================== */
'use strict';

/** 凭据归一的归因词表（判据按此表逐词核，防随口新词）。 */
export const GV_HANDOFF_REASONS = Object.freeze({
    OK: '',
    NOT_OBJECT: 'handoff-not-object',
    NO_ACTIVITY: 'handoff-no-activity',
    NO_OPTION: 'handoff-no-option'
});

/** 交接到了哪一步（四态；界面文案的唯一出处）。 */
export const GV_HANDOFF_STATES = Object.freeze({
    RECEIVED: 'received',
    REPLAYED: 'replayed',
    CREATED: 'created',
    FAILED: 'failed',
    UNRECEIVED: 'unreceived'
});

/** 界面文案（唯一一份；视图不写第二套说法）。 */
export const GV_HANDOFF_STATE_LABEL = Object.freeze({
    received: '已交到日历：待你在表单上补日期与时段',
    replayed: '这份活动**已经建过事项**了（不重复建）',
    created: '已建立日历事项',
    failed: '交不过去：这份凭据不完整',
    unreceived: '**没有接收者**：日历没接这一份（本卡不代写）'
});

/** 上限的唯一出处（视图不自己拟一个条数）。 */
export const GV_HANDOFF_LIMITS = Object.freeze({
    participants: 24,
    title: 60,
    place: 40,
    optionId: 120,
    activityId: 80,
    applied: 80
});

/** 存储键的唯一出处（日历 owner 读写用；本件不读存储）。 */
export const GV_HANDOFF_KEYS = Object.freeze({
    draft: 'calendar_vote_handoff',
    applied: 'calendar_vote_applied'
});

function toStr(v) { return (typeof v === 'string') ? v : ''; }

/**
 * 把派发出来的 detail 收成一份可落笔的凭据（**永不抛**）。
 *   ★ 缺 `activityId` 或 `optionId` 一律**拒收**并给出归因词：
 *     拿一份认不出的凭据去建事项，会在日历上留一条**没有出处**的日程 ——
 *     那比「没建」更难收拾（用户无法回溯它是哪次投票来的）。
 *   ★ 参与者名单**原样搬**、去空、限量，不在这里做成员表校验：
 *     投票内核已按稳定成员身份算过参与名单，本件再判一次就是第二份实现。
 * @returns {{ok:boolean, why:string, activityId:string, optionId:string, round:number,
 *            participants:string[], title:string, place:string, activityKey:string}}
 */
export function normalizeHandoff(detail) {
    const empty = {
        ok: false, why: GV_HANDOFF_REASONS.NOT_OBJECT, activityId: '', optionId: '',
        round: 1, participants: [], title: '', place: '', activityKey: ''
    };
    if (!detail || typeof detail !== 'object' || Array.isArray(detail)) return empty;
    const activityId = toStr(detail.activityId).trim().slice(0, GV_HANDOFF_LIMITS.activityId);
    if (!activityId) {
        return Object.assign({}, empty, { why: GV_HANDOFF_REASONS.NO_ACTIVITY });
    }
    const optionId = toStr(detail.optionId).trim().slice(0, GV_HANDOFF_LIMITS.optionId);
    if (!optionId) {
        return Object.assign({}, empty, { why: GV_HANDOFF_REASONS.NO_OPTION, activityId: activityId });
    }
    const round = Math.max(1, Math.floor(Number(detail.round) || 1));
    const raw = Array.isArray(detail.participants) ? detail.participants : [];
    const participants = [];
    for (const item of raw) {
        const name = toStr(item).trim();
        if (!name) continue;
        if (participants.indexOf(name) >= 0) continue;
        participants.push(name);
        if (participants.length >= GV_HANDOFF_LIMITS.participants) break;
    }
    const label = toStr(detail.label).trim().slice(0, GV_HANDOFF_LIMITS.title);
    const place = toStr(detail.place).trim().slice(0, GV_HANDOFF_LIMITS.place);
    return {
        ok: true,
        why: GV_HANDOFF_REASONS.OK,
        activityId: activityId,
        optionId: optionId,
        round: round,
        participants: participants,
        /* ★ 标题优先取活动名；活动名缺席时**如实退回选项 id** ——
         *   不编一个「群活动」之类的占位名：那会让用户以为这条日程有出处。 */
        title: label || optionId,
        place: place,
        /* 幂等键 = 活动 id（内核按「选项 + 参与名单」确定性派生，同一份活动恒同键）。 */
        activityKey: activityId
    };
}

/**
 * 一句读数（'' = 没有要说的）。**唯一实现**：界面与回执都念这一句。
 *   ★ `received` 时明说「还差什么」：这不是「已经约好」。
 *   ★ `unreceived` 时明说**本卡不代写**：把「没人接」与「已经交出去了」分开。
 */
export function handoffLine(read) {
    const r = (read && typeof read === 'object') ? read : {};
    const state = String(r.state || '');
    const h = (r.handoff && typeof r.handoff === 'object') ? r.handoff : null;
    switch (state) {
        case GV_HANDOFF_STATES.RECEIVED: {
            const who = h && h.participants.length ? '（' + h.participants.length + ' 人）' : '';
            const title = h ? h.title : '';
            return '已交到日历：' + title + who + ' · **还没成事项**，日期与时段要你在表单上补';
        }
        case GV_HANDOFF_STATES.REPLAYED:
            return '这份活动**已经建过事项**了 —— 不重复建（幂等键是活动 id，不是点了几次）';
        case GV_HANDOFF_STATES.CREATED: {
            const base = '已建立日历事项：' + String(r.title || (h ? h.title : ''));
            /* ★ 约定没写进记忆时如实补一句（`memoryRegistered === false` 才补）：
             *   日历这条**已经建成**，只是没跟记忆对上 —— 这不是「没建成」。
             *   `null` / 缺省 = 本份没有可写约定的对象（名单里只有自己），**不加尾巴**：
             *   把「不适用」说成「没登记」是另一种谎报。 */
            return (r.memoryRegistered === false)
                ? base + '（记忆未登记：日历独立成立，约定没写进记忆）'
                : base;
        }
        case GV_HANDOFF_STATES.UNRECEIVED:
            return '**没有接收者**：日历没接这一份（本卡零写盘，不代写事项）';
        case GV_HANDOFF_STATES.FAILED:
        default:
            return '交不过去：' + (GV_HANDOFF_REASONS.NO_ACTIVITY === String(r.why || '')
                ? '这份凭据没有活动 id（认不出是哪一次投票）'
                : GV_HANDOFF_REASONS.NO_OPTION === String(r.why || '')
                    ? '这份凭据没有选项（不知道要建哪一项）'
                    : '凭据形态不对（不是对象）');
    }
}

/** 状态的中文标签（'' = 认不出；视图不写第二份映射）。 */
export function handoffStateLabel(state) {
    return GV_HANDOFF_STATE_LABEL[String(state || '')] || '';
}

/** 本件认识的状态 id 列表（界面不写第二份状态表）。 */
export function handoffStateIds() {
    return Object.values(GV_HANDOFF_STATES).slice();
}

/**
 * 自检（判据与体检共用；真跑一遍，不写「已检查」）。
 *   覆盖：合法凭据归一 / 三态拒收 / 参与者去重限量 / 幂等键跟随活动 id /
 *   读数四态互不同形 / 纯函数（不改入参）。
 */
export function handoffSelfCheck() {
    const problems = [];
    const good = {
        activityId: 'act_1', optionId: 'o1', round: 2,
        participants: ['甲', '乙', '甲', ''], label: '周五郊游'
    };
    const n = normalizeHandoff(good);
    if (!n.ok) problems.push('合法凭据被拒收：' + n.why);
    if (n.activityId !== 'act_1' || n.optionId !== 'o1') problems.push('归一丢了 id');
    if (n.round !== 2) problems.push('轮次没搬对');
    if (n.participants.length !== 2) problems.push('参与者没去重/去空（实得 ' + n.participants.length + '）');
    if (n.title !== '周五郊游') problems.push('标题没取活动名');
    if (n.activityKey !== n.activityId) problems.push('幂等键必须跟随活动 id');
    if (good.participants.length !== 4) problems.push('归一改了入参（纯函数被破坏）');

    const noAct = normalizeHandoff({ optionId: 'o1' });
    if (noAct.ok || noAct.why !== GV_HANDOFF_REASONS.NO_ACTIVITY) problems.push('缺活动 id 未按 NO_ACTIVITY 拒收');
    const noOpt = normalizeHandoff({ activityId: 'a1' });
    if (noOpt.ok || noOpt.why !== GV_HANDOFF_REASONS.NO_OPTION) problems.push('缺选项未按 NO_OPTION 拒收');
    const bad = normalizeHandoff('x');
    if (bad.ok || bad.why !== GV_HANDOFF_REASONS.NOT_OBJECT) problems.push('非对象未按 NOT_OBJECT 拒收');
    /* ★ 缺活动名时退回选项 id，**不编占位名**。 */
    const bare = normalizeHandoff({ activityId: 'a2', optionId: 'o9' });
    if (bare.title !== 'o9') problems.push('活动名缺席时必须退回选项 id（不得编占位名）');

    /* 读数四态互不同形（把任意两态写成同一句就是「读数在撒谎」）。 */
    const lines = [
        handoffLine({ state: GV_HANDOFF_STATES.RECEIVED, handoff: n }),
        handoffLine({ state: GV_HANDOFF_STATES.REPLAYED }),
        handoffLine({ state: GV_HANDOFF_STATES.CREATED, title: '周五郊游' }),
        handoffLine({ state: GV_HANDOFF_STATES.UNRECEIVED })
    ];
    if (lines.some((s) => !String(s || '').length)) problems.push('四态里有一态没有读数');
    if (new Set(lines).size !== lines.length) problems.push('四态读数有同形的（读数分不出状态）');
    if (lines[0].indexOf('还没成事项') < 0) problems.push('received 必须明说「还没成事项」');
    if (lines[3].indexOf('没有接收者') < 0) problems.push('unreceived 必须明说没有接收者');
    /* ★ 「记忆未登记」的尾巴只在该补时补（`false` 才补；`null` = 不适用，不加尾巴）。 */
    const createdOk = handoffLine({ state: GV_HANDOFF_STATES.CREATED, title: '周五郊游', memoryRegistered: true });
    const createdNoMem = handoffLine({ state: GV_HANDOFF_STATES.CREATED, title: '周五郊游', memoryRegistered: false });
    const createdNa = handoffLine({ state: GV_HANDOFF_STATES.CREATED, title: '周五郊游', memoryRegistered: null });
    if (createdOk !== createdNa) problems.push('memoryRegistered=null 不得与 true 不同形（不适用 ≠ 未登记）');
    if (createdNoMem === createdOk) problems.push('记忆未登记时必须如实补一句（不许与已登记同形）');
    if (createdNoMem.indexOf('记忆未登记') < 0) problems.push('未登记尾巴必须明说「记忆未登记」');
    if (createdNoMem.indexOf('已建立日历事项') < 0) problems.push('未登记时日历这条仍须成立（不得读成「没建成」）');
    return {
        problems: problems,
        states: handoffStateIds().length,
        reasons: Object.keys(GV_HANDOFF_REASONS).length,
        limits: Object.keys(GV_HANDOFF_LIMITS).length
    };
}

export default {
    GV_HANDOFF_REASONS,
    GV_HANDOFF_STATES,
    GV_HANDOFF_STATE_LABEL,
    GV_HANDOFF_LIMITS,
    GV_HANDOFF_KEYS,
    normalizeHandoff,
    handoffLine,
    handoffStateLabel,
    handoffStateIds,
    handoffSelfCheck
};
