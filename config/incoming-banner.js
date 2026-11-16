/**
 * 通知横幅 —— 唯一桥（v4.157.0 · R22-O8）
 *
 * 文案唯一实现：横幅的标题/正文/图标/动作由本桥一处给全，App 只声明内容不各自拼 DOM。
 * 纯函数零 IO，不碰 DOM，不写存储。
 */
export const BANNER_FACES = Object.freeze(['none', 'banner']);

export function bannerOf(spec) {
    if (!spec || typeof spec !== 'object') return { face: 'none', banner: null };
    const title = String(spec.title == null ? '' : spec.title).trim();
    const body = String(spec.body == null ? '' : spec.body).trim();
    if (!title && !body) return { face: 'none', banner: null };
    const appId = String(spec.appId == null ? '' : spec.appId).trim();
    const icon = String(spec.icon == null ? '' : spec.icon).trim() || '🔔';
    return {
        face: 'banner',
        banner: {
            appId,
            icon,
            title: title || appId || '通知',
            body,
            action: String(spec.action == null ? '' : spec.action).trim()
        }
    };
}

export function bannerNote(r) {
    return (r && r.face === 'banner') ? r.banner.title : '没有要显示的通知';
}

export function bannerSelfCheck() {
    const bad = [];
    if (bannerOf(null).face !== 'none') bad.push('空规格应 none');
    if (bannerOf({ title: '', body: '' }).face !== 'none') bad.push('空标题正文应 none');
    const r = bannerOf({ appId: 'wechat', title: '新消息', body: '在吗', icon: '💬' });
    if (r.face !== 'banner') bad.push('有内容应 banner');
    if (r.banner.title !== '新消息' || r.banner.icon !== '💬') bad.push('字段透传错');
    const noIcon = bannerOf({ title: 'T' });
    if (noIcon.banner.icon !== '🔔') bad.push('缺图标应回默认');
    return { ok: bad.length === 0, bad };
}
