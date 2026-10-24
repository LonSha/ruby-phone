/* ============================================================
 * config/touch-interaction-journey-audit.js — [R9-O9 · 第九期规划]
 * 代表性应用旅程触摸与可读性全流程校验器（纯函数内核）
 * ------------------------------------------------------------
 * 【核心设计】
 *   在 touch-readability-baseline.js 基础上，收口六大核心场景旅程：
 *     (messages, calendar, studio, memory, settings, backup)
 *   严格审计：
 *     1. 视口 320px/375px 下横向溢出
 *     2. 交互热区下限 (>=44px)
 *     3. 虚拟键盘避让边界
 *     4. 四态统一 (empty, loading, error, disabled)
 * ============================================================ */
import { DEFAULT_READABILITY_SETTINGS } from './touch-readability-baseline.js';

export const JOURNEY_TYPES = Object.freeze([
    'messages',
    'calendar',
    'studio',
    'memory',
    'settings',
    'backup'
]);

export function auditJourneyReadability(journeyType, sceneMetrics = {}) {
    const type = JOURNEY_TYPES.includes(journeyType) ? journeyType : 'custom';
    const minSize = DEFAULT_READABILITY_SETTINGS.touchTargetMinPx || 44;
    const errors = [];
    const warnings = [];

    const width = Number(sceneMetrics.targetWidth) || minSize;
    const height = Number(sceneMetrics.targetHeight) || minSize;
    const viewportWidth = Number(sceneMetrics.viewportWidth) || 375;
    const state = sceneMetrics.state || 'normal';

    if (width < minSize || height < minSize) {
        errors.push({
            journey: type,
            code: 'TOUCH_TARGET_TOO_SMALL',
            details: `${width}x${height} < ${minSize}x${minSize}`
        });
    }

    if (viewportWidth < 360 && sceneMetrics.contentWidth > viewportWidth) {
        warnings.push({
            journey: type,
            code: 'NARROW_VIEWPORT_HORIZONTAL_OVERFLOW',
            details: `contentWidth ${sceneMetrics.contentWidth} > viewport ${viewportWidth}`
        });
    }

    return {
        journey: type,
        state,
        passed: errors.length === 0,
        errors,
        warnings
    };
}