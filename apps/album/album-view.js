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
/* [v3.24.0 · L0-3] 分享面板：25 个平台图标（L0 素材第 2 类）。
 *   URL 解析只在取数口一处（`shareIconUrl`），本文件只把 key 列表画成按钮。 */
import { L0_ASSETS, shareIconUrl } from '../../config/l0-assets.js';
/* [v4.99.9 · R11-X9] 回看面：**视图不 import 桥**（判据只能有一处）。
 *   视角枚举与文案、密级可选值全部经 `AlbumData.viewerOptions()` / `secrecyChoices()`
 *   转出（与记忆侧 `MemoryApp.replayViewerOptions()` 同一条纪律）。
 *   本视图只排桥已经定好的 label / line / view。 */

export const ALBUM_CSS_URL = new URL('./album.css?v=1.3.0&r=20261030-album-replay', import.meta.url).href;

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
        const html = `
            <div class="album-app album-wallpaper-shell${this.selectionMode ? ' album-selecting' : ''}" style="${wallpaperStyle}">
                <header class="album-header">
                    <button type="button" class="album-icon-btn" id="album-back" aria-label="返回">
                        <i class="fa-solid ${this.selectionMode ? 'fa-xmark' : 'fa-chevron-left'}"></i>
                    </button>
                    <div class="album-title-wrap">
                        <div class="album-title">${this.selectionMode ? `已选 ${selectedCount} 项` : '相册'}</div>
                    </div>
                    <div class="album-header-actions">
                        ${this.selectionMode ? '' : `
                            <button type="button" class="album-replay-entry" id="album-replay-entry" aria-label="回看">
                                <i class="fa-solid fa-clock-rotate-left" aria-hidden="true"></i>
                                <span>回看</span>
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
                    ${this.images.length ? `
                        <div class="album-body-toolbar">
                            <span>${this.escapeHtml(activeSourceLabel)} · ${visibleImages.length} 项</span>
                            <div class="album-body-toolbar-actions">
                                <button type="button" class="album-source-filter" id="album-source-filter" aria-haspopup="menu" aria-expanded="false">
                                    <span>分类</span>
                                    <i class="fa-solid fa-chevron-down" aria-hidden="true"></i>
                                </button>
                                <button type="button" id="album-select-toggle">选择</button>
                            </div>
                        </div>
                        ${this.renderSourceSections(visibleImages)}
                        <div class="album-total-count">共 ${this.images.length} 个项目</div>
                    ` : this.renderEmpty()}
                </main>
            </div>
        `;

        this.app.phoneShell.setContent(html, 'album-main');
        requestAnimationFrame(() => this.bindEvents());
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
                            <div class="album-grid">
                                ${shownImages.map(image => this.renderTile(image)).join('')}
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
        return `
            <div class="album-tile${isVideo ? ' is-video' : ''}${this.selectedPaths.has(image.path) ? ' selected' : ''}" data-index="${index}" title="${this.escapeHtml(image.filename)}">
                <button type="button" class="album-tile-main" data-index="${index}" aria-label="${this.selectionMode ? '选择' : '查看'}${isVideo ? '视频' : '图片'}">
                    ${mediaHtml}
                    <span class="album-checkmark"><i class="fa-solid fa-check"></i></span>
                </button>
            </div>
        `;
    }

    renderEmpty() {
        return `
            <div class="album-empty">
                <div class="album-empty-icon"><i class="fa-regular fa-images"></i></div>
                <div class="album-empty-title">还没有图片或视频</div>
                <div class="album-empty-copy">各个 App 保存过的图片和视频会按来源显示在这里。</div>
            </div>
        `;
    }

    bindEvents() {
        const root = (document.querySelector('.phone-view-current') || document).querySelector('.album-app');
        if (!root) return;
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
        root.querySelectorAll('.album-tile-main').forEach(tile => {
            tile.addEventListener('click', () => {
                const index = Number.parseInt(tile.dataset.index, 10);
                if (this.selectionMode) {
                    this.toggleSelected(index);
                    return;
                }
                this.openPreview(index);
            });
        });
        root.querySelectorAll('.album-tile img').forEach(img => {
            img.addEventListener('error', async () => {
                img.closest('.album-tile')?.classList.add('is-broken');
                const index = Number.parseInt(img.closest('.album-tile')?.dataset?.index || '', 10);
                const image = Number.isFinite(index) ? this.images[index] : null;
                await this.handleMissingImage(image);
            }, { once: true });
        });
        root.querySelectorAll('.album-tile video').forEach(video => {
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
        root?.querySelector('.album-preview')?.remove();

        const overlay = document.createElement('div');
        overlay.className = 'album-preview';
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
        document.querySelectorAll('.album-preview').forEach(preview => preview.remove());
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
        const ok = window.confirm(`删除这个${isVideo ? '视频' : '图片'}吗？引用它的页面或记录也会清空。`);
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
        this.previewOpen = false;
        this.render();
    }

    async deleteSelectedImages() {
        if (this.isBulkDeleting || this.isDeleting) return;
        const selected = this.images.filter(image => this.selectedPaths.has(image.path));
        if (selected.length === 0) return;
        const ok = window.confirm(`删除选中的 ${selected.length} 个项目吗？引用它们的页面或记录也会清空。`);
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
