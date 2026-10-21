/* ========================================================
 *  柚月小手机 (Yuzuki's Little Phone)
 *  日历 APP 控制器
 * ======================================================== */

import { CalendarData } from './calendar-data.js?v=20260527-calendar-polish';
import { CalendarView } from './calendar-view.js?v=20260527-calendar-polish';
import { applyPhoneTagFilter } from '../../config/tag-filter.js';
import { PHONE_EVENTS } from '../../config/phone-events.js';   // [v2.26.0] 事件名单一真源
import { LifeEventStore } from '../../config/life-events.js';
import {
    TERMINAL,
    normalizeCommitments,
    proposeCommitment,
    confirmCommitment,
    fulfillCommitment,
    cancelCommitment,
    rescheduleCommitment,
    commitmentCalendarProjection,
    summarizeCommitments
} from '../../config/commitment-flow.js';
/* [v3.58.0 · 计划 O4] 会话世代栅栏：日程生成是**在飞请求**（构建提示词要等世界书、
 *   AI 一轮再等一次），回信时可能已经换了会话。它写 `calendar_memos`（按会话隔离），
 *   旧回信落回来会把上一段会话的日程排进新会话的日历，并在新会话桌面弹「已添加 N 条日程」。 */
import { captureSessionToken, guardSessionWrite } from '../../config/session-gate.js';
/* [v4.41.0 · R5-X8] 周期日程、单次例外与多人空档（纯契约：只做读数与归一）。
 *   日历侧既有 `isRecurringType` **只认生日/纪念日** —— 本件补的是「每周/每月重复时段」
 *   与「只改这一次」的例外；并给多人空档一个「未知 ≠ 空闲」的判定口。 */
import {
  REC_EXCEPTION, REC_FREQ, REC_STATES, SLOT_STATES, REC_LIMITS,
  normalizeRule, expandOccurrences, applyExceptions, findCommonSlots,
  commonSlotLine, recurrenceSelfCheck
} from '../../config/recurrence-contract.js';
import { numOrNull } from '../../config/num-gate.js';
/* [v4.44.0 · R5-O2] 群投票 → 日历事项的**交接凭据**（纯契约：只做归一与读数）。
 *   修前：微信侧派发 `phone:groupVoteConfirm` 后弹「已转交日历确认」，而日历侧
 *   连监听器都没有（全仓接收者实测 0 个），那句提示是谎报。本件补的是
 *   「收到凭据 → 用户在表单补日期时段 → 提交后建事项」这条链上的归一与读数。 */
import {
    GV_HANDOFF_STATES,
    handoffLine,
    handoffStateLabel,
    handoffStateIds,
    handoffSelfCheck
} from '../../config/group-vote-handoff.js';
/* [v4.44.0 · R5-O2] 草稿与幂等台账**两键读写的唯一实现**（宿主与日历两侧都委派到这里，
 *   不各写一份「读 JSON / 判重 / 落盘」—— 两份必然漂移，漂移后果是
 *   「宿主说收到了、日历说没有」这种最难查的读数分歧）。 */
import {
    receiveHandoff,
    pendingHandoff,
    consumeHandoff,
    appliedKeys,
    isApplied,
    markApplied,
    voteHandoffStoreSelfCheck
} from './vote-handoff-store.js';
/* [第三期 R3-X3] 约会与日程的可玩执行流程(五步台面)。
 *   纯函数内核,读本层已有的约定账与剧情楼层;不新开第二个 owner。 */
import { buildDatePlaybook, advanceStep, datePlaybookLine, PLAY_STEPS, PLAY_STATES } from '../../config/date-playbook.js';

export class CalendarApp {
    constructor(phoneShell, storage) {
        this.phoneShell = phoneShell;
        this.storage = storage;
        this.calendarData = new CalendarData(storage);
        this.storageKey = 'calendar_commitments';
        this.calendarView = new CalendarView(this);
        this.isGeneratingSchedule = false;
        this._lastReminderStoryTime = null;

        // [v2.25.0] 监听器改实例字段持有：calendarApp 清数据时置 null 重建，
        //   匿名 add 会随每次重建累积（与 album 同型缺陷，同 weibo 范式）
        this._onSwipeBack = () => this.handleSwipeBack();
        window.addEventListener(PHONE_EVENTS.SWIPE_BACK, this._onSwipeBack);
    }

    /* ========== [v4.41.0 · R5-X8] 周期日程、单次例外与多人空档 ========== */
    /**
     * 展开一条日程的周期各期（**只读**：本层不算规则，转交纯契约件）。
     *   @param {object} memo 日程（含 `freq`/`rule`）
     *   @param {number} [count] 展开几期（默认 4：验收原文「四周安排」）
     */
    recurrenceFace(memo, count) {
        try { return expandOccurrences(memo, Number(count) > 0 ? Number(count) : 4); }
        catch (_e) { return expandOccurrences({ thrown: true }, 1); }
    }
    /** 把单次例外应用到展开结果上（**只动点名的那一期**）。 */
    recurrenceWithExceptions(memo, exceptions, count) {
        const face = this.recurrenceFace(memo, count);
        try { return applyExceptions(face, exceptions); }
        catch (_e) { return applyExceptions(face, []); }
    }
    /**
     * 一条日程是不是**周期**日程（视图据此决定要不要画「例外」那一排）。
     *   ★ 与既有 `isRecurringType`（只认生日/纪念日）**不是同一件事**：
     *   那一件判「按年重复的纪念日」，本件判「每周/每月的固定时段」——
     *   两者并存，视图按需取用（本层不改既有那一件的口径）。
     */
    isWeeklyMonthly(memo) {
        try {
            const f = this.recurrenceFace(memo, 1);
            return f.state === REC_STATES.RECURRING;
        } catch (_e) { return false; }
    }
    /**
     * 多人共同空档（**只读**）。
     *   逐人的忙时表由调用方给（本层不推算谁忙）；`unread` 的人**不算空闲**。
     */
    commonSlots(slots, busyByMember) {
        try { return findCommonSlots(slots, busyByMember); }
        catch (_e) {
            return { state: REC_STATES.UNREADABLE, slots: [], free: [], busy: [], unknown: [], line: '共同空档：读不到' };
        }
    }
    /** 周期契约件自检的**真消费点**（方法名与 import 不同名，防同类遮蔽）。 */
    recurrenceContractSelfCheck() {
        try { return recurrenceSelfCheck(); }
        catch (_e) { return { problems: ['自检抛了:' + String((_e && _e.message) || _e)], exceptionActions: 0, slotStates: 0 }; }
    }

    /* ========== [v4.44.0 · R5-O2] 群投票 → 日历事项的**交接口** ==========
     * 【修前实测处境】微信侧确认投票后派发 `phone:groupVoteConfirm` 并弹「已转交日历确认」，
     *   而全仓对 `GROUP_VOTE_CONFIRM` 的接收者实测为 **0 个** —— 日历侧连监听器都没有，
     *   更没有把「哪一份活动、谁参加」变成一条日程的入口。那句提示是**谎报**。
     *
     * 【本区做四件事，**都不含「替用户决定日期」**】
     *   ① `receiveVoteHandoff` —— 收下凭据、归一、落**草稿**（不建事项）。
     *      草稿就是「待你补日期与时段」那一步的载体：这一步之后日历上**还没有**任何日程。
     *   ② `pendingVoteHandoff` / `consumeVoteHandoff` —— 表单打开时取用草稿（后者取完即清）。
     *   ③ `commitVoteHandoff` —— **用户显式提交**后，建日程 + 建约定 + 记幂等台账。
     *   ④ `voteAppliedKeys` / `markVoteApplied` —— 幂等台账：同一 `activityId` 第二次转交
     *      **不重复建**，如实报 `replayed`（重复转交不双建）。
     *
     * 【为什么草稿与台账都要落盘】重复转交的判定必须跨「关掉表单再点一次确认」成立；
     *   只留内存的话，用户重开一次手机就又能建出第二条 —— 那正是本项要治的「双建」。
     *   两键都命中 `^calendar_`（随会话隔离），换角色不会带着上一个角色的待办。 */

    /** 收下一份群投票凭据（**只落草稿，不建事项**）。永不抛。 */
    receiveVoteHandoff(detail) {
        try { return receiveHandoff(this.storage, detail); }
        catch (_e) {
            const read = { ok: false, state: GV_HANDOFF_STATES.FAILED, why: 'store-threw', handoff: null, line: '' };
            read.line = handoffLine(read);
            return read;
        }
    }

    /** 读草稿（**不消费**；视图渲染表单时用）。读不到 ⇒ null（不猜一份出来）。 */
    pendingVoteHandoff() {
        try { return pendingHandoff(this.storage); } catch (_e) { return null; }
    }

    /** 取用草稿（取完即清：一次转交只喂一次表单，不让它反复预填）。 */
    consumeVoteHandoff() {
        try { return consumeHandoff(this.storage); } catch (_e) { return null; }
    }

    /** 幂等台账（活动 id 列表；上限走契约件唯一出处）。 */
    voteAppliedKeys() {
        try { return appliedKeys(this.storage); } catch (_e) { return []; }
    }

    /** 这一份活动建过事项没有（'' ⇒ false）。 */
    isVoteApplied(activityKey) {
        try { return isApplied(this.storage, activityKey); } catch (_e) { return false; }
    }

    /** 记一次「这份活动已建过事项」（超上限丢最旧，不静默截断新记录）。 */
    markVoteApplied(activityKey) {
        try { return markApplied(this.storage, activityKey); } catch (_e) { return false; }
    }

    /**
     * **用户显式提交**：把这份活动落成日历事项（+ 约定）。
     *   ★ `input.dateKey` 必须由用户给（表单上的那一天）；本层**不替它猜日期**：
     *     没有合法日期就如实拒收 —— 猜一个「今天」会在日历上留一条用户没定的日程。
     *   ★ 幂等：同一活动第二次提交恒报 `replayed`，不重复建（台账前置判定）。
     * @returns {{ok,state,why,line,memo,commitment,title}}
     */
    commitVoteHandoff(input = {}) {
        const explicit = (input.handoff && typeof input.handoff === 'object') ? input.handoff : null;
        /* 凭据从哪来：调用方显式给 → 表单待落笔的那份 → 本次会话**最后经手**的那份。
         *   ★ 第三个来源是为「同一场投票第二次提交」准备的：第一次建成后草稿就清了
         *     （清草稿 = 这次转交的使命已完成），第二次提交时表单可能已经不带凭据 ——
         *     但「同一场投票只该建一次」这条口径不因此失效（见下方台账前置判定）。 */
        const h = explicit || this.pendingVoteHandoff() || this._lastVoteHandoff || null;
        if (!h || !h.ok || !h.activityKey) {
            const read = { ok: false, state: GV_HANDOFF_STATES.FAILED, why: 'handoff-no-activity', line: '' };
            read.line = handoffLine(read);
            return read;
        }
        /* ★ [v4.44.0 · R5-O2 收尾] 台账判定必须**早于**日期判定：建过就是建过，
         *   此时用户填的是哪一天已经无关紧要（不会建第二条），报 `invalid-date` 只会误导。 */
        if (this.isVoteApplied(h.activityKey)) {
            const read = { ok: false, state: GV_HANDOFF_STATES.REPLAYED, why: '', handoff: h, line: '' };
            read.line = handoffLine(read);
            return read;
        }
        this._lastVoteHandoff = h;
        const dateKey = String(input.dateKey || '').trim();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
            const read = { ok: false, state: GV_HANDOFF_STATES.FAILED, why: 'invalid-date', handoff: h, line: '' };
            read.line = '交不过去：日期要年-月-日（本层不替你猜哪一天）';
            return read;
        }
        const title = String(input.title || h.title || '').trim().slice(0, 160);
        if (!title) {
            const read = { ok: false, state: GV_HANDOFF_STATES.FAILED, why: 'no-title', handoff: h, line: '' };
            read.line = '交不过去：这一条没有名字（不知道要建什么）';
            return read;
        }
        const time = String(input.time || '').trim().slice(0, 16);
        const place = String(input.place || h.place || '').trim().slice(0, 80);
        const type = String(input.type || 'event').trim();
        let memo = null;
        try {
            memo = this.calendarData.addMemo({ dateKey: dateKey, title: title, time: time, type: type, source: 'group_vote' });
        } catch (_e) { memo = null; }
        if (!memo) {
            const read = { ok: false, state: GV_HANDOFF_STATES.FAILED, why: 'memo-failed', handoff: h, line: '' };
            read.line = '交不过去：日程没写进日历（不是「已经建好了」）';
            return read;
        }
        /* 约定（可选）：`with` 取参与名单里第一位**非自己**的人名；名单空则不建约定。
         *   ★ 约定写入仍走既有 `proposeCommitment` → `confirmCommitment` 链，
         *     本层不另写一份「约定」实现。 */
        let commitment = null;
        /* 有没有**该写约定**的对象：名单里除了自己还有别人 ⇒ 这份约定本该写进记忆。
         *   一个都没有（只有自己 / 名单为空）⇒ 约定这一环**不适用**，
         *   读数尾巴按 `null` 处理（不把「不适用」说成「记忆未登记」）。 */
        let hasCounterpart = false;
        try {
            const ctx0 = this._getContext?.() || {};
            const me0 = String(ctx0.name1 || '玩家');
            hasCounterpart = (h.participants || []).some((n) => String(n) !== me0);
        } catch (_e) { hasCounterpart = false; }
        try {
            const ctx = this._getContext?.() || {};
            const meName = String(ctx.name1 || '玩家');
            const other = (h.participants || []).filter((n) => String(n) !== meName)[0] || '';
            const proposed = this.proposeCommitmentFromMemo({
                actor: String(ctx.name2 || '角色'),
                with: other,
                content: title,
                dateKey: dateKey,
                time: time,
                place: place,
                eventKey: 'vote:' + h.activityKey
            });
            if (proposed?.ok && proposed.item) {
                const confirmed = this.confirmCommitmentById(proposed.item.id, 'vote-confirm:' + h.activityKey);
                commitment = (confirmed?.item) || proposed.item;
            }
        } catch (_e) { commitment = null; }
        this.markVoteApplied(h.activityKey);
        /* ★ 建成了才清草稿：这份转交的使命已完成（不清的话，下次打开表单会又预填一份
         *   已经建过的活动，用户再提交就撞台账的 replayed —— 白挨一次「不重复建」）。
         *   失败路径**不清**：凭据要留给用户改完再提交。 */
        try { this.consumeVoteHandoff(); } catch (_e) { /* 清不掉不影响「事项已建」的读数 */ }
        try { this.syncCommitmentsToCalendar(); } catch (_e) { /* 投影失败不影响「事项已建」的读数 */ }
        /* [v4.44.0 · R5-O2 验收] 「缺插件可只存日历并提示未登记记忆」：
         *   该有约定对象、却没能建出约定（记忆侧没登记 / 拒绝 / 抛错）⇒ `memoryRegistered = false`，
         *   读数如实补一句；**日历这条照样成立**（`ok: true` 不改）。
         *   不需要约定对象时给 `null`（不适用，不是「未登记」）。 */
        const memoryRegistered = hasCounterpart ? !!commitment : null;
        const read = {
            ok: true, state: GV_HANDOFF_STATES.CREATED, why: '',
            handoff: h, memo: memo, commitment: commitment, title: title,
            memoryRegistered: memoryRegistered
        };
        read.line = handoffLine(read);
        return read;
    }

    /** 交接契约件自检的**真消费点**（方法名与 import 不同名，防同类遮蔽）。 */
    voteHandoffSelfCheck() {
        const problems = [];
        let states = 0;
        let reasons = 0;
        try {
            const a = handoffSelfCheck();
            if (Array.isArray(a.problems)) problems.push(...a.problems);
            states = Number(a.states) || 0;
            reasons = Number(a.reasons) || 0;
        } catch (_e) { problems.push('契约件自检抛了:' + String((_e && _e.message) || _e)); }
        let keys = 0;
        try {
            const b = voteHandoffStoreSelfCheck();
            if (Array.isArray(b.problems)) problems.push(...b.problems);
            keys = Number(b.keys) || 0;
        } catch (_e) { problems.push('两键读写自检抛了:' + String((_e && _e.message) || _e)); }
        return { problems: problems, states: states, reasons: reasons, keys: keys };
    }

    /** 交接四态的中文标签（'' = 认不出；视图不写第二份映射）。 */
    voteHandoffStateLabel(state) {
        try { return handoffStateLabel(state); }
        catch (_e) { return ''; }
    }

    /** 交接四态的 id 列表（视图不写第二份状态表）。 */
    voteHandoffStateIds() {
        try { return handoffStateIds(); }
        catch (_e) { return []; }
    }

    render() {
        if (!this.phoneShell?.setContent) {
            console.warn('[Calendar] phoneShell 未就绪，跳过渲染');
            return;
        }
        this.cleanupExpiredAutoMemos();
        this.syncCommitmentsToCalendar();
        this.calendarView.render({ syncStoryDate: true });
    }

    attachPhoneShell(phoneShell) {
        if (!phoneShell) return;
        this.phoneShell = phoneShell;
        if (this.calendarView) this.calendarView.app = this;
    }

    handleSwipeBack() {
        const domCurrentView = document.querySelector('.phone-view-current');
        if (!domCurrentView?.querySelector?.('.yzp-calendar-app')) return;

        const isSettingsView = this.calendarView?.currentView === 'settings'
            || domCurrentView?.dataset?.viewId === 'calendar-settings'
            || !!domCurrentView?.querySelector?.('.yzp-calendar-settings-header');
        if (isSettingsView) {
            this.calendarView.currentView = 'main';
            this.calendarView.addPanelOpen = false;
            this.calendarView.monthPickerOpen = false;
            this.calendarView.typePickerOpen = false;
            this.calendarView.render();
            this.blockGhostClick();
            return;
        }
        window.dispatchEvent(new CustomEvent('phone:goHome'));
    }

    blockGhostClick() {
        const phoneScreen = document.querySelector('.phone-screen');
        if (!phoneScreen) return;
        phoneScreen.style.pointerEvents = 'none';
        setTimeout(() => {
            phoneScreen.style.pointerEvents = '';
        }, 400);
    }

    clearCache() {
        // [v2.90.0] _lifeEvents 共享自 calendarData（见 recordCommitmentLifeEvent），
        //   calendarData.clearCache() 已一并清它，不再自持第二个实例。
        this.calendarData.clearCache();
        this._commitments = null;
        this._lastReminderStoryTime = null;
    }
    loadCommitments() {
        if (!this._commitments) {
            let parsed = null;
            try {
                const saved = this.storage?.get?.(this.storageKey, null);
                parsed = typeof saved === 'string' ? JSON.parse(saved || 'null') : saved;
            } catch (error) {
                console.warn('[Calendar] 约定读取失败:', error);
            }
            this._commitments = normalizeCommitments(parsed);
        }
        return this._commitments;
    }
    saveCommitments(state) {
        this._commitments = state || { version: 1, items: [] };
        this.storage?.set?.(this.storageKey, JSON.stringify(this._commitments));
        return this._commitments;
    }
    syncCommitmentsToCalendar() {
        const projection = commitmentCalendarProjection(this.loadCommitments());
        return this.calendarData.syncCommitmentProjection(projection);
    }

    /**
     * 取当前剧情楼层(**回档判定用**;读不到返 null,不猜 0楼)。
     * [第三期 R3-X3] 本层只读**剧情时间**面,不读现实时间:
     *   用现实时间判回档,会把「玩家回到旧楼层」误读成「约会已经过时」。 */
    currentStoryFloor() {
        try {
            const vp = (typeof window !== 'undefined' && window.VirtualPhone) ? window.VirtualPhone : null;
            const sc = vp && vp._storyClock ? vp._storyClock : null;
            const f = sc ? sc.floor : null;
            /* 取数走仓内唯一实现(不要就地再写一份弱口径)。 */
            return numOrNull(f);
        } catch (_e) { return null; }
    }

    /**
     * 一条约定的五步台面(prepare → depart → arrive → interact → wrapUp)。
     * [第三期 R3-X3] 本层只做「读与搬」:约定从本层账取、步骤读数从跳转记录取(没有就是没有,不拟一个),楼层从剧情时钟取(读不到传 null)。
     * 永不抛;内核异常时如实回报而不假装「没这条约定」。
     */
    commitmentPlaybook(commitmentId) {
        try {
            const want = String(commitmentId || '').trim();
            if (!want) return { ok: false, reason: 'no-commitment', steps: [], line: '约会流程:无读数' };
            const items = (this.loadCommitments() || {}).items || [];
            const c = items.find((x) => String(x && x.id) === want) || null;
            if (!c) return { ok: false, reason: 'no-commitment', steps: [], line: '约会流程:无读数' };
            const marks = {};
            for (const k of PLAY_STEPS) {
                const raw = (c.steps && typeof c.steps === 'object') ? c.steps[k] : null;
                marks[k] = (raw && typeof raw === 'object')
                    ? { floor: raw.floor, eventKey: raw.eventKey, confirmed: raw.confirmed === true }
                    : null;
            }
            const r = buildDatePlaybook({ commitment: c, marks: marks, currentFloor: this.currentStoryFloor() }, {});
            r.line = datePlaybookLine(r);
            return r;
        } catch (_e) {
            return { ok: false, reason: 'no-commitment', steps: [], line: '约会流程:读数时抛了' };
        }
    }

    /**
     * 推进一步(校验准入,但**不代替正文或用户**做那一步)。
     * 到场步骤必须带人证(eventKey 或 userConfirmed)。
     * @returns {{ok, step, reason, state, needsWrite?}} 永不抛
     */
    advanceCommitmentStep(commitmentId, stepKey, evidence = {}) {
        try {
            const want = String(commitmentId || '').trim();
            if (!want) return { ok: false, step: String(stepKey || ''), reason: 'no-commitment', state: null };
            const items = (this.loadCommitments() || {}).items || [];
            const c = items.find((x) => String(x && x.id) === want) || null;
            if (!c) return { ok: false, step: String(stepKey || ''), reason: 'no-commitment', state: null };
            const marks = {};
            for (const k of PLAY_STEPS) {
                const raw = (c.steps && typeof c.steps === 'object') ? c.steps[k] : null;
                marks[k] = (raw && typeof raw === 'object')
                    ? { floor: raw.floor, eventKey: raw.eventKey, confirmed: raw.confirmed === true }
                    : null;
            }
            return advanceStep({ commitment: c, marks: marks, currentFloor: this.currentStoryFloor() },
                String(stepKey || ''), evidence || {});
        } catch (_e) {
            return { ok: false, step: String(stepKey || ''), reason: 'no-commitment', state: null };
        }
    }
    applyCommitmentResult(result, successText) {
        if (!result?.ok) {
            this.phoneShell?.showNotification?.('日历', result?.reason === 'invalid-date' ? '日期需要年-月-日' : '约定缺少人物、内容或合法日期', '📅');
            return result;
        }
        if (result.changed) {
            this.saveCommitments(result.state);
            this.syncCommitmentsToCalendar();
            // [v2.93.0] 不再「每步新增一条」：同一条约定在时间线上始终只占 1 条，
            //   推进状态写入的是改写，终态写入的是回收。
            this.refreshCommitmentLifeEvent(result.item);
            if (successText) this.phoneShell?.showNotification?.('日历', successText, '📅');
        }
        return result;
    }
    proposeCommitmentFromMemo(input = {}) {
        const now = Date.now();
        return this.applyCommitmentResult(proposeCommitment(this.loadCommitments(), {
            ...input,
            eventKey: input.eventKey || `propose:${input.actor || ''}:${input.content || ''}:${input.dateKey || ''}:${now}`
        }), '已记下待确认约定');
    }
    confirmCommitmentById(id, eventKey = '') {
        return this.applyCommitmentResult(confirmCommitment(this.loadCommitments(), {
            id, eventKey: eventKey || `confirm:${id}:${Date.now()}`
        }), '约定已确认，已写入日历');
    }
    rescheduleCommitmentById(id, input = {}) {
        return this.applyCommitmentResult(rescheduleCommitment(this.loadCommitments(), {
            id,
            dateKey: input.dateKey,
            time: input.time,
            place: input.place,
            reason: input.reason || '改期',
            eventKey: input.eventKey || `reschedule:${id}:${input.dateKey || ''}:${Date.now()}`
        }), '约定已改期');
    }
    fulfillCommitmentById(id, eventKey = '') {
        const r = this.applyCommitmentResult(fulfillCommitment(this.loadCommitments(), {
            id, eventKey: eventKey || `fulfill:${id}:${Date.now()}`
        }), '约定已完成');
        /* [v3.97.0 · R3-X1] 履约完成后**同步告诉记忆侧**（上游事实桥回执）：
         *   日历自己记「已履约」≠ 记忆侧把这条当既成事实 —— 两者是两件事。
         *   取数走宿主唯一出口（任意 App 未打开也能取），本控制器不算四态。
         *   只送「已发生的一次履约」；撤回由上游回执按 `revoked` 语义处理。 */
        try {
            const rc = window.VirtualPhone?.phoneFactReceiptFor?.('calendar', {
                eventId: 'commitment:' + String(id || '') + ':' + String(eventKey || ''),
                summary: String((r && r.item && r.item.content) || '')
            });
            if (rc && rc.receipt) this.lastFactReceipt = rc.receipt;
        } catch (_e) { /* 回执是**增强**，绝不因它抛错把已完成的履约显示成失败 */ }
        return r;
    }
    cancelCommitmentById(id, reason = '取消', eventKey = '') {
        return this.applyCommitmentResult(cancelCommitment(this.loadCommitments(), {
            id, reason, eventKey: eventKey || `cancel:${id}:${Date.now()}`
        }), '约定已取消');
    }
    commitmentSummary() {
        return summarizeCommitments(this.loadCommitments());
    }
    /* [v2.90.0] 生活事件 store 共享自 calendarData（真源是 life_events_v1，不自持第二实例）。
     *   [v2.93.0] 收口成单一取用出口：三处懒建会让「共享」这件事有三个可漂移的副本，
     *   也让 v290 的负控制失去唯锚点。 */
    _commitmentLifeEventStore() {
        if (!this.calendarData._lifeEvents) this.calendarData._lifeEvents = new LifeEventStore(this.storage);
        const store = this.calendarData._lifeEvents;
        return store;
    }
    /* [v2.93.0] 一条约定的时间线身份：`commitment:<id>`。
     *   注意**不含**状态与 revision —— 那是历史身份，用它当源键会让同一条约定
     *   每推进一次状态就在时间线上多留下一条（proposed/confirmed/confirmed/rescheduled/
     *   fulfilled 全部并存，且没有任何一条会被回收）。 */
    commitmentLifeEventSourceId(id) {
        const sid = String(id || '').trim();
        return sid ? 'commitment:' + sid : null;
    }
    /* [v2.93.0] 把一条约定的时间线条目对齐到当前状态：
     *   · 正文/日历字段改了 → updateBySource 就地改写（时间线显示改后的读数）
     *   · 终态（fulfilled / cancelled）或不再进日历 → 整族撤掉
     *     （源头已不存在，时间线不得留幽灵事件） */
    refreshCommitmentLifeEvent(item) {
        const sid = this.commitmentLifeEventSourceId(item?.id);
        if (!sid) return 0;
        const store = this._commitmentLifeEventStore();
        if (!item?.content || TERMINAL.has(item.status)) {
            const n = store.removeBySourceBase(sid);
            return n ? -n : 0;
        }
        const verb = { proposed: '记下约定', confirmed: '确认约定', rescheduled: '改期约定' }[item.status] || '更新约定';
        const who = item.with ? item.actor + '与' + item.with : item.actor;
        return store.updateBySource(sid, {
            type: 'calendar',
            app: 'calendar',
            title: verb,
            summary: who + '：' + item.content + (item.dateKey ? '（' + item.dateKey + '）' : ''),
            importance: 3
        });
    }
    /* [v2.93.0] 源已消失时整族撤掉（与 refreshCommitmentLifeEvent 的终态分支同一出口）。 */
    forgetCommitmentLifeEvent(id) {
        const sid = this.commitmentLifeEventSourceId(id);
        if (!sid) return 0;
        return this._commitmentLifeEventStore().removeBySourceBase(sid);
    }
    recordCommitmentLifeEvent(item) {
        if (!item?.id || !item.content) return null;
        // [v2.90.0] 与 CalendarData 共享同一个 LifeEventStore 实例：
        //   此前本类自持 this._lifeEvents（第二个 store），备忘走 calendarData._lifeEvents，
        //   交错写入时后写者的旧内存快照覆盖前者（lost update，约定事件被备忘覆盖丢失）。
        const store = this._commitmentLifeEventStore();
        const verb = { proposed: '记下约定', confirmed: '确认约定', rescheduled: '改期约定', fulfilled: '完成约定', cancelled: '取消约定' }[item.status] || '更新约定';
        const who = item.with ? item.actor + '与' + item.with : item.actor;
        return store.add({
            type: 'calendar',
            app: 'calendar',
            title: verb,
            summary: who + '：' + item.content + (item.dateKey ? '（' + item.dateKey + '）' : ''),
            importance: item.status === 'fulfilled' || item.status === 'cancelled' ? 4 : 3,
            // [v2.93.0] 源键 = commitment:<id>（不含状态/revision）：
            //   每推进一次状态都换键 = 时间线上每步各留一条，且终态也不会被回收。
            sourceId: this.commitmentLifeEventSourceId(item.id)
        });
    }
    // [v2.25.0] 实例销毁：解绑构造期注册的全局监听器（置 null 重建前调用）
    destroy() {
        window.removeEventListener(PHONE_EVENTS.SWIPE_BACK, this._onSwipeBack);
    }

    /**
     * [v3.10.0 · G-4] 日历这一层的「当前剧情时刻」只读出口（供跨 App 时间编排面调用）。
     *
     * 为什么是**只读探针**而不是让 `config/story-clock.js` 自己 import 日历：
     *   ① 本仓纪律「同一口径只许一份实现」—— 剧情日期的取数口是 `timeManager.getCurrentStoryTime()`，
     *      由日历 App 自己持有一份调用；时间编排层只消费**归一后的形状**，不重取一次。
     *   ② 日历是会话级数据，取数路径随宿主变化；把这条路放在 App 里，跨 App 面就不必知道它。
     *
     * 三条纪律：不写任何状态 / 不抛（取不到返回 null）/ **不猜**（拿不到就 null，
     * 绝不用 `Date.now()` 顶替剧情日期 —— 现实时间与剧情时间不是同一件事）。
     *
     * @returns {{date:string, label:string, source:string}|null}
     */
    currentStoryDate() {
        try {
            const tm = window.VirtualPhone?.timeManager;
            const cur = tm?.getCurrentStoryTime?.();
            const date = String((cur && cur.date) || '').trim();
            if (!date) return null;
            const time = String((cur && cur.time) || '').trim();
            return { date, label: time ? date + ' ' + time : date, source: 'calendar' };
        } catch (_e) { return null; }
    }

    checkScheduleReminders(currentTime = null, options = {}) {
        if (!this.calendarData.isReminderEnabled()) return null;
        const tm = window.VirtualPhone?.timeManager;
        const current = currentTime || tm?.getCurrentStoryTime?.();
        const previous = options.previousTime || this._lastReminderStoryTime;
        if (!current?.date || !current?.time) return null;
        if (!previous) {
            this._lastReminderStoryTime = { ...current };
            return null;
        }

        const due = this.calendarData.getReminderDueMemo(previous, current);
        this._lastReminderStoryTime = { ...current };
        if (due?.skipped) return null;
        if (!due?.memo) return null;

        this.calendarData.markMemoReminderFired(due.memo.id, due.dateKey);
        this.calendarData.clearExpiredAutoMemos(due.dateKey);
        const title = this._compactReminderTitle(due.title);
        const message = `${due.time} ${title}`;
        const notify = window.VirtualPhone?.notify || this.phoneShell?.showNotification?.bind(this.phoneShell);
        notify?.('线上日程提示', message, '📅', {
            senderKey: `calendar-reminder:${due.dateKey}:${due.memo.id}:${due.time}`,
            name: '线上日程提示',
            content: message,
            timeText: due.time,
            avatarText: '历',
            avatarBg: '#6b9abd',
            avatarColor: '#fff'
        });
        return due;
    }

    _compactReminderTitle(title) {
        const text = String(title || '日程').replace(/\s+/g, '').trim();
        return text.length > 12 ? `${text.slice(0, 12)}...` : text;
    }

    async generateScheduleMemos(options = {}) {
        if (this.isGeneratingSchedule) return;

        const silent = options.silent === true || !this.phoneShell?.setContent;
        const apiManager = window.VirtualPhone?.apiManager;
        if (!apiManager?.callAI) {
            if (!silent) this.phoneShell?.showNotification?.('日历', 'API Manager 未初始化', '📅');
            return;
        }

        this.isGeneratingSchedule = true;
        if (!silent) this.calendarView.render();
        /* [v3.58.0 · 计划 O4] 令牌在**发起请求之前**记（构建提示词本身还要等世界书异步注入）。 */
        const sessionToken = captureSessionToken(this.storage);
        try {
            const messages = await this._buildScheduleAiMessages();
            if (!messages.length) throw new Error('没有可用的剧情上下文');

            const result = await apiManager.callAI(messages, {
                appId: 'calendar',
                temperature: 0.45,
                max_tokens: 1800,
                min_max_tokens: 1200
            });

            if (!result?.success) {
                throw new Error(result?.error || '日程生成失败');
            }

            const rawText = String(result.summary || result.content || result.text || '').trim();
            const cleanedText = applyPhoneTagFilter(rawText, { storage: this.storage }) || rawText;
            const schedules = this.parseScheduleResponse(cleanedText);
            if (!schedules.length) {
                throw new Error('没有解析到有效日程');
            }
            /* [v3.58.0 · 计划 O4] 写回前的会话栅栏。这是本函数**唯一**的落盘入口
             *   （下面 `addMemo` 会连带 `saveMemos`），所以栅栏放在写之前、解析之后：
             *   解析失败那条路（上面 throw）与它无关，不该为一次跨会话多记一笔拒绝。
             *   不当前即静默收摊：不写日程、不弹「已添加 N 条日程」、不改视图选中日。
             *   注意 `silent` 是调用方口径（自动补全走 true），与是否跨会话无关 ——
             *   两条路径都要挡，故栅栏放在 `silent` 分支之外。 */
            if (!guardSessionWrite(this.storage, sessionToken, 'calendar-schedule')) {
                return { createdCount: 0, droppedBySessionChange: true };
            }
            const created = [];
            schedules.forEach(item => {
                const memo = this.calendarData.addMemo({
                    dateKey: item.dateKey,
                    title: item.title,
                    time: item.time,
                    type: item.type,
                    source: 'auto_schedule'
                });
                if (memo) created.push({ memo, dateParts: item.dateParts });
            });

            if (!created.length) throw new Error('没有写入有效日程');

            if (!silent) {
                const first = created[0].dateParts;
                this.calendarView.selectedDate = first;
                this.calendarView.visibleYear = first.year;
                this.calendarView.visibleMonth = first.month;
                this.calendarView.currentView = 'main';
                this.calendarView.addPanelOpen = false;
                this.calendarView.typePickerOpen = false;
                this.calendarView.draftMemoTitle = '';
                this.calendarView.draftMemoTime = '';
                this.calendarView.selectedMemoType = 'daily';
            }

            this.phoneShell?.showNotification?.('日历', `已添加 ${created.length} 条日程`, '📅');
            return { createdCount: created.length };
        } catch (error) {
            console.warn('[Calendar] AI 日程生成失败:', error);
            if (!silent) this.phoneShell?.showNotification?.('日历', error?.message || '日程生成失败', '📅');
            if (silent) throw error;
        } finally {
            this.isGeneratingSchedule = false;
            if (!silent) this.calendarView.render();
        }
    }

    async _buildScheduleAiMessages() {
        const context = this._getContext();
        const userName = context?.name1 || '用户';
        const charName = context?.name2 || '角色';
        const storyDate = this.calendarView.getStoryDateParts();
        const storyTime = this.calendarView.getStoryTimeLabel();
        const typeLabels = this.calendarView.getMemoTypes().map(item => item.label).join('、');
        const existingSchedules = this._buildExistingSchedulesText(storyDate);
        const systemPrompt = this._buildScheduleSystemPrompt({
            userName,
            charName,
            storyDate,
            storyTime,
            typeLabels,
            existingSchedules
        });
        if (!systemPrompt) throw new Error('日历规划提示词为空，请先在日历设置中恢复默认提示词');
        const messages = [{
            role: 'system',
            content: systemPrompt,
            isPhoneMessage: true
        }];

        const characterMessage = this._buildCharacterMessage(context, charName);
        if (characterMessage) messages.push(characterMessage);

        const personaMessage = this._buildPersonaMessage(context, userName);
        if (personaMessage) messages.push(personaMessage);

        await window.VirtualPhone?.worldbookManager?.appendWorldbookMessages?.(messages, 'calendar');

        const recentMessages = this._collectRecentChatMessages(context, 30);
        if (recentMessages.length) messages.push(...recentMessages);

        messages.push({
            role: 'user',
            content: [
                `当前剧情时间：${storyTime}`,
                `已有日历日程：${existingSchedules}`,
                `请为${userName}规划当天及未来几天时间内的日历安排；若剧情或设定中存在更远但明确到期的还款、赴约、生日、纪念日或特殊事件，也可以加入。`,
                '不要重复生成已有日历日程中的任何事项。',
                '请严格遵守系统提示词中的日程类型、数量、时间和输出格式要求。'
            ].join('\n'),
            isPhoneMessage: true
        });

        return messages;
    }

    _buildScheduleSystemPrompt({ userName, charName, storyDate, storyTime, typeLabels, existingSchedules }) {
        const promptManager = window.VirtualPhone?.promptManager;
        if (promptManager && !promptManager._loaded) {
            promptManager.ensureLoaded();
        }

        let prompt = promptManager?.getPromptForFeature?.('calendar', 'schedule')
            || promptManager?.getDefaultPrompts?.()?.calendar?.schedule?.content
            || '';

        const dateExample = `${storyDate.year}年${storyDate.month}月${storyDate.day}日`;
        const replacements = {
            user: userName || '用户',
            char: charName || '角色',
            storyTime: storyTime || '',
            types: typeLabels || '',
            dateExample,
            existingSchedules: existingSchedules || '暂无'
        };

        Object.entries(replacements).forEach(([key, value]) => {
            prompt = prompt.replace(new RegExp(`\\{\\{\\s*${key}\\s*\\}\\}`, 'g'), String(value));
        });

        return String(prompt || '').trim();
    }

    _buildExistingSchedulesText(storyDate) {
        const currentKey = this.calendarView.toDateKey(storyDate);
        const currentParts = this.calendarData.parseDateKey(currentKey);
        if (!currentParts) return '暂无';
        const currentSerial = this.calendarData.dateSerial(currentParts);
        const typeMap = new Map(this.calendarView.getMemoTypes().map(item => [item.id, item.label]));
        const memoRows = this.calendarData.getMemos()
            .map(memo => {
                const memoParts = this.calendarData.parseDateKey(memo?.dateKey);
                if (!memoParts) return null;
                const memoSerial = this.calendarData.dateSerial(memoParts);
                if (!this.calendarData.isRecurringMemo(memo) && memoSerial < currentSerial) return null;
                const type = this.calendarData.normalizeType(memo?.type);
                const typeLabel = typeMap.get(type) || '日常';
                const dateText = `${memoParts.year}年${String(memoParts.month).padStart(2, '0')}月${String(memoParts.day).padStart(2, '0')}日`;
                const timeText = String(memo?.time || '').trim() || '未定时间';
                const title = String(memo?.title || '').replace(/\s+/g, ' ').trim();
                if (!title) return null;
                return {
                    serial: memoSerial,
                    time: timeText,
                    text: `- ${dateText} ${timeText} [${typeLabel}] ${title}`
                };
            })
            .filter(Boolean);
        const holidayRows = this.calendarData.getUpcomingHolidayItems?.(currentKey, 1)
            ?.map(item => {
                const parts = this.calendarData.parseDateKey(item?.dateKey);
                if (!parts) return null;
                const title = String(item?.title || '').replace(/\s+/g, ' ').trim();
                if (!title) return null;
                const dateText = `${parts.year}年${String(parts.month).padStart(2, '0')}月${String(parts.day).padStart(2, '0')}日`;
                return {
                    serial: this.calendarData.dateSerial(parts),
                    time: '00:00',
                    text: `- ${dateText} 全天 [节日] ${title}`
                };
            })
            .filter(Boolean) || [];
        const rows = [...memoRows, ...holidayRows]
            .filter(Boolean)
            .sort((a, b) => {
                if (a.serial !== b.serial) return a.serial - b.serial;
                return String(a.time || '').localeCompare(String(b.time || ''));
            })
            .slice(0, 80)
            .map(item => item.text);
        return rows.length ? rows.join('\n') : '暂无';
    }

    _buildCharacterMessage(context, fallbackName = '角色') {
        const character = context?.characterId !== undefined && context?.characters
            ? context.characters[context.characterId]
            : null;
        const parts = [`角色名：${character?.name || fallbackName}`];
        if (character?.description) parts.push(`描述：${String(character.description).trim().slice(0, 1600)}`);
        if (character?.personality) parts.push(`性格：${String(character.personality).trim().slice(0, 900)}`);
        if (character?.scenario || context?.scenario) parts.push(`场景/背景：${String(character?.scenario || context.scenario).trim().slice(0, 900)}`);
        if (character?.first_mes) parts.push(`开场白：${String(character.first_mes).trim().slice(0, 600)}`);
        if (character?.mes_example) parts.push(`示例对话：${String(character.mes_example).trim().slice(0, 900)}`);
        if (character?.data?.system_prompt) parts.push(`角色系统提示词：${String(character.data.system_prompt).trim().slice(0, 900)}`);
        if (parts.length <= 1 && !fallbackName) return null;
        return {
            role: 'system',
            content: `【角色卡信息】\n${parts.join('\n')}`,
            isPhoneMessage: true
        };
    }

    _buildPersonaMessage(context, userName = '用户') {
        const personaText = String(document.getElementById('persona_description')?.value || '').trim();
        const parts = [`姓名：${userName}`];
        if (personaText) parts.push(personaText.slice(0, 1600));
        return {
            role: 'system',
            content: `【用户信息】\n${parts.join('\n')}`,
            isPhoneMessage: true
        };
    }

    /**
     * [v3.18.0 · R-O4] 日程侧的「最近正文」收集 —— 循环交真源，
     *   日程侧特有的语义原样保留（零行为漂移）：
     *     ① 洗白名单失灵时回退原文（`|| rawText`）；
     *     ② 剥 think 块与 HTML；
     *     ③ 正文裁 1800 字、说话人分隔符是**全角冒号**；
     *     ④ 说话人判据是 `msg.is_user` 原值（不并 role 判定）。
     */
    _collectRecentChatMessages(context, limit = 30) {
        const userName = context?.name1 || '用户';
        const charName = context?.name2 || '角色';
        return collectRecentChat(context, {
            limit,
            userName,
            charName,
            skipSystem: true,
            maxChars: 1800,
            clean: (raw) => {
                const rawText = String(raw || '').trim();
                let text = applyPhoneTagFilter(rawText, { storage: this.storage }) || rawText;
                return text.replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/<[^>]*>/g, '').trim();
            },
            toEntry: ({ msg, text, userName: un, charName: cn }) => ({
                role: msg.is_user ? 'user' : 'assistant',
                content: `${msg.is_user ? un : cn}：${text}`,
                isPhoneMessage: true
            })
        }).messages;
    }

    parseScheduleResponse(text = '') {
        const bodyMatch = String(text || '').match(/<日程>([\s\S]*?)<\/日程>/i);
        const body = String(bodyMatch?.[1] || text || '').trim();
        if (!body) return [];

        const typeMap = new Map(this.calendarView.getMemoTypes().map(item => [item.label, item.id]));
        const typePattern = Array.from(typeMap.keys()).join('|');
        const lines = body
            .split(/\r?\n/)
            .map(line => line.replace(/^\s*(?:[-*•]\s*|\d+[.、]\s*)?/, '').trim())
            .filter(Boolean);
        const schedules = [];
        let currentType = '';

        lines.forEach(line => {
            const typeMatch = line.match(new RegExp(`待办日程类型\\s*[:：]\\s*(${typePattern})`));
            if (typeMatch) {
                currentType = typeMatch[1];
                return;
            }

            const itemMatch = line.match(/^(\d{1,6})年\s*(\d{1,2})月\s*(\d{1,2})日\s*(\d{1,2})\s*[:：]\s*(\d{2})\s*[:：]\s*(.+)$/);
            if (!itemMatch || !currentType) return;

            const year = Number.parseInt(itemMatch[1], 10);
            const month = Number.parseInt(itemMatch[2], 10);
            const day = Number.parseInt(itemMatch[3], 10);
            const hour = Number.parseInt(itemMatch[4], 10);
            const minute = Number.parseInt(itemMatch[5], 10);
            const title = String(itemMatch[6] || '').trim().slice(0, 160);
            if (!this._isValidScheduleDate(year, month, day) || hour > 23 || minute > 59 || !title) return;

            const dateParts = { year, month, day };
            schedules.push({
                type: typeMap.get(currentType) || 'daily',
                dateParts,
                dateKey: this.calendarView.toDateKey(dateParts),
                time: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`,
                title
            });
            currentType = '';
        });

        return schedules;
    }

    _isValidScheduleDate(year, month, day) {
        if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return false;
        if (year < 1 || month < 1 || month > 12 || day < 1) return false;
        return day <= this.calendarView.getDaysInMonth(year, month);
    }

    cleanupExpiredAutoMemos() {
        try {
            const storyDate = this.calendarView.getStoryDateParts();
            const currentKey = this.calendarView.toDateKey(storyDate);
            this.calendarData.clearExpiredAutoMemos(currentKey);
        } catch (e) {
            console.warn('[Calendar] 清理过期自动日程失败:', e);
        }
    }

    _getContext() {
        return (typeof SillyTavern !== 'undefined' && typeof SillyTavern.getContext === 'function')
            ? SillyTavern.getContext()
            : null;
    }
}
