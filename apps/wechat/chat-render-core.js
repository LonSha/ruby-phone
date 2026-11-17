/* ================================================================
 * [v4.157.0 · R22-O1] 微信消息渲染内核（从 chat-view.js 原段抽出：只搬不改）
 *
 * 抽的就是这一段：chat-view.js 里**零业务判定**的渲染族 —— 投票卡 / 邀约卡 /
 * 内心 OS 拆解 / 文本气泡 / 表情面板。它们的读数全部来自 this.app 的接线件，
 * 自身不判任何一格状态；搬出去不会把判定搬散，只会把 19981 行的单文件切小。
 *
 * 搬了什么（7 个方法：源 L4639–L4996，逐字节未改）：
 *   _votePackCached / _renderGroupVoteCard / _renderGatheringCard /
 *   _gatherIdOfMsg / extractInnerThought / renderTextMessageBubble /
 *   renderEmojiPanel
 *
 * 为什么能“裸搬”（实测，不是感觉）：
 *   这 7 个方法体里的自由标识符**没有一处**指向 chat-view.js 的模块作用域；
 *   只用到 4 个 import（bubbleTheme / FACE_ATTR / getPhoneInlineEmoji /
 *   renderPhoneInlineEmoji），其余全是 this.*（= ChatView 实例）。
 *   故以“原型混入”形态回归：chat-view.js 里 Object.assign(ChatView.prototype,
 *   chatRenderCore)，方法里的 this 仍指 ChatView 实例，调用点一行未改。
 *
 * 不许做的事：
 *   ★ 搬的时候**顺手改逻辑** —— 那就不是等价拆分（快照闸会红）。
 *   ★ 两边各留一份实现 —— 第二份派生规则是本仓反复治过的病。
 *   等价性由 tests/audit/chat_render_snapshot.json 的 12 个 sha256 钉住：
 *   tests/r22_o1_chat_render_snapshot.test.mjs 逐键比对，抛错形态也算一项差异。
 * ================================================================ */
import { bubbleTheme } from '../../config/chat-bubble-theme.js?v=4.157.0&r=20261116-r22';
import { FACE_ATTR } from '../../config/empty-face.js';
import { getPhoneInlineEmoji, renderPhoneInlineEmoji } from '../../config/phone-emoji.js';

export const chatRenderCore = {
    /* ================================================================
     * [v4.29.0 · R4-X7] 群投票卡渲染
     *   本方法只**排版**：所有判定（四态 / 三态结果 / 四类人 / 平票）都来自内核，
     *   本方法连一个状态字面量比较都不写（判定词只许内核一份）。
     * ================================================================ */
    /**
     * 一次渲染内复用同一份读数（投票卡可能有好几张）。
     *   ★ 缓存键含「消息条数 + 末条 id」：任何一条新消息 / 删楼都会换键，
     *     故**不会**出现「读数与消息面不一致」的陈旧卡（本仓反复治过的那类）。
     *   ★ [v4.31.0 · R5-O3] 缓存键再含**票号**：同一次渲染里两张票各取各的，
     *     共用一格会把后一张的读数顶掉前一张（那正是「两张票混成一题」的观感来源）。
     */
    _votePackCached(chatId, msgs, pollId) {
        const list = Array.isArray(msgs) ? msgs : [];
        const last = list.length ? String(list[list.length - 1]?.id || '') : '';
        const pid = String(pollId == null ? '' : pollId).trim();
        const key = String(chatId || '') + '|' + list.length + '|' + last + '|' + pid;
        const cached = this._voteCache;
        if (cached && cached.key === key && cached.pack) return cached.pack;
        let pack = null;
        try { pack = this.app.votePack ? this.app.votePack(chatId, pid ? { pollId: pid } : {}) : null; } catch (_e) { pack = null; }
        if (!pack) return null;
        this._voteCache = { key: key, pack: pack };
        return pack;
    },
    _renderGroupVoteCard(msg) {
        const chatId = this.app.currentChat?.id || '';
        /* ★ 票号由**接线件**算（视图不写第二份派生规则）：认不出该消息 ⇒ 空票号，
         *   退回既有兼容形状（第一张票）—— 旧消息零改动。 */
        const pollId = this.app.votePollIdOfMessage
            ? String(this.app.votePollIdOfMessage(chatId, msg && msg.id) || '')
            : '';
        const pack = this._votePackCached(chatId, this.app.wechatData.getMessages(chatId), pollId);
        const read = (pack && pack.read) || null;
        const gv = (msg.groupVote && typeof msg.groupVote === 'object') ? msg.groupVote : {};
        const question = String(gv.question || msg.content || '').trim();
        const round = Number(gv.round || 1) || 1;
        const picked = String((pack && pack.picked) || '');
        const tied = (read && Array.isArray(read.tied)) ? read.tied : [];
        const rows = (read && Array.isArray(read.tally) && read.tally.length)
            ? read.tally
            : (Array.isArray(gv.options) ? gv.options.map((o) => ({
                optionId: String((o && o.id) || (o && o.label) || o || ''),
                label: String((o && (o.label || o.text)) || o || ''),
                support: 0, oppose: 0, abstain: 0
            })) : []);
        const lineText = (pack && pack.lines && pack.lines.vote) || '';
        const noteText = (pack && pack.note) || '';
        const gate = (pack && pack.gate) || { readable: true, hint: '' };
        const rowHtml = rows.map((row) => {
            const oid = String(row.optionId || '');
            const isPicked = !!picked && picked === oid;
            const isTied = tied.indexOf(oid) >= 0;
            const cls = isPicked ? 'is-picked' : (isTied ? 'is-tied' : '');
            const sup = Array.isArray(row.members) ? row.members : [];
            const meta = '支持 ' + Number(row.support || 0)
                + (row.oppose ? ' · 反对 ' + Number(row.oppose) : '')
                + (row.abstain ? ' · 弃权 ' + Number(row.abstain) : '');
            return `
                <div class="message-group-vote-row ${cls}">
                    <div class="message-group-vote-opt">
                        <div class="message-group-vote-opt-name">${this._escapeHtml(String(row.label || oid))}</div>
                        <div class="message-group-vote-opt-meta">${this._escapeHtml(meta)}${sup.length ? ' · ' + this._escapeHtml(sup.join('、')) : ''}</div>
                    </div>
                    <button type="button" class="message-group-vote-pick ${isPicked ? 'is-on' : ''}" data-action="pick-vote-option" data-option-id="${this._escapeHtml(oid)}">${isPicked ? '已点' : '点这个'}</button>
                </div>
            `;
        }).join('');
        /* ★ 读不出时**不摆选项行**：摆出来就等于说「这些选项可用」，
         *   而其实这一面压根没读出来（两件事处置相反）。 */
        const bodyHtml = gate.readable ? rowHtml : '';
        const hintHtml = gate.readable ? '' : `
            <div class="message-group-vote-foot">${this._escapeHtml(String(gate.hint || ''))}</div>
        `;
        /* ★ 「确认」按钮的可用性由**内核读数**决定，不由视图猜：
         *   平票（leader 为空）时按钮仍在，但转交时会拿到内核的拒收理由。 */
        const canConfirm = !!(read && read.leader);
        const actionsHtml = gate.readable ? `
            <div class="message-group-vote-actions">
                <button type="button" class="message-group-vote-btn is-glass" data-action="clear-vote-option">清掉选位</button>
                <button type="button" class="message-group-vote-btn is-primary" data-action="confirm-group-vote" data-message-id="${this._escapeHtml(String(msg.id || ''))}" data-poll-id="${this._escapeHtml(pollId)}">确认活动</button>
            </div>
        ` : '';
        return `
            <div class="message-group-vote" data-message-id="${this._escapeHtml(String(msg.id || ''))}">
                <div class="message-group-vote-head">
                    <span class="message-group-vote-title">群投票</span>
                    <span class="message-group-vote-badge">第 ${round} 轮</span>
                </div>
                ${question ? `<div class="message-group-vote-question">${this._escapeHtml(question)}</div>` : ''}
                ${bodyHtml}
                ${hintHtml}
                <div class="message-group-vote-line">${this._escapeHtml(lineText)}</div>
                ${noteText ? `<div class="message-group-vote-line">${this._escapeHtml(noteText)}</div>` : ''}
                ${actionsHtml}
            </div>
        `;
    },
    /* ============================================================
     * [v4.124.0 · R14-X2] 多人邀约卡
     *   ★ 三圈人分开摆（说来 / 不来 / 还没定），**「要复核」单独一行**：
     *     改期之后「上次说来的还算不算」必须是屏幕上看得见的一行 ——
     *     并进「没回」就等于把「改期」这件事从界面上抹掉了。
     *   ★ 卡片只摆**台账现读**的读数，不由消息数推算：
     *     消息是证据，台账是读数。view 不重判任何一格。
     * ============================================================ */
    _renderGatheringCard(msg) {
        const card = (msg && msg.gatheringCard && typeof msg.gatheringCard === 'object') ? msg.gatheringCard : {};
        const pack = this.app.gatherPack
            ? this.app.gatherPack(this._gatherIdOfMsg(msg))
            : null;
        /* 台账还没这一场（首次渲染这张卡）⇒ 现在建一场，再取读数。
         *   ★ 幂等：同一条消息恒同一场，重绘/回看不重复建。 */
        if (!pack || !pack.found) {
            try { this.app.gatherOpenFromMessage?.(msg); } catch (_e) { /* 建不出来就走降级渲染 */ }
        }
        const p = (this.app.gatherPack ? this.app.gatherPack(this._gatherIdOfMsg(msg)) : null) || pack;
        const title = this._escapeHtml(String(card.title || (msg && msg.content) || '').trim());
        if (!p || !p.found) {
            /* ★ 读不出来时**如实说**，不摆一份空名单：空名单会被读成「没人被邀请」。 */
            return `
                <div class="message-gather">
                    <div class="message-gather-head">
                        <span class="message-gather-title">邀约</span>
                    </div>
                    <div class="message-gather-quest">${title}</div>
                    <div class="message-gather-foot">这一场的逐人答复读不出来（不是「没人被邀请」）</div>
                </div>
            `;
        }
        const board = p.board || {};
        const rows = Array.isArray(board.rows) ? board.rows : [];
        const c = board.counts || {};
        const rowHtml = rows.map((r) => {
            const reply = String(r.reply || '');
            const cls = reply === 'yes' ? 'is-yes'
                : (reply === 'no' ? 'is-no'
                    : (reply === 'stale' ? 'is-stale' : (reply === 'maybe' ? 'is-maybe' : 'is-pending')));
            const label = this.app.replyLabelOf ? String(this.app.replyLabelOf(reply) || reply) : reply;
            /* stale 那一行必须写清「上次是怎么说的」—— 否则用户不知道该复核什么。 */
            const was = (reply === 'stale' && r.was)
                ? '（第 ' + String(r.wasRound || '?') + ' 轮说「'
                    + this._escapeHtml(String(this.app.replyLabelOf ? this.app.replyLabelOf(r.was) : r.was))
                    + '」）'
                : '';
            const mid = this._escapeHtml(String(r.memberId || ''));
            return `
                <div class="message-gather-row ${cls}">
                    <span class="message-gather-who">${this._escapeHtml(String(r.name || r.memberId || ''))}</span>
                    <span class="message-gather-reply-text">${this._escapeHtml(label)}${was}</span>
                    <button type="button" class="message-gather-set" data-action="gather-mark-yes" data-member-id="${mid}">来</button>
                    <button type="button" class="message-gather-set" data-action="gather-mark-no" data-member-id="${mid}">不来</button>
                </div>
            `;
        }).join('');
        /* 候选时段：用户显式点选一个（不默认选第一个）。 */
        const slots = Array.isArray(board.candidates) ? board.candidates : [];
        const picked = String(p.pickedSlot || board.pickedSlotId || '');
        const slotHtml = slots.map((s) => {
            const sid = this._escapeHtml(String(s.id || ''));
            const on = picked && picked === s.id;
            return `
                <button type="button" class="message-gather-slot ${on ? 'is-on' : ''}"
                    data-action="gather-pick-slot" data-slot-id="${sid}">${this._escapeHtml(String(s.label || s.id || ''))}</button>
            `;
        }).join('');
        const gate = p.gate || {};
        const foot = [];
        if (c.stale) {
            foot.push('改期过了：第 ' + String(board.round || 1) + ' 轮有 ' + c.stale + ' 人上次说过话，要重新确认（不是默认还来）');
        }
        if (c.pending) foot.push('没回 ' + c.pending + ' 人（还没说，不算答应）');
        if (c.foreign) foot.push('表外答复 ' + c.foreign + ' 条（不在邀请名单，不计入）');
        if (gate.warn) foot.push(String(gate.warn));
        return `
            <div class="message-gather" data-gather-id="${this._escapeHtml(String(p.gathering?.gatherId || ''))}">
                <div class="message-gather-head">
                    <span class="message-gather-title">邀约</span>
                    <span class="message-gather-badge">${this._escapeHtml(String(p.stateLabel || ''))}</span>
                    <span class="message-gather-badge is-round">第 ${this._escapeHtml(String(board.round || 1))} 轮</span>
                </div>
                <div class="message-gather-quest">${title}</div>
                <div class="message-gather-line">${this._escapeHtml(String(p.line || ''))}</div>
                ${rowHtml ? `<div class="message-gather-rows">${rowHtml}</div>` : ''}
                ${slotHtml ? `<div class="message-gather-slots">${slotHtml}</div>` : '<div class="message-gather-foot">还没有候选时段（先给几个时间让人挑）</div>'}
                ${foot.length ? `<div class="message-gather-foot">${foot.map((x) => this._escapeHtml(x)).join('<br>')}</div>` : ''}
                <div class="message-gather-actions">
                    <button type="button" class="message-gather-btn is-glass" data-action="gather-reschedule">改期</button>
                    <button type="button" class="message-gather-btn is-glass" data-action="gather-cancel">取消</button>
                    <button type="button" class="message-gather-btn is-primary" data-action="gather-confirm-slot"
                        ${gate.canConfirm ? '' : 'disabled'}>定这个时段</button>
                </div>
            </div>
        `;
    },
    /** 由消息算场次 id（与接线件同一条派生规则；视图不另写一份算法）。 */
    _gatherIdOfMsg(msg) {
        const m = (msg && typeof msg === 'object') ? msg : {};
        try {
            return this.app.gatherIdOfMessage
                ? this.app.gatherIdOfMessage(m.id, m.chatId || this.app.currentChat?.id || '', m.content || '')
                : '';
        } catch (_e) { return ''; }
    },
    extractInnerThought(content) {
        const source = String(content ?? '');
        const thoughts = [];
        const visibleContent = source.replace(/\[\s*内心\s*\]\s*[（(]\s*([\s\S]*?)\s*[）)]/g, (_match, thought) => {
            const text = String(thought || '').trim();
            if (text) thoughts.push(text);
            return '';
        }).replace(/[ \t]{2,}/g, ' ').trim();

        return {
            visibleContent,
            innerThought: thoughts.join('\n')
        };
    },

    renderTextMessageBubble(content, { isGroupChat = false } = {}) {
        /* [v4.157.0 · R22-X7] 主题形状来自单一主题桥，默认值维持原有视觉；用户配置只选主题 id。 */
        const _r22ThemeId = String(this.app?.storage?.get?.('rp22_chat_bubble_theme') || 'default');
        const _r22Theme = bubbleTheme(_r22ThemeId);
        this.app._r22BubbleThemeFace = { face: _r22Theme.face, id: _r22Theme.id, style: _r22Theme.style };
        const parsed = this.extractInnerThought(content);
        const cleanContent = parsed.visibleContent || (parsed.innerThought ? '...' : content);
        const visibleText = this._stripCallSpeechPrefix(cleanContent);
        const visibleHtml = this.parseEmoji(visibleText);

        if (!parsed.innerThought || isGroupChat) {
            return `<div class="message-text r22-bubble-theme-${this._escapeHtml(_r22Theme.id)}" data-r22-bubble-theme="${this._escapeHtml(_r22Theme.id)}" style="--r22-bubble-self:${_r22Theme.style.self};--r22-bubble-other:${_r22Theme.style.other};--r22-bubble-radius:${Number(_r22Theme.style.radius)||8}px;">${visibleHtml}</div>`;
        }

        return `
            <div class="wechat-inner-os-wrapper">
                <div class="message-text wechat-inner-os-bubble">
                    ${visibleHtml}
                    <button class="wechat-inner-os-fold" type="button" aria-label="查看内心OS"></button>
                </div>
                <div class="wechat-inner-os-popup" role="note">
                    <div class="wechat-inner-os-title">INNER THOUGHTS</div>
                    <div class="wechat-inner-os-content">${this._escapeHtml(parsed.innerThought)}</div>
                </div>
            </div>
        `;
    },

    renderEmojiPanel() {
        const emojis = [
            '[狗头]',
            // 😀 表情情绪
            '😀', '😃', '😄', '😁', '😆', '😅', '😂', '🤣', '😊', '🙂', '🙃', '😉', '😌', '😍', '🥰', '😘',
            '😗', '😙', '😚', '😋', '😛', '😝', '😜', '🤪', '🤨', '🧐', '🤓', '😎', '🥳', '🤩',
            '😏', '😒', '😞', '😔', '😟', '😕', '🙁', '☹️', '😣', '😖', '😫', '😩', '🥺', '😢', '😭', '😤',
            '😠', '😡', '🤬', '🤯', '😳', '🥵', '🥶', '😱', '😨', '😰', '😥', '😓', '🤗', '🤔', '🤭', '🤫',
            '🫢', '🫣', '🫡', '😴', '🤤', '😪', '😵', '😵‍💫', '🤐', '😶', '🙄', '😬',

            // 👋 手势
            '👋', '🤚', '🖐️', '✋', '🖖', '🫱', '🫲', '👌', '🤌', '🤏', '✌️', '🤞', '🫰', '🤟', '🤘', '🤙',
            '👈', '👉', '👆', '🖕', '👇', '☝️', '👍', '👎', '✊', '👊', '🤛', '🤜', '👏', '🙌', '👐', '🤲', '🙏',

            // ❤️ 常用符号
            '❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '🤎', '💔', '❣️', '💕', '💞', '💓', '💗', '💖', '💘', '💝',
            '⭐', '✨', '⚡', '🔥', '💧', '🌈', '☀️', '🌙', '🍀', '🎉', '🎊', '🎁',

            // 🐶 常见动物
            '🐶', '🐱', '🐭', '🐹', '🐰', '🦊', '🐻', '🐼', '🐨', '🐯', '🦁', '🐮', '🐷', '🐸', '🐵', '🐤', '🐧', '🐦',

            // 🍔 食物与出行
            '🍎', '🍓', '🍉', '🍔', '🍟', '🍕', '☕', '🍺', '🚗', '🚕', '🚌', '🚇', '✈️', '🚀'
        ];

        const customEmojis = this.app.wechatData.getCustomEmojis();
        this._syncCustomEmojiSelectionWithData();
        const customMode = this.emojiTab === 'custom';
        const isSelectionMode = customMode && this.customEmojiSelectionMode;
        const selectedCount = this.selectedCustomEmojiIds.size;
        const customIds = customEmojis.map(emoji => String(emoji?.id || '').trim()).filter(Boolean);
        const allSelected = customIds.length > 0 && customIds.every(id => this.selectedCustomEmojiIds.has(id));

        return `
        <div class="emoji-panel">
            <!-- 🔥 新增：表情标签 -->
            <div class="emoji-tabs" role="tablist" aria-label="表情分类">
                <div class="emoji-tab ${this.emojiTab !== 'custom' ? 'active' : ''}" data-tab="default" role="tab" tabindex="0" aria-selected="${this.emojiTab !== 'custom' ? 'true' : 'false'}">
                    系统表情
                </div>
                <div class="wechat-emoji-custom-tab">
                    <div class="emoji-tab ${this.emojiTab === 'custom' ? 'active' : ''}" data-tab="custom" role="tab" tabindex="0" aria-selected="${this.emojiTab === 'custom' ? 'true' : 'false'}">
                        <span>我的表情</span>
                    </div>
                    <button type="button" class="wechat-emoji-manage-trigger" aria-label="表情管理" aria-expanded="${this.customEmojiManageMenuOpen ? 'true' : 'false'}">
                        <i class="fa-solid fa-broom" aria-hidden="true"></i>
                    </button>
                </div>
            </div>

            ${customMode ? `
            <div class="wechat-emoji-manage-menu${this.customEmojiManageMenuOpen ? ' is-open' : ''}" aria-hidden="${this.customEmojiManageMenuOpen ? 'false' : 'true'}">
                <button type="button" id="toggle-custom-emoji-manage" class="wechat-emoji-manage-action">
                    <i class="fa-solid ${isSelectionMode ? 'fa-check' : 'fa-list-check'}" aria-hidden="true"></i>
                    <span>${isSelectionMode ? '完成' : '多选删除'}</span>
                </button>
                <button type="button" id="delete-selected-custom-emoji" class="wechat-emoji-manage-action is-danger" ${!isSelectionMode || selectedCount === 0 ? 'disabled' : ''}>
                    <i class="fa-regular fa-trash-can" aria-hidden="true"></i>
                    <span>删除选中${selectedCount > 0 ? `(${selectedCount})` : ''}</span>
                </button>
                <button type="button" id="clear-custom-emoji-all" class="wechat-emoji-manage-action is-danger" ${customEmojis.length === 0 ? 'disabled' : ''}>
                    <i class="fa-solid fa-eraser" aria-hidden="true"></i>
                    <span>一键清空</span>
                </button>
            </div>
            ${isSelectionMode ? `
            <div class="wechat-emoji-selection-hint">
                当前处于多选删除模式，点击表情可勾选。<button type="button" id="select-all-custom-emoji">${allSelected ? '取消全选' : '全选'}</button>
            </div>
            ` : ''}
            ` : ''}

           <div class="emoji-scroll">
                <div class="emoji-grid${customMode ? ' wechat-custom-emoji-grid' : ''}">
                    ${this.emojiTab === 'custom' ? `
                        <!-- 自定义表情 -->
                        ${customEmojis.length === 0 ? `
                            <div class="wechat-custom-emoji-empty" ${FACE_ATTR}="no-data" data-face="empty" role="status">
                                <span>还没有添加表情</span>
                                <small>点击下方加号添加</small>
                            </div>
                        ` : ''}
                        ${customEmojis.map(emoji => `
                            <span class="emoji-item custom-emoji-item ${isSelectionMode && this.selectedCustomEmojiIds.has(String(emoji.id || '')) ? 'is-selected' : ''}" data-emoji-type="custom" data-emoji-id="${this._escapeHtml(emoji.id || '')}" data-selection-mode="${isSelectionMode ? '1' : '0'}" title="${this._escapeHtml(String(emoji.description || emoji.name || '表情'))}" style="position:relative;${isSelectionMode && this.selectedCustomEmojiIds.has(String(emoji.id || '')) ? 'outline:2px solid #07c160; outline-offset:1px; border-radius:10px;' : ''}">
                                <img src="${this.escapeInlineStickerAttr(emoji.image || '')}" data-custom-emoji-src="${this.escapeInlineStickerAttr(emoji.image || '')}" alt="${this._escapeHtml(emoji.name || '')}" referrerpolicy="no-referrer">
                                ${isSelectionMode ? `<span style="position:absolute; top:2px; right:2px; width:14px; height:14px; border-radius:50%; background:${this.selectedCustomEmojiIds.has(String(emoji.id || '')) ? '#07c160' : 'rgba(255,255,255,0.9)'}; border:1px solid ${this.selectedCustomEmojiIds.has(String(emoji.id || '')) ? '#07c160' : '#ccc'}; color:#fff; font-size:10px; line-height:12px; text-align:center;">${this.selectedCustomEmojiIds.has(String(emoji.id || '')) ? '✓' : ''}</span>` : ''}
                            </span>
                        `).join('')}

                        <!-- 添加表情按钮 -->
                        <span class="emoji-item emoji-add" id="add-custom-emoji" style="${isSelectionMode ? 'opacity:0.45; pointer-events:none;' : ''}">
                            <i class="fa-solid fa-plus"></i>
                        </span>
                    ` : `
                        <!-- 系统表情 -->
                        ${emojis.map(emoji => {
                            const mappedEmoji = getPhoneInlineEmoji(emoji);
                            const title = mappedEmoji?.name || emoji;
                            const renderedEmoji = mappedEmoji
                                ? renderPhoneInlineEmoji(emoji, { size: 20, inline: false, className: 'wechat-system-emoji-image' })
                                : this.renderTwemojiEmoji(emoji, 20, false);
                            return `
                                <span class="emoji-item" data-emoji="${this._escapeHtml(emoji)}" title="${this._escapeHtml(title)}">${renderedEmoji}</span>
                            `;
                        }).join('')}
                    `}
                </div>
            </div>
        </div>
    `;
    }
};
