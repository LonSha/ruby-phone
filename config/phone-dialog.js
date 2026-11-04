/* ============================================================
 * config/phone-dialog.js — 手机壳内统一弹窗组件 [U2]
 * ------------------------------------------------------------
 * 替代原生 window.alert / window.confirm / window.prompt：
 * · 挂在手机壳内，不冲出虚拟屏幕，不阻塞主线程
 * · 支持纯文本与结构化标题/内容
 * · 统一 Promise 接口：showPhoneAlert / showPhoneConfirm / showPhonePrompt
 * · 自动探测宿主挂载点（优先 active app root -> phone-view-current -> body）
 * · 安全兜底：无 DOM / 无头环境自动降级（fail-closed），可注入 stub 用于测试
 * ============================================================ */
'use strict';

/**
 * 逃逸 HTML 避免 XSS
 * @param {string} str
 * @returns {string}
 */
export function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '"')
        .replace(/'/g, '&#39;');
}

/**
 * 探测最合适的弹窗挂载根节点
 * @param {HTMLElement|null} preferredHost
 * @returns {HTMLElement|null}
 */
export function resolveDialogHost(preferredHost = null) {
    if (preferredHost && preferredHost.nodeType === 1) return preferredHost;
    if (typeof document === 'undefined' || !document || typeof document.querySelector !== 'function') return null;
    return (
        document.querySelector('.phone-view-current .settings-app') ||
        document.querySelector('.phone-view-current .yzp-calendar-app') ||
        document.querySelector('.phone-view-current .yzp-diary-app') ||
        document.querySelector('.phone-view-current') ||
        document.querySelector('.phone-body-panel') ||
        document.querySelector('#phone-screen') ||
        document.querySelector('.phone-container') ||
        document.body ||
        null
    );
}

/**
 * 通用弹窗核心渲染函数
 * @param {object} options
 * @param {string} options.title 标题
 * @param {string} options.message 内容文本
 * @param {string} [options.type='alert'] 'alert' | 'confirm' | 'prompt'
 * @param {string} [options.confirmText='确定'] 确认按钮文本
 * @param {string} [options.cancelText='取消'] 取消按钮文本（alert 下为空）
 * @param {boolean} [options.danger=false] 确认按钮是否为危险色
 * @param {string} [options.defaultValue=''] prompt 初始输入值
 * @param {string} [options.placeholder=''] prompt 占位符
 * @param {HTMLElement|null} [options.host=null] 挂载宿主
 * @param {boolean} [options.assumeConfirm=false] 测试/桩专用自动放行标志
 * @returns {Promise<boolean|string|null>}
 */
export function showPhoneDialog(options = {}) {
    const {
        title = '',
        message = '',
        type = 'alert',
        confirmText = '确定',
        cancelText = type === 'alert' ? '' : '取消',
        danger = false,
        defaultValue = '',
        placeholder = '',
        host: preferredHost = null,
        assumeConfirm = false
    } = options;

    return new Promise((resolve) => {
        // 无 DOM 环境（测试桩 / node 运行环境）
        if (typeof document === 'undefined') {
            if (type === 'confirm') {
                return resolve(assumeConfirm === true);
            }
            if (type === 'prompt') {
                return resolve(assumeConfirm ? String(defaultValue || '') : null);
            }
            return resolve(true);
        }

        const host = resolveDialogHost(preferredHost);
        if (!host) {
            // 没有可挂载的 DOM 节点，fail-closed
            return resolve(type === 'prompt' ? null : (type === 'confirm' ? false : true));
        }

        // 清理已有弹窗，保证单例
        host.querySelector?.('#rp-dialog-overlay')?.remove();

        if (host !== document.body && window.getComputedStyle(host).position === 'static') {
            host.style.position = 'relative';
        }

        const overlay = document.createElement('div');
        overlay.id = 'rp-dialog-overlay';
        overlay.style.cssText = [
            'position:absolute',
            'inset:0',
            'z-index:var(--rp-z-modal, 10040)',
            'display:flex',
            'align-items:center',
            'justify-content:center',
            'padding:16px',
            'box-sizing:border-box',
            'background:rgba(0,0,0,0.38)',
            'backdrop-filter:blur(8px)',
            '-webkit-backdrop-filter:blur(8px)'
        ].join(';');

        const hasCancel = String(cancelText || '').trim() !== '';
        const isPrompt = type === 'prompt';
        const safeTitle = escapeHtml(title);
        const safeMsg = escapeHtml(message);
        const safeConfirmText = escapeHtml(confirmText || '确定');
        const safeCancelText = escapeHtml(cancelText || '取消');
        const safePlaceholder = escapeHtml(placeholder);
        const safeDefault = escapeHtml(defaultValue);

        const promptInputHtml = isPrompt ? `
            <div style="padding:4px 16px 12px;">
                <input type="text" id="rp-dialog-prompt-input" value="${safeDefault}" placeholder="${safePlaceholder}"
                    style="width:100%; box-sizing:border-box; padding:8px 10px; border:1px solid var(--rp-slate-300, #cbd5e1); border-radius:6px; font-size:13px; outline:none; background:rgba(255,255,255,0.95); color:#1e293b;" />
            </div>
        ` : '';

        const actionColor = danger ? '#d93025' : '#007aff';

        overlay.innerHTML = `
            <div role="dialog" aria-modal="true" style="width:100%; max-width:272px; background:rgba(255,255,255,0.96); color:#0f172a; border-radius:14px; overflow:hidden; box-shadow:0 16px 36px rgba(0,0,0,0.28); font-family:-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
                <div style="padding:18px 16px 10px; text-align:center;">
                    ${safeTitle ? `<div style="font-size:15px; font-weight:700; line-height:1.35; color:#0f172a; margin-bottom:6px;">${safeTitle}</div>` : ''}
                    ${safeMsg ? `<div style="font-size:12px; color:var(--rp-slate-600, #475569); line-height:1.55; white-space:pre-wrap; word-break:break-word;">${safeMsg}</div>` : ''}
                </div>
                ${promptInputHtml}
                <div style="display:grid; grid-template-columns:${hasCancel ? '1fr 1fr' : '1fr'}; border-top:1px solid rgba(0,0,0,0.08);">
                    ${hasCancel ? `<button type="button" data-action="cancel" style="height:42px; border:none; border-right:1px solid rgba(0,0,0,0.08); background:transparent; color:var(--rp-slate-700, #334155); font-size:14px; cursor:pointer;">${safeCancelText}</button>` : ''}
                    <button type="button" data-action="confirm" style="height:42px; border:none; background:transparent; color:${actionColor}; font-size:14px; font-weight:700; cursor:pointer;">${safeConfirmText}</button>
                </div>
            </div>
        `;

        const close = (val) => {
            overlay.remove();
            resolve(val);
        };

        const confirmBtn = overlay.querySelector('[data-action="confirm"]');
        const cancelBtn = overlay.querySelector('[data-action="cancel"]');
        const inputEl = overlay.querySelector('#rp-dialog-prompt-input');

        if (confirmBtn) {
            confirmBtn.addEventListener('click', () => {
                if (isPrompt) {
                    close(inputEl ? inputEl.value : '');
                } else if (type === 'confirm') {
                    close(true);
                } else {
                    close(true);
                }
            });
        }

        if (cancelBtn) {
            cancelBtn.addEventListener('click', () => {
                close(isPrompt ? null : false);
            });
        }

        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) {
                close(isPrompt ? null : (type === 'confirm' ? false : true));
            }
        });

        // Prompt input Enter 回车快速提交
        if (inputEl) {
            inputEl.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    close(inputEl.value);
                } else if (e.key === 'Escape') {
                    e.preventDefault();
                    close(null);
                }
            });
        }

        host.appendChild(overlay);

        if (inputEl) {
            setTimeout(() => {
                try { inputEl.focus(); inputEl.select(); } catch (_e) {}
            }, 50);
        }
    });
}

/**
 * 手机壳内友好提示（替代原生 alert）
 * @param {string} message 提示信息
 * @param {object} [opts] 可选配置（title, host, confirmText）
 * @returns {Promise<boolean>}
 */
export function showPhoneAlert(message, opts = {}) {
    const o = (typeof opts === 'string') ? { title: opts } : (opts || {});
    return showPhoneDialog({
        type: 'alert',
        title: o.title || '提示',
        message: String(message || ''),
        confirmText: o.confirmText || '确定',
        host: o.host || null,
        assumeConfirm: o.assumeConfirm
    });
}

/**
 * 手机壳内确认弹窗（替代原生 confirm）
 * @param {string|object} messageOrOpts
 * @param {object} [opts]
 * @returns {Promise<boolean>}
 */
export function showPhoneConfirm(messageOrOpts, opts = {}) {
    let finalOpts = {};
    if (typeof messageOrOpts === 'string') {
        finalOpts = { ...opts, message: messageOrOpts };
    } else if (messageOrOpts && typeof messageOrOpts === 'object') {
        finalOpts = { ...messageOrOpts };
    }
    return showPhoneDialog({
        type: 'confirm',
        title: finalOpts.title || '确认操作',
        message: String(finalOpts.message || ''),
        confirmText: finalOpts.confirmText || '确定',
        cancelText: finalOpts.cancelText || '取消',
        danger: !!finalOpts.danger,
        host: finalOpts.host || null,
        assumeConfirm: finalOpts.assumeConfirm
    });
}

/**
 * 手机壳内输入提示弹窗（替代原生 prompt）
 * @param {string} message
 * @param {string} [defaultValue='']
 * @param {object} [opts]
 * @returns {Promise<string|null>}
 */
export function showPhonePrompt(message, defaultValue = '', opts = {}) {
    return showPhoneDialog({
        type: 'prompt',
        title: opts.title || '输入',
        message: String(message || ''),
        defaultValue: String(defaultValue || ''),
        placeholder: opts.placeholder || '',
        confirmText: opts.confirmText || '确定',
        cancelText: opts.cancelText || '取消',
        host: opts.host || null,
        assumeConfirm: opts.assumeConfirm
    });
}
