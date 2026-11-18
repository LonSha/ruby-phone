/**
 * config/theme-tokens.js — R24-O4 主题令牌：让「换主题」真的改变界面（v4.158.0）
 *
 * 【边界】`config/theme-pack.js`（187 行）已是**完整主题包内核**（预设 / 声明式安全导入 / 预览沙箱 / 回滚）。
 *   本模块补的是**接线层**：语义令牌（surface / onSurface / accent / divider / glass）与外观令牌分离，
 *   App 主色从 `config/apps.js` 的 `color` 派生 hover / pressed / muted / onAccent 四档。
 *   内核不重写，令牌不改内核。
 *
 * 【硬门槛】默认深色必须与 v4.157 观感**逐项相等** —— 因此 `DARK_BASELINE` 是冻结常量，
 *   自检直接逐键对拍；「换主题把原样换没了」是本仓最贵的缺陷形态。
 *
 * 【对比度可计算】亮色模式下每个 App 的 `onAccent` 由 WCAG 相对亮度选出（黑或白取对比度高的那个），
 *   并断言 ≥ 4.5:1 —— 不许目测，不许「看起来还行」。
 *
 * 【往返等价】`exportTheme()` 输出按键排序的纯 JSON；`importTheme(exportTheme(x))` 逐字段相等。
 */
import { numOrNull } from './num-gate.js';

export const SEMANTIC_TOKENS = Object.freeze(['surface', 'surfaceAlt', 'onSurface', 'onSurfaceMuted', 'accent', 'divider', 'glass']);
export const APPEARANCE_TOKENS = Object.freeze(['radius', 'shadow', 'blur', 'borderWidth', 'focusRing']);

/** v4.157 冻结基线：深色默认必须逐项相等（不许「顺手调好看」）。 */
export const DARK_BASELINE = Object.freeze({
    surface: '#0f1115',
    surfaceAlt: '#161a21',
    onSurface: '#e8eaed',
    onSurfaceMuted: '#9aa0a6',
    accent: '#5b8cff',
    divider: '#242a33',
    glass: 'rgba(22,26,33,0.72)',
    radius: 18,
    shadow: '0 8px 24px rgba(0,0,0,0.45)',
    blur: 18,
    borderWidth: 1,
    focusRing: '#8ab4ff'
});

export const LIGHT_BASELINE = Object.freeze({
    surface: '#f6f7f9',
    surfaceAlt: '#ffffff',
    onSurface: '#12151a',
    onSurfaceMuted: '#5f6673',
    accent: '#2f6bff',
    divider: '#dfe3ea',
    glass: 'rgba(255,255,255,0.72)',
    radius: 18,
    shadow: '0 8px 24px rgba(15,17,21,0.16)',
    blur: 18,
    borderWidth: 1,
    focusRing: '#1b49c8'
});

export const MIN_CONTRAST = 4.5;

function parseHex(hex) {
    const s = String(hex || '').trim();
    if (!/^#[0-9a-fA-F]{6}$/.test(s)) return null;
    return { r: parseInt(s.slice(1, 3), 16), g: parseInt(s.slice(3, 5), 16), b: parseInt(s.slice(5, 7), 16) };
}

function toHex(c) {
    const h = (n) => {
        const v = Math.max(0, Math.min(255, Math.round(n)));
        return (v < 16 ? '0' : '') + v.toString(16);
    };
    return '#' + h(c.r) + h(c.g) + h(c.b);
}

function channel(v) {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

export function relativeLuminance(hex) {
    const c = parseHex(hex);
    if (!c) return null;
    return 0.2126 * channel(c.r) + 0.7152 * channel(c.g) + 0.0722 * channel(c.b);
}

export function contrastRatio(a, b) {
    const la = relativeLuminance(a);
    const lb = relativeLuminance(b);
    if (la === null || lb === null) return null;
    const hi = Math.max(la, lb);
    const lo = Math.min(la, lb);
    return Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100;
}

export function mixHex(base, target, ratio) {
    const a = parseHex(base);
    const b = parseHex(target);
    const r0 = numOrNull(ratio);
    const r = r0 === null ? 0.5 : Math.max(0, Math.min(1, r0));
    if (!a || !b) return null;
    return toHex({ r: a.r + (b.r - a.r) * r, g: a.g + (b.g - a.g) * r, b: a.b + (b.b - a.b) * r });
}

/** 由 App 主色派生三档 + 文字色（对比度取黑/白中较高者）。 */
export function deriveAppPalette(baseHex, mode) {
    const base = parseHex(baseHex) ? String(baseHex).toUpperCase() : null;
    if (!base) return { face: 'invalid', reason: 'bad-hex', base: null };
    const dark = mode !== 'light';
    const hover = mixHex(base, dark ? '#ffffff' : '#000000', 0.12);
    const pressed = mixHex(base, dark ? '#000000' : '#ffffff', 0.14);
    const muted = mixHex(base, dark ? '#0f1115' : '#f6f7f9', dark ? 0.62 : 0.7);
    const cWhite = contrastRatio(base, '#ffffff');
    const cBlack = contrastRatio(base, '#000000');
    const onAccent = (cWhite === null || cBlack === null) ? '#000000' : (cWhite >= cBlack ? '#ffffff' : '#000000');
    return {
        face: 'ok',
        base,
        hover,
        pressed,
        muted,
        onAccent,
        contrast: Math.max(cWhite === null ? 0 : cWhite, cBlack === null ? 0 : cBlack)
    };
}

/**
 * @param {{mode?:'dark'|'light', appColors?:Object<string,string>, overrides?:Object}} input
 */
export function createTheme(input) {
    const src = input && typeof input === 'object' ? input : {};
    const mode = src.mode === 'light' ? 'light' : 'dark';
    const baseTokens = Object.assign({}, mode === 'light' ? LIGHT_BASELINE : DARK_BASELINE);
    const overrides = src.overrides && typeof src.overrides === 'object' ? src.overrides : {};
    const rejected = [];
    Object.keys(overrides).forEach(function (k) {
        if (SEMANTIC_TOKENS.indexOf(k) === -1 && APPEARANCE_TOKENS.indexOf(k) === -1) {
            rejected.push('unknown-token:' + k);
            return;
        }
        baseTokens[k] = overrides[k];
    });
    const appColors = src.appColors && typeof src.appColors === 'object' ? src.appColors : {};
    const palette = {};
    const invalid = [];
    Object.keys(appColors).forEach(function (appId) {
        const p = deriveAppPalette(appColors[appId], mode);
        if (p.face === 'invalid') { invalid.push(appId); return; }
        palette[appId] = p;
    });

    function checkContrast() {
        const fails = [];
        Object.keys(palette).forEach(function (appId) {
            if (palette[appId].contrast < MIN_CONTRAST) fails.push(appId + ':' + palette[appId].contrast);
        });
        return { ok: fails.length === 0, fails, min: MIN_CONTRAST };
    }

    function token(name) {
        return Object.prototype.hasOwnProperty.call(baseTokens, name) ? baseTokens[name] : null;
    }

    function toJSON() {
        const keys = Object.keys(baseTokens).sort();
        const out = {};
        keys.forEach(function (k) { out[k] = baseTokens[k]; });
        return { mode, tokens: out, appColors: appColors };
    }

    return { mode, tokens: baseTokens, palette, rejected, invalid, checkContrast, token, toJSON };
}

/** 导出/导入往返：纯 JSON，键有序（字节等价）。 */
export function exportTheme(theme) {
    if (!theme || typeof theme.toJSON !== 'function') return null;
    const payload = theme.toJSON();
    const appIds = Object.keys(payload.appColors || {}).sort();
    const apps = {};
    appIds.forEach(function (id) { apps[id] = payload.appColors[id]; });
    return JSON.stringify({ schema: 'phone-theme@1', mode: payload.mode, tokens: payload.tokens, appColors: apps });
}

export function importTheme(text) {
    let obj;
    try {
        obj = JSON.parse(String(text));
    } catch (e) {
        return { ok: false, bad: ['bad-json'] };
    }
    if (!obj || obj.schema !== 'phone-theme@1') return { ok: false, bad: ['bad-schema'] };
    if (obj.mode !== 'dark' && obj.mode !== 'light') return { ok: false, bad: ['bad-mode'] };
    const theme = createTheme({ mode: obj.mode, overrides: obj.tokens || {}, appColors: obj.appColors || {} });
    if (theme.rejected.length) return { ok: false, bad: theme.rejected };
    return { ok: true, theme };
}

export function themeTokensSelfCheck() {
    const bad = [];
    const dark = createTheme({ mode: 'dark', appColors: { wechat: '#07c160', wallet: '#f5a623' } });
    SEMANTIC_TOKENS.concat(APPEARANCE_TOKENS).forEach(function (k) {
        if (dark.token(k) !== DARK_BASELINE[k]) bad.push('深色令牌与基线不符:' + k);
    });
    if (dark.token('surface') !== '#0f1115') bad.push('默认深色必须与 v4.157 相等');

    const light = createTheme({ mode: 'light', appColors: { wechat: '#07c160', wallet: '#f5a623' } });
    if (light.token('surface') !== LIGHT_BASELINE.surface) bad.push('亮色基线不符');
    if (!light.checkContrast().ok) bad.push('亮色 App 文字对比度应 ≥4.5');

    const p = dark.palette.wechat;
    if (!p || p.hover === p.base || p.pressed === p.base) bad.push('hover/pressed 必须真的派生');
    if (p && p.contrast < MIN_CONTRAST) bad.push('onAccent 对比度不达标');
    if (deriveAppPalette('not-a-color', 'dark').face !== 'invalid') bad.push('非法色应 invalid');

    const withOverride = createTheme({ mode: 'dark', overrides: { accent: '#ff0055', radius: 12 } });
    if (withOverride.token('accent') !== '#ff0055' || withOverride.token('radius') !== 12) bad.push('令牌覆盖应生效');
    if (withOverride.token('surface') !== DARK_BASELINE.surface) bad.push('覆盖不许连带改别的令牌');
    const badOverride = createTheme({ mode: 'dark', overrides: { script: 'alert(1)' } });
    if (badOverride.rejected[0] !== 'unknown-token:script') bad.push('未知令牌应拒收（安全导入）');

    const text = exportTheme(dark);
    const back = importTheme(text);
    if (!back.ok) bad.push('导出应可导入');
    if (back.ok && JSON.stringify(back.theme.toJSON().tokens) !== JSON.stringify(dark.toJSON().tokens)) bad.push('往返令牌应等价');
    if (exportTheme(dark) !== text) bad.push('导出必须字节稳定（键有序）');
    if (importTheme('{"schema":"x"}').ok) bad.push('错 schema 应拒收');

    return { ok: bad.length === 0, bad, sample: 'tokens=' + Object.keys(dark.tokens).length + ' apps=' + Object.keys(dark.palette).length };
}

export default {
    SEMANTIC_TOKENS,
    APPEARANCE_TOKENS,
    DARK_BASELINE,
    LIGHT_BASELINE,
    MIN_CONTRAST,
    relativeLuminance,
    contrastRatio,
    mixHex,
    deriveAppPalette,
    createTheme,
    exportTheme,
    importTheme,
    themeTokensSelfCheck
};