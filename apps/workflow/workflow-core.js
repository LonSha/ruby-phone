import { WD_ACTIONS, WD_DEFAULT_NAME, WD_LIMITS } from '../../config/workflow-designer.js';

export function emptyDraft() {
    return { id: '', name: WD_DEFAULT_NAME, steps: [] };
}

export function copyDraft(template) {
    try { return JSON.parse(JSON.stringify(template)); } catch (_e) { return emptyDraft(); }
}

export function appendDraftStep(draft, key) {
    if (!Object.hasOwn(WD_ACTIONS, key)) return { ok: false, why: 'unknown-action' };
    if (draft.steps.length >= WD_LIMITS.steps) return { ok: false, why: 'full' };
    const action = WD_ACTIONS[key];
    const step = { action: action.key, repeat: 1, params: {}, when: null };
    return { ok: true, draft: { ...draft, steps: [...draft.steps, step] }, label: action.label };
}

export function removeDraftStep(draft, index) {
    // DOM indices arrive as strings; a missing or fractional index is not step zero.
    if (typeof index !== 'number' && !(typeof index === 'string' && /^\d+$/.test(index))) return null;
    const i = Number(index);
    if (!Number.isInteger(i) || i < 0 || i >= draft.steps.length) return null;
    return { ...draft, steps: draft.steps.filter((_, at) => at !== i) };
}
