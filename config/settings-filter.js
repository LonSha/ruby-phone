/**
 * 设置页即时过滤 —— 唯一桥（v4.157.0 · R22-O2）
 *
 * 纪律：纯函数，只算「哪些分区/条目匹配查询」，不碰 DOM、不新建设置索引。
 * 分区带 title + items（每个 item 带 label/keywords）。空查询全显；无命中如实 noMatch。
 */
export const SETTINGS_FILTER_FACES = Object.freeze(['empty', 'all', 'results', 'noMatch']);

export function filterSettings(sections, query) {
    const list = Array.isArray(sections) ? sections.filter((s) => s && typeof s === 'object') : [];
    const q = String(query == null ? '' : query).trim().toLowerCase();
    if (list.length === 0) return { face: 'empty', sections: [], matched: 0 };
    if (!q) return { face: 'all', sections: list.slice(), matched: countItems(list) };
    const out = [];
    let matched = 0;
    for (const s of list) {
        const title = String(s.title == null ? '' : s.title);
        const items = Array.isArray(s.items) ? s.items : [];
        const titleHit = title.toLowerCase().indexOf(q) >= 0;
        const hitItems = items.filter((it) => {
            if (!it || typeof it !== 'object') return false;
            const hay = (String(it.label == null ? '' : it.label) + ' ' + String(it.keywords == null ? '' : it.keywords)).toLowerCase();
            return hay.indexOf(q) >= 0;
        });
        if (titleHit || hitItems.length) {
            matched += hitItems.length;
            out.push({ section: s, titleHit, items: titleHit ? items : hitItems });
        }
    }
    if (out.length === 0) return { face: 'noMatch', sections: [], matched: 0, query: q };
    return { face: 'results', sections: out, matched, query: q };
}

function countItems(list) {
    let n = 0;
    for (const s of list) if (Array.isArray(s.items)) n += s.items.length;
    return n;
}

export function settingsFilterNote(r) {
    const face = r && r.face;
    if (face === 'empty') return '还没有设置项';
    if (face === 'all') return `${r.matched} 项设置`;
    if (face === 'noMatch') return `没有匹配「${r.query}」的设置项`;
    return `找到 ${r.matched} 项设置`;
}

export function settingsFilterSelfCheck() {
    const bad = [];
    const sections = [
        { title: '常规', items: [{ label: '角色名称' }, { label: '主题颜色' }] },
        { title: 'API', items: [{ label: '接口地址' }, { label: '模型名称' }] }
    ];
    if (filterSettings([], 'x').face !== 'empty') bad.push('空应 empty');
    if (filterSettings(sections, '').face !== 'all') bad.push('空查询应 all');
    const r = filterSettings(sections, '名称');
    if (r.face !== 'results' || r.matched !== 2) bad.push('命中数错，得 ' + r.matched);
    if (filterSettings(sections, '火花').face !== 'noMatch') bad.push('无命中应 noMatch');
    const titleHit = filterSettings(sections, 'API');
    if (titleHit.face !== 'results' || !titleHit.sections[0].titleHit) bad.push('分区标题命中错');
    return { ok: bad.length === 0, bad };
}
