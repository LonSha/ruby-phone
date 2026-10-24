/**
 * config/qianshi-schedule.js - 剧情待办与约定日程应用 (Qianshi Schedule App)
 * 
 * 机制借鉴与超越：
 * 吸收千千结 (ST-MyriadKnots v0.9.4) 千事模型与记忆宫殿待办约定系统。
 * 在手机端呈现角色在对话中做出的约定与待办事项（如约会、承诺、交付任务、重要事件）。
 * 支持双层状态追踪（整线事项状态与单次动作状态）、逾期检测、人工勾选达成与日程日历视图。
 */

export const STORAGE_KEY = 'qss_qianshi_schedule_v1';

export class QianshiScheduleManager {
    constructor() {
        this.schedules = new Map(); // scheduleId -> item
    }

    /**
     * 注册或更新一项待办约定
     * @param {Object} item { id, title, description, character, storyTime, scheduledTime, status }
     * @returns {Object} 登记后的日程对象
     */
    addOrUpdateSchedule(item) {
        if (!item || !item.title) {
            throw new Error('Schedule item must have a title');
        }

        const id = item.id || `sch_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
        const existing = this.schedules.get(id);

        const record = {
            id,
            title: item.title,
            description: item.description || '',
            character: item.character || '未知角色',
            storyTime: item.storyTime || '未定时间',
            scheduledTime: item.scheduledTime || '',
            status: item.status || 'planned', // planned | inProgress | completed | overdue | cancelled
            createdAt: existing ? existing.createdAt : Date.now(),
            updatedAt: Date.now()
        };

        this.schedules.set(id, record);
        return record;
    }

    /**
     * 标记事项完成状态
     * @param {string} id 
     * @param {string} newStatus - 'completed' | 'cancelled' | 'inProgress'
     * @returns {Object} 更新后的记录
     */
    updateStatus(id, newStatus) {
        const item = this.schedules.get(id);
        if (!item) {
            throw new Error(`Schedule item ${id} not found`);
        }
        item.status = newStatus;
        item.updatedAt = Date.now();
        return item;
    }

    /**
     * 获取按角色分组或按状态筛选的日程列表
     * @param {Object} filter { character?: string, status?: string }
     * @returns {Array}
     */
    listSchedules(filter = {}) {
        let list = Array.from(this.schedules.values());
        if (filter.character) {
            list = list.filter(s => s.character === filter.character);
        }
        if (filter.status) {
            list = list.filter(s => s.status === filter.status);
        }
        return list;
    }

    /**
     * 获取当前处于活跃（进行中或计划中）的约定计数
     * @returns {Object} { total, active, completed, overdue }
     */
    getSummaryCounts() {
        const list = Array.from(this.schedules.values());
        return {
            total: list.length,
            active: list.filter(s => s.status === 'planned' || s.status === 'inProgress').length,
            completed: list.filter(s => s.status === 'completed').length,
            overdue: list.filter(s => s.status === 'overdue').length
        };
    }
}