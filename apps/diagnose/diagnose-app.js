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
/* [v3.4.2 · F-5] 沉默降级告警面：控制器也接一份 —— 让「宿主/其它 App 直接调 collect()」
 *   这条路同样能拿到沉默告警（此前只有视图渲染这条路有）。这两条路的分工与本文件顶部
 *   说明一致：视图负责渲染，控制器负责对外提供读数出口。 */
import { silenceAlerts, silenceSummary } from '../../config/silence-guard.js';

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
        /* [v3.5.1 · F-8] 存档健康面要读 storage（P-4 的两个只读裁定出口）；
         *   本 App 不自持副本，直接把宿主注入的那个实例传下去（纯读，不写）。 */
        return collectDiagnose(null, this.storage);
    }

    /** 一行总述（供宿主诊断与通知） */
    summaryLine() {
        try { return summarizeDiagnose(this.collect()); }
        catch (_e) { return '诊断读数失败（已降级）'; }
    }

    /**
     * [v3.4.2 · F-5] 沉默降级告警（供宿主诊断 / 其它 App / 测试）。
     *   为什么要在控制器上也开这个出口：视图那条路只有在**用户真的打开诊断页**时才走，
     *   而「沉默」这件事恰恰是「用户不会主动去看」的那类问题 —— 宿主若要在别处
     *   （例如统一的健康检查）读它，需要一个不经视图的出口。
     *   本方法**只读**：不记账（记账在渲染路径上做，避免同一轮被记两次），
     *   只按当轮读数 + 既有台账算告警。
     */
    silenceAlerts(pkg) {
        try {
            /* 取数走模块函数、**不经实例方法**：实例方法那个名字是 v299 F4 负控制的
             *   「恰好命中一次」锚点（那条判的是「改回 snapshot 命名 ⇒ J2 红灯」），
             *   在这里多一处调用会让锚点变成歧义 —— 锚点歧义在负控制里等于判据脆化。
             *   另：注释里也**不引那个标识符形**（引了同样会被锚点扫描数到）。
             *   本方法也支持调用方把已取好的包直接传进来（诊断视图就是这么用的），
             *   避免同一次渲染里取两遍数。 */
            const p = pkg || collectDiagnose(null, this.storage);
            return silenceAlerts(typeof window !== 'undefined' ? window : null, p);
        } catch (_e) { return []; }
    }

    /** 沉默告警的一句话总述（无告警时为空串 —— 不给「一切正常」的绿灯结论） */
    silenceSummaryLine() {
        return silenceSummary(this.silenceAlerts());
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
