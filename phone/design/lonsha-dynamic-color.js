/* ============================================================
 * lonsha-dynamic-color.js — 动态取色（Material You 式）v1.0 · 双仓共享
 * ------------------------------------------------------------
 * 灵感：Android 12+ Material You「从壁纸取色 -> 生成色调（tone）色阶」。只借思路，不含任何
 * Google 资产或算法源码；色彩空间用 OKLCH（感知均匀，派生的明暗层次更稳）。
 *
 * 用法（经典脚本或 ESM 侧效导入均可；挂到 globalThis.LonShaDynamicColor）：
 *   const seed = await LonShaDynamicColor.seedFromImage(urlOrImg);   // -> '#7c5cbf' | null
 *   const pal  = LonShaDynamicColor.palette(seed);                    // { seed, light:{...}, dark:{...} }
 *   LonShaDynamicColor.apply(rootEl, pal);                            // 写入 --lt-dyn-{l,d}-* 与 --lt-dyn-seed
 *   LonShaDynamicColor.clear(rootEl);
 * 约束：
 *   · 只写自定义属性，不改任何结构样式；token 消费方（themes/material-you.css）决定怎么用；
 *   · 跨域图片读不到像素（canvas 被污染）时返回 null，调用方应回退到默认主题，不抛错；
 *   · on-primary 用 WCAG 对比度在黑 / 白之间择优，保证 ≥ 4.5:1。
 * ============================================================ */
(function (root) {
    'use strict';
    const VARS = ['primary', 'on-primary', 'container', 'on-container', 'surface', 'surface-2', 'surface-3', 'outline'];

    // ---- sRGB <-> OKLab <-> OKLCH ----
    const toLin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
    const fromLin = (c) => 255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);
    function rgbToOklch(r, g, b) {
        const R = toLin(r), G = toLin(g), B = toLin(b);
        const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
        const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
        const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
        const L = 0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s;
        const a = 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s;
        const bb = 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s;
        const C = Math.sqrt(a * a + bb * bb);
        let H = Math.atan2(bb, a) * 180 / Math.PI; if (H < 0) H += 360;
        return { L, C, H };
    }
    function oklchToRgbRaw(L, C, H) {
        const h = H * Math.PI / 180, a = C * Math.cos(h), b = C * Math.sin(h);
        const l = Math.pow(L + 0.3963377774 * a + 0.2158037573 * b, 3);
        const m = Math.pow(L - 0.1055613458 * a - 0.0638541728 * b, 3);
        const s = Math.pow(L - 0.0894841775 * a - 1.2914855480 * b, 3);
        return [
            fromLin(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
            fromLin(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
            fromLin(-0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s),
        ];
    }
    /** 色域映射：保持明度与色相，逐步降低彩度直到落进 sRGB */
    function oklchToHex(L, C, H) {
        let c = C, rgb = oklchToRgbRaw(L, c, H);
        const inGamut = (v) => v.every(x => x >= -0.5 && x <= 255.5);
        for (let i = 0; i < 24 && !inGamut(rgb); i++) { c *= 0.85; rgb = oklchToRgbRaw(L, c, H); }
        return '#' + rgb.map(x => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, '0')).join('');
    }
    function hexToRgb(hex) {
        const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(hex || '').trim());
        if (!m) return null;
        let h = m[1]; if (h.length === 3) h = h.split('').map(x => x + x).join('');
        return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
    }
    function lum(hex) { const c = hexToRgb(hex); if (!c) return 0; const [r, g, b] = c.map(toLin); return 0.2126 * r + 0.7152 * g + 0.0722 * b; }
    function contrast(a, b) { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); }
    const onColor = (bg) => (contrast(bg, '#000000') >= contrast(bg, '#ffffff') ? '#000000' : '#ffffff');

    /** 从像素数组挑种子色：按色相分 36 桶，权重 = 像素数 × 彩度 × 中明度偏好；全灰图返回 null */
    function seedFromPixels(data, step = 4) {
        const buckets = new Array(36).fill(null).map(() => ({ w: 0, L: 0, C: 0, x: 0, y: 0 }));
        for (let i = 0; i < data.length; i += step * 4) {
            if (data[i + 3] < 128) continue;
            const { L, C, H } = rgbToOklch(data[i], data[i + 1], data[i + 2]);
            if (C < 0.04 || L < 0.18 || L > 0.95) continue;
            const w = C * (1 - Math.abs(L - 0.62));
            const bk = buckets[Math.floor(H / 10) % 36];
            bk.w += w; bk.L += L * w; bk.C += C * w;
            bk.x += Math.cos(H * Math.PI / 180) * w; bk.y += Math.sin(H * Math.PI / 180) * w;
        }
        // 相邻桶合并平滑，避免一张图被拆成两个相近色相
        let best = null, bestW = 0;
        for (let i = 0; i < 36; i++) {
            const a = buckets[(i + 35) % 36], b = buckets[i], c = buckets[(i + 1) % 36];
            const w = a.w * 0.5 + b.w + c.w * 0.5;
            if (w > bestW && b.w > 0) { bestW = w; best = b; }
        }
        if (!best || bestW < 0.5) return null;
        let H = Math.atan2(best.y, best.x) * 180 / Math.PI; if (H < 0) H += 360;
        return oklchToHex(Math.min(0.7, Math.max(0.45, best.L / best.w)), Math.min(0.18, best.C / best.w), H);
    }

    function loadImage(src) {
        return new Promise((resolve, reject) => {
            if (src && typeof src === 'object' && 'naturalWidth' in src) {
                if (src.complete && src.naturalWidth) return resolve(src);
                src.addEventListener('load', () => resolve(src), { once: true });
                src.addEventListener('error', reject, { once: true });
                return;
            }
            const img = new Image();
            img.crossOrigin = 'anonymous';
            img.decoding = 'async';
            img.onload = () => resolve(img);
            img.onerror = reject;
            img.src = String(src || '');
        });
    }
    /** @returns {Promise<string|null>} 种子色 hex；读不到像素（跨域 / 加载失败 / 纯灰）返回 null */
    async function seedFromImage(src, size = 48) {
        try {
            const img = await loadImage(src);
            const cv = document.createElement('canvas');
            cv.width = size; cv.height = size;
            const ctx = cv.getContext('2d', { willReadFrequently: true });
            ctx.drawImage(img, 0, 0, size, size);
            return seedFromPixels(ctx.getImageData(0, 0, size, size).data, 1);
        } catch (_) { return null; }
    }

    /** 由种子色生成浅 / 深两套色阶（tone 取值参照 Material 3 的 40/90/10/98/95/92 与 80/30/90/6/12/17 思路，换算到 OKLCH 明度） */
    function palette(seed) {
        const rgb = hexToRgb(seed);
        if (!rgb) return null;
        const { C, H } = rgbToOklch(rgb[0], rgb[1], rgb[2]);
        const c = Math.max(0.02, C);
        const mk = (L, cc) => oklchToHex(L, Math.min(c, cc), H);
        const light = {
            primary: mk(0.50, 0.17), container: mk(0.92, 0.06), 'on-container': mk(0.28, 0.09),
            surface: mk(0.975, 0.012), 'surface-2': mk(0.94, 0.02), 'surface-3': mk(0.90, 0.026), outline: mk(0.62, 0.03),
        };
        const dark = {
            primary: mk(0.80, 0.13), container: mk(0.33, 0.07), 'on-container': mk(0.90, 0.05),
            surface: mk(0.17, 0.012), 'surface-2': mk(0.22, 0.018), 'surface-3': mk(0.27, 0.022), outline: mk(0.55, 0.03),
        };
        // 浅色 primary 对白底不足 4.5:1 时压暗；深色 primary 对深底不足时提亮
        for (let L = 0.50; contrast(light.primary, '#ffffff') < 4.5 && L > 0.3; L -= 0.03) light.primary = mk(L, 0.17);
        for (let L = 0.80; contrast(dark.primary, dark.surface) < 4.5 && L < 0.95; L += 0.03) dark.primary = mk(L, 0.13);
        light['on-primary'] = onColor(light.primary);
        dark['on-primary'] = onColor(dark.primary);
        return { seed: oklchToHex(0.6, Math.min(c, 0.17), H), hue: Math.round(H), light, dark };
    }

    function apply(el, pal) {
        if (!el || !pal) return false;
        el.style.setProperty('--lt-dyn-seed', pal.seed);
        for (const k of VARS) {
            if (pal.light[k]) el.style.setProperty('--lt-dyn-l-' + k, pal.light[k]);
            if (pal.dark[k]) el.style.setProperty('--lt-dyn-d-' + k, pal.dark[k]);
        }
        el.setAttribute('data-lt-dyn', String(pal.hue));
        return true;
    }
    function clear(el) {
        if (!el) return;
        el.style.removeProperty('--lt-dyn-seed');
        for (const k of VARS) { el.style.removeProperty('--lt-dyn-l-' + k); el.style.removeProperty('--lt-dyn-d-' + k); }
        el.removeAttribute('data-lt-dyn');
    }

    const api = { version: '1.0.0', seedFromImage, seedFromPixels, palette, apply, clear, contrast, rgbToOklch, oklchToHex };
    if (typeof module === 'object' && module.exports) module.exports = api;
    root.LonShaDynamicColor = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
