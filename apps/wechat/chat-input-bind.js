/* ========================================================
 *  RubyPhone — chat-view.js「输入区按钮挂载」切片（R23-O2）
 * --------------------------------------------------------
 *  为什么单独一个模块：这两个块在 bindEvents()（690 行）体内是**纯语句序列** ——
 *  不写外层局部、不 return 外流、只读 1 个外层局部 `query`、靠 `this` 拿实例。
 *  切法不是「整段搬方法」而是「原样搬块 + 把 this/query 显式传进来」：调用点写
 *  `fn.call(this, query)`，于是**函数体一个字没改**，`this` 仍是同一实例，
 *  箭头回调里的 this 也一层不差。任何肉眼看不出但会改语义的改写（this→self、
 *  重排语句、合并 if）都不允许 —— 逐字节比对在 tests/r23_o2_body_slice.test.mjs。
 *
 *  本文件 **零 import**：只用 Date/Number/String/Math/window/Event/setTimeout 等全局。
 *  一旦这里多出 import，就说明有人把 DOM 之外的判定搬进来了（闸会红）。
 * ======================================================== */

/* [v4.158.0 · R23-O2] bindEvents 体内切片 A：语音输入按钮（源 L9970-L10010） */
export function bindVoiceInputButton(query) {
        // 🎤 [v2.13.0] 语音输入按钮：点按说话，识别结果填入输入框（追加，不覆盖已有内容）
        const voiceInputBtn = query('#voice-input-btn');
        if (voiceInputBtn) {
            const runVoiceInput = async (e) => {
                e?.preventDefault?.();
                e?.stopPropagation?.();
                if (voiceInputBtn.dataset.busy === '1') return;
                const asrManager = window.VirtualPhone?.asrManager;
                if (!asrManager || typeof asrManager.recognizeOnce !== 'function') {
                    this.app.phoneShell?.showNotification('语音输入', 'ASR 管理器未初始化，请先在设置→TTS 页配置', '⚠️');
                    return;
                }
                voiceInputBtn.dataset.busy = '1';
                voiceInputBtn.style.color = '#07c160';
                try {
                    const text = await asrManager.recognizeOnce();
                    const safeText = String(text || '').trim();
                    if (safeText) {
                        const chatInput = query('#chat-input');
                        const prev = String(chatInput?.value || this.inputText || '').trim();
                        // 追加而非覆盖：保留用户已输入的半句话
                        const next = prev ? `${prev} ${safeText}` : safeText;
                        this.inputText = next;
                        if (chatInput) chatInput.value = next;
                        // 同步触发输入事件，让发送按钮状态/倒计时等逻辑更新
                        chatInput?.dispatchEvent(new Event('input', { bubbles: true }));
                    } else {
                        this.app.phoneShell?.showNotification('语音输入', '没有听到声音', '⚠️');
                    }
                } catch (err) {
                    this.app.phoneShell?.showNotification('语音输入失败', String(err?.message || err || '识别失败').slice(0, 120), '❌');
                } finally {
                    voiceInputBtn.dataset.busy = '';
                    voiceInputBtn.style.color = '#555';
                }
            };
            // 移动端点按（touchend 触发，避免与长按冲突）
            voiceInputBtn.addEventListener('touchend', (e) => { e.preventDefault(); runVoiceInput(e); }, { passive: false });
            // 桌面端点击
            voiceInputBtn.addEventListener('click', (e) => { runVoiceInput(e); });
        }
}

/* [v4.158.0 · R23-O2] bindEvents 体内切片 B+C：快捷回复发送/取消（源 L10021-L10064） */
export function bindQuickReplyButtons(query) {
        const quickReplySendBtn = query('.quick-reply-send');
        const runQuickReplySend = (e) => {
            e?.preventDefault?.();
            e?.stopPropagation?.();
            const now = Date.now();
            if (now - Number(quickReplySendBtn?.dataset.lastActionAt || 0) < 450) return;
            if (quickReplySendBtn) quickReplySendBtn.dataset.lastActionAt = String(now);
            this._clearQuickReplyTimeScrollTimers();
            this._sendActiveQuickReply();
        };
        quickReplySendBtn?.addEventListener('touchstart', (e) => {
            e.preventDefault();
            e.stopPropagation();
        }, { passive: false });
        quickReplySendBtn?.addEventListener('touchend', runQuickReplySend);
        quickReplySendBtn?.addEventListener('mousedown', (e) => {
            e.preventDefault();
            e.stopPropagation();
        });
        quickReplySendBtn?.addEventListener('click', runQuickReplySend);

        const quickReplyCancelBtn = query('.quick-reply-cancel');
        const runQuickReplyCancel = (e) => {
            e?.preventDefault?.();
            e?.stopPropagation?.();
            const now = Date.now();
            if (now - Number(quickReplyCancelBtn?.dataset.lastActionAt || 0) < 450) return;
            if (quickReplyCancelBtn) quickReplyCancelBtn.dataset.lastActionAt = String(now);
            this._clearQuickReplyTimeScrollTimers();
            this.showQuickReplies = false;
            this.activeQuickReplyKey = '';
            this.quickReplyTimeText = '';
            this.app.render();
        };
        quickReplyCancelBtn?.addEventListener('touchstart', (e) => {
            e.preventDefault();
            e.stopPropagation();
        }, { passive: false });
        quickReplyCancelBtn?.addEventListener('touchend', runQuickReplyCancel);
        quickReplyCancelBtn?.addEventListener('mousedown', (e) => {
            e.preventDefault();
            e.stopPropagation();
        });
        quickReplyCancelBtn?.addEventListener('click', runQuickReplyCancel);
}
