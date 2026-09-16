/* ========================================================
 * RubyPhone 全局字体缩放 / 外壳缩放 / 文字颜色 / 全局 CSS 注入
 * （模块化拆解 · 第二批）
 * 来源：原 index.js else 闭包内 L8721-9022（约 300 行）。
 * 拆解说明：
 *   - 该簇仅真实外部依赖为 storage（读取 phone-global-text / phone-frame-color /
 *     phone-shell-scale / phone-font-scale 四个键）；簇内出现的 "settings" 字样
 *     全部是 CSS 选择器字符串（.settings-app / --settings-text-color），并非
 *     else 闭包的 let settings 状态变量，故无需注入 settings。
 *   - 常量（ST_PHONE_VERSION / ST_PHONE_CSS_REVISION / ST_PHONE_GLOBAL_CSS_URL）
 *     通过工厂 deps 注入。
 *   - globalFontScaleState 与 _globalCssLoadingPromise 由原闭包 let 状态
 *     模块内化为本模块私有状态（同一运行实例语义不变）。
 * 用法（index.js）：
 *   import { createFontScaleManager } from './phone/font-scale.js';
 *   const fontScale = createFontScaleManager({ ST_PHONE_VERSION, ST_PHONE_CSS_REVISION, ST_PHONE_GLOBAL_CSS_URL });
 *   fontScale.setStorage(storage);   // init 中 storage 实例化后注入
 * ======================================================== */

/**
 * @param {object} deps
 * @param {string} deps.ST_PHONE_VERSION
 * @param {string} deps.ST_PHONE_CSS_REVISION
 * @param {string} deps.ST_PHONE_GLOBAL_CSS_URL
 */
export function createFontScaleManager(deps) {
    const { ST_PHONE_VERSION, ST_PHONE_CSS_REVISION, ST_PHONE_GLOBAL_CSS_URL } = deps;

    // 原闭包捕获的 let storage —— 显式注入
    let storage = null;
    const setStorage = (s) => { storage = s; };

    // 原闭包 let _globalCssLoadingPromise（L151）—— 模块内化
    let _globalCssLoadingPromise = null;

    function normalizePhoneShellScalePercent(value) {
        const raw = Number.parseFloat(value);
        if (!Number.isFinite(raw)) return 100;
        return Math.max(80, Math.min(120, Math.round(raw)));
    }

    function applyPhoneShellScale(value) {
        const percent = normalizePhoneShellScalePercent(value);
        const widthScale = percent / 100;
        const heightScale = widthScale * 0.95;
        document.documentElement.style.setProperty('--phone-shell-width-scale', widthScale.toFixed(4));
        document.documentElement.style.setProperty('--phone-shell-height-scale', heightScale.toFixed(4));
        return percent;
    }

    const PHONE_FONT_SCALE_MIN = 70;
    const PHONE_FONT_SCALE_MAX = 130;
    const PHONE_FONT_SCALE_DEFAULT = 100;
    const globalFontScaleState = {
        percent: PHONE_FONT_SCALE_DEFAULT,
        root: null,
        observer: null,
        entries: new Map(),
        needsRescan: true,
        frameId: null
    };

    function normalizePhoneFontScalePercent(value) {
        const raw = Number.parseFloat(value);
        if (!Number.isFinite(raw)) return PHONE_FONT_SCALE_DEFAULT;
        return Math.max(PHONE_FONT_SCALE_MIN, Math.min(PHONE_FONT_SCALE_MAX, Math.round(raw)));
    }

    function isProtectedPhoneFontElement(element) {
        if (!(element instanceof HTMLElement)) return true;
        if (element.closest('.phone-statusbar')) return true;
        if (['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'SVG', 'PATH', 'IMG', 'PICTURE', 'VIDEO', 'AUDIO', 'CANVAS', 'SOURCE', 'I'].includes(element.tagName)) {
            return true;
        }
        if (element.matches('[aria-hidden=true], [role=img], .app-icon-emoji, .emoji-icon, .material-icons, .material-symbols-outlined, .fa, .fas, .far, .fab, .fal, .fad, .fa-solid, .fa-regular, .fa-brands')) {
            return true;
        }
        return Array.from(element.classList).some((className) => /^fa-/.test(className));
    }

    function hasDirectPhoneText(element) {
        return Array.from(element.childNodes).some((node) => (
            node.nodeType === Node.TEXT_NODE && String(node.nodeValue || '').trim()
        ));
    }

    function shouldScalePhoneFontElement(element) {
        if (!(element instanceof HTMLElement) || isProtectedPhoneFontElement(element)) return false;
        if (element.matches('input, textarea, select, button, option, [contenteditable=true], [contenteditable=plaintext-only]')) {
            return true;
        }
        return hasDirectPhoneText(element);
    }

    function restorePhoneFontEntry(entry) {
        const { element, inlineFontSize, inlineFontSizePriority, inlineLineHeight, inlineLineHeightPriority } = entry;
        if (!element?.style) return;
        if (inlineFontSize) element.style.setProperty('font-size', inlineFontSize, inlineFontSizePriority);
        else element.style.removeProperty('font-size');
        if (inlineLineHeight) element.style.setProperty('line-height', inlineLineHeight, inlineLineHeightPriority);
        else element.style.removeProperty('line-height');
    }

    function capturePhoneFontEntry(element, mode = 'scale') {
        const computed = window.getComputedStyle(element);
        const baseFontSize = Number.parseFloat(computed.fontSize);
        if (!Number.isFinite(baseFontSize) || baseFontSize <= 0) return null;

        const computedLineHeight = Number.parseFloat(computed.lineHeight);
        const lineHeightRatio = computedLineHeight / baseFontSize;
        return {
            element,
            mode,
            baseFontSize,
            baseLineHeight: Number.isFinite(computedLineHeight) && lineHeightRatio >= 1 && lineHeightRatio <= 2.2
                ? computedLineHeight
                : null,
            inlineFontSize: element.style.getPropertyValue('font-size'),
            inlineFontSizePriority: element.style.getPropertyPriority('font-size'),
            inlineLineHeight: element.style.getPropertyValue('line-height'),
            inlineLineHeightPriority: element.style.getPropertyPriority('line-height')
        };
    }

    function rescanGlobalPhoneFonts(root) {
        globalFontScaleState.entries.forEach(restorePhoneFontEntry);

        const elements = [root, ...root.querySelectorAll('*')];
        const activeElements = new Set();
        elements.forEach((element) => {
            if (!(element instanceof HTMLElement)) return;
            const mode = isProtectedPhoneFontElement(element)
                ? 'protect'
                : (shouldScalePhoneFontElement(element) ? 'scale' : null);
            if (!mode) return;
            activeElements.add(element);
            const existing = globalFontScaleState.entries.get(element);
            if (!existing || existing.mode !== mode) {
                const entry = capturePhoneFontEntry(element, mode);
                if (entry) globalFontScaleState.entries.set(element, entry);
            }
        });

        globalFontScaleState.entries.forEach((entry, element) => {
            if (!element.isConnected || !root.contains(element) || !activeElements.has(element)) {
                restorePhoneFontEntry(entry);
                globalFontScaleState.entries.delete(element);
            }
        });
    }

    function renderGlobalPhoneFontScale() {
        globalFontScaleState.frameId = null;
        const root = document.getElementById('phone-panel-content');
        if (!root) return;

        if (globalFontScaleState.root !== root) {
            globalFontScaleState.observer?.disconnect();
            globalFontScaleState.entries.forEach(restorePhoneFontEntry);
            globalFontScaleState.entries.clear();
            globalFontScaleState.root = root;
            globalFontScaleState.needsRescan = true;
            globalFontScaleState.observer = new MutationObserver((mutations) => {
                const needsRescan = mutations.some((mutation) => {
                    if (mutation.type === 'characterData') {
                        return !globalFontScaleState.entries.has(mutation.target.parentElement);
                    }
                    const changedNodes = [...mutation.addedNodes, ...mutation.removedNodes];
                    if (changedNodes.some((node) => node.nodeType === Node.ELEMENT_NODE)) return true;
                    return !globalFontScaleState.entries.has(mutation.target);
                });
                if (!needsRescan) return;
                globalFontScaleState.needsRescan = true;
                requestGlobalPhoneFontScaleRender();
            });
            globalFontScaleState.observer.observe(root, {
                childList: true,
                subtree: true,
                characterData: true
            });
        }

        if (globalFontScaleState.needsRescan) {
            rescanGlobalPhoneFonts(root);
            globalFontScaleState.needsRescan = false;
        }

        const scale = globalFontScaleState.percent / 100;
        globalFontScaleState.entries.forEach((entry, element) => {
            if (!element.isConnected || !root.contains(element)) return;
            if (globalFontScaleState.percent === PHONE_FONT_SCALE_DEFAULT) {
                restorePhoneFontEntry(entry);
                return;
            }

            const fontSize = entry.mode === 'protect' ? entry.baseFontSize : entry.baseFontSize * scale;
            element.style.setProperty('font-size', `${fontSize.toFixed(2)}px`, 'important');
            if (entry.mode === 'scale' && entry.baseLineHeight) {
                element.style.setProperty('line-height', `${(entry.baseLineHeight * scale).toFixed(2)}px`, 'important');
            } else if (entry.inlineLineHeight) {
                element.style.setProperty('line-height', entry.inlineLineHeight, entry.inlineLineHeightPriority);
            } else {
                element.style.removeProperty('line-height');
            }
        });
    }

    function requestGlobalPhoneFontScaleRender() {
        if (globalFontScaleState.frameId !== null) return;
        globalFontScaleState.frameId = window.requestAnimationFrame(renderGlobalPhoneFontScale);
    }

    function applyGlobalFontScale(value) {
        const percent = normalizePhoneFontScalePercent(value);
        globalFontScaleState.percent = percent;
        document.documentElement.style.setProperty('--phone-font-scale', (percent / 100).toFixed(4));
        requestGlobalPhoneFontScaleRender();
        return percent;
    }

    function refreshGlobalFontScale() {
        globalFontScaleState.needsRescan = true;
        requestGlobalPhoneFontScaleRender();
    }

    function ensureGlobalTextColorOverrideStyle(color = null) {
        const safeColor = String(color || storage.get('phone-global-text') || '#000000').trim() || '#000000';
        const styleId = 'st-phone-global-text-color-override';
        const existing = document.getElementById(styleId);
        const style = existing || document.createElement('style');
        style.id = styleId;
        style.setAttribute('data-owner', 'yuzuki-phone');
        style.textContent = `
            #phone-panel-content,
            #phone-panel-content .phone-screen,
            #phone-panel-content .phone-body-panel,
            #phone-panel-content .settings-app {
                --phone-global-text: ${safeColor} !important;
                --settings-text-color: ${safeColor} !important;
                --settings-muted-text-color: ${safeColor} !important;
            }

            #phone-panel-content .phone-screen:not(:has(.honey-app)):not(:has(.games-app)):not(:has(.music-app)) :is(
                .app-name, .home-social-name, .home-mini-name,
                .home-card-title, .home-card-desc, .home-settings-title, .home-settings-chevron,
                .home-time, .time-large, .date, .home-time-date, .home-time-weekday,
                .setting-label, .setting-desc, .setting-value, .setting-info,
                .settings-subsection-title, .phone-shell-scale-value, .app-name-custom-label,
                .wechat-chat-name, .wechat-chat-last, .wechat-chat-time,
                .wechat-contact-name, .wechat-contact-signature,
                .message-text, .message-time,
                .album-title, .album-subtitle, .album-empty-title, .album-empty-copy,
                .album-preview-name, .album-preview-path, .album-source,
                .mofo-app, .yzp-calendar-settings-label, .yzp-calendar-settings-desc,
                .yzp-calendar-add-title, .yzp-calendar-add-date,
                .yzp-calendar-memo-text, .yzp-calendar-memo-time-inline,
                .yzp-calendar-detail-date, .yzp-calendar-detail-body
            ):not(
                .app-icon-emoji, .app-badge, .phone-punch-hole,
                .phone-statusbar *, .statusbar-left *, .statusbar-right *,
                .phone-call-active *, .phone-call-incoming *,
                .setting-btn[style*="color: #ff"], .setting-btn[style*="color:#ff"],
                .setting-btn[style*="color: #d9"], .setting-btn[style*="color:#d9"],
                .album-danger-btn, .yzp-calendar-delete-btn
            ) {
                color: ${safeColor} !important;
                text-shadow: none !important;
            }
        `;
        if (existing) existing.remove();
        document.head.appendChild(style);
    }

    function applyGlobalTextColor(color = null) {
        const safeColor = String(color || storage.get('phone-global-text') || '#000000').trim() || '#000000';
        document.documentElement.style.setProperty('--phone-global-text', safeColor);
        document.querySelectorAll('#phone-panel-content, #phone-panel-content .phone-screen, .phone-body-panel, .settings-app').forEach((root) => {
            root.style.setProperty('--phone-global-text', safeColor);
            root.style.setProperty('--settings-text-color', safeColor);
            root.style.setProperty('--settings-muted-text-color', safeColor);
        });
        ensureGlobalTextColorOverrideStyle(safeColor);
        return safeColor;
    }

    // 🎨 初始化颜色设置（新版：统一全局文字颜色）
    function initColors() {
        // 只读取全局文字颜色（默认黑色）
        const globalTextColor = storage.get('phone-global-text') || '#000000';
        const phoneFrameColor = storage.get('phone-frame-color') || '#1a1a1a';
        // [v2.19.0] 显示缩放单一真源：新键 sys_shell_scale 优先、旧键 phone-shell-scale 回落
        const _sysScaleRaw = storage.get('sys_shell_scale');
        const phoneShellScale = (_sysScaleRaw !== undefined && _sysScaleRaw !== null && _sysScaleRaw !== '')
            ? _sysScaleRaw
            : (storage.get('phone-shell-scale') || 100);
        const phoneFontScale = storage.get('phone-font-scale') || PHONE_FONT_SCALE_DEFAULT;

        // 设置CSS变量
        applyGlobalTextColor(globalTextColor);
        document.documentElement.style.setProperty('--phone-frame-color', phoneFrameColor);
        applyPhoneShellScale(phoneShellScale);
        applyGlobalFontScale(phoneFontScale);
    }

    async function ensureGlobalPhoneCSS() {
        const styleId = 'st-phone-global-css';
        const existing = document.getElementById(styleId);
        if (existing?.getAttribute('data-version') === ST_PHONE_VERSION
            && existing?.getAttribute('data-revision') === ST_PHONE_CSS_REVISION) return;

        if (_globalCssLoadingPromise) {
            await _globalCssLoadingPromise;
            return;
        }

        _globalCssLoadingPromise = (async () => {
            try {
                const resp = await fetch(ST_PHONE_GLOBAL_CSS_URL, { cache: 'no-cache' });
                if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
                const cssText = await resp.text();
                let finalCssText = cssText;
                if (finalCssText.charCodeAt(0) === 0xFEFF) {
                    finalCssText = finalCssText.slice(1);
                }

                const style = document.createElement('style');
                style.id = styleId;
                style.setAttribute('data-source', ST_PHONE_GLOBAL_CSS_URL);
                style.setAttribute('data-version', ST_PHONE_VERSION);
                style.setAttribute('data-revision', ST_PHONE_CSS_REVISION);
                style.textContent = finalCssText;
                existing?.remove();
                document.head.appendChild(style);
            } catch (err) {
                console.error('❌ phone.css 动态注入失败:', err);
            }
        })();

        await _globalCssLoadingPromise;
    }

    return {
        setStorage,
        normalizePhoneShellScalePercent,
        applyPhoneShellScale,
        normalizePhoneFontScalePercent,
        isProtectedPhoneFontElement,
        hasDirectPhoneText,
        shouldScalePhoneFontElement,
        restorePhoneFontEntry,
        capturePhoneFontEntry,
        rescanGlobalPhoneFonts,
        renderGlobalPhoneFontScale,
        requestGlobalPhoneFontScaleRender,
        applyGlobalFontScale,
        refreshGlobalFontScale,
        ensureGlobalTextColorOverrideStyle,
        applyGlobalTextColor,
        initColors,
        ensureGlobalPhoneCSS,
    };
}