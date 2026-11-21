/* ========================================================
 * phone/theme-controller.js — RubyPhone 明暗 / 主题包 / 设计系统开关（ESM）v3.4
 * v3.4：无行为改动。皮肤运行时 v3.4 自己按需加载逐站点内联映射表（phone/ui/rp-inline-map-v3.4.js），
 *   getSkinReport() 的读数多出 classified / distinctClassified / inlineMap 三项；层序（LAYER_ORDER）只写顶层，子层由 rp-entry.css 第二行决定。
 * --------------------------------------------------------
 * v3.3 新增（向后兼容，v1 / v2 / v3 的方法与存储键不变；默认关）：
 *     打开 v3（data-rp-ios="3"）时再动态加载 ui/rp-skin-runtime.js：按需加载全部 89 个 App 的 v3 皮肤
 *     （apps/<id>/<id>.v3.css，清单见 config/style-skin-v3.js），收编未分层的 App 样式、降级装饰性内联样式、
 *     把界面外壳里的 emoji / 字符图标换成 SVG；关掉 v3 时整体撤销。
 *     新方法：ensureAppSkin(appId)（openApp 时调用可提前取皮肤，避免先裸画一帧）、getSkinReport()。
 *     层序新增 rp.skins（在 rp.apps 与 rp.themes 之间）：皮肤压得住 App 样式，主题包和用户自定义 CSS 仍然压得住皮肤。
 * v3 新增（向后兼容，v1 / v2 的方法与存储键不变；全部默认关）：
 *     data-rp-ios="3"                    iOS 26 液态玻璃 / iPhone 18 Pro Max 拟真外观 -> enableIosV3(true)（会顺带打开 v2 与 DS2）
 *     data-rp3-icons="default|dark|clear" App 图标样式 -> setIconStyle('clear')
 *     打开 v3 时动态加载 ui/rp-icons-bridge.js，把旧主屏的字符 / 像素图标换成 SVG 图标；关闭时完整撤销
 * v2 新增（全部向后兼容，v1 的方法与存储键不变）：
 *     data-rp-ui="2"                     v2 外观开关（需同时开启 DS2；默认关）-> enableUiV2(true)
 *     data-lt-accent="ice|iris|..."        强调色调色板（共享 token v2）-> setAccent('iris')
 *     data-rp-pack="material-you"        动态取色主题包：从壁纸取种子色 -> refreshDynamicColor()
 *     setDynamicSeed('#7c5cbf')          手动指定种子色（例如角色主题色）
 * --------------------------------------------------------
 * 职责只有一个：把「用户偏好 + 宿主环境」解析成手机根节点上的 3 个属性：
 *     data-rp-ds="2"                    新设计系统开关（灰度期默认关）
 *     data-lonsha-theme="light|dark"    明暗（所有 App 统一跟随，切 App 不再明暗跳变）
 *     data-rp-pack="obsidian|huawei|pixel"  主题包（只覆盖 token）
 * 外加两个工具：
 *     applyCharacterTheme(cssVariables)  把 ThemePackEngine.setActiveCharacter() 的结果映射到 token
 *     layerize(cssText, layer)           给运行时注入的 <style> 包一层 @layer，避免被宿主护盾回退
 *     appCssPath(path)                   灰度期：DS2 开 -> apps/x/x.css（token 版），关 -> x.legacy.css（原文件）
 *
 * 明暗解析顺序（scheme = 'auto' 时）：
 *   ① <html data-lonsha-theme>（LonSha 记忆引擎的 Dashboard 已解析过 ST 主题，双仓同屏一致）
 *   ② SillyTavern 主题背景亮度（--SmartThemeBlurTintColor / body 背景）
 *   ③ prefers-color-scheme
 *
 * 存储键（沿用 VirtualPhone.storage）：
 *   phone-ds-version   '2' 开启新设计系统
 *   phone-theme-scheme 'auto' | 'light' | 'dark'
 *   phone-theme-pack   'default' | 'obsidian' | 'huawei' | 'pixel'
 *
 * 用法（index.js init 里，phone-shell 创建根节点之后）：
 *   import { createThemeController } from './phone/theme-controller.js';
 *   const theme = createThemeController({ storage, getRoots: () => [document.getElementById('phone-panel')] });
 *   theme.start();
 *   window.VirtualPhone.theme = theme;   // 设置 App 里调用 theme.setScheme('dark') / theme.setPack('pixel')
 * ======================================================== */

export const LAYER_ORDER = '@layer rp.reset, rp.tokens, rp.legacy, rp.base, rp.components, rp.apps, rp.skins, rp.themes, rp.user;';
/** v3.3：仓库根地址（皮肤路径相对它；与 index.js 的 ST_PHONE_BASE_URL 同值） */
const RP_BASE_URL = (() => { try { return new URL('../', import.meta.url).href; } catch (_) { return ''; } })();
import './design/lonsha-dynamic-color.js';   // 侧效导入：挂到 globalThis.LonShaDynamicColor（UMD）

export const PACKS = ['default', 'obsidian', 'huawei', 'pixel', 'material-you'];
export const SCHEMES = ['auto', 'light', 'dark'];
export const ACCENTS = ['default', 'ice', 'iris', 'rose', 'jade', 'amber', 'graphite'];
export const ICON_STYLES = ['default', 'dark', 'clear'];

const KEYS = {
    ds: 'phone-ds-version', scheme: 'phone-theme-scheme', pack: 'phone-theme-pack',
    ui: 'phone-ui-version',        // v2：'2' 开启新外观
    accent: 'phone-theme-accent',  // v2：强调色调色板
    seed: 'phone-theme-seed',      // v2：Material You 种子色缓存（hex）
    ios: 'phone-ios-version',      // v3：'3' 开启 iOS 拟真外观
    icons: 'phone-icon-style',     // v3：default | dark | clear
};

function parseRgb(str) {
    const m = /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+))?/.exec(String(str || ''));
    return m ? { r: +m[1], g: +m[2], b: +m[3], a: m[4] == null ? 1 : +m[4] } : null;
}
export function relativeLuminance({ r, g, b }) {
    const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
/** 在给定底色上应使用黑字还是白字（WCAG 对比度更高的一侧） */
export function pickOnColor(bg) {
    const c = typeof bg === 'string' ? (parseRgb(bg) || hexToRgb(bg)) : bg;
    if (!c) return '#ffffff';
    const L = relativeLuminance(c);
    return (L + 0.05) / 0.05 > 1.05 / (L + 0.05) ? '#000000' : '#ffffff';
}
function hexToRgb(hex) {
    const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(hex || '').trim());
    if (!m) return null;
    let h = m[1]; if (h.length === 3) h = h.split('').map(x => x + x).join('');
    return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) };
}

/** 读取宿主（ST）主题明暗；读不到返回 null */
export function detectHostScheme(doc = document) {
    try {
        const htmlAttr = doc.documentElement.getAttribute('data-lonsha-theme');
        if (htmlAttr === 'light' || htmlAttr === 'dark') return htmlAttr;
        const probe = doc.createElement('span');
        probe.style.cssText = 'position:absolute;visibility:hidden;pointer-events:none;color:var(--SmartThemeBlurTintColor, transparent)';
        doc.body.appendChild(probe);
        const tint = parseRgb(getComputedStyle(probe).color);
        probe.remove();
        if (tint && tint.a > 0.05) return relativeLuminance(tint) < 0.35 ? 'dark' : 'light';
        const bg = parseRgb(getComputedStyle(doc.body).backgroundColor);
        if (bg && bg.a > 0.05) return relativeLuminance(bg) < 0.35 ? 'dark' : 'light';
    } catch (_) { /* 非浏览器环境 */ }
    return null;
}

/** 给运行时注入的 CSS 包一层 @layer（带层序声明，顺序更早出现也不会打乱） */
export function layerize(cssText, layer = 'rp.apps', { stripImportant = false } = {}) {
    let css = String(cssText || '');
    if (css.charCodeAt(0) === 0xFEFF) css = css.slice(1);
    if (stripImportant) css = css.replace(/\s*!important/gi, '');
    const hoisted = [];
    css = css.replace(/^\s*@(?:charset|import)[^;]+;\s*$/gm, (m) => { hoisted.push(m.trim()); return ''; });
    return `${hoisted.join('\n')}\n${LAYER_ORDER}\n@layer ${layer} {\n${css}\n}\n`;
}

/** 从根节点里找当前壁纸地址：.wallpaper / .rp-wall / .home-screen 的 background-image 第一张 url() */
export function findWallpaperUrl(root) {
    try {
        const el = root && root.querySelector('.rp-wall, .wallpaper, .home-screen');
        const bg = el ? getComputedStyle(el).backgroundImage : '';
        const m = /url\(["']?([^"')]+)["']?\)/.exec(bg || '');
        return m ? m[1] : null;
    } catch (_) { return null; }
}

export function createThemeController({ storage, getRoots, getWallpaper, doc = (typeof document !== 'undefined' ? document : null) } = {}) {
    const get = (k, d) => { try { const v = storage?.get?.(k); return v == null || v === '' ? d : String(v); } catch (_) { return d; } };
    const set = (k, v) => { try { storage?.set?.(k, v); } catch (_) { /* 忽略 */ } };
    const roots = () => (typeof getRoots === 'function' ? getRoots() : []).filter(Boolean);
    let observers = [];
    let characterVars = null;

    /* 默认值 '1' -> '2'：isIosV3 早已默认 '3'，却卡在这道老闸上，
     * 全新安装时整条 v3 链路（图标桥 / 图标遮罩 / App 皮肤）压根不启动。
     * 显式存过 '1' 的用户仍尊重（回落旧外观）。 */
    const isDs2 = () => get(KEYS.ds, '2') === '2';
    const getScheme = () => { const s = get(KEYS.scheme, 'auto'); return SCHEMES.includes(s) ? s : 'auto'; };
    const getPack = () => { const p = get(KEYS.pack, 'default'); return PACKS.includes(p) ? p : 'default'; };
    const isUiV2 = () => isDs2() && get(KEYS.ui, '2') === '2';   // 同上：默认 '2'
    const getAccent = () => { const a = get(KEYS.accent, 'default'); return ACCENTS.includes(a) ? a : 'default'; };
    /* 设计系统收编：v3 外观**默认开**（新装即生效）；用户显式关过（存 '1'）才回落旧外观。
       判据：默认值从 '1' 改为 '3'，语义仍是「存储值为 '3' 才开」，只是没存过时算开。 */
    const isIosV3 = () => isUiV2() && get(KEYS.ios, '3') === '3';
    const getIconStyle = () => { const s = get(KEYS.icons, 'default'); return ICON_STYLES.includes(s) ? s : 'default'; };
    let iconBridge = null;          // { detach } —— v3 图标桥接（动态加载，默认不加载）
    let iconBridgeToken = 0;
    function syncIconBridge(on) {
        const my = ++iconBridgeToken;
        if (!on) { if (iconBridge) { try { iconBridge(); } catch (_) { /* 忽略 */ } iconBridge = null; } return; }
        if (iconBridge) return;
        import('./ui/rp-icons-bridge.js').then((m) => {
            if (my !== iconBridgeToken || !isIosV3()) return;
            const offs = roots().map((el) => m.attachIosIcons(el));
            iconBridge = () => offs.forEach((f) => f());
        }).catch(() => { /* 非致命：保留原图标 */ });
    }
    /* ---- v3.3：App 皮肤运行时（动态加载，默认不加载；关掉 v3 时完整撤销） ---- */
    let skinRuntimes = null;        // [{ ensure, detach, collect }]
    let skinToken = 0;
    const pendingSkins = new Set();
    function syncSkinRuntime(on) {
        const my = ++skinToken;
        if (!on) {
            if (skinRuntimes) { skinRuntimes.forEach((r) => { try { r.detach(); } catch (_) { /* 忽略 */ } }); skinRuntimes = null; }
            return;
        }
        if (skinRuntimes) return;
        import('./ui/rp-skin-runtime.js').then((m) => {
            if (my !== skinToken || !isIosV3()) return;
            const els = roots().filter((el) => el.id === 'phone-panel');
            skinRuntimes = els.map((el) => m.attachSkinRuntime(el, { doc, baseUrl: RP_BASE_URL, layerize }));
            pendingSkins.forEach((id) => skinRuntimes.forEach((r) => r.ensure(id)));
            pendingSkins.clear();
        }).catch(() => { /* 非致命：没有皮肤，外观停在 v3 */ });
    }
    const DC = () => (typeof globalThis !== 'undefined' ? globalThis.LonShaDynamicColor : null);
    let dynToken = 0;

    /** 把种子色展开成色阶并写到所有根节点；种子无效时清除（回退品牌色） */
    function applySeed(seed) {
        const dc = DC();
        const pal = dc && seed ? dc.palette(seed) : null;
        for (const el of roots()) { if (pal) dc.apply(el, pal); else if (dc) dc.clear(el); }
        return pal;
    }
    /** Material You：从壁纸取色（跨域 / 失败时保留上一次缓存的种子色） */
    async function refreshDynamicColor(src) {
        const my = ++dynToken;
        const url = src || (typeof getWallpaper === 'function' ? getWallpaper() : null) || findWallpaperUrl(roots()[0]);
        const dc = DC();
        let seed = null;
        if (dc && url) seed = await dc.seedFromImage(url);
        if (my !== dynToken) return null;          // 期间又切换了壁纸 / 主题包
        if (seed) set(KEYS.seed, seed); else seed = get(KEYS.seed, '') || null;
        return applySeed(seed);
    }

    function resolveScheme() {
        const pref = getScheme();
        if (pref !== 'auto') return pref;
        const host = doc ? detectHostScheme(doc) : null;
        if (host) return host;
        try { return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'; } catch (_) { return 'dark'; }
    }

    function apply() {
        const scheme = resolveScheme();
        const pack = getPack();
        const ds = isDs2();
        const ui = isUiV2();
        const accent = getAccent();
        const ios = isIosV3();
        const iconStyle = getIconStyle();
        for (const el of roots()) {
            if (ds) el.setAttribute('data-rp-ds', '2'); else el.removeAttribute('data-rp-ds');
            if (ui) el.setAttribute('data-rp-ui', '2'); else el.removeAttribute('data-rp-ui');
            if (ios) el.setAttribute('data-rp-ios', '3'); else el.removeAttribute('data-rp-ios');
            if (ios && iconStyle !== 'default') el.setAttribute('data-rp3-icons', iconStyle); else el.removeAttribute('data-rp3-icons');
            el.setAttribute('data-lonsha-theme', scheme);
            if (pack === 'default') el.removeAttribute('data-rp-pack'); else el.setAttribute('data-rp-pack', pack);
            if (ui && accent !== 'default') el.setAttribute('data-lt-accent', accent); else el.removeAttribute('data-lt-accent');
            applyCharacterVarsTo(el);
        }
        if (pack === 'material-you') {
            const cached = get(KEYS.seed, '');
            if (cached) applySeed(cached);           // 先用缓存，避免闪一下品牌色
            refreshDynamicColor().catch(() => { /* 非致命 */ });
        } else if (DC()) {
            for (const el of roots()) DC().clear(el);
        }
        syncIconBridge(ios);
        syncSkinRuntime(ios);
        return { scheme, pack, ds, ui, accent, ios, iconStyle };
    }

    function applyCharacterVarsTo(el) {
        const names = ['--app-accent', '--app-on-accent', '--rp-bubble-me-bg', '--rp-bubble-me-fg'];
        if (!characterVars) { names.forEach(n => el.style.removeProperty(n)); return; }
        const accent = characterVars['--phone-primary'];
        if (accent) {
            el.style.setProperty('--app-accent', accent);
            el.style.setProperty('--app-on-accent', pickOnColor(accent));
        }
        /* bgColor / bubbleColor 是角色主题给的「深色底」：只在深色模式下采用，浅色模式下仍走 token，
           否则浅色 ST 主题里会嵌进一块写死的深色手机（旧版问题的根因之一）。 */
        if (el.getAttribute('data-lonsha-theme') === 'dark' && characterVars['--phone-bubble']) {
            el.style.setProperty('--rp-bubble-me-bg', accent || characterVars['--phone-bubble']);
            el.style.setProperty('--rp-bubble-me-fg', pickOnColor(accent || characterVars['--phone-bubble']));
        } else {
            el.style.removeProperty('--rp-bubble-me-bg');
            el.style.removeProperty('--rp-bubble-me-fg');
        }
    }

    function start() {
        stop();
        apply();
        if (!doc || typeof MutationObserver === 'undefined') return;
        // ① <html data-lonsha-theme> 被记忆引擎改写；② ST 切主题改 body/html 的 style/class
        const mo = new MutationObserver(() => { if (getScheme() === 'auto') apply(); });
        mo.observe(doc.documentElement, { attributes: true, attributeFilter: ['data-lonsha-theme', 'style', 'class'] });
        if (doc.body) mo.observe(doc.body, { attributes: true, attributeFilter: ['style', 'class'] });
        observers.push(() => mo.disconnect());
        try {
            const mq = matchMedia('(prefers-color-scheme: dark)');
            const h = () => { if (getScheme() === 'auto') apply(); };
            mq.addEventListener('change', h);
            observers.push(() => mq.removeEventListener('change', h));
        } catch (_) { /* 旧浏览器 */ }
    }
    function stop() { syncIconBridge(false); syncSkinRuntime(false); observers.forEach(fn => { try { fn(); } catch (_) { /* 忽略 */ } }); observers = []; }

    return {
        start,
        stop,
        apply,
        resolveScheme,
        isDesignSystemV2: isDs2,
        enableDesignSystemV2(on = true) { set(KEYS.ds, on ? '2' : '1'); return apply(); },
        getScheme,
        setScheme(s) { set(KEYS.scheme, SCHEMES.includes(s) ? s : 'auto'); return apply(); },
        getPack,
        setPack(p) { set(KEYS.pack, PACKS.includes(p) ? p : 'default'); return apply(); },
        /* ---- v2 ---- */
        isUiV2,
        enableUiV2(on = true) { set(KEYS.ui, on ? '2' : '1'); if (on && !isDs2()) set(KEYS.ds, '2'); return apply(); },
        getAccent,
        setAccent(a) { set(KEYS.accent, ACCENTS.includes(a) ? a : 'default'); return apply(); },
        refreshDynamicColor,
        /* ---- v3 ---- */
        isIosV3,
        enableIosV3(on = true) { set(KEYS.ios, on ? '3' : '1'); if (on) { set(KEYS.ui, '2'); set(KEYS.ds, '2'); } return apply(); },
        getIconStyle,
        setIconStyle(s) { set(KEYS.icons, ICON_STYLES.includes(s) ? s : 'default'); return apply(); },
        /* ---- v3.3 ---- */
        /** openApp 时调用：v3 打开则立刻并行取该 App 的皮肤；v3 关着什么也不做（返回 null） */
        ensureAppSkin(appId) {
            if (!isIosV3()) return Promise.resolve(null);
            if (!skinRuntimes) { pendingSkins.add(String(appId || '')); return Promise.resolve(null); }
            return Promise.all(skinRuntimes.map((r) => r.ensure(appId))).then((rs) => rs[0] || null);
        },
        /** 诊断读数：皮肤加载回执 / 收编 / 降级 / 字符图标计数；v3 关着返回 { attached: false } */
        getSkinReport() { return skinRuntimes && skinRuntimes[0] ? skinRuntimes[0].collect() : { attached: false }; },
        setDynamicSeed(hex) { set(KEYS.seed, hex || ''); return applySeed(hex || null); },
        /** @param {Record<string,string>|null} vars ThemePackEngine.setActiveCharacter().cssVariables */
        applyCharacterTheme(vars) { characterVars = vars && typeof vars === 'object' ? { ...vars } : null; return apply(); },
        layerize,
        /** 灰度期 App 样式路由：新设计系统开时用 token 版（xxx.css），关时用旧版（xxx.legacy.css） */
        appCssPath(path) {
            const p = String(path || '');
            if (isDs2()) return p;
            return /\.legacy\.css(\?|$)/.test(p) ? p : p.replace(/\.css(\?|$)/, '.legacy.css$1');
        },
    };
}
