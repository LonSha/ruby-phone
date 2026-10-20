/* ========================================================
 * group-vote.js — [v4.29.0 · 第四期 R4-X7]
 *   「群聊投票与协商式活动安排」接线件
 *
 * 【本件的位置】夹在纯契约件（config/group-vote-contract.js）与视图之间，
 *   只做三件事：
 *     ① **取数**：把群里的投票消息与表态消息读成契约件要的形状
 *        （选项 / 成员 / 表态 / 已生成活动），喂给 tallyVote / confirmActivity；
 *     ② **持起点**：记住「用户当前要点哪一个选项」——**用户显式点选**，本件不猜；
 *     ③ **落点形状**：把读数 + 两行读数打包给视图，并把「确认」要转交的东西
 *        原样端出去（不写第二份判定词、不写第二份标签表）。
 *
 * 【三条纪律（与 archive-canon.js / plotline-board.js 同规格）】
 *   · 只读：本件**不替任何人表态** —— 没表过态的人不进参与名单、不算反对、
 *     也不按关系刻度推断（契约件压根不读关系刻度）。本件只把消息里**真的写了**
 *     的表态搬出来；
 *   · 不抛：读不到消息面 / 消息畸形 / 契约件抛错，一律降级为归因读数；
 *   · 不猜：没选选项时如实报 `option-absent`，**不默认挑票最多的那一个**
 *     （那会把「用户还没定」伪装成「大家已经定了」）。
 *
 * 【为什么不在实例里缓存读数】与同族两件同一理由：投票面随消息变，
 *   任何实例级缓存都会在新消息 / 删楼回滚后变成陈旧数据。故本件只持有
 *   `_picked`（用户的选择，不是读数），`resetScene()` 把它清掉。
 *
 * 【v4.31.0 · R5-O3 追加：同群多张票不串议题、不串轮次】
 *   修前缺陷（计划原文）：`readings` 遍历整群、保留**首个**问题、**合并所有选项**、
 *   取**最大** round —— 同群里两张同时开放的票被混成「第一题的两个选项」。
 *   本版给每张票一个稳定 `pollId`，选项 / 表态 / 活动 / 轮次一律**归属该票**；
 *   归属判定只走可证边界（显式 ID / 选项唯一命中 / 该群只有一张票），
 *   同名选项命中多张票时**不猜**，如实计入 `unattributed`。
 * ======================================================== */
'use strict';
import {
    tallyVote,
    confirmActivity,
    summarizeVote,
    voteLine,
    activityLine,
    voteGateOf,
    voteNoteOf,
    gvSelfCheck,
    GV_CHOICES,
    GV_CHOICE_LABEL,
    GV_VERDICTS,
    GV_VERDICT_LABEL,
    GV_OPTION_KINDS,
    GV_KIND_LABEL,
    GV_MEMBER_BUCKETS,
    GV_MEMBER_LABEL,
    GV_STATES,
    GV_STATE_HINT,
    GV_REASON_HINT,
    GV_CHOICE_BY_LABEL,
    GV_LIMITS
} from '../../config/group-vote-contract.js';
/* 楼层号走**唯一取数口**（弱口径门 W1 的修法）：不就地再写一份 Number.isFinite(Number(...))。 */
import { numOrNull } from '../../config/num-gate.js';

/** 本件认识的两种消息类别（**只此两份**，视图不写第二份类型字面量）。 */
export const GV_MESSAGE_KINDS = Object.freeze(['group_vote', 'group_vote_statement']);

export class GroupVote {
    constructor(app) {
        this.app = app;
        /** 用户显式点选的选项（**空串表示「还没点」**；不回落成票最多的那个） */
        this._picked = '';
    }
    /** 数据层（取不到就返回 null，由下面各出口降级） */
    _data() {
        try { return (this.app && this.app.wechatData) ? this.app.wechatData : null; }
        catch (_e) { return null; }
    }
    /**
     * [v4.31.0 · R5-O3] 取投票身份键（**同一张票的唯一归属**）。
     *   修前缺口（R5-O3 现状证据原文）：`readings` 遍历整群、保留**首个**问题、
     *   **合并所有选项**、取**最大** round —— 于是同群里两张同时开放的票
     *   （「周一午餐/面」与「周五郊游/公园」）被混成「第一题的两个选项」，
     *   计票结果张冠李戴。故本件给每张票一个稳定 `pollId`，选项 / 表态 / 活动
     *   一律归属该 ID 与轮次，**不再跨票合并**。
     *   取值优先级（**可证边界**，不猜）：
     *     ① 消息自带的 `groupVote.pollId`（新消息由视图写入）；
     *     ② 无显式 ID 时按 `msgId` 派生 —— 稳定且可复算，故退出重开仍定位同一票；
     *     ③ 都没有 ⇒ 空串（该条归入「无归属」，由调用方决定要不要算，**不静默并入第一张票**）。
     */
    pollIdOf(msg, gv) {
        const explicit = String((gv && gv.pollId) || '').trim();
        if (explicit) return explicit.slice(0, 80);
        const msgId = String((msg && msg.id) || '').trim();
        if (msgId) return ('poll@' + msgId).slice(0, 80);
        return '';
    }
    /** [v4.31.0 · R5-O3] 列出该群**所有**投票身份（按出现顺序去重；视图据此先选一张再统计）。 */
    pollIds(chatId) {
        const r = this.readings(chatId);
        if (!r) return [];
        const out = [];
        for (const p of r.polls) if (out.indexOf(p.pollId) < 0) out.push(p.pollId);
        return out;
    }
    /**
     * [v4.31.0 · R5-O3] 按**消息 id** 取该条投票消息的票身份。
     *   视图的「确认」按钮带 `data-message-id`，据此把票号原样带下去 ——
     *   票号怎么算**只许本件一份**（视图不写第二份派生规则）。
     * @returns {string} 票身份（'' = 认不出该消息）
     */
    pollIdOfMessage(chatId, messageId) {
        const d = this._data();
        if (!d) return '';
        const id = String(messageId == null ? '' : messageId).trim();
        if (!id) return '';
        let msgs = null;
        try { msgs = d.getMessages(chatId); } catch (_e) { msgs = null; }
        if (!Array.isArray(msgs)) return '';
        for (const raw of msgs) {
            const m = (raw && typeof raw === 'object') ? raw : null;
            if (!m || String(m.id || '').trim() !== id) continue;
            return this.pollIdOf(m, (m.groupVote && typeof m.groupVote === 'object') ? m.groupVote : {});
        }
        return '';
    }
    /**
     * [v4.31.0 · R5-O3] 把一条**表态**归到哪张票 —— **只走可证边界，判不了就不归**。
     *   优先级：
     *     ① 表态自带 `pollId` ⇒ 只认那张票；指名了一张**不存在**的票 ⇒ 不归
     *        （**不并入别的票**：把 A 票的表态算到 B 票上比不算更危险）；
     *     ② 无显式 ID ⇒ 按「选项在**哪几张**票里」判：**恰命中一张**才算归属；
     *        命中多张（两票都有「面」）⇒ 不归（不按名字猜、不归最近一票）；
     *     ③ 选项压根没给出（如弃权）或命中零张 ⇒ 只有**该群仅一张票**时才归它。
     * @returns {object|null} 归属的票桶；null = 判不了
     */
    _pollForStatement(gv, optionRaw, polls) {
        const explicit = String((gv && gv.pollId) || '').trim();
        if (explicit) return polls.filter((p) => p.pollId === explicit)[0] || null;
        const raw = String(optionRaw == null ? '' : optionRaw).trim();
        if (raw) {
            const hits = polls.filter((p) => p.options.some((o) => o.id === raw || o.label === raw));
            if (hits.length === 1) return hits[0];
            if (hits.length > 1) return null;
        }
        return polls.length === 1 ? polls[0] : null;
    }
    /**
     * 取数：把该群的消息面读成契约件要的形状。
     *   ★ 读不到消息面 ⇒ 返回 null（**不退化成空数组**）：内核据此报「读不出」，
     *     与「真的没人投过票」不同形 —— 后者会让界面说「等大家表态」，而其实
     *     是消息压根没读出来。
     *   ★ [v4.31.0 · R5-O3] 两遍扫描：**先认票、再落表态**。表态要归到哪张票，
     *     得先知道该群有哪些票、每张票有哪些选项 —— 单遍扫描里「表态先到」时
     *     它要投的选项还没被读出来，只能瞎猜。
     * @param {string} chatId
     * @param {string} [pollId] 只取这一张票（空 ⇒ 取**第一张**票的兼容形状，逐票分列在 `polls`）
     * @returns {{question,round,options,members,statements,activities,polls,pollId,pollFound,
     *            unattributedStatements,unattributedActivities}|null} 永不抛
     */
    readings(chatId, pollId) {
        const d = this._data();
        if (!d) return null;
        let msgs = null;
        try { msgs = d.getMessages(chatId); } catch (_e) { msgs = null; }
        if (!Array.isArray(msgs)) return null;
        const want = String(pollId == null ? '' : pollId).trim();
        let members = [];
        try { members = d.getGroupMembers(chatId) || []; } catch (_e) { members = []; }
        const user = (() => {
            try { return d.getUserInfo() || {}; } catch (_e) { return {}; }
        })();
        /* ★ 用户自己是群里的一员（但不进「不被代投」那一格 —— 他就是本人）。 */
        const meId = 'me';
        const memberRows = members.map((m) => ({ id: String(m.id), name: String(m.name) }));
        const selfName = String(user.name || '我').trim() || '我';
        if (!memberRows.some((m) => m.id === meId)) memberRows.push({ id: meId, name: selfName });
        const byName = new Map(memberRows.map((m) => [m.name, m.id]));
        /* ── 第一遍：**票本身**（问题 / 轮次 / 选项）。修前是四个共享累加器
         *    （question 保首个、options 全合并、round 取最大）—— 那正是
         *    「两张票混成一题」的落点。 */
        const polls = [];
        const byPoll = new Map();
        const bucketOf = (pid) => {
            if (byPoll.has(pid)) return byPoll.get(pid);
            const b = { pollId: pid, question: '', round: 1, options: [], statements: [], activities: [], order: polls.length };
            byPoll.set(pid, b);
            polls.push(b);
            return b;
        };
        for (const raw of msgs) {
            const msg = (raw && typeof raw === 'object') ? raw : null;
            if (!msg) continue;
            if (String(msg.type || '').trim() !== 'group_vote') continue;
            const gv = (msg.groupVote && typeof msg.groupVote === 'object') ? msg.groupVote : {};
            const b = bucketOf(this.pollIdOf(msg, gv));
            const r = Math.max(1, Math.floor(Number(gv.round) || 1));
            b.round = Math.max(b.round, r);
            if (!b.question) b.question = String(gv.question || msg.content || '').trim();
            const list = Array.isArray(gv.options) ? gv.options : [];
            for (const it of list) {
                const label = String((it && (it.label || it.text)) || it || '').trim();
                if (!label) continue;
                const id = String((it && it.id) || label).trim();
                if (b.options.some((o) => o.id === id)) continue;
                b.options.push({
                    id: id,
                    label: label,
                    kind: String((it && it.kind) || 'other').trim(),
                    round: Math.max(1, Math.floor(Number(it && it.round) || r))
                });
            }
        }
        /* ── 第二遍：表态消息 —— **谁**对**哪个选项**说了**什么**。
         *   ★ 归属判不了就**不归**（进 `unattributedStatements` 具名），
         *     绝不静默并入第一张票：那正是本版要切断的那件事。 */
        const unattributedStatements = [];
        for (const raw of msgs) {
            const msg = (raw && typeof raw === 'object') ? raw : null;
            if (!msg) continue;
            if (String(msg.type || '').trim() !== 'group_vote_statement') continue;
            const gv = (msg.groupVote && typeof msg.groupVote === 'object') ? msg.groupVote : {};
            const msgId = String(msg.id || '').trim();
            /* ★ 人不在成员表里 ⇒ 照样带上（内核会把它归到 foreign 且**不计票**）——
             *   本件不在这里静默丢弃：丢掉一个「表外人」比显示出来更危险
             *   （改名 / 退群 / 上层给错 id 三种情形在界面上会变得无法分辨）。 */
            const who = String(gv.memberId || msg.senderName || msg.from || '').trim();
            const whoName = String(gv.memberName || msg.senderName || msg.from || '').trim();
            const memberId = String(gv.memberId || '').trim()
                || (who === 'me' ? meId : (byName.get(whoName) || byName.get(who) || whoName));
            const optionRaw = String(gv.optionId || gv.option || '').trim();
            const choice = String(gv.choice || '').trim().toLowerCase();
            const target = this._pollForStatement(gv, optionRaw, polls);
            if (!target) {
                unattributedStatements.push({
                    eventKey: msgId || (memberId + '|' + optionRaw + '|' + choice),
                    memberId: memberId,
                    option: optionRaw,
                    choice: choice,
                    why: polls.length ? 'poll-ambiguous' : 'no-poll'
                });
                continue;
            }
            const opt = target.options.filter((o) => o.id === optionRaw || o.label === optionRaw)[0];
            if (!memberId || !opt || GV_CHOICES.indexOf(choice) < 0) continue;
            target.statements.push({
                memberId: memberId,
                optionId: opt.id,
                choice: choice,
                /* ★ 事件键 = 消息 id：同一条消息重复出现不算两票（归一阶段丢）；
                 *   两条不同消息改主意 ⇒ 走内核第二层「只认最后一条」。 */
                eventKey: msgId || (memberId + '|' + opt.id + '|' + choice),
                /* ★ 楼层号走**唯一取数口**（`config/num-gate.js` 的 numOrNull），
                 *   不就地再写一份 `Number.isFinite(Number(...))` ——
                 *   那是第九道门的 W1 签名（弱口径），换了名字也还是弱口径。 */
                floor: numOrNull(msg.tavernMessageIndex),
                note: String(gv.note || '').trim()
            });
        }
        /* ── 已生成的活动：从消息里读回（确认过的活动会落成一条消息）。
         *   ★ 活动**按 pollId 归属**：带 `pollId` 的活动只进那一张票，
         *     免得「确认过 A 票」在 B 票的卡上显示成已确认。
         *   ★ 无 `pollId` 的活动只在**该群仅一张票**时归它 —— 多票时归任何一张
         *     都可能把 A 的确认史当成 B 的（活动 id 由「选项 + 参与名单」派生，
         *     两票同选项同参与人时**会撞**）。 */
        const unattributedActivities = [];
        for (const raw of msgs) {
            const msg = (raw && typeof raw === 'object') ? raw : null;
            if (!msg) continue;
            if (String(msg.type || '').trim() !== 'group_vote_activity') continue;
            const act = (msg.groupVoteActivity && typeof msg.groupVoteActivity === 'object') ? msg.groupVoteActivity : null;
            if (!act || !act.id) continue;
            const actPoll = String(act.pollId || '').trim();
            const owner = actPoll ? (byPoll.get(actPoll) || null) : (polls.length === 1 ? polls[0] : null);
            if (!owner) { unattributedActivities.push(act); continue; }
            owner.activities.push(act);
        }
        /* [v4.31.0 · R5-O3] 兼容面：不传 pollId 时 question/round/options/statements/activities
         *   取**第一张票**的形状 —— 既有调用点零改动；`polls` 逐票分列，
         *   要精确统计某一张票就传 pollId（或读 `polls`）。
         *   两张票混成一题的缺陷正是在这里被切断的：第一张票的 options 与
         *   statements 里**不再**出现第二张票的东西。 */
        const pick = want ? (byPoll.get(want) || null) : (polls.length ? polls[0] : null);
        return {
            question: pick ? pick.question : '',
            round: pick ? pick.round : 1,
            options: pick ? pick.options : [],
            members: memberRows,
            statements: pick ? pick.statements : [],
            activities: pick ? pick.activities : [],
            polls: polls,
            pollId: pick ? pick.pollId : '',
            pollFound: want ? !!pick : true,
            unattributedStatements: unattributedStatements,
            unattributedActivities: unattributedActivities
        };
    }
    /** 主读数（转手内核；读不到消息面时如实报 no-options，**不假装成「没人表态」**）。 */
    tally(chatId, opts) {
        const o = opts || {};
        const r = this.readings(chatId, o.pollId);
        if (!r) {
            return tallyVote({ round: 1, options: [], members: [], statements: [] });
        }
        try { return tallyVote(r, o); }
        catch (_e) { return tallyVote({ round: 1, options: [], members: [], statements: [] }); }
    }
    /** 五态计数（转手内核）。 */
    summary(chatId, pollId) {
        const r = this.readings(chatId, pollId);
        if (!r) return summarizeVote({ round: 1, options: [], members: [], statements: [] });
        try { return summarizeVote(r); }
        catch (_e) { return summarizeVote({ round: 1, options: [], members: [], statements: [] }); }
    }
    /**
     * 确认一份活动（**幂等**：同一份结果两次确认恒得同一个 id）。
     *   ★ `optionId` 缺省时用**用户已点选**的那个；两者都空 ⇒ 内核如实拒收
     *     （平票时本件**不替他挑**）。
     *   ★ [v4.31.0 · R5-O3] 传 `pollId` 时只在该票的读数上确认，并把 `pollId`
     *     写进产出的活动 —— 落成消息后下次读数才认得出「这是哪张票的活动」。
     * @returns {{ok,reason,activity,replayed,state,options,wrote}}
     */
    confirm(chatId, optionId, pollId) {
        const want = String(pollId == null ? '' : pollId).trim();
        const r = this.readings(chatId, want);
        const pick = String(optionId == null ? this._picked : optionId).trim();
        let res;
        if (!r) res = confirmActivity({ round: 1, options: [], members: [], statements: [] }, { optionId: pick });
        else {
            try { res = confirmActivity(r, { optionId: pick }); }
            catch (_e) { res = confirmActivity({ round: 1, options: [], members: [], statements: [] }, { optionId: pick }); }
        }
        if (want && res && res.activity) res.activity.pollId = want;
        return res;
    }
    /* ========== 两行读数（转手内核，视图不写第二套文案） ========== */
    voteLineOf(read) { try { return voteLine(read); } catch (_e) { return '投票:读数失败（已降级）'; } }
    activityLineOf(read) { try { return activityLine(read); } catch (_e) { return '活动:读数失败（已降级）'; } }
    /* ========== 这一面能不能读（判定词**只许内核一份**，本件只转发） ========== */
    gate(read) {
        try { return voteGateOf(read); }
        catch (_e) { return voteGateOf(null); }
    }
    /** 读数的一句说明（'' = 没有要说的） */
    note(read) {
        try { return voteNoteOf(read); }
        catch (_e) { return ''; }
    }
    /* ========== 起点（用户显式选择，不猜） ========== */
    get picked() { return this._picked; }
    /** 设为要点的那个选项；空值即清空（**不回落成「票最多的那个」**） */
    setPicked(optionId) {
        const s = String(optionId == null ? '' : optionId).trim();
        this._picked = s.slice(0, 120);
        return this._picked;
    }
    clearPicked() { this._picked = ''; return ''; }
    /* ========== 标签（界面文案的唯一出处 = 内核表） ========== */
    choiceIds() { return GV_CHOICES.slice(); }
    choiceLabel(c) { return GV_CHOICE_LABEL[c] || String(c == null ? '' : c); }
    /** 结果三态的 id 列表与标签（界面不写第二份三态表）。 */
    verdictIds() { return GV_VERDICTS.slice(); }
    verdictLabel(v) { return GV_VERDICT_LABEL[v] || String(v == null ? '' : v); }
    /** 四态 id 列表（界面不写第二份状态表）。 */
    stateIds() { return Object.values(GV_STATES).slice(); }
    optionKindIds() { return GV_OPTION_KINDS.slice(); }
    optionKindLabel(k) { return GV_KIND_LABEL[k] || String(k == null ? '' : k); }
    memberBucketIds() { return GV_MEMBER_BUCKETS.slice(); }
    memberBucketLabel(b) { return GV_MEMBER_LABEL[b] || String(b == null ? '' : b); }
    stateHint(s) { return GV_STATE_HINT[s] || ''; }
    /** 被拒时的一句话（'' = 没有要说的；视图不写第二份理由表） */
    reasonHint(r) { return GV_REASON_HINT[String(r || '')] || ''; }
    /** 中文标签 -> 表态 id（'' = 认不出；视图不写第二份映射） */
    choiceIdByLabel(t) { return GV_CHOICE_BY_LABEL[String(t == null ? '' : t).trim()] || ''; }
    /** 上限的唯一出处（视图不自己拟一个条数）。 */
    limits() { return GV_LIMITS; }
    /** 本件认识的消息类别（视图不写第二份类型字面量）。 */
    messageKinds() { return GV_MESSAGE_KINDS.slice(); }
    /* ========== 一次取齐（视图用；保证同一份读数上的多面同源） ========== */
    pack(chatId, opts) {
        const o = opts || {};
        const want = String(o.pollId == null ? '' : o.pollId).trim();
        const read = this.tally(chatId, o);
        const sum = this.summary(chatId, want);
        const conf = this.confirm(chatId, undefined, want);
        return {
            read: read,
            summary: sum,
            confirm: conf,
            lines: { vote: this.voteLineOf(read), activity: this.activityLineOf(conf) },
            gate: this.gate(read),
            note: this.note(read),
            picked: this._picked,
            state: read.state,
            pollId: want
        };
    }
    /** 换会话 / 清数据：只丢弃「上一次点了哪个选项」（读数本来就不缓存） */
    resetScene() { this._picked = ''; }
    /** 自检：转发内核十条口径真跑（本件不另立一份自检） */
    selfCheck() {
        try { return gvSelfCheck(); }
        catch (_e) { return { problems: ['selfcheck-threw'] }; }
    }
}
export default GroupVote;
