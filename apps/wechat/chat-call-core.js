/* ================================================================
 * [v4.157.0 · R22-O2] 微信通话界面内核（从 chat-view.js 原段抽出：只搬不改）
 *
 * 抽的就是这两个方法（源 L15851–L16412 / L17246–L17790，逐字节未改）：
 *   showVideoCallInterface（561 行） / showVoiceCallInterface（544 行）
 *
 * 为什么能裸搬（实测，不是感觉）：
 *   对 chat-view.js 全部 363 个类方法逐个算自由标识符（剥注释/字符串/正则后），
 *   这两个方法的「指向模块作用域的依赖」是**空集** —— 只用 this.*（= ChatView 实例）、
 *   全局（window.VirtualPhone / window.SillyTavern，属内建）与本地变量。
 *   故以原型混入形态回归：this 仍绑定 ChatView 实例，调用点一行未改。
 *   ★ 这正是 R22-O1 台账里 next_batch.blocker 要求的那一步实测（「先做自由标识符实测
 *     再定，不许先假定能裸搬」）——实测支持裸搬，本批才动手。
 *
 * 唯一一处非逐字节改动：方法结束行 `    }` 后面加了一个逗号（`    },`）。
 *   原因是对象字面量的属性之间必须有逗号，而 class 里不需要 —— 这是语法形态差异，
 *   不是改代码。闸的提取口径是「从 `    NAME(` 到配对的 `}` 为止」，不含这个逗号，
 *   所以 body_sha256 仍与源文件逐字节相等。
 *
 * 依赖面：**零 import**。这不是省略，是实测结论。
 * 若哪天闸 R5 报「多了 import」，说明有人把判定搬进了这个只摆界面的模块。
 *
 * 不许做的事：
 *   ★ 搬的时候顺手改逻辑（闸 R1 逐字节 sha256 会红）。
 *   ★ 两边各留一份实现（闸 R3 会红）。
 * ================================================================ */
export const chatCallCore = {
    // 🔥 显示视频通话界面（接通后）- 白色玻璃风格
    showVideoCallInterface(contact, aiFirstMessage) {
        // 🔥 记录通话开始的剧情时间
        const timeManager = window.VirtualPhone?.timeManager;
        const callStartTime = this._shouldUseRealTimeForOnlineChat()
            ? this._buildWechatRealTimeFields()
            : (timeManager
            ? timeManager.getCurrentStoryTime()
            : { time: '21:30', date: '2044年10月28日' });
        const callStartEpoch = Date.now();
        const isGroupCall = contact?.type === 'group';
        const groupParticipants = this._getGroupChatParticipants(contact);
        const groupParticipantsStrip = isGroupCall ? this._renderGroupCallParticipantsStrip(contact) : '';
        const callBgStyle = this._getWechatCallBackgroundStyle(contact, 'linear-gradient(135deg, #667eea 0%, #764ba2 50%, #f093fb 100%)');

        const html = `
        <div class="call-fullscreen">
        <div class="wechat-app" style="${callBgStyle} height: 100%; display: flex; flex-direction: column; overflow: hidden;">
            <div class="wechat-header" style="background: rgba(255,255,255,0.25); backdrop-filter: blur(20px); border-bottom: 1px solid rgba(255,255,255,0.2);">
                <div class="wechat-header-left">
                    <!-- 隐藏的返回按钮，用于接管并拦截右滑手势，防止路由迷失直接退回桌面 -->
                    <button aria-label="返回" class="wechat-back-btn" id="overlay-hidden-back" style="display:none;"></button>
                </div>
                <div class="wechat-header-title" style="color: #fff; text-shadow: 0 1px 2px rgba(0,0,0,0.2);">
                    <span class="wechat-header-title-text">${contact.name}${isGroupCall ? '<span style="font-size:11px; margin-left:4px; opacity:0.88;">(群视频)</span>' : ''}<span class="status-dot dot-green" id="video-call-status-dot"></span></span>
                </div>
                <div class="wechat-header-right">
                    <span id="video-timer" style="font-size: 13px; color: rgba(255,255,255,0.9);">00:00</span>
                </div>
            </div>

            <div class="wechat-content" style="background: transparent; display: flex; flex-direction: column; overflow: hidden; padding: 0;">

                <!-- 顶部：视频画面区域 -->
                <div style="height: 140px; background: rgba(255,255,255,0.15); backdrop-filter: blur(10px); display: flex; align-items: center; justify-content: center; position: relative; flex-shrink: 0; margin: 10px; border-radius: 16px;">
                    <div style="text-align: center;">
                        <div class="call-avatar-fix" style="
                            width: 70px;
                            height: 70px;
                            border-radius: 50%;
                            background: linear-gradient(135deg, #fff 0%, #f0f0f0 100%);
                            display: flex;
                            align-items: center;
                            justify-content: center;
                            font-size: 35px;
                            margin: 0 auto 8px;
                            box-shadow: 0 4px 15px rgba(0,0,0,0.15);
                            overflow: hidden;
                        ">
                            ${this.app.renderAvatar(contact.avatar, '👤', contact.name)}
                        </div>
                        <div style="font-size: 14px; font-weight: 500; color: #fff; text-shadow: 0 1px 2px rgba(0,0,0,0.2);">${contact.name}</div>
                        ${groupParticipantsStrip}
                    </div>

                    <!-- 小窗口（自己） -->
                    <div class="call-avatar-fix" style="
                        position: absolute;
                        top: 8px;
                        right: 8px;
                        width: 56px;
                        height: 56px;
                        background: rgba(255,255,255,0.9);
                        border-radius: 50%;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        font-size: 24px;
                        box-shadow: 0 2px 10px rgba(0,0,0,0.15);
                        overflow: hidden;
                    ">
                        ${this.app.renderAvatar(this.app.wechatData.getUserInfo().avatar, '😊', this.app.wechatData.getUserInfo().name)}
                    </div>
                </div>

                <!-- 中间：聊天消息区域 -->
                <div id="video-chat-messages" style="
                    flex: 1;
                    overflow-y: auto;
                    padding: 10px 12px;
                    background: rgba(255,255,255,0.22);
                    margin: 0 10px;
                    border-radius: 12px;
                    border: 1px solid rgba(255,255,255,0.14);
                    display: flex;
                    flex-direction: column;
                    gap: 8px;
                    min-height: 0;
                    contain: paint;
                    transform: translateZ(0);
                ">
                    <div style="text-align: center; color: rgba(255,255,255,0.6); font-size: 11px; padding: 5px 0;">
                        视频通话中可发送文字
                    </div>
                </div>

                <!-- 底部：输入框和控制按钮 -->
                <div style="background: rgba(255,255,255,0.24); padding: 10px; flex-shrink: 0; margin-top: 8px; border-top: 1px solid rgba(255,255,255,0.16);">
                    <div style="display: flex; gap: 8px; align-items: center;">
                        <button aria-label="挂断" id="video-hangup-btn" style="
                            width: 30px;
                            height: 30px;
                            border-radius: 50%;
                            background: rgba(255,59,48,0.14);
                            border: 1px solid rgba(255,59,48,0.35);
                            color: #ff3b30;
                            cursor: pointer;
                            flex-shrink: 0;
                            display: flex;
                            align-items: center;
                            justify-content: center;
                        ">
                            <i class="fa-solid fa-phone-slash" style="font-size: 13px;"></i>
                        </button>
                        <input type="text" id="video-chat-input" placeholder="发送消息..." style="
                            flex: 1;
                            min-width: 0;
                            padding: 8px 18px 8px 12px;
                            border: 1px solid rgba(255,255,255,0.22);
                            border-radius: 18px;
                            background: rgba(255,255,255,0.12);
                            color: var(--phone-global-text, #000000);
                            font-size: 13px;
                            outline: none;
                            -webkit-user-select: text;
                            user-select: text;
                            -webkit-touch-callout: default;
                            touch-action: auto;
                        ">
                        <button id="video-send-btn" style="
                            width: 30px;
                            height: 30px;
                            background: rgba(7,193,96,0.14);
                            color: #07c160;
                            border: 1px solid rgba(7,193,96,0.35);
                            border-radius: 50%;
                            cursor: pointer;
                            flex-shrink: 0;
                            display: flex;
                            align-items: center;
                            justify-content: center;
                        "><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg></button>
                    </div>
                </div>
            </div>
        </div>
        </div>

        <style>
            .call-avatar-fix img {
                width: 100% !important;
                height: 100% !important;
                margin: 0 !important;
                border-radius: 50% !important;
            }
            .call-avatar-fix div {
                border-radius: 50% !important;
            }
            #video-chat-input {
                background: rgba(255,255,255,0.12) !important;
                color: var(--phone-global-text, #000000) !important;
                -webkit-text-fill-color: var(--phone-global-text, #000000) !important;
                caret-color: var(--phone-global-text, #000000) !important;
                border: 1px solid rgba(255,255,255,0.22) !important;
                box-shadow: inset 0 0 0 1000px rgba(255,255,255,0.12) !important;
                filter: none !important;
                opacity: 1 !important;
            }
            #video-chat-input::placeholder {
                color: var(--phone-global-text, #000000) !important;
                -webkit-text-fill-color: var(--phone-global-text, #000000) !important;
                opacity: 0.5 !important;
            }
        </style>
    `;

        this.app.phoneShell.setContent(html, 'wechat-call-overlay');
        // 拦截右滑返回手势，将其等同于点击挂断/取消/拒绝按钮
        document.getElementById('overlay-hidden-back')?.addEventListener('click', () => {
            const cancelBtn = document.getElementById('cancel-call-btn') || 
                              document.getElementById('video-hangup-btn') || 
                              document.getElementById('voice-hangup-btn') || 
                              document.getElementById('incoming-call-reject-btn');
            if (cancelBtn) cancelBtn.click();
            else this.app.render();
        });

        const setVideoCallStatus = (color = 'green') => {
            const dot = document.getElementById('video-call-status-dot');
            if (!dot) return;
            dot.classList.remove('dot-green', 'dot-yellow', 'dot-red');
            if (color === 'red') {
                dot.classList.add('dot-red');
                return;
            }
            if (color === 'yellow') {
                dot.classList.add('dot-yellow');
                return;
            }
            dot.classList.add('dot-green');
        };

        const getVideoInput = () => document.getElementById('video-chat-input');
        const hardenVideoInputStyle = () => {
            const input = getVideoInput();
            if (!input?.style?.setProperty) return;
            input.style.setProperty('background', 'rgba(255,255,255,0.12)', 'important');
            input.style.setProperty('color', 'var(--phone-global-text, #000000)', 'important');
            input.style.setProperty('-webkit-text-fill-color', 'var(--phone-global-text, #000000)', 'important');
            input.style.setProperty('caret-color', 'var(--phone-global-text, #000000)', 'important');
            input.style.setProperty('border', '1px solid rgba(255,255,255,0.22)', 'important');
            input.style.setProperty('box-shadow', 'inset 0 0 0 1000px rgba(255,255,255,0.12)', 'important');
            input.style.setProperty('filter', 'none', 'important');
            input.style.setProperty('opacity', '1', 'important');
        };
        hardenVideoInputStyle();
        const getVideoMessages = () => document.getElementById('video-chat-messages');

        let videoBatchTimer = null;
        let videoPendingUserLines = [];
        let isVideoSending = false;

        const clearVideoBatchTimer = () => {
            clearTimeout(videoBatchTimer);
            videoBatchTimer = null;
        };

        const restartVideoPendingTimerIfNeeded = () => {
            const input = getVideoInput();
            const text = String(input?.value || '').trim();
            const isEditing = !!input && document.activeElement === input;
            const canRestart = !isEditing && text === '' && videoPendingUserLines.length > 0 && !isVideoSending;
            if (!canRestart) {
                if (isEditing && !isVideoSending) {
                    setVideoCallStatus('green');
                }
                return;
            }
            clearVideoBatchTimer();
            videoBatchTimer = setTimeout(() => {
                triggerVideoAI();
            }, 6000);
            setVideoCallStatus('yellow');
        };

        const getVideoCallTypingDelay = (line) => {
            const length = String(line || '').trim().length;
            return Math.min(2200, 420 + length * 45);
        };

        const renderVideoAiLinesSequentially = async (lines, roundId) => {
            const bubbleMetas = [];
            const renderLines = Array.isArray(lines) ? lines : [];

            for (let i = 0; i < renderLines.length; i++) {
                const messagesDiv = getVideoMessages();
                if (!messagesDiv) break;

                const entry = typeof renderLines[i] === 'string'
                    ? { sender: contact.name, text: String(renderLines[i] || '').trim() }
                    : {
                        sender: String(renderLines[i]?.sender || contact.name).trim() || contact.name,
                        text: String(renderLines[i]?.text || '').trim()
                    };
                if (!entry.text) continue;

                document.getElementById('video-typing-indicator')?.remove();
                const typingHtml = `
                    <div id="video-typing-indicator" style="display: flex; justify-content: flex-start;">
                        <div style="padding: 8px 12px; background: rgba(255,255,255,0.5); color: rgba(0,0,0,0.5); border-radius: 12px; font-size: 12px;">正在输入...</div>
                    </div>
                `;
                messagesDiv.insertAdjacentHTML('beforeend', typingHtml);
                messagesDiv.scrollTop = messagesDiv.scrollHeight;

                await new Promise(resolve => setTimeout(resolve, getVideoCallTypingDelay(entry.text)));
                document.getElementById('video-typing-indicator')?.remove();

                const bubbleId = 'wechat-call-ai-msg-' + Math.random().toString(36).slice(2, 8);
                const senderLabelHtml = isGroupCall
                    ? `<div class="call-msg-sender-label" style="font-size:10px; color:rgba(255,255,255,0.86); margin:0 0 4px 2px;">${this._escapeHtml(entry.sender)}</div>`
                    : '';
                const safeEntryText = this._escapeHtml(entry.text);
                const aiMsgHtml = `
                    <div class="call-msg-row" style="display: flex; justify-content: flex-start;">
                        <div style="max-width: 75%; display:flex; flex-direction:column; align-items:flex-start;">
                            ${senderLabelHtml}
                            <div class="wechat-call-ai-bubble call-msg-bubble" id="${bubbleId}" data-msg-idx="${chatMessages.length}" data-call-type="video" data-round-id="${roundId}" data-sender="${this._escapeHtml(entry.sender)}" data-text="${safeEntryText}" style="max-width: 100%; padding: 8px 12px; background: rgba(255,255,255,0.85); color: #333; border-radius: 12px; font-size: 13px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); cursor: pointer; transition: all 0.3s; position: relative;">${safeEntryText}</div>
                        </div>
                    </div>
                `;
                messagesDiv.insertAdjacentHTML('beforeend', aiMsgHtml);
                chatMessages.push({ from: entry.sender, text: entry.text });
                bubbleMetas.push({ id: bubbleId, sender: entry.sender, text: entry.text });
                messagesDiv.scrollTop = messagesDiv.scrollHeight;
            }

            document.getElementById('video-typing-indicator')?.remove();
            return bubbleMetas;
        };

        // 聊天消息记录
        const chatMessages = [];
        // 🔥 激活视频通话的长按菜单
        this.bindCallMessageLongPressEvents(document.getElementById('video-chat-messages'), chatMessages);

        // 🔥 AI主动发第一句话（支持多条消息）
        if (aiFirstMessage && aiFirstMessage.trim()) {
            const messagesDiv = getVideoMessages();
            if (messagesDiv) {
                // 清理格式
                let cleanedGreeting = aiFirstMessage.trim();
                cleanedGreeting = cleanedGreeting.replace(/\[微信\][^:：]*[：:]\s*/g, ''); // 移除 [微信] xxx: 格式
                cleanedGreeting = cleanedGreeting.replace(/^from\s+\S+[：:]\s*/gmi, ''); // 移除 from xxx: 格式

                const msgLines = this._parseCallReplyEntries(cleanedGreeting, {
                    contactName: contact.name,
                    participants: isGroupCall ? groupParticipants : [],
                    groupName: contact.name,
                    isGroupCall
                });
                const roundId = 'round_greeting_' + Date.now();
                (async () => {
                    const bubbleMetas = await renderVideoAiLinesSequentially(msgLines, roundId);
                    this.bindCallBubbleClickEvents(messagesDiv);
                    const autoTTS = !!window.VirtualPhone?.storage?.get('wechat-call-auto-tts');
                    this.currentTtsRound = roundId;
                    if (autoTTS) {
                        for (let i = 0; i < bubbleMetas.length; i++) {
                            if (this.currentTtsRound !== roundId) break;
                            const bubble = document.getElementById(bubbleMetas[i].id);
                            const ttsText = this._resolveCallTTSContent(bubbleMetas[i].text, 'video');
                            if (!ttsText) continue;
                            await this.playWechatCallTTS(ttsText, bubble);
                        }
                    }
                })();
            }
        }

        // 计时器
        // [v3.14.0 · 计划 #65] 入实例域：此前句柄存本方法局部作用域、唯一清点是挂断按钮，
        //   而「通话界面在场时微信实例被丢弃」（换会话 / 清数据 / 离开微信闲置回收）走不到那个按钮
        //   —— 计时器在无 DOM 可更新的情形下以 1Hz 永久重发。同型形态见 v2.27/v2.28 收敛的
        //   「轮询句柄存局部变量 + 手写清理清单」。先收同 tag 再登记 ⇒ 重复进入不叠加。
        let videoDuration = 0;
        this._rt.cancelByTag('call:video');
        this._rt.addInterval(() => {
            videoDuration++;
            const minutes = Math.floor(videoDuration / 60).toString().padStart(2, '0');
            const seconds = (videoDuration % 60).toString().padStart(2, '0');
            const timerDiv = document.getElementById('video-timer');
            if (timerDiv) {
                timerDiv.textContent = `${minutes}:${seconds}`;
            }
        }, 1000, 'call:video');

        const triggerVideoAI = async () => {
            if (isVideoSending || videoPendingUserLines.length === 0) return;

            if (!this.isOnlineMode()) {
                this.app.phoneShell.showNotification('离线模式', '请在设置中开启在线模式', '⚠️');
                clearVideoBatchTimer();
                setVideoCallStatus('green');
                return;
            }

            const messagesDiv = getVideoMessages();
            if (!messagesDiv) return;

            isVideoSending = true;
            clearVideoBatchTimer();
            setVideoCallStatus('red');

            const messageToSend = videoPendingUserLines.join('\n');
            videoPendingUserLines = [];

            try {
                document.getElementById('video-typing-indicator')?.remove();
                const typingHtml = `
                    <div id="video-typing-indicator" style="display: flex; justify-content: flex-start;">
                        <div style="padding: 8px 12px; background: rgba(255,255,255,0.5); color: rgba(0,0,0,0.5); border-radius: 12px; font-size: 12px;">正在输入...</div>
                    </div>
                `;
                messagesDiv.insertAdjacentHTML('beforeend', typingHtml);
                messagesDiv.scrollTop = messagesDiv.scrollHeight;

                const aiReply = await this.sendCallMessageToAI(messageToSend, contact.name, chatMessages, 'video');
                document.getElementById('video-typing-indicator')?.remove();

                const roundId = 'round_' + Date.now();
                const aiEntries = this._parseCallReplyEntries(aiReply, {
                    contactName: contact.name,
                    participants: isGroupCall ? groupParticipants : [],
                    groupName: contact.name,
                    isGroupCall
                });
                const renderLines = aiEntries.length > 0 ? aiEntries : [{ sender: contact.name, text: '...' }];
                const bubbleMetas = await renderVideoAiLinesSequentially(renderLines, roundId);

                this.bindCallBubbleClickEvents(messagesDiv);
                const autoTTS = !!window.VirtualPhone?.storage?.get('wechat-call-auto-tts');
                this.currentTtsRound = roundId;
                if (autoTTS) {
                    for (let i = 0; i < bubbleMetas.length; i++) {
                        if (this.currentTtsRound !== roundId) break;
                        const bubble = document.getElementById(bubbleMetas[i].id);
                        const ttsText = this._resolveCallTTSContent(bubbleMetas[i].text, 'video');
                        if (!ttsText) continue;
                        await this.playWechatCallTTS(ttsText, bubble);
                    }
                }
            } catch (error) {
                console.error('❌ 视频通话消息发送失败:', error);
                document.getElementById('video-typing-indicator')?.remove();
            } finally {
                isVideoSending = false;
                if (videoPendingUserLines.length > 0) {
                    restartVideoPendingTimerIfNeeded();
                } else {
                    setVideoCallStatus('green');
                }
            }
        };

        // 发送消息（复刻微信聊天的“连发等待”逻辑）
        const sendMessage = async () => {
            this.stopWechatCallTTS(); // 发新消息时打断旧语音
            const input = getVideoInput();
            const messagesDiv = getVideoMessages();
            if (!input || !messagesDiv) return;

            const text = input.value.trim();
            if (text) {
                const myMsgHtml = `
                    <div class="call-msg-row" style="display: flex; justify-content: flex-end;">
                        <div class="call-msg-bubble" data-msg-idx="${chatMessages.length}" style="max-width: 75%; padding: 8px 12px; background: #95ec69; color: #000; border-radius: 12px; font-size: 13px; position: relative;">${text}</div>
                    </div>
                `;
                messagesDiv.insertAdjacentHTML('beforeend', myMsgHtml);
                messagesDiv.scrollTop = messagesDiv.scrollHeight;

                chatMessages.push({ from: 'me', text: text });
                videoPendingUserLines.push(text);
                input.value = '';

                if (document.activeElement === input) {
                    // 输入框有竖线（仍在编辑）时，只等待，不立刻触发AI
                    clearVideoBatchTimer();
                    setVideoCallStatus('green');
                } else {
                    restartVideoPendingTimerIfNeeded();
                }
                return;
            }

            if (videoPendingUserLines.length > 0) {
                await triggerVideoAI();
                return;
            }

            const recentUserLines = chatMessages
                .filter(m => m.from === 'me')
                .slice(-5)
                .map(m => m.text)
                .filter(Boolean);
            if (recentUserLines.length > 0) {
                videoPendingUserLines = recentUserLines;
                await triggerVideoAI();
                return;
            }

            this.app.phoneShell.showNotification('提示', '请先输入内容', '⚠️');
        };

        const videoInput = getVideoInput();
        const videoSendBtn = document.getElementById('video-send-btn');

        videoInput?.addEventListener('focus', () => {
            clearVideoBatchTimer();
            setVideoCallStatus('green');
        });

        videoInput?.addEventListener('blur', () => {
            restartVideoPendingTimerIfNeeded();
        });

        videoInput?.addEventListener('input', (e) => {
            const text = String(e.target.value || '').trim();
            if (text !== '') {
                clearVideoBatchTimer();
                setVideoCallStatus('green');
                return;
            }
            if (document.activeElement === e.target) {
                return;
            }
            restartVideoPendingTimerIfNeeded();
        });

        let isHandlingVideoSend = false;
        const executeVideoSend = (e) => {
            if (e) e.preventDefault();
            if (isHandlingVideoSend) return;
            isHandlingVideoSend = true;
            sendMessage();
            setTimeout(() => {
                isHandlingVideoSend = false;
            }, 300);
        };

        videoSendBtn?.addEventListener('touchstart', (e) => {
            e.preventDefault();
        }, { passive: false });
        videoSendBtn?.addEventListener('touchend', executeVideoSend);
        videoSendBtn?.addEventListener('mousedown', (e) => {
            e.preventDefault();
        });
        videoSendBtn?.addEventListener('click', executeVideoSend);
        videoInput?.addEventListener('keypress', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendMessage();
            }
        });

        // 挂断
        document.getElementById('video-hangup-btn')?.addEventListener('click', () => {
            this.stopWechatCallTTS();
            this._rt.cancelByTag('call:video');   // [v3.14.0] 回收口径与其它出口统一
            clearVideoBatchTimer();
            videoPendingUserLines = [];
            isVideoSending = false;

            // 🔥 终极防报错保护。如果退出了当前聊天界面，直接返回即可，不再去读 id
            if (!this.app.currentChat) {
                this.app.render();
                return;
            }

            const wallElapsedSeconds = Math.max(0, Math.floor((Date.now() - callStartEpoch) / 1000));
            const effectiveDurationSec = Math.max(videoDuration, wallElapsedSeconds);
            const durationText = `${Math.floor(effectiveDurationSec / 60)}分${effectiveDurationSec % 60}秒`;

            // 🔥 过滤掉被删除的废弃消息
            const validChatMessages = chatMessages.filter(m => !m.isDeleted);

            this.addCallRecord('video', 'answered', durationText, {
                callStartTime,
                elapsedSeconds: effectiveDurationSec,
                transcript: validChatMessages.length > 0 ? [...validChatMessages] : undefined
            });

            // 🔥 如果开启在线模式，通知AI
            if (this.isOnlineMode() && effectiveDurationSec > 0) {
                this.notifyAI(`刚才和你视频通话了${durationText}`);
            }

            this.app.phoneShell.showNotification('通话结束', `${isGroupCall ? '群视频通话' : '视频通话'} ${durationText}`, '📹');
            setTimeout(() => this.app.render(), 1000);
        });
    },

    // 🔥 显示语音通话界面（接通后）- 简洁版
    showVoiceCallInterface(contact, aiGreeting = '') {
        // 🔥 记录通话开始的剧情时间
        const timeManager = window.VirtualPhone?.timeManager;
        const callStartTime = this._shouldUseRealTimeForOnlineChat()
            ? this._buildWechatRealTimeFields()
            : (timeManager
            ? timeManager.getCurrentStoryTime()
            : { time: '21:30', date: '2044年10月28日' });
        const callStartEpoch = Date.now();
        const isGroupCall = contact?.type === 'group';
        const groupParticipants = this._getGroupChatParticipants(contact);
        const groupParticipantsStrip = isGroupCall ? this._renderGroupCallParticipantsStrip(contact) : '';
        const callBgStyle = this._getWechatCallBackgroundStyle(contact);

        const html = `
        <div class="call-fullscreen">
        <div class="wechat-app" style="${callBgStyle} height: 100%; display: flex; flex-direction: column; overflow: hidden;">
            <div class="wechat-header" style="background: rgba(255,255,255,0.4); backdrop-filter: blur(20px); border-bottom: 1px solid rgba(255,255,255,0.3); flex-shrink: 0;">
                <div class="wechat-header-left">
                    <!-- 隐藏的返回按钮，用于接管并拦截右滑手势，防止路由迷失直接退回桌面 -->
                    <button aria-label="返回" class="wechat-back-btn" id="overlay-hidden-back" style="display:none;"></button>
                </div>
                <div class="wechat-header-title" style="color: #333;">
                    <span class="wechat-header-title-text">${contact.name}${isGroupCall ? '<span style="font-size:11px; margin-left:4px; opacity:0.78;">(群语音)</span>' : ''}<span class="status-dot dot-green" id="voice-call-status-dot"></span></span>
                </div>
                <div class="wechat-header-right">
                    <span id="call-timer" style="font-size: 13px; color: #666;">00:00</span>
                </div>
            </div>

            <div class="wechat-content" style="background: transparent; display: flex; flex-direction: column; flex: 1; overflow: hidden; padding: 0; min-height: 0;">

                <!-- 顶部：头像区域 -->
                <div style="padding: 8px; text-align: center; flex-shrink: 0;">
                    <div class="call-avatar-fix" style="
                        width: 40px;
                        height: 40px;
                        border-radius: 50%;
                        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                        margin: 0 auto;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        font-size: 20px;
                        box-shadow: 0 0 0 0 rgba(102, 126, 234, 0.5);
                        animation: voice-glow 2s infinite;
                        overflow: hidden;
                    ">
                        ${this.app.renderAvatar(contact.avatar, '👤', contact.name)}
                    </div>
                    <div style="font-size: 9px; color: rgba(0,0,0,0.5); margin-top: 3px;">${isGroupCall ? '群语音通话中' : '语音通话中'}</div>
                    ${groupParticipantsStrip}
                </div>

                <!-- 中间：聊天消息区域 -->
                <div id="voice-chat-messages" style="
                    flex: 1;
                    overflow-y: auto;
                    padding: 8px;
                    background: rgba(255,255,255,0.3);
                    backdrop-filter: blur(10px);
                    margin: 0 8px;
                    border-radius: 10px;
                    display: flex;
                    flex-direction: column;
                    gap: 6px;
                    min-height: 0;
                ">
                    <div style="text-align: center; color: rgba(0,0,0,0.4); font-size: 10px; padding: 3px 0;">
                        通话中可发送文字
                    </div>
                </div>

                <!-- 底部：输入框和挂断按钮 -->
                <div style="background: rgba(255,255,255,0.5); backdrop-filter: blur(20px); padding: 8px; flex-shrink: 0;">
                    <!-- 文字输入行 -->
                    <div style="display: flex; align-items: center; gap: 8px;">
                        <input type="text" id="voice-chat-input" placeholder="发送消息..." style="
                            flex: 1;
                            min-width: 0;
                            padding: 8px 18px 8px 12px;
                            border: 1px solid rgba(255,255,255,0.22);
                            border-radius: 18px;
                            background: rgba(255,255,255,0.12);
                            color: var(--phone-global-text, #000000);
                            font-size: 13px;
                            outline: none;
                            -webkit-user-select: text;
                            user-select: text;
                            -webkit-touch-callout: default;
                            touch-action: auto;
                        ">
                        <button aria-label="发送" id="voice-send-btn" style="
                            width: 32px;
                            height: 32px;
                            background: transparent;
                            border: none;
                            color: #07c160;
                            font-size: 18px;
                            cursor: pointer;
                            display: flex;
                            align-items: center;
                            justify-content: center;
                            flex-shrink: 0;
                        ">
                            <i class="fa-solid fa-paper-plane"></i>
                        </button>
                        <button aria-label="挂断" id="voice-hangup-btn" style="
                            width: 32px;
                            height: 32px;
                            background: transparent;
                            border: none;
                            color: #ff3b30;
                            font-size: 18px;
                            cursor: pointer;
                            flex-shrink: 0;
                            display: flex;
                            align-items: center;
                            justify-content: center;
                        ">
                            <i class="fa-solid fa-phone-slash"></i>
                        </button>
                    </div>
                </div>
            </div>
        </div>
        </div>

        <style>
            @keyframes voice-glow {
                0%, 100% { box-shadow: 0 0 0 0 rgba(102, 126, 234, 0.5); }
                50% { box-shadow: 0 0 0 8px rgba(102, 126, 234, 0); }
            }
            .call-avatar-fix img {
                width: 100% !important;
                height: 100% !important;
                margin: 0 !important;
                border-radius: 50% !important;
            }
            .call-avatar-fix div {
                border-radius: 50% !important;
            }
            #voice-chat-input {
                background: rgba(255,255,255,0.12) !important;
                color: var(--phone-global-text, #000000) !important;
                -webkit-text-fill-color: var(--phone-global-text, #000000) !important;
                caret-color: var(--phone-global-text, #000000) !important;
                border: 1px solid rgba(255,255,255,0.22) !important;
                box-shadow: inset 0 0 0 1000px rgba(255,255,255,0.12) !important;
                filter: none !important;
                opacity: 1 !important;
            }
            #voice-chat-input::placeholder {
                color: var(--phone-global-text, #000000) !important;
                -webkit-text-fill-color: var(--phone-global-text, #000000) !important;
                opacity: 0.5 !important;
            }
        </style>
    `;

        this.app.phoneShell.setContent(html, 'wechat-call-overlay');
        // 拦截右滑返回手势，将其等同于点击挂断/取消/拒绝按钮
        document.getElementById('overlay-hidden-back')?.addEventListener('click', () => {
            const cancelBtn = document.getElementById('cancel-call-btn') || 
                              document.getElementById('video-hangup-btn') || 
                              document.getElementById('voice-hangup-btn') || 
                              document.getElementById('incoming-call-reject-btn');
            if (cancelBtn) cancelBtn.click();
            else this.app.render();
        });

        const setVoiceCallStatus = (color = 'green') => {
            const dot = document.getElementById('voice-call-status-dot');
            if (!dot) return;
            dot.classList.remove('dot-green', 'dot-yellow', 'dot-red');
            if (color === 'red') {
                dot.classList.add('dot-red');
                return;
            }
            if (color === 'yellow') {
                dot.classList.add('dot-yellow');
                return;
            }
            dot.classList.add('dot-green');
        };

        const getVoiceInput = () => document.getElementById('voice-chat-input');
        const hardenVoiceInputStyle = () => {
            const input = getVoiceInput();
            if (!input?.style?.setProperty) return;
            input.style.setProperty('background', 'rgba(255,255,255,0.12)', 'important');
            input.style.setProperty('background-color', 'rgba(255,255,255,0.12)', 'important');
            input.style.setProperty('color', 'var(--phone-global-text, #000000)', 'important');
            input.style.setProperty('-webkit-text-fill-color', 'var(--phone-global-text, #000000)', 'important');
            input.style.setProperty('caret-color', 'var(--phone-global-text, #000000)', 'important');
            input.style.setProperty('border', '1px solid rgba(255,255,255,0.22)', 'important');
            input.style.setProperty('box-shadow', 'inset 0 0 0 1000px rgba(255,255,255,0.12)', 'important');
            input.style.setProperty('outline', 'none', 'important');
            input.style.setProperty('appearance', 'none', 'important');
            input.style.setProperty('-webkit-appearance', 'none', 'important');
            input.style.setProperty('filter', 'none', 'important');
            input.style.setProperty('opacity', '1', 'important');
        };
        hardenVoiceInputStyle();
        // 某些主题会在下一个渲染帧二次覆盖 input 样式，这里再补一帧和延时兜底
        requestAnimationFrame(() => hardenVoiceInputStyle());
        setTimeout(() => hardenVoiceInputStyle(), 80);
        const getVoiceMessages = () => document.getElementById('voice-chat-messages');

        let voiceBatchTimer = null;
        let voicePendingUserLines = [];
        let isVoiceSending = false;

        const clearVoiceBatchTimer = () => {
            clearTimeout(voiceBatchTimer);
            voiceBatchTimer = null;
        };

        const restartVoicePendingTimerIfNeeded = () => {
            const input = getVoiceInput();
            const text = String(input?.value || '').trim();
            const isEditing = !!input && document.activeElement === input;
            const canRestart = !isEditing && text === '' && voicePendingUserLines.length > 0 && !isVoiceSending;
            if (!canRestart) {
                if (isEditing && !isVoiceSending) {
                    setVoiceCallStatus('green');
                }
                return;
            }
            clearVoiceBatchTimer();
            voiceBatchTimer = setTimeout(() => {
                triggerVoiceAI();
            }, 6000);
            setVoiceCallStatus('yellow');
        };

        const getVoiceCallTypingDelay = (line) => {
            const length = String(line || '').trim().length;
            return Math.min(2000, 360 + length * 40);
        };

        const renderVoiceAiLinesSequentially = async (lines, roundId) => {
            const bubbleMetas = [];
            const renderLines = Array.isArray(lines) ? lines : [];

            for (let i = 0; i < renderLines.length; i++) {
                const messagesDiv = getVoiceMessages();
                if (!messagesDiv) break;

                const entry = typeof renderLines[i] === 'string'
                    ? { sender: contact.name, text: String(renderLines[i] || '').trim() }
                    : {
                        sender: String(renderLines[i]?.sender || contact.name).trim() || contact.name,
                        text: String(renderLines[i]?.text || '').trim()
                    };
                if (!entry.text) continue;

                document.getElementById('voice-typing-indicator')?.remove();
                const typingHtml = `
                    <div id="voice-typing-indicator" style="display: flex; justify-content: flex-start;">
                        <div style="padding: 6px 10px; background: rgba(255,255,255,0.6); color: rgba(0,0,0,0.5); border-radius: 10px; font-size: 11px;">正在输入...</div>
                    </div>
                `;
                messagesDiv.insertAdjacentHTML('beforeend', typingHtml);
                messagesDiv.scrollTop = messagesDiv.scrollHeight;

                await new Promise(resolve => setTimeout(resolve, getVoiceCallTypingDelay(entry.text)));
                document.getElementById('voice-typing-indicator')?.remove();

                const bubbleId = 'wechat-call-ai-msg-' + Math.random().toString(36).slice(2, 8);
                const senderLabelHtml = isGroupCall
                    ? `<div class="call-msg-sender-label" style="font-size:10px; color:rgba(0,0,0,0.48); margin:0 0 4px 2px;">${this._escapeHtml(entry.sender)}</div>`
                    : '';
                const safeEntryText = this._escapeHtml(entry.text);
                const aiMsgHtml = `
                    <div class="call-msg-row" style="display: flex; justify-content: flex-start;">
                        <div style="max-width: 80%; display:flex; flex-direction:column; align-items:flex-start;">
                            ${senderLabelHtml}
                            <div class="wechat-call-ai-bubble call-msg-bubble" id="${bubbleId}" data-msg-idx="${chatMessages.length}" data-call-type="voice" data-round-id="${roundId}" data-sender="${this._escapeHtml(entry.sender)}" data-text="${safeEntryText}" style="max-width: 100%; padding: 6px 10px; background: rgba(255,255,255,0.85); color: #333; border-radius: 10px; font-size: 12px; box-shadow: 0 1px 2px rgba(0,0,0,0.1); cursor: pointer; transition: all 0.3s; position: relative;">${safeEntryText}</div>
                        </div>
                    </div>
                `;
                messagesDiv.insertAdjacentHTML('beforeend', aiMsgHtml);
                chatMessages.push({ from: entry.sender, text: entry.text });
                bubbleMetas.push({ id: bubbleId, sender: entry.sender, text: entry.text });
                messagesDiv.scrollTop = messagesDiv.scrollHeight;
            }

            document.getElementById('voice-typing-indicator')?.remove();
            return bubbleMetas;
        };

        // 计时器
        // [v3.14.0 · 计划 #65] 与视频计时器同构：入实例域，四类出口（挂断 / 闲置 / 清数据 / 换会话）统一回收。
        let callDuration = 0;
        this._rt.cancelByTag('call:voice');
        this._rt.addInterval(() => {
            callDuration++;
            const minutes = Math.floor(callDuration / 60).toString().padStart(2, '0');
            const seconds = (callDuration % 60).toString().padStart(2, '0');
            const timerDiv = document.getElementById('call-timer');
            if (timerDiv) {
                timerDiv.textContent = `${minutes}:${seconds}`;
            }
        }, 1000, 'call:voice');

        // 聊天消息记录
        const chatMessages = [];
        // 🔥 激活语音通话的长按菜单
        this.bindCallMessageLongPressEvents(document.getElementById('voice-chat-messages'), chatMessages);

        // 🔥 如果有AI开场白，显示（支持多条消息）
        if (aiGreeting && aiGreeting.trim()) {
            const messagesDiv = getVoiceMessages();
            if (messagesDiv) {
                let cleanedGreeting = aiGreeting.trim();
                cleanedGreeting = cleanedGreeting.replace(/\[微信\][^:：]*[：:]\s*/g, '');
                cleanedGreeting = cleanedGreeting.replace(/^from\s+\S+[：:]\s*/gmi, '');

                const msgLines = this._parseCallReplyEntries(cleanedGreeting, {
                    contactName: contact.name,
                    participants: isGroupCall ? groupParticipants : [],
                    groupName: contact.name,
                    isGroupCall
                });
                const roundId = 'round_greeting_' + Date.now();
                (async () => {
                    const bubbleMetas = await renderVoiceAiLinesSequentially(msgLines, roundId);
                    this.bindCallBubbleClickEvents(messagesDiv);
                    const autoTTS = !!window.VirtualPhone?.storage?.get('wechat-call-auto-tts');
                    this.currentTtsRound = roundId;
                    if (autoTTS) {
                        for (let i = 0; i < bubbleMetas.length; i++) {
                            if (this.currentTtsRound !== roundId) break;
                            const bubble = document.getElementById(bubbleMetas[i].id);
                            await this.playWechatCallTTS(bubbleMetas[i].text, bubble);
                        }
                    }
                })();
            }
        }

        const triggerVoiceAI = async () => {
            if (isVoiceSending || voicePendingUserLines.length === 0) return;

            if (!this.isOnlineMode()) {
                this.app.phoneShell.showNotification('离线模式', '请在设置中开启在线模式', '⚠️');
                clearVoiceBatchTimer();
                setVoiceCallStatus('green');
                return;
            }

            const messagesDiv = getVoiceMessages();
            if (!messagesDiv) return;

            isVoiceSending = true;
            clearVoiceBatchTimer();
            setVoiceCallStatus('red');

            const messageToSend = voicePendingUserLines.join('\n');
            voicePendingUserLines = [];

            try {
                document.getElementById('voice-typing-indicator')?.remove();
                const typingHtml = `
                    <div id="voice-typing-indicator" style="display: flex; justify-content: flex-start;">
                        <div style="padding: 6px 10px; background: rgba(255,255,255,0.6); color: rgba(0,0,0,0.5); border-radius: 10px; font-size: 11px;">正在输入...</div>
                    </div>
                `;
                messagesDiv.insertAdjacentHTML('beforeend', typingHtml);
                messagesDiv.scrollTop = messagesDiv.scrollHeight;

                const aiReply = await this.sendCallMessageToAI(messageToSend, contact.name, chatMessages, 'voice');
                document.getElementById('voice-typing-indicator')?.remove();

                const roundId = 'round_' + Date.now();
                const aiEntries = this._parseCallReplyEntries(aiReply, {
                    contactName: contact.name,
                    participants: isGroupCall ? groupParticipants : [],
                    groupName: contact.name,
                    isGroupCall
                });
                const renderLines = aiEntries.length > 0 ? aiEntries : [{ sender: contact.name, text: '...' }];
                const bubbleMetas = await renderVoiceAiLinesSequentially(renderLines, roundId);

                this.bindCallBubbleClickEvents(messagesDiv);
                const autoTTS = !!window.VirtualPhone?.storage?.get('wechat-call-auto-tts');
                this.currentTtsRound = roundId;
                if (autoTTS) {
                    for (let i = 0; i < bubbleMetas.length; i++) {
                        if (this.currentTtsRound !== roundId) break;
                        const bubble = document.getElementById(bubbleMetas[i].id);
                        await this.playWechatCallTTS(bubbleMetas[i].text, bubble);
                    }
                }
            } catch (error) {
                console.error('❌ 语音通话消息发送失败:', error);
                document.getElementById('voice-typing-indicator')?.remove();
            } finally {
                isVoiceSending = false;
                if (voicePendingUserLines.length > 0) {
                    restartVoicePendingTimerIfNeeded();
                } else {
                    setVoiceCallStatus('green');
                }
            }
        };

        // 发送消息（复刻微信聊天的“连发等待”逻辑）
        const sendMessage = async () => {
            this.stopWechatCallTTS();
            const input = getVoiceInput();
            const messagesDiv = getVoiceMessages();
            if (!input || !messagesDiv) return;

            const text = input.value.trim();
            if (text) {
                const myMsgHtml = `
                    <div class="call-msg-row" style="display: flex; justify-content: flex-end;">
                        <div class="call-msg-bubble" data-msg-idx="${chatMessages.length}" style="max-width: 75%; padding: 8px 12px; background: #95ec69; color: #000; border-radius: 12px; font-size: 13px; position: relative;">${text}</div>
                    </div>
                `;
                messagesDiv.insertAdjacentHTML('beforeend', myMsgHtml);
                messagesDiv.scrollTop = messagesDiv.scrollHeight;

                chatMessages.push({ from: 'me', text: text });
                voicePendingUserLines.push(text);
                input.value = '';

                if (document.activeElement === input) {
                    clearVoiceBatchTimer();
                    setVoiceCallStatus('green');
                } else {
                    restartVoicePendingTimerIfNeeded();
                }
                return;
            }

            if (voicePendingUserLines.length > 0) {
                await triggerVoiceAI();
                return;
            }

            const recentUserLines = chatMessages
                .filter(m => m.from === 'me')
                .slice(-5)
                .map(m => m.text)
                .filter(Boolean);
            if (recentUserLines.length > 0) {
                voicePendingUserLines = recentUserLines;
                await triggerVoiceAI();
                return;
            }

            this.app.phoneShell.showNotification('提示', '请先输入内容', '⚠️');
        };

        const voiceInput = getVoiceInput();
        const voiceSendBtn = document.getElementById('voice-send-btn');

        voiceInput?.addEventListener('focus', () => {
            clearVoiceBatchTimer();
            setVoiceCallStatus('green');
        });

        voiceInput?.addEventListener('blur', () => {
            restartVoicePendingTimerIfNeeded();
        });

        voiceInput?.addEventListener('input', (e) => {
            const text = String(e.target.value || '').trim();
            if (text !== '') {
                clearVoiceBatchTimer();
                setVoiceCallStatus('green');
                return;
            }
            if (document.activeElement === e.target) {
                return;
            }
            restartVoicePendingTimerIfNeeded();
        });

        let isHandlingVoiceSend = false;
        const executeVoiceSend = (e) => {
            if (e) e.preventDefault();
            if (isHandlingVoiceSend) return;
            isHandlingVoiceSend = true;
            sendMessage();
            setTimeout(() => {
                isHandlingVoiceSend = false;
            }, 300);
        };

        voiceSendBtn?.addEventListener('touchstart', (e) => {
            e.preventDefault();
        }, { passive: false });
        voiceSendBtn?.addEventListener('touchend', executeVoiceSend);
        voiceSendBtn?.addEventListener('mousedown', (e) => {
            e.preventDefault();
        });
        voiceSendBtn?.addEventListener('click', executeVoiceSend);
        voiceInput?.addEventListener('keypress', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendMessage();
            }
        });

        // 挂断
        // 挂断
        document.getElementById('voice-hangup-btn')?.addEventListener('click', () => {
            this.stopWechatCallTTS();
            this._rt.cancelByTag('call:voice');   // [v3.14.0] 回收口径与其它出口统一
            clearVoiceBatchTimer();
            voicePendingUserLines = [];
            isVoiceSending = false;

            // 🔥 修复：终极防报错保护。如果退出了当前聊天界面，直接返回即可，不再去读 id
            if (!this.app.currentChat) {
                this.app.render();
                return;
            }

            const wallElapsedSeconds = Math.max(0, Math.floor((Date.now() - callStartEpoch) / 1000));
            const effectiveDurationSec = Math.max(callDuration, wallElapsedSeconds);
            const durationText = `${Math.floor(effectiveDurationSec / 60)}分${effectiveDurationSec % 60}秒`;

            // 🔥 过滤掉被删除的废弃消息
            const validChatMessages = chatMessages.filter(m => !m.isDeleted);

            this.addCallRecord('voice', 'answered', durationText, {
                callStartTime,
                elapsedSeconds: effectiveDurationSec,
                transcript: validChatMessages.length > 0 ? [...validChatMessages] : undefined
            });

            if (this.isOnlineMode() && effectiveDurationSec > 0) {
                this.notifyAI(`刚才和你语音通话了${durationText}`);
            }

            this.app.phoneShell.showNotification('通话结束', `${isGroupCall ? '群语音通话' : '语音通话'} ${durationText}`, '📞');
            setTimeout(() => this.app.render(), 1000);
        });
    }
};
