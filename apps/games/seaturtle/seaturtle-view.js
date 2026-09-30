/* ========================================================
 *  柚月小手机 (Yuzuki's Little Phone)
 *  海龟汤 视图层
 * ======================================================== */

import { TURTLE_PROVIDER_MODES, TURTLE_RIDDLE_TYPES, TURTLE_JUDGEMENTS } from './seaturtle-data.js';

const CSS_URL = new URL('./seaturtle.css?v=1.0.0', import.meta.url).href;

export class SeaTurtleView {
    constructor(app) {
        this.app = app;
        this._cssLoaded = false;
        this._settingsOpen = false;
        this._summaryOpen = false;
        this._shareTargets = new Set();
        this._selectedIds = new Set();
        this._providerMode = 'random';
        this._riddleType = '';
        this._busy = false;
        this._draft = '';
    }

    // ---------------------------------------------------------------- 样式

    _loadCSS() {
        if (this._cssLoaded || document.getElementById('seaturtle-css')) {
            this._cssLoaded = true;
            return;
        }
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.id = 'seaturtle-css';
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
        if (player.avatar) return `<img class="sts-avatar-img" src="${this._escAttr(player.avatar)}" alt="">`;
        const initial = String(player.name || '?').slice(0, 1);
        return `<span class="sts-avatar-text">${this._esc(initial)}</span>`;
    }

    // ---------------------------------------------------------------- 渲染

    render() {
        this._loadCSS();
        const state = this.app.seaTurtleData.getState();
        if (state.phase === 'guessing' || state.phase === 'reveal') {
            this.renderGame();
            return;
        }
        this.renderSetup();
    }

    renderSetup() {
        this._loadCSS();
        const contacts = this.app.getWechatContactsForPoker?.() || [];
        const options = contacts.map(contact => `
            <label class="sts-player-option ${this._selectedIds.has(contact.id) ? 'is-picked' : ''}">
                <input type="checkbox" class="sts-player-checkbox" value="${this._escAttr(contact.id)}" ${this._selectedIds.has(contact.id) ? 'checked' : ''}>
                <span class="sts-player-avatar">${this._avatar(contact)}</span>
                <span class="sts-player-name">${this._esc(contact.name)}</span>
            </label>
        `).join('');

        const providerOptions = TURTLE_PROVIDER_MODES.map(mode => `
            <button class="sts-seg-btn ${this._providerMode === mode.value ? 'is-active' : ''}"
                    data-provider-mode="${mode.value}" type="button">${mode.label}</button>
        `).join('');

        const typeOptions = TURTLE_RIDDLE_TYPES.map(type => `
            <option value="${this._escAttr(type)}" ${this._riddleType === type ? 'selected' : ''}>${type || '不限类型'}</option>
        `).join('');

        const html = `
            <div class="games-app sts-app sts-setup">
                <div class="games-topbar">
                    <button class="games-back-btn" id="sts-back-lobby" type="button" aria-label="返回">
                        <i class="fa-solid fa-chevron-left"></i>
                    </button>
                    <div>
                        <div class="games-title">海龟汤</div>
                        <div class="games-subtitle">一人出题 · 众人追问</div>
                    </div>
                    <button class="games-icon-btn" id="sts-settings-open" type="button" title="玩法说明">
                        <i class="fa-solid fa-circle-info"></i>
                    </button>
                </div>

                <div class="sts-setup-body">
                    <div class="sts-section">
                        <div class="sts-section-title">同桌</div>
                        <div class="sts-player-grid" id="sts-player-grid">
                            ${options || '<div class="sts-empty">微信里还没有可选的角色</div>'}
                        </div>
                    </div>

                    <div class="sts-section">
                        <div class="sts-section-title">谁来出题</div>
                        <div class="sts-seg" id="sts-provider-seg">${providerOptions}</div>
                    </div>

                    <div class="sts-section">
                        <div class="sts-section-title">谜题类型</div>
                        <select class="sts-select" id="sts-riddle-type">${typeOptions}</select>
                    </div>

                    <div class="sts-section" id="sts-user-riddle-area" style="display:none">
                        <div class="sts-section-title">你来出题</div>
                        <input class="sts-input" id="sts-user-riddle" type="text" placeholder="谜面（给玩家的那一段）">
                        <input class="sts-input" id="sts-user-answer" type="text" placeholder="谜底（只有你知道）">
                    </div>
                </div>

                <div class="sts-footer">
                    <button class="sts-primary-btn" id="sts-start" type="button">开始游戏</button>
                </div>

                ${this._renderSettingsOverlay()}
            </div>
        `;
        this.app.phoneShell.setContent(html, 'sts-setup');
        this._bindSetupEvents();
    }

    renderGame() {
        this._loadCSS();
        const data = this.app.seaTurtleData;
        const state = data.getState();
        const provider = data.getProvider();
        const usersTurn = data.canUserAsk();
        const revealMode = state.phase === 'reveal';

        const seats = (state.players || []).map(player => `
            <div class="sts-seat ${player.isProvider ? 'is-provider' : ''} ${player.isUser ? 'is-user' : ''}">
                <div class="sts-seat-avatar">${this._avatar(player)}</div>
                <div class="sts-seat-name">${this._esc(player.name)}</div>
                ${player.isProvider ? '<div class="sts-seat-tag">出题人</div>' : ''}
            </div>
        `).join('');

        const logs = (state.log || []).map(entry => this._renderLog(entry)).join('');

        const html = `
            <div class="games-app sts-app sts-game">
                <div class="games-topbar">
                    <button class="games-back-btn" id="sts-back-lobby" type="button" aria-label="返回大厅">
                        <i class="fa-solid fa-chevron-left"></i>
                    </button>
                    <div>
                        <div class="games-title">海龟汤</div>
                        <div class="games-subtitle">出题人 ${this._esc(provider?.name || '—')} · 提问 ${state.questionCount} 次</div>
                    </div>
                    <button class="games-icon-btn" id="sts-summary-open" type="button" title="查看谜底">
                        <i class="fa-solid fa-scroll"></i>
                    </button>
                </div>

                <div class="sts-seats">${seats}</div>

                <div class="sts-log" id="sts-log">${logs}</div>

                <div class="sts-action-area" id="sts-action-area">
                    ${revealMode ? `
                        <button class="sts-primary-btn" id="sts-play-again" type="button">再来一局</button>
                    ` : (usersTurn ? `
                        <input class="sts-input sts-input-inline" id="sts-question-input" type="text" placeholder="问一个只能回答「是 / 否」的问题…" value="${this._escAttr(this._draft)}">
                        <button class="sts-ghost-btn" id="sts-send-question" type="button" ${this._busy ? 'disabled' : ''}>提问</button>
                        <button class="sts-ghost-btn" id="sts-send-guess" type="button" ${this._busy ? 'disabled' : ''}>猜谜底</button>
                    ` : `
                        <div class="sts-waiting">${this._busy ? 'Ta 正在想…' : '等待 AI 出题人回应…'}</div>
                    `)}
                    ${state.phase === 'guessing' ? '<button class="sts-ghost-btn sts-reroll" id="sts-reroll" type="button" title="让 AI 们重新来一轮">⟳</button>' : ''}
                </div>

                ${this._renderSettingsOverlay()}
                ${this._renderSummaryOverlay()}
            </div>
        `;
        this.app.phoneShell.setContent(html, 'sts-game');
        this._bindGameEvents();
        const logEl = document.getElementById('sts-log');
        if (logEl) logEl.scrollTop = logEl.scrollHeight;
    }

    _renderLog(entry = {}) {
        const type = String(entry.type || 'system');
        if (type === 'system') {
            return `<div class="sts-log-entry sts-log-system">${this._esc(entry.text).split('\n').join('<br>')}</div>`;
        }
        const name = entry.speakerName || (type === 'answer' || type === 'remark' ? '出题人' : '');
        const cls = type === 'question' ? 'is-question'
            : (type === 'guess' ? 'is-guess' : (type === 'answer' ? 'is-answer' : 'is-remark'));
        return `
            <div class="sts-log-entry ${cls}">
                <div class="sts-log-who">${this._esc(name)}</div>
                <div class="sts-log-text">${this._esc(entry.text)}</div>
            </div>
        `;
    }

    _renderSettingsOverlay() {
        if (!this._settingsOpen) return '';
        return `
            <div class="sts-overlay" id="sts-settings-overlay">
                <div class="sts-sheet">
                    <div class="sts-sheet-title">玩法</div>
                    <ul class="sts-rules">
                        <li>出题人知道谜底，其他人只能问「是 / 否」问题。</li>
                        <li>出题人的回答有四档：${TURTLE_JUDGEMENTS.join(' / ')}。</li>
                        <li>「部分是」表示猜到了一半，回答后面会跟一句补充说明。</li>
                        <li>想直接报答案时点「猜谜底」，由出题人判定对错。</li>
                        <li>AI 出题人只会从自己人设的口吻说话，不会出戏。</li>
                    </ul>
                    <button class="sts-primary-btn" id="sts-settings-close" type="button">知道了</button>
                </div>
            </div>
        `;
    }

    _renderSummaryOverlay() {
        if (!this._summaryOpen) return '';
        const data = this.app.seaTurtleData;
        const html = this._esc(data.getSummary()).split('\n').join('<br>');
        const targets = (data.getGuessers() || []).filter(player => !player.isUser);
        const targetList = targets.map(player => `
            <label class="sts-share-target">
                <input type="checkbox" class="sts-share-checkbox" value="${this._escAttr(player.id)}" ${this._shareTargets.has(player.id) ? 'checked' : ''}>
                <span>${this._esc(player.name)}</span>
            </label>
        `).join('');
        return `
            <div class="sts-overlay" id="sts-summary-overlay">
                <div class="sts-sheet">
                    <div class="sts-sheet-title">谜底揭晓</div>
                    <div class="sts-summary-body">${html}</div>
                    ${targets.length ? `
                        <div class="sts-share-block">
                            <div class="sts-section-title">把复盘发给他们</div>
                            <div class="sts-share-targets">${targetList}</div>
                        </div>
                    ` : ''}
                    <div class="sts-sheet-actions">
                        ${targets.length ? '<button class="sts-primary-btn" id="sts-share-send" type="button">发送复盘</button>' : ''}
                        <button class="sts-ghost-btn" id="sts-summary-close" type="button">关闭</button>
                    </div>
                </div>
            </div>
        `;
    }

    // ---------------------------------------------------------------- 事件

    _bindSetupEvents() {
        document.getElementById('sts-back-lobby')?.addEventListener('click', () => this.app.backToLobby());
        document.getElementById('sts-settings-open')?.addEventListener('click', () => {
            this._settingsOpen = true;
            this.renderSetup();
        });
        document.getElementById('sts-settings-close')?.addEventListener('click', () => {
            this._settingsOpen = false;
            this.renderSetup();
        });
        document.getElementById('sts-settings-overlay')?.addEventListener('click', event => {
            if (event.target?.id !== 'sts-settings-overlay') return;
            this._settingsOpen = false;
            this.renderSetup();
        });

        document.querySelectorAll('.sts-player-checkbox').forEach(box => {
            box.addEventListener('change', () => {
                this._syncSelectionFromDom();
                box.closest('.sts-player-option')?.classList.toggle('is-picked', box.checked);
            });
        });

        document.querySelectorAll('#sts-provider-seg .sts-seg-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                this._providerMode = btn.dataset.providerMode || 'random';
                this.renderSetup();
            });
        });

        const typeSelect = document.getElementById('sts-riddle-type');
        typeSelect?.addEventListener('change', () => {
            this._riddleType = typeSelect.value || '';
        });

        document.getElementById('sts-start')?.addEventListener('click', () => this._startGame());

        this._syncUserRiddleArea();
    }

    _syncSelectionFromDom() {
        const ids = new Set();
        document.querySelectorAll('.sts-player-checkbox:checked').forEach(box => ids.add(box.value));
        this._selectedIds = ids;
    }

    _syncUserRiddleArea() {
        const area = document.getElementById('sts-user-riddle-area');
        if (!area) return;
        area.style.display = this._providerMode === 'user' ? 'block' : 'none';
    }

    _bindGameEvents() {
        document.getElementById('sts-back-lobby')?.addEventListener('click', () => {
            this.app.stopSeaTurtleFlow?.();
            this.app.backToLobby();
        });
        document.getElementById('sts-settings-open')?.addEventListener('click', () => {
            this._settingsOpen = true;
            this.renderGame();
        });
        document.getElementById('sts-settings-close')?.addEventListener('click', () => {
            this._settingsOpen = false;
            this.renderGame();
        });
        document.getElementById('sts-settings-overlay')?.addEventListener('click', event => {
            if (event.target?.id !== 'sts-settings-overlay') return;
            this._settingsOpen = false;
            this.renderGame();
        });
        document.getElementById('sts-summary-open')?.addEventListener('click', () => {
            this._summaryOpen = true;
            this.renderGame();
        });
        document.getElementById('sts-summary-close')?.addEventListener('click', () => {
            this._summaryOpen = false;
            this.renderGame();
        });
        document.getElementById('sts-summary-overlay')?.addEventListener('click', event => {
            if (event.target?.id !== 'sts-summary-overlay') return;
            this._summaryOpen = false;
            this.renderGame();
        });
        document.querySelectorAll('.sts-share-checkbox').forEach(box => {
            box.addEventListener('change', () => {
                if (box.checked) this._shareTargets.add(box.value);
                else this._shareTargets.delete(box.value);
            });
        });
        document.getElementById('sts-share-send')?.addEventListener('click', () => this._shareSummary());
        document.getElementById('sts-play-again')?.addEventListener('click', () => {
            this.app.seaTurtleData.reset();
            this._summaryOpen = false;
            this._shareTargets = new Set();
            this.renderSetup();
        });

        const input = document.getElementById('sts-question-input');
        input?.addEventListener('input', () => {
            this._draft = input.value;
        });
        input?.addEventListener('keydown', event => {
            if (event.key === 'Enter') {
                event.preventDefault();
                this._ask();
            }
        });
        document.getElementById('sts-send-question')?.addEventListener('click', () => this._ask());
        document.getElementById('sts-send-guess')?.addEventListener('click', () => this._guess());
        document.getElementById('sts-reroll')?.addEventListener('click', () => this.app.rerollSeaTurtleTurn?.());
    }

    // ---------------------------------------------------------------- 动作

    _startGame() {
        this._syncSelectionFromDom();
        const contacts = this.app.getWechatContactsForPoker?.() || [];
        const picked = contacts.filter(contact => this._selectedIds.has(contact.id));
        if (!picked.length) {
            this.app.phoneShell?.showNotification?.('海龟汤', '请至少邀请一位角色同桌', '🐢');
            return;
        }

        const userInfo = this.app._getWerewolfUserInfo?.() || {};
        const self = {
            id: 'user',
            name: userInfo.name || '我',
            avatar: userInfo.avatar || '',
            persona: '一个好奇的普通人',
            isUser: true
        };
        const invited = picked.map(contact => ({
            id: contact.id,
            name: contact.name,
            avatar: contact.avatar || '',
            persona: contact.persona || '',
            isUser: false
        }));

        const data = this.app.seaTurtleData;
        data.setProviderMode(this._providerMode);
        data.setRiddleType(this._riddleType);
        data.seatPlayers([self, ...invited]);

        const providerIndex = data.pickProviderIndex(this._providerMode);
        if (providerIndex < 0) {
            this.app.phoneShell?.showNotification?.('海龟汤', '没有找到可以出题的人', '🐢');
            return;
        }
        const provider = data.getState().players[providerIndex];

        if (!provider.isUser) {
            this.app.startSeaTurtleRound?.({ providerIndex });
            return;
        }

        const riddle = document.getElementById('sts-user-riddle')?.value?.trim() || '';
        const answer = document.getElementById('sts-user-answer')?.value?.trim() || '';
        if (!riddle || !answer) {
            this.app.phoneShell?.showNotification?.('海龟汤', '当出题人时，谜面和谜底都要填', '🐢');
            return;
        }
        if (data.startGame({ providerIndex, riddle, answer })) {
            this._draft = '';
            this.renderGame();
        }
    }

    async _ask() {
        if (this._busy) return;
        const input = document.getElementById('sts-question-input');
        const question = String(input?.value || '').trim();
        if (!question) return;
        this._busy = true;
        try {
            await this.app.askSeaTurtle({ question });
            this._draft = '';
        } finally {
            this._busy = false;
            this.render();
        }
    }

    async _guess() {
        if (this._busy) return;
        const input = document.getElementById('sts-question-input');
        const guess = String(input?.value || '').trim();
        if (!guess) return;
        this._busy = true;
        try {
            await this.app.guessSeaTurtle({ guess });
            this._draft = '';
        } finally {
            this._busy = false;
            this.render();
        }
    }

    async _shareSummary() {
        const ids = Array.from(this._shareTargets);
        if (!ids.length) {
            this.app.phoneShell?.showNotification?.('海龟汤', '先选一位分享对象', '🐢');
            return;
        }
        await this.app.shareSeaTurtleSummary?.(ids);
        this._summaryOpen = false;
        this._shareTargets = new Set();
        this.render();
    }

    // ---------------------------------------------------------------- 生命周期

    isGameOpen() {
        const state = this.app.seaTurtleData?.getState?.() || {};
        return state.phase === 'guessing' || state.phase === 'reveal';
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