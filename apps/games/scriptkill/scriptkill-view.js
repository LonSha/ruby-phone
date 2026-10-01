/* ========================================================
 *  柚月小手机 (Yuzuki's Little Phone)
 *  剧本杀 视图层（.sk- 前缀，本件独占）
 * ======================================================== */

import { SK_ASSIGN_MODES, SK_BUILT_IN_SCRIPTS, getBuiltInSkScript } from './scriptkill-data.js';

const CSS_URL = new URL('./scriptkill.css?v=1.0.0', import.meta.url).href;

export class ScriptKillView {
    constructor(app) {
        this.app = app;
        this._cssLoaded = false;
        this._scriptId = SK_BUILT_IN_SCRIPTS[0]?.id || '';
        this._assignMode = 'random';
        this._selectedIds = new Set();
        this._userRoleIndex = -1;
        this._settingsOpen = false;
        this._summaryOpen = false;
        this._rosterOpen = false;
        this._shareTargets = new Set();
        this._busy = false;
        this._draft = '';
        this._voteTarget = '';
    }

    // ---------------------------------------------------------------- 样式

    _loadCSS() {
        if (this._cssLoaded || document.getElementById('scriptkill-css')) {
            this._cssLoaded = true;
            return;
        }
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.id = 'scriptkill-css';
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
        if (player.avatar) return `<img class="sk-avatar-img" src="${this._escAttr(player.avatar)}" alt="">`;
        const initial = String(player.name || '?').slice(0, 1);
        return `<span class="sk-avatar-text">${this._esc(initial)}</span>`;
    }

    _nl(text) {
        return this._esc(text).split('\n').join('<br>');
    }

    // ---------------------------------------------------------------- 渲染

    render() {
        this._loadCSS();
        const state = this.app.scriptKillData.getState();
        if (state.phase && state.phase !== 'setup') {
            this.renderGame();
            return;
        }
        this.renderSetup();
    }

    renderSetup() {
        this._loadCSS();
        const script = getBuiltInSkScript(this._scriptId) || SK_BUILT_IN_SCRIPTS[0];
        const required = Math.max(0, (script?.roles?.length || 1) - 1);
        const contacts = this.app.getWechatContactsForPoker?.() || [];
        const options = contacts.map(contact => `
            <label class="sk-player-option ${this._selectedIds.has(contact.id) ? 'is-picked' : ''}">
                <input type="checkbox" class="sk-player-checkbox" value="${this._escAttr(contact.id)}" ${this._selectedIds.has(contact.id) ? 'checked' : ''}>
                <span class="sk-player-avatar">${this._avatar(contact)}</span>
                <span class="sk-player-name">${this._esc(contact.name)}</span>
            </label>
        `).join('');

        const scriptOptions = SK_BUILT_IN_SCRIPTS.map(item => `
            <option value="${this._escAttr(item.id)}" ${item.id === this._scriptId ? 'selected' : ''}>
                ${this._esc(item.name)}（${item.roles.length} 人）
            </option>
        `).join('');

        const modeOptions = SK_ASSIGN_MODES.map(mode => `
            <button class="sk-seg-btn ${this._assignMode === mode.value ? 'is-active' : ''}"
                    data-assign-mode="${mode.value}" type="button">${mode.label}</button>
        `).join('');

        const roleOptions = (script?.roles || []).map((role, index) => `
            <label class="sk-role-option ${this._userRoleIndex === index ? 'is-picked' : ''}">
                <input type="radio" name="sk-role" class="sk-role-radio" value="${index}" ${this._userRoleIndex === index ? 'checked' : ''}>
                <span class="sk-role-name">${this._esc(role.name)}</span>
                <span class="sk-role-desc">${this._esc(role.description)}</span>
            </label>
        `).join('');

        const html = `
            <div class="games-app sk-app sk-setup">
                <div class="games-topbar">
                    <button class="games-back-btn" id="sk-back-lobby" type="button" aria-label="返回">
                        <i class="fa-solid fa-chevron-left"></i>
                    </button>
                    <div>
                        <div class="games-title">剧本杀</div>
                        <div class="games-subtitle">抽角色 · 搜证 · 指认凶手</div>
                    </div>
                    <button class="games-icon-btn" id="sk-settings-open" type="button" title="玩法说明">
                        <i class="fa-solid fa-circle-info"></i>
                    </button>
                </div>

                <div class="sk-setup-body">
                    <div class="sk-section">
                        <div class="sk-section-title">选剧本</div>
                        <select class="sk-select" id="sk-script-select">${scriptOptions}</select>
                        <div class="sk-script-brief">${this._nl(script?.storyBackground || '')}</div>
                    </div>

                    <div class="sk-section">
                        <div class="sk-section-title">同席（需要 ${required} 位）</div>
                        <div class="sk-player-grid" id="sk-player-grid">
                            ${options || '<div class="sk-empty">微信里还没有可选的角色</div>'}
                        </div>
                        <div class="sk-picked-count" id="sk-picked-count">已选 ${this._selectedIds.size} / ${required}</div>
                    </div>

                    <div class="sk-section">
                        <div class="sk-section-title">角色分配</div>
                        <div class="sk-seg" id="sk-assign-seg">${modeOptions}</div>
                    </div>

                    <div class="sk-section" id="sk-role-pick-area" style="display:${this._assignMode === 'free' ? 'block' : 'none'}">
                        <div class="sk-section-title">你来挑一个</div>
                        <div class="sk-role-list" id="sk-role-list">${roleOptions}</div>
                    </div>
                </div>

                <div class="sk-footer">
                    <button class="sk-primary-btn" id="sk-start" type="button">开始游戏</button>
                </div>

                ${this._renderSettingsOverlay()}
            </div>
        `;
        this.app.phoneShell.setContent(html, 'sk-setup');
        this._bindSetupEvents();
    }

    renderGame() {
        this._loadCSS();
        const data = this.app.scriptKillData;
        const state = data.getState();
        const script = data.getScript();
        const user = data.getUserPlayer();
        const ended = state.phase === 'end';
        const voting = state.phase === 'voting';
        const searching = data.searchAllowance(state.phase) > 0;
        const canSearch = user ? data.canSearch(user.id) : false;
        const userTurn = data.isUserTurnPhase(state.phase) && !ended;

        const seats = (state.players || []).map(player => `
            <div class="sk-seat ${player.isUser ? 'is-user' : ''} ${state.winner && player.isKiller && state.truthRevealed ? 'is-killer' : ''}">
                <div class="sk-seat-avatar">${this._avatar(player)}</div>
                <div class="sk-seat-name">${this._esc(player.name)}</div>
                <div class="sk-seat-role">${this._esc(player.roleName || '—')}</div>
            </div>
        `).join('');

        const logs = (state.log || []).map(entry => this._renderLog(entry)).join('');

        const voteOptions = (state.players || []).map(player => `
            <button class="sk-vote-btn ${this._voteTarget === player.id ? 'is-picked' : ''}"
                    data-vote-target="${this._escAttr(player.id)}" type="button">${this._esc(player.name)}</button>
        `).join('');

        const html = `
            <div class="games-app sk-app sk-game">
                <div class="games-topbar">
                    <button class="games-back-btn" id="sk-back-lobby" type="button" aria-label="返回大厅">
                        <i class="fa-solid fa-chevron-left"></i>
                    </button>
                    <div>
                        <div class="games-title">剧本杀</div>
                        <div class="games-subtitle">${this._esc(script?.name || '—')} · ${this._esc(this._phaseLabel(state.phase))}</div>
                    </div>
                    <button class="games-icon-btn" id="sk-roster-open" type="button" title="我的剧本">
                        <i class="fa-solid fa-scroll"></i>
                    </button>
                </div>

                <div class="sk-seats">${seats}</div>

                <div class="sk-log" id="sk-log">${logs}</div>

                <div class="sk-action-area" id="sk-action-area">
                    ${ended ? `
                        <button class="sk-primary-btn" id="sk-summary-open" type="button">看复盘</button>
                        <button class="sk-ghost-btn" id="sk-play-again" type="button">再来一局</button>
                    ` : (voting ? `
                        <div class="sk-vote-hint">投票指认凶手</div>
                        <div class="sk-vote-row">${voteOptions}</div>
                        <button class="sk-primary-btn" id="sk-vote-submit" type="button" ${this._busy ? 'disabled' : ''}>确认投票</button>
                    ` : (searching ? `
                        <div class="sk-search-hint">本轮还剩 ${user ? data.remainingSearch(user.id) : 0} 次搜证机会</div>
                        <button class="sk-primary-btn" id="sk-do-search" type="button" ${(!canSearch || this._busy) ? 'disabled' : ''}>搜证</button>
                        <button class="sk-ghost-btn" id="sk-end-phase" type="button" ${this._busy ? 'disabled' : ''}>结束本环节</button>
                    ` : `
                        ${userTurn ? `
                            <input class="sk-input sk-input-inline" id="sk-speech-input" type="text" placeholder="${this._escAttr(this._phasePlaceholder(state.phase))}" value="${this._escAttr(this._draft)}">
                            <button class="sk-primary-btn" id="sk-speak" type="button" ${this._busy ? 'disabled' : ''}>发言</button>
                        ` : `<div class="sk-waiting">${this._busy ? '其他人正在说话…' : '等待其他人…'}</div>`}
                        <button class="sk-ghost-btn" id="sk-advance" type="button" ${this._busy ? 'disabled' : ''}>继续</button>
                    `))}
                </div>

                ${this._renderSettingsOverlay()}
                ${this._renderRosterOverlay()}
                ${this._renderSummaryOverlay()}
            </div>
        `;
        this.app.phoneShell.setContent(html, 'sk-game');
        this._bindGameEvents();
        const logEl = document.getElementById('sk-log');
        if (logEl) logEl.scrollTop = logEl.scrollHeight;
    }

    _phaseLabel(phase = '') {
        const map = {
            start: '开场',
            introduction: '自我介绍',
            timeline_discussion: '时间线',
            evidence_round_1: '第一轮搜证',
            discussion_round_1: '第一轮讨论',
            evidence_round_2: '第二轮搜证',
            discussion_round_2: '第二轮讨论',
            discussion_round_3: '最终讨论',
            voting: '投票',
            end: '结案'
        };
        return map[String(phase || '')] || '调查中';
    }

    _phasePlaceholder(phase = '') {
        const map = {
            introduction: '介绍你扮演的角色…',
            timeline_discussion: '说说你案发前后的行动轨迹…',
            discussion_round_1: '把你的怀疑说出来…',
            discussion_round_2: '结合搜到的线索再分析…',
            discussion_round_3: '最后陈述你的判断…'
        };
        return map[String(phase || '')] || '说点什么…';
    }

    _renderLog(entry = {}) {
        const type = String(entry.type || 'system');
        if (type === 'system') {
            return `<div class="sk-log-entry sk-log-system">${this._nl(entry.text)}</div>`;
        }
        if (type === 'vote') {
            return `<div class="sk-log-entry sk-log-vote">${this._nl(entry.text)}</div>`;
        }
        if (type === 'search') {
            return `
                <div class="sk-log-entry sk-log-search">
                    <div class="sk-log-who">${this._esc(entry.speakerName || '')}</div>
                    <div class="sk-log-text">${this._nl(entry.text)}</div>
                </div>
            `;
        }
        return `
            <div class="sk-log-entry sk-log-speech">
                <div class="sk-log-avatar">${this._avatar({ name: entry.speakerName, avatar: entry.speakerAvatar })}</div>
                <div class="sk-log-main">
                    <div class="sk-log-who">${this._esc(entry.speakerName || '')}</div>
                    <div class="sk-log-text">${this._nl(entry.text)}</div>
                </div>
            </div>
        `;
    }

    _renderSettingsOverlay() {
        if (!this._settingsOpen) return '';
        return `
            <div class="sk-overlay" id="sk-settings-overlay">
                <div class="sk-sheet">
                    <div class="sk-sheet-title">玩法</div>
                    <ul class="sk-rules">
                        <li>每人抽到一个角色，只有一个角色藏着凶手。</li>
                        <li>先自我介绍、再交代时间线，然后进入搜证与讨论。</li>
                        <li>第一轮有两处搜证机会，第二轮有一处。</li>
                        <li>搜证能拿到公共线索，也可能翻到自己的私人物品。</li>
                        <li>最后全体投票，唯一最高票正好是凶手才算好人赢。</li>
                    </ul>
                    <button class="sk-primary-btn" id="sk-settings-close" type="button">知道了</button>
                </div>
            </div>
        `;
    }

    _renderRosterOverlay() {
        if (!this._rosterOpen) return '';
        const data = this.app.scriptKillData;
        const user = data.getUserPlayer();
        const script = data.getScript();
        const evidence = Array.isArray(user?.evidence) ? user.evidence : [];
        return `
            <div class="sk-overlay" id="sk-roster-overlay">
                <div class="sk-sheet">
                    <div class="sk-sheet-title">我的剧本</div>
                    <div class="sk-roster-role">${this._esc(user?.roleName || '—')}</div>
                    <div class="sk-roster-block">
                        <div class="sk-section-title">角色介绍</div>
                        <div class="sk-roster-text">${this._nl(user?.description || '—')}</div>
                    </div>
                    <div class="sk-roster-block">
                        <div class="sk-section-title">你的故事</div>
                        <div class="sk-roster-text">${this._nl(user?.storyline || '—')}</div>
                    </div>
                    <div class="sk-roster-block">
                        <div class="sk-section-title">任务</div>
                        <div class="sk-roster-text">${this._nl(user?.tasks || '—')}</div>
                    </div>
                    <div class="sk-roster-block">
                        <div class="sk-section-title">已知线索（${evidence.length}）</div>
                        ${evidence.length
                            ? `<ul class="sk-clue-list">${evidence.map(text => `<li>${this._esc(text)}</li>`).join('')}</ul>`
                            : '<div class="sk-roster-text">还没有搜到东西。</div>'}
                    </div>
                    ${script?.truth && this.app.scriptKillData.getState().truthRevealed
                        ? `<div class="sk-roster-block"><div class="sk-section-title">真相</div><div class="sk-roster-text">${this._nl(script.truth)}</div></div>`
                        : ''}
                    <div class="sk-sheet-actions">
                        <button class="sk-ghost-btn" id="sk-roster-close" type="button">收起</button>
                    </div>
                </div>
            </div>
        `;
    }

    _renderSummaryOverlay() {
        if (!this._summaryOpen) return '';
        const data = this.app.scriptKillData;
        const aiPlayers = (data.getAiPlayers() || []);
        const targetList = aiPlayers.map(player => `
            <label class="sk-share-target">
                <input type="checkbox" class="sk-share-checkbox" value="${this._escAttr(player.id)}" ${this._shareTargets.has(player.id) ? 'checked' : ''}>
                <span>${this._esc(player.name)}</span>
            </label>
        `).join('');
        return `
            <div class="sk-overlay" id="sk-summary-overlay">
                <div class="sk-sheet">
                    <div class="sk-sheet-title">复盘</div>
                    <div class="sk-summary-body">${this._nl(data.getSummary())}</div>
                    ${aiPlayers.length ? `
                        <div class="sk-share-block">
                            <div class="sk-section-title">把复盘发给他们</div>
                            <div class="sk-share-targets">${targetList}</div>
                        </div>
                    ` : ''}
                    <div class="sk-sheet-actions">
                        ${aiPlayers.length ? '<button class="sk-primary-btn" id="sk-share-send" type="button">发送复盘</button>' : ''}
                        <button class="sk-ghost-btn" id="sk-summary-close" type="button">关闭</button>
                    </div>
                </div>
            </div>
        `;
    }

    // ---------------------------------------------------------------- 事件

    _bindSetupEvents() {
        document.getElementById('sk-back-lobby')?.addEventListener('click', () => this.app.backToLobby());
        document.getElementById('sk-settings-open')?.addEventListener('click', () => {
            this._settingsOpen = true;
            this.renderSetup();
        });
        document.getElementById('sk-settings-close')?.addEventListener('click', () => {
            this._settingsOpen = false;
            this.renderSetup();
        });
        document.getElementById('sk-settings-overlay')?.addEventListener('click', event => {
            if (event.target?.id !== 'sk-settings-overlay') return;
            this._settingsOpen = false;
            this.renderSetup();
        });

        const scriptSelect = document.getElementById('sk-script-select');
        scriptSelect?.addEventListener('change', () => {
            this._scriptId = scriptSelect.value || '';
            this._userRoleIndex = -1;
            this.renderSetup();
        });

        document.querySelectorAll('.sk-player-checkbox').forEach(box => {
            box.addEventListener('change', () => {
                if (box.checked) this._selectedIds.add(box.value);
                else this._selectedIds.delete(box.value);
                const script = getBuiltInSkScript(this._scriptId) || SK_BUILT_IN_SCRIPTS[0];
                const required = Math.max(0, (script?.roles?.length || 1) - 1);
                const counter = document.getElementById('sk-picked-count');
                if (counter) counter.textContent = `已选 ${this._selectedIds.size} / ${required}`;
                box.closest('.sk-player-option')?.classList.toggle('is-picked', box.checked);
            });
        });

        document.querySelectorAll('#sk-assign-seg .sk-seg-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                this._assignMode = btn.dataset.assignMode || 'random';
                this.renderSetup();
            });
        });

        document.querySelectorAll('.sk-role-radio').forEach(radio => {
            radio.addEventListener('change', () => {
                this._userRoleIndex = Number(radio.value);
                document.querySelectorAll('.sk-role-option').forEach(item => item.classList.remove('is-picked'));
                radio.closest('.sk-role-option')?.classList.add('is-picked');
            });
        });

        document.getElementById('sk-start')?.addEventListener('click', () => this._startGame());
    }

    _bindGameEvents() {
        document.getElementById('sk-back-lobby')?.addEventListener('click', () => {
            this.app.stopScriptKillFlow?.();
            this.app.backToLobby();
        });
        document.getElementById('sk-settings-open')?.addEventListener('click', () => {
            this._settingsOpen = true;
            this.renderGame();
        });
        document.getElementById('sk-settings-close')?.addEventListener('click', () => {
            this._settingsOpen = false;
            this.renderGame();
        });
        document.getElementById('sk-settings-overlay')?.addEventListener('click', event => {
            if (event.target?.id !== 'sk-settings-overlay') return;
            this._settingsOpen = false;
            this.renderGame();
        });

        document.getElementById('sk-roster-open')?.addEventListener('click', () => {
            this._rosterOpen = true;
            this.renderGame();
        });
        document.getElementById('sk-roster-close')?.addEventListener('click', () => {
            this._rosterOpen = false;
            this.renderGame();
        });
        document.getElementById('sk-roster-overlay')?.addEventListener('click', event => {
            if (event.target?.id !== 'sk-roster-overlay') return;
            this._rosterOpen = false;
            this.renderGame();
        });

        document.getElementById('sk-summary-open')?.addEventListener('click', () => {
            this._summaryOpen = true;
            this.renderGame();
        });
        document.getElementById('sk-summary-close')?.addEventListener('click', () => {
            this._summaryOpen = false;
            this.renderGame();
        });
        document.getElementById('sk-summary-overlay')?.addEventListener('click', event => {
            if (event.target?.id !== 'sk-summary-overlay') return;
            this._summaryOpen = false;
            this.renderGame();
        });
        document.querySelectorAll('.sk-share-checkbox').forEach(box => {
            box.addEventListener('change', () => {
                if (box.checked) this._shareTargets.add(box.value);
                else this._shareTargets.delete(box.value);
            });
        });
        document.getElementById('sk-share-send')?.addEventListener('click', () => this._shareSummary());

        const input = document.getElementById('sk-speech-input');
        input?.addEventListener('input', () => {
            this._draft = input.value;
        });
        input?.addEventListener('keydown', event => {
            if (event.key === 'Enter') {
                event.preventDefault();
                this._speak();
            }
        });
        document.getElementById('sk-speak')?.addEventListener('click', () => this._speak());
        document.getElementById('sk-advance')?.addEventListener('click', () => this._advance());
        document.getElementById('sk-do-search')?.addEventListener('click', () => this._search());
        document.getElementById('sk-end-phase')?.addEventListener('click', () => this._advance());

        document.querySelectorAll('.sk-vote-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                this._voteTarget = btn.dataset.voteTarget || '';
                document.querySelectorAll('.sk-vote-btn').forEach(item => item.classList.remove('is-picked'));
                btn.classList.add('is-picked');
            });
        });
        document.getElementById('sk-vote-submit')?.addEventListener('click', () => this._vote());

        document.getElementById('sk-play-again')?.addEventListener('click', () => {
            this.app.scriptKillData.reset();
            this._summaryOpen = false;
            this._shareTargets = new Set();
            this._voteTarget = '';
            this.renderSetup();
        });
    }

    // ---------------------------------------------------------------- 动作

    _startGame() {
        const script = getBuiltInSkScript(this._scriptId) || SK_BUILT_IN_SCRIPTS[0];
        const required = Math.max(0, (script?.roles?.length || 1) - 1);
        const contacts = this.app.getWechatContactsForPoker?.() || [];
        const picked = contacts.filter(contact => this._selectedIds.has(contact.id));
        if (picked.length !== required) {
            this.app.phoneShell?.showNotification?.('剧本杀', `这个剧本需要 ${required} 位同席`, '🎭');
            return;
        }
        if (this._assignMode === 'free' && this._userRoleIndex < 0) {
            this.app.phoneShell?.showNotification?.('剧本杀', '先挑一个你要演的角色', '🎭');
            return;
        }

        const userInfo = this.app._getWerewolfUserInfo?.() || {};
        const self = {
            id: 'user',
            name: userInfo.name || '我',
            avatar: userInfo.avatar || '',
            persona: '一个喜欢探案的普通人',
            isUser: true
        };
        const invited = picked.map(contact => ({
            id: contact.id,
            name: contact.name,
            avatar: contact.avatar || '',
            persona: contact.persona || '',
            isUser: false
        }));

        const data = this.app.scriptKillData;
        data.seatPlayers([self, ...invited]);
        const free = this._assignMode === 'free';
        if (!data.startGame({ scriptId: script.id, free, userRoleIndex: free ? this._userRoleIndex : -1 })) {
            this.app.phoneShell?.showNotification?.('剧本杀', '开局失败，请重试', '🎭');
            return;
        }
        this._draft = '';
        this._voteTarget = '';
        this.app.startScriptKillFlow?.();
    }

    async _speak() {
        if (this._busy) return;
        const input = document.getElementById('sk-speech-input');
        const text = String(input?.value || '').trim();
        if (!text) return;
        this._busy = true;
        try {
            await this.app.speakScriptKill({ text });
            this._draft = '';
        } finally {
            this._busy = false;
            this.render();
        }
    }

    async _advance() {
        if (this._busy) return;
        this._busy = true;
        try {
            await this.app.advanceScriptKill();
        } finally {
            this._busy = false;
            this.render();
        }
    }

    async _search() {
        if (this._busy) return;
        this._busy = true;
        try {
            await this.app.searchScriptKill();
        } finally {
            this._busy = false;
            this.render();
        }
    }

    async _vote() {
        if (this._busy) return;
        if (!this._voteTarget) {
            this.app.phoneShell?.showNotification?.('剧本杀', '先选一个人', '🎭');
            return;
        }
        this._busy = true;
        try {
            await this.app.voteScriptKill({ targetId: this._voteTarget });
            this._voteTarget = '';
        } finally {
            this._busy = false;
            this.render();
        }
    }

    async _shareSummary() {
        const ids = Array.from(this._shareTargets);
        if (!ids.length) {
            this.app.phoneShell?.showNotification?.('剧本杀', '先选一位分享对象', '🎭');
            return;
        }
        await this.app.shareScriptKillSummary?.(ids);
        this._summaryOpen = false;
        this._shareTargets = new Set();
        this.render();
    }

    // ---------------------------------------------------------------- 生命周期

    isGameOpen() {
        const state = this.app.scriptKillData?.getState?.() || {};
        return state.phase && state.phase !== 'setup';
    }

    handleBack() {
        if (this._summaryOpen) {
            this._summaryOpen = false;
            this.render();
            return true;
        }
        if (this._rosterOpen) {
            this._rosterOpen = false;
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