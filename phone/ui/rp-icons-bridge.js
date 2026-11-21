/* ========================================================
 * phone/ui/rp-icons-bridge.js — 把旧主屏（phone/home-screen.js）的图标换成 v3 SVG 图标（ESM）
 * --------------------------------------------------------
 * 只在 theme-controller 打开 iOS 拟真（data-rp-ios="3"）时由它动态加载并调用；默认不加载。
 * 做的事情只有两件，且都可撤销：
 *   1. 给 .app-icon[data-app] / .dock-app[data-app] 打 data-rp3-tile="<色板>"（颜色在 phone-tokens-v3.css）
 *   2. 在 .app-icon-bg 里追加一个 <svg class="rp3-glyph">（字形来自 shared/icons.js 的 APPS 映射）
 * 原有的 .app-icon-emoji / 像素 SVG 节点不删除，只由 CSS 隐藏；detach() 会移除注入的节点和属性。
 * 用户自定义的图片图标（.app-icon-bg.custom-icon 内的 .home-custom-icon-img）默认保留，不覆盖。
 * 主屏重渲染时用 MutationObserver 自动补上（节流到下一帧）。
 * ======================================================== */
import '../../shared/icons.js';   // 侧效导入：globalThis.LonShaIcons

const MARK = 'rp3Iconized';

function iconize(el, { keepCustom = true } = {}) {
    const L = globalThis.LonShaIcons;
    if (!L || !el || el.dataset[MARK] === '1') return false;
    const id = el.getAttribute('data-app');
    if (!id) return false;
    const bg = el.querySelector('.app-icon-bg') || el;
    if (keepCustom && bg.classList.contains('custom-icon') && bg.querySelector('.home-custom-icon-img') && !el.classList.contains('dock-app')) return false;
    const spec = L.appSpec(id);
    el.setAttribute('data-rp3-tile', spec.tile);
    let art;
    if (id === 'calendar') {
        const d = new Date();
        art = `<span class="lt-appicon-cal rp3-glyph-art" aria-hidden="true"><b>${['周日', '周一', '周二', '周三', '周四', '周五', '周六'][d.getDay()]}</b><i>${d.getDate()}</i></span>`;
    } else {
        art = L.svg(spec.glyph, { fill: true, className: 'rp3-glyph' });
    }
    bg.insertAdjacentHTML('beforeend', art);
    el.dataset[MARK] = '1';
    /* 原像素素材让位：否则 PNG 与新字形叠在一起，看起来仍是像素风。 */
    try { bg.querySelectorAll('img').forEach((img) => { img.style.display = 'none'; }); } catch (_e) { /* 忽略 */ }
    return true;
}

function undo(el) {
    el.querySelectorAll(':scope .rp3-glyph, :scope .rp3-glyph-art').forEach((n) => n.remove());
    el.removeAttribute('data-rp3-tile');
    delete el.dataset[MARK];
}

/**
 * @param {HTMLElement} root  手机根节点（#phone-panel）
 * @param {{ keepCustom?: boolean }} [opts]
 * @returns {() => void} detach
 */
function note(k, v) {
    try { globalThis.localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v)); } catch (_e) { /* 忽略 */ }
}

export function attachIosIcons(root, opts = {}) {
    if (!root || typeof root.querySelectorAll !== 'function') return () => {};
    /* 图标模块缺席时主动补一次（此前是静默 return false，屏幕上看不出任何异常）。 */
    if (!globalThis.LonShaIcons) {
        note('rp_icons_err', 'LonShaIcons-missing@attach');
        import('../../shared/icons.js').then(() => {
            note('rp_icons_retry', { has: !!globalThis.LonShaIcons });
            try { run(); } catch (_e) { /* 忽略 */ }
        }).catch((e) => note('rp_icons_err', String((e && e.message) || e).slice(0, 200)));
    }
    const SEL = '.app-icon[data-app], .dock-app[data-app]';
    const run = () => {
        let ok = 0;
        let tot = 0;
        root.querySelectorAll(SEL).forEach((el) => {
            tot += 1;
            if (iconize(el, opts)) ok += 1;
        });
        /* 可读计数：ok=实际被 SVG 接管，tot=选择器命中数。ok<tot 就是下一步要查的对象。 */
        note('rp_icons_count', { ok: ok, tot: tot, keepCustom: !!opts.keepCustom, at: Date.now() });
    };
    run();
    let raf = 0;
    const mo = typeof MutationObserver === 'function'
        ? new MutationObserver(() => { if (raf) return; raf = requestAnimationFrame(() => { raf = 0; run(); }); })
        : null;
    if (mo) mo.observe(root, { childList: true, subtree: true });
    return () => {
        if (mo) mo.disconnect();
        if (raf) cancelAnimationFrame(raf);
        root.querySelectorAll('[data-rp3-iconized]').forEach(undo);
    };
}

export const _internals = { iconize, undo };
