/* ========================================================
 *  柚月小手机 (Yuzuki's Little Phone)
 *  2048 单机游戏视图
 * ======================================================== */

export class Game2048View {
    constructor(app) {
        this.app = app;
        this._cssLoaded = false;
        this._touchStartX = 0;
        this._touchStartY = 0;
        this._boundKeydown = this._handleKeydown.bind(this);
    }

    render() {
        this._loadCSS();
        const state = this.app.game2048Data.getState();
        const html = `
            <div class="games-app games-2048-app">
                <div class="games-topbar games-2048-topbar">
                    <button class="games-back-btn" id="games-2048-back" type="button" aria-label="返回大厅">
                        <i class="fa-solid fa-chevron-left"></i>
                    </button>
                    <div class="games-title-wrap">
                        <div class="games-title">奇点融合</div>
                        <div class="games-subtitle">2048 · 单机游戏</div>
                    </div>
                    <button class="games-icon-btn" id="games-2048-restart-top" type="button" title="重新开始">
                        <i class="fa-solid fa-rotate-right"></i>
                    </button>
                </div>

                <div class="games-2048-content">
                    <div class="games-2048-score-row">
                        <div class="games-2048-score-box">
                            <span>SCORE</span>
                            <strong id="games-2048-score">${this._fmt(state.score)}</strong>
                        </div>
                        <div class="games-2048-score-box">
                            <span>BEST</span>
                            <strong>${this._fmt(state.best)}</strong>
                        </div>
                    </div>

                    <div class="games-2048-board-wrap">
                        <div class="games-2048-board phone-gesture-control" id="games-2048-board" aria-label="2048 棋盘">
                            ${state.board.flatMap((row, rowIndex) => row.map((value, colIndex) => this._renderCell(value, rowIndex, colIndex))).join('')}
                        </div>
                        ${this._renderResultOverlay(state)}
                    </div>

                    <button class="games-2048-restart-btn" id="games-2048-restart" type="button">
                        <i class="fa-solid fa-rotate-right"></i>
                        <span>重新初始化系统</span>
                    </button>
                </div>
            </div>
        `;

        this.app.phoneShell.setContent(html, 'games-2048');
        this._bindEvents();
    }

    destroy() {
        document.removeEventListener('keydown', this._boundKeydown);
    }

    _renderCell(value, row, col) {
        const text = value ? String(value) : '';
        const valAttr = value ? ` data-val="${value}"` : '';
        return `<div class="games-2048-cell" data-row="${row}" data-col="${col}"${valAttr}>${text}</div>`;
    }

    _renderResultOverlay(state) {
        if (!state.over && !state.won) return '';
        const title = state.over ? '系统阻塞' : '融合完成';
        const desc = state.over ? '没有可移动的方块了' : '已合成 2048';
        return `
            <div class="games-2048-result">
                <strong>${title}</strong>
                <span>${desc}</span>
                <button id="games-2048-restart-overlay" type="button">再来一局</button>
            </div>
        `;
    }

    _bindEvents() {
        document.removeEventListener('keydown', this._boundKeydown);
        document.addEventListener('keydown', this._boundKeydown);

        document.getElementById('games-2048-back')?.addEventListener('click', () => {
            this.app.backToLobby();
        });
        ['games-2048-restart', 'games-2048-restart-top', 'games-2048-restart-overlay'].forEach(id => {
            document.getElementById(id)?.addEventListener('click', () => this.app.reset2048());
        });

        const board = document.getElementById('games-2048-board');
        if (!board) return;

        board.addEventListener('touchstart', e => {
            e.stopPropagation();
            const touch = e.touches?.[0];
            this._touchStartX = Number(touch?.clientX || 0);
            this._touchStartY = Number(touch?.clientY || 0);
        }, { passive: false });

        board.addEventListener('touchmove', e => {
            e.stopPropagation();
            if (e.cancelable) e.preventDefault();
        }, { passive: false });

        board.addEventListener('touchend', e => {
            e.stopPropagation();
            const touch = e.changedTouches?.[0];
            if (!touch) return;
            this._handleSwipe(touch.clientX - this._touchStartX, touch.clientY - this._touchStartY);
        }, { passive: false });

        let pointerStartX = 0;
        let pointerStartY = 0;
        let activePointerId = null;
        board.addEventListener('pointerdown', e => {
            if (e.pointerType && e.pointerType !== 'mouse') return;
            activePointerId = e.pointerId;
            pointerStartX = e.clientX;
            pointerStartY = e.clientY;
            board.setPointerCapture?.(e.pointerId);
            e.stopPropagation();
        });
        board.addEventListener('pointermove', e => {
            if (activePointerId !== e.pointerId) return;
            e.preventDefault();
            e.stopPropagation();
        });
        board.addEventListener('pointerup', e => {
            if (activePointerId !== e.pointerId) return;
            activePointerId = null;
            e.stopPropagation();
            this._handleSwipe(e.clientX - pointerStartX, e.clientY - pointerStartY);
        });
    }

    _handleKeydown(e) {
        if (this.app.currentView !== 'game2048') return;
        const key = String(e.key || '').toLowerCase();
        const map = {
            arrowleft: 'left',
            a: 'left',
            arrowright: 'right',
            d: 'right',
            arrowup: 'up',
            w: 'up',
            arrowdown: 'down',
            s: 'down'
        };
        const direction = map[key];
        if (!direction) return;
        e.preventDefault();
        this.app.move2048(direction);
    }

    _handleSwipe(deltaX, deltaY) {
        const absX = Math.abs(deltaX);
        const absY = Math.abs(deltaY);
        if (Math.max(absX, absY) < 28) return;
        const direction = absX > absY
            ? (deltaX > 0 ? 'right' : 'left')
            : (deltaY > 0 ? 'down' : 'up');
        this.app.move2048(direction);
    }

    _loadCSS() {
        if (this._cssLoaded) return;
        if (document.getElementById('games-2048-css')) {
            this._cssLoaded = true;
            return;
        }
        const link = document.createElement('link');
        link.id = 'games-2048-css';
        link.rel = 'stylesheet';
        link.href = new URL('./game2048.css?v=1.0.0', import.meta.url).href;
        document.head.appendChild(link);
        this._cssLoaded = true;
    }

    _fmt(value) {
        return Number(value || 0).toLocaleString('zh-CN');
    }
}
