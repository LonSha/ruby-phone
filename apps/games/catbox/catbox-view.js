/* ========================================================
 *  柚月小手机 (Yuzuki's Little Phone)
 *  猫盒像素宠物视图
 * ======================================================== */

const CAT_ASSETS = {
    A1: new URL('./assets/A1.png', import.meta.url).href,
    'A1-LEVEL-F': new URL('./assets/A1-LEVEL-F.png', import.meta.url).href,
    'A1-LEVEL-M': new URL('./assets/A1-LEVEL-M.png', import.meta.url).href,
    A2: new URL('./assets/A2.png', import.meta.url).href,
    A3: new URL('./assets/A3.png', import.meta.url).href,
    'A3-LEVEL-F': new URL('./assets/A3-LEVEL-F.png', import.meta.url).href,
    'A3-LEVEL-M': new URL('./assets/A3-LEVEL-M.png', import.meta.url).href,
    A4: new URL('./assets/A4.png', import.meta.url).href,
    A5: new URL('./assets/A5.png', import.meta.url).href,
    A6: new URL('./assets/A6.png', import.meta.url).href,
    A7: new URL('./assets/A7.png', import.meta.url).href,
    A8: new URL('./assets/A8.png', import.meta.url).href,
    'A8-LEVEL-F': new URL('./assets/A8-LEVEL-F.png', import.meta.url).href,
    'A8-LEVEL-M': new URL('./assets/A8-LEVEL-M.png', import.meta.url).href,
    A9: new URL('./assets/A9.png', import.meta.url).href,
    A10: new URL('./assets/A10.png', import.meta.url).href,
    A11: new URL('./assets/A11.png', import.meta.url).href,
    A12: new URL('./assets/A12.png', import.meta.url).href
};

const BACKGROUND_ASSETS = {
    wxxw1: new URL('./assets/wxxw1.png', import.meta.url).href,
    wxxw2: new URL('./assets/wxxw2.png', import.meta.url).href,
    wxxw3: new URL('./assets/wxxw3.jpeg', import.meta.url).href,
    wxxw4: new URL('./assets/wxxw4.png', import.meta.url).href
};

const LETTER_ASSET = new URL('./assets/tzxf.png', import.meta.url).href;

const GENDER_OPTIONS = [
    { value: 'female', label: '妹妹', icon: 'fa-venus' },
    { value: 'male', label: '弟弟', icon: 'fa-mars' }
];

const RARE_EVOLVE_CATS = new Set(['A1', 'A3', 'A8']);
const MAX_LEVEL = 10;
const ADOPTION_TIPS = [
    '纸箱里传来小小的呼噜声',
    '今天也有一只猫在偷偷观察你',
    '摸摸耳朵的话，也许会被记住',
    '小猫正在认真挑选自己的主人',
    '听说稀有的小猫长大后会变成更可爱的样子',
    '猫爪印刚刚从盒子边缘路过',
    '不要被圆眼睛骗走太多小鱼干',
    '它看起来像是会把杯子推下桌'
];
const RARE_ADOPTION_TIPS = [
    '这只小猫身上有一点稀有的光',
    '听说稀有的小猫满级后会悄悄进化',
    '它好像藏着长大后的秘密形态',
    '这只小猫看起来很会装无辜'
];

export class CatboxView {
    constructor(app) {
        this.app = app;
        this._cssLoaded = false;
        this._hudCollapsed = true;
        this._sleepTimer = null;
        this._bubbleTimer = null;
        this._inventoryOpen = false;
        this._abandonConfirmOpen = false;
        this._coAdoptOpen = false;
        this._lettersOpen = false;
        this._adoptionTip = this._randomAdoptionTip();
    }

    render() {
        this._loadCSS();
        const state = this.app.catboxData.getState();
        const html = state.adopted ? this._renderHome(state) : this._renderAdoption(state);
        this.app.phoneShell.setContent(html, 'games-catbox');
        this._bindEvents();
    }

    destroy() {
        if (this._sleepTimer) {
            clearTimeout(this._sleepTimer);
            this._sleepTimer = null;
        }
        if (this._bubbleTimer) {
            clearTimeout(this._bubbleTimer);
            this._bubbleTimer = null;
        }
    }

    resetHudCollapsed() {
        this._hudCollapsed = true;
    }

    _renderAdoption(state) {
        const catUrl = CAT_ASSETS[state.draftCatId] || '';
        const bgUrl = this._backgroundUrl(state.backgroundId);
        return `
            <div class="games-app games-catbox-app games-catbox-adoption" style="background-image: url('${bgUrl}')">
                ${this._renderTopbar('猫盒', '领养一只像素小猫', false)}
                <div class="games-catbox-content">
                    <div class="games-catbox-scene games-catbox-adopt-scene">
                        <div class="games-catbox-scanlines" aria-hidden="true"></div>
                        <div class="games-catbox-adopt-bubble">${this._escape(this._adoptionTipFor(state.draftCatId))}</div>
                        <div class="games-catbox-preview">
                            ${catUrl
                                ? `<img class="games-catbox-cat is-preview" src="${catUrl}" alt="随机小猫">`
                                : '<div class="games-catbox-empty-cat"><i class="fa-solid fa-dice"></i><span>等待随机</span></div>'}
                        </div>
                    </div>

                    <div class="games-catbox-adopt-panel">
                        <button class="games-catbox-primary" id="games-catbox-random" type="button">
                            <i class="fa-solid fa-shuffle"></i>
                            <span>随机小猫</span>
                        </button>
                        <label class="games-catbox-name-field">
                            <span>名字</span>
                            <input id="games-catbox-name" type="text" maxlength="8" autocomplete="off" placeholder="给小猫取名">
                        </label>
                        <div class="games-catbox-gender-field">
                            <span>性别</span>
                            <div class="games-catbox-gender-options" role="radiogroup" aria-label="小猫性别">
                                ${this._renderGenderOptions(state.catGender)}
                            </div>
                        </div>
                        <button class="games-catbox-adopt-btn" id="games-catbox-adopt" type="button" ${catUrl ? '' : 'disabled'}>
                            <i class="fa-solid fa-paw"></i>
                            <span>领养</span>
                        </button>
                    </div>
                </div>
            </div>
        `;
    }

    _renderHome(state) {
        const catUrl = this._catUrl(state);
        const bgUrl = this._backgroundUrl(state.backgroundId);
        const hudClass = this._hudCollapsed ? ' is-collapsed' : '';
        const sleepRemaining = this._sleepRemaining(state);
        const sleepingClass = sleepRemaining > 0 ? ' is-sleeping' : '';
        const exp = this.app.catboxData.getExpProgress?.() || { current: 0, required: 50, percent: 0 };
        const bubbleText = this._visibleBubbleText(state);
        const unreadLetters = this.app.catboxData.getUnreadLettersCount?.() || 0;
        const catPositionStyle = this._catPositionStyle(state);
        const hasCoAdopter = !!state.coAdopter;
        return `
            <div class="games-app games-catbox-app games-catbox-home" style="background-image: url('${bgUrl}')">
                <div class="games-catbox-playfield">
                    <div class="games-catbox-scanlines" aria-hidden="true"></div>
                    <img class="games-catbox-cat is-home" id="games-catbox-cat" src="${catUrl}" alt="${this._escape(state.catName)}" style="${catPositionStyle}" draggable="false">
                    ${bubbleText ? `<div class="games-catbox-cat-bubble">${this._escape(bubbleText)}</div>` : ''}
                    ${this._renderLetterButton(unreadLetters)}
                    ${sleepRemaining > 0 ? `<div class="games-catbox-sleep-countdown">睡眠 ${this._formatRemaining(sleepRemaining)}</div>` : ''}
                    <div class="games-catbox-hud${hudClass}">
                        <button class="games-catbox-profile" id="games-catbox-hud-toggle" type="button" aria-expanded="${this._hudCollapsed ? 'false' : 'true'}">
                            <div class="games-catbox-exp-wrap" title="经验 ${exp.current}/${exp.required}">
                                <div class="games-catbox-profile-main">
                                    <div class="games-catbox-profile-name">${this._escape(state.catName)}</div>
                                    <div class="games-catbox-level">Lv.${Number(state.level || 1)}</div>
                                    <div class="games-catbox-profile-gender" title="${this._escape(this._genderLabel(state.catGender))}">${this._escape(this._genderIcon(state.catGender))}</div>
                                </div>
                                <div class="games-catbox-exp-track">
                                    <div class="games-catbox-exp-fill" style="width: ${Math.max(0, Math.min(100, Number(exp.percent || 0)))}%;"></div>
                                    <div class="games-catbox-exp-pixels" aria-hidden="true"></div>
                                </div>
                                <div class="games-catbox-exp-text">${Number(exp.current || 0)}/${Number(exp.required || 50)}</div>
                            </div>
                        </button>
                        <div class="games-catbox-hud-body">
                            <div class="games-catbox-status-panel">
                                ${this._renderStat('心情', state.mood, '#ff7aa8', state.maxStat)}
                                ${this._renderStat('饱腹', state.hunger, '#f1b44c', state.maxStat)}
                                ${this._renderStat('精力', state.energy, '#62c6ff', state.maxStat)}
                            </div>
                        </div>
                    </div>
                    <div class="games-catbox-actions">
                        <button type="button" data-catbox-action="inventory"><i class="fa-solid fa-box"></i><span>仓库</span></button>
                        <button class="${sleepingClass}" type="button" data-catbox-action="feed"><i class="fa-solid fa-bowl-food"></i><span>喂食</span></button>
                        <button class="${sleepingClass}" type="button" data-catbox-action="pet"><i class="fa-solid fa-hand"></i><span>摸摸</span></button>
                        <button type="button" data-catbox-action="sleep"><i class="fa-solid fa-moon"></i><span>睡觉</span></button>
                        <button type="button" id="games-catbox-bg"><i class="fa-solid fa-image"></i><span>背景</span></button>
                        <button class="games-catbox-abandon-action" type="button" id="games-catbox-abandon"><i class="fa-solid fa-heart-crack"></i><span>弃养</span></button>
                        <button class="${hasCoAdopter ? 'games-catbox-coadopt-active' : ''}" type="button" id="games-catbox-coadopt">
                            <i class="fa-solid ${hasCoAdopter ? 'fa-heart-circle-check' : 'fa-user-plus'}"></i>
                            <span>${hasCoAdopter ? '解除' : '共养'}</span>
                        </button>
                    </div>
                    ${this._renderInventoryOverlay()}
                    ${this._renderCoAdoptOverlay()}
                    ${this._renderLettersOverlay()}
                    ${this._renderAbandonConfirm()}
                </div>
            </div>
        `;
    }

    _renderTopbar(title, subtitle, showReset) {
        return `
            <div class="games-topbar games-catbox-topbar">
                <button class="games-back-btn" id="games-catbox-back" type="button" aria-label="返回大厅">
                    <i class="fa-solid fa-chevron-left"></i>
                </button>
                <div class="games-title-wrap">
                    <div class="games-title">${this._escape(title)}</div>
                    ${subtitle ? `<div class="games-subtitle">${this._escape(subtitle)}</div>` : ''}
                </div>
                ${showReset ? `
                    <button class="games-icon-btn" id="games-catbox-reset" type="button" title="重新领养">
                        <i class="fa-solid fa-rotate-right"></i>
                    </button>
                ` : ''}
            </div>
        `;
    }

    _renderStat(label, value, color, maxValue = 100) {
        const safeValue = Math.max(0, Math.min(100, Math.round(Number(value || 0))));
        const safeMax = Math.max(1, Number(maxValue || 100));
        const percent = Math.max(0, Math.min(100, Math.round((Number(value || 0) / safeMax) * 100)));
        return `
            <div class="games-catbox-stat">
                <div class="games-catbox-stat-head">
                    <span>${this._escape(label)}</span>
                    <strong>${safeValue}</strong>
                </div>
                <div class="games-catbox-stat-track">
                    <span style="width: ${percent}%; background: ${color};"></span>
                </div>
            </div>
        `;
    }

    _renderGenderOptions(currentGender) {
        const selected = currentGender || 'female';
        return GENDER_OPTIONS.map(option => `
            <label class="games-catbox-gender-option">
                <input type="radio" name="games-catbox-gender" value="${option.value}" ${option.value === selected ? 'checked' : ''}>
                <i class="fa-solid ${option.icon}"></i>
                <span>${this._escape(option.label)}</span>
            </label>
        `).join('');
    }

    _renderInventoryOverlay() {
        if (!this._inventoryOpen) return '';
        const items = this.app.catboxData.getInventoryItems?.() || [];
        return `
            <div class="games-catbox-inventory-overlay" id="games-catbox-inventory-overlay">
                <div class="games-catbox-inventory-panel">
                    <div class="games-catbox-inventory-head">
                        <strong>仓库</strong>
                        <button id="games-catbox-inventory-close" type="button" aria-label="关闭">
                            <i class="fa-solid fa-xmark"></i>
                        </button>
                    </div>
                    <div class="games-catbox-inventory-list">
                        ${items.map(item => `
                            <button class="games-catbox-item" type="button" data-catbox-item="${this._escape(item.id)}" ${item.count > 0 ? '' : 'disabled'}>
                                <span class="games-catbox-item-icon">${this._escape(item.icon)}</span>
                                <span class="games-catbox-item-main">
                                    <strong>${this._escape(item.name)}</strong>
                                    <em>${this._escape(item.desc)}</em>
                                </span>
                                <span class="games-catbox-item-count">x${Number(item.count || 0)}</span>
                            </button>
                            <button class="games-catbox-buy" type="button" data-catbox-buy="${this._escape(item.id)}">
                                <span>购买</span>
                                <strong>¥${Number(item.price || 0).toFixed(0)}</strong>
                            </button>
                        `).join('')}
                    </div>
                </div>
            </div>
        `;
    }

    _renderLetterButton(unreadCount = 0) {
        const letters = this.app.catboxData.getState?.()?.letters || [];
        if (!Array.isArray(letters) || unreadCount <= 0) return '';
        return `
            <button class="games-catbox-letter-btn${unreadCount > 0 ? ' has-unread' : ''}" id="games-catbox-letters" type="button" aria-label="好友留言">
                <img src="${LETTER_ASSET}" alt="">
                ${unreadCount > 0 ? `<span>${Number(unreadCount)}</span>` : ''}
            </button>
        `;
    }

    _renderCoAdoptOverlay() {
        if (!this._coAdoptOpen) return '';
        const targets = this.app.getCatboxCoAdoptTargets?.() || [];
        return `
            <div class="games-catbox-coadopt-overlay" id="games-catbox-coadopt-overlay">
                <div class="games-catbox-coadopt-panel">
                    <div class="games-catbox-inventory-head">
                        <strong>共同收养</strong>
                        <button id="games-catbox-coadopt-close" type="button" aria-label="关闭">
                            <i class="fa-solid fa-xmark"></i>
                        </button>
                    </div>
                    <div class="games-catbox-coadopt-hint">选择一位微信好友，发送共养邀请。</div>
                    <div class="games-catbox-coadopt-list">
                        ${targets.length > 0 ? targets.map(target => `
                            <button class="games-catbox-coadopt-target" type="button" data-catbox-chat-id="${this._escape(target.chatId)}">
                                <span>${this.app.renderPlayerAvatar?.({ name: target.name, avatar: target.avatar }) || '👤'}</span>
                                <strong>${this._escape(target.name)}</strong>
                            </button>
                        `).join('') : '<div class="games-catbox-coadopt-empty">暂无可邀请的单聊好友</div>'}
                    </div>
                </div>
            </div>
        `;
    }

    _renderLettersOverlay() {
        if (!this._lettersOpen) return '';
        const letters = Array.isArray(this.app.catboxData.getState?.()?.letters)
            ? this.app.catboxData.getState().letters
            : [];
        return `
            <div class="games-catbox-letters-overlay" id="games-catbox-letters-overlay">
                <div class="games-catbox-letter-paper">
                    <div class="games-catbox-inventory-head">
                        <strong>好友纸条</strong>
                        <button id="games-catbox-letters-close" type="button" aria-label="关闭">
                            <i class="fa-solid fa-xmark"></i>
                        </button>
                    </div>
                    <div class="games-catbox-letter-list">
                        ${letters.length > 0 ? letters.map(letter => `
                            <article class="games-catbox-letter-note">
                                <div>
                                    <strong>${this._escape(letter.from || '好友')}</strong>
                                    <span>${this._escape(letter.itemName || '零食')} x${Number(letter.quantity || 1)}</span>
                                </div>
                                <p>${this._escape(letter.note || '')}</p>
                            </article>
                        `).join('') : '<div class="games-catbox-coadopt-empty">还没有留言</div>'}
                    </div>
                </div>
            </div>
        `;
    }

    _renderAbandonConfirm() {
        if (!this._abandonConfirmOpen) return '';
        return `
            <div class="games-catbox-confirm-overlay" id="games-catbox-abandon-overlay">
                <div class="games-catbox-confirm-panel">
                    <div class="games-catbox-confirm-title">弃养小猫</div>
                    <div class="games-catbox-confirm-text">你真的要弃养一只可爱的小猫么？</div>
                    <div class="games-catbox-confirm-actions">
                        <button class="games-catbox-confirm-cancel" id="games-catbox-abandon-cancel" type="button">取消</button>
                        <button class="games-catbox-confirm-ok" id="games-catbox-abandon-ok" type="button">确定</button>
                    </div>
                </div>
            </div>
        `;
    }

    _bindEvents() {
        document.getElementById('games-catbox-back')?.addEventListener('click', () => {
            this.app.backToLobby();
        });
        document.getElementById('games-catbox-random')?.addEventListener('click', () => {
            this._adoptionTip = '';
            this.app.randomCatboxCat();
        });
        document.getElementById('games-catbox-adopt')?.addEventListener('click', () => {
            const name = document.getElementById('games-catbox-name')?.value || '';
            const gender = document.querySelector('input[name="games-catbox-gender"]:checked')?.value || 'female';
            this.app.adoptCatboxCat(name, gender);
        });
        document.getElementById('games-catbox-name')?.addEventListener('keydown', e => {
            if (e.key !== 'Enter') return;
            e.preventDefault();
            const gender = document.querySelector('input[name="games-catbox-gender"]:checked')?.value || 'female';
            this.app.adoptCatboxCat(e.target?.value || '', gender);
        });
        document.getElementById('games-catbox-reset')?.addEventListener('click', () => {
            this.app.resetCatbox();
        });
        document.getElementById('games-catbox-bg')?.addEventListener('click', () => {
            this.app.nextCatboxBackground();
        });
        document.getElementById('games-catbox-abandon')?.addEventListener('click', () => {
            this._abandonConfirmOpen = true;
            this.render();
        });
        document.getElementById('games-catbox-coadopt')?.addEventListener('click', () => {
            const state = this.app.catboxData.getState?.() || {};
            if (state.coAdopter) {
                if (confirm(`要解除与${state.coAdopter.name || '好友'}的共同收养吗？`)) {
                    this.app.releaseCatboxCoAdopt?.();
                }
                return;
            }
            this._coAdoptOpen = true;
            this.render();
        });
        document.getElementById('games-catbox-coadopt-close')?.addEventListener('click', () => {
            this._coAdoptOpen = false;
            this.render();
        });
        document.getElementById('games-catbox-coadopt-overlay')?.addEventListener('click', e => {
            if (e.target?.id !== 'games-catbox-coadopt-overlay') return;
            this._coAdoptOpen = false;
            this.render();
        });
        document.querySelectorAll('[data-catbox-chat-id]').forEach(btn => {
            btn.addEventListener('click', () => {
                this._coAdoptOpen = false;
                this.app.inviteCatboxCoAdopt?.(btn.dataset.catboxChatId);
            });
        });
        document.getElementById('games-catbox-letters')?.addEventListener('click', () => {
            this._lettersOpen = true;
            this.app.catboxData.markLettersRead?.();
            this.render();
        });
        document.getElementById('games-catbox-letters-close')?.addEventListener('click', () => {
            this._lettersOpen = false;
            this.render();
        });
        document.getElementById('games-catbox-letters-overlay')?.addEventListener('click', e => {
            if (e.target?.id !== 'games-catbox-letters-overlay') return;
            this._lettersOpen = false;
            this.render();
        });
        document.getElementById('games-catbox-abandon-cancel')?.addEventListener('click', () => {
            this._abandonConfirmOpen = false;
            this.render();
        });
        document.getElementById('games-catbox-abandon-overlay')?.addEventListener('click', e => {
            if (e.target?.id !== 'games-catbox-abandon-overlay') return;
            this._abandonConfirmOpen = false;
            this.render();
        });
        document.getElementById('games-catbox-abandon-ok')?.addEventListener('click', () => {
            this._abandonConfirmOpen = false;
            this._inventoryOpen = false;
            this._coAdoptOpen = false;
            this._lettersOpen = false;
            this.app.resetCatbox();
        });
        document.getElementById('games-catbox-inventory-close')?.addEventListener('click', () => {
            this._inventoryOpen = false;
            this.render();
        });
        document.getElementById('games-catbox-inventory-overlay')?.addEventListener('click', e => {
            if (e.target?.id !== 'games-catbox-inventory-overlay') return;
            this._inventoryOpen = false;
            this.render();
        });
        document.querySelectorAll('[data-catbox-item]').forEach(btn => {
            btn.addEventListener('click', () => {
                this.app.useCatboxItem(btn.dataset.catboxItem);
                this._inventoryOpen = false;
            });
        });
        document.querySelectorAll('[data-catbox-buy]').forEach(btn => {
            btn.addEventListener('click', () => {
                this.app.buyCatboxItem(btn.dataset.catboxBuy);
                this._inventoryOpen = false;
            });
        });
        document.getElementById('games-catbox-hud-toggle')?.addEventListener('click', () => {
            this._hudCollapsed = !this._hudCollapsed;
            this.render();
        });
        document.querySelectorAll('[data-catbox-action]').forEach(btn => {
            btn.addEventListener('click', () => {
                if (btn.dataset.catboxAction === 'inventory') {
                    this._inventoryOpen = true;
                    this.render();
                    return;
                }
                this.app.performCatboxAction(btn.dataset.catboxAction);
            });
        });
        this._bindCatDrag();
        this._scheduleSleepTick();
        this._scheduleBubbleTick();
    }

    _backgroundUrl(backgroundId) {
        return BACKGROUND_ASSETS[backgroundId] || BACKGROUND_ASSETS.wxxw1;
    }

    _catUrl(state) {
        const catId = String(state?.catId || '');
        if (RARE_EVOLVE_CATS.has(catId) && Number(state?.level || 1) >= MAX_LEVEL) {
            const suffix = state?.catGender === 'female' ? 'F' : (state?.catGender === 'male' ? 'M' : '');
            const evolved = suffix ? `${catId}-LEVEL-${suffix}` : '';
            if (evolved && CAT_ASSETS[evolved]) return CAT_ASSETS[evolved];
        }
        return CAT_ASSETS[catId] || '';
    }

    _catPositionStyle(state) {
        const position = state?.catPosition;
        if (!position || typeof position !== 'object') return '';
        const x = Math.max(8, Math.min(92, Number(position.x || 50)));
        const y = Math.max(8, Math.min(92, Number(position.y || 45)));
        return `left:${x}%; top:${y}%; bottom:auto;`;
    }

    _genderLabel(gender) {
        const option = GENDER_OPTIONS.find(item => item.value === gender);
        return option?.label || '妹妹';
    }

    _genderIcon(gender) {
        return gender === 'male' ? '♂️' : '♀️';
    }

    _adoptionTipFor(catId) {
        if (this._adoptionTip) return this._adoptionTip;
        this._adoptionTip = this._randomAdoptionTip(catId);
        return this._adoptionTip;
    }

    _randomAdoptionTip(catId = '') {
        const rare = RARE_EVOLVE_CATS.has(String(catId || ''));
        const list = rare && Math.random() < 0.7 ? RARE_ADOPTION_TIPS : ADOPTION_TIPS;
        return list[Math.floor(Math.random() * list.length)];
    }

    _sleepRemaining(state) {
        return Math.max(0, Number(state?.sleepingUntil || 0) - Date.now());
    }

    _formatRemaining(ms) {
        const totalSeconds = Math.max(0, Math.ceil(Number(ms || 0) / 1000));
        const minutes = Math.floor(totalSeconds / 60);
        const seconds = totalSeconds % 60;
        return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    }

    _bindCatDrag() {
        const cat = document.getElementById('games-catbox-cat');
        const field = cat?.closest?.('.games-catbox-playfield');
        if (!cat || !field) return;

        let longPressTimer = null;
        let dragging = false;
        let activePointerId = null;

        const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
        const moveToEvent = (event, persist = false) => {
            const rect = field.getBoundingClientRect();
            if (!rect.width || !rect.height) return;
            const x = clamp(((event.clientX - rect.left) / rect.width) * 100, 8, 92);
            const y = clamp(((event.clientY - rect.top) / rect.height) * 100, 8, 92);
            cat.style.left = `${x}%`;
            cat.style.top = `${y}%`;
            cat.style.bottom = 'auto';
            if (persist) this.app.catboxData.setCatPosition?.({ x, y });
        };

        const clearTimer = () => {
            if (!longPressTimer) return;
            clearTimeout(longPressTimer);
            longPressTimer = null;
        };

        cat.addEventListener('pointerdown', event => {
            if (event.button !== undefined && event.button !== 0) return;
            event.preventDefault();
            event.stopPropagation();
            activePointerId = event.pointerId;
            clearTimer();
            longPressTimer = setTimeout(() => {
                dragging = true;
                cat.classList.add('is-dragging');
                cat.setPointerCapture?.(event.pointerId);
                moveToEvent(event);
            }, 350);
        });

        cat.addEventListener('pointermove', event => {
            if (!dragging || event.pointerId !== activePointerId) return;
            event.preventDefault();
            event.stopPropagation();
            moveToEvent(event);
        });

        const finish = event => {
            event.preventDefault?.();
            event.stopPropagation?.();
            clearTimer();
            if (dragging && event.pointerId === activePointerId) {
                moveToEvent(event, true);
                cat.classList.remove('is-dragging');
                cat.releasePointerCapture?.(event.pointerId);
            }
            dragging = false;
            activePointerId = null;
        };

        cat.addEventListener('pointerup', finish);
        cat.addEventListener('pointercancel', finish);
        cat.addEventListener('dragstart', event => {
            event.preventDefault();
            event.stopPropagation();
        });
        cat.addEventListener('pointerleave', event => {
            if (!dragging) clearTimer();
            else finish(event);
        });
    }

    _visibleBubbleText(state) {
        const text = String(state?.lastActionText || '').trim();
        if (!text) return '';
        const lastAt = Number(state?.lastActionAt || 0);
        if (!lastAt) return '';
        return Date.now() - lastAt <= 5000 ? text : '';
    }

    _scheduleSleepTick() {
        if (this._sleepTimer) {
            clearTimeout(this._sleepTimer);
            this._sleepTimer = null;
        }
        const state = this.app.catboxData.getState();
        if (!state?.adopted || this._sleepRemaining(state) <= 0) return;
        this._sleepTimer = setTimeout(() => this.render(), 1000);
    }

    _scheduleBubbleTick() {
        if (this._bubbleTimer) {
            clearTimeout(this._bubbleTimer);
            this._bubbleTimer = null;
        }
        const state = this.app.catboxData.getState();
        const lastAt = Number(state?.lastActionAt || 0);
        if (!state?.adopted || !lastAt) return;
        const remaining = 5000 - (Date.now() - lastAt);
        if (remaining <= 0) return;
        this._bubbleTimer = setTimeout(() => this.render(), remaining + 50);
    }

    _loadCSS() {
        if (this._cssLoaded) return;
        if (document.getElementById('games-catbox-css')) {
            this._cssLoaded = true;
            return;
        }
        const link = document.createElement('link');
        link.id = 'games-catbox-css';
        link.rel = 'stylesheet';
        link.href = new URL('./catbox.css?v=1.0.0', import.meta.url).href;
        document.head.appendChild(link);
        this._cssLoaded = true;
    }

    _escape(text) {
        return String(text ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }
}
