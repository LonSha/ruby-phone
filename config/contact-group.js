/**
 * 联系人分组 —— 唯一桥（v4.157.0 · R22-X3）
 *
 * 纪律：分组关系单独落盘（宿主的事）；本桥只算「按组折叠后的顺序」与归因。
 * 未分组者恒在最后，一组不隐藏、不丢人。
 */
import { numOrNull } from './num-gate.js';

export const CONTACT_GROUP_FACES = Object.freeze(['empty', 'ungrouped', 'grouped']);

export function normalizeGroups(groups) {
    const out = [];
    const seen = new Set();
    const arr = Array.isArray(groups) ? groups : [];
    for (const g of arr) {
        if (!g || typeof g !== 'object') continue;
        const id = String(g.id == null ? '' : g.id).trim();
        if (!id || seen.has(id)) continue;
        seen.add(id);
        const members = Array.isArray(g.members) ? g.members.map((m) => String(m == null ? '' : m).trim()).filter(Boolean) : [];
        out.push({ id, label: String(g.label == null ? '' : g.label).trim() || id, order: numOrNull(g.order), members });
    }
    return out;
}

export function groupContacts(contacts, groups) {
    const list = Array.isArray(contacts) ? contacts.filter((c) => c && typeof c === 'object') : [];
    const gl = normalizeGroups(groups);
    const memberOf = new Map();
    gl.forEach((g) => g.members.forEach((m) => { if (!memberOf.has(m)) memberOf.set(m, g.id); }));
    const byGroup = new Map(gl.map((g) => [g.id, []]));
    const ungrouped = [];
    for (const c of list) {
        const id = String(c.id == null ? '' : c.id).trim();
        const gid = id ? memberOf.get(id) : null;
        if (gid && byGroup.has(gid)) byGroup.get(gid).push(c);
        else ungrouped.push(c);
    }
    const sections = gl.length ? gl.slice().sort((a, b) => {
        const ao = a.order == null ? 1e9 : a.order;
        const bo = b.order == null ? 1e9 : b.order;
        return ao - bo;
    }).map((g) => ({ id: g.id, label: g.label, contacts: byGroup.get(g.id) })) : [];
    let face = 'ungrouped';
    if (list.length === 0) face = 'empty';
    else if (sections.some((s) => s.contacts.length > 0)) face = 'grouped';
    return { face, sections, ungrouped, total: list.length };
}

export function contactGroupNote(r) {
    const face = r && r.face;
    if (face === 'empty') return '还没有联系人';
    if (face === 'grouped') return `已分 ${r.sections.filter((s) => s.contacts.length).length} 组`;
    return '还没有分组';
}

export function contactGroupSelfCheck() {
    const bad = [];
    const contacts = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    const r = groupContacts(contacts, [{ id: 'fam', label: '家人', members: ['a'] }, { id: 'wk', label: '同事', members: ['b'] }]);
    if (r.face !== 'grouped') bad.push('有分组应 grouped');
    if (r.sections.length !== 2) bad.push('分组数错');
    if (r.ungrouped.length !== 1 || r.ungrouped[0].id !== 'c') bad.push('未分组错');
    if (groupContacts([], []).face !== 'empty') bad.push('空集应 empty');
    if (groupContacts(contacts, []).face !== 'ungrouped') bad.push('无分组应 ungrouped');
    const frozen = Object.freeze([{ id: 'a' }]);
    const before = JSON.stringify(frozen);
    groupContacts(frozen, [{ id: 'g', members: ['a'] }]);
    if (JSON.stringify(frozen) !== before) bad.push('改了入参');
    return { ok: bad.length === 0, bad };
}
