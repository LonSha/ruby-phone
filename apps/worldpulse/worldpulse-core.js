/** History stays in insertion order on disk. Only the displayed selection is reversed. */
export function projectFeed(history, style) {
    const rows = style === 'all' ? history.slice() : history.filter(entry => entry.style === style);
    return { rows: rows.reverse(), total: history.length };
}
