/* ========================================================
 *  柚月小手机 (Yuzuki's Little Phone)
 *  作者 (Author): yuzuki
 *
 * Copyright (c) yuzuki. All rights reserved.
 * ======================================================== */

import { AlbumData } from './album-data.js?v=1.4.2&r=20260726-album-media';
import { ALBUM_CSS_URL, AlbumView } from './album-view.js?v=1.4.2&r=20260802-album-toolbar';

export class AlbumApp {
    constructor(phoneShell, storage) {
        this.phoneShell = phoneShell;
        this.storage = storage;
        this._cssRenderPending = false;
        this._cssFallbackTimer = null;

        this._preloadCSS();

        this.albumData = new AlbumData(storage);
        this.albumView = new AlbumView(this);

        // [v2.25.0] 监听器改由实例字段持有：albumApp 在清数据时被置 null 重建，
        //   构造期直接 add 匿名函数会使每次重建净增 5 个全局监听器（泄漏）。
        //   与 weibo-app（_swipeHandler + destroy）、music-app（remove-then-add）同构。
        this._onSwipeBack = (e) => this.handleSwipeBack(e);
        this._onImageDeleted = () => this.refreshIfVisible();
        this._onWallpaper = () => this.refreshIfVisible();
        this._onPanelVisibility = event => {
            if (event?.detail?.open === false) this.albumView?.pausePreview?.();
        };
        this._onDocVisibility = () => {
            if (document.hidden) this.albumView?.pausePreview?.();
        };
        window.addEventListener('phone:swipeBack', this._onSwipeBack);
        window.addEventListener('phone:albumImageDeleted', this._onImageDeleted);
        window.addEventListener('phone:updateWallpaper', this._onWallpaper);
        window.addEventListener('phone:panelVisibility', this._onPanelVisibility);
        document.addEventListener('visibilitychange', this._onDocVisibility);
    }

    _preloadCSS() {
        if (document.getElementById('album-css')) return;
        const link = document.createElement('link');
        link.id = 'album-css';
        link.rel = 'stylesheet';
        link.href = ALBUM_CSS_URL;
        document.head.appendChild(link);
    }

    render() {
        const cssLink = document.getElementById('album-css');
        if (cssLink && !cssLink.sheet) {
            if (this._cssRenderPending) return;
            this._cssRenderPending = true;

            const renderAfterCSS = () => {
                if (!this._cssRenderPending) return;
                this._cssRenderPending = false;
                if (this._cssFallbackTimer) {
                    clearTimeout(this._cssFallbackTimer);
                    this._cssFallbackTimer = null;
                }
                this.albumView.render();
            };

            cssLink.addEventListener('load', renderAfterCSS, { once: true });
            cssLink.addEventListener('error', () => {
                console.error('Album CSS failed to load');
                renderAfterCSS();
            }, { once: true });
            this._cssFallbackTimer = setTimeout(renderAfterCSS, 1500);
            return;
        }
        this.albumView.render();
    }

    handleSwipeBack() {
        const domCurrentView = document.querySelector('.phone-view-current');
        if (!domCurrentView?.querySelector?.('.album-app')) return;

        if (this.albumView.previewOpen) {
            this.albumView.closePreview();
            return;
        }

        if (this.albumView.sourceMenuOpen) {
            this.albumView.closeSourceMenu();
            return;
        }

        if (this.albumView.selectionMode) {
            this.albumView.selectionMode = false;
            this.albumView.selectedPaths.clear();
            this.albumView.render();
            return;
        }

        if (this.albumView.activeSource !== 'all') {
            this.albumView.activeSource = 'all';
            this.albumView.render();
            return;
        }

        window.dispatchEvent(new CustomEvent('phone:goHome'));
    }

    refreshIfVisible() {
        if (this.albumView?.isBulkDeleting) return;
        const domCurrentView = document.querySelector('.phone-view-current');
        if (!domCurrentView?.querySelector?.('.album-app')) return;
        this.albumView.render();
    }

    deactivate() {
        this.albumView?.closePreview?.();
    }
    // [v2.25.0] 实例销毁：解绑构造期注册的 5 个全局监听器（置 null 重建前调用）
    destroy() {
        window.removeEventListener('phone:swipeBack', this._onSwipeBack);
        window.removeEventListener('phone:albumImageDeleted', this._onImageDeleted);
        window.removeEventListener('phone:updateWallpaper', this._onWallpaper);
        window.removeEventListener('phone:panelVisibility', this._onPanelVisibility);
        document.removeEventListener('visibilitychange', this._onDocVisibility);
    }
}
