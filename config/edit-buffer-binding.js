import { editBufferKey } from './edit-buffer.js';

// R14-O4 live editor adapter; the original single-buffer protocol remains compatible.
import { captureSessionToken, guardSessionWrite } from './session-gate.js';
import { writeReceiptAsync } from './write-receipt.js';
const writeQueues = new WeakMap();

/** One session-scoped app key, separate source/field targets. No timers or global
 * listeners. Restore requires a visible choice, never overwrites saved content.
 * Preserve raw long text rather than applying the legacy 2000-character limit.
 */
export function bindEditBuffer(storage, appId, target, input) {
    if (!input || !storage || !target) return null;
    const token = captureSessionToken(storage);
    const key = editBufferKey(appId);
    if (!key || !token.id) return null;
    const previous = input._rubyEditBuffer;
    if (previous?.key === key && previous.target === target
        && previous.token.id === token.id && previous.token.epoch === token.epoch) return previous;
    previous?.dispose?.();
    const read = () => {
        try {
            const raw = storage.get(key, '');
            const book = typeof raw === 'string' ? JSON.parse(raw || '{}') : raw;
            if (book?.schema !== 2 || book.chatId !== token.id || !book.entries
                || typeof book.entries !== 'object' || Array.isArray(book.entries)) return {};
            return book.entries;
        } catch (_e) { return {}; }
    };
    const doc = input.ownerDocument;
    const status = doc.createElement('span');
    status.setAttribute('role', 'status');
    status.className = 'ruby-edit-buffer-status';
    input.insertAdjacentElement('afterend', status);
    let revision = 0;
    const current = () => guardSessionWrite(storage, token, 'edit-buffer:' + appId);
    const store = (mutate) => {
        let queues = writeQueues.get(storage);
        if (!queues) { queues = new Map(); writeQueues.set(storage, queues); }
        const previous = queues.get(key) || Promise.resolve();
        const task = previous.catch(() => false).then(async () => {
            if (!current()) return false;
            const entries = { ...read() };
            if (mutate(entries) === false) return false;
            const value = JSON.stringify({ schema: 2, chatId: token.id, entries });
            const r = await writeReceiptAsync(storage, key, value);
            if (r.saved !== true || !current()) return false;
            try { return storage.get(key, null) === value; } catch (_e) { return false; }
        });
        queues.set(key, task);
        task.finally(() => { if (queues.get(key) === task) queues.delete(key); });
        return task;
    };
    const capture = async () => {
        if (!current()) return false;
        const rev = ++revision;
        const text = input.value;
        let caret = null;
        try {
            const pos = input.selectionStart;
            if (Number.isInteger(pos) && pos >= 0) caret = pos;
        } catch (_e) { /* Input types such as time do not expose selectionStart. */ }
        status.textContent = '正在保留未提交文字…';
        const saved = await store((entries) => {
            if (text === '') delete entries[target];
            else Object.defineProperty(entries, target, { value: { text, caret },
                enumerable: true, configurable: true, writable: true });
        });
        if (rev === revision && current()) status.textContent = saved
            ? '草稿已写入当前会话，持久保存尚未确认' : '草稿保留未确认，请勿关闭；文字仍在输入框';
        return saved;
    };
    const entries = read();
    const entry = Object.hasOwn(entries, target) ? entries[target] : null;
    if (entry && typeof entry.text === 'string' && entry.text !== input.value) {
        const initialValue = input.value;
        const restore = doc.createElement('button');
        restore.type = 'button';
        restore.textContent = '恢复未提交文字';
        restore.addEventListener('click', () => {
            if (!current()) return;
            const latest = read();
            if (input.value !== initialValue || revision !== 0
                || !Object.hasOwn(latest, target) || latest[target]?.text !== entry.text) {
                restore.remove();
                return;
            }
            input.value = entry.text;
            if (typeof entry.caret === 'number') {
                try { input.setSelectionRange?.(entry.caret, entry.caret); } catch (_e) { /* Unsupported input type. */ }
            }
            input.dispatchEvent(new doc.defaultView.Event('input', { bubbles: true }));
            restore.remove();
        });
        status.appendChild(restore);
    }
    const onInput = capture;
    input.addEventListener('input', onInput);
    const binding = { key, target, token, capture,
        dispose() {
            input.removeEventListener?.('input', onInput);
            status.remove?.();
            if (input._rubyEditBuffer === binding) delete input._rubyEditBuffer;
        },
        // Positive owner receipt, and only the text actually submitted may retire.
        async settle(receipt, submittedText) {
            if (receipt?.saved !== true || !current()) return false;
            const rev = ++revision;
            const saved = await store((entries) => {
                if (!Object.hasOwn(entries, target) || entries[target]?.text !== submittedText) return false;
                delete entries[target];
            });
            if (saved && rev === revision && current()) status.textContent = '';
            return saved;
        }
    };
    input._rubyEditBuffer = binding;
    return binding;
}
