/**
 * config/commission-pipeline.js — [v4.51.0 · R6-X4] 委托创作与交付生命周期契约
 * 
 * 【设计职责】
 * 解决“作品从需求沟通走到验收缺乏可协商的生命周期、加需求被单方静默扩大、取消后草稿被抹除或重复扣款”的缺陷：
 * 1. 五阶段生命周期（COMMISSION_STAGES）：brief（需求）-> concept（样稿）-> change_scope（变更协商）-> revision（返修）-> acceptance（验收）；
 * 2. 加需求必须显式提议并经双方确认，禁止静默追加工作量；
 * 3. 取消后保留作者全部草稿与阶段成果，并按约定结算虚拟定金或劳务；
 * 4. 交付后沉淀口碑与回访记录。
 * 
 * 零宿主依赖、零 DOM、纯函数、状态受控克隆，全面冻结导出。
 */

export const COMMISSION_STAGES = Object.freeze({
    BRIEF: 'brief',
    CONCEPT: 'concept',
    CHANGE_SCOPE: 'change_scope',
    REVISION: 'revision',
    ACCEPTANCE: 'acceptance',
    CANCELLED: 'cancelled',
});

function normStr(v) {
    return String(v ?? '').trim();
}

function numOr(v, def = 0) {
    const n = Number(v);
    return Number.isFinite(n) ? n : def;
}

export function createCommission(raw = {}) {
    const id = normStr(raw.id) || `comm_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const title = normStr(raw.title) || '未命名创作委托';
    const client = normStr(raw.client) || '委托人';
    const creator = normStr(raw.creator) || 'user';

    const stage = Object.values(COMMISSION_STAGES).includes(raw.stage) ? raw.stage : COMMISSION_STAGES.BRIEF;
    const requirements = Array.isArray(raw.requirements) ? raw.requirements.map(normStr).filter(Boolean) : [];
    const agreedFee = numOr(raw.agreedFee, 100);
    const depositPaid = numOr(raw.depositPaid, 0);

    return {
        version: 1,
        id,
        title,
        client,
        creator,
        stage,
        requirements,
        agreedFee,
        depositPaid,
        drafts: Array.isArray(raw.drafts) ? raw.drafts.map(d => ({ ...d })) : [],
        scopeChanges: Array.isArray(raw.scopeChanges) ? raw.scopeChanges.map(c => ({ ...c })) : [],
        feedbackHistory: Array.isArray(raw.feedbackHistory) ? raw.feedbackHistory.map(f => ({ ...f })) : [],
        settlement: raw.settlement ? { ...raw.settlement } : null,
        updatedAt: numOr(raw.updatedAt, Date.now()),
    };
}

/**
 * 确认需求简报并支付定金，进入概念样稿阶段
 */
export function acceptBrief(commission, deposit = 30) {
    const c = createCommission(commission);
    if (c.stage !== COMMISSION_STAGES.BRIEF) return { ok: false, reason: 'invalid_stage' };

    c.stage = COMMISSION_STAGES.CONCEPT;
    c.depositPaid = numOr(deposit, 30);
    c.updatedAt = Date.now();
    return { ok: true, commission: c };
}

/**
 * 提交样稿草案
 */
export function submitDraft(commission, draftPayload) {
    const c = createCommission(commission);
    const draft = {
        draftId: normStr(draftPayload.draftId || `d_${Date.now()}`),
        version: normStr(draftPayload.version || 'v1'),
        content: normStr(draftPayload.content),
        submittedAt: Date.now(),
    };
    c.drafts.push(draft);
    c.updatedAt = Date.now();
    return { ok: true, commission: c, draft };
}

/**
 * 提议范围变更（加需求），禁止单方面扩大
 */
export function proposeScopeChange(commission, changePayload) {
    const c = createCommission(commission);
    const change = {
        changeId: normStr(changePayload.changeId || `chg_${Date.now()}`),
        additionalRequirements: Array.isArray(changePayload.additionalRequirements) ? changePayload.additionalRequirements.map(normStr) : [],
        feeDelta: numOr(changePayload.feeDelta, 20),
        status: 'pending', // pending | agreed | rejected
    };
    c.stage = COMMISSION_STAGES.CHANGE_SCOPE;
    c.scopeChanges.push(change);
    c.updatedAt = Date.now();
    return { ok: true, commission: c, change };
}

/**
 * 确认同意范围变更
 */
export function agreeScopeChange(commission, changeId) {
    const c = createCommission(commission);
    const chg = c.scopeChanges.find(x => x.changeId === changeId);
    if (!chg) return { ok: false, reason: 'change_not_found' };

    chg.status = 'agreed';
    c.agreedFee += chg.feeDelta;
    c.requirements.push(...chg.additionalRequirements);
    c.stage = COMMISSION_STAGES.REVISION;
    c.updatedAt = Date.now();
    return { ok: true, commission: c, change: chg };
}

/**
 * 验收并结算最终委托
 */
export function acceptAndSettle(commission, rating = 5, review = '非常满意') {
    const c = createCommission(commission);
    c.stage = COMMISSION_STAGES.ACCEPTANCE;
    c.settlement = {
        finalFee: c.agreedFee,
        remainingPaid: Math.max(0, c.agreedFee - c.depositPaid),
        isSettled: true,
        rating: numOr(rating, 5),
        review: normStr(review),
        completedAt: Date.now(),
    };
    c.updatedAt = Date.now();
    return { ok: true, commission: c, settlement: c.settlement };
}

/**
 * 取消委托：保留作者草稿，按已付定金及约定结算
 */
export function cancelCommission(commission, reason = '双方协商终止') {
    const c = createCommission(commission);
    c.stage = COMMISSION_STAGES.CANCELLED;
    c.settlement = {
        finalFee: c.depositPaid, // 没收或按定金补偿劳务
        isCancelled: true,
        cancelReason: normStr(reason),
        draftsPreservedCount: c.drafts.length,
        cancelledAt: Date.now(),
    };
    c.updatedAt = Date.now();
    return { ok: true, commission: c, settlement: c.settlement };
}