/* ========================================================
 *  柚月小手机 (Yuzuki's Little Phone)
 *  你说我猜 视图层
 * ======================================================== */

import { GUESS_MODES, GUESS_MAX_ROUNDS } from './guesswhat-data.js';

const CSS_URL = new URL('./guesswhat.css?v=1.0.0', import.meta.url).href;

export class GuessWhatView {
    constructor(app) {
        this.app = app;
        this._cssLoaded = false;
        this._settingsOpen = false;
        this._summaryOpen = false;
        this._shareTargets = new Set();
        this._selectedId = '';
        this._mode = 'ai_guesses';
        this._secretDraft = '';
        this._busy = false;
    }

    // ---------------------------------------------------------------- 工具

    _loadCSS() {
        if (this._cssLoaded || document.getElementById('guesswhat-css')) {
            this._cssLoaded = true;
            return;
        }
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.id = 'guesswhat-css';
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
        if (player?.avatar) return `<img class="gw-avatar-img" src="${this._escAttr(player.avatar)}" alt="">`;
        return `<span class="gw-avatar-text">${this._esc(String(player?.name || '?').slice(0, 1))}</span>`;
    }

    // ---------------------------------------------------------------- 渲染

    render() {
        this._loadCSS();
        const data = this.app.guessWhatData;
        const state = data.getState();
        /* ★ 玩法口径以**数据层**为准：视图重建（回大厅再进来）时不能把用户选过的玩法忘了。
         *   数据层没有值时（首次进来）保持视图当前选择。 */
        const savedMode = String(state.mode || '').trim();
        if (savedMode) this._mode = savedMode;
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
            <button class="gw-partner ${this._selectedId === contact.id ? 'is-picked' : ''}"
                    data-partner-id="${this._escAttr(contact.id)}" type="button">
                <span class="gw-partner-avatar">${this._avatar(contact)}</span>
                <span class="gw-partner-name">${this._esc(contact.name)}</span>
            </button>
        `).join('');

        const modes = GUESS_MODES.map(mode => `
            <button class="gw-mode ${this._mode === mode.value ? 'is-active' : ''}" data-mode="${mode.value}" type="button">
                <span class="gw-mode-label">${mode.label}</span>
                <span class="gw-mode-desc">${mode.desc}</span>
            </button>
        `).join('');

        const html = `
            <div class="games-app gw-app gw-setup">
                <div class="games-topbar">
                    <button class="games-back-btn" id="gw-back-lobby" type="button" aria-label="返回">
                        <i class="fa-solid fa-chevron-left"></i>
                    </button>
                    <div>
                        <div class="games-title">你说我猜</div>
                        <div class="games-subtitle">一人出题 · 一人猜词</div>
                    </div>
                    <button class="games-icon-btn" id="gw-settings-open" type="button" title="玩法说明">
                        <i class="fa-solid fa-circle-info"></i>
                    </button>
                </div>

                <div class="gw-setup-body">
                    <div class="gw-section">
                        <div class="gw-section-title">找谁玩</div>
                        <div class="gw-partners" id="gw-partners">
                            ${options || '<div class="gw-empty">微信里还没有可选的角色</div>'}
                        </div>
                    </div>

                    <div class="gw-section">
                        <div class="gw-section-title">怎么玩</div>
                        <div class="gw-modes" id="gw-modes">${modes}</div>
                    </div>

                    <div class="gw-section" id="gw-secret-area" style="display:none">
                        <div class="gw-section-title">你出的词</div>
                        <input class="gw-input" id="gw-secret-word" type="text" placeholder="心里想的那个词，别让对方看到">
                    </div>
                </div>

                <div class="gw-footer">
                    <button class="gw-primary-btn" id="gw-start" type="button">开始游戏</button>
                </div>

                ${this._renderSettingsOverlay()}
            </div>
        `;
        this.app.phoneShell.setContent(html, 'gw-setup');
        this._bindSetupEvents();
    }

    renderGame() {
        this._loadCSS();
        const data = this.app.guessWhatData;
        const state = data.getState();
        const opponent = state.opponent || {};
        const modeInfo = data.getModeInfo();
        const ended = state.phase === 'ended';
        const roundText = `${state.round} / ${GUESS_MAX_ROUNDS}`;

        const logs = (state.log || []).map(entry => {
            if (entry.type === 'system') {
                return `<div class="gw-log-entry gw-log-system">${this._esc(entry.text).split('\n').join('<br>')}</div>`;
            }
            const isUser = entry.type === 'user-turn';
            const who = isUser ? '我' : (entry.playerName || opponent.name || 'Ta');
            const avatar = isUser ? '' : this._avatar(entry);
            const reroll = (!isUser && !ended)
                ? '<button class="gw-reroll" data-reroll="1" type="button" title="换个说法">⟳</button>'
                : '';
            return `
                <div class="gw-log-entry ${isUser ? 'is-user' : 'is-ai'}">
                    <div class="gw-log-avatar">${avatar}</div>
                    <div class="gw-log-bubble">
                        <div class="gw-log-who">${this._esc(who)}</div>
                        <div class="gw-log-text">${this._esc(entry.text)}</div>
                    </div>
                    ${reroll}
                </div>
            `;
        }).join('');

        const inputHtml = ended
            ? `<button class="gw-primary-btn" id="gw-play-again" type="button">再来一局</button>`
            : `
                <input class="gw-input gw-input-inline" id="gw-user-input" type="text"
                       placeholder="${this._escAttr(modeInfo.placeholder)}" value="${this._escAttr(this._secretDraft)}" ${this._busy ? 'disabled' : ''}>
                <button class="gw-primary-btn gw-send" id="gw-send" type="button" ${this._busy ? 'disabled' : ''}>发送</button>
            `;

        const html = `
            <div class="games-app gw-app gw-game">
                <div class="games-topbar">
                    <button class="games-back-btn" id="gw-back-lobby" type="button" aria-label="返回大厅">
                        <i class="fa-solid fa-chevron-left"></i>
                    </button>
                    <div>
                        <div class="games-title">${this._esc(opponent.name || '你说我猜')}</div>
                        <div class="games-subtitle">${modeInfo.label} · 第 ${roundText} 轮</div>
                    </div>
                    <button class="games-icon-btn" id="gw-summary-open" type="button" title="查看复盘">
                        <i class="fa-solid fa-scroll"></i>
                    </button>
                </div>

                <div class="gw-hint-bar">
                    <strong>${this._esc(data.getUserTurnLabel())}</strong>
                    ${data.isAiGuessing()
                        ? `：答案 <strong>${this._esc(state.secretWord)}</strong>`
                        : `：提示来自 ${this._esc(opponent.name || 'Ta')}`}
                </div>

                <div class="gw-log" id="gw-log">${logs}</div>

                <div class="gw-action-area" id="gw-action-area">
                    ${this._busy && !ended ? '<span class="gw-typing">Ta 正在想…</span>' : ''}
                    ${inputHtml}
                </div>

                ${this._renderSettingsOverlay()}
                ${this._renderSummaryOverlay()}
            </div>
        `;
        this.app.phoneShell.setContent(html, 'gw-game');
        this._bindGameEvents();
        const logEl = document.getElementById('gw-log');
        if (logEl) logEl.scrollTop = logEl.scrollHeight;
    }

    _renderSettingsOverlay() {
        if (!this._settingsOpen) return '';
        return `
            <div class="gw-overlay" id="gw-settings-overlay">
                <div class="gw-sheet">
                    <div class="gw-sheet-title">玩法</div>
                    <ul class="gw-rules">
                        <li>「我出题」：你心里想一个词，用提示让 Ta 猜。</li>
                        <li>「Ta 出题」：Ta 想一个词，你看提示来猜。</li>
                        <li>猜中不必一字不差，意思对上就算中。</li>
                        <li>觉得 Ta 的这句偏离太远，可以点气泡旁的 ⟳ 让它换一个说法。</li>
                        <li>${GUESS_MAX_ROUNDS} 轮还没猜到就按平局收场。</li>
                    </ul>
                    <button class="gw-primary-btn" id="gw-settings-close" type="button">知道了</button>
                </div>
            </div>
        `;
    }

    _renderSummaryOverlay() {
        if (!this._summaryOpen) return '';
        const data = this.app.guessWhatData;
        const html = this._esc(data.getSummary()).split('\n').join('<br>');
        const opponent = data.getState().opponent || {};
        return `
            <div class="gw-overlay" id="gw-summary-overlay">
                <div class="gw-sheet">
                    <div class="gw-sheet-title">复盘</div>
                    <div class="gw-summary-body">${html}</div>
                    <div class="gw-sheet-actions">
                        ${opponent.id ? `<button class="gw-primary-btn" id="gw-share-send" type="button">发给 ${this._esc(opponent.name)}</button>` : ''}
                        <button class="gw-ghost-btn" id="gw-summary-close" type="button">关闭</button>
                    </div>
                </div>
            </div>
        `;
    }

    // ---------------------------------------------------------------- 事件

    _bindSetupEvents() {
        document.getElementById('gw-back-lobby')?.addEventListener('click', () => this.app.backToLobby());
        document.getElementById('gw-settings-open')?.addEventListener('click', () => {
            this._settingsOpen = true;
            this.renderSetup();
        });
        document.getElementById('gw-settings-close')?.addEventListener('click', () => {
            this._settingsOpen = false;
            this.renderSetup();
        });
        document.getElementById('gw-settings-overlay')?.addEventListener('click', event => {
            if (event.target?.id !== 'gw-settings-overlay') return;
            this._settingsOpen = false;
            this.renderSetup();
        });

        document.querySelectorAll('#gw-partners .gw-partner').forEach(btn => {
            btn.addEventListener('click', () => {
                this._selectedId = btn.dataset.partnerId || '';
                this.renderSetup();
            });
        });
        document.querySelectorAll('#gw-modes .gw-mode').forEach(btn => {
            btn.addEventListener('click', () => {
                this._mode = btn.dataset.mode || 'ai_guesses';
                /* ★ 写进**数据层**（不是只存视图字段）：回大厅再进来视图会重建，
                 *   只存视图字段的话用户刚选的玩法就悄悄回到默认了。 */
                this.app.guessWhatData?.setMode?.(this._mode);
                this.renderSetup();
            });
        });
        document.getElementById('gw-secret-word')?.addEventListener('input', event => {
            this._secretDraft = event.target.value;
        });
        document.getElementById('gw-start')?.addEventListener('click', () => this._startGame());
        this._syncSecretArea();
    }

    _syncSecretArea() {
        const area = document.getElementById('gw-secret-area');
        if (!area) return;
        area.style.display = this._mode === 'ai_guesses' ? 'block' : 'none';
    }

    _bindGameEvents() {
        document.getElementById('gw-back-lobby')?.addEventListener('click', () => {
            this.app.stopGuessWhatFlow?.();
            this.app.backToLobby();
        });
        document.getElementById('gw-settings-open')?.addEventListener('click', () => {
            this._settingsOpen = true;
            this.renderGame();
        });
        document.getElementById('gw-settings-close')?.addEventListener('click', () => {
            this._settingsOpen = false;
            this.renderGame();
        });
        document.getElementById('gw-settings-overlay')?.addEventListener('click', event => {
            if (event.target?.id !== 'gw-settings-overlay') return;
            this._settingsOpen = false;
            this.renderGame();
        });
        document.getElementById('gw-summary-open')?.addEventListener('click', () => {
            this._summaryOpen = true;
            this.renderGame();
        });
        document.getElementById('gw-summary-close')?.addEventListener('click', () => {
            this._summaryOpen = false;
            this.renderGame();
        });
        document.getElementById('gw-summary-overlay')?.addEventListener('click', event => {
            if (event.target?.id !== 'gw-summary-overlay') return;
            this._summaryOpen = false;
            this.renderGame();
        });
        document.getElementById('gw-share-send')?.addEventListener('click', () => this._shareSummary());
        document.getElementById('gw-play-again')?.addEventListener('click', () => {
            this.app.guessWhatData.reset();
            this._summaryOpen = false;
            this._secretDraft = '';
            this.renderSetup();
        });

        const input = document.getElementById('gw-user-input');
        input?.addEventListener('input', () => {
            this._secretDraft = input.value;
        });
        input?.addEventListener('keydown', event => {
            if (event.key !== 'Enter') return;
            event.preventDefault();
            this._send();
        });
        document.getElementById('gw-send')?.addEventListener('click', () => this._send());

        const logEl = document.getElementById('gw-log');
        logEl?.querySelectorAll('.gw-reroll').forEach(btn => {
            btn.addEventListener('click', () => this._reroll());
        });
    }

    // ---------------------------------------------------------------- 动作

    _startGame() {
        if (!this._selectedId) {
            this.app.phoneShell?.showNotification?.('你说我猜', '先挑一个玩伴', '💬');
            return;
        }
        const contacts = this.app.getWechatContactsForPoker?.() || [];
        const opponent = contacts.find(contact => contact.id === this._selectedId);
        if (!opponent) {
            this.app.phoneShell?.showNotification?.('你说我猜', '找不到这位玩伴', '💬');
            return;
        }
        const word = this._mode === 'ai_guesses' ? String(this._secretDraft || '').trim() : '';
        if (this._mode === 'ai_guesses' && !word) {
            this.app.phoneShell?.showNotification?.('你说我猜', '「我出题」要先想好一个词', '💬');
            return;
        }
        this.app.startGuessWhatGame?.({
            mode: this._mode,
            opponent: {
                id: opponent.id,
                name: opponent.name,
                avatar: opponent.avatar || '',
                persona: opponent.persona || ''
            },
            secretWord: word
        });
        this._secretDraft = '';
    }

    async _send() {
        if (this._busy) return;
        const data = this.app.guessWhatData;
        if (!data.isPlaying()) return;
        const input = document.getElementById('gw-user-input');
        const text = String(input?.value || '').trim();
        if (!text) return;
        this._busy = true;
        this.renderGame();
        try {
            await this.app.sendGuessWhatTurn?.(text);
            this._secretDraft = '';
        } finally {
            this._busy = false;
            this.render();
        }
    }

    async _reroll() {
        if (this._busy) return;
        this._busy = true;
        this.renderGame();
        try {
            await this.app.rerollGuessWhatTurn?.();
        } finally {
            this._busy = false;
            this.render();
        }
    }

    async _shareSummary() {
        await this.app.shareGuessWhatSummary?.();
        this._summaryOpen = false;
        this.render();
    }

    // ---------------------------------------------------------------- 生命周期

    isGameOpen() {
        const state = this.app.guessWhatData?.getState?.() || {};
        return state.phase === 'playing' || state.phase === 'ended';
    }

    handleBack() {
        if (this._settingsOpen) {
            this._settingsOpen = false;
            this.render();
            return true;
        }
        if (this._summaryOpen) {
            this._summaryOpen = false;
            this.render();
            return true;
        }
        return false;
    }

    destroy() {
        this._busy = false;
    }
}