/* ============================================================
 * screen-adaptive-layout-engine.js — 窄屏自适应与折叠屏/大屏弹性排版适配器
 * [v4.140.0 · 响应式断点、网格排版计算与无缝缩放]
 * ============================================================ */

export class ScreenAdaptiveLayoutEngine {
    calculateAdaptiveMetrics(screenWidthPx = 375, screenHeightPx = 667) {
        const w = Math.max(280, Number(screenWidthPx) || 375);
        const h = Math.max(400, Number(screenHeightPx) || 667);
        
        let formFactor = "phone-portrait";
        let columns = 4;
        let iconPx = 48;
        let fontScale = 1.0;
        let isNarrow = false;

        if (w > 768) {
            formFactor = "tablet-landscape";
            columns = 6;
            iconPx = 64;
            fontScale = 1.15;
        } else if (w > 480) {
            formFactor = "phone-foldable-unfolded";
            columns = 5;
            iconPx = 56;
            fontScale = 1.05;
        } else if (w < 360) {
            formFactor = "compact-phone-narrow";
            columns = 3;
            iconPx = 42;
            fontScale = 0.90;
            isNarrow = true;
        }

        return {
            width: w,
            height: h,
            formFactor,
            gridColumns: columns,
            iconSizePx: iconPx,
            fontScale,
            isNarrowScreen: isNarrow,
            cssProperties: {
                "--phone-grid-columns": String(columns),
                "--phone-icon-size": `${iconPx}px`,
                "--phone-font-scale": String(fontScale)
            }
        };
    }
}
if (typeof globalThis !== "undefined") { globalThis.ScreenAdaptiveLayoutEngine = ScreenAdaptiveLayoutEngine; }
if (typeof window !== "undefined") { window.ScreenAdaptiveLayoutEngine = ScreenAdaptiveLayoutEngine; }
if (typeof module !== "undefined" && module.exports) { module.exports = ScreenAdaptiveLayoutEngine; }
export default ScreenAdaptiveLayoutEngine;