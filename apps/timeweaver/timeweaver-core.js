// Album rules only: callers supply the clock and ID suffix.
export function readLetterAlbum(raw) {
    const value = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return Array.isArray(value) ? value.filter(x => x && Array.isArray(x.paragraphs)) : [];
}

export function planLetterSave(list, letter, now, suffix) {
    const paragraphs = [];
    for (const part of Array.isArray(letter?.paragraphs) ? letter.paragraphs : []) {
        const text = String(part || '').slice(0, 600);
        if (text.trim()) paragraphs.push(text);
        if (paragraphs.length === 12) break;
    }
    if (!paragraphs.length) return { reason: '空信不入册' };
    const ts = Number(letter.ts) || now;
    const sig = paragraphs[0].slice(0, 40);
    if (list.some(x => Number(x.ts) === ts && String(x.paragraphs[0] || '').slice(0, 40) === sig)) {
        return { reason: '已有同一封信' };
    }
    const record = {
        id: 'L' + ts.toString(36) + suffix, ts, savedAt: now,
        title: String(letter.title || '一段被织起的时光').slice(0, 40),
        source: letter.source === 'ai' ? 'ai' : 'local', paragraphs,
        meta: letter.meta && typeof letter.meta === 'object' ? letter.meta : {}
    };
    return { next: [record, ...list.slice(0, 59)] };
}
