/* ============================================================
 * screen-adaptive-layout-engine.js — 窄屏自适应与折叠屏/大屏弹性排版适配器
 * [v4.140.0 · 响应式断点、网格排版计算与无缝缩放]
 * [R25-X5 改写] 原先本文件自带一套阈值（768 / 480 / 360），而 `calculateAdaptiveMetrics`
 *   全仓**零调用点** —— 于是「断点」只活在这个文件里，界面从来没按它排过。
 *   现在阈值与三档语义统一在 `config/layout-breaks.js`（唯一真源），本类退化为
 *   **消费者**：只把量测面翻译成外壳要的那几个数，不再自己记数字。
 *   同时废掉旧口径 `Math.max(280, Number(w) || 375)`：那行把「没量到」写成了「375 像素」，
 *   是「读不到冒充默认值」的典型塌陷。现在没量到就返回 `state:'unreadable'`，
 *   宁可让调用方看到「不知道」，也不给它一个假读数。
 * ============================================================ */
import { layoutFace, layoutText, FACE_STATES } from '../config/layout-breaks.js';

export class ScreenAdaptiveLayoutEngine {
    /**
     * 量测面（原样返回内核结果，供需要逐字段判读的调用方使用）。
     * @param {*} screenWidthPx
     * @param {*} screenHeightPx
     */
    measure(screenWidthPx, screenHeightPx) {
        return layoutFace({ width: screenWidthPx, height: screenHeightPx });
    }

    /**
     * 兼容旧调用形状的投影：formFactor / columns / iconPx / fontScale / cssProperties。
     * 读不到尺寸时**不编数**：`formFactor:'unknown'`、`gridColumns:null`、`cssProperties:{}`。
     */
    calculateAdaptiveMetrics(screenWidthPx = undefined, screenHeightPx = undefined) {
        const face = this.measure(screenWidthPx, screenHeightPx);
        if (face.state !== FACE_STATES.measured) {
            return {
                state: face.state,
                reason: face.reason,
                width: null,
                height: null,
                formFactor: 'unknown',
                gridColumns: null,
                iconSizePx: null,
                fontScale: null,
                isNarrowScreen: null,
                cssProperties: {},
                dataAttributes: {},
                text: layoutText(face)
            };
        }
        return {
            state: face.state,
            reason: null,
            width: face.width,
            height: face.height,
            formFactor: face.tier === 'wide' ? 'tablet-landscape'
                : (face.tier === 'compact' ? 'compact-phone-narrow' : 'phone-portrait'),
            tier: face.tier,
            orientation: face.orientation,
            gridColumns: face.homeGridColumns,
            iconSizePx: face.iconSizePx,
            fontScale: face.fontScale,
            isNarrowScreen: face.tier === 'compact',
            twoColumn: face.grid === 'two-column',
            navRailPx: face.navRailPx,
            maxContentWidthPx: face.maxContentWidthPx,
            cssProperties: {
                '--phone-grid-columns': String(face.homeGridColumns),
                '--phone-icon-size': `${face.iconSizePx}px`,
                '--phone-font-scale': String(face.fontScale),
                '--phone-nav-rail': `${face.navRailPx}px`
            },
            dataAttributes: { ...face.attributes },
            text: layoutText(face)
        };
    }
}

if (typeof module !== 'undefined' && module.exports) { module.exports = ScreenAdaptiveLayoutEngine; }
export default ScreenAdaptiveLayoutEngine;