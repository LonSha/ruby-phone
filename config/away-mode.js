/* ========================================================
 * config/away-mode.js — [v4.115.0 · R13-X4] 离线与错过
 *
 * 【用户第一次能做什么】
 *   把手机"放下"（显式开关或因电量/时段模拟离线）：
 *   期间发生的消息、来电、通知不弹窗推送，但会精密记账；
 *   重新拿起手机时，有一个「不在的时候」清单：
 *   错过了什么、谁找过你、哪件事过期了。
 *
 * 【机制纪律与撤销降级】
 *   1. isAway() 默认恒 false；未启用时系统行为零变化；
 *   2. 不拦截既有持久化存储：所有通知仍入库，只是抑制即时弹窗广播，
 *      并在 away-mode 账本中登记 missed 条目；
 *   3. 策略与机制分离：过期的判定由可选 isStaleFn 策略提供，内核只汇集不武断推测；
 *   4. 不自动补发连环弹窗：回来后只通过「不在的时候」清单静默呈现，拒绝二次打扰。
 * ======================================================== */

export const AWAY_REASONS = Object.freeze({
    MANUAL: 'manual',         // 用户主动放下手机
    BATTERY: 'battery',       // 模拟电量告急/关机离线
    SLEEP: 'sleep',           // 夜间/睡眠时段
    CUSTOM: 'custom'          // 自定义情境
});

export class AwayMode {
    /**
     * @param {Object} [opts]
     * @param {Object} [opts.storage] 本地存储实例
     * @param {boolean} [opts.enabled] 是否启用本功能，默认 true
     */
    constructor(opts = {}) {
        this.storage = opts.storage || null;
        this.enabled = opts.enabled !== false;
        this._isAway = false;
        this._awaySince = null;
        this._awayUntil = null;
        this._awayReason = AWAY_REASONS.MANUAL;
        this._missed = [];
        this.reviewCursor = { group: 'all', page: 0 };
        this._maxMissed = 100;
        this._subscribers = new Set();

        this._load();
    }

    _load() {
        if (!this.storage?.get) return;
        try {
            const saved = this.storage.get('sys_away_mode_state');
            if (saved && typeof saved === 'object') {
                if (saved.reviewCursor && typeof saved.reviewCursor.group === 'string' && Number.isInteger(saved.reviewCursor.page) && saved.reviewCursor.page >= 0) this.reviewCursor = saved.reviewCursor;
                this._isAway = Boolean(saved.isAway);
                this._awaySince = saved.awaySince || null;
                this._awayUntil = saved.awayUntil || null;
                this._awayReason = saved.awayReason || AWAY_REASONS.MANUAL;
                this._missed = Array.isArray(saved.missed) ? saved.missed.slice(-this._maxMissed) : [];
            }
        } catch (_e) {}
    }

    _save() {
        if (!this.storage?.set) return;
        try {
            return this.storage.set('sys_away_mode_state', {
                isAway: this._isAway,
                awaySince: this._awaySince,
                awayUntil: this._awayUntil,
                awayReason: this._awayReason,
                reviewCursor: this.reviewCursor,
                missed: this._missed
            });
        } catch (_e) {}
    }

    /**
     * 订阅离开状态变更
     * @param {Function} fn (event: 'AWAY'|'BACK'|'MISSED', data: any) => void
     */
    subscribe(fn) {
        if (typeof fn === 'function') {
            this._subscribers.add(fn);
            return () => this._subscribers.delete(fn);
        }
        return () => {};
    }

    _emit(event, data) {
        for (const fn of this._subscribers) {
            try { fn(event, data); } catch (_e) {}
        }
    }

    /**
     * 是否正处于离开/不在手上状态
     */
    isAway() {
        if (!this.enabled) return false;
        if (!this._isAway) return false;
        // 如果设置了 until 且已到期，则自动视为已回来
        if (this._awayUntil && Date.now() >= this._awayUntil) {
            this.markBack();
            return false;
        }
        return true;
    }

    /**
     * 获取离开状态详情
     */
    getAwayState() {
        return {
            enabled: this.enabled,
            isAway: this.isAway(),
            awaySince: this._awaySince,
            awayUntil: this._awayUntil,
            reason: this._awayReason,
            missedCount: this._missed.length
        };
    }

    /**
     * 标记放下手机 / 进入离开模式
     * @param {Object} [opts]
     * @param {string} [opts.reason] 原因代码 (manual|battery|sleep|custom)
     * @param {number} [opts.until] 预期离开截止时间戳
     */
    markAway(opts = {}) {
        if (!this.enabled) return false;
        this._isAway = true;
        this._awaySince = opts.since || Date.now();
        this._awayUntil = opts.until || null;
        this._awayReason = opts.reason || AWAY_REASONS.MANUAL;
        this._save();
        this._emit('AWAY', this.getAwayState());
        return true;
    }

    /**
     * 标记重新拿起手机 / 离开结束
     * @returns {Array<Object>} 离开期间错过的完整条目清单
     */
    markBack() {
        const wasAway = this._isAway;
        const missedSnapshot = [...this._missed];
        this._isAway = false;
        this._awaySince = null;
        this._awayUntil = null;
        this._save();
        if (wasAway) {
            this._emit('BACK', { missed: missedSnapshot });
        }
        return missedSnapshot;
    }

    /**
     * 在离开期间记录一条错过的通知/消息/呼叫
     * @param {Object} item
     */
    recordMissed(item) {
        if (!this.isAway() || !item) return null;
        const record = {
            id: item.id || ('missed_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6)),
            appId: item.appId || 'system',
            channel: item.channel || item.appId || 'system',
            title: String(item.title || '').trim(),
            body: String(item.body || '').trim(),
            priority: item.priority != null ? item.priority : 2,
            priorityName: item.priorityName || 'NORMAL',
            timestamp: item.timestamp || Date.now(),
            metadata: item.metadata || {},
            deepLink: item.deepLink || null,
            read: false
        };

        this._missed.unshift(record);
        if (this._missed.length > this._maxMissed) {
            this._missed.pop();
        }
        this._save();
        this._emit('MISSED', record);
        return record;
    }

    /**
     * 筛选特定时间段内错过的项
     */
    missedDuring(from, to) {
        const f = Number(from) || 0;
        const t = Number(to) || Infinity;
        return this._missed.filter(m => m.timestamp >= f && m.timestamp <= t);
    }

    /**
     * 获取错过项的综合摘要（聚合与过期标记）
     * @param {Function} [isStaleFn] 可选的过期判定策略 (item) => boolean
     */
    getMissedSummary(isStaleFn = null) {
        const groups = new Map();
        let urgentCount = 0;
        let staleCount = 0;

        for (const item of this._missed) {
            const isStale = typeof isStaleFn === 'function' ? Boolean(isStaleFn(item)) : false;
            if (isStale) staleCount++;
            if (item.priority >= 3 || item.priorityName === 'URGENT') urgentCount++;

            if (!groups.has(item.appId)) {
                groups.set(item.appId, {
                    appId: item.appId,
                    items: [],
                    latestTimestamp: item.timestamp,
                    unreadCount: 0
                });
            }
            const g = groups.get(item.appId);
            if (!item.read) g.unreadCount++;
            g.items.push({
                ...item,
                stale: isStale
            });
        }

        return {
            totalCount: this._missed.length,
            unreadCount: this._missed.filter(m => !m.read).length,
            urgentCount,
            staleCount,
            groups: Array.from(groups.values()),
            raw: [...this._missed]
        };
    }

    /**
     * 标记错过条目为已读
     */
    markRead(id = null) {
        if (id == null) {
            // 全部标已读
            for (const m of this._missed) m.read = true;
        } else {
            const hit = this._missed.find(m => m.id === id);
            if (hit) hit.read = true;
        }
        this._save();
    }

    async saveReviewCursor(group, page) {
        if (typeof group !== 'string' || !Number.isInteger(page) || page < 0) return false;
        const previous = this.reviewCursor;
        this.reviewCursor = { group, page };
        try { await this._save(); } catch (_) { this.reviewCursor = previous; return false; }
        try {
            if (JSON.stringify(this.storage?.get('sys_away_mode_state')?.reviewCursor) === JSON.stringify(this.reviewCursor)) return true;
        } catch (_) {}
        this.reviewCursor = previous;
        return false;
    }
    /** Review is not a reply or execution receipt. */
    async reviewMissed(id, status) {
        if (!['later', 'seen', 'handle', 'dismiss'].includes(status)) return false;
        if (this._missed.filter(item => item.id === id).length !== 1) return false;
        const previous = this._missed;
        this._missed = previous.map(item => item.id === id ? { ...item, reviewStatus: status, read: status === 'seen' ? true : item.read } : item);
        try { await this._save(); } catch (_) { this._missed = previous; return false; }
        try {
            const saved = this.storage?.get('sys_away_mode_state');
            if (!saved || JSON.stringify(saved.missed) !== JSON.stringify(this._missed)) { this._missed = previous; return false; }
            return true;
        } catch (_) { this._missed = previous; return false; }
    }
    /**
     * 清理错过项
     */
    clearMissed(ids = null) {
        if (!ids) {
            this._missed = [];
        } else {
            const toRemove = new Set(Array.isArray(ids) ? ids : [ids]);
            this._missed = this._missed.filter(m => !toRemove.has(m.id));
        }
        this._save();
    }
}

let _defaultInstance = null;
export function getAwayMode(opts = {}) {
    if (!_defaultInstance) {
        _defaultInstance = new AwayMode(opts);
    }
    return _defaultInstance;
}
