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
     * 取数：把该群的消息面读成契约件要的形状。
     *   ★ 读不到消息面 ⇒ 返回 null（**不退化成空数组**）：内核据此报「读不出」，
     *     与「真的没人投过票」不同形 —— 后者会让界面说「等大家表态」，而其实
     *     是消息压根没读出来。
     * @returns {{question,round,options,members,statements,activities}|null} 永不抛
     */
    readings(chatId) {
        const d = this._data();
        if (!d) return null;
        let msgs = null;
        try { msgs = d.getMessages(chatId); } catch (_e) { msgs = null; }
        if (!Array.isArray(msgs)) return null;
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
        const options = [];
        const statements = [];
        const activities = [];
        let question = '';
        let round = 1;
        for (const raw of msgs) {
            const msg = (raw && typeof raw === 'object') ? raw : null;
            if (!msg) continue;
            const type = String(msg.type || '').trim();
            if (type !== 'group_vote' && type !== 'group_vote_statement') continue;
            const gv = (msg.groupVote && typeof msg.groupVote === 'object') ? msg.groupVote : {};
            const msgId = String(msg.id || '').trim();
            if (type === 'group_vote') {
                const r = Math.max(1, Math.floor(Number(gv.round) || 1));
                round = Math.max(round, r);
                if (!question) question = String(gv.question || msg.content || '').trim();
                const list = Array.isArray(gv.options) ? gv.options : [];
                for (const it of list) {
                    const label = String((it && (it.label || it.text)) || it || '').trim();
                    if (!label) continue;
                    const id = String((it && it.id) || label).trim();
                    if (options.some((o) => o.id === id)) continue;
                    options.push({
                        id: id,
                        label: label,
                        kind: String((it && it.kind) || 'other').trim(),
                        round: Math.max(1, Math.floor(Number(it && it.round) || r))
                    });
                }
            } else {
                /* 表态消息：**谁**对**哪个选项**说了**什么**。
                 *   ★ 人不在成员表里 ⇒ 照样带上（内核会把它归到 foreign 且**不计票**）——
                 *     本件不在这里静默丢弃：丢掉一个「表外人」比显示出来更危险
                 *     （改名 / 退群 / 上层给错 id 三种情形在界面上会变得无法分辨）。 */
                const who = String(gv.memberId || msg.senderName || msg.from || '').trim();
                const whoName = String(gv.memberName || msg.senderName || msg.from || '').trim();
                const memberId = String(gv.memberId || '').trim()
                    || (who === 'me' ? meId : (byName.get(whoName) || byName.get(who) || whoName));
                const optionRaw = String(gv.optionId || gv.option || '').trim();
                const opt = options.filter((o) => o.id === optionRaw || o.label === optionRaw)[0];
                const choice = String(gv.choice || '').trim().toLowerCase();
                if (!memberId || !opt || GV_CHOICES.indexOf(choice) < 0) continue;
                statements.push({
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
        }
        /* 已生成的活动：从消息里读回（确认过的活动会落成一条消息）。 */
        for (const raw of msgs) {
            const msg = (raw && typeof raw === 'object') ? raw : null;
            if (!msg) continue;
            if (String(msg.type || '').trim() !== 'group_vote_activity') continue;
            const act = (msg.groupVoteActivity && typeof msg.groupVoteActivity === 'object') ? msg.groupVoteActivity : null;
            if (act && act.id) activities.push(act);
        }
        return {
            question: question,
            round: round,
            options: options,
            members: memberRows,
            statements: statements,
            activities: activities
        };
    }
    /** 主读数（转手内核；读不到消息面时如实报 no-options，**不假装成「没人表态」**）。 */
    tally(chatId, opts) {
        const r = this.readings(chatId);
        if (!r) {
            return tallyVote({ round: 1, options: [], members: [], statements: [] });
        }
        try { return tallyVote(r, opts || {}); }
        catch (_e) { return tallyVote({ round: 1, options: [], members: [], statements: [] }); }
    }
    /** 五态计数（转手内核）。 */
    summary(chatId) {
        const r = this.readings(chatId);
        if (!r) return summarizeVote({ round: 1, options: [], members: [], statements: [] });
        try { return summarizeVote(r); }
        catch (_e) { return summarizeVote({ round: 1, options: [], members: [], statements: [] }); }
    }
    /**
     * 确认一份活动（**幂等**：同一份结果两次确认恒得同一个 id）。
     *   ★ `optionId` 缺省时用**用户已点选**的那个；两者都空 ⇒ 内核如实拒收
     *     （平票时本件**不替他挑**）。
     * @returns {{ok,reason,activity,replayed,state,options,wrote}}
     */
    confirm(chatId, optionId) {
        const r = this.readings(chatId);
        const pick = String(optionId == null ? this._picked : optionId).trim();
        if (!r) return confirmActivity({ round: 1, options: [], members: [], statements: [] }, { optionId: pick });
        try { return confirmActivity(r, { optionId: pick }); }
        catch (_e) { return confirmActivity({ round: 1, options: [], members: [], statements: [] }, { optionId: pick }); }
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
        const read = this.tally(chatId, o);
        const sum = this.summary(chatId);
        const conf = this.confirm(chatId);
        return {
            read: read,
            summary: sum,
            confirm: conf,
            lines: { vote: this.voteLineOf(read), activity: this.activityLineOf(conf) },
            gate: this.gate(read),
            note: this.note(read),
            picked: this._picked,
            state: read.state
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
