/* ========================================================
 *  RubyPhone · 写作面卡片的单一消费口（B1–B8）
 * ========================================================
 *
 * 【为什么有这个文件】
 *   B 清单的八个模块是**纯函数**：氛围池、关系七级、判定与平行线、状态字段、
 *   二级摘要、人工纠错。它们单独放着就是「内核建好了、导出挂出来了、产品端零消费」
 *   —— 本仓被 dead-export 门点名过六次的那个形态。
 *
 *   本文件是**唯一的消费口**：把八个模块各自收成一张「卡片」（结构面读数），
 *   再由诊断中心统一读出去。这样做的理由与投影面 / 注入面 / 证据面同族：
 *   本仓一切「上游读数」的可见出口就是诊断中心。
 *
 * 【它**不**做的那件事（边界要说清）】
 *   本文件不替调用方**使用**这些能力（不替它挑氛围、不替它摇骰、不替它纠错）。
 *   它只回答「这八件事各自的真源在不在、读数是什么」。真正的调用点在
 *   各自的 App 与生成路径里 —— 把「可用性」与「用法」混在一个文件里，
 *   下一次改动就会分不清「谁坏了」。
 * ============================================================ */

import { AMBIENCE_KINDS, ambienceCount, pickAmbience, ambienceSpan, ambienceLine } from './ambience-pool.js';
import { RELATION_TIERS, AFFECTION_TONES, TRUST_CHALLENGES, tierOf, buildRelation, relationLine } from './relation-tier.js';
import { OUTCOMES, DIFFICULTY_LINES, rollCheck, rollLine, splitLines, parallelLine } from './scene-rules.js';
import { STATE_FIELDS, readStateFields, stateFieldsLine, factOnlyRows, factRowsLine } from './state-fields.js';
import { ARCHIVE_KINDS, planTwoStage, twoStageLine, scanNarration } from './archive-digest.js';
import { CORRECTION_CHANNELS, applyCorrections, correctionLine } from './memory-correction.js';

/** 八张卡片的**结构面**自证：每张必须给出真读数（不是「已加载」这种空话）。 */
export function craftFaces() {
    const ambience = pickAmbience({ kind: 'weather' });
    const relation = buildRelation({
        name: '自证',
        readings: { messages: 40, helped: 3, shrugged: 0, sentByMe: 20, sentByThem: 25, spanDays: 30 }
    });
    const roll = rollCheck({
        difficulty: 'normal',
        outcomes: { crit: 'a', success: 'b', fail: 'c', 'crit-fail': 'd' },
        rng: () => 0.5
    });
    const fields = readStateFields({ doing: '自证', want: '自证', afraid: '自证', will: '自证', unsaid: '自证' });
    const facts = factOnlyRows([{ who: '自证', did: '自证' }, { thought: '不该出现' }]);
    const twoStage = planTwoStage({
        raw: '原文',
        archive: [{ kind: 'event', text: '事实', who: '自证' }]
    });
    const corrections = applyCorrections([{ id: 'a', text: '一条' }], [{ channel: 'recompute-one', target: 'a' }]);
    return [
        { id: 'ambience', label: '氛围池', rows: ambienceCount(), kinds: AMBIENCE_KINDS.length, line: ambienceLine(ambience) },
        { id: 'relation', label: '关系七级', rows: RELATION_TIERS.length, kinds: Object.keys(AFFECTION_TONES).length, line: relationLine(relation, '自证') },
        { id: 'scene-rules', label: '判定与平行线', rows: OUTCOMES.length, kinds: Object.keys(DIFFICULTY_LINES).length, line: rollLine(roll) },
        { id: 'state-fields', label: '状态字段', rows: STATE_FIELDS.length, kinds: 0, line: stateFieldsLine(fields) },
        { id: 'fact-rows', label: '事实表', rows: facts.rows.length, kinds: facts.keys.length, line: factRowsLine(facts) },
        { id: 'two-stage', label: '二级摘要', rows: ARCHIVE_KINDS.length, kinds: twoStage.archive.length, line: twoStageLine(twoStage) },
        { id: 'correction', label: '人工纠错', rows: CORRECTION_CHANNELS.length, kinds: 0, line: correctionLine(corrections.counts) },
        { id: 'narration', label: '叙述语言扫描', rows: scanNarration('她心里一沉').count, kinds: 0, line: '叙述语言：命中 ' + scanNarration('她心里一沉').count + ' 处' }
    ];
}

/** 一行总读数（给诊断中心）。 */
export function craftLine(faces) {
    const list = Array.isArray(faces) ? faces : craftFaces();
    const rows = list.reduce((sum, f) => sum + (Number(f.rows) || 0), 0);
    return '写作面：' + list.length + ' 张卡 · 条目 ' + rows + ' 条';
}

export default {
    craftFaces, craftLine,
    /* 转出给调用方的能力面（同一份实现，不新造第二份） */
    AMBIENCE_KINDS, ambienceCount, pickAmbience, ambienceSpan, ambienceLine,
    RELATION_TIERS, AFFECTION_TONES, TRUST_CHALLENGES, tierOf, buildRelation, relationLine,
    OUTCOMES, DIFFICULTY_LINES, rollCheck, rollLine, splitLines, parallelLine,
    STATE_FIELDS, readStateFields, stateFieldsLine, factOnlyRows, factRowsLine,
    ARCHIVE_KINDS, planTwoStage, twoStageLine, scanNarration,
    CORRECTION_CHANNELS, applyCorrections, correctionLine
};