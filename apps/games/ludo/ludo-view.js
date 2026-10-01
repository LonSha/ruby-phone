/* ========================================================
 *  柚月小手机 (Yuzuki's Little Phone)
 *  心动飞行棋 视图层（.ld- 前缀，本件独占）
 * ======================================================== */

import { LUDO_BOARD_SIZE, LUDO_FINAL_INDEX, LUDO_EVENT_CELLS, isLudoEventCell, ludoModeLabel } from './ludo-data.js';

const CSS_URL = new URL('./ludo.css?v=1.0.0', import.meta.url).href;

/** 棋盘列数（42 格 = 7 列 × 6 行，蛇形走位） */
const BOARD_COLS = 7;

export class LudoView {
    constructor(app) {
        this.app = app;
        this._cssLoaded = false;
        this._selectedId = '';
        this._settingsOpen = false;
        this._summaryOpen = false;
        this._busy = false;
        this._dice = 0;
        this._answerDraft = '';
    }

    // ---------------------------------------------------------------- 样式

    _loadCSS() {
        if (this._cssLoaded || document.getElementById('ludo-css')) {
            this._cssLoaded = true;
            return;
        }
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.id = 'ludo-css';
        link.href = CSS_URL;
        document.head.appendChild(link);
        this._cssLoaded = true;
    }

    _esc(text) {
        return String(text ?? '')
            .split('&').join('\x26amp;')
            .split('<').join('\x26lt;')
            .split('>').join('\x26gt;')
            .split('"').join('\x26quot;')
            .split("'").join('\x26#39;');
    }

    _escAttr(text) {
        return this._esc(text).split('\n').join(' ');
    }

    _avatar(player = {}) {
        if (player.avatar) return `<img class="ld-avatar-img" src="${this._escAttr(player.avatar)}" alt="">`;
        const initial = String(player.name || '?').slice(0, 1);
        return `<span class="ld-avatar-text">${this._esc(initial)}</span>`;
    }

    _nl(text) {
        return this._esc(text).split('\n').join('<br>');
    }

    // ---------------------------------------------------------------- 渲染

    render() {
        this._loadCSS();
        const state = this.app.ludoData.getState();
        if (state.phase === 'playing' || state.phase === 'ended') {
            this.renderGame();
            return;
        }
        this.renderSetup();
    }

    renderSetup() {
        this._loadCSS();
        const contacts = this.app.getWechatContactsForPoker?.() || [];
        const options = contacts.map(contact => `
            <label class="ld-player-option ${this._selectedId === contact.id ? 'is-picked' : ''}">
                <input type="radio" name="ld-opponent" class="ld-player-radio" value="${this._escAttr(contact.id)}" ${this._selectedId === contact.id ? 'checked' : ''}>
                <span class="ld-player-avatar">${this._avatar(contact)}</span>
                <span class="ld-player-name">${this._esc(contact.name)}</span>
            </label>
        `).join('');

        const html = `
            <div class="games-app ld-app ld-setup">
                <div class="games-topbar">
                    <button class="games-back-btn" id="ld-back-lobby" type="button" aria-label="返回">
                        <i class="fa-solid fa-chevron-left"></i>
                    </button>
                    <div>
                        <div class="games-title">心动飞行棋</div>
                        <div class="games-subtitle">掷骰前进 · 踩到就聊聊</div>
                    </div>
                    <button class="games-icon-btn" id="ld-settings-open" type="button" title="玩法说明">
                        <i class="fa-solid fa-circle-info"></i>
                    </button>
                </div>

                <div class="ld-setup-body">
                    <div class="ld-section">
                        <div class="ld-section-title">选一位对手</div>
                        <div class="ld-player-grid" id="ld-player-grid">
                            ${options || '<div class="ld-empty">微信里还没有可选的角色</div>'}
                        </div>
                    </div>

                    <div class="ld-section">
                        <div class="ld-section-title">棋盘</div>
                        <div class="ld-board-preview">${this._renderBoard({}, null)}</div>
                        <div class="ld-board-note">共 ${LUDO_BOARD_SIZE} 格，带问号的格子会抽一道题。</div>
                    </div>
                </div>

                <div class="ld-footer">
                    <button class="ld-primary-btn" id="ld-start" type="button">开始游戏</button>
                </div>

                ${this._renderSettingsOverlay()}
            </div>
        `;
        this.app.phoneShell.setContent(html, 'ld-setup');
        this._bindSetupEvents();
    }

    /** 蛇形棋盘：偶数行正序、奇数行倒序，让路径首尾相接 */
    _renderBoard(positions = {}, selfId = null) {
        const cells = [];
        for (let row = 0; row < Math.ceil(LUDO_BOARD_SIZE / BOARD_COLS); row += 1) {
            const line = [];
            for (let col = 0; col < BOARD_COLS; col += 1) {
                const offset = row % 2 === 0 ? col : (BOARD_COLS - 1 - col);
                const index = row * BOARD_COLS + offset;
                if (index >= LUDO_BOARD_SIZE) {
                    line.push('<div class="ld-cell ld-cell-void"></div>');
                    continue;
                }
                line.push(this._renderCell(index, positions, selfId));
            }
            cells.push(`<div class="ld-board-row">${line.join('')}</div>`);
        }
        return `<div class="ld-board">${cells.join('')}</div>`;
    }

    _renderCell(index, positions = {}, selfId = null) {
        const here = [];
        Object.keys(positions).forEach(playerId => {
            if (Number(positions[playerId]) !== index) return;
            const cls = playerId === selfId ? 'is-me' : 'is-rival';
            here.push(`<span class="ld-piece ${cls}"></span>`);
        });
        const isEnd = index === LUDO_FINAL_INDEX;
        const isEvent = isLudoEventCell(index);
        const cls = [
            'ld-cell',
            isEnd ? 'ld-cell-end' : '',
            isEvent ? 'ld-cell-event' : '',
            here.length ? 'ld-cell-occupied' : ''
        ].filter(Boolean).join(' ');
        const label = isEnd ? '终' : (isEvent ? '?' : String(index));
        return `
            <div class="${cls}">
                <span class="ld-cell-index">${label}</span>
                <span class="ld-cell-pieces">${here.join('')}</span>
            </div>
        `;
    }

    renderGame() {
        this._loadCSS();
        const data = this.app.ludoData;
        const state = data.getState();
        const user = data.getUserPlayer();
        const rival = data.getAiPlayer();
        const current = data.getCurrentPlayer();
        const ended = state.phase === 'ended';
        const isUserTurn = !!current?.isUser && !ended;
        /* ★ 谁该答题**不能**按「当前回合者是不是用户」判断：踩到事件格的那一步，
         *   回合者可能是 AI，而问答脚本第一步就轮到 AI —— 但 `both_answer` /
         *   `single_answer` 的第二步可能是**用户**。若照回合者渲染，用户那时看到的是
         *   「等待 Ta 回答…」而不是输入框 —— 界面静默卡死在等一个不会来的回答
         *   （`_ludoResumeQuestion` 递归到 user 步就停下等输入）。以题目自己的
         *   `awaiting` 为准（`questionAwaitingUser()`），回合者只决定骰子按钮。 */
        const userAnswering = data.questionAwaitingUser();
        const question = state.pendingQuestion;

        const logs = (state.log || []).map(entry => this._renderLog(entry)).join('');
        const positions = state.positions || {};

        const html = `
            <div class="games-app ld-app ld-game">
                <div class="games-topbar">
                    <button class="games-back-btn" id="ld-back-lobby" type="button" aria-label="返回大厅">
                        <i class="fa-solid fa-chevron-left"></i>
                    </button>
                    <div>
                        <div class="games-title">心动飞行棋</div>
                        <div class="games-subtitle">${ended ? '本局结束' : `轮到 ${this._esc(current?.name || '—')}`}</div>
                    </div>
                    <button class="games-icon-btn" id="ld-summary-open" type="button" title="本局记录">
                        <i class="fa-solid fa-scroll"></i>
                    </button>
                </div>

                <div class="ld-players">
                    <div class="ld-player-chip ${current?.id === user?.id ? 'is-active' : ''}">
                        <span class="ld-chip-avatar">${this._avatar(user || {})}</span>
                        <span class="ld-chip-name">${this._esc(user?.name || '我')}</span>
                        <span class="ld-chip-step">${Math.max(0, positions[user?.id || ''] ?? -1)}</span>
                    </div>
                    <div class="ld-player-chip ${current?.id === rival?.id ? 'is-active' : ''}">
                        <span class="ld-chip-avatar">${this._avatar(rival || {})}</span>
                        <span class="ld-chip-name">${this._esc(rival?.name || '—')}</span>
                        <span class="ld-chip-step">${Math.max(0, positions[rival?.id || ''] ?? -1)}</span>
                    </div>
                </div>

                <div class="ld-board-wrap" id="ld-board-wrap">
                    ${this._renderBoard(positions, user?.id)}
                </div>

                <div class="ld-log" id="ld-log">${logs}</div>

                <div class="ld-action-area" id="ld-action-area">
                    ${ended ? `
                        <button class="ld-primary-btn" id="ld-play-again" type="button">再来一局</button>
                    ` : (question ? `
                        <div class="ld-question">
                            <div class="ld-question-tag">${this._esc(ludoModeLabel(question.type))}</div>
                            <div class="ld-question-text">${this._esc(question.text)}</div>
                        </div>
                        ${userAnswering ? `
                            <input class="ld-input" id="ld-answer-input" type="text" placeholder="说说你的想法…" value="${this._escAttr(this._answerDraft)}">
                            <button class="ld-primary-btn" id="ld-answer-send" type="button" ${this._busy ? 'disabled' : ''}>回答</button>
                        ` : `<div class="ld-waiting">${this._busy ? 'Ta 正在想…' : '等待 Ta 回答…'}</div>`}
                    ` : `
                        <button class="ld-dice-btn" id="ld-roll" type="button" ${(!isUserTurn || this._busy) ? 'disabled' : ''}>
                            <span class="ld-dice-face">${this._dice || '🎲'}</span>
                            <span class="ld-dice-label">${isUserTurn ? '掷骰子' : '等对方掷骰'}</span>
                        </button>
                    `)}
                </div>

                ${this._renderSettingsOverlay()}
                ${this._renderSummaryOverlay()}
            </div>
        `;
        this.app.phoneShell.setContent(html, 'ld-game');
        this._bindGameEvents();
        const logEl = document.getElementById('ld-log');
        if (logEl) logEl.scrollTop = logEl.scrollHeight;
    }

    _renderLog(entry = {}) {
        const type = String(entry.type || 'system');
        if (type === 'system') {
            return `<div class="ld-log-entry ld-log-system">${this._nl(entry.text)}</div>`;
        }
        if (type === 'roll') {
            return `<div class="ld-log-entry ld-log-roll">${this._esc(entry.text)}</div>`;
        }
        const cls = type === 'evaluate' ? 'ld-log-evaluate' : 'ld-log-answer';
        return `
            <div class="ld-log-entry ${cls}">
                <div class="ld-log-who">${this._esc(entry.speakerName || '')}</div>
                <div class="ld-log-text">${this._nl(entry.text)}</div>
            </div>
        `;
    }

    _renderSettingsOverlay() {
        if (!this._settingsOpen) return '';
        return `
            <div class="ld-overlay" id="ld-settings-overlay">
                <div class="ld-sheet">
                    <div class="ld-sheet-title">玩法</div>
                    <ul class="ld-rules">
                        <li>在起点要掷出 6 点才能起飞。</li>
                        <li>掷出 6 点可以再走一次，其余情况轮换。</li>
                        <li>走到带问号的格子，会抽一道关于彼此的问题。</li>
                        <li>踩到对方棋子，会把对方送回起点。</li>
                        <li>先走到终点的人赢。</li>
                    </ul>
                    <button class="ld-primary-btn" id="ld-settings-close" type="button">知道了</button>
                </div>
            </div>
        `;
    }

    _renderSummaryOverlay() {
        if (!this._summaryOpen) return '';
        const data = this.app.ludoData;
        const rival = data.getAiPlayer();
        const interview = data.collectInterview();
        const blocks = interview.map((item, index) => `
            <div class="ld-interview">
                <div class="ld-interview-q">${index + 1}. ${this._esc(item.question)}</div>
                ${item.answers.map(answer => `
                    <div class="ld-interview-a">
                        <span class="ld-interview-who">${this._esc(answer.speaker)}</span>
                        <span class="ld-interview-text">${this._esc(answer.text)}</span>
                    </div>
                `).join('')}
            </div>
        `).join('');
        return `
            <div class="ld-overlay" id="ld-summary-overlay">
                <div class="ld-sheet">
                    <div class="ld-sheet-title">本局记录</div>
                    <div class="ld-summary-body">${this._nl(data.getSummary())}</div>
                    ${interview.length ? `
                        <div class="ld-section-title">心动问答</div>
                        <div class="ld-interview-list">${blocks}</div>
                    ` : ''}
                    <div class="ld-sheet-actions">
                        ${rival ? '<button class="ld-primary-btn" id="ld-share-send" type="button">把记录发给 Ta</button>' : ''}
                        <button class="ld-ghost-btn" id="ld-summary-close" type="button">关闭</button>
                    </div>
                </div>
            </div>
        `;
    }

    // ---------------------------------------------------------------- 事件

    _bindSetupEvents() {
        document.getElementById('ld-back-lobby')?.addEventListener('click', () => this.app.backToLobby());
        document.getElementById('ld-settings-open')?.addEventListener('click', () => {
            this._settingsOpen = true;
            this.renderSetup();
        });
        document.getElementById('ld-settings-close')?.addEventListener('click', () => {
            this._settingsOpen = false;
            this.renderSetup();
        });
        document.getElementById('ld-settings-overlay')?.addEventListener('click', event => {
            if (event.target?.id !== 'ld-settings-overlay') return;
            this._settingsOpen = false;
            this.renderSetup();
        });

        document.querySelectorAll('.ld-player-radio').forEach(radio => {
            radio.addEventListener('change', () => {
                this._selectedId = radio.value;
                document.querySelectorAll('.ld-player-option').forEach(item => item.classList.remove('is-picked'));
                radio.closest('.ld-player-option')?.classList.add('is-picked');
            });
        });

        document.getElementById('ld-start')?.addEventListener('click', () => this._startGame());
    }

    _bindGameEvents() {
        document.getElementById('ld-back-lobby')?.addEventListener('click', () => {
            this.app.stopLudoFlow?.();
            this.app.backToLobby();
        });
        document.getElementById('ld-settings-open')?.addEventListener('click', () => {
            this._settingsOpen = true;
            this.renderGame();
        });
        document.getElementById('ld-settings-close')?.addEventListener('click', () => {
            this._settingsOpen = false;
            this.renderGame();
        });
        document.getElementById('ld-settings-overlay')?.addEventListener('click', event => {
            if (event.target?.id !== 'ld-settings-overlay') return;
            this._settingsOpen = false;
            this.renderGame();
        });

        document.getElementById('ld-summary-open')?.addEventListener('click', () => {
            this._summaryOpen = true;
            this.renderGame();
        });
        document.getElementById('ld-summary-close')?.addEventListener('click', () => {
            this._summaryOpen = false;
            this.renderGame();
        });
        document.getElementById('ld-summary-overlay')?.addEventListener('click', event => {
            if (event.target?.id !== 'ld-summary-overlay') return;
            this._summaryOpen = false;
            this.renderGame();
        });
        document.getElementById('ld-share-send')?.addEventListener('click', () => this._shareSummary());

        const input = document.getElementById('ld-answer-input');
        input?.addEventListener('input', () => {
            this._answerDraft = input.value;
        });
        input?.addEventListener('keydown', event => {
            if (event.key === 'Enter') {
                event.preventDefault();
                this._answer();
            }
        });
        document.getElementById('ld-roll')?.addEventListener('click', () => this._roll());
        document.getElementById('ld-answer-send')?.addEventListener('click', () => this._answer());
        document.getElementById('ld-play-again')?.addEventListener('click', () => {
            this.app.ludoData.reset();
            this._summaryOpen = false;
            this._dice = 0;
            this.renderSetup();
        });
    }

    // ---------------------------------------------------------------- 动作

    _startGame() {
        const contacts = this.app.getWechatContactsForPoker?.() || [];
        const opponent = contacts.find(contact => contact.id === this._selectedId);
        if (!opponent) {
            this.app.phoneShell?.showNotification?.('心动飞行棋', '先选一位对手', '🎲');
            return;
        }
        const userInfo = this.app._getWerewolfUserInfo?.() || {};
        const data = this.app.ludoData;
        if (!data.startGame({
            userPlayer: { id: 'user', name: userInfo.name || '我', avatar: userInfo.avatar || '' },
            opponent: {
                id: opponent.id,
                name: opponent.name,
                avatar: opponent.avatar || '',
                persona: opponent.persona || ''
            }
        })) {
            this.app.phoneShell?.showNotification?.('心动飞行棋', '开局失败，请重试', '🎲');
            return;
        }
        this._dice = 0;
        this._answerDraft = '';
        this.app.startLudoFlow?.();
    }

    async _roll() {
        if (this._busy) return;
        this._busy = true;
        try {
            const dice = await this.app.rollLudo();
            if (dice) this._dice = dice;
        } finally {
            this._busy = false;
            this.render();
        }
    }

    async _answer() {
        if (this._busy) return;
        const input = document.getElementById('ld-answer-input');
        const text = String(input?.value || '').trim();
        if (!text) return;
        this._busy = true;
        try {
            await this.app.answerLudo({ text });
            this._answerDraft = '';
        } finally {
            this._busy = false;
            this.render();
        }
    }

    async _shareSummary() {
        await this.app.shareLudoSummary?.();
        this._summaryOpen = false;
        this.render();
    }

    // ---------------------------------------------------------------- 生命周期

    isGameOpen() {
        const state = this.app.ludoData?.getState?.() || {};
        return state.phase === 'playing' || state.phase === 'ended';
    }

    handleBack() {
        if (this._summaryOpen) {
            this._summaryOpen = false;
            this.render();
            return true;
        }
        if (this._settingsOpen) {
            this._settingsOpen = false;
            this.render();
            return true;
        }
        return false;
    }

    destroy() {
        this._busy = false;
    }
}