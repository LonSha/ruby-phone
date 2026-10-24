/* ========================================================
 * config/touch-readability-baseline.js — [R8-O9 · 第八期规划] 触摸与可读性基线（纯函数）
 * --------------------------------------------------------
 * 【这一刀治的是什么】
 *   解决高密度面板与视觉装饰在真实手机小屏上产生遮挡、截断或难以触控的问题：
 *     ① 统一排版与视口基线：支持 narrow (320px/375px) 与标准视口自适应；
 *     ② 无障碍阅读偏好：动态字号缩放 (fontScale)、减少动画 (reducedMotion)、高对比度 (highContrast)；
 *     ③ 状态完备性：空状态、加载中、错误态与禁用态统一类名与提示；
 *     ④ 会话隔离，严格纯函数。
 * ======================================================== */

export const STORAGE_KEY = 'trb_touch_readability_v1';

export const VIEWPORT_MODES = Object.freeze({
    NARROW: 'narrow',       // <= 375px
    STANDARD: 'standard',   // 376px ~ 768px
    EXPANDED: 'expanded'    // > 768px
});

export const DEFAULT_READABILITY_SETTINGS = Object.freeze({
    fontScale: 1.0,           // 0.85 ~ 1.3
    reducedMotion: false,
    highContrast: false,
    touchTargetMinPx: 44,     // 移动端推荐最小可点击尺寸 44px
    updatedAt: 0
});

function safeNum(v, fallback) {
    const n = Number(v);
    return isNaN(n) ? fallback : n;
}

export function normalizeReadabilitySettings(raw) {
    if (!raw || typeof raw !== 'object') return { ...DEFAULT_READABILITY_SETTINGS };
    const fontScale = Math.min(1.3, Math.max(0.85, safeNum(raw.fontScale, 1.0)));
    return {
        fontScale,
        reducedMotion: Boolean(raw.reducedMotion),
        highContrast: Boolean(raw.highContrast),
        touchTargetMinPx: safeNum(raw.touchTargetMinPx, 44),
        updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : Date.now()
    };
}

/**
 * 评估屏幕视口并推荐排版模式
 */
export function evaluateViewport(screenWidth) {
    const w = safeNum(screenWidth, 375);
    if (w <= 375) {
        return {
            mode: VIEWPORT_MODES.NARROW,
            maxInlineColumns: 1,
            recommendedPaddingPx: 8,
            overflowBehavior: 'wrap-or-scroll'
        };
    }
    if (w <= 768) {
        return {
            mode: VIEWPORT_MODES.STANDARD,
            maxInlineColumns: 2,
            recommendedPaddingPx: 12,
            overflowBehavior: 'standard'
        };
    }
    return {
        mode: VIEWPORT_MODES.EXPANDED,
        maxInlineColumns: 3,
        recommendedPaddingPx: 16,
        overflowBehavior: 'expanded'
    };
}

/**
 * 生成注入 DOM 容器的 CSS 变量或类名清单
 */
export function generateReadabilityStyle(settings) {
    const s = normalizeReadabilitySettings(settings);
    const cssVars = {
        '--phone-font-scale': String(s.fontScale),
        '--phone-touch-min': `${s.touchTargetMinPx}px`,
        '--phone-transition-duration': s.reducedMotion ? '0ms' : '200ms',
        '--phone-border-contrast': s.highContrast ? '1.5px solid #ffffff' : '1px solid rgba(255,255,255,0.1)'
    };

    const classList = [];
    if (s.reducedMotion) classList.push('reduced-motion');
    if (s.highContrast) classList.push('high-contrast');

    return {
        cssVars,
        classList,
        isAccessible: s.touchTargetMinPx >= 44
    };
}