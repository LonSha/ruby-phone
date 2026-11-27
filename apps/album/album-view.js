import { phoneConfirm, phonePrompt } from '../../config/phone-feedback.js';
/* ========================================================
 *  RubyPhone — SillyTavern 虚拟智能手机 UI
 *  作者 (Author): LonSha
 *
 * 本仓为独立实现（Zero-Database Architecture），不含任何第三方未授权代码。
 * 对外显示名统一为 RubyPhone。
 *
 * 版权 (c) 2026 LonSha。采 MIT 许可。
 * ======================================================== */

import { PHONE_CONFIG } from '../../config/apps.js';
/* [R25-O3] 媒体生命周期台账：登记 / 释放方案 / 回执。视图只执行 steps，决策全在内核（同一纪律：判据只有一处）。 */
import { ML_MAX_LIVE, mlTrack, mlReleasePlan, mlReceipt, mlBytesOfSrc } from '../../config/media-lifetime.js';
/* [v3.24.0 · L0-3] 分享面板：25 个平台图标（L0 素材第 2 类）。
 *   URL 解析只在取数口一处（`shareIconUrl`），本文件只把 key 列表画成按钮。 */
import { L0_ASSETS, shareIconUrl } from '../../config/l0-assets.js';
import { faceOf, faceHtml, FACE_ATTR } from '../../config/empty-face.js';
/* [v4.99.9 · R11-X9] 回看面：**视图不 import 桥**（判据只能有一处）。
 *   视角枚举与文案、密级可选值全部经 `AlbumData.viewerOptions()` / `secrecyChoices()`
 *   转出（与记忆侧 `MemoryApp.replayViewerOptions()` 同一条纪律）。
 *   本视图只排桥已经定好的 label / line / view。 */

/* [v4.154.0 · R21-X4] 相册 CSS 版本参数随时间角标 / 剧情日子分组一起抬（防浏览器缓存）。 */
export const ALBUM_CSS_URL = new URL('./album.css?v=1.5.0&r=20261127-album-bottomnav', import.meta.url).href;

/* [v4.212.0] 照现实（iPhone 照片）：底栏三格 = 图库 / 相簿 / 搜索。
 *   ★ 单一真源：底栏按钮、标题、面内容分派全部从这张表取，判据按形态钉它
 *     （tests/apps-album-v4.test.mjs）。加一格就在这里加一行，别处不许再写一份。
 *   · library —— 时间轴（按剧情日分组，时间不详单独成组）
 *   · albums  —— 按来源分组的相簿格（来源 = 哪个 App 存的）
 *   · search  —— 文件名 / 来源名过滤，两种空态分开说（还没输入 ≠ 输入了没结果）
 */
export const ALBUM_FACES = Object.freeze([
    { id: 'library', label: '图库', icon: 'fa-images', hint: '按时间' },
    { id: 'albums', label: '相簿', icon: 'fa-folder-open', hint: '按来源' },
    { id: 'search', label: '搜索', icon: 'fa-magnifying-glass', hint: '' },
]);

export class AlbumView {
    constructor(app) {
        this.app = app;
        this._cssLoaded = false;
        this.images = [];
        this.previewOpen = false;
        this.selectionMode = false;
        this.selectedPaths = new Set();
        this._missingImagePaths = new Set();
        this.isDeleting = false;
        this.isBulkDeleting = false;
        /* [v4.178.0] R25-O3 的四个字段在 ctor 里就位（此前靠 `||` 兜底）：
         *   一处声明，读的人不必再从 render 里反推 `_mediaLive` 什么时候才有。 */
        this._mediaLive = new Map();
        this._mediaReceipts = [];
        this._mediaReleasedTotal = 0;
        this.activeSource = 'all';
        this.sourceMenuOpen = false;
        /* [v4.99.9 · R11-X9] 回看页的**现场态**（只活在这一屏：换页即丢，不落盘）。
         *   `replayMode` 决定「相册主列表 / 回看」；`_replayPick` 是选中的节目 id；
         *   `_replayAct` 是选中的幕号；`_replayViewer` 是当前视角。
         *   ★ 这三项**都不是读数**（读数每次都从盘上现取），故不需要任何持久化。 */
        this.replayMode = false;
        this._replayPick = '';
        this._replayAct = 0;
        this._replayViewer = '';
        /* [v4.212.0] 底栏三格的当前面与搜索词 —— 都是**现场态**（换页即丢，不落盘）。
         *   相册没有「上次看的是哪一格」这种需求：每次进 App 都从图库开始，
         *   与官方一致；搜索词也不跨次保留（留着会让下一次进来看不到全部照片）。 */
        this._face = 'library';
        this._search = '';
    }

    loadCSS() {
        if (this._cssLoaded) return;
        if (document.getElementById('album-css')) {
            this._cssLoaded = true;
            return;
        }
        const link = document.createElement('link');
        link.id = 'album-css';
        link.rel = 'stylesheet';
        link.href = ALBUM_CSS_URL;
        document.head.appendChild(link);
        this._cssLoaded = true;
    }

    render() {
        this.loadCSS();
        this.images = this.app.albumData.getMedia();
        const sourceGroups = this.app.albumData.groupImagesBySource(this.images);
        if (this.activeSource !== 'all' && !sourceGroups.some(group => group.key === this.activeSource)) {
            this.activeSource = 'all';
        }
        const currentPaths = new Set(this.images.map(image => image.path));
        this.selectedPaths = new Set([...this.selectedPaths].filter(path => currentPaths.has(path)));
        if (this.images.length === 0) {
            this.selectionMode = false;
            this.selectedPaths.clear();
        }
        this.sourceMenuOpen = false;
        /* [v4.99.9 · R11-X9] 回看页与相册主列表是**同一屏的两个模式**（不是两个 App）：
         *   计划落点写的是「`apps/album/` 新增『回看』页」，故沿用相册的入口与返回键，
         *   不新开一个 App（新 App 会让「回看」在应用库里变成一个新的格子）。 */
        if (this.replayMode) {
            this.renderReplay();
            return;
        }
        const visibleImages = this.getVisibleImages();
        const selectedCount = this.selectedPaths.size;
        const allSelected = visibleImages.length > 0 && visibleImages.every(image => this.selectedPaths.has(image.path));
        const activeSourceLabel = this.getActiveSourceLabel();
        const wallpaperStyle = this.getWallpaperStyle();
        /* [v4.212.0] 标题取底栏当前格（照现实：官方顶栏写的是你所在的分区名），
         *   选择模式下仍然让位给「已选 N 项」—— 那比分区名重要。 */
        const faceLabel = this._faceLabel();
        const html = `
            <div class="album-app album-wallpaper-shell${this.selectionMode ? ' album-selecting' : ''}" data-alb-face="${this.escapeAttr(this._face)}" style="${wallpaperStyle}">
                <header class="album-header">
                    <button type="button" class="album-icon-btn" id="album-back" aria-label="返回">
                        <i class="fa-solid ${this.selectionMode ? 'fa-xmark' : 'fa-chevron-left'}"></i>
                    </button>
                    <div class="album-title-wrap">
                        <div class="album-title">${this.selectionMode ? `已选 ${selectedCount} 项` : this.escapeHtml(faceLabel)}</div>
                    </div>
                    <div class="album-header-actions">
                        ${this.selectionMode ? '' : `
                            <button type="button" class="album-replay-entry" id="album-replay-entry" aria-label="回看">
                                <i class="fa-solid fa-clock-rotate-left" aria-hidden="true"></i>
                                <span>回看</span>
                            </button>
                            <button type="button" class="album-replay-entry" id="album-voice-entry" aria-label="声音">
                                <i class="fa-solid fa-waveform-lines" aria-hidden="true"></i>
                                <span>声音</span>
                            </button>
                        `}
                        ${this.selectionMode ? `
                            <button type="button" class="album-select-btn" id="album-select-all">${allSelected ? '取消全选' : '全选'}</button>
                            <button type="button" class="album-icon-btn album-danger-btn" id="album-delete-selected" aria-label="删除所选" ${selectedCount ? '' : 'disabled'}>
                                <i class="fa-regular fa-trash-can"></i>
                            </button>
                        ` : ''}
                    </div>
                </header>
                ${this.selectionMode ? '' : this.renderSourceMenu(sourceGroups)}
                <main class="album-body">
                    ${this._renderFaceBody(visibleImages, activeSourceLabel, allSelected)}
                </main>
                ${this.selectionMode ? '' : this.renderBottomNav()}
            </div>
        `;

        this.app.phoneShell.setContent(html, 'album-main');
        /* [R25-O3] 诊断读数随渲染补写：换屏/重渲染会换出新的 `.album-app` 节点，
         *   dataset 上的 mlLive / mlReleased 跟着旧节点一起丢了 —— 那样「已释放 N」要等
         *   下一次释放才重新出现，重渲染后的人和回归都读不到。这里用实例上的真值补写。 */
        const _mlHost = document.querySelector('.album-app');
        if (_mlHost && _mlHost.dataset) {
            _mlHost.dataset.mlLive = String((this._mediaLive || new Map()).size);
            _mlHost.dataset.mlReleased = String(Number(this._mediaReleasedTotal) || 0);
        }
        requestAnimationFrame(() => this.bindEvents());
    }

    /* ══════════ [v4.212.0] 底栏三格：图库 / 相簿 / 搜索 ══════════
     * 【为什么要有这一层】改造前相册只有一屏：来源分组当主列表、搜索根本没有。
     *   官方（iPhone 照片）是「图库按时间 / 相簿按来源 / 搜索按名字」三格并列，
     *   用户找一张照片的路径完全不同 —— 所以三格不能挤成一屏的筛选器。
     * 【纪律】面判定只在 `_renderFaceBody` 一处；底栏按钮、标题、面内容全从
     *   `ALBUM_FACES` 取，别处不许再写第二份 if / 第二张标签表。
     */

    /** 当前格的中文名（取不到就回落图库，不编一个不存在的名字）。 */
    _faceLabel() {
        const hit = ALBUM_FACES.find((f) => f.id === this._face);
        return hit ? hit.label : ALBUM_FACES[0].label;
    }

    /** 面内容分派（唯一判定处）。 */
    _renderFaceBody(visibleImages, activeSourceLabel, allSelected) {
        if (this._face === 'search') return this.renderSearchFace();
        if (!this.images.length) return this.renderEmpty();
        const released = Number(this._mediaReleasedTotal) || 0;
        const toolbar = `
            <div class="album-body-toolbar">
                <span>${this.escapeHtml(activeSourceLabel)} · ${visibleImages.length} 项${released > 0 ? ` · 已释放 ${released}` : ''}</span>
                <div class="album-body-toolbar-actions">
                    <button type="button" class="album-source-filter" id="album-source-filter" aria-haspopup="menu" aria-expanded="false">
                        <span>分类</span>
                        <i class="fa-solid fa-chevron-down" aria-hidden="true"></i>
                    </button>
                    <button type="button" id="album-select-toggle">选择</button>
                </div>
            </div>`;
        /* 图库 = 时间轴（剧情日分组，时间不详单独成组）；相簿 = 来源分组（哪个 App 存的）。 */
        const body = (this._face === 'albums')
            ? this.renderSourceSections(visibleImages)
            : this.renderStoryDaySections(visibleImages);
        const tail = `<div class="album-total-count">共 ${this.images.length} 个项目${allSelected ? ' · 已全选' : ''}</div>`;
        return toolbar + body + tail;
    }

    /** 底栏（排在内容层之后，不覆盖内容；热区与 aria 都在 CSS/属性里交代）。 */
    renderBottomNav() {
        const cur = this._face;
        const tabs = ALBUM_FACES.map((f) => {
            const on = f.id === cur;
            return `
                <button type="button" class="alb-nav-btn${on ? ' is-active' : ''}" role="tab"
                        data-alb-face="${this.escapeAttr(f.id)}"
                        aria-selected="${on ? 'true' : 'false'}"${on ? ' aria-current="page"' : ''}>
                    <i class="fa-solid ${this.escapeAttr(f.icon)} alb-nav-icon" aria-hidden="true"></i>
                    <span class="alb-nav-label">${this.escapeHtml(f.label)}</span>
                </button>`;
        }).join('');
        return `<nav class="alb-nav" role="tablist" aria-label="相册分区">${tabs}</nav>`;
    }

    /** 搜索面：两种空态分开说 —— 还没输入 ≠ 输入了没结果。 */
    renderSearchFace() {
        const q = String(this._search || '').trim();
        const hits = this._matchSearch(q);
        return `
            <div class="alb-search">
                <div class="alb-search-bar">
                    <i class="fa-solid fa-magnifying-glass alb-search-icon" aria-hidden="true"></i>
                    <input type="search" id="album-search-input" class="alb-search-input"
                           value="${this.escapeAttr(this._search)}" placeholder="搜索照片（文件名 / 来源）"
                           aria-label="搜索照片" autocomplete="off">
                </div>
                <div class="alb-search-meta" id="album-search-meta">${this._searchMetaHtml(q, hits.length)}</div>
                <div class="alb-search-results" id="album-search-results">${this._searchResultsHtml(q, hits)}</div>
            </div>`;
    }

    _searchMetaHtml(q, hitCount) {
        return q
            ? `命中 ${hitCount} 项（共 ${this.images.length} 项）`
            : `共 ${this.images.length} 项 · 按文件名或来源名搜`;
    }

    _searchResultsHtml(q, hits) {
        if (hits.length) {
            return `<div class="album-grid alb-search-grid">${hits.map((image) => this.renderTile(image)).join('')}</div>`;
        }
        return q
            ? `<div class="alb-search-empty" data-search-face="no-hit">没找到「${this.escapeHtml(q)}」—— 这个相册里没有文件名或来源名带这几个字的东西。换个词，或者回图库按时间翻。</div>`
            : `<div class="alb-search-empty" data-search-face="idle">还没输入。可以按文件名，也可以按来源名（是哪个 App 存进来的）。</div>`;
    }

    /** 匹配口径只在这一处：文件名 / 路径 / 来源中文名，全部小写后子串命中。 */
    _matchSearch(q) {
        const key = String(q || '').trim().toLowerCase();
        if (!key) return [];
        return this.images.filter((image) => {
            const name = String(image?.filename || image?.path || '').toLowerCase();
            let src = '';
            try {
                src = String(this.app.albumData.getSourceDefinition(image?.sourceKey)?.label || '');
            } catch (_e) {
                src = '';
            }
            return name.includes(key) || src.toLowerCase().includes(key);
        });
    }

    getVisibleImages() {
        if (this.activeSource === 'all') return this.images;
        return this.images.filter(image => image.sourceKey === this.activeSource);
    }

    getActiveSourceLabel() {
        if (this.activeSource === 'all') return '全部来源';
        return this.app.albumData.getSourceDefinition(this.activeSource)?.label || '全部来源';
    }

    getWallpaperStyle() {
        let wallpaper = '';
        try {
            wallpaper = String(window.VirtualPhone?.imageManager?.getWallpaper?.() || '').trim();
        } catch (e) {
            wallpaper = '';
        }
        if (!wallpaper) {
            try {
                wallpaper = String(this.app?.storage?.get?.('phone-wallpaper') || '').trim();
            } catch (e) {
                wallpaper = '';
            }
        }
        if (!wallpaper) {
            wallpaper = String(PHONE_CONFIG.defaultWallpaper || '').trim();
        }
        return wallpaper
            ? `background-image: url('${this.escapeAttr(wallpaper)}'); background-size: cover; background-position: center;`
            : '';
    }

    renderSourceMenu(sourceGroups = []) {
        const options = [
            { key: 'all', label: '全部来源', icon: 'fa-images', images: this.images },
            ...sourceGroups
        ];
        return `
            <div class="album-source-popover" id="album-source-popover" aria-hidden="true">
                <button type="button" class="album-source-backdrop" data-album-source-close aria-label="关闭来源筛选"></button>
                <div class="album-source-menu" role="menu" aria-label="照片来源">
                    ${options.map(option => `
                        <button type="button" class="album-source-option${option.key === this.activeSource ? ' is-active' : ''}" data-album-source="${this.escapeAttr(option.key)}" role="menuitem">
                            <span class="album-source-badge is-${this.escapeAttr(option.key)}"><i class="fa-solid ${this.escapeAttr(option.icon)}" aria-hidden="true"></i></span>
                            <span class="album-source-option-label">${this.escapeHtml(option.label)}</span>
                            <span class="album-source-option-count">${option.images.length}</span>
                            <i class="fa-solid fa-check album-source-option-check" aria-hidden="true"></i>
                        </button>
                    `).join('')}
                </div>
            </div>
        `;
    }

    renderSourceSections(images = []) {
        const groups = this.app.albumData.groupImagesBySource(images);
        const previewMode = this.activeSource === 'all' && !this.selectionMode;
        return `
            <div class="album-source-sections">
                ${groups.map(group => {
                    const shownImages = previewMode ? group.images.slice(0, 4) : group.images;
                    const canFocus = this.activeSource === 'all' && !this.selectionMode;
                    return `
                        <section class="album-source-section" data-source-key="${this.escapeAttr(group.key)}">
                            <button type="button" class="album-source-heading" ${canFocus ? `data-album-source-focus="${this.escapeAttr(group.key)}"` : 'disabled'}>
                                <span class="album-source-badge is-${this.escapeAttr(group.key)}"><i class="fa-solid ${this.escapeAttr(group.icon)}" aria-hidden="true"></i></span>
                                <span class="album-source-heading-copy">
                                    <strong>${this.escapeHtml(group.label)}</strong>
                                    <small>${group.images.length} 项</small>
                                </span>
                                ${canFocus ? '<i class="fa-solid fa-chevron-right album-source-heading-arrow" aria-hidden="true"></i>' : ''}
                            </button>
                            <div class="album-source-section-body">
                                ${this.renderStoryDaySections(shownImages)}
                            </div>
                        </section>
                    `;
                }).join('')}
            </div>
        `;
    }

    /* ══════════ [v4.99.9 · R11-X9] 回看页 ══════════
     * 【只读已落盘记录】本页不发一句「按设定生成」，全部取数来自：
     *   · `albumData.replayLedger()` → `lpr_program_replay_v1`（已录的幕次与视角回忆）；
     *   · `albumData.vaultFace()`    → 保险箱实例（公开流 / 私密分区）。
     * 【三态文案不在这里写】读不到 / 还没录过 / 有 N 段 由桥给 label，本页只画。
     * 【视角兜底必须说出来】`isFallback:true` 时画面顶部明写「这是一句兜底叙述」——
     *   不写就等于替角色编了一段他没说过的内心。
     */

    renderReplay() {
        const ledger = this.app.albumData.replayLedger();
        const vault = this.app.albumData.vaultFace();
        /* 台账「有没有节目」看的是桥给的**条数**，不是自己比 state 字符串：
         *   count 为 0 时那三态（读不到 / 坏了 / 没录过）各自有桥写好的 label，
         *   本页只管把 label 画出来 —— 视图不另记一份状态表。 */
        const hasPrograms = !!(ledger && ledger.count > 0);
        if (!hasPrograms) {
            this._replayPick = '';
            this._replayAct = 0;
        } else if (!this._replayPick || !ledger.rows.some(r => r.id === this._replayPick)) {
            this._replayPick = ledger.rows[0].id;
            this._replayAct = 0;
        }

        const wallpaperStyle = this.getWallpaperStyle();
        const html = `
            <div class="album-app album-wallpaper-shell" style="${wallpaperStyle}">
                <header class="album-header">
                    <button type="button" class="album-icon-btn" id="album-back" aria-label="返回">
                        <i class="fa-solid fa-chevron-left"></i>
                    </button>
                    <div class="album-title-wrap">
                        <div class="album-title">回看</div>
                    </div>
                    <div class="album-header-actions">
                        <button type="button" class="album-select-btn" id="album-replay-exit">相册</button>
                    </div>
                </header>
                <main class="album-body album-replay-body">
                    ${this.renderArchiveBar()}
                    ${this.renderVaultSection(vault)}
                    ${this.renderReplayPrograms(ledger)}
                </main>
            </div>
        `;
        this.app.phoneShell.setContent(html, 'album-main');
        requestAnimationFrame(() => this.bindReplayEvents());
    }

    /* ---------- 归档条（回看台账的唯一写入口） ---------- */
    /**
     * 「把这段对话归档」：台账此前**没有人写**，回看页会永远停在「还没录过」
     *   （判据全绿、用户永远看不到东西）。这一条是那一步的入口。
     * ★ 归档只把盘上已有的对话切成幕，**一句都不生成**；
     *   连「可归档 N 幕 · M 句」这个读数也是桥给的（视图只排版）。
     */
    renderArchiveBar() {
        const pv = this.app.albumData.chatArchivePreview();
        /* 同一条纪律：视图不拿 state 字符串比对。`actCount > 0` 就是「有东西可归档」，
         *   四种「没有」各自有桥写好的 label（读不到 / 没有楼层 / 没有对白 / 已空）。 */
        const can = !!(pv && pv.actCount > 0)
            && (typeof this.app.albumData?.archiveChat === 'function');
        return `
            <section class="album-replay-block album-archive-bar">
                <div class="album-replay-block-title"><i class="fa-solid fa-box-archive"></i> 归档这段对话</div>
                <div class="album-replay-note">${this.escapeHtml((pv && pv.label) || '读不到当前对话')}</div>
                ${can ? `
                    <div class="album-vault-actions">
                        <button type="button" class="album-replay-btn" id="album-replay-archive">归档进回看台账</button>
                    </div>
                    <div class="album-replay-note" id="album-archive-msg">只截取已落盘的原文，不改写、不生成。</div>
                ` : ''}
            </section>
        `;
    }

    /* ---------- 保险箱分区 ---------- */
    renderVaultSection(vault) {
        /* ★ 判「读不到」用的是桥给的**布尔** `readable`，不是自己拿 state 字符串比对：
         *   前者是桥对「这一格能不能给用户看」的结论，后者等于视图自己也记一份状态表。
         *   `readable=false` 只发生在 `missing`（保险箱缺席 / 字段抛错）——
         *   「锁着」与「空的」都是 readable=true，要照常画。 */
        if (!vault || !vault.readable) {
            return `
                <section class="album-replay-block album-vault-block is-unreadable">
                    <div class="album-replay-block-title"><i class="fa-solid fa-lock"></i> 保险箱</div>
                    <div class="album-replay-note">${this.escapeHtml(vault?.label || '保险箱读不到')}</div>
                </section>
            `;
        }
        const locked = vault.locked;
        const rows = Array.isArray(vault.vaultRows) ? vault.vaultRows : [];
        return `
            <section class="album-replay-block album-vault-block${locked ? ' is-locked' : ' is-open'}">
                <div class="album-replay-block-title">
                    <i class="fa-solid ${locked ? 'fa-lock' : 'fa-lock-open'}"></i> 保险箱
                    <span class="album-replay-block-count">${this.escapeHtml(vault.label)}</span>
                </div>
                ${locked ? `
                    <div class="album-vault-lockbox">
                        <input type="password" id="album-vault-pin" inputmode="numeric" autocomplete="off" placeholder="输入保险箱密码" aria-label="保险箱密码" />
                        <button type="button" class="album-replay-btn" id="album-vault-unlock">解锁</button>
                    </div>
                    <div class="album-replay-note" id="album-vault-msg">锁着时画面一律不加载（不是「这里什么都没有」）。</div>
                ` : `
                    <div class="album-replay-note">已解锁。切回相册或离开本页即重新上锁。</div>
                    <div class="album-vault-actions">
                        <button type="button" class="album-replay-btn" id="album-vault-lock">重新上锁</button>
                    </div>
                `}
                ${rows.length ? `
                    <div class="album-grid album-vault-grid">
                        ${rows.map(row => this.renderVaultTile(row, locked)).join('')}
                    </div>
                ` : `
                    <div class="album-replay-note">保险箱里现在没有项目。</div>
                `}
                <div class="album-replay-note album-vault-secrecy-hint">
                    可移入的密级：${this.app.albumData.secrecyChoices().map(o => this.escapeHtml(o.label)).join(' / ')}
                </div>
            </section>
        `;
    }

    renderVaultTile(row, locked) {
        if (locked || !row.url) {
            /* 锁着：**不画 img 标签**（连 URL 都不进 DOM）。 */
            return `
                <div class="album-tile album-vault-tile is-locked" data-vault-id="${this.escapeAttr(row.id)}" title="已加密">
                    <div class="album-vault-tile-lock"><i class="fa-solid fa-lock"></i></div>
                    <span class="album-vault-tile-label">${this.escapeHtml(row.secrecyLabel)}</span>
                </div>
            `;
        }
        return `
            <div class="album-tile album-vault-tile" data-vault-id="${this.escapeAttr(row.id)}" title="${this.escapeHtml(row.title)}">
                <img src="${this.escapeAttr(row.url)}" alt="${this.escapeHtml(row.title)}" />
                <span class="album-vault-tile-label">${this.escapeHtml(row.secrecyLabel)}</span>
            </div>
        `;
    }

    /* ---------- 节目列表 + 幕次 + 三视角 ---------- */
    renderReplayPrograms(ledger) {
        /* 同上：`count === 0` 就说明没节目可画，具体是哪一种「没有」由桥的 label 说。
         *   ★ 注意这里**不**判 `acts` 那一次：`actRowsOf` 的四态各有 label，
         *     用 `acts.state === 'ok'` 是「这一格有没有行」的产品判断，不属状态表复制。 */
        if (!ledger || !(ledger.count > 0)) {
            return `
                <section class="album-replay-block">
                    <div class="album-replay-block-title"><i class="fa-solid fa-clock-rotate-left"></i> 回看节目</div>
                    <div class="album-replay-note">${this.escapeHtml(ledger.label)}</div>
                </section>
            `;
        }
        const pick = this._replayPick;
        const summary = this.app.albumData.programSummary(pick);
        const acts = this.app.albumData.programActs(pick);
        /* 选中幕号在**一处**归一：`_replayAct` 为 0（刚选节目）时落到第一幕，
         *   这样「高亮的那一幕」与「下方视角区取的那一幕」永远是同一幕。 */
        const actIndex = this._effectiveAct(acts);
        return `
            <section class="album-replay-block">
                <div class="album-replay-block-title">
                    <i class="fa-solid fa-clapperboard"></i> 回看节目
                    <span class="album-replay-block-count">${this.escapeHtml(ledger.label)}</span>
                </div>
                <div class="album-replay-program-list">
                    ${ledger.rows.map(row => `
                        <button type="button" class="album-replay-program${row.id === pick ? ' is-active' : ''}" data-replay-program="${this.escapeAttr(row.id)}">
                            <span class="album-replay-program-title">${this.escapeHtml(row.title)}</span>
                            <span class="album-replay-program-meta">${this.escapeHtml(row.occasion)} · ${row.actCount} 幕</span>
                        </button>
                    `).join('')}
                </div>
            </section>
            <section class="album-replay-block">
                <div class="album-replay-block-title"><i class="fa-solid fa-list-ol"></i> 幕次</div>
                <div class="album-replay-note">${this.escapeHtml(summary.label)}</div>
                ${acts.state === 'ok' ? `
                    <div class="album-replay-acts">
                        ${acts.rows.map(act => `
                            <button type="button" class="album-replay-act${act.actIndex === actIndex ? ' is-active' : ''}" data-replay-act="${act.actIndex}">
                                <span class="album-replay-act-index">第 ${act.actIndex} 幕</span>
                                <span class="album-replay-act-title">${this.escapeHtml(act.title)}</span>
                                <span class="album-replay-act-meta">${act.location ? this.escapeHtml(act.location) + ' · ' : ''}${this.escapeHtml(act.line)}</span>
                            </button>
                        `).join('')}
                    </div>
                ` : `
                    <div class="album-replay-note">${this.escapeHtml(acts.label)}</div>
                `}
            </section>
            ${acts.state === 'ok' ? this.renderReplayPerspective(pick, acts, actIndex) : ''}
        `;
    }

    /** 当前生效的幕号：现场态优先，否则第一幕，再否则 0（= 没有幕）。 */
    _effectiveAct(acts) {
        const rows = (acts && Array.isArray(acts.rows)) ? acts.rows : [];
        if (!rows.length) return 0;
        if (rows.some(r => r.actIndex === this._replayAct)) return this._replayAct;
        return rows[0].actIndex;
    }

    renderReplayPerspective(programId, acts, actIndex) {
        if (!actIndex) {
            return `<section class="album-replay-block"><div class="album-replay-note">选一幕再看视角。</div></section>`;
        }
        const views = this.app.albumData.programPerspectives(programId, actIndex);
        const active = views.find(v => v.kind === this._replayViewer) || views[0];
        /* [v4.99.9 · R11-X9] 在视角正下方补「这一幕当时谁能看到什么」：
         *   由**已录对白**重建逐步节目单（一句都不生成），故它答的是
         *   「有几句是我当时能听清的」——这与上面的「主观回忆」是两件事，
         *   压成一块就会把「没回忆」读成「没说过话」。 */
        const steps = this.app.albumData.programActSteps(programId, actIndex, active?.characterId || '');
        return `
            <section class="album-replay-block">
                <div class="album-replay-block-title"><i class="fa-solid fa-eye"></i> 视角</div>
                <div class="album-replay-viewer-bar">
                    ${views.map(v => `
                        <button type="button" class="album-replay-viewer${v.kind === active.kind ? ' is-active' : ''}${v.ok ? '' : ' is-unavailable'}" data-replay-viewer="${this.escapeAttr(v.kind)}">
                            ${this.escapeHtml(v.label)}${v.characterId ? '·' + this.escapeHtml(v.characterId) : ''}
                        </button>
                    `).join('')}
                </div>
                ${active.ok ? `
                    <div class="album-replay-view">
                        ${active.isFallback ? `<div class="album-replay-fallback">这段没有该角色的主观回忆，下面是一句兜底叙述（不是记录）。</div>` : ''}
                        <div class="album-replay-view-text">${this.escapeHtml(active.view)}</div>
                        <div class="album-replay-view-meta">${this.escapeHtml(active.actTitle)}${active.characterId ? ' · ' + this.escapeHtml(active.characterId) : ''}</div>
                    </div>
                ` : `
                    <div class="album-replay-note">${this.escapeHtml(active.label)}：这一格取不到（${this.escapeHtml(active.why)}）。</div>
                `}
                ${this.renderActSteps(steps)}
            </section>
        `;
    }

    /** 「这一幕当时谁能看到什么」：由已录对白重建，不生成任何一句。 */
    renderActSteps(steps) {
        if (!steps || (steps.state !== 'ok' && steps.state !== 'empty')) {
            return `<div class="album-replay-note">${this.escapeHtml((steps && steps.label) || '这一步读不到')}</div>`;
        }
        if (steps.state === 'empty') {
            return `<div class="album-replay-note">${this.escapeHtml(steps.label)}</div>`;
        }
        return `
            <div class="album-replay-steps">
                <div class="album-replay-steps-title">${this.escapeHtml(steps.label)}</div>
                ${steps.rows.map(row => `
                    <div class="album-replay-step${row.canObserveDetails ? '' : ' is-hidden-info'}">
                        <span class="album-replay-step-actor">${this.escapeHtml(row.actorId || '旁白')}</span>
                        <span class="album-replay-step-text">${this.escapeHtml(row.observedText)}</span>
                    </div>
                `).join('')}
            </div>
        `;
    }

    /* ---------- 回看页事件（每次重绘后重绑；本页无容器级委托，重复 render 不累积） ---------- */
    bindReplayEvents() {
        const root = (document.querySelector('.phone-view-current') || document).querySelector('.album-app');
        if (!root) return;
        /* [v4.178.0] 同一批节点只挂一次：同帧两次 render 各排一个 rAF，两个回调都落在
         *   **最后那一个**新根上。旧写法在这里挂第二份监听：`data-replay-program` 被点一下
         *   会 render 两遍，幕次按钮同理——观感是「点了一次，页面闪两下」。 */
        if (this._replayBoundRoot === root) return;
        this._replayBoundRoot = root;
        root.querySelector('#album-back')?.addEventListener('click', () => {
            this.exitReplay();
        });
        root.querySelector('#album-replay-exit')?.addEventListener('click', () => this.exitReplay());
        root.querySelectorAll('[data-replay-program]').forEach(btn => {
            btn.addEventListener('click', () => {
                this._replayPick = btn.dataset.replayProgram || '';
                this._replayAct = 0;
                this.render();
            });
        });
        root.querySelectorAll('[data-replay-act]').forEach(btn => {
            btn.addEventListener('click', () => {
                const n = Number.parseInt(btn.dataset.replayAct, 10);
                this._replayAct = Number.isFinite(n) ? n : 0;
                this.render();
            });
        });
        root.querySelectorAll('[data-replay-viewer]').forEach(btn => {
            btn.addEventListener('click', () => {
                this._replayViewer = btn.dataset.replayViewer || '';
                this.render();
            });
        });
        root.querySelector('#album-replay-archive')?.addEventListener('click', () => this.archiveFromUI(root));
        root.querySelector('#album-vault-unlock')?.addEventListener('click', () => this.unlockVaultFromUI(root));
        root.querySelector('#album-vault-pin')?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') this.unlockVaultFromUI(root);
        });
        root.querySelector('#album-vault-lock')?.addEventListener('click', () => {
            try { this.app.albumData?._vault?.()?.lockVault?.(); } catch (_e) { /* 忽略 */ }
            this.render();
        });
    }

    /** 归档：唯一写入口。成功才重绘（重绘会把刚写的选段显示出来）；
     *   失败把原因写在原地 —— 不重绘，免得用户以为已经收进去了。 */
    archiveFromUI(root) {
        const msg = root?.querySelector('#album-archive-msg') || null;
        let r;
        try {
            r = this.app.albumData.archiveChat();
        } catch (e) {
            if (msg) msg.textContent = '归档这一步自己坏了：' + String((e && e.message) || e);
            return;
        }
        if (r && r.ok) {
            /* 归档后选中刚写进去的那一段（否则用户看不到「刚归档的那条」）。 */
            if (r.programId) {
                this._replayPick = r.programId;
                this._replayAct = 0;
            }
            this.render();
            return;
        }
        if (msg) msg.textContent = String((r && r.note) || '归档没成（没给原因）');
    }

    /** 保险箱解锁：密码判定在**内核**（含连错 3 次锁 30 秒），本视图只转述它的话。 */
    unlockVaultFromUI(root) {
        const vault = this.app.albumData?._vault?.() || null;
        const msg = root?.querySelector('#album-vault-msg') || null;
        if (!vault || typeof vault.unlockVault !== 'function') {
            if (msg) msg.textContent = '保险箱读不到（不是「密码错了」）。';
            return;
        }
        const pin = String(root?.querySelector('#album-vault-pin')?.value || '').trim();
        let r;
        try {
            r = vault.unlockVault(pin);
        } catch (e) {
            if (msg) msg.textContent = '解锁这一步自己坏了：' + String((e && e.message) || e);
            return;
        }
        if (r && r.success) {
            this.render();
            return;
        }
        if (msg) msg.textContent = String((r && r.message) || '解锁失败（内核没给原因）');
        /* [v4.178.0] 错一次就清空并聚焦：内核连错 3 次要锁 30 秒，输入框留着上一串错密码时，
         *   用户再按一次回车就是又白烧一次机会——而他自己看不出这下按的是旧串还是新的。 */
        const pinEl = root?.querySelector('#album-vault-pin');
        if (pinEl) {
            pinEl.value = '';
            try { pinEl.focus?.(); } catch (_e) { /* 忽略 */ }
        }
    }

    /** 离开回看页：**顺手重新上锁**（保险箱不跟着模式切换一直开着）。 */
    exitReplay() {
        try { this.app.albumData?._vault?.()?.lockVault?.(); } catch (_e) { /* 忽略 */ }
        this.replayMode = false;
        this._replayPick = '';
        this._replayAct = 0;
        this.render();
    }

    renderTile(image) {
        const index = this.images.indexOf(image);
        const isVideo = image?.mediaType === 'video';
        const mediaHtml = isVideo
            ? `<video src="${this.escapeAttr(image.src)}" muted playsinline webkit-playsinline preload="metadata" aria-hidden="true"></video><span class="album-video-indicator" aria-hidden="true"><i class="fa-solid fa-play"></i></span>`
            : `<img src="${this.escapeAttr(image.src)}" alt="">`;
        /* [v4.154.0 · R21-X4] 时间角标：时间不详的照片**明说**「时间不详」——
         *   判定与文案全走数据层出口（桥的单一口径），这里只排版。 */
        const undated = this.app.albumData.isImageUndated(image);
        const stamp = this.app.albumData.storyStampOfImage(image);
        const timeBadge = undated
            ? `<span class="album-tile-time is-undated">📷 时间不详</span>`
            : (stamp.dateKey ? `<span class="album-tile-time">${this.escapeHtml(stamp.dateKey)}</span>` : '');
        return `
            <div class="album-tile${isVideo ? ' is-video' : ''}${this.selectedPaths.has(image.path) ? ' selected' : ''}" data-index="${index}" title="${this.escapeHtml(image.filename)}">
                <button type="button" class="album-tile-main" data-index="${index}" aria-label="${this.selectionMode ? '选择' : '查看'}${isVideo ? '视频' : '图片'}">
                    ${mediaHtml}
                    <span class="album-checkmark"><i class="fa-solid fa-check"></i></span>
                </button>
                ${timeBadge}
            </div>
        `;
    }

    /* ══════════ [v4.154.0 · R21-X4] 剧情日子分组 ══════════
     * 【为什么在来源分组之下再切日子】来源（哪个 App 存的）与日期（什么时候拍的）
     *   是两个正交的轴；来源轴沿用既有 `renderSourceSections`，日期轴在本方法里
     *   对**每个来源组内部**再按剧情日切一层。判定（谁进「📷 时间不详」）只在
     *   `album-story-face.js` 一处；组 label 只写剧情历日期，不冒充「今天」。 */
    renderStoryDaySections(images = []) {
        const groups = this.app.albumData.groupImagesByStoryDay(images);
        /* [v4.154.0 · R21-X4] 汇总行消费 `photoTimeSummary` 的如实计数：
         *   「带拍摄时刻 / 时间不详」各是多少，一眼可见——时间不详不但单独成组，
         *   还在这里被**点名**，绝不悄悄混进某个日期组。 */
        const summary = this.app.albumData.photoTimeSummary(images);
        const summaryNote = (summary && summary.total > 0)
            ? `<div class="album-story-day-note">${this.escapeHtml(`本组 ${summary.total} 项 · ${summary.dated} 项带拍摄时刻 · ${summary.undated} 项时间不详（不按保存时间倒推）`)}</div>`
            : '';
        return `${summaryNote}` + groups.map(group => `
            <section class="album-story-day-section${group.undated ? ' is-undated' : ''}" data-day-key="${this.escapeAttr(group.key)}">
                <div class="album-story-day-heading">
                    <strong>${this.escapeHtml(group.label)}</strong>
                    <small>${group.images.length} 项</small>
                </div>
                <div class="album-grid">
                    ${group.images.map(image => this.renderTile(image)).join('')}
                </div>
            </section>
        `).join('');
    }

    /**
     * [v4.108.0 · R13-O6] 空态分形：三种处境不许再用同一句话。
     *
     * 本页真实存在的三种处境：
     *   · 一张都没有                    ⇒ empty   「还没有图片或视频」
     *   · 有，但当前分类滤空了          ⇒ blocked 「当前条件下没有图片」（处置：清筛选）
     *   · 数据面读失败（列表没上来）    ⇒ absent  「相册这会儿打不开」（处置：看诊断）
     * 三者处置相反，故文案与 data-face-why 必须都不同。
     */
    renderEmpty() {
        const face = this._emptyFace();
        const code = face.code;
        const title = this.escapeHtml(face.title);
        const copy = code === 'filtered-out'
            ? '<button type="button" class="album-empty-clear" id="album-empty-clear-filter">清除筛选条件</button>'
            : (code === 'read-failed'
                ? '<div class="album-empty-copy">列表没能读上来，这不等于相册是空的。可到诊断中心看存储读取面。</div>'
                : '<div class="album-empty-copy">各个 App 保存过的图片和视频会按来源显示在这里。</div>');
        return `<div class="album-empty" ${FACE_ATTR}="${code}" data-face="${face.face}">
                    <div class="album-empty-icon"><i class="fa-regular fa-images"></i></div>
                    <div class="album-empty-title">${title}</div>
                    ${copy}
                </div>`;
    }

    /** 判定当前该报哪一态（判定只在这一处，不许散进渲染函数）。 */
    _emptyFace() {
        const total = Array.isArray(this.images) ? this.images.length : 0;
        const filtering = !!(this.activeSource && this.activeSource !== 'all');
        const f = faceOf({ items: this.images, filtered: total > 0 && filtering });
        if (f.face === 'blocked') return { face: f.face, code: f.code, title: '当前条件下没有图片' };
        if (f.face === 'absent') return { face: f.face, code: f.code, title: '相册这会儿打不开' };
        return { face: 'empty', code: 'no-data', title: '还没有图片或视频' };
    }
    bindEvents() {
        const root = (document.querySelector('.phone-view-current') || document).querySelector('.album-app');
        if (!root) return;
        /* [v4.178.0] 同一批节点只挂一次（重绘会换节点，故按根节点身份判重，不必手工解绑）。
         *   修前同帧两次 render ⇒ 两个 rAF 都绑在同一个新根上：分类按钮里那句
         *   `this.sourceMenuOpen = !this.sourceMenuOpen` 会翻转两次，等于菜单点不开；
         *   点照片则会开两遍预览（多登记一个媒体句柄，只能等 FIFO 挤出去）。 */
        if (this._boundRoot === root) return;
        this._boundRoot = root;
        root.querySelector('#album-back')?.addEventListener('click', () => {
            if (this.selectionMode) {
                this.selectionMode = false;
                this.selectedPaths.clear();
                this.render();
                return;
            }
            if (this.activeSource !== 'all') {
                this.activeSource = 'all';
                this.render();
                return;
            }
            window.dispatchEvent(new CustomEvent('phone:goHome'));
        });
        /* [v4.99.9 · R11-X9] 进「回看」：只翻一个现场标志，不新开 App、不动落盘。 */
        root.querySelector('#album-replay-entry')?.addEventListener('click', () => {
            this.replayMode = true;
            this.sourceMenuOpen = false;
            this.render();
        });
        /* [v4.102.0 · R13-O3] 进「声音」：交给 AlbumApp.openVoice（视图自己不持局）。 */
        root.querySelector('#album-voice-entry')?.addEventListener('click', () => {
            this.sourceMenuOpen = false;
            this.app.openVoice?.();
        });
        root.querySelector('#album-source-filter')?.addEventListener('click', () => {
            this.sourceMenuOpen = !this.sourceMenuOpen;
            root.querySelector('#album-source-popover')?.classList.toggle('is-open', this.sourceMenuOpen);
            root.querySelector('#album-source-popover')?.setAttribute('aria-hidden', String(!this.sourceMenuOpen));
            root.querySelector('#album-source-filter')?.setAttribute('aria-expanded', String(this.sourceMenuOpen));
        });
        root.querySelector('[data-album-source-close]')?.addEventListener('click', () => this.closeSourceMenu(root));
        root.querySelectorAll('[data-album-source]').forEach(option => {
            option.addEventListener('click', () => {
                this.activeSource = option.dataset.albumSource || 'all';
                this.selectedPaths.clear();
                this.render();
            });
        });
        root.querySelectorAll('[data-album-source-focus]').forEach(heading => {
            heading.addEventListener('click', () => {
                this.activeSource = heading.dataset.albumSourceFocus || 'all';
                this.render();
            });
        });
        root.querySelector('#album-select-toggle')?.addEventListener('click', () => {
            this.selectionMode = true;
            this.selectedPaths.clear();
            this.render();
        });
        root.querySelector('#album-select-all')?.addEventListener('click', () => this.toggleSelectAll());
        root.querySelector('#album-delete-selected')?.addEventListener('click', () => this.deleteSelectedImages());
        /* [v4.212.0] 格子绑定抽成一处：搜索面输入时会**新建**结果格节点，
         *   那条路径也要挂同一套点击/错误处理 —— 复制一份就是两条会漂移的实现。 */
        this._bindTiles(root);
        /* [v4.212.0] 底栏三格：切面不整页刷新数据（images 已在 render 里取过），
         *   只换面 + 重画。选择态在手时先清掉（换面后索引全变，留着会选错人）。 */
        root.querySelectorAll('.alb-nav-btn').forEach((btn) => {
            btn.addEventListener('click', () => {
                const next = btn.dataset.albFace || ALBUM_FACES[0].id;
                if (next === this._face) return;
                this._face = next;
                this.sourceMenuOpen = false;
                this.selectionMode = false;
                this.selectedPaths.clear();
                this.render();
                /* 官方的搜索格一进去光标就在框里 —— 这里也聚焦一次，省一次点击。
                 *   注意必须取**新**节点：render 已经把整棵子树换掉了。 */
                if (next === 'search') {
                    requestAnimationFrame(() => {
                        (document.querySelector('.phone-view-current') || document).querySelector('#album-search-input')?.focus?.();
                    });
                }
            });
        });
        /* [v4.212.0] 搜索输入：只重画结果区（整页重绘会丢焦点与光标位置）。 */
        const searchInput = root.querySelector('#album-search-input');
        if (searchInput) {
            searchInput.addEventListener('input', () => {
                this._search = searchInput.value;
                const q = String(this._search || '').trim();
                const hits = this._matchSearch(q);
                const meta = root.querySelector('#album-search-meta');
                if (meta) meta.textContent = this._searchMetaHtml(q, hits.length);
                const box = root.querySelector('#album-search-results');
                if (box) {
                    box.innerHTML = this._searchResultsHtml(q, hits);
                    this._bindTiles(box);
                }
            });
        }
    }

    /** 格子（点击预览 / 选择 + 两种媒体各自的错误面）：只挂一次，按容器身份判重。 */
    _bindTiles(scope) {
        const host = scope || document;
        host.querySelectorAll('.album-tile-main').forEach(tile => {
            tile.addEventListener('click', () => {
                const index = Number.parseInt(tile.dataset.index, 10);
                if (this.selectionMode) {
                    this.toggleSelected(index);
                    return;
                }
                this.openPreview(index);
            });
        });
        host.querySelectorAll('.album-tile img').forEach(img => {
            img.addEventListener('error', async () => {
                img.closest('.album-tile')?.classList.add('is-broken');
                const index = Number.parseInt(img.closest('.album-tile')?.dataset?.index || '', 10);
                const image = Number.isFinite(index) ? this.images[index] : null;
                await this.handleMissingImage(image);
            }, { once: true });
        });
        host.querySelectorAll('.album-tile video').forEach(video => {
            video.pause?.();
            video.addEventListener('error', () => {
                video.closest('.album-tile')?.classList.add('is-broken');
            }, { once: true });
        });
    }

    closeSourceMenu(root = null) {
        this.sourceMenuOpen = false;
        const albumRoot = root || (document.querySelector('.phone-view-current') || document).querySelector('.album-app');
        albumRoot?.querySelector('#album-source-popover')?.classList.remove('is-open');
        albumRoot?.querySelector('#album-source-popover')?.setAttribute('aria-hidden', 'true');
        albumRoot?.querySelector('#album-source-filter')?.setAttribute('aria-expanded', 'false');
    }

    refreshSelectionUI() {
        const selectedCount = this.selectedPaths.size;
        const visibleImages = this.getVisibleImages();
        const allSelected = visibleImages.length > 0 && visibleImages.every(image => this.selectedPaths.has(image.path));
        const root = (document.querySelector('.phone-view-current') || document).querySelector('.album-app');
        const title = root?.querySelector('.album-title');
        if (title) title.textContent = this.selectionMode ? `已选 ${selectedCount} 项` : '相册';

        const selectAllBtn = root?.querySelector('#album-select-all');
        if (selectAllBtn) selectAllBtn.textContent = allSelected ? '取消全选' : '全选';

        const deleteBtn = root?.querySelector('#album-delete-selected');
        if (deleteBtn) deleteBtn.disabled = selectedCount === 0;

        root?.querySelectorAll('.album-tile').forEach(tile => {
            const index = Number.parseInt(tile.dataset.index || '', 10);
            const image = Number.isFinite(index) ? this.images[index] : null;
            tile.classList.toggle('selected', !!image && this.selectedPaths.has(image.path));
        });
    }

    async handleMissingImage(image) {
        if (!image?.path || this._missingImagePaths.has(image.path)) return;
        this._missingImagePaths.add(image.path);
        try {
            const changed = await this.app.albumData.markMissingImage?.(image.path);
            if (changed) {
                this.selectedPaths.delete(image.path);
                requestAnimationFrame(() => this.render());
            }
        } catch (e) {
            console.warn('清理失效相册图片失败:', image.path, e);
        }
    }

    toggleSelected(index) {
        const image = this.images[index];
        if (!image) return;
        if (this.selectedPaths.has(image.path)) {
            this.selectedPaths.delete(image.path);
        } else {
            this.selectedPaths.add(image.path);
        }
        this.refreshSelectionUI();
    }

    toggleSelectAll() {
        if (!this.selectionMode) return;
        const visibleImages = this.getVisibleImages();
        const allSelected = visibleImages.length > 0 && visibleImages.every(image => this.selectedPaths.has(image.path));
        if (allSelected) {
            visibleImages.forEach(image => this.selectedPaths.delete(image.path));
        } else {
            visibleImages.forEach(image => this.selectedPaths.add(image.path));
        }
        this.refreshSelectionUI();
    }

    openPreview(index) {
        const image = this.images[index];
        if (!image) return;
        const isVideo = image.mediaType === 'video';
        this.previewOpen = true;
        const root = (document.querySelector('.phone-view-current') || document).querySelector('.album-app');
        /* 换图先走一遍释放：直接 remove() 旧覆盖层会留下一条「挂过 DOM 但没人摘 src」的句柄。 */
        if (root?.querySelector('.album-preview')) this.releasePreviewMedia();
        /* [v4.178.0] 开预览前把「分类」浮层收掉：它是原地 toggle 出来的，不经过重绘，
         *   不剥这一下就会留在覆盖层后面亮着——关掉预览时用户看见一个没点过的菜单。 */
        this.closeSourceMenu(root);
        root?.querySelector('.album-preview')?.remove();
        /* [R25-O3] 打开预览就把这条媒体登记进台账：**先登记再挂 DOM**，否则「挂上了但没登记」
         *   的句柄永远没人释放（这正是修前那 20 张原图的下场）。超上限的旧句柄按计划当场释放。 */
        const _mlId = (isVideo ? 'v:' : 'i:') + String(image.path || ('idx-' + index));
        const _mlTracked = mlTrack(this._mediaLive, {
            id: _mlId,
            kind: isVideo ? 'video' : 'image',
            src: String(image.src || ''),
            at: Date.now()
        }, ML_MAX_LIVE);
        this._mediaLive = _mlTracked.state;
        this._mediaTrackRejected = _mlTracked.rejected;
        this._mediaSrcBytes = mlBytesOfSrc(image.src);

        const overlay = document.createElement('div');
        overlay.className = 'album-preview';
        overlay.dataset.mlId = _mlId;
        overlay.innerHTML = `
            <div class="album-preview-panel">
                <div class="album-preview-top">
                    <button type="button" class="album-preview-close" aria-label="关闭">
                        <i class="fa-solid fa-xmark"></i>
                    </button>
                    <button type="button" class="album-preview-share" aria-label="分享" title="分享到平台">
                        <i class="fa-solid fa-share-nodes"></i>
                    </button>
                    <button type="button" class="album-preview-delete" aria-label="删除">
                        <i class="fa-regular fa-trash-can"></i>
                    </button>
                </div>
                <div class="album-preview-image-wrap${isVideo ? ' is-video' : ''}">
                    ${isVideo
                        ? `<video class="album-preview-video" src="${this.escapeAttr(image.src)}" playsinline webkit-playsinline preload="auto"></video><button type="button" class="album-preview-video-replay" aria-label="重新播放视频" title="重新播放视频" hidden><i class="fa-solid fa-play"></i></button>`
                        : `<img class="album-preview-image" src="${this.escapeAttr(image.src)}" alt="">`}
                </div>
                <div class="album-preview-meta">
                    <div class="album-preview-name">${this.escapeHtml(image.filename)}</div>
                    <div class="album-preview-path">${this.escapeHtml(image.path)}</div>
                    <div class="album-preview-time">${this.escapeHtml(this.app.albumData.photoTimeLabelOf(image, window))}</div>
                    <div class="album-preview-tags">
                        ${image.sources.slice(0, 4).map(source => `<span>${this.escapeHtml(source)}</span>`).join('')}
                    </div>
                </div>
            </div>
        `;

        root?.appendChild(overlay);
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) this.closePreview();
        });
        overlay.querySelector('.album-preview-close')?.addEventListener('click', () => this.closePreview());
        overlay.querySelector('.album-preview-delete')?.addEventListener('click', () => this.deleteImage(image));
        overlay.querySelector('.album-preview-share')?.addEventListener('click', () => this.openShareSheet(image, overlay));

        if (isVideo) {
            const video = overlay.querySelector('.album-preview-video');
            const replayBtn = overlay.querySelector('.album-preview-video-replay');
            const setReplayVisible = visible => {
                if (!replayBtn) return;
                replayBtn.hidden = !visible;
            };
            const playOnce = () => {
                if (!video) return;
                video.loop = false;
                try {
                    video.currentTime = 0;
                } catch (e) { }
                setReplayVisible(false);
                const playPromise = video.play?.();
                if (playPromise && typeof playPromise.catch === 'function') {
                    playPromise.catch(() => setReplayVisible(true));
                }
            };
            video?.addEventListener('playing', () => setReplayVisible(false));
            video?.addEventListener('ended', () => setReplayVisible(true));
            video?.addEventListener('error', () => setReplayVisible(true));
            replayBtn?.addEventListener('click', (event) => {
                event.preventDefault();
                event.stopPropagation();
                playOnce();
            });
            playOnce();
        }
    }

    /* ==================== [v3.24.0 · L0-3] 分享面板 ====================
     *  用 L0 素材第 2 类（25 个平台图标）把「分享」做成看得见的选择列表。
     *  本仓此前**没有任何分享卡实现**（`grep share/card` 零命中），
     *  这里只落最小闭环：选平台 → 把这条媒体的引用拼成一句可粘贴的文本。
     *  · 图标全走 `shareIconUrl(key)`（白名单外返回空串，不产生破图）；
     *  · **不新增 storage 键**：分享这个动作本身不留状态（免得为动作加一条键必登记）。
     */
    openShareSheet(image, overlay) {
        if (!image || !overlay) return;
        const root = overlay.querySelector('.album-preview-panel') || overlay;
        root.querySelector('.album-share-sheet')?.remove();

        const sheet = document.createElement('div');
        sheet.className = 'album-share-sheet';
        sheet.innerHTML = `
            <div class="album-share-title">分享到</div>
            <div class="album-share-grid">
                ${L0_ASSETS.icons.map(icon => `
                    <button type="button" class="album-share-item" data-album-share="${this.escapeAttr(icon.key)}" title="${this.escapeHtml(icon.label)}">
                        <span class="album-share-icon" style="background-image: url('${this.escapeAttr(shareIconUrl(icon.key))}');"></span>
                        <span class="album-share-label">${this.escapeHtml(icon.label)}</span>
                    </button>
                `).join('')}
            </div>
            <button type="button" class="album-share-cancel">取消</button>
        `;
        root.appendChild(sheet);

        sheet.querySelector('.album-share-cancel')?.addEventListener('click', () => sheet.remove());
        sheet.querySelectorAll('[data-album-share]').forEach((btn) => {
            btn.addEventListener('click', async () => {
                const key = String(btn.dataset.albumShare || '');
                const label = L0_ASSETS.icons.find(i => i.key === key)?.label || key;
                if (!shareIconUrl(key)) return;
                const text = `【${label}】${image.filename || '图片'} — ${image.src || ''}`;
                let copied = false;
                try {
                    if (navigator.clipboard?.writeText) {
                        await navigator.clipboard.writeText(text);
                        copied = true;
                    }
                } catch (e) { copied = false; }
                this.app.phoneShell?.showNotification?.(
                    '相册',
                    copied ? `已复制分享文案（${label}）` : `分享文案（${label}）：${text.slice(0, 40)}`,
                    '📤'
                );
                sheet.remove();
            });
        });
    }

    closePreview() {
        this.previewOpen = false;
        this.pausePreview();
        /* [R25-O3] 关掉预览 = 这条媒体的寿命结束：按内核给的 steps 真摘 src（video 先 pause），
         *   再把结果写成回执。修前这里只 remove() 元素，位图要等 GC 顺手。 */
        this.releasePreviewMedia();
        document.querySelectorAll('.album-preview').forEach(preview => preview.remove());
    }

    /** 按计划释放当前预览里的媒体；回执落 this._mediaReceipts 并在相册工具条上留一个人能看的数。 */
    releasePreviewMedia() {
        const nodes = document.querySelectorAll('.album-preview-image, .album-preview-video');
        let released = 0;
        let receipts = this._mediaReceipts || [];
        const live = [...(this._mediaLive || new Map()).values()];
        nodes.forEach(node => {
            const isVideo = node.tagName === 'VIDEO';
            const rec = live.find(item => (isVideo ? item.kind === 'video' : item.kind === 'image'))
                || { id: '', kind: isVideo ? 'video' : 'image', src: node.getAttribute('src') || '' };
            const plan = mlReleasePlan(rec);
            let ok = false;
            try {
                for (const step of plan.steps) {
                    if (step === 'pause') node.pause?.();
                    if (step === 'detach-src') {
                        node.removeAttribute('src');
                        node.removeAttribute('srcset');
                        if (isVideo) { try { node.load?.(); } catch (e) { } }
                    }
                }
                ok = !node.hasAttribute('src');
            } catch (e) {
                ok = false;
            }
            const r = mlReceipt(rec, plan, ok, Date.now(), receipts);
            receipts = r.receipts;
            if (ok) released += 1;
        });
        this._mediaReceipts = receipts;
        this._mediaLive = new Map();
        this._mediaReleasedTotal = (Number(this._mediaReleasedTotal) || 0) + released;
        const host = document.querySelector('.album-app');
        if (host && host.dataset) {
            host.dataset.mlLive = '0';
            host.dataset.mlReleased = String(this._mediaReleasedTotal);
            host.dataset.mlLastReceipt = JSON.stringify(receipts[receipts.length - 1] || null);
        }
        return released;
    }

    pausePreview() {
        document.querySelectorAll('.album-preview-video').forEach(video => video.pause?.());
        document.querySelectorAll('.album-preview-video-replay').forEach(button => {
            button.hidden = false;
        });
    }

    async deleteImage(image) {
        if (!image || this.isDeleting || this.isBulkDeleting) return;
        this.isDeleting = true;
        const isVideo = image.mediaType === 'video';
        const ok = phoneConfirm(`删除这个${isVideo ? '视频' : '图片'}吗？引用它的页面或记录也会清空。`);
        if (!ok) {
            this.isDeleting = false;
            return;
        }

        const deleteBtn = (document.querySelector('.phone-view-current') || document).querySelector('.album-preview-delete');
        if (deleteBtn) deleteBtn.disabled = true;
        try {
            const result = await this.app.albumData.deleteImage(image.path);
            this.app.phoneShell?.showNotification?.('相册', result.message || `${isVideo ? '视频' : '图片'}已删除`, isVideo ? '🎬' : '🖼️');
        } catch (e) {
            console.error('删除相册媒体失败:', e);
            this.app.phoneShell?.showNotification?.('相册', '删除失败', '⚠️');
        } finally {
            this.isDeleting = false;
        }
        /* [v4.178.0] 从预览里删掉：先按台账口径把这条媒体的 src 摘掉、写回执，再重绘。
         *   修前只把 previewOpen 置 false 就 render —— 覆盖层随重绘一起没了，可句柄还挂在
         *   `_mediaLive` 上：工具条永远显示「有 1 条活着」，而且再没有任何人释放过它。 */
        this.closePreview();
        this.render();
    }

    async deleteSelectedImages() {
        if (this.isBulkDeleting || this.isDeleting) return;
        const selected = this.images.filter(image => this.selectedPaths.has(image.path));
        if (selected.length === 0) return;
        const ok = phoneConfirm(`删除选中的 ${selected.length} 个项目吗？引用它们的页面或记录也会清空。`);
        if (!ok) return;

        const deleteBtn = (document.querySelector('.phone-view-current') || document).querySelector('#album-delete-selected');
        if (deleteBtn) deleteBtn.disabled = true;
        this.isBulkDeleting = true;
        try {
            const result = await this.app.albumData.deleteImages(selected.map(image => image.path));
            this.app.phoneShell?.showNotification?.('相册', `已删除 ${result.successCount} 个项目`, '🗑️');
        } catch (e) {
            console.error('批量删除相册媒体失败:', e);
            this.app.phoneShell?.showNotification?.('相册', '批量删除失败', '⚠️');
        } finally {
            this.isBulkDeleting = false;
            this.selectionMode = false;
            this.selectedPaths.clear();
            this.render();
        }
    }

    getPrimarySource(image) {
        return this.app.albumData.getImageSourceLabel(image);
    }

    escapeHtml(text) {
        return String(text ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    escapeAttr(text) {
        return this.escapeHtml(text).replace(/`/g, '&#96;');
    }
}
