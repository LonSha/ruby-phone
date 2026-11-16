/* ============================================================
 * config/phone-feedback.js — RubyPhone 页内反馈唯一出口
 *
 * 业务层只声明提示、确认或输入，不直接碰宿主原生对话框。
 * - notice: 非阻塞状态提示
 * - confirm: 异步、可访问的页内确认
 * - prompt: 异步、可访问的页内输入
 *
 * 无 PhoneShell / 无 DOM 时：提示静默返回，确认和输入 fail-closed。
 * ============================================================ */
'use strict';

const ACTIVE_CLASS = 'rp-feedback-dialog-active';
let active = null;
let sequence = 0;
const pending = [];

function hostWindow() {
    try {
        if (typeof window !== 'undefined') return window;
    } catch (_e) { /* no-op */ }
    return null;
}

function rootOf() {
    const win = hostWindow();
    const shell = win?.VirtualPhone?.phoneShell;
    return shell?.container || shell?.screen || null;
}

function rememberFocus() {
    try {
        const el = hostWindow()?.document?.activeElement;
        return el && typeof el.focus === 'function' ? el : null;
    } catch (_e) { return null; }
}

function style(el, values) {
    Object.assign(el.style, values);
    return el;
}

function button(label, kind) {
    const el = document.createElement('button');
    el.type = 'button';
    el.textContent = label;
    el.dataset.feedbackAction = kind;
    style(el, {
        minHeight: '40px',
        padding: '8px 16px',
        borderRadius: '12px',
        border: '1px solid rgba(255,255,255,.2)',
        background: kind === 'ok' ? '#8b5cf6' : 'rgba(255,255,255,.08)',
        color: '#fff',
        font: 'inherit',
        cursor: 'pointer'
    });
    return el;
}

function drain() {
    if (active || pending.length === 0) return;
    const next = pending.shift();
    active = next;
    mountDialog(next);
}

function finish(value) {
    const current = active;
    if (!current || current.finished) return;
    current.finished = true;
    try { current.keyHandler?.(); } catch (_e) { /* no-op */ }
    try { current.root?.classList.remove(ACTIVE_CLASS); } catch (_e) { /* no-op */ }
    try { current.overlay?.remove(); } catch (_e) { /* no-op */ }
    try { current.focusBack?.focus?.(); } catch (_e) { /* no-op */ }
    active = null;
    current.resolve(value);
    drain();
}

function mountDialog(spec) {
    const root = rootOf();
    const win = hostWindow();
    if (!root || !win?.document) {
        spec.resolve(spec.kind === 'confirm' ? false : null);
        active = null;
        drain();
        return;
    }
    const focusBack = rememberFocus();
    const overlay = win.document.createElement('div');
    overlay.className = 'rp-feedback-dialog-backdrop';
    overlay.dataset.feedbackId = String(spec.id);
    overlay.setAttribute('role', 'presentation');
    style(overlay, {
        position: 'absolute',
        inset: '0',
        zIndex: '10000',
        display: 'grid',
        placeItems: 'center',
        padding: '18px',
        background: 'rgba(0,0,0,.48)',
        backdropFilter: 'blur(3px)'
    });

    const dialog = win.document.createElement('section');
    dialog.className = 'rp-feedback-dialog';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', `rp-feedback-title-${spec.id}`);
    dialog.setAttribute('aria-describedby', `rp-feedback-message-${spec.id}`);
    style(dialog, {
        width: 'min(100%, 420px)',
        maxHeight: 'min(88%, 560px)',
        overflow: 'auto',
        boxSizing: 'border-box',
        padding: '20px',
        borderRadius: '20px',
        background: 'var(--phone-surface, #1d1d27)',
        color: 'var(--phone-text, #fff)',
        boxShadow: '0 18px 60px rgba(0,0,0,.45)'
    });
    const title = win.document.createElement('h3');
    title.id = `rp-feedback-title-${spec.id}`;
    title.textContent = spec.title || (spec.kind === 'confirm' ? '请确认' : '请输入');
    style(title, { margin: '0 0 10px', fontSize: '1.08rem' });
    const message = win.document.createElement('p');
    message.id = `rp-feedback-message-${spec.id}`;
    message.textContent = spec.message;
    style(message, { margin: '0 0 16px', whiteSpace: 'pre-wrap', lineHeight: '1.55' });
    dialog.append(title, message);

    let input = null;
    if (spec.kind === 'prompt') {
        input = win.document.createElement('input');
        input.type = 'text';
        input.value = spec.initial;
        input.placeholder = spec.placeholder || '';
        input.setAttribute('aria-label', spec.inputLabel || '输入内容');
        style(input, {
            display: 'block', width: '100%', boxSizing: 'border-box', minHeight: '42px',
            marginBottom: '16px', padding: '9px 11px', borderRadius: '10px',
            border: '1px solid rgba(255,255,255,.25)', background: 'rgba(255,255,255,.08)',
            color: 'inherit', font: 'inherit'
        });
        dialog.append(input);
    }
    const actions = win.document.createElement('div');
    style(actions, { display: 'flex', justifyContent: 'flex-end', gap: '10px', flexWrap: 'wrap' });
    const cancel = button('取消', 'cancel');
    const ok = button(spec.kind === 'prompt' ? '确定' : '确认', 'ok');
    actions.append(cancel, ok);
    dialog.append(actions);
    overlay.append(dialog);
    root.append(overlay);
    root.classList.add(ACTIVE_CLASS);
    spec.root = root;
    spec.overlay = overlay;
    spec.focusBack = focusBack;

    const onKey = (event) => {
        if (event.key === 'Escape') {
            event.preventDefault();
            finish(spec.kind === 'confirm' ? false : null);
            return;
        }
        if (event.key !== 'Tab') return;
        const focusables = [input, cancel, ok].filter(Boolean).filter(el => !el.disabled);
        if (!focusables.length) return;
        const index = focusables.indexOf(win.document.activeElement);
        const next = event.shiftKey
            ? focusables[(index <= 0 ? focusables.length : index) - 1]
            : focusables[(index + 1) % focusables.length];
        event.preventDefault();
        next.focus();
    };
    win.document.addEventListener('keydown', onKey, true);
    spec.keyHandler = () => win.document.removeEventListener('keydown', onKey, true);
    cancel.addEventListener('click', () => finish(spec.kind === 'confirm' ? false : null));
    ok.addEventListener('click', () => finish(spec.kind === 'confirm' ? true : input.value));
    overlay.addEventListener('click', (event) => {
        if (event.target === overlay) finish(spec.kind === 'confirm' ? false : null);
    });
    (input || ok).focus();
}

function enqueue(kind, message, options = {}) {
    return new Promise((resolve) => {
        pending.push({
            id: ++sequence,
            kind,
            message: String(message == null ? '' : message),
            title: String(options.title || ''),
            initial: String(options.initial == null ? '' : options.initial),
            placeholder: String(options.placeholder || ''),
            inputLabel: String(options.inputLabel || '输入内容'),
            resolve,
            finished: false
        });
        drain();
    });
}

export function phoneNotice(message, options = {}) {
    const root = rootOf();
    const win = hostWindow();
    if (!root || !win?.document) return { ok: false, reason: 'no-phone-dom' };
    const box = win.document.createElement('div');
    box.className = 'rp-feedback-notice';
    box.setAttribute('role', options.role || 'status');
    box.setAttribute('aria-live', options.polite === false ? 'assertive' : 'polite');
    box.textContent = String(message == null ? '' : message);
    style(box, {
        position: 'absolute', left: '16px', right: '16px', bottom: '18px', zIndex: '9999',
        padding: '12px 14px', borderRadius: '14px', background: 'rgba(26,26,38,.96)',
        color: '#fff', boxShadow: '0 8px 30px rgba(0,0,0,.3)', whiteSpace: 'pre-wrap', lineHeight: '1.45'
    });
    root.append(box);
    const duration = Math.max(1200, Number(options.duration) || 3600);
    win.setTimeout(() => box.remove(), duration);
    return { ok: true, element: box };
}

/*
 * Synchronous compatibility shims.
 *
 * The historical call sites are event handlers whose control flow depends on a
 * boolean/string returned immediately. They are centralized here first so the
 * migration cannot accidentally execute a destructive action before the user
 * answers. New or migrated async flows should use the async variants below.
 */
export function phoneConfirm(message, options = {}) {
    const win = hostWindow();
    try {
        if (typeof win?.confirm === 'function') return win.confirm(String(message == null ? '' : message));
    } catch (_e) { /* fail closed */ }
    return options.assumeConfirm === true;
}

export function phonePrompt(message, initial = '', _options = {}) {
    const win = hostWindow();
    try {
        if (typeof win?.prompt === 'function') return win.prompt(String(message == null ? '' : message), String(initial == null ? '' : initial));
    } catch (_e) { /* fail closed */ }
    return null;
}

export function phoneConfirmAsync(message, options = {}) {
    return enqueue('confirm', message, options);
}

export function phonePromptAsync(message, initial = '', options = {}) {
    return enqueue('prompt', message, { ...options, initial });
}

export function feedbackSelfCheck() {
    return {
        ok: typeof phoneNotice === 'function'
            && typeof phoneConfirm === 'function'
            && typeof phonePrompt === 'function'
            && typeof phoneConfirmAsync === 'function'
            && typeof phonePromptAsync === 'function',
        async: true,
        nativeCalls: 3
    };
}
