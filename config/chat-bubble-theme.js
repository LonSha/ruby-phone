/**
 * 消息气泡主题 —— 唯一桥（v4.157.0 · R22-X7）
 *
 * 纪律：只算「这套主题下的颜色/边框/圆角」形状，不碰 DOM。宿主拿 projections 去画。
 * 主题闭集，未知名回退 default 并如实标 fallback。
 */
export const BUBBLE_THEME_FACES = Object.freeze(['default', 'applied', 'fallback']);
export const BUBBLE_THEMES = Object.freeze({
    default: { self: '#95ec69', other: '#ffffff', radius: 8, border: 'none' },
    dark: { self: '#3a7bd5', other: '#2b2b2b', radius: 8, border: 'none' },
    pastel: { self: '#ffd6e0', other: '#e8f4ff', radius: 14, border: 'none' },
    retro: { self: '#ffe08a', other: '#f5f5dc', radius: 4, border: '1px solid #c0b080' }
});

export function bubbleTheme(id) {
    const key = String(id == null ? '' : id).trim();
    if (!key || key === 'default') return { face: 'default', id: 'default', style: BUBBLE_THEMES.default };
    if (Object.prototype.hasOwnProperty.call(BUBBLE_THEMES, key)) {
        return { face: 'applied', id: key, style: BUBBLE_THEMES[key] };
    }
    return { face: 'fallback', id: 'default', requested: key, style: BUBBLE_THEMES.default };
}

export function bubbleThemeNote(r) {
    const face = r && r.face;
    if (face === 'default') return '默认气泡';
    if (face === 'applied') return `已应用主题：${r.id}`;
    return `没有「${r.requested}」这套主题，已回退默认`;
}

export function bubbleThemeSelfCheck() {
    const bad = [];
    if (bubbleTheme('default').face !== 'default') bad.push('默认态错');
    if (bubbleTheme('dark').face !== 'applied') bad.push('已知主题应 applied');
    const fb = bubbleTheme('nope');
    if (fb.face !== 'fallback' || fb.id !== 'default') bad.push('未知主题应 fallback 到 default');
    if (bubbleTheme(null).face !== 'default') bad.push('null 应 default');
    const st = bubbleTheme('dark').style;
    if (st.self !== BUBBLE_THEMES.dark.self) bad.push('样式未透传');
    return { ok: bad.length === 0, bad };
}
