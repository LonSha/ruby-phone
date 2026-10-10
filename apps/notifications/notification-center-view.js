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
            ${this._actionSection()}
            <div class="nc-list">${rows.length ? rows.map(n => this._row(n)).join('') : this._empty()}</div>
        </div>`;
        shell.setContent(this.app.css() + html, 'notifications-main');
        this._bind();
    }

    /* ---------------- [v3.85.0 · R-X1] 行动中心两列 ----------------
     *   数据**只**从宿主缓存读（`VirtualPhone._actionCenterCache`，由 config/action-center.js
     *   在咽喉处算好后挂上）：本视图不重算、不过滤、不判断哪条属哪列 ——
     *   分列在真源层就做完了，视图再分一遍就是第二份实现（本仓治过多次的那种漂移）。
     *   跳不过去的条目**照样显示**，并把理由写在按钮上（点了没反应才是真坑）。 */
    _actionSection() {
        let center = null;
        try { center = window.VirtualPhone?._actionCenterCache || null; } catch (_e) { center = null; }
        if (!center) {
            return `<div class="nc-ac nc-ac-mute"><div class="nc-ac-head">行动中心</div>` +
                `<div class="nc-ac-note">还没取到数（下一次剧情时间推进后刷新）</div></div>`;
        }
        const lanes = center.lanes || { readonly: [], needConfirm: [] };
        const nRead = (lanes.readonly || []).length;
        const nNeed = (lanes.needConfirm || []).length;
        const gaps = Array.isArray(center.gaps) ? center.gaps : [];
        /* 三态不许压平：读不到（gap）/ 读了确实没有 / 有 N 条。 */
        const head = `行动中心 · ${nNeed} 项需确认 · ${nRead} 项只读`;
        const gapLine = gaps.length
            ? `<div class="nc-ac-note">${gaps.length} 个源这轮没读到：${esc(gaps.map(g => g.source).join(' · '))}</div>`
            : '';
        if (!nRead && !nNeed) {
            return `<div class="nc-ac"><div class="nc-ac-head">${esc(head)}</div>${gapLine}` +
                `<div class="nc-ac-note">本机现在没有待处理的项</div></div>`;
        }
        return `<div class="nc-ac">
            <div class="nc-ac-head">${esc(head)}</div>
            ${gapLine}
            ${this._actionLane('需确认', lanes.needConfirm)}
            ${this._actionLane('只读', lanes.readonly)}
        </div>`;
    }

    _actionLane(title, rows) {
        const list = Array.isArray(rows) ? rows : [];
        const body = list.length
            ? list.map(it => this._actionRow(it)).join('')
            : `<div class="nc-ac-note">（无）</div>`;
        return `<div class="nc-ac-lane"><div class="nc-ac-lanetitle">${esc(title)}<span class="nc-ac-lanen">${list.length}</span></div>${body}</div>`;
    }

    _actionRow(it) {
        const acts = Array.isArray(it.actions) ? it.actions : [];
        const label = { done: '完成', snooze: '稍后', ignore: '忽略' };
        const btns = acts.map(a => {
            const key = String(a || '');
            if (key === 'open') {
                const ok = it.jump && it.jump.ok === true;
                const why = ok ? '打开来源' : ('跳不过去：' + String((it.jump && it.jump.why) || ''));
                return `<button class="nc-ac-btn nc-ac-open${ok ? '' : ' nc-ac-btn-off'}" data-ac-anchor="${esc(it.realIdemKey)}" data-ac-act="open" title="${esc(why)}"${ok ? '' : ' disabled'}>打开</button>`;
            }
            return `<button class="nc-ac-btn" data-ac-anchor="${esc(it.realIdemKey)}" data-ac-act="${esc(key)}">${esc(label[key] || key)}</button>`;
        }).join('');
        const meta = [it.label, it.certainty === 'suggestion' ? '建议' : '', it.floor !== null && it.floor !== undefined ? ('第 ' + it.floor + ' 楼') : '', it.storyDay || '']
            .filter(Boolean).join(' · ');
        return `<div class="nc-ac-item${it.jump && it.jump.ok ? ' nc-ac-jumpable' : ''}">
            <div class="nc-ac-icon">${esc(it.icon || '•')}</div>
            <div class="nc-ac-body">
                <div class="nc-ac-t1">${esc(it.title || '')}</div>
                ${it.detail ? `<div class="nc-ac-t2">${esc(it.detail)}</div>` : ''}
                <div class="nc-ac-t3">${esc(meta)}</div>
            </div>
            <div class="nc-ac-btns">${btns}</div>
        </div>`;
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
        /* [v3.85.0 · R-X1] 行动项四动作：视图只把「锚 + 动作」交给宿主去落账与新起一轮，
         *   自己**不写账本、不改 center**（写入口只有咽喉一处，否则又是两份账）。 */
        root.querySelectorAll('.nc-ac-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const anchor = String(btn.dataset.acAnchor || '');
                const act = String(btn.dataset.acAct || '');
                let res = null;
                try { res = window.VirtualPhone?.applyActionCenterAction?.(anchor, act) || null; } catch (_e) { res = null; }
                if (res && res.ok === true) {
                    this._flash = res.note || '已处理';
                } else {
                    this._flash = (res && res.note) ? res.note : '这一项处理不了（宿主未接线或已失效）';
                }
                this.render();
            });
        });
    }
}

export default NotificationCenterView;