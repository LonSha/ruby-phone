/**
 * 剪贴板跨 App —— 唯一桥（v4.157.0 · R22-X8）
 *
 * 纪律：本桥只判「这段文本此刻能不能粘贴到那个 App」（门控），不写存储。
 * 暂存内容与写盘归宿主；桥返一个门控判决与候选文案。同一段剧情窗内才可跨。
 */
import { numOrNull } from './num-gate.js';

const CLIPBOARD_FACES = Object.freeze(['empty', 'fresh', 'expired', 'foreign']);
export const CLIPBOARD_LIMITS = Object.freeze({ maxChars: 4000, ttlMs: 30 * 60 * 1000 });

export function clipboardState(clip, nowMs) {
    if (!clip || typeof clip !== 'object') return { face: 'empty' };
    const text = String(clip.text == null ? '' : clip.text);
    if (!text) return { face: 'empty' };
    const at = numOrNull(clip.at);
    const now = numOrNull(nowMs);
    const truncated = text.length > CLIPBOARD_LIMITS.maxChars;
    const body = truncated ? text.slice(0, CLIPBOARD_LIMITS.maxChars) : text;
    if (at == null || now == null) return { face: 'fresh', text: body, truncated, srcApp: String(clip.srcApp || ''), stale: true };
    const age = now - at;
    const expired = age > CLIPBOARD_LIMITS.ttlMs || age < 0;
    return { face: expired ? 'expired' : 'fresh', text: body, truncated, srcApp: String(clip.srcApp || ''), ageMs: age };
}

export function canPaste(state, targetApp) {
    if (!state || state.face === 'empty') return { ok: false, face: 'empty', why: '剪贴板是空的' };
    if (state.face === 'expired') return { ok: false, face: 'expired', why: '这段内容已过期，请重新复制' };
    const target = String(targetApp == null ? '' : targetApp).trim();
    if (!target) return { ok: false, face: 'foreign', why: '不知道该粘到哪' };
    return { ok: true, face: 'fresh', text: state.text, truncated: !!state.truncated, srcApp: state.srcApp };
}

export function clipboardNote(r) {
    const face = r && r.face;
    if (face === 'empty') return '剪贴板是空的';
    if (face === 'expired') return '那段内容已经过期了';
    if (r && r.truncated) return '这段内容太长，已截断到 4000 字';
    return '可以粘贴';
}

export function clipboardSelfCheck() {
    const bad = [];
    if (clipboardState(null, 0).face !== 'empty') bad.push('空剪贴板错');
    const fresh = clipboardState({ text: 'hi', at: 1000, srcApp: 'a' }, 2000);
    if (fresh.face !== 'fresh') bad.push('新鲜态错');
    const exp = clipboardState({ text: 'hi', at: 0 }, CLIPBOARD_LIMITS.ttlMs + 1);
    if (exp.face !== 'expired') bad.push('过期态错');
    const old = clipboardState({ text: 'hi', at: 5000 }, 1000);
    if (old.face !== 'expired') bad.push('时钟倒走应过期而非新鲜');
    const long = clipboardState({ text: 'x'.repeat(5000), at: 1 }, 2);
    if (!long.truncated || long.text.length !== CLIPBOARD_LIMITS.maxChars) bad.push('截断错');
    if (canPaste({ face: 'empty' }, 'b').ok) bad.push('空剪贴板不该能粘');
    if (!canPaste({ face: 'fresh', text: 't' }, 'b').ok) bad.push('新鲜态应能粘');
    if (canPaste({ face: 'fresh', text: 't' }, '').ok) bad.push('无目标不该能粘');
    return { ok: bad.length === 0, bad };
}
