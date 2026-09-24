/* ========================================================
 * diagnose-app.js - 诊断中心 · 控制器 [v2.99.0]
 * --------------------------------------------------------
 * 与 place-app.js 同构：不持有任何读数副本，每次 render 现取。
 * 为什么刻意不缓存：本仓治理过多轮「读数停在旧值」的形态（v2.77 生活事件、
 * v2.81 搜索索引、v2.91 桌面角标）。诊断页的读数如果缓存，
 * 就会把「刚才好好的」当成「现在也好好的」。
 *
 * 本 App **不使用任何 storage 键**（有意为之）：它不持久化任何状态，
 * 因此不需要登记会话隔离键，也不参与换会话重绑。
 * ======================================================== */
'use strict';

import { DiagnoseView } from './diagnose-view.js';
import { collectDiagnose, summarizeDiagnose } from './diagnose-data.js';

export class DiagnoseApp {
    constructor(phoneShell, storage) {
        this.phoneShell = phoneShell;
        this.storage = storage;
        this.view = new DiagnoseView(this);
    }

    /**
     * 一次性取齐五面读数（供宿主/其它 App/测试直接调用；纯读）。
     * 方法名刻意**不叫 snapshot**：本仓第九道门（bridge-contract）把产品代码里
     * 的 `.snapshot(` 一律判为「调用式读桥」（推送型桥的 snapshot 是对象，
     * 调它必抛 TypeError），而本方法与桥无关。命名服从门禁口径，避免
     * 「真违规被噪声淹没」。
     */
    collect() {
        return collectDiagnose();
    }

    /** 一行总述（供宿主诊断与通知） */
    summaryLine() {
        try { return summarizeDiagnose(this.collect()); }
        catch (_e) { return '诊断读数失败（已降级）'; }
    }

    /**
     * 换会话 / 清数据：本 App 不持有任何副本，无需重绑。
     * 保留空实现是为了让它落进懒加载 App 重绑表（三条路径共用同一入口）。
     */
    onChatChanged() {
        /* 无状态：下帧现取 */
    }

    /** 无常驻资源（无监听器/定时器/域） */
    deactivate() {
        /* 无资源需回收 */
    }

    render() {
        this.view.render(this.phoneShell?.screen);
    }
}

export default DiagnoseApp;
