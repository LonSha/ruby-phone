/* ========================================================
 * phone/ui/rp-icons-bridge.js — 把旧主屏（phone/home-screen.js）的图标换成 v3 SVG 图标（ESM）
 * --------------------------------------------------------
 * v2 重写（相对 v1 的三处结构性修正）：
 *   1. 单一事实源 HOSTS：所有图标宿主在一张表里登记，新增渲染路径只加一行。
 *      v1 逐个选择器补，漏了 .app-library-app-item，且每次都靠人记得。
 *   2. retireArt() 内联让位：像素素材是 style="background-image:url(...)" 内联写的，
 *      内联优先级高于任何类选择器，CSS 的 background:none 永远压不住 —— 必须由 JS 清。
 *      v1 只隐藏 <img>，所以「文件夹的像素格子」和注入的字形叠在一起。
 *   3. probe() 自证：把 data-rp-* 属性、--rp3-tile 计算值、::before 的 background/mask
 *      一并写进 localStorage(rp_icons_probe)。此前只有 ok/tot 两个数字，
 *      分不清「没接管」和「接管了但没画出来」。
 * 自定义图片图标（bg 内有 .home-custom-icon-img）仍然尊重、不接管；
 * 默认 PNG 素材没有 <img>，因此不会再被误判成自定义图标。
 * ======================================================== */
import '../../shared/icons.js';   // 侧效导入：globalThis.LonShaIcons

const MARK = 'rp3Iconized';
const BG_SAVED = new WeakMap();      // 元素 -> 原 background-image
const DISP_SAVED = new WeakMap();    // <img> -> 原 display

/* 图标宿主清单：单一事实源。kind='folder' 走统一文件夹字形，不给 appSpec。 */
const HOSTS = [
    { sel: '.app-icon[data-app]', bg: '.app-icon-bg', kind: 'app' },
    { sel: '.dock-app[data-app]', bg: '.app-icon-bg', kind: 'app' },
    { sel: '.app-cluster-tile[data-cluster]', bg: '.app-icon-bg', kind: 'folder' },
    /* 应用库格子：容器不是 .app-icon-bg，需补类才能吃到 [data-rp3-tile] 的底。 */
    { sel: '.app-library-app-item[data-app]', bg: '.app-library-app-icon', kind: 'app', adopt: true },
];

function note(k, v) {
    try { globalThis.localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v)); } catch (_e) { /* 忽略 */ }
}

/** 让位：内联清掉像素素材（background-image 底色与 <img>）。 */
function retireArt(bg) {
    if (!bg || !bg.style) return;
    const cur = bg.style.backgroundImage;
    if (cur && cur !== 'none' && !BG_SAVED.has(bg)) {
        BG_SAVED.set(bg, cur);
        bg.style.backgroundImage = 'none';
    }
    try {
        bg.querySelectorAll('img').forEach((img) => {
            if (!DISP_SAVED.has(img)) DISP_SAVED.set(img, img.style.display);
            img.style.display = 'none';
        });
    } catch (_e) { /* 忽略 */ }
}

function iconize(el, host, opts) {
    const L = globalThis.LonShaIcons;
    if (!L || !el || el.dataset[MARK] === '1') return false;
    const isCluster = host.kind === 'folder';
    const id = isCluster ? el.getAttribute('data-cluster') : el.getAttribute('data-app');
    if (!id) return false;

    let bg = el.querySelector(host.bg);
    if (!bg) {
        if (isCluster) return false;                     // 没有承载体就别造，免得破坏布局
        bg = document.createElement('div');
        bg.className = 'app-icon-bg';
        bg.dataset.rp3Injected = '1';
        el.insertBefore(bg, el.firstChild);
    }
    if (host.adopt && !bg.classList.contains('app-icon-bg')) {
        bg.classList.add('app-icon-bg');
        bg.dataset.rp3Adopted = '1';
    }
    /* 不按 .home-custom-icon-img 判断「用户自定义」：
       home-screen.js 的 renderAppIcon 里 `unifiedIconOf(app.id)` 返回的内置像素图
       同样走这个 class（iconImage -> _renderCustomIconImage(...'home-custom-icon-img')），
       而像素图正是 iOS 外观下要替换的对象。按它跳过 = 所有 app 都退回像素风。
       真正的用户自定义图在 Dock 分支里另有渲染路径，不受这里影响。 */

    retireArt(bg);

    let art;
    if (isCluster) {
        el.setAttribute('data-rp3-tile', 'gray');
        art = L.svg('folder', { className: 'rp3-glyph' }) || L.svg('folder', { fill: true, className: 'rp3-glyph' });
    } else {
        const spec = L.appSpec(id);
        el.setAttribute('data-rp3-tile', spec.tile);
        if (id === 'calendar') {
            const d = new Date();
            const wd = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][d.getDay()];
            art = `<span class="lt-appicon-cal rp3-glyph-art" aria-hidden="true"><b>${wd}</b><i>${d.getDate()}</i></span>`;
        } else {
            art = L.svg(spec.glyph, { fill: true, className: 'rp3-glyph' })
                || L.svg(spec.glyph, { className: 'rp3-glyph' });
        }
    }
    if (!art) return false;                               // 字形不存在就不要打标记，下次还能重试
    bg.insertAdjacentHTML('beforeend', art);
    el.dataset[MARK] = '1';
    return true;
}

function undo(el) {
    el.querySelectorAll('.rp3-glyph, .rp3-glyph-art').forEach((n) => n.remove());
    el.querySelectorAll('[data-rp3-injected="1"]').forEach((n) => n.remove());
    el.querySelectorAll('[data-rp3-adopted="1"]').forEach((n) => {
        n.classList.remove('app-icon-bg');
        delete n.dataset.rp3Adopted;
    });
    const restore = (n) => {
        if (!n) return;
        if (BG_SAVED.has(n)) { n.style.backgroundImage = BG_SAVED.get(n); BG_SAVED.delete(n); }
        try {
            n.querySelectorAll('img').forEach((img) => {
                if (DISP_SAVED.has(img)) { img.style.display = DISP_SAVED.get(img); DISP_SAVED.delete(img); }
            });
        } catch (_e) { /* 忽略 */ }
    };
    restore(el);
    try { el.querySelectorAll('*').forEach(restore); } catch (_e) { /* 忽略 */ }
    el.removeAttribute('data-rp3-tile');
    delete el.dataset[MARK];
}

/** 自证探针：把「为什么没画出来」需要看的量一次性写进 localStorage。 */
function probe(root) {
    const panel = (root.closest && root.closest('#phone-panel')) || root;
    const el = root.querySelector('.app-icon[data-app]');
    const bg = el && el.querySelector('.app-icon-bg');
    let before = null;
    try { before = bg ? getComputedStyle(bg, '::before') : null; } catch (_e) { /* 忽略 */ }
    const g = (n) => (panel.getAttribute ? panel.getAttribute(n) : null);
    const cut = (s, n) => String(s || '').slice(0, n);
    return {
        ds: g('data-rp-ds'), ui: g('data-rp-ui'), ios: g('data-rp-ios'), iconStyle: g('data-rp3-icons'),
        tile: el ? el.getAttribute('data-rp3-tile') : null,
        vTile: el ? cut(getComputedStyle(el).getPropertyValue('--rp3-tile').trim(), 44) : '',
        beforeBg: before ? cut(before.backgroundImage, 44) : '',
        beforeMask: before ? cut(before.webkitMaskImage || before.maskImage || 'none', 20) : '',
        glyph: root.querySelectorAll('.rp3-glyph').length,
        cluster: root.querySelectorAll('.app-cluster-tile').length,
        clusterGlyph: root.querySelectorAll('.app-cluster-tile .rp3-glyph').length,
        lib: root.querySelectorAll('.app-library-app-item').length,
        libGlyph: root.querySelectorAll('.app-library-app-item .rp3-glyph').length,
        at: Date.now(),
    };
}

/**
 * @param {HTMLElement} root  手机根节点（#phone-panel）
 * @param {{ keepCustom?: boolean }} [opts]
 * @returns {() => void} detach
 */
export function attachIosIcons(root, opts = {}) {
    if (!root || typeof root.querySelectorAll !== 'function') return () => {};
    if (!globalThis.LonShaIcons) {
        note('rp_icons_err', 'LonShaIcons-missing@attach');
        import('../../shared/icons.js').then(() => {
            note('rp_icons_retry', { has: !!globalThis.LonShaIcons });
            try { run(); } catch (_e) { /* 忽略 */ }
        }).catch((e) => note('rp_icons_err', String((e && e.message) || e).slice(0, 200)));
    }

    /* 首次结果单独留存：MutationObserver 会反复 run，后几次全是「已接管」的跳过，会把 ok 刷成 0。 */
    let firstRun = null;
    const run = () => {
        let ok = 0;
        let tot = 0;
        HOSTS.forEach((h) => {
            let list;
            try { list = root.querySelectorAll(h.sel); } catch (_e) { return; }
            list.forEach((el) => {
                tot += 1;
                if (iconize(el, h, opts)) ok += 1;
            });
        });
        if (!firstRun) firstRun = { ok, tot };
        note('rp_icons_count', { ok, tot, first: firstRun, keepCustom: !!opts.keepCustom, at: Date.now() });
        note('rp_icons_probe', probe(root));
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

export const _internals = { iconize, undo, probe, HOSTS };