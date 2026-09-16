/* ========================================================
 * notification-center-view.js — 通知中心面板 [v2.16.0]
 * --------------------------------------------------------
 * 从屏幕顶部下拉呼出（iOS/Android 风格）：历史通知按天分组、
 * 未读高亮、按 App 筛选、关键词搜索、一键已读/清空、点击跳转原 App。
 *
 * 数据源：config/system-notifications.js 的 NotificationLog（单一真源）。
 * 样式在通知中心 App 的 CSS 里（apps/notifications/notification-center.css → phone.css 合并）。
 * ======================================================== */
'use strict';

function esc(s) {
    return String(s ?? '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/\u0022/g, '&quot;').replace(/'/g, '&#39;');
}

const APP_LABEL = {
    wechat: '微信', weibo: '微博', honey: '蜜语', mofo: '魔坊', wangxiang: '万象',
    phone: '电话', diary: '日记', music: '音乐', album: '相册', calendar: '日历',
    games: '游戏', settings: '设置', memory: '记忆', mood: '心境', tarot: '塔罗',
    playbook: '灵感工坊', achievement: '成就簿', xhs: '小红书', tieba: '贴吧',
    health: '健康', peek: '查手机', bilibili: 'B站', theater: '小剧场',
    reading: '阅读', gacha: '幸运转盘', timeweaver: '织光机', worldpulse: '世界脉搏',
    __sys__: '系统'
};

const ICON_FA = {
    '📱': 'fa-solid fa-mobile-screen', '💬': 'fa-solid fa-comment', '✅': 'fa-solid fa-check',
    '❌': 'fa-solid fa-xmark', '⚠️': 'fa-solid fa-triangle-exclamation', '🎵': 'fa-solid fa-music',
    '📞': 'fa-solid fa-phone', '📵': 'fa-solid fa-phone-slash', '📹': 'fa-solid fa-video',
    '📰': 'fa-solid fa-newspaper', '📍': 'fa-solid fa-location-dot', '🧧': 'fa-solid fa-envelope',
    '🗑️': 'fa-solid fa-trash', '🕰️': 'fa-solid fa-clock-rotate-left', '🏆': 'fa-solid fa-trophy',
    '📅': 'fa-solid fa-calendar', '🌍': 'fa-solid fa-earth-asia', '📔': 'fa-solid fa-book'
};

export class NotificationCenterView {
    /** @param {import('./notification-center-app.js').NotificationCenterApp} app */
    constructor(app) {
        this.app = app;
        this._filter = '';        // '' = 全部；否则 appId
        this._keyword = '';
        this._flash = '';
    }

    // ---------------- 渲染 ----------------

    render() {
        const shell = this.app?.phoneShell;
        if (!shell?.setContent) return;
        const log = this.app.log;
        const all = log.list();
        const rows = this._visibleRows(all);
        const html = `
        <div class="nc-wrap">
            <div class="nc-topbar">
                <div class="nc-title">通知中心</div>
                <div class="nc-actions">
                    <button class="nc-act" id="nc-read-all" title="全部已读"><i class="fa-solid fa-check-double"></i></button>
                    <button class="nc-act nc-danger" id="nc-clear" title="清空"><i class="fa-solid fa-broom"></i></button>
                </div>
            </div>
            <div class="nc-searchbar">
                <i class="fa-solid fa-magnifying-glass"></i>
                <input id="nc-search" class="nc-search" type="search" placeholder="搜索通知" value="${esc(this._keyword)}" />
            </div>
            <div class="nc-filters">${this._filterChips(all)}</div>
            ${this._flash ? `<div class="nc-flash">${esc(this._flash)}</div>` : ''}
            <div class="nc-list">${rows.length ? rows.map(n => this._row(n)).join('') : this._empty()}</div>
        </div>`;
        shell.setContent(this.app.css() + html, 'notifications-main');
        this._bind();
    }

    _filterChips(all) {
        const counts = {};
        for (const n of all) {
            const k = n.appId || '__sys__';
            counts[k] = (counts[k] || 0) + 1;
        }
        // [v2.17.0] 未读对齐：消费落账层 unreadByApp() 聚合（含 __sys__）—— chip 副数字优先显示
        //   未读数（真机语义：徽标数 = 未读）；某分组无未读时回落总数，避免 chips 全 0 的空洞感。
        let unread = {};
        try {
            const log = this.app?.log;
            if (log && typeof log.unreadByApp === 'function') unread = log.unreadByApp() || {};
        } catch (_e) { unread = {}; }
        const unreadTotal = Object.keys(unread).reduce((s, k) => s + (Number(unread[k]) || 0), 0);
        const keys = Object.keys(counts).sort((a, b) => ((unread[b] || 0) - (unread[a] || 0)) || counts[b] - counts[a]);
        if (!keys.length) return '';
        const chip = (key, label, count) => {
            const un = key ? (Number(unread[key]) || 0) : unreadTotal;
            const num = un > 0 ? un : count;
            const on = this._filter === key ? ' nc-chip-on' : '';
            return `<button class="nc-chip${on}" data-filter="${esc(key)}">${esc(label)}<span class="nc-chip-num">${num}</span></button>`;
        };
        return chip('', '全部', all.length) + keys.map(k => chip(k, APP_LABEL[k] || k, counts[k])).join('');
    }

    _visibleRows(all) {
        let out = all;
        if (this._filter) out = out.filter(n => (n.appId || '__sys__') === this._filter);
        const kw = this._keyword.trim().toLowerCase();
        if (kw) {
            out = out.filter(n => (
                String(n.title || '').toLowerCase().includes(kw)
                || String(n.message || '').toLowerCase().includes(kw)
                || String(n.meta?.name || '').toLowerCase().includes(kw)
            ));
        }
        return out;
    }

    _row(n) {
        const fa = ICON_FA[n.icon] || 'fa-solid fa-bell';
        const avatarRaw = String(n.meta?.avatar || '').trim();
        const isImg = /^(https?:\/\/|data:image\/|\/)/i.test(avatarRaw);
        const avatarInner = isImg
            ? `<img src="${esc(avatarRaw)}" alt="" onerror="this.style.display='none'" />`
            : `<span class="nc-avatar-text">${esc(avatarRaw || n.meta?.avatarText || (n.meta?.isGroup ? '群' : ''))}</span>`;
        const showAvatar = !!(avatarRaw || n.meta?.avatarText || n.meta?.isGroup);
        const unreadCls = n.read ? '' : ' nc-unread';
        const countTag = (Number(n.count) || 1) > 1 ? `<span class="nc-count">×${Number(n.count)}</span>` : '';
        const appTag = APP_LABEL[n.appId] || n.appId || '系统';
        const jumpable = n.appId && n.appId !== '__sys__';
        return `<div class="nc-item${unreadCls}${jumpable ? ' nc-jumpable' : ''}" data-id="${esc(n.id)}" data-app="${esc(n.appId || '')}">
            <div class="nc-avatar${showAvatar ? '' : ' nc-avatar-icon'}">${showAvatar ? avatarInner : `<i class="${fa}"></i>`}</div>
            <div class="nc-body">
                <div class="nc-row1">
                    <span class="nc-name">${esc(n.title)}</span>
                    <span class="nc-time">${esc(this._timeText(n.ts))}</span>
                </div>
                <div class="nc-row2">${esc(n.message)}</div>
                <div class="nc-row3">
                    <span class="nc-apptag">${esc(appTag)}</span>
                    ${countTag}
                    ${jumpable ? '<span class="nc-jump">打开 ›</span>' : ''}
                </div>
            </div>
            <button class="nc-del" data-del="${esc(n.id)}" title="删除"><i class="fa-solid fa-xmark"></i></button>
        </div>`;
    }

    _empty() {
        const kw = this._keyword.trim();
        const msg = kw ? `没有匹配「${esc(kw)}」的通知` : '还没有通知';
        const sub = kw ? '换个关键词试试' : '消息、提醒、推送都会留存在这里，不会一闪即逝。';
        return `<div class="nc-empty"><div class="nc-empty-icon">🔔</div><div class="nc-empty-title">${msg}</div><div class="nc-empty-sub">${sub}</div></div>`;
    }

    _timeText(ts) {
        const t = Number(ts) || 0;
        if (!t) return '';
        const d = new Date(t), now = new Date();
        const pad = (n) => String(n).padStart(2, '0');
        const same = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
        const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
        if (same(d, now)) return hm;
        const y = new Date(now.getTime() - 86400000);
        if (same(d, y)) return '昨天 ' + hm;
        return `${d.getMonth() + 1}/${d.getDate()} ${hm}`;
    }

    // ---------------- 交互 ----------------

    _bind() {
        const root = this.app.phoneShell?.screen;
        if (!root) return;
        root.querySelector('#nc-read-all')?.addEventListener('click', () => {
            const r = this.app.log.markAllRead();
            this._flash = r.count ? `已把 ${r.count} 条标记为已读` : '没有未读通知';
            this._syncBadge();
            this.render();
        });
        root.querySelector('#nc-clear')?.addEventListener('click', () => {
            const r = this.app.log.clear();
            this._flash = r.removed ? `已清空 ${r.removed} 条通知` : '本来就是空的';
            this._syncBadge();
            this.render();
        });
        const search = root.querySelector('#nc-search');
        search?.addEventListener('input', (e) => {
            this._keyword = String(e.target?.value || '');
            // 只重绘列表与筛选，避免输入框失焦
            const listEl = root.querySelector('.nc-list');
            const chipsEl = root.querySelector('.nc-filters');
            const all = this.app.log.list();
            if (listEl) {
                const rows = this._visibleRows(all);
                listEl.innerHTML = rows.length ? rows.map(n => this._row(n)).join('') : this._empty();
            }
            if (chipsEl) chipsEl.innerHTML = this._filterChips(all);
            this._bindItems();
        });
        root.querySelectorAll('.nc-chip').forEach(btn => {
            btn.addEventListener('click', () => {
                this._filter = String(btn.dataset.filter || '');
                this.render();
            });
        });
        this._bindItems();
    }

    /** [v2.17.0] 已读 / 删除 / 清空后同步宿主桌面角标（落账层未读 → 通知中心图标角标）。 */
    _syncBadge() {
        try { window.VirtualPhone?.syncNotificationsBadge?.(); } catch (_e) { /* 忽略 */ }
    }

    _bindItems() {
        const root = this.app.phoneShell?.screen;
        if (!root) return;
        root.querySelectorAll('.nc-del').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.app.log.remove(String(btn.dataset.del || ''));
                this._syncBadge();
                this.render();
            });
        });
        root.querySelectorAll('.nc-item').forEach(item => {
            item.addEventListener('click', () => {
                const id = String(item.dataset.id || '');
                const appId = String(item.dataset.app || '');
                this.app.log.markRead(id);
                this._syncBadge();
                if (appId && appId !== '__sys__') {
                    try {
                        window.dispatchEvent(new CustomEvent('phone:openApp', { detail: { appId } }));
                    } catch (_e) { /* 忽略 */ }
                    return;
                }
                this.render();
            });
        });
    }
}

export default NotificationCenterView;