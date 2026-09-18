/* ========================================================
 * system-notifications.js — RubyPhone 系统通知中心 [v2.16.0]
 * --------------------------------------------------------
 * 现状：phone-shell.showNotification 只做「瞬时横幅 + 队列防刷屏」，
 *   通知一闪即逝，用户错过就永久丢失（尤其离线主动触发、微博推送、
 *   礼物、短信这类非当前 App 的消息）。
 *
 * 本模块是通知的**单一真源落账层**：所有通知在展示的同时写入环形历史，
 *   供锁屏「通知速览」与下拉「通知中心」回看。
 *
 * 设计约束：
 *  1) 零副作用：push 只写缓存 + 触发防抖落盘，绝不抛异常打断通知展示。
 *  2) 随会话隔离：键名 sys_notifs 命中 config/storage.js 的 /^sys_/，
 *     写入 chatMetadata，换角色/换会话不串味（CONTEXT.md 铁律 #3）。
 *  3) 宿主安全：storage 可注入、可为 null（退化为内存态，单测可直接跑）。
 * ======================================================== */
'use strict';

const DEFAULT_LIMIT = 200;
/** 同 senderKey 在该窗口内视为「同一条通知的更新」，不新增条目（毫秒） */
const MERGE_WINDOW_MS = 3 * 60 * 1000;

export class NotificationLog {
    /**
     * @param {object|null} storage PhoneStorage 实例（可为 null → 纯内存）
     * @param {{limit?:number, key?:string}} [opts]
     */
    constructor(storage = null, opts = {}) {
        this.storage = storage;
        this.KEY = String(opts.key || 'sys_notifs');
        this.LIMIT = Math.max(20, Number(opts.limit) || DEFAULT_LIMIT);
        this._cache = null;
        this._dirty = false;
        this._flushTimer = null;
    }

    // ---------------- 读 ----------------

    /** 通知历史（新 → 旧） */
    list() {
        if (this._cache) return this._cache.slice();
        const raw = this._readRaw();
        this._cache = this._normalize(raw);
        return this._cache.slice();
    }

    /** 未读数 */
    unreadCount() {
        return this.list().filter(n => !n.read).length;
    }

    /** 按 App 聚合未读数：{ wechat: 3, weibo: 1, __sys__: 2 } */
    unreadByApp() {
        const out = {};
        for (const n of this.list()) {
            if (n.read) continue;
            const k = n.appId || '__sys__';
            out[k] = (out[k] || 0) + 1;
        }
        return out;
    }

    /** 单条查询 */
    get(id) {
        const key = String(id || '');
        return this.list().find(n => n.id === key) || null;
    }

    /** 检索：关键词匹配标题/正文/来源名 */
    search(query) {
        const q = String(query || '').trim().toLowerCase();
        if (!q) return this.list();
        return this.list().filter(n => (
            String(n.title || '').toLowerCase().includes(q)
            || String(n.message || '').toLowerCase().includes(q)
            || String(n.name || '').toLowerCase().includes(q)
            || String(n.appId || '').toLowerCase().includes(q)
        ));
    }

    // ---------------- 写 ----------------

    /**
     * 落账一条通知。
     *  同 senderKey 在 MERGE_WINDOW_MS 内重复到达时：更新末条（不计新增、不重置已读）。
     * @param {{title?:string,message?:string,icon?:string,senderKey?:string,appId?:string,meta?:object,ts?:number}} rec
     * @returns {{id:string, merged:boolean, total:number, unread:number}}
     */
    push(rec = {}) {
        try {
            const meta = (rec.meta && typeof rec.meta === 'object') ? rec.meta : {};
            const title = String(rec.title || meta.name || '系统提示');
            const message = String(rec.message || meta.content || '');
            const icon = String(rec.icon || '');
            const senderKey = String(rec.senderKey || `${title}:${icon}`);
            const appId = String(rec.appId || meta.appId || this._guessAppId(senderKey, icon));
            const ts = Number(rec.ts) || Date.now();
            const list = this.list();
            const head = list[0];
            if (head && head.senderKey === senderKey && (ts - Number(head.ts || 0)) < MERGE_WINDOW_MS) {
                head.title = title;
                head.message = message;
                head.icon = icon;
                head.appId = appId;
                head.meta = meta;
                head.ts = ts;
                head.count = (Number(head.count) || 1) + 1;
                this._cache = list;
                this._scheduleFlush();
                return { id: head.id, merged: true, total: list.length, unread: this.unreadCount() };
            }
            const item = {
                id: this._nextId(list, ts),
                ts,
                title,
                message,
                icon,
                appId,
                senderKey,
                read: false,
                count: 1,
                meta: {
                    name: String(meta.name || ''),
                    content: String(meta.content || ''),
                    avatar: String(meta.avatar || ''),
                    avatarText: String(meta.avatarText || ''),
                    isGroup: !!meta.isGroup,
                    timeText: String(meta.timeText || '')
                }
            };
            list.unshift(item);
            this._cache = list.slice(0, this.LIMIT);
            this._scheduleFlush();
            return { id: item.id, merged: false, total: this._cache.length, unread: this.unreadCount() };
        } catch (e) {
            return { id: '', merged: false, total: 0, unread: 0, error: String(e?.message || e) };
        }
    }

    /** 标记单条已读 */
    markRead(id) {
        const key = String(id || '');
        const list = this.list();
        const it = list.find(n => n.id === key);
        if (!it || it.read) return { changed: false, unread: this.unreadCount() };
        it.read = true;
        this._cache = list;
        this._scheduleFlush();
        return { changed: true, unread: this.unreadCount() };
    }

    /** 全部标记已读 */
    markAllRead() {
        const list = this.list();
        let n = 0;
        for (const it of list) {
            if (!it.read) { it.read = true; n++; }
        }
        if (n) { this._cache = list; this._scheduleFlush(); }
        return { changed: n > 0, count: n, unread: 0 };
    }

    /** 删除单条 */
    remove(id) {
        const key = String(id || '');
        const list = this.list();
        const idx = list.findIndex(n => n.id === key);
        if (idx < 0) return { removed: false, total: list.length };
        list.splice(idx, 1);
        this._cache = list;
        this._scheduleFlush();
        return { removed: true, total: list.length };
    }

    /** 清空（可按 appId） */
    clear(appId = '') {
        const scope = String(appId || '');
        const before = this.list();
        const after = scope ? before.filter(n => n.appId !== scope) : [];
        const removed = before.length - after.length;
        this._cache = after;
        this._scheduleFlush();
        return { removed, total: after.length };
    }

    /**
     * [v2.31.0] 实例销毁：**先**把挂起的脏缓存落盘到当前 storage，**再**丢定时器。
     * 与 reset() 的区别是语义而非实现细节：
     *   reset()  假设「当前 storage 已指向新会话（或已被清空），旧缓存写出去即串味」，
     *            因此**刻意不落盘** —— 这对着落账层是错的：通知落在 `sys_notifs`
     *            （随会话隔离的系统键），落账时机与聊天切换没有关系，切换前那 800ms
     *            窗口里的通知是**属于旧会话的既成事实**，丢掉即历史缺失。
     *   dispose() 假设「实例即将不再存在」，于是唯一正确的顺序是先 flushNow 再丢定时器；
     *            不变量：**dispose 不得静默吞掉已经入账的通知**。
     * 返回 flushNow 的结果（有脏数据且落盘成功 = true）。
     */
    dispose() {
        const flushed = this.flushNow();
        if (this._flushTimer) {
            clearTimeout(this._flushTimer);
            this._flushTimer = null;
        }
        this._dirty = false;
        this._cache = null;
        return flushed;
    }

    /**
     * [v2.18.0] 切换会话 / 清空数据时调用：丢弃内存缓存与挂起的防抖写入。
     *  不做任何落盘——当前 storage 已指向新会话（或已被清空），旧缓存写出去即串味；
     *  旧会话数据在切走前已由各自的防抖周期落盘，此处仅作内存层失效。
     *  旧缓存再次被读取时将从新会话 storage 重新加载（list() 惰性重建）。
     * @returns {boolean} 是否丢弃了未落盘的脏缓存
     */
    reset() {
        const wasDirty = !!this._dirty;
        if (this._flushTimer) {
            clearTimeout(this._flushTimer);
            this._flushTimer = null;
        }
        this._dirty = false;
        this._cache = null;
        return wasDirty;
    }

    /** 立即落盘（测试 / 退出前用） */
    flushNow() {
        if (this._flushTimer) {
            clearTimeout(this._flushTimer);
            this._flushTimer = null;
        }
        if (!this._dirty) return false;
        this._dirty = false;
        try {
            this.storage?.set?.(this.KEY, this._cache || [], true);
            return true;
        } catch (e) { return false; }
    }

    // ---------------- 内部 ----------------

    _readRaw() {
        try {
            const raw = this.storage?.get?.(this.KEY);
            if (typeof raw === 'string') {
                try { return JSON.parse(raw); } catch (_e) { return []; }
            }
            return raw;
        } catch (e) { return []; }
    }

    _normalize(raw) {
        if (!Array.isArray(raw)) return [];
        const out = [];
        for (const r of raw) {
            if (!r || typeof r !== 'object') continue;
            const item = {
                id: String(r.id || ''),
                ts: Number(r.ts) || 0,
                title: String(r.title || ''),
                message: String(r.message || ''),
                icon: String(r.icon || ''),
                appId: String(r.appId || ''),
                senderKey: String(r.senderKey || ''),
                read: !!r.read,
                count: Math.max(1, Number(r.count) || 1),
                meta: (r.meta && typeof r.meta === 'object') ? r.meta : {}
            };
            if (!item.id) item.id = this._nextId(out, item.ts);
            out.push(item);
        }
        out.sort((a, b) => b.ts - a.ts);
        return out.slice(0, this.LIMIT);
    }

    _nextId(list, ts) {
        const base = 'N' + (Number(ts) || Date.now()).toString(36);
        let id = base, i = 0;
        const used = new Set(list.map(n => n.id));
        while (used.has(id)) { i++; id = base + '_' + i; }
        return id;
    }

    /** 从 senderKey / 图标推断归属 App（用于按 App 聚合未读） */
    _guessAppId(senderKey = '', icon = '') {
        const s = String(senderKey || '').toLowerCase();
        const map = [
            ['wechat', 'wechat'], ['微信', 'wechat'],
            ['weibo', 'weibo'], ['微博', 'weibo'],
            ['honey', 'honey'], ['蜜语', 'honey'],
            ['diary', 'diary'], ['日记', 'diary'],
            ['music', 'music'], ['音乐', 'music'],
            ['sms', 'phone'], ['短信', 'phone'], ['通话', 'phone'],
            ['timeweaver', 'timeweaver'], ['织光机', 'timeweaver'],
            ['worldpulse', 'worldpulse'], ['世界脉搏', 'worldpulse'],
            ['xhs', 'xhs'], ['小红书', 'xhs'],
            ['tieba', 'tieba'], ['贴吧', 'tieba'],
            ['gacha', 'gacha'], ['转盘', 'gacha'],
            ['calendar', 'calendar'], ['日历', 'calendar'],
            ['health', 'health'], ['健康', 'health'],
            ['achievement', 'achievement'], ['成就', 'achievement']
        ];
        for (const [needle, app] of map) {
            if (s.includes(needle)) return app;
        }
        const iconMap = { '💬': 'wechat', '📱': 'wechat', '🎵': 'music', '📔': 'diary', '🏆': 'achievement', '📅': 'calendar', '🕰️': 'timeweaver', '🌍': 'worldpulse' };
        return iconMap[String(icon || '')] || '__sys__';
    }

    _scheduleFlush() {
        this._dirty = true;
        if (this._flushTimer) return;
        const run = () => { this._flushTimer = null; this.flushNow(); };
        try {
            this._flushTimer = setTimeout(run, 800);
            // 允许 Node 单测进程正常退出
            this._flushTimer?.unref?.();
        } catch (_e) {
            run();
        }
    }
}

export default NotificationLog;
