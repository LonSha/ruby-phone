/* ========================================================
 * notification-center-app.js — 通知中心 App 控制器 [v2.16.0]
 * --------------------------------------------------------
 * 依赖注入：NotificationLog 由共享运行日志（window.VirtualPhone.notificationLog）
 *   优先接管；若宿主尚未安装，则自建一个（保证 App 单独打开也工作）。
 * 样式：css() 提供面板样式，由 PhoneShell.setContent 注入到视图内。
 * ======================================================== */
'use strict';
import { NotificationLog } from '../../config/system-notifications.js';
/* [v4.99.0 · R11-X6] 中枢派发器 → 通知中心（第二张真源的可读出口）。
 *   分工写死：本 App **只读**中枢那张表（`_resolveHub` 拿实例、`_hubRows` 取行），
 *   不往里写、不把它的行抄进 `sys_notifs`。写回各回各家 —— 抄一份就是两份真源。
 *   映射与合并全在 config/notification-hub-bridge.js（纯函数），本件不写第二套口径。 */
import { mergeFeed, mapHubNotification } from '../../config/notification-hub-bridge.js';
/* [v4.99.7 · R11-X7] 使用范式 → 通知中心（**阈值过滤**的唯一口径）。
 *   分工写死：阈值留哪条、丢哪条由 `config/usage-paradigm.js` 的 `filterNoticesByParadigm`
 *   决定；「通知行没有 level 字段」这层形状差异由 `config/notice-paradigm-bridge.js` 翻译。
 *   本件**不写第三套过滤判据** —— 写了改阈值时三边必然走岔。
 *   ⚠️ 历史上该内核被错用过一次（`config/subsystem-orchestrator.js:634` 记的教训：
 *     每次写一份 key='custom' 的固定副本、`filterNoticesByParadigm([])` 传空数组）。
 *     这里两处都避开：范式**从盘上读**（与主屏/洞察 App 同一个键），行**真的传进去**。 */
import { resolveActiveParadigm } from '../../config/usage-paradigm.js';
import { splitNoticesByParadigm } from '../../config/notice-paradigm-bridge.js';

/** 范式键。与 `apps/usage/usage-app.js` 的 `PARADIGM_KEY`、`phone/home-screen.js` 的
 *  字面量 `'usage_paradigm_v1'` 必须是同一个（这里不 import App，避免 App 互相依赖成环；
 *  三处字面量由 tests/system-v4997.test.mjs 的「键唯一」判据钉住）。 */
export const NOTICE_PARADIGM_KEY = 'usage_paradigm_v1';
import { NotificationCenterView } from './notification-center-view.js';
/**
 * [v4.99.0 · R11-X6] 三类读数必须**不同形**（本仓既有纪律，这里最容易破）：
 *   · 读到了、有 N 条        → 正常画列表；
 *   · 读到了、0 条           → 「还没派发过」；
 *   · **读不到**（没有中枢 / 中枢那侧读抛错）→ 「有一侧没读到」+ 明写「不是没有通知」。
 * 第三类压成第二类，就等于把「系统坏了」粉饰成「一切正常」。
 */
export class NotificationCenterApp {
    constructor(phoneShell, storage) {
        this.phoneShell = phoneShell;
        this.storage = storage;
        this.VIEW_ID = 'notifications-main';
        this.view = new NotificationCenterView(this);
        // 优先复用宿主共享的落账层（showNotification 写入的同一份）
        this.log = this._resolveLog();
    }
    /* ---------- [v4.99.0 · R11-X6] 中枢派发器的读口（**只读**） ---------- */
    /**
     * 取中枢的通知派发器实例。取不到**不是错误**（宿主可能还没装配），
     * 但必须让上层能把它与「取到了、但是空的」分开 —— 故返回 {ok, why, hub}。
     */
    _resolveHub() {
        let vp = null;
        try { vp = (typeof window !== 'undefined') ? window.VirtualPhone : null; } catch (_e) { vp = null; }
        if (!vp) return { ok: false, why: 'no_host', hub: null };
        const sub = vp.subsystems || null;
        if (!sub) return { ok: false, why: 'no_subsystems', hub: null };
        const hub = sub.notifications || null;
        if (!hub || typeof hub.getClusteredNotifications !== 'function') {
            return { ok: false, why: 'no_dispatcher', hub: null };
        }
        return { ok: true, why: '', hub };
    }
    /**
     * 读中枢那张表。**读抛错也当读不到**（不回落空数组冒充「没有通知」）。
     * @returns {{readable:boolean, why:string, rows:Array}}
     */
    _hubRows() {
        const r = this._resolveHub();
        if (!r.ok) return { readable: false, why: r.why, rows: [] };
        let raw;
        try { raw = r.hub.notifications; } catch (_e) { return { readable: false, why: 'read_threw', rows: [] }; }
        if (!Array.isArray(raw)) return { readable: false, why: 'not_array', rows: [] };
        return { readable: true, why: '', rows: raw };
    }
    /**
     * 合并两张表 → 交给视图渲染的唯一入口（视图**不自己去碰**第二张表）。
     * @returns {{rows:Array, counts:object, notes:object}}
     */
    feed() {
        const hub = this._hubRows();
        let logRows = [];
        let logReadable = true;
        try {
            logRows = this.log.list();
            if (!Array.isArray(logRows)) { logRows = []; logReadable = false; }
        } catch (_e) { logRows = []; logReadable = false; }
        return mergeFeed(logRows, hub.rows, { logReadable, hubReadable: hub.readable, hubWhy: hub.why });
    }
    /**
     * [v4.99.7 · R11-X7] 读当前使用范式（与主屏、洞察 App **同一个键**，没有第二份副本）。
     * 读不到 / 解析失败 / 宿主没装配 storage 一律退回内核默认（内置「生活」档）——
     *   通知中心不能因为一个坏键就整片空白。但**读不到这件事本身要能被说出**：
     *   返回 `{ok, why, paradigm}`，`ok:false` 时界面按「范式没读到，本次不隐藏任何通知」呈现，
     *   不能静默当成「生活档」——那会让「范式系统坏了」伪装成「你现在是生活档」。
     */
    _resolveParadigm() {
        const key = NOTICE_PARADIGM_KEY;
        let st = null;
        try { st = this.storage || (typeof window !== 'undefined' ? window.VirtualPhone?.storage : null); } catch (_e) { st = null; }
        if (!st || typeof st.get !== 'function') {
            return { ok: false, why: 'no_storage', paradigm: this._defaultParadigm(), key };
        }
        let raw = null;
        try { raw = st.get(key); } catch (_e) { return { ok: false, why: 'read_threw', paradigm: this._defaultParadigm(), key }; }
        if (raw === null || raw === undefined || raw === '') {
            /* 键还没写过 = 用户没切过范式。这是**正常初态**，不是读不到。 */
            return { ok: true, why: 'unset', paradigm: this._defaultParadigm(), key };
        }
        let obj = raw;
        if (typeof raw === 'string') {
            try { obj = JSON.parse(raw); } catch (_e) { return { ok: false, why: 'parse_threw', paradigm: this._defaultParadigm(), key }; }
        }
        try {
            const p = resolveActiveParadigm(obj);
            if (!p) return { ok: false, why: 'resolve_null', paradigm: this._defaultParadigm(), key };
            return { ok: true, why: '', paradigm: p, key };
        } catch (_e) {
            return { ok: false, why: 'resolve_threw', paradigm: this._defaultParadigm(), key };
        }
    }
    /** 内核默认范式（内置「生活」档）。取不到就给一个 `null`，由内核自己回落 —— 不硬编码第二份。 */
    _defaultParadigm() {
        try { return resolveActiveParadigm(null); } catch (_e) { return null; }
    }
    /**
     * [v4.99.7 · R11-X7] 把 `feed()` 的行按当前范式分「留下 / 被隐藏」。
     * @param {Array} rows `feed().rows`
     * @returns {{rows:Array, hidden:Array, applied:boolean, threshold:string, fallback:boolean,
     *            ok:boolean, why:string, paradigm:{ok:boolean,why:string,paradigm:object|null},
     *            counts:{total:number,visible:number,hidden:number}}}
     *   两处失败必须与「没隐藏」区分开：
     *     · 范式**读不到** → `paradigm.ok:false`，此时**不隐藏任何通知**（applied:false），
     *       界面写成「范式没读到，本次不过滤」而不是「你现在是生活档」；
     *     · 过滤**自己抛错** → `ok:false` + `why`，界面明写「过滤失效，已全量显示」。
     */
    splitByParadigm(rows) {
        const list = Array.isArray(rows) ? rows : [];
        const pr = this._resolveParadigm();
        if (!pr.ok) {
            return {
                rows: list.slice(), hidden: [], applied: false, threshold: 'all', fallback: false,
                ok: true, why: '', paradigm: pr,
                counts: { total: list.length, visible: list.length, hidden: 0 }
            };
        }
        const s = splitNoticesByParadigm(list, pr.paradigm);
        return {
            rows: s.visible, hidden: s.hidden, applied: s.applied, threshold: s.threshold,
            fallback: s.fallback, ok: s.ok, why: s.why, paradigm: pr, counts: s.counts
        };
    }
    /**
     * [v4.99.7 · R11-X7] 按 id 反查一条（**只读**，映射走桥的同一份纯函数）。
     *   为什么放在 App 而不是视图：视图不许 import 桥（v41000 F1：映射只能有一处）。
     *   三条不变量：
     *     ① `hub_` 前缀走中枢那张表，其它走落账层；
     *     ② 找不到如实 null，**不补空壳**（补空壳会让「组内成员丢了」看起来正常）；
     *     ③ 读抛错也当找不到（同上，不抛给渲染层 —— 渲染层抛错会整片白屏）。
     * @param {string} id
     * @returns {object|null}
     */
    rowById(id) {
        const key = String(id || '');
        if (!key) return null;
        if (/^hub_/.test(key)) {
            const raw = key.replace(/^hub_/, '');
            if (!raw) return null;
            const r = this._resolveHub();
            if (!r.ok) return null;
            let list = null;
            try { list = r.hub.notifications; } catch (_e) { return null; }
            if (!Array.isArray(list)) return null;
            const found = list.find(n => n && String(n.id) === raw);
            return found ? mapHubNotification(found) : null;
        }
        try {
            const rows = this.log.list();
            if (!Array.isArray(rows)) return null;
            return rows.find(n => n && String(n.id) === key) || null;
        } catch (_e) { return null; }
    }
    /** [v4.99.0 · R11-X6] 中枢那张表的标记已读（写回**别人家**的表，故单独一个口）。 */
    ackHub(id) {
        const raw = String(id || '').replace(/^hub_/, '');
        if (!raw) return false;
        const r = this._resolveHub();
        if (!r.ok) return false;
        try {
            const target = r.hub.notifications.find(n => String(n.id) === raw);
            if (!target) return false;
            target.read = true;
            if (typeof r.hub._save === 'function') r.hub._save();
            return true;
        } catch (_e) { return false; }
    }

    _resolveLog() {
        try {
            const shared = globalThis?.window?.VirtualPhone?.notificationLog;
            if (shared && typeof shared.push === 'function') return shared;
        } catch (_e) { /* 忽略 */ }
        const log = new NotificationLog(this.storage, { key: 'sys_notifs', limit: 200 });
        try {
            if (globalThis?.window?.VirtualPhone) globalThis.window.VirtualPhone.notificationLog = log;
        } catch (_e) { /* 忽略 */ }
        return log;
    }

    /** 面板样式（跟随手机主题变量，深色毛玻璃） */
    css() {
        return `<style>
        .nc-wrap { display:flex; flex-direction:column; height:100%; background:var(--phone-bg, #0f1115); color:#e8eaed; }
        .nc-topbar { display:flex; align-items:center; justify-content:space-between; padding:14px 16px 8px; }
        .nc-title { font-size:19px; font-weight:700; letter-spacing:.5px; }
        .nc-actions { display:flex; gap:8px; }
        .nc-act { width:32px; height:32px; border-radius:50%; border:none; background:rgba(255,255,255,.08); color:#c9ccd1; cursor:pointer; }
        .nc-act:hover { background:rgba(255,255,255,.15); }
        .nc-act.nc-danger:hover { background:rgba(244,67,54,.25); color:#ff8a80; }
        .nc-searchbar { display:flex; align-items:center; gap:8px; margin:4px 16px 8px; padding:8px 12px; border-radius:12px; background:rgba(255,255,255,.07); }
        .nc-searchbar i { color:#8b8f96; font-size:13px; }
        .nc-search { flex:1; border:none; outline:none; background:transparent; color:#e8eaed; font-size:14px; }
        .nc-filters { display:flex; gap:6px; padding:2px 16px 10px; overflow-x:auto; scrollbar-width:none; }
        .nc-filters::-webkit-scrollbar { display:none; }
        .nc-chip { flex:0 0 auto; border:none; border-radius:999px; padding:5px 11px; font-size:12px; background:rgba(255,255,255,.08); color:#c9ccd1; cursor:pointer; display:flex; align-items:center; gap:5px; }
        .nc-chip-on { background:#4c8bf5; color:#fff; }
        .nc-chip-num { font-size:11px; opacity:.75; }
        .nc-flash { margin:0 16px 8px; padding:8px 12px; border-radius:10px; background:rgba(76,139,245,.15); color:#9dc0ff; font-size:12px; }
        .nc-list { flex:1; overflow-y:auto; padding:0 12px 20px; }
        .nc-item { display:flex; gap:10px; padding:11px 10px; border-radius:14px; margin-bottom:6px; background:rgba(255,255,255,.045); position:relative; align-items:flex-start; }
        .nc-item.nc-jumpable { cursor:pointer; }
        .nc-item.nc-jumpable:hover { background:rgba(255,255,255,.09); }
        .nc-item.nc-unread { background:rgba(76,139,245,.10); }
        .nc-avatar { flex:0 0 38px; width:38px; height:38px; border-radius:11px; overflow:hidden; display:flex; align-items:center; justify-content:center; background:rgba(255,255,255,.09); font-size:15px; font-weight:600; }
        .nc-avatar img { width:100%; height:100%; object-fit:cover; }
        .nc-avatar-icon { color:#9aa0a6; }
        .nc-body { flex:1; min-width:0; }
        .nc-row1 { display:flex; justify-content:space-between; gap:8px; align-items:baseline; }
        .nc-name { font-size:13.5px; font-weight:600; color:#f1f3f4; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
        .nc-time { flex:0 0 auto; font-size:11px; color:#8b8f96; }
        .nc-row2 { font-size:12.5px; color:#b6bac0; margin-top:3px; line-height:1.45; word-break:break-word; }
        .nc-row3 { display:flex; align-items:center; gap:8px; margin-top:6px; }
        .nc-apptag { font-size:10.5px; padding:1px 7px; border-radius:999px; background:rgba(255,255,255,.09); color:#9aa0a6; }
        .nc-count { font-size:10.5px; color:#f2b544; }
        .nc-jump { font-size:11px; color:#6ea8fe; margin-left:auto; }
        .nc-del { flex:0 0 auto; width:22px; height:22px; border:none; border-radius:50%; background:transparent; color:#6b6f76; cursor:pointer; font-size:11px; }
        .nc-del:hover { background:rgba(244,67,54,.2); color:#ff8a80; }
        .nc-empty { text-align:center; padding:60px 24px; color:#8b8f96; }
        .nc-empty-icon { font-size:38px; margin-bottom:12px; }
        .nc-empty-title { font-size:14px; color:#c9ccd1; margin-bottom:6px; }
        .nc-empty-sub { font-size:12px; line-height:1.6; }
        /* [v3.85.0 · 拓展计划 R-X1] 行动中心两列（只读 / 需确认）。 */
        .nc-ac { margin:0 16px 10px; padding:10px 12px; border-radius:14px; background:rgba(76,139,245,.08); border:1px solid rgba(76,139,245,.18); }
        .nc-ac-mute { background:rgba(255,255,255,.05); border-color:rgba(255,255,255,.08); }
        .nc-ac-head { font-size:12.5px; font-weight:700; color:#9dc0ff; letter-spacing:.3px; }
        .nc-ac-note { font-size:11.5px; color:#8b8f96; margin-top:5px; line-height:1.5; }
        .nc-ac-lane { margin-top:8px; }
        .nc-ac-lanetitle { font-size:11px; color:#9aa0a6; display:flex; align-items:center; gap:6px; margin-bottom:4px; }
        .nc-ac-lanen { font-size:10px; padding:0 6px; border-radius:999px; background:rgba(255,255,255,.12); }
        .nc-ac-item { display:flex; gap:9px; align-items:flex-start; padding:8px 9px; border-radius:11px; background:rgba(255,255,255,.05); margin-bottom:5px; }
        .nc-ac-icon { flex:0 0 20px; text-align:center; font-size:13px; }
        .nc-ac-body { flex:1; min-width:0; }
        .nc-ac-t1 { font-size:12.5px; font-weight:600; color:#f1f3f4; word-break:break-word; }
        .nc-ac-t2 { font-size:11.5px; color:#b6bac0; margin-top:2px; line-height:1.45; word-break:break-word; }
        .nc-ac-t3 { font-size:10.5px; color:#8b8f96; margin-top:4px; }
        .nc-ac-btns { flex:0 0 auto; display:flex; gap:5px; }
        .nc-ac-btn { border:none; border-radius:8px; padding:4px 9px; font-size:11px; background:rgba(255,255,255,.12); color:#dfe1e5; cursor:pointer; }
        .nc-ac-btn:hover { background:rgba(255,255,255,.22); }
        .nc-ac-open { background:rgba(76,139,245,.35); color:#fff; }
        .nc-ac-btn-off { opacity:.4; cursor:not-allowed; }
        /* [v4.19.0 · R4-O7] 通知按事情收拢的分组壳(与 phone.css 同款)。 */
        .nc-digest-line { padding:6px 16px 4px; font-size:11px; color:#8b8f96; }
        .nc-group { border-radius:14px; margin-bottom:8px; background:rgba(255,255,255,.05); overflow:hidden; }
        .nc-group.nc-unread { background:rgba(76,139,245,.10); }
        .nc-group-head { padding:11px 10px; display:flex; flex-wrap:wrap; gap:6px; align-items:center; }
        .nc-group-ico { flex:0 0 26px; text-align:center; color:#9aa0a6; }
        .nc-group-t1 { flex:1 1 100%; display:flex; align-items:center; gap:7px; flex-wrap:wrap; }
        .nc-group-t2 { flex:1 1 100%; font-size:12.5px; color:#b6bac0; line-height:1.45; word-break:break-word; }
        .nc-group-body { padding:0 8px 8px; }
        .nc-apptag.nc-cross { background:rgba(242,181,68,.18); color:#f2b544; }
        .nc-apptag.nc-muted { background:rgba(255,255,255,.08); color:#8b8f96; }
        /* [v4.99.7 · R11-X7] 被范式隐藏的区块（可展开实名清单）。 */
        .nc-hub-warn { color:#f2b544; }
        .nc-hid { margin:0 16px 10px; padding:8px 10px; border-radius:12px; background:rgba(255,255,255,.05); border:1px dashed rgba(255,255,255,.14); }
        .nc-hid-head { display:flex; align-items:center; gap:7px; flex-wrap:wrap; font-size:11.5px; color:#9aa0a6; }
        .nc-hid-title { color:#c9ccd1; font-weight:600; }
        .nc-hid-sub { flex:1 1 100%; color:#8b8f96; font-size:11px; line-height:1.45; }
        .nc-hid-toggle { margin-left:auto; }
        .nc-hid-body { margin-top:8px; padding-top:6px; border-top:1px solid rgba(255,255,255,.08); opacity:.82; }
        .nc-hid-body .nc-item { background:rgba(255,255,255,.03); }
        </style>`;
    }

    render() {
        this.view.render();
    }
}

export default NotificationCenterApp;