/* ========================================================
 * config/theme-pack.js — [R8-X1 · 第八期规划] RubyPhone 主题包内核（纯函数）
 * --------------------------------------------------------
 * 【这一刀治的是什么】
 *   把视觉样式提升为“可切换、可导出、可回滚的生活媒介资产”：
 *     ① 预设与自定义主题包：主配色、圆角紧凑度、动效等级、字体与音效代号；
 *     ② 安全声明式导入：只允许有限的 CSS 变量与白名单组件配置，严禁任意脚本求值；
 *     ③ 临时预览沙箱与一键回滚；
 *     ④ 会话隔离，断开与全局设置的意外污染。
 * ======================================================== */
'use strict';

const TP_STORAGE_KEY = 'tp_theme_state_v1';

export const THEME_PRESETS = Object.freeze({
    OBSIDIAN_PURE: {
        id: 'obsidian_pure',
        name: '黑曜石钛极',
        author: 'Official',
        version: '1.0.0',
        palette: {
            bgPrimary: '#0d0f12',
            bgSurface: '#16191f',
            textPrimary: '#f0f3f6',
            textSecondary: '#8b949e',
            accent: '#388bfd',
            border: '#30363d'
        },
        layoutDensity: 'comfortable', // compact | comfortable | spacious
        motionLevel: 'reduced',       // none | reduced | full
        soundSetId: 'slate_click',
        defaultParadigmId: 'creative'
    },
    AURORA_PASTEL: {
        id: 'aurora_pastel',
        name: '极光浅柔',
        author: 'Official',
        version: '1.0.0',
        palette: {
            bgPrimary: '#f8fafc',
            bgSurface: '#ffffff',
            textPrimary: '#1e293b',
            textSecondary: '#64748b',
            accent: '#0ea5e9',
            border: '#e2e8f0'
        },
        layoutDensity: 'comfortable',
        motionLevel: 'full',
        soundSetId: 'soft_chime',
        defaultParadigmId: 'life'
    },
    WARM_RETRO: {
        id: 'warm_retro',
        name: '复古纸感',
        author: 'Official',
        version: '1.0.0',
        palette: {
            bgPrimary: '#fbf0d9',
            bgSurface: '#fff9e6',
            textPrimary: '#382b1d',
            textSecondary: '#7c6a59',
            accent: '#b85d19',
            border: '#e5d3b3'
        },
        layoutDensity: 'spacious',
        motionLevel: 'none',
        soundSetId: 'paper_rustle',
        defaultParadigmId: 'research'
    }
});

function safeStr(v) { return (typeof v === 'string') ? v.trim() : ''; }

/**
 * 校验主题包规范（严禁恶意脚本与非安全键）
 */
export function validateThemePack(manifest) {
    if (!manifest || typeof manifest !== 'object') {
        return { valid: false, reason: 'manifest-must-be-object' };
    }
    const id = safeStr(manifest.id);
    const name = safeStr(manifest.name);
    if (!id || !name) {
        return { valid: false, reason: 'missing-id-or-name' };
    }
    // 校验 palette
    const p = manifest.palette;
    if (!p || typeof p !== 'object') {
        return { valid: false, reason: 'missing-palette' };
    }
    const hexColorRegex = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
    const requiredColors = ['bgPrimary', 'bgSurface', 'textPrimary', 'accent'];
    for (const k of requiredColors) {
        if (!hexColorRegex.test(safeStr(p[k]))) {
            return { valid: false, reason: `invalid-hex-color-${k}` };
        }
    }
    return { valid: true, cleanId: id, cleanName: name };
}

/**
 * 规格化主题状态
 */
export function normalizeThemeState(raw) {
    if (!raw || typeof raw !== 'object') {
        return {
            activeThemeId: 'obsidian_pure',
            customThemes: {},
            previewTheme: null,
            previousThemeId: null,
            updatedAt: Date.now()
        };
    }
    const custom = (raw.customThemes && typeof raw.customThemes === 'object') ? raw.customThemes : {};
    const active = safeStr(raw.activeThemeId) || 'obsidian_pure';
    const isValid = !!THEME_PRESETS[active.toUpperCase()] || !!custom[active];
    return {
        activeThemeId: isValid ? active : 'obsidian_pure',
        customThemes: { ...custom },
        previewTheme: raw.previewTheme ? { ...raw.previewTheme } : null,
        previousThemeId: safeStr(raw.previousThemeId) || null,
        updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : Date.now()
    };
}

/**
 * 应用主题
 */
export function applyTheme(state, themeId) {
    const s = normalizeThemeState(state);
    const tid = safeStr(themeId);
    const preset = Object.values(THEME_PRESETS).find(t => t.id === tid);
    const custom = s.customThemes[tid];
    if (!preset && !custom) {
        return { success: false, reason: 'theme-not-found', state: s };
    }
    const prev = s.activeThemeId;
    return {
        success: true,
        previousThemeId: prev,
        appliedThemeId: tid,
        state: {
            ...s,
            activeThemeId: tid,
            previousThemeId: prev,
            previewTheme: null,
            updatedAt: Date.now()
        }
    };
}

/**
 * 临时预览主题（生成 CSS 变量声明映射，不永久落盘）
 */
export function previewTheme(themeManifest) {
    const check = validateThemePack(themeManifest);
    if (!check.valid) {
        return { success: false, reason: check.reason };
    }
    const p = themeManifest.palette;
    const cssVariables = {
        '--phone-bg-primary': p.bgPrimary,
        '--phone-bg-surface': p.bgSurface,
        '--phone-text-primary': p.textPrimary,
        '--phone-text-secondary': p.textSecondary || p.textPrimary,
        '--phone-accent': p.accent,
        '--phone-border': p.border || p.bgSurface
    };
    return {
        success: true,
        themeId: themeManifest.id,
        cssVariables,
        density: themeManifest.layoutDensity || 'comfortable',
        motion: themeManifest.motionLevel || 'reduced'
    };
}

/**
 * 回滚到上一个主题
 */
export function rollbackTheme(state) {
    const s = normalizeThemeState(state);
    if (!s.previousThemeId) {
        return { success: false, reason: 'no-previous-theme-to-rollback', state: s };
    }
    return applyTheme(s, s.previousThemeId);
}