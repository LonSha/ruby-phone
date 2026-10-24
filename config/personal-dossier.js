/* ========================================================
 * config/personal-dossier.js — [R7-O6 · 第七期规划] 个人资料与决定册内核（纯函数）
 * --------------------------------------------------------
 * 【这一刀治的是什么】
 *   用户在长达数周的创作与对话中，对关键人物设定、剧情走向或项目决策
 *   做过多次确认。往往数周后想找回当时“为什么这么决定”以及“当时的论据”，
 *   只能在海量聊天记录里做无目的搜索，且容易把模型的临时猜测误当成自己的决定。
 *   个人资料与决定册建立“用户事实决定与论据可溯档案”：
 *     ① 结构化记录核心决定：包含主题问题(question)、确立结论(conclusion)、
 *        正向依据(supportingEvidence)、反例警示(counterEvidence)与复查日期(reviewDate)；
 *     ② 原 App 上下文可回跳契约(sourceRef)：支持指向聊天(chat)、阅读批注(reader)、专题夹(dossier)；
 *     ③ 来源变更影响隔离：当关联书籍或对话更新时，仅标出受影响结论(stale)，不静默破坏档案；
 *     ④ 用户立场撤回机制(retractDecision)：用户撤回已确认的决定后，不再代表其个人立场(retracted)，
 *        变为历史存档或退回中立讨论；
 *     ⑤ 上游断开保全：断开上游连接后已保存结论完整可读，杜绝雪崩丢失。
 * ======================================================== */

'use strict';

/** 决定册条目立场状态 */
export const DECISION_STANCE_STATUS = Object.freeze({
    CONFIRMED: 'confirmed',       // 用户明确确认的个人立场/决定
    RETRACTED: 'retracted',       // 用户已主动撤回（不再代表当下立场）
    UNDER_REVIEW: 'under_review', // 待复查（到了复查日期或上游变动）
    DIVERGENT: 'divergent'        // 并列不同观点（未有一致结论）
});

/** 来源关联渠道类型 */
export const SOURCE_CHANNEL_TYPES = Object.freeze({
    CHAT_THREAD: 'chat_thread',   // 聊天上下文 (如群聊商议)
    READER_NOTE: 'reader_note',   // 读书摘录与批注
    TOPIC_DOSSIER: 'topic_dossier', // 专题夹研究成稿
    MANUAL_MEMO: 'manual_memo'    // 用户手动备忘
});

function safeStr(val, fallback = '') {
    return (typeof val === 'string') ? val.trim() : fallback;
}

function safeNum(val, fallback = 0) {
    const n = Number(val);
    return Number.isFinite(n) ? n : fallback;
}

function clone(val) {
    return JSON.parse(JSON.stringify(val));
}

/**
 * 规范化来源引用
 */
export function normalizeDossierSource(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const sourceId = safeStr(raw.sourceId || raw.id);
    if (!sourceId) return null;

    const channelValues = Object.values(SOURCE_CHANNEL_TYPES);
    const channel = channelValues.includes(raw.channel)
        ? raw.channel
        : SOURCE_CHANNEL_TYPES.CHAT_THREAD;

    return Object.freeze({
        sourceId,
        channel,
        title: safeStr(raw.title, '来源引用'),
        appRoute: safeStr(raw.appRoute, ''), // 回跳原 App 的路由契约
        fingerprint: safeStr(raw.fingerprint, ''),
        excerpt: safeStr(raw.excerpt, '')
    });
}

/**
 * 规范化单条决定档案
 */
export function normalizeDecisionEntry(raw, idx = 0) {
    if (!raw || typeof raw !== 'object') return null;
    const id = safeStr(raw.id, `dec_${Date.now().toString(36)}_${idx}`);
    const question = safeStr(raw.question);
    const conclusion = safeStr(raw.conclusion);
    if (!question || !conclusion) return null;

    const stanceValues = Object.values(DECISION_STANCE_STATUS);
    const stance = stanceValues.includes(raw.stance)
        ? raw.stance
        : DECISION_STANCE_STATUS.CONFIRMED;

    const sources = Array.isArray(raw.sources)
        ? raw.sources.map(normalizeDossierSource).filter(Boolean)
        : [];

    const supportingEvidence = Array.isArray(raw.supportingEvidence)
        ? raw.supportingEvidence.map(safeStr).filter(Boolean)
        : [];

    const counterEvidence = Array.isArray(raw.counterEvidence)
        ? raw.counterEvidence.map(safeStr).filter(Boolean)
        : [];

    const alternativePerspectives = Array.isArray(raw.alternativePerspectives)
        ? raw.alternativePerspectives.map(safeStr).filter(Boolean)
        : [];

    return Object.freeze({
        id,
        topic: safeStr(raw.topic, '综合主题'),
        question,
        conclusion,
        stance,
        sources: Object.freeze(sources),
        supportingEvidence: Object.freeze(supportingEvidence),
        counterEvidence: Object.freeze(counterEvidence),
        alternativePerspectives: Object.freeze(alternativePerspectives),
        reviewDate: safeNum(raw.reviewDate, 0),
        isStale: Boolean(raw.isStale),
        staleReason: safeStr(raw.staleReason, ''),
        createdAt: safeNum(raw.createdAt, Date.now()),
        updatedAt: safeNum(raw.updatedAt, Date.now())
    });
}

/**
 * 构建主题个人档案
 */
export function buildPersonalDossier(topic, entries = []) {
    const rawList = Array.isArray(entries) ? entries : [];
    const validEntries = rawList.map((e, idx) => normalizeDecisionEntry(e, idx)).filter(Boolean);

    return Object.freeze({
        topic: safeStr(topic, '通用主题'),
        entries: Object.freeze(validEntries),
        activeCount: validEntries.filter(e => e.stance === DECISION_STANCE_STATUS.CONFIRMED).length,
        retractedCount: validEntries.filter(e => e.stance === DECISION_STANCE_STATUS.RETRACTED).length,
        updatedAt: Date.now()
    });
}

/**
 * 用户主动撤回某项决定立场
 * 契约：撤回后不再以用户立场呈现（变为 retracted），但保留完整论据与历史
 */
export function retractDecision(dossier, entryId, reason = '') {
    if (!dossier || !Array.isArray(dossier.entries)) return dossier;
    const targetId = safeStr(entryId);
    const nextEntries = dossier.entries.map(e => {
        if (e.id !== targetId) return e;
        return Object.freeze({
            ...e,
            stance: DECISION_STANCE_STATUS.RETRACTED,
            staleReason: safeStr(reason, '用户主动撤回该决定立场'),
            updatedAt: Date.now()
        });
    });
    return buildPersonalDossier(dossier.topic, nextEntries);
}

/**
 * 上游来源改版影响比对
 * 当上游某本书或某段对话更新指纹时，精准将引用的决定标为 stale，不污染其他决定
 */
export function evaluateUpstreamChanges(dossier, changedSources = []) {
    if (!dossier || !Array.isArray(dossier.entries)) return dossier;
    const changeMap = new Map();
    for (const s of (Array.isArray(changedSources) ? changedSources : [])) {
        if (s && s.sourceId) changeMap.set(safeStr(s.sourceId), s);
    }

    const nextEntries = dossier.entries.map(e => {
        const hitChange = e.sources.find(src => {
            const ch = changeMap.get(src.sourceId);
            return ch && ch.fingerprint && ch.fingerprint !== src.fingerprint;
        });

        if (hitChange) {
            return Object.freeze({
                ...e,
                isStale: true,
                staleReason: `上游来源 [${hitChange.title}] 已改版或指纹变动，需复查该结论`,
                updatedAt: Date.now()
            });
        }
        return e;
    });

    return buildPersonalDossier(dossier.topic, nextEntries);
}

/**
 * 模块自检函数
 */
export function personalDossierSelfCheck() {
    const problems = [];
    if (Object.keys(DECISION_STANCE_STATUS).length !== 4) {
        problems.push('DECISION_STANCE_STATUS 必须恰好为 4 态');
    }
    if (Object.keys(SOURCE_CHANNEL_TYPES).length !== 4) {
        problems.push('SOURCE_CHANNEL_TYPES 必须恰好为 4 类');
    }

    // 单元自测场景：从两本书和一次群聊决定构成档案
    const s1 = normalizeDossierSource({ sourceId: 'book1', channel: 'reader_note', title: '机械史', fingerprint: 'fp_b1' });
    const s2 = normalizeDossierSource({ sourceId: 'book2', channel: 'reader_note', title: '经济学纲要', fingerprint: 'fp_b2' });
    const s3 = normalizeDossierSource({ sourceId: 'chat_team', channel: 'chat_thread', title: '周一例会记录', fingerprint: 'fp_c1' });

    const d1 = normalizeDecisionEntry({
        id: 'dec_1',
        topic: '工厂改制方案',
        question: '是否引入外部资本合作？',
        conclusion: '同意引入，但必须保留49%投票权与核心技术否决权',
        sources: [s1, s2, s3],
        supportingEvidence: ['经济学纲要第4章指明合资可分散现金流风险', '例会已达成全员共识'],
        counterEvidence: ['机械史案例表明丧失主导权会导致研发停滞'],
        stance: DECISION_STANCE_STATUS.CONFIRMED
    });

    const d2 = normalizeDecisionEntry({
        id: 'dec_2',
        topic: '工厂改制方案',
        question: '是否裁减老厂房保全人员？',
        conclusion: '暂缓裁员，转岗至仓储物流',
        sources: [s3],
        stance: DECISION_STANCE_STATUS.CONFIRMED
    });

    let dossier = buildPersonalDossier('工厂改制方案', [d1, d2]);
    if (dossier.activeCount !== 2) {
        problems.push('初始有效决定数应为 2');
    }

    // 上游改版影响测试：仅 book1 改版，不影响 dec_2
    dossier = evaluateUpstreamChanges(dossier, [{ sourceId: 'book1', fingerprint: 'fp_b1_v2' }]);
    const dec1Check = dossier.entries.find(e => e.id === 'dec_1');
    const dec2Check = dossier.entries.find(e => e.id === 'dec_2');
    if (!dec1Check?.isStale) {
        problems.push('关联书目改版后 dec_1 未被正确标为 stale');
    }
    if (dec2Check?.isStale) {
        problems.push('未引用改版书目的 dec_2 不应被误标 stale');
    }

    // 撤回决定测试
    dossier = retractDecision(dossier, 'dec_1', '合资方提出新霸王条款，撤回原合作决定');
    const dec1Retracted = dossier.entries.find(e => e.id === 'dec_1');
    if (dec1Retracted?.stance !== DECISION_STANCE_STATUS.RETRACTED) {
        problems.push('撤回后立场状态应为 retracted');
    }
    if (dossier.activeCount !== 1) {
        problems.push('撤回一项后有效决定数应变为 1');
    }

    return { problems };
}