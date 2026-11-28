// Match with the same whole-string lowercase comparison as the search engine.
export function snippetMatch(text, query) {
    if (!query) return null;
    const folded = text.toLowerCase();
    const needle = query.toLowerCase();
    const at = folded.indexOf(needle);
    if (at < 0) return null;
    const end = at + needle.length;
    if (folded.length === text.length) return [at, end];
    // Some code points expand when lowercased. Return offsets into the original text.
    let original = 0, offset = 0, start = 0;
    for (const ch of text) {
        const next = offset + ch.toLowerCase().length;
        if (offset <= at && at < next) start = original;
        original += ch.length;
        if (next >= end) return [start, original];
        offset = next;
    }
    return null;
}
