/**
 * config/mentorship-colearn.js — [v4.51.0 · R6-X8] 师友共学与能力成长契约内核
 * 
 * 【设计职责】
 * 解决“角色陪伴学习流于数值签到/经验条、缺乏针对作品具体片段的反馈、师友分歧时无法自主选择方向”的缺陷：
 * 1. 围绕具体创作与表达技能设定学习计划（learningTrack）；
 * 2. 练习作品提交与片段引用反馈（引用作品真实字句提出 critique / suggestion）；
 * 3. 师友观点分歧并存（divergentFeedback），用户可自主裁决路线；
 * 4. 严禁跳过练习虚构经验值，成长全由实际作品沉淀与复盘记录支撑。
 * 
 * 零宿主依赖、零 DOM、纯函数、状态受控克隆，全面冻结导出。
 */
import { numOrNull } from './num-gate.js';

function normStr(v) {
    return String(v ?? '').trim();
}


export function createColearnTrack(raw = {}) {
    const id = normStr(raw.id) || `track_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const skill = normStr(raw.skill) || '创意表达';
    const learner = normStr(raw.learner) || 'user';
    const mentors = Array.isArray(raw.mentors) ? raw.mentors.map(m => ({
        mentor: normStr(m.mentor || m),
        focus: normStr(m.focus || '综合指导'),
    })) : [];

    const practices = Array.isArray(raw.practices) ? raw.practices.map(p => ({
        round: (numOrNull(p.round) ?? 1),
        title: normStr(p.title),
        workSnippet: normStr(p.workSnippet),
        feedbacks: Array.isArray(p.feedbacks) ? p.feedbacks.map(f => ({
            mentor: normStr(f.mentor),
            citedQuote: normStr(f.citedQuote),
            critique: normStr(f.critique),
            suggestion: normStr(f.suggestion),
        })) : [],
        chosenDirection: normStr(p.chosenDirection || null),
    })) : [];

    return {
        version: 1,
        id,
        skill,
        learner,
        mentors,
        practices,
        updatedAt: (numOrNull(raw.updatedAt) ?? Date.now()),
    };
}

/**
 * 提交一轮练习作品并收集师友引用片段反馈
 */
export function submitPractice(track, practicePayload) {
    const t = createColearnTrack(track);
    const round = t.practices.length + 1;
    const p = {
        round,
        title: normStr(practicePayload.title || `第${round}轮练习`),
        workSnippet: normStr(practicePayload.workSnippet),
        feedbacks: [],
        chosenDirection: null,
    };

    // 收集师友针对片段的反馈
    if (Array.isArray(practicePayload.feedbacks)) {
        for (const f of practicePayload.feedbacks) {
            p.feedbacks.push({
                mentor: normStr(f.mentor),
                citedQuote: normStr(f.citedQuote),
                critique: normStr(f.critique),
                suggestion: normStr(f.suggestion),
            });
        }
    }

    t.practices.push(p);
    t.updatedAt = Date.now();
    return { ok: true, track: t, practice: p };
}

/**
 * 当师友产生分歧时，由用户自主裁决学习与修改方向
 */
export function chooseDirection(track, round, chosenDirection) {
    const t = createColearnTrack(track);
    const p = t.practices.find(x => x.round === round);
    if (!p) return { ok: false, reason: 'round_not_found' };

    p.chosenDirection = normStr(chosenDirection);
    t.updatedAt = Date.now();
    return { ok: true, track: t, practice: p };
}