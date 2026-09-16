/* ========================================================
 * notification-center-app.js — 通知中心 App 控制器 [v2.16.0]
 * --------------------------------------------------------
 * 依赖注入：NotificationLog 由共享运行日志（window.VirtualPhone.notificationLog）
 *   优先接管；若宿主尚未安装，则自建一个（保证 App 单独打开也工作）。
 * 样式：css() 提供面板样式，由 PhoneShell.setContent 注入到视图内。
 * ======================================================== */
'use strict';

import { NotificationLog } from '../../config/system-notifications.js';
import { NotificationCenterView } from './notification-center-view.js';

export class NotificationCenterApp {
    constructor(phoneShell, storage) {
        this.phoneShell = phoneShell;
        this.storage = storage;
        this.VIEW_ID = 'notifications-main';
        this.view = new NotificationCenterView(this);
        // 优先复用宿主共享的落账层（showNotification 写入的同一份）
        this.log = this._resolveLog();
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
        </style>`;
    }

    render() {
        this.view.render();
    }
}

export default NotificationCenterApp;