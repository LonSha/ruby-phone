/* ========================================================
 * config/autonomous-life-scheduler.js
 * RubyPhone R10-X8 · 智能生活日程管家与自驱生活事件发生器
 * 
 * 核心机制：
 * 1. 角色 24 小时自主作息节律模型 (Circadian Routine Schedule):
 *    - 晨起通勤 (07:00~09:00: MORNING_COMMUTE)
 *    - 工作专注/学习 (09:00~17:00: WORK_FOCUS)
 *    - 黄昏摸鱼/下午茶 (17:00~19:00: DUSK_TEA)
 *    - 夜间独处娱乐 (19:00~23:00: NIGHT_LEISURE)
 *    - 深夜梦境休眠 (23:00~07:00: DEEP_SLEEP)
 * 2. 突发自驱生活偶发事件发生器 (Serendipitous Event Dispatcher):
 *    - 角色在特定节律根据好感与环境触发偶发事件：
 *      - 偶发拨入语音电话 (SPONTANEOUS_CALL: “刚好路过你家楼下”)
 *      - 突发生活求助短信 (URGENT_HELP_SMS: “突然下大雨了，你带伞了吗？”)
 *      - 周末偶遇邀请 (WEEKEND_INVITE)
 * 3. 错失窗口与剧情补偿机制 (Missed Window Reconciliation):
 *    - 错过接听或回复时，角色生成对应的情感碎碎念便签
 * ======================================================== */

export const ROUTINE_PHASES = Object.freeze({
    MORNING_COMMUTE: 'MORNING_COMMUTE',
    WORK_FOCUS: 'WORK_FOCUS',
    DUSK_TEA: 'DUSK_TEA',
    NIGHT_LEISURE: 'NIGHT_LEISURE',
    DEEP_SLEEP: 'DEEP_SLEEP'
});

export const SERENDIPITY_TYPES = Object.freeze({
    SPONTANEOUS_CALL: 'SPONTANEOUS_CALL',
    WEATHER_CARE_SMS: 'WEATHER_CARE_SMS',
    ERRAND_HELP_SMS: 'ERRAND_HELP_SMS',
    WEEKEND_INVITE: 'WEEKEND_INVITE'
});

export class AutonomousLifeScheduler {
    constructor(opts = {}) {
        this.storage = opts.storage || null;
        this.eventHistory = [];
        this.maxHistory = opts.maxHistory || 50;
        this._load();
    }

    _load() {
        if (!this.storage?.get) return;
        try {
            const raw = this.storage.get('autonomous_life_events_history', []);
            if (Array.isArray(raw)) this.eventHistory = raw;
        } catch (_e) {}
    }

    _save() {
        if (!this.storage?.set) return;
        try {
            this.storage.set('autonomous_life_events_history', this.eventHistory);
        } catch (_e) {}
    }

    /**
     * 判定小时对应的作息节律
     * @param {number} hour 0~23
     */
    resolveRoutinePhase(hour) {
        const h = Number(hour);
        if (h >= 7 && h < 9) return ROUTINE_PHASES.MORNING_COMMUTE;
        if (h >= 9 && h < 17) return ROUTINE_PHASES.WORK_FOCUS;
        if (h >= 17 && h < 19) return ROUTINE_PHASES.DUSK_TEA;
        if (h >= 19 && h < 23) return ROUTINE_PHASES.NIGHT_LEISURE;
        return ROUTINE_PHASES.DEEP_SLEEP;
    }

    /**
     * 触发自驱偶发生活事件
     * @param {Object} actorContext { actorId, actorName, intimacy, currentHour, weather }
     * @returns {Object|null} 触发的偶发事件
     */
    triggerAutonomousEvent(actorContext = {}) {
        const { actorId, actorName, intimacy = 50, currentHour = 18, weather = 'CLEAR' } = actorContext;
        const phase = this.resolveRoutinePhase(currentHour);

        // 深夜休眠不触发电话
        if (phase === ROUTINE_PHASES.DEEP_SLEEP) {
            return null;
        }

        let eventType = SERENDIPITY_TYPES.WEATHER_CARE_SMS;
        let content = '';

        if (weather === 'RAINY') {
            eventType = SERENDIPITY_TYPES.WEATHER_CARE_SMS;
            content = `${actorName}: 外面雨下得好大，你下班带伞了吗？没带的话我顺路给你送一把？`;
        } else if (phase === ROUTINE_PHASES.DUSK_TEA && intimacy >= 60) {
            eventType = SERENDIPITY_TYPES.SPONTANEOUS_CALL;
            content = `${actorName} 突然打来电话：“喂？我刚好在你们公司附近，晚上要一起吃个饭吗？”`;
        } else if (phase === ROUTINE_PHASES.NIGHT_LEISURE && intimacy >= 70) {
            eventType = SERENDIPITY_TYPES.WEEKEND_INVITE;
            content = `${actorName}: 周末那家新开的艺术展，你周六有空一起去看看嘛？`;
        } else {
            eventType = SERENDIPITY_TYPES.ERRAND_HELP_SMS;
            content = `${actorName}: 今天工作好忙呀，刚刚终于搞定一个大项目，跟你吐槽一下~`;
        }

        const event = {
            id: 'auto_ev_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
            actorId: actorId || 'char',
            actorName: actorName || '对方',
            phase,
            eventType,
            content,
            intimacyRequired: intimacy,
            timestamp: Date.now(),
            resolved: false
        };

        this.eventHistory.unshift(event);
        if (this.eventHistory.length > this.maxHistory) this.eventHistory.pop();
        this._save();

        return event;
    }

    getRecentEvents(limit = 10) {
        return this.eventHistory.slice(0, limit);
    }
}