/**
 * 未读角标单口径 —— 唯一桥（v4.157.0 · R22-O9）
 *
 * 纪律：角标数一律从 chat-read-cursor 的唯一出口算，本桥只做汇总与上限展示。
 * 宿主给每会话的 unread（来自阅读游标），本桥只求和 + 封顶显示（99+）。
 * App 层不许自己数。
 */
import { numOrNull } from './num-gate.js';

export const BADGE_LIMITS = Object.freeze({ cap: 99 });
const BADGE_FACES = Object.freeze(['none', 'count', 'capped']);

export function badgeOf(perChat) {
    const arr = Array.isArray(perChat) ? perChat : [];
    let total = 0;
    for (const c of arr) {
        if (!c || typeof c !== 'object') continue;
        const n = numOrNull(c.unread);
        if (n != null && n > 0) total += Math.floor(n);
    }
    if (total <= 0) return { face: 'none', total: 0, label: '' };
    if (total > BADGE_LIMITS.cap) return { face: 'capped', total, label: BADGE_LIMITS.cap + '+' };
    return { face: 'count', total, label: String(total) };
}

function badgeNote(r) {
    const face = r && r.face;
    if (face === 'none') return '没有未读';
    return `${r.total} 条未读`;
}

export function unreadBadgeSelfCheck() {
    const bad = [];
    if (badgeOf([]).face !== 'none') bad.push('空应 none');
    if (badgeOf([{ unread: 0 }]).face !== 'none') bad.push('全零应 none');
    if (badgeOf([{ unread: 3 }, { unread: 2 }]).total !== 5) bad.push('求和对');
    const capped = badgeOf([{ unread: 60 }, { unread: 50 }]);
    if (capped.face !== 'capped' || capped.label !== '99+') bad.push('封顶错');
    if (badgeOf([{ unread: null }]).face !== 'none') bad.push('null 不计应 none');
    return { ok: bad.length === 0, bad };
}
