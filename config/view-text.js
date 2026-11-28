const entities = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&#34;', "'": '&#39;' };

/** Encode scalar values in view text and quoted HTML attributes. */
export function viewText(value) {
    return String(value ?? '').replace(/[&<>"']/g, ch => entities[ch]);
}
