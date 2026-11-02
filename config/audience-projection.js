/* ========================================================
 * config/audience-projection.js — [v4.116.0 · R13-X5] 「谁看见了什么」投影内核（纯函数）
 * --------------------------------------------------------
 * 【它治的缝】发布朋友圈时只有一句「不给3人看」，谁被屏蔽、谁看不到，要靠玩家自己脑补。
 *   本件把这条脑补变成一次可验证的计算：对名册里每个人给出 可见/不可见 + 一条原因。
 *
 * 【三条不变量】
 *   ① 纯计算零写面：不碰任何存储、不发请求、不改入参 —— 预览永远只是预览；
 *   ② 与真源同口径：类型别名闭集、id 优先名字兜底的命中次序，逐字对齐
 *      wechat-data 的 normalizeMomentVisibility / canContactViewMoment ——
 *      预览与实际不符时以实际为准，因此口径必须尽量同源；
 *   ③ 宁多见、不错杀：类型读不出一律按 public 处理（预览错报「看不到」比错报
 *      「能看到」更伤 —— 后者只是少说，前者是无中生有的告密）。
 *
 * 【诚实边界】只做可见性计算与原因标注；「角色因为看不到而生气」等叙事后果不在射程。
 * ============================================================ */
'use strict';

const EXCLUDE_ALIASES = ['exclude', 'hidden', 'deny'];
const INCLUDE_ALIASES = ['include', 'only', 'allow'];

const REASON_KINDS = Object.freeze({
    PUBLIC: 'public',
    INCLUDE_SELECTED: 'include-selected',
    INCLUDE_NOT_SELECTED: 'include-not-selected',
    EXCLUDE_BLOCKED: 'exclude-blocked',
    EXCLUDE_NOT_BLOCKED: 'exclude-not-blocked',
    BAD_RULES: 'bad-rules'
});

const REASON_TEXT = Object.freeze({
    'public': '公开动态，所有人可见',
    'include-selected': '在「仅给谁看」名单里',
    'include-not-selected': '不在「仅给谁看」名单里',
    'exclude-blocked': '被「不给谁看」屏蔽',
    'exclude-not-blocked': '未被屏蔽',
    'bad-rules': '规则读不出，按公开处理'
});

function trimmedList(value) {
    return (Array.isArray(value) ? value : [])
        .map(item => String(item == null ? '' : item).trim())
        .filter(Boolean);
}

/** 归一：别名收进三型闭集，名单去重。与真源 normalizeMomentVisibility 同收。 */
export function normalizeAudienceRules(raw) {
    if (!raw || typeof raw !== 'object') {
        return { type: 'public', contactIds: [], contactNames: [], degraded: true };
    }
    const rawType = String(raw.type || raw.visibilityType || 'public').trim().toLowerCase();
    const type = EXCLUDE_ALIASES.includes(rawType) ? 'exclude'
        : (INCLUDE_ALIASES.includes(rawType) ? 'include' : 'public');
    return {
        type,
        contactIds: [...new Set(trimmedList(raw.contactIds || raw.ids))],
        contactNames: [...new Set(trimmedList(raw.contactNames || raw.names))],
        degraded: false
    };
}

/** 单人投影：对这条内容，这个联系人可见吗？为什么？ */
export function projectAudienceForContact({ audienceRules, contact }) {
    const rules = normalizeAudienceRules(audienceRules);
    const person = (contact && typeof contact === 'object') ? contact : {};
    const id = String(person.id == null ? '' : person.id).trim();
    const name = String(person.name == null ? '' : person.name).trim();
    const nameKey = name.toLowerCase();
    if (rules.type === 'public' || rules.degraded) {
        const kind = rules.degraded ? REASON_KINDS.BAD_RULES : REASON_KINDS.PUBLIC;
        return { visible: true, reasonKind: kind, reasonText: REASON_TEXT[kind] };
    }
    /* 与真源 canContactViewMoment 同规：名单带 id 且本方有 id 时走 id 命中，否则名字归一命中。 */
    const canUseStableIds = rules.contactIds.length > 0 && id.length > 0;
    const isSelected = canUseStableIds
        ? rules.contactIds.includes(id)
        : rules.contactNames.some(n => String(n).trim().toLowerCase() === nameKey);
    if (rules.type === 'include') {
        const kind = isSelected ? REASON_KINDS.INCLUDE_SELECTED : REASON_KINDS.INCLUDE_NOT_SELECTED;
        return { visible: isSelected, reasonKind: kind, reasonText: REASON_TEXT[kind] };
    }
    const kind = isSelected ? REASON_KINDS.EXCLUDE_BLOCKED : REASON_KINDS.EXCLUDE_NOT_BLOCKED;
    return { visible: !isSelected, reasonKind: kind, reasonText: REASON_TEXT[kind] };
}

/** 名册投影：逐人给结论，附摘要计数。名册为空时 entries 为空、不造人。 */
export function projectAudienceForRoster({ audienceRules, contacts }) {
    const roster = Array.isArray(contacts) ? contacts : [];
    const entries = roster.map(contact => {
        const person = (contact && typeof contact === 'object') ? contact : {};
        const id = String(person.id == null ? '' : person.id).trim();
        const name = String(person.name == null ? '' : person.name).trim() || '（无名联系人）';
        const hit = projectAudienceForContact({ audienceRules, contact: { id, name } });
        return { id, name, visible: hit.visible, reasonKind: hit.reasonKind, reasonText: hit.reasonText };
    });
    const visibleCount = entries.filter(entry => entry.visible).length;
    return {
        entries,
        summary: {
            type: normalizeAudienceRules(audienceRules).type,
            totalCount: entries.length,
            visibleCount,
            hiddenCount: entries.length - visibleCount
        }
    };
}
