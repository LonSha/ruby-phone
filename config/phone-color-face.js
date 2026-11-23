/* ============================================================
 * config/phone-color-face.js — 手机壳颜色与缩放的「规整面」内核 [v4.199.0]
 * ------------------------------------------------------------
 * 【为什么有这份文件（实测起点，不是推演）】
 *   做 App 重构台账（tools/gen_app_ledger.mjs）时实读 apps/settings/：
 *     · settings-app.js 单文件 **12809 行**，是 apps/ 下最大的一件。
 *     · 其中 149~231 行是一整段**零副作用**的纯函数族：颜色与缩放的
 *       解析 / 规整 / 空间转换，共 7 个函数、83 行。
 *     · 该族不碰 DOM、不读 storage、不发事件，只依赖 7 个文件内常量。
 *
 *   它此前与 227 个箭头函数、13 个具名函数混居在同一个 12809 行文件里，
 *   修改半径不是 1。按 v4.191.0 立下的四件套第一件抽成独立内核。
 *
 * 【本内核锚止的三条立场】
 *   1. **只治「字符串 → 颜色」与「rgb ↔ hsv」两件事**，不碰 DOM。
 *      applyPhoneShellScale / applyGlobalFontScale 两个会写
 *      document.documentElement.style 的函数**刻意不抽** —— 那是副作用面，
 *     抽进来会把「纯函数」这个判据毁掉。它们仍留在 settings-app.js。
 *   2. **默认值收敛到一处**：PHONE_FRAME_COLOR_DEFAULT 只有一个字面量
 *     来源；parsePhoneHexColor 对 3 位 hex 做展开（#abc → #aabbcc），
 *      输出恒为大写 6 位，不合法一律给 null（不给「猜测值」）。
 *   3. **clampPhoneColorNumber 是非有限值的唯一裁定者**：NaN / Infinity
 *      一律落到 min，与仓内 num-face 的「非数给默认」不同族
 *      （那边给调用方默认值，这边给区间下界），刻意不合并。
 *
 *   等价性对拍：见 tests/system-v4199b.test.mjs（逐字等价 + 边界探针）。
 * ========================================================= */
'use strict';

/* ── 文件内常量（原样搬自 settings-app.js 149 行之前） ────────── */
const PHONE_FRAME_COLOR_DEFAULT = '#1a1a1a';

/**
 * Parse a hex color string into canonical `#RRGGBB` upper-case form.
 * 3-digit shorthand is expanded; anything unparseable yields null
 * (never a guessed value).
 * @param {*} v raw value
 * @returns {string|null} canonical hex or null
 */
function parsePhoneHexColor(value) {
    let clean = String(value || '').trim();
    if (!clean) return null;
    if (!clean.startsWith('#')) clean = `#${clean}`;
    if (/^#[0-9a-f]{3}$/i.test(clean)) {
        clean = `#${clean.slice(1).split('').map(char => char.repeat(2)).join('')}`;
    }
    return /^#[0-9a-f]{6}$/i.test(clean) ? clean.toUpperCase() : null;
}

/**
 * Resolve any value to a usable hex color, falling back to the frame
 * default and finally to a hard-coded near-black.
 * @param {*} value raw value
 * @param {string} [fallback] fallback hex, itself normalized
 * @returns {string} canonical `#RRGGBB`
 */
function normalizePhoneHexColor(value, fallback = PHONE_FRAME_COLOR_DEFAULT) {
    return parsePhoneHexColor(value) || parsePhoneHexColor(fallback) || '#1A1A1A';
}

/**
 * Clamp a number into [min, max]; non-finite input falls to `min`
 * (this is the single arbiter for NaN in the color family).
 * @param {*} value raw value
 * @param {number} min lower bound
 * @param {number} max upper bound
 * @returns {number}
 */
function clampPhoneColorNumber(value, min, max) {
    const number = Number(value);
    return Math.min(max, Math.max(min, Number.isFinite(number) ? number : min));
}

/**
 * Hex color to `[r, g, b]` channels in 0..255.
 * @param {*} value hex color
 * @returns {number[]} three channels
 */
function phoneHexToRgb(value) {
    const hex = normalizePhoneHexColor(value).slice(1);
    return [
        Number.parseInt(hex.slice(0, 2), 16),
        Number.parseInt(hex.slice(2, 4), 16),
        Number.parseInt(hex.slice(4, 6), 16)
    ];
}

/**
 * `[r, g, b]` channels to canonical upper-case hex.
 * @param {number[]} rgb three channels
 * @returns {string} canonical `#RRGGBB`
 */
function phoneRgbToHex(rgb) {
    return `#${rgb.map(channel => Math.round(clampPhoneColorNumber(channel, 0, 255)).toString(16).padStart(2, '0')).join('')}`.toUpperCase();
}

/**
 * `[r, g, b]` (0..255) to `{ h, s, v }` with h in 0..360, s/v in 0..1.
 * @param {number[]} rgb three channels
 * @returns {{h: number, s: number, v: number}}
 */
function phoneRgbToHsv(rgb) {
    const [r, g, b] = rgb.map(channel => clampPhoneColorNumber(channel, 0, 255) / 255);
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const delta = max - min;
    let hue = 0;

    if (delta) {
        if (max === r) hue = 60 * (((g - b) / delta) % 6);
        else if (max === g) hue = 60 * (((b - r) / delta) + 2);
        else hue = 60 * (((r - g) / delta) + 4);
    }
    if (hue < 0) hue += 360;

    return {
        h: hue,
        s: max ? delta / max : 0,
        v: max
    };
}

/**
 * `{ h, s, v }` to `[r, g, b]` channels in 0..255.
 * @param {{h: number, s: number, v: number}} hsv
 * @returns {number[]} three channels
 */
function phoneHsvToRgb({ h, s, v }) {
    const hue = ((clampPhoneColorNumber(h, 0, 360) % 360) + 360) % 360;
    const saturation = clampPhoneColorNumber(s, 0, 1);
    const value = clampPhoneColorNumber(v, 0, 1);
    const chroma = value * saturation;
    const x = chroma * (1 - Math.abs(((hue / 60) % 2) - 1));
    const match = value - chroma;
    let channels;

    if (hue < 60) channels = [chroma, x, 0];
    else if (hue < 120) channels = [x, chroma, 0];
    else if (hue < 180) channels = [0, chroma, x];
    else if (hue < 240) channels = [0, x, chroma];
    else if (hue < 300) channels = [x, 0, chroma];
    else channels = [chroma, 0, x];

    return channels.map(channel => (channel + match) * 255);
}

export {
    PHONE_FRAME_COLOR_DEFAULT,
    parsePhoneHexColor,
    normalizePhoneHexColor,
    clampPhoneColorNumber,
    phoneHexToRgb,
    phoneRgbToHex,
    phoneRgbToHsv,
    phoneHsvToRgb
};
