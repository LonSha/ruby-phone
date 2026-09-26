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
        return this.applyCommitmentResult(fulfillCommitment(this.loadCommitments(), {
            id, eventKey: eventKey || `fulfill:${id}:${Date.now()}`
        }), '约定已完成');
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

    _collectRecentChatMessages(context, limit = 30) {
        const chat = Array.isArray(context?.chat) ? context.chat : [];
        const userName = context?.name1 || '用户';
        const charName = context?.name2 || '角色';
        const messages = [];

        for (let i = chat.length - 1; i >= 0 && messages.length < limit; i -= 1) {
            const msg = chat[i];
            if (!msg || msg.role === 'system' || msg.isPhoneMessage || msg.isGaigaiData || msg.isGaigaiPrompt) continue;

            const rawText = String(msg.mes || msg.content || '').trim();
            if (!rawText) continue;

            let text = applyPhoneTagFilter(rawText, { storage: this.storage }) || rawText;
            text = text.replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/<[^>]*>/g, '').trim();
            if (!text) continue;

            const speaker = msg.is_user ? userName : charName;
            messages.unshift({
                role: msg.is_user ? 'user' : 'assistant',
                content: `${speaker}：${text.slice(0, 1800)}`,
                isPhoneMessage: true
            });
        }

        return messages;
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
