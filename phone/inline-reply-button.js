/**
 * 内嵌快捷回复按钮（底部栏与快速回复集成）[从 index.js 剥离]
 * 提供底部栏快速回复气泡、魔坊标签快捷插入、微信/短信消息模板填充。
 */
import { globalRuntime, onceFlag } from '../config/runtime-lifecycle.js';
import { PHONE_EVENTS } from '../config/phone-events.js';

let _deps = {};
export function bindInlineReplyDeps(deps) {
    if (deps) Object.assign(_deps, deps);
}

function getOrCreatePhoneCallData(...args) { return _deps.getOrCreatePhoneCallData ? _deps.getOrCreatePhoneCallData(...args) : null; }
function getOrCreateMofoData(...args) { return _deps.getOrCreateMofoData ? _deps.getOrCreateMofoData(...args) : null; }
function syncMofoItemFromCurrentChat(...args) { return _deps.syncMofoItemFromCurrentChat ? _deps.syncMofoItemFromCurrentChat(...args) : null; }
function formatWechatInlineReplyDateTime(...args) { return _deps.formatWechatInlineReplyDateTime ? _deps.formatWechatInlineReplyDateTime(...args) : ''; }
function formatSmsInlineReplyDateTime(...args) { return _deps.formatSmsInlineReplyDateTime ? _deps.formatSmsInlineReplyDateTime(...args) : ''; }
function insertTextToSendTextarea(...args) { return _deps.insertTextToSendTextarea ? _deps.insertTextToSendTextarea(...args) : false; }
function stStringifyState(...args) { return _deps.stStringifyState ? _deps.stStringifyState(...args) : ''; }

export     function createInlineReplyButton() {
        const btnId = 'st-phone-inline-reply-btn';
        const legacyWrapperId = 'st-phone-inline-reply-wrapper';
        const qrScriptContainerId = 'script_container_st_phone_inline_reply';
        const qrWhitelistId = 'JSR::st_phone_inline_reply';
        const qrWhitelistItemId = 'st-phone-inline-reply-whitelist-item';
        const qrWhitelistInitKey = 'phone_inline_reply_qr_whitelist_initialized';
        const qrMenuItemId = 'st-phone-inline-reply-action-item';
        const qrExtensionGroupName = '手机插件';
        const qrExtensionButtonName = 'fa-solid fa-mobile-screen-button';
        let qrAssistantKnown = false;

        const isQrAssistantAvailable = () => !!(window.quickReplyMenu || Array.isArray(window.qrAssistantExtensionApi) || document.body?.classList?.contains('qra-enabled'));

        const registerQrAssistantButton = () => {
            if (!isQrAssistantAvailable()) return false;
            if (!Array.isArray(window.qrAssistantExtensionApi)) {
                window.qrAssistantExtensionApi = [];
            }
            let changed = false;
            const existing = window.qrAssistantExtensionApi.find(item => item?.dom_id === qrScriptContainerId);
            if (existing) {
                if (existing.group_name !== qrExtensionGroupName) {
                    existing.group_name = qrExtensionGroupName;
                    changed = true;
                }
                if (existing.button_name !== qrExtensionButtonName) {
                    existing.button_name = qrExtensionButtonName;
                    changed = true;
                }
            } else {
                window.qrAssistantExtensionApi.push({
                    dom_id: qrScriptContainerId,
                    group_name: qrExtensionGroupName,
                    button_name: qrExtensionButtonName
                });
                changed = true;
            }
            if (!qrAssistantKnown) {
                qrAssistantKnown = true;
                changed = true;
            }
            if (changed) applyQrWhitelist();
            return true;
        };

        const ensureQrManagedHideStyle = () => {
            let style = document.getElementById('st-phone-inline-reply-qr-managed-style');
            if (!style) {
                style = document.createElement('style');
                style.id = 'st-phone-inline-reply-qr-managed-style';
                document.head.appendChild(style);
            }
            style.textContent = `
                #script_container_st_phone_inline_reply.st-phone-inline-reply-qr-managed,
                #st-phone-inline-reply-wrapper.st-phone-inline-reply-qr-managed,
                .st-phone-inline-reply-wrapper.st-phone-inline-reply-qr-managed,
                #st-phone-inline-reply-btn.st-phone-inline-reply-qr-managed {
                    display: none !important;
                }
            `;
        };

        const isInlineReplyWhitelistedByQr = (qrSettings) => {
            return Array.isArray(qrSettings?.whitelist) && qrSettings.whitelist.includes(qrScriptContainerId);
        };

        // 注入基础 CSS
        if (!document.getElementById('st-phone-inline-reply-style')) {
            const style = document.createElement('style');
            style.id = 'st-phone-inline-reply-style';
            style.textContent = `
                .remote-ctrl-btn { transition: all 0.2s; flex-shrink: 0; display: flex !important; align-items: center !important; justify-content: center !important; }
                .remote-ctrl-btn .qr--button-label { display: flex !important; align-items: center !important; justify-content: center !important; width: 100%; height: 100%; }
                .remote-ctrl-btn.active { opacity: 1 !important; color: var(--qc-accent); }
                .st-phone-inline-reply-wrapper { display: flex; align-items: center; }
                .st-phone-inline-reply-wrapper.st-phone-inline-reply-qr-managed { display: none !important; }
    #phone-inline-reply-menu-pop {
    position: fixed; z-index: 2147483645;
    background: linear-gradient(180deg,
        rgba(243,248,255,0.72) 0%,
        rgba(233,240,252,0.66) 62%,
        rgba(214,226,246,0.82) 100%);
    backdrop-filter: blur(20px) saturate(135%);
    -webkit-backdrop-filter: blur(20px) saturate(135%);
    border: 1px solid rgba(255,255,255,0.52);
    border-radius: 12px;
    box-shadow: 0 14px 38px rgba(20,35,70,0.32), inset 0 1px 0 rgba(255,255,255,0.65);
    padding: 8px; 
    overflow: hidden; display: flex; flex-direction: column; gap: 6px;
    
    left: 50%;
    width: clamp(240px, 82vw, 420px); 
    height: clamp(280px, 68vh, 460px);
    max-height: calc(100dvh - 20px);
    box-sizing: border-box;

    /* 🔥 新增：移动端手势豁免，允许上下滑动，屏蔽左右滑动误触侧边栏，防止滚动穿透 */
    touch-action: pan-y !important;
    overscroll-behavior-y: contain !important;
}

#phone-inline-reply-menu-pop::before {
    content: '';
    position: absolute;
    inset: 0;
    border-radius: inherit;
    background: linear-gradient(180deg, rgba(255,255,255,0.28) 0%, rgba(255,255,255,0.04) 100%);
    pointer-events: none;
}

#phone-inline-reply-menu-pop::after {
    content: '';
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    height: 56px;
    border-radius: 0 0 12px 12px;
    background: linear-gradient(180deg, rgba(213,225,245,0) 0%, rgba(194,211,238,0.52) 100%);
    pointer-events: none;
}

/* 🔥 新增：用于显示真实头像的 CSS 类 */
.inline-reply-avatar {
    width: 24px;
    height: 24px;
    border-radius: 50%;
    border: 1px solid rgba(255,255,255,0.22);
    object-fit: cover;
    flex-shrink: 0;
}

/* 🔥 修复：让图标和 emoji 居中对齐 */
.inline-reply-menu-item > span:first-child {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    border-radius: 50%;
    border: 1px solid rgba(255,255,255,0.22);
    background: rgba(255,255,255,0.08);
    font-size: 16px;
}
                #phone-inline-reply-menu-pop::-webkit-scrollbar { width: 0; height: 0; }
                .inline-reply-menu-item {
                    display: flex; align-items: center; gap: 10px; padding: 10px 12px; border-radius: 8px;
                    border: 1px solid rgba(151,171,207,0.46);
                    background: rgba(255,255,255,0.26);
                    box-shadow: inset 0 1px 0 rgba(255,255,255,0.5);
                    cursor: pointer; color: var(--phone-global-text, #1f2f46) !important; font-size: 14px;
                    transition: background 0.2s, border-color 0.2s, transform 0.12s;
                    user-select: none;
                    position: relative;
                    z-index: 1;
                }
                .inline-reply-menu-item:hover {
                    background: rgba(255,255,255,0.44);
                    border-color: rgba(126,150,194,0.7);
                }
                .inline-reply-menu-item:active { transform: translateY(1px); }
                .inline-reply-name {
                    flex: 1;
                    min-width: 0;
                    overflow: hidden;
                    text-overflow: ellipsis;
                    white-space: nowrap;
                    color: var(--phone-global-text, #1f2f46) !important;
                }
                .inline-reply-tabbar {
                    display: flex;
                    gap: 6px;
                    margin-bottom: 8px;
                    flex-shrink: 0;
                    position: sticky;
                    top: 0;
                    z-index: 4;
                    background: linear-gradient(180deg, rgba(235,242,252,0.95), rgba(235,242,252,0.78));
                    padding-bottom: 6px;
                }
                .inline-reply-tab-btn {
                    flex: 1;
                    border: 1px solid rgba(129, 151, 192, 0.5);
                    border-radius: 8px;
                    background: rgba(255,255,255,0.35);
                    font-size: 12px;
                    color: #2e456f;
                    font-weight: 700;
                    padding: 7px 8px;
                    cursor: pointer;
                }
                .inline-reply-tab-btn.is-active {
                    background: linear-gradient(135deg, rgba(87,132,223,0.28), rgba(79,121,208,0.42));
                    border-color: rgba(66, 104, 183, 0.78);
                    color: #17315a;
                }
                .inline-reply-page {
                    display: none;
                    flex: 1;
                    min-height: 0;
                    overflow-y: auto;
                    overflow-x: hidden;
                    scrollbar-width: none;
                    -ms-overflow-style: none;
                    touch-action: pan-y !important;
                    overscroll-behavior-y: contain;
                }
                .inline-reply-page::-webkit-scrollbar { width: 0; height: 0; display: none; }
                .inline-reply-page.is-active { display: block; }
                .inline-reply-section-title {
                    font-size: 12px;
                    color: #6b7894;
                    padding: 2px 8px 6px;
                    border-bottom: 1px solid rgba(139,160,198,0.28);
                    margin-bottom: 6px;
                    font-weight: 700;
                    text-align: center;
                    letter-spacing: 0.5px;
                }
                .mofo-toolbar {
                    display: flex;
                    gap: 6px;
                    margin-bottom: 8px;
                }
                .mofo-toolbar-btn {
                    flex: 1;
                    border: 1px solid rgba(116, 139, 184, 0.55);
                    border-radius: 8px;
                    background: rgba(255,255,255,0.34);
                    color: #264672;
                    font-size: 11px;
                    padding: 6px 8px;
                    cursor: pointer;
                    font-weight: 700;
                }
                .mofo-entry {
                    display: flex;
                    flex-direction: column;
                    gap: 4px;
                    border: 1px solid rgba(151,171,207,0.46);
                    border-radius: 8px;
                    background: rgba(255,255,255,0.24);
                    padding: 9px 10px;
                    margin-bottom: 6px;
                    cursor: pointer;
                }
                .mofo-entry.is-active {
                    border-color: rgba(89, 121, 187, 0.85);
                    background: rgba(125, 164, 234, 0.28);
                }
                .mofo-entry-name {
                    font-size: 13px;
                    font-weight: 700;
                    color: #21436f;
                }
                .mofo-entry-head {
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    gap: 8px;
                }
                .mofo-entry-toggle {
                    display: inline-flex;
                    align-items: center;
                    gap: 4px;
                    font-size: 10px;
                    color: #43618f;
                    cursor: pointer;
                    user-select: none;
                }
                .mofo-entry-toggle input {
                    margin: 0;
                    accent-color: #4f7fd5;
                    cursor: pointer;
                }
                .mofo-entry-tag {
                    font-size: 11px;
                    color: #5372a1;
                }
                .mofo-entry-status {
                    font-size: 10px;
                }
                .mofo-preview-wrap {
                    margin-top: 8px;
                    border: 1px solid rgba(116, 139, 184, 0.45);
                    border-radius: 10px;
                    background: rgba(255,255,255,0.28);
                    padding: 8px;
                }
                .mofo-preview-head {
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    margin-bottom: 6px;
                    gap: 8px;
                }
                .mofo-preview-title {
                    font-size: 12px;
                    color: #21436f;
                    font-weight: 700;
                    overflow: hidden;
                    text-overflow: ellipsis;
                    white-space: nowrap;
                }
                .mofo-preview-tag {
                    font-size: 10px;
                    color: #5f7da9;
                    white-space: nowrap;
                }
                .mofo-preview-card {
                    border-radius: 9px;
                    border: 1px solid rgba(120, 141, 181, 0.35);
                    background: rgba(255,255,255,0.25);
                    padding: 8px;
                }
                .mofo-template-preview {
                    min-width: 0;
                    overflow: auto;
                    -webkit-overflow-scrolling: touch;
                    touch-action: pan-x pan-y;
                }
                .mofo-kv-row {
                    display: flex;
                    justify-content: space-between;
                    gap: 6px;
                    font-size: 11px;
                    padding: 5px 6px;
                    border-radius: 7px;
                    background: rgba(255,255,255,0.34);
                    margin-bottom: 5px;
                }
                .mofo-kv-key {
                    color: #355986;
                    overflow: hidden;
                    text-overflow: ellipsis;
                    white-space: nowrap;
                }
                .mofo-kv-val {
                    color: #14345b;
                    font-weight: 700;
                    max-width: 56%;
                    overflow: hidden;
                    text-overflow: ellipsis;
                    white-space: nowrap;
                    text-align: right;
                }
                .mofo-preview-actions {
                    display: flex;
                    gap: 6px;
                    margin-top: 7px;
                }
                .mofo-action-btn {
                    flex: 1;
                    border: 1px solid rgba(116, 139, 184, 0.55);
                    border-radius: 8px;
                    background: rgba(255,255,255,0.35);
                    color: #284a76;
                    font-size: 11px;
                    padding: 6px 8px;
                    cursor: pointer;
                    font-weight: 700;
                }
                .mofo-action-btn.delete {
                    border-color: rgba(188, 92, 117, 0.7);
                    color: #a33c57;
                }
            `;
            document.head.appendChild(style);
        }

        const getInlineReplyHost = () => {
            const qrBar = document.getElementById('qr--bar');
            const isQrAssistantEnabled = !!document.body?.classList?.contains('qra-enabled');

            // QR 助手启用时：直接挂在 qr--bar 根层，避开其对子容器的白名单隐藏规则
            if (isQrAssistantEnabled && qrBar) return qrBar;

            // 优先：QR 助手启用后的可见容器
            const visibleQrHost =
                document.querySelector('#qr--bar > .qr--buttons.qrq-wrapper-visible') ||
                document.querySelector('#qr--bar > .qr--buttons:not(.qrq-hidden-by-plugin)') ||
                document.querySelector('#qr--bar .qr--buttons:not(.qrq-hidden-by-plugin)');
            if (visibleQrHost) return visibleQrHost;

            // 其次：QR 火箭按钮同级
            const rocketButton = document.getElementById('quick-reply-rocket-button');
            if (rocketButton?.parentElement) return rocketButton.parentElement;

            return null;
        };

        const getQrAssistantContext = () => {
            const stContext = window.SillyTavern?.getContext?.();
            const qrSettings = stContext?.extensionSettings?.['qr-assistant'];
            return { stContext, qrSettings };
        };

        const applyQrWhitelist = () => {
            if (window.quickReplyMenu?.applyWhitelistDOMChanges) {
                window.quickReplyMenu.applyWhitelistDOMChanges();
            }
        };

        const ensureQrWhitelistInitialized = (qrSettings, stContext) => {
            if (!storage || !qrSettings) return;

            if (!Array.isArray(qrSettings.whitelist)) {
                qrSettings.whitelist = [];
            }

            const initialized = storage.get(qrWhitelistInitKey);
            if (initialized === true || initialized === 'true') {
                return;
            }

            if (!qrSettings.whitelist.includes(qrWhitelistId)) {
                qrSettings.whitelist.push(qrWhitelistId);
                stContext?.saveSettingsDebounced?.();
                applyQrWhitelist();
            }
            storage.set(qrWhitelistInitKey, true);
        };

        const syncQrWhitelistListItem = () => {
            const { qrSettings } = getQrAssistantContext();
            if (!qrSettings) return;

            if (!Array.isArray(qrSettings.whitelist)) {
                qrSettings.whitelist = [];
            }

            const nonList = document.getElementById('qrq-non-whitelisted-list');
            const wlList = document.getElementById('qrq-whitelisted-list');
            if (!nonList || !wlList) return;

            const duplicateItems = document.querySelectorAll(`#${qrWhitelistItemId}`);
            if (duplicateItems.length > 1) {
                duplicateItems.forEach((item, idx) => {
                    if (idx > 0) item.remove();
                });
            }

            let item = document.getElementById(qrWhitelistItemId);
            if (!item) {
                item = document.createElement('div');
                item.id = qrWhitelistItemId;
                item.className = 'qrq-whitelist-item';
                item.innerHTML = '<i class="fa-solid fa-moon" title="JSSlashRunner"></i><span style="flex:1; overflow:hidden; text-overflow:ellipsis;">手机快捷回复</span>';
                item.addEventListener('click', () => {
                    const { stContext: latestContext, qrSettings: latestSettings } = getQrAssistantContext();
                    if (!latestSettings) return;

                    if (!Array.isArray(latestSettings.whitelist)) {
                        latestSettings.whitelist = [];
                    }

                    const idx = latestSettings.whitelist.indexOf(qrWhitelistId);
                    if (idx > -1) {
                        latestSettings.whitelist.splice(idx, 1);
                    } else {
                        latestSettings.whitelist.push(qrWhitelistId);
                    }

                    latestContext?.saveSettingsDebounced?.();
                    applyQrWhitelist();
                    syncQrWhitelistListItem();
                });
            }

            const targetList = qrSettings.whitelist.includes(qrWhitelistId) ? wlList : nonList;
            if (item.parentElement !== targetList) {
                targetList.appendChild(item);
            }
        };

        const syncQrMenuActionItem = (isInlineBtnEnabled, qrSettings) => {
            const actionList = document.getElementById('qr-list-left');
            const existingItem = document.getElementById(qrMenuItemId);
            const isQrAssistantEnabled = !!document.body?.classList?.contains('qra-enabled');
            const inWhitelist = Array.isArray(qrSettings?.whitelist) && qrSettings.whitelist.includes(qrWhitelistId);
            const shouldShowInMenu = isInlineBtnEnabled && isQrAssistantEnabled && !inWhitelist;

            if (!shouldShowInMenu) {
                existingItem?.remove();
                return;
            }

            if (!actionList) return;

            const removeLeftEmptyState = () => {
                const parentColumn = actionList.parentElement;
                const emptyState = parentColumn?.querySelector('.empty-state');
                if (emptyState) emptyState.remove();
                actionList.style.display = 'flex';
            };

            if (existingItem) {
                if (existingItem.parentElement !== actionList) {
                    actionList.prepend(existingItem);
                }
                removeLeftEmptyState();
                return;
            }

            const item = document.createElement('button');
            item.id = qrMenuItemId;
            item.type = 'button';
            item.className = 'action-item';
            item.dataset.label = '手机快捷回复';
            item.dataset.isStandard = 'false';
            item.dataset.setName = '手机插件';
            item.dataset.source = 'RawDomElement';
            item.dataset.domId = btnId;
            item.innerHTML = '<span>手机快捷回复</span>';
            item.addEventListener('click', (event) => {
                event.preventDefault();
                event.stopPropagation();
                if (window.quickReplyMenu?.handleQuickReplyClick) {
                    window.quickReplyMenu.handleQuickReplyClick({ currentTarget: item });
                } else {
                    document.getElementById(btnId)?.click();
                }
            });

            actionList.prepend(item);
            removeLeftEmptyState();
        };

        const inject = () => {
            if (!storage) return;
            const isEnabled = storage.get('phone_inline_reply_btn') !== false;
            const existingBtn = document.getElementById(btnId);
            const hasQrAssistantApi = registerQrAssistantButton();
            if (hasQrAssistantApi) {
                ensureQrManagedHideStyle();
            } else {
                existingBtn?.classList?.remove?.('st-phone-inline-reply-qr-managed');
                document.getElementById(qrScriptContainerId)?.classList?.remove?.('st-phone-inline-reply-qr-managed');
                document.getElementById(legacyWrapperId)?.classList?.remove?.('st-phone-inline-reply-qr-managed');
            }
            const existingWrapper =
                document.getElementById(qrScriptContainerId) ||
                document.getElementById(legacyWrapperId) ||
                existingBtn?.closest('.st-phone-inline-reply-wrapper');
            const isQrAssistantEnabled = !!document.body?.classList?.contains('qra-enabled');
            const { stContext, qrSettings } = getQrAssistantContext();
            const shouldHideInlineReplyForQr = hasQrAssistantApi && !isInlineReplyWhitelistedByQr(qrSettings);

            if (!hasQrAssistantApi && qrSettings) {
                ensureQrWhitelistInitialized(qrSettings, stContext);
                syncQrWhitelistListItem();
            }
            if (!hasQrAssistantApi) {
                syncQrMenuActionItem(isEnabled, qrSettings);
            } else {
                document.getElementById(qrMenuItemId)?.remove();
                document.getElementById(qrWhitelistItemId)?.remove();
            }

            // 如果开关关闭，移除按钮
            if (!isEnabled) {
                document.getElementById(qrScriptContainerId)?.remove();
                document.getElementById(legacyWrapperId)?.remove();
                existingWrapper?.remove();
                existingBtn?.remove();
                return true;   // [v2.27.0] 用户关掉了入口：已是终态，无需每秒重试
            }

            const host = getInlineReplyHost();

            // 没有 QR 宿主时不显示入口，并清理旧版插在发送键旁的兜底按钮
            if (!host) {
                existingWrapper?.remove();
                existingBtn?.remove();
                return false;   // [v2.27.0] 宿主未就位：继续轮询等待（保留原重试意图）
            }

            // 已存在时做兼容修复：确保在目标容器中，交给 QR 白名单机制控制显示
            if (existingBtn) {
                const currentWrapper =
                    existingBtn.closest(`#${qrScriptContainerId}`) ||
                    existingBtn.closest(`#${legacyWrapperId}`) ||
                    existingBtn.closest('.st-phone-inline-reply-wrapper') ||
                    existingBtn.parentElement;

                if (currentWrapper) {
                    let shouldRefreshQr = false;
                    currentWrapper.id = qrScriptContainerId;
                    currentWrapper.classList.add('st-phone-inline-reply-wrapper');
                    // 小铅笔同款：保持在 qr--buttons 容器中，继承酒馆/主题的按钮样式
                    currentWrapper.classList.add('qr--buttons', 'qr--color');
                    currentWrapper.classList.remove('qr--wrapper');
                    currentWrapper.style.setProperty('--qr--color', 'rgba(0,0,0,0)');
                    currentWrapper.dataset.stPhoneInlineReply = 'true';
                    currentWrapper.classList.toggle('st-phone-inline-reply-qr-managed', shouldHideInlineReplyForQr);
                    existingBtn.classList.toggle('st-phone-inline-reply-qr-managed', shouldHideInlineReplyForQr);
                    if (!currentWrapper.dataset.stPhoneQrProxyBound) {
                        shouldRefreshQr = true;
                        currentWrapper.dataset.stPhoneQrProxyBound = 'true';
                        currentWrapper.addEventListener('click', (event) => {
                            if (event.target?.closest?.(`#${btnId}`)) return;
                            event.preventDefault();
                            event.stopPropagation();
                            currentWrapper.querySelector(`#${btnId}`)?.click?.();
                        });
                    }

                    if (!isQrAssistantEnabled) {
                        currentWrapper.classList.remove('qrq-hidden-by-plugin');
                    }

                    if (host && currentWrapper.parentElement !== host) {
                        shouldRefreshQr = true;
                        const rocketButton = document.getElementById('quick-reply-rocket-button');
                        if (rocketButton && rocketButton.parentElement === host) {
                            rocketButton.insertAdjacentElement('afterend', currentWrapper);
                        } else {
                            host.prepend(currentWrapper);
                        }
                    }
                    if (hasQrAssistantApi && shouldRefreshQr) {
                        applyQrWhitelist();
                    }
                    // [v2.27.0] 稳态：按钮已存在且落在正确宿主上 —— 告知轮询可停。
                    //   currentWrapper 为空说明按钮虽在 DOM 但结构异常，交下一轮继续修。
                    return !!currentWrapper;
                }
                return false;   // [v2.27.0] 有按钮但无容器：结构异常，继续重试
            }

            // 容器不存在则跳过，等待下一轮
            if (!host) return;

            const btn = document.createElement('div');
            btn.id = btnId;
            btn.className = 'remote-ctrl-btn qr--button menu_button interactable';
            btn.title = '快捷回复联系人 (手机插件)';
            btn.innerHTML = '<div class="qr--button-label"><i class="fa-solid fa-mobile-screen-button"></i></div>';

            // 🔥 防抖锁，防止多端触发两次
            let isMenuOpen = false;

            // 🛡️ 核心修复：完全照抄小铅笔，使用 mouseup 和 touchend 绕过酒馆拦截
            const handleAction = async (e) => {
                e.preventDefault();
                e.stopPropagation();

                if (isMenuOpen) return;
                isMenuOpen = true;
                setTimeout(() => { isMenuOpen = false; }, 300); // 300ms 防抖

                try {
                    // 🔥 核心修改：同时提取联系人、群聊、以及系统自动分配的头像映射表
                    let contacts = [];
                    let groups = [];
                    let autoAvatarMap = {}; // 新增映射表变量

                    try {
                        const rawData = storage.get('wechat_data', false);
                        if (rawData) {
                            const parsed = typeof rawData === 'string' ? JSON.parse(rawData) : rawData;
                            contacts = parsed.contacts || [];
                            groups = (parsed.chats || []).filter(c => c.type === 'group');
                            autoAvatarMap = parsed.contactAutoAvatarMap || {}; // 提取系统分配的头像池映射
                        }
                    } catch (parseErr) {
                        console.error('📱 [手机插件] 解析微信数据失败:', parseErr);
                    }

                    // 🔥 辅助函数：智能解析真实头像（优先找自定义，其次找系统分配池）
                    const resolveAvatar = (id, customAvatar) => {
                        // 1. 如果有用户自定义上传的图片，优先使用
                        if (customAvatar && (customAvatar.startsWith('data:image') || customAvatar.startsWith('http') || customAvatar.startsWith('/'))) {
                            return customAvatar;
                        }
                        // 2. 如果没有自定义，去系统自动分配池里找（通过联系人 ID 匹配）
                        if (id && autoAvatarMap[id]) {
                            return autoAvatarMap[id];
                        }
                        return null; // 啥都没有就返回 null，让后面降级渲染 Emoji
                    };

                    // 组合微信列表
                    const combinedList = [
                        ...contacts.map(c => ({
                            name: c.name,
                            avatar: resolveAvatar(c.id, c.avatar),
                            fallbackIcon: '👤',
                            chatType: 'single'
                        })),
                        ...groups.map(g => ({
                            name: g.name,
                            avatar: resolveAvatar(g.id, g.avatar),
                            fallbackIcon: '👥',
                            chatType: 'group'
                        }))
                    ];
                    const smsConversations = getOrCreatePhoneCallData()
                        .getSmsConversations()
                        .filter(conversation => String(conversation?.name || '').trim())
                        .sort((a, b) => Number(b?.updatedAt || 0) - Number(a?.updatedAt || 0));

                    const mofoData = await getOrCreateMofoData();
                    let mofoItems = (typeof mofoData?.getItems === 'function') ? mofoData.getItems() : [];
                    let activeMofoId = mofoItems[0]?.id || '';

                    // 移除旧菜单
                    const oldMenu = document.getElementById('phone-inline-reply-menu-pop');
                    if (oldMenu) {
                        oldMenu._stPhoneDispose?.();
                        oldMenu.remove();
                    }

                    const menu = document.createElement('div');
                    menu.id = 'phone-inline-reply-menu-pop';

                    const escapeHtml = (text) => {
                        const div = document.createElement('div');
                        div.textContent = String(text ?? '');
                        return div.innerHTML;
                    };
                    const getInlineReplyWechatUserName = () => {
                        try {
                            const runtimeName = String(window.VirtualPhone?.wechatApp?.wechatData?.getUserInfo?.()?.name || '').trim();
                            if (runtimeName) return runtimeName;
                        } catch (e) { }
                        try {
                            const cachedName = String(window.VirtualPhone?.cachedWechatData?.getUserInfo?.()?.name || '').trim();
                            if (cachedName) return cachedName;
                        } catch (e) { }
                        try {
                            const context = getContext();
                            const userName = String(context?.name1 || '').trim();
                            if (userName) return userName;
                        } catch (e) { }
                        return '用户';
                    };

                    const stringifyState = stStringifyState;
                    const sanitizePreviewHtml = (html) => {
                        return String(html || '')
                            .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
                            .replace(/<iframe\b[^>]*>[\s\S]*?<\/iframe>/gi, '')
                            .replace(/\son[a-z]+\s*=\s*(".*?"|'.*?'|[^\s>]+)/gi, '')
                            .replace(/\s(href|src)\s*=\s*(['"])\s*javascript:[\s\S]*?\2/gi, ' $1="#"');
                    };
                    const normalizeTemplateExprPath = (expr = '') => {
                        return String(expr ?? '')
                            .trim()
                            .replace(/\[(\d+)\]/g, '.$1')
                            .replace(/\[['"]([^'"[\]]+)['"]\]/g, '.$1')
                            .replace(/^\.+|\.+$/g, '');
                    };
                    const resolveTemplateExpr = (stateObj, expr = '') => {
                        const path = normalizeTemplateExprPath(expr);
                        if (!path) return { exists: false, value: '' };
                        const segments = path.split('.').map(seg => seg.trim()).filter(Boolean);
                        if (segments.length === 0) return { exists: false, value: '' };
                        let current = stateObj;
                        for (const seg of segments) {
                            if (current === null || typeof current === 'undefined') {
                                return { exists: false, value: '' };
                            }
                            if (Array.isArray(current)) {
                                if (!/^\d+$/.test(seg)) return { exists: false, value: '' };
                                const index = Number(seg);
                                if (index < 0 || index >= current.length) return { exists: false, value: '' };
                                current = current[index];
                                continue;
                            }
                            if (typeof current === 'object' && Object.prototype.hasOwnProperty.call(current, seg)) {
                                current = current[seg];
                                continue;
                            }
                            return { exists: false, value: '' };
                        }
                        if (typeof current === 'undefined') return { exists: false, value: '' };
                        return { exists: true, value: current };
                    };
                    const extractTemplateExprList = (template = '') => {
                        const text = String(template || '');
                        if (!text) return [];
                        const unique = new Set();
                        const regex = /\{\{\s*([^{}]+?)\s*\}\}/g;
                        let match = regex.exec(text);
                        while (match) {
                            const expr = String(match[1] || '').trim();
                            if (expr) unique.add(expr);
                            match = regex.exec(text);
                        }
                        return Array.from(unique);
                    };
                    const renderMofoTemplatePreview = (template, stateObj = {}) => {
                        const rawTemplate = String(template ?? '').trim();
                        if (!rawTemplate) return { ok: false, html: '' };
                        const safeState = (stateObj && typeof stateObj === 'object' && !Array.isArray(stateObj))
                            ? stateObj
                            : {};
                        const rendered = (typeof mofoData?.renderTemplate === 'function')
                            ? mofoData.renderTemplate(rawTemplate, safeState)
                            : rawTemplate;
                        const safeHtml = sanitizePreviewHtml(rendered);
                        if (!String(safeHtml || '').trim()) return { ok: false, html: '' };
                        return { ok: true, html: safeHtml };
                    };
                    const scopeMofoCssText = (cssText = '', scopeSelector = '.mofo-runtime-view') => {
                        const source = String(cssText || '').replace(/<\/style/gi, '<\\/style');
                        if (!source.trim()) return '';
                        return source.replace(/(^|[{}])(\s*[^@{}][^{}]*?)\{/g, (_all, boundary, selectorGroup) => {
                            const scopedSelectors = String(selectorGroup || '')
                                .split(',')
                                .map((part) => {
                                    const selector = String(part || '').trim();
                                    if (!selector) return '';
                                    if (/^(from|to|\d+%)$/i.test(selector)) return selector;
                                    if (/^(html|body|:root)$/i.test(selector)) return scopeSelector;
                                    if (selector.startsWith(scopeSelector)) return selector;
                                    return `${scopeSelector} ${selector}`;
                                })
                                .filter(Boolean);
                            if (scopedSelectors.length === 0) return _all;
                            return `${boundary}${scopedSelectors.join(', ')}{`;
                        });
                    };

                    const buildWechatListHtml = () => {
                        let html = '<div class="inline-reply-section-title">插入回复标签</div>';
                        if (combinedList.length === 0) {
                            html += `
                                <div class="inline-reply-menu-item" id="open-phone-empty-btn" style="color: #ff9800; justify-content: center;">
                                    <span>⚠️</span>
                                    <span>通讯录为空，点击打开手机</span>
                                </div>
                            `;
                            return html;
                        }
                        combinedList.forEach(item => {
                            const avatarHtml = item.avatar
                                ? `<img src="${item.avatar}" class="inline-reply-avatar" alt="${escapeHtml(item.name)}">`
                                : `<span>${item.fallbackIcon}</span>`;
                            html += `
                                <div class="inline-reply-menu-item" data-name="${escapeHtml(item.name)}" data-chat-type="${item.chatType}">
                                    ${avatarHtml}
                                    <span class="inline-reply-name" title="${escapeHtml(item.name)}">${escapeHtml(item.name)}</span>
                                </div>
                            `;
                        });
                        return html;
                    };

                    const buildSmsListHtml = () => {
                        let html = '<div class="inline-reply-section-title">插入短信标签</div>';
                        if (smsConversations.length === 0) {
                            html += '<div class="inline-reply-section-title" style="border-bottom:0; padding-top:10px; font-weight:500;">暂无短信会话</div>';
                            return html;
                        }
                        smsConversations.forEach(conversation => {
                            const name = String(conversation?.name || '').trim();
                            html += `
                                <div class="inline-reply-menu-item phone-inline-reply-sms-item" data-sms-name="${escapeHtml(name)}">
                                    <i class="fa-solid fa-message" aria-hidden="true"></i>
                                    <span class="inline-reply-name" title="${escapeHtml(name)}">${escapeHtml(name)}</span>
                                </div>
                            `;
                        });
                        return html;
                    };

                    const getMofoById = (id) => mofoItems.find(item => String(item.id) === String(id)) || null;

                    const buildMofoListHtml = () => {
                        if (!Array.isArray(mofoItems) || mofoItems.length === 0) {
                            return `
                                <div style="font-size:11px; color:#5d78a4; line-height:1.6; border-radius:8px; padding:10px; background:rgba(255,255,255,0.26); border:1px dashed rgba(116,139,184,0.55);">
                                    还没有魔坊条目。点击上方“新建”创建。
                                </div>
                            `;
                        }
                        return mofoItems.map(item => `
                            <div class="mofo-entry" data-mofo-id="${escapeHtml(item.id)}">
                                <div class="mofo-entry-head">
                                    <div class="mofo-entry-name">${escapeHtml(item.name)}</div>
                                    <div style="display:inline-flex; align-items:center; gap:8px;">
                                        <label class="mofo-entry-toggle" title="勾选后为累计追加；取消勾选为替换当前状态">
                                            <input type="checkbox" class="mofo-update-mode-toggle" data-mofo-id="${escapeHtml(item.id)}" ${(item.updateMode || 'append') === 'replace' ? '' : 'checked'}>
                                            <span>累计</span>
                                        </label>
                                        <label class="mofo-entry-toggle" title="启用线下提示词注入">
                                        <input type="checkbox" class="mofo-offline-toggle" data-mofo-id="${escapeHtml(item.id)}" ${item.offlinePromptEnabled === false ? '' : 'checked'}>
                                        <span>线下</span>
                                    </label>
                                    </div>
                                </div>
                                <div style="display:flex; gap:6px; margin-top:6px;">
                                    <button type="button" class="mofo-inline-action-btn" data-mofo-action="edit" data-mofo-id="${escapeHtml(item.id)}" style="flex:1; border:1px solid rgba(116, 139, 184, 0.55); border-radius:8px; background:rgba(255,255,255,0.35); color:#284a76; font-size:11px; padding:6px 8px; cursor:pointer; font-weight:700;">编辑</button>
                                    <button type="button" class="mofo-inline-action-btn" data-mofo-action="clear-session" data-mofo-id="${escapeHtml(item.id)}" style="flex:1; border:1px solid rgba(83, 128, 201, 0.6); border-radius:8px; background:rgba(255,255,255,0.35); color:#2c5da8; font-size:11px; padding:6px 8px; cursor:pointer; font-weight:700;">清理本会话</button>
                                    <button type="button" class="mofo-inline-action-btn" data-mofo-action="delete-global" data-mofo-id="${escapeHtml(item.id)}" style="flex:1; border:1px solid rgba(188, 92, 117, 0.7); border-radius:8px; background:rgba(255,255,255,0.35); color:#a33c57; font-size:11px; padding:6px 8px; cursor:pointer; font-weight:700;">全局删除</button>
                                </div>
                            </div>
                        `).join('');
                    };

                    const buildMofoPageHtml = () => `
                        <div class="inline-reply-section-title">魔坊列表</div>
                        <div class="mofo-toolbar">
                            <button class="mofo-toolbar-btn" id="mofo-create-btn">新建</button>
                            <button class="mofo-toolbar-btn" id="mofo-refresh-btn">刷新</button>
                        </div>
                        <div id="mofo-list-wrap">${buildMofoListHtml()}</div>
                    `;

                    const buildMofoDetailHtml = (current) => {
                        if (!current) {
                            return `
                                <div id="mofo-detail-page">
                                    <div class="inline-reply-section-title" style="display:flex; align-items:center; justify-content:space-between; gap:6px;">
                                        <button type="button" id="mofo-detail-back-btn" style="border:1px solid rgba(116, 139, 184, 0.55); border-radius:7px; background:rgba(255,255,255,0.34); color:#264672; font-size:11px; padding:4px 8px; cursor:pointer;">← 返回</button>
                                        <span>魔坊详情</span>
                                        <span style="width:52px;"></span>
                                    </div>
                                    <div style="font-size:11px; color:#5d78a4; border-radius:10px; padding:10px; border:1px dashed rgba(116,139,184,0.55); background:rgba(255,255,255,0.24);">
                                        条目不存在或已删除。
                                    </div>
                                </div>
                            `;
                        }

                        const stateEntries = Object.entries(current.state || {});
                        const rows = stateEntries.length > 0
                            ? stateEntries.map(([k, v]) => `
                                <div class="mofo-kv-row">
                                    <span class="mofo-kv-key">${escapeHtml(k)}</span>
                                    <span class="mofo-kv-val" title="${escapeHtml(stringifyState(v))}">${escapeHtml(stringifyState(v))}</span>
                                </div>
                            `).join('')
                            : '<div style="font-size:11px; color:#5d78a4;">暂无抓取值</div>';
                        const scopeToken = String(current.id || current.tagName || current.name || 'mofo')
                            .trim()
                            .toLowerCase()
                            .replace(/[^a-z0-9_-]+/g, '-')
                            .replace(/^-+|-+$/g, '')
                            || 'mofo';
                        const safeCss = scopeMofoCssText(
                            current.cssText || '',
                            `#mofo-detail-page[data-mofo-scope="${scopeToken}"] .mofo-template-preview`
                        );
                        const htmlTemplate = String(current.htmlTemplate ?? current.templateHtml ?? current['html模板'] ?? '').trim();
                        const renderedTemplate = renderMofoTemplatePreview(htmlTemplate, current.state || {});
                        const previewBody = renderedTemplate.ok
                            ? `<div class="mofo-template-preview">${renderedTemplate.html}</div>`
                            : `<div class="mofo-preview-card">${rows}</div>`;

                        return `
                            <style>${safeCss}</style>
                            <div id="mofo-detail-page" data-mofo-scope="${escapeHtml(scopeToken)}">
                                <div class="inline-reply-section-title" style="display:flex; align-items:center; justify-content:space-between; gap:6px;">
                                    <button type="button" id="mofo-detail-back-btn" style="border:1px solid rgba(116, 139, 184, 0.55); border-radius:7px; background:rgba(255,255,255,0.34); color:#264672; font-size:11px; padding:4px 8px; cursor:pointer;">← 返回</button>
                                    <span>${escapeHtml(current.name || '魔坊详情')}</span>
                                    <span style="width:52px;"></span>
                                </div>
                                <div class="mofo-preview-wrap">
                                    <div class="mofo-preview-head">
                                        <span class="mofo-preview-title">${escapeHtml(current.name || '未命名')}</span>
                                        <span class="mofo-preview-tag">&lt;${escapeHtml(current.tagName || '')}&gt;</span>
                                    </div>
                                    <div style="font-size:10px; color:${current.offlinePromptEnabled === false ? '#9a6a76' : '#2f6a54'}; margin-bottom:6px;">
                                        线下提示词注入：${current.offlinePromptEnabled === false ? '未启用' : '已启用'}
                                    </div>
                                    ${previewBody}
                                    <div style="margin-top:7px; font-size:10px; color:#5876a4; line-height:1.5; white-space:pre-wrap; max-height:100px; overflow:auto;">${escapeHtml(current.promptTemplate || '未设置提示词模板')}</div>
                                    <div style="display:flex; gap:6px; margin-top:8px;">
                                        <button type="button" id="mofo-detail-edit-btn" style="flex:1; border:1px solid rgba(116, 139, 184, 0.55); border-radius:8px; background:rgba(255,255,255,0.35); color:#284a76; font-size:11px; padding:6px 8px; cursor:pointer; font-weight:700;">编辑</button>
                                        <button type="button" id="mofo-detail-clear-session-btn" style="flex:1; border:1px solid rgba(83, 128, 201, 0.6); border-radius:8px; background:rgba(255,255,255,0.35); color:#2c5da8; font-size:11px; padding:6px 8px; cursor:pointer; font-weight:700;">清理本会话</button>
                                        <button type="button" id="mofo-detail-delete-global-btn" style="flex:1; border:1px solid rgba(188, 92, 117, 0.7); border-radius:8px; background:rgba(255,255,255,0.35); color:#a33c57; font-size:11px; padding:6px 8px; cursor:pointer; font-weight:700;">全局删除</button>
                                    </div>
                                </div>
                            </div>
                        `;
                    };

                    const buildMofoEditorHtml = (current = null) => {
                        const oldName = String(current?.name || '').trim();
                        const oldTag = String(current?.tagName || current?.name || '').trim();
                        const oldCss = String(current?.cssText || '');
                        const oldHtmlTemplate = String(current?.htmlTemplate ?? current?.templateHtml ?? current?.['html模板'] ?? '');
                        const oldPrompt = String(current?.promptTemplate || '');
                        const oldOfflinePromptEnabled = current?.offlinePromptEnabled !== false;
                        const oldInitial = (() => {
                            try {
                                const source = current?.initialState;
                                if (!source || typeof source !== 'object' || Array.isArray(source)) return '';
                                if (Object.keys(source).length === 0) return '';
                                return JSON.stringify(source, null, 2);
                            } catch (e) { return ''; }
                        })();
                        const title = current ? '编辑魔坊' : '新建魔坊';
                        const saveText = current ? '保存' : '创建';

                        return `
                            <div class="inline-reply-section-title" style="display:flex; align-items:center; justify-content:space-between; gap:6px;">
                                <button type="button" class="mofo-editor-back-btn" style="border:1px solid rgba(116, 139, 184, 0.55); border-radius:7px; background:rgba(255,255,255,0.34); color:#264672; font-size:11px; padding:4px 8px; cursor:pointer;">← 返回</button>
                                <span>${escapeHtml(title)}</span>
                                <span style="width:52px;"></span>
                            </div>
                            <div class="mofo-editor-inline" style="display:grid; gap:7px; min-height:0;">
                                <label style="display:grid; gap:4px;">
                                    <span style="font-size:11px; color:#4d638a; font-weight:600;">名称</span>
                                    <input type="text" id="mofo-editor-name" maxlength="40" value="${escapeHtml(oldName)}" placeholder="输入魔坊名称" style="height:32px; border:1px solid #d7e2f4; border-radius:8px; padding:0 8px; font-size:12px; outline:none; color:#213454; background:#fbfdff;">
                                </label>
                                <label style="display:grid; gap:4px;">
                                    <span style="font-size:11px; color:#4d638a; font-weight:600;">标签</span>
                                    <input type="text" id="mofo-editor-tag" maxlength="40" value="${escapeHtml(oldTag)}" placeholder="对应 <标签></标签>" style="height:32px; border:1px solid #d7e2f4; border-radius:8px; padding:0 8px; font-size:12px; outline:none; color:#213454; background:#fbfdff;">
                                </label>
                                <label style="display:grid; gap:4px;">
                                    <span style="font-size:11px; color:#4d638a; font-weight:600;">CSS</span>
                                    <textarea id="mofo-editor-css" placeholder="输入用于展示卡片的样式（可留空）" style="min-height:60px; border:1px solid #d7e2f4; border-radius:8px; padding:8px; font-size:11px; line-height:1.45; outline:none; resize:vertical; color:#213454; background:#fbfdff;">${escapeHtml(oldCss)}</textarea>
                                </label>
                                <label style="display:grid; gap:4px;">
                                    <span style="font-size:11px; color:#4d638a; font-weight:600;">HTML 模板</span>
                                    <textarea id="mofo-editor-html-template" placeholder="可使用 {{key}} / {{a.b}} 变量；留空则按键值对显示" style="min-height:82px; border:1px solid #d7e2f4; border-radius:8px; padding:8px; font-size:11px; line-height:1.45; outline:none; resize:vertical; color:#213454; background:#fbfdff;">${escapeHtml(oldHtmlTemplate)}</textarea>
                                </label>
                                <label style="display:grid; gap:4px;">
                                    <span style="font-size:11px; color:#4d638a; font-weight:600;">初始值</span>
                                    <textarea id="mofo-editor-initial" placeholder="支持 JSON 或 key:value 多行" style="min-height:60px; border:1px solid #d7e2f4; border-radius:8px; padding:8px; font-size:11px; line-height:1.45; outline:none; resize:vertical; color:#213454; background:#fbfdff;">${escapeHtml(oldInitial)}</textarea>
                                </label>
                                <label style="display:grid; gap:4px;">
                                    <span style="font-size:11px; color:#4d638a; font-weight:600;">提示词模板</span>
                                    <textarea id="mofo-editor-prompt" placeholder="建议约束 AI 只输出对应标签内容" style="min-height:72px; border:1px solid #d7e2f4; border-radius:8px; padding:8px; font-size:11px; line-height:1.45; outline:none; resize:vertical; color:#213454; background:#fbfdff;">${escapeHtml(oldPrompt)}</textarea>
                                </label>
                                <label style="display:flex; align-items:center; gap:8px; font-size:12px; color:#35527f; background:#f6f9ff; border:1px solid #dbe5f7; border-radius:8px; padding:8px 10px;">
                                    <input type="checkbox" id="mofo-editor-offline-enabled" ${oldOfflinePromptEnabled ? 'checked' : ''} style="accent-color:#4f7fd5;">
                                    <span>启用该条目线下提示词注入（{{MOFO_PROMPT}}）</span>
                                </label>
                                <div style="display:flex; gap:6px; padding-top:2px;">
                                    <button type="button" id="mofo-editor-cancel-btn" style="flex:1; border:1px solid rgba(116, 139, 184, 0.55); border-radius:8px; background:rgba(255,255,255,0.34); color:#264672; font-size:11px; padding:7px 8px; cursor:pointer; font-weight:700;">返回</button>
                                    <button type="button" id="mofo-editor-save-btn" style="flex:1; border:1px solid rgba(89, 121, 187, 0.75); border-radius:8px; background:rgba(146, 178, 238, 0.35); color:#1d3f6b; font-size:11px; padding:7px 8px; cursor:pointer; font-weight:700;">${escapeHtml(saveText)}</button>
                                </div>
                            </div>
                        `;
                    };

                    menu.innerHTML = `
                        <div class="inline-reply-tabbar">
                            <button class="inline-reply-tab-btn is-active" data-tab-target="wechat">微信</button>
                            <button class="inline-reply-tab-btn" data-tab-target="sms">短信</button>
                            <button class="inline-reply-tab-btn" data-tab-target="mofo">魔坊</button>
                        </div>
                        <div class="inline-reply-page is-active" data-tab-page="wechat">${buildWechatListHtml()}</div>
                        <div class="inline-reply-page" data-tab-page="sms">${buildSmsListHtml()}</div>
                        <div class="inline-reply-page" data-tab-page="mofo">
                            <div id="mofo-page-root"></div>
                        </div>
                    `;
                    document.body.appendChild(menu);

                    const positionMenuCentered = () => {
                        const vv = window.visualViewport;
                        const viewWidth = vv?.width || window.innerWidth;
                        const viewHeight = vv?.height || window.innerHeight;
                        const offsetLeft = vv?.offsetLeft || 0;
                        const offsetTop = vv?.offsetTop || 0;

                        menu.style.left = `${offsetLeft + (viewWidth / 2)}px`;
                        menu.style.top = `${offsetTop + (viewHeight / 2)}px`;
                        menu.style.bottom = 'auto';
                        menu.style.transform = 'translate(-50%, -50%)';
                    };

                    const positioningController = new AbortController();
                    const repositionMenu = () => {
                        if (!menu.isConnected) {
                            positioningController.abort();
                            return;
                        }
                        positionMenuCentered();
                    };
                    positionMenuCentered();

                    window.addEventListener('resize', repositionMenu, { passive: true, signal: positioningController.signal });
                    if (window.visualViewport) {
                        window.visualViewport.addEventListener('resize', repositionMenu, { passive: true, signal: positioningController.signal });
                        window.visualViewport.addEventListener('scroll', repositionMenu, { passive: true, signal: positioningController.signal });
                    }

                    let mofoEditorMode = 'list';
                    let mofoEditingId = '';
                    let mofoEditorReturnMode = 'list';

                    const closeMenuSafely = () => {
                        positioningController.abort();
                        if (menu.isConnected) {
                            menu.remove();
                        }
                    };
                    menu._stPhoneDispose = closeMenuSafely;

                    const openMofoStandalonePreview = async (itemInput) => {
                        if (!itemInput) return;
                        const syncedItem = await syncMofoItemFromCurrentChat(itemInput);
                        const item = JSON.parse(JSON.stringify(syncedItem || itemInput));

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

                        const stringifyValue = stStringifyState;

                        const toScopeToken = (value, fallback = 'item') => {
                            const raw = String(value || '').trim().toLowerCase();
                            const normalized = raw
                                .replace(/[^a-z0-9_-]+/g, '-')
                                .replace(/-+/g, '-')
                                .replace(/^-+|-+$/g, '')
                                .slice(0, 48);
                            if (normalized) return normalized;
                            const fb = String(fallback || '').trim().toLowerCase()
                                .replace(/[^a-z0-9_-]+/g, '-')
                                .replace(/-+/g, '-')
                                .replace(/^-+|-+$/g, '')
                                .slice(0, 48);
                            return fb || 'item';
                        };
                        const scopeToken = toScopeToken(item.tagName || item.name || item.id, item.id || 'item');
                        const scopeSelector = `#mofo-standalone-preview-root[data-mofo-scope="${scopeToken}"] .mofo-runtime-view`;
                        const safeCss = scopeMofoCssText(item.cssText || '', scopeSelector);
                        const htmlTemplate = String(item?.htmlTemplate ?? item?.templateHtml ?? item?.['html模板'] ?? '').trim();
                        const buildStateRowHtml = (key, value) => {
                            return `
                                <div class="mofo-kv-row" data-mofo-key="${escapeHtml(key)}">
                                    <span class="mofo-kv-key">${escapeHtml(key)}</span>
                                    <span class="mofo-kv-val" title="${escapeHtml(stringifyValue(value))}">${escapeHtml(stringifyValue(value))}</span>
                                    <button type="button" class="mofo-delete-trigger" data-mofo-action="delete-key" data-mofo-key="${escapeHtml(key)}" data-mofo-delete-mode="key" aria-label="delete"></button>
                                </div>
                            `;
                        };
                        const buildStateRowsHtml = (stateObj = {}) => {
                            const entries = Object.entries(stateObj || {});
                            if (entries.length === 0) {
                                return '<div class="mofo-runtime-empty">暂无抓取值</div>';
                            }
                            return entries.map(([k, v]) => buildStateRowHtml(k, v)).join('');
                        };
                        const buildRuntimePreviewBodyHtml = (stateObj = {}) => {
                            const normalizedState = (stateObj && typeof stateObj === 'object' && !Array.isArray(stateObj))
                                ? stateObj
                                : {};
                            const renderedTemplate = renderMofoTemplatePreview(htmlTemplate, normalizedState);
                            if (renderedTemplate.ok) {
                                return `<div class="mofo-template-preview">${renderedTemplate.html}</div>`;
                            }
                            return `<div class="mofo-preview-card" id="mofo-preview-card">${buildStateRowsHtml(normalizedState)}</div>`;
                        };
                        const runtimeStateHtml = buildRuntimePreviewBodyHtml(item.state || {});

                        const runtimeBaseStyle = `
                            #mofo-standalone-preview-root{
                                --mofo-overlay-bg:transparent;
                            }
                            #mofo-standalone-preview-root .mofo-runtime-backdrop{position:fixed; inset:0; background:var(--mofo-overlay-bg);}
                            #mofo-standalone-preview-root .mofo-runtime-pop{
                                position:fixed;
                                left:50%;
                                top:50%;
                                transform:translate(-50%, -50%);
                                width:var(--mofo-preview-width, auto);
                                height:var(--mofo-preview-height, auto);
                                min-width:var(--mofo-preview-min-width, 0);
                                max-width:min(94vw, var(--mofo-preview-max-width, 94vw));
                                max-height:calc(100dvh - var(--mofo-preview-safe-margin, 0px));
                                overflow:auto;
                                touch-action:pan-x pan-y;
                                overscroll-behavior:contain;
                                box-sizing:border-box;
                            }
                            #mofo-standalone-preview-root .mofo-runtime-view{display:block; box-sizing:border-box;}
                            #mofo-standalone-preview-root .mofo-delete-trigger{
                                display:none;
                                border:0;
                                background:transparent;
                                padding:0;
                            }
                        `;

                        const oldRoot = hostDoc.getElementById('mofo-standalone-preview-root');
                        oldRoot?.remove();

                        const root = hostDoc.createElement('div');
                        root.id = 'mofo-standalone-preview-root';
                        root.style.cssText = [
                            'position:fixed',
                            'inset:0',
                            'z-index:2147483647',
                            'pointer-events:auto',
                            'touch-action:pan-x pan-y'
                        ].join(';');
                        root.style.setProperty('position', 'fixed', 'important');
                        root.style.setProperty('inset', '0', 'important');
                        root.style.setProperty('z-index', '2147483647', 'important');
                        root.style.setProperty('pointer-events', 'auto', 'important');
                        root.style.setProperty('isolation', 'isolate', 'important');
                        root.classList.add(`mofo-scope-${scopeToken}`);
                        root.setAttribute('data-mofo-id', String(item.id || ''));
                        root.setAttribute('data-mofo-name', String(item.name || ''));
                        root.setAttribute('data-mofo-tag', String(item.tagName || ''));
                        root.setAttribute('data-mofo-scope', scopeToken);

                        root.innerHTML = `
                            <style>${runtimeBaseStyle}${safeCss}</style>
                            <div id="mofo-standalone-preview-backdrop" class="mofo-runtime-backdrop"></div>
                            <div id="mofo-standalone-preview-pop" class="mofo-runtime-pop">
                                <div class="mofo-runtime-view" data-mofo-id="${escapeHtml(item.id || '')}" data-mofo-name="${escapeHtml(item.name || '')}" data-mofo-tag="${escapeHtml(item.tagName || '')}" data-mofo-scope="${escapeHtml(scopeToken)}">
                                    ${runtimeStateHtml}
                                </div>
                            </div>
                        `;

                        const pop = root.querySelector('#mofo-standalone-preview-pop');
                        const backdrop = root.querySelector('#mofo-standalone-preview-backdrop');
                        const positionController = new AbortController();
                        const positionPop = () => {
                            if (!pop?.isConnected) {
                                positionController.abort();
                                return;
                            }
                            const vv = hostDoc.defaultView?.visualViewport;
                            const viewWidth = vv?.width || hostDoc.defaultView?.innerWidth || window.innerWidth;
                            const viewHeight = vv?.height || hostDoc.defaultView?.innerHeight || window.innerHeight;
                            const offsetLeft = vv?.offsetLeft || 0;
                            const offsetTop = vv?.offsetTop || 0;
                            const rootStyle = hostDoc.defaultView?.getComputedStyle(root);
                            const safeMargin = Math.max(0, Number.parseFloat(rootStyle?.getPropertyValue('--mofo-preview-safe-margin')) || 10);
                            const fitMinWidth = Math.max(0, Number.parseFloat(rootStyle?.getPropertyValue('--mofo-fit-min-width')) || 160);
                            const fitMinHeight = Math.max(0, Number.parseFloat(rootStyle?.getPropertyValue('--mofo-fit-min-height')) || 160);
                            pop.style.maxWidth = `${Math.max(fitMinWidth, viewWidth - (safeMargin * 2))}px`;
                            pop.style.maxHeight = `${Math.max(fitMinHeight, viewHeight - (safeMargin * 2))}px`;
                            pop.style.left = `${offsetLeft + (viewWidth / 2)}px`;
                            pop.style.top = `${offsetTop + (viewHeight / 2)}px`;
                            pop.style.transform = 'translate(-50%, -50%)';

                            const rect = pop.getBoundingClientRect();
                            if (rect.height > (viewHeight - (safeMargin * 2))) {
                                pop.style.top = `${offsetTop + safeMargin}px`;
                                pop.style.transform = 'translate(-50%, 0)';
                            }
                        };

                        const onEsc = (e) => {
                            if (e.key === 'Escape') {
                                e.preventDefault();
                                close();
                            }
                        };
                        hostDoc.defaultView?.addEventListener('resize', positionPop, { passive: true, signal: positionController.signal });
                        hostDoc.defaultView?.addEventListener('keydown', onEsc, { signal: positionController.signal });
                        if (hostDoc.defaultView?.visualViewport) {
                            hostDoc.defaultView.visualViewport.addEventListener('resize', positionPop, { passive: true, signal: positionController.signal });
                            hostDoc.defaultView.visualViewport.addEventListener('scroll', positionPop, { passive: true, signal: positionController.signal });
                        }

                        const close = () => {
                            positionController.abort();
                            root.remove();
                        };
                        const shouldCloseOnOutside = () => {
                            try {
                                const raw = String(hostDoc.defaultView?.getComputedStyle(root)?.getPropertyValue('--mofo-close-on-outside') || '')
                                    .trim()
                                    .toLowerCase();
                                if (!raw) return true;
                                return !['0', 'false', 'off', 'no', 'disabled'].includes(raw);
                            } catch (e) {
                                return true;
                            }
                        };
                        const closeByOutside = (e) => {
                            if (!shouldCloseOnOutside()) return;
                            const target = e?.target;
                            if (!target) return;
                            if (target === root || target === backdrop || target === pop || !pop?.contains(target)) {
                                close();
                            }
                        };
                        const closeByDocOutside = (e) => {
                            if (!shouldCloseOnOutside()) return;
                            const target = e?.target;
                            if (!target) return;
                            if (pop?.contains(target)) return;
                            close();
                        };
                        const persistMofoState = (nextState) => {
                            const normalizedState = (nextState && typeof nextState === 'object' && !Array.isArray(nextState))
                                ? JSON.parse(JSON.stringify(nextState))
                                : {};
                            item.state = normalizedState;
                            if (item.id && mofoData?.updateItem) {
                                mofoData.updateItem(item.id, { state: normalizedState });
                            }
                        };
                        const rerenderRuntimeView = () => {
                            const view = root.querySelector('.mofo-runtime-view');
                            if (!view) return;
                            view.innerHTML = buildRuntimePreviewBodyHtml(item.state || {});
                        };
                        root.addEventListener('click', (e) => {
                            const trigger = e.target?.closest?.('[data-mofo-action]');
                            if (!trigger) return;
                            const action = String(trigger.getAttribute('data-mofo-action') || '').trim();
                            if (action !== 'delete-key') return;
                            e.stopPropagation();
                            e.preventDefault();
                            const rowHost = trigger.closest?.('[data-mofo-key]');
                            const key = String(
                                trigger.getAttribute('data-mofo-key')
                                || trigger.getAttribute('data-mofo-target-key')
                                || rowHost?.getAttribute?.('data-mofo-key')
                                || ''
                            ).trim();
                            if (!key) return;
                            const currentState = (item.state && typeof item.state === 'object' && !Array.isArray(item.state))
                                ? JSON.parse(JSON.stringify(item.state))
                                : {};
                            if (!Object.prototype.hasOwnProperty.call(currentState, key)) return;
                            const deleteMode = String(trigger.getAttribute('data-mofo-delete-mode') || 'auto').trim().toLowerCase();
                            const explicitGroup = String(
                                trigger.getAttribute('data-mofo-group')
                                || trigger.getAttribute('data-mofo-prefix')
                                || ''
                            ).trim();
                            const groupToken = explicitGroup;
                            const shouldDeleteGroup = (
                                deleteMode === 'group'
                                || (deleteMode === 'auto' && !!explicitGroup)
                            );

                            if (shouldDeleteGroup) {
                                const prefixes = [];
                                if (groupToken) {
                                    prefixes.push(`${groupToken}_`, groupToken);
                                } else {
                                    prefixes.push(key);
                                }
                                Object.keys(currentState).forEach((stateKey) => {
                                    if (prefixes.some(prefix => stateKey === prefix || stateKey.startsWith(prefix))) {
                                        delete currentState[stateKey];
                                    }
                                });
                            } else {
                                delete currentState[key];
                            }
                            persistMofoState(currentState);
                            rerenderRuntimeView();
                        });
                        root.addEventListener('pointerdown', closeByOutside, true);
                        root.addEventListener('mousedown', closeByOutside, true);
                        root.addEventListener('touchstart', closeByOutside, { passive: true, capture: true });
                        backdrop?.addEventListener('click', closeByOutside);
                        hostDoc.addEventListener('pointerdown', closeByDocOutside, { capture: true, signal: positionController.signal });
                        hostDoc.addEventListener('mousedown', closeByDocOutside, { capture: true, signal: positionController.signal });
                        hostDoc.addEventListener('touchstart', closeByDocOutside, { passive: true, capture: true, signal: positionController.signal });
                        (hostDoc.body || hostDoc.documentElement).appendChild(root);
                        positionPop();
                    };

                    const getEditingMofo = () => mofoItems.find(item => String(item.id) === String(mofoEditingId)) || null;
                    const closeMofoEditor = () => {
                        mofoEditorMode = 'list';
                        mofoEditingId = '';
                        mofoEditorReturnMode = 'list';
                    };

                    const readMofoEditorDraft = () => {
                        const nameInput = menu.querySelector('#mofo-editor-name');
                        const tagInput = menu.querySelector('#mofo-editor-tag');
                        const cssInput = menu.querySelector('#mofo-editor-css');
                        const htmlTemplateInput = menu.querySelector('#mofo-editor-html-template');
                        const initialInput = menu.querySelector('#mofo-editor-initial');
                        const promptInput = menu.querySelector('#mofo-editor-prompt');
                        const offlineEnabledInput = menu.querySelector('#mofo-editor-offline-enabled');

                        return {
                            name: String(nameInput?.value || '').trim(),
                            tagName: String(tagInput?.value || '').trim(),
                            cssText: String(cssInput?.value || ''),
                            htmlTemplate: String(htmlTemplateInput?.value || ''),
                            initialStateRaw: String(initialInput?.value || ''),
                            promptTemplate: String(promptInput?.value || ''),
                            offlinePromptEnabled: !!offlineEnabledInput?.checked
                        };
                    };
                    const getCanonicalJson = (value) => {
                        try {
                            return JSON.stringify(value ?? {});
                        } catch (e) {
                            return '';
                        }
                    };
                    const parseInitialDraftToState = (rawText = '') => {
                        const text = String(rawText ?? '');
                        try {
                            if (typeof mofoData?._parseStatePayload === 'function') {
                                const parsed = mofoData._parseStatePayload(text, {});
                                if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
                                return {};
                            }
                        } catch (e) {}
                        const trimmed = text.trim();
                        if (!trimmed) return {};
                        try {
                            const parsed = JSON.parse(trimmed);
                            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
                        } catch (e) {}
                        return {};
                    };
                    const isInitialDraftChanged = (currentItem, draft) => {
                        if (!currentItem || !draft || !Object.prototype.hasOwnProperty.call(draft, 'initialStateRaw')) {
                            return false;
                        }
                        const currentInitial = (currentItem.initialState && typeof currentItem.initialState === 'object' && !Array.isArray(currentItem.initialState))
                            ? currentItem.initialState
                            : {};
                        const nextInitial = parseInitialDraftToState(draft.initialStateRaw);
                        return getCanonicalJson(currentInitial) !== getCanonicalJson(nextInitial);
                    };
                    const isHtmlTemplateDraftChanged = (currentItem, draft) => {
                        if (!currentItem || !draft || !Object.prototype.hasOwnProperty.call(draft, 'htmlTemplate')) {
                            return false;
                        }
                        const currentTemplate = String(currentItem.htmlTemplate ?? currentItem.templateHtml ?? currentItem['html模板'] ?? '');
                        return currentTemplate !== String(draft.htmlTemplate ?? '');
                    };

                    const focusMofoEditorName = () => {
                        const nameInput = menu.querySelector('#mofo-editor-name');
                        if (!nameInput) return;
                        nameInput.focus();
                        nameInput.setSelectionRange?.(nameInput.value.length, nameInput.value.length);
                    };

                    const renderMofoPane = () => {
                        const mofoPageRoot = menu.querySelector('#mofo-page-root');
                        if (!mofoPageRoot) return;

                        if (mofoEditorMode === 'create') {
                            mofoPageRoot.innerHTML = buildMofoEditorHtml(null);
                        } else if (mofoEditorMode === 'detail') {
                            const current = getEditingMofo();
                            if (!current) {
                                closeMofoEditor();
                                mofoPageRoot.innerHTML = buildMofoPageHtml();
                            } else {
                                mofoPageRoot.innerHTML = buildMofoDetailHtml(current);
                            }
                        } else if (mofoEditorMode === 'edit') {
                            const current = getEditingMofo();
                            if (!current) {
                                closeMofoEditor();
                                mofoPageRoot.innerHTML = buildMofoPageHtml();
                            } else {
                                mofoPageRoot.innerHTML = buildMofoEditorHtml(current);
                            }
                        } else {
                            mofoPageRoot.innerHTML = buildMofoPageHtml();
                        }

                        bindMofoEvents();
                        positionMenuCentered();
                    };

                    const rerenderMofoPane = ({ keepEditor = true } = {}) => {
                        mofoItems = (typeof mofoData?.getItems === 'function') ? mofoData.getItems() : [];
                        if (mofoItems.length === 0) activeMofoId = '';
                        if (!keepEditor) {
                            closeMofoEditor();
                        } else if ((mofoEditorMode === 'edit' || mofoEditorMode === 'detail') && !getEditingMofo()) {
                            closeMofoEditor();
                        }
                        renderMofoPane();
                    };

                    const bindWechatEvents = () => {
                        const emptyBtn = menu.querySelector('#open-phone-empty-btn');
                        emptyBtn?.addEventListener('click', (ev) => {
                            ev.stopPropagation();
                            ev.preventDefault();
                            closeMenuSafely();
                            const phoneIcon = document.getElementById('phoneDrawerIcon');
                            if (phoneIcon) {
                                phoneIcon.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
                            }
                        });

                        menu.querySelectorAll('.inline-reply-menu-item[data-name]').forEach(el => {
                            el.addEventListener('click', (ev) => {
                                ev.stopPropagation();
                                ev.preventDefault();
                                const name = String(el.dataset.name || '').trim();
                                if (!name) return;
                                const chatTypeLine = el.dataset.chatType === 'group' ? 'type:group\n' : '';
                                const currentDateTime = formatWechatInlineReplyDateTime();
                                const wechatUserName = getInlineReplyWechatUserName();
                                const tagPrefix = `\n<wechat><!--\n---${wechatUserName}---\n接收人：${name}\n${chatTypeLine}date:${currentDateTime}\n`;
                                const tagStr = `${tagPrefix}\n--></wechat>\n`;
                                const cursorPos = tagPrefix.length;
                                insertTextToSendTextarea(tagStr, cursorPos);
                                closeMenuSafely();
                            });
                        });
                    };

                    const bindSmsEvents = () => {
                        menu.querySelectorAll('.phone-inline-reply-sms-item[data-sms-name]').forEach(el => {
                            el.addEventListener('click', (ev) => {
                                ev.stopPropagation();
                                ev.preventDefault();
                                const name = String(el.dataset.smsName || '').trim();
                                if (!name) return;
                                const tagPrefix = `\n<短信>\n[${name}]\n内容：`;
                                const tagStr = `${tagPrefix}\n发送时间：${formatSmsInlineReplyDateTime()}\n\n</短信>\n`;
                                insertTextToSendTextarea(tagStr, tagPrefix.length);
                                closeMenuSafely();
                            });
                        });
                    };

                    const bindMofoEvents = () => {
                        if (menu.querySelector('#mofo-detail-page')) {
                            menu.querySelector('#mofo-detail-back-btn')?.addEventListener('click', (e) => {
                                e.stopPropagation();
                                e.preventDefault();
                                mofoEditorMode = 'list';
                                mofoEditingId = '';
                                mofoEditorReturnMode = 'list';
                                renderMofoPane();
                            });
                            menu.querySelector('#mofo-detail-edit-btn')?.addEventListener('click', (e) => {
                                e.stopPropagation();
                                e.preventDefault();
                                if (!mofoEditingId) return;
                                mofoEditorMode = 'edit';
                                mofoEditorReturnMode = 'detail';
                                renderMofoPane();
                            });
                            menu.querySelector('#mofo-detail-clear-session-btn')?.addEventListener('click', (e) => {
                                e.stopPropagation();
                                e.preventDefault();
                                const current = getEditingMofo();
                                if (!current) return;
                                const ok = confirm(`清理魔坊「${current.name}」在当前会话的数据？\n条目会保留。`);
                                if (!ok) return;
                                mofoData.clearItemSessionData(current.id);
                                rerenderMofoPane({ keepEditor: true });
                            });
                            menu.querySelector('#mofo-detail-delete-global-btn')?.addEventListener('click', (e) => {
                                e.stopPropagation();
                                e.preventDefault();
                                const current = getEditingMofo();
                                if (!current) return;
                                const ok = confirm(`全局删除魔坊「${current.name}」？\n会删除条目定义，并清理各会话里的对应运行态数据。`);
                                if (!ok) return;
                                mofoData.removeItem(current.id);
                                rerenderMofoPane({ keepEditor: false });
                            });
                            return;
                        }

                        if (menu.querySelector('.mofo-editor-inline')) {
                            const backToPrev = (ev) => {
                                ev?.stopPropagation?.();
                                ev?.preventDefault?.();
                                if (mofoEditorReturnMode === 'detail' && getEditingMofo()) {
                                    mofoEditorMode = 'detail';
                                } else {
                                    mofoEditorMode = 'list';
                                    mofoEditingId = '';
                                }
                                mofoEditorReturnMode = 'list';
                                renderMofoPane();
                            };

                            menu.querySelector('.mofo-editor-back-btn')?.addEventListener('click', backToPrev);
                            menu.querySelector('#mofo-editor-cancel-btn')?.addEventListener('click', backToPrev);
                            menu.querySelector('#mofo-editor-save-btn')?.addEventListener('click', () => {
                                const draft = readMofoEditorDraft();
                                if (!draft.name) {
                                    alert('名称不能为空');
                                    return;
                                }
                                try {
                                    if (mofoEditorMode === 'edit') {
                                        const targetId = String(mofoEditingId || '').trim();
                                        if (!targetId) return;
                                        const currentItem = getEditingMofo();
                                        if (!isInitialDraftChanged(currentItem, draft)) {
                                            delete draft.initialStateRaw;
                                        }
                                        if (!isHtmlTemplateDraftChanged(currentItem, draft)) {
                                            delete draft.htmlTemplate;
                                        }
                                        mofoData.updateItem(targetId, draft);
                                        activeMofoId = targetId;
                                        mofoEditorMode = mofoEditorReturnMode === 'detail' ? 'detail' : 'list';
                                        mofoEditorReturnMode = 'list';
                                    } else {
                                        const created = mofoData.createItem(draft);
                                        activeMofoId = created?.id || activeMofoId;
                                        mofoEditorMode = 'list';
                                        mofoEditingId = '';
                                        mofoEditorReturnMode = 'list';
                                    }
                                    rerenderMofoPane({ keepEditor: true });
                                } catch (err) {
                                    alert(err?.message || '保存失败');
                                }
                            });
                            focusMofoEditorName();
                            return;
                        }

                        menu.querySelectorAll('.mofo-entry[data-mofo-id]').forEach(entry => {
                            entry.addEventListener('click', () => {
                                const id = String(entry.getAttribute('data-mofo-id') || '').trim();
                                if (!id) return;
                                const current = getMofoById(id);
                                if (!current) return;
                                closeMenuSafely();
                                openMofoStandalonePreview(current);
                            });
                        });
                        menu.querySelectorAll('.mofo-offline-toggle[data-mofo-id]').forEach(input => {
                            input.addEventListener('click', (e) => e.stopPropagation());
                            input.addEventListener('change', (e) => {
                                e.stopPropagation();
                                const id = String(input.getAttribute('data-mofo-id') || '').trim();
                                if (!id) return;
                                mofoData.updateItem(id, { offlinePromptEnabled: !!input.checked });
                                rerenderMofoPane();
                            });
                        });
                        menu.querySelectorAll('.mofo-update-mode-toggle[data-mofo-id]').forEach(input => {
                            input.addEventListener('click', (e) => e.stopPropagation());
                            input.addEventListener('change', (e) => {
                                e.stopPropagation();
                                const id = String(input.getAttribute('data-mofo-id') || '').trim();
                                if (!id) return;
                                mofoData.updateItem(id, { updateMode: input.checked ? 'append' : 'replace' });
                                rerenderMofoPane();
                            });
                        });
                        menu.querySelectorAll('.mofo-entry-toggle').forEach(label => {
                            label.addEventListener('click', (e) => e.stopPropagation());
                        });

                        menu.querySelector('#mofo-refresh-btn')?.addEventListener('click', () => {
                            rerenderMofoPane();
                        });

                        menu.querySelector('#mofo-create-btn')?.addEventListener('click', () => {
                            mofoEditorMode = 'create';
                            mofoEditingId = '';
                            mofoEditorReturnMode = 'list';
                            renderMofoPane();
                        });
                        menu.querySelectorAll('.mofo-inline-action-btn[data-mofo-action][data-mofo-id]').forEach(btn => {
                            btn.addEventListener('click', (e) => {
                                e.stopPropagation();
                                e.preventDefault();
                                const action = String(btn.getAttribute('data-mofo-action') || '').trim();
                                const id = String(btn.getAttribute('data-mofo-id') || '').trim();
                                if (!action || !id) return;

                                const current = getMofoById(id);
                                if (!current) return;
                                activeMofoId = id;

                                if (action === 'edit') {
                                    mofoEditorMode = 'edit';
                                    mofoEditingId = id;
                                    mofoEditorReturnMode = 'list';
                                    renderMofoPane();
                                    return;
                                }

                                if (action === 'clear-session') {
                                    const ok = confirm(`清理魔坊「${current.name}」在当前会话的数据？\n条目会保留。`);
                                    if (!ok) return;
                                    mofoData.clearItemSessionData(id);
                                    rerenderMofoPane();
                                    return;
                                }

                                if (action === 'delete-global' || action === 'delete') {
                                    const ok = confirm(`全局删除魔坊「${current.name}」？\n会删除条目定义，并清理各会话里的对应运行态数据。`);
                                    if (!ok) return;
                                    mofoData.removeItem(id);
                                    rerenderMofoPane();
                                    return;
                                }

                            });
                        });
                    };

                    const switchTab = (tabName = 'wechat') => {
                        menu.querySelectorAll('.inline-reply-tab-btn[data-tab-target]').forEach(btn => {
                            btn.classList.toggle('is-active', btn.dataset.tabTarget === tabName);
                        });
                        menu.querySelectorAll('.inline-reply-page[data-tab-page]').forEach(page => {
                            page.classList.toggle('is-active', page.dataset.tabPage === tabName);
                        });
                        positionMenuCentered();
                    };

                    menu.querySelectorAll('.inline-reply-tab-btn[data-tab-target]').forEach(btn => {
                        btn.addEventListener('click', (ev) => {
                            ev.stopPropagation();
                            ev.preventDefault();
                            switchTab(String(btn.dataset.tabTarget || 'wechat'));
                        });
                    });

                    bindWechatEvents();
                    bindSmsEvents();
                    rerenderMofoPane({ keepEditor: false });
                    switchTab('wechat');

                    // 🔥 核心修复3：解决移动端 300ms 点击延迟导致的“幽灵秒关”问题
                    setTimeout(() => {
                        const closeMenu = (ev) => {
                            if (!menu.contains(ev.target)) {
                                closeMenuSafely();
                                document.removeEventListener('mousedown', closeMenu);
                                document.removeEventListener('touchstart', closeMenu);
                            }
                        };
                        document.addEventListener('mousedown', closeMenu);
                        document.addEventListener('touchstart', closeMenu, { passive: true });
                    }, 50);

                } catch (e) {
                    console.error('📱 [手机插件] 快捷回复执行异常:', e);
                }
            };

            // 🔥 核心修复1：酒馆底栏有滑动拦截，统一使用 click，并阻止 touchstart 被滑动组件劫持
            btn.addEventListener('click', handleAction);
            btn.addEventListener('touchstart', (e) => {
                e.stopPropagation(); // 阻止事件冒泡给酒馆的横向滑动条
            }, { passive: false });

            let wrapper = document.createElement('div');
            wrapper.id = qrScriptContainerId;
            wrapper.className = 'st-phone-inline-reply-wrapper qr--buttons qr--color';
            wrapper.dataset.stPhoneInlineReply = 'true';
            wrapper.classList.toggle('st-phone-inline-reply-qr-managed', shouldHideInlineReplyForQr);
            btn.classList.toggle('st-phone-inline-reply-qr-managed', shouldHideInlineReplyForQr);
            wrapper.dataset.stPhoneQrProxyBound = 'true';
            wrapper.addEventListener('click', (event) => {
                if (event.target?.closest?.(`#${btnId}`)) return;
                event.preventDefault();
                event.stopPropagation();
                wrapper.querySelector(`#${btnId}`)?.click?.();
            });
            if (!isQrAssistantEnabled) {
                wrapper.classList.remove('qrq-hidden-by-plugin');
            }
            wrapper.style.setProperty('--qr--color', 'rgba(0,0,0,0)');
            wrapper.appendChild(btn);

            const rocketButton = document.getElementById('quick-reply-rocket-button');
            if (rocketButton && rocketButton.parentElement === host) {
                rocketButton.insertAdjacentElement('afterend', wrapper);
            } else {
                host.prepend(wrapper); // 插入到可见容器最左侧
            }
            if (hasQrAssistantApi) {
                applyQrWhitelist();
            }
            return true;   // [v2.27.0] 本轮完成注入 —— 告知轮询可停
        };

        // [v2.27.0] 登记制 + 自停：旧写法 `setInterval(inject, 1000)` 是**永久**每秒轮询，
        //   即使按钮已注入、宿主已就位也照跑（inject 内含 13 处 getElementById +
        //   36 处 querySelector + registerQrAssistantButton 全量重算）。改为：
        //   ① 轮询由登记层持有（可被 dispose/cancelByTag 回收，不再无限累积）；
        //   ② 一旦本轮确认「按钮已存在且宿主正确」（inject 返回 true），即停止轮询
        //      —— 后续由 phone:openApp / DOM 重建等事件按需重新拉起（见 scheduleInlineReplySync）。
        //   这保留了「容器晚于脚本出现时持续重试」的原意图，但把稳态成本从 1Hz 降到 0。
        const injectLoop = () => {
            let done = false;
            try { done = inject() === true; } catch (e) { done = false; }
            if (done) globalRuntime.cancelByTag('inline-reply:poll');
        };
        globalRuntime.cancelByTag('inline-reply:poll');
        globalRuntime.addInterval(injectLoop, 1000, 'inline-reply:poll');
        injectLoop();
        // [v2.27.0] 自停后需能重新拉起：宿主容器可能随面板关闭/主题切换被重建，
        //   届时按钮虽在但已脱离正确宿主。监听面板可见性事件重新调度一轮（幂等）。
        if (onceFlag('stPhoneInlineReplyResync')) {
            const resync = () => { try { createInlineReplyButton(); } catch (e) {} };
            globalRuntime.addListener(window, PHONE_EVENTS.PANEL_VISIBILITY, resync, false, 'inline-reply:resync');
            globalRuntime.addListener(window, PHONE_EVENTS.OPEN_APP, resync, false, 'inline-reply:resync');
        }
    }
