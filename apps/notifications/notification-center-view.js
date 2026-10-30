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
/* [v4.19.0 · R4-O7] 通知按「事情」收拢(纯函数)。
 *   为什么要有这一层:既有落账层只有**同 senderKey 且 3 分钟内**一道合并,
 *   而计划原文点名的缺口是「同一发送者的不同事件与同一事件的多次更新缺少面向用户的整理方式」。 */
import {
    ND_GROUP_STATES, digestOf, digestLine, mutedOf, groupRefsOf, normalizeMuteRule
} from '../../config/notice-digest.js';
/* [v4.99.7 · R11-X7] 中枢行反查不在这里 import 桥：
 *   视图**不许**自己去碰第二张表（v41000 F1 的规矩：映射只能有一处）。
 *   改为让 App 侧提供 `rowById()` 只读出口，视图只问不管。 */

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
        this._hiddenOpen = false;
        /* [v4.19.0 · R4-O7] 收拢态:展开过的事情分组(键 = 事情身份);
         *   静音规则表(**实例态**;本版不做持久化 —— 如实留白,见档头)。 */
        this._expanded = new Set();
        this._mutes = [];
    }

    // ---------------- 渲染 ----------------

    render() {
        const shell = this.app?.phoneShell;
        if (!shell?.setContent) return;
        /* [v4.99.0 · R11-X6] 数据不再直接读 `log.list()`，改走 App 的 `feed()`
         *   —— 那里**合并**了中枢派发器那张表（第二张真源的可读出口）。
         *   视图不自己去碰第二张表：碰了就是两份「怎么读」的口径。 */
        const feed = (typeof this.app?.feed === 'function') ? this.app.feed() : { rows: this.app.log.list(), counts: {}, notes: { logReadable: true, hubReadable: false, complete: false } };
        const all = Array.isArray(feed.rows) ? feed.rows : [];
        /* [v4.99.7 · R11-X7] 范式阈值过滤：**在 feed() 之后、chip/关键词过滤之前**。
         *   顺序不是随意的：范式是「这台手机现在只留什么」，chip 与搜索是「我在这一屏里找什么」。
         *   先范式后 chip，chip 的计数才能反映「范式之后还剩多少」——否则点开会变空。 */
        const split = (typeof this.app?.splitByParadigm === 'function')
            ? this.app.splitByParadigm(all)
            : { rows: all, hidden: [], applied: false, threshold: 'all', fallback: false, ok: true, why: '', paradigm: { ok: true, why: '', paradigm: null }, counts: { total: all.length, visible: all.length, hidden: 0 } };
        const rows = this._visibleRows(split.rows);
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
            <div class="nc-filters">${this._filterChips(split.rows)}</div>
            ${this._flash ? `<div class="nc-flash">${esc(this._flash)}</div>` : ''}
            ${this._paradigmNote(split)}
            ${this._hubNote(feed)}
            ${this._actionSection()}
            ${this._hiddenSection(split)}
            <div class="nc-list">${this._listHtml(rows)}</div>
        </div>`;
        shell.setContent(this.app.css() + html, 'notifications-main');
        this._bind();
    }

    /* ---------------- [v4.99.7 · R11-X7] 范式读数行 ----------------
     *   ★ 四种读数**必须不同形**（本仓既有纪律，这一处最容易压平）：
     *     · 范式读到、阈值 all          → **不显示**（没隐藏任何东西，就别占位喊「我没隐藏」）；
     *     · 范式读到、阈值非 all、隐 0 条 → 一行「已按范式留 N 条，这次没有需要隐藏的」；
     *     · 范式读到、隐了 N 条         → 一行指路「已按范式隐藏 N 条（在下方可展开）」；
     *     · 范式**读不到**              → 一行警示 + 明写「本次不过滤」，不是「你是生活档」。
     *   坏阈值（`fallback`）另说一句：阈值写了但不认识 → 说出来，别当成设计内默认。
     */
    _paradigmNote(split) {
        const s = split || {};
        const pr = s.paradigm || {};
        if (pr.ok === false) {
            const why = String(pr.why || '');
            return `<div class="nc-digest-line nc-hub-warn">⚠️ 使用范式没读到${why ? '（' + esc(why) + '）' : ''} —— 本次不过滤，全部照常显示（不是「你在生活档」）</div>`;
        }
        if (s.ok === false) {
            const why = String(s.why || '');
            return `<div class="nc-digest-line nc-hub-warn">⚠️ 范式过滤失效${why ? '（' + esc(why) + '）' : ''} —— 已全量显示，没有被悄悄藏掉的通知</div>`;
        }
        if (!s.applied) {
            if (s.fallback) {
                return `<div class="nc-digest-line nc-hub-warn">⚠️ 这个范式的通知阈值写的是「${esc(s.raw || '')}」，认不出来 —— 按「全部保留」处理</div>`;
            }
            return '';
        }
        const hiddenN = Number(s.counts && s.counts.hidden) || 0;
        const pname = String((pr.paradigm && pr.paradigm.name) || '');
        /* 档次文案由桥层给（`split.label`）：视图不再自己写档名字面量 ——
         *   否则内核改名/加档时视图不会跟着变，也没有判据替它响。 */
        const thrText = String(s.label || '');
        if (!hiddenN) {
            return `<div class="nc-digest-line">已按范式${pname ? '「' + esc(pname) + '」' : ''}${esc(thrText)} · 这次没有需要隐藏的</div>`;
        }
        return `<div class="nc-digest-line">已按范式${pname ? '「' + esc(pname) + '」' : ''}${esc(thrText)} · 隐藏了 ${hiddenN} 条（下面可展开）</div>`;
    }
    /* ---------------- [v4.99.7 · R11-X7] 被范式隐藏的通知 ----------------
     *   ★ 验收语写死：**「被隐藏的通知在中心里显示『已按范式隐藏』而非消失」**。
     *     所以这里不是简单折叠，而是给出一块**可展开的实名清单**（照样能点开、能删）。
     *   ★ 三条不变量：
     *     ① 只在 `applied && hiddenN > 0` 时出现（没隐藏就不占位，也不喊「隐藏了 0 条」）；
     *     ② 展开后每行仍是 `_row()`（行渲染口径只有一份，不在这里重写第二种观感）；
     *     ③ 隐藏≠删除：展开不写任何账本，`_row` 里的删除钮才是唯一的删（且删的是真源那条）。
     */
    _hiddenSection(split) {
        const s = split || {};
        if (!s.applied) return '';
        const hidden = Array.isArray(s.hidden) ? s.hidden : [];
        if (!hidden.length) return '';
        const open = this._hiddenOpen === true;
        const head = `<div class="nc-hid-head">` +
            `<i class="fa-solid fa-eye-slash"></i>` +
            `<span class="nc-hid-title">已按范式隐藏 ${hidden.length} 条</span>` +
            `<span class="nc-hid-sub">下面的通知没被删，只是当前范式下不打扰</span>` +
            `<button class="nc-ac-btn nc-hid-toggle" data-hid-toggle="1">${open ? '收起' : '展开'}</button>` +
            `</div>`;
        const body = open
            ? `<div class="nc-hid-body">${hidden.map(n => this._row(n)).join('')}</div>`
            : '';
        return `<div class="nc-hid">${head}${body}</div>`;
    }
    /* ---------------- [v4.99.0 · R11-X6] 中枢那张表的读数行 ----------------
     *   ★ 三态**必须不同形**（本仓既有纪律，这里最容易破）：
     *     · 两侧都读到、中枢有 N 条 → 一行小字说明「其中 N 条来自系统中枢」；
     *     · 中枢读到了但 0 条        → **不显示任何行**（没有内容就不占位）；
     *     · 中枢**读不到**           → 一行警示，并明写「不是没有通知」。
     *   第三类压成第一类（或干脆不显示）= 把「系统坏了」粉饰成「一切正常」。
     */
    _hubNote(feed) {
        const n = (feed && feed.notes) || {};
        const c = (feed && feed.counts) || {};
        if (n.hubReadable === false) {
            const why = String(n.hubWhy || '');
            return `<div class="nc-digest-line nc-hub-warn">⚠️ 系统中枢那一侧没读到${why ? '（' + esc(why) + '）' : ''} —— 这是「读不到」，不是「没有通知」</div>`;
        }
        if (Number(c.hubMapped) > 0) {
            const bad = Number(c.hubDropped) > 0
                ? `，另有 ${Number(c.hubDropped)} 条形状不合格未呈现`
                : '';
            return `<div class="nc-digest-line">其中 ${Number(c.hubMapped)} 条来自系统中枢（日程提醒 / 健康预警）${bad}</div>`;
        }
        return '';
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

    /* ================= [v4.19.0 · R4-O7] 按「事情」收拢 ================= */
    /**
     * 列表体:先经 `digestOf` 收拢,再**按组渲染**。
     *   · 组只有一条 ⇒ 直接用它那一行(与既有观感一致,不额外加壳);
     *   · 组多于一条 ⇒ 组头(代表条 + 条数 + 跨 App 标记 + 静音钮)+ 展开后的成员行。
     *   ★ 行渲染口径只有一份:`_row`(本层不重写行)。
     */
    _listHtml(rows) {
        if (!rows.length) return this._empty();
        const d = digestOf(rows);
        if (!d.ok) return this._empty();
        this._lastDigest = d;
        const parts = d.groups.map((g) => {
            if (g.count <= 1) return this._row(g.lead);
            return this._groupHtml(g);
        });
        const line = '<div class="nc-digest-line">' + esc(digestLine(d)) + '</div>';
        return line + parts.join('');
    }
    /** 一个「事情」组:**组头 + (展开时)成员行**。 */
    _groupHtml(g) {
        const lead = g.lead || {};
        const refs = groupRefsOf(g);
        const open = this._expanded.has(g.key);
        const unreadCls = g.unread > 0 ? ' nc-unread' : '';
        const appTag = APP_LABEL[lead.appId] || lead.appId || '系统';
        const why = g.state === ND_GROUP_STATES.EVENT
            ? ('同一件事 ×' + g.count)
            : ('同一来源 ×' + g.count + '(缺事件 ID,按来源兜底)');
        const cross = g.spansApps ? '<span class="nc-apptag nc-cross">跨 App 同一件事</span>' : '';
        const muted = this._isMuted(lead);
        const body = open
            ? '<div class="nc-group-body">' + g.ids.map((id) => {
                const n = this._byId(id);
                return n ? this._row(n) : '';
            }).join('') + '</div>'
            : '';
        return `<div class="nc-group${unreadCls}" data-gkey="${esc(g.key)}">
            <div class="nc-group-head nc-jumpable" data-lead="${esc(refs.leadId)}" data-app="${esc(lead.appId || '')}">
                <div class="nc-group-ico"><i class="fa-solid fa-layer-group"></i></div>
                <div class="nc-group-t1">
                    <span class="nc-name">${esc(lead.title || '')}</span>
                    <span class="nc-count">${esc(why)}</span>
                    ${cross}
                    ${muted ? '<span class="nc-apptag nc-muted">已静音(仅不打扰)</span>' : ''}
                </div>
                <div class="nc-group-t2">${esc(lead.message || '')}</div>
                <button class="nc-ac-btn nc-group-toggle" data-toggle="${esc(g.key)}">${open ? '收起' : '展开 ' + g.count}</button>
                <button class="nc-ac-btn nc-group-mute" data-mute="${esc(lead.appId || '')}">${muted ? '取消静音' : '静音此 App'}</button>
            </div>
            ${body}
        </div>`;
    }
    /** 按 id 取一条(**只读**;从当前可见行里找;找不到如实返回 null,不补空壳)。
     *  [v4.99.7 · R11-X7] 补中枢那张表：隐藏区展开后若只查 `log.list()`，
     *    hub 行（id 前缀 `hub_`）永远找不到 ⇒ 组内成员行静默留空。
     *    这里按 id 前缀分流，仍然**只读**（不写任何一张表）。 */
    _byId(id) {
        const key = String(id || '');
        if (!key) return null;
        /* [v4.99.7 · R11-X7] `hub_` 行交给 App 的只读出口反查（视图不 import 桥、不碰第二张表）。
         *   为什么不在旧路径里静默返回 null：`_byId` 是「组内成员行」的唯一入口，
         *   返回 null ⇒ 成员行**静默留空**（不报错、不缺勤），与「组里本来就没有」同形。 */
        if (/^hub_/.test(key)) {
            try {
                return (typeof this.app?.rowById === 'function') ? (this.app.rowById(key) || null) : null;
            } catch (_e) { return null; }
        }
        try {
            return (this.app.log.list() || []).find((n) => String(n.id) === key) || null;
        } catch (_e) { return null; }
    }
    /** 该条是否被静音(**只读**,不改任何东西)。 */
    _isMuted(rec) {
        try { return mutedOf(rec, this._mutes).muted; } catch (_e) { return false; }
    }
    /** 静音 / 取消静音(**只影响打断,不删消息**)。 */
    _toggleMute(appId) {
        const v = String(appId || '').trim();
        if (!v) { this._flash = '这条通知没有来源 App,没法按 App 静音'; return false; }
        const rule = normalizeMuteRule({ appId: v });
        if (!rule.ok) { this._flash = '静音规则不成立(' + rule.reason + ')'; return false; }
        const at = this._mutes.findIndex((r) => r && r.dim === 'appId' && r.value === v);
        if (at >= 0) {
            this._mutes.splice(at, 1);
            this._flash = '已取消静音:' + (APP_LABEL[v] || v) + '(历史一条没少)';
            return true;
        }
        this._mutes.push({ dim: 'appId', value: v });
        this._flash = '已静音:' + (APP_LABEL[v] || v) + '(只是不再打断,历史仍留在这里)';
        return true;
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
        /* [v4.19.0 · R4-O7] 组头三件事:展开/收起、静音、点代表条直达。 */
        root.querySelectorAll('.nc-group-toggle').forEach((b) => {
            b.addEventListener('click', (e) => {
                e.stopPropagation();
                const k = String(b.dataset.toggle || '');
                if (!k) return;
                if (this._expanded.has(k)) this._expanded.delete(k); else this._expanded.add(k);
                this.render();
            });
        });
        root.querySelectorAll('.nc-group-mute').forEach((b) => {
            b.addEventListener('click', (e) => {
                e.stopPropagation();
                if (this._toggleMute(b.dataset.mute)) this.render();
                else this.render();
            });
        });
        /* [v4.99.7 · R11-X7] 隐藏区展开/收起：**纯视图态**，不写盘、不碰账本。
         *   折叠态存在实例上（`_hiddenOpen`），切走 App 再回来复位为收起 —— 与 `_expanded` 同款。 */
        root.querySelectorAll('.nc-hid-toggle').forEach((b) => {
            b.addEventListener('click', (e) => {
                e.stopPropagation();
                this._hiddenOpen = this._hiddenOpen !== true;
                this.render();
            });
        });
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
            /* [v4.99.7 · R11-X7] 搜索重绘必须**同一条过滤链**（feed → 范式 → chip → 关键词）。
             *   首版这里直接 `log.list()` 再 `_visibleRows`，绕过了范式过滤 ——
             *   后果是「一打字，被范式藏起来的通知全冒出来」，且只在输入时出现、不报错。
             *   现在与 render() 走同一段口径：id 分叉就是两份实现，这里只允许一条链。 */
            const feed = (typeof this.app?.feed === 'function') ? this.app.feed() : { rows: this.app.log.list() };
            const all = Array.isArray(feed.rows) ? feed.rows : [];
            const split = (typeof this.app?.splitByParadigm === 'function')
                ? this.app.splitByParadigm(all)
                : { rows: all, hidden: [], applied: false, counts: { total: all.length, visible: all.length, hidden: 0 } };
            if (listEl) {
                const rows = this._visibleRows(split.rows);
                listEl.innerHTML = rows.length ? rows.map(n => this._row(n)).join('') : this._empty();
            }
            if (chipsEl) chipsEl.innerHTML = this._filterChips(split.rows);
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