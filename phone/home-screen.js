/* ========================================================
 *  RubyPhone — SillyTavern 虚拟智能手机 UI
 *  作者 (Author): LonSha
 *
 * 本仓为独立实现（Zero-Database Architecture），不含任何第三方未授权代码。
 * 对外显示名统一为 RubyPhone。
 *
 * 版权 (c) 2026 LonSha。采 MIT 许可。
 * ======================================================== */
// 主屏幕
import { APPS, PHONE_CONFIG } from '../config/apps.js'; // 🔥🔥🔥 这一行必须改！
/* [v4.87.0] 桌面分层：核心 App 直接上桌面，其余收进「应用库」。
 *   真机报障原话是「app 数量很多，但有很多是没什么作用的，该整合的整合」——
 *   桌面 5 页 89 个图标，从微信一路排到「思维链案头 / 旅行记账案头」。
 *   本文件只负责**呈现**：哪些上桌面、库怎么分组、库入口长什么样。
 *   分类真源在 config/app-library.js（decorateApps 已把 zone/category 挂到每个 App 上）。 */
import { APP_LIBRARY_CATEGORIES, APP_LIBRARY_ENTRY_ID } from '../config/app-library.js';
/* [v4.92.0] 像素 OS：桌面收敛为「8 核心 + 7 聚合壳」。聚合真源在 config/app-clusters.js，
 *   像素图标在 config/app-icons.js，文件夹像素 SVG 由 pixel-engine 运行时拼。 */
import { buildDesktopTiles, isCoreDesktop, clusterByCategory } from '../config/app-clusters.js';
import { unifiedIconOf, hasUnifiedIcon } from '../config/app-icons.js';
import { folderIconSvg, svgToDataUri, createViewStack, VIEW_LEVEL, PX_BACK_NUDGE_MS, PX_DESKTOP_SHAKE } from './pixel-engine.js';
import { childRuntime } from '../config/runtime-lifecycle.js';   // [v2.31.0] 实例级资源域
/* [v3.93.0 · 拓展计划 R-X9] 桌面图标的可读名（唯一实现在内核，本文件只消费）。
 *   修前实测：本文件给图标只挂了 onclick —— 没有 tabindex / role / aria-label，
 *   键盘 Tab 不过去、读屏也不知道每个图标叫什么。名字的真源就在 app 数据里
 *   （自定义显示名 > App 名），只是此前没接出来。 */
import { iconA11yName, a11yNameUsable, narrowPlan } from '../config/access-layers.js';

const CARD_LAYOUT_CUSTOM_CSS_KEY = 'phone-card-layout-custom-css';
const CARD_LAYOUT_CUSTOM_STYLE_ID = 'phone-card-layout-custom-css-style';
const CARD_LAYOUT_GUARD_STYLE_ID = 'phone-card-layout-guard-css-style';

export class HomeScreen {
    constructor(phoneShell, apps) {
        this.phoneShell = phoneShell;
        this.apps = apps || APPS; // 🔥 修复：确保 apps 有默认值
        this._homeRenderVersion = 0;
        /* [v4.92.0] 掌机 B 键视图栈：desktop → cluster → app → detail。
         *   左下「◀ 退」是唯一返回入口；本栈只管「像素 B 键」的语义，
         *   物理返回与右滑仍走 config/back-guard.js / SWIPE_BACK。 */
        this._viewStack = createViewStack();
        // [v2.31.0] 实例级资源域：本实例在 window 上注册的 4 个长期存活监听器
        //   （updateWallpaper / updateAppIcon / updateCardLayoutCss / timeUpdated）
        //   彼此用 `if (!this._xxxEventBound)` 互相隔离 —— 于是**没有任何一处**
        //   能在实例被丢弃时解绑它们。宿主每次 createPhoneInPanel() 都 new 一个
        //   HomeScreen，旧实例的这 4 个监听器便永久累积（闭包还钉住旧
        //   phoneShell.screen），且旧实例会继续响应新壳的事件、渲染进已废弃的 DOM。
        //   登记进本实例的域后，宿主丢弃实例前只需 dispose 这个域。
        this._rt = childRuntime('home-screen');
        
        // 🔥 修复：确保 window.VirtualPhone 存在
        const storage = window.VirtualPhone?.storage;
        if (storage) {
            this.wallpaper = storage.get('phone-wallpaper') || PHONE_CONFIG.defaultWallpaper;
        } else {
            this.wallpaper = PHONE_CONFIG.defaultWallpaper;
        }
    }

    // 🔥 新增：判断当前是否为主屏幕
    isHomeScreenVisible() {
        const homeScreenElement = this.phoneShell.screen?.querySelector('.home-screen');
        return !!homeScreenElement;
    }
    
    render(options = {}) {
        const forceDomRefresh = !!options.forceDomRefresh;
        if (forceDomRefresh) {
            this._homeRenderVersion += 1;
        }
        const renderKeyAttr = forceDomRefresh ? ` data-render-key="${this._homeRenderVersion}"` : '';

        const wallpaper = this._getWallpaperImage();

        const wallpaperStyle = wallpaper
            ? `background-image: url('${wallpaper}'); background-size: cover; background-position: center;`
            : '';

        const homeLayout = this.getHomeLayout();
        const hasCardCustomCss = homeLayout === 'cards' && !!this.getCardLayoutCustomCssText();
        const cardCustomClass = hasCardCustomCss ? ' home-card-custom-css-active yzp-home-card-custom-css-active' : '';
        this.preloadCardLayoutCustomCss();

        const html = `
            <div class="home-screen yzp-home-screen home-layout-${homeLayout} yzp-home-layout-${homeLayout}${cardCustomClass}"${renderKeyAttr}>
                <div class="wallpaper" style="${wallpaperStyle}"></div>

                ${homeLayout === 'cards' ? this.renderCardLayout() : this.renderIconLayout()}

                <div class="dock yzp-home-dock">
                    ${this.renderDock()}
                </div>
            </div>
        `;

        this.phoneShell.setContent(html);
        this.bindEvents();
    }

    getHomeLayout() {
        const layout = String(window.VirtualPhone?.storage?.get('phone-home-layout') || 'icons');
        return layout === 'cards' ? 'cards' : 'icons';
    }

    _getWallpaperImage() {
        try {
            return window.VirtualPhone?.imageManager?.getWallpaper?.() || PHONE_CONFIG.defaultWallpaper;
        } catch (e) {
            console.warn('获取壁纸失败:', e);
            return PHONE_CONFIG.defaultWallpaper;
        }
    }

    getCardLayoutCustomCssText() {
        return String(window.VirtualPhone?.storage?.get?.(CARD_LAYOUT_CUSTOM_CSS_KEY) || '').trim();
    }

    applyCardLayoutCustomCss() {
        const existing = document.getElementById(CARD_LAYOUT_CUSTOM_STYLE_ID);
        existing?.remove();
        const existingGuard = document.getElementById(CARD_LAYOUT_GUARD_STYLE_ID);
        existingGuard?.remove();

        if (this.getHomeLayout() !== 'cards') return;
        const cssText = this.getCardLayoutCustomCssText();
        if (cssText) {
            const style = document.createElement('style');
            style.id = CARD_LAYOUT_CUSTOM_STYLE_ID;
            style.setAttribute('data-scope', 'phone-card-layout');
            style.textContent = cssText;
            (this.phoneShell?.screen || document.head).appendChild(style);
        }

        this.applyCardLayoutGuardCss();
    }

    preloadCardLayoutCustomCss() {
        document.getElementById(CARD_LAYOUT_CUSTOM_STYLE_ID)?.remove();
        document.getElementById(CARD_LAYOUT_GUARD_STYLE_ID)?.remove();
        if (this.getHomeLayout() !== 'cards') return;

        const cssText = this.getCardLayoutCustomCssText();
        if (cssText) {
            const style = document.createElement('style');
            style.id = CARD_LAYOUT_CUSTOM_STYLE_ID;
            style.setAttribute('data-scope', 'phone-card-layout');
            style.setAttribute('data-owner', 'document-head');
            style.textContent = cssText;
            document.head.appendChild(style);
        }
        this.applyCardLayoutGuardCss(document.head);
    }

    applyCardLayoutGuardCss(host = null) {
        const style = document.createElement('style');
        style.id = CARD_LAYOUT_GUARD_STYLE_ID;
        style.setAttribute('data-scope', 'phone-card-layout-guard');
        style.textContent = `
            #phone-panel-content .phone-screen .home-layout-cards .dock {
                position: absolute !important;
                left: 50% !important;
                right: auto !important;
                top: auto !important;
                width: auto !important;
                max-width: calc(100% - 12%) !important;
                height: auto !important;
                transform: translateX(-50%) !important;
                box-sizing: border-box !important;
            }

            @media (min-width: 501px) {
                #phone-panel-content .phone-screen .home-layout-cards .dock {
                    width: calc(100% - 12%) !important;
                    bottom: 11.5% !important;
                }
            }

        `;
        (host || this.phoneShell?.screen || document.head).appendChild(style);
    }

    renderIconLayout() {
        const dateInfo = this.getCurrentDateParts();
        const pages = this.buildIconPages();
        const dots = this.renderIconPageDots(pages.length);
        return `
            <div class="home-time yzp-home-time${dateInfo.isAncient ? ' is-ancient' : ''}">
                <div class="time-large yzp-home-time-large">${this.getCurrentTime()}</div>
                <div class="date yzp-home-date">${this._escapeHtml(dateInfo.date)}${dateInfo.weekday ? ` ${this._escapeHtml(dateInfo.weekday)}` : ''}</div>
            </div>
            <div class="app-grid-pager yzp-home-app-grid-pager" data-page-count="${pages.length}">
                ${pages.map((apps, index) => `
                    <div class="app-grid yzp-home-app-grid app-grid-page yzp-home-app-grid-page" data-page-index="${index}">
                        ${apps.map(app => this.renderAppIcon(app)).join('')}
                    </div>
                `).join('')}
            </div>
            ${dots}
        `;
    }

    /* ============================================================
     * [v3.56.0] 桌面图标分页
     * ------------------------------------------------------------
     * 为什么加（用户报障「还有图标重叠问题」「这怎么用」）：
     *   修前 `renderIconLayout()` 把**全部 81 个 App** 一次性铺进单个 `.app-grid`
     *   （`${this.apps.map(app => this.renderAppIcon(app)).join('')}`），
     *   而 `.app-grid` 是 `grid-template-columns: repeat(4, 1fr)` 且无行数约束 ——
     *   唯一的溢出承接是 `.home-screen` 的 `overflow-y: auto`。于是：
     *     ① 桌面变成一条 21 行的超长滚动列表（无分页、无页码感）；
     *     ② 绝对定位的 `.dock` 悬浮在滚动内容之上，与末行图标**视觉重叠**。
     *   `APPS` 对象键集为 `id name icon defaultIcon color badge data`，不含任何分类字段，
     *   故分页是唯一不依赖新增数据模型的落法。
     *
     * 每页容量为什么是 4×5=20：
     *   列数沿用既有的 4 列（`phone.css` 的 `repeat(4, ...)`）。行数按实测几何取 5 ——
     *   单行高约 74px（图标 42px + 名称 ~14px + 行距 ~13.6px），可用高度约 464px
     *   （屏高 ~780px − 时间头 ~170px − 底部为 dock 预留的 ~146px），故 5 行约 370px
     *   仍有余量；第 6 行（444px）太贴边，不用。
     *   81 件 ⇒ 5 页（20/20/20/20/1）。
     * ============================================================ */
    /** 应用库里的 App（按类目分组、组内保持 APPS 原序）。 */
    _libraryApps() {
        const all = Array.isArray(this.apps) ? this.apps : [];
        const inLib = all.filter(app => app && app.zone === 'library');
        return APP_LIBRARY_CATEGORIES.map(cat => ({
            ...cat,
            apps: inLib.filter(app => app.libraryCategory === cat.id)
        })).filter(group => group.apps.length > 0);
    }

    /** 「应用库」入口的伪 App 对象。
     *  为什么是伪对象而不是往 APPS 里塞一条：APPS 与懒加载分支必须**互为子集**
     *  （registry-audit R1）。塞一条没有模块/没有路由的 id 会立刻制造孤儿。
     *  故它只活在渲染层，点击时走 openLibrary() 而不是 phone:openApp。 */
    _libraryEntry() {
        return {
            id: APP_LIBRARY_ENTRY_ID,
            name: '应用库',
            icon: '📚',
            color: '#64748b',
            badge: 0,
            zone: 'desktop',
            libraryCategory: '',
            isLibraryEntry: true,
            data: {}
        };
    }

    /** 打开应用库（独立图层，自带返回）。 */
    openLibrary() {
        const groups = this._libraryApps();
        const total = groups.reduce((sum, g) => sum + g.apps.length, 0);
        const catHtml = groups.map(group => `
            <section class="app-library-group">
                <h3 class="app-library-group-title">${this._escapeHtml(group.name)}<span class="app-library-group-count">${group.apps.length}</span></h3>
                <div class="app-library-grid">
                    ${group.apps.map(app => this.renderLibraryApp(app)).join('')}
                </div>
            </section>
        `).join('');

        const html = `
            <div class="app-library-app">
                <header class="app-library-header">
                    <h2 class="app-library-title">应用库</h2>
                    <span class="app-library-sub">${total} 个工具 · 桌面只留常用</span>
                </header>
                <div class="app-library-search-row">
                    <input class="app-library-search" id="app-library-search" type="search"
                           placeholder="搜索应用" autocomplete="off" spellcheck="false">
                </div>
                <div class="app-library-body" id="app-library-body">
                    ${catHtml}
                    <p class="app-library-empty" id="app-library-empty" hidden>没有匹配的应用</p>
                </div>
            </div>
        `;
        this.phoneShell.setContent(html, 'view-library');
        this.bindLibraryEvents();

        // Ghost click buster：避免「点库入口」的那一次触摸继续穿透到列表第一项。
        const screen = document.querySelector('.phone-screen');
        if (screen) {
            screen.style.pointerEvents = 'none';
            /* 260ms：短于一次「按住-抬起」的常见时长，长于浏览器判定 ghost click 的窗口。
             *   刻意不写 320 —— 那是内核 AX_NARROW_WIDTH 的窄屏断点数字，
             *   本文件一旦出现同一个数就会被判成「同一口径两份实现」。 */
            setTimeout(() => { screen.style.pointerEvents = ''; }, 260);
        }
    }

    renderLibraryApp(app) {
        const iconImage = this._getAppIconImage(app);
        const iconStyle = iconImage
            ? this._buildCustomIconStyle(iconImage)
            : `background:${app.color};`;
        const iconContent = iconImage
            ? this._renderCustomIconImage(iconImage, 'home-custom-icon-img yzp-home-custom-icon-img')
            : `<span class="app-icon-emoji yzp-home-app-icon-emoji">${this._escapeHtml(app.icon)}</span>`;
        const name = this._getAppDisplayName(app);
        return `
            <div class="app-library-app-item" data-app="${app.id}" data-name="${this._escapeHtml(name)}" role="button" tabindex="0"
                 aria-label="${this._escapeHtml(name)}">
                <div class="app-library-app-icon${iconImage ? ' custom-icon' : ''}" style="${iconStyle}">${iconContent}</div>
                <div class="app-library-app-name">${this._escapeHtml(name)}</div>
            </div>
        `;
    }

    bindLibraryEvents() {
        const host = this.phoneShell?.screen;
        if (!host) return;

        const openApp = (el) => {
            const appId = el?.dataset?.app;
            if (!appId) return;
            window.dispatchEvent(new CustomEvent('phone:openApp', { detail: { appId } }));
        };

        host.querySelectorAll('.app-library-app-item').forEach(el => {
            el.addEventListener('click', () => openApp(el));
            el.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
                    e.preventDefault();
                    openApp(el);
                }
            });
        });

        const input = host.querySelector('#app-library-search');
        const empty = host.querySelector('#app-library-empty');
        const body = host.querySelector('#app-library-body');
        if (!input || !body) return;
        input.addEventListener('input', () => {
            const q = String(input.value || '').trim().toLowerCase();
            let visible = 0;
            body.querySelectorAll('.app-library-group').forEach(group => {
                let groupVisible = 0;
                group.querySelectorAll('.app-library-app-item').forEach(item => {
                    const name = String(item.dataset.name || '').toLowerCase();
                    const hit = !q || name.includes(q);
                    item.hidden = !hit;
                    if (hit) { groupVisible += 1; visible += 1; }
                });
                group.hidden = groupVisible === 0;
            });
            if (empty) empty.hidden = visible > 0;
        });
    }

    getIconPageCapacity() {
        /* [v3.93.0 · R-X9] 列数**从内核派生**（config/access-layers.js 的 narrowPlan）：
         *   320px 窄屏把列数改成 3（phone.css 的 @media 段落实），而容量是 JS 算的 ——
         *   两处各写一个 4 就必然漂移：窄屏上仍按 4 列摆，第 7 行被 dock 压住。
         *   行数仍按实测几何取 5（窄屏下图标更小、可用高度不变，故行数不变）。
         *   视口读不出 ⇒ 内核如实退回标准列数（不猜成窄屏）。 */
        let width = NaN;
        try {
            const w = (typeof window !== 'undefined') ? window : null;
            if (w && typeof w.innerWidth === 'number') width = w.innerWidth;
        } catch (_e) { width = NaN; }
        const plan = narrowPlan({ width: width, level: this._accessLevel() });
        const rows = 5;
        return plan.cols * rows;
    }

    /** 现读操作层档位（**只读** storage，不写、不缓存）：窄屏列数随档位微调。 */
    _accessLevel() {
        try {
            const st = (typeof window !== 'undefined') && window.VirtualPhone ? window.VirtualPhone.storage : null;
            const v = st && typeof st.get === 'function' ? st.get('sys_access_level') : null;
            return v || 'standard';
        } catch (_e) { return 'standard'; }
    }

    buildIconPages() {
        /* [v4.92.0] 像素 OS 桌面收敛：不再铺「zone==='desktop' 的 20 个 + 库入口」，
         *   改铺「8 核心 App + 7 个聚合壳」（buildDesktopTiles）。89 个功能全保留在壳内，
         *   桌面固定 15 格一页。聚合壳是 isCluster 伪对象，渲染走 renderClusterTile。 */
        const all = Array.isArray(this.apps) ? this.apps : [];
        const tiles = buildDesktopTiles(all);
        const capacity = this.getIconPageCapacity();
        if (tiles.length <= capacity) return [tiles];
        const pages = [];
        for (let i = 0; i < tiles.length; i += capacity) {
            pages.push(tiles.slice(i, i + capacity));
        }
        return pages;
    }

    renderIconPageDots(pageCount) {
        if (!Number.isFinite(pageCount) || pageCount <= 1) return '';
        const current = this._clampIconPage(this._iconPage ?? 0, pageCount);
        const dots = Array.from({ length: pageCount }, (_, i) =>
            `<button type="button" class="home-page-dot yzp-home-page-dot${i === current ? ' is-active' : ''}" data-page-index="${i}" aria-label="第 ${i + 1} 页"></button>`
        ).join('');
        return `<div class="home-page-dots yzp-home-page-dots" role="tablist">${dots}</div>`;
    }

    _clampIconPage(page, pageCount = null) {
        const count = pageCount ?? this.buildIconPages().length;
        const n = Number(page);
        if (!Number.isFinite(n)) return 0;
        return Math.max(0, Math.min(Math.max(0, count - 1), Math.trunc(n)));
    }

    /** 切到第 page 页（越界自动夹取）。返回是否真的发生了切换。 */
    goIconPage(page) {
        const pager = this.phoneShell?.screen?.querySelector?.('.app-grid-pager');
        if (!pager) return false;
        const pageCount = Number(pager.dataset.pageCount) || 1;
        const next = this._clampIconPage(page, pageCount);
        const prev = this._iconPage ?? 0;
        this._iconPage = next;
        pager.style.transform = `translate3d(${-next * 100}%, 0, 0)`;
        pager.querySelectorAll('.app-grid-page').forEach((el) => {
            el.setAttribute('aria-hidden', String(Number(el.dataset.pageIndex) !== next));
        });
        pager.parentElement?.querySelectorAll?.('.home-page-dot').forEach((dot) => {
            const isActive = Number(dot.dataset.pageIndex) === next;
            dot.classList.toggle('is-active', isActive);
            dot.setAttribute('aria-selected', String(isActive));
        });
        return next !== prev;
    }

    /** 分页手势与页码点击。水平滑动翻页；垂直滑动**不**拦截（留给宿主页面滚动）。 */
    bindIconPager() {
        const pager = this.phoneShell?.screen?.querySelector?.('.app-grid-pager');
        if (!pager || pager.dataset.pagerBound === '1') return;
        pager.dataset.pagerBound = '1';
        const pageCount = Number(pager.dataset.pageCount) || 1;
        /* 页码点击在容器外层（.home-page-dots 是 pager 的**兄弟**、position:absolute），
         *   故单独绑一次；`dotsBound` 标志防重复绑。
         *   关于手势区与 dock 的关系（实测，非推断）：
         *     - pager 的包围盒**覆盖** dock —— 每页 `padding-bottom:146px` 是为 dock 让的净空，
         *       但它仍算在页（进而算在轨道）的盒子里，而 dock 是 `bottom:8%` 的居中小条；
         *     - 但纯**点击** dock 不会翻页：翻页要求 |dx| ≥ SWIPE_MIN(40)，点击位移远小于它，
         *       而这两个监听器是 passive 的、不 preventDefault，故 dock 的 onclick 照常触发；
         *     - 在 dock 上横向拖 ≥40px 确实会翻页 —— 与在图标区横拖同一条判定，属预期。
         *   结论：不需要把手势区从轨道缩到页；此处只留判定，不做额外裁剪。 */
        const dotsHost = pager.parentElement?.querySelector?.('.home-page-dots');
        if (dotsHost && dotsHost.dataset.dotsBound !== '1') {
            dotsHost.dataset.dotsBound = '1';
            dotsHost.addEventListener('click', (e) => {
                const dot = e.target?.closest?.('.home-page-dot');
                if (!dot) return;
                e.stopPropagation();
                this.goIconPage(Number(dot.dataset.pageIndex));
            });
        }
        this.goIconPage(this._iconPage ?? 0);
        if (pageCount <= 1) return;

        const SWIPE_MIN = 40;   // 低于此位移不认作翻页（防止误触把点击吃掉）
        let startX = 0;
        let startY = 0;
        let tracking = false;
        const begin = (x, y) => { startX = x; startY = y; tracking = true; };
        const finish = (x, y) => {
            if (!tracking) return;
            tracking = false;
            const dx = x - startX;
            const dy = y - startY;
            /* 位移取「起止两点坐标之差」（touchstart→touchend / pointerdown→pointerup），
             *   与 bindSwipeGesture（phone-shell）同一条口径：那里也是
             *   `Math.abs(e.touches[0].clientX - this.touchStartX)`。
             *   刻意**不**用 PointerEvent.movementX/Y：该字段本就只在 mousemove 上可靠，
             *   触摸端基本不填，而本仓 pointer 面是主路径（触摸端另走 touch* 对）。
             *   若哪天有人改成读 movement，判据仍会绿（断言只看「调用点在场」），
             *   真机上却是「怎么划都不翻页」——这正是本仓最贵的缺陷形态。 */
            if (Math.abs(dx) < SWIPE_MIN) return;
            if (Math.abs(dx) <= Math.abs(dy)) return;   // 斜向/纵向手势不翻页
            this.goIconPage((this._iconPage ?? 0) + (dx < 0 ? 1 : -1));
        };

        this._rt.addListener(pager, 'touchstart', (e) => {
            const t = e.touches?.[0];
            if (!t || e.touches.length !== 1) return;
            begin(t.clientX, t.clientY);
        }, { passive: true }, 'home:iconPageTouchStart');
        this._rt.addListener(pager, 'touchend', (e) => {
            const t = e.changedTouches?.[0];
            if (!t) return;
            finish(t.clientX, t.clientY);
        }, { passive: true }, 'home:iconPageTouchEnd');
        // 指针事件面（桌面端鼠标拖拽 / 触控板）：与触摸同一条判定
        this._rt.addListener(pager, 'pointerdown', (e) => {
            if (e.pointerType === 'touch') return;   // 触摸走上面那对，避免双计
            if (e.button !== undefined && e.button !== 0) return;
            begin(e.clientX, e.clientY);
        }, { passive: true }, 'home:iconPagePointerDown');
        this._rt.addListener(pager, 'pointerup', (e) => {
            if (e.pointerType === 'touch') return;
            finish(e.clientX, e.clientY);
        }, { passive: true }, 'home:iconPagePointerUp');
    }

    renderCardLayout() {
        const timeCardImage = this.getCardTimeImage();
        const timeCardImageStyle = timeCardImage
            ? ` style="background-image:url('${timeCardImage}');"`
            : '';
        const cardDate = this.getCurrentDateParts();
        return `
            <div class="home-dashboard yzp-home-dashboard">
                <section class="home-time-card yzp-home-time-card yzp-home-floating-time${timeCardImage ? ' has-image' : ''}${cardDate.isAncient ? ' is-ancient' : ''}"${timeCardImageStyle}>
                    <div class="home-time-info yzp-home-time-info">
                        <div class="time-large yzp-home-time-large">${this.getCurrentTime()}</div>
                        <div class="home-time-date yzp-home-time-date">
                            <div class="date yzp-home-date">${this._escapeHtml(cardDate.date)}</div>
                            <div class="home-time-weekday yzp-home-time-weekday"${cardDate.isAncient ? ' hidden' : ''}>${this._escapeHtml(cardDate.weekday)}</div>
                        </div>
                    </div>
                </section>

                <section class="home-app-cluster yzp-home-app-cluster">
                    <div class="home-app-cluster-scroll yzp-home-app-cluster-scroll">
                        ${this.renderClusterApps()}
                    </div>
                </section>
                ${this.renderSocialCard()}
                ${this.renderSettingsCard()}
                ${this.renderMusicCard()}
            </div>
        `;
    }

    getCardTimeImage() {
        return window.VirtualPhone?.storage?.get?.('phone-card-time-image') || null;
    }

    getAppById(appId) {
        return this.apps.find(app => app.id === appId) || null;
    }

    _escapeHtml(text) {
        return String(text ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    _getCustomIcon(appId) {
        try {
            if (window.VirtualPhone?.imageManager) {
                return window.VirtualPhone.imageManager.getAppIcon(appId);
            }
        } catch (e) {
            console.warn('获取APP图标失败:', e);
        }
        return null;
    }

    /** 三层图标回退的判定中枢（v4.92.0）。
     *  返回 { image, unified, neutral }：
     *    image   —— L1/L2 的位图 URL（L1 自定义图优先，L2 统一 SVG 次之）；走图片渲染分支。
     *    unified —— 是否命中统一 SVG 集（命中则加 `unified-icon` 类，由 CSS 统一底色/着色）。
     *    neutral —— 是否裸落 L3（无任何图，只剩 emoji）；CSS 给中性灰底，不再吃 app.color。
     *  为什么集中成一个方法：此前 5 个渲染点（网格/社交行/自由布局/库/dock）各自
     *  手写同一串三元判断，彩色块兜底在 5 处各复制了一遍 —— 统一视觉必须一处改完。 */
    _iconPresentation(app) {
        const id = app && app.id;
        const custom = this._getCustomIcon(id) || String(app?.defaultIcon || '').trim() || null;
        const uni = custom ? null : unifiedIconOf(id);
        const image = custom || uni || null;
        return { image, unified: !!uni, neutral: !image };
    }
    /** L2/L3 的容器 style：统一集走 tint 着色，裸落 emoji 不给背景色（交给 CSS 中性底）。 */
    _iconFallbackStyle() {
        return `--unified-tint:${UNIFIED_ICON_TINT};`;
    }
    _getAppIconImage(app) {
        if (!app) return null;
        return this._getCustomIcon(app.id) || String(app.defaultIcon || '').trim() || null;
    }

    _buildCustomIconStyle(iconUrl, { fit = 'contain' } = {}) {
        const safeUrl = String(iconUrl || '').trim();
        if (!safeUrl) return '';
        const escapedUrl = safeUrl
            .replace(/\\/g, '/')
            .replace(/'/g, "\\'")
            .replace(/\)/g, '\\)');
        return [
            `background-image: url('${escapedUrl}')`,
            `background-size: ${fit}`,
            'background-position: center',
            'background-repeat: no-repeat',
            'background-color: transparent'
        ].join('; ') + ';';
    }

    _renderCustomIconImage(iconUrl, className = 'home-custom-icon-img') {
        const safeUrl = String(iconUrl || '').trim();
        if (!safeUrl) return '';
        return `<img class="${className}" src="${this._escapeHtml(safeUrl)}" alt="" loading="eager" decoding="sync" draggable="false">`;
    }

    _getCustomAppNames() {
        try {
            const raw = window.VirtualPhone?.storage?.get?.('phone-app-custom-names');
            const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
            return (parsed && typeof parsed === 'object') ? parsed : {};
        } catch (e) {
            console.warn('读取自定义APP名称失败:', e);
            return {};
        }
    }

    _getAppDisplayName(app) {
        const customNames = this._getCustomAppNames();
        const customName = String(customNames?.[app?.id] || '').trim();
        return customName || String(app?.name || '');
    }

    renderAppGlyph(app, className = 'home-widget-icon') {
        if (!app) return '';
        const iconImage = this._getAppIconImage(app);
        if (iconImage) {
            return `<span class="${className} custom-icon" style="${this._buildCustomIconStyle(iconImage)}"></span>`;
        }
        return `<span class="${className}" style="--app-color:${app.color};">${this._escapeHtml(app.icon)}</span>`;
    }

    renderAppBadge(app) {
        return app?.badge > 0 ? `<span class="app-badge yzp-home-app-badge">${app.badge}</span>` : '';
    }

    renderMusicCard() {
        const app = this.getAppById('music');
        if (!app) return '';
        return `
            <section class="yzp-home-app-action home-widget-card yzp-home-widget-card home-music-card yzp-home-music-card" data-app="${app.id}">
                <div class="home-vinyl-player yzp-home-vinyl-player" aria-hidden="true">
                    <div class="home-vinyl-record yzp-home-vinyl-record">
                        <div class="home-vinyl-grooves yzp-home-vinyl-grooves"></div>
                        ${this.renderAppGlyph(app, 'home-vinyl-cover yzp-home-vinyl-cover')}
                    </div>
                    <div class="home-tonearm yzp-home-tonearm">
                        <div class="home-tonearm-pivot yzp-home-tonearm-pivot"></div>
                        <div class="home-tonearm-curve yzp-home-tonearm-curve">
                            <div class="home-tonearm-head yzp-home-tonearm-head"></div>
                        </div>
                    </div>
                </div>
                <div class="home-music-panel yzp-home-music-panel">
                    <div class="home-card-title yzp-home-card-title">${this._escapeHtml(this._getAppDisplayName(app))}</div>
                    <div class="home-music-controls yzp-home-music-controls" aria-hidden="true">
                        <span class="home-music-control home-music-control-prev"></span>
                        <span class="home-music-control home-music-control-pause"></span>
                        <span class="home-music-control home-music-control-next"></span>
                    </div>
                </div>
                ${this.renderAppBadge(app)}
            </section>
        `;
    }

    renderSocialCard() {
        const socialIds = ['wechat', 'weibo', 'album', 'wangxiang'];
        const socialApps = socialIds.map(id => this.getAppById(id)).filter(Boolean);
        if (socialApps.length === 0) return '';
        return `
            <section class="home-social-card yzp-home-social-card">
                ${socialApps.map(app => this.renderSocialApp(app)).join('')}
            </section>
        `;
    }

    renderSocialApp(app) {
        if (!app) return '';
        const iconImage = this._getAppIconImage(app);
        const iconStyle = iconImage
            ? this._buildCustomIconStyle(iconImage)
            : `background:${app.color};`;
        const iconContent = iconImage ? '' : this._escapeHtml(app.icon);
        const customClass = iconImage ? 'custom-icon' : '';
        return `
            <div class="app-icon yzp-home-app-action home-social-app yzp-home-social-app" data-app="${app.id}" style="--app-color:${app.color};">
                <div class="home-social-icon yzp-home-social-icon ${customClass}" style="${iconStyle}">
                    ${iconContent}
                </div>
                ${this.renderAppBadge(app)}
                <div class="home-social-name yzp-home-social-name">${this._escapeHtml(this._getAppDisplayName(app))}</div>
            </div>
        `;
    }

    renderClusterApps() {
        const clusterIds = ['honey', 'games', 'phone', 'diary', 'calendar', 'mofo'];
        return clusterIds
            .map(id => this.getAppById(id))
            .filter(Boolean)
            .map(app => this.renderFreeAppIcon(app))
            .join('');
    }

    renderFreeAppIcon(app) {
        if (!app) return '';
        const iconImage = this._getAppIconImage(app);
        const iconStyle = iconImage
            ? this._buildCustomIconStyle(iconImage)
            : `background:${app.color};`;
        const iconContent = iconImage ? '' : this._escapeHtml(app.icon);
        const customClass = iconImage ? 'custom-icon' : '';
        return `
            <div class="app-icon yzp-home-app-action home-free-icon yzp-home-free-icon" data-app="${app.id}" style="--app-color:${app.color};">
                <div class="home-app-squircle yzp-home-app-squircle ${customClass}" style="${iconStyle}">
                    ${iconContent}
                </div>
                ${this.renderAppBadge(app)}
                <div class="home-mini-name yzp-home-mini-name">${this._escapeHtml(this._getAppDisplayName(app))}</div>
            </div>
        `;
    }

    renderDiaryCard() {
        const app = this.getAppById('diary');
        if (!app) return '';
        const diaryPreview = this.getLatestDiaryPreview();
        return `
            <section class="app-icon yzp-home-app-action home-diary-card yzp-home-diary-card" data-app="${app.id}" style="--app-color:${app.color};">
                <div class="home-diary-header yzp-home-diary-header">
                    ${this.renderAppGlyph(app, 'home-diary-icon yzp-home-diary-icon')}
                    <div class="home-card-title yzp-home-card-title">${this._escapeHtml(diaryPreview.title || this._getAppDisplayName(app))}</div>
                </div>
                <div class="home-diary-copy yzp-home-diary-copy">
                    <div class="home-card-desc yzp-home-card-desc">${this._escapeHtml(diaryPreview.preview)}</div>
                </div>
                ${this.renderAppBadge(app)}
            </section>
        `;
    }

    getLatestDiaryPreview() {
        const fallback = {
            title: '日记',
            preview: '记录今天的片段、心情和那些没说出口的话。'
        };

        try {
            const saved = window.VirtualPhone?.storage?.get?.('diary_entries', null);
            const entries = typeof saved === 'string' ? JSON.parse(saved) : saved;
            if (!Array.isArray(entries) || entries.length === 0) return fallback;

            const visibleEntries = entries.filter(entry => entry && entry.offlineHidden !== true && String(entry.content || '').trim());
            if (visibleEntries.length === 0) return fallback;

            const latest = [...visibleEntries].sort((a, b) => {
                const aTime = Number(a.createdAt) || this._dateToTimestamp(a.date || a.content) || 0;
                const bTime = Number(b.createdAt) || this._dateToTimestamp(b.date || b.content) || 0;
                return bTime - aTime;
            })[0];

            const rawContent = String(latest.content || '').replace(/\r\n/g, '\n').trim();
            const title = String(latest.title || this._extractDiaryTitle(rawContent) || '日记').trim();
            const preview = this._buildDiaryPreview(rawContent, title) || fallback.preview;

            return { title, preview };
        } catch (e) {
            console.warn('读取首页日记预览失败:', e);
            return fallback;
        }
    }

    _extractDiaryTitle(content) {
        const titleMatch = String(content || '').match(/【([^】]+)】/);
        if (titleMatch && !/\d{1,6}年/.test(titleMatch[1])) return titleMatch[1];
        const firstLine = String(content || '').split('\n').map(line => line.trim()).find(Boolean);
        return firstLine && firstLine.length <= 24 ? firstLine.replace(/^#+\s*/, '') : '';
    }

    _buildDiaryPreview(content, title) {
        const normalizedTitle = String(title || '').trim();
        return String(content || '')
            .replace(/【[^】]*】/g, '')
            .split('\n')
            .map(line => line.trim())
            .filter(line => line && line !== normalizedTitle && !/^[-—]{2,}/.test(line))
            .join(' ')
            .replace(/\s+/g, ' ')
            .slice(0, 72);
    }

    _dateToTimestamp(value) {
        const text = String(value || '');
        const match = text.match(/(\d{4})年(\d{1,2})月(\d{1,2})日/);
        if (!match) return 0;
        return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])).getTime() || 0;
    }

    renderFeatureCard(appId) {
        const app = this.getAppById(appId);
        if (!app) return '';
        return this.renderFreeAppIcon(app);
    }

    renderSettingsCard() {
        const app = this.getAppById('settings');
        if (!app) return '';
        return `
            <section class="yzp-home-app-action home-settings-card yzp-home-settings-card" data-app="${app.id}">
                <div class="home-settings-left yzp-home-settings-left">
                    ${this.renderAppGlyph(app, 'home-settings-icon yzp-home-settings-icon')}
                    <div class="home-settings-title yzp-home-settings-title">${this._escapeHtml(this._getAppDisplayName(app))}</div>
                </div>
                <div class="home-settings-chevron yzp-home-settings-chevron">›</div>
                ${this.renderAppBadge(app)}
            </section>
        `;
    }

    // 🔥 获取快捷栏配置
    getDockApps() {
        const storage = window.VirtualPhone?.storage;
        let dockAppIds = ['wechat', 'weibo', 'phone', 'settings']; // 默认4个

        if (storage) {
            const saved = storage.get('dock-apps');
            if (saved) {
                try {
                    dockAppIds = JSON.parse(saved);
                } catch (e) {
                    console.warn('解析dock配置失败:', e);
                }
            }
        }

        // 根据ID获取完整的app信息
        return dockAppIds.map(id => this.apps.find(app => app.id === id)).filter(Boolean);
    }

    // 🔥 渲染底部快捷栏
    renderDock() {
        const dockApps = this.getDockApps();

        return dockApps.map(app => {
            const iconImage = this._getAppIconImage(app);

            const iconStyle = iconImage
                ? this._buildCustomIconStyle(iconImage)
                : '';

            const customClass = iconImage ? 'custom-icon' : '';
            const iconContent = iconImage ? '' : app.icon;

            const a11y = iconA11yName({ displayName: this._getAppDisplayName(app), name: app.name, ariaLabel: app.ariaLabel });
            const ariaAttr = a11yNameUsable(a11y) ? ` aria-label="${this._escapeHtml(a11y.name)}"` : '';

            return `
                <div class="dock-app yzp-home-dock-app ${customClass}" data-app="${app.id}" style="${iconStyle}" role="button" tabindex="0"${ariaAttr}>
                    ${iconContent}
                </div>
            `;
        }).join('');
    }
    
    /* [v4.92.0] 渲染聚合壳（像素文件夹）桌面图标。
     *   点击不进 phone:openApp，而是 openCluster 打开聚合壳弹窗（二级列表）。 */
    renderClusterTile(cluster) {
        const memberColors = (cluster.members || []).slice(0, 4).map(m => m.color).filter(Boolean);
        const svg = folderIconSvg(cluster.iconBg, memberColors);
        const url = svgToDataUri(svg);
        const name = this._escapeHtml(cluster.name || '文件夹');
        return `
            <div class="app-icon yzp-home-app-icon yzp-home-app-action app-cluster-tile" data-cluster="${this._escapeHtml(cluster.clusterOf)}" role="button" tabindex="0" aria-label="${name}">
                <div class="app-icon-bg yzp-home-app-icon-bg app-cluster-icon" style="background-image:url('${url}');background-size:contain;background-position:center;background-repeat:no-repeat;background-color:transparent;"></div>
                <div class="app-name yzp-home-app-name" aria-hidden="true">${name}</div>
            </div>
        `;
    }
    /* [v4.92.0] 打开聚合壳弹窗：列出该类目下全部 App，点击打开。
     *   视图栈压入 cluster 层，B 键（左下「◀ 退」）退回桌面。 */
    openCluster(categoryId) {
        const all = Array.isArray(this.apps) ? this.apps : [];
        const members = all.filter(a => a && !isCoreDesktop(a.id) && (a.libraryCategory || 'system') === categoryId);
        const cat = clusterByCategory(categoryId) || { name: '文件夹', hint: '' };
        const items = members.map(app => {
            const pres = this._iconPresentation(app);
            const uni = unifiedIconOf(app.id);
            const img = uni || pres.image;
            const iconHtml = img
                ? this._renderCustomIconImage(img, 'home-custom-icon-img')
                : `<span class="app-icon-emoji">${this._escapeHtml(app.icon)}</span>`;
            return `<div class="cluster-app-item" data-app="${app.id}" role="button" tabindex="0" aria-label="${this._escapeHtml(this._getAppDisplayName(app))}">
                <div class="cluster-app-icon pxbox pxcorner">${iconHtml}</div>
                <div class="cluster-app-name">${this._escapeHtml(this._getAppDisplayName(app))}</div>
            </div>`;
        }).join('');
        const html = `
            <div class="cluster-modal pxbox pxcorner-lg" role="dialog" aria-label="${this._escapeHtml(cat.name)}">
                <div class="cluster-modal-head">
                    <span class="cluster-modal-title">${this._escapeHtml(cat.name)}</span>
                    <span class="cluster-modal-count">${members.length}</span>
                </div>
                <div class="cluster-modal-grid">${items}</div>
                <div class="cluster-modal-hint">◀ 退 返回桌面</div>
            </div>
        `;
        this._viewStack.push(VIEW_LEVEL.CLUSTER, categoryId, () => this.closeCluster());
        this.phoneShell.setContent(html, 'view-cluster');
        this._bindClusterEvents();
    }
    _bindClusterEvents() {
        const host = this.phoneShell?.screen;
        if (!host) return;
        host.querySelectorAll('.cluster-app-item').forEach(el => {
            const open = () => {
                const appId = el?.dataset?.app;
                if (!appId) return;
                this._viewStack.push(VIEW_LEVEL.APP, appId);
                window.dispatchEvent(new CustomEvent('phone:openApp', { detail: { appId } }));
            };
            el.addEventListener('click', open);
            el.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
            });
        });
    }
    /* 关闭聚合壳（B 键出栈时由 onExit 调用）：回到桌面。 */
    closeCluster() {
        try { this.phoneShell?.goHome?.(); } catch (_e) { /* 不抛 */ }
    }
    /* [v4.92.0] 像素 B 键（左下「◀ 退」）的统一入口：出栈一级；根层级抖动。 */
    pressPixelBack() {
        const r = this._viewStack.back();
        if (r.shook) {
            const el = this.phoneShell?.screen;
            if (el) {
                el.classList.remove('px-shake');
                void el.offsetWidth;
                el.classList.add('px-shake');
            }
            return r;
        }
        /* 出了栈：若是回到桌面则显式回主页（聚合壳/详情都收拢）。 */
        if (r.level === VIEW_LEVEL.DESKTOP) this.closeCluster();
        return r;
    }

    renderAppIcon(app) {
        /* [v4.92.0] 聚合壳走独立渲染分支（文件夹像素图标 + 聚合壳弹窗）；
         *   普通核心 App 走像素图标（L1 像素 SVG 优先，L2 自定义图，L3 中性 emoji）。 */
        if (app && app.isCluster) return this.renderClusterTile(app);
        const badge = app.badge > 0 ? `<span class="app-badge">${app.badge}</span>` : '';
        /* 像素 OS：统一像素图标（unifiedIconOf）优先于 PNG/自定义图，
         *   让桌面回到单一视觉语言；无像素图才退回原 defaultIcon/emoji。 */
        const uni = unifiedIconOf(app.id);
        const iconImage = uni || this._getAppIconImage(app);

        const iconStyle = '';
        const iconContent = iconImage
            ? this._renderCustomIconImage(iconImage, 'home-custom-icon-img yzp-home-custom-icon-img')
            : `<span class="app-icon-emoji yzp-home-app-icon-emoji">${app.icon}</span>`;
        const customClass = iconImage ? 'custom-icon' : '';

        /* [v3.93.0 · R-X9] 可读名与键盘可达**在同一处**给：名字取不到就如实空串
         *   （内核 a11yNameOf 的口径：不编「按钮」）—— 此时只加 tabindex/role，
         *   不加空的 aria-label（加了等于告诉读屏「这个控件的名字是空字符串」）。 */
        const a11y = iconA11yName({ displayName: this._getAppDisplayName(app), name: app.name, ariaLabel: app.ariaLabel });
        const ariaAttr = a11yNameUsable(a11y) ? ` aria-label="${this._escapeHtml(a11y.name)}"` : '';

        return `
            <div class="app-icon yzp-home-app-icon yzp-home-app-action" data-app="${app.id}" style="--app-color: ${app.color}" role="button" tabindex="0"${ariaAttr}>
                <div class="app-icon-bg yzp-home-app-icon-bg ${customClass}" style="${iconStyle}">
                    ${iconContent}
                </div>
                ${badge}
                <div class="app-name yzp-home-app-name" aria-hidden="true">${this._escapeHtml(this._getAppDisplayName(app))}</div>
            </div>
        `;
    }
    
    bindEvents() {
        /* 图标句柄在**同一处**挂三种激活方式：点击 / 键盘 Enter / 键盘 Space。
         *   为什么 Space 要 preventDefault：浏览器默认会用 Space 滚动页面，
         *   不拦住就会「按下空格时图标被激活 + 桌面同时滚了一段」（两个后果，其中一个没人要）。 */
        const icons = this.phoneShell.screen.querySelectorAll('.yzp-home-app-action, .yzp-home-dock-app, .app-icon, .dock-app');
        icons.forEach(icon => {
            const activate = () => {
                /* [v4.92.0] 聚合壳（像素文件夹）优先：data-cluster 在 → 开聚合壳弹窗，
                 *   不走 phone:openApp（它不是真 App，没有路由）。 */
                const clusterId = icon.dataset.cluster;
                if (clusterId) { this.openCluster(clusterId); return; }
                const appId = icon.dataset.app;
                if (!appId) return;
                this.openApp(appId);
            };
            icon.onclick = (e) => {
                e.stopPropagation();
                const clusterId = icon.dataset.cluster;
                if (clusterId) { this.openCluster(clusterId); return; }
                const appId = icon.dataset.app;
                this.openApp(appId);
            };
            /* 键盘：只在图标自身聚焦时响应（不装到 document 上 —— 那会与 App 内的
             *   输入框抢按键）。Enter 与 Space 都走同一个 activate()。 */
            icon.onkeydown = (e) => {
                if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return;
                e.preventDefault();
                e.stopPropagation();
                activate();
            };
        });

        // [v3.56.0] 桌面图标分页（水平滑动 / 点页码）。卡片布局没有 pager，函数内部自行短路。
        this.bindIconPager();

        // 监听壁纸更新
        // [v2.31.0] 四处 `window.addEventListener` 改为经实例域登记：`_xxxEventBound`
        //   只解决「同一实例内不重复绑」，解决不了「实例被丢弃后仍在绑着」。
        //   登记后 handler 由域持有，宿主可在丢弃实例前精确解绑（无需重构回调本体）。
        if (!this._wallpaperEventBound) {
            this._wallpaperEventBound = true;
            this._rt.addListener(window, 'phone:updateWallpaper', (e) => {
                this.render({ forceDomRefresh: true });
            }, false, 'home:updateWallpaper');
        }

        // 监听APP图标更新
        if (!this._appIconEventBound) {
            this._appIconEventBound = true;
            this._rt.addListener(window, 'phone:updateAppIcon', () => {
                this.render({ forceDomRefresh: true });
            }, false, 'home:updateAppIcon');
        }

        if (!this._cardLayoutCssEventBound) {
            this._cardLayoutCssEventBound = true;
            this._rt.addListener(window, 'phone:updateCardLayoutCss', () => {
                this.applyCardLayoutCustomCss();
            }, false, 'home:updateCardLayoutCss');
        }

        if (!this._timeUpdateEventBound) {
            this._timeUpdateEventBound = true;
            this._rt.addListener(window, 'phone:timeUpdated', () => {
                this.updateTimeDisplay();
            }, false, 'home:timeUpdated');
        }
    }

    /**
     * [v2.31.0] 实例销毁：回收本实例在 window 上注册的全部长期存活监听器。
     * 幂等；调用后实例不应再被使用（render 会重新登记）。
     * @returns {number} 实际回收项数
     */
    destroy() {
        let n = 0;
        try { n = this._rt ? this._rt.dispose() : 0; } catch (_e) { /* 回收失败不阻断重建 */ }
        this._wallpaperEventBound = false;
        this._appIconEventBound = false;
        this._cardLayoutCssEventBound = false;
        this._timeUpdateEventBound = false;
        return n;
    }
    
    openApp(appId) {
        /* [v4.87.0] 「应用库」入口是**渲染层伪 App**，不在 APPS 里、没有路由分支
         *   （否则 registry-audit 的 R1 会立刻把它判成孤儿）。故它在这里分流。 */
        if (appId === APP_LIBRARY_ENTRY_ID) {
            this.openLibrary();
            return;
        }
        window.dispatchEvent(new CustomEvent('phone:openApp', { 
            detail: { appId } 
        }));
    }

    _isLobbyMode(context = null) {
        const ctx = context || window.VirtualPhone?.storage?.getContext?.() || window.SillyTavern?.getContext?.() || {};
        const charName = String(ctx?.name2 || '').trim();
        if (/^SillyTavern System$/i.test(charName)) return true;
        const chatId = String(ctx?.chatMetadata?.file_name || ctx?.chatId || '').trim();
        if (chatId) return false;
        return !charName;
    }

    _isStorageTruthy(key) {
        const raw = window.VirtualPhone?.storage?.get?.(key);
        return raw === true || raw === 'true' || raw === 1;
    }

    _isStorageEnabledByDefault(key) {
        const raw = window.VirtualPhone?.storage?.get?.(key);
        if (raw === undefined || raw === null || raw === '') return true;
        return raw === true || raw === 'true' || raw === 1;
    }

    _shouldUseRealTimeForPhoneDisplay() {
        const context = window.VirtualPhone?.storage?.getContext?.() || window.SillyTavern?.getContext?.() || {};
        const isLobby = this._isLobbyMode(context);
        const onlineOnlyKey = isLobby ? 'phone_lobby_wechat_online_only_mode' : 'wechat_online_only_mode';
        const interopKey = isLobby ? 'phone_lobby_wechat_online_mode' : 'wechat_online_mode';
        const realTimeKey = isLobby ? 'phone_lobby_wechat_online_only_real_time_enabled' : 'wechat_online_only_real_time_enabled';
        return this._isStorageTruthy(onlineOnlyKey)
            && !this._isStorageTruthy(interopKey)
            && this._isStorageEnabledByDefault(realTimeKey);
    }

    _getCurrentPhoneTimeInfo() {
        const timeManager = window.VirtualPhone?.timeManager;
        if (timeManager) {
            if (this._shouldUseRealTimeForPhoneDisplay() && typeof timeManager.getRealTime === 'function') {
                return timeManager.getRealTime();
            }
            return timeManager.getCurrentStoryTime();
        }

        const now = new Date();
        const weekdays = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
        return {
            time: now.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }),
            date: `${now.getFullYear()}年${String(now.getMonth() + 1).padStart(2, '0')}月${String(now.getDate()).padStart(2, '0')}日`,
            weekday: weekdays[now.getDay()],
            isReal: true
        };
    }

    getCurrentTime() {
        return this._getCurrentPhoneTimeInfo()?.time || '';
    }
    
    getCurrentDate() {
        const currentTime = this._getCurrentPhoneTimeInfo();
        if (currentTime?.isAncient && currentTime.date) {
            return String(currentTime.date).trim();
        }
        const dateParts = currentTime?.date?.match(/(\d+)年(\d+)月(\d+)日/);
        if (dateParts) {
            const year = parseInt(dateParts[1]);
            const month = parseInt(dateParts[2]);
            const day = parseInt(dateParts[3]);
            return `${year}年${month}月${day}日 ${currentTime.weekday || ''}`.trim();
        }
    
        const now = new Date();
        const weekdays = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
        const year = now.getFullYear();
        const month = now.getMonth() + 1;
        const day = now.getDate();
        const weekday = weekdays[now.getDay()];
        return `${year}年${month}月${day}日 ${weekday}`;
    }

    getCurrentDateParts() {
        const currentTime = this._getCurrentPhoneTimeInfo();
        if (currentTime?.isAncient && currentTime.date) {
            return {
                date: String(currentTime.date).trim(),
                weekday: '',
                isAncient: true,
            };
        }

        const dateText = this.getCurrentDate() || '';
        const match = dateText.match(/^(.+?日)\s*(.+)$/);
        if (match) {
            return {
                date: match[1],
                weekday: match[2],
                isAncient: false,
            };
        }
        return {
            date: dateText,
            weekday: '',
            isAncient: false,
        };
    }

    updateTimeDisplay() {
        const root = this.phoneShell?.screen?.querySelector('.home-screen');
        if (!root) return false;

        const currentTime = this.getCurrentTime() || '';
        const currentDate = this.getCurrentDate() || '';
        const cardDate = this.getCurrentDateParts();

        root.querySelectorAll('.home-time, .yzp-home-time, .home-time-card, .yzp-home-time-card').forEach(el => {
            el.classList.toggle('is-ancient', cardDate.isAncient);
        });

        root.querySelectorAll('.time-large, .yzp-home-time-large').forEach(el => {
            el.textContent = currentTime;
        });
        root.querySelectorAll('.home-time > .date, .yzp-home-time > .yzp-home-date').forEach(el => {
            el.textContent = currentDate;
        });
        root.querySelectorAll('.home-time-date .date, .yzp-home-time-date .yzp-home-date').forEach(el => {
            el.textContent = cardDate.date;
        });
        root.querySelectorAll('.home-time-weekday, .yzp-home-time-weekday').forEach(el => {
            el.textContent = cardDate.weekday;
            el.hidden = cardDate.isAncient;
        });

        return true;
    }

}
