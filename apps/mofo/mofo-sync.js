import { readUnupdatedFloorCount, recordTableUpdateFloor } from '../../config/update-gap.js';
// [v4.55.0] mofo-sync.js: 从 index.js 剥离的魔坊状态重建与离线提示词模块
let _deps = {};

export function bindMofoSyncDeps(deps = {}) {
    _deps = { ..._deps, ...deps };
}

function getStorage() { return _deps.storage || window.VirtualPhone?.storage; }
function getBootTiming() {
    return _deps.bootTiming || window.VirtualPhone?.bootTiming || { instrumentImport: (p) => p };
}
function stStringifyState(...args) {
    return _deps.stStringifyState ? _deps.stStringifyState(...args) : JSON.stringify(...args);
}
function locateChatFloor(...args) {
    return _deps.locateChatFloor ? _deps.locateChatFloor(...args) : (window.VirtualPhone?.locateChatFloor ? window.VirtualPhone.locateChatFloor(...args) : undefined);
}

function getRuntimeStats(...args) {
    return _deps.getRuntimeStats ? _deps.getRuntimeStats(...args) : (window.VirtualPhone?.runtimeStats ? window.VirtualPhone.runtimeStats(...args) : {});
}

// 替换直接引用的局部变量为防御式 getter
    export async function getOrCreateMofoData() {
        if (!window.VirtualPhone) window.VirtualPhone = {};
        if (window.VirtualPhone.cachedMofoData) {
            if (window.VirtualPhone.mofoApp && window.VirtualPhone.mofoApp.mofoData !== window.VirtualPhone.cachedMofoData) {
                window.VirtualPhone.mofoApp.mofoData = window.VirtualPhone.cachedMofoData;
            }
            return window.VirtualPhone.cachedMofoData;
        }

        if (window.VirtualPhone.mofoApp?.mofoData) {
            window.VirtualPhone.cachedMofoData = window.VirtualPhone.mofoApp.mofoData;
            return window.VirtualPhone.cachedMofoData;
        }

        const module = await getBootTiming().instrumentImport(import('./apps/mofo/mofo-data.js'), './apps/mofo/mofo-data.js');
        window.VirtualPhone.cachedMofoData = new module.MofoData(getStorage());
        if (window.VirtualPhone.mofoApp && window.VirtualPhone.mofoApp.mofoData !== window.VirtualPhone.cachedMofoData) {
            window.VirtualPhone.mofoApp.mofoData = window.VirtualPhone.cachedMofoData;
        }
        return window.VirtualPhone.cachedMofoData;
    }

    function insertTextToSendTextarea(text, cursorOffset = null) {
        const textarea = document.getElementById('send_textarea');
        if (!textarea) return false;

        const safeText = String(text || '');
        const startPos = textarea.selectionStart || textarea.value.length;
        const endPos = textarea.selectionEnd || textarea.value.length;
        const textBefore = textarea.value.substring(0, startPos);
        const textAfter = textarea.value.substring(endPos, textarea.value.length);

        textarea.value = textBefore + safeText + textAfter;
        const offset = Number.isInteger(cursorOffset) ? cursorOffset : safeText.length;
        const newCursorPos = startPos + Math.max(0, Math.min(offset, safeText.length));
        textarea.selectionStart = newCursorPos;
        textarea.selectionEnd = newCursorPos;
        textarea.focus();
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
        return true;
    }

    async function processMofoTags(rawText, { source = 'assistant', messageIndex = null } = {}) {
        const safeText = String(rawText || '').trim();
        if (!safeText) return [];

        try {
            const mofoData = await getOrCreateMofoData();
            if (!mofoData || typeof mofoData.applyTagUpdatesFromText !== 'function') return [];
            return mofoData.applyTagUpdatesFromText(safeText, { source, messageIndex });
        } catch (e) {
            console.warn('⚠️ [魔坊] 标签解析失败:', e);
            return [];
        }
    }

    export async function syncMofoItemFromCurrentChat(itemOrId) {
        try {
            const mofoData = await getOrCreateMofoData();
            if (!mofoData || typeof mofoData.applyTagUpdatesFromText !== 'function') return null;

            const item = (itemOrId && typeof itemOrId === 'object')
                ? itemOrId
                : mofoData.getItemById?.(itemOrId);
            const tagName = String(item?.tagName || item?.name || '').trim();
            if (!tagName) return item || null;

            const ctx = getContext?.();
            const chat = Array.isArray(ctx?.chat) ? ctx.chat : [];
            if (chat.length === 0) return item || null;

            const escapeRegex = (value) => String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const tagRegex = new RegExp(
                `(?:<|&lt;)\\s*${escapeRegex(tagName)}\\s*(?:>|&gt;)[\\s\\S]*?(?:<|&lt;)\\s*\\/\\s*${escapeRegex(tagName)}\\s*(?:>|&gt;)`,
                'i'
            );
            for (let index = chat.length - 1; index >= 0; index -= 1) {
                const message = chat[index] || {};
                const swipeIndex = Number.isInteger(message.swipe_id) ? message.swipe_id : null;
                const candidates = [];
                if (swipeIndex !== null && Array.isArray(message.swipes) && typeof message.swipes[swipeIndex] !== 'undefined') {
                    candidates.push(message.swipes[swipeIndex]);
                }
                candidates.push(message.mes, message.content);

                const text = candidates
                    .map(value => String(value || ''))
                    .find(value => value && tagRegex.test(value));
                if (!text) continue;

                mofoData.applyTagUpdatesFromText(text, { source: 'current_chat_preview', messageIndex: index });
                return mofoData.getItemById?.(item.id) || item;
            }
            return item || null;
        } catch (e) {
            console.warn('⚠️ [魔坊] 同步当前聊天标签失败:', e);
            return null;
        }
    }

    export async function rebuildMofoStateFromCurrentChat() {
        try {
            const mofoData = await getOrCreateMofoData();
            if (!mofoData || typeof mofoData.rebuildSessionStateFromTextBlocks !== 'function') return [];

            const ctx = getContext?.();
            const chat = Array.isArray(ctx?.chat) ? ctx.chat : [];
            if (chat.length === 0) {
                mofoData.rebuildSessionStateFromTextBlocks([], { source: 'current_chat_rebuild' });
                return [];
            }

            const textBlocks = [];
            chat.forEach((message) => {
                if (!message || message.is_user) return;
                const swipeIndex = Number.isInteger(message.swipe_id) ? message.swipe_id : null;
                if (swipeIndex !== null && Array.isArray(message.swipes) && typeof message.swipes[swipeIndex] !== 'undefined') {
                    textBlocks.push(String(message.swipes[swipeIndex] || ''));
                    return;
                }
                textBlocks.push(String(message.mes || message.content || ''));
            });
            return mofoData.rebuildSessionStateFromTextBlocks(textBlocks, { source: 'current_chat_rebuild' });
        } catch (e) {
            console.warn('⚠️ [魔坊] 重建当前聊天状态失败:', e);
            return [];
        }
    }

    // ==========================================
    //  新增：魔坊动态更新气泡 & 全局速览弹窗
    // ==========================================
    if (!window.VirtualPhone) window.VirtualPhone = {};
    // [v2.72.0] 表格更新锚点（update-gap）：把「表格落后正文几楼」挂到运行时。
    //   挂在 VirtualPhone 上而不是某个 App 内部，是为了让任意表格/状态类 App 都能
    //   用同一套锚点口径（window.VirtualPhone.updateGap.read/record/line），
    //   而不是每个 App 各写一份「我落后几楼」的近似算法——那正是各说各话的入口。
    //   入参 context 由调用方从 ST 宿主取：{ chat, chatMetadata, saveMetadataDebounced, scope }。
    try {
        window.VirtualPhone.updateGap = {
            KEY: UPDATE_GAP_KEY,
            read: (ctx) => readUnupdatedFloorCount(ctx),
            record: (ctx, floor) => recordTableUpdateFloor(ctx, floor),
            line: (ctx) => updateGapLine(ctx),
        };
    } catch (_e) { /* 全局不可写时不阻断初始化 */ }
// [v2.27.0] 常驻资源诊断:window.VirtualPhone.runtimeStats()
    window.VirtualPhone.runtimeStats = getRuntimeStats;
    /* [v4.13.0 · R4-O1] 宿主楼层定位口:名字**取自契约常量**(`HOST_LOCATE_METHOD`),
     *   不在两侧各写一遍字面量 —— 名字漂了就是静默失联(`config/source-locator.js`
     *   的 `locateTarget` 按同一个常量去取这一格)。挂在这里而不是让记忆 App 自己摸 DOM:
     *   定位主聊天楼是**宿主的活**,手机侧只该通过这一口委托。 */
    try { window.VirtualPhone[HOST_LOCATE_METHOD] = locateChatFloor; }
    catch (_e) { /* 全局不可写时不阻断初始化 */ }
    // [v2.33.0] 过早回收**成因**（供测试与控制台单独查）：回答「这些过早回收是谁造成的」——
    //   与 releaseTally 分工：后者给总数与判词，本函数给构成（tidy / host-prefix /
    //   host-exact / host-all / shutdown）。挂在 VirtualPhone 上是为了让成因可单独断言。
    try { window.VirtualPhone.prematureCauses = function prematureCauses() { return childRuntimePrematureBy(''); }; } catch (_e) { /* 忽略 */ }
    // [v2.32.0] 回收口径一句话：控制台执行 window.VirtualPhone.releaseTally()
    //   即得「哪个域回收了几次、其中几次过早」的人类可读一行，不必自己拼两本账。
    window.VirtualPhone.releaseTally = function releaseTally() {
        try {
            const s = getRuntimeStats();
            const rs = s.releaseVerdict?.rows || [];
            if (!rs.length) return `回收口径：${Object.keys(s.released || {}).length} 个域名被回收过，无过早回收`;
            // [v2.33.0] 一行里给出**成因**：只说「过早 M 次」无法回答「要不要管它」，
            //   而前两版恰好卡在这里 —— 健康装机上「有过早回收」恒成立（界面正常
            //   返回也会被计入），于是读者只能学会忽略这句话。
            return '回收口径：' + rs.map(x => {
                const detail = Object.entries(x.causes || {}).map(([k, v]) => `${k} ${v}`).join('/');
                const mine = x.hostPremature > 0 ? `（需处理 ${x.hostPremature} 次）` : '';
                return `${x.name} 回收 ${x.releases} 次（其中过早 ${x.premature} 次${detail ? '：' + detail : ''}${mine}）`;
            }).join(' · ');
        } catch (e) { return '回收口径读取失败：' + String(e?.message || e); }
    };
    window.VirtualPhone.showMofoUpdateBubble = async function (mofoId) {
        try {
            const mofoData = await getOrCreateMofoData();
            const item = mofoData?.getItemById?.(mofoId);
            if (!item) return;

            const hostDoc = (() => {
                let hostWindow = window;
                try {
                    let probe = window;
                    while (probe.parent && probe.parent !== probe) {
                        const next = probe.parent;
                        if (!next.document?.body) break;
                        probe = next;
                    }
                    hostWindow = probe;
                } catch (e) {}
                try {
                    return hostWindow.document || document;
                } catch (e) {
                    return document;
                }
            })();
            const hostWin = hostDoc.defaultView || window;

            const escapeHtml = (text) => String(text ?? '')
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#39;');
            const sanitizePreviewHtml = (html) => String(html || '')
                .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
                .replace(/<iframe\b[^>]*>[\s\S]*?<\/iframe>/gi, '')
                .replace(/\son[a-z]+\s*=\s*(".*?"|'.*?'|[^\s>]+)/gi, '')
                .replace(/\s(href|src)\s*=\s*(['"])\s*javascript:[\s\S]*?\2/gi, ' $1="#"');

            // 1. 注入气泡和弹窗的基础 CSS (只注入一次)
            {
                let style = hostDoc.getElementById('mofo-global-bubble-style');
                if (!style) {
                    style = hostDoc.createElement('style');
                    style.id = 'mofo-global-bubble-style';
                    (hostDoc.head || hostDoc.documentElement).appendChild(style);
                }
                style.textContent = `
                    #mofo-global-bubble-root {
                        position: fixed;
                        inset: 0;
                        z-index: 2147483646;
                        pointer-events: none;
                        isolation: isolate;
                        --mofo-bubble-accent: var(--SmartThemeShadowColor, var(--SmartThemeQuoteColor, #a1aebb));
                        --mofo-bubble-text: var(--SmartThemeBodyColor, #3f3737);
                        --mofo-bubble-highlight: var(--SmartThemeBlurTintColor, rgba(255,255,255,0.82));
                    }
                    .mofo-update-bubble {
                        position: fixed;
                        width: 44px;
                        height: 44px;
                        padding: 0;
                        transform: translate(-50%, -50%) scale(0.9);
                        border-radius: 50%;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        background:
                            radial-gradient(150% 150% at 30% 30%, color-mix(in srgb, var(--mofo-bubble-highlight) 32%, transparent), rgba(255,255,255,0.02)),
                            color-mix(in srgb, var(--mofo-bubble-accent) 10%, transparent);
                        box-shadow:
                            inset 6px 0 12px color-mix(in srgb, var(--mofo-bubble-accent) 30%, rgba(255,255,255,0.2)),
                            inset -6px 0 12px color-mix(in srgb, var(--mofo-bubble-accent) 18%, rgba(255,255,255,0.18)),
                            inset 0 -6px 12px color-mix(in srgb, var(--mofo-bubble-accent) 16%, rgba(255,255,255,0.14)),
                            inset 0 6px 12px color-mix(in srgb, var(--mofo-bubble-highlight) 82%, rgba(255,255,255,0.72)),
                            0 7px 14px rgba(0,0,0,0.08);
                        box-sizing: border-box;
                        z-index: 2147483646;
                        cursor: pointer;
                        opacity: 0;
                        pointer-events: auto;
                        user-select: none;
                        transition: transform 0.24s cubic-bezier(0.2, 0.8, 0.2, 1), opacity 0.2s ease, filter 0.2s ease;
                    }
                    .mofo-update-bubble::before {
                        content: '';
                        position: absolute;
                        top: 22%;
                        left: 30%;
                        width: 8px;
                        height: 8px;
                        border-radius: 50%;
                        background: color-mix(in srgb, var(--mofo-bubble-highlight) 92%, white);
                        filter: blur(1px);
                        box-shadow: 0 0 5px rgba(255,255,255,0.5);
                        pointer-events: none;
                    }
                    .mofo-update-bubble::after {
                        content: '';
                        position: absolute;
                        top: 38%;
                        left: 20%;
                        width: 3px;
                        height: 3px;
                        border-radius: 50%;
                        background: color-mix(in srgb, var(--mofo-bubble-highlight) 80%, white);
                        filter: blur(0.5px);
                        pointer-events: none;
                    }
                    .mofo-update-bubble.show {
                        transform: translate(-50%, -50%) scale(1);
                        opacity: 1;
                        animation: mofoBubbleFloat 3s ease-in-out infinite;
                    }
                    .mofo-update-bubble:hover {
                        transform: translate(-50%, -50%) scale(1.025);
                        filter: brightness(1.02);
                    }
                    .mofo-update-bubble:active { transform: translate(-50%, -50%) scale(0.98); }
                    .mofo-update-bubble.bursting {
                        pointer-events: none;
                        animation: mofoBubbleBurst 0.34s ease-out forwards;
                    }
                    .mofo-burst-dot {
                        position: fixed;
                        width: 6px;
                        height: 6px;
                        border-radius: 50%;
                        background: radial-gradient(circle at 30% 30%, rgba(255,255,255,0.95), color-mix(in srgb, var(--mofo-bubble-accent) 26%, rgba(186,232,230,0.28)) 68%, rgba(255,255,255,0));
                        box-shadow: inset 2px 0 5px rgba(173,216,230,0.45), 0 2px 6px rgba(0,0,0,0.08);
                        z-index: 2147483646;
                        pointer-events: none;
                        animation: mofoBurstDot 0.42s ease-out forwards;
                    }
                    .mofo-bubble-rank-mini {
                        position: relative;
                        z-index: 1;
                        width: 100%;
                        min-width: 0;
                        padding: 0 6px;
                        background: transparent;
                        border: 0;
                        box-shadow: none;
                        box-sizing: border-box;
                    }
                    .mofo-bubble-rank-row {
                        display: flex;
                        justify-content: center;
                        align-items: center;
                        min-width: 0;
                    }
                    .mofo-bubble-rank-name {
                        font-size: 8px;
                        line-height: 1.18;
                        color: var(--mofo-bubble-text);
                        white-space: normal;
                        overflow: hidden;
                        text-align: center;
                        font-weight: 700;
                        letter-spacing: 0;
                        text-shadow: 0 1px 2px color-mix(in srgb, var(--mofo-bubble-highlight) 70%, transparent);
                        max-width: 100%;
                        display: -webkit-box;
                        -webkit-line-clamp: 2;
                        -webkit-box-orient: vertical;
                        overflow-wrap: anywhere;
                    }
                    @media (max-width: 640px), (pointer: coarse) {
                        .mofo-update-bubble {
                            width: 36px;
                            height: 36px;
                        }
                        .mofo-bubble-rank-mini {
                            padding: 0 5px;
                        }
                        .mofo-bubble-rank-name {
                            font-size: 7px;
                            line-height: 1.18;
                            letter-spacing: 0;
                        }
                        .mofo-update-bubble::before {
                            width: 6px;
                            height: 6px;
                        }
                        .mofo-update-bubble::after {
                            width: 3px;
                            height: 3px;
                        }
                    }
                    #mofo-global-preview-overlay {
                        position: fixed;
                        inset: 0;
                        background: rgba(0,0,0,0.4);
                        z-index: 2147483647;
                        opacity: 0;
                        transition: opacity 0.2s ease;
                        backdrop-filter: blur(3px);
                        -webkit-backdrop-filter: blur(3px);
                    }
                    #mofo-global-preview-pop {
                        position: fixed;
                        left: 50%;
                        top: 50%;
                        transform: translate(-50%, -50%);
                        max-width: min(92vw, 920px);
                        max-height: 85vh;
                        overflow: auto;
                        touch-action: pan-x pan-y;
                        overscroll-behavior: contain;
                        box-sizing: border-box;
                        animation: mofoPopIn 0.26s cubic-bezier(0.2, 0.8, 0.2, 1);
                    }
                    @keyframes mofoBubbleFloat {
                        0%, 100% { transform: translate(-50%, -50%) scale(1); }
                        50% { transform: translate(-50%, calc(-50% - 12px)) scale(1); }
                    }
                    @keyframes mofoBubbleBurst {
                        0% { transform: translate(-50%, -50%) scale(1); opacity: 1; filter: brightness(1); }
                        45% { transform: translate(-50%, -50%) scale(1.08); opacity: 0.72; filter: brightness(1.2); }
                        100% { transform: translate(-50%, -50%) scale(0.22); opacity: 0; filter: blur(2px) brightness(1.35); }
                    }
                    @keyframes mofoBurstDot {
                        0% { transform: translate(-50%, -50%) scale(0.7); opacity: 0.95; }
                        100% { transform: translate(calc(-50% + var(--mofo-burst-x)), calc(-50% + var(--mofo-burst-y))) scale(0.12); opacity: 0; }
                    }
                    @keyframes mofoPopIn { 0% { transform: translate(-50%, -50%) scale(0.94); opacity: 0; } 100% { transform: translate(-50%, -50%) scale(1); opacity: 1; } }
                `;
            }

            let bubbleRoot = hostDoc.getElementById('mofo-global-bubble-root');
            if (!bubbleRoot) {
                bubbleRoot = hostDoc.createElement('div');
                bubbleRoot.id = 'mofo-global-bubble-root';
                (hostDoc.documentElement || hostDoc.body).appendChild(bubbleRoot);
            }

            const oldBubble = bubbleRoot.querySelector('.mofo-update-bubble');
            if (oldBubble) oldBubble.remove();
            window.VirtualPhone._mofoBubblePositionController?.abort?.();
            window.VirtualPhone._mofoBubbleDismissController?.abort?.();

            const bubblePositionController = new AbortController();
            window.VirtualPhone._mofoBubblePositionController = bubblePositionController;
            const bubbleDismissController = new AbortController();
            window.VirtualPhone._mofoBubbleDismissController = bubbleDismissController;

            // 2. 创建气泡 DOM
            const bubble = hostDoc.createElement('div');
            bubble.className = 'mofo-update-bubble';
            bubble.innerHTML = `
                <div class="mofo-bubble-rank-mini">
                    <div class="mofo-bubble-rank-row">
                        <span class="mofo-bubble-rank-name">${escapeHtml(item.name)}</span>
                    </div>
                </div>
            `;
            bubbleRoot.appendChild(bubble);

            const syncBubbleThemeColors = () => {
                const readPickerColor = (selector) => {
                    const picker = hostDoc.querySelector(selector);
                    const raw = String(picker?.getAttribute?.('color') || picker?.value || '').trim();
                    return raw || '';
                };
                const shadowColor = readPickerColor('#shadow-color-picker');
                const mainTextColor = readPickerColor('#main-text-color-picker');
                if (shadowColor) bubbleRoot.style.setProperty('--mofo-bubble-accent', shadowColor);
                if (mainTextColor) bubbleRoot.style.setProperty('--mofo-bubble-text', mainTextColor);
            };
            syncBubbleThemeColors();
            const ThemeMutationObserver = hostWin.MutationObserver || globalThis.MutationObserver;
            const themeObserver = ThemeMutationObserver ? new ThemeMutationObserver(syncBubbleThemeColors) : null;
            ['#shadow-color-picker', '#main-text-color-picker'].forEach((selector) => {
                const picker = hostDoc.querySelector(selector);
                if (!picker) return;
                picker.addEventListener?.('change', syncBubbleThemeColors, { signal: bubblePositionController.signal });
                picker.addEventListener?.('input', syncBubbleThemeColors, { signal: bubblePositionController.signal });
                themeObserver?.observe(picker, { attributes: true, attributeFilter: ['color', 'value', 'style'] });
            });
            themeObserver?.observe(hostDoc.documentElement, { attributes: true, attributeFilter: ['style', 'class'] });
            bubblePositionController.signal.addEventListener('abort', () => themeObserver?.disconnect(), { once: true });

            const positionBubble = () => {
                if (!bubble.isConnected) {
                    bubblePositionController.abort();
                    return;
                }
                const vv = hostWin.visualViewport;
                const viewWidth = vv?.width || hostWin.innerWidth || window.innerWidth;
                const viewHeight = vv?.height || hostWin.innerHeight || window.innerHeight;
                const offsetLeft = vv?.offsetLeft || 0;
                const offsetTop = vv?.offsetTop || 0;
                const pickAnchorRect = () => {
                    const candidates = [
                        hostDoc.querySelector('#send_form'),
                        hostDoc.querySelector('#form_sheld'),
                        hostDoc.querySelector('#send_textarea')?.closest?.('#send_form, #form_sheld, form, .send_form, .chat-input-container'),
                        hostDoc.querySelector('#send_textarea')
                    ].filter(Boolean);
                    let best = null;
                    for (const el of candidates) {
                        const rect = el.getBoundingClientRect?.();
                        if (!rect || rect.width <= 0 || rect.height <= 0) continue;
                        if (!best || rect.bottom > best.bottom) {
                            best = rect;
                        }
                    }
                    return best;
                };
                const anchorRect = pickAnchorRect();
                const hasAnchor = !!anchorRect;
                const bubbleHalfWidth = Math.max(18, (bubble.offsetWidth || 44) / 2);
                const bubbleHalfHeight = Math.max(18, (bubble.offsetHeight || 44) / 2);

                let targetX = offsetLeft + (viewWidth / 2);
                let targetY = offsetTop + viewHeight - bubbleHalfHeight - 126;

                if (hasAnchor) {
                    targetX = offsetLeft + anchorRect.left + (anchorRect.width / 2);
                    targetY = offsetTop + anchorRect.top - bubbleHalfHeight - 10;
                }

                const minX = offsetLeft + bubbleHalfWidth + 8;
                const maxX = offsetLeft + viewWidth - bubbleHalfWidth - 8;
                const minY = offsetTop + bubbleHalfHeight + 8;
                const maxY = offsetTop + viewHeight - bubbleHalfHeight - 8;
                targetX = Math.max(minX, Math.min(maxX, targetX));
                targetY = Math.max(minY, Math.min(maxY, targetY));

                bubble.style.left = `${targetX}px`;
                bubble.style.top = `${targetY}px`;
            };

            hostWin.addEventListener('resize', positionBubble, { passive: true, signal: bubblePositionController.signal });
            if (hostWin.visualViewport) {
                hostWin.visualViewport.addEventListener('resize', positionBubble, { passive: true, signal: bubblePositionController.signal });
                hostWin.visualViewport.addEventListener('scroll', positionBubble, { passive: true, signal: bubblePositionController.signal });
            }
            positionBubble();

            // 动画滑入
            setTimeout(() => bubble.classList.add('show'), 40);

            const hideBubble = () => {
                bubble.classList.remove('show');
                setTimeout(() => {
                    bubble.remove();
                    bubblePositionController.abort();
                    bubbleDismissController.abort();
                    if (window.VirtualPhone._mofoBubblePositionController === bubblePositionController) {
                        window.VirtualPhone._mofoBubblePositionController = null;
                    }
                    if (window.VirtualPhone._mofoBubbleDismissController === bubbleDismissController) {
                        window.VirtualPhone._mofoBubbleDismissController = null;
                    }
                }, 220);
            };
            window.VirtualPhone.hideMofoUpdateBubble = hideBubble;

            const burstBubble = () => new Promise((resolve) => {
                if (!bubble.isConnected) {
                    resolve();
                    return;
                }
                const rect = bubble.getBoundingClientRect();
                const centerX = rect.left + rect.width / 2;
                const centerY = rect.top + rect.height / 2;
                const vectors = [
                    [-30, -26], [-9, -36], [18, -32], [34, -10],
                    [28, 22], [4, 36], [-25, 20], [-38, -2]
                ];
                vectors.forEach(([x, y], index) => {
                    const dot = hostDoc.createElement('span');
                    dot.className = 'mofo-burst-dot';
                    const size = 3 + (index % 3) * 1.5;
                    dot.style.width = `${size}px`;
                    dot.style.height = `${size}px`;
                    dot.style.left = `${centerX}px`;
                    dot.style.top = `${centerY}px`;
                    dot.style.setProperty('--mofo-burst-x', `${x}px`);
                    dot.style.setProperty('--mofo-burst-y', `${y}px`);
                    bubbleRoot.appendChild(dot);
                    setTimeout(() => dot.remove(), 460);
                });
                bubble.classList.add('bursting');
                setTimeout(() => {
                    hideBubble();
                    resolve();
                }, 330);
            });

            // 3. 点击气泡 -> 打开全屏速览
            bubble.onclick = async () => {
                await burstBubble();

                // --- 解析模板与CSS ---
                const htmlTemplate = String(item.htmlTemplate ?? item.templateHtml ?? item['html模板'] ?? '').trim();
                let innerHtml = '';
                if (htmlTemplate && typeof mofoData.renderTemplate === 'function') {
                    const rendered = mofoData.renderTemplate(htmlTemplate, item.state || {});
                    innerHtml = sanitizePreviewHtml(rendered);
                }
                if (!innerHtml.trim()) {
                    // 兜底渲染（针对没有写HTML模板或模板渲染为空的条目）
                    const rows = Object.entries(item.state || {}).map(([k, v]) => `
                        <div style="display:flex; justify-content:space-between; gap:8px; margin-bottom:6px; padding:8px; background:#f5f8ff; border-radius:8px;">
                            <span style="color:#3c5277; font-size:12px;">${escapeHtml(k)}</span>
                            <strong style="color:#1f2f46; font-size:12px;">${escapeHtml(typeof v === 'object' ? JSON.stringify(v) : String(v ?? ''))}</strong>
                        </div>
                    `).join('');
                    innerHtml = `<div class="mofo-preview-card" style="padding:12px; background:#fff; border-radius:12px;">
                        <div style="font-size:14px; font-weight:bold; margin-bottom:10px;">${escapeHtml(item.name)}</div>
                        ${rows || '<div class="mofo-runtime-empty" style="text-align:center; color:#999; padding:20px;">暂无数据</div>'}
                    </div>`;
                }

                // 为了防止 CSS 污染，包裹一个特定的作用域 class
                const scopeClass = 'mofo-global-scope-' + Date.now();
                const cssTextRaw = String(item.cssText || '').replace(/<\/style/gi, '<\\/style');
                const cssText = cssTextRaw.replace(/(^|[{}])(\s*[^@{}][^{}]*?)\{/g, (match, p1, p2) => {
                    const scoped = String(p2 || '')
                        .split(',')
                        .map((sel) => {
                            const selector = String(sel || '').trim();
                            if (!selector) return '';
                            if (/^(from|to|\d+%)$/i.test(selector)) return selector;
                            if (/^(html|body|:root)$/i.test(selector)) return `.${scopeClass}`;
                            if (selector.startsWith(`.${scopeClass}`)) return selector;
                            return `.${scopeClass} ${selector}`;
                        })
                        .filter(Boolean)
                        .join(', ');
                    return scoped ? `${p1}${scoped}{` : match;
                });

                // --- 创建遮罩层与卡片 ---
                const oldOverlay = hostDoc.getElementById('mofo-global-preview-overlay');
                oldOverlay?.remove();
                const overlay = hostDoc.createElement('div');
                overlay.id = 'mofo-global-preview-overlay';

                const pop = hostDoc.createElement('div');
                pop.id = 'mofo-global-preview-pop';
                pop.className = scopeClass;
                pop.innerHTML = `<style>${cssText}</style>${innerHtml}`;
                overlay.appendChild(pop);
                (hostDoc.documentElement || hostDoc.body).appendChild(overlay);

                const positionPop = () => {
                    if (!pop.isConnected) return;
                    const vv = hostWin.visualViewport;
                    const viewWidth = vv?.width || hostWin.innerWidth || window.innerWidth;
                    const viewHeight = vv?.height || hostWin.innerHeight || window.innerHeight;
                    const offsetLeft = vv?.offsetLeft || 0;
                    const offsetTop = vv?.offsetTop || 0;
                    pop.style.left = `${offsetLeft + (viewWidth / 2)}px`;
                    pop.style.top = `${offsetTop + (viewHeight / 2)}px`;
                    pop.style.maxHeight = `${Math.max(240, viewHeight - 28)}px`;
                };
                positionPop();

                const previewController = new AbortController();
                hostWin.addEventListener('resize', positionPop, { passive: true, signal: previewController.signal });
                if (hostWin.visualViewport) {
                    hostWin.visualViewport.addEventListener('resize', positionPop, { passive: true, signal: previewController.signal });
                    hostWin.visualViewport.addEventListener('scroll', positionPop, { passive: true, signal: previewController.signal });
                }

                // 淡入
                setTimeout(() => { overlay.style.opacity = '1'; }, 10);

                let overlayClosed = false;
                const closeOverlay = () => {
                    if (overlayClosed) return;
                    overlayClosed = true;
                    previewController.abort();
                    overlay.style.opacity = '0';
                    setTimeout(() => overlay.remove(), 200);
                };

                // 点击空白处关闭
                const closeByOutside = (e) => {
                    const target = e?.target;
                    if (!target) return;
                    if (pop.contains(target)) return;
                    closeOverlay();
                };
                overlay.addEventListener('pointerdown', closeByOutside, true);
                overlay.addEventListener('mousedown', closeByOutside, true);
                overlay.addEventListener('touchstart', closeByOutside, { passive: true, capture: true });
                hostDoc.addEventListener('pointerdown', closeByOutside, { capture: true, signal: previewController.signal });
                hostDoc.addEventListener('mousedown', closeByOutside, { capture: true, signal: previewController.signal });
                hostDoc.addEventListener('touchstart', closeByOutside, { passive: true, capture: true, signal: previewController.signal });
            };
        } catch (e) {
            console.error('魔坊气泡生成失败:', e);
        }
    };

    export async function buildMofoOfflinePromptContent() {
        try {
            const mofoData = await getOrCreateMofoData();
            if (!mofoData) return '';
            await rebuildMofoStateFromCurrentChat();

            const items = (typeof mofoData.getOfflinePromptItems === 'function')
                ? mofoData.getOfflinePromptItems()
                : ((typeof mofoData.getItems === 'function' ? mofoData.getItems() : []) || [])
                    .filter(item => item && item.offlinePromptEnabled !== false && String(item.promptTemplate || '').trim());

            if (!Array.isArray(items) || items.length === 0) return '';

            const stringifyState = stStringifyState;
            const buildStateLines = (stateObj) => {
                const entries = Object.entries(stateObj || {});
                if (entries.length === 0) return '暂无状态';
                return entries.map(([k, v]) => `${k}: ${stringifyState(v)}`).join('\n');
            };
            const formatUpdatedAt = (ts) => {
                const n = Number(ts || 0);
                if (!Number.isFinite(n) || n <= 0) return '未知';
                const d = new Date(n);
                if (Number.isNaN(d.getTime())) return '未知';
                return d.toLocaleString('zh-CN', {
                    year: 'numeric',
                    month: '2-digit',
                    day: '2-digit',
                    hour: '2-digit',
                    minute: '2-digit'
                });
            };

            const blocks = items.map(item => {
                const name = String(item?.name || '魔坊').trim() || '魔坊';
                const tagName = String(item?.tagName || name).trim() || name;
                const stateObj = (item?.state && typeof item.state === 'object' && !Array.isArray(item.state))
                    ? item.state
                    : {};
                const stateJson = (() => {
                    try { return JSON.stringify(stateObj, null, 2); } catch (e) { return '{}'; }
                })();
                const stateLines = buildStateLines(stateObj);
                const lastPayload = String(item?.lastPayload || '').trim() || '无';
                const updatedAt = formatUpdatedAt(item?.updatedAt);

                let tpl = String(item?.promptTemplate || '').trim();
                tpl = tpl
                    .replace(/\{\{mofoName\}\}/gi, name)
                    .replace(/\{\{mofoTag\}\}/gi, tagName)
                    .replace(/\{\{mofoState\}\}/gi, stateLines)
                    .replace(/\{\{mofoStateJson\}\}/gi, stateJson)
                    .replace(/\{\{mofoLastPayload\}\}/gi, lastPayload)
                    .replace(/\{\{mofoUpdatedAt\}\}/gi, updatedAt);

                return [
                    `【魔坊条目】${name}`,
                    `标签: <${tagName}>`,
                    `更新时间: ${updatedAt}`,
                    `当前状态:`,
                    stateLines,
                    `提示词模板:`,
                    tpl
                ].join('\n');
            });

            return `【魔坊线下提示词】\n${blocks.join('\n\n')}\n`;
        } catch (e) {
            console.warn('⚠️ [魔坊] 构建线下提示词失败:', e);
            return '';
        }
    }

